"""Portfolio analytics, alerts, assistant grounding and admin permissions."""
from __future__ import annotations

import uuid
from decimal import Decimal

from app.services.assistant import AssistantService


def place_buy(client, headers, quantity=None):
    price = float(client.get("/api/v1/market/ticker/BTCUSDT", headers=headers).json()["price"])
    client.put(
        "/api/v1/risk/policy",
        headers=headers,
        json={"max_trade_notional": "5000", "max_daily_loss": "500", "max_risk_per_trade_pct": "5"},
    )
    body = {
        "symbol": "BTCUSDT",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": str(quantity or round(40 / price, 6)),
        "mode": "paper",
        "stop_loss": str(round(price * 0.99, 2)),
        "take_profit": str(round(price * 1.02, 2)),
        "idempotency_key": uuid.uuid4().hex,
    }
    response = client.post("/api/v1/orders", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


# ------------------------------------------------------------------ portfolio
def test_empty_paper_portfolio(client, user_headers):
    response = client.get("/api/v1/portfolio?mode=paper", headers=user_headers)
    assert response.status_code == 200
    body = response.json()
    assert Decimal(body["total_value_usdt"]) == Decimal("10000")
    assert body["position_count"] == 0
    assert body["simulated"] is True
    assert body["mode"] == "paper"


def test_portfolio_reflects_a_position(client, user_headers):
    order = place_buy(client, user_headers)
    body = client.get("/api/v1/portfolio?mode=paper", headers=user_headers).json()
    assert body["position_count"] == 1
    assert Decimal(body["holdings_value"]) > 0
    assert Decimal(body["fees_paid"]) == Decimal(order["fee_paid"])
    assert body["positions"][0]["symbol"] == "BTCUSDT"


def test_analytics_include_costs_and_disclaimers(client, user_headers):
    order = place_buy(client, user_headers)
    analytics = client.get("/api/v1/portfolio/analytics?mode=paper&days=30", headers=user_headers)
    assert analytics.status_code == 200
    body = analytics.json()
    assert body["simulated"] is True
    assert body["cost_assumptions"]["taker_fee_bps"] is not None
    assert "fees" in body["note"].lower()
    assert body["summary"]["equity"] is not None


def test_live_portfolio_requires_credentials(client, user_headers):
    response = client.get("/api/v1/portfolio?mode=live", headers=user_headers)
    assert response.status_code == 404
    assert "api key" in response.json()["error"]["message"].lower()


def test_paper_reset_clears_history(client, user_headers):
    place_buy(client, user_headers)
    reset = client.post("/api/v1/portfolio/paper/reset?starting_equity=2500", headers=user_headers)
    assert reset.status_code == 200
    body = client.get("/api/v1/portfolio?mode=paper", headers=user_headers).json()
    assert Decimal(body["total_value_usdt"]) == Decimal("2500")
    assert body["position_count"] == 0
    assert client.get("/api/v1/orders?mode=paper", headers=user_headers).json() == []


def test_export_endpoints_return_csv(client, user_headers):
    place_buy(client, user_headers)
    trades = client.get("/api/v1/portfolio/export/trades.csv", headers=user_headers)
    assert trades.status_code == 200
    assert "symbol" in trades.text.splitlines()[0]
    orders = client.get("/api/v1/portfolio/export/orders.csv?mode=paper", headers=user_headers)
    assert orders.status_code == 200


# --------------------------------------------------------------------- alerts
def test_price_alert_triggers_and_notifies(client, user_headers):
    price = float(client.get("/api/v1/market/ticker/BTCUSDT", headers=user_headers).json()["price"])
    created = client.post(
        "/api/v1/alerts",
        headers=user_headers,
        json={"symbol": "BTCUSDT", "condition": "price_below", "target_price": round(price * 2, 2)},
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "active"
    evaluated = client.post("/api/v1/alerts/evaluate", headers=user_headers)
    assert evaluated.status_code == 200
    assert len(evaluated.json()["triggered"]) == 1
    alerts = client.get("/api/v1/alerts", headers=user_headers).json()
    assert alerts[0]["status"] == "triggered"
    notifications = client.get("/api/v1/notifications", headers=user_headers).json()
    assert any(n["kind"] == "price_alert" for n in notifications)


def test_price_alert_requires_target(client, user_headers):
    response = client.post(
        "/api/v1/alerts", headers=user_headers, json={"symbol": "BTCUSDT", "condition": "price_above"}
    )
    assert response.status_code == 422


def test_alert_deleted(client, user_headers):
    created = client.post(
        "/api/v1/alerts",
        headers=user_headers,
        json={"symbol": "BTCUSDT", "condition": "signal_buy"},
    )
    assert created.status_code == 201
    deleted = client.delete(f"/api/v1/alerts/{created.json()['id']}", headers=user_headers)
    assert deleted.status_code == 204
    assert client.get("/api/v1/alerts", headers=user_headers).json() == []


def test_notifications_never_contain_secret_fields(client, user_headers):
    place_buy(client, user_headers)
    rows = client.get("/api/v1/notifications", headers=user_headers).json()
    assert rows
    for row in rows:
        for key in row["data"]:
            assert "secret" not in key.lower()
            assert "api_key" not in key.lower()
    marked = client.post("/api/v1/notifications/read", headers=user_headers, json={})
    assert marked.status_code == 200


# ------------------------------------------------------------------ assistant
def test_assistant_answers_with_grounded_signal_facts(client, user_headers):
    response = client.post(
        "/api/v1/assistant/ask",
        headers=user_headers,
        json={"question": "why did you generate this signal?", "lang": "en", "symbol": "BTCUSDT"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["intent"] == "signal"
    assert "BTCUSDT" in body["answer"]
    assert "not financial advice" in body["answer"].lower()
    assert body["data_as_of"]
    assert body["facts"]["symbol"] == "BTCUSDT"


def test_assistant_answers_in_sinhala(client, user_headers):
    response = client.post(
        "/api/v1/assistant/ask",
        headers=user_headers,
        json={"question": "සංඥාව ගැන කියන්න", "lang": "si", "symbol": "BTCUSDT"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["lang"] == "si"
    assert any("\u0d80" <= ch <= "\u0dff" for ch in body["answer"])


def test_assistant_reports_portfolio_without_inventing_balances(client, user_headers):
    response = client.post(
        "/api/v1/assistant/ask",
        headers=user_headers,
        json={"question": "what is my balance?", "lang": "en"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["intent"] == "portfolio"
    assert "10000" in body["answer"] or "10,000" in body["answer"]
    assert "simulated" in body["answer"].lower()


def test_assistant_cannot_place_orders(client, user_headers):
    before = len(client.get("/api/v1/orders?mode=paper", headers=user_headers).json())
    response = client.post(
        "/api/v1/assistant/ask",
        headers=user_headers,
        json={"question": "buy 1 BTC for me right now", "lang": "en"},
    )
    assert response.status_code == 200
    body = response.json()
    assert "cannot place" in body["answer"].lower() or "approve" in body["answer"].lower()
    after = len(client.get("/api/v1/orders?mode=paper", headers=user_headers).json())
    assert before == after


def test_assistant_history_is_persisted(client, user_headers):
    client.post("/api/v1/assistant/ask", headers=user_headers, json={"question": "what is RSI?", "lang": "en"})
    history = client.get("/api/v1/assistant/history", headers=user_headers)
    assert history.status_code == 200
    assert len(history.json()) >= 1
    assert history.json()[0]["intent"] in ("indicators", "signal", "app", "market")


def test_assistant_rejects_empty_question(client, user_headers):
    response = client.post("/api/v1/assistant/ask", headers=user_headers, json={"question": " ", "lang": "en"})
    assert response.status_code == 422


# ----------------------------------------------------------------------- admin
def test_admin_can_list_users_without_secrets(client, admin_headers):
    response = client.get("/api/v1/admin/users", headers=admin_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] >= 1
    serialized = str(body)
    assert "password_hash" not in serialized
    assert "$argon2" not in serialized
    assert "secret_ciphertext" not in serialized


def test_admin_can_suspend_a_user(client, admin_headers, user_headers, client_factory=None):
    me = client.get("/api/v1/auth/me", headers=user_headers).json()
    suspended = client.patch(
        f"/api/v1/admin/users/{me['id']}", headers=admin_headers, json={"status": "suspended"}
    )
    assert suspended.status_code == 200
    assert suspended.json()["status"] == "suspended"
    blocked = client.get("/api/v1/auth/me", headers=user_headers)
    assert blocked.status_code == 403


def test_admin_cannot_demote_themselves(client, admin_headers):
    me = client.get("/api/v1/auth/me", headers=admin_headers).json()
    response = client.patch(f"/api/v1/admin/users/{me['id']}", headers=admin_headers, json={"role": "user"})
    assert response.status_code == 422


def test_admin_settings_and_pairs(client, admin_headers):
    settings_view = client.get("/api/v1/admin/settings", headers=admin_headers)
    assert settings_view.status_code == 200
    assert any(item["key"] == "maintenance_mode" for item in settings_view.json()["settings"])
    updated = client.put(
        "/api/v1/admin/settings",
        headers=admin_headers,
        json={"key": "min_app_version", "value": "1.2.0"},
    )
    assert updated.status_code == 200
    assert client.get("/api/v1/config").json()["min_app_version"] == "1.2.0"

    synced = client.post("/api/v1/admin/pairs/sync", headers=admin_headers)
    assert synced.status_code == 200
    pairs = client.get("/api/v1/admin/pairs", headers=admin_headers).json()
    assert any(p["symbol"] == "BTCUSDT" for p in pairs)
    toggled = client.patch("/api/v1/admin/pairs/BTCUSDT", headers=admin_headers, json={"enabled": False})
    assert toggled.status_code == 200 and toggled.json()["enabled"] is False


def test_maintenance_mode_blocks_orders_but_not_market_data(client, admin_headers, user_headers):
    client.put(
        "/api/v1/admin/settings", headers=admin_headers, json={"key": "maintenance_mode", "value": True}
    )
    price = client.get("/api/v1/market/ticker/BTCUSDT", headers=user_headers)
    assert price.status_code == 200
    order = client.post(
        "/api/v1/orders",
        headers=user_headers,
        json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": "0.001",
            "mode": "paper",
            "stop_loss": "1",
            "idempotency_key": uuid.uuid4().hex,
        },
    )
    assert order.status_code == 503
    assert order.json()["error"]["code"] == "maintenance_mode"
    client.put(
        "/api/v1/admin/settings", headers=admin_headers, json={"key": "maintenance_mode", "value": False}
    )


def test_admin_health_and_audit_are_available(client, admin_headers):
    health = client.get("/api/v1/admin/health", headers=admin_headers)
    assert health.status_code == 200
    body = health.json()
    assert body["database"] == "ok"
    assert "market" in body and "counts" in body
    audit = client.get("/api/v1/admin/audit", headers=admin_headers)
    assert audit.status_code == 200 and isinstance(audit.json(), list)


def test_admin_cannot_read_user_credentials(client, admin_headers, user_headers):
    """Admin endpoints expose no route that returns ciphertext or plaintext keys."""
    response = client.get("/api/v1/admin/users", headers=admin_headers)
    assert "api_key_ciphertext" not in str(response.json())
    # There is no admin endpoint for credential contents.
    assert client.get("/api/v1/admin/credentials", headers=admin_headers).status_code == 404


def test_security_documents_no_admin_bypass_of_risk(client, admin_headers, user_headers):
    """Admins cannot disable the risk engine; a kill switch only tightens it."""
    me = client.get("/api/v1/auth/me", headers=admin_headers).json()
    assert me["role"] == "admin"
    risk = client.get("/api/v1/risk/status", headers=admin_headers).json()
    assert risk["server"]["risk_engine_enabled"] is True
    # A normal user cannot lift the global kill switch.
    assert client.post(
        "/api/v1/admin/kill-switch", headers=user_headers, json={"engage": False, "reason": "please"}
    ).status_code == 403


def test_assistant_service_refuses_when_engine_missing(monkeypatch, client, user_headers):
    from app.services import ai

    monkeypatch.setattr(ai, "_ENGINE", None)
    monkeypatch.setattr(ai, "_ENGINE_ERROR", "engine unavailable for test")
    response = client.post(
        "/api/v1/assistant/ask", headers=user_headers, json={"question": "how is the market?"}
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
