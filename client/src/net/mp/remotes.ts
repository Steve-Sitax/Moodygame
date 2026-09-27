// M8a multiplayer: the other players on this PC, drawn a little in the past (docs/multiplayer-plan.md 4.3).
// No three.js here (the harness runs it in node too).
//
// - A jitter buffer per player: the states as they came, on the server's timeline (each carries the time it
//   was true on its sender, in server time).
// - Drawn `delay` ms in the past: 100 ms to start, then from what the network does (80 to 250 ms: the 95th
//   percentile of how late the states come, plus a little). The delay changes by at most 5% of the time
//   passing, so the other man never jumps when it does.
// - Between two states a cubic Hermite curve with their velocities: a walk is smooth, a jump a clean arc.
//   Turns take the short way round.
// - A state marked "snap" (a ladder, a seat, a new place) is not reached by an in-between: he is there.
// - No new state: on with the last velocity for 250 ms at most, then he stands. Never on through walls.

import { FLAG, type MpState } from "../../../../shared/mpProtocol";

export const DELAY_START = 100;
export const DELAY_MIN = 80;
/** The plan said 150; measured (docs/milestones/M8a.md): a line with 100 ms round trips needs about 220, so up to 250. */
export const DELAY_MAX = 250;
export const EXTRAPOLATE_MS = 250;

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  /** Speed on the ground (m/s): the walk's pace. */
  speed: number;
  mode: number;
  flags: number;
  base: number;
  /** M8b: GEAR kind (low 2 bits) and which boat (the rest); its heading in lyaw. */
  gear: number;
  lx: number;
  ly: number;
  lz: number;
  lyaw: number;
  /** The newest state is older than the render time (extrapolating or standing). */
  stale: boolean;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function hermite(p0: number, v0: number, p1: number, v1: number, dt: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * dt * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * dt * v1;
}
function hermiteD(p0: number, v0: number, p1: number, v1: number, dt: number, u: number): number {
  const u2 = u * u;
  return ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * dt * v0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * dt * v1) / Math.max(dt, 1e-6);
}

export class RemoteTrack {
  readonly buf: MpState[] = [];
  delay = DELAY_START;
  /** How long after the one before each state came (ms, its arrival less the previous state's time), the last few seconds. */
  private late: number[] = [];
  /** Numbers for the harness: states in, empty-buffer frames, extrapolated frames. */
  stats = { states: 0, dropped: 0, starved: 0, extrapolated: 0 };

  push(s: MpState, arrivedServerNow: number): void {
    const last = this.buf[this.buf.length - 1];
    if (last && s.t <= last.t) {
      this.stats.dropped++;
      return;
    }
    this.stats.states++;
    this.buf.push(s);
    if (this.buf.length > 60) this.buf.splice(0, this.buf.length - 60);
    // the draw needs a state at or after its time: what counts is how long after the newest state before this
    // one the next one comes (the send interval, the relay's wait, the network)
    this.late.push(arrivedServerNow - (last ? last.t : s.t));
    if (this.late.length > 60) this.late.shift();
  }

  /** The delay the network asks for now. */
  wanted(): number {
    if (this.late.length < 10) return DELAY_START;
    const sorted = [...this.late].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return Math.max(DELAY_MIN, Math.min(DELAY_MAX, p95 + 15));
  }

  /** Move the delay toward what is wanted, never faster than 5% of the time passing. */
  adapt(dtMs: number): void {
    const w = this.wanted();
    const step = dtMs * 0.05;
    this.delay += Math.max(-step, Math.min(step, w - this.delay));
  }

  /** Where he is drawn at `serverNow` (null before the first state). */
  sample(serverNow: number): Pose | null {
    const b = this.buf;
    if (!b.length) return null;
    const t = serverNow - this.delay;
    // drop what is long past, keeping one state before the render time
    while (b.length > 2 && b[1].t <= t) b.shift();
    const a = b[0];
    if (t <= a.t) return pose(a, a.x, a.y, a.z, a.yaw, a.pitch, a.vx, a.vz, false);
    if (b.length === 1) return this.extrapolate(a, t);
    const c = b[1];
    if (t > c.t) return this.extrapolate(c, t);
    // a snap: no in-between; he stays at a until c's time, then he is at c
    if (c.flags & FLAG.snap) return pose(a, a.x, a.y, a.z, a.yaw, a.pitch, 0, 0, false);
    const dt = (c.t - a.t) / 1000;
    const u = (t - a.t) / (c.t - a.t);
    const x = hermite(a.x, a.vx, c.x, c.vx, dt, u);
    const y = hermite(a.y, a.vy, c.y, c.vy, dt, u);
    const z = hermite(a.z, a.vz, c.z, c.vz, dt, u);
    const vx = hermiteD(a.x, a.vx, c.x, c.vx, dt, u);
    const vz = hermiteD(a.z, a.vz, c.z, c.vz, dt, u);
    const yaw = a.yaw + wrap(c.yaw - a.yaw) * u;
    const pitch = a.pitch + (c.pitch - a.pitch) * u;
    const p = pose(u < 0.5 ? a : c, x, y, z, yaw, pitch, vx, vz, false);
    // one-off flags (a jump, a step) belong to the state they came with: only the newer carries them
    p.flags = c.flags & ~(FLAG.jumped | FLAG.landed | FLAG.step);
    // (a platform's frame, or M8b the heading of his gear: eased between the two states)
    if ((a.base && a.base === c.base) || (!a.base && a.gear && a.gear === c.gear)) {
      p.lx = a.lx + (c.lx - a.lx) * u;
      p.ly = a.ly + (c.ly - a.ly) * u;
      p.lz = a.lz + (c.lz - a.lz) * u;
      p.lyaw = a.lyaw + wrap(c.lyaw - a.lyaw) * u;
      p.base = a.base;
    }
    return p;
  }

  private extrapolate(s: MpState, t: number): Pose {
    const ms = Math.min(EXTRAPOLATE_MS, t - s.t);
    if (t - s.t > EXTRAPOLATE_MS) this.stats.starved++;
    else this.stats.extrapolated++;
    const k = ms / 1000;
    // on the ground only: in the air a guess would sink him into the ground or float him
    const on = (s.flags & FLAG.grounded) !== 0;
    const x = s.x + (on ? s.vx * k : 0);
    const z = s.z + (on ? s.vz * k : 0);
    return pose(s, x, s.y, z, s.yaw, s.pitch, t - s.t > EXTRAPOLATE_MS ? 0 : s.vx, t - s.t > EXTRAPOLATE_MS ? 0 : s.vz, true);
  }
}

function pose(s: MpState, x: number, y: number, z: number, yaw: number, pitch: number, vx: number, vz: number, stale: boolean): Pose {
  return { x, y, z, yaw, pitch, vx, vz, speed: Math.hypot(vx, vz), mode: s.mode, flags: s.flags, base: s.base, gear: s.gear ?? 0, lx: s.lx, ly: s.ly, lz: s.lz, lyaw: s.lyaw, stale };
}
