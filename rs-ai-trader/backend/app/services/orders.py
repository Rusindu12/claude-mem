"""Order lifecycle: validate → risk-check → execute → confirm → reconcile.

Key guarantees
--------------
1. **No optimistic success.** A live order is only marked ``FILLED`` when
   Binance's own response/query says so. If the response is ambiguous the order
   is persisted as ``UNKNOWN`` and reconciled before any further order for that
   symbol is accepted.
2. **Idempotency.** ``(user_id, idempotency_key)`` is unique. A retry returns
   the original order instead of double-submitting.
3. **Duplicate heuristic.** An identical symbol/side/quantity attempt inside
   the guard window is rejected with a conflict instead of silently doubling a
   position.
4. **Server-side risk.** :class:`RiskEngine` runs for every mode.
"""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import (
    ConflictError,
    ForbiddenError,
    NotFoundError,
    RiskRejectedError,
    ValidationAppError,
)
from ..db.models import (
    ExchangeOrder,
    OrderEvent,
    OrderSide,
    OrderStatus,
    OrderType,
    PaperOrder,
    PaperPosition,
    RiskPolicy,
    TimeInForce,
    TradingMode,
    User,
)
from . import audit
from .binance_client import BinanceClient, BinanceError, SymbolFilters
from .credentials import CredentialService
from .market import MarketService
from .notifications import NotificationService
from .paper import PaperBroker, ensure_paper_account
from .risk import (
    OrderIntent,
    RiskDecision,
    RiskEngine,
    count_open_orders,
    ensure_policy,
    get_control,
    paper_daily_realized_pnl,
    trading_day_start,
)

log = logging.getLogger(__name__)
ZERO = Decimal("0")
DUPLICATE_WINDOW_SECONDS = 15


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class OrderRequest:
    symbol: str
    side: OrderSide
    order_type: OrderType
    quantity: Decimal
    mode: TradingMode
    idempotency_key: str
    price: Decimal | None = None
    stop_price: Decimal | None = None
    stop_loss: Decimal | None = None
    take_profit: Decimal | None = None
    time_in_force: TimeInForce | None = None
    signal_id: str | None = None
    approved: bool = False
    note: str | None = None


class OrderService:
    def __init__(
        self,
        db: Session,
        settings: Settings,
        market: MarketService,
        *,
        paper: PaperBroker | None = None,
        credentials: CredentialService | None = None,
        notifications: NotificationService | None = None,
    ) -> None:
        self.db = db
        self.settings = settings
        self.market = market
        self.paper = paper or PaperBroker(
            fee_bps=settings.default_taker_fee_bps, slippage_bps=settings.default_slippage_bps
        )
        self.credentials = credentials or CredentialService(settings)
        self.notifications = notifications or NotificationService(settings)
        self.risk = RiskEngine(
            live_trading_enabled=settings.live_trading_enabled,
            automation_enabled=settings.automation_enabled,
            environment=settings.environment,
        )

    # ---------------------------------------------------------------- context
    def _market_context(self, symbol: str) -> dict:
        ticker = self.market.ticker(symbol)
        try:
            filters = self.market.filters_for(symbol)
        except NotFoundError:
            filters = None
        depth = None
        try:
            depth = self.market.depth(symbol, limit=5)
        except Exception:  # depth is informative only
            depth = None
        volatility_pct = None
        try:
            klines = self.market.klines(symbol, "1h", 60)
            from .ai import atr_percent

            volatility_pct = atr_percent(klines.frame)
        except Exception:  # pragma: no cover - optional context
            volatility_pct = None
        return {
            "price": Decimal(str(ticker["price"])),
            "filters": filters,
            "ticker": ticker,
            "spread_bps": depth.get("spread_bps") if depth else None,
            "volatility_pct": volatility_pct,
        }

    def _build_intent(self, request: OrderRequest, context: dict, filters: SymbolFilters | None) -> tuple[OrderIntent, list[str]]:
        adjustments: list[str] = []
        reference = context["price"]
        if filters is not None:
            price = request.price
            if price is not None and filters.tick_size:
                rounded = filters.round_price(price)
                if rounded != price:
                    adjustments.append(f"Price rounded from {price} to {rounded} using tick size {filters.tick_size}.")
                price = rounded
            quantity = filters.round_quantity(request.quantity)
            if quantity != request.quantity:
                adjustments.append(
                    f"Quantity rounded down from {request.quantity} to {quantity} using step size {filters.step_size}."
                )
            if filters.status != "TRADING":
                raise ValidationAppError(f"{request.symbol} is currently {filters.status} on Binance.")
        else:
            price, quantity = request.price, request.quantity

        effective_price = price if (request.order_type != OrderType.MARKET and price) else reference
        notional = (effective_price * quantity).quantize(Decimal("0.00000001"))
        stop_loss = request.stop_loss
        take_profit = request.take_profit
        if filters is not None:
            if stop_loss is not None:
                stop_loss = filters.round_price(stop_loss)
            if take_profit is not None:
                take_profit = filters.round_price(take_profit)
        if stop_loss is not None and request.side == OrderSide.BUY and stop_loss >= effective_price:
            raise ValidationAppError("Stop-loss must be below the entry price for a buy order.")
        if take_profit is not None and request.side == OrderSide.BUY and take_profit <= effective_price:
            raise ValidationAppError("Take-profit must be above the entry price for a buy order.")

        intent = OrderIntent(
            symbol=request.symbol,
            side=request.side,
            order_type=request.order_type.value,
            quantity=quantity,
            price=effective_price,
            quote_notional=notional,
            stop_loss=stop_loss,
            take_profit=take_profit,
            mode=request.mode,
            market_price=reference,
            min_notional=filters.min_notional if filters else None,
            step_size=filters.step_size if filters else None,
            tick_size=filters.tick_size if filters else None,
            symbol_status=filters.status if filters else "TRADING",
            data_is_stale=bool(context["ticker"].get("stale")),
            data_is_synthetic=bool(context["ticker"].get("synthetic")),
            expected_slippage_bps=self.settings.default_slippage_bps,
            volatility_pct=context["volatility_pct"],
            spread_bps=context["spread_bps"],
        )
        return intent, adjustments

    def _portfolio_context(self, user: User, mode: TradingMode, prices: dict[str, Decimal]) -> dict:
        policy = ensure_policy(self.db, user)
        if mode == TradingMode.live:
            from .portfolio import PortfolioService

            portfolio = PortfolioService(self.settings, self.market, self.credentials)
            try:
                state = portfolio.live_state(self.db, user)
            except Exception as exc:
                raise ForbiddenError(
                    "Live balances are unavailable, so the trade cannot be risk-checked.",
                    details={"reason": str(exc)},
                ) from exc
            equity = Decimal(str(state["total_value_usdt"]))
            available = Decimal(str(state["available_usdt"]))
            exposure = Decimal(str(state["exposure"]))
        else:
            open_symbols = [
                row.symbol
                for row in self.db.scalars(
                    select(PaperPosition).where(
                        PaperPosition.user_id == user.id, PaperPosition.status == "open"
                    )
                ).all()
            ]
            all_prices = dict(prices)
            for symbol in open_symbols:
                if symbol not in all_prices:
                    try:
                        all_prices[symbol] = Decimal(str(self.market.ticker(symbol)["price"]))
                    except Exception:  # pragma: no cover - valuations are best-effort
                        continue
            state = self.paper.state(self.db, user, all_prices)
            equity = Decimal(str(state["total_value_usdt"]))
            available = Decimal(str(state["available_usdt"]))
            exposure = Decimal(str(state["exposure"]))
        since = trading_day_start()
        daily = paper_daily_realized_pnl(self.db, user.id, since)
        return {
            "policy": policy,
            "equity": equity,
            "available": available,
            "exposure": exposure,
            "daily_realized_pnl": daily,
            "open_orders": count_open_orders(self.db, user.id, mode),
            "open_positions": int(state.get("position_count", 0)),
        }

    def _evaluate(
        self,
        user: User,
        request: OrderRequest,
        intent: OrderIntent,
        portfolio: dict,
    ) -> RiskDecision:
        control = get_control(self.db)
        position = self.db.scalar(
            select(PaperPosition).where(
                PaperPosition.user_id == user.id,
                PaperPosition.symbol == request.symbol,
                PaperPosition.status == "open",
            )
        )
        position_qty = position.quantity if position else ZERO
        manual_approval = True
        if request.mode == TradingMode.live and not self.settings.require_manual_approval:
            manual_approval = request.approved
        return self.risk.evaluate(
            intent,
            policy=portfolio["policy"],
            control=control,
            equity=portfolio["equity"],
            available_quote=portfolio["available"],
            daily_realized_pnl=portfolio["daily_realized_pnl"],
            current_exposure=portfolio["exposure"],
            open_orders=portfolio["open_orders"],
            open_positions=portfolio["open_positions"],
            position_quantity=position_qty,
            manual_approval=manual_approval,
        )

    def _prices_for(self, symbols: list[str]) -> dict[str, Decimal]:
        prices: dict[str, Decimal] = {}
        for symbol in symbols:
            try:
                prices[symbol] = Decimal(str(self.market.ticker(symbol)["price"]))
            except Exception:  # pragma: no cover - price optional for valuation
                continue
        return prices

    # ---------------------------------------------------------------- preview
    def preview(self, user: User, request: OrderRequest) -> dict:
        self._validate_request_shape(request)
        context = self._market_context(request.symbol)
        intent, adjustments = self._build_intent(request, context, context["filters"])
        portfolio = self._portfolio_context(user, request.mode, {request.symbol: context["price"]})
        decision = self._evaluate(user, request, intent, portfolio)
        fee = (intent.quote_notional * Decimal(str(self.settings.default_taker_fee_bps)) / Decimal(10_000)).quantize(
            Decimal("0.00000001")
        )
        return {
            "symbol": request.symbol,
            "mode": request.mode.value,
            "side": request.side.value,
            "order_type": request.order_type.value,
            "quantity": str(intent.quantity),
            "reference_price": str(context["price"]),
            "estimated_notional": str(intent.quote_notional),
            "estimated_fee_usdt": str(fee),
            "estimated_slippage_bps": self.settings.default_slippage_bps,
            "adjustments": adjustments,
            "risk": decision.to_dict(),
            "can_place": decision.approved,
            "market": {
                "source": context["ticker"].get("source"),
                "synthetic": context["ticker"].get("synthetic"),
                "stale": context["ticker"].get("stale"),
                "age_seconds": context["ticker"].get("age_seconds"),
                "spread_bps": context["spread_bps"],
                "volatility_pct": context["volatility_pct"],
            },
            "filters": context["filters"].describe() if context["filters"] else None,
        }

    @staticmethod
    def _validate_request_shape(request: OrderRequest) -> None:
        if not request.idempotency_key or len(request.idempotency_key) < 8:
            raise ValidationAppError(
                "An idempotency key of at least 8 characters is required to prevent duplicate orders."
            )
        if request.quantity <= 0:
            raise ValidationAppError("Quantity must be greater than zero.")
        if request.order_type in (OrderType.LIMIT, OrderType.STOP_LOSS_LIMIT, OrderType.TAKE_PROFIT_LIMIT):
            if request.price is None or request.price <= 0:
                raise ValidationAppError(f"{request.order_type.value} orders require a positive limit price.")
        if request.order_type in (OrderType.STOP_LOSS_LIMIT, OrderType.TAKE_PROFIT_LIMIT):
            if request.stop_price is None or request.stop_price <= 0:
                raise ValidationAppError(f"{request.order_type.value} orders require a positive stop price.")

    # ------------------------------------------------------------------ place
    def place(self, user: User, request: OrderRequest) -> dict:
        request.symbol = request.symbol.upper()
        self._validate_request_shape(request)

        replay = self._find_by_idempotency(user, request)
        if replay is not None:
            return {**self.serialize(replay), "idempotent_replay": True}

        context = self._market_context(request.symbol)
        intent, adjustments = self._build_intent(request, context, context["filters"])
        self._guard_duplicates(user, request, intent.quantity)

        # Live gating happens before risk evaluation so the client gets a clear,
        # actionable 403 instead of a generic rejection.
        if request.mode == TradingMode.live:
            self._live_preconditions(user, request)
        portfolio = self._portfolio_context(user, request.mode, {request.symbol: context["price"]})
        decision = self._evaluate(user, request, intent, portfolio)
        if not decision.approved:
            audit.record(
                self.db,
                action="order.rejected",
                user=user,
                target_type="order",
                target_id=request.symbol,
                outcome="rejected",
                detail={"violations": decision.violations, "mode": request.mode.value},
            )
            # Keep the rejection in the audit trail even though the request fails.
            self.db.commit()
            raise RiskRejectedError(
                "The order was rejected by the risk engine.",
                details={"violations": decision.violations, "warnings": decision.warnings, "checks": decision.to_dict()["checks"]},
            )

        if request.mode == TradingMode.live:
            result = self._place_live(user, request, intent, context, decision)
        elif request.mode == TradingMode.paper:
            result = self._place_paper(user, request, intent, context, decision)
        else:
            raise ValidationAppError("Analysis-only mode cannot place orders. Switch to paper or live.")

        if adjustments:
            result["adjustments"] = adjustments
        self.db.flush()
        return result

    def _find_by_idempotency(self, user: User, request: OrderRequest) -> PaperOrder | ExchangeOrder | None:
        if request.mode == TradingMode.live:
            return self.db.scalar(
                select(ExchangeOrder).where(
                    ExchangeOrder.user_id == user.id, ExchangeOrder.idempotency_key == request.idempotency_key
                )
            )
        return self.db.scalar(
            select(PaperOrder).where(
                PaperOrder.user_id == user.id, PaperOrder.idempotency_key == request.idempotency_key
            )
        )

    def _guard_duplicates(self, user: User, request: OrderRequest, quantity: Decimal) -> None:
        since = _now() - timedelta(seconds=DUPLICATE_WINDOW_SECONDS)
        model = ExchangeOrder if request.mode == TradingMode.live else PaperOrder
        recent = self.db.scalar(
            select(model).where(
                model.user_id == user.id,
                model.symbol == request.symbol,
                model.side == request.side,
                model.quantity == quantity,
                model.created_at >= since,
                model.status.in_([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED, OrderStatus.FILLED]),
            )
        )
        if recent is not None:
            raise ConflictError(
                "An identical order was submitted moments ago. This looks like a duplicate; "
                "wait or change the order before retrying.",
                details={"duplicate_guard_seconds": DUPLICATE_WINDOW_SECONDS, "existing_order_id": recent.id},
            )

    # ----------------------------------------------------------------- paper
    def _place_paper(
        self, user: User, request: OrderRequest, intent: OrderIntent, context: dict, decision: RiskDecision
    ) -> dict:
        ensure_paper_account(self.db, user)
        order = PaperOrder(
            user_id=user.id,
            symbol=request.symbol,
            side=request.side,
            order_type=request.order_type,
            quantity=intent.quantity,
            requested_price=intent.price if request.order_type != OrderType.MARKET else None,
            stop_loss=intent.stop_loss,
            take_profit=intent.take_profit,
            status=OrderStatus.NEW,
            idempotency_key=request.idempotency_key,
            signal_id=request.signal_id,
            note=request.note,
        )
        self.db.add(order)
        try:
            self.db.flush()
        except IntegrityError as exc:  # concurrent retry with the same key
            self.db.rollback()
            raise ConflictError("This order was already submitted.") from exc

        self.paper.execute(self.db, user, order, context["price"])
        self._record_event(order, source="paper_broker", status=order.status.value, payload={"mode": "paper"})
        if order.status == OrderStatus.REJECTED:
            raise ValidationAppError(order.note or "Paper order could not be filled.")
        audit.record(
            self.db,
            action="order.paper.placed",
            user=user,
            target_type="paper_order",
            target_id=order.id,
            detail={
                "symbol": order.symbol,
                "side": order.side.value,
                "quantity": str(order.quantity),
                "status": order.status.value,
                "synthetic": context["ticker"].get("synthetic"),
            },
        )
        self.notifications.notify(
            self.db,
            user,
            kind="order_filled" if order.status == OrderStatus.FILLED else "order_open",
            title=f"Paper {order.side.value} {order.symbol}",
            body=(
                f"Simulated fill of {order.filled_quantity} {order.symbol} at "
                f"{order.average_fill_price}. This is paper trading."
                if order.status == OrderStatus.FILLED
                else f"Simulated {order.status.value.lower()} order created for {order.symbol}."
            ),
            severity="info",
            data={"order_id": order.id, "screen": "orders", "simulated": True},
        )
        payload = self.serialize(order)
        payload["risk"] = decision.to_dict()
        payload["simulated"] = True
        return payload

    # ------------------------------------------------------------------ live
    def _live_preconditions(self, user: User, request: OrderRequest) -> tuple[object, RiskPolicy]:
        if not self.settings.live_trading_enabled:
            raise ForbiddenError(
                "Live trading is disabled on this server. Analysis and paper modes remain available.",
                details={"code": "live_trading_disabled"},
            )
        policy = ensure_policy(self.db, user)
        if not policy.live_opt_in:
            raise ForbiddenError(
                "Live trading needs your explicit opt-in. Open Live trading settings, read the risks and confirm.",
                details={"code": "live_opt_in_required"},
            )
        if not request.approved:
            raise ForbiddenError(
                "This live order has not been confirmed. Review it and approve manually.",
                details={"code": "manual_approval_required"},
            )
        if self.market.is_synthetic():
            raise ForbiddenError(
                "Live orders are blocked while market data is simulated.",
                details={"code": "synthetic_data"},
            )
        credential = self.credentials.active_for(self.db, user, self.settings.binance_env)
        return credential, policy

    def _place_live(
        self, user: User, request: OrderRequest, intent: OrderIntent, context: dict, decision: RiskDecision
    ) -> dict:
        credential, _policy = self._live_preconditions(user, request)
        client_order_id = f"rsai-{uuid.uuid4().hex[:22]}"
        order = ExchangeOrder(
            user_id=user.id,
            credential_id=credential.id,
            symbol=request.symbol,
            client_order_id=client_order_id,
            side=request.side,
            order_type=request.order_type,
            time_in_force=request.time_in_force or (TimeInForce.GTC if request.order_type != OrderType.MARKET else None),
            quantity=intent.quantity,
            price=intent.price if request.order_type != OrderType.MARKET else None,
            stop_price=request.stop_price,
            status=OrderStatus.NEW,
            mode=TradingMode.live,
            environment=self.settings.binance_env,
            idempotency_key=request.idempotency_key,
            signal_id=request.signal_id,
            approved=True,
            approved_at=_now(),
        )
        self.db.add(order)
        self.db.flush()

        params = {
            "symbol": request.symbol,
            "side": request.side.value,
            "type": request.order_type.value,
            "quantity": str(intent.quantity),
            "newClientOrderId": client_order_id,
        }
        if request.order_type != OrderType.MARKET:
            params["price"] = str(intent.price)
            params["timeInForce"] = (request.time_in_force or TimeInForce.GTC).value
        if request.stop_price is not None:
            params["stopPrice"] = str(request.stop_price)

        client: BinanceClient = self.credentials.client_for(credential)
        try:
            response = client.create_order(**params)
        except BinanceError as exc:
            self._handle_live_failure(user, order, client, exc)
            # Persist the attempted order (possibly UNKNOWN) before failing the
            # request so it can be reconciled and never silently lost.
            self.db.commit()
            raise ValidationAppError(
                f"Binance rejected the order: {exc.message}",
                details={"exchange_code": exc.code, "ambiguous": exc.ambiguous, "order_id": order.id},
            ) from exc
        finally:
            client.close()

        self._apply_exchange_response(order, response)
        # Never trust the create response alone — confirm by querying.
        self._confirm_with_exchange(order, client=None)
        self._record_event(order, source="api", status=order.status.value, payload=response)
        audit.record(
            self.db,
            action="order.live.placed",
            user=user,
            target_type="exchange_order",
            target_id=order.id,
            detail={
                "symbol": order.symbol,
                "side": order.side.value,
                "quantity": str(order.quantity),
                "status": order.status.value,
                "environment": order.environment,
            },
        )
        self.notifications.notify(
            self.db,
            user,
            kind="order_status",
            title=f"Live {order.side.value} {order.symbol}: {order.status.value}",
            body=f"Exchange status {order.status.value}. Open the app to review the order.",
            severity="warning" if order.status in (OrderStatus.UNKNOWN, OrderStatus.REJECTED) else "info",
            data={"order_id": order.id, "screen": "orders"},
        )
        payload = self.serialize(order)
        payload["risk"] = decision.to_dict()
        payload["simulated"] = False
        return payload

    def _handle_live_failure(self, user: User, order: ExchangeOrder, client: BinanceClient, exc: BinanceError) -> None:
        order.last_error = f"{exc.code}: {exc.message}"[:255]
        if exc.ambiguous:
            # The request may have reached the matching engine. Query by our
            # client order id; if it exists we adopt it, otherwise mark rejected.
            order.status = OrderStatus.UNKNOWN
            try:
                found = client.query_order(order.symbol, client_order_id=order.client_order_id)
                self._apply_exchange_response(order, found)
            except BinanceError as query_exc:
                log.warning("ambiguous order could not be reconciled yet: %s", query_exc.message)
        else:
            order.status = OrderStatus.REJECTED
        self._record_event(order, source="api", status=order.status.value, payload={"error": exc.message})
        self.notifications.notify(
            self.db,
            user,
            kind="order_error",
            title=f"Order issue for {order.symbol}",
            body=f"Binance reported: {exc.message[:180]}",
            severity="error" if order.status == OrderStatus.REJECTED else "warning",
            data={"order_id": order.id, "screen": "orders"},
        )

    def _apply_exchange_response(self, order: ExchangeOrder, response: dict) -> None:
        status_map = {
            "NEW": OrderStatus.NEW,
            "PARTIALLY_FILLED": OrderStatus.PARTIALLY_FILLED,
            "FILLED": OrderStatus.FILLED,
            "CANCELED": OrderStatus.CANCELED,
            "PENDING_CANCEL": OrderStatus.CANCELED,
            "REJECTED": OrderStatus.REJECTED,
            "EXPIRED": OrderStatus.EXPIRED,
        }
        order.exchange_order_id = str(response.get("orderId")) if response.get("orderId") is not None else order.exchange_order_id
        order.status = status_map.get(response.get("status", ""), OrderStatus.UNKNOWN)
        order.executed_qty = Decimal(str(response.get("executedQty", "0")) or "0")
        order.cummulative_quote_qty = Decimal(str(response.get("cummulativeQuoteQty", "0")) or "0")
        fills = response.get("fills") or []
        fee_total = ZERO
        for fill in fills:
            try:
                fee_total += Decimal(str(fill.get("commission", "0")))
                order.fee_asset = fill.get("commissionAsset") or order.fee_asset
            except (InvalidOperation, TypeError):
                continue
        order.fee_paid = fee_total
        order.raw_response = {k: v for k, v in response.items() if k != "fills"}

    def _confirm_with_exchange(self, order: ExchangeOrder, client: BinanceClient | None) -> None:
        """Re-query the order so the stored status comes from Binance, not hope."""
        from ..db.models import ApiCredential

        credential = self.db.get(ApiCredential, order.credential_id) if order.credential_id else None
        if credential is None:  # pragma: no cover - defensive
            order.status = OrderStatus.UNKNOWN
            return
        own_client = client is None
        if own_client:
            client = self.credentials.client_for(credential)
        try:
            fresh = client.query_order(order.symbol, client_order_id=order.client_order_id)
            self._apply_exchange_response(order, fresh)
            order.reconciled_at = _now()
        except BinanceError as exc:
            log.info("order confirmation query failed (%s); will reconcile later", exc.message)
            if order.status == OrderStatus.NEW:
                order.status = OrderStatus.UNKNOWN
        finally:
            if own_client:
                client.close()

    # ----------------------------------------------------------------- orders
    def cancel(self, user: User, order_id: str, mode: TradingMode) -> dict:
        if mode == TradingMode.live:
            order = self.db.get(ExchangeOrder, order_id)
            if order is None or order.user_id != user.id:
                raise NotFoundError("Order not found.")
            if order.status not in (OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED, OrderStatus.UNKNOWN):
                raise ValidationAppError(f"Order is {order.status.value} and cannot be cancelled.")
            credential = self.credentials.active_for(self.db, user, order.environment)
            client = self.credentials.client_for(credential)
            try:
                response = client.cancel_order(order.symbol, client_order_id=order.client_order_id)
                self._apply_exchange_response(order, response)
            except BinanceError as exc:
                order.last_error = f"{exc.code}: {exc.message}"[:255]
                raise ValidationAppError(
                    f"Binance could not cancel the order: {exc.message}",
                    details={"exchange_code": exc.code},
                ) from exc
            finally:
                client.close()
        else:
            order = self.db.get(PaperOrder, order_id)
            if order is None or order.user_id != user.id:
                raise NotFoundError("Order not found.")
            if order.status not in (OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED):
                raise ValidationAppError(f"Order is {order.status.value} and cannot be cancelled.")
            order.status = OrderStatus.CANCELED
            self._record_event(order, source="api", status="CANCELED", payload={})
        audit.record(self.db, action="order.cancelled", user=user, target_type="order", target_id=order_id)
        payload = self.serialize(order)
        payload["mode"] = mode.value
        return payload

    def list_orders(
        self,
        user: User,
        *,
        mode: TradingMode = TradingMode.paper,
        open_only: bool = False,
        limit: int = 100,
    ) -> list[dict]:
        if mode == TradingMode.live:
            stmt = select(ExchangeOrder).where(ExchangeOrder.user_id == user.id)
            if open_only:
                stmt = stmt.where(ExchangeOrder.status.in_([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED, OrderStatus.UNKNOWN]))
        else:
            stmt = select(PaperOrder).where(PaperOrder.user_id == user.id)
            if open_only:
                stmt = stmt.where(PaperOrder.status.in_([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED]))
        created_column = ExchangeOrder.created_at if mode == TradingMode.live else PaperOrder.created_at
        rows = self.db.scalars(stmt.order_by(created_column.desc()).limit(limit)).all()
        return [self.serialize(row) for row in rows]

    def get_order(self, user: User, order_id: str, mode: TradingMode) -> dict:
        model = ExchangeOrder if mode == TradingMode.live else PaperOrder
        order = self.db.get(model, order_id)
        if order is None or order.user_id != user.id:
            raise NotFoundError("Order not found.")
        return self.serialize(order)

    # -------------------------------------------------------------- reconcile
    def reconcile_user(self, user: User) -> dict:
        """Synchronise unfinished live orders with Binance."""
        if not self.settings.live_trading_enabled:
            return {"checked": 0, "updated": 0, "note": "live trading disabled"}
        orders = self.db.scalars(
            select(ExchangeOrder).where(
                ExchangeOrder.user_id == user.id,
                ExchangeOrder.status.in_([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED, OrderStatus.UNKNOWN]),
            )
        ).all()
        if not orders:
            return {"checked": 0, "updated": 0}
        try:
            credential = self.credentials.active_for(self.db, user, self.settings.binance_env)
        except NotFoundError:
            return {"checked": 0, "updated": 0, "note": "no active credentials"}
        client = self.credentials.client_for(credential)
        updated = 0
        try:
            for order in orders:
                try:
                    fresh = client.query_order(order.symbol, client_order_id=order.client_order_id)
                except BinanceError as exc:
                    if exc.code == -2013:  # order does not exist
                        if order.status == OrderStatus.UNKNOWN:
                            order.status = OrderStatus.REJECTED
                            order.last_error = "Order not found on the exchange after an ambiguous submission."
                            updated += 1
                    else:
                        order.last_error = f"{exc.code}: {exc.message}"[:255]
                    continue
                previous = order.status
                self._apply_exchange_response(order, fresh)
                order.reconciled_at = _now()
                if order.status != previous:
                    updated += 1
                    self._record_event(order, source="reconciler", status=order.status.value, payload=fresh)
        finally:
            client.close()
        return {"checked": len(orders), "updated": updated}

    # -------------------------------------------------------------- utilities
    def _record_event(self, order, *, source: str, status: str, payload: dict) -> None:
        is_live = isinstance(order, ExchangeOrder)
        self.db.add(
            OrderEvent(
                order_id=order.id if is_live else None,
                paper_order_id=None if is_live else order.id,
                user_id=order.user_id,
                source=source,
                status=status,
                payload=payload,
            )
        )

    @staticmethod
    def serialize(order) -> dict:
        live = isinstance(order, ExchangeOrder)
        status = order.status.value if hasattr(order.status, "value") else str(order.status)
        side = order.side.value if hasattr(order.side, "value") else str(order.side)
        order_type = order.order_type.value if hasattr(order.order_type, "value") else str(order.order_type)

        limit_price = order.price if live else order.requested_price
        if live:
            average_fill = (
                (order.cummulative_quote_qty / order.executed_qty).quantize(Decimal("0.00000001"))
                if order.executed_qty and order.executed_qty > 0
                else None
            )
        else:
            average_fill = order.average_fill_price

        return {
            "id": order.id,
            "mode": "live" if live else "paper",
            "symbol": order.symbol,
            "side": side,
            "order_type": order_type,
            "quantity": str(order.quantity),
            "price": str(limit_price) if limit_price is not None else None,
            "stop_loss": str(order.stop_loss) if getattr(order, "stop_loss", None) is not None else None,
            "take_profit": str(order.take_profit) if getattr(order, "take_profit", None) is not None else None,
            "status": status,
            "filled_quantity": str(order.executed_qty if live else order.filled_quantity),
            "average_fill_price": str(average_fill) if average_fill is not None else None,
            "fee_paid": str(order.fee_paid),
            "fee_asset": getattr(order, "fee_asset", None),
            "client_order_id": order.client_order_id if live else None,
            "exchange_order_id": order.exchange_order_id if live else None,
            "approved": bool(getattr(order, "approved", True)),
            "environment": order.environment if live else "paper",
            "signal_id": order.signal_id,
            "note": getattr(order, "note", None),
            "last_error": getattr(order, "last_error", None),
            "reconciled_at": order.reconciled_at.isoformat() if getattr(order, "reconciled_at", None) else None,
            "created_at": order.created_at.isoformat(),
            "updated_at": order.updated_at.isoformat(),
        }
