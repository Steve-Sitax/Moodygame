import * as THREE from "three";
import { psx } from "../retro/psx";
import { makeHuman, type Human } from "../game/humans";
import type { Rect } from "./geom";
import { levelAt, HW_MAX, DOCK_Y } from "./tide";
import type { Props } from "./props3d";
import { HorsePool } from "./horses";
import { Kit, type RGB } from "./kit";
import { smoothLine, type TrackData } from "./tracks";
import {
  JIB_GAP,
  PORTAL_GAP,
  REACH,
  awayAngle,
  car,
  craneGap,
  craneParts,
  mast,
  outranks,
  portalGap,
  segDist,
  thingsGap,
  type Capsule,
  type CranePose,
  type PartKind,
} from "../../../shared/cranes";
import { lerpState, type NetMover } from "../net/mp/world";
import type { WagonModels } from "./wagons3d";

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
  /** The wagons, wheel sets, coupling and goods units from wagons.glb (world/wagons3d.ts); null: the code-built parts. */
  wagons?: WagonModels | null;
  /** The opening bridges (world/bridges.ts list, the lock bridge included). */
  bridges: () => OpeningLike[];
  /** Is (x, z) free for a body of radius r (walls, water, things, people)? */
  isFree: (x: number, z: number, r: number) => boolean;
  /** Is there a moored hull under (x, z)? (the crane lifts from its hold) */
  hullAt: (x: number, z: number) => boolean;
  /**
   * The tall things on the moored ships (masts, rigging, funnels; boats.ts tall): [x, z, top over
   * the waterline, the level she sits on below it]. The cranes' jibs keep off them (M6 cranes).
   */
  tall?: ReadonlyArray<[number, number, number, number]>;
  /** Piles of goods on the quay come and go: their colliders. */
  addCollider: (r: Rect) => void;
  removeCollider: (r: Rect) => void;
  waterY: number;
  seed?: number;
  /** Horses in the pool for others (the omnibuses: two each), after the train's two. Default 2. */
  spareHorses?: number;
  /**
   * The gate where the line enters the Werf store (world/railgate.ts): the train asks for it,
   * waits till it stands open, and is hidden once it is wholly in the dark behind it.
   */
  gate?: { x: number; reach: number; amount(): number; want(open: boolean): void };
  /** Walkable areas up in the air (rijnkaai.ts): the cranes' galleries and cabins, moved in place. */
  raised?: { add(d: RaisedDeck): void };
}

/**
 * A walkable area up in the air (the world walks it at height y). Areas that overlap make one
 * walkable place (a gallery round a cabin, a doorway, the cabin floor a step up); its edges are
 * rails or walls: you cannot walk or fall off.
 */
export interface RaisedDeck {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

/** A place up on a crane for jobs (M3g part 4): the driver's cabin, the gallery. Not in shared/spots.json. */
export interface CraneSpot {
  /** e.g. "crane_cabin_3" */
  id: string;
  kind: CraneSpotKind;
  crane: number;
  x: number;
  z: number;
  /** Feet height there. */
  y: number;
  label: string;
}

/** A crane's ladder, up the back of the portal to the gallery round the driver's cabin. */
export interface CraneLadder {
  crane: number;
  /** Where you stand to climb, where you hang on the rungs, where you step off at the top. */
  foot: { x: number; z: number };
  hang: { x: number; z: number };
  head: { x: number; z: number };
  /** The player's yaw that faces the ladder. */
  face: number;
  /** Feet height at the top (the gallery). */
  top: number;
  /** The walkable areas up there, in place (they move with the crane). */
  decks: RaisedDeck[];
  /** Its places for jobs, in place. */
  spots: CraneSpot[];
  /** Standing still with its jib at rest: you may climb. */
  ready: boolean;
}

/**
 * M8b: the train and the cranes as the world PC sends them (net/mp/world.ts). Keys with "_" are not
 * eased between two states: the train's state (0 shed, 1 run, 2 work), the goods in the wagons (six
 * bits a wagon, front wagon lowest), what a crane carries (GOODS index, -1 nothing), its mode (0 berth,
 * 1 swing in, 2 travel, 3 swing out), whether it is hoisting for the train, its pile's count.
 */
export interface RailNet {
  _st: number;
  head: number;
  v: number;
  _sh: number;
  _wk: number;
  _slots: number;
  cranes: Array<{ id: number; pos: number; a: number; hy: number; _c: number; _m: number; _h?: number; _n?: number; _to?: number }>;
}

export interface Railway extends NetMover<RailNet> {
  /** Move the train and the cranes; the player's feet (the train stops for him). */
  update(t: number, dt: number, player: { x: number; z: number } | null, camera?: THREE.Camera): void;
  /** Walk colliders of the horses and wagons: stable objects moved in place, add them once. */
  colliders(): Rect[];
  /** The path check (rijnkaai.ts reachFrom): the horses' and wagons' rects, which pass by (the cranes' legs stay). */
  rolling(): Rect[];
  /** Is the train on (or just at) this rectangle? A bridge must not open under it. */
  busy(r: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean;
  /** The horse instances: two for the train, then `spareHorses` for the omnibuses. */
  horses: HorsePool;
  /** For the soundscape (setVehicles): the horses as a dray while they walk. */
  vehicles(): Array<{ kind: "dray"; x: number; z: number; state: string }>;
  /** A wheel over a rail joint (soundscape.railClack). */
  onClack?: (x: number, z: number) => void;
  /** A crane starts to hoist or lower (soundscape.craneWork). */
  onCrane?: (x: number, z: number) => void;
  /** A crane starts to travel along its runway: the driver rings his bell (soundscape). */
  onCraneTravel?: (x: number, z: number) => void;
  /** The cranes' ladders (game/craneclimb.ts). */
  ladders(): CraneLadder[];
  /** The player at a crane's ladder: it stands still and swings its jib to rest (call every frame while near). */
  summon(i: number): void;
  /** The player is on crane i's ladder or deck (null: on none): it neither travels nor slews. */
  occupy(i: number | null): void;
  /** People walking about (the crowd, the town): the train waits for anyone on the line ahead. Set by main. */
  people?: () => Iterable<{ x: number; z: number }>;
  group: THREE.Group;
  /** Dev: state for checks. */
  info(): Record<string, unknown>;
  /** Dev: put the train's head at this distance along the line (0 = in the Werf store). */
  jump(s: number): void;
  /** Dev: the length of the line and the arc position of each crane pass. */
  plan(): { length: number; passes: Array<{ crane: number; s: number; mode: string }> };
  /**
   * Dev (M6 cranes): the closest the cranes came to each other (jibs and cabins, portals), to the
   * masts and to the train since the last reset, and what each crane did. `rules: false` turns the
   * checks off (the old behaviour), `true` on again.
   */
  craneCheck(o?: { reset?: boolean; rules?: boolean }): Record<string, unknown>;
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
/** The rear horse's trace chain is drawn as pieces of the coupling about this long (m), at most TRACE_PIECES. */
const TRACE_LINK = 0.36;
const TRACE_PIECES = 7;
/** The horses' trace chains (the wheeler's to its spreader, the leader's to the wheeler's hame tugs): at most so many pieces. */
const HARNESS_PIECES = 40;
/** In a horse's frame (x, up, ahead): where a trace starts (build_props.py TRACE_END, the hame tug's buckle), the point
 * it passes outside the quarters, the spreader's end behind the wheeler's hocks. */
const TUG: [number, number, number] = [0.31, 1.52, 0.8];
const PAST: [number, number, number] = [0.41, 1.22, -0.62];
const SPREAD: [number, number, number] = [0.42, 0.98, -1.4];
const TRACES = 3.1; // lead horse's middle to the rear horse's middle is HORSE_GAP; rear horse to the first wagon's buffers

// the portal crane in its own frame (three.js: build_boats.py portal_crane, blender y = -z here)
/** Its four legs on their bogies: [x, z, half x, half z] (boats.ts CRANE_FEET). */
const CRANE_FEET: Array<[number, number, number, number]> = [
  [2.2, 2.6, 0.75, 0.3],
  [-2.2, 2.6, 0.75, 0.3],
  [2.2, -2.6, 0.75, 0.3],
  [-2.2, -2.6, 0.75, 0.3],
];
/** Bogie wheels: two per leg, 0.3 m, rolling along the frame's x. */
const CRANE_WHEELS: Array<[number, number]> = CRANE_FEET.flatMap(([x, z]) => [[x - 0.42, z], [x + 0.42, z]] as Array<[number, number]>);
const CRANE_WHEEL_R = 0.3;
const CRANE_V = 0.42; // m/s along the runway
/**
 * Never closer to the next crane on the runway (M6 cranes: 17, was 12). With the hook 11.5 m out
 * and a load on it, a crane can lower into a wagon on its neighbour's side only if that
 * neighbour's portal stands about 16.2 m off or more (shared/cranes.ts); at 12 m the hook of a
 * crane travelling with its jib along the runway hung in its neighbour's cabin.
 */
const CRANE_GAP = 17;
/** Blocked this long (s), a crane gives up what it is doing (a lift for the train: 45). */
const GIVE_UP = 12;
const GIVE_UP_WORK = 45;
/** The tall things on ships count from this height over the waterline (boats.ts tall default). */
const TALL_ABOVE = 4;
const MAST_R = 0.75;
const TRAVEL_HOOK = 6.8; // hook height for travelling
/**
 * Up on the crane (M3g part 4; build_boats.py portal_jib DECK_OUTLINE, RAIL_RIGHT, CAB): the gallery
 * round the driver's cabin at DECK_Y, the doorway in the cabin's +x wall, and the cabin floor a step
 * up. Jib frame = crane frame with the jib at rest (you only get up there with the jib at rest, and
 * it stays so). Rects inside the rail and the walls; overlapping ones join (rijnkaai.ts raised decks).
 */
const DECK_Y = 5.8 + 0.62;
const CAB_Y = 5.8 + 0.74;
const DECK_AREAS: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; y: number }> = [
  { minX: 1.29, maxX: 1.93, minZ: -1.93, maxZ: 1.73, y: DECK_Y }, // the +x side gallery, to the front rail
  { minX: -1.93, maxX: -1.29, minZ: -1.93, maxZ: 1.73, y: DECK_Y }, // the -x side gallery
  { minX: -1.93, maxX: 1.93, minZ: -1.93, maxZ: -1.44, y: DECK_Y }, // behind the cabin, stepped in to the cut corners
  { minX: -1.45, maxX: 1.45, minZ: -2.22, maxZ: -1.44, y: DECK_Y },
  { minX: -1.1, maxX: 1.1, minZ: -2.44, maxZ: -1.44, y: DECK_Y },
  { minX: -0.85, maxX: 0.85, minZ: -2.63, maxZ: -1.44, y: DECK_Y },
  { minX: -0.24, maxX: 0.24, minZ: -2.93, maxZ: -2.2, y: DECK_Y }, // the tongue at the ladder head
  { minX: 0.6, maxX: 1.7, minZ: -1.06, maxZ: -0.39, y: DECK_Y }, // through the doorway
  { minX: 0.47, maxX: 1.13, minZ: -1.24, maxZ: 1.38, y: CAB_Y }, // the cabin's aisle past the winch
  { minX: -0.76, maxX: 1.13, minZ: 0.8, maxZ: 1.38, y: CAB_Y }, // the driver's place at the front window
];
/** Places for jobs up there (crane frame, jib at rest): the driver's window, the gallery over the jib heel. */
export type CraneSpotKind = "crane_cabin" | "crane_gallery";
export const CRANE_SPOTS: ReadonlyArray<{ kind: CraneSpotKind; x: number; z: number; y: number; label: string }> = [
  { kind: "crane_cabin", x: 0.2, z: 1.1, y: CAB_Y, label: "the crane driver's cabin, at the window over the jib" },
  { kind: "crane_gallery", x: 1.62, z: 1.4, y: DECK_Y, label: "the crane's gallery, over the jib heel" },
];
/** The ladder up the back of the portal (rungs at z -3.05): where you stand, where you hang, where you step off at the top. */
const LADDER_FOOT: [number, number] = [0, -3.55];
const LADDER_HANG: [number, number] = [0, -3.4];
const LADDER_HEAD: [number, number] = [0, -2.45];

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

/** The hook block's sheave pin over the hook's throat: the falls (ropeGeometry) end there, either side of the sheave. */
const HOOK_BLOCK = 0.66;
/** The falls hang this far either side of the jib's line (the block's sheave, the crosshead at the jib head in boats.glb). */
const FALL_X = 0.115;

/** Bars through the points (a bent forged bar), each a little longer so the bends close; sizes per segment. */
function bentBar(k: Kit, pts: Array<[number, number, number]>, sizes: number[], col: RGB): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = new THREE.Vector3(...pts[i]);
    const b = new THREE.Vector3(...pts[i + 1]);
    const d = b.clone().sub(a).normalize().multiplyScalar(sizes[i] * 0.4);
    k.bar(a.sub(d), b.add(d), sizes[i], col);
  }
}

function hookGeometry(): THREE.BufferGeometry {
  // origin at the hook's throat, where the sling hangs (the crane detail pass, 2026-09-27): the block is
  // a sheave between two cheek plates (the falls come down either side of it into the block), its pin,
  // a crosshead under it that holds the hook's shank with a nut; below, a forged hook with its point up
  const k = new Kit();
  for (const z of [-0.062, 0.062]) {
    k.box(0.3, 0.26, 0.022, 0, HOOK_BLOCK - 0.13, z, IRON); // cheek plate: its square foot...
    k.cyl(0.15, 0.15, 0.022, 12, 0, HOOK_BLOCK, z, IRON, Math.PI / 2); // ...and its round head
  }
  k.cyl(0.12, 0.12, 0.08, 14, 0, HOOK_BLOCK, 0, IRON_LIGHT, Math.PI / 2); // the sheave
  k.cyl(0.035, 0.035, 0.2, 6, 0, HOOK_BLOCK, 0, IRON, Math.PI / 2); // its pin, the ends proud of the cheeks
  k.box(0.28, 0.07, 0.17, 0, 0.44, 0, IRON); // the crosshead between the cheeks' feet
  k.cyl(0.055, 0.055, 0.06, 6, 0, 0.5, 0, IRON_LIGHT); // the shank's nut on it
  // the hook, in the y-z plane: the shank comes down over the throat, the back swings out, round
  // under the throat and up to the point
  const R = 0.0975;
  const at = (deg: number): [number, number, number] => [0, 0.07 + R * Math.sin((deg * Math.PI) / 180), R * Math.cos((deg * Math.PI) / 180)];
  bentBar(k, [[0, 0.42, 0], [0, 0.2, 0], at(150), at(185), at(220), at(255), at(290), at(325), at(360), at(25)],
    [0.06, 0.06, 0.06, 0.058, 0.055, 0.052, 0.047, 0.04, 0.032], IRON_LIGHT); // worn bright where the slings run
  return k.build();
}

function slingGeometry(): THREE.BufferGeometry {
  // an iron ring in the hook's throat, and four rope legs from it down to the corners of a load whose top is SLING below
  const k = new Kit();
  const ring: Array<[number, number, number]> = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ring.push([0.055 * Math.sin(a), -0.05 + 0.055 * Math.cos(a), 0]);
  }
  bentBar(k, ring, new Array(8).fill(0.018), IRON);
  for (const [x, z] of [[-0.42, -0.38], [0.42, -0.38], [-0.42, 0.38], [0.42, 0.38]]) {
    k.bar(new THREE.Vector3(x * 0.06, -0.1, z * 0.06), new THREE.Vector3(x, -SLING, z), 0.034, ROPE);
  }
  return k.build();
}

function ropeGeometry(): THREE.BufferGeometry {
  // a unit rope from y 0 down to y -1: scaled in y to the length; two falls of wire rope, either side of the block's sheave
  const k = new Kit();
  for (const x of [-FALL_X, FALL_X]) k.cyl(0.016, 0.016, 1, 6, x, -0.5, 0, IRON_LIGHT);
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
/**
 * The portal model carries its bogie wheels (merged, they cannot turn) and a 10 m stub of each
 * rail (it would slide along with a travelling crane): fold both away; the wheels are drawn
 * here and the runways by tracks.ts. The portal geometry is shared, so this runs once.
 */
const foldedPortal = new WeakSet<THREE.BufferGeometry>();
function foldPortal(crane: THREE.Object3D): void {
  const visit = (o: THREE.Object3D) => {
    if (o.name === "jib") return;
    const m = o as THREE.Mesh;
    if ((m.isMesh || (o as THREE.LineSegments).isLineSegments) && !foldedPortal.has(m.geometry)) {
      foldedPortal.add(m.geometry);
      const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
      let n = 0;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        let fold = y < 0.075 && Math.abs(x) > 4.4; // a rail stub's ends
        if (!fold && y < 0.66 && Math.abs(Math.abs(z) - 2.6) < 0.13) {
          for (const [wx] of CRANE_WHEELS) {
            const r = Math.hypot(x - wx, y - 0.32);
            if (Math.abs(r - CRANE_WHEEL_R) < 0.015 || r < 0.01) fold = true;
          }
        }
        if (fold) {
          pos.setXYZ(i, 2.2, 0.55, 2.6); // inside a bogie
          n++;
        }
      }
      if (n) {
        pos.needsUpdate = true;
        m.geometry.computeBoundingSphere();
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(crane);
}

function craneWheelGeometry(): THREE.BufferGeometry {
  // axle along z (the crane detail pass, 2026-09-27): a double-flanged tyre (a travelling crane's wheel
  // keeps to its rail both ways), six spokes to see it turn, the hub, the axle's ends in the bogie's
  // axle boxes (build_boats.py bogie; tools/blender preview_wheel is the same wheel)
  const k = new Kit();
  const R = CRANE_WHEEL_R;
  const tyre: Array<[number, number]> = [[R + 0.025, -0.062], [R, -0.045], [R, 0.045], [R + 0.025, 0.062], [R - 0.05, 0.062], [R - 0.05, -0.062], [R + 0.025, -0.062]];
  k.lathe(tyre, 12, 0, 0, 0, IRON_LIGHT, Math.PI / 2);
  k.cyl(0.075, 0.075, 0.12, 6, 0, 0, 0, IRON, Math.PI / 2);
  k.cyl(0.035, 0.035, 0.4, 5, 0, 0, 0, IRON, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.box(0.04, 0.19, 0.03, 0.165 * Math.sin(a), 0.165 * Math.cos(a), 0, IRON, 0, 0, -a);
  }
  return k.build();
}

const folded = new WeakSet<THREE.BufferGeometry>();
function foldHook(jib: THREE.Object3D): void {
  jib.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!(m.isMesh || (o as THREE.LineSegments).isLineSegments) || folded.has(m.geometry)) return;
    folded.add(m.geometry);
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    const out = (i: number) => pos.getZ(i) > 10.6 && Math.abs(pos.getX(i)) < 0.65 && pos.getY(i) < 7.9;
    // a rigging line (the model's falls) folds whole when one end is out there: its top stays by the head
    // sheave otherwise, a stub of rope beside the one drawn here (build_boats.py fold_check checks the model)
    const lines = (o as THREE.LineSegments).isLineSegments;
    const flag = Array.from({ length: pos.count }, (_, i) => out(i));
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (flag[i] || (lines && flag[i ^ 1])) {
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
  /** Its place in the crane sites (the same on every PC: its id in the net state). */
  sid: number;
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
  // --- travel along the runway (null axis: it stays put)
  axis: "x" | "z" | null;
  lo: number;
  hi: number;
  /** Where it stands along the runway, where it goes, how fast. */
  pos: number;
  target: number | null;
  speed: number;
  mode: "berth" | "swingIn" | "travel" | "swingOut";
  /** Seconds before it moves on to another boat. */
  stay: number;
  /** Places along the runway with a hold under the hook, and the jib angle there. */
  berths: Array<{ p: number; a: number }>;
  nextA: number;
  stuck: number;
  roll: number;
  legs: Rect[];
  /** Its walkable areas up there (DECK_AREAS in place). */
  decks: RaisedDeck[];
  /** The train has it (from the approach to the last lift). */
  reserved: boolean;
  /** The player stands at its ladder (seconds), or is on it. */
  parkFor: number;
  occupied: boolean;
  // --- keeping clear (M6 cranes, shared/cranes.ts)
  /** Cranes that can ever come within reach; the tall things on ships within reach of its runway. */
  near: Crane[];
  masts: Array<[number, number, number, number]>;
  /** Its parts where it stands now, and the pose they were made for. */
  parts: Capsule[];
  partsAt: [number, number, number, number];
  /** The jib's side along the runway for this trip (chosen as it sets off), and the sides clear of masts. */
  along: number;
  sides: number[];
  /** A step was refused this frame (by what), and for how many seconds in a row. */
  blocked: boolean;
  blockedBy: string;
  blocker: Crane | null;
  blockT: number;
  /** Asked to make way: seconds left, the way to go (a push away from those asking), the rank they lend it. */
  yieldT: number;
  awayX: number;
  awayZ: number;
  lend: number;
  /** Its cabin or portal (not its jib) is in the way: it moves along to a berth away from them. */
  moveOn: boolean;
  yielding: boolean;
  /** Found nowhere to move along to: seconds before it looks again. */
  noAway: number;
  /** For the dev check. */
  stat: CraneStat;
}

interface CraneStat {
  lifts: number;
  trips: number;
  swings: number;
  yields: number;
  blockedS: number;
  maxBlock: number;
  gaveUp: number;
  /** Train stops let go because no wagon row or swing was clear. */
  skipped: number;
  /** Seconds blocked, by what. */
  by: Record<string, number>;
}
const newStat = (): CraneStat => ({ lifts: 0, trips: 0, swings: 0, yields: 0, blockedS: 0, maxBlock: 0, gaveUp: 0, skipped: 0, by: {} });

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

  // --- the gate of the Werf store: where the line passes its facade and the tips of its open leaves
  const gate = opts.gate ?? null;
  const gateOut = { face: -1, tip: -1 };
  const gateBack = { face: -1, tip: -1 };
  /** Anything wholly west of this is in the dark behind the gate: not drawn. */
  const hideX = gate ? gate.x - 5.2 : -Infinity;
  if (gate) {
    for (let i = 0; i < line.x.length - 1; i++) {
      const a = line.x[i];
      const b = line.x[i + 1];
      const s = i * Line.STEP;
      for (const [x, key] of [[gate.x, "face"], [gate.x + gate.reach, "tip"]] as const) {
        if (a < x && b >= x && gateOut[key] < 0) gateOut[key] = s;
        if (a > x && b <= x) gateBack[key] = s;
      }
    }
  }
  const fillRandom = () => {
    for (const w of wagons) {
      const rows = w.goods ? Math.floor(rnd() * 3) : 0;
      w.slots.fill(false);
      for (let r = 0; r < rows; r++) w.slots[r * 2] = w.slots[r * 2 + 1] = true;
    }
  };
  fillRandom();
  // the wagons, wheel sets, couplings and goods from wagons.glb (tools/blender/build_wagons.py) when it loaded, else
  // the code-built parts; the same InstancedMeshes either way (one draw call per part)
  const W = opts.wagons ?? null;
  const goodsMat = W ? (opts.props.materials.goods ?? null) : null;
  const kinds: WagonKind[] = ["open", "flat", "van"];
  const bodies = new Map<WagonKind, THREE.InstancedMesh>();
  for (const k of kinds)
    bodies.set(k, inst(W ? W.wagon[k] : wagonGeometry(k), W ? W.material : woodMat, wagons.filter((w) => w.kind === k).length, `wagon_${k}`));
  const wheels = inst(W ? W.wheelset : wheelsetGeometry(), W ? W.material : woodMat, wagons.length * 2, "wagon_wheels");
  // the couplings between the wagons (one each), then the rear horse's trace chain in pieces of about TRACE_LINK
  const links = inst(W ? W.coupling : linkGeometry(), W ? W.material : woodMat, wagons.length + TRACE_PIECES + HARNESS_PIECES, "wagon_chains");
  const goodsMesh = new Map<GoodsKind, THREE.InstancedMesh>();
  for (const g of GOODS)
    goodsMesh.set(
      g,
      inst(W && goodsMat ? W.goods[g] : unitGeometry(g), W && goodsMat ? goodsMat : g === "crates" ? crateMat : g === "casks" ? woodMat : sackMat, 48, `goods_${g}`),
    );
  // the train's two and the omnibuses' pairs: red roans, the Brabant's own colour (horseGait.ts coats)
  const horses = new HorsePool(scene, opts.props, 2 + (opts.spareHorses ?? 2), "roan");
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
    foldPortal(site.obj);
    const passes = line.passes(site.x, site.z, 1.0);
    if (!passes.length) return;
    const c: Crane = {
      site,
      jib,
      index: cranes.length,
      sid: i,
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
      axis: null,
      lo: 0,
      hi: 0,
      pos: 0,
      target: null,
      speed: 0,
      mode: "berth",
      stay: 20 + rnd() * 40,
      berths: [],
      nextA: 0,
      stuck: 0,
      roll: 0,
      legs: CRANE_FEET.map(() => ({ minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6 })),
      decks: DECK_AREAS.map((a) => ({ minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, y: a.y })),
      reserved: false,
      parkFor: 0,
      occupied: false,
      near: [],
      masts: [],
      parts: [],
      partsAt: [NaN, NaN, NaN, NaN],
      along: Math.PI / 2,
      sides: [],
      blocked: false,
      blockedBy: "",
      blocker: null,
      blockT: 0,
      yieldT: 0,
      awayX: 0,
      awayZ: 0,
      lend: 0,
      moveOn: false,
      yielding: false,
      noAway: 0,
      stat: newStat(),
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

  // --- travelling cranes: each on its runway (DECOR crane_rails, 5.2 m apart, one either side of
  // the line), going from boat to boat. A berth is a place along the runway with a moored hold
  // under the hook (the jib no more than 0.45 rad off its rest).
  const craneRails = opts.tracks.crane_rails ?? [];
  /** Crane frame to world: (x, z) local -> world, for a crane standing at (cx, cz). */
  const toWorld = (c: Crane, lx: number, lz: number, cx = c.site.x, cz = c.site.z): P => {
    const co = Math.cos(c.site.yaw);
    const si = Math.sin(c.site.yaw);
    return [cx + lx * co + lz * si, cz - lx * si + lz * co];
  };
  const rectAt = (c: Crane, r: { minX: number; maxX: number; minZ: number; maxZ: number }, out: { minX: number; maxX: number; minZ: number; maxZ: number }) => {
    const [ax, az] = toWorld(c, r.minX, r.minZ);
    const [bx, bz] = toWorld(c, r.maxX, r.maxZ);
    out.minX = Math.min(ax, bx);
    out.maxX = Math.max(ax, bx);
    out.minZ = Math.min(az, bz);
    out.maxZ = Math.max(az, bz);
  };
  // --- keeping clear of each other, the masts and the train (M6 cranes, shared/cranes.ts)
  let rules = true;
  const loadOf = (c: Crane) => (c.carry ? SLING + UNIT_H[c.carry] : 0);
  const poseOf = (c: Crane, pos = c.pos, a = c.a, hy = c.hy): CranePose => {
    const [x, z] = siteAt(c, pos);
    return { x, z, yaw: c.site.yaw, a, hy, load: loadOf(c) };
  };
  /** A crane's parts where it stands now (made again only when it has moved). */
  const partsOf = (c: Crane): Capsule[] => {
    const k = c.partsAt;
    const load = loadOf(c);
    if (k[0] !== c.pos || k[1] !== c.a || k[2] !== c.hy || k[3] !== load) {
      c.parts = craneParts(poseOf(c));
      c.partsAt = [c.pos, c.a, c.hy, load];
    }
    return c.parts;
  };
  /**
   * The tall things on ships near the jib of a crane set so (`high`: at the highest tide). The jib
   * keeps off them; the hook's rope may hang past rigging into a hold (it is the jib Steve saw).
   */
  function mastCaps(c: Crane, p: CranePose, high = false): Capsule[] {
    const out: Capsule[] = [];
    if (!c.masts.length) return out;
    const h = p.yaw + p.a;
    const ux = Math.sin(h);
    const uz = Math.cos(h);
    for (const m of c.masts) {
      // in plan: near the line from the axis out to the hook (else it cannot touch)
      const dx = m[0] - p.x;
      const dz = m[1] - p.z;
      const t = THREE.MathUtils.clamp(dx * ux + dz * uz, 0, 11.6);
      if (Math.hypot(dx - ux * t, dz - uz * t) > MAST_R + 0.75 + JIB_GAP + 0.6) continue;
      const w = Math.max(high ? Math.max(HW_MAX, DOCK_Y) : levelAt(m[0], m[1]), m[3]);
      out.push(mast(m[0], m[1], w + TALL_ABOVE, w + m[2], MAST_R));
    }
    return out;
  }
  /** The goods train's wagons and horses where they are this frame (for the hooks of the other cranes). */
  let trainCaps: Capsule[] = [];
  /** The crane the train works with, or has booked: its hook goes down into the wagons. */
  const withTrain = (c: Crane) => c.reserved || c.ops.length > 0;
  /**
   * How much room a crane set so would have beyond the margins, thing by thing: for each crane
   * that can reach it the room of its jib, fall and cabin and the room between the portals, then
   * the masts, then the train. Negative: too close. Also which is worst, and the other's part there.
   */
  function roomOf(c: Crane, p: CranePose, out: number[]): { k: number; theirs: PartKind | null } {
    const mine = craneParts(p);
    let worst = Infinity;
    let k = -1;
    let theirs: PartKind | null = null;
    out.length = 0;
    for (const o of c.near) {
      if (Math.hypot(o.site.x - p.x, o.site.z - p.z) > REACH) {
        out.push(Infinity, Infinity);
        continue;
      }
      const g = craneGap(mine, partsOf(o));
      const jg = g.gap - JIB_GAP;
      const pg = portalGap(p, poseOf(o)) - PORTAL_GAP;
      out.push(jg, pg);
      if (jg < worst) {
        worst = jg;
        k = out.length - 2;
        theirs = g.theirs;
      }
      if (pg < worst) {
        worst = pg;
        k = out.length - 1;
        theirs = "portal";
      }
    }
    out.push(thingsGap(mine, mastCaps(c, p), ["jib"]) - JIB_GAP);
    out.push(!withTrain(c) && trainCaps.length ? thingsGap(mine, trainCaps, ["fall"]) - JIB_GAP : Infinity);
    for (const i of [out.length - 2, out.length - 1]) {
      if (out[i] < worst) {
        worst = out[i];
        k = i;
        theirs = null;
      }
    }
    return { k, theirs };
  }
  const minOf = (a: number[]) => a.reduce((m, v) => Math.min(m, v), Infinity);
  const whatOf = (c: Crane, k: number) =>
    k < 0 ? "" : k < c.near.length * 2 ? `crane ${c.near[k >> 1].index}${k & 1 ? " portal" : ""}` : k === c.near.length * 2 ? "mast" : "train";
  /** Its rank when it is in another's way (shared/cranes.ts outranks). */
  const rank = (c: Crane) =>
    Math.max(c.occupied || c.parkFor > 0 ? 4 : withTrain(c) ? 3 : c.mode !== "berth" ? 2 : 1, c.yieldT > 0 ? c.lend : 0);
  /** The player's crane stands still: it cannot make way. */
  const canYield = (c: Crane) => !c.occupied && c.parkFor <= 0;
  /** Ask crane o to make way for c: its jib away from c, or (its cabin or portal in the way) along to another berth. */
  function ask(o: Crane, c: Crane, theirs: PartKind | null): void {
    o.yieldT = 1.2;
    o.lend = Math.max(o.lend, rank(c) - 0.5);
    const d = Math.hypot(o.site.x - c.site.x, o.site.z - c.site.z) || 1;
    o.awayX += (o.site.x - c.site.x) / d;
    o.awayZ += (o.site.z - c.site.z) / d;
    if (theirs !== "jib" && theirs !== "fall") o.moveOn = true;
  }
  const after: number[] = [];
  const before: number[] = [];
  /** A step refused by thing k (roomOf's order): it stays; a crane it outranks there is asked to make way. */
  function refused(c: Crane, k: number, theirs: PartKind | null): void {
    c.blocked = true;
    c.blockedBy = whatOf(c, k);
    const o = k < c.near.length * 2 ? c.near[k >> 1] : null;
    c.blocker = o;
    if (o && canYield(o) && outranks({ rank: rank(c), index: c.index }, { rank: rank(o), index: o.index })) ask(o, c, theirs);
  }
  /**
   * Move a crane to runway position `pos`, jib angle `a`, hook height `hy`, if the whole step keeps
   * its room (checked every 0.3 m of the jib head's path): every other crane, mast and the train
   * at least the margin off, or no closer than before the step. Refused: it stays, and a crane it
   * outranks that is in its way is asked to make way. Returns whether it moved.
   */
  function tryMove(c: Crane, pos: number, a: number, hy: number): boolean {
    const da = angDiff(a, c.a);
    if (pos === c.pos && da === 0 && hy === c.hy) return true;
    if (rules) {
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(da) * 11.6, Math.abs(pos - c.pos), Math.abs(hy - c.hy)) / 0.3));
      let had = false;
      for (let i = 1; i <= n; i++) {
        const f = i / n;
        const r = roomOf(c, poseOf(c, c.pos + (pos - c.pos) * f, c.a + da * f, c.hy + (hy - c.hy) * f), after);
        if (minOf(after) >= 0) continue;
        if (!had) {
          roomOf(c, poseOf(c), before);
          had = true;
        }
        let bad = -1;
        for (let k = 0; k < after.length && bad < 0; k++) if (after[k] < 0 && after[k] < before[k] - 1e-6) bad = k;
        if (bad < 0) continue;
        refused(c, bad, bad === r.k ? r.theirs : bad & 1 ? "portal" : "body");
        return false;
      }
    }
    const moved = pos !== c.pos;
    c.pos = pos;
    c.a = a;
    c.hy = hy;
    if (moved) placeCrane(c);
    return true;
  }
  /**
   * Is the jib's whole swing from a0 to a1 (the short way round, as it slews) clear of the ships'
   * masts, for a crane standing at (x, z)? For planning a trip or a lift (M6 cranes).
   */
  function mastPathClear(c: Crane, x: number, z: number, a0: number, a1: number): boolean {
    if (!rules || !c.masts.length) return true;
    const d = angDiff(a1, a0);
    const n = Math.max(1, Math.ceil(Math.abs(d) / 0.04));
    for (let i = 0; i <= n; i++) {
      const p: CranePose = { x, z, yaw: c.site.yaw, a: a0 + (d * i) / n, hy: HOOK_REST, load: 0 };
      if (thingsGap(craneParts(p), mastCaps(c, p), ["jib"]) < JIB_GAP) return false;
    }
    return true;
  }
  /** Is the hook over the railway (a crane not working the train keeps it up there)? */
  const railKey = (x: number, z: number) => (Math.floor(x) + 4096) * 8192 + (Math.floor(z) + 4096);
  const railBand = new Set<number>();
  for (let i = 0; i < line.x.length; i += 4) {
    if (line.x[i] < -316) continue;
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) if (dx * dx + dz * dz <= 13) railBand.add(railKey(line.x[i] + dx, line.z[i] + dz));
  }
  const overRail = (c: Crane) => {
    const wa = c.site.yaw + c.a;
    return railBand.has(railKey(c.site.x + Math.sin(wa) * R_HOOK, c.site.z + Math.cos(wa) * R_HOOK));
  };
  /** Where a crane would stand at runway position p. */
  const siteAt = (c: Crane, p: number): P => (c.axis === "x" ? [p, c.site.z] : c.axis === "z" ? [c.site.x, p] : [c.site.x, c.site.z]);
  /**
   * A hold under the hook for a crane standing at (cx, cz): the jib angle nearest rest, or null.
   * The jib and the hook's fall keep clear of the ships' masts and rigging there, even at the
   * highest spring tide (M6 cranes).
   */
  const holdAngle = (c: Crane, cx: number, cz: number, maxK = 5): number | null => {
    for (let k = 0; k <= maxK; k++) {
      for (const sgn of k ? [1, -1] : [1]) {
        const ca = sgn * k * 0.09;
        const wa = c.site.yaw + ca;
        if (!opts.hullAt(cx + Math.sin(wa) * R_HOOK, cz + Math.cos(wa) * R_HOOK)) continue;
        const p: CranePose = { x: cx, z: cz, yaw: c.site.yaw, a: ca, hy: HOOK_REST, load: 0 };
        if (thingsGap(craneParts(p), mastCaps(c, p, true), ["jib"]) >= JIB_GAP) return ca;
      }
    }
    return null;
  };
  /** Its runway in plan (a point for a crane that stays put). */
  const runOf = (c: Crane): Capsule => {
    const [ax, az] = siteAt(c, c.axis ? c.lo : c.pos);
    const [bx, bz] = siteAt(c, c.axis ? c.hi : c.pos);
    return { ax, ay: 0, az, bx, by: 0, bz, r: 0, kind: "leg" };
  };
  /** Move a crane's model, legs and walkable areas to where it stands now. */
  function placeCrane(c: Crane): void {
    const [x, z] = siteAt(c, c.pos);
    c.site.x = x;
    c.site.z = z;
    c.site.obj.position.x = x;
    c.site.obj.position.z = z;
    CRANE_FEET.forEach(([lx, lz, hx, hz], i) => rectAt(c, { minX: lx - hx, maxX: lx + hx, minZ: lz - hz, maxZ: lz + hz }, c.legs[i]));
    DECK_AREAS.forEach((a, i) => rectAt(c, a, c.decks[i]));
  }
  for (const c of cranes) {
    for (const [x0, z0, x1, z1] of craneRails) {
      const inX = c.site.x >= Math.min(x0, x1) - 0.1 && c.site.x <= Math.max(x0, x1) + 0.1;
      const inZ = c.site.z >= Math.min(z0, z1) - 0.1 && c.site.z <= Math.max(z0, z1) + 0.1;
      if (Math.abs(z0 - z1) < 0.01 && inX && Math.abs(Math.abs(z0 - c.site.z) - 2.6) < 0.2) {
        c.axis = "x";
        c.lo = Math.min(x0, x1) + 3.2;
        c.hi = Math.max(x0, x1) - 3.2;
      } else if (Math.abs(x0 - x1) < 0.01 && inZ && Math.abs(Math.abs(x0 - c.site.x) - 2.6) < 0.2) {
        c.axis = "z";
        c.lo = Math.min(z0, z1) + 3.2;
        c.hi = Math.max(z0, z1) - 3.2;
      }
    }
    if (c.pile) c.axis = null; // a crane that works a pile stays by it
    c.pos = c.axis === "x" ? c.site.x : c.site.z;
    placeCrane(c);
    for (const d of c.decks) opts.raised?.add(d);
    // the tall things on ships its jib could reach from anywhere on its runway
    const runway = runOf(c);
    c.masts = (opts.tall ?? []).filter(([x, z]) => segDist(runway, { ax: x, ay: 0, az: z, bx: x, by: 0, bz: z, r: 0, kind: "mast" }) < R_HOOK + 3.5);
    // its hold where it stands: clear of the masts at high water
    if (c.shipA !== null) {
      const h0 = holdAngle(c, c.site.x, c.site.z, 14);
      if (h0 !== null) c.shipA = c.a = h0;
    }
    if (!c.axis) continue;
    // the Werf runway runs into the railway gatehouse: keep the legs clear of it
    if (gate && c.axis === "x" && c.lo < gate.x + 6.5) c.lo = gate.x + 6.5;
    // M6 (vehicle deadlocks, 2026-09-24): where the goods train's line leaves the runway (the curve
    // up to the lock bridge) it crosses a leg line; a crane standing there shut the train in for good.
    // Keep the legs clear of the line: the runway's working range ends short of the crossing.
    {
      const fouls = (p: number) => {
        const [cx, cz] = siteAt(c, p);
        for (const lz of [-2.6, 2.6])
          for (const lx of [-2.95, -1.45, 1.45, 2.95]) {
            const [x, z] = toWorld(c, lx, lz, cx, cz);
            for (let i = 0; i < line.x.length; i += 2) if (Math.abs(line.x[i] - x) < 1.8 && Math.abs(line.z[i] - z) < 1.8) return true;
          }
        return false;
      };
      while (c.hi > c.lo && fouls(c.hi)) c.hi -= 0.5;
      while (c.lo < c.hi && fouls(c.lo)) c.lo += 0.5;
      if (c.pos > c.hi || c.pos < c.lo) {
        c.pos = Math.max(c.lo, Math.min(c.hi, c.pos));
        placeCrane(c);
      }
    }
    let run: Array<{ p: number; a: number }> = [];
    // a stretch with holds under the hook, split into berths about 9 m apart (a boat or two each)
    const flush = () => {
      for (let i = 0; i < run.length; i += 9) {
        const part = run.slice(i, i + 9);
        if (part.length >= 3 || run.length < 3) c.berths.push(part.reduce((b, q) => (Math.abs(q.a) < Math.abs(b.a) ? q : b)));
      }
      run = [];
    };
    for (let p = c.lo; p <= c.hi; p += 1) {
      const [cx, cz] = siteAt(c, p);
      const a = holdAngle(c, cx, cz);
      if (a === null) flush();
      else run.push({ p, a });
    }
    flush();
  }
  // survey the runways once: where the walk map (walls, the quay edge) closes the bogies' lines already
  const runKey = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const runwayBad = new Set<string>();
  for (const c of cranes) {
    if (!c.axis) continue;
    for (let p = c.lo - 4; p <= c.hi + 4; p += 0.5) {
      const [cx, cz] = siteAt(c, p);
      for (const lz of [-2.6, 2.6]) {
        for (const lx of [-2.95, -1.45, 1.45, 2.95]) {
          const [x, z] = toWorld(c, lx, lz, cx, cz);
          const k = runKey(x, z);
          if (!runwayBad.has(k) && !opts.isFree(Math.round(x * 2) / 2, Math.round(z * 2) / 2, 0.15)) runwayBad.add(k);
        }
      }
    }
  }
  // the cranes that can ever come within reach of each other (their runways closer than two jibs)
  for (const c of cranes) c.near = cranes.filter((o) => o !== c && segDist(runOf(c), runOf(o)) < REACH + 1);

  const sameRunway = (c: Crane, o: Crane) =>
    o !== c && !!c.axis && o.axis === c.axis && (c.axis === "x" ? Math.abs(o.site.z - c.site.z) < 1 : Math.abs(o.site.x - c.site.x) < 1);
  /** The stretch of runway another crane holds: where it is and where it is going. */
  const heldBy = (o: Crane): [number, number] => [Math.min(o.pos, o.target ?? o.pos), Math.max(o.pos, o.target ?? o.pos)];

  /** Choose the next boat: one between the neighbours (12 m clear of them), not this one. */
  function nextBerth(c: Crane): { p: number; a: number } | null {
    let lo = c.lo;
    let hi = c.hi;
    for (const o of cranes) {
      if (!sameRunway(c, o)) continue;
      const [a, b] = heldBy(o);
      if (o.pos < c.pos) lo = Math.max(lo, b + CRANE_GAP);
      else hi = Math.min(hi, a - CRANE_GAP);
    }
    // M6 cranes: only a berth it can swing to without its jib going through a mast: in along the
    // runway here, out over the hold there (and the side along the runway that allows it)
    const sidesOf = new Map<{ p: number; a: number }, number[]>();
    const ok = c.berths.filter((b) => {
      if (b.p < lo || b.p > hi || Math.abs(b.p - c.pos) <= 4) return false;
      const [tx, tz] = siteAt(c, b.p);
      const sides = [alongA(c), -alongA(c)].filter((s) => mastPathClear(c, c.site.x, c.site.z, c.a, s) && mastPathClear(c, tx, tz, s, b.a));
      sidesOf.set(b, sides);
      return sides.length > 0;
    });
    const pick = (b: { p: number; a: number } | null) => {
      c.sides = b ? (sidesOf.get(b) ?? []) : [];
      return b;
    };
    if (c.moveOn) {
      // making way: the berth furthest from those asking (their push along the runway)
      const push = c.axis === "x" ? c.awayX : c.awayZ;
      const away = ok.filter((b) => (b.p - c.pos) * push > 3);
      return pick(away.length ? away.reduce((m, b) => ((b.p - c.pos) * push > (m.p - c.pos) * push ? b : m)) : null);
    }
    return pick(ok.length ? ok[Math.floor(c.r() * ok.length)] : null);
  }

  const ownOut = (c: Crane, fn: () => boolean): boolean => {
    const keep = c.legs.map((r) => [r.minX, r.maxX]);
    for (const r of c.legs) r.minX = r.maxX = 1e6;
    const v = fn();
    c.legs.forEach((r, k) => ([r.minX, r.maxX] = keep[k]));
    return v;
  };
  /** Something in the way of the legs on the leading side: the player, people, things, another crane. */
  function travelBlocked(c: Crane, dir: number, player: { x: number; z: number } | null): boolean {
    for (const o of cranes) if (sameRunway(c, o) && (o.pos - c.pos) * dir > 0 && Math.abs(o.pos - c.pos) < CRANE_GAP) return true;
    // the runway direction in the crane's own frame is along its x (river) or its x turned (dock)
    const ex = c.axis === "x" ? Math.cos(c.site.yaw) : -Math.sin(c.site.yaw);
    const sgn = Math.sign(dir * ex) || 1;
    const ahead: P[] = CRANE_FEET.map(([lx, lz, hx]) => toWorld(c, lx + sgn * (hx + 0.5), lz));
    const folk = api.people?.();
    for (const [x, z] of ahead) {
      if (player && Math.hypot(player.x - x, player.z - z) < 1.3) return true;
      if (folk) for (const q of folk) if (Math.abs(q.x - x) < 1.1 && Math.abs(q.z - z) < 1.1) return true;
    }
    // on the bogies' line only (the bollards on the quay edge stand just clear of them); a spot the
    // walk map already closed when the runway was surveyed (a quay wall a hand's width off) does not count
    // (the same half-metre spot the survey looked at: a bogie on the quay edge at x 170.4 read the
    // wall a hand off as in the way, and the crane stood there for good; M6 cranes)
    return ownOut(c, () => ahead.some(([x, z]) => !runwayBad.has(runKey(x, z)) && !opts.isFree(Math.round(x * 2) / 2, Math.round(z * 2) / 2, 0.15)));
  }
  const slewTo = (c: Crane, a: number, dt: number, rate = SLEW): boolean => {
    const d = angDiff(a, c.a);
    if (Math.abs(d) < 0.003) return true;
    const na = c.a + Math.sign(d) * Math.min(Math.abs(d), rate * dt * THREE.MathUtils.clamp(Math.abs(d) / 0.35, 0.18, 1));
    if (!tryMove(c, c.pos, na, c.hy)) return false;
    return Math.abs(angDiff(a, c.a)) < 0.003;
  };
  const hoistTo = (c: Crane, y: number, dt: number): boolean => {
    const d = y - c.hy;
    if (Math.abs(d) < 0.01) return true;
    const ny = c.hy + Math.sign(d) * Math.min(Math.abs(d), HOIST * dt * THREE.MathUtils.clamp(Math.abs(d) / 0.6, 0.25, 1));
    if (!tryMove(c, c.pos, c.a, ny)) return false;
    return Math.abs(y - c.hy) < 0.01;
  };
  /** The jib along the runway for travel (whichever way is nearer). */
  const alongA = (c: Crane) => (Math.abs(angDiff(Math.PI / 2, c.a)) < Math.abs(angDiff(-Math.PI / 2, c.a)) ? Math.PI / 2 : -Math.PI / 2);
  /**
   * The jib along the runway for this trip: the side with more room from the others, where it
   * stands and where it goes (a neighbour 17 m off must not get the hook in its cabin); on a tie
   * the nearer.
   */
  function chooseAlong(c: Crane): number {
    let best = c.sides[0] ?? alongA(c);
    let bestRoom = -Infinity;
    for (const a of c.sides.length ? c.sides : [best, -best]) {
      let room = Infinity;
      for (const pos of [c.pos, c.target ?? c.pos]) {
        roomOf(c, poseOf(c, pos, a, TRAVEL_HOOK), after);
        room = Math.min(room, minOf(after));
      }
      if (room > bestRoom + 0.5 || (room >= 0 && bestRoom < 0)) {
        best = a;
        bestRoom = room;
      }
    }
    return best;
  }

  /**
   * Travel: true while it is busy with it (the lifts wait). At a berth it works (the train's
   * lifts, or its idle swinging), and after a while moves on to another boat: jib in along the
   * runway, hook up, a ring of the bell, slowly along, jib out over the new hold.
   */
  function travelStep(c: Crane, dt: number, player: { x: number; z: number } | null): boolean {
    if (c.mode === "berth" && (c.parkFor > 0 || c.occupied) && !c.reserved && !c.ops.length) {
      // someone at the ladder or on the deck: jib to rest, hook up, stand still
      c.parkFor -= dt;
      slewTo(c, 0, dt, SLEW * 0.7);
      hoistTo(c, HOOK_REST, dt);
      return true;
    }
    if (!c.axis) return false;
    if (c.mode === "berth") {
      if (c.reserved || c.ops.length) return false;
      c.stay -= dt;
      if (c.stay <= 0 && c.berths.length) {
        const b = nextBerth(c);
        c.moveOn = false;
        if (b) {
          c.target = b.p;
          c.nextA = b.a;
          c.mode = "swingIn";
          c.along = chooseAlong(c);
        } else c.stay = 8 + c.r() * 10;
      }
      return false;
    }
    if (c.mode === "swingIn") {
      // blocked too long on the way in (another crane working next to it): back out over the hold
      if (c.reserved || c.occupied || c.parkFor > 0 || c.blockT > GIVE_UP) {
        if (c.blockT > GIVE_UP) c.stat.gaveUp++;
        c.blockT = 0;
        c.target = null;
        c.mode = "swingOut";
        return true;
      }
      const s2 = hoistTo(c, TRAVEL_HOOK, dt);
      const s1 = slewTo(c, c.along, dt);
      if (s1 && s2) {
        c.mode = "travel";
        c.stuck = 0;
        api.onCraneTravel?.(c.site.x, c.site.z);
      }
      return true;
    }
    if (c.mode === "travel") {
      const t = c.target ?? c.pos;
      const dist = Math.abs(t - c.pos);
      const dir = Math.sign(t - c.pos);
      let want = Math.min(CRANE_V, Math.sqrt(2 * 0.12 * dist));
      if (dist > 0.01 && travelBlocked(c, dir, player)) {
        want = 0;
        c.speed = Math.min(c.speed, 0.05);
        c.stuck += dt;
        // booked by the train on its way and held up for good: it lets the stop go (M6 cranes)
        if (c.stuck > 20 && c.reserved) giveUpWork(c);
        // held up too long: it works the boat it has come to (none there: its jib goes back to rest)
        if (c.stuck > 15 && !c.reserved) {
          c.target = c.pos;
          const [cx, cz] = siteAt(c, c.pos);
          c.nextA = holdAngle(c, cx, cz) ?? 0;
        }
      } else c.stuck = 0;
      c.speed += THREE.MathUtils.clamp(want - c.speed, -0.4 * dt, 0.15 * dt);
      if (c.speed < 0.002 && want === 0) c.speed = 0;
      const step = Math.min(c.speed * dt, dist);
      if (step > 0 && tryMove(c, c.pos + dir * step, c.a, c.hy)) c.roll += step / CRANE_WHEEL_R;
      else if (step > 0) {
        // another crane (or a mast) in the way: it stands. Held up by a crane 2 s, it turns back
        // (the other may stand there a long while, a load on its hook, waiting for the train);
        // held up 15 s, it works the boat it has come to. (c.blockT: c.stuck is reset by the
        // bogie check every frame nothing stands on the rails)
        c.speed = 0;
        const o = c.blocker;
        if (o && c.blockT > 2 && !c.reserved) {
          const d = Math.hypot(c.site.x - o.site.x, c.site.z - o.site.z) || 1;
          c.awayX = (c.site.x - o.site.x) / d;
          c.awayZ = (c.site.z - o.site.z) / d;
          const back = retreat(c);
          c.awayX = c.awayZ = 0;
          if (back) c.blockT = 0;
        }
        if (c.blockT > 20 && c.reserved) giveUpWork(c);
        if (c.blockT > 15 && !c.reserved) {
          c.target = c.pos;
          const [cx, cz] = siteAt(c, c.pos);
          c.nextA = holdAngle(c, cx, cz) ?? 0;
        }
      }
      if (Math.abs((c.target ?? c.pos) - c.pos) < 0.005) {
        c.pos = c.target ?? c.pos;
        c.speed = 0;
        placeCrane(c);
        c.shipA = c.nextA;
        c.target = null;
        c.mode = "swingOut";
        c.stat.trips++;
      }
      return true;
    }
    // swingOut: jib out over the hold again (blocked too long: it stands at its berth as it is,
    // and swings out when the way is free)
    if ((slewTo(c, c.shipA ?? 0, dt) && hoistTo(c, HOOK_REST, dt)) || c.blockT > GIVE_UP) {
      if (c.blockT > GIVE_UP) c.stat.gaveUp++;
      c.blockT = 0;
      c.mode = "berth";
      c.stay = 25 + c.r() * 35;
      c.idle = 4 + c.r() * 6;
      c.idleTo = c.a;
    }
    return true;
  }
  /** Where a crane will stand for the train, and its jib angle over the hold there. */
  const planOf = (c: Crane): { x: number; z: number; shipA: number | null } => {
    if (c.mode === "travel" && c.target !== null) {
      const [x, z] = siteAt(c, c.target);
      return { x, z, shipA: c.nextA };
    }
    return { x: c.site.x, z: c.site.z, shipA: c.shipA };
  };
  const hooks = inst(hookGeometry(), woodMat, cranes.length, "crane_hooks");
  const ropes = inst(ropeGeometry(), woodMat, cranes.length, "crane_ropes");
  const slings = inst(slingGeometry(), woodMat, cranes.length, "crane_slings");
  const craneWheels = inst(craneWheelGeometry(), woodMat, cranes.length * CRANE_WHEELS.length, "crane_wheels");

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
      const passes = line.passes(c.site.x, c.site.z, 1.0);
      if (!passes.length) continue;
      const pass = passes[Math.floor(rnd() * passes.length)];
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
    // the crane and the train agree on the spot: where the crane stands (or is going), and it stays there
    if (c.occupied || c.ops.length) return false;
    const plan = planOf(c);
    const near = line.passes(plan.x, plan.z, 1.0).filter((q) => Math.abs(q - st.head) < 120);
    if (!near.length) return false;
    st.head = near.reduce((a, b) => (Math.abs(b - st.head) < Math.abs(a - st.head) ? b : a));
    const full = [0, 1, 2].filter((r) => w.slots[r * 2] && w.slots[r * 2 + 1]);
    const empty = [0, 1, 2].filter((r) => !w.slots[r * 2] && !w.slots[r * 2 + 1]);
    if (plan.shipA !== null) {
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
      const d = (s: number) => Math.hypot(line.at(s, pa).x - plan.x, pa.z - plan.z) - R_HOOK;
      if (Math.sign(d(lo)) === Math.sign(d(hi))) continue;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (Math.sign(d(m)) === Math.sign(d(lo))) lo = m;
        else hi = m;
      }
      const s = (lo + hi) / 2;
      if (Math.abs(angDiff(line.yaw(s + 3.5), line.yaw(s - 3.5))) > 0.04) continue;
      // not under the gatehouse of the Werf store (the jib would swing through its roof)
      if (gate && line.at(s, pa).x < gate.x + 2.5) continue;
      cand.push(s + off);
    }
    let ok = cand.filter((h) => h > head + 4);
    // M6 cranes: only a row the crane can reach with a load on the hook and keep its room from the
    // cranes about it; and the hold clear of the ships' masts. Else no stop here (it goes on).
    if (rules) {
      const load = SLING + UNIT_H[w.goods!];
      const clearAt = (a: number, hy: number) => {
        roomOf(c, { x: plan.x, z: plan.z, yaw: c.site.yaw, a, hy, load }, after);
        return after.slice(0, c.near.length * 2 + 1).every((v) => v >= 0);
      };
      ok = ok.filter((h) => {
        const at = slotAt(w, st.row * 2, h);
        const wa = angDiff(Math.atan2(at.x - plan.x, at.z - plan.z), c.site.yaw);
        const src = plan.shipA ?? (c.pile ? angleTo(c, c.pile.x, c.pile.z) : wa);
        return clearAt(wa, FLOOR + load) && mastPathClear(c, plan.x, plan.z, src, wa);
      });
      const shipY = levelAt(plan.x, plan.z) + (c.shipY - opts.waterY);
      if ((plan.shipA !== null && !clearAt(plan.shipA, shipY + load)) || !ok.length) {
        c.stat.skipped++;
        return false;
      }
    }
    if (!ok.length) return false;
    st.head = ok[Math.floor(rnd() * ok.length)];
    c.reserved = true;
    if (c.mode === "swingIn") {
      c.target = null;
      c.mode = "swingOut";
    }
    return true;
  }

  function queue(st: Stop): void {
    const c = st.crane;
    const plan = planOf(c);
    const angleTo = (_c: Crane, x: number, z: number) => angDiff(Math.atan2(x - plan.x, z - plan.z), c.site.yaw);
    const w = wagons[st.wagon];
    const unit = UNIT_H[w.goods!];
    const hookFor = (bottom: number) => bottom + unit + SLING;
    const ops: Op[] = [];
    for (const k of [0, 1]) {
      const slot = st.row * 2 + k;
      const at = slotAt(w, slot, st.head);
      const wagonA = angleTo(c, at.x, at.z);
      const src: Source = plan.shipA !== null ? { kind: "ship" } : { kind: "pile" };
      const srcA = plan.shipA ?? angleTo(c, c.pile!.x, c.pile!.z);
      // M6 tides: the hold is where the water has the boat now
      const shipY = levelAt(c.site.x, c.site.z) + (c.shipY - opts.waterY);
      const srcY = plan.shipA !== null ? shipY : c.pile ? pileSlot(c.pile, Math.max(0, c.pile.n - 1 - k)).y : 0;
      const dstY = c.pile ? pileSlot(c.pile, Math.min(c.pile.cap - 1, c.pile.n + k)).y : shipY;
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
    st.crane.reserved = false;
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

  /** A clack for each wheel that has passed a rail joint since the last call (`sound` false: only note where they are). */
  function railJoints(sound: boolean): void {
    wagons.forEach((w, i) => {
      const mid = head - w.front - L_BUF / 2;
      for (const [j, o] of [[0, WB / 2], [1, -WB / 2]] as const) {
        const s = mid + o;
        const k = i * 2 + j;
        if (sound && Math.floor(s / JOINT) !== Math.floor(axleS[k] / JOINT) && s > axleS[k]) {
          line.at(s, pa);
          if (pa.x > -345) api.onClack?.(pa.x, pa.z);
        }
        axleS[k] = s;
      }
    });
  }

  // --- M8b: run by another PC (net/mp/world.ts). The world PC sends the train and the cranes as they
  // stand; here they are only drawn from that. Its own plans (the stops, the lifts, making way) are
  // dropped meanwhile; taking over, it goes on from the last state shown with fresh plans.
  const STATES = ["shed", "run", "work"] as const;
  const MODES = ["berth", "swingIn", "travel", "swingOut"] as const;
  const bySid = new Map(cranes.map((c) => [c.sid, c]));
  let netRemote = false;
  /** The first state after going remote: no sounds (what changed was never seen here). */
  let netFresh = false;
  /** The world PC's train stands at a crane stop (the shunter turns to it). */
  let netWork = false;
  function letGo(): void {
    netFresh = true;
    stops = [];
    stopI = 0;
    working = null;
    waitWhy = "";
    for (const c of cranes) {
      c.ops = [];
      c.opT = 0;
      c.reserved = false;
      c.parkFor = 0;
      c.speed = 0;
      c.blocked = false;
      c.blockT = 0;
      c.yieldT = 0;
      c.yielding = false;
      c.lend = 0;
      c.awayX = c.awayZ = 0;
      c.moveOn = false;
    }
  }
  function takeOver(): void {
    if (state === "work") state = "run";
    working = null;
    if (state !== "shed") {
      // the stops still ahead on this trip (those behind are let go in limit())
      planTrip();
      stopI = 0;
    }
    for (const c of cranes) {
      c.hoisting = false;
      c.idleTo = c.a;
      c.idle = 2 + c.r() * 6;
      if (c.mode === "travel" || c.mode === "swingIn") {
        if (c.target === null) c.mode = "swingOut";
        else {
          const [tx, tz] = siteAt(c, c.target);
          c.nextA = holdAngle(c, tx, tz) ?? 0;
          c.along = alongA(c);
        }
      }
      if (c.mode === "swingOut" && c.shipA !== null) c.shipA = holdAngle(c, c.site.x, c.site.z) ?? c.shipA;
      if (c.mode === "berth" && c.carry) {
        // a load on the hook with no lift behind it: back where it came from
        const src: Source = c.pile ? { kind: "pile" } : { kind: "ship" };
        const srcA = c.shipA ?? angleTo(c, c.pile!.x, c.pile!.z);
        const y = c.pile ? pileSlot(c.pile, Math.min(c.pile.cap - 1, c.pile.n)).y : levelAt(c.site.x, c.site.z) + (c.shipY - opts.waterY);
        c.ops = [{ t: "hoist", y: TRAVEL }, { t: "slew", a: srcA }, { t: "hoist", y: y + UNIT_H[c.carry] + SLING }, { t: "wait", s: 1.2 }, { t: "drop", to: src }, { t: "hoist", y: TRAVEL }];
      }
    }
  }

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
    // the gate of the Werf store: asked for as the train comes up to it, shut behind the last wagon;
    // the train waits for it to stand open (on the way out in the dark behind it, on the way back
    // short of its leaves)
    if (gate) {
      const out = head > gateOut.face - 30 && head - trainLen < gateOut.tip + 1;
      const back = head > gateBack.tip - 16 && head - trainLen < gateBack.face + 0.5;
      gate.want(state !== "shed" && (out || back));
      if (gate.amount() < 0.99) {
        for (const stopAt of [gateOut.face - 0.8, gateBack.tip - 1.5]) {
          if (head <= stopAt + 0.01 && head > stopAt - 60 && stopAt < lim) {
            lim = Math.max(head, stopAt);
            waitWhy = "gate";
          }
        }
      }
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
    // people on the line ahead (not colliders: they walk)
    const folk = api.people?.();
    if (folk) {
      line.at(head + 3, pb);
      for (const p of folk) {
        if (Math.abs(p.x - pb.x) > 5 || Math.abs(p.z - pb.z) > 5) continue;
        // (Steve 2026-09-27: walkers give way to the train, crowd.ts giveWay: it stops only for one right before the
        // horses, a last resort when he cannot get off the line)
        for (let d = 0; d <= 3; d += 1) {
          line.at(head + d, pa);
          if (Math.hypot(p.x - pa.x, p.z - pa.z) < 1.1) {
            lim = Math.min(lim, Math.max(head, head + d - 1.5));
            waitWhy = "people";
            break;
          }
        }
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
  /**
   * Blocked too long at a lift for the train (another crane that cannot make way, the player's):
   * it lets the stop go and the train goes on. A last resort; counted as gaveUp in the dev check.
   */
  function giveUpWork(c: Crane): void {
    c.stat.gaveUp++;
    c.blockT = 0;
    const st = stops.find((s, i) => i >= stopI && s.crane === c && s.queued);
    if (!st) {
      c.ops = [{ t: "hoist", y: TRAVEL }];
      c.carry = null;
      c.reserved = false;
      return;
    }
    const was = working === st;
    abandon(st);
    if (was) {
      stopI++;
      state = "run";
    } else st.head = -1e9; // passed at once in limit()
  }

  /**
   * A travelling crane in the way of a crane that outranks it (its cabin or portal, not its jib):
   * it turns back, 8 m the other way, as far as its runway and its other neighbour allow.
   */
  function retreat(c: Crane): boolean {
    const push = c.axis === "x" ? c.awayX : c.awayZ;
    if (Math.abs(push) < 0.3) return false;
    let lo = c.lo;
    let hi = c.hi;
    for (const o of cranes) {
      if (!sameRunway(c, o)) continue;
      const [a, b] = heldBy(o);
      if (o.pos < c.pos) lo = Math.max(lo, b + CRANE_GAP);
      else hi = Math.min(hi, a - CRANE_GAP);
    }
    const to = THREE.MathUtils.clamp(c.pos + Math.sign(push) * 8, Math.min(lo, c.pos), Math.max(hi, c.pos));
    if (Math.abs(to - c.pos) < 1 || (c.target !== null && Math.sign(c.target - c.pos) === Math.sign(push) && Math.abs(c.target - c.pos) >= Math.abs(to - c.pos))) return false;
    c.target = to;
    const [cx, cz] = siteAt(c, to);
    c.nextA = holdAngle(c, cx, cz) ?? 0;
    c.stuck = 0;
    return true;
  }

  /** May the load come on the hook (it hangs lower and wider): the same rule as a step. */
  function loadOk(c: Crane, g: GoodsKind): boolean {
    if (!rules) return true;
    roomOf(c, poseOf(c), before);
    const was = c.carry;
    c.carry = g;
    const r = roomOf(c, poseOf(c), after);
    c.carry = was;
    const bad = after.findIndex((v, k) => v < 0 && v < before[k] - 1e-6);
    if (bad < 0) return true;
    refused(c, bad, bad === r.k ? r.theirs : bad & 1 ? "portal" : "body");
    return false;
  }

  function updateCrane(c: Crane, dt: number, trainStopped: boolean, player: { x: number; z: number } | null): void {
    // asked to make way (M6 cranes): its cabin or portal in the way, it moves along (standing free
    // at a berth: to a berth away from those asking; travelling at them: back the way it came);
    // else hook up out of the hold or the wagon, then the jib away from those asking
    if (c.yieldT > 0 && canYield(c)) {
      c.yieldT -= dt;
      c.noAway = Math.max(0, c.noAway - dt);
      if (!c.yielding) {
        c.yielding = true;
        c.stat.yields++;
      }
      const clear = () => {
        c.yieldT = 0;
        c.yielding = false;
        c.lend = 0;
        c.awayX = c.awayZ = 0;
        c.moveOn = false;
      };
      let moved = false;
      // (travelling, it always backs off; its jib cannot swing away past the other's hook, and a
      // jib that has been stuck making way a while moves along too)
      if ((c.moveOn || c.mode === "travel" || c.blockT > 3) && c.axis && c.noAway <= 0 && !withTrain(c)) {
        if (c.mode === "berth" && c.berths.length) {
          const b = nextBerth(c);
          if (b) {
            c.target = b.p;
            c.nextA = b.a;
            c.mode = "swingIn";
            c.along = chooseAlong(c);
            moved = true;
          }
        } else if (c.mode === "travel") moved = retreat(c);
        if (moved) clear();
        else c.noAway = 5; // nowhere to go: make way with the jib for a while
      }
      if (!moved) {
        c.moveOn = false;
        if (c.mode === "travel") c.speed = 0;
        if (c.hy < TRAVEL - 0.01) hoistTo(c, TRAVEL, dt);
        else {
          const L = Math.hypot(c.awayX, c.awayZ);
          const to = L < 0.3 ? 0 : awayAngle({ x: c.site.x, z: c.site.z, yaw: c.site.yaw }, c.site.x - c.awayX / L, c.site.z - c.awayZ / L);
          slewTo(c, to, dt, SLEW * 0.8);
        }
        const k = Math.pow(0.5, dt);
        c.awayX *= k;
        c.awayZ *= k;
        if (c.yieldT <= 0) clear();
        return;
      }
    }
    // travelling from boat to boat (the lifts wait till it stands at its berth)
    if (travelStep(c, dt, player)) return;
    const op = c.ops[0];
    if (!op) {
      // idle: now and then a slow swing about its rest over the water (or the pile); never over the
      // masts, and a swing that runs into another crane stops there for a while
      c.idle -= dt;
      if (c.idle <= 0) {
        const home = c.shipA ?? angleTo(c, c.pile!.x, c.pile!.z);
        c.idle = 10 + c.r() * 20;
        for (let k = 0; k < 4; k++) {
          const to = home + (c.r() * 2 - 1) * 0.5;
          const p = poseOf(c, c.pos, to, HOOK_REST);
          if (!rules || thingsGap(craneParts(p), mastCaps(c, p), ["jib"]) >= JIB_GAP) {
            c.idleTo = to;
            c.stat.swings++;
            break;
          }
        }
      }
      const d = angDiff(c.idleTo, c.a);
      if (Math.abs(d) > 1e-4) {
        const na = c.a + Math.sign(d) * Math.min(Math.abs(d), SLEW * 0.5 * dt * THREE.MathUtils.clamp(Math.abs(d) / 0.3, 0.2, 1));
        if (!tryMove(c, c.pos, na, c.hy)) {
          c.idleTo = c.a;
          c.idle = Math.min(c.idle, 3 + c.r() * 5);
        }
      }
      // the hook sags to its rest, but stays up over the railway (the train passes under it)
      const hy = overRail(c) ? Math.max(TRAVEL, Math.min(c.hy, TRAVEL_HOOK)) : HOOK_REST;
      const dh = hy - c.hy;
      if (Math.abs(dh) > 1e-3) tryMove(c, c.pos, c.a, Math.abs(dh) < 0.005 ? hy : c.hy + dh * Math.min(1, dt * 0.5));
      return;
    }
    if (c.blockT > GIVE_UP_WORK) {
      giveUpWork(c);
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
        tryMove(c, c.pos, c.a, c.hy + Math.sign(d) * Math.min(Math.abs(d), HOIST * ease * dt));
        if (Math.abs(op.y - c.hy) < 0.005) {
          c.hy = op.y;
          c.hoisting = false;
          c.ops.shift();
        }
        break;
      }
      case "slew": {
        const d = angDiff(op.a, c.a);
        const ease = THREE.MathUtils.clamp(Math.abs(d) / 0.35, 0.18, 1);
        tryMove(c, c.pos, c.a + Math.sign(d) * Math.min(Math.abs(d), SLEW * ease * dt), c.hy);
        if (Math.abs(angDiff(op.a, c.a)) < 0.002) {
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
        if (!loadOk(c, f.kind === "wagon" ? wagons[f.w].goods! : c.goods)) break; // the load would touch: wait
        if (f.kind === "wagon") wagons[f.w].slots[f.slot] = false;
        if (f.kind === "pile" && c.pile) {
          c.pile.n = Math.max(0, c.pile.n - 1);
          pileOn(c.pile);
        }
        c.carry = f.kind === "wagon" ? wagons[f.w].goods : c.goods;
        c.ops.shift();
        c.stat.lifts++;
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
        c.reserved = false;
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
  const put = (m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, pitch = 0, sx = 1, sy = 1, sz = 1, roll = 0) => {
    E.set(pitch, yaw, roll, "YXZ");
    Q.setFromEuler(E);
    M.compose(V.set(x, y, z), Q, S.set(sx, sy, sz));
    m.setMatrixAt(i, M);
  };
  const linkBetween = (i: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, thick = 1) => {
    const d = V.set(bx - ax, by - ay, bz - az);
    const len = Math.max(0.05, d.length());
    Q.setFromUnitVectors(Z, d.normalize());
    M.compose(V.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), Q, S.set(thick, thick, len));
    links.setMatrixAt(i, M);
  };
  /** The trace chain from the rear horse's collar (a) to the first wagon's hook (b): pieces with a little sag. */
  const traceAt = (i: number) => (i === 0 ? 0 : wagons.length - 1 + i);
  const trace = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    if (!opts.wagons) {
      linkBetween(0, ax, ay, az, bx, by, bz);
      return;
    }
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.min(TRACE_PIECES, Math.round(len / TRACE_LINK)));
    const sag = Math.min(0.12, len * 0.04);
    let px = ax;
    let py = ay;
    let pz = az;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const qx = ax + (bx - ax) * t;
      const qy = ay + (by - ay) * t - sag * Math.sin(Math.PI * t);
      const qz = az + (bz - az) * t;
      linkBetween(traceAt(k - 1), px, py, pz, qx, qy, qz, 0.7);
      px = qx;
      py = qy;
      pz = qz;
    }
    for (let k = n; k < TRACE_PIECES; k++) links.setMatrixAt(traceAt(k), zero);
  };
  const hideTrace = () => {
    for (let k = 0; k < TRACE_PIECES; k++) links.setMatrixAt(traceAt(k), zero);
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
    shunterGroup.visible = near && shunterGroup.position.x > hideX;
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
      // wholly in the dark behind the gate: not drawn
      if (!near || wp.x < hideX - L_BUF / 2) {
        body.setMatrixAt(k, zero);
        wheels.setMatrixAt(i * 2, zero);
        wheels.setMatrixAt(i * 2 + 1, zero);
        if (i === 0) hideTrace();
        else links.setMatrixAt(i, zero);
        const e = L_BODY / 2 + 0.3;
        prevRear = [wp.x - Math.sin(wp.yaw) * e, 0.98, wp.z - Math.cos(wp.yaw) * e];
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
        // the main chain from the spreader behind the rear horse to the first wagon's hook
        const f1 = horseFrame(1);
        horseToWorld(f1, 0, SPREAD[1] + horses.bob(1), SPREAD[2], hv);
        trace(hv.x, hv.y, hv.z, front[0], front[1], front[2]);
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
      // the bogie wheels, turning as it travels
      CRANE_WHEELS.forEach(([lx, lz], k) => {
        const [wx, wz] = toWorld(c, lx, lz);
        put(craneWheels, i * CRANE_WHEELS.length + k, wx, CRANE_WHEEL_R + 0.02, wz, c.site.yaw, 0, 1, 1, 1, -c.roll);
      });
      hookWorld(c, hk);
      c.jib.updateWorldMatrix(true, false);
      tip.set(TIP[0], TIP[1], TIP[2]).applyMatrix4(c.jib.matrixWorld);
      const wa = c.site.yaw + c.a;
      const len = Math.max(0.1, tip.y - (hk.y + HOOK_BLOCK));
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
      m.visible = m.count > 0; // no draw call for goods nobody sees
      m.instanceMatrix.needsUpdate = true;
    }
    harness(hidden || !near);
    for (const m of [...bodies.values(), wheels, links, hooks, ropes, slings, craneWheels]) m.instanceMatrix.needsUpdate = true;
  }

  // The horses' trace chains (the draught horse's detail pass, 2026-09-27): from each horse's hame tugs; the rear
  // horse's run past its quarters to the ends of a spreader behind its hocks (the spreader a piece of chain across),
  // the lead horse's back to the rear horse's hame tugs. Pieces of the coupling, like the main chain: no draw call more.
  const hv = new THREE.Vector3();
  const hFrames = [0, 1].map(() => ({ x: 0, z: 0, yaw: 0 }));
  function horseFrame(i: number): { x: number; z: number; yaw: number } {
    const s = head - 1.6 - i * HORSE_GAP;
    line.at(s, pa);
    const f = hFrames[i];
    f.x = pa.x;
    f.z = pa.z;
    f.yaw = line.yaw(s);
    return f;
  }
  function horseToWorld(f: { x: number; z: number; yaw: number }, lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(f.yaw);
    const s = Math.sin(f.yaw);
    return out.set(f.x + lx * c + lz * s, ly, f.z - lx * s + lz * c);
  }
  let hUsed = 0;
  /** A chain from a to b in pieces of about TRACE_LINK, hanging a little. */
  function chain(a: THREE.Vector3, b: THREE.Vector3): void {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / TRACE_LINK));
    const sag = Math.min(0.06, len * 0.03);
    let px = a.x;
    let py = a.y;
    let pz = a.z;
    for (let k = 1; k <= n && hUsed < HARNESS_PIECES; k++) {
      const t = k / n;
      const qx = a.x + (b.x - a.x) * t;
      const qy = a.y + (b.y - a.y) * t - sag * Math.sin(Math.PI * t);
      const qz = a.z + (b.z - a.z) * t;
      linkBetween(wagons.length + TRACE_PIECES + hUsed++, px, py, pz, qx, qy, qz, 0.5);
      px = qx;
      py = qy;
      pz = qz;
    }
  }
  const hpA = new THREE.Vector3();
  const hpB = new THREE.Vector3();
  const hpC = new THREE.Vector3();
  function harness(off: boolean): void {
    hUsed = 0;
    const shown = [0, 1].map((i) => !off && horseFrame(i).x >= hideX - 1.6);
    const f0 = { ...horseFrame(0) };
    const f1 = { ...horseFrame(1) };
    const b0 = horses.bob(0);
    const b1 = horses.bob(1);
    for (const sx of [1, -1]) {
      if (shown[1]) {
        // the rear horse: its tug, past its quarters, the spreader's end
        horseToWorld(f1, sx * TUG[0], TUG[1] + b1, TUG[2], hpA);
        horseToWorld(f1, sx * PAST[0], PAST[1] + b1, PAST[2], hpB);
        horseToWorld(f1, sx * SPREAD[0], SPREAD[1] + b1, SPREAD[2], hpC);
        chain(hpA, hpB);
        chain(hpB, hpC);
      }
      if (shown[0] && shown[1]) {
        // the lead horse: its tug, past its quarters, the rear horse's tug
        horseToWorld(f0, sx * TUG[0], TUG[1] + b0, TUG[2], hpA);
        horseToWorld(f0, sx * PAST[0], PAST[1] + b0, PAST[2], hpB);
        horseToWorld(f1, sx * TUG[0], TUG[1] + b1, TUG[2], hpC);
        chain(hpA, hpB);
        chain(hpB, hpC);
      }
    }
    if (shown[1]) {
      // the spreader across behind the rear horse
      horseToWorld(f1, SPREAD[0], SPREAD[1] + b1, SPREAD[2], hpA);
      horseToWorld(f1, -SPREAD[0], SPREAD[1] + b1, SPREAD[2], hpB);
      chain(hpA, hpB);
    }
    for (let k = hUsed; k < HARNESS_PIECES; k++) links.setMatrixAt(wagons.length + TRACE_PIECES + k, zero);
  }

  // --- dev (M6 cranes): the closest approaches, measured on the poses as they stand after each update
  let watching = false;
  const fresh = () => ({ t: 0, jib: Infinity, jibAt: "", portal: Infinity, portalAt: "", mast: Infinity, mastAt: "", train: Infinity, trainAt: "" });
  const seen = fresh();
  function watchCranes(dt: number): void {
    seen.t += dt;
    const when = () => `t ${seen.t.toFixed(0)} s`;
    for (const c of cranes) {
      const mine = partsOf(c);
      for (const o of c.near) {
        if (o.index < c.index) continue;
        const g = craneGap(mine, partsOf(o));
        if (g.gap < seen.jib) {
          seen.jib = g.gap;
          seen.jibAt = `cranes ${c.index} and ${o.index} (${g.mine} / ${g.theirs}), ${when()}`;
        }
        const pg = portalGap(poseOf(c), poseOf(o));
        if (pg < seen.portal) {
          seen.portal = pg;
          seen.portalAt = `cranes ${c.index} and ${o.index}, ${when()}`;
        }
      }
      const mg = thingsGap(mine, mastCaps(c, poseOf(c)), ["jib"]);
      if (mg < seen.mast) {
        seen.mast = mg;
        seen.mastAt = `crane ${c.index}, ${when()}`;
      }
      if (!withTrain(c) && trainCaps.length) {
        const tg = thingsGap(mine, trainCaps, ["fall"]);
        if (tg < seen.train) {
          seen.train = tg;
          seen.trainAt = `crane ${c.index}, ${when()}`;
        }
      }
    }
  }

  /** The horses, the shunter and the wagons' colliders where the train stands now (run here or shown from the world PC). */
  function placeTrain(dt: number): void {
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
      if (pa.x < hideX - 1.6) horses.hide(i);
      else horses.set(i, pa.x, pa.z, yaw, (gait + i * 0.37) % 1, amp);
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
      shunterGroup.rotation.y = (netRemote ? netWork : working) ? yaw + 1.2 : yaw;
      shunterGroup.visible = near && shunterGroup.position.x > hideX;
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
  }

  // --- per frame
  const api: Railway = {
    update(_t, dt, player, camera) {
      dt = Math.min(dt, 0.1);
      if (netRemote) {
        // M8b: run by the world PC (netApply puts its state here): no trip, no waits, no lifts; drawn only
        placeTrain(dt);
        draw(camera);
        return;
      }
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
        railJoints(ds > 0);
        // off the line's end: back into the store; a new trip after a while
        if (head - trainLen > line.length - 60) {
          state = "shed";
          shedT = 30 + rnd() * 60;
          fillRandom();
        }
      }
      // M6 cranes: the train's wagons and horses, as the other cranes' hooks see them
      trainCaps = [];
      if (state !== "shed") {
        const wp = { x: 0, z: 0, yaw: 0 };
        for (const w of wagons) {
          wagonAt(w, head, wp);
          trainCaps.push(car(wp.x, wp.z, wp.yaw, L_BODY / 2 - 1.6, 1.9, 1.6));
        }
        for (let i = 0; i < 2; i++) {
          const s = head - 1.6 - i * HORSE_GAP;
          line.at(s, pa);
          trainCaps.push(car(pa.x, pa.z, line.yaw(s), 0.6, 1.3, 1.0));
        }
      }
      for (const c of cranes) c.blocked = false;
      for (const c of cranes) updateCrane(c, dt, state === "work" && stopped && working?.crane === c, player);
      for (const c of cranes) {
        c.blockT = c.blocked ? c.blockT + dt : 0;
        if (c.blocked) {
          c.stat.blockedS += dt;
          const k = `${c.mode}${c.ops.length ? " lift" : ""}: ${c.blockedBy}`;
          c.stat.by[k] = (c.stat.by[k] ?? 0) + dt;
        }
        c.stat.maxBlock = Math.max(c.stat.maxBlock, c.blockT);
      }
      if (watching) watchCranes(dt);
      placeTrain(dt);
      draw(camera);
    },
    get netRemote() {
      return netRemote;
    },
    set netRemote(on: boolean) {
      if (on === netRemote) return;
      netRemote = on;
      if (on) letGo();
      else takeOver();
    },
    netState() {
      const r3 = (x: number) => Math.round(x * 1000) / 1000;
      let bits = 0;
      wagons.forEach((w, i) => w.slots.forEach((on, k) => on && (bits += 2 ** (i * 6 + k))));
      return {
        _st: STATES.indexOf(state),
        head: r3(head),
        v: r3(v),
        _sh: r3(shedT),
        _wk: working ? 1 : 0,
        _slots: bits,
        cranes: cranes.map((c) => {
          const q: RailNet["cranes"][number] = { id: c.sid, pos: r3(c.pos), a: r3(c.a), hy: r3(c.hy), _c: c.carry ? GOODS.indexOf(c.carry) : -1, _m: MODES.indexOf(c.mode) };
          if (c.hoisting) q._h = 1;
          if (c.pile) q._n = c.pile.n;
          if (c.target !== null) q._to = r3(c.target);
          return q;
        }),
      };
    },
    netLerp(a, b, u) {
      const s = lerpState(a, b, u);
      // a new trip (the head back at the store) or a dev jump: no train drawn halfway between
      if (Math.abs(b.head - a.head) > 10) s.head = u < 0.5 ? a.head : b.head;
      return s;
    },
    netApply(s, dt) {
      const quiet = netFresh;
      netFresh = false;
      const st = STATES[s._st] ?? "shed";
      const ds = s.head - head;
      // the same trip, a short step on: roll the wheels and clack over the joints (else just put it there)
      const going = !quiet && st !== "shed" && state !== "shed" && ds >= 0 && ds < 3;
      state = st;
      head = s.head;
      v = s.v;
      shedT = s._sh;
      netWork = s._wk === 1;
      if (going) roll += ds / WHEEL_R;
      gait = (gait + (v / 1.35) * Math.min(dt, 0.1) * 0.95) % 1;
      railJoints(going && ds > 0);
      wagons.forEach((w, i) => w.slots.forEach((_, k) => (w.slots[k] = Math.floor(s._slots / 2 ** (i * 6 + k)) % 2 === 1)));
      for (const q of s.cranes) {
        const c = bySid.get(q.id);
        if (!c) continue;
        const mode = MODES[q._m] ?? "berth";
        if (!quiet && mode === "travel" && c.mode !== "travel") api.onCraneTravel?.(c.site.x, c.site.z);
        if (!quiet && q._h && !c.hoisting) api.onCrane?.(c.site.x, c.site.z);
        c.mode = mode;
        c.hoisting = !!q._h;
        c.target = q._to ?? null;
        if (q.pos !== c.pos) {
          if (!quiet && Math.abs(q.pos - c.pos) < 2) c.roll += Math.abs(q.pos - c.pos) / CRANE_WHEEL_R;
          c.pos = q.pos;
          placeCrane(c);
        }
        c.a = q.a;
        c.hy = q.hy;
        c.carry = GOODS[q._c] ?? null;
        if (c.pile && q._n !== undefined && q._n !== c.pile.n) {
          c.pile.n = q._n;
          pileOn(c.pile);
        }
      }
    },
    colliders: () => [...horseRects, ...wagons.map((w) => w.rect), ...cranes.flatMap((c) => c.legs)],
    rolling: () => [...horseRects, ...wagons.map((w) => w.rect)],
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
        cranes: cranes.map((c) => ({ at: [+c.site.x.toFixed(2), +c.site.z.toFixed(2)], move: c.mode, blocked: c.blockT > 0 ? `${c.blockedBy} ${c.blockT.toFixed(1)} s` : "", yielding: c.yieldT > 0, to: c.target === null ? null : +c.target.toFixed(1), berths: c.berths.length, range: c.axis ? [c.lo, c.hi] : null, reserved: c.reserved, occupied: c.occupied, stay: +c.stay.toFixed(0), goods: c.goods, mode: c.shipA !== null ? "ship" : "quay", a: +c.a.toFixed(2), hy: +c.hy.toFixed(2), carry: c.carry, ops: c.ops.length, pile: c.pile ? [+c.pile.x.toFixed(1), +c.pile.z.toFixed(1), c.pile.n] : null })),
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
    ladders() {
      return cranes.map((c) => {
        const at = (l: [number, number]) => {
          const [x, z] = toWorld(c, l[0], l[1]);
          return { x, z };
        };
        return {
          crane: c.index,
          foot: at(LADDER_FOOT),
          hang: at(LADDER_HANG),
          head: at(LADDER_HEAD),
          face: c.site.yaw + Math.PI,
          top: DECK_Y,
          decks: c.decks,
          spots: CRANE_SPOTS.map((s) => {
            const [x, z] = toWorld(c, s.x, s.z);
            return { id: `${s.kind}_${c.index}`, kind: s.kind, crane: c.index, x, z, y: s.y, label: s.label };
          }),
          ready: c.mode === "berth" && !c.reserved && !c.ops.length && Math.abs(angDiff(0, c.a)) < 0.01 && Math.abs(c.hy - HOOK_REST) < 0.05,
        };
      });
    },
    summon(i) {
      if (netRemote) return; // (M8b: the world PC drives the cranes; craneclimb refuses on a remote PC)
      const c = cranes[i];
      if (c) c.parkFor = Math.max(c.parkFor, 0.6);
    },
    occupy(i) {
      for (const c of cranes) c.occupied = c.index === i;
    },
    plan() {
      return { length: line.length, passes: cranes.flatMap((c) => c.passes.map((s) => ({ crane: c.index, s, mode: c.shipA !== null ? "ship" : "quay" }))) };
    },
    craneCheck(o = {}) {
      if (o.rules !== undefined) rules = o.rules;
      if (o.reset || !watching) {
        watching = true;
        Object.assign(seen, fresh());
        for (const c of cranes) c.stat = newStat();
      }
      const r2 = (v: number) => (Number.isFinite(v) ? +v.toFixed(2) : null);
      return {
        rules,
        seconds: +seen.t.toFixed(0),
        margins: { jib: JIB_GAP, portal: PORTAL_GAP },
        closest: {
          jibs: r2(seen.jib),
          jibsAt: seen.jibAt,
          portals: r2(seen.portal),
          portalsAt: seen.portalAt,
          masts: r2(seen.mast),
          mastsAt: seen.mastAt,
          train: r2(seen.train),
          trainAt: seen.trainAt,
        },
        cranes: cranes.map((c) => ({
          i: c.index,
          at: [+c.site.x.toFixed(1), +c.site.z.toFixed(1)],
          mode: c.mode,
          ...c.stat,
          blockedS: +c.stat.blockedS.toFixed(0),
          maxBlock: +c.stat.maxBlock.toFixed(1),
          berths: c.berths.map((b) => +b.p.toFixed(1)),
          masts: c.masts.length,
          near: c.near.map((n) => n.index),
        })),
      };
    },
  };
  return api;
}
