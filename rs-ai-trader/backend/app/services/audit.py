"""Append-only audit trail used for security review and admin oversight."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.security import redact
from ..db.models import AuditEvent, User

log = logging.getLogger(__name__)


def record(
    db: Session,
    *,
    action: str,
    user: User | None = None,
    actor_role: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    outcome: str = "success",
    ip_address: str | None = None,
    user_agent: str | None = None,
    detail: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        user_id=user.id if user else None,
        actor_role=actor_role or (user.role.value if user and user.role else "anonymous"),
        action=action,
        target_type=target_type,
        target_id=target_id,
        outcome=outcome,
        ip_address=ip_address,
        user_agent=(user_agent or "")[:255] or None,
        detail=redact(detail or {}),
    )
    db.add(event)
    db.flush()
    return event


def query(
    db: Session,
    *,
    user_id: str | None = None,
    action: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AuditEvent]:
    stmt = select(AuditEvent).order_by(AuditEvent.created_at.desc())
    if user_id:
        stmt = stmt.where(AuditEvent.user_id == user_id)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    return list(db.scalars(stmt.offset(offset).limit(limit)).all())


def serialize(event: AuditEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "user_id": event.user_id,
        "actor_role": event.actor_role,
        "action": event.action,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "outcome": event.outcome,
        "ip_address": event.ip_address,
        "detail": redact(event.detail or {}),
        "created_at": event.created_at.isoformat(),
    }
