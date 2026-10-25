// The locker: a row per part of the survivor's look with arrows to step through its options
// (season pass outfits once they are unlocked). The pick is remembered in this browser for next
// time, and shown on the menu's stage.

import { LOOK_KEYS, LOOK_PARTS, type Look, type LookPart, cleanLook, defaultLook, lookOwned, ownedLook, randomLook } from '../../shared/look.ts';

const STORE = 'pf-look';

export class LookPicker {
  /** The look as picked, which may include season outfits not (yet) unlocked here. */
  private picked: Look;
  /** Season pass unlocks of the account playing. */
  private owned: string[] = [];
  private value = new Map<LookPart, HTMLElement>();
  /** Told whenever the look changes. */
  onChange: (look: Look) => void = () => {};

  constructor() {
    let saved: unknown = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    } catch {
      /* storage unavailable */
    }
    this.picked = saved ? cleanLook(saved) : defaultLook();

    const rows = document.getElementById('look-rows')!;
    for (const part of LOOK_KEYS) {
      const row = document.createElement('div');
      row.className = 'look-row';
      const label = document.createElement('span');
      label.className = 'look-label';
      label.textContent = LOOK_PARTS[part].label;
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.textContent = '‹';
      prev.setAttribute('aria-label', `Previous ${LOOK_PARTS[part].label.toLowerCase()}`);
      const value = document.createElement('span');
      value.className = 'look-value';
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = '›';
      next.setAttribute('aria-label', `Next ${LOOK_PARTS[part].label.toLowerCase()}`);
      const n = LOOK_PARTS[part].options.length;
      // Steps past outfits the account hasn't unlocked.
      const step = (by: number) => {
        let k = this.look[part];
        do k = (k + by + n) % n;
        while (!lookOwned(part, k, this.owned));
        this.set({ ...this.look, [part]: k });
      };
      prev.addEventListener('click', () => step(-1));
      next.addEventListener('click', () => step(1));
      row.append(label, prev, value, next);
      rows.append(row);
      this.value.set(part, value);
    }
    document.getElementById('look-random')!.addEventListener('click', () => this.set(randomLook(Math.random, this.owned)));
    document.getElementById('look-reset')!.addEventListener('click', () => this.set(defaultLook()));
    this.showValues();
  }

  /** What the survivor wears: the pick, less anything locked. */
  get look(): Look {
    return ownedLook(this.picked, this.owned);
  }

  /** The account's unlocks arrived or changed. */
  setOwned(owned: string[]) {
    const was = JSON.stringify(this.look);
    this.owned = owned;
    this.showValues();
    if (JSON.stringify(this.look) !== was) this.onChange(this.look);
  }

  private set(look: Look) {
    this.picked = look;
    try {
      localStorage.setItem(STORE, JSON.stringify(look));
    } catch {
      /* storage unavailable */
    }
    this.showValues();
    this.onChange(look);
  }

  private showValues() {
    for (const part of LOOK_KEYS) this.value.get(part)!.textContent = LOOK_PARTS[part].options[this.look[part]][0];
  }
}
