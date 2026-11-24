"""
FastAPI service for the Polymarket 5m BTC Monte Carlo & Signal Stack engine.
"""

from typing import List, Optional
from fastapi import FastAPI
from pydantic import BaseModel, Field

from model import (
    compute_realized_vol_and_drift,
    run_monte_carlo,
    compute_signal_stack,
    evaluate_decision,
)

app = FastAPI(title="Polymarket BTC Monte Carlo Engine", version="1.0.0")


class SimulateRequest(BaseModel):
    spot_price: float = Field(..., gt=0)
    strike_price: float = Field(..., gt=0)
    time_left_sec: float = Field(..., ge=0)
    recent_prices: List[float] = Field(default_factory=list)
    tick_interval_sec: float = Field(default=1.0, gt=0)
    annual_vol_override: Optional[float] = None
    annual_drift_override: Optional[float] = None
    num_paths: int = Field(default=20_000, ge=1000, le=100_000)
    df: float = Field(default=5.0, ge=2.5, le=30.0)
    momentum: float = Field(default=0.0, ge=-1.0, le=1.0)
    orderbook_imbalance: float = Field(default=0.0, ge=-1.0, le=1.0)
    spot_polymarket_lag: float = Field(default=0.0, ge=-1.0, le=1.0)
    baseline_vol: float = Field(default=0.55, gt=0)
    market_up_ask: float = Field(default=0.50, gt=0, lt=1)
    market_down_ask: float = Field(default=0.50, gt=0, lt=1)
    edge_threshold: float = Field(default=0.03, ge=0)
    fee_rate: float = Field(default=0.005, ge=0)
    slippage_est: float = Field(default=0.005, ge=0)
    min_time_left_sec: float = Field(default=15.0, ge=0)
    seed: Optional[int] = None


@app.get("/health")
def health():
    return {"status": "ok", "service": "monte-carlo-engine"}


@app.post("/simulate")
def simulate(req: SimulateRequest):
    vol, drift = compute_realized_vol_and_drift(
        req.recent_prices, tick_interval_sec=req.tick_interval_sec
    )
    if req.annual_vol_override is not None:
        vol = req.annual_vol_override
    if req.annual_drift_override is not None:
        drift = req.annual_drift_override

    mc = run_monte_carlo(
        spot_price=req.spot_price,
        strike_price=req.strike_price,
        time_left_sec=req.time_left_sec,
        annual_vol=vol,
        annual_drift=drift,
        num_paths=req.num_paths,
        df=req.df,
        seed=req.seed,
    )

    vol_regime = vol / max(0.05, req.baseline_vol)
    signals = compute_signal_stack(
        mc_prob_up=mc["mc_prob_up"],
        momentum=req.momentum,
        orderbook_imbalance=req.orderbook_imbalance,
        spot_polymarket_lag=req.spot_polymarket_lag,
        volatility_regime=vol_regime,
        time_left_sec=req.time_left_sec,
    )

    decision = evaluate_decision(
        adjusted_prob_up=signals["adjusted_prob_up"],
        market_up_ask=req.market_up_ask,
        market_down_ask=req.market_down_ask,
        edge_threshold=req.edge_threshold,
        fee_rate=req.fee_rate,
        slippage_est=req.slippage_est,
        min_time_left_sec=req.min_time_left_sec,
        time_left_sec=req.time_left_sec,
    )

    return {
        "realized_vol": round(vol, 4),
        "drift": round(drift, 4),
        "volatility_regime": round(vol_regime, 4),
        "monte_carlo": mc,
        "signals": signals,
        "decision": decision,
    }
