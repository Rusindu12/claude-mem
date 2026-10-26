"""Server-managed application configuration and supported-pair registry.

Only admins can change these values. Client-supplied flags are never trusted:
the Android app reads this configuration to decide which UI affordances to show,
but the backend re-checks every permission on each request.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..db.models import AppSetting, TradingPair, User
from . import audit
from .market import MarketService

log = logging.getLogger(__name__)

DEFAULTS: dict[str, dict[str, Any]] = {
    "maintenance_mode": {"value": False, "description": "Block trading and show a maintenance banner."},
    "min_app_version": {"value": "1.0.0", "description": "Oldest supported Android client version."},
    "risk_defaults": {
        "value": {
            "max_trade_notional": "100",
            "max_portfolio_exposure_pct": "25",
            "max_daily_loss": "50",
            "max_risk_per_trade_pct": "1",
            "max_open_orders": 3,
            "max_open_positions": 2,
            "stop_loss_required": True,
        },
        "description": "Defaults applied to new accounts.",
    },
    "assistant_enabled": {"value": True, "description": "Expose the bilingual assistant."},
    "push_notifications_enabled": {"value": True, "description": "Allow FCM push delivery."},
}


def get_value(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(AppSetting, key)
    if row is not None:
        return (row.value or {}).get("value", default)
    if key in DEFAULTS:
        return DEFAULTS[key]["value"]
    return default


def set_value(db: Session, key: str, value: Any, *, actor: User | None = None) -> AppSetting:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(
            key=key,
            value={"value": value},
            description=DEFAULTS.get(key, {}).get("description"),
            updated_by=actor.id if actor else None,
        )
        db.add(row)
    else:
        row.value = {"value": value}
        row.updated_by = actor.id if actor else None
    db.flush()
    audit.record(
        db, action="admin.setting_changed", user=actor, target_type="app_setting", target_id=key,
        detail={"value": value},
    )
    return row


def all_settings(db: Session) -> list[dict]:
    rows = db.scalars(select(AppSetting)).all()
    merged = {
        key: {"key": key, "value": spec["value"], "description": spec["description"], "updated_at": None}
        for key, spec in DEFAULTS.items()
    }
    for row in rows:
        merged[row.key] = {
            "key": row.key,
            "value": (row.value or {}).get("value"),
            "description": row.description,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "updated_by": row.updated_by,
        }
    return sorted(merged.values(), key=lambda item: item["key"])


# ------------------------------------------------------------------ trading pairs
def sync_pairs(db: Session, market: MarketService, settings: Settings) -> dict[str, int]:
    """Persist exchange filters for the configured symbols."""
    filters = market.filters()
    created = updated = 0
    for symbol in settings.symbol_list:
        flt = filters.get(symbol)
        if flt is None:
            log.warning("no exchange filters for %s; skipping", symbol)
            continue
        pair = db.get(TradingPair, symbol)
        if pair is None:
            pair = TradingPair(symbol=symbol, base_asset=flt.base_asset, quote_asset=flt.quote_asset, enabled=True)
            db.add(pair)
            created += 1
        else:
            updated += 1
        pair.status = flt.status
        pair.min_qty = flt.min_qty
        pair.max_qty = flt.max_qty
        pair.step_size = flt.step_size
        pair.tick_size = flt.tick_size
        pair.min_notional = flt.min_notional
        pair.max_num_orders = flt.max_num_orders
        pair.filters_synced_at = datetime.now(timezone.utc)
    db.flush()
    return {"created": created, "updated": updated}


def list_pairs(db: Session) -> list[dict]:
    rows = db.scalars(select(TradingPair).order_by(TradingPair.symbol)).all()
    return [
        {
            "symbol": row.symbol,
            "base_asset": row.base_asset,
            "quote_asset": row.quote_asset,
            "enabled": row.enabled,
            "status": row.status,
            "min_qty": str(row.min_qty) if row.min_qty is not None else None,
            "step_size": str(row.step_size) if row.step_size is not None else None,
            "tick_size": str(row.tick_size) if row.tick_size is not None else None,
            "min_notional": str(row.min_notional) if row.min_notional is not None else None,
            "filters_synced_at": row.filters_synced_at.isoformat() if row.filters_synced_at else None,
        }
        for row in rows
    ]


def set_pair_enabled(db: Session, symbol: str, enabled: bool, *, actor: User) -> TradingPair:
    pair = db.get(TradingPair, symbol.upper())
    if pair is None:
        pair = TradingPair(symbol=symbol.upper(), base_asset=symbol[:-4] or symbol, quote_asset="USDT")
        db.add(pair)
    pair.enabled = enabled
    db.flush()
    audit.record(
        db, action="admin.pair_updated", user=actor, target_type="trading_pair",
        target_id=pair.symbol, detail={"enabled": enabled},
    )
    return pair


# ------------------------------------------------------------ public app config
def public_config(db: Session, settings: Settings, market: MarketService) -> dict:
    return {
        "app_name": settings.app_name,
        "environment": settings.environment,
        "binance_environment": settings.binance_env,
        "maintenance_mode": bool(get_value(db, "maintenance_mode", False)),
        "min_app_version": get_value(db, "min_app_version", "1.0.0"),
        "assistant_enabled": bool(get_value(db, "assistant_enabled", True)),
        "supported_symbols": settings.symbol_list,
        "supported_timeframes": settings.timeframe_list,
        "paper_trading_enabled": settings.paper_trading_enabled,
        "live_trading_enabled": settings.live_trading_enabled,
        "automation_enabled": settings.automation_enabled,
        "require_manual_approval": settings.require_manual_approval,
        "market_data": market.health(),
        "stale_after_seconds": settings.market_stale_after_seconds,
        "assistant_languages": ["en", "si"],
        "disclaimer": (
            "RS AI TRADER provides analysis tools, not financial advice. Trading involves substantial "
            "risk of loss. Stop-losses reduce but do not eliminate losses."
        ),
        "server_time": datetime.now(timezone.utc).isoformat(),
    }
