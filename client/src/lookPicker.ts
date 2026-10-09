// The locker: a row per part of the survivor's look with arrows to step through its options.
// The pick is remembered in this browser for next time, and shown on the menu's stage.

import { LOOK_KEYS, LOOK_PARTS, type Look, type LookPart, cleanLook, defaultLook, randomLook } from '../../shared/look.ts';

const STORE = 'pf-look';

export class LookPicker {
  look: Look;
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
    this.look = saved ? cleanLook(saved) : defaultLook();

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
      prev.addEventListener('click', () => this.set({ ...this.look, [part]: (this.look[part] + n - 1) % n }));
      next.addEventListener('click', () => this.set({ ...this.look, [part]: (this.look[part] + 1) % n }));
      row.append(label, prev, value, next);
      rows.append(row);
      this.value.set(part, value);
    }
    document.getElementById('look-random')!.addEventListener('click', () => this.set(randomLook()));
    document.getElementById('look-reset')!.addEventListener('click', () => this.set(defaultLook()));
    this.showValues();
  }

  private set(look: Look) {
    this.look = look;
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
