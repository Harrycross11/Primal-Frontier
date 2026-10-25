"""Re-saves every image the game downloads (inside the models in client/public/models, and the
photos in client/public/textures) as the smallest WebP that still looks the same as the one
there now, so the first load is shorter.

The images were saved at one fixed quality, which spends bytes on smooth or plain pictures that
need far fewer. This tries each image at a range of qualities and keeps the smallest whose pixels
stay within a set distance of what is there (peak signal-to-noise of at least TARGET decibels,
where above about 35 differences are hard to see even side by side). Colour and normal maps,
whose errors show as smudges or false bumps under light, are held closer than roughness and
occlusion maps. Alpha cut-outs are always kept lossless.

A few tiny props also have their maps scaled down (CAP), as they never cover more than a
handful of pixels on screen at full size.

Files done are listed with their new hash in scripts/repacked.json and skipped next time, so
running it again does not re-compress an image that was already compressed (and lose a little
each time). compress-assets.py runs it last, so the fetch scripts do too. Needs Pillow and numpy.

    python3 scripts/repack-images.py
"""

import glob
import hashlib
import io
import json
import os
import struct

import numpy as np
from PIL import Image

HERE = os.path.dirname(__file__)
PUBLIC = os.path.join(HERE, '..', 'client', 'public')
DONE = os.path.join(HERE, 'repacked.json')
# Smallest decibels kept, by what the image is used as.
TARGET = {'colour': 38.0, 'normal': 38.0, 'detail': 36.0}
# Biggest side kept for tiny props' maps: a 12 cm mushroom, pebbles, fist-sized rubble, grass tufts.
CAP = {'mushroom': 256, 'stones': 512, 'rubble-chunks': 512, 'dry-grass': 512, 'tyre': 512}
# Least saving worth replacing an image for.
MIN_SAVING = 0.04


def psnr(a: np.ndarray, b: np.ndarray) -> float:
    err = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return 99.0 if err == 0 else 10 * np.log10(255 ** 2 / err)


def repack(raw: bytes, kind: str, cap: int | None = None) -> bytes | None:
    """The smallest WebP of the image within its kind's target, or None if not worth it."""
    img = Image.open(io.BytesIO(raw))
    img.load()
    mode = 'RGBA' if 'A' in img.getbands() else 'RGB'
    img = img.convert(mode)
    scaled = False
    if cap and max(img.size) > cap:
        k = cap / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
        scaled = True
    if kind == 'mr':
        # Red is unused here: blanked, it costs nothing to store.
        r, g, b = img.split()[:3]
        img = Image.merge('RGB', (Image.new('L', img.size, 0), g, b))
        mode = 'RGB'
    ref = np.asarray(img)
    # Roughness and metalness live in green and blue; red only counts where it is occlusion.
    channels = slice(1, 3) if kind == 'mr' else slice(0, 3)
    target = TARGET.get(kind, TARGET['detail'])
    best = None
    lo, hi = 40, 95
    while lo <= hi:
        q = (lo + hi) // 2
        out = io.BytesIO()
        img.save(out, 'WEBP', quality=q, method=6, alpha_quality=100, exact=True)
        back = np.asarray(Image.open(io.BytesIO(out.getvalue())).convert(mode))
        if psnr(ref[..., channels], back[..., channels]) >= target:
            if best is None or len(out.getvalue()) < len(best):
                best = out.getvalue()
            hi = q - 1
        else:
            lo = q + 1
    if best is None:
        if not scaled:
            return None
        out = io.BytesIO()
        img.save(out, 'WEBP', quality=95, method=6, alpha_quality=100, exact=True)
        best = out.getvalue()
    if not scaled and len(best) > len(raw) * (1 - MIN_SAVING):
        return None
    return best


def kinds(gltf) -> dict[int, str]:
    """What each image is used as: colour, normal, mr (metal/roughness only) or detail."""
    use: dict[int, set[str]] = {}

    def mark(ref, kind):
        if not ref:
            return
        tex = gltf['textures'][ref['index']]
        src = tex.get('source')
        if src is None:
            src = next(iter(tex.get('extensions', {}).values()))['source']
        use.setdefault(src, set()).add(kind)

    for m in gltf.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        mark(pbr.get('baseColorTexture'), 'colour')
        mark(m.get('emissiveTexture'), 'colour')
        mark(m.get('normalTexture'), 'normal')
        mark(pbr.get('metallicRoughnessTexture'), 'mr')
        mark(m.get('occlusionTexture'), 'ao')
    out = {}
    for i, k in use.items():
        out[i] = 'colour' if 'colour' in k else 'normal' if 'normal' in k else 'mr' if k == {'mr'} else 'detail'
    return out


def model(path: str) -> tuple[int, int] | None:
    data = open(path, 'rb').read()
    json_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    bin_len = struct.unpack('<I', data[20 + json_len:24 + json_len])[0]
    blob = data[bin_start:bin_start + bin_len]
    use = kinds(gltf)
    views = gltf['bufferViews']
    cap = next((v for k, v in CAP.items() if os.path.basename(path)[:-4] == k), None)
    replaced = {}
    for i, image in enumerate(gltf.get('images', [])):
        if 'bufferView' not in image or image.get('mimeType') not in ('image/webp', 'image/png'):
            continue
        view = views[image['bufferView']]
        start = view.get('byteOffset', 0)
        out = repack(blob[start:start + view['byteLength']], use.get(i, 'detail'), cap)
        if out:
            replaced[image['bufferView']] = out
            # Browsers read the picture's own header, so a PNG slot can hold WebP.
            image['mimeType'] = 'image/webp'
    if not replaced:
        return None
    # Lay the binary chunk out again with the new images, keeping every other view's bytes.
    order = sorted(range(len(views)), key=lambda v: views[v].get('byteOffset', 0))
    new = bytearray()
    for v in order:
        view = views[v]
        start = view.get('byteOffset', 0)
        part = replaced.get(v, blob[start:start + view['byteLength']])
        new += b'\0' * (-len(new) % 4)
        view['byteOffset'] = len(new)
        view['byteLength'] = len(part)
        new += part
    new += b'\0' * (-len(new) % 4)
    gltf['buffers'][0]['byteLength'] = len(new)
    text = json.dumps(gltf, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(new)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
        f.write(struct.pack('<II', len(new), 0x004E4942) + bytes(new))
    return len(data), total


def photo(path: str) -> tuple[int, int] | None:
    raw = open(path, 'rb').read()
    kind = {'diff': 'colour', 'nor': 'normal'}.get(path[:-5].rsplit('_', 1)[-1], 'detail')
    out = repack(raw, kind)
    if not out:
        return None
    with open(path, 'wb') as f:
        f.write(out)
    return len(raw), len(out)


def sha(path: str) -> str:
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()


if __name__ == '__main__':
    done = json.load(open(DONE)) if os.path.exists(DONE) else {}
    files = sorted(glob.glob(os.path.join(PUBLIC, 'models', '*.glb')))
    # The sky is packed its own way (pack-sky.py).
    files += [p for p in sorted(glob.glob(os.path.join(PUBLIC, 'textures', '*.webp'))) if not p.endswith('sky.webp')]
    before = after = 0
    for path in files:
        name = os.path.relpath(path, PUBLIC)
        if done.get(name) == sha(path):
            continue
        sizes = model(path) if path.endswith('.glb') else photo(path)
        if sizes:
            before += sizes[0]
            after += sizes[1]
            print(f'{name}: {sizes[0] // 1024} KB -> {sizes[1] // 1024} KB', flush=True)
        done[name] = sha(path)
        with open(DONE, 'w') as f:
            json.dump(done, f, indent=1, sort_keys=True)
            f.write('\n')
    print(f'total: {before / 1e6:.1f} MB -> {after / 1e6:.1f} MB')
