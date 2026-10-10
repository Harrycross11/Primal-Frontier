"""Fetches the world's sounds into client/public/sounds: recorded footsteps for each kind of ground
and floor, and the loops and one-offs behind the ambience (crickets at night, birds in the
forest, creaking).

All come from OpenGameArt. Most are CC0; the wood, concrete, grass and metal steps are CC-BY 3.0,
so they are credited in CREDITS-world.md (and in the game's credits). Each step is cut to start on
its attack and normalised; each loop is cross-faded end into start so it repeats without a click.
The output is committed, so this only needs running again to change a sound.
Needs ffmpeg, numpy, py7zr and network access to opengameart.org.

    python3 scripts/fetch-world-sounds.py
"""

import json
import os
import subprocess
import tempfile
import urllib.request
import zipfile

import numpy as np

OUT = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'sounds')
RATE = 44100
OGA = 'https://opengameart.org/sites/default/files/'

PACKS = {
    'steps': ('footsteps_0.zip', 'https://opengameart.org/content/footsteps-on-different-surfaces', 'congusbongus'),
    'snow': ('corsica_s-walking_in_snow.7z', 'https://opengameart.org/content/42-snow-and-gravel-footsteps', 'Corsica_S, cut by Iwan Gabovitch'),
    'fantozzi': ('Fantozzi-footsteps.7z', 'https://opengameart.org/content/fantozzis-footsteps-grasssand-stone', 'Fantozzi'),
}

CORSICA = 'Corsica_S-Walking_in_Snow/Corsica_S-Walking_on_snow_covered_gravel'
FANTOZZI = 'Fantozzi-footsteps/flac/Fantozzi-'

# Each kind of step: (pack, the recordings in it, seconds to keep, licence, what it is from).
STEPS = {
    'gravel': ('steps', [f'footsteps/gravel/{i}.ogg' for i in range(6)], 0.2, 'CC0', '"Gravel Footsteps" by Ali_6868'),
    'grass': ('steps', [f'footsteps/grass/{i}.ogg' for i in range(6)], 0.25, 'CC-BY 3.0', '"footstep-grass.wav" by swuing'),
    'wood': ('steps', [f'footsteps/wood/{i}.ogg' for i in range(6)], 0.28, 'CC-BY 3.0', '"footstep-wood.wav" by swuing'),
    'concrete': ('steps', [f'footsteps/tile/{i}.ogg' for i in range(6)], 0.2, 'CC-BY 3.0', '"footstep-concrete.wav" by swuing and "Squeaky footstep.wav" by ceberation'),
    'metal': ('steps', [f'footsteps/metal/{i}.ogg' for i in range(6)], 0.3, 'CC-BY 3.0', '"boots on aluminum ladder 01" by Eelke'),
    'stone': ('fantozzi', [f'{FANTOZZI}Stone{s}{i}.flac' for s in 'LR' for i in (1, 2, 3)], 0.32, 'CC0', 'Fantozzi'),
    'sand': ('fantozzi', [f'{FANTOZZI}Sand{s}{i}.flac' for s in 'LR' for i in (1, 2, 3)], 0.35, 'CC0', 'Fantozzi'),
    'snow': ('snow', [f'{CORSICA}_{i:02d}.flac' for i in (1, 3, 5, 7, 9, 11)], 0.4, 'CC0', 'Corsica_S'),
}

# Loops and one-offs: our name: (file, page, author, seconds to keep or None for all, loop?).
OTHERS = {
    'amb-crickets': ('crickets_1.mp3', 'https://opengameart.org/content/crickets-ambient-noise-loopable', 'Wolfgang_', None, True),
    'amb-birds': ('birds-isaiah658_0.ogg', 'https://opengameart.org/content/ambient-bird-sounds', 'isaiah658', None, True),
    'amb-creak': ('tree_creak_0.ogg', 'https://opengameart.org/content/tree-creaking', 'AntumDeluge', 3.6, False),
    # Played by lit fires and running recyclers. The machine is one loop out of a pack (pack:member).
    'amb-fire': ('fire.wav', 'https://opengameart.org/content/fireplace-sound-loop', 'pagdev', None, True),
    'amb-machine': ('sfx_loops.zip:machine_11.ogg', 'https://opengameart.org/content/30-cc0-sfx-loops', 'rubberduck', None, True),
}


def get(url: str, path: str):
    req = urllib.request.Request(url, headers={'User-Agent': 'primal-frontier-fetch'})
    with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
        f.write(r.read())


def decode(src: str) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'quiet', '-i', src, '-ac', '1', '-ar', str(RATE), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def step(x: np.ndarray, length: float) -> np.ndarray:
    """One step, starting just before its attack, faded out, normalised."""
    env = np.convolve(np.abs(x), np.ones(88) / 88, 'same')
    loud = np.where(env > 0.25 * env.max())[0]
    begin = max(0, (loud[0] if len(loud) else 0) - int(0.006 * RATE))
    y = x[begin:begin + int(length * RATE)].copy()
    n = len(y)
    fade_in = min(n, int(0.002 * RATE))
    y[:fade_in] *= np.linspace(0, 1, fade_in)
    tail = int(n * 0.45)
    y[n - tail:] *= np.linspace(1, 0, tail) ** 2
    return y / max(1e-9, np.abs(y).max()) * 0.89


def loop(x: np.ndarray, fade: float = 1.5) -> np.ndarray:
    """The recording with its last `fade` seconds blended into its start, so it repeats smoothly."""
    f = int(fade * RATE)
    y = x[: len(x) - f].copy()
    t = np.linspace(0, 1, f)
    y[:f] = x[:f] * np.sqrt(t) + x[len(x) - f :] * np.sqrt(1 - t)
    return y / max(1e-9, np.abs(y).max()) * 0.7


def save(y: np.ndarray, name: str, tmp: str, bitrate: str):
    raw = os.path.join(tmp, 'cut.f32')
    y.astype(np.float32).tofile(raw)
    subprocess.run(
        ['ffmpeg', '-v', 'quiet', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '1', '-i', raw, '-b:a', bitrate, os.path.join(OUT, f'{name}.mp3')],
        check=True,
    )


def unpack(archive: str, into: str):
    if archive.endswith('.zip'):
        with zipfile.ZipFile(archive) as z:
            z.extractall(into)
    else:
        import py7zr

        with py7zr.SevenZipFile(archive) as z:
            z.extractall(into)


def main():
    names = []
    credits = []
    with tempfile.TemporaryDirectory() as tmp:
        for pack, (file, _, _) in PACKS.items():
            archive = os.path.join(tmp, file.replace('%5B', '[').replace('%5D', ']'))
            get(OGA + file, archive)
            unpack(archive, os.path.join(tmp, pack))
        for kind, (pack, files, length, licence, origin) in STEPS.items():
            for i, member in enumerate(files):
                name = f'step-{kind}-{i}'
                save(step(decode(os.path.join(tmp, pack, member)), length), name, tmp, '64k')
                names.append(name)
            _, page, author = PACKS[pack]
            credits.append(f'- step-{kind}-*.mp3: {origin}, from "{page.rsplit("/", 1)[1]}" by {author} ({page}), {licence}')
            print('saved', kind, len(files))
        for name, (file, page, author, keep, loops) in OTHERS.items():
            if ':' in file:
                pack, member = file.split(':')
                archive = os.path.join(tmp, pack)
                if not os.path.exists(archive):
                    get(OGA + pack, archive)
                    unpack(archive, os.path.join(tmp, pack + '.d'))
                src = os.path.join(tmp, pack + '.d', member)
            else:
                src = os.path.join(tmp, file)
                get(OGA + file, src)
            x = decode(src)
            if keep:
                x = x[: int(keep * RATE)]
            save(loop(x) if loops else x / max(1e-9, np.abs(x).max()) * 0.89, name, tmp, '56k')
            names.append(name)
            credits.append(f'- {name}.mp3: by {author} ({page}), CC0')
            print('saved', name)
    with open(os.path.join(OUT, 'CREDITS-world.md'), 'w') as f:
        f.write('# World sounds\n\nFootsteps and ambience from OpenGameArt, CC0 or CC-BY 3.0 as marked. The CC-BY ones are by swuing, ceberation and Eelke on Freesound, gathered by congusbongus.\n\n' + '\n'.join(credits) + '\n')
    with open(os.path.join(OUT, 'world.json'), 'w') as f:
        json.dump(sorted(names), f)


if __name__ == '__main__':
    main()
