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
    $('quality').textContent = q === 'high' ? 'High' : 'Low';
  }

  notice(text: string) {
    const el = $('notice');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => el.classList.remove('show'), 2200);
  }

  toggleHelp() {
    $('help').hidden = !$('help').hidden;
  }

  setHealth(hp: number) {
    ($('health-fill') as HTMLElement).style.width = `${Math.max(0, hp)}%`;
    ($('health-fill') as HTMLElement).style.background = hp > 50 ? '#8fbf4a' : hp > 25 ? '#d9a33a' : '#d9503a';
    $('health-text').textContent = String(Math.max(0, Math.round(hp)));
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

  showDeath(text: string, onRespawn: () => void) {
    $('death-text').textContent = text;
    $('death').hidden = false;
    $('respawn').onclick = () => {
      $('death').hidden = true;
      onRespawn();
    };
  }

  disconnected() {
    $('disconnected').hidden = false;
  }
}
