from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.base import get_db
from ...db.models import BacktestRun, User
from ...deps import get_current_user, get_signal_service, rate_limit
from ...schemas.api import BacktestRequest
from ...services.ai import SignalService

router = APIRouter(prefix="/signals", tags=["signals"])

# NOTE: literal paths ("/backtest", "/backtests/history") are registered before
# the "/{symbol}" patterns so they are never swallowed by the path parameter.


@router.post("/backtest", dependencies=[Depends(rate_limit("backtest", 10))])
def run_backtest(
    payload: BacktestRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: SignalService = Depends(get_signal_service),
) -> dict:
    return service.backtest(
        db,
        user,
        symbol=payload.symbol,
        timeframe=payload.timeframe,
        days=payload.days,
        fee_bps=payload.fee_bps,
        slippage_bps=payload.slippage_bps,
        initial_capital=payload.initial_capital,
    )


@router.get("/backtests/history", dependencies=[Depends(rate_limit("signals", 60))])
def backtest_history(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    rows = db.scalars(
        select(BacktestRun)
        .where(BacktestRun.user_id == user.id)
        .order_by(BacktestRun.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": row.id,
            "symbol": row.symbol,
            "timeframe": row.timeframe,
            "parameters": row.parameters,
            "metrics": row.metrics,
            "assumptions": row.assumptions,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/{symbol}", dependencies=[Depends(rate_limit("signals", 60))])
def generate_signal(
    symbol: str,
    timeframe: str = Query(default="1h"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: SignalService = Depends(get_signal_service),
) -> dict:
    """Generate (and store) a fresh analysis for the pair/timeframe."""
    return service.generate(db, symbol=symbol, timeframe=timeframe, user=user)


@router.get("/{symbol}/latest", dependencies=[Depends(rate_limit("signals", 120))])
def latest_signal(
    symbol: str,
    timeframe: str = Query(default="1h"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: SignalService = Depends(get_signal_service),
) -> dict:
    stored = service.latest(db, symbol, timeframe)
    if stored is None:
        return service.generate(db, symbol=symbol, timeframe=timeframe, user=user)
    return stored


@router.get("/{symbol}/history", dependencies=[Depends(rate_limit("signals", 60))])
def signal_history(
    symbol: str,
    timeframe: str = Query(default="1h"),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: SignalService = Depends(get_signal_service),
) -> list[dict]:
    return service.history(db, symbol, timeframe, limit)


@router.get("/{symbol}/model", dependencies=[Depends(rate_limit("signals", 60))])
def model_report(
    symbol: str,
    timeframe: str = Query(default="1h"),
    user: User = Depends(get_current_user),
    service: SignalService = Depends(get_signal_service),
) -> dict:
    """Honest out-of-sample statistics for the artefact serving this pair."""
    return service.model_report(symbol, timeframe)
