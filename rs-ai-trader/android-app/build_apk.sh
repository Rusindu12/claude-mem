#!/usr/bin/env bash
# =====================================================================
# RS AI TRADER — build the APK in one command
#
#   cd android-app
#   ./build_apk.sh                      # debug APK against http://10.0.2.2:8000/
#   ./build_apk.sh --release            # release APK (needs keystore.properties)
#   ./build_apk.sh --url https://api.example.com/
#   ./build_apk.sh --install            # build then adb install onto a device
#
# Requirements: JDK 17, Android SDK (platform 35 + build-tools 35) OR a
# network connection so the Gradle Android plugin can download them, and
# Gradle 8.x on PATH the first time (only to create the wrapper).
# =====================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

BASE_URL="http://10.0.2.2:8000/"
VARIANT="debug"
DO_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release) VARIANT="release"; shift ;;
    --debug)   VARIANT="debug"; shift ;;
    --url)     BASE_URL="${2:?--url needs a value}"; shift 2 ;;
    --install) DO_INSTALL=1; shift ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
die() { printf '\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ checks
say "1/5  Checking the toolchain"
if ! command -v java >/dev/null 2>&1; then
  die "Java not found. Install JDK 17 (Android Studio bundles one: Settings → Build → Gradle → Gradle JDK)."
fi
JAVA_VERSION="$(java -version 2>&1 | head -1)"
echo "    java: $JAVA_VERSION"
case "$JAVA_VERSION" in
  *\"1.8*|*\"11*) die "JDK 17 is required (AGP 8.7). Found: $JAVA_VERSION" ;;
esac

SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
if [[ ! -d "$SDK_DIR" ]]; then
  warn "    Android SDK not found at $SDK_DIR"
  warn "    Set ANDROID_HOME (or create local.properties with sdk.dir=...)."
  warn "    Android Studio → SDK Manager → install 'Android 15 (API 35)' + 'Build-Tools 35.0.0'."
fi
if [[ -d "$SDK_DIR" && ! -f local.properties ]]; then
  echo "sdk.dir=$SDK_DIR" > local.properties
  echo "    wrote local.properties (sdk.dir=$SDK_DIR)"
fi

if [[ "$VARIANT" == "release" && ! -f keystore.properties ]]; then
  die "Release build needs keystore.properties (storeFile, storePassword, keyAlias, keyPassword).
    Generate a key first:
      keytool -genkeypair -v -keystore rsai-release.jks -alias rsai -keyalg RSA -keysize 4096 -validity 10000
    See docs/ANDROID_BUILD.md §5."
fi

# --------------------------------------------------------------- wrapper
say "2/5  Gradle wrapper"
if [[ ! -x ./gradlew ]]; then
  if command -v gradle >/dev/null 2>&1; then
    gradle wrapper --gradle-version 8.9 --distribution-type bin
  else
    die "The gradle wrapper is not generated and 'gradle' is not on PATH.
    Either install Gradle 8.x (https://gradle.org/install/) and re-run this script,
    or simply open this folder in Android Studio — it generates the wrapper and builds."
  fi
fi
./gradlew --version | sed -n '1,6p'

# ------------------------------------------------------------------ build
say "3/5  Building :app:assemble$([[ $VARIANT == release ]] && echo Release || echo Debug)"
echo "    backend URL baked into the APK: $BASE_URL"
./gradlew ":app:assemble${VARIANT^}" \
  -PrsaiBaseUrl="$BASE_URL" \
  --console=plain \
  --stacktrace

APK_DIR="app/build/outputs/apk/$VARIANT"
APK="$(ls -1t "$APK_DIR"/*.apk 2>/dev/null | head -1 || true)"
[[ -n "$APK" ]] || die "Build finished but no APK was found in $APK_DIR"

say "4/5  APK ready"
echo "    $PWD/$APK"
ls -lh "$APK" | awk '{print "    size: "$5}'
if command -v apksigner >/dev/null 2>&1; then
  apksigner verify --print-certs "$APK" | head -4 || warn "    (unsigned — install with adb only after signing)"
elif [[ -x "$SDK_DIR/build-tools/35.0.0/apksigner" ]]; then
  "$SDK_DIR/build-tools/35.0.0/apksigner" verify --print-certs "$APK" | head -4
fi

# ---------------------------------------------------------------- install
if [[ $DO_INSTALL -eq 1 ]]; then
  say "5/5  Installing on the connected device"
  command -v adb >/dev/null 2>&1 || die "adb not found (install platform-tools or use Android Studio's terminal)."
  adb devices
  adb install -r "$APK"
  PKG=$([[ "$VARIANT" == debug ]] && echo "com.rsaitrader.debug" || echo "com.rsaitrader")
  adb shell am start -n "$PKG/com.rsaitrader.MainActivity" || true
else
  say "5/5  Done"
  echo "    Install with:  adb install -r $APK"
  echo "    Emulator must reach the backend at the URL baked in above"
  echo "    (10.0.2.2 = host machine loopback; a phone needs your LAN IP or HTTPS)."
fi
