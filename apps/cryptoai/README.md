# CryptoAI PRO — Android-ready paper trading app

Rebuilt from the supplied CryptoAI-PRO-2.html visual styling. The original referenced five JavaScript files that were not supplied. This is a new, smaller functional implementation, not a restoration of the missing bot or execution engine. Isolated from claude-mem.

## Run web preview

From `apps/cryptoai`:

```sh
npm test
npm run preview
```

Open port 4173. No npm install needed for the web app. Public Binance HTTPS and WebSocket endpoints must be reachable from the user's device. The coding sandbox blocks those hosts, so live exchange connectivity could not be verified here. Chart is completed candle closes, not candlesticks. No mock prices or predictive AI.

## Build an Android APK

Requires Node 22, Java 21, Android Studio / Android SDK with SDK licenses accepted and Gradle download access. SDK and Java are not installed in this workspace; no APK binary has been produced or device-tested.

```sh
cd apps/cryptoai
npm ci
npm test
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Android project is generated and ignored; regenerate from Capacitor config. Windows: use `gradlew.bat assembleDebug`.

Alternatively, after pushing this branch, run **Actions → CryptoAI Android APK → Run workflow** on this branch. Download `CryptoAI-PRO-debug-apk` from the successful run's artifacts and extract `app-debug.apk`. Workflow is supplied but has not been executed. Debug APK is for testing, not Play Store production distribution. Use Android Studio to configure a private release signing key and build a signed release for distribution; never commit keys.

## Improvements and limits

- Ten spot markets, volume/gainer/loser sorting, search, timeframe selection.
- Public streaming quotes, bounded exponential reconnect and REST polling fallback. Stale quotes disable paper execution after 15 seconds.
- Completed-candle EMA20/50 and Wilder RSI14 analysis, price line chart.
- Local paper account with fees, slippage, TP/SL, confirmation, trade history, JSON export and reset.
- Per-entry 25% equity allocation cap and 1% estimated stop risk cap including fees/slippage.
- No exchange API keys, real order execution, automatic entry bot or background service. TP/SL is local simulation while running, not an exchange-hosted protective order. Gaps can exceed the estimated loss. Device clock must be accurate. Equity uses stale/entry marks when quotes are unavailable and labels this.
- Browser local storage is editable by the device owner; not a financial ledger. JSON download export is a browser feature and should be device-tested in Android WebView.
- No backend, analytics or external JS dependencies in the web runtime.
- Five automated engine tests pass; Android build, UI on-device behavior and live network integration remain unverified.
- `npm audit` reports four moderate findings in the Capacitor CLI's transitive build-time glob/rimraf dependencies at creation. No dependency is loaded by the web runtime. Review upstream fixes before production release; do not blindly downgrade Capacitor to the suggested obsolete major.

Original CSS supplied by the user is retained. The original unsupported AI, API-key storage, cloud-bot and 24/7 promises were intentionally removed rather than represented as functioning features.

## Binance / Bybit testnet account checks (new)

This phase adds **read-only signed account checks**, not order placement or an auto-execution bot. Four selectors: Binance Spot testnet, Binance USD-M Futures demo/testnet, Bybit Spot testnet and Bybit linear Futures testnet. Bybit uses one Unified wallet for both selectors; a wallet result does not establish permission to trade either category. Binance Futures uses `demo-fapi.binance.com`, not production. Bybit testnet keys are distinct from Bybit demo keys.

Server requires Node 22, accurate system time and outbound HTTPS to the three fixed exchange test hosts. Exchange integration has only been mock-tested here; sandbox network restrictions prevent real endpoint validation.

1. Copy `.env.example` to `.env` on your trusted backend machine, outside version control.
2. Generate a backend token: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. Set only testnet exchange keys on the server. Prefer read-only permissions for this phase. Never paste exchange credentials into the app or chat.
4. Start: `node --env-file=.env server/index.js` from `apps/cryptoai`.
5. Serve through a trusted HTTPS reverse proxy. Do not expose the raw HTTP port publicly; bearer tokens need TLS. No Docker/container/service manager is provided.
6. In **System → Exchange testnet connection**, enter that HTTPS origin and the backend token, select a target, then check. With the web app served by this Node server the backend URL can stay blank. Static preview alone has no API.

API routes require a bearer token, disable caching, rate-limit account checks and return normalized balances only. No POST/order endpoint exists. Exchange errors are sanitized; API keys and signatures are not logged. Cross-origin access defaults to Capacitor's `https://localhost`; add exact trusted web origins through `CRYPTOAI_ALLOWED_ORIGINS` if needed. Do not use `*`. Token is not persisted by the app. Backend must remain private to you; this is not a multi-user authentication service. No production trading hosts are accepted.

The GitHub APK workflow successfully built the earlier paper-only version in run 41433561049. Later additions require a new build. Ten automated unit tests now cover paper engine, signing, target allowlisting and sanitized errors. No live orders have been sent, no backend has been deployed, and no exchange keys were configured in this workspace.

### Before auto execution can be enabled

Need explicit per-trade USDT limit, total daily-loss USDT limit, allowed instruments and Futures leverage/margin mode. Then implement persistent order IDs/reconciliation, exchange precision/min-notional checks, protective exits/reduce-only handling, a server-side kill switch, and restart-safe daily limits. Validate in testnet before any production trading. These execution features are **not implemented** by the account connector.

## Editable in-app risk settings

Open **System → Trading risk settings** to edit and save:

- Max entry cost including entry fees: 1–10,000 USDT (default 100).
- Daily loss budget: 1–10,000 USDT (default 100), evaluated on UTC calendar days.
- Futures leverage preference: integer 1–10× (default 1×). **Preference only**: no leveraged simulator, exchange leverage change or execution bot is implemented.

Settings persist on this device separately from the paper account. Invalid stored settings fall back to defaults. Raising a limit or leverage asks for confirmation. Saving only applies to new entries; existing TP/SL is not changed. Restore defaults does not erase daily loss usage. Paper-account reset still clears all simulated account data, including loss accounting.

Paper buys enforce the saved USDT entry cap alongside the existing 25% allocation / 1% stop-risk caps. Daily budget usage is gross realized losses today (profits do not offset losses) plus negative open liquidation P&L including estimated exit costs. New entries must fit their estimated stop loss inside the remaining budget. Open positions require fresh marks before allowing a new entry. Sells and TP/SL exits stay available even when the daily cap blocks buys. A daily ledger persists beyond the truncated history. This is a local simulator, not a tamper-resistant or server-side risk control. Losses can exceed the budget due to gaps; there is no forced liquidation at the daily cap.

No API secrets are stored with settings and these settings are not sent to or enforced by Binance/Bybit. Exchange access remains read-only. Do not interpret the preference controls as real-money trading support.
