#!/usr/bin/env bash
# ============================================================================
#  CryptoAI PRO — Android APK build (no Gradle, no Android Studio required)
#
#  Pipeline:  aapt2 compile -> aapt2 link -> javac (Android SDK) -> d8
#             -> APK pack (+ zipalign) -> apksigner (v1+v2+v3)
#
#  Toolchain lives outside the repo. Point the env vars at it, or drop the
#  binaries in ./toolchain (see README for the one-line setup):
#     ANDROID_JAR   android.jar  (platform android-35)
#     AAPT2         aapt2 binary (build-tools 30+)
#     JAVA_HOME     JDK 11+ (javac)
#     D8_JAR        d8.jar from build-tools  (optional if D8_BIN is set)
#     KEYSTORE      release keystore (created on first run if missing)
#
#  Usage:
#     ./scripts/build.sh              # debug-ish release using local keystore
#     ./scripts/build.sh --install    # build, then adb install -r
# ============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT/app/src/main"
CONFIG="$ROOT/build.config.json"
BUILD="$ROOT/build"
DIST="$ROOT/release"   # committed: the built APK ships with the repo

ANDROID_JAR="${ANDROID_JAR:-$ROOT/toolchain/android.jar}"
AAPT2="${AAPT2:-$ROOT/toolchain/aapt2}"
D8_JAR="${D8_JAR:-$ROOT/toolchain/d8.jar}"
D8_BIN="${D8_BIN:-$ROOT/toolchain/d8}"
APKSIGNER_JAR="${APKSIGNER_JAR:-$ROOT/toolchain/apksigner.jar}"
ZIPALIGN="${ZIPALIGN:-}"
KEYSTORE="${KEYSTORE:-$ROOT/keystore/cryptoai-release.jks}"
KS_PASS="${KS_PASS:-cryptoai-pro}"
KS_ALIAS="${KS_ALIAS:-cryptoai}"

ECJ_JAR="${ECJ_JAR:-$ROOT/toolchain/ecj.jar}"
# keytool ships next to java in any JDK; reuse that directory if it has one
if [ -z "${KEYTOOL:-}" ] && [ -x "$(dirname "${JAVA:-x}")/keytool" ]; then
  KEYTOOL="$(dirname "$JAVA")/keytool"
fi
if [ -z "${JAVA:-}" ] && [ -x "$ROOT/toolchain/jre/bin/java" ]; then
  JAVA="$ROOT/toolchain/jre/bin/java"      # JRE shipped next to the tools (optional)
fi
if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/javac" ]; then
  JAVA="$JAVA_HOME/bin/java"; JAVAC="$JAVA_HOME/bin/javac"; KEYTOOL="$JAVA_HOME/bin/keytool"
elif command -v javac >/dev/null 2>&1; then
  JAVA="java"; JAVAC="javac"; KEYTOOL="keytool"
elif [ -f "$ECJ_JAR" ] && { command -v java >/dev/null 2>&1 || [ -n "${JAVA:-}" ]; }; then
  # no JDK? the Eclipse compiler + any JRE (even a jlinked runtime without javac) is enough
  JAVA="${JAVA:-java}"; JAVAC=""; KEYTOOL="${KEYTOOL:-keytool}"
elif command -v java >/dev/null 2>&1; then
  JAVA="${JAVA:-java}"; JAVAC=""; KEYTOOL="${KEYTOOL:-keytool}"
else
  echo "!! java not found — set JAVA_HOME to a JDK 11+ (or put a JRE on PATH)" >&2; exit 1
fi

need() { [ -e "$1" ] || { echo "!! missing tool: $1 (see README toolchain notes)" >&2; exit 1; }; }
need "$ANDROID_JAR"; need "$AAPT2"

json() { python3 -c "import json,sys;print(json.load(open('$CONFIG'))['$1'])"; }
APP_NAME="$(json appName)"; PKG="$(json packageName)"
VER_NAME="$(json versionName)"; VER_CODE="$(json versionCode)"
MIN_SDK="$(json minSdk)"; TARGET_SDK="$(json targetSdk)"

echo "== CryptoAI PRO $VER_NAME ($VER_CODE)  pkg=$PKG  minSdk=$MIN_SDK targetSdk=$TARGET_SDK"

rm -rf "$BUILD"; mkdir -p "$BUILD/gen" "$BUILD/res" "$BUILD/classes" "$BUILD/dex" "$DIST"

# 0. sync the web bundle once, so the APK always ships the single-file app
if [ -f "$ROOT/../CryptoAI-PRO.html" ] && [ ! -e "$APP/assets/index.html" ]; then
  cp "$ROOT/../CryptoAI-PRO.html" "$APP/assets/index.html"
fi
[ -f "$APP/assets/index.html" ] || { echo "!! app/src/main/assets/index.html missing" >&2; exit 1; }

# 1. generated sources (version info)
cat > "$BUILD/gen/BuildConfig.java" <<EOF
package $PKG;
public final class BuildConfig {
    public static final String VERSION_NAME = "$VER_NAME";
    public static final int VERSION_CODE = $VER_CODE;
    private BuildConfig() {}
}
EOF

# 2. resources -> flat archives
"$AAPT2" compile --dir "$APP/res" -o "$BUILD/res/res.zip"

# 3. link resources + manifest (+ assets straight into the APK base)
"$AAPT2" link \
  -o "$BUILD/base.apk" \
  -I "$ANDROID_JAR" \
  --manifest "$APP/AndroidManifest.xml" \
  -A "$APP/assets" \
  --java "$BUILD/gen" \
  --min-sdk-version "$MIN_SDK" \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VER_CODE" \
  --version-name "$VER_NAME" \
  --auto-add-overlay \
  "$BUILD/res/res.zip"

# 4. compile Java against the platform jar (no AndroidX needed)
find "$APP/java" "$BUILD/gen" -name '*.java' > "$BUILD/sources.txt"
if [ -n "$JAVAC" ]; then
  "$JAVAC" -source 8 -target 8 -encoding UTF-8 -nowarn -Xlint:-options \
    -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt"
else
  # compliance 8 keeps ECJ in classic classpath mode (android.jar also carries java.* stubs)
  "$JAVA" -jar "$ECJ_JAR" -source 1.8 -target 1.8 -proc:none -nowarn -encoding UTF-8 \
    -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.txt"
fi

# 5. dex
if [ -x "$D8_BIN" ]; then
  "$D8_BIN" --release --min-api "$MIN_SDK" --lib "$ANDROID_JAR" --output "$BUILD/dex" \
    $(find "$BUILD/classes" -name '*.class')
else
  need "$D8_JAR"
  "$JAVA" -cp "$D8_JAR" com.android.tools.r8.D8 --release --min-api "$MIN_SDK" \
    --lib "$ANDROID_JAR" --output "$BUILD/dex" \
    $(find "$BUILD/classes" -name '*.class')
fi

# 6. pack APK with classes.dex + 4-byte aligned, stored resources.arsc
python3 "$ROOT/scripts/pack_apk.py" "$BUILD/base.apk" "$BUILD/dex/classes.dex" "$BUILD/unaligned.apk"

UNSIGNED="$BUILD/unaligned.apk"
if [ -n "$ZIPALIGN" ] && [ -x "$ZIPALIGN" ]; then
  "$ZIPALIGN" -p -f 4 "$UNSIGNED" "$BUILD/aligned.apk"
  UNSIGNED="$BUILD/aligned.apk"
fi

# 7. signing key
if [ ! -f "$KEYSTORE" ]; then
  echo "== creating release keystore at $KEYSTORE"
  mkdir -p "$(dirname "$KEYSTORE")"
  "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias "$KS_ALIAS" -keyalg RSA -keysize 2048 -validity 10950 \
    -dname "CN=CryptoAI PRO, OU=Mobile, O=CryptoAI, L=Colombo, C=LK" \
    || { echo "!! keytool failed — pass an existing KEYSTORE=... or install a JDK" >&2; exit 1; }
fi

OUT="$DIST/CryptoAI-PRO-$VER_NAME.apk"
if [ -f "$APKSIGNER_JAR" ]; then
  "$JAVA" -jar "$APKSIGNER_JAR" sign \
    --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
    --ks-key-alias "$KS_ALIAS" \
    --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
    --out "$OUT" "$UNSIGNED"
  "$JAVA" -jar "$APKSIGNER_JAR" verify --print-certs "$OUT" | head -5
  rm -f "$OUT.idsig"   # v4 signature side-car is only used by adb incremental install
else
  cp "$UNSIGNED" "$OUT"
  echo "!! apksigner.jar not found — APK is UNSIGNED"
fi

# 8. self-check
python3 "$ROOT/scripts/verify_apk.py" "$OUT"

echo
echo "== built $OUT  ($(du -h "$OUT" | cut -f1))"
if [ "${1:-}" = "--install" ] && command -v adb >/dev/null 2>&1; then
  adb install -r "$OUT"
fi
