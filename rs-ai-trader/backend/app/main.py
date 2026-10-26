"""FastAPI application factory for RS AI TRADER."""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .api.routes import (
    admin,
    alerts,
    assistant,
    auth,
    credentials,
    market,
    orders,
    portfolio,
    risk,
    signals,
    stream,
    system,
)
from .core.config import Settings, get_settings
from .core.errors import install_exception_handlers
from .core.logging import configure_logging
from .core.ratelimit import RateLimiter
from .core.security import SecretBox
from .db.base import build_engine, configure_database, create_all
from .services.ai import SignalService
from .services.alerts import AlertService
from .services.assistant import AssistantService
from .services.background import BackgroundRunner
from .services.credentials import CredentialService
from .services.market import build_market_service
from .services.notifications import NotificationService
from .services.portfolio import PortfolioService

log = logging.getLogger(__name__)


def _connect_redis(settings: Settings):
    if not settings.redis_url:
        return None
    try:
        import redis  # type: ignore

        client = redis.Redis.from_url(
            settings.redis_url, socket_connect_timeout=1.5, socket_timeout=1.5, decode_responses=True
        )
        client.ping()
        log.info("redis connected")
        return client
    except Exception as exc:  # pragma: no cover - optional dependency
        log.warning("redis unavailable (%s); using in-process cache and rate limits", exc.__class__.__name__)
        return None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_output=settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.settings = settings
        app.state.started_at = time.time()

        engine = build_engine(settings)
        configure_database(engine)
        if settings.environment in ("development", "test"):
            # Production uses Alembic migrations (database/migrations).
            create_all(engine)

        redis_client = _connect_redis(settings)
        app.state.redis = redis_client

        market_service = build_market_service(settings, redis_client=redis_client)
        notifications = NotificationService(settings)
        credentials_service = CredentialService(settings, SecretBox(settings))
        portfolio_service = PortfolioService(settings, market_service, credentials_service)
        signal_service = SignalService(settings, market_service)
        alert_service = AlertService(market_service, notifications)
        assistant_service = AssistantService(settings, market_service, signal_service, portfolio_service)

        app.state.market = market_service
        app.state.notifications = notifications
        app.state.credentials = credentials_service
        app.state.portfolio = portfolio_service
        app.state.signal_service = signal_service
        app.state.alerts = alert_service
        app.state.assistant = assistant_service
        app.state.rate_limiter = RateLimiter(redis_client)

        runner = None
        if settings.background_jobs_enabled and settings.environment != "test":
            runner = BackgroundRunner(settings, market_service, alert_service, notifications, credentials_service)
            runner.start()
        app.state.background = runner
        log.info(
            "RS AI TRADER backend started (env=%s, binance=%s, market=%s, live=%s)",
            settings.environment,
            settings.binance_env,
            settings.market_data_mode,
            settings.live_trading_enabled,
        )
        try:
            yield
        finally:
            if runner is not None:
                await runner.stop()
            if redis_client is not None:
                try:
                    redis_client.close()
                except Exception:  # pragma: no cover
                    pass
            engine.dispose()

    app = FastAPI(
        title="RS AI TRADER API",
        version=__version__,
        description=(
            "Backend for the RS AI TRADER Android application: Binance Spot market data, "
            "calibrated analysis signals, paper trading, server-side risk enforcement and "
            "optional, explicitly-consented live Spot trading."
        ),
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )

    # Route-level Depends(get_settings) must resolve to the settings this app
    # was created with (tests and multi-tenant deployments rely on this).
    app.dependency_overrides[get_settings] = lambda: settings
    install_exception_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-Id", "X-Idempotency-Key"],
    )

    @app.middleware("http")
    async def _request_context(request: Request, call_next):
        request_id = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:  # pragma: no cover - handled by exception handlers below
            raise
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store" if request.url.path.startswith("/api/v1") else "no-cache"
        log.info(
            "%s %s -> %s (%sms)",
            request.method,
            request.url.path,
            response.status_code,
            duration_ms,
            extra={
                "request_id": request_id,
                "path": request.url.path,
                "method": request.method,
                "status_code": response.status_code,
                "duration_ms": duration_ms,
            },
        )
        return response

    @app.middleware("http")
    async def _maintenance_guard(request: Request, call_next):
        """Block writes during maintenance while keeping reads available."""
        from .db.base import session_scope
        from .services.app_settings import get_value

        if request.method in ("POST", "PUT", "PATCH", "DELETE") and request.url.path.startswith(
            (f"{settings.api_prefix}/orders", f"{settings.api_prefix}/risk")
        ):
            with session_scope() as db:
                if get_value(db, "maintenance_mode", False):
                    db.rollback()
                    return JSONResponse(
                        status_code=503,
                        content={
                            "error": {
                                "code": "maintenance_mode",
                                "message": "Trading is paused for maintenance. Market data and analysis remain available.",
                                "details": {},
                            }
                        },
                    )
                db.rollback()
        return await call_next(request)

    for router in (
        auth.router,
        market.router,
        signals.router,
        orders.router,
        portfolio.router,
        risk.router,
        alerts.router,
        assistant.router,
        credentials.router,
        admin.router,
        system.router,
        stream.router,
    ):
        app.include_router(router, prefix=settings.api_prefix)
    app.include_router(system.router)  # /health and /config at the root as well

    @app.get("/", include_in_schema=False)
    def root() -> dict:
        return {
            "app": settings.app_name,
            "version": __version__,
            "docs": "/docs",
            "api": settings.api_prefix,
            "notice": "Analysis and paper trading by default. Live Spot trading requires explicit consent.",
        }

    @app.get("/ready", include_in_schema=False)
    def ready() -> dict:
        return {"ready": True, "uptime_seconds": round(time.time() - app.state.started_at, 1)}

    return app


app = create_app()
