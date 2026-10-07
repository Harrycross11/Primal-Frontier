"""Downloads real recorded sounds for each weapon and tool into client/public/sounds as short mp3s.

Every sound comes from Freesound under CC0 (public domain); each is credited in CREDITS.md
anyway. Each recording is cut down to the one shot, swing or hit the game needs: the cut
starts on the first sharp attack after the given time, fades out at the end, and is
normalised. The output is committed, so this only needs running again to change a sound.
Needs ffmpeg, numpy and network access to freesound.org.

    python3 scripts/fetch-sounds.py                 # every sound
    python3 scripts/fetch-sounds.py shot-l96        # just these
"""

from html import unescape
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

import numpy as np

OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'sounds')
RATE = 44100

# Our name: (Freesound preview, seconds in to look for the attack, seconds to keep).
SOUNDS = {
    # Gunshots, each a recording of that kind of gun (or the nearest one recorded).
    'shot-eoka': ('675618_2524442', 0.0, 1.6),  # flintlock: the flint strike, then the charge
    'shot-waterpipe': ('427595_3094998', 0.2, 1.4),  # 20 gauge shotgun
    'shot-revolver': ('683175_3692246', 0.0, 2.0),  # .357 Magnum revolver
    'shot-semiPistol': ('427592_3094998', 0.0, 1.4),  # 9 mm pistol
    'shot-doubleBarrel': ('473846_6142149', 0.0, 1.8),  # shotgun
    'shot-pumpShotgun': ('159710_2886479', 0.0, 2.3),  # Mossberg 500, shot and pump
    'shot-thompson': ('258198_4675419', 0.0, 0.23),  # Thompson SMG
    'shot-customSmg': ('258257_4675419', 0.0, 0.22),  # M3 grease gun
    'shot-mp5': ('201671_3749344', 0.0, 0.095),  # MP5, the first round of a burst
    'shot-semiRifle': ('386842_932959', 0.0, 2.2),  # M1 Garand
    'shot-lr300': ('427596_3094998', 0.0, 2.0),  # AR-15
    'shot-assaultRifle': ('520934_773642', 0.9, 0.85),  # AK-47
    'shot-m249': ('165394_2989529', 0.0, 0.12),  # heavy machine gun, the first round of a burst
    'shot-boltRifle': ('410442_7542558', 0.0, 2.6),  # Lee-Enfield
    'shot-l96': ('351777_2863152', 1.3, 2.55),  # M24 sniper rifle
    'shot-huntingBow': ('384917_984733', 0.3, 0.5),  # recurve bow release
    'shot-crossbow': ('561475_12429869', 0.0, 1.15),
    'shot-compoundBow': ('179996_3033176', 0.25, 0.17),  # bow release, cut before the arrow lands
    'shot-m1911': ('740897_15072041', 0.0, 1.8),  # Colt 1911
    'shot-deagle': ('712310_15072041', 0.0, 1.2),  # Desert Eagle
    'shot-ump45': ('390663_5937039', 0.0, 0.6),  # submachine gun, single shot
    'shot-vector': ('418433_6481539', 0.96, 0.3),  # .45 Uzi: the last round of a burst, with its ring-out
    'shot-p90': ('740896_15072041', 2.97, 0.55),  # FN P90: the last round of a burst
    'shot-spas12': ('156904_2801073', 0.0, 1.4),  # SPAS-12
    'shot-saiga12': ('569309_12809197', 0.3, 1.4),  # Saiga 12K
    'shot-m4': ('737569_15072041', 0.0, 1.7),  # Colt M4A1
    'shot-hk416': ('46655_57789', 0.3, 1.6),  # 5.56 carbine
    'shot-aug': ('855653_7157894', 0.0, 1.3),  # automatic rifle, single shot
    'shot-scarH': ('702225_15072041', 0.0, 1.4),  # FN SCAR-H
    'shot-m14': ('696023_15072041', 0.0, 1.4),  # Saiga MK-106 .308 rifle
    'shot-svd': ('182790_71257', 0.3, 1.4),  # sniper rifle
    'shot-m82': ('668071_7842170', 0.0, 0.95),  # .50 calibre
    'shot-m60': ('538302_6209324', 0.0, 0.12),  # M60, the first round of a burst
    # Working the bolt after a shot.
    'bolt-boltRifle': ('267895_4174990', 1.2, 1.6),  # Mosin-Nagant
    'bolt-l96': ('351777_2863152', 0.05, 1.15),  # M24
    # Swings through the air.
    'swing-light': ('352719_6513636', 0.15, 0.4),  # a stick
    'swing-axe': ('514162_10859468', 0.25, 0.25),
    'swing-axe2': ('390360_7074051', 0.0, 0.36),
    'swing-heavy': ('367182_5065048', 0.0, 0.55),
    'swing-heavy2': ('268227_5078136', 0.25, 0.75),
    'swing-blade': ('268226_5078136', 0.0, 0.8),
    'swing-sword': ('59992_71257', 0.0, 0.42),
    'swing-thrust': ('60013_71257', 0.0, 0.43),
    'swing-thrust2': ('59988_71257', 0.0, 0.28),
    'swing-knife': ('35213_307822', 0.0, 0.3),
    'swing-bat': ('766542_15468302', 0.15, 0.4),  # a baseball bat
    'swing-fireAxe': ('147290_1401157', 0.0, 0.45),
    'swing-sledge': ('475135_2927958', 0.0, 0.7),  # a low, heavy whoosh
    # A tool striking wood, rock or metal.
    'hit-chop': ('421928_8090574', 0.0, 0.27),  # chopping wood
    'hit-chop2': ('421929_8090574', 0.0, 0.25),
    'hit-axe': ('583272_12364523', 0.0, 0.18),  # an axe biting in
    'hit-pick': ('638696_13383190', 0.0, 0.3),  # a steel pick on rock
    'hit-stone': ('431019_5635287', 0.0, 0.35),  # stone on stone
    'hit-rock': ('530354_10106687', 0.0, 0.5),
    'hit-blade': ('783059_16503936', 0.0, 0.21),  # a sword hitting wood
    'hit-clang': ('275159_4745081', 0.0, 0.4),  # steel blade on something hard
    'hit-stab': ('504618_7704891', 0.2, 0.55),  # a point driven into wood
    'hit-knife': ('179222_3337554', 0.0, 0.35),  # a knife stab
    'hit-bat': ('449955_9159316', 0.0, 0.3),  # a wooden thud
    'hit-split': ('177045_46808', 0.0, 0.38),  # an axe splitting a log
    'hit-sledge': ('706979_14781925', 0.9, 0.4),  # a sledgehammer on brick
}


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'primal-frontier-fetch'})
    with urllib.request.urlopen(req) as r:
        return r.read()


def cut(src: str, start: float, length: float) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', src, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    # Start on the attack: the first point loud enough to be the event itself.
    env = np.convolve(np.abs(x), np.ones(88) / 88, 'same')
    from_i = int(start * RATE)
    loud = np.where(env[from_i:] > 0.3 * env[from_i:].max())[0]
    begin = max(0, from_i + (loud[0] if len(loud) else 0) - int(0.008 * RATE))
    y = x[begin:begin + int(length * RATE)].copy()
    n = len(y)
    fade_in = min(n, int(0.003 * RATE))
    y[:fade_in] *= np.linspace(0, 1, fade_in)
    tail = int(n * 0.4)
    y[n - tail:] *= np.linspace(1, 0, tail) ** 2
    return y / max(1e-9, np.abs(y).max()) * 0.89


def credit(name: str, preview: str) -> str:
    sid = preview.split('_')[0]
    page = urllib.request.urlopen(urllib.request.Request(f'https://freesound.org/s/{sid}/', headers={'User-Agent': 'primal-frontier-fetch'}))
    html = page.read().decode()
    title = re.search(r'og:title" content="(.*) by ([^"]*)"', html)
    what = f'"{unescape(title[1])}" by {unescape(title[2])}' if title else f'sound {sid}'
    return f'- {name}.mp3: {what} ({page.url}), CC0'


def main():
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[1:]
    credits = []
    for name, (preview, start, length) in SOUNDS.items():
        credits.append(credit(name, preview))
        if only and name not in only:
            continue
        sid = int(preview.split('_')[0])
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 'src.mp3')
            with open(src, 'wb') as f:
                f.write(get(f'https://cdn.freesound.org/previews/{sid // 1000}/{preview}-hq.mp3'))
            y = cut(src, start, length)
            wav = os.path.join(tmp, 'cut.f32')
            y.astype(np.float32).tofile(wav)
            subprocess.run(
                ['ffmpeg', '-v', 'quiet', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', wav, '-b:a', '80k', os.path.join(OUT, f'{name}.mp3')],
                check=True,
            )
        print('saved', name, f'{length:.2f}s')
    with open(os.path.join(OUT, 'CREDITS.md'), 'w') as f:
        f.write('# Sounds\n\nRecordings from Freesound, all CC0 (public domain), cut to one shot, swing or hit.\n\n' + '\n'.join(credits) + '\n')
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(sorted(SOUNDS), f)


if __name__ == '__main__':
    main()
