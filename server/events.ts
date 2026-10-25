// Live server events (see shared/events.ts). Every half an hour or so, while anyone is playing,
// a crew of raiders takes one of the landmarks and sets down a locked crate. Whoever hacks it
// open gets the best loot in the game, if they can hold the spot for two minutes: more raiders
// come running as soon as the hack starts. Everyone hears when it begins, when someone starts
// the hack and when the crate opens.

import { HALF_WORLD } from '../shared/constants.ts';
import { deployableBox } from '../shared/deployables.ts';
import {
  EVENT_EVERY,
  EVENT_MINUTES,
  FIRST_EVENT,
  HACK_SECONDS,
  OPEN_MINUTES,
  POST_RADIUS,
  RAIDERS,
  REINFORCEMENTS,
  type LiveEvent,
} from '../shared/events.ts';
import { stashSpots } from '../shared/landmarks.ts';
import type { Bots } from './bots.ts';
import type { Game, Outgoing } from './game.ts';

/** How close you must be to the crate to hack it (as for opening any box). */
const HACK_RANGE = 3.5;
/** How far off the reinforcements turn up, in metres. */
const REINFORCE_FROM = 70;

export interface EventTiming {
  /** Minutes before the first raid once someone is playing, and between raids after that. */
  first: number;
  every: number;
  /** Always this landmark (its name or its land), for screenshots. */
  at?: string;
}

export class Events {
  private event: LiveEvent | null = null;
  private raiders: number[] = [];
  /** When the next raid is due (ms), or -1 until someone is playing. */
  private nextAt = -1;
  /** When the raiders last said how many of them are left, so it is sent only when it changes. */
  private sentRaiders = -1;

  constructor(
    private game: Game,
    private bots: Bots,
    private timing: EventTiming = { first: FIRST_EVENT, every: EVENT_EVERY },
    private rand: () => number = Math.random,
  ) {}

  /** The event going on now, if any. */
  get current(): LiveEvent | null {
    return this.event;
  }

  /** What someone joining is told, so they see a raid that is already going. */
  welcome(id: number): Outgoing[] {
    return this.event ? [{ to: id, msg: { t: 'event', event: this.event } }] : [];
  }

  tick(now: number): Outgoing[] {
    if (!this.game.loot) return [];
    const humans = [...this.game.players.keys()].filter((id) => !this.bots.isBot(id)).length;
    if (!this.event) {
      if (humans === 0) return [];
      if (this.nextAt < 0) this.nextAt = now + this.timing.first * 60_000;
      return now >= this.nextAt ? this.start(now) : [];
    }
    return this.run(now);
  }

  /** Raiders take a landmark: somewhere nobody is standing right now, if there is anywhere. */
  start(now: number): Outgoing[] {
    if (this.event) return [];
    const spots = stashSpots(this.game.seed);
    const players = [...this.game.players.values()].filter((p) => !p.dead && !this.bots.isBot(p.id));
    const clear = spots.filter((s) => !players.some((p) => Math.hypot(p.x - s.x, p.z - s.z) < 40));
    const forced = spots.filter((s) => s.name === this.timing.at || s.land === this.timing.at);
    const pool = forced.length ? forced : clear.length ? clear : spots;
    const spot = pool[Math.floor(this.rand() * pool.length)];
    const { crate, out } = this.game.spawnCrate('lockedCrate', spot.x, spot.y, spot.z, spot.rot);
    crate.locked = true;
    this.event = {
      kind: 'raid',
      place: spot.name,
      x: spot.x,
      z: spot.z,
      crate: crate.id,
      raiders: 0,
      open: false,
      ends: now + EVENT_MINUTES * 60_000,
    };
    for (let n = 0; n < RAIDERS; n++) {
      const a = (n / RAIDERS) * Math.PI * 2 + this.rand() * 0.8;
      const r = 4 + this.rand() * 6;
      out.push(...this.addRaider(spot.x + Math.cos(a) * r, spot.z + Math.sin(a) * r, now));
    }
    this.event.raiders = this.raiders.length;
    this.sentRaiders = this.raiders.length;
    out.push(
      { to: 'all', msg: { t: 'event', event: this.event } },
      { to: 'all', msg: { t: 'notice', text: `Raiders have taken ${spot.name}. They are guarding a locked crate` } },
    );
    return out;
  }

  /** Someone pressed E on the locked crate: start the hack, and call in the raiders' backup. */
  hack(id: number, crateId: number, now: number): Outgoing[] {
    const e = this.event;
    const p = this.game.players.get(id);
    const crate = this.game.deployables.get(crateId);
    if (!e || !p || p.dead || !crate || crate.id !== e.crate) return [];
    const tell = (text: string): Outgoing[] => [{ to: id, msg: { t: 'notice', text } }];
    if (!crate.locked) return tell('It is open: press E to loot it');
    if (crate.hackEnd) return tell(`Already being hacked: it opens in ${Math.ceil((crate.hackEnd - now) / 1000)} seconds`);
    const b = deployableBox(crate);
    const dx = Math.max(b.min[0] - p.x, 0, p.x - b.max[0]);
    const dz = Math.max(b.min[2] - p.z, 0, p.z - b.max[2]);
    if (Math.hypot(dx, dz) > HACK_RANGE || Math.abs(p.y - crate.y) > 3) return tell('Get closer to the crate');
    crate.hackEnd = now + HACK_SECONDS * 1000;
    e.hackEnd = crate.hackEnd;
    e.hacker = p.name;
    e.ends = Math.max(e.ends, crate.hackEnd + OPEN_MINUTES * 60_000);
    const out: Outgoing[] = [{ to: 'all', msg: { t: 'deployable', id: crate.id, d: crate, by: id } }];
    // Backup comes running from out past the landmark.
    const a = this.rand() * Math.PI * 2;
    for (let n = 0; n < REINFORCEMENTS; n++) {
      out.push(...this.addRaider(e.x + Math.cos(a + n * 0.3) * REINFORCE_FROM, e.z + Math.sin(a + n * 0.3) * REINFORCE_FROM, now));
    }
    e.raiders = this.alive();
    this.sentRaiders = e.raiders;
    out.push(
      { to: 'all', msg: { t: 'event', event: e } },
      { to: 'all', msg: { t: 'notice', text: `${p.name} is hacking the locked crate at ${e.place}. Raider backup is on its way` } },
    );
    return out;
  }

  private run(now: number): Outgoing[] {
    const e = this.event!;
    const out: Outgoing[] = [];
    // Raiders who fell have been taken away by the bots.
    this.raiders = this.raiders.filter((id) => this.bots.isBot(id));
    const crate = this.game.deployables.get(e.crate);
    if (crate?.locked && crate.hackEnd && now >= crate.hackEnd) {
      crate.locked = false;
      delete crate.hackEnd;
      e.open = true;
      e.ends = Math.max(e.ends, now + OPEN_MINUTES * 60_000);
      out.push(
        { to: 'all', msg: { t: 'deployable', id: crate.id, d: crate, by: 0 } },
        { to: 'all', msg: { t: 'event', event: e } },
        { to: 'all', msg: { t: 'notice', text: `The locked crate at ${e.place} is open` } },
      );
    }
    const looted = !crate || (!crate.locked && !crate.slots.some(Boolean));
    if (looted) return [...out, ...this.end(now, `The locked crate at ${e.place} has been looted`)];
    if (now >= e.ends) return [...out, ...this.end(now, e.open ? `The raid at ${e.place} is over` : `The raiders have pulled out of ${e.place}`)];
    const alive = this.alive();
    if (alive !== this.sentRaiders) {
      if (alive === 0 && this.sentRaiders > 0) out.push({ to: 'all', msg: { t: 'notice', text: `Every raider at ${e.place} is down` } });
      e.raiders = alive;
      this.sentRaiders = alive;
      out.push({ to: 'all', msg: { t: 'event', event: e } });
    }
    return out;
  }

  /** The raid is over: the raiders leave, the crate goes, and the next raid is a while off. */
  end(now: number, text: string): Outgoing[] {
    const e = this.event;
    if (!e) return [];
    const out: Outgoing[] = [];
    for (const id of this.raiders) out.push(...this.bots.dismiss(id));
    this.raiders = [];
    if (this.game.deployables.has(e.crate)) out.push(...this.game.removeDeployable(e.crate));
    this.event = null;
    this.nextAt = now + this.timing.every * 60_000 * (0.8 + this.rand() * 0.4);
    out.push({ to: 'all', msg: { t: 'event', event: null } }, { to: 'all', msg: { t: 'notice', text } });
    return out;
  }

  private addRaider(x: number, z: number, now: number): Outgoing[] {
    const e = this.event!;
    const edge = HALF_WORLD - 4;
    const added = this.bots.addRaider(Math.max(-edge, Math.min(edge, x)), Math.max(-edge, Math.min(edge, z)), { x: e.x, z: e.z, r: POST_RADIUS }, now);
    if (!added) return [];
    this.raiders.push(added.id);
    return added.out;
  }

  private alive(): number {
    return this.raiders.filter((id) => this.game.players.get(id)?.dead === false).length;
  }
}
