// The new player's guide: a short list of first steps on the left of the screen (wood, stone,
// a hatchet, a foundation, a sleeping bag, a crate), ticked off as you do them. It remembers
// how far you got in this browser, and J hides it for good.

import { countItem, type Slots } from '../../shared/items.ts';
import { pad } from './gamepad.ts';

/** Things you did that a step may be waiting for. */
export type GuideEvent = 'built' | 'bagPlaced' | 'crateLooted';

interface Step {
  title: string;
  how: string;
  /** How far along, out of `goal`, for steps that count something. */
  count?: (slots: Slots) => number;
  goal?: number;
  /** Done from the inventory alone. */
  done?: (slots: Slots) => boolean;
  /** Done when this happens. */
  on?: GuideEvent;
}

const STEPS: Step[] = [
  { title: 'Gather wood', how: 'Hold the rock and hit a tree', count: (s) => countItem(s, 'wood'), goal: 60, done: (s) => countItem(s, 'stoneHatchet') > 0 },
  { title: 'Gather stone', how: 'Hit a grey boulder with the rock', count: (s) => countItem(s, 'stone'), goal: 30, done: (s) => countItem(s, 'stoneHatchet') > 0 },
  { title: 'Craft a stone hatchet', how: 'Press Tab, pick Stone Hatchet under Tools, then Craft', done: (s) => countItem(s, 'stoneHatchet') > 0 },
  { title: 'Build a foundation', how: 'Hold the Building Plan, right click until it says Foundation, left click to build', on: 'built' },
  { title: 'Pick hemp for cloth', how: 'Find tall green hemp plants and press E on them', count: (s) => countItem(s, 'cloth'), goal: 30, done: (s) => countItem(s, 'sleepingBag') > 0 },
  { title: 'Lay a sleeping bag', how: 'Craft a Sleeping Bag, hold it and left click on your foundation. You wake up there when you die', on: 'bagPlaced' },
  { title: 'Loot a crate', how: 'Follow a diamond on the compass to a landmark, press E on a crate and take what is inside', on: 'crateLooted' },
];

const KEY = 'pf-guide';
const FINISHED = 'done';

function load(): number | typeof FINISHED {
  try {
    const v = localStorage.getItem(KEY);
    if (v === FINISHED) return FINISHED;
    const n = Number(v ?? 0);
    return Number.isInteger(n) && n >= 0 && n < STEPS.length ? n : 0;
  } catch {
    return 0;
  }
}

function save(v: number | typeof FINISHED) {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // Not remembered; the guide still works for this visit.
  }
}

export class Guide {
  private el = document.createElement('div');
  private step = load();
  private slots: Slots = [];
  private shown = '';
  private onDone: (text: string) => void;

  /** `onDone` is told when a step or the whole guide is finished, for a sound and a notice. */
  constructor(parent: HTMLElement, onDone: (text: string) => void) {
    this.onDone = onDone;
    this.el.id = 'guide';
    parent.appendChild(this.el);
    this.render();
  }

  /** Whether the guide is still running. */
  get active() {
    return this.step !== FINISHED;
  }

  /** Hides the guide for good. */
  dismiss() {
    if (this.step === FINISHED) return;
    this.step = FINISHED;
    save(FINISHED);
    this.render();
  }

  /** Redraws the hint, e.g. when a controller is picked up and the buttons it names change. */
  refresh() {
    this.render();
  }

  inventory(slots: Slots) {
    this.slots = slots;
    this.advance();
  }

  happened(e: GuideEvent) {
    if (this.step === FINISHED || STEPS[this.step].on !== e) return;
    this.next();
  }

  /** Moves on past every step the inventory already shows done. */
  private advance() {
    while (this.step !== FINISHED) {
      const s = STEPS[this.step];
      const done = s.done?.(this.slots) || (s.count && s.goal !== undefined && s.count(this.slots) >= s.goal);
      if (!done) break;
      this.next();
    }
    this.render();
  }

  private next() {
    if (this.step === FINISHED) return;
    const finished = STEPS[this.step];
    this.step = this.step + 1 >= STEPS.length ? FINISHED : this.step + 1;
    save(this.step);
    this.onDone(this.step === FINISHED ? 'Guide finished. You are on your own now' : `Done: ${finished.title}`);
    this.advance();
  }

  private render() {
    if (this.step === FINISHED) {
      this.el.hidden = true;
      return;
    }
    const at = this.step;
    const s = STEPS[at];
    const progress = s.count && s.goal ? `${Math.min(s.goal, s.count(this.slots))} / ${s.goal}` : '';
    const key = `${at}|${progress}|${pad.active}`;
    if (key === this.shown) return;
    this.shown = key;
    this.el.hidden = false;
    this.el.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'guide-head';
    head.textContent = `First steps ${at + 1} / ${STEPS.length}`;
    const title = document.createElement('div');
    title.className = 'guide-title';
    title.textContent = s.title;
    if (progress) {
      const n = document.createElement('span');
      n.className = 'guide-count';
      n.textContent = progress;
      title.appendChild(n);
    }
    const how = document.createElement('div');
    how.className = 'guide-how';
    how.textContent = pad.words(s.how);
    const hide = document.createElement('div');
    hide.className = 'guide-hide';
    hide.innerHTML = '<kbd>J</kbd> Hide guide';
    this.el.append(head, title, how, hide);
  }
}
