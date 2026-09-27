import { modelCollider, modelShape } from "../world/modelCollision";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import type { Rect } from "../world/geom";
import type { World } from "../world/rijnkaai";
import type { Crowd, Puppet } from "./crowd";
import type { Goal, Sim, Town } from "./town";
import { makeAnimal, type Animal, type AnimalKind } from "./animals";
import { makeHuman, type Human, type HumanKind, type Motion } from "./humans";
import type { Now } from "../../../server/src/town/schedule";
import { activityAt } from "../../../server/src/town/schedule";
import { doorAt, gamesAt, h01, type ChildGame, type DoorSeg, type Weather } from "../../../server/src/town/doorlife";
import { CRIES, type StreetWork } from "../audio/cries";
import type { Note } from "../audio/ballad";
import { omnibusKeepOut } from "../world/omnibus";
import { trafficLanes } from "../world/traffic";
import { WELL_AT } from "../world/streetlife";
import SPOT_TABLE from "../../../shared/spots.json";
import BUILD from "../../../shared/city_build.json";
import { SHOP_END_CLEAR, shopTableSpot, type FrontHouse } from "../../../shared/shopFront";
import { addStallThing } from "./stallSpots";
import { addProp, dropProps, propIndex, ptsBox } from "../world/propSpots";
import { buildingRoots, buildWallProbe } from "../world/wallprobe";
import CITY from "../../../shared/city.json";

// The back streets and the cathedral quarter come alive (M6 lively, Steve 2026-09-24). Everything
// that involves people lives through the town's residents and their days (server town/lively.ts,
// doorlife.ts); this file only shows it:
//
// - Rounds (work kind "round"): the milk women and the bakers' boys lead their dog carts from door
//   to door; the knife grinder pushes his barrow and grinds at the doors with sparks flying; the
//   rag-and-bone man, the coal man and the mussel seller push their handcarts; the broom seller
//   carries his brooms; the sweep and his boy go with their brushes; the Black Sisters call on the
//   sick; the English travellers stop at the sights, look up and point. At a stop a seller cries
//   his wares (audio/cries.ts), and now and then someone comes out of a door near by to buy.
// - Door life (doorAt): women scrub their doorstep on their knees (the stone stays wet a while),
//   sit by the door with the lace pillow or their knitting, lean out of the window over the door,
//   take flowers to the Madonna at the corner (or into the cathedral).
// - The children's games (gamesAt): hoops, tops, marbles in a chalk ring, hopscotch, a skipping
//   rope (tag stays the town's own game, town.ts play()).
// - The pious cross themselves passing a corner Madonna; the beggars at the church doors hold out
//   a hand; the stall keepers against the cathedral mind their stalls.
// - Things that stay: the stalls against the cathedral, goods set out before the shops, flower pots
//   on the sills, chalk on the stones (merged per 64 m chunk, hidden beyond the fog); cats on the
//   window sills, hens and a goat in the courts (only near Jef).
//
// Nothing here owns a number: who goes where and when is the engine's; prices are the trade rules'.

/** The houses of the town plan: the town's shop tables stand on their own house fronts (shared/shopFront.ts). */
const HOUSES = (BUILD as unknown as { houses: FrontHouse[] }).houses;
const CHUNK = 64;
const SOLID = 0;
const DECAL = 1;
/** People and animals of the lanes are shown within this of Jef. */
const NEAR = 45;
const SPOTS = SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>;
const CITY_DOORS = (CITY as unknown as { doors: Record<string, { x: number; z: number; width: number }> }).doors;
/** The first floor over the door (city_build ground_h): where a head leans out of a window. */
const GROUND_H = 3.8;
/** The window sills of the house fronts (world/cityTextures.ts: the sill 12 px up a 64 px storey cell): ground floor, and above an upper floor. */
const SILL_GROUND = 0.72;
const SILL_UPPER = 0.57;

/** Bodies smaller than this (over a 1.74 m man) are children: people.glb's children are about 0.7, the baker's boy 0.83. */
const CHILD_BODY = 0.9;
/** The hoop (build_lively.py hoop: a ring of radius 0.3 m standing on its lowest point) and the stick (0.55 m up its length). */
const HOOP_R = 0.3;
const STICK_L = 0.55;
const UP = new THREE.Vector3(0, 1, 0);
/** Hopscotch: the chalk squares' length (chalk_hop, 8 squares), a hop (the hop clip's loop), the walk up to the first square. */
const HOP_LEN = 3.0;
const HOP_S = 0.6;
const HOP_STEP_UP = 1.2;
/**
 * The skipping rope: half the length between the hands; where the right hand is in the rope clip, over a
 * 1.74 m body (the middle of its circle: ahead, to the right, up; measured on the figures); one turn of
 * the rope (the clip's loop); segments and thickness of the drawn rope.
 */
const ROPE_HALF = 1.5;
const HAND_FWD = 0.39;
const HAND_RIGHT = 0.375;
const HAND_UP = 1.19;
const ROPE_TURN = 0.8;
const ROPE_SEG = 24;
const ROPE_R = 0.018;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

interface Part {
  slot: number;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}
interface Proto {
  parts: Part[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  geo?: THREE.BufferGeometry;
}

export interface LivelyView {
  door: Record<string, DoorSeg[]>;
  stalls: Array<{ id: string; x: number; z: number; yaw: number; goods: "rosaries" | "candles" | "prints"; side: string }>;
  beggars: Array<[number, number, number]>;
  carts: string[];
  dogcarts: string[];
  criers: string[];
}

/** What a seller does at a stop of the round. */
type StopPhase = "arrive" | "cry" | "wait" | "to_door" | "at_door" | "back" | "grind" | "done";
interface RoundState {
  phase: StopPhase;
  t: number;
  step: number;
  customer: string | null;
  cried: boolean;
}

/** A person's own props and vehicles while they are in the street. */
interface Kit {
  hand: THREE.Object3D | null;
  back: THREE.Object3D | null;
  dogcart: DogCart | null;
  barrow: Barrow | null;
  cart: boolean;
  /** door life: the things put down (the bucket, the chair and pillow) and when */
  placed: THREE.Object3D[];
  wet: Wet | null;
  motion: Motion | null;
  crossT: number;
  lastMadonna: number;
  /**
   * A child at a game: `want` is the engine's game for the square, `kind` what is played now (a skipping
   * rope needs three: with fewer they play hopscotch). The hoop rolls on its own pivot, the stick rides
   * in the right hand.
   */
  game: { kind: ChildGame; want: ChildGame; place: string; hoop?: THREE.Object3D; spin?: THREE.Object3D; stick?: THREE.Object3D; top?: THREE.Object3D; t: number; roll: number; ang?: number } | null;
  /** A grown-looking girl or boy of fifteen at the children's square: stands by and watches. */
  watch: { x: number; z: number } | null;
  /** At the Matsijs well: going there, drawing water or leaning on it, then on with their day. */
  well: { phase: "go" | "at"; t: number; x: number; z: number; pull: boolean; tried: number } | null;
  wellDone: number;
}

interface Wet {
  mesh: THREE.Mesh;
  born: number;
  /** real seconds to dry */
  life: number;
}

/**
 * A game of the children on a square: the spot (hopscotch drawn at the middle along `yaw`, the marbles
 * ring 3.2 m to its right, the skipping rope's lane 3 m to its left), and the rope.
 */
interface Pitch {
  place: string;
  x: number;
  z: number;
  yaw: number;
  /** Seconds of play on this pitch (the turns at hopscotch go by it). */
  clock: number;
  rope: Rope | null;
  /** The marbles in the ring while someone plays marbles. */
  marbles: THREE.Object3D | null;
  marblesSeen: number;
  /** Who is at each game here, in the order of the turns (lineOf). */
  order: Map<ChildGame, string[]>;
  /** The frame each child last played here (lineOf: one held up elsewhere drops out of the line). */
  seenAt: Map<string, number>;
  /** Hopscotch: the clock of this turn, whether the one whose turn it is stands at the first square, when last played. */
  hop: { t: number; ready: boolean; seen: number };
}

/** The skipping rope of a pitch: its ends in the two turners' right hands. */
interface Rope {
  mesh: THREE.Mesh;
  /** Turns of the rope so far (0.5: at the bottom); the turners' arms and the jumper's hop are set from it. */
  t: number;
  /** Who turns and who jumps this frame (set by play(), read by update()). */
  a: Puppet | null;
  b: Puppet | null;
  j: Puppet | null;
  /** The frame each was last in place. */
  aAt: number;
  bAt: number;
  jAt: number;
  /** A miss: the rope stops at the bottom a moment before the next one's turn. */
  pause: number;
  seen: number;
  /** Misses so far (the roles go round by one at each), turns left before the next, turning this frame. */
  slot: number;
  left: number;
  turning: boolean;
}

export interface LivelySfx {
  cry(at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, notes: Note[], beat: number): void;
  work(kind: StreetWork, at: { x: number; z: number }, seconds: number): void;
  bell(at: { x: number; z: number }): void;
}

export class Lively {
  view: LivelyView | null = null;
  clock: () => { day: number; hour: number } = () => ({ day: 1, hour: 9 });
  weather: () => Weather | null = () => null;
  sfx: LivelySfx | null = null;
  private protos = new Map<string, Proto>();
  private solidMat: THREE.Material | null = null;
  private decalMat: THREE.Material | null = null;
  private group = new THREE.Group();
  private chunks: THREE.Mesh[] = [];
  private kits = new Map<string, Kit>();
  private rounds = new Map<string, RoundState>();
  private pitches = new Map<string, Pitch>();
  /** Frames counted (the children's rosters are counted once a frame). */
  private frame = 0;
  private rosterAt = -1;
  private rosters = new Map<string, string[]>();
  private ropeMat: THREE.Material | null = null;
  /** Dev: games set by hand on a pitch (devGames). */
  private forced = new Map<string, { boys: ChildGame; girls: ChildGame }>();
  private wets: Wet[] = [];
  private windows = new Map<string, { h: Human; g: THREE.Group }>();
  private cats: Array<{ a: Animal; x: number; z: number; y: number; yaw: number; house: number; shown: boolean }> = [];
  private hens: Array<{ body: THREE.Group; head: THREE.Object3D; legs: THREE.Object3D[]; hx: number; hz: number; x: number; z: number; yaw: number; t: number; tx: number; tz: number; peck: number }> = [];
  private goats: Array<{ body: THREE.Group; head: THREE.Object3D; legs: THREE.Object3D[]; hx: number; hz: number; x: number; z: number; yaw: number; t: number; tx: number; tz: number; gait: number }> = [];
  private sparks: THREE.Points | null = null;
  private sparkAt: { x: number; y: number; z: number; t: number } | null = null;
  private ready = false;
  private built = false;
  private player = { x: 0, z: 0 };
  private tick = 0;
  private lanes: Rect[] | null = null;
  private madonnas: Array<{ x: number; z: number; yaw: number; sx: number; sz: number }> = [];
  private points: Array<{ label: string; x: number; z: number; reach: number }> = [];
  /** Dev: where the goods before the shops were set out (kind, place, the way the wall faces). */
  readonly goodsAt: Array<{ kind: string; x: number; z: number; yaw: number }> = [];
  private stats_ = { stalls: 0, goods: 0, pots: 0, chalk: 0, madonnas: 0, cats: 0, hens: 0, goats: 0 };

  constructor(
    private readonly world: World,
    private readonly town: Town,
    private readonly crowd: Crowd,
  ) {
    this.group.name = "lively";
    world.scene.add(this.group);
  }

  // ------------------------------------------------------------------ loading

  async load(): Promise<void> {
    const [view] = await Promise.all([this.fetchView(), this.loadModels()]);
    this.view = view;
    this.ready = true;
  }

  /** The streets' plan from the server; while it is away (or answers an error), asked again, waiting longer each time. */
  private async fetchView(): Promise<LivelyView> {
    for (let wait = 2000; ; wait = Math.min(wait * 2, 30_000)) {
      try {
        const r = await fetch("/api/lively", { signal: AbortSignal.timeout(10_000) });
        if (r.ok) {
          const v = (await r.json()) as LivelyView;
          if (v && Array.isArray(v.stalls)) return v;
        }
      } catch {
        // away or too slow: below, and again
      }
      await new Promise((res) => setTimeout(res, wait));
    }
  }

  private async loadModels(): Promise<void> {
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/lively.glb");
    draco.dispose();
    let solidMap: THREE.Texture | null = null;
    let decalMap: THREE.Texture | null = null;
    const v = new THREE.Vector3();
    const nrm = new THREE.Matrix3();
    gltf.scene.updateMatrixWorld(true);
    for (const node of gltf.scene.children) {
      if (node.name === "lively_meta") continue;
      const proto: Proto = { parts: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0 };
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      node.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.MeshStandardMaterial;
        const slot = mat.name === "lv_decal" ? DECAL : SOLID;
        if (mat.map) {
          if (slot === SOLID) solidMap ??= mat.map;
          else decalMap ??= mat.map;
        }
        const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
        const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
        nrm.getNormalMatrix(M);
        const P = g.getAttribute("position");
        const N = g.getAttribute("normal");
        const U = g.getAttribute("uv");
        const C = g.getAttribute("color");
        const n = P.count;
        const part: Part = { slot, pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3) };
        for (let i = 0; i < n; i++) {
          v.fromBufferAttribute(P, i).applyMatrix4(M);
          part.pos.set([v.x, v.y, v.z], i * 3);
          proto.height = Math.max(proto.height, v.y);
          if (v.y < 1.5) {
            proto.minX = Math.min(proto.minX, v.x);
            proto.maxX = Math.max(proto.maxX, v.x);
            proto.minZ = Math.min(proto.minZ, v.z);
            proto.maxZ = Math.max(proto.maxZ, v.z);
          }
          if (N) {
            v.fromBufferAttribute(N, i).applyMatrix3(nrm).normalize();
            part.nor.set([v.x, v.y, v.z], i * 3);
          } else part.nor.set([0, 1, 0], i * 3);
          if (U) part.uv.set([U.getX(i), U.getY(i)], i * 2);
          if (C) part.col.set([C.getX(i), C.getY(i), C.getZ(i)], i * 3);
          else part.col.set([1, 1, 1], i * 3);
        }
        proto.parts.push(part);
      });
      if (proto.parts.length) this.protos.set(node.name, proto);
    }
    for (const t of [solidMap, decalMap] as Array<THREE.Texture | null>) {
      if (!t) continue;
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
    }
    this.solidMat = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: THREE.DoubleSide }), { affine: 0 });
    this.decalMat = psx(
      new THREE.MeshLambertMaterial({ map: decalMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
      { affine: 0, noSnap: true },
    );
    this.solidMat.name = "lively_solid";
    this.decalMat.name = "lively_decal";
  }

  /** One model as a mesh of its own (a moving thing); its geometry is shared between copies. */
  private mesh(name: string): THREE.Object3D {
    const p = this.protos.get(name);
    const g = new THREE.Group();
    g.name = `lively_${name}`;
    if (!p) return g;
    if (!p.geo) {
      const pos: number[] = [];
      const nor: number[] = [];
      const uv: number[] = [];
      const col: number[] = [];
      for (const part of p.parts) {
        pos.push(...part.pos);
        nor.push(...part.nor);
        uv.push(...part.uv);
        col.push(...part.col);
      }
      p.geo = new THREE.BufferGeometry();
      p.geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      p.geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      p.geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      p.geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      p.geo.computeBoundingSphere();
    }
    const decal = p.parts.every((q) => q.slot === DECAL);
    const m = new THREE.Mesh(p.geo, decal ? this.decalMat! : this.solidMat!);
    if (decal) m.renderOrder = 1;
    g.add(m);
    return g;
  }

  // ------------------------------------------------------------------ the things that stay

  /** Build the static things once the street life, the town and the models are in. */
  private build(): void {
    const sl = this.world.streetLife();
    const town = this.town.data;
    if (!sl || !town || !this.view || this.built) return;
    this.built = true;
    this.madonnas = sl.madonnas;
    this.stats_.madonnas = sl.madonnas.length;
    const buckets = new Map<string, { pos: number[]; nor: number[]; uv: number[]; col: number[] }>();
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3(1, 1, 1);
    const Pv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const nm = new THREE.Matrix3();
    const put = (name: string, x: number, y: number, z: number, yaw: number) => {
      const p = this.protos.get(name);
      if (!p) return false;
      M.compose(Pv.set(x, y, z), Q.setFromAxisAngle(up, yaw), S);
      nm.getNormalMatrix(M);
      const e = M.elements;
      const n = nm.elements;
      for (const part of p.parts) {
        const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)},${part.slot}`;
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = { pos: [], nor: [], uv: [], col: [] }));
        const { pos, nor, uv, col } = part;
        for (let i = 0; i < pos.length; i += 3) {
          const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
          b.pos.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]);
          const nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
          b.nor.push(n[0] * nx + n[3] * ny + n[6] * nz, n[1] * nx + n[4] * ny + n[7] * nz, n[2] * nx + n[5] * ny + n[8] * nz);
          b.col.push(col[i], col[i + 1], col[i + 2]);
        }
        for (let i = 0; i < uv.length; i++) b.uv.push(uv[i]);
      }
      return true;
    };
    const footprint = (name: string, x: number, z: number, yaw: number, pad = 0.05): Rect | null => {
      const p = this.protos.get(name);
      if (!p || !Number.isFinite(p.minX)) return null;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [lx, lz] of [[p.minX, p.minZ], [p.maxX, p.minZ], [p.maxX, p.maxZ], [p.minX, p.maxZ]]) {
        const wx = x + lx * c + lz * s;
        const wz = z - lx * s + lz * c;
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      }
      return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, top: p.height,
        surface: modelCollider(modelShape(p, () => p.parts.filter(q => q.slot === 0).map(q => q.pos)), x, z, yaw).surface };
    };
    const flags = (x: number, z: number) => this.world.city.flags(x, z) ?? 1;
    const open = (x: number, z: number) => flags(x, z) === 0;

    // what must stay clear: every door of the game and of the town, the job spots, the lanes
    const clear: Array<[number, number, number]> = [];
    for (const d of Object.values(CITY_DOORS)) clear.push([d.x, d.z, Math.min(d.width / 2, 5) + 2]);
    for (const s of Object.values(SPOTS)) if (s.x !== undefined && s.z !== undefined) clear.push([s.x, s.z, 3]);
    for (const r of town.residents) {
      clear.push([r.home.sx, r.home.sz, 1.4]);
      if (r.work.door) clear.push([r.work.door[0], r.work.door[1], 1.4]);
      if (r.work.at) clear.push([r.work.at[0], r.work.at[1], 1.4]);
      for (const q of r.work.route ?? []) clear.push([q[0], q[1], 1.6]);
    }
    for (const f of town.shops) clear.push([f.door[0], f.door[1], 1.6]);
    const isClear = (x: number, z: number, r: number) => clear.every(([cx, cz, cr]) => dist(cx, cz, x, z) > cr + r) && this.offLanes(x, z, r);

    // --- the stalls against the cathedral (server town/lively.ts CHURCH_STALLS): the counter is solid
    for (const st of this.view.stalls) {
      const name = `stall_${st.goods}`;
      if (!put(name, st.x, 0, st.z, st.yaw)) continue;
      this.stats_.stalls++;
      this.recordStall("cathedral stall", `the stall ${st.id} against the cathedral`, name, st.x, st.z, st.yaw, { leanTo: true });
      // the counter, 0.5-1.0 m before the keeper: solid for Jef (a mover: the crowd's own paths go round it)
      const fx = Math.sin(st.yaw);
      const fz = Math.cos(st.yaw);
      const cx = st.x + fx * 0.75;
      const cz = st.z + fz * 0.75;
      const hx = Math.abs(Math.cos(st.yaw)) * 1.3 + Math.abs(fx) * 0.3;
      const hz = Math.abs(Math.sin(st.yaw)) * 1.3 + Math.abs(fz) * 0.3;
      this.world.addMover({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, top: 0.95 });
      this.points.push({ label: `the stall ${st.id} against the cathedral`, x: st.x + fx * 1.6, z: st.z + fz * 1.6, reach: 2 });
    }

    // --- goods set out before the shops: the shop fronts of street life, and the town's own shops
    const SPILL: Record<string, string[]> = {
      bakery: ["bread"], grocer: ["baskets", "crockery", "brooms", "baskets"], butcher: ["meat"], chandler: ["sacks", "brooms", "casks"], corn: ["sacks"],
      coal: ["coal"], draper: ["cloth"], bootmaker: ["clogs"], coffee: ["sacks"], wine: ["casks"], fish: ["baskets"], hatter: ["cloth"],
    };
    const spilled: Array<[number, number]> = [];
    // the town's props set down already (barrels, crates, benches, a toll shed: world/propSpots.ts): the goods
    // go on the door's other side, or not at all, rather than into one (the prop check)
    const others = propIndex("");
    const placeGoods = (key: string, ax: number, az: number, tx: number, tz: number, ox: number, oz: number, len: number, door: number, seed: number) => {
      const kinds = SPILL[key];
      if (!kinds) return;
      const kind = kinds[Math.floor(h01(`${key}:${seed}`) * kinds.length)];
      const name = `spill_${kind}`;
      const p = this.protos.get(name);
      if (!p) return;
      const half = Math.max(0.6, (p.maxX - p.minX) / 2);
      for (const side of h01(`${seed}:side`) < 0.5 ? [1, -1] : [-1, 1]) {
        const s = door + side * (1.5 + half);
        if (s - half < 0.3 || s + half > len - 0.3) continue;
        // a hand off the wall (a sill, a door's surround or a shutter stands out of it)
        const x = ax + tx * s + ox * 0.12;
        const z = az + tz * s + oz * 0.12;
        // the house behind it all along (not past a corner or onto an open gateway)
        let backed = true;
        for (const k of [-half, 0, half]) if (open(x - ox * 0.6 + tx * k, z - oz * 0.6 + tz * k)) backed = false;
        if (!backed) continue;
        // the street must be wide enough (4.5 m across), nothing at the door, the lanes and the job spots clear
        let wide = true;
        for (let d = 0.4; d <= 4.5; d += 0.5) if (!open(x + ox * d, z + oz * d) || !open(x + ox * d + tx * half, z + oz * d + tz * half) || !open(x + ox * d - tx * half, z + oz * d - tz * half)) wide = false;
        if (!wide || !isClear(x + ox * 0.4, z + oz * 0.4, half) || spilled.some(([sx, sz]) => dist(sx, sz, x, z) < 4)) continue;
        const yaw = Math.atan2(ox, oz);
        {
          const c = Math.cos(yaw), sn = Math.sin(yaw);
          const mu = (p.minX + p.maxX) / 2, mv = (p.minZ + p.maxZ) / 2;
          if (others.hit({ cx: x + mu * c + mv * sn, cz: z - mu * sn + mv * c, ux: c, uz: -sn, nx: sn, nz: c, hu: (p.maxX - p.minX) / 2 + 0.03, hn: (p.maxZ - p.minZ) / 2 + 0.03, y0: 0, y1: Math.max(0.3, p.height) })) continue;
        }
        if (!put(name, x, 0, z, yaw)) continue;
        const r = footprint(name, x, z, yaw);
        if (r) this.world.addCollider(r);
        spilled.push([x, z]);
        this.goodsAt.push({ kind, x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2) });
        this.recordStall("shop goods", `${kind} set out before the ${key} at ${x.toFixed(0)}, ${z.toFixed(0)}`, name, x, z, yaw, { wall: true });
        this.stats_.goods++;
        return;
      }
    };
    sl.shops.forEach((f, i) => placeGoods(f.key, f.ax, f.az, f.tx, f.tz, f.ox, f.oz, f.len, f.door, i));
    const TOWN_SHOP: Record<string, string> = { bread: "bakery", veg: "grocer", wares: "chandler", cloth: "draper" };
    town.shops.forEach((f, i) => {
      const keeper = town.residents.find((r) => r.id === f.keeper);
      const key = keeper?.trade === "cobbler" ? "bootmaker" : keeper?.trade === "tobacconist" ? "tobacco" : TOWN_SHOP[f.goods ?? ""];
      if (!key) return;
      // the town's shop table stands on one side of the door (stalls.ts, shared/shopFront.ts); the goods go on
      // the other, on the same house front: a front from a metre before the door to the end of the house
      const spot = shopTableSpot(HOUSES, f);
      const tx = spot ? -spot.side[0] : -f.out[1];
      const tz = spot ? -spot.side[1] : f.out[0];
      const room = spot ? spot.other - SHOP_END_CLEAR : 4 - 1.2;
      placeGoods(key, f.wall[0] - tx * 1.0, f.wall[1] - tz * 1.0, tx, tz, f.out[0], f.out[1], 1.0 + room + 0.3, 1.0, 1000 + i);
    });

    dropProps("lively");
    // --- flower pots on the sills of some homes (the ground-floor window beside the door, and over it), and cats
    const houses = new Map<number, { x: number; z: number; ox: number; oz: number; kind: string; id: string }>();
    for (const r of town.residents) if (r.home.house >= 0 && !houses.has(r.home.house)) {
      const L = Math.hypot(r.home.sx - r.home.x, r.home.sz - r.home.z) || 1;
      houses.set(r.home.house, { x: r.home.x, z: r.home.z, ox: (r.home.sx - r.home.x) / L, oz: (r.home.sz - r.home.z) / L, kind: r.kind, id: r.id });
    }
    /** The front a door is in, and the middles of the window bays either side of it (none if the door bay is at an end). */
    const windowsBy = (x: number, z: number): Array<{ x: number; z: number; storeys: number }> => {
      const f = sl.fronts.find((q) => Math.hypot(q.ax + q.tx * q.door - x, q.az + q.tz * q.door - z) < 1.0);
      if (!f) return [];
      const bw = f.len / f.bays;
      const out: Array<{ x: number; z: number; storeys: number }> = [];
      for (const side of [-1, 1]) {
        const s = f.door + side * bw;
        if (s < bw * 0.4 || s > f.len - bw * 0.4) continue;
        out.push({ x: f.ax + f.tx * s, z: f.az + f.tz * s, storeys: f.storeys });
      }
      return out;
    };
    // the pots stand on the window's stone sill as built (the houses' sills are 6 to 8 cm of stone out of the
    // wall, at the foot of the window, the glass set back over it); on the plan's height where the wall is flat.
    // Not where the pots would go into the sill, a reveal or a jamb: then none (the prop check)
    const wallProbe = buildWallProbe(buildingRoots(this.world.scene));
    const potBox = (() => {
      const p = this.protos.get("pots_sill");
      return p ? ptsBox(p.parts.map((q) => q.pos)) : null;
    })();
    const passages = ((CITY as unknown as { alleys?: { passages?: number[][] } }).alleys?.passages ?? []).map(([x0, z0, x1, z1]) => [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);
    const potsOn = (x: number, z: number, ox: number, oz: number, want: number): number | null => {
      if (!potBox) return null;
      // (not on a wall inside a passage into the back alleys: they are 2.2 m wide)
      if (want < 2 && passages.some(([x0, z0, x1, z1]) => x > x0 - 0.6 && x < x1 + 0.6 && z > z0 - 0.6 && z < z1 + 0.6)) return null;
      // the face out of the wall line at a height (m; > 0 proud of it)
      const out = (y: number) => {
        const d = wallProbe(x + ox * 0.8, y, z + oz * 0.8, -ox, -oz, 1.6);
        return d === null ? -1 : 0.8 - d;
      };
      // the sill: the top of a band proud of the wall, from 25 cm under the wanted height to 45 cm over it
      let y = want;
      for (let q = want - 0.25; q <= want + 0.45; q += 0.02) {
        if (out(q) > 0.03 && out(q + 0.02) <= 0.03) {
          let top = q;
          while (top < q + 0.02 && out(top + 0.005) > 0.03) top += 0.005;
          y = top + 0.005 - potBox[1]; // (its foot on the sill's top)
          break;
        }
      }
      // clear of the house as built: level rays along its back, middle and front, at its foot, middle and top
      const c = Math.cos(Math.atan2(ox, oz)), sn = Math.sin(Math.atan2(ox, oz));
      const [bx0, by0, bz0, bx1, by1, bz1] = potBox;
      for (const yy of [y + by0 + 0.03, y + (by0 + by1) / 2, y + by1 - 0.03]) {
        for (const v of [bz0 + 0.02, (bz0 + bz1) / 2, bz1 - 0.02]) {
          const ax = x + (bx0 + 0.02) * c + v * sn, az = z - (bx0 + 0.02) * sn + v * c;
          if (wallProbe(ax, yy, az, c, -sn, bx1 - bx0 - 0.04) !== null) return null;
        }
        for (const u of [bx0 + 0.02, (bx0 + bx1) / 2, bx1 - 0.02]) {
          const ax = x + u * c + (bz0 + 0.02) * sn, az = z - u * sn + (bz0 + 0.02) * c;
          if (wallProbe(ax, yy, az, sn, c, bz1 - bz0 - 0.04) !== null) return null;
        }
      }
      return y;
    };
    // (the prop check, dev/propcheck.ts: on a sill, not on the ground)
    const recordPot = (x: number, y: number, z: number, yaw: number) => {
      const p = this.protos.get("pots_sill");
      if (p) addProp({ src: "lively", name: "pots_sill", x, y, z, yaw, pts: p.parts.map((q) => q.pos), onTop: true });
    };
    for (const [house, hd] of houses) {
      const u = h01(`pots:${house}`);
      const cat = h01(`cat:${house}`) < 0.22;
      if (u > 0.3 && !cat) continue;
      const wins = windowsBy(hd.x, hd.z);
      if (!wins.length) continue;
      const yaw = Math.atan2(hd.ox, hd.oz);
      const w0 = wins[Math.floor(u * 97) % wins.length];
      if (u <= 0.3 && open(w0.x + hd.ox * 0.6, w0.z + hd.oz * 0.6)) {
        const y0 = potsOn(w0.x, w0.z, hd.ox, hd.oz, SILL_GROUND);
        if (y0 !== null) {
          put("pots_sill", w0.x, y0, w0.z, yaw);
          recordPot(w0.x, y0, w0.z, yaw);
        }
        const y1 = u < 0.12 && w0.storeys >= 2 ? potsOn(w0.x, w0.z, hd.ox, hd.oz, GROUND_H + SILL_UPPER) : null;
        if (y1 !== null) {
          put("pots_sill", w0.x, y1, w0.z, yaw);
          recordPot(w0.x, y1, w0.z, yaw);
        }
        this.stats_.pots++;
      }
      // a cat on the sill of the other window, now and then
      const w1 = wins.length > 1 ? wins[(Math.floor(u * 97) + 1) % wins.length] : null;
      if (cat && w1) this.cats.push({ a: null as unknown as Animal, x: w1.x + hd.ox * 0.14, z: w1.z + hd.oz * 0.14, y: SILL_GROUND + 0.02, yaw: yaw + rnd(-0.6, 0.6), house, shown: false });
    }

    // --- the children's pitches: a spot with room on each square they play on; hopscotch and a ring drawn there
    for (const [id, pl] of Object.entries(town.places)) {
      if (!id.startsWith("play:")) continue;
      const pitch = this.findPitch(id, pl.x, pl.z, pl.r, isClear, open);
      if (!pitch) continue;
      this.pitches.set(id, pitch);
      put("chalk_hop", pitch.x, 0.02, pitch.z, pitch.yaw);
      put("chalk_ring", pitch.x + Math.cos(pitch.yaw) * 3.2, 0.02, pitch.z - Math.sin(pitch.yaw) * 3.2, 0);
      this.stats_.chalk += 2;
    }

    // --- hens in the courts, and a goat tethered in a lane (the narrowest lanes of the town)
    const narrow = [...houses.entries()]
      .map(([house, hd]) => {
        let w = 12;
        for (let s = 1; s <= 12; s += 0.5) if (!open(hd.x + hd.ox * s, hd.z + hd.oz * s)) { w = s; break; }
        return { house, hd, w };
      })
      .filter((q) => q.w < 7.5)
      .sort((a, b) => h01(`court:${a.house}`) - h01(`court:${b.house}`));
    let hensAt = 0;
    let goatsAt = 0;
    for (const q of narrow) {
      const cx = q.hd.x + q.hd.ox * Math.min(1.6, q.w / 2) - q.hd.oz * 2.6;
      const cz = q.hd.z + q.hd.oz * Math.min(1.6, q.w / 2) + q.hd.ox * 2.6;
      if (!open(cx, cz) || !this.world.isFree(cx, cz, 0.5) || !isClear(cx, cz, 0.4) || [...this.hens, ...this.goats].some((a) => dist(a.hx, a.hz, cx, cz) < 30)) continue;
      if (goatsAt < 2 && h01(`goat:${q.house}`) < 0.4) {
        this.addGoat(cx, cz);
        goatsAt++;
      } else if (hensAt < 6) {
        for (let k = 0; k < 3; k++) this.addHen(cx + rnd(-0.8, 0.8), cz + rnd(-0.8, 0.8), cx, cz);
        hensAt++;
      }
      if (hensAt >= 6 && goatsAt >= 2) break;
    }
    this.stats_.hens = this.hens.length;
    this.stats_.goats = this.goats.length;
    this.stats_.cats = this.cats.length;

    // --- merge and show, hidden beyond the fog
    for (const [k, b] of buckets) {
      const slot = Number(k.split(",")[2]);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, slot === DECAL ? this.decalMat! : this.solidMat!);
      mesh.name = `lively_${k}`;
      mesh.renderOrder = slot === DECAL ? 1 : 0;
      this.group.add(mesh);
      this.chunks.push(mesh);
    }
    for (const m of this.madonnas) this.points.push({ label: "before a corner Madonna", x: m.sx, z: m.sz, reach: 1.8 });
    for (const b of this.view.beggars) this.points.push({ label: "a beggar's place at the church", x: b[0], z: b[1], reach: 2 });
  }

  private offLanes(x: number, z: number, r: number): boolean {
    if (!this.lanes) {
      this.lanes = [...omnibusKeepOut()];
      for (const l of trafficLanes()) for (let i = 0; i < l.x.length; i += 8) this.lanes.push({ minX: l.x[i] - l.half, maxX: l.x[i] + l.half, minZ: l.z[i] - l.half, maxZ: l.z[i] + l.half });
    }
    return !this.lanes.some((q) => x > q.minX - r && x < q.maxX + r && z > q.minZ - r && z < q.maxZ + r);
  }

  /** A pitch on a play place: 7 x 4 m of open ground off the lanes, near the middle. */
  private findPitch(id: string, cx: number, cz: number, r: number, isClear: (x: number, z: number, r: number) => boolean, open: (x: number, z: number) => boolean): Pitch | null {
    for (let d = 2; d < Math.max(8, r); d += 1.5)
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * Math.PI * 2 + h01(id) * 6;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        const yaw = h01(`${id}:yaw`) * Math.PI;
        let ok = isClear(x, z, 3.5);
        // open ground and nothing standing on it (the well, a pump, a stall): 8 x 8 m round the pitch
        for (let dx = -4; ok && dx <= 4; dx += 1) for (let dz = -4; ok && dz <= 4; dz += 1) if (!open(x + dx, z + dz) || !this.world.isFree(x + dx, z + dz, 0.4)) ok = false;
        if (ok) return { place: id, x, z, yaw, clock: 0, rope: null, marbles: null, marblesSeen: 0, order: new Map(), seenAt: new Map(), hop: { t: 0, ready: false, seen: -9 } };
      }
    return null;
  }

  private addHen(x: number, z: number, hx: number, hz: number): void {
    const body = new THREE.Group();
    body.add(this.mesh("hen_body"));
    const head = this.mesh("hen_head");
    head.position.set(0, 0.34, 0.1);
    body.add(head);
    const legs = [-0.04, 0.04].map((dx) => {
      const l = this.mesh("hen_leg");
      l.position.set(dx, 0.17, 0);
      body.add(l);
      return l;
    });
    body.visible = false;
    this.group.add(body);
    this.hens.push({ body, head, legs, hx, hz, x, z, yaw: rnd(0, 6.28), t: rnd(0, 3), tx: x, tz: z, peck: 0 });
  }

  private addGoat(x: number, z: number): void {
    const body = new THREE.Group();
    body.add(this.mesh("goat_body"));
    const head = this.mesh("goat_head");
    head.position.set(0, 0.72, 0.4);
    body.add(head);
    const legs = [[-0.1, 0.3], [0.1, 0.3], [-0.1, -0.32], [0.1, -0.32]].map(([lx, lz]) => {
      const l = this.mesh("goat_leg");
      l.position.set(lx, 0.5, lz);
      body.add(l);
      return l;
    });
    body.visible = false;
    this.group.add(body);
    this.goats.push({ body, head, legs, hx: x, hz: z, x, z, yaw: rnd(0, 6.28), t: 0, tx: x, tz: z, gait: 0 });
  }

  // ------------------------------------------------------------------ the town's hook

  /** Given to town.ts (town.lively). */
  hook(): NonNullable<Town["lively"]> {
    return {
      key: (s, now, day, hour) => this.keyOf(s, now, day, hour),
      goal: (s, now) => this.goalOf(s, now),
      behave: (s, dt, hour) => this.behave(s, dt, hour),
      spawned: (s) => this.spawned(s),
      lost: (s) => this.lost(s),
      playing: (s) => {
        const k = this.kits.get(s.r.id);
        return !!k && (!!k.game || !!k.watch);
      },
    };
  }

  private doorNow(s: Sim, now: Now, day: number, hour: number) {
    if (!this.view) return null;
    const d = doorAt(this.view.door[s.r.id], day, hour, this.weather());
    if (!d) return null;
    // only in the time their own day has them at home (a maid at her master's door)
    if (d.where === "home" && now.act !== "home") return null;
    if (d.where === "work" && now.act !== "work") return null;
    // the window is shown from indoors (update): the town keeps them in
    if (d.act === "window") return null;
    return d;
  }

  private keyOf(s: Sim, now: Now, day: number, hour: number): string {
    const d = this.doorNow(s, now, day, hour);
    return d ? `|door:${d.act}` : "";
  }

  private goalOf(s: Sim, now: Now): Goal | null {
    const r = s.r;
    const { day, hour } = this.clock();
    const d = this.doorNow(s, now, day, hour);
    if (d) {
      const door = d.where === "work" && r.work.door ? { x: r.work.door[0], z: r.work.door[1], sx: r.work.door[0], sz: r.work.door[1] } : r.home;
      // the way out of the house: from the door to the step before it
      let ox = door.sx - door.x;
      let oz = door.sz - door.z;
      const L = Math.hypot(ox, oz);
      if (L < 0.1) {
        // a work door is the step itself: out is toward the open street
        const o = this.outAt(door.sx, door.sz);
        ox = o[0];
        oz = o[1];
      } else {
        ox /= L;
        oz /= L;
      }
      const dx = door.sx - ox * Math.max(0, L - 0.75);
      const dz = door.sz - oz * Math.max(0, L - 0.75);
      switch (d.act) {
        case "scrub":
          // on her knees on the step, facing the door
          return { mode: "stand", x: dx, z: dz, yaw: Math.atan2(-ox, -oz), motion: "scrub" };
        case "lace":
        case "knit": {
          // a chair by the door against the wall, facing the street
          for (const out of [0.95, 1.2])
            for (const side of [1, -1]) {
              const cx = door.sx - ox * Math.max(0, L - out) - oz * side * 1.25;
              const cz = door.sz - oz * Math.max(0, L - out) + ox * side * 1.25;
              if (this.world.isFree(cx, cz, 0.25) && this.world.isFree(cx + ox * 0.5, cz + oz * 0.5, 0.2)) return { mode: "stand", x: cx, z: cz, yaw: Math.atan2(ox, oz), motion: "lace" };
            }
          return { mode: "stand", x: door.sx, z: door.sz, yaw: Math.atan2(ox, oz), motion: "idle" };
        }
        case "flowers": {
          const m = this.nearestMadonna(r.home.sx, r.home.sz);
          if (m) return { mode: "stand", x: m.sx, z: m.sz, yaw: Math.atan2(m.x - m.sx, m.z - m.sz), motion: "cross" };
          break;
        }
        case "flowers_church": {
          const c = this.town.data?.places.church;
          if (c) return { mode: "church", x: c.x, z: c.z };
          break;
        }
      }
      return null;
    }
    if (now.act !== "work") return null;
    const w = r.work;
    if (w.kind === "round" && w.route?.length) return { mode: "patrol", x: w.route[0][0], z: w.route[0][1], route: w.route, faces: w.faces };
    return null;
  }

  /** The way into the open street from a point on a door step. */
  private outAt(x: number, z: number): [number, number] {
    let best: [number, number] = [0, 1];
    let bd = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      let d = 0;
      for (let s = 0.5; s <= 6; s += 0.5) {
        if (this.world.city.flags(x + Math.sin(a) * s, z + Math.cos(a) * s) !== 0) break;
        d = s;
      }
      if (d > bd) {
        bd = d;
        best = [Math.sin(a), Math.cos(a)];
      }
    }
    return best;
  }

  private nearestMadonna(x: number, z: number) {
    let best: (typeof this.madonnas)[number] | null = null;
    let bd = 90;
    for (const m of this.madonnas) {
      const d = dist(m.x, m.z, x, z);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ in the street

  private kit(s: Sim): Kit {
    let k = this.kits.get(s.r.id);
    if (!k) this.kits.set(s.r.id, (k = { hand: null, back: null, dogcart: null, barrow: null, cart: false, placed: [], wet: null, motion: null, crossT: 0, lastMadonna: -1, game: null, watch: null, well: null, wellDone: 0 }));
    return k;
  }

  private spawned(s: Sim): void {
    if (!this.ready || !s.p) return;
    this.dress(s);
  }

  /** Give a person in the street what they carry for what they do now. */
  private dress(s: Sim): void {
    const p = s.p;
    if (!p) return;
    const k = this.kit(s);
    const r = s.r;
    const working = s.goal.mode === "patrol" && r.work.kind === "round";
    const trade = r.trade;
    // vehicles: the dog cart, the grinder's barrow, the handcart
    if (working && (trade === "milk_woman" || trade === "baker_boy")) {
      if (!k.dogcart) k.dogcart = new DogCart(this, trade === "milk_woman" ? "milk" : "bread", r.id, p);
    } else if (k.dogcart) {
      k.dogcart.dispose();
      k.dogcart = null;
    }
    if (working && trade === "grinder") {
      if (!k.barrow) k.barrow = new Barrow(this, p);
    } else if (k.barrow) {
      k.barrow.dispose(p);
      k.barrow = null;
    }
    const cart = working && (trade === "ragman" || trade === "coalman" || trade === "mussel_seller");
    if (cart && !k.cart) {
      this.crowd.puppetVehicle(p, { kind: "cart", items: 3, what: trade === "mussel_seller" ? "fish" : "sacks" });
      k.cart = true;
    } else if (!cart && k.cart) {
      this.crowd.puppetVehicle(p, null);
      k.cart = false;
    }
    // on the shoulder: the broom seller's bundle
    const back = working && trade === "broom_seller" ? "broom_bundle" : null;
    this.setBack(p, k, back);
    // in the hand: flowers to the Madonna, the travellers' book is in the model
    const flowers = s.key.includes("|door:flowers");
    this.setHand(p, k, flowers ? "flowers" : null);
    // the mussel seller's lantern over her basket at dusk
    if (working && trade === "mussel_seller") this.crowd.puppetLantern(p, this.clock().hour >= 18.25);
  }

  private setBack(p: Puppet, k: Kit, name: string | null): void {
    if ((k.back?.userData.name ?? null) === name) return;
    k.back?.removeFromParent();
    k.back = null;
    if (!name) return;
    const o = this.mesh(name);
    o.userData.name = name;
    const sc = p.human.scale;
    o.position.set(0.16 * sc, 1.46 * sc, -0.05);
    o.rotation.set(-0.35, 0, 0);
    p.group.add(o);
    k.back = o;
  }

  private setHand(p: Puppet, k: Kit, name: string | null): void {
    if ((k.hand?.userData.name ?? null) === name) return;
    k.hand?.removeFromParent();
    k.hand = null;
    if (!name) return;
    const hand = p.human.root.getObjectByName("handR");
    if (!hand) return;
    const o = this.mesh(name);
    o.userData.name = name;
    p.group.updateMatrixWorld(true);
    const ws = new THREE.Vector3();
    hand.getWorldScale(ws);
    o.scale.setScalar(1 / (ws.x || 1));
    o.position.set(0, -0.12 / (ws.x || 1), 0);
    o.rotation.x = Math.PI;
    hand.add(o);
    k.hand = o;
  }

  private lost(s: Sim): void {
    const k = this.kits.get(s.r.id);
    if (!k) return;
    const p = s.p;
    k.dogcart?.dispose();
    if (p) k.barrow?.dispose(p);
    else k.barrow?.dispose(null);
    if (p && k.cart) this.crowd.puppetVehicle(p, null);
    k.hand?.removeFromParent();
    k.back?.removeFromParent();
    for (const o of k.placed) o.removeFromParent();
    this.dropGame(k);
    this.kits.delete(s.r.id);
    this.rounds.delete(s.r.id);
  }

  /** The first say over a puppet: true when this file moves it now. */
  private behave(s: Sim, dt: number, hour: number): boolean {
    if (!this.ready || !s.p || s.held) return false;
    const p = s.p;
    const k = this.kit(s);
    // what they carry follows what they do (the goal changed since they came out)
    this.dress(s);
    const g = s.goal;
    // door life
    if (s.key.includes("|door:")) return this.doorLife(s, k, dt);
    // a round of doors
    if (g.mode === "patrol" && s.r.work.kind === "round") return this.round(s, k, dt);
    // the beggars at the church doors hold out a hand
    if (s.r.trade === "beggar" && g.mode === "stand" && !this.crowd.puppetBusy(p) && dist(p.x, p.z, g.x, g.z) < 1.5) {
      if (p.human.motion !== "beg") this.crowd.puppetStand(p, "beg", g.yaw ?? null);
      return true;
    }
    // the stall keepers against the cathedral: now at the counter, now a word with a buyer
    if (s.r.trade === "devotion_seller" && g.mode === "stand" && !this.crowd.puppetBusy(p) && dist(p.x, p.z, g.x, g.z) < 1.5) {
      if ((s.wait -= dt) <= 0) {
        this.crowd.puppetStand(p, Math.random() < 0.3 ? "talk" : "fold", g.yaw ?? null);
        s.wait = rnd(4, 9);
      }
      return true;
    }
    // the children's games (tag stays the town's)
    if (g.mode === "play" && s.r.age < 16) return this.play(s, k, dt, hour);
    // play time over: the hoop, the stick and the top go home with them (not left standing on the square)
    if (k.game || k.watch) {
      this.dropGame(k, p);
      k.watch = null;
    }
    // at the well on the Handschoenmarkt: water drawn, or a lean on it and a look about
    if (this.atWell(s, k, dt)) return true;
    // the pious passing a corner Madonna
    return this.madonnaPass(s, k, dt);
  }

  private atWell(s: Sim, k: Kit, dt: number): boolean {
    const p = s.p!;
    const w = k.well;
    if (!w) {
      if (!["market", "stroll", "loiter"].includes(s.goal.mode) || s.r.age < 12 || k.cart || k.dogcart || k.barrow) return false;
      if (dist(p.x, p.z, WELL_AT[0], WELL_AT[1]) > 22 || performance.now() - k.wellDone < 90_000 || h01(`well:${s.r.id}`) > 0.5) return false;
      // one of the four sides of the stone well, the way they come from
      const a = Math.atan2(p.x - WELL_AT[0], p.z - WELL_AT[1]);
      const side = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
      const x = WELL_AT[0] + Math.sin(side) * 1.35;
      const z = WELL_AT[1] + Math.cos(side) * 1.35;
      if (!this.crowd.canStand(x, z) || this.town.inStreet(x, z, 0.8).length) return false;
      k.well = { phase: "go", t: 0, x, z, pull: s.r.sex === "f" && h01(`pull:${s.r.id}`) < 0.6, tried: 0 };
      this.crowd.puppetGo(p, x, z);
      return true;
    }
    w.t += dt;
    if (w.phase === "go") {
      if (this.crowd.puppetBusy(p)) {
        if (w.t > 25) k.well = null;
        return true;
      }
      if (dist(p.x, p.z, w.x, w.z) > 1.0) {
        if (w.tried++ > 3) {
          k.well = null;
          k.wellDone = performance.now();
          return false;
        }
        this.crowd.puppetGo(p, w.x, w.z);
        return true;
      }
      w.phase = "at";
      w.t = 0;
      this.crowd.puppetStand(p, w.pull ? "pull" : "lean", Math.atan2(WELL_AT[0] - p.x, WELL_AT[1] - p.z));
      return true;
    }
    if (w.t < (w.pull ? 7 : 12)) return true;
    k.well = null;
    k.wellDone = performance.now();
    this.town.journeyHost().resume(s);
    return true;
  }

  private madonnaPass(s: Sim, k: Kit, dt: number): boolean {
    const p = s.p!;
    if (k.crossT > 0) {
      k.crossT -= dt;
      if (k.crossT <= 0) this.town.journeyHost().resume(s);
      return k.crossT > 0;
    }
    if (!this.crowd.puppetBusy(p) || s.trip || k.cart || k.dogcart || k.barrow) return false;
    if (!["market", "stroll", "home", "church", "loiter", "patrol"].includes(s.goal.mode)) return false;
    const pious = s.r.trade === "nun" || s.r.trade === "beguine" || s.r.trade === "priest" || h01(`pious:${s.r.id}`) < (s.r.sex === "f" ? 0.45 : 0.2);
    if (!pious || s.r.age < 8) return false;
    for (let i = 0; i < this.madonnas.length; i++) {
      const m = this.madonnas[i];
      if (i === k.lastMadonna || dist(m.sx, m.sz, p.x, p.z) > 2.2) continue;
      k.lastMadonna = i;
      if (h01(`${s.r.id}:${i}:${Math.floor(this.clock().hour)}`) > 0.6) return false;
      this.crowd.puppetStand(p, "cross", Math.atan2(m.x - p.x, m.z - p.z));
      k.crossT = 2.4;
      return true;
    }
    return false;
  }

  // ---- door life

  private doorLife(s: Sim, k: Kit, dt: number): boolean {
    const p = s.p!;
    const g = s.goal;
    if (this.crowd.puppetBusy(p)) return true;
    if (dist(p.x, p.z, g.x, g.z) > 1.2) {
      if (s.tries++ < 4) this.crowd.puppetGo(p, g.x, g.z);
      else {
        // cannot get to it: stand where they are
        p.x = g.x;
        p.z = g.z;
      }
      return true;
    }
    const act = s.key.split("|door:")[1];
    if (act === "flowers") {
      // the flowers laid, a sign of the cross, a while in prayer
      if (p.human.motion !== "cross") this.crowd.puppetStand(p, "cross", g.yaw ?? null);
      if ((s.wait -= dt) <= 0) {
        this.setHand(p, k, null);
        s.wait = 1e9;
      }
      return true;
    }
    if (act === "scrub") {
      if (!k.placed.length) {
        const b = this.mesh("bucket");
        b.position.set(p.x + Math.cos(g.yaw ?? 0) * 0.55, 0, p.z - Math.sin(g.yaw ?? 0) * 0.55);
        this.world.scene.add(b);
        k.placed.push(b);
        this.setHand(p, k, "brush");
        k.wet = this.addWet(p.x + Math.sin(g.yaw ?? 0) * 0.3, p.z + Math.cos(g.yaw ?? 0) * 0.3, g.yaw ?? 0);
      }
      if (p.human.motion !== "scrub") {
        p.x = g.x;
        p.z = g.z;
        this.crowd.puppetStand(p, "scrub", g.yaw ?? null);
      }
      if (k.wet) k.wet.born = performance.now() / 1000;
      if ((s.wait -= dt) <= 0) {
        s.wait = rnd(3, 5);
        if (dist(p.x, p.z, this.player.x, this.player.z) < 25) this.sfx?.work("scrub", { x: p.x, z: p.z }, 2.5);
      }
      return true;
    }
    if (act === "lace" || act === "knit") {
      if (!k.placed.length) {
        const yaw = g.yaw ?? 0;
        const c = this.mesh("chair");
        c.position.set(g.x, 0, g.z);
        c.rotation.y = yaw;
        this.world.scene.add(c);
        k.placed.push(c);
        if (act === "lace") {
          const st = this.mesh("lace_stand");
          st.position.set(g.x + Math.sin(yaw) * 0.5, 0, g.z + Math.cos(yaw) * 0.5);
          st.rotation.y = yaw;
          this.world.scene.add(st);
          k.placed.push(st);
        }
      }
      if (p.human.motion !== "lace") {
        p.x = g.x;
        p.z = g.z;
        this.crowd.puppetStand(p, "lace", g.yaw ?? null);
      }
      return true;
    }
    return false;
  }

  private addWet(x: number, z: number, yaw: number): Wet {
    const m = this.mesh("wet_0").children[0] as THREE.Mesh;
    const mat = (m.material as THREE.MeshLambertMaterial).clone();
    mat.opacity = 1;
    m.material = mat;
    const holder = new THREE.Group();
    holder.add(m);
    holder.position.set(x, 0.015, z);
    holder.rotation.y = yaw;
    this.world.scene.add(holder);
    const w: Wet = { mesh: m, born: performance.now() / 1000, life: 45 };
    this.wets.push(w);
    return w;
  }

  // ---- the rounds

  private round(s: Sim, k: Kit, dt: number): boolean {
    const p = s.p!;
    const g = s.goal;
    const route = g.route!;
    const r = s.r;
    // the second of a pair walks at the first one's side (the sweep's boy, a Sister, the wife)
    const lead = this.leadOf(s);
    if (lead?.p) {
      if (dist(lead.p.x, lead.p.z, p.x, p.z) < 14) {
        this.crowd.puppetFollow(p, lead.p);
        const ls = this.rounds.get(lead.r.id);
        if (ls && ls.phase !== "arrive" && !this.crowd.puppetBusy(lead.p) && dist(lead.p.x, lead.p.z, p.x, p.z) < 2.5) {
          this.crowd.puppetFollow(p, null);
          this.crowd.puppetStand(p, r.trade === "tourist" ? "idle" : "talk", Math.atan2(lead.p.x - p.x, lead.p.z - p.z));
        }
        return true;
      }
      // too far to fall in beside: catch up first
      if (this.crowd.puppetFollowing(p)) this.crowd.puppetFollow(p, null);
      if ((s.wait -= dt) <= 0) {
        s.wait = 1;
        this.crowd.puppetGo(p, lead.p.x, lead.p.z, 1.8);
      }
      return true;
    }
    let st = this.rounds.get(r.id);
    if (!st) this.rounds.set(r.id, (st = { phase: "arrive", t: 0, step: s.step, customer: null, cried: false }));
    const i = ((s.step % route.length) + route.length) % route.length;
    const [qx, qz] = route[i];
    const face = g.faces?.[i] ?? null;
    if (st.phase === "arrive") {
      if (this.crowd.puppetBusy(p)) return true;
      if (dist(p.x, p.z, qx, qz) > (k.cart ? 3.6 : k.barrow ? 2.4 : 1.4)) {
        // far off (beyond the walk grid round Jef) they are on their way; near, a way that will not come is given up
        if (this.crowd.onGrid(qx, qz) && s.tries++ > 4) {
          s.tries = 0;
          s.step++;
        }
        const [tx, tz] = route[((s.step % route.length) + route.length) % route.length];
        this.crowd.puppetGo(p, tx, tz);
        return true;
      }
      s.tries = 0;
      st.phase = "cry";
      st.t = 0;
      st.cried = false;
      this.crowd.puppetStand(p, "idle", face);
      k.barrow?.setDown(p);
      return true;
    }
    st.t += dt;
    const near = dist(p.x, p.z, this.player.x, this.player.z) < 40;
    switch (st.phase) {
      case "cry": {
        const cry = CRIES[r.trade];
        if (!st.cried && cry && r.trade !== "sweep" || (!st.cried && r.trade === "sweep" && r.age < 16)) {
          st.cried = true;
          if (cry && near) this.sfx?.cry({ x: p.x, z: p.z }, { sex: r.sex, age: r.age }, cry.notes, cry.beat);
          if (r.trade === "ragman" && near) this.sfx?.bell({ x: p.x, z: p.z });
          if (r.trade === "mussel_seller" && near) this.sfx?.work("rattle", { x: p.x, z: p.z }, 1.2);
          if (!k.cart && !k.dogcart) this.crowd.puppetStand(p, "call", face);
        }
        // the traveller looks up and points (his wife stands at his side, pair follow above)
        if (r.trade === "tourist" && p.human.motion !== "point") this.crowd.puppetStand(p, "point", face);
        if (r.trade === "sweep" && r.age >= 16 && p.human.motion !== "point") this.crowd.puppetStand(p, "point", face);
        if (st.t < (r.trade === "tourist" ? 6 : 2.2)) return true;
        st.phase = "wait";
        st.t = 0;
        // to the door: the milk and the bread are carried in, the Sister goes to knock
        // (M7 back of town: the parish priest and the doctor knock at the doors of the sick too)
        if (["milk_woman", "baker_boy", "nun", "parish_priest", "doctor"].includes(r.trade)) {
          const [dx, dz] = this.doorBy(qx, qz, face);
          if (r.trade === "milk_woman") this.setHand(p, k, "milkcan");
          if (r.trade === "baker_boy") this.setHand(p, k, "bread_basket");
          this.crowd.puppetGo(p, dx, dz);
          st.phase = "to_door";
          if (r.trade === "milk_woman" && near) this.sfx?.work("clink", { x: p.x, z: p.z }, 1);
        } else if (r.trade === "grinder") {
          // someone brings a knife now and then; he grinds a while either way (his own)
          this.customer(s, st, qx, qz);
          k.barrow?.goGrind(p, this.crowd);
          st.phase = "grind";
        } else if (CRIES[r.trade]) this.customer(s, st, qx, qz);
        return true;
      }
      case "to_door":
        if (this.crowd.puppetBusy(p)) return true;
        this.crowd.puppetStand(p, "talk", null);
        st.phase = "at_door";
        st.t = 0;
        return true;
      case "at_door":
        if (st.t < (r.trade === "nun" || r.trade === "parish_priest" ? 5 : r.trade === "doctor" ? 7 : 2.5)) return true;
        this.setHand(p, k, null);
        this.crowd.puppetGo(p, qx, qz);
        st.phase = "back";
        return true;
      case "back":
        if (this.crowd.puppetBusy(p)) return true;
        st.phase = "done";
        return true;
      case "grind": {
        const b = k.barrow;
        if (b && !this.crowd.puppetBusy(p)) {
          if (p.human.motion !== "grind") this.crowd.puppetStand(p, "grind", b.stoneYaw(p));
          b.spin = 1;
          if (near && (s.wait -= dt) <= 0) {
            s.wait = 2.4;
            this.sfx?.work("grind", { x: p.x, z: p.z }, 2.4);
          }
          const at = b.stoneAt();
          this.sparkAt = { ...at, t: 0.2 };
        }
        if (st.t < 9) return true;
        if (b) {
          b.spin = 0;
          b.pickUp(p, this.crowd);
        }
        st.phase = "back";
        return true;
      }
      case "wait":
        if (st.t < (st.customer ? 7 : 4)) return true;
        st.phase = "done";
        return true;
      default: {
        // done: on to the next door
        s.step++;
        st.phase = "arrive";
        st.customer = null;
        const [nx, nz] = route[s.step % route.length];
        this.crowd.puppetGo(p, nx, nz);
        return true;
      }
    }
  }

  /** The door a stop is by: a step from the stop the way it faces. */
  private doorBy(x: number, z: number, yaw: number | null): [number, number] {
    const a = yaw ?? 0;
    for (const d of [1.2, 0.9, 0.6]) {
      const qx = x + Math.sin(a) * d;
      const qz = z + Math.cos(a) * d;
      if (this.crowd.canStand(qx, qz)) return [qx, qz];
    }
    return [x, z];
  }

  /** Someone at home near the stop comes out to buy (now and then): out of the door, a word, back in. */
  private customer(s: Sim, st: RoundState, x: number, z: number): void {
    if (Math.random() > 0.45 || !this.town.data) return;
    const { day, hour } = this.clock();
    const c = this.town.data.residents.find(
      (r) =>
        r.age >= 14 &&
        r.id !== s.r.id &&
        dist(r.home.sx, r.home.sz, x, z) < 16 &&
        activityAt(r.sched, day, hour).act === "home" &&
        !this.town.held(r.id) &&
        !this.town.position(r.id),
    );
    if (!c) return;
    const p = this.town.claim(c.id, { x: c.home.sx, z: c.home.sz });
    if (!p) return;
    st.customer = c.id;
    const sp = s.p!;
    const tx = sp.x + Math.sin(sp.yaw) * 1.1;
    const tz = sp.z + Math.cos(sp.yaw) * 1.1;
    this.crowd.puppetGo(p, tx, tz);
    const id = c.id;
    const seller = s.r.trade;
    // a word at the cart, what they bought in hand, and home again
    let t = 0;
    const tick = () => {
      t += 0.5;
      const q = this.town.puppet(id);
      if (!q || !this.town.held(id)) return;
      if (t < 12 && this.crowd.puppetBusy(q)) return void setTimeout(tick, 500);
      if (t < 14) {
        this.crowd.puppetStand(q, "talk", Math.atan2(sp.x - q.x, sp.z - q.z));
        if (s.p && !this.crowd.puppetBusy(s.p)) this.crowd.puppetStand(s.p, "talk", Math.atan2(q.x - s.p.x, q.z - s.p.z));
        return void setTimeout(tick, 3500), void (t = 14);
      }
      this.crowd.puppetCarry(q, seller === "mussel_seller" ? "basket" : seller === "grinder" ? "parcel" : "sack");
      this.town.release(id);
      setTimeout(() => {
        const qq = this.town.puppet(id);
        if (qq) this.crowd.puppetCarry(qq, null);
      }, 15000);
    };
    setTimeout(tick, 500);
  }

  private leadOf(s: Sim): Sim | null {
    const m = s.r.mate;
    if (!m || m > s.r.id) return null;
    const l = this.town.journeyHost().sim(m) as Sim | undefined;
    return l && !l.inside && l.key === s.key ? l : null;
  }

  // ---- the children's games
  //
  // Fixes 2026-09-25 (Steve: "Rope skipping: not ropes in hands"): who plays is counted per pitch
  // (roster), so the turns and the roles never clash; the skipping rope's ends ride in the two turners'
  // right hands every frame, it turns in step with their arms, and the jumper's hop is set from it
  // (in the air when the rope is under her); the hoop rolls on its own middle with the stick from the
  // hand to its rim; a grown-looking girl of fifteen stands by and watches instead of joining in.

  /** Who plays on this pitch now, in the order of their turns: by the game played (`k:`) or the engine's (`w:`). Counted once a frame. */
  private roster(place: string, kind: ChildGame, by: "k" | "w" = "k"): string[] {
    if (this.rosterAt !== this.frame) {
      this.rosterAt = this.frame;
      this.rosters.clear();
      for (const [id, k] of this.kits) {
        if (!k.game) continue;
        for (const key of [`k:${k.game.place}|${k.game.kind}`, `w:${k.game.place}|${k.game.want}`]) {
          let l = this.rosters.get(key);
          if (!l) this.rosters.set(key, (l = []));
          l.push(id);
        }
      }
      for (const l of this.rosters.values()) l.sort();
    }
    return this.rosters.get(`${by}:${place}|${kind}`) ?? [];
  }

  private play(s: Sim, k: Kit, dt: number, hour: number): boolean {
    const p = s.p!;
    const place = s.goal.place ?? "";
    const pitch = this.pitches.get(place);
    if (!pitch) return false;
    // population.ts dresses a girl or boy of fifteen as grown: they stand by and watch the little ones
    if (p.human.scale > CHILD_BODY) {
      this.dropGame(k, p);
      return this.watchGame(s, k, pitch, dt);
    }
    k.watch = null;
    const { day } = this.clock();
    const games = this.forced.get(place) ?? gamesAt(place, day, hour);
    const want = s.r.sex === "m" ? games.boys : games.girls;
    if (want === "tag") {
      this.dropGame(k, p);
      return false;
    }
    // a skipping rope needs two to turn and one to jump: with fewer they play hopscotch till the third comes
    const kind: ChildGame = want === "rope" && this.roster(place, "rope", "w").length < 3 ? "hopscotch" : want;
    if (!k.game || k.game.kind !== kind || k.game.want !== want || k.game.place !== place) {
      this.dropGame(k, p);
      k.game = { kind, want, place, t: 0, roll: 0 };
      if (kind === "hoops") {
        // the ring turns about its own middle (the model's ring stands on its lowest point)
        const ring = this.mesh("hoop");
        ring.position.y = -HOOP_R;
        const spin = new THREE.Group();
        spin.add(ring);
        const hoop = new THREE.Group();
        hoop.add(spin);
        hoop.position.set(p.x + Math.sin(p.yaw) * 0.75, HOOP_R, p.z + Math.cos(p.yaw) * 0.75);
        hoop.rotation.y = p.yaw;
        this.world.scene.add(hoop);
        k.game.hoop = hoop;
        k.game.spin = spin;
        k.game.stick = this.mesh("stick");
        this.world.scene.add(k.game.stick);
      }
      if (kind === "tops") {
        k.game.top = this.mesh("top");
        this.world.scene.add(k.game.top);
      }
      s.wait = 0;
    }
    const gm = k.game;
    gm.t += dt;
    const rx = Math.cos(pitch.yaw);
    const rz = -Math.sin(pitch.yaw);
    switch (kind) {
      case "hoops":
        return this.playHoop(s, gm, pitch, dt);
      case "tops":
      case "marbles": {
        // down on one knee round the ring, each at his own place (not two on one spot)
        const R = this.roster(place, kind);
        const n = Math.max(1, R.length);
        const i = Math.max(0, R.indexOf(s.r.id));
        const ringX = pitch.x + rx * 3.2;
        const ringZ = pitch.z + rz * 3.2;
        const a = pitch.yaw + ((i + 0.5) / n) * Math.PI * 2;
        const sx = ringX + Math.sin(a) * 0.95;
        const sz = ringZ + Math.cos(a) * 0.95;
        const yaw = Math.atan2(ringX - sx, ringZ - sz);
        if (kind === "marbles") {
          pitch.marblesSeen = this.frame;
          if (!pitch.marbles) {
            pitch.marbles = this.mesh("marbles");
            pitch.marbles.position.set(ringX, 0.005, ringZ);
            this.world.scene.add(pitch.marbles);
          }
          pitch.marbles.visible = true;
        }
        if (!this.reach(p, sx, sz, dt)) {
          if (gm.top) gm.top.visible = false;
          return true;
        }
        // the one whose go it is stays down at the ring; the others kneel or stand up for a word, now and then
        const mine = Math.floor(pitch.clock / 4) % n === i;
        if ((s.wait -= dt) <= 0 || (mine && p.human.motion !== "crouch")) {
          this.crowd.puppetStand(p, mine || Math.random() < 0.7 ? "crouch" : "talk", yaw);
          s.wait = rnd(3, 6);
        }
        p.yaw = yaw;
        if (gm.top) {
          // his top spins on the stones in the ring before him, wandering a little
          gm.top.visible = true;
          const w = gm.t * 0.7 + i;
          gm.top.position.set(ringX + Math.sin(a) * 0.3 + Math.sin(w) * 0.08, 0, ringZ + Math.cos(a) * 0.3 + Math.cos(w * 1.3) * 0.08);
          gm.top.rotation.set(Math.sin(gm.t * 3) * 0.12, gm.top.rotation.y + dt * 30, 0);
        }
        return true;
      }
      case "hopscotch":
        return this.playHopscotch(s, pitch, dt);
      case "rope":
        return this.playRope(s, pitch, dt);
      default:
        return false;
    }
  }

  /**
   * Walk to a spot of a game: on the walk grid while far, the last metre straight onto it (the grid's
   * cells are coarser). True once there (the body put exactly on the spot).
   */
  private reach(p: Puppet, tx: number, tz: number, dt: number): boolean {
    const d = dist(p.x, p.z, tx, tz);
    if (d > 1) {
      if (!this.crowd.puppetBusy(p)) this.crowd.puppetGo(p, tx, tz, 1.4);
      return false;
    }
    if (d > 0.3) {
      if (p.human.motion !== "walk" || this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "walk", null);
      const k = Math.min(1, (1.1 * dt) / d);
      p.x += (tx - p.x) * k;
      p.z += (tz - p.z) * k;
      p.yaw = Math.atan2(tx - p.x, tz - p.z);
      return false;
    }
    if (this.crowd.puppetBusy(p)) this.crowd.puppetStand(p, "idle", null);
    p.x = tx;
    p.z = tz;
    return true;
  }

  /** A grown-looking fifteen-year-old at the children's square: a place at the side, watching, a word now and then. */
  private watchGame(s: Sim, k: Kit, pitch: Pitch, dt: number): boolean {
    const p = s.p!;
    if (!k.watch) {
      // at one end of the pitch, clear of the rope's lane and the marbles ring at its sides
      const end = h01(`${s.r.id}:watch`) < 0.5 ? -1 : 1;
      const side = (h01(`${s.r.id}:side`) - 0.5) * 4;
      const fx = Math.sin(pitch.yaw);
      const fz = Math.cos(pitch.yaw);
      const q = this.crowd.openNear(pitch.x + fx * 5.2 * end + fz * side, pitch.z + fz * 5.2 * end - fx * side);
      k.watch = q ? { x: q.x, z: q.z } : { x: p.x, z: p.z };
    }
    if (this.crowd.puppetBusy(p)) return true;
    if (dist(p.x, p.z, k.watch.x, k.watch.z) > 0.8) {
      if ((s.wait -= dt) <= 0) {
        this.crowd.puppetGo(p, k.watch.x, k.watch.z, 1.2);
        s.wait = 2;
      }
      return true;
    }
    if ((s.wait -= dt) <= 0) {
      this.crowd.puppetStand(p, Math.random() < 0.3 ? "talk" : "idle", Math.atan2(pitch.x - p.x, pitch.z - p.z));
      s.wait = rnd(4, 9);
    }
    return true;
  }

  /** Bowling the hoop round the square: the hoop rolls ahead on his right, the stick from his right hand to its rim. */
  private playHoop(s: Sim, gm: NonNullable<Kit["game"]>, pitch: Pitch, dt: number): boolean {
    const p = s.p!;
    const moving = this.crowd.puppetBusy(p);
    if (!moving && (s.wait -= dt) <= 0) {
      // round the square, outside the other games (the rope's lane, the chalk, the ring): on a ring 6 to 9 m
      // out, a step of it at a time the same way round
      gm.ang = (gm.ang ?? Math.atan2(p.x - pitch.x, p.z - pitch.z)) + rnd(0.5, 1.0) * (h01(s.r.id) < 0.5 ? 1 : -1);
      const d = rnd(6, 9);
      const q = this.crowd.openNear(pitch.x + Math.sin(gm.ang) * d, pitch.z + Math.cos(gm.ang) * d);
      if (q) this.crowd.puppetGo(p, q.x, q.z, rnd(1.8, 2.4));
      s.wait = rnd(0.3, 1.0);
    }
    const hoop = gm.hoop!;
    const F = [Math.sin(p.yaw), Math.cos(p.yaw)];
    const Rt = [-Math.cos(p.yaw), Math.sin(p.yaw)];
    const s0 = p.human.scale * p.size;
    // ahead of him and a little to his right, where the stick in the right hand reaches
    const tx = p.x + F[0] * 0.85 * s0 / 0.72 + Rt[0] * 0.18;
    const tz = p.z + F[1] * 0.85 * s0 / 0.72 + Rt[1] * 0.18;
    const k = Math.min(1, dt * 10);
    const ox = hoop.position.x;
    const oz = hoop.position.z;
    hoop.position.x += (tx - ox) * k;
    hoop.position.z += (tz - oz) * k;
    hoop.position.y = HOOP_R + this.world.baseAt(hoop.position.x, hoop.position.z);
    hoop.rotation.y += angDiff(p.yaw, hoop.rotation.y) * k;
    // it rolls as far as it goes (radius 0.3 m), and leans a little into the turns
    const moved = Math.hypot(hoop.position.x - ox, hoop.position.z - oz);
    gm.roll += moved / HOOP_R;
    gm.spin!.rotation.x = gm.roll;
    hoop.rotation.z = moving ? Math.sin(gm.t * 2.3) * 0.05 : 0;
    // the stick: from the right hand to the back of the rim, a little above the middle
    const hand = p.human.root.getObjectByName("handR");
    if (hand && p.shown) {
      hand.updateWorldMatrix(true, false);
      const h = new THREE.Vector3().setFromMatrixPosition(hand.matrixWorld);
      const bx = Math.sin(hoop.rotation.y);
      const bz = Math.cos(hoop.rotation.y);
      const c = new THREE.Vector3(hoop.position.x - bx * HOOP_R * 0.8, hoop.position.y + HOOP_R * 0.6, hoop.position.z - bz * HOOP_R * 0.8);
      const d = c.clone().sub(h);
      const L = d.length();
      const st = gm.stick!;
      st.position.copy(h);
      st.quaternion.setFromUnitVectors(UP, d.normalize());
      st.scale.set(1, Math.max(0.2, L / STICK_L), 1);
      st.visible = true;
    } else gm.stick!.visible = false;
    return true;
  }

  /**
   * Who is at this game on the pitch, in the order the turns go (the order they came; the game turns
   * it round: the hopscotch clock in update, updateRope at a miss). Those gone off (home, another game)
   * drop out; `here`: this child is at the pitch now and joins at the end.
   */
  private lineOf(pitch: Pitch, kind: ChildGame, id: string, here: boolean): string[] {
    let o = pitch.order.get(kind);
    if (!o) pitch.order.set(kind, (o = []));
    const R = this.roster(pitch.place, kind);
    pitch.seenAt.set(id, this.frame);
    // gone off, or taken up by something else a while (a word in the street, a talk with Jef): out of the line
    const gone = (x: string) => !R.includes(x) || this.frame - (pitch.seenAt.get(x) ?? -1e9) > 45;
    if (o.some(gone)) {
      const keep = o.filter((x) => !gone(x));
      o.length = 0;
      o.push(...keep);
    }
    if (here && !o.includes(id)) o.push(id);
    return o;
  }

  /**
   * Hopscotch: one at a time up the eight chalk squares a hop a square (the feet leave the stones on
   * each), round at the top and back; the others wait their turn in a row by the first square.
   */
  private playHopscotch(s: Sim, pitch: Pitch, dt: number): boolean {
    const p = s.p!;
    const fx = Math.sin(pitch.yaw);
    const fz = Math.cos(pitch.yaw);
    const rx = Math.cos(pitch.yaw);
    const rz = -Math.sin(pitch.yaw);
    const at = (along: number) => [pitch.x + fx * along, pitch.z + fz * along] as const;
    const line = this.lineOf(pitch, "hopscotch", s.r.id, dist(p.x, p.z, pitch.x, pitch.z) < 6);
    const i = line.indexOf(s.r.id);
    const n = line.length;
    const sq = HOP_LEN / 8;
    // where the feet land: before the first square, then the middle of squares 1 to 8
    const spot = (j: number) => (j === 0 ? -HOP_LEN / 2 - 0.35 : -HOP_LEN / 2 + (j - 0.5) * sq);
    pitch.hop.seen = this.frame;
    if (i === 0) {
      const [x0, z0] = at(spot(0));
      const u = pitch.hop.t;
      if (u < HOP_STEP_UP) {
        // up to the first square; her turn's clock waits till she stands there
        const there = this.reach(p, x0, z0, dt);
        pitch.hop.ready = there;
        if (there && p.human.motion !== "idle") this.crowd.puppetStand(p, "idle", pitch.yaw);
        return true;
      }
      const v = u - HOP_STEP_UP;
      const hop = Math.min(16, Math.floor(v / HOP_S));
      const frac = Math.min(1, (v - hop * HOP_S) / HOP_S);
      // off the ground in the first half of each hop (humans.ts motionLift), the move made in the air
      const air = Math.min(1, frac * 2);
      const e = air * air * (3 - 2 * air);
      let from: number;
      let to: number;
      let yaw = pitch.yaw;
      if (hop < 8) {
        from = spot(hop);
        to = spot(hop + 1);
      } else if (hop === 8) {
        from = to = spot(8);
        yaw = pitch.yaw + Math.PI * e;
      } else {
        from = spot(17 - hop);
        to = spot(16 - hop);
        yaw = pitch.yaw + Math.PI;
      }
      const [x, z] = at(from + (to - from) * e);
      p.x = x;
      p.z = z;
      if (p.human.motion !== "hop") this.crowd.puppetStand(p, "hop", yaw);
      p.yaw = yaw;
      p.human.setPhase("hop", frac);
      return true;
    }
    // waiting: in a row beside the first square, in the order of the turns to come (not yet in the line: coming)
    const q = i < 0 ? n : i - 1;
    const wx = pitch.x - fx * (HOP_LEN / 2 + 1.1) + rx * (q - (n - 2) / 2) * 0.7;
    const wz = pitch.z - fz * (HOP_LEN / 2 + 1.1) + rz * (q - (n - 2) / 2) * 0.7;
    if (this.reach(p, wx, wz, dt) && (p.human.motion === "hop" || p.human.motion === "walk" || (s.wait -= dt) <= 0)) {
      this.crowd.puppetStand(p, Math.random() < 0.3 ? "talk" : "idle", pitch.yaw);
      s.wait = rnd(3, 7);
    }
    return true;
  }

  /** The skipping rope's lane: 3 m to the left of the hopscotch, along the pitch. */
  private ropeLane(pitch: Pitch) {
    const fx = Math.sin(pitch.yaw);
    const fz = Math.cos(pitch.yaw);
    const rx = Math.cos(pitch.yaw);
    const rz = -Math.sin(pitch.yaw);
    return { cx: pitch.x - rx * 3, cz: pitch.z - rz * 3, fx, fz, rx, rz };
  }

  /**
   * The skipping rope: two turn it, facing each other with their right hands on the one line 3 m
   * apart, one skips in the middle. After some turns she misses, the rope stops, and she takes an end
   * (the one whose turner goes to the back of the line); the next in the line jumps. Fewer than three
   * there yet: they wait at the side for the others.
   */
  private playRope(s: Sim, pitch: Pitch, dt: number): boolean {
    const p = s.p!;
    const rope = this.ropeOf(pitch);
    const L = this.ropeLane(pitch);
    const line = this.lineOf(pitch, "rope", s.r.id, dist(p.x, p.z, L.cx, L.cz) < 6);
    const n = line.length;
    const i = line.indexOf(s.r.id);
    // 0, 1: the turners at the two ends; 2: the jumper; 3...: waiting (all of them while fewer than three are there)
    const role = i < 0 ? 3 + n : n < 3 ? 3 + i : i;
    const sc = p.human.scale * p.size;
    let tx: number;
    let tz: number;
    let yaw: number;
    if (role <= 1) {
      // the right hand over the end of the lane: the body back and to the left of it (the rope clip's hand, measured)
      const e = role === 0 ? -1 : 1;
      const F = [-e * L.fx, -e * L.fz]; // facing the other end
      yaw = Math.atan2(F[0], F[1]);
      const rightX = -Math.cos(yaw);
      const rightZ = Math.sin(yaw);
      const hx = L.cx + e * L.fx * ROPE_HALF;
      const hz = L.cz + e * L.fz * ROPE_HALF;
      tx = hx - F[0] * HAND_FWD * sc - rightX * HAND_RIGHT * sc;
      tz = hz - F[1] * HAND_FWD * sc - rightZ * HAND_RIGHT * sc;
    } else if (role === 2) {
      tx = L.cx;
      tz = L.cz;
      yaw = Math.atan2(L.rx, L.rz);
    } else {
      // waiting their turn beside the lane, clear of the rope's sweep
      const q = role - 3;
      const m = Math.max(1, n - 3);
      tx = L.cx + L.rx * 1.5 + L.fx * (q - (m - 1) / 2) * 0.7;
      tz = L.cz + L.rz * 1.5 + L.fz * (q - (m - 1) / 2) * 0.7;
      yaw = Math.atan2(-L.rx, -L.rz);
    }
    if (!this.reach(p, tx, tz, dt)) return true;
    p.yaw = yaw;
    if (role <= 1) {
      if (p.human.motion !== "rope") this.crowd.puppetStand(p, "rope", yaw);
      if (role === 0) {
        rope.a = p;
        rope.aAt = this.frame;
      } else {
        rope.b = p;
        rope.bAt = this.frame;
      }
    } else if (role === 2) {
      const want: Motion = rope.turning ? "hop" : "idle";
      if (p.human.motion !== want) this.crowd.puppetStand(p, want, yaw);
      rope.j = p;
      rope.jAt = this.frame;
    } else if (!this.crowd.puppetBusy(p) && (p.human.motion === "hop" || p.human.motion === "rope" || p.human.motion === "walk" || (s.wait -= dt) <= 0)) {
      this.crowd.puppetStand(p, Math.random() < 0.3 ? "talk" : "idle", yaw);
      s.wait = rnd(3, 7);
    }
    return true;
  }

  private ropeOf(pitch: Pitch): Rope {
    if (!pitch.rope) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array((ROPE_SEG + 1) * 3 * 3), 3));
      const idx: number[] = [];
      for (let i = 0; i < ROPE_SEG; i++)
        for (let k = 0; k < 3; k++) {
          const a = i * 3 + k;
          const b = i * 3 + ((k + 1) % 3);
          idx.push(a, b, a + 3, b, b + 3, a + 3);
        }
      g.setIndex(idx);
      this.ropeMat ??= psx(new THREE.MeshLambertMaterial({ color: 0xc2ae84, side: THREE.DoubleSide }));
      const mesh = new THREE.Mesh(g, this.ropeMat);
      mesh.name = "lively_skipping_rope";
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.world.scene.add(mesh);
      pitch.rope = { mesh, t: 0.5, a: null, b: null, j: null, aAt: -9, bAt: -9, jAt: -9, pause: 0, seen: 0, slot: 0, left: 12, turning: false };
    }
    return pitch.rope;
  }

  /** Once a frame, after the figures moved: the rope turns (or waits), the arms and the hop follow it, its ends in the hands. */
  private updateRope(pitch: Pitch, dt: number): void {
    const rp = pitch.rope!;
    const fresh = (at: number) => this.frame - at <= 3;
    const a = rp.a;
    const b = rp.b;
    const ok = !!a && !!b && fresh(rp.aAt) && fresh(rp.bAt) && a.human.motion === "rope" && b.human.motion === "rope";
    rp.turning = false;
    if (!ok) {
      rp.mesh.visible = false;
      return;
    }
    const jumper = rp.j && fresh(rp.jAt) ? rp.j : null;
    if (rp.pause > 0) rp.pause -= dt;
    else if (jumper) {
      const before = rp.t;
      rp.t += dt / ROPE_TURN;
      // under her feet once a turn; after so many she misses: the rope stops at the bottom, the turns go round
      if (Math.floor(rp.t - 0.5) > Math.floor(before - 0.5) && --rp.left <= 0) {
        rp.t = Math.floor(rp.t - 0.5) + 0.5;
        rp.pause = 1.6;
        // she missed: she takes an end (the near one and the far one by turns), its turner goes to the back of the line
        const line = pitch.order.get("rope");
        if (line && line.length >= 3) {
          const k = rp.slot % 2;
          const turner = line[k];
          line[k] = line[2];
          line.splice(2, 1);
          line.push(turner);
        }
        rp.slot++;
        rp.left = 12 + Math.floor(h01(`${pitch.place}:${rp.slot}`) * 14);
      } else rp.turning = true;
    } else {
      // nobody in the middle: it comes round to the bottom and lies there
      const bottom = Math.ceil(rp.t - 0.5) + 0.5;
      rp.t = Math.min(bottom, rp.t + dt / ROPE_TURN);
      rp.turning = rp.t < bottom;
    }
    const ph = rp.t - Math.floor(rp.t);
    // the turners' arms go round with the rope (the far one's clip runs backwards: the same way round)
    a.human.setPhase("rope", ph);
    b.human.setPhase("rope", 1 - ph);
    if (jumper && jumper.human.motion === "hop") jumper.human.setPhase("hop", ph - 0.25);
    // drawn when one of them is in view (an unseen figure's arms do not move)
    if (!a.shown && !b.shown) {
      rp.mesh.visible = false;
      return;
    }
    // the rope: from hand to hand, bowed out round the line between them
    const ha = a.human.root.getObjectByName("handR");
    const hb = b.human.root.getObjectByName("handR");
    if (!ha || !hb) return;
    ha.updateWorldMatrix(true, false);
    hb.updateWorldMatrix(true, false);
    const A = new THREE.Vector3().setFromMatrixPosition(ha.matrixWorld);
    const B = new THREE.Vector3().setFromMatrixPosition(hb.matrixWorld);
    // the palm, a little below the wrist bone
    A.y -= 0.03;
    B.y -= 0.03;
    const ground = this.world.baseAt((A.x + B.x) / 2, (A.z + B.z) / 2);
    // bowed out as far as the hands are high: it brushes the stones at the bottom, over the head at the top
    const rad = (HAND_UP * (a.human.scale * a.size + b.human.scale * b.size)) / 2;
    const th = ph * Math.PI * 2;
    // the first turner's right: the side the rope swings out to first
    const ay = a.yaw;
    const sx = -Math.cos(ay);
    const sz = Math.sin(ay);
    const c = Math.cos(th);
    const sn = Math.sin(th);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= ROPE_SEG; i++) {
      const u = i / ROPE_SEG;
      const bow = Math.sin(Math.PI * u) * rad;
      const x = A.x + (B.x - A.x) * u + sx * sn * bow;
      const y = A.y + (B.y - A.y) * u + c * bow;
      const z = A.z + (B.z - A.z) * u + sz * sn * bow;
      pts.push(new THREE.Vector3(x, Math.max(ground + ROPE_R, y), z));
    }
    const pos = rp.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const t = new THREE.Vector3();
    const n1 = new THREE.Vector3();
    const n2 = new THREE.Vector3();
    for (let i = 0; i <= ROPE_SEG; i++) {
      t.subVectors(pts[Math.min(ROPE_SEG, i + 1)], pts[Math.max(0, i - 1)]).normalize();
      n1.crossVectors(t, UP);
      if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0);
      n1.normalize();
      n2.crossVectors(t, n1);
      for (let k = 0; k < 3; k++) {
        const w = (k / 3) * Math.PI * 2;
        const q = pts[i];
        pos.setXYZ(i * 3 + k, q.x + (n1.x * Math.cos(w) + n2.x * Math.sin(w)) * ROPE_R, q.y + (n1.y * Math.cos(w) + n2.y * Math.sin(w)) * ROPE_R, q.z + (n1.z * Math.cos(w) + n2.z * Math.sin(w)) * ROPE_R);
      }
    }
    pos.needsUpdate = true;
    rp.mesh.geometry.computeVertexNormals();
    rp.mesh.visible = true;
    rp.seen = this.frame;
  }

  private dropGame(k: Kit, p?: Puppet | null): void {
    if (!k.game) return;
    k.game.hoop?.removeFromParent();
    k.game.stick?.removeFromParent();
    k.game.top?.removeFromParent();
    k.game = null;
    // the clips the rope and the hops held still run on their own again
    p?.human.clipSpeed("rope", 1);
    p?.human.clipSpeed("hop", 1);
  }

  // ------------------------------------------------------------------ once a frame

  update(dt: number, player: { x: number; z: number }, camera: THREE.Camera, fogFar: number): void {
    if (!this.ready) return;
    this.player = { x: player.x, z: player.z };
    if (!this.built) {
      if ((this.tick += dt) > 1) {
        this.tick = 0;
        this.build();
      }
      return;
    }
    const far = fogFar + 8;
    for (const m of this.chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = s.center.distanceTo(camera.position) - s.radius < far;
    }
    // the moving things of the rounds
    for (const [id, k] of this.kits) {
      const p = this.town.puppet(id);
      if (!p) continue;
      k.dogcart?.update(dt, p, fogFar);
      k.barrow?.update(dt, p);
    }
    // the stone throws sparks while he grinds
    this.updateSparks(dt);
    // wet steps dry
    const now = performance.now() / 1000;
    this.wets = this.wets.filter((w) => {
      const age = now - w.born;
      const k = 1 - age / w.life;
      if (k <= 0) {
        w.mesh.parent?.removeFromParent();
        return false;
      }
      (w.mesh.material as THREE.MeshLambertMaterial).opacity = Math.min(1, k * 1.5);
      return true;
    });
    // the children's pitches: the clock of the turns, the skipping rope in the turners' hands, the marbles
    for (const pt of this.pitches.values()) {
      pt.clock += dt;
      // hopscotch: the turn's clock runs once she stands at the first square; at its end the next one's go
      if (this.frame - pt.hop.seen <= 3) {
        if (pt.hop.ready || pt.hop.t >= HOP_STEP_UP) pt.hop.t += dt;
        if (pt.hop.t >= HOP_STEP_UP + 17 * HOP_S) {
          pt.hop.t = 0;
          pt.hop.ready = false;
          const line = pt.order.get("hopscotch");
          if (line && line.length > 1) line.push(line.shift()!);
        }
      }
      if (pt.rope) this.updateRope(pt, dt);
      if (pt.marbles) pt.marbles.visible = this.frame - pt.marblesSeen <= 3;
    }
    this.frame++;
    this.updateWindows(dt, player);
    this.updateCats(dt, player, fogFar);
    this.updateHens(dt, player);
    this.updateGoats(dt, player);
  }

  private updateSparks(dt: number): void {
    const at = this.sparkAt;
    if (!at) {
      if (this.sparks) this.sparks.visible = false;
      return;
    }
    if (!this.sparks) {
      const n = 24;
      const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      this.sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffc860, size: 3, sizeAttenuation: false, fog: false }));
      this.sparks.frustumCulled = false;
      this.sparks.userData.v = Array.from({ length: n }, () => [0, 0, 0, 0]);
      this.world.scene.add(this.sparks);
    }
    const pos = this.sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const vs = this.sparks.userData.v as number[][];
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      v[3] -= dt;
      if (v[3] <= 0) {
        pos.setXYZ(i, at.x, at.y, at.z);
        v[0] = rnd(-0.6, 0.6);
        v[1] = rnd(0.3, 1.6);
        v[2] = rnd(-0.6, 0.6);
        v[3] = rnd(0.15, 0.4);
      } else {
        pos.setXYZ(i, pos.getX(i) + v[0] * dt, pos.getY(i) + v[1] * dt, pos.getZ(i) + v[2] * dt);
        v[1] -= 6 * dt;
      }
    }
    pos.needsUpdate = true;
    this.sparks.visible = true;
    at.t -= dt;
    if (at.t <= 0) this.sparkAt = null;
  }

  /** Heads out of the first-floor window over the door: the gossips (doorAt "window"), near Jef only. */
  private updateWindows(dt: number, player: { x: number; z: number }): void {
    const d = this.town.data;
    if (!d || !this.view) return;
    const { day, hour } = this.clock();
    if ((this.tick -= dt) <= 0) {
      this.tick = 0.5;
      const want = new Set<string>();
      for (const r of d.residents) {
        if (r.home.house < 0 || dist(r.home.x, r.home.z, player.x, player.z) > NEAR) continue;
        const plan = this.view.door[r.id];
        if (!plan) continue;
        const a = doorAt(plan, day, hour, this.weather());
        if (a?.act === "window" && activityAt(r.sched, day, hour).act === "home") want.add(r.id);
      }
      for (const [id, w] of this.windows)
        if (!want.has(id)) {
          w.g.removeFromParent();
          w.h.dispose();
          this.windows.delete(id);
        }
      for (const id of want) {
        if (this.windows.has(id)) continue;
        const r = d.residents.find((x) => x.id === id)!;
        // a house with a first floor over the door
        const front = this.world.streetLife()?.fronts.find((q) => Math.hypot(q.ax + q.tx * q.door - r.home.x, q.az + q.tz * q.door - r.home.z) < 1.0);
        if (!front || front.storeys < 2) continue;
        const h = makeHuman(r.kind as HumanKind);
        if (!h) continue;
        const L = Math.hypot(r.home.sx - r.home.x, r.home.sz - r.home.z) || 1;
        const ox = (r.home.sx - r.home.x) / L;
        const oz = (r.home.sz - r.home.z) / L;
        const g = new THREE.Group();
        g.add(h.root);
        h.play("lean", 0);
        // the lean clip rests the forearms 1.05 m up and 0.55 m out: on the sill of the window over the door (the door bay's window)
        // standing in the room a step back from the wall, leaning out over the sill: the legs stay behind the wall
        g.position.set(r.home.x - ox * 0.34, GROUND_H - 0.4, r.home.z - oz * 0.34);
        g.rotation.set(0.38, Math.atan2(ox, oz), 0, "YXZ");
        g.scale.setScalar(1);
        this.world.scene.add(g);
        this.windows.set(id, { h, g });
      }
    }
    for (const w of this.windows.values()) w.h.update(dt);
  }

  private updateCats(dt: number, player: { x: number; z: number }, fogFar: number): void {
    for (const c of this.cats) {
      const near = dist(c.x, c.z, player.x, player.z) < Math.min(NEAR, fogFar + 5);
      if (near && !c.a) {
        const kinds: AnimalKind[] = ["cat_tabby", "cat_black", "cat_ginger", "cat_white"];
        const a = makeAnimal(kinds[c.house % 4]);
        if (!a) continue;
        c.a = a;
        a.group.position.set(c.x, c.y, c.z);
        a.group.rotation.y = c.yaw;
        a.play(h01(`catlie:${c.house}`) < 0.4 ? "lie" : "sit", 0);
        this.world.scene.add(a.group);
      }
      if (c.a) {
        c.a.group.visible = near;
        if (near) c.a.update(dt);
      }
    }
  }

  private updateHens(dt: number, player: { x: number; z: number }): void {
    for (const h of this.hens) {
      const d = dist(h.x, h.z, player.x, player.z);
      h.body.visible = d < NEAR;
      if (!h.body.visible) continue;
      h.t -= dt;
      // away from Jef when he comes close, else a few steps, a peck
      if (d < 2) {
        const L = d || 1;
        h.tx = h.x + ((h.x - player.x) / L) * 2;
        h.tz = h.z + ((h.z - player.z) / L) * 2;
        h.t = 1;
      } else if (h.t <= 0) {
        h.tx = h.hx + rnd(-2, 2);
        h.tz = h.hz + rnd(-2, 2);
        h.t = rnd(1.5, 4);
        h.peck = 0;
      }
      const dx = h.tx - h.x;
      const dz = h.tz - h.z;
      const L = Math.hypot(dx, dz);
      let walking = false;
      if (L > 0.1) {
        const sp = d < 2 ? 2.2 : 0.5;
        const nx = h.x + (dx / L) * Math.min(L, sp * dt);
        const nz = h.z + (dz / L) * Math.min(L, sp * dt);
        if (this.world.isFree(nx, nz, 0.12)) {
          h.x = nx;
          h.z = nz;
          walking = true;
        } else h.tx = h.x;
        h.yaw += angDiff(Math.atan2(dx, dz), h.yaw) * Math.min(1, dt * 8);
      }
      h.peck += dt;
      const peck = !walking ? Math.max(0, Math.sin(h.peck * 5)) ** 3 : 0;
      h.head.rotation.x = peck * 1.2;
      const step = walking ? Math.sin(performance.now() / 70) * 0.5 : 0;
      h.legs[0].rotation.x = step;
      h.legs[1].rotation.x = -step;
      h.body.position.set(h.x, walking ? Math.abs(step) * 0.02 : 0, h.z);
      h.body.rotation.y = h.yaw;
    }
  }

  private updateGoats(dt: number, player: { x: number; z: number }): void {
    for (const g of this.goats) {
      const d = dist(g.x, g.z, player.x, player.z);
      g.body.visible = d < NEAR;
      if (!g.body.visible) continue;
      g.t -= dt;
      if (g.t <= 0) {
        // tethered: a slow step within its rope, then grazing
        const a = Math.random() * Math.PI * 2;
        g.tx = g.hx + Math.cos(a) * rnd(0.3, 1.4);
        g.tz = g.hz + Math.sin(a) * rnd(0.3, 1.4);
        g.t = rnd(4, 9);
      }
      const dx = g.tx - g.x;
      const dz = g.tz - g.z;
      const L = Math.hypot(dx, dz);
      const walking = L > 0.08;
      if (walking) {
        const nx = g.x + (dx / L) * Math.min(L, 0.45 * dt);
        const nz = g.z + (dz / L) * Math.min(L, 0.45 * dt);
        if (this.world.isFree(nx, nz, 0.3)) {
          g.x = nx;
          g.z = nz;
        } else g.tx = g.x;
        g.yaw += angDiff(Math.atan2(dx, dz), g.yaw) * Math.min(1, dt * 3);
        g.gait += dt * 3;
      }
      const sw = walking ? Math.sin(g.gait * Math.PI * 2) * 0.22 : 0;
      g.legs.forEach((l, i) => (l.rotation.x = (i === 0 || i === 3 ? 1 : -1) * sw));
      // head down to graze when standing, up now and then (and when Jef comes near)
      g.head.rotation.x = walking || d < 4 ? 0 : 0.9 + Math.sin(performance.now() / 900) * 0.15;
      g.body.position.set(g.x, 0, g.z);
      g.body.rotation.y = g.yaw;
    }
  }

  // ------------------------------------------------------------------ checks and the dev

  /** The stall check's record (dev/stallcheck.ts): a stall or goods set out, with its model's points. */
  private recordStall(kind: string, label: string, name: string, x: number, z: number, yaw: number, o: { wall?: boolean; leanTo?: boolean }): void {
    const p = this.protos.get(name);
    if (!p) return;
    addStallThing({ kind, label, x, z, yaw, ...o, parts: p.parts.map((q) => ({ pts: q.pos, u: 0, y: 0, v: 0 })) });
  }

  /** For the path check (CLAUDE.md): the stalls' counters, the Madonnas' stands, the beggars' places, every stop of a round. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out = [...this.points];
    for (const r of this.town.data?.residents ?? []) {
      if (r.work.kind !== "round") continue;
      r.work.route?.forEach(([x, z], i) => out.push({ label: `${r.name}: stop ${i + 1} of the round`, x, z, reach: 2.4 }));
    }
    return out;
  }

  get stats() {
    return { ...this.stats_, kits: this.kits.size, windows: this.windows.size, wets: this.wets.length, chunks: this.chunks.length, built: this.built };
  }

  /** Dev: what each person of the lively streets is doing near Jef. */
  info() {
    const out: Array<Record<string, unknown>> = [];
    for (const [id, k] of this.kits) {
      const p = this.town.puppet(id);
      const st = this.rounds.get(id);
      out.push({ id, who: this.town.info(id)?.name, trade: this.town.info(id)?.trade, at: p ? [+p.x.toFixed(1), +p.z.toFixed(1)] : null, motion: p?.human.motion, phase: st?.phase, dogcart: !!k.dogcart, barrow: !!k.barrow, cart: k.cart, game: k.game?.kind });
    }
    return out;
  }

  /**
   * Dev (the pictures, docs/testing.md rule 5): the games on this pitch now, whatever the engine's hour
   * says (null gives it back); with `kids`, that many children of the town (girls first for a girls'
   * game) are sent there to play, till their day moves them on. Returns who was sent.
   */
  devGames(place: string, games: { boys: ChildGame; girls: ChildGame } | null, kids = 0, girls = true): string[] {
    const pitch = this.pitches.get(place);
    if (!pitch) return [];
    if (games) this.forced.set(place, games);
    else this.forced.delete(place);
    const host = this.town.journeyHost();
    const sent: string[] = [];
    const all = (host.sims() as Sim[]).filter((q) => q.r.age >= 6 && q.r.age < 15 && (q.r.trade === "child" || q.r.trade === "street_child") && !q.inside);
    all.sort((a, b) => (a.r.sex === b.r.sex ? 0 : (a.r.sex === "f") === girls ? -1 : 1) || dist(a.x, a.z, pitch.x, pitch.z) - dist(b.x, b.z, pitch.x, pitch.z));
    for (const q of all.slice(0, kids)) {
      q.goal = { mode: "play", x: pitch.x, z: pitch.z, r: 6, place } as Goal;
      q.wait = 0;
      q.arrived = false;
      sent.push(`${q.r.id} ${q.r.name} (${q.r.sex}, ${q.r.age})`);
    }
    return sent;
  }

  /** Dev: the children's pitches, what is played there and by whom. */
  games() {
    return [...this.pitches.values()].map((pt) => ({
      place: pt.place,
      at: [+pt.x.toFixed(1), +pt.z.toFixed(1)],
      yaw: +pt.yaw.toFixed(2),
      rope: this.ropeLane(pt),
      players: [...this.kits.entries()].filter(([, k]) => k.game?.place === pt.place).map(([id, k]) => `${id}:${k.game!.kind}`),
      turning: pt.rope?.turning ?? false,
      slot: pt.rope?.slot ?? 0,
    }));
  }

  /** Dev: send a townsperson in the street to the well now (the pictures). */
  devWell(id: string): boolean {
    const sim = this.town.journeyHost().sim(id) as Sim | undefined;
    const p = sim?.p;
    if (!sim || !p) return false;
    const k = this.kit(sim);
    const a = Math.atan2(p.x - WELL_AT[0], p.z - WELL_AT[1]);
    const side = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
    const x = WELL_AT[0] + Math.sin(side) * 1.35;
    const z = WELL_AT[1] + Math.cos(side) * 1.35;
    k.well = { phase: "go", t: 0, x, z, pull: sim.r.sex === "f", tried: 0 };
    this.crowd.puppetGo(p, x, z);
    return true;
  }

  /** Protos for the carts (DogCart, Barrow). */
  part(name: string): THREE.Object3D {
    return this.mesh(name);
  }
  get scene(): THREE.Scene {
    return this.world.scene;
  }
  addMover(r: Rect): void {
    this.world.addMover(r);
  }
  removeMover(r: Rect): void {
    this.world.removeMover(r);
  }
}

// ------------------------------------------------------------------ the dog cart

/**
 * A milk woman's (or a baker's boy's) dog cart. The dogs walk in the harness a pace behind and
 * to the right of the one who leads them, the cart after them along the same ground (the trail
 * of her steps), so the rig keeps to her way round the corners. The cart and the dogs are solid
 * for Jef (movers). One or two dogs (the town's look by the owner).
 */
class DogCart {
  readonly root = new THREE.Group();
  private readonly body: THREE.Object3D;
  private readonly wheels: THREE.Object3D[];
  private readonly dogs: Animal[] = [];
  private trail: Array<[number, number]> = [];
  private roll = 0;
  private lx = 0;
  private lz = 0;
  private speed = 0;
  private readonly rects: Rect[] = [0, 1].map(() => ({ minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, top: 1.0 }) as Rect);

  constructor(
    private readonly lively: Lively,
    load: "milk" | "bread",
    owner: string,
    p: Puppet,
  ) {
    this.body = lively.part(`dogcart_${load}`);
    this.wheels = [-0.38, 0.38].map((x) => {
      const w = lively.part("dogcart_wheel");
      w.position.set(x, 0.3, 0);
      this.body.add(w);
      return w;
    });
    this.root.add(this.body);
    const n = h01(`dogs:${owner}`) < 0.5 || load === "bread" ? 1 : 2;
    const looks: AnimalKind[] = ["dog_brown", "dog_black", "dog_spotted", "dog_grey"];
    for (let i = 0; i < n; i++) {
      const a = makeAnimal(looks[Math.floor(h01(`dog:${owner}:${i}`) * 4)]);
      if (!a) continue;
      const hn = lively.part("harness");
      hn.position.set(0, -0.06, 0.18);
      a.group.add(hn);
      this.root.add(a.group);
      this.dogs.push(a);
    }
    lively.scene.add(this.root);
    for (const r of this.rects) lively.addMover(r);
    this.place(p.x, p.z, p.yaw);
    this.lx = p.x;
    this.lz = p.z;
  }

  private place(x: number, z: number, yaw: number): void {
    this.trail = [];
    for (let d = 0; d <= 5; d += 0.2) this.trail.push([x - Math.sin(yaw) * d, z - Math.cos(yaw) * d]);
  }

  private back(d: number, out: { x: number; z: number; yaw: number }): void {
    const t = this.trail;
    let acc = 0;
    for (let i = 0; i + 1 < t.length; i++) {
      const L = Math.hypot(t[i][0] - t[i + 1][0], t[i][1] - t[i + 1][1]);
      if (acc + L >= d) {
        const f = (d - acc) / (L || 1);
        out.x = t[i][0] + (t[i + 1][0] - t[i][0]) * f;
        out.z = t[i][1] + (t[i + 1][1] - t[i][1]) * f;
        out.yaw = Math.atan2(t[i][0] - t[i + 1][0], t[i][1] - t[i + 1][1]);
        return;
      }
      acc += L;
    }
    const n = t.length - 1;
    out.yaw = Math.atan2(t[Math.max(0, n - 1)][0] - t[n][0], t[Math.max(0, n - 1)][1] - t[n][1]);
    out.x = t[n][0] - Math.sin(out.yaw) * (d - acc);
    out.z = t[n][1] - Math.cos(out.yaw) * (d - acc);
  }

  update(dt: number, p: Puppet, fogFar: number): void {
    const [hx, hz] = this.trail[0];
    if (Math.hypot(p.x - hx, p.z - hz) >= 0.2) {
      this.trail.unshift([p.x, p.z]);
      if (this.trail.length > 40) this.trail.length = 40;
    }
    const step = Math.hypot(p.x - this.lx, p.z - this.lz);
    this.lx = p.x;
    this.lz = p.z;
    this.speed += (Math.min(3, step / Math.max(dt, 1e-3)) - this.speed) * Math.min(1, dt * 5);
    const D = { x: 0, z: 0, yaw: 0 };
    const A = { x: 0, z: 0, yaw: 0 };
    this.back(0.5, D);
    this.back(2.0, A);
    // she walks at the dogs' left: the rig a little to her right
    for (const q of [D, A]) {
      q.x -= Math.cos(q.yaw) * 0.55;
      q.z += Math.sin(q.yaw) * 0.55;
    }
    const yaw = Math.atan2(D.x - A.x, D.z - A.z);
    this.body.position.set(A.x, 0, A.z);
    this.body.rotation.y = yaw;
    this.roll += (this.speed * dt) / 0.3;
    for (const w of this.wheels) w.rotation.x = this.roll;
    const walking = this.speed > 0.15;
    this.dogs.forEach((a, i) => {
      const side = this.dogs.length === 2 ? (i ? 0.2 : -0.2) : 0;
      a.group.position.set(D.x + Math.cos(yaw) * side, 0, D.z - Math.sin(yaw) * side);
      a.group.rotation.y = yaw;
      if (walking) {
        a.play("walk");
        a.setPace(this.speed);
      } else if (a.motion === "walk") a.play(Math.random() < 0.5 ? "sit" : "idle");
      a.update(dt);
    });
    this.root.visible = Math.hypot(p.x - this.lx, p.z - this.lz) < fogFar + 10;
    box(this.rects[0], A.x + Math.sin(yaw) * -0.1, A.z + Math.cos(yaw) * -0.1, yaw, 0.42, 0.55);
    box(this.rects[1], D.x, D.z, yaw, 0.3, 0.5);
  }

  dispose(): void {
    for (const a of this.dogs) a.dispose();
    this.root.removeFromParent();
    for (const r of this.rects) this.lively.removeMover(r);
  }
}

/** An oriented box (half widths across and along a heading) as an axis box round it. */
function box(r: Rect, x: number, z: number, yaw: number, halfW: number, halfL: number): void {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const hx = halfW * c + halfL * s;
  const hz = halfW * s + halfL * c;
  r.minX = x - hx;
  r.maxX = x + hx;
  r.minZ = z - hz;
  r.maxZ = z + hz;
}

// ------------------------------------------------------------------ the knife grinder's barrow

/**
 * The grinder's barrow: pushed before him on its one wheel while he walks (it goes where he goes),
 * set down at a door; then he steps to the side of the stone, works the treadle and holds the
 * blade to it (the stone and the flywheel turn), and takes up the handles again.
 */
class Barrow {
  readonly root = new THREE.Group();
  private readonly wheel: THREE.Object3D;
  private readonly stone: THREE.Object3D;
  private readonly fly: THREE.Object3D;
  private down = false;
  spin = 0;
  private turn = 0;
  private rollAcc = 0;
  private lx = 0;
  private lz = 0;
  private readonly rect: Rect = { minX: 1e6, maxX: 1e6, minZ: 1e6, maxZ: 1e6, top: 1.1 };

  constructor(
    private readonly lively: Lively,
    p: Puppet,
  ) {
    this.root.add(lively.part("barrow"));
    this.wheel = lively.part("barrow_wheel");
    this.wheel.position.set(0, 0.3, 0);
    this.stone = lively.part("barrow_stone");
    this.stone.position.set(0, 1.02, -0.55);
    this.fly = lively.part("barrow_fly");
    this.fly.position.set(0.3, 0.85, -0.8);
    this.root.add(this.wheel, this.stone, this.fly);
    lively.scene.add(this.root);
    lively.addMover(this.rect);
    this.lx = p.x;
    this.lz = p.z;
    // he walks with the barrow before him: the crowd keeps room for it
    p.nose = 1.3;
    p.reach = 0.4;
  }

  /** Where the barrow stands when he holds the handles: its wheel 1.6 m before him. */
  private held(p: Puppet): void {
    this.root.position.set(p.x + Math.sin(p.yaw) * 1.6, 0, p.z + Math.cos(p.yaw) * 1.6);
    this.root.rotation.y = p.yaw;
  }

  setDown(p: Puppet): void {
    this.held(p);
    this.down = true;
  }

  /** From the handles to the side of the stone. */
  goGrind(p: Puppet, crowd: Crowd): void {
    const y = this.root.rotation.y;
    const sx = this.root.position.x - Math.sin(y) * 0.55 + Math.cos(y) * 0.6;
    const sz = this.root.position.z - Math.cos(y) * 0.55 - Math.sin(y) * 0.6;
    crowd.puppetGo(p, sx, sz, 0.8);
  }

  stoneYaw(p: Puppet): number {
    const at = this.stoneAt();
    return Math.atan2(at.x - p.x, at.z - p.z);
  }

  stoneAt(): { x: number; y: number; z: number } {
    const y = this.root.rotation.y;
    return { x: this.root.position.x - Math.sin(y) * 0.55, y: 1.02, z: this.root.position.z - Math.cos(y) * 0.55 };
  }

  pickUp(p: Puppet, crowd: Crowd): void {
    const y = this.root.rotation.y;
    crowd.puppetGo(p, this.root.position.x - Math.sin(y) * 1.6, this.root.position.z - Math.cos(y) * 1.6, 0.8);
    this.down = false;
    this.pickT = 3;
  }
  private pickT = 0;

  update(dt: number, p: Puppet): void {
    if (this.pickT > 0) {
      this.pickT -= dt;
      if (this.pickT > 0) this.down = true;
    }
    if (!this.down) this.held(p);
    const step = Math.hypot(this.root.position.x - this.lx, this.root.position.z - this.lz);
    this.lx = this.root.position.x;
    this.lz = this.root.position.z;
    this.rollAcc += step / 0.3;
    this.wheel.rotation.x = this.rollAcc;
    this.turn += dt * this.spin * 14;
    this.stone.rotation.x = this.turn;
    this.fly.rotation.x = this.turn * 0.6;
    const y = this.root.rotation.y;
    box(this.rect, this.root.position.x - Math.sin(y) * 0.7, this.root.position.z - Math.cos(y) * 0.7, y, 0.35, 0.8);
  }

  dispose(p: Puppet | null): void {
    this.root.removeFromParent();
    this.lively.removeMover(this.rect);
    if (p) {
      p.nose = 0;
      p.reach = 0.3;
    }
  }
}
