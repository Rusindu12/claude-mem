"""
Monte Carlo + Signal Stack Pricing & Decision Engine
for Polymarket 5-minute BTC Up/Down markets.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
import numpy as np


SECONDS_PER_YEAR = 365.25 * 24 * 3600


def _sigmoid(x: float) -> float:
    x = max(-20.0, min(20.0, x))
    return 1.0 / (1.0 + math.exp(-x))


def _logit(p: float) -> float:
    p = max(1e-6, min(1.0 - 1e-6, p))
    return math.log(p / (1.0 - p))


def compute_realized_vol_and_drift(
    recent_prices: List[float],
    tick_interval_sec: float = 1.0,
    default_annual_vol: float = 0.55,
) -> Tuple[float, float]:
    """
    Estimate annualized realized volatility and drift from recent tick prices.
    Falls back to sensible BTC defaults when history is too short.
    """
    if len(recent_prices) < 5:
        return default_annual_vol, 0.0

    arr = np.asarray(recent_prices, dtype=np.float64)
    arr = arr[arr > 0]
    if len(arr) < 5:
        return default_annual_vol, 0.0

    log_returns = np.diff(np.log(arr))
    dt = max(0.1, float(tick_interval_sec)) / SECONDS_PER_YEAR

    std_per_tick = float(np.std(log_returns, ddof=1))
    annual_vol = std_per_tick / math.sqrt(dt)
    # Clamp to realistic BTC 5m volatility bounds [15%, 250%] annualized
    annual_vol = max(0.15, min(2.50, annual_vol))

    mean_per_tick = float(np.mean(log_returns))
    # Shrink drift heavily toward 0 over 5-minute horizons to avoid overfitting noise
    raw_annual_drift = mean_per_tick / dt
    shrunk_drift = max(-1.5, min(1.5, raw_annual_drift * 0.10))

    return annual_vol, shrunk_drift


def run_monte_carlo(
    spot_price: float,
    strike_price: float,
    time_left_sec: float,
    annual_vol: float,
    annual_drift: float = 0.0,
    num_paths: int = 20_000,
    df: float = 5.0,
    seed: Optional[int] = None,
) -> Dict:
    """
    Run vectorized Monte Carlo simulation with Student-t fat tails.
    Returns P(UP), landing curve histogram, and sample paths for the dashboard orb.
    """
    if spot_price <= 0 or strike_price <= 0:
        raise ValueError("spot_price and strike_price must be positive")

    if time_left_sec <= 0:
        prob_up = 1.0 if spot_price >= strike_price else 0.0
        return {
            "mc_prob_up": prob_up,
            "mc_prob_down": 1.0 - prob_up,
            "expected_close": spot_price,
            "std_close": 0.0,
            "landing_curve": [
                {
                    "price": round(spot_price, 2),
                    "density": 1.0,
                    "is_up": spot_price >= strike_price,
                }
            ],
            "orb_paths": [[round(spot_price, 2)] * 12 for _ in range(32)],
        }

    rng = np.random.default_rng(seed)
    dt_total = time_left_sec / SECONDS_PER_YEAR

    # Multi-step paths (12 steps) so we can both sample fat-tailed increments
    # and extract realistic trajectories for the animated orb visualization.
    n_steps = 12
    dt_step = dt_total / n_steps

    # Variance-normalized Student-t innovations (unit variance, fat tails)
    df_safe = max(2.5, float(df))
    scale = math.sqrt((df_safe - 2.0) / df_safe)
    z = rng.standard_t(df=df_safe, size=(num_paths, n_steps)) * scale

    drift_term = (annual_drift - 0.5 * (annual_vol ** 2)) * dt_step
    vol_term = annual_vol * math.sqrt(dt_step)

    log_increments = drift_term + vol_term * z
    cum_log_returns = np.cumsum(log_increments, axis=1)
    terminal_prices = spot_price * np.exp(cum_log_returns[:, -1])

    prob_up = float(np.mean(terminal_prices >= strike_price))
    expected_close = float(np.mean(terminal_prices))
    std_close = float(np.std(terminal_prices))

    # Build landing curve (40 bins spanning 1st to 99th percentile, always including strike)
    p_low = float(np.percentile(terminal_prices, 1))
    p_high = float(np.percentile(terminal_prices, 99))
    p_low = min(p_low, strike_price - max(std_close * 0.5, 1.0))
    p_high = max(p_high, strike_price + max(std_close * 0.5, 1.0))
    if p_high <= p_low:
        p_high = p_low + 10.0

    counts, bin_edges = np.histogram(terminal_prices, bins=40, range=(p_low, p_high))
    total_counts = max(1, int(np.sum(counts)))
    landing_curve = []
    for i in range(len(counts)):
        center = 0.5 * (float(bin_edges[i]) + float(bin_edges[i + 1]))
        landing_curve.append(
            {
                "price": round(center, 2),
                "density": round(float(counts[i]) / total_counts, 5),
                "is_up": center >= strike_price,
            }
        )

    # Extract 36 sample paths for the dashboard "orb" animation
    sample_n = min(36, num_paths)
    sample_prices = spot_price * np.exp(cum_log_returns[:sample_n, :])
    orb_paths = [
        [round(spot_price, 2)] + [round(float(v), 2) for v in row]
        for row in sample_prices
    ]

    return {
        "mc_prob_up": round(prob_up, 6),
        "mc_prob_down": round(1.0 - prob_up, 6),
        "expected_close": round(expected_close, 2),
        "std_close": round(std_close, 2),
        "landing_curve": landing_curve,
        "orb_paths": orb_paths,
    }


def compute_signal_stack(
    mc_prob_up: float,
    momentum: float,
    orderbook_imbalance: float,
    spot_polymarket_lag: float,
    volatility_regime: float,
    time_left_sec: float,
    window_duration_sec: float = 300.0,
) -> Dict:
    """
    Adjust Monte Carlo probability using 5-factor signal stack in logit space
    and return exact additive probability contributions for each factor.

    Inputs:
      - momentum: normalized [-1, 1] short-term BTC momentum
      - orderbook_imbalance: [-1, 1] Polymarket UP book imbalance
      - spot_polymarket_lag: [-1, 1] spot-implied prob minus Polymarket mid
      - volatility_regime: [0, 2] ratio of current vol to baseline vol (1.0 = normal)
      - time_left_sec: seconds remaining in the 5-minute window
    """
    mom = max(-1.0, min(1.0, float(momentum)))
    obi = max(-1.0, min(1.0, float(orderbook_imbalance)))
    lag = max(-1.0, min(1.0, float(spot_polymarket_lag)))
    vol_ratio = max(0.2, min(2.5, float(volatility_regime)))
    time_frac = max(0.0, min(1.0, float(time_left_sec) / max(1.0, window_duration_sec)))

    # Logit weights for each signal
    w_mom = 0.22
    w_obi = 0.18
    w_lag = 0.28

    # Volatility regime: when vol > 1.0, pull slightly toward 0.50 (dampen overconfidence)
    base_logit = _logit(mc_prob_up)
    vol_damp_factor = max(0.0, (vol_ratio - 1.0) * 0.15)
    delta_vol = -base_logit * min(0.35, vol_damp_factor)

    # Time-left factor: very close to expiry (<15s) or very early (>270s) slightly dampens signals
    time_weight = 1.0
    if time_frac < 0.05:
        time_weight = 0.35
    elif time_frac > 0.90:
        time_weight = 0.70

    delta_mom = w_mom * mom * time_weight
    delta_obi = w_obi * obi * time_weight
    delta_lag = w_lag * lag * time_weight
    # Time-left direct contribution captures the net dampening effect
    raw_signal_sum = w_mom * mom + w_obi * obi + w_lag * lag
    delta_time = (time_weight - 1.0) * raw_signal_sum

    deltas = {
        "momentum": delta_mom,
        "orderbook_imbalance": delta_obi,
        "spot_polymarket_lag": delta_lag,
        "volatility_regime": delta_vol,
        "time_left": delta_time,
    }

    total_delta_logit = delta_mom + delta_obi + delta_lag + delta_vol
    adjusted_prob_up = _sigmoid(base_logit + total_delta_logit)
    total_prob_shift = adjusted_prob_up - mc_prob_up

    # Proportional attribution in probability space so contributions sum cleanly
    active_logit_sum = sum(abs(v) for v in deltas.values())
    contributions: Dict[str, Dict[str, float]] = {}
    for name, d_logit in deltas.items():
        if active_logit_sum > 1e-9:
            # Signed attribution scaled to match total_prob_shift directionally
            prob_contrib = (d_logit / max(1e-9, abs(total_delta_logit))) * abs(total_prob_shift) if abs(total_delta_logit) > 1e-9 else 0.0
            # Cap single factor attribution cleanly
            prob_contrib = max(-0.15, min(0.15, prob_contrib))
        else:
            prob_contrib = 0.0

        raw_val = {
            "momentum": mom,
            "orderbook_imbalance": obi,
            "spot_polymarket_lag": lag,
            "volatility_regime": vol_ratio,
            "time_left": time_frac,
        }[name]

        contributions[name] = {
            "raw": round(raw_val, 4),
            "logit_delta": round(d_logit, 4),
            "prob_delta": round(prob_contrib, 5),
        }

    return {
        "mc_prob_up": round(mc_prob_up, 6),
        "adjusted_prob_up": round(adjusted_prob_up, 6),
        "adjusted_prob_down": round(1.0 - adjusted_prob_up, 6),
        "total_prob_shift": round(total_prob_shift, 6),
        "contributions": contributions,
    }


def evaluate_decision(
    adjusted_prob_up: float,
    market_up_ask: float,
    market_down_ask: float,
    edge_threshold: float = 0.03,
    fee_rate: float = 0.005,
    slippage_est: float = 0.005,
    min_time_left_sec: float = 15.0,
    time_left_sec: float = 150.0,
) -> Dict:
    """
    Compute net edge after fees and slippage, and return BUY_UP, BUY_DOWN, or PASS.
    """
    prob_up = max(0.0, min(1.0, float(adjusted_prob_up)))
    prob_down = 1.0 - prob_up

    edge_up = prob_up - float(market_up_ask) - fee_rate - slippage_est
    edge_down = prob_down - float(market_down_ask) - fee_rate - slippage_est

    if time_left_sec < min_time_left_sec:
        return {
            "action": "PASS",
            "side": None,
            "edge": round(max(edge_up, edge_down), 5),
            "edge_up": round(edge_up, 5),
            "edge_down": round(edge_down, 5),
            "reason": f"Time left ({time_left_sec:.1f}s) below minimum cutoff ({min_time_left_sec:.0f}s)",
        }

    if edge_up >= edge_threshold and edge_up >= edge_down:
        return {
            "action": "BUY_UP",
            "side": "UP",
            "edge": round(edge_up, 5),
            "edge_up": round(edge_up, 5),
            "edge_down": round(edge_down, 5),
            "reason": f"UP edge {edge_up*100:.2f}% exceeds threshold {edge_threshold*100:.2f}%",
        }

    if edge_down >= edge_threshold and edge_down > edge_up:
        return {
            "action": "BUY_DOWN",
            "side": "DOWN",
            "edge": round(edge_down, 5),
            "edge_up": round(edge_up, 5),
            "edge_down": round(edge_down, 5),
            "reason": f"DOWN edge {edge_down*100:.2f}% exceeds threshold {edge_threshold*100:.2f}%",
        }

    best_edge = max(edge_up, edge_down)
    return {
        "action": "PASS",
        "side": None,
        "edge": round(best_edge, 5),
        "edge_up": round(edge_up, 5),
        "edge_down": round(edge_down, 5),
        "reason": f"Best edge ({best_edge*100:.2f}%) below threshold ({edge_threshold*100:.2f}%)",
    }
