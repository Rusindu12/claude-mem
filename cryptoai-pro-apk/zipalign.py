#!/usr/bin/env python3
"""Minimal zipalign: rewrite zip so STORED entries are 4-byte (or page) aligned."""
import sys, struct, zipfile

def dt(zi):
    return (((zi.date_time[3] << 11) | (zi.date_time[4] << 5) | (zi.date_time[5] // 2)) & 0xFFFF,
            (((zi.date_time[0] - 1980) << 9) | (zi.date_time[1] << 5) | zi.date_time[2]) & 0xFFFF)

def align_zip(inp, outp, alignment=4, page=16384):
    zin = zipfile.ZipFile(inp, 'r')
    rawf = open(inp, 'rb')
    items = []
    for zi in zin.infolist():
        rawf.seek(zi.header_offset)
        h = rawf.read(30)
        nl, el = struct.unpack('<HH', h[26:30])
        rawf.seek(zi.header_offset + 30 + nl + el)
        raw = rawf.read(zi.compress_size)
        items.append((zi, raw))
    rawf.close()
    zin.close()

    # pass 1: compute padding and offsets
    pos = 0
    plans = []
    for zi, data in items:
        name = zi.filename.encode('utf-8')
        extra = b''
        req = page if zi.filename.endswith('.so') else alignment
        if zi.compress_type == zipfile.ZIP_STORED and req > 1:
            off = pos + 30 + len(name)
            pad = (req - (off % req)) % req
            if pad:
                if pad < 4: pad += req
                extra = b'\x35\xd9' + struct.pack('<H', pad - 4) + b'\x00' * (pad - 4)
        hdr = 30 + len(name) + len(extra)
        plans.append({'zi': zi, 'data': data, 'name': name, 'extra': extra, 'off': pos, 'hdr': hdr})
        pos += hdr + len(data)

    out = bytearray()
    for p in plans:
        zi = p['zi']; data = p['data']; name = p['name']; extra = p['extra']
        t, d = dt(zi)
        flag = zi.flag_bits & ~0x08
        csize = len(data); usize = zi.file_size
        if csize != zi.compress_size: raise RuntimeError('size mismatch ' + zi.filename)
        if csize >= 0xFFFFFFFF or usize >= 0xFFFFFFFF:
            raise RuntimeError('zip64 not supported: ' + zi.filename)
        out += struct.pack('<IHHHHHIIIHH', 0x04034b50, 20, flag, zi.compress_type,
                           t, d, zi.CRC, csize, usize, len(name), len(extra))
        out += name + extra + data

    cd_start = len(out)
    for p in plans:
        zi = p['zi']; data = p['data']; name = p['name']; extra = p['extra']
        t, d = dt(zi)
        csize = len(data); usize = zi.file_size
        out += struct.pack('<IHHHHHHIIIHHHHHII', 0x02014b50, 20, 20, zi.flag_bits & ~0x08,
                           zi.compress_type, t, d, zi.CRC, csize, usize,
                           len(name), len(extra), 0, 0, 0, 0, p['off'])
        out += name + extra
    cd_size = len(out) - cd_start
    out += struct.pack('<IHHHHIIH', 0x06054b50, 0, 0, len(plans), len(plans), cd_size, cd_start, 0)
    open(outp, 'wb').write(out)

    bad = []
    with zipfile.ZipFile(outp) as z:
        for zi in z.infolist():
            if zi.compress_type == zipfile.ZIP_STORED:
                d = zi.header_offset + 30 + len(zi.filename.encode()) + len(zi.extra)
                req = page if zi.filename.endswith('.so') else alignment
                if d % req: bad.append((zi.filename, d % req))
    print('alignment:', 'OK' if not bad else bad)

if __name__ == '__main__':
    align_zip(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 4)
