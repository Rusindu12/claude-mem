from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ...core.config import Settings, get_settings
from ...db.base import get_db
from ...db.models import User
from ...deps import (
    get_assistant_service,
    get_current_user,
    get_market,
    rate_limit,
)
from ...schemas.api import AssistantQuery
from ...services.assistant import AssistantService
from ...services.market import MarketService

router = APIRouter(prefix="/assistant", tags=["assistant"])


@router.get("/meta", dependencies=[Depends(rate_limit("assistant", 60))])
def meta(
    market: MarketService = Depends(get_market),
    settings: Settings = Depends(get_settings),
    user: User = Depends(get_current_user),
) -> dict:
    return {
        "languages": ["en", "si"],
        "capabilities": [
            "explain indicators (RSI, MACD, EMA/SMA, ATR, Bollinger, ADX)",
            "summarise the current market read and regime",
            "explain why a signal was produced",
            "explain portfolio and performance metrics",
            "explain app navigation and safety features",
            "explain trading risks in plain language",
        ],
        "limitations": [
            "cannot place, modify or cancel orders",
            "cannot change risk settings or bypass approvals",
            "cannot reveal API keys or another user's data",
            "will say when data is missing or stale instead of guessing",
        ],
        "llm_enabled": settings.assistant_llm_enabled,
        "market": market.health(),
    }


@router.post("/ask", dependencies=[Depends(rate_limit("assistant", 30))])
def ask(
    payload: AssistantQuery,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> dict:
    return service.ask(
        db,
        user,
        question=payload.question,
        lang=payload.lang,
        symbol=payload.symbol,
        timeframe=payload.timeframe,
        include_portfolio=payload.include_portfolio,
    )


@router.get("/history", dependencies=[Depends(rate_limit("assistant", 60))])
def history(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    service: AssistantService = Depends(get_assistant_service),
) -> list[dict]:
    return service.history(db, user, limit)
