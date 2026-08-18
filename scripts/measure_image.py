#!/usr/bin/env python3
"""Print original pixel size as JSON: {"width": W, "height": H}

Usage:
  python3 scripts/measure_image.py screenshot.png
"""
from __future__ import annotations

import json
import struct
import subprocess
import sys
from pathlib import Path


def png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    w, h = struct.unpack(">II", data[16:24])
    return w, h


def jpeg_size(data: bytes) -> tuple[int, int] | None:
    if data[:2] != b"\xff\xd8":
        return None
    i, n = 2, len(data)
    while i + 9 <= n:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if marker == 0xD9:
            break
        seglen = struct.unpack(">H", data[i + 2 : i + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5 : i + 9])
            return w, h
        i += 2 + seglen
    return None


def webp_size(data: bytes) -> tuple[int, int] | None:
    if data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    kind = data[12:16]
    if kind == b"VP8X" and len(data) >= 30:
        w = 1 + int.from_bytes(data[24:27], "little")
        h = 1 + int.from_bytes(data[27:30], "little")
        return w, h
    if kind == b"VP8 " and len(data) >= 30:
        w = struct.unpack("<H", data[26:28])[0] & 0x3FFF
        h = struct.unpack("<H", data[28:30])[0] & 0x3FFF
        return w, h
    if kind == b"VP8L" and len(data) >= 25:
        bits = struct.unpack("<I", data[21:25])[0]
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    return None


def sips_size(path: Path) -> tuple[int, int] | None:
    try:
        out = subprocess.check_output(
            ["sips", "-g", "pixelWidth", "-g", "pixelHeight", str(path)],
            text=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    w = h = None
    for line in out.splitlines():
        if "pixelWidth" in line:
            w = int(line.split()[-1])
        if "pixelHeight" in line:
            h = int(line.split()[-1])
    if w and h:
        return w, h
    return None


def measure(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    for fn in (png_size, jpeg_size, webp_size):
        size = fn(data)
        if size:
            return size
    try:
        from PIL import Image

        with Image.open(path) as im:
            return im.size
    except Exception:
        pass
    size = sips_size(path)
    if size:
        return size
    raise SystemExit(f"cannot read image size: {path}")


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: measure_image.py screenshot.png")
    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"not found: {path}")
    w, h = measure(path)
    print(json.dumps({"width": w, "height": h}, ensure_ascii=False))


if __name__ == "__main__":
    main()
