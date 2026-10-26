"""Optional PostgreSQL integration test.

The regular suite runs on SQLite for speed and isolation. This module exercises
the same API against a real PostgreSQL server so that JSON columns, timezone
aware timestamps and numeric round-trips are verified against the production
database engine.

Enable it by pointing ``RSAI_TEST_DATABASE_URL`` at a throwaway database, e.g.:

    createdb rsai_test
    RSAI_TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost/rsai_test" \
        python -m pytest tests/test_postgres_integration.py -v

It is skipped automatically when the variable is absent, so CI without a
database still passes.
"""
from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.config import reset_settings_cache
from app.db.base import Base, build_engine
from app.main import create_app

PG_URL = os.environ.get("RSAI_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not PG_URL,
    reason="RSAI_TEST_DATABASE_URL not set; PostgreSQL integration test skipped",
)


def _prepare_schema(settings):
    engine = build_engine(settings)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    engine.dispose()


@pytest.fixture()
def pg_client():
    reset_settings_cache()
    from conftest import make_settings

    settings = make_settings(
        database_url=PG_URL,
        environment="test",
        market_data_mode="synthetic",
        live_trading_enabled=False,
    )
    _prepare_schema(settings)
    app = create_app(settings)
    with TestClient(app) as client:
        yield client
    engine = build_engine(settings)
    Base.metadata.drop_all(engine)
    engine.dispose()


def _register(client: TestClient) -> dict[str, str]:
    email = f"pg-{uuid.uuid4().hex[:10]}@example.com"
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": "Str0ng-Passw0rd!42", "display_name": "PG", "language": "en"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_full_flow_on_postgres(pg_client: TestClient) -> None:
    headers = _register(pg_client)

    me = pg_client.get("/api/v1/auth/me", headers=headers)
    assert me.status_code == 200

    ticker = pg_client.get("/api/v1/market/ticker/BTCUSDT", headers=headers)
    assert ticker.status_code == 200, ticker.text
    price = Decimal(str(ticker.json()["price"]))
    assert price > 0

    # 20 USDT notional, stop-loss below and take-profit above the market.
    quantity = (Decimal("20") / price).quantize(Decimal("0.00001"))
    payload = {
        "symbol": "BTCUSDT",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": str(quantity),
        "stop_loss": str((price * Decimal("0.95")).quantize(Decimal("0.01"))),
        "take_profit": str((price * Decimal("1.05")).quantize(Decimal("0.01"))),
        "mode": "paper",
        "idempotency_key": f"pg-{uuid.uuid4()}",
    }

    preview = pg_client.post("/api/v1/orders/preview", json=payload, headers=headers)
    assert preview.status_code == 200, preview.text
    assert preview.json()["can_place"] is True, preview.json()

    placed = pg_client.post("/api/v1/orders", json={**payload, "approved": True}, headers=headers)
    assert placed.status_code == 201, placed.text
    order = placed.json()
    assert order["status"] in {"FILLED", "PARTIALLY_FILLED", "NEW"}, order

    # Idempotent replay must not create a second order.
    replay = pg_client.post("/api/v1/orders", json={**payload, "approved": True}, headers=headers)
    assert replay.status_code in {200, 201}
    assert replay.json()["id"] == order["id"]

    orders = pg_client.get("/api/v1/orders", params={"mode": "paper"}, headers=headers).json()
    assert len([o for o in orders if o["id"] == order["id"]]) == 1

    portfolio = pg_client.get("/api/v1/portfolio", params={"mode": "paper"}, headers=headers)
    assert portfolio.status_code == 200, portfolio.text
    body = portfolio.json()
    assert body["simulated"] is True
    assert Decimal(str(body["total_value_usdt"])) >= 0

    analytics = pg_client.get("/api/v1/portfolio/analytics", params={"mode": "paper", "days": 30}, headers=headers)
    assert analytics.status_code == 200, analytics.text
    assert analytics.json()["mode"] == "paper"

    alert = pg_client.post(
        "/api/v1/alerts",
        json={"symbol": "BTCUSDT", "condition": "price_above", "target_price": str(price * Decimal("1.5"))},
        headers=headers,
    )
    assert alert.status_code == 201, alert.text
    assert pg_client.get("/api/v1/alerts", headers=headers).status_code == 200

    signal = pg_client.get("/api/v1/signals/BTCUSDT", params={"timeframe": "1h"}, headers=headers)
    assert signal.status_code == 200, signal.text
    assert signal.json()["action"] in {"BUY", "SELL", "HOLD"}

    risk = pg_client.get("/api/v1/risk/status", headers=headers)
    assert risk.status_code == 200
    assert risk.json()["can_trade_live"] is False  # live trading disabled on this server

    assistant = pg_client.post(
        "/api/v1/assistant/ask",
        json={"question": "Explain RSI simply", "lang": "en", "include_portfolio": True},
        headers=headers,
    )
    assert assistant.status_code == 200, assistant.text
    assert assistant.json()["answer"]

    audit = pg_client.get("/api/v1/notifications", headers=headers)
    assert audit.status_code == 200
