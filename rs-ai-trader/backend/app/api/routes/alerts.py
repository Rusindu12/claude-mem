from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from ...core.errors import ValidationAppError
from ...db.base import get_db
from ...db.models import AlertCondition, User
from ...deps import get_alert_service, get_current_user, rate_limit
from ...schemas.api import AlertCreateRequest
from ...services.alerts import AlertService

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", dependencies=[Depends(rate_limit("alerts", 120))])
def list_alerts(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AlertService = Depends(get_alert_service),
) -> list[dict]:
    return service.list_for_user(db, user)


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(rate_limit("alerts", 30))])
def create_alert(
    payload: AlertCreateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AlertService = Depends(get_alert_service),
) -> dict:
    try:
        alert = service.create(
            db,
            user,
            symbol=payload.symbol,
            condition=AlertCondition(payload.condition),
            target_price=payload.target_price,
            note=payload.note,
        )
    except ValueError as exc:
        raise ValidationAppError(str(exc)) from exc
    return service.serialize(alert)


@router.delete("/{alert_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(
    alert_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AlertService = Depends(get_alert_service),
):
    try:
        service.delete(db, user, alert_id)
    except ValueError as exc:
        raise ValidationAppError(str(exc)) from exc


@router.post("/evaluate", dependencies=[Depends(rate_limit("alerts", 30))])
def evaluate_now(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AlertService = Depends(get_alert_service),
) -> dict:
    triggered = service.evaluate_user(db, user)
    return {"evaluated": True, "triggered": triggered}
