import { modelCollider, ModelCollision } from "./modelCollision";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { makeHuman, type Human, type HumanKind } from "../game/humans";
import { glowTexture } from "./textures";
import { lampFog } from "./lampFog";
import type { Rect } from "./geom";
import type { HorsePool } from "./horses";
import { Kit, type RGB } from "./kit";
import type { OpeningLike } from "./railway";
import { addProp } from "./propSpots";
import { lerpState, type NetMover } from "../net/mp/world";
import {
  absMinute,
  clockText,
  departures,
  LINES,
  lineTiming,
  linesAt as linesAtStop,
  loopPath,
  nextSlot,
  passes as loopPasses,
  STOPS,
  type LineDef,
  type OmnibusStop,
} from "../../../shared/omnibusLines";

// The horse omnibuses (M3g). Autumn 1873 had no tram on the river quays yet (Antwerp's first
// horse tram ran from 25 May 1873, Meir to Berchem; the harbour tramways came from 1881), but
// omnibuses had run between the harbour and the town since the 1830s (docs/milestones/M3g.md).
// Pair-horse omnibuses with a driver on the box and a conductor on the back platform, on the
// cobbles, no rails. Three lines (M7 omnibus routes, docs/milestones/M7-omnibus-routes.md), each
// with its colour and its destination board; the rounds are in shared/omnibusLines.ts:
//
//   KAAIEN (green, one omnibus): the Werf -> the Steenplein -> the Vismarkt -> the Rijnkaai ->
//     the Petit Bassin -> back along the Rijnkaai -> the Vismarkt -> the Steenplein -> round
//     behind the Werf.
//   GROTE MARKT (red, three): the Vismarkt -> the Vleeshuis -> the Grote Markt (by the town hall)
//     -> the Sint-Jorispoort -> the Stadspark -> the Cathedral (the Handschoenmarkt; the square
//     before the west portal kept free) -> the road to the Meir -> the Brouwersvliet -> the Vismarkt.
//   KEIZERSPOORT (blue, two, M7): the Keizerspoort -> Sint-Paulus -> the Keizerstraat -> the
//     Conscienceplein -> the road to the Meir -> Sint-Jacob -> the Kipdorppoort -> the Ramparts.
//
// Changes: at the Vismarkt (two bays, a short walk apart) and at the road to the Meir (one bay for
// both town lines): free on one ticket (server/src/ride.ts). The rounds are one way: in the wide
// streets a line keeps to its own lane each way, so two omnibuses never meet head-on; one that
// catches up waits behind the other, at a stop too. Each stop post carries its name and a plate in
// the colour of every line that calls there; most have a bench, and people wait there by day.
// Two carriage lamps, lit after dusk.
//
// M7 timetable (the engine's numbers, shared/omnibusLines.ts): each line leaves its terminus at
// fixed times from 6:00 to 22:00, one omnibus each headway; an omnibus that comes round early
// waits there, and after the last round they all stand at the terminus till morning.
//
// It stops at every stop for a few seconds, longer while someone gets on or off (game/ride.ts:
// E at the back platform). It stops for the player in its way, for people and anything on its
// lane, and before an opening bridge that is not shut.
//
// Cheap: all omnibuses share one InstancedMesh per part (body, paint, wheels, front carriage),
// one mesh for all the boards, one for the lamp glass, one point set for the lamp glow, one for
// the stop posts: nine draw calls for every omnibus, plus the driver and conductor near you.

type P = [number, number];

// M7 omnibus routes: the lines, rounds, stops and the timetable live in shared/omnibusLines.ts (the
// server reads them too: the fares, the timetable at the posts, the lanes parked carts keep off).
export { LINES, STOPS, type LineDef, type OmnibusStop } from "../../../shared/omnibusLines";

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
  /** M7 timetable: standing at its terminus till a later departure (null: not waiting on the timetable); `night`: laid up till the morning. */
  due(): { at: number; night: boolean } | null;
  /** Someone rides: it no longer waits for "the player in the way". */
  rider: boolean;
  /** Where a rider stands on the back platform (feet), the way the omnibus points, its speed. */
  platform(): { x: number; y: number; z: number; yaw: number; speed: number };
  /** The foot of the step behind the platform (world), and the way out (yaw). */
  stepDown(): { x: number; z: number; yaw: number };
  /** The body's frame: its origin (the ground under the rear axle), the way it points, its speed. */
  pose(): { x: number; y: number; z: number; yaw: number; speed: number };
  /** A rider's step in the body frame from (fx, fz) toward (x, z): kept to the platform, the doorway and the aisle. */
  walk(fx: number, fz: number, x: number, z: number): [number, number];
  /** The floor under a spot in the body frame (the platform, the saloon). */
  floorAt(x: number, z: number): number;
  /** Who has seat i (SEATS): the player, a passenger, or nobody. */
  seatTaken(i: number): "player" | "passenger" | null;
  /** The player takes seat i (true if it was free), or gives it up (null). */
  takeSeat(i: number, who: "player" | null): boolean;
  info(): Record<string, unknown>;
}

/**
 * M8b: the omnibuses' state as the world PC sends it (net/mp/world.ts). Per omnibus (by its index,
 * the same on every PC): `s` along its round (it wraps: netLerp goes the short way), its speed,
 * standing at a stop or not, and (not eased) the stop it stands at or goes to next (its index in
 * the round's stops), the dwell left, the departure it waits for, the metres still to back, why it
 * waits. `_slots`: the last departure each line took from its terminus (a takeover goes on from them).
 */
export interface OmnibusNet {
  /**
   * (sync pass 2) `_a`: the nameless passengers aboard, [net id, seat, kind (NET_KINDS index)]; `_r`: the townspeople
   * aboard, [id, seat (-1, -2: standing on the platform), kind, their stop].
   */
  b: Array<{ id: number; s: number; v: number; at: boolean; _n: number; _dw: number; _dep: number | null; _bk: number; _w: string; _a?: number[][]; _r?: Array<Array<string | number>> }>;
  _slots: Array<[string, number]>;
  /** (sync pass 2) The people waiting at the stops: [net id, post index, slot, kind (NET_KINDS index), omnibus they go to or -1]. */
  _wt?: number[][];
}

/** All the omnibuses. */
export interface Omnibuses extends NetMover<OmnibusNet> {
  buses: Omnibus[];
  update(t: number, dt: number, player: { x: number; z: number } | null, camera?: THREE.Camera): void;
  colliders(): Rect[];
  /** The path check (rijnkaai.ts reachFrom): the rects of omnibuses on their round, which pass a door by; one standing at its terminus on the timetable is left out. */
  rolling(): Rect[];
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
  /**
   * M6 transport: a townsperson gets on this omnibus (standing at a stop) to ride to the stop
   * `alight` of its line (game/journeys.ts); no fare for residents. False: no room. They walk up
   * the step and sit (a woman stands on the platform: no seat for a skirt in our clips).
   */
  boardResident(bus: Omnibus, who: { id: string; kind: HumanKind }, alight: string): boolean;
  /** M6: a townsperson got off at their stop and stands at the foot of the step. */
  onResidentOff?: (bus: Omnibus, id: string, at: { x: number; z: number; yaw: number }) => void;
  /**
   * Sync pass 2, the world PC: another PC's trip puts townsperson `id` on omnibus `bus` (its index), to ride to
   * `alight` (a stop of its round): he boards here, and every PC draws him from this PC's state.
   */
  netBoard(bus: number, id: string, kind: string, alight: string): void;
  /** M6: the townspeople riding now: who, on which omnibus, to which stop. */
  residents(): Array<{ id: string; bus: number; alight: string; seated: boolean }>;
  /** M6: no nameless passengers (the town's own people ride instead). */
  anonymous: boolean;
  /** M7 timetable: the game clock (set by main). Without it the omnibuses run without a timetable. */
  clock?: () => { day: number; hour: number };
  /** M7: where the player looks from (set by main; the kit's runs pass no camera): people wait at the stops near it. */
  eye?: () => { x: number; z: number };
  /**
   * Sync pass 2 (set by main when played together): where the other players stand. The world PC lets people wait
   * at the stops near any player (the others show its waiters and passengers from its state).
   */
  others?: () => Array<{ x: number; z: number }>;
  /** M7: the lines at a stop and the next times their omnibuses are due there (the shared timetable, by the game clock). */
  timetable(stop: string): Array<{ line: LineDef; next: string[]; headwayMin: number }>;
  /** M7 dev: drive every round with the whole rig (body, wheels, horses) against the walls and fixed things; [] is clean. */
  sweep(): Array<{ line: string; x: number; z: number; what: string }>;
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
  /** M6 handcart: is (x, z) on the goods train's band (the quay railway)? The omnibus crosses it only when the train is not coming. */
  onRails?: (x: number, z: number) => boolean;
  /** M6 handcart: is the goods train on or coming up to this stretch (railway.ts busy)? The train has the right of way. */
  trainBusy?: (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => boolean;
}

/** M6 handcart: held up this long by another vehicle, an omnibus backs off (s); face to face with the train in its lane, sooner. */
const BACK_AFTER_S = 60;
const BACK_AFTER_TRAIN_S = 8;
/** How far it backs (m), and how fast (m/s). */
const BACK_M = 9;
const BACK_V = 0.9;

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
    const path = loopPath(corners, radius);
    const xs = path.x;
    const zs = path.z;
    this.x = xs;
    this.z = zs;
    this.length = path.length;
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
    return loopPasses(this, x, z, r);
  }
}

// ------------------------------------------------------------------ the model (code-built)

const CREAM: RGB = [0.86, 0.8, 0.64];
const IRON: RGB = [0.18, 0.17, 0.16];
const YELLOW: RGB = [0.72, 0.56, 0.22];
const BROWN: RGB = [0.45, 0.33, 0.24];
const ROOF: RGB = [0.35, 0.34, 0.33];
const VELVET: RGB = [0.5, 0.2, 0.17];
const STRAW: RGB = [0.8, 0.68, 0.36];
const CEILING: RGB = [0.78, 0.74, 0.62];
/** The paint takes the line's colour (instance colour times this). */
const PAINT: RGB = [1, 1, 1];
const PAINT_DARK: RGB = [0.62, 0.62, 0.62];

const Z0 = -1.05; // back of the saloon
const Z1 = 3.1; // front of the saloon
const W = 1.72;
/** Heights (body frame): the saloon floor, the window openings, the letter board, the roof. */
const FLOOR_Y = 0.83;
const WIN_LO = 1.66;
const WIN_HI = 2.24;
const BOARD_Y = 2.61;
const ROOF_Y = 2.78;
const TOP = 2.74; // top of the walls
const DOOR = 0.3; // half width of the rear doorway
const DOOR_TOP = 2.3;
/** The five side windows: their middles along z. */
const WINDOWS = [0, 1, 2, 3, 4].map((i) => Z0 + 0.45 + i * 0.8);
const WIN_W = 0.62;

/** Body frame: +z forward, y up, origin on the ground under the rear axle. `paint`: the panels only. */
function bodyGeometry(paint: boolean): THREE.BufferGeometry {
  const k = new Kit();
  const L = Z1 - Z0;
  const zc = (Z0 + Z1) / 2;
  const wallH = TOP - FLOOR_Y;
  if (paint) {
    for (const s of [-1, 1]) {
      k.box(0.06, 0.74, L, s * (W / 2), 1.21, zc, PAINT);
      k.box(0.06, 0.26, L, s * (W / 2), BOARD_Y, zc, PAINT_DARK); // behind the letter board
    }
    // front bulkhead round its window; back panels either side of the doorway, and over it
    k.box(W, WIN_LO - FLOOR_Y, 0.06, 0, (FLOOR_Y + WIN_LO) / 2, Z1, PAINT);
    for (const s of [-1, 1]) k.box(W / 2 - 0.45, WIN_HI - WIN_LO, 0.06, s * (0.45 + (W / 2 - 0.45) / 2), (WIN_LO + WIN_HI) / 2, Z1, PAINT);
    k.box(W, TOP - WIN_HI, 0.06, 0, (WIN_HI + TOP) / 2, Z1, PAINT);
    for (const s of [-1, 1]) k.box(W / 2 - DOOR, wallH, 0.06, s * (DOOR + (W / 2 - DOOR) / 2), FLOOR_Y + wallH / 2, Z0, PAINT);
    k.box(2 * DOOR, TOP - DOOR_TOP, 0.06, 0, (DOOR_TOP + TOP) / 2, Z0, PAINT);
    return k.build();
  }
  // floor and underframe, the perch to the front carriage
  k.box(W, 0.1, L, 0, FLOOR_Y - 0.05, zc, BROWN);
  k.box(0.14, 0.12, 3.6, 0, 0.62, 1.2, IRON);
  // the waist rail, the window band: sill, pillars, header; open windows with small panes
  for (const s of [-1, 1]) {
    const x = s * (W / 2);
    k.box(0.08, 0.08, L + 0.04, x + s * 0.01, 1.6, zc, YELLOW);
    k.box(0.07, 0.05, L, x, WIN_LO - 0.02, zc, CREAM);
    k.box(0.06, TOP - WIN_HI - 0.26, L, x, (WIN_HI + BOARD_Y - 0.13) / 2, zc, CREAM);
    for (let i = 0; i <= WINDOWS.length; i++) {
      const za = i === 0 ? Z0 : WINDOWS[i - 1] + WIN_W / 2;
      const zb = i === WINDOWS.length ? Z1 : WINDOWS[i] - WIN_W / 2;
      if (zb - za > 0.01) k.box(0.06, WIN_HI - WIN_LO, zb - za, x, (WIN_LO + WIN_HI) / 2, (za + zb) / 2, CREAM);
    }
    for (const z of WINDOWS) {
      // glazing bars: four small panes
      k.box(0.025, WIN_HI - WIN_LO, 0.025, x, (WIN_LO + WIN_HI) / 2, z, BROWN);
      k.box(0.025, 0.025, WIN_W, x, (WIN_LO + WIN_HI) / 2 + 0.04, z, BROWN);
    }
  }
  // the front window's bars
  k.box(0.025, WIN_HI - WIN_LO, 0.03, 0, (WIN_LO + WIN_HI) / 2, Z1, BROWN);
  k.box(0.9, 0.025, 0.03, 0, (WIN_LO + WIN_HI) / 2 + 0.04, Z1, BROWN);
  // the roof, with a knifeboard seat along it (back to back) and a rail round it
  k.box(W + 0.14, 0.08, L + 0.3, 0, ROOF_Y, zc, ROOF);
  k.box(0.1, 0.5, L - 0.6, 0, ROOF_Y + 0.29, zc, BROWN);
  k.box(0.9, 0.06, L - 0.6, 0, ROOF_Y + 0.16, zc, BROWN);
  for (const s of [-1, 1]) {
    k.box(0.04, 0.04, L + 0.2, s * (W / 2 + 0.03), ROOF_Y + 0.39, zc, IRON);
    for (let i = 0; i <= 4; i++) k.box(0.03, 0.36, 0.03, s * (W / 2 + 0.03), ROOF_Y + 0.21, Z0 - 0.05 + (i * (L + 0.1)) / 4, IRON);
  }
  // the back platform, its step and a hand rail, the ladder to the roof
  k.box(1.5, 0.08, 0.75, 0, 0.7, Z0 - 0.4, BROWN);
  k.box(0.9, 0.05, 0.3, 0, 0.36, Z0 - 0.85, BROWN);
  for (const s of [-1, 1]) k.box(0.04, 0.45, 0.04, s * 0.45, 0.55, Z0 - 0.85, IRON);
  k.box(0.04, 2.1, 0.04, 0.72, 1.8, Z0 - 0.75, IRON);
  for (let i = 0; i < 7; i++) k.box(0.3, 0.03, 0.03, -0.6, 0.95 + i * 0.33, Z0 - 0.72, IRON);
  k.box(0.03, 2.4, 0.03, -0.75, 1.95, Z0 - 0.72, IRON);
  k.box(0.03, 2.4, 0.03, -0.45, 1.95, Z0 - 0.72, IRON);
  // the driver's box over the front wheels, the footboard, the dashboard, two lamp cases
  k.box(1.3, 0.12, 0.8, 0, 2.2, Z1 + 0.35, BROWN);
  k.box(1.3, 0.35, 0.08, 0, 2.3, Z1 + 0.06, BROWN);
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

/** The saloon inside: benches in velvet, straw on the floor, a ceiling, the check-string, the oil lamp. */
function interiorGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const za = Z0 + 0.1;
  const zb = Z1 - 0.1;
  const L = zb - za;
  const zc = (za + zb) / 2;
  for (const s of [-1, 1]) {
    k.box(0.42, 0.09, L, s * 0.62, FLOOR_Y + 0.38, zc, VELVET); // the seat
    k.box(0.03, 0.34, L, s * 0.42, FLOOR_Y + 0.17, zc, BROWN); // the front board under it
    k.box(0.07, 0.46, L, s * 0.8, FLOOR_Y + 0.68, zc, VELVET); // the back, against the wall
    for (let i = 0; i <= 6; i++) k.box(0.4, 0.02, 0.03, s * 0.62, FLOOR_Y + 0.435, za + (i * L) / 6, [0.35, 0.14, 0.12]); // seams
  }
  // straw on the floor, a few loose wisps
  k.box(0.8, 0.015, L, 0, FLOOR_Y + 0.008, zc, STRAW);
  let seed = 7;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 26; i++) k.box(0.25, 0.012, 0.03, (r() - 0.5) * 0.7, FLOOR_Y + 0.02, za + r() * L, [0.86, 0.74, 0.4], r() * Math.PI);
  // the ceiling boards, the check-string to the driver along it
  k.box(W - 0.1, 0.02, L + 0.18, 0, TOP - 0.03, zc, CEILING);
  k.box(0.012, 0.012, L + 0.1, 0.35, TOP - 0.12, zc, [0.6, 0.5, 0.35]);
  k.box(0.012, 0.25, 0.012, 0.35, TOP - 0.25, Z0 + 0.25, [0.6, 0.5, 0.35]); // its end, to pull
  // the oil lamp on the front bulkhead, and its bracket
  k.box(0.04, 0.04, 0.16, 0, 2.43, Z1 - 0.1, IRON);
  k.box(0.14, 0.2, 0.14, 0, 2.3, Z1 - 0.16, YELLOW);
  // the doorway's posts
  for (const s of [-1, 1]) k.box(0.06, DOOR_TOP - FLOOR_Y, 0.08, s * DOOR, (FLOOR_Y + DOOR_TOP) / 2, Z0, BROWN);
  return k.build();
}

/** Dark glass in the windows and the doorway, for an omnibus seen from afar (its saloon is not drawn then). */
function farGlassGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const G: RGB = [0.06, 0.065, 0.075];
  for (const s of [-1, 1]) for (const z of WINDOWS) k.box(0.02, WIN_HI - WIN_LO, WIN_W, s * (W / 2 - 0.01), (WIN_LO + WIN_HI) / 2, z, G);
  k.box(0.9, WIN_HI - WIN_LO, 0.02, 0, (WIN_LO + WIN_HI) / 2, Z1 - 0.01, G);
  k.box(2 * DOOR, DOOR_TOP - FLOOR_Y, 0.02, 0, (FLOOR_Y + DOOR_TOP) / 2, Z0 + 0.02, G);
  return k.build();
}

/** Where the lamp glass sits (body frame): the two carriage lamps, the oil lamp inside. */
const LAMPS: Array<[number, number, number]> = [
  [-0.92, 2.0, Z1 + 0.11],
  [0.92, 2.0, Z1 + 0.11],
  [0, 2.3, Z1 - 0.24],
];

/** A seat: where you sit (body frame, on the seat's top), the way you face (body yaw), inside or on the roof. */
export interface OmnibusSeat {
  x: number;
  y: number;
  z: number;
  face: number;
  roof: boolean;
}
/** Six a side inside, facing across; four a side on the roof's knifeboard, back to back, facing out. */
export const SEATS: OmnibusSeat[] = [
  ...[-1, 1].flatMap((s) => [0, 1, 2, 3, 4, 5].map((i) => ({ x: s * 0.6, y: FLOOR_Y + 0.43, z: Z0 + 0.42 + i * 0.64, face: -s * (Math.PI / 2), roof: false }))),
  ...[-1, 1].flatMap((s) => [0, 1, 2, 3].map((i) => ({ x: s * 0.32, y: ROOF_Y + 0.19, z: Z0 + 0.55 + i * 0.95, face: s * (Math.PI / 2), roof: true }))),
];
/** Where a rider may stand: the back platform, the doorway, the aisle (body frame). */
const WALK = {
  platform: { minX: -0.55, maxX: 0.55, minZ: Z0 - 0.72, maxZ: Z0 - 0.12 },
  door: { minX: -DOOR + 0.12, maxX: DOOR - 0.12, minZ: Z0 - 0.2, maxZ: Z0 + 0.15 },
  aisle: { minX: -0.26, maxX: 0.26, minZ: Z0 + 0.1, maxZ: Z1 - 0.25 },
};
/** Floor heights: the platform, the saloon. */
const PLATFORM_Y = 0.74;
/** Where a rider stands on getting on (body frame), and where the roof ladder is (on the platform). */
export const PLATFORM_SPOT: [number, number] = [0, Z0 - 0.45];
export const LADDER_SPOT: [number, number] = [-0.45, Z0 - 0.55];

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

// ------------------------------------------------------------------ M7: the stops (post, name, timetable, bench)

interface StopPost {
  id: string;
  /** The name on the sign. */
  label: string;
  x: number;
  z: number;
  /** The post's turn (its sign's faces look along the lane's normal; local -x faces the lane). */
  yaw: number;
  /** Toward the lane (unit). */
  toLane: P;
  bench?: [number, number, number];
}

/** One post per spot (bays of two lines at one spot share it). */
function stopPosts(): StopPost[] {
  const out: StopPost[] = [];
  for (const st of STOPS) {
    const had = out.find((p) => Math.hypot(p.x - st.post[0], p.z - st.post[1]) < 0.3);
    if (had) {
      had.bench ??= st.bench;
      continue;
    }
    const dx = st.x - st.post[0];
    const dz = st.z - st.post[1];
    const L = Math.hypot(dx, dz) || 1;
    const label = (st.id === "meir" ? "Meir" : st.name.replace(/^the /, "")).toUpperCase();
    out.push({ id: st.id, label, x: st.post[0], z: st.post[1], yaw: Math.atan2(dx, dz) + Math.PI / 2, toLane: [dx / L, dz / L], bench: st.bench });
  }
  return out;
}

/** A park bench: two cast-iron ends, a slatted seat and back. Body frame: it faces +z, 1.5 m long along x. */
function benchGeometry(): THREE.BufferGeometry {
  const k = new Kit();
  const WOOD: RGB = [0.42, 0.3, 0.2];
  for (const x of [-0.68, 0.68]) {
    k.box(0.05, 0.44, 0.06, x, 0.22, 0.16, IRON); // front leg
    k.box(0.05, 0.84, 0.06, x, 0.42, -0.17, IRON, 0, -0.12); // back leg and back stand
    k.box(0.05, 0.05, 0.42, x, 0.43, 0, IRON); // the arm under the seat
    k.box(0.05, 0.05, 0.32, x, 0.66, 0.02, IRON); // the armrest
  }
  for (let i = 0; i < 4; i++) k.box(1.5, 0.03, 0.08, 0, 0.46, 0.14 - i * 0.095, WOOD); // seat slats
  for (let i = 0; i < 3; i++) k.box(1.5, 0.08, 0.025, 0, 0.6 + i * 0.12, -0.2 - i * 0.015, WOOD, 0, -0.12); // back slats
  return k.build();
}

/** Solid boxes for the benches (the posts are added by rijnkaai.ts from STOPS). */
export function stopSolids(): Rect[] {
  const out: Rect[] = [];
  const geometry = benchGeometry();
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const shape = new ModelCollision([g.getAttribute("position").array]);
  for (const pt of stopPosts()) {
    if (!pt.bench) continue;
    const [x, z, yaw] = pt.bench;
    out.push(modelCollider(shape, x, z, yaw));
  }

  return out;
}

const minutesText = (m: number): string => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`);

/** The names on the signs (both faces) and a timetable plate on the lane side of each post: one mesh, one canvas. */
function signMesh(posts: StopPost[]): THREE.Mesh | null {
  if (!posts.length || typeof document === "undefined") return null;
  const CW = 128;
  const NH = 64;
  const TH = 160;
  const cols = 2;
  const rows = Math.ceil(posts.length / cols);
  const c = document.createElement("canvas");
  c.width = CW * cols;
  c.height = (NH + TH) * rows;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const cell = (i: number) => [(i % cols) * CW, Math.floor(i / cols) * (NH + TH)] as const;
  posts.forEach((pt, i) => {
    const [x0, y0] = cell(i);
    // the name: dark letters on the cream enamel, a thin border
    g.fillStyle = "#e6dbbd";
    g.fillRect(x0, y0, CW, NH);
    g.strokeStyle = "#2a2622";
    g.lineWidth = 3;
    g.strokeRect(x0 + 3, y0 + 3, CW - 6, NH - 6);
    g.fillStyle = "#231f1b";
    const words = pt.label.split(/[ -]/);
    const two = pt.label.length > 10 && words.length > 1;
    g.font = `bold ${two ? 20 : pt.label.length > 9 ? 17 : 22}px "Scheldemist Print", Georgia, serif`;
    if (two) {
      const half = Math.ceil(words.length / 2);
      g.fillText(words.slice(0, half).join(" "), x0 + CW / 2, y0 + NH * 0.34, CW - 12);
      g.fillText(words.slice(half).join(" "), x0 + CW / 2, y0 + NH * 0.7, CW - 12);
    } else g.fillText(pt.label, x0 + CW / 2, y0 + NH / 2 + 1, CW - 12);
    // the timetable: each line that calls, how often, the first and the last omnibus here
    const ty = y0 + NH;
    g.fillStyle = "#ece3c8";
    g.fillRect(x0, ty, CW, TH);
    g.strokeStyle = "#3a332c";
    g.lineWidth = 2;
    g.strokeRect(x0 + 2, ty + 2, CW - 4, TH - 4);
    g.fillStyle = "#231f1b";
    g.font = "bold 13px 'Scheldemist Print', Georgia, serif";
    g.fillText("OMNIBUS", x0 + CW / 2, ty + 13, CW - 10);
    let y = ty + 26;
    for (const l of linesAtStop(pt.id)) {
      const t = lineTiming(l.id);
      const off = t.offsetMin[pt.id] ?? 0;
      const [r, gg, bb] = l.colour.map((v) => Math.round(v * 200));
      g.fillStyle = `rgb(${r},${gg},${bb})`;
      g.fillRect(x0 + 6, y, CW - 12, 16);
      g.fillStyle = "#f1e6c4";
      g.font = "bold 11px 'Scheldemist Print', Georgia, serif";
      g.fillText(l.board, x0 + CW / 2, y + 8.5, CW - 16);
      g.fillStyle = "#231f1b";
      g.font = "11px 'Scheldemist Print', Georgia, serif";
      g.fillText(`every ${minutesText(t.headwayMin)}`, x0 + CW / 2, y + 26, CW - 10);
      const first = clockText(6 * 60 + off);
      let last = 6 * 60;
      while (last + t.headwayMin <= 22 * 60) last += t.headwayMin;
      g.fillText(`${first} to ${clockText(last + off)}`, x0 + CW / 2, y + 40, CW - 10);
      y += 52;
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  // the quads: per post, the name on both faces of the sign (local x = +-0.061), the plate on the lane side
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const quad = (pt: StopPost, lx: number, cy: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number) => {
    // local x = lx faces out along sign(lx); "right" as seen from that side: -z for +x, +z for -x
    const cs = Math.cos(pt.yaw);
    const sn = Math.sin(pt.yaw);
    const world = (x: number, z: number): P => [pt.x + x * cs + z * sn, pt.z - x * sn + z * cs];
    const rz = lx > 0 ? -1 : 1;
    const nx = Math.sign(lx) * cs;
    const nz = -Math.sign(lx) * sn;
    const corner = (su: number, sv: number, u: number, v: number) => {
      const [wx, wz] = world(lx, rz * su * (w / 2));
      pos.push(wx, cy + sv * (h / 2), wz);
      nor.push(nx, 0, nz);
      uv.push(u, v);
    };
    corner(-1, -1, u0, v0);
    corner(1, -1, u1, v0);
    corner(1, 1, u1, v1);
    corner(-1, -1, u0, v0);
    corner(1, 1, u1, v1);
    corner(-1, 1, u0, v1);
  };
  posts.forEach((pt, i) => {
    const [x0, y0] = cell(i);
    const u0 = x0 / c.width;
    const u1 = (x0 + CW) / c.width;
    const vn1 = 1 - y0 / c.height;
    const vn0 = 1 - (y0 + NH) / c.height;
    const vt1 = vn0;
    const vt0 = 1 - (y0 + NH + TH) / c.height;
    for (const lx of [0.062, -0.062]) quad(pt, lx, 2.45, 0.54, 0.28, u0, vn0, u1, vn1);
    quad(pt, -0.06, 1.12, 0.3, 0.375, u0, vt0, u1, vt1);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(geo, psx(new THREE.MeshLambertMaterial({ map: tex })));
  m.name = "omnibus_signs";
  return m;
}

/** Advertisements over the windows inside (plain English; the names are names). */
const ADS = ["JENEVER  DE KUYPER", "SOAP  ·  DE WINTER", "COFFEE AND TEA  ·  PEETERS", "PIPE TOBACCO  ·  VAN ROMPAEY"];

/** Two rows per line (the side board with the stops, the destination board), and a row of four advertisements. */
function boardAtlas(): { tex: THREE.CanvasTexture; rows: number; adRow: number } {
  const w = 512;
  const h = 32;
  const adRow = LINES.length * 2;
  const rows = adRow + 1;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h * rows;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  LINES.forEach((l, i) => {
    for (const [r, text, size] of [[i * 2, l.sideBoard, 0.6], [i * 2 + 1, l.board, 0.78]] as const) {
      const [cr, cg, cb] = l.colour.map((v) => Math.round(v * 120));
      g.fillStyle = `rgb(${cr},${cg},${cb})`;
      g.fillRect(0, r * h, w, h);
      g.fillStyle = "#e8d8a0";
      g.font = `bold ${Math.floor(h * size)}px "Scheldemist Print", Georgia, serif`;
      g.fillText(text, w / 2, r * h + h / 2 + 1, w - 12);
    }
  });
  // the advertisements: enamel colours, a thin border
  const bg = ["#233a2c", "#e9dfc4", "#5a2a1e", "#1f2c44"];
  const fg = ["#e8d49a", "#2a2a2a", "#f0e2b0", "#e6d7a8"];
  ADS.forEach((text, i) => {
    const x0 = i * 128;
    g.fillStyle = bg[i];
    g.fillRect(x0, adRow * h, 128, h);
    g.strokeStyle = fg[i];
    g.strokeRect(x0 + 2.5, adRow * h + 2.5, 123, h - 5);
    g.fillStyle = fg[i];
    g.font = `bold ${Math.floor(h * 0.36)}px "Scheldemist Print", Georgia, serif`;
    const [a, b] = text.split("  ·  ");
    if (b) {
      g.fillText(a, x0 + 64, adRow * h + h * 0.34, 118);
      g.fillText(b, x0 + 64, adRow * h + h * 0.72, 118);
    } else g.fillText(a, x0 + 64, adRow * h + h / 2 + 1, 118);
  });
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return { tex: t, rows, adRow };
}

interface Board {
  c: [number, number, number];
  /** The way "right" runs across the text (reads left to right from where it is seen). */
  right: [number, number, number];
  n: [number, number, number];
  w: number;
  h: number;
  /** 0: side board, 1: destination board, "ad": advertisement number `ad`. */
  row: 0 | 1 | "ad";
  ad?: number;
}

/** The boards in the body frame: the line's outside, the advertisements inside over the windows. */
const BOARDS: Board[] = [
  { c: [-(W / 2 + 0.035), BOARD_Y, 1.02], right: [0, 0, 1], n: [-1, 0, 0], w: 4.0, h: 0.22, row: 0 },
  { c: [W / 2 + 0.035, BOARD_Y, 1.02], right: [0, 0, -1], n: [1, 0, 0], w: 4.0, h: 0.22, row: 0 },
  { c: [0, ROOF_Y + 0.18, Z1 + 0.2], right: [1, 0, 0], n: [0, 0, 1], w: 1.5, h: 0.26, row: 1 },
  { c: [0, ROOF_Y + 0.18, Z0 - 0.2], right: [-1, 0, 0], n: [0, 0, -1], w: 1.5, h: 0.26, row: 1 },
  ...[-1, 1].flatMap((s) =>
    WINDOWS.map((z, i): Board => ({ c: [s * (W / 2 - 0.035), 2.37, z], right: [0, 0, s], n: [-s, 0, 0], w: WIN_W, h: 0.17, row: "ad", ad: (i + (s > 0 ? 2 : 0)) % ADS.length })),
  ),
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
  taken: Array<"player" | "passenger" | null>;
  passengers: Passenger[];
  /** M6 handcart: stretches of its round on the train's band (s of the nose going in and out, and their box). */
  zones: Array<{ s0: number; s1: number; rect: Rect }>;
  /** Seconds held up by a thing or the train, metres still to back off, and how often it backed. */
  blockT: number;
  backM: number;
  backs: number;
  /** M7 timetable: the departure it waits for at its terminus (absolute game minutes), or null. */
  departAt: number | null;
  /** M8b: a state from the world PC taken yet; placed by netApply this frame. */
  netSeen: boolean;
  /**
   * Sync pass 2, run by another PC: the townspeople this PC's own trips put on this omnibus (id: their stop). They
   * ride here in the book only (journeys.ts asks residents()); the world PC boards them for all to see (netAsk
   * "bus_board"), and they step off here at their stop.
   */
  riders: Map<string, string>;
  netPlaced: boolean;
}

interface Passenger {
  human: Human;
  g: THREE.Group;
  seat: number;
  state: "in" | "seated" | "out";
  path: P[];
  t: number;
  /** M6: a townsperson of the town, riding to their stop (-1 seat: standing on the platform). */
  who?: { id: string; alight: string };
  /** Sync pass 2: a nameless passenger's number, the same on every PC (the world PC's; see OmnibusNet). */
  nid?: number;
  /** Sync pass 2: drawn here from the world PC's list (his trip is another PC's: no step-off news from here). */
  mirror?: boolean;
  /** Sync pass 2, the world PC: boarded at another PC's asking (that PC's trip hears of his step off, not this one's). */
  asked?: boolean;
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
  /** M7 timetable: the last departure each line's omnibuses took from its terminus (absolute game minutes). */
  const lastSlot = new Map<string, number>();
  /** The game clock now (absolute game minutes), or null without a clock. */
  const nowMin = (): number | null => {
    const c = api.clock?.();
    return c ? absMinute(c.day, 0) + c.hour * 60 : null;
  };
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
        // (the horses' step: by the omnibus's number, the same on every PC)
        gait: (buses.length * 0.618) % 1,
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
        zones: railZones(loop),
        blockT: 0,
        departAt: null,
        backM: 0,
        backs: 0,
        netSeen: false,
        riders: new Map(),
        netPlaced: false,
        taken: SEATS.map(() => null),
        passengers: [],
        pose: () => ({ x: b.frame.position.x, y: b.frame.position.y, z: b.frame.position.z, yaw: b.yaw, speed: b.v }),
        walk(fx, fz, x, z) {
          const inside = (px: number, pz: number) =>
            Object.values(WALK).some((r) => px >= r.minX && px <= r.maxX && pz >= r.minZ && pz <= r.maxZ);
          if (inside(x, z)) return [x, z];
          if (inside(x, fz)) return [x, fz];
          if (inside(fx, z)) return [fx, z];
          return [fx, fz];
        },
        floorAt: (_x, z) => (z < Z0 - 0.1 ? PLATFORM_Y : FLOOR_Y),
        seatTaken: (i) => b.taken[i] ?? null,
        takeSeat(i, who) {
          if (who === null) {
            b.taken = b.taken.map((t) => (t === "player" ? null : t));
            return true;
          }
          if (b.taken[i]) return false;
          b.taken = b.taken.map((t) => (t === "player" ? null : t));
          b.taken[i] = "player";
          return true;
        },
        rider: false,
        atStop: () => b.at,
        nextStop: () => b.stopAt[b.nextI].stop,
        hold(on) {
          // (M8b: run by the world PC: it is asked to hold its bus for this rider; this copy holds too, so the
          // rider's own view does not run on)
          if (api.netRemote) api.netAsk?.("bus_hold", [b.index, on]);
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
        due() {
          const now = nowMin();
          if (!b.at || b.departAt === null || now === null || b.departAt <= now) return null;
          return { at: b.departAt, night: b.departAt - now > 120 };
        },
        info() {
          return {
            line: l.id,
            due: b.departAt === null ? null : clockText(b.departAt),
            s: +b.s.toFixed(1),
            at: [+b.pa.x.toFixed(1), +b.pa.z.toFixed(1)],
            v: +b.v.toFixed(2),
            stop: b.at?.id ?? null,
            next: b.stopAt[b.nextI].stop.id,
            dwell: +b.dwell.toFixed(1),
            held: b.held,
            wait: b.waitWhy,
            blocked: +b.blockT.toFixed(1),
            backs: b.backs,
            railZones: b.zones.map((zn) => [+zn.s0.toFixed(0), +zn.s1.toFixed(0)]),
            rider: b.rider,
            length: +loop.length.toFixed(0),
            passengers: b.passengers.map((p) => `${p.seat}:${p.state}`).join(" "),
            seats: b.taken.map((t) => (t === "player" ? "P" : t ? "p" : ".")).join(""),
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
  // the saloon inside: drawn only for an omnibus you are in or near
  const interiorM = inst(interiorGeometry(), n, "omnibus_interior");
  const farGlassM = inst(farGlassGeometry(), n, "omnibus_far_glass");
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
      const row = bd.row === "ad" ? atlas.adRow : li * 2 + bd.row;
      const v0 = 1 - (row + 1) / atlas.rows;
      const v1 = 1 - row / atlas.rows;
      const u0 = bd.row === "ad" ? (bd.ad ?? 0) / ADS.length : 0;
      const u1 = bd.row === "ad" ? ((bd.ad ?? 0) + 1) / ADS.length : 1;
      const base = (i * BOARDS.length + j) * 6;
      // corners: bottom-left, bottom-right, top-right, bottom-left, top-right, top-left
      const uv: Array<[number, number]> = [[u0, v0], [u1, v0], [u1, v1], [u0, v0], [u1, v1], [u0, v1]];
      uv.forEach(([u, v], k) => bUv.setXY(base + k, u, v));
    });
  });
  const boards = new THREE.Mesh(boardGeo, boardMat);
  boards.name = "omnibus_boards";
  boards.frustumCulled = false;
  group.add(boards);

  // the carriage lamps: glass that glows after dusk, and a soft glow in the air round it
  const glassMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  // M7 fog lamps: the lamps fog with the carriage (dark by day, they hung in the fog on their own)
  const glassFog = lampFog(glassMat, 1, 1.3);
  const glass = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.14, 0.03), glassMat, n * LAMPS.length);
  glass.name = "omnibus_lamps";
  glass.frustumCulled = false;
  group.add(glass);
  const haloGeo = new THREE.BufferGeometry();
  const haloPos = new THREE.Float32BufferAttribute(new Float32Array(n * LAMPS.length * 3), 3);
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

  // the stop posts: one merged mesh; each post shows the lines that call at its stop (M7: one post
  // for bays of two lines at one spot, its name on the sign, the timetable on a plate, a bench)
  const linesAt = (id: string) => linesAtStop(id);
  const posts = stopPosts();
  {
    const geos: THREE.BufferGeometry[] = [];
    for (const pt of posts) {
      const g = postGeometry(linesAt(pt.id));
      g.applyMatrix4(new THREE.Matrix4().makeRotationY(pt.yaw).setPosition(pt.x, 0, pt.z));
      geos.push(g);
      if (pt.bench) {
        const bg = benchGeometry();
        // (the prop check, dev/propcheck.ts)
        addProp({ src: "omnibus stops", name: "stop bench", x: pt.bench[0], y: 0, z: pt.bench[1], yaw: pt.bench[2], pts: [bg.getAttribute("position").array.slice()] });
        bg.applyMatrix4(new THREE.Matrix4().makeRotationY(pt.bench[2]).setPosition(pt.bench[0], 0, pt.bench[1]));
        geos.push(bg);
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos, false) ?? geos[0], wood);
    mesh.name = "omnibus_posts";
    scene.add(mesh);
    const signs = signMesh(posts);
    if (signs) scene.add(signs);
  }

  // Sync pass 2: the nameless passengers and the people waiting at the stops are the world PC's (it rolls these
  // dice); the others show them from its state (netApply: the same people, seats and looks on every PC). A
  // townsperson's seat comes from his id (seatFor), so it is the same wherever his trip is run.
  const rand = Math.random;
  /** The next number for a nameless passenger or a waiter (the world PC's; a new world PC goes on after the last seen). */
  let nextNid = 1;
  const seatFor = (id: string, n: number): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
    return (h >>> 0) % n;
  };

  // --- passengers: townspeople who ride a stop or three, on the benches inside
  const PASSENGER_KINDS: HumanKind[] = ["gentleman", "clerk", "old_man", "priest", "sailor_b", "docker_a", "porter", "carter", "docker_b"];
  const floorLocal = (x: number, z: number) => (z < Z0 - 0.1 ? (Math.abs(x) < 0.8 && z > Z0 - 0.8 ? PLATFORM_Y : 0) : FLOOR_Y);
  const insideSeats = SEATS.map((s, i) => ({ s, i })).filter((q) => !q.s.roof);
  /** A walk from the step behind the platform to a seat (body frame), or back. */
  const pathTo = (seat: OmnibusSeat): P[] => [
    [0.15, Z0 - 1.3],
    [0, Z0 - 0.45],
    [0, Z0 + 0.3],
    [0, seat.z],
    [seat.x * 0.75, seat.z],
  ];
  function board(b: BusState, kind?: HumanKind, nid?: number): void {
    const free = insideSeats.filter((q) => !b.taken[q.i]);
    if (!free.length) return;
    const human = makeHuman(kind ?? PASSENGER_KINDS[Math.floor(rand() * PASSENGER_KINDS.length)]);
    if (!human || !human.canSit) return;
    const q = free[Math.floor(rand() * free.length)];
    const g = new THREE.Group();
    g.add(human.root);
    b.frame.add(g);
    b.taken[q.i] = "passenger";
    b.passengers.push({ human, g, seat: q.i, state: "in", path: pathTo(q.s), t: 0, nid: nid ?? nextNid++ });
  }
  /** Seated now (the end of the walk in, or one who was aboard already when this PC first saw the omnibus). */
  function sitDown(p: Passenger): void {
    if (p.seat < 0) {
      // standing on the platform, facing across it
      p.state = "seated";
      p.human.play("idle", 0.3);
      p.g.rotation.y = Math.PI / 2;
      return;
    }
    const s = SEATS[p.seat];
    p.state = "seated";
    p.human.play("sit", 0.3);
    p.g.position.set(s.x, s.y + p.human.sitDrop(0) + 0.02, s.z);
    p.g.rotation.y = s.face;
  }
  /** M6: a townsperson of the town gets on here, to ride to `alight`. */
  function boardResident(b: BusState, who: { id: string; kind: HumanKind }, alight: string, asked = false): boolean {
    // sync pass 2, run by another PC: aboard in the book here; the world PC puts him on for all to see
    if (api.netRemote && !asked) {
      if (!b.riders.has(who.id)) api.netAsk?.("bus_board", [b.index, who.id.slice(0, 40), who.kind, alight.slice(0, 40)]);
      b.riders.set(who.id, alight);
      return true;
    }
    const was = b.passengers.find((p) => p.who?.id === who.id);
    if (was) {
      // (this PC's own trip has him now too: its step off is this PC's news)
      if (!asked) was.asked = false;
      return true;
    }
    const human = makeHuman(who.kind);
    if (!human) return false;
    const g = new THREE.Group();
    g.add(human.root);
    if (human.canSit) {
      const free = insideSeats.filter((q) => !b.taken[q.i]);
      if (!free.length) {
        human.dispose();
        return false;
      }
      // (the seat by his id among the free ones: the same on every PC that runs his trip)
      const q = free[seatFor(who.id, free.length)];
      b.frame.add(g);
      b.taken[q.i] = "passenger";
      b.passengers.push({ human, g, seat: q.i, state: "in", path: pathTo(q.s), t: 0, who: { id: who.id, alight } });
      return true;
    }
    // no seat for a skirt: she stands on the back platform, holding on (two at most)
    const standing = b.passengers.filter((p) => p.seat < 0).length;
    if (standing >= 2) {
      human.dispose();
      return false;
    }
    b.frame.add(g);
    const spot: P = [standing ? -0.35 : 0.3, Z0 - 0.55];
    b.passengers.push({ human, g, seat: -1 - standing, state: "in", path: [[0.15, Z0 - 1.3], spot], t: 0, who: { id: who.id, alight } });
    return true;
  }

  /** At a stop: some get off, some get on (one to four aboard). */
  function atStop(b: BusState): void {
    // (sync pass 2: those riding in the book here step off at their stop)
    for (const [id, alight] of [...b.riders]) {
      if (b.at?.id !== alight) continue;
      b.riders.delete(id);
      api.onResidentOff?.(b, id, b.stepDown());
    }
    for (const p of b.passengers) {
      // M6: the town's own get off at their stop, and only there
      if (p.who) {
        if (p.state === "seated" && b.at?.id === p.who.alight) {
          p.state = "out";
          p.path = p.seat >= 0 ? pathTo(SEATS[p.seat]).reverse() : [[p.g.position.x, p.g.position.z], [0.15, Z0 - 1.3]];
          p.t = 0;
          p.human.play("walk", 0.2);
          p.human.setPace(1.1);
        }
        continue;
      }
      // (run by another PC: its list says who gets off: netApply)
      if (api.netRemote) continue;
      if (p.state === "seated" && rand() < 0.4) {
        p.state = "out";
        p.path = pathTo(SEATS[p.seat]).reverse();
        p.t = 0;
        p.human.play("walk", 0.2);
        p.human.setPace(1.1);
      }
    }
    if (!api.anonymous || api.netRemote) return;
    const want = 1 + Math.floor(rand() * 4);
    const aboard = b.passengers.filter((p) => p.state !== "out").length;
    for (let k = 0; k < Math.min(2, want - aboard); k++) board(b);
  }
  function movePassengers(b: BusState, dt: number): void {
    for (const p of b.passengers) {
      if (p.state === "seated") continue;
      p.t += dt * 1.1;
      // along the path at walking pace
      let d = p.t;
      let at: P = p.path[p.path.length - 1];
      let yaw = p.g.rotation.y;
      for (let k = 0; k < p.path.length - 1; k++) {
        const [ax, az] = p.path[k];
        const [bx, bz] = p.path[k + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (d <= L) {
          at = [ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L];
          yaw = Math.atan2(bx - ax, bz - az);
          d = -1;
          break;
        }
        d -= L;
      }
      p.g.position.set(at[0], floorLocal(at[0], at[1]), at[1]);
      p.g.rotation.y = yaw;
      if (p.human.motion !== "walk") {
        p.human.play("walk", 0.2);
        p.human.setPace(1.1);
      }
      if (d >= 0) {
        // the end of the walk: sit down, or step off and go
        if (p.state === "in") sitDown(p);
        else stepOff(b, p);
      }
    }
    b.passengers = b.passengers.filter((p) => (p.state as string) !== "gone");
  }
  /** Down the step and gone (a townsperson stands at its foot). */
  function stepOff(b: BusState, p: Passenger): void {
    if (p.seat >= 0) b.taken[p.seat] = null;
    p.human.dispose();
    p.g.removeFromParent();
    p.state = "gone" as Passenger["state"];
    if (p.who && !p.mirror && !p.asked) api.onResidentOff?.(b, p.who.id, b.stepDown());
  }

  // --- M7: people waiting at the stops (near Jef only): they stand by the post or sit on the bench,
  // and when an omnibus of a line that calls there stops, they walk to its step and get on (the
  // omnibus waits for them). None before the first omnibus or after the last.
  interface Waiter {
    human: Human;
    g: THREE.Group;
    post: StopPost;
    state: "wait" | "go";
    bus: BusState | null;
    t: number;
    from: P;
    /** Sync pass 2: the waiter's number (the world PC's), its place by the post, its look (NET_KINDS index). */
    nid: number;
    slot: number;
    kindI: number;
  }
  const waiters: Waiter[] = [];
  const WAIT_KINDS: HumanKind[] = ["clerk", "old_man", "gentleman", "wife_a", "wife_b", "old_woman", "maid", "shopwife", "docker_b", "priest", "tourist", "girl_b"];
  /** Sync pass 2: every look a nameless passenger or a waiter may have, by number (OmnibusNet). */
  const NET_KINDS: HumanKind[] = [...PASSENGER_KINDS, ...WAIT_KINDS.filter((k) => !PASSENGER_KINDS.includes(k))];
  let waitT = 0;
  /** Where this PC's camera was last (sync pass 2: a PC run by another draws the world PC's waiters near it only). */
  let camAt: { x: number; z: number } | null = null;
  /** A waiter by the post at `slot` (sitting on the bench when that is his place and he can). */
  function addWaiter(pt: StopPost, slot: number, kind: HumanKind, nid: number): Waiter | null {
    const human = makeHuman(kind);
    if (!human) return null;
    const spot = spotFor(pt, slot);
    const g = new THREE.Group();
    g.add(human.root);
    group.add(g);
    if (spot.sit && human.canSit) {
      human.play("sit", 0);
      g.position.set(spot.x, 0.46 + human.sitDrop(0), spot.z);
    } else {
      const s2 = spot.sit ? spotFor(pt, slot + 1) : spot;
      human.play("idle", 0);
      g.position.set(s2.x, 0, s2.z);
    }
    g.rotation.y = spot.yaw;
    const w: Waiter = { human, g, post: pt, state: "wait", bus: null, t: 0, from: [g.position.x, g.position.z], nid, slot, kindI: NET_KINDS.indexOf(kind) };
    waiters.push(w);
    return w;
  }
  /** How many wait at a post this hour (0 to 3, the same all hour; more on a market morning). */
  function wantAt(pt: StopPost, day: number, hour: number): number {
    const now = absMinute(day, 0) + hour * 60;
    if (!linesAt(pt.id).some((l) => departures(l.id, pt.id, now, 1)[0] - now < 150)) return 0;
    if (hour < 6.5 || hour >= 21.5) return 0;
    let h = (Math.floor(hour) * 73856093) ^ (day * 19349663);
    for (let i = 0; i < pt.id.length; i++) h = (h * 31 + pt.id.charCodeAt(i)) | 0;
    return (Math.abs(h) % 4) - (hour < 8 || hour > 19 ? 1 : 0);
  }
  function spotFor(pt: StopPost, i: number): { x: number; z: number; yaw: number; sit: boolean } {
    const [ox, oz] = pt.toLane;
    const yaw = Math.atan2(ox, oz);
    if (i === 0 && pt.bench) {
      const [bx, bz, by] = pt.bench;
      return { x: bx - Math.sin(by) * 0.1 + Math.cos(by) * 0.35, z: bz - Math.cos(by) * 0.1 - Math.sin(by) * 0.35, yaw: by, sit: true };
    }
    // along the kerb beside the post, a little back from the lane
    const along = (i % 2 ? 1 : -1) * (0.7 + 0.5 * Math.floor(i / 2));
    return { x: pt.x - ox * 0.4 + oz * along, z: pt.z - oz * 0.4 - ox * along, yaw, sit: false };
  }
  function updateWaiters(dt: number, camera?: THREE.Camera): void {
    const c = api.clock?.();
    const cam = camera?.position ?? api.eye?.();
    if (cam) camAt = { x: cam.x, z: cam.z };
    waitT -= dt;
    // (run by another PC: its waiters come with its state: netApply)
    if (waitT <= 0 && c && cam && api.anonymous && !api.netRemote) {
      waitT = 2;
      // sync pass 2: near any player (the others draw these), new ones out of every player's arm's reach
      const eyes = [cam, ...(api.others?.() ?? [])];
      for (const pt of posts) {
        let d = Infinity;
        for (const e of eyes) d = Math.min(d, Math.hypot(pt.x - e.x, pt.z - e.z));
        const mine = waiters.filter((w) => w.post === pt);
        if (d > 60) {
          for (const w of mine) dropWaiter(w);
          continue;
        }
        const want = Math.max(0, wantAt(pt, c.day, c.hour));
        // new ones only out of arm's reach (they come while you are not looking closely)
        if (mine.filter((w) => w.state === "wait").length < want && d > 18 && waiters.length < 8) {
          const kind = WAIT_KINDS[Math.floor(rand() * WAIT_KINDS.length)];
          addWaiter(pt, mine.length, kind, nextNid++);
        }
      }
    }
    for (const w of [...waiters]) {
      if (w.state === "go" && w.bus) {
        // to the foot of the step at walking pace, then up it (a nameless passenger now)
        const st = w.bus.stepDown();
        const dx = st.x - w.g.position.x;
        const dz = st.z - w.g.position.z;
        const L = Math.hypot(dx, dz);
        w.t += dt;
        if (L < 0.35 || w.t > 20 || !w.bus.at) {
          // (run by another PC: he waits at the step until its state has him aboard, or gone)
          if (api.netRemote) {
            if (w.human.motion !== "idle") w.human.play("idle", 0.2);
            if (!cam || Math.hypot(w.g.position.x - cam.x, w.g.position.z - cam.z) < 70) w.human.update(dt);
            continue;
          }
          const kind = w.human.kind;
          dropWaiter(w);
          if (w.bus.at) board(w.bus, kind, w.nid);
          continue;
        }
        const v = Math.min(L, 1.2 * dt);
        w.g.position.set(w.g.position.x + (dx / L) * v, 0, w.g.position.z + (dz / L) * v);
        w.g.rotation.y = Math.atan2(dx, dz);
        if (w.human.motion !== "walk") {
          w.human.play("walk", 0.2);
          w.human.setPace(1.1);
        }
      }
      if (!cam || Math.hypot(w.g.position.x - cam.x, w.g.position.z - cam.z) < 70) w.human.update(dt);
    }
  }
  function dropWaiter(w: Waiter): void {
    const i = waiters.indexOf(w);
    if (i >= 0) waiters.splice(i, 1);
    w.human.dispose();
    w.g.removeFromParent();
  }
  /** An omnibus stops at a post: those waiting for a line that calls there go to its step. */
  function callWaiters(b: BusState, stop: OmnibusStop): void {
    // (run by another PC: who goes comes with its state)
    if (api.netRemote) return;
    const pt = posts.find((q) => Math.hypot(q.x - stop.post[0], q.z - stop.post[1]) < 0.3);
    if (!pt) return;
    const room = insideSeats.filter((q) => !b.taken[q.i]).length;
    let n = 0;
    for (const w of waiters) {
      if (w.post !== pt || w.state !== "wait" || n >= room) continue;
      // (not everyone waits for this line where two call)
      if (linesAt(pt.id).length > 1 && rand() < 0.4) continue;
      w.state = "go";
      w.bus = b;
      w.t = 0;
      if (w.human.motion === "sit") w.g.position.y = 0;
      n++;
    }
  }
  const waitersGoing = (b: BusState) => waiters.some((w) => w.bus === b && w.state === "go");

  // --- sync pass 2: run by another PC, its nameless passengers and waiters are shown here as it has them
  /** The world PC's nameless passengers of this omnibus ([net id, seat, kind]): new ones get on, gone ones get off. */
  function syncPassengers(b: BusState, list: number[][]): void {
    const want = new Map<number, number[]>();
    for (const x of list) {
      want.set(x[0], x);
      nextNid = Math.max(nextNid, x[0] + 1);
    }
    for (const p of b.passengers) {
      if (p.who || p.state === "out") continue;
      const q = p.nid !== undefined ? want.get(p.nid) : undefined;
      // (the same number, seat and look: kept. A number this PC gave out itself while it ran the omnibuses is
      // another passenger: he goes)
      if (q && q[1] === p.seat && NET_KINDS[q[2]] === p.human.kind) continue;
      // off at a stop: down the step as the world PC's; else (a first look, a jump) gone at once
      if (!q && b.at && b.netSeen && p.seat >= 0) {
        p.state = "out";
        p.path = pathTo(SEATS[p.seat]).reverse();
        p.t = 0;
        p.human.play("walk", 0.2);
        p.human.setPace(1.1);
      } else stepOff(b, p);
    }
    b.passengers = b.passengers.filter((p) => (p.state as string) !== "gone");
    for (const [nid, seat, ki] of list) {
      if (b.passengers.some((p) => p.nid === nid)) continue;
      const kind = NET_KINDS[ki];
      const s = SEATS[seat];
      // (a seat this PC has given to its own player or a townsperson: he is not drawn here)
      if (!kind || !s || s.roof || b.taken[seat]) continue;
      // the waiter who walked to the step is aboard now
      const w = waiters.find((q) => q.nid === nid);
      if (w) dropWaiter(w);
      const human = makeHuman(kind);
      if (!human) continue;
      const g = new THREE.Group();
      g.add(human.root);
      b.frame.add(g);
      b.taken[seat] = "passenger";
      const p: Passenger = { human, g, seat, state: "in", path: pathTo(s), t: 0, nid };
      b.passengers.push(p);
      // getting on at a stop: up the step; aboard already when first seen here: in his seat
      if (!b.at || !b.netSeen) sitDown(p);
    }
  }
  /** The world PC's townspeople aboard this omnibus ([id, seat, kind, stop]): drawn here as it has them. */
  function syncResidents(b: BusState, list: Array<Array<string | number>>): void {
    const want = new Map<string, Array<string | number>>();
    for (const x of list) if (typeof x[0] === "string") want.set(x[0], x);
    for (const p of b.passengers) {
      if (!p.who || p.state === "out") continue;
      const q = want.get(p.who.id);
      if (q && q[1] === p.seat && q[2] === p.human.kind) continue;
      // off at a stop: down the step (a seat) or off the platform; else gone at once
      if (!q && b.at && b.netSeen) {
        p.state = "out";
        p.path = p.seat >= 0 ? pathTo(SEATS[p.seat]).reverse() : [[p.g.position.x, p.g.position.z], [0.15, Z0 - 1.3]];
        p.t = 0;
        p.human.play("walk", 0.2);
        p.human.setPace(1.1);
      } else stepOff(b, p);
    }
    b.passengers = b.passengers.filter((p) => (p.state as string) !== "gone");
    for (const [id, seat, kind, alight] of list) {
      if (typeof id !== "string" || typeof seat !== "number" || typeof kind !== "string" || typeof alight !== "string") continue;
      if (b.passengers.some((p) => p.who?.id === id)) continue;
      const s = seat >= 0 ? SEATS[seat] : null;
      if (seat >= 0 ? !s || s.roof || b.taken[seat] : seat < -2) continue;
      const human = makeHuman(kind as HumanKind);
      if (!human) continue;
      const g = new THREE.Group();
      g.add(human.root);
      b.frame.add(g);
      if (seat >= 0) b.taken[seat] = "passenger";
      const spot: P = [seat === -2 ? -0.35 : 0.3, Z0 - 0.55];
      const p: Passenger = { human, g, seat, state: "in", path: s ? pathTo(s) : [[0.15, Z0 - 1.3], spot], t: 0, who: { id, alight }, mirror: true };
      b.passengers.push(p);
      if (!b.at || !b.netSeen) {
        // aboard already when first seen here: in his seat, or standing on the platform
        if (!s) p.g.position.set(spot[0], floorLocal(spot[0], spot[1]), spot[1]);
        sitDown(p);
      }
    }
  }
  /** The world PC's waiters ([net id, post, slot, kind, omnibus or -1]), drawn near this PC's camera. */
  function syncWaiters(list: number[][]): void {
    const want = new Set<number>();
    for (const x of list) {
      want.add(x[0]);
      nextNid = Math.max(nextNid, x[0] + 1);
    }
    for (const w of [...waiters]) if (!want.has(w.nid)) dropWaiter(w);
    for (const [nid, pi, slot, ki, bi] of list) {
      const pt = posts[pi];
      const kind = NET_KINDS[ki];
      if (!pt || !kind) continue;
      let w = waiters.find((q) => q.nid === nid) ?? null;
      // (a number this PC gave out itself while it ran the omnibuses: another waiter)
      if (w && (w.post !== pt || w.slot !== slot || w.kindI !== ki)) {
        dropWaiter(w);
        w = null;
      }
      const far =!!camAt && Math.hypot(pt.x - camAt.x, pt.z - camAt.z) > 70;
      if (far) {
        if (w) dropWaiter(w);
        continue;
      }
      w ??= addWaiter(pt, slot, kind, nid);
      if (!w) continue;
      const bus = bi >= 0 ? buses[bi] : undefined;
      if (bus && w.state === "wait") {
        w.state = "go";
        w.bus = bus;
        w.t = 0;
        if (w.human.motion === "sit") w.g.position.y = 0;
      }
    }
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

  /** M6 handcart: the stretches of a round where the lane lies on the train's band (found once). */
  function railZones(lp: Loop): Array<{ s0: number; s1: number; rect: Rect }> {
    const out: Array<{ s0: number; s1: number; rect: Rect }> = [];
    if (!opts.onRails) return out;
    const n = lp.x.length;
    const on = new Uint8Array(n);
    for (let i = 0; i < n; i++) on[i] = opts.onRails(lp.x[i], lp.z[i]) ? 1 : 0;
    // start where the round is off the band, so no zone is cut in two at the loop's seam
    const i0 = on.indexOf(0);
    if (i0 < 0) return out;
    let cur: { s0: number; s1: number; rect: Rect } | null = null;
    for (let k = 0; k <= n; k++) {
      const i = (i0 + k) % n;
      if (on[i] && k < n) {
        const x = lp.x[i];
        const z = lp.z[i];
        if (!cur) cur = { s0: i * Loop.STEP, s1: i * Loop.STEP, rect: { minX: x, maxX: x, minZ: z, maxZ: z } };
        cur.s1 = i * Loop.STEP;
        cur.rect.minX = Math.min(cur.rect.minX, x - 1.5);
        cur.rect.maxX = Math.max(cur.rect.maxX, x + 1.5);
        cur.rect.minZ = Math.min(cur.rect.minZ, z - 1.5);
        cur.rect.maxZ = Math.max(cur.rect.maxZ, z + 1.5);
      } else if (cur) {
        out.push(cur);
        cur = null;
      }
    }
    return out;
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
    // M6 handcart: the train has the right of way where the round lies on its band: wait short of
    // the stretch while it is on it or coming up to it (never stand on the rails in its way)
    if (opts.trainBusy) {
      for (const zn of b.zones) {
        const len = lp.wrap(zn.s1 - zn.s0);
        const inside = lp.wrap(nose - zn.s0) < len + (NOSE - TAIL) + 1;
        if (inside) continue;
        const ahead = lp.wrap(zn.s0 - nose);
        if (ahead < 30 && opts.trainBusy(zn.rect)) {
          if (ahead - 1.5 < lim) {
            lim = Math.max(0, ahead - 1.5);
            b.waitWhy = "train";
          }
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
        // (Steve 2026-09-27: walkers give way to the omnibus, crowd.ts giveWay: it stops only for one right before
        // its horses, a last resort when he cannot get out of the way)
        for (let dd = 0; dd <= 3; dd += 1) {
          lp.at(nose + dd, pa);
          if (Math.hypot(p.x - pa.x, p.z - pa.z) < 1.1) {
            lim = Math.min(lim, Math.max(0, dd - 1.5));
            b.waitWhy = "people";
            break;
          }
        }
      }
    }
    let queueGap = Infinity;
    // M7: another omnibus ahead on this lane, going the same way (one of its own line at the
    // terminus, the other town line on the Meir): wait behind it (a queue is no hold-up to back from)
    for (const o of buses) {
      if (o === b) continue;
      if (o.line === b.line) {
        // (its own line: the same round, so the gap along it, round the corners too)
        const gap = lp.wrap(o.s + TAIL - nose);
        if (gap < 14) queueGap = Math.min(queueGap, gap);
        if (gap < 14 && gap - 2.5 < lim) {
          lim = Math.max(0, gap - 2.5);
          b.waitWhy = "queue";
        }
        continue;
      }
      const tx = o.pa.x - Math.sin(o.yaw) * -TAIL;
      const tz = o.pa.z - Math.cos(o.yaw) * -TAIL;
      if (Math.abs(tx - lp.x[Math.floor(lp.wrap(nose) / Loop.STEP)]) > 16 || Math.abs(tz - lp.z[Math.floor(lp.wrap(nose) / Loop.STEP)]) > 16) continue;
      for (let dd = 0; dd <= 12; dd += 1) {
        lp.at(nose + dd, pa);
        if (Math.hypot(tx - pa.x, tz - pa.z) < 1.3) {
          const turn = Math.abs(Math.atan2(Math.sin(o.yaw - lp.yaw(nose + dd)), Math.cos(o.yaw - lp.yaw(nose + dd))));
          if (turn < 0.8) queueGap = Math.min(queueGap, dd);
          if (turn < 0.8 && dd - 2.5 < lim) {
            lim = Math.max(0, dd - 2.5);
            b.waitWhy = "queue";
          }
          break;
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
        // (M7: from the queue's gap on it is the omnibus ahead: no hold-up to back from)
        if (dd < queueGap - 0.6) {
          lim = Math.min(lim, Math.max(0, dd - 3));
          b.waitWhy = "blocked";
        }
        break;
      }
    }
    b.rects.forEach((r, k) => ([r.minX, r.maxX] = keep[k]));
    return lim;
  }

  /** M6 handcart: is the body on a stretch of the train's band now? */
  function inRailZone(b: BusState): boolean {
    const lp = b.loop;
    const nose = b.s + NOSE;
    return b.zones.some((zn) => lp.wrap(nose - zn.s0) < lp.wrap(zn.s1 - zn.s0) + (NOSE - TAIL) + 1);
  }

  /** M6 handcart: the lane behind the omnibus free to back into (its own boxes out of the way)? */
  function behindClear(b: BusState, player: { x: number; z: number } | null): boolean {
    const lp = b.loop;
    const keep = b.rects.map((r) => [r.minX, r.maxX]);
    for (const r of b.rects) r.minX = r.maxX = 1e6;
    let ok = true;
    for (const dd of [0.8, 2, 3.2]) {
      lp.at(lp.wrap(b.s + TAIL - dd), pa);
      if (!opts.isFree(pa.x, pa.z, 0.6) || (player && Math.hypot(player.x - pa.x, player.z - pa.z) < 1.6)) {
        ok = false;
        break;
      }
    }
    b.rects.forEach((r, k) => ([r.minX, r.maxX] = keep[k]));
    return ok;
  }

  /**
   * M7 timetable: may it leave now? Anywhere but its terminus, yes. At the terminus it takes the
   * line's next free departure (never one another omnibus of the line took, never more than half a
   * headway late) and waits for it; after the last one of the day, till the first in the morning.
   */
  function onTime(b: BusState): boolean {
    if (!b.at || b.at.id !== b.line.terminus) return true;
    const now = nowMin();
    if (now === null) return true;
    const h = lineTiming(b.line.id).headwayMin;
    // a clock set back (the dev kit, a load): forget a departure that lies too far ahead
    if (b.departAt !== null && b.departAt > nextSlot(b.line.id, now) + h) b.departAt = null;
    if (b.departAt === null) {
      let last = lastSlot.get(b.line.id) ?? -Infinity;
      if (last > nextSlot(b.line.id, now) + h) last = -Infinity;
      b.departAt = nextSlot(b.line.id, Math.max(now - h / 2, last + 1));
      lastSlot.set(b.line.id, b.departAt);
    }
    if (now < b.departAt) {
      b.waitWhy = "timetable";
      return false;
    }
    return true;
  }

  function move(b: BusState, dt: number, player: { x: number; z: number } | null): void {
    const lp = b.loop;
    if (b.at) {
      b.v = 0;
      if (!b.held && !b.passengers.some((p) => p.state === "out") && !waitersGoing(b)) b.dwell -= dt;
      if (b.dwell <= 0 && !b.held && onTime(b)) {
        b.departAt = null;
        const was = b.at;
        b.at = null;
        b.nextI = (b.nextI + 1) % b.stopAt.length;
        api.onDepart?.(b, was, b.stopAt[b.nextI].stop);
      }
    } else if (b.backM > 0) {
      // M6 handcart: backing off (a vehicle it cannot pass, the train in its lane): slowly, while the way behind is clear
      b.v = 0;
      const ds = Math.min(BACK_V * dt, b.backM);
      if (behindClear(b, player)) {
        b.s = lp.wrap(b.s - ds);
        b.backM -= ds;
        b.rollR -= ds / R_REAR;
        b.rollF -= ds / R_FRONT;
      } else b.backM = 0;
      b.waitWhy = "backing";
    } else {
      const r = room(b, player);
      // M6 handcart: held up by a thing or the train for long: back off and let it by
      if (r <= 0.01 && (b.waitWhy === "blocked" || b.waitWhy === "train")) b.blockT += dt;
      else b.blockT = 0;
      // (waiting short of the rails for the train is no hold-up: it waits there as long as it takes)
      if (b.blockT > (inRailZone(b) ? BACK_AFTER_TRAIN_S : b.waitWhy === "train" ? Infinity : BACK_AFTER_S)) {
        b.blockT = 0;
        b.backM = BACK_M;
        b.backs++;
      }
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
        atStop(b);
        callWaiters(b, st.stop);
        b.v = 0;
        api.onArrive?.(b, st.stop);
      }
    }
    place(b, dt);
  }

  /** The pose from the fields (s, v): the frame, the gait, the colliders. */
  function place(b: BusState, dt: number): void {
    const lp = b.loop;
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
    let anyInside = false;
    buses.forEach((b, i) => {
      b.near = !cam || Math.hypot(b.pa.x - cam.x, b.pa.z - cam.z) < far;
      anyNear ||= b.near;
      b.frame.updateMatrixWorld();
      bodyM.setMatrixAt(i, b.frame.matrixWorld);
      const inside = b.rider || (!!cam && Math.hypot(b.pa.x - cam.x, b.pa.z - cam.z) < 15);
      interiorM.setMatrixAt(i, inside ? b.frame.matrixWorld : zero);
      farGlassM.setMatrixAt(i, inside ? zero : b.frame.matrixWorld);
      anyInside ||= inside;
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
        glass.setMatrixAt(i * LAMPS.length + k, M2);
        // a glow in the air round the carriage lamps; the oil lamp inside only lights its glass
        if (k < 2) tmp.set(x, y, z + 0.12).applyMatrix4(b.frame.matrixWorld);
        else tmp.set(0, -1000, 0);
        haloPos.setXYZ(i * LAMPS.length + k, tmp.x, tmp.y, tmp.z);
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
    for (const m of [bodyM, paintM, rearM, foreM, frontM, glass, interiorM, farGlassM]) m.instanceMatrix.needsUpdate = true;
    interiorM.visible = anyInside;
    bPos.needsUpdate = true;
    bNor.needsUpdate = true;
    boardGeo.computeBoundingSphere();
    haloPos.needsUpdate = true;
    // the lamps: dark glass by day, a warm flame after dusk
    glassMat.color.setRGB(0.13 + 0.87 * lit, 0.13 + 0.6 * lit, 0.12 + 0.28 * lit);
    glassFog.value = 1 + 0.3 * lit;
    haloMat.opacity = 0.7 * lit;
    halos.visible = lit > 0.02 && anyNear;
    opts.horses.show("omnibus", anyNear);
  }

  // M8b: run by one PC for all (net/mp/world.ts)
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  /** The short way from a to b along a round of length L. */
  const along = (a: number, b: number, L: number) => {
    const d = (((b - a) % L) + L) % L;
    return d > L / 2 ? d - L : d;
  };

  const api: Omnibuses = {
    buses,
    update(_t, dt, player, camera) {
      dt = Math.min(dt, 0.1);
      // M8b: run by another PC: no decisions here (netApply moves them); one not placed by a state
      // this frame (none came yet) stands where it is
      if (api.netRemote) {
        for (const b of buses) {
          if (!b.netPlaced) place(b, dt);
          b.netPlaced = false;
        }
      } else for (const b of buses) move(b, dt, player);
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
      updateWaiters(dt, camera);
      for (const b of buses) {
        movePassengers(b, dt);
        if (!b.near) continue;
        b.driver?.update(dt);
        b.conductor?.update(dt);
        for (const p of b.passengers) p.human.update(dt);
      }
    },
    colliders: () => buses.flatMap((b) => b.rects),
    rolling: () => buses.filter((b) => !b.due()).flatMap((b) => b.rects),
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
    timetable(stop) {
      const now = nowMin();
      return linesAt(stop).map((line) => ({
        line,
        next: now === null ? [] : departures(line.id, stop, now, 3).map(clockText),
        headwayMin: lineTiming(line.id).headwayMin,
      }));
    },
    sweep() {
      // the rig as it drives: the saloon and platform (tail -2.3 m to the dashboard, 1.0 m each side
      // at the wheels), the pair of horses; against the walk map and every fixed thing (not the
      // omnibuses themselves: their boxes are parked out of the way meanwhile)
      const out: Array<{ line: string; x: number; z: number; what: string }> = [];
      const keep = buses.map((b) => b.rects.map((r) => [r.minX, r.maxX] as const));
      for (const b of buses) for (const r of b.rects) r.minX = r.maxX = 1e6;
      try {
        for (const l of LINES) {
          const lp = loops.get(l.id)!.loop;
          const q = { x: 0, z: 0 };
          const r2 = { x: 0, z: 0 };
          let lastKey = "";
          for (let s = 0; s < lp.length; s += 0.5) {
            lp.at(s, q);
            lp.at(s + WHEELBASE, r2);
            const yw = Math.atan2(r2.x - q.x, r2.z - q.z);
            const fx = Math.sin(yw);
            const fz = Math.cos(yw);
            const pts: P[] = [];
            for (let a = -2.3; a <= 4.31; a += 0.4) for (const w of [-1, -0.5, 0, 0.5, 1]) pts.push([q.x + fx * a + fz * w, q.z + fz * a - fx * w]);
            const hs = s + WHEELBASE + HORSES;
            lp.at(hs, r2);
            const hy = lp.yaw(hs);
            for (let a = -1.6; a <= 1.61; a += 0.4) for (const w of [-0.85, 0, 0.85]) pts.push([r2.x + Math.sin(hy) * a + Math.cos(hy) * w, r2.z + Math.cos(hy) * a - Math.sin(hy) * w]);
            const hit = pts.find(([x, z]) => !opts.isFree(x, z, 0));
            if (!hit) continue;
            const key = `${l.id}:${Math.round(q.x / 4)}:${Math.round(q.z / 4)}`;
            if (key === lastKey) continue;
            lastKey = key;
            out.push({ line: l.id, x: +q.x.toFixed(1), z: +q.z.toFixed(1), what: `at ${hit[0].toFixed(1)}, ${hit[1].toFixed(1)}` });
          }
        }
      } finally {
        buses.forEach((b, i) => b.rects.forEach((r, k) => ([r.minX, r.maxX] = keep[i][k])));
      }
      return out;
    },
    group,
    info() {
      return { buses: buses.map((b) => b.info()), lines: LINES.map((l) => ({ id: l.id, length: +loops.get(l.id)!.loop.length.toFixed(0), stops: loops.get(l.id)!.stopAt.map((x) => [x.stop.id, +x.s.toFixed(0)]) })) };
    },
    anonymous: true,
    boardResident(bus, who, alight) {
      const b = buses.find((q) => q === (bus as unknown as BusState));
      return b ? boardResident(b, who, alight) : false;
    },
    residents() {
      // (this PC's own riders: those its trips put on; not the ones only drawn here for another PC's trip)
      const out: Array<{ id: string; bus: number; alight: string; seated: boolean }> = [];
      for (const b of buses) {
        for (const p of b.passengers) if (p.who && !p.mirror && !p.asked && (p.state as string) !== "gone") out.push({ id: p.who.id, bus: b.index, alight: p.who.alight, seated: p.state === "seated" });
        for (const [id, alight] of b.riders) if (!out.some((q) => q.id === id)) out.push({ id, bus: b.index, alight, seated: true });
      }
      return out;
    },
    netBoard(bus, id, kind, alight) {
      const b = buses[bus];
      if (!b || api.netRemote || !b.stopAt.some((x) => x.stop.id === alight)) return;
      if (!boardResident(b, { id, kind: kind as HumanKind }, alight, true)) return;
      const p = b.passengers.find((q) => q.who?.id === id);
      if (!p) return;
      // (asked for between stops: seated at once, as the world PC's own "unseen" boarding would be)
      if (!b.at && p.state === "in") sitDown(p);
    },
    netRemote: false,
    netAsk: null,
    netState() {
      return {
        b: buses.map((b) => ({
          id: b.index,
          s: r3(b.s),
          v: r3(b.v),
          at: !!b.at,
          _n: b.nextI,
          _dw: r3(b.dwell),
          _dep: b.departAt,
          _bk: r3(b.backM),
          _w: b.waitWhy,
          _r: b.passengers.filter((p) => p.who && p.state !== "out").map((p) => [p.who!.id, p.seat, p.human.kind, p.who!.alight]),
          _a: b.passengers.filter((p) => !p.who && p.nid !== undefined && p.state !== "out").map((p) => [p.nid!, p.seat, NET_KINDS.indexOf(p.human.kind)]),
        })),
        _slots: [...lastSlot],
        _wt: waiters.map((w) => [w.nid, posts.indexOf(w.post), w.slot, w.kindI, w.state === "go" && w.bus ? w.bus.index : -1]),
      };
    },
    netApply(st, dt) {
      dt = Math.min(dt, 0.1);
      for (const [line, slot] of st._slots) lastSlot.set(line, slot);
      for (const q of st.b) {
        const b = buses[q.id];
        if (!b) continue;
        const L = b.loop.length;
        const ds = b.netSeen ? along(b.s, q.s, L) : 0;
        b.s = b.loop.wrap(q.s);
        b.v = q.v;
        b.dwell = q._dw;
        b.departAt = q._dep;
        b.backM = q._bk;
        b.waitWhy = q._w;
        b.rollR += ds / R_REAR;
        b.rollF += ds / R_FRONT;
        // the stops: arriving and leaving as the world PC's omnibus does (the conductor's calls,
        // the passengers and the people waiting here); the first state only puts it there
        const was = b.at;
        const wasI = b.nextI;
        const n = Math.min(Math.max(0, q._n), b.stopAt.length - 1);
        const now = q.at ? b.stopAt[n].stop : null;
        b.nextI = n;
        if (!b.netSeen) b.at = now;
        else {
          if (was && (!now || n !== wasI)) {
            b.at = null;
            // (those still stepping down are off before it rolls: here it waits for nobody)
            for (const p of b.passengers) if (p.state === "out") stepOff(b, p);
            b.passengers = b.passengers.filter((p) => (p.state as string) !== "gone");
            api.onDepart?.(b, was, b.stopAt[n].stop);
          }
          if (now && (!was || n !== wasI)) {
            b.at = now;
            atStop(b);
            callWaiters(b, now);
            api.onArrive?.(b, now);
          }
        }
        if (q._a) syncPassengers(b, q._a);
        if (q._r) syncResidents(b, q._r);
        b.netSeen = true;
        place(b, dt);
        b.netPlaced = true;
      }
      if (st._wt) syncWaiters(st._wt);
    },
    netLerp(p, q, u) {
      // as lerpState, but along each round the short way (s wraps at the round's end)
      const out = lerpState(p, q, u);
      const was = new Map(p.b.map((x) => [x.id, x.s]));
      for (const x of out.b) {
        const b = buses[x.id];
        const s0 = was.get(x.id);
        const s1 = q.b.find((y) => y.id === x.id)?.s;
        if (!b || s0 === undefined || s1 === undefined) continue;
        x.s = b.loop.wrap(s0 + along(s0, s1, b.loop.length) * u);
      }
      return out;
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
