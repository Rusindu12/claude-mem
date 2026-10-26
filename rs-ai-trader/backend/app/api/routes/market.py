from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query

from ...core.config import Settings, get_settings
from ...deps import get_current_user, get_market, rate_limit
from ...schemas.api import DepthResponse, KlineResponse, Ticker, TradeTick
from ...services.market import MarketService

# Market data requires a signed-in user: the APK never talks to Binance directly.
router = APIRouter(
    prefix="/market", tags=["market"], dependencies=[Depends(get_current_user)]
)


@router.get("/tickers", response_model=list[Ticker], dependencies=[Depends(rate_limit("market", 240))])
def tickers(
    symbols: str | None = Query(default=None, description="Comma separated, e.g. BTCUSDT,ETHUSDT"),
    market: MarketService = Depends(get_market),
) -> list[dict]:
    wanted = [s.strip().upper() for s in symbols.split(",")] if symbols else None
    return market.tickers(wanted)


@router.get("/ticker/{symbol}", response_model=Ticker, dependencies=[Depends(rate_limit("market", 240))])
def ticker(symbol: str, market: MarketService = Depends(get_market)) -> dict:
    return market.ticker(symbol)


@router.get(
    "/klines/{symbol}",
    response_model=KlineResponse,
    dependencies=[Depends(rate_limit("market", 180))],
)
def klines(
    symbol: str,
    interval: str = Query(default="1h"),
    limit: int = Query(default=300, ge=20, le=1000),
    market: MarketService = Depends(get_market),
    settings: Settings = Depends(get_settings),
) -> dict:
    result = market.klines(symbol, interval, limit)
    frame = result.frame
    return {
        "symbol": symbol.upper(),
        "interval": interval,
        "klines": [
            {
                "time": index.isoformat(),
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": float(row["volume"]),
            }
            for index, row in frame.iterrows()
        ],
        "source": result.source,
        "synthetic": result.source != "binance",
        "fetched_at": result.fetched_at.isoformat(),
        "last_candle_close": result.last_close_time.isoformat(),
        "age_seconds": round(result.age_seconds, 1),
        "stale": result.age_seconds > settings.market_stale_after_seconds,
    }


@router.get("/depth/{symbol}", response_model=DepthResponse, dependencies=[Depends(rate_limit("market", 180))])
def depth(
    symbol: str,
    limit: int = Query(default=20, ge=5, le=100),
    market: MarketService = Depends(get_market),
) -> dict:
    return market.depth(symbol, limit)


@router.get("/trades/{symbol}", response_model=list[TradeTick], dependencies=[Depends(rate_limit("market", 180))])
def trades(
    symbol: str,
    limit: int = Query(default=50, ge=1, le=200),
    market: MarketService = Depends(get_market),
) -> list[dict]:
    return market.recent_trades(symbol, limit)


@router.get("/pairs", dependencies=[Depends(rate_limit("market", 120))])
def pairs(
    market: MarketService = Depends(get_market),
    settings: Settings = Depends(get_settings),
) -> dict:
    filters = market.filters()
    return {
        "symbols": [
            {"symbol": symbol, "enabled": True, **flt.describe()}
            for symbol, flt in sorted(filters.items())
            if symbol in settings.symbol_list
        ],
        "timeframes": settings.timeframe_list,
        "source": market.provider.name,
        "synthetic": market.provider.is_synthetic,
    }


@router.get("/overview", dependencies=[Depends(rate_limit("market", 120))])
def overview(
    market: MarketService = Depends(get_market),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Single call powering the dashboard header, connection pill and freshness."""
    rows = market.tickers()
    return {
        "tickers": rows,
        "connection": {
            "status": "degraded" if market.degraded else "connected",
            "provider": market.provider.name,
            "synthetic": market.provider.is_synthetic or market.degraded,
            "degraded_reason": market.degraded_reason,
        },
        "freshness": {
            "stale_after_seconds": settings.market_stale_after_seconds,
            "oldest_age_seconds": max((r.get("age_seconds") or 0 for r in rows), default=None),
            "any_stale": any(r.get("stale") for r in rows),
        },
        "server_time": datetime.now(timezone.utc).isoformat(),
    }
