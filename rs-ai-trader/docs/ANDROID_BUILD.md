# Android build, signing and installation

## 1. Prerequisites

| Tool | Version |
|---|---|
| JDK | 17 (Android Studio bundles JBR 17/21; use 17 to match `jvmTarget`) |
| Android Studio | Ladybug (2024.2) or newer, with SDK Platform 35 and Build-Tools 35 |
| Gradle | provided by the wrapper (`gradle-wrapper.properties`) |
| Device | Android 8.0 (API 26) or newer |

The project builds with AGP 8.7.3, Kotlin 2.0.21, Compose BOM 2024.12.01.

**Gradle wrapper:** `gradle/wrapper/gradle-wrapper.properties` is committed but the wrapper JAR and
the `gradlew` scripts are not (they could not be generated without a JDK). Create them once:

```bash
cd android-app
gradle wrapper --gradle-version 8.9 --distribution-type bin
```

Android Studio generates the same files automatically when you open the project.

## 2. Where the backend URL lives

`android-app/app/build.gradle.kts` reads the `rsaiBaseUrl` Gradle property and bakes it into
`BuildConfig.API_BASE_URL`; `WEBSOCKET_BASE_URL` is derived by swapping `http` → `ws`. That value is
only the **default**.

The effective URL comes from `data/ServerConfig.kt`: it reads a saved override from SharedPreferences
and falls back to `BuildConfig.API_BASE_URL`. You can therefore install one APK and point it at a
different machine without rebuilding:

* sign-in screen → tap the green **Server:** line under the form;
* **More → Settings** → *Backend* row shows the URL in force and whether it is overridden.

Saving a new URL stores it in the app's private preferences, rebuilds the Retrofit/WebSocket graph
(`ServiceLocator.reconfigure`) and clears the stored session tokens — they were issued by the previous
server, so you sign in again against the new one. **Use default** clears the override.

| Scenario | URL |
|---|---|
| Emulator → host machine | `http://10.0.2.2:8000/` (build default) |
| Physical phone on same Wi-Fi | `http://192.168.1.20:8000/` (your host LAN IP, port 8000) |
| Production | `https://api.example.com/` (HTTPS required, see below) |

Cleartext policy is split by build type:

* `app/src/main/res/xml/network_security_config.xml` — the shipped policy. HTTPS only, no cleartext
  exceptions. Release builds cannot talk to `http://` at all.
* `app/src/debug/res/xml/network_security_config.xml` — debug builds only; permits cleartext so a debug
  APK can reach `http://<LAN-IP>:8000/`. The debug resource overlays the main one, so nothing has to be
  edited to test on a phone.

For a physical device, make the backend listen on `0.0.0.0` (Docker Compose already does) and open the
port in your firewall; add the origin to `ALLOWED_ORIGINS` only if a browser client is used. The phone
and the computer must be on the same network, and `http://` on the phone will show a warning in the
server dialog — expected for debug builds, not allowed in release.

## 3. Debug build (CLI)

```bash
cd android-app
./gradlew :app:assembleDebug -PrsaiBaseUrl=http://10.0.2.2:8000/
# artifact: app/build/outputs/apk/debug/app-debug.apk
```

Install:

```bash
adb devices
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.rsaitrader.debug/com.rsaitrader.MainActivity
```

The debug application id is `com.rsaitrader.debug` (suffix), so a debug build can coexist with a
release build.

### One-command helper

`android-app/build_apk.sh` wraps the steps above (JDK check, `local.properties`, wrapper bootstrap,
build, optional signing check and install):

```bash
cd android-app
./build_apk.sh                                   # debug APK, default URL
./build_apk.sh --url http://192.168.1.20:8000/   # debug APK for a phone on your LAN
./build_apk.sh --release --url https://api.example.com/
./build_apk.sh --install                         # build then `adb install -r`
```

It needs `JAVA_HOME` (or `java` on `PATH`) and either `gradle` on `PATH` (to generate the missing
wrapper) or an Android Studio–generated wrapper.

## 4. Debug build (Android Studio)

1. **File → Open** → select `rs-ai-trader/android-app`.
2. Let Gradle sync (it downloads AGP/Kotlin/Compose on first run).
3. **Run → Edit Configurations → app**. To change the backend URL, add
   `-PrsaiBaseUrl=http://<host>:8000/` under **Build → Compile options → Command-line options** or set
   it in `~/.gradle/gradle.properties`.
4. Pick an emulator or device and press ▶.

If sync fails with "SDK location not found", create `android-app/local.properties`:

```properties
sdk.dir=/Users/<you>/Library/Android/sdk     # macOS
# sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk   # Windows
# sdk.dir=/home/<you>/Android/Sdk                          # Linux
```

## 5. Release signing

1. Generate a keystore (keep it out of git):

```bash
keytool -genkeypair -v -keystore rsai-release.jks -alias rsai \
  -keyalg RSA -keysize 4096 -validity 10000
```

2. Create `android-app/keystore.properties` (already git-ignored):

```properties
storeFile=../rsai-release.jks
storePassword=********
keyAlias=rsai
keyPassword=********
```

3. Build:

```bash
./gradlew :app:assembleRelease -PrsaiBaseUrl=https://api.example.com/
# artifact: app/build/outputs/apk/release/app-release.apk
```

Without `keystore.properties` the release build still compiles but is **unsigned** (installable only
via `adb install` after `apksigner`). The Play Store requires a signed AAB:

```bash
./gradlew :app:bundleRelease -PrsaiBaseUrl=https://api.example.com/
```

Verify the signature:

```bash
apksigner verify --verbose --print-certs app/build/outputs/apk/release/app-release.apk
```

Keep the keystore backed up offline. Losing it means you can never update the app under the same
identity.

## 6. Install the release APK

```bash
adb install -r app-release.apk
```

First launch → onboarding → register (or sign in). Nothing about Binance is configured in the app;
add the API key later under **More → API connection** (server-side only).

## 7. Release checklist

- [ ] `rsaiBaseUrl` is HTTPS
- [ ] Release build has `isMinifyEnabled=true` (already configured)
- [ ] `keystore.properties` is **not** committed (`git status` clean of it)
- [ ] The APK contains no keys: `unzip -p app-release.apk classes.dex | strings | grep -i "binance\|secret"` returns nothing sensitive
- [ ] Version code bumped
- [ ] Backend `min_app_version` is compatible
- [ ] Smoke test on a clean install: login, dashboard, chart, paper order, alert, assistant

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach the RS AI TRADER server" | Wrong `rsaiBaseUrl`, backend not listening on `0.0.0.0`, or phone on a different network |
| Login works but every screen errors | Clock skew or an expired session; sign out and in |
| `CLEARTEXT communication not permitted` | Release build + `http://` URL — use HTTPS |
| Gradle: `Unsupported class file major version` | Wrong JDK; set Gradle JDK to 17 |
| Compose compile errors after editing | `./gradlew --stop && ./gradlew clean :app:assembleDebug` |

## 9. Honest status

| Item | Status |
|---|---|
| `./gradlew :app:assembleDebug` | **Verified** in GitHub Actions (`Android APK` workflow): Kotlin + Compose compile cleanly, debug APK produced (~19 MB) |
| Unit tests (`app/src/test/.../FmtTest.kt`) | Run in CI as a non-blocking step |
| Signed release APK | **Not built** — the release job needs `KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` secrets |
| First run on a real device / emulator | **Not verified** — no device or emulator was available |
| Live call to a running backend from the app | **Not verified** — no Docker/binance egress in the build sandbox |

The APK artifact is attached to the workflow run: **Actions → Android APK → latest run → Artifacts →
`rs-ai-trader-debug-apk`**. Expect to fix small runtime issues (a wrong field name, a layout overflow) on
first install; the compile step is no longer a risk.

### First run on a phone, in order

1. Start the backend where the phone can reach it (`docker compose up`, port 8000, firewall open).
2. Install the debug APK, open it, tap **Server:** on the sign-in screen, enter
   `http://<computer-LAN-IP>:8000/`, save.
3. Register a user (first registered user is **not** automatically admin; promote server-side per
   `docs/SECURITY.md`).
4. Dashboard → markets → chart → AI signal; the connection pill shows the WebSocket state.
5. Settings → AI mode stays **ANALYSIS ONLY**; paper trading is opt-in; live spot requires the
   server-side consent flow and is off by default.
