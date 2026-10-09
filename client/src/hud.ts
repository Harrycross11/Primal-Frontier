// The on-screen interface: join screen, target info, notices and player list.
// The belt, inventory and crafting screens live in inventory.ts.

import type { Quality } from './graphics.ts';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private noticeTimer = 0;
  private hitTimer = 0;

  onPlay(handler: (name: string) => void) {
    const input = $('name') as HTMLInputElement;
    try {
      input.value = localStorage.getItem('pf-name') ?? '';
    } catch {
      /* storage unavailable */
    }
    const go = () => {
      const name = input.value.trim();
      try {
        localStorage.setItem('pf-name', name);
      } catch {
        /* storage unavailable */
      }
      ($('play') as HTMLButtonElement).disabled = true;
      $('join-error').textContent = '';
      handler(name);
    };
    $('play').addEventListener('click', go);
    input.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    input.focus();
  }

  /** How far the models have loaded, under the join button. */
  setLoading(done: number, total: number) {
    const el = $('loading');
    el.hidden = done >= total;
    ($('loading-fill') as HTMLElement).style.width = `${Math.round((done / total) * 100)}%`;
  }

  showJoinError(text: string) {
    $('join-error').textContent = text;
    ($('play') as HTMLButtonElement).disabled = false;
  }

  hideJoin() {
    $('join').hidden = true;
    $('hud').hidden = false;
  }

  setTarget(t: { text: string; health?: number }) {
    const el = $('target');
    const text = $('target-text');
    if (text.textContent !== t.text) text.textContent = t.text;
    el.hidden = !t.text;
    const bar = $('target-health');
    bar.hidden = t.health === undefined;
    if (t.health !== undefined) ($('target-health-fill') as HTMLElement).style.width = `${Math.round(t.health * 100)}%`;
  }

  setPlayers(names: string[]) {
    $('player-count').textContent = `${names.length} survivor${names.length === 1 ? '' : 's'} online`;
    $('player-list').textContent = names.join(', ');
  }

  setQuality(q: Quality) {
    $('quality').textContent = q[0].toUpperCase() + q.slice(1);
  }

  notice(text: string, seconds = 2.2) {
    const el = $('notice');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => el.classList.remove('show'), seconds * 1000);
  }

  private bannerTimer = 0;

  /** Slides in "Objective complete" with what was done and the coins it paid. */
  objectiveDone(label: string, reward: number) {
    $('objective-banner-label').textContent = label;
    $('objective-banner-reward').textContent = `+${reward}`;
    const el = $('objective-banner');
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => el.classList.remove('show'), 4500);
  }

  toggleHelp() {
    $('help').hidden = !$('help').hidden;
    $('help-mini').hidden = !$('help').hidden;
  }

  setHealth(hp: number) {
    ($('health-fill') as HTMLElement).style.width = `${Math.max(0, hp)}%`;
    ($('health-fill') as HTMLElement).style.background = hp > 50 ? '#8fbf4a' : hp > 25 ? '#d9a33a' : '#d9503a';
    $('health-text').textContent = String(Math.max(0, Math.round(hp)));
  }

  /** Food and water bars, and radiation poisoning with a warning while you stand somewhere hot. */
  setVitals(v: { food: number; water: number; rads: number; level: number }) {
    const bar = (id: string, n: number) => {
      ($(`${id}-fill`) as HTMLElement).style.width = `${Math.max(0, Math.min(100, n))}%`;
      $(`${id}-text`).textContent = String(Math.round(n));
      $(id).classList.toggle('low', n < 20);
    };
    bar('food', v.food);
    bar('water', v.water);
    bar('rads', v.rads);
    $('rads').hidden = v.rads < 1 && v.level <= 0;
    const warn = $('rad-warning');
    warn.hidden = v.level <= 0;
    if (v.level > 0) warn.textContent = `Radiation ${v.level.toFixed(1)}/s`;
    ($('rad-tint') as HTMLElement).style.opacity = String(Math.min(0.55, v.level * 0.08 + v.rads * 0.002));
  }

  /** A red flash at the edges of the screen when you take damage. */
  hurt() {
    const el = $('damage');
    el.classList.add('show');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('show')));
  }

  hitmarker(head: boolean) {
    const el = $('hitmarker');
    el.classList.toggle('head', head);
    el.classList.remove('fade');
    el.classList.add('show');
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('fade');
    }, 90);
  }

  /** A line in the kill feed; `mine` when you were the killer or the one killed. */
  killFeed(killer: string | null, victim: string, weapon: string | null, head: boolean, mine: boolean, how: string | null = null) {
    const feed = $('kill-feed');
    const row = document.createElement('div');
    row.className = `kill${mine ? ' me' : ''}`;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    row.innerHTML = killer
      ? `<b>${esc(killer)}</b> killed <b>${esc(victim)}</b>${weapon ? ` <span class="with">· ${esc(weapon)}</span>` : ''}${head ? ' <span class="hs">headshot</span>' : ''}`
      : `<b>${esc(victim)}</b> ${how ?? 'died'}`;
    feed.prepend(row);
    while (feed.children.length > 5) feed.lastElementChild!.remove();
    fadeOut(row, 6000);
  }

  /** "+6 Wood" in the corner when items arrive in your inventory (or "-" when they leave a stack). */
  pickup(icon: string, name: string, n: number) {
    const list = $('pickups');
    // Add to a recent line for the same item rather than stacking duplicates.
    const key = `${name}:${n > 0 ? '+' : '-'}`;
    let row = [...list.children].find((r) => (r as HTMLElement).dataset.key === key && !r.classList.contains('fade')) as HTMLElement | undefined;
    if (row) {
      const total = Number(row.dataset.n) + n;
      row.dataset.n = String(total);
      row.querySelector('.n')!.textContent = `${total > 0 ? '+' : ''}${total}`;
      clearTimeout(Number(row.dataset.timer));
    } else {
      row = document.createElement('div');
      row.className = `pickup${n < 0 ? ' lost' : ''}`;
      row.dataset.key = key;
      row.dataset.n = String(n);
      row.innerHTML = `${icon}<span class="n">${n > 0 ? '+' : ''}${n}</span> ${name}`;
      list.append(row);
      while (list.children.length > 6) list.firstElementChild!.remove();
    }
    row.dataset.timer = String(fadeOut(row, 3000));
  }

  /** A red arc round the crosshair pointing to where a hit came from; `angle` 0 is ahead, clockwise. */
  damageFrom(angle: number) {
    const el = document.createElement('div');
    el.className = 'dmg-dir';
    el.style.transform = `rotate(${angle}rad)`;
    $('damage-dirs').append(el);
    fadeOut(el, 700);
  }

  /** Rounds loaded and carried for the gun in your hands, or nothing. */
  setAmmo(a: { loaded: number; mag: number; carried: number; name: string; reloading: boolean } | null) {
    const el = $('ammo');
    el.hidden = !a;
    if (!a) return;
    const html = `<b>${a.reloading ? '…' : a.loaded}</b> / ${a.mag}<small>${a.reloading ? 'Reloading' : `${a.carried} ${a.name}`}</small>`;
    if (el.innerHTML !== html) el.innerHTML = html;
    el.classList.toggle('empty', a.loaded === 0 && !a.reloading);
  }

  setScope(on: boolean) {
    $('scope').hidden = !on;
    $('crosshair').hidden = on;
  }

  /**
   * The death screen, with a button for each of your sleeping bags (greyed out while it cools
   * down). It stays up until you are actually back on your feet.
   */
  showDeath(text: string, onRespawn: () => void, bags: { id: number; label: string; wait: () => number }[] = [], onBag: (id: number) => void = () => {}) {
    $('death-text').textContent = text;
    $('death').hidden = false;
    $('respawn').onclick = onRespawn;
    const list = $('bags');
    list.replaceChildren();
    for (const bag of bags) {
      const button = document.createElement('button');
      button.onclick = () => onBag(bag.id);
      list.append(button);
      const tick = () => {
        if ($('death').hidden || !button.isConnected) return;
        const wait = bag.wait();
        button.disabled = wait > 0;
        button.textContent = wait > 0 ? `${bag.label} (ready in ${wait} s)` : `Wake up in ${bag.label}`;
        setTimeout(tick, 500);
      };
      tick();
    }
  }

  hideDeath() {
    $('death').hidden = true;
  }

  /** Whether the code pad is up, so keys go to it and not the game. */
  get codeOpen(): boolean {
    return !$('code').hidden;
  }

  /** Asks for a 4-digit code; `done` gets it, or nothing if cancelled. */
  askCode(title: string, done: (code: string | null) => void) {
    const box = $('code');
    const input = $('code-input') as HTMLInputElement;
    $('code-title').textContent = title;
    input.value = '';
    box.hidden = false;
    document.exitPointerLock?.();
    setTimeout(() => input.focus(), 0);
    const finish = (code: string | null) => {
      box.hidden = true;
      input.onkeydown = null;
      done(code);
    };
    input.oninput = () => (input.value = input.value.replace(/\D/g, '').slice(0, 4));
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter' && input.value.length === 4) finish(input.value);
      if (e.key === 'Escape') finish(null);
    };
    $('code-ok').onclick = () => input.value.length === 4 && finish(input.value);
    $('code-cancel').onclick = () => finish(null);
  }

  disconnected() {
    $('disconnected').hidden = false;
  }
}

/** Fades an element out after `ms`, then removes it. Returns the timer. */
function fadeOut(el: HTMLElement, ms: number): number {
  return window.setTimeout(() => {
    el.classList.add('fade');
    setTimeout(() => el.remove(), 650);
  }, ms);
}
