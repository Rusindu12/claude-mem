#!/usr/bin/env python3
"""Generate launcher icons + adaptive layers + banner for the CryptoAI PRO APK.

Pure stdlib (no Pillow): draws the mark (gold rounded square, dark "A" chevron,
upward trend line + spark) at 4x supersampling and writes PNGs with zlib.
Run: python3 scripts/make_icons.py
"""
import os
import struct
import zlib

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "src", "main", "res")
GOLD = (240, 185, 11)
GOLD_HI = (255, 214, 64)
DARK = (10, 14, 23)
UP = (14, 203, 129)
SS = 4  # supersample factor


class Img:
    def __init__(self, w, h, bg=None):
        self.w, self.h = w, h
        self.px = bytearray(w * h * 4)
        if bg is not None:
            rgba = bytes(bg) + b"\xff"
            self.px = bytearray(rgba * (w * h))

    def blend(self, x, y, col, a=1.0):
        if x < 0 or y < 0 or x >= self.w or y >= self.h or a <= 0:
            return
        i = (y * self.w + x) * 4
        r, g, b, sa = col[0], col[1], col[2], min(1.0, a)
        da = self.px[i + 3] / 255.0
        oa = sa + da * (1 - sa)
        if oa <= 0:
            return
        for k in range(3):
            self.px[i + k] = int((col[k] * sa + self.px[i + k] * da * (1 - sa)) / oa)
        self.px[i + 3] = int(oa * 255)

    def downscale(self, f):
        w, h = self.w // f, self.h // f
        out = Img(w, h)
        for y in range(h):
            for x in range(w):
                r = g = b = a = 0
                for dy in range(f):
                    base = ((y * f + dy) * self.w + x * f) * 4
                    for dx in range(f):
                        i = base + dx * 4
                        al = self.px[i + 3]
                        r += self.px[i] * al
                        g += self.px[i + 1] * al
                        b += self.px[i + 2] * al
                        a += al
                n = f * f
                o = (y * w + x) * 4
                if a:
                    out.px[o] = min(255, int(r / a))
                    out.px[o + 1] = min(255, int(g / a))
                    out.px[o + 2] = min(255, int(b / a))
                out.px[o + 3] = min(255, int(a / n))
        return out

    def save(self, path):
        raw = bytearray()
        stride = self.w * 4
        for y in range(self.h):
            raw.append(0)
            raw.extend(self.px[y * stride:(y + 1) * stride])

        def chunk(tag, data):
            c = struct.pack(">I", len(data)) + tag + data
            return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(png)


def rounded_rect(img, x0, y0, x1, y1, r, col):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            dx = max(x0 + r - x, 0, x - (x1 - r - 1))
            dy = max(y0 + r - y, 0, y - (y1 - r - 1))
            if dx * dx + dy * dy <= r * r:
                img.blend(x, y, col)


def thick_line(img, x0, y0, x1, y1, w, col):
    steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
    for i in range(steps + 1):
        t = i / steps
        cx, cy = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
        rr = w / 2.0
        for yy in range(int(cy - rr) - 1, int(cy + rr) + 2):
            for xx in range(int(cx - rr) - 1, int(cx + rr) + 2):
                d = (xx - cx) ** 2 + (yy - cy) ** 2
                if d <= rr * rr:
                    img.blend(xx, yy, col)


def disc(img, cx, cy, r, col):
    for y in range(int(cy - r) - 1, int(cy + r) + 2):
        for x in range(int(cx - r) - 1, int(cx + r) + 2):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                img.blend(x, y, col)


def draw_mark(size, rounded=0.22, transparent_bg=False, pad=0.0):
    """Gold rounded square + dark chevron A + green trend line + spark."""
    S = size * SS
    img = Img(S, S, None if transparent_bg else DARK)
    p = S * pad
    box = (p, p, S - p, S - p)
    r = (box[2] - box[0]) * rounded

    # gold plate with vertical gradient
    tmp = Img(S, S)
    rounded_rect(tmp, box[0], box[1], box[2], box[3], r, GOLD)
    for y in range(S):
        t = y / max(1, S - 1)
        for x in range(S):
            i = (y * S + x) * 4
            if tmp.px[i + 3]:
                col = (int(GOLD[0] + (GOLD_HI[0] - GOLD[0]) * (1 - t)),
                       int(GOLD[1] + (GOLD_HI[1] - GOLD[1]) * (1 - t)),
                       int(GOLD[2] + (GOLD_HI[2] - GOLD[2]) * (1 - t)))
                for k in range(3):
                    img.px[i + k] = col[k]
                img.px[i + 3] = tmp.px[i + 3]

    cx, cy = S / 2, S / 2
    u = S / 100.0  # unit = 1% of canvas
    stroke = 8.5 * u

    # chevron "A"
    thick_line(img, cx - 17 * u, cy + 20 * u, cx, cy - 20 * u, stroke, DARK)
    thick_line(img, cx, cy - 20 * u, cx + 17 * u, cy + 20 * u, stroke, DARK)
    # crossbar
    thick_line(img, cx - 9.5 * u, cy + 5 * u, cx + 9.5 * u, cy + 5 * u, stroke * 0.8, DARK)

    # trend line + spark inside lower right
    thick_line(img, cx - 16 * u, cy + 30 * u, cx - 4 * u, cy + 22 * u, 4.6 * u, UP)
    thick_line(img, cx - 4 * u, cy + 22 * u, cx + 5 * u, cy + 27 * u, 4.6 * u, UP)
    thick_line(img, cx + 5 * u, cy + 27 * u, cx + 17 * u, cy + 17 * u, 4.6 * u, UP)
    disc(img, cx + 17 * u, cy + 17 * u, 3.6 * u, UP)

    return img.downscale(SS)


def flat_layer(size, col):
    S = size * SS
    img = Img(S, S, col)
    return img.downscale(SS)


def adaptive_foreground(size):
    """Foreground sits in the safe 66% zone of the adaptive canvas."""
    S = size * SS
    img = Img(S, S)
    mark = draw_mark(size, rounded=0.30, transparent_bg=True, pad=0.235)
    # upsample-free copy of the mark into the canvas
    for y in range(size):
        for x in range(size):
            si = (y * size + x) * 4
            a = mark.px[si + 3]
            if a:
                for dy in range(SS):
                    for dx in range(SS):
                        di = ((y * SS + dy) * S + x * SS + dx) * 4
                        img.px[di:di + 4] = mark.px[si:si + 4]
    return img.downscale(SS)


def banner():
    W, H = 1024 * 2, 500 * 2
    img = Img(W, H, DARK)
    # subtle grid
    for y in range(0, H, 40):
        for x in range(W):
            img.blend(x, y, (24, 34, 54), 0.6)
    mark = draw_mark(320, rounded=0.24, transparent_bg=True)
    ox, oy = 90 * 2, (H - 320) // 2
    for y in range(320):
        for x in range(320):
            si = (y * 320 + x) * 4
            if mark.px[si + 3]:
                for k in range(3):
                    img.px[((oy + y) * W + ox + x) * 4 + k] = mark.px[si + k]
                img.px[((oy + y) * W + ox + x) * 4 + 3] = 255
    # candles
    import random
    rnd = random.Random(7)
    bx = 520 * 2
    for i in range(9):
        h = rnd.randint(60, 260)
        x = bx + i * 46 * 2
        y0 = H // 2 - h // 2
        col = UP if i % 3 else (246, 70, 93)
        rounded_rect(img, x, y0, x + 16 * 2, y0 + h, 6, col)
        thick_line(img, x + 16, y0 - 30, x + 16, y0 + h + 30, 4, col)
    return img.downscale(2)


def main():
    sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for dens, px in sizes.items():
        d = os.path.join(BASE, "mipmap-" + dens)
        draw_mark(px).save(os.path.join(d, "ic_launcher.png"))
        # round icon: same mark on a circular clip
        rnd_img = Img(px * SS, px * SS)
        src = draw_mark(px, rounded=0.5)
        for y in range(px):
            for x in range(px):
                si = (y * px + x) * 4
                if src.px[si + 3]:
                    for dy in range(SS):
                        for dx in range(SS):
                            di = ((y * SS + dy) * px * SS + x * SS + dx) * 4
                            rnd_img.px[di:di + 4] = src.px[si:si + 4]
        rnd_img.downscale(SS).save(os.path.join(d, "ic_launcher_round.png"))
        adaptive_foreground(px * 2).save(os.path.join(d, "ic_launcher_foreground.png"))
        flat_layer(px * 2, DARK).save(os.path.join(d, "ic_launcher_background.png"))

    banner().save(os.path.join(BASE, "..", "..", "..", "..", "docs", "banner.png"))
    print("icons written to", BASE)


if __name__ == "__main__":
    main()
