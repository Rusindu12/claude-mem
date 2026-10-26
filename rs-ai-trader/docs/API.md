# RS AI TRADER — HTTP API

Base URL: `http://<host>:8000/api/v1` (production: HTTPS only).
Interactive reference: `GET /docs` (Swagger UI) or `GET /openapi.json`.

74 REST operations + 1 WebSocket. All endpoints except `health`, `config`, `auth/register`,
`auth/login`, `auth/refresh`, `auth/password/reset/*` require a bearer access token.

```
Authorization: Bearer <access_token>
```

## Error contract

Every failure returns the same envelope (implemented in `backend/app/core/errors.py`):

```json
{
  "error": {
    "code": "risk_rejected",
    "message": "Daily loss limit reached.",
    "details": { "checks": [ ... ] }
  }
}
```

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` / `validation_error` | Malformed or rejected input |
| 401 | `unauthorized` | Missing/expired/revoked token, bad credentials, locked account |
| 403 | `forbidden` | Authenticated but not allowed (e.g. admin-only, live trading disabled for the account) |
| 404 | `not_found` | No such order/alert/credential/market |
| 409 | `conflict` | Duplicate order, duplicate email, idempotency clash |
| 422 | `risk_rejected` | A server-side risk check failed — **the order was not sent** |
| 429 | `rate_limited` | Per-route rate limit exceeded (see `Retry-After`) |
| 502 | `upstream_error` | Binance rejected or failed the request (`details.exchange_code`) |
| 503 | `stale_market_data` / `service_unavailable` | Data too old, or a dependency is down |

The Android client renders `message` directly and exposes `code` under the banner, so users always
see why an action failed rather than a generic failure.

---

## Auth

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{email, password, display_name, language}` | Password policy enforced; Argon2id |
| POST | `/auth/login` | `{email, password}` | Lockout after `MAX_LOGIN_ATTEMPTS`; returns `TokenPair` |
| POST | `/auth/refresh` | `{refresh_token}` | Rotating refresh token (old token is revoked) |
| POST | `/auth/logout` | `{refresh_token?}` | 204 |
| POST | `/auth/logout-all` | – | Bumps `token_version`, revokes every session |
| GET | `/auth/me` | – | Current user |
| PATCH | `/auth/me` | query `display_name`, `language` | Profile / assistant language |
| POST | `/auth/password/change` | `{current_password, new_password}` | Revokes all sessions |
| POST | `/auth/password/reset/request` | `{email}` | Always 200 (no account enumeration) |
| POST | `/auth/password/reset/confirm` | `{token, new_password}` | Single-use token |
| GET | `/auth/sessions` | – | Session list with IP/device/last-used |
| DELETE | `/auth/sessions/{session_id}` | – | Revoke one session |
| DELETE | `/auth/account` | `{password, confirmation:"DELETE"}` | Deletes data + API keys, revokes sessions |
| POST | `/auth/fcm-token` | `{token}` | Push registration (204) |

`TokenPair`:

```json
{
  "access_token": "…", "refresh_token": "…", "token_type": "Bearer",
  "expires_in": 900, "refresh_expires_in": 1209600,
  "user": {"id": "…", "email": "…", "display_name": "…", "role": "user", "status": "active", "language": "en"}
}
```

## Market data

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/market/tickers` | `symbols` (CSV) | 24h stats for the configured symbol list |
| GET | `/market/ticker/{symbol}` | – | Single ticker |
| GET | `/market/klines/{symbol}` | `interval` ∈ 1m,5m,15m,1h,4h,1d; `limit` ≤ 1000 | Includes `stale`, `age_seconds`, `last_candle_close`, `source`, `synthetic` |
| GET | `/market/depth/{symbol}` | `limit` | Bids/asks, best bid/ask, spread bps, imbalance |
| GET | `/market/trades/{symbol}` | `limit` | Recent trades |
| GET | `/market/pairs` | – | Enabled symbols with exchangeInfo filters (tick/step/minNotional) |
| GET | `/market/overview` | – | Tickers + connection state + freshness (dashboard header) |

Every market payload carries provenance: `source`, `synthetic`, `stale`, `fetched_at`, `age_seconds`.
The UI must show the banner when `synthetic` or `stale` is true; the risk engine blocks live orders
while data is synthetic or stale.

## Signals and backtests

| Method | Path | Query / body | Notes |
|---|---|---|---|
| GET | `/signals/{symbol}` | `timeframe` | Deterministic signal for the latest closed candles |
| GET | `/signals/{symbol}/latest` | `timeframe` | Cached latest signal |
| GET | `/signals/{symbol}/history` | `timeframe`, `limit` | Stored signals |
| GET | `/signals/{symbol}/model` | `timeframe` | Model availability/evaluation; `available:false` when untrusted |
| POST | `/signals/backtest` | `{symbol, timeframe, days, initial_capital, fee_bps?, slippage_bps?}` | Costs included; returns `metrics`, `assumptions`, `warnings` |
| GET | `/signals/backtests/history` | `limit` | Stored backtests for the user |

`Signal` (abridged):

```json
{
  "symbol": "BTCUSDT", "timeframe": "1h", "action": "HOLD",
  "generated_at": "2026-01-01T12:00:00+00:00", "price": 64000.0,
  "reasons": ["Trend below EMA200", "RSI 47 — neutral"],
  "indicators": {"rsi_14": 47.1, "macd_hist": -12.4, "atr_pct": 1.8},
  "entry_low": null, "entry_high": null, "stop_loss": null, "take_profit": null, "risk_reward": null,
  "invalidation": ["Close above 66,000 invalidates the short bias"],
  "model_version": "btc-1h-20260101", "model_status": "untrusted",
  "probability_up": null, "probability_down": null,
  "score": 0.12, "evidence_grade": "weak",
  "data_quality": {"bars": 240, "expected_bars": 240, "stale": false, "gaps": 0, "sufficient": true, "issues": []},
  "regime": {"label": "range", "volatility_state": "normal", "reasons": ["ADX 14"]},
  "data_source": "binance", "synthetic": false
}
```

`probability_up/down` are `null` unless a **validated** model artifact is present. There is no
`confidence` field by design.

## Orders

| Method | Path | Query / body | Notes |
|---|---|---|---|
| POST | `/orders/preview` | `{symbol, side, order_type, quantity, price?, stop_loss?, take_profit?, mode}` | Validation + normalisation + all risk checks; never sends an order |
| POST | `/orders` | same + `{idempotency_key (≥8 chars), approved}` | 201; live requires opt-in **and** `approved=true` |
| GET | `/orders` | `mode`, `open_only`, `limit` | Paper or live list |
| GET | `/orders/{order_id}` | `mode` | Single order |
| POST | `/orders/{order_id}/cancel` | `mode` | Cancels; live cancel is confirmed with Binance |
| GET | `/orders/events` | `order_id?`, `limit` | Order event log |
| POST | `/orders/reconcile` | – | Resolves `UNKNOWN` live orders against Binance |
| GET | `/orders/export.csv` | `mode` | CSV download |

Preview response (abridged):

```json
{
  "symbol": "BTCUSDT", "mode": "paper", "side": "BUY", "order_type": "LIMIT",
  "quantity": "0.0010", "reference_price": "64000.00", "estimated_notional": "64.00",
  "estimated_fee_usdt": "0.064", "estimated_slippage_bps": 5.0,
  "adjustments": ["quantity snapped to step size 0.00001"],
  "risk": {"approved": true, "violations": [], "warnings": ["Volatility is elevated"],
           "checks": [{"name": "max_trade_notional", "passed": true, "severity": "block", "detail": "64 ≤ 100"}]},
  "can_place": true,
  "market": {"source": "binance", "synthetic": false, "stale": false, "age_seconds": 1.2, "spread_bps": 0.4}
}
```

Order statuses: `NEW`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED`,
`PENDING`, `UNKNOWN`. `UNKNOWN` means the exchange state could not be confirmed — reconcile before
trusting it.

## Portfolio

| Method | Path | Query | Notes |
|---|---|---|---|
| GET | `/portfolio` | `mode` | `simulated:true` for paper; live = real balances (`can_trade`, `environment`) |
| GET | `/portfolio/analytics` | `mode`, `days` (1–365) | Summary + daily curve + cost assumptions |
| POST | `/portfolio/paper/reset` | `starting_equity` | Deletes paper positions/orders only |
| GET | `/portfolio/paper/positions` | `include_closed` | Paper positions |
| GET | `/portfolio/export/trades.csv` | – | CSV |
| GET | `/portfolio/export/orders.csv` | `mode` | CSV |

Paper and live figures are never merged; the API states which one is simulated.

## Risk

| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/risk/policy` | – | Current limits |
| PUT | `/risk/policy` | any subset of limits | Validated ranges; cannot enable automation without live opt-in |
| GET | `/risk/status` | – | Policy + trading control + server flags + usage + market health + `can_trade_live` |
| GET | `/risk/exposure` | – | Exposure vs ceiling, remaining capacity |
| POST | `/risk/live-opt-in` | `{opt_in, confirmation:"ENABLE LIVE TRADING", acknowledge_risk}` | Enabling requires the exact phrase + acknowledgement |
| POST | `/risk/emergency-stop` | – | Disables live trading, clears automation, cancels open paper+live orders |

## Alerts, assistant, credentials, notifications

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/alerts` | Create: `{symbol, condition, target_price?, note?}`; conditions `price_above`, `price_below`, `rsi_above`, `rsi_below`, `signal_buy`, `signal_sell` |
| DELETE | `/alerts/{alert_id}` | 204 |
| POST | `/alerts/evaluate` | Force evaluation against current data |
| POST | `/assistant/ask` | `{question, lang: "en"\|"si", symbol?, timeframe?, include_portfolio}` |
| GET | `/assistant/history` | Previous answers (with `data_as_of`) |
| GET | `/assistant/meta` | Capabilities and limitations |
| GET/POST | `/credentials` | List (masked) / add `{api_key, api_secret, label, environment?}` |
| POST | `/credentials/{id}/verify` | Read-only permission check against Binance |
| DELETE | `/credentials/{id}` | 204; erases the encrypted secret |
| GET | `/notifications` | `unread_only`, `limit` |
| POST | `/notifications/read` | `{notification_id?}` (all when omitted) |

The assistant returns `refused: true` when asked to place/cancel orders; it never returns fabricated
balances and lists `limitations` when data is missing or stale.

## Admin (role `admin` only)

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users` | `search`, `limit`, `offset`; includes `has_exchange_key` (never the key) |
| PATCH | `/admin/users/{user_id}` | `{status?, role?}`; cannot remove your own admin role |
| GET | `/admin/health` | DB state, market provider, counts, trading control, config |
| GET | `/admin/stats` | Aggregate counts |
| GET | `/admin/users/{user_id}/risk-summary` | Risk usage for one user |
| GET | `/admin/audit` | `action`, `user_id`, `limit`, `offset` — secrets redacted |
| GET/PUT | `/admin/settings` | Runtime settings (maintenance mode, min app version, assistant toggle…) |
| GET/POST | `/admin/pairs`, `/admin/pairs/sync` | Symbol list / refresh from `exchangeInfo` |
| PATCH | `/admin/pairs/{symbol}` | `{enabled}` |
| POST | `/admin/kill-switch` | `{engage, reason}` — blocks live trading for everyone |

## WebSocket

```
ws(s)://<host>/api/v1/stream/prices?symbols=BTCUSDT,ETHUSDT&token=<access_token>
```

Frames every 2 seconds:

```json
{"status":"streaming","tickers":[{"symbol":"BTCUSDT","price":64000.0,"stale":false,"age_seconds":1.1}],
 "source":"binance","synthetic":false,"stale_after_seconds":180,"server_time":"…"}
```

Statuses: `connected`, `streaming`, `degraded`, `error`, `unauthenticated` (close code 4401).
Maximum 8 symbols per connection. The Android client reconnects with exponential backoff
(1s → 30s, 8 attempts) and stops on 4401 so a revoked session cannot loop.

## Operational endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Liveness (no auth) |
| GET | `/ready` | Readiness incl. DB |
| GET | `/api/v1/health` | Versioned health used by the container healthcheck |
| GET | `/api/v1/config` | Public app config: environment, symbol/timeframe lists, live flags, market health, disclaimer, server time |
