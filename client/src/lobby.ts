// The main menu around the stage: tabs for PLAY, STORE, CHARACTER and CAR, today's objectives,
// the store's packs, the garage where you pick your car style, and your coins.

import { PAINTS, paintOwned } from '../../shared/paint.ts';
import { COIN_BUNDLES, PACKS, type AccountView } from '../../shared/shop.ts';
import { VEHICLES, VEHICLE_KINDS, type VehicleKind } from '../../shared/vehicles.ts';
import type { Quality } from './graphics.ts';
import type { MenuStage } from './menuStage.ts';
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
      row.innerHTML = `<div class="row"><span></span><span class="reward">${o.done ? 'Done' : `<span class="coin"></span>${o.reward}`}</span></div><div class="track"><i style="width:${Math.round((o.progress / o.goal) * 100)}%"></i></div><div class="count">${o.done ? 'Reward collected' : shown}</div>`;
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

  private stage: MenuStage | null = null;
  /** The store's pictures of each pack, rendered from the menu's stage. */
  private art: Record<string, string> = {};

  constructor() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-tabs button')) b.addEventListener('click', () => this.show(b.dataset.tab as Tab));
    const name = $('name') as HTMLInputElement;
    const chip = () => ($('lobby-name-chip').textContent = name.value.trim() || 'Survivor');
    name.addEventListener('input', chip);
    setTimeout(chip, 0);
    this.renderBundles();
    this.renderStore();
    this.renderGarage();
    // Settings: graphics quality (used by the menu's world and the game) and full screen.
    const settings = $('lobby-settings');
    const quality = () => {
      let q = 'high';
      try {
        q = localStorage.getItem('pf-quality') ?? 'high';
      } catch {
        /* storage unavailable */
      }
      for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-quality button')) b.classList.toggle('on', b.dataset.q === q);
    };
    $('lobby-gear').addEventListener('click', () => {
      quality();
      settings.hidden = false;
    });
    $('lobby-settings-done').addEventListener('click', () => (settings.hidden = true));
    settings.addEventListener('click', (e) => e.target === settings && (settings.hidden = true));
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-quality button')) {
      b.addEventListener('click', () => {
        const q = b.dataset.q as Quality;
        if (this.stage) this.stage.gfx.setQuality(q);
        else
          try {
            localStorage.setItem('pf-quality', q);
          } catch {
            /* storage unavailable */
          }
        quality();
      });
    }
    $('lobby-fullscreen').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
  }

  show(tab: Tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const p of document.querySelectorAll<HTMLElement>('#join .page')) p.classList.toggle('on', p.dataset.page === tab);
    $('join').classList.toggle('store', tab === 'store');
    this.stage?.show(tab);
  }

  /** The live world behind the menus has loaded: show it, and picture the packs in it. */
  attach(stage: MenuStage) {
    this.stage = stage;
    $('land-title').textContent = stage.place.landmark;
    $('land-sub').textContent = stage.place.land;
    stage.setCar(this.style);
    stage.show(this.tab);
    stage.onReady = () => {
      $('join').classList.add('live');
      // A moment later, so the first frames of the world come first.
      setTimeout(() => {
        this.art = stage.packArt([...PACKS.map((p) => p.id), 'news']);
        if (this.art.news) $('news-art').style.backgroundImage = `url(${this.art.news})`;
        this.renderStore();
      }, 400);
    };
  }

  /** The car style picked in the garage. */
  get car() {
    return this.style;
  }

  /** The server's answer to hello: coins, objectives and how full it is. */
  update(account: AccountView | null, online?: number, max?: number, wipeIn?: number) {
    this.account = account;
    $('coin-count').textContent = account ? account.coins.toLocaleString() : '–';
    renderObjectives($('objective-list'), account);
    $('objective-reset').textContent = account ? `Resets in ${timeLeft(account.resetIn)}` : '';
    if (online !== undefined && max !== undefined) {
      $('server-meta').textContent = `${online} / ${max} online${wipeIn !== undefined ? ` · wipe in ${timeLeft(wipeIn)}` : ''}`;
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
        const legend = pack.price >= 1000;
        card.className = `pack${legend ? ' legend' : ''}`;
        const has = owned.includes(pack.id);
        const chips = PAINTS.flatMap((p, n) => (p.pack === pack.id ? [`<i style="background:${swatch(n)}"></i>`] : [])).join('');
        card.innerHTML = `<div class="art"><div class="rarity"></div><div class="chips">${chips}</div></div>
          <div class="info"><div class="tier">${legend ? 'Legendary' : 'Pack'} · 4 finishes</div><div class="name"></div><div class="blurb"></div>
          <div class="buy"><div class="price"></div><button></button></div></div>`;
        const art = card.querySelector<HTMLElement>('.art')!;
        if (this.art[pack.id]) art.style.backgroundImage = `url(${this.art[pack.id]})`;
        card.querySelector('.name')!.textContent = pack.name;
        card.querySelector('.blurb')!.textContent = pack.blurb;
        const price = card.querySelector('.price')!;
        const buy = card.querySelector('button')!;
        if (has) {
          buy.className = 'owned';
          buy.textContent = 'Owned';
          price.textContent = '';
        } else {
          price.innerHTML = `<span class="coin"></span>${pack.price.toLocaleString()}`;
          buy.className = coins >= pack.price ? '' : 'short';
          buy.textContent = 'Buy';
          buy.onclick = () => {
            if (!this.account) return this.toast('The store needs this browser to allow storage');
            if (this.account.coins < pack.price) return this.toast(`You need ${(pack.price - this.account.coins).toLocaleString()} more coins. Finish daily challenges to earn them.`);
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
        el.innerHTML = `<div class="n"><span class="coin"></span>${b.coins.toLocaleString()}</div><div class="p">${b.price}<small>Not open yet</small></div>`;
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
      this.stage?.setCar(style);
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
    $('garage-stats').innerHTML = stats.map(([label, f]) => `<span>${label}</span><div class="meter"><i style="width:${Math.round(f * 100)}%"></i></div>`).join('');
    const groups: { title: string; pack?: string; paints: number[] }[] = [{ title: 'Colours', paints: PAINTS.flatMap((p, n) => (p.pack ? [] : [n])) }];
    for (const pack of PACKS) groups.push({ title: pack.name, pack: pack.id, paints: PAINTS.flatMap((p, n) => (p.pack === pack.id ? [n] : [])) });
    $('garage-swatches').replaceChildren(
      ...groups.flatMap((g) => {
        const head = document.createElement('div');
        head.className = 'paint-group';
        head.textContent = g.title;
        if (g.pack && !owned.includes(g.pack)) head.insertAdjacentHTML('beforeend', '<em>Store</em>');
        return [
          head,
          ...g.paints.map((n) => {
            const b = document.createElement('button');
            b.title = PAINTS[n].name;
            b.className = `${n === this.style.paint ? 'on' : ''} ${paintOwned(n, owned) ? '' : 'locked'}`;
            b.style.background = n === 0 ? '' : swatch(n);
            if (n === 0) b.textContent = 'Bare';
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
