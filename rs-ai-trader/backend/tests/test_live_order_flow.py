"""Live Spot order flow tested against a fake Binance client (no network).

These tests exercise the paths that matter most for safety:
* an order is only FILLED when the exchange confirms it;
* an ambiguous submission becomes UNKNOWN and is reconciled, never resubmitted;
* a rejected submission never becomes "success";
* live trading stays gated behind configuration + consent + manual approval.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db.base import session_scope
from app.db.models import ApiCredential, OrderStatus, TradingControl, User
from app.services.binance_client import BinanceError, SymbolFilters
from app.services.credentials import CredentialService
from app.main import create_app
from tests.conftest import TEST_PASSWORD, auth_headers, make_settings, register


class FakeBinanceClient:
    def __init__(self, *, create_response=None, create_error=None, query_response=None, cancel_response=None):
        self.create_response = create_response
        self.create_error = create_error
        self.query_response = query_response
        self.cancel_response = cancel_response
        self.created: list[dict] = []
        self.queries: list[dict] = []
        self.closed = False

    def create_order(self, **params):
        self.created.append(params)
        if self.create_error:
            raise self.create_error
        return self.create_response

    def query_order(self, symbol, *, order_id=None, client_order_id=None):
        self.queries.append({"symbol": symbol, "client_order_id": client_order_id})
        if isinstance(self.query_response, Exception):
            raise self.query_response
        return self.query_response

    def cancel_order(self, symbol, *, order_id=None, client_order_id=None):
        if isinstance(self.cancel_response, Exception):
            raise self.cancel_response
        return self.cancel_response

    def account(self):
        return {
            "canTrade": True,
            "accountType": "SPOT",
            "balances": [
                {"asset": "USDT", "free": "10000.00000000", "locked": "0.00000000"},
                {"asset": "BTC", "free": "0.00000000", "locked": "0.00000000"},
            ],
        }

    def close(self):
        self.closed = True


def live_settings(**overrides) -> Settings:
    return make_settings(live_trading_enabled=True, binance_env="testnet", **overrides)


def boot(client_factory, settings):
    app = create_app(settings)
    client = TestClient(app)
    client.__enter__()
    tokens = register(client, "live@example.com")
    headers = auth_headers(tokens)

    # Pretend we have a stored key so the credential lookup succeeds.
    with session_scope() as db:
        user = db.query(User).filter(User.email == "live@example.com").one()
        db.add(
            ApiCredential(
                user_id=user.id,
                label="fake",
                environment=settings.binance_env,
                api_key_ciphertext="v1:fake",
                secret_ciphertext="v1:fake",
                key_fingerprint="fakefingerprint",
                masked_key="fakeKEY",
                permissions={"enable_reading": True, "enable_spot_trading": True},
            )
        )
        db.commit()

    # Market data must look real for live orders to be allowed: wrap the
    # synthetic provider so the payload claims a live Binance source. Prices
    # stay deterministic, which is what we want in a test.
    real_ticker = app.state.market.ticker

    def live_ticker(symbol):
        row = dict(real_ticker(symbol))
        row["synthetic"] = False
        row["source"] = "binance"
        return row

    app.state.market.ticker = live_ticker
    app.state.market.is_synthetic = lambda: False
    app.state.credentials.client_for = lambda credential: client_factory()
    return app, client, headers


def opt_in(client, headers):
    policy = client.put(
        "/api/v1/risk/policy",
        headers=headers,
        json={
            "max_trade_notional": "5000",
            "max_daily_loss": "500",
            "max_risk_per_trade_pct": "5",
            "max_open_orders": "5",
        },
    )
    assert policy.status_code == 200, policy.text
    response = client.post(
        "/api/v1/risk/live-opt-in",
        headers=headers,
        json={"opt_in": True, "confirmation": "ENABLE LIVE TRADING", "acknowledge_risk": True},
    )
    assert response.status_code == 200, response.text


def payload(client, headers, **extra):
    price = client.get("/api/v1/market/ticker/BTCUSDT", headers=headers).json()["price"]
    body = {
        "symbol": "BTCUSDT",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": "0.001",
        "mode": "live",
        "approved": True,
        "stop_loss": str(round(price * 0.99, 2)),
        "idempotency_key": uuid.uuid4().hex,
    }
    body.update(extra)
    return body


def test_live_order_requires_manual_approval(client, user_headers):
    """The default test app has live trading disabled: a clear 403 is returned."""
    response = client.post(
        "/api/v1/orders",
        headers=user_headers,
        json={
            "symbol": "BTCUSDT",
            "side": "BUY",
            "order_type": "MARKET",
            "quantity": "0.001",
            "mode": "live",
            "approved": True,
            "stop_loss": "1",
            "idempotency_key": uuid.uuid4().hex,
        },
    )
    assert response.status_code == 403
    assert response.json()["error"]["details"]["code"] == "live_trading_disabled"


def test_confirmed_live_order_is_persisted_as_filled():
    fake = FakeBinanceClient(
        create_response={"orderId": 111, "status": "NEW", "executedQty": "0", "cummulativeQuoteQty": "0"},
        query_response={
            "orderId": 111,
            "status": "FILLED",
            "executedQty": "0.001",
            "cummulativeQuoteQty": "64.5",
            "fills": [{"commission": "0.0000645", "commissionAsset": "BTC"}],
        },
    )
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        opt_in(client, headers)
        response = client.post("/api/v1/orders", headers=headers, json=payload(client, headers))
        assert response.status_code == 201, response.text
        order = response.json()
        assert order["status"] == "FILLED"  # from the confirmation query, not the POST response
        assert order["mode"] == "live"
        assert order["exchange_order_id"] == "111"
        assert Decimal(order["fee_paid"]) > 0
        assert fake.created[0]["newClientOrderId"].startswith("rsai-")
        assert fake.queries and fake.queries[0]["client_order_id"] == fake.created[0]["newClientOrderId"]
        assert order["average_fill_price"] is not None
    finally:
        client.__exit__(None, None, None)


def test_ambiguous_submission_becomes_unknown_and_is_reconciled():
    fake = FakeBinanceClient(
        create_error=BinanceError("timeout", code=-1007, ambiguous=True),
        query_response={"orderId": 222, "status": "NEW", "executedQty": "0", "cummulativeQuoteQty": "0"},
    )
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        opt_in(client, headers)
        response = client.post("/api/v1/orders", headers=headers, json=payload(client, headers))
        # The order was accepted into the system even though the POST failed.
        assert response.status_code == 422
        details = response.json()["error"]["details"]
        assert details["ambiguous"] is True
        with session_scope() as db:
            from app.db.models import ExchangeOrder

            order = db.query(ExchangeOrder).one()
            assert order.status == OrderStatus.NEW  # reconciled by client order id
            assert order.exchange_order_id == "222"
        # Exactly one submission attempt: never resubmitted automatically.
        assert len(fake.created) == 1
    finally:
        client.__exit__(None, None, None)


def test_rejected_submission_is_not_reported_as_success():
    fake = FakeBinanceClient(
        create_error=BinanceError("Insufficient balance", code=-2010, http_status=400, ambiguous=False)
    )
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        opt_in(client, headers)
        response = client.post("/api/v1/orders", headers=headers, json=payload(client, headers))
        assert response.status_code == 422
        assert "-2010" in str(response.json()["error"]["details"]["exchange_code"])
        with session_scope() as db:
            from app.db.models import ExchangeOrder

            order = db.query(ExchangeOrder).one()
            assert order.status == OrderStatus.REJECTED
            assert "Insufficient balance" in (order.last_error or "")
    finally:
        client.__exit__(None, None, None)


def test_live_order_without_opt_in_is_refused():
    fake = FakeBinanceClient(create_response={"orderId": 1, "status": "FILLED"})
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        response = client.post("/api/v1/orders", headers=headers, json=payload(client, headers))
        assert response.status_code == 403
        assert response.json()["error"]["details"]["code"] == "live_opt_in_required"
        assert fake.created == []
    finally:
        client.__exit__(None, None, None)


def test_live_order_requires_approved_flag():
    fake = FakeBinanceClient(create_response={"orderId": 1, "status": "FILLED"})
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        opt_in(client, headers)
        response = client.post(
            "/api/v1/orders", headers=headers, json=payload(client, headers, approved=False)
        )
        assert response.status_code == 403
        assert response.json()["error"]["details"]["code"] == "manual_approval_required"
        assert fake.created == []
    finally:
        client.__exit__(None, None, None)


def test_cancel_live_order_calls_exchange():
    fake = FakeBinanceClient(
        create_response={"orderId": 333, "status": "NEW", "executedQty": "0", "cummulativeQuoteQty": "0"},
        query_response={"orderId": 333, "status": "NEW", "executedQty": "0", "cummulativeQuoteQty": "0"},
        cancel_response={"orderId": 333, "status": "CANCELED", "executedQty": "0", "cummulativeQuoteQty": "0"},
    )
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        opt_in(client, headers)
        price = client.get("/api/v1/market/ticker/BTCUSDT", headers=headers).json()["price"]
        body = payload(client, headers, order_type="LIMIT", price=str(round(price * 0.5, 2)))
        body["stop_loss"] = str(round(price * 0.4, 2))
        created = client.post("/api/v1/orders", headers=headers, json=body)
        assert created.status_code == 201, created.text
        cancelled = client.post(f"/api/v1/orders/{created.json()['id']}/cancel?mode=live", headers=headers)
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "CANCELED"
    finally:
        client.__exit__(None, None, None)


def test_reconcile_marks_missing_order_rejected():
    fake = FakeBinanceClient(
        create_error=BinanceError("timeout", code=-1007, ambiguous=True),
        query_response=BinanceError("Order does not exist.", code=-2013),
    )
    app, client, headers = boot(lambda: fake, live_settings())
    try:
        opt_in(client, headers)
        response = client.post("/api/v1/orders", headers=headers, json=payload(client, headers))
        assert response.status_code == 422
        with session_scope() as db:
            from app.db.models import ExchangeOrder

            order = db.query(ExchangeOrder).one()
            assert order.status == OrderStatus.UNKNOWN
        result = client.post("/api/v1/orders/reconcile", headers=headers)
        assert result.status_code == 200
        with session_scope() as db:
            from app.db.models import ExchangeOrder

            order = db.query(ExchangeOrder).one()
            assert order.status == OrderStatus.REJECTED
            assert "not found" in (order.last_error or "").lower()
    finally:
        client.__exit__(None, None, None)
