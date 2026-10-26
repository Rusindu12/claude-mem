"""Bilingual (English / Sinhala) market assistant, grounded in backend facts.

The assistant can answer questions about indicators, the current market read,
explanation of a stored signal, portfolio/performance metrics, app navigation
and risk. It cannot place orders, change risk settings or reveal credentials.

Every number in an answer is copied from data this service fetched itself. An
optional LLM "polish" step is only enabled by configuration and is rejected if
it introduces numbers that are not in the supplied fact block.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import ValidationAppError
from ..db.models import AssistantMessage, PaperOrder, TradingMode, User
from .ai import SignalService, engine_required
from .market import MarketService
from .portfolio import PortfolioService

log = logging.getLogger(__name__)


class AssistantService:
    def __init__(
        self,
        settings: Settings,
        market: MarketService,
        signals: SignalService,
        portfolio: PortfolioService,
    ) -> None:
        self.settings = settings
        self.market = market
        self.signals = signals
        self.portfolio = portfolio

    # ------------------------------------------------------------------ polish
    def _polisher(self):
        if not self.settings.assistant_llm_enabled or not self.settings.assistant_llm_api_key:
            return None

        def polish(question: str, lang: str, facts: dict[str, Any], draft: str) -> str:
            system = (
                "You rewrite a factual trading-app answer. You must not add numbers, balances, orders "
                "or predictions. Reply in the requested language using only the supplied facts. "
                "Never claim guaranteed profit."
            )
            payload = {
                "model": self.settings.assistant_llm_model,
                "messages": [
                    {"role": "system", "content": system},
                    {
                        "role": "user",
                        "content": json.dumps(
                            {"question": question, "lang": lang, "facts": facts, "draft": draft}, default=str
                        ),
                    },
                ],
                "temperature": 0.2,
                "max_tokens": 300,
            }
            response = httpx.post(
                "https://api.openai.com/v1/chat/completions",
                headers={"Authorization": f"Bearer {self.settings.assistant_llm_api_key}"},
                json=payload,
                timeout=20,
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"]

        return polish

    # ----------------------------------------------------------------- answer
    def ask(
        self,
        db: Session,
        user: User,
        *,
        question: str,
        lang: str | None = None,
        symbol: str | None = None,
        timeframe: str | None = None,
        include_portfolio: bool = True,
    ) -> dict[str, Any]:
        question = (question or "").strip()
        if not question:
            raise ValidationAppError("Ask a question about the market, a signal, your portfolio or the app.")
        if len(question) > 800:
            raise ValidationAppError("Please keep questions under 800 characters.")
        engine = engine_required()

        symbol = (symbol or self.settings.symbol_list[0]).upper()
        timeframe = timeframe or "1h"

        # ---- gather facts (each guarded so a partial outage degrades clearly)
        signal_payload: dict[str, Any] | None = None
        data_ts: str | None = None
        stale = True
        try:
            signal_payload = self.signals.generate(db, symbol=symbol, timeframe=timeframe, user=user, persist=False)
            data_ts = signal_payload.get("generated_at")
            quality = signal_payload.get("data_quality") or {}
            stale = bool(quality.get("stale")) or signal_payload.get("data_source") != "binance"
        except Exception as exc:  # noqa: BLE001
            log.info("assistant could not refresh the signal: %s", exc)

        portfolio_facts: dict[str, Any] | None = None
        performance: dict[str, Any] | None = None
        if include_portfolio:
            try:
                portfolio_facts = self.portfolio.summary(db, user, TradingMode.paper)
                analytics = self.portfolio.analytics(db, user, TradingMode.paper, days=30)
                performance = dict(analytics.get("summary") or {})
            except Exception as exc:  # noqa: BLE001
                log.info("assistant could not load portfolio facts: %s", exc)

        open_orders = db.scalars(
            select(PaperOrder).where(PaperOrder.user_id == user.id, PaperOrder.status == "NEW")
        ).all()

        market_status = self.market.health()
        if not stale and market_status.get("degraded"):
            stale = True

        from rs_ai_engine.assistant import AssistantContext  # guaranteed by engine_required

        ctx = AssistantContext(
            lang=lang,
            symbol=symbol,
            timeframe=timeframe,
            signal=signal_payload,
            indicators=(signal_payload or {}).get("indicators"),
            regime=(signal_payload or {}).get("regime"),
            portfolio=portfolio_facts,
            performance=performance,
            market_status=market_status,
            data_timestamp=data_ts or datetime.now(timezone.utc).isoformat(),
            data_is_stale=stale,
            extra_facts={"open_orders": [{"id": o.id, "symbol": o.symbol} for o in open_orders]},
        )
        answer = engine.assistant.answer_question(question, ctx, polisher=self._polisher())

        message = AssistantMessage(
            user_id=user.id,
            question=question,
            answer=answer.text,
            lang=answer.lang,
            intent=answer.intent,
            context={
                "symbol": symbol,
                "timeframe": timeframe,
                "data_as_of": answer.data_as_of,
                "facts": answer.facts_used,
            },
        )
        db.add(message)
        db.flush()

        return {
            "id": message.id,
            "question": question,
            "answer": answer.text,
            "lang": answer.lang,
            "intent": answer.intent,
            "facts": answer.facts_used,
            "limitations": answer.limitations,
            "data_as_of": answer.data_as_of,
            "refused": answer.refused,
            "disclaimer": (
                "Technical analysis is probabilistic. Nothing here is financial advice. "
                "Stop-losses reduce, but do not eliminate, losses."
            ),
        }

    def history(self, db: Session, user: User, limit: int = 50) -> list[dict]:
        rows = db.scalars(
            select(AssistantMessage)
            .where(AssistantMessage.user_id == user.id)
            .order_by(AssistantMessage.created_at.desc())
            .limit(limit)
        ).all()
        return [
            {
                "id": row.id,
                "question": row.question,
                "answer": row.answer,
                "lang": row.lang,
                "intent": row.intent,
                "created_at": row.created_at.isoformat(),
                "data_as_of": (row.context or {}).get("data_as_of"),
            }
            for row in rows
        ]
