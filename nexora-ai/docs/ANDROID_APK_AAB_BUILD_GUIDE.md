# NEXORA AI — Android `.apk` & Google Play `.aab` Build Guide

NEXORA AI's mobile application (`nexora-ai/mobile`) is built with **React Native 0.76 + Expo SDK 52 + TypeScript** (`package: com.nexora.ai`).

## Security Verification Before Building

- **Zero Embedded Secrets:** `nexora-ai/mobile` contains **NO** OpenAI, Gemini, Anthropic, PayHere, Stripe, PostgreSQL, or JWT secrets.
- The **only** build-time variable injected into the Android binary is `EXPO_PUBLIC_API_URL` (pointing to your HTTPS backend, e.g., `https://api.nexora.ai/api/v1`).
- User session tokens on Android are stored inside Android Keystore-backed encrypted storage via `expo-secure-store`.

---

## Option A: Build Installable Android `.apk` & Play Store `.aab` via EAS Build (Recommended)

1. Install EAS CLI and authenticate:
   ```bash
   npm install -g eas-cli
   eas login
   ```
2. Navigate to the mobile project and verify TypeScript compilation:
   ```bash
   cd nexora-ai/mobile
   npm install --legacy-peer-deps
   npm run typecheck
   ```
3. Set your live HTTPS backend URL in `eas.json` (`env.EXPO_PUBLIC_API_URL`):
   ```json
   "EXPO_PUBLIC_API_URL": "https://api.nexora.ai/api/v1"
   ```
4. **Build Direct-Install Android APK** (for internal QA, direct download, or Sri Lankan enterprise distribution):
   ```bash
   eas build --platform android --profile apk
   ```
   EAS compiles the signed `.apk` artifact and provides a direct download link for installation on any Android 8.0+ phone or tablet.
5. **Build Google Play Store Android App Bundle (`.aab`)**:
   ```bash
   eas build --platform android --profile production
   ```
   Upload the resulting `.aab` to **Google Play Console** (`Internal Testing` → `Production`) with Play App Signing enabled.

---

## Option B: Local Standalone Gradle Build (No Cloud Build Service Needed)

If you have Android Studio / Android SDK (`ANDROID_HOME`) and JDK 17 installed locally:

```bash
cd nexora-ai/mobile
npm install --legacy-peer-deps

# Generate native android/ Gradle project from app.json
EXPO_PUBLIC_API_URL="https://api.nexora.ai/api/v1" npx expo prebuild --platform android --clean

# Build release APK locally:
cd android
./gradlew assembleRelease
# Output APK: android/app/build/outputs/apk/release/app-release.apk

# Build Google Play AAB locally:
./gradlew bundleRelease
# Output AAB: android/app/build/outputs/bundle/release/app-release.aab
```

Sign `app-release.apk` / `app-release.aab` using your production Android upload keystore (`keytool -genkeypair -v -storetype PKCS12 -keystore nexora-release.keystore -alias nexora -keyalg RSA -keysize 2048 -validity 10000`) and store the keystore + passwords in an offline vault (losing the upload key requires a Play Console key reset).
