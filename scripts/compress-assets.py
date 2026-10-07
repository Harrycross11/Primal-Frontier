"""Shrinks the game's downloads: every .glb in client/public/models gets WebP textures and
Draco-compressed meshes, and the photo textures in client/public/textures become WebP.

The game loads everything before you can play, so this cuts the wait several times over with
no visible change. Already-compressed files are skipped, so it is safe to run again after
fetching new models or textures (the fetch scripts run it themselves). Needs Pillow and
Node (it runs gltf-transform through npx, which downloads it the first time).

    python3 scripts/compress-assets.py
"""

import glob
import os
import subprocess
import tempfile

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public')
GLTF = ['npx', '--yes', '@gltf-transform/cli@4']


def compressed(glb: str) -> bool:
    with open(glb, 'rb') as f:
        head = f.read(20000)
    return b'KHR_draco_mesh_compression' in head


def models():
    for glb in sorted(glob.glob(os.path.join(ROOT, 'models', '*.glb'))):
        if compressed(glb):
            continue
        before = os.path.getsize(glb)
        with tempfile.TemporaryDirectory() as tmp:
            webp = os.path.join(tmp, 'webp.glb')
            subprocess.run([*GLTF, 'webp', glb, webp, '--quality', '85'], check=True, capture_output=True)
            subprocess.run([*GLTF, 'draco', webp, glb], check=True, capture_output=True)
        print(f'{os.path.basename(glb)}: {before // 1024} KB -> {os.path.getsize(glb) // 1024} KB')


def textures():
    for jpg in sorted(glob.glob(os.path.join(ROOT, 'textures', '*.jpg'))):
        out = jpg[:-4] + '.webp'
        img = Image.open(jpg)
        kind = jpg[:-4].rsplit('_', 1)[1]
        # Roughness is soft detail, so it is kept at half size; normal maps keep the most
        # quality, as their errors show up as false bumps in the lighting.
        if kind == 'rough' and img.width > 1024:
            img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
        img.save(out, quality={'nor': 82, 'diff': 78}.get(kind, 70), method=6)
        print(f'{os.path.basename(jpg)}: {os.path.getsize(jpg) // 1024} KB -> {os.path.getsize(out) // 1024} KB')
        os.remove(jpg)


if __name__ == '__main__':
    models()
    textures()
