import * as THREE from "three";
import { fishBoxMesh } from "./fishBox";
import { KEG, kegMesh } from "./kegModel";
import { labelGeo, relabel, sackLabelFor, sackMaterial, sackMesh, sackOf, standingSackGeometry, type SackLabel } from "./sackModel";
import { psx } from "../retro/psx";
import { addLantern, lanternDarkAt, removeLantern, type LanternSource } from "../world/lanternLights";
import { lampFog } from "../world/lampFog";
import type { Rect } from "../world/geom";
import { makeHuman, whenHumans, RIDE_BACK, type Human, type HumanKind, type Motion } from "./humans";
import { loadProps, type Props } from "../world/props3d";
import { LedDray, PushCart, handsOf, hideBakedCart } from "../world/traffic";
import { loadVelocipede, WHEEL_R } from "./velocipedes";

// Townspeople: the ambient crowd on the streets and quays. Nobody here has a
// name or a line. As on the old photographs of the quays: they walk, stroll in
// couples, stop to talk, stand in groups, sit on a crate, stand at the quay edge
// looking out over the water, carry sacks along the quay, push sack trucks and
// handcarts. Bodies are the rigged models of people.glb (humans.ts).
//
// The map is not hardcoded. Everything comes from the walk map (flags: 0 open,
// 1 wall, 2 water, 4 outside), from isFree() for crates and carts, and from a
// list of busy places the game passes in. A coarse walk grid (1 m cells) is
// built from flags() in a window round the player; people find their way on it
// (A*, then straightened), and step with isFree(). The grid also finds its own
// quay edges and open squares, so the crowd still works if no places are given.
//
// Cheap on purpose: a budget of about 32 people, all within `radius` of the
// player (the rest are recycled and spawned again out of sight); only the ones
// in view are drawn and animated; far ones animate at 15 fps. Density follows
// the hour (setHour): full by day, a handful at night, some with lanterns.

export type PlaceKind = "quay" | "square" | "street";

export interface BusyPlace {
  x: number;
  z: number;
  kind: PlaceKind;
  /** Radius of the place in metres (default: quay 12, square 10, street 7). */
  r?: number;
}

/** What the crowd needs from the world (World and CityWorld have all of it). */
export interface CrowdGround {
  /** Walk map flags at a point: 0 open, 1 wall, 2 water, 4 outside. Undefined while loading. */
  flags(x: number, z: number): number | undefined;
  /** Can something of radius r stand here (walls, water, crates, carts)? */
  isFree(x: number, z: number, r: number): boolean;
  /** Optional: everything solid on the ground, so paths go round it instead of into it. */
  solids?(): Rect[];
  /** Optional: changes whenever a solid is put down or taken away (so solids() is not read every frame). */
  solidsVersion?(): number;
  /** Optional: must a walker stop before stepping to (x, z)? (an opening bridge: wait at its end) */
  gate?(x: number, z: number): boolean;
  /** Optional: height of the walkable ground (the Steen's courtyard and ramp, the gangway, the pontoon). */
  baseAt?(x: number, z: number): number;
  /** Optional (the look pass, 2026-09-26): ways narrower than a walker's half-metre berth, where the grid keeps only
   * 0.3 m off the walls: the town wall's stairs (1.8 m between the railing and the wall), else nobody walks up them. */
  narrow?(x: number, z: number): boolean;
  /** Optional: make the crates people sit on solid for the player. */
  addCollider?(r: Rect): void;
  removeCollider?(r: Rect): void;
  /** Optional (M6 handcart): the carts people push and the drays they lead, solid for the player and the vehicles (World.addMover). */
  addMover?(r: Rect): void;
  removeMover?(r: Rect): void;
  /**
   * Optional (Steve 2026-09-27: "smaller will get out of the way of the bigger ones; the omnibus and the train
   * should not be blocked"): the town's moving vehicles as their ground boxes (stable objects moved in place), with
   * a rank: 3 the train, 2.5 an omnibus, 2 a dray. The crowd works out how each moves and gives way (giveWay).
   */
  vehicles?(): ReadonlyArray<{ r: Rect; rank: number }>;
}

/** A vehicle's path just ahead, in which nobody smaller may stand (giveWay). */
interface Lane {
  cx: number;
  cz: number;
  /** Which way it goes (unit), and its right hand. */
  ux: number;
  uz: number;
  rx: number;
  rz: number;
  /** Half its length along the way, half its width across. */
  hl: number;
  hw: number;
  /** How far ahead of its front the way must be clear (m). */
  look: number;
  rank: number;
  /** The walker's own cart or dray (not a lane for himself). */
  own?: Person;
}

/** Only a vehicle going at least this fast (m/s) is given way to. */
const LANE_MIN_SPEED = 0.35;
/** Room kept beside a vehicle's side (m), and how far beyond it a walker steps. */
const LANE_BERTH = 0.55;
const LANE_STEP_OUT = 0.9;
/** A walker hurries aside at this pace (m/s). */
const GIVE_WAY_PACE = 1.7;

export interface CrowdOptions {
  /** Most people alive at once, at the busiest hour (default 32). */
  budget?: number;
  /** People live within this many metres of the player (default 70). */
  radius?: number;
  /** Materials for the carried sacks and the crates people sit on (default: plain colours). */
  mats?: { sack?: THREE.Material; crate?: THREE.Material };
  /** The quay edge has a railing: people there lean on it (else they stand, hands behind the back). */
  quayRail?: boolean;
}

interface V {
  x: number;
  z: number;
}

const WALL = 1;
const WATER = 2;

/** puppet: a resident of the town (M3e, town.ts) says where to go and what to do; the crowd walks them on its grid. */
// M8b "remote": a townsperson another player's PC walks (net/mp/street.ts); drawn and animated here from its
// batches, never walked or turned by this crowd.
type Role = "wander" | "haul" | "group" | "follow" | "puppet" | "remote";
type State = "walk" | "pause" | "chat" | "stand" | "sit" | "wait" | "blocked";

interface Lantern {
  g: THREE.Group;
  halo: THREE.Sprite;
  /** Its light on the world (world/lanternLights.ts). */
  src: LanternSource;
}

interface Cluster {
  x: number;
  z: number;
  /** Everyone faces this way (people at the quay edge look out over the water); else the middle. */
  look: number | null;
  members: Person[];
  speaker: Person | null;
  speakT: number;
  life: number;
  seats: THREE.Mesh[];
  rects: Rect[];
}

/** A townsperson walked by the crowd for town.ts (M3e). */
export type Puppet = Person;

interface Person {
  id: number;
  kind: HumanKind;
  human: Human;
  group: THREE.Group;
  x: number;
  z: number;
  yaw: number;
  /** Walking pace, m/s. */
  pace: number;
  /** This person's height against the model's (a little taller or shorter than the next). */
  size: number;
  role: Role;
  state: State;
  timer: number;
  path: V[];
  pi: number;
  dest: V | null;
  replans: number;
  /** Seconds a way has been blocked (by the player, mostly), and since the last way round. */
  held: number;
  sinceDetour: number;
  /** Haul: the two ends (a quay spot and a spot inland), which way, and the load. */
  a: V | null;
  b: V | null;
  toB: boolean;
  loaded: boolean;
  /** Dockers who pick up and put down a sack at each end (the others always carry). */
  handCarry: boolean;
  sack: THREE.Object3D | null;
  /** What the sack he carries says (the pile or the mill it came from). */
  sackLabel?: SackLabel;
  /** What the load in his hands is (puppetLoad). */
  loadKind?: "sack" | "crate" | "fishbox" | "keg";
  cluster: Cluster | null;
  partner: Person | null;
  /** No new chat before this runs out. */
  chatCd: number;
  /** Arms folded when standing about (some men). */
  folds: boolean;
  /** What they do with their arms at the quay edge. */
  looks: Motion;
  /** A couple strolling: the one who leads, and the one at their side. */
  lead: Person | null;
  follower: Person | null;
  /** Radius to keep clear, and how far ahead to look (a cart goes before its man). */
  reach: number;
  nose: number;
  lantern: Lantern | null;
  /** Already decided about a lantern for this night. */
  lanternRoll: boolean;
  hand: THREE.Object3D | null;
  seat: boolean;
  /** How far the body is lowered now (eases when sitting down or getting up). */
  drop: number;
  shown: boolean;
  animAcc: number;
  /** Stuck check: the nearest this person got to the next waypoint, and for how long no closer. */
  bestD: number;
  stuckT: number;
  /** Puppets (M3e): what to play when standing, and which way to face (null: as they came). */
  pmotion?: Motion;
  pyaw?: number | null;
  /** A town puppet walking at another's side (puppetFollow): back to a puppet when the lead goes. */
  townFollow?: boolean;
  /** M3i: what they bought at the market, in the hand (puppetCarry). */
  bought?: THREE.Object3D | null;
  /** M6 transport: riding a velocipede, pushing a handcart, leading a dray (puppetVehicle). */
  veh?: Vehicle | null;
  /** Where he stood before he stepped aside for a vehicle (giveWay): he steps back once it has gone by. */
  wayHome?: { x: number; z: number } | null;
  /** puppetGo gave a new goal (dest) when no way could be worked out this frame: the old way is walked till then. */
  repath?: boolean;
}

/** M6 transport: what a townsperson rides, pushes or leads (game/journeys.ts says which). */
export type PuppetVehicle =
  | { kind: "velo" }
  | { kind: "cart"; items: number; what?: "goods" | "fish" | "furniture" | "chests" | "sacks"; label?: SackLabel }
  // (sacks: how many lie on the bed and what they say, else the full load; the one sack model, game/sackModel.ts)
  | { kind: "dray"; loaded: boolean; sacks?: number; label?: SackLabel };

interface Vehicle {
  spec: PuppetVehicle;
  obj: THREE.Object3D | null;
  steer?: THREE.Object3D | null;
  front?: THREE.Object3D | null;
  rear?: THREE.Object3D | null;
  cart?: PushCart;
  dray?: LedDray;
  /** Ground covered (the wheels, the pedals), and where he was last frame. */
  dist: number;
  lx: number;
  lz: number;
  speed: number;
  /** What the person had before (the crowd's own reach and size). */
  was: { nose: number; reach: number; size: number };
}

// Who is about, by kind of place. Weights; the night table multiplies them.
const MIX: Record<PlaceKind, Partial<Record<HumanKind, number>>> = {
  quay: { docker_a: 3, docker_b: 3, docker_c: 3, docker_sack: 2.5, porter: 2, carter: 1.5, sailor_b: 2, fishwife_a: 1, fishwife_b: 1, police: 0.5, boy: 0.6, gentleman: 0.6, maid: 0.4 },
  square: { fishwife_a: 2, fishwife_b: 2, maid: 2, gentleman: 2, priest: 1, police: 1, boy: 1.2, girl: 1.2, docker_a: 1, docker_b: 1.2, docker_c: 0.8, sailor_b: 0.5, porter: 0.6, carter: 0.4 },
  street: { maid: 2, gentleman: 1.5, docker_a: 1, docker_b: 1.5, docker_c: 1, fishwife_a: 1, fishwife_b: 1, boy: 1, girl: 1, priest: 0.7, police: 0.7, porter: 1, carter: 1.2, sailor_b: 0.6 },
};
const NIGHT: Partial<Record<HumanKind, number>> = {
  boy: 0.15, girl: 0, maid: 0.15, fishwife_a: 0.25, fishwife_b: 0.25, priest: 0.3, police: 2.5, porter: 0.3, carter: 0.3, docker_sack: 0.3, sailor_b: 2, gentleman: 0.8,
};
const PACE: Partial<Record<HumanKind, [number, number]>> = {
  porter: [0.8, 0.95],
  carter: [0.85, 1.0],
  docker_sack: [0.95, 1.1],
  gentleman: [1.0, 1.2],
  priest: [0.95, 1.1],
  police: [0.9, 1.05],
  boy: [1.1, 1.6],
  girl: [1.0, 1.4],
};
const WOMEN = new Set<HumanKind>(["fishwife_a", "fishwife_b", "maid", "girl"]);
const CHILDREN = new Set<HumanKind>(["boy", "girl"]);
/** Animation every frame within this (m); 15 fps out to ANIM_FAR, 8 fps beyond (M6 population). */
const ANIM_NEAR = 25;
const ANIM_FAR = 45;
const HAND_CARRIERS = new Set<HumanKind>(["docker_a", "docker_b", "docker_c"]);
const LOADED = new Set<HumanKind>(["porter", "docker_sack", "carter"]);
/** Pushing something that goes before them: how far ahead it reaches, and how wide. */
// the carter's handcart (a PushCart, world/traffic.ts) reaches 3.6 m before him
const CART: Partial<Record<HumanKind, [number, number]>> = { porter: [0.9, 0.35], carter: [3.3, 0.6] };
const PLACE_R: Record<PlaceKind, number> = { quay: 12, square: 10, street: 7 };

/** Share of the budget out at each hour. */
const DENSITY: Array<[number, number]> = [
  [0, 0.06], [4.5, 0.05], [5.5, 0.15], [7, 0.6], [9, 1], [17, 1], [19, 0.7], [21, 0.35], [23, 0.12], [24, 0.06],
];
function density(h: number): number {
  for (let i = 0; i < DENSITY.length - 1; i++) {
    const [h0, d0] = DENSITY[i];
    const [h1, d1] = DENSITY[i + 1];
    if (h >= h0 && h <= h1) return d0 + ((d1 - d0) * (h - h0)) / (h1 - h0);
  }
  return 0.06;
}
const isNight = (h: number) => h < 6.5 || h >= 19.5;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
/** The clips of a body on the move (the stuck check, dev/stuckcheck.ts, watches the same). */
const WALK_CLIPS = new Set<Motion>(["walk", "carry", "push", "ride"]);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Two bodies keep this far apart, middle to middle (m; shoulders about half a metre), eased apart at up to BODY_SHOVE m/s (keepApart). */
const BODY_GAP = 0.6;
const BODY_SHOVE = 1.2;
/** A townsperson standing in one of these may be eased aside; any other pose is a task on its spot (scrub, lace, rope, wash ...). */
const FREE_POSES = new Set<Motion>(["idle", "fold", "talk", "walk", "carry", "behind", "pockets", "smoke"]);

// ------------------------------------------------------------------ walk grid

/** A dray's rig goes this far to the right of the man at the horse's head (world/traffic.ts LedDray). */
const DRAY_SIDE = 0.85;

/** A straightened way keeps this far off the solids (a body 0.25 m, and the 0.35 m between the samples of a line). */
const NEAR_M = 0.4;

/** A square window of 1 m cells round a point: open (1) or not (0), plus A*. */
class NavGrid {
  readonly n: number;
  x0 = 0;
  z0 = 0;
  cx = 0;
  cz = 0;
  built = false;
  readonly open: Uint8Array;
  /**
   * Fixes 2026-09-25: the cells within NEAR_M of a solid, and those solids. A straightened way is
   * tested against them exactly: a cell is open when its middle keeps clear of a crate stack, but a
   * line through its corner could cut the stack (a hired hand with a crate stuck there, twice).
   */
  private readonly near: Uint8Array;
  /**
   * How many cells each open cell is from the nearest closed one (0: closed). A dray's way keeps to the
   * middle of the street by it (Steve 2026-09-28: the rig went into the walls round the corners).
   */
  private readonly clear: Uint8Array;
  private readonly nearList = new Map<number, Rect[]>();
  /** Found on the grid: open ground by the water, wide open ground, other open ground. */
  quay: V[] = [];
  square: V[] = [];
  street: V[] = [];
  private readonly g: Float32Array;
  private readonly f: Float32Array;
  private readonly from: Int32Array;
  private readonly stamp: Int32Array;
  private readonly closed: Int32Array;
  private readonly heap: Int32Array;
  private search = 0;

  constructor(readonly half: number) {
    this.n = Math.ceil(half * 2);
    const N = this.n * this.n;
    this.open = new Uint8Array(N);
    this.near = new Uint8Array(N);
    this.clear = new Uint8Array(N);
    this.g = new Float32Array(N);
    this.f = new Float32Array(N);
    this.from = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.closed = new Int32Array(N);
    this.heap = new Int32Array(N);
  }

  /** Rebuild round (cx, cz). False while the walk map is not in. */
  build(flags: CrowdGround["flags"], cx: number, cz: number, solids: Rect[] = [], narrow?: (x: number, z: number) => boolean): boolean {
    if (flags(cx, cz) === undefined) return false;
    const n = this.n;
    this.cx = Math.round(cx);
    this.cz = Math.round(cz);
    this.x0 = this.cx - this.half;
    this.z0 = this.cz - this.half;
    const R = 0.5; // keep half a metre off walls and water
    const D = R * Math.SQRT1_2;
    for (let iz = 0; iz < n; iz++) {
      const z = this.z0 + iz + 0.5;
      for (let ix = 0; ix < n; ix++) {
        const x = this.x0 + ix + 0.5;
        const [r, d] = narrow && narrow(x, z) ? [0.3, 0.3 * Math.SQRT1_2] : [R, D];
        this.open[iz * n + ix] =
          flags(x, z) === 0 &&
          flags(x + r, z) === 0 &&
          flags(x - r, z) === 0 &&
          flags(x, z + r) === 0 &&
          flags(x, z - r) === 0 &&
          flags(x + d, z + d) === 0 &&
          flags(x - d, z + d) === 0 &&
          flags(x + d, z - d) === 0 &&
          flags(x - d, z - d) === 0
            ? 1
            : 0;
      }
    }
    // crates, carts, crane legs, lamps and trees: close every cell within a body's
    // width of them, so paths go round them instead of into them
    const B = 0.45;
    this.near.fill(0);
    this.nearList.clear();
    for (const c of solids) {
      // the cells a line through could come within NEAR_M of it
      {
        const i0 = Math.max(0, Math.floor(c.minX - NEAR_M - this.x0));
        const i1 = Math.min(n - 1, Math.floor(c.maxX + NEAR_M - this.x0));
        const j0 = Math.max(0, Math.floor(c.minZ - NEAR_M - this.z0));
        const j1 = Math.min(n - 1, Math.floor(c.maxZ + NEAR_M - this.z0));
        for (let iz = j0; iz <= j1; iz++) {
          for (let ix = i0; ix <= i1; ix++) {
            const k = iz * n + ix;
            this.near[k] = 1;
            const l = this.nearList.get(k);
            if (l) l.push(c);
            else this.nearList.set(k, [c]);
          }
        }
      }
      const i0 = Math.max(0, Math.floor(c.minX - B - this.x0));
      const i1 = Math.min(n - 1, Math.floor(c.maxX + B - this.x0));
      const j0 = Math.max(0, Math.floor(c.minZ - B - this.z0));
      const j1 = Math.min(n - 1, Math.floor(c.maxZ + B - this.z0));
      for (let iz = j0; iz <= j1; iz++) {
        const z = this.z0 + iz + 0.5;
        if (z < c.minZ - B || z > c.maxZ + B) continue;
        for (let ix = i0; ix <= i1; ix++) {
          const x = this.x0 + ix + 0.5;
          if (x >= c.minX - B && x <= c.maxX + B) this.open[iz * n + ix] = 0;
        }
      }
    }
    // what kind of ground is where, on a 4 m sample
    this.quay = [];
    this.square = [];
    this.street = [];
    const ring = (x: number, z: number, r: number, k: number, test: (x: number, z: number) => boolean) => {
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        if (!test(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
      }
      return true;
    };
    const water = (x: number, z: number) => {
      const f = flags(x, z);
      return f !== undefined && (f & WATER) !== 0 && (f & WALL) === 0;
    };
    for (let iz = 2; iz < n - 2; iz += 4) {
      for (let ix = 2; ix < n - 2; ix += 4) {
        if (!this.open[iz * n + ix]) continue;
        const x = this.x0 + ix + 0.5;
        const z = this.z0 + iz + 0.5;
        const nearWater = !ring(x, z, 2.5, 8, (a, b) => !water(a, b)) || !ring(x, z, 4.5, 8, (a, b) => !water(a, b));
        if (nearWater) this.quay.push({ x, z });
        else if (ring(x, z, 5, 12, (a, b) => this.isOpen(a, b)) && ring(x, z, 8, 16, (a, b) => this.isOpen(a, b))) this.square.push({ x, z });
        else this.street.push({ x, z });
      }
    }
    this.measureClear();
    this.built = true;
    return true;
  }

  cell(x: number, z: number): number {
    const ix = Math.floor(x - this.x0);
    const iz = Math.floor(z - this.z0);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }

  isOpen(x: number, z: number): boolean {
    const c = this.cell(x, z);
    return c >= 0 && this.open[c] === 1;
  }

  /** Someone bumped into something the walk map does not know (a cart, a crate): close the cell. */
  block(x: number, z: number): void {
    const c = this.cell(x, z);
    if (c >= 0) this.open[c] = this.clear[c] = 0;
  }

  /** The cells to the nearest closed one, counted in steps of eight ways (two sweeps). */
  private measureClear(): void {
    const { n, open, clear } = this;
    for (let k = 0; k < n * n; k++) clear[k] = open[k] ? 255 : 0;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const k = iz * n + ix;
        if (!clear[k]) continue;
        let m = clear[k];
        if (ix > 0) m = Math.min(m, clear[k - 1] + 1);
        if (iz > 0) {
          m = Math.min(m, clear[k - n] + 1);
          if (ix > 0) m = Math.min(m, clear[k - n - 1] + 1);
          if (ix < n - 1) m = Math.min(m, clear[k - n + 1] + 1);
        }
        clear[k] = m;
      }
    }
    for (let iz = n - 1; iz >= 0; iz--) {
      for (let ix = n - 1; ix >= 0; ix--) {
        const k = iz * n + ix;
        if (!clear[k]) continue;
        let m = clear[k];
        if (ix < n - 1) m = Math.min(m, clear[k + 1] + 1);
        if (iz < n - 1) {
          m = Math.min(m, clear[k + n] + 1);
          if (ix < n - 1) m = Math.min(m, clear[k + n + 1] + 1);
          if (ix > 0) m = Math.min(m, clear[k + n - 1] + 1);
        }
        clear[k] = m;
      }
    }
  }

  /** How many cells from the nearest closed one (0: closed or off the grid). */
  clearAt(x: number, z: number): number {
    const c = this.cell(x, z);
    return c >= 0 ? this.clear[c] : 0;
  }

  inside(x: number, z: number, margin = 2): boolean {
    return x > this.x0 + margin && z > this.z0 + margin && x < this.x0 + this.n - margin && z < this.z0 + this.n - margin;
  }

  /** The nearest open cell centre within r cells, or null. */
  nearestOpen(x: number, z: number, r = 3): V | null {
    const c = this.cell(x, z);
    if (c >= 0 && this.open[c]) return { x, z };
    const ix0 = Math.floor(x - this.x0);
    const iz0 = Math.floor(z - this.z0);
    for (let d = 1; d <= r; d++) {
      for (let dz = -d; dz <= d; dz++) {
        for (let dx = -d; dx <= d; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
          const ix = ix0 + dx;
          const iz = iz0 + dz;
          if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) continue;
          if (this.open[iz * this.n + ix]) return { x: this.x0 + ix + 0.5, z: this.z0 + iz + 0.5 };
        }
      }
    }
    return null;
  }

  /** Is the straight line from a to b open all the way? */
  lineOpen(ax: number, az: number, bx: number, bz: number, wide?: (cell: number) => boolean): boolean {
    const L = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(L / 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      if (!this.isOpen(x, z)) return false;
      if (wide && !wide(this.cell(x, z))) return false;
      // near a solid: clear of it by a body's width (the cell may be open while its corner is not)
      const k = this.cell(x, z);
      if (k >= 0 && this.near[k]) {
        for (const r of this.nearList.get(k)!) if (x > r.minX - NEAR_M && x < r.maxX + NEAR_M && z > r.minZ - NEAR_M && z < r.maxZ + NEAR_M) return false;
      }
    }
    return true;
  }

  /**
   * A* over the open cells, straightened into a few waypoints. Null if there is no way. The way ends on
   * the target itself, or (fixes 2026-09-27) where the target is off the grid and `standAt` says no body
   * stands there (in a house, a thing on it), on the open cell nearest to it: they walked on the spot
   * against the wall before it.
   */
  path(sx: number, sz: number, tx: number, tz: number, maxExpand = 9000, standAt?: (x: number, z: number) => boolean, minClear = 0): V[] | null {
    const s0 = this.nearestOpen(sx, sz, 2);
    const t0 = this.nearestOpen(tx, tz, 2);
    if (!s0 || !t0) return null;
    const s = this.cell(s0.x, s0.z);
    const t = this.cell(t0.x, t0.z);
    const n = this.n;
    const tix = t % n;
    const tiz = (t / n) | 0;
    const six = s % n;
    const siz = (s / n) | 0;
    // with `minClear` (a dray): only cells that far from a wall, but for the few by the start and the end
    const wideOk = (c: number) => {
      if (c < 0) return false;
      if (this.clear[c] >= minClear) return true;
      const cx = c % n;
      const cz = (c / n) | 0;
      const r = minClear + 1;
      return (Math.abs(cx - six) <= r && Math.abs(cz - siz) <= r) || (Math.abs(cx - tix) <= r && Math.abs(cz - tiz) <= r);
    };
    const h = (c: number) => {
      const dx = Math.abs((c % n) - tix);
      const dz = Math.abs(((c / n) | 0) - tiz);
      return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz);
    };
    const id = ++this.search;
    const { g, f, from, stamp, closed, heap, open } = this;
    let size = 0;
    const push = (c: number) => {
      let i = size++;
      heap[i] = c;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (f[heap[p]] <= f[heap[i]]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      heap[0] = heap[--size];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < size && f[heap[l]] < f[heap[m]]) m = l;
        if (r < size && f[heap[r]] < f[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
      return top;
    };
    stamp[s] = id;
    g[s] = 0;
    f[s] = h(s);
    from[s] = -1;
    push(s);
    let found = false;
    let expanded = 0;
    while (size > 0 && expanded < maxExpand) {
      const c = pop();
      if (closed[c] === id) continue;
      closed[c] = id;
      if (c === t) {
        found = true;
        break;
      }
      expanded++;
      const cx = c % n;
      const cz = (c / n) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
          const nc = nz * n + nx;
          if (!open[nc] || closed[nc] === id) continue;
          if (minClear && !wideOk(nc)) continue;
          // no cutting corners past a wall
          if (dx && dz && (!open[cz * n + nx] || !open[nz * n + cx])) continue;
          const ng = g[c] + (dx && dz ? 1.4142 : 1);
          if (stamp[nc] === id && ng >= g[nc]) continue;
          stamp[nc] = id;
          g[nc] = ng;
          f[nc] = ng + h(nc);
          from[nc] = c;
          push(nc);
        }
      }
    }
    if (!found) return null;
    const cells: V[] = [];
    for (let c = t; c !== -1; c = from[c]) cells.push({ x: this.x0 + (c % n) + 0.5, z: this.z0 + ((c / n) | 0) + 0.5 });
    cells.reverse();
    if (this.isOpen(tx, tz) || !standAt || standAt(tx, tz)) cells[cells.length - 1] = { x: tx, z: tz };
    // string pulling: keep only the corners
    const out: V[] = [];
    let anchor: V = { x: sx, z: sz };
    for (let i = 1; i < cells.length; i++) {
      if (!this.lineOpen(anchor.x, anchor.z, cells[i].x, cells[i].z, minClear ? wideOk : undefined)) {
        out.push(cells[i - 1]);
        anchor = cells[i - 1];
      }
    }
    out.push(cells[cells.length - 1]);
    return out;
  }
}

// ------------------------------------------------------------------ the crowd

export class Crowd {
  private readonly people: Person[] = [];
  private readonly clusters: Cluster[] = [];
  /** Crates left behind by a group that got up: taken away once nobody sees them. */
  private strays: Array<{ mesh: THREE.Mesh; rect: Rect | null }> = [];
  private readonly pool = new Map<HumanKind, Human[]>();
  private readonly grid: NavGrid;
  private readonly budget: number;
  private readonly radius: number;
  private places: BusyPlace[];
  private hour = 9;
  private nextId = 1;
  private readonly quayRail: boolean;
  private ready = false;
  private filled = false;
  private spawnT = 0;
  private cullT = 0;
  private turnoverT = 4;
  private gridAge = 0;
  private solidCount = -1;
  private solidVersion = -1;
  private pathBudget = 0;
  private fogFar = 25;
  private player: V = { x: 0, z: 0 };
  private camera: THREE.Camera | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly m4 = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly tmp = new THREE.Vector3();
  private crateMat: THREE.Material;
  private crateGeo: THREE.BufferGeometry;
  /** The props (for the carters' handcarts and the crates they sit on), once loaded. */
  private cartProps: Props | null = null;
  private readonly carts = new Map<Person, PushCart>();
  private readonly lanternGeo: THREE.BufferGeometry;
  private readonly lanternCapGeo: THREE.BufferGeometry;
  private readonly lanternMat: THREE.Material;
  private readonly lanternIron: THREE.Material;
  private readonly haloMat: THREE.SpriteMaterial;
  private stats_ = { alive: 0, drawn: 0, animated: 0, target: 0, clusters: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly ground: CrowdGround,
    places: BusyPlace[] = [],
    opts: CrowdOptions = {},
  ) {
    this.budget = opts.budget ?? 32;
    this.radius = opts.radius ?? 70;
    this.quayRail = opts.quayRail ?? false;
    this.places = places;
    this.grid = new NavGrid(this.radius + 12);
    this.crateMat = opts.mats?.crate ?? psx(new THREE.MeshLambertMaterial({ color: 0x4a3a28 }));
    this.crateGeo = new THREE.BoxGeometry(0.5, 0.45, 0.4).translate(0, 0.225, 0);
    this.lanternGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.16, 4).translate(0, -0.08, 0);
    this.lanternCapGeo = new THREE.ConeGeometry(0.075, 0.07, 4).translate(0, 0.035, 0);
    // M7 fog lamps: the glass fogs with its carrier (world/lampFog.ts; a lit one a little further)
    this.lanternMat = new THREE.MeshBasicMaterial({ color: 0xffc070 });
    lampFog(this.lanternMat, 1.2);
    this.lanternIron = psx(new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45 });
    whenHumans(() => (this.ready = true));
    // the carters' handcarts, and a proper packing crate to sit on (props.glb)
    loadProps()
      .then((pr) => {
        this.cartProps = pr;
        const seat = pr.parts("crate_seat")[0];
        if (seat) {
          this.crateGeo = seat.geometry;
          this.crateMat = seat.material;
        }
      })
      .catch(() => {});
  }

  /** Hour of the day, 0-24: how many are out, and lanterns after dark. */
  setHour(h: number): void {
    this.hour = ((h % 24) + 24) % 24;
  }

  /** The busy places of the map (the game passes them; the map is being redrawn). */
  setPlaces(places: BusyPlace[]): void {
    this.places = places;
  }

  /** Dev: how many are alive, drawn and animated this frame. */
  get stats(): Readonly<Crowd["stats_"]> {
    return this.stats_;
  }

  /** M7 walk-up (dev/popcheck.ts): called in every update once the view is known. */
  onFrame: (() => void) | null = null;

  /** M7 walk-up: in Jef's view now (within the fog's reach and in the camera's frustum)? */
  inView(x: number, z: number, r = 1.3): boolean {
    return Math.hypot(x - this.player.x, z - this.player.z) < this.fogFar + 4 && this.inFrustum(x, z, r);
  }

  /**
   * The overlap check (2026-09-27, `__scheldemist.overlaps()`): pairs within `near` m of (x, z) whose middles are
   * nearer than `min` m, with what each is doing. Should list nothing but a couple arm in arm.
   */
  overlaps(x: number, z: number, near = 40, min = 0.45): Array<{ a: Puppet; b: Puppet; d: number; what: string }> {
    const out: Array<{ a: Puppet; b: Puppet; d: number; what: string }> = [];
    const doing = (p: Person) => `${p.kind} ${p.role}/${p.state}/${p.human.motion}${this.shoveWeight(p) ? "" : " (held)"}`;
    const ps = this.people.filter((p) => Math.hypot(p.x - x, p.z - z) < near && p.role !== "remote");
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i].x - ps[j].x, ps[i].z - ps[j].z);
        if (d < min) out.push({ a: ps[i], b: ps[j], d: Math.round(d * 100) / 100, what: `${doing(ps[i])} + ${doing(ps[j])}` });
      }
    return out;
  }

  /** M7 walk-up (dev/popcheck.ts): everyone the crowd walks now. Read only. */
  get walking(): readonly Puppet[] {
    return this.people;
  }

  update(dt: number, player: V, camera?: THREE.Camera): void {
    if (!this.ready) return;
    this.player.x = player.x;
    this.player.z = player.z;
    this.camera = camera ?? null;
    const g = this.grid;
    this.gridAge += dt;
    // rebuild when the player has moved on, now and then, and when things were put down or taken away
    // (by the world's solids version, at most twice a second: a lock beam swinging moves every frame;
    // without a version, by the count of solids)
    const ver = this.ground.solidsVersion?.();
    let solids: Rect[] | null = null;
    const changed = ver !== undefined ? ver !== this.solidVersion && this.gridAge > 0.5 : (solids = this.ground.solids?.() ?? []).length !== this.solidCount;
    if (!g.built || Math.hypot(player.x - g.cx, player.z - g.cz) > 20 || this.gridAge > 60 || changed) {
      solids ??= this.ground.solids?.() ?? [];
      if (!g.build(this.ground.flags, player.x, player.z, solids, this.ground.narrow)) return;
      this.gridAge = 0;
      this.solidCount = solids.length;
      this.solidVersion = ver ?? -1;
    }
    this.fogFar = (this.scene.fog as THREE.Fog | null)?.far ?? 40;
    if (camera) {
      camera.updateMatrixWorld();
      this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.m4);
    }
    // M7 walk-up (dev/popcheck.ts): who is in view now, once the view is known
    this.onFrame?.();
    this.pathBudget = 3;

    // --- how many, by the hour
    // M3e: with the town's residents about (puppets), the nameless crowd stays home
    const target = this.anonymous ? Math.round(this.budget * density(this.hour)) : 0;
    const crowdN = this.people.length - this.puppetCount;
    // (backwards: recycle takes out only the one it is given)
    for (let i = this.people.length - 1; i >= 0; i--) {
      const p = this.people[i];
      if (p.role !== "puppet" && p.role !== "remote" && !p.townFollow && Math.hypot(p.x - player.x, p.z - player.z) > this.radius + 8) this.recycle(p);
    }
    if (!this.filled) {
      // the first fill may put people anywhere (the start screen is up)
      for (let i = 0; i < 60 && this.people.length - this.puppetCount < target; i++) this.spawn(true);
      this.filled = true;
    } else if (crowdN < target) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        this.spawn(false);
        this.spawnT = 0.35;
      }
    } else if (crowdN > target + (this.anonymous ? 1 : 0)) {
      this.cullT -= dt;
      if (this.cullT <= 0) {
        this.cullT = this.anonymous ? 1.5 : 0.3;
        // out of sight, and the ones who least belong at this hour first
        const out = this.people
          .filter((p) => !p.shown && !p.cluster && !p.lead && p.role !== "puppet" && p.role !== "remote")
          .sort((a, b) => this.belongs(a) - this.belongs(b))[0];
        if (out) this.recycle(out);
      }
    }
    this.turnoverT -= dt;
    if (this.turnoverT <= 0 && this.filled) {
      // after dark the town changes, out of sight: children and maids go home, lanterns are lit
      this.turnoverT = 4;
      if (isNight(this.hour)) {
        for (const p of this.people) {
          if (p.shown || p.cluster || p.lead || p.role === "puppet" || p.role === "remote") continue;
          if (this.belongs(p) < 0.35) {
            this.recycle(p);
            break;
          }
          if (!p.lanternRoll) {
            p.lanternRoll = true;
            if (!LOADED.has(p.kind) && !p.handCarry && Math.random() < (p.kind === "police" ? 1 : 0.35)) this.giveLantern(p);
          }
        }
      } else {
        for (const p of this.people) if (!p.shown) p.lanternRoll = false;
        const lit = this.people.find((p) => p.lantern && !p.shown && p.role !== "puppet" && p.role !== "remote");
        if (lit) this.dropLantern(lit);
      }
    }

    // --- groups
    // (backwards: a group that breaks up takes only itself out of the list)
    for (let i = this.clusters.length - 1; i >= 0; i--) this.updateCluster(this.clusters[i], dt);
    if (this.strays.length) {
      this.strays = this.strays.filter((s) => {
        if (!this.hidden(s.mesh.position.x, s.mesh.position.z)) return true;
        this.scene.remove(s.mesh);
        if (s.rect) this.ground.removeCollider?.(s.rect);
        return false;
      });
    }

    // --- everyone
    this.lanes = this.vehicleLanes(dt);
    let drawn = 0;
    let animated = 0;
    for (const p of this.people) {
      p.chatCd -= dt;
      if (!this.giveWay(p, dt)) this.think(p, dt);
    }
    this.keepApart(dt);
    for (const p of this.people) {
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      const inView = d < this.fogFar + 4 && this.inFrustum(p.x, p.z, 1.3 * p.size);
      p.shown = inView;
      p.group.visible = inView;
      let y = 0;
      if (inView) {
        drawn++;
        // near ones every frame, far ones at 15 fps, the farthest at 8 (M6 population: up to a
        // hundred in view; a figure 45 m off is a few pixels high at 270 lines)
        p.animAcc += dt;
        if (d < ANIM_NEAR || p.animAcc >= (d < ANIM_FAR ? 1 / 15 : 1 / 8)) {
          p.human.update(p.animAcc);
          p.animAcc = 0;
          animated++;
        }
      }
      // M6 lively (humans.ts motionLift): down on the knees, on a chair, crouched (eased), or a hop (at once)
      const lift = p.state === "sit" ? 0 : p.human.motionLift() * p.size;
      const want = p.state === "sit" ? p.human.sitDrop() * p.size : Math.min(0, lift);
      p.drop += (want - p.drop) * Math.min(1, dt * 4);
      if (inView) y = p.drop + Math.max(0, lift) + (p.state === "sit" ? 0 : p.human.bob() * p.size);
      p.group.position.set(p.x, y + (this.ground.baseAt?.(p.x, p.z) ?? 0), p.z);
      p.group.rotation.y = p.yaw;
      if (p.veh) this.moveVehicle(p, dt, inView);
      else if (p.kind === "carter") this.pushCart(p, dt, inView);
      if (p.lantern) this.placeLantern(p, d);
    }
    this.stats_ = { alive: this.people.length, drawn, animated, target, clusters: this.clusters.length };
  }

  dispose(): void {
    for (const p of [...this.people]) this.recycle(p);
    for (const list of this.pool.values()) for (const h of list) h.dispose();
    this.pool.clear();
  }

  // ---------------------------------------------------------------- puppets (M3e, town.ts)
  // The town's residents: town.ts decides where each one goes and what they do
  // there; the crowd walks them on its grid (A*, keep right, go round the
  // player, stuck checks), draws, animates and pools them like everyone else.

  /** The nameless crowd (off when the town brings its residents). */
  anonymous = true;
  private get puppetCount(): number {
    let n = 0;
    for (const p of this.people) if (p.role === "puppet" || p.role === "remote" || p.townFollow) n++;
    return n;
  }

  /** A resident appears at (x, z); null while the models load. `size`: his size (else a roll of the dice). */
  addPuppet(kind: HumanKind, x: number, z: number, yaw = 0, pace = 1.3, size?: number): Puppet | null {
    if (!this.ready) return null;
    const p = this.make(kind, x, z, "puppet");
    if (!p) return null;
    if (size !== undefined) {
      p.size = size;
      p.group.scale.setScalar(size);
    }
    p.yaw = yaw;
    p.pace = pace;
    p.state = "stand";
    p.pyaw = null;
    p.pmotion = "idle";
    p.lanternRoll = true;
    return p;
  }

  /** Walk there on the grid; the way is worked out over the next frames. */
  puppetGo(p: Puppet, x: number, z: number, pace?: number): void {
    if (pace) p.pace = pace;
    let tx = x;
    let tz = z;
    if (this.grid.built && !this.grid.inside(x, z, 4)) {
      // beyond the walk grid round Jef: head for its edge that way; the town sends them on from there
      for (let t = 1; t > 0.02; t -= 0.04) {
        const qx = p.x + (x - p.x) * t;
        const qz = p.z + (z - p.z) * t;
        if (!this.grid.inside(qx, qz, 4)) continue;
        const q = this.grid.nearestOpen(qx, qz, 4);
        if (q) {
          tx = q.x;
          tz = q.z;
          break;
        }
      }
    }
    // (the town and the followers send them every half second or so)
    const walking = p.state === "walk" && p.pi < p.path.length;
    // the same goal while on the way there: keep the way (a new one each time made them stutter)
    // (and its count of tries: sent again every frame, a way that failed was tried for ever, fixes 2026-09-27)
    if (walking && p.dest && Math.hypot(p.dest.x - tx, p.dest.z - tz) < 0.5) return;
    p.replans = 0;
    p.held = 0;
    // no way can be worked out this frame: walk on the old one, change over when one can
    if (walking && this.pathBudget <= 0) {
      p.dest = { x: tx, z: tz };
      p.repath = true;
      return;
    }
    this.goTo(p, { x: tx, z: tz });
  }

  /** Is (x, z) inside the walk grid round Jef (a puppet can be sent straight there)? */
  onGrid(x: number, z: number): boolean {
    return this.grid.built && this.grid.inside(x, z, 4);
  }

  /** Stand here, face this way (null: keep facing), play this. */
  puppetStand(p: Puppet, motion: Motion = "idle", yaw: number | null = null): void {
    p.path = [];
    p.pi = 0;
    p.dest = null;
    p.repath = false;
    p.state = "stand";
    p.pmotion = motion;
    p.pyaw = yaw;
    p.human.play(motion, 0.35);
  }

  /** Still on the way (walking, waiting for a path, held up)? */
  puppetBusy(p: Puppet): boolean {
    return p.state === "walk" || p.state === "wait" || p.state === "blocked" || (p.state === "pause" && !!p.dest);
  }

  /** A sack on the shoulder while walking (dockers between the quay and the door). */
  /** A load in the hands: a sack on the shoulder, or (the dockers of shared/hauls.ts at a pile of crates) a crate held before him. */
  puppetLoad(p: Puppet, on: boolean, kind: "sack" | "crate" | "fishbox" | "keg" = "sack", label?: SackLabel): void {
    p.handCarry = true;
    if (on && p.sack && p.sack.userData.kind !== kind) this.setLoad(p, false);
    p.loadKind = kind;
    // (what the sack says: the pile he takes it from, the mill's flour; the one sack model, game/sackModel.ts)
    if (label) p.sackLabel = label;
    this.setLoad(p, on);
    if (on && kind === "sack") {
      if (p.sack && label) relabel(p.sack as THREE.Mesh, label);
      p.human.setSackLabel(p.sackLabel ?? sackLabelFor(null));
    }
  }

  /** A lantern in hand (police at night, people with work for Jef after dark). */
  puppetLantern(p: Puppet, on: boolean): void {
    if (on && !p.lantern) this.giveLantern(p);
    else if (!on && p.lantern) {
      this.dropLantern(p);
    }
  }

  /**
   * M3i (game/market.ts): something bought, in the right hand: fish wrapped in paper, a
   * parcel, a small sack or a basket; null to put it away.
   */
  puppetCarry(p: Puppet, what: "parcel" | "fish" | "sack" | "basket" | null): void {
    if (p.bought) {
      p.bought.removeFromParent();
      p.bought = null;
    }
    if (!what || !p.hand) return;
    const m = new THREE.Mesh(...this.boughtParts(what));
    m.userData.what = what; // (M8b: sent with him to the other PCs)
    p.group.updateMatrixWorld(true);
    const s = new THREE.Vector3();
    p.hand.getWorldScale(s);
    m.scale.setScalar(1 / (s.x || 1));
    m.position.set(0, -0.07 / (s.x || 1), 0);
    p.hand.add(m);
    p.bought = m;
  }

  /** M3i: sit on a stool or a crate (men only: skirts do not sit); the body is lowered to the seat. */
  puppetSit(p: Puppet, yaw: number | null = null): void {
    this.puppetStand(p, "sit", yaw);
    if (p.human.canSit) p.state = "sit";
  }

  /**
   * Walk at another puppet's side, at their pace (two soldiers walking out: town.ts); null lets go.
   * The couple's side-by-side walk of the nameless crowd (follow): keep to the lead's right.
   */
  puppetFollow(p: Puppet, lead: Puppet | null): void {
    if (lead && lead !== p) {
      if (p.lead === lead && p.role === "follow") return;
      if (p.lead && p.lead.follower === p) p.lead.follower = null;
      p.role = "follow";
      p.townFollow = true;
      p.lead = lead;
      lead.follower = p;
      p.path = [];
      p.dest = null;
      p.repath = false;
      p.state = "stand";
    } else if (p.townFollow) {
      if (p.lead && p.lead.follower === p) p.lead.follower = null;
      p.lead = null;
      p.townFollow = false;
      p.role = "puppet";
      p.path = [];
      p.dest = null;
      p.repath = false;
      p.state = "stand";
      p.pmotion = "idle";
      // let go mid-stride: stand (the walk clip went on till the town gave a new pose, fixes 2026-09-27)
      p.human.play(p.veh ? this.vehMotion(p, false) : "idle", 0.3);
    }
  }

  /**
   * M6 transport: this townsperson rides a velocipede, pushes a handcart (with a number of things
   * on it) or leads a dray; null gets them off or lets go (the caller parks the machine or the
   * cart: see puppetCartAt). The crowd draws it, turns its wheels and pedals, and walks them on
   * its grid with the vehicle's reach.
   */
  puppetVehicle(p: Puppet, spec: PuppetVehicle | null): void {
    const had = p.veh;
    if (had && spec && had.spec.kind === spec.kind) {
      had.spec = spec;
      if (spec.kind === "cart") had.cart?.setItems(spec.items, spec.what, spec.label);
      if (spec.kind === "dray" && had.dray) {
        had.dray.loaded = spec.loaded;
        if (spec.sacks !== undefined) had.dray.setSacks(spec.sacks, spec.label);
      }
      return;
    }
    if (had) this.dropVehicle(p);
    if (!spec) return;
    const v: Vehicle = { spec, obj: null, dist: 0, lx: p.x, lz: p.z, speed: 0, was: { nose: p.nose, reach: p.reach, size: p.size } };
    p.veh = v;
    if (spec.kind === "velo") {
      // the machine is 1.7 m long: its front wheel about a metre before the man
      p.nose = 0.8;
      p.reach = 0.35;
      p.size = 1;
      p.group.scale.setScalar(1);
      void (this.veloProto ??= loadVelocipede()).then((proto) => {
        if (!proto || p.veh !== v) return;
        const m = proto.clone(true);
        m.rotation.order = "YXZ";
        v.obj = m;
        v.steer = m.getObjectByName("velocipede_steer") ?? null;
        v.front = m.getObjectByName("velocipede_front") ?? null;
        v.rear = m.getObjectByName("velocipede_rear") ?? null;
        this.scene.add(m);
      });
      p.human.play("ride", 0.2);
    } else if (spec.kind === "cart") {
      p.nose = CART.carter![0];
      p.reach = CART.carter![1];
      if (this.cartProps) {
        v.cart = new PushCart(this.scene, this.cartProps, { load: false });
        v.cart.setItems(spec.items, spec.what, spec.label);
        v.cart.place(p.x + Math.sin(p.yaw) * 0.5, p.z + Math.cos(p.yaw) * 0.5, p.yaw);
        for (const r of v.cart.rects) this.ground.addMover?.(r);
      }
    } else if (spec.kind === "dray") {
      if (this.cartProps) {
        v.dray = new LedDray(this.scene, this.cartProps, "sacks");
        v.dray.loaded = spec.loaded;
        if (spec.sacks !== undefined) v.dray.setSacks(spec.sacks, spec.label);
        v.dray.place(p.x, p.z, p.yaw);
        for (const r of v.dray.rects) this.ground.addMover?.(r);
      }
    }
  }

  /** M6: what this puppet rides, pushes or leads now (null: nothing). */
  puppetVehicleOf(p: Puppet): PuppetVehicle | null {
    return p.veh?.spec ?? null;
  }

  /** M6: where the cart stands (its axle, the way it points), to park it where he let go. */
  puppetCartAt(p: Puppet): { x: number; z: number; yaw: number } | null {
    return p.veh?.cart?.axle ?? null;
  }

  private veloProto: Promise<THREE.Object3D | null> | null = null;

  /** The clip for someone with a vehicle: pedalling, pushing, or walking at the horse's head. */
  private vehMotion(p: Person, moving: boolean): Motion {
    const k = p.veh!.spec.kind;
    if (k === "velo") return "ride";
    if (k === "cart") return moving ? (p.kind === "carter" || p.kind === "porter" ? "walk" : "push") : "idle";
    return moving ? "walk" : "idle";
  }

  /** Each frame: the velocipede under him (wheels and pedals by the ground covered), the cart before him, the dray behind. */
  private moveVehicle(p: Person, dt: number, shown: boolean): void {
    const v = p.veh!;
    const step = Math.hypot(p.x - v.lx, p.z - v.lz);
    v.lx = p.x;
    v.lz = p.z;
    v.speed += (Math.min(6, step / Math.max(dt, 1e-3)) - v.speed) * Math.min(1, dt * 6);
    v.dist += step;
    const base = this.ground.baseAt?.(p.x, p.z) ?? 0;
    if (v.spec.kind === "velo") {
      // on the saddle: the body raised and set back over it; the pedals turn with the front wheel
      const lift = p.human.rideLift();
      p.group.position.set(p.x - Math.sin(p.yaw) * RIDE_BACK, base + lift, p.z - Math.cos(p.yaw) * RIDE_BACK);
      const turn = v.dist / WHEEL_R.front;
      p.human.play("ride", 0.2);
      p.human.setPhase("ride", turn / (Math.PI * 2));
      if (v.obj) {
        v.obj.visible = shown;
        v.obj.position.set(p.x, base, p.z);
        v.obj.rotation.y = p.yaw;
        if (v.front) v.front.rotation.x = turn;
        if (v.rear) v.rear.rotation.x = v.dist / WHEEL_R.rear;
      }
      return;
    }
    if (v.spec.kind === "cart" && v.cart) {
      const walking = p.state === "walk";
      const hands = handsOf(p.human, p.group, p.x, p.z, p.yaw);
      v.cart.push(dt, hands.x, hands.z, hands.y, p.yaw, walking ? 1 : 0);
      v.cart.visible = shown;
      return;
    }
    if (v.spec.kind === "dray" && v.dray) {
      v.dray.follow(dt, p.x, p.z, p.yaw, p.state === "walk" ? v.speed : 0);
      v.dray.visible = Math.hypot(p.x - this.player.x, p.z - this.player.z) < this.fogFar + 10;
    }
  }

  private dropVehicle(p: Person): void {
    const v = p.veh;
    if (!v) return;
    v.obj?.removeFromParent();
    for (const r of [...(v.cart?.rects ?? []), ...(v.dray?.rects ?? [])]) this.ground.removeMover?.(r);
    v.cart?.dispose();
    v.dray?.dispose();
    p.nose = v.was.nose;
    p.reach = v.was.reach;
    p.size = v.was.size;
    p.group.scale.setScalar(p.size);
    p.veh = null;
    p.human.play(p.pmotion ?? "idle", 0.3);
  }

  /** Is this puppet walking at someone's side now? */
  puppetFollowing(p: Puppet): boolean {
    return p.role === "follow" && !!p.lead;
  }

  // ---------------------------------------------------------------- M8b: townspeople another PC walks

  /** A townsperson walked by another player's PC appears here (net/mp/street.ts); null while the models load. */
  addRemote(kind: HumanKind, x: number, z: number, yaw: number, size: number): Puppet | null {
    if (!this.ready) return null;
    const p = this.make(kind, x, z, "remote");
    if (!p) return null;
    p.yaw = yaw;
    p.size = size;
    p.group.scale.setScalar(size);
    p.state = "stand";
    p.pyaw = null;
    p.pmotion = "idle";
    p.lanternRoll = true;
    return p;
  }

  /**
   * A puppet this PC walked goes to another PC (on), or one another PC walked comes to this one (off): the same
   * figure, where it stands, so there is no jump (the handover goes on from the last state: docs/milestones/M8b.md).
   */
  puppetRemote(p: Puppet, on: boolean): void {
    if (on) {
      if (p.role === "remote") return;
      this.puppetFollow(p, null);
      p.role = "remote";
    } else {
      if (p.role !== "remote") return;
      p.role = "puppet";
      p.pmotion = !p.human.motion || p.human.motion === "walk" ? "idle" : p.human.motion;
    }
    p.path = [];
    p.pi = 0;
    p.dest = null;
    p.repath = false;
    p.held = 0;
    if (p.state !== "sit") p.state = "stand";
  }

  /** Is this one walked by another PC? */
  isRemote(p: Puppet): boolean {
    return p.role === "remote";
  }

  /** M8b: what an owner sends of a puppet (read by net/mp/street.ts). */
  puppetLook(p: Puppet): { motion: Motion; sit: boolean; lantern: boolean; sack: boolean; bought: "parcel" | "fish" | "sack" | "basket" | null; veh: PuppetVehicle | null } {
    return {
      motion: p.human.motion ?? "idle",
      sit: p.state === "sit",
      lantern: !!p.lantern,
      sack: p.handCarry && p.loaded && !!p.sack,
      bought: (p.bought?.userData.what as "parcel" | "fish" | "sack" | "basket" | undefined) ?? null,
      veh: p.veh?.spec ?? null,
    };
  }

  /** M8b: a remote townsperson as his owner drew him (interpolated by net/mp/street.ts). */
  applyRemote(
    p: Puppet,
    a: { x: number; z: number; yaw: number; speed: number; motion: Motion; size: number; sit: boolean; lantern: boolean; sack: boolean; bought: "parcel" | "fish" | "sack" | "basket" | null; veh: PuppetVehicle | null },
  ): void {
    if (p.role !== "remote") return;
    p.x = a.x;
    p.z = a.z;
    p.yaw = a.yaw;
    if (Math.abs(a.size - p.size) > 0.004 && !p.veh) {
      p.size = a.size;
      p.group.scale.setScalar(a.size);
    }
    const moving = a.speed > 0.15;
    p.state = a.sit && p.human.canSit ? "sit" : moving ? "walk" : "stand";
    // the walk's pace from the speed he is drawn at (the research: no sliding feet)
    const motion = a.motion === "walk" && !moving ? "idle" : a.motion;
    p.human.play(motion, 0.25);
    if (moving && motion !== "ride") p.human.setPace(a.speed / p.size);
    p.pace = Math.max(0.3, a.speed);
    if (a.lantern !== !!p.lantern) this.puppetLantern(p, a.lantern);
    if (a.sack !== !!p.sack) this.puppetLoad(p, a.sack);
    const had = (p.bought?.userData.what as string | undefined) ?? null;
    if (had !== a.bought) this.puppetCarry(p, a.bought);
    const v = p.veh?.spec ?? null;
    if (JSON.stringify(v) !== JSON.stringify(a.veh)) this.puppetVehicle(p, a.veh);
  }

  private boughtGeo: Partial<Record<string, [THREE.BufferGeometry, THREE.Material]>> = {};
  private boughtParts(what: "parcel" | "fish" | "sack" | "basket"): [THREE.BufferGeometry, THREE.Material] {
    const had = this.boughtGeo[what];
    if (had) return had;
    const paper = psx(new THREE.MeshLambertMaterial({ color: 0xc8bea4 }));
    const made: Record<string, () => [THREE.BufferGeometry, THREE.Material]> = {
      // fish wrapped in paper: a long thin roll, the tail out of one end
      fish: () => [new THREE.CylinderGeometry(0.045, 0.06, 0.32, 5).rotateZ(Math.PI / 2).translate(0, -0.04, 0), paper],
      parcel: () => [new THREE.BoxGeometry(0.2, 0.12, 0.14).translate(0, -0.08, 0), paper],
      // a small sack of the one sack model, stood up, hanging from the hand (game/sackModel.ts)
      sack: () => {
        const lot = sackOf("flour", "a baker's bag");
        return [labelGeo(standingSackGeometry("flour").clone().scale(0.34, 0.34, 0.34).translate(0, -0.3, 0), lot), sackMaterial(lot)];
      },
      basket: () => [new THREE.CylinderGeometry(0.17, 0.13, 0.18, 6).translate(0, -0.2, 0), psx(new THREE.MeshLambertMaterial({ color: 0x7a6038 }))],
    };
    const r = made[what]();
    this.boughtGeo[what] = r;
    return r;
  }

  removePuppet(p: Puppet): void {
    this.recycle(p);
  }

  /** Is this puppet still in the crowd? */
  alive(p: Puppet): boolean {
    return this.people.includes(p);
  }

  /** Out of Jef's sight (in the fog, behind him, round a corner)? */
  isHidden(x: number, z: number): boolean {
    return this.hidden(x, z);
  }

  /** Can someone stand here (walk map, colliders, the grid)? */
  canStand(x: number, z: number): boolean {
    return this.grid.built && this.grid.isOpen(x, z) && this.ground.isFree(x, z, 0.3);
  }

  /** The nearest open grid point, for a puppet that would appear in a wall. */
  openNear(x: number, z: number): V | null {
    return this.grid.built ? this.grid.nearestOpen(x, z, 4) : null;
  }

  /** The walk on the grid round Jef from a to b (corner points), or null (fixes 2026-09-24: where a townsperson steps out on the way to an event). */
  pathOn(ax: number, az: number, bx: number, bz: number): V[] | null {
    if (!this.grid.built || !this.grid.inside(bx, bz, 2)) return null;
    const a = this.grid.nearestOpen(ax, az, 6);
    return a ? this.grid.path(a.x, a.z, bx, bz, 6000) : null;
  }

  /** Where everyone walking is now (townspeople included): the train and the omnibus stop for them.
   *  One reused list, refilled on every call: read it now, do not keep or change it. */
  positions(): Array<{ x: number; z: number }> {
    const out = this.posOut;
    const n = this.people.length;
    for (let i = 0; i < n; i++) {
      const p = this.people[i];
      const o = out[i] ?? (out[i] = { x: 0, z: 0 });
      o.x = p.x;
      o.z = p.z;
    }
    out.length = n;
    return out;
  }
  private readonly posOut: Array<{ x: number; z: number }> = [];

  get fogDistance(): number {
    return this.fogFar;
  }

  private puppetThink(p: Person, dt: number): void {
    switch (p.state) {
      case "walk":
        // a goal from puppetGo that waited for a path budget: take the new way now
        if (p.repath && this.pathBudget > 0 && p.dest) {
          this.goTo(p, p.dest);
          if (p.state !== "walk") break;
        }
        this.walk(p, dt);
        break;
      case "wait":
        if (p.dest) this.goTo(p, p.dest);
        break;
      case "blocked":
        // Jef in the way: face him, wait, then find a way round
        p.human.play(p.veh ? this.vehMotion(p, false) : "idle", 0.3);
        this.face(p, Math.atan2(this.player.x - p.x, this.player.z - p.z), dt);
        p.held += dt;
        if (Math.hypot(this.player.x - p.x, this.player.z - p.z) > 1.4 + p.nose) p.state = "walk";
        else if (p.held > 1.2 && (p.sinceDetour < 5 || !this.detour(p))) {
          p.held = 0;
          this.next(p, true);
        }
        break;
      case "pause":
        p.timer -= dt;
        if (p.timer <= 0) {
          if (p.dest) this.goTo(p, p.dest);
          else p.state = "stand";
        }
        break;
      default:
        this.shoo(p, dt);
        if (p.pyaw != null) this.face(p, p.pyaw, dt);
    }
  }

  // ---------------------------------------------------------------- per person

  private think(p: Person, dt: number): void {
    p.sinceDetour += dt;
    if (p.role === "remote") return; // M8b: another PC walks him
    if (p.role === "puppet") {
      this.puppetThink(p, dt);
      return;
    }
    if (p.role === "follow") {
      this.follow(p, dt);
      return;
    }
    switch (p.state) {
      case "walk":
        this.walk(p, dt);
        break;
      case "wait":
        // waiting for a path (only a few are worked out each frame)
        if (p.dest) this.goTo(p, p.dest);
        break;
      case "blocked":
        // someone (the player) stands in the way: face them, wait, then go round
        p.human.play("idle", 0.3);
        this.face(p, Math.atan2(this.player.x - p.x, this.player.z - p.z), dt);
        p.held += dt;
        if (Math.hypot(this.player.x - p.x, this.player.z - p.z) > 1.4 + p.nose) {
          p.state = "walk";
        } else if (p.held > 0.8 && p.held - dt <= 0.8) {
          // step aside and go round: first sideways, then past the player at arm's length
          // (a second block right after a way round: give up and go somewhere else)
          if (p.sinceDetour < 5 || !this.detour(p)) {
            p.held = 0;
            this.next(p, true);
          }
        } else if (p.held > 3) {
          p.held = 0;
          this.next(p, true);
        }
        break;
      case "pause": {
        p.timer -= dt;
        this.shoo(p, dt);
        const f = p.follower;
        if (f && Math.hypot(f.x - p.x, f.z - p.z) < 1.5) {
          // a couple stops: they turn to each other and take turns talking
          this.face(p, Math.atan2(f.x - p.x, f.z - p.z), dt);
          const turn = Math.floor(p.timer / 2.8) % 2 === 0;
          p.human.play(turn ? "talk" : this.standMotion(p), 0.4);
          f.human.play(turn ? this.standMotion(f) : "talk", 0.4);
        }
        if (p.timer <= 0) this.next(p);
        break;
      }
      case "chat": {
        p.timer -= dt;
        const q = p.partner;
        if (q) this.face(p, Math.atan2(q.x - p.x, q.z - p.z), dt);
        if (p.timer <= 0 || !q || q.partner !== p) {
          if (q && q.partner === p) {
            q.partner = null;
            q.state = "walk";
          }
          p.partner = null;
          p.state = "walk";
        } else if ((p.human.motion === "talk") !== (Math.floor(p.timer / 3.2) % 2 === (p.id < q.id ? 0 : 1))) {
          // take turns: one talks, the other listens
          p.human.play(p.human.motion === "talk" ? this.standMotion(p) : "talk", 0.4);
        }
        this.shoo(p, dt);
        break;
      }
      case "stand": {
        this.shoo(p, dt);
        const c = p.cluster;
        if (c) this.face(p, c.look ?? Math.atan2(c.x - p.x, c.z - p.z), dt);
        break;
      }
      case "sit":
        break;
    }
  }

  /** Arms folded or hanging, for a man or a woman standing about; at the quay edge, looking out. */
  private standMotion(p: Person): Motion {
    if (p.cluster?.look != null) return p.looks;
    return p.folds ? "fold" : "idle";
  }

  /** The one at a leader's side: keep to their right, at their pace; catch up by path if lost. */
  private follow(p: Person, dt: number): void {
    const l = p.lead;
    if (!l && p.townFollow) {
      // a townsperson whose companion went in or out of range: the town directs them again
      p.townFollow = false;
      p.role = "puppet";
      p.state = "stand";
      p.pmotion = "idle";
      p.human.play(p.veh ? this.vehMotion(p, false) : "idle", 0.3);
      return;
    }
    if (!l) {
      p.role = "wander";
      p.state = "pause";
      p.timer = rnd(0.5, 2);
      p.human.play(this.standMotion(p), 0.3);
      return;
    }
    if (p.state === "walk" && p.path.length) {
      // lost them earlier: on the way back to their side
      this.walk(p, dt);
      if (Math.hypot(l.x - p.x, l.z - p.z) < 1.5) p.path = [];
      return;
    }
    if (p.state === "wait" && p.dest) {
      this.goTo(p, p.dest);
      return;
    }
    // at the lead's side; where that is in a wall (a narrow alley, a house front), a step behind them
    // (fixes 2026-09-27: the side spot in a wall had the follower walking in place against it)
    let tx = l.x - Math.cos(l.yaw) * 0.62;
    let tz = l.z + Math.sin(l.yaw) * 0.62;
    if (!this.ground.isFree(tx, tz, 0.25)) {
      tx = l.x - Math.sin(l.yaw) * 0.9;
      tz = l.z - Math.cos(l.yaw) * 0.9;
    }
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    const walking = l.state === "walk";
    if (d > 0.12) {
      const sp = Math.min(d * 3, (walking ? l.pace : 0.8) * (d > 0.6 ? 1.3 : 1));
      const step = Math.min(d, sp * dt);
      const nx = p.x + (dx / d) * step;
      const nz = p.z + (dz / d) * step;
      if (this.stepFree(p, nx, nz)) {
        p.x = nx;
        p.z = nz;
        p.held = 0;
      } else p.held += dt;
      if (p.held > 2 && d > 2.5) {
        p.held = 0;
        this.goTo(p, { x: l.x, z: l.z });
        return;
      }
      this.face(p, walking ? l.yaw : Math.atan2(dx, dz), dt);
      if (p.held > 0) {
        // held up by a wall or a thing: stand and wait for the lead to move on, never walk on the spot
        p.human.play(this.stillMotion(p), 0.3);
        return;
      }
      p.human.play("walk", 0.25);
      p.human.setPace(sp / p.size);
    } else {
      p.state = "stand";
      if (walking) {
        this.face(p, l.yaw, dt);
        p.human.play("walk", 0.25);
        p.human.setPace(l.pace / p.size);
      } else if (l.state !== "pause" || !l.follower) {
        p.human.play(this.standMotion(p), 0.35);
      }
      if (!walking && l.state !== "pause") this.face(p, l.yaw, dt);
      if (!walking && l.state === "pause") this.face(p, Math.atan2(l.x - p.x, l.z - p.z), dt);
    }
  }

  private face(p: Person, yaw: number, dt: number): void {
    p.yaw += angDiff(yaw, p.yaw) * Math.min(1, dt * 5);
  }

  /** What someone plays while not moving: the vehicle's rest, a townsperson's own pose (never a walk), or a stand. */
  private stillMotion(p: Person): Motion {
    if (p.veh) return this.vehMotion(p, false);
    if (p.role === "puppet") return p.pmotion && !WALK_CLIPS.has(p.pmotion) ? p.pmotion : "idle";
    return this.standMotion(p);
  }

  /**
   * May this body step to (x, z)? Where the colliders let it (a body of 0.25 m). Someone already standing
   * where that does not hold (put there by a layer, pushed by a cart, a follower at a wall) may still step
   * to ground where a thinner body fits, so they walk out instead of walking on the spot (fixes 2026-09-27).
   */
  private stepFree(p: Person, x: number, z: number): boolean {
    // on the narrow ways (the wall's stairs) the grid keeps 0.3 m off the walls: so does the body there (the
    // world's test keeps r + 0.15; with 0.25 they stopped half way up, walking on the spot)
    if (this.ground.isFree(x, z, 0.25)) return true;
    const r = this.ground.narrow?.(x, z) ? 0.15 : 0.25;
    if (r < 0.25 && this.ground.isFree(x, z, r)) return true;
    return !this.ground.isFree(p.x, p.z, r) && this.ground.isFree(x, z, 0.1);
  }

  // ---------------------------------------------------------------- bodies keep apart

  /**
   * Nobody stands in someone else (Steve 2026-09-27: four townspeople in one another at a door). Steering
   * round others (walk) is only a lean: two sent to one spot, or one walking up to where another stands,
   * ended in the same place. Every frame, two bodies nearer than BODY_GAP are eased apart onto free ground,
   * the one on the move more than the one standing. Not moved: a body another layer holds on its spot (sat,
   * on a vehicle, at a task of lively or the back streets), another PC's townsperson, and a couple walking
   * side by side (the follower keeps its own 0.62 m).
   */
  private keepApart(dt: number): void {
    const list = this.people;
    const n = list.length;
    if (n < 2) return;
    const cap = BODY_SHOVE * dt;
    for (let i = 0; i < n; i++) {
      const p = list[i];
      const wp = this.shoveWeight(p);
      for (let j = i + 1; j < n; j++) {
        const q = list[j];
        let dx = q.x - p.x;
        let dz = q.z - p.z;
        if (dx > BODY_GAP || dx < -BODY_GAP || dz > BODY_GAP || dz < -BODY_GAP) continue;
        const gap = BODY_GAP * Math.min(1, (p.size + q.size) / 2);
        let d = Math.hypot(dx, dz);
        if (d >= gap || p.lead === q || q.lead === p) continue;
        const wq = this.shoveWeight(q);
        if (wp + wq === 0) continue;
        if (d < 1e-3) {
          // on the very same spot: apart in a way of their own (the same on every PC)
          const a = ((p.id * 7 + q.id * 13) % 360) * (Math.PI / 180);
          dx = Math.sin(a);
          dz = Math.cos(a);
          d = 1;
        } else {
          dx /= d;
          dz /= d;
        }
        const over = gap - Math.min(d, gap);
        const mp = Math.min(cap, (over * wp) / (wp + wq));
        const mq = Math.min(cap, (over * wq) / (wp + wq));
        if (mp > 0 && this.stepFree(p, p.x - dx * mp, p.z - dz * mp)) {
          p.x -= dx * mp;
          p.z -= dz * mp;
        }
        if (mq > 0 && this.stepFree(q, q.x + dx * mq, q.z + dz * mq)) {
          q.x += dx * mq;
          q.z += dz * mq;
        }
      }
    }
  }

  /** Does someone other than p stand (not walk) on this spot? */
  private spotTaken(p: Person, x: number, z: number): boolean {
    for (const q of this.people) {
      if (q === p || q.state === "walk" || q.lead === p || p.lead === q) continue;
      const dx = q.x - x;
      const dz = q.z - z;
      if (dx * dx + dz * dz < BODY_GAP * BODY_GAP) return true;
    }
    return false;
  }

  /** How readily a body is eased aside: 0 held on its spot by another layer, a little when standing, most when walking. */
  private shoveWeight(p: Person): number {
    if (p.role === "remote" || p.veh || p.seat || p.state === "sit" || p.kind === "carter") return 0;
    if (p.role === "puppet" && p.state !== "walk" && p.pmotion && !FREE_POSES.has(p.pmotion)) return 0;
    return p.state === "walk" ? 1 : 0.4;
  }

  // ---------------------------------------------------------------- giving way to vehicles

  private lanes: Lane[] = [];
  private readonly laneWas = new WeakMap<Rect, { x: number; z: number; vx: number; vz: number }>();

  /** The lanes of this frame: every vehicle going at a pace, from how its box moved since the last frame. */
  private vehicleLanes(dt: number): Lane[] {
    const out: Lane[] = [];
    const add = (cx: number, cz: number, vx: number, vz: number, ex: number, ez: number, rank: number, own?: Person) => {
      const sp = Math.hypot(vx, vz);
      if (sp < LANE_MIN_SPEED) return;
      const ux = vx / sp;
      const uz = vz / sp;
      const rx = -uz;
      const rz = ux;
      out.push({ cx, cz, ux, uz, rx, rz, hl: Math.abs(ex * ux) + Math.abs(ez * uz), hw: Math.abs(ex * rx) + Math.abs(ez * rz), look: Math.min(12, Math.max(3, sp * 3.5)), rank, own });
    };
    const list = this.ground.vehicles?.() ?? [];
    for (const { r, rank } of list) {
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      const was = this.laneWas.get(r);
      let vx = 0;
      let vz = 0;
      if (was && dt > 0) {
        // smoothed: a box set down in place (a new frame of a stop) is not a sudden rush
        const k = Math.min(1, dt * 6);
        vx = was.vx + ((cx - was.x) / dt - was.vx) * k;
        vz = was.vz + ((cz - was.z) / dt - was.vz) * k;
        if (Math.hypot(cx - was.x, cz - was.z) > 3) vx = vz = 0; // (put somewhere else: no pace)
      }
      this.laneWas.set(r, { x: cx, z: cz, vx, vz });
      add(cx, cz, vx, vz, (r.maxX - r.minX) / 2, (r.maxZ - r.minZ) / 2, rank);
    }
    // the townspeople's own carts and drays: bigger than a walker
    for (const p of this.people) {
      const v = p.veh;
      if (!v || p.state !== "walk" || p.role === "remote") continue;
      const rank = v.spec.kind === "dray" ? 2 : 1;
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const hl = Math.max(0.6, p.nose / 2 + 0.4);
      add(p.x + fx * p.nose * 0.5, p.z + fz * p.nose * 0.5, fx * p.pace, fz * p.pace, 0, 0, rank, p);
      const l = out[out.length - 1];
      if (l && l.own === p) {
        l.hl = hl;
        l.hw = Math.max(0.45, p.reach);
      }
    }
    return out;
  }

  /** His own rank: a walker 0, with a handcart or on a velocipede 1, leading a dray 2. */
  private rankOf(p: Person): number {
    const k = p.veh?.spec.kind;
    return k === "dray" ? 2 : k ? 1 : 0;
  }

  /**
   * Smaller gives way to bigger (Steve 2026-09-27). In a vehicle's lane (its path and a few seconds ahead), he
   * steps out sideways, to the nearer side that is free, and stands until it has gone by; walking, he does not
   * step into one; standing at his place, he goes back to it afterwards. True when he was busy with that.
   */
  private giveWay(p: Person, dt: number): boolean {
    if (p.role === "remote" || !this.lanes.length) return false;
    const mine = this.rankOf(p);
    let hit: { l: Lane; lat: number } | null = null;
    let near: Lane | null = null;
    for (const l of this.lanes) {
      if (l.own === p || l.rank <= mine) continue;
      const dx = p.x - l.cx;
      const dz = p.z - l.cz;
      if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
      const along = dx * l.ux + dz * l.uz;
      if (along < -l.hl - 0.4 || along > l.hl + l.look) continue;
      const lat = dx * l.rx + dz * l.rz;
      const room = l.hw + LANE_BERTH + p.reach * 0.5;
      if (Math.abs(lat) < room) {
        hit = { l, lat };
        break;
      }
      if (Math.abs(lat) < room + 1.2) near = l;
    }
    if (hit) {
      const { l, lat } = hit;
      if (p.state !== "walk" && !p.wayHome) p.wayHome = { x: p.x, z: p.z };
      // out to the side he is on (the other if that is shut), across the lane
      const want = l.hw + LANE_BERTH + LANE_STEP_OUT;
      const step = GIVE_WAY_PACE * dt;
      const sides = Math.abs(lat) < 0.15 ? [1, -1] : [Math.sign(lat), -Math.sign(lat)];
      for (const sd of sides) {
        if (sd === -Math.sign(lat) && Math.abs(lat) > want * 0.5) continue; // (past the middle: no crossing back)
        const nx = p.x + l.rx * sd * step;
        const nz = p.z + l.rz * sd * step;
        if (this.ground.isFree(nx, nz, 0.25) && this.grid.isOpen(nx, nz) && (p.nose === 0 || this.ground.isFree(nx + Math.sin(p.yaw) * p.nose, nz + Math.cos(p.yaw) * p.nose, p.reach))) {
          p.x = nx;
          p.z = nz;
          this.face(p, Math.atan2(l.rx * sd, l.rz * sd), dt * 3);
          p.human.play(p.veh ? this.vehMotion(p, true) : "walk", 0.2);
          p.human.setPace(GIVE_WAY_PACE / p.size);
          p.stuckT = 0;
          return true;
        }
      }
      // shut in on both sides: back along the way, out of the front of it
      const bx = p.x - l.ux * step;
      const bz = p.z - l.uz * step;
      if (this.ground.isFree(bx, bz, 0.25) && this.grid.isOpen(bx, bz)) {
        p.x = bx;
        p.z = bz;
      }
      p.human.play(this.stillMotion(p), 0.3);
      return true;
    }
    if (near && p.state === "walk") {
      // at the edge of a lane: wait, facing it, until it has gone by (never step into it)
      const t = p.path[p.pi];
      if (t) {
        const dx = t.x - p.x;
        const dz = t.z - p.z;
        const len = Math.hypot(dx, dz) || 1;
        const ax = p.x + (dx / len) * 0.6 - near.cx;
        const az = p.z + (dz / len) * 0.6 - near.cz;
        const lat = ax * near.rx + az * near.rz;
        const along = ax * near.ux + az * near.uz;
        if (Math.abs(lat) < near.hw + LANE_BERTH + p.reach * 0.5 && along > -near.hl - 0.4 && along < near.hl + near.look) {
          p.human.play(p.veh ? this.vehMotion(p, false) : this.standMotion(p), 0.3);
          this.face(p, Math.atan2(near.cx - p.x, near.cz - p.z), dt);
          p.stuckT = 0;
          return true;
        }
      }
    }
    if (p.wayHome && near && p.state !== "walk") {
      // stepped aside, the lane still going by: stand there and wait (M7 sweep 2026-09-29: the step aside's walk
      // clip went on while he stood)
      p.human.play(this.stillMotion(p), 0.3);
      return false;
    }
    if (p.wayHome && !near) {
      // gone by: back to his place
      const dx = p.wayHome.x - p.x;
      const dz = p.wayHome.z - p.z;
      const d = Math.hypot(dx, dz);
      // (back, or the way back shut: stand again; M7 sweep 2026-09-29: the walk back's clip went on for good, the
      // standing ones "walked" on their spot)
      const done = () => {
        p.wayHome = null;
        if (p.state !== "walk") p.human.play(this.stillMotion(p), 0.3);
        return false;
      };
      if (d < 0.1 || p.state === "walk") return p.state === "walk" ? ((p.wayHome = null), false) : done();
      const step = Math.min(d, 1.1 * dt);
      const nx = p.x + (dx / d) * step;
      const nz = p.z + (dz / d) * step;
      if (!this.ground.isFree(nx, nz, 0.25)) return done();
      p.x = nx;
      p.z = nz;
      this.face(p, Math.atan2(dx, dz), dt * 3);
      p.human.play("walk", 0.2);
      p.human.setPace(1.1 / p.size);
      if (d - step < 0.1) {
        p.wayHome = null;
        p.human.play(this.stillMotion(p), 0.3);
        if (p.pyaw != null) this.face(p, p.pyaw, 1);
      }
      return true;
    }
    return false;
  }

  /** Standing people step aside when the player walks into them. */
  private shoo(p: Person, dt: number): void {
    const dx = p.x - this.player.x;
    const dz = p.z - this.player.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.8 || d < 0.01) return;
    const step = 1.2 * dt;
    const nx = p.x + (dx / d) * step;
    const nz = p.z + (dz / d) * step;
    if (this.ground.isFree(nx, nz, 0.25) && this.grid.isOpen(nx, nz)) {
      p.x = nx;
      p.z = nz;
    }
  }

  private walk(p: Person, dt: number): void {
    const t = p.path[p.pi];
    if (!t) {
      this.arrive(p);
      return;
    }
    let dx = t.x - p.x;
    let dz = t.z - p.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.35) {
      p.pi++;
      p.bestD = Infinity;
      p.stuckT = 0;
      if (p.pi >= p.path.length) this.arrive(p);
      return;
    }
    // the spot itself taken by someone standing there: this near is there (else he walked into them, 2026-09-27)
    if (len < 1 && p.pi === p.path.length - 1 && this.spotTaken(p, t.x, t.z)) {
      this.arrive(p);
      return;
    }
    // no closer to the next waypoint for a while (pushed aside, or something in the
    // way the grid does not know): close the cell ahead and find another way
    if (len < p.bestD - 0.25) {
      p.bestD = len;
      p.stuckT = 0;
    } else if ((p.stuckT += dt) > 2.5) {
      p.stuckT = 0;
      p.bestD = Infinity;
      p.human.play(this.stillMotion(p), 0.3);
      this.grid.block(p.x + (dx / len) * (0.8 + p.nose), p.z + (dz / len) * (0.8 + p.nose));
      p.replans++;
      if (p.replans > 3 || !p.dest) this.next(p, true);
      else this.goTo(p, p.dest);
      return;
    }
    const ux = dx / len;
    const uz = dz / len;
    // the right hand of the walking direction (x is the body's left, facing +z)
    const rx = -uz;
    const rz = ux;
    let side = 0;
    // --- the player: stop short, or go round on the far side
    const px = this.player.x - p.x;
    const pz = this.player.z - p.z;
    const pd = Math.hypot(px, pz);
    if (p.nose) {
      // the cart in front must not run into the player either
      const cd = Math.hypot(this.player.x - (p.x + ux * p.nose), this.player.z - (p.z + uz * p.nose));
      if (cd < p.reach + 0.7 && (px * ux + pz * uz) > 0) {
        p.state = "blocked";
        p.held = 0;
        return;
      }
    }
    if (pd < 2.4 && pd > 0.01) {
      const ahead = (px * ux + pz * uz) / pd;
      if (ahead > 0.2) {
        if (pd < 1.0) {
          p.state = "blocked";
          p.held = 0;
          return;
        }
        const lat = (px * rx + pz * rz) / pd; // > 0: the player is on our right
        side += (lat > 0.15 ? -1 : 1) * ((2.4 - pd) / 2.4) * 1.3;
      }
    }
    // --- the others: keep right, and now and then stop for a word
    for (const q of this.people) {
      if (q === p) continue;
      const qx = q.x - p.x;
      const qz = q.z - p.z;
      if (Math.abs(qx) > 2 || Math.abs(qz) > 2) continue;
      const qd = Math.hypot(qx, qz);
      if (qd < 0.01 || qd > 1.8) continue;
      const ahead = (qx * ux + qz * uz) / qd;
      if (ahead > 0.3 && qd < 1.4) {
        const lat = (qx * rx + qz * rz) / qd;
        side += (lat > 0.2 ? -1 : 1) * ((1.4 - qd) / 1.4) * (q.state === "walk" ? 0.9 : 1.4);
      }
      if (
        ahead > 0.5 && qd < 1.8 && p.role === "wander" && q.role === "wander" && q.state === "walk" && !p.follower && !q.follower &&
        p.chatCd <= 0 && q.chatCd <= 0 && !p.lantern && !CHILDREN.has(p.kind) && !CHILDREN.has(q.kind)
      ) {
        p.chatCd = q.chatCd = rnd(40, 90);
        if (Math.random() < 0.3) {
          this.chat(p, q);
          return;
        }
      }
    }
    // (the last metre to a waypoint straight in: steered aside there, they circled it, to and fro, fixes 2026-09-27)
    side = Math.max(-1.2, Math.min(1.2, side)) * Math.min(1, len);
    let mx = ux + rx * side;
    let mz = uz + rz * side;
    const ml = Math.hypot(mx, mz);
    mx /= ml;
    mz /= ml;
    const f = p.follower;
    const lag = f && f.state !== "walk" ? Math.hypot(f.x - p.x, f.z - p.z) : 0;
    const step = Math.min(len, p.pace * dt * (lag > 2 ? 0.3 : 1));
    // an opening bridge ahead: wait at its end until it is down again (not while already on it)
    if (this.ground.gate?.(p.x + mx * Math.max(step, 0.5), p.z + mz * Math.max(step, 0.5)) && !this.ground.gate(p.x, p.z)) {
      p.stuckT = 0;
      p.human.play(this.standMotion(p), 0.3);
      return;
    }
    // the last leg may leave the grid (it keeps half a metre off the walls) for a spot the colliders
    // allow: a doorstep, a corner, a bench by a wall (fixes 2026-09-27: they walked on the spot before it)
    const lastLeg = p.pi === p.path.length - 1;
    const tryMove = (x: number, z: number) =>
      this.stepFree(p, x, z) &&
      (lastLeg || this.grid.isOpen(x, z) || !this.grid.isOpen(p.x, p.z)) &&
      // a cart before the man: its front must fit too
      (p.nose === 0 || this.ground.isFree(x + ux * p.nose, z + uz * p.nose, p.reach));
    let slid: V | null = null;
    if (tryMove(p.x + mx * step, p.z + mz * step)) {
      p.x += mx * step;
      p.z += mz * step;
    } else if (tryMove(p.x + ux * step, p.z + uz * step)) {
      p.x += ux * step;
      p.z += uz * step;
      mx = ux;
      mz = uz;
    } else if ((slid = this.slide(p, ux, uz, step, tryMove))) {
      // a wall's corner the grid rounds too tightly (a cell is open by its middle only): along the wall
      // instead of giving up the way (fixes 2026-09-27: the night watch turned back at an alley corner)
      mx = slid.x;
      mz = slid.z;
    } else if (lastLeg && len < 1.2) {
      // the spot itself cannot be stood on (in a wall's berth, a thing on it): this near is there
      this.arrive(p);
      return;
    } else {
      // something the walk map does not know: remember it and find another way; stand while it is
      // worked out (fixes 2026-09-27: the walk clip went on while the body did not move)
      p.human.play(this.stillMotion(p), 0.3);
      this.grid.block(p.x + ux * (0.6 + p.nose), p.z + uz * (0.6 + p.nose));
      p.replans++;
      if (p.replans > 3 || !p.dest) this.next(p, true);
      else this.goTo(p, p.dest);
      return;
    }
    this.face(p, Math.atan2(mx, mz), dt * (p.veh?.spec.kind === "velo" ? 2.4 : 1.4));
    // no nearer for a second (someone in the way pushes him back, keepApart): he waits, standing, till the way is
    // free or he finds another at 2.5 s (M7 sweep 2026-09-29: the walk clip went on while he did not get anywhere)
    if (p.stuckT > 1) {
      p.human.play(this.stillMotion(p), 0.3);
      return;
    }
    const motion: Motion = p.veh ? this.vehMotion(p, true) : p.loaded && p.handCarry ? "carry" : "walk";
    p.human.play(motion, 0.25);
    if (motion !== "ride") p.human.setPace(p.pace / p.size);
  }

  /** Blocked straight on: a step turned up to 70 degrees either way, if one is free (the body moved; the way it went). */
  private slide(p: Person, ux: number, uz: number, step: number, tryMove: (x: number, z: number) => boolean): V | null {
    for (const a of [0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const x = ux * c - uz * sn;
      const z = ux * sn + uz * c;
      if (tryMove(p.x + x * step, p.z + z * step)) {
        p.x += x * step;
        p.z += z * step;
        return { x, z };
      }
    }
    return null;
  }

  /** A way round the player (right first, as on the street), put in front of the path. */
  private detour(p: Person): boolean {
    const t = p.path[p.pi] ?? this.player;
    const fx0 = t.x - p.x;
    const fz0 = t.z - p.z;
    const fl = Math.hypot(fx0, fz0) || 1;
    const fx = fx0 / fl;
    const fz = fz0 / fl;
    for (const s of [1, -1]) {
      const rx = -fz * s;
      const rz = fx * s;
      const wide = p.nose ? p.reach + 0.4 : 0;
      const a = { x: p.x + rx * (1.2 + wide), z: p.z + rz * (1.2 + wide) };
      const b = { x: this.player.x + rx * (1.3 + wide) + fx * (1.2 + p.nose), z: this.player.z + rz * (1.3 + wide) + fz * (1.2 + p.nose) };
      const ok = (q: V) => this.grid.isOpen(q.x, q.z) && this.ground.isFree(q.x, q.z, 0.25);
      if (ok(a) && ok(b) && this.grid.lineOpen(a.x, a.z, b.x, b.z)) {
        p.path.splice(p.pi, 0, a, b);
        p.state = "walk";
        p.sinceDetour = 0;
        return true;
      }
    }
    return false;
  }

  /** Two walkers stop and have a word. */
  private chat(p: Person, q: Person): void {
    const secs = rnd(6, 16);
    for (const [a, b] of [[p, q], [q, p]] as const) {
      a.state = "chat";
      a.partner = b;
      a.timer = secs;
      a.human.play(a === p ? "talk" : this.standMotion(a), 0.35);
    }
  }

  private arrive(p: Person): void {
    p.path = [];
    p.pi = 0;
    p.replans = 0;
    if (p.role === "puppet") {
      if (p.repath && p.dest) {
        // the old way is walked out and a new goal waits: on there as soon as a way is found
        p.repath = false;
        p.state = "wait";
        return;
      }
      p.dest = null;
      p.state = "stand";
      // (never a walk clip left from a layer's own steps: they would stand walking on the spot)
      p.human.play(this.stillMotion(p), 0.3);
      return;
    }
    if (p.role === "haul") {
      p.state = "pause";
      if (p.handCarry) {
        // load at the quay end, unload at the other
        p.timer = p.toB ? rnd(1.2, 2.5) : rnd(2, 4);
      } else p.timer = rnd(1.5, 4);
      p.human.play("idle", 0.3);
      return;
    }
    p.state = "pause";
    p.timer = CHILDREN.has(p.kind) ? rnd(0.5, 3) : p.kind === "police" ? rnd(4, 12) : rnd(2, 10);
    p.human.play(Math.random() < 0.6 ? this.standMotion(p) : "idle", 0.35);
  }

  /** What next, after a pause (or when the way is blocked). */
  private next(p: Person, blocked = false): void {
    if (p.role === "puppet") {
      // the town decides where; the crowd only tries the way again (or gives up and stands)
      if (p.dest && p.replans <= 4) this.goTo(p, p.dest);
      else {
        p.dest = null;
        p.state = "stand";
        p.human.play(this.stillMotion(p), 0.3);
      }
      return;
    }
    if (p.role === "follow") {
      if (p.lead) this.goTo(p, { x: p.lead.x, z: p.lead.z });
      return;
    }
    if (p.role === "haul" && p.a && p.b) {
      if (!blocked) {
        if (p.handCarry) {
          // at the quay (a) pick up a sack, at the other end (b) put it down
          const atA = !p.toB;
          this.setLoad(p, atA);
        }
        p.toB = !p.toB;
      }
      p.replans = blocked ? p.replans : 0;
      if (p.replans > 5) {
        p.role = "wander"; // this haul does not work out; walk about instead
        this.setLoad(p, false);
      } else {
        this.goTo(p, p.toB ? p.b : p.a);
        return;
      }
    }
    p.replans = 0;
    const d = this.pickDest(p);
    if (d) this.goTo(p, d);
    else {
      p.state = "pause";
      p.timer = rnd(2, 5);
    }
  }

  private goTo(p: Person, dest: V): void {
    p.dest = dest;
    p.repath = false;
    if (this.pathBudget <= 0) {
      p.state = "wait";
      p.human.play(this.standMotion(p), 0.3);
      return;
    }
    this.pathBudget--;
    const standAt = (x: number, z: number) => this.ground.isFree(x, z, this.ground.narrow?.(x, z) ? 0.15 : 0.25);
    const path = p.veh?.spec.kind === "dray" ? this.drayWay(p, dest, standAt) : this.grid.path(p.x, p.z, dest.x, dest.z, 9000, standAt);
    if (path && path.length) {
      p.path = path;
      p.pi = 0;
      p.bestD = Infinity;
      p.stuckT = 0;
      p.state = "walk";
    } else {
      p.replans++;
      p.state = "pause";
      p.timer = rnd(1, 3);
      if (p.replans > 3) p.dest = null;
      // no way there now: stand while waiting to try again (fixes 2026-09-27: the watch walked on the spot)
      p.human.play(this.stillMotion(p), 0.3);
    }
  }

  /**
   * A dray's way (Steve 2026-09-28: the rig went into the walls round the corners). The rig goes at his right
   * (traffic.ts LedDray), so the way is found for the rig's middle, as far from the walls as the streets allow
   * (3 cells, else 2; a lane too narrow for that: the walkers' way), and he walks it DRAY_SIDE to its left.
   */
  private drayWay(p: Person, dest: V, standAt: (x: number, z: number) => boolean): V[] | null {
    const sx = p.x - Math.cos(p.yaw) * DRAY_SIDE;
    const sz = p.z + Math.sin(p.yaw) * DRAY_SIDE;
    for (const wide of [3, 2]) {
      const mid = this.grid.path(this.grid.isOpen(sx, sz) ? sx : p.x, this.grid.isOpen(sx, sz) ? sz : p.z, dest.x, dest.z, 9000, standAt, wide);
      if (!mid || !mid.length) continue;
      // each corner moved to his side of the rig's way (a mitre, so both legs keep the distance), the goal kept
      const way: V[] = [];
      let prev: V = { x: sx, z: sz };
      for (let i = 0; i < mid.length; i++) {
        const q = mid[i];
        const next = mid[i + 1];
        if (!next) {
          way.push(q);
          break;
        }
        const ax = q.x - prev.x;
        const az = q.z - prev.z;
        const bx = next.x - q.x;
        const bz = next.z - q.z;
        const al = Math.hypot(ax, az) || 1;
        const bl = Math.hypot(bx, bz) || 1;
        // (left of a heading (ux, uz) is (uz, -ux))
        let lx = az / al + bz / bl;
        let lz = -ax / al - bx / bl;
        const ll = Math.hypot(lx, lz);
        if (ll < 0.2) {
          lx = bz / bl;
          lz = -bx / bl;
        } else {
          lx /= ll;
          lz /= ll;
        }
        const cosHalf = Math.max(0.55, lx * (az / al) - lz * (ax / al));
        const off = DRAY_SIDE / cosHalf;
        const m = { x: q.x + lx * off, z: q.z + lz * off };
        way.push(this.grid.isOpen(m.x, m.z) && this.ground.isFree(m.x, m.z, 0.25) ? m : q);
        prev = q;
      }
      return way;
    }
    return this.grid.path(p.x, p.z, dest.x, dest.z, 9000, standAt);
  }

  private setLoad(p: Person, on: boolean): void {
    p.loaded = on;
    if (!p.handCarry) return;
    if (on && !p.sack) {
      const k = p.human.scale;
      let s: THREE.Mesh;
      if (p.loadKind === "keg") {
        // T5 beer: a keg of 60 pints on its side in both arms before him (the one keg model, game/kegModel.ts)
        const b = kegMesh();
        b.rotation.z = Math.PI / 2;
        b.position.set(KEG.h / 2, 0.92 * k, 0.4 * k);
        b.userData.kind = "keg";
        p.group.add(b);
        p.sack = b as unknown as THREE.Mesh;
        return;
      }
      if (p.loadKind === "fishbox") {
        // T3 trade: a box of fish from the Vliet, held low before him in both arms (game/fishBox.ts)
        const b = fishBoxMesh(this.crateMat);
        b.position.set(0, 0.72 * k, 0.32 * k);
        b.userData.kind = "fishbox";
        p.group.add(b);
        p.sack = b as unknown as THREE.Mesh;
        return;
      }
      if (p.loadKind === "crate") {
        // a crate held before the chest in both arms (the crate geometry stands on its base)
        s = new THREE.Mesh(this.crateGeo, this.crateMat);
        // (the props' crate at its own size: the same as on the dockers' piles, shared/goods.ts HAUL_CRATE_LOOK)
        s.position.set(0, 0.74 * k, 0.36 * k);
        s.userData.kind = "crate";
      } else {
        // the one sack model (game/sackModel.ts), held across the arms before the chest
        s = sackMesh(p.sackLabel ?? sackLabelFor(null), { fit: [0.72, 0.26, 0.42] });
        s.position.set(0, 0.98 * k, 0.3 * k);
        s.rotation.set(0.12, 0.08, 0.04);
        s.userData.kind = "sack";
      }
      p.group.add(s);
      p.sack = s;
    } else if (!on && p.sack) {
      p.group.remove(p.sack);
      p.sack = null;
    }
  }

  // ---------------------------------------------------------------- where

  private nearPlaces(kind?: PlaceKind): BusyPlace[] {
    const r = this.radius - 6;
    return this.places.filter((pl) => (!kind || pl.kind === kind) && Math.hypot(pl.x - this.player.x, pl.z - this.player.z) < r + (pl.r ?? PLACE_R[pl.kind]));
  }

  /** An open point inside a place (the place's own point may be in a wall). */
  private pointIn(pl: BusyPlace, tries = 8): V | null {
    const r = pl.r ?? PLACE_R[pl.kind];
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      const q = this.grid.nearestOpen(pl.x + Math.cos(a) * d, pl.z + Math.sin(a) * d, 2);
      if (q && this.grid.inside(q.x, q.z) && this.inRange(q)) return q;
    }
    return null;
  }

  private inRange(q: V, max = this.radius - 6): boolean {
    return Math.hypot(q.x - this.player.x, q.z - this.player.z) < max;
  }

  /** Found on the grid, for when the game gave no place of that kind nearby. */
  private gridPoint(kind: PlaceKind): V | null {
    return this.nearGridPoint(kind === "quay" ? this.grid.quay : kind === "square" ? this.grid.square : this.grid.street);
  }

  /** A place, the nearer to the player the likelier: that is where the crowd is seen. */
  private pickPlace(list: BusyPlace[]): BusyPlace {
    const w = list.map((pl) => 1 / (1 + (Math.hypot(pl.x - this.player.x, pl.z - this.player.z) / 25) ** 2));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) if ((r -= w[i]) <= 0) return list[i];
    return list[list.length - 1];
  }

  /** A grid point near the player first (by the same weighting). */
  private nearGridPoint(list: V[]): V | null {
    let best: V | null = null;
    let bestW = -1;
    for (let i = 0; i < 8 && list.length; i++) {
      const q = pick(list);
      const d = Math.hypot(q.x - this.player.x, q.z - this.player.z);
      if (d > this.radius - 6) continue;
      const w = Math.random() / (1 + (d / 25) ** 2);
      if (w > bestW) {
        bestW = w;
        best = q;
      }
    }
    return best && { x: best.x + rnd(-1.2, 1.2), z: best.z + rnd(-1.2, 1.2) };
  }

  private placePoint(kind: PlaceKind): V | null {
    const given = this.nearPlaces(kind);
    const q = given.length && Math.random() < 0.8 ? this.pointIn(this.pickPlace(given)) : null;
    const r = q ?? this.gridPoint(kind);
    return r && this.grid.isOpen(r.x, r.z) ? r : this.grid.nearestOpen(r?.x ?? NaN, r?.z ?? NaN, 1);
  }

  /** Somewhere to walk to: a busy place (often one near the player), or just down the street. */
  private pickDest(p: Person): V | null {
    for (let i = 0; i < 6; i++) {
      let q: V | null = null;
      const roll = Math.random();
      if (roll < 0.45) {
        const given = this.nearPlaces();
        q = given.length ? this.pointIn(this.pickPlace(given)) : this.gridPoint(Math.random() < 0.4 ? "square" : "street");
      } else {
        // just along the street; more often somewhere round the player than far off
        const c = roll < 0.8 ? this.player : p;
        const a = Math.random() * Math.PI * 2;
        const d = rnd(6, c === p ? 40 : 30);
        q = this.grid.nearestOpen(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, 3);
        if (q && !this.inRange(q, this.radius - 10)) q = null;
      }
      if (q && Math.hypot(q.x - p.x, q.z - p.z) > 4) return q;
    }
    return null;
  }

  /** Out of the player's sight: in the fog, or outside the view, and never right beside them. */
  private hidden(x: number, z: number): boolean {
    const d = Math.hypot(x - this.player.x, z - this.player.z);
    if (d < 10) return false;
    if (d > this.fogFar + 3) return true;
    return !this.inFrustum(x, z, 1.5);
  }

  private inFrustum(x: number, z: number, r: number): boolean {
    if (!this.camera) return true;
    this.sphere.center.set(x, 0.9, z);
    this.sphere.radius = r;
    return this.frustum.intersectsSphere(this.sphere);
  }

  private spaceFree(x: number, z: number, gap = 1.2): boolean {
    for (const q of this.people) if (Math.abs(q.x - x) < gap && Math.abs(q.z - z) < gap) return false;
    return this.ground.isFree(x, z, 0.3) && this.grid.isOpen(x, z);
  }

  // ---------------------------------------------------------------- who

  /** How much this person belongs out at this hour (the night weights). */
  private belongs(p: Person): number {
    return isNight(this.hour) ? (NIGHT[p.kind] ?? 1) : 1;
  }

  private chooseKind(where: PlaceKind, filter?: (k: HumanKind) => boolean): HumanKind | null {
    const night = isNight(this.hour);
    const count = new Map<HumanKind, number>();
    for (const p of this.people) count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
    const entries = Object.entries(MIX[where]) as Array<[HumanKind, number]>;
    let total = 0;
    const w = entries.map(([k, v]) => {
      if (filter && !filter(k)) return 0;
      let x = v * (night ? (NIGHT[k] ?? 1) : 1);
      x /= 1 + 1.5 * (count.get(k) ?? 0); // no clones in a row
      total += x;
      return x;
    });
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (let i = 0; i < entries.length; i++) if ((r -= w[i]) <= 0) return entries[i][0];
    return entries[entries.length - 1][0];
  }

  private takeHuman(kind: HumanKind): Human | null {
    const h = this.pool.get(kind)?.pop() ?? makeHuman(kind);
    if (!h) return null;
    h.play("idle", 0);
    return h;
  }

  private make(kind: HumanKind, x: number, z: number, role: Role): Person | null {
    const human = this.takeHuman(kind);
    if (!human) return null;
    // a body from the pool still plays what its last owner did: a walk left on made a new townsperson who stands
    // "walk" on the spot till the town gave him a pose (M7 sweep 2026-09-29)
    human.play("idle", 0);
    const group = new THREE.Group();
    group.add(human.root);
    const size = CHILDREN.has(kind) ? rnd(0.9, 1.08) : rnd(0.95, 1.05);
    group.scale.setScalar(size);
    const [lo, hi] = PACE[kind] ?? (WOMEN.has(kind) ? [1.0, 1.25] : [1.15, 1.45]);
    const cart = CART[kind];
    const p: Person = {
      id: this.nextId++, kind, human, group, x, z, yaw: Math.random() * Math.PI * 2, pace: rnd(lo, hi), size, role,
      state: "pause", timer: rnd(0.5, 3), path: [], pi: 0, dest: null, replans: 0, held: 0, sinceDetour: 99,
      a: null, b: null, toB: true, loaded: LOADED.has(kind), handCarry: false, sack: null,
      cluster: null, partner: null, chatCd: rnd(5, 30), folds: !WOMEN.has(kind) && !CHILDREN.has(kind) && Math.random() < 0.35,
      looks: this.quayRail ? "lean" : WOMEN.has(kind) || CHILDREN.has(kind) || Math.random() < 0.3 ? "idle" : "behind",
      lead: null, follower: null, reach: cart ? cart[1] : 0.25, nose: cart ? cart[0] : 0,
      lantern: null, lanternRoll: isNight(this.hour), hand: human.root.getObjectByName("handR") ?? null, seat: false, drop: 0, shown: false, animAcc: 0, bestD: Infinity, stuckT: 0,
    };
    group.position.set(x, 0, z);
    this.scene.add(group);
    this.people.push(p);
    return p;
  }

  /** One more person (or a group), out of sight unless `anywhere`. */
  private spawn(anywhere: boolean): void {
    const ok = (q: V | null): q is V => !!q && (anywhere ? Math.hypot(q.x - this.player.x, q.z - this.player.z) > 4 : this.hidden(q.x, q.z)) && this.spaceFree(q.x, q.z);
    const day = this.hour >= 7 && this.hour < 21;
    const cap = Math.max(1, Math.floor(this.budget / 10));
    const talking = this.clusters.filter((c) => c.look == null).length;
    const watching = this.clusters.length - talking;
    // a standing or sitting group now and then, on squares and streets
    if (day && talking < cap && Math.random() < 0.2) {
      if (this.spawnCluster(anywhere)) return;
    }
    // people at the quay edge, looking out over the water (evenings too)
    if (this.hour >= 7 && this.hour < 22 && watching < cap && Math.random() < 0.2) {
      if (this.spawnWatchers(anywhere)) return;
    }
    // by the water, most are dockers and boatmen; inland, the town
    const quayNear = this.nearPlaces("quay").some((pl) => Math.hypot(pl.x - this.player.x, pl.z - this.player.z) < 40 + (pl.r ?? 12)) ||
      this.grid.quay.some((q) => Math.hypot(q.x - this.player.x, q.z - this.player.z) < 30);
    const quayAny = quayNear || this.nearPlaces("quay").length > 0 || this.grid.quay.length > 0;
    const where: PlaceKind = pick<PlaceKind>(quayNear ? ["quay", "quay", "quay", "square", "street"] : quayAny ? ["quay", "square", "street", "street"] : ["square", "street", "street"]);
    const kind = this.chooseKind(where);
    if (!kind) return;
    // haulers: back and forth between a quay spot and a spot inland
    const hauls = LOADED.has(kind) || (HAND_CARRIERS.has(kind) && where === "quay" && Math.random() < 0.6);
    if (hauls) {
      const route = this.haulRoute();
      if (route) {
        const [a, b, path] = route;
        // start somewhere along the route, out of sight
        const along = path.filter((q) => ok(q));
        const at = along.length ? pick(along) : null;
        const start = at ?? this.hiddenPoint(anywhere);
        if (start) {
          const p = this.make(kind, start.x, start.z, "haul");
          if (!p) return;
          p.a = a;
          p.b = b;
          p.handCarry = HAND_CARRIERS.has(kind);
          p.toB = Math.random() < 0.5;
          if (p.handCarry) this.setLoad(p, p.toB);
          this.goTo(p, p.toB ? b : a);
          return;
        }
      }
    }
    let at: V | null = null;
    for (let i = 0; i < 6 && !ok(at); i++) at = this.placePoint(where);
    if (!ok(at)) at = this.hiddenPoint(anywhere);
    if (!at) return;
    const p = this.make(kind, at.x, at.z, "wander");
    if (!p) return;
    if (isNight(this.hour) && !LOADED.has(kind) && (p.kind === "police" || Math.random() < 0.45)) this.giveLantern(p);
    // a couple, or two friends, strolling side by side
    if (day && !LOADED.has(kind) && kind !== "police" && Math.random() < 0.3) {
      const k2 = this.chooseKind(where, (k) => !LOADED.has(k) && k !== "police" && CHILDREN.has(k) === CHILDREN.has(kind));
      const side = { x: at.x - Math.cos(p.yaw) * 0.62, z: at.z + Math.sin(p.yaw) * 0.62 };
      if (k2 && this.ground.isFree(side.x, side.z, 0.25)) {
        const f = this.make(k2, side.x, side.z, "follow");
        if (f) {
          f.lead = p;
          f.yaw = p.yaw;
          p.follower = f;
          p.pace = f.pace = Math.min(p.pace, f.pace) * 0.9; // strolling
        }
      }
    }
    this.next(p);
  }

  /** One to three people side by side at the quay edge, facing the water. */
  private spawnWatchers(anywhere: boolean): boolean {
    for (let i = 0; i < 4; i++) {
      const q = this.placePoint("quay");
      if (!q) continue;
      // which way is the water, and how far
      let best = Infinity;
      let dir = 0;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (let d = 0.5; d <= 7; d += 0.5) {
          const f = this.ground.flags(q.x + Math.sin(a) * d, q.z + Math.cos(a) * d);
          if (f !== undefined && (f & WATER) !== 0 && (f & WALL) === 0) {
            if (d < best) {
              best = d;
              dir = a;
            }
            break;
          }
        }
      }
      if (!isFinite(best)) continue;
      // walk out to the last open cell before the water
      let sx = q.x;
      let sz = q.z;
      let reached = 0;
      for (let d = 0.25; d < best; d += 0.25) {
        const x = q.x + Math.sin(dir) * d;
        const z = q.z + Math.cos(dir) * d;
        if (!this.grid.isOpen(x, z) || !this.ground.isFree(x, z, 0.25)) break;
        sx = x;
        sz = z;
        reached = d;
      }
      // right at the edge, nothing (a crate stack, a cart) between them and the water
      if (best - reached > 1.5) continue;
      if (!(anywhere ? Math.hypot(sx - this.player.x, sz - this.player.z) > 6 : this.hidden(sx, sz))) continue;
      const n = Math.random() < 0.45 ? 1 : Math.random() < 0.7 ? 2 : 3;
      // along the edge: the right-hand of the look direction
      const ex = -Math.cos(dir);
      const ez = Math.sin(dir);
      const spots: V[] = [];
      for (let k = 0; k < n; k++) {
        const o = (k - (n - 1) / 2) * rnd(0.65, 0.8);
        spots.push({ x: sx + ex * o, z: sz + ez * o });
      }
      if (!spots.every((s) => this.spaceFree(s.x, s.z, 0.6))) continue;
      const cl: Cluster = { x: sx, z: sz, look: dir, members: [], speaker: null, speakT: rnd(3, 8), life: rnd(30, 120), seats: [], rects: [] };
      for (const s of spots) {
        const kind = this.chooseKind(Math.random() < 0.5 ? "quay" : "square", (k) => !LOADED.has(k) && !HAND_CARRIERS.has(k) && (n > 1 || !CHILDREN.has(k)));
        if (!kind) continue;
        const p = this.make(kind, s.x, s.z, "group");
        if (!p) continue;
        p.cluster = cl;
        p.yaw = dir + rnd(-0.3, 0.3);
        p.state = "stand";
        p.human.play(p.looks, 0);
        cl.members.push(p);
      }
      if (!cl.members.length) continue;
      this.clusters.push(cl);
      return true;
    }
    return false;
  }

  /** A random open point on the grid, hidden from the player. */
  private hiddenPoint(anywhere: boolean): V | null {
    for (let i = 0; i < 20; i++) {
      // close by but out of view first (behind the player, round a corner), then in the fog
      const [lo, hi] = anywhere ? [6, this.radius - 6] : i < 10 ? [12, 35] : [Math.max(14, this.fogFar * 0.8), this.radius - 6];
      const a = Math.random() * Math.PI * 2;
      const d = rnd(lo, hi);
      const q = this.grid.nearestOpen(this.player.x + Math.cos(a) * d, this.player.z + Math.sin(a) * d, 2);
      if (q && (anywhere || this.hidden(q.x, q.z)) && this.spaceFree(q.x, q.z)) return q;
    }
    return null;
  }

  /** A quay spot by the water and a spot 10-30 m off, with a way between them. */
  private haulRoute(): [V, V, V[]] | null {
    for (let i = 0; i < 4; i++) {
      const a = this.placePoint("quay");
      if (!a) continue;
      const ang = Math.random() * Math.PI * 2;
      const d = rnd(10, 30);
      const b = this.grid.nearestOpen(a.x + Math.cos(ang) * d, a.z + Math.sin(ang) * d, 3);
      if (!b || !this.inRange(b)) continue;
      if (this.pathBudget <= 0) return null;
      this.pathBudget--;
      const path = this.grid.path(a.x, a.z, b.x, b.z, 4000);
      if (!path || path.length > 6) continue;
      // points along the way, 2 m apart, for a start out of sight
      const pts: V[] = [];
      let prev = a;
      for (const q of path) {
        const L = Math.hypot(q.x - prev.x, q.z - prev.z);
        for (let s = 0; s < L; s += 2) pts.push({ x: prev.x + ((q.x - prev.x) * s) / L, z: prev.z + ((q.z - prev.z) * s) / L });
        prev = q;
      }
      return [a, b, pts];
    }
    return null;
  }

  // ---------------------------------------------------------------- groups

  private spawnCluster(anywhere: boolean): boolean {
    const where: PlaceKind = Math.random() < 0.65 ? "square" : "street";
    for (let i = 0; i < 5; i++) {
      const c = this.placePoint(where);
      if (!c || !(anywhere ? Math.hypot(c.x - this.player.x, c.z - this.player.z) > 6 : this.hidden(c.x, c.z))) continue;
      const n = Math.random() < 0.6 ? 2 : 3;
      const sits = Math.random() < 0.45;
      const a0 = Math.random() * Math.PI * 2;
      const spots: Array<V & { sit: boolean }> = [];
      for (let k = 0; k < n; k++) {
        const sit = sits && k === 0;
        const a = a0 + (k / n) * Math.PI * 2 + rnd(-0.25, 0.25);
        const r = sit ? 0.85 : n === 2 ? 0.55 : 0.65;
        spots.push({ x: c.x + Math.sin(a) * r, z: c.z + Math.cos(a) * r, sit });
      }
      if (!spots.every((s) => this.spaceFree(s.x, s.z, 1.0))) continue;
      const cl: Cluster = { x: c.x, z: c.z, look: null, members: [], speaker: null, speakT: 0, life: sits ? rnd(90, 300) : rnd(25, 90), seats: [], rects: [] };
      for (const s of spots) {
        const kind = this.chooseKind(where, s.sit ? (k) => !WOMEN.has(k) && !CHILDREN.has(k) && !LOADED.has(k) : (k) => !LOADED.has(k));
        if (!kind) continue;
        const p = this.make(kind, s.x, s.z, "group");
        if (!p) continue;
        p.cluster = cl;
        p.yaw = Math.atan2(c.x - s.x, c.z - s.z);
        if (s.sit && p.human.canSit) {
          p.state = "sit";
          p.seat = true;
          p.human.play("sit", 0);
          // the crate under him, a little behind the hips
          const seat = new THREE.Mesh(this.crateGeo, this.crateMat);
          const bx = s.x - Math.sin(p.yaw) * 0.1 * p.size;
          const bz = s.z - Math.cos(p.yaw) * 0.1 * p.size;
          seat.position.set(bx, 0, bz);
          seat.rotation.y = p.yaw;
          seat.scale.y = p.size;
          this.scene.add(seat);
          cl.seats.push(seat);
          if (this.ground.addCollider) {
            const rect: Rect = { minX: bx - 0.28, maxX: bx + 0.28, minZ: bz - 0.28, maxZ: bz + 0.28, top: 0.45 };
            this.ground.addCollider(rect);
            cl.rects.push(rect);
          }
        } else {
          p.state = "stand";
          p.human.play(this.standMotion(p), 0);
        }
        cl.members.push(p);
      }
      if (cl.members.length < 2) {
        for (const p of cl.members) this.recycle(p);
        this.dropSeats(cl);
        continue;
      }
      this.clusters.push(cl);
      return true;
    }
    return false;
  }

  private updateCluster(c: Cluster, dt: number): void {
    c.life -= dt;
    if (c.life <= 0) {
      // the talk is over: everyone goes their own way
      for (const p of c.members) {
        p.cluster = null;
        p.role = "wander";
        p.state = "pause";
        p.timer = rnd(0.2, 1.5) + (p.seat ? 1 : 0); // getting up takes a moment
        p.seat = false;
        p.human.play("idle", 0.6);
      }
      // the crates stay where they are until nobody sees them
      c.seats.forEach((mesh, i) => this.strays.push({ mesh, rect: c.rects[i] ?? null }));
      c.seats = [];
      c.rects = [];
      this.clusters.splice(this.clusters.indexOf(c), 1);
      return;
    }
    c.speakT -= dt;
    if (c.speakT <= 0) {
      const standing = c.members.filter((p) => p.state === "stand");
      const prev = c.speaker;
      // people looking out over the water say a word now and then; a group talks all the time
      c.speaker = standing.length > 1 && (c.look == null || Math.random() < 0.4) ? pick(standing) : null;
      c.speakT = c.look == null ? rnd(2.5, 6) : rnd(3, 9);
      for (const p of standing) p.human.play(p === c.speaker ? "talk" : this.standMotion(p), 0.4);
      if (prev && prev !== c.speaker && prev.state === "stand") prev.human.play(this.standMotion(prev), 0.4);
    }
  }

  private dropSeats(c: Cluster): void {
    for (const s of c.seats) this.scene.remove(s);
    for (const r of c.rects) this.ground.removeCollider?.(r);
    c.seats = [];
    c.rects = [];
  }

  // ---------------------------------------------------------------- lanterns

  private giveLantern(p: Person): void {
    const g = new THREE.Group();
    const glass = new THREE.Mesh(this.lanternGeo, this.lanternMat);
    const cap = new THREE.Mesh(this.lanternCapGeo, this.lanternIron);
    const halo = new THREE.Sprite(this.haloMat);
    halo.scale.set(0.9, 0.9, 1);
    halo.position.y = -0.08;
    g.add(glass, cap, halo);
    this.scene.add(g);
    p.lantern = { g, halo, src: addLantern() };
  }

  private dropLantern(p: Person): void {
    if (!p.lantern) return;
    this.scene.remove(p.lantern.g);
    removeLantern(p.lantern.src);
    p.lantern = null;
  }

  private placeLantern(p: Person, d: number): void {
    const l = p.lantern!;
    // a light carries further in the fog than the one who carries it; it lights the ground round
    // the carrier also while he is out of the view (behind you, round a corner)
    const near = d < this.fogFar * 1.8;
    // M7 fog lamps: the lantern itself is drawn with its carrier only (it hung in the fog on its own
    // where he was out of the view: past the fog, or culled); its light on the ground still carries
    const on = p.shown && p.group.visible;
    l.g.visible = on;
    l.src.on = near ? 1 : 0;
    if (!near) return;
    const base = this.ground.baseAt?.(p.x, p.z) ?? 0;
    if (p.hand && p.shown) {
      p.hand.getWorldPosition(this.tmp);
      l.g.position.set(this.tmp.x, this.tmp.y - 0.1 * p.size, this.tmp.z);
    } else l.g.position.set(p.x + Math.cos(p.yaw) * -0.25, base + 0.75 * p.size, p.z - Math.sin(p.yaw) * -0.25);
    // the flame, in the middle of the glass
    l.src.pos.set(l.g.position.x, l.g.position.y - 0.08, l.g.position.z);
    l.src.ground = base;
    if (!on) return;
    const flick = 0.4 + 0.06 * Math.sin(performance.now() * 0.013 + p.x);
    // shared material: all lanterns breathe together, gently; lit after dark (a horn pane by day)
    const dark = lanternDarkAt(this.hour);
    l.halo.material.opacity = flick * dark;
    l.halo.visible = dark > 0.02;
    (this.lanternMat as THREE.MeshBasicMaterial).color.setRGB(0.42 + 0.58 * dark, 0.35 + 0.4 * dark, 0.27 + 0.17 * dark);
  }

  // ---------------------------------------------------------------- away

  /**
   * A carter's handcart (world/traffic.ts PushCart) in place of the one baked into his model:
   * on its own wheels on the ground, tipped up to his grip, swinging round behind him on a
   * bend, wheels rolling. When he stands, he lets go and it settles on its prop legs.
   */
  private pushCart(p: Person, dt: number, shown: boolean): void {
    if (!this.cartProps) return;
    let cart = this.carts.get(p);
    if (!cart) {
      hideBakedCart(p.human.root);
      cart = new PushCart(this.scene, this.cartProps);
      this.carts.set(p, cart);
      for (const r of cart.rects) this.ground.addMover?.(r);
    }
    const walking = p.human.motion === "walk" || p.human.motion === "carry";
    const hands = handsOf(p.human, p.group, p.x, p.z, p.yaw);
    cart.push(dt, hands.x, hands.z, hands.y, p.yaw, walking ? 1 : 0);
    cart.visible = shown;
  }

  private recycle(p: Person): void {
    const i = this.people.indexOf(p);
    if (i < 0) return;
    this.people.splice(i, 1);
    if (p.partner) {
      p.partner.partner = null;
      p.partner.state = "walk";
    }
    if (p.follower) p.follower.lead = null;
    if (p.lead) p.lead.follower = null;
    const c = p.cluster;
    if (c) {
      c.members.splice(c.members.indexOf(p), 1);
      if (c.speaker === p) c.speaker = null;
      if (c.members.length === 0 || p.seat) {
        // a sitting group goes with its seat
        for (const q of [...c.members]) {
          q.cluster = null;
          q.role = "wander";
          q.state = "pause";
          q.timer = rnd(0.2, 1);
        }
        this.dropSeats(c);
        const ci = this.clusters.indexOf(c);
        if (ci >= 0) this.clusters.splice(ci, 1);
      }
    }
    if (p.sack) p.group.remove(p.sack);
    if (p.bought) {
      p.bought.removeFromParent();
      p.bought = null;
    }
    if (p.lantern) this.dropLantern(p);
    if (p.veh) this.dropVehicle(p);
    for (const r of this.carts.get(p)?.rects ?? []) this.ground.removeMover?.(r);
    this.carts.get(p)?.dispose();
    this.carts.delete(p);
    p.group.remove(p.human.root);
    this.scene.remove(p.group);
    let list = this.pool.get(p.kind);
    if (!list) this.pool.set(p.kind, (list = []));
    list.push(p.human);
  }
}

/** A soft round glow for lantern halos (the same idea as the gas lamps'). */
function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Busy places from the map's named places (shared/city.json "places":
 * {name: {x, z, kind}}): quays and squares as they are, the ground round a
 * building as a street, a basin's quays as quay. The points may sit inside a
 * wall or in the water; the crowd looks for open ground within the radius.
 */
export function placesFromCity(places: Record<string, { x: number; z: number; kind: string }>): BusyPlace[] {
  const out: BusyPlace[] = [];
  for (const p of Object.values(places)) {
    if (p.kind === "quay") out.push({ x: p.x, z: p.z, kind: "quay", r: 18 });
    else if (p.kind === "square") out.push({ x: p.x, z: p.z, kind: "square", r: 14 });
    else if (p.kind === "building") out.push({ x: p.x, z: p.z, kind: "street", r: 14 });
    else if (p.kind === "water") out.push({ x: p.x, z: p.z, kind: "quay", r: 24 });
    // the town wall (tools/city/rampart.py): the gates, and the walk on the wall, the town's promenade
    else if (p.kind === "gate") out.push({ x: p.x, z: p.z, kind: "street", r: 10 });
    else if (p.kind === "rampart") out.push({ x: p.x, z: p.z, kind: "street", r: 6 });
  }
  return out;
}

/**
 * Busy places found on the walk map alone, for a map that has no list yet:
 * open ground by the water (quay), wide open ground (square), the rest (street).
 * Samples every `step` metres in a box; use once, it is not cheap on a big box.
 */
export function findPlaces(flags: CrowdGround["flags"], x0: number, z0: number, x1: number, z1: number, step = 12): BusyPlace[] {
  const out: BusyPlace[] = [];
  const open = (x: number, z: number) => flags(x, z) === 0;
  const ring = (x: number, z: number, r: number, k: number, test: (x: number, z: number) => boolean) => {
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2;
      if (!test(x + Math.cos(a) * r, z + Math.sin(a) * r)) return false;
    }
    return true;
  };
  const dry = (x: number, z: number) => {
    const f = flags(x, z);
    return f === undefined || (f & WATER) === 0 || (f & WALL) !== 0;
  };
  for (let z = z0; z <= z1; z += step) {
    for (let x = x0; x <= x1; x += step) {
      if (!open(x, z) || !ring(x, z, 1, 6, open)) continue;
      if (!ring(x, z, 4, 8, dry)) out.push({ x, z, kind: "quay" });
      else if (ring(x, z, 6, 12, open) && ring(x, z, 9, 12, open)) out.push({ x, z, kind: "square" });
      else if (ring(x, z, 2, 8, open)) out.push({ x, z, kind: "street" });
    }
  }
  return out;
}
