"""Server-side risk engine.

The Android client is untrusted: this module is the only place that can
approve a trade. Every check returns a machine-readable result so the app can
explain *why* something was rejected instead of showing a generic failure.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

from ..db.models import (
    OrderSide,
    OrderStatus,
    PaperPosition,
    RiskPolicy,
    TradingControl,
    TradingMode,
    User,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

ZERO = Decimal("0")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class OrderIntent:
    symbol: str
    side: OrderSide
    order_type: str
    quantity: Decimal
    price: Decimal | None = None
    quote_notional: Decimal = ZERO
    stop_loss: Decimal | None = None
    take_profit: Decimal | None = None
    mode: TradingMode = TradingMode.paper
    market_price: Decimal | None = None
    min_notional: Decimal | None = None
    step_size: Decimal | None = None
    tick_size: Decimal | None = None
    symbol_status: str = "TRADING"
    data_is_stale: bool = False
    data_is_synthetic: bool = False
    expected_slippage_bps: float | None = None
    volatility_pct: float | None = None
    spread_bps: float | None = None


@dataclass
class CheckResult:
    name: str
    passed: bool
    severity: str  # block | warn
    detail: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RiskDecision:
    approved: bool
    violations: list[dict[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    checks: list[CheckResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "approved": self.approved,
            "violations": self.violations,
            "warnings": self.warnings,
            "checks": [c.to_dict() for c in self.checks],
        }


def default_policy(user_id: str) -> RiskPolicy:
    return RiskPolicy(
        user_id=user_id,
        max_trade_notional=Decimal("100"),
        max_portfolio_exposure_pct=Decimal("25"),
        max_daily_loss=Decimal("50"),
        max_risk_per_trade_pct=Decimal("1"),
        max_open_orders=3,
        max_open_positions=2,
        stop_loss_required=True,
        cooldown_after_losses=3,
        cooldown_minutes=60,
        live_opt_in=False,
        automation_opt_in=False,
    )


def ensure_policy(db: Session, user: User) -> RiskPolicy:
    policy = user.risk_policy
    if policy is None:
        policy = db.scalar(select(RiskPolicy).where(RiskPolicy.user_id == user.id))
    if policy is None:
        policy = default_policy(user.id)
        db.add(policy)
        db.flush()
        user.risk_policy = policy
    return policy


def get_control(db: Session) -> TradingControl:
    control = db.get(TradingControl, "global")
    if control is None:
        control = TradingControl(id="global", kill_switch=False)
        db.add(control)
        db.flush()
    return control


class RiskEngine:
    """Pure decision logic — no I/O, so it is trivially unit-testable."""

    def __init__(self, *, live_trading_enabled: bool, automation_enabled: bool, environment: str) -> None:
        self.live_trading_enabled = live_trading_enabled
        self.automation_enabled = automation_enabled
        self.environment = environment

    def evaluate(
        self,
        intent: OrderIntent,
        *,
        policy: RiskPolicy,
        control: TradingControl,
        equity: Decimal,
        available_quote: Decimal,
        daily_realized_pnl: Decimal,
        current_exposure: Decimal,
        open_orders: int,
        open_positions: int,
        position_quantity: Decimal = ZERO,
        now: datetime | None = None,
        manual_approval: bool = True,
    ) -> RiskDecision:
        now = now or utcnow()
        checks: list[CheckResult] = []
        violations: list[dict[str, str]] = []
        warnings: list[str] = []

        def block(name: str, detail: str) -> None:
            checks.append(CheckResult(name, False, "block", detail))
            violations.append({"code": name, "message": detail})

        def warn(name: str, detail: str) -> None:
            checks.append(CheckResult(name, True, "warn", detail))
            warnings.append(detail)

        def ok(name: str, detail: str = "passed") -> None:
            checks.append(CheckResult(name, True, "block", detail))

        # 1. global kill switch / emergency stop
        if control.kill_switch:
            block("kill_switch", f"Emergency stop is active: {control.reason or 'trading disabled by an administrator'}.")
            return RiskDecision(False, violations, warnings, checks)
        if control.stale_data_block:
            block("stale_data_block", "The stale-market-data kill switch is active.")
        if control.api_error_block:
            block("api_error_block", "Trading is paused after repeated exchange API errors.")
        ok("kill_switch", "emergency stop is not active")

        # 2. mode gates
        if intent.mode == TradingMode.live:
            if not self.live_trading_enabled:
                block("live_trading_disabled", "Live trading is disabled by server configuration.")
            elif not policy.live_opt_in:
                block(
                    "live_opt_in_required",
                    "Live trading requires an explicit opt-in that you have not recorded.",
                )
            else:
                ok("live_opt_in", f"live opt-in recorded at {policy.live_consent_at}")
        if intent.mode in (TradingMode.paper, TradingMode.analysis):
            ok("mode", f"{intent.mode.value} mode requires no exchange permissions")

        # 3. data integrity — never trade on stale or simulated prices
        if intent.data_is_stale:
            block("stale_market_data", "Market data is stale; trading is blocked until prices refresh.")
        else:
            ok("market_data_fresh")
        if intent.data_is_synthetic and intent.mode == TradingMode.live:
            block("synthetic_data", "Live orders cannot be placed while market data is simulated.")
        elif intent.data_is_synthetic:
            warn("synthetic_data", "This order uses simulated market data.")

        # 4. symbol status / precision
        if intent.symbol_status != "TRADING":
            block("symbol_halted", f"{intent.symbol} is not trading (status {intent.symbol_status}).")
        else:
            ok("symbol_status")
        if intent.step_size and intent.step_size > 0:
            remainder = intent.quantity % intent.step_size
            if remainder != 0:
                block(
                    "step_size",
                    f"Quantity {intent.quantity} does not respect the step size {intent.step_size}.",
                )
            else:
                ok("step_size")
        # Market orders have no exchange price to validate; only limit prices
        # must respect the tick size.
        if (
            intent.order_type != "MARKET"
            and intent.tick_size
            and intent.price
            and intent.tick_size > 0
        ):
            if intent.price % intent.tick_size != 0:
                block("tick_size", f"Price {intent.price} does not respect the tick size {intent.tick_size}.")
            else:
                ok("tick_size")

        if intent.quantity <= 0:
            block("quantity", "Quantity must be greater than zero.")
            return RiskDecision(False, violations, warnings, checks)

        notional = intent.quote_notional
        if intent.price and intent.price > 0:
            notional = intent.price * intent.quantity
        if intent.min_notional and notional < intent.min_notional:
            block(
                "min_notional",
                f"Order value {notional:.2f} USDT is below the exchange minimum {intent.min_notional} USDT.",
            )
        else:
            ok("min_notional")

        # 5. per-order and portfolio limits
        if policy.max_trade_notional and notional > policy.max_trade_notional:
            block(
                "max_trade_notional",
                f"Order value {notional:.2f} USDT exceeds your per-trade limit of {policy.max_trade_notional} USDT.",
            )
        else:
            ok("max_trade_notional")

        projected_exposure = current_exposure + (notional if intent.side == OrderSide.BUY else ZERO)
        if intent.side == OrderSide.SELL:
            projected_exposure = max(ZERO, current_exposure)  # selling reduces exposure
        if equity > 0 and policy.max_portfolio_exposure_pct:
            ceiling = equity * policy.max_portfolio_exposure_pct / Decimal(100)
            if projected_exposure > ceiling:
                block(
                    "max_portfolio_exposure",
                    f"Projected exposure {projected_exposure:.2f} USDT exceeds the "
                    f"{policy.max_portfolio_exposure_pct}% portfolio ceiling ({ceiling:.2f} USDT).",
                )
            else:
                ok("max_portfolio_exposure")

        # 6. loss limits and cooldowns
        if policy.max_daily_loss and daily_realized_pnl <= -abs(policy.max_daily_loss):
            block(
                "max_daily_loss",
                f"Daily loss limit reached ({daily_realized_pnl:.2f} USDT of a "
                f"{policy.max_daily_loss} USDT allowance). Trading resumes tomorrow.",
            )
        else:
            ok("max_daily_loss")
        if policy.cooldown_until and policy.cooldown_until > now:
            block(
                "cooldown",
                f"Cooldown active for another {int((policy.cooldown_until - now).total_seconds() // 60)} minute(s) "
                "after repeated losses or API errors.",
            )
        else:
            ok("cooldown")

        # 7. concurrency limits
        if policy.max_open_orders is not None and open_orders >= policy.max_open_orders and intent.side == OrderSide.BUY:
            block(
                "max_open_orders",
                f"You already have {open_orders} open order(s); the limit is {policy.max_open_orders}.",
            )
        else:
            ok("max_open_orders")
        opening_new_position = intent.side == OrderSide.BUY and position_quantity <= 0
        if (
            opening_new_position
            and policy.max_open_positions is not None
            and open_positions >= policy.max_open_positions
        ):
            block(
                "max_open_positions",
                f"You already hold {open_positions} position(s); the limit is {policy.max_open_positions}.",
            )
        else:
            ok("max_open_positions")

        # 8. per-trade risk from the stop distance
        if policy.stop_loss_required and intent.stop_loss is None and intent.side == OrderSide.BUY:
            block(
                "stop_loss_required",
                "A stop-loss price is required by your risk policy for new long positions.",
            )
        elif intent.stop_loss and intent.price:
            risk_per_unit = abs(intent.price - intent.stop_loss)
            risk_amount = risk_per_unit * intent.quantity
            allowance = equity * policy.max_risk_per_trade_pct / Decimal(100) if equity else ZERO
            if allowance > 0 and risk_amount > allowance:
                block(
                    "max_risk_per_trade",
                    f"Risking {risk_amount:.2f} USDT exceeds your per-trade risk allowance "
                    f"of {allowance:.2f} USDT ({policy.max_risk_per_trade_pct}% of equity).",
                )
            else:
                ok("max_risk_per_trade")
        else:
            ok("stop_loss_required", "no stop-loss supplied and policy does not require one")

        # 9. balance
        if intent.side == OrderSide.BUY and notional > available_quote:
            block(
                "insufficient_balance",
                f"Insufficient balance: order needs {notional:.2f} USDT but {available_quote:.2f} USDT is available.",
            )
        else:
            ok("insufficient_balance")
        if intent.side == OrderSide.SELL and position_quantity < intent.quantity:
            block(
                "insufficient_position",
                f"You can only sell {position_quantity} {intent.symbol}, not {intent.quantity}.",
            )
        else:
            ok("insufficient_position")

        # 10. approval policy
        if intent.mode == TradingMode.live and not manual_approval and not (self.automation_enabled and policy.automation_opt_in):
            block(
                "manual_approval_required",
                "Live orders must be approved manually until automation is explicitly enabled.",
            )
        else:
            ok("manual_approval")

        # ---- non-blocking warnings --------------------------------------
        if intent.volatility_pct is not None and intent.volatility_pct > 3:
            warn("high_volatility", f"Volatility is elevated: ATR is {intent.volatility_pct:.2f}% of price.")
        if intent.spread_bps is not None and intent.spread_bps > 15:
            warn("low_liquidity", f"Spread is {intent.spread_bps:.1f} bps; fills may be worse than expected.")
        if intent.expected_slippage_bps is not None:
            warn(
                "slippage_estimate",
                f"Estimated slippage is {intent.expected_slippage_bps:.1f} bps; stop-losses do not cap slippage.",
            )

        approved = not violations
        return RiskDecision(approved, violations, warnings, checks)


# ------------------------------------------------------------------ state helpers
def trading_day_start(now: datetime | None = None) -> datetime:
    now = now or utcnow()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def paper_daily_realized_pnl(db: Session, user_id: str, since: datetime) -> Decimal:

    rows = db.scalars(
        select(PaperPosition.realized_pnl).where(
            PaperPosition.user_id == user_id,
            PaperPosition.status == "closed",
            PaperPosition.closed_at >= since,
        )
    ).all()
    return sum((Decimal(str(r)) for r in rows if r is not None), ZERO)


def count_open_orders(db: Session, user_id: str, mode: TradingMode) -> int:
    if mode == TradingMode.live:
        from ..db.models import ExchangeOrder

        return int(
            db.scalar(
                select(func.count())
                .select_from(ExchangeOrder)
                .where(
                    ExchangeOrder.user_id == user_id,
                    ExchangeOrder.status.in_(
                        [OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED, OrderStatus.PENDING_APPROVAL]
                    ),
                )
            )
            or 0
        )
    from ..db.models import PaperOrder

    return int(
        db.scalar(
            select(func.count())
            .select_from(PaperOrder)
            .where(
                PaperOrder.user_id == user_id,
                PaperOrder.status.in_([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED]),
            )
        )
        or 0
    )


def register_loss(db: Session, policy: RiskPolicy, realized_pnl: Decimal, *, now: datetime | None = None) -> None:
    """Track consecutive losses and start a cooldown when the threshold is hit."""
    now = now or utcnow()
    if realized_pnl < 0:
        policy.consecutive_losses = (policy.consecutive_losses or 0) + 1
        if policy.cooldown_after_losses and policy.consecutive_losses >= policy.cooldown_after_losses:
            policy.cooldown_until = now + timedelta(minutes=policy.cooldown_minutes or 60)
            policy.consecutive_losses = 0
    elif realized_pnl > 0:
        policy.consecutive_losses = 0
