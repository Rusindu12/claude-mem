# On-device mode (no server) and the admin unlock code

The APK can run the whole app **inside the phone** — no backend, no Docker, no
Binance key, no network. This is what a fresh install does, because it lets you
install the APK and actually use every screen immediately. It is a **simulation**,
and the app says so everywhere.

## What runs on the device

| Layer | On-device implementation | Honest label |
|---|---|---|
| Accounts | Local accounts with PBKDF2-HMAC-SHA256 (120k iterations, per-account salt) | "accounts are created on this device" |
| Market data | Deterministic price/candle/depth/trade simulator (`core/offline/SampleMarket.kt`) | `source = simulator`, `synthetic = true` banner |
| Signals | Deterministic indicator rules (EMA/RSI/MACD/ATR/Bollinger/volume/S-R) | `modelStatus = "unavailable"`, no probability shown |
| Paper trading | Real fill/fee/slippage accounting with risk checks and idempotency | "simulated paper account" |
| Risk engine | Same rules as the backend: notional, exposure, daily loss, open orders/positions, duplicate orders, stop-loss requirement, cooldown, kill switch | rejected orders list the exact failing check |
| Analytics / backtest | Computed from device state and simulated candles | "simulated data" warning list |
| Assistant | Rule-based answers from local facts, English + Sinhala | cannot place orders, cannot bypass checks |
| Admin panel | Local accounts, audit log, pairs, kill switch, settings — unlocked by a code | "not a server role" |
| Binance API keys | **Refused** | keys belong in a backend, never in APK storage |
| Live trading | **Impossible** | rejected with `live_requires_server` |

Prices are a pure function of (symbol, wall-clock minute), so refreshing does not
reshuffle history and two screens always agree on the same price.

## Switching to a real backend

**Settings → Data source → Server**, or the engine line on the sign-in screen.
That rewrites `BuildConfig.API_BASE_URL`'s default with a stored override, drops
the current session (tokens are scoped to one engine) and rebuilds the network
graph. From then on everything comes from your FastAPI backend, which is the only
component that holds exchange keys and can sign a real order.

## The admin unlock code

On-device there is no server to assign a role, so the admin panel is gated by a
code:

* default first-run code: **`RS2011`** (`AdminUnlock.DEFAULT_CODE`);
* it is verified against a PBKDF2-HMAC-SHA256 hash with a per-install salt — the
  plaintext is never stored;
* five wrong attempts lock the gate, and the delay doubles (30 s → 15 min);
* an unlock lasts 15 minutes and lives in memory only — a restart re-locks it;
* change it in **Settings → Admin unlock code** (you must enter the current code).

What the code can and cannot do:

| Can | Cannot |
|---|---|
| Open local user list, audit log, pairs, settings, local kill switch | Grant a server role |
| Release/engage the local kill switch (blocks new paper orders) | Read exchange keys (none exist on device) |
| Enable paper trading / assistant toggles | Enable live trading (hard-wired false on-device) |

If you ship this app to other people, change the default code before distribution
and treat it as a local convenience gate, not as authentication for a multi-user
service. Server-side authorization (`role = admin` in the database) is unchanged
and still required in server mode.

## Why keys are refused on-device

A Binance secret stored in an APK's private storage can be extracted from a rooted
or backup-enabled phone, and the app cannot enforce IP restrictions. The project's
own rule is that secrets live in the backend's encrypted store only, so the
on-device engine declines to accept a key at all and tells you how to deploy the
backend instead. See [`SECURITY.md`](SECURITY.md) and [`TESTNET.md`](TESTNET.md).

## Tests

`android-app/app/src/test/java/com/rsaitrader/core/offline/` contains 17 JVM unit tests for this engine
(11 for the paper/risk rules, 6 for the simulator, indicators and signal honesty). They run in CI with
`:app:testDebugUnitTest`; the last run had no failures.

## Limitations of on-device mode

* Prices are simulated — never trade real money based on them.
* No exchange account, so balances, order history and P&L are paper only.
* Password reset needs email; on-device it returns a clear "not available" error.
* Notifications are local in-app entries; no push delivery.
* Backups/restore of device state are not implemented (the JSON state file is in
  app-private storage and is removed on uninstall).
