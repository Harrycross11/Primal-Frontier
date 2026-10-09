"""Shrinks the textures inside man-made models (guns, tools, landmarks, cars, gear, crates)
so the game downloads faster and fits in an ordinary laptop's graphics memory.

Colour maps keep up to 1024 pixels; normal, roughness and occlusion maps go down to 512,
as their detail barely shows at the size these models are seen. Natural scans (boulders,
rubble, ruins, logs, wrecks, plants) are left alone: they are big on screen and fill the
view up close. Only the images change; the meshes are copied over untouched, so there is
nothing to re-check in the game. Safe to run again: images already small enough are kept.

    python3 scripts/shrink-textures.py
"""

import glob
import io
import json
import os
import struct

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'models')
SHRINK = ('gun-', 'tool-', 'lm-', 'vehicle-', 'gear-', 'crate', 'barrel', 'tyre', 'plane', 'parachute')
COLOUR_MAX = 1024
DETAIL_MAX = 512


def slots(gltf):
    """Which kinds of map each image is used as."""
    use = {}

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
        mark(pbr.get('metallicRoughnessTexture'), 'detail')
        mark(m.get('normalTexture'), 'detail')
        mark(m.get('occlusionTexture'), 'detail')
    return use


def shrink(path):
    data = open(path, 'rb').read()
    json_len = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + json_len])
    bin_start = 20 + json_len + 8
    bin_len = struct.unpack('<I', data[20 + json_len:24 + json_len])[0]
    blob = data[bin_start:bin_start + bin_len]
    use = slots(gltf)
    views = gltf['bufferViews']
    replaced = {}
    for i, image in enumerate(gltf.get('images', [])):
        if 'bufferView' not in image:
            continue
        kinds = use.get(i, {'colour'})
        limit = COLOUR_MAX if 'colour' in kinds else DETAIL_MAX
        view = views[image['bufferView']]
        start = view.get('byteOffset', 0)
        raw = blob[start:start + view['byteLength']]
        img = Image.open(io.BytesIO(raw))
        if max(img.size) <= limit:
            continue
        scale = limit / max(img.size)
        small = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
        out = io.BytesIO()
        if image.get('mimeType') == 'image/png':
            small.save(out, 'PNG', optimize=True)
        elif image.get('mimeType') == 'image/jpeg':
            small.convert('RGB').save(out, 'JPEG', quality=88)
        else:
            small.save(out, 'WEBP', quality=85, method=6)
        replaced[image['bufferView']] = out.getvalue()
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


if __name__ == '__main__':
    before = after = 0
    for glb in sorted(glob.glob(os.path.join(ROOT, '*.glb'))):
        if not os.path.basename(glb).startswith(SHRINK):
            continue
        sizes = shrink(glb)
        if sizes:
            before += sizes[0]
            after += sizes[1]
            print(f'{os.path.basename(glb)}: {sizes[0] // 1024} KB -> {sizes[1] // 1024} KB')
    print(f'total: {before // 1024 // 1024} MB -> {after // 1024 // 1024} MB')
