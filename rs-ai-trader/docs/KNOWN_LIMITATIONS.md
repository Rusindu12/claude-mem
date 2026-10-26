# Known limitations

Written honestly, including everything that could not be verified while the project was built.

## Verification gaps (most important)

| Item | Status | What you must do |
|---|---|---|
| Android build / APK | **Not compiled.** The build environment had no JDK, Android SDK or Gradle, and the Gradle wrapper JAR is not committed (`gradle wrapper --gradle-version 8.9` generates it). | Run `gradle wrapper` once, then `./gradlew :app:assembleDebug` and fix any compiler findings. Expect small issues (unused imports, a type mismatch) on the first run. |
| Android unit tests (`FmtTest`) | Written, never executed. | `./gradlew :app:testDebugUnitTest`. |
| Live Binance REST/WebSocket | **Not executed.** `api.binance.com` was unreachable from the build sandbox (TLS blocked). All exchange tests use mocked transports. | Follow `docs/TESTNET.md` end-to-end before any real order. |
| PostgreSQL | **Verified on PostgreSQL 16.2**: `alembic upgrade head` created 19 tables / 15 FKs / 58 indexes and the full API flow test passed; `database/schema.sql` also applied cleanly to a fresh database. Production tuning (pool sizing, backups) is still yours to validate. | Inspect your own staging database after migrating. |
| Docker Compose | **Not run** (no Docker in the build environment). | `docker compose up --build`, then `check-health`. |
| Push notifications (FCM) | Not exercised. The backend stores an FCM token and notification rows; sending needs `FCM_CREDENTIALS_PATH` + a Firebase project. | Configure Firebase if you want pushes; in-app notifications work without it. |
| Test push delivery / APK install on a device | Not possible here. | Verify on a real device. |

## Functional limitations

* **Market data can be simulated.** With `MARKET_DATA_MODE=synthetic` (or the fallback enabled and
  Binance unreachable) prices are generated deterministically per bar index, labelled `synthetic`,
  and live trading is blocked by the risk engine. The synthetic series is a demo aid, not history.
* **The ML model is untrusted.** The bundled `BTCUSDT_1h.joblib` was trained offline on synthetic
  data and scored AUC 0.499 → `trusted: false`; the engine withholds its probability and the signal
  rests on deterministic indicators. Training on real Binance klines is a separate, deliberate step
  (`ai-engine/scripts/train_model.py` without `--offline`), and the AUC gate (0.53) must not be
  lowered to force it through.
* **The assistant is rule-based.** `ASSISTANT_LLM_ENABLED=false` by default: intent matching +
  computed facts, Sinhala/English templates, explicit refusals and limitation notes. Enabling an LLM
  is possible via env vars but is not required and does not remove the grounding rules.
* **Candle chart is custom Canvas.** No zoom/pan gestures or drawing tools; tap/drag shows OHLC for a
  candle. Indicators are drawn as an EMA line only — the numeric values live on the signals screen.
* **One WebSocket subscription at a time** (max 8 symbols): the foreground screen decides what is
  streamed. Background streaming stops when the app is backgrounded.
* **Live P&L is intentionally partial.** `/portfolio?mode=live` reports real balances and exposure but
  leaves `realized_pnl`/`unrealized_pnl` null, because the account may contain trades made outside the
  app; pretending otherwise would be misleading.
* **Analytics for live mode** are limited to the orders this app placed (fees/volume), not the whole
  exchange account.
* **Position model is spot-style.** Buys create positions; sells reduce/close them. There is no
  shorting, leverage or margin accounting, and no automatic TP/SL order placement on Binance beyond
  the stop/take-profit levels attached to the order intent (the paper broker triggers them; live
  behaviour is a normal exchange order, subject to slippage).
* **CSV export** is server-generated and downloaded by the API; the app does not save files to shared
  storage (no storage permission requested).
* **No biometric app lock.** Session security relies on the backend tokens + device keystore.
* **Single broker.** Binance Spot only; no other exchanges.
* **Timezone**: all timestamps are stored UTC and rendered in the device timezone.

## Operational limits

* Rate limits are per process unless Redis is configured (`UVICORN_WORKERS > 1` requires Redis).
* The in-process market cache is per worker; with multiple workers, cache warm-up is per worker.
* Background jobs (alert evaluation, listen-key keep-alive, reconciliation sweeps) run inside the
  backend process; a crashed process pauses them until restart.
* There is no built-in metrics/APM exporter — use logs, `/admin/health` and your own monitoring.

## Deliberate non-features

* No futures, margin, leverage, borrowing, options or earn products.
* No withdrawal endpoints, no address-book access, no sub-account management.
* No referral, copy-trading or social features.
* No admin "master password" or client-side role checks — roles are server-side only.

## If something looks wrong

1. Check `/api/v1/health`, `/api/v1/config` and `/api/v1/risk/status`.
2. Look at `/admin/audit` for auth, credential and order actions.
3. Check notifications for `stale data`, `api_disconnect` and `risk` events.
4. Engage the emergency stop before debugging anything else.
