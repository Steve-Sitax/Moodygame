import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { makeHuman, type Human } from "../game/humans";
import { glowTexture } from "./textures";
import type { Rect } from "./geom";
import type { HorsePool } from "./horses";
import { Kit, type RGB } from "./kit";
import type { OpeningLike } from "./railway";

// The horse omnibuses (M3g). Autumn 1873 had no tram on the river quays yet (Antwerp's first
// horse tram ran from 25 May 1873, Meir to Berchem; the harbour tramways came from 1881), but
// omnibuses had run between the harbour and the town since the 1830s (docs/milestones/M3g.md).
// Pair-horse omnibuses with a driver on the box and a conductor on the back platform, on the
// cobbles, no rails. Two lines, each with its colour and its destination board:
//
//   KAAIEN (green, one omnibus): the Werf -> the Steenplein -> the Vismarkt -> the Rijnkaai ->
//     the Petit Bassin -> back along the Rijnkaai -> the Vismarkt -> the Steenplein -> round
//     behind the Werf.
//   GROTE MARKT (red, two omnibuses): the Vismarkt -> the Vleeshuis -> the Grote Markt (by the
//     town hall) -> the Cathedral (the Handschoenmarkt; the square before the west portal kept
//     free) -> the road to the Meir -> the Brouwersvliet (the canal quay) -> the Vismarkt.
//
// The lines meet at the Vismarkt (two bays, a short walk apart): a change there is free (the
// server, server/src/ride.ts). The town line is a one-way ring with no crossings: in the wide
// streets it keeps to its own lane each way, so two omnibuses never meet head-on; one that
// catches up waits behind the other, at a stop too. Each stop post carries a plate in the
// colour of every line that calls there. Two carriage lamps, lit after dusk.
//
// It stops at every stop for a few seconds, longer while someone gets on or off (game/ride.ts:
// E at the back platform). It stops for the player in its way, for people and anything on its
// lane, and before an opening bridge that is not shut.
//
// Cheap: all omnibuses share one InstancedMesh per part (body, paint, wheels, front carriage),
// one mesh for all the boards, one for the lamp glass, one point set for the lamp glow, one for
// the stop posts: nine draw calls for every omnibus, plus the driver and conductor near you.

type P = [number, number];

export interface LineDef {
  id: string;
  /** What the destination board says (a name: Dutch is fine). */
  board: string;
  /** The side boards: the line's stops. */
  sideBoard: string;
  /** In plain English, for the notes. */
  name: string;
  /** Paint (0..1). */
  colour: RGB;
  /** Corner points of the round, in the way it runs (rounded with a 5 m radius). */
  route: P[];
  buses: number;
}

/** The round along the quays. Checked on the walk map: all open ground. */
const QUAY_ROUTE: P[] = [
  [-305, 29.5], [-305, 8.3], [-158, 8.3], [-152, 7.6], [-140, 7.6], [-134, 8.3], [-90, 8.3], [-84, 7.8], [-68, 7.8],
  [-62, 8.3], [66, 8.3], [76, 15], [76, 37], [-54, 37], [-58, 33], [-58, 12], [-62, 8.3], [-234, 8.3], [-234, 29.5],
  // (M3i: the Steen stands on the quay line at x -222..-188 now; the round turns inland past it,
  // over the little fish market south of it)
];

/**
 * The town ring (a one-way loop; the walk map gives at least 2.0 m from the lane's middle to any
 * wall all round, every corner rounded). In the two-way stretches it keeps its own lane: the canal
 * quay (south at x -89.5, north at x -84.5), the wide street west of the Vleeshuis (x -149 and
 * -145), the street into the Handschoenmarkt (west at z 126.2, east at z 129.8).
 */
const TOWN_ROUTE: P[] = [
  [-84.5, 20], [-96, 20], [-96, 38], [-89.5, 45], [-89.5, 114], [-149, 114], [-149, 126.2], [-238, 126.2], [-238, 70],
  [-280, 70], [-280, 129.8], [-145, 129.8], [-145, 208.5], [-84.5, 208.5],
];

export const LINES: LineDef[] = [
  {
    id: "kaaien",
    board: "KAAIEN",
    sideBoard: "WERF  ·  STEENPLEIN  ·  VISMARKT  ·  RIJNKAAI  ·  PETIT BASSIN",
    name: "the quay line",
    colour: [0.4, 0.52, 0.42],
    route: QUAY_ROUTE,
    buses: 1,
  },
  {
    id: "markt",
    board: "GROTE MARKT",
    sideBoard: "VISMARKT  ·  VLEESHUIS  ·  GROTE MARKT  ·  KATHEDRAAL  ·  MEIR",
    name: "the Grote Markt line",
    colour: [0.62, 0.26, 0.2],
    route: TOWN_ROUTE,
    buses: 2,
  },
];

export interface OmnibusStop {
  /** The stop (the server's name for it, server/src/ride.ts). Lines that meet share it. */
  id: string;
  name: string;
  /** The line this bay is for. */
  line: string;
  x: number;
  z: number;
  /** Where the post stands. */
  post: P;
}

/** The stop bays, one per line and stop. */
export const STOPS: OmnibusStop[] = [
  { id: "werf", name: "the Werf", line: "kaaien", x: -270, z: 8.3, post: [-270, 10.4] },
  { id: "steenplein", name: "the Steenplein", line: "kaaien", x: -180, z: 8.3, post: [-180, 10.4] },
  { id: "vismarkt", name: "the Vismarkt", line: "kaaien", x: -112, z: 8.3, post: [-112, 10.4] },
  { id: "rijnkaai", name: "the Rijnkaai", line: "kaaien", x: 30, z: 8.3, post: [30, 10.4] },
  { id: "bassin", name: "the Petit Bassin", line: "kaaien", x: 76, z: 31, post: [78.3, 31] },
  { id: "rijnkaai_back", name: "the Rijnkaai", line: "kaaien", x: 0, z: 37, post: [0, 39.3] },
  { id: "vismarkt", name: "the Vismarkt", line: "markt", x: -96, z: 31, post: [-98.3, 31] },
  { id: "vleeshuis", name: "the Vleeshuis", line: "markt", x: -118, z: 114, post: [-118, 111.6] },
  { id: "grote_markt", name: "the Grote Markt", line: "markt", x: -257, z: 70, post: [-257, 67.6] },
  { id: "cathedral", name: "the Cathedral", line: "markt", x: -248, z: 129.8, post: [-248, 132.3] },
  { id: "meir", name: "the road to the Meir", line: "markt", x: -145, z: 198, post: [-141.6, 198] },
  { id: "brouwersvliet", name: "the Brouwersvliet", line: "markt", x: -84.5, z: 180, post: [-87, 176] },
];

/** Boxes along every omnibus lane, for props, pumps and troughs to keep off them (rijnkaai.ts). */
export function omnibusKeepOut(): Rect[] {
  const out: Rect[] = [];
  for (const line of LINES) {
    const loop = new Loop(line.route, 5);
    for (let i = 0; i < loop.x.length; i += 8) {
      const x = loop.x[i];
      const z = loop.z[i];
      out.push({ minX: x - 1.9, maxX: x + 1.9, minZ: z - 1.9, maxZ: z + 1.9 });
    }
  }
  return out;
}

const CRUISE = 3.2; // m/s: a brisk trot (11 km/h)
const LAT = 1.0; // m/s2 sideways on the bends
const ACCEL = 0.7;
const BRAKE = 1.2;
const DWELL = 7; // s at a stop
const WHEELBASE = 2.9; // rear axle to the front axle's pivot
const HORSES = 3.1; // front pivot to the middle of the horses
const R_REAR = 0.62;
const R_FRONT = 0.46;
const NOSE = WHEELBASE + HORSES + 1.7; // the horses' noses, ahead of the rear axle
const TAIL = -2.3;

/** One omnibus. */
export interface Omnibus {
  readonly line: LineDef;
  readonly index: number;
  /** The stop it stands at now (dwelling), or null. */
  atStop(): OmnibusStop | null;
  /** The next stop ahead. */
  nextStop(): OmnibusStop;
  /** Hold at the stop while someone gets on or off. */
  hold(on: boolean): void;
  /** Someone rides: it no longer waits for "the player in the way". */
  rider: boolean;
  /** Where a rider stands on the back platform (feet), the way the omnibus points, its speed. */
  platform(): { x: number; y: number; z: number; yaw: number; speed: number };
  /** The foot of the step behind the platform (world), and the way out (yaw). */
  stepDown(): { x: number; z: number; yaw: number };
  info(): Record<string, unknown>;
}

/** All the omnibuses. */
export interface Omnibuses {
  buses: Omnibus[];
  update(t: number, dt: number, player: { x: number; z: number } | null, camera?: THREE.Camera): void;
  colliders(): Rect[];
  busy(r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean;
  onArrive?: (bus: Omnibus, stop: OmnibusStop) => void;
  onDepart?: (bus: Omnibus, stop: OmnibusStop, next: OmnibusStop) => void;
  /** People walking about (the crowd, the town): an omnibus waits for anyone in its lane ahead. Set by main. */
  people?: () => Iterable<{ x: number; z: number }>;
  /** For the soundscape (setVehicles): hooves and wheels while they roll. */
  vehicles(): Array<{ kind: "dray"; x: number; z: number; state: string }>;
  /** The lines that call at a stop. */
  linesAt(stop: string): LineDef[];
  group: THREE.Group;
  info(): Record<string, unknown>;
  /** Dev: put omnibus i just before a stop of its line. */
  jumpTo(i: number, stop: string, before?: number): void;
}

export interface OmnibusOptions {
  horses: HorsePool;
  /** First of the horse instances to use (two per omnibus). */
  horseIndex: number;
  tex: { planks: THREE.Texture };
  bridges: () => OpeningLike[];
  isFree: (x: number, z: number, r: number) => boolean;
  /** How far the gas lamps are lit, 0..1 (the carriage lamps follow). */
  lit?: () => number;
}

/** How many horses the omnibuses need (railway.ts makes the pool). */
export const OMNIBUS_HORSES = LINES.reduce((n, l) => n + l.buses * 2, 0);

// ------------------------------------------------------------------ the path

class Loop {
  readonly x: Float32Array;
  readonly z: Float32Array;
  /** Curvature (1/radius) at each sample. */
  readonly k: Float32Array;
  readonly length: number;
  static readonly STEP = 0.25;

  constructor(corners: P[], radius: number) {
    const pts: P[] = [];
    const n = corners.length;
    for (let i = 0; i < n; i++) {
      const p = corners[i];
      const a = corners[(i + n - 1) % n];
      const b = corners[(i + 1) % n];
      const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
      const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
      const r = Math.min(radius, la / 2.2, lb / 2.2);
      const s: P = [p[0] + ((a[0] - p[0]) / la) * r, p[1] + ((a[1] - p[1]) / la) * r];
      const e: P = [p[0] + ((b[0] - p[0]) / lb) * r, p[1] + ((b[1] - p[1]) / lb) * r];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10;
        pts.push([(1 - t) * (1 - t) * s[0] + 2 * (1 - t) * t * p[0] + t * t * e[0], (1 - t) * (1 - t) * s[1] + 2 * (1 - t) * t * p[1] + t * t * e[1]]);
      }
    }
    pts.push(pts[0]);
    const xs: number[] = [];
    const zs: number[] = [];
    let carry = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-6) continue;
      let d = carry;
      while (d < L) {
        xs.push(ax + ((bx - ax) * d) / L);
        zs.push(az + ((bz - az) * d) / L);
        d += Loop.STEP;
      }
      carry = d - L;
    }
    this.x = Float32Array.from(xs);
    this.z = Float32Array.from(zs);
    this.length = xs.length * Loop.STEP;
    this.k = new Float32Array(xs.length);
    const N = xs.length;
    for (let i = 0; i < N; i++) {
      const a = (i + N - 4) % N;
      const b = (i + 4) % N;
      const h0 = Math.atan2(xs[i] - xs[a], zs[i] - zs[a]);
      const h1 = Math.atan2(xs[b] - xs[i], zs[b] - zs[i]);
      this.k[i] = Math.abs(Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))) / (4 * Loop.STEP);
    }
  }

  wrap(s: number): number {
    return ((s % this.length) + this.length) % this.length;
  }

  at(s: number, out: { x: number; z: number }): { x: number; z: number } {
    const u = this.wrap(s) / Loop.STEP;
    const i = Math.floor(u);
    const j = (i + 1) % this.x.length;
    const f = u - i;
    out.x = this.x[i] + (this.x[j] - this.x[i]) * f;
    out.z = this.z[i] + (this.z[j] - this.z[i]) * f;
    return out;
  }

  yaw(s: number): number {
    const a = this.at(s - 0.6, { x: 0, z: 0 });
    const b = this.at(s + 0.6, { x: 0, z: 0 });
    return Math.atan2(b.x - a.x, b.z - a.z);
  }

  curve(s: number): number {
    return this.k[Math.floor(this.wrap(s) / Loop.STEP)];
  }

  /** Every arc position where the loop passes within r of (x, z). */
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
        out.push(best * Loop.STEP);
        best = -1;
        bd = Infinity;
      }
    }
    if (best >= 0) out.push(best * Loop.STEP);
    return out;
  }
}

// ------------------------------------------------------------------ the model (code-built)

const CREAM: RGB = [0.86, 0.8, 0.64];
const GLASS: RGB = [0.08, 0.09, 0.1];
const IRON: RGB = [0.18, 0.17, 0.16];
const YELLOW: RGB = [0.72, 0.56, 0.22];
const BROWN: RGB = [0.45, 0.33, 0.24];
const ROOF: RGB = [0.35, 0.34, 0.33];
/** The paint takes the line's colour (instance colour times this). */
const PAINT: RGB = [1, 1, 1];
const PAINT_DARK: RGB = [0.62, 0.62, 0.62];

const Z0 = -1.05; // back of the saloon
const Z1 = 3.1; // front of the saloon
const W = 1.72;

/** Body frame: +z forward, y up, origin on the ground under the rear axle. `paint`: the panels only. */
function bodyGeometry(paint: boolean): THREE.BufferGeometry {
  const k = new Kit();
  const L = Z1 - Z0;
  const zc = (Z0 + Z1) / 2;
  if (paint) {
    for (const s of [-1, 1]) {
      k.box(0.06, 0.72, L, s * (W / 2), 1.2, zc, PAINT);
      k.box(0.06, 0.26, L, s * (W / 2), 2.4, zc, PAINT_DARK); // behind the letter board
    }
    k.box(W, 1.7, 0.06, 0, 1.63, Z1, PAINT); // front bulkhead
    for (const s of [-1, 1]) k.box(0.56, 1.7, 0.06, s * 0.58, 1.63, Z0, PAINT);
    k.box(W, 0.3, 0.06, 0, 2.33, Z0, PAINT);
    return k.build();
  }
  // floor and underframe, the perch to the front carriage
  k.box(W, 0.1, L, 0, 0.78, zc, BROWN);
  k.box(0.14, 0.12, 3.6, 0, 0.62, 1.2, IRON);
  // the waist rail, the window band (cream frame, dark glass)
  for (const s of [-1, 1]) {
    k.box(0.08, 0.08, L + 0.04, s * (W / 2 + 0.01), 1.6, zc, YELLOW);
    k.box(0.05, 0.62, L, s * (W / 2), 1.95, zc, CREAM);
    for (let i = 0; i < 5; i++) k.box(0.03, 0.46, 0.62, s * (W / 2 + 0.02), 1.95, Z0 + 0.45 + i * 0.8, GLASS);
  }
  k.box(0.9, 0.5, 0.04, 0, 1.95, Z1 + 0.02, GLASS);
  k.box(0.6, 1.4, 0.02, 0, 1.5, Z0 + 0.05, [0.05, 0.05, 0.05]);
  // the roof, with a knifeboard seat along it and a rail round it
  k.box(W + 0.14, 0.08, L + 0.3, 0, 2.56, zc, ROOF);
  k.box(0.1, 0.5, L - 0.6, 0, 2.85, zc, BROWN);
  k.box(0.9, 0.06, L - 0.6, 0, 2.72, zc, BROWN);
  for (const s of [-1, 1]) {
    k.box(0.04, 0.04, L + 0.2, s * (W / 2 + 0.03), 2.95, zc, IRON);
    for (let i = 0; i <= 4; i++) k.box(0.03, 0.36, 0.03, s * (W / 2 + 0.03), 2.77, Z0 - 0.05 + (i * (L + 0.1)) / 4, IRON);
  }
  // the back platform, its step and a hand rail, a ladder to the roof
  k.box(1.5, 0.08, 0.75, 0, 0.7, Z0 - 0.4, BROWN);
  k.box(0.9, 0.05, 0.3, 0, 0.36, Z0 - 0.85, BROWN);
  for (const s of [-1, 1]) k.box(0.04, 0.45, 0.04, s * 0.45, 0.55, Z0 - 0.85, IRON);
  k.box(0.04, 1.9, 0.04, 0.72, 1.7, Z0 - 0.75, IRON);
  for (let i = 0; i < 6; i++) k.box(0.3, 0.03, 0.03, -0.6, 0.95 + i * 0.33, Z0 - 0.72, IRON);
  k.box(0.03, 2.1, 0.03, -0.75, 1.75, Z0 - 0.72, IRON);
  k.box(0.03, 2.1, 0.03, -0.45, 1.75, Z0 - 0.72, IRON);
  // the driver's box over the front wheels, the footboard, the dashboard, two lamp cases
  k.box(1.3, 0.12, 0.8, 0, 2.2, Z1 + 0.35, BROWN);
  k.box(1.3, 0.35, 0.08, 0, 2.3, Z1 - 0.02, BROWN);
  k.box(1.4, 0.06, 0.5, 0, 1.45, Z1 + 0.95, BROWN);
  k.box(1.4, 0.55, 0.05, 0, 1.72, Z1 + 1.2, [0.1, 0.1, 0.1]);
  for (const s of [-1, 1]) {
    k.box(0.16, 0.22, 0.12, s * 0.92, 2.0, Z1 + 0.04, YELLOW);
    k.box(0.06, 0.08, 0.06, s * 0.92, 2.15, Z1 + 0.04, YELLOW);
    k.box(0.05, 0.9, 0.05, s * 0.6, 1.8, Z1 + 0.5, IRON);
  }
  // rear springs
  for (const s of [-1, 1]) k.box(0.1, 0.1, 1.2, s * 0.8, 0.72, 0, IRON);
  return k.build();
}

/** Where the lamp glass sits (body frame): the front of each lamp case. */
const LAMPS: Array<[number, number, number]> = [
  [-0.92, 2.0, Z1 + 0.11],
  [0.92, 2.0, Z1 + 0.11],
];

function wheelsGeometry(r: number, track: number): THREE.BufferGeometry {
  const k = new Kit();
  k.cyl(0.05, 0.05, track + 0.2, 6, 0, 0, 0, IRON, 0, 0, Math.PI / 2);
  for (const x of [-track / 2, track / 2]) {
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      k.box(0.07, 0.07, (2 * Math.PI * r) / n + 0.02, x, Math.sin(a) * (r - 0.035), Math.cos(a) * (r - 0.035), IRON, 0, -(a + Math.PI / 2));
    }
    for (let i = 0; i < 6; i++) k.box(0.035, r * 1.9, 0.04, x, 0, 0, YELLOW, 0, (i * Math.PI) / 6);
    k.cyl(0.1, 0.1, 0.2, 8, x, 0, 0, YELLOW, 0, 0, Math.PI / 2);
  }
  return k.build();
}

/** The front carriage: its wheels (they roll: a child), the bolster and the pole to the horses. Origin at the pivot. */
function foreGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(1.5, 0.1, 0.2, 0, 1.0, 0, IRON);
  k.box(0.1, 0.1, HORSES + 0.6, 0, 0.9, (HORSES + 0.6) / 2, BROWN); // the pole
  k.box(1.0, 0.07, 0.07, 0, 0.9, 1.0, BROWN); // the splinter bar
  return k.build();
}

/** A stop post: an iron pole, a cream sign, and a plate in the colour of each line that calls there. */
function postGeometry(lines: LineDef[]): THREE.BufferGeometry {
  const k = new Kit();
  k.box(0.1, 2.6, 0.1, 0, 1.3, 0, IRON);
  k.box(0.1, 0.4, 0.66, 0, 2.45, 0, [0.2, 0.2, 0.2]);
  k.box(0.12, 0.3, 0.56, 0, 2.45, 0, CREAM);
  const bright = (c: RGB): RGB => [Math.min(1, c[0] * 1.5), Math.min(1, c[1] * 1.5), Math.min(1, c[2] * 1.5)];
  lines.forEach((l, i) => k.box(0.14, 0.22, 0.52, 0, 2.02 - i * 0.28, 0, bright(l.colour)));
  k.box(0.2, 0.1, 0.2, 0, 0.05, 0, IRON);
  return k.build();
}

/** Two rows per line: the side board (the stops) and the destination board (the line). */
function boardAtlas(): { tex: THREE.CanvasTexture; rows: number } {
  const w = 512;
  const h = 32;
  const rows = LINES.length * 2;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h * rows;
  const g = c.getContext("2d")!;
  LINES.forEach((l, i) => {
    for (const [r, text, size] of [[i * 2, l.sideBoard, 0.6], [i * 2 + 1, l.board, 0.78]] as const) {
      const [cr, cg, cb] = l.colour.map((v) => Math.round(v * 120));
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.fillRect(0, r * h, w, h);
      g.fillStyle = "#e8d8a0";
      g.font = `bold ${Math.floor(h * size)}px Georgia, serif`;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(text, w / 2, r * h + h / 2 + 1, w - 12);
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, rows };
}

/**
 * The boards in the body frame: [centre, the way "right" runs across the text, up, normal, width,
 * height, row offset (0: side board, 1: destination)]. Text reads left to right from outside.
 */
const BOARDS: Array<{ c: [number, number, number]; right: [number, number, number]; n: [number, number, number]; w: number; h: number; row: 0 | 1 }> = [
  { c: [-(W / 2 + 0.035), 2.4, 1.02], right: [0, 0, 1], n: [-1, 0, 0], w: 4.0, h: 0.22, row: 0 },
  { c: [W / 2 + 0.035, 2.4, 1.02], right: [0, 0, -1], n: [1, 0, 0], w: 4.0, h: 0.22, row: 0 },
  { c: [0, 2.74, Z1 + 0.2], right: [1, 0, 0], n: [0, 0, 1], w: 1.5, h: 0.26, row: 1 },
  { c: [0, 2.74, Z0 - 0.2], right: [-1, 0, 0], n: [0, 0, -1], w: 1.5, h: 0.26, row: 1 },
];

// ------------------------------------------------------------------ the omnibuses

interface BusState extends Omnibus {
  loop: Loop;
  watch: Uint8Array;
  stopAt: Array<{ s: number; stop: OmnibusStop }>;
  s: number;
  v: number;
  dwell: number;
  held: boolean;
  at: OmnibusStop | null;
  nextI: number;
  rollR: number;
  rollF: number;
  gait: number;
  waitWhy: string;
  rects: Rect[];
  near: boolean;
  /** The body's frame (humans ride in it). */
  frame: THREE.Group;
  driver: Human | null;
  conductor: Human | null;
  driverG: THREE.Group;
  conductorG: THREE.Group;
  // pose
  pa: { x: number; z: number };
  pb: { x: number; z: number };
  pc: { x: number; z: number };
  yaw: number;
  foreYaw: number;
  horseYaw: number;
  spans: Map<object, Array<[number, number]>>;
}

export function createOmnibuses(scene: THREE.Scene, opts: OmnibusOptions): Omnibuses {
  const group = new THREE.Group();
  group.name = "omnibuses";
  scene.add(group);

  // --- the buses, their lines' paths and stops
  const loops = new Map<string, { loop: Loop; watch: Uint8Array; stopAt: Array<{ s: number; stop: OmnibusStop }> }>();
  for (const l of LINES) {
    const loop = new Loop(l.route, 5);
    const watch = new Uint8Array(loop.x.length);
    for (let i = 0; i < loop.x.length; i++) watch[i] = opts.isFree(loop.x[i], loop.z[i], 0.5) ? 1 : 0;
    const stopAt: Array<{ s: number; stop: OmnibusStop }> = [];
    for (const st of STOPS) if (st.line === l.id) for (const s of loop.passes(st.x, st.z, 1.5)) stopAt.push({ s, stop: st });
    stopAt.sort((a, b) => a.s - b.s);
    loops.set(l.id, { loop, watch, stopAt });
  }
  const buses: BusState[] = [];
  for (const l of LINES) {
    const { loop, watch, stopAt } = loops.get(l.id)!;
    for (let k = 0; k < l.buses; k++) {
      const frame = new THREE.Group();
      const driverG = new THREE.Group();
      const conductorG = new THREE.Group();
      driverG.position.set(0.1, 0, 3.45);
      conductorG.position.set(0.5, 0.74, -1.5);
      conductorG.rotation.y = -0.6;
      frame.add(driverG, conductorG);
      group.add(frame);
      // spread along the round: the first by the first stop, the others after it
      const s0 = loop.wrap(stopAt[0].s - 20 + (k * loop.length) / l.buses);
      const b: BusState = {
        line: l,
        index: buses.length,
        loop,
        watch,
        stopAt,
        s: s0,
        v: 0,
        dwell: 0,
        held: false,
        at: null,
        nextI: 0,
        rollR: 0,
        rollF: 0,
        gait: Math.random(),
        waitWhy: "",
        rects: [0, 1].map(() => ({ minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, top: 2.6 })),
        near: true,
        frame,
        driver: null,
        conductor: null,
        driverG,
        conductorG,
        pa: { x: 0, z: 0 },
        pb: { x: 0, z: 0 },
        pc: { x: 0, z: 0 },
        yaw: 0,
        foreYaw: 0,
        horseYaw: 0,
        spans: new Map(),
        rider: false,
        atStop: () => b.at,
        nextStop: () => b.stopAt[b.nextI].stop,
        hold(on) {
          b.held = on;
          if (!on && b.at) b.dwell = Math.max(b.dwell, 2.5);
        },
        platform() {
          const back = -1.45;
          return { x: b.pa.x + Math.sin(b.yaw) * back, y: 0.74 + b.frame.position.y, z: b.pa.z + Math.cos(b.yaw) * back, yaw: b.yaw, speed: b.v };
        },
        stepDown() {
          const back = -2.6;
          return { x: b.pa.x + Math.sin(b.yaw) * back, z: b.pa.z + Math.cos(b.yaw) * back, yaw: b.yaw + Math.PI };
        },
        info() {
          return {
            line: l.id,
            s: +b.s.toFixed(1),
            at: [+b.pa.x.toFixed(1), +b.pa.z.toFixed(1)],
            v: +b.v.toFixed(2),
            stop: b.at?.id ?? null,
            next: b.stopAt[b.nextI].stop.id,
            dwell: +b.dwell.toFixed(1),
            held: b.held,
            wait: b.waitWhy,
            rider: b.rider,
            length: +loop.length.toFixed(0),
          };
        },
      };
      findNext(b);
      buses.push(b);
    }
  }

  // --- drawing: one InstancedMesh per part for every bus, one mesh for all the boards
  const wood = psx(new THREE.MeshLambertMaterial({ map: opts.tex.planks, vertexColors: true }));
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const inst = (g: THREE.BufferGeometry, n: number, name: string) => {
    const m = new THREE.InstancedMesh(g, wood, n);
    m.name = name;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) m.setMatrixAt(i, zero);
    group.add(m);
    return m;
  };
  const n = buses.length;
  const bodyM = inst(bodyGeometry(false), n, "omnibus_body");
  const paintM = inst(bodyGeometry(true), n, "omnibus_paint");
  const rearM = inst(wheelsGeometry(R_REAR, 1.98), n, "omnibus_rear_wheels");
  const foreM = inst(foreGeometry(), n, "omnibus_fore");
  const frontM = inst(wheelsGeometry(R_FRONT, 1.62), n, "omnibus_front_wheels");
  const col = new THREE.Color();
  buses.forEach((b, i) => paintM.setColorAt(i, col.setRGB(...b.line.colour)));
  if (paintM.instanceColor) paintM.instanceColor.needsUpdate = true;

  const atlas = boardAtlas();
  const boardMat = psx(new THREE.MeshLambertMaterial({ map: atlas.tex, side: THREE.DoubleSide }));
  const nv = n * BOARDS.length * 6;
  const boardGeo = new THREE.BufferGeometry();
  const bPos = new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3);
  const bNor = new THREE.Float32BufferAttribute(new Float32Array(nv * 3), 3);
  const bUv = new THREE.Float32BufferAttribute(new Float32Array(nv * 2), 2);
  bPos.setUsage(THREE.DynamicDrawUsage);
  bNor.setUsage(THREE.DynamicDrawUsage);
  boardGeo.setAttribute("position", bPos);
  boardGeo.setAttribute("normal", bNor);
  boardGeo.setAttribute("uv", bUv);
  buses.forEach((b, i) => {
    const li = LINES.indexOf(b.line);
    BOARDS.forEach((bd, j) => {
      const row = li * 2 + bd.row;
      const v0 = 1 - (row + 1) / atlas.rows;
      const v1 = 1 - row / atlas.rows;
      const base = (i * BOARDS.length + j) * 6;
      // corners: bottom-left, bottom-right, top-right, bottom-left, top-right, top-left
      const uv: Array<[number, number]> = [[0, v0], [1, v0], [1, v1], [0, v0], [1, v1], [0, v1]];
      uv.forEach(([u, v], k) => bUv.setXY(base + k, u, v));
    });
  });
  const boards = new THREE.Mesh(boardGeo, boardMat);
  boards.name = "omnibus_boards";
  boards.frustumCulled = false;
  group.add(boards);

  // the carriage lamps: glass that glows after dusk, and a soft glow in the air round it
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x222222, fog: false });
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.14, 0.03), glassMat, n * 2);
  glass.name = "omnibus_lamps";
  glass.frustumCulled = false;
  group.add(glass);
  const haloGeo = new THREE.BufferGeometry();
  const haloPos = new THREE.Float32BufferAttribute(new Float32Array(n * 2 * 3), 3);
  haloPos.setUsage(THREE.DynamicDrawUsage);
  haloGeo.setAttribute("position", haloPos);
  const haloMat = new THREE.PointsMaterial({
    map: glowTexture(),
    color: 0xffb865,
    size: 1.3,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const halos = new THREE.Points(haloGeo, haloMat);
  halos.name = "omnibus_lamp_glow";
  halos.frustumCulled = false;
  group.add(halos);

  // the stop posts: one merged mesh; each post shows the lines that call at its stop
  const linesAt = (id: string) => LINES.filter((l) => STOPS.some((s) => s.id === id && s.line === l.id));
  {
    const geos = STOPS.map((st) => {
      const g = postGeometry(linesAt(st.id));
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(st.x - st.post[0], st.z - st.post[1]) + Math.PI / 2).setPosition(st.post[0], 0, st.post[1]));
      return g;
    });
    const posts = new THREE.Mesh(mergeGeometries(geos, false) ?? geos[0], wood);
    posts.name = "omnibus_posts";
    scene.add(posts);
  }

  // --- moving
  function findNext(b: BusState): void {
    let best = Infinity;
    b.stopAt.forEach((x, i) => {
      const d = b.loop.wrap(x.s - b.s);
      if (d > 0.3 && d < best) {
        best = d;
        b.nextI = i;
      }
    });
  }

  function spanOf(b: BusState, r: { minX: number; maxX: number; minZ: number; maxZ: number }): Array<[number, number]> {
    let sp = b.spans.get(r);
    if (sp) return sp;
    sp = [];
    let s0 = -1;
    const lp = b.loop;
    for (let i = 0; i < lp.x.length; i++) {
      const inside = lp.x[i] > r.minX - 0.5 && lp.x[i] < r.maxX + 0.5 && lp.z[i] > r.minZ - 0.5 && lp.z[i] < r.maxZ + 0.5;
      if (inside && s0 < 0) s0 = i * Loop.STEP;
      if (!inside && s0 >= 0) {
        sp.push([s0, i * Loop.STEP]);
        s0 = -1;
      }
    }
    b.spans.set(r, sp);
    return sp;
  }

  const pa = { x: 0, z: 0 };
  const pb = { x: 0, z: 0 };
  function room(b: BusState, player: { x: number; z: number } | null): number {
    const lp = b.loop;
    let lim = Infinity;
    b.waitWhy = "";
    const nose = b.s + NOSE;
    // the next stop
    lim = Math.min(lim, lp.wrap(b.stopAt[b.nextI].s - b.s));
    // opening bridges not shut (8 m short: an open swing bridge lies on the quay across the lane)
    for (const br of opts.bridges()) {
      for (const [s0] of spanOf(b, br.rect)) {
        const ahead = lp.wrap(s0 - nose);
        if (ahead < 30 && !br.closed() && ahead - 8 < lim) {
          lim = Math.max(0, ahead - 8);
          b.waitWhy = "bridge";
        }
      }
    }
    // the player in the way
    if (player && !b.rider) {
      for (let dd = -1; dd <= 7; dd += 0.5) {
        lp.at(nose + dd, pa);
        if (Math.hypot(player.x - pa.x, player.z - pa.z) < 1.7) {
          lim = Math.min(lim, Math.max(0, dd - 7.5));
          b.waitWhy = "player";
          break;
        }
      }
    }
    // people in the lane ahead (not colliders: they walk)
    const folk = api.people?.();
    if (folk) {
      lp.at(nose + 3, pb);
      for (const p of folk) {
        if (Math.abs(p.x - pb.x) > 5 || Math.abs(p.z - pb.z) > 5) continue;
        for (let dd = 0; dd <= 6; dd += 1) {
          lp.at(nose + dd, pa);
          if (Math.hypot(p.x - pa.x, p.z - pa.z) < 1.5) {
            lim = Math.min(lim, Math.max(0, dd - 3));
            b.waitWhy = "people";
            break;
          }
        }
      }
    }
    // anything on the lane ahead: goods, carts, the other omnibuses (its own boxes out of the way
    // meanwhile: turned on a bend, they reach ahead of the noses)
    const keep = b.rects.map((r) => [r.minX, r.maxX]);
    for (const r of b.rects) r.minX = r.maxX = 1e6;
    for (const dd of [1.2, 2.6, 4]) {
      const i = Math.floor(lp.wrap(nose + dd) / Loop.STEP);
      if (!b.watch[i]) continue;
      if (!opts.isFree(lp.x[i], lp.z[i], 0.5)) {
        lim = Math.min(lim, Math.max(0, dd - 3));
        b.waitWhy = "blocked";
        break;
      }
    }
    b.rects.forEach((r, k) => ([r.minX, r.maxX] = keep[k]));
    return lim;
  }

  function move(b: BusState, dt: number, player: { x: number; z: number } | null): void {
    const lp = b.loop;
    if (b.at) {
      b.v = 0;
      if (!b.held) b.dwell -= dt;
      if (b.dwell <= 0 && !b.held) {
        const was = b.at;
        b.at = null;
        b.nextI = (b.nextI + 1) % b.stopAt.length;
        api.onDepart?.(b, was, b.stopAt[b.nextI].stop);
      }
    } else {
      const r = room(b, player);
      // slow for the bends ahead
      let vmax = CRUISE;
      for (let dd = 0; dd <= 10; dd += 2) {
        const k = lp.curve(b.s + WHEELBASE + dd);
        if (k > 1e-3) vmax = Math.min(vmax, Math.sqrt(LAT / k) + dd * 0.15);
      }
      const want = r <= 0.01 ? 0 : Math.min(vmax, Math.sqrt(2 * BRAKE * r));
      b.v += THREE.MathUtils.clamp(want - b.v, -BRAKE * 2.5 * dt, ACCEL * dt);
      if (b.v < 0.01 && want === 0) b.v = 0;
      const ds = Math.min(b.v * dt, Math.max(0, r));
      b.s = lp.wrap(b.s + ds);
      b.rollR += ds / R_REAR;
      b.rollF += ds / R_FRONT;
      const st = b.stopAt[b.nextI];
      const d = lp.wrap(st.s - b.s);
      if (d < 0.05 || d > lp.length - 0.5) {
        b.at = st.stop;
        b.dwell = DWELL;
        b.v = 0;
        api.onArrive?.(b, st.stop);
      }
    }
    const trot = b.v > 1.9;
    b.gait = (b.gait + (b.v / (trot ? 2.8 : 1.35)) * dt * (trot ? 1.0 : 0.95)) % 1;
    // pose: the body from the rear axle to the pivot, the fore-carriage toward the horses
    lp.at(b.s, b.pa);
    lp.at(b.s + WHEELBASE, b.pb);
    lp.at(b.s + WHEELBASE + HORSES, b.pc);
    b.yaw = Math.atan2(b.pb.x - b.pa.x, b.pb.z - b.pa.z);
    b.foreYaw = Math.atan2(b.pc.x - b.pb.x, b.pc.z - b.pb.z);
    b.horseYaw = lp.yaw(b.s + WHEELBASE + HORSES);
    // a little sway on the springs as the horses trot
    const go = Math.min(1, b.v / 2);
    b.frame.position.set(b.pa.x, Math.abs(Math.sin(b.gait * Math.PI * 2)) * 0.012 * go, b.pa.z);
    b.frame.rotation.set(0, b.yaw, Math.sin(b.gait * Math.PI * 4) * 0.006 * go, "YXZ");
    // colliders: the saloon with its platform, the horses
    const box = (r: Rect, x: number, z: number, yw: number, hl: number, hw: number) => {
      const a = Math.abs(Math.sin(yw));
      const c = Math.abs(Math.cos(yw));
      r.minX = x - a * hl - c * hw;
      r.maxX = x + a * hl + c * hw;
      r.minZ = z - c * hl - a * hw;
      r.maxZ = z + c * hl + a * hw;
    };
    box(b.rects[0], b.pa.x + Math.sin(b.yaw), b.pa.z + Math.cos(b.yaw), b.yaw, 3.1, 1.0);
    box(b.rects[1], b.pc.x, b.pc.z, b.horseYaw, 1.6, 1.1);
  }

  const M = new THREE.Matrix4();
  const M2 = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const E = new THREE.Euler();
  const V = new THREE.Vector3();
  const S1 = new THREE.Vector3(1, 1, 1);
  const tmp = new THREE.Vector3();
  const tmpN = new THREE.Vector3();
  const set = (m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, pitch = 0, roll = 0) => {
    E.set(pitch, yaw, roll, "YXZ");
    Q.setFromEuler(E);
    M.compose(V.set(x, y, z), Q, S1);
    m.setMatrixAt(i, M);
  };

  function draw(camera?: THREE.Camera): void {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 40) + 30;
    const cam = camera?.position;
    const lit = THREE.MathUtils.clamp(opts.lit?.() ?? 0, 0, 1);
    let anyNear = false;
    buses.forEach((b, i) => {
      b.near = !cam || Math.hypot(b.pa.x - cam.x, b.pa.z - cam.z) < far;
      anyNear ||= b.near;
      b.frame.updateMatrixWorld();
      bodyM.setMatrixAt(i, b.frame.matrixWorld);
      paintM.setMatrixAt(i, b.frame.matrixWorld);
      set(rearM, i, b.pa.x, R_REAR, b.pa.z, b.yaw, b.rollR);
      set(foreM, i, b.pb.x, 0, b.pb.z, b.foreYaw);
      set(frontM, i, b.pb.x, R_FRONT, b.pb.z, b.foreYaw, b.rollF);
      // boards and lamps ride on the body
      BOARDS.forEach((bd, j) => {
        const base = (i * BOARDS.length + j) * 6;
        const corner = (su: number, sv: number, out: THREE.Vector3) =>
          out
            .set(bd.c[0] + bd.right[0] * su * (bd.w / 2), bd.c[1] + sv * (bd.h / 2), bd.c[2] + bd.right[2] * su * (bd.w / 2))
            .applyMatrix4(b.frame.matrixWorld);
        tmpN.set(...bd.n).transformDirection(b.frame.matrixWorld);
        ([[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]] as const).forEach(([su, sv], k) => {
          corner(su, sv, tmp);
          bPos.setXYZ(base + k, tmp.x, tmp.y, tmp.z);
          bNor.setXYZ(base + k, tmpN.x, tmpN.y, tmpN.z);
        });
      });
      LAMPS.forEach(([x, y, z], k) => {
        tmp.set(x, y, z).applyMatrix4(b.frame.matrixWorld);
        M2.compose(tmp, b.frame.quaternion, S1);
        glass.setMatrixAt(i * 2 + k, M2);
        tmp.set(x, y, z + 0.12).applyMatrix4(b.frame.matrixWorld);
        haloPos.setXYZ(i * 2 + k, tmp.x, tmp.y, tmp.z);
      });
      // the driver on his box, the conductor on the platform; only near
      if (!b.driver) {
        b.driver = makeHuman("carter");
        if (b.driver) {
          b.driverG.add(b.driver.root);
          if (b.driver.canSit) b.driver.play("sit", 0);
          b.driver.root.position.y = 2.28 + b.driver.sitDrop(0);
        }
      }
      if (!b.conductor) {
        b.conductor = makeHuman("porter");
        if (b.conductor) b.conductorG.add(b.conductor.root);
      }
      b.conductorG.position.x = b.rider ? 0.62 : 0.5; // nobody stands where the rider stands
      b.frame.visible = b.near;
    });
    for (const m of [bodyM, paintM, rearM, foreM, frontM, glass]) m.instanceMatrix.needsUpdate = true;
    bPos.needsUpdate = true;
    bNor.needsUpdate = true;
    boardGeo.computeBoundingSphere();
    haloPos.needsUpdate = true;
    // the lamps: dark glass by day, a warm flame after dusk
    glassMat.color.setRGB(0.13 + 0.87 * lit, 0.13 + 0.6 * lit, 0.12 + 0.28 * lit);
    haloMat.opacity = 0.7 * lit;
    halos.visible = lit > 0.02 && anyNear;
    opts.horses.show("omnibus", anyNear);
  }

  const api: Omnibuses = {
    buses,
    update(_t, dt, player, camera) {
      dt = Math.min(dt, 0.1);
      for (const b of buses) move(b, dt, player);
      buses.forEach((b, i) => {
        const cy = Math.cos(b.horseYaw);
        const sy = Math.sin(b.horseYaw);
        const amp = Math.min(1, b.v / 0.8);
        const trot = b.v > 1.9;
        for (const [k, side] of [[0, 0.55], [1, -0.55]] as const) {
          opts.horses.set(opts.horseIndex + i * 2 + k, b.pc.x + cy * side, b.pc.z - sy * side, b.horseYaw, (b.gait + k * 0.08) % 1, amp, trot);
        }
      });
      opts.horses.commit();
      draw(camera);
      for (const b of buses) {
        if (!b.near) continue;
        b.driver?.update(dt);
        b.conductor?.update(dt);
      }
    },
    colliders: () => buses.flatMap((b) => b.rects),
    busy(r) {
      for (const b of buses) {
        // the rig from its tail to 10 m before the horses' noses, against the bridge's stretch
        const a = b.s + TAIL;
        const lr = NOSE - TAIL + 10;
        for (const [s0, s1] of spanOf(b, r)) {
          const bb = s0 - 1;
          if (b.loop.wrap(bb - a) < lr || b.loop.wrap(a - bb) < s1 - s0 + 2) return true;
        }
      }
      return false;
    },
    vehicles() {
      return buses.filter((b) => b.near).map((b) => ({ kind: "dray" as const, x: b.pc.x, z: b.pc.z, state: b.v > 0.1 ? "go" : "wait" }));
    },
    linesAt,
    group,
    info() {
      return { buses: buses.map((b) => b.info()), lines: LINES.map((l) => ({ id: l.id, length: +loops.get(l.id)!.loop.length.toFixed(0), stops: loops.get(l.id)!.stopAt.map((x) => [x.stop.id, +x.s.toFixed(0)]) })) };
    },
    jumpTo(i, stop, before = 20) {
      const b = buses[i];
      const st = b?.stopAt.find((x) => x.stop.id === stop);
      if (!b || !st) return;
      b.s = b.loop.wrap(st.s - before);
      b.v = 0;
      b.at = null;
      b.held = false;
      findNext(b);
    },
  };
  return api;
}
