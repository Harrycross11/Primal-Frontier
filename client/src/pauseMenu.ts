// The in-game menu when you let go of the mouse (Esc): resume, today's objectives, settings,
// controls, and leaving for the main menu.

import type { AccountView } from '../../shared/shop.ts';
import type { Quality } from './graphics.ts';
import { renderObjectives, timeLeft } from './lobby.ts';

const $ = (id: string) => document.getElementById(id)!;

type Section = 'objectives' | 'settings' | 'controls';

export class PauseMenu {
  private section: Section = 'objectives';
  private account: AccountView | null = null;
  onResume: () => void = () => {};
  onQuality: (q: Quality) => void = () => {};
  /** Wants fresh objectives from the server. */
  onOpen: () => void = () => {};
  quality: Quality = 'high';

  constructor() {
    $('pause-resume').onclick = () => this.onResume();
    $('pause-leave').onclick = () => location.reload();
    for (const b of document.querySelectorAll<HTMLButtonElement>('#pause [data-section]')) b.onclick = () => this.show(b.dataset.section as Section);
    for (const b of document.querySelectorAll<HTMLButtonElement>('#pause-quality button')) {
      b.onclick = () => {
        this.quality = b.dataset.q as Quality;
        this.onQuality(this.quality);
        this.render();
      };
    }
  }

  get open(): boolean {
    return !$('pause').hidden;
  }

  showMenu() {
    $('pause').hidden = false;
    this.onOpen();
    this.render();
  }

  hide() {
    $('pause').hidden = true;
  }

  setAccount(account: AccountView | null) {
    this.account = account;
    if (this.open) this.render();
  }

  private show(section: Section) {
    this.section = section;
    this.render();
  }

  private render() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('#pause [data-section]')) b.classList.toggle('on', b.dataset.section === this.section);
    for (const el of document.querySelectorAll<HTMLElement>('#pause .pause-page')) el.hidden = el.dataset.page !== this.section;
    renderObjectives($('pause-objectives'), this.account);
    $('pause-coins').textContent = this.account ? this.account.coins.toLocaleString() : '–';
    $('pause-reset').textContent = this.account ? `Resets in ${timeLeft(this.account.resetIn)}` : '';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#pause-quality button')) b.classList.toggle('on', b.dataset.q === this.quality);
  }
}
