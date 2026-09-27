import { modelCollider, modelShape } from "./modelCollision";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import INWORLD from "../../../shared/inworld_houses.json";
import { TRAFFIC_ROUTES } from "./traffic";
import { psx } from "../retro/psx";
import { lampFog } from "./lampFog";
import type { Rect } from "./geom";
import { facadeOpenings } from "./cityTextures";
import { boxesOverlap, kerbFront, SIGN_MARGIN, signOnWall, wallBox, type WallBox, type WallProbe } from "./wallprobe";
import { addProp, dropProps } from "./propSpots";

// Street life (tools/blender/build_streetlife.py -> /models/streetlife.glb): the small
// things of an 1873 street, after period photos. Shop signboards and lettering, iron
// bracket signs, striped awnings, corner Madonnas with a lantern, pumps, the well on the
// Handschoenmarkt, horse troughs, washing across narrow lanes and on poles, posters on
// blind walls, street name plates, house numbers, doorsteps, cellar hatches, boot
// scrapers, the damp band at the foot of the walls, straw, dung and puddles.
//
// Everything is placed from data (the house walls and corners carried in the glb, the
// walk map, the city's places) with a seeded random, so the city looks the same every
// load. Copies are merged per 64 m chunk and material: at most five draw calls per
// chunk in view. Nothing stands in the water or blocks walking: only pumps, the well
// and troughs have colliders (returned, for the game to add).

type Flags = (x: number, z: number) => number | undefined;

export interface StreetLifeOptions {
  /** Seed for the layout. */
  seed?: number;
  /** Boxes that already hold something (props, cranes): pumps and troughs keep off them. */
  avoid?: Rect[];
  /** The houses as built (world/wallprobe.ts): signs go only where the wall is really there and clear. */
  probe?: WallProbe;
  /** The engine's bills' places on the walls (world/posters.ts fetchAiSpots): no pump or trough before one. */
  bills?: Array<{ x: number; z: number }>;
}

export interface StreetLife {
  group: THREE.Group;
  /** Walk colliders (pumps, the well, troughs); add them to the world. */
  colliders: Rect[];
  /**
   * Once a frame. `lit` 0..1: how far the lanterns are lit (the gas lamps' level, 1 at
   * night); unlit glass takes the colour of the air. Puddles take the fog's colour.
   * `cam`: hide the chunks beyond the fog for this camera now (without it they follow
   * the camera one frame late).
   */
  update(t: number, dt: number, lit?: number, cam?: THREE.Camera): void;
  /** What was placed, by kind, and the merged meshes. */
  stats: { counts: Record<string, number>; meshes: number; triangles: number };
  /** Where the landmarks of street life stand (pumps, the well, troughs, Madonnas, washing lines, shops), for maps and checks. */
  sites: Array<{ kind: string; x: number; z: number; yaw: number }>;
  /**
   * M6 lively (game/lively.ts): the corner Madonnas (the corner, the way she looks, and where someone
   * stands before her in the street), and the shop fronts with their door (for the goods set out).
   */
  madonnas: Array<{ x: number; z: number; yaw: number; sx: number; sz: number }>;
  shops: Array<{ key: string; ax: number; az: number; tx: number; tz: number; ox: number; oz: number; len: number; door: number }>;
  /** M6 lively: every house front with a door (its bays are 3 m wide, the door in the middle one): where its windows are. */
  fronts: Array<{ ax: number; az: number; tx: number; tz: number; ox: number; oz: number; len: number; door: number; bays: number; storeys: number }>;
  /** Everything put on a house wall (signs, plates, numbers, bills, brackets, awnings, Madonnas), as boxes: for dev/signcheck.ts. */
  wallItems: WallBox[];
  /** The house walls: [ax, az, bx, bz, ox, oz, H, st, kind, style, door, seed, store] (kind 0 a street front). */
  walls: number[][];
  ground_h: number;
  storey_h: number;
  /** The names on the plates (plate_i). */
  streetNames: string[];
  /**
   * Fixes 2026-09-25 (Steve: two neighbours both 52): every house door's number, per street: odd on the
   * left and even on the right walking from the end nearer the river, rising along the street, unique in
   * it. From the plan's walls, so the same every load. `plate`: a number plate is drawn by this door.
   */
  houseNumbers: Array<{ x: number; z: number; n: number; street: number; plate: boolean }>;
  /** Why this flat thing may not go on the house wall there (a window, a door, another sign, no wall), or null: for quayfurniture.ts. */
  clearOnWall(b: WallBox): string | null;
  /** Put a thing another module painted on a house wall on the list (signs check, and nothing else goes over it). */
  addWallItem(b: WallBox): void;
}

interface Meta {
  trades: Array<{ key: string; sign: string; len: number; hang: string | null; awning: number; where: string }>;
  streetNames: string[];
  squareNames: string[];
  plates: number;
  numbers: number;
  posters: string[];
  cloths: string[];
  awningColours: number;
  solid: { size: [number, number]; cells: Record<string, [number, number, number, number]> };
  decal: { size: [number, number]; cells: Record<string, [number, number, number, number]> };
  /** [ax, az, bx, bz, ox, oz, H, st, kind, style, door, seed, store] */
  walls: number[][];
  /** [x, z, dx, dz, o1x, o1z, t1x, t1z, o2x, o2z, t2x, t2z, H, st, store] */
  corners: number[][];
  ground_h: number;
  storey_h: number;
}

interface CityData {
  places: Record<string, { x: number; z: number; kind: string }>;
  doors: Record<string, { x: number; z: number; out: [number, number]; width: number }>;
  bridges: Record<string, number[]>;
  quays: number[][];
}

const OPEN = 0;
const WALL = 1;
/** The kerb's height along the street fronts (tools/blender/build_city.py KERB_H). */
const KERB_Y = 0.12;
const CHUNK = 64;
/** M7: the street doors of the taverns, the Poesje and the homes whose insides stand in the world. */
const INWORLD_DOORS = (INWORLD as { houses: Array<{ door: number[] }> }).houses.map((e) => [e.door[0], e.door[1]] as [number, number]);
/** M6 lively: the Matsijs well on the Handschoenmarkt (world metres). */
export const WELL_AT: [number, number] = [-248, 137.5];
/** M6 lively: how many corner Madonnas at most, and how far apart (Antwerp kept some 150-200 in its old centre; the game's map is compact). */
const MADONNAS_MAX = 48;
const MADONNA_GAP = 16;

/** Material slots, one merged mesh per chunk and slot. */
const SOLID = 0;
const WALL_DECAL = 1;
const GROUND_DECAL = 2;
const PUDDLE = 3;
const GLOW = 4;
/** The house number plates, drawn here (a canvas atlas: any number, not only the glb's fourteen). */
const NUMBER = 5;

// ------------------------------------------------------------------ house numbers (fixes 2026-09-25)

/** The digits of tools/blender/build_streetlife.py GLYPHS (5 x 7), so a plate looks as the glb's did. */
const DIGITS: Record<string, string[]> = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
};
/** A plate's pixels (as paint_number: 3 px round the digits, 11 px high) and its size on the wall (0.016 m a pixel). */
const PLATE_PX = 0.016;
const plateW = (n: number) => String(n).length * 6 - 1 + 6;
const PLATE_H = 11;

/**
 * The house numbers of a town, per street. A street is a chain of door walls along one line: the same
 * side (parallel, in one plane, less than 30 m apart along it) or the two sides facing each other across
 * open ground. The numbers start at the end nearer the river: odd on the left, even on the right.
 */
export function numberHouses(
  doors: Array<{ x: number; z: number; tx: number; tz: number; ox: number; oz: number }>,
  open: (x: number, z: number) => boolean,
  river: Array<[number, number]>,
): Array<{ n: number; street: number }> {
  const N = doors.length;
  const up = Array.from({ length: N }, (_, i) => i);
  const find = (i: number): number => (up[i] === i ? i : (up[i] = find(up[i])));
  const join = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const G = 32;
  const grid = new Map<string, number[]>();
  doors.forEach((d, i) => {
    const k = `${Math.floor(d.x / G)},${Math.floor(d.z / G)}`;
    const l = grid.get(k);
    if (l) l.push(i);
    else grid.set(k, [i]);
  });
  for (let i = 0; i < N; i++) {
    const a = doors[i];
    const gx = Math.floor(a.x / G), gz = Math.floor(a.z / G);
    for (let u = -1; u <= 1; u++) {
      for (let v = -1; v <= 1; v++) {
        for (const j of grid.get(`${gx + u},${gz + v}`) ?? []) {
          if (j <= i) continue;
          const b = doors[j];
          if (Math.abs(a.tx * b.tx + a.tz * b.tz) < 0.96) continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const across = dx * a.ox + dz * a.oz;
          const along = Math.abs(dx * a.tx + dz * a.tz);
          const facing = a.ox * b.ox + a.oz * b.oz;
          if (facing > 0.9) {
            if (Math.abs(across) < 1.5 && along < 30) join(i, j);
          } else if (facing < -0.9 && across > 2.5 && across < 16 && along < 12) {
            // across the street: open ground all the way from one door to the other's wall
            let clear = true;
            for (let k = 0.8; clear && k < across - 0.8; k += 0.7) clear = open(a.x + a.ox * k, a.z + a.oz * k);
            if (clear) join(i, j);
          }
        }
      }
    }
  }
  const streets = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    const r = find(i);
    const l = streets.get(r);
    if (l) l.push(i);
    else streets.set(r, [i]);
  }
  const out = doors.map(() => ({ n: 0, street: -1 }));
  let sid = 0;
  for (const [root, list] of [...streets].sort((p, q) => p[0] - q[0])) {
    void root;
    // the street's direction: the first door's, the others turned to agree
    const d0 = doors[list[0]];
    let tx = 0, tz = 0;
    for (const i of list) {
      const s = doors[i].tx * d0.tx + doors[i].tz * d0.tz < 0 ? -1 : 1;
      tx += doors[i].tx * s;
      tz += doors[i].tz * s;
    }
    const L = Math.hypot(tx, tz) || 1;
    tx /= L;
    tz /= L;
    // start at the end nearer the river
    const proj = list.map((i) => doors[i].x * tx + doors[i].z * tz);
    const lo = list[proj.indexOf(Math.min(...proj))], hi = list[proj.indexOf(Math.max(...proj))];
    const toRiver = (d: { x: number; z: number }) => Math.min(...river.map(([x, z]) => Math.hypot(x - d.x, z - d.z)));
    if (toRiver(doors[hi]) < toRiver(doors[lo]) - 1e-6) {
      tx = -tx;
      tz = -tz;
    }
    // left of the way along: (tz, -tx) turned to the ground (x, z); a house whose front looks right stands on the left
    const lx = tz, lz = -tx;
    const sides: [number[], number[]] = [[], []];
    for (const i of list) sides[doors[i].ox * lx + doors[i].oz * lz < 0 ? 0 : 1].push(i);
    sides.forEach((side, k) => {
      side.sort((a, b) => doors[a].x * tx + doors[a].z * tz - (doors[b].x * tx + doors[b].z * tz) || a - b);
      side.forEach((i, m) => (out[i] = { n: k === 0 ? 1 + 2 * m : 2 + 2 * m, street: sid }));
    });
    sid++;
  }
  return out;
}

/** A prototype: flat arrays per material slot (non-indexed triangles). */
interface Part {
  slot: number;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}
interface Proto {
  parts: Part[];
  /** Footprint under 1.5 m in its own frame, and height. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  /** All of it: [x0, y0, z0, x1, y1, z1]. */
  box: number[];
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

function hash(...n: number[]): number {
  let h = 2166136261;
  for (const v of n) {
    h ^= Math.round(v * 16) | 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ loading

async function loadModels(): Promise<{ protos: Map<string, Proto>; meta: Meta; solidMap: THREE.Texture; decalMap: THREE.Texture }> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/streetlife.glb");
  draco.dispose();
  let meta: Meta | null = null;
  const maps: { solid?: THREE.Texture; decal?: THREE.Texture } = {};
  const slotOf: Record<string, number> = { sl_solid: SOLID, sl_decal: WALL_DECAL, sl_puddle: PUDDLE, sl_glow: GLOW };
  const protos = new Map<string, Proto>();
  const v = new THREE.Vector3();
  const nrm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    if (node.name === "streetlife_meta") {
      meta = JSON.parse(node.userData.meta as string) as Meta;
      continue;
    }
    const proto: Proto = { parts: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
    // the node's own placement is dropped: models sit at their origin
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map) {
        if (mat.name === "sl_solid" || mat.name === "sl_glow") maps.solid ??= mat.map;
        else maps.decal ??= mat.map;
      }
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      nrm.getNormalMatrix(M);
      const P = g.getAttribute("position");
      const N = g.getAttribute("normal");
      const U = g.getAttribute("uv");
      const C = g.getAttribute("color");
      const n = P.count;
      const part: Part = { slot: slotOf[mat.name] ?? SOLID, pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3) };
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(M);
        part.pos.set([v.x, v.y, v.z], i * 3);
        proto.height = Math.max(proto.height, v.y);
        const bb = proto.box;
        bb[0] = Math.min(bb[0], v.x);
        bb[1] = Math.min(bb[1], v.y);
        bb[2] = Math.min(bb[2], v.z);
        bb[3] = Math.max(bb[3], v.x);
        bb[4] = Math.max(bb[4], v.y);
        bb[5] = Math.max(bb[5], v.z);
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
    if (proto.parts.length) protos.set(node.name, proto);
  }
  const solidMap = maps.solid;
  const decalMap = maps.decal;
  if (!meta || !solidMap || !decalMap) throw new Error("streetlife.glb: meta or textures missing");
  for (const t of [solidMap, decalMap]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
  }
  return { protos, meta, solidMap, decalMap };
}

// ------------------------------------------------------------------ merging

class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
}

/**
 * Street life for the city. Call after the city is ready (the walk map must be in;
 * it waits for it if not). Resolves when everything is placed and in the scene.
 */
export async function createStreetLife(scene: THREE.Scene, flags: Flags, opts: StreetLifeOptions = {}): Promise<StreetLife> {
  const { protos, meta, solidMap, decalMap } = await loadModels();
  for (let i = 0; i < 600 && flags(0, 0) === undefined; i++) await sleep(100);
  const city = CITY as unknown as CityData;
  const R = rng(opts.seed ?? 1873);
  const at = (x: number, z: number) => flags(x, z) ?? -1;
  const GH = meta.ground_h ?? 3.8;
  const SH = meta.storey_h ?? 3.0;

  // --- materials: one atlas for solid things, one for things pasted flat
  const DS = THREE.DoubleSide;
  const decalOpts = { map: decalMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 };
  const mats: THREE.Material[] = [];
  // pulled a pixel's depth toward the eye: plates, boards and steps lie a centimetre or two off the
  // walls and kerbs, and with the PS1 wobble that near they flickered through (z-fight check)
  mats[SOLID] = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: DS, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { affine: 0 });
  // on the walls the decals wobble with the (snapped) houses; on the ground they sit still with it
  mats[WALL_DECAL] = psx(new THREE.MeshLambertMaterial({ ...decalOpts, side: DS }), { affine: 0 });
  mats[GROUND_DECAL] = psx(new THREE.MeshLambertMaterial({ ...decalOpts }), { affine: 0, noSnap: true });
  const puddleMat = new THREE.MeshBasicMaterial({ map: decalMap, color: 0x556068, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  mats[PUDDLE] = psx(puddleMat, { affine: 0, noSnap: true });
  const glowMat = new THREE.MeshBasicMaterial({ map: solidMap, color: 0xffc070 });
  // M7 fog lamps: the lanterns fog with the fronts they hang on (a lit one a little further)
  const glowFog = lampFog(glowMat, 1, 1.3);
  mats[GLOW] = glowMat;
  // the house number plates: blue enamel, white digits, painted here into a canvas atlas of 32 x 16 px cells
  // (cell 0: plain enamel for the plates' edges)
  const plateCanvas = document.createElement("canvas");
  plateCanvas.width = 512;
  plateCanvas.height = 512;
  const plateCtx = plateCanvas.getContext("2d")!;
  const plateTex = new THREE.CanvasTexture(plateCanvas);
  plateTex.magFilter = THREE.NearestFilter;
  plateTex.minFilter = THREE.NearestFilter;
  plateTex.generateMipmaps = false;
  plateTex.colorSpace = THREE.SRGBColorSpace;
  plateTex.flipY = false;
  mats[NUMBER] = psx(new THREE.MeshLambertMaterial({ map: plateTex, vertexColors: true, side: DS, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { affine: 0 });
  const plateCells = new Map<number, number>();
  const paintPlate = (cell: number, n: number | null) => {
    const x0 = (cell % 16) * 32, y0 = Math.floor(cell / 16) * 16;
    const w = n === null ? 32 : plateW(n);
    const r = rng(500 + (n ?? 0));
    const enamel = [0.1, 0.14, 0.3];
    for (let y = 0; y < (n === null ? 16 : PLATE_H); y++) {
      for (let x = 0; x < w; x++) {
        let k = 0.92 + r() * 0.16;
        if (r() < 0.06) k *= 0.8;
        plateCtx.fillStyle = `rgb(${enamel.map((c) => Math.round(255 * Math.min(1, c * k))).join(",")})`;
        plateCtx.fillRect(x0 + x, y0 + y, 1, 1);
      }
    }
    if (n === null) return;
    plateCtx.fillStyle = "rgb(230,230,219)";
    let cx = x0 + 3;
    for (const ch of String(n)) {
      DIGITS[ch].forEach((row, ry) => [...row].forEach((c, rx) => c === "#" && plateCtx.fillRect(cx + rx, y0 + 2 + ry, 1, 1)));
      cx += 6;
    }
  };
  paintPlate(0, null);
  const plateCell = (n: number): number => {
    let c = plateCells.get(n);
    if (c === undefined) {
      c = plateCells.size + 1;
      if (c >= 16 * 32) return -1;
      plateCells.set(n, c);
      paintPlate(c, n);
    }
    return c;
  };
  mats.forEach((m, i) => (m.name = ["streetlife_solid", "streetlife_walldecal", "streetlife_grounddecal", "streetlife_puddle", "streetlife_glow", "streetlife_numbers"][i]));

  const buckets = new Map<string, Bucket>();
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const sites: StreetLife["sites"] = [];
  const SITE = /^(pump_|well$|trough$|madonna$|awning$|poster$|bracket sign$)/;
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3();
  const Pv = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const up = new THREE.Vector3(0, 1, 0);

  function bucket(x: number, z: number, slot: number): Bucket {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)},${slot}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = new Bucket()));
    return b;
  }

  // --- things on the house walls, as boxes: nothing may overlap another, a window or a door
  const WALL_KINDS: Record<string, boolean> = { "name plate": true, "house number": true, board: true, lettering: true, poster: true, "bracket sign": false, awning: false, madonna: false };
  const wallItems: WallBox[] = [];
  const itemGrid = new Map<string, WallBox[]>();
  const IG = 8;
  const cellsOf = (b: WallBox, f: (k: string) => void) => {
    const r = b.hu + b.hn + 0.5;
    for (let gx = Math.floor((b.cx - r) / IG); gx <= Math.floor((b.cx + r) / IG); gx++) for (let gz = Math.floor((b.cz - r) / IG); gz <= Math.floor((b.cz + r) / IG); gz++) f(`${gx},${gz}`);
  };
  const addItem = (b: WallBox) => {
    wallItems.push(b);
    cellsOf(b, (k) => {
      let l = itemGrid.get(k);
      if (!l) itemGrid.set(k, (l = []));
      l.push(b);
    });
  };
  /** The first wall thing this box would overlap, with `gap` metres kept clear round it. */
  const clashWith = (b: WallBox, gap = 0.04): WallBox | null => {
    let hit: WallBox | null = null;
    cellsOf(b, (k) => {
      if (hit) return;
      for (const o of itemGrid.get(k) ?? []) if (o !== b && boxesOverlap(b, o, -gap)) return void (hit = o);
    });
    return hit;
  };
  /** The box a model would take there (null: no such model). */
  const boxFor = (name: string, kind: string, x: number, y: number, z: number, yaw: number, sx = 1, sy = 1): WallBox | null => {
    const p = protos.get(name);
    return p ? wallBox(kind, name, WALL_KINDS[kind] ?? false, p.box, x, y, z, yaw, sx, sy) : null;
  };
  // the signs the game hangs over its own doors (world/rijnkaai.ts, game/interiors.ts) are there first
  scene.traverse((o) => {
    const ws = o.userData.wallSign as { kind: string; name: string; flat: boolean } | undefined;
    const g = (o as THREE.Mesh).geometry;
    if (!ws || !g) return;
    o.updateWorldMatrix(true, false);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const n = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    addItem(wallBox(ws.kind, ws.name, ws.flat, [bb.min.x, bb.min.y, Math.min(bb.min.z, -0.005), bb.max.x, bb.max.y, Math.max(bb.max.z, 0.005)], p.x, p.y, p.z, Math.atan2(n.x, n.z)));
  });

  /** East walkthrough 2026-09-25: while set, put() draws nothing (a shop chosen for an in-world house's front). */
  let muted = false;
  /** A copy of a model at (x, y, z), turned by yaw (0: its front looks along +z), stretched sx along its x (and sy up). */
  dropProps("street life");
  /** A pump and its trough: one set (its spout over the trough), for the prop check. */
  let propSet: string | undefined;
  function put(name: string, x: number, y: number, z: number, yaw: number, sx = 1, kind = name, sy = 1): void {
    if (muted) return;
    const p = protos.get(name);
    if (!p) return;
    // the pumps, troughs and the well (the prop check reads them: dev/propcheck.ts)
    if (/^(pump_|trough|well$)/.test(name)) addProp({ src: "street life", name, x, y, z, yaw, s: [sx, sy, 1], pts: p.parts.filter((q) => q.slot === SOLID).map((q) => q.pos), set: propSet });
    if (kind in WALL_KINDS) addItem(wallBox(kind, name, WALL_KINDS[kind], p.box, x, y, z, yaw, sx, sy));
    M.compose(Pv.set(x, y, z), Q.setFromAxisAngle(up, yaw), S.set(sx, sy, 1));
    nm.getNormalMatrix(M);
    const e = M.elements;
    const n = nm.elements;
    for (const part of p.parts) {
      const slot = part.slot === WALL_DECAL && y < 0.05 && name.match(/^(straw|dung|stain)/) ? GROUND_DECAL : part.slot;
      const b = bucket(x, z, slot);
      const { pos, nor, uv, col } = part;
      for (let i = 0; i < pos.length; i += 3) {
        const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
        b.pos.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]);
        const nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
        const ox = n[0] * nx + n[3] * ny + n[6] * nz;
        const oy = n[1] * nx + n[4] * ny + n[7] * nz;
        const oz = n[2] * nx + n[5] * ny + n[8] * nz;
        const l = Math.hypot(ox, oy, oz) || 1;
        b.nor.push(ox / l, oy / l, oz / l);
        b.col.push(col[i], col[i + 1], col[i + 2]);
      }
      for (let i = 0; i < uv.length; i++) b.uv.push(uv[i]);
    }
    count(kind);
    if (SITE.test(kind)) sites.push({ kind, x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2) });
  }

  /** The box of a house number plate with this many digits, as the glb's (0.016 m a pixel, its height and depth from number_0). */
  const plateBox = (n: number): number[] => {
    const b = protos.get("number_0")?.box ?? [0, 2.212, 0, 0, 2.388, 0.012];
    const L = plateW(n) * PLATE_PX;
    return [-L / 2, b[1], b[2], L / 2, b[4], b[5]];
  };
  /** A house number plate at (x, z) on the wall, turned by yaw: an enamel box, the digits on its front. */
  function putPlate(n: number, x: number, z: number, yaw: number): void {
    if (muted) return;
    const cell = plateCell(n);
    if (cell < 0) return;
    const bx = plateBox(n);
    addItem(wallBox("house number", `number_${n}`, true, bx, x, 0, z, yaw));
    const [x0, y0, z0, x1, y1, z1] = bx;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (lx: number, ly: number, lz: number) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
    const b = bucket(x, z, NUMBER);
    const cu = (cell % 16) * 32, cv = Math.floor(cell / 16) * 16;
    const edge = [4 / 512, 4 / 512];
    const face = (pts: number[][], nrm: number[], uvs: number[][] | null) => {
      const [nx, ny, nz] = nrm;
      const wn = [nx * c + nz * s, ny, -nx * s + nz * c];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        b.pos.push(...W(pts[i][0], pts[i][1], pts[i][2]));
        b.nor.push(wn[0], wn[1], wn[2]);
        b.uv.push(...(uvs ? uvs[i] : edge));
        b.col.push(1, 1, 1);
      }
    };
    const w = plateW(n);
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], [
      [(cu + 0.02) / 512, (cv + PLATE_H - 0.02) / 512],
      [(cu + w - 0.02) / 512, (cv + PLATE_H - 0.02) / 512],
      [(cu + w - 0.02) / 512, (cv + 0.02) / 512],
      [(cu + 0.02) / 512, (cv + 0.02) / 512],
    ]);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], null);
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], null);
    face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], null);
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], null);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], null);
    count("house number");
  }

  /** UV of a point in an atlas cell (u, v in 0..1, v up), as the glb does it. */
  function cellUv(atlas: Meta["solid"], cell: string, u: number, v: number): [number, number] {
    const [x, y, w, h] = atlas.cells[cell];
    const [W, H] = atlas.size;
    return [(x + 0.5 + Math.min(1, Math.max(0, u)) * (w - 1)) / W, (y + 0.5 + (1 - Math.min(1, Math.max(0, v))) * (h - 1)) / H];
  }

  /** A quad of our own (grime bands, rope), corners a b c d counter-clockwise seen from the front. */
  function quad(slot: number, atlas: Meta["solid"], cell: string, pts: number[][], uvs: number[][], shade = 1): void {
    const cx = (pts[0][0] + pts[2][0]) / 2;
    const cz = (pts[0][2] + pts[2][2]) / 2;
    const b = bucket(cx, cz, slot);
    const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2];
    const bx = pts[3][0] - pts[0][0], by = pts[3][1] - pts[0][1], bz = pts[3][2] - pts[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      b.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      b.nor.push(nx, ny, nz);
      b.uv.push(...cellUv(atlas, cell, uvs[i][0], uvs[i][1]));
      b.col.push(shade, shade, shade);
    }
  }

  // --- what must stay clear: the game's doors and places, bridges, the start of the Rijnkaai
  const clear: Array<{ x: number; z: number; r: number }> = [];
  for (const d of Object.values(city.doors)) clear.push({ x: d.x + d.out[0] * 1.5, z: d.z + d.out[1] * 1.5, r: Math.min(d.width / 2, 6) + 2.5 });
  for (const [k, s] of Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)) {
    if (!k.startsWith("_") && s.x !== undefined && s.z !== undefined) clear.push({ x: s.x, z: s.z, r: 3 });
  }
  {
    const h = city.doors.hessenatie;
    if (h) clear.push({ x: h.x + h.out[0] * 3.2 - h.out[1] * 5, z: h.z + h.out[1] * 3.2 + h.out[0] * 5, r: 3 });
  }
  const isClear = (x: number, z: number, r: number) => clear.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r);
  const bridges = Object.values(city.bridges).map((b) => ({ minX: Math.min(b[0], b[2]) - 1.5, maxX: Math.max(b[0], b[2]) + 1.5, minZ: Math.min(b[1], b[3]) - 1.5, maxZ: Math.max(b[1], b[3]) + 1.5 }));
  const onBridge = (x: number, z: number) => bridges.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  const START: Rect = { minX: -72, maxX: 66, minZ: -30, maxZ: 27 }; // the game's own quay things (props3d keepOut)
  const inStart = (x: number, z: number) => x > START.minX && x < START.maxX && z > START.minZ && z < START.maxZ;
  const avoid = opts.avoid ?? [];
  const inAvoid = (x: number, z: number, r: number) => avoid.some((a) => x > a.minX - r && x < a.maxX + r && z > a.minZ - r && z < a.maxZ + r);

  /** Ground things already down (steps, hatches, pumps): circles. */
  const taken: Array<[number, number, number]> = [];
  const free = (x: number, z: number, r: number) => taken.every(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) > tr + r);
  /** Open ground along the wall's outward normal from a point, from d0 to d1 metres. */
  const openOut = (x: number, z: number, ox: number, oz: number, d0: number, d1: number) => {
    for (let d = d0; d <= d1 + 1e-6; d += 0.25) if (at(x + ox * d, z + oz * d) !== OPEN) return false;
    return true;
  };

  const places = Object.entries(city.places).map(([name, p]) => ({ name, ...p }));
  const nearPlace = (x: number, z: number, kinds: string[], r: number) => {
    let best: (typeof places)[number] | null = null;
    let bd = r;
    for (const p of places) {
      if (!kinds.includes(p.kind)) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };

  interface Wall {
    ax: number;
    az: number;
    tx: number;
    tz: number;
    ox: number;
    oz: number;
    L: number;
    H: number;
    st: number;
    kind: number;
    style: number;
    door: number;
    seed: number;
    store: number;
    yaw: number;
  }
  const walls: Wall[] = meta.walls.map(([ax, az, bx, bz, ox, oz, H, st, kind, style, door, seed, store]) => {
    const L = Math.hypot(bx - ax, bz - az);
    return { ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, ox, oz, L, H, st, kind, style, door, seed, store, yaw: Math.atan2(ox, oz) };
  });
  const along = (w: Wall, s: number): [number, number] => [w.ax + w.tx * s, w.az + w.tz * s];
  const faceOpen = (w: Wall, s: number, d = 0.8) => {
    const [x, z] = along(w, s);
    return openOut(x, z, w.ox, w.oz, 0.3, d);
  };

  // --- signs on the walls: where they may go
  /** The band over the ground storey's windows and doors, under the first floor's sills: shop boards and lettering. */
  const BOARD_BAND: [number, number] = [3.47, 4.19];
  /** The street name plates: just over the ground storey (their middle), clear of the shop boards' tops. */
  const PLATE_Y = GH + 0.2;
  /** Awnings hang from just over the ground-floor lintels (the model's top is at 3.05 m). */
  const AWNING_Y = 0.2;
  const openingsOf = new Map<Wall, ReturnType<typeof facadeOpenings>>();
  const sAlong = (w: Wall, b: WallBox) => (b.cx - w.ax) * w.tx + (b.cz - w.az) * w.tz;
  /**
   * May this thing go on wall w: inside the wall with a margin at its ends, clear of the other
   * things on the walls, and, for a flat sign, clear of the windows and the door and flat on the
   * wall as built (the probe: no corner, gateway or door surround in the way).
   */
  const fitsOn = (w: Wall, b: WallBox): boolean => {
    const s = sAlong(w, b);
    if (s - b.hu < SIGN_MARGIN || s + b.hu > w.L - SIGN_MARGIN) return false;
    if (clashWith(b)) return false;
    if (!b.flat) return true;
    // the windows and doors of this wall and of any other front in the same place (the plan has
    // a few houses whose fronts run into each other)
    for (const v of frontsNear(b)) {
      let open = openingsOf.get(v);
      if (!open) openingsOf.set(v, (open = facadeOpenings(v.L, v.H, v.door >= 0, v.style, GH, SH)));
      const sv = sAlong(v, b);
      if (open.some((o) => sv - b.hu < o.s1 && o.s0 < sv + b.hu && b.y0 < o.y1 && o.y0 < b.y1)) return false;
    }
    return !opts.probe || !signOnWall(b, opts.probe);
  };
  /** The street fronts in the plane of a flat thing's back, along its length. */
  const frontGrid = new Map<string, Wall[]>();
  for (const w of walls) {
    if (w.kind !== 0) continue;
    const seen = new Set<string>();
    for (let d = 0; d <= w.L + 4; d += 4) {
      const [x, z] = along(w, Math.min(d, w.L));
      const k = `${Math.floor(x / 8)},${Math.floor(z / 8)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      let l = frontGrid.get(k);
      if (!l) frontGrid.set(k, (l = []));
      l.push(w);
    }
  }
  const frontsNear = (b: WallBox): Wall[] => {
    const bx = b.cx - b.nx * b.hn, bz = b.cz - b.nz * b.hn;
    const out: Wall[] = [];
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const v of frontGrid.get(`${Math.floor(bx / 8) + i},${Math.floor(bz / 8) + j}`) ?? []) {
          if (out.includes(v) || v.ox * b.nx + v.oz * b.nz < 0.98) continue;
          if (Math.abs((bx - v.ax) * v.ox + (bz - v.az) * v.oz) > 0.08) continue;
          const sv = (bx - v.ax) * v.tx + (bz - v.az) * v.tz;
          if (sv + b.hu > 0 && sv - b.hu < v.L) out.push(v);
        }
      }
    }
    return out;
  };
  /** Up and stretch for a model to sit in a band of the wall (squeezed a little if it is taller). */
  const inBand = (name: string, [b0, b1]: [number, number]): { y: number; sy: number } => {
    const p = protos.get(name);
    if (!p) return { y: 0, sy: 1 };
    const h = p.box[4] - p.box[1];
    const sy = h > b1 - b0 ? (b1 - b0) / h : 1;
    return { y: (b0 + b1) / 2 - ((p.box[1] + p.box[4]) / 2) * sy, sy };
  };
  /** The street wall that ends at corner (x, z) with outward normal (ox, oz). */
  const wallEnds = new Map<string, Wall[]>();
  const endKey = (x: number, z: number) => `${Math.round(x * 20)},${Math.round(z * 20)}`;
  for (const w of walls) {
    for (const [x, z] of [[w.ax, w.az], along(w, w.L)]) {
      const k = endKey(x, z);
      let l = wallEnds.get(k);
      if (!l) wallEnds.set(k, (l = []));
      l.push(w);
    }
  }
  const wallAtCorner = (x: number, z: number, ox: number, oz: number): Wall | null =>
    (wallEnds.get(endKey(x, z)) ?? []).find((w) => w.kind === 0 && w.ox * ox + w.oz * oz > 0.98) ?? null;

  const colliders: Rect[] = [];
  function collide(name: string, x: number, z: number, yaw: number, _pad = 0): void {
    const p = protos.get(name)!;
    colliders.push(modelCollider(modelShape(p, () => p.parts.filter(q => q.slot === SOLID).map(q => q.pos)), x, z, yaw));
  }

  // ================================================================ pumps, the well, troughs
  /** An engine's bill on the wall within r of (x, z). */
  const billNear = (x: number, z: number, r: number) => (opts.bills ?? []).some((b) => Math.hypot(b.x - x, b.z - z) < r);
  /**
   * Where a thing against wall w at the wall point (wx, wz) stands: `out` metres out and `y` up. On the kerb
   * as built if its foot (its points under 10 cm) fits there whole, a hand off the wall; else in the gutter
   * beyond the kerb; `plain` metres out where no kerb is built.
   */
  const settleOnKerb = (name: string, wx: number, wz: number, w: Wall, plain: number): { out: number; y: number } => {
    const p = protos.get(name);
    const kd = opts.probe ? kerbFront(opts.probe, wx, wz, w.ox, w.oz) : null;
    if (!p || kd === null) return { out: plain, y: 0 };
    let back = Infinity, front = -Infinity;
    for (const part of p.parts) {
      for (let i = 0; i + 2 < part.pos.length; i += 3) {
        if (part.pos[i + 1] > p.box[1] + 0.1) continue;
        back = Math.min(back, part.pos[i + 2]);
        front = Math.max(front, part.pos[i + 2]);
      }
    }
    if (!isFinite(back)) return { out: plain, y: 0 };
    const lo = 0.03 - back, hi = kd - 0.01 - front;
    if (lo <= hi) return { out: Math.max(lo, Math.min(hi, plain)), y: KERB_Y };
    return { out: kd + 0.04 - back, y: 0 };
  };
  {
    const WANT: Array<[string, number, boolean]> = [
      // place, pumps, with a trough
      ["Vismarkt", 1, true],
      ["Steenplein", 1, true],
      ["Grote Markt", 1, false],
      ["Werf", 1, true],
      ["Rijnkaai", 1, true],
      ["Petit Bassin", 1, true],
      ["Canal des Brasseurs", 1, false],
      ["Vleeshuis", 1, false],
      ["Hanseatic House", 1, false],
    ];
    for (const [pname, n, withTrough] of WANT) {
      const pl = city.places[pname];
      if (!pl) continue;
      const cand = walls
        .filter((w) => w.kind === 0 && !w.store && w.L > 3.5)
        .map((w) => ({ w, d: Math.hypot(w.ax + w.tx * w.L * 0.5 - pl.x, w.az + w.tz * w.L * 0.5 - pl.z) }))
        .filter((c) => c.d < 55)
        .sort((a, b) => a.d - b.d);
      let placed = 0;
      for (const { w } of cand) {
        if (placed >= n) break;
        const doorS = w.door >= 0 ? w.door * w.L : -99;
        for (const f of [0.5, 0.25, 0.75, 0.15, 0.85]) {
          const s = w.L * f;
          if (Math.abs(s - doorS) < 2.2 || s < 0.9 || s > w.L - 0.9) continue;
          const [wx, wz] = along(w, s);
          let x = wx + w.ox * 0.45;
          let z = wz + w.oz * 0.45;
          if (billNear(wx, wz, 1.5)) continue;
          if (!openOut(wx, wz, w.ox, w.oz, 0.2, 3.5) || !openOut(wx + w.tx * 0.5, wz + w.tz * 0.5, w.ox, w.oz, 0.2, 2) || !openOut(wx - w.tx * 0.5, wz - w.tz * 0.5, w.ox, w.oz, 0.2, 2)) continue;
          if (!isClear(x, z, 3) || inStart(x, z) || onBridge(x, z) || inAvoid(x, z, 1.2) || !free(x, z, 1.5)) continue;
          // a trough beside it, along the wall
          let tx = 0, tz = 0, ok = !withTrough;
          if (withTrough) {
            for (const side of [1, -1]) {
              const ts = s + side * 1.75;
              if (ts < 1.1 || ts > w.L - 1.1 || Math.abs(ts - doorS) < 2.2) continue;
              const [bx, bz] = along(w, ts);
              tx = bx + w.ox * 0.5;
              tz = bz + w.oz * 0.5;
              if (billNear(bx, bz, 1.6)) continue;
              if (openOut(bx, bz, w.ox, w.oz, 0.2, 3) && openOut(bx + w.tx * 1, bz + w.tz * 1, w.ox, w.oz, 0.2, 1.5) && openOut(bx - w.tx * 1, bz - w.tz * 1, w.ox, w.oz, 0.2, 1.5) && isClear(tx, tz, 3) && !inAvoid(tx, tz, 1.3)) {
                ok = true;
                break;
              }
            }
          }
          if (!ok) continue;
          const kind = pname === "Grote Markt" || pname === "Vismarkt" || R() < 0.35 ? "pump_stone" : "pump_iron";
          // on the kerb as built, its foot a hand off the wall; a trough too deep for the kerb stands in the
          // gutter beyond it, for the horses (the prop check: nothing half on the kerb's edge)
          const py = settleOnKerb(kind, wx, wz, w, 0.45);
          x = wx + w.ox * py.out;
          z = wz + w.oz * py.out;
          // the pump's front (spout) looks out of the wall: its model front is local +z
          propSet = `pump at ${x.toFixed(0)}, ${z.toFixed(0)}`;
          put(kind, x, py.y, z, w.yaw);
          collide(kind, x, z, w.yaw, 0.05);
          taken.push([x, z, 1.2]);
          // (the puddles are ambient.ts's, with real reflections)
          if (withTrough) {
            const [bx, bz] = [tx - w.ox * 0.5, tz - w.oz * 0.5];
            const ty = settleOnKerb("trough", bx, bz, w, 0.5);
            tx = bx + w.ox * ty.out;
            tz = bz + w.oz * ty.out;
            // the trough's long side (model x) along the wall
            put("trough", tx, ty.y, tz, w.yaw);
            propSet = undefined;
            collide("trough", tx, tz, w.yaw, 0.03);
            taken.push([tx, tz, 1.3]);
            for (let k = 0; k < 3; k++) {
              const d = 1.2 + R() * 1.8;
              const a = (R() - 0.5) * 2.4;
              put(k === 0 ? `straw_${Math.floor(R() * 3)}` : `dung_${Math.floor(R() * 2)}`, tx + w.ox * d + w.tx * a, 0.012, tz + w.oz * d + w.tz * a, R() * 6.28, 1, k === 0 ? "straw" : "dung");
            }
          }
          propSet = undefined;
          placed++;
          break;
        }
      }
    }
    // the well on the Handschoenmarkt, standing free
    const hm = city.places["Handschoenmarkt"];
    if (hm) {
      // M6 lively: "adjacent to the principal portal, and opposite the door of the tower" (Baedeker 1869):
      // before the north tower, clear of the central door and of the omnibus lane over the square
      const wx = WELL_AT[0];
      const wz = WELL_AT[1];
      let done = false;
      for (let r = 0; r < 30 && !done; r += 1.5) {
        for (let k = 0; k < 16 && !done; k++) {
          const a = (k / 16) * Math.PI * 2;
          const x = wx + Math.cos(a) * r;
          const z = wz + Math.sin(a) * r;
          let ok = isClear(x, z, 2) && !inAvoid(x, z, 1.5);
          for (let j = 0; ok && j < 12; j++) {
            const b = (j / 12) * Math.PI * 2;
            if (at(x + Math.cos(b) * 3.2, z + Math.sin(b) * 3.2) !== OPEN || at(x + Math.cos(b) * 1.6, z + Math.sin(b) * 1.6) !== OPEN) ok = false;
          }
          if (!ok) continue;
          put("well", x, 0, z, 0);
          collide("well", x, z, 0);
          taken.push([x, z, 1.6]);
          done = true;
        }
      }
    }
  }

  // ================================================================ house numbers, per street (fixes 2026-09-25)
  // (numbered from the plan's walls alone, before anything is drawn: the same numbers every load)
  const doorWalls = walls.filter((w) => w.kind === 0 && w.door >= 0);
  const RIVER: Array<[number, number]> = Array.from({ length: 23 }, (_, i) => [-340 + i * 20, -5] as [number, number]);
  const numbered = numberHouses(
    doorWalls.map((w) => {
      const [x, z] = along(w, w.door * w.L);
      return { x, z, tx: w.tx, tz: w.tz, ox: w.ox, oz: w.oz };
    }),
    (x, z) => at(x, z) === OPEN,
    RIVER,
  );
  const numberOf = new Map<Wall, number>(doorWalls.map((w, i) => [w, numbered[i].n]));
  const houseNumbers: StreetLife["houseNumbers"] = doorWalls.map((w, i) => {
    const [x, z] = along(w, w.door * w.L);
    return { x: +x.toFixed(2), z: +z.toFixed(2), n: numbered[i].n, street: numbered[i].street, plate: false };
  });
  const plateAt = new Map<Wall, (typeof houseNumbers)[number]>(doorWalls.map((w, i) => [w, houseNumbers[i]]));

  // ================================================================ house fronts
  const tradeByWhere = (where: string) => meta.trades.map((t) => [t, t.where === where ? 3 : t.where === "any" ? 2 : 0.6] as const);
  const brackets: Array<[number, number]> = [];
  const shopsNear: Array<{ x: number; z: number; key: string }> = [];
  const shopFronts: StreetLife["shops"] = [];
  const lines: Array<[number, number]> = [];
  const nameGameDoorNear = (x: number, z: number, r: number) => Object.values(city.doors).some((d) => Math.hypot(d.x - x, d.z - z) < r + Math.min(d.width / 2, 6));

  for (const w of walls) {
    const r = rng(w.seed * 7 + 13);
    const mid = along(w, w.L / 2);
    if (w.kind !== 0) continue;
    const bays = Math.max(1, Math.round(w.L / 3));
    const bw = w.L / bays;
    const hasDoor = w.door >= 0;
    const doorS = hasDoor ? w.door * w.L : -99;
    const doorBay = hasDoor ? Math.min(bays - 1, Math.max(0, Math.round(w.door * bays - 0.5))) : -1;
    const [dx, dz] = hasDoor ? along(w, doorS) : mid;
    const gameDoor = hasDoor && nameGameDoorNear(dx, dz, 1.5);
    if (w.store || gameDoor) continue;
    // East walkthrough 2026-09-25: a tavern or a home whose inside stands in the world (M7) is no shop: no
    // "COAL AND PEAT" over Het Bassin, no chemist's board and goods at the garret's door. The shop is still
    // chosen (the same random draws, so every other front stays as it was), only not drawn nor stocked.
    const ownDoor = hasDoor && INWORLD_DOORS.some(([x, z]) => Math.hypot(x - dx, z - dz) < 1.5);
    if (!faceOpen(w, w.L / 2, 1.2)) continue; // a front on the water or against a wall: leave it

    // --- a shop
    const market = nearPlace(mid[0], mid[1], ["square"], 70);
    const quay = nearPlace(mid[0], mid[1], ["quay", "water"], 70);
    const pShop = market || quay ? 0.55 : 0.3;
    let shop = false;
    if (hasDoor && w.L >= 4.2 && r() < pShop) {
      const where = market && (!quay || Math.hypot(market.x - mid[0], market.z - mid[1]) < Math.hypot(quay.x - mid[0], quay.z - mid[1])) ? "market" : quay ? "quay" : "any";
      const table = tradeByWhere(where).filter(([t]) => {
        const painted = t.sign.startsWith("letters_");
        if (painted && !(w.style === 1 || w.style === 2)) return false; // lettering only shows on plaster
        if (t.len > w.L - 0.5) return false;
        return !shopsNear.some((s) => s.key === t.key && Math.hypot(s.x - mid[0], s.z - mid[1]) < 60);
      });
      let sum = 0;
      for (const [, wt] of table) sum += wt;
      let pick = r() * sum;
      let trade = table.find(([, wt]) => (pick -= wt) <= 0)?.[0];
      // the board over the middle of the front, in the band over the ground storey's openings
      const kindOf = (t: Meta["trades"][number]) => (t.sign.startsWith("letters_") ? "lettering" : "board");
      const band = trade ? inBand(trade.sign, BOARD_BAND) : { y: 0, sy: 1 };
      const [sx, sz] = along(w, w.L / 2);
      const boardBox = trade ? boxFor(trade.sign, kindOf(trade), sx, band.y, sz, w.yaw, 1, band.sy) : null;
      if (trade && (!boardBox || !fitsOn(w, boardBox))) trade = undefined; // a gateway or a door surround in the way: no shop here
      if (trade && boardBox) {
        shop = true;
        shopsNear.push({ x: mid[0], z: mid[1], key: trade.key });
        muted = ownDoor;
        if (!ownDoor) {
          shopFronts.push({ key: trade.key, ax: w.ax, az: w.az, tx: w.tx, tz: w.tz, ox: w.ox, oz: w.oz, len: w.L, door: doorS });
          count("shop");
          sites.push({ kind: `shop ${trade.key}`, x: +mid[0].toFixed(1), z: +mid[1].toFixed(1), yaw: +w.yaw.toFixed(2) });
        }
        put(trade.sign, sx, band.y, sz, w.yaw, 1, kindOf(trade), band.sy);
        // a bracket sign at one end of the front, first-floor height, beside the board
        const hang = trade.hang ?? (r() < 0.08 ? "tankard" : null);
        if (hang && r() < 0.85) {
          const free = w.L / 2 - boardBox.hu; // the wall either side of the board
          const off = Math.min(0.5, free / 2);
          for (const end of r() < 0.5 ? [off, w.L - off] : [w.L - off, off]) {
            const [hx, hz] = along(w, end);
            if (brackets.some(([bx, bz]) => Math.hypot(bx - hx, bz - hz) < 2.5)) continue;
            if (!openOut(hx, hz, w.ox, w.oz, 0.3, 1.3)) continue;
            const arm = boxFor(`hang_${hang}`, "bracket sign", hx, 0, hz, w.yaw);
            // its iron plate must be on the wall too
            const plate = wallBox("bracket sign", "", true, [-0.06, 3.67, 0, 0.06, 4.13, 0.03], hx, 0, hz, w.yaw);
            if (!arm || !fitsOn(w, arm) || (opts.probe && signOnWall(plate, opts.probe))) continue;
            put(`hang_${hang}`, hx, 0, hz, w.yaw, 1, "bracket sign");
            brackets.push([hx, hz]);
            break;
          }
        }
        // striped awnings over the shop windows (the bays left and right of the door)
        if (r() < trade.awning) {
          const colour = Math.floor(r() * meta.awningColours);
          const runs: Array<[number, number]> = [[0, doorBay], [doorBay + 1, bays]];
          for (const [k0, k1] of runs) {
            let k = k0;
            while (k < k1) {
              const nb = k1 - k >= 2 ? 2 : 1;
              const s = (k + nb / 2) * bw;
              const [ax, az] = along(w, s);
              const sxScale = Math.min(1.25, Math.max(0.8, bw / 3));
              const half = (nb * 3 - 0.4) * sxScale * 0.5;
              if (openOut(ax, az, w.ox, w.oz, 0.3, 1.6) && faceOpen(w, Math.max(0.1, s - half), 1.5) && faceOpen(w, Math.min(w.L - 0.1, s + half), 1.5)) {
                put(`awning_${nb}_${colour}`, ax, AWNING_Y, az, w.yaw, sxScale, "awning");
              }
              k += nb;
            }
          }
        }
        muted = false;
      }
    }

    // --- the door: a step, a number, a scraper
    if (hasDoor && faceOpen(w, doorS, 0.9)) {
      const kind = r();
      if (kind < 0.9 && free(dx, dz, 0.6)) {
        const two = kind < 0.2;
        put(two ? "step_2" : "step_1", dx, 0, dz, w.yaw, Math.min(1, (bw * 0.6) / 1.5), "doorstep");
        taken.push([dx + w.ox * 0.3, dz + w.oz * 0.3, 0.7]);
        if (r() < 0.3 && !two) {
          const side = r() < 0.5 ? -1 : 1;
          const s = doorS + side * Math.min(1.05, bw * 0.45);
          if (s > 0.3 && s < w.L - 0.3) {
            const [sx, sz] = along(w, s);
            put("scraper", sx, 0, sz, w.yaw, 1, "boot scraper");
          }
        }
      }
      if (r() < 0.6) {
        // beside the doorway, a hand's width off its stone surround (cityTextures.facadeOpenings), clear of the windows
        // (fixes 2026-09-25: the street's number for this door, not one of the glb's fourteen at random)
        const side = r() < 0.5 ? -1 : 1;
        const no = numberOf.get(w) ?? 1;
        const pb = plateBox(no);
        const hw = (pb[3] - pb[0]) / 2;
        const doorHalf = Math.min(bw / 2, Math.max(1.0, (bw * 14) / 64));
        for (const sd of [side, -side]) {
          const [nx, nz] = along(w, doorS + sd * (doorHalf + 0.1 + hw));
          const b = wallBox("house number", `number_${no}`, true, pb, nx, 0, nz, w.yaw);
          if (!fitsOn(w, b)) continue;
          putPlate(no, nx, nz, w.yaw);
          const hn = plateAt.get(w);
          if (hn && !muted) hn.plate = true;
          break;
        }
      }
    }

    // --- a cellar hatch in front of a window bay
    if (!shop && bays >= 2 && r() < 0.3) {
      let k = Math.floor(r() * bays);
      if (k === doorBay) k = (k + 1) % bays;
      const s = (k + 0.5) * bw;
      const [hx, hz] = along(w, s);
      if (k !== doorBay && faceOpen(w, s, 1.4) && free(hx + w.ox * 0.4, hz + w.oz * 0.4, 0.6) && isClear(hx, hz, 0.5)) {
        put("hatch", hx, 0, hz, w.yaw, 1, "cellar hatch");
        taken.push([hx + w.ox * 0.4, hz + w.oz * 0.4, 0.6]);
      }
    }

    // --- a wash pole out of an upper window
    if (w.st >= 3 && bays >= 2 && r() < 0.08) {
      const k = Math.floor(r() * bays);
      const s = (k + 0.5) * bw;
      const [px, pz] = along(w, s);
      const storey = Math.floor(r() * (w.st - 2));
      if (openOut(px, pz, w.ox, w.oz, 0.3, 2.0)) put(`washpole_${Math.floor(r() * 3)}`, px, GH + SH * storey + 0.75, pz, w.yaw, 1, "wash pole");
    }

    // --- a washing line across a narrow lane, from this front to the house opposite
    // (M6 lively: more of them, 0.35 -> 0.6; the one draw per front keeps everything else where it was)
    if (w.L >= 4 && r() < 0.6) {
      const s = w.L * (0.3 + r() * 0.4);
      const [lx, lz] = along(w, s);
      let D = 0;
      let hit = -1;
      for (let d = 0.3; d < 11; d += 0.25) {
        const f = at(lx + w.ox * d, lz + w.oz * d);
        if (f !== OPEN) {
          hit = f;
          D = d;
          break;
        }
      }
      const mx = lx + (w.ox * D) / 2;
      const mz = lz + (w.oz * D) / 2;
      if (hit === WALL && D > 3.2 && D < 10 && !lines.some(([x, z]) => Math.hypot(x - mx, z - mz) < 7) && isClear(mx, mz, 1)) {
        lines.push([mx, mz]);
        const y = GH + 0.9 + (w.st >= 4 && r() < 0.4 ? SH : 0);
        washingLine(lx, lz, w.ox, w.oz, D, y, r);
      }
    }
  }

  /** Rope across the lane (a sagging ribbon crossed with another) and garments on it. */
  function washingLine(x0: number, z0: number, ox: number, oz: number, D: number, y: number, r: () => number): void {
    const sag = 0.15 + 0.035 * D;
    const yAt = (d: number) => y - sag * 4 * (d / D) * (1 - d / D);
    const N = 6;
    for (let i = 0; i < N; i++) {
      const d0 = (D * i) / N;
      const d1 = (D * (i + 1)) / N;
      const a = [x0 + ox * d0, yAt(d0), z0 + oz * d0];
      const b = [x0 + ox * d1, yAt(d1), z0 + oz * d1];
      const w = 0.012;
      // two ribbons, one flat and one upright, so the rope shows from any side
      quad(SOLID, meta.solid, "rope", [[a[0] - oz * w, a[1], a[2] + ox * w], [b[0] - oz * w, b[1], b[2] + ox * w], [b[0] + oz * w, b[1], b[2] - ox * w], [a[0] + oz * w, a[1], a[2] - ox * w]], [[0, 0], [1, 0], [1, 1], [0, 1]], 0.8);
      quad(SOLID, meta.solid, "rope", [[a[0], a[1] - w, a[2]], [b[0], b[1] - w, b[2]], [b[0], b[1] + w, b[2]], [a[0], a[1] + w, a[2]]], [[0, 0], [1, 0], [1, 1], [0, 1]], 0.8);
    }
    // garments: model x along the line
    const yaw = Math.atan2(-oz, ox);
    let d = 0.5 + r() * 0.5;
    while (d < D - 0.6) {
      const name = meta.cloths[Math.floor(r() * meta.cloths.length)];
      const p = protos.get(name);
      if (!p) break;
      const half = Math.max(0.2, (p.maxX - p.minX) / 2 || 0.3);
      if (d + half > D - 0.4) break;
      const c = d + half;
      put(name, x0 + ox * c, yAt(c), z0 + oz * c, yaw, 1, "garment");
      d = c + half + 0.15 + r() * 0.5;
    }
    count("washing line");
    sites.push({ kind: "washing line", x: +(x0 + (ox * D) / 2).toFixed(1), z: +(z0 + (oz * D) / 2).toFixed(1), yaw: +Math.atan2(ox, oz).toFixed(2) });
  }

  // ================================================================ corners: Madonnas and name plates
  const streetName = (x: number, z: number, ox: number, oz: number): number => {
    const sq = nearPlace(x, z, ["square", "quay"], 40);
    if (sq) {
      const i = meta.streetNames.indexOf(sq.name.toUpperCase());
      if (i >= 0) return i;
    }
    // the same street line gives the same name: its direction and offset, rounded
    const ang = Math.round(((Math.atan2(oz, ox) + Math.PI * 2) % Math.PI) / 0.3);
    const off = Math.round((x * ox + z * oz) / 5);
    return hash(ang, off) % (meta.streetNames.length - meta.squareNames.length);
  };
  // M6 lively: the corner Madonnas. Antwerp had hundreds (some 150-200 survive in the old centre), a
  // statue in a niche or on a corbel at the first floor, under a canopy, with an oil lamp beside
  // her (inventaris onroerend erfgoed, "Mariabeelden"). Here up to MADONNAS_MAX at the corners of
  // the old town, never two within MADONNA_GAP metres, in three kinds; each with a spot before her
  // in the street where the pious stop.
  const madonnas: StreetLife["madonnas"] = [];
  const drayLanes = TRAFFIC_ROUTES.flatMap((rt) => rt.pts.slice(0, rt.loop ? rt.pts.length : -1).map((a, i) => [a, rt.pts[(i + 1) % rt.pts.length]] as const));
  const inDrayLane = (x: number, z: number) =>
    drayLanes.some(([[ax, az], [bx, bz]]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < 2.3;
    });
  {
    const cands: Array<{ x: number; z: number; yaw: number; sx: number; sz: number; k: number }> = [];
    for (const [cx, cz, ddx, ddz, o1x, o1z, t1x, t1z, o2x, o2z, t2x, t2z, H, , store] of meta.corners) {
      if (H < 6.5 || store || !openOut(cx, cz, ddx, ddz, 0.4, 2.2) || nameGameDoorNear(cx, cz, 2) || inStart(cx, cz)) continue;
      let sx = cx + ddx * 1.9;
      let sz = cz + ddz * 1.9;
      if (!isClear(sx, sz, 0.3)) continue;
      // East walkthrough 2026-09-25: the spot before her is off the drays' rounds (world/traffic.ts). At the
      // corner behind the Rijnkaai (31.4, 71.7) it lay in the dray's lane: the dray stood there, waiting for
      // whoever stopped at her, and the path check found her spot shut. Then a spot before one of her two faces.
      if (inDrayLane(sx, sz)) {
        const alt = [[o1x, o1z, t1x, t1z], [o2x, o2z, t2x, t2z]]
          .flatMap(([ox, oz, tx, tz]) => [1.2, 1.6, 2.0].flatMap((s) => [1.7, 1.3, 1.0].map((d) => [cx + tx * s + ox * d, cz + tz * s + oz * d])))
          .find(([x, z]) => at(x, z) === OPEN && isClear(x, z, 0.3) && !inDrayLane(x, z));
        if (alt) [sx, sz] = alt;
      }
      // the old town first: the lanes round the cathedral and the markets, then the rest
      const kk = rng(hash(cx, cz, 7))();
      const old = Math.hypot(cx + 250, cz - 150) < 130 ? 0 : 0.35;
      cands.push({ x: cx, z: cz, yaw: Math.atan2(ddx, ddz), sx: +sx.toFixed(2), sz: +sz.toFixed(2), k: kk + old });
    }
    cands.sort((a, b) => a.k - b.k);
    for (const c of cands) {
      if (madonnas.length >= MADONNAS_MAX) break;
      if (madonnas.some((m) => Math.hypot(m.x - c.x, m.z - c.z) < MADONNA_GAP)) continue;
      const kind = ["madonna", "madonna_b", "madonna_c"][hash(c.x, c.z, 3) % 3];
      const mb = boxFor(kind, "madonna", c.x, 0, c.z, c.yaw);
      if (mb && clashWith(mb, 0.1)) continue; // a shop board or a bracket sign by the corner
      put(kind, c.x, 0, c.z, c.yaw, 1, "madonna");
      madonnas.push({ x: c.x, z: c.z, yaw: +c.yaw.toFixed(3), sx: c.sx, sz: c.sz });
    }
  }
  for (const [cx, cz, ddx, ddz, o1x, o1z, t1x, t1z, o2x, o2z, t2x, t2z, H, , store] of meta.corners) {
    const r = rng(hash(cx, cz));
    if (!openOut(cx, cz, ddx, ddz, 0.4, 1.4)) continue;
    if (H >= 6.5 && !store) r(); // (the old Madonna draw: kept, so the name plates stay where they were)
    for (const [ox, oz, tx, tz] of [[o1x, o1z, t1x, t1z], [o2x, o2z, t2x, t2z]]) {
      if (r() > 0.75) continue;
      const px = cx + tx * 0.75;
      const pz = cz + tz * 0.75;
      if (!openOut(px, pz, ox, oz, 0.3, 1.0)) continue;
      const i = streetName(px, pz, ox, oz);
      // flat on this wall, just over the ground storey, as near the corner as it goes: its whole
      // length on the wall (a margin from the corner), clear of the Madonna, the other face's plate,
      // shop boards, brackets and the storey's windows; slid along the wall if something is there
      const w = wallAtCorner(cx, cz, ox, oz);
      const name = `plate_${i}`;
      const p = protos.get(name);
      if (!w || !p) continue;
      const hw = (p.box[3] - p.box[0]) / 2;
      const y = PLATE_Y - (p.box[1] + p.box[4]) / 2;
      const yaw = Math.atan2(ox, oz);
      for (let d = SIGN_MARGIN + 0.05; d <= 1.8; d += 0.1) {
        const qx = cx + tx * (d + hw);
        const qz = cz + tz * (d + hw);
        const b = boxFor(name, "name plate", qx, y, qz, yaw);
        if (!b || !fitsOn(w, b)) continue;
        put(name, qx, y, qz, yaw, 1, "name plate");
        break;
      }
    }
  }

  // (the bills on the blind walls: world/posters.ts puts up every bill of the town now, M7 posters 2026-09-26;
  // a back wall on a yard was taken for blind here and got bills over its painted windows)

  // ================================================================ grime: the damp band at the foot of the walls
  for (const w of walls) {
    const r = rng(w.seed * 5 + 1);
    const near = (s: number) => {
      const [x, z] = along(w, s);
      return at(x + w.ox * 0.4, z + w.oz * 0.4) === OPEN;
    };
    const wet = at(w.ax + w.tx * w.L * 0.5 + w.ox * 6, w.az + w.tz * w.L * 0.5 + w.oz * 6) & 2;
    const brick = w.style === 0 || w.style === 3;
    const cell = wet || r() < 0.2 ? "moss_0" : brick && r() < 0.7 ? "salt_0" : r() < 0.5 ? "damp_0" : "damp_1";
    const hb = (w.style === 1 || w.style === 2 ? 1.05 : 0.85) + (r() - 0.5) * 0.35;
    const off = 0.008;
    for (let s = 0; s < w.L - 0.05; s += 2) {
      const e = Math.min(w.L, s + 2);
      if (!near((s + e) / 2)) continue;
      const [ax, az] = along(w, s);
      const [bx, bz] = along(w, e);
      const u1 = (e - s) / 2;
      quad(WALL_DECAL, meta.decal, cell, [[ax + w.ox * off, 0, az + w.oz * off], [bx + w.ox * off, 0, bz + w.oz * off], [bx + w.ox * off, hb, bz + w.oz * off], [ax + w.ox * off, hb, az + w.oz * off]], [[0, 0], [u1, 0], [u1, 1], [0, 1]]);
      counts["damp band m"] = (counts["damp band m"] ?? 0) + (e - s);
    }
  }

  // ================================================================ the ground: straw, dung, stains, puddles
  {
    const drop = (x: number, z: number, what: "straw" | "dung" | "stain" | "puddle") => {
      if (onBridge(x, z) || !isClear(x, z, 0.5)) return;
      for (const [dx, dz] of [[0, 0], [0.7, 0], [-0.7, 0], [0, 0.7], [0, -0.7]]) if (at(x + dx, z + dz) !== OPEN) return;
      const name = what === "straw" ? `straw_${Math.floor(R() * 3)}` : what === "dung" ? `dung_${Math.floor(R() * 2)}` : what === "stain" ? "stain_0" : `puddle_${Math.floor(R() * 3)}`;
      put(name, x, 0.012, z, R() * Math.PI * 2, 1, what);
    };
    const pickWhat = (): "straw" | "dung" | "stain" | "puddle" => {
      const k = R();
      return k < 0.45 ? "straw" : k < 0.75 ? "dung" : "stain";
    };
    // along the quays, a few metres in from the edge, where the carts stand
    for (const [ax, az, bx, bz] of city.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 2) continue;
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      for (let t = R() * 5; t < L; t += 5) {
        if (R() > 0.4) continue;
        const x = ax + ((bx - ax) * t) / L;
        const z = az + ((bz - az) * t) / L;
        const side = at(x + nx * 2, z + nz * 2) === OPEN ? 1 : at(x - nx * 2, z - nz * 2) === OPEN ? -1 : 0;
        if (!side) continue;
        const d = 1.5 + R() * 5;
        drop(x + nx * side * d, z + nz * side * d, pickWhat());
      }
    }
    // on the squares
    for (const p of places) {
      if (p.kind !== "square" && p.kind !== "quay") continue;
      for (let k = 0; k < 22; k++) {
        const a = R() * Math.PI * 2;
        const rr = 3 + R() * 32;
        drop(p.x + Math.cos(a) * rr, p.z + Math.sin(a) * rr, pickWhat());
      }
    }
    // in the streets: in the gutter by the houses, and a puddle now and then
    for (const w of walls) {
      if (w.kind !== 0 || R() > 0.3) continue;
      const s = R() * w.L;
      const [x, z] = along(w, s);
      const d = 1.2 + R() * 2.2;
      drop(x + w.ox * d, z + w.oz * d, pickWhat());
    }
  }

  // ================================================================ merge and show
  const group = new THREE.Group();
  group.name = "streetlife";
  const chunks: THREE.Mesh[] = [];
  let triangles = 0;
  for (const [k, b] of buckets) {
    if (!b.pos.length) continue;
    const slot = Number(k.split(",")[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mats[slot]);
    mesh.name = `streetlife_${k}`;
    // decals draw after the walls and ground they lie on
    mesh.renderOrder = slot === SOLID || slot === GLOW || slot === NUMBER ? 0 : 1;
    triangles += b.pos.length / 9;
    group.add(mesh);
    chunks.push(mesh);
  }
  buckets.clear();
  plateTex.needsUpdate = true;
  // an empty mesh that is always drawn: before each render it hides the chunks beyond the fog
  const sentinel = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  sentinel.frustumCulled = false;
  const cull = (cam: THREE.Camera) => {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 60) + 8;
    const p = cam.position;
    for (const m of chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = s.center.distanceTo(p) - s.radius < far;
    }
  };
  sentinel.onBeforeRender = (_r, _sc, cam) => cull(cam);
  group.add(sentinel);
  scene.add(group);

  const warm = new THREE.Color(1.0, 0.72, 0.38);
  const air = new THREE.Color();
  const flame = new THREE.Color();
  function update(t: number, _dt: number, lit = 1, cam?: THREE.Camera): void {
    if (cam) cull(cam);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) air.copy(fog.color);
    // the Madonnas' lanterns: an oil flame, a slow waver
    const k = Math.max(0, Math.min(1, lit)) * (0.9 + Math.sin(t * 3.1) * 0.05 + Math.sin(t * 7.7 + 1.3) * 0.04);
    glowMat.color.copy(air).multiplyScalar(0.8 * (1 - Math.min(1, k))).add(flame.copy(warm).multiplyScalar(k));
    glowFog.value = 1 + 0.3 * Math.min(1, k);
    // puddles mirror the sky: the fog's colour, a little brighter
    puddleMat.color.copy(air).multiplyScalar(0.9);
  }
  update(0, 0, 0);

  const fronts: StreetLife["fronts"] = walls
    .filter((w) => w.kind === 0 && w.door >= 0)
    .map((w) => ({ ax: w.ax, az: w.az, tx: w.tx, tz: w.tz, ox: w.ox, oz: w.oz, len: w.L, door: w.door * w.L, bays: Math.max(1, Math.round(w.L / 3)), storeys: w.st }));
  /** For things other modules paint on the house walls (quayfurniture.ts notices): as fitsOn, without a host wall's ends. */
  const clearOnWall = (b: WallBox): string | null => {
    const hit = clashWith(b);
    if (hit) return `overlaps ${hit.kind}`;
    if (!b.flat) return null;
    // (a wall that is no house front, a props building: nothing more is known of it here)
    const hosts = frontsNear(b);
    if (!hosts.length) return null;
    for (const v of hosts) {
      let open = openingsOf.get(v);
      if (!open) openingsOf.set(v, (open = facadeOpenings(v.L, v.H, v.door >= 0, v.style, GH, SH)));
      const sv = sAlong(v, b);
      const o = open.find((q) => sv - b.hu < q.s1 && q.s0 < sv + b.hu && b.y0 < q.y1 && q.y0 < b.y1);
      if (o) return `over a ${o.what}`;
    }
    return opts.probe ? signOnWall(b, opts.probe) : null;
  };
  return {
    group, colliders, update, stats: { counts, meshes: chunks.length, triangles }, sites, madonnas, shops: shopFronts, fronts, wallItems, walls: meta.walls, ground_h: GH, storey_h: SH, streetNames: meta.streetNames,
    houseNumbers, clearOnWall, addWallItem: addItem,
  };
}
