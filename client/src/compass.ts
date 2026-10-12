// The compass along the top of the screen: which way you face, with marks for home, where you
// last died, your team, supply drops and the landmarks, so you can always find your way back.

/** Something worth pointing at. */
export interface CompassMark {
  kind: 'home' | 'death' | 'mate' | 'drop' | 'landmark';
  x: number;
  z: number;
  /** Shown beside the distance when you face it (landmarks) or always (the rest). */
  label?: string;
}

/** CSS pixels across and down. */
const W = 560;
const H = 74;
/** Degrees either side of straight ahead that the strip shows. */
const SPAN = 70;
const TICKS_Y = 40;
const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const COLOURS: Record<CompassMark['kind'], string> = { home: '#ebe6da', death: '#d23a2c', mate: '#5fd06a', drop: '#d23a2c', landmark: '#c9562a' };
const FONT = "'Barlow Condensed', 'Barlow', sans-serif";

/** The way from one point to another, in degrees clockwise from north (north is -z, east is +x). */
export function bearing(dx: number, dz: number): number {
  return ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
}

export class Compass {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private drawn = '';

  constructor(parent: HTMLElement) {
    this.canvas.id = 'compass';
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.ctx.scale(dpr, dpr);
    parent.appendChild(this.canvas);
  }

  set visible(on: boolean) {
    this.canvas.hidden = !on;
  }

  /** Draws the strip for someone at (x, z) facing `yaw` (the controller's), if anything changed. */
  update(x: number, z: number, yaw: number, marks: CompassMark[]) {
    const heading = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
    const shown = marks.map((m) => ({ ...m, at: bearing(m.x - x, m.z - z), dist: Math.hypot(m.x - x, m.z - z) }));
    const key = `${heading.toFixed(1)}|${shown.map((m) => `${m.kind}${m.at.toFixed(1)}:${Math.round(m.dist)}`).join(',')}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);
    const toX = (deg: number) => {
      const off = ((deg - heading + 540) % 360) - 180;
      return Math.abs(off) > SPAN ? null : W / 2 + (off / SPAN) * (W / 2 - 14);
    };
    // Fades out towards the ends, so the strip has no hard edge.
    const fade = (px: number) => Math.max(0, Math.min(1, (W / 2 - Math.abs(px - W / 2)) / 70));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,.75)';
    ctx.shadowBlur = 4;
    for (let deg = 0; deg < 360; deg += 5) {
      const px = toX(deg);
      if (px === null) continue;
      ctx.globalAlpha = fade(px);
      const cardinal = CARDINALS[deg];
      const major = deg % 15 === 0;
      ctx.fillStyle = cardinal ? '#ebe6da' : 'rgba(235,230,218,.7)';
      const h = cardinal ? 10 : major ? 7 : 4;
      ctx.fillRect(Math.round(px) - 0.5, TICKS_Y, 1, h);
      if (cardinal) {
        ctx.font = `${cardinal.length === 1 ? 700 : 600} ${cardinal.length === 1 ? 17 : 14}px ${FONT}`;
        ctx.fillStyle = cardinal === 'N' ? '#c9562a' : '#ebe6da';
        ctx.fillText(cardinal, px, TICKS_Y + 28);
      } else if (major) {
        ctx.font = `500 11px ${FONT}`;
        ctx.fillStyle = 'rgba(235,230,218,.6)';
        ctx.fillText(String(deg), px, TICKS_Y + 25);
      }
    }
    // Further marks first, so the near ones sit on top.
    shown.sort((a, b) => b.dist - a.dist);
    for (const m of shown) {
      const px = toX(m.at);
      if (px === null) continue;
      ctx.globalAlpha = fade(px);
      this.icon(m.kind, px, 26);
      // Landmarks only say what they are when you face them; the rest always say how far.
      const facing = Math.abs(((m.at - heading + 540) % 360) - 180) < 6;
      if (m.kind === 'landmark' && !facing) continue;
      const text = `${m.kind === 'landmark' && m.label ? `${m.label}  ` : m.kind === 'mate' && m.label ? `${m.label}  ` : ''}${Math.round(m.dist)} m`;
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = COLOURS[m.kind] === '#ebe6da' ? '#ebe6da' : 'rgba(235,230,218,.92)';
      ctx.fillText(text.toUpperCase(), px, 11);
    }
    ctx.globalAlpha = 1;
    // Straight ahead: a notch above the ticks.
    ctx.fillStyle = '#c9562a';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 5, TICKS_Y - 6);
    ctx.lineTo(W / 2 + 5, TICKS_Y - 6);
    ctx.lineTo(W / 2, TICKS_Y - 1);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  private icon(kind: CompassMark['kind'], x: number, y: number) {
    const ctx = this.ctx;
    ctx.fillStyle = COLOURS[kind];
    ctx.strokeStyle = COLOURS[kind];
    ctx.beginPath();
    if (kind === 'home') {
      // A little house.
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 7, y - 1);
      ctx.lineTo(x + 5, y - 1);
      ctx.lineTo(x + 5, y + 5);
      ctx.lineTo(x - 5, y + 5);
      ctx.lineTo(x - 5, y - 1);
      ctx.lineTo(x - 7, y - 1);
      ctx.closePath();
      ctx.fill();
    } else if (kind === 'death') {
      // A cross where you fell.
      ctx.lineWidth = 2.5;
      ctx.moveTo(x - 5, y - 5);
      ctx.lineTo(x + 5, y + 5);
      ctx.moveTo(x + 5, y - 5);
      ctx.lineTo(x - 5, y + 5);
      ctx.stroke();
    } else if (kind === 'drop') {
      ctx.rect(x - 5, y - 5, 10, 10);
      ctx.fill();
    } else if (kind === 'mate') {
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Landmarks: an outlined diamond, like the map's.
      ctx.lineWidth = 2;
      ctx.moveTo(x, y - 6);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 6);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.stroke();
    }
  }
}
