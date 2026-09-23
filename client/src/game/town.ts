import * as THREE from "three";
import { api, type JobsPayload, type Pt, type TownData, type TownPlace, type TownResident } from "../net/api";
import { activityAt, type Now } from "../../../server/src/town/schedule";
import type { Crowd, Puppet } from "./crowd";
import type { Animals } from "./animals";
import type { Stalls } from "./stalls";
import type { Npc, People } from "./people";
import { isHumanKind, type HumanKind, type Motion } from "./humans";
import type { World } from "../world/rijnkaai";
import SPOT_TABLE from "../../../shared/spots.json";
import CITY from "../../../shared/city.json";

// The town (M3e): the residents the server made (homes, families, trades,
// schedules) living by the game clock. Everyone is simulated cheaply by
// schedule: where they should be now, and a straight walk there at a brisk
// pace while nobody sees them. Only those near Jef become people in the street:
// "puppets" of the crowd (crowd.ts), which walks them on its grid (A*, stuck
// checks, keeping right, going round Jef). Here each one gets told what to do:
// come out of their door, walk to work, sell at the stall, carry sacks between
// the quay and the door, walk the beat, play tag with the other children, stand
// with a drink at the tavern door, walk home and go in.
//
// Thieves come out at night and try Jef's pocket (the server decides what
// they take). The board's employers stand at their posts by day (people.ts);
// after dark, while they have work open, they stand under a lamp or carry a
// lantern.

const SPAWN_R = 55;
const DESPAWN_R = 68;
const MAX_PUPPETS = 34;
/** Unseen, people cross town at this pace (m/s): the clock runs 180 times faster than life. */
const HIDDEN_SPEED = 6;
const SPOTS = SPOT_TABLE as unknown as Record<string, { x: number; z: number; label: string }>;
const LAMPS = ((CITY as unknown as { decor?: { lamps?: Pt[] } }).decor?.lamps ?? []) as Pt[];

type Mode = "home" | "inside" | "church" | "stand" | "haul" | "patrol" | "roam" | "play" | "market" | "loiter" | "tavern" | "stroll" | "thief";

interface Goal {
  mode: Mode;
  x: number;
  z: number;
  yaw?: number | null;
  motion?: Motion;
  /** Spread over this radius (market, play, loiter, stroll). */
  r?: number;
  route?: Pt[];
  a?: Pt;
  b?: Pt;
  place?: string;
}

interface Sim {
  r: TownResident;
  kind: HumanKind;
  x: number;
  z: number;
  inside: boolean;
  /** The door they went in at (to come out of it again). */
  door: Pt;
  key: string;
  goal: Goal;
  p: Puppet | null;
  step: number;
  wait: number;
  toB: boolean;
  /** The last walk has ended and the pause there has begun. */
  arrived: boolean;
  tries: number;
  held: boolean;
  outAt: number;
  lamp: boolean;
  /** A thief's night: walking the haunts, stalking Jef, or running off. */
  thief: { mode: "idle" | "stalk" | "flee"; t: number; close: number } | null;
  /** 0-1, stable per person (spread, lanterns, who talks when). */
  h: number;
}

/** A person you can talk to, for the talk window (people.ts Npc has the same shape). */
export interface Speaker {
  id: string;
  def: { name: string; title?: string };
  lookAt(x: number, z: number): void;
}

/** Fallbacks if people.glb is older than the town (it should not be). */
const KIND_FALLBACK: Record<string, HumanKind> = {
  baker: "docker_c", shopkeeper: "recipient", publican: "foreman", clerk: "gentleman", old_man: "docker_b", beggar: "thief",
  wife_a: "fishwife_a", wife_b: "fishwife_b", shopwife: "maid", old_woman: "fishwife_b", urchin: "boy", girl_b: "girl",
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const isNight = (h: number) => h >= 19 || h < 6.5;
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

export class Town {
  data: TownData | null = null;
  private sims: Sim[] = [];
  private byId = new Map<string, Sim>();
  private employers = new Map<string, Npc>();
  private thinkT = 0;
  private spawnT = 0;
  private filled = false;
  private games = new Map<string, { it: Sim | null; frozen: number; last: Sim | null }>();
  /** Employers (and the Rijnkaai three) with open work: they show a light after dark. */
  openWork = new Set<string>();
  /** Employers whose work Jef has in hand: they wait for him, whatever the hour. */
  takenWork = new Set<string>();
  /** Set by main: game day (1-7) and hour with fraction. */
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 9 });
  /** Set by main: may a thief try Jef now (not in a window, not asleep)? */
  canRob: () => boolean = () => true;
  toast: (t: string) => void = () => {};
  onPayload: (p: JobsPayload) => void = () => {};
  private player = { x: 0, z: 0, yaw: 0 };
  private busyNet = false;
  private lastDay = 0;

  constructor(
    private readonly world: World,
    private readonly crowd: Crowd,
    private readonly people: People,
    private readonly animals: Animals,
    private readonly stalls: Stalls,
  ) {}

  async load(): Promise<void> {
    const d = await api.town();
    this.data = d;
    this.crowd.anonymous = false;
    for (const r of d.residents) {
      // the kind is checked against people.glb when they first step out (the models may still be loading now)
      const kind = r.kind as HumanKind;
      const s: Sim = {
        r, kind, x: r.home.sx, z: r.home.sz, inside: true, door: [r.home.sx, r.home.sz], key: "", goal: { mode: "home", x: r.home.sx, z: r.home.sz },
        p: null, step: 0, wait: 0, toB: false, arrived: false, tries: 0, held: false, outAt: 0, lamp: false, thief: r.trade === "thief" ? { mode: "idle", t: 0, close: 0 } : null, h: hash(r.id),
      };
      this.sims.push(s);
      this.byId.set(r.id, s);
    }
    // the board's employers stand at their post like Sooi (people.ts), not in the crowd
    for (const e of d.employers) {
      const s = this.byId.get(e.id);
      if (!s) continue;
      const sp = SPOTS[e.spot];
      const at = s.r.work.at ?? [sp.x + 1.2, sp.z + 1.2, 0];
      const n = this.people.addTownEmployer(
        {
          id: e.id, name: s.r.name, title: s.r.label, x: at[0], z: at[1], yaw: Math.atan2(sp.x - at[0], sp.z - at[1]), talks: true,
          model: s.kind,
          build: (m) => {
            const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 1.3, 6), m(0x3a3430));
            b.position.y = 0.72;
            return [b];
          },
        },
        this.world,
      );
      this.employers.set(e.id, n);
      this.byId.delete(e.id);
      this.sims.splice(this.sims.indexOf(s), 1);
    }
    this.animals.catSpots = d.residents.filter((_r, i) => i % 3 === 0).map((r) => ({ x: r.home.sx, z: r.home.sz }));
    await this.stalls.build(d.stalls, d.shops);
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number, player: { x: number; z: number; yaw: number }): void {
    if (!this.data) return;
    this.player = { x: player.x, z: player.z, yaw: player.yaw };
    const { day, hour } = this.clock();
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.robbed.clear();
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.25;
      for (const s of this.sims) this.reschedule(s, day, hour, !this.filled);
      this.postEmployers(day, hour);
    }
    for (const g of this.games.values()) g.frozen -= dt;
    for (const s of this.sims) {
      if (s.p && !this.crowd.alive(s.p)) this.lose(s);
      if (s.p) {
        s.x = s.p.x;
        s.z = s.p.z;
        if (!s.held) this.behave(s, dt, hour);
        if (s.p && dist(s.x, s.z, player.x, player.z) > DESPAWN_R) this.lose(s, true);
      } else if (!s.inside && !s.held) this.coarse(s, dt);
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.crowd.fogDistance) {
      this.spawnT = 0.3;
      this.spawn(!this.filled);
      this.filled = true;
    }
    this.stalls.update(player.x, player.z, this.crowd.fogDistance);
  }

  // ------------------------------------------------------------------ the schedule

  private reschedule(s: Sim, day: number, hour: number, first: boolean): void {
    const now = activityAt(s.r.sched, day, hour);
    const key = `${now.act}:${now.place}`;
    if (key === s.key) {
      this.lanterns(s, hour);
      return;
    }
    s.key = key;
    s.goal = this.goalFor(s, now);
    s.step = 0;
    s.tries = 0;
    s.wait = 0;
    if (s.r.work.kind === "stall" || s.r.work.kind === "shop") this.stalls.setOpen(s.r.id, now.act === "work");
    const goesIn = s.goal.mode === "home" || s.goal.mode === "inside" || s.goal.mode === "church";
    if (first) {
      // the start: everyone is where the clock says, no walking
      if (goesIn) {
        s.inside = true;
        s.door = [s.goal.x, s.goal.z];
      } else {
        const [x, z] = this.anchor(s);
        s.inside = false;
        s.x = x;
        s.z = z;
      }
    } else if (s.inside && !(goesIn && s.door[0] === s.goal.x && s.door[1] === s.goal.z)) {
      // out of the door they went in at
      s.inside = false;
      s.x = s.door[0];
      s.z = s.door[1];
      s.outAt = performance.now();
    }
    if (s.p) this.direct(s);
    this.lanterns(s, hour);
  }

  private place(id: string): TownPlace | null {
    return this.data?.places[id] ?? null;
  }

  /** A point in a place, the same for the same person (no jumping about). */
  private spot(pl: TownPlace, s: Sim, spread = 0.65): Pt {
    const a = s.h * Math.PI * 2 * 7;
    const d = Math.sqrt(hash(s.r.id + "d")) * pl.r * spread;
    return [pl.x + Math.cos(a) * d, pl.z + Math.sin(a) * d];
  }

  private goalFor(s: Sim, now: Now): Goal {
    const r = s.r;
    const w = r.work;
    const P = (id: string) => this.place(id);
    switch (now.act) {
      case "home":
        return { mode: "home", x: r.home.sx, z: r.home.sz };
      case "church": {
        const c = P("church") ?? { x: -262, z: 142, r: 3 } as TownPlace;
        return { mode: "church", x: c.x, z: c.z };
      }
      case "tavern": {
        const t = P(now.place);
        if (!t) return { mode: "home", x: r.home.sx, z: r.home.sz };
        const [ox, oz] = t.out ?? [0, -1];
        // a half ring before the door, facing it
        const a = (s.h - 0.5) * 2.4;
        const x = t.x + ox * 2.2 + (Math.cos(a) * ox - Math.sin(a) * oz) * 0.8 - oz * (s.h - 0.5) * 3;
        const z = t.z + oz * 2.2 + (Math.sin(a) * ox + Math.cos(a) * oz) * 0.8 + ox * (s.h - 0.5) * 3;
        return { mode: "tavern", x, z, yaw: Math.atan2(t.x - x, t.z - z), motion: "idle" };
      }
      case "play":
      case "market":
      case "stroll":
      case "loiter": {
        const pl = P(now.place) ?? P(w.place) ?? P("rijnkaai")!;
        const [x, z] = this.spot(pl, s);
        return { mode: now.act, x, z, r: pl.r, place: now.place };
      }
      case "work":
        break;
    }
    switch (w.kind) {
      case "stall":
      case "shop": {
        const at = this.stalls.sellerSpots.get(r.id);
        if (at) return { mode: "stand", x: at.x, z: at.z, yaw: at.yaw, motion: "idle" };
        break;
      }
      case "haul":
        if (w.a && w.b) return { mode: "haul", x: w.a[0], z: w.a[1], a: w.a, b: w.b };
        break;
      case "patrol":
        if (w.route?.length) return { mode: "patrol", x: w.route[0][0], z: w.route[0][1], route: w.route };
        break;
      case "roam":
        if (r.trade === "thief" && w.route?.length) return { mode: "thief", x: w.route[0][0], z: w.route[0][1], route: w.route };
        if (r.trade === "child" || r.trade === "street_child") {
          const pl = P(w.place) ?? P("play:vismarkt")!;
          const [x, z] = this.spot(pl, s);
          return { mode: "play", x, z, r: pl.r, place: w.place };
        }
        if (w.route?.length) return { mode: "roam", x: w.route[0][0], z: w.route[0][1], route: w.route };
        break;
      case "inside":
        if (w.door) return { mode: "inside", x: w.door[0], z: w.door[1] };
        return { mode: "home", x: r.home.sx, z: r.home.sz };
      default:
        break;
    }
    if (w.at) return { mode: "stand", x: w.at[0], z: w.at[1], yaw: w.at[2], motion: w.kind === "post" ? "fold" : "idle" };
    const pl = P(w.place) ?? P("rijnkaai")!;
    const [x, z] = this.spot(pl, s);
    return { mode: "loiter", x, z, r: pl.r, place: w.place };
  }

  private anchor(s: Sim): Pt {
    const g = s.goal;
    if (g.mode === "haul" && g.a) return g.a;
    if (g.route?.length) return g.route[s.step % g.route.length];
    return [g.x, g.z];
  }

  /** Nobody sees them: a straight walk to where they should be, briskly. */
  private coarse(s: Sim, dt: number): void {
    const [tx, tz] = this.anchor(s);
    const d = dist(s.x, s.z, tx, tz);
    if (d < 0.5) {
      if (s.goal.mode === "home" || s.goal.mode === "inside" || s.goal.mode === "church") {
        s.inside = true;
        s.door = [tx, tz];
      } else if (s.goal.route?.length && s.goal.mode !== "thief") s.step++;
      return;
    }
    const k = Math.min(1, (HIDDEN_SPEED * dt) / d);
    s.x += (tx - s.x) * k;
    s.z += (tz - s.z) * k;
  }

  // ------------------------------------------------------------------ into the street and out

  private spawn(anywhere: boolean): void {
    let alive = 0;
    for (const s of this.sims) if (s.p) alive++;
    if (alive >= MAX_PUPPETS) return;
    const px = this.player.x;
    const pz = this.player.z;
    const want = this.sims
      .filter((s) => !s.p && !s.inside && dist(s.x, s.z, px, pz) < SPAWN_R)
      .sort((a, b) => dist(a.x, a.z, px, pz) - dist(b.x, b.z, px, pz));
    for (const s of want) {
      if (alive >= MAX_PUPPETS) break;
      const d = dist(s.x, s.z, px, pz);
      const fresh = performance.now() - s.outAt < 4000;
      // people appear out of sight, or step out of their own door
      if (!anywhere && !fresh && !this.crowd.isHidden(s.x, s.z)) continue;
      if (!anywhere && d < 3) continue;
      let at: { x: number; z: number } | null = this.crowd.canStand(s.x, s.z) ? { x: s.x, z: s.z } : this.crowd.openNear(s.x, s.z);
      if (!at) continue;
      if (!isHumanKind(s.kind)) s.kind = KIND_FALLBACK[s.kind] ?? "docker_a";
      const p = this.crowd.addPuppet(s.kind, at.x, at.z, Math.atan2(this.anchor(s)[0] - at.x, this.anchor(s)[1] - at.z), this.paceOf(s));
      if (!p) return;
      s.p = p;
      s.x = at.x;
      s.z = at.z;
      s.tries = 0;
      s.wait = 0;
      alive++;
      this.direct(s);
      this.lanterns(s, this.clock().hour);
      if (s.r.dog) {
        const sim = s;
        this.animals.addDog(s.r.id, s.r.dog.look, at, () =>
          sim.p ? { x: sim.p.x, z: sim.p.z, yaw: sim.p.yaw, walking: this.crowd.puppetBusy(sim.p) } : null,
        );
      }
      at = null;
    }
  }

  /** Back to the schedule only (out of range, or in at the door). */
  private lose(s: Sim, remove = false): void {
    if (s.p && remove) this.crowd.removePuppet(s.p);
    s.p = null;
    s.held = false;
    if (s.r.dog) this.animals.removeDog(s.r.id);
  }

  private paceOf(s: Sim): number {
    const r = s.r;
    if (r.age < 13) return rnd(1.1, 1.5);
    if (r.age >= 62) return rnd(0.8, 1.0);
    if (r.trade === "police" || r.trade === "priest") return rnd(0.95, 1.05);
    if (r.kind === "porter" || r.kind === "carter") return rnd(0.85, 1.0);
    return r.sex === "f" ? rnd(1.0, 1.25) : rnd(1.15, 1.4);
  }

  /** Tell a puppet where to go for its goal. */
  private direct(s: Sim): void {
    const p = s.p!;
    const g = s.goal;
    this.crowd.puppetLoad(p, false);
    const pace = this.paceOf(s);
    switch (g.mode) {
      case "haul":
        s.toB = false;
        this.crowd.puppetGo(p, g.a![0], g.a![1], pace);
        break;
      case "patrol":
      case "roam":
      case "thief": {
        const q = g.route![s.step % g.route!.length];
        this.crowd.puppetGo(p, q[0], q[1], g.mode === "thief" ? 0.9 : pace);
        break;
      }
      default:
        this.crowd.puppetGo(p, g.x, g.z, pace);
    }
  }

  // ------------------------------------------------------------------ what they do there

  private behave(s: Sim, dt: number, hour: number): void {
    const p = s.p!;
    const g = s.goal;
    const busy = this.crowd.puppetBusy(p);
    const at = (x: number, z: number, r = 1.0) => dist(p.x, p.z, x, z) < r;
    switch (g.mode) {
      case "home":
      case "inside":
      case "church":
        if (busy) return;
        if (at(g.x, g.z, 1.3)) {
          // in at the door, and gone
          s.inside = true;
          s.door = [g.x, g.z];
          this.lose(s, true);
        } else this.retry(s);
        return;
      case "stand":
      case "tavern":
        if (busy) return;
        if (!at(g.x, g.z, 1.4) && s.tries < 3) return this.retry(s);
        if ((s.wait -= dt) <= 0) {
          // sellers call out now and then; drinkers take turns talking
          const talky = g.mode === "tavern" || s.r.work.kind === "stall" || s.r.work.kind === "shop";
          const talking = talky && Math.random() < (g.mode === "tavern" ? 0.4 : 0.25);
          this.crowd.puppetStand(p, talking ? "talk" : (g.motion ?? "idle"), g.yaw ?? null);
          s.wait = talking ? rnd(2.5, 5) : rnd(4, 10);
        }
        return;
      case "haul": {
        if (busy) {
          s.arrived = false;
          return;
        }
        if (!s.arrived) {
          // at an end: a moment to take up or put down the load
          s.arrived = true;
          s.wait = rnd(1.5, 3.5);
          this.crowd.puppetStand(p, "idle", null);
          return;
        }
        if ((s.wait -= dt) > 0) return;
        const atA = at(g.a![0], g.a![1], 2.5);
        const atB = at(g.b![0], g.b![1], 2.5);
        if (!atA && !atB) {
          const q = s.toB ? g.b! : g.a!;
          if (s.tries++ < 3) this.crowd.puppetGo(p, q[0], q[1]);
          else this.retry(s);
          return;
        }
        // loaded from the quay to the door, back empty
        s.toB = atA;
        s.tries = 0;
        this.crowd.puppetLoad(p, s.toB && !["porter", "carter", "docker_sack"].includes(s.kind));
        const q = s.toB ? g.b! : g.a!;
        this.crowd.puppetGo(p, q[0], q[1]);
        return;
      }
      case "patrol":
      case "roam": {
        if (busy) {
          s.arrived = false;
          return;
        }
        if (!s.arrived) {
          s.arrived = true;
          s.wait = g.mode === "patrol" ? rnd(1, 4) : rnd(3, 12);
          this.crowd.puppetStand(p, s.r.trade === "police" ? "behind" : "idle", null);
          return;
        }
        if ((s.wait -= dt) > 0) return;
        s.step++;
        const q = g.route![s.step % g.route!.length];
        this.crowd.puppetGo(p, q[0], q[1]);
        return;
      }
      case "thief":
        return this.thieve(s, dt, hour);
      case "play":
        return this.play(s, dt);
      case "market":
      case "stroll":
      case "loiter":
        if (busy) return;
        if ((s.wait -= dt) > 0) return;
        if (Math.random() < 0.45 || g.mode === "stroll") {
          const a = Math.random() * Math.PI * 2;
          const d = Math.random() * (g.r ?? 8) * 0.7;
          const pl = this.place(g.place ?? "") ?? { x: g.x, z: g.z };
          this.crowd.puppetGo(p, pl.x + Math.cos(a) * d, pl.z + Math.sin(a) * d, g.mode === "stroll" ? 0.9 : undefined);
          s.wait = rnd(2, 6);
        } else {
          // stop and talk to someone near, or just stand
          const other = this.sims.find((o) => o !== s && o.p && dist(o.x, o.z, p.x, p.z) < 2.2);
          const yaw = other ? Math.atan2(other.x - p.x, other.z - p.z) : null;
          this.crowd.puppetStand(p, other && Math.random() < 0.5 ? "talk" : "idle", yaw);
          s.wait = rnd(4, 12);
        }
        return;
    }
  }

  /** The way did not work out: try again, then give up and stand. */
  private retry(s: Sim): void {
    // far off (beyond the grid round Jef): they are on their way, not stuck
    const [ax, az] = this.anchor(s);
    if (!this.crowd.onGrid(ax, az)) {
      this.direct(s);
      return;
    }
    if (++s.tries > 3) {
      // they cannot get there from here: once nobody sees them, they simply are there
      if (this.crowd.isHidden(s.x, s.z)) {
        this.lose(s, true);
        [s.x, s.z] = this.anchor(s);
      }
      return;
    }
    this.direct(s);
  }

  // ---- children: they look for each other, then play tag

  private play(s: Sim, dt: number): void {
    const p = s.p!;
    const key = s.goal.place ?? "";
    let game = this.games.get(key);
    if (!game) this.games.set(key, (game = { it: null, frozen: 0, last: null }));
    if ((s.wait -= dt) > 0) return;
    s.wait = 0.5;
    const kids = this.sims.filter((o) => o.p && o.goal.mode === "play" && o.goal.place === key && dist(o.x, o.z, p.x, p.z) < 30);
    if (kids.length < 2) {
      // alone: go and find the others (the nearest child out playing anywhere near)
      const other = this.sims
        .filter((o) => o !== s && o.goal.mode === "play" && !o.inside)
        .sort((a, b) => dist(a.x, a.z, p.x, p.z) - dist(b.x, b.z, p.x, p.z))[0];
      if (other && dist(other.x, other.z, p.x, p.z) < 45 && dist(other.x, other.z, p.x, p.z) > 2) this.crowd.puppetGo(p, other.x, other.z, 1.4);
      else if (!this.crowd.puppetBusy(p)) {
        this.crowd.puppetStand(p, "idle", null);
        s.wait = rnd(2, 4);
      }
      return;
    }
    if (!game.it || !game.it.p || !kids.includes(game.it)) game.it = kids[Math.floor(Math.random() * kids.length)];
    if (s === game.it) {
      if (game.frozen > 0) {
        this.crowd.puppetStand(p, "idle", null);
        return;
      }
      // no tagging back the one who just caught you (unless there is nobody else)
      const others = kids.filter((o) => o !== s && (o !== game.last || kids.length === 2));
      const prey = others.sort((a, b) => dist(a.x, a.z, p.x, p.z) - dist(b.x, b.z, p.x, p.z))[0];
      if (dist(prey.x, prey.z, p.x, p.z) < 1.35) {
        // tag! the other one is it now, and counts to three
        game.last = s;
        game.it = prey;
        game.frozen = 1.5;
        this.crowd.puppetStand(p, "talk", null);
        s.wait = 1.2;
        return;
      }
      this.crowd.puppetGo(p, prey.x, prey.z, 2.4);
    } else {
      const it = game.it;
      const d = dist(it.x, it.z, p.x, p.z);
      if (d < 6) {
        const L = d || 1;
        this.crowd.puppetGo(p, p.x + ((p.x - it.x) / L) * 4 + rnd(-1.5, 1.5), p.z + ((p.z - it.z) / L) * 4 + rnd(-1.5, 1.5), 2.2);
      } else if (!this.crowd.puppetBusy(p)) {
        if (Math.random() < 0.5) {
          // skip about near where they are, keeping an eye on it
          const a = Math.random() * Math.PI * 2;
          this.crowd.puppetGo(p, p.x + Math.cos(a) * rnd(2, 4), p.z + Math.sin(a) * rnd(2, 4), rnd(1.3, 2));
        } else this.crowd.puppetStand(p, Math.random() < 0.5 ? "talk" : "idle", Math.atan2(it.x - p.x, it.z - p.z));
        s.wait = rnd(0.8, 2);
      }
    }
  }

  // ---- thieves: out at night, up behind Jef

  private thieve(s: Sim, dt: number, hour: number): void {
    const p = s.p!;
    const t = s.thief!;
    const g = s.goal;
    const d = dist(p.x, p.z, this.player.x, this.player.z);
    t.t -= dt;
    if (t.mode === "flee") {
      if (t.t <= 0) t.mode = "idle";
      else if (!this.crowd.puppetBusy(p) && d < 30) {
        // away from Jef, into the dark: the first open ground that way (or off to one side)
        const L = d || 1;
        const ax = (p.x - this.player.x) / L;
        const az = (p.z - this.player.z) / L;
        for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2]) {
          const c = Math.cos(turn);
          const sn = Math.sin(turn);
          const q = this.crowd.openNear(p.x + (ax * c - az * sn) * 14, p.z + (ax * sn + az * c) * 14);
          if (q && dist(q.x, q.z, this.player.x, this.player.z) > d + 4) {
            this.crowd.puppetGo(p, q.x, q.z, 2.6);
            break;
          }
        }
      }
      return;
    }
    const night = hour >= 20 || hour < 6;
    if (t.mode === "stalk") {
      if (!night || d > 28 || !this.canRob()) {
        t.mode = "idle";
        return;
      }
      // the last steps: the crowd keeps clear of Jef, a pickpocket does not
      const bx0 = this.player.x + Math.sin(this.player.yaw) * 0.8;
      const bz0 = this.player.z + Math.cos(this.player.yaw) * 0.8;
      const db = dist(p.x, p.z, bx0, bz0);
      if (d < 4.5 && db > 0.3) {
        if (this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "walk", null);
        const k = Math.min(1, (1.1 * dt) / db);
        const nx = p.x + (bx0 - p.x) * k;
        const nz = p.z + (bz0 - p.z) * k;
        if (this.world.isFree(nx, nz, 0.25) && dist(nx, nz, this.player.x, this.player.z) > 0.55) {
          p.x = nx;
          p.z = nz;
          p.yaw = Math.atan2(bx0 - p.x, bz0 - p.z);
        }
      } else if (t.t <= 0) {
        // up close behind him
        t.t = 0.4;
        // Jef looks along (-sin yaw, -cos yaw): behind him is the other way
        const bx = this.player.x + Math.sin(this.player.yaw) * 0.7;
        const bz = this.player.z + Math.cos(this.player.yaw) * 0.7;
        this.crowd.puppetGo(p, bx, bz, d > 6 ? 1.5 : 1.1);
      }
      // close behind him, where he cannot see: Jef looks along (-sin yaw, -cos yaw)
      const fx = -Math.sin(this.player.yaw);
      const fz = -Math.cos(this.player.yaw);
      const unseen = ((p.x - this.player.x) * fx + (p.z - this.player.z) * fz) / (d || 1) < 0.2;
      if (d < 1.9 && unseen) t.close += dt;
      else t.close = Math.max(0, t.close - dt);
      if (t.close > 1.2 && !this.busyNet) {
        this.busyNet = true;
        t.close = 0;
        api
          .pick(s.r.id)
          .then((r) => {
            this.onPayload(r);
            this.toast(r.text);
          })
          .catch(() => {})
          .finally(() => {
            this.busyNet = false;
            t.mode = "flee";
            t.t = 25;
            this.robbed.set(s.r.id, performance.now());
          });
      }
      return;
    }
    // idle: slow along the haunts; at night, Jef alone and near is a mark (once a night each)
    if (night && d < 22 && this.canRob() && !this.robbed.has(s.r.id)) {
      t.mode = "stalk";
      t.t = 0;
      return;
    }
    if (!this.crowd.puppetBusy(p) && (s.wait -= dt) <= 0) {
      s.step++;
      const q = g.route![s.step % g.route!.length];
      this.crowd.puppetGo(p, q[0], q[1], 0.9);
      s.wait = rnd(5, 15);
    }
  }
  /** Thieves who tried tonight, and when (Jef may catch one within 25 s). */
  private robbed = new Map<string, number>();

  /** A thief who just robbed Jef, within reach: grab him (E). */
  thiefInReach(x: number, z: number, reach = 3.2): Speaker | null {
    for (const [id, at] of this.robbed) {
      const s = this.byId.get(id);
      if (!s?.p || performance.now() - at > 25_000) continue;
      if (dist(s.p.x, s.p.z, x, z) < reach) return this.speaker(s);
    }
    return null;
  }

  async grab(id: string): Promise<void> {
    try {
      const r = await api.catchThief(id);
      this.onPayload(r);
      this.toast(r.text);
    } catch (e) {
      this.toast(`${(e as Error).message}.`);
    }
    this.robbed.set(id, 0);
  }

  /** New night: thieves may try again (the server says no to a second go the same night). */
  newDay(): void {
    this.robbed.clear();
  }

  // ---- lanterns and the employers' night posts

  private lanterns(s: Sim, hour: number): void {
    if (!s.p) return;
    const on =
      isNight(hour) &&
      s.r.age >= 14 &&
      s.r.trade !== "thief" &&
      (s.r.trade === "police" || s.r.trade === "lamplighter" || s.goal.mode === "home" ? s.h < 0.5 || s.r.trade === "police" || s.r.trade === "lamplighter" : s.h < 0.3);
    if (on !== s.lamp) {
      s.lamp = on;
      this.crowd.puppetLantern(s.p, on);
    }
  }

  private postEmployers(day: number, hour: number): void {
    const dark = isNight(hour);
    for (const [id, n] of this.employers) {
      const r = this.data!.residents.find((x) => x.id === id)!;
      const work = activityAt(r.sched, day, hour).act === "work" || this.takenWork.has(id);
      n.setPresent(work);
      const quest = this.openWork.has(id) || this.takenWork.has(id);
      if (!work) continue;
      if (dark && quest) {
        // under the nearest lamp within 25 m of the post; else a lantern in hand
        let best: Pt | null = null;
        let bd = 25;
        const home = n.def;
        for (const l of LAMPS) {
          const d = dist(l[0], l[1], home.x, home.z);
          if (d < bd) {
            bd = d;
            best = l;
          }
        }
        if (best) {
          const x = best[0] + 0.9;
          const z = best[1] + 0.9;
          n.nightPost(this.world.isFree(x, z, 0.35) ? { x, z, yaw: Math.atan2(home.x - x, home.z - z) } : null);
          n.setLantern(!this.world.isFree(x, z, 0.35));
        } else {
          n.nightPost(null);
          n.setLantern(true);
        }
      } else {
        n.nightPost(null);
        n.setLantern(false);
      }
    }
    // the Rijnkaai three: a lantern after dark while their work is open
    for (const id of ["sooi", "peeters", "tuur", "fientje"]) this.people.get(id)?.setLantern(dark && this.openWork.has(id));
  }

  // ------------------------------------------------------------------ talking

  private speaker(s: Sim): Speaker {
    return {
      id: s.r.id,
      def: { name: s.r.name, title: s.r.label },
      lookAt: () => {},
    };
  }

  /** The nearest townsperson in the street within reach (E: talk to them). */
  nearestTalker(x: number, z: number, reach = 2.4): { who: Speaker; d: number } | null {
    let best: Sim | null = null;
    let bd = reach;
    for (const s of this.sims) {
      if (!s.p || !s.p.shown) continue;
      const d = dist(s.p.x, s.p.z, x, z);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best ? { who: this.speaker(best), d: bd } : null;
  }

  // ---- M3h (game/deeds.ts): who is about to see a theft; owners who give chase; police who come for Jef

  /** Townspeople in the street near (x, z), where they are and which way they face (yaw: facing (sin, cos)). */
  inStreet(x: number, z: number, r: number): Array<{ id: string; x: number; z: number; yaw: number; trade: string; age: number }> {
    const out: Array<{ id: string; x: number; z: number; yaw: number; trade: string; age: number }> = [];
    for (const s of this.sims) if (s.p && dist(s.p.x, s.p.z, x, z) < r) out.push({ id: s.r.id, x: s.p.x, z: s.p.z, yaw: s.p.yaw, trade: s.r.trade, age: s.r.age });
    return out;
  }

  /**
   * Take this resident off their schedule (held) and hand over their puppet. Not in the
   * street: they come out of sight at `from` (a point out of Jef's view). null if that fails.
   */
  claim(id: string, from?: { x: number; z: number }): Puppet | null {
    const s = this.byId.get(id);
    if (!s) return null;
    if (!s.p && from) {
      if (!isHumanKind(s.kind)) s.kind = KIND_FALLBACK[s.kind] ?? "docker_a";
      const p = this.crowd.addPuppet(s.kind, from.x, from.z, 0, this.paceOf(s));
      if (!p) return null;
      s.p = p;
      s.inside = false;
      s.x = from.x;
      s.z = from.z;
      this.lanterns(s, this.clock().hour);
    }
    if (!s.p) return null;
    s.held = true;
    return s.p;
  }

  /** Back to their day. */
  release(id: string): void {
    const s = this.byId.get(id);
    if (!s) return;
    s.held = false;
    s.wait = 0;
    if (s.p) this.direct(s);
  }

  /** Hold still and face Jef while he talks to them; let go after. */
  hold(id: string, on: boolean): void {
    const s = this.byId.get(id);
    if (!s?.p) return;
    s.held = on;
    if (on) this.crowd.puppetStand(s.p, "talk", Math.atan2(this.player.x - s.p.x, this.player.z - s.p.z));
    else {
      s.wait = 0;
      this.direct(s);
    }
  }

  wares(id: string) {
    return this.data?.residents.find((r) => r.id === id)?.wares ?? [];
  }

  // ------------------------------------------------------------------ checks

  /** Every home, workplace and post the town uses, for the path check (CLAUDE.md). */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const d = this.data;
    if (!d) return [];
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const r of d.residents) {
      out.push({ label: `home of ${r.name}`, x: r.home.sx, z: r.home.sz, reach: 1.6 });
      const w = r.work;
      if (w.a) out.push({ label: `${r.name}: quay end`, x: w.a[0], z: w.a[1], reach: 2 });
      if (w.b) out.push({ label: `${r.name}: door end`, x: w.b[0], z: w.b[1], reach: 2 });
      if (w.door) out.push({ label: `${r.name}: work door`, x: w.door[0], z: w.door[1], reach: 1.6 });
      if (w.at && w.kind !== "shop" && w.kind !== "stall") out.push({ label: `${r.name}: post`, x: w.at[0], z: w.at[1], reach: 2.4 });
    }
    for (const [id, at] of this.stalls.sellerSpots) out.push({ label: `seller ${id}`, x: at.x, z: at.z, reach: 2.4 });
    for (const f of this.stalls.fronts) out.push({ label: f.label, x: f.x, z: f.z, reach: 1.8 });
    for (const [id, p] of Object.entries(d.places)) out.push({ label: `place ${id}`, x: p.x, z: p.z, reach: 3 });
    return out;
  }

  /** Dev: who is out, what they do. */
  debug(): { sims: number; out: number; puppets: number; byMode: Record<string, number> } {
    const byMode: Record<string, number> = {};
    let out = 0;
    let puppets = 0;
    for (const s of this.sims) {
      if (!s.inside) out++;
      if (s.p) {
        puppets++;
        byMode[s.goal.mode] = (byMode[s.goal.mode] ?? 0) + 1;
      }
    }
    return { sims: this.sims.length, out, puppets, byMode };
  }

  /** Dev: one resident's state. */
  who(id: string) {
    const s = this.byId.get(id);
    return s && { name: s.r.name, trade: s.r.trade, key: s.key, mode: s.goal.mode, x: +s.x.toFixed(1), z: +s.z.toFixed(1), inside: s.inside, puppet: !!s.p };
  }

  /** Dev: the nearest puppets with what they do. */
  near(n = 10) {
    return this.sims
      .filter((s) => s.p)
      .sort((a, b) => dist(a.x, a.z, this.player.x, this.player.z) - dist(b.x, b.z, this.player.x, this.player.z))
      .slice(0, n)
      .map((s) => ({ id: s.r.id, name: s.r.name, trade: s.r.trade, mode: s.goal.mode, d: +dist(s.x, s.z, this.player.x, this.player.z).toFixed(1) }));
  }
}
