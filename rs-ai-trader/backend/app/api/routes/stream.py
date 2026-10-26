"""Realtime price stream for the Android client (WebSocket, JSON frames).

Frames are tiny snapshots; the client reconnects with exponential backoff and
shows a connection pill driven by the ``status`` field. Market calls are made
in a threadpool because the Binance client is synchronous.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool

from ...core.security import TokenError, decode_token

log = logging.getLogger(__name__)
router = APIRouter(tags=["stream"])

MAX_SYMBOLS = 8
SNAPSHOT_INTERVAL_SECONDS = 2.0


@router.websocket("/stream/prices")
async def price_stream(
    websocket: WebSocket,
    symbols: str = Query(default="BTCUSDT"),
    token: str | None = Query(default=None, description="Access token (query param for WS clients)"),
) -> None:
    settings = websocket.app.state.settings
    market = websocket.app.state.market
    await websocket.accept()

    credentials_token = token
    if credentials_token is None:
        header = websocket.headers.get("authorization", "")
        if header.lower().startswith("bearer "):
            credentials_token = header.split(" ", 1)[1]
    if not credentials_token:
        await websocket.send_json({"status": "unauthenticated", "message": "Access token required."})
        await websocket.close(code=4401)
        return
    try:
        decode_token(credentials_token, settings, expected_type="access")
    except TokenError as exc:
        await websocket.send_json({"status": "unauthenticated", "message": str(exc)})
        await websocket.close(code=4401)
        return

    wanted = [s.strip().upper() for s in symbols.split(",") if s.strip()][:MAX_SYMBOLS]
    if not wanted:
        await websocket.send_json({"status": "error", "message": "Provide at least one symbol."})
        await websocket.close(code=4400)
        return

    try:
        await websocket.send_json(
            {
                "status": "connected",
                "symbols": wanted,
                "interval_seconds": SNAPSHOT_INTERVAL_SECONDS,
                "server_time": datetime.now(timezone.utc).isoformat(),
            }
        )
        while True:
            try:
                tickers = await run_in_threadpool(market.tickers, wanted)
                await websocket.send_json(
                    {
                        "status": "degraded" if market.degraded else "streaming",
                        "tickers": tickers,
                        "source": market.provider.name,
                        "synthetic": market.provider.is_synthetic or market.degraded,
                        "stale_after_seconds": settings.market_stale_after_seconds,
                        "server_time": datetime.now(timezone.utc).isoformat(),
                    }
                )
            except Exception as exc:  # noqa: BLE001 - keep the socket alive with a status frame
                log.warning("price stream tick failed: %s", exc)
                await websocket.send_json(
                    {
                        "status": "error",
                        "message": "Market data is temporarily unavailable. Retrying…",
                        "server_time": datetime.now(timezone.utc).isoformat(),
                    }
                )
            await asyncio.sleep(SNAPSHOT_INTERVAL_SECONDS)
    except WebSocketDisconnect:
        log.info("price stream client disconnected")
    except Exception as exc:  # pragma: no cover - transport level
        log.info("price stream closed: %s", exc)
