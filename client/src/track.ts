// Smooth movement for things the server moves (other survivors, animals, cars): each snapshot is
// kept with the time it arrived, and they are drawn a little in the past, between the two
// snapshots either side of that moment. Steady at any frame rate, where easing towards the
// newest snapshot sped up and slowed down with every packet.

/** How far behind the newest snapshot things are drawn: two server ticks, so one late packet doesn't show. */
export const DELAY = 110;
/** How far past the last snapshot to keep going in a straight line when packets stop, in ms. */
const COAST = 120;
/** A jump bigger than this (a respawn, a teleport) is not smoothed over. */
const SNAP = 8;

interface Sample {
  at: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export class Track {
  private samples: Sample[] = [];

  /** A new snapshot, arrived at `at` (performance.now()). */
  push(at: number, x: number, y: number, z: number, yaw: number) {
    const last = this.samples[this.samples.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y, z - last.z) > SNAP) this.samples = [];
    this.samples.push({ at, x, y, z, yaw });
    // A second is plenty to cover any delay.
    while (this.samples.length > 2 && this.samples[1].at < at - 1000) this.samples.shift();
  }

  /** Where it is to be drawn at `now`: position and heading, written into `out`. */
  sample(now: number, out: { x: number; y: number; z: number; yaw: number }) {
    const s = this.samples;
    if (!s.length) return out;
    const t = now - DELAY;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].at > t) i--;
    // Before the oldest kept snapshot: just there.
    if (i === 0 && s[0].at >= t) return copy(s[0], out);
    const a = s[Math.max(0, i - 1)];
    const b = s[i];
    if (b.at <= t) {
      // Ran out of snapshots: coast on for a moment, then stop.
      const prev = s[s.length - 2];
      if (!prev || b.at === prev.at) return copy(b, out);
      const k = Math.min(t - b.at, COAST) / (b.at - prev.at);
      out.x = b.x + (b.x - prev.x) * k;
      out.y = b.y + (b.y - prev.y) * k;
      out.z = b.z + (b.z - prev.z) * k;
      out.yaw = b.yaw;
      return out;
    }
    const k = (t - a.at) / Math.max(1, b.at - a.at);
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    out.yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * k;
    return out;
  }
}

function copy(s: Sample, out: { x: number; y: number; z: number; yaw: number }) {
  out.x = s.x;
  out.y = s.y;
  out.z = s.z;
  out.yaw = s.yaw;
  return out;
}
