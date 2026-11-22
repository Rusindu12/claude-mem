#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Axiom Android APK Builder ==="

if ! command -v java >/dev/null 2>&1; then
  echo "ERROR: Java JDK (17 or 21) is not installed on this machine." >&2
  echo "Tip: Run the GitHub Actions workflow '.github/workflows/axiom-android-apk.yml' to build the APK in the cloud for free." >&2
  exit 1
fi

if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
  echo "ERROR: ANDROID_HOME / ANDROID_SDK_ROOT is not set (Android SDK required)." >&2
  echo "Tip: Run '.github/workflows/axiom-android-apk.yml' on GitHub Actions to build without installing Android Studio." >&2
  exit 1
fi

echo "1. Building Axiom web bundle..."
npm run build

echo "2. Ensuring Capacitor Android packages..."
if [ ! -d "node_modules/@capacitor/android" ]; then
  npm install --no-save @capacitor/core @capacitor/cli @capacitor/android
fi

if [ ! -d "android" ]; then
  npx cap add android
fi

echo "3. Syncing web bundle into Android project..."
npx cap sync android

echo "4. Compiling debug APK via Gradle..."
cd android
chmod +x ./gradlew
./gradlew assembleDebug

APK_PATH="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK_PATH" ]; then
  echo "SUCCESS! APK built at: $(pwd)/$APK_PATH"
else
  echo "ERROR: Gradle finished without producing $APK_PATH" >&2
  exit 1
fi
