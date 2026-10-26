"""ORM entities.

Portability notes: UUIDs are stored as 36-char strings and enums as VARCHAR
with a CHECK-free ``native_enum=False`` mapping so the same schema runs on
PostgreSQL (production) and SQLite (tests). Money-like columns use precise
``Numeric`` types — never floats.
"""
from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Boolean,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class UserRole(str, enum.Enum):
    user = "user"
    admin = "admin"


class UserStatus(str, enum.Enum):
    active = "active"
    suspended = "suspended"
    deleted = "deleted"


class OrderSide(str, enum.Enum):
    BUY = "BUY"
    SELL = "SELL"


class OrderType(str, enum.Enum):
    MARKET = "MARKET"
    LIMIT = "LIMIT"
    STOP_LOSS_LIMIT = "STOP_LOSS_LIMIT"
    TAKE_PROFIT_LIMIT = "TAKE_PROFIT_LIMIT"


class TimeInForce(str, enum.Enum):
    GTC = "GTC"
    IOC = "IOC"
    FOK = "FOK"


class OrderStatus(str, enum.Enum):
    PENDING_APPROVAL = "PENDING_APPROVAL"
    NEW = "NEW"
    PARTIALLY_FILLED = "PARTIALLY_FILLED"
    FILLED = "FILLED"
    CANCELED = "CANCELED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    UNKNOWN = "UNKNOWN"  # sent but not confirmed — must be reconciled


class TradingMode(str, enum.Enum):
    analysis = "analysis"
    paper = "paper"
    live = "live"


class CredentialStatus(str, enum.Enum):
    active = "active"
    invalid = "invalid"
    revoked = "revoked"


class AlertCondition(str, enum.Enum):
    price_above = "price_above"
    price_below = "price_below"
    rsi_above = "rsi_above"
    rsi_below = "rsi_below"
    signal_buy = "signal_buy"
    signal_sell = "signal_sell"


class AlertStatus(str, enum.Enum):
    active = "active"
    triggered = "triggered"
    disabled = "disabled"


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str] = mapped_column(String(80), nullable=False, default="Trader")
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole, native_enum=False), default=UserRole.user, nullable=False)
    status: Mapped[UserStatus] = mapped_column(SAEnum(UserStatus, native_enum=False), default=UserStatus.active, nullable=False)
    language: Mapped[str] = mapped_column(String(5), default="en", nullable=False)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    password_changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    token_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    fcm_token: Mapped[str | None] = mapped_column(String(400))

    sessions: Mapped[list["RefreshToken"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    risk_policy: Mapped["RiskPolicy | None"] = relationship(back_populates="user", uselist=False)
    paper_account: Mapped["PaperAccount | None"] = relationship(back_populates="user", uselist=False)

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.admin

    @property
    def is_active(self) -> bool:
        return self.status == UserStatus.active and self.deleted_at is None


class RefreshToken(Base, TimestampMixin):
    __tablename__ = "refresh_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    jti: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    replaced_by_jti: Mapped[str | None] = mapped_column(String(36))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    device_label: Mapped[str | None] = mapped_column(String(80))

    user: Mapped[User] = relationship(back_populates="sessions")

    @property
    def is_active(self) -> bool:
        return self.revoked_at is None and self.expires_at > utcnow()


class PasswordResetToken(Base, TimestampMixin):
    __tablename__ = "password_reset_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime, nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AuditEvent(Base, TimestampMixin):
    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    actor_role: Mapped[str] = mapped_column(String(20), default="anonymous")
    action: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[str | None] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(20), default="success")
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    detail: Mapped[dict] = mapped_column(JSON, default=dict)

    __table_args__ = (Index("ix_audit_created", "created_at"),)


class ApiCredential(Base, TimestampMixin):
    """Binance API credentials — always encrypted, never returned to clients."""

    __tablename__ = "api_credentials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(60), default="Binance")
    environment: Mapped[str] = mapped_column(String(10), default="testnet")
    api_key_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    secret_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    key_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    masked_key: Mapped[str] = mapped_column(String(20), nullable=False)
    permissions: Mapped[dict] = mapped_column(JSON, default=dict)
    can_withdraw: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    ip_restricted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[CredentialStatus] = mapped_column(
        SAEnum(CredentialStatus, native_enum=False), default=CredentialStatus.active, nullable=False
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_error: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (UniqueConstraint("user_id", "key_fingerprint", name="uq_user_key_fingerprint"),)


class TradingPair(Base, TimestampMixin):
    __tablename__ = "trading_pairs"

    symbol: Mapped[str] = mapped_column(String(20), primary_key=True)
    base_asset: Mapped[str] = mapped_column(String(12), nullable=False)
    quote_asset: Mapped[str] = mapped_column(String(12), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="UNKNOWN")
    min_qty: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    max_qty: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    step_size: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    tick_size: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    min_notional: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    max_num_orders: Mapped[int | None] = mapped_column(Integer)
    filters_synced_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class RiskPolicy(Base, TimestampMixin):
    __tablename__ = "risk_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    max_trade_notional: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("100"))
    max_portfolio_exposure_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=Decimal("25"))
    max_daily_loss: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("50"))
    max_risk_per_trade_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=Decimal("1"))
    max_open_orders: Mapped[int] = mapped_column(Integer, default=3)
    max_open_positions: Mapped[int] = mapped_column(Integer, default=2)
    stop_loss_required: Mapped[bool] = mapped_column(Boolean, default=True)
    cooldown_after_losses: Mapped[int] = mapped_column(Integer, default=3)
    cooldown_minutes: Mapped[int] = mapped_column(Integer, default=60)
    daily_loss_hit_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    cooldown_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    consecutive_losses: Mapped[int] = mapped_column(Integer, default=0)

    # Consent flags — every one must be true for a live order to be accepted.
    live_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)
    live_consent_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    automation_opt_in: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped[User] = relationship(back_populates="risk_policy")


class TradingControl(Base, TimestampMixin):
    """Global kill switch + emergency state (admin owned)."""

    __tablename__ = "trading_controls"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default="global")
    kill_switch: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255))
    activated_by: Mapped[str | None] = mapped_column(String(36))
    activated_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    stale_data_block: Mapped[bool] = mapped_column(Boolean, default=False)
    api_error_block: Mapped[bool] = mapped_column(Boolean, default=False)


class PaperAccount(Base, TimestampMixin):
    __tablename__ = "paper_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    starting_equity: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("10000"))
    quote_balance: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("10000"))
    realized_pnl: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    fees_paid: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    peak_equity: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("10000"))

    user: Mapped[User] = relationship(back_populates="paper_account")


class PaperPosition(Base, TimestampMixin):
    __tablename__ = "paper_positions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
    entry_price: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    take_profit: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    status: Mapped[str] = mapped_column(String(12), default="open", nullable=False)
    opened_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    exit_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    realized_pnl: Mapped[Decimal | None] = mapped_column(Numeric(20, 8))
    fees: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    signal_id: Mapped[str | None] = mapped_column(String(36), index=True)

    __table_args__ = (Index("ix_paper_positions_user_status", "user_id", "status"),)


class PaperOrder(Base, TimestampMixin):
    __tablename__ = "paper_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    side: Mapped[OrderSide] = mapped_column(SAEnum(OrderSide, native_enum=False), nullable=False)
    order_type: Mapped[OrderType] = mapped_column(SAEnum(OrderType, native_enum=False), default=OrderType.MARKET)
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
    requested_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    filled_quantity: Mapped[Decimal] = mapped_column(Numeric(28, 12), default=Decimal("0"))
    average_fill_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    stop_loss: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    take_profit: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    status: Mapped[OrderStatus] = mapped_column(
        SAEnum(OrderStatus, native_enum=False), default=OrderStatus.NEW, nullable=False
    )
    fee_paid: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    slippage_bps: Mapped[Decimal] = mapped_column(Numeric(10, 4), default=Decimal("0"))
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    signal_id: Mapped[str | None] = mapped_column(String(36))
    note: Mapped[str | None] = mapped_column(String(255))

    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_paper_order_idempotency"),
        Index("ix_paper_orders_user_status", "user_id", "status"),
    )


class ExchangeOrder(Base, TimestampMixin):
    """Mirror of an order sent to (or received from) Binance."""

    __tablename__ = "exchange_orders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    credential_id: Mapped[str | None] = mapped_column(ForeignKey("api_credentials.id", ondelete="SET NULL"))
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    client_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    exchange_order_id: Mapped[str | None] = mapped_column(String(64), index=True)
    side: Mapped[OrderSide] = mapped_column(SAEnum(OrderSide, native_enum=False), nullable=False)
    order_type: Mapped[OrderType] = mapped_column(SAEnum(OrderType, native_enum=False), nullable=False)
    time_in_force: Mapped[TimeInForce | None] = mapped_column(SAEnum(TimeInForce, native_enum=False))
    quantity: Mapped[Decimal] = mapped_column(Numeric(28, 12), nullable=False)
    price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    stop_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    status: Mapped[OrderStatus] = mapped_column(
        SAEnum(OrderStatus, native_enum=False), default=OrderStatus.NEW, nullable=False
    )
    executed_qty: Mapped[Decimal] = mapped_column(Numeric(28, 12), default=Decimal("0"))
    cummulative_quote_qty: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    fee_paid: Mapped[Decimal] = mapped_column(Numeric(20, 8), default=Decimal("0"))
    fee_asset: Mapped[str | None] = mapped_column(String(12))
    mode: Mapped[TradingMode] = mapped_column(SAEnum(TradingMode, native_enum=False), default=TradingMode.live)
    environment: Mapped[str] = mapped_column(String(10), default="testnet")
    idempotency_key: Mapped[str] = mapped_column(String(80), nullable=False)
    signal_id: Mapped[str | None] = mapped_column(String(36))
    approved: Mapped[bool] = mapped_column(Boolean, default=False)
    approved_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    raw_response: Mapped[dict] = mapped_column(JSON, default=dict)
    last_error: Mapped[str | None] = mapped_column(String(255))
    reconciled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_exchange_order_idempotency"),
        UniqueConstraint("user_id", "client_order_id", name="uq_exchange_client_order"),
        Index("ix_exchange_orders_user_status", "user_id", "status"),
    )


class OrderEvent(Base):
    __tablename__ = "order_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    order_id: Mapped[str | None] = mapped_column(String(36), index=True)
    paper_order_id: Mapped[str | None] = mapped_column(String(36), index=True)
    user_id: Mapped[str | None] = mapped_column(String(36), index=True)
    source: Mapped[str] = mapped_column(String(24), default="api")  # api | user_stream | reconciler
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)


class SignalRecord(Base, TimestampMixin):
    __tablename__ = "signals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    action: Mapped[str] = mapped_column(String(8), nullable=False)
    score: Mapped[Decimal | None] = mapped_column(Numeric(10, 4))
    model_version: Mapped[str | None] = mapped_column(String(40))
    model_status: Mapped[str | None] = mapped_column(String(40))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)

    __table_args__ = (Index("ix_signals_symbol_tf_created", "symbol", "timeframe", "created_at"),)


class BacktestRun(Base, TimestampMixin):
    __tablename__ = "backtest_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(8), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="completed")
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)
    assumptions: Mapped[list] = mapped_column(JSON, default=list)


class PriceAlert(Base, TimestampMixin):
    __tablename__ = "price_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False)
    condition: Mapped[AlertCondition] = mapped_column(SAEnum(AlertCondition, native_enum=False), nullable=False)
    target_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))
    note: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[AlertStatus] = mapped_column(
        SAEnum(AlertStatus, native_enum=False), default=AlertStatus.active, nullable=False
    )
    triggered_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    triggered_price: Mapped[Decimal | None] = mapped_column(Numeric(28, 12))


class Notification(Base, TimestampMixin):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(String(500), nullable=False)
    severity: Mapped[str] = mapped_column(String(12), default="info")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime)


class AppSetting(Base, TimestampMixin):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    description: Mapped[str | None] = mapped_column(String(255))
    updated_by: Mapped[str | None] = mapped_column(String(36))


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    question: Mapped[str] = mapped_column(String(1000), nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    lang: Mapped[str] = mapped_column(String(5), default="en")
    intent: Mapped[str] = mapped_column(String(40), default="app")
    context: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow, nullable=False)
