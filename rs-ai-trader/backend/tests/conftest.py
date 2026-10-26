"""Test harness: SQLite database, synthetic market data, no network calls."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
for path in (BACKEND_ROOT, PROJECT_ROOT / "ai-engine"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

os.environ.setdefault("ENVIRONMENT", "test")

from app.core.config import Settings, reset_settings_cache  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.auth import AuthService  # noqa: E402

TEST_PASSWORD = "Str0ng-Passw0rd!42"


def make_settings(**overrides) -> Settings:
    defaults = dict(
        environment="test",
        debug=False,
        secret_key="test-secret-key-that-is-long-enough-0123456789",
        database_url="sqlite://",
        redis_url=None,
        market_data_mode="synthetic",
        allow_synthetic_fallback=False,
        binance_env="testnet",
        live_trading_enabled=False,
        background_jobs_enabled=False,
        rate_limit_auth_per_minute=10_000,
        rate_limit_default_per_minute=10_000,
        rate_limit_orders_per_minute=10_000,
        ai_engine_path=str(PROJECT_ROOT / "ai-engine"),
        ai_artifacts_dir=str(PROJECT_ROOT / "ai-engine" / "artifacts"),
        log_json=False,
    )
    defaults.update(overrides)
    return Settings(**defaults)


@pytest.fixture()
def settings() -> Settings:
    reset_settings_cache()
    return make_settings()


@pytest.fixture()
def app(settings):
    application = create_app(settings)
    return application


@pytest.fixture()
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def register(client: TestClient, email: str, password: str = TEST_PASSWORD) -> dict:
    response = client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "display_name": "Test Trader", "language": "en"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def auth_headers(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.fixture()
def user_tokens(client) -> dict:
    return register(client, "trader@example.com")


@pytest.fixture()
def user_headers(user_tokens) -> dict[str, str]:
    return auth_headers(user_tokens)


@pytest.fixture()
def admin_headers(client, app) -> dict[str, str]:
    from app.db.base import session_scope

    with session_scope() as db:
        AuthService(app.state.settings).create_admin(
            db, email="admin@example.com", password="Adm1n-Passw0rd!42", display_name="Admin"
        )
        db.commit()
    response = client.post(
        "/api/v1/auth/login", json={"email": "admin@example.com", "password": "Adm1n-Passw0rd!42"}
    )
    assert response.status_code == 200, response.text
    return auth_headers(response.json())


@pytest.fixture()
def db_session(app):
    from app.db.base import session_scope

    session = session_scope()
    try:
        yield session
        session.commit()
    finally:
        session.close()
