// The main menu around the stage: tabs for PLAY, STORE, CHARACTER and CAR, today's objectives,
// the store's packs, the garage where you pick your car style, and your coins.

import { PAINTS, paintOwned } from '../../shared/paint.ts';
import { COIN_BUNDLES, PACKS, type AccountView } from '../../shared/shop.ts';
import { VEHICLES, VEHICLE_KINDS, type VehicleKind } from '../../shared/vehicles.ts';
import type { LookPicker } from './lookPicker.ts';
import { swatch } from './paint.ts';

const $ = (id: string) => document.getElementById(id)!;
const STYLE = 'pf-car';

export type Tab = 'play' | 'store' | 'character' | 'car';

/** Your car style from the garage, kept in this browser. */
export function carStyle(): { kind: VehicleKind; paint: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE) ?? 'null');
    if (saved && VEHICLE_KINDS.includes(saved.kind) && Number.isInteger(saved.paint) && PAINTS[saved.paint]) return saved;
  } catch {
    /* storage unavailable */
  }
  return { kind: 'pickup', paint: 0 };
}

/** "5h 12m" or "3 days". */
export function timeLeft(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days`;
  return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

/** The objectives list, shared by the main menu and the pause menu. */
export function renderObjectives(el: HTMLElement, account: AccountView | null) {
  if (!account) {
    el.innerHTML = '<div class="objective"><div class="row">Objectives need this browser to allow storage.</div></div>';
    return;
  }
  el.replaceChildren(
    ...account.objectives.map((o) => {
      const row = document.createElement('div');
      row.className = `objective${o.done ? ' done' : ''}`;
      const shown = o.stat === 'drive' ? `${(o.progress / 1000).toFixed(1)} / ${o.goal / 1000} km` : `${o.progress} / ${o.goal}`;
      row.innerHTML = `<div class="row"><span></span><span class="reward"><span class="coin"></span>${o.done ? '✓' : o.reward}</span></div><div class="track"><i style="width:${Math.round((o.progress / o.goal) * 100)}%"></i></div><div class="count">${o.done ? 'Complete' : shown}</div>`;
      row.querySelector('.row span')!.textContent = o.label;
      return row;
    }),
  );
}

export class Lobby {
  account: AccountView | null = null;
  tab: Tab = 'play';
  private style = carStyle();
  private toastTimer = 0;
  /** Asks the server to unlock a pack. */
  onBuy: (pack: string) => void = () => {};

  constructor(private stage: LookPicker) {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-tabs button')) b.addEventListener('click', () => this.show(b.dataset.tab as Tab));
    const name = $('name') as HTMLInputElement;
    const chip = () => ($('lobby-name-chip').textContent = name.value.trim() || 'Survivor');
    name.addEventListener('input', chip);
    setTimeout(chip, 0);
    this.renderBundles();
    this.renderStore();
    this.renderGarage();
  }

  show(tab: Tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const p of document.querySelectorAll<HTMLElement>('#join .page')) p.classList.toggle('on', p.dataset.page === tab);
    this.stage.show(tab === 'car' ? 'car' : tab === 'store' ? 'none' : 'survivor', this.style);
  }

  /** The server's answer to hello: coins, objectives and how full it is. */
  update(account: AccountView | null, online?: number, max?: number, wipeIn?: number) {
    this.account = account;
    $('coin-count').textContent = account ? account.coins.toLocaleString() : '–';
    renderObjectives($('objective-list'), account);
    $('objective-reset').textContent = account ? `new in ${timeLeft(account.resetIn)}` : '';
    if (online !== undefined && max !== undefined) {
      $('server-meta').textContent = `${online} of ${max} survivors online${wipeIn !== undefined ? ` · wipes in ${timeLeft(wipeIn)}` : ''}`;
    }
    this.renderStore();
    this.renderGarage();
  }

  toast(text: string) {
    const el = $('lobby-toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 2600);
  }

  private renderStore() {
    const owned = this.account?.packs ?? [];
    const coins = this.account?.coins ?? 0;
    $('store-packs').replaceChildren(
      ...PACKS.map((pack) => {
        const card = document.createElement('div');
        card.className = 'pack';
        const has = owned.includes(pack.id);
        const chips = PAINTS.flatMap((p, n) => (p.pack === pack.id ? [`<i style="background:${swatch(n)}"></i>`] : [])).join('');
        card.innerHTML = `<div class="art" style="background:${pack.art}">${pack.price >= 1000 ? '<span class="tag">LEGENDARY</span>' : ''}<div class="chips">${chips}</div></div>
          <div class="info"><div class="name"></div><div class="blurb"></div><button></button></div>`;
        card.querySelector('.name')!.textContent = pack.name;
        card.querySelector('.blurb')!.textContent = pack.blurb;
        const buy = card.querySelector('button')!;
        if (has) {
          buy.className = 'owned';
          buy.textContent = 'Owned';
        } else {
          buy.className = coins >= pack.price ? '' : 'short';
          buy.innerHTML = `<span class="coin"></span>${pack.price.toLocaleString()}`;
          buy.onclick = () => {
            if (!this.account) return this.toast('The store needs this browser to allow storage');
            if (this.account.coins < pack.price) return this.toast(`You need ${(pack.price - this.account.coins).toLocaleString()} more coins: finish daily objectives to earn them`);
            this.onBuy(pack.id);
          };
        }
        return card;
      }),
    );
  }

  private renderBundles() {
    $('coin-bundles').replaceChildren(
      ...COIN_BUNDLES.map((b) => {
        const el = document.createElement('div');
        el.className = 'bundle';
        el.innerHTML = `<div class="n"><span class="coin"></span>${b.coins.toLocaleString()}</div><button disabled>${b.price} · Soon</button>`;
        return el;
      }),
    );
  }

  private renderGarage() {
    const owned = this.account?.packs ?? [];
    const pick = (style: { kind: VehicleKind; paint: number }) => {
      this.style = style;
      try {
        localStorage.setItem(STYLE, JSON.stringify(style));
      } catch {
        /* storage unavailable */
      }
      this.stage.show(this.tab === 'car' ? 'car' : this.tab === 'store' ? 'none' : 'survivor', style);
      this.renderGarage();
    };
    $('garage-models').replaceChildren(
      ...VEHICLE_KINDS.map((k) => {
        const b = document.createElement('button');
        b.className = k === this.style.kind ? 'on' : '';
        b.innerHTML = '<b></b><span></span>';
        b.querySelector('b')!.textContent = VEHICLES[k].name;
        b.querySelector('span')!.textContent = VEHICLES[k].blurb;
        b.onclick = () => pick({ ...this.style, kind: k });
        return b;
      }),
    );
    // Bars against the best of the four.
    const info = VEHICLES[this.style.kind];
    const best = (f: (v: (typeof VEHICLES)[VehicleKind]) => number) => Math.max(...VEHICLE_KINDS.map((k) => f(VEHICLES[k])));
    const stats: [string, number][] = [
      ['Speed', info.top / best((v) => v.top)],
      ['Armour', info.maxHp / best((v) => v.maxHp)],
      ['Handling', info.turn / best((v) => v.turn)],
      ['Fuel tank', info.tank / best((v) => v.tank)],
    ];
    $('garage-stats').innerHTML = stats.map(([label, f]) => `<span>${label}</span><i style="width:${Math.round(f * 100)}%"></i>`).join('');
    const groups: { title: string; pack?: string; paints: number[] }[] = [{ title: 'Colours', paints: PAINTS.flatMap((p, n) => (p.pack ? [] : [n])) }];
    for (const pack of PACKS) groups.push({ title: pack.name, pack: pack.id, paints: PAINTS.flatMap((p, n) => (p.pack === pack.id ? [n] : [])) });
    $('garage-swatches').replaceChildren(
      ...groups.flatMap((g) => {
        const head = document.createElement('div');
        head.className = 'paint-group';
        head.textContent = g.pack && !owned.includes(g.pack) ? `${g.title} · in the store` : g.title;
        return [
          head,
          ...g.paints.map((n) => {
            const b = document.createElement('button');
            b.title = PAINTS[n].name;
            b.className = `${n === this.style.paint ? 'on' : ''} ${paintOwned(n, owned) ? '' : 'locked'}`;
            b.style.background = n === 0 ? '' : swatch(n);
            if (n === 0) b.textContent = 'None';
            b.onclick = () => {
              if (!paintOwned(n, owned)) {
                this.toast(`${PAINTS[n].name} comes in the ${PACKS.find((p) => p.id === PAINTS[n].pack)?.name}: get it in the store`);
                return;
              }
              pick({ ...this.style, paint: n });
            };
            return b;
          }),
        ];
      }),
    );
  }
}
