#!/usr/bin/env python3
"""Draw a 10% coordinate grid on a screenshot for bbox calibration.

Read the output image (not the chat-compressed original preview) and fill
bbox_px using: x = left% / 100 * width, y = top% / 100 * height.

Usage:
  python3 scripts/make_grid.py screenshot.png -o /tmp/shot-grid.png
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.stderr.write("需要 Pillow: python3 -m pip install Pillow\n")
    raise SystemExit(1)


def font(size: int) -> ImageFont.ImageFont:
    for path in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("image")
    p.add_argument("-o", "--output", required=True)
    args = p.parse_args()
    src = Path(args.image)
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    f = font(max(12, min(w, h) // 48))
    major = (37, 99, 235, 170)
    minor = (37, 99, 235, 70)
    label_fill = (15, 23, 42, 220)

    for i in range(0, 21):
        x = round(i * w / 20)
        y = round(i * h / 20)
        col = major if i % 2 == 0 else minor
        draw.line([(x, 0), (x, h)], fill=col, width=1 if i % 2 else 2)
        draw.line([(0, y), (w, y)], fill=col, width=1 if i % 2 else 2)

    for i in range(0, 11):
        pct = i * 10
        x = round(i * w / 10)
        y = round(i * h / 10)
        text = str(pct)
        draw.text((min(w - 28, x + 3), 4), text, font=f, fill=label_fill)
        draw.text((4, min(h - 18, y + 3)), text, font=f, fill=label_fill)

    caption = f"{w}×{h}px  刻度为原图百分比，bbox_px=[L/100*W, T/100*H, WD/100*W, HT/100*H]"
    draw.rectangle([(0, h - 28), (w, h)], fill=(15, 23, 42, 200))
    draw.text((8, h - 22), caption, font=f, fill=(255, 255, 255, 255))

    out = Image.alpha_composite(im, overlay).convert("RGB")
    dest = Path(args.output)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest)
    print(json_dumps(w, h, dest))


def json_dumps(w: int, h: int, dest: Path) -> str:
    import json

    return json.dumps({"width": w, "height": h, "grid": str(dest)}, ensure_ascii=False)


if __name__ == "__main__":
    main()
