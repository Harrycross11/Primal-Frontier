"""Downloads the photo-scanned CC0 textures and sky from Poly Haven into client/public.

The files are committed, so the game and its deploy never fetch anything at run time; this
script only needs running again to change or add a texture. Needs Pillow and numpy.

    python3 scripts/fetch-textures.py            (everything)
    python3 scripts/fetch-textures.py snow cliff (just those)
"""

import io
import json
import os
import subprocess
import sys
import urllib.request

from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'textures')

# Our name: (Poly Haven asset, resolution, neutral). Neutral surfaces are tinted by the game
# (cloth colours, ore types), so their colour map is made grey with this mean brightness.
SURFACES = {
    'ground': ('dry_ground_01', '2k', None),
    'dirt': ('dry_ground_rocks', '2k', None),
    'rock': ('rock_boulder_dry', '2k', 150),
    'bark': ('bark_willow_02', '1k', None),
    'bark-dark': ('pine_bark', '1k', None),
    'rust': ('rusty_metal_02', '1k', None),
    'sheet-metal': ('rusty_metal_sheet', '1k', None),
    'metal-plate': ('metal_plate', '1k', None),
    'concrete': ('concrete_wall_006', '1k', None),
    'stone-wall': ('stone_wall_04', '1k', None),
    'wood-wall': ('weathered_planks', '1k', None),
    'planks': ('weathered_brown_planks', '1k', None),
    'asphalt': ('asphalt_03', '1k', None),
    'cloth': ('hessian_230', '1k', 190),
    'leather': ('brown_leather', '1k', 190),
    'wood-grain': ('fine_grained_wood', '1k', 190),
    # The ground of each land, and bare rock for cliffs and steep slopes.
    'forest-floor': ('forrest_ground_01', '1k', None),
    'red-earth': ('red_laterite_soil_stones', '1k', None),
    'lake-bed': ('dry_mud_field_001', '1k', None),
    'snow': ('snow_02', '1k', None),
    'cliff': ('rock_face', '1k', None),
}
SKY = ('wasteland_clouds_puresky', '2k')
MAPS = {'diff': 'Diffuse', 'nor': 'nor_gl', 'rough': 'Rough'}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'primal-frontier-fetch'})
    with urllib.request.urlopen(req) as r:
        return r.read()


def neutral(img: Image.Image, target: int) -> Image.Image:
    grey = img.convert('L')
    mean = sum(i * n for i, n in enumerate(grey.histogram())) / (grey.width * grey.height)
    grey = grey.point(lambda v: min(255, round(v * target / mean)))
    return grey.convert('RGB')


def main():
    os.makedirs(OUT, exist_ok=True)
    credits = []
    only = sys.argv[1:]
    for name, (asset, res, grey) in SURFACES.items():
        credits.append(f'- {name}: https://polyhaven.com/a/{asset}')
        if only and name not in only:
            continue
        files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
        for short, key in MAPS.items():
            img = Image.open(io.BytesIO(get(files[key][res]['jpg']['url']))).convert('RGB')
            if short == 'diff' and grey:
                img = neutral(img, grey)
            if short == 'rough':
                img = img.convert('L')
            img.save(os.path.join(OUT, f'{name}_{short}.jpg'), quality=85 if short != 'nor' else 90, optimize=True)
        print('saved', name)
    asset, res = SKY
    if not only:
        files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
        with open(os.path.join(OUT, 'sky.hdr'), 'wb') as f:
            f.write(get(files['hdri'][res]['hdr']['url']))
    credits.append(f'- sky: https://polyhaven.com/a/{asset}')
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write('# Textures\n\nPhoto-scanned textures and sky from Poly Haven, all CC0 (public domain).\n\n' + '\n'.join(credits) + '\n')
    print('saved sky')


if __name__ == '__main__':
    main()
    # Shrink what was just fetched for download (WebP textures, Draco meshes).
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), 'compress-assets.py')], check=True)
