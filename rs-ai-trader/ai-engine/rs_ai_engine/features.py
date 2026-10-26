"""Leakage-free feature engineering.

Design rules
------------
1. Every feature at row ``t`` is computed from bars ``<= t`` only. No centred
   windows, no ``bfill``, no global scalers fitted on the full history.
2. The label at row ``t`` uses the *next* bar's open and the close ``horizon``
   bars later. Rows without a complete forward window get ``NaN`` labels and are
   dropped from training, never from inference.
3. The round-trip trading cost (fees + expected slippage) is subtracted before
   thresholding, so a model cannot "learn" a profit that fees would erase.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ind

FEATURE_COLUMNS: tuple[str, ...] = (
    "ret_1",
    "ret_3",
    "ret_5",
    "ret_10",
    "ret_20",
    "rsi_14",
    "rsi_14_delta",
    "macd_hist_norm",
    "ema9_ema21_spread",
    "ema21_ema50_spread",
    "price_vs_sma20",
    "price_vs_sma50",
    "atr_pct",
    "atr_percentile",
    "bb_percent_b",
    "bb_width",
    "adx_14",
    "di_spread",
    "volume_ratio",
    "volatility_20",
    "obv_slope",
    "dist_to_resistance",
    "dist_to_support",
    "range_position",
)

MIN_TRAIN_ROWS = 300


def _pct_change(close: pd.Series, periods: int) -> pd.Series:
    return close.pct_change(periods)


def _safe_div(numerator: pd.Series, denominator) -> pd.Series:
    if isinstance(denominator, (int, float)):
        return numerator / denominator if denominator else numerator * np.nan
    return numerator / denominator.replace(0.0, np.nan)


def _rolling_percentile(series: pd.Series, window: int) -> pd.Series:
    """Percentile rank of the current value within a *trailing* window."""
    return series.rolling(window=window, min_periods=max(10, window // 4)).apply(
        lambda values: float((values <= values[-1]).mean()), raw=True
    )


def build_features(
    df: pd.DataFrame,
    *,
    horizon: int = 3,
    cost_bps: float = 20.0,
) -> pd.DataFrame:
    """Return a frame of features plus ``y_long`` / ``y_short`` / ``fwd_return``.

    ``cost_bps`` is the assumed round-trip cost in basis points (2 * taker fee
    + slippage). A long label is only positive if the forward return clears it.
    """
    if not isinstance(df.index, pd.DatetimeIndex):
        raise TypeError("df must be indexed by a DatetimeIndex")
    if not df.index.is_monotonic_increasing:
        raise ValueError("df must be sorted by time ascending")
    frame = df.copy()
    close, high, low, volume = frame["close"], frame["high"], frame["low"], frame["volume"]

    macd_df = ind.macd(close)
    bb = ind.bollinger(close)
    adx_df = ind.adx(frame)
    atr_series = ind.atr(frame, 14)
    atr_pct = _safe_div(atr_series, close)

    features = pd.DataFrame(index=frame.index)
    for periods in (1, 3, 5, 10, 20):
        features[f"ret_{periods}"] = _pct_change(close, periods)
    features["rsi_14"] = ind.rsi(close, 14)
    features["rsi_14_delta"] = features["rsi_14"].diff(3)
    features["macd_hist_norm"] = _safe_div(macd_df["macd_hist"], close)
    ema9, ema21, ema50 = ind.ema(close, 9), ind.ema(close, 21), ind.ema(close, 50)
    features["ema9_ema21_spread"] = _safe_div(ema9 - ema21, close)
    features["ema21_ema50_spread"] = _safe_div(ema21 - ema50, close)
    features["price_vs_sma20"] = _safe_div(close - ind.sma(close, 20), close)
    features["price_vs_sma50"] = _safe_div(close - ind.sma(close, 50), close)
    features["atr_pct"] = atr_pct
    features["atr_percentile"] = _rolling_percentile(atr_series, 100)
    features["bb_percent_b"] = bb["bb_percent_b"]
    features["bb_width"] = bb["bb_width"]
    features["adx_14"] = adx_df["adx"]
    features["di_spread"] = _safe_div(adx_df["plus_di"] - adx_df["minus_di"], 100.0)
    features["volume_ratio"] = ind.volume_ratio(frame, 20)
    features["volatility_20"] = ind.rolling_volatility(close, 20)
    features["obv_slope"] = _safe_div(ind.obv(frame).diff(5), volume.rolling(5).sum())
    # Trailing extremes (shifted by one so the current bar cannot define its own level)
    roll_high = high.rolling(60, min_periods=20).max().shift(1)
    roll_low = low.rolling(60, min_periods=20).min().shift(1)
    features["dist_to_resistance"] = _safe_div(roll_high - close, close)
    features["dist_to_support"] = _safe_div(close - roll_low, close)
    features["range_position"] = _safe_div(close - roll_low, roll_high - roll_low)

    features = features.replace([np.inf, -np.inf], np.nan)

    # ---- labels (never used as features) -------------------------------------
    next_open = frame["open"].shift(-1)
    future_close = close.shift(-horizon)
    gross = _safe_div(future_close, next_open) - 1.0
    cost = cost_bps / 10_000.0
    labels = pd.DataFrame(
        {
            "fwd_return": gross,
            "y_long": (gross > cost).astype("float"),
            "y_short": (gross < -cost).astype("float"),
        },
        index=frame.index,
    )
    labels.loc[gross.isna(), ["y_long", "y_short"]] = np.nan

    out = features.join(labels)
    out["__close__"] = close
    out["__open__"] = frame["open"]
    return out


def model_matrix(frame: pd.DataFrame) -> pd.DataFrame:
    """Feature matrix for inference/training (rows with all features present)."""
    return frame.loc[:, list(FEATURE_COLUMNS)]


def training_rows(frame: pd.DataFrame) -> pd.DataFrame:
    """Rows usable for training: complete features *and* complete labels."""
    required = list(FEATURE_COLUMNS) + ["y_long", "y_short"]
    return frame.dropna(subset=required)


def assert_no_leakage(df: pd.DataFrame, column: str = "rsi_14", at: int = -30) -> None:
    """Perturb future bars and confirm the historical feature is unchanged.

    Used by the test-suite; kept in the package so the property is documented
    next to the implementation.
    """
    frame = df.copy()
    features = build_features(frame)
    idx = features.index[at]
    baseline = features.loc[idx, column]
    mutated = frame.copy()
    mutated.loc[mutated.index > idx, ["open", "high", "low", "close", "volume"]] *= 1.05
    mutated_features = build_features(mutated)
    if not np.isclose(baseline, mutated_features.loc[idx, column], equal_nan=True):
        raise AssertionError(
            f"look-ahead leak in {column}: {baseline} -> {mutated_features.loc[idx, column]}"
        )
