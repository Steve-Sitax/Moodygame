import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { makeHuman, type Human, type HumanKind } from "../game/humans";
import type { Props } from "./props3d";
import type { Rect } from "./geom";

// Traffic on the quays (props from tools/blender/build_props.py, the "tr_" parts):
// one-horse drays and handcarts going round at walking pace, as in the period photos
// of the Vlaamse Kaai and the Werf. A dray is its bed, a fore-carriage that turns
// with the horse, two wheel pairs that roll, a load, the horse's body and four legs
// in a walk; a carter walks at the horse's head. A handcart is pushed by a carter.
// They stop for the player and for anything in their way, wait behind each other,
// and stand at a storehouse gate now and then.
//
// The routes are fixed loops on open ground (the lanes are kept clear of goods by
// dressCity in props3d.ts). Each route is checked against the walk map when the
// traffic is made; a route that runs into a wall or the water is left out.
//
// Cheap: all drays share one InstancedMesh per part (about ten draw calls for every
// dray in the city), a handcart is two meshes; everything beyond the fog is hidden.

type Flags = (x: number, z: number) => number | undefined;
type V2 = [number, number];

export type VehicleKind = "dray" | "handcart";
export type DrayLoad = "casks" | "sacks" | "bales" | "tarp";

export interface TrafficRoute {
  name: string;
  /** Corner points on open ground. */
  pts: V2[];
  /** true: a closed loop; false: out and back (the far end turns round). */
  loop: boolean;
  /** Places to stand a while (a storehouse gate): the point on the route, seconds, chance per pass. */
  stops?: Array<{ at: V2; secs: number; chance: number }>;
  /** What goes round, and where it starts (0..1 along the route). */
  vehicles: Array<{ kind: VehicleKind; at: number; load?: DrayLoad }>;
}

/** The routes. Loops round blocks on the map (shared/city.json, M3d); lanes are 3.8 m (drays) or 2.8 m wide. */
export const TRAFFIC_ROUTES: TrafficRoute[] = [
  {
    // round the block behind the Rijnkaai (the streets south of the Hessenatie)
    name: "rijnkaai_back",
    pts: [[33, 69.5], [33, 108.5], [-4.75, 108.5], [-4.75, 69.5]],
    loop: true,
    stops: [{ at: [14, 108.5], secs: 18, chance: 0.5 }],
    vehicles: [{ kind: "dray", at: 0.1, load: "casks" }],
  },
  {
    // the Eilandje: past the lock, along the storehouses, the north quay of the Petit Bassin
    name: "eilandje",
    pts: [[120, 11], [160, 11], [160, 43], [120, 43]],
    loop: true,
    stops: [{ at: [137.5, 43], secs: 25, chance: 0.7 }],
    vehicles: [
      { kind: "dray", at: 0.05, load: "bales" },
      { kind: "handcart", at: 0.55 },
    ],
  },
  {
    // the Werf along the river, round the block behind it
    name: "werf",
    pts: [[-305, 8.3], [-216, 8.3], [-216, 30], [-305, 30]],
    loop: true,
    stops: [{ at: [-249, 8.3], secs: 20, chance: 0.6 }],
    vehicles: [
      { kind: "dray", at: 0.2, load: "tarp" },
      { kind: "handcart", at: 0.7 },
    ],
  },
  {
    // the south quay of the Petit Bassin to the storehouse gates by the Entrepot, and back
    name: "bassin_south",
    // z 119.5: clear of the quay railway along z 116 (M3g: the goods train runs there)
    pts: [[74, 119.5], [168, 119.5], [176, 122], [196, 122]],
    loop: false,
    stops: [{ at: [186.5, 122], secs: 20, chance: 0.8 }],
    vehicles: [{ kind: "handcart", at: 0.3 }],
  },
];

/** Half the width of the lane each kind needs (metres). */
export const LANE_HALF: Record<VehicleKind, number> = { dray: 1.9, handcart: 1.4 };

/** The lanes as the vehicles drive them (points every 0.25 m) and their half width: for dressCity to keep clear. */
export function trafficLanes(): Array<{ x: Float32Array; z: Float32Array; half: number }> {
  return TRAFFIC_ROUTES.map((r) => {
    const half = Math.max(...r.vehicles.map((v) => LANE_HALF[v.kind]));
    const p = makePath(r, half);
    return { x: p.x, z: p.z, half };
  });
}

// ------------------------------------------------------------------ geometry of a route

/** A route as points every STEP metres, corners rounded; out-and-back routes become a thin loop. */
interface Path {
  x: Float32Array;
  z: Float32Array;
  length: number;
}

const STEP = 0.25;

function roundedLoop(pts: V2[], radius: number): V2[] {
  const out: V2[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[(i + n - 1) % n];
    const b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, la / 2.2, lb / 2.2);
    const ua: V2 = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
    const ub: V2 = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
    // a quadratic curve from the point r before the corner to r after it
    const s: V2 = [p[0] + ua[0] * r, p[1] + ua[1] * r];
    const e: V2 = [p[0] + ub[0] * r, p[1] + ub[1] * r];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      out.push([(1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p[0] + t * t * e[0], (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p[1] + t * t * e[1]]);
    }
  }
  return out;
}

function makePath(route: TrafficRoute, half: number): Path {
  let pts = route.pts;
  if (!route.loop) {
    // out on one side of the line, back on the other, turning round at the ends
    const off = half * 0.45;
    const side = (sign: number): V2[] =>
      pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)];
        const b = pts[Math.min(pts.length - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [p[0] - ((b[1] - a[1]) / l) * off * sign, p[1] + ((b[0] - a[0]) / l) * off * sign] as V2;
      });
    pts = [...side(1), ...side(-1).reverse()];
  }
  const poly = roundedLoop(pts, route.loop ? 6 : 2.2);
  poly.push(poly[0]);
  const xs: number[] = [];
  const zs: number[] = [];
  let carry = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    let t = carry;
    while (t < l) {
      xs.push(ax + ((bx - ax) * t) / l);
      zs.push(az + ((bz - az) * t) / l);
      t += STEP;
    }
    carry = t - l;
  }
  return { x: Float32Array.from(xs), z: Float32Array.from(zs), length: xs.length * STEP };
}

function wrap(s: number, L: number): number {
  return ((s % L) + L) % L;
}

function at(p: Path, s: number, out: { x: number; z: number }): { x: number; z: number } {
  const u = wrap(s, p.length) / STEP;
  const i = Math.floor(u);
  const j = (i + 1) % p.x.length;
  const f = u - i;
  out.x = p.x[i] + (p.x[j] - p.x[i]) * f;
  out.z = p.z[i] + (p.z[j] - p.z[i]) * f;
  return out;
}

/** Yaw (about +y, 0 = +z) of the path at s, looking along it. */
function heading(p: Path, s: number): number {
  const a = at(p, s - 0.6, { x: 0, z: 0 });
  const b = at(p, s + 0.6, { x: 0, z: 0 });
  return Math.atan2(b.x - a.x, b.z - a.z);
}

function nearestS(p: Path, x: number, z: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < p.x.length; i++) {
    const d = (p.x[i] - x) ** 2 + (p.z[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best * STEP;
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** An axis-aligned box round a stretch of a vehicle: centre, heading, half length and half width. */
function boxAround(r: Rect, x: number, z: number, yaw: number, hl: number, hw: number, top: number): void {
  const s = Math.abs(Math.sin(yaw));
  const c = Math.abs(Math.cos(yaw));
  const ex = s * hl + c * hw;
  const ez = c * hl + s * hw;
  r.minX = x - ex;
  r.maxX = x + ex;
  r.minZ = z - ez;
  r.maxZ = z + ez;
  r.top = top;
}

// ------------------------------------------------------------------ the pushed handcart

/**
 * The carters of the crowd have a handcart baked into their model (people.glb), bound to
 * the hips: it bobs with the walk and never turns its wheels. This folds it away (the
 * vertices bound to the hips more than 0.3 m in front of the body); a PushCart takes its
 * place. The geometry is shared by every carter, so this runs once.
 */
const stripped = new WeakSet<THREE.BufferGeometry>();
export function hideBakedCart(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || stripped.has(m.geometry)) return;
    stripped.add(m.geometry);
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    const si = m.geometry.getAttribute("skinIndex") as THREE.BufferAttribute;
    const sw = m.geometry.getAttribute("skinWeight") as THREE.BufferAttribute;
    const hips = m.skeleton.bones.findIndex((b) => b.name === "hips");
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (si.getX(i) === hips && sw.getX(i) > 0.99 && pos.getZ(i) > 0.3) {
        pos.setXYZ(i, 0, 1.0, 0); // inside the body: the triangles fold to nothing
        n++;
      }
    }
    if (n) {
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
    }
  });
}

/** Where the grips are on the cart (tr_handcart, origin on the ground under the axle; the shafts point along +z). */
const CART_R = 0.57;
const GRIP_Z = 2.15;
const GRIP_Y = 0.75; // grips when the cart stands level on its wheels and prop legs

export interface PushCartOptions {
  /** A load of sacks and a crate, lashed down. Default true. */
  load?: boolean;
}

/**
 * A two-wheeled handcart pushed from its grips. It rests on its wheels on the ground;
 * the grips go where the hands are, so the cart tips about its axle to reach them. The
 * cart swings round behind the turn (it lags on bends) and its wheels roll with the
 * ground covered. Let go of it and it settles on its prop legs.
 */
export class PushCart {
  readonly root = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private readonly wheels: THREE.Mesh;
  /** The cart's heading (the way it is pushed), its axle point, wheel turn and tilt. */
  private dir = 0;
  private ax = 0;
  private az = 0;
  private spin = 0;
  private tilt = 0;
  private held = 0;
  private placed = false;
  /** Walk colliders: the bed with the wheels, and the shafts (stable objects, moved in place). */
  readonly rects: Rect[] = [
    { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 1.3 },
    { minX: 0, maxX: 0, minZ: 0, maxZ: 0, top: 1.0 },
  ];

  constructor(parent: THREE.Object3D, props: Props, opts: PushCartOptions = {}) {
    const body = mergedPart(props, opts.load === false ? ["tr_handcart"] : ["tr_handcart", "tr_handcart_load"]);
    const wheels = mergedPart(props, ["tr_handcart_wheels"]);
    const mat = props.materials.goods;
    this.pivot.position.y = CART_R;
    const bm = new THREE.Mesh(body, mat);
    bm.position.y = -CART_R;
    this.pivot.add(bm);
    this.wheels = new THREE.Mesh(wheels, mat);
    this.wheels.position.y = CART_R;
    this.root.add(this.pivot, this.wheels);
    this.root.name = "pushcart";
    parent.add(this.root);
  }

  /** Put the cart down with its grips at (x, z), pushed toward yaw. */
  place(x: number, z: number, yaw: number): void {
    this.dir = yaw;
    this.ax = x + Math.sin(yaw) * GRIP_Z;
    this.az = z + Math.cos(yaw) * GRIP_Z;
    this.placed = true;
    this.pose();
  }

  /**
   * Follow the hands: grip point (x, z) at height y, the man walking toward yaw. `hold` 1 =
   * in his hands, 0 = let go (the cart stays put and sinks onto its legs).
   */
  push(dt: number, x: number, z: number, y: number, yaw: number, hold: number): void {
    if (!this.placed) this.place(x, z, yaw);
    this.held += (hold - this.held) * Math.min(1, dt * 3);
    if (hold > 0.5) {
      // the heading comes round behind the man's (the cart lags on a bend) ...
      this.dir += angDiff(yaw, this.dir) * Math.min(1, dt * 2.2);
      // ... and the cart hangs from the grips: the axle sits GRIP_Z out along the heading
      const ox = this.ax;
      const oz = this.az;
      const reach = this.gripReach();
      // taking hold again after a rest: the cart comes to the hands over a moment, no jump
      const k = this.held > 0.9 ? 1 : Math.min(1, dt * 4);
      this.ax += (x + Math.sin(this.dir) * reach - this.ax) * k;
      this.az += (z + Math.cos(this.dir) * reach - this.az) * k;
      // the wheels roll with the ground covered along the heading
      this.spin += ((this.ax - ox) * Math.sin(this.dir) + (this.az - oz) * Math.cos(this.dir)) / CART_R;
    }
    // tip about the axle so the grips reach the hands (let go: down onto the legs)
    const want = this.tiltFor(y) * this.held;
    this.tilt += (want - this.tilt) * Math.min(1, dt * 6);
    this.pose();
  }

  /** Where the cart stands: axle point on the ground, heading (the way it is pushed). */
  get axle(): { x: number; z: number; yaw: number } {
    return { x: this.ax, z: this.az, yaw: this.dir };
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }

  dispose(): void {
    this.root.removeFromParent();
  }

  private gripReach(): number {
    const dy0 = GRIP_Y - CART_R;
    const rho = Math.hypot(dy0, GRIP_Z);
    return rho * Math.cos(Math.atan2(dy0, GRIP_Z) - this.tilt);
  }

  /** The tilt (about the axle; negative lifts the grips) that brings the grips to height y. */
  private tiltFor(y: number): number {
    const dy0 = GRIP_Y - CART_R;
    const rho = Math.hypot(dy0, GRIP_Z);
    const k = THREE.MathUtils.clamp((y - CART_R) / rho, -0.2, 0.5);
    return Math.atan2(dy0, GRIP_Z) - Math.asin(k);
  }

  private pose(): void {
    // the shafts point back at the man (local +z): the cart looks the other way from where it goes
    const yaw = this.dir + Math.PI;
    this.root.position.set(this.ax, 0, this.az);
    this.root.rotation.y = yaw;
    this.pivot.rotation.x = this.tilt;
    // pushed toward local -z: rolling that way turns the wheels backward about x
    this.wheels.rotation.x = -this.spin;
    const cx = this.ax + Math.sin(this.dir) * -0.02;
    const cz = this.az + Math.cos(this.dir) * -0.02;
    boxAround(this.rects[0], cx, cz, this.dir, 0.95, 0.72, 1.3);
    const mid = GRIP_Z / 2 + 0.5;
    boxAround(this.rects[1], this.ax - Math.sin(this.dir) * mid, this.az - Math.cos(this.dir) * mid, this.dir, 0.6, 0.42, 1.0);
  }
}

/** One geometry from parts of props.glb (all on the goods atlas). */
function mergedPart(props: Props, names: string[]): THREE.BufferGeometry {
  const geos = names.flatMap((n) => props.parts(n).map((p) => p.geometry));
  return geos.length === 1 ? geos[0] : (mergeGeometries(geos, false) ?? geos[0]);
}

// ------------------------------------------------------------------ the traffic

export interface TrafficOptions {
  /** Is (x, z) free for a body of radius r (walls, water, things, people)? Vehicles wait when it is not. */
  isFree?: (x: number, z: number, r: number) => boolean;
  /** Seed for who stops where. */
  seed?: number;
}

export interface Traffic {
  /** Move everything; call every frame with the game time and where the player is. */
  update(t: number, dt: number, player: { x: number; z: number }): void;
  /** Walk colliders of the vehicles. Stable objects, moved in place every frame: add them once. */
  colliders(): Rect[];
  group: THREE.Group;
  /** Dev: where each vehicle is and what it does. */
  info(): Array<{ route: string; kind: VehicleKind; x: number; z: number; state: string }>;
}

interface Vehicle {
  kind: VehicleKind;
  route: TrafficRoute;
  path: Path;
  /** Arc position of the reference point (dray: rear axle; handcart: the axle). */
  s: number;
  v: number;
  pace: number;
  state: "go" | "wait" | "stand";
  timer: number;
  /** The stops ahead, as arc positions; the last stop done (to stop once per pass). */
  stops: Array<{ s: number; secs: number; chance: number }>;
  lastStop: number;
  load: DrayLoad;
  index: number;
  gait: number;
  roll: [number, number];
  rects: Rect[];
  man: Human | null;
  manKind: HumanKind;
  manGroup: THREE.Group;
  cart: PushCart | null;
  shown: boolean;
  /** Front and back of the rig, as arc offsets from s. */
  front: number;
  back: number;
  /** Where it is now (the reference point), for culling. */
  px: number;
  pz: number;
}

// dray layout along the path (metres ahead of the rear axle)
const WHEELBASE = 2.4;
const HORSE_AHEAD = 2.05; // front axle to the horse's middle
const LEG_POS: Array<[number, number, number, "leg_front" | "leg_hind", number]> = [
  // x (left +), y (hip height), z (ahead +), leg, phase in the walk (left hind, left fore, right hind, right fore)
  [0.19, 1.05, 0.62, "leg_front", 0.25],
  [-0.19, 1.05, 0.62, "leg_front", 0.75],
  [0.2, 1.1, -0.62, "leg_hind", 0.0],
  [-0.2, 1.1, -0.62, "leg_hind", 0.5],
];
const LOADS: DrayLoad[] = ["casks", "sacks", "bales", "tarp"];

/**
 * Make the traffic. Needs the walk map (await city.ready first) and the props (loadProps()).
 * Returns the colliders to add to the world (once: they move in place).
 */
export function createTraffic(scene: THREE.Scene, flags: Flags, props: Props, opts: TrafficOptions = {}): Traffic {
  const group = new THREE.Group();
  group.name = "traffic";
  scene.add(group);
  const mat = props.materials.goods;
  let seed = (opts.seed ?? 1873) >>> 0;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // --- routes that fit the map
  const vehicles: Vehicle[] = [];
  const tmp = { x: 0, z: 0 };
  for (const route of TRAFFIC_ROUTES) {
    const half = Math.max(...route.vehicles.map((v) => LANE_HALF[v.kind]));
    const path = makePath(route, half);
    const body = route.vehicles.some((v) => v.kind === "dray") ? 1.0 : 0.75;
    let bad: V2 | null = null;
    for (let i = 0; i < path.x.length && !bad; i += 2) {
      const x = path.x[i];
      const z = path.z[i];
      const h = heading(path, i * STEP);
      for (const o of [-body, 0, body]) {
        if ((flags(x + Math.cos(h) * o, z - Math.sin(h) * o) ?? 1) !== 0) {
          bad = [x, z];
          break;
        }
      }
    }
    if (bad) {
      console.warn(`traffic: route ${route.name} runs into a wall or the water near (${bad[0].toFixed(1)}, ${bad[1].toFixed(1)}); left out`);
      continue;
    }
    for (const v of route.vehicles) {
      const dray = v.kind === "dray";
      const manGroup = new THREE.Group();
      group.add(manGroup);
      const veh: Vehicle = {
        kind: v.kind,
        route,
        path,
        s: v.at * path.length,
        v: 0,
        pace: dray ? 1.2 + rnd() * 0.15 : 1.0 + rnd() * 0.12,
        state: "go",
        timer: 0,
        stops: (route.stops ?? []).map((st) => ({ s: nearestS(path, st.at[0], st.at[1]), secs: st.secs, chance: st.chance })),
        lastStop: -1,
        load: v.load ?? LOADS[vehicles.length % LOADS.length],
        index: 0,
        gait: rnd(),
        roll: [0, 0],
        rects: dray
          ? Array.from({ length: 4 }, () => ({ minX: 0, maxX: 0, minZ: 0, maxZ: 0 }) as Rect)
          : [],
        man: null,
        manKind: dray ? (["docker_b", "docker_a", "docker_c"] as HumanKind[])[vehicles.length % 3] : "carter",
        manGroup,
        cart: dray ? null : new PushCart(group, props),
        shown: true,
        front: dray ? WHEELBASE + HORSE_AHEAD + 1.7 : 0.95,
        back: dray ? -0.8 : -(GRIP_Z + 0.9),
        px: 0,
        pz: 0,
      };
      if (veh.cart) veh.rects = veh.cart.rects;
      vehicles.push(veh);
    }
  }

  // --- the drays: one InstancedMesh per part
  const drays = vehicles.filter((v) => v.kind === "dray");
  drays.forEach((d, i) => (d.index = i));
  const inst = (name: string, count: number): THREE.InstancedMesh | null => {
    if (!count) return null;
    const g = mergedPart(props, [name]);
    const m = new THREE.InstancedMesh(g, mat, count);
    m.name = name;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(m);
    return m;
  };
  const nD = drays.length;
  const parts = {
    bed: inst("tr_dray_bed", nD),
    fore: inst("tr_dray_fore", nD),
    rear: inst("tr_wheels_rear", nD),
    front: inst("tr_wheels_front", nD),
    horse: inst("tr_horse_body", nD),
    legF: inst("tr_leg_front", nD * 2),
    legH: inst("tr_leg_hind", nD * 2),
  };
  const loads = new Map<DrayLoad, { mesh: THREE.InstancedMesh; who: Vehicle[] }>();
  for (const l of LOADS) {
    const who = drays.filter((d) => d.load === l);
    const mesh = inst(`tr_load_${l}`, who.length);
    if (mesh) loads.set(l, { mesh, who });
  }

  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const P = new THREE.Vector3();
  const S1 = new THREE.Vector3(1, 1, 1);
  const set = (m: THREE.InstancedMesh | null, i: number, x: number, y: number, z: number, yaw: number, pitch = 0) => {
    if (!m) return;
    E.set(pitch, yaw, 0, "YXZ");
    Q.setFromEuler(E);
    P.set(x, y, z);
    M.compose(P, Q, S1);
    m.setMatrixAt(i, M);
  };
  const instanced = (): THREE.InstancedMesh[] =>
    [...Object.values(parts), ...[...loads.values()].map((l) => l.mesh)].filter((m): m is THREE.InstancedMesh => !!m);

  // What is drawn follows the camera that draws (before three.js sorts out the frame, so a
  // picture from anywhere shows what is there): nothing beyond the fog.
  const cull = (cam: THREE.Camera) => {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 40) + 15;
    const p = cam.position;
    let drays = false;
    for (const v of vehicles) {
      const near = Math.hypot(v.px - p.x, v.pz - p.z) < far;
      v.manGroup.visible = near;
      if (v.cart) v.cart.visible = near;
      if (near && v.kind === "dray") drays = true;
    }
    for (const m of instanced()) m.visible = drays;
  };
  type SceneHook = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null) => void;
  const hooked = scene as unknown as { onBeforeRender: SceneHook };
  const before = hooked.onBeforeRender;
  hooked.onBeforeRender = function (this: THREE.Scene, renderer, sc, cam, target) {
    before?.call(this, renderer, sc, cam, target);
    cull(cam);
  };

  const colliders = vehicles.flatMap((v) => v.rects);
  const a = { x: 0, z: 0 };
  const b = { x: 0, z: 0 };
  const c = { x: 0, z: 0 };

  /** Anything in the way of this vehicle: the player near it, another vehicle ahead, something on the lane? */
  function blocked(v: Vehicle, player: { x: number; z: number }): boolean {
    // the player anywhere along the rig or just ahead of it
    for (let o = v.back; o <= v.front + 2.5; o += 0.8) {
      at(v.path, v.s + o, tmp);
      const r = (v.kind === "dray" ? 1.0 : 0.8) + (o > v.front ? 0.6 : 1.0);
      if (Math.hypot(player.x - tmp.x, player.z - tmp.z) < r) return true;
    }
    // the next vehicle on the same route
    for (const w of vehicles) {
      if (w === v || w.path !== v.path) continue;
      const gap = wrap(w.s + w.back - (v.s + v.front), v.path.length);
      if (gap < 2.5) return true;
    }
    // something on the lane (a crate put down, a person standing)
    if (opts.isFree) {
      at(v.path, v.s + v.front + 1.3, tmp);
      if (!opts.isFree(tmp.x, tmp.z, 0.45)) return true;
    }
    return false;
  }

  function update(_t: number, dt: number, player: { x: number; z: number }): void {
    dt = Math.min(dt, 0.1);
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 40) + 15;
    for (const v of vehicles) {
      // --- where to go
      let target = v.pace;
      if (v.state === "stand") {
        target = 0;
        v.timer -= dt;
        if (v.timer <= 0) v.state = "go";
      } else {
        const stopped = blocked(v, player);
        v.state = stopped ? "wait" : "go";
        if (stopped) target = 0;
        // a stop coming up: stand there a while (once per pass, by chance)
        for (let k = 0; k < v.stops.length; k++) {
          const st = v.stops[k];
          const ahead = wrap(st.s - v.s, v.path.length);
          if (ahead < 0.3 && v.lastStop !== k) {
            v.lastStop = k;
            if (rnd() < st.chance) {
              v.state = "stand";
              v.timer = st.secs * (0.7 + rnd() * 0.6);
              target = 0;
            }
          } else if (ahead < 4 && v.lastStop !== k) {
            target = Math.min(target, 0.35 + ahead * 0.25);
          }
        }
      }
      v.v += (target - v.v) * Math.min(1, dt * (target < v.v ? 3 : 1.2));
      if (v.v < 0.01 && target === 0) v.v = 0;
      const ds = v.v * dt;
      v.s = wrap(v.s + ds, v.path.length);
      at(v.path, v.s, a);
      v.px = a.x;
      v.pz = a.z;
      // animate only what the player could see
      v.shown = Math.hypot(player.x - a.x, player.z - a.z) < far;

      // --- the carter
      if (!v.man) {
        v.man = makeHuman(v.manKind);
        if (v.man) {
          if (v.kind === "handcart") hideBakedCart(v.man.root);
          v.manGroup.add(v.man.root);
        }
      }

      if (v.kind === "dray") {
        const i = v.index;
        at(v.path, v.s + WHEELBASE, b);
        at(v.path, v.s + WHEELBASE + HORSE_AHEAD, c);
        const bedYaw = Math.atan2(b.x - a.x, b.z - a.z);
        const foreYaw = Math.atan2(c.x - b.x, c.z - b.z);
        const horseYaw = heading(v.path, v.s + WHEELBASE + HORSE_AHEAD);
        v.roll[0] += ds / 0.52;
        v.roll[1] += ds / 0.42;
        v.gait = (v.gait + (v.v / 1.35) * dt) % 1;
        const moving = v.v > 0.05;
        set(parts.bed, i, a.x, 0, a.z, bedYaw);
        set(parts.fore, i, b.x, 0, b.z, foreYaw);
        set(parts.rear, i, a.x, 0.52, a.z, bedYaw, v.roll[0]);
        set(parts.front, i, b.x, 0.42, b.z, foreYaw, v.roll[1]);
        const ld = loads.get(v.load);
        if (ld) set(ld.mesh, ld.who.indexOf(v), a.x, 0, a.z, bedYaw);
        // the horse: a gentle rise and fall with each step, legs in a four-beat walk
        const amp = Math.min(1, v.v / 0.8);
        const bob = 0.025 * amp * Math.abs(Math.sin(v.gait * Math.PI * 4));
        set(parts.horse, i, c.x, bob, c.z, horseYaw);
        const cy = Math.cos(horseYaw);
        const sy = Math.sin(horseYaw);
        LEG_POS.forEach(([lx, ly, lz, leg, ph], k) => {
          const phase = (v.gait + ph) % 1;
          // foot forward (u = 1) to back (u = -1) on the ground for 60 % of the step, then swung forward
          const u = phase < 0.6 ? 1 - (2 * phase) / 0.6 : -1 + 2 * THREE.MathUtils.smoothstep((phase - 0.6) / 0.4, 0, 1);
          const lift = phase >= 0.6 ? 0.05 * Math.sin(((phase - 0.6) / 0.4) * Math.PI) : 0;
          const swing = -0.36 * u * amp;
          const wx = c.x + lx * cy + lz * sy;
          const wz = c.z - lx * sy + lz * cy;
          set(leg === "leg_front" ? parts.legF : parts.legH, i * 2 + (k % 2), wx, ly + bob + lift * amp, wz, horseYaw, swing);
        });
        if (!moving) v.gait = v.gait * 0.98;
        // colliders: the bed in two, the horse in two
        boxAround(v.rects[0], a.x + Math.sin(bedYaw) * 0.25, a.z + Math.cos(bedYaw) * 0.25, bedYaw, 0.95, 0.95, 1.6);
        boxAround(v.rects[1], a.x + Math.sin(bedYaw) * 2.1, a.z + Math.cos(bedYaw) * 2.1, bedYaw, 0.95, 0.95, 1.6);
        boxAround(v.rects[2], c.x - Math.sin(horseYaw) * 0.5, c.z - Math.cos(horseYaw) * 0.5, horseYaw, 0.7, 0.4, 1.8);
        boxAround(v.rects[3], c.x + Math.sin(horseYaw) * 0.9, c.z + Math.cos(horseYaw) * 0.9, horseYaw, 0.6, 0.35, 1.8);
        // the carter at the horse's head, on its left
        const hx = c.x + 0.85 * cy + 1.0 * sy;
        const hz = c.z - 0.85 * sy + 1.0 * cy;
        v.manGroup.position.set(hx, 0, hz);
        v.manGroup.rotation.y = horseYaw;
      } else {
        // the handcart goes before its carter: he walks GRIP_Z + 0.5 behind the axle
        const yaw = heading(v.path, v.s - GRIP_Z * 0.5);
        at(v.path, v.s - GRIP_Z, b);
        const mx = b.x - Math.sin(yaw) * 0.45;
        const mz = b.z - Math.cos(yaw) * 0.45;
        v.manGroup.position.set(mx, 0, mz);
        v.manGroup.rotation.y = yaw;
        const hands = handsOf(v.man, v.manGroup, mx, mz, yaw);
        v.cart!.push(dt, hands.x, hands.z, hands.y, yaw, v.state === "stand" ? 0 : 1);
      }
      // --- the man walks when the rig moves
      if (v.man) {
        const walking = v.v > 0.08;
        v.man.play(walking ? "walk" : "idle");
        v.man.setPace(Math.max(0.3, v.v));
        if (v.shown) v.man.update(dt);
      }
    }
    for (const m of instanced()) m.instanceMatrix.needsUpdate = true;
  }

  function info() {
    return vehicles.map((v) => {
      at(v.path, v.s, tmp);
      return { route: v.route.name, kind: v.kind, x: +tmp.x.toFixed(1), z: +tmp.z.toFixed(1), state: v.state };
    });
  }

  return { update, colliders: () => colliders, group, info };
}

const hv = new THREE.Vector3();
/** The point between a man's hands (world), or where they would be in the push pose. */
export function handsOf(man: Human | null, group: THREE.Object3D, x: number, z: number, yaw: number): { x: number; z: number; y: number } {
  const L = man?.root.getObjectByName("handL");
  const R = man?.root.getObjectByName("handR");
  if (L && R && group.visible) {
    group.updateMatrixWorld(true);
    L.getWorldPosition(hv);
    let hx = hv.x;
    let hy = hv.y;
    let hz = hv.z;
    R.getWorldPosition(hv);
    hx = (hx + hv.x) / 2;
    hy = (hy + hv.y) / 2;
    hz = (hz + hv.z) / 2;
    // only the reach ahead of the body is taken from the pose (the hands sway; the cart does not)
    const ahead = THREE.MathUtils.clamp((hx - x) * Math.sin(yaw) + (hz - z) * Math.cos(yaw), 0.25, 0.75);
    return { x: x + Math.sin(yaw) * ahead, z: z + Math.cos(yaw) * ahead, y: THREE.MathUtils.clamp(hy, 0.7, 1.1) };
  }
  return { x: x + Math.sin(yaw) * 0.5, z: z + Math.cos(yaw) * 0.5, y: 0.9 };
}
