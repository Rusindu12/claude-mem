#!/usr/bin/env python3
"""Pack a build-tools produced APK: inject classes.dex, keep resources.arsc
stored and 4-byte aligned (required for targetSdk >= 30), then write out.

Usage: pack_apk.py <base.apk> <classes.dex> <out.apk>
Pure stdlib: no zipalign / Android SDK needed for this step.
"""
import os
import struct
import sys
import zipfile
import zlib

ALWAYS_STORED = (".arsc", ".so")


def align(n, a=4):
    return (a - (n % a)) % a


def write_zip(out_path, entries):
    """entries: list of dicts(name, data, store, time) in insertion order."""
    out = open(out_path, "wb")
    central = []
    offset = 0

    def dos_time(t=(2024, 1, 1, 0, 0, 0)):
        y, mo, d, h, mi, s = t
        return ((y - 1980) << 9) | (mo << 5) | d, (h << 11) | (mi << 5) | (s // 2)

    for e in entries:
        name = e["name"].encode("utf-8")
        data = e["data"]
        store = e["store"]
        if store:
            payload = data
            method = 0
            crc = zlib.crc32(data) & 0xFFFFFFFF
            csize = usize = len(data)
        else:
            co = zlib.compressobj(9, zlib.DEFLATED, -15)
            payload = co.compress(data) + co.flush()
            method = 8
            crc = zlib.crc32(data) & 0xFFFFFFFF
            csize = len(payload)
            usize = len(data)

        dtime, ddate = dos_time()
        header_off = offset
        # local file header + optional alignment padding stored inside the name-less extra field
        pad = align(offset + 30 + len(name), 4) if store else 0
        if 0 < pad < 4:  # an extra field needs >= 4 bytes for its own header
            pad += 4
        extra = b""
        if pad:
            extra = struct.pack("<HH", 0xD935, pad - 4) + b"\x00" * (pad - 4)
        out.write(struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 0, method, dtime, ddate,
                              crc, csize, usize, len(name), len(extra)))
        out.write(name)
        out.write(extra)
        out.write(payload)
        offset = out.tell()

        central.append((name, method, dtime, ddate, crc, csize, usize, header_off))

    cd_start = out.tell()
    for (name, method, dtime, ddate, crc, csize, usize, header_off) in central:
        out.write(struct.pack("<IHHHHHHIIIHHHHHII", 0x02014B50, 20, 20, 0, method, dtime, ddate,
                              crc, csize, usize, len(name), 0, 0, 0, 0, 0, header_off))
        out.write(name)
    cd_end = out.tell()
    out.write(struct.pack("<IHHHHIIH", 0x06054B50, 0, 0, len(central), len(central),
                          cd_end - cd_start, cd_start, 0))
    out.close()


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(2)
    base, dex, out_path = sys.argv[1:4]
    entries = []
    with zipfile.ZipFile(base) as z:
        for info in z.infolist():
            data = z.read(info.filename)
            store = info.filename.endswith(ALWAYS_STORED)
            entries.append({"name": info.filename, "data": data, "store": store})

    if not os.path.exists(dex):
        sys.exit("missing " + dex)
    with open(dex, "rb") as f:
        dex_data = f.read()

    entries.insert(0, {"name": "classes.dex", "data": dex_data, "store": True})
    write_zip(out_path, entries)
    print("packed %s (%d entries, %.1f KB)" % (out_path, len(entries), os.path.getsize(out_path) / 1024.0))


if __name__ == "__main__":
    main()
