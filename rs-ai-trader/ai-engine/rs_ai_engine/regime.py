"""Market-regime and data-quality helpers.

Regime classification is deliberately simple and explainable. It is used to
contextualise signals (e.g. "range-bound, momentum strategies underperform"),
never to promise an outcome.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd

from . import indicators as ind


@dataclass(frozen=True)
class Regime:
    label: str  # trending_up | trending_down | ranging | high_volatility | unknown
    volatility_state: str  # low | normal | elevated | extreme
    trend_strength: float | None
    reasons: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def classify_regime(df: pd.DataFrame) -> Regime:
    if len(df) < 60:
        return Regime("unknown", "unknown", None, ["not enough history for regime classification"])
    adx_series = ind.adx(df)["adx"]
    adx_value = float(adx_series.iloc[-1]) if not np.isnan(adx_series.iloc[-1]) else None
    close = df["close"]
    ema_fast, ema_slow = ind.ema(close, 21).iloc[-1], ind.ema(close, 50).iloc[-1]
    atr_pct = float((ind.atr(df) / close).iloc[-1] * 100)
    atr_history = (ind.atr(df) / close).tail(120)
    percentile = float((atr_history.dropna() <= atr_history.iloc[-1]).mean()) if atr_history.notna().any() else None

    reasons: list[str] = []
    if percentile is None:
        volatility_state = "unknown"
    elif percentile >= 0.95:
        volatility_state = "extreme"
        reasons.append("volatility above the 95th percentile of the last 120 bars")
    elif percentile >= 0.8:
        volatility_state = "elevated"
        reasons.append("volatility above the 80th percentile of the last 120 bars")
    elif percentile <= 0.2:
        volatility_state = "low"
        reasons.append("volatility in the lowest quintile of the last 120 bars")
    else:
        volatility_state = "normal"

    trend_strength = adx_value
    if volatility_state == "extreme":
        label = "high_volatility"
        reasons.append("extreme volatility overrides trend classification")
    elif adx_value is not None and adx_value >= 25:
        if ema_fast > ema_slow:
            label = "trending_up"
            reasons.append(f"ADX {adx_value:.1f} with EMA21 above EMA50")
        else:
            label = "trending_down"
            reasons.append(f"ADX {adx_value:.1f} with EMA21 below EMA50")
    else:
        label = "ranging"
        reasons.append(f"ADX {adx_value:.1f} below the 25 trend threshold" if adx_value else "ADX unavailable")
    reasons.append(f"ATR is {atr_pct:.2f}% of price")
    return Regime(label, volatility_state, trend_strength, reasons)


@dataclass(frozen=True)
class DataQuality:
    bars: int
    expected_bars: int
    last_close_time: str | None
    age_seconds: float | None
    stale: bool
    gaps: int
    sufficient: bool
    issues: list[str]

    def to_dict(self) -> dict:
        return asdict(self)


def assess_data_quality(df: pd.DataFrame, timeframe_seconds: int, max_age_seconds: int) -> DataQuality:
    issues: list[str] = []
    bars = len(df)
    expected = max(1, int(max_age_seconds * 2 / max(timeframe_seconds, 1)))
    gaps = 0
    age: float | None = None
    last_close: str | None = None
    if isinstance(df.index, pd.DatetimeIndex) and bars >= 3:
        deltas = df.index.to_series().diff().dropna().dt.total_seconds()
        median = float(deltas.median()) or float(timeframe_seconds)
        gaps = int((deltas > median * 2.5).sum())
        last = df.index[-1]
        last_close = last.isoformat()
        age = max(0.0, (pd.Timestamp.now(tz=last.tz) - last).total_seconds())
        if age > max_age_seconds:
            issues.append(f"last candle is {age:.0f}s old (limit {max_age_seconds}s)")
        if gaps:
            issues.append(f"{gaps} missing-candle gaps detected")
    else:
        issues.append("insufficient bars to assess freshness")
    if bars < 60:
        issues.append(f"only {bars} bars available; indicators need at least 60")
    stale = age is None or age > max_age_seconds
    return DataQuality(
        bars=bars,
        expected_bars=max(expected, 60),
        last_close_time=last_close,
        age_seconds=age,
        stale=stale,
        gaps=gaps,
        sufficient=bars >= 60 and not stale,
        issues=issues,
    )
