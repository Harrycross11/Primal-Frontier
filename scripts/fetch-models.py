"""Downloads photo-scanned models into client/public/models as .glb files: CC0 ones from Poly Haven
and CC-BY raw scans from Sketchfab (credited in CREDITS.md).

Scans come with far more triangles than a game can draw hundreds of times, so each one is
simplified to roughly the triangle budget below with gltf-transform (fetched by npx); the
normal map keeps the fine surface detail. The output is committed, so this only needs running
again to change or add a model. Needs Node (npx, and `npm install` for the Sketchfab scans) and
network access to Poly Haven and Sketchfab. Sketchfab downloads need an account token: set
SKETCHFAB_TOKEN, unless a proxy already adds it.

    python3 scripts/fetch-models.py            # every model
    python3 scripts/fetch-models.py tyre log   # just these
"""

import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'models')
CLI = ['npx', '--yes', '@gltf-transform/cli@4']

# Our name: (Poly Haven asset, target triangles).
MODELS = {
    'boulder-a': ('namaqualand_boulder_02', 4000),
    'boulder-b': ('namaqualand_boulder_03', 4000),
    'boulder-c': ('namaqualand_boulder_04', 4000),
    'boulder-d': ('namaqualand_boulder_05', 4000),
    'boulder-e': ('namaqualand_boulder_06', 4000),
    'log': ('dead_tree_trunk_02', 6000),
    'barrel': ('barrel_03', 3000),
    'tyre': ('old_tyre', 2000),
    # Ground cover, drawn many times over, so kept light.
    'dry-grass': ('grass_medium_02', 1500),
    'dry-bush': ('wild_rooibos_bush', 2500),
    'branches': ('dry_branches_medium_01', 1500),
    'dead-branch': ('dead_quiver_branch_01', 1500),
    'stones': ('namaqualand_stones_01', 1500),
    'stump': ('tree_stump_01', 2000),
}

# Raw Sketchfab scans (millions of triangles), cut down by scripts/simplify-scan.ts.
# Our name: (Sketchfab model uid, target triangles).
SCANS = {
    'wreck-a': ('483fe7f26336463fba66638ca4200c5a', 8000),
    'wreck-b': ('263fd595fa4a45e988d5c6e236cbf293', 8000),
    'wreck-c': ('b1902df910524c13995865a9858fa99e', 8000),
    'wreck-d': ('222688561ba74a638c51a8af36ad0255', 8000),
    'wreck-e': ('916b51c7e5644eb2a6c9b3797ebb08cf', 8000),
    'wreck-f': ('b64174d7bea644a7b86f8d1aa980dc51', 8000),
}

# Rigged Sketchfab characters, saved as they come (the game animates their skeletons itself).
CHARACTERS = {
    'survivor': 'f56ffc64d18c40cf95d17559542ca44c',
}

# Game-ready Sketchfab models for held weapons and tools: kept as modelled, with their textures
# shrunk to at most 1024 px (needs Pillow). Named after the item they replace.
PROPS = {
    'gun-assaultRifle': 'dc58144409534abbb60970638d171f9f',
    'gun-boltRifle': '92ede39f23bd40c7982c727dfd7c4be0',
    'gun-l96': '34611493b4104bdba2ce6beabfeb4465',
    'gun-revolver': 'a44fb0c205114af4bd58ed79aa1d2f57',
    'gun-pumpShotgun': '26e37df4c38c4e8a9da8adeb4b66bff6',
    'gun-mp5': '60ec470e41ff47368c792dd6caa74529',
    'gun-semiPistol': '6fd5b49b34fe4af796e930401cff15f6',
    'gun-thompson': 'bbeb0c969a084525940c27bbaccb666c',
    'gun-doubleBarrel': '04741a40f2224cffafc343b0236d5bbe',
    'gun-m249': 'b1e60faa37de4461822103fe38e5c9ce',
    'gun-lr300': 'ac375d2498bd4a59a23a878312b6ac43',
    'gun-semiRifle': 'ada722d492344cba8633be150eea7e85',
    'tool-salvagedAxe': '30c5a2054fd9469796c0771dc52a0fa0',
    'tool-salvagedPickaxe': '83e334fc83ed4bb19592154e60e529c5',
}


def slim_textures(glb: bytes, size: int = 1024) -> bytes:
    """Re-encodes a .glb's embedded images at most `size` px wide: JPEG, or PNG where there is alpha."""
    from PIL import Image

    length = struct.unpack_from('<I', glb, 12)[0]
    doc = json.loads(glb[20:20 + length])
    binary = glb[20 + length + 8:]
    images = {img['bufferView']: img for img in doc.get('images', []) if 'bufferView' in img}
    out = bytearray()
    for i, view in enumerate(doc['bufferViews']):
        data = binary[view.get('byteOffset', 0):view.get('byteOffset', 0) + view['byteLength']]
        if i in images:
            im = Image.open(io.BytesIO(data))
            im.thumbnail((size, size), Image.LANCZOS)
            alpha = im.mode in ('RGBA', 'LA', 'P') and im.convert('RGBA').getextrema()[3][0] < 255
            buf = io.BytesIO()
            if alpha:
                im.convert('RGBA').save(buf, 'PNG', optimize=True)
                images[i]['mimeType'] = 'image/png'
            else:
                im.convert('RGB').save(buf, 'JPEG', quality=88)
                images[i]['mimeType'] = 'image/jpeg'
            data = buf.getvalue()
        while len(out) % 4:
            out.append(0)
        view['byteOffset'] = len(out)
        view['byteLength'] = len(data)
        out += data
    while len(out) % 4:
        out.append(0)
    doc['buffers'] = [{'byteLength': len(out)}]
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(out)
    return struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(text), 0x4E4F534A) + text + struct.pack('<II', len(out), 0x004E4942) + bytes(out)


def sketchfab_credit(name: str, uid: str, note: str) -> str:
    info = json.loads(get(f'https://api.sketchfab.com/v3/models/{uid}'))
    return (
        f'- {name}: "{info["name"]}" by {info["user"]["displayName"]} ({info["viewerUrl"]}), '
        f'licensed {info["license"]["label"]} ({info["license"]["url"]}), {note}'
    )


def get(url: str, auth: bool = False) -> bytes:
    headers = {'User-Agent': 'primal-frontier-fetch'}
    if auth and os.environ.get('SKETCHFAB_TOKEN'):
        headers['Authorization'] = f'Token {os.environ["SKETCHFAB_TOKEN"]}'
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as r:
        return r.read()


def triangles(path: str) -> int:
    with open(path, 'rb') as f:
        data = f.read()
    # A .glb is a 12-byte header, then a JSON chunk (length, type, body).
    length = struct.unpack_from('<I', data, 12)[0]
    doc = json.loads(data[20:20 + length])
    return sum(doc['accessors'][p['indices']]['count'] // 3 for m in doc['meshes'] for p in m['primitives'])


def main():
    os.makedirs(OUT, exist_ok=True)
    credits = [f'- {name}: https://polyhaven.com/a/{asset}' for name, (asset, _) in MODELS.items()]
    only = sys.argv[1:]
    for name, (asset, budget) in MODELS.items():
        if only and name not in only:
            continue
        every = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
        files = every['gltf']['1k']['gltf']
        # The glTF's colour maps are JPEGs with no alpha, so cut-out leaves come as a separate mask.
        if 'Alpha' in every:
            with open(os.path.join(OUT, f'{name}_alpha.jpg'), 'wb') as f:
                f.write(get(every['Alpha']['1k']['jpg']['url']))
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, f'{asset}.gltf')
            with open(src, 'wb') as f:
                f.write(get(files['url']))
            for rel, inc in files['include'].items():
                path = os.path.join(tmp, rel)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, 'wb') as f:
                    f.write(get(inc['url']))
            full = os.path.join(tmp, 'full.glb')
            subprocess.run(CLI + ['copy', src, full], check=True, capture_output=True)
            ratio = min(1.0, budget / max(1, triangles(full)))
            out = os.path.join(OUT, f'{name}.glb')
            subprocess.run(CLI + ['simplify', full, out, '--ratio', f'{ratio:.4f}', '--error', '0.01'], check=True, capture_output=True)
            print('saved', name, triangles(full), '->', triangles(out), 'triangles')
    scans = []
    for name, (uid, budget) in SCANS.items():
        scans.append(sketchfab_credit(name, uid, 'simplified'))
        if only and name not in only:
            continue
        link = json.loads(get(f'https://api.sketchfab.com/v3/models/{uid}/download', auth=True))
        with tempfile.TemporaryDirectory() as tmp:
            full = os.path.join(tmp, 'scan.glb')
            with open(full, 'wb') as f:
                f.write(get(link['glb']['url']))
            out = os.path.join(OUT, f'{name}.glb')
            result = subprocess.run(
                ['npx', 'tsx', os.path.join(os.path.dirname(__file__), 'simplify-scan.ts'), full, out, str(budget)],
                check=True, capture_output=True, text=True,
            )
            print('saved', name, result.stdout.strip())
    for name, uid in PROPS.items():
        scans.append(sketchfab_credit(name, uid, 'textures resized'))
        if only and name not in only:
            continue
        link = json.loads(get(f'https://api.sketchfab.com/v3/models/{uid}/download', auth=True))
        with open(os.path.join(OUT, f'{name}.glb'), 'wb') as f:
            f.write(slim_textures(get(link['glb']['url'])))
        print('saved', name)
    for name, uid in CHARACTERS.items():
        scans.append(sketchfab_credit(name, uid, 'animated by the game'))
        if only and name not in only:
            continue
        link = json.loads(get(f'https://api.sketchfab.com/v3/models/{uid}/download', auth=True))
        with open(os.path.join(OUT, f'{name}.glb'), 'wb') as f:
            f.write(get(link['glb']['url']))
        print('saved', name)
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write(
            '# Models\n\nPhoto-scanned models from Poly Haven, all CC0 (public domain), simplified for the game.\n\n'
            + '\n'.join(credits)
            + '\n\nModels from Sketchfab under Creative Commons Attribution: raw photo scans simplified and re-lit for the game, rigged characters, and weapons and tools.\n\n'
            + '\n'.join(scans)
            + '\n'
        )


if __name__ == '__main__':
    main()
