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
`BuildConfig.API_BASE_URL`; `WEBSOCKET_BASE_URL` is derived by swapping `http` → `ws`.

| Scenario | URL |
|---|---|
| Emulator → host machine | `http://10.0.2.2:8000/` (default) |
| Physical phone on same Wi-Fi | `http://192.168.1.20:8000/` (your host LAN IP) |
| Production | `https://api.example.com/` |

Cleartext HTTP is only permitted for `10.0.2.2` and `localhost` (debug). For a LAN IP you must either
use HTTPS or temporarily extend `res/xml/network_security_config.xml`; that file is debug-only by
design and release builds reject cleartext.

For a physical device, also add the origin to the backend's `ALLOWED_ORIGINS` if you use a browser
client, and make sure the backend listens on `0.0.0.0`.

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

The Kotlin sources in this repository were **not compiled** while they were written: the build
sandbox had no JDK, Android SDK or Gradle, so no APK was produced and the unit tests in
`app/src/test/java/com/rsaitrader/core/format/FmtTest.kt` were not executed. Treat your first local
`./gradlew :app:assembleDebug` as the real compile verification, and expect to fix minor issues
(unused imports, an occasional type mismatch) before it succeeds.
