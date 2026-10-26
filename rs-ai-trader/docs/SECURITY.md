# Security model

The system protects three things: user identities, Binance API credentials, and the integrity of
trading decisions. The Android app is treated as untrusted: anyone can decompile an APK, so the app
must never hold exchange secrets, role-elevation logic, or trading rules.

## 1. Threat model

| Threat | Mitigation |
|---|---|
| APK reverse engineering reveals secrets | No Binance key, secret, admin password or authorisation code in the app; the only compiled-in value is the backend URL |
| Token theft from device backup / other apps | Tokens in `EncryptedSharedPreferences` (Android Keystore, AES-256-GCM); `allowBackup=false`, `dataExtractionRules` exclude the token file; no cleartext HTTP in release |
| Credential leak through logs | OkHttp logging is BASIC in debug (method, path, status only) and NONE in release; `Authorization` header redacted; backend redacts keys/secrets/tokens before audit/notification/log writes |
| Credential leak through the API | Secrets are encrypted at rest (AES-256-GCM) and never returned; only `masked_key` (first/last 4 chars) is exposed |
| Credential leak through the network | TLS required outside local dev; `network_security_config.xml` allows cleartext only for `10.0.2.2`/`localhost` in debug |
| Cross-user data access | Every query is scoped by `user_id` from the verified token, never from a request parameter; admin endpoints are role-gated server-side |
| Brute-force / credential stuffing | Argon2id hashing, per-IP+email rate limits, lockout after `MAX_LOGIN_ATTEMPTS`, generic login errors |
| Session hijack after password change | `token_version` claim invalidates every outstanding access/refresh token |
| Privilege escalation | Roles are stored server-side and only changeable through `admin` endpoints or the operator CLI; the app cannot self-promote |
| Malicious/mistaken order | Server-side validation against live exchangeInfo filters + risk engine; client cannot bypass |
| Double submission / replay | Unique idempotency key per order attempt + duplicate-order guard window |
| Fake success reporting | Order state comes from Binance's response/query; ambiguous results become `UNKNOWN` and block further orders on that symbol until reconciled |
| Credential stuffing of the admin panel | Same auth stack + admin-only rate limits + audit trail |
| Data-at-rest theft | DB disk encryption is the operator's responsibility; secrets additionally encrypted at the application layer with a key that is not stored in the DB |

## 2. Android hardening

* `android:allowBackup="false"`, custom `backup_rules.xml` / `data_extraction_rules.xml`.
* Release build: `isMinifyEnabled = true`, `isShrinkResources = true`, ProGuard rules for
  kotlinx.serialization/Retrofit, debug logging compiled out of the logging interceptor path
  (`BuildConfig.DEBUG` is constant-folded).
* No exported activities/services/receivers besides the launcher activity.
* No WebView anywhere in the project.
* Tokens cleared on logout, password change, account deletion, and on a 401 that fails refresh.
* Only one silent refresh attempt per request; a second 401 surfaces as "sign in again".
* The app signs out on `token_version` bumps (backend returns 401 → refresh fails → cleared session).

## 3. Backend hardening checklist

- [x] Argon2id password hashing (`argon2-cffi`, tuned defaults) with a minimum length from settings
- [x] Short-lived access tokens (15 min default) + rotating refresh tokens (14 days)
- [x] `ver` (token_version) claim checked on every request
- [x] Per-route rate limits (`slowapi`, Redis-backed when `UVICORN_WORKERS > 1`)
- [x] Uniform error envelope that never includes stack traces or secrets
- [x] Audit log for auth events, credential changes, risk changes, order actions, admin actions
- [x] Secret redaction in logs and audit details (`redact()` in `core/security.py`)
- [x] Account deletion (data + keys erased, sessions revoked)
- [x] Least-privilege key guidance returned by `credentials` (`withdrawals disabled`, IP allow-list)
- [x] Withdrawal permission is never requested or used; no withdraw endpoint exists in the client
- [x] No futures/margin/leverage/borrowing endpoints or flags
- [ ] Operator: TLS termination, HSTS, firewall, DB encryption, off-host backups, log retention
- [ ] Operator: rotate secrets per `docs/KEY_ROTATION.md`

## 4. Credential lifecycle

1. Operator/user creates a Binance API key with **spot trading only**, **withdrawals disabled** and an
   IP allow-list covering the backend egress address.
2. The app PUTs it once over TLS to `POST /api/v1/credentials`; the device does not persist it
   (fields are cleared from memory after the call).
3. Backend encrypts `api_secret` with AES-256-GCM (`APP_ENCRYPTION_KEY`), stores `masked_key` for
   display, and records `last_verified_at` after a read-only permission probe.
4. Live orders use the decrypted secret in memory only, inside the request that signs it.
5. Revoking (`DELETE /credentials/{id}`) erases the ciphertext immediately and audits the action.
6. Account deletion erases all credentials for that user.

`APP_ENCRYPTION_KEY` is required in production (startup fails without it) and is **not** derived from
`SECRET_KEY`.

## 5. Roles

| Role | Capabilities |
|---|---|
| `user` | Own portfolio, orders, signals, alerts, credentials, assistant, risk policy |
| `admin` | Everything above plus user administration, audit log, runtime settings, symbol filters, global kill switch |

Admins **cannot** read other users' exchange secrets or plaintext keys — the API never exposes them
and the key material is encrypted per row.

Initial admin creation is deliberately out-of-band:

```bash
cd backend
python -m app.cli create-admin --email you@example.com     # prompts for the password
```

Automation may pass `INITIAL_ADMIN_PASSWORD`, which exists only in the operator's environment. There
is no default admin, no bootstrap code, and no admin "unlock" string in the APK.

## 6. Logging and redaction

`core/security.redact()` removes/hashes values for keys matching `secret`, `api_key`, `apikey`,
`token`, `password`, `authorization`, `signature`, `refresh_token`. Audit `detail` payloads pass
through it before storage. Notification bodies are built from templates that never include secrets.

What is logged: request path/method/status, user id, action, outcome, non-sensitive amounts.
What is never logged: passwords, tokens, API keys/secrets, signatures, full request bodies of
credential/order endpoints.

## 7. Incident response

1. Engage the **global kill switch** (`POST /admin/kill-switch`) or the per-account emergency stop.
2. Cancel remaining open orders on Binance; the app does not close positions automatically.
3. Revoke the Binance key in the Binance console (fastest containment) and delete it in the app.
4. Rotate `SECRET_KEY` (invalidates all sessions), then `APP_ENCRYPTION_KEY` (see `KEY_ROTATION.md`).
5. Review `/admin/audit` and notifications for the affected window.
6. Force password resets; revoke sessions via `logout-all`.

## 8. Reporting

This is a personal/educational project without a bug-bounty programme. If you deploy it publicly,
add a security contact address to your deployment docs and monitor the audit log.
