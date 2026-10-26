from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ...core.config import Settings, get_settings
from ...db.base import get_db
from ...db.models import User
from ...deps import (
    RequestContext,
    get_credentials_service,
    get_current_user,
    get_request_context,
    rate_limit,
)
from ...schemas.api import CredentialCreateRequest
from ...services import audit
from ...services.credentials import CredentialService

router = APIRouter(prefix="/credentials", tags=["credentials"])


@router.get("", dependencies=[Depends(rate_limit("credentials", 60))])
def list_credentials(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: CredentialService = Depends(get_credentials_service),
    settings: Settings = Depends(get_settings),
) -> dict:
    return {
        "environment": settings.binance_env,
        "credentials": service.list_for_user(db, user),
        "guidance": {
            "required_permissions": ["Enable Reading", "Enable Spot & Margin Trading (spot only)"],
            "forbidden_permissions": ["Enable Withdrawals"],
            "recommended": [
                "Restrict access to trusted IP addresses",
                "Create a dedicated key for this app",
                "Rotate keys periodically",
            ],
            "note": (
                "Secrets are encrypted at rest on the server and never sent to the Android app. "
                "RS AI TRADER never requests or stores withdrawal permission."
            ),
        },
    }


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(rate_limit("credentials", 10))])
def add_credential(
    payload: CredentialCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    ctx: RequestContext = Depends(get_request_context),
    service: CredentialService = Depends(get_credentials_service),
) -> dict:
    credential = service.store(
        db,
        user,
        api_key=payload.api_key,
        api_secret=payload.api_secret,
        label=payload.label,
        environment=payload.environment,
    )
    audit.record(
        db,
        action="credential.added",
        user=user,
        target_type="api_credential",
        target_id=credential.id,
        ip_address=ctx.ip,
        user_agent=ctx.user_agent,
        detail={"environment": credential.environment, "ip_restricted": credential.ip_restricted},
    )
    return service.serialize(credential)


@router.post("/{credential_id}/verify", dependencies=[Depends(rate_limit("credentials", 20))])
def verify_credential(
    credential_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: CredentialService = Depends(get_credentials_service),
) -> dict:
    result = service.verify(db, user, credential_id)
    audit.record(db, action="credential.verified", user=user, target_type="api_credential", target_id=credential_id)
    return result


@router.delete("/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_credential(
    credential_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: CredentialService = Depends(get_credentials_service),
):
    service.revoke(db, user, credential_id)
    audit.record(db, action="credential.revoked", user=user, target_type="api_credential", target_id=credential_id)
