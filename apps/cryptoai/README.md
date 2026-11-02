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
