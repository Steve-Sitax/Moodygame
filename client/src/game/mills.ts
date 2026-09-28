import * as THREE from "three";
import type { World } from "../world/rijnkaai";
import type { Crowd, Puppet } from "./crowd";
import type { Goal, Sim, Town } from "./town";
import type { Now } from "../../../server/src/town/schedule";
import type { Job, MillTask, TownShop } from "../net/api";
import { LedDray, PushCart } from "../world/traffic";
import { loadProps, type Props } from "../world/props3d";
import { millSails } from "../world/rampart";
import { makeGoods } from "./props";
import { MILL_LABELS, SACK_H, SACK_NEST, SACK_W } from "./sackModel";
import { addPropObject, dropProps } from "../world/propSpots";
import { RUN_MAKERS, type Action, type Run, type RunCtx } from "./runs";
import type { Rect } from "../world/geom";
import { gameMin } from "../../../shared/clock";
import { CART_PACE, CART_SACKS, MILLS, millTurning, runNow, type MillDef, type MillId, type RunKind, type RunPhase } from "../../../shared/mills";
import SPOT_TABLE from "../../../shared/spots.json";

// M7 mills (Steve 2026-09-26: "millers and transport from mill to bakery or docks or from docks, and potential
// jobs"). What the two mills on the town wall do in the street; the ENGINE's side is server town/mills.ts and the
// rules both read are shared/mills.ts:
//
// - the sails turn only with wind, by day, on a working day (rampart.ts millSails, eased up and down);
// - the miller at his mill's door by day with wind, now and then at the tail pole's capstan (the Kipdorp mill) or
//   the chain from the gallery (the north mill) bringing the cap round into the wind; in fog or a gale he is in
//   the mill; his man hauls sacks between the mill and the sack store at the foot of the wall stair (town.ts haul);
// - the man takes the mill's cart out by the engine's timetable: at dawn the flour (loads it at the store, leads
//   the horse or pushes the handcart to the bakery, carries the sacks in while the baker comes out to his door, and
//   back), after dinner to a dock for grain (a docker of the town hands the sacks up) and back into the store;
// - an hour's help at the mill (Jef's job, kind "mill"): stay by the mill; when the miller calls, turn the cap.
//
// The carts are the traffic's (LedDray, PushCart): pushed or led by the crowd's vehicle while the man walks
// (crowd.puppetVehicle), a still one of this file's own where it stands (the store, the bakery, the dock).

const SPOTS = SPOT_TABLE as unknown as Record<string, { x: number; z: number; label: string; dir: [number, number] }>;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
type Pt = [number, number];

/** The sails' node of each mill in wall.glb (build_wall.py MILLS). */
const SAILS: Record<MillId, string> = { mill_mid: "mill_sails", mill_ne: "mill2_sails" };

interface MillView {
  id: MillId;
  label: string;
  miller: string;
  man: string;
  baker: string | null;
  grain: number;
  flour: number;
  bakery: number;
  cart: number;
  turning: number;
}

/** A mill's cart standing still (at the store, the bakery, the dock): the man is not at it, or is loading it. */
interface Rig {
  m: MillDef;
  dray: LedDray | null;
  cart: PushCart | null;
  /** Where the man stands to take it (x, z, yaw): the horse's head, or behind the grips. */
  at: [number, number, number];
  shown: boolean;
  sacks: number;
  rects: Rect[];
  /** Out with the man (the crowd's vehicle has it now). */
  out: boolean;
}

/** A leg of a walk: by the crowd, or up or down the wall stair by this file. */
interface Leg {
  x: number;
  z: number;
  stair: boolean;
}
interface Walker {
  legs: Leg[];
  i: number;
  pace: number;
  tries: number;
  to: Pt;
  /** On the flight: walking, or with a sack on the shoulder. */
  motion?: "walk" | "carry";
}

type Step = "to_rig" | "lead" | "trips" | "stand";
interface ManKit {
  m: MillDef;
  key: string;
  step: Step;
  target: Pt | null;
  /** Carrying: from A (to_b false: walking to A empty) to B with a sack. */
  a: Pt;
  b: Pt;
  toB: boolean;
  left: number;
  wait: number;
  /** A townsperson who helps (the baker at his door, a docker at the dock): held while he does. */
  helper: string | null;
  helperStep: number;
  tries: number;
  /** The cart's way (shared/mills.ts routes), the point walked to, and how long held up. */
  route: Pt[] | null;
  ri: number;
  stuck: number;
  townKey: string;
}

interface MillerKit {
  m: MillDef;
  phase: "door" | "to_cap" | "turn" | "back";
  t: number;
  next: number;
}

export class Mills {
  /** Set by main. */
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 12 });
  weather: () => string = () => "clear";
  /** A line said near Jef (a toast). */
  say: (text: string) => void = () => {};
  private view: MillView[] = [];
  private props: Props | null = null;
  private rigs = new Map<MillId, Rig>();
  private men = new Map<string, ManKit>();
  private millers = new Map<string, MillerKit>();
  private walkers = new Map<string, Walker>();
  /** The man's day between the runs: sacks from the mill down the stair to the store, and back up (his own haul). */
  private hauls = new Map<string, { stage: "to_door" | "at_door" | "to_pile" | "at_pile"; wait: number; w: Walker | null }>();
  private piles: THREE.Object3D[] = [];
  private pileCount = new Map<MillId, number>();
  private player = { x: 0, z: 0 };
  private fetchT = 0;
  private group = new THREE.Group();
  /** Jef's hour at a mill (MillRun): the mill, and whether the miller is calling for the cap now. */
  help: { mill: MillId; calling: boolean } | null = null;
  private log: string[] = [];
  /** Dev: the carts run this many hours late on this side (devRun: the dawn run by daylight for pictures). */
  shift = 0;

  /** The clock the carts go by (the game's, less a dev shift). */
  private runClock(): { day: number; hour: number } {
    const c = this.clock();
    let h = c.hour - this.shift;
    let d = c.day;
    if (h < 0) {
      h += 24;
      d -= 1;
    }
    return { day: d, hour: h };
  }
  private runOf(m: MillDef) {
    const c = this.runClock();
    return runNow(m, c.day, c.hour);
  }
  /** Is the man on a run now (his day says so; with a dev shift, the shifted clock)? */
  private onRun(now: Now): boolean {
    return this.shift ? now.act === "work" : now.place === "flour" || now.place === "grain";
  }

  /** Dev: the cart of the kind starts its run now on this side (the stocks stay the engine's). 0 puts it back. */
  devRun(kind: RunKind | null, lead = 0.02): number {
    if (!kind) return (this.shift = 0);
    const start = kind === "flour" ? 4.5 : 13.5;
    this.shift = this.clock().hour - start - lead;
    return this.shift;
  }

  constructor(
    private readonly world: World,
    private readonly town: Town,
    private readonly crowd: Crowd,
  ) {
    this.group.name = "mills";
    world.scene.add(this.group);
    RUN_MAKERS.mill = (job, ctx) => new MillRun(job, job.task as MillTask, ctx, this);
  }

  async load(): Promise<void> {
    this.props = await loadProps();
    for (const m of MILLS) this.rigs.set(m.id, this.makeRig(m));
    await this.fetch();
  }

  private async fetch(): Promise<void> {
    try {
      const r = await fetch("/api/mills");
      if (!r.ok) return;
      const d = (await r.json()) as { mills: MillView[] };
      this.view = d.mills;
      this.dressPiles();
    } catch {
      /* the next time */
    }
  }

  private note(t: string): void {
    this.log.push(`${this.clock().hour.toFixed(2)} ${t}`);
    if (this.log.length > 60) this.log.shift();
  }

  // ------------------------------------------------------------------ the town's hook

  hook(): NonNullable<Town["mills"]> {
    return {
      key: (s, now, day, hour) => this.keyOf(s, now, day, hour),
      goal: (s, now) => this.goalOf(s, now),
      behave: (s, dt) => this.behave(s, dt),
      spawned: (s) => this.spawned(s),
      lost: (s) => this.lost(s),
      own: (s) => s.r.trade === "miller" || s.r.trade === "miller_man",
    };
  }

  private millOf(s: Sim): MillDef | null {
    return MILLS.find((m) => m.id === s.r.work.place) ?? null;
  }

  private keyOf(s: Sim, now: Now, day: number, hour: number): string {
    const m = this.millOf(s);
    if (!m || now.act !== "work") return "";
    if (s.r.trade === "miller_man" && this.onRun(now)) {
      const run = this.runOf(m);
      // on the way: the point of the cart's way he should be at by now (unseen, the town walks him along it)
      const at = run && (run.phase === "go" || run.phase === "back") ? `:${this.wayIndex(m, run)}` : "";
      return `|mill:${run?.phase ?? "none"}${at}`;
    }
    if (s.r.trade === "miller") return `|mill:${millTurning(this.weather(), day, hour) > 0 ? "wind" : "still"}`;
    return "";
  }

  private goalOf(s: Sim, now: Now): Goal | null {
    const m = this.millOf(s);
    if (!m || now.act !== "work") return null;
    const { day, hour } = this.clock();
    if (s.r.trade === "miller") {
      // no wind (fog), or a gale: the sails braked; he is in at the stones
      if (millTurning(this.weather(), day, hour) <= 0) return { mode: "inside", x: m.door[0], z: m.door[1] };
      return null;
    }
    if (s.r.trade !== "miller_man" || !this.onRun(now)) return null;
    const run = this.runOf(m);
    // (a quarter hour before the run: down at the cart already)
    if (!run) return { mode: "stand", x: m.park[0], z: m.park[1], motion: "idle" };
    const [x, z] = run.phase === "go" || run.phase === "back" ? this.wayOf(m, run.run.kind, run.phase)[this.wayIndex(m, run)] : this.phasePoint(m, run.run.kind, run.phase);
    return { mode: "stand", x, z, motion: "idle" };
  }

  /** The cart's way for a phase (reversed on the way back). */
  private wayOf(m: MillDef, kind: RunKind, phase: RunPhase): Pt[] {
    const r = m.routes[kind === "flour" ? "bakery" : "dock"];
    return phase === "back" ? r.slice().reverse() : r;
  }

  /**
   * T1: where the run's sum has the man now on the cart's way (as server town/whereabouts.ts millRun and the town map):
   * the point, the index of the point of the way he walks to, and that point. Null when the run is not on its way.
   */
  private sumOnWay(m: MillDef): { x: number; z: number; i: number; next: Pt } | null {
    const run = this.runOf(m);
    if (!run || (run.phase !== "go" && run.phase !== "back")) return null;
    const way = this.wayOf(m, run.run.kind, run.phase);
    let total = 0;
    for (let i = 1; i < way.length; i++) total += dist(way[i][0], way[i][1], way[i - 1][0], way[i - 1][1]);
    let want = (run.since / Math.max(1e-6, run.since + run.left)) * total;
    for (let i = 1; i < way.length; i++) {
      const L = dist(way[i][0], way[i][1], way[i - 1][0], way[i - 1][1]);
      if (want <= L || i === way.length - 1) {
        const f = L > 0 ? Math.min(1, want / L) : 1;
        return { x: way[i - 1][0] + (way[i][0] - way[i - 1][0]) * f, z: way[i - 1][1] + (way[i][1] - way[i - 1][1]) * f, i, next: way[i] };
      }
      want -= L;
    }
    return null;
  }

  /** The point of the way reached by now at the cart's pace (the next one ahead of him). */
  private wayIndex(m: MillDef, run: NonNullable<ReturnType<typeof runNow>>): number {
    const way = this.wayOf(m, run.run.kind, run.phase);
    const f = run.since / Math.max(1e-6, run.since + run.left);
    let total = 0;
    for (let i = 1; i < way.length; i++) total += dist(way[i][0], way[i][1], way[i - 1][0], way[i - 1][1]);
    let acc = 0;
    for (let i = 1; i < way.length; i++) {
      acc += dist(way[i][0], way[i][1], way[i - 1][0], way[i - 1][1]);
      if (acc >= f * total) return i;
    }
    return way.length - 1;
  }

  /** Where the man is for a phase of a run: at the rig in the store (load, store, back), at the bakery or the dock. */
  private phasePoint(m: MillDef, kind: RunKind, phase: RunPhase): Pt {
    if (phase === "back" || (kind === "flour" && phase === "load") || (kind === "grain" && phase === "store")) return [m.park[0], m.park[1]];
    return kind === "flour" ? this.bakeryStop(m) : this.dockStop(m);
  }

  private shopOf(m: MillDef): TownShop | null {
    return this.town.data?.shops.find((s) => s.id === m.bakery) ?? null;
  }

  /** The cart stops in the street before the bakery: the job's spot out from the door, a little further out. */
  bakeryStop(m: MillDef): Pt {
    return m.stops.bakery;
  }

  /** At the dock: beside the spot where the grain lies, on free ground. */
  dockStop(m: MillDef): Pt {
    return m.stops.dock;
  }

  private freeCache = new Map<string, Pt>();
  private free(x: number, z: number): Pt {
    const k = `${x.toFixed(1)},${z.toFixed(1)}`;
    const had = this.freeCache.get(k);
    if (had) return had;
    let out: Pt = [x, z];
    search: for (let r = 0; r <= 5; r += 0.5)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        if (this.world.isFree(px, pz, 0.45) && !this.world.isWater(px, pz)) {
          out = [px, pz];
          break search;
        }
        if (r === 0) break;
      }
    this.freeCache.set(k, out);
    return out;
  }

  // ------------------------------------------------------------------ the carts

  private makeRig(m: MillDef): Rig {
    const props = this.props!;
    const rig: Rig = { m, dray: null, cart: null, at: [m.park[0], m.park[1], m.park[2]], shown: false, sacks: 0, rects: [], out: false };
    if (m.cart === "dray") {
      rig.dray = new LedDray(this.group, props, "sacks");
      rig.rects = rig.dray.rects;
    } else {
      rig.cart = new PushCart(this.group, props, { load: false });
      rig.cart.setItems(0, "sacks");
      rig.rects = rig.cart.rects;
    }
    this.poseRig(rig);
    this.showRig(rig, false);
    return rig;
  }

  /** The still cart where the man would take it (at: his place and heading). */
  private poseRig(rig: Rig): void {
    const [x, z, yaw] = rig.at;
    if (rig.dray) {
      rig.dray.place(x, z, yaw);
      rig.dray.follow(0, x, z, yaw, 0);
      rig.dray.loaded = rig.sacks > 0;
    }
    if (rig.cart) {
      rig.cart.place(x + Math.sin(yaw) * 0.5, z + Math.cos(yaw) * 0.5, yaw);
      rig.cart.push(0.1, x, z, 0.75, yaw, 0);
      rig.cart.setItems(Math.min(6, rig.sacks), "sacks");
    }
  }

  private showRig(rig: Rig, on: boolean): void {
    if (rig.shown === on) return;
    rig.shown = on;
    if (rig.dray) rig.dray.visible = on;
    if (rig.cart) rig.cart.visible = on;
    for (const r of rig.rects) (on ? this.world.addMover : this.world.removeMover).call(this.world, r);
  }

  /**
   * Where a sack is put on or taken off the still cart: beside the dray's bed (its middle, 4.6 m behind the man at
   * the horse's head, a little to his right: traffic.ts LedDray), beside the handcart; on the side nearest `near`.
   */
  private bedOf(rig: Rig, near?: Pt): Pt {
    const [x, z, yaw] = rig.at;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const sx = Math.cos(yaw);
    const sz = -Math.sin(yaw);
    const c: Pt = rig.dray ? [x - fx * 4.6 - sx * 0.85, z - fz * 4.6 - sz * 0.85] : [x + fx * 1.6, z + fz * 1.6];
    const w = rig.dray ? 1.7 : 1.1;
    const a: Pt = [c[0] + sx * w, c[1] + sz * w];
    const b: Pt = [c[0] - sx * w, c[1] - sz * w];
    const pick = near && dist(b[0], b[1], near[0], near[1]) < dist(a[0], a[1], near[0], near[1]) ? b : a;
    return this.free(pick[0], pick[1]);
  }

  /** The man takes the cart (the crowd's vehicle: it walks with him). */
  private takeRig(p: Puppet, rig: Rig, loaded: number): void {
    this.showRig(rig, false);
    rig.out = true;
    rig.sacks = loaded;
    if (rig.m.cart === "dray") this.crowd.puppetVehicle(p, { kind: "dray", loaded: loaded > 0 });
    else this.crowd.puppetVehicle(p, { kind: "cart", items: Math.min(6, loaded), what: "sacks" });
  }

  /** He lets go where he stands: the cart stands there still. */
  private dropRig(p: Puppet | null, rig: Rig, at?: [number, number, number]): void {
    if (p && this.crowd.puppetVehicleOf(p)) this.crowd.puppetVehicle(p, null);
    rig.out = false;
    if (at) rig.at = at;
    else if (p) rig.at = [p.x, p.z, p.yaw];
    this.poseRig(rig);
    this.showRig(rig, true);
  }

  // ------------------------------------------------------------------ in the street

  private spawned(s: Sim): void {
    const m = this.millOf(s);
    if (!m || !s.p) return;
    if (s.r.trade === "miller_man") {
      const k = this.manKit(s, m);
      k.key = "";
    }
  }

  private lost(s: Sim): void {
    const m = this.millOf(s);
    if (!m) return;
    if (s.r.trade === "miller_man") {
      const k = this.men.get(s.r.id);
      if (k?.helper) this.town.release(k.helper);
      if (k) k.helper = null;
      const rig = this.rigs.get(m.id);
      if (rig?.out) {
        if (s.p && this.crowd.puppetVehicleOf(s.p)) this.crowd.puppetVehicle(s.p, null);
        rig.out = false; // (unseen, the cart goes on with him: shown again where he next stops, or in the store)
      }
    }
    this.millers.delete(s.r.id);
    this.walkers.delete(s.r.id);
    this.hauls.delete(s.r.id);
  }

  /** The man's haul between the runs: a sack from the mill's door, down the stair, onto the store's pile; back up. */
  private haulStep(s: Sim, m: MillDef, dt: number): boolean {
    const p = s.p!;
    let h = this.hauls.get(s.r.id);
    if (!h) this.hauls.set(s.r.id, (h = { stage: "to_door", wait: 0, w: null }));
    const pile = this.pileAt(m);
    const sp = SPOTS[m.yard];
    const drop: Pt = [pile[0] - sp.dir[1] * 1.1, pile[1] + sp.dir[0] * 1.1];
    const go = (to: Pt, carry: boolean): boolean => {
      if (!h!.w) h!.w = { legs: this.plan(m, [p.x, p.z], to), i: 0, pace: 1.05, tries: 0, to, motion: carry ? "carry" : "walk" };
      if (this.walk(p, h!.w, dt)) return true;
      h!.w = null;
      return false;
    };
    switch (h.stage) {
      case "to_door":
        if (go(m.door, false)) return true;
        this.crowd.puppetStand(p, "idle", Math.atan2(m.tower[0] - p.x, m.tower[1] - p.z));
        h.stage = "at_door";
        h.wait = rnd(3, 6);
        return true;
      case "at_door":
        if ((h.wait -= dt) > 0) return true;
        this.crowd.puppetLoad(p, true);
        h.stage = "to_pile";
        return true;
      case "to_pile":
        if (go(drop, true)) return true;
        this.crowd.puppetLoad(p, false);
        this.crowd.puppetStand(p, "idle", Math.atan2(pile[0] - p.x, pile[1] - p.z));
        h.stage = "at_pile";
        h.wait = rnd(2, 4);
        return true;
      case "at_pile":
        if ((h.wait -= dt) > 0) return true;
        h.stage = "to_door";
        return true;
    }
  }

  private manKit(s: Sim, m: MillDef): ManKit {
    let k = this.men.get(s.r.id);
    if (!k) this.men.set(s.r.id, (k = { m, key: "", step: "stand", target: null, a: [0, 0], b: [0, 0], toB: false, left: 0, wait: 0, helper: null, helperStep: 0, tries: 0, route: null, ri: 0, stuck: 0, townKey: "" }));
    return k;
  }

  // ---- up and down the wall stair (the crowd's paths do not climb it)

  private onWall(x: number, z: number): boolean {
    return this.world.baseAt(x, z) > 3;
  }

  /** The legs from here to there: one walk on the same level; else to the stair, up or down it, and on. */
  private plan(m: MillDef, from: Pt, to: Pt): Leg[] {
    const up = !this.onWall(from[0], from[1]) && this.onWall(to[0], to[1]);
    const down = this.onWall(from[0], from[1]) && !this.onWall(to[0], to[1]);
    const st = m.stair;
    const L = (q: Pt, stair: boolean): Leg => ({ x: q[0], z: q[1], stair });
    if (up) return [L(st.out, false), L(st.foot, true), L(st.head, true), L(st.top, true), L(to, false)];
    if (down) return [L(st.top, false), L(st.head, true), L(st.foot, true), L(st.out, true), L(to, false)];
    return [L(to, false)];
  }

  /** Walk the legs (true while under way). A flight is walked step by step by this file, the rest by the crowd. */
  private walk(p: Puppet, w: Walker, dt: number): boolean {
    while (w.i < w.legs.length) {
      const L = w.legs[w.i];
      const d = dist(p.x, p.z, L.x, L.z);
      if (L.stair) {
        if (d < 0.12) {
          w.i++;
          w.tries = 0;
          continue;
        }
        const yaw = Math.atan2(L.x - p.x, L.z - p.z);
        if (w.tries === 0) {
          this.crowd.puppetStand(p, w.motion ?? "walk", yaw);
          w.tries = 1;
        }
        const k = Math.min(1, (w.pace * 0.8 * dt) / d);
        p.x += (L.x - p.x) * k;
        p.z += (L.z - p.z) * k;
        p.yaw = yaw;
        p.pyaw = yaw;
        return true;
      }
      if (this.crowd.puppetBusy(p)) return true;
      if (d < (w.i === w.legs.length - 1 ? 1.4 : 0.9)) {
        w.i++;
        w.tries = 0;
        continue;
      }
      // (held up: a few more tries, then straight on: never stuck on the stair's head)
      if (w.tries++ < 10) {
        this.crowd.puppetGo(p, L.x, L.z, w.pace);
        return true;
      }
      w.i++;
      w.tries = 0;
    }
    return false;
  }

  /** Where this person has to be now (the level matters: the wall's top or the street), or null. */
  private wantAt(s: Sim, m: MillDef): Pt | null {
    const g = s.goal;
    if (s.r.trade === "miller_man" && s.key.startsWith("work:") && !s.key.includes("|mill:")) return null; // (his own haul: haulStep)
    if (s.r.trade === "miller_man" && s.key.includes("|mill:")) {
      const run = this.runOf(m);
      return run ? this.phasePoint(m, run.run.kind, run.phase) : [m.park[0], m.park[1]];
    }
    if (g.mode === "haul" && g.a) return g.a;
    return [g.x, g.z];
  }

  private behave(s: Sim, dt: number): boolean {
    const m = this.millOf(s);
    if (!m || !s.p) return false;
    const p = s.p;
    // first to the right level: up the wall stair to the mill, down it to the street
    const want = this.wantAt(s, m);
    const wk = this.walkers.get(s.r.id);
    if (want && this.onWall(p.x, p.z) !== this.onWall(want[0], want[1])) {
      if (!wk || dist(wk.to[0], wk.to[1], want[0], want[1]) > 1) this.walkers.set(s.r.id, { legs: this.plan(m, [p.x, p.z], want), i: 0, pace: 1.1, tries: 0, to: want });
      const w = this.walkers.get(s.r.id)!;
      if (this.walk(p, w, dt)) return true;
      this.walkers.delete(s.r.id);
      // there: the town sends them on to their goal
      this.crowd.puppetGo(p, want[0], want[1]);
      return true;
    }
    if (wk && wk.i < wk.legs.length && this.walk(p, wk, dt)) return true;
    this.walkers.delete(s.r.id);
    if (s.r.trade === "miller") return this.millerBehave(s, m, dt);
    if (s.r.trade !== "miller_man") return false;
    if (s.key.startsWith("work:") && !s.key.includes("|mill:")) return this.haulStep(s, m, dt);
    const { day } = this.runClock();
    // (the phase as the town's key has it: the goal and this side change over on the same frame)
    const kp = /\|mill:(\w+)/.exec(s.key)?.[1];
    const r0 = kp && kp !== "none" ? this.runOf(m) : null;
    const run = r0 && r0.phase === kp ? r0 : r0 ? { ...r0, phase: kp as RunPhase } : null;
    const rig = this.rigs.get(m.id);
    if (!rig) return false;
    const k = this.manKit(s, m);
    // a lantern on the cart's round before the day is light (the flour goes out at half past four)
    const hr = this.clock().hour;
    this.crowd.puppetLantern(s.p, !!run && (hr < 6.6 || hr > 18.4));
    if (!run) {
      // no run: the cart back in the store (if he still has it, he puts it there)
      if (rig.out) {
        if (dist(p.x, p.z, m.park[0], m.park[1]) > 2) {
          this.lead(p, [m.park[0], m.park[1]]);
          return true;
        }
        this.dropRig(p, rig, [m.park[0], m.park[1], m.park[2]]);
      }
      if (k.helper) {
        this.town.release(k.helper);
        k.helper = null;
      }
      k.key = "";
      return false;
    }
    const key = `${day}:${run.run.kind}:${run.phase}`;
    if (key !== k.key) {
      k.key = key;
      k.tries = 0;
      this.startPhase(s, k, rig, run.run.kind, run.phase);
    }
    // (the town's key moved on a point of the way and sent him there itself: this side leads again)
    if (s.key !== k.townKey) {
      k.townKey = s.key;
      if (k.step === "lead") this.leadK(s.p, k);
    }
    this.stepPhase(s, k, rig, run.run.kind, run.phase, dt);
    return true;
  }

  private startPhase(s: Sim, k: ManKit, rig: Rig, kind: RunKind, phase: RunPhase): void {
    const m = k.m;
    const p = s.p!;
    this.note(`${s.r.name}: ${kind} ${phase}`);
    this.hauls.delete(s.r.id);
    this.crowd.puppetLoad(p, false);
    const view = this.view.find((v) => v.id === m.id);
    const yard = SPOTS[m.yard];
    const pile: Pt = this.pileAt(m);
    if (kind === "flour" && phase === "load") {
      // the sacks from the store onto the cart standing in the yard
      if (rig.out) this.dropRig(p, rig, [m.park[0], m.park[1], m.park[2]]);
      else this.showRig(rig, true);
      rig.sacks = 0;
      this.poseRig(rig);
      k.step = "trips";
      k.a = pile;
      k.b = this.bedOf(rig, pile);
      k.toB = false;
      k.left = Math.max(1, Math.min(CART_SACKS, view?.flour ?? CART_SACKS));
      void yard;
      return;
    }
    if (phase === "go" || phase === "back") {
      const to = this.phasePoint(m, kind, phase);
      k.target = to;
      this.setRoute(k, p, kind, phase);
      const loaded = kind === "flour" ? (phase === "go" ? Math.max(rig.sacks, view?.cart ?? 0, Math.min(CART_SACKS, Math.max(1, view?.flour ?? CART_SACKS))) : 0) : phase === "back" ? Math.max(rig.sacks, 3) : 0;
      if (rig.out) {
        k.step = "lead";
        this.leadK(p, k);
      } else if (rig.shown && dist(rig.at[0], rig.at[1], p.x, p.z) < 15) {
        // to the cart first, then away with it (T1, 2026-09-28: only when it stands by him; drawn out on his way, where
        // the run's sum has him, he has it with him, as the town map shows him)
        k.step = "to_rig";
        rig.sacks = loaded;
        this.crowd.puppetGo(p, rig.at[0], rig.at[1], CART_PACE);
      } else {
        // (the cart was out of sight: he has it with him)
        this.takeRig(p, rig, loaded);
        k.step = "lead";
        this.leadK(p, k);
      }
      return;
    }
    // at the far end (unload at the bakery, load at the dock) or the store (grain into it)
    const at = this.phasePoint(m, kind, phase);
    k.target = at;
    if (dist(p.x, p.z, at[0], at[1]) > 6 && (rig.out || !rig.shown || dist(rig.at[0], rig.at[1], p.x, p.z) > 15)) {
      // not there yet (late, or seen again on his way): he has the cart with him and goes on there first
      if (!rig.out) this.takeRig(p, rig, kind === "flour" ? Math.max(rig.sacks, 3) : phase === "store" ? 3 : 0);
      k.step = "lead";
      k.route = null;
      this.leadK(p, k);
      return;
    }
    this.beginTrips(s, k, rig, kind, phase);
  }

  private beginTrips(s: Sim, k: ManKit, rig: Rig, kind: RunKind, phase: RunPhase): void {
    const m = k.m;
    const p = s.p!;
    if (rig.out) this.dropRig(p, rig);
    else if (dist(rig.at[0], rig.at[1], p.x, p.z) > 15) {
      // (he came with it unseen: the cart stands where he stopped)
      rig.sacks = kind === "grain" && phase === "store" ? 3 : kind === "flour" ? Math.max(rig.sacks, 3) : 0;
      this.dropRig(p, rig, [p.x, p.z, p.yaw]);
    } else this.showRig(rig, true);
    const view = this.view.find((v) => v.id === m.id);
    const sp0 = kind === "flour" ? SPOTS[m.bakeryDoor] : phase === "load" ? SPOTS[m.grain] : null;
    const bed = this.bedOf(rig, sp0 ? [sp0.x, sp0.z] : this.pileAt(m));
    k.step = "trips";
    k.toB = false;
    k.stuck = 0;
    if (kind === "flour" && phase === "unload") {
      // off the cart, in at the baker's door; the baker comes out to his door
      const sp = SPOTS[m.bakeryDoor];
      k.a = bed;
      k.b = [sp.x, sp.z];
      k.left = Math.max(rig.sacks, view?.cart ?? 0) || 1;
      const baker = view?.baker ?? this.shopOf(m)?.keeper ?? null;
      if (baker && !this.town.held(baker)) {
        const shop = this.shopOf(m);
        const from = shop ? { x: shop.door[0], z: shop.door[1] } : undefined;
        const bp = this.town.puppet(baker) ?? (dist(p.x, p.z, this.player.x, this.player.z) < 70 ? this.town.claim(baker, from) : null);
        if (bp) {
          if (!this.town.held(baker)) this.town.claim(baker);
          k.helper = baker;
          k.helperStep = 0;
          // beside his door (not on the step the sacks go in at)
          const o = shop?.out ?? [0, 1];
          this.crowd.puppetGo(bp, sp.x + o[1] * 1.2 + o[0] * 0.3, sp.z - o[0] * 1.2 + o[1] * 0.3, 1.0);
          this.note(`the baker ${baker} comes out`);
        }
      }
    } else if (kind === "grain" && phase === "load") {
      // up onto the cart from the dock: a docker of the town hands them up, if one is near
      const sp = SPOTS[m.grain];
      k.a = [sp.x, sp.z];
      k.b = bed;
      k.left = 3;
      const hand = this.town
        .inStreet(sp.x, sp.z, 28)
        .filter((q) => (q.trade === "docker" || q.trade === "natie" || q.trade === "porter") && !this.town.held(q.id))
        .sort((a, b) => dist(a.x, a.z, sp.x, sp.z) - dist(b.x, b.z, sp.x, sp.z))[0];
      if (hand) {
        const hp = this.town.claim(hand.id);
        if (hp) {
          k.helper = hand.id;
          k.helperStep = 0;
          this.crowd.puppetGo(hp, sp.x, sp.z);
          this.note(`${hand.id} (${hand.trade}) hands the sacks up`);
        }
      }
      rig.sacks = 0;
    } else {
      // grain: off the cart into the store at the foot of the stair
      k.a = bed;
      k.b = this.pileAt(m);
      k.left = Math.max(1, rig.sacks || 3);
    }
  }

  /** The cart's way for this phase (reversed for the way back), from the point of it nearest him. */
  private setRoute(k: ManKit, p: Puppet, kind: RunKind, phase: RunPhase): void {
    const r = k.m.routes[kind === "flour" ? "bakery" : "dock"];
    k.route = phase === "back" ? r.slice().reverse() : r.slice();
    let best = 0;
    k.route.forEach((q, i) => {
      if (dist(q[0], q[1], p.x, p.z) < dist(k.route![best][0], k.route![best][1], p.x, p.z)) best = i;
    });
    k.ri = Math.min(k.route.length - 1, best + (dist(k.route[best][0], k.route[best][1], p.x, p.z) < 8 ? 1 : 0));
    k.stuck = 0;
  }

  /** On along the cart's way (the next point of it), or straight to the target. */
  private leadK(p: Puppet, k: ManKit): void {
    if (k.route) {
      while (k.ri < k.route.length - 1 && dist(p.x, p.z, k.route[k.ri][0], k.route[k.ri][1]) < 3.2) k.ri++;
      this.lead(p, k.route[k.ri]);
    } else if (k.target) this.lead(p, k.target);
  }

  /** Lead the horse (or push the cart) there at the cart's pace. */
  private lead(p: Puppet, to: Pt): void {
    this.crowd.puppetGo(p, to[0], to[1], CART_PACE);
  }

  private stepPhase(s: Sim, k: ManKit, rig: Rig, kind: RunKind, phase: RunPhase, dt: number): void {
    const p = s.p!;
    const busy = this.crowd.puppetBusy(p);
    switch (k.step) {
      case "to_rig": {
        if (busy) return;
        // to a step before the horse's head (the rig itself is solid), then the last step onto the place
        const ax = rig.at[0] + Math.sin(rig.at[2]) * 1.4;
        const az = rig.at[1] + Math.cos(rig.at[2]) * 1.4;
        const d = dist(p.x, p.z, ax, az);
        if (d > 1.2 && (k.tries++ < 6 || d > 4)) {
          this.crowd.puppetGo(p, ax, az, CART_PACE);
          return;
        }
        // at the horse's head (behind the grips): facing the way it stands, and off
        p.x = rig.at[0];
        p.z = rig.at[1];
        this.crowd.puppetStand(p, "idle", rig.at[2]);
        p.yaw = rig.at[2];
        this.takeRig(p, rig, rig.sacks);
        k.step = "lead";
        this.leadK(p, k);
        return;
      }
      case "lead": {
        const to = k.target;
        if (!to) return;
        // near the point of the way he walks to: on to the next (no stop at each)
        if (k.route && k.ri < k.route.length - 1 && dist(p.x, p.z, k.route[k.ri][0], k.route[k.ri][1]) < 3.2) {
          this.leadK(p, k);
          return;
        }
        // out of Jef's sight (and not close by): along the cart's way
        // at its pace, point to point, as the town moves the unseen (the rig follows his steps)
        const w = k.route && k.route[k.ri] ? k.route[k.ri] : to;
        // T1 (2026-09-28): unseen on the way out or back, he is where the run's sum has him (the town map's dot, and
        // after a jump of the clock too: a sleep, a skip), and walks on from there when seen
        const sum = !p.shown && dist(p.x, p.z, this.player.x, this.player.z) > 25 && k.route ? this.sumOnWay(k.m) : null;
        if (sum) {
          const yaw = Math.atan2(sum.next[0] - sum.x, sum.next[1] - sum.z);
          if (p.state !== "stand" || p.human.motion !== "walk") this.crowd.puppetStand(p, "walk", yaw);
          p.x = sum.x;
          p.z = sum.z;
          p.yaw = yaw;
          p.pyaw = yaw;
          k.ri = sum.i;
          if (sum.i < k.route!.length - 1 || dist(p.x, p.z, to[0], to[1]) > 3) return;
        } else if (!p.shown && dist(p.x, p.z, this.player.x, this.player.z) > 25) {
          const d = dist(p.x, p.z, w[0], w[1]);
          if (d < 0.3) {
            if (k.route && k.ri < k.route.length - 1) k.ri++;
            return;
          }
          const yaw = Math.atan2(w[0] - p.x, w[1] - p.z);
          if (p.state !== "stand" || p.human.motion !== "walk") this.crowd.puppetStand(p, "walk", yaw);
          const f = Math.min(1, (CART_PACE * dt) / d);
          p.x += (w[0] - p.x) * f;
          p.z += (w[1] - p.z) * f;
          p.yaw = yaw;
          p.pyaw = yaw;
          if (d > 3 || (k.route && k.ri < k.route.length - 1)) return;
        }
        if (busy) {
          // held up (no way this frame, a rig in the way): after a while on to the next point (near Jef only)
          if (p.state === "pause" && this.crowd.onGrid(p.x, p.z) && (k.stuck += dt) > 5) {
            k.stuck = 0;
            if (k.route && k.ri < k.route.length - 1) k.ri++;
            this.leadK(p, k);
          }
          return;
        }
        k.stuck = 0;
        if (dist(p.x, p.z, to[0], to[1]) > 3) {
          // (on and on at the cart's pace: the phase ends by the clock, not by him)
          this.leadK(p, k);
          return;
        }
        k.tries = 0;
        // there
        if (phase === "go" || phase === "back") {
          if (phase === "back") {
            this.dropRig(p, rig, [p.x, p.z, p.yaw]);
            this.crowd.puppetStand(p, "idle", null);
          } else {
            this.crowd.puppetStand(p, "idle", null);
            this.dropRig(p, rig);
          }
          k.step = "stand";
          k.wait = rnd(2, 5);
          return;
        }
        this.beginTrips(s, k, rig, kind, phase);
        return;
      }
      case "trips":
        return this.trips(s, k, rig, kind, phase, dt);
      case "stand":
        if (busy) return;
        if ((k.wait -= dt) > 0) return;
        k.wait = rnd(4, 9);
        this.crowd.puppetStand(p, Math.random() < 0.3 ? "fold" : "idle", null);
        return;
    }
  }

  private trips(s: Sim, k: ManKit, rig: Rig, kind: RunKind, phase: RunPhase, dt: number): void {
    const p = s.p!;
    // the helper (the baker at his door, a docker at the dock)
    const hp = k.helper ? this.town.puppet(k.helper) : null;
    if (hp && kind === "flour") {
      if (!this.crowd.puppetBusy(hp) && k.helperStep === 0) {
        k.helperStep = 1;
        this.crowd.puppetStand(hp, "talk", Math.atan2(p.x - hp.x, p.z - hp.z));
      }
    }
    // a docker who cannot get to the grain (across the water, round a block) is let go after a while
    if (hp && kind === "grain" && phase === "load" && k.left === 3 && !k.toB) {
      if ((k.stuck += dt) > 20 && dist(hp.x, hp.z, k.a[0], k.a[1]) > 3) {
        this.town.release(k.helper!);
        this.note(`${k.helper} could not come: ${s.r.name} loads alone`);
        k.helper = null;
        k.stuck = 0;
        return;
      }
    }
    const docker = hp && kind === "grain" && phase === "load";
    const who = docker ? hp! : p;
    if (docker && !this.crowd.puppetBusy(p) && k.helperStep === 0) {
      k.helperStep = 1;
      this.crowd.puppetGo(p, k.b[0], k.b[1], 1.0);
    }
    if (this.crowd.puppetBusy(who)) return;
    if ((k.wait -= dt) > 0) return;
    if (k.left <= 0) {
      // done: the load is off (or on); stand by the cart
      this.crowd.puppetLoad(who, false);
      if (k.helper) {
        this.town.release(k.helper);
        k.helper = null;
      }
      if (docker) this.crowd.puppetStand(p, "idle", null);
      k.step = "stand";
      k.wait = 1;
      return;
    }
    const at = k.toB ? k.b : k.a;
    if (dist(who.x, who.z, at[0], at[1]) > 1.6 && k.tries++ < 3) {
      this.crowd.puppetGo(who, at[0], at[1], 1.25);
      return;
    }
    k.tries = 0;
    k.wait = rnd(1.2, 2.2);
    if (!k.toB) {
      // at A: take up a sack
      this.crowd.puppetStand(who, "idle", null);
      this.crowd.puppetLoad(who, true);
      if (kind === "flour" && phase === "unload") this.setRigSacks(rig, rig.sacks - 1);
      if (kind === "grain" && phase === "store") this.setRigSacks(rig, rig.sacks - 1);
      k.toB = true;
      this.crowd.puppetGo(who, k.b[0], k.b[1], 1.25);
    } else {
      // at B: put it down
      this.crowd.puppetLoad(who, false);
      this.crowd.puppetStand(who, "idle", null);
      if ((kind === "flour" && phase === "load") || (kind === "grain" && phase === "load")) this.setRigSacks(rig, rig.sacks + 1);
      if (kind === "grain" && phase === "store") this.pileCount.set(k.m.id, Math.min(6, (this.pileCount.get(k.m.id) ?? 2) + 1));
      k.left--;
      k.toB = false;
      if (k.left > 0) this.crowd.puppetGo(who, k.a[0], k.a[1], 1.25);
    }
  }

  private setRigSacks(rig: Rig, n: number): void {
    rig.sacks = Math.max(0, n);
    if (rig.dray) rig.dray.loaded = rig.sacks > 0;
    if (rig.cart) rig.cart.setItems(Math.min(6, rig.sacks), "sacks");
  }

  // ------------------------------------------------------------------ the miller

  /** Where the miller (or Jef) stands to turn the cap: beside the capstan, or at the gallery's chain by the door. */
  capSpot(m: MillDef): { x: number; z: number; face: number } {
    if (m.capstan) {
      const x = m.capstan[0] + 1.25;
      const z = m.capstan[1];
      return { x, z, face: Math.atan2(m.capstan[0] - x, m.capstan[1] - z) };
    }
    const ox = m.door[0] - m.tower[0];
    const oz = m.door[1] - m.tower[1];
    const L = Math.hypot(ox, oz) || 1;
    const x = m.door[0] - (oz / L) * 1.4;
    const z = m.door[1] + (ox / L) * 1.4;
    return { x, z, face: Math.atan2(m.tower[0] - x, m.tower[1] - z) };
  }

  private millerBehave(s: Sim, m: MillDef, dt: number): boolean {
    const p = s.p!;
    const { day, hour } = this.clock();
    const windy = millTurning(this.weather(), day, hour) > 0;
    if (!s.key.startsWith("work") || !windy) {
      this.millers.delete(s.r.id);
      return false;
    }
    let k = this.millers.get(s.r.id);
    if (!k) this.millers.set(s.r.id, (k = { m, phase: "door", t: 0, next: rnd(25, 60) }));
    k.t += dt;
    const called = this.help?.mill === m.id && this.help.calling;
    const cap = this.capSpot(m);
    switch (k.phase) {
      case "door":
        if ((k.next -= dt) > 0 && !called) return false;
        k.phase = "to_cap";
        k.t = 0;
        this.crowd.puppetGo(p, cap.x, cap.z);
        if (dist(p.x, p.z, this.player.x, this.player.z) < 30 && !called) this.say(`${s.r.first} squints up at the sails and goes to bring the cap round.`);
        return true;
      case "to_cap":
        if (this.crowd.puppetBusy(p) && k.t < 40) return true;
        k.phase = "turn";
        k.t = 0;
        this.crowd.puppetStand(p, m.capstan ? "push" : "pull", cap.face);
        return true;
      case "turn":
        // leaning on the capstan's spokes (the chain from the gallery), a few steps round
        if (k.t < (called ? 30 : 9)) return true;
        if (called && this.help?.calling) return true;
        k.phase = "back";
        this.crowd.puppetGo(p, m.door[0], m.door[1]);
        return true;
      case "back":
        if (this.crowd.puppetBusy(p)) return true;
        k.phase = "door";
        k.next = rnd(45, 90);
        s.wait = 0;
        this.crowd.puppetStand(p, "fold", Math.atan2(m.door[0] - m.tower[0], m.door[1] - m.tower[1]));
        return false;
    }
  }

  // ------------------------------------------------------------------ the stock you can see

  /** The store's pile: behind the spot where the job's sacks lie (not on them). */
  private pileAt(m: MillDef): Pt {
    const sp = SPOTS[m.yard];
    return [sp.x - sp.dir[0] * 1.6, sp.z - sp.dir[1] * 1.6];
  }

  private dressPiles(): void {
    for (const o of this.piles) o.removeFromParent();
    this.piles = [];
    dropProps("mills");
    for (const m of MILLS) {
      const v = this.view.find((q) => q.id === m.id);
      const n = Math.max(1, Math.min(5, this.pileCount.get(m.id) ?? v?.flour ?? 3));
      this.pileCount.set(m.id, n);
      const [px, pz] = this.pileAt(m);
      const sp = SPOTS[m.yard];
      for (let i = 0; i < n; i++) {
        // flour, stencilled with the mill's name; three side by side, the next two pressed into the dips between them
        const o = makeGoods("sacks", this.world.mats, MILL_LABELS[m.id]?.flour ?? null);
        const row = i < 3 ? 0 : 1;
        const along = row === 0 ? (i - 1) * SACK_W : (i - 3.5) * SACK_W;
        o.position.set(px - sp.dir[1] * along, row * (SACK_H - SACK_NEST), pz + sp.dir[0] * along);
        // (the sack's length along x: across the row, its mouth toward the wall; a little askew each)
        o.rotation.y = Math.atan2(-sp.dir[1], sp.dir[0]) + (i % 2 ? 0.05 : -0.04);
        o.name = "mill_sack";
        this.group.add(o);
        this.piles.push(o);
        addPropObject("mills", o, `mills:${m.id}`, "sack");
      }
      // two sacks by the mill's own door, up on the wall
      const ox = m.door[0] - m.tower[0];
      const oz = m.door[1] - m.tower[1];
      const L = Math.hypot(ox, oz) || 1;
      for (let i = 0; i < 2; i++) {
        const side = i ? 1 : -1;
        const x = m.door[0] - (ox / L) * 0.3 + (oz / L) * side * 1.35;
        const z = m.door[1] - (oz / L) * 0.3 - (ox / L) * side * 1.35;
        const o = makeGoods("sacks", this.world.mats, MILL_LABELS[m.id]?.flour ?? null);
        o.position.set(x, this.world.baseAt(x, z), z);
        o.rotation.y = Math.atan2(ox, oz) + Math.PI / 2 + i * 0.2;
        this.group.add(o);
        this.piles.push(o);
      }
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, player: { x: number; z: number }): void {
    this.player = { x: player.x, z: player.z };
    const { day, hour } = this.clock();
    const w = this.weather();
    for (const m of MILLS) millSails[SAILS[m.id]] = millTurning(w, day, hour);
    this.fetchT -= dt;
    if (this.fetchT <= 0) {
      this.fetchT = 20;
      void this.fetch();
    }
    // the sacks at the stores and by the doors: drawn near Jef only
    for (const o of this.piles) o.visible = dist(o.position.x, o.position.z, player.x, player.z) < 150;
    // the still carts: in the store when no run is under way and the man is not about with it
    for (const rig of this.rigs.values()) {
      if (rig.out) continue;
      const run = this.runOf(rig.m);
      const home = dist(rig.at[0], rig.at[1], rig.m.park[0], rig.m.park[1]) < 3;
      const man = this.town.puppet(MILLS.find((q) => q.id === rig.m.id) ? this.view.find((v) => v.id === rig.m.id)?.man ?? "" : "");
      const far = dist(rig.at[0], rig.at[1], player.x, player.z) > 90;
      if (!run && !home && far && !man) {
        rig.at = [rig.m.park[0], rig.m.park[1], rig.m.park[2]];
        rig.sacks = 0;
        this.poseRig(rig);
      }
      // out on a run and nobody sees the man: the cart is with him (not in the store)
      const away = !!run && run.phase !== "load" && !(run.run.kind === "grain" && run.phase === "store") && !man && home;
      this.showRig(rig, !away && dist(rig.at[0], rig.at[1], player.x, player.z) < 160);
    }
  }

  // ------------------------------------------------------------------ checks and dev

  /** For the path check (CLAUDE.md): the mills' doors, where the cap is turned, the stores, the carts' stops. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const m of MILLS) {
      out.push({ label: `${m.label}: the door`, x: m.door[0], z: m.door[1], reach: 1.6 });
      const c = this.capSpot(m);
      out.push({ label: `${m.label}: where the cap is turned`, x: c.x, z: c.z, reach: 1.6 });
      out.push({ label: `${m.label}: the cart's stand`, x: m.park[0], z: m.park[1], reach: 2.4 });
      const b = this.bakeryStop(m);
      out.push({ label: `${m.label}: the cart at the bakery`, x: b[0], z: b[1], reach: 2.4 });
      const d = this.dockStop(m);
      out.push({ label: `${m.label}: the cart at the dock`, x: d[0], z: d[1], reach: 2.4 });
    }
    return out;
  }

  info() {
    return {
      view: this.view,
      rigs: [...this.rigs.values()].map((r) => ({ mill: r.m.id, at: r.at.map((v) => +v.toFixed(1)), shown: r.shown, out: r.out, sacks: r.sacks })),
      men: [...this.men.entries()].map(([id, k]) => ({ id, key: k.key, step: k.step, left: k.left, helper: k.helper, target: k.target })),
      millers: [...this.millers.entries()].map(([id, k]) => ({ id, phase: k.phase })),
      runs: MILLS.map((m) => ({ mill: m.id, now: this.runOf(m)?.phase ?? null })),
      shift: this.shift,
      sails: { ...millSails },
      help: this.help,
      log: this.log.slice(-20),
    };
  }
}

// ------------------------------------------------------------------ Jef's hour at the mill

const bell = (realSecs: number) => {
  const m = Math.max(1, Math.ceil(gameMin(Math.max(0, realSecs))));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

/**
 * An hour's help at a mill (server town/mills.ts, kind "mill"). Stay by the mill (on the wall); twice in the
 * hour the miller calls that the wind has backed: go to the capstan (the gallery's chain on the north mill)
 * and E to bring the cap round, a few seconds' leaning on the spokes. The engine pays by the turns done.
 */
class MillRun implements Run {
  private t = 0;
  private away = 0;
  private turns = 0;
  private callAt: number[];
  private calls = 0;
  private callT = -1;
  private turning = -1;
  private ended = false;
  private readonly m: MillDef;

  constructor(
    private readonly job: Job,
    private readonly task: MillTask,
    private readonly ctx: RunCtx,
    private readonly mills: Mills,
  ) {
    this.m = MILLS.find((q) => q.id === task.mill) ?? MILLS[0];
    this.callAt = Array.from({ length: task.turns }, (_, i) => task.duration_s * (0.25 + (0.5 * i) / Math.max(1, task.turns - 1 || 1)));
    ctx.toast(`${job.employer_name}: "Stay by the mill. When the wind backs I'll call you to the ${this.m.capstan ? "capstan" : "chain"}."`);
    mills.help = { mill: this.m.id, calling: false };
  }

  private near(): boolean {
    const { x, z } = this.ctx.player;
    return Math.hypot(x - this.task.post.x, z - this.task.post.z) < 14 && this.ctx.player.y > 3;
  }

  update(dt: number): void {
    if (this.ended) return;
    const here = this.near();
    if (here) this.t += dt;
    else this.away += dt;
    // the miller calls
    if (this.callT < 0 && this.calls < this.callAt.length && this.t >= this.callAt[this.calls]) {
      this.callT = 0;
      this.calls++;
      this.mills.help = { mill: this.m.id, calling: true };
      this.ctx.toast(`${this.job.employer_name}: "She's backing! To the ${this.m.capstan ? "capstan" : "chain"}, quick, before she's taken aback!"`);
      this.ctx.sfx("bell");
    }
    if (this.callT >= 0 && this.turning < 0) {
      this.callT += dt;
      if (this.callT > 40) {
        // he brings her round himself, cursing
        this.callT = -1;
        this.mills.help = { mill: this.m.id, calling: false };
        this.ctx.toast(`${this.job.employer_name} brings the cap round on his own and does not look at you.`);
      }
    }
    if (this.turning >= 0) {
      this.turning += dt;
      const c = this.mills.capSpot(this.m);
      if (Math.hypot(this.ctx.player.x - c.x, this.ctx.player.z - c.z) > 3.2) {
        this.turning = -1;
        this.ctx.toast("You let go of the spokes and the cap stops half way.");
      } else if (this.turning > 5) {
        this.turning = -1;
        this.callT = -1;
        this.turns++;
        this.mills.help = { mill: this.m.id, calling: false };
        this.ctx.toast(`The cap grinds round on its curb until the sails face the wind again. ${this.job.employer_name}: "That's her."`);
      }
    }
    if (this.t >= this.task.duration_s && this.callT < 0 && this.turning < 0) {
      this.ended = true;
      this.mills.help = null;
      this.ctx.finish({ turns: this.turns, left_post_s: Math.round(this.away) });
    }
  }

  actions(): Action[] {
    if (this.ended || this.callT < 0 || this.turning >= 0) return [];
    const c = this.mills.capSpot(this.m);
    const { x, z } = this.ctx.player;
    if (Math.hypot(x - c.x, z - c.z) > 2.6) return [];
    const target = this.m.capstan ? { x: this.m.capstan[0], y: this.ctx.world.baseAt(this.m.capstan[0], this.m.capstan[1]) + 0.9, z: this.m.capstan[1] } : { x: c.x, y: this.ctx.world.baseAt(c.x, c.z) + 1.4, z: c.z };
    return [
      {
        key: "KeyE",
        text: this.m.capstan ? "lean on the capstan: bring the cap round" : "haul on the chain: bring the cap round",
        at: target,
        run: () => {
          this.turning = 0;
          this.ctx.toast(this.m.capstan ? "You put your shoulder to the spokes and walk the capstan round, the chain groaning." : "You haul hand over hand on the chain from the gallery.");
        },
      },
    ];
  }
  carryActions(): Action[] {
    return this.actions();
  }
  placeLabel(): string | null {
    return null;
  }
  onPlaced(): void {}
  onLost(): void {}
  goal(): THREE.Vector3 | null {
    const c = this.callT >= 0 ? this.mills.capSpot(this.m) : this.task.post;
    return new THREE.Vector3(c.x, this.ctx.world.baseAt(c.x, c.z) + 1, c.z);
  }
  hud(): string {
    const left = Math.max(0, this.task.duration_s - this.t);
    const call = this.callT >= 0 ? ` <b>${this.m.capstan ? "To the capstan!" : "To the chain!"}</b>` : "";
    return `Help at ${this.task.post.label}: ${bell(left)} left. Cap turned ${this.turns} of ${this.task.turns}.${call}`;
  }
  dispose(): void {
    if (this.mills.help?.mill === this.m.id) this.mills.help = null;
  }
  snapshot(): Record<string, unknown> {
    return { t: this.t, away: this.away, turns: this.turns, calls: this.calls };
  }
  restore(s: Record<string, unknown>): void {
    this.t = Number(s.t) || 0;
    this.away = Number(s.away) || 0;
    this.turns = Number(s.turns) || 0;
    this.calls = Number(s.calls) || 0;
  }
}
