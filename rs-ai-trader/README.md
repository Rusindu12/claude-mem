# RS AI TRADER

AI-assisted **Binance Spot** trading app: a native Android client (Kotlin + Jetpack Compose, MVVM),
a Python **FastAPI** backend, a deterministic **AI/indicator engine**, PostgreSQL, Redis and a
paper-trading/backtesting stack.

> **Not financial advice.** Trading crypto assets involves substantial risk of loss. Stop-loss orders
> reduce but do not eliminate losses and are **not guaranteed protection**. Live trading is **off by
> default** and requires an explicit, separate opt-in plus manual approval for every order.

---

## 1. What is in this repository

```
rs-ai-trader/
├── android-app/            Native Android app (Kotlin, Compose, MVVM) — 18 screens
├── backend/                FastAPI service: auth, market data, orders, risk, portfolio, admin
├── ai-engine/              Indicators, regime detection, signal generation, backtesting, assistant
├── database/               schema.sql + Alembic migrations (PostgreSQL)
├── scripts/                generate_schema.py (regenerates database/schema.sql from the models)
├── tests/                  Test runner + notes (suites live next to the code)
├── docs/                   API, security, deployment, testnet, Android build, safety, limitations
├── docker-compose.yml      Postgres 16 + Redis 7 + backend
├── .env.example            Every environment variable, documented
└── README.md
```

| Component | Stack |
|---|---|
| Android | Kotlin 2.0.21, Jetpack Compose (Material 3), Navigation Compose, Retrofit 2.11 + OkHttp 4.12, kotlinx.serialization, EncryptedSharedPreferences, Canvas charts (no chart library) |
| Backend | FastAPI 0.115, SQLAlchemy 2.0, Alembic, psycopg 3, Redis, PyJWT, argon2-cffi, cryptography, slowapi |
| AI engine | Python 3.11, numpy/pandas, joblib, scikit-learn (optional gradient-boosted model) |
| Storage | PostgreSQL 16 (19 tables), Redis 7 (rate limits, caches) |

The Android app **never** talks to Binance. It talks only to the authenticated backend; all exchange
requests (and every API secret) live server-side. The APK contains exactly one endpoint: the backend
base URL (`BuildConfig.API_BASE_URL`).

---

## 2. Feature map (18 screens)

| # | Screen | Kotlin | Notes |
|---|---|---|---|
| 1 | Splash | `ui/screens/SplashScreen.kt` | Validates the stored session while showing connection progress |
| 2 | Onboarding | `ui/screens/SplashScreen.kt` (`OnboardingScreen`) | 3 pages: analysis, paper trading, live-trading consent |
| 3 | Auth (login / register / reset) | `ui/screens/AuthScreen.kt` | No admin code, no hardcoded credentials |
| 4 | Dashboard | `DashboardScreen.kt` | Equity card, connection pill, market movers, latest signal, risk summary |
| 5 | Market watchlist | `WatchlistScreen.kt` | Favourites, search, 24h %, volume, A–Z sorting |
| 6 | Candlestick chart | `ChartScreen.kt` | 1m/5m/15m/1h/4h/1d, EMA overlay, volume, crosshair, depth, trades |
| 7 | AI signals | `SignalsScreen.kt` | Action, reasons, levels, indicators, regime, data quality, model status |
| 8 | Spot terminal | `TerminalScreen.kt` | Preview → risk checks → explicit confirmation → place |
| 9 | Orders & history | `OrdersScreen.kt` | Open/filled/rejected/UNKNOWN, cancel, reconcile, details |
| 10 | Portfolio | `PortfolioScreen.kt` | Paper vs live balances clearly separated, positions, fees |
| 11 | Analytics | `AnalyticsScreen.kt` | Equity curve, drawdown, win rate, profit factor, daily breakdown |
| 12 | Backtest / paper | `BacktestScreen.kt` | Fees + slippage parameters, assumptions and warnings |
| 13 | Risk settings | `RiskScreen.kt` | Limits, live opt-in (typed phrase + acknowledgement), emergency stop |
| 14 | Price alerts | `AlertsScreen.kt` | price_above/below, rsi_above/below, signal_buy/sell |
| 15 | AI assistant | `AssistantScreen.kt` | English / සිංහල, grounded in real data, refuses order placement |
| 16 | API connection | `ApiSettingsScreen.kt` | Key entry (never stored on device), verify, revoke |
| 17 | Security | `SecurityScreen.kt` | Sessions, revoke, password change, account deletion |
| 18 | Settings/help + Admin | `SettingsScreen.kt`, `AdminScreen.kt` | Notifications, help/FAQ; admin users, audit, pairs, kill switch |

Shared UI: `ui/components/Common.kt` (cards, pills, banners, empty/loading states),
`ui/components/Inputs.kt` (fields, segmented controls, mode toggle), `ui/components/Charts.kt`
(candles, equity line, depth bars), `ui/theme/Theme.kt` (near-black/navy + emerald palette).

Theme rules enforced in code: loading state on every async block, error banner with the backend's
error code and a retry, connection pill (LIVE / CONNECTING / OFFLINE / DEGRADED), market-data
freshness banner driven by `stale`/`age_seconds`, timestamps rendered in local time.

---

## 3. Backend surface

74 REST operations under `/api/v1` plus one WebSocket, 19 tables. Full reference: [`docs/API.md`](docs/API.md).

```
auth/*        register, login, refresh, logout, logout-all, me, password change/reset, sessions, account delete, fcm-token
market/*      tickers, ticker, klines, depth, trades, pairs, overview
signals/*     signal, latest, history, model, backtest, backtests/history
orders/*      preview, place, list, get, cancel, events, export.csv, reconcile
portfolio/*   summary, analytics, paper positions, paper reset, CSV exports
risk/*        policy get/put, status, exposure, live-opt-in, emergency-stop
alerts/*      list, create, delete, evaluate
assistant/*   ask, history, meta
credentials/* list, add, verify, revoke
notifications list, mark read
admin/*       users, user patch, health, stats, audit, settings, pairs, pairs sync, pair toggle, kill-switch
stream        WS /api/v1/stream/prices?symbols=…&token=…   (JSON snapshots every 2s)
```

Trading rules implemented server-side (not in the app):

* **Binance correctness** — `exchangeInfo` filters fetched and cached per symbol; tick size, step
  size, min/max quantity, min notional, `LIMIT_MAKER`/`MARKET_LOT_SIZE` permissions, and account
  permissions are validated; `newClientOrderId` is prefixed `rsai-`; signing uses
  HMAC-SHA256 over the exact query string with `recvWindow` and clock-sync against `/api/v3/time`.
* **No optimistic success** — a live order is only `FILLED` when Binance's own response/query says
  so; ambiguous responses (`-1007`, timeouts) are persisted as `UNKNOWN` and reconciled before the
  same symbol can trade again.
* **Idempotency** — unique `(user_id, idempotency_key)`; a retry returns the original order.
* **Duplicate guard** — an identical symbol/side/quantity attempt inside the guard window is rejected.
* **Risk engine** — max trade notional, max portfolio exposure %, daily loss limit, max risk per
  trade %, max open orders/positions, mandatory stop-loss, cooldowns after consecutive losses,
  high-volatility / low-liquidity warnings, stale-data and API-error blocks, and a kill switch.
  A failed check **rejects** the order (HTTP 422 with `risk_rejected` and the failing checks).
* **Live gating** — `LIVE_TRADING_ENABLED=false` by default; a live order additionally requires the
  per-account opt-in (`risk/live-opt-in` with the phrase `ENABLE LIVE TRADING` and a risk
  acknowledgement) **and** `approved=true` on the order itself (manual approval).

---

## 4. AI engine

`ai-engine/rs_ai_engine/`:

* `indicators.py` — EMA/SMA, RSI, MACD, ATR, Bollinger, ADX/DMI, OBV, VWAP, stochastic, support and
  resistance detection, momentum, realised volatility.
* `features.py` / `regime.py` — feature frame with strict causal alignment (no look-ahead), regime
  classification (trend / range / high-vol / low-liquidity).
* `calibration.py` / `signals.py` — deterministic scoring that produces **BUY / SELL / HOLD** with
  pair, timeframe, timestamp, reasons, indicator values, entry range, stop-loss, take-profit,
  R:R, invalidation conditions, model version and data-quality metadata.
* `backtest.py` — event-driven backtest with fees and slippage, evaluated on held-out history,
  returns metrics plus explicit assumptions and warnings.

**Confidence policy:** there are no invented confidence percentages. The optional ML model must pass
a validation gate (`MIN_AUC = 0.53`) before its probability is shown at all; otherwise
`model_status` reports it as untrusted/unavailable and the vote is withheld. Signals fall back to
HOLD when evidence is weak or the data is stale/insufficient.

Current artifact: `ai-engine/artifacts/BTCUSDT_1h.joblib` was trained **offline on synthetic data**
(`scripts/train_model.py --offline`) and scored **AUC 0.499 → `trusted: false`**. That is the honest
outcome of synthetic data and is reported to the app as such; the threshold was not lowered.

---

## 5. Quick start

### 5.1 Docker (backend + Postgres + Redis)

```bash
cp .env.example .env

# Required: generate real secrets and paste them into .env
python -c "import secrets; print(secrets.token_urlsafe(48))"                       # SECRET_KEY
python -c "import os,base64; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"  # APP_ENCRYPTION_KEY
# also set POSTGRES_PASSWORD

docker compose up --build
docker compose exec backend python -m app.cli create-admin --email you@example.com
curl http://localhost:8000/api/v1/health
```

Defaults are deliberately safe: `BINANCE_ENV=testnet`, `LIVE_TRADING_ENABLED=false`,
`AUTOMATION_ENABLED=false`, `REQUIRE_MANUAL_APPROVAL=true`, `MARKET_DATA_MODE=binance` with
`ALLOW_SYNTHETIC_FALLBACK=false`.

### 5.2 Local (no Docker)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt -r backend/requirements-dev.txt

export DATABASE_URL="postgresql+psycopg://rsai:secret@localhost:5432/rsai"
export SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')"
export APP_ENCRYPTION_KEY="$(python -c 'import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())')"

cd backend
alembic -c alembic.ini upgrade head          # or: python -m app.cli init-db
python -m app.cli create-admin --email you@example.com
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

OpenAPI docs are served at `http://localhost:8000/docs`.

### 5.3 Android

```bash
cd android-app
gradle wrapper --gradle-version 8.9 --distribution-type bin   # once: the wrapper JAR is not committed
./gradlew :app:assembleDebug -PrsaiBaseUrl=http://10.0.2.2:8000/   # emulator → host loopback
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

(Opening `android-app/` in Android Studio generates the wrapper and builds with the IDE run button.)

Full build/sign/install instructions, including release signing and physical-device networking:
[`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md).

### 5.4 Operator CLI

```bash
python -m app.cli init-db                    # create tables (dev/test)
python -m app.cli create-admin --email you@example.com   # prompts for a password
INITIAL_ADMIN_PASSWORD='…' python -m app.cli create-admin --email you@example.com  # CI/automation
python -m app.cli sync-pairs                 # refresh exchangeInfo symbol filters
python -m app.cli check-health               # DB + market provider + trading controls
python -m app.cli rotate-encryption-key      # prints the key-rotation procedure
```

There is **no default admin account, no default password and no authorisation code** anywhere in the
APK or the repository.

---

## 6. Tests — actually executed

```bash
cd backend   && python -m pytest tests            # 114 passed, 1 skipped (PostgreSQL test)
cd ai-engine && python -m pytest tests            # 21 passed

# with a throwaway PostgreSQL database the skipped test also runs:
cd backend && RSAI_TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost/rsai_test" \
    python -m pytest tests/test_postgres_integration.py   # 1 passed
```

| Suite | Tests | Covers |
|---|---|---|
| `backend/tests/test_auth_security.py` | 21 | Argon2id hashing, login lockout, token versioning/refresh rotation, RBAC, cross-user isolation, redaction |
| `backend/tests/test_market_and_signals.py` | 16 | Klines/depth/tickers, stale-data flags, signal endpoints, indicator determinism, no look-ahead |
| `backend/tests/test_orders_and_risk.py` | 30 | Order validation (tick/step/minNotional), duplicate + idempotency, every risk limit, stale-data block, partial fills, emergency stop |
| `backend/tests/test_binance_client.py` | 14 | HMAC signing, param ordering, error mapping (`-1013`, `-2010`, `-1021`), time sync, retries |
| `backend/tests/test_live_order_flow.py` | 8 | Live gating, manual approval, ambiguous response → `UNKNOWN`, reconciliation, persisted rejections |
| `backend/tests/test_portfolio_alerts_assistant_admin.py` | 25 | Portfolio maths, CSV export, alerts, assistant grounding/refusal, admin-only access |
| `ai-engine/tests/test_engine.py` | 21 | Indicators, regime, signal schema, cost-aware backtest, leakage checks, model gating |
| `backend/tests/test_postgres_integration.py` | 1 | Full flow against a **real PostgreSQL** server (JSON, timestamptz, numeric round-trip) |

**Verification status (honest):**

| Item | Status |
|---|---|
| Python test suites | ✅ executed — 114 backend + 21 AI engine pass (1 PostgreSQL test skipped without a URL) |
| PostgreSQL integration test | ✅ executed against PostgreSQL 16.2 — registration → ticker → preview → paper order → idempotent replay → portfolio → analytics → alerts → signal → risk → assistant |
| Alembic `upgrade head` on a real PostgreSQL 16.2 | ✅ executed — 19 tables, 15 FKs, 58 indexes, `alembic_version = 0001_initial` |
| `database/schema.sql` applied to a fresh database | ✅ executed — 19 tables, 57 indexes, 15 FKs |
| SQLite-backed API tests | ✅ executed (in-memory, real route stack) |
| Live Binance REST/WebSocket calls | ❌ not executed — the build environment cannot reach `api.binance.com`; every exchange test uses a mocked transport |
| Android compile / APK build / install | ❌ not executed — no JDK or Android SDK in the build environment; the Kotlin sources are unverified by a compiler |
| `docker compose up` | ❌ not executed — no Docker in the build environment (the database itself was verified with a real PostgreSQL 16.2 server) |
| Android unit tests (`FmtTest`) | ❌ written but not executed — no JDK |

Do not treat the Android build or the live-exchange path as proven until you run the commands in
`docs/ANDROID_BUILD.md` and `docs/TESTNET.md` on a machine with a JDK and network access.

---

## 7. Security posture (summary)

* Android: tokens only in `EncryptedSharedPreferences` (Android Keystore, AES-256-GCM); release
  builds disable cleartext HTTP and OkHttp logging; no exchange secrets in the APK; no WebView.
* Backend: Argon2id password hashing, short-lived access tokens (15 min) with `token_version`
  invalidation, rotating refresh tokens, per-route rate limits, strict per-user authorisation,
  audit logging with secret redaction, account deletion, session revocation.
* Exchange keys: encrypted at rest with AES-256-GCM (`APP_ENCRYPTION_KEY`); masked in every
  response (`masked_key`); never returned to the client; withdrawal permission is never requested.

Details and the threat model: [`docs/SECURITY.md`](docs/SECURITY.md),
key rotation: [`docs/KEY_ROTATION.md`](docs/KEY_ROTATION.md).

---

## 8. Documentation index

| Document | Contents |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Components, data flow, database schema, request lifecycle |
| [`docs/API.md`](docs/API.md) | Every endpoint, auth requirements, sample payloads, error envelope |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Threat model, credential handling, RBAC, redaction, hardening checklist |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker and bare-metal deployment, env vars, migrations, backups, monitoring |
| [`docs/TESTNET.md`](docs/TESTNET.md) | Binance testnet workflow, key creation, verification, promotion to live |
| [`docs/ANDROID_BUILD.md`](docs/ANDROID_BUILD.md) | Android Studio / CLI build, debug + release signing, APK installation |
| [`docs/KEY_ROTATION.md`](docs/KEY_ROTATION.md) | Rotating `SECRET_KEY`, `APP_ENCRYPTION_KEY` and Binance keys |
| [`docs/LIVE_TRADING_SAFETY.md`](docs/LIVE_TRADING_SAFETY.md) | Go-live checklist, kill-switch drills, incident response |
| [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md) | Unverified paths, demo-data caveats, roadmap gaps |

---

## 9. Known limitations (short list)

* **Market data can be simulated.** If `MARKET_DATA_MODE=synthetic` (or the fallback is enabled and
  Binance is unreachable), the UI labels it `synthetic`/`DEMO DATA` and the risk engine refuses live
  orders while data is synthetic.
* **The ML model is not trusted.** The bundled artifact scored AUC 0.499 on synthetic data; the
  engine withholds its probability and relies on deterministic indicators.
* **The assistant is rule-based** (`ASSISTANT_LLM_ENABLED=false` by default). It answers from
  computed facts, refuses to place orders, and flags missing/stale data rather than inventing
  balances.
* **Android is not compile-verified in this environment** (no JDK/SDK). Treat the first local build
  as the real compile check.
* **No futures, margin, leverage or borrowing**, by design and by validation.

Full list: [`docs/KNOWN_LIMITATIONS.md`](docs/KNOWN_LIMITATIONS.md).

---

## 10. Live-trading safety checklist (condensed)

1. Complete `docs/TESTNET.md` end-to-end; keep `LIVE_TRADING_ENABLED=false` until it passes.
2. Create a **dedicated** Binance key: spot trading on, **withdrawals disabled**, IP allow-listed,
   futures/leverage permissions off.
3. Verify paper trading results over a meaningful sample; backtest on unseen periods with fees and
   slippage.
4. Set conservative risk limits (max trade size, exposure, daily loss, RPS, cooldowns) and enable
   mandatory stop-loss.
5. Confirm `REQUIRE_MANUAL_APPROVAL=true` and that the app shows the typed-phrase opt-in dialog.
6. Drill the emergency stop and the kill switch; confirm order cancellation and the audit entries.
7. Monitor notifications (order events, risk rejections, API disconnects, stale data, suspicious
   logins) before scaling size.

Full checklist: [`docs/LIVE_TRADING_SAFETY.md`](docs/LIVE_TRADING_SAFETY.md).
