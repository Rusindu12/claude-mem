"""FastAPI dependencies: auth, rate limiting and service wiring."""
from __future__ import annotations

import logging
from dataclasses import dataclass

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .core.config import Settings, get_settings
from .core.errors import AuthError, ForbiddenError, RateLimitedError
from .core.security import TokenError, decode_token
from .db.base import get_db
from .db.models import User, UserRole, UserStatus

log = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)


@dataclass
class RequestContext:
    ip: str | None
    user_agent: str | None
    request_id: str | None

    @property
    def audit_fields(self) -> dict[str, str | None]:
        return {"ip_address": self.ip, "user_agent": self.user_agent}


def get_request_context(request: Request, settings: Settings = Depends(get_settings)) -> RequestContext:
    ip = None
    if settings.trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for")
        if forwarded:
            ip = forwarded.split(",")[0].strip()
        else:
            ip = request.headers.get("x-real-ip")
    if not ip:
        ip = request.client.host if request.client else None
    return RequestContext(
        ip=ip,
        user_agent=request.headers.get("user-agent"),
        request_id=request.headers.get("x-request-id"),
    )


def get_market(request: Request):
    return request.app.state.market


def get_notifications(request: Request):
    return request.app.state.notifications


def get_credentials_service(request: Request):
    return request.app.state.credentials


def get_signal_service(request: Request):
    return request.app.state.signal_service


def get_portfolio_service(request: Request):
    return request.app.state.portfolio


def get_alert_service(request: Request):
    return request.app.state.alerts


def get_assistant_service(request: Request):
    return request.app.state.assistant


def get_rate_limiter(request: Request):
    return request.app.state.rate_limiter


# ------------------------------------------------------------------ auth guards
def _extract_user(
    credentials: HTTPAuthorizationCredentials | None,
    db: Session,
    settings: Settings,
) -> User:
    if credentials is None or not credentials.credentials:
        raise AuthError("Sign in to continue.")
    try:
        payload = decode_token(credentials.credentials, settings, expected_type="access")
    except TokenError as exc:
        raise AuthError(str(exc)) from exc
    user = db.get(User, payload.get("sub"))
    if user is None or user.deleted_at is not None or user.status == UserStatus.deleted:
        raise AuthError("This account is no longer available.")
    if user.status != UserStatus.active:
        raise ForbiddenError("This account is suspended. Contact support.")
    # A password change (or reset) bumps the generation and revokes old tokens.
    if int(payload.get("ver", 0)) != int(user.token_version or 0):
        raise AuthError("Your session is no longer valid. Please sign in again.")
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    return _extract_user(credentials, db, settings)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User | None:
    if credentials is None:
        return None
    try:
        return _extract_user(credentials, db, settings)
    except (AuthError, ForbiddenError):
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != UserRole.admin:
        raise ForbiddenError("Administrator access is required for this action.")
    return user


# ---------------------------------------------------------------- rate limiting
def _scope_limit(scope: str, settings: Settings) -> int:
    if scope == "auth":
        return settings.rate_limit_auth_per_minute
    if scope == "orders":
        return settings.rate_limit_orders_per_minute
    return settings.rate_limit_default_per_minute


def rate_limit(scope: str, limit: int | None = None, window: int = 60):
    """Dependency factory. Keyed by the caller's token when present."""

    def _dependency(
        request: Request,
        ctx: RequestContext = Depends(get_request_context),
        limiter=Depends(get_rate_limiter),
        settings: Settings = Depends(get_settings),
    ) -> None:
        subject = ctx.ip or "unknown"
        authorization = request.headers.get("authorization")
        if authorization:
            subject = f"token:{hash(authorization) & 0xFFFFFFFF:x}"
        effective = limit or _scope_limit(scope, settings)
        allowed, retry_after = limiter.check(f"{scope}:{subject}", effective, window)
        if not allowed:
            raise RateLimitedError(
                "Too many requests. Please slow down.",
                details={"retry_after_seconds": retry_after, "scope": scope},
            )

    return _dependency


def order_service(db: Session = Depends(get_db), request: Request = None):
    """Build an OrderService bound to this request's DB session."""
    from .services.orders import OrderService

    return OrderService(
        db=db,
        settings=request.app.state.settings,
        market=request.app.state.market,
        credentials=request.app.state.credentials,
        notifications=request.app.state.notifications,
    )
