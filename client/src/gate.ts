// The loading screen ("gate") in front of everything: on first load it shows each step of
// getting the game ready, and later it covers a wipe or a lost connection while the server comes
// back. It is in the page from the first paint (index.html), so nobody stares at a blank screen
// while the script arrives.

const $ = (id: string) => document.getElementById(id)!;

export type StepState = 'wait' | 'run' | 'done' | 'fail' | 'warn';

export interface GateScreen {
  kicker: string;
  title: string;
  text?: string;
  steps: string[];
}

/** Things worth knowing, shown one at a time while the world loads. */
const TIPS: [string, string][] = [
  ['Wipes', 'The world is wiped every month. Coins, packs and the season pass are kept by your account.'],
  ['Accounts', 'Sign in from the menu to keep your survivor and coins on any browser.'],
  ['Shelter', 'A tool cupboard stops anyone else building near your base. Lock your doors with a keypad.'],
  ['Night', 'Nights are dark and cold. A campfire cooks meat and keeps you warm.'],
  ['Cover', 'Trees, rocks and wrecks stop bullets. Lean out, shoot, and get back behind them.'],
  ['Recyclers', 'Every landmark has a recycler: it turns junk into scrap and parts.'],
  ['Raids', 'Raiders take a landmark now and then. Hack their crate for the best loot in the wasteland.'],
  ['Low frame rate?', 'Press O in game for graphics settings. Low runs well on most laptops.'],
];

export class Gate {
  private tipTimer = 0;
  private retry: (() => void) | null = null;
  private back: (() => void) | null = null;

  constructor() {
    $('gate-retry').addEventListener('click', () => this.retry?.());
    $('gate-back').addEventListener('click', () => this.back?.());
  }

  get open() {
    return !$('gate').hidden && !$('gate').classList.contains('closing');
  }

  /** Puts up a screen; `over` lays it over the game (dimmed) rather than on black. */
  show(screen: GateScreen, over = false) {
    const gate = $('gate');
    gate.hidden = false;
    gate.classList.remove('closing');
    gate.classList.toggle('over', over);
    $('gate-kicker').textContent = screen.kicker;
    $('gate-title').textContent = screen.title;
    $('gate-text').textContent = screen.text ?? '';
    $('gate-steps').replaceChildren(
      ...screen.steps.map((s) => {
        const li = document.createElement('li');
        li.append(document.createElement('i'), Object.assign(document.createElement('span'), { textContent: s }), document.createElement('small'));
        return li;
      }),
    );
    $('gate-actions').hidden = true;
    this.progress(0);
    this.status('');
    if (!this.tipTimer) this.tips();
  }

  /** Sets one step's state, with a short note beside it. */
  step(i: number, state: StepState, note?: string) {
    const li = $('gate-steps').children[i] as HTMLElement | undefined;
    if (!li) return;
    li.className = state === 'wait' ? '' : state;
    if (note !== undefined) li.querySelector('small')!.textContent = note;
  }

  /** How far along it is, 0 to 1; null for "working on it" with no way to tell how far. */
  progress(fraction: number | null) {
    const bar = $('gate-fill').parentElement!;
    bar.classList.toggle('busy', fraction === null);
    if (fraction !== null) {
      const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
      $('gate-fill').style.width = `${pct}%`;
      $('gate-pct').textContent = `${pct}%`;
    } else $('gate-pct').textContent = '';
  }

  status(text: string) {
    $('gate-status').textContent = text;
  }

  /** Changes the words at the top without starting over. */
  say(title: string, text?: string) {
    $('gate-title').textContent = title;
    if (text !== undefined) $('gate-text').textContent = text;
  }

  /** Something went wrong: says what, and offers to try again (and, given `back`, a way out). */
  fail(title: string, text: string, retry: () => void, back?: { label: string; go: () => void }) {
    this.say(title, text);
    this.progress(0);
    $('gate-fill').parentElement!.classList.remove('busy');
    this.retry = () => {
      $('gate-actions').hidden = true;
      retry();
    };
    this.back = back?.go ?? null;
    $('gate-back').hidden = !back;
    if (back) $('gate-back').textContent = back.label;
    $('gate-actions').hidden = false;
    ($('gate-retry') as HTMLButtonElement).focus();
  }

  /** Fades away. */
  close() {
    const gate = $('gate');
    if (gate.hidden) return;
    gate.classList.add('closing');
    clearInterval(this.tipTimer);
    this.tipTimer = 0;
    setTimeout(() => {
      if (gate.classList.contains('closing')) gate.hidden = true;
    }, 700);
  }

  private tips() {
    let i = Math.floor(Math.random() * TIPS.length);
    const tip = $('gate-tip');
    const next = () => {
      const [head, body] = TIPS[i++ % TIPS.length];
      tip.style.opacity = '0';
      setTimeout(() => {
        tip.innerHTML = '<b></b>';
        tip.querySelector('b')!.textContent = head;
        tip.append(body);
        tip.style.opacity = '1';
      }, 400);
    };
    next();
    this.tipTimer = window.setInterval(next, 7000);
  }
}

/** The world's size so far in downloaded megabytes, for the loading screen. */
export function downloadedMb(): number {
  let bytes = 0;
  for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) bytes += e.transferSize || e.encodedBodySize || 0;
  return bytes / 1e6;
}

export interface ServerHealth {
  ok: boolean;
  seed: number;
  startedAt: string;
}

/** Asks the server if it is up, giving up after `ms`. Null if it isn't (or didn't say in time). */
export async function health(ms = 6000): Promise<ServerHealth | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  try {
    const res = await fetch('/health', { cache: 'no-store', signal: abort.signal });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.ok ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** m:ss */
export const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
