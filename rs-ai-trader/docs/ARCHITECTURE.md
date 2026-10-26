# Architecture

```
┌────────────────────────┐        HTTPS + WSS        ┌────────────────────────────┐
│  Android app (Kotlin)  │ ────────────────────────► │  FastAPI backend           │
│  Compose · MVVM        │ ◄──────────────────────── │  auth · market · orders    │
│  Retrofit · OkHttp     │   JSON (uniform errors)   │  risk · portfolio · admin  │
│  EncryptedSharedPrefs  │                           └──────┬───────────┬─────────┘
└────────────────────────┘                                  │           │
                                                   SQL      │           │  HTTPS (signed)
                                                            ▼           ▼
                                                   ┌──────────────┐  ┌──────────────┐
                                                   │ PostgreSQL16 │  │ Binance Spot │
                                                   │ 19 tables    │  │ REST + WS    │
                                                   └──────────────┘  └──────────────┘
                                                            │
                                                   ┌────────▼─────────┐
                                                   │ Redis 7          │
                                                   │ rate limits/cache│
                                                   └──────────────────┘

                                   ┌──────────────────────────────┐
                                   │ AI engine (in-process Python)│
                                   │ indicators · regime · signals│
                                   │ backtest · assistant         │
                                   └──────────────────────────────┘
```

## Request lifecycle (placing an order)

1. **App** builds `POST /orders/preview` with symbol, side, type, quantity, price, SL/TP and mode.
2. **Backend** loads exchangeInfo filters (cached), normalises quantity/price to tick/step, checks
   min/max quantity, min notional, permissions and market status. It then fetches the ticker, depth
   and ATR for market context and runs the risk engine.
3. **Preview** returns `can_place`, normalisation `adjustments`, market context and every risk check
   (name, passed, severity, detail). Nothing is sent to Binance.
4. **App** shows the preview; the user must open the confirmation dialog (extra "real funds"
   checkbox in live mode) and confirm.
5. **Backend** `POST /orders` re-runs the whole pipeline (never trusts the preview), inserts the order
   row keyed by `(user_id, idempotency_key)`, gates live mode on `LIVE_TRADING_ENABLED` + account
   opt-in + `approved`, and only then calls Binance.
6. **Binance** response/`query_order` determines the stored status. Ambiguity → `UNKNOWN` +
   reconciliation required. Rejection → `REJECTED` with `exchange_code`.
7. **Events** (order created/filled/cancelled, risk rejection) are written to the order event log,
   notifications and audit trail; the app refreshes the Orders screen.

## Backend layout

```
backend/app/
├── main.py                 create_app(): routers, middleware, exception handlers, lifespan
├── deps.py                 auth dependency, rate limits, service factories
├── api/routes/             auth, market, signals, orders, portfolio, risk, alerts,
│                           assistant, credentials, notifications(system), admin, stream(ws)
├── core/
│   ├── config.py           pydantic-settings; every env var
│   ├── security.py         Argon2id, JWT encode/decode, SecretBox (AES-GCM), mask_key, redact
│   ├── errors.py           AppError hierarchy → uniform error envelope
│   ├── logging.py          structured logging + redaction
│   └── ratelimit.py        slowapi limits (Redis or in-memory)
├── db/
│   ├── base.py             engine, session, UTCDateTime, StaticPool for tests
│   └── models.py           19 tables
└── services/
    ├── binance_client.py   signing, retries, clock sync, exchangeInfo parsing
    ├── market.py           provider abstraction + caching + freshness/degradation
    ├── risk.py             policy, limits, kill switch, cooldown, daily loss
    ├── orders.py           order lifecycle, idempotency, duplicate guard, reconciliation
    ├── paper.py            simulated broker (fees, slippage, positions)
    ├── portfolio.py        balances, analytics, CSV export
    ├── credentials.py      encrypted key storage + permission probe
    ├── ai.py               bridge to the AI engine
    ├── assistant.py        intent routing over computed facts
    ├── alerts.py           price/RSI/signal alerts
    ├── notifications.py    in-app notifications (+ optional FCM)
    ├── audit.py            audit log with redaction
    └── background.py       periodic jobs (alerts, reconciliation, keep-alive)
```

## AI engine layout

```
ai-engine/rs_ai_engine/
├── indicators.py   EMA/SMA, RSI, MACD, ATR, Bollinger, ADX, OBV, VWAP, stochastic, S/R
├── features.py     causal feature frame (shifted, no look-ahead)
├── regime.py       trend/range × volatility state, liquidity check
├── calibration.py  probability calibration + validation gate (MIN_AUC)
├── signals.py      BUY/SELL/HOLD decision, levels, invalidation, evidence grade
├── backtest.py     event-driven backtest with fees/slippage, unseen-period evaluation
└── assistant.py    bilingual (en/si) explanation templates, refuses order placement
```

## Data model (19 tables)

| Table | Purpose |
|---|---|
| `users` | Identity, role, status, `token_version`, lockout counters, language, FCM token |
| `sessions` | Refresh-token sessions (device, IP, expiry, revocation) |
| `audit_events` | Security/action trail with redacted detail |
| `signals` | Generated signals per user/symbol/timeframe |
| `backtest_runs` | Backtest inputs/results |
| `paper_accounts` | Simulated quote balance, realised P&L, fees |
| `paper_positions` | Open/closed simulated positions with SL/TP |
| `paper_orders` | Simulated orders + status + fills + idempotency key |
| `exchange_orders` | Live orders mirroring Binance + `exchange_code` + reconciliation state |
| `order_events` | Lifecycle events for both modes |
| `api_credentials` | Encrypted Binance key/secret, masked key, environment, status |
| `risk_policies` | Per-user limits, live/automation opt-in, consent timestamps, cooldown |
| `trading_controls` | Global kill switch + stale/API-error blocks |
| `app_settings` | Runtime settings (maintenance mode, min version…) |
| `trading_pairs` | Enabled symbols + cached exchangeInfo filters |
| `alerts` | Price/RSI/signal alerts and their status |
| `notifications` | In-app notifications (never contain secrets) |
| `assistant_messages` | Assistant Q&A history with `data_as_of` |
| `assistant_meta`/`market_cache` | Auxiliary/internal state |

(Exact DDL: `database/schema.sql`, migrations: `database/migrations/versions/0001_initial.py`.)

## Android architecture

```
android-app/app/src/main/java/com/rsaitrader/
├── MainActivity.kt            Compose entry, edge-to-edge, pauses the socket on stop
├── RsAiTraderApp.kt           Application → ServiceLocator.init
├── core/
│   ├── ApiResult.kt           Success/Failure + friendly network messages
│   ├── format/Fmt.kt          money/percent/time formatting (no locale surprises)
│   ├── network/ApiService.kt  Retrofit contract (74 operations)
│   ├── network/ApiClient.kt   OkHttp interceptors: auth + single silent refresh
│   ├── network/Dtos.kt        kotlinx.serialization wire models
│   ├── network/TokenStore.kt  EncryptedSharedPreferences (Keystore-backed)
│   └── realtime/              PriceStream (backoff/4401) + MarketFeed (single socket)
├── data/                      Repositories (one per API area) + FavoritesStore
├── di/ServiceLocator.kt       Manual DI: one shared client, repos and feed
└── ui/
    ├── theme/                 Palette + typography (near-black/navy, emerald)
    ├── components/            Cards, pills, banners, inputs, Canvas charts
    ├── state/UiState.kt       Loadable<T> (loading / error / empty / data)
    ├── viewmodel/             One ViewModel per screen area, StateFlow only
    ├── screens/               18 screens
    └── NavGraph.kt            Root (onboarding → auth → shell) + NavHost + bottom bar
```

State rules: ViewModels expose immutable `StateFlow`, screens only read state and call intents.
No business rule (risk, sizing, permissions, live gating) is implemented client-side — the app
renders whatever the backend decides, including rejections.

## Failure behaviour by design

| Failure | Behaviour |
|---|---|
| Backend unreachable | Error banner with retry; cached data stays visible and labelled |
| WebSocket drops | Backoff 1s→30s (8 attempts), pill shows CONNECTING/OFFLINE |
| Session revoked | 401 → one refresh attempt → signed out |
| Market data stale/synthetic | Warning banner everywhere prices appear; live orders blocked server-side |
| Risk check fails | Order rejected with the failing checks; nothing sent |
| Binance ambiguous | Order recorded `UNKNOWN`; reconciliation required before re-trading the symbol |
| Kill switch engaged | Live orders blocked for all accounts; UI shows it on dashboard and risk screen |
