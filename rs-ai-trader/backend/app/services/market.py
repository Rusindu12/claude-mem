"""Market data service.

Responsibilities
----------------
* normalise Binance payloads into the shapes the app consumes;
* cache aggressively but report *real* freshness — the UI must be able to tell
  the user when data is stale;
* guarantee that analysis only sees **closed** candles;
* degrade loudly, not silently: synthetic data is only used when explicitly
  allowed by configuration, and every payload then says ``source="synthetic"``
  so the app renders a DEMO DATA badge.
"""
from __future__ import annotations

import hashlib
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Protocol

import numpy as np
import pandas as pd

from ..core.config import Settings, get_settings
from ..core.errors import NotFoundError, ServiceUnavailableError
from .binance_client import BinanceClient, BinanceError, SymbolFilters, parse_symbol_filters

log = logging.getLogger(__name__)

INTERVAL_MS: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}

# Plausible reference prices for offline/demo mode. Not live data.
SYNTHETIC_BASE_PRICES: dict[str, float] = {
    "BTCUSDT": 64_000.0,
    "ETHUSDT": 3_100.0,
    "BNBUSDT": 560.0,
    "SOLUSDT": 145.0,
    "XRPUSDT": 0.52,
    "ADAUSDT": 0.44,
    "DOGEUSDT": 0.13,
    "MATICUSDT": 0.72,
}


class MarketDataError(ServiceUnavailableError):
    code = "market_data_unavailable"


class JsonCache(Protocol):
    def get(self, key: str) -> dict | None: ...
    def set(self, key: str, value: dict, ttl: int) -> None: ...


class NullCache:
    def get(self, key: str) -> dict | None:
        return None

    def set(self, key: str, value: dict, ttl: int) -> None:
        return None


class RedisCache:
    def __init__(self, redis_client) -> None:
        self._redis = redis_client

    def get(self, key: str) -> dict | None:
        try:
            raw = self._redis.get(f"market:{key}")
            return json.loads(raw) if raw else None
        except Exception:  # pragma: no cover - cache must never break the request
            log.warning("redis cache read failed; continuing without cache")
            return None

    def set(self, key: str, value: dict, ttl: int) -> None:
        try:
            self._redis.setex(f"market:{key}", ttl, json.dumps(value, default=str))
        except Exception:  # pragma: no cover
            log.warning("redis cache write failed")


# --------------------------------------------------------------------- providers
class MarketProvider(Protocol):
    name: str
    is_synthetic: bool

    def klines(self, symbol: str, interval: str, limit: int) -> list[list[Any]]: ...
    def tickers(self, symbols: list[str]) -> list[dict[str, Any]]: ...
    def depth(self, symbol: str, limit: int) -> dict[str, Any]: ...
    def trades(self, symbol: str, limit: int) -> list[dict[str, Any]]: ...
    def filters(self) -> dict[str, SymbolFilters]: ...


class BinanceMarketProvider:
    """Public (unauthenticated) Binance market data."""

    name = "binance"
    is_synthetic = False

    def __init__(self, settings: Settings | None = None, client: BinanceClient | None = None) -> None:
        self.settings = settings or get_settings()
        self._client = client or BinanceClient(
            base_url=self.settings.binance_rest_base,
            timeout=self.settings.binance_timeout_seconds,
            max_retries=self.settings.binance_max_retries,
            recv_window_ms=self.settings.binance_recv_window_ms,
        )
        self._filters: dict[str, SymbolFilters] = {}
        self._filters_at = 0.0

    def klines(self, symbol: str, interval: str, limit: int) -> list[list[Any]]:
        return self._client.klines(symbol, interval, limit=limit)

    def tickers(self, symbols: list[str]) -> list[dict[str, Any]]:
        payload = self._client.ticker_24h(symbols)
        return payload if isinstance(payload, list) else [payload]

    def depth(self, symbol: str, limit: int) -> dict[str, Any]:
        return self._client.depth(symbol, limit=limit)

    def trades(self, symbol: str, limit: int) -> list[dict[str, Any]]:
        return self._client.recent_trades(symbol, limit=limit)

    def filters(self) -> dict[str, SymbolFilters]:
        if not self._filters or time.time() - self._filters_at > 3600:
            info = self._client.exchange_info()
            self._filters = parse_symbol_filters(info)
            self._filters_at = time.time()
        return self._filters


class SyntheticMarketProvider:
    """Deterministic offline provider for demos and tests.

    Every payload produced here is tagged ``synthetic`` and can never be used
    to place a live order (the risk engine refuses on synthetic data).
    """

    name = "synthetic"
    is_synthetic = True

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()

    # -- deterministic simulation anchored to absolute bar indices ---------
    def _series(self, symbol: str, interval: str, bars: int) -> pd.DataFrame:
        """Create a reproducible OHLCV window that ends at the last closed bar.

        Prices are a deterministic function of the *absolute* bar index, so the
        same historical timestamp always yields the same candle — charts, tests
        and cached signals stay consistent. This is simulated data and is always
        labelled ``synthetic``.
        """
        step = INTERVAL_MS[interval]
        now_ms = int(time.time() * 1000)
        last_closed = (now_ms // step) * step - 1
        anchor_ms = 1_704_067_200_000  # 2024-01-01T00:00:00Z
        end_index = (last_closed - anchor_ms) // step
        start_index = max(0, end_index - bars + 1)
        idx = np.arange(start_index, end_index + 1, dtype=np.float64)
        base = SYNTHETIC_BASE_PRICES.get(symbol, 100.0)
        seed = int(hashlib.sha256(f"{symbol}:{interval}".encode()).hexdigest()[:8], 16)
        rng = np.random.default_rng(seed)
        phase = rng.uniform(0, 2 * np.pi, 4)

        def hash_noise(values: np.ndarray, salt: float) -> np.ndarray:
            return (np.sin(values * 12.9898 + salt + phase[3]) * 43758.5453) % 1.0 - 0.5

        # Multi-scale cycles keep the series trending/ranging like a real market
        # while staying bounded around the reference price.
        cycles = (
            0.085 * np.sin(idx / 97.0 + phase[0])
            + 0.055 * np.sin(idx / 311.0 + phase[1])
            + 0.022 * np.sin(idx / 13.0 + phase[2])
        )
        wobble = hash_noise(idx, 0.0) * 0.011
        close = base * np.exp(cycles + wobble)
        prev_close = base * np.exp(
            np.concatenate([[cycles[0] - 0.0005], cycles[:-1]])
            + np.concatenate([[wobble[0]], wobble[:-1]])
        )
        open_ = prev_close
        spread = (np.abs(hash_noise(idx, 91.7)) * 0.008 + 0.0004)
        high = np.maximum(open_, close) * (1 + spread)
        low = np.minimum(open_, close) * (1 - spread)
        volume = (0.6 + np.abs(hash_noise(idx, 7.3)) * 4.0) * (1_500_000 / max(base, 1.0))
        open_time = anchor_ms + idx * step
        return pd.DataFrame(
            {
                "open_time": open_time.astype("int64"),
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "close_time": (open_time + step - 1).astype("int64"),
            }
        )

    def klines(self, symbol: str, interval: str, limit: int) -> list[list[Any]]:
        frame = self._series(symbol, interval, limit)
        return [
            [
                int(row.open_time),
                f"{row.open:.8f}",
                f"{row.high:.8f}",
                f"{row.low:.8f}",
                f"{row.close:.8f}",
                f"{row.volume:.8f}",
                int(row.close_time),
                "0",
                0,
                "0",
                "0",
                "0",
            ]
            for row in frame.itertuples()
        ]

    def tickers(self, symbols: list[str]) -> list[dict[str, Any]]:
        out = []
        for symbol in symbols:
            frame = self._series(symbol, "1h", 25)
            last, first = float(frame["close"].iloc[-1]), float(frame["close"].iloc[0])
            # Synthetic prices are "live" by construction; the payload is still
            # explicitly marked synthetic so nothing can be mistaken for real data.
            out.append(
                {
                    "symbol": symbol,
                    "lastPrice": f"{last:.8f}",
                    "priceChangePercent": f"{(last / first - 1) * 100:.3f}",
                    "highPrice": f"{frame['high'].max():.8f}",
                    "lowPrice": f"{frame['low'].min():.8f}",
                    "volume": f"{frame['volume'].sum():.3f}",
                    "quoteVolume": f"{frame['volume'].sum() * last:.3f}",
                    "closeTime": int(time.time() * 1000),
                }
            )
        return out

    def depth(self, symbol: str, limit: int) -> dict[str, Any]:
        frame = self._series(symbol, "1m", 5)
        price = float(frame["close"].iloc[-1])
        step = price * 0.0002
        bids = [[f"{price - step * (i + 1):.8f}", f"{1.5 + i * 0.4:.4f}"] for i in range(limit)]
        asks = [[f"{price + step * (i + 1):.8f}", f"{1.4 + i * 0.35:.4f}"] for i in range(limit)]
        return {"lastUpdateId": int(time.time() * 1000), "bids": bids, "asks": asks}

    def trades(self, symbol: str, limit: int) -> list[dict[str, Any]]:
        frame = self._series(symbol, "1m", 3)
        price = float(frame["close"].iloc[-1])
        now = int(time.time() * 1000)
        return [
            {
                "id": now - i,
                "price": f"{price * (1 + (i % 5 - 2) * 0.0001):.8f}",
                "qty": f"{0.01 + (i % 7) * 0.003:.6f}",
                "quoteQty": f"{(0.01 + (i % 7) * 0.003) * price:.6f}",
                "time": now - i * 1500,
                "isBuyerMaker": bool(i % 2),
            }
            for i in range(limit)
        ]

    def filters(self) -> dict[str, SymbolFilters]:
        out: dict[str, SymbolFilters] = {}
        for symbol in self.settings.symbol_list:
            base = symbol[:-4] if symbol.endswith("USDT") else symbol[:3]
            price = SYNTHETIC_BASE_PRICES.get(symbol, 100.0)
            tick = Decimal("0.01") if price > 100 else Decimal("0.0001")
            out[symbol] = SymbolFilters(
                symbol=symbol,
                base_asset=base,
                quote_asset="USDT",
                status="TRADING",
                min_qty=Decimal("0.00001"),
                max_qty=Decimal("9000"),
                step_size=Decimal("0.00001"),
                tick_size=tick,
                min_notional=Decimal("5"),
                max_num_orders=200,
            )
        return out


# ---------------------------------------------------------------------- service
@dataclass
class KlineResult:
    frame: pd.DataFrame
    source: str
    fetched_at: datetime
    last_close_time: datetime

    @property
    def age_seconds(self) -> float:
        return max(0.0, (datetime.now(timezone.utc) - self.last_close_time).total_seconds())


class MarketService:
    def __init__(
        self,
        provider: MarketProvider,
        settings: Settings | None = None,
        *,
        cache: JsonCache | None = None,
        fallback_provider: MarketProvider | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.provider = provider
        self.fallback_provider = fallback_provider
        self.cache = cache or NullCache()
        self._ticker_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._kline_cache: dict[tuple[str, str, int], tuple[float, KlineResult]] = {}
        self._degraded = False
        self._degraded_reason: str | None = None
        self._last_error: str | None = None

    # -- diagnostics -------------------------------------------------------
    @property
    def degraded(self) -> bool:
        return self._degraded

    @property
    def degraded_reason(self) -> str | None:
        return self._degraded_reason

    def health(self) -> dict[str, Any]:
        return {
            "provider": self.provider.name,
            "synthetic": self.provider.is_synthetic,
            "degraded": self._degraded,
            "degraded_reason": self._degraded_reason,
            "last_error": self._last_error,
            "market_stale_after_seconds": self.settings.market_stale_after_seconds,
        }

    def _call(self, operation: str, *args: Any) -> Any:
        try:
            result = getattr(self.provider, operation)(*args)
            self._degraded = False
            self._degraded_reason = None
            return result, self.provider
        except (BinanceError, MarketDataError) as exc:
            self._last_error = str(exc)
            if self.fallback_provider is None:
                log.error("market data failure (%s): %s", operation, exc)
                raise MarketDataError(
                    "Live market data is temporarily unavailable. The app will keep retrying.",
                    details={"operation": operation, "reason": getattr(exc, "message", str(exc))},
                ) from exc
            self._degraded = True
            self._degraded_reason = getattr(exc, "message", str(exc))
            log.warning("market data degraded to synthetic fallback: %s", self._degraded_reason)
            return getattr(self.fallback_provider, operation)(*args), self.fallback_provider

    def _ensure_symbol(self, symbol: str) -> str:
        symbol = symbol.upper()
        if symbol not in self.settings.symbol_list:
            raise NotFoundError(
                f"{symbol} is not an enabled trading pair.", details={"enabled": self.settings.symbol_list}
            )
        return symbol

    def _ensure_interval(self, interval: str) -> str:
        if interval not in self.settings.timeframe_list:
            raise NotFoundError(
                f"Interval {interval} is not supported.", details={"supported": self.settings.timeframe_list}
            )
        return interval

    # -- tickers -----------------------------------------------------------
    def tickers(self, symbols: list[str] | None = None) -> list[dict[str, Any]]:
        symbols = [self._ensure_symbol(s) for s in (symbols or self.settings.symbol_list)]
        now = time.time()
        missing = [s for s in symbols if s not in self._ticker_cache or now - self._ticker_cache[s][0] > 2]
        if missing:
            rows, provider = self._call("tickers", symbols)
            fetched = datetime.now(timezone.utc)
            for row in rows:
                symbol = row.get("symbol")
                if not symbol:
                    continue
                self._ticker_cache[symbol] = (
                    now,
                    self._normalise_ticker(row, provider, fetched),
                )
        return [self._ticker_cache[s][1] for s in symbols if s in self._ticker_cache]

    def ticker(self, symbol: str) -> dict[str, Any]:
        symbol = self._ensure_symbol(symbol)
        rows = self.tickers([symbol])
        if not rows:
            raise MarketDataError(f"No ticker available for {symbol}")
        return rows[0]

    def _normalise_ticker(self, row: dict[str, Any], provider: MarketProvider, fetched: datetime) -> dict[str, Any]:
        price = float(row.get("lastPrice", 0) or 0)
        close_time = row.get("closeTime")
        age = None
        if isinstance(close_time, (int, float)) and close_time > 0:
            age = max(0.0, (datetime.now(timezone.utc).timestamp() * 1000 - close_time) / 1000)
        return {
            "symbol": row.get("symbol"),
            "price": price,
            "change_percent_24h": float(row.get("priceChangePercent", 0) or 0),
            "high_24h": float(row.get("highPrice", 0) or 0),
            "low_24h": float(row.get("lowPrice", 0) or 0),
            "volume_24h": float(row.get("volume", 0) or 0),
            "quote_volume_24h": float(row.get("quoteVolume", 0) or 0),
            "fetched_at": fetched.isoformat(),
            "exchange_close_time": (
                datetime.fromtimestamp(close_time / 1000, tz=timezone.utc).isoformat() if close_time else None
            ),
            "age_seconds": age,
            "source": provider.name,
            "synthetic": provider.is_synthetic,
            "stale": age is not None and age > self.settings.market_stale_after_seconds,
        }

    # -- klines ------------------------------------------------------------
    def klines(self, symbol: str, interval: str, limit: int | None = None) -> KlineResult:
        symbol = self._ensure_symbol(symbol)
        interval = self._ensure_interval(interval)
        limit = limit or self.settings.kline_history_limit
        key = (symbol, interval, limit)
        now = time.time()
        cached = self._kline_cache.get(key)
        if cached and now - cached[0] < self.settings.market_cache_ttl_seconds:
            return cached[1]
        rows, provider = self._call("klines", symbol, interval, limit)
        frame = self._rows_to_frame(rows)
        # Drop the still-forming candle: decisions must use closed bars only.
        step = INTERVAL_MS[interval]
        now_ms = int(now * 1000)
        last_open = int(frame["open_time"].iloc[-1]) if len(frame) else 0
        if len(frame) and last_open + step > now_ms:
            frame = frame.iloc[:-1]
        if frame.empty:
            raise MarketDataError(f"No closed candles available for {symbol} {interval}")
        result = KlineResult(
            frame=frame.set_index("time")[["open", "high", "low", "close", "volume"]],
            source=provider.name,
            fetched_at=datetime.now(timezone.utc),
            last_close_time=frame["time"].iloc[-1].to_pydatetime(),
        )
        self._kline_cache[key] = (now, result)
        return result

    @staticmethod
    def _rows_to_frame(rows: list[list[Any]]) -> pd.DataFrame:
        frame = pd.DataFrame(
            [
                {
                    "open_time": int(r[0]),
                    "open": float(r[1]),
                    "high": float(r[2]),
                    "low": float(r[3]),
                    "close": float(r[4]),
                    "volume": float(r[5]),
                }
                for r in rows
            ]
        )
        frame["time"] = pd.to_datetime(frame["open_time"], unit="ms", utc=True)
        return frame

    # -- order book / trades ----------------------------------------------
    def depth(self, symbol: str, limit: int = 20) -> dict[str, Any]:
        symbol = self._ensure_symbol(symbol)
        payload, provider = self._call("depth", symbol, limit)
        bids = [[float(p), float(q)] for p, q in payload.get("bids", [])]
        asks = [[float(p), float(q)] for p, q in payload.get("asks", [])]
        best_bid = bids[0][0] if bids else None
        best_ask = asks[0][0] if asks else None
        mid = (best_bid + best_ask) / 2 if best_bid and best_ask else None
        spread_bps = ((best_ask - best_bid) / mid * 10_000) if mid and best_ask and best_bid else None
        bid_volume = sum(q for _, q in bids)
        ask_volume = sum(q for _, q in asks)
        return {
            "symbol": symbol,
            "bids": bids,
            "asks": asks,
            "best_bid": best_bid,
            "best_ask": best_ask,
            "spread_bps": spread_bps,
            "imbalance": (bid_volume - ask_volume) / (bid_volume + ask_volume)
            if (bid_volume + ask_volume)
            else None,
            "source": provider.name,
            "synthetic": provider.is_synthetic,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

    def recent_trades(self, symbol: str, limit: int = 50) -> list[dict[str, Any]]:
        symbol = self._ensure_symbol(symbol)
        rows, provider = self._call("trades", symbol, limit)
        return [
            {
                "id": row.get("id"),
                "price": float(row.get("price", 0)),
                "quantity": float(row.get("qty", 0)),
                "time": datetime.fromtimestamp(int(row["time"]) / 1000, tz=timezone.utc).isoformat(),
                "buyer_is_maker": bool(row.get("isBuyerMaker")),
                "source": provider.name,
            }
            for row in rows
        ]

    # -- filters -----------------------------------------------------------
    def filters(self, refresh: bool = False) -> dict[str, SymbolFilters]:
        payload, _provider = self._call("filters")
        return payload

    def filters_for(self, symbol: str) -> SymbolFilters:
        symbol = self._ensure_symbol(symbol)
        all_filters = self.filters()
        if symbol not in all_filters:
            raise NotFoundError(f"Exchange filters are unavailable for {symbol}.")
        return all_filters[symbol]

    def is_synthetic(self) -> bool:
        return self.provider.is_synthetic or self._degraded


def build_market_service(settings: Settings | None = None, *, redis_client=None) -> MarketService:
    settings = settings or get_settings()
    cache: JsonCache = RedisCache(redis_client) if redis_client is not None else NullCache()
    if settings.market_data_mode == "synthetic":
        return MarketService(SyntheticMarketProvider(settings), settings, cache=cache)
    provider = BinanceMarketProvider(settings)
    fallback = SyntheticMarketProvider(settings) if settings.allow_synthetic_fallback else None
    return MarketService(provider, settings, cache=cache, fallback_provider=fallback)
