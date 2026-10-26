"""Exchange credential lifecycle.

Invariants
----------
* the plaintext secret leaves this module only inside a :class:`BinanceClient`
  used for a single request batch;
* only ciphertext is stored, with the user id as AES-GCM associated data so a
  ciphertext copied to another account cannot be decrypted;
* keys with withdrawal permission are refused outright;
* nothing is ever returned to the Android client except a masked key and
  permission flags.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import Settings
from ..core.errors import AppError, ConflictError, NotFoundError, UpstreamError, ValidationAppError
from ..core.security import SecretBox, fingerprint, mask_key
from ..db.models import ApiCredential, CredentialStatus, User
from .binance_client import BinanceClient, BinanceError

log = logging.getLogger(__name__)


class WithdrawalPermissionError(ValidationAppError):
    code = "withdrawal_permission_forbidden"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class CredentialService:
    def __init__(self, settings: Settings, box: SecretBox | None = None) -> None:
        self.settings = settings
        self.box = box or SecretBox(settings)

    # -- helpers -----------------------------------------------------------
    def _rest_base(self, environment: str) -> str:
        return self.settings.binance_testnet_rest_base if environment == "testnet" else self.settings.binance_live_rest_base

    def client_for_raw(self, api_key: str, api_secret: str, environment: str) -> BinanceClient:
        return BinanceClient(
            base_url=self._rest_base(environment),
            api_key=api_key,
            api_secret=api_secret,
            recv_window_ms=self.settings.binance_recv_window_ms,
            timeout=self.settings.binance_timeout_seconds,
            max_retries=self.settings.binance_max_retries,
        )

    def client_for(self, credential: ApiCredential) -> BinanceClient:
        api_key = self.box.decrypt(credential.api_key_ciphertext, associated_data=credential.user_id)
        api_secret = self.box.decrypt(credential.secret_ciphertext, associated_data=credential.user_id)
        return self.client_for_raw(api_key, api_secret, credential.environment)

    # -- validation --------------------------------------------------------
    def inspect_permissions(self, client: BinanceClient) -> dict:
        """Read the key's permission flags. Read-only; never enables anything."""
        try:
            restrictions = client.api_restrictions()
        except BinanceError as exc:
            if exc.is_auth_error:
                raise ValidationAppError(
                    "Binance rejected these API credentials. Check the key, secret, IP allow-list and permissions.",
                    details={"exchange_code": exc.code},
                ) from exc
            raise UpstreamError(
                "Could not verify the key permissions with Binance. Try again later.",
                details={"exchange_code": exc.code},
            ) from exc
        return {
            "enable_reading": bool(restrictions.get("enableReading")),
            "enable_spot_trading": bool(
                restrictions.get("enableSpotAndTrading") or restrictions.get("enableSpotAndMarginTrading")
            ),
            "enable_withdrawals": bool(restrictions.get("enableWithdrawals")),
            "enable_margin": bool(restrictions.get("enableMargin")),
            "enable_futures": bool(restrictions.get("enableFutures")),
            "enable_internal_transfer": bool(restrictions.get("enableInternalTransfer")),
            "ip_restrict": bool(restrictions.get("ipRestrict")),
            "raw": restrictions,
        }

    def store(
        self,
        db: Session,
        user: User,
        *,
        api_key: str,
        api_secret: str,
        label: str = "Binance",
        environment: str | None = None,
        verify: bool = True,
    ) -> ApiCredential:
        environment = environment or self.settings.binance_env
        api_key, api_secret = api_key.strip(), api_secret.strip()
        if len(api_key) < 16 or len(api_secret) < 16:
            raise ValidationAppError("That does not look like a Binance API key/secret pair.")

        permissions: dict = {}
        ip_restricted = False
        if verify:
            with self.client_for_raw(api_key, api_secret, environment) as client:
                permissions = self.inspect_permissions(client)
                if permissions["enable_withdrawals"]:
                    raise WithdrawalPermissionError(
                        "This key can withdraw funds. RS AI TRADER never needs withdrawal permission. "
                        "Create a new key with withdrawals disabled and delete this one on Binance.",
                        details={"action": "recreate_key_without_withdrawals"},
                    )
                if not permissions["enable_spot_trading"]:
                    raise ValidationAppError(
                        "This key cannot place Spot orders. Enable 'Enable Spot & Margin Trading' "
                        "(spot only) on Binance, or use the key in read-only mode.",
                        details={"permissions": {k: v for k, v in permissions.items() if k != "raw"}},
                    )
                ip_restricted = permissions["ip_restrict"]
        else:  # pragma: no cover - explicit opt-out used only in local demos
            permissions = {"enable_reading": True, "enable_spot_trading": True, "enable_withdrawals": False}

        key_fp = fingerprint(f"{environment}:{api_key}")
        existing = db.scalar(
            select(ApiCredential).where(ApiCredential.user_id == user.id, ApiCredential.key_fingerprint == key_fp)
        )
        if existing:
            raise ConflictError("This API key is already connected to your account.")

        credential = ApiCredential(
            user_id=user.id,
            label=label[:60],
            environment=environment,
            api_key_ciphertext=self.box.encrypt(api_key, associated_data=user.id),
            secret_ciphertext=self.box.encrypt(api_secret, associated_data=user.id),
            key_fingerprint=key_fp,
            masked_key=mask_key(api_key),
            permissions={k: v for k, v in permissions.items() if k != "raw"},
            can_withdraw=False,
            ip_restricted=ip_restricted,
            status=CredentialStatus.active,
            last_verified_at=_now(),
        )
        db.add(credential)
        db.flush()
        return credential

    # -- queries -----------------------------------------------------------
    def list_for_user(self, db: Session, user: User) -> list[dict]:
        rows = db.scalars(
            select(ApiCredential).where(ApiCredential.user_id == user.id).order_by(ApiCredential.created_at.desc())
        ).all()
        return [self.serialize(row) for row in rows]

    def serialize(self, credential: ApiCredential) -> dict:
        return {
            "id": credential.id,
            "label": credential.label,
            "environment": credential.environment,
            "masked_key": credential.masked_key,
            "status": credential.status.value if hasattr(credential.status, "value") else credential.status,
            "permissions": credential.permissions,
            "ip_restricted": credential.ip_restricted,
            "can_withdraw": False,
            "last_verified_at": credential.last_verified_at.isoformat() if credential.last_verified_at else None,
            "last_error": credential.last_error,
            "created_at": credential.created_at.isoformat(),
        }

    def active_for(self, db: Session, user: User, environment: str) -> ApiCredential:
        credential = db.scalar(
            select(ApiCredential).where(
                ApiCredential.user_id == user.id,
                ApiCredential.environment == environment,
                ApiCredential.status == CredentialStatus.active,
            )
        )
        if credential is None:
            raise NotFoundError(
                f"No active {environment} API key is connected. Add one in Settings → API connection.",
                details={"environment": environment},
            )
        return credential

    def get(self, db: Session, user: User, credential_id: str) -> ApiCredential:
        credential = db.get(ApiCredential, credential_id)
        if credential is None or credential.user_id != user.id:
            raise NotFoundError("API key not found.")
        return credential

    def revoke(self, db: Session, user: User, credential_id: str) -> None:
        credential = self.get(db, user, credential_id)
        credential.status = CredentialStatus.revoked
        credential.label = f"{credential.label} (revoked)"
        # Overwrite the ciphertext so the secret is unrecoverable from the DB.
        credential.api_key_ciphertext = "revoked"
        credential.secret_ciphertext = "revoked"

    def verify(self, db: Session, user: User, credential_id: str) -> dict:
        credential = self.get(db, user, credential_id)
        if credential.status != CredentialStatus.active:
            raise AppError("This key is revoked and cannot be verified.")
        try:
            with self.client_for(credential) as client:
                account = client.account()
                permissions = self.inspect_permissions(client)
        except BinanceError as exc:
            credential.status = CredentialStatus.invalid
            credential.last_error = f"{exc.code}: {exc.message}"[:255]
            raise ValidationAppError(
                "Binance rejected this key during verification.",
                details={"exchange_code": exc.code, "message": exc.message},
            ) from exc
        credential.last_verified_at = _now()
        credential.permissions = {k: v for k, v in permissions.items() if k != "raw"}
        credential.ip_restricted = bool(permissions["ip_restrict"])
        balances = [
            {"asset": b["asset"], "free": b["free"], "locked": b["locked"]}
            for b in account.get("balances", [])
            if float(b.get("free", 0)) or float(b.get("locked", 0))
        ]
        return {
            "verified": True,
            "can_trade": bool(account.get("canTrade")),
            "account_type": account.get("accountType"),
            "balances": balances,
            "permissions": {k: v for k, v in permissions.items() if k != "raw"},
        }
