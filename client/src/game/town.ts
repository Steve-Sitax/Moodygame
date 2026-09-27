import * as THREE from "three";
import { api, type JobsPayload, type Pt, type TownData, type TownPlace, type TownResident } from "../net/api";
import { activityAt, type Now } from "../../../server/src/town/schedule";
import { whereAt } from "../../../server/src/town/whereabouts";
import { wayKey } from "../../../server/src/town/wayfind";
import type { Crowd, Puppet } from "./crowd";
import type { Animals } from "./animals";
import type { Stalls } from "./stalls";
import type { Npc, People } from "./people";
import { isHumanKind, type HumanKind, type Motion } from "./humans";
import type { World } from "../world/rijnkaai";
import type { Journeys, JourneyTown, Trip } from "./journeys";
import SPOT_TABLE from "../../../shared/spots.json";
import CITY from "../../../shared/city.json";
import { omnibusKeepOut } from "../world/omnibus";
import { trafficLanes } from "../world/traffic";
import { chest, pick, type Target } from "./facing";
import { atPost, NIGHT_GIVER_IDS } from "../../../shared/night";

// The town (M3e): the residents the server made (homes, families, trades,
// schedules) living by the game clock. Everyone is simulated cheaply by
// schedule: where they should be now, and a walk there at a brisk pace while
// nobody sees them: along the way on foot the server found (the trade plan,
// docs/trade-plan.md part A: server town/whereabouts.ts, the same sum the town
// map and every PC use), so a person unseen is on a street, never in a house. Only those near Jef become people in the street:
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
//
// The garrison and the customs (server town/garrison.ts): sentries stand at their
// post in pairs, and the relief waits a step in front of the old man until he
// marches in to the guard room; soldiers off duty walk out side by side (the
// crowd's follow); customs officers go from one landing to the next, up to the
// crates and casks, and write in their book. Nobody of them ever lays hands on
// anyone: the police alone come for a thief (deeds.ts).

const SPAWN_R = 55;
/** The trade plan: a person due in the street in Jef's view steps in at once beyond this (m), nearer after a wait. */
const DUE_FAR = 40;
const DUE_WAIT_MS = 2500;
/** Under this (m) he waits longer still: by then he has mostly walked out of view or behind someone. */
const DUE_NEAR = 20;
const DUE_NEAR_WAIT_MS = 8000;
const DESPAWN_R = 68;
/** How many townspeople walk in the street round Jef at once: Settings, "People in the street" (settings.ts). */
const MAX_PUPPETS = 50;
/** Unseen, people cross town at this pace (m/s): the clock runs 30 times faster than life (M7: a game hour is two real minutes; kept at 6, a 600 m walk is 50 game minutes). */
const HIDDEN_SPEED = 6;
const SPOTS = SPOT_TABLE as unknown as Record<string, { x: number; z: number; label: string }>;
const LAMPS = ((CITY as unknown as { decor?: { lamps?: Pt[] } }).decor?.lamps ?? []) as Pt[];
/** M6 handcart: the omnibus lanes and the drays' lanes (boxes along them), where nobody is posted to stand. */
let lanes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> | null = null;
function laneRects() {
  if (!lanes) {
    lanes = [...omnibusKeepOut()];
    for (const l of trafficLanes()) for (let i = 0; i < l.x.length; i += 8) lanes.push({ minX: l.x[i] - l.half, maxX: l.x[i] + l.half, minZ: l.z[i] - l.half, maxZ: l.z[i] + l.half });
  }
  return lanes;
}

export type Mode = "home" | "inside" | "church" | "stand" | "haul" | "patrol" | "roam" | "play" | "market" | "loiter" | "tavern" | "stroll" | "thief" | "guard" | "inspect";

export interface Goal {
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
  /** Inspect: which way to face at each point of the route. */
  faces?: number[];
}

export interface Sim {
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
  /** Fixes 2026-09-24: gone on unseen for an action (hideAway): the town does not bring them back into the street. */
  away?: boolean;
  /** East walkthrough 2026-09-25: whether their tavern was open ("in") or not ("out") when the goal was set. */
  tav?: string;
  outAt: number;
  lamp: boolean;
  /** A thief's night: walking the haunts, stalking Jef, or running off. */
  thief: { mode: "idle" | "stalk" | "flee"; t: number; close: number } | null;
  /** 0-1, stable per person (spread, lanterns, who talks when). */
  h: number;
  /** Customs at a landing: 0 arrived, 1 up to the goods, 2 writing, 3 looking; and which way the goods lie. */
  ph?: number;
  face?: number | null;
  /** M6 transport (game/journeys.ts): the trip under way (by velocipede, cart, omnibus, boat, dray). */
  trip?: Trip | null;
  /** Held by someone else's trip (loading the cart, in the boat): the town leaves them be. */
  inTrip?: boolean;
  /** On the omnibus or in a boat: not in the street. */
  aboard?: boolean;
  /** The day's errand they are on (a family boat, a dray). */
  errand?: string;
  /**
   * The trade plan (part A): his goal is his day plan's own (no shop call, errand, mill, back-street or lively
   * goal over it), so unseen he walks the shared sum (whereabouts.ts) on the way between his places.
   */
  plain?: boolean;
  /** Since when (ms) he has been due in the street in Jef's view, and when that was last seen (the spawn's wait). */
  dueAt?: number;
  dueLast?: number;
  /**
   * M8b: walked by another player's PC (net/mp/street.ts): `p` is drawn from its batches. The town goes on
   * planning their day (a handover knows where they were going) but never moves, dresses or directs them.
   */
  remote?: boolean;
}

/**
 * M8b multiplayer (net/mp/street.ts): which townspeople this PC may walk. Played alone there is none and every
 * resident is this PC's.
 */
export interface TownNet {
  /** May this PC walk him (nobody else does, or he is this PC's already)? */
  mayWalk(id: string): boolean;
  /** The host takes him from the PC that walks him (an action, the police): true if this PC may. */
  take(id: string): boolean;
  /** This PC walks him now (it asks the server for him). */
  spawned(id: string): void;
  /** This PC let him go: still in the street (only out of its range: another PC near walks him on), or not (in at a door). */
  lost(id: string, street: boolean): void;
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
  soldier: "police", soldier_b: "police", sentry: "police", customs: "police",
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const isNight = (h: number) => h >= 19 || h < 6.5;
/** The garrison and the customs: no lanterns (a rifle, a book), a marching step. */
const GARRISON = new Set(["soldier", "sentry", "corporal", "customs"]);
const SOLDIERS = new Set(["soldier", "sentry", "corporal"]);
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
/** The town's key of a place of the day ("home:home", "work:work") as the engine's (transport.ts placeKey: "home", "work:work"). */
const plainKey = (k: string) => (k.startsWith("home:") ? "home" : k);

export class Town {
  data: TownData | null = null;
  /** M6 population: the street cap (Settings); event people are drawn on top of it. */
  maxPuppets = MAX_PUPPETS;
  private sims: Sim[] = [];
  private byId = new Map<string, Sim>();
  private employers = new Map<string, Npc>();
  private thinkT = 0;
  private spawnT = 0;
  private filled = false;
  private games = new Map<string, { it: Sim | null; frozen: number; last: Sim | null }>();
  /** Employers (and the Rijnkaai three) with open work: they show a light after dark. */
  openWork = new Set<string>();
  /**
   * Employers whose work Jef has in hand. M7 night: they no longer wait for him at night; they go home
   * at their hour, and Jef finishes at the quest box by their door (game/questboxes.ts).
   */
  takenWork = new Set<string>();
  /**
   * M3i (game/market.ts): the market days. Residents out on market errands browse its stalls
   * (and the town's own) instead of wandering; set by main.
   */
  market: { browse(p: Puppet, place: string, dt: number): boolean; forget(p: Puppet): void; pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> } | null = null;
  /** Set by main: game day (1-7) and hour with fraction. */
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 9 });
  /** Set by main: may a thief try Jef now (not in a window, not asleep)? */
  canRob: () => boolean = () => true;
  /**
   * M7 taverns in the world: is this tavern open (its door stands open and its taproom is drawn with its
   * drinkers, game/interiors.ts)? Then its keeper and its drinkers go in at the door instead of standing
   * before it. Set by main.
   */
  tavernInside: (place: string) => boolean = () => false;
  /** M7 shops (game/shopCalls.ts): the door step of the shop this person calls at this game hour (they go in), or null. */
  shopCall: (r: TownResident, day: number, hour: number) => Pt | null = () => null;
  toast: (t: string) => void = () => {};
  onPayload: (p: JobsPayload) => void = () => {};
  /** M6 transport: how the residents get about (game/journeys.ts); set by main. */
  journeys: Journeys | null = null;
  /**
   * M6 lively (game/lively.ts): the back streets. It may add to the key of a person's hour (door life:
   * scrubbing the step, lace at the door, flowers to the Madonna), give their goal (a round of doors,
   * the door itself), and have the first say over a puppet (a stop on the round, a game, a Madonna).
   */
  lively: {
    key(s: Sim, now: Now, day: number, hour: number): string;
    goal(s: Sim, now: Now): Goal | null;
    behave(s: Sim, dt: number, hour: number): boolean;
    spawned(s: Sim): void;
    lost(s: Sim): void;
    /** At a game of its own (the rope, hoops, marbles...) or only watching: not in the town's tag. */
    playing?(s: Sim): boolean;
  } | null = null;
  /**
   * M7 back of town (game/backlife.ts): the pump, the corner, the cards, the doorstep, the park, the walk
   * on the wall, the night watch, the drunks. Its goal comes before lively's, and its behave too.
   */
  back: {
    goal(s: Sim, now: Now): Goal | null;
    behave(s: Sim, dt: number, hour: number): boolean;
    spawned(s: Sim): void;
    lost(s: Sim): void;
  } | null = null;
  /**
   * M7 mills (game/mills.ts): the millers at their mills on the wall, and the mill's man with the cart (flour to
   * the bakery at dawn, grain from the dock after dinner). Its key, goal and behave come before the back's.
   */
  mills: {
    key(s: Sim, now: Now, day: number, hour: number): string;
    goal(s: Sim, now: Now): Goal | null;
    behave(s: Sim, dt: number, hour: number): boolean;
    spawned(s: Sim): void;
    lost(s: Sim): void;
    /** One of the mill's people: no velocipede, handcart or omnibus of the town's for them. */
    own(s: Sim): boolean;
  } | null = null;
  /** M8b: played together, which residents this PC may walk (net/mp/street.ts); null alone. */
  net: TownNet | null = null;
  private player = { x: 0, z: 0, yaw: 0 };
  /** The trade plan: the ways on foot by key (null: the server found none), and the keys to ask for. */
  private ways = new Map<string, Pt[] | null>();
  private wayAsk = new Set<string>();
  private wayAskT = 0;
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
    // the server may still be starting (or busy): ask again, waiting longer each time
    let d: TownData | null = null;
    for (let wait = 2000; !d; wait = Math.min(wait * 2, 30_000)) {
      try {
        d = await api.town();
      } catch (e) {
        console.warn(`the town did not load; again in ${wait / 1000} s`, e);
        await new Promise((res) => setTimeout(res, wait));
      }
    }
    this.data = d;
    this.crowd.anonymous = false;
    void this.loadWays();
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
      // M6 handcart: not where a dray or the omnibus passes (the water bailiff stood in the Werf lane)
      const clear = (x: number, z: number) => !laneRects().some((r) => x > r.minX - 0.4 && x < r.maxX + 0.4 && z > r.minZ - 0.4 && z < r.maxZ + 0.4);
      const base = s.r.work.at ?? [sp.x + 1.2, sp.z + 1.2, 0];
      const off = [[0, 0], [0, 1.4], [0, 2.2], [-1.2, 1.4], [1.2, 1.4], [0, -2.2]].find(([dx, dz]) => clear(base[0] + dx, base[1] + dz)) ?? [0, 0];
      const at = [base[0] + off[0], base[1] + off[1], base[2]];
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

  // ------------------------------------------------------------------ the ways (the trade plan)

  private async loadWays(): Promise<void> {
    for (let wait = 2000; ; wait = Math.min(wait * 2, 30_000)) {
      try {
        const r = await api.ways();
        for (const [k, w] of Object.entries(r.ways)) this.ways.set(k, w);
        return;
      } catch (e) {
        console.warn(`the town's ways did not load; again in ${wait / 1000} s`, e);
        await new Promise((res) => setTimeout(res, wait));
      }
    }
  }

  /** The way on foot for the sum (null until the server sent it: the sum then goes straight, as before). */
  private readonly wayOf = (ax: number, az: number, bx: number, bz: number): Pt[] | null => {
    const k = wayKey(ax, az, bx, bz);
    const w = this.ways.get(k);
    if (w === undefined) {
      this.wayAsk.add(k);
      return null;
    }
    return w;
  };

  private askWays(dt: number): void {
    this.wayAskT -= dt;
    if (this.wayAskT > 0 || !this.wayAsk.size) return;
    this.wayAskT = 3;
    const keys = [...this.wayAsk].slice(0, 60);
    for (const k of keys) this.wayAsk.delete(k);
    api.waysByKey(keys).then(
      (r) => {
        for (const k of keys) this.ways.set(k, r.ways[k] ?? null);
      },
      () => {
        for (const k of keys) this.wayAsk.add(k);
      },
    );
  }

  /**
   * The trade plan, part A (dev: `__scheldemist.findcheck()`): who is out in the street within `near` m of Jef
   * but has not been drawn for over 3 s (must list nothing). Held, aboard, walked by another PC: left out.
   */
  findCheck(near = 40): Array<{ id: string; name: string; d: number; x: number; z: number; plain: boolean; moving: boolean; hidden: boolean; waitS: number }> {
    const t = performance.now();
    const out: ReturnType<Town["findCheck"]> = [];
    for (const s of this.sims) {
      const miss = !s.p && !s.inside && !s.aboard && !s.remote && !s.held;
      const d = dist(s.x, s.z, this.player.x, this.player.z);
      if (!miss || d > near) {
        this.missSince.delete(s);
        continue;
      }
      const since = this.missSince.get(s) ?? t;
      this.missSince.set(s, since);
      if (t - since < 3000) continue;
      const on = this.whereNow(s);
      out.push({ id: s.r.id, name: s.r.name, d: Math.round(d), x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10, plain: !!s.plain, moving: !!on && on.walked < on.total, hidden: this.crowd.isHidden(s.x, s.z), waitS: Math.round((t - since) / 100) / 10 });
    }
    return out.sort((a, b) => a.d - b.d);
  }

  private missSince = new Map<Sim, number>();

  /** Where the shared sum puts a person now (whereabouts.ts), or null when his goal is not his plan's own. */
  whereNow(s: Sim): ReturnType<typeof whereAt> | null {
    if (!s.plain || !this.data) return null;
    const { day, hour } = this.clock();
    return whereAt(s.r, this.data, day, hour, this.wayOf);
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
    this.askWays(dt);
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.25;
      for (const s of this.sims) this.reschedule(s, day, hour, !this.filled);
      this.postEmployers(day, hour);
    }
    for (const g of this.games.values()) g.frozen -= dt;
    for (const s of this.sims) {
      if (s.p && !this.crowd.alive(s.p)) this.lose(s);
      if (s.remote) {
        // M8b: another PC walks him: only where he is (net/mp/street.ts places and lets go of him)
        if (s.p) {
          s.x = s.p.x;
          s.z = s.p.z;
        }
        continue;
      }
      if (s.p) {
        s.x = s.p.x;
        s.z = s.p.z;
        if (!s.held) this.behave(s, dt, hour);
        if (s.p && dist(s.x, s.z, player.x, player.z) > DESPAWN_R) this.lose(s, true, true);
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
    if (s.inTrip) return; // someone else's trip has them (the cart, the boat)
    // M6 transport: the day's errand with a load (a family boat, a dray) comes first
    const err = !first ? (this.journeys?.errandFor(s.r.id, day, hour) ?? null) : null;
    if (err || s.errand) return this.errandStep(s, err, day, hour);
    const now = activityAt(s.r.sched, day, hour);
    // M7 shops: a call at a shop this hour (the engine's roll, shared/shops.ts): in at its door, out at the hour's end
    const call = this.shopCall(s.r, day, hour);
    const key = `${now.act}:${now.place}${call ? `|shop@${call[0]},${call[1]}` : ""}${this.lively?.key(s, now, day, hour) ?? ""}${this.mills?.key(s, now, day, hour) ?? ""}`;
    // East walkthrough 2026-09-25: a publican (or a drinker) whose goal was set while his tavern's house
    // was not open yet (at load, before the in-world rooms are attached) stood 1.7 m before the door and
    // blocked it. The tavern opening or shutting sets the goal again, the key unchanged.
    const tavPlace =
      now.act === "tavern" ? now.place : now.act === "work" && s.r.work.kind === "tavern" ? s.r.work.place : now.act === "work" && s.r.work.kind === "shop" && s.r.work.shop ? `shop:${s.r.work.shop}` : "";
    const tav = tavPlace ? (this.tavernInside(tavPlace) ? "in" : "out") : "";
    if (key === s.key && tav === (s.tav ?? "")) {
      this.lanterns(s, hour);
      return;
    }
    s.tav = tav;
    const prevKey = s.key;
    const prevPt: Pt | null = s.p ? [s.p.x, s.p.z] : s.inside ? null : [s.x, s.z];
    s.key = key;
    if (s.p) this.market?.forget(s.p);
    s.goal = call ? { mode: "inside", x: call[0], z: call[1] } : this.goalFor(s, now);
    if (call) s.plain = false;
    s.step = 0;
    s.tries = 0;
    s.wait = 0;
    if (s.r.work.kind === "stall" || s.r.work.kind === "shop") this.stalls.setOpen(s.r.id, now.act === "work");
    const goesIn = s.goal.mode === "home" || s.goal.mode === "inside" || s.goal.mode === "church";
    const on = first ? this.whereNow(s) : null;
    if (on && on.walked < on.total) {
      // the start, and he is on his way (the trade plan: where the town map has him too)
      s.inside = false;
      s.x = on.x;
      s.z = on.z;
    } else if (first) {
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
    // M6 transport: how they go (a velocipede, the cart with the goods, the omnibus): journeys.ts
    // (M7 mills: the mill's people walk, and the man goes with the mill's own cart: game/mills.ts)
    if (!first && !s.held && !s.remote && prevKey && !this.mills?.own(s)) this.journeys?.begin(s, plainKey(prevKey), prevPt);
    if (s.p && !s.remote) this.direct(s);
    this.lanterns(s, hour);
  }

  /**
   * M6 transport: an errand of the day (server town/possessions.ts errandsFor): the family boat
   * rows a load to another flight and back, the dray goes from its yard to a shop door. The owner
   * leads; the crew go with him (journeys.ts holds them). Out at its hour, back at its end.
   */
  private errandStep(s: Sim, err: { id: string; who: string[]; to: [number, number] } | null, day: number, hour: number): void {
    const j = this.journeys;
    if (err && s.errand !== err.id) {
      s.plain = false;
      s.errand = err.id;
      s.key = `errand:${err.id}`;
      if (s.inside) {
        s.inside = false;
        s.x = s.door[0];
        s.z = s.door[1];
        s.outAt = performance.now();
      }
      s.goal = { mode: "stand", x: err.to[0], z: err.to[1], motion: "idle" };
      if (j && s.r.id === err.who[0] && !s.remote) j.beginErrand(s, err as never, false);
      if (s.p && !s.trip && !s.remote) this.direct(s);
      return;
    }
    if (err) return;
    // the errand's time is up, but the way there is not done yet: finish it first
    if (s.trip?.errand === s.errand) return;
    // the errand is over: the owner rows the boat home (a dray came back to its yard already); then the day goes on
    const was = j?.data?.errands.find((e) => e.id === s.errand) ?? null;
    s.errand = undefined;
    s.key = "";
    const now = activityAt(s.r.sched, day, hour);
    s.key = `${now.act}:${now.place}`;
    s.goal = this.goalFor(s, now);
    if (j && was && was.kind === "boat" && s.r.id === was.who[0] && !s.remote) j.beginErrand(s, was, true);
    if (s.p && !s.trip && !s.remote) this.direct(s);
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
    // (the trade plan: only a goal of the plan's own is walked by the shared sum unseen)
    s.plain = false;
    const mill = this.mills?.goal(s, now); // M7 mills: the millers, the cart out at dawn and after dinner
    if (mill) return mill;
    const back = this.back?.goal(s, now); // M7 back of town
    if (back) return back;
    const lively = this.lively?.goal(s, now);
    if (lively) return lively;
    s.plain = !this.mills?.own(s);
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
        // M7: in at the open door: inside they drink at the tables (game/interiors.ts), seen through the windows
        if (this.tavernInside(now.place)) return { mode: "inside", x: t.x, z: t.z };
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
        // soldiers walking out: their round of the town, the pair side by side (pair())
        if (now.act === "stroll" && r.trade === "soldier" && w.route?.length) return { mode: "roam", x: w.route[0][0], z: w.route[0][1], route: w.route, place: now.place };
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
        // M7 shops: the keeper and his wife serve inside while the shop's room stands open in the world
        const sp = w.kind === "shop" && w.shop ? P(w.shop) : null;
        if (sp && this.tavernInside(`shop:${w.shop}`)) return { mode: "inside", x: sp.door?.[0] ?? sp.x, z: sp.door?.[1] ?? sp.z };
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
      case "tavern": {
        // M7: the publican stands behind his counter while the tavern is open (game/interiors.ts)
        const t = P(w.place);
        if (t && this.tavernInside(w.place)) return { mode: "inside", x: t.x, z: t.z };
        break;
      }
      case "guard":
        // a sentry at his post, rifle at the shoulder; the corporal in front, watching his men
        if (w.at) return { mode: "guard", x: w.at[0], z: w.at[1], yaw: w.at[2], motion: r.trade === "corporal" ? "fold" : "idle" };
        break;
      case "inspect":
        if (w.route?.length) return { mode: "inspect", x: w.route[0][0], z: w.route[0][1], route: w.route, faces: w.faces };
        break;
      case "wait":
        // M6 emigrants: on the family's chest (men), or standing beside it (game/emigrants.ts draws the chests)
        if (w.at) return { mode: "stand", x: w.at[0], z: w.at[1], yaw: w.at[2], motion: w.seat ? "sit" : "idle" };
        break;
      default:
        break;
    }
    if (w.at) return { mode: "stand", x: w.at[0], z: w.at[1], yaw: w.at[2], motion: (w.motion as Motion | undefined) ?? (w.kind === "post" ? "fold" : "idle") };
    const pl = P(w.place) ?? P("rijnkaai")!;
    const [x, z] = this.spot(pl, s);
    return { mode: "loiter", x, z, r: pl.r, place: w.place };
  }

  /** Where their goal is (a trip's end): the stand, the door, the first point of a round. */
  anchor(s: Sim): Pt {
    const g = s.goal;
    if (g.mode === "haul" && g.a) return g.a;
    if (g.route?.length) return g.route[s.step % g.route.length];
    return [g.x, g.z];
  }

  /** Nobody sees them: a walk to where they should be, briskly, along the way on foot (the last steps straight). */
  private coarse(s: Sim, dt: number): void {
    // M6 transport: on a trip, the way of going sets the pace (journeys.ts)
    if (s.trip && this.journeys?.coarse(s, dt)) return;
    // the trade plan: on the way between two places of his plan, the shared sum has him (as the town map does)
    const on = s.trip ? null : this.whereNow(s);
    if (on && on.walked < on.total) {
      s.x = on.x;
      s.z = on.z;
      return;
    }
    // (M6 lively: the pairs on a round, the sweep and his boy, two Sisters, a man and his wife, keep together unseen too)
    const lead = s.goal.mode === "roam" || s.goal.mode === "patrol" ? this.leadOf(s) : null;
    if (lead) s.step = lead.step;
    const [tx, tz] = lead ? [lead.x + 0.6, lead.z] : this.anchor(s);
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
    if (alive > this.maxPuppets) {
      // the setting went down: the farthest go back to their schedule, out of sight
      const px = this.player.x;
      const pz = this.player.z;
      const out = this.sims
        .filter((s) => s.p && !s.held && this.crowd.isHidden(s.x, s.z))
        .sort((a, b) => dist(b.x, b.z, px, pz) - dist(a.x, a.z, px, pz))
        .slice(0, Math.min(4, alive - this.maxPuppets));
      for (const s of out) this.lose(s, true, true);
      return;
    }
    if (alive >= this.maxPuppets) return;
    const px = this.player.x;
    const pz = this.player.z;
    const net = this.net;
    const want = this.sims
      .filter((s) => !s.p && !s.remote && !s.inside && !s.aboard && !(s.held && s.away) && dist(s.x, s.z, px, pz) < SPAWN_R && (!net || net.mayWalk(s.r.id)))
      .sort((a, b) => dist(a.x, a.z, px, pz) - dist(b.x, b.z, px, pz));
    for (const s of want) {
      if (alive >= this.maxPuppets) break;
      const d = dist(s.x, s.z, px, pz);
      const fresh = performance.now() - s.outAt < 4000;
      // people appear out of sight, or step out of their own door
      if (!anywhere && !fresh && !this.crowd.isHidden(s.x, s.z)) {
        // the trade plan (Steve 2026-09-27: "if I run to that place I never see the npc again"): nobody stays
        // unseen for ever because Jef looks at his spot. Far off he steps in at once (small, in the haze); nearer
        // after a moment of looking.
        const t = performance.now();
        if (s.dueAt === undefined || t - (s.dueLast ?? 0) > 1000) s.dueAt = t;
        s.dueLast = t;
        if (d < DUE_FAR && t - s.dueAt < (d < DUE_NEAR ? DUE_NEAR_WAIT_MS : DUE_WAIT_MS)) continue;
      }
      s.dueAt = undefined;
      if (!anywhere && d < 3) continue;
      // two soldiers walking out: the second appears at his comrade's side
      const lead = s.goal.mode === "roam" || s.goal.mode === "patrol" ? this.leadOf(s) : null;
      const side = lead?.p ? { x: lead.p.x - Math.cos(lead.p.yaw) * 0.62, z: lead.p.z + Math.sin(lead.p.yaw) * 0.62 } : null;
      let at: { x: number; z: number } | null =
        side && this.crowd.canStand(side.x, side.z) ? side : this.crowd.canStand(s.x, s.z) ? { x: s.x, z: s.z } : this.crowd.openNear(s.x, s.z);
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
      net?.spawned(s.r.id);
      this.direct(s);
      this.lanterns(s, this.clock().hour);
      this.lively?.spawned(s);
      this.back?.spawned(s); // M7 back of town
      this.mills?.spawned(s); // M7 mills
      if (s.r.dog) {
        const sim = s;
        this.animals.addDog(s.r.id, s.r.dog.look, at, () =>
          sim.p ? { x: sim.p.x, z: sim.p.z, yaw: sim.p.yaw, walking: this.crowd.puppetBusy(sim.p) } : null,
        );
      }
      at = null;
    }
  }

  /**
   * Back to the schedule only (out of range, or in at the door). `street`: he is still in the street, only out of
   * this PC's range (M8b: another PC near may walk him on); else he is gone from it (a door, a boat, an action).
   */
  private lose(s: Sim, remove = false, street = false): void {
    if (s.remote) {
      // M8b: one another PC walked: only the figure goes
      if (s.p && remove) this.crowd.removePuppet(s.p);
      s.p = null;
      s.remote = false;
      if (s.r.dog) this.animals.removeDog(s.r.id);
      return;
    }
    if (s.p) this.net?.lost(s.r.id, street);
    if (s.p) this.lively?.lost(s);
    if (s.p) this.back?.lost(s); // M7 back of town
    if (s.p) this.mills?.lost(s); // M7 mills
    if (s.p && remove) this.crowd.removePuppet(s.p);
    s.p = null;
    s.held = false;
    // (the lantern went with the puppet: drawn again, he takes it up again; M7 fog lamps, 2026-09-25)
    s.lamp = false;
    if (s.r.dog) this.animals.removeDog(s.r.id);
  }

  private paceOf(s: Sim): number {
    const r = s.r;
    if (r.age < 13) return rnd(1.1, 1.5);
    if (r.age >= 62) return rnd(0.8, 1.0);
    if (r.trade === "police" || r.trade === "priest") return rnd(0.95, 1.05);
    if (SOLDIERS.has(r.trade)) return rnd(1.25, 1.35); // the marching step
    if (r.trade === "customs") return rnd(1.0, 1.1);
    if (r.kind === "porter" || r.kind === "carter") return rnd(0.85, 1.0);
    return r.sex === "f" ? rnd(1.0, 1.25) : rnd(1.15, 1.4);
  }

  /** Tell a puppet where to go for its goal. */
  private direct(s: Sim): void {
    const p = s.p!;
    const g = s.goal;
    if (s.trip && this.journeys) {
      this.journeys.direct(s);
      return;
    }
    this.crowd.puppetLoad(p, false);
    const pace = this.paceOf(s);
    switch (g.mode) {
      case "haul":
        s.toB = false;
        this.crowd.puppetGo(p, g.a![0], g.a![1], pace);
        break;
      case "patrol":
      case "roam":
      case "thief":
      case "inspect": {
        const q = g.route![s.step % g.route!.length];
        // soldiers walking out take it easy
        this.crowd.puppetGo(p, q[0], q[1], g.mode === "thief" ? 0.9 : s.r.trade === "soldier" && g.mode === "roam" ? pace * 0.8 : pace);
        s.ph = 0;
        break;
      }
      case "guard": {
        // the relief: to the waiting spot while the old sentry still stands at the post
        const w = this.reliefWait(s);
        this.crowd.puppetGo(p, w ? w[0] : g.x, w ? w[1] : g.z, pace);
        break;
      }
      default:
        this.crowd.puppetGo(p, g.x, g.z, pace);
    }
  }

  // ------------------------------------------------------------------ what they do there

  private behave(s: Sim, dt: number, hour: number): void {
    // M6 transport: riding, pushing the cart, waiting for the omnibus, going to the boat
    if (s.trip && this.journeys?.behave(s, dt)) return;
    if (this.mills?.behave(s, dt, hour)) return; // M7 mills
    if (this.back?.behave(s, dt, hour)) return; // M7 back of town
    if (this.lively?.behave(s, dt, hour)) return;
    const p = s.p!;
    const g = s.goal;
    if (this.pair(s, dt)) return;
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
        if (g.motion === "sit") {
          // M6 emigrants: sit down on the chest (the last step onto the seat itself), and stay sat
          if (p.state !== "sit") {
            p.x = g.x;
            p.z = g.z;
            this.crowd.puppetSit(p, g.yaw ?? null);
          }
          return;
        }
        if ((s.wait -= dt) <= 0) {
          // sellers call out now and then; drinkers take turns talking; the emigrant women talk among themselves
          const talky = g.mode === "tavern" || s.r.work.kind === "stall" || s.r.work.kind === "shop" || s.r.work.kind === "wait";
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
          // two soldiers walking out stop and talk, the one at his side listening (crowd follow)
          const mate = s.r.trade === "soldier" && s.r.mate ? this.byId.get(s.r.mate) : undefined;
          const talk = !!mate?.p && dist(mate.p.x, mate.p.z, p.x, p.z) < 2 && Math.random() < 0.6;
          this.crowd.puppetStand(p, s.r.trade === "police" ? "behind" : talk ? "talk" : "idle", talk && mate?.p ? Math.atan2(mate.p.x - p.x, mate.p.z - p.z) : null);
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
      case "guard":
        return this.guard(s, dt, busy);
      case "inspect":
        return this.inspect(s, dt, busy);
      case "play":
        return this.play(s, dt);
      case "market":
      case "stroll":
      case "loiter":
        // M3i: along the stalls, stop, look, haggle, buy (game/market.ts)
        if (g.mode === "market" && this.market?.browse(p, g.place ?? "", dt)) return;
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

  // ---- the garrison and the customs (server town/garrison.ts)

  /** Two soldiers walking out: the one with the higher id walks at his comrade's side. */
  private leadOf(s: Sim): Sim | null {
    const m = s.r.mate;
    if (!m || (s.r.trade !== "soldier" && s.r.work.kind !== "round") || m > s.r.id) return null;
    const l = this.byId.get(m);
    return l && !l.inside && l.key === s.key ? l : null;
  }

  /** Keep with the comrade (true: the crowd walks him now). Lets go when they part. */
  private pair(s: Sim, dt: number): boolean {
    const p = s.p!;
    const l = s.goal.mode === "roam" ? this.leadOf(s) : null;
    if (l?.p && !l.held) {
      const d = dist(l.p.x, l.p.z, p.x, p.z);
      if (d < 14) {
        this.crowd.puppetFollow(p, l.p);
        s.step = l.step;
        return true;
      }
      // too far to fall in beside him: catch up first
      if (this.crowd.puppetFollowing(p)) this.crowd.puppetFollow(p, null);
      if ((s.wait -= dt) <= 0) {
        s.wait = 1;
        this.crowd.puppetGo(p, l.p.x, l.p.z, 1.8); // a quick step to catch up
      }
      return true;
    }
    if (this.crowd.puppetFollowing(p)) {
      this.crowd.puppetFollow(p, null);
      s.wait = 0;
      s.arrived = false;
      this.direct(s);
    }
    return false;
  }

  /**
   * A sentry at his post, facing down the quay. The relief comes out half an hour early and,
   * while the old man still stands there, waits a step in front of him, facing him (the
   * orders handed over), until he marches in; then takes the post.
   */
  private guard(s: Sim, dt: number, busy: boolean): void {
    const p = s.p!;
    const g = s.goal;
    if (busy) return;
    if (dist(p.x, p.z, g.x, g.z) > 0.7) {
      const wait = this.reliefWait(s);
      if (wait) {
        const [fx, fz] = wait;
        if (dist(p.x, p.z, fx, fz) > 0.7 && s.tries < 3) {
          s.tries++;
          this.crowd.puppetGo(p, fx, fz);
          return;
        }
        if ((s.wait -= dt) <= 0) {
          this.crowd.puppetStand(p, Math.random() < 0.5 ? "talk" : "idle", Math.atan2(g.x - p.x, g.z - p.z));
          s.wait = rnd(1.5, 3);
        }
        return;
      }
      if (s.tries < 5) {
        s.tries++;
        s.wait = 0;
        this.crowd.puppetGo(p, g.x, g.z);
        return;
      }
    }
    if ((s.wait -= dt) <= 0) {
      this.crowd.puppetStand(p, g.motion ?? "idle", g.yaw ?? null);
      s.wait = rnd(6, 14);
    }
  }

  /**
   * The old sentry still stands at this man's post: where the relief waits for him, a step in
   * front and a step to the side (off the line of the pair), facing him. null: the post is free.
   */
  private reliefWait(s: Sim): Pt | null {
    const g = s.goal;
    if (g.mode !== "guard" || s.r.trade !== "sentry") return null;
    const old = this.sims.find((o) => o !== s && o.p && o.goal.mode === "guard" && o.r.trade === s.r.trade && dist(o.p.x, o.p.z, g.x, g.z) < 0.9);
    if (!old) return null;
    const yaw = g.yaw ?? 0;
    return [g.x + Math.sin(yaw) * 1.2 - Math.cos(yaw) * 1.2, g.z + Math.cos(yaw) * 1.2 + Math.sin(yaw) * 1.2];
  }

  /** A customs officer: at each landing up to the nearest goods, writes in his book, looks them over, goes on. */
  private inspect(s: Sim, dt: number, busy: boolean): void {
    const p = s.p!;
    const g = s.goal;
    const route = g.route!;
    if (busy) return;
    switch (s.ph ?? 0) {
      case 0: {
        const q = this.goodsNear(p.x, p.z, 5);
        s.face = q?.yaw ?? g.faces?.[s.step % route.length] ?? null;
        s.ph = 2;
        s.wait = 0;
        if (q && dist(p.x, p.z, q.x, q.z) > 0.5) {
          s.ph = 1;
          this.crowd.puppetGo(p, q.x, q.z);
        }
        return;
      }
      case 1:
        s.ph = 2;
        s.wait = 0;
        return;
      case 2:
        if (s.wait <= 0) {
          this.crowd.puppetStand(p, "write", s.face ?? null);
          s.wait = rnd(7, 14);
        }
        if ((s.wait -= dt) <= 0) {
          // look the goods over (or answer a docker), then write again or go on
          this.crowd.puppetStand(p, Math.random() < 0.5 ? "behind" : "idle", s.face ?? null);
          s.wait = rnd(3, 6);
          s.ph = 3;
        }
        return;
      default:
        if ((s.wait -= dt) > 0) return;
        if (Math.random() < 0.3) {
          s.ph = 2;
          return;
        }
        s.step++;
        this.direct(s);
    }
  }

  /**
   * The nearest pile of goods (crates, casks, bales, a cart: the world's solids of that size)
   * within r of (x, z): where to stand, 0.8 m out from its side, and the way to face it.
   */
  private goodsNear(x: number, z: number, r: number): { x: number; z: number; yaw: number } | null {
    let best: { cx: number; cz: number; mx: number; mz: number } | null = null;
    let bd = r;
    for (const b of this.world.solids()) {
      const w = b.maxX - b.minX;
      const d = b.maxZ - b.minZ;
      if (w * d < 0.4 || w * d > 30 || Math.max(w, d) > 9) continue; // not a lamp post or a tree, not a crane or a shed
      const cx = Math.max(b.minX, Math.min(b.maxX, x));
      const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
      const e = dist(x, z, cx, cz);
      if (e < bd) {
        bd = e;
        best = { cx, cz, mx: (b.minX + b.maxX) / 2, mz: (b.minZ + b.maxZ) / 2 };
      }
    }
    if (!best) return null;
    let ox = best.cx - best.mx;
    let oz = best.cz - best.mz;
    if (Math.hypot(ox, oz) < 0.01) {
      ox = x - best.mx;
      oz = z - best.mz;
    }
    const L = Math.hypot(ox, oz) || 1;
    const sx = best.cx + (ox / L) * 0.8;
    const sz = best.cz + (oz / L) * 0.8;
    if (!this.crowd.canStand(sx, sz)) return null;
    return { x: sx, z: sz, yaw: Math.atan2(best.mx - sx, best.mz - sz) };
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
    // Fix 2026-09-25 (the games checked in close pictures): everyone at tag on this square, not only those
    // within 30 m of this child (each far child picked a new "it" twice a second); not the children at
    // the rope, hoops or marbles (lively.ts), nor a girl or boy of fifteen dressed as grown (only watches)
    const kids = this.sims.filter((o) => o.p && o.p.human.scale < 0.9 && o.goal.mode === "play" && o.goal.place === key && !o.inside && !this.lively?.playing?.(o));
    const near = kids.filter((o) => dist(o.x, o.z, p.x, p.z) < 30);
    if (near.length < 2) {
      // alone: go and find the others (the nearest child out playing anywhere near)
      const other = this.sims
        .filter((o) => o !== s && o.goal.mode === "play" && !o.inside && (!o.p || o.p.human.scale < 0.9) && !this.lively?.playing?.(o))
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
      if (dist(prey.x, prey.z, p.x, p.z) < 0.95) {
        // tag! within arm's reach, a hand out to the other one, who is it now and counts to three
        game.last = s;
        game.it = prey;
        game.frozen = 1.5;
        this.crowd.puppetStand(p, "talk", Math.atan2(prey.x - p.x, prey.z - p.z));
        s.wait = 1.2;
        return;
      }
      this.crowd.puppetGo(p, prey.x, prey.z, 2.4);
    } else {
      const it = game.it;
      const d = dist(it.x, it.z, p.x, p.z);
      // (2026-09-25: they ran on off the square, up to 80 m away; now they keep to the play place)
      const R = Math.max(6, Math.min(14, s.goal.r ?? 10));
      const inside = (x: number, z: number): [number, number] => {
        const dx = x - s.goal.x;
        const dz = z - s.goal.z;
        const k = Math.hypot(dx, dz);
        return k > R ? [s.goal.x + (dx / k) * R, s.goal.z + (dz / k) * R] : [x, z];
      };
      if (d < 6) {
        const L = d || 1;
        // away from it; cornered (a wall or a house that way), off to one side instead of running on the spot
        // at the wall (fixes 2026-09-27, the stuck check)
        const ax = (p.x - it.x) / L;
        const az = (p.z - it.z) / L;
        const jx = rnd(-1.5, 1.5);
        const jz = rnd(-1.5, 1.5);
        let to: [number, number] | null = null;
        for (const turn of [0, 0.8, -0.8, 1.6, -1.6]) {
          const c = Math.cos(turn);
          const sn = Math.sin(turn);
          const q = inside(p.x + (ax * c - az * sn) * 4 + jx, p.z + (ax * sn + az * c) * 4 + jz);
          if (this.crowd.canStand(q[0], q[1]) && dist(q[0], q[1], p.x, p.z) > 1.5) {
            to = q;
            break;
          }
        }
        if (to) this.crowd.puppetGo(p, to[0], to[1], 2.2);
        else if (!this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "idle", Math.atan2(it.x - p.x, it.z - p.z));
      } else if (!this.crowd.puppetBusy(p)) {
        if (Math.random() < 0.5) {
          // skip about near where they are, keeping an eye on it
          const a = Math.random() * Math.PI * 2;
          const [fx, fz] = inside(p.x + Math.cos(a) * rnd(2, 4), p.z + Math.sin(a) * rnd(2, 4));
          this.crowd.puppetGo(p, fx, fz, rnd(1.3, 2));
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
        const k = Math.min(1, (1.1 * dt) / db);
        const nx = p.x + (bx0 - p.x) * k;
        const nz = p.z + (bz0 - p.z) * k;
        if (this.world.isFree(nx, nz, 0.25) && dist(nx, nz, this.player.x, this.player.z) > 0.55) {
          if (p.human.motion !== "walk" || this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "walk", null);
          p.x = nx;
          p.z = nz;
          p.yaw = Math.atan2(bx0 - p.x, bz0 - p.z);
        } else if (p.human.motion === "walk" || this.crowd.puppetBusy(p)) {
          // right behind him, or a wall between: wait there (fixes 2026-09-27: he walked on the spot)
          this.crowd.puppetStand(p, "idle", null);
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
  thiefInReach(x: number, z: number, reach = 3.2): { who: Speaker; at: Target } | null {
    for (const [id, at] of this.robbed) {
      const s = this.byId.get(id);
      if (!s?.p || s.remote || performance.now() - at > 25_000) continue;
      if (dist(s.p.x, s.p.z, x, z) < reach) return { who: this.speaker(s), at: chest(s.p.group, 1.3 * s.p.size) };
    }
    return null;
  }

  private grabbing = false;
  async grab(id: string): Promise<void> {
    if (this.grabbing) return; // E twice: one grab
    this.grabbing = true;
    try {
      const r = await api.catchThief(id);
      this.onPayload(r);
      this.toast(r.text);
    } catch (e) {
      this.toast(`${(e as Error).message}.`);
    } finally {
      this.grabbing = false;
    }
    this.robbed.set(id, 0);
  }

  /** New night: thieves may try again (the server says no to a second go the same night). */
  newDay(): void {
    this.robbed.clear();
  }

  // ---- lanterns and the employers' night posts

  private lanterns(s: Sim, hour: number): void {
    if (!s.p || s.remote) return; // (M8b: a remote one's lantern comes with him)
    const on =
      isNight(hour) &&
      s.r.age >= 14 &&
      s.r.trade !== "thief" &&
      !GARRISON.has(s.r.trade) &&
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
      // M7 night: at the post in working hours only; a job in hand is finished at the box by the door
      const work = activityAt(r.sched, day, hour).act === "work";
      n.setPresent(work);
      const quest = this.openWork.has(id) || this.takenWork.has(id);
      if (!work) continue;
      // M7 night: a giver of night work keeps to his dark corner, a shaded lantern in his hand
      if ((NIGHT_GIVER_IDS as readonly string[]).includes(id)) {
        n.nightPost(null);
        n.setLantern(true);
        continue;
      }
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
    // the Rijnkaai three: at the post in their hours (shared/night.ts POST_HOURS; M7 night: home asleep
    // outside them), with a lantern after dark while their work is open
    for (const id of ["sooi", "peeters", "tuur", "fientje"]) {
      const n = this.people.get(id);
      if (!n) continue;
      const here = atPost(id, hour);
      if (n.present !== here) n.setPresent(here);
      n.setLantern(here && dark && this.openWork.has(id));
    }
  }

  /**
   * M3i (game/market.ts): a stall keeper turns to a buyer at the stall and talks for a few
   * seconds (only while at the stall: not walking, not held by Jef).
   */
  gesture(id: string, x: number, z: number, secs: number): void {
    const s = this.byId.get(id);
    if (!s?.p || s.held || s.goal.mode !== "stand" || this.crowd.puppetBusy(s.p)) return;
    this.crowd.puppetStand(s.p, "talk", Math.atan2(x - s.p.x, z - s.p.z));
    s.wait = secs;
  }

  // ------------------------------------------------------------------ talking

  private speaker(s: Sim): Speaker {
    return {
      id: s.r.id,
      def: { name: s.r.name, title: s.r.label },
      lookAt: () => {},
    };
  }

  /** The townsperson in the street within reach that Jef looks at, nearest the crosshair (E: talk to them; game/facing.ts). */
  nearestTalker(x: number, z: number, reach = 2.4, skip?: string): { who: Speaker; d: number; at: Target } | null {
    const r = pick(this.sims, (s) => {
      if (!s.p || !s.p.shown || s.remote || s.r.id === skip) return null;
      const d = dist(s.p.x, s.p.z, x, z);
      return d < reach ? { d, at: chest(s.p.group, 1.3 * s.p.size) } : null;
    });
    return r ? { who: this.speaker(r.it), d: r.d, at: r.at } : null;
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
    // M8b: another PC walks him: only the host may take him (his actions and his police are the game's), and
    // then he is walked here from where he stands; a guest's PC leaves him be
    if ((s.remote || (!s.p && this.net && !this.net.mayWalk(id))) && !this.net?.take(id)) return null;
    if (s.remote) this.remoteHandover(s);
    // M6 transport: an action or the police take them off their trip (the vehicle goes back to its spot)
    if (s.trip) this.journeys?.end(s, false);
    if (s.inTrip || s.aboard) return null;
    if (s.p) this.crowd.puppetFollow(s.p, null);
    if (!s.p && from) {
      if (!isHumanKind(s.kind)) s.kind = KIND_FALLBACK[s.kind] ?? "docker_a";
      const p = this.crowd.addPuppet(s.kind, from.x, from.z, 0, this.paceOf(s));
      if (!p) return null;
      s.p = p;
      s.inside = false;
      s.x = from.x;
      s.z = from.z;
      this.net?.spawned(id);
      this.lanterns(s, this.clock().hour);
    }
    if (!s.p) return null;
    s.held = true;
    s.away = false;
    return s.p;
  }

  // ---- M4 (game/actions.ts, events.ts, bubbles.ts)

  /** Is this resident held by another layer (the police visit, an action, a talk)? */
  held(id: string): boolean {
    return this.byId.get(id)?.held ?? false;
  }

  /** Where a resident is now (in the street or on their unseen way), or an employer at their post; null indoors. */
  position(id: string): { x: number; z: number; shown: boolean } | null {
    const s = this.byId.get(id);
    if (s) {
      if (s.p) return { x: s.p.x, z: s.p.z, shown: s.p.shown };
      return s.inside ? null : { x: s.x, z: s.z, shown: false };
    }
    const n = this.employers.get(id);
    return n ? { x: n.pos.x, z: n.pos.z, shown: true } : null;
  }

  puppet(id: string): Puppet | null {
    return this.byId.get(id)?.p ?? null;
  }

  /** Who they are, for voices and bubbles. */
  info(id: string): { name: string; first: string; sex: "m" | "f"; age: number; trade: string } | null {
    const r = this.data?.residents.find((x) => x.id === id);
    return r ? { name: r.name, first: r.first, sex: r.sex, age: r.age, trade: r.trade } : null;
  }

  /** Is this keeper at work by the clock (to reopen a stall an event shut)? */
  isAtWork(id: string): boolean {
    const s = this.byId.get(id) ?? null;
    const r = s?.r ?? this.data?.residents.find((x) => x.id === id);
    if (!r) return false;
    const { day, hour } = this.clock();
    return activityAt(r.sched, day, hour).act === "work";
  }

  /**
   * Claim a resident for an action wherever they are: in the street already, or out of
   * sight (they step into the street where they were, or round a corner from Jef).
   */
  claimNear(id: string, near: { x: number; z: number }, rMin = 26): Puppet | null {
    const s = this.byId.get(id);
    if (!s) return null;
    if (s.remote) return this.claim(id); // (M8b: the host takes him where he is; a guest does not)
    if (s.p) return this.claim(id);
    let from: { x: number; z: number } | null = null;
    if (this.crowd.isHidden(s.x, s.z) && this.crowd.canStand(s.x, s.z)) from = { x: s.x, z: s.z };
    if (!from) {
      const d = dist(s.x, s.z, near.x, near.z) || 1;
      const ux = (s.x - near.x) / d;
      const uz = (s.z - near.z) / d;
      for (let i = 0; i < 12 && !from; i++) {
        const turn = (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.5;
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const r = rMin + (i % 3) * 6;
        const q = this.crowd.openNear(near.x + (ux * c - uz * sn) * r, near.z + (ux * sn + uz * c) * r);
        if (q && this.crowd.isHidden(q.x, q.z)) from = q;
      }
    }
    if (!from) return null;
    return this.claim(id, from);
  }

  /** Unseen and held: move them on toward a point at the hidden pace (a long go_to across town). */
  moveHidden(id: string, tx: number, tz: number, dt: number, speed = HIDDEN_SPEED): void {
    const s = this.byId.get(id);
    if (!s) return;
    // in a boat on the water, or on someone's trip: the trip has them (fixes 2026-09-24: the
    // afternoon's ballad crowd took Karel Van Loock out of his boat in mid-river); they come after
    if (s.inTrip || s.aboard || s.remote) return;
    if (s.p) {
      // still in the street but off the walk grid: the crowd cannot path them; they go on unseen
      if (this.crowd.onGrid(s.p.x, s.p.z)) return;
      this.lose(s, true);
    }
    // held: the schedule's own unseen walk (coarse) must not pull them the other way
    s.held = true;
    s.inside = false;
    const d = dist(s.x, s.z, tx, tz);
    if (d < 0.5) return;
    const k = Math.min(1, (speed * dt) / d);
    s.x += (tx - s.x) * k;
    s.z += (tz - s.z) * k;
  }

  /**
   * Fixes 2026-09-24: out of Jef's sight and far from where an action sends them, a townsperson
   * leaves the street to go on unseen (moveHidden), and steps out again near the place: a crowd
   * then forms in a few game minutes, not in the half hour of a walk in view.
   */
  hideAway(id: string): boolean {
    const s = this.byId.get(id);
    if (!s?.p || s.p.shown || s.trip || s.aboard || s.inTrip || s.remote) return false;
    s.x = s.p.x;
    s.z = s.p.z;
    this.lose(s, true);
    s.held = true;
    s.away = true;
    s.inside = false;
    return true;
  }

  /** Back to their day. */
  release(id: string): void {
    const s = this.byId.get(id);
    if (!s) return;
    s.held = false;
    s.away = false;
    s.wait = 0;
    if (s.p && !s.remote) this.direct(s);
  }

  /** Hold still and face Jef while he talks to them; let go after. */
  hold(id: string, on: boolean): void {
    const s = this.byId.get(id);
    if (!s?.p || s.remote) return;
    this.crowd.puppetFollow(s.p, null);
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

  // ---- M6 (game/emigrants.ts): people who come to town and leave it while the game runs

  /**
   * New residents (a family off the train), or a changed record (the runner taken to the cell).
   * A new one starts out in the street at `from` (unseen: they walk in from the station road);
   * a changed one keeps where they are and takes up the new day at once.
   */
  upsertResidents(list: TownResident[], from?: Pt): string[] {
    if (!this.data) return [];
    const added: string[] = [];
    for (const r of list) {
      const s = this.byId.get(r.id);
      if (s) {
        if (JSON.stringify(s.r.home) === JSON.stringify(r.home) && JSON.stringify(s.r.sched) === JSON.stringify(r.sched) && JSON.stringify(s.r.work) === JSON.stringify(r.work)) continue;
        s.r = r;
        s.key = "";
        const i = this.data.residents.findIndex((x) => x.id === r.id);
        if (i >= 0) this.data.residents[i] = r;
        continue;
      }
      if (this.employers.has(r.id)) continue;
      const at = from ?? [r.home.sx, r.home.sz];
      const n: Sim = {
        r, kind: r.kind as HumanKind, x: at[0], z: at[1], inside: !from, door: [r.home.sx, r.home.sz], key: "", goal: { mode: "home", x: r.home.sx, z: r.home.sz },
        p: null, step: 0, wait: 0, toB: false, arrived: false, tries: 0, held: false, outAt: 0, lamp: false, thief: null, h: hash(r.id),
      };
      this.sims.push(n);
      this.byId.set(r.id, n);
      this.data.residents.push(r);
      added.push(r.id);
    }
    return added;
  }

  /** A resident leaves the town for good (an emigrant family gone down into the lighter). */
  dropResident(id: string): void {
    const s = this.byId.get(id);
    if (!s) return;
    this.lose(s, true);
    this.byId.delete(id);
    this.sims.splice(this.sims.indexOf(s), 1);
    if (this.data) this.data.residents = this.data.residents.filter((r) => r.id !== id);
  }

  /** Is this resident in town (a sim)? */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  // ------------------------------------------------------------------ M6 transport

  /** What journeys.ts may do with the town's residents. */
  journeyHost(): JourneyTown {
    return {
      sims: () => this.sims,
      sim: (id) => this.byId.get(id),
      anchor: (s) => this.anchor(s as Sim),
      clock: () => this.clock(),
      drop: (s) => this.lose(s as Sim, true),
      resume: (s) => {
        const q = s as Sim;
        q.wait = 0;
        q.tries = 0;
        q.arrived = false;
        if (q.p) this.direct(q);
      },
      pace: (s) => this.paceOf(s as Sim),
      hiddenSpeed: HIDDEN_SPEED,
    };
  }

  /** M6: on the omnibus for an action (actions.ts byTram): not in the street. */
  setAboard(id: string, on: boolean): void {
    const s = this.byId.get(id);
    if (!s) return;
    s.aboard = on;
    if (on) {
      if (s.p) this.lose(s, true);
      s.held = true;
      s.inside = false;
    }
  }

  /** M6: where someone out of sight is now (riding the omnibus). */
  placeHidden(id: string, x: number, z: number): void {
    const s = this.byId.get(id);
    if (!s || s.p) return;
    s.x = x;
    s.z = z;
  }

  /** Unseen and held for an action: the pace of the way they go (a velocipede at hand goes faster). */
  hiddenPace(id: string, tx: number, tz: number): number {
    const s = this.byId.get(id);
    if (!s || !this.journeys) return HIDDEN_SPEED;
    return this.journeys.hiddenPace(id, [s.x, s.z], [tx, tz]);
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
      // the garrison's walking-out rounds and the customs' landings
      if ((w.kind === "inspect" || r.trade === "soldier") && w.route) w.route.forEach(([x, z], i) => out.push({ label: `${r.name}: round ${i + 1}`, x, z, reach: 2.4 }));
    }
    for (const [id, at] of this.stalls.sellerSpots) out.push({ label: `seller ${id}`, x: at.x, z: at.z, reach: 2.4 });
    for (const f of this.stalls.fronts) out.push({ label: f.label, x: f.x, z: f.z, reach: 1.8 });
    for (const [id, p] of Object.entries(d.places)) out.push({ label: `place ${id}`, x: p.x, z: p.z, reach: 3 });
    // M3i: the market stalls that stand now
    for (const q of this.market?.pathPoints() ?? []) out.push(q);
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

  /** M7 back of town (game/backlife.ts): a resident's walk through the day. */
  simOf(id: string): Sim | undefined {
    return this.byId.get(id);
  }

  // ---- M8b multiplayer (net/mp/street.ts): the townspeople other PCs walk

  /** Every resident (read only): where they are, in the street or not, walked here or by another PC. */
  netSims(): readonly Sim[] {
    return this.sims;
  }

  /**
   * Another PC walks him now: he is drawn from its batches. One walked here until now is handed over as he
   * stands (the same figure: no jump); one not in the street here appears where the owner has him.
   */
  remoteAttach(id: string, at: { x: number; z: number; yaw: number; size: number }): Puppet | null {
    const s = this.byId.get(id);
    if (!s) return null;
    if (s.remote && s.p) return s.p;
    if (s.p) {
      if (s.trip) this.journeys?.end(s, false);
      this.lively?.lost(s);
      this.back?.lost(s);
      this.mills?.lost(s);
      this.market?.forget(s.p);
      this.crowd.puppetRemote(s.p, true);
      s.remote = true;
      s.held = false;
      s.away = false;
      return s.p;
    }
    if (!isHumanKind(s.kind)) s.kind = KIND_FALLBACK[s.kind] ?? "docker_a";
    const p = this.crowd.addRemote(s.kind, at.x, at.z, at.yaw, at.size);
    if (!p) return null;
    s.p = p;
    s.remote = true;
    s.inside = false;
    s.held = false;
    s.away = false;
    s.x = at.x;
    s.z = at.z;
    if (s.r.dog) {
      const sim = s;
      this.animals.addDog(s.r.id, s.r.dog.look, at, () => (sim.p ? { x: sim.p.x, z: sim.p.z, yaw: sim.p.yaw, walking: this.crowd.puppetBusy(sim.p) || this.crowd.isRemote(sim.p) } : null));
    }
    return p;
  }

  /** He is this PC's to walk now (his owner let him go near us, or the host took him): on from where he stands. */
  remoteTake(id: string): boolean {
    const s = this.byId.get(id);
    if (!s?.remote || !s.p) return false;
    this.remoteHandover(s);
    return true;
  }

  /** Nobody sends him any more (the owner went, or he is out of our range): the figure goes; his day goes on unseen. */
  remoteDrop(id: string): void {
    const s = this.byId.get(id);
    if (s?.remote) this.lose(s, true);
  }

  private remoteHandover(s: Sim): void {
    if (!s.p) return;
    this.crowd.puppetRemote(s.p, false);
    s.remote = false;
    s.inside = false;
    s.x = s.p.x;
    s.z = s.p.z;
    s.tries = 0;
    s.wait = 0;
    this.lively?.spawned(s);
    this.back?.spawned(s);
    this.mills?.spawned(s);
    this.direct(s);
    this.lanterns(s, this.clock().hour);
  }

  /** Dev: one resident's state. */
  who(id: string) {
    const s = this.byId.get(id);
    return s && { name: s.r.name, trade: s.r.trade, key: s.key, mode: s.goal.mode, x: +s.x.toFixed(1), z: +s.z.toFixed(1), inside: s.inside, puppet: !!s.p, trip: s.trip ? `${s.trip.mode}:${s.trip.phase}` : null, inTrip: !!s.inTrip, aboard: !!s.aboard };
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
