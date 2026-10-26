"""Admin surface.

Admins can manage configuration, users and service health. They deliberately
**cannot** read users' exchange secrets, decrypt credentials, or disable the
mandatory risk checks — those operations are not exposed by any endpoint.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ...core.config import Settings, get_settings
from ...core.errors import NotFoundError, ValidationAppError
from ...db.base import get_db
from ...db.models import (
    ApiCredential,
    AuditEvent,
    ExchangeOrder,
    PaperOrder,
    RiskPolicy,
    SignalRecord,
    TradingMode,
    User,
    UserStatus,
)
from ...deps import get_market, rate_limit, require_admin
from ...schemas.api import AdminUserUpdate, KillSwitchRequest, PairToggleRequest, SettingUpdateRequest
from ...services import app_settings, audit
from ...services.auth import AuthService
from ...services.market import MarketService
from ...services.risk import get_control

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(rate_limit("admin", 120))])


@router.get("/users")
def list_users(
    search: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    stmt = select(User).order_by(User.created_at.desc())
    if search:
        stmt = stmt.where(User.email.ilike(f"%{search}%"))
    users = db.scalars(stmt.offset(offset).limit(limit)).all()
    total = db.scalar(select(func.count()).select_from(User)) or 0
    credential_counts = dict(
        db.execute(select(ApiCredential.user_id, func.count()).group_by(ApiCredential.user_id)).all()
    )
    return {
        "total": total,
        "users": [
            {
                **AuthService.serialize_user(user),
                "has_exchange_key": bool(credential_counts.get(user.id)),
                "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
                "deleted_at": user.deleted_at.isoformat() if user.deleted_at else None,
            }
            for user in users
        ],
        "note": "Exchange secrets are never exposed to administrators.",
    }


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    target = db.get(User, user_id)
    if target is None:
        raise NotFoundError("User not found.")
    if target.id == admin.id and payload.role == "user":
        raise ValidationAppError("You cannot remove your own admin role.")
    if payload.status:
        target.status = UserStatus.active if payload.status == "active" else UserStatus.suspended
    if payload.role:
        AuthService(get_settings()).set_role(db, actor=admin, target_user_id=user_id, role=payload.role)
    audit.record(
        db,
        action="admin.user_updated",
        user=admin,
        target_type="user",
        target_id=user_id,
        detail=payload.model_dump(exclude_none=True),
    )
    db.flush()
    return AuthService.serialize_user(target)


@router.get("/health")
def system_health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    market: MarketService = Depends(get_market),
    admin: User = Depends(require_admin),
) -> dict:
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover
        db_status = f"unavailable: {exc.__class__.__name__}"
    control = get_control(db)
    counts = {
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "active_users": db.scalar(
            select(func.count()).select_from(User).where(User.status == UserStatus.active)
        )
        or 0,
        "paper_orders": db.scalar(select(func.count()).select_from(PaperOrder)) or 0,
        "live_orders": db.scalar(select(func.count()).select_from(ExchangeOrder)) or 0,
        "signals": db.scalar(select(func.count()).select_from(SignalRecord)) or 0,
        "audit_events": db.scalar(select(func.count()).select_from(AuditEvent)) or 0,
    }
    return {
        "database": db_status,
        "market": market.health(),
        "trading_control": {
            "kill_switch": control.kill_switch,
            "reason": control.reason,
            "stale_data_block": control.stale_data_block,
            "api_error_block": control.api_error_block,
        },
        "config": {
            "environment": settings.environment,
            "binance_env": settings.binance_env,
            "live_trading_enabled": settings.live_trading_enabled,
            "automation_enabled": settings.automation_enabled,
            "market_data_mode": settings.market_data_mode,
            "ai_engine_path": settings.ai_engine_path,
        },
        "counts": counts,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/audit")
def audit_log(
    action: str | None = None,
    user_id: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict]:
    events = audit.query(db, user_id=user_id, action=action, limit=limit, offset=offset)
    return [audit.serialize(event) for event in events]


@router.get("/settings")
def get_settings_view(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    return {"settings": app_settings.all_settings(db)}


@router.put("/settings")
def update_setting(
    payload: SettingUpdateRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    row = app_settings.set_value(db, payload.key, payload.value, actor=admin)
    return {"key": row.key, "value": (row.value or {}).get("value")}


@router.get("/pairs")
def pairs(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> list[dict]:
    return app_settings.list_pairs(db)


@router.post("/pairs/sync")
def sync_pairs(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
    market: MarketService = Depends(get_market),
    settings: Settings = Depends(get_settings),
) -> dict:
    result = app_settings.sync_pairs(db, market, settings)
    audit.record(db, action="admin.pairs_synced", user=admin, detail=result)
    return result


@router.patch("/pairs/{symbol}")
def toggle_pair(
    symbol: str,
    payload: PairToggleRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    pair = app_settings.set_pair_enabled(db, symbol, payload.enabled, actor=admin)
    return {"symbol": pair.symbol, "enabled": pair.enabled}


@router.post("/kill-switch")
def kill_switch(
    payload: KillSwitchRequest,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    control = get_control(db)
    control.kill_switch = payload.engage
    control.reason = payload.reason
    control.activated_by = admin.id
    control.activated_at = datetime.now(timezone.utc) if payload.engage else None
    audit.record(
        db,
        action="admin.kill_switch",
        user=admin,
        target_type="trading_control",
        target_id="global",
        detail={"engage": payload.engage, "reason": payload.reason},
        outcome="success" if payload.engage else "info",
    )
    db.flush()
    return {
        "kill_switch": control.kill_switch,
        "reason": control.reason,
        "message": (
            "Trading is disabled for all users. Existing exchange orders are not cancelled automatically — "
            "cancel them on Binance if required."
            if payload.engage
            else "Trading re-enabled."
        ),
    }


@router.get("/stats")
def stats(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    since = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "signals_today": db.scalar(
            select(func.count()).select_from(SignalRecord).where(SignalRecord.created_at >= since)
        )
        or 0,
        "paper_orders_today": db.scalar(
            select(func.count()).select_from(PaperOrder).where(PaperOrder.created_at >= since)
        )
        or 0,
        "failed_logins_today": db.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(AuditEvent.action == "auth.login_failed", AuditEvent.created_at >= since)
        )
        or 0,
        "live_orders_open": db.scalar(
            select(func.count())
            .select_from(ExchangeOrder)
            .where(ExchangeOrder.mode == TradingMode.live, ExchangeOrder.status.in_(["NEW", "PARTIALLY_FILLED", "UNKNOWN"]))
        )
        or 0,
    }


@router.get("/users/{user_id}/risk-summary")
def user_risk_summary(
    user_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
) -> dict:
    """Risk configuration overview — no balances, no secrets."""
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found.")
    policy = db.scalar(select(RiskPolicy).where(RiskPolicy.user_id == user_id))
    if policy is None:
        raise NotFoundError("This user has no risk policy.")
    return {
        "user_id": user_id,
        "live_opt_in": policy.live_opt_in,
        "automation_opt_in": policy.automation_opt_in,
        "max_trade_notional": str(policy.max_trade_notional),
        "max_daily_loss": str(policy.max_daily_loss),
        "cooldown_until": policy.cooldown_until.isoformat() if policy.cooldown_until else None,
        "note": "Admins cannot view balances, positions or exchange keys.",
    }
