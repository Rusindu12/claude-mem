#!/usr/bin/env bash
# Fetches a minimal Android build toolchain into ./toolchain (git-ignored).
# Nothing here needs Android Studio or a full SDK install.
#
#   android.jar, d8.jar, apksigner.jar, ecj.jar
#       -> @drxiaozhi/minapk npm package (linux binaries + platform jar)
#   aapt2
#       -> aapt2 python wheel (prebuilt linux binary)
#   java/keytool (optional, only when no JDK/JRE is installed)
#       -> jdk4py python wheel (jlinked Temurin runtime)
#
# Usage: ./scripts/fetch_toolchain.sh [--with-jre]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TC="$ROOT/toolchain"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TC"

echo "== minapk (android.jar, d8, apksigner, ecj)"
curl -sL --retry 3 -m 600 -o "$TMP/minapk.tgz" \
  "https://registry.npmjs.org/@drxiaozhi/minapk/-/minapk-0.5.1.tgz"
tar xzf "$TMP/minapk.tgz" -C "$TMP"
cp "$TMP/package/tools/android.jar" "$TMP/package/tools/d8.jar" \
   "$TMP/package/tools/apksigner.jar" "$TMP/package/tools/ecj-3.45.0.jar" "$TC/"
mv "$TC/ecj-3.45.0.jar" "$TC/ecj.jar"

echo "== aapt2 (python wheel)"
curl -sL --retry 3 -m 300 -o "$TMP/aapt2.whl" \
  "https://files.pythonhosted.org/packages/8d/18/9af0fde83ea6b2d05ed23ec2005d799df6d2e363e887279c5308fc3c7473/aapt2-0.2.1-py3-none-any.whl"
unzip -o -q "$TMP/aapt2.whl" -d "$TMP/aapt2"
cp "$TMP/aapt2/aapt2/bin/Linux/aapt2" "$TC/aapt2"
chmod +x "$TC/aapt2"

echo "== org.json sources (for the offline JVM tests; the device uses the platform org.json)"
curl -sL --retry 3 -m 300 -o "$TMP/json.zip" "https://codeload.github.com/stleary/JSON-java/zip/refs/heads/master"
unzip -o -q "$TMP/json.zip" -d "$TMP/json"
mkdir -p "$TC/json-src"
cp "$TMP"/json/JSON-java-master/src/main/java/org/json/*.java "$TC/json-src/"

if [ "${1:-}" = "--with-jre" ]; then
  echo "== jdk4py (jlinked JRE 25, headless)"
  curl -sL --retry 3 -m 600 -o "$TMP/jdk4py.whl" \
    "https://pypi.org/pypi/jdk4py/json" >/dev/null 2>&1 || true
  curl -sL --retry 3 -m 600 -o "$TMP/jdk4py.whl" \
    "$(python3 - <<'EOF'
import json, urllib.request
d = json.load(urllib.request.urlopen("https://pypi.org/pypi/jdk4py/json"))
print([u["url"] for u in d["urls"] if u["filename"].endswith("manylinux_2_17_x86_64.whl")][0])
EOF
)"
  unzip -o -q "$TMP/jdk4py.whl" -d "$TMP/jre"
  mv "$TMP/jre/jdk4py/java-runtime" "$TC/jre"
fi

echo
echo "toolchain ready:"
ls -la "$TC"
cat <<'EOT'

Now build:
  export JAVA=/abs/path/to/toolchain/jre/bin/java   # or any JDK 11+ / JRE
  ./scripts/build.sh
EOT
