"""Unit tests for the Monte Carlo model, signal stack, and FastAPI endpoint."""

import pytest
from fastapi.testclient import TestClient

from model import (
    compute_realized_vol_and_drift,
    run_monte_carlo,
    compute_signal_stack,
    evaluate_decision,
)
from main import app

client = TestClient(app)


def test_monte_carlo_at_the_money_symmetric():
    res = run_monte_carlo(
        spot_price=95000.0,
        strike_price=95000.0,
        time_left_sec=150.0,
        annual_vol=0.55,
        annual_drift=0.0,
        num_paths=20_000,
        seed=42,
    )
    assert 0.48 <= res["mc_prob_up"] <= 0.52
    assert abs((res["mc_prob_up"] + res["mc_prob_down"]) - 1.0) < 1e-5
    assert len(res["landing_curve"]) == 40
    assert len(res["orb_paths"]) == 36


def test_monte_carlo_deep_in_the_money_up():
    res = run_monte_carlo(
        spot_price=96000.0,
        strike_price=95000.0,
        time_left_sec=60.0,
        annual_vol=0.50,
        num_paths=20_000,
        seed=7,
    )
    assert res["mc_prob_up"] > 0.95


def test_monte_carlo_deep_out_of_the_money_down():
    res = run_monte_carlo(
        spot_price=94000.0,
        strike_price=95000.0,
        time_left_sec=60.0,
        annual_vol=0.50,
        num_paths=20_000,
        seed=7,
    )
    assert res["mc_prob_up"] < 0.05


def test_monte_carlo_expired_window():
    res_up = run_monte_carlo(95001.0, 95000.0, 0.0, 0.55)
    assert res_up["mc_prob_up"] == 1.0
    res_down = run_monte_carlo(94999.0, 95000.0, 0.0, 0.55)
    assert res_down["mc_prob_up"] == 0.0


def test_realized_vol_and_drift_bounds():
    prices = [95000.0 + (i % 2) * 15.0 for i in range(60)]
    vol, drift = compute_realized_vol_and_drift(prices, tick_interval_sec=1.0)
    assert 0.15 <= vol <= 2.50
    assert -1.5 <= drift <= 1.5


def test_signal_stack_positive_bias_increases_prob():
    sig = compute_signal_stack(
        mc_prob_up=0.50,
        momentum=0.8,
        orderbook_imbalance=0.6,
        spot_polymarket_lag=0.5,
        volatility_regime=1.0,
        time_left_sec=150.0,
    )
    assert sig["adjusted_prob_up"] > 0.50
    assert set(sig["contributions"].keys()) == {
        "momentum",
        "orderbook_imbalance",
        "spot_polymarket_lag",
        "volatility_regime",
        "time_left",
    }


def test_evaluate_decision_buy_up_down_pass():
    d_up = evaluate_decision(0.62, 0.52, 0.50, edge_threshold=0.03, fee_rate=0.005, slippage_est=0.005)
    assert d_up["action"] == "BUY_UP"
    assert d_up["edge_up"] == pytest.approx(0.09, abs=1e-4)

    d_down = evaluate_decision(0.35, 0.52, 0.52, edge_threshold=0.03, fee_rate=0.005, slippage_est=0.005)
    assert d_down["action"] == "BUY_DOWN"
    assert d_down["edge_down"] == pytest.approx(0.12, abs=1e-4)

    d_pass = evaluate_decision(0.51, 0.51, 0.51, edge_threshold=0.03, fee_rate=0.005, slippage_est=0.005)
    assert d_pass["action"] == "PASS"

    d_late = evaluate_decision(0.75, 0.50, 0.50, time_left_sec=5.0, min_time_left_sec=15.0)
    assert d_late["action"] == "PASS"


def test_fastapi_simulate_endpoint():
    resp = client.post(
        "/simulate",
        json={
            "spot_price": 95100.0,
            "strike_price": 95000.0,
            "time_left_sec": 120.0,
            "num_paths": 5000,
            "momentum": 0.4,
            "orderbook_imbalance": 0.3,
            "spot_polymarket_lag": 0.2,
            "market_up_ask": 0.50,
            "market_down_ask": 0.52,
            "seed": 123,
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "monte_carlo" in data
    assert "signals" in data
    assert "decision" in data
    assert data["monte_carlo"]["mc_prob_up"] > 0.5
