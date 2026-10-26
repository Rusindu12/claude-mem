"""Authentication, sessions and account lifecycle."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import AuthError, ConflictError, ForbiddenError, NotFoundError, ValidationAppError
from ..core.security import (
    TokenError,
    create_token,
    decode_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    needs_rehash,
    validate_password_strength,
    verify_password,
)
from ..db.models import (
    ApiCredential,
    CredentialStatus,
    PaperPosition,
    PasswordResetToken,
    RefreshToken,
    User,
    UserRole,
    UserStatus,
)
from . import audit
from .paper import ensure_paper_account
from .risk import default_policy

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def normalize_email(email: str) -> str:
    return email.strip().lower()


class AuthService:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def serialize_user(user: User) -> dict[str, Any]:
        return {
            "id": user.id,
            "email": user.email,
            "display_name": user.display_name,
            "role": user.role.value if hasattr(user.role, "value") else str(user.role),
            "status": user.status.value if hasattr(user.status, "value") else str(user.status),
            "language": user.language,
            "created_at": user.created_at.isoformat(),
            "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
        }

    def _issue_pair(self, db: Session, user: User, *, ip: str | None, user_agent: str | None, device: str | None = None) -> dict:
        # ``ver`` pins the token to the account's token generation, so a
        # password change/reset invalidates every previously issued token.
        access, access_expires, _ = create_token(
            user.id, "access", self.settings, role=user.role.value, extra={"ver": user.token_version or 0}
        )
        refresh, refresh_expires, jti = create_token(
            user.id, "refresh", self.settings, role=user.role.value, extra={"ver": user.token_version or 0}
        )
        db.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(refresh),
                jti=jti,
                expires_at=refresh_expires,
                ip_address=ip,
                user_agent=(user_agent or "")[:255] or None,
                device_label=(device or "")[:80] or None,
            )
        )
        db.flush()
        return {
            "access_token": access,
            "refresh_token": refresh,
            "token_type": "Bearer",
            "expires_in": int((access_expires - _now()).total_seconds()),
            "refresh_expires_in": int((refresh_expires - _now()).total_seconds()),
            "user": self.serialize_user(user),
        }

    # --------------------------------------------------------------- register
    def register(
        self,
        db: Session,
        *,
        email: str,
        password: str,
        display_name: str = "Trader",
        language: str = "en",
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> dict:
        email = normalize_email(email)
        if "@" not in email or len(email) > 255:
            raise ValidationAppError("Enter a valid email address.")
        problems = validate_password_strength(password, self.settings)
        if problems:
            raise ValidationAppError("Password is not strong enough.", details={"problems": problems})
        if db.scalar(select(User).where(User.email == email)) is not None:
            raise ConflictError("An account with this email already exists.")

        user = User(
            email=email,
            password_hash=hash_password(password),
            display_name=display_name.strip()[:80] or "Trader",
            role=UserRole.user,
            status=UserStatus.active,
            language=language if language in ("en", "si") else "en",
            password_changed_at=_now(),
        )
        db.add(user)
        db.flush()
        db.add(default_policy(user.id))
        ensure_paper_account(db, user)
        audit.record(db, action="user.registered", user=user, ip_address=ip, user_agent=user_agent)
        tokens = self._issue_pair(db, user, ip=ip, user_agent=user_agent, device="registration")
        return tokens

    # ------------------------------------------------------------------ login
    def login(
        self,
        db: Session,
        *,
        email: str,
        password: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> dict:
        email = normalize_email(email)
        user = db.scalar(select(User).where(User.email == email))
        now = _now()

        if user is None:
            # Perform a hash anyway to keep timing roughly constant.
            verify_password(password, "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzYWx0c2FsdA$" + "0" * 43)
            audit.record(
                db, action="auth.login_failed", ip_address=ip, user_agent=user_agent,
                outcome="denied", detail={"reason": "unknown_email"},
            )
            # Persist the audit trail before the request fails (the dependency
            # would otherwise roll it back).
            db.commit()
            raise AuthError("Email or password is incorrect.")

        if user.locked_until and user.locked_until > now:
            raise AuthError(
                "This account is temporarily locked after repeated failed attempts.",
                details={"retry_after_seconds": int((user.locked_until - now).total_seconds())},
            )
        if not user.is_active:
            raise ForbiddenError("This account is not active. Contact support.")

        if not verify_password(password, user.password_hash):
            user.failed_login_attempts += 1
            remaining = max(0, self.settings.max_login_attempts - user.failed_login_attempts)
            if user.failed_login_attempts >= self.settings.max_login_attempts:
                user.locked_until = now + timedelta(minutes=self.settings.login_lockout_minutes)
                user.failed_login_attempts = 0
            audit.record(
                db, action="auth.login_failed", user=user, ip_address=ip, user_agent=user_agent,
                outcome="denied", detail={"remaining_attempts": remaining},
            )
            db.commit()
            raise AuthError("Email or password is incorrect.")

        if needs_rehash(user.password_hash):
            user.password_hash = hash_password(password)
        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = now
        audit.record(db, action="auth.login", user=user, ip_address=ip, user_agent=user_agent)
        return self._issue_pair(db, user, ip=ip, user_agent=user_agent)

    # ---------------------------------------------------------------- refresh
    def refresh(
        self,
        db: Session,
        *,
        refresh_token: str,
        ip: str | None = None,
        user_agent: str | None = None,
    ) -> dict:
        try:
            # Validates signature, expiry and token type; the claims themselves are
            # not needed here because the row below is the source of truth.
            decode_token(refresh_token, self.settings, expected_type="refresh")
        except TokenError as exc:
            raise AuthError("Session expired. Please sign in again.") from exc
        token_hash = hash_token(refresh_token)
        record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == token_hash))
        if record is None:
            raise AuthError("Session not recognised. Please sign in again.")
        if record.revoked_at is not None:
            # Reuse of a rotated token: revoke the whole family — likely theft.
            log.warning("refresh token reuse detected for user %s", record.user_id)
            self._revoke_all(db, record.user_id)
            audit.record(
                db, action="auth.refresh_reuse_detected", target_type="user", target_id=record.user_id,
                outcome="denied", ip_address=ip,
            )
            db.commit()  # the revocation must survive the failed request
            raise AuthError("This session was already used. All sessions have been signed out for your safety.")
        if record.expires_at <= _now():
            db.commit()
            raise AuthError("Session expired. Please sign in again.")

        user = db.get(User, record.user_id)
        if user is None or not user.is_active:
            raise ForbiddenError("This account is no longer active.")

        record.revoked_at = _now()
        tokens = self._issue_pair(db, user, ip=ip or record.ip_address, user_agent=user_agent or record.user_agent)
        record.replaced_by_jti = decode_token(tokens["refresh_token"], self.settings, expected_type="refresh")["jti"]
        return tokens

    # ----------------------------------------------------------------- logout
    def logout(self, db: Session, refresh_token: str | None, user: User | None = None) -> None:
        if refresh_token:
            record = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)))
            if record is not None and (user is None or record.user_id == user.id):
                record.revoked_at = _now()
        if user is not None:
            audit.record(db, action="auth.logout", user=user)

    def _revoke_all(self, db: Session, user_id: str) -> None:
        rows = db.scalars(select(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))).all()
        now = _now()
        for row in rows:
            row.revoked_at = now

    def logout_all(self, db: Session, user: User) -> int:
        rows = db.scalars(
            select(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        ).all()
        count = len(rows)
        self._revoke_all(db, user.id)
        audit.record(db, action="auth.logout_all", user=user, detail={"revoked": count})
        return count

    def sessions(self, db: Session, user: User) -> list[dict]:
        rows = db.scalars(
            select(RefreshToken)
            .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > _now())
            .order_by(RefreshToken.created_at.desc())
        ).all()
        return [
            {
                "id": row.id,
                "device": row.device_label or "Unknown device",
                "ip_address": row.ip_address,
                "user_agent": row.user_agent,
                "created_at": row.created_at.isoformat(),
                "expires_at": row.expires_at.isoformat(),
                "current": False,
            }
            for row in rows
        ]

    def revoke_session(self, db: Session, user: User, session_id: str) -> None:
        row = db.get(RefreshToken, session_id)
        if row is None or row.user_id != user.id:
            raise NotFoundError("Session not found.")
        row.revoked_at = _now()
        audit.record(db, action="auth.session_revoked", user=user, target_type="session", target_id=session_id)

    # ---------------------------------------------------------------- password
    def change_password(self, db: Session, user: User, *, current_password: str, new_password: str) -> None:
        if not verify_password(current_password, user.password_hash):
            audit.record(db, action="auth.password_change_failed", user=user, outcome="denied")
            db.commit()
            raise AuthError("Current password is incorrect.")
        problems = validate_password_strength(new_password, self.settings)
        if problems:
            raise ValidationAppError("New password is not strong enough.", details={"problems": problems})
        user.password_hash = hash_password(new_password)
        user.password_changed_at = _now()
        user.token_version = (user.token_version or 0) + 1
        self._revoke_all(db, user.id)
        audit.record(db, action="auth.password_changed", user=user)

    def request_password_reset(self, db: Session, email: str, *, ip: str | None = None) -> str | None:
        """Create a reset token.

        Returns the raw token only outside production (no mail provider is
        bundled); in production it is logged nowhere and must be delivered by
        the operator's mail integration.
        """
        user = db.scalar(select(User).where(User.email == normalize_email(email)))
        if user is None:
            # Do not disclose whether the address exists.
            return None
        raw = generate_opaque_token(32)
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(raw),
                expires_at=_now() + timedelta(minutes=self.settings.password_reset_ttl_minutes),
            )
        )
        audit.record(db, action="auth.password_reset_requested", user=user, ip_address=ip)
        if self.settings.is_production:
            log.info("password reset token issued for user %s (deliver via configured mailer)", user.id)
            return None
        return raw

    def confirm_password_reset(self, db: Session, *, token: str, new_password: str) -> None:
        record = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token)))
        if record is None or record.used_at is not None or record.expires_at <= _now():
            raise ValidationAppError("This reset link is invalid or has expired.")
        problems = validate_password_strength(new_password, self.settings)
        if problems:
            raise ValidationAppError("Password is not strong enough.", details={"problems": problems})
        user = db.get(User, record.user_id)
        if user is None:
            raise ValidationAppError("This reset link is invalid or has expired.")
        user.password_hash = hash_password(new_password)
        user.password_changed_at = _now()
        user.token_version = (user.token_version or 0) + 1
        user.failed_login_attempts = 0
        user.locked_until = None
        record.used_at = _now()
        self._revoke_all(db, user.id)
        audit.record(db, action="auth.password_reset_completed", user=user)

    # ------------------------------------------------------------ account data
    def delete_account(self, db: Session, user: User, password: str) -> None:
        if not verify_password(password, user.password_hash):
            audit.record(db, action="user.account_deletion_denied", user=user, outcome="denied")
            db.commit()
            raise AuthError("Password is incorrect.")
        self._revoke_all(db, user.id)
        for credential in db.scalars(select(ApiCredential).where(ApiCredential.user_id == user.id)).all():
            credential.status = CredentialStatus.revoked
            credential.api_key_ciphertext = "deleted"
            credential.secret_ciphertext = "deleted"
        for position in db.scalars(select(PaperPosition).where(PaperPosition.user_id == user.id)).all():
            position.status = "deleted"
        user.status = UserStatus.deleted
        user.deleted_at = _now()
        user.token_version = (user.token_version or 0) + 1
        user.email = f"deleted+{user.id}@invalid.local"
        user.display_name = "Deleted user"
        user.password_hash = hash_password(generate_opaque_token(32))
        user.fcm_token = None
        audit.record(db, action="user.account_deleted", user=user)

    # ------------------------------------------------------------------- roles
    def create_admin(
        self,
        db: Session,
        *,
        email: str,
        password: str,
        display_name: str = "Administrator",
    ) -> User:
        email = normalize_email(email)
        problems = validate_password_strength(password, self.settings)
        if problems:
            raise ValidationAppError("Admin password is not strong enough.", details={"problems": problems})
        existing = db.scalar(select(User).where(User.email == email))
        if existing is not None:
            raise ConflictError("An account with this email already exists.")
        user = User(
            email=email,
            password_hash=hash_password(password),
            display_name=display_name,
            role=UserRole.admin,
            status=UserStatus.active,
            password_changed_at=_now(),
        )
        db.add(user)
        db.flush()
        db.add(default_policy(user.id))
        audit.record(db, action="admin.created", target_type="user", target_id=user.id, actor_role="system")
        return user

    def set_role(self, db: Session, *, actor: User, target_user_id: str, role: str) -> User:
        if role not in ("user", "admin"):
            raise ValidationAppError("Role must be 'user' or 'admin'.")
        target = db.get(User, target_user_id)
        if target is None:
            raise NotFoundError("User not found.")
        if target.id == actor.id and role != "admin":
            raise ValidationAppError("You cannot remove your own admin role.")
        target.role = UserRole.admin if role == "admin" else UserRole.user
        if role != "admin":
            # Demoted admins must lose any lingering admin-only view immediately.
            log.info("admin role removed from user %s by %s", target.id, actor.id)
        audit.record(
            db, action="admin.role_changed", user=actor, target_type="user", target_id=target.id,
            detail={"new_role": role},
        )
        return target
