"""Application settings.

Every security-relevant default is the *safe* one:

* live trading is disabled;
* the Binance environment defaults to ``testnet``;
* market-data fallback to synthetic data is off;
* the assistant's LLM polish step is off.

Values come from environment variables / ``.env`` (see ``.env.example``).
"""
from __future__ import annotations

import base64
import secrets
from functools import lru_cache
from typing import Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Environment = Literal["development", "staging", "production", "test"]
BinanceEnv = Literal["testnet", "live"]
MarketDataMode = Literal["binance", "synthetic"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # ---------------------------------------------------------------- basics
    app_name: str = "RS AI TRADER"
    environment: Environment = "development"
    debug: bool = False
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"
    log_json: bool = True

    # ------------------------------------------------------------- security
    secret_key: str = Field(default_factory=lambda: secrets.token_urlsafe(48))
    encryption_key: str | None = None  # base64-encoded 32 bytes
    access_token_ttl_minutes: int = 15
    refresh_token_ttl_days: int = 14
    password_min_length: int = 12
    max_login_attempts: int = 5
    login_lockout_minutes: int = 15
    password_reset_ttl_minutes: int = 30
    allowed_origins: str = "http://localhost:3000"
    trust_proxy_headers: bool = False

    # --------------------------------------------------------------- storage
    database_url: str = "postgresql+psycopg://rsai:rsai@localhost:5432/rsai"
    redis_url: str | None = "redis://localhost:6379/0"
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_echo: bool = False

    # ---------------------------------------------------------------- binance
    binance_env: BinanceEnv = "testnet"
    binance_live_rest_base: str = "https://api.binance.com"
    binance_live_ws_base: str = "wss://stream.binance.com:9443"
    binance_testnet_rest_base: str = "https://testnet.binance.vision"
    binance_testnet_ws_base: str = "wss://stream.testnet.binance.vision"
    binance_recv_window_ms: int = 5000
    binance_timeout_seconds: float = 10.0
    binance_max_retries: int = 3
    binance_rate_limit_buffer: float = 0.8
    binance_user_stream_enabled: bool = True

    # ------------------------------------------------------------ market data
    market_data_mode: MarketDataMode = "binance"
    allow_synthetic_fallback: bool = False
    market_stale_after_seconds: int = 180
    market_cache_ttl_seconds: int = 5
    supported_symbols: str = "BTCUSDT,ETHUSDT,BNBUSDT,SOLUSDT,XRPUSDT,ADAUSDT"
    supported_timeframes: str = "1m,5m,15m,1h,4h,1d"
    kline_history_limit: int = 500

    # -------------------------------------------------------- trading safety
    live_trading_enabled: bool = False
    paper_trading_enabled: bool = True
    automation_enabled: bool = False
    require_manual_approval: bool = True
    default_taker_fee_bps: float = 10.0
    default_slippage_bps: float = 5.0
    order_reconcile_seconds: int = 20
    risk_engine_enabled: bool = True
    background_jobs_enabled: bool = True

    # ------------------------------------------------------------- assistant
    assistant_llm_enabled: bool = False
    assistant_llm_api_key: str | None = None
    assistant_llm_model: str = "gpt-4o-mini"

    # -------------------------------------------------------- notifications
    fcm_credentials_path: str | None = None
    fcm_project_id: str | None = None

    # ------------------------------------------------------------ ai engine
    ai_engine_path: str = "ai-engine"
    ai_artifacts_dir: str = "ai-engine/artifacts"
    ai_min_bars: int = 210

    # ------------------------------------------------------------- admin seed
    # The initial admin is created by an explicit CLI command
    # (``python -m app.cli create-admin``), never by a hardcoded password.
    initial_admin_email: str | None = None
    initial_admin_password: str | None = None  # only for one-shot bootstrap; prefer the CLI prompt

    # ------------------------------------------------------------- rate limit
    rate_limit_auth_per_minute: int = 10
    rate_limit_default_per_minute: int = 120
    rate_limit_orders_per_minute: int = 20

    @field_validator("log_level")
    @classmethod
    def _upper(cls, value: str) -> str:
        return value.upper()

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def symbol_list(self) -> list[str]:
        return [s.strip().upper() for s in self.supported_symbols.split(",") if s.strip()]

    @property
    def timeframe_list(self) -> list[str]:
        return [t.strip() for t in self.supported_timeframes.split(",") if t.strip()]

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def binance_rest_base(self) -> str:
        return self.binance_testnet_rest_base if self.binance_env == "testnet" else self.binance_live_rest_base

    @property
    def binance_ws_base(self) -> str:
        return self.binance_testnet_ws_base if self.binance_env == "testnet" else self.binance_live_ws_base

    @property
    def encryption_key_bytes(self) -> bytes:
        if self.encryption_key:
            raw = base64.urlsafe_b64decode(self.encryption_key + "=" * (-len(self.encryption_key) % 4))
            if len(raw) != 32:
                raise ValueError("APP_ENCRYPTION_KEY must decode to exactly 32 bytes")
            return raw
        if self.is_production:
            raise ValueError(
                "APP_ENCRYPTION_KEY is required in production (generate: "
                "python -c \"import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())\")"
            )
        # Development-only deterministic derivation. Logged as a warning at boot.
        import hashlib

        return hashlib.sha256(f"dev-derivation::{self.secret_key}".encode()).digest()

    @model_validator(mode="after")
    def _production_guards(self) -> "Settings":
        if self.environment == "production":
            if self.debug:
                raise ValueError("DEBUG must be false in production")
            if self.live_trading_enabled and self.binance_env == "testnet":
                raise ValueError(
                    "LIVE_TRADING_ENABLED=true requires BINANCE_ENV=live; refusing ambiguous configuration"
                )
            if self.market_data_mode == "synthetic":
                raise ValueError("synthetic market data is not permitted in production")
            if self.secret_key and len(self.secret_key) < 32:
                raise ValueError("SECRET_KEY must be at least 32 characters in production")
        return self

    def masked(self) -> dict[str, object]:
        """Settings snapshot safe to log / expose to admins."""
        data = self.model_dump()
        for key in ("secret_key", "encryption_key", "assistant_llm_api_key", "initial_admin_password"):
            if data.get(key):
                data[key] = "***redacted***"
        if data.get("database_url"):
            data["database_url"] = _redact_url(str(data["database_url"]))
        if data.get("redis_url"):
            data["redis_url"] = _redact_url(str(data["redis_url"]))
        return data


def _redact_url(url: str) -> str:
    if "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    creds, host = rest.split("@", 1)
    user = creds.split(":", 1)[0]
    return f"{scheme}://{user}:***@{host}"


@lru_cache
def get_settings() -> Settings:
    return Settings()


def reset_settings_cache() -> None:
    get_settings.cache_clear()
