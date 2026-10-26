"""Cost-aware, long/flat backtester for Binance Spot strategies.

Spot reality: you cannot short without margin, which this project does not
support. A SELL signal therefore means *exit an existing long*, never open a
short. Shorting is only modelled in the paper desk when explicitly enabled
for research, and is labelled as such.

Rules that keep the result honest:
* decisions use bar ``t`` close; the fill happens at bar ``t+1`` open;
* fees and slippage are charged on both legs;
* stops are checked against the bar low *before* the target, i.e. the
  pessimistic ordering;
* the equity curve includes fees, so reported returns are net.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any

import numpy as np
import pandas as pd

from . import indicators as ind
from .regime import classify_regime
from .signals import SignalConfig, _evaluate_factors


@dataclass
class BacktestConfig:
    initial_capital: float = 10_000.0
    fee_bps: float = 10.0  # 0.10% per side (Binance spot taker, BNB discount off)
    slippage_bps: float = 5.0
    position_fraction: float = 0.95
    warmup_bars: int = 210
    allow_short_simulation: bool = False
    risk_free_rate: float = 0.0
    timeframe_seconds: int = 3600


@dataclass
class Trade:
    side: str
    entry_time: str
    entry_price: float
    exit_time: str | None
    exit_price: float | None
    quantity: float
    fees: float
    pnl: float
    pnl_pct: float
    exit_reason: str
    bars_held: int


@dataclass
class BacktestResult:
    symbol: str
    timeframe: str
    start: str
    end: str
    bars: int
    trades: list[Trade]
    equity_curve: list[dict[str, Any]]
    metrics: dict[str, Any]
    buy_and_hold: dict[str, Any]
    assumptions: list[str]
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _precompute(df: pd.DataFrame) -> pd.DataFrame:
    close = df["close"]
    out = df.copy()
    out["ema_9"] = ind.ema(close, 9)
    out["ema_21"] = ind.ema(close, 21)
    out["ema_50"] = ind.ema(close, 50)
    out["sma_50"] = ind.sma(close, 50)
    out["sma_200"] = ind.sma(close, 200)
    out["rsi_14"] = ind.rsi(close, 14)
    macd_df = ind.macd(close)
    out["macd_hist"] = macd_df["macd_hist"]
    bb = ind.bollinger(close)
    out["bb_percent_b"] = bb["bb_percent_b"]
    adx_df = ind.adx(out)
    out["adx_14"] = adx_df["adx"]
    out["plus_di"] = adx_df["plus_di"]
    out["minus_di"] = adx_df["minus_di"]
    out["atr_14"] = ind.atr(out, 14)
    out["volume_ratio_20"] = ind.volume_ratio(out, 20)
    return out


def _snapshot(row: pd.Series, price: float) -> dict[str, Any]:
    def value(key: str) -> float | None:
        raw = row.get(key)
        if raw is None or (isinstance(raw, float) and np.isnan(raw)):
            return None
        return float(raw)

    return {
        "price": price,
        "ema_9": value("ema_9"),
        "ema_21": value("ema_21"),
        "ema_50": value("ema_50"),
        "sma_50": value("sma_50"),
        "sma_200": value("sma_200"),
        "rsi_14": value("rsi_14"),
        "macd_hist": value("macd_hist"),
        "bb_percent_b": value("bb_percent_b"),
        "adx_14": value("adx_14"),
        "plus_di": value("plus_di"),
        "minus_di": value("minus_di"),
        "atr_14": value("atr_14"),
        "volume_ratio_20": value("volume_ratio_20"),
        "supports": [],
        "resistances": [],
    }


def _max_drawdown(equity: np.ndarray) -> tuple[float, int]:
    peak = np.maximum.accumulate(equity)
    drawdown = (equity - peak) / peak
    return float(drawdown.min()) if len(drawdown) else 0.0, int((drawdown < 0).sum())


def run_backtest(
    df: pd.DataFrame,
    symbol: str,
    *,
    config: BacktestConfig | None = None,
    signal_config: SignalConfig | None = None,
) -> BacktestResult:
    cfg = config or BacktestConfig()
    sig_cfg = signal_config or SignalConfig(timeframe_seconds=cfg.timeframe_seconds)
    if len(df) <= cfg.warmup_bars + 10:
        raise ValueError(
            f"need more than {cfg.warmup_bars + 10} bars for a meaningful backtest, got {len(df)}"
        )
    frame = _precompute(df)
    warnings: list[str] = []
    if cfg.allow_short_simulation:
        warnings.append(
            "Short simulation enabled: this is a research-only model of a strategy Spot cannot execute."
        )
    round_trip_bps = 2 * (cfg.fee_bps + cfg.slippage_bps)
    warnings.append(
        f"Round-trip cost assumption {round_trip_bps:.1f} bps (fees {cfg.fee_bps:.1f} bps/side, "
        f"slippage {cfg.slippage_bps:.1f} bps/side). Real fills can be worse."
    )

    cash = cfg.initial_capital
    quantity = 0.0
    entry_price = 0.0
    entry_time: str | None = None
    entry_bar = 0
    stop_loss: float | None = None
    take_profit: float | None = None
    trades: list[Trade] = []
    equity_curve: list[dict[str, Any]] = []
    fees_paid = 0.0
    pending: str | None = None  # action to execute at next open

    for i in range(cfg.warmup_bars, len(frame) - 1):
        bar = frame.iloc[i]
        timestamp = frame.index[i]

        # --- 1. execute any decision queued on the *previous* bar at this open
        if pending is not None:
            open_price = float(bar["open"])
            if pending == "BUY" and quantity == 0.0:
                fill = open_price * (1 + cfg.slippage_bps / 10_000)
                notional = cash * cfg.position_fraction
                fee = notional * cfg.fee_bps / 10_000
                if notional > 0:
                    quantity = (notional - fee) / fill
                    cash -= notional
                    fees_paid += fee
                    entry_price = fill
                    entry_time = str(timestamp)
                    entry_bar = i
                    atr_value = float(bar["atr_14"]) if not np.isnan(bar["atr_14"]) else fill * 0.015
                    stop_loss = fill - sig_cfg.atr_stop_multiple * atr_value
                    take_profit = fill + sig_cfg.atr_target_multiple * atr_value
            elif pending == "SELL" and quantity > 0.0:
                fill = open_price * (1 - cfg.slippage_bps / 10_000)
                gross = quantity * fill
                fee = gross * cfg.fee_bps / 10_000
                cash += gross - fee
                fees_paid += fee
                pnl = (fill - entry_price) * quantity - fee
                fee_on_entry = entry_price * quantity * cfg.fee_bps / 10_000
                pnl -= fee_on_entry
                trades.append(
                    Trade(
                        side="LONG",
                        entry_time=entry_time or "",
                        entry_price=entry_price,
                        exit_time=str(timestamp),
                        exit_price=fill,
                        quantity=quantity,
                        fees=fee + fee_on_entry,
                        pnl=pnl,
                        pnl_pct=(pnl / (entry_price * quantity)) if entry_price * quantity else 0.0,
                        exit_reason="SIGNAL_EXIT",
                        bars_held=i - entry_bar,
                    )
                )
                quantity = 0.0
                entry_price = 0.0
                entry_time = None
                stop_loss = take_profit = None
            pending = None

        # --- 2. intrabar risk exits on this bar (pessimistic ordering)
        if quantity > 0.0 and stop_loss is not None and take_profit is not None:
            low, high, open_price = float(bar["low"]), float(bar["high"]), float(bar["open"])
            exit_price = None
            reason = ""
            if low <= stop_loss:
                exit_price, reason = min(stop_loss, open_price), "STOP_LOSS"
            elif high >= take_profit:
                exit_price, reason = max(take_profit, open_price), "TAKE_PROFIT"
            if exit_price is not None:
                fill = exit_price * (1 - cfg.slippage_bps / 10_000)
                gross = quantity * fill
                fee = gross * cfg.fee_bps / 10_000
                cash += gross - fee
                fees_paid += fee
                fee_on_entry = entry_price * quantity * cfg.fee_bps / 10_000
                pnl = (fill - entry_price) * quantity - fee - fee_on_entry
                trades.append(
                    Trade(
                        side="LONG",
                        entry_time=entry_time or "",
                        entry_price=entry_price,
                        exit_time=str(timestamp),
                        exit_price=fill,
                        quantity=quantity,
                        fees=fee + fee_on_entry,
                        pnl=pnl,
                        pnl_pct=(pnl / (entry_price * quantity)) if entry_price * quantity else 0.0,
                        exit_reason=reason,
                        bars_held=i - entry_bar,
                    )
                )
                quantity = 0.0
                entry_price = 0.0
                entry_time = None
                stop_loss = take_profit = None

        # --- 3. evaluate the signal for this closed bar
        snapshot = _snapshot(bar, float(bar["close"]))
        regime = classify_regime(frame.iloc[max(0, i - 120) : i + 1])
        factors = _evaluate_factors(snapshot, regime)
        score = float(sum(f.direction * f.weight for f in factors))
        bullish = sum(1 for f in factors if f.direction > 0)
        bearish = sum(1 for f in factors if f.direction < 0)
        enough_history = not np.isnan(bar["sma_200"]) if "sma_200" in bar else True
        buy_signal = (
            enough_history
            and score >= sig_cfg.min_score
            and bullish >= sig_cfg.min_agreeing_factors
            and regime.volatility_state != "extreme"
        )
        sell_signal = score <= -sig_cfg.min_score and bearish >= sig_cfg.min_agreeing_factors
        if quantity == 0.0 and buy_signal:
            pending = "BUY"
        elif quantity > 0.0 and sell_signal:
            pending = "SELL"

        equity = cash + quantity * float(bar["close"])
        equity_curve.append(
            {
                "time": str(timestamp),
                "equity": round(equity, 2),
                "price": float(bar["close"]),
                "in_position": quantity > 0.0,
            }
        )

    # close any residual position at the final close, net of costs
    if quantity > 0.0:
        final = frame.iloc[-1]
        fill = float(final["close"]) * (1 - cfg.slippage_bps / 10_000)
        gross = quantity * fill
        fee = gross * cfg.fee_bps / 10_000
        cash += gross - fee
        fees_paid += fee
        fee_on_entry = entry_price * quantity * cfg.fee_bps / 10_000
        pnl = (fill - entry_price) * quantity - fee - fee_on_entry
        trades.append(
            Trade(
                side="LONG",
                entry_time=entry_time or "",
                entry_price=entry_price,
                exit_time=str(frame.index[-1]),
                exit_price=fill,
                quantity=quantity,
                fees=fee + fee_on_entry,
                pnl=pnl,
                pnl_pct=(pnl / (entry_price * quantity)) if entry_price * quantity else 0.0,
                exit_reason="END_OF_DATA",
                bars_held=len(frame) - 1 - entry_bar,
            )
        )
        quantity = 0.0

    equity = np.array([p["equity"] for p in equity_curve] or [cfg.initial_capital], dtype=float)
    equity_with_start = np.concatenate([[cfg.initial_capital], equity])
    total_return = (equity[-1] / cfg.initial_capital - 1.0) if len(equity) else 0.0
    periods_per_year = 365 * 24 * 3600 / max(cfg.timeframe_seconds, 1)
    bar_returns = np.diff(equity_with_start) / equity_with_start[:-1]
    bar_returns = bar_returns[np.isfinite(bar_returns)]
    sharpe = None
    if len(bar_returns) > 2 and bar_returns.std(ddof=0) > 0:
        excess = bar_returns - cfg.risk_free_rate / periods_per_year
        sharpe = float(excess.mean() / bar_returns.std(ddof=0) * np.sqrt(periods_per_year))
    max_dd, underwater_bars = _max_drawdown(equity_with_start)
    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    gross_profit = sum(t.pnl for t in wins)
    gross_loss = abs(sum(t.pnl for t in losses))
    first_close = float(frame["close"].iloc[cfg.warmup_bars])
    last_close = float(frame["close"].iloc[-1])

    metrics = {
        "initial_capital": cfg.initial_capital,
        "final_equity": round(float(equity[-1]), 2),
        "total_return_pct": round(total_return * 100, 3),
        "max_drawdown_pct": round(max_dd * 100, 3),
        "bars_in_drawdown": underwater_bars,
        "sharpe_annualised": round(sharpe, 3) if sharpe is not None else None,
        "trade_count": len(trades),
        "win_rate_pct": round(100 * len(wins) / len(trades), 2) if trades else None,
        "average_win": round(gross_profit / len(wins), 2) if wins else None,
        "average_loss": round(-gross_loss / len(losses), 2) if losses else None,
        "profit_factor": round(gross_profit / gross_loss, 3) if gross_loss else None,
        "expectancy_per_trade": round(sum(t.pnl for t in trades) / len(trades), 2) if trades else None,
        "fees_and_slippage_paid": round(fees_paid + sum(
            t.quantity * t.entry_price * cfg.slippage_bps / 10_000 for t in trades
        ), 2),
        "exposure_pct": round(100 * sum(1 for p in equity_curve if p["in_position"]) / max(len(equity_curve), 1), 2),
        "avg_bars_held": round(float(np.mean([t.bars_held for t in trades])), 2) if trades else None,
    }
    buy_and_hold = {
        "return_pct": round((last_close / first_close - 1) * 100, 3),
        "max_drawdown_pct": round(
            _max_drawdown(frame["close"].iloc[cfg.warmup_bars :].to_numpy())[0] * 100, 3
        ),
        "note": "Buy-and-hold excludes fees and assumes a single entry at the first evaluated bar.",
    }
    if not trades:
        warnings.append("No trades were generated in this window; the strategy stayed flat.")
    if len(trades) < 10:
        warnings.append("Fewer than 10 trades: statistics are not meaningful yet.")

    return BacktestResult(
        symbol=symbol,
        timeframe=sig_cfg.timeframe,
        start=str(frame.index[cfg.warmup_bars]),
        end=str(frame.index[-1]),
        bars=len(frame) - cfg.warmup_bars,
        trades=trades,
        equity_curve=equity_curve,
        metrics=metrics,
        buy_and_hold=buy_and_hold,
        assumptions=[
            "Signals are evaluated on closed bars; entries fill at the next bar open.",
            "Stops are checked against the bar low before the target is considered.",
            "Fees and slippage are charged on both the entry and the exit.",
            "Position size is a fixed fraction of current cash; no pyramiding, no leverage.",
            "Spot-only: SELL closes a long position, it never opens a short.",
            "Past performance does not predict future results.",
        ],
        warnings=warnings,
    )
