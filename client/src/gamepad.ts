// Xbox and PlayStation controllers, through the browser's Gamepad API (Chrome, Edge on Xbox,
// Safari and Firefox all give the same "standard" button layout). In play the sticks move and
// look, and the buttons press the game's keyboard keys. In every menu the D-pad or left stick
// moves a highlight between buttons, A presses it and B goes back, so the whole game works
// without a mouse.

/** Buttons in the standard layout, named as on an Xbox pad. */
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;
export type ButtonName = keyof typeof BUTTON;

/** What the game hooks in once you are in the world. */
export interface PadGame {
  /** True while the world, not a menu, has the controller. */
  playing(): boolean;
  /** A button went down or up while playing. */
  button(name: ButtonName, down: boolean): void;
}

/** In play, these buttons press these keys. The rest go to {@link PadGame.button}. */
const GAME_KEYS: Partial<Record<ButtonName, string>> = {
  A: 'Space',
  X: 'KeyR',
  Y: 'KeyE',
  B: 'KeyG',
  VIEW: 'Tab',
  UP: 'KeyM',
  DOWN: 'KeyH',
  LEFT: 'KeyP',
  RIGHT: 'KeyT',
  RS: 'KeyV',
};

/** Anything a highlight can land on in a menu. */
const FOCUSABLE = 'button, input:not([type=hidden]), select, textarea, a[href], [tabindex]:not([tabindex="-1"]), .slot[data-ref], .recipe, .tnode, .cat, .look-row button';
/** Strips of tabs that LB and RB step through, first one on screen wins. */
const TAB_STRIPS = ['#lobby-tabs button', '#pause [data-section]', '#paint-tabs button'];
const DEAD = 0.18;
const NAV_DELAY = 0.38;
const NAV_REPEAT = 0.13;

const deadzone = (v: number) => (Math.abs(v) < DEAD ? 0 : Math.sign(v) * ((Math.abs(v) - DEAD) / (1 - DEAD)));

export class Gamepads {
  /** The last thing touched was a controller (not the mouse or keyboard). */
  active = false;
  /** Xbox or PlayStation, for the button names shown on screen. */
  family: 'xbox' | 'playstation' = 'xbox';
  /** Left stick, -1..1: x right, y forward. */
  readonly move = { x: 0, y: 0 };
  /** Right stick, -1..1, with a curve so small pushes aim finely. */
  readonly look = { x: 0, y: 0 };
  game: PadGame | null = null;
  /** Called when the active state or the kind of pad changes. */
  onChange: (() => void) | null = null;

  private prev: boolean[] = [];
  private focus: HTMLElement | null = null;
  private navDir = '';
  private navNext = 0;
  private sprint = false;
  private picked = false;
  private last = 0;
  private toastTimer = 0;
  private ring: HTMLElement | null = null;
  private legend: HTMLElement | null = null;
  private legendText = '';
  private swaps: { el: HTMLElement; mouse: string; pad: () => string }[] = [];

  constructor() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    // Edge on Xbox drives a mouse pointer with the pad unless a page asks for the pad itself.
    if ('gamepadInputEmulation' in navigator) (navigator as Navigator & { gamepadInputEmulation: string }).gamepadInputEmulation = 'gamepad';
    addEventListener('gamepadconnected', (e) => {
      // Sony's vendor id is 054c; Chrome calls a DualShock 4 just "Wireless Controller".
      this.family = !/xbox|xinput|045e/i.test(e.gamepad.id) && /054c|dualsense|dualshock|playstation|wireless controller/i.test(e.gamepad.id) ? 'playstation' : 'xbox';
      this.toast(`Controller connected · ${this.label('VIEW')} inventory · ${this.label('MENU')} menu`);
      this.applySwaps();
      this.onChange?.();
    });
    addEventListener('gamepaddisconnected', () => {
      if (!navigator.getGamepads().some((p) => p?.connected)) this.setActive(false);
    });
    // Moving the mouse or typing hands control back to them.
    addEventListener('mousemove', (e) => {
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) this.setActive(false);
    });
    addEventListener('keydown', (e) => e.isTrusted && this.setActive(false));
    const loop = (now: number) => {
      this.tick(now / 1000);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** What a button is called on the pad in hand. */
  label(name: ButtonName): string {
    if (this.family === 'playstation') {
      const ps: Partial<Record<ButtonName, string>> = { A: '✕', B: '○', X: '□', Y: '△', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', VIEW: 'Share', MENU: 'Options', LS: 'L3', RS: 'R3' };
      if (ps[name]) return ps[name]!;
    }
    const xbox: Partial<Record<ButtonName, string>> = { VIEW: 'View', MENU: 'Menu', UP: 'D-pad up', DOWN: 'D-pad down', LEFT: 'D-pad left', RIGHT: 'D-pad right' };
    return xbox[name] ?? name;
  }

  /** A button drawn as it looks on the pad: A, B, X and Y in their colours, the rest as a key. */
  glyph(name: ButtonName): string {
    const face = name === 'A' || name === 'B' || name === 'X' || name === 'Y';
    return `<b class="glyph${face ? ` g-${name.toLowerCase()}` : ''}">${this.label(name)}</b>`;
  }

  /** Shows `html()` in an element while a controller is in use, and its own text otherwise. */
  swap(el: HTMLElement | null, html: () => string) {
    if (!el) return;
    this.swaps.push({ el, mouse: el.innerHTML, pad: html });
    if (this.active) el.innerHTML = html();
  }

  private applySwaps() {
    for (const s of this.swaps) s.el.innerHTML = this.active ? s.pad() : s.mouse;
  }

  /** Swaps mouse and keyboard words in an on-screen hint for the controller's buttons. */
  words(text: string): string {
    if (!this.active) return text;
    return text
      .replace(/Left click/g, this.label('RT'))
      .replace(/left click/g, this.label('RT'))
      .replace(/Right click/g, this.label('LT'))
      .replace(/right click/g, this.label('LT'))
      .replace(/\bE to\b/g, `${this.label('Y')} to`)
      .replace(/\bP to\b/g, `${this.label('LEFT')} to`)
      .replace(/\bR to\b/g, `${this.label('X')} to`)
      .replace(/\bG to\b/g, `${this.label('B')} to`)
      .replace(/\bR: /g, `${this.label('X')}: `)
      .replace(/\bP: /g, `${this.label('LEFT')}: `)
      .replace(/\bPress Tab\b/g, `Press ${this.label('VIEW')}`);
  }

  private setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    document.body.classList.toggle('pad', on);
    this.applySwaps();
    if (!on) {
      this.blur();
      this.ring?.classList.remove('on');
      this.legend?.classList.remove('on');
      this.move.x = this.move.y = this.look.x = this.look.y = 0;
      if (this.sprint) this.key('ShiftLeft', false);
      this.sprint = false;
    }
    this.onChange?.();
  }

  private tick(now: number) {
    const dt = Math.min(0.1, this.last ? now - this.last : 0);
    this.last = now;
    const gp = navigator.getGamepads().find((p) => p?.connected && p.mapping === 'standard') ?? navigator.getGamepads().find((p) => p?.connected);
    if (!gp) return;
    const pressed = gp.buttons.map((b, i) => (i === BUTTON.LT || i === BUTTON.RT ? b.value > 0.35 : b.pressed));
    const ax = gp.axes.map(deadzone);
    const lx = ax[0] ?? 0, ly = ax[1] ?? 0, rx = ax[2] ?? 0, ry = ax[3] ?? 0;
    if (!this.active && (pressed.some(Boolean) || Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.3)) this.setActive(true);
    if (!this.active) {
      this.prev = pressed;
      return;
    }
    const playing = this.game?.playing() ?? false;
    const names = Object.keys(BUTTON) as ButtonName[];
    if (playing) {
      this.blur();
      this.move.x = lx;
      this.move.y = -ly;
      const curve = (v: number) => Math.sign(v) * v * v;
      this.look.x = curve(rx);
      this.look.y = curve(ry);
      // Click the left stick to run; let go of the stick to stop.
      if (this.sprint && Math.hypot(lx, ly) < 0.2) {
        this.sprint = false;
        this.key('ShiftLeft', false);
      }
      for (const name of names) {
        const i = BUTTON[name];
        if (!!pressed[i] === !!this.prev[i]) continue;
        const down = !!pressed[i];
        if (name === 'LS') {
          if (down && !this.sprint) {
            this.sprint = true;
            this.key('ShiftLeft', true);
          }
        } else if (GAME_KEYS[name]) this.key(GAME_KEYS[name]!, down);
        else this.game!.button(name, down);
      }
    } else {
      this.move.x = this.move.y = this.look.x = this.look.y = 0;
      if (this.sprint) this.key('ShiftLeft', false);
      this.sprint = false;
      this.menu(pressed, lx, ly, ry, now, dt);
    }
    this.prev = pressed;
    this.drawRing();
    this.drawLegend(playing);
  }

  /** Menus: move the highlight, press, go back, switch tabs, scroll. */
  private menu(pressed: boolean[], lx: number, ly: number, ry: number, now: number, dt: number) {
    const hit = (name: ButtonName) => pressed[BUTTON[name]] && !this.prev[BUTTON[name]];
    const dir = pressed[BUTTON.UP] || ly < -0.5 ? 'up' : pressed[BUTTON.DOWN] || ly > 0.5 ? 'down' : pressed[BUTTON.LEFT] || lx < -0.5 ? 'left' : pressed[BUTTON.RIGHT] || lx > 0.5 ? 'right' : '';
    if (this.focus && !this.usable(this.focus)) {
      this.blur();
      this.picked = false;
    }
    if (!this.focus && (dir || hit('A'))) {
      this.setFocus(this.firstChoice());
      this.navDir = dir;
      this.navNext = now + NAV_DELAY;
      return;
    }
    if (dir && (dir !== this.navDir || now >= this.navNext)) {
      const next = this.neighbour(dir);
      if (next) this.setFocus(next);
      this.navNext = now + (dir === this.navDir ? NAV_REPEAT : NAV_DELAY);
    }
    this.navDir = dir;
    if (hit('A') && this.focus) this.press(this.focus);
    if (hit('X') && this.focus?.matches('.slot[data-ref]')) this.pickOrDrop(this.focus);
    if (hit('B') || hit('MENU')) this.key('Escape');
    if (hit('VIEW')) this.key('Tab');
    if (hit('LB') || hit('RB')) this.stepTabs(hit('RB') ? 1 : -1);
    // The right stick scrolls whatever the highlight is in.
    if (ry && this.focus) {
      const box = scrollParent(this.focus);
      if (box) box.scrollTop += ry * 900 * dt;
    }
  }

  /** The highlight: corner marks round the chosen button, following it as it moves. */
  private drawRing() {
    if (!this.ring) {
      this.ring = document.createElement('div');
      this.ring.id = 'pad-ring';
      document.body.appendChild(this.ring);
    }
    const el = this.focus;
    this.ring.classList.toggle('on', !!el);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const st = this.ring.style;
    st.left = `${r.left - 5}px`;
    st.top = `${r.top - 5}px`;
    st.width = `${r.width + 10}px`;
    st.height = `${r.height + 10}px`;
  }

  /** What the buttons do here, along the bottom of any menu. */
  private drawLegend(playing: boolean) {
    if (!this.legend) {
      this.legend = document.createElement('div');
      this.legend.id = 'pad-legend';
      document.body.appendChild(this.legend);
    }
    // On an item slot: what A and X do with the stack in it (or with the one picked up).
    const slot = !!this.focus?.matches('.slot[data-ref]') && (this.picked || !!this.focus.querySelector('svg, img'));
    const parts = playing
      ? []
      : [
          [slot ? (this.picked ? 'Put down' : 'Move across') : 'Select', 'A'],
          ...(slot ? [[this.picked ? 'Put down here' : 'Pick up', 'X']] : []),
          ['Back', 'B'],
          ...(TAB_STRIPS.some((sel) => [...document.querySelectorAll<HTMLElement>(sel)].filter((t) => this.usable(t)).length > 1) ? [['Tabs', 'LB', 'RB']] : []),
        ];
    const html = parts.map(([what, ...b]) => `<span>${b.map((n) => this.glyph(n as ButtonName)).join('')}${what}</span>`).join('');
    if (html !== this.legendText) {
      this.legendText = html;
      this.legend.innerHTML = html;
    }
    this.legend.classList.toggle('on', !playing && !!html);
  }

  private press(el: HTMLElement) {
    if (el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select')) return el.focus();
    // A on an item sends it across, like a right click.
    if (el.matches('.slot[data-ref]')) {
      if (this.picked) return this.pickOrDrop(el);
      return this.pointer(el, 'pointerdown', 2);
    }
    el.click();
  }

  /** X picks a stack up and X again puts it down on the highlighted slot. */
  private pickOrDrop(el: HTMLElement) {
    if (!this.picked) {
      if (!el.querySelector('svg, img')) return;
      this.picked = true;
      this.pointer(el, 'pointerdown', 0);
    } else {
      this.picked = false;
      const r = el.getBoundingClientRect();
      dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, bubbles: true }));
    }
  }

  private pointer(el: HTMLElement, type: string, button: number) {
    const r = el.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button, buttons: button === 2 ? 2 : 1, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent(type, at));
    dispatchEvent(new PointerEvent('pointermove', at));
  }

  private stepTabs(step: number) {
    for (const sel of TAB_STRIPS) {
      const tabs = [...document.querySelectorAll<HTMLElement>(sel)].filter((t) => this.usable(t));
      if (tabs.length < 2) continue;
      const on = Math.max(0, tabs.findIndex((t) => t.classList.contains('on')));
      const next = tabs[(on + step + tabs.length) % tabs.length];
      next.click();
      this.blur();
      return;
    }
  }

  /** Where the highlight starts: the main button on screen, or the first thing it can land on. */
  private firstChoice(): HTMLElement | null {
    for (const sel of ['#gate button', '#code-input', '#respawn', '#play', '#pause-resume']) {
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => this.usable(e));
      if (el) return el;
    }
    // Otherwise the top-left choice in the page itself, not the tab bar above it.
    const all = this.candidates();
    const content = all.filter((e) => !e.closest('header, nav'));
    const pick = (content.length ? content : all).map((e) => ({ e, r: e.getBoundingClientRect() }));
    pick.sort((a, b) => Math.round(a.r.top / 8) - Math.round(b.r.top / 8) || a.r.left - b.r.left);
    return pick[0]?.e ?? null;
  }

  private candidates(): HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => this.usable(e));
  }

  /** On screen, not disabled and not under another panel. */
  private usable(el: HTMLElement): boolean {
    if (!el.isConnected || (el as HTMLButtonElement).disabled) return false;
    if (el.checkVisibility ? !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !el.offsetParent) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const box = scrollParent(el);
    const view = box ? box.getBoundingClientRect() : new DOMRect(0, 0, innerWidth, innerHeight);
    // Scrolled out of its list: still a choice if the list itself can be seen.
    const cx = Math.min(Math.max(r.left + r.width / 2, view.left + 2), view.right - 2);
    const cy = Math.min(Math.max(r.top + r.height / 2, view.top + 2), view.bottom - 2);
    if (cx < 0 || cy < 0 || cx > innerWidth || cy > innerHeight) return false;
    const top = document.elementFromPoint(cx, cy);
    if (!top) return false;
    const inside = r.left + r.width / 2 === cx && r.top + r.height / 2 === cy;
    return inside ? el === top || el.contains(top) : !!box && (box === top || box.contains(top));
  }

  /** The nearest choice in a direction, favouring ones straight ahead over ones off to the side. */
  private neighbour(dir: string): HTMLElement | null {
    if (!this.focus) return null;
    const from = this.focus.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    const [dx, dy] = dir === 'up' ? [0, -1] : dir === 'down' ? [0, 1] : dir === 'left' ? [-1, 0] : [1, 0];
    let best: HTMLElement | null = null;
    let score = Infinity;
    for (const el of this.candidates()) {
      if (el === this.focus || el.contains(this.focus) || this.focus.contains(el)) continue;
      const r = el.getBoundingClientRect();
      // Measured edge to edge along the direction, centre to centre across it.
      const ahead = dx ? (dx > 0 ? r.left - from.right : from.left - r.right) : dy > 0 ? r.top - from.bottom : from.top - r.bottom;
      const along = dx ? (r.left + r.width / 2 - fx) * dx : (r.top + r.height / 2 - fy) * dy;
      if (along <= 2 || ahead < -Math.min(from.width, from.height, r.width, r.height) / 2) continue;
      const across = dx ? Math.max(0, Math.max(r.top - from.bottom, from.top - r.bottom)) : Math.max(0, Math.max(r.left - from.right, from.left - r.right));
      const s = Math.max(0, ahead) + across * 3 + (across > 0 ? 40 : 0);
      if (s < score) {
        score = s;
        best = el;
      }
    }
    return best;
  }

  private setFocus(el: HTMLElement | null) {
    if (el === this.focus) return;
    this.blur();
    if (!el) return;
    this.focus = el;
    el.classList.add('pad-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // Item slots show their tooltip as the mouse would.
    if (el.matches('.slot[data-ref]')) {
      el.dispatchEvent(new PointerEvent('pointerenter'));
      const r = el.getBoundingClientRect();
      dispatchEvent(new PointerEvent('pointermove', { clientX: r.right, clientY: r.top }));
    }
  }

  private blur() {
    if (!this.focus) return;
    this.focus.classList.remove('pad-focus');
    if (this.focus.matches('.slot[data-ref]')) this.focus.dispatchEvent(new PointerEvent('pointerleave'));
    this.focus = null;
  }

  private key(code: string, down = true) {
    const key = code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(3).toLowerCase() : code;
    // Sent to a focused text box (the door code box listens there); it bubbles up to the page.
    const to: EventTarget = document.activeElement instanceof HTMLInputElement ? document.activeElement : window;
    to.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key, bubbles: true, cancelable: true }));
    if (down && code === 'Escape') to.dispatchEvent(new KeyboardEvent('keyup', { code, key, bubbles: true }));
  }

  private toast(text: string) {
    let el = document.getElementById('pad-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pad-toast';
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el!.classList.remove('show'), 4000);
  }
}

/** The closest ancestor that scrolls, if any. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY + s.overflowX) && (p.scrollHeight > p.clientHeight + 1 || p.scrollWidth > p.clientWidth + 1)) return p;
  }
  return null;
}

export const pad = new Gamepads();
