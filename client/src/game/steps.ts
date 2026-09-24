import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { Crowd, Puppet } from "./crowd";
import type { Town } from "./town";
import type { Jobs } from "./jobs";
import type { Item } from "./goods";
import { GOODS, type Goods } from "./props";
import { HaulRun, slot } from "./runs";
import type { CarryTask } from "../net/api";

// The client side of the step executor (M6 gifts and hired hands, server director/steps.ts). The
// server keeps each routine and decides what every step means; this side walks the step running
// now on the crowd's walk grid and reports how it went: arrived, picked up, delivered, lost the
// way. Walk to a point; follow Jef (a step behind; lost 40 m off for 5 s); pick up one of a job's
// goods lying about and carry it (the carry clip) to the goal, where it counts for Jef's job under
// the board's rules (HaulRun.onPlaced); walk off with it when the engine says so (the job loses it);
// wait (stand and face Jef). Out of sight they go on unseen at the hidden pace, and do the same.

export interface RoutineStep {
  kind: "walk_to" | "follow" | "enter" | "sit" | "leave" | "pick_up" | "carry" | "buy" | "give" | "pay" | "talk_to" | "wait";
  x: number | null;
  z: number | null;
  label: string | null;
  place: string | null;
  job: number | null;
  item: string | null;
  /** pick_up: how many to take (with a cart, several). */
  count?: number;
  off: boolean;
  inside: string | null;
  who: string | null;
}
export interface PublicRoutine {
  id: number;
  npc: string;
  name: string;
  purpose: string;
  i: number;
  n: number;
  step: RoutineStep | null;
  holding: number;
  strong: boolean;
  cart: string | null;
  minutes_left: number;
}

const CLAIM_M = 58;
const LOST_M = 40;
const LOST_S = 5;
const STUCK_S = 16;
const REACH = 1.6;

interface Walk {
  r: PublicRoutine;
  /** The step index this walk is for; a new one resets the rest. */
  i: number;
  p: Puppet | null;
  reported: boolean;
  goT: number;
  lostT: number;
  stuckT: number;
  bestD: number;
  wait: number;
  /** pick_up: the item chosen (reserved); what they carry (one on the shoulder, or several on Jef's cart). */
  target: Item | null;
  load: Item[];
  /** The puppet the load (or the cart) is shown on (it moves to a new puppet when they are claimed again). */
  shownOn: Puppet | null;
  /** The cart drawn with this many on it (-1: no cart drawn). */
  cartItems: number;
  /** walk_to, carry: the open point beside the step's goal (worked out once). */
  goal?: { x: number; z: number } | null;
  /** Where they stood when last seen moving (the stuck test). */
  lastAt?: { x: number; z: number } | null;
  /** M6 routines: a walk up to a person (or back to Jef): seconds until the goal is looked up again. */
  goalT?: number;
  /** M6 routines: seconds stood where nobody can stand (then they squeeze out). */
  wedgedT?: number;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export class Steps {
  private walks = new Map<number, Walk>();
  private list: PublicRoutine[] = [];
  private pollT = 0;
  private busy = false;
  dirty = true;
  /** Set by main: is Jef inside a room (a follower then waits at the door). */
  inside: () => boolean = () => false;
  say: (t: string) => void = () => {};
  /** Dev: what was reported. */
  readonly reports: string[] = [];
  /** Items reserved by a walk (nobody else, and not Jef's own pointer, takes them). */
  private reserved = new Map<Item, number>();

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly jobs: Jobs,
  ) {}

  get routines(): PublicRoutine[] {
    return this.list;
  }

  /** Is this item spoken for by a hand on the way to it? */
  isReserved(it: Item): boolean {
    return this.reserved.has(it);
  }

  update(dt: number, hasRoutines: boolean): void {
    this.pollT -= dt;
    if (this.pollT <= 0 && !this.busy && (hasRoutines || this.walks.size || this.dirty)) {
      this.pollT = this.dirty ? 0.3 : 1.5;
      void this.poll();
    }
    for (const w of this.walks.values()) {
      try {
        this.run(w, dt);
      } catch (e) {
        console.warn("[steps]", e);
      }
    }
  }

  private async poll(): Promise<void> {
    this.busy = true;
    this.dirty = false;
    try {
      const r = await call<{ routines: PublicRoutine[] }>("GET", "/api/routines");
      this.apply(r.routines);
    } catch {
      // the server is away: nothing moves
    } finally {
      this.busy = false;
    }
  }

  private apply(list: PublicRoutine[]): void {
    this.list = list;
    const seen = new Set<number>();
    for (const r of list) {
      seen.add(r.id);
      const w = this.walks.get(r.id);
      if (!w) this.walks.set(r.id, this.fresh(r));
      else {
        const { load, shownOn, cartItems } = w;
        if (w.i !== r.i) Object.assign(w, this.fresh(r), { load, shownOn, cartItems });
        w.r = r;
      }
    }
    for (const [id, w] of this.walks) {
      if (seen.has(id)) continue;
      this.drop(w);
      this.walks.delete(id);
    }
  }

  private fresh(r: PublicRoutine): Walk {
    return { r, i: r.i, p: null, reported: false, goT: 0, lostT: 0, stuckT: 0, bestD: Infinity, wait: 0, target: null, load: [], shownOn: null, cartItems: -1, goal: null, lastAt: null };
  }

  /** The walk is over (the routine ended): what they hold is put down where they stand, unless the engine took it. */
  private drop(w: Walk): void {
    if (w.target) this.reserved.delete(w.target);
    // what they still hold is set down where they stand (the job's goods stay the job's: Jef can carry them on)
    const at = (w.p && this.crowd.alive(w.p) ? { x: w.p.x, z: w.p.z } : null) ?? this.town.position(w.r.npc);
    const load = w.load;
    this.showLoad(w, null);
    w.load = [];
    load.forEach((it, k) => {
      const q = at ? (this.crowd.openNear(at.x + (k % 2) * 0.9, at.z + Math.floor(k / 2) * 0.9) ?? at) : null;
      if (q) this.jobs.goods.spawn(it.kind as Goods, q.x, q.z, { jobId: it.jobId, owner: it.owner, heavy: it.heavy, broken: it.broken });
    });
  }

  private async report(w: Walk, ok: boolean, why: string, n?: number): Promise<void> {
    if (w.reported) return;
    w.reported = true;
    this.reports.push(`${w.r.id}:${w.r.step?.kind}:${ok ? "ok" : why}${n ? `:${n}` : ""}`);
    try {
      const at = w.p && this.crowd.alive(w.p) ? { x: +w.p.x.toFixed(1), z: +w.p.z.toFixed(1) } : {};
      await call("POST", `/api/routine/${w.r.id}/step`, { i: w.i, ok, why, ...(n ? { n } : {}), ...at });
    } catch {
      w.reported = false;
    }
    this.dirty = true;
  }

  // ------------------------------------------------------------------ per frame

  private jefD(x: number, z: number): number {
    return Math.hypot(x - this.player.x, z - this.player.z);
  }

  /** The person in the street, claimed; or null while far off (moved unseen toward `toward`). */
  private ensure(w: Walk, toward: { x: number; z: number } | null, dt: number): Puppet | null {
    const id = w.r.npc;
    const pos = this.town.position(id);
    const d = pos ? this.jefD(pos.x, pos.z) : Infinity;
    if (d > CLAIM_M) {
      w.p = null;
      if (toward) this.town.moveHidden(id, toward.x, toward.z, dt, this.town.hiddenPace(id, toward.x, toward.z));
      return null;
    }
    const p = this.town.claimNear(id, { x: this.player.x, z: this.player.z });
    w.p = p;
    return p;
  }

  private go(w: Walk, p: Puppet, x: number, z: number, pace: number, every = 0.6, dt = 1 / 60): void {
    w.goT -= dt;
    if (w.goT > 0 && this.crowd.puppetBusy(p)) return;
    w.goT = every;
    this.crowd.puppetGo(p, x, z, pace);
  }

  /**
   * Stuck: they have not got nearer AND have not moved for a while. A way round a block or over a
   * bridge takes them away from the goal for a time; that is walking, not stuck.
   */
  private stuck(w: Walk, d: number, dt: number): boolean {
    const p = w.p;
    const moved = !!p && (!w.lastAt || Math.hypot(p.x - w.lastAt.x, p.z - w.lastAt.z) > 0.6);
    if (d < w.bestD - 0.3 || moved) {
      w.bestD = Math.min(w.bestD, d);
      w.stuckT = 0;
      if (p) w.lastAt = { x: p.x, z: p.z };
      return false;
    }
    w.stuckT += dt;
    return w.stuckT > STUCK_S;
  }

  private run(w: Walk, dt: number): void {
    const s = w.r.step;
    if (!s || w.reported) {
      this.keepLoad(w);
      return;
    }
    switch (s.kind) {
      case "walk_to":
        return this.walkTo(w, s, dt, false);
      case "follow":
        return this.follow(w, dt);
      case "pick_up":
        return this.pickUp(w, s, dt);
      case "carry":
        return this.walkTo(w, s, dt, true);
      case "talk_to":
        return this.walkTo(w, s, dt, false);
      case "wait":
        return this.waitHere(w, s, dt);
      default:
        return; // the engine's own steps: nothing to walk
    }
  }

  private walkTo(w: Walk, s: RoutineStep, dt: number, carrying: boolean): void {
    // a reload while they carried: the server says they hold goods; the goods lie at the pile again, so they take them up
    if (carrying && !w.load.length && w.r.holding > 0 && s.job !== null) {
      const from = this.town.position(w.r.npc) ?? { x: this.player.x, z: this.player.z };
      const pile = this.freeGoods(w, s.job).sort((a, b) => Math.hypot(a.obj.position.x - from.x, a.obj.position.z - from.z) - Math.hypot(b.obj.position.x - from.x, b.obj.position.z - from.z));
      for (const it of pile.slice(0, w.r.holding)) {
        this.jobs.goods.remove(it);
        w.load.push(it);
      }
    }
    // M6 routines: a walk up to a person, or back to Jef, goes to where they are now (looked up each second)
    if (s.who && s.kind !== "follow") {
      w.goalT = (w.goalT ?? 0) - dt;
      if (!w.goal || w.goalT <= 0) {
        w.goalT = 1;
        const at = s.who === "jef" ? { x: this.player.x, z: this.player.z } : this.town.position(s.who);
        if (at) w.goal = this.crowd.openNear(at.x, at.z) ?? at;
      }
    }
    // the goal itself may be solid (Jef's cart, a pile of goods): the open ground next to it
    if (!w.goal) w.goal = s.x !== null && s.z !== null ? (this.crowd.onGrid(s.x, s.z) ? (this.crowd.openNear(s.x, s.z) ?? { x: s.x, z: s.z }) : { x: s.x, z: s.z }) : null;
    const tx = w.goal?.x ?? s.x ?? this.player.x;
    const tz = w.goal?.z ?? s.z ?? this.player.z;
    const p = this.ensure(w, { x: tx, z: tz }, dt);
    this.keepLoad(w);
    if (!p) {
      const pos = this.town.position(w.r.npc);
      if (pos && Math.hypot(pos.x - tx, pos.z - tz) < 2) this.arrive(w, s, carrying);
      return;
    }
    // M6 routines: someone wedged where nobody can stand (a stall set down on them, pressed to a wall
    // after an unseen walk) cannot take a step; after a moment they squeeze out to the open ground beside
    if (w.r.purpose === "errand" && !this.crowd.canStand(p.x, p.z)) {
      w.wedgedT = (w.wedgedT ?? 0) + dt;
      if (w.wedgedT > 1.5) {
        w.wedgedT = 0;
        const q = this.crowd.openNear(p.x, p.z);
        if (q && Math.hypot(q.x - p.x, q.z - p.z) < 3) {
          p.x = q.x;
          p.z = q.z;
          w.goT = 0;
        }
      }
    } else w.wedgedT = 0;
    const d = Math.hypot(p.x - tx, p.z - tz);
    // there: at the open point, or up against a solid goal itself (Jef's cart, a pile); a person: where they are now
    const dRaw = s.x !== null && s.z !== null && !s.who ? Math.hypot(p.x - s.x, p.z - s.z) : d;
    // pushing a cart they stop with the cart's length between them and the goal
    if (d > REACH && dRaw > (w.r.cart ? 4.6 : 2.6)) {
      const pace = carrying ? (w.r.strong ? 1.1 : 0.85) : d > 12 ? 1.5 : 1.3;
      this.go(w, p, tx, tz, pace, 0.7, dt);
      if (this.stuck(w, d, dt)) {
        // a cart held up in the crowd of a market near the goal: he leaves it and carries the last few metres by hand
        if (carrying && w.r.cart && dRaw < 16) return void this.arrive(w, s, carrying);
        void this.report(w, false, "blocked");
      }
      return;
    }
    this.crowd.puppetStand(p, carrying ? "idle" : "idle", Math.atan2(this.player.x - p.x, this.player.z - p.z));
    this.arrive(w, s, carrying);
  }

  /** At the goal: a carry puts the goods down there (they count for the job), or is gone with them (walked off). */
  private arrive(w: Walk, s: RoutineStep, carrying: boolean): void {
    if (!carrying) return void this.report(w, true, "arrived");
    const load = w.load;
    const first = w.r.name.split(" ")[0];
    const run = this.jobs.running;
    const haul = run && run.job.id === s.job && run.run instanceof HaulRun ? run.run : null;
    w.load = [];
    this.keepLoad(w);
    if (s.off) {
      // the engine's roll: he walks off with it (with Jef's cart, the cart too); the job loses them
      const what = load.length ? GOODS[load[0].kind].one : "load";
      if (haul) load.forEach((it, i) => haul.onLost(it, i ? "" : `${first} walked off with the ${load.length > 1 ? `${load.length} ${what}s on your cart` : what}.`));
      else if (load.length) this.say(`${first} walked off with the ${what}.`);
      return void this.report(w, true, "gone");
    }
    if (!load.length || !haul) return void this.report(w, false, load.length ? "no_job" : "empty_hands");
    const task = run!.job.task as CarryTask;
    // down beside the goal, on the job's own slots (within reach of the chalk ring)
    const n = this.jobs.goods.items.filter((g) => g.owner === run!.job.employer_npc && Math.hypot(g.obj.position.x - (s.x ?? 0), g.obj.position.z - (s.z ?? 0)) < 4).length;
    load.forEach((it, k) => {
      const [x, z] = slot(task.to, (n + k) % 6, 0.8);
      const placed = this.jobs.goods.spawn(it.kind as Goods, x, z, { jobId: run!.job.id, owner: run!.job.employer_npc, heavy: it.heavy, broken: it.broken });
      haul.onPlaced(placed);
    });
    void this.report(w, true, "delivered");
  }

  private follow(w: Walk, dt: number): void {
    // Jef went in somewhere: they wait at the door (the server takes them in with him, or not)
    if (this.inside()) {
      if (w.p && this.crowd.alive(w.p) && (this.crowd.puppetBusy(w.p) || (w.wait -= dt) <= 0)) {
        this.crowd.puppetStand(w.p, "idle", null);
        w.wait = 3;
      }
      return;
    }
    const p = this.ensure(w, null, dt);
    if (!p) {
      w.lostT += dt;
      if (w.lostT > LOST_S) void this.report(w, false, "lost");
      return;
    }
    const px = this.player.x;
    const pz = this.player.z;
    const d = this.jefD(p.x, p.z);
    w.lostT = d > LOST_M ? w.lostT + dt : 0;
    if (w.lostT > LOST_S) return void this.report(w, false, "lost");
    if (this.player.swimming || this.world.isWater(px, pz)) {
      this.crowd.puppetStand(p, "idle", Math.atan2(px - p.x, pz - p.z));
      return;
    }
    if (d > 2.6) {
      const L = d || 1;
      // a step behind Jef on open ground (behind him may be a wall: then beside him, or where he stands)
      const q = this.crowd.openNear(px + ((p.x - px) / L) * 1.8, pz + ((p.z - pz) / L) * 1.8) ?? this.crowd.openNear(px, pz) ?? { x: px, z: pz };
      this.go(w, p, q.x, q.z, d > 10 ? 2.3 : d > 4.5 ? 1.75 : 1.35, 0.45, dt);
      return;
    }
    if (this.crowd.puppetBusy(p) || (w.wait -= dt) <= 0) {
      this.crowd.puppetStand(p, "idle", Math.atan2(px - p.x, pz - p.z));
      w.wait = 2;
    }
  }

  /** Free goods of this job lying about (nothing on top), not Jef's, not another hand's; the light ones for the weak. */
  private freeGoods(w: Walk, job: number): Item[] {
    const g = this.jobs.goods;
    return g.items.filter((it) => it.jobId === job && !g.above(it) && (!this.reserved.has(it) || this.reserved.get(it) === w.r.id) && (w.r.strong || !it.heavy));
  }

  private pickUp(w: Walk, s: RoutineStep, dt: number): void {
    if (s.job === null) return void this.report(w, false, "no_job");
    const near = { x: s.x ?? this.player.x, z: s.z ?? this.player.z };
    const p = this.ensure(w, near, dt);
    if (!w.target || !this.jobs.goods.items.includes(w.target) || this.jobs.goods.above(w.target)) {
      if (w.target) this.reserved.delete(w.target);
      const from = p ?? this.town.position(w.r.npc) ?? near;
      const list = this.freeGoods(w, s.job).sort((a, b) => Math.hypot(a.obj.position.x - from.x, a.obj.position.z - from.z) - Math.hypot(b.obj.position.x - from.x, b.obj.position.z - from.z));
      w.target = list[0] ?? null;
      if (!w.target) {
        // nothing lying about: the goods are carried (by Jef, the crew) or on a cart
        return void this.report(w, false, "none_left");
      }
      this.reserved.set(w.target, w.r.id);
    }
    const it = w.target;
    const ix = it.obj.position.x;
    const iz = it.obj.position.z;
    if (!p) {
      // unseen: they reach it and lift it where nobody sees
      const pos = this.town.position(w.r.npc);
      if (pos && Math.hypot(pos.x - ix, pos.z - iz) > 2) this.town.moveHidden(w.r.npc, ix, iz, dt);
      else this.lift(w, it, s);
      return;
    }
    const d = Math.hypot(p.x - ix, p.z - iz);
    // with the cart they load from where the cart stands (a step or two to the goods)
    if (d > (w.r.cart ? 4.6 : 1.9)) {
      const q = this.crowd.openNear(ix, iz) ?? { x: ix, z: iz };
      this.go(w, p, q.x, q.z, 1.3, 0.7, dt);
      if (this.stuck(w, d, dt)) {
        this.reserved.delete(it);
        void this.report(w, false, "blocked");
      }
      return;
    }
    this.lift(w, it, s);
  }

  /** The goods come off the ground: one onto the shoulder (the carry clip), or several onto Jef's cart; the step is done. */
  private lift(w: Walk, it: Item, s: RoutineStep): void {
    const want = Math.max(1, s.count ?? 1);
    const more =
      want > 1 && s.job !== null
        ? this.freeGoods(w, s.job)
            .filter((o) => o !== it && Math.hypot(o.obj.position.x - it.obj.position.x, o.obj.position.z - it.obj.position.z) < 4)
            .slice(0, want - 1)
        : [];
    for (const o of [it, ...more]) {
      this.jobs.goods.remove(o);
      this.reserved.delete(o);
      w.load.push(o);
    }
    w.target = null;
    this.keepLoad(w);
    void this.report(w, true, "picked up", w.load.length);
  }

  /** What they carry, on whichever puppet is theirs now: Jef's cart (with what is on it), or one thing on the shoulder. */
  private keepLoad(w: Walk): void {
    const p = w.p && this.crowd.alive(w.p) ? w.p : null;
    if (!p) return;
    const cart = !!w.r.cart;
    const stale = cart ? w.cartItems !== w.load.length : w.cartItems >= 0 || !!w.load.length !== !!w.shownOn;
    if (w.shownOn !== p || stale) this.showLoad(w, p);
  }

  private showLoad(w: Walk, p: Puppet | null): void {
    // off the old puppet (the shoulder load, the cart)
    const old = w.shownOn;
    for (const it of w.load) it.obj.removeFromParent();
    if (old && this.crowd.alive(old)) {
      if (w.cartItems >= 0) this.crowd.puppetVehicle(old, null);
      this.crowd.puppetLoad(old, false);
    }
    w.shownOn = null;
    w.cartItems = -1;
    if (!p) return;
    if (w.r.cart) {
      // pushing Jef's cart: the crowd's own handcart, with the goods on it
      this.crowd.puppetVehicle(p, { kind: "cart", items: w.load.length, what: "goods" });
      w.cartItems = w.load.length;
      w.shownOn = p;
      return;
    }
    const it = w.load[0];
    if (!it) return;
    // on the shoulder like the dockers' sacks: the walk becomes the carry clip
    this.crowd.puppetLoad(p, true);
    if (p.sack) p.sack.visible = false;
    const k = p.human.scale || 1;
    it.obj.position.set(0, 1.12 * k, 0.28 * k);
    it.obj.rotation.set(0.1, 0, 0);
    it.obj.scale.setScalar(0.85);
    p.group.add(it.obj);
    w.shownOn = p;
  }

  private waitHere(w: Walk, s: RoutineStep, dt: number): void {
    // inside a tavern with Jef: the room shows them; nothing in the street
    if (s.inside) return;
    const p = this.ensure(w, s.x !== null && s.z !== null ? { x: s.x, z: s.z } : null, dt);
    this.keepLoad(w);
    if (!p) return;
    if (this.crowd.puppetBusy(p) || (w.wait -= dt) <= 0) {
      const asking = s.label === "asking for more";
      this.crowd.puppetStand(p, asking ? "talk" : Math.random() < 0.4 ? "fold" : "idle", Math.atan2(this.player.x - p.x, this.player.z - p.z));
      w.wait = asking ? 2 : 4;
    }
  }

  /** Dev: the walks. */
  info() {
    return [...this.walks.values()].map((w) => {
      const pos = this.town.position(w.r.npc);
      return {
        id: w.r.id,
        npc: w.r.npc,
        name: w.r.name,
        purpose: w.r.purpose,
        step: `${w.r.i}/${w.r.n} ${w.r.step?.kind ?? "-"}${w.r.step?.off ? " (off)" : ""}`,
        puppet: !!w.p,
        carrying: w.load.length ? `${w.load.length} ${w.load[0].kind}` : null,
        cart: w.r.cart,
        at: pos ? [+pos.x.toFixed(1), +pos.z.toFixed(1)] : null,
        d: pos ? +this.jefD(pos.x, pos.z).toFixed(1) : null,
        reported: w.reported,
      };
    });
  }
}
