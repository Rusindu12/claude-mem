"""Authentication, session and credential-security tests."""
from __future__ import annotations

import base64

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.security import (
    SecretBox,
    create_token,
    decode_token,
    hash_password,
    redact,
    verify_password,
)
from app.main import create_app
from app.services.binance_client import BinanceClient, BinanceError
from app.services.credentials import CredentialService
from tests.conftest import TEST_PASSWORD, auth_headers, make_settings, register


def test_passwords_use_argon2id_and_verify():
    stored = hash_password(TEST_PASSWORD)
    assert stored.startswith("$argon2id$")
    assert TEST_PASSWORD not in stored
    assert verify_password(TEST_PASSWORD, stored)
    assert not verify_password("wrong-password", stored)


def test_register_login_and_me(client):
    tokens = register(client, "alice@example.com")
    assert tokens["token_type"] == "Bearer"
    assert tokens["expires_in"] > 0
    me = client.get("/api/v1/auth/me", headers=auth_headers(tokens))
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"
    assert me.json()["role"] == "user"


def test_weak_password_rejected(client):
    response = client.post(
        "/api/v1/auth/register", json={"email": "weak@example.com", "password": "password", "display_name": "w"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


def test_duplicate_email_conflict(client):
    register(client, "dup@example.com")
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "dup@example.com", "password": TEST_PASSWORD, "display_name": "d"},
    )
    assert response.status_code == 409


def test_login_failures_lock_the_account(client, app):
    from app.db.base import session_scope

    register(client, "lock@example.com")
    limit = app.state.settings.max_login_attempts
    for _ in range(limit):
        response = client.post(
            "/api/v1/auth/login", json={"email": "lock@example.com", "password": "Wrong-Passw0rd!1"}
        )
        assert response.status_code == 401
    blocked = client.post(
        "/api/v1/auth/login", json={"email": "lock@example.com", "password": TEST_PASSWORD}
    )
    assert blocked.status_code == 401
    assert "locked" in blocked.json()["error"]["message"].lower()
    with session_scope() as db:
        from sqlalchemy import select

        from app.db.models import AuditEvent

        events = db.scalars(select(AuditEvent).where(AuditEvent.action == "auth.login_failed")).all()
        assert len(events) == limit


def test_refresh_rotation_and_reuse_detection(client):
    tokens = register(client, "rotate@example.com")
    first = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert first.status_code == 200
    rotated = first.json()
    assert rotated["refresh_token"] != tokens["refresh_token"]
    # Replaying the used refresh token must revoke the family.
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert replay.status_code == 401
    after = client.post("/api/v1/auth/refresh", json={"refresh_token": rotated["refresh_token"]})
    assert after.status_code == 401


def test_access_token_cannot_be_used_as_refresh(client):
    tokens = register(client, "typeconf@example.com")
    response = client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert response.status_code == 401


def test_tampered_token_rejected(client, user_tokens):
    tampered = user_tokens["access_token"][:-4] + "AAAA"
    response = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {tampered}"})
    assert response.status_code == 401


def test_password_change_revokes_previous_tokens(client, user_tokens):
    response = client.post(
        "/api/v1/auth/password/change",
        json={"current_password": TEST_PASSWORD, "new_password": "N3w-Passw0rd!77"},
        headers=auth_headers(user_tokens),
    )
    assert response.status_code == 200
    me = client.get("/api/v1/auth/me", headers=auth_headers(user_tokens))
    assert me.status_code == 401


def test_password_reset_flow(client):
    register(client, "reset@example.com")
    requested = client.post("/api/v1/auth/password/reset/request", json={"email": "reset@example.com"})
    assert requested.status_code == 200
    token = requested.json()["development_reset_token"]
    confirmed = client.post(
        "/api/v1/auth/password/reset/confirm",
        json={"token": token, "new_password": "Res3t-Passw0rd!99"},
    )
    assert confirmed.status_code == 200
    login = client.post(
        "/api/v1/auth/login", json={"email": "reset@example.com", "password": "Res3t-Passw0rd!99"}
    )
    assert login.status_code == 200


def test_sessions_list_and_revoke(client, user_tokens):
    headers = auth_headers(user_tokens)
    sessions = client.get("/api/v1/auth/sessions", headers=headers)
    assert sessions.status_code == 200 and len(sessions.json()) >= 1
    session_id = sessions.json()[0]["id"]
    assert client.delete(f"/api/v1/auth/sessions/{session_id}", headers=headers).status_code == 204


def test_account_deletion_wipes_access(client, user_tokens):
    headers = auth_headers(user_tokens)
    response = client.request(
        "DELETE", "/api/v1/auth/account", headers=headers, json={"password": TEST_PASSWORD, "confirmation": "DELETE"}
    )
    assert response.status_code == 200
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    login = client.post(
        "/api/v1/auth/login", json={"email": "trader@example.com", "password": TEST_PASSWORD}
    )
    assert login.status_code == 401


def test_admin_endpoints_forbidden_for_normal_user(client, user_headers):
    assert client.get("/api/v1/admin/users", headers=user_headers).status_code == 403
    assert client.post(
        "/api/v1/admin/kill-switch", headers=user_headers, json={"engage": True, "reason": "test"}
    ).status_code == 403


def test_admin_flag_cannot_be_self_assigned(client, user_headers):
    response = client.patch("/api/v1/admin/users/whatever", headers=user_headers, json={"role": "admin"})
    assert response.status_code == 403


def test_secret_box_roundtrip_and_user_binding():
    settings = make_settings()
    box = SecretBox(settings)
    ciphertext = box.encrypt("super-secret-value", associated_data="user-1")
    assert "super-secret-value" not in ciphertext
    assert box.decrypt(ciphertext, associated_data="user-1") == "super-secret-value"
    # A ciphertext must not decrypt for a different associated user id.
    try:
        box.decrypt(ciphertext, associated_data="user-2")
        raise AssertionError("decryption should have failed for another user")
    except Exception:
        pass


def test_redaction_strips_keys_tokens_and_passwords():
    payload = {
        "api_key": "A" * 64,
        "nested": {"api_secret": "topsecret", "ok": "value"},
        "header": "X-MBX-APIKEY: " + "B" * 64,
        "authorization": "Bearer abcdefghijklmnopqrstuvwxyz123456",
        "note": "password=hunter2hunter2",
    }
    cleaned = redact(payload)
    flat = str(cleaned)
    assert "A" * 64 not in flat
    assert "topsecret" not in flat
    assert "hunter2hunter2" not in flat
    assert "abcdefghijklmnopqrstuvwxyz123456" not in flat
    assert cleaned["nested"]["ok"] == "value"


def test_logging_filter_redacts(caplog):
    import logging

    from app.core.logging import RedactionFilter

    logger = logging.getLogger("test.redaction")
    logger.addFilter(RedactionFilter())
    with caplog.at_level(logging.INFO, logger="test.redaction"):
        logger.info("api_secret=%s", "C" * 64)
    assert "C" * 64 not in caplog.text


def test_credentials_reject_withdrawal_permission(monkeypatch, client, user_headers):
    """Keys with withdrawals enabled must be refused, never stored."""

    fake_permissions = {
        "enable_reading": True,
        "enable_spot_trading": True,
        "enable_withdrawals": True,
        "enable_margin": False,
        "enable_futures": False,
        "ip_restrict": True,
    }

    monkeypatch.setattr(
        CredentialService, "inspect_permissions", lambda self, client: dict(fake_permissions)
    )
    response = client.post(
        "/api/v1/credentials",
        headers=user_headers,
        json={"api_key": "K" * 40, "api_secret": "S" * 40, "label": "unsafe"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "withdrawal_permission_forbidden"
    listed = client.get("/api/v1/credentials", headers=user_headers).json()
    assert listed["credentials"] == []


def test_credential_is_encrypted_at_rest_and_masked(monkeypatch, client, user_headers, app):
    from sqlalchemy import select

    from app.db.base import session_scope
    from app.db.models import ApiCredential

    monkeypatch.setattr(
        CredentialService,
        "inspect_permissions",
        lambda self, client: {
            "enable_reading": True,
            "enable_spot_trading": True,
            "enable_withdrawals": False,
            "enable_margin": False,
            "enable_futures": False,
            "ip_restrict": True,
        },
    )
    api_key = "KEY" + "x" * 40
    secret = "SECRET" + "y" * 40
    created = client.post(
        "/api/v1/credentials",
        headers=user_headers,
        json={"api_key": api_key, "api_secret": secret, "label": "testnet"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["masked_key"].startswith("KEY")
    assert api_key not in created.text and secret not in created.text

    with session_scope() as db:
        row = db.scalar(select(ApiCredential))
        assert row is not None
        assert secret not in row.secret_ciphertext
        assert row.secret_ciphertext.startswith("v1:")
        assert row.api_key_ciphertext.startswith("v1:")
        box = SecretBox(app.state.settings)
        assert box.decrypt(row.secret_ciphertext, associated_data=row.user_id) == secret


def test_rate_limiting_returns_429():
    settings = make_settings(rate_limit_auth_per_minute=2)
    app = create_app(settings)
    with TestClient(app) as client:
        for index in range(2):
            response = client.post(
                "/api/v1/auth/login",
                json={"email": f"nobody{index}@example.com", "password": "irrelevant-pass"},
            )
            assert response.status_code in (401, 429)
        blocked = client.post(
            "/api/v1/auth/login", json={"email": "nobody@example.com", "password": "irrelevant-pass"}
        )
        assert blocked.status_code == 429
        assert blocked.json()["error"]["code"] == "rate_limited"


def test_health_and_config_are_public(client):
    health = client.get("/api/v1/health")
    assert health.status_code == 200
    assert health.json()["database"] == "ok"
    config = client.get("/api/v1/config")
    assert config.status_code == 200
    body = config.json()
    assert body["live_trading_enabled"] is False
    assert body["binance_environment"] == "testnet"
    assert "disclaimer" in body
