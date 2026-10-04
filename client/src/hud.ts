// The on-screen interface: join screen, inventory, hotbar, target info, notices and player list.

import type { Inventory, Material } from '../../shared/world.ts';
import type { Quality } from './graphics.ts';

export type Slot = 'hands' | 'wall' | 'floor' | 'stairs';

const $ = (id: string) => document.getElementById(id)!;

export class Hud {
  private noticeTimer = 0;

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

  setInventory(inv: Inventory) {
    $('inv-wood').textContent = String(inv.wood);
    $('inv-scrap').textContent = String(inv.scrap);
  }

  setSlot(slot: Slot, material: Material) {
    for (const el of document.querySelectorAll<HTMLElement>('.slot')) {
      el.classList.toggle('active', el.dataset.slot === slot);
    }
    $('material').dataset.material = material;
    $('material-name').textContent = material === 'wood' ? 'Wood' : 'Scrap';
    document.body.classList.toggle('building', slot !== 'hands');
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

  disconnected() {
    $('disconnected').hidden = false;
  }
}
