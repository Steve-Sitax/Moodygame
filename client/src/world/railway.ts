import * as THREE from "three";
import { psx } from "../retro/psx";
import { makeHuman, type Human } from "../game/humans";
import type { Rect } from "./geom";
import type { Props } from "./props3d";
import { HorsePool } from "./horses";
import { Kit, type RGB } from "./kit";
import { smoothLine, type TrackData } from "./tracks";

// The quay railway at work (M3g). A short goods train, drawn by two heavy horses in tandem
// with a shunter at their heads (horses moved the wagons on the quay lines of the 1860s-70s;
// docs/milestones/M3g.md), runs the line of tools/city/design.py DECOR "tracks": out of the
// Werf store, east along the river quays under the portal cranes, over the vliet and canal
// swing bridges and the lock bridge, round the Petit Bassin, and back west into the store.
//
// It stops at some of the portal cranes. The crane swings its jib between a moored ship (or a
// pile on the quay) and a wagon; a sling of sacks, a cask, a bale or a crate hangs on the hook
// and goes into the wagon or out of it, so the wagons fill and empty as you watch. The crane's
// own hook and falls from boats.glb are folded away; the hoist rope, hook block and sling are
// drawn here, so the hook can go down into a hold and up again.
//
// Every axle follows the curve (the body is the chord between its two axles), wheels turn, the
// coupling chains stretch and swing on the bends. The train stops for the player on the line,
// for anything on the rails ahead, and before an opening bridge that is not shut; a bridge does
// not open while the train is on it (bridges.ts `busy`, the lock's `occupied`).
//
// Cheap: every wagon kind, the wheel sets, the chains, each kind of goods, the hooks, the ropes
// and the slings are one InstancedMesh each (about 14 draw calls with the horses); nothing is
// drawn beyond the fog.

type P = [number, number];

export interface CraneSite {
  x: number;
  z: number;
  /** Crane yaw (boats.ts crane(): the jib rests along local +z). */
  yaw: number;
  obj: THREE.Object3D;
}

export interface OpeningLike {
  rect: { minX: number; maxX: number; minZ: number; maxZ: number };
  closed(): boolean;
}

export interface RailwayOptions {
  tracks: TrackData;
  cranes: CraneSite[];
  props: Props;
  /** Textures: planks (wood, iron), sack cloth, crate boards. */
  tex: { planks: THREE.Texture; sack: THREE.Texture; crate: THREE.Texture };
  /** The opening bridges (world/bridges.ts list, the lock bridge included). */
  bridges: () => OpeningLike[];
  /** Is (x, z) free for a body of radius r (walls, water, things, people)? */
  isFree: (x: number, z: number, r: number) => boolean;
  /** Is there a moored hull under (x, z)? (the crane lifts from its hold) */
  hullAt: (x: number, z: number) => boolean;
  /** Piles of goods on the quay come and go: their colliders. */
  addCollider: (r: Rect) => void;
  removeCollider: (r: Rect) => void;
  waterY: number;
  seed?: number;
}

export interface Railway {
  /** Move the train and the cranes; the player's feet (the train stops for him). */
  update(t: number, dt: number, player: { x: number; z: number } | null, camera?: THREE.Camera): void;
  /** Walk colliders of the horses and wagons: stable objects moved in place, add them once. */
  colliders(): Rect[];
  /** Is the train on (or just at) this rectangle? A bridge must not open under it. */
  busy(r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean;
  /** The horse instances (4: two for the train, two for the omnibus). */
  horses: HorsePool;
  /** For the soundscape (setVehicles): the horses as a dray while they walk. */
  vehicles(): Array<{ kind: "dray"; x: number; z: number; state: string }>;
  /** A wheel over a rail joint (soundscape.railClack). */
  onClack?: (x: number, z: number) => void;
  /** A crane starts to hoist or lower (soundscape.craneWork). */
  onCrane?: (x: number, z: number) => void;
  group: THREE.Group;
  /** Dev: state for checks. */
  info(): Record<string, unknown>;
  /** Dev: put the train's head at this distance along the line (0 = in the Werf store). */
  jump(s: number): void;
  /** Dev: the length of the line and the arc position of each crane pass. */
  plan(): { length: number; passes: Array<{ crane: number; s: number; mode: string }> };
}

// ------------------------------------------------------------------ numbers

const R_HOOK = 11.51; // the hook's distance from the slewing axis (build_boats.py portal_jib)
const TIP: [number, number, number] = [0, 8.62, 11.51]; // where the hoist rope leaves the jib head, jib frame
const HOOK_REST = 4.2; // hook height when idle
const TRAVEL = 5.2; // hook height for swinging a load (clears wagon sides and bulwarks)
const SLEW = 0.32; // rad/s at full speed
const HOIST = 1.3; // m/s
const SLING = 0.85; // hook to the top of the load
const CRUISE = 1.35; // m/s: two heavy horses walking with loaded wagons
const CREEP = 0.6; // m/s: shunting up to a crane
const ACCEL = 0.25;
const BRAKE = 0.45;
const JOINT = 9.0; // rail length (m): a clack at every joint
const WHEEL_R = 0.5;
const RAIL_TOP = 0.035;
const FLOOR = 1.12; // wagon floor over the rail
const L_BODY = 5.4;
const L_BUF = 6.3; // over the buffers
const WB = 3.0; // wheelbase
const HORSE_GAP = 3.0;
const TRACES = 3.1; // lead horse's middle to the rear horse's middle is HORSE_GAP; rear horse to the first wagon's buffers

// ------------------------------------------------------------------ the line

class Line {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly length: number;
  static readonly STEP = 0.25;

  constructor(pts: P[]) {
    const xs: number[] = [pts[0][0]];
    const zs: number[] = [pts[0][1]];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      let d = Line.STEP - carry;
      while (d <= L) {
        xs.push(ax + ((bx - ax) * d) / L);
        zs.push(az + ((bz - az) * d) / L);
        d += Line.STEP;
      }
      carry = L - (d - Line.STEP);
    }
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.length = (xs.length - 1) * Line.STEP;
  }

  at(s: number, out: { x: number; z: number }): { x: number; z: number } {
    const u = THREE.MathUtils.clamp(s, 0, this.length) / Line.STEP;
    const i = Math.min(this.x.length - 2, Math.floor(u));
    const f = u - i;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * f;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * f;
    return out;
  }

  yaw(s: number): number {
    const a = this.at(s - 0.6, { x: 0, z: 0 });
    const b = this.at(s + 0.6, { x: 0, z: 0 });
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  /** Arc positions where the line passes within `r` of (x, z): one per pass. */
  passes(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < this.x.length; i++) {
      const d = Math.hypot(this.x[i] - x, this.z[i] - z);
      if (d < r) {
        if (d < bd) {
          bd = d;
          best = i;
        }
      } else if (best >= 0) {
        out.push(best * Line.STEP);
        best = -1;
        bd = Infinity;
      }
    }
    if (best >= 0) out.push(best * Line.STEP);
    return out;
  }
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ------------------------------------------------------------------ models (code-built)

const WOOD: RGB = [0.72, 0.58, 0.47];
const WOOD_DARK: RGB = [0.42, 0.34, 0.28];
const FLOORC: RGB = [0.72, 0.66, 0.56];
const IRON: RGB = [0.2, 0.19, 0.18];
const IRON_LIGHT: RGB = [0.42, 0.4, 0.37];
const RED: RGB = [0.55, 0.22, 0.16];
const ROPE: RGB = [0.55, 0.47, 0.34];

type WagonKind = "open" | "flat" | "van";
type GoodsKind = "sacks" | "casks" | "bales" | "crates";
const GOODS: GoodsKind[] = ["sacks", "casks", "bales", "crates"];
/** Height of one unit of each kind (the sling hangs this far above its floor). */
const UNIT_H: Record<GoodsKind, number> = { sacks: 0.56, casks: 0.74, bales: 0.78, crates: 0.86 };

function underframe(k: Kit): void {
  const e = L_BODY / 2;
  for (const s of [-1, 1]) {
    k.box(0.12, 0.3, L_BODY, s * 1.05, 0.93, 0, IRON);
    // axle guards, springs and axle boxes
    for (const za of [-WB / 2, WB / 2]) {
      k.box(0.07, 0.1, 1.2, s * 1.09, 0.76, za, IRON_LIGHT);
      k.box(0.2, 0.24, 0.26, s * 1.1, RAIL_TOP + WHEEL_R, za, IRON);
      k.box(0.06, 0.5, 0.08, s * 1.09, 0.72, za - 0.22, IRON, 0, 0.25);
      k.box(0.06, 0.5, 0.08, s * 1.09, 0.72, za + 0.22, IRON, 0, -0.25);
    }
  }
  for (const s of [-1, 1]) {
    // buffer beam, buffers, draw hook
    k.box(2.6, 0.32, 0.16, 0, 0.98, s * (e - 0.08), RED);
    for (const bx of [-0.87, 0.87]) {
      k.cyl(0.09, 0.12, 0.34, 6, bx, 1.0, s * (e + 0.17), IRON, Math.PI / 2);
      k.cyl(0.2, 0.2, 0.07, 8, bx, 1.0, s * (e + 0.38), IRON_LIGHT, Math.PI / 2);
    }
    k.box(0.1, 0.12, 0.34, 0, 0.98, s * (e + 0.17), IRON);
  }
  k.box(2.5, 0.08, L_BODY, 0, FLOOR - 0.04, 0, FLOORC);
  // brake blocks and a lever on one side
  k.box(0.06, 0.08, 1.9, -1.2, 0.55, 0, IRON);
}

function wagonGeometry(kind: WagonKind): THREE.BufferGeometry {
  const k = new Kit();
  underframe(k);
  const e = L_BODY / 2;
  if (kind === "open") {
    const h = 0.82;
    const y = FLOOR + h / 2;
    for (const s of [-1, 1]) {
      k.box(0.07, h, L_BODY, s * 1.22, y, 0, WOOD);
      k.box(0.03, h - 0.1, 1.2, s * 1.265, y - 0.02, 0, WOOD_DARK); // the side door
      for (const z of [-2.35, -1.2, 1.2, 2.35]) k.box(0.08, h + 0.02, 0.08, s * 1.28, y, z, IRON);
      k.box(0.1, 0.05, L_BODY + 0.05, s * 1.23, FLOOR + h + 0.02, 0, IRON_LIGHT);
    }
    for (const s of [-1, 1]) k.box(2.5, h, 0.07, 0, y, s * (e - 0.035), WOOD);
  } else if (kind === "flat") {
    for (const s of [-1, 1]) {
      k.box(0.07, 0.14, L_BODY, s * 1.22, FLOOR + 0.07, 0, WOOD);
      for (const z of [-2.3, -0.78, 0.78, 2.3]) k.box(0.08, 0.62, 0.08, s * 1.27, FLOOR + 0.3, z, IRON);
    }
  } else {
    const h = 2.0;
    const y = FLOOR + h / 2;
    for (const s of [-1, 1]) {
      k.box(0.07, h, L_BODY, s * 1.22, y, 0, WOOD);
      k.box(0.04, 1.8, 1.6, s * 1.27, y - 0.04, 0, WOOD_DARK); // sliding door
      k.box(0.05, 0.06, 2.4, s * 1.3, FLOOR + h - 0.05, 0.2, IRON); // door rail
      for (const z of [-2.35, -0.9, 0.9, 2.35]) k.box(0.08, h, 0.08, s * 1.28, y, z, IRON);
      k.box(0.05, 0.08, 2.0, s * 1.28, y, -1.62, IRON, 0, 0.62); // diagonal braces
      k.box(0.05, 0.08, 2.0, s * 1.28, y, 1.62, IRON, 0, -0.62);
    }
    for (const s of [-1, 1]) k.box(2.5, h, 0.07, 0, y, s * (e - 0.035), WOOD);
    // arched roof in slats
    const R = 3.4;
    const top = FLOOR + h + 0.28;
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.075;
      k.box(0.27, 0.05, L_BODY + 0.16, R * Math.sin(a), top - R * (1 - Math.cos(a)), 0, [0.32, 0.31, 0.3], 0, 0, -a);
    }
    for (const s of [-1, 1]) k.box(2.62, 0.2, 0.06, 0, top - 0.12, s * (e + 0.05), WOOD_DARK);
  }
  return k.build();
}

function wheelsetGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.06, 0.06, 1.5, 6, 0, 0, 0, IRON, 0, 0, Math.PI / 2);
  for (const x of [-0.72, 0.72]) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      k.box(0.12, 0.07, 0.27, x, Math.sin(a) * (WHEEL_R - 0.035), Math.cos(a) * (WHEEL_R - 0.035), IRON, 0, -(a + Math.PI / 2));
    }
    for (let i = 0; i < 4; i++) k.box(0.04, WHEEL_R * 1.9, 0.05, x, 0, 0, i % 2 ? IRON : IRON_LIGHT, 0, (i * Math.PI) / 4);
    k.cyl(0.13, 0.13, 0.16, 8, x, 0, 0, IRON_LIGHT, 0, 0, Math.PI / 2);
  }
  return k.build();
}

function unitGeometry(kind: GoodsKind): THREE.BufferGeometry {
  const k = new Kit();
  if (kind === "sacks") {
    const c: RGB = [0.86, 0.8, 0.66];
    k.box(0.5, 0.28, 0.95, -0.25, 0.14, 0, c).box(0.5, 0.28, 0.95, 0.25, 0.14, 0.02, [0.8, 0.75, 0.62], 0.04);
    k.box(0.5, 0.27, 0.92, 0.02, 0.41, 0, [0.9, 0.84, 0.7], 0.1);
  } else if (kind === "casks") {
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      pts.push([0.3 + 0.07 * Math.sin(u * Math.PI), -0.48 + 0.96 * u]);
    }
    pts.unshift([0, -0.48]);
    pts.push([0, 0.48]);
    k.lathe(pts, 10, 0, 0.37, 0, [0.66, 0.48, 0.32], 0, 0, Math.PI / 2);
    for (const x of [-0.36, -0.13, 0.13, 0.36]) k.cyl(0.345 - Math.abs(x) * 0.12, 0.345 - Math.abs(x) * 0.12, 0.04, 10, x, 0.37, 0, IRON, 0, 0, Math.PI / 2);
  } else if (kind === "bales") {
    k.box(0.8, 0.78, 1.0, 0, 0.39, 0, [0.82, 0.77, 0.6]);
    for (const z of [-0.3, 0.02, 0.33]) k.box(0.82, 0.8, 0.04, 0, 0.39, z, [0.36, 0.3, 0.24]);
  } else {
    k.box(0.92, 0.86, 0.92, 0, 0.43, 0, [0.9, 0.84, 0.74]);
  }
  return k.build();
}

function hookGeometry(): THREE.BufferGeometry {
  // origin at the hook's throat, where the sling hangs
  const k = new Kit();
  k.box(0.26, 0.48, 0.34, 0, 0.62, 0, IRON);
  k.cyl(0.13, 0.13, 0.3, 8, 0, 0.62, 0, IRON_LIGHT, 0, 0, Math.PI / 2);
  k.box(0.05, 0.36, 0.05, 0, 0.22, 0, IRON);
  k.box(0.05, 0.05, 0.24, 0, 0.03, 0.1, IRON);
  k.box(0.05, 0.14, 0.05, 0, 0.1, 0.2, IRON);
  return k.build();
}

function slingGeometry(): THREE.BufferGeometry {
  // four ropes from the hook down to the corners of a load whose top is SLING below
  const k = new Kit();
  for (const [x, z] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.38], [0.42, 0.38]]) {
    k.bar(new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, -SLING, z), 0.03, ROPE);
  }
  return k.build();
}

function ropeGeometry(): THREE.BufferGeometry {
  // a unit rope from y 0 down to y -1: scaled in y to the length; two falls
  const k = new Kit();
  k.box(0.03, 1, 0.03, -0.07, -0.5, 0, IRON_LIGHT).box(0.03, 1, 0.03, 0.07, -0.5, 0, IRON_LIGHT);
  return k.build();
}

function linkGeometry(): THREE.BufferGeometry {
  // a coupling chain, 1 m long along z (scaled to the gap), sagging a little
  const k = new Kit();
  for (let i = 0; i < 6; i++) {
    const z = -0.5 + (i + 0.5) / 6;
    const sag = -0.06 * Math.sin(((i + 0.5) / 6) * Math.PI);
    k.box(i % 2 ? 0.02 : 0.06, i % 2 ? 0.06 : 0.02, 0.2, 0, sag, z, IRON);
  }
  return k.build();
}

/**
 * The crane's hook, falls and sling in boats.glb hang at a fixed height: fold them away (the
 * vertices out at the jib head below its underside), so the hook drawn here can go up and down.
 * The jib geometry is shared by every portal crane, so this runs once.
 */
const folded = new WeakSet<THREE.BufferGeometry>();
function foldHook(jib: THREE.Object3D): void {
  jib.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m.isMesh || (o as THREE.LineSegments).isLineSegments) || folded.has(m.geometry)) return;
    folded.add(m.geometry);
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getZ(i) > 10.6 && Math.abs(pos.getX(i)) < 0.65 && pos.getY(i) < 7.9) {
        pos.setXYZ(i, 0, TIP[1] - 0.05, TIP[2] - 0.1);
        n++;
      }
    }
    if (n) {
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
    }
  });
}

// ------------------------------------------------------------------ the train

interface Wagon {
  kind: WagonKind;
  goods: GoodsKind | null;
  /** Slots: 3 rows along (front to back) by 2 across; true = a unit stands there. */
  slots: boolean[];
  /** Distance from the head to the front buffers, along the line. */
  front: number;
  rect: Rect;
  // pose (updated every frame)
  x: number;
  z: number;
  yaw: number;
  axles: [number, number];
}

const ROWS = [1.55, 0, -1.55]; // slot rows along the wagon (from its middle, + toward the front)
const ACROSS = [-0.56, 0.56];

interface Pile {
  x: number;
  z: number;
  /** Tangent of the hook circle there (the pile's rows run along it). */
  tx: number;
  tz: number;
  kind: GoodsKind;
  n: number;
  cap: number;
  rect: Rect;
  added: boolean;
}

type Op =
  | { t: "hoist"; y: number }
  | { t: "slew"; a: number }
  | { t: "wait"; s: number }
  | { t: "gate" }
  | { t: "take"; from: Source }
  | { t: "drop"; to: Source }
  | { t: "done" };

type Source = { kind: "ship" } | { kind: "pile" } | { kind: "wagon"; w: number; slot: number };

interface Crane {
  site: CraneSite;
  jib: THREE.Object3D;
  index: number;
  /** Jib angle in the crane's frame (0 = rest) and the hook's height. */
  a: number;
  hy: number;
  carry: GoodsKind | null;
  ops: Op[];
  opT: number;
  idle: number;
  idleTo: number;
  r: () => number;
  /** Jib angle over a moored hold, or null (then a pile on the quay). */
  shipA: number | null;
  pile: Pile | null;
  goods: GoodsKind;
  passes: number[];
  /** The load bottom's height at the ship. */
  shipY: number;
  hoisting: boolean;
}

interface Stop {
  crane: Crane;
  /** Head position to stand at. */
  head: number;
  wagon: number;
  row: number;
  dir: "in" | "out";
  queued: boolean;
}

export function createRailway(scene: THREE.Scene, opts: RailwayOptions): Railway {
  const group = new THREE.Group();
  group.name = "railway";
  scene.add(group);
  const rnd = rng(opts.seed ?? 1873);

  // --- the line: out of the Werf store (off the map to the west), east along the quays, over
  // the lock bridge, round the Petit Bassin, back along the Rijnkaai and the Werf into the store
  const T = opts.tracks.tracks ?? [];
  const a = T[0] ? smoothLine(T[0]) : [];
  const b = T[1] ? smoothLine(T[1]) : [];
  const WEST = -430;
  const pts: P[] = [[WEST, a[0]?.[1] ?? 4], ...a, ...b, [WEST, b[b.length - 1]?.[1] ?? 4]];
  const line = new Line(pts);
  /** Samples of the line that were free when the railway was made: only those are watched for things in the way. */
  const watch = new Uint8Array(line.x.length);
  for (let i = 0; i < line.x.length; i++) watch[i] = line.x[i] > -316 && opts.isFree(line.x[i], line.z[i], 0.45) ? 1 : 0;

  // --- materials: one per texture, the colour per vertex
  const mat = (map: THREE.Texture) => psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }));
  const woodMat = mat(opts.tex.planks);
  const sackMat = mat(opts.tex.sack);
  const crateMat = mat(opts.tex.crate);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const inst = (g: THREE.BufferGeometry, m: THREE.Material, n: number, name: string) => {
    const im = new THREE.InstancedMesh(g, m, n);
    im.name = name;
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) im.setMatrixAt(i, zero);
    group.add(im);
    return im;
  };

  // --- the train: open wagon (sacks), flat (casks), open (bales), flat (crates), covered van
  const layout: Array<[WagonKind, GoodsKind | null]> = [
    ["open", "sacks"],
    ["flat", "casks"],
    ["open", "bales"],
    ["flat", "crates"],
    ["van", null],
  ];
  const wagons: Wagon[] = layout.map(([kind, goods], i) => ({
    kind,
    goods,
    slots: Array.from({ length: 6 }, () => false),
    front: HORSE_GAP + TRACES + 1.6 + i * (L_BUF + 0.02),
    rect: { minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, top: 2.2 },
    x: 0,
    z: 0,
    yaw: 0,
    axles: [0, 0],
  }));
  const trainLen = wagons[wagons.length - 1].front + L_BUF;
  const fillRandom = () => {
    for (const w of wagons) {
      const rows = w.goods ? Math.floor(rnd() * 3) : 0;
      w.slots.fill(false);
      for (let r = 0; r < rows; r++) w.slots[r * 2] = w.slots[r * 2 + 1] = true;
    }
  };
  fillRandom();
  const kinds: WagonKind[] = ["open", "flat", "van"];
  const bodies = new Map<WagonKind, THREE.InstancedMesh>();
  for (const k of kinds) bodies.set(k, inst(wagonGeometry(k), woodMat, wagons.filter((w) => w.kind === k).length, `wagon_${k}`));
  const wheels = inst(wheelsetGeometry(), woodMat, wagons.length * 2, "wagon_wheels");
  const links = inst(linkGeometry(), woodMat, wagons.length + 1, "wagon_chains");
  const goodsMesh = new Map<GoodsKind, THREE.InstancedMesh>();
  for (const g of GOODS) goodsMesh.set(g, inst(unitGeometry(g), g === "crates" ? crateMat : g === "casks" ? woodMat : sackMat, 48, `goods_${g}`));
  const horses = new HorsePool(scene, opts.props, 4);
  const horseRects: Rect[] = [0, 1].map(() => ({ minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, top: 2.2 }));
  let shunter: Human | null = null;
  const shunterGroup = new THREE.Group();
  group.add(shunterGroup);

  // --- the cranes: take over their jibs
  const cranes: Crane[] = [];
  opts.cranes.forEach((site, i) => {
    const jib = site.obj.getObjectByName("jib");
    if (!jib) return;
    foldHook(jib);
    const passes = line.passes(site.x, site.z, 1.0);
    if (!passes.length) return;
    const c: Crane = {
      site,
      jib,
      index: cranes.length,
      a: 0,
      hy: HOOK_REST,
      carry: null,
      ops: [],
      opT: 0,
      idle: 2 + rnd() * 6,
      idleTo: 0,
      r: rng(i * 7919 + 17),
      shipA: null,
      pile: null,
      goods: GOODS[i % GOODS.length],
      passes,
      shipY: opts.waterY + 0.25,
      hoisting: false,
    };
    // a hold under the hook on the water side, nearest the jib's rest; else a pile on the quay
    const worldA = (ca: number) => site.yaw + ca;
    const hookAt = (ca: number): P => [site.x + Math.sin(worldA(ca)) * R_HOOK, site.z + Math.cos(worldA(ca)) * R_HOOK];
    for (let k = 0; k <= 14 && c.shipA === null; k++) {
      for (const sgn of k ? [1, -1] : [1]) {
        const ca = sgn * k * 0.09;
        const [hx, hz] = hookAt(ca);
        if (opts.hullAt(hx, hz)) {
          c.shipA = ca;
          break;
        }
      }
    }
    if (c.shipA === null) {
      for (let k = 0; k <= 12 && !c.pile; k++) {
        for (const sgn of k ? [1, -1] : [1]) {
          const ca = Math.PI + sgn * k * 0.09;
          const [hx, hz] = hookAt(ca);
          // clear ground for a pile, well off the line
          let ok = opts.isFree(hx, hz, 1.4);
          for (let j = 0; ok && j < line.x.length; j += 8) if (Math.hypot(line.x[j] - hx, line.z[j] - hz) < 3.2) ok = false;
          if (!ok) continue;
          const tx = Math.cos(worldA(ca));
          const tz = -Math.sin(worldA(ca));
          const n = 1 + Math.floor(rnd() * 3);
          c.pile = {
            x: hx,
            z: hz,
            tx,
            tz,
            kind: c.goods,
            n,
            cap: 4,
            rect: { minX: hx - 1.1, maxX: hx + 1.1, minZ: hz - 1.1, maxZ: hz + 1.1, top: 1.6 },
            added: false,
          };
          c.a = ca;
          break;
        }
      }
    } else c.a = c.shipA;
    if (c.shipA === null && !c.pile) return;
    cranes.push(c);
  });
  const pileOn = (p: Pile) => {
    const want = p.n > 0;
    if (want && !p.added) opts.addCollider(p.rect);
    if (!want && p.added) opts.removeCollider(p.rect);
    p.added = want;
  };
  for (const c of cranes) if (c.pile) pileOn(c.pile);
  const hooks = inst(hookGeometry(), woodMat, cranes.length, "crane_hooks");
  const ropes = inst(ropeGeometry(), woodMat, cranes.length, "crane_ropes");
  const slings = inst(slingGeometry(), woodMat, cranes.length, "crane_slings");

  // --- where the wagons stand for a head position
  const pa = { x: 0, z: 0 };
  const pb = { x: 0, z: 0 };
  function wagonAt(w: Wagon, head: number, out: { x: number; z: number; yaw: number }): { x: number; z: number; yaw: number } {
    const mid = head - w.front - L_BUF / 2;
    line.at(mid + WB / 2, pa);
    line.at(mid - WB / 2, pb);
    out.x = (pa.x + pb.x) / 2;
    out.z = (pa.z + pb.z) / 2;
    out.yaw = Math.atan2(pa.x - pb.x, pa.z - pb.z);
    return out;
  }
  function slotAt(w: Wagon, slot: number, head: number): { x: number; z: number; y: number } {
    const p = wagonAt(w, head, { x: 0, z: 0, yaw: 0 });
    const along = ROWS[Math.floor(slot / 2)];
    const across = ACROSS[slot % 2];
    const s = Math.sin(p.yaw);
    const c = Math.cos(p.yaw);
    return { x: p.x + s * along + c * across, z: p.z + c * along - s * across, y: FLOOR };
  }
  function pileSlot(p: Pile, i: number): { x: number; z: number; y: number } {
    const across = i % 2 ? 0.58 : -0.58;
    const layer = Math.floor(i / 2);
    return { x: p.x + p.tx * across, z: p.z + p.tz * across, y: layer * UNIT_H[p.kind] };
  }
  /** Jib angle (crane frame) that puts the hook over (x, z). */
  const angleTo = (c: Crane, x: number, z: number) => angDiff(Math.atan2(x - c.site.x, z - c.site.z), c.site.yaw);

  // --- the stops for this trip: some cranes, each on one of its passes
  let stops: Stop[] = [];
  function planTrip(): void {
    stops = [];
    for (const c of cranes) {
      if (rnd() < 0.3) continue;
      const pass = c.passes[Math.floor(rnd() * c.passes.length)];
      const w = wagons.findIndex((x) => x.goods === c.goods);
      if (w < 0) continue;
      stops.push({ crane: c, head: pass, wagon: w, row: 0, dir: "in", queued: false });
    }
    stops.sort((p, q) => p.head - q.head);
  }

  /** Work out where to stand and what to do, as the train comes up to a crane. */
  function prepare(st: Stop): boolean {
    const c = st.crane;
    const w = wagons[st.wagon];
    const full = [0, 1, 2].filter((r) => w.slots[r * 2] && w.slots[r * 2 + 1]);
    const empty = [0, 1, 2].filter((r) => !w.slots[r * 2] && !w.slots[r * 2 + 1]);
    if (c.shipA !== null) {
      // a ship: fill the wagon from the hold, or load the ship from a well-filled wagon
      st.dir = full.length >= 2 || (full.length === 1 && rnd() < 0.4) || !empty.length ? "out" : "in";
    } else {
      const p = c.pile!;
      if (empty.length && p.n >= 2 && (rnd() < 0.5 || !full.length)) st.dir = "in";
      else if (full.length && p.n <= p.cap - 2) st.dir = "out";
      else return false;
    }
    const rows = st.dir === "in" ? empty : full;
    if (!rows.length) return false;
    st.row = rows[Math.floor(rnd() * rows.length)];
    // the row's middle on the hook's circle, before or after the crane, where the line is straight
    const pass = st.head;
    const off = w.front + L_BUF / 2 - ROWS[st.row];
    const cand: number[] = [];
    for (const sgn of [-1, 1]) {
      let lo = sgn < 0 ? pass - R_HOOK - 6 : pass;
      let hi = sgn < 0 ? pass : pass + R_HOOK + 6;
      const d = (s: number) => Math.hypot(line.at(s, pa).x - c.site.x, pa.z - c.site.z) - R_HOOK;
      if (Math.sign(d(lo)) === Math.sign(d(hi))) continue;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (Math.sign(d(m)) === Math.sign(d(lo))) lo = m;
        else hi = m;
      }
      const s = (lo + hi) / 2;
      if (Math.abs(angDiff(line.yaw(s + 3.5), line.yaw(s - 3.5))) > 0.04) continue;
      cand.push(s + off);
    }
    const ok = cand.filter((h) => h > head + 4);
    if (!ok.length) return false;
    st.head = ok[Math.floor(rnd() * ok.length)];
    return true;
  }

  function queue(st: Stop): void {
    const c = st.crane;
    const w = wagons[st.wagon];
    const unit = UNIT_H[w.goods!];
    const hookFor = (bottom: number) => bottom + unit + SLING;
    const ops: Op[] = [];
    for (const k of [0, 1]) {
      const slot = st.row * 2 + k;
      const at = slotAt(w, slot, st.head);
      const wagonA = angleTo(c, at.x, at.z);
      const src: Source = c.shipA !== null ? { kind: "ship" } : { kind: "pile" };
      const srcA = c.shipA ?? angleTo(c, c.pile!.x, c.pile!.z);
      const srcY = c.shipA !== null ? c.shipY : c.pile ? pileSlot(c.pile, Math.max(0, c.pile.n - 1 - k)).y : 0;
      const dstY = c.pile ? pileSlot(c.pile, Math.min(c.pile.cap - 1, c.pile.n + k)).y : c.shipY;
      if (st.dir === "in") {
        ops.push({ t: "hoist", y: TRAVEL }, { t: "slew", a: srcA }, { t: "hoist", y: hookFor(srcY) });
        ops.push({ t: "wait", s: 1.6 }, { t: "take", from: src }, { t: "hoist", y: TRAVEL }, { t: "slew", a: wagonA }, { t: "gate" });
        ops.push({ t: "hoist", y: hookFor(FLOOR) }, { t: "wait", s: 1.2 }, { t: "drop", to: { kind: "wagon", w: st.wagon, slot } });
      } else {
        ops.push({ t: "hoist", y: TRAVEL }, { t: "slew", a: wagonA }, { t: "gate" }, { t: "hoist", y: hookFor(FLOOR) });
        ops.push({ t: "wait", s: 1.6 }, { t: "take", from: { kind: "wagon", w: st.wagon, slot } }, { t: "hoist", y: TRAVEL }, { t: "slew", a: srcA });
        ops.push({ t: "hoist", y: hookFor(dstY) }, { t: "wait", s: 1.2 }, { t: "drop", to: src });
      }
    }
    ops.push({ t: "hoist", y: TRAVEL }, { t: "done" });
    c.ops = ops;
    c.opT = 0;
    st.queued = true;
  }

  /** A stop the train will not make after all (dev jumps): the crane lets go and goes idle. */
  function abandon(st: Stop): void {
    if (!st.queued) return;
    st.crane.ops = [{ t: "hoist", y: TRAVEL }];
    st.crane.carry = null;
    if (working === st) working = null;
  }

  // --- state
  let head = 0;
  let v = 0;
  let state: "shed" | "run" | "work" = "shed";
  let shedT = 4 + rnd() * 10;
  let stopI = 0;
  let working: Stop | null = null;
  let waitWhy = "";
  let roll = 0;
  let gait = 0;
  const axleS: number[] = wagons.flatMap(() => [0, 0]);

  function startTrip(): void {
    head = 0;
    v = 0;
    stopI = 0;
    working = null;
    planTrip();
    state = "run";
  }

  /** How far the head may go now: before the next stop, an open bridge, the player, something on the rails. */
  function limit(player: { x: number; z: number } | null): number {
    let lim = line.length + 50;
    waitWhy = "";
    // the next crane stop
    while (stopI < stops.length) {
      const st = stops[stopI];
      if (!st.queued) {
        if (st.head - head > 70) break;
        if (!prepare(st)) {
          stopI++;
          continue;
        }
        queue(st);
      }
      if (st.head < head - 0.5) {
        abandon(st);
        stopI++;
        continue;
      }
      lim = Math.min(lim, st.head);
      break;
    }
    // an opening bridge ahead that is not shut
    for (const br of opts.bridges()) {
      const sp = spanOf(br.rect);
      if (!sp) continue;
      for (const [s0] of sp) {
        // 8 m short: an open swing bridge lies on the quay beside its pit, over the rails
        if (s0 > head - 0.5 && s0 - head < 40 && !br.closed()) {
          if (s0 - 8 < lim) {
            lim = Math.max(head, s0 - 8);
            waitWhy = "bridge";
          }
        }
      }
    }
    // the player on the line ahead or at the horses' heads; things on the rails
    for (let d = -1; d <= 7; d += 0.5) {
      line.at(head + d, pa);
      if (player && Math.hypot(player.x - pa.x, player.z - pa.z) < 1.75) {
        if (head + d - 7.5 < lim) {
          lim = Math.max(head, head + d - 7.5);
          waitWhy = "player";
        }
        break;
      }
    }
    // (the train's own boxes out of the way meanwhile: turned on a bend, they reach ahead)
    const own = [...horseRects, ...wagons.map((w) => w.rect)];
    const keep = own.map((r) => [r.minX, r.maxX]);
    for (const r of own) r.minX = r.maxX = 1e6;
    for (const d of [1.5, 3, 4.5]) {
      const i = Math.round((head + d) / Line.STEP);
      if (i < 0 || i >= line.x.length || !watch[i]) continue;
      if (!opts.isFree(line.x[i], line.z[i], 0.45)) {
        if (head + d - 3 < lim) {
          lim = Math.max(head, head + d - 3);
          waitWhy = "blocked";
        }
        break;
      }
    }
    own.forEach((r, k) => ([r.minX, r.maxX] = keep[k]));
    return lim;
  }

  const spans = new Map<object, Array<[number, number]>>();
  function spanOf(r: { minX: number; maxX: number; minZ: number; maxZ: number }): Array<[number, number]> {
    let sp = spans.get(r);
    if (sp) return sp;
    sp = [];
    let s0 = -1;
    for (let i = 0; i < line.x.length; i++) {
      const inside = line.x[i] > r.minX - 0.5 && line.x[i] < r.maxX + 0.5 && line.z[i] > r.minZ - 0.5 && line.z[i] < r.maxZ + 0.5;
      if (inside && s0 < 0) s0 = i * Line.STEP;
      if (!inside && s0 >= 0) {
        sp.push([s0, i * Line.STEP]);
        s0 = -1;
      }
    }
    spans.set(r, sp);
    return sp;
  }

  // --- cranes at work
  const hookWorld = (c: Crane, out: THREE.Vector3) => {
    const wa = c.site.yaw + c.a;
    return out.set(c.site.x + Math.sin(wa) * R_HOOK, c.hy, c.site.z + Math.cos(wa) * R_HOOK);
  };
  function updateCrane(c: Crane, dt: number, trainStopped: boolean): void {
    const op = c.ops[0];
    if (!op) {
      // idle: now and then a slow swing about its rest over the water (or the pile)
      c.idle -= dt;
      if (c.idle <= 0) {
        const home = c.shipA ?? angleTo(c, c.pile!.x, c.pile!.z);
        c.idleTo = home + (c.r() * 2 - 1) * 0.5;
        c.idle = 10 + c.r() * 20;
      }
      const d = angDiff(c.idleTo, c.a);
      c.a += Math.sign(d) * Math.min(Math.abs(d), SLEW * 0.5 * dt * THREE.MathUtils.clamp(Math.abs(d) / 0.3, 0.2, 1));
      c.hy += (HOOK_REST - c.hy) * Math.min(1, dt * 0.5);
      return;
    }
    switch (op.t) {
      case "hoist": {
        const d = op.y - c.hy;
        if (!c.hoisting && Math.abs(d) > 0.5) {
          c.hoisting = true;
          api.onCrane?.(c.site.x, c.site.z);
        }
        const ease = THREE.MathUtils.clamp(Math.abs(d) / 0.6, 0.25, 1);
        c.hy += Math.sign(d) * Math.min(Math.abs(d), HOIST * ease * dt);
        if (Math.abs(d) < 0.005) {
          c.hy = op.y;
          c.hoisting = false;
          c.ops.shift();
        }
        break;
      }
      case "slew": {
        const d = angDiff(op.a, c.a);
        const ease = THREE.MathUtils.clamp(Math.abs(d) / 0.35, 0.18, 1);
        c.a += Math.sign(d) * Math.min(Math.abs(d), SLEW * ease * dt);
        if (Math.abs(d) < 0.002) {
          c.a = op.a;
          c.ops.shift();
        }
        break;
      }
      case "wait":
        c.opT += dt;
        if (c.opT >= op.s) {
          c.opT = 0;
          c.ops.shift();
        }
        break;
      case "gate":
        if (trainStopped) c.ops.shift();
        break;
      case "take": {
        const f = op.from;
        if (f.kind === "wagon") wagons[f.w].slots[f.slot] = false;
        if (f.kind === "pile" && c.pile) {
          c.pile.n = Math.max(0, c.pile.n - 1);
          pileOn(c.pile);
        }
        c.carry = f.kind === "wagon" ? wagons[f.w].goods : c.goods;
        c.ops.shift();
        break;
      }
      case "drop": {
        const to = op.to;
        if (to.kind === "wagon") wagons[to.w].slots[to.slot] = true;
        if (to.kind === "pile" && c.pile) {
          c.pile.n = Math.min(c.pile.cap, c.pile.n + 1);
          pileOn(c.pile);
        }
        c.carry = null;
        c.ops.shift();
        break;
      }
      case "done":
        c.ops.shift();
        if (working?.crane === c) {
          working = null;
          stopI++;
          state = "run";
        }
        break;
    }
  }

  // --- drawing
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const V = new THREE.Vector3();
  const S = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const hk = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  const put = (m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, pitch = 0, sx = 1, sy = 1, sz = 1) => {
    E.set(pitch, yaw, 0, "YXZ");
    Q.setFromEuler(E);
    M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz));
    m.setMatrixAt(i, M);
  };
  const linkBetween = (i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const d = V.set(bx - ax, by - ay, bz - az);
    const len = Math.max(0.05, d.length());
    Q.setFromUnitVectors(Z, d.normalize());
    M.compose(V.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), Q, S.set(1, 1, len));
    links.setMatrixAt(i, M);
  };
  const gcount = new Map<GoodsKind, number>();
  const unit = (g: GoodsKind, x: number, y: number, z: number, yaw: number) => {
    const m = goodsMesh.get(g)!;
    const n = gcount.get(g) ?? 0;
    if (n >= m.instanceMatrix.count) return;
    put(m, n, x, y, z, yaw);
    gcount.set(g, n + 1);
  };

  let near = true;
  function draw(camera?: THREE.Camera): void {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 40) + 25;
    const cam = camera?.position;
    const hidden = state === "shed";
    const wp = { x: 0, z: 0, yaw: 0 };
    line.at(head, pa);
    line.at(head - trainLen, pb);
    near = !hidden && (!cam || Math.min(Math.hypot(pa.x - cam.x, pa.z - cam.z), Math.hypot(pb.x - cam.x, pb.z - cam.z), Math.hypot((pa.x + pb.x) / 2 - cam.x, (pa.z + pb.z) / 2 - cam.z)) < far + trainLen / 2);
    horses.show("train", near);
    shunterGroup.visible = near;
    for (const g of GOODS) gcount.set(g, 0);

    // wagons, wheels, chains, their goods
    const idx = new Map<WagonKind, number>();
    let prevRear: [number, number, number] | null = null;
    wagons.forEach((w, i) => {
      wagonAt(w, head, wp);
      w.x = wp.x;
      w.z = wp.z;
      w.yaw = wp.yaw;
      const k = idx.get(w.kind) ?? 0;
      idx.set(w.kind, k + 1);
      const body = bodies.get(w.kind)!;
      if (!near) {
        body.setMatrixAt(k, zero);
        wheels.setMatrixAt(i * 2, zero);
        wheels.setMatrixAt(i * 2 + 1, zero);
        return;
      }
      put(body, k, wp.x, 0, wp.z, wp.yaw);
      const mid = head - w.front - L_BUF / 2;
      for (const [j, o] of [[0, WB / 2], [1, -WB / 2]] as const) {
        line.at(mid + o, pa);
        put(wheels, i * 2 + j, pa.x, RAIL_TOP + WHEEL_R, pa.z, wp.yaw, roll);
      }
      const s = Math.sin(wp.yaw);
      const c = Math.cos(wp.yaw);
      const e = L_BODY / 2 + 0.3;
      const front: [number, number, number] = [wp.x + s * e, 0.98, wp.z + c * e];
      if (prevRear) linkBetween(i, prevRear[0], prevRear[1], prevRear[2], front[0], front[1], front[2]);
      else {
        // traces from the rear horse's collar to the first wagon's hook
        const hs = head - 1.6 - HORSE_GAP;
        line.at(hs - 0.9, pa);
        linkBetween(i, pa.x, 1.25, pa.z, front[0], front[1], front[2]);
      }
      prevRear = [wp.x - s * e, 0.98, wp.z - c * e];
      if (w.goods) {
        for (let sl = 0; sl < 6; sl++) {
          if (!w.slots[sl]) continue;
          const along = ROWS[Math.floor(sl / 2)];
          const across = ACROSS[sl % 2];
          unit(w.goods, wp.x + s * along + c * across, FLOOR, wp.z + c * along - s * across, wp.yaw + (w.goods === "casks" ? Math.PI / 2 : 0));
        }
      }
    });
    if (!near) for (let i = 0; i < links.count; i++) links.setMatrixAt(i, zero);

    // the cranes: hooks, ropes, slings and loads; the piles on the quay
    cranes.forEach((c, i) => {
      c.jib.rotation.y = c.a;
      hookWorld(c, hk);
      c.jib.updateWorldMatrix(true, false);
      tip.set(TIP[0], TIP[1], TIP[2]).applyMatrix4(c.jib.matrixWorld);
      const wa = c.site.yaw + c.a;
      const len = Math.max(0.1, tip.y - (hk.y + 0.86));
      put(ropes, i, tip.x, tip.y, tip.z, wa, 0, 1, len, 1);
      put(hooks, i, hk.x, hk.y, hk.z, wa);
      if (c.carry) {
        put(slings, i, hk.x, hk.y, hk.z, wa);
        unit(c.carry, hk.x, hk.y - SLING - UNIT_H[c.carry], hk.z, wa + (c.carry === "casks" ? Math.PI / 2 : 0));
      } else slings.setMatrixAt(i, zero);
      if (c.pile) {
        const p = c.pile;
        const yaw = Math.atan2(p.tx, p.tz) + Math.PI / 2;
        for (let k = 0; k < p.n; k++) {
          const q = pileSlot(p, k);
          unit(p.kind, q.x, q.y, q.z, yaw + (p.kind === "casks" ? Math.PI / 2 : 0));
        }
      }
    });
    for (const [g, m] of goodsMesh) {
      m.count = gcount.get(g) ?? 0;
      m.instanceMatrix.needsUpdate = true;
    }
    for (const m of [...bodies.values(), wheels, links, hooks, ropes, slings]) m.instanceMatrix.needsUpdate = true;
  }

  // --- per frame
  const api: Railway = {
    update(_t, dt, player, camera) {
      dt = Math.min(dt, 0.1);
      if (state === "shed") {
        shedT -= dt;
        if (shedT <= 0) startTrip();
      }
      let stopped = false;
      if (state !== "shed") {
        const lim = limit(player);
        const room = lim - head;
        const creep = working || (stopI < stops.length && stops[stopI].head - head < 8) ? CREEP : CRUISE;
        const want = room <= 0.01 ? 0 : Math.min(creep, Math.sqrt(2 * BRAKE * Math.max(0, room)));
        v += THREE.MathUtils.clamp(want - v, -BRAKE * 2 * dt, ACCEL * dt);
        if (v < 0.005 && want === 0) v = 0;
        const ds = Math.min(v * dt, Math.max(0, room));
        head += ds;
        roll += ds / WHEEL_R;
        gait = (gait + (v / 1.35) * dt * 0.95) % 1;
        stopped = v < 0.02;
        // at a crane stop: stand while it works
        const st = stops[stopI];
        if (state === "run" && st && st.queued && Math.abs(st.head - head) < 0.08 && stopped) {
          state = "work";
          working = st;
        }
        // rail joints under the wheels
        wagons.forEach((w, i) => {
          const mid = head - w.front - L_BUF / 2;
          for (const [j, o] of [[0, WB / 2], [1, -WB / 2]] as const) {
            const s = mid + o;
            const k = i * 2 + j;
            if (Math.floor(s / JOINT) !== Math.floor(axleS[k] / JOINT) && s > axleS[k] && ds > 0) {
              line.at(s, pa);
              if (pa.x > -345) api.onClack?.(pa.x, pa.z);
            }
            axleS[k] = s;
          }
        });
        // off the line's end: back into the store; a new trip after a while
        if (head - trainLen > line.length - 60) {
          state = "shed";
          shedT = 30 + rnd() * 60;
          fillRandom();
        }
      }
      for (const c of cranes) updateCrane(c, dt, state === "work" && stopped && working?.crane === c);

      // horses and the shunter
      const amp = Math.min(1, v / 0.8);
      for (let i = 0; i < 2; i++) {
        const s = head - 1.6 - i * HORSE_GAP;
        line.at(s, pa);
        const yaw = line.yaw(s);
        const r = horseRects[i];
        if (state === "shed") {
          horses.hide(i);
          r.minX = r.maxX = r.minZ = r.maxZ = 1e6;
          continue;
        }
        horses.set(i, pa.x, pa.z, yaw, (gait + i * 0.37) % 1, amp);
        const hs = Math.abs(Math.sin(yaw));
        const hc = Math.abs(Math.cos(yaw));
        r.minX = pa.x - hs * 1.5 - hc * 0.45;
        r.maxX = pa.x + hs * 1.5 + hc * 0.45;
        r.minZ = pa.z - hc * 1.5 - hs * 0.45;
        r.maxZ = pa.z + hc * 1.5 + hs * 0.45;
      }
      horses.commit();
      if (!shunter) {
        shunter = makeHuman("carter");
        if (shunter) shunterGroup.add(shunter.root);
      }
      if (shunter) {
        const s = head - 1.2;
        line.at(s, pa);
        const yaw = line.yaw(s);
        shunterGroup.position.set(pa.x - Math.cos(yaw) * 1.25, 0, pa.z + Math.sin(yaw) * 1.25);
        shunterGroup.rotation.y = working ? yaw + 1.2 : yaw;
        shunter.play(v > 0.08 ? "walk" : "idle");
        shunter.setPace(Math.max(0.3, v));
        if (near) shunter.update(dt);
      }
      // colliders of the wagons
      for (const w of wagons) {
        const r = w.rect;
        if (state === "shed") {
          r.minX = r.maxX = r.minZ = r.maxZ = 1e6;
          continue;
        }
        const p = wagonAt(w, head, { x: 0, z: 0, yaw: 0 });
        const hs = Math.abs(Math.sin(p.yaw));
        const hc = Math.abs(Math.cos(p.yaw));
        const hl = L_BUF / 2 - 0.1;
        const hw = 1.32;
        r.minX = p.x - hs * hl - hc * hw;
        r.maxX = p.x + hs * hl + hc * hw;
        r.minZ = p.z - hc * hl - hs * hw;
        r.maxZ = p.z + hc * hl + hs * hw;
      }
      draw(camera);
    },
    colliders: () => [...horseRects, ...wagons.map((w) => w.rect)],
    busy(r) {
      if (state === "shed") return false;
      for (const [s0, s1] of spanOf(r)) if (head + 10 > s0 - 1 && head - trainLen < s1 + 1) return true;
      return false;
    },
    horses,
    vehicles() {
      if (state === "shed" || !near) return [];
      line.at(head - 3, pa);
      return [{ kind: "dray" as const, x: pa.x, z: pa.z, state: v > 0.1 ? "go" : "wait" }];
    },
    group,
    info() {
      line.at(head, pa);
      return {
        state,
        head: +head.toFixed(1),
        at: [+pa.x.toFixed(1), +pa.z.toFixed(1)],
        v: +v.toFixed(2),
        wait: waitWhy,
        length: +line.length.toFixed(0),
        stops: stops.map((s, i) => ({ crane: s.crane.index, at: [s.crane.site.x, s.crane.site.z], head: +s.head.toFixed(1), dir: s.dir, row: s.row, wagon: s.wagon, queued: s.queued, next: i === stopI })),
        working: working ? working.crane.index : null,
        bridges: opts.bridges().map((b) => ({ x: (b.rect.minX + b.rect.maxX) / 2, shut: b.closed(), busy: api.busy(b.rect) })),
        wagons: wagons.map((w) => ({ kind: w.kind, goods: w.goods, slots: w.slots.map((x) => (x ? 1 : 0)).join("") })),
        cranes: cranes.map((c) => ({ at: [c.site.x, c.site.z], goods: c.goods, mode: c.shipA !== null ? "ship" : "quay", a: +c.a.toFixed(2), hy: +c.hy.toFixed(2), carry: c.carry, ops: c.ops.length, pile: c.pile ? [+c.pile.x.toFixed(1), +c.pile.z.toFixed(1), c.pile.n] : null })),
      };
    },
    jump(s) {
      if (state === "shed") startTrip();
      head = s;
      v = 0;
      if (working) {
        abandon(working);
        state = "run";
      }
      while (stopI < stops.length && stops[stopI].head < head - 0.5) abandon(stops[stopI++]);
      for (let k = 0; k < axleS.length; k++) axleS[k] = head;
    },
    plan() {
      return { length: line.length, passes: cranes.flatMap((c) => c.passes.map((s) => ({ crane: c.index, s, mode: c.shipA !== null ? "ship" : "quay" }))) };
    },
  };
  return api;
}
