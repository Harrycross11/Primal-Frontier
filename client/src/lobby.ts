// The main menu around the stage: tabs for PLAY, SEASON, STORE, CHARACTER and CAR, today's
// objectives, the season pass, the store's packs, the garage where you pick your car style, and
// your coins.

import { LOOK_PARTS } from '../../shared/look.ts';
import { PAINTS, paintOwned } from '../../shared/paint.ts';
import { TIER_XP, TITLES, XP_PER_MINUTE, lookReward, objectiveXp, rewardLabel, seasonNumber, type Reward } from '../../shared/season.ts';
import { COIN_BUNDLES, PACKS, type AccountView } from '../../shared/shop.ts';
import { VEHICLES, VEHICLE_KINDS, type VehicleKind } from '../../shared/vehicles.ts';
import type { Quality } from './graphics.ts';
import type { MenuStage } from './menuStage.ts';
import { swatch } from './paint.ts';

const $ = (id: string) => document.getElementById(id)!;
const STYLE = 'pf-car';

export type Tab = 'play' | 'season' | 'store' | 'character' | 'car';

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

/** "Tier 4", the bar towards the next tier and "320 / 1,000 XP", for the menus' season lines. */
export function seasonLine(account: AccountView | null): { name: string; tier: string; fill: number; xp: string } {
  if (!account) return { name: 'Season pass', tier: '–', fill: 0, xp: '' };
  const s = account.season;
  const tiers = seasonNumber(s.n).track.length;
  const top = s.tier >= tiers;
  const into = top ? TIER_XP : s.xp - s.tier * TIER_XP;
  return {
    name: `Season ${s.n} · ${s.name}`,
    tier: top ? `Tier ${tiers} · complete` : `Tier ${s.tier}`,
    fill: into / TIER_XP,
    xp: top ? 'Every reward unlocked' : `${into.toLocaleString()} / ${TIER_XP.toLocaleString()} XP to tier ${s.tier + 1}`,
  };
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
      row.innerHTML = `<div class="row"><span></span><span class="reward">${o.done ? 'Done' : `<span class="coin"></span>${o.reward}`}</span></div><div class="track"><i style="width:${Math.round((o.progress / o.goal) * 100)}%"></i></div><div class="count">${o.done ? 'Reward collected' : `${shown} · <span class="xp">+${objectiveXp(o)} XP</span>`}</div>`;
      row.querySelector('.row span')!.textContent = o.label;
      return row;
    }),
  );
}

/** The stage's camera for a tab: the season pass shares the store's soft backdrop. */
const shotOf = (tab: Tab) => (tab === 'season' ? 'store' : tab);

/** How the server's saving is going (see server/saves.ts). */
type SaveState = 'ok' | 'down' | 'temporary' | 'off';

export class Lobby {
  account: AccountView | null = null;
  /** How the server's saving is going, as it last said. */
  private saving: SaveState = 'ok';
  tab: Tab = 'play';
  private style = carStyle();
  private toastTimer = 0;
  /** Asks the server to unlock a pack. */
  onBuy: (pack: string) => void = () => {};
  /** Asks the server to open an account by name and password. */
  onSignIn: (name: string, password: string) => void = () => {};
  /** Asks the server to give this browser's account a name and password. */
  onRegister: (name: string, password: string) => void = () => {};
  /** Goes back to being a fresh guest on this browser. */
  onSignOut: () => void = () => {};
  /** Asks the server to wear a season title over your name (null: none). */
  onWearTitle: (id: string | null) => void = () => {};

  private stage: MenuStage | null = null;
  /** The store's pictures of each pack, rendered from the menu's stage. */
  private art: Record<string, string> = {};

  constructor() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-tabs button')) b.addEventListener('click', () => this.show(b.dataset.tab as Tab));
    const name = $('name') as HTMLInputElement;
    const chip = () => ($('lobby-name-chip').textContent = name.value.trim() || 'Survivor');
    name.addEventListener('input', chip);
    setTimeout(chip, 0);
    this.wireAccount();
    this.renderBundles();
    this.renderStore();
    this.renderGarage();
    $('season-mini').addEventListener('click', () => this.show('season'));
    $('news-card').addEventListener('click', () => this.show('season'));
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

  /** The sign-in box, and the line under Play that opens it. */
  private wireAccount() {
    const box = $('lobby-account');
    const name = $('account-name') as HTMLInputElement;
    const password = $('account-password') as HTMLInputElement;
    const buttons = [$('account-signin'), $('account-create')] as HTMLButtonElement[];
    const close = () => (box.hidden = true);
    const send = (create: boolean) => {
      const n = name.value.trim();
      if (!n || !password.value) return this.authError('Type an account name and a password.');
      $('account-error').textContent = '';
      for (const b of buttons) b.disabled = true;
      (create ? this.onRegister : this.onSignIn)(n, password.value);
    };
    $('account-open').addEventListener('click', () => {
      if (this.account?.name) {
        this.onSignOut();
        return;
      }
      $('account-error').textContent = '';
      password.value = '';
      for (const b of buttons) b.disabled = false;
      box.hidden = false;
      name.focus();
    });
    $('account-form').addEventListener('submit', (e) => {
      e.preventDefault();
      send(false);
    });
    $('account-create').addEventListener('click', () => send(true));
    $('account-cancel').addEventListener('click', close);
    box.addEventListener('click', (e) => e.target === box && close());
  }

  /** The server turned down a sign-in or a new account. */
  authError(text: string) {
    $('account-error').textContent = text;
    for (const b of [$('account-signin'), $('account-create')] as HTMLButtonElement[]) b.disabled = false;
  }

  /** Signed in: close the box and play under the account's name. */
  signedIn(name: string) {
    $('lobby-account').hidden = true;
    ($('account-password') as HTMLInputElement).value = '';
    const input = $('name') as HTMLInputElement;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    this.toast(`Signed in as ${name}`);
  }

  private renderAccount() {
    const name = this.account?.name;
    // Said plainly when an account made now wouldn't be kept (the server turns them away too).
    const warning = $('save-warning');
    warning.hidden = this.saving !== 'down' && this.saving !== 'temporary';
    warning.textContent =
      this.saving === 'down'
        ? 'Saving is offline on this server right now: new accounts can\'t be made, and progress may not be kept. Signing in still works.'
        : 'This server isn\'t set up to keep accounts yet, so new accounts are turned away. You can still play as a guest.';
    $('account-state').innerHTML = name ? `Signed in as <b></b>` : 'Guest on this browser';
    if (name) $('account-state').querySelector('b')!.textContent = name;
    $('account-open').textContent = name ? 'Sign out' : 'Sign in';
  }

  show(tab: Tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#lobby-tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
    for (const p of document.querySelectorAll<HTMLElement>('#join .page')) p.classList.toggle('on', p.dataset.page === tab);
    $('join').classList.toggle('store', tab === 'store' || tab === 'season');
    this.stage?.show(shotOf(tab));
    // The season track opens at the tier you're working towards.
    if (tab === 'season') {
      const track = $('season-track');
      const at = track.children[Math.max(0, (this.account?.season.tier ?? 0) - 1)] as HTMLElement | undefined;
      if (at) track.scrollLeft = at.offsetLeft - (track.firstElementChild as HTMLElement).offsetLeft;
    }
  }

  /** The live world behind the menus has loaded: show it, and picture the packs in it. */
  attach(stage: MenuStage) {
    this.stage = stage;
    $('land-title').textContent = stage.place.landmark;
    $('land-sub').textContent = stage.place.land;
    stage.setCar(this.style);
    stage.show(shotOf(this.tab));
    stage.onReady = () => {
      $('join').classList.add('live');
      this.onLive();
      // A moment later, so the first frames of the world come first.
      setTimeout(() => {
        const seasonPaints = PAINTS.flatMap((p) => (p.season && p.pack ? [p.pack] : []));
        this.art = stage.packArt([...PACKS.map((p) => p.id), ...seasonPaints]);
        // The news is the season pass: its last reward on a car.
        const news = this.art[seasonPaints[seasonPaints.length - 1]];
        if (news) $('news-art').style.backgroundImage = `url(${news})`;
        this.renderStore();
        this.renderSeason();
      }, 400);
    };
  }

  /** The menu's world has drawn its first frame. */
  onLive: () => void = () => {};

  /** The menu lost the server for a moment (it reconnects by itself). */
  offline() {
    $('server-meta').textContent = 'Reconnecting to the server…';
  }

  /** The car style picked in the garage. */
  get car() {
    return this.style;
  }

  /** The server's answer to hello: coins, objectives and how full it is. */
  update(account: AccountView | null, online?: number, max?: number, wipeIn?: number, saving?: SaveState) {
    this.account = account;
    if (saving !== undefined) this.saving = saving;
    $('coin-count').textContent = account ? account.coins.toLocaleString() : '–';
    renderObjectives($('objective-list'), account);
    $('objective-reset').textContent = account ? `Resets in ${timeLeft(account.resetIn)}` : '';
    if (online !== undefined && max !== undefined) {
      $('server-meta').textContent = `${online} / ${max} online${wipeIn !== undefined ? ` · wipe in ${timeLeft(wipeIn)}` : ''}`;
    }
    this.renderStore();
    this.renderGarage();
    this.renderAccount();
    this.renderSeason();
    this.onOwned(account?.packs ?? []);
  }

  /** Told what the account has unlocked, for the locker's season outfits. */
  onOwned: (owned: string[]) => void = () => {};

  /** The season pass page: the tier you're on, every tier's reward, ways to earn XP, and titles. */
  private renderSeason() {
    const account = this.account;
    const view = account?.season;
    const season = seasonNumber(view?.n ?? 1);
    const owned = account?.packs ?? [];
    const tier = view?.tier ?? 0;
    const line = seasonLine(account);
    $('season-kicker').textContent = `Season ${season.n} · free pass · ends in ${timeLeft(view?.endsIn ?? season.end - Date.now())}`;
    $('season-name').textContent = season.name;
    $('season-tier').textContent = String(tier);
    $('season-of').textContent = `/ ${season.track.length}`;
    $('season-fill').style.width = `${Math.round(line.fill * 100)}%`;
    $('season-xp').textContent = account ? line.xp : 'The season pass needs this browser to allow storage';
    $('season-mini-name').textContent = line.name;
    $('season-mini-tier').textContent = line.tier;
    $('season-mini-fill').style.width = `${Math.round(line.fill * 100)}%`;
    $('earn-minute').textContent = `${XP_PER_MINUTE} XP a minute`;
    const left = account?.objectives.filter((o) => !o.done) ?? [];
    $('earn-today').textContent = account ? `${left.length} · up to ${left.reduce((n, o) => n + objectiveXp(o), 0).toLocaleString()} XP` : '–';

    $('season-track').replaceChildren(
      ...season.track.map((reward, i) => {
        const n = i + 1;
        const card = document.createElement('div');
        card.className = `tier ${n <= tier ? 'got' : n === tier + 1 ? 'next' : 'locked'}${n === season.track.length ? ' final' : ''}`;
        card.innerHTML = `<div class="num"><span>${String(n).padStart(2, '0')}</span><span></span></div><div class="art"></div><div class="label"><span></span><small></small></div>`;
        card.querySelector('.num span:last-child')!.textContent = n === tier + 1 ? 'Next' : '';
        this.rewardArt(card.querySelector<HTMLElement>('.art')!, reward);
        card.querySelector('.label span')!.textContent = rewardLabel(reward).replace(/ (paint|title)$/, '');
        const kind = { coins: 'Coins', paint: 'Paint finish', look: 'Outfit', title: 'Title' }[reward.kind];
        const had = reward.kind !== 'coins' && owned.includes(reward.id);
        card.querySelector('.label small')!.textContent = n <= tier ? `${kind} · unlocked` : had ? `${kind} · owned` : kind;
        return card;
      }),
    );

    const titles = [...TITLES];
    const worn = view?.title ?? null;
    const none = document.createElement('button');
    none.type = 'button';
    none.textContent = 'None';
    none.className = worn ? '' : 'on';
    none.onclick = () => account && this.onWearTitle(null);
    $('season-titles').replaceChildren(
      none,
      ...titles.map(([id, text]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        const has = owned.includes(id);
        b.className = id === worn ? 'on' : has ? '' : 'locked';
        const at = season.track.findIndex((r) => r.kind === 'title' && r.id === id) + 1;
        b.title = has ? `Wear ${text} over your name` : at ? `Unlocks at tier ${at}` : 'From an earlier season';
        b.onclick = () => (has ? this.onWearTitle(id) : this.toast(at ? `${text} unlocks at tier ${at} of the season pass` : `${text} came with an earlier season`));
        return b;
      }),
    );
  }

  /** A tier's picture: the painted car, a cloth swatch, a title plate or a pile of coins. */
  private rewardArt(el: HTMLElement, reward: Reward) {
    if (reward.kind === 'coins') {
      el.innerHTML = `<div class="big-coin"><span class="coin"></span><span></span></div>`;
      el.querySelector('.big-coin span:last-child')!.textContent = reward.coins.toLocaleString();
    } else if (reward.kind === 'title') {
      el.innerHTML = '<div class="plate"></div>';
      el.querySelector('.plate')!.textContent = reward.title;
    } else if (reward.kind === 'paint') {
      const n = PAINTS.findIndex((p) => p.pack === reward.id);
      if (this.art[reward.id]) el.style.backgroundImage = `url(${this.art[reward.id]})`;
      else el.innerHTML = `<div class="swatch" style="background:${swatch(n)}"></div>`;
    } else {
      const found = lookReward(reward.id);
      const colour = found ? LOOK_PARTS[found.part].options[found.option][1] : null;
      el.innerHTML = `<div class="swatch" style="background:#${(colour ?? 0x555555).toString(16).padStart(6, '0')}"></div><div class="part"></div>`;
      el.querySelector('.part')!.textContent = found ? LOOK_PARTS[found.part].label : '';
    }
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
    groups.push({ title: 'Season pass', paints: PAINTS.flatMap((p, n) => (p.season ? [n] : [])) });
    $('garage-swatches').replaceChildren(
      ...groups.flatMap((g) => {
        const head = document.createElement('div');
        head.className = 'paint-group';
        head.textContent = g.title;
        if (g.pack && !owned.includes(g.pack)) head.insertAdjacentHTML('beforeend', '<em>Store</em>');
        if (!g.pack && g.paints.some((n) => !paintOwned(n, owned))) head.insertAdjacentHTML('beforeend', '<em>Season</em>');
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
                this.toast(PAINTS[n].season ? `${PAINTS[n].name} is a season pass reward: climb the pass to unlock it` : `${PAINTS[n].name} comes in the ${PACKS.find((p) => p.id === PAINTS[n].pack)?.name}: get it in the store`);
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
