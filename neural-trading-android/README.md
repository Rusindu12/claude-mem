# Neural Trading — experimental Android project

The Android project wraps the supplied CryptoAI PRO app and includes a small **trained experimental neural network** for BTC/USDT, ETH/USDT and SOL/USDT hourly spot candles. Select a supported pair and 1h in Chart, then open Signals. Model output is informational, and an optional experimental neural strategy is available in the paper bot (1h, BTC/ETH/SOL only). The other strategies are rule-based. The bot runs only while the app stays active. See `model/README.md` for training, source, and validation details. Its held-out accuracy was below a simple baseline; it is not suitable for real-money decisions.

**Not implemented:** Binance Spot or Futures Testnet/live trading, secure exchange credentials, real-money automated neural trading, background operation and a release APK. No real orders can be placed through this browser wrapper. Public market data requires internet and may fall back to simulated data. Data and trading features have not been validated on a device. AI explanations optionally send a key to the selected third-party provider; the key is held in memory only.

## Build a debug APK

1. Install Android Studio, Android SDK Platform 35, and JDK 17.
2. Open this folder in Android Studio and allow Gradle sync.
3. Choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
4. The debug APK will be at `app/build/outputs/apk/debug/app-debug.apk`. A release build requires your own signing key.

## GitHub Actions debug APK build

The repository includes `.github/workflows/neural-trading-apk.yml`. A push to the session branch automatically runs the workflow. Download the artifact from **Actions → Build Neural Trading debug APK**. Manual dispatch requires this workflow to exist on the default branch. Download `neural-trading-debug-apk` from the run. This workflow has not yet been run or verified here. A debug APK is not a production-signed release.

Local smoke checks: `node tests/model-smoke.cjs` and `node tests/paper-engine.cjs`.

## Binance transport preparation

`live/binance-client.mjs` is a standalone, allowlisted signed REST transport for Binance Spot and USD-M Futures production/testnet endpoints. It is **not included in or connected to the app**, and does not place orders by itself. Local mocked tests run with `node tests/binance-client.mjs`; they do not test Binance connectivity. It has no secure device credential storage, exchange-filter validation, order reconciliation, clock synchronization, live risk enforcement, Futures position management, or device integration. No real trading functionality should be enabled without implementing and validating these pieces on Testnet. WebView CORS and Web Crypto availability also require on-device verification. Never send API keys or secrets via chat.
