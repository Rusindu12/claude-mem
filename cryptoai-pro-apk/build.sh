#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$ROOT/tools"
ANDROID="$ROOT/android"
BUILD="$ROOT/build"
if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_PATH="$(command -v java)"
  JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$JAVA_PATH")")")"
fi
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
AAPT2="$TOOLS/aapt2"
ANDROID_JAR="$TOOLS/android.jar"
ECJ="$TOOLS/ecj-3.45.0.jar"
D8="$TOOLS/d8.jar"
APKSIGNER="$TOOLS/apksigner.jar"
mkdir -p "$BUILD/res" "$BUILD/classes" "$BUILD/dex" "$BUILD/apk/assets/www"
rm -rf "$BUILD/res" "$BUILD/classes" "$BUILD/dex" "$BUILD/apk"
mkdir -p "$BUILD/res" "$BUILD/classes" "$BUILD/dex" "$BUILD/apk/assets/www"
cp -R "$ANDROID/res/." "$BUILD/res/"
cp "$ROOT/app/index.html" "$BUILD/apk/assets/www/index.html"
"$AAPT2" compile --dir "$BUILD/res" -o "$BUILD/compiled.zip"
"$AAPT2" link -o "$BUILD/resources.apk" -I "$ANDROID_JAR" --manifest "$ANDROID/AndroidManifest.xml" --auto-add-overlay "$BUILD/compiled.zip"
find "$ANDROID/src" -name '*.java' -print > "$BUILD/sources.list"
java -jar "$ECJ" -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -classpath "$ANDROID_JAR" -d "$BUILD/classes" @"$BUILD/sources.list"
find "$BUILD/classes" -name '*.class' -print > "$BUILD/classes.list"
java -cp "$D8" com.android.tools.r8.R8 --release --dex --min-api 26 --lib "$ANDROID_JAR" --pg-conf "$ANDROID/keep.pro" --output "$BUILD/dex" @"$BUILD/classes.list"
cp "$BUILD/resources.apk" "$BUILD/unsigned.apk"
(cd "$BUILD/dex" && zip -q "$BUILD/unsigned.apk" classes.dex)
(cd "$BUILD/apk" && zip -qr "$BUILD/unsigned.apk" assets)
python3 "$ROOT/zipalign.py" "$BUILD/unsigned.apk" "$BUILD/aligned.apk" 4
KEYSTORE="$TOOLS/cryptoai-release-test.keystore"
if [[ ! -f "$KEYSTORE" ]]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass cryptoai-test -keypass cryptoai-test -alias cryptoai -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=CryptoAI PRO Test, OU=Local, O=CryptoAI, L=Colombo, ST=Western, C=LK" >/dev/null 2>&1
fi
java -jar "$APKSIGNER" sign --ks "$KEYSTORE" --ks-key-alias cryptoai --ks-pass pass:cryptoai-test --key-pass pass:cryptoai-test --v2-signing-enabled true --v3-signing-enabled true --out "$ROOT/CryptoAI-PRO.apk" "$BUILD/aligned.apk"
java -jar "$APKSIGNER" verify --verbose "$ROOT/CryptoAI-PRO.apk"
"$AAPT2" dump badging "$ROOT/CryptoAI-PRO.apk" > "$BUILD/badging.txt"
sed -n '1,8p' "$BUILD/badging.txt"
printf '\nAPK: %s\n' "$ROOT/CryptoAI-PRO.apk"
