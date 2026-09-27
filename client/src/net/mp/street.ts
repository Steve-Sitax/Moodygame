// M8b multiplayer: "one street for all" on this side (docs/multiplayer-plan.md 4.6, 5.2; docs/milestones/M8b.md).
//
// Each townsperson in the street is walked by one PC, the owner; the server says who (server/src/mp/street.ts).
// - This PC asks for the people its town is about to bring into the street (town.ts spawn: TownNet.spawned) and
//   lets them go when they leave its range or go in at a door (TownNet.lost). Near the host, the host's PC takes
//   the people a guest walks (only the host can talk and work until M8c).
// - The ones it walks it sends 10 times a second in one binary batch (standing ones once a second).
// - The ones another PC walks it draws from that PC's batches: about 200 ms in the past, between two states
//   (a Hermite curve with the sent velocities), the walk's pace from the drawn speed. No A* here, no decisions.
// - A handover (the owner let him go near us, the host took him, or the other way) keeps the same figure where
//   it stands: the new owner goes on from there; a small difference fades out in a few frames.

import { decodePuppets, encodePuppets, PUPPET_HZ, PUPPET_MAX, type MpText, type PuppetState } from "../../../../shared/mpProtocol";
import type { Crowd, Puppet } from "../../game/crowd";
import type { Sim, Town, TownNet } from "../../game/town";

export { decodePuppets, encodePuppets, type PuppetState };

/** Drawn this far in the past to start; then from how late the batches come (the research: 200 to 350 ms at 10 a second). */
export const PUPPET_DELAY_START = 220;
export const PUPPET_DELAY_MIN = 200;
export const PUPPET_DELAY_MAX = 350;
/** On with the last velocity at most this long when no batch comes, then he stands. */
const EXTRAPOLATE_MS = 300;
/** A batch from the owner stopped this long: the figure goes (the server gives him to someone else). */
const SILENT_MS = 3000;
/** Drawn up to this far from this player; beyond, a remote one is let go (the crowd takes them at 55 m, lets go at 68). */
const DRAW_R = 90;
/** The host takes the people a guest walks within this range of him (inside the town's 55 m spawn range). */
const TAKE_R = 50;
/** After a handover, the host does not take him again before this (the research: a minimum hold, no ping-pong). */
const MIN_HOLD_MS = 5000;
/** A standing one is sent at least this often. */
const KEEP_MS = 1000;
/** A jump of place larger than this between two states is not walked: he is simply there. */
const SNAP_M = 3;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------ one remote townsperson's jitter buffer

function hermite(p0: number, v0: number, p1: number, v1: number, dt: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * dt * v0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * dt * v1;
}

export class PuppetTrack {
  readonly buf: PuppetState[] = [];
  /** Server ms when the last batch with him came. */
  heardAt = 0;
  stats = { states: 0, starved: 0, extrapolated: 0 };

  push(s: PuppetState, now: number): void {
    const last = this.buf[this.buf.length - 1];
    this.heardAt = now;
    if (last && s.t <= last.t) return;
    // a jump of place (a door, a take-over far off): no in-between
    if (last && Math.hypot(s.x - last.x, s.z - last.z) > SNAP_M + Math.hypot(last.vx, last.vz) * ((s.t - last.t) / 1000)) s.snap = true;
    this.stats.states++;
    this.buf.push(s);
    if (this.buf.length > 40) this.buf.splice(0, this.buf.length - 40);
  }

  /** Where he is drawn at `t` (server ms, already less the delay); null before the first state. */
  sample(t: number): (PuppetState & { speed: number; stale: boolean }) | null {
    const b = this.buf;
    if (!b.length) return null;
    while (b.length > 2 && b[1].t <= t) b.shift();
    const a = b[0];
    if (t <= a.t) return { ...a, speed: Math.hypot(a.vx, a.vz), stale: false };
    const c = b[1];
    if (!c || t > c.t) {
      const s = c ?? a;
      const ms = Math.min(EXTRAPOLATE_MS, t - s.t);
      if (t - s.t > EXTRAPOLATE_MS) this.stats.starved++;
      else this.stats.extrapolated++;
      const go = t - s.t <= EXTRAPOLATE_MS;
      return { ...s, x: s.x + (go ? s.vx * (ms / 1000) : 0), z: s.z + (go ? s.vz * (ms / 1000) : 0), speed: go ? Math.hypot(s.vx, s.vz) : 0, stale: true };
    }
    if (c.snap) return { ...a, speed: 0, stale: false };
    const dt = (c.t - a.t) / 1000;
    const u = (t - a.t) / (c.t - a.t);
    const x = hermite(a.x, a.vx, c.x, c.vx, dt, u);
    const z = hermite(a.z, a.vz, c.z, c.vz, dt, u);
    const near = u < 0.5 ? a : c;
    return { ...near, t, x, z, yaw: a.yaw + wrap(c.yaw - a.yaw) * u, speed: Math.hypot(a.vx + (c.vx - a.vx) * u, a.vz + (c.vz - a.vz) * u), stale: false };
  }
}

// ------------------------------------------------------------------ the street

export interface StreetDeps {
  town: Town;
  crowd: Crowd;
  /** This player's id (0 before the welcome) and whether he is the host. */
  me(): number;
  host(): boolean;
  /** The server's clock now (ms). */
  serverNow(): number;
  /** Where this player stands. */
  player(): { x: number; z: number };
  sendText(m: MpText): boolean;
  sendBinary(b: ArrayBuffer): boolean;
}

interface Drawn {
  track: PuppetTrack;
  /** Handed over from this PC: the first drawn state is measured against where the figure stood. */
  fresh?: boolean;
  /** A handover's difference, fading out (drawn at the track's place plus this). */
  ex: number;
  ez: number;
}

export class Street implements TownNet {
  /** Who walks each resident (0 or missing: nobody); this PC's own claims count at once, before the server's answer. */
  private readonly owner = new Map<string, number>();
  private readonly idOf = new Map<number, string>();
  private readonly numOf = new Map<string, number>();
  private readonly drawn = new Map<string, Drawn>();
  private claims = new Set<string>();
  private steals = new Set<string>();
  private releases = new Set<string>();
  private delay = PUPPET_DELAY_START;
  private late: number[] = [];
  private sendAcc = 0;
  private takeAcc = 0;
  private readonly sent = new Map<string, { x: number; z: number; yaw: number; key: string; at: number; t: number }>();
  /** The harness's and the kit's numbers (docs/milestones/M8b.md). */
  readonly meter = { batchesIn: 0, batchesOut: 0, entriesOut: 0, handovers: 0, handoverJump: [] as number[], pingPong: 0, drops: 0 };
  private readonly handedAt = new Map<string, number>();

  constructor(private readonly d: StreetDeps) {}

  // ---- TownNet (town.ts asks)

  mayWalk(id: string): boolean {
    const o = this.owner.get(id) ?? 0;
    return o === 0 || o === this.d.me();
  }

  take(id: string): boolean {
    if (!this.d.host()) return false;
    this.claim(id, true);
    return true;
  }

  spawned(id: string): void {
    this.claim(id, this.d.host());
  }

  lost(id: string): void {
    if ((this.owner.get(id) ?? 0) !== this.d.me()) return;
    this.owner.delete(id);
    this.claims.delete(id);
    this.steals.delete(id);
    this.releases.add(id);
    this.sent.delete(id);
  }

  private claim(id: string, steal: boolean): void {
    const me = this.d.me();
    if (!me) return;
    if (this.owner.get(id) === me && !this.claims.has(id)) return;
    this.owner.set(id, me); // (the server's answer may yet say no: then he is drawn from the owner's batches)
    this.releases.delete(id);
    (steal ? this.steals : this.claims).add(id);
  }

  // ---- from the server

  /** The server's word on who walks whom (a full list on joining, else changes). */
  onOwners(m: Extract<MpText, { type: "owners" }>): void {
    const me = this.d.me();
    if (m.full) {
      for (const [id, o] of [...this.owner]) if (o !== me) this.owner.delete(id);
    }
    const now = this.d.serverNow();
    for (const [num, id, o] of m.list) {
      this.idOf.set(num, id);
      this.numOf.set(id, num);
      const was = this.owner.get(id) ?? 0;
      if (o === 0) this.owner.delete(id);
      else this.owner.set(id, o);
      const s = this.d.town.simOf(id);
      if (!s) continue;
      if (o === me) {
        // ours now: one drawn from another PC goes on from where he stands
        this.claims.delete(id);
        this.steals.delete(id);
        if (s.remote) this.handover(s, now);
      } else if (o !== 0) {
        // another PC walks him: one we walked is drawn from its batches from now on (the same figure)
        this.claims.delete(id);
        this.steals.delete(id);
        if (s.p && !s.remote) {
          this.d.town.remoteAttach(id, { x: s.p.x, z: s.p.z, yaw: s.p.yaw, size: s.p.size });
          this.drawn.set(id, { track: new PuppetTrack(), ex: 0, ez: 0, fresh: true });
          this.noteHand(id, now);
        }
      } else if (was !== 0 && was !== me && s.remote && s.p) {
        // his owner let him go: near us and in the street, we walk him on from where he stands; else he goes
        const pl = this.d.player();
        if (Math.hypot(s.p.x - pl.x, s.p.z - pl.z) < 55) {
          this.claim(id, this.d.host());
          this.handover(s, now);
        } else this.drop(id);
      }
    }
  }

  /** A batch of townspeople from the PC that walks them. */
  onBatch(v: DataView, recvNow: number): void {
    const b = decodePuppets(v);
    if (!b) return;
    this.meter.batchesIn++;
    const me = this.d.me();
    const pl = this.d.player();
    this.late.push(recvNow - b.t);
    if (this.late.length > 60) this.late.shift();
    for (const { num, s } of b.list) {
      const id = this.idOf.get(num);
      if (!id) continue;
      const o = this.owner.get(id) ?? 0;
      if (o === me || o === 0) continue; // (a late batch of the old owner: ours now, or nobody's)
      const sim = this.d.town.simOf(id);
      if (!sim) continue;
      let dr = this.drawn.get(id);
      if (!dr) {
        if (Math.hypot(s.x - pl.x, s.z - pl.z) > DRAW_R) continue;
        if (sim.p && !sim.remote) continue; // (still ours here until the server's word comes)
        if (!this.d.town.remoteAttach(id, { x: s.x, z: s.z, yaw: s.yaw, size: s.size })) continue;
        this.drawn.set(id, (dr = { track: new PuppetTrack(), ex: 0, ez: 0 }));
      }
      dr.track.push(s, recvNow);
    }
  }

  // ---- each frame

  /** Before the crowd moves and draws: every remote townsperson where his owner had him. */
  apply(dt: number): void {
    // the delay follows how late the batches come (95th percentile plus a little), 5% of the time passing at most
    if (this.late.length >= 10) {
      const sorted = [...this.late].sort((a, b) => a - b);
      const want = Math.max(PUPPET_DELAY_MIN, Math.min(PUPPET_DELAY_MAX, sorted[Math.floor(sorted.length * 0.95)] + 110));
      const step = dt * 1000 * 0.05;
      this.delay += Math.max(-step, Math.min(step, want - this.delay));
    }
    const now = this.d.serverNow();
    const t = now - this.delay;
    const pl = this.d.player();
    const fade = Math.pow(0.9, dt * 60); // (the research: about 0.9 a frame at 60 Hz for a small difference)
    for (const [id, dr] of this.drawn) {
      const s = this.d.town.simOf(id);
      if (!s?.remote || !s.p) {
        this.drawn.delete(id);
        continue;
      }
      if (now - dr.track.heardAt > SILENT_MS || Math.hypot(s.p.x - pl.x, s.p.z - pl.z) > DRAW_R + 10) {
        this.drop(id);
        continue;
      }
      const a = dr.track.sample(t);
      if (!a) continue;
      if (dr.fresh) {
        // handed over from here: the new owner's states start a little behind where we had him; the difference fades
        dr.fresh = false;
        const ex = s.p.x - a.x;
        const ez = s.p.z - a.z;
        if (Math.hypot(ex, ez) < SNAP_M) {
          dr.ex = ex;
          dr.ez = ez;
        }
      }
      dr.ex *= fade;
      dr.ez *= fade;
      if (Math.abs(dr.ex) < 0.005) dr.ex = 0;
      if (Math.abs(dr.ez) < 0.005) dr.ez = 0;
      this.d.crowd.applyRemote(s.p, { ...a, x: a.x + dr.ex, z: a.z + dr.ez });
    }
  }

  /** After the town moved them: send the ones this PC walks, ask for and let go of people, the host takes his. */
  send(dt: number): void {
    const me = this.d.me();
    if (!me) return;
    this.sendAcc += dt;
    this.takeAcc += dt;
    if (this.takeAcc >= 0.5) {
      this.takeAcc = 0;
      if (this.d.host()) this.takeNear();
    }
    if (this.claims.size) this.d.sendText({ type: "claim", ids: [...this.claims] }) && this.claims.clear();
    if (this.steals.size) this.d.sendText({ type: "claim", ids: [...this.steals], steal: true }) && this.steals.clear();
    if (this.releases.size) this.d.sendText({ type: "release", ids: [...this.releases] }) && this.releases.clear();
    if (this.sendAcc < 1 / PUPPET_HZ) return;
    const span = this.sendAcc;
    this.sendAcc = 0;
    const now = this.d.serverNow();
    const out: Array<{ num: number; s: PuppetState }> = [];
    for (const s of this.d.town.netSims()) {
      if (!s.p || s.remote || this.owner.get(s.r.id) !== me) continue;
      const num = this.numOf.get(s.r.id);
      if (num === undefined) continue; // (the server has not numbered him yet: next time)
      const p = s.p;
      const look = this.d.crowd.puppetLook(p);
      const key = `${look.motion}|${look.sit}|${look.lantern}|${look.sack}|${look.bought}|${JSON.stringify(look.veh)}|${p.size.toFixed(3)}`;
      const was = this.sent.get(s.r.id);
      const moved = !was || Math.hypot(p.x - was.x, p.z - was.z) > 0.01 || Math.abs(wrap(p.yaw - was.yaw)) > 0.01;
      if (was && !moved && was.key === key && now - was.at < KEEP_MS) continue;
      const dts = was ? Math.max(span, (now - was.t) / 1000) : span;
      const vx = was && moved ? (p.x - was.x) / dts : 0;
      const vz = was && moved ? (p.z - was.z) / dts : 0;
      const fast = Math.hypot(vx, vz) > 8; // (a jump of place: sent as one)
      out.push({ num, s: { t: now, x: p.x, z: p.z, yaw: p.yaw, vx: fast ? 0 : vx, vz: fast ? 0 : vz, snap: fast, size: p.size, ...look } });
      this.sent.set(s.r.id, { x: p.x, z: p.z, yaw: p.yaw, key, at: now, t: now });
    }
    for (let i = 0; i < out.length; i += PUPPET_MAX) {
      const part = out.slice(i, i + PUPPET_MAX);
      if (this.d.sendBinary(encodePuppets(now, part))) {
        this.meter.batchesOut++;
        this.meter.entriesOut += part.length;
      }
    }
  }

  /** The host: the people a guest walks close to him are his (only he can talk and work until M8c). */
  private takeNear(): void {
    const me = this.d.me();
    const pl = this.d.player();
    for (const [id, dr] of this.drawn) {
      const s = this.d.town.simOf(id);
      if (!s?.remote || !s.p || s.inTrip || s.aboard) continue;
      const o = this.owner.get(id) ?? 0;
      if (o === me || o === 0) continue;
      if (Math.hypot(s.p.x - pl.x, s.p.z - pl.z) > TAKE_R) continue;
      // (the research: a minimum hold after a handover, no ping-pong)
      const at = this.handedAt.get(id);
      if (at !== undefined && this.d.serverNow() - at < MIN_HOLD_MS) continue;
      void dr;
      this.claim(id, true);
      this.handover(s, this.d.serverNow());
    }
  }

  /** A remote one becomes ours: the same figure walked on from where it is drawn. */
  private handover(s: Sim, now: number): void {
    const id = s.r.id;
    const dr = this.drawn.get(id);
    // (where the owner last had him against where he is drawn here: the jump the others see, for the numbers)
    const last = dr?.track.buf[dr.track.buf.length - 1];
    if (last && s.p) this.meter.handoverJump.push(Math.hypot(last.x - s.p.x, last.z - s.p.z));
    if (this.meter.handoverJump.length > 200) this.meter.handoverJump.shift();
    this.drawn.delete(id);
    this.d.town.remoteTake(id);
    this.noteHand(id, now);
  }

  private noteHand(id: string, now: number): void {
    this.meter.handovers++;
    const at = this.handedAt.get(id);
    if (at !== undefined && now - at < 10_000) this.meter.pingPong++;
    this.handedAt.set(id, now);
  }

  private drop(id: string): void {
    this.drawn.delete(id);
    this.d.town.remoteDrop(id);
    this.meter.drops++;
  }

  /** The socket came back or another save: nobody is known to walk anyone until the server says so. */
  reset(): void {
    for (const id of [...this.drawn.keys()]) this.drop(id);
    this.owner.clear();
    this.claims.clear();
    this.steals.clear();
    this.releases.clear();
    this.sent.clear();
    // the people this PC walks now are asked for again
    for (const s of this.d.town.netSims()) if (s.p && !s.remote) this.claim(s.r.id, this.d.host());
  }

  /** For the kit and the harness. */
  report() {
    const tracks = [...this.drawn.values()].map((d) => d.track.stats);
    const sum = (k: "states" | "starved" | "extrapolated") => tracks.reduce((a, s) => a + s[k], 0);
    const jumps = [...this.meter.handoverJump].sort((a, b) => a - b);
    let mine = 0;
    for (const o of this.owner.values()) if (o === this.d.me()) mine++;
    return {
      walksHere: mine,
      drawnFromOthers: this.drawn.size,
      delay: Math.round(this.delay),
      states: sum("states"),
      starved: sum("starved"),
      extrapolated: sum("extrapolated"),
      handoverJumpP95: +(jumps[Math.floor(jumps.length * 0.95)] ?? 0).toFixed(3),
      ...this.meter,
      handoverJump: undefined,
    };
  }

  /** Dev: the remote one's figure (for close shots). */
  figure(id: string): Puppet | null {
    return this.drawn.has(id) ? (this.d.town.simOf(id)?.p ?? null) : null;
  }
}