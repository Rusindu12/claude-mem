"""Order validation, idempotency, duplicate prevention and risk enforcement."""
from __future__ import annotations

import uuid
from decimal import Decimal

import pytest

from app.db.models import OrderSide, OrderStatus, OrderType, TradingMode, User
from app.services.risk import OrderIntent, RiskEngine, default_policy
from app.core.config import Settings
from app.db.models import RiskPolicy, TradingControl


def price_of(client, headers, symbol="BTCUSDT") -> float:
    response = client.get(f"/api/v1/market/ticker/{symbol}", headers=headers)
    assert response.status_code == 200
    return float(response.json()["price"])


def order_payload(client, headers, *, quantity=None, side="BUY", order_type="MARKET", **extra):
    price = price_of(client, headers)
    quantity = quantity if quantity is not None else round(40 / price, 6)
    payload = {
        "symbol": "BTCUSDT",
        "side": side,
        "order_type": order_type,
        "quantity": str(quantity),
        "mode": "paper",
        "stop_loss": str(round(price * 0.995, 2)) if side == "BUY" else None,
        "take_profit": str(round(price * 1.01, 2)) if side == "BUY" else None,
        "idempotency_key": uuid.uuid4().hex,
    }
    payload.update(extra)
    return payload


def raise_limits(client, headers, **overrides):
    body = {"max_trade_notional": "5000", "max_daily_loss": "500", "max_risk_per_trade_pct": "5"}
    body.update(overrides)
    response = client.put("/api/v1/risk/policy", headers=headers, json=body)
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------- preview
def test_preview_returns_risk_checks_without_placing(client, user_headers):
    raise_limits(client, user_headers)
    payload = order_payload(client, user_headers)
    response = client.post("/api/v1/orders/preview", headers=user_headers, json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["can_place"] is True
    assert body["market"]["synthetic"] is True
    assert body["market"]["stale"] is False
    names = {check["name"] for check in body["risk"]["checks"]}
    assert {"kill_switch", "max_trade_notional", "max_daily_loss", "min_notional"} <= names
    # Preview must not create an order.
    listed = client.get("/api/v1/orders?mode=paper", headers=user_headers).json()
    assert listed == []


def test_preview_rejects_missing_stop_loss(client, user_headers):
    payload = order_payload(client, user_headers)
    payload.pop("stop_loss")
    response = client.post("/api/v1/orders/preview", headers=user_headers, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert body["can_place"] is False
    assert "stop_loss_required" in {v["code"] for v in body["risk"]["violations"]}


# ----------------------------------------------------------------------- paper
def test_paper_market_buy_fills_with_costs(client, user_headers):
    raise_limits(client, user_headers)
    payload = order_payload(client, user_headers)
    response = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["status"] == "FILLED"
    assert order["mode"] == "paper"
    assert Decimal(order["filled_quantity"]) > 0
    assert Decimal(order["fee_paid"]) > 0
    reference = price_of(client, user_headers)
    # Slippage pushes a buy fill above the reference price.
    assert float(order["average_fill_price"]) >= reference * 0.999

    portfolio = client.get("/api/v1/portfolio?mode=paper", headers=user_headers).json()
    assert portfolio["simulated"] is True
    assert Decimal(portfolio["quote_balance"]) < Decimal("10000")
    assert portfolio["position_count"] == 1
    assert "No order was sent to Binance" in portfolio["note"]

    positions = client.get("/api/v1/portfolio/paper/positions", headers=user_headers).json()
    assert len(positions) == 1 and positions[0]["symbol"] == "BTCUSDT"
    assert positions[0]["stop_loss"] is not None


def test_idempotent_replay_returns_same_order(client, user_headers):
    raise_limits(client, user_headers)
    payload = order_payload(client, user_headers)
    first = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert first.status_code == 201
    second = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["idempotent_replay"] is True
    orders = client.get("/api/v1/orders?mode=paper", headers=user_headers).json()
    assert len(orders) == 1


def test_duplicate_order_guard(client, user_headers):
    raise_limits(client, user_headers)
    first = order_payload(client, user_headers)
    quantity = first["quantity"]
    assert client.post("/api/v1/orders", headers=user_headers, json=first).status_code == 201
    duplicate = order_payload(client, user_headers, quantity=quantity)
    response = client.post("/api/v1/orders", headers=user_headers, json=duplicate)
    assert response.status_code == 409
    assert "duplicate" in response.json()["error"]["message"].lower()


def test_order_requires_idempotency_key(client, user_headers):
    payload = order_payload(client, user_headers)
    payload["idempotency_key"] = "short"
    response = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert response.status_code == 422


def test_quantity_rounded_to_step_size(client, user_headers):
    raise_limits(client, user_headers)
    price = price_of(client, user_headers)
    # A step size of 0.00001 must round 0.0001234567 down.
    payload = order_payload(client, user_headers, quantity=f"{0.0001234567:.10f}")
    response = client.post("/api/v1/orders/preview", headers=user_headers, json=payload)
    assert response.status_code == 200
    body = response.json()
    assert Decimal(body["quantity"]) == Decimal("0.00012")
    assert any("rounded" in note for note in body["adjustments"])


def test_below_min_notional_rejected(client, user_headers):
    payload = order_payload(client, user_headers, quantity="0.00001")
    response = client.post("/api/v1/orders/preview", headers=user_headers, json=payload)
    body = response.json()
    codes = {v["code"] for v in body["risk"]["violations"]}
    assert "min_notional" in codes
    place = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert place.status_code == 422
    assert place.json()["error"]["code"] == "risk_rejected"


def test_sell_without_position_rejected(client, user_headers):
    payload = order_payload(client, user_headers, side="SELL")
    response = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert response.status_code == 422
    codes = {v["code"] for v in response.json()["error"]["details"]["violations"]}
    assert "insufficient_position" in codes


def test_insufficient_balance_rejected(client, user_headers):
    raise_limits(client, user_headers, max_trade_notional="1000000", max_risk_per_trade_pct="10")
    price = price_of(client, user_headers)
    payload = order_payload(client, user_headers, quantity=round(50000 / price, 6))
    response = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert response.status_code == 422
    codes = {v["code"] for v in response.json()["error"]["details"]["violations"]}
    assert "insufficient_balance" in codes


def test_per_trade_risk_limit(client, user_headers):
    raise_limits(client, user_headers, max_risk_per_trade_pct="0.01")
    price = price_of(client, user_headers)
    payload = order_payload(client, user_headers, quantity=round(100 / price, 6))
    payload["stop_loss"] = str(round(price * 0.5, 2))  # huge risk per unit
    response = client.post("/api/v1/orders/preview", headers=user_headers, json=payload)
    body = response.json()
    assert "max_risk_per_trade" in {v["code"] for v in body["risk"]["violations"]}


def test_limit_order_rests_and_can_be_cancelled(client, user_headers):
    raise_limits(client, user_headers)
    price = price_of(client, user_headers)
    payload = order_payload(client, user_headers, order_type="LIMIT")
    payload["price"] = str(round(price * 0.9, 2))
    payload["stop_loss"] = str(round(price * 0.85, 2))
    created = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert created.status_code == 201, created.text
    order = created.json()
    assert order["status"] == "NEW"
    cancelled = client.post(f"/api/v1/orders/{order['id']}/cancel?mode=paper", headers=user_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELED"
    again = client.post(f"/api/v1/orders/{order['id']}/cancel?mode=paper", headers=user_headers)
    assert again.status_code == 422


def test_order_history_and_csv_export(client, user_headers):
    raise_limits(client, user_headers)
    client.post("/api/v1/orders", headers=user_headers, json=order_payload(client, user_headers))
    orders = client.get("/api/v1/orders?mode=paper", headers=user_headers)
    assert orders.status_code == 200 and len(orders.json()) == 1
    events = client.get("/api/v1/orders/events", headers=user_headers)
    assert events.status_code == 200 and len(events.json()) >= 1
    export = client.get("/api/v1/orders/export.csv?mode=paper", headers=user_headers)
    assert export.status_code == 200
    assert export.headers["content-type"].startswith("text/csv")
    assert "BTCUSDT" in export.text


def test_paper_round_trip_updates_analytics(client, user_headers):
    raise_limits(client, user_headers, max_open_orders="10")
    buy = order_payload(client, user_headers)
    placed = client.post("/api/v1/orders", headers=user_headers, json=buy)
    assert placed.status_code == 201
    quantity = placed.json()["filled_quantity"]
    sell = {
        "symbol": "BTCUSDT",
        "side": "SELL",
        "order_type": "MARKET",
        "quantity": quantity,
        "mode": "paper",
        "idempotency_key": uuid.uuid4().hex,
    }
    sold = client.post("/api/v1/orders", headers=user_headers, json=sell)
    assert sold.status_code == 201, sold.text
    analytics = client.get("/api/v1/portfolio/analytics?mode=paper&days=7", headers=user_headers)
    assert analytics.status_code == 200
    summary = analytics.json()["summary"]
    assert summary["trade_count"] == 1
    assert Decimal(summary["fees_paid"]) > 0
    assert analytics.json()["cost_assumptions"]["taker_fee_bps"] >= 0


# ------------------------------------------------------------------------ live
def test_live_orders_blocked_when_server_disabled(client, user_headers):
    payload = order_payload(client, user_headers)
    payload["mode"] = "live"
    payload["approved"] = True
    response = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert response.status_code == 403
    assert response.json()["error"]["details"]["code"] == "live_trading_disabled"


def test_live_opt_in_requires_exact_confirmation(client, user_headers):
    response = client.post(
        "/api/v1/risk/live-opt-in",
        headers=user_headers,
        json={"opt_in": True, "confirmation": "yes please", "acknowledge_risk": True},
    )
    assert response.status_code == 422
    blocked = client.post(
        "/api/v1/risk/live-opt-in",
        headers=user_headers,
        json={"opt_in": True, "confirmation": "ENABLE LIVE TRADING", "acknowledge_risk": False},
    )
    assert blocked.status_code == 422
    # The server flag is off in this environment, so even a correct phrase fails.
    refused = client.post(
        "/api/v1/risk/live-opt-in",
        headers=user_headers,
        json={"opt_in": True, "confirmation": "ENABLE LIVE TRADING", "acknowledge_risk": True},
    )
    assert refused.status_code == 422
    assert "disabled" in refused.json()["error"]["message"].lower()


def test_risk_status_explains_live_gating(client, user_headers):
    response = client.get("/api/v1/risk/status", headers=user_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["can_trade_live"] is False
    assert body["server"]["live_trading_enabled"] is False
    assert body["policy"]["live_opt_in"] is False


def test_emergency_stop_cancels_open_orders_and_disables_live(client, user_headers):
    raise_limits(client, user_headers)
    price = price_of(client, user_headers)
    payload = order_payload(client, user_headers, order_type="LIMIT")
    payload["price"] = str(round(price * 0.8, 2))
    payload["stop_loss"] = str(round(price * 0.75, 2))
    created = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert created.status_code == 201
    response = client.post("/api/v1/risk/emergency-stop", headers=user_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["live_opt_in"] is False
    assert created.json()["id"] in body["cancelled_orders"]
    open_orders = client.get("/api/v1/orders?mode=paper&open_only=true", headers=user_headers).json()
    assert open_orders == []


def test_admin_kill_switch_blocks_orders(client, user_headers, admin_headers):
    raise_limits(client, user_headers)
    engage = client.post(
        "/api/v1/admin/kill-switch",
        headers=admin_headers,
        json={"engage": True, "reason": "Manual review in progress"},
    )
    assert engage.status_code == 200
    response = client.post("/api/v1/orders", headers=user_headers, json=order_payload(client, user_headers))
    assert response.status_code == 422
    codes = {v["code"] for v in response.json()["error"]["details"]["violations"]}
    assert "kill_switch" in codes
    release = client.post(
        "/api/v1/admin/kill-switch",
        headers=admin_headers,
        json={"engage": False, "reason": "Review complete"},
    )
    assert release.status_code == 200
    allowed = client.post("/api/v1/orders", headers=user_headers, json=order_payload(client, user_headers))
    assert allowed.status_code == 201


def test_reconcile_is_safe_when_live_disabled(client, user_headers):
    response = client.post("/api/v1/orders/reconcile", headers=user_headers)
    assert response.status_code == 200
    assert response.json()["checked"] == 0


def test_analysis_mode_cannot_place_orders(client, user_headers):
    payload = order_payload(client, user_headers)
    payload["mode"] = "analysis"
    response = client.post("/api/v1/orders", headers=user_headers, json=payload)
    assert response.status_code == 422
    assert "analysis-only" in response.json()["error"]["message"].lower()


# ------------------------------------------------------------- risk engine unit
@pytest.fixture()
def engine() -> RiskEngine:
    return RiskEngine(live_trading_enabled=False, automation_enabled=False, environment="test")


@pytest.fixture()
def intent() -> OrderIntent:
    return OrderIntent(
        symbol="BTCUSDT",
        side=OrderSide.BUY,
        order_type="MARKET",
        quantity=Decimal("0.001"),
        price=Decimal("60000"),
        quote_notional=Decimal("60"),
        stop_loss=Decimal("59400"),
        min_notional=Decimal("5"),
        step_size=Decimal("0.00001"),
        tick_size=Decimal("0.01"),
        volatility_pct=1.0,
        spread_bps=2.0,
    )


def base_kwargs():
    policy = default_policy("user-1")
    return dict(
        policy=policy,
        control=TradingControl(id="global", kill_switch=False),
        equity=Decimal("10000"),
        available_quote=Decimal("10000"),
        daily_realized_pnl=Decimal("0"),
        current_exposure=Decimal("0"),
        open_orders=0,
        open_positions=0,
    )


def test_risk_engine_approves_a_clean_order(engine, intent):
    decision = engine.evaluate(intent, **base_kwargs())
    assert decision.approved, decision.violations
    assert not decision.violations
    assert len(decision.checks) >= 8


def test_risk_engine_blocks_daily_loss(engine, intent):
    kwargs = base_kwargs()
    kwargs["daily_realized_pnl"] = Decimal("-100")
    decision = engine.evaluate(intent, **kwargs)
    assert not decision.approved
    assert "max_daily_loss" in {v["code"] for v in decision.violations}


def test_risk_engine_blocks_cooldown(engine, intent):
    from datetime import datetime, timedelta, timezone

    kwargs = base_kwargs()
    kwargs["policy"].cooldown_until = datetime.now(timezone.utc) + timedelta(minutes=30)
    decision = engine.evaluate(intent, **kwargs)
    assert "cooldown" in {v["code"] for v in decision.violations}


def test_risk_engine_blocks_exposure_ceiling(engine, intent):
    kwargs = base_kwargs()
    policy: RiskPolicy = kwargs["policy"]
    policy.max_portfolio_exposure_pct = Decimal("0.5")
    decision = engine.evaluate(intent, **kwargs)
    assert "max_portfolio_exposure" in {v["code"] for v in decision.violations}


def test_risk_engine_blocks_stale_and_synthetic_live(engine, intent):
    stale = base_kwargs()
    intent.data_is_stale = True
    decision = engine.evaluate(intent, **stale)
    assert "stale_market_data" in {v["code"] for v in decision.violations}

    intent.data_is_stale = False
    intent.data_is_synthetic = True
    intent.mode = TradingMode.live
    decision = engine.evaluate(intent, **base_kwargs())
    codes = {v["code"] for v in decision.violations}
    assert "synthetic_data" in codes
    assert "live_trading_disabled" in codes


def test_risk_engine_enforces_precision(engine, intent):
    intent.quantity = Decimal("0.001234")
    decision = engine.evaluate(intent, **base_kwargs())
    assert "step_size" in {v["code"] for v in decision.violations}

    intent.quantity = Decimal("0.001")
    intent.price = Decimal("60000.005")
    intent.order_type = "LIMIT"
    decision = engine.evaluate(intent, **base_kwargs())
    assert "tick_size" in {v["code"] for v in decision.violations}


def test_risk_engine_blocks_open_order_and_position_limits(engine, intent):
    kwargs = base_kwargs()
    kwargs["open_orders"] = 3
    decision = engine.evaluate(intent, **kwargs)
    assert "max_open_orders" in {v["code"] for v in decision.violations}

    kwargs = base_kwargs()
    kwargs["open_positions"] = 2
    decision = engine.evaluate(intent, **kwargs)
    assert "max_open_positions" in {v["code"] for v in decision.violations}


def test_risk_engine_requires_manual_approval_for_live(engine, intent):
    engine.live_trading_enabled = True
    engine.automation_enabled = False
    intent.mode = TradingMode.live
    kwargs = base_kwargs()
    kwargs["policy"].live_opt_in = True
    decision = engine.evaluate(intent, manual_approval=False, **kwargs)
    assert "manual_approval_required" in {v["code"] for v in decision.violations}
    approved = engine.evaluate(intent, manual_approval=True, **kwargs)
    assert approved.approved, approved.violations


def test_risk_engine_kill_switch_short_circuits(engine, intent):
    kwargs = base_kwargs()
    kwargs["control"].kill_switch = True
    kwargs["control"].reason = "admin stop"
    decision = engine.evaluate(intent, **kwargs)
    assert not decision.approved
    assert decision.violations[0]["code"] == "kill_switch"
    assert "admin stop" in decision.violations[0]["message"]
