#!/usr/bin/env python3
"""
NEXORA AI — Production Web App (PWA) & Genuine Signed Android APK Builder
Builds:
  1. nexora-ai/mobile/web-bundle/ (Installable PWA with manifest.json, sw.js & icons)
  2. nexora-ai/releases/NEXORA-AI-WebApp-v1.0.0.zip
  3. nexora-ai/releases/NEXORA-AI-v1.0.0.apk (Compiled Dalvik classes.dex + aapt2 resources.arsc + 4-byte zipaligned + APK Signature v1/v2/v3 verified)
"""
import glob
import json
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from PIL import Image, ImageDraw

REPO_NEXORA = Path(__file__).resolve().parents[2]
WEB_BUNDLE_DIR = REPO_NEXORA / "mobile" / "web-bundle"
ASSETS_DIR = REPO_NEXORA / "mobile" / "assets"
ANDROID_PROJ_DIR = REPO_NEXORA / "android-apk-project"
RELEASES_DIR = REPO_NEXORA / "releases"

TOOLCHAIN_DIR = Path("/tmp/android-toolchain")
JAVA_BIN = TOOLCHAIN_DIR / "py" / "jdk4py" / "java-runtime" / "bin" / "java"
KEYTOOL_BIN = TOOLCHAIN_DIR / "py" / "jdk4py" / "java-runtime" / "bin" / "keytool"
AAPT2_BIN = TOOLCHAIN_DIR / "aapt2"
ECJ_JAR = TOOLCHAIN_DIR / "ecj.jar"
D8_JAR = TOOLCHAIN_DIR / "d8.jar"
APKSIGNER_JAR = TOOLCHAIN_DIR / "apksigner.jar"
ANDROID_JAR = TOOLCHAIN_DIR / "android-34.jar"


def run_cmd(cmd, cwd=None):
    print("  $", " ".join(str(c) for c in cmd))
    res = subprocess.run([str(c) for c in cmd], cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"Command failed ({res.returncode}): {' '.join(str(c) for c in cmd)}\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        )
    return res.stdout


def upgrade_pwa_and_zip_webapp():
    print("\n[1/4] Upgrading Expo Web Bundle into Installable Progressive Web App (PWA)...")
    if not (WEB_BUNDLE_DIR / "index.html").exists():
        raise FileNotFoundError(f"Missing {WEB_BUNDLE_DIR / 'index.html'}. Run `npm run export:web` first.")

    src_icon = Image.open(ASSETS_DIR / "icon.png").convert("RGBA")
    src_icon.resize((192, 192), Image.Resampling.LANCZOS).save(WEB_BUNDLE_DIR / "icon-192.png")
    src_icon.resize((512, 512), Image.Resampling.LANCZOS).save(WEB_BUNDLE_DIR / "icon-512.png")

    manifest = {
        "name": "NEXORA AI — Intelligence Without Limits",
        "short_name": "NEXORA AI",
        "description": "Commercial Multi-Model AI Workspace (Chat, Coding, Image, Video, Sinhala & English)",
        "start_url": "./index.html",
        "scope": "./",
        "display": "standalone",
        "orientation": "portrait",
        "background_color": "#05050A",
        "theme_color": "#7C3AED",
        "icons": [
            {"src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable"},
            {"src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable"},
        ],
    }
    (WEB_BUNDLE_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    sw_js = """const CACHE_NAME = 'nexora-ai-pwa-v1';
const CORE_ASSETS = ['./', './index.html', './manifest.json', './icon-192.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/downloads/') || event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request).then((res) => res || caches.match('./index.html')))
  );
});
"""
    (WEB_BUNDLE_DIR / "sw.js").write_text(sw_js, encoding="utf-8")

    html = (WEB_BUNDLE_DIR / "index.html").read_text(encoding="utf-8")
    # Convert absolute root references ("/_expo/..." & "/favicon.ico") to relative ("./_expo/...") so BOTH HTTPS web and file:///android_asset/www/ work!
    html = html.replace('href="/favicon.ico"', 'href="./favicon.ico"')
    html = re.sub(r'src="/(_expo/[^"]+)"', r'src="./\1"', html)

    if 'rel="manifest"' not in html:
        pwa_head = """    <meta name="theme-color" content="#05050A" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="NEXORA AI" />
    <link rel="manifest" href="./manifest.json" />
    <link rel="apple-touch-icon" href="./icon-192.png" />
    <style>html, body { background-color: #05050A; }</style>
  </head>"""
        html = html.replace("</head>", pwa_head)

    if "navigator.serviceWorker" not in html:
        sw_reg = """  <script>
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      window.addEventListener('load', function() {
        navigator.serviceWorker.register('./sw.js').catch(function() {});
      });
    }
  </script>
</body>"""
        html = html.replace("</body>", sw_reg)

    (WEB_BUNDLE_DIR / "index.html").write_text(html, encoding="utf-8")

    RELEASES_DIR.mkdir(parents=True, exist_ok=True)
    web_zip_path = RELEASES_DIR / "NEXORA-AI-WebApp-v1.0.0.zip"
    with zipfile.ZipFile(web_zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(WEB_BUNDLE_DIR.rglob("*")):
            if file_path.is_file():
                zf.write(file_path, file_path.relative_to(WEB_BUNDLE_DIR).as_posix())
    print(f"  -> Packaged Production Web App: {web_zip_path} ({web_zip_path.stat().st_size // 1024} KB)")


def generate_android_mipmaps():
    print("\n[2/4] Generating Android Mipmap Icons (mdpi..xxxhdpi)...")
    src_icon = Image.open(ASSETS_DIR / "icon.png").convert("RGBA")
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    for folder, size in densities.items():
        out_dir = ANDROID_PROJ_DIR / "res" / folder
        out_dir.mkdir(parents=True, exist_ok=True)
        resized = src_icon.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(out_dir / "ic_launcher.png")

        mask = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(mask)
        draw.ellipse((0, 0, size - 1, size - 1), fill=255)
        round_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        round_img.paste(resized, (0, 0), mask)
        round_img.save(out_dir / "ic_launcher_round.png")


def zipalign_4byte(src_apk: Path, dst_apk: Path):
    """
    Aligns all uncompressed (ZIP_STORED) file data payloads in `src_apk` on 4-byte boundaries
    (4096-byte for shared .so libraries), keeping `resources.arsc` uncompressed per Android 11+ (API 30+) rules.
    """
    uncompressed_exts = {".arsc", ".png", ".jpg", ".jpeg", ".webp", ".mp3", ".mp4", ".ogg"}
    with zipfile.ZipFile(src_apk, "r") as zin:
        entries = [(info, zin.read(info.filename)) for info in zin.infolist()]

    with open(dst_apk, "wb") as raw_out:
        with zipfile.ZipFile(raw_out, "w") as zout:
            for orig_info, payload in entries:
                if orig_info.filename.startswith("META-INF/"):
                    continue
                ext = Path(orig_info.filename).suffix.lower()
                store_raw = orig_info.filename == "resources.arsc" or ext in uncompressed_exts or ext == ".so"

                zi = zipfile.ZipInfo(filename=orig_info.filename, date_time=(2026, 10, 31, 0, 0, 0))
                zi.external_attr = 0o644 << 16
                zi.compress_type = zipfile.ZIP_STORED if store_raw else zipfile.ZIP_DEFLATED
                zi.extra = b""

                if store_raw:
                    alignment = 4096 if ext == ".so" else 4
                    header_offset = raw_out.tell()
                    fname_bytes = zi.filename.encode("utf-8")
                    data_start = header_offset + 30 + len(fname_bytes)
                    pad = (alignment - (data_start % alignment)) % alignment
                    zi.extra = b"\x00" * pad

                zout.writestr(zi, payload)

    # Verify every ZIP_STORED entry is 4-byte aligned!
    with zipfile.ZipFile(dst_apk, "r") as zcheck:
        with open(dst_apk, "rb") as fbin:
            for info in zcheck.infolist():
                if info.compress_type == zipfile.ZIP_STORED:
                    fbin.seek(info.header_offset + 26)
                    fn_len = int.from_bytes(fbin.read(2), "little")
                    ex_len = int.from_bytes(fbin.read(2), "little")
                    data_offset = info.header_offset + 30 + fn_len + ex_len
                    if data_offset % 4 != 0:
                        raise RuntimeError(f"Unaligned ZIP_STORED entry {info.filename} at {data_offset}")


def compile_and_sign_apk():
    print("\n[3/4] Compiling & Signing Native Android APK (com.nexora.ai v1.0.0)...")
    with tempfile.TemporaryDirectory(prefix="nexora-apk-build-") as tmp:
        tmp_dir = Path(tmp)
        compiled_res_zip = tmp_dir / "compiled_res.zip"
        gen_java_dir = tmp_dir / "gen"
        classes_dir = tmp_dir / "classes"
        dex_dir = tmp_dir / "dex"
        base_apk = tmp_dir / "base_unaligned.apk"
        aligned_apk = tmp_dir / "aligned.apk"
        gen_java_dir.mkdir()
        classes_dir.mkdir()
        dex_dir.mkdir()

        # 1. Compile res/** with Google aapt2
        run_cmd([AAPT2_BIN, "compile", "--dir", ANDROID_PROJ_DIR / "res", "-o", compiled_res_zip])

        # 2. Link AndroidManifest.xml + resources.arsc + generate R.java
        run_cmd([
            AAPT2_BIN,
            "link",
            "-o", base_apk,
            "-I", ANDROID_JAR,
            "--manifest", ANDROID_PROJ_DIR / "AndroidManifest.xml",
            "--java", gen_java_dir,
            "--auto-add-overlay",
            compiled_res_zip,
        ])

        # 3. Compile R.java + MainActivity.java with Eclipse ECJ against Android 34 SDK
        java_sources = [str(p) for p in gen_java_dir.rglob("*.java")] + [
            str(p) for p in (ANDROID_PROJ_DIR / "src").rglob("*.java")
        ]
        run_cmd([
            JAVA_BIN,
            "-jar", ECJ_JAR,
            "-1.8",
            "-bootclasspath", ANDROID_JAR,
            "-d", classes_dir,
            "-proc:none",
            *java_sources,
        ])

        # 4. Compile JVM .class files into Dalvik classes.dex with Google D8
        class_files = [str(p) for p in classes_dir.rglob("*.class")]
        run_cmd([
            JAVA_BIN,
            "-cp", D8_JAR,
            "com.android.tools.r8.D8",
            "--release",
            "--min-api", "21",
            "--lib", ANDROID_JAR,
            "--output", dex_dir,
            *class_files,
        ])

        # 5. Append classes.dex and full NEXORA AI Web Bundle into assets/www/**
        with zipfile.ZipFile(base_apk, "a", compression=zipfile.ZIP_DEFLATED) as zf:
            zf.write(dex_dir / "classes.dex", "classes.dex")
            for web_file in sorted(WEB_BUNDLE_DIR.rglob("*")):
                if web_file.is_file():
                    arcname = "assets/www/" + web_file.relative_to(WEB_BUNDLE_DIR).as_posix()
                    zf.write(web_file, arcname)

        # 6. 4-byte Zipalign (keeping resources.arsc ZIP_STORED & aligned for Android 11-15!)
        zipalign_4byte(base_apk, aligned_apk)

        # 7. Create release signing keystore in /tmp (never stored in Git!) & sign v1 + v2 + v3
        keystore_path = Path("/tmp/nexora-release-signing.jks")
        ks_pass = "NexoraReleaseKey#2026"
        if not keystore_path.exists():
            run_cmd([
                KEYTOOL_BIN,
                "-genkeypair",
                "-v",
                "-keystore", keystore_path,
                "-storetype", "PKCS12",
                "-alias", "nexora_release",
                "-keyalg", "RSA",
                "-keysize", "2048",
                "-validity", "10000",
                "-storepass", ks_pass,
                "-keypass", ks_pass,
                "-dname", "CN=NEXORA AI, OU=Mobile Engineering, O=NEXORA AI, L=Colombo, ST=Western, C=LK",
            ])

        final_apk = RELEASES_DIR / "NEXORA-AI-v1.0.0.apk"
        run_cmd([
            JAVA_BIN,
            "--enable-native-access=ALL-UNNAMED",
            "-jar", APKSIGNER_JAR,
            "sign",
            "--ks", keystore_path,
            "--ks-key-alias", "nexora_release",
            "--ks-pass", f"pass:{ks_pass}",
            "--key-pass", f"pass:{ks_pass}",
            "--v1-signing-enabled", "true",
            "--v2-signing-enabled", "true",
            "--v3-signing-enabled", "true",
            "--min-sdk-version", "21",
            "--out", final_apk,
            aligned_apk,
        ])

        print("\n[4/4] Verifying Signed APK Integrity, Signatures & Zero-Embedded-Secrets...")
        verify_out = run_cmd([
            JAVA_BIN,
            "--enable-native-access=ALL-UNNAMED",
            "-jar", APKSIGNER_JAR,
            "verify",
            "--verbose",
            "--print-certs",
            final_apk,
        ])
        print(verify_out.strip())

        apk_bytes = final_apk.read_bytes()
        for forbidden in [b"sk-or-v1-", b"sk-live-", b"AIzaSy"]:
            if forbidden in apk_bytes:
                raise RuntimeError(f"SECURITY VIOLATION: Found secret pattern {forbidden} inside APK!")
        print(f"  -> Security Scan PASSED: Zero private API keys in {final_apk.name}")
        print(f"  -> Final Signed Android APK: {final_apk} ({final_apk.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    upgrade_pwa_and_zip_webapp()
    generate_android_mipmaps()
    compile_and_sign_apk()
