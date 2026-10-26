"""Bridge between the FastAPI backend and the ``rs_ai_engine`` research package.

The engine is imported defensively: if the ``ai-engine`` directory or its
scientific dependencies are missing, endpoints return a clear 503 instead of
crashing the process, and the rest of the app (market data, paper trading,
portfolio) keeps working.
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import ServiceUnavailableError, ValidationAppError
from ..db.models import BacktestRun, SignalRecord, User
from .market import MarketService

log = logging.getLogger(__name__)

_ENGINE = None
_ENGINE_ERROR: str | None = None


def load_engine():
    """Import ``rs_ai_engine`` once, adding the configured path to sys.path."""
    global _ENGINE, _ENGINE_ERROR
    if _ENGINE is not None or _ENGINE_ERROR is not None:
        return _ENGINE
    try:
        from ..core.config import get_settings

        engine_path = Path(get_settings().ai_engine_path).resolve()
        candidates = [engine_path, Path.cwd() / "ai-engine", Path(__file__).resolve().parents[3] / "ai-engine"]
        for path in candidates:
            if (path / "rs_ai_engine" / "__init__.py").exists():
                if str(path) not in sys.path:
                    sys.path.insert(0, str(path))
                break
        import rs_ai_engine  # type: ignore

        _ENGINE = rs_ai_engine
        return _ENGINE
    except Exception as exc:  # pragma: no cover - environment dependent
        _ENGINE_ERROR = f"{exc.__class__.__name__}: {exc}"
        log.error("AI engine unavailable: %s", _ENGINE_ERROR)
        return None


def engine_required():
    engine = load_engine()
    if engine is None:
        raise ServiceUnavailableError(
            "The analysis engine is unavailable on this server.",
            details={"reason": _ENGINE_ERROR, "hint": "install ai-engine requirements (pandas, numpy, scikit-learn)"},
        )
    return engine


def atr_percent(df: pd.DataFrame, period: int = 14) -> float | None:
    """ATR as a percentage of price — used for volatility warnings."""
    if len(df) < period + 2:
        return None
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat([high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1 / period, adjust=False, min_periods=period).mean().iloc[-1]
    last = float(close.iloc[-1])
    if not last or pd.isna(atr):
        return None
    return float(atr / last * 100)


class SignalService:
    def __init__(self, settings: Settings, market: MarketService) -> None:
        self.settings = settings
        self.market = market
        self._models: dict[tuple[str, str], Any] = {}
        self._models_checked: set[tuple[str, str]] = set()

    # ----------------------------------------------------------------- model
    def model_for(self, symbol: str, timeframe: str):
        engine = load_engine()
        if engine is None:
            return None
        key = (symbol, timeframe)
        if key in self._models_checked:
            return self._models.get(key)
        self._models_checked.add(key)
        artifacts = Path(self.settings.ai_artifacts_dir)
        for candidate in (
            artifacts / f"{symbol}_{timeframe}.joblib",
            artifacts / f"DEFAULT_{timeframe}.joblib",
        ):
            if candidate.exists():
                model = engine.load_model(candidate)
                if model is not None:
                    self._models[key] = model
                    log.info("loaded AI model %s for %s %s", candidate.name, symbol, timeframe)
                return model
        return None

    # ---------------------------------------------------------------- signals
    def generate(
        self,
        db: Session,
        *,
        symbol: str,
        timeframe: str,
        user: User | None = None,
        persist: bool = True,
    ) -> dict[str, Any]:
        engine = engine_required()
        symbol = symbol.upper()
        result = self.market.klines(symbol, timeframe)
        frame = result.frame
        if len(frame) < self.settings.ai_min_bars:
            raise ValidationAppError(
                f"Not enough closed candles for {symbol} {timeframe}: {len(frame)} available, "
                f"{self.settings.ai_min_bars} required.",
                details={"bars": len(frame), "required": self.settings.ai_min_bars},
            )
        try:
            filters = self.market.filters_for(symbol)
            tick_size = float(filters.tick_size)
        except Exception:
            tick_size = 0.0

        signal_config = engine.SignalConfig(
            timeframe=timeframe,
            timeframe_seconds=self._interval_seconds(timeframe),
            # A closed candle on a 1h timeframe is legitimately up to an hour old,
            # so the freshness budget is at least two bar durations.
            max_data_age_seconds=max(
                self.settings.market_stale_after_seconds, 2 * self._interval_seconds(timeframe)
            ),
        )
        signal = engine.generate_signal(
            frame,
            symbol,
            config=signal_config,
            model=self.model_for(symbol, timeframe),
            tick_size=tick_size,
        )
        payload = signal.to_dict()
        payload["data_source"] = result.source
        payload["bars_used"] = len(frame)
        payload["last_candle_close"] = result.last_close_time.isoformat()
        payload["data_age_seconds"] = round(result.age_seconds, 1)
        payload["synthetic"] = result.source != "binance"

        if persist:
            record = SignalRecord(
                user_id=user.id if user else None,
                symbol=symbol,
                timeframe=timeframe,
                action=payload["action"],
                score=payload.get("score"),
                model_version=payload.get("model_version"),
                model_status=payload.get("model_status"),
                payload=payload,
            )
            db.add(record)
            db.flush()
            payload["signal_id"] = record.id
        return payload

    def latest(self, db: Session, symbol: str, timeframe: str) -> dict[str, Any] | None:
        record = db.scalar(
            select(SignalRecord)
            .where(SignalRecord.symbol == symbol.upper(), SignalRecord.timeframe == timeframe)
            .order_by(SignalRecord.created_at.desc())
        )
        if record is None:
            return None
        payload = dict(record.payload or {})
        payload["signal_id"] = record.id
        payload["stored_at"] = record.created_at.isoformat()
        return payload

    def history(self, db: Session, symbol: str, timeframe: str, limit: int = 50) -> list[dict]:
        rows = db.scalars(
            select(SignalRecord)
            .where(SignalRecord.symbol == symbol.upper(), SignalRecord.timeframe == timeframe)
            .order_by(SignalRecord.created_at.desc())
            .limit(limit)
        ).all()
        return [
            {
                "id": r.id,
                "symbol": r.symbol,
                "timeframe": r.timeframe,
                "action": r.action,
                "score": float(r.score) if r.score is not None else None,
                "model_status": r.model_status,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ]

    def model_report(self, symbol: str, timeframe: str) -> dict[str, Any]:
        model = self.model_for(symbol, timeframe)
        if model is None:
            return {
                "available": False,
                "note": (
                    "No validated model artefact for this pair/timeframe. The engine is running in "
                    "rule-only mode and will not display a probability."
                ),
            }
        report = model.recent_performance()
        report["available"] = True
        return report

    @staticmethod
    def _interval_seconds(timeframe: str) -> int:
        mapping = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400}
        return mapping.get(timeframe, 3600)

    # --------------------------------------------------------------- backtest
    def backtest(
        self,
        db: Session,
        user: User,
        *,
        symbol: str,
        timeframe: str,
        days: int = 30,
        fee_bps: float | None = None,
        slippage_bps: float | None = None,
        position_fraction: float = 0.95,
        initial_capital: float = 10_000.0,
    ) -> dict[str, Any]:
        engine = engine_required()
        result = self.market.klines(symbol, timeframe, limit=1000)
        frame = result.frame
        needed = max(220, int(days * 86_400 / max(self._interval_seconds(timeframe), 1)))
        if len(frame) < needed:
            raise ValidationAppError(
                f"Only {len(frame)} bars are available; {needed} are needed for a {days}-day backtest on {timeframe}.",
                details={"bars": len(frame), "required": needed},
            )
        config = engine.BacktestConfig(
            initial_capital=initial_capital,
            fee_bps=fee_bps if fee_bps is not None else self.settings.default_taker_fee_bps,
            slippage_bps=slippage_bps if slippage_bps is not None else self.settings.default_slippage_bps,
            position_fraction=position_fraction,
            timeframe_seconds=self._interval_seconds(timeframe),
        )
        try:
            outcome = engine.run_backtest(frame, symbol.upper(), config=config)
        except ValueError as exc:
            raise ValidationAppError(str(exc)) from exc
        payload = outcome.to_dict()
        payload["data_source"] = result.source
        payload["generated_at"] = datetime.now(timezone.utc).isoformat()
        run = BacktestRun(
            user_id=user.id,
            symbol=symbol.upper(),
            timeframe=timeframe,
            status="completed",
            parameters={
                "days": days,
                "fee_bps": config.fee_bps,
                "slippage_bps": config.slippage_bps,
                "position_fraction": position_fraction,
                "initial_capital": initial_capital,
            },
            metrics=payload["metrics"],
            assumptions=payload["assumptions"],
        )
        db.add(run)
        db.flush()
        payload["backtest_id"] = run.id
        return payload
