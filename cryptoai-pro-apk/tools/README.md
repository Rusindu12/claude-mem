# Local Android toolchain files

The APK build script expects these local-only files in this directory:

- `aapt2`
- `android.jar` (API 34)
- `ecj-3.45.0.jar`
- `d8.jar`
- `apksigner.jar`
- a keystore at `cryptoai-release-test.keystore` is generated locally by `build.sh` if missing

They are intentionally not committed: the APK itself is published as a GitHub Release asset, and signing credentials/tool binaries should not be embedded in the source history. Use Android SDK / compatible versions of the tools and check each binary's origin before use. The build script and README describe the local file names expected.
