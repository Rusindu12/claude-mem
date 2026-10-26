"""Paper trading broker.

Simulation rules (also shown to the user in the app):
* market orders fill at the reference price moved by configured slippage;
* limit orders fill at the limit price when the market trades through it;
* taker fees are charged in the quote asset on both legs;
* long-only: Spot cash, no leverage, no shorting;
* stops and targets are evaluated server-side against the latest price on a
  best-effort basis — a real exchange would be more precise.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db.models import (
    OrderSide,
    OrderStatus,
    OrderType,
    PaperAccount,
    PaperOrder,
    PaperPosition,
    User,
)

log = logging.getLogger(__name__)
ZERO = Decimal("0")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def ensure_paper_account(db: Session, user: User, starting_equity: Decimal = Decimal("10000")) -> PaperAccount:
    account = user.paper_account or db.scalar(select(PaperAccount).where(PaperAccount.user_id == user.id))
    if account is None:
        account = PaperAccount(
            user_id=user.id,
            starting_equity=starting_equity,
            quote_balance=starting_equity,
            peak_equity=starting_equity,
        )
        db.add(account)
        db.flush()
        user.paper_account = account
    return account


class PaperBroker:
    def __init__(self, *, fee_bps: float = 10.0, slippage_bps: float = 5.0) -> None:
        self.fee_bps = Decimal(str(fee_bps))
        self.slippage_bps = Decimal(str(slippage_bps))

    # -- helpers -----------------------------------------------------------
    def _fee(self, notional: Decimal) -> Decimal:
        return (notional * self.fee_bps / Decimal(10_000)).quantize(Decimal("0.00000001"))

    def _fill_price(self, side: OrderSide, reference: Decimal, order_type: OrderType, limit: Decimal | None) -> Decimal:
        if order_type == OrderType.MARKET or limit is None:
            drift = reference * self.slippage_bps / Decimal(10_000)
            return reference + drift if side == OrderSide.BUY else reference - drift
        # LIMIT: never worse than the limit
        return min(limit, reference) if side == OrderSide.BUY else max(limit, reference)

    def _position(self, db: Session, user_id: str, symbol: str) -> PaperPosition | None:
        return db.scalar(
            select(PaperPosition).where(
                PaperPosition.user_id == user_id,
                PaperPosition.symbol == symbol,
                PaperPosition.status == "open",
            )
        )

    # -- execution ---------------------------------------------------------
    def execute(
        self,
        db: Session,
        user: User,
        order: PaperOrder,
        reference_price: Decimal,
        *,
        force_fill: bool = False,
    ) -> PaperOrder:
        """Try to fill ``order``. Returns the (possibly still NEW) order."""
        account = ensure_paper_account(db, user)
        if order.status not in (OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED):
            return order

        marketable = order.order_type == OrderType.MARKET or force_fill
        if not marketable and order.requested_price is not None:
            if order.side == OrderSide.BUY:
                marketable = reference_price <= order.requested_price
            else:
                marketable = reference_price >= order.requested_price
        if not marketable:
            return order

        fill_price = self._fill_price(order.side, reference_price, order.order_type, order.requested_price)
        notional = fill_price * order.quantity
        fee = self._fee(notional)

        if order.side == OrderSide.BUY:
            if account.quote_balance < notional + fee:
                order.status = OrderStatus.REJECTED
                order.note = "Insufficient paper balance at fill time."
                return order
            account.quote_balance -= notional + fee
            account.fees_paid += fee
            position = self._position(db, user.id, order.symbol)
            if position is None:
                position = PaperPosition(
                    user_id=user.id,
                    symbol=order.symbol,
                    quantity=order.quantity,
                    entry_price=fill_price,
                    stop_loss=order.stop_loss,
                    take_profit=order.take_profit,
                    fees=fee,
                    signal_id=order.signal_id,
                )
                db.add(position)
            else:
                total_qty = position.quantity + order.quantity
                position.entry_price = (
                    (position.entry_price * position.quantity + fill_price * order.quantity) / total_qty
                ).quantize(Decimal("0.00000001"))
                position.quantity = total_qty
                position.fees += fee
                position.stop_loss = order.stop_loss or position.stop_loss
                position.take_profit = order.take_profit or position.take_profit
            order.status = OrderStatus.FILLED
            if order.requested_price is not None and reference_price:
                slippage = abs(fill_price - reference_price) / reference_price * Decimal(10_000)
                order.slippage_bps = slippage.quantize(Decimal("0.0001"))
        else:
            position = self._position(db, user.id, order.symbol)
            if position is None or position.quantity < order.quantity:
                order.status = OrderStatus.REJECTED
                order.note = "No paper position large enough to sell."
                return order
            proceeds = notional - fee
            account.quote_balance += proceeds
            account.fees_paid += fee
            cost_basis = position.entry_price * order.quantity
            entry_fee_share = (position.fees * order.quantity / position.quantity) if position.quantity else ZERO
            realized = (fill_price * order.quantity - cost_basis) - fee - entry_fee_share
            account.realized_pnl += realized
            position.quantity -= order.quantity
            position.fees -= entry_fee_share
            order.status = OrderStatus.FILLED
            if position.quantity <= Decimal("0.00000000001"):
                position.status = "closed"
                position.closed_at = utcnow()
                position.exit_price = fill_price
                position.realized_pnl = realized
                position.quantity = ZERO
            else:
                position.realized_pnl = (position.realized_pnl or ZERO) + realized

        order.filled_quantity = order.quantity
        order.average_fill_price = fill_price.quantize(Decimal("0.00000001"))
        order.fee_paid += fee
        self._refresh_peak(db, account)
        return order

    def _refresh_peak(self, db: Session, account: PaperAccount) -> None:
        # Equity is recomputed by the portfolio service; peak tracking here only
        # records the quote balance, which is the conservative lower bound.
        if account.quote_balance > account.peak_equity:
            account.peak_equity = account.quote_balance

    # -- stop / target monitoring -----------------------------------------
    def evaluate_positions(
        self,
        db: Session,
        user: User,
        prices: dict[str, Decimal],
    ) -> list[dict[str, object]]:
        events: list[dict[str, object]] = []
        positions = db.scalars(
            select(PaperPosition).where(PaperPosition.user_id == user.id, PaperPosition.status == "open")
        ).all()
        for position in positions:
            price = prices.get(position.symbol)
            if price is None:
                continue
            exit_price: Decimal | None = None
            reason = ""
            if position.stop_loss is not None and price <= position.stop_loss:
                exit_price, reason = position.stop_loss, "STOP_LOSS"
            elif position.take_profit is not None and price >= position.take_profit:
                exit_price, reason = position.take_profit, "TAKE_PROFIT"
            if exit_price is None:
                continue
            order = PaperOrder(
                user_id=user.id,
                symbol=position.symbol,
                side=OrderSide.SELL,
                order_type=OrderType.MARKET,
                quantity=position.quantity,
                idempotency_key=f"auto-{position.id}-{reason}-{int(utcnow().timestamp())}",
                status=OrderStatus.NEW,
                note=f"Automatic {reason.lower().replace('_', ' ')} exit",
            )
            db.add(order)
            db.flush()
            self.execute(db, user, order, exit_price, force_fill=True)
            events.append(
                {
                    "symbol": position.symbol,
                    "reason": reason,
                    "price": str(exit_price),
                    "quantity": str(position.quantity),
                    "order_id": order.id,
                }
            )
        return events

    # -- reporting ---------------------------------------------------------
    def state(self, db: Session, user: User, prices: dict[str, Decimal]) -> dict[str, object]:
        account = ensure_paper_account(db, user)
        positions = db.scalars(
            select(PaperPosition).where(PaperPosition.user_id == user.id, PaperPosition.status == "open")
        ).all()
        holdings_value = ZERO
        unrealized = ZERO
        exposure = ZERO
        position_rows = []
        for position in positions:
            price = prices.get(position.symbol, position.entry_price)
            value = price * position.quantity
            pnl = (price - position.entry_price) * position.quantity
            holdings_value += value
            unrealized += pnl
            exposure += value
            position_rows.append(
                {
                    "id": position.id,
                    "symbol": position.symbol,
                    "quantity": str(position.quantity),
                    "entry_price": str(position.entry_price),
                    "current_price": str(price),
                    "market_value": str(value.quantize(Decimal("0.00000001"))),
                    "unrealized_pnl": str(pnl.quantize(Decimal("0.00000001"))),
                    "stop_loss": str(position.stop_loss) if position.stop_loss else None,
                    "take_profit": str(position.take_profit) if position.take_profit else None,
                    "opened_at": position.opened_at.isoformat() if position.opened_at else None,
                    "simulated": True,
                }
            )
        equity = account.quote_balance + holdings_value
        return {
            "mode": "paper",
            "simulated": True,
            "starting_equity": str(account.starting_equity),
            "quote_balance": str(account.quote_balance),
            "available_usdt": str(account.quote_balance),
            "holdings_value": str(holdings_value.quantize(Decimal("0.00000001"))),
            "total_value_usdt": str(equity.quantize(Decimal("0.00000001"))),
            "realized_pnl": str(account.realized_pnl.quantize(Decimal("0.00000001"))),
            "unrealized_pnl": str(unrealized.quantize(Decimal("0.00000001"))),
            "fees_paid": str(account.fees_paid.quantize(Decimal("0.00000001"))),
            "exposure": str(exposure.quantize(Decimal("0.00000001"))),
            "position_count": len(position_rows),
            "positions": position_rows,
            "note": "Simulated balances. No order was sent to Binance.",
        }
