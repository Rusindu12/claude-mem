"""In-app notifications plus optional Firebase Cloud Messaging push.

Push payloads deliberately contain no balances, order sizes or credentials —
only a category, a short human message and a deep-link target. If FCM is not
configured, notifications are stored in the database and delivered when the
app next polls.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..db.models import Notification, User

log = logging.getLogger(__name__)

FORBIDDEN_KEYS = ("api_key", "api_secret", "secret", "password", "token", "balance", "quantity")


class NotificationService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._fcm_ready = bool(settings.fcm_credentials_path)

    # -- safety ------------------------------------------------------------
    def _safe_data(self, data: dict[str, Any] | None) -> dict[str, Any]:
        safe: dict[str, Any] = {}
        for key, value in (data or {}).items():
            if any(bad in key.lower() for bad in FORBIDDEN_KEYS):
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                safe[key] = value
        return safe

    # -- delivery ----------------------------------------------------------
    def notify(
        self,
        db: Session,
        user: User,
        *,
        kind: str,
        title: str,
        body: str,
        severity: str = "info",
        data: dict[str, Any] | None = None,
        push: bool = True,
    ) -> Notification:
        notification = Notification(
            user_id=user.id,
            kind=kind,
            title=title[:120],
            body=body[:500],
            severity=severity,
            data=self._safe_data(data),
        )
        db.add(notification)
        db.flush()
        if push and self._fcm_ready and user.fcm_token:
            self._send_push(user.fcm_token, title, body, notification.data)
        return notification

    def _send_push(self, token: str, title: str, body: str, data: dict[str, Any]) -> None:
        """Optional FCM v1 send. Imported lazily so the dependency is optional."""
        try:
            import firebase_admin  # type: ignore
            from firebase_admin import messaging  # type: ignore
        except ImportError:
            log.info("FCM requested but firebase-admin is not installed; notification stored only")
            return
        try:
            if not firebase_admin._apps:  # pragma: no cover - requires credentials
                cred = firebase_admin.credentials.Certificate(self.settings.fcm_credentials_path)
                firebase_admin.initialize_app(cred)
            message = messaging.Message(
                token=token,
                notification=messaging.Notification(title=title, body=body),
                data={k: str(v) for k, v in data.items()},
            )
            messaging.send(message)
        except Exception as exc:  # pragma: no cover - network/credentials
            log.warning("FCM push failed: %s", exc)

    # -- queries -----------------------------------------------------------
    def list_for_user(self, db: Session, user: User, *, limit: int = 50, unread_only: bool = False) -> list[Notification]:
        stmt = select(Notification).where(Notification.user_id == user.id).order_by(Notification.created_at.desc())
        if unread_only:
            stmt = stmt.where(Notification.read_at.is_(None))
        return list(db.scalars(stmt.limit(limit)).all())

    def mark_read(self, db: Session, user: User, notification_id: str | None = None) -> int:
        stmt = select(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
        if notification_id:
            stmt = stmt.where(Notification.id == notification_id)
        rows = list(db.scalars(stmt).all())
        now = datetime.now(timezone.utc)
        for row in rows:
            row.read_at = now
        return len(rows)

    @staticmethod
    def serialize(notification: Notification) -> dict[str, Any]:
        return {
            "id": notification.id,
            "kind": notification.kind,
            "title": notification.title,
            "body": notification.body,
            "severity": notification.severity,
            "data": notification.data,
            "read": notification.read_at is not None,
            "created_at": notification.created_at.isoformat(),
        }
