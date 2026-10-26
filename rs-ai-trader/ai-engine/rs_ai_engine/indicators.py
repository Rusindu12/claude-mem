"""Technical indicators for RS AI TRADER.

All functions are pure, vectorised and free of look-ahead: the value at
position ``t`` only depends on bars ``0..t``. Tests in
``ai-engine/tests/test_indicators.py`` enforce this property.

Prices passed in are the *closed* candle series. A trailing, still-forming
candle must never be included (the market service drops it).
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ("open", "high", "low", "close", "volume")


class InsufficientDataError(ValueError):
    """Raised when a series is too short for a requested indicator."""


def _validate(df: pd.DataFrame, minimum: int = 1) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"missing OHLCV columns: {missing}")
    if len(df) < minimum:
        raise InsufficientDataError(f"needs at least {minimum} bars, got {len(df)}")


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def ema(series: pd.Series, period: int) -> pd.Series:
    return series.ewm(span=period, adjust=False, min_periods=period).mean()


def rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    # Wilder smoothing == EMA with alpha = 1/period
    avg_gain = gain.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    out = 100.0 - (100.0 / (1.0 + rs))
    # If average loss is zero the market only went up -> RSI 100
    out = out.where(~((avg_loss == 0) & (avg_gain > 0)), 100.0)
    return out


def macd(close: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = ema(close, fast)
    ema_slow = ema(close, slow)
    line = ema_fast - ema_slow
    sig = ema(line, signal)
    return pd.DataFrame(
        {
            "macd": line,
            "macd_signal": sig,
            "macd_hist": line - sig,
        }
    )


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift(1)
    ranges = pd.concat(
        [
            df["high"] - df["low"],
            (df["high"] - prev_close).abs(),
            (df["low"] - prev_close).abs(),
        ],
        axis=1,
    )
    return ranges.max(axis=1)


def atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    tr = true_range(df)
    return tr.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean()


def bollinger(close: pd.Series, period: int = 20, num_std: float = 2.0) -> pd.DataFrame:
    mid = sma(close, period)
    std = close.rolling(window=period, min_periods=period).std(ddof=0)
    upper = mid + num_std * std
    lower = mid - num_std * std
    width = (upper - lower) / mid.replace(0.0, np.nan)
    return pd.DataFrame(
        {
            "bb_mid": mid,
            "bb_upper": upper,
            "bb_lower": lower,
            "bb_width": width,
            "bb_percent_b": (close - lower) / (upper - lower).replace(0.0, np.nan),
        }
    )


def adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    up_move = df["high"].diff()
    down_move = -df["low"].diff()
    plus_dm = pd.Series(np.where((up_move > down_move) & (up_move > 0), up_move, 0.0), index=df.index)
    minus_dm = pd.Series(
        np.where((down_move > up_move) & (down_move > 0), down_move, 0.0), index=df.index
    )
    atr_ = atr(df, period).replace(0.0, np.nan)
    plus_di = 100.0 * plus_dm.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean() / atr_
    minus_di = 100.0 * minus_dm.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean() / atr_
    dx = 100.0 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0.0, np.nan)
    return pd.DataFrame(
        {
            "plus_di": plus_di,
            "minus_di": minus_di,
            "adx": dx.ewm(alpha=1.0 / period, adjust=False, min_periods=period).mean(),
        }
    )


def obv(df: pd.DataFrame) -> pd.Series:
    direction = np.sign(df["close"].diff().fillna(0.0))
    return (direction * df["volume"]).cumsum()


def rolling_volatility(close: pd.Series, period: int = 20) -> pd.Series:
    """Annualisation is intentionally omitted: this is per-bar sigma."""
    return close.pct_change().rolling(window=period, min_periods=period).std(ddof=0)


def volume_ratio(df: pd.DataFrame, period: int = 20) -> pd.Series:
    baseline = df["volume"].rolling(window=period, min_periods=period).mean()
    return df["volume"] / baseline.replace(0.0, np.nan)


def support_resistance(df: pd.DataFrame, lookback: int = 60, window: int = 5) -> dict[str, list[float]]:
    """Fractal pivots over the trailing ``lookback`` bars.

    A pivot high at ``i`` requires ``window`` lower highs on both sides, so the
    most recent ``window`` bars can never produce a pivot by themselves.
    """
    if len(df) < window * 2 + 3:
        raise InsufficientDataError("not enough bars for pivot detection")
    recent = df.tail(lookback).reset_index(drop=True)
    highs, lows = [], []
    for i in range(window, len(recent) - window):
        lo = i - window
        hi = i + window + 1
        if recent["high"].iloc[i] == recent["high"].iloc[lo:hi].max():
            highs.append(float(recent["high"].iloc[i]))
        if recent["low"].iloc[i] == recent["low"].iloc[lo:hi].min():
            lows.append(float(recent["low"].iloc[i]))
    price = float(df["close"].iloc[-1])
    resistances = sorted({h for h in highs if h > price})[:3]
    supports = sorted({level for level in lows if level < price}, reverse=True)[:3]
    return {"supports": supports, "resistances": resistances}


def percentile_rank(series: pd.Series, value: float) -> float | None:
    clean = series.dropna()
    if clean.empty:
        return None
    return float((clean <= value).mean())


def compute_indicator_snapshot(df: pd.DataFrame) -> dict[str, Any]:
    """Latest values for every indicator the UI displays.

    Returns ``None`` for indicators that do not have enough history yet; the
    signal engine treats ``None`` as missing evidence rather than zero.
    """
    _validate(df, minimum=30)
    close = df["close"]
    snap: dict[str, Any] = {}

    def last(series: pd.Series) -> float | None:
        if series is None or series.empty:
            return None
        value = series.iloc[-1]
        if value is None or (isinstance(value, float) and math.isnan(value)):
            return None
        return float(value)

    ma = macd(close)
    bb = bollinger(close)
    adx_df = adx(df)
    snap.update(
        {
            "price": float(close.iloc[-1]),
            "sma_20": last(sma(close, 20)),
            "sma_50": last(sma(close, 50)),
            "sma_200": last(sma(close, 200)),
            "ema_9": last(ema(close, 9)),
            "ema_21": last(ema(close, 21)),
            "ema_50": last(ema(close, 50)),
            "rsi_14": last(rsi(close, 14)),
            "macd": last(ma["macd"]),
            "macd_signal": last(ma["macd_signal"]),
            "macd_hist": last(ma["macd_hist"]),
            "atr_14": last(atr(df, 14)),
            "bb_upper": last(bb["bb_upper"]),
            "bb_mid": last(bb["bb_mid"]),
            "bb_lower": last(bb["bb_lower"]),
            "bb_width": last(bb["bb_width"]),
            "bb_percent_b": last(bb["bb_percent_b"]),
            "adx_14": last(adx_df["adx"]),
            "plus_di": last(adx_df["plus_di"]),
            "minus_di": last(adx_df["minus_di"]),
            "obv": last(obv(df)),
            "volume_ratio_20": last(volume_ratio(df)),
            "volatility_20": last(rolling_volatility(close, 20)),
        }
    )
    atr_series = atr(df, 14)
    snap["atr_percentile_100"] = percentile_rank(atr_series.tail(100), atr_series.iloc[-1]) if len(atr_series.dropna()) >= 20 else None
    try:
        levels = support_resistance(df)
        snap["supports"] = levels["supports"]
        snap["resistances"] = levels["resistances"]
    except InsufficientDataError:
        snap["supports"] = []
        snap["resistances"] = []
    return snap
