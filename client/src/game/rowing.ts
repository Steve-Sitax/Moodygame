import * as THREE from "three";
import type { FirstPerson, RowHull } from "../player/firstPerson";
import { WATER_Y, type World } from "../world/rijnkaai";
import type { Exit } from "../world/quaysteps";
import { BOAT_NAMES, type BoatName, type SmallFleet } from "../world/boats";
import { DECK_UNDER } from "../world/bridges";
import { bedAt, HW_MAX, levelAt, LW_MIN, MID_Y, tideRate, water } from "../world/tide";
import type { Rect } from "../world/geom";
import { psx, psxUniforms } from "../retro/psx";
import type { JobsPayload } from "../net/api";
import type { Jobs } from "./jobs";
import type { Deeds } from "./deeds";
import type { Action } from "./runs";
import { nearestAim, type Target } from "./facing";
import type { MapMark } from "./map";
import { makeHuman, type Human, type HumanKind } from "./humans";
import { bootRestore } from "./restoreData";
import { HULLS, MOORINGS, SMALL_KINDS, isSmallKind, type Mooring, type SmallKind } from "../../../shared/smallBoats";
import { Moorings, floorOf, type RopeEnd } from "./boatMoorings";
import { LifeAboard } from "./lifeAboard";

// Rowing boats (M3j), on the client. Steve, 2026-09-23: "We should be able to take a boat and
// row to other places. Bridge goes up if we don't fit underneath. Only rowing boats, no big
// ones." "We should be able to get out of a boat anywhere." "If it is a collision place, i.e. a
// bridge, or in the path of a big boat, it breaks, sinks and disappears."
//
// The server decides everything that counts (server/src/rowing.ts, town/rowDeeds.ts): the hire,
// the late money, the fine for a boat left out, the price of a lost boat, the needs, and the
// theft of a boat (the M3h deed system). This side shows the boats and the oars, gives the keys,
// keeps the boat on open water (player/firstPerson.ts row*), asks the bridges and the lock to
// open when a boat does not fit, and plays what the server says.
//
// Keys: on a landing, E hire a boat (or take one that is not yours: theft); in the boat, W/S,
// A/D, Shift (firstPerson.ts); E gets you out: onto the steps, a ladder, a pontoon, or over the
// side into the water. A hired boat got out of at any hire landing goes back to the waterman.

/** M7 boats: nine kinds of small boat (shared/smallBoats.ts), every one rowable. */
type Kind = SmallKind;

interface Landing {
  id: string;
  label: string;
  kind: Kind;
  top: [number, number];
  landing: [number, number];
  x: number;
  z: number;
  yaw: number;
  waterman: string;
}
interface LooseInfo {
  id: string;
  kind: Kind;
  owner: string | null;
  owner_name: string;
  /** M7 boats: the engine's words for taking her ("take Mie Janssens's punt"), where she belongs, how to get in. */
  prompt: string;
  home: { x: number; z: number; yaw: number };
  board: "steps" | "ladder";
  rings: [[number, number], [number, number]] | null;
  /** The owner found her gone (a game minute), 0 if not. */
  missed: number;
  landing: [number, number];
  where: string;
  x: number;
  z: number;
  yaw: number;
  ridden: boolean;
  mine: boolean;
  lost: boolean;
}
export interface RowWorld {
  landings: Landing[];
  boats: LooseInfo[];
  hire: { landing: string; kind: Kind; minutes: number; time_left_min: number; late_c: number; left: { x: number; z: number; at: number } | null } | null;
  on: string | null;
  debt_c: number;
  notice: { n: number; text: string } | null;
  storm: boolean;
  fees: { hire_c: number; hours: number; late_c: number; left_fine_c: number };
}

/** Hull sizes and the rower's seat, from boats.glb (M7 boats: every small kind, shared/smallBoats.ts HULLS; the boat check compares them with the model). */
const HULL: Record<Kind, RowHull & (typeof HULLS)[Kind]> = HULLS;
/** M7 boats: each mooring by its boat's id (its ladder, its rings). */
const MOORING_OF = new Map<string, Mooring>(MOORINGS.map((m) => [m.id, m]));
/** M7 boats: the longest a mooring line may be (the boat check): a tide's rise and the way to the ring. */
const ROPE_MAX = 9;
/** A boat's name in the player's words (the rowing boat is "the boat"). */
const nounOf = (k: Kind) => (k === "rowboat" ? "boat" : HULLS[k].noun);
/** A seated rower's head over the waterline, and room to spare under a deck. */
const HEAD = 1.2;
const HEAD_ROOM = 0.25;
/** Oars: 2.7 m, 0.7 of it inboard; the blade 0.55 m long at the outer end. */
const OAR_IN = 0.7;
const OAR_OUT = 2.0;
const BLADE = 0.55;

async function net<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(method === "GET" ? 6000 : 15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A boat on the water that is not being rowed: at a berth, left lying, or drifting. */
interface Lying {
  key: string;
  kind: Kind;
  obj: THREE.Object3D;
  rect: Rect;
  x: number;
  z: number;
  yaw: number;
  /** Drifts with the current (left out on the river). */
  drift: boolean;
  /** Has drifted from where the server has it (keep it where it drifted to). */
  drifted?: boolean;
}

/** M6 transport: a family boat under way, rowed by its owner (game/journeys.ts). */
interface TownBoat {
  id: string;
  kind: Kind;
  obj: THREE.Object3D;
  oars: THREE.Group;
  people: Array<{ h: Human; g: THREE.Group; row: boolean }>;
  load: THREE.Mesh[];
  x: number;
  z: number;
  yaw: number;
  path: Array<[number, number]>;
  pi: number;
  phase: number;
  wait: number;
}
const TOWN_SACK = new THREE.IcosahedronGeometry(0.22, 0).scale(1.2, 0.75, 0.9);

/** Someone else's boat under way: river traffic, a tow in the lock, a canal boat. */
interface Vessel {
  obj: THREE.Object3D;
  name: BoatName;
  x: number;
  z: number;
  h: number;
  hl: number;
  hb: number;
  vx: number;
  vz: number;
}

export class Rowing {
  data: RowWorld | null = null;
  /** The boat being rowed: its model, what it is ("hire" or a loose boat's id), its kind. */
  private boat: { obj: THREE.Object3D; what: string; kind: Kind; oars: THREE.Group } | null = null;
  /** M8b multiplayer: the kind of boat Jef rows now (the others draw one of that kind under him), or null. */
  get rowedKind(): Kind | null {
    return this.boat?.kind ?? null;
  }
  /** Boats lying on the water, by key: "berth:<landing>", a loose boat's id, "mine" (the hired boat left out). */
  private lying = new Map<string, Lying>();
  private pool = Object.fromEntries(SMALL_KINDS.map((k) => [k, [] as THREE.Object3D[]])) as Record<Kind, THREE.Object3D[]>;
  /** M7 boats: the small boats at their moorings, drawn instanced (world/boats.ts fleetOf); a taken one is a copy (lying). */
  private fleet: SmallFleet | null = null;
  private fleetIdx = new Map<string, number>();
  private moorings: Moorings | null = null;
  /** The last grumble shown for each boat (the owner found her gone). */
  private grumbled = new Map<string, number>();
  private busy = false;
  private pollT = 0;
  private notice = -1;
  private hard = 0;
  private strokeT = 0;
  private warned = false;
  private requested = new Set<string>();
  private lockAsked = false;
  private prev = new Map<THREE.Object3D, [number, number, number]>();
  private sinking: Array<{ obj: THREE.Object3D; t: number; y0: number; roll: number }> = [];
  private splinters: THREE.InstancedMesh | null = null;
  private chips: Array<{ p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; t: number }> = [];
  private bumpAt = -9;
  private clock = 0;
  private mats: { shaft: THREE.Material; blade: THREE.Material; iron: THREE.Material } | null = null;
  /** The groups that hold boats under way (river traffic, the lock's tows, the canal boats), found once. */
  private groups: THREE.Object3D[] = [];
  /** How far each oar is shipped (laid in), port and starboard, 0..1. */
  private shipped = [0, 0];
  /** Dev: pretend the rower needs this much more head room (to see a bridge open for a boat). */
  devTall = 0;
  /** Sounds (main.ts): a job sound at a place, and an oar stroke. */
  sfx: (name: "thud_wood" | "thud_plank" | "thud_soft" | "splash", at?: THREE.Vector3) => void = () => {};
  stroke: () => void = () => {};
  /** Why the last break or bump happened (dev). */
  last: string = "";

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly deeds: Deeds,
  ) {
    player.rowFree = (x, z, r) => this.free(x, z, r);
    player.rowCurrent = (x, z) => this.current(x, z);
    player.onRowStroke = (hard) => {
      this.stroke();
      if (hard) this.hard++;
    };
    player.onRowBump = (speed) => {
      if (this.clock - this.bumpAt < 1) return;
      this.bumpAt = this.clock;
      this.sfx(speed > 1 ? "thud_wood" : "thud_soft", new THREE.Vector3(player.x, levelAt(player.x, player.z) + 0.4, player.z));
      this.jobs.say(speed > 1 ? "The boat knocks hard against it. No harm done, only your teeth." : "The boat bumps and comes off.");
    };
    jobs.extraActions.push((x, z) => this.keys(x, z));
    // 2026-09-29 (Steve: "we should also be able to jump in boats from the quay wall, now we just stop moving at
    // that place"): Space on the quay's edge over a small boat jumps down into her
    const prevJump = player.onJump; // (the others that use Space first: a rolling omnibus, game/ride.ts)
    player.onJump = () => {
      if (prevJump?.()) return true;
      const j = this.jumpable(player.x, player.z, -Math.sin(player.yaw), -Math.cos(player.yaw));
      if (!j) return false;
      void this.board(j.l, { step: true, jump: true });
      return true;
    };
    const marks = jobs.map.marks;
    jobs.map.marks = () => [...marks(), ...this.mapMarks()];
    void this.load();
  }

  get rowing(): boolean {
    return this.boat !== null && this.player.rowing;
  }

  /** M7 save and pause: the boat Jef sits in, for a save (put back by apply after a load). */
  snapshot(): { what: string; kind: Kind; x: number; z: number; yaw: number } | null {
    if (!this.boat || !this.player.rowing) return null;
    return { what: this.boat.what, kind: this.boat.kind, x: +this.player.x.toFixed(3), z: +this.player.z.toFixed(3), yaw: +this.player.rowHeading.toFixed(4) };
  }
  private rowBack = false;
  private rowTries = 0;

  // ------------------------------------------------------------------ the water

  /** Open water for the hull: the walk map's water, not the walls, piles, hulls, lying boats; the lock while its gates stand open; not under a bridge you do not fit under unless it is up. */
  private free(x: number, z: number, r: number): boolean {
    const lock = this.world.lock();
    const lw = this.world.lockWater;
    // M6 tides: each pair of gates on its own (the keeper levels the chamber between them)
    const open = (i: 0 | 1) => (lock?.gateOpen ? lock.gateOpen(i) : lock?.gatesOpen() ?? 0) > 0.95;
    // the lock, never across a shut pair; the open end of the ferry pontoon
    // (its keep-out for swimmers runs 2 m past the deck: a boat may come up to the end of the deck)
    const pass = (c: Rect) =>
      (c === lw && (Math.abs(z - 7) > 1.8 || open(0)) && (Math.abs(z - 42) > 1.8 || open(1))) || (c.minZ === -60 && c.maxZ === -2.5 && z < -58.2 && Math.abs(x + 249) < 3);
    if (!this.world.boatFree(x, z, r * 0.9, pass)) return false;
    // M6 tides: the canal and the vliet run nearly dry at low water: the boat takes the ground
    if (levelAt(x, z) - bedAt(x, z) < 0.35) return false;
    // a bridge you do not fit under: wait outside it until it stands open
    const br = this.world.bridges();
    if (br && !this.fits()) {
      for (const b of br.list) {
        const R = b.rect;
        if (x > R.minX - r && x < R.maxX + r && z > R.minZ - r && z < R.maxZ + r && b.open() < 0.97) return false;
      }
    }
    return true;
  }

  /** Do we fit under a shut deck (quay level, its underside DECK_UNDER below) with the swell as it is? */
  fits(): boolean {
    const swell = 0.22 * psxUniforms.uSea.value;
    // M6 tides: at high water you no longer fit under a bridge you pass under at low water
    return -DECK_UNDER > levelAt(this.player.x, this.player.z) + HEAD + HEAD_ROOM + swell + this.devTall;
  }

  /**
   * The tide on the Schelde (not in the canals, the vliet or the dock): along the river, ebb
   * toward +x (downstream, north) and flood back, with the rise and fall of the water (M6 tides,
   * world/tide.ts): strongest at half tide, slack at high and low water; slack near the walls;
   * stronger in a gale. At most about 0.2 m/s.
   */
  private current(x: number, z: number): [number, number] {
    if (z > -1 || (x > 100 && x < 120 && z > -6)) return [0, 0];
    const tide = THREE.MathUtils.clamp(-tideRate(this.jobs.day.dayNum, this.jobs.day.hourF) / 1.2, -1, 1);
    const sea = psxUniforms.uSea.value;
    const wall = Math.min(1, Math.max(0.3, -z / 12));
    return [0.16 * tide * wall * (sea > 2.5 ? 1.6 : 1), 0];
  }

  // ------------------------------------------------------------------ loading and syncing

  /** Bumped by every call that changes the boats: a poll sent before it is stale when it comes back. */
  private epoch = 0;

  async load(): Promise<void> {
    const e = this.epoch;
    try {
      const w = await net<RowWorld>("GET", "/api/row/world");
      if (e !== this.epoch || this.busy) return;
      this.apply(w);
    } catch (e) {
      console.warn("[rowing] the boats did not load", e);
    }
  }

  private apply(w: RowWorld): void {
    if (!w || !Array.isArray(w.landings) || !Array.isArray(w.boats)) return; // the server is restarting
    // (fix 2026-09-26: a boat of no known kind, e.g. a hire kept in an older save without its kind, made
    // objFor read this.pool[undefined] and rowing.update threw "reading 'pop'"; such a boat is a rowing boat)
    for (const L of w.landings) if (!isSmallKind(L.kind)) L.kind = "rowboat";
    for (const b of w.boats) if (!isSmallKind(b.kind)) b.kind = "rowboat";
    if (w.hire && !isSmallKind(w.hire.kind)) w.hire.kind = w.landings.find((l) => l.id === w.hire!.landing)?.kind ?? "rowboat";
    const first = this.data === null;
    this.data = w;
    if (w.notice && w.notice.n !== this.notice) {
      if (!first && this.notice >= 0) this.jobs.say(w.notice.text);
      this.notice = w.notice.n;
    } else if (first) this.notice = w.notice?.n ?? 0;
    // M7 save and pause: a loaded save had Jef in this boat: he sits in it again where he was
    const back = bootRestore()?.row;
    if (w.on && !this.boat && !this.busy && back && !this.rowBack && isSmallKind(back.kind)) {
      this.sitIn(null, w.on === "hire" ? "hire" : w.on, back.kind, back.x, back.z, back.yaw);
      if (this.boat) this.rowBack = true;
      else if (this.rowTries++ < 20) window.setTimeout(() => void this.load(), 1000); // the boats are not in yet
      this.syncLying();
      return;
    }
    // a reload while the server has us in a boat: we are not in it here, so out we got where it lies
    if (w.on && !this.boat && !this.busy) {
      // a hired boat goes back to its berth (we do not know where it was); a taken one stays where the server has it
      const at = w.on === "hire" ? w.hire?.left ?? w.landings.find((l) => l.id === w.hire?.landing) ?? null : w.boats.find((b) => b.id === w.on) ?? null;
      const spot = at ?? { x: this.player.x, z: this.player.z };
      void this.post("/api/row/leave", { x: spot.x, z: spot.z, yaw: 0 }).catch(() => {});
    }
    // the server took us out of the boat (the night, the police): step out where we are
    if (!w.on && this.boat && this.player.rowing && !this.busy) this.forceOut();
    this.syncLying();
    // M7 boats: an owner found his boat gone and grumbles, if Jef is near her mooring to hear it
    for (const b of w.boats) {
      if (!b.missed || this.grumbled.get(b.id) === b.missed) continue;
      this.grumbled.set(b.id, b.missed);
      if (first || !b.owner) continue;
      if (Math.hypot(this.player.x - b.home.x, this.player.z - b.home.z) < 45)
        this.jobs.say(`Someone on the quay ${b.where.replace(/^(by|at|in|under|before|along) the /, "by the ")} is shouting: "My ${nounOf(b.kind)}! Who has taken my ${nounOf(b.kind)}?"`);
    }
  }

  private objFor(kind: Kind): THREE.Object3D | null {
    const b = this.world.boats();
    if (!b) return null;
    if (!isSmallKind(kind)) return null; // (fix 2026-09-26: no pool, no model for it)
    const o = this.pool[kind].pop() ?? b.place(kind, 0, 0, 0, this.world.scene);
    o.visible = true;
    return o;
  }
  private drop(l: Lying): void {
    this.world.removeWaterSolid(l.rect);
    l.obj.visible = false;
    this.pool[l.kind].push(l.obj);
    this.lying.delete(l.key);
  }

  /** M7 boats: the small boats at their moorings, drawn instanced once the boats and the list are in. */
  private ensureFleet(w: RowWorld): void {
    const b = this.world.boats();
    if (this.fleet || !b) return;
    const list = w.boats.map((q) => ({ name: q.kind as BoatName, x: q.home.x, z: q.home.z, yaw: q.home.yaw, floor: floorOf(q.kind, q.home.x, q.home.z, q.home.yaw) }));
    this.fleet = b.fleetOf(this.world.scene, list);
    w.boats.forEach((q, i) => this.fleetIdx.set(q.id, i));
    // every boat at her mooring is a solid for the other boats and for swimmers
    for (const q of w.boats) {
      const r = this.rectOf(q.home.x, q.home.z, q.home.yaw, q.kind);
      this.homeRects.set(q.id, r);
      this.world.addWaterSolid(r);
    }
    this.homeSolid = new Set(w.boats.map((q) => q.id));
    this.moorings = new Moorings(this.world.scene);
    const rings: Array<[number, number, number]> = [];
    for (const q of w.boats) for (const r of q.rings ?? []) rings.push([r[0], r[1], this.world.baseAt(r[0], r[1])]);
    this.moorings.setRings(rings, this.world.mats.iron);
    // the families who live aboard a few of the barges (the moored rows are in by now)
    this.life = new LifeAboard(this.world.scene, b);
  }
  /** M7 boats: the families aboard the barges. */
  life: LifeAboard | null = null;
  /** Boats whose mooring counts as a solid now (she lies there). */
  private homeSolid = new Set<string>();
  private homeRects = new Map<string, Rect>();
  /** Show her at her mooring (instanced) or not; her mooring is a solid only while she lies there. */
  private atHome(b: LooseInfo, home: boolean): void {
    const i = this.fleetIdx.get(b.id);
    if (i === undefined || !this.fleet) return;
    this.fleet.hide(i, !home);
    let r = this.homeRects.get(b.id);
    if (!r) this.homeRects.set(b.id, (r = this.rectOf(b.home.x, b.home.z, b.home.yaw, b.kind)));
    if (home && !this.homeSolid.has(b.id)) {
      this.world.addWaterSolid(r);
      this.homeSolid.add(b.id);
    } else if (!home && this.homeSolid.has(b.id)) {
      this.world.removeWaterSolid(r);
      this.homeSolid.delete(b.id);
    }
  }
  private rectOf(x: number, z: number, yaw: number, kind: Kind): Rect {
    const hl = HULL[kind].len * 0.47;
    const hb = HULL[kind].beam + 0.05;
    const s = Math.abs(Math.sin(yaw));
    const c = Math.abs(Math.cos(yaw));
    return { minX: x - s * hl - c * hb, maxX: x + s * hl + c * hb, minZ: z - c * hl - s * hb, maxZ: z + c * hl + s * hb };
  }
  private lay(key: string, kind: Kind, x: number, z: number, yaw: number, drift = false, obj?: THREE.Object3D): Lying | null {
    let l = this.lying.get(key);
    if (l && l.kind !== kind) {
      this.drop(l);
      l = undefined;
    }
    if (!l) {
      const o = obj ?? this.objFor(kind);
      if (!o) return null;
      l = { key, kind, obj: o, rect: this.rectOf(x, z, yaw, kind), x, z, yaw, drift };
      this.world.addWaterSolid(l.rect);
      this.lying.set(key, l);
    }
    l.drift = drift;
    if (Math.hypot(l.x - x, l.z - z) > 0.05 || Math.abs(l.yaw - yaw) > 0.01 || obj) {
      l.x = x;
      l.z = z;
      l.yaw = yaw;
      Object.assign(l.rect, this.rectOf(x, z, yaw, kind));
    }
    l.obj.position.set(l.x, levelAt(l.x, l.z), l.z);
    l.obj.rotation.set(0, l.yaw, 0);
    // M7 boats: she takes the mud where she lies (world/boats.ts reads the floor), her oars laid in
    l.obj.userData.floor = floorOf(kind, l.x, l.z, l.yaw);
    this.world.boats()?.stowed(l.obj, true);
    return l;
  }

  /** The boats lying about, as the server has them (the one being rowed is ours). */
  private syncLying(): void {
    const w = this.data;
    if (!w || !this.world.boats()) return;
    const want = new Set<string>();
    const px = this.player.x;
    const pz = this.player.z;
    for (const L of w.landings) {
      const key = `berth:${L.id}`;
      const had = this.lying.get(key);
      // a new boat at a berth only when nobody is near to see it come (at the start of the game: all there)
      if (!had && this.synced && Math.hypot(px - L.x, pz - L.z) < 40 && !this.fresh.has(key)) continue;
      this.fresh.delete(key);
      want.add(key);
      // a boat of another kind brought back here: it lies there till nobody sees the waterman swap it
      if (had && had.kind !== L.kind && Math.hypot(px - L.x, pz - L.z) < 40) continue;
      this.lay(key, L.kind, L.x, L.z, L.yaw);
    }
    this.ensureFleet(w);
    for (const b of w.boats) {
      const riding = !!(this.boat && this.boat.what === b.id) || this.climbing === b.id;
      const had = this.lying.get(b.id);
      const home = !b.lost && !riding && !this.townAway.has(b.id) && Math.hypot(b.x - b.home.x, b.z - b.home.z) < 0.05 && !(had?.drifted && b.mine);
      // M7 boats: at her mooring she is one of the instanced boats; anywhere else a copy of her own
      this.atHome(b, home && !!this.fleet);
      if (home && this.fleet) continue;
      if (b.lost || riding) continue;
      // M6 transport: its owners are out in it (a family errand): it lies at no berth now
      if (this.townAway.has(b.id)) continue;
      want.add(b.id);
      // one we left drifting: keep where it drifted to, unless the server moved it (home again)
      if (had?.drifted && b.mine) continue;
      this.lay(b.id, b.kind, b.x, b.z, b.yaw, b.mine && b.z < -1);
    }
    if (w.hire?.left && !(this.boat?.what === "hire")) {
      want.add("mine");
      const had = this.lying.get("mine");
      if (!had) this.lay("mine", w.hire.kind, w.hire.left.x, w.hire.left.z, 0, w.hire.left.z < -1);
    }
    this.synced = true;
    for (const l of [...this.lying.values()]) {
      if (want.has(l.key)) continue;
      // the boy took it home: gone once you are not looking at it
      if (l.key === "mine" && Math.hypot(px - l.x, pz - l.z) < 25) continue;
      this.drop(l);
    }
  }
  /** Berths whose boat may come back while you stand there (you just brought one). */
  private fresh = new Set<string>();
  private synced = false;
  private syncT = 0;

  // ------------------------------------------------------------------ keys

  private keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]> } {
    const w = this.data;
    if (!w) return {};
    if (this.boat) {
      if (!this.player.rowing) return { only: [] };
      if (this.busy) return { only: [] };
      return { only: [this.outAction()] };
    }
    if (this.busy || this.player.riding || this.player.climbing || this.player.bikeRiding) return {};
    const options: Array<[number, Action]> = [];
    // in the water: back into a boat of yours
    if (this.player.swimming) {
      if (this.world.exitNear(x, z, 1.2)) return {};
      for (const l of this.lying.values()) {
        const mine = l.key === "mine" || w.boats.some((b) => b.id === l.key && b.mine);
        if (!mine) continue;
        const d = this.distToHull(l, x, z);
        if (d < 1.4) options.push([d, { key: "KeyE", text: "climb into the boat", run: () => void this.board(l), at: this.hullAt(l) }]);
      }
      return { options };
    }
    // on a landing, a pontoon, the foot of a ladder: by the water (M6 tides: at low water the
    // boat lies below the landing and you climb down into it; at high water the landing is under
    // water and you stand on the steps above it)
    // (M7 boats: high over the water, only the ladder down to a boat at its foot)
    const high = this.player.y > levelAt(x, z) + 3.2;
    for (const L of high ? [] : w.landings) {
      const l = this.lying.get(`berth:${L.id}`);
      const d = Math.hypot(L.landing[0] - x, L.landing[1] - z);
      const flooded = levelAt(L.x, L.z) > WATER_Y + 0.4 + 0.3;
      if (!l || d > (flooded ? 4.8 : 2.4)) continue;
      const what = L.kind === "punt" ? "a punt" : "a rowing boat";
      const debt = w.debt_c ? `, and the ${w.debt_c} c you owe` : "";
      options.push([d, { key: "KeyE", text: w.hire ? `hire ${what} (you have one out already)` : `hire ${what} from ${L.waterman} (${w.fees.hire_c} c${debt})`, run: () => void this.hire(L), at: this.hullAt(l) }]);
    }
    const mine = high ? undefined : this.lying.get("mine");
    if (mine && this.distToHull(mine, x, z) <= 2.0) options.push([this.distToHull(mine, x, z), { key: "KeyE", text: "get back into your boat", run: () => void this.board(mine), at: this.hullAt(mine) }]);
    // M7 boats: every small boat, at her mooring or lying where she was left: from the steps or a landing,
    // down the ladder at her thwart, or straight off the quay when the water is high enough to step down
    const quayTop = this.world.baseAt(x, z);
    const onQuay = quayTop > -0.6 && this.player.y > quayTop - 0.3 && !this.world.isWater(x, z);
    for (const b of w.boats) {
      if (b.lost || this.townAway.has(b.id) || b.ridden) continue;
      const l = this.lying.get(b.id) ?? this.homeLying(b);
      const text = b.mine ? `get into the ${nounOf(b.kind)}` : b.prompt;
      const d = this.distToHull(l, x, z);
      const m = MOORING_OF.get(b.id);
      const home = !this.lying.has(b.id);
      // down the ladder: standing at its head on the quay, she lies at its foot
      if (home && m && m.board.kind === "ladder" && onQuay) {
        const dl = Math.hypot(x - m.board.top[0], z - m.board.top[1]);
        if (dl <= 1.4) {
          options.push([dl * 0.5, { key: "KeyE", text, run: () => void this.board(l, { ladder: m.board as Extract<Mooring["board"], { kind: "ladder" }> }), at: this.hullAt(l) }]);
          continue;
        }
      }
      if (high) continue;
      if (onQuay) {
        // off the quay's edge: only when her gunwale is no more than a long step down
        const drop = this.world.baseAt(x, z) - (levelAt(l.x, l.z) + HULLS[b.kind].bow[1] - 0.1);
        if (drop <= 1.3 && d <= 1.3) options.push([d, { key: "KeyE", text, run: () => void this.board(l, { step: true }), at: this.hullAt(l) }]);
        // deeper down (low water): a jump, E or Space
        else if (drop <= 3.6 && d <= 2.2) options.push([d, { key: "KeyE", text: `${text}: jump down (E or Space)`, run: () => void this.board(l, { step: true, jump: true }), at: this.hullAt(l) }]);
        continue;
      }
      if (d > 2.0) continue;
      options.push([d, { key: "KeyE", text, run: () => void this.board(l), at: this.hullAt(l) }]);
    }
    return { options };
  }

  /**
   * A small boat below the quay's edge he could jump down into (at most 3.6 m down, her hull within
   * 2.2 m and before him when (fx, fz) is given): not his to keep, only a way in (the engine judges the taking).
   */
  private jumpable(x: number, z: number, fx = 0, fz = 0): { l: Lying; b: LooseInfo } | null {
    const w = this.data;
    if (!w || this.boat || this.busy || this.player.swimming || this.player.riding || this.player.climbing || this.player.bikeRiding) return null;
    if (this.jobs.goods.carried || this.player.laden) return null;
    const quayTop = this.world.baseAt(x, z);
    if (!(quayTop > -0.6 && this.player.y > quayTop - 0.3 && !this.world.isWater(x, z))) return null;
    let best: { l: Lying; b: LooseInfo; d: number } | null = null;
    for (const b of w.boats) {
      if (b.lost || this.townAway.has(b.id) || b.ridden) continue;
      const l = this.lying.get(b.id) ?? this.homeLying(b);
      const d = this.distToHull(l, x, z);
      if (d > 2.2) continue;
      const drop = quayTop - (levelAt(l.x, l.z) + HULLS[b.kind].bow[1] - 0.1);
      if (drop > 3.6) continue;
      if (fx || fz) {
        const dx = l.x - x;
        const dz = l.z - z;
        const n = Math.hypot(dx, dz) || 1;
        if ((dx * fx + dz * fz) / n < 0.2) continue;
      }
      if (!best || d < best.d) best = { l, b, d };
    }
    return best;
  }

  /** A boat at her mooring as a Lying (for the prompt's look and the way in): she is instanced, not a copy. */
  private homeLying(b: LooseInfo): Lying {
    return { key: b.id, kind: b.kind, obj: null as unknown as THREE.Object3D, rect: this.rectOf(b.home.x, b.home.z, b.home.yaw, b.kind), x: b.home.x, z: b.home.z, yaw: b.home.yaw, drift: false };
  }

  /** The point along a lying boat nearest the crosshair (bow, middle, stern), for looking at it (game/facing.ts). */
  private hullAt(l: Lying): Target {
    const fx = Math.sin(l.yaw);
    const fz = Math.cos(l.yaw);
    const h = HULL[l.kind].half * 0.8;
    return nearestAim([-h, -h / 2, 0, h / 2, h].map((t) => ({ x: l.x + fx * t, z: l.z + fz * t })));
  }

  private distToHull(l: Lying, x: number, z: number): number {
    const fx = Math.sin(l.yaw);
    const fz = Math.cos(l.yaw);
    const dx = x - l.x;
    const dz = z - l.z;
    const along = Math.max(-HULL[l.kind].half, Math.min(HULL[l.kind].half, dx * fx + dz * fz));
    return Math.max(0, Math.hypot(dx - fx * along, dz - fz * along) - HULL[l.kind].beam);
  }

  /** How the rower gets out here: steps, a ladder, a low deck, else over the side. */
  private exitHere(): { exit: Exit | null; text: string } {
    const p = this.player;
    const [sx, sz] = p.rowSeat();
    const e = this.world.exitNear(sx, sz, 2.3) ?? this.world.exitNear(p.x, p.z, 2.0);
    const w = this.data;
    const atLanding = w?.hire && this.boat?.what === "hire" ? w.landings.find((L) => Math.hypot(L.x - p.x, L.z - p.z) < 9) : undefined;
    if (e) {
      if (atLanding) return { exit: e, text: `give the boat back to ${atLanding.waterman} and step out` };
      return { exit: e, text: e.kind === "ladder" ? "climb out up the ladder" : "step out onto the steps" };
    }
    // at a hire landing, but his other boat lies alongside: he takes your line and hands you out onto the steps
    if (atLanding) {
      const le = this.world.exitNear(atLanding.landing[0], atLanding.landing[1], 3);
      if (le) return { exit: le, text: `throw ${atLanding.waterman} your line and give the boat back` };
    }
    // a low deck within reach from the side of the boat: the ferry pontoon, the pier's foot
    const h = p.rowHeading;
    const bow = HULL[this.boat?.kind ?? "rowboat"].half - HULL[this.boat?.kind ?? "rowboat"].seatZ;
    // beside the seat, and over the bow (you can climb forward over the thwarts)
    const probes: Array<[number, number, number]> = [];
    for (const off of [0, 0.8, -0.8, 1.6]) for (const side of [1, -1]) for (const out of [1.3, 1.8]) probes.push([off, side, out]);
    for (const off of [bow + 0.5, bow + 1.1, bow + 1.7]) probes.push([off, 1, 0]);
    for (const [off, side, out] of probes) {
      {
          const ax = sx + Math.sin(h) * off + Math.cos(h) * out * side;
          const az = sz + Math.cos(h) * off - Math.sin(h) * out * side;
          if (this.world.isWater(ax, az)) continue;
          const y = this.world.baseAt(ax, az);
          const lv = levelAt(ax, az);
          if (y < lv + 0.1 || y > lv + 2.0) continue; // the ferry pontoon lies 1.8 m over the water; the brig's deck (2.4) is too high
          if (!this.world.isFree(ax, az, 0.3, y)) continue;
          const g = out ? 0.9 : -0.6;
          const gx = sx + Math.sin(h) * (out ? off : off + g) + Math.cos(h) * 0.9 * side * (out ? 1 : 0);
          const gz = sz + Math.cos(h) * (out ? off : off + g) - Math.sin(h) * 0.9 * side * (out ? 1 : 0);
          return { exit: { kind: "landing", gx, gz, nx: 0, nz: 0, tx: ax, tz: az, ty: y }, text: "step out onto the pontoon" };
      }
    }
    return { exit: null, text: "go over the side into the water" };
  }

  private outAction(): Action {
    const { exit, text } = this.exitHere();
    return { key: "KeyE", text, run: () => void this.getOut(exit), self: true };
  }

  // ------------------------------------------------------------------ in and out

  /** Dev: what happened lately (calls, forced outs). */
  trace: string[] = [];
  private note(s: string): void {
    this.trace.push(`${this.clock.toFixed(1)} ${s}`);
    if (this.trace.length > 40) this.trace.shift();
  }

  private post<T>(url: string, body: unknown): Promise<T> {
    this.note(`POST ${url} ${JSON.stringify(body).slice(0, 80)}`);
    this.epoch++;
    return net<T>("POST", url, body).finally(() => this.epoch++);
  }

  private async hire(L: Landing): Promise<void> {
    if (this.busy) return;
    if (this.jobs.goods.carried || this.player.laden) {
      this.jobs.say(`${L.waterman} shakes his head. "Put that down first. No cargo in my boats."`);
      return;
    }
    this.busy = true;
    try {
      const r = await this.post<JobsPayload & { text: string; row: RowWorld }>("/api/row/hire", { landing: L.id, x: +this.player.x.toFixed(2), z: +this.player.z.toFixed(2) });
      this.jobs.refresh(r);
      const l = this.lying.get(`berth:${L.id}`);
      this.sitIn(l ?? null, "hire", L.kind, L.x, L.z, L.yaw);
      this.data = r.row;
      this.jobs.say(`${r.text} W to pull, S to back water, A and D to turn, Shift to pull hard, E to get out.`);
      this.stormWarning();
    } catch (e) {
      this.jobs.say(`${cap((e as Error).message)}.`);
    } finally {
      this.busy = false;
    }
  }

  /** M7 boats: the boat Jef is climbing down into now (not drawn at her mooring meanwhile). */
  private climbing: string | null = null;

  /**
   * Into a boat: your own (left out, or taken before), someone else's (the engine judges it: M3h
   * deeds, M7 boats), or one nobody owns. M7 boats: down the ladder at her thwart, or a step down off
   * the quay at high water; the owner who saw it answers (world: game/deeds.ts react).
   */
  private async board(l: Lying, via: { ladder?: Extract<Mooring["board"], { kind: "ladder" }>; step?: boolean; jump?: boolean } = {}): Promise<void> {
    if (this.busy) return;
    if (this.jobs.goods.carried || this.player.laden) {
      this.jobs.say("Not with that in your arms.");
      return;
    }
    this.busy = true;
    const { x, z } = this.player;
    try {
      if (l.key === "mine") {
        const r = await this.post<{ text: string; row: RowWorld }>("/api/row/board", { x: +l.x.toFixed(2), z: +l.z.toFixed(2) });
        this.data = r.row;
        this.sitIn(l, "hire", l.kind, l.x, l.z, l.yaw);
        this.jobs.say(r.text);
      } else {
        const r = await this.post<JobsPayload & { deed: number | null; again: boolean; text: string; reaction: { who: string; name: string; kind: "shout" | "chase" | "ask"; line: string } | null }>("/api/deed", {
          ref: l.key,
          x: +x.toFixed(2),
          z: +z.toFixed(2),
          witnesses: this.deeds.witnesses(x, z),
          crouch: this.player.crouching,
          lantern: this.deeds.lantern.lit,
        });
        this.jobs.refresh(r);
        const say = () => {
          this.jobs.say(r.again ? "You get back into the boat." : r.reaction?.line ?? r.text);
          this.stormWarning();
        };
        if (r.reaction) {
          this.sfx("thud_soft");
          // the owner who saw it shouts, runs for the quay or comes to ask for her back (game/deeds.ts)
          this.deeds.react(r as unknown as Parameters<Deeds["react"]>[0]);
        }
        // a boat at her mooring is instanced: she becomes a copy of her own now
        const lay = l.obj ? l : this.lay(l.key, l.kind, l.x, l.z, l.yaw);
        if (!lay) return;
        if (via.ladder || via.step) {
          // busy till she is under him: the poll must not think he is out of her meanwhile
          this.climbInto(lay, via, () => {
            this.climbing = null;
            this.busy = false;
            this.sitIn(lay, l.key, l.kind, lay.x, lay.z, lay.yaw);
            say();
          });
          this.climbing = l.key;
          const b = this.data?.boats.find((q) => q.id === l.key);
          if (b) this.atHome(b, false);
        } else {
          this.sitIn(lay, l.key, l.kind, lay.x, lay.z, lay.yaw);
          say();
        }
      }
    } catch (e) {
      this.jobs.say(`${cap((e as Error).message)}.`);
    } finally {
      if (!this.climbing) this.busy = false;
      void this.load();
    }
  }

  /** M7 boats: climb down the ladder (or step down off the quay) to her thwart, then `then`. */
  private climbInto(l: Lying, via: { ladder?: Extract<Mooring["board"], { kind: "ladder" }>; jump?: boolean }, then: () => void): void {
    const p = this.player;
    const h = HULL[l.kind];
    const lv = levelAt(l.x, l.z);
    const seat: [number, number] = [l.x + Math.sin(l.yaw) * h.seatZ, l.z + Math.cos(l.yaw) * h.seatZ];
    const top = this.world.baseAt(p.x, p.z);
    const keys: Array<[number, number, number, number]> = [];
    if (via.ladder) {
      const [tx, tz] = via.ladder.top;
      const [nx, nz] = via.ladder.n;
      // to the ladder's head, over the edge, down the rungs (0.5 m a second), and onto the thwart
      const lx = tx + nx * 0.25;
      const lz = tz + nz * 0.25;
      const foot = lv + h.seatY + 0.35;
      keys.push([tx - nx * 0.2, top, tz - nz * 0.2, 0.35]);
      keys.push([lx, top - 0.3, lz, 0.5]);
      keys.push([lx, foot, lz, Math.max(0.4, (top - 0.3 - foot) / 1.6)]);
    } else if (via.jump) {
      // a hop off the edge, out over the gunwale, and down as a fall takes (t = sqrt(2h / g)), knees bent
      const land = lv + h.seatY - 0.2;
      keys.push([p.x + (seat[0] - p.x) * 0.35, top + 0.35, p.z + (seat[1] - p.z) * 0.35, 0.22]);
      keys.push([seat[0], land, seat[1], Math.max(0.3, Math.sqrt((2 * Math.max(0.3, top + 0.35 - land)) / 9.81))]);
      p.climbTo(keys, () => {
        this.sfx("thud_wood", new THREE.Vector3(seat[0], lv + 0.3, seat[1]));
        then();
      });
      return;
    } else keys.push([p.x + (seat[0] - p.x) * 0.5, top - 0.2, p.z + (seat[1] - p.z) * 0.5, 0.45]);
    keys.push([seat[0], lv + h.seatY - 0.2, seat[1], 0.45]);
    p.climbTo(keys, then);
  }

  private sitIn(l: Lying | null, what: string, kind: Kind, x: number, z: number, yaw: number): void {
    let obj: THREE.Object3D | null;
    if (l) {
      this.world.removeWaterSolid(l.rect);
      this.lying.delete(l.key);
      obj = l.obj;
      x = l.x;
      z = l.z;
      yaw = l.yaw;
    } else obj = this.objFor(kind);
    if (!obj) return;
    this.world.boats()?.stowed(obj, false);
    this.boat = { obj, what, kind, oars: this.oarsFor(obj, kind) };
    this.player.rowStart(x, z, yaw, HULL[kind]);
    this.warned = false;
    this.last = "";
  }

  private async getOut(exit: Exit | null): Promise<void> {
    const b = this.boat;
    if (!b || this.busy) return;
    if (!exit && !this.world.nearestSwim(...this.player.rowSeat(), 0.32)) {
      this.jobs.say("Not here: there is no room in the water to go over the side. Row out into open water first.");
      return;
    }
    this.busy = true;
    const p = this.player;
    const at = { x: p.x, z: p.z, yaw: p.rowHeading };
    if (exit) p.rowStepOut(exit);
    else p.rowOverboard();
    this.releaseAll();
    this.boat = null;
    b.oars.visible = false;
    // the boat stays where it is (at a hire landing the waterman ties it up)
    const L = b.what === "hire" && exit ? this.data?.landings.find((q) => Math.hypot(q.x - at.x, q.z - at.z) < 9) : undefined;
    const key = b.what === "hire" ? (L ? `berth:${L.id}` : "mine") : b.what;
    if (L) {
      const old = this.lying.get(key);
      if (old) this.drop(old);
      this.lay(key, b.kind, L.x, L.z, L.yaw, false, b.obj);
      this.fresh.add(key);
    } else this.lay(key, b.kind, at.x, at.z, at.yaw, at.z < -1, b.obj);
    try {
      const r = await this.post<JobsPayload & { text: string; returned: boolean; row: RowWorld }>("/api/row/leave", { x: +at.x.toFixed(2), z: +at.z.toFixed(2), yaw: +at.yaw.toFixed(3), ashore: !!exit });
      this.jobs.refresh(r);
      this.data = r.row;
      // M7 boats: tied up at her own mooring: she lies there again (the server has her home)
      if (r.returned && b.what !== "hire") this.syncLying();
      if (r.text) this.jobs.say(r.text);
      else if (b.what === "hire" && !L) this.jobs.say(exit ? "You leave the boat tied here. The waterman will not like it." : "You go over the side. The water is ice cold. The boat drifts on without you.");
      else if (!exit) this.jobs.say("You go over the side into the cold water.");
    } catch (e) {
      console.warn("[rowing] leave", e);
    } finally {
      this.busy = false;
    }
  }

  /** The server says we are out of the boat (the night; the police sent it home). */
  private forceOut(): void {
    this.note("forceOut");
    const e = this.world.exitNear(...this.player.rowSeat(), 3);
    const b = this.boat!;
    if (e) this.player.rowStepOut(e);
    else {
      // the nearest flight of steps
      const f = this.world.quayInfo().flights.map((q) => ({ q, d: Math.hypot(q.top[0] - this.player.x, q.top[1] - this.player.z) })).sort((a, b2) => a.d - b2.d)[0];
      if (f) this.player.place(f.q.top[0], f.q.top[1], this.player.yaw);
      else this.player.rowOverboard();
    }
    this.releaseAll();
    b.oars.visible = false;
    b.obj.visible = false;
    this.world.boats()?.stowed(b.obj, true);
    this.pool[b.kind].push(b.obj);
    this.boat = null;
  }

  private stormWarning(): void {
    if (this.warned || psxUniforms.uSea.value <= 2.5) return;
    this.warned = true;
    // the words follow the real water (QA 2026-09-24: "running high" was said at low water)
    const fromMid = water.river - MID_Y;
    const tide = fromMid > 0.8 ? "The river is running high" : fromMid < -0.8 ? "The tide is out, the mud shows at the foot of the walls," : "The river is choppy";
    this.jobs.say(`${tide} and the wind is up. Keep close under the quay, and keep out of the fairway.`);
  }

  // ------------------------------------------------------------------ breaking

  /** The boat is smashed: a ship ran it down, or a bridge came down on it. Into the water; the server prices it. */
  private async wreck(cause: "ship" | "bridge"): Promise<void> {
    const b = this.boat;
    if (!b || this.busy) return;
    this.busy = true;
    this.last = cause;
    const at = new THREE.Vector3(this.player.x, this.player.rowY + 0.3, this.player.z);
    this.sfx("thud_wood", at);
    this.sfx("thud_plank", at);
    window.setTimeout(() => this.sfx("thud_wood", at), 120);
    this.splinter(at);
    this.releaseAll();
    this.boat = null;
    b.oars.visible = false;
    // the water comes in over the gunwale: no more lid over the hull, it settles and goes down
    b.obj.traverse((o) => {
      if (o.name.endsWith("_cap")) o.visible = false;
    });
    this.sinking.push({ obj: b.obj, t: 0, y0: this.player.rowY, roll: (Math.random() < 0.5 ? -1 : 1) * 0.6 });
    this.player.rowOverboard();
    this.jobs.say(cause === "ship" ? "The bow comes out of the fog right over you. Wood cracks, the boat breaks under you, and you are in the water." : "The boat jams under the bridge. Wood cracks and splits, and you are in the water.");
    try {
      const r = await this.post<JobsPayload & { text: string; row: RowWorld }>("/api/row/lost", { cause });
      this.jobs.refresh(r);
      this.data = r.row;
      window.setTimeout(() => this.jobs.say(r.text), 3500);
    } catch (e) {
      console.warn("[rowing] lost", e);
    } finally {
      this.busy = false;
    }
  }

  private splinter(at: THREE.Vector3): void {
    if (!this.splinters) {
      const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.55, 0.05, 0.13), this.world.mats.planks, 28);
      m.frustumCulled = false;
      this.world.scene.add(m);
      this.splinters = m;
    }
    this.chips = [];
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 0.6 + Math.random() * 2.2;
      this.chips.push({
        p: at.clone(),
        v: new THREE.Vector3(Math.cos(a) * s, 1.2 + Math.random() * 2.5, Math.sin(a) * s),
        r: new THREE.Euler(Math.random() * 3, Math.random() * 3, Math.random() * 3),
        t: 0,
      });
    }
    this.splinters.visible = true;
  }

  // ------------------------------------------------------------------ other boats under way

  private vessels(): Vessel[] {
    const b = this.world.boats();
    if (!b) return [];
    const out: Vessel[] = [];
    const fresh = (o: THREE.Object3D) => {
      const q = this.prev.get(o);
      return q && this.clock - q[2] < 0.25 ? q : null;
    };
    const names = new Set<string>(BOAT_NAMES);
    if (this.groups.length < 3) this.groups = ["river_traffic", "lock", "opening_bridges"].map((n) => this.world.scene.getObjectByName(n)).filter((g): g is THREE.Object3D => !!g);
    for (const g of this.groups) {
      if (!g || !g.visible) continue;
      for (const o of g.children) {
        if (!o.visible || !names.has(o.name) || o.name === "portal_crane" || o.name === "hand_crane") continue;
        const d = b.dims(o.name as BoatName);
        const sc = o.scale.z || 1;
        const pv = fresh(o);
        const x = o.position.x;
        const z = o.position.z;
        out.push({ obj: o, name: o.name as BoatName, x, z, h: o.rotation.y, hl: d.length * 0.45 * sc, hb: (d.beam / 2) * sc, vx: pv ? x - pv[0] : 0, vz: pv ? z - pv[1] : 0 });
      }
    }
    return out;
  }

  /** Other boats: a big one under way that runs into you breaks the boat; else a bump, and it pushes you aside. */
  private meetVessels(dt: number): void {
    const p = this.player;
    const hull = HULL[this.boat!.kind];
    const fx = Math.sin(p.rowHeading);
    const fz = Math.cos(p.rowHeading);
    const pts: Array<[number, number]> = [-1, 0, 1].map((k) => [p.x + fx * (hull.half - 0.5) * k, p.z + fz * (hull.half - 0.5) * k]);
    for (const v of this.vessels()) {
      this.prev.set(v.obj, [v.x, v.z, this.clock]);
      if (Math.hypot(v.x - p.x, v.z - p.z) > v.hl + 8) continue;
      const sx = Math.sin(v.h);
      const sz = Math.cos(v.h);
      for (const [px, pz] of pts) {
        const dx = px - v.x;
        const dz = pz - v.z;
        const along = dx * sx + dz * sz;
        const across = dx * sz - dz * sx;
        const r = hull.beam;
        if (Math.abs(along) > v.hl + r * 0.5 || Math.abs(across) > v.hb + r) continue;
        const speed = Math.hypot(v.vx, v.vz) / Math.max(dt, 1e-4);
        const big = v.hb > 0.9; // wider than a rowing boat or a punt
        const coming = v.vx * (p.x - v.x) + v.vz * (p.z - v.z) > 0;
        if (big && speed > 0.3 && coming) {
          void this.wreck("ship");
          return;
        }
        // a bump: off its side, carried a little its way
        const push = v.hb + r - Math.abs(across) + 0.05;
        const sgn = across >= 0 ? 1 : -1;
        p.x += sz * push * sgn + v.vx;
        p.z += -sx * push * sgn + v.vz;
        p.rowSpeed *= -0.3;
        p.onRowBump?.(Math.max(0.5, speed + Math.abs(p.rowSpeed)));
        this.last = `bump ${v.name}`;
        return;
      }
    }
  }

  // ------------------------------------------------------------------ bridges and the lock

  private releaseAll(): void {
    const br = this.world.bridges();
    for (const k of this.requested) br?.request(k, "rower", false);
    this.requested.clear();
    if (this.lockAsked) this.world.lock()?.request?.(false);
    this.lockAsked = false;
  }

  /** Ask the bridges we do not fit under to open as we come near, and the lock when we come to it. Break if a deck is on us. */
  private bridgesAndLock(): void {
    const p = this.player;
    const br = this.world.bridges();
    const hull = HULL[this.boat!.kind];
    const fx = Math.sin(p.rowHeading);
    const fz = Math.cos(p.rowHeading);
    if (br) {
      // a deck lower than the boat and the rower's head, over any part of the boat: it breaks
      const [sx, sz] = p.rowSeat();
      for (const [x, z, top] of [
        [sx, sz, HEAD + this.devTall],
        [p.x + fx * hull.half * 0.8, p.z + fz * hull.half * 0.8, 0.7],
        [p.x - fx * hull.half * 0.8, p.z - fz * hull.half * 0.8, 0.7],
      ]) {
        const u = br.undersideAt(x, z);
        if (u !== null && u < p.rowY + top) {
          void this.wreck("bridge");
          return;
        }
      }
      if (!this.fits()) {
        for (const b of br.list) {
          const R = b.rect;
          const dx = Math.max(R.minX - p.x, 0, p.x - R.maxX);
          const dz = Math.max(R.minZ - p.z, 0, p.z - R.maxZ);
          const near = Math.hypot(dx, dz) < 22;
          if (near && !this.requested.has(b.key)) {
            br.request(b.key, "rower", true);
            this.requested.add(b.key);
            this.jobs.say(b.key === "lock_bridge" ? "You hail the lock-keeper." : "You hail the bridge-keeper: too low to pass under. He starts to wind it up.");
          } else if (!near && this.requested.has(b.key) && Math.hypot(dx, dz) > 28) {
            br.request(b.key, "rower", false);
            this.requested.delete(b.key);
          }
        }
      }
    }
    // the lock: the gates must open for a boat to pass (both pairs, as for a tow)
    const lock = this.world.lock();
    if (lock?.request) {
      const inZone = p.x > 96 && p.x < 124 && p.z > -26 && p.z < 70;
      if (inZone && !this.lockAsked) {
        lock.request(true, () => ({ x: this.player.x, z: this.player.z }));
        this.lockAsked = true;
        // M6 tides: the dock stays near high water; at other times the keeper levels the chamber
        if (Math.abs(water.river - water.dock) > 0.3)
          this.jobs.say(
            `You hail the lock-keeper. The bridge goes up. The river stands ${Math.abs(water.river - water.dock).toFixed(1)} m ${water.river < water.dock ? "below" : "above"} the dock: he shuts the far gates and lets the water ${p.z < 7 === water.river < water.dock ? "out" : "in"} till the lock is at your level. Wait for the near gates.`,
          );
        else if (lock.gatesOpen() < 0.95) this.jobs.say("You hail the lock-keeper. The bridge goes up, then the gates open. Wait for them.");
      } else if (!inZone && this.lockAsked) {
        lock.request(false);
        this.lockAsked = false;
      }
    }
  }

  // ------------------------------------------------------------------ the oars

  private oarsFor(boatObj: THREE.Object3D, kind: Kind): THREE.Group {
    if (!this.mats) {
      this.mats = {
        shaft: psx(new THREE.MeshLambertMaterial({ color: 0x8a7050 })),
        blade: this.world.mats.darkWood,
        iron: this.world.mats.iron,
      };
    }
    let g = boatObj.getObjectByName("row_oars") as THREE.Group | undefined;
    if (!g) {
      g = new THREE.Group();
      g.name = "row_oars";
      const [px, py, pz] = HULL[kind].pin;
      for (const side of [1, -1]) {
        const pivot = new THREE.Group();
        pivot.name = side > 0 ? "port" : "starboard";
        pivot.position.set(px * side, py, pz);
        const sweep = new THREE.Group();
        const dip = new THREE.Group();
        const feather = new THREE.Group();
        pivot.add(sweep);
        sweep.add(dip);
        dip.add(feather);
        // the loom and the shaft along local +x, from the handle inboard to the blade
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.028, OAR_IN + OAR_OUT - BLADE, 5), this.mats.shaft);
        shaft.rotation.z = Math.PI / 2;
        shaft.position.x = (OAR_OUT - BLADE - OAR_IN) / 2;
        const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5), this.mats.blade);
        handle.rotation.z = Math.PI / 2;
        handle.position.x = -OAR_IN + 0.07;
        const blade = new THREE.Mesh(new THREE.BoxGeometry(BLADE, 0.15, 0.022), this.mats.blade);
        blade.position.x = OAR_OUT - BLADE / 2;
        const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.08, 5), this.mats.iron);
        collar.rotation.z = Math.PI / 2;
        feather.add(shaft, handle, blade, collar);
        for (const m of [shaft, handle, blade, collar]) m.frustumCulled = false;
        g.add(pivot);
        // the punt has no rowlocks of its own: two iron pins on the gunwale
        if (kind === "punt") {
          const pin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), this.mats.iron);
          pin.position.set(px * side, py - 0.04, pz);
          g.add(pin);
        }
      }
      // under the boat's float (the heave and roll): the oars ride with the hull
      boatObj.add(g);
    }
    g.visible = true;
    return g;
  }

  /** Pose the oars for the stroke: sweep (fore and aft), dip (blade in or out), feather (flat on the recovery). */
  private poseOars(): void {
    const b = this.boat!;
    const p = this.player;
    const pin = HULL[b.kind].pin;
    const bladeMid = OAR_OUT - BLADE / 2;
    const dipIn = Math.asin(Math.min(0.95, (pin[1] + 0.06) / bladeMid));
    const dipOut = Math.asin(Math.min(0.95, Math.max(0, pin[1] - 0.22) / bladeMid));
    const ph = p.rowPhase;
    const DRIVE = 0.45;
    for (const pivot of b.oars.children) {
      if (!(pivot instanceof THREE.Group) || !pivot.children.length) continue;
      const port = pivot.name === "port";
      const a = port ? p.rowPort : p.rowStarboard;
      const w = Math.min(1, Math.abs(a) * 1.5);
      const dir = a >= 0 ? 1 : -1;
      // the blade from forward (catch) to aft (finish) in the drive; back through the air in the recovery
      const CATCH = 0.55;
      const FINISH = -0.45;
      let th: number;
      let dp: number;
      let fe: number;
      if (ph < DRIVE) {
        const u = THREE.MathUtils.smoothstep(ph / DRIVE, 0, 1);
        th = dir > 0 ? CATCH + (FINISH - CATCH) * u : FINISH + (CATCH - FINISH) * u;
        dp = dipIn;
        fe = 0;
      } else {
        const u = (ph - DRIVE) / (1 - DRIVE);
        const k = THREE.MathUtils.smoothstep(u, 0, 1);
        th = dir > 0 ? FINISH + (CATCH - FINISH) * k : CATCH + (FINISH - CATCH) * k;
        dp = dipOut - Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.05;
        fe = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (Math.PI / 2) * 0.95;
        if (u < 0.08) dp = dipIn + (dipOut - dipIn) * (u / 0.08);
        if (u > 0.92) dp = dipOut + (dipIn - dipOut) * ((u - 0.92) / 0.08);
      }
      // resting: square out, blades just clear of the water
      th *= w;
      dp = dipOut + 0.04 + (dp - dipOut - 0.04) * w;
      fe *= w;
      // no room for the blade (a wall, the steps, a hull alongside): the oar is shipped, laid in along the gunwale
      const side = port ? 1 : -1;
      const bx = pin[0] * side + side * bladeMid * Math.cos(th);
      const bz = pin[2] + bladeMid * Math.sin(th) * (port ? 1 : 1);
      const hx = p.x + Math.cos(p.rowHeading) * bx + Math.sin(p.rowHeading) * bz;
      const hz = p.z - Math.sin(p.rowHeading) * bx + Math.cos(p.rowHeading) * bz;
      const key = port ? 0 : 1;
      const want = this.world.boatFree(hx, hz, 0.15) ? 0 : 1;
      this.shipped[key] += (want - this.shipped[key]) * 0.15;
      const k = this.shipped[key];
      if (k > 0.01) {
        th = th + (-1.35 - th) * k;
        dp = dp + (-0.08 - dp) * k;
        fe = fe + (Math.PI / 2 - fe) * k;
      }
      const sweep = pivot.children[0] as THREE.Group;
      const dip = sweep.children[0] as THREE.Group;
      const feather = dip.children[0] as THREE.Group;
      sweep.rotation.y = port ? -th : Math.PI + th;
      dip.rotation.z = -dp;
      feather.rotation.x = port ? fe : -fe;
    }
  }

  // ------------------------------------------------------------------ M6 transport: the town's own boats

  /** Boats whose owners are out in them (game/journeys.ts): not lying at their berth. */
  private townAway = new Set<string>();
  private townBoats = new Map<string, TownBoat>();

  /**
   * Open water a family boat may take: the walk map's water with room for the hull, not through
   * the lock (the town's boats never wait for it), not under any opening bridge, deep enough at
   * this tide (the canal and the vliet run dry at low water).
   */
  townFree(x: number, z: number): boolean {
    if (!this.world.boatFree(x, z, 1.05, () => false)) return false;
    if (levelAt(x, z) - bedAt(x, z) < 0.6) return false;
    for (const b of this.world.bridges()?.list ?? []) {
      const R = b.rect;
      if (x > R.minX - 1.5 && x < R.maxX + 1.5 && z > R.minZ - 1.5 && z < R.maxZ + 1.5) return false;
    }
    return true;
  }

  /**
   * A family takes their boat out: it leaves its berth and rows along `path` (open water) with
   * the rower at the oars, the others sitting, and the load in the stern. Drawn near Jef only.
   */
  townBoatOut(id: string, kind: Kind, at: { x: number; z: number; yaw: number }, path: Array<[number, number]>, crew: Array<{ id: string; kind: HumanKind }>, sacks: number): void {
    this.townAway.add(id);
    const l = this.lying.get(id);
    if (l) this.drop(l);
    this.townBoats.get(id)?.obj && this.townBoatEnd(id, null);
    const obj = this.objFor(kind);
    if (!obj) return;
    obj.position.set(at.x, levelAt(at.x, at.z), at.z);
    obj.rotation.set(0, at.yaw, 0);
    const oars = this.oarsFor(obj, kind);
    this.world.boats()?.stowed(obj, false); // M7 boats: her oars are out, not laid in
    const people: Array<{ h: Human; g: THREE.Group; row: boolean }> = [];
    const H = HULL[kind];
    crew.slice(0, 3).forEach((c, i) => {
      const h = makeHuman(c.kind);
      if (!h) return;
      const g = new THREE.Group();
      g.add(h.root);
      // the first rows on the thwart, facing the stern; the others sit forward and aft, facing him
      const row = i === 0;
      const z = row ? H.seatZ : i === 1 ? H.seatZ + 1.4 : H.seatZ - 1.25;
      g.position.set(0, H.seatY + h.sitDrop(0) + 0.02, z);
      g.rotation.y = row ? Math.PI : i === 1 ? Math.PI : 0;
      h.play(row ? "row" : h.canSit ? "sit" : "idle", 0);
      obj.add(g);
      people.push({ h, g, row });
    });
    const load: THREE.Mesh[] = [];
    for (let i = 0; i < sacks; i++) {
      const m = new THREE.Mesh(TOWN_SACK, this.world.mats.darkWood);
      m.position.set(i % 2 ? 0.2 : -0.2, 0.42, H.seatZ - 0.8 - Math.floor(i / 2) * 0.42);
      m.rotation.y = i * 0.7;
      obj.add(m);
      load.push(m);
    }
    this.townBoats.set(id, { id, kind, obj, oars, people, load, x: at.x, z: at.z, yaw: at.yaw, path, pi: 0, phase: 0, wait: 0 });
  }

  /**
   * Row on along the way: `near` draws and animates (and rows at a boat's pace); far off it goes
   * at the unseen pace of the town. Returns where it is, and whether it is at the end.
   */
  townBoatStep(id: string, dt: number, near: boolean, pace: number): { x: number; z: number; yaw: number; done: boolean } | null {
    const b = this.townBoats.get(id);
    if (!b) return null;
    const tgt = b.path[b.pi];
    if (!tgt) return { x: b.x, z: b.z, yaw: b.yaw, done: true };
    const dx = tgt[0] - b.x;
    const dz = tgt[1] - b.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.8) {
      b.pi++;
      return { x: b.x, z: b.z, yaw: b.yaw, done: b.pi >= b.path.length };
    }
    // turn toward the next point, then pull; a ship or a hull across the way: wait (the oars rest)
    const want = Math.atan2(dx, dz);
    const turn = Math.atan2(Math.sin(want - b.yaw), Math.cos(want - b.yaw));
    b.yaw += Math.max(-0.9 * dt, Math.min(0.9 * dt, turn));
    const fwd = Math.max(0, Math.cos(turn));
    const step = Math.min(d, pace * dt * (0.35 + 0.65 * fwd));
    const nx = b.x + Math.sin(b.yaw) * step;
    const nz = b.z + Math.cos(b.yaw) * step;
    const ahead = this.world.boatFree(nx + Math.sin(b.yaw) * 2.2, nz + Math.cos(b.yaw) * 2.2, 0.6, () => false) || !near;
    if (ahead) {
      b.x = nx;
      b.z = nz;
      b.wait = 0;
    } else b.wait += dt;
    b.phase = (b.phase + dt / 2) % 1;
    const vis = near && Math.hypot(b.x - this.player.x, b.z - this.player.z) < 90;
    b.obj.visible = vis;
    if (vis) {
      b.obj.position.set(b.x, levelAt(b.x, b.z), b.z);
      b.obj.rotation.set(0, b.yaw, Math.sin(this.clock * 1.3 + b.x) * 0.02, "YXZ");
      for (const q of b.people) {
        if (q.row) q.h.setPhase("row", ahead ? b.phase : 0.7);
        q.h.update(dt);
      }
      this.poseTownOars(b, ahead ? b.phase : -1);
    }
    return { x: b.x, z: b.z, yaw: b.yaw, done: false };
  }

  /** The oars with the rower's stroke (the row clip: the drive in the first 42 in the hundred), or resting (-1). */
  private poseTownOars(b: TownBoat, phase: number): void {
    const pin = HULL[b.kind].pin;
    const bladeMid = OAR_OUT - BLADE / 2;
    const dipIn = Math.asin(Math.min(0.95, (pin[1] + 0.06) / bladeMid));
    const dipOut = Math.asin(Math.min(0.95, Math.max(0, pin[1] - 0.22) / bladeMid));
    const CATCH = 0.55;
    const FINISH = -0.45;
    let th = 0;
    let dp = dipOut + 0.04;
    let fe = 0;
    if (phase >= 0 && phase < 0.42) {
      const u = THREE.MathUtils.smoothstep(phase / 0.42, 0, 1);
      th = CATCH + (FINISH - CATCH) * u;
      dp = dipIn;
    } else if (phase >= 0.42) {
      const u = (phase - 0.42) / 0.58;
      th = FINISH + (CATCH - FINISH) * THREE.MathUtils.smoothstep(u, 0, 1);
      dp = dipOut;
      fe = Math.sin(Math.PI * Math.min(1, u * 1.15)) * (Math.PI / 2) * 0.95;
    }
    for (const pivot of b.oars.children) {
      if (!(pivot instanceof THREE.Group) || !pivot.children.length) continue;
      const port = pivot.name === "port";
      const sweep = pivot.children[0] as THREE.Group;
      const dip = sweep.children[0] as THREE.Group;
      const feather = dip.children[0] as THREE.Group;
      sweep.rotation.y = port ? -th : Math.PI + th;
      dip.rotation.z = -dp;
      feather.rotation.x = port ? fe : -fe;
    }
  }

  /**
   * The row is over: the family is ashore. At home it lies at its berth again (as the server has
   * it); elsewhere it lies where it stopped (`at`), tied up, until they row it home.
   */
  townBoatEnd(id: string, at: { x: number; z: number; yaw: number } | null, home = false): void {
    const b = this.townBoats.get(id);
    if (b) {
      for (const q of b.people) {
        q.h.dispose();
        q.g.removeFromParent();
      }
      for (const m of b.load) m.removeFromParent();
      b.oars.visible = false;
      this.townBoats.delete(id);
      if (at && !home) {
        this.lay(`town:${id}`, b.kind, at.x, at.z, at.yaw, false, b.obj);
      } else {
        b.obj.visible = false;
        this.pool[b.kind].push(b.obj);
      }
    }
    if (home) {
      const l = this.lying.get(`town:${id}`);
      if (l) this.drop(l);
      this.townAway.delete(id);
      this.syncLying();
    }
  }

  /** M6: the family takes the boat from where it lies away from home (the way back). */
  townBoatFrom(id: string): { x: number; z: number; yaw: number } | null {
    const l = this.lying.get(`town:${id}`);
    if (!l) return null;
    const at = { x: l.x, z: l.z, yaw: l.yaw };
    this.drop(l);
    return at;
  }

  /** Dev: the town's boats out now. */
  townBoatsInfo() {
    return [...this.townBoats.values()].map((b) => ({ id: b.id, x: +b.x.toFixed(1), z: +b.z.toFixed(1), at: `${b.pi}/${b.path.length}`, crew: b.people.length }));
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    this.clock += dt;
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = this.boat || this.data?.hire ? 3 : 10;
      void this.load();
    }
    const b = this.boat;
    const p = this.player;
    if (b) {
      if (!p.rowing) {
        this.note("out by something else");
        // taken out of the boat by something else (the dev menu's "go to", the cell)
        if (!this.busy) {
          const keep = { x: b.obj.position.x, z: b.obj.position.z, yaw: b.obj.rotation.y };
          this.releaseAll();
          b.oars.visible = false;
          this.lay(b.what === "hire" ? "mine" : b.what, b.kind, keep.x, keep.z, keep.yaw, keep.z < -1, b.obj);
          this.boat = null;
          void this.post("/api/row/leave", { x: keep.x, z: keep.z, yaw: keep.yaw }).then(() => this.load()).catch(() => {});
        }
      } else {
        // the hull where the rower's physics put it; no float bob of its own (the rower's view moves with it)
        b.obj.position.set(p.x, p.rowY, p.z);
        b.obj.rotation.set(-p.rowPitch, p.rowHeading, p.rowRoll, "YXZ");
        const inner = b.obj.children[0];
        if (inner && inner.name !== "row_oars") {
          inner.position.y = 0;
          inner.rotation.set(0, 0, 0);
        }
        this.poseOars();
        this.meetVessels(dt);
        if (this.boat) this.bridgesAndLock();
        if (psxUniforms.uSea.value > 2.5) this.stormWarning();
        // hard strokes to the server now and then (it clamps them by the clock)
        this.strokeT += dt;
        if (this.strokeT > 5 && this.hard > 0) {
          const n = this.hard;
          this.hard = 0;
          this.strokeT = 0;
          void net("POST", "/api/row/stroke", { hard: n }).catch(() => {});
        }
      }
    }
    // boats left out drift with the tide on the river, and stop at walls and hulls
    for (const l of this.lying.values()) {
      if (!l.drift) continue;
      const [cx, cz] = this.current(l.x, l.z);
      if (!cx && !cz) continue;
      const nx = l.x + cx * dt * 0.8;
      const nz = l.z + cz * dt * 0.8;
      const fx = Math.sin(l.yaw);
      const fz = Math.cos(l.yaw);
      const hl = HULL[l.kind].half - 0.5;
      this.world.removeWaterSolid(l.rect);
      const ok = [-1, 0, 1].every((k) => this.world.boatFree(nx + fx * hl * k, nz + fz * hl * k, HULL[l.kind].beam * 0.9) && !(this.boat && Math.hypot(nx - p.x, nz - p.z) < HULL[l.kind].half * 2));
      this.world.addWaterSolid(l.rect);
      if (ok) {
        l.x = nx;
        l.z = nz;
        l.drifted = true;
        Object.assign(l.rect, this.rectOf(nx, nz, l.yaw, l.kind));
        l.obj.position.set(nx, levelAt(nx, nz), nz);
      } else l.drift = false;
    }
    // wrecks going down
    for (const s of [...this.sinking]) {
      s.t += dt;
      const k = Math.max(0, s.t - 0.6);
      s.obj.position.y = s.y0 - k * k * 0.12 - k * 0.15;
      s.obj.rotation.z = s.roll * Math.min(1, s.t / 3);
      s.obj.rotation.x = -0.25 * Math.min(1, s.t / 4);
      if (s.obj.position.y < s.y0 - 2.2) {
        s.obj.visible = false;
        s.obj.traverse((o) => {
          if (o.name.endsWith("_cap")) o.visible = true;
        });
        this.sinking.splice(this.sinking.indexOf(s), 1);
        // a new hull from the pool next time: this one is at the bottom
      }
    }
    // splinters: thrown up, then afloat, then gone
    if (this.splinters && this.chips.length) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const one = new THREE.Vector3(1, 1, 1);
      let alive = 0;
      this.chips.forEach((c, i) => {
        c.t += dt;
        const lvl = this.world.waterLevel(c.p.x, c.p.z);
        if (c.p.y > lvl + 0.02 || c.v.y > 0) {
          c.v.y -= 9.8 * dt;
          c.p.addScaledVector(c.v, dt);
          c.r.x += dt * 6;
          c.r.y += dt * 4;
        } else {
          c.p.y = lvl + 0.01;
          c.v.set(c.v.x * 0.97, 0, c.v.z * 0.97);
          c.p.addScaledVector(c.v, dt);
          c.r.x *= 0.95;
          c.r.z *= 0.95;
        }
        const s = c.t > 14 ? Math.max(0, 1 - (c.t - 14) / 2) : 1;
        if (s > 0) alive++;
        m.compose(c.p, q.setFromEuler(c.r), one.set(s, s, s));
        this.splinters!.setMatrixAt(i, m);
      });
      this.splinters.instanceMatrix.needsUpdate = true;
      if (!alive) {
        this.chips = [];
        this.splinters.visible = false;
      }
    }
    // M7 boats: the lines of the boats at their moorings near the eye; copies far off are not drawn
    this.ropes();
    this.life?.update(dt, this.player.camera.position);
    // a new boat at a berth once nobody is looking
    this.syncT -= dt;
    if (this.data && this.syncT <= 0) {
      this.syncT = 2;
      this.syncLying();
    }
  }

  private ropeT = 0;
  private ropeEnds: RopeEnd[] = [];
  private ropes(): void {
    const w = this.data;
    if (!w || !this.moorings || !this.fleet) return;
    const px = this.player.camera.position.x;
    const pz = this.player.camera.position.z;
    // which boats: every half second, the nearest at their moorings (or lying there as a copy)
    this.ropeT -= 1 / 60;
    if (this.ropeT <= 0) {
      this.ropeT = 0.5;
      this.ropeEnds = [];
      const near = w.boats
        .filter((b) => b.rings && !b.lost && Math.hypot(b.home.x - px, b.home.z - pz) < 70)
        .sort((a, b) => Math.hypot(a.home.x - px, a.home.z - pz) - Math.hypot(b.home.x - px, b.home.z - pz))
        .slice(0, 32);
      for (const b of near) {
        const i = this.fleetIdx.get(b.id);
        let m: THREE.Matrix4 | null = null;
        if (i !== undefined && !this.fleet.hidden(i)) m = this.fleet.world(i);
        else {
          const l = this.lying.get(b.id);
          if (l && Math.hypot(l.x - b.home.x, l.z - b.home.z) < 1.5) m = (l.obj.children[0] ?? l.obj).matrixWorld;
        }
        if (!m) continue;
        this.ropeEnds.push({ m, kind: b.kind, rings: b.rings!, top: this.world.baseAt(b.rings![0][0], b.rings![0][1]) });
      }
    }
    this.moorings.update(this.ropeEnds);
    // copies of boats far off: not drawn (the instanced ones cull by their squares)
    for (const l of this.lying.values()) l.obj.visible = Math.hypot(l.x - px, l.z - pz) < 170;
  }

  // ------------------------------------------------------------------ the map and the path check

  private mapMarks(): MapMark[] {
    return (this.data?.landings ?? []).map((L) => ({ x: L.top[0], z: L.top[1], label: `boats for hire (${L.label.replace(/^the /, "")})`, kind: "shop" as const, icon: "boat" }));
  }

  /** For the path check (CLAUDE.md): the top of every flight with a boat at its foot. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const L of this.data?.landings ?? []) out.push({ label: `boat hire at ${L.label}`, x: L.top[0], z: L.top[1], reach: 2.2 });
    for (const f of this.world.quayInfo().flights) {
      const b = this.data?.boats.find((q) => Math.hypot(q.landing[0] - f.end[0], q.landing[1] - f.end[1]) < 6);
      if (b) out.push({ label: `the ${b.kind} ${b.where}`, x: f.top[0], z: f.top[1], reach: 2.2 });
    }
    // M7 boats: every small boat's way in: the head of her ladder, or the top of her flight of steps
    for (const m of MOORINGS) {
      const at = m.board.top;
      out.push({ label: `the ${HULLS[m.kind].noun} ${m.where} (${m.id})`, x: at[0] - (m.board.kind === "ladder" ? m.board.n[0] * 0.8 : 0), z: at[1] - (m.board.kind === "ladder" ? m.board.n[1] * 0.8 : 0), reach: 1.6 });
    }
    return out;
  }

  // ------------------------------------------------------------------ dev

  /** Dev: state for checks. */
  info() {
    const p = this.player;
    return {
      rowing: this.rowing,
      boat: this.boat ? { what: this.boat.what, kind: this.boat.kind } : null,
      x: +p.x.toFixed(2),
      z: +p.z.toFixed(2),
      heading: +p.rowHeading.toFixed(3),
      speed: +p.rowSpeed.toFixed(2),
      turn: +p.rowTurn.toFixed(2),
      phase: +p.rowPhase.toFixed(2),
      y: +p.rowY.toFixed(2),
      fits: this.fits(),
      requested: [...this.requested],
      lock: this.lockAsked ? +(this.world.lock()?.gatesOpen() ?? 0).toFixed(2) : null,
      lying: [...this.lying.values()].map((l) => ({ key: l.key, x: +l.x.toFixed(1), z: +l.z.toFixed(1), drift: l.drift })),
      last: this.last,
      server: this.data ? { hire: this.data.hire, on: this.data.on, debt_c: this.data.debt_c, storm: this.data.storm } : null,
      sinking: this.sinking.length,
    };
  }

  /**
   * M7 boats: the boat check (__scheldemist.rowing.boatCheck()). Every small boat floats on her own water
   * at the height the tide gives her (on the mud only where the water is too low for her), clear of the
   * quay wall, the land and every other hull; her two lines reach their rings in the coping at high and
   * low water; the way in (her ladder, her steps) is there; her numbers match her model. Every other
   * vessel set down (the moored rows, the ships) floats on water at her height and clear of the others.
   * `problems` must be empty. (`paths()` checks the quay at the head of each ladder and flight.)
   */
  boatCheck(): { boats: number; aground: number; ropes: number; ladders: number; vessels: number; problems: string[] } {
    const w = this.data;
    const bs = this.world.boats();
    const problems: string[] = [];
    if (!w || !bs || !this.fleet) return { boats: 0, aground: 0, ropes: 0, ladders: 0, vessels: 0, problems: ["the boats are not in yet"] };
    const ladders = this.world.quayInfo().ladders;
    const flights = this.world.quayInfo().flights;
    const rects = new Map<string, Rect>();
    let aground = 0;
    let ropes = 0;
    let ladderN = 0;
    const tmp = new THREE.Vector3();
    for (const b of w.boats) {
      if (b.lost) continue;
      const h = HULL[b.kind];
      const l = this.lying.get(b.id);
      const at = l ? { x: l.x, z: l.z, yaw: l.yaw } : b.home;
      const name = `${b.id} (${b.kind})`;
      // on the water: the ends and the sides of her hull
      const fx = Math.sin(at.yaw);
      const fz = Math.cos(at.yaw);
      for (const [a, c] of [[h.half, 0], [-h.half, 0], [0, h.beam], [0, -h.beam], [h.half * 0.7, h.beam * 0.8], [-h.half * 0.7, -h.beam * 0.8]]) {
        const px = at.x + fx * a + fz * c;
        const pz = at.z + fz * a - fx * c;
        if (!this.world.isWater(px, pz)) problems.push(`${name}: part of her hull is on land or in the wall at (${px.toFixed(1)}, ${pz.toFixed(1)})`);
      }
      // her height: the level of her water, or the mud under her at low water
      const i = this.fleetIdx.get(b.id);
      const y = l ? l.obj.position.y : i !== undefined ? this.fleet.world(i).elements[13] : NaN;
      const floor = floorOf(b.kind, at.x, at.z, at.yaw);
      const lv = levelAt(at.x, at.z);
      const want = Math.max(lv, floor);
      if (!(Math.abs(y - want) < 0.2)) problems.push(`${name}: floats at y ${y.toFixed(2)}, the water (or the mud) wants ${want.toFixed(2)}`);
      if (floor > lv) aground++;
      if (floor > -Infinity && floor > MID_Y + 0.5) problems.push(`${name}: the mud under her is too high (${floor.toFixed(2)}): she would lie dry most of the tide`);
      const r = this.rectOf(at.x, at.z, at.yaw, b.kind);
      for (const [k, o] of rects) if (r.minX < o.maxX - 0.1 && r.maxX > o.minX + 0.1 && r.minZ < o.maxZ - 0.1 && r.maxZ > o.minZ + 0.1) problems.push(`${name}: lies inside ${k}`);
      rects.set(name, r);
      // her lines: the rings on the quay, the ropes long enough at low water, not through the ring at high water
      const m = MOORING_OF.get(b.id);
      if (m) {
        for (const [end, ring] of m.rings.entries()) {
          const top = this.world.baseAt(ring[0], ring[1]);
          if (this.world.isWater(ring[0], ring[1]) || top < -0.8) problems.push(`${name}: ring ${end} is not on the quay (${ring[0]}, ${ring[1]})`);
          const p = end === 0 ? h.bow : h.stern;
          for (const level of [LW_MIN, HW_MAX]) {
            const lvl = Math.max(level, floor);
            tmp.set(m.x + p[0] * Math.cos(m.yaw) + p[2] * Math.sin(m.yaw), lvl + p[1], m.z - p[0] * Math.sin(m.yaw) + p[2] * Math.cos(m.yaw));
            const d = Math.hypot(ring[0] - tmp.x, top - tmp.y, ring[1] - tmp.z);
            if (d > ROPE_MAX) problems.push(`${name}: her ${end ? "stern" : "bow"} line does not reach its ring at ${level === LW_MIN ? "low" : "high"} water (${d.toFixed(1)} m)`);
            if (d < 0.25) problems.push(`${name}: her ${end ? "stern" : "bow"} is right on its ring at high water`);
          }
          ropes++;
        }
        // the way in: her ladder at her thwart, or her flight's landing by her end
        const bd = m.board;
        if (bd.kind === "ladder") {
          const [tx, tz] = bd.top;
          const lad = ladders.find((q) => Math.hypot(q.x - tx - bd.n[0] * 0.3, q.z - tz - bd.n[1] * 0.3) < 0.9);
          if (!lad) problems.push(`${name}: no ladder at (${tx}, ${tz})`);
          else ladderN++;
          const foot = this.distToHull(this.homeLying(b), tx + bd.n[0] * 0.3, tz + bd.n[1] * 0.3);
          if (foot > 0.8) problems.push(`${name}: her hull is ${foot.toFixed(1)} m from the foot of her ladder`);
        } else {
          if (!flights.some((f) => Math.hypot(f.top[0] - bd.top[0], f.top[1] - bd.top[1]) < 1)) problems.push(`${name}: no flight of steps at (${bd.top})`);
          const d = this.distToHull(this.homeLying(b), bd.at[0], bd.at[1]);
          if (d > 2.0) problems.push(`${name}: ${d.toFixed(1)} m from the landing (more than a step)`);
        }
      }
      // her numbers are her model's (shared/smallBoats.ts HULLS against the glTF extra "row")
      const ex = bs.extra(b.kind as BoatName, "row") as { half: number; seatZ: number; pin: number[] } | undefined;
      if (!ex) problems.push(`${b.kind}: boats.glb has no "row" extra`);
      else if (Math.abs(ex.half - h.half) > 0.06 || Math.abs(ex.seatZ - h.seatZ) > 0.06 || Math.abs(ex.pin[2] - h.pin[2]) > 0.06)
        problems.push(`${b.kind}: HULLS differs from the model (half ${ex.half}, seat ${ex.seatZ}, pin z ${ex.pin[2]})`);
    }
    // every other vessel: on water, at her height, clear of the others (and of the small boats)
    const SMALL = new Set<string>(SMALL_KINDS);
    let vessels = 0;
    const others: Array<{ n: string; r: Rect }> = [];
    for (const v of bs.placements()) {
      if (SMALL.has(v.name) || v.name === "pontoon_section") continue;
      const x = v.obj ? v.obj.position.x : v.x;
      const z = v.obj ? v.obj.position.z : v.z;
      const yaw = v.obj ? v.obj.rotation.y : v.yaw;
      if (v.obj && (!v.obj.visible || !v.obj.parent)) continue;
      // boats under way (river traffic, the lock, the canal) are their own movers' business
      if (v.obj && v.obj.parent?.name !== "" && ["river_traffic", "lock", "opening_bridges"].includes(v.obj.parent?.name ?? "")) continue;
      vessels++;
      const n = `${v.name} at (${x.toFixed(0)}, ${z.toFixed(0)})`;
      // (a ship with a deck to walk on, the Anna Maria: her middle is her deck, not water)
      if (!this.world.isWater(x, z) && !bs.deck(v.name, x, z, yaw)) problems.push(`${n}: her middle is not on the water`);
      const floor = (v.obj?.userData.floor as number | undefined) ?? v.floor;
      const want = Math.max(levelAt(x, z), floor);
      const y = v.y();
      if (!(Math.abs(y - want) < 0.25)) problems.push(`${n}: floats at y ${y.toFixed(2)}, wants ${want.toFixed(2)}`);
      const d = bs.dims(v.name);
      const s = Math.abs(Math.sin(yaw));
      const c = Math.abs(Math.cos(yaw));
      const hl = d.length * 0.42;
      const hb = d.beam * 0.42;
      const r = { minX: x - s * hl - c * hb, maxX: x + s * hl + c * hb, minZ: z - c * hl - s * hb, maxZ: z + c * hl + s * hb };
      for (const o of others) if (r.minX < o.r.maxX && r.maxX > o.r.minX && r.minZ < o.r.maxZ && r.maxZ > o.r.minZ) problems.push(`${n}: lies inside ${o.n}`);
      for (const [k, o] of rects) if (r.minX < o.maxX && r.maxX > o.minX && r.minZ < o.maxZ && r.maxZ > o.minZ) problems.push(`${n}: lies over the small boat ${k}`);
      others.push({ n, r });
    }
    return { boats: rects.size, aground, ropes, ladders: ladderN, vessels, problems };
  }

  /** Dev: walk onto a landing's floor (for checks without walking there). */
  devToLanding(id: string): boolean {
    const L = this.data?.landings.find((q) => q.id === id) ?? null;
    const b = L ? null : this.data?.boats.find((q) => q.id === id);
    const at = L?.landing ?? b?.landing;
    if (!at) return false;
    this.player.place(at[0], at[1], this.player.yaw);
    this.player.y = WATER_Y + 0.4;
    return true;
  }

  /** Dev: move the boat being rowed (for checks: no walls are looked at). */
  devMove(x: number, z: number, heading: number): boolean {
    const p = this.player;
    if (!this.rowing) return false;
    p.x = x;
    p.z = z;
    p.rowHeading = heading;
    p.yaw = heading + Math.PI;
    p.rowSpeed = 0;
    return true;
  }

  /** Dev: run the E action that is offered now. */
  devE(): string | null {
    const a = this.keys(this.player.x, this.player.z);
    const act = a.only?.[0] ?? a.options?.sort((x, y) => x[0] - y[0])[0]?.[1] ?? null;
    if (!act) return null;
    act.run();
    return act.text;
  }
}
