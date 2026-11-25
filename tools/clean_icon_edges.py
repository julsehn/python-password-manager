#!/usr/bin/env python3
"""Remove the baked-in edge rim from Icon Composer PNG exports.

Icon Composer renders a soft shadow/rim along the icon canvas edges. On a
light background that rim reads as a grey outline around the white tile. This
helper replaces the outer band with the local background colour while keeping
the original alpha, so the rounded silhouette stays clean at every size.
"""

from __future__ import annotations

import argparse
import statistics
from pathlib import Path

from PIL import Image, ImageFilter


def _pixels(image: Image.Image):
    if hasattr(image, "get_flattened_data"):
        return image.get_flattened_data()
    return image.getdata()


def _median_rgb(pixels) -> tuple[int, int, int]:
    pixels = [p[:3] for p in pixels if len(p) < 4 or p[3] > 250]
    if not pixels:
        return (255, 255, 255)
    return tuple(round(statistics.median(p[i] for p in pixels)) for i in range(3))


def edge_background(image: Image.Image, band: int) -> tuple[int, int, int]:
    width, height = image.size
    inset = min(band * 2, width // 4, height // 4)
    strips = [
        image.crop((inset, inset, width - inset, inset + band)),
        image.crop((inset, height - inset - band, width - inset, height - inset)),
        image.crop((inset, inset, inset + band, height - inset)),
        image.crop((width - inset - band, inset, width - inset, height - inset)),
    ]
    pixels = []
    for strip in strips:
        pixels.extend(_pixels(strip))
    return _median_rgb(pixels)


def clean(image: Image.Image, band_frac: float = 0.02, bg=None) -> Image.Image:
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    band = max(4, round(min(image.size) * band_frac))

    # Pad with transparency so the erosion also works along the straight canvas
    # edges; Pillow otherwise clamps at the border and never sees the outside.
    padded = Image.new("L", (image.width + 2 * band, image.height + 2 * band), 0)
    padded.paste(alpha, (band, band))
    inner = padded.filter(ImageFilter.MinFilter(band * 2 + 1)).crop(
        (band, band, band + image.width, band + image.height)
    )
    inner = inner.filter(ImageFilter.GaussianBlur(band / 3))
    mask = inner.point(lambda value: 255 - value)

    if bg is None:
        bg = edge_background(image, band)
    background = Image.new("RGBA", image.size, tuple(bg) + (255,))
    out = Image.composite(background, image, mask)
    out.putalpha(alpha)
    return out


def parse_color(value: str) -> tuple[int, int, int]:
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    if len(value) != 6:
        raise argparse.ArgumentTypeError("expected a hex colour such as #ffffff")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--band", type=float, default=0.02, help="edge band as a fraction of the icon size")
    parser.add_argument("--bg", type=parse_color, help="background colour; sampled automatically by default")
    parser.add_argument("--size", type=int, default=1024, help="resize before cleaning (0 keeps the source size)")
    args = parser.parse_args()

    source = Image.open(args.source)
    icc_profile = source.info.get("icc_profile")
    if args.size and max(source.size) > args.size:
        source = source.resize((args.size, args.size), Image.LANCZOS)

    cleaned = clean(source, band_frac=args.band, bg=args.bg)
    args.destination.parent.mkdir(parents=True, exist_ok=True)
    save_kwargs = {"optimize": True}
    if icc_profile:
        save_kwargs["icc_profile"] = icc_profile
    cleaned.save(args.destination, "PNG", **save_kwargs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
