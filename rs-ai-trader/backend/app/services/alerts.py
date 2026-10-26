"""Price and indicator alerts.

Alerts are evaluated on the server against the same market feed the app shows,
so a phone that is asleep still receives them (via push) and the trigger time
is trustworthy.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import AlertCondition, AlertStatus, PriceAlert, SignalRecord, User
from .market import MarketService
from .notifications import NotificationService

log = logging.getLogger(__name__)


class AlertService:
    def __init__(self, market: MarketService, notifications: NotificationService) -> None:
        self.market = market
        self.notifications = notifications

    def create(
        self,
        db: Session,
        user: User,
        *,
        symbol: str,
        condition: AlertCondition,
        target_price: Decimal | None = None,
        note: str | None = None,
    ) -> PriceAlert:
        symbol = symbol.upper()
        if condition in (AlertCondition.price_above, AlertCondition.price_below) and not target_price:
            raise ValueError("Price alerts need a target price.")
        # Validate the symbol exists in the enabled list before storing it.
        self.market.ticker(symbol)
        alert = PriceAlert(
            user_id=user.id,
            symbol=symbol,
            condition=condition,
            target_price=target_price,
            note=note,
            status=AlertStatus.active,
        )
        db.add(alert)
        db.flush()
        return alert

    def list_for_user(self, db: Session, user: User) -> list[dict]:
        rows = db.scalars(
            select(PriceAlert).where(PriceAlert.user_id == user.id).order_by(PriceAlert.created_at.desc())
        ).all()
        return [self.serialize(row) for row in rows]

    def delete(self, db: Session, user: User, alert_id: str) -> None:
        alert = db.get(PriceAlert, alert_id)
        if alert is None or alert.user_id != user.id:
            raise ValueError("Alert not found.")
        db.delete(alert)

    # -------------------------------------------------------------- evaluation
    def evaluate_user(self, db: Session, user: User) -> list[dict]:
        alerts = db.scalars(
            select(PriceAlert).where(PriceAlert.user_id == user.id, PriceAlert.status == AlertStatus.active)
        ).all()
        if not alerts:
            return []
        triggered: list[dict] = []
        for alert in alerts:
            try:
                condition_met, price, detail = self._check(db, alert)
            except Exception as exc:  # noqa: BLE001 - never break the loop on one alert
                log.info("alert %s could not be evaluated: %s", alert.id, exc)
                continue
            if not condition_met:
                continue
            alert.status = AlertStatus.triggered
            alert.triggered_at = datetime.now(timezone.utc)
            alert.triggered_price = Decimal(str(price)) if price is not None else None
            self.notifications.notify(
                db,
                user,
                kind="price_alert",
                title=f"{alert.symbol} alert",
                body=detail,
                severity="info",
                data={"alert_id": alert.id, "symbol": alert.symbol, "screen": "alerts"},
            )
            triggered.append({"alert_id": alert.id, "symbol": alert.symbol, "detail": detail})
        return triggered

    def _check(self, db: Session, alert: PriceAlert) -> tuple[bool, float | None, str]:
        if alert.condition in (AlertCondition.price_above, AlertCondition.price_below):
            ticker = self.market.ticker(alert.symbol)
            price = float(ticker["price"])
            target = float(alert.target_price or 0)
            if alert.condition == AlertCondition.price_above and price >= target:
                return True, price, f"{alert.symbol} rose to {price:.4f} (target {target:.4f})."
            if alert.condition == AlertCondition.price_below and price <= target:
                return True, price, f"{alert.symbol} fell to {price:.4f} (target {target:.4f})."
            return False, price, ""

        if alert.condition in (AlertCondition.rsi_above, AlertCondition.rsi_below):
            result = self.market.klines(alert.symbol, "1h", 120)
            from .ai import engine_required

            engine = engine_required()
            rsi_series = engine.indicators.rsi(result.frame["close"]).dropna()
            if rsi_series.empty:
                return False, None, ""
            rsi_value = float(rsi_series.iloc[-1])
            price = float(result.frame["close"].iloc[-1])
            target = float(alert.target_price or 0)
            if alert.condition == AlertCondition.rsi_above and rsi_value >= target:
                return True, price, f"{alert.symbol} RSI(1h) reached {rsi_value:.1f} (threshold {target:.0f})."
            if alert.condition == AlertCondition.rsi_below and rsi_value <= target:
                return True, price, f"{alert.symbol} RSI(1h) fell to {rsi_value:.1f} (threshold {target:.0f})."
            return False, price, ""

        # Signal-driven alerts read the most recent stored signal.
        signal = db.scalar(
            select(SignalRecord)
            .where(SignalRecord.symbol == alert.symbol)
            .order_by(SignalRecord.created_at.desc())
        )
        if signal is None or alert.triggered_at is not None:
            return False, None, ""
        wanted = "BUY" if alert.condition == AlertCondition.signal_buy else "SELL"
        if signal.action == wanted:
            return True, float(signal.payload.get("price") or 0), f"{alert.symbol} produced a {wanted} signal on {signal.timeframe}."
        return False, None, ""

    @staticmethod
    def serialize(alert: PriceAlert) -> dict:
        return {
            "id": alert.id,
            "symbol": alert.symbol,
            "condition": alert.condition.value if hasattr(alert.condition, "value") else alert.condition,
            "target_price": str(alert.target_price) if alert.target_price is not None else None,
            "status": alert.status.value if hasattr(alert.status, "value") else alert.status,
            "note": alert.note,
            "triggered_at": alert.triggered_at.isoformat() if alert.triggered_at else None,
            "triggered_price": str(alert.triggered_price) if alert.triggered_price is not None else None,
            "created_at": alert.created_at.isoformat(),
        }
