"""Thin, testable Binance Spot REST client.

Implemented explicitly rather than via a third-party wrapper so that signing,
clock synchronisation, rate-limit handling and — most importantly — the
"we do not know whether this order was accepted" path are visible and testable.

Reference endpoints (Binance Spot API v3):
    GET  /api/v3/time
    GET  /api/v3/exchangeInfo
    GET  /api/v3/klines
    GET  /api/v3/ticker/24hr
    GET  /api/v3/ticker/price
    GET  /api/v3/depth
    GET  /api/v3/trades
    GET  /api/v3/account                      (SIGNED)
    POST /api/v3/order                        (SIGNED, TRADE)
    GET  /api/v3/order                        (SIGNED)
    DELETE /api/v3/order                      (SIGNED, TRADE)
    GET  /api/v3/openOrders                   (SIGNED)
    GET  /api/v3/allOrders                    (SIGNED)
    GET  /api/v3/myTrades                     (SIGNED)
    POST /api/v3/userDataStream               (SIGNED) -> listenKey
    PUT  /api/v3/userDataStream               (keepalive)
    DELETE /api/v3/userDataStream             (close)
    GET  /sapi/v1/account/apiRestrictions     (SIGNED) -> withdrawal flags

Testnet equivalents live under https://testnet.binance.vision. Endpoint paths
are identical; the base URL is selected by configuration, never hardcoded.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
import threading
import time
import urllib.parse
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

import httpx

log = logging.getLogger(__name__)

# Binance error codes that mean "the request may or may not have been applied".
AMBIGUOUS_ERROR_CODES = {-1007, -1006, -1001}  # timeout / unexpected response / disconnected


class BinanceError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: int | None = None,
        http_status: int | None = None,
        retry_after: float | None = None,
        ambiguous: bool = False,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.http_status = http_status
        self.retry_after = retry_after
        self.ambiguous = ambiguous

    def __str__(self) -> str:  # pragma: no cover - display only
        return f"BinanceError(code={self.code}, http={self.http_status}): {self.message}"

    @property
    def is_auth_error(self) -> bool:
        return self.code in {-2014, -2015, -1022, -1099} or self.http_status in (401, 403)

    @property
    def is_rate_limited(self) -> bool:
        return self.http_status in (418, 429) or self.code == -1003

    @property
    def retriable(self) -> bool:
        return self.is_rate_limited or (self.http_status or 0) >= 500 or self.code in AMBIGUOUS_ERROR_CODES


@dataclass
class RateLimitSnapshot:
    used_weight_1m: int | None = None
    order_count_10s: int | None = None
    order_count_1d: int | None = None
    updated_at: float = field(default_factory=time.time)


@dataclass
class TimeSync:
    offset_ms: int = 0
    checked_at: float = 0.0
    server_time_ms: int | None = None


class BinanceClient:
    """Synchronous client. Private calls require api_key/api_secret."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str | None = None,
        api_secret: str | None = None,
        recv_window_ms: int = 5000,
        timeout: float = 10.0,
        max_retries: int = 3,
        transport: httpx.BaseTransport | None = None,
        sleep=time.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._api_secret = api_secret
        self.recv_window_ms = recv_window_ms
        self.max_retries = max_retries
        self._sleep = sleep
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
            headers={"User-Agent": "RSAITrader/1.0"},
        )
        self.time_sync = TimeSync()
        self.rate_limits = RateLimitSnapshot()
        self._lock = threading.Lock()

    # -- lifecycle ---------------------------------------------------------
    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "BinanceClient":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    # -- clock -------------------------------------------------------------
    def sync_time(self) -> TimeSync:
        """Measure the offset between local and Binance time."""
        started = time.time()
        response = self._client.get("/api/v3/time")
        elapsed = (time.time() - started) / 2
        if response.status_code != 200:
            raise self._error_from_response(response)
        server_time = int(response.json()["serverTime"])
        local_ms = int((started + elapsed) * 1000)
        offset = server_time - local_ms
        self.time_sync = TimeSync(offset_ms=offset, checked_at=time.time(), server_time_ms=server_time)
        if abs(offset) > 1000:
            log.warning("clock offset vs Binance is %dms; signed requests will use server-aligned time", offset)
        return self.time_sync

    def timestamp_ms(self, *, refresh_if_stale: int = 300) -> int:
        now = time.time()
        if not self.time_sync.checked_at or now - self.time_sync.checked_at > refresh_if_stale:
            try:
                self.sync_time()
            except BinanceError as exc:  # keep trading blocked rather than guessing
                log.error("time sync failed: %s", exc.message)
                if not self.time_sync.checked_at:
                    raise
        return int(time.time() * 1000) + self.time_sync.offset_ms

    # -- request plumbing --------------------------------------------------
    def _record_limits(self, response: httpx.Response) -> None:
        headers = response.headers
        with self._lock:
            self.rate_limits = RateLimitSnapshot(
                used_weight_1m=_int_header(headers.get("x-mbx-used-weight-1m")),
                order_count_10s=_int_header(headers.get("x-mbx-order-count-10s")),
                order_count_1d=_int_header(headers.get("x-mbx-order-count-1d")),
                updated_at=time.time(),
            )

    def _error_from_response(self, response: httpx.Response) -> BinanceError:
        code = None
        message = f"HTTP {response.status_code}"
        try:
            body = response.json()
            code = body.get("code")
            message = body.get("msg", message)
        except Exception:
            text = (response.text or "").strip()
            if text:
                message = text[:300]
        retry_after = None
        if response.headers.get("retry-after"):
            try:
                retry_after = float(response.headers["retry-after"])
            except ValueError:
                retry_after = None
        return BinanceError(
            message,
            code=code,
            http_status=response.status_code,
            retry_after=retry_after,
            ambiguous=response.status_code in (502, 503, 504) or code in AMBIGUOUS_ERROR_CODES,
        )

    def _sleep_for(self, attempt: int, retry_after: float | None) -> None:
        delay = retry_after if retry_after else min(2**attempt, 8)
        log.warning("binance retry in %.1fs (attempt %d)", delay, attempt + 1)
        self._sleep(delay)

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        signed: bool = False,
        idempotent: bool = True,
    ) -> httpx.Response:
        params = {k: v for k, v in (params or {}).items() if v is not None}
        headers: dict[str, str] = {}
        if signed:
            if not self._api_key or not self._api_secret:
                raise BinanceError("API credentials are not configured for this operation")
            params["timestamp"] = self.timestamp_ms()
            params["recvWindow"] = self.recv_window_ms
            query = urllib.parse.urlencode(sorted(params.items()))
            signature = hmac.new(self._api_secret.encode(), query.encode(), hashlib.sha256).hexdigest()
            params["signature"] = signature
            headers["X-MBX-APIKEY"] = self._api_key

        last_error: BinanceError | None = None
        for attempt in range(self.max_retries):
            try:
                response = self._client.request(method, path, params=params, headers=headers)
            except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
                # Nothing was delivered: safe to retry for every call type.
                last_error = BinanceError(f"connection failed: {exc.__class__.__name__}", code=-1001, ambiguous=False)
                if attempt + 1 < self.max_retries:
                    self._sleep_for(attempt, None)
                    continue
                raise last_error from exc
            except httpx.ReadTimeout as exc:
                last_error = BinanceError("request timed out", code=-1007, ambiguous=not idempotent)
                if idempotent and attempt + 1 < self.max_retries:
                    self._sleep_for(attempt, None)
                    continue
                raise last_error from exc

            self._record_limits(response)
            if response.status_code >= 400:
                error = self._error_from_response(response)
                if error.is_rate_limited and attempt + 1 < self.max_retries:
                    last_error = error
                    self._sleep_for(attempt, error.retry_after)
                    continue
                if error.http_status and error.http_status >= 500 and idempotent and attempt + 1 < self.max_retries:
                    last_error = error
                    self._sleep_for(attempt, None)
                    continue
                raise error
            return response
        raise last_error or BinanceError("request failed without a specific error")

    def _get(self, path: str, params: dict[str, Any] | None = None, *, signed: bool = False) -> Any:
        response = self._request("GET", path, params=params, signed=signed)
        return response.json()

    # -- public market data ------------------------------------------------
    def server_time(self) -> int:
        return int(self._get("/api/v3/time")["serverTime"])

    def exchange_info(self, *, symbols: list[str] | None = None) -> dict[str, Any]:
        params = {"symbols": "[" + ",".join(f'"{s}"' for s in symbols) + "]"} if symbols else None
        return self._get("/api/v3/exchangeInfo", params)

    def klines(
        self,
        symbol: str,
        interval: str,
        *,
        limit: int = 500,
        start_time: int | None = None,
        end_time: int | None = None,
    ) -> list[list[Any]]:
        return self._get(
            "/api/v3/klines",
            {"symbol": symbol, "interval": interval, "limit": min(limit, 1000), "startTime": start_time, "endTime": end_time},
        )

    def ticker_24h(self, symbols: list[str] | None = None) -> Any:
        if symbols and len(symbols) == 1:
            return self._get("/api/v3/ticker/24hr", {"symbol": symbols[0]})
        params = {"symbols": "[" + ",".join(f'"{s}"' for s in symbols) + "]"} if symbols else None
        return self._get("/api/v3/ticker/24hr", params)

    def prices(self, symbols: list[str] | None = None) -> Any:
        params = {"symbols": "[" + ",".join(f'"{s}"' for s in symbols) + "]"} if symbols else None
        return self._get("/api/v3/ticker/price", params)

    def depth(self, symbol: str, limit: int = 20) -> dict[str, Any]:
        return self._get("/api/v3/depth", {"symbol": symbol, "limit": limit})

    def recent_trades(self, symbol: str, limit: int = 50) -> list[dict[str, Any]]:
        return self._get("/api/v3/trades", {"symbol": symbol, "limit": min(limit, 1000)})

    # -- signed account data ----------------------------------------------
    def account(self) -> dict[str, Any]:
        return self._get("/api/v3/account", signed=True)

    def api_restrictions(self) -> dict[str, Any]:
        """Withdrawal flags for the key. Used only to warn/refuse, never to enable withdrawals."""
        return self._get("/sapi/v1/account/apiRestrictions", signed=True)

    def open_orders(self, symbol: str | None = None) -> list[dict[str, Any]]:
        return self._get("/api/v3/openOrders", {"symbol": symbol}, signed=True)

    def all_orders(self, symbol: str, limit: int = 100) -> list[dict[str, Any]]:
        return self._get("/api/v3/allOrders", {"symbol": symbol, "limit": limit}, signed=True)

    def my_trades(self, symbol: str, limit: int = 100) -> list[dict[str, Any]]:
        return self._get("/api/v3/myTrades", {"symbol": symbol, "limit": limit}, signed=True)

    def query_order(self, symbol: str, *, order_id: str | None = None, client_order_id: str | None = None) -> dict[str, Any]:
        return self._get(
            "/api/v3/order",
            {"symbol": symbol, "orderId": order_id, "origClientOrderId": client_order_id},
            signed=True,
        )

    def create_order(self, **params: Any) -> dict[str, Any]:
        """Place an order.

        ``newClientOrderId`` should always be supplied by the caller: it makes
        the request idempotent and lets us reconcile an ambiguous response by
        querying the order instead of blindly resubmitting.
        """
        clean = {k: v for k, v in params.items() if v is not None}
        response = self._request("POST", "/api/v3/order", params=clean, signed=True, idempotent=False)
        return response.json()

    def cancel_order(self, symbol: str, *, order_id: str | None = None, client_order_id: str | None = None) -> dict[str, Any]:
        response = self._request(
            "DELETE",
            "/api/v3/order",
            params={"symbol": symbol, "orderId": order_id, "origClientOrderId": client_order_id},
            signed=True,
        )
        return response.json()

    # -- user data stream --------------------------------------------------
    def create_listen_key(self) -> str:
        return self._request("POST", "/api/v3/userDataStream", signed=True).json()["listenKey"]

    def keepalive_listen_key(self, listen_key: str) -> None:
        self._request("PUT", "/api/v3/userDataStream", params={"listenKey": listen_key}, signed=True)

    def close_listen_key(self, listen_key: str) -> None:
        self._request("DELETE", "/api/v3/userDataStream", params={"listenKey": listen_key}, signed=True)


def _int_header(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:  # pragma: no cover
        return None


# --------------------------------------------------------------------- filters
@dataclass(frozen=True)
class SymbolFilters:
    symbol: str
    base_asset: str
    quote_asset: str
    status: str
    min_qty: Decimal
    max_qty: Decimal
    step_size: Decimal
    tick_size: Decimal
    min_notional: Decimal
    max_num_orders: int | None = None
    quote_precision: int = 8

    def round_quantity(self, quantity: Decimal) -> Decimal:
        steps = (quantity / self.step_size).to_integral_value(rounding="ROUND_DOWN")
        return (steps * self.step_size).quantize(self.step_size)

    def round_price(self, price: Decimal) -> Decimal:
        ticks = (price / self.tick_size).to_integral_value(rounding="ROUND_HALF_UP")
        return (ticks * self.tick_size).quantize(self.tick_size)

    @property
    def quantity_decimals(self) -> int:
        return max(0, -self.step_size.normalize().as_tuple().exponent)

    @property
    def price_decimals(self) -> int:
        return max(0, -self.tick_size.normalize().as_tuple().exponent)

    def describe(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "base_asset": self.base_asset,
            "quote_asset": self.quote_asset,
            "status": self.status,
            "min_qty": str(self.min_qty),
            "max_qty": str(self.max_qty),
            "step_size": str(self.step_size),
            "tick_size": str(self.tick_size),
            "min_notional": str(self.min_notional),
            "max_num_orders": self.max_num_orders,
        }


def parse_symbol_filters(info: dict[str, Any]) -> dict[str, SymbolFilters]:
    """Parse ``/api/v3/exchangeInfo`` into strongly-typed filters.

    Binance moved notional limits into ``NOTIONAL`` / ``MIN_NOTIONAL`` filters;
    both spellings are accepted so the client keeps working across markets.
    """
    result: dict[str, SymbolFilters] = {}
    for entry in info.get("symbols", []):
        filters = {f["filterType"]: f for f in entry.get("filters", [])}
        price_filter = filters.get("PRICE_FILTER", {})
        lot = filters.get("LOT_SIZE", {})
        market_lot = filters.get("MARKET_LOT_SIZE", {})
        notional = filters.get("NOTIONAL") or filters.get("MIN_NOTIONAL") or {}
        try:
            result[entry["symbol"]] = SymbolFilters(
                symbol=entry["symbol"],
                base_asset=entry.get("baseAsset", ""),
                quote_asset=entry.get("quoteAsset", ""),
                status=entry.get("status", "UNKNOWN"),
                min_qty=Decimal(str(lot.get("minQty", "0"))),
                max_qty=Decimal(str(market_lot.get("maxQty") or lot.get("maxQty", "0"))),
                step_size=Decimal(str(lot.get("stepSize", "0.00000001"))) or Decimal("0.00000001"),
                tick_size=Decimal(str(price_filter.get("tickSize", "0.00000001"))) or Decimal("0.00000001"),
                min_notional=Decimal(str(notional.get("minNotional") or notional.get("notional", "0"))),
                max_num_orders=_safe_int(filters.get("MAX_NUM_ORDERS", {}).get("maxNumOrders")),
            )
        except Exception as exc:  # pragma: no cover - malformed exchange info
            log.warning("skipping %s: cannot parse filters (%s)", entry.get("symbol"), exc)
    return result


def _safe_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
