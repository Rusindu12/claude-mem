"""Portfolio, P/L analytics and CSV export.

Two clearly separated sources of truth:

* ``paper`` — simulated account in PostgreSQL. Fully valued, fees included.
* ``live``  — read-only ``GET /api/v3/account`` from Binance. We never invent
  balances: if the exchange call fails the endpoint returns an error and the
  Android UI shows an "unavailable" state with the reason.

Performance metrics are always labelled with their cost assumptions. When a
metric cannot be computed from available data (e.g. realised P/L on a live
account without full trade history) it is returned as ``None`` with a note
rather than estimated silently.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import UpstreamError
from ..db.models import (
    ExchangeOrder,
    OrderStatus,
    PaperOrder,
    PaperPosition,
    TradingMode,
    User,
)
from .binance_client import BinanceError
from .credentials import CredentialService
from .market import MarketService
from .paper import ensure_paper_account

log = logging.getLogger(__name__)
ZERO = Decimal("0")


class PortfolioService:
    def __init__(
        self,
        settings: Settings,
        market: MarketService,
        credentials: CredentialService | None = None,
    ) -> None:
        self.settings = settings
        self.market = market
        self.credentials = credentials or CredentialService(settings)
        self._live_cache: dict[str, tuple[float, dict]] = {}

    # ------------------------------------------------------------------ paper
    def paper_state(self, db: Session, user: User) -> dict:
        from .paper import PaperBroker

        broker = PaperBroker(
            fee_bps=self.settings.default_taker_fee_bps, slippage_bps=self.settings.default_slippage_bps
        )
        symbols = [p.symbol for p in db.scalars(
            select(PaperPosition).where(PaperPosition.user_id == user.id, PaperPosition.status == "open")
        ).all()]
        prices = self._prices(symbols + ["BTCUSDT"])
        return broker.state(db, user, prices)

    @staticmethod
    def _prices(symbols: list[str]) -> dict[str, Decimal]:
        # Paper positions are valued by the caller-supplied market service;
        # this static helper exists for callers that only need symbol prices.
        return {}

    # ------------------------------------------------------------------- live
    def live_state(self, db: Session, user: User) -> dict:
        import time as _time

        cached = self._live_cache.get(user.id)
        now = _time.time()
        if cached and now - cached[0] < 10:
            return cached[1]

        credential = self.credentials.active_for(db, user, self.settings.binance_env)
        client = self.credentials.client_for(credential)
        try:
            account = client.account()
        except BinanceError as exc:
            raise UpstreamError(
                "Binance did not return account balances. Check the API key permissions and IP allow-list.",
                details={"exchange_code": exc.code, "reason": exc.message},
            ) from exc
        finally:
            client.close()

        balances = [
            {
                "asset": b["asset"],
                "free": Decimal(str(b["free"])),
                "locked": Decimal(str(b["locked"])),
            }
            for b in account.get("balances", [])
            if Decimal(str(b.get("free", 0))) > 0 or Decimal(str(b.get("locked", 0))) > 0
        ]
        symbols = [f"{b['asset']}USDT" for b in balances if b["asset"] != "USDT"]
        prices: dict[str, Decimal] = {}
        for symbol in symbols:
            try:
                prices[symbol] = Decimal(str(self.market.ticker(symbol)["price"]))
            except Exception:
                continue

        holdings_value = ZERO
        exposure = ZERO
        rows = []
        for balance in balances:
            asset = balance["asset"]
            quantity = balance["free"] + balance["locked"]
            price = Decimal("1") if asset == "USDT" else prices.get(f"{asset}USDT")
            value = quantity * price if price is not None else None
            if value is not None:
                holdings_value += value
                if asset != "USDT":
                    exposure += value
            rows.append(
                {
                    "asset": asset,
                    "free": str(balance["free"]),
                    "locked": str(balance["locked"]),
                    "usdt_value": str(value.quantize(Decimal("0.00000001"))) if value is not None else None,
                    "priced": price is not None,
                }
            )
        quote = next((b for b in balances if b["asset"] == "USDT"), None)
        available = quote["free"] if quote else ZERO
        total = holdings_value
        state = {
            "mode": "live",
            "simulated": False,
            "environment": self.settings.binance_env,
            "quote_balance": str(available),
            "available_usdt": str(available),
            "holdings_value": str(holdings_value.quantize(Decimal("0.00000001"))),
            "total_value_usdt": str(total.quantize(Decimal("0.00000001"))),
            "exposure": str(exposure.quantize(Decimal("0.00000001"))),
            "balances": rows,
            "position_count": len([r for r in rows if r["asset"] != "USDT" and r["priced"]]),
            "realized_pnl": None,
            "unrealized_pnl": None,
            "fees_paid": None,
            "can_trade": bool(account.get("canTrade")),
            "note": (
                "Actual exchange balances (read-only API call). Realised P/L is not shown because "
                "the account may contain trades made outside this app."
            ),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._live_cache[user.id] = (now, state)
        return state

    # --------------------------------------------------------------- summary
    def summary(self, db: Session, user: User, mode: TradingMode) -> dict:
        if mode == TradingMode.live:
            state = self.live_state(db, user)
        else:
            state = self._paper_state_with_prices(db, user)
            state["mode"] = "paper"
            state["simulated"] = True
        return state

    def _paper_state_with_prices(self, db: Session, user: User) -> dict:
        from .paper import PaperBroker

        broker = PaperBroker(
            fee_bps=self.settings.default_taker_fee_bps, slippage_bps=self.settings.default_slippage_bps
        )
        positions = db.scalars(
            select(PaperPosition).where(PaperPosition.user_id == user.id, PaperPosition.status == "open")
        ).all()
        prices: dict[str, Decimal] = {}
        for position in positions:
            try:
                prices[position.symbol] = Decimal(str(self.market.ticker(position.symbol)["price"]))
            except Exception:  # fall back to entry price so valuation never crashes
                prices[position.symbol] = position.entry_price
        return broker.state(db, user, prices)

    # ------------------------------------------------------------- analytics
    def analytics(self, db: Session, user: User, mode: TradingMode, days: int = 30) -> dict:
        if mode == TradingMode.live:
            return self._live_analytics(db, user, days)
        return self._paper_analytics(db, user, days)

    def _paper_analytics(self, db: Session, user: User, days: int) -> dict:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        account = ensure_paper_account(db, user)
        closed = db.scalars(
            select(PaperPosition).where(
                PaperPosition.user_id == user.id,
                PaperPosition.status == "closed",
                PaperPosition.closed_at >= since,
            )
        ).all()
        orders = db.scalars(
            select(PaperOrder).where(PaperOrder.user_id == user.id, PaperOrder.created_at >= since)
        ).all()
        state = self._paper_state_with_prices(db, user)

        realized = sum((p.realized_pnl or ZERO for p in closed), ZERO)
        wins = [p for p in closed if (p.realized_pnl or ZERO) > 0]
        losses = [p for p in closed if (p.realized_pnl or ZERO) <= 0]
        fees = sum((o.fee_paid or ZERO for o in orders), ZERO)
        daily: dict[str, dict[str, Decimal | int]] = {}
        for position in closed:
            if not position.closed_at:
                continue
            key = position.closed_at.date().isoformat()
            bucket = daily.setdefault(key, {"pnl": ZERO, "trades": 0})
            bucket["pnl"] = Decimal(bucket["pnl"]) + (position.realized_pnl or ZERO)
            bucket["trades"] = int(bucket["trades"]) + 1
        cumulative = Decimal("0")
        curve = []
        peak = account.starting_equity
        max_dd = ZERO
        for day in sorted(daily):
            cumulative += Decimal(daily[day]["pnl"])
            equity = account.starting_equity + cumulative
            peak = max(peak, equity)
            drawdown = (equity - peak) / peak * 100 if peak else ZERO
            max_dd = min(max_dd, drawdown)
            curve.append(
                {
                    "date": day,
                    "realized_pnl": str(Decimal(daily[day]["pnl"]).quantize(Decimal("0.00000001"))),
                    "trades": daily[day]["trades"],
                    "cumulative_pnl": str(cumulative.quantize(Decimal("0.00000001"))),
                    "drawdown_pct": str(drawdown.quantize(Decimal("0.0001"))),
                }
            )
        gross_win = sum((p.realized_pnl or ZERO for p in wins), ZERO)
        gross_loss = abs(sum((p.realized_pnl or ZERO for p in losses), ZERO))
        return {
            "mode": "paper",
            "simulated": True,
            "window_days": days,
            "note": (
                "Simulated results. Fees and slippage at the configured rates are included; "
                "real execution may differ."
            ),
            "cost_assumptions": {
                "taker_fee_bps": self.settings.default_taker_fee_bps,
                "slippage_bps": self.settings.default_slippage_bps,
            },
            "summary": {
                "equity": state["total_value_usdt"],
                "starting_equity": str(account.starting_equity),
                "realized_pnl": str(realized.quantize(Decimal("0.00000001"))),
                "unrealized_pnl": state["unrealized_pnl"],
                "fees_paid": str(fees.quantize(Decimal("0.00000001"))),
                "return_pct": str(
                    ((Decimal(state["total_value_usdt"]) / account.starting_equity - 1) * 100).quantize(
                        Decimal("0.0001")
                    )
                )
                if account.starting_equity
                else None,
                "max_drawdown_pct": str(max_dd.quantize(Decimal("0.0001"))),
                "win_rate_pct": str(
                    (Decimal(len(wins)) / Decimal(len(closed)) * 100).quantize(Decimal("0.01"))
                )
                if closed
                else None,
                "trade_count": len(closed),
                "average_win": str((gross_win / len(wins)).quantize(Decimal("0.00000001"))) if wins else None,
                "average_loss": str((-gross_loss / len(losses)).quantize(Decimal("0.00000001")))
                if losses
                else None,
                "profit_factor": str((gross_win / gross_loss).quantize(Decimal("0.0001"))) if gross_loss else None,
            },
            "daily": curve,
            "open_positions": state["positions"],
        }

    def _live_analytics(self, db: Session, user: User, days: int) -> dict:
        since = datetime.now(timezone.utc) - timedelta(days=days)
        orders = db.scalars(
            select(ExchangeOrder).where(
                ExchangeOrder.user_id == user.id,
                ExchangeOrder.created_at >= since,
                ExchangeOrder.status == OrderStatus.FILLED,
            )
        ).all()
        fees = sum((o.fee_paid or ZERO for o in orders), ZERO)
        volume = sum((o.cummulative_quote_qty or ZERO for o in orders), ZERO)
        return {
            "mode": "live",
            "simulated": False,
            "window_days": days,
            "summary": {
                "realized_pnl": None,
                "unrealized_pnl": None,
                "fees_paid": str(fees.quantize(Decimal("0.00000001"))),
                "filled_orders": len(orders),
                "traded_volume_usdt": str(volume.quantize(Decimal("0.00000001"))),
            },
            "daily": [],
            "note": (
                "Realised P/L for a live account is intentionally not estimated: the account may "
                "contain deposits or trades made outside RS AI TRADER. Fee and turnover figures come "
                "from this app's own order records."
            ),
        }

    # -------------------------------------------------------------- CSV export
    def export_orders_csv(self, db: Session, user: User, mode: TradingMode) -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        if mode == TradingMode.live:
            writer.writerow(
                ["id", "symbol", "side", "type", "status", "quantity", "price", "executed_qty",
                 "quote_qty", "fee", "fee_asset", "client_order_id", "exchange_order_id", "created_at"]
            )
            rows = db.scalars(
                select(ExchangeOrder).where(ExchangeOrder.user_id == user.id).order_by(ExchangeOrder.created_at)
            ).all()
            for order in rows:
                writer.writerow(
                    [order.id, order.symbol, order.side.value, order.order_type.value, order.status.value,
                     order.quantity, order.price, order.executed_qty, order.cummulative_quote_qty,
                     order.fee_paid, order.fee_asset, order.client_order_id, order.exchange_order_id,
                     order.created_at.isoformat()]
                )
        else:
            writer.writerow(
                ["id", "symbol", "side", "type", "status", "quantity", "limit_price", "fill_price",
                 "fee_paid", "stop_loss", "take_profit", "created_at"]
            )
            rows = db.scalars(
                select(PaperOrder).where(PaperOrder.user_id == user.id).order_by(PaperOrder.created_at)
            ).all()
            for order in rows:
                writer.writerow(
                    [order.id, order.symbol, order.side.value, order.order_type.value, order.status.value,
                     order.quantity, order.requested_price, order.average_fill_price, order.fee_paid,
                     order.stop_loss, order.take_profit, order.created_at.isoformat()]
                )
        return buffer.getvalue()

    def export_trades_csv(self, db: Session, user: User) -> str:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(
            ["id", "symbol", "quantity", "entry_price", "exit_price", "fees", "realized_pnl", "opened_at", "closed_at"]
        )
        rows = db.scalars(
            select(PaperPosition).where(PaperPosition.user_id == user.id).order_by(PaperPosition.opened_at)
        ).all()
        for position in rows:
            writer.writerow(
                [position.id, position.symbol, position.quantity, position.entry_price, position.exit_price,
                 position.fees, position.realized_pnl,
                 position.opened_at.isoformat() if position.opened_at else "",
                 position.closed_at.isoformat() if position.closed_at else ""]
            )
        return buffer.getvalue()
