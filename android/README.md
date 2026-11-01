# CryptoAI PRO — Android app (APK)

Native Android wrapper for the single-file web app `CryptoAI-PRO.html`. The UI is
the HTML file itself (served from assets over a virtual `https://cryptoai.local`
origin), and the hardware / exchange features the page expects are implemented
natively in Java and exposed to the page as `window.AndroidBridge`.

**Built APK:** [`release/CryptoAI-PRO-1.1.0.apk`](release/CryptoAI-PRO-1.1.0.apk) — signed (v1 + v2 + v3), ~150 KB.

![banner](docs/banner.png)

## Install on the phone

1. Copy `release/CryptoAI-PRO-1.1.0.apk` to the device (USB, Drive, Telegram…).
2. Open it → Android asks to allow "install unknown apps" for the file manager /
   browser you opened it from → allow → **Install**.
3. Launch **CryptoAI PRO**. Play Protect may show "app from unknown developer" —
   that is expected for a self-signed build.

Works on Android 7.0 (API 24) and newer, targetSdk 34 (Android 14).

## What the native layer adds

| Page call (`window.AndroidBridge`) | Native behaviour |
| --- | --- |
| `httpGet` / `httpPost` | networking through the device stack (exchange REST + AI APIs), CORS-free, on a background bridge thread |
| `liveRequest` | signed exchange call (HMAC-SHA256 **on the device**) with a normalised reply: `{ok, code, msg, retryable, rateLimited, retryAfterMs, orderId, execQty, fills…}` — API secrets never reach the web layer |
| `exchangeTest` | balance check + key permissions + round-trip latency for the “Test connection” button |
| `clientOrderId` | idempotency key so a retried submit can never create a second order |
| `liveStatus` | bridge presence / saved keys, so the UI can tell the truth about live mode |
| `binanceSigned` / `bybitSigned` | low-level signing primitives (kept for compatibility) |
| `binanceSaveKeys` / `bybitSaveKeys`, `…Status`, `…ClearKeys` | keys kept in the app's private storage (`SharedPreferences`), only a preview is shown back to the page |
| `notifySignal` | high-priority notification for price alerts / bot trades |
| `haptic`, `speak`, window `setKeepScreenOn` | vibration, text-to-speech, screen stays awake while the app is open |
| `startBgService` / `stopBgService`, `setAutoOn`, `setTradingActive` | foreground service (with `dataSync` type + ongoing notification) so bot timers keep running when the app is backgrounded |
| `version` | shown in Settings → Version (`1.0.0`) |

Other native touches:

- Assets served through a `WebResourceResponse` handler on a virtual HTTPS host, so
  `localStorage` (settings, watchlist, paper positions) persists like on a normal site.
- Signature: adaptive launcher icon (gold mark), round icon, monochrome notification icon,
  dark theme, edge-to-edge‑safe layout, no cleartext traffic.
- Bot live-trading only signs Binance/Bybit spot orders; withdrawal endpoints are never called.

## Live trading (v1.1)

The Trade tab in **Live** mode is a real order router, not a mirror of paper mode:

- **Exchange filters enforced before submit** — step size, min qty, tick size and min notional are read from
  `exchangeInfo` / `instruments-info` (cached 6 h) and the amount is rounded, or the order is refused with the reason.
- **Safety rails** — per-order cap in USDT, daily loss stop that pauses entries and stops the bot, optional
  confirm sheet, and a ⛔ **Close all** panic button that cancels every open order and market-sells the holdings.
- **Spot positions you can actually trade** — every BUY records entry price, qty, TP/SL and fees; the
  autopilot (every 15 s) market-sells when TP or SL is hit. Positions list shows free/locked qty, value, uPnL
  and one-tap *Sell 25 / 50 / 100%*.
- **Accuracy** — realised PnL = (exit − entry) × qty − fees, daily PnL, win rate and fee totals are tracked
  separately for live and paper; balances/equity and open orders sync from the exchange, and **⬇ Fills**
  imports the real trade history.
- **Reliability** — order submits are queued (no races), every submit carries a client order id, a duplicate-id
  rejection is recovered by looking the order up, rate limits are honoured with backoff, and network errors are
  retryable instead of blind.
- **Diagnostics** — “Test connection” shows latency, testnet/mainnet, permissions and warns if the key can
  withdraw or cannot trade; the request log shows the last 60 calls with codes and timings, and exchange errors
  are translated into actionable text (IP whitelist, clock drift, rate limit, min notional…).

Live data never leaves the device except to the exchange you configured: signing, key storage and the
position book are local.

## Rebuild

No Gradle, no Android Studio. `scripts/build.sh` drives `aapt2 → javac/ecj → d8 →
zipalign-equivalent packing → apksigner`, and `scripts/verify_apk.py` re-checks the
result (dex present, `resources.arsc` stored + 4-byte aligned, no path traversal).

```bash
cd android
export ANDROID_JAR=/path/to/android.jar      # platform android-34/35
export AAPT2=/path/to/aapt2                  # build-tools 30+
export D8_JAR=/path/to/d8.jar                # build-tools
export APKSIGNER_JAR=/path/to/apksigner.jar  # build-tools
export JAVA=/path/to/jre/bin/java            # JRE is enough; ecj.jar compiles the sources
export KEYTOOL=/path/to/jdk/bin/keytool      # only needed once, to create the keystore
./scripts/build.sh                           # → release/CryptoAI-PRO-<version>.apk
./scripts/build.sh --install                 # optional: adb install -r
./scripts/build.sh --tests                   # offline signing/envelope tests (48 checks)
```

Everything is configurable — defaults live in `build.config.json` (name, package,
version, minSdk/targetSdk) and the icons are generated by `scripts/make_icons.py`
(pure Python, no Pillow).

No toolchain yet? `./scripts/fetch_toolchain.sh` pulls everything (aapt2, android.jar, d8,
apksigner, ecj, and with `--with-jre` a headless JRE) into `toolchain/`.

Update the web UI without touching Java: drop a new `CryptoAI-PRO.html` into
`app/src/main/assets/index.html` and rebuild (the script copies it automatically if
the asset file is missing). `scripts/patch_live.py` re-applies the live-trading upgrade to a
fresh HTML file — it is idempotent, so it never double-applies.

## Tests

```bash
./scripts/build.sh --tests                     # JVM: signing, envelopes, error mapping (48 checks)
cd tests && npm install jsdom && node live_engine.test.cjs   # jsdom: full live flow (23 checks)
```

The jsdom test drives the real UI file with a mocked `AndroidBridge`: filters → validation →
market buy → tracked position → TP autopilot → PnL/history, plus rate-limit retry, auth-error
hints, daily-loss halt and panic close.

### Signing

`keystore/cryptoai-release.jks` was generated for this project
(alias `cryptoai`, store/key password `cryptoai-pro`). Keep it if you publish
updates — Android only accepts an update signed with the same key. For a store
release, create your own keystore and pass `KEYSTORE`, `KS_PASS`, `KS_ALIAS`.

## Layout

```
android/
├── build.config.json              version / package / sdk levels
├── app/src/main/
│   ├── AndroidManifest.xml
│   ├── assets/index.html          the CryptoAI PRO web app (from your upload)
│   ├── java/com/cryptoai/pro/     MainActivity, Bridge, LiveTrading, Http, Keys, Binance, Bybit, Notifier, BgService
│   └── test/java/…                LiveTradingTest (offline JVM checks)
│   └── res/                       icons, theme, strings (generated by make_icons.py)
├── keystore/cryptoai-release.jks  release key (password above)
├── patches/live_engine.js         live-trading engine spliced into the page by scripts/patch_live.py
├── tests/live_engine.test.cjs     jsdom smoke test with a mocked bridge
├── release/CryptoAI-PRO-1.1.0.apk
└── scripts/                       build.sh, fetch_toolchain.sh, patch_live.py, pack_apk.py, verify_apk.py, make_icons.py
```

## Notes

- The app is a paper-trading + analysis tool out of the box; live trading needs your
  own exchange API keys (trading enabled, withdrawals disabled) entered in Settings.
- Self-signed builds are not distributed on Google Play, so sideloading is required.
- `toolchain/` and `build/` are git-ignored; nothing large is committed besides the APK itself.
