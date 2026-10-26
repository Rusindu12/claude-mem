"""Signal composition.

The engine combines explainable technical evidence with an optional calibrated
ML probability. It is designed to say HOLD often: when data is stale, history
is short, volatility is extreme or the evidence conflicts, no trade is
proposed.

It never invents a confidence percentage. ``probability_up`` is populated only
when a model artefact exists whose out-of-sample metrics cleared the trust
threshold; otherwise it stays ``None`` and ``model_status`` says why.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from . import indicators as ind
from .calibration import CalibratedModel
from .features import FEATURE_COLUMNS, build_features
from .regime import Regime, assess_data_quality, classify_regime


@dataclass
class SignalConfig:
    timeframe: str = "1h"
    timeframe_seconds: int = 3600
    horizon_bars: int = 3
    cost_bps: float = 20.0
    min_score: float = 0.32
    min_agreeing_factors: int = 3
    min_risk_reward: float = 1.2
    atr_stop_multiple: float = 1.5
    atr_target_multiple: float = 2.8
    max_data_age_seconds: int = 180
    extreme_volatility_block: bool = True
    model_weight: float = 0.35


@dataclass
class Factor:
    name: str
    direction: int  # +1 bullish, -1 bearish, 0 neutral
    weight: float
    detail: str


@dataclass
class SignalResult:
    symbol: str
    timeframe: str
    action: str  # BUY | SELL | HOLD
    generated_at: str
    price: float | None
    reasons: list[str]
    indicators: dict[str, Any]
    entry_low: float | None
    entry_high: float | None
    stop_loss: float | None
    take_profit: float | None
    risk_reward: float | None
    invalidation: list[str]
    model_version: str
    model_status: str
    probability_up: float | None
    probability_down: float | None
    model_performance: dict[str, Any] | None
    data_quality: dict[str, Any]
    regime: dict[str, Any]
    score: float
    evidence_grade: str  # strong | moderate | weak | none
    disclaimer: str = (
        "Technical analysis is probabilistic and can be wrong. Stop-loss orders "
        "reduce but do not eliminate losses; slippage and gaps can exceed them. "
        "This is not financial advice."
    )
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _fmt(value: float | None, digits: int = 4) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def _round_to_tick(value: float, tick: float) -> float:
    if tick <= 0:
        return value
    return round(round(value / tick) * tick, 10)


def _evaluate_factors(snap: dict[str, Any], regime: Regime) -> list[Factor]:
    factors: list[Factor] = []
    price = snap["price"]

    # --- trend: EMA stack --------------------------------------------------
    ema9, ema21, ema50 = snap.get("ema_9"), snap.get("ema_21"), snap.get("ema_50")
    if None not in (ema9, ema21, ema50):
        if ema9 > ema21 > ema50:
            factors.append(Factor("ema_stack", 1, 0.22, "EMA9 > EMA21 > EMA50 (bullish stack)"))
        elif ema9 < ema21 < ema50:
            factors.append(Factor("ema_stack", -1, 0.22, "EMA9 < EMA21 < EMA50 (bearish stack)"))
        else:
            factors.append(Factor("ema_stack", 0, 0.22, "EMA stack is mixed"))

    # --- structure: price vs SMA50/SMA200 ---------------------------------
    sma50, sma200 = snap.get("sma_50"), snap.get("sma_200")
    if sma50 is not None and sma200 is not None:
        if price > sma50 > sma200:
            factors.append(Factor("structure", 1, 0.18, "price above rising SMA50 and SMA200"))
        elif price < sma50 < sma200:
            factors.append(Factor("structure", -1, 0.18, "price below SMA50 and SMA200"))
        else:
            factors.append(Factor("structure", 0, 0.18, "moving averages are not aligned"))

    # --- momentum: RSI ----------------------------------------------------
    rsi_value = snap.get("rsi_14")
    if rsi_value is not None:
        if rsi_value >= 70:
            factors.append(Factor("rsi", -1, 0.14, f"RSI {rsi_value:.1f} is overbought"))
        elif rsi_value <= 30:
            factors.append(Factor("rsi", 1, 0.14, f"RSI {rsi_value:.1f} is oversold"))
        elif 50 < rsi_value < 70:
            factors.append(Factor("rsi", 1, 0.14, f"RSI {rsi_value:.1f} shows bullish momentum"))
        elif 30 < rsi_value < 50:
            factors.append(Factor("rsi", -1, 0.14, f"RSI {rsi_value:.1f} shows bearish momentum"))
        else:
            factors.append(Factor("rsi", 0, 0.14, f"RSI {rsi_value:.1f} is neutral"))

    # --- MACD histogram ---------------------------------------------------
    hist = snap.get("macd_hist")
    if hist is not None and price:
        normalised = hist / price
        if normalised > 0.0002:
            factors.append(Factor("macd", 1, 0.16, "MACD histogram above zero and positive"))
        elif normalised < -0.0002:
            factors.append(Factor("macd", -1, 0.16, "MACD histogram below zero and negative"))
        else:
            factors.append(Factor("macd", 0, 0.16, "MACD histogram is flat"))

    # --- trend strength: ADX + DI ----------------------------------------
    adx_value, plus_di, minus_di = snap.get("adx_14"), snap.get("plus_di"), snap.get("minus_di")
    if adx_value is not None and plus_di is not None and minus_di is not None:
        if adx_value >= 25 and plus_di > minus_di:
            factors.append(Factor("adx", 1, 0.14, f"ADX {adx_value:.1f} confirms an up-trend"))
        elif adx_value >= 25 and minus_di > plus_di:
            factors.append(Factor("adx", -1, 0.14, f"ADX {adx_value:.1f} confirms a down-trend"))
        else:
            factors.append(Factor("adx", 0, 0.14, f"ADX {adx_value:.1f} indicates no strong trend"))

    # --- Bollinger position ----------------------------------------------
    percent_b = snap.get("bb_percent_b")
    if percent_b is not None:
        if percent_b > 1.0:
            factors.append(Factor("bollinger", -1, 0.10, "price above the upper Bollinger band"))
        elif percent_b < 0.0:
            factors.append(Factor("bollinger", 1, 0.10, "price below the lower Bollinger band"))
        else:
            factors.append(Factor("bollinger", 0, 0.10, f"price at {percent_b:.0%} of the Bollinger range"))

    # --- participation: volume -------------------------------------------
    volume_ratio = snap.get("volume_ratio_20")
    if volume_ratio is not None:
        trend_direction = 1 if regime.label == "trending_up" else -1 if regime.label == "trending_down" else 0
        if volume_ratio >= 1.3 and trend_direction:
            factors.append(
                Factor("volume", trend_direction, 0.10, f"volume {volume_ratio:.2f}x the 20-bar average confirms the move")
            )
        elif volume_ratio < 0.6:
            factors.append(Factor("volume", 0, 0.10, f"volume only {volume_ratio:.2f}x average (thin participation)"))
        else:
            factors.append(Factor("volume", 0, 0.10, f"volume {volume_ratio:.2f}x the 20-bar average"))

    # --- location vs support / resistance --------------------------------
    supports, resistances = snap.get("supports") or [], snap.get("resistances") or []
    atr_value = snap.get("atr_14")
    if atr_value and supports:
        nearest_support = max(supports)
        distance = (price - nearest_support) / atr_value
        if 0 <= distance <= 0.5:
            factors.append(Factor("support", 1, 0.12, f"price is {distance:.2f} ATR above support {_fmt(nearest_support)}"))
    if atr_value and resistances:
        nearest_resistance = min(resistances)
        distance = (nearest_resistance - price) / atr_value
        if 0 <= distance <= 0.5:
            factors.append(Factor("resistance", -1, 0.12, f"price is {distance:.2f} ATR below resistance {_fmt(nearest_resistance)}"))
    return factors


def _grade(score: float, agreeing: int) -> str:
    if agreeing >= 4 and score >= 0.45:
        return "strong"
    if agreeing >= 3 and score >= 0.32:
        return "moderate"
    if score > 0:
        return "weak"
    return "none"


def generate_signal(
    df: pd.DataFrame,
    symbol: str,
    *,
    config: SignalConfig | None = None,
    model: CalibratedModel | None = None,
    tick_size: float = 0.0,
    step_size: float = 0.0,
    now: datetime | None = None,
) -> SignalResult:
    """Produce a BUY/SELL/HOLD signal for ``symbol`` from closed OHLCV bars."""
    cfg = config or SignalConfig()
    generated_at = (now or datetime.now(timezone.utc)).isoformat()
    quality = assess_data_quality(df, cfg.timeframe_seconds, cfg.max_data_age_seconds)
    base: dict[str, Any] = {
        "symbol": symbol,
        "timeframe": cfg.timeframe,
        "generated_at": generated_at,
        "price": None,
        "indicators": {},
        "entry_low": None,
        "entry_high": None,
        "stop_loss": None,
        "take_profit": None,
        "risk_reward": None,
        "invalidation": [],
        "model_version": model.version if model else "rsai-rules-v1",
        "model_status": "unavailable",
        "probability_up": None,
        "probability_down": None,
        "model_performance": model.recent_performance() if model else None,
        "data_quality": quality.to_dict(),
        "regime": {"label": "unknown", "volatility_state": "unknown", "trend_strength": None, "reasons": []},
        "score": 0.0,
        "evidence_grade": "none",
    }

    # ---- hard gates ------------------------------------------------------
    if len(df) < 60:
        return SignalResult(
            **{
                **base,
                "action": "HOLD",
                "model_status": "insufficient_data",
                "reasons": [
                    f"Only {len(df)} closed candles are available; at least 60 are required for a reliable read.",
                    "No directional signal is produced when history is insufficient.",
                ],
            }
        )
    if quality.stale:
        age = "unknown" if quality.age_seconds is None else f"{quality.age_seconds:.0f}s"
        return SignalResult(
            **{
                **base,
                "action": "HOLD",
                "model_status": "stale_market_data",
                "reasons": [
                    f"The newest closed candle is {age} old, beyond the {cfg.max_data_age_seconds}s freshness budget.",
                    "Signals are suppressed while market data is stale.",
                ],
            }
        )

    try:
        snapshot = ind.compute_indicator_snapshot(df)
    except Exception as exc:  # pragma: no cover - defensive
        return SignalResult(
            **{
                **base,
                "action": "HOLD",
                "model_status": "indicator_error",
                "reasons": [f"Indicator computation failed: {exc}"],
            }
        )
    regime = classify_regime(df)
    base["indicators"] = snapshot
    base["regime"] = regime.to_dict()
    base["price"] = snapshot["price"]

    factors = _evaluate_factors(snapshot, regime)
    score = float(sum(f.direction * f.weight for f in factors))
    bullish = sum(1 for f in factors if f.direction > 0)
    bearish = sum(1 for f in factors if f.direction < 0)
    gate_reasons: list[str] = []

    # ---- optional calibrated model --------------------------------------
    frame = build_features(df, horizon=cfg.horizon_bars, cost_bps=cfg.cost_bps)
    probability_up: float | None = None
    probability_down: float | None = None
    model_status = "not_loaded"
    if model is not None:
        if len(df) < 120:
            model_status = "insufficient_history_for_model"
        elif model.long_trusted or model.short_trusted:
            latest = frame.iloc[[-1]]
            if frame.loc[:, list(FEATURE_COLUMNS)].iloc[-1].isna().any():
                model_status = "insufficient_features"
            else:
                up = float(model.predict_long(latest)[0]) if model.long_trusted else None
                down = float(model.predict_short(latest)[0]) if model.short_trusted else None
                probability_up = up if up is not None and not np.isnan(up) else None
                probability_down = down if down is not None and not np.isnan(down) else None
                if probability_up is not None:
                    score += cfg.model_weight * (probability_up - 0.5) * 2
                    factors.append(
                        Factor(
                            "model",
                            1 if probability_up > 0.5 else -1,
                            cfg.model_weight,
                            f"calibrated model P(up, cost-adjusted) = {probability_up:.2%} on unseen-data metrics",
                        )
                    )
                if probability_down is not None:
                    score += cfg.model_weight * (0.5 - probability_down) * 2
                model_status = "calibrated_out_of_sample"
        else:
            model_status = "model_present_but_not_trusted"

    # ---- risk gates ------------------------------------------------------
    atr_value = snapshot.get("atr_14")
    if cfg.extreme_volatility_block and regime.volatility_state == "extreme":
        gate_reasons.append("Volatility is in the top 5% of the recent range; the engine stands aside.")
    if atr_value and snapshot["price"] and atr_value / snapshot["price"] > 0.06:
        gate_reasons.append(
            f"ATR is {atr_value / snapshot['price']:.1%} of price, above the 6% volatility ceiling."
        )
    factor_agreement = max(bullish, bearish)
    if factor_agreement:
        if factor_agreement < cfg.min_agreeing_factors:
            gate_reasons.append(
                f"Only {factor_agreement} indicator(s) agree on a direction; {cfg.min_agreeing_factors} are required."
            )
    direction = 1 if score > 0 else -1
    if abs(score) < cfg.min_score:
        gate_reasons.append(
            f"Composite evidence score {score:+.2f} is inside the neutral band (±{cfg.min_score:.2f})."
        )
    if quality.gaps > max(2, len(df) // 100):
        gate_reasons.append(f"{quality.gaps} candle gaps were detected; data continuity is poor.")

    reasons: list[str] = [f.detail for f in factors]
    reasons.extend(regime.reasons)
    reasons.extend(quality.issues)

    result = SignalResult(
        **{
            **base,
            "action": "HOLD",
            "reasons": reasons,
            "score": round(score, 4),
            "evidence_grade": _grade(abs(score), max(bullish, bearish)),
            "probability_up": probability_up,
            "probability_down": probability_down,
            "model_status": model_status,
        }
    )

    if gate_reasons:
        reasons.extend(gate_reasons)
        result.action = "HOLD"
        result.invalidation = []
        return result

    # ---- levels ----------------------------------------------------------
    price = float(snapshot["price"])
    stop_distance = cfg.atr_stop_multiple * atr_value if atr_value else price * 0.015
    target_distance = cfg.atr_target_multiple * atr_value if atr_value else price * 0.035
    if direction > 0:
        entry_low, entry_high = price - 0.15 * stop_distance / cfg.atr_stop_multiple, price + 0.1 * stop_distance
        stop_loss = price - stop_distance
        take_profit = price + target_distance
        invalidation = [
            f"A closed candle below the stop level {_fmt(stop_loss)} invalidates the setup.",
            "A loss of bullish EMA alignment (EMA9 crossing back below EMA21) removes trend support.",
            "A drop in RSI below 45 suggests the momentum leg has failed.",
        ]
    else:
        entry_low, entry_high = price - 0.1 * stop_distance, price + 0.15 * stop_distance / cfg.atr_stop_multiple
        stop_loss = price + stop_distance
        take_profit = price - target_distance
        invalidation = [
            f"A closed candle above the stop level {_fmt(stop_loss)} invalidates the setup.",
            "EMA9 crossing back above EMA21 removes trend support for the short thesis.",
            "RSI rising above 55 suggests downside momentum has faded.",
        ]

    if tick_size:
        entry_low = _round_to_tick(entry_low, tick_size)
        entry_high = _round_to_tick(entry_high, tick_size)
        stop_loss = _round_to_tick(stop_loss, tick_size)
        take_profit = _round_to_tick(take_profit, tick_size)

    risk = abs(price - stop_loss)
    reward = abs(take_profit - price)
    risk_reward = round(reward / risk, 3) if risk > 0 else None
    if risk_reward is None or risk_reward < cfg.min_risk_reward:
        reasons.append(
            f"Risk/reward {risk_reward:.2f} is below the {cfg.min_risk_reward:.2f} minimum, so no trade is proposed."
        )
        result.action = "HOLD"
        result.reasons = reasons
        return result

    reasons.append(
        f"Fee and slippage assumption: {cfg.cost_bps:.0f} bps round trip. "
        f"Targets must clear this cost before they are worth taking."
    )
    if probability_up is None and probability_down is None:
        reasons.append(
            "No validated model probability is shown: only rule-based evidence supports this setup."
        )

    result.action = "BUY" if direction > 0 else "SELL"
    result.entry_low = entry_low
    result.entry_high = entry_high
    result.stop_loss = stop_loss
    result.take_profit = take_profit
    result.risk_reward = risk_reward
    result.invalidation = invalidation
    result.reasons = reasons
    return result
