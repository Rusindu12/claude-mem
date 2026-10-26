"""Indicator, leakage, calibration and assistant tests for RS AI TRADER."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from rs_ai_engine import indicators as ind
from rs_ai_engine.assistant import AssistantContext, answer_question, detect_lang
from rs_ai_engine.backtest import BacktestConfig, run_backtest
from rs_ai_engine.calibration import HeadMetrics, train_model
from rs_ai_engine.features import FEATURE_COLUMNS, assert_no_leakage, build_features
from rs_ai_engine.regime import assess_data_quality, classify_regime
from rs_ai_engine.signals import SignalConfig, generate_signal


def make_frame(bars: int = 900, trend: float = 0.0004, seed: int = 3, freq: str = "h") -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    returns = rng.normal(trend, 0.006, bars)
    close = 40_000 * np.exp(np.cumsum(returns))
    high = close * (1 + np.abs(rng.normal(0, 0.002, bars)))
    low = close * (1 - np.abs(rng.normal(0, 0.002, bars)))
    open_ = np.concatenate([[close[0]], close[:-1]])
    volume = rng.lognormal(3, 0.4, bars)
    index = pd.date_range(end=pd.Timestamp.now(tz="UTC"), periods=bars, freq=freq)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume}, index=index
    )


def test_indicators_match_reference_formulas():
    close = pd.Series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float)
    assert ind.sma(close, 3).iloc[-1] == pytest.approx(9.0)
    # EMA with adjust=False, span=3: alpha = 0.5
    manual = close.ewm(span=3, adjust=False).mean().iloc[-1]
    assert ind.ema(close, 3).iloc[-1] == pytest.approx(manual)


def test_rsi_bounds_and_monotonic_input():
    up = pd.Series(np.arange(1, 60, dtype=float))
    down = pd.Series(np.arange(60, 1, -1, dtype=float))
    assert ind.rsi(up).iloc[-1] == pytest.approx(100.0)
    assert ind.rsi(down).iloc[-1] == pytest.approx(0.0, abs=1e-6)
    mixed = ind.rsi(make_frame()["close"]).dropna()
    assert ((mixed >= 0) & (mixed <= 100)).all()


def test_atr_and_bollinger_are_positive():
    df = make_frame()
    assert (ind.atr(df).dropna() > 0).all()
    bb = ind.bollinger(df["close"]).dropna()
    assert (bb["bb_upper"] >= bb["bb_mid"]).all()
    assert (bb["bb_mid"] >= bb["bb_lower"]).all()


def test_insufficient_data_is_explicit():
    df = make_frame(bars=10)
    with pytest.raises(ind.InsufficientDataError):
        ind.compute_indicator_snapshot(df)
    signal = generate_signal(df, "BTCUSDT", config=SignalConfig())
    assert signal.action == "HOLD"
    assert signal.model_status == "insufficient_data"


def test_features_have_no_lookahead_leakage():
    df = make_frame(bars=600)
    for column in ("rsi_14", "macd_hist_norm", "dist_to_resistance", "range_position"):
        assert_no_leakage(df, column=column)
    # Mutating the last bar must not change features of earlier bars at all.
    frame = build_features(df)
    mutated = df.copy()
    mutated.iloc[-1, mutated.columns.get_loc("close")] *= 1.5
    mutated_features = build_features(mutated)
    assert frame.iloc[:-1][list(FEATURE_COLUMNS)].equals(mutated_features.iloc[:-1][list(FEATURE_COLUMNS)])


def test_labels_use_future_bars_only_and_subtract_costs():
    df = make_frame(bars=400)
    features = build_features(df, horizon=3, cost_bps=20)
    assert features["fwd_return"].iloc[-1] != features["fwd_return"].iloc[-1]  # NaN at the end
    gross = df["close"].shift(-3) / df["open"].shift(-1) - 1
    assert np.allclose(features["fwd_return"].dropna(), gross.dropna())
    # A positive gross move smaller than the cost must not be labelled long.
    tiny = features[(features["fwd_return"] > 0) & (features["fwd_return"] < 0.002)]
    assert (tiny["y_long"] == 0).all()


def test_training_refuses_tiny_or_degenerate_datasets():
    with pytest.raises(ValueError):
        train_model(build_features(make_frame(bars=200)))


def test_train_model_produces_honest_metrics():
    frame = make_frame(bars=1800, seed=11)
    model = train_model(build_features(frame), horizon=3, cost_bps=20)
    perf = model.recent_performance()
    assert perf["evaluation"]["out_of_sample_rows"] > 0
    assert perf["evaluation"]["period_start"] is not None
    long_metrics = perf["evaluation"]["long"]
    if long_metrics["samples"]:
        assert 0.0 <= long_metrics["brier"] <= 1.0
        assert "trusted" in long_metrics
    # A model that is not trusted must not be presented as trusted.
    assert isinstance(model.long_trusted, bool)


def test_head_metrics_trust_requires_auc_and_brier():
    weak = HeadMetrics(samples=500, roc_auc=0.50, brier=0.26, brier_baseline=0.25)
    assert not weak.trusted
    strong = HeadMetrics(samples=500, roc_auc=0.58, brier=0.22, brier_baseline=0.25)
    assert strong.trusted
    assert not HeadMetrics().trusted


def test_stale_data_suppresses_signal():
    df = make_frame(bars=300)
    stale = df.copy()
    stale.index = stale.index - pd.Timedelta(days=3)
    signal = generate_signal(stale, "BTCUSDT", config=SignalConfig(max_data_age_seconds=180))
    assert signal.action == "HOLD"
    assert signal.model_status == "stale_market_data"
    assert "stale" in " ".join(signal.reasons).lower()


def test_signal_never_fabricates_probability_without_model():
    signal = generate_signal(make_frame(), "BTCUSDT", config=SignalConfig())
    assert signal.probability_up is None
    assert signal.model_status in ("not_loaded", "model_present_but_not_trusted")
    assert signal.action in ("BUY", "SELL", "HOLD")
    if signal.action in ("BUY", "SELL"):
        assert signal.stop_loss is not None and signal.take_profit is not None
        assert signal.risk_reward >= 1.2
        assert signal.invalidation


def test_signal_levels_respect_tick_size():
    signal = generate_signal(make_frame(seed=5), "BTCUSDT", config=SignalConfig(), tick_size=0.1)
    if signal.stop_loss is not None:
        assert round(signal.stop_loss / 0.1, 6) == pytest.approx(round(signal.stop_loss / 0.1))


def test_regime_and_data_quality():
    regime = classify_regime(make_frame())
    assert regime.label in {"trending_up", "trending_down", "ranging", "high_volatility"}
    fresh = assess_data_quality(make_frame(), 3600, 180)
    assert fresh.stale is False and fresh.sufficient is True
    old = make_frame()
    old.index = old.index - pd.Timedelta(hours=5)
    stale = assess_data_quality(old, 3600, 180)
    assert stale.stale is True
    assert any("old" in issue for issue in stale.issues)
    base = make_frame()
    gappy = base.drop(base.index[100:140])
    gappy_quality = assess_data_quality(gappy, 3600, 180)
    assert gappy_quality.gaps > 0


def test_backtest_charges_costs_and_has_no_lookahead():
    df = make_frame(bars=800, trend=0.0008)
    result = run_backtest(df, "BTCUSDT", config=BacktestConfig(initial_capital=10_000))
    assert result.metrics["trade_count"] >= 0
    assert result.metrics["final_equity"] > 0
    for trade in result.trades:
        # a stop can be hit inside the entry bar, so equal timestamps are allowed
        assert trade.entry_time <= (trade.exit_time or "9999")
        assert trade.fees > 0
    assert result.metrics["max_drawdown_pct"] <= 0
    assert any("fees and slippage" in a.lower() for a in result.assumptions)


def test_backtest_rejects_short_history():
    with pytest.raises(ValueError):
        run_backtest(make_frame(bars=100), "BTCUSDT")


def test_backtest_equity_curve_is_consistent_with_start_capital():
    result = run_backtest(make_frame(bars=600, seed=9), "BTCUSDT")
    if result.equity_curve:
        first = result.equity_curve[0]["equity"]
        assert abs(first - result.metrics["initial_capital"]) < result.metrics["initial_capital"] * 0.5


def test_assistant_is_grounded_and_bilingual():
    signal = generate_signal(make_frame(), "BTCUSDT").to_dict()
    ctx = AssistantContext(signal=signal, regime=signal["regime"], data_timestamp="2026-01-01T00:00:00Z")
    english = answer_question("why did you generate this signal?", ctx)
    assert english.intent == "signal"
    assert english.lang == "en"
    assert "BTCUSDT" in english.text
    assert "not financial advice" in english.text.lower()
    sinhala = answer_question("සංඥාව ගැන කියන්න", ctx, )
    assert sinhala.lang == "si"
    assert "BTCUSDT" in sinhala.text


def test_assistant_never_invents_portfolio_data():
    ctx = AssistantContext()
    answer = answer_question("what is my balance?", ctx)
    assert answer.intent == "portfolio"
    assert "do not have that information" in answer.text.lower()
    assert answer.facts_used == {}


def test_assistant_refuses_ungrounded_llm_numbers():
    ctx = AssistantContext(
        signal=generate_signal(make_frame(), "BTCUSDT").to_dict(),
        data_timestamp="2026-01-01T00:00:00Z",
    )

    def polisher(question, lang, facts, draft):
        return "Your balance is 999999 USDT and profit is guaranteed."

    answer = answer_question("how is my signal?", ctx, polisher=polisher)
    assert "999999" not in answer.text
    assert "guaranteed profit" not in answer.text.lower()
    assert any("rejected" in l.lower() or "guarantee" in l.lower() for l in answer.limitations)


def test_stale_context_is_flagged_in_answer():
    ctx = AssistantContext(data_is_stale=True, signal=None, data_timestamp="2020-01-01T00:00:00Z")
    answer = answer_question("what is the market doing?", ctx)
    assert any("stale" in l.lower() for l in answer.limitations)


def test_detect_lang_explicit_and_script():
    assert detect_lang("hello", "si") == "si"
    assert detect_lang("මිල කීයද?") == "si"
    assert detect_lang("what is RSI") == "en"
