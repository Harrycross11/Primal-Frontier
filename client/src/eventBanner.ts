// The live event banner, under the compass: where the raiders are, how many are left, how far
// away it is and how the locked crate is getting on, so a raid is never more than a glance away.

import { countdown, type LiveEvent } from '../../shared/events.ts';

export class EventBanner {
  private el = document.createElement('div');
  private title = document.createElement('b');
  private line = document.createElement('span');
  private shown = '';

  constructor(parent: HTMLElement) {
    this.el.id = 'event-banner';
    this.el.hidden = true;
    const tag = document.createElement('small');
    tag.textContent = 'Live event';
    this.el.append(tag, this.title, this.line);
    parent.appendChild(this.el);
  }

  /** Redraws for someone at (x, z), if anything they would see changed. */
  update(event: LiveEvent | null, x: number, z: number, now: number) {
    if (!event) {
      this.el.hidden = true;
      this.shown = '';
      return;
    }
    const dist = Math.round(Math.hypot(event.x - x, event.z - z));
    const raiders = event.raiders === 0 ? 'every raider down' : `${event.raiders} raider${event.raiders === 1 ? '' : 's'}`;
    const title = `Raid at ${event.place}  ·  ${dist} m`;
    const crate = event.open
      ? `Crate open: loot it before they go (${countdown(event.ends, now)})`
      : event.hackEnd
        ? `${event.hacker ?? 'Someone'} is hacking the crate: opens in ${countdown(event.hackEnd, now)}`
        : `Locked crate: get to it and press E to hack it`;
    const key = `${title}|${raiders}|${crate}`;
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = false;
    this.el.classList.toggle('hot', !!event.hackEnd && !event.open);
    this.el.classList.toggle('open', event.open);
    this.title.textContent = title;
    this.line.textContent = `${raiders}  ·  ${crate}`;
  }
}
