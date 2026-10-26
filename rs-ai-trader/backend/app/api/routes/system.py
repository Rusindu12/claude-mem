from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...core.config import Settings, get_settings
from ...db.base import get_db
from ...db.models import User
from ...deps import get_current_user, get_market, get_notifications, rate_limit
from ...schemas.api import NotificationReadRequest
from ...services import app_settings
from ...services.market import MarketService
from ...services.notifications import NotificationService

router = APIRouter(tags=["system"])


@router.get("/health")
def health(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    market: MarketService = Depends(get_market),
) -> dict:
    database_ok = True
    try:
        db.execute(text("SELECT 1"))
    except Exception:  # pragma: no cover - database outage
        database_ok = False
    return {
        "status": "ok" if database_ok else "degraded",
        "app": settings.app_name,
        "version": "1.0.0",
        "environment": settings.environment,
        "time": datetime.now(timezone.utc).isoformat(),
        "database": "ok" if database_ok else "unavailable",
        "market_data": market.health(),
        "live_trading_enabled": settings.live_trading_enabled,
        "binance_environment": settings.binance_env,
    }


@router.get("/config")
def config(
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
    market: MarketService = Depends(get_market),
) -> dict:
    return app_settings.public_config(db, settings, market)


@router.get("/notifications", dependencies=[Depends(rate_limit("notifications", 120))])
def notifications(
    unread_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notifications),
) -> list[dict]:
    rows = service.list_for_user(db, user, limit=limit, unread_only=unread_only)
    return [service.serialize(row) for row in rows]


@router.post("/notifications/read", dependencies=[Depends(rate_limit("notifications", 120))])
def mark_read(
    payload: NotificationReadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: NotificationService = Depends(get_notifications),
) -> dict:
    updated = service.mark_read(db, user, payload.notification_id)
    return {"updated": updated}
