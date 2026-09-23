import * as THREE from "three";
import { psx } from "../retro/psx";
import type { Rect } from "../world/geom";
import { makeHuman, whenHumans, type Human, type HumanKind, type Motion } from "./humans";
import { loadProps, type Props } from "../world/props3d";
import { PushCart, handsOf, hideBakedCart } from "../world/traffic";

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
  /** Optional: must a walker stop before stepping to (x, z)? (an opening bridge: wait at its end) */
  gate?(x: number, z: number): boolean;
  /** Optional: height of the walkable ground (the Steen's courtyard and ramp, the gangway, the pontoon). */
  baseAt?(x: number, z: number): number;
  /** Optional: make the crates people sit on solid for the player. */
  addCollider?(r: Rect): void;
  removeCollider?(r: Rect): void;
}

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
type Role = "wander" | "haul" | "group" | "follow" | "puppet";
type State = "walk" | "pause" | "chat" | "stand" | "sit" | "wait" | "blocked";

interface Lantern {
  g: THREE.Group;
  halo: THREE.Sprite;
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
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ------------------------------------------------------------------ walk grid

/** A square window of 1 m cells round a point: open (1) or not (0), plus A*. */
class NavGrid {
  readonly n: number;
  x0 = 0;
  z0 = 0;
  cx = 0;
  cz = 0;
  built = false;
  readonly open: Uint8Array;
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
    this.g = new Float32Array(N);
    this.f = new Float32Array(N);
    this.from = new Int32Array(N);
    this.stamp = new Int32Array(N);
    this.closed = new Int32Array(N);
    this.heap = new Int32Array(N);
  }

  /** Rebuild round (cx, cz). False while the walk map is not in. */
  build(flags: CrowdGround["flags"], cx: number, cz: number, solids: Rect[] = []): boolean {
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
        this.open[iz * n + ix] =
          flags(x, z) === 0 &&
          flags(x + R, z) === 0 &&
          flags(x - R, z) === 0 &&
          flags(x, z + R) === 0 &&
          flags(x, z - R) === 0 &&
          flags(x + D, z + D) === 0 &&
          flags(x - D, z + D) === 0 &&
          flags(x + D, z - D) === 0 &&
          flags(x - D, z - D) === 0
            ? 1
            : 0;
      }
    }
    // crates, carts, crane legs, lamps and trees: close every cell within a body's
    // width of them, so paths go round them instead of into them
    const B = 0.45;
    for (const c of solids) {
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
    if (c >= 0) this.open[c] = 0;
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
  lineOpen(ax: number, az: number, bx: number, bz: number): boolean {
    const L = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(L / 0.35));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!this.isOpen(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** A* over the open cells, straightened into a few waypoints. Null if there is no way. */
  path(sx: number, sz: number, tx: number, tz: number, maxExpand = 9000): V[] | null {
    const s0 = this.nearestOpen(sx, sz, 2);
    const t0 = this.nearestOpen(tx, tz, 2);
    if (!s0 || !t0) return null;
    const s = this.cell(s0.x, s0.z);
    const t = this.cell(t0.x, t0.z);
    const n = this.n;
    const tix = t % n;
    const tiz = (t / n) | 0;
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
    cells[cells.length - 1] = { x: tx, z: tz };
    // string pulling: keep only the corners
    const out: V[] = [];
    let anchor: V = { x: sx, z: sz };
    for (let i = 1; i < cells.length; i++) {
      if (!this.lineOpen(anchor.x, anchor.z, cells[i].x, cells[i].z)) {
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
  private pathBudget = 0;
  private fogFar = 25;
  private player: V = { x: 0, z: 0 };
  private camera: THREE.Camera | null = null;
  private readonly frustum = new THREE.Frustum();
  private readonly m4 = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly tmp = new THREE.Vector3();
  private readonly sackMat: THREE.Material;
  private crateMat: THREE.Material;
  private readonly sackGeo: THREE.BufferGeometry;
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
    this.sackMat = opts.mats?.sack ?? psx(new THREE.MeshLambertMaterial({ color: 0x8a7650 }));
    this.crateMat = opts.mats?.crate ?? psx(new THREE.MeshLambertMaterial({ color: 0x4a3a28 }));
    this.sackGeo = new THREE.IcosahedronGeometry(0.5, 0).scale(0.46, 0.34, 0.3);
    this.crateGeo = new THREE.BoxGeometry(0.5, 0.45, 0.4).translate(0, 0.225, 0);
    this.lanternGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.16, 4).translate(0, -0.08, 0);
    this.lanternCapGeo = new THREE.ConeGeometry(0.075, 0.07, 4).translate(0, 0.035, 0);
    this.lanternMat = new THREE.MeshBasicMaterial({ color: 0xffc070, fog: false });
    this.lanternIron = psx(new THREE.MeshLambertMaterial({ color: 0x1a1a1a }));
    this.haloMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.45, fog: false });
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

  update(dt: number, player: V, camera?: THREE.Camera): void {
    if (!this.ready) return;
    this.player = { x: player.x, z: player.z };
    this.camera = camera ?? null;
    const g = this.grid;
    this.gridAge += dt;
    const solids = this.ground.solids?.() ?? [];
    // rebuild when the player has moved on, now and then, and when things were put down or taken away
    if (!g.built || Math.hypot(player.x - g.cx, player.z - g.cz) > 20 || this.gridAge > 60 || solids.length !== this.solidCount) {
      if (!g.build(this.ground.flags, player.x, player.z, solids)) return;
      this.gridAge = 0;
      this.solidCount = solids.length;
    }
    this.fogFar = (this.scene.fog as THREE.Fog | null)?.far ?? 40;
    if (camera) {
      camera.updateMatrixWorld();
      this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.frustum.setFromProjectionMatrix(this.m4);
    }
    this.pathBudget = 3;

    // --- how many, by the hour
    // M3e: with the town's residents about (puppets), the nameless crowd stays home
    const target = this.anonymous ? Math.round(this.budget * density(this.hour)) : 0;
    const crowdN = this.people.length - this.puppetCount;
    for (const p of [...this.people]) {
      if (p.role !== "puppet" && !p.townFollow && Math.hypot(p.x - player.x, p.z - player.z) > this.radius + 8) this.recycle(p);
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
          .filter((p) => !p.shown && !p.cluster && !p.lead && p.role !== "puppet")
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
          if (p.shown || p.cluster || p.lead || p.role === "puppet") continue;
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
        const lit = this.people.find((p) => p.lantern && !p.shown && p.role !== "puppet");
        if (lit) {
          this.scene.remove(lit.lantern!.g);
          lit.lantern = null;
        }
      }
    }

    // --- groups
    for (const c of [...this.clusters]) this.updateCluster(c, dt);
    if (this.strays.length) {
      this.strays = this.strays.filter((s) => {
        if (!this.hidden(s.mesh.position.x, s.mesh.position.z)) return true;
        this.scene.remove(s.mesh);
        if (s.rect) this.ground.removeCollider?.(s.rect);
        return false;
      });
    }

    // --- everyone
    let drawn = 0;
    let animated = 0;
    for (const p of this.people) {
      p.chatCd -= dt;
      this.think(p, dt);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      const inView = d < this.fogFar + 4 && this.inFrustum(p.x, p.z, 1.3 * p.size);
      p.shown = inView;
      p.group.visible = inView;
      let y = 0;
      if (inView) {
        drawn++;
        // near ones every frame, far ones at 15 fps: nobody counts frames in the fog
        p.animAcc += dt;
        if (d < 30 || p.animAcc >= 1 / 15) {
          p.human.update(p.animAcc);
          p.animAcc = 0;
          animated++;
        }
      }
      const want = p.state === "sit" ? p.human.sitDrop() * p.size : 0;
      p.drop += (want - p.drop) * Math.min(1, dt * 4);
      if (inView) y = p.drop + (p.state === "sit" ? 0 : p.human.bob() * p.size);
      p.group.position.set(p.x, y + (this.ground.baseAt?.(p.x, p.z) ?? 0), p.z);
      p.group.rotation.y = p.yaw;
      if (p.kind === "carter") this.pushCart(p, dt, inView);
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
    for (const p of this.people) if (p.role === "puppet" || p.townFollow) n++;
    return n;
  }

  /** A resident appears at (x, z); null while the models load. */
  addPuppet(kind: HumanKind, x: number, z: number, yaw = 0, pace = 1.3): Puppet | null {
    if (!this.ready) return null;
    const p = this.make(kind, x, z, "puppet");
    if (!p) return null;
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
    p.replans = 0;
    p.held = 0;
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
  puppetLoad(p: Puppet, on: boolean): void {
    p.handCarry = true;
    this.setLoad(p, on);
  }

  /** A lantern in hand (police at night, people with work for Jef after dark). */
  puppetLantern(p: Puppet, on: boolean): void {
    if (on && !p.lantern) this.giveLantern(p);
    else if (!on && p.lantern) {
      this.scene.remove(p.lantern.g);
      p.lantern = null;
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
      p.state = "stand";
    } else if (p.townFollow) {
      if (p.lead && p.lead.follower === p) p.lead.follower = null;
      p.lead = null;
      p.townFollow = false;
      p.role = "puppet";
      p.path = [];
      p.dest = null;
      p.state = "stand";
      p.pmotion = "idle";
    }
  }

  /** Is this puppet walking at someone's side now? */
  puppetFollowing(p: Puppet): boolean {
    return p.role === "follow" && !!p.lead;
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
      sack: () => [new THREE.IcosahedronGeometry(0.14, 0).scale(1, 1.3, 0.9).translate(0, -0.16, 0), this.sackMat],
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

  /** Where everyone walking is now (townspeople included): the train and the omnibus stop for them. */
  positions(): Array<{ x: number; z: number }> {
    return this.people.map((p) => ({ x: p.x, z: p.z }));
  }

  get fogDistance(): number {
    return this.fogFar;
  }

  private puppetThink(p: Person, dt: number): void {
    switch (p.state) {
      case "walk":
        this.walk(p, dt);
        break;
      case "wait":
        if (p.dest) this.goTo(p, p.dest);
        break;
      case "blocked":
        // Jef in the way: face him, wait, then find a way round
        p.human.play("idle", 0.3);
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
      return;
    }
    if (!l) {
      p.role = "wander";
      p.state = "pause";
      p.timer = rnd(0.5, 2);
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
    const tx = l.x - Math.cos(l.yaw) * 0.62;
    const tz = l.z + Math.sin(l.yaw) * 0.62;
    const dx = tx - p.x;
    const dz = tz - p.z;
    const d = Math.hypot(dx, dz);
    const walking = l.state === "walk";
    if (d > 0.12) {
      const sp = Math.min(d * 3, (walking ? l.pace : 0.8) * (d > 0.6 ? 1.3 : 1));
      const step = Math.min(d, sp * dt);
      const nx = p.x + (dx / d) * step;
      const nz = p.z + (dz / d) * step;
      if (this.ground.isFree(nx, nz, 0.22)) {
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
    // no closer to the next waypoint for a while (pushed aside, or something in the
    // way the grid does not know): close the cell ahead and find another way
    if (len < p.bestD - 0.25) {
      p.bestD = len;
      p.stuckT = 0;
    } else if ((p.stuckT += dt) > 2.5) {
      p.stuckT = 0;
      p.bestD = Infinity;
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
    side = Math.max(-1.2, Math.min(1.2, side));
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
    const tryMove = (x: number, z: number) =>
      this.ground.isFree(x, z, 0.25) &&
      (this.grid.isOpen(x, z) || !this.grid.isOpen(p.x, p.z)) &&
      // a cart before the man: its front must fit too
      (p.nose === 0 || this.ground.isFree(x + ux * p.nose, z + uz * p.nose, p.reach));
    if (tryMove(p.x + mx * step, p.z + mz * step)) {
      p.x += mx * step;
      p.z += mz * step;
    } else if (tryMove(p.x + ux * step, p.z + uz * step)) {
      p.x += ux * step;
      p.z += uz * step;
      mx = ux;
      mz = uz;
    } else {
      // something the walk map does not know: remember it and find another way
      this.grid.block(p.x + ux * (0.6 + p.nose), p.z + uz * (0.6 + p.nose));
      p.replans++;
      if (p.replans > 3 || !p.dest) this.next(p, true);
      else this.goTo(p, p.dest);
      return;
    }
    this.face(p, Math.atan2(mx, mz), dt * 1.4);
    const motion: Motion = p.loaded && p.handCarry ? "carry" : "walk";
    p.human.play(motion, 0.25);
    p.human.setPace(p.pace / p.size);
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
      p.dest = null;
      p.state = "stand";
      p.human.play(p.pmotion ?? "idle", 0.3);
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
        p.human.play(p.pmotion ?? "idle", 0.3);
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
    if (this.pathBudget <= 0) {
      p.state = "wait";
      p.human.play(this.standMotion(p), 0.3);
      return;
    }
    this.pathBudget--;
    const path = this.grid.path(p.x, p.z, dest.x, dest.z);
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
    }
  }

  private setLoad(p: Person, on: boolean): void {
    p.loaded = on;
    if (!p.handCarry) return;
    if (on && !p.sack) {
      const s = new THREE.Mesh(this.sackGeo, this.sackMat);
      const k = p.human.scale;
      s.position.set(0, 1.1 * k, 0.3 * k);
      s.rotation.set(0.15, 0.2, 0.1);
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
    p.lantern = { g, halo };
  }

  private placeLantern(p: Person, d: number): void {
    const l = p.lantern!;
    // a light carries further in the fog than the one who carries it
    const on = d < this.fogFar * 1.8 && this.inFrustum(p.x, p.z, 1.5);
    l.g.visible = on;
    if (!on) return;
    if (p.hand && p.shown) {
      p.hand.getWorldPosition(this.tmp);
      l.g.position.set(this.tmp.x, this.tmp.y - 0.1 * p.size, this.tmp.z);
    } else l.g.position.set(p.x + Math.cos(p.yaw) * -0.25, 0.75 * p.size, p.z - Math.sin(p.yaw) * -0.25);
    const flick = 0.4 + 0.06 * Math.sin(performance.now() * 0.013 + p.x);
    l.halo.material.opacity = flick; // shared material: all lanterns breathe together, gently
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
    if (p.lantern) this.scene.remove(p.lantern.g);
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
