"""Train and persist a calibrated signal model from cached OHLCV data.

Usage (from the ai-engine directory):

    python scripts/train_model.py --symbol BTCUSDT --timeframe 1h --days 730

The script pulls public klines through the *backend's* Binance client so there
is a single implementation of signing/retry/rate-limit handling. It writes:

    ai-engine/artifacts/<SYMBOL>_<timeframe>.joblib
    ai-engine/artifacts/<SYMBOL>_<timeframe>.json   (honest metrics)

It refuses to overwrite an artefact whose out-of-sample metrics regress.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT.parent / "backend"))

from rs_ai_engine.calibration import load_model, train_model  # noqa: E402
from rs_ai_engine.features import build_features  # noqa: E402

TIMEFRAME_MINUTES = {"1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440}


def klines_from_binance(symbol: str, timeframe: str, days: int) -> pd.DataFrame:
    """Pull public klines using the backend market service (no credentials)."""
    from app.services.market import BinanceMarketClient

    limit = 1000
    need = max(300, int(days * 24 * 60 / TIMEFRAME_MINUTES[timeframe]) + 250)
    client = BinanceMarketClient()
    rows: list[list] = []
    end_time: int | None = None
    try:
        while len(rows) < need:
            batch = client.klines(symbol, timeframe, limit=limit, end_time=end_time)
            if not batch:
                break
            batch = [r for r in batch if r[0] < (end_time or 10**14)]
            rows.extend(batch)
            if len(batch) < limit:
                break
            end_time = int(batch[0][0])
    finally:
        client.close()
    if not rows:
        raise SystemExit("no klines returned; check network access to api.binance.com")
    frame = pd.DataFrame(
        {
            "open_time": [int(r[0]) for r in rows],
            "open": [float(r[1]) for r in rows],
            "high": [float(r[2]) for r in rows],
            "low": [float(r[3]) for r in rows],
            "close": [float(r[4]) for r in rows],
            "volume": [float(r[5]) for r in rows],
            "close_time": [int(r[6]) for r in rows],
        }
    ).drop_duplicates("open_time").sort_values("open_time")
    frame["time"] = pd.to_datetime(frame["close_time"], unit="ms", utc=True)
    return frame.set_index("time")[["open", "high", "low", "close", "volume"]]


def synthetic_klines(bars: int = 3000, seed: int = 7) -> pd.DataFrame:
    """Offline fallback so the training pipeline can be smoke-tested."""
    import numpy as np

    rng = np.random.default_rng(seed)
    returns = rng.normal(0.0002, 0.012, bars)
    close = 30_000 * np.exp(np.cumsum(returns))
    high = close * (1 + np.abs(rng.normal(0, 0.004, bars)))
    low = close * (1 - np.abs(rng.normal(0, 0.004, bars)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    volume = rng.lognormal(3, 0.5, bars)
    idx = pd.date_range(end=pd.Timestamp.now(tz="UTC").floor("h"), periods=bars, freq="h")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--timeframe", default="1h", choices=sorted(TIMEFRAME_MINUTES))
    parser.add_argument("--days", type=int, default=730)
    parser.add_argument("--horizon", type=int, default=3)
    parser.add_argument("--cost-bps", type=float, default=20.0)
    parser.add_argument("--offline", action="store_true", help="use synthetic data (pipeline smoke test)")
    parser.add_argument("--out", default=str(ROOT / "artifacts"))
    args = parser.parse_args()

    frame = synthetic_klines() if args.offline else klines_from_binance(args.symbol, args.timeframe, args.days)
    print(f"bars: {len(frame)}  range: {frame.index[0]} -> {frame.index[-1]}")

    features = build_features(frame, horizon=args.horizon, cost_bps=args.cost_bps)
    try:
        model = train_model(
            features,
            horizon=args.horizon,
            cost_bps=args.cost_bps,
            symbol_scope=args.symbol,
            timeframe=args.timeframe,
        )
    except ValueError as exc:
        print(f"training aborted: {exc}")
        return 2

    out_dir = Path(args.out)
    path = out_dir / f"{args.symbol}_{args.timeframe}.joblib"
    previous = load_model(path)
    if previous is not None and previous.metrics.long.trusted and not model.metrics.long.trusted:
        print("refusing to overwrite a trusted artefact with a weaker one")
        return 3
    model.save(path)
    print(json.dumps(model.recent_performance(), indent=2))
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
