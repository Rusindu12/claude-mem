#!/usr/bin/env python3
"""
Generates high-resolution brand assets for NEXORA AI:
- icon.png (1024x1024)
- adaptive-icon.png (1024x1024)
- splash.png (1284x2778)
- favicon.png (192x192)
Theme: Deep Obsidian Black (#05050A) with Royal Purple (#8B5CF6) & Electric Blue (#00D4FF) neural N prism.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter


def lerp_color(c1, c2, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(len(c1)))


def draw_nexora_emblem(canvas_w: int, canvas_h: int, scale: float = 1.0, include_outer_frame: bool = True) -> Image.Image:
    # Supersample 2x for crisp anti-aliasing
    ss = 2
    w, h = canvas_w * ss, canvas_h * ss
    cx, cy = w // 2, h // 2
    unit = int(min(w, h) * 0.34 * scale)

    base = Image.new("RGBA", (w, h), (5, 5, 10, 255))

    # Ambient radial aurora glow (purple top-left, electric blue bottom-right)
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    r_max = int(unit * 1.65)
    for step in range(40, 0, -1):
        frac = step / 40.0
        rad = int(r_max * frac)
        alpha = int(38 * (1.0 - frac) ** 1.6)
        gdraw.ellipse(
            (cx - int(unit * 0.28) - rad, cy - int(unit * 0.24) - rad,
             cx - int(unit * 0.28) + rad, cy - int(unit * 0.24) + rad),
            fill=(139, 92, 246, alpha),
        )
        gdraw.ellipse(
            (cx + int(unit * 0.28) - rad, cy + int(unit * 0.24) - rad,
             cx + int(unit * 0.28) + rad, cy + int(unit * 0.24) + rad),
            fill=(0, 212, 255, alpha),
        )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=int(unit * 0.18)))
    base = Image.alpha_composite(base, glow)

    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    purple = (139, 92, 246, 255)
    electric = (0, 212, 255, 255)
    white_glow = (232, 245, 255, 255)

    # Hexagonal neural ring
    if include_outer_frame:
        hex_r = int(unit * 1.12)
        hex_pts = []
        for i in range(6):
            ang = math.radians(60 * i - 30)
            hex_pts.append((cx + int(hex_r * math.cos(ang)), cy + int(hex_r * math.sin(ang))))
        for i in range(6):
            p1 = hex_pts[i]
            p2 = hex_pts[(i + 1) % 6]
            col = lerp_color(purple, electric, i / 5.0)
            draw.line([p1, p2], fill=(col[0], col[1], col[2], 150), width=max(4, int(unit * 0.035)))

        # Subtle inner dark glass octagon plate
        inner_r = int(unit * 0.98)
        inner_pts = [
            (cx + int(inner_r * math.cos(math.radians(60 * i - 30))),
             cy + int(inner_r * math.sin(math.radians(60 * i - 30))))
            for i in range(6)
        ]
        draw.polygon(inner_pts, fill=(11, 12, 24, 215))

    # Geometric futuristic "N" Ribbon + Neural Nodes
    nx_left = cx - int(unit * 0.48)
    nx_right = cx + int(unit * 0.48)
    ny_top = cy - int(unit * 0.54)
    ny_bot = cy + int(unit * 0.54)
    stroke = max(10, int(unit * 0.21))

    # Left vertical pillar (Purple -> Violet-Blue)
    steps = 80
    for i in range(steps):
        t = i / (steps - 1)
        y = int(ny_bot + (ny_top - ny_bot) * t)
        col = lerp_color(purple, (110, 130, 252, 255), t)
        r = stroke // 2
        draw.ellipse((nx_left - r, y - r, nx_left + r, y + r), fill=col)

    # Right vertical pillar (Purple-Blue -> Electric Cyan)
    for i in range(steps):
        t = i / (steps - 1)
        y = int(ny_top + (ny_bot - ny_top) * t)
        col = lerp_color((90, 150, 255, 255), electric, t)
        r = stroke // 2
        draw.ellipse((nx_right - r, y - r, nx_right + r, y + r), fill=col)

    # Diagonal energy bridge (Top-Left to Bottom-Right) with luminous gradient
    diag_steps = 110
    for i in range(diag_steps):
        t = i / (diag_steps - 1)
        x = int(nx_left + (nx_right - nx_left) * t)
        y = int(ny_top + (ny_bot - ny_top) * t)
        col = lerp_color(purple, electric, t)
        r = int(stroke * 0.52)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=col)

    # Crisp inner highlight spine along diagonal
    for i in range(diag_steps):
        t = i / (diag_steps - 1)
        x = int(nx_left + (nx_right - nx_left) * t)
        y = int(ny_top + (ny_bot - ny_top) * t)
        r = max(2, int(stroke * 0.13))
        alpha = int(190 * math.sin(math.pi * t))
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(235, 248, 255, alpha))

    # Neural node vertices (4 glowing AI synapses)
    nodes = [
        (nx_left, ny_top, purple),
        (nx_left, ny_bot, (124, 108, 248, 255)),
        (nx_right, ny_top, (56, 189, 248, 255)),
        (nx_right, ny_bot, electric),
        (cx, cy, white_glow),
    ]
    for (px, py, ncol) in nodes:
        nr = int(stroke * (0.42 if (px, py) == (cx, cy) else 0.56))
        draw.ellipse((px - nr, py - nr, px + nr, py + nr), fill=ncol)
        ir = max(3, int(nr * 0.45))
        draw.ellipse((px - ir, py - ir, px + ir, py + ir), fill=white_glow)

    # Soft neon bloom pass
    bloom = layer.filter(ImageFilter.GaussianBlur(radius=max(4, int(unit * 0.09))))
    out = Image.alpha_composite(base, bloom)
    out = Image.alpha_composite(out, layer)

    return out.resize((canvas_w, canvas_h), Image.Resampling.LANCZOS).convert("RGB")


def main():
    out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "mobile", "assets")
    os.makedirs(out_dir, exist_ok=True)

    icon = draw_nexora_emblem(1024, 1024, scale=1.0, include_outer_frame=True)
    icon.save(os.path.join(out_dir, "icon.png"), "PNG", optimize=True)

    # Android adaptive icon keeps emblem inside inner 66% safe zone
    adaptive = draw_nexora_emblem(1024, 1024, scale=0.74, include_outer_frame=True)
    adaptive.save(os.path.join(out_dir, "adaptive-icon.png"), "PNG", optimize=True)

    # Splash screen (1284x2778 portrait)
    splash = draw_nexora_emblem(1284, 2778, scale=0.68, include_outer_frame=True)
    splash.save(os.path.join(out_dir, "splash.png"), "PNG", optimize=True)

    # Web favicon (192x192)
    favicon = icon.resize((192, 192), Image.Resampling.LANCZOS)
    favicon.save(os.path.join(out_dir, "favicon.png"), "PNG", optimize=True)
    print("Generated icon.png, adaptive-icon.png, splash.png, favicon.png successfully.")


if __name__ == "__main__":
    main()
