import * as THREE from "three";
import CITY from "../../../../shared/city.json";
import BUILD from "../../../../shared/city_build.json";
import { houseWalls, wallOpenings, type BuildData, type Opening } from "../../../../shared/posterWalls";
import { psxUniforms } from "../../retro/psx";
import { drip, gutterSplash } from "../../audio/aliveSounds";
import { stallThings, thingLocal } from "../../game/stallSpots";
import { FCOMMON, VCOMMON, mulberry, pointMat, type Ctx, type Frame, type Part } from "./common";
import { HOUSES, P, roofOf, type House } from "./roofs";
import type { WallBox } from "../wallprobe";

// M7 alive: the water off the eaves (was air.ts createDrips; Steve 2026-09-26: "i think i saw drops from
// gutters but they were really white ... make it more a 'stream' from one side for badly maintained buildings").
// - Drops: in the rain and for a while after it, a few thin short streaks at a time fall from the street
//   eaves round Jef (fewer off a well-kept house: it has its gutter and downpipe) and splash on the stones.
//   They are water, not paint: the colour of the air a little lighter (the sky they catch), gone in the fog,
//   and at night only near a gas lamp (the lamp light they catch). The splash is a few tiny flecks.
// - Broken gutters: a worn house (its wear, 0 kept well .. 1 black with dirt, as build_city.py wear_of gives it
//   and the city's vertex colours carry it: houseGrime.ts) has, by its own dice, a cracked gutter end, a sagging
//   joint or no downpipe: from ONE point near one end of its eave a thin stream of water falls to the ground,
//   a column of fast streaks with a thin core, wobbling a little in the wind; full in a heavy shower, a trickle
//   of drops for a while after the rain. Where it lands: splashes, a dark wet patch on the ground, and a dark
//   damp streak down the wall under the leak (a stain that stays in dry weather too, darker when wet). About
//   one in four of the poor houses and alley cottages, one in ten of the worn middle ones, none on the fine squares.
//   The same houses every time. A soft splatter at the stream's foot, within 5 m.
// All of it: one draw call for the water (lines) and one for the stains. The dev check (dev/guttercheck.ts,
// __scheldemist.alive.gutters()) tests every stream's top against the eave and its foot against the ground,
// walls, doors and stalls: it must list nothing.

const DROPS = 110;
/** Drop splashes: flecks thrown up where a drop lands. */
const FLECKS = 90;
/** Streams drawn at once (the nearest), and what each is made of. */
const NEAR_STREAMS = 14;
const STREAKS = 9;
const CORE = 8;
const SPLASH = 8;
const SEGS = DROPS + FLECKS + NEAR_STREAMS * (STREAKS * 3 + CORE * 3 + SPLASH);

/** A stretch of eave drops may fall from. */
interface Eave {
  a: [number, number];
  b: [number, number];
  y: number;
  /** Drops a second per metre, by the house's upkeep. */
  k: number;
}

/** A broken gutter's stream. */
export interface Stream {
  house: number;
  /** Where the water leaves the eave (top) and lands (foot: same x, z). */
  x: number;
  z: number;
  top: number;
  ground: number;
  /** The wall under it: out of the house (ox, oz), along it (ux, uz), and how far out the eave's lip is. */
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  over: number;
  /** Where the damp streak starts on the wall (m), and how far the house's wall runs from the stream each way along u. */
  stainTop: number;
  l0: number;
  l1: number;
  wear: number;
  seed: number;
  /** "a cracked gutter end", "a sagging joint", "no downpipe", "a spout without a pipe". */
  what: string;
}

// ------------------------------------------------------------------ the houses' wear

/**
 * Each house's wear, read from the city's own vertex colours (build_city.py puts wear_of in the alpha of every
 * vertex of a house: houseGrime.ts). The walls' vertices go once into a 1 m grid (the last one written wins:
 * one house per cell along a front); a house's wear is the middle value along the middle of its street front.
 */
function wearReader(group: THREE.Object3D): ((i: number) => number | null) | null {
  const meshes: THREE.Mesh[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !(m.material as THREE.MeshLambertMaterial).isMeshLambertMaterial) return;
    const c = m.geometry.getAttribute("color");
    if (c && c.itemSize === 4) meshes.push(m);
  });
  if (meshes.length < 20) return null; // (the city is not in yet)
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const m of meshes) {
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    minX = Math.min(minX, bb.min.x);
    minZ = Math.min(minZ, bb.min.z);
    maxX = Math.max(maxX, bb.max.x);
    maxZ = Math.max(maxZ, bb.max.z);
  }
  const W = Math.ceil(maxX - minX) + 1;
  const D = Math.ceil(maxZ - minZ) + 1;
  const grid = new Float32Array(W * D).fill(-1);
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    const col = m.geometry.getAttribute("color");
    const ident = m.matrixWorld.equals(IDENT);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (ident) {
        if (y < 0.4 || y > 30) continue;
        v.set(pos.getX(i), y, pos.getZ(i));
      } else v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      grid[Math.floor(v.z - minZ) * W + Math.floor(v.x - minX)] = col.getW(i);
    }
  }
  const cache = new Map<number, number | null>();
  return (i: number) => {
    if (cache.has(i)) return cache.get(i)!;
    const h = HOUSES[i];
    let out: number | null = null;
    if (h && h.rect && !h.gone) {
      const vals: number[] = [];
      for (const [t, on] of [[h.t[0] + 0.05, h.street[0]], [h.t[1] - 0.05, h.street[2]]] as Array<[number, number]>) {
        if (!on) continue;
        const W0 = h.s[1] - h.s[0];
        for (let s = h.s[0] + W0 * 0.3; s <= h.s[1] - W0 * 0.3; s += 0.5) {
          const [x, z] = P(h, s, t);
          const g = grid[Math.floor(z - minZ) * W + Math.floor(x - minX)];
          if (g >= 0) vals.push(g);
        }
        if (vals.length) break;
      }
      if (vals.length) out = vals.sort((a, b) => a - b)[vals.length >> 1];
    }
    cache.set(i, out);
    return out;
  };
}
const IDENT = new THREE.Matrix4();

// ------------------------------------------------------------------ where the broken gutters are

/** Houses' footprints and the landmarks' in an 8 m grid: is a point inside a building? */
const FP_CELL = 8;
let fpGrid: Map<string, number[][][]> | null = null;
function insideBuilding(x: number, z: number): boolean {
  if (!fpGrid) {
    fpGrid = new Map();
    const b = BUILD as unknown as { houses: Array<{ fp: number[][]; gone?: boolean }>; landmarks: Record<string, { fp: number[][] }> };
    const polys = [...b.houses.filter((h) => !h.gone).map((h) => h.fp), ...Object.values(b.landmarks ?? {}).map((l) => l.fp)];
    for (const p of polys) {
      const xs = p.map((q) => q[0]);
      const zs = p.map((q) => q[1]);
      for (let i = Math.floor(Math.min(...xs) / FP_CELL); i <= Math.floor(Math.max(...xs) / FP_CELL); i++)
        for (let j = Math.floor(Math.min(...zs) / FP_CELL); j <= Math.floor(Math.max(...zs) / FP_CELL); j++) {
          const k = `${i},${j}`;
          let l = fpGrid.get(k);
          if (!l) fpGrid.set(k, (l = []));
          l.push(p);
        }
    }
  }
  for (const p of fpGrid.get(`${Math.floor(x / FP_CELL)},${Math.floor(z / FP_CELL)}`) ?? []) {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, zi] = p[i];
      const [xj, zj] = p[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-12) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** The game's doors (city.json): a stream never lands in one. */
const DOORS = Object.values((CITY as unknown as { doors: Record<string, { x: number; z: number; width: number }> }).doors).filter((d) => d.width < 12);

/** The walls' openings by house (shared/posterWalls.ts: build_city.py's doors, windows and passages), wall 0 the front, 2 the back. */
let openingsBy: Map<number, Map<number, Opening[]>> | null = null;
function openingsOf(house: number, wall: 0 | 2): Opening[] {
  if (!openingsBy) {
    openingsBy = new Map();
    for (const w of houseWalls(BUILD as unknown as BuildData)) {
      const h = HOUSES[w.house];
      if (!h?.rect) continue;
      // (a rect house's walls: 0 from P(s0, t0) to P(s1, t0); 2 from P(s1, t1) to P(s0, t1))
      const [ax, az] = P(h, h.s[0], h.t[0]);
      const [bx, bz] = P(h, h.s[1], h.t[1]);
      const k = Math.hypot(w.ax - ax, w.az - az) < 0.05 ? 0 : Math.hypot(w.ax - bx, w.az - bz) < 0.05 ? 2 : -1;
      if (k < 0) continue;
      let m = openingsBy.get(w.house);
      if (!m) openingsBy.set(w.house, (m = new Map()));
      m.set(k, wallOpenings(w));
    }
  }
  return openingsBy.get(house)?.get(wall) ?? [];
}

/** The stalls, shop tables and goods set out (game/stallSpots.ts): their low boxes on the ground. */
function stallBoxes(): Array<{ x: number; z: number; ux: number; uz: number; hu: number; hv: number; cu: number; cv: number }> {
  const out = [];
  for (const t of stallThings) {
    const L = thingLocal(t);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i + 2 < L.length; i += 3) {
      u0 = Math.min(u0, L[i]);
      u1 = Math.max(u1, L[i]);
      v0 = Math.min(v0, L[i + 2]);
      v1 = Math.max(v1, L[i + 2]);
    }
    if (!Number.isFinite(u0)) continue;
    out.push({ x: t.x, z: t.z, ux: Math.cos(t.yaw), uz: -Math.sin(t.yaw), hu: (u1 - u0) / 2, hv: (v1 - v0) / 2, cu: (u0 + u1) / 2, cv: (v0 + v1) / 2 });
  }
  return out;
}

/** The eave of a house on one side (0 the front, 2 the back): its lip's t, its height, and how far out it stands. */
function eaveOf(h: House, H: number, side: 0 | 2): { t: number; y: number; over: number; gutter: boolean } {
  const sgn = side === 0 ? -1 : 1;
  const tw = side === 0 ? h.t[0] : h.t[1];
  // (a gable's corner: the valley gutter's spout sticks out a little past the bands and sills of the front)
  if (h.roof === "front") return { t: tw + sgn * 0.18, y: H - 0.1, over: 0.18, gutter: false };
  if (h.roof === "flat") return { t: tw + sgn * 0.15, y: H - 0.05, over: 0.15, gutter: false };
  const cottage = !!h.alley;
  const over = cottage ? 0.25 : 0.4;
  const drop = over * Math.tan(((cottage ? 45 : h.pitch) * Math.PI) / 180);
  // (a house's gutter hangs on the roof's edge, 0.12 m deep: build_city.py; a cottage has none, the water leaves the tiles)
  return cottage ? { t: tw + sgn * over, y: H - drop - 0.04, over, gutter: false } : { t: tw + sgn * (over + 0.03), y: H - drop - 0.11, over: over + 0.03, gutter: true };
}

/**
 * The town's broken gutters: by each house's wear and its own dice. `wearOf` from the city meshes; the
 * stalls' boxes, the doors and the walls' openings keep a stream out of a doorway, off a stall and off a window.
 */
export function planStreams(
  wearOf: (i: number) => number | null,
  groundAt: (x: number, z: number) => number,
  flags: (x: number, z: number) => number | undefined,
  wallItems: readonly WallBox[] = [],
): Stream[] {
  const stalls = stallBoxes();
  // street life's signs, boards and awnings on the walls: the water does not fall through one
  const onWallItem = (x: number, z: number, y0: number, y1: number) =>
    wallItems.some((w) => {
      if (w.y1 < y0 || w.y0 > y1) return false;
      const dx = x - w.cx, dz = z - w.cz;
      return Math.abs(dx * w.ux + dz * w.uz) < w.hu + 0.15 && Math.abs(dx * w.nx + dz * w.nz) < w.hn + 0.15;
    });
  const onStall = (x: number, z: number) =>
    stalls.some((b) => {
      const dx = x - b.x, dz = z - b.z;
      if (Math.abs(dx) > 8 || Math.abs(dz) > 8) return false;
      const u = dx * b.ux + dz * b.uz - b.cu;
      const v = dx * -b.uz + dz * b.ux - b.cv;
      return Math.abs(u) < b.hu + 0.35 && Math.abs(v) < b.hv + 0.35;
    });
  const out: Stream[] = [];
  for (let i = 0; i < HOUSES.length; i++) {
    const h = HOUSES[i];
    const r = roofOf(i);
    if (!r || !h.rect) continue;
    const wear = wearOf(i);
    if (wear === null) continue;
    const rng = mulberry((h.seed ^ 0x6a09e667) >>> 0);
    // (the poor lanes and the alley cottages about one in four; the worn middle streets one in ten; the quays'
    // storehouses, long roofs worked hard, one in five once worn; the kept houses of the squares never)
    const p = wear >= 0.72 ? 0.28 : wear >= 0.55 ? ((h as House & { store?: string }).store ? 0.2 : 0.1) : 0;
    if (rng() >= p) continue;
    const sides: Array<0 | 2> = [];
    if (h.street[0]) sides.push(0);
    if (h.street[2] && h.roof !== "front") sides.push(2);
    if (!sides.length) continue;
    if (rng() < 0.5) sides.reverse();
    const firstEnd = rng() < 0.5 ? 0 : 1;
    const what = h.roof === "front" ? "a spout without a pipe" : ["a cracked gutter end", "a sagging joint", "no downpipe", "a rusted-through gutter"][Math.floor(rng() * 4)];
    let done = false;
    for (const side of sides) {
      if (done) break;
      const e = eaveOf(h, r.H, side);
      const ops = openingsOf(i, side);
      const W = h.s[1] - h.s[0];
      for (const end of [firstEnd, 1 - firstEnd]) {
        if (done) break;
        for (const off of [0.24, 0.3, 0.38, 0.5]) {
          if (off > W / 3) break;
          const s = end === 0 ? h.s[0] + off : h.s[1] - off;
          const along = side === 0 ? s - h.s[0] : h.s[1] - s; // (along the wall as posterWalls runs it)
          // the damp streak down the wall clear of the windows, the door and a passage; the foot clear of a door
          if (ops.some((o) => o.s1 > along - 0.2 && o.s0 < along + 0.2)) continue;
          if (ops.some((o) => (o.what === "door" || o.what === "passage") && o.s1 > along - 0.7 && o.s0 < along + 0.7)) continue;
          // (the free wall each way along it, to the next opening: the damp streak stays on the plain wall)
          let gapBack = 9, gapOn = 9;
          for (const o of ops) {
            if (o.s1 <= along) gapBack = Math.min(gapBack, along - o.s1);
            if (o.s0 >= along) gapOn = Math.min(gapOn, o.s0 - along);
          }
          const [x, z] = P(h, s, e.t);
          if (DOORS.some((d) => Math.hypot(d.x - x, d.z - z) < d.width / 2 + 0.8)) continue;
          if (insideBuilding(x, z)) continue;
          const ox = side === 0 ? -h.n[0] : h.n[0];
          const oz = side === 0 ? -h.n[1] : h.n[1];
          // open ground under it and just beyond (a walk map cell by a wall may still read "wall")
          const f = flags(x + ox * 0.35, z + oz * 0.35);
          if (f !== undefined && f !== 0) continue;
          if (onStall(x, z)) continue;
          const ground = groundAt(x, z);
          if (!Number.isFinite(ground) || e.y - ground < 2) continue;
          if (onWallItem(x, z, ground, e.y)) continue;
          out.push({
            house: i, x, z, top: e.y, ground, ox, oz, ux: h.u[0], uz: h.u[1], over: e.over,
            stainTop: e.gutter ? r.H - 0.45 : e.y - 0.08, l0: Math.min(s - h.s[0], side === 0 ? gapBack : gapOn), l1: Math.min(h.s[1] - s, side === 0 ? gapOn : gapBack), wear, seed: rng(), what,
          });
          done = true;
          break;
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ drawing

const LINE_V = /* glsl */ `
  ${VCOMMON}
  #define EAVE_LAMPS ${psxUniforms.uLamps.value.length}
  uniform vec4 uLamps[EAVE_LAMPS];
  uniform vec3 uLampColor;
  uniform vec3 fogColor;
  attribute float aK;
  varying vec3 vCol;
  varying float vA;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mv.z;
    // (not snapped to the PS1 grid: a thread of water would jump from column to column, as the rain's streaks do not)
    gl_Position = projectionMatrix * mv;
    // water catches the light round it: by day the grey sky (a little lighter than the air), by a gas lamp its glow;
    // in the dark, far from a lamp, nothing
    vec3 col = fogColor * 1.22 + 0.008;
    for (int i = 0; i < EAVE_LAMPS; i++) {
      vec3 d = position - uLamps[i].xyz;
      col += uLampColor * uLamps[i].w * 1.2 / (1.0 + dot(d, d) * 0.35);
    }
    // (a negative weight: the water's shadow side, darker than what is behind it: a thread shows on a light
    // plaster wall as on dark brick)
    // (the whole part of |aK| brightens: a stream's glassy thread catches more of the sky than a lone drop)
    float k = abs(aK);
    float lift = floor(k);
    vCol = aK < 0.0 ? col * 0.25 : col * (1.0 + 0.4 * lift);
    // near only: far off it is the weather's own grey
    vA = fract(k) * smoothstep(0.4, 1.0, vFogDepth) * (1.0 - smoothstep(7.0, 18.0, vFogDepth));
    if (vA < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;

const LINE_F = /* glsl */ `
  ${FCOMMON}
  varying vec3 vCol;
  varying float vA;
  void main() {
    float f = fogK();
    gl_FragColor = vec4(mix(vCol, fogColor, f), vA * (1.0 - f));
  }`;

const STAIN_V = /* glsl */ `
  ${VCOMMON}
  attribute vec2 aUv;
  attribute float aKind;
  attribute float aSeed;
  varying vec2 vUv;
  varying float vKind;
  varying float vSeed;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mv.z;
    gl_Position = psxSnap(projectionMatrix * mv);
    vUv = aUv;
    vKind = aKind;
    vSeed = aSeed;
  }`;

const STAIN_F = /* glsl */ `
  ${FCOMMON}
  uniform float uWetK;
  varying vec2 vUv;
  varying float vKind;
  varying float vSeed;
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  void main() {
    float a;
    vec3 col;
    if (vKind < 0.5) {
      // the damp streak down the wall: a wavering band, darkest under the leak and at the foot (splash-back, green)
      float y = vUv.y;
      float x = vUv.x - 0.5;
      float w = 0.2 + 0.14 * vnoise(vec2(vSeed * 17.0, y * 7.0)) + 0.18 * smoothstep(0.25, 0.0, y) + 0.08 * smoothstep(0.85, 1.0, y);
      float band = smoothstep(w, w * 0.35, abs(x + 0.06 * (vnoise(vec2(y * 3.0, vSeed * 9.0)) - 0.5)));
      float runs = 0.75 + 0.25 * vnoise(vec2(x * 22.0 + vSeed * 5.0, y * 1.5));
      a = band * runs * (0.75 + 0.2 * smoothstep(0.75, 1.0, y) + 0.3 * smoothstep(0.2, 0.0, y));
      a = min(1.0, a * (0.65 + 0.45 * uWetK));
      col = mix(vec3(0.36, 0.37, 0.34), vec3(0.33, 0.42, 0.26), smoothstep(0.3, 0.0, y));
    } else {
      // the wet patch on the ground: ragged, darkest in the middle
      vec2 c = (vUv - 0.5) * 2.0;
      float r = length(c) + 0.35 * (vnoise(c * 2.5 + vSeed * 11.0) - 0.5);
      a = smoothstep(1.0, 0.3, r) * (0.2 + 0.7 * uWetK);
      col = vec3(0.4, 0.41, 0.43);
    }
    float f = fogK();
    a *= 1.0 - f;
    if (a < 0.004) discard;
    // (drawn as a multiply over what is there: it only ever darkens, as damp does; never a lighter smear)
    gl_FragColor = vec4(mix(vec3(1.0), col, a), 1.0);
  }`;

export function createDrips(ctx: Ctx): Part & { streams(): Stream[]; nearStreams(): Stream[] } {
  // --- the water: every drop, streak, core and fleck a line segment, two ends each, one draw call
  const pos = new Float32Array(SEGS * 6).fill(-999);
  const kk = new Float32Array(SEGS * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aK", new THREE.BufferAttribute(kk, 1));
  const mat = pointMat({ vertexShader: LINE_V, fragmentShader: LINE_F, uniforms: { uLamps: psxUniforms.uLamps, uLampColor: psxUniforms.uLampColor } });
  const lines = new THREE.LineSegments(g, mat);
  lines.frustumCulled = false;
  lines.name = "alive_drips";
  lines.renderOrder = 3;
  ctx.scene.add(lines);

  // --- the stains: a damp streak on the wall and a wet patch on the ground at every stream (the whole town, built once)
  const wetK = { value: 0 };
  const smat = pointMat({ vertexShader: STAIN_V, fragmentShader: STAIN_F, uniforms: { uWetK: wetK } });
  smat.polygonOffset = true;
  smat.polygonOffsetFactor = -2;
  smat.polygonOffsetUnits = -4;
  smat.side = THREE.DoubleSide;
  smat.blending = THREE.CustomBlending;
  smat.blendEquation = THREE.AddEquation;
  smat.blendSrc = THREE.DstColorFactor;
  smat.blendDst = THREE.ZeroFactor;
  const stains = new THREE.Mesh(new THREE.BufferGeometry(), smat);
  stains.frustumCulled = false;
  stains.name = "alive_gutter_stains";
  stains.visible = false;
  ctx.scene.add(stains);

  interface Drop { x: number; y: number; z: number; v: number; ground: number; on: boolean }
  const drops: Drop[] = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, z: 0, v: 0, ground: 0, on: false }));
  interface Fleck { x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; ground: number }
  const flecks: Fleck[] = Array.from({ length: FLECKS }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: -1, ground: 0 }));
  let eaves: Eave[] = [];
  let total = 0;
  const picked = new THREE.Vector3(1e9, 0, 0);
  let on = true;
  let flow = 0;
  let sflow = 0;
  let plink = 0;
  let splat = 0;
  let wetSince = 1e9;
  let wear: ((i: number) => number | null) | null = null;
  let streams: Stream[] = [];
  let near: Stream[] = [];
  let planned: number | null = null;
  let planWait = 0;
  const w2 = new THREE.Vector2();
  const right = new THREE.Vector3();
  const WIDE = [-0.01, 0.01];
  const WIDE3 = [-0.018, 0, 0.018];
  /** Which thread is the lit side (1) and which the shadow side (-1, drawn darker). */
  const TONE = (w: number) => (w > 0.001 ? -0.8 : 1);
  /** A stream's weight: `k` (0..0.95) its alpha, lit threads one step brighter (LINE_V's whole part), shadow ones negative. */
  const SK = (k: number, tone: number) => (tone > 0 ? 1 + Math.min(0.95, k) : -Math.min(0.95, k * -tone));
  const ONE = [0];

  /** What the plan depends on that comes in late: the stalls, street life's signs and awnings. */
  const planKey = () => stallThings.length + 1 + (ctx.world.streetLife()?.wallItems.length ?? -1) * 10000;

  function plan(): void {
    if (!wear) wear = wearReader(ctx.world.city.group);
    if (!wear) return;
    const sl = ctx.world.streetLife();
    streams = planStreams(wear, (x, z) => ctx.world.baseAt(x, z), ctx.flags, sl?.wallItems ?? []);
    planned = planKey();
    buildStains();
    picked.set(1e9, 0, 0);
  }

  function buildStains(): void {
    const P3: number[] = [];
    const UV: number[] = [];
    const K: number[] = [];
    const S: number[] = [];
    const quad = (c: number[][], kind: number, seed: number, u0 = 0, u1 = 1) => {
      const uv = [[u0, 0], [u1, 0], [u1, 1], [u0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        P3.push(...c[k]);
        UV.push(...uv[k]);
        K.push(kind);
        S.push(seed);
      }
    };
    for (const s of streams) {
      // the wall under the leak (its face: the eave's lip minus its overhang), 3 cm out of it
      const wx = s.x - s.ox * (s.over - 0.03);
      const wz = s.z - s.oz * (s.over - 0.03);
      // (never past the house's own corner: the next front may stand back, and a stain in the air shows)
      const hw = 0.4;
      const a0 = Math.min(hw, s.l0 - 0.02), a1 = Math.min(hw, s.l1 - 0.02);
      const y0 = s.ground - 0.02;
      quad([[wx - s.ux * a0, y0, wz - s.uz * a0], [wx + s.ux * a1, y0, wz + s.uz * a1], [wx + s.ux * a1, s.stainTop, wz + s.uz * a1], [wx - s.ux * a0, s.stainTop, wz - s.uz * a0]], 0, s.seed, 0.5 - a0 / (2 * hw), 0.5 + a1 / (2 * hw));
      // the wet patch round the foot, longer along the wall, reaching back to it
      const cx = s.x - s.ox * 0.1;
      const cz = s.z - s.oz * 0.1;
      const hu = 0.6, hv = 0.5;
      const y = s.ground + 0.012;
      quad([
        [cx - s.ux * hu - s.ox * hv, y, cz - s.uz * hu - s.oz * hv],
        [cx + s.ux * hu - s.ox * hv, y, cz + s.uz * hu - s.oz * hv],
        [cx + s.ux * hu + s.ox * hv, y, cz + s.uz * hu + s.oz * hv],
        [cx - s.ux * hu + s.ox * hv, y, cz - s.uz * hu + s.oz * hv],
      ], 1, s.seed);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.Float32BufferAttribute(P3, 3));
    sg.setAttribute("aUv", new THREE.Float32BufferAttribute(UV, 2));
    sg.setAttribute("aKind", new THREE.Float32BufferAttribute(K, 1));
    sg.setAttribute("aSeed", new THREE.Float32BufferAttribute(S, 1));
    stains.geometry.dispose();
    stains.geometry = sg;
    stains.visible = on && streams.length > 0;
  }

  /** The street eaves within 22 m: the front of a "side" roof, the cornice of a flat one, a gable's corner spouts. */
  function findEaves(f: Frame): Eave[] {
    const out: Eave[] = [];
    for (let i = 0; i < HOUSES.length; i++) {
      const h = HOUSES[i];
      if (!h.rect || !h.o || Math.abs(h.o[0] - f.eye.x) > 40 || Math.abs(h.o[1] - f.eye.z) > 40) continue;
      const r = roofOf(i);
      if (!r) continue;
      // a kept house has its gutter and downpipe: only the odd drop; a worn one drips all along
      const w = wear?.(i) ?? 0.5;
      const k = 0.08 + 0.45 * w;
      if (h.roof === "front") {
        // a gable to the street: the side slopes drain to the front corners (gutters, a spout)
        if (!h.street[0]) continue;
        for (const s of [h.s[0] + 0.25, h.s[1] - 0.25]) {
          const a = P(h, s - 0.2, h.t[0] - 0.12);
          const b = P(h, s + 0.2, h.t[0] - 0.12);
          if (Math.hypot(a[0] - f.eye.x, a[1] - f.eye.z) < 24) out.push({ a, b, y: r.H - 0.1, k: k * 2 });
        }
        continue;
      }
      for (const side of [0, 2] as const) {
        if (!h.street[side]) continue;
        const e = eaveOf(h, r.H, side);
        const a = P(h, h.s[0] + 0.2, e.t);
        const b = P(h, h.s[1] - 0.2, e.t);
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        if (Math.hypot(mx - f.eye.x, mz - f.eye.z) > 22 + Math.hypot(a[0] - b[0], a[1] - b[1]) / 2) continue;
        out.push({ a, b, y: e.y, k });
      }
    }
    return out;
  }

  let seg = 0;
  const put = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, ka: number, kb: number) => {
    if (seg >= SEGS) return;
    const j = seg * 6;
    pos[j] = ax; pos[j + 1] = ay; pos[j + 2] = az;
    pos[j + 3] = bx; pos[j + 4] = by; pos[j + 5] = bz;
    kk[seg * 2] = ka;
    kk[seg * 2 + 1] = kb;
    seg++;
  };
  const hash = (a: number, b: number) => {
    const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const fleck = (x: number, y: number, z: number, n: number, speed: number) => {
    for (let i = 0; i < FLECKS && n > 0; i++) {
      const q = flecks[i];
      if (q.age >= 0) continue;
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.6);
      q.x = x; q.y = y + 0.01; q.z = z;
      q.vx = Math.cos(a) * sp * 0.6;
      q.vz = Math.sin(a) * sp * 0.6;
      q.vy = sp * (0.8 + Math.random() * 0.6);
      q.age = 0;
      q.ground = y;
      n--;
    }
  };

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    // the stains and the plan (the city's meshes must be in; again when the stalls change)
    planWait -= dt;
    if (planned !== planKey() && planWait <= 0) {
      planWait = 3;
      plan();
    }
    wetK.value = Math.min(1, f.wet * 1.2);
    // after the rain the eaves still run a while (the roofs drain): follows the wet ground
    if (f.rain > 0.05) wetSince = 0;
    else wetSince += dt;
    const after = f.wet > 0.2 ? Math.max(0, 1 - wetSince / 240) * 0.35 : 0;
    flow = Math.max(f.rain, after);
    // a broken gutter runs on longer, a trickle
    sflow = Math.max(f.rain, f.wet > 0.15 ? Math.max(0, 1 - wetSince / 480) * 0.3 : 0);
    const any = flow > 0.02 || sflow > 0.02 || drops.some((d) => d.on) || flecks.some((q) => q.age >= 0);
    lines.visible = any;
    if (!any) return;
    if (picked.distanceTo(f.eye) > 6) {
      eaves = findEaves(f);
      total = eaves.reduce((s, e) => s + Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1]) * e.k, 0);
      near = streams
        .map((s) => ({ s, d: Math.hypot(s.x - f.eye.x, s.z - f.eye.z) }))
        .filter((o) => o.d < 30)
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAR_STREAMS)
        .map((o) => o.s);
      picked.copy(f.eye);
    }
    seg = 0;
    ctx.wind.at(f.eye.x, f.eye.z, w2);
    const wx = Math.max(-1.5, Math.min(1.5, w2.x)) * 0.02;
    const wz = Math.max(-1.5, Math.min(1.5, w2.y)) * 0.02;

    // --- drops: a few a second per metre of eave, by the rain and the house
    let born = eaves.length ? flow * total * 0.5 * dt : 0;
    for (let i = 0; i < DROPS && born > 0; i++) {
      const d = drops[i];
      if (d.on) continue;
      if (born < 1 && Math.random() > born) break;
      born -= 1;
      let k = Math.random() * total;
      let e = eaves[0];
      for (const q of eaves) {
        const L = Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1]) * q.k;
        if (k <= L) {
          e = q;
          break;
        }
        k -= L;
      }
      const u = Math.random();
      d.x = e.a[0] + (e.b[0] - e.a[0]) * u;
      d.z = e.a[1] + (e.b[1] - e.a[1]) * u;
      if (Math.hypot(d.x - f.eye.x, d.z - f.eye.z) > 16) continue;
      d.y = e.y;
      d.v = 0;
      d.ground = ctx.world.baseAt(d.x, d.z);
      if (!Number.isFinite(d.ground)) d.ground = 0;
      d.on = true;
    }
    for (const d of drops) {
      if (!d.on) continue;
      d.v += 9.8 * dt;
      d.y -= d.v * dt;
      d.x += wx * dt * 10;
      d.z += wz * dt * 10;
      if (d.y <= d.ground) {
        d.on = false;
        fleck(d.x, d.ground, d.z, 2, 0.9);
        if (plink <= 0 && Math.hypot(d.x - f.eye.x, d.z - f.eye.z) < 5) {
          plink = 0.12 + Math.random() * 0.3;
          ctx.sound()?.placed({ x: d.x, y: d.ground + 0.05, z: d.z }, { ref: 0.8, reach: 3, max: 5, rolloff: 1.3, gain: 0.7 }, drip());
        }
        continue;
      }
      // a thin short streak: the fall in about 1/60 s, 6 to 20 cm, fainter at its tail
      const len = Math.min(0.2, Math.max(0.06, d.v * 0.018));
      put(d.x, d.y + len, d.z, d.x, d.y, d.z, 0.04, 0.2);
    }

    // --- the broken gutters' streams: a column of fast streaks, a thin core in a real shower, splashes at the foot
    let nearest: Stream | null = null;
    let nearD = 1e9;
    right.setFromMatrixColumn(f.cam.matrixWorld, 0);
    const rx = right.x, rz = right.z;
    if (sflow > 0.02) {
      const t = f.t;
      for (const s of near) {
        const Hf = Math.max(0.5, s.top - s.ground);
        const tf = Math.sqrt((2 * Hf) / 9.8);
        const sway = Math.sin(t * 2.3 + s.seed * 20) * 0.035 + Math.sin(t * 5.1 + s.seed * 7) * 0.015;
        // the lip: the water leaves it with a little speed, outward
        const at = (d: number): [number, number] => {
          const k = d / Hf;
          const o = 0.02 + sway * k + 0.02 * k;
          return [s.x + s.ox * o + s.ux * sway * 0.6 * k + wx * d, s.z + s.oz * o + s.uz * sway * 0.6 * k + wz * d];
        };
        const strong = Math.min(1, sflow * 1.25);
        const n = Math.max(1, Math.round(STREAKS * strong));
        const dEye = Math.hypot(s.x - f.eye.x, s.z - f.eye.z);
        const wide = strong < 0.3 || dEye > 12 ? ONE : dEye < 6 ? WIDE3 : WIDE;
        for (let j = 0; j < n; j++) {
          const ph = t / tf + j / n + s.seed * 3.7;
          const cyc = Math.floor(ph);
          const p = ph - cyc;
          const tau = p * tf;
          const d = 0.3 * tau + 4.9 * tau * tau;
          if (d > Hf) continue;
          const v = 0.3 + 9.8 * tau;
          const len = Math.min(d, 0.06 + v * (strong > 0.4 ? 0.02 : 0.012));
          const jx = (hash(cyc, j + s.seed) - 0.5) * 0.05 * (0.4 + d / Hf);
          const [x0, z0] = at(d);
          const [x1, z1] = at(d - len);
          const k = (strong > 0.4 ? 0.85 : 0.55) * (0.5 + 0.5 * hash(cyc + 11, j));
          // (two threads a hand's breadth of a finger apart across the view: near, the stream is two pixels wide)
          for (const w of wide) {
            // (the threads a little out of step: water, not a rod)
            const dy = Math.min(d - len, w * (hash(cyc, j * 7 + w * 90) - 0.5) * 12);
            const yb = Math.max(s.ground + 0.01, s.top - d - dy);
            const tone = TONE(w);
            put(x1 + jx * s.ux + rx * w, Math.min(s.top, yb + len), z1 + jx * s.uz + rz * w, x0 + jx * s.ux + rx * w, yb, z0 + jx * s.uz + rz * w, SK(k * 0.3, tone), SK(k, tone));
          }
        }
        // the core: an unbroken thread when it pours
        if (strong > 0.45) {
          const kc = 0.08 * strong;
          for (const w of wide) {
            let [px, pz] = at(0);
            let py = s.top;
            for (let c = 1; c <= CORE; c++) {
              const d = (Hf * c) / CORE;
              const [x, z] = at(d);
              // (the thread is broken here and there: the water gathers and parts as it falls)
              const hk = hash(Math.floor(t * 9 - c), c + w * 50 + s.seed);
              const kk2 = hk < 0.35 ? 0 : kc * (0.4 + hk);
              if (kk2 > 0) put(px + rx * w, py, pz + rz * w, x + rx * w, s.top - d, z + rz * w, SK(kk2, TONE(w)), SK(kk2, TONE(w)));
              px = x; pz = z; py = s.top - d;
            }
          }
        }
        // splashes: flecks thrown up at the foot, each on its own short arc
        const [fx, fz] = at(Hf);
        const m = Math.max(1, Math.round(SPLASH * strong));
        for (let j = 0; j < m; j++) {
          const life = 0.28;
          const ph = t / life + j / m + s.seed * 5.3;
          const cyc = Math.floor(ph);
          const a = (ph - cyc) * life;
          const ang = hash(cyc, j * 3.1 + s.seed) * Math.PI * 2;
          const sp = (0.3 + 0.6 * hash(cyc + 7, j)) * (0.5 + 0.5 * strong);
          const vx = Math.cos(ang) * sp, vz = Math.sin(ang) * sp;
          // (not back into the wall)
          const out = vx * s.ox + vz * s.oz;
          const ux = out < 0 ? vx - 2 * out * s.ox : vx;
          const uz = out < 0 ? vz - 2 * out * s.oz : vz;
          const vy = 0.7 + 1.1 * hash(cyc + 3, j) * strong;
          const y = s.ground + vy * a - 4.9 * a * a;
          if (y < s.ground) continue;
          const x = fx + ux * a, z = fz + uz * a;
          const vyn = vy - 9.8 * a;
          put(x - ux * 0.035, y - vyn * 0.035, z - uz * 0.035, x, y, z, 0.08, 0.4);
        }
        const dd = Math.hypot(s.x - f.eye.x, s.z - f.eye.z);
        if (dd < nearD) {
          nearD = dd;
          nearest = s;
        }
      }
    }
    // the splatter at the nearest stream's foot (water: heard within 5 m)
    splat -= dt;
    if (nearest && nearD < 5 && splat <= 0) {
      const strong = Math.min(1, sflow * 1.25);
      const len = 0.55;
      splat = len - 0.05;
      ctx.sound()?.placed({ x: nearest.x, y: nearest.ground + 0.05, z: nearest.z }, { ref: 0.8, reach: 3, max: 5, rolloff: 1.3, gain: 0.8 }, gutterSplash(strong, len));
    }
    plink -= dt;

    // --- the flecks of the drops' splashes
    for (const q of flecks) {
      if (q.age < 0) continue;
      q.age += dt;
      q.vy -= 9.8 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      if (q.age > 0.3 || q.y < q.ground) {
        q.age = -1;
        continue;
      }
      put(q.x - q.vx * 0.03, q.y - q.vy * 0.03, q.z - q.vz * 0.03, q.x, q.y, q.z, 0.03, 0.14);
    }
    // (only what was put this frame is drawn)
    g.setDrawRange(0, Math.max(seg, 1) * 2);
    g.attributes.position.needsUpdate = true;
    g.attributes.aK.needsUpdate = true;
  }

  return {
    name: "drips",
    update,
    info: () => ({
      flow: +flow.toFixed(2),
      streamFlow: +sflow.toFixed(2),
      eaves: eaves.length,
      metres: +eaves.reduce((s, e) => s + Math.hypot(e.a[0] - e.b[0], e.a[1] - e.b[1]), 0).toFixed(1),
      falling: drops.filter((d) => d.on).length,
      streams: streams.length,
      nearStreams: near.map((s) => ({ house: s.house, at: [+s.x.toFixed(2), +s.z.toFixed(2)], top: +s.top.toFixed(2), wear: +s.wear.toFixed(2), what: s.what })),
      segments: seg,
    }),
    setOn: (v) => {
      on = v;
      lines.visible = v;
      stains.visible = v && streams.length > 0;
    },
    streams: () => {
      if (planned === null) plan();
      return streams;
    },
    nearStreams: () => near,
  };
}
