"""Credential handling: hashing, token minting and encryption at rest.

Rules enforced here:
* passwords are hashed with Argon2id (``argon2-cffi`` defaults);
* access tokens are short-lived and typed; refresh tokens are stored only as
  SHA-256 hashes, rotated on use, and revocable;
* exchange API secrets are encrypted with AES-256-GCM before they touch the
  database, and decrypted only inside the trading service;
* a shared redaction helper strips secrets from logs and audit payloads.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import Settings

TokenType = Literal["access", "refresh"]

_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

SENSITIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)(api[_-]?key|api[_-]?secret|secret[_-]?key|password|authorization|token)"
               r"(\"?\s*[:=]\s*\"?)([A-Za-z0-9+/=_\-\.]{8,})"),
    re.compile(r"(?i)(X-MBX-APIKEY:\s*)(\S+)"),
    re.compile(r"(?i)(Bearer\s+)([A-Za-z0-9\-\._~+/=]{16,})"),
)

# Binance keys are 64-char base64-ish strings; catch them even without context.
_BINANCE_KEY_LIKE = re.compile(r"\b[A-Za-z0-9]{64}\b")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except InvalidHashError:
        return True


def validate_password_strength(password: str, settings: Settings) -> list[str]:
    problems: list[str] = []
    if len(password) < settings.password_min_length:
        problems.append(f"password must be at least {settings.password_min_length} characters")
    if not re.search(r"[a-z]", password):
        problems.append("password must contain a lowercase letter")
    if not re.search(r"[A-Z]", password):
        problems.append("password must contain an uppercase letter")
    if not re.search(r"\d", password):
        problems.append("password must contain a digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        problems.append("password must contain a symbol")
    if password.lower() in {"password123!", "changeme123!", "admin12345!"}:
        problems.append("password is too common")
    return problems


# --------------------------------------------------------------------- tokens
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_token(
    subject: str,
    token_type: TokenType,
    settings: Settings,
    *,
    role: str = "user",
    extra: dict[str, Any] | None = None,
    token_id: str | None = None,
) -> tuple[str, datetime, str]:
    """Return ``(jwt, expires_at, jti)``."""
    ttl = (
        timedelta(minutes=settings.access_token_ttl_minutes)
        if token_type == "access"
        else timedelta(days=settings.refresh_token_ttl_days)
    )
    issued = _now()
    expires = issued + ttl
    jti = token_id or str(uuid.uuid4())
    payload: dict[str, Any] = {
        "sub": str(subject),
        "type": token_type,
        "role": role,
        "iat": int(issued.timestamp()),
        "nbf": int(issued.timestamp()),
        "exp": int(expires.timestamp()),
        "jti": jti,
        "iss": "rs-ai-trader",
        "aud": "rs-ai-trader-android",
    }
    if extra:
        payload.update(extra)
    token = jwt.encode(payload, settings.secret_key, algorithm="HS256")
    return token, expires, jti


class TokenError(Exception):
    pass


def decode_token(token: str, settings: Settings, *, expected_type: TokenType | None = None) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=["HS256"],
            audience="rs-ai-trader-android",
            issuer="rs-ai-trader",
            options={"require": ["exp", "sub", "type", "jti"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("invalid token") from exc
    if expected_type and payload.get("type") != expected_type:
        raise TokenError(f"expected a {expected_type} token")
    return payload


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def generate_opaque_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def constant_time_compare(a: str, b: str) -> bool:
    return hmac.compare_digest(a, b)


# ----------------------------------------------------------------- encryption
class SecretBox:
    """AES-256-GCM envelope encryption for exchange credentials."""

    PREFIX = "v1"

    def __init__(self, settings: Settings) -> None:
        self._aead = AESGCM(settings.encryption_key_bytes)

    def encrypt(self, plaintext: str, *, associated_data: str | None = None) -> str:
        nonce = secrets.token_bytes(12)
        aad = associated_data.encode() if associated_data else None
        ciphertext = self._aead.encrypt(nonce, plaintext.encode(), aad)
        blob = base64.urlsafe_b64encode(nonce + ciphertext).decode()
        return f"{self.PREFIX}:{blob}"

    def decrypt(self, payload: str, *, associated_data: str | None = None) -> str:
        if not payload.startswith(f"{self.PREFIX}:"):
            raise ValueError("unsupported ciphertext version")
        raw = base64.urlsafe_b64decode(payload.split(":", 1)[1])
        nonce, ciphertext = raw[:12], raw[12:]
        aad = associated_data.encode() if associated_data else None
        return self._aead.decrypt(nonce, ciphertext, aad).decode()


def fingerprint(secret_value: str) -> str:
    """Stable, non-reversible identifier used to spot duplicate keys."""
    return hashlib.sha256(secret_value.encode()).hexdigest()[:16]


def mask_key(key: str) -> str:
    if len(key) <= 8:
        return "****"
    return f"{key[:4]}…{key[-4:]}"


# ------------------------------------------------------------------ redaction
def redact(value: Any) -> Any:
    """Recursively redact likely secrets from a dict/list/log payload."""
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if re.search(r"(?i)(secret|password|token|api_?key|authorization|signature)", str(key)):
                out[key] = "***redacted***" if item else item
            else:
                out[key] = redact(item)
        return out
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    if isinstance(value, str):
        text = value
        for pattern in SENSITIVE_PATTERNS:
            text = pattern.sub(lambda m: m.group(1) + m.group(2) + "***redacted***", text)
        text = _BINANCE_KEY_LIKE.sub("***redacted***", text)
        return text
    return value
