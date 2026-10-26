"""Market data, signal and backtest endpoint tests (no network required)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

def test_tickers_are_labelled_as_synthetic(client, user_headers):
    response = client.get("/api/v1/market/tickers?symbols=BTCUSDT,ETHUSDT", headers=user_headers)
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 2
    for row in rows:
        assert row["synthetic"] is True
        assert row["source"] == "synthetic"
        assert row["price"] > 0
        assert row["age_seconds"] is not None


def test_unknown_symbol_returns_404(client, user_headers):
    response = client.get("/api/v1/market/ticker/DOGEUSDT", headers=user_headers)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_klines_are_closed_and_sorted(client, user_headers):
    response = client.get("/api/v1/market/klines/BTCUSDT?interval=1h&limit=120", headers=user_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["interval"] == "1h"
    assert len(body["klines"]) == 120
    times = [datetime.fromisoformat(k["time"]) for k in body["klines"]]
    assert times == sorted(times)
    interval = timedelta(hours=1)
    last = times[-1]
    assert last + interval <= datetime.now(timezone.utc) + timedelta(seconds=5)
    assert body["last_candle_close"] is not None


def test_unsupported_interval_rejected(client, user_headers):
    response = client.get("/api/v1/market/klines/BTCUSDT?interval=3m", headers=user_headers)
    assert response.status_code == 404


def test_depth_and_trades(client, user_headers):
    depth = client.get("/api/v1/market/depth/BTCUSDT", headers=user_headers)
    assert depth.status_code == 200
    body = depth.json()
    assert body["best_bid"] < body["best_ask"]
    assert body["spread_bps"] is not None
    trades = client.get("/api/v1/market/trades/BTCUSDT?limit=5", headers=user_headers)
    assert trades.status_code == 200 and len(trades.json()) == 5


def test_pairs_expose_exchange_filters(client, user_headers):
    response = client.get("/api/v1/market/pairs", headers=user_headers)
    assert response.status_code == 200
    symbols = {row["symbol"] for row in response.json()["symbols"]}
    assert "BTCUSDT" in symbols
    sample = next(row for row in response.json()["symbols"] if row["symbol"] == "BTCUSDT")
    assert sample["tick_size"] and sample["step_size"] and sample["min_notional"]


def test_overview_reports_connection_and_freshness(client, user_headers):
    response = client.get("/api/v1/market/overview", headers=user_headers)
    assert response.status_code == 200
    body = response.json()
    assert body["connection"]["status"] == "connected"
    assert body["connection"]["synthetic"] is True
    assert "oldest_age_seconds" in body["freshness"]


def test_market_endpoints_require_authentication(client):
    response = client.get("/api/v1/market/tickers")
    assert response.status_code == 401


def test_stale_data_marks_signal_hold(client, user_headers, app):
    """If the candle feed is old, the signal engine must refuse to signal."""
    service = app.state.signal_service
    from app.db.base import session_scope
    from sqlalchemy import select

    from app.db.models import User

    with session_scope() as db:
        user = db.scalar(select(User))
        result = service.market.klines("BTCUSDT", "1h", 300)
        frame = result.frame.copy()
        frame.index = frame.index - timedelta(days=2)
        from rs_ai_engine.signals import SignalConfig, generate_signal

        signal = generate_signal(
            frame,
            "BTCUSDT",
            config=SignalConfig(timeframe="1h", timeframe_seconds=3600, max_data_age_seconds=180),
        )
        assert signal.action == "HOLD"
        assert signal.model_status == "stale_market_data"
        assert any("stale" in r.lower() or "old" in r.lower() for r in signal.reasons)


def test_signal_endpoint_returns_full_contract(client, user_headers):
    response = client.get("/api/v1/signals/BTCUSDT?timeframe=1h", headers=user_headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["action"] in ("BUY", "SELL", "HOLD")
    for key in (
        "symbol",
        "timeframe",
        "generated_at",
        "reasons",
        "indicators",
        "model_version",
        "model_status",
        "probability_up",
        "data_quality",
        "regime",
        "score",
        "evidence_grade",
        "disclaimer",
    ):
        assert key in body
    # No model artefact exists -> no fabricated probability.
    assert body["model_status"] in ("not_loaded", "model_present_but_not_trusted", "insufficient_history_for_model")
    assert body["indicators"]["rsi_14"] is None or 0 <= body["indicators"]["rsi_14"] <= 100
    assert "stop-loss" in body["disclaimer"].lower() or "stop" in body["disclaimer"].lower()
    assert body["data_quality"]["bars"] > 0


def test_signal_is_persisted_and_listed(client, user_headers):
    client.get("/api/v1/signals/ETHUSDT?timeframe=1h", headers=user_headers)
    latest = client.get("/api/v1/signals/ETHUSDT/latest?timeframe=1h", headers=user_headers)
    assert latest.status_code == 200
    assert latest.json()["symbol"] == "ETHUSDT"
    history = client.get("/api/v1/signals/ETHUSDT/history", headers=user_headers)
    assert history.status_code == 200
    assert len(history.json()) >= 1


def test_model_report_is_honest_when_absent(client, user_headers):
    response = client.get("/api/v1/signals/BTCUSDT/model", headers=user_headers)
    assert response.status_code == 200
    body = response.json()
    if not body["available"]:
        assert "no validated model" in body["note"].lower()


def test_backtest_runs_and_labels_costs(client, user_headers):
    response = client.post(
        "/api/v1/signals/backtest",
        headers=user_headers,
        json={"symbol": "BTCUSDT", "timeframe": "1h", "days": 30, "initial_capital": 5000},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["metrics"]["initial_capital"] == 5000
    assert body["metrics"]["max_drawdown_pct"] <= 0
    assert body["assumptions"]
    assert any("fees and slippage" in line.lower() for line in body["assumptions"])
    assert body["buy_and_hold"]["return_pct"] is not None
    assert body["backtest_id"]

    history = client.get("/api/v1/signals/backtests/history", headers=user_headers)
    assert history.status_code == 200 and len(history.json()) >= 1


def test_backtest_rejects_insufficient_history(client, user_headers):
    response = client.post(
        "/api/v1/signals/backtest",
        headers=user_headers,
        json={"symbol": "BTCUSDT", "timeframe": "1m", "days": 5},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


def test_stream_requires_token(client):
    from starlette.websockets import WebSocketDisconnect

    with client.websocket_connect("/api/v1/stream/prices?symbols=BTCUSDT") as ws:
        message = ws.receive_json()
        assert message["status"] == "unauthenticated"
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()


def test_stream_pushes_ticker_frames(client, user_tokens):
    token = user_tokens["access_token"]
    with client.websocket_connect(f"/api/v1/stream/prices?symbols=BTCUSDT&token={token}") as ws:
        first = ws.receive_json()
        assert first["status"] == "connected"
        frame = ws.receive_json()
        assert frame["status"] in ("streaming", "degraded")
        assert frame["tickers"][0]["symbol"] == "BTCUSDT"
        assert frame["synthetic"] is True
