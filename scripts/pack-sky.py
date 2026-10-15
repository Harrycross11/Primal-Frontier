"""Packs the photographed sky (art/sky.hdr, Poly Haven's "Wasteland Clouds", CC0) into a small
WebP the game downloads instead: client/public/textures/sky.webp.

The game only ever shows the sky above the horizon, at a fixed brightness, with the glow round
the photo's sun squashed (see skyDome in client/src/graphics.ts). So this keeps the top half of
the photo and bakes that brightness and squash in. What is left still runs above white, which an
ordinary image cannot hold, so each value c is stored as c / (1 + c) and the shader undoes it
with x / (1 - x). The result is about a tenth the size of the HDR file. Needs Pillow and numpy.

    python3 scripts/pack-sky.py
"""

import os
import struct

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
SOURCE = os.path.join(HERE, '..', 'art', 'sky.hdr')
OUT = os.path.join(HERE, '..', 'client', 'public', 'textures', 'sky.webp')
# Must match PHOTO_EXPOSURE and the squash in graphics.ts.
EXPOSURE = 0.3
SQUASH = 0.12


def read_hdr(path: str) -> np.ndarray:
    """Radiance RGBE, run-length encoded by scanline, as float RGB rows (top row first)."""
    with open(path, 'rb') as f:
        data = f.read()
    at = 0
    while True:
        end = data.index(b'\n', at)
        line = data[at:end].decode('ascii')
        at = end + 1
        if line.startswith('-Y'):
            _, h, _, w = line.split()
            width, height = int(w), int(h)
            break
    rgbe = np.zeros((height, width, 4), np.uint8)
    for y in range(height):
        head = data[at:at + 4]
        if head[0] != 2 or head[1] != 2:
            raise ValueError('only run-length encoded scanlines are supported')
        at += 4
        for ch in range(4):
            x = 0
            row = rgbe[y, :, ch]
            while x < width:
                n = data[at]
                at += 1
                if n > 128:
                    n -= 128
                    row[x:x + n] = data[at]
                    at += 1
                else:
                    row[x:x + n] = np.frombuffer(data, np.uint8, n, at)
                    at += n
                x += n
    e = rgbe[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.ldexp(1.0, e - 136), 0.0)
    return rgbe[..., :3].astype(np.float64) * scale[..., None]


def srgb(x: np.ndarray) -> np.ndarray:
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def main():
    sky = read_hdr(SOURCE)
    sky = sky[: sky.shape[0] // 2] * EXPOSURE
    peak = sky.max(axis=2, keepdims=True)
    over = peak > 1
    sky = np.where(over, sky * (1 + (peak - 1) * SQUASH) / np.maximum(peak, 1e-9), sky)
    stored = srgb(sky / (1 + sky))
    img = Image.fromarray(np.clip(np.round(stored * 255), 0, 255).astype(np.uint8), 'RGB')
    img.save(OUT, quality=95, method=6, use_sharp_yuv=True)
    print(f'{os.path.basename(OUT)}: {img.width}x{img.height}, {os.path.getsize(OUT) // 1024} KB')


if __name__ == '__main__':
    main()
