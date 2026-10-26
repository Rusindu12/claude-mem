from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ...core.config import Settings, get_settings
from ...db.base import get_db
from ...db.models import User
from ...deps import RequestContext, get_current_user, get_request_context, rate_limit
from ...schemas.api import (
    AccountDeleteRequest,
    ChangePasswordRequest,
    FcmTokenRequest,
    LoginRequest,
    LogoutRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenPair,
)
from ...services import audit
from ...services.auth import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


def _service(settings: Settings = Depends(get_settings)) -> AuthService:
    return AuthService(settings)


@router.post(
    "/register",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit("auth"))],
)
def register(
    payload: RegisterRequest,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
    service: AuthService = Depends(_service),
) -> dict:
    tokens = service.register(
        db,
        email=payload.email,
        password=payload.password,
        display_name=payload.display_name,
        language=payload.language,
        ip=ctx.ip,
        user_agent=ctx.user_agent,
    )
    return tokens


@router.post("/login", response_model=TokenPair, dependencies=[Depends(rate_limit("auth"))])
def login(
    payload: LoginRequest,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
    service: AuthService = Depends(_service),
) -> dict:
    return service.login(
        db, email=payload.email, password=payload.password, ip=ctx.ip, user_agent=ctx.user_agent
    )


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(rate_limit("auth"))])
def refresh(
    payload: RefreshRequest,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
    service: AuthService = Depends(_service),
) -> dict:
    return service.refresh(db, refresh_token=payload.refresh_token, ip=ctx.ip, user_agent=ctx.user_agent)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    payload: LogoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_service),
):
    service.logout(db, payload.refresh_token, user)


@router.post("/logout-all", status_code=status.HTTP_200_OK)
def logout_all(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_service),
) -> dict:
    return {"revoked_sessions": service.logout_all(db, user)}


@router.get("/me")
def me(user: User = Depends(get_current_user)) -> dict:
    return AuthService.serialize_user(user)


@router.patch("/me")
def update_profile(
    display_name: str | None = None,
    language: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if display_name:
        user.display_name = display_name.strip()[:80] or user.display_name
    if language in ("en", "si"):
        user.language = language
    db.flush()
    audit.record(db, action="user.profile_updated", user=user, detail={"language": user.language})
    return AuthService.serialize_user(user)


@router.post("/password/change", status_code=status.HTTP_200_OK)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_service),
) -> dict:
    service.change_password(db, user, current_password=payload.current_password, new_password=payload.new_password)
    return {"message": "Password changed. All other sessions were signed out."}


@router.post("/password/reset/request", dependencies=[Depends(rate_limit("reset"))])
def request_reset(
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(get_request_context),
    service: AuthService = Depends(_service),
) -> dict:
    token = service.request_password_reset(db, payload.email, ip=ctx.ip)
    body: dict = {"message": "If that email is registered, reset instructions have been issued."}
    if token:
        # Development convenience only; production requires a mail integration.
        body["development_reset_token"] = token
    return body


@router.post("/password/reset/confirm")
def confirm_reset(
    payload: PasswordResetConfirm,
    db: Session = Depends(get_db),
    service: AuthService = Depends(_service),
) -> dict:
    service.confirm_password_reset(db, token=payload.token, new_password=payload.new_password)
    return {"message": "Password updated. Sign in with your new password."}


@router.get("/sessions")
def sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_service),
) -> list[dict]:
    return service.sessions(db, user)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_service),
):
    service.revoke_session(db, user, session_id)


@router.delete("/account", status_code=status.HTTP_200_OK)
def delete_account(
    payload: AccountDeleteRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AuthService = Depends(_service),
) -> dict:
    service.delete_account(db, user, payload.password)
    return {"message": "Account deleted. Exchange keys were erased and sessions revoked."}


@router.post("/fcm-token", status_code=status.HTTP_204_NO_CONTENT)
def register_fcm(
    payload: FcmTokenRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    user.fcm_token = payload.token[:400]
    db.flush()
