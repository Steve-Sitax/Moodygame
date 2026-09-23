import * as THREE from "three";
import { psx } from "../retro/psx";
import { makeHuman, type Human } from "../game/humans";
import type { Rect } from "./geom";
import type { HorsePool } from "./horses";
import { Kit, type RGB } from "./kit";
import type { OpeningLike } from "./railway";

// The horse omnibus along the quays (M3g). Autumn 1873 had no tram on the river quays yet
// (Antwerp's first horse tram ran from 25 May 1873, Meir to Berchem; the harbour tramways
// came from 1881), but omnibuses had run between the harbour and the station since the
// 1830s (docs/milestones/M3g.md). So: a pair-horse omnibus with a driver on the box and a
// conductor on the back platform, going round the quays on the cobbles, no rails:
//
//   the Werf -> the Steenplein -> the Vismarkt -> the Rijnkaai -> the Petit Bassin
//   -> back along the Rijnkaai -> the Vismarkt -> the Steenplein -> round behind the Werf.
//
// It stops at every stop (a post with a board) for a few seconds, longer while someone gets
// on or off (game/ride.ts: E at the back platform). It stops for the player in its way, for
// anything on its lane, and before an opening bridge that is not shut.

type P = [number, number];

export interface OmnibusStop {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Where the post stands. */
  post: P;
}

/** The stops (ids as the server knows them, server/src/ride.ts RIDE_STOPS). */
export const STOPS: OmnibusStop[] = [
  { id: "werf", name: "the Werf", x: -270, z: 8.3, post: [-270, 10.4] },
  { id: "steenplein", name: "the Steenplein", x: -180, z: 8.3, post: [-180, 10.4] },
  { id: "vismarkt", name: "the Vismarkt", x: -112, z: 8.3, post: [-112, 10.4] },
  { id: "rijnkaai", name: "the Rijnkaai", x: 30, z: 8.3, post: [30, 6.3] },
  { id: "bassin", name: "the Petit Bassin", x: 76, z: 31, post: [78.3, 31] },
  { id: "rijnkaai_back", name: "the Rijnkaai", x: 0, z: 37, post: [0, 39.3] },
];

/** The round, corner points (rounded with a 5 m radius). Checked on the walk map: all open ground. */
const ROUTE: P[] = [
  [-305, 29.5], [-305, 8.3], [-158, 8.3], [-152, 7.6], [-140, 7.6], [-134, 8.3], [-90, 8.3], [-84, 7.8], [-68, 7.8],
  [-62, 8.3], [66, 8.3], [76, 15], [76, 37], [-54, 37], [-58, 33], [-58, 12], [-62, 8.3], [-204, 8.3], [-204, 29.5],
];

/** Boxes along the omnibus's lane, for props, pumps and troughs to keep off it (rijnkaai.ts). */
export function omnibusKeepOut(): Rect[] {
  const loop = new Loop(ROUTE, 5);
  const out: Rect[] = [];
  for (let i = 0; i < loop.x.length; i += 8) {
    const x = loop.x[i];
    const z = loop.z[i];
    out.push({ minX: x - 1.9, maxX: x + 1.9, minZ: z - 1.9, maxZ: z + 1.9 });
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

export interface Omnibus {
  update(t: number, dt: number, player: { x: number; z: number } | null, camera?: THREE.Camera): void;
  colliders(): Rect[];
  busy(r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean;
  /** The stop it stands at now (dwelling), or null. */
  atStop(): OmnibusStop | null;
  /** The next stop ahead. */
  nextStop(): OmnibusStop;
  /** Hold at the stop while someone gets on or off. */
  hold(on: boolean): void;
  /** Someone rides: the omnibus no longer waits for "the player in the way". */
  rider: boolean;
  /** Where a rider stands on the back platform (feet), the way the omnibus points, its speed. */
  platform(): { x: number; y: number; z: number; yaw: number; speed: number };
  /** The foot of the step behind the platform (world), and the way out (yaw). */
  stepDown(): { x: number; z: number; yaw: number };
  onArrive?: (stop: OmnibusStop) => void;
  onDepart?: (stop: OmnibusStop, next: OmnibusStop) => void;
  /** For the soundscape (setVehicles): hooves and wheels while it rolls. */
  vehicles(): Array<{ kind: "dray"; x: number; z: number; state: string }>;
  group: THREE.Group;
  info(): Record<string, unknown>;
  /** Dev: put it just before a stop. */
  jumpTo(id: string, before?: number): void;
}

export interface OmnibusOptions {
  horses: HorsePool;
  /** First of the two horse instances to use. */
  horseIndex: number;
  tex: { planks: THREE.Texture };
  bridges: () => OpeningLike[];
  isFree: (x: number, z: number, r: number) => boolean;
}

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

const GREEN: RGB = [0.4, 0.52, 0.42];
const GREEN_DARK: RGB = [0.26, 0.34, 0.28];
const CREAM: RGB = [0.86, 0.8, 0.64];
const GLASS: RGB = [0.08, 0.09, 0.1];
const IRON: RGB = [0.18, 0.17, 0.16];
const YELLOW: RGB = [0.72, 0.56, 0.22];
const BROWN: RGB = [0.45, 0.33, 0.24];
const ROOF: RGB = [0.35, 0.34, 0.33];

/** Body frame: +z forward, y up, origin on the ground under the rear axle. */
function bodyGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const z0 = -1.05; // back of the saloon
  const z1 = 3.1; // front of the saloon
  const L = z1 - z0;
  const zc = (z0 + z1) / 2;
  const w = 1.72;
  // floor and underframe, the perch to the front carriage
  k.box(w, 0.1, L, 0, 0.78, zc, BROWN);
  k.box(0.14, 0.12, 3.6, 0, 0.62, 1.2, IRON);
  // lower panels (green), the waist rail, the window band (cream frame, dark glass), the roof
  for (const s of [-1, 1]) {
    k.box(0.06, 0.72, L, s * (w / 2), 1.2, zc, GREEN);
    k.box(0.08, 0.08, L + 0.04, s * (w / 2 + 0.01), 1.6, zc, YELLOW);
    k.box(0.05, 0.62, L, s * (w / 2), 1.95, zc, CREAM);
    for (let i = 0; i < 5; i++) k.box(0.03, 0.46, 0.62, s * (w / 2 + 0.02), 1.95, z0 + 0.45 + i * 0.8, GLASS);
    k.box(0.06, 0.26, L, s * (w / 2), 2.4, zc, GREEN_DARK); // the letter board (the route is painted on its own panel)
  }
  k.box(w, 1.7, 0.06, 0, 1.63, z1, GREEN); // front bulkhead
  k.box(0.9, 0.5, 0.04, 0, 1.95, z1 + 0.02, GLASS);
  // back: a door opening onto the platform
  for (const s of [-1, 1]) k.box(0.56, 1.7, 0.06, s * 0.58, 1.63, z0, GREEN);
  k.box(w, 0.3, 0.06, 0, 2.33, z0, GREEN);
  k.box(0.6, 1.4, 0.02, 0, 1.5, z0 + 0.05, [0.05, 0.05, 0.05]);
  // the roof, with a knifeboard seat along it and a rail round it
  k.box(w + 0.14, 0.08, L + 0.3, 0, 2.56, zc, ROOF);
  k.box(0.1, 0.5, L - 0.6, 0, 2.85, zc, BROWN);
  k.box(0.9, 0.06, L - 0.6, 0, 2.72, zc, BROWN);
  for (const s of [-1, 1]) {
    k.box(0.04, 0.04, L + 0.2, s * (w / 2 + 0.03), 2.95, zc, IRON);
    for (let i = 0; i <= 4; i++) k.box(0.03, 0.36, 0.03, s * (w / 2 + 0.03), 2.77, z0 - 0.05 + (i * (L + 0.1)) / 4, IRON);
  }
  // the back platform, its step and a hand rail, a ladder to the roof
  k.box(1.5, 0.08, 0.75, 0, 0.7, z0 - 0.4, BROWN);
  k.box(0.9, 0.05, 0.3, 0, 0.36, z0 - 0.85, BROWN);
  for (const s of [-1, 1]) k.box(0.04, 0.45, 0.04, s * 0.45, 0.55, z0 - 0.85, IRON);
  k.box(0.04, 1.9, 0.04, 0.72, 1.7, z0 - 0.75, IRON);
  for (let i = 0; i < 6; i++) k.box(0.3, 0.03, 0.03, -0.6, 0.95 + i * 0.33, z0 - 0.72, IRON);
  k.box(0.03, 2.1, 0.03, -0.75, 1.75, z0 - 0.72, IRON);
  k.box(0.03, 2.1, 0.03, -0.45, 1.75, z0 - 0.72, IRON);
  // the driver's box over the front wheels, the footboard, the dashboard, two lamps
  k.box(1.3, 0.12, 0.8, 0, 2.2, z1 + 0.35, BROWN);
  k.box(1.3, 0.35, 0.08, 0, 2.3, z1 - 0.02, BROWN);
  k.box(1.4, 0.06, 0.5, 0, 1.45, z1 + 0.95, BROWN);
  k.box(1.4, 0.55, 0.05, 0, 1.72, z1 + 1.2, [0.1, 0.1, 0.1]);
  for (const s of [-1, 1]) {
    k.box(0.14, 0.2, 0.14, s * 0.92, 2.0, z1 + 0.05, YELLOW);
    k.box(0.05, 0.9, 0.05, s * 0.6, 1.8, z1 + 0.5, IRON);
  }
  // rear springs and the rear axle boxes
  for (const s of [-1, 1]) k.box(0.1, 0.1, 1.2, s * 0.8, 0.72, 0, IRON);
  return k.build();
}

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

function postGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  k.box(0.1, 2.4, 0.1, 0, 1.2, 0, IRON);
  k.box(0.08, 0.36, 0.62, 0, 2.3, 0, CREAM);
  k.box(0.1, 0.4, 0.66, 0, 2.3, 0, GREEN_DARK);
  k.box(0.2, 0.1, 0.2, 0, 0.05, 0, IRON);
  return k.build();
}

function boardTexture(text: string, w = 512, h = 32): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2e3d33";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#e0cf9a";
  g.font = `bold ${Math.floor(h * 0.62)}px Georgia, serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ the omnibus

export function createOmnibus(scene: THREE.Scene, opts: OmnibusOptions): Omnibus {
  const group = new THREE.Group();
  group.name = "omnibus";
  scene.add(group);
  const loop = new Loop(ROUTE, 5);
  const watch = new Uint8Array(loop.x.length);
  for (let i = 0; i < loop.x.length; i++) watch[i] = opts.isFree(loop.x[i], loop.z[i], 0.5) ? 1 : 0;

  const wood = psx(new THREE.MeshLambertMaterial({ map: opts.tex.planks, vertexColors: true }));
  const body = new THREE.Mesh(bodyGeometry(), wood);
  // the route painted along both letter boards
  const boardMat = psx(new THREE.MeshLambertMaterial({ map: boardTexture("WERF  ·  STEENPLEIN  ·  VISMARKT  ·  RIJNKAAI  ·  PETIT BASSIN") }));
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 0.22), boardMat);
    b.position.set(s * 0.895, 2.4, 1.02);
    b.rotation.y = (s * Math.PI) / 2;
    body.add(b);
  }
  const rear = new THREE.Mesh(wheelsGeometry(R_REAR, 1.98), wood);
  const fore = new THREE.Mesh(foreGeometry(), wood);
  const front = new THREE.Mesh(wheelsGeometry(R_FRONT, 1.62), wood);
  front.position.set(0, R_FRONT, 0);
  fore.add(front);
  group.add(body, rear, fore);
  // the stop posts: one merged mesh
  {
    const g = postGeometry();
    const geos: THREE.BufferGeometry[] = [];
    for (const st of STOPS) {
      const c = g.clone();
      c.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.atan2(st.x - st.post[0], st.z - st.post[1]) + Math.PI / 2).setPosition(st.post[0], 0, st.post[1]));
      geos.push(c);
    }
    const posts = new THREE.Mesh(mergeAll(geos), wood);
    posts.name = "omnibus_posts";
    scene.add(posts);
  }
  let driver: Human | null = null;
  let conductor: Human | null = null;
  const driverG = new THREE.Group();
  const conductorG = new THREE.Group();
  body.add(driverG, conductorG);
  driverG.position.set(0.1, 0, 3.45);
  conductorG.position.set(0.5, 0.74, -1.5);
  conductorG.rotation.y = -0.6;

  // stops as arc positions (a stop on a stretch run both ways is served both ways)
  const stopAt: Array<{ s: number; stop: OmnibusStop }> = [];
  for (const st of STOPS) for (const s of loop.passes(st.x, st.z, 1.5)) stopAt.push({ s, stop: st });
  stopAt.sort((a, b) => a.s - b.s);

  const rects: Rect[] = [0, 1].map(() => ({ minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, top: 2.6 }));
  let s = stopAt.find((x) => x.stop.id === "werf")!.s - 30;
  let v = 0;
  let dwell = 0;
  let held = false;
  let at: OmnibusStop | null = null;
  let nextI = 0;
  let rollR = 0;
  let rollF = 0;
  let gait = 0;
  let waitWhy = "";
  const pa = { x: 0, z: 0 };
  const pb = { x: 0, z: 0 };
  const pc = { x: 0, z: 0 };

  /** The nearest stop ahead. */
  const findNext = () => {
    let best = Infinity;
    stopAt.forEach((x, i) => {
      const d = loop.wrap(x.s - s);
      if (d > 0.3 && d < best) {
        best = d;
        nextI = i;
      }
    });
  };
  findNext();

  const spans = new Map<object, Array<[number, number]>>();
  function spanOf(r: { minX: number; maxX: number; minZ: number; maxZ: number }): Array<[number, number]> {
    let sp = spans.get(r);
    if (sp) return sp;
    sp = [];
    let s0 = -1;
    for (let i = 0; i < loop.x.length; i++) {
      const inside = loop.x[i] > r.minX - 0.5 && loop.x[i] < r.maxX + 0.5 && loop.z[i] > r.minZ - 0.5 && loop.z[i] < r.maxZ + 0.5;
      if (inside && s0 < 0) s0 = i * Loop.STEP;
      if (!inside && s0 >= 0) {
        sp.push([s0, i * Loop.STEP]);
        s0 = -1;
      }
    }
    spans.set(r, sp);
    return sp;
  }

  /** The horses' noses: the front of the rig, ahead of the rear axle. */
  const NOSE = WHEELBASE + HORSES + 1.7;
  const TAIL = -2.3;

  function room(player: { x: number; z: number } | null): number {
    let lim = Infinity;
    waitWhy = "";
    const nose = s + NOSE;
    // the next stop
    const st = stopAt[nextI];
    const d = loop.wrap(st.s - s);
    if (d < lim) lim = d;
    // opening bridges not shut
    for (const br of opts.bridges()) {
      for (const [s0] of spanOf(br.rect)) {
        const ahead = loop.wrap(s0 - nose);
        // 8 m short: an open swing bridge lies on the quay beside its pit, across the lane
        if (ahead < 30 && !br.closed() && ahead - 8 < lim) {
          lim = Math.max(0, ahead - 8);
          waitWhy = "bridge";
        }
      }
    }
    // the player in the way; anything on the lane ahead
    if (player && !api.rider) {
      for (let dd = -1; dd <= 7; dd += 0.5) {
        loop.at(nose + dd, pa);
        if (Math.hypot(player.x - pa.x, player.z - pa.z) < 1.7) {
          lim = Math.min(lim, Math.max(0, dd - 7.5));
          waitWhy = "player";
          break;
        }
      }
    }
    // (its own boxes out of the way meanwhile: turned on a bend, they reach ahead of the noses)
    const keep = rects.map((r) => [r.minX, r.maxX]);
    for (const r of rects) r.minX = r.maxX = 1e6;
    for (const dd of [1.2, 2.6, 4]) {
      const i = Math.floor(loop.wrap(nose + dd) / Loop.STEP);
      if (!watch[i]) continue;
      if (!opts.isFree(loop.x[i], loop.z[i], 0.5)) {
        lim = Math.min(lim, Math.max(0, dd - 3));
        waitWhy = "blocked";
        break;
      }
    }
    rects.forEach((r, k) => ([r.minX, r.maxX] = keep[k]));
    return lim;
  }

  let near = true;
  const api: Omnibus = {
    rider: false,
    update(_t, dt, player, camera) {
      dt = Math.min(dt, 0.1);
      if (at) {
        v = 0;
        if (!held) dwell -= dt;
        if (dwell <= 0 && !held) {
          const was = at;
          at = null;
          nextI = (nextI + 1) % stopAt.length;
          api.onDepart?.(was, stopAt[nextI].stop);
        }
      } else {
        const r = room(player);
        // slow for the bends ahead
        let vmax = CRUISE;
        for (let dd = 0; dd <= 10; dd += 2) {
          const k = loop.curve(s + WHEELBASE + dd);
          if (k > 1e-3) vmax = Math.min(vmax, Math.sqrt(LAT / k) + dd * 0.15);
        }
        const want = r <= 0.01 ? 0 : Math.min(vmax, Math.sqrt(2 * BRAKE * r));
        v += THREE.MathUtils.clamp(want - v, -BRAKE * 2.5 * dt, ACCEL * dt);
        if (v < 0.01 && want === 0) v = 0;
        const ds = Math.min(v * dt, Math.max(0, r));
        s = loop.wrap(s + ds);
        rollR += ds / R_REAR;
        rollF += ds / R_FRONT;
        const st = stopAt[nextI];
        if (loop.wrap(st.s - s) < 0.05 || loop.wrap(st.s - s) > loop.length - 0.5) {
          at = st.stop;
          dwell = DWELL;
          v = 0;
          api.onArrive?.(st.stop);
        }
      }
      const trot = v > 1.9;
      gait = (gait + (v / (trot ? 2.8 : 1.35)) * dt * (trot ? 1.0 : 0.95)) % 1;

      // pose: the body from the rear axle to the pivot, the fore-carriage toward the horses
      loop.at(s, pa);
      loop.at(s + WHEELBASE, pb);
      loop.at(s + WHEELBASE + HORSES, pc);
      const yaw = Math.atan2(pb.x - pa.x, pb.z - pa.z);
      const foreYaw = Math.atan2(pc.x - pb.x, pc.z - pb.z);
      body.position.set(pa.x, 0, pa.z);
      body.rotation.y = yaw;
      // a little sway on the springs as the horses trot
      body.rotation.z = Math.sin(gait * Math.PI * 4) * 0.006 * Math.min(1, v / 2);
      body.position.y = Math.abs(Math.sin(gait * Math.PI * 2)) * 0.012 * Math.min(1, v / 2);
      rear.position.set(pa.x, R_REAR, pa.z);
      rear.rotation.set(rollR, yaw, 0, "YXZ");
      fore.position.set(pb.x, 0, pb.z);
      fore.rotation.y = foreYaw;
      front.rotation.x = rollF;
      const hy = loop.yaw(s + WHEELBASE + HORSES);
      const amp = Math.min(1, v / 0.8);
      const cy = Math.cos(hy);
      const sy = Math.sin(hy);
      for (const [k, side] of [[0, 0.55], [1, -0.55]] as const) {
        opts.horses.set(opts.horseIndex + k, pc.x + cy * side, pc.z - sy * side, hy, (gait + k * 0.08) % 1, amp, trot);
      }
      opts.horses.commit();

      // colliders: the saloon with its platform, the horses
      const box = (r: Rect, x: number, z: number, yw: number, hl: number, hw: number) => {
        const a = Math.abs(Math.sin(yw));
        const c = Math.abs(Math.cos(yw));
        r.minX = x - a * hl - c * hw;
        r.maxX = x + a * hl + c * hw;
        r.minZ = z - c * hl - a * hw;
        r.maxZ = z + c * hl + a * hw;
      };
      const mid = 1.0;
      box(rects[0], pa.x + Math.sin(yaw) * mid, pa.z + Math.cos(yaw) * mid, yaw, 3.1, 1.0);
      box(rects[1], pc.x, pc.z, hy, 1.6, 1.1);

      // the driver on his box, the conductor on the platform
      if (!driver) {
        driver = makeHuman("carter");
        if (driver) {
          driverG.add(driver.root);
          if (driver.canSit) driver.play("sit", 0);
          driver.root.position.y = 2.28 + driver.sitDrop(0);
        }
      }
      if (!conductor) {
        conductor = makeHuman("porter");
        if (conductor) conductorG.add(conductor.root);
      }
      // nobody stands where the rider stands
      conductorG.position.x = api.rider ? 0.62 : 0.5;
      const far = ((scene.fog as THREE.Fog | null)?.far ?? 40) + 30;
      const cam = camera?.position;
      near = !cam || Math.hypot(pa.x - cam.x, pa.z - cam.z) < far;
      group.visible = near;
      driverG.visible = conductorG.visible = near;
      opts.horses.show("omnibus", near);
      if (near) {
        driver?.update(dt);
        conductor?.update(dt);
      }
    },
    colliders: () => rects,
    busy(r) {
      // the rig from its tail to 10 m before the horses' noses, against the bridge's stretch
      const a = s + TAIL;
      const lr = NOSE - TAIL + 10;
      for (const [s0, s1] of spanOf(r)) {
        const b = s0 - 1;
        if (loop.wrap(b - a) < lr || loop.wrap(a - b) < s1 - s0 + 2) return true;
      }
      return false;
    },
    atStop: () => at,
    nextStop: () => stopAt[nextI].stop,
    hold(on) {
      held = on;
      if (!on && at) dwell = Math.max(dwell, 2.5);
    },
    platform() {
      const yaw = body.rotation.y;
      const b = -1.45;
      return { x: body.position.x + Math.sin(yaw) * b, y: 0.74 + body.position.y, z: body.position.z + Math.cos(yaw) * b, yaw, speed: v };
    },
    stepDown() {
      const yaw = body.rotation.y;
      const b = -2.6;
      return { x: body.position.x + Math.sin(yaw) * b, z: body.position.z + Math.cos(yaw) * b, yaw: yaw + Math.PI };
    },
    vehicles() {
      if (!near) return [];
      return [{ kind: "dray" as const, x: pc.x, z: pc.z, state: v > 0.1 ? "go" : "wait" }];
    },
    group,
    info() {
      return {
        s: +s.toFixed(1),
        at: [+pa.x.toFixed(1), +pa.z.toFixed(1)],
        v: +v.toFixed(2),
        stop: at?.id ?? null,
        next: stopAt[nextI].stop.id,
        dwell: +dwell.toFixed(1),
        held,
        wait: waitWhy,
        rider: api.rider,
        length: +loop.length.toFixed(0),
        stops: stopAt.map((x) => [x.stop.id, +x.s.toFixed(0)]),
      };
    },
    jumpTo(id, before = 20) {
      const st = stopAt.find((x) => x.stop.id === id);
      if (!st) return;
      s = loop.wrap(st.s - before);
      v = 0;
      at = null;
      held = false;
      findNext();
    },
  };
  return api;
}

function mergeAll(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const g of geos) n += g.getAttribute("position").count;
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "color"]) {
    const size = geos[0].getAttribute(name).itemSize;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.Float32BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}
