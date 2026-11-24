# CryptoAI PRO Android

A mobile-first WebView trading terminal packaged as a standalone Android APK. It reads public spot-market data from Binance, Bybit, or OKX; runs local technical analysis and a walk-forward-trained model; supports paper trades; and offers an explicitly armed, optional Binance Spot auto-bot.

## What automatic means here

- The bot evaluates newly **closed** candles on its selected interval (default: 1 minute) while the app is open. It does not claim guaranteed uptime or run a background service after the app is closed or Android suspends it.
- Paper mode only simulates orders. Binance auto-live is separate and requires API keys, Binance selected as the data source, long-only spot mode, and a fresh in-app confirmation each time it is armed.
- For each auto-live entry, the app requests account/free-USDT data, refuses symbols with existing base-asset holdings or open orders, sizes conservatively (risk cap and 10% free-USDT notional cap), then submits a Binance Spot market buy followed by a server-side OCO take-profit/stop-loss. If OCO placement fails, it attempts an emergency market sell; if both fail, it stops and raises an urgent in-app alert. Exchange orders and fills must still be verified.
- App-managed OCO positions can be inspected in the Bot tab. “Close now” requests OCO cancellation then a market sell. Stopping the scanner stops new entries, but already-submitted OCO exits remain active at Binance.
- Live auto is **Binance Spot long-only**. It does not use margin, futures, leverage, withdrawals, or take over coins/open orders it did not create. The local daily live limit is a conservative *reserved stop-risk budget*, while the drawdown guard estimates USDT plus bot-managed coin values; other untracked assets are not fully valued. Neither is an exchange-guaranteed loss limit.
- App closure, lost internet, exchange outages, rejected orders, gaps/slippage, and Android power management can still disrupt automation. The app cannot guarantee every signal, order, stop, or profit. Do not use money you cannot afford to lose; test in paper mode first.

## Security and live trading

The native Android bridge encrypts API keys with Android Keystore-backed AES-GCM. The signed endpoint allowlist is limited to account reads, open-order reads, spot orders, OCO creation and OCO cancellation. Withdrawal endpoints are not allowed. Use a Binance API key with withdrawals disabled and the minimum permissions needed. The APK is locally signed with a test key, not a Play Store release signing key.

## Install / build

Install `CryptoAI-PRO.apk` on Android 8.0+ (API 26+). The source repository includes the build script and `zipalign.py`; Android toolchain binaries and local signing keys are intentionally excluded. To rebuild, put compatible `aapt2`, API 34 `android.jar`, `ecj-3.45.0.jar`, `d8.jar`, and `apksigner.jar` files under `tools/` using the names listed in `tools/README.md`, then run:

```sh
./build.sh
```

Build pipeline: `aapt2 → ECJ → R8/D8 → zipalign.py → apksigner`; it verifies v2/v3 signatures and prints APK badging. Java 21 is recommended; set `JAVA_HOME` if needed. The signed APK is attached to the GitHub Release; its local test signing key is not included.

## Source and tests

- `app/index.html`: single-file bundled app UI and runtime.
- `app/src/`: modular JS sources: patterns, TA engine, local learning brain, and app/controller.
- `android/`: manifest, WebView host, resources, R8 keep rules.
- `tests/ta-smoke.cjs`: deterministic TA, backtest, and walk-forward-learning smoke checks.

```sh
node tests/ta-smoke.cjs
node tests/auto-live-guards.cjs
```
