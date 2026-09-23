import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";

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
const CHUNK = 64;

/** Material slots, one merged mesh per chunk and slot. */
const SOLID = 0;
const WALL_DECAL = 1;
const GROUND_DECAL = 2;
const PUDDLE = 3;
const GLOW = 4;

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
    const proto: Proto = { parts: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0 };
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
  mats[SOLID] = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: DS }), { affine: 0 });
  // on the walls the decals wobble with the (snapped) houses; on the ground they sit still with it
  mats[WALL_DECAL] = psx(new THREE.MeshLambertMaterial({ ...decalOpts, side: DS }), { affine: 0 });
  mats[GROUND_DECAL] = psx(new THREE.MeshLambertMaterial({ ...decalOpts }), { affine: 0, noSnap: true });
  const puddleMat = new THREE.MeshBasicMaterial({ map: decalMap, color: 0x556068, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  mats[PUDDLE] = psx(puddleMat, { affine: 0, noSnap: true });
  const glowMat = new THREE.MeshBasicMaterial({ map: solidMap, color: 0xffc070, fog: false });
  mats[GLOW] = glowMat;
  mats.forEach((m, i) => (m.name = ["streetlife_solid", "streetlife_walldecal", "streetlife_grounddecal", "streetlife_puddle", "streetlife_glow"][i]));

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

  /** A copy of a model at (x, y, z), turned by yaw (0: its front looks along +z), stretched sx along its x. */
  function put(name: string, x: number, y: number, z: number, yaw: number, sx = 1, kind = name): void {
    const p = protos.get(name);
    if (!p) return;
    M.compose(Pv.set(x, y, z), Q.setFromAxisAngle(up, yaw), S.set(sx, 1, 1));
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

  const colliders: Rect[] = [];
  function collide(name: string, x: number, z: number, yaw: number, pad = 0): void {
    const p = protos.get(name)!;
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
    colliders.push({ minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, top: p.height });
  }

  // ================================================================ pumps, the well, troughs
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
          const x = wx + w.ox * 0.45;
          const z = wz + w.oz * 0.45;
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
              if (openOut(bx, bz, w.ox, w.oz, 0.2, 3) && openOut(bx + w.tx * 1, bz + w.tz * 1, w.ox, w.oz, 0.2, 1.5) && openOut(bx - w.tx * 1, bz - w.tz * 1, w.ox, w.oz, 0.2, 1.5) && isClear(tx, tz, 3) && !inAvoid(tx, tz, 1.3)) {
                ok = true;
                break;
              }
            }
          }
          if (!ok) continue;
          const kind = pname === "Grote Markt" || pname === "Vismarkt" || R() < 0.35 ? "pump_stone" : "pump_iron";
          // the pump's front (spout) looks out of the wall: its model front is local +z
          put(kind, x, 0, z, w.yaw);
          collide(kind, x, z, w.yaw, 0.05);
          taken.push([x, z, 1.2]);
          // (the puddles are ambient.ts's, with real reflections)
          if (withTrough) {
            // the trough's long side (model x) along the wall
            put("trough", tx, 0, tz, w.yaw);
            collide("trough", tx, tz, w.yaw, 0.03);
            taken.push([tx, tz, 1.3]);
            for (let k = 0; k < 3; k++) {
              const d = 1.2 + R() * 1.8;
              const a = (R() - 0.5) * 2.4;
              put(k === 0 ? `straw_${Math.floor(R() * 3)}` : `dung_${Math.floor(R() * 2)}`, tx + w.ox * d + w.tx * a, 0.012, tz + w.oz * d + w.tz * a, R() * 6.28, 1, k === 0 ? "straw" : "dung");
            }
          }
          placed++;
          break;
        }
      }
    }
    // the well on the Handschoenmarkt, standing free
    const hm = city.places["Handschoenmarkt"];
    if (hm) {
      // toward the north corner of the square, as on the old prints, clear of the cathedral's central door
      const wx = hm.x + 22;
      const wz = hm.z + 2;
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
          colliders.push({ minX: x - 0.9, maxX: x + 0.9, minZ: z - 0.9, maxZ: z + 0.9, top: 0.9 });
          taken.push([x, z, 1.5]);
          done = true;
        }
      }
    }
  }

  // ================================================================ house fronts
  const tradeByWhere = (where: string) => meta.trades.map((t) => [t, t.where === where ? 3 : t.where === "any" ? 2 : 0.6] as const);
  const brackets: Array<[number, number]> = [];
  const shopsNear: Array<{ x: number; z: number; key: string }> = [];
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
      const trade = table.find(([, wt]) => (pick -= wt) <= 0)?.[0];
      if (trade) {
        shop = true;
        shopsNear.push({ x: mid[0], z: mid[1], key: trade.key });
        count("shop");
        sites.push({ kind: `shop ${trade.key}`, x: +mid[0].toFixed(1), z: +mid[1].toFixed(1), yaw: +w.yaw.toFixed(2) });
        // the board over the middle of the front
        const [sx, sz] = along(w, w.L / 2);
        put(trade.sign, sx, 0, sz, w.yaw, 1, trade.sign.startsWith("letters_") ? "lettering" : "board");
        // a bracket sign at one end of the front, first-floor height
        const hang = trade.hang ?? (r() < 0.08 ? "tankard" : null);
        if (hang && r() < 0.85) {
          for (const end of r() < 0.5 ? [0.5, w.L - 0.5] : [w.L - 0.5, 0.5]) {
            const [hx, hz] = along(w, end);
            if (brackets.some(([bx, bz]) => Math.hypot(bx - hx, bz - hz) < 2.5)) continue;
            if (!openOut(hx, hz, w.ox, w.oz, 0.3, 1.3)) continue;
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
                put(`awning_${nb}_${colour}`, ax, 0, az, w.yaw, sxScale, "awning");
              }
              k += nb;
            }
          }
        }
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
        const side = r() < 0.5 ? -1 : 1;
        const s = doorS + side * Math.min(0.85, bw * 0.3);
        const [nx, nz] = along(w, s);
        put(`number_${hash(w.seed) % meta.numbers}`, nx, 0, nz, w.yaw, 1, "house number");
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
    if (w.L >= 4 && r() < 0.35) {
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
  for (const [cx, cz, ddx, ddz, o1x, o1z, t1x, t1z, o2x, o2z, t2x, t2z, H, , store] of meta.corners) {
    const r = rng(hash(cx, cz));
    if (!openOut(cx, cz, ddx, ddz, 0.4, 1.4)) continue;
    const gameDoor = nameGameDoorNear(cx, cz, 2);
    if (H >= 6.5 && !store && r() < 0.3 && !gameDoor) put("madonna", cx, 0, cz, Math.atan2(ddx, ddz), 1, "madonna");
    for (const [ox, oz, tx, tz] of [[o1x, o1z, t1x, t1z], [o2x, o2z, t2x, t2z]]) {
      if (r() > 0.75) continue;
      const px = cx + tx * 0.75;
      const pz = cz + tz * 0.75;
      if (!openOut(px, pz, ox, oz, 0.3, 1.0)) continue;
      const i = streetName(px, pz, ox, oz);
      put(`plate_${i}`, px, 0, pz, Math.atan2(ox, oz), 1, "name plate");
    }
  }

  // ================================================================ blind walls: posters
  for (const w of walls) {
    if (w.kind !== 1) continue; // blind walls only: a street front has windows
    const r = rng(w.seed * 3 + 5);
    if (r() > 0.65) continue;
    const n = 1 + Math.floor(r() * Math.min(4, w.L / 1.2));
    let s = 0.6 + r() * Math.max(0, w.L - n * 1.05 - 1.2);
    const first = Math.floor(r() * meta.posters.length); // side by side, never the same bill twice
    for (let i = 0; i < n && s < w.L - 0.6; i++) {
      const [px, pz] = along(w, s);
      if (faceOpen(w, s, 3) && isClear(px, pz, 0.5)) {
        // posters sit a hair further out than the damp band, so the two never fight
        put(meta.posters[(first + i) % meta.posters.length], px + w.ox * 0.012, (r() - 0.3) * 0.25, pz + w.oz * 0.012, w.yaw, 1, "poster");
      }
      s += 0.95 + r() * 0.4;
    }
  }

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
    mesh.renderOrder = slot === SOLID || slot === GLOW ? 0 : 1;
    triangles += b.pos.length / 9;
    group.add(mesh);
    chunks.push(mesh);
  }
  buckets.clear();
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
    // puddles mirror the sky: the fog's colour, a little brighter
    puddleMat.color.copy(air).multiplyScalar(0.9);
  }
  update(0, 0, 0);

  return { group, colliders, update, stats: { counts, meshes: chunks.length, triangles }, sites };
}
