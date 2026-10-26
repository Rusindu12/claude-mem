from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...core.config import Settings, get_settings
from ...core.errors import ValidationAppError
from ...db.base import get_db
from ...db.models import ExchangeOrder, OrderStatus, RiskPolicy, TradingMode, User
from ...deps import get_current_user, get_market, order_service, rate_limit
from ...schemas.api import LiveOptInRequest, RiskPolicyUpdate
from ...services import audit
from ...services.market import MarketService
from ...services.orders import OrderService
from ...services.risk import ensure_policy, get_control, paper_daily_realized_pnl, trading_day_start

router = APIRouter(prefix="/risk", tags=["risk"])


def _serialize_policy(policy: RiskPolicy) -> dict:
    return {
        "max_trade_notional": str(policy.max_trade_notional),
        "max_portfolio_exposure_pct": str(policy.max_portfolio_exposure_pct),
        "max_daily_loss": str(policy.max_daily_loss),
        "max_risk_per_trade_pct": str(policy.max_risk_per_trade_pct),
        "max_open_orders": policy.max_open_orders,
        "max_open_positions": policy.max_open_positions,
        "stop_loss_required": policy.stop_loss_required,
        "cooldown_after_losses": policy.cooldown_after_losses,
        "cooldown_minutes": policy.cooldown_minutes,
        "live_opt_in": policy.live_opt_in,
        "live_consent_at": policy.live_consent_at.isoformat() if policy.live_consent_at else None,
        "automation_opt_in": policy.automation_opt_in,
        "cooldown_until": policy.cooldown_until.isoformat() if policy.cooldown_until else None,
        "consecutive_losses": policy.consecutive_losses,
        "daily_loss_hit_at": policy.daily_loss_hit_at.isoformat() if policy.daily_loss_hit_at else None,
    }


@router.get("/policy", dependencies=[Depends(rate_limit("risk", 120))])
def get_policy(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return _serialize_policy(ensure_policy(db, user))


@router.put("/policy", dependencies=[Depends(rate_limit("risk", 30))])
def update_policy(
    payload: RiskPolicyUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    policy = ensure_policy(db, user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(policy, field, value)
    if payload.automation_opt_in and not policy.live_opt_in:
        raise ValidationAppError("Enable live trading before enabling automation.")
    audit.record(db, action="risk.policy_updated", user=user, detail=payload.model_dump(exclude_unset=True))
    db.flush()
    return _serialize_policy(policy)


@router.get("/status", dependencies=[Depends(rate_limit("risk", 120))])
def risk_status(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    market: MarketService = Depends(get_market),
) -> dict:
    policy = ensure_policy(db, user)
    control = get_control(db)
    since = trading_day_start()
    daily_pnl = paper_daily_realized_pnl(db, user.id, since)
    now = datetime.now(timezone.utc)
    live_orders = db.scalars(
        select(ExchangeOrder).where(
            ExchangeOrder.user_id == user.id,
            ExchangeOrder.status.in_([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED, OrderStatus.UNKNOWN]),
        )
    ).all()
    return {
        "policy": _serialize_policy(policy),
        "control": {
            "kill_switch": control.kill_switch,
            "reason": control.reason,
            "stale_data_block": control.stale_data_block,
            "api_error_block": control.api_error_block,
            "activated_at": control.activated_at.isoformat() if control.activated_at else None,
        },
        "server": {
            "live_trading_enabled": settings.live_trading_enabled,
            "automation_enabled": settings.automation_enabled,
            "require_manual_approval": settings.require_manual_approval,
            "binance_environment": settings.binance_env,
            "risk_engine_enabled": settings.risk_engine_enabled,
        },
        "usage": {
            "daily_realized_pnl": str(daily_pnl),
            "daily_loss_limit": str(policy.max_daily_loss),
            "cooldown_active": bool(policy.cooldown_until and policy.cooldown_until > now),
            "open_live_orders": len(live_orders),
            "unreconciled_orders": len([o for o in live_orders if o.status == OrderStatus.UNKNOWN]),
        },
        "market": market.health(),
        "can_trade_live": bool(
            settings.live_trading_enabled
            and policy.live_opt_in
            and not control.kill_switch
            and not market.is_synthetic()
        ),
    }


@router.post("/live-opt-in", dependencies=[Depends(rate_limit("risk", 10))])
def live_opt_in(
    payload: LiveOptInRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
    service: OrderService = Depends(order_service),
) -> dict:
    if payload.confirmation.strip().upper() != "ENABLE LIVE TRADING":
        raise ValidationAppError('Type "ENABLE LIVE TRADING" exactly to confirm.')
    if payload.opt_in and not payload.acknowledge_risk:
        raise ValidationAppError("You must acknowledge the trading risk to enable live trading.")
    if payload.opt_in and not settings.live_trading_enabled:
        raise ValidationAppError("Live trading is disabled on this server.")
    policy = ensure_policy(db, user)
    policy.live_opt_in = payload.opt_in
    policy.live_consent_at = datetime.now(timezone.utc) if payload.opt_in else None
    if not payload.opt_in:
        policy.automation_opt_in = False
    audit.record(
        db,
        action="risk.live_opt_in_changed",
        user=user,
        detail={"opt_in": payload.opt_in, "environment": settings.binance_env},
    )
    db.flush()
    return {
        "live_opt_in": policy.live_opt_in,
        "automation_opt_in": policy.automation_opt_in,
        "note": (
            "Live trading enabled with manual approval for every order. Automation stays off until you "
            "enable it separately after testing."
            if payload.opt_in
            else "Live trading disabled. Open orders were not automatically cancelled."
        ),
        "policy": _serialize_policy(policy),
    }


@router.post("/emergency-stop", dependencies=[Depends(rate_limit("risk", 10))])
def emergency_stop(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> dict:
    """User-level kill switch: disable live trading and cancel open orders."""
    policy = ensure_policy(db, user)
    policy.live_opt_in = False
    policy.automation_opt_in = False
    cancelled, failed = [], []
    for order in service.list_orders(user, mode=TradingMode.paper, open_only=True):
        try:
            service.cancel(user, order["id"], TradingMode.paper)
            cancelled.append(order["id"])
        except Exception as exc:  # noqa: BLE001
            failed.append({"id": order["id"], "reason": str(exc)})
    for order in service.list_orders(user, mode=TradingMode.live, open_only=True):
        try:
            service.cancel(user, order["id"], TradingMode.live)
            cancelled.append(order["id"])
        except Exception as exc:  # noqa: BLE001 - reported to the user
            failed.append({"id": order["id"], "reason": str(exc)})
    audit.record(
        db,
        action="risk.emergency_stop",
        user=user,
        detail={"cancelled": cancelled, "failed": failed},
    )
    return {
        "live_opt_in": False,
        "automation_opt_in": False,
        "cancelled_orders": cancelled,
        "failed_cancellations": failed,
        "message": "Live trading disabled and open orders cancelled. Verify on Binance as well.",
    }


@router.get("/exposure", dependencies=[Depends(rate_limit("risk", 60))])
def exposure(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    market: MarketService = Depends(get_market),
    settings: Settings = Depends(get_settings),
) -> dict:
    from ...services.portfolio import PortfolioService

    portfolio = PortfolioService(settings, market)
    paper = portfolio.summary(db, user, TradingMode.paper)
    policy = ensure_policy(db, user)
    equity = Decimal(str(paper["total_value_usdt"]))
    exposure_value = Decimal(str(paper["exposure"]))
    ceiling = equity * policy.max_portfolio_exposure_pct / Decimal(100)
    return {
        "mode": "paper",
        "equity": str(equity),
        "exposure": str(exposure_value),
        "exposure_pct": str((exposure_value / equity * 100).quantize(Decimal("0.01"))) if equity else None,
        "ceiling_pct": str(policy.max_portfolio_exposure_pct),
        "ceiling_value": str(ceiling),
        "remaining_capacity": str(max(Decimal(0), ceiling - exposure_value)),
    }
