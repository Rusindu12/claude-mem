from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from ...db.base import get_db
from ...db.models import OrderSide, OrderType, TimeInForce, TradingMode, User
from ...deps import get_current_user, get_portfolio_service, order_service, rate_limit
from ...schemas.api import OrderCreateRequest, OrderPreviewRequest
from ...services.orders import OrderRequest, OrderService
from ...services.portfolio import PortfolioService

router = APIRouter(prefix="/orders", tags=["orders"])


def _to_request(payload: OrderPreviewRequest, *, idempotency_key: str = "preview-only-key", approved: bool = False) -> OrderRequest:
    return OrderRequest(
        symbol=payload.symbol,
        side=OrderSide(payload.side),
        order_type=OrderType(payload.order_type),
        quantity=payload.quantity,
        price=payload.price,
        stop_price=payload.stop_price,
        stop_loss=payload.stop_loss,
        take_profit=payload.take_profit,
        mode=TradingMode(payload.mode),
        time_in_force=TimeInForce(payload.time_in_force) if payload.time_in_force else None,
        signal_id=payload.signal_id,
        idempotency_key=idempotency_key,
        approved=approved,
    )


@router.post("/preview", dependencies=[Depends(rate_limit("orders"))])
def preview_order(
    payload: OrderPreviewRequest,
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> dict:
    """Dry run: validation, normalisation and every risk check, without placing."""
    return service.preview(user, _to_request(payload))


@router.post("", status_code=201, dependencies=[Depends(rate_limit("orders"))])
def place_order(
    payload: OrderCreateRequest,
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> dict:
    request = _to_request(payload, idempotency_key=payload.idempotency_key, approved=payload.approved)
    return service.place(user, request)


@router.get("", dependencies=[Depends(rate_limit("orders"))])
def list_orders(
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    open_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> list[dict]:
    return service.list_orders(user, mode=TradingMode(mode), open_only=open_only, limit=limit)


@router.get("/events", dependencies=[Depends(rate_limit("orders"))])
def order_events(
    order_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    from sqlalchemy import or_, select

    from ...db.models import OrderEvent

    stmt = select(OrderEvent).where(OrderEvent.user_id == user.id)
    if order_id:
        stmt = stmt.where(or_(OrderEvent.order_id == order_id, OrderEvent.paper_order_id == order_id))
    rows = db.scalars(stmt.order_by(OrderEvent.created_at.desc()).limit(limit)).all()
    return [
        {
            "id": row.id,
            "order_id": row.order_id or row.paper_order_id,
            "source": row.source,
            "status": row.status,
            "payload": row.payload,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/export.csv", dependencies=[Depends(rate_limit("orders"))])
def export_orders(
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    portfolio: PortfolioService = Depends(get_portfolio_service),
) -> Response:
    csv_text = portfolio.export_orders_csv(db, user, TradingMode(mode))
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="rsai-{mode}-orders.csv"'},
    )


@router.post("/reconcile", dependencies=[Depends(rate_limit("orders"))])
def reconcile(
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> dict:
    return service.reconcile_user(user)


@router.get("/{order_id}", dependencies=[Depends(rate_limit("orders"))])
def get_order(
    order_id: str,
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> dict:
    return service.get_order(user, order_id, TradingMode(mode))


@router.post("/{order_id}/cancel", dependencies=[Depends(rate_limit("orders"))])
def cancel_order(
    order_id: str,
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    user: User = Depends(get_current_user),
    service: OrderService = Depends(order_service),
) -> dict:
    return service.cancel(user, order_id, TradingMode(mode))
