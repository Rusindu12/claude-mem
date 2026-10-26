"""Binance REST client: signing, error mapping, rate limits and order safety."""
from __future__ import annotations

import hashlib
import hmac
import time
import urllib.parse
from decimal import Decimal

import httpx
import pytest

from app.services.binance_client import (
    BinanceClient,
    BinanceError,
    SymbolFilters,
    parse_symbol_filters,
)

API_KEY = "test-api-key-000000000000000000000000"
API_SECRET = "test-api-secret-0000000000000000000000"


def make_client(handler, *, max_retries=2, sleep_calls=None):
    transport = httpx.MockTransport(handler)
    client = BinanceClient(
        base_url="https://testnet.binance.vision",
        api_key=API_KEY,
        api_secret=API_SECRET,
        max_retries=max_retries,
        transport=transport,
        sleep=(sleep_calls.append if sleep_calls is not None else (lambda _s: None)),
    )
    # Avoid a real /api/v3/time call in tests that don't care about clock sync.
    client.time_sync.checked_at = time.time()
    client.time_sync.offset_ms = 0
    return client


def test_timestamp_is_signed_with_hmac_sha256():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json={"balances": [], "canTrade": True})

    client = make_client(handler)
    client.account()

    query = urllib.parse.urlparse(captured["url"]).query
    params = dict(urllib.parse.parse_qsl(query))
    signature = params.pop("signature")
    assert "timestamp" in params and "recvWindow" in params
    expected = hmac.new(API_SECRET.encode(), urllib.parse.urlencode(sorted(params.items())).encode(), hashlib.sha256).hexdigest()
    assert signature == expected
    assert captured["headers"]["x-mbx-apikey"] == API_KEY


def test_server_time_sync_computes_offset():
    server_time = int(time.time() * 1000) + 5000

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/v3/time"
        return httpx.Response(200, json={"serverTime": server_time})

    client = make_client(handler)
    sync = client.sync_time()
    assert abs(sync.offset_ms - 5000) < 2000
    assert abs(client.timestamp_ms() - server_time) < 3000


def test_public_request_does_not_send_api_key():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = dict(request.headers)
        return httpx.Response(200, json=[{"symbol": "BTCUSDT", "lastPrice": "1"}])

    client = make_client(handler)
    client.klines("BTCUSDT", "1h", limit=10)
    assert "x-mbx-apikey" not in captured["headers"]


def test_error_payload_is_mapped():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"code": -1121, "msg": "Invalid symbol."})

    client = make_client(handler)
    with pytest.raises(BinanceError) as excinfo:
        client.klines("NOPEUSDT", "1h")
    error = excinfo.value
    assert error.code == -1121
    assert error.http_status == 400
    assert "Invalid symbol" in error.message
    assert not error.is_auth_error
    assert not error.retriable


def test_auth_errors_are_flagged():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"code": -2015, "msg": "Invalid API-key, IP, or permissions"})

    client = make_client(handler)
    with pytest.raises(BinanceError) as excinfo:
        client.account()
    assert excinfo.value.is_auth_error


def test_rate_limit_retries_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={"code": -1003, "msg": "Too many requests"}, headers={"Retry-After": "3"})
        return httpx.Response(200, json={"serverTime": 1})

    sleeps: list[float] = []
    client = make_client(handler, sleep_calls=sleeps)
    assert client.server_time() == 1
    assert calls["n"] == 2
    assert sleeps == [3.0]


def test_rate_limit_exhausts_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"code": -1003, "msg": "Too many requests"})

    sleeps: list[float] = []
    client = make_client(handler, max_retries=2, sleep_calls=sleeps)
    with pytest.raises(BinanceError) as excinfo:
        client.server_time()
    assert excinfo.value.is_rate_limited
    assert len(sleeps) == 1


def test_order_submission_is_not_retried_on_ambiguous_failure():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(503, json={"code": -1007, "msg": "Timeout waiting for response"})

    sleeps: list[float] = []
    client = make_client(handler, max_retries=3, sleep_calls=sleeps)
    with pytest.raises(BinanceError) as excinfo:
        client.create_order(symbol="BTCUSDT", side="BUY", type="MARKET", quantity="0.001", newClientOrderId="rsai-1")
    assert calls["n"] == 1  # never silently resubmitted
    assert excinfo.value.ambiguous is True


def test_idempotent_gets_are_retried_on_server_error():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(502, text="bad gateway")
        return httpx.Response(200, json={"balances": []})

    client = make_client(handler, max_retries=3)
    assert client.account() == {"balances": []}
    assert calls["n"] == 3


def test_signed_request_without_credentials_fails_fast():
    client = BinanceClient(base_url="https://example.invalid", transport=httpx.MockTransport(lambda r: httpx.Response(200)))
    with pytest.raises(BinanceError) as excinfo:
        client.account()
    assert "credentials" in str(excinfo.value).lower()


def test_rate_limit_headers_are_recorded():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"serverTime": 1},
            headers={"x-mbx-used-weight-1m": "1234", "x-mbx-order-count-10s": "5"},
        )

    client = make_client(handler)
    client.server_time()
    assert client.rate_limits.used_weight_1m == 1234
    assert client.rate_limits.order_count_10s == 5


def test_exchange_info_filters_are_parsed():
    info = {
        "symbols": [
            {
                "symbol": "BTCUSDT",
                "baseAsset": "BTC",
                "quoteAsset": "USDT",
                "status": "TRADING",
                "filters": [
                    {"filterType": "PRICE_FILTER", "tickSize": "0.01000000"},
                    {"filterType": "LOT_SIZE", "minQty": "0.00001000", "maxQty": "9000.00000000", "stepSize": "0.00001000"},
                    {"filterType": "NOTIONAL", "minNotional": "5.00000000"},
                    {"filterType": "MAX_NUM_ORDERS", "maxNumOrders": 200},
                ],
            }
        ]
    }
    filters = parse_symbol_filters(info)
    btc = filters["BTCUSDT"]
    assert btc.tick_size == Decimal("0.01")
    assert btc.step_size == Decimal("0.00001")
    assert btc.min_notional == Decimal("5")
    assert btc.max_num_orders == 200
    assert btc.quantity_decimals == 5
    assert btc.price_decimals == 2


def test_rounding_never_rounds_quantity_up():
    filters = SymbolFilters(
        symbol="BTCUSDT",
        base_asset="BTC",
        quote_asset="USDT",
        status="TRADING",
        min_qty=Decimal("0.00001"),
        max_qty=Decimal("9000"),
        step_size=Decimal("0.00001"),
        tick_size=Decimal("0.01"),
        min_notional=Decimal("5"),
    )
    assert filters.round_quantity(Decimal("0.000019")) == Decimal("0.00001")
    assert filters.round_price(Decimal("64000.006")) == Decimal("64000.01")


def test_user_data_stream_lifecycle_paths():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(f"{request.method} {request.url.path}")
        if request.method == "POST":
            return httpx.Response(200, json={"listenKey": "abc123"})
        return httpx.Response(200, json={})

    client = make_client(handler)
    assert client.create_listen_key() == "abc123"
    client.keepalive_listen_key("abc123")
    client.close_listen_key("abc123")
    assert seen == [
        "POST /api/v3/userDataStream",
        "PUT /api/v3/userDataStream",
        "DELETE /api/v3/userDataStream",
    ]
