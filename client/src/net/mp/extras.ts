// M8f sync pass 3: the town's own things other than the townspeople, one PC running each for all
// (docs/milestones/M8f.md "Sync pass 3").
//
// - Animals: the stray dogs and street cats (their haunts and kinds fixed by the town: game/animals.ts), the hens and
//   goats of the courts (game/lively.ts), a townsperson's dog. Each has a fixed id; the server numbers it and says
//   which PC runs it with the same claims as the townspeople (server/src/mp/street.ts Owners). The PC of the nearest
//   player asks for one nobody runs; it lets it go beyond its reach, and the next PC near runs it on from where it
//   was drawn. The PC that runs animals sends them in one small batch (MSG_ANIMALS, 8 bytes each): 10 a second while
//   one moves, every 2 s while they stand. A townsperson's dog goes with him (sent under his number by the PC that
//   walks him).
// - The town's other walkers: the market's shoppers and the Steen's visitors. The PC of the nearest player runs the
//   group (spawns them); each walker has its own id (its kind in it) and is sent as the townspeople are (the puppet
//   batch, 24 bytes); the others draw them as remote puppets (crowd.ts addRemote/applyRemote). A walker whose PC
//   lets it go near another player is taken on by that PC (onAdopt).
//
// game/share.ts is what the game reads; this fills it in when played together.

import {
  decodeAnimals,
  decodePuppets,
  encodeAnimals,
  encodePuppets,
  PUPPET_HZ,
  PUPPET_MAX,
  ANIMAL_MAX,
  type AnimalState,
  type MpText,
  type PuppetState,
} from "../../../../shared/mpProtocol";
import type { Crowd, Puppet } from "../../game/crowd";
import type { HumanKind } from "../../game/humans";
import type { ShareNet, SharedAnimal, SharedPuppet } from "../../game/share";
import { PuppetTrack, puppetDelayWanted } from "./street";

/** Animals: sent 10 a second while one moves; a standing one every 2 s. */
const ANIMAL_HZ = 10;
const ANIMAL_KEEP_MS = 2000;
/** A walker or an animal whose PC stopped sending this long goes (its PC lost it: the next near runs it). */
const SILENT_MS = 4000;
/** Walkers drawn up to this far from this player. */
const DRAW_R = 90;
/** A standing walker is sent at least this often. */
const KEEP_MS = 1000;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface ExtrasDeps {
  crowd: Crowd;
  me(): number;
  serverNow(): number;
  /** Every player's place, this one's first. */
  players(): Array<{ x: number; z: number }>;
  sendText(m: MpText): boolean;
  sendBinary(b: ArrayBuffer): boolean;
}

interface AnimalTrack {
  buf: Array<SharedAnimal & { t: number }>;
  heardAt: number;
}

interface DrawnWalker {
  track: PuppetTrack;
  p: Puppet | null;
  endAt?: number;
}

export class Extras implements ShareNet {
  private readonly owners = new Map<string, number>();
  private readonly idOf = new Map<number, string>();
  private readonly numOf = new Map<string, number>();
  private readonly claims = new Set<string>();
  private readonly releases = new Set<string>();
  private readonly gone = new Set<string>();
  // animals
  private readonly outAnimals = new Map<string, { s: SharedAnimal; dogOf?: string; sent?: { x: number; z: number; yaw: number; motion: string; at: number }; fresh: boolean }>();
  private readonly tracks = new Map<string, AnimalTrack>();
  private animalAcc = 0;
  private aliveAt = 0;
  // walkers
  private readonly mine = new Map<string, Puppet>();
  private readonly sentW = new Map<string, { x: number; z: number; yaw: number; key: string; at: number; t: number }>();
  private readonly drawn = new Map<string, DrawnWalker>();
  private readonly adopters: Array<{ prefix: string; take: (id: string, p: SharedPuppet) => boolean }> = [];
  private walkAcc = 0;
  private serial = 0;
  // the delay (as the townspeople's)
  private delay = 220;
  private readonly late: number[] = [];
  readonly meter = { animalBatchesOut: 0, animalBytesOut: 0, animalsIn: 0, walkerBatchesOut: 0, walkersIn: 0, claims: 0, adopted: 0 };

  private readonly d: ExtrasDeps;
  constructor(d: ExtrasDeps) {
    this.d = d;
  }

  // ------------------------------------------------------------------ ownership

  owner(id: string): number {
    return this.owners.get(id) ?? 0;
  }

  /** Is this player the nearest of all to (x, z) (ties: the lower id; here only this player's place is first)? */
  private nearest(x: number, z: number, reach: number): boolean {
    const ps = this.d.players();
    if (!ps.length) return true;
    const mine = Math.hypot(ps[0].x - x, ps[0].z - z);
    if (mine > reach) return false;
    for (let i = 1; i < ps.length; i++) if (Math.hypot(ps[i].x - x, ps[i].z - z) < mine - 0.5) return false;
    return true;
  }

  run(id: string, x: number, z: number, reach: number): boolean {
    const me = this.d.me();
    if (!me) return false;
    const o = this.owners.get(id) ?? 0;
    const ps = this.d.players();
    const myD = ps.length ? Math.hypot(ps[0].x - x, ps[0].z - z) : 0;
    if (o === me) {
      if (myD > reach + 15) {
        this.release(id);
        return false;
      }
      return true;
    }
    if (o !== 0) return false;
    if (!this.nearest(x, z, reach)) return false;
    this.owners.set(id, me); // (the server's answer may yet say no: then it is drawn from the other PC)
    this.releases.delete(id);
    this.claims.add(id);
    this.meter.claims++;
    return true;
  }

  release(id: string, gone = false): void {
    if ((this.owners.get(id) ?? 0) !== this.d.me()) return;
    this.owners.delete(id);
    this.claims.delete(id);
    (gone ? this.gone : this.releases).add(id);
    this.outAnimals.delete(id);
  }

  /** The server's word on who runs what (the townspeople's rows too: a dog goes with its townsperson). */
  onOwners(m: Extract<MpText, { type: "owners" }>): void {
    const me = this.d.me();
    if (m.full) for (const [id, o] of [...this.owners]) if (o !== me) this.owners.delete(id);
    const now = this.d.serverNow();
    for (const [num, id, o] of m.list) {
      this.idOf.set(num, id);
      this.numOf.set(id, num);
      const was = this.owners.get(id) ?? 0;
      if (o === 0) this.owners.delete(id);
      else this.owners.set(id, o);
      if (!id.startsWith("x:")) continue;
      const dr = this.drawn.get(id);
      const own = this.mine.get(id);
      if (own && o > 0 && o !== me) {
        // (another PC was first: its walker is drawn here, ours goes)
        if (this.d.crowd.alive(own)) this.d.crowd.removePuppet(own);
        this.mine.delete(id);
        this.sentW.delete(id);
        continue;
      }
      if (o < 0) {
        // gone (in at a door): its last states drawn first
        if (dr) dr.endAt = now + this.delay + 300;
      } else if (o === me && dr) {
        this.adopt(id, dr);
      } else if (o === 0 && dr?.p && was !== me) {
        // its PC let it go near us: the nearest runs it on from where it is drawn
        if (this.nearest(dr.p.x, dr.p.z, 60) && this.adopters.some((a) => id.startsWith(a.prefix))) {
          this.owners.set(id, me);
          this.claims.add(id);
          this.adopt(id, dr);
        }
      } else if (o === me && !dr && was !== me && !this.mine.has(id)) {
        // (ours, but nothing drawn here: let it go again)
        this.release(id, true);
      }
    }
  }

  private adopt(id: string, dr: DrawnWalker): void {
    this.drawn.delete(id);
    const p = dr.p;
    if (!p || !this.d.crowd.alive(p)) return;
    this.d.crowd.puppetRemote(p, false);
    const a = this.adopters.find((q) => id.startsWith(q.prefix));
    if (a && a.take(id, p)) {
      this.mine.set(id, p);
      this.meter.adopted++;
    } else {
      this.d.crowd.removePuppet(p);
      this.release(id, true);
    }
  }

  // ------------------------------------------------------------------ animals

  putAnimal(id: string, s: SharedAnimal, dogOf?: string): void {
    const o = this.outAnimals.get(id);
    if (o) {
      o.s = s;
      o.dogOf = dogOf;
    } else this.outAnimals.set(id, { s, dogOf, fresh: true });
  }

  animal(id: string): SharedAnimal | null {
    const tr = this.tracks.get(id);
    if (!tr || !tr.buf.length) return null;
    const t = this.d.serverNow() - this.delay;
    const b = tr.buf;
    while (b.length > 2 && b[1].t <= t) b.shift();
    const a = b[0];
    const c = b[1];
    if (!c || t <= a.t) return a;
    if (t >= c.t || c.snap) return t >= c.t ? c : a;
    const u = (t - a.t) / (c.t - a.t);
    return { x: a.x + (c.x - a.x) * u, z: a.z + (c.z - a.z) * u, yaw: a.yaw + wrap(c.yaw - a.yaw) * u, motion: u < 0.5 ? a.motion : c.motion };
  }

  *animalsHeard(): Iterable<string> {
    const now = this.d.serverNow();
    for (const [id, tr] of this.tracks) if (now - tr.heardAt < SILENT_MS) yield id;
  }

  onAnimals(v: DataView, recvNow: number): void {
    const b = decodeAnimals(v);
    if (!b) return;
    this.noteLate(recvNow - b.t);
    const me = this.d.me();
    for (const s of b.list) {
      const rid = this.idOf.get(s.num);
      if (!rid) continue;
      const id = s.dog ? `dog:${rid}` : rid;
      // (a late batch of the PC that ran it before: ours now)
      if (!s.dog && (this.owners.get(id) ?? 0) === me) continue;
      let tr = this.tracks.get(id);
      if (!tr) this.tracks.set(id, (tr = { buf: [], heardAt: 0 }));
      tr.heardAt = recvNow;
      const last = tr.buf[tr.buf.length - 1];
      if (last && b.t <= last.t) continue;
      tr.buf.push({ t: b.t, x: s.x, z: s.z, yaw: s.yaw, motion: s.motion, snap: s.snap });
      if (tr.buf.length > 30) tr.buf.splice(0, tr.buf.length - 30);
      this.meter.animalsIn++;
    }
  }

  private sendAnimals(dt: number): void {
    this.animalAcc += dt;
    if (this.animalAcc < 1 / ANIMAL_HZ) return;
    this.animalAcc = 0;
    const now = this.d.serverNow();
    const me = this.d.me();
    const list: AnimalState[] = [];
    for (const [id, o] of this.outAnimals) {
      const key = o.dogOf ?? id;
      const num = this.numOf.get(key);
      // (a dog goes with its townsperson: sent while the server has him walked here)
      if (num === undefined || (this.owners.get(key) ?? 0) !== me) continue;
      const s = o.s;
      const w = o.sent;
      const moved = !w || Math.hypot(s.x - w.x, s.z - w.z) > 0.02 || Math.abs(wrap(s.yaw - w.yaw)) > 0.03 || w.motion !== s.motion;
      if (!moved && now - w.at < ANIMAL_KEEP_MS) continue;
      list.push({ num, x: s.x, z: s.z, yaw: s.yaw, motion: s.motion, snap: o.fresh || !!s.snap, dog: !!o.dogOf });
      o.sent = { x: s.x, z: s.z, yaw: s.yaw, motion: s.motion, at: now };
      o.fresh = false;
    }
    // (nothing to send, but this PC runs something: an empty batch now and then says it is alive, so the server does
    // not give what it runs to another PC)
    if (!list.length) {
      if (now - this.aliveAt < 1000) return;
      let runs = false;
      for (const o of this.owners.values()) if (o === me) runs = true;
      if (!runs) return;
    }
    this.aliveAt = now;
    for (let i = 0; i < Math.max(1, list.length); i += ANIMAL_MAX) {
      const b = encodeAnimals(now, list.slice(i, i + ANIMAL_MAX));
      if (this.d.sendBinary(b)) {
        this.meter.animalBatchesOut++;
        this.meter.animalBytesOut += b.byteLength;
      }
    }
    // (only what is put this frame is sent next: an animal no longer put is no longer this PC's)
    for (const [id, o] of this.outAnimals) if (!o.fresh && o.sent && now - o.sent.at > ANIMAL_KEEP_MS * 3) this.outAnimals.delete(id);
  }

  // ------------------------------------------------------------------ walkers

  newId(group: string, kind: string): string {
    return `x:${group}:${kind}:${this.d.me()}.${(Date.now() % 1e7).toString(36)}.${(this.serial++).toString(36)}`;
  }

  person(id: string, p: SharedPuppet): void {
    const me = this.d.me();
    if (!me) return;
    if (!this.mine.has(id)) {
      this.mine.set(id, p as Puppet);
      if ((this.owners.get(id) ?? 0) !== me) {
        this.owners.set(id, me);
        this.claims.add(id);
      }
    }
  }

  personGone(id: string): void {
    this.mine.delete(id);
    this.sentW.delete(id);
    this.release(id, true);
  }

  onAdopt(prefix: string, take: (id: string, p: SharedPuppet) => boolean): void {
    this.adopters.push({ prefix, take });
  }

  /** A puppet batch: the "x:" walkers in it (the townspeople's are street.ts's). */
  onPuppets(v: DataView, recvNow: number): void {
    const b = decodePuppets(v);
    if (!b) return;
    const me = this.d.me();
    const pl = this.d.players()[0];
    let any = false;
    for (const { num, s } of b.list) {
      const id = this.idOf.get(num);
      if (!id || !id.startsWith("x:")) continue;
      const o = this.owners.get(id) ?? 0;
      if (o === me || o === 0) continue;
      any = true;
      let dr = this.drawn.get(id);
      if (!dr) {
        if (pl && Math.hypot(s.x - pl.x, s.z - pl.z) > DRAW_R) continue;
        this.drawn.set(id, (dr = { track: new PuppetTrack(), p: null }));
      }
      dr.track.push(s, recvNow);
      this.meter.walkersIn++;
    }
    if (any) this.noteLate(recvNow - b.t);
  }

  private noteLate(ms: number): void {
    this.late.push(ms);
    if (this.late.length > 60) this.late.shift();
  }

  /** Before the crowd moves: the walkers other PCs run, where they had them. */
  apply(dt: number): void {
    if (this.late.length >= 10) {
      const want = puppetDelayWanted(this.late);
      const step = dt * 1000 * 0.05;
      this.delay += Math.max(-step, Math.min(step, want - this.delay));
    }
    const now = this.d.serverNow();
    const t = now - this.delay;
    const pl = this.d.players()[0];
    const crowd = this.d.crowd;
    for (const [id, dr] of this.drawn) {
      const a = dr.track.sample(t);
      const far = !!a && !!pl && Math.hypot(a.x - pl.x, a.z - pl.z) > DRAW_R + 10;
      if (now - dr.track.heardAt > SILENT_MS || far || (dr.endAt !== undefined && now > dr.endAt)) {
        if (dr.p && crowd.alive(dr.p)) crowd.removePuppet(dr.p);
        this.drawn.delete(id);
        continue;
      }
      if (!a) continue;
      if (dr.p && !crowd.alive(dr.p)) dr.p = null;
      if (!dr.p) {
        const kind = id.split(":")[2] as HumanKind;
        dr.p = crowd.addRemote(kind, a.x, a.z, a.yaw, a.size);
        if (!dr.p) continue;
      }
      crowd.applyRemote(dr.p, a);
    }
    // the animals' tracks nobody sends any more
    for (const [id, tr] of this.tracks) if (now - tr.heardAt > SILENT_MS * 2) this.tracks.delete(id);
  }

  /** After everything moved: send what this PC runs; the claims and the lettings go. */
  send(dt: number): void {
    const me = this.d.me();
    if (!me) return;
    if (this.claims.size && this.d.sendText({ type: "claim", ids: [...this.claims].slice(0, 200) })) this.claims.clear();
    if (this.releases.size || this.gone.size) {
      if (this.d.sendText({ type: "release", ids: [...this.releases].slice(0, 200), gone: [...this.gone].slice(0, 200) })) {
        this.releases.clear();
        this.gone.clear();
      }
    }
    this.sendAnimals(dt);
    this.walkAcc += dt;
    if (this.walkAcc < 1 / PUPPET_HZ) return;
    const span = this.walkAcc;
    this.walkAcc = 0;
    const now = this.d.serverNow();
    const crowd = this.d.crowd;
    const out: Array<{ num: number; s: PuppetState }> = [];
    for (const [id, p] of this.mine) {
      if (!crowd.alive(p)) {
        this.personGone(id);
        continue;
      }
      const o = this.owners.get(id) ?? 0;
      if (o === 0) {
        // (let go by the server, as when this PC seemed silent: asked for again)
        this.owners.set(id, me);
        this.claims.add(id);
        continue;
      }
      if (o !== me) continue;
      const num = this.numOf.get(id);
      if (num === undefined) continue;
      const look = crowd.puppetLook(p);
      const key = `${look.motion}|${look.sit}|${look.lantern}|${look.sack}|${look.bought}|${p.size.toFixed(3)}`;
      const was = this.sentW.get(id);
      const moved = !was || Math.hypot(p.x - was.x, p.z - was.z) > 0.01 || Math.abs(wrap(p.yaw - was.yaw)) > 0.01;
      if (was && !moved && was.key === key && now - was.at < KEEP_MS) continue;
      const dts = was ? Math.max(span, (now - was.t) / 1000) : span;
      const vx = was && moved ? (p.x - was.x) / dts : 0;
      const vz = was && moved ? (p.z - was.z) / dts : 0;
      const fast = Math.hypot(vx, vz) > 8;
      out.push({ num, s: { t: now, x: p.x, z: p.z, yaw: p.yaw, vx: fast ? 0 : vx, vz: fast ? 0 : vz, snap: fast || !was, size: p.size, ...look } });
      this.sentW.set(id, { x: p.x, z: p.z, yaw: p.yaw, key, at: now, t: now });
    }
    for (let i = 0; i < out.length; i += PUPPET_MAX) {
      if (this.d.sendBinary(encodePuppets(now, out.slice(i, i + PUPPET_MAX)))) this.meter.walkerBatchesOut++;
    }
  }

  /** The socket came back: nobody is known to run anything until the server says so. */
  reset(): void {
    for (const dr of this.drawn.values()) if (dr.p && this.d.crowd.alive(dr.p)) this.d.crowd.removePuppet(dr.p);
    this.drawn.clear();
    this.tracks.clear();
    const me = this.d.me();
    const mineNow = [...this.owners].filter(([, o]) => o === me).map(([id]) => id);
    this.owners.clear();
    this.sentW.clear();
    // (the animals and walkers only: the townspeople are street.ts's to ask for again)
    for (const id of mineNow) if (id.startsWith("x:") ? this.mine.has(id) : id.startsWith("a:")) this.claims.add(id);
    for (const id of this.claims) this.owners.set(id, me);
  }

  report() {
    let runs = 0;
    for (const o of this.owners.values()) if (o === this.d.me()) runs++;
    return { runsHere: runs, walkersMine: this.mine.size, walkersDrawn: this.drawn.size, animalsHeard: [...this.animalsHeard()].length, delay: Math.round(this.delay), ...this.meter };
  }
}
