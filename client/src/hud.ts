// The on-screen interface: join screen, inventory, hotbar, target hint, notices and player list.

import type { BlockType, Inventory } from '../../shared/world.ts';

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

  setSelected(type: BlockType) {
    for (const el of document.querySelectorAll<HTMLElement>('.slot')) {
      el.classList.toggle('active', el.dataset.block === type);
    }
  }

  setTarget(text: string) {
    const el = $('target');
    if (el.textContent !== text) el.textContent = text;
    el.hidden = !text;
  }

  setPlayers(names: string[]) {
    $('player-count').textContent = `${names.length} survivor${names.length === 1 ? '' : 's'} online`;
    $('player-list').textContent = names.join(', ');
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
