"""Converts the rug photos in dev/photos to raw RGBA for the dev tests.

Each photo.jpg/.png becomes photo.raw: u32 width, u32 height (little-endian),
then RGBA bytes, shrunk to 1800 px on the long side as the app does before
analysing. Needs Pillow (pip install pillow).

    python dev/to-raw.py
"""
import pathlib
import struct

from PIL import Image

SIDE = 1800
folder = pathlib.Path(__file__).parent / "photos"
for photo in sorted(folder.iterdir()):
    if photo.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
        continue
    raw = photo.with_suffix(".raw")
    if raw.exists() and raw.stat().st_mtime >= photo.stat().st_mtime:
        continue
    im = Image.open(photo).convert("RGBA")
    k = min(1.0, SIDE / max(im.size))
    if k < 1:
        im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    with open(raw, "wb") as f:
        f.write(struct.pack("<II", im.width, im.height))
        f.write(im.tobytes())
    print(f"{photo.name} -> {raw.name} {im.size}")
