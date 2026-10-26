"""Background workers: alerts, paper stop/target monitoring, reconciliation and
the stale-market-data kill switch.

Each loop opens its own short-lived session so a failure in one cycle cannot
poison the next. Loops are disabled in the test environment.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select

from ..core.config import Settings
from ..db.base import session_scope
from ..db.models import PaperOrder, User, UserStatus
from .alerts import AlertService
from .credentials import CredentialService
from .market import MarketService
from .notifications import NotificationService
from .orders import OrderService
from .risk import get_control
from .paper import PaperBroker

log = logging.getLogger(__name__)


class BackgroundRunner:
    def __init__(
        self,
        settings: Settings,
        market: MarketService,
        alerts: AlertService,
        notifications: NotificationService,
        credentials: CredentialService,
    ) -> None:
        self.settings = settings
        self.market = market
        self.alerts = alerts
        self.notifications = notifications
        self.credentials = credentials
        self._tasks: list[asyncio.Task] = []
        self._stop = asyncio.Event()

    # ------------------------------------------------------------------ tasks
    async def _loop(self, name: str, interval: float, func) -> None:
        log.info("background task %s started (every %.0fs)", name, interval)
        while not self._stop.is_set():
            try:
                await asyncio.to_thread(func)
            except Exception:  # pragma: no cover - loop safety
                log.exception("background task %s failed", name)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue

    def start(self) -> None:
        if self._tasks:
            return
        loop = asyncio.get_event_loop()
        self._stop = asyncio.Event()
        self._tasks = [
            loop.create_task(self._loop("alerts", 30, self.evaluate_alerts)),
            loop.create_task(self._loop("paper-risk", 20, self.monitor_paper_positions)),
            loop.create_task(self._loop("reconciler", 30, self.reconcile_live_orders)),
            loop.create_task(self._loop("market-watchdog", 20, self.market_watchdog)),
        ]

    async def stop(self) -> None:
        self._stop.set()
        for task in self._tasks:
            task.cancel()
        self._tasks = []
        log.info("background tasks stopped")

    # ---------------------------------------------------------------- workers
    def evaluate_alerts(self) -> None:
        with session_scope() as db:
            users = db.scalars(select(User).where(User.status == UserStatus.active)).all()
            triggered = 0
            for user in users:
                triggered += len(self.alerts.evaluate_user(db, user))
            db.commit()
            if triggered:
                log.info("alerts triggered: %s", triggered)

    def monitor_paper_positions(self) -> None:
        broker = PaperBroker(
            fee_bps=self.settings.default_taker_fee_bps, slippage_bps=self.settings.default_slippage_bps
        )
        with session_scope() as db:
            users = db.scalars(select(User).where(User.status == UserStatus.active)).all()
            for user in users:
                positions = [
                    p for p in db.scalars(
                        select(PaperOrder).where(PaperOrder.user_id == user.id, PaperOrder.status == "NEW")
                    ).all()
                ]
                # Resting limit orders
                from decimal import Decimal

                from ..db.models import PaperPosition

                symbols = {
                    p.symbol
                    for p in db.scalars(
                        select(PaperPosition).where(PaperPosition.user_id == user.id, PaperPosition.status == "open")
                    ).all()
                }
                for order in positions:
                    symbols.add(order.symbol)
                prices = {}
                for symbol in symbols:
                    try:
                        prices[symbol] = Decimal(str(self.market.ticker(symbol)["price"]))
                    except Exception:
                        continue
                for order in positions:
                    price = prices.get(order.symbol)
                    if price is None:
                        continue
                    broker.execute(db, user, order, price)
                broker.evaluate_positions(db, user, prices)
            db.commit()

    def reconcile_live_orders(self) -> None:
        if not self.settings.live_trading_enabled:
            return
        with session_scope() as db:
            users = db.scalars(select(User).where(User.status == UserStatus.active)).all()
            for user in users:
                service = OrderService(db, self.settings, self.market, credentials=self.credentials)
                try:
                    service.reconcile_user(user)
                except Exception as exc:  # noqa: BLE001
                    log.info("reconcile skipped for %s: %s", user.id, exc)
            db.commit()

    def market_watchdog(self) -> None:
        """Engage the stale-data block when the feed goes quiet for too long."""
        with session_scope() as db:
            control = get_control(db)
            stale = False
            try:
                tickers = self.market.tickers()
                stale = all(t.get("stale") for t in tickers) if tickers else True
            except Exception:
                stale = True
            changed = False
            if stale and not control.stale_data_block:
                control.stale_data_block = True
                control.reason = "Market data went stale; trading paused automatically."
                control.activated_at = datetime.now(timezone.utc)
                changed = True
            elif not stale and control.stale_data_block:
                control.stale_data_block = False
                if control.reason == "Market data went stale; trading paused automatically.":
                    control.reason = None
                changed = True
            if changed:
                log.warning("market watchdog changed stale_data_block -> %s", control.stale_data_block)
            db.commit()
