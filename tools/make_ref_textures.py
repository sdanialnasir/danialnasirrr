#!/usr/bin/env python3
"""Cut the sand and reef-rock textures out of the owner's reference picture (the arrival concept, 1672x941) and make them tile.
Usage: python3 tools/make_ref_textures.py path/to/04_arrival_landscape.png
Writes src/assets/images/tex/sand_ref.webp (512 px, seamless). build_assets.py embeds them as AQ_DATA.TEX."""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); OUT = os.path.join(ROOT, 'src', 'assets', 'images', 'tex')

def seamless(a, blend=0.5):
    """offset-and-blend: the patch shifted by half its size is laid over a soft cross mask, so the wrap seams disappear"""
    h, w = a.shape[:2]; b = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    y = np.abs(np.linspace(-1, 1, h))[:, None]; x = np.abs(np.linspace(-1, 1, w))[None, :]
    m = np.clip((np.maximum(x, y) - (1 - blend)) / blend, 0, 1) ** 1.5   # 1 near the patch edges (where a has seams after wrapping) -> use b there
    m = m[..., None]; return a * (1 - m) + b * m

def main():
    im = Image.open(sys.argv[1]).convert('RGB'); W, H = im.size; s = W / 1672
    box = lambda x0, y0, x1, y1: tuple(int(v * s) for v in (x0, y0, x1, y1))
    os.makedirs(OUT, exist_ok=True)
    # sand: the big top-left block, inside its rounded edges, left of the starfish
    sand = np.asarray(im.crop(box(98, 148, 236, 300)).resize((512, 512), Image.LANCZOS), np.float32)
    sand = seamless(sand, 0.45)
    Image.fromarray(np.clip(sand, 0, 255).astype(np.uint8)).save(os.path.join(OUT, 'sand_ref.webp'), quality=90)
    # (the rock texture is drawn in game.js in the reference's palette: the reference's rock area was too small to tile cleanly)
    print('wrote', os.listdir(OUT))
if __name__ == '__main__': main()
