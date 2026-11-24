# Polymarket 5-Minute BTC Up/Down Trading Bot & Dashboard

Real-time paper-first trading bot and monitoring dashboard for Polymarket's rolling 5-minute BTC "Up/Down" markets.

## Architecture

- **Python Monte Carlo Engine (`engine/`)**: FastAPI + NumPy/SciPy service running 20,000-path Student-t fat-tailed simulations over the remaining window time, computing realized volatility, shrunk drift, landing curve distribution, orb trajectory samples, and a 5-factor Signal Stack (`momentum`, `orderbook_imbalance`, `spot_polymarket_lag`, `volatility_regime`, `time_left`) with logged probability contributions.
- **Node.js Backend (`backend/`)**: Express + Socket.io orchestrator with:
  - **Exchange Adapter Layer** (`src/adapters/exchangeAdapter.js`): `PolymarketAdapter` (Gamma API market discovery + CLOB API order book & limit orders) and `BinanceAdapter` placeholder for future expansion.
  - **Execution Engine** (`src/execution/orderStateMachine.js`): Strict order state machine (`CREATED -> SUBMITTED -> OPEN -> PARTIAL_FILL -> FILLED / CANCELLED / REJECTED / EXPIRED`), idempotent `clientOrderId` deduplication, token-bucket rate limiter, exponential-backoff retries, fill reconciliation, and restart state recovery.
  - **Risk Controls** (`src/risk/riskManager.js`): Binary fractional Kelly sizing, per-trade cap, per-window cap, daily loss limit, max open exposure, consecutive-loss cooldown, kill switch (UI + API), and non-negotiable live-trading safety gate.
  - **Security** (`src/security/`): AES-256-GCM encryption at rest for wallet/API keys (write-only from API, never logged or returned to browser), JWT + TOTP 2FA authentication.
  - **Analytics & Replay** (`src/services/analytics.js`): Per-window P&L, win rate, average edge, ROI, Brier score, calibration buckets, and `/api/replay?edgeThreshold=...` over stored snapshots.
- **Next.js + Tailwind Dashboard (`frontend/`)**: Light theme default with dark toggle, UP = teal/blue, DOWN = red/orange, monospace tabular numbers, animated Monte Carlo "orb" canvas that collapses at window close, BTC candlestick chart with strike line, signal stack bars, decision log, model-vs-market chart, landing curve, kill switch, and 2FA/Live-gate modal.
- **Database (`db/init.sql`)**: PostgreSQL schema for `windows`, `orders`, `trades`, `decisions`, `ticks`, `market_snapshots`, `settings`, `encrypted_secrets`, and `users`.
- **Docker Compose (`docker-compose.yml`)**: Runs PostgreSQL, Redis, Python engine, Node backend, and Next.js frontend.
- **Android WebView APK (`android-webview/`)**: Kotlin WebView wrapper targeting the hosted dashboard URL.

## Non-Negotiable Safety Gates

1. `DRY_RUN=true` by default.
2. Live orders require **all three**:
   - `DRY_RUN=false` and `LIVE_TRADING=true` in server environment
   - Authenticated JWT + valid TOTP 2FA code
   - Explicit UI confirmation typing `I UNDERSTAND LIVE TRADING RISK`
3. Use a dedicated trading wallet holding only funds you can afford to lose. For Binance, use API keys with **withdrawals disabled**.
4. **Before any live use**: run paper mode unattended for at least 24 hours, accumulate several hundred settled paper windows, and review the Brier score and calibration buckets.

## Assumptions

- When `ENABLE_LIVE_MARKET_FETCH=false` (default for offline/sandboxed environments), the bot uses a deterministic 5-minute UTC-aligned window clock, a realistic GBM+jump BTC spot simulator, and a lagging synthetic CLOB order book so every component of the pipeline (Monte Carlo, signal stack, risk limits, order state machine, settlement, analytics, and dashboard) runs end-to-end without external network dependencies.
- Set `ENABLE_LIVE_MARKET_FETCH=true` on a host with outbound internet to connect directly to Binance WebSocket (`wss://stream.binance.com:9443/ws/btcusdt@trade`) and Polymarket Gamma/CLOB APIs.
- Default paper-mode dashboard login is `trader` / `paper-mode-2026` with dev 2FA code `000000` (disabled automatically when `DRY_RUN=false`).

## Running Locally

### Docker Compose
```bash
cp .env.example .env
docker compose up --build
```
Open `http://localhost:3000`.

### Running Tests
```bash
# Python Monte Carlo & Signal Stack tests
engine/.venv/bin/pytest -v engine/test_model.py

# Backend Risk Controls, Order State Machine & AES-256 Security tests
cd backend && npm test
```

### Building the Android APK
1. Update `DASHBOARD_URL` in `android-webview/app/build.gradle` to your deployed dashboard HTTPS URL.
2. Open `android-webview/` in Android Studio or run `./gradlew assembleRelease` with Android SDK 34 installed.
