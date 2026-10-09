// The paint menu (P): colour swatches for whatever you're next to, and for a car its models too.
// When more than one thing could be painted (the car you look at, a wall, the gun in your hands),
// tabs along the top pick which.

import { PAINTS, paintOwned } from '../../shared/paint.ts';
import { PACKS } from '../../shared/shop.ts';
import { swatch } from './paint.ts';

export interface PaintTarget {
  /** Tab name, such as "Old Saloon" or "Stone wall". */
  label: string;
  paint: number;
  /** Other models it can be swapped for (cars). */
  models?: { id: string; name: string; blurb: string }[];
  model?: string;
  /** A one-click look from the garage on the main menu (cars). */
  preset?: { label: string; paint: number; model: string };
  /** Offer "the whole base" (building pieces). */
  wholeBase?: boolean;
  apply(paint: number, model: string | undefined, all: boolean): void;
}

const $ = (id: string) => document.getElementById(id)!;

export class PaintPanel {
  private targets: PaintTarget[] = [];
  private current = 0;
  private all = false;
  /** Store packs unlocked, whose paints can be picked. */
  owned: string[] = [];
  onClose: () => void = () => {};
  /** Told when a locked paint is picked. */
  onLocked: (pack: string) => void = () => {};

  get isOpen(): boolean {
    return !$('paint').hidden;
  }

  open(targets: PaintTarget[]) {
    this.targets = targets;
    this.current = 0;
    $('paint').hidden = false;
    document.exitPointerLock?.();
    $('paint-done').onclick = () => this.close();
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    $('paint').hidden = true;
    this.onClose();
  }

  private render() {
    const t = this.targets[this.current];
    const tabs = $('paint-tabs');
    tabs.replaceChildren(
      ...this.targets.map((other, n) => {
        const b = document.createElement('button');
        b.textContent = other.label;
        b.className = n === this.current ? 'on' : '';
        b.onclick = () => {
          this.current = n;
          this.render();
        };
        return b;
      }),
    );
    tabs.hidden = this.targets.length < 2;
    $('paint-title').textContent = `Paint: ${t.label}`;
    const preset = $('paint-preset') as HTMLButtonElement;
    preset.hidden = !t.preset;
    if (t.preset) {
      const p = t.preset;
      preset.textContent = p.label;
      preset.onclick = () => {
        t.paint = p.paint;
        t.model = p.model;
        t.apply(p.paint, p.model, false);
        this.render();
      };
    }
    const models = $('paint-models');
    models.hidden = !t.models;
    models.replaceChildren(
      ...(t.models ?? []).map((m) => {
        const b = document.createElement('button');
        b.className = m.id === t.model ? 'on' : '';
        b.innerHTML = `<b></b><span></span>`;
        b.querySelector('b')!.textContent = m.name;
        b.querySelector('span')!.textContent = m.blurb;
        b.onclick = () => {
          t.model = m.id;
          t.apply(t.paint, t.model, false);
          this.render();
        };
        return b;
      }),
    );
    // The free colours, then each store pack's finishes (locked until bought).
    const groups: { title: string; pack?: string; paints: number[] }[] = [{ title: 'Colours', paints: PAINTS.flatMap((p, n) => (p.pack ? [] : [n])) }];
    for (const pack of PACKS) groups.push({ title: pack.name, pack: pack.id, paints: PAINTS.flatMap((p, n) => (p.pack === pack.id ? [n] : [])) });
    $('paint-swatches').replaceChildren(
      ...groups.flatMap((g) => {
        const head = document.createElement('div');
        head.className = 'paint-group';
        const locked = !!g.pack && !this.owned.includes(g.pack);
        head.textContent = locked ? `${g.title} · in the store` : g.title;
        return [
          head,
          ...g.paints.map((n) => {
            const p = PAINTS[n];
            const b = document.createElement('button');
            b.title = p.name;
            b.className = `${n === t.paint ? 'on' : ''} ${paintOwned(n, this.owned) ? '' : 'locked'}`;
            b.style.background = n === 0 ? '' : swatch(n);
            if (n === 0) b.textContent = 'None';
            b.onclick = () => {
              if (!paintOwned(n, this.owned)) return this.onLocked(p.pack!);
              t.paint = n;
              t.apply(n, t.model, !!t.wholeBase && this.all);
              this.render();
            };
            return b;
          }),
        ];
      }),
    );
    $('paint-name').textContent = PAINTS[t.paint]?.name ?? '';
    const row = $('paint-all-row');
    row.hidden = !t.wholeBase;
    const box = $('paint-all') as HTMLInputElement;
    box.checked = this.all;
    box.onchange = () => (this.all = box.checked);
  }
}
