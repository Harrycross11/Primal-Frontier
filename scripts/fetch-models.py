"""Downloads photo-scanned CC0 models from Poly Haven into client/public/models as .glb files.

Scans come with far more triangles than a game can draw hundreds of times, so each one is
simplified to roughly the triangle budget below with gltf-transform (fetched by npx); the
normal map keeps the fine surface detail. The output is committed, so this only needs running
again to change or add a model. Needs Node (npx) and network access to Poly Haven.

    python3 scripts/fetch-models.py            # every model
    python3 scripts/fetch-models.py tyre log   # just these
"""

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


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'primal-frontier-fetch'})
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
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write('# Models\n\nPhoto-scanned models from Poly Haven, all CC0 (public domain), simplified for the game.\n\n' + '\n'.join(credits) + '\n')


if __name__ == '__main__':
    main()
