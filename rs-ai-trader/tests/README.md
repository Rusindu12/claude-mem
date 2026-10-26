# Tests

The suites live next to the code they exercise; this directory holds the runner and the results.

```
backend/tests/        115 API/security/trading tests (1 requires a PostgreSQL URL)
ai-engine/tests/       21 indicator/signal/backtest tests
android-app/app/src/test/   formatting unit tests (not executed in this environment)
tests/run_all.sh       runs everything that can run headless
```

## Run

```bash
./tests/run_all.sh

# or individually
cd backend   && python -m pytest tests -q
cd ai-engine && python -m pytest tests -q
```

PostgreSQL integration (optional, skipped without the variable):

```bash
createdb rsai_test
cd backend
RSAI_TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost/rsai_test" \
    python -m pytest tests/test_postgres_integration.py -v
```

Android unit tests (needs a JDK + Android SDK):

```bash
cd android-app && ./gradlew :app:testDebugUnitTest
```

## Last measured results

| Suite | Result | Notes |
|---|---|---|
| `backend/tests` (SQLite) | **114 passed, 1 skipped** in ~33 s | the skipped test is the PostgreSQL one |
| `backend/tests/test_postgres_integration.py` (real PostgreSQL 16.2) | **1 passed** | registration → ticker → order preview → paper order → idempotent replay → portfolio → analytics → alerts → signal → risk → assistant |
| `ai-engine/tests` | **21 passed** in ~7 s | |
| `android-app` unit tests | **not executed** | no JDK/SDK in the build environment |

## What the suites cover

| Area | Where |
|---|---|
| Argon2id hashing, login lockout, refresh rotation, `token_version` revocation | `test_auth_security.py` |
| RBAC (admin-only endpoints), cross-user isolation, credential redaction | `test_auth_security.py`, `test_portfolio_alerts_assistant_admin.py` |
| HMAC signing, query ordering, `-1021` clock skew, `-1013`/`-2010` mapping, retries | `test_binance_client.py` |
| Order validation: tick size, step size, min notional, side/type-aware SL/TP | `test_orders_and_risk.py` |
| Duplicate guard, idempotency replay, risk limits, stale-data block, cooldowns | `test_orders_and_risk.py` |
| Partial fills, failed fills, emergency stop | `test_orders_and_risk.py` |
| Live gating, manual approval, ambiguous response → `UNKNOWN`, reconciliation | `test_live_order_flow.py` |
| Market endpoints, freshness flags, deterministic synthetic data, signal schema | `test_market_and_signals.py` |
| Portfolio maths, CSV export, alerts, assistant grounding + order refusal | `test_portfolio_alerts_assistant_admin.py` |
| Indicators, regime detection, cost-aware backtest, leakage guards, model gate | `ai-engine/tests/test_engine.py` |
| Real PostgreSQL JSON/timestamptz/numeric round-trip | `test_postgres_integration.py` |

Automated tests **never** place a live order and never call Binance: the exchange client is replaced
by mocks/fakes. Keep it that way.
