from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ...db.base import get_db
from ...db.models import PaperOrder, PaperPosition, TradingMode, User
from ...deps import get_current_user, get_portfolio_service, rate_limit
from ...services import audit
from ...services.paper import ensure_paper_account
from ...services.portfolio import PortfolioService

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


@router.get("", dependencies=[Depends(rate_limit("portfolio", 120))])
def portfolio(
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: PortfolioService = Depends(get_portfolio_service),
) -> dict:
    return service.summary(db, user, TradingMode(mode))


@router.get("/analytics", dependencies=[Depends(rate_limit("portfolio", 60))])
def analytics(
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: PortfolioService = Depends(get_portfolio_service),
) -> dict:
    return service.analytics(db, user, TradingMode(mode), days)


@router.get("/export/orders.csv", dependencies=[Depends(rate_limit("portfolio", 20))])
def export_orders(
    mode: str = Query(default="paper", pattern="^(paper|live)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: PortfolioService = Depends(get_portfolio_service),
) -> Response:
    return Response(
        content=service.export_orders_csv(db, user, TradingMode(mode)),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="rsai-{mode}-orders.csv"'},
    )


@router.get("/export/trades.csv", dependencies=[Depends(rate_limit("portfolio", 20))])
def export_trades(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: PortfolioService = Depends(get_portfolio_service),
) -> Response:
    return Response(
        content=service.export_trades_csv(db, user),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="rsai-paper-trades.csv"'},
    )


@router.post("/paper/reset", dependencies=[Depends(rate_limit("portfolio", 5))])
def reset_paper_account(
    starting_equity: Decimal = Query(default=Decimal("10000"), gt=0, le=1_000_000),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Reset the simulated account. Live balances are never touched."""
    account = ensure_paper_account(db, user)
    db.execute(delete(PaperPosition).where(PaperPosition.user_id == user.id))
    db.execute(delete(PaperOrder).where(PaperOrder.user_id == user.id))
    account.starting_equity = starting_equity
    account.quote_balance = starting_equity
    account.realized_pnl = Decimal("0")
    account.fees_paid = Decimal("0")
    account.peak_equity = starting_equity
    audit.record(db, action="paper_account.reset", user=user, detail={"starting_equity": str(starting_equity)})
    return {"message": "Paper account reset.", "starting_equity": str(starting_equity)}


@router.get("/paper/positions", dependencies=[Depends(rate_limit("portfolio", 120))])
def paper_positions(
    include_closed: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    stmt = select(PaperPosition).where(PaperPosition.user_id == user.id)
    if not include_closed:
        stmt = stmt.where(PaperPosition.status == "open")
    rows = db.scalars(stmt.order_by(PaperPosition.opened_at.desc())).all()
    return [
        {
            "id": row.id,
            "symbol": row.symbol,
            "quantity": str(row.quantity),
            "entry_price": str(row.entry_price),
            "exit_price": str(row.exit_price) if row.exit_price else None,
            "stop_loss": str(row.stop_loss) if row.stop_loss else None,
            "take_profit": str(row.take_profit) if row.take_profit else None,
            "status": row.status,
            "realized_pnl": str(row.realized_pnl) if row.realized_pnl is not None else None,
            "fees": str(row.fees),
            "opened_at": row.opened_at.isoformat() if row.opened_at else None,
            "closed_at": row.closed_at.isoformat() if row.closed_at else None,
            "simulated": True,
        }
        for row in rows
    ]
