"""Request/response contracts shared with the Android client.

Pydantic models double as OpenAPI documentation (``/docs``), which is the
contract the Kotlin data layer mirrors.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

TradingModeLiteral = Literal["analysis", "paper", "live"]


class ApiError(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ApiError


# ----------------------------------------------------------------------- auth
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(default="Trader", max_length=80)
    language: Literal["en", "si"] = "en"


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=20)


class LogoutRequest(BaseModel):
    refresh_token: str | None = None


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "Bearer"
    expires_in: int
    refresh_expires_in: int
    user: dict[str, Any]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(min_length=10)
    new_password: str = Field(min_length=8, max_length=128)


class AccountDeleteRequest(BaseModel):
    password: str
    confirmation: str = Field(description="Type DELETE to confirm")

    @field_validator("confirmation")
    @classmethod
    def _must_match(cls, value: str) -> str:
        if value.strip().upper() != "DELETE":
            raise ValueError("confirmation must be the word DELETE")
        return value


class SessionInfo(BaseModel):
    id: str
    device: str
    ip_address: str | None = None
    user_agent: str | None = None
    created_at: str
    expires_at: str
    current: bool = False


class FcmTokenRequest(BaseModel):
    token: str = Field(min_length=10, max_length=400)


# --------------------------------------------------------------------- market
class Ticker(BaseModel):
    symbol: str
    price: float
    change_percent_24h: float
    high_24h: float
    low_24h: float
    volume_24h: float
    quote_volume_24h: float
    fetched_at: str
    exchange_close_time: str | None = None
    age_seconds: float | None = None
    source: str
    synthetic: bool
    stale: bool


class Kline(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float


class KlineResponse(BaseModel):
    symbol: str
    interval: str
    klines: list[Kline]
    source: str
    synthetic: bool
    fetched_at: str
    last_candle_close: str
    age_seconds: float
    stale: bool


class DepthResponse(BaseModel):
    symbol: str
    bids: list[list[float]]
    asks: list[list[float]]
    best_bid: float | None
    best_ask: float | None
    spread_bps: float | None
    imbalance: float | None
    source: str
    synthetic: bool
    updated_at: str


class TradeTick(BaseModel):
    id: int | None
    price: float
    quantity: float
    time: str
    buyer_is_maker: bool
    source: str


# -------------------------------------------------------------------- signals
class SignalResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    symbol: str
    timeframe: str
    action: Literal["BUY", "SELL", "HOLD"]
    generated_at: str
    price: float | None
    reasons: list[str]
    indicators: dict[str, Any]
    entry_low: float | None = None
    entry_high: float | None = None
    stop_loss: float | None = None
    take_profit: float | None = None
    risk_reward: float | None = None
    invalidation: list[str] = Field(default_factory=list)
    model_version: str
    model_status: str
    probability_up: float | None = None
    probability_down: float | None = None
    model_performance: dict[str, Any] | None = None
    data_quality: dict[str, Any]
    regime: dict[str, Any]
    score: float
    evidence_grade: str
    disclaimer: str


# --------------------------------------------------------------------- orders
class OrderPreviewRequest(BaseModel):
    symbol: str = Field(max_length=20)
    side: Literal["BUY", "SELL"]
    order_type: Literal["MARKET", "LIMIT", "STOP_LOSS_LIMIT", "TAKE_PROFIT_LIMIT"] = "MARKET"
    quantity: Decimal = Field(gt=0)
    price: Decimal | None = None
    stop_price: Decimal | None = None
    stop_loss: Decimal | None = None
    take_profit: Decimal | None = None
    mode: TradingModeLiteral = "paper"
    time_in_force: Literal["GTC", "IOC", "FOK"] | None = None
    signal_id: str | None = None


class OrderCreateRequest(OrderPreviewRequest):
    idempotency_key: str = Field(min_length=8, max_length=80)
    approved: bool = Field(
        default=False,
        description="Must be true for live orders: the user confirmed this exact order in the app.",
    )


class OrderResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    mode: Literal["paper", "live"]
    symbol: str
    side: str
    order_type: str
    quantity: str
    status: str
    filled_quantity: str
    average_fill_price: str | None = None
    fee_paid: str
    created_at: str


class CancelResponse(BaseModel):
    id: str
    status: str
    mode: str


# ------------------------------------------------------------------ portfolio
class PortfolioResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    mode: Literal["paper", "live"]
    simulated: bool
    total_value_usdt: str
    available_usdt: str | None = None
    positions: list[dict[str, Any]] = Field(default_factory=list)
    note: str | None = None


class AnalyticsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    mode: str
    simulated: bool
    window_days: int
    summary: dict[str, Any]
    daily: list[dict[str, Any]] = Field(default_factory=list)
    note: str | None = None


# ---------------------------------------------------------------------- risk
class RiskPolicyUpdate(BaseModel):
    max_trade_notional: Decimal | None = Field(default=None, gt=0)
    max_portfolio_exposure_pct: Decimal | None = Field(default=None, gt=0, le=100)
    max_daily_loss: Decimal | None = Field(default=None, gt=0)
    max_risk_per_trade_pct: Decimal | None = Field(default=None, gt=0, le=10)
    max_open_orders: int | None = Field(default=None, ge=0, le=50)
    max_open_positions: int | None = Field(default=None, ge=0, le=20)
    stop_loss_required: bool | None = None
    cooldown_after_losses: int | None = Field(default=None, ge=0, le=20)
    cooldown_minutes: int | None = Field(default=None, ge=0, le=1440)
    automation_opt_in: bool | None = None


class LiveOptInRequest(BaseModel):
    opt_in: bool
    confirmation: str = Field(description="Type ENABLE LIVE TRADING to confirm")
    acknowledge_risk: bool = False

    @field_validator("confirmation")
    @classmethod
    def _normalise(cls, value: str) -> str:
        return " ".join(value.strip().upper().split())


class KillSwitchRequest(BaseModel):
    engage: bool
    reason: str = Field(min_length=3, max_length=255)


# --------------------------------------------------------------------- alerts
class AlertCreateRequest(BaseModel):
    symbol: str = Field(max_length=20)
    condition: Literal["price_above", "price_below", "rsi_above", "rsi_below", "signal_buy", "signal_sell"]
    target_price: Decimal | None = None
    note: str | None = Field(default=None, max_length=200)


# ------------------------------------------------------------------ assistant
class AssistantQuery(BaseModel):
    question: str = Field(min_length=2, max_length=800)
    lang: Literal["en", "si"] | None = None
    symbol: str | None = None
    timeframe: str | None = None
    include_portfolio: bool = True


# ---------------------------------------------------------------- credentials
class CredentialCreateRequest(BaseModel):
    api_key: str = Field(min_length=16, max_length=128)
    api_secret: str = Field(min_length=16, max_length=128)
    label: str = Field(default="Binance", max_length=60)
    environment: Literal["testnet", "live"] | None = None


# ------------------------------------------------------------------- backtest
class BacktestRequest(BaseModel):
    symbol: str
    timeframe: Literal["1m", "5m", "15m", "1h", "4h", "1d"] = "1h"
    days: int = Field(default=30, ge=3, le=365)
    initial_capital: float = Field(default=10_000.0, gt=0, le=10_000_000)
    fee_bps: float | None = Field(default=None, ge=0, le=100)
    slippage_bps: float | None = Field(default=None, ge=0, le=100)


# ---------------------------------------------------------------------- admin
class AdminUserUpdate(BaseModel):
    status: Literal["active", "suspended"] | None = None
    role: Literal["user", "admin"] | None = None


class PairToggleRequest(BaseModel):
    enabled: bool


class SettingUpdateRequest(BaseModel):
    key: str = Field(min_length=2, max_length=80)
    value: Any


class NotificationReadRequest(BaseModel):
    notification_id: str | None = None
