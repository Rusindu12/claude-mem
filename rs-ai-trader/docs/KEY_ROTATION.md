# Key and credential rotation

Three different secrets are rotated for different reasons. Do them in this order.

## 1. Binance API keys (routine, no downtime)

1. Create a **new** key in Binance API Management: spot trading enabled, **withdrawals disabled**,
   IP allow-list covering the backend egress. Keep the old key active for a few minutes.
2. In the app: **More → API connection** → store the new key → **Verify**.
3. Place a small order (or run `POST /credentials/{id}/verify`) to confirm the new key works.
4. Revoke the **old** key in Binance, then delete it in the app (`DELETE /credentials/{id}`).
5. Check `/admin/audit` for `credential.*` entries.

If a key may be compromised: revoke it in Binance **first**, then delete it in the app, then review
orders/audit for the exposure window.

## 2. `SECRET_KEY` (JWT signing)

Rotating it invalidates every access and refresh token — all users must sign in again.

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"   # new value
# update SECRET_KEY in .env / secret manager
docker compose up -d backend        # or systemctl restart rsai-backend
```

Announce it if you have users. No database change is needed; old tokens simply fail signature
validation.

## 3. `APP_ENCRYPTION_KEY` (AES-256-GCM for Binance secrets)

**Never just replace this key.** It decrypts every stored API secret; a blind swap makes all stored
credentials unreadable. Procedure:

1. Generate the new key:
   `python -c "import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`
2. Stop the backend (or put it in maintenance mode) so no credential writes happen mid-rotation.
3. Re-encrypt every `api_credentials` row from the old key to the new one. The backend exposes the
   primitive (`SecretBox` in `backend/app/core/security.py`); use a one-off script in the operator's
   environment:

```bash
cd backend
OLD_APP_ENCRYPTION_KEY="$OLD" NEW_APP_ENCRYPTION_KEY="$NEW" \
python - <<'PY'
import os
from sqlalchemy import select
from app.core.config import get_settings
from app.core.security import SecretBox
from app.db.base import create_engine_from_settings, session_scope
from app.db.models import ApiCredential

old = SecretBox(os.environ["OLD_APP_ENCRYPTION_KEY"])
new = SecretBox(os.environ["NEW_APP_ENCRYPTION_KEY"])
engine = create_engine_from_settings(get_settings())
with session_scope(engine) as db:
    rows = db.scalars(select(ApiCredential)).all()
    for row in rows:
        row.api_key_encrypted = new.encrypt(old.decrypt(row.api_key_encrypted))
        row.api_secret_encrypted = new.encrypt(old.decrypt(row.api_secret_encrypted))
    print(f"re-encrypted {len(rows)} credentials")
PY
```

4. Set `APP_ENCRYPTION_KEY` to the new value and restart.
5. Verify with `POST /credentials/{id}/verify` for each stored key (or a small testnet order).
6. Destroy the old key material and any copies.

If step 3 cannot be done (key lost), the only recovery is to delete the stored credentials and
re-enter the Binance keys — which is why production deploys should store `APP_ENCRYPTION_KEY` in a
secret manager with backups.

## 4. Database password

```bash
ALTER USER rsai WITH PASSWORD '<new>';
# update POSTGRES_PASSWORD / DATABASE_URL, then restart the backend
```

## 5. Admin password

Prefer the in-app password change (it revokes sessions) or the CLI:

```bash
cd backend
python -m app.cli create-admin --email you@example.com   # re-run to reset the existing admin's password
```

## 6. Routine schedule

| Secret | Cadence | Trigger for immediate rotation |
|---|---|---|
| Binance API key | 90 days | suspected leak, staff change, unexplained orders |
| `SECRET_KEY` | 180 days | token leakage, incident |
| `APP_ENCRYPTION_KEY` | 365 days | host compromise, backup leak |
| DB password | 180 days | incident |
| Admin password | 90 days | phishing attempt, device loss |

Record each rotation (date, who, why) in your operations log and re-run
`python -m app.cli check-health` afterwards.
