#!/usr/bin/env python3
"""Verify a packed APK: zip integrity, classes.dex present, resources.arsc
stored + 4-byte aligned, no path traversal entries.

Usage: verify_apk.py <app.apk>
"""
import struct
import sys
import zipfile


def main():
    path = sys.argv[1]
    problems = []
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        bad = z.testzip()
        if bad:
            problems.append("corrupt entry: " + bad)
        if "classes.dex" not in names:
            problems.append("classes.dex missing")
        if "AndroidManifest.xml" not in names:
            problems.append("AndroidManifest.xml missing")
        if "resources.arsc" not in names:
            problems.append("resources.arsc missing")
        dex = z.getinfo("classes.dex") if "classes.dex" in names else None
        if dex and dex.compress_type != zipfile.ZIP_STORED:
            problems.append("classes.dex is compressed")

        with open(path, "rb") as f:
            data = f.read()
        for info in z.infolist():
            if info.filename.endswith((".arsc", ".so", ".dex")):
                if info.compress_type != zipfile.ZIP_STORED:
                    problems.append("%s not stored" % info.filename)
                header_off = _local_header_offset(data, info.filename)
                if header_off is not None:
                    nlen, elen = struct.unpack("<HH", data[header_off + 26:header_off + 30])
                    data_off = header_off + 30 + nlen + elen
                    if data_off % 4 != 0:
                        problems.append("%s data offset %d not 4-aligned" % (info.filename, data_off))
            if ".." in info.filename or info.filename.startswith("/"):
                problems.append("suspicious entry " + info.filename)
        print("entries: %d, size: %.1f KB" % (len(names), len(data) / 1024.0))

    if problems:
        print("FAIL")
        for p in problems:
            print("  -", p)
        sys.exit(1)
    print("OK: apk structure, dex presence and alignment verified")


def _local_header_offset(data, name):
    # walk local headers: signature, then skip using sizes in the header
    off = 0
    target = name.encode()
    while off + 30 <= len(data):
        if data[off:off + 4] != b"PK\x03\x04":
            return None
        nlen, elen = struct.unpack("<HH", data[off + 26:off + 30])
        csize = struct.unpack("<I", data[off + 18:off + 22])[0]
        if data[off + 30:off + 30 + nlen] == target:
            return off
        off = off + 30 + nlen + elen + csize
    return None


if __name__ == "__main__":
    main()
