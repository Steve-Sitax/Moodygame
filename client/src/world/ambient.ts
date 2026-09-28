import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx, psxUniforms, AIR_GLOW_GLSL } from "../retro/psx";
import { dice, share, sharedSeconds } from "../game/share";
import { TARGET_HEIGHT } from "../retro/retroPass";
import { edgeZ, type CityOpenings, type CityWorld } from "./city";
import { addSpill, setSpillClock, type SpillKind } from "./spill";
import { sharedFacadeProbe, type FacadeProbe } from "./facadeProbe";
import INWORLD from "../../../shared/inworld_houses.json";
import YARDS from "../../../shared/city_yard_windows.json";
import { YARD_PANE_OFF, yardPanes } from "./yardWindows";
import { tempest } from "./tempest";
import { neverMirrored } from "./mirror";

/**
 * M7 taverns and homes: the houses whose insides stand in the world light their own windows (the room itself
 * through its cut windows, world/houseInWorld.ts); no painted pane is lit over them. By house index: the
 * ground storey, the upper storeys (index from the first), the gable.
 */
const OWN_LIGHT = new Map<number, { ground: boolean; storeys: number[]; gable: boolean }>(
  (INWORLD as { houses: Array<{ kind: string; cls?: string; house: number }> }).houses.map((e) => [
    e.house,
    { ground: true, storeys: e.cls === "merchant" ? [0] : [], gable: e.cls === "garret" },
  ]),
);


// Atmosphere over the city (docs/05): smoke from the chimneys, gulls over the
// river and pigeons on the squares, rain with puddles and a wet sheen, and lit
// windows at night. Everything that can runs on the GPU from a few shared
// uniforms; the CPU only moves about sixty birds. Nothing here is loaded from
// outside: every shape and sprite is made in code.
//
// Cost (measured on the Rijnkaai, see the report): 1 draw call for smoke, 1 for
// birds, 1 for rain, 1 for puddles, and 2 per window chunk (100 m) within the fog.

export type AmbientWeather = "fog" | "mist" | "clear" | "rain" | "storm";

export interface Ambient {
  /**
   * Once per frame. `hour` 0-24 with fractions (the game clock), `weather` the
   * day's weather. On a "rain" day showers come and go by the hour.
   */
  update(t: number, dt: number, camera: THREE.Camera, hour: number, weather: string): void;
  /** Rain on top of the weather, 0..1 (a job twist, or dev). 0 = only what the weather brings. */
  setRain(amount: number): void;
  /** Dev: counts and the current levels. */
  info(): Record<string, number>;
  /** M7 alive (hook): the chimney tops (empty until the city is in), and how many smoke now (a chimney smokes when act < level). */
  chimneys(): ReadonlyArray<{ x: number; y: number; z: number; act: number }>;
  smokeLevel(): number;
}

// ------------------------------------------------------------------ helpers

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Piecewise linear over the day: [hour, value] rows, 0 to 24. */
function curve(table: ReadonlyArray<readonly [number, number]>, h: number): number {
  let i = 0;
  while (i < table.length - 2 && h >= table[i + 1][0]) i++;
  const [h0, v0] = table[i];
  const [h1, v1] = table[i + 1];
  return v0 + (v1 - v0) * THREE.MathUtils.clamp((h - h0) / (h1 - h0), 0, 1);
}

/** How many chimneys smoke: fires lit in the morning, cooking at noon, the evening fire. */
// (picture round 2026-09-26, package 5: coal smoke over every roof; about half the chimneys smoke at midday, most
// of them when the fires are lit in the morning and the evening; was 0.28-0.62)
const SMOKE_BY_HOUR = [
  [0, 0.26], [5, 0.3], [6.5, 0.86], [9, 0.8], [10.5, 0.5], [12, 0.6], [13.5, 0.46],
  [16, 0.54], [17.5, 0.86], [21, 0.82], [23, 0.42], [24, 0.26],
] as const;
/** Dark outside: 0 by day, 1 at night (lit windows fade with it). */
const NIGHT_BY_HOUR = [
  [0, 1], [6.2, 1], [8.2, 0], [16.2, 0], [18.3, 1], [24, 1],
] as const;
/** Cold days keep more fires going; clear is "clear and cold" (server/src/day.ts). */
const COLD: Record<string, number> = { fog: 0.05, mist: 0, clear: 0.12, rain: 0.08, storm: 0.1 };
/** Wind speed by weather, m/s-ish: fog lies still, rain comes on a wind. */
const WIND: Record<string, number> = { fog: 0.35, mist: 0.6, clear: 0.9, rain: 1.5, storm: 3.2 };

const GROUND_H = 3.8;
const STOREY_H = 3.0;

// ------------------------------------------------------------------ shader bits

const VCOMMON = /* glsl */ `
uniform vec2 uSnapRes;
uniform float uTime;
varying float vFogDepth;
// the PS1 vertex snap of retro/psx.ts, so these sit still on the walls that wobble
vec4 psxSnap(vec4 p) {
  vec2 ndc = p.xy / p.w;
  vec2 s = floor(ndc * uSnapRes + 0.5) / uSnapRes;
  p.xy = mix(ndc, s, smoothstep(1.5, 4.0, p.w)) * p.w;
  return p;
}
`;

const FCOMMON = /* glsl */ `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying float vFogDepth;
float fogK() { return smoothstep(fogNear, fogFar, vFogDepth); }
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

/** Lamp light for points in the air or on the ground (the six game lamps of psx.ts). */
const LAMPS = /* glsl */ `
#define AMB_LAMPS ${psxUniforms.uLamps.value.length}
uniform vec4 uLamps[AMB_LAMPS];
uniform vec3 uLampColor;
`;

/** The render height (settings): point sizes (smoke, rain, birds) are in its pixels. */
export function setAmbientViewHeight(h: number): void {
  U.uViewH.value = h;
}

/** Shared uniforms: one write per frame drives every material here. */
const U = {
  uTime: { value: 0 },
  uHourN: { value: 12 },
  uNight: { value: 0 },
  uSmoke: { value: 0.3 },
  uSmokeCol: { value: new THREE.Color(0.2, 0.2, 0.21) },
  uWind: { value: new THREE.Vector2(0.9, 0.35) },
  uRainAmt: psxUniforms.uRain,
  uWetAmt: psxUniforms.uWet,
  /** The great storm, 0..1 (world/tempest.ts). */
  uTempest: { value: 0 },
  /**
   * How long a frame lasts now (s, eased; 1/60 to 1/24): a rain streak is as long as its drop falls in one frame, so
   * each frame's streak meets the last one's and the eye follows the drop down (Steve 2026-09-28: "rain seems to
   * travel backwards": fixed-length streaks shorter than a frame's fall, many alike, were matched to the wrong drop).
   */
  uExpo: { value: 1 / 50 },
  /** The gust fronts about now (world/alive/wind.ts fronts): each brings a veil of heavier rain across the town. */
  uGusts: { value: new Float32Array(16) },
  uGustA0: { value: new Float32Array(4) },
  uGustDir: { value: new THREE.Vector2(1, 0) },
  /** The room Jef stands in (x0, z0, x1, z1; x1 < x0: none): no rain drawn in it, only out of its windows. */
  uRoom: { value: new THREE.Vector4(1, 1, 0, 0) },
  uCam: { value: new THREE.Vector3() },
  uViewH: { value: TARGET_HEIGHT },
};

function shaderMat(p: {
  vertexShader: string;
  fragmentShader: string;
  transparent?: boolean;
  blending?: THREE.Blending;
  depthWrite?: boolean;
  side?: THREE.Side;
  decal?: boolean;
}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uSnapRes: psxUniforms.uSnapRes,
      uLamps: psxUniforms.uLamps,
      uLampColor: psxUniforms.uLampColor,
      uScatter: psxUniforms.uScatter,
      ...U,
    },
    vertexShader: p.vertexShader,
    fragmentShader: p.fragmentShader,
    fog: true,
    transparent: p.transparent ?? false,
    blending: p.blending ?? THREE.NormalBlending,
    depthWrite: p.depthWrite ?? true,
    side: p.side ?? THREE.FrontSide,
    ...(p.decal ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 } : {}),
  });
}

// ------------------------------------------------------------------ 1. chimney smoke

interface Chimney {
  x: number;
  y: number;
  z: number;
  /** 0..1: this chimney smokes when the smoke level is above it. */
  act: number;
}

/**
 * Chimney tops from the city meshes: build_city.py makes every chimney a stone
 * box with atlas cell (1, 0), and nothing else in the stone material uses that
 * cell. A top face is two triangles; the middle of the long edge is its centre.
 */
function findChimneys(group: THREE.Object3D): Chimney[] {
  const out: Chimney[] = [];
  const seen = new Set<string>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    const cell = g.getAttribute("cell");
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    if (!cell || !pos || !nor) return;
    const map = (m.material as THREE.MeshLambertMaterial).map;
    const w = (map?.image as { width?: number } | undefined)?.width;
    if (w !== 64) return; // the stone texture; facade and roof atlases are larger
    const idx = g.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = idx ? idx.getX(i) : i;
      const ib = idx ? idx.getX(i + 1) : i + 1;
      const ic = idx ? idx.getX(i + 2) : i + 2;
      if (Math.round(cell.getX(ia)) !== 1 || Math.round(cell.getY(ia)) !== 0) continue;
      n.fromBufferAttribute(nor, ia).transformDirection(m.matrixWorld);
      if (n.y < 0.95) continue;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
      const ab = a.distanceTo(b);
      const bc = b.distanceTo(c);
      const ca = c.distanceTo(a);
      const L = Math.max(ab, bc, ca);
      if (L < 0.8 || L > 1.3) continue; // 0.6 x 0.9 or 0.7 x 0.7 m
      const [p, q] = L === ab ? [a, b] : L === bc ? [b, c] : [c, a];
      const x = (p.x + q.x) / 2;
      const z = (p.z + q.z) / 2;
      const key = `${Math.round(x * 5)},${Math.round(z * 5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y: Math.max(p.y, q.y), z, act: 0 });
    }
  });
  const r = mulberry(1873);
  for (const ch of out) ch.act = r();
  return out;
}

function buildSmoke(chimneys: Chimney[]): THREE.Points {
  const PER = 14; // (package 5: a longer, fuller plume; was 10)
  const pos = new Float32Array(chimneys.length * PER * 3);
  const seed = new Float32Array(chimneys.length * PER * 4);
  const r = mulberry(51);
  chimneys.forEach((ch, i) => {
    for (let k = 0; k < PER; k++) {
      const j = i * PER + k;
      pos.set([ch.x, ch.y + 0.1, ch.z], j * 3);
      seed.set([ch.act, (k + r() * 0.6) / PER, r(), r()], j * 4);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 4));
  const mat = shaderMat({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      ${VCOMMON}
      uniform float uSmoke;
      uniform vec2 uWind;
      uniform float uViewH;
      uniform float fogFar;
      ${AIR_GLOW_GLSL}
      attribute vec4 aSeed;
      varying float vAlpha;
      varying float vSeed;
      varying vec3 vGlow;
      void main() {
        float act = smoothstep(aSeed.x - 0.03, aSeed.x + 0.03, uSmoke);
        // Steve: the smoke read as standing still; a quicker rise and more curl, so it is seen to move
        // (package 5: a longer plume that rises over the ridges, is bent over by the wind and spreads: 9-13 s, 6-8 m up, 4 m wide at the end)
        float life = 9.0 + aSeed.z * 4.0;
        float age = fract(uTime / life + aSeed.y);
        vec3 p = position;
        // buoyant at first, then it levels off and goes with the wind (a stronger wind bends it over sooner)
        float lift = 1.0 / (1.0 + 0.45 * length(uWind));
        p.y += (5.2 * (1.0 - exp(-age * 2.8)) + age * 2.6) * lift;
        float along = age * life;
        p.xz += uWind * along * (0.45 + age * 1.1);
        p.xz += vec2(sin(uTime * 1.1 + aSeed.w * 6.28 + age * 6.0), cos(uTime * 0.9 + aSeed.z * 6.28 + age * 5.0)) * 0.6 * age;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        float size = 0.6 + age * 3.6;
        gl_PointSize = min(size * projectionMatrix[1][1] * uViewH * 0.5 / max(gl_Position.w, 0.1), 128.0);
        // (thicker when many fires burn: the morning and the evening)
        vAlpha = act * smoothstep(0.0, 0.08, age) * (1.0 - age) * (0.75 + 0.5 * uSmoke);
        vSeed = aSeed.w;
        if (vAlpha < 0.005 || vFogDepth > fogFar * 1.15) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        // the gas lamps' glow in the air in front of the puff, as in front of the sky behind it (retro/psx.ts)
        else vGlow = airGlow((modelMatrix * vec4(p, 1.0)).xyz, fogFar);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      uniform vec3 uSmokeCol;
      varying float vAlpha;
      varying float vSeed;
      varying vec3 vGlow;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        // a blocky puff: 5 x 5 cells of uneven density, like a crushed 16 px sprite
        float mottle = 0.55 + 0.45 * hash12(floor(gl_PointCoord * 5.0) + vSeed * 91.0);
        float f = fogK();
        float a = min(vAlpha * (1.0 - d * d) * mottle * 1.5, 0.7) * (1.0 - f * 0.9);
        if (a < 0.008) discard;
        gl_FragColor = vec4(mix(uSmokeCol, fogColor, f) + vGlow * (0.35 + 0.65 * f), a);
        #include <colorspace_fragment>
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  pts.name = "ambient_smoke";
  // M7 rendering (world/cull.ts): past 1.15 fog-fars the puffs are dropped, before that they fade to the fog colour
  mat.userData.fogReach = 1.15;
  return pts;
}

// ------------------------------------------------------------------ 2. birds

/** A bird of about 1.3 m span (a gull): forward +z, wings along x. Pigeons are the same, smaller. */
function birdGeometry(): THREE.BufferGeometry {
  const P: number[] = [];
  const C: number[] = [];
  const tri = (a: number[], b: number[], c: number[], col: number[]) => {
    P.push(...a, ...b, ...c);
    C.push(...col, ...col, ...col);
  };
  const white = [0.92, 0.92, 0.9];
  const grey = [0.62, 0.64, 0.66];
  const dark = [0.12, 0.12, 0.13];
  const beak = [0.85, 0.65, 0.2];
  // body: a stretched diamond
  const nose = [0, 0.01, 0.3];
  const tail = [0, 0.0, -0.24];
  const top = [0, 0.065, 0.02];
  const bot = [0, -0.07, 0.03];
  const l = [-0.075, 0, 0.03];
  const r = [0.075, 0, 0.03];
  tri(nose, r, top, white);
  tri(nose, top, l, white);
  tri(nose, bot, r, white);
  tri(nose, l, bot, white);
  tri(tail, top, r, grey);
  tri(tail, l, top, grey);
  tri(tail, r, bot, white);
  tri(tail, bot, l, white);
  tri([0, 0.012, 0.36], [-0.015, 0.005, 0.29], [0.015, 0.005, 0.29], beak);
  // tail fan
  tri([-0.07, 0.01, -0.34], [0.07, 0.01, -0.34], [0, 0.01, -0.18], grey);
  for (const s of [-1, 1]) {
    const rf = [s * 0.06, 0.012, 0.09];
    const rb = [s * 0.06, 0.012, -0.08];
    const mf = [s * 0.36, 0.02, 0.07];
    const mb = [s * 0.36, 0.02, -0.11];
    const tip = [s * 0.66, 0.0, -0.13];
    tri(rf, mf, mb, grey);
    tri(rf, mb, rb, grey);
    tri(mf, tip, mb, dark);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

interface Bird {
  kind: 0 | 1; // gull, pigeon
  mode: "wheel" | "perch";
  seed: number;
  // wheeling: round a centre over the water
  anchor: number; // index in anchors, -1: high over the town, near the player
  cx: number;
  cz: number;
  R: number;
  y0: number;
  w: number;
  th: number;
  // perched (bollard, chimney, the ground): flies off when you come close
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  air: number; // < 0 sitting, else seconds in the air
  D: number;
  phi: number;
  loopR: number;
  loopH: number;
  delay: number;
  // pigeons on the ground
  flock: number;
  yaw: number;
  peck: number;
  timer: number;
  walk: THREE.Vector3 | null;
  // output
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  shown: boolean;
}

interface Flock {
  x: number;
  z: number;
  r: number;
  birds: Bird[];
  /** Seconds until the flock may settle again. */
  up: number;
}

// ------------------------------------------------------------------ 4. windows

interface House {
  rect: boolean;
  store?: string;
  fp: number[][];
  o: [number, number];
  u: [number, number];
  n: [number, number];
  s: [number, number];
  t: [number, number];
  h: number;
  roof: string;
  gable: string;
  pitch: number;
  style: string;
  seed: number;
  street: number[];
  /** Pulled down (city_build.json, the churches freed): not built. */
  gone?: boolean;
}

/** on, off, morning on, morning off; hours from noon (so 25 = 1:00 at night). 99 = never. */
type Lit = [number, number, number, number];

function litFor(r: () => number, kind: "ground" | "upper" | "attic", store: boolean): Lit {
  const l: Lit = [99, 99, 99, 99];
  const pEve = store ? 0.05 : kind === "ground" ? 0.45 : kind === "upper" ? 0.38 : 0.28;
  if (r() < pEve) {
    if (kind === "ground") {
      // a shop or a front room: lit as soon as it is dark, shut by 19:30 to 22:00
      l[0] = 16.3 + r() * 1.3;
      l[1] = 19.4 + r() * 2.6;
    } else {
      l[0] = 16.8 + r() * 3.4;
      const b = r();
      l[1] = b < 0.35 ? 21 + r() * 1.5 : b < 0.7 ? 22.5 + r() * 1.5 : b < 0.9 ? 24 + r() * 2.2 : 32;
    }
  }
  const pMorning = store ? 0.03 : kind === "ground" ? 0.12 : 0.22;
  if (r() < pMorning) {
    l[2] = 28.8 + r() * 1.6; // 4:48 to 6:24, the early risers and the bakers
    l[3] = 32;
  }
  return l;
}

interface ChunkBuf {
  win: number[];
  winUv: number[];
  winLit: number[];
  winTone: number[];
}

/** The wall rings of the plan's houses as build_city.py makes them (house_ring). */
function houseRing(h: House): number[][] {
  if (!h.rect) return h.fp;
  const [ox, oz] = h.o, [ux, uz] = h.u, [nx, nz] = h.n, [s0, s1] = h.s, [t0, t1] = h.t;
  return [[s0, t0], [s1, t0], [s1, t1], [s0, t1]].map(([s, t]) => [ox + ux * s + nx * t, oz + uz * s + nz * t]);
}

/**
 * M7 quays pass 2: the street walls build_city.py leaves flat (its overlapped()): another house's wall lies
 * along them, 0.1 m or more of it. Every other street wall has its windows set back in the wall now.
 * By `${house index}:${wall index}`.
 */
function flatWalls(houses: House[]): Set<string> {
  const rings = houses.map(houseRing);
  const grid = new Map<string, Array<[number, number, number, number, number]>>();
  const cell = (x: number, z: number) => `${Math.floor(x / 2)},${Math.floor(z / 2)}`;
  rings.forEach((r, hi) => {
    if (houses[hi].gone) return; // (pulled down: not built, build_city.py)
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
      const L = Math.hypot(bx - ax, bz - az);
      const cs = new Set<string>();
      for (const q of [0, 0.25, 0.5, 0.75, 1]) cs.add(cell(ax + (bx - ax) * q, az + (bz - az) * q));
      for (let k = 0; L && k <= L / 1.5; k++) cs.add(cell(ax + ((bx - ax) * k * 1.5) / L, az + ((bz - az) * k * 1.5) / L));
      for (const c of cs) {
        let l = grid.get(c);
        if (!l) grid.set(c, (l = []));
        l.push([ax, az, bx, bz, hi]);
      }
    }
  });
  const out = new Set<string>();
  rings.forEach((r, hi) => {
    if (houses[hi].gone) return;
    for (let i = 0; i < r.length; i++) {
      if (!houses[hi].street[i]) continue;
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      let hit = false;
      for (let k = 0; !hit && k <= L / 1.5 + 1; k++) {
        const q = Math.min(1, (k * 1.5) / L);
        const cx = Math.floor((ax + (bx - ax) * q) / 2), cz = Math.floor((az + (bz - az) * q) / 2);
        for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
          for (const [px, pz, rx, rz, oh] of grid.get(`${cx + dx},${cz + dz}`) ?? []) {
            if (oh === hi) continue;
            // (the other wall along this one where their lengths overlap, within 5 cm of its line)
            const sp = (px - ax) * ux + (pz - az) * uz, sr = (rx - ax) * ux + (rz - az) * uz;
            const dp = (px - ax) * uz - (pz - az) * ux, dr = (rx - ax) * uz - (rz - az) * ux;
            const lo = Math.max(Math.min(sp, sr), 0), hi2 = Math.min(Math.max(sp, sr), L);
            if (hi2 - lo <= 0.1 || Math.abs(sr - sp) < 1e-9) continue;
            if ([lo, hi2].every((s) => Math.abs(dp + ((dr - dp) * (s - sp)) / (sr - sp)) <= 0.05)) hit = true;
          }
        }
      }
      if (hit) out.add(`${hi}:${i}`);
    }
  });
  return out;
}

/** M7 quays pass 2: the windows build_city.py cut into the front gables (gable_front), by house index:
 * [s_mid from the front's first corner, y0, y1, width, small]. */
type GableWin = [number, number, number, number, boolean];

/** A lit pane as buildWindows laid it, for its light on the street (world/spill.ts). */
interface Pane {
  x: number;
  z: number;
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  w: number;
  y0: number;
  y1: number;
  l: Lit;
  tone: number;
  kind: number;
  group: string | null;
}

/** And their light on the street: the kind of source (world/spill.ts) and its power against that kind's own. */
const PANE_SPILL: Array<[SpillKind, number]> = [["upper", 1], ["room", 1.2], ["garret", 1], ["lantern", 0.6], ["garret", 1.5]];

/**
 * Every lit pane lights the street (world/spill.ts): the ground storey's one by one, with its bars thrown out;
 * a room upstairs by the span of its windows on that wall; the lanterns by the doors as flames. Its level is the
 * pane's own schedule, so a pane that glows spills and one that spills glows.
 */
function spillPanes(list: Pane[]): number {
  const groups = new Map<string, Pane[]>();
  const one: Pane[][] = [];
  for (const p of list) {
    if (p.group === null) one.push([p]);
    else {
      let g = groups.get(p.group);
      if (!g) groups.set(p.group, (g = []));
      g.push(p);
    }
  }
  let n = 0;
  for (const g of [...one, ...groups.values()]) {
    const p0 = g[0];
    // the span along the wall, from the first pane
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of g) {
      const s = (p.x - p0.x) * p0.ux + (p.z - p0.z) * p0.uz;
      lo = Math.min(lo, s - p.w / 2);
      hi = Math.max(hi, s + p.w / 2);
    }
    const mid = (lo + hi) / 2;
    const [kind, k] = PANE_SPILL[p0.kind] ?? PANE_SPILL[0];
    // oil lamp and candle: the pane's own warm (its tone), in linear light
    const c = new THREE.Color().setRGB(1, 0.36 + 0.16 * p0.tone, 0.08 + 0.08 * p0.tone, THREE.LinearSRGBColorSpace);
    const lantern = p0.kind === 3;
    const s = addSpill({
      kind,
      label: lantern ? "door lantern" : p0.kind === 1 ? "lit window (ground)" : p0.kind === 4 ? "lit cottage window" : p0.kind === 2 ? "lit garret window" : "lit windows upstairs",
      x: p0.x + p0.ux * mid,
      y: (p0.y0 + p0.y1) / 2,
      z: p0.z + p0.uz * mid,
      nx: lantern ? 0 : p0.ox,
      nz: lantern ? 0 : p0.oz,
      hw: (hi - lo) / 2,
      hh: (p0.y1 - p0.y0) / 2,
      color: c,
      bars: p0.kind === 1 ? 23 : p0.kind === 4 ? 22 : 0,
      // (upstairs the room's shape falls far off and faint: only the ground storey throws it)
      ...(p0.kind === 1 || p0.kind === 4 ? {} : { depth: 0 }),
      sched: p0.l,
    });
    s.power *= k * (0.8 + 0.4 * p0.tone);
    n++;
  }
  return n;
}

let panes: Pane[] = [];

/** Panes left out: they lay on plain wall as built (a storehouse's gate bay, a front the plan and the model paint apart). */
let hiddenPanes = 0;

/**
 * Is this pane on plain wall as the house was built (world/facadeProbe.ts: a level ray from before the wall meets
 * the facade atlas's plain wall, not a painted window, at every point tried)? Such a pane was drawn inside the wall,
 * never seen; its light on the street would come from nowhere, so it is left out, glow and light alike.
 */
function onPlainWall(probe: FacadeProbe, x: number, z: number, ox: number, oz: number, ux: number, uz: number, w: number, y0: number, y1: number): boolean {
  let hits = 0;
  for (const [a, f] of [[0, 0.5], [-0.28, 0.3], [0.28, 0.3], [-0.28, 0.75], [0.28, 0.75]]) {
    const px = x + ux * a * w + ox * 0.6;
    const pz = z + uz * a * w + oz * 0.6;
    const h = probe(px, y0 + (y1 - y0) * f, pz, -ox, -oz, 1.2);
    if (!h) continue;
    if (h.alpha > 200) return false;
    hits++;
  }
  return hits > 0;
}

function buildWindows(houses: House[], gables: Record<string, GableWin[]> = {}, lamps: number[][] = [], probe: FacadeProbe | null = null, cottages: CityOpenings["cottages"] | null = null): Map<string, ChunkBuf> {
  const chunks = new Map<string, ChunkBuf>();
  panes = [];
  hiddenPanes = 0;
  let buf: ChunkBuf;
  const quad = (pos: number[], uv: number[], lit: number[], tone: number[], p: number[][], l: Lit, t: number[], uvs: number[][]) => {
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...p[i]);
      uv.push(...uvs[i]);
      lit.push(...l);
      tone.push(...t);
    }
  };
  /**
   * A lit pane: centre on the wall (x, z), outward (ox, oz), along (ux, uz). `kind` (the pane's brightness and its
   * light on the street, world/spill.ts): 1 the ground storey (a shop or a front room), 0 a room upstairs, 2 a
   * garret's candle in the gable, 3 a lantern by a door. `group`: the panes of one room on one wall throw their
   * light together (upstairs); null, each its own (the ground storey's, with their bars).
   */
  const addWindow = (x: number, z: number, ox: number, oz: number, ux: number, uz: number, w: number, y0: number, y1: number, l: Lit, tone: number, kind: number, off = 0.04, group: string | null = null) => {
    if (probe && kind !== 3 && onPlainWall(probe, x, z, ox, oz, ux, uz, w, y0, y1)) {
      hiddenPanes++;
      return;
    }
    const cx = x + ox * off;
    const cz = z + oz * off;
    const hw = w / 2;
    const t = [tone, kind];
    quad(buf.win, buf.winUv, buf.winLit, buf.winTone,
      [[cx - ux * hw, y0, cz - uz * hw], [cx + ux * hw, y0, cz + uz * hw], [cx + ux * hw, y1, cz + uz * hw], [cx - ux * hw, y1, cz - uz * hw]],
      l, t, [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // (its light on the street starts at the wall's face, not at the glass set back in it)
    panes.push({ x: x + ox * 0.02, z: z + oz * 0.02, ox, oz, ux, uz, w, y0, y1, l, tone, kind, group });
  };

  const flat = flatWalls(houses);
  /** Is the wall being lit set back (build_city.py upper_front / shop_run) or left flat? */
  let setIn = true;
  let hi = -1;
  for (const h of houses) {
    hi++;
    // a house pulled down (the churches freed, 2026-09-26: city_build.json "gone") has no windows
    if (h.gone) continue;
    // the alleys' cottages have their own small windows (tools/blender/build_city.py): lit below from their list
    const alley = !!(h as House & { alley?: boolean }).alley;
    const own = OWN_LIGHT.get(hi);
    if (alley && (own || !h.rect || !cottages?.[String(hi)])) continue;
    const poort = (h as House & { poort?: { s: [number, number] } }).poort;
    const r = mulberry(h.seed);
    const store = !!h.store;
    const H = h.h;
    // lighting per storey: a lit room lights all its windows on every street side
    const storeyLit: Lit[] = [];
    const litOf = (k: number, attic: boolean): Lit => {
      if (!storeyLit[k + 1]) storeyLit[k + 1] = litFor(r, k < 0 ? "ground" : attic ? "attic" : "upper", store);
      return storeyLit[k + 1];
    };
    const tone = r();
    let cx = 0;
    let cz = 0;
    for (const [x, z] of h.fp) {
      cx += x;
      cz += z;
    }
    cx /= h.fp.length;
    cz /= h.fp.length;
    const key = `${Math.floor(cx / 100)},${Math.floor(cz / 100)}`;
    let b = chunks.get(key);
    if (!b) {
      b = { win: [], winUv: [], winLit: [], winTone: [] };
      chunks.set(key, b);
    }
    buf = b;

    if (alley) {
      // a cottage of the back alleys: its own small windows as build_city.py cut them (city.glb "city_openings"),
      // lit by the household's hours like any other; a candle or a small oil lamp (kind 4 downstairs, 2 up)
      const [ox, oz] = h.o;
      const [ux, uz] = h.u;
      const [nx, nz] = h.n;
      const [s0, s1] = h.s;
      const [t0, t1] = h.t;
      const P = (s: number, t: number): [number, number] => [ox + ux * s + nx * t, oz + uz * s + nz * t];
      const c = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
      const outs: Array<[number, number]> = [[-nx, -nz], [ux, uz], [nx, nz], [-ux, -uz]];
      for (const [wi, sm, w, y0, y1] of cottages![String(hi)]) {
        const [ax, az] = c[wi];
        const [bx, bz] = c[(wi + 1) % 4];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const wx = (bx - ax) / L;
        const wz = (bz - az) / L;
        const down = y0 < GROUND_H - 0.5;
        const l = litOf(down ? -1 : Math.max(0, Math.floor((y0 - GROUND_H) / STOREY_H)), false);
        if (l[0] >= 99 && l[2] >= 99) continue;
        // (the sash COT_R = 0.11 back in the cottage's wall, build_city.py)
        addWindow(ax + wx * sm, az + wz * sm, outs[wi][0], outs[wi][1], wx, wz, w * 0.86, y0 + 0.06, y1 - 0.06, l, tone, down ? 4 : 2, -0.095, down ? null : `${hi}:${wi}:${y0.toFixed(1)}`);
      }
      continue;
    }

    /** Windows on one street wall from a to b. gable: height of the gable outline over the eaves at a point along the wall. */
    /** M7 quays pass 2: a storehouse front's columns of loading doors and gates (build_city.py rect_house), along the wall. */
    let loads: number[] = [];
    /** The gable's cut windows (a front gable with the whole dress), or null: the painted ones as before. */
    let cutGable: GableWin[] | null = null;
    const wall = (ax: number, az: number, bx: number, bz: number, ox: number, oz: number, door: boolean, gable?: (d: number) => number, gableStep?: number) => {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) return;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      const bays = Math.max(1, Math.round(L / 3));
      const bw = L / bays;
      const at = (d: number): [number, number] => [ax + ux * d, az + uz * d];
      // ground storey: shop windows 36/64 of a bay wide, 0.83 to 2.85 m (cityTextures col 0)
      // (a house with a covered passage: its ground storey is the passage and plain wall, build_city.py)
      if (H >= 2.95 && !own?.ground && !poort) {
        const l = litOf(-1, false);
        if (l[0] < 99 || l[2] < 99) {
          for (let k = 0; k < bays; k++) {
            if (door && k === Math.floor(bays / 2)) continue;
            // (a storehouse's gate covers the bays it stands in: build_city.py door_run)
            if (loads.some((g) => k * bw < g + 1.7 && (k + 1) * bw > g - 1.7)) continue;
            const [x, z] = at((k + 0.5) * bw);
            // M7 quays pass 2: the shop window's glass stands SHOP_R (0.12 m) back in the wall now (build_city.py)
            addWindow(x, z, ox, oz, ux, uz, (bw * 36) / 64, 0.83, 2.85, l, tone, 1, setIn ? -0.095 : 0.04);
          }
        }
      }
      // upper storeys: tall windows 18/64 of a bay wide, 0.66 to 2.34 m above the storey floor (col 1)
      const maxUp = gable ? H + 12 : H;
      for (let k = 0; ; k++) {
        const yb = GROUND_H + k * STOREY_H + 0.66;
        const yt = GROUND_H + k * STOREY_H + 2.34;
        if (yb >= maxUp) break;
        const inGable = yt > H;
        if (inGable && !gable) break;
        if (own && (own.storeys.includes(k) || (inGable && own.gable))) continue;
        const l = litOf(k, inGable);
        if (l[0] >= 99 && l[2] >= 99) continue;
        if (!inGable) {
          const pw = (bw * 18) / 64;
          // (a storey with loading doors: none where a door stands, build_city.py upper_front)
          const lds = GROUND_H + k * STOREY_H + 2.6 < H - 0.3 ? loads : [];
          for (let j = 0; j < bays; j++) {
            const c = (j + 0.5) * bw;
            if (lds.some((g) => Math.abs(c - g) < 1.05 + (bw * 11) / 64)) continue;
            const [x, z] = at(c);
            // M7 quays pass 2: the sash stands WIN_R (0.16 m) back in the wall now (build_city.py)
            addWindow(x, z, ox, oz, ux, uz, pw, yb, yt, l, tone, 0, setIn ? -0.135 : 0.04, `${hi}:${ax},${az}:${k}`);
          }
          continue;
        }
        if (cutGable) {
          // M7 quays pass 2: the windows cut into this gable, their sash WIN_R back (the gable stands 2 cm proud)
          for (const [s, y0, y1, w, small] of cutGable) {
            if (Math.abs(y0 - (GROUND_H + k * STOREY_H + (small ? 0.6 : 0.5625))) > 0.01) continue;
            const [x, z] = at(s);
            const inset = small ? 0.11 : 0.0975;
            addWindow(x, z, ox, oz, ux, uz, small ? w * 0.78 : (w * 18) / 22, y0 + inset, y1 - inset, l, tone, 2, -0.115, `${hi}:${ax},${az}:${k}`);
          }
          continue;
        }
        // in the gable the texture runs in whole 3 m bays from the gable's own start;
        // a window that straddles the eaves only lines up when the wall bays are 3 m too
        if (yb < H && Math.abs(bw - 3) > 0.05) continue;
        const step = gableStep ?? 3;
        const pw = (3 * 18) / 64;
        for (let j = 0; (j + 0.5) * step + pw / 2 <= L - 0.1; j++) {
          const d = (j + 0.5) * step;
          const need = yt - H + 0.15;
          if (gable!(d - pw / 2) < need || gable!(d + pw / 2) < need) continue;
          const [x, z] = at(d);
          addWindow(x, z, ox, oz, ux, uz, pw, yb, yt, l, tone, 2, 0.06, `${hi}:${ax},${az}:${k}`);
        }
      }
    };

    if (h.rect) {
      const [ox, oz] = h.o;
      const [ux, uz] = h.u;
      const [nx, nz] = h.n;
      const [s0, s1] = h.s;
      const [t0, t1] = h.t;
      const P = (s: number, t: number): [number, number] => [ox + ux * s + nx * t, oz + uz * s + nz * t];
      const c = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)];
      const outs: Array<[number, number]> = [[-nx, -nz], [ux, uz], [nx, nz], [-ux, -uz]];
      const W = s1 - s0;
      const rise = Math.min((W / 2) * Math.tan((h.pitch * Math.PI) / 180), 9);
      const line = (d: number) => Math.max(0, rise * (1 - Math.abs(d - W / 2) / (W / 2)));
      const outline = (kind: string) => (d: number) =>
        kind === "step" ? line(d) + 0.45 : kind === "spout" ? line(d) * 0.75 + 0.25 : line(d);
      for (let i = 0; i < 4; i++) {
        if (!h.street[i]) continue;
        const [ax, az] = c[i];
        const [bx, bz] = c[(i + 1) % 4];
        let g: ((d: number) => number) | undefined;
        if (h.roof === "front" && i === 0) g = outline(h.gable);
        // the back gable is plain; along wall 2 the distance runs from s1, the gable is symmetric
        if (h.roof === "front" && i === 2) g = outline("plain");
        loads = [];
        if (store && i === 0) for (let g = 4.5; g < W - 3; g += 9) loads.push(g);
        setIn = !flat.has(`${hi}:${i}`);
        cutGable = i === 0 ? (gables[String(hi)] ?? null) : null;
        wall(ax, az, bx, bz, outs[i][0], outs[i][1], i === 0, g);
        cutGable = null;
        loads = [];
      }
    } else {
      const fp = h.fp;
      const n = fp.length;
      let area = 0;
      for (let i = 0; i < n; i++) area += fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1];
      const lens = fp.map((p, i) => Math.hypot(fp[(i + 1) % n][0] - p[0], fp[(i + 1) % n][1] - p[1]) * h.street[i]);
      let doorI = 0;
      for (let i = 1; i < n; i++) if (lens[i] > lens[doorI]) doorI = i;
      for (let i = 0; i < n; i++) {
        if (!h.street[i]) continue;
        const [ax, az] = fp[i];
        const [bx, bz] = fp[(i + 1) % n];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        let ox = (bz - az) / L;
        let oz = -(bx - ax) / L;
        if (area < 0) {
          ox = -ox;
          oz = -oz;
        }
        setIn = !flat.has(`${hi}:${i}`);
        wall(ax, az, bx, bz, ox, oz, i === doorI && lens[i] > 2);
      }
    }
  }
  // (yard windows, 2026-09-26) the windows build_city.py cut into the backs on the yards: a back room's lamp
  // (world/yardWindows.ts); downstairs a kitchen's small lamp (kind 4, as a cottage's), upstairs a room's
  for (const p of yardPanes(houses, YARDS.houses, litFor, (hi) => OWN_LIGHT.has(hi))) {
    const key = `${Math.floor(p.x / 100)},${Math.floor(p.z / 100)}`;
    let b = chunks.get(key);
    if (!b) chunks.set(key, (b = { win: [], winUv: [], winLit: [], winTone: [] }));
    buf = b;
    addWindow(p.x, p.z, p.ox, p.oz, p.ux, p.uz, p.w, p.y0, p.y1, p.lit, p.tone, p.down ? 4 : 0, YARD_PANE_OFF, p.down ? null : p.group);
  }
  // M7 quays pass 2: the lanterns build_city.py hangs by some doors, lit from dusk to dawn: a pane on the
  // front of the glass (x, y, z of the glass's middle, 8.5 cm to its front, outward ox, oz)
  for (const [x, y, z, ox, oz] of lamps) {
    const key = `${Math.floor(x / 100)},${Math.floor(z / 100)}`;
    let b = chunks.get(key);
    if (!b) chunks.set(key, (b = { win: [], winUv: [], winLit: [], winTone: [] }));
    buf = b;
    addWindow(x, z, ox, oz, oz, -ox, 0.15, y - 0.13, y + 0.12, [17.2, 30.5, 99, 99], 0.95, 3, 0.09);
  }
  return chunks;
}

function windowMaterials(): { win: THREE.ShaderMaterial } {
  const litGlsl = /* glsl */ `
    uniform float uHourN;
    uniform float uNight;
    attribute vec4 aLit;
    attribute vec2 aTone;
    float litNow() {
      float h = uHourN;
      float eve = smoothstep(aLit.x, aLit.x + 0.12, h) * (1.0 - smoothstep(aLit.y, aLit.y + 0.12, h));
      float morn = smoothstep(aLit.z, aLit.z + 0.12, h) * (1.0 - smoothstep(aLit.w, aLit.w + 0.12, h));
      return max(eve, morn) * uNight;
    }`;
  // lit windows ADD light (Steve: far off they showed dark against the fog): added light can
  // never be darker than what is behind it, so a window fades into the fog as a faint glow
  const win = shaderMat({
    transparent: true,
    depthWrite: false,
    decal: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${VCOMMON}
      ${litGlsl}
      attribute vec2 aUv;
      varying vec2 vUv;
      varying float vLit;
      varying vec2 vTone;
      void main() {
        vLit = litNow();
        vUv = aUv;
        vTone = aTone;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        if (vLit < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      uniform float uTime;
      varying vec2 vUv;
      varying float vLit;
      varying vec2 vTone;
      void main() {
        // oil lamp and candle: orange to yellow, some rooms dimmer
        vec3 warm = mix(vec3(1.0, 0.3, 0.05), vec3(1.0, 0.5, 0.14), vTone.x) * (0.42 + 0.35 * fract(vTone.x * 7.3));
        // brighter low in the pane (the lamp on the table), a curtain edge up top
        warm *= 0.75 + 0.45 * (1.0 - vUv.y);
        warm *= 1.0 - 0.35 * smoothstep(0.78, 0.9, vUv.y) * step(0.5, fract(vTone.x * 3.1));
        // M7 quays pass 2: curtains drawn to the sides in most rooms (not the shops), their folds in the light
        float cw = 0.16 + 0.1 * fract(vTone.x * 11.3);
        float side = max(step(vUv.x, cw), step(1.0 - cw, vUv.x));
        float folds = 0.55 + 0.25 * sin(vUv.x * 60.0 + vTone.x * 9.0);
        float shopFront = step(0.5, vTone.y) * step(vTone.y, 1.5);
        warm *= mix(1.0, folds * 0.8, side * step(0.35, fract(vTone.x * 5.7)) * (1.0 - shopFront));
        // glazing bars: a mullion and two transoms (the shop window: two mullions)
        float bars = step(abs(vUv.x - 0.5), 0.04);
        bars = max(bars, step(abs(vUv.y - 0.333), 0.025) + step(abs(vUv.y - 0.667), 0.025));
        warm *= 1.0 - 0.7 * min(bars, 1.0);
        warm *= 0.94 + 0.06 * sin(uTime * 3.1 + vTone.x * 40.0) * sin(uTime * 7.7 + vTone.x * 13.0);
        // by the kind of room (world/spill.ts gives their light on the street the same order): a shop or front
        // room downstairs, upstairs, a garret's candle, a lantern
        warm *= vTone.y > 3.5 ? 0.75 : vTone.y > 2.5 ? 1.0 : vTone.y > 1.5 ? 0.6 : vTone.y > 0.5 ? 1.15 : 0.9;
        float f = fogK();
        // a faint warm glow stays in the fog: lamplight carries further than the walls show
        gl_FragColor = vec4(warm * vLit * (1.0 - f * 0.82) * 1.25, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return { win };
}

// ------------------------------------------------------------------ 3. rain and puddles

function buildRain(): THREE.Mesh {
  // Streaks as thin strips, a pixel or two wide at any render height (lines were one pixel: the great storm's rain
  // looked tame, Steve 2026-09-29). Up to 6000 (the great storm); an ordinary full rain draws 1600 of them, as before.
  const N = 6000;
  const pos = new Float32Array(N * 4 * 3);
  const seg = new Float32Array(N * 4);
  const side = new Float32Array(N * 4);
  const seed = new Float32Array(N * 4);
  const idx = new Uint32Array(N * 6);
  const r = mulberry(99);
  for (let i = 0; i < N; i++) {
    const x = r() * 28;
    const y = r() * 14;
    const z = r() * 28;
    const sd = r();
    for (let k = 0; k < 4; k++) {
      pos.set([x, y, z], (i * 4 + k) * 3);
      seg[i * 4 + k] = k >> 1;
      side[i * 4 + k] = k & 1 ? 1 : -1;
      seed[i * 4 + k] = sd;
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aSeg", new THREE.BufferAttribute(seg, 1));
  g.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const mat = shaderMat({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      ${VCOMMON}
      ${LAMPS}
      uniform vec3 uCam;
      uniform vec2 uWind;
      uniform float uRainAmt;
      uniform float uTempest;
      uniform float uExpo;
      uniform vec4 uRoom;
      uniform vec3 fogColor;
      uniform vec4 uGusts[4];
      uniform float uGustA0[4];
      uniform vec2 uGustDir;
      // the gust at a place now (as alive/wind.ts gustAt): its front sweeps along the wind; 0 between the gusts
      float gustVeil(vec2 xz) {
        float along = dot(xz, uGustDir);
        float g = 0.0;
        for (int i = 0; i < 4; i++) {
          vec4 q = uGusts[i];
          if (q.z <= 0.0) continue;
          float local = -q.x - (along - uGustA0[i]) / q.w;
          float env = clamp((local + 0.5) / 0.8, 0.0, 1.0) * clamp((q.y + 1.0 - local) / 1.5, 0.0, 1.0);
          g = max(g, q.z * env);
        }
        return g;
      }
      attribute float aSeg;
      attribute float aSide;
      attribute float aSeed;
      varying vec3 vCol;
      varying float vA;
      varying float vSeg;
      void main() {
        vSeg = aSeg;
        vec3 box = vec3(28.0, 14.0, 28.0);
        // each drop a little its own way in the wind
        float jit = fract(aSeed * 13.7) - 0.5;
        // (the great storm: it drives down harder, and the wind lays it over)
        vec3 vel = vec3(uWind.x * (1.6 + jit * 0.5), (-8.5 - aSeed * 2.5) * (1.0 + 0.45 * uTempest), uWind.y * (1.6 - jit * 0.5));
        vec3 lo = uCam - vec3(14.0, 5.0, 14.0);
        vec3 head = lo + mod(position + vel * uTime - lo, box);
        // a streak is the drop's fall in one frame (uExpo), a little more or less drop by drop: this frame's streak meets
        // the last one's, and the eye follows the drop down; both ends in front of the eye, or none
        float expo = uExpo * (0.85 + 0.3 * fract(aSeed * 5.31));
        vec3 tail = head - vel * expo;
        vec4 mh = modelViewMatrix * vec4(head, 1.0);
        vec4 mt = modelViewMatrix * vec4(tail, 1.0);
        vec4 ch = projectionMatrix * mh;
        vec4 ct = projectionMatrix * mt;
        vec3 p = aSeg > 0.5 ? tail : head;
        vec4 mv = aSeg > 0.5 ? mt : mh;
        vFogDepth = -mv.z;
        gl_Position = aSeg > 0.5 ? ct : ch;
        // widened across the streak on the screen: a pixel and a half at the game's 270 lines, more for the nearest
        float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
        vec2 sh = ch.xy / max(ch.w, 1e-3);
        vec2 st = ct.xy / max(ct.w, 1e-3);
        vec2 dir = st - sh;
        dir.x *= aspect;
        dir = length(dir) > 1e-6 ? normalize(dir) : vec2(0.0, 1.0);
        vec2 perp = vec2(-dir.y, dir.x);
        perp.x /= aspect;
        float px = (0.75 + 0.9 * (1.0 - smoothstep(0.8, 3.5, vFogDepth))) * (1.0 + 0.4 * uTempest);
        gl_Position.xy += perp * aSide * px * (2.0 / 270.0) * gl_Position.w;
        // rain barely shows in grey daylight (a little lighter than the air); a drop by a
        // gas lamp catches its glow and shows clearly
        vec3 col = fogColor * (1.3 + 0.5 * uTempest) + 0.01 + 0.05 * uTempest;
        for (int i = 0; i < AMB_LAMPS; i++) {
          vec3 d = p - uLamps[i].xyz;
          col += uLampColor * uLamps[i].w * 1.3 / (1.0 + dot(d, d) * 0.3);
        }
        vCol = col;
        // close drops only: far off, rain is thicker air (the weather's fog), not streaks
        // (the great storm: sheets of it, seen farther off: the whole box)
        float near = smoothstep(0.4, 1.2, vFogDepth) * (1.0 - smoothstep(3.0 + 5.0 * uTempest, 7.0 + 6.0 * uTempest, vFogDepth));
        float za = -mh.z;
        float zb = -mt.z;
        vA = step(aSeed, uRainAmt * (0.267 + 0.733 * uTempest)) * near * (0.08 + 0.2 * fract(aSeed * 7.3)) * (0.5 + 0.5 * uRainAmt) * (1.0 + 2.6 * uTempest) * step(0.7, min(za, zb));
        // (thicker strips than the old lines: the same rain a little fainter per pixel)
        vA *= 0.75;
        // the great storm: the rain comes in curtains that sweep along with the wind, thick and thin by turns
        if (uTempest > 0.0) {
          vec2 wd = normalize(uWind + vec2(1e-4));
          float along = dot(head.xz, wd) - uTime * length(uWind) * 1.1;
          float c = 0.5 + 0.5 * sin(along * 0.21 + sin(dot(head.xz, vec2(-wd.y, wd.x)) * 0.09) * 2.0) * sin(along * 0.083 + 1.3);
          vA *= mix(1.0, 0.3 + 1.1 * smoothstep(0.25, 0.8, c), uTempest);
          // and each gust brings its veil: a wall of heavier rain sweeping across with the gust's front
          vA *= 1.0 + 0.9 * min(gustVeil(head.xz), 2.5) * uTempest;
        }
        // in a room (the tavern): no rain in it, only out of the windows (uRoom: its box in x and z)
        if (uRoom.z > uRoom.x && head.x > uRoom.x && head.x < uRoom.z && head.z > uRoom.y && head.z < uRoom.w) vA = 0.0;
        if (vA < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      varying vec3 vCol;
      varying float vA;
      varying float vSeg;
      void main() {
        float f = fogK();
        // the head of the streak (where the drop is now) bright, its tail (where it was) faint: the eye reads which way it goes
        gl_FragColor = vec4(mix(vCol, fogColor, f * 0.8), vA * (1.0 - f * 0.6) * mix(1.25, 0.12, vSeg));
        #include <colorspace_fragment>
      }`,
  });
  // (a strip faces either way: both sides, in one pass, not the back and then the front)
  mat.forceSinglePass = true;
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.name = "ambient_rain";
  return mesh;
}

/**
 * The great storm's far rain (the rain layers of ATI's ToyShop, Tatarchuk 2006): two open cylinders round the eye, 9
 * and 17 m out, with streaks falling down their inside at the drops' speed, laid over by the wind and thick and thin
 * in the same sweeping curtains as the near drops. Walls nearer than a layer hide it (depth test): in a lane the rain
 * is what falls in the lane. One draw call, one shader, built at load.
 */
function buildRainSheets(): THREE.Mesh {
  const parts: THREE.BufferGeometry[] = [];
  for (const R of [9, 17]) {
    const c = new THREE.CylinderGeometry(R, R, 26, 40, 1, true);
    c.translate(0, 5, 0);
    parts.push(c);
  }
  const geo = mergeGeometries(parts)!;
  const mat = shaderMat({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    vertexShader: /* glsl */ `
      ${VCOMMON}
      varying vec3 vL;
      varying vec3 vW;
      void main() {
        vL = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      uniform float uTime;
      uniform vec2 uWind;
      uniform float uRainAmt;
      uniform float uTempest;
      uniform float uExpo;
      uniform float uNight;
      uniform vec4 uRoom;
      uniform vec4 uGusts[4];
      uniform float uGustA0[4];
      uniform vec2 uGustDir;
      // the gust at a place now (as alive/wind.ts gustAt): its front sweeps along the wind; 0 between the gusts
      float gustVeil(vec2 xz) {
        float along = dot(xz, uGustDir);
        float g = 0.0;
        for (int i = 0; i < 4; i++) {
          vec4 q = uGusts[i];
          if (q.z <= 0.0) continue;
          float local = -q.x - (along - uGustA0[i]) / q.w;
          float env = clamp((local + 0.5) / 0.8, 0.0, 1.0) * clamp((q.y + 1.0 - local) / 1.5, 0.0, 1.0);
          g = max(g, q.z * env);
        }
        return g;
      }
      varying vec3 vL;
      varying vec3 vW;
      void main() {
        float amt = uRainAmt * uTempest;
        if (amt < 0.02) discard;
        if (uRoom.z > uRoom.x && vW.x > uRoom.x && vW.x < uRoom.z && vW.z > uRoom.y && vW.z < uRoom.w) discard;
        float R = length(vL.xz);
        float ang = atan(vL.z, vL.x);
        vec2 tang = vec2(-sin(ang), cos(ang));
        float fall = 12.0 + 4.0 * uTempest;
        // laid over by the wind across the line of sight
        float slant = dot(uWind * 1.6, tang) / fall;
        float u = ang * R + vL.y * slant;
        float cw = 0.2 * R / 9.0;
        float col = floor(u / cw);
        float h1 = hash12(vec2(col, R));
        float h2 = hash12(vec2(col * 1.7 + 3.1, R * 0.37));
        float xf = fract(u / cw);
        float thin = 1.0 - smoothstep(0.08, 0.2, abs(xf - 0.3 - h1 * 0.4));
        float sp = 1.6 + h2 * 2.4;
        float y = vW.y + uTime * fall * (0.9 + 0.2 * h1) + h2 * 37.0;
        float f = fract(y / sp);
        float len = clamp(fall * uExpo * 1.2 / sp, 0.05, 0.6);
        // (the gusts' veils: a white wall of rain comes across the square with each gust)
        float veil = min(gustVeil(vW.xz), 2.5);
        float streak = step(f, len) * (1.0 - 0.85 * f / len) * step(h1, amt * (0.9 + 0.3 * veil) + 0.1);
        // the curtains, as the near drops have them
        vec2 wd = normalize(uWind + vec2(1e-4));
        float along = dot(vW.xz, wd) - uTime * length(uWind) * 1.1;
        float c = 0.5 + 0.5 * sin(along * 0.21 + sin(dot(vW.xz, vec2(-wd.y, wd.x)) * 0.09) * 2.0) * sin(along * 0.083 + 1.3);
        float curtain = (0.3 + 1.1 * smoothstep(0.25, 0.8, c)) * (1.0 + 1.1 * veil);
        float k = fogK();
        float a = thin * streak * curtain * amt * (R < 12.0 ? 0.8 : 0.6) * (1.0 - 0.5 * k);
        // the rain so thick it rolls by in grey clouds (Steve 2026-09-28): a soft haze in big billows blown along the
        // wind, thickest in a gust's veil; on the far layer only (the near one keeps the streaks clear)
        if (R > 12.0) {
          vec2 hp = vec2(along * 0.08, vW.y * 0.12 + dot(vW.xz, vec2(-wd.y, wd.x)) * 0.05);
          float billow = 0.5 + 0.25 * sin(hp.x * 3.1 + sin(hp.y * 2.3) * 1.7) + 0.25 * sin(hp.x * 1.3 - hp.y * 1.9 + 2.0);
          a += smoothstep(0.4, 0.95, billow) * (0.12 + 0.2 * veil) * amt;
        }
        if (a < 0.004) discard;
        vec3 col3 = mix(fogColor * 1.45 + 0.03, fogColor, k * 0.6) * (1.0 - 0.3 * uNight);
        gl_FragColor = vec4(col3, a);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 2;
  m.name = "ambient_rainsheets";
  return m;
}



// ------------------------------------------------------------------ the module

export function createAmbient(scene: THREE.Scene, city: CityWorld): Ambient {
  const root = new THREE.Group();
  root.name = "ambient";
  scene.add(root);

  let manualRain = 0;
  let rainNow = 0;
  let wet = 0;
  let hourNow = -1;
  const camPos = new THREE.Vector3();
  const lastCam = new THREE.Vector3();
  let camSpeed = 0;

  // --- rain streaks: ready at once
  const rain = buildRain();
  rain.visible = false;
  root.add(rain);
  // (the great storm's far rain: built at load, drawn while it pours in a tempest; its shader is compiled up front)
  const rainSheets = buildRainSheets();
  root.add(rainSheets);
  neverMirrored.push(rain, rainSheets);

  // --- birds: one instanced mesh for gulls and pigeons
  const MAX_BIRDS = 72;
  const birdMat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), { affine: 0 });
  {
    const base = birdMat.onBeforeCompile;
    birdMat.onBeforeCompile = (shader, renderer) => {
      base.call(birdMat, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nattribute vec2 aWing;")
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
          {
            // wings beat about the body axis (aWing.x, radians); folded along the back (aWing.y)
            float ax = abs(transformed.x);
            float wing = smoothstep(0.07, 0.1, ax);
            float a = aWing.x * wing * (1.0 + 0.5 * smoothstep(0.3, 0.6, ax));
            float bx = mix(ax * cos(a), ax * 0.18, aWing.y * wing);
            float by = mix(ax * sin(a), 0.035, aWing.y * wing);
            transformed.z -= aWing.y * wing * ax * 0.45;
            transformed.x = sign(transformed.x) * mix(ax, bx, wing);
            transformed.y += by * wing;
          }`,
        );
    };
    birdMat.customProgramCacheKey = () => "ambient-bird";
  }
  const birdGeo = birdGeometry();
  const wingAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BIRDS * 2), 2);
  wingAttr.setUsage(THREE.DynamicDrawUsage);
  birdGeo.setAttribute("aWing", wingAttr);
  const birdMesh = new THREE.InstancedMesh(birdGeo, birdMat, MAX_BIRDS);
  birdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birdMesh.frustumCulled = false;
  birdMesh.count = 0;
  birdMesh.name = "ambient_birds";
  root.add(birdMesh);
  const birds: Bird[] = [];
  const flocks: Flock[] = [];

  /** Over the river, the Petit Bassin, the canal and the vliet (shared/city.json water). */
  const anchors: Array<[number, number]> = [];
  for (let x = -330; x <= 190; x += 26) anchors.push([x, -16 - ((x * 7919) % 13 + 13) % 13]);
  anchors.push([100, 64], [140, 92], [122, 80], [-76, 40], [-76, 120], [-76, 180], [-146, 40]);

  const newBird = (kind: 0 | 1, mode: Bird["mode"], seed: number): Bird => ({
    kind, mode, seed,
    anchor: 0, cx: 0, cz: 0, R: 10, y0: 10, w: 0.5, th: seed * 6.28,
    p0: new THREE.Vector3(), p1: new THREE.Vector3(), air: -1, D: 20, phi: 0, loopR: 10, loopH: 6, delay: 0,
    flock: -1, yaw: seed * 6.28, peck: 0, timer: 0, walk: null,
    pos: new THREE.Vector3(), prev: new THREE.Vector3(), shown: false,
  });

  {
    const r = mulberry(777);
    // 16 gulls wheeling: most over the water near you, three high over the roofs wherever you are
    for (let i = 0; i < 16; i++) {
      const b = newBird(0, "wheel", r());
      b.anchor = i < 3 ? -1 : -2; // -2: not placed yet
      b.R = 8 + r() * 14;
      b.y0 = i < 3 ? 20 + r() * 8 : 6 + r() * 12;
      b.w = (6 + r() * 3) / b.R * (r() < 0.5 ? -1 : 1);
      birds.push(b);
    }
  }

  // --- things that wait for the houses and the walk map
  let smoke: THREE.Points | null = null;
  let pudBase = 0.34;
  const winChunks: Array<{ win: THREE.Mesh; centre: THREE.Vector3; radius: number }> = [];
  let chimneyCount = 0;
  let chimneyList: Chimney[] = [];
  let windowCount = 0;
  let spillCount = 0;

  city.ready
    .then(async () => {
      const chimneys = findChimneys(city.group);
      chimneyList = chimneys; // M7 alive (hook)
      chimneyCount = chimneys.length;
      if (chimneys.length) {
        smoke = buildSmoke(chimneys);
        root.add(smoke);
      }

      const r = mulberry(4711);
      // gulls on the bollards of the Rijnkaai (rijnkaai.ts: every 9 m, not at the pier or the gangway)
      const bollards: THREE.Vector3[] = [];
      for (let x = -54; x <= 54; x += 9) {
        if (x > 3 && x < 11) continue;
        if (Math.abs(x + 42) < 2) continue;
        const ez = edgeZ(x);
        if (ez > 6) continue;
        bollards.push(new THREE.Vector3(x, 0.86, ez + 0.9));
      }
      const perches: THREE.Vector3[] = [];
      for (let i = 0; i < 4 && bollards.length; i++) perches.push(bollards.splice(Math.floor(r() * bollards.length), 1)[0]);
      // and on cold chimneys by the river
      const cold = chimneys.filter((c) => c.act > 0.8 && c.z < 30 && c.z > 0).sort(() => r() - 0.5);
      for (const c of cold.slice(0, 7)) perches.push(new THREE.Vector3(c.x, c.y + 0.08, c.z));
      for (const p of perches) {
        const b = newBird(0, "perch", r());
        b.p0.copy(p);
        b.p1.copy(p);
        b.pos.copy(p);
        b.prev.copy(p);
        b.yaw = 2.6 + r() * 0.6; // into the wind, off the river
        birds.push(b);
      }

      // pigeons on the squares
      const squares: Array<[number, number, number, number]> = [
        [-254, 94, 11, 13], // Grote Markt
        [-180, 20, 9, 11], // Steenplein
        [-118, 30, 6, 7], // Vismarkt
      ];
      const spot = (x: number, z: number, rad: number): THREE.Vector3 | null => {
        for (let k = 0; k < 20; k++) {
          const a = r() * Math.PI * 2;
          const d = Math.sqrt(r()) * rad;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          if (city.flags(px, pz) === 0 && city.flags(px + 1, pz) === 0 && city.flags(px - 1, pz) === 0 && city.flags(px, pz + 1) === 0 && city.flags(px, pz - 1) === 0) {
            return new THREE.Vector3(px, 0.055, pz);
          }
        }
        return null;
      };
      for (const [x, z, rad, n] of squares) {
        const f: Flock = { x, z, r: rad, birds: [], up: 0 };
        for (let i = 0; i < n && birds.length < MAX_BIRDS; i++) {
          const p = spot(x, z, rad);
          if (!p) continue;
          const b = newBird(1, "perch", r());
          b.flock = flocks.length;
          b.p0.copy(p);
          b.p1.copy(p);
          b.pos.copy(p);
          b.prev.copy(p);
          b.timer = r() * 3;
          f.birds.push(b);
          birds.push(b);
        }
        flocks.push(f);
      }
      birdMesh.count = birds.length;
      const gull = new THREE.Color(1, 1, 1);
      const pigeon = new THREE.Color(0.42, 0.44, 0.5);
      birds.forEach((b, i) => birdMesh.setColorAt(i, b.kind === 0 ? gull : pigeon));
      if (birdMesh.instanceColor) birdMesh.instanceColor.needsUpdate = true;

      // lit windows, from the plan the houses were built from
      const data = (await import("../../../shared/city_build.json")).default as unknown as { houses: House[] };
      const gables = (await import("../../../shared/city_gable_windows.json")).default as unknown as { houses: Record<string, GableWin[]> };
      // (the houses as built: a pane only where the model paints a window, world/facadeProbe.ts)
      const chunks = buildWindows(data.houses, gables.houses, (gables as unknown as { lamps?: number[][] }).lamps ?? [], sharedFacadeProbe(city.group), city.openings()?.cottages ?? null);
      // their light on the street (world/spill.ts; the old fans on the cobbles lay under the pavements)
      spillCount = spillPanes(panes);
      panes = [];
      const mats = windowMaterials();
      for (const c of chunks.values()) {
        if (!c.win.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(c.win, 3));
        g.setAttribute("aUv", new THREE.Float32BufferAttribute(c.winUv, 2));
        g.setAttribute("aLit", new THREE.Float32BufferAttribute(c.winLit, 4));
        g.setAttribute("aTone", new THREE.Float32BufferAttribute(c.winTone, 2));
        g.computeBoundingSphere();
        const win = new THREE.Mesh(g, mats.win);
        win.renderOrder = 1;
        win.name = "ambient_windows";
        root.add(win);
        windowCount += c.win.length / 18;
        const s = g.boundingSphere!;
        winChunks.push({ win, centre: s.center.clone(), radius: s.radius });
      }
    })
    .catch((e) => console.warn("ambient: city not ready", e));

  // --- birds, per frame
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const euler = new THREE.Euler(0, 0, 0, "YXZ");
  const scl = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function takeOff(b: Bird, D: number, loopR: number, loopH: number, awayFrom: THREE.Vector3, land: THREE.Vector3): void {
    b.air = 0;
    b.D = D;
    b.loopR = loopR;
    b.loopH = loopH;
    b.phi = Math.atan2(b.p0.z - awayFrom.z, b.p0.x - awayFrom.x);
    b.p1.copy(land);
    b.walk = null;
  }

  function airPos(b: Bird, out: THREE.Vector3): void {
    const k = THREE.MathUtils.clamp(b.air / b.D, 0, 1);
    const env = Math.pow(Math.sin(Math.PI * k), 0.7);
    const w = 0.55 * (b.seed < 0.5 ? 1 : -1);
    const a = b.phi + w * b.air;
    // out from the perch along phi, round a loop, and down onto the landing spot
    out.lerpVectors(b.p0, b.p1, THREE.MathUtils.smootherstep(k, 0, 1));
    out.x += env * b.loopR * (Math.cos(a) + Math.cos(b.phi)) * 0.5;
    out.z += env * b.loopR * (Math.sin(a) + Math.sin(b.phi)) * 0.5;
    out.y += env * b.loopH * (1 + 0.15 * Math.sin(b.air * 0.9));
  }

  function updateBirds(t: number, dt: number, night: number): void {
    const cp = camPos;
    // wheeling gulls keep to the water nearest you
    let near: number[] = [];
    const nearest = (): number[] => {
      if (!near.length) {
        const dist = (i: number) => Math.hypot(anchors[i][0] - cp.x, anchors[i][1] - cp.z);
        near = anchors.map((_, i) => i).sort((i, j) => dist(i) - dist(j)).slice(0, 5);
      }
      return near;
    };
    const flushR = camSpeed > 2.2 ? 6.5 : 4;
    // M8f sync pass 3: every player flushes them, and where they land, how they fly and what they do on the ground
    // come from the clock every PC shares and the bird (were this PC's dice): the same birds on every screen
    const S = sharedSeconds();
    const others = share.on ? share.players().slice(1) : [];
    const key = (b: Bird) => Math.floor(b.seed * 1e6);
    // pigeons: a flock goes up together when you come close
    for (const f of flocks) {
      f.up = Math.max(0, f.up - dt);
      const sitting = f.birds.filter((b) => b.air < 0);
      if (!sitting.length) continue;
      let by: { x: number; z: number } | null = sitting.some((b) => Math.hypot(b.pos.x - cp.x, b.pos.z - cp.z) < flushR && cp.y < 4) ? cp : null;
      for (const o of others) if (!by && sitting.some((b) => Math.hypot(b.pos.x - o.x, b.pos.z - o.z) < 4)) by = o;
      if (!by) continue;
      const slot = Math.floor(S / 3);
      for (const b of f.birds) {
        if (b.air >= 0) continue;
        // land again somewhere on the square away from you
        let best = b.p0.clone();
        let bestD = -1;
        for (let k = 0; k < 6; k++) {
          const a = dice("pgland", key(b), slot, k) * Math.PI * 2;
          const d = Math.sqrt(dice("pglandd", key(b), slot, k)) * f.r;
          const px = f.x + Math.cos(a) * d;
          const pz = f.z + Math.sin(a) * d;
          if (city.flags(px, pz) !== 0) continue;
          const dd = Math.hypot(px - by.x, pz - by.z);
          if (dd > bestD) {
            bestD = dd;
            best = new THREE.Vector3(px, 0.055, pz);
          }
        }
        takeOff(b, 10 + dice("pgD", key(b), slot) * 8, 5 + dice("pgR", key(b), slot) * 5, 4 + dice("pgH", key(b), slot) * 4, tmp2.set(by.x, 0, by.z), best);
        b.delay = dice("pgdelay", key(b), slot) * 0.5;
      }
    }

    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      b.prev.copy(b.pos);
      let flap = 0;
      let fold = 0;
      let pitch = 0;
      let shown = true;
      if (b.mode === "wheel") {
        if (b.anchor === -2 || (b.anchor >= 0 && Math.hypot(anchors[b.anchor][0] - cp.x, anchors[b.anchor][1] - cp.z) > 120)) {
          const list = nearest();
          b.anchor = list[Math.floor(b.seed * 97 + t) % list.length];
          const [ax, az] = anchors[b.anchor];
          b.cx = ax + (b.seed - 0.5) * 16;
          b.cz = az + ((b.seed * 7.3) % 1 - 0.5) * 10;
          b.prev.set(NaN, 0, 0);
        }
        if (b.anchor === -1) {
          // high over the roofs: the centre drifts after you
          if (Math.hypot(b.cx - cp.x, b.cz - cp.z) > 90) {
            b.cx = cp.x + (b.seed - 0.5) * 40;
            b.cz = cp.z + ((b.seed * 3.7) % 1 - 0.5) * 40;
            b.prev.set(NaN, 0, 0);
          }
          const k = Math.min(1, dt * 0.05);
          b.cx += (cp.x + (b.seed - 0.5) * 40 - b.cx) * k;
          b.cz += (cp.z + ((b.seed * 3.7) % 1 - 0.5) * 40 - b.cz) * k;
        }
        b.th += b.w * dt;
        const R = b.R * (1 + 0.25 * Math.sin(b.th * 0.5 + b.seed * 9));
        b.pos.set(b.cx + Math.cos(b.th) * R, b.y0 + 2 * Math.sin(t * 0.3 + b.seed * 20), b.cz + Math.sin(b.th) * R);
        if (Number.isNaN(b.prev.x)) b.prev.copy(b.pos).addScaledVector(tmp.set(-Math.sin(b.th), 0, Math.cos(b.th)), -b.w * R * 0.016);
        // gulls glide; now and then a few slow beats
        const beats = THREE.MathUtils.smoothstep(Math.sin(t * 0.8 + b.seed * 30), 0.35, 0.7);
        flap = 0.12 + Math.sin(t * 13 + b.seed * 50) * 0.75 * beats;
        shown = night < 0.6;
      } else if (b.air < 0) {
        // sitting
        fold = 1;
        if (b.kind === 0) {
          const d = Math.hypot(b.pos.x - cp.x, b.pos.z - cp.z);
          let by: { x: number; z: number } | null = d < 5 && Math.abs(b.pos.y - cp.y) < 6 ? cp : null;
          for (const o of others) if (!by && Math.hypot(b.pos.x - o.x, b.pos.z - o.z) < 5) by = o;
          // (now and then on its own: about once in 90 s, at a time of the shared clock)
          const n = Math.floor(S / 90 + b.seed);
          const due = b.timer !== n && b.timer !== 0 && dice("gullgo", key(b), n) < 0.63;
          b.timer = n;
          if (by || due) {
            takeOff(b, 22 + dice("gD", key(b), n) * 14, 12 + dice("gR", key(b), n) * 8, 7 + dice("gH", key(b), n) * 6, by ? tmp2.set(by.x, 0, by.z) : tmp.set(b.p0.x, 0, b.p0.z + 5), b.p0);
          }
        } else {
          // pigeons walk and peck (M8f: a step of 2 s of the shared clock each, each bird its own; a walk goes to a
          // spot round where it landed, so two PCs that saw it land there have it at the same spots)
          const n = Math.floor(S / 2 + b.seed);
          if (b.timer !== n) {
            b.timer = n;
            const f = flocks[b.flock];
            const roll = dice("pg", key(b), n);
            if (roll < 0.45) {
              const a = dice("pga", key(b), n) * Math.PI * 2;
              const d = dice("pgd", key(b), n) * 1.2;
              const nx = b.p0.x + Math.cos(a) * d;
              const nz = b.p0.z + Math.sin(a) * d;
              if (city.flags(nx, nz) === 0 && Math.hypot(nx - f.x, nz - f.z) < f.r) b.walk = new THREE.Vector3(nx, 0.055, nz);
            } else if (roll < 0.8) {
              b.walk = null;
              b.peck = 0.8 + dice("pgp", key(b), n) * 1.1;
            } else {
              b.walk = null;
              b.yaw = dice("pgy", key(b), n) * 6.28;
            }
          }
          if (b.walk) {
            vel.subVectors(b.walk, b.pos).setY(0);
            const d = vel.length();
            if (d < 0.05) b.walk = null;
            else {
              b.yaw = Math.atan2(vel.x, vel.z);
              b.pos.addScaledVector(vel, Math.min(1, (0.32 * dt) / d));
              pitch = Math.max(0, Math.sin(t * 16 + b.seed * 9)) * 0.15; // head bob
            }
          }
          if (b.peck > 0) {
            b.peck -= dt;
            pitch = Math.max(0, Math.sin(t * 11 + b.seed * 20)) * 0.6;
          }
          shown = night < 0.5 && rainNow < 0.5;
        }
      } else {
        // in the air
        if (b.delay > 0) {
          b.delay -= dt;
          fold = 1;
        } else {
          b.air += dt;
          if (b.air >= b.D) {
            b.air = -1;
            b.p0.copy(b.p1);
            b.pos.copy(b.p1);
            fold = 1;
          } else {
            airPos(b, b.pos);
            const k = b.air / b.D;
            const hard = b.kind === 1 || k < 0.12 || k > 0.9 ? 1 : THREE.MathUtils.smoothstep(Math.sin(t * 0.8 + b.seed * 30), 0.35, 0.7);
            flap = 0.1 + Math.sin(t * (b.kind === 1 ? 24 : 13) + b.seed * 50) * 0.8 * hard;
          }
        }
        if (b.kind === 1) shown = night < 0.5 && rainNow < 0.5;
      }
      b.shown = shown;

      // heading from the way it moved
      vel.subVectors(b.pos, b.prev);
      const hs = Math.hypot(vel.x, vel.z);
      let roll = 0;
      if (b.mode === "wheel" || b.air >= 0) {
        if (hs > 1e-4) {
          const yaw = Math.atan2(vel.x, vel.z);
          let dy = yaw - b.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          roll = THREE.MathUtils.clamp(-dy / Math.max(dt, 1e-3) * 0.35, -0.7, 0.7);
          b.yaw = yaw;
          pitch = -Math.atan2(vel.y, hs) * 0.6;
        }
      }
      const far = Math.hypot(b.pos.x - cp.x, b.pos.z - cp.z) > 160;
      const s = shown && !far ? (b.kind === 0 ? 1 : 0.7) : 0;
      euler.set(pitch, b.yaw, roll);
      q.setFromEuler(euler);
      m4.compose(b.pos, q, scl.set(s, s, s));
      birdMesh.setMatrixAt(i, m4);
      wingAttr.setXY(i, flap, fold);
    }
    birdMesh.instanceMatrix.needsUpdate = true;
    wingAttr.needsUpdate = true;
  }

  // --- per frame
  const fogCol = new THREE.Color();
  const smokeTint = new THREE.Color();
  function update(t: number, dt: number, camera: THREE.Camera, hour: number, weather: string): void {
    camera.getWorldPosition(camPos);
    const moved = camPos.distanceTo(lastCam);
    camSpeed = dt > 0 && moved < 5 ? camSpeed + (moved / dt - camSpeed) * Math.min(1, dt * 4) : camSpeed;
    lastCam.copy(camPos);
    U.uTime.value = t;
    U.uCam.value.copy(camPos);

    // the clock, eased the short way round midnight (a jump after sleep fades in)
    const h = ((hour % 24) + 24) % 24;
    if (hourNow < 0) hourNow = h;
    let dh = h - hourNow;
    if (dh > 12) dh -= 24;
    if (dh < -12) dh += 24;
    hourNow = (hourNow + dh * Math.min(1, dt * 0.8) + 24) % 24;
    U.uHourN.value = hourNow < 12 ? hourNow + 24 : hourNow;
    const dim = weather === "fog" || weather === "rain" || weather === "storm" ? 0.4 : 0; // a dark day lights up earlier
    const night = Math.max(curve(NIGHT_BY_HOUR, hourNow + dim), curve(NIGHT_BY_HOUR, hourNow - dim));
    U.uNight.value = night;
    // the lit panes' light on the street follows the same clock (world/spill.ts)
    setSpillClock(U.uHourN.value, night);

    // rain: on a rain day showers come and go over the hours, with drizzle between
    let auto = 0;
    if (weather === "storm") {
      // a gale: heavy rain in squalls, never quite stopping
      auto = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(hourNow * 2.3) * Math.sin(hourNow * 0.9 + 1.0));
      // the great storm: it never lets up
      auto = Math.max(auto, Math.min(1, 0.7 + 0.5 * tempest.level));
    } else if (weather === "rain") {
      const n = 0.5 + 0.5 * Math.sin(hourNow * 1.7) * Math.sin(hourNow * 0.63 + 2.0);
      auto = 0.2 + 0.8 * THREE.MathUtils.smoothstep(n, 0.3, 0.75);
    }
    const target = Math.max(manualRain, auto);
    U.uTempest.value = weather === "storm" ? tempest.level : 0;
    rainNow += (target - rainNow) * Math.min(1, dt * 0.3);
    if (rainNow < 0.002 && target === 0) rainNow = 0;
    // the ground gets wet fast and dries slowly
    const wetTarget = rainNow > 0.05 ? Math.min(1, 0.35 + rainNow) : weather === "rain" || weather === "storm" ? 0.45 : 0;
    wet += wetTarget > wet ? (wetTarget - wet) * Math.min(1, dt * 0.12) : Math.max(wetTarget - wet, -dt * 0.01);
    psxUniforms.uRain.value = rainNow;
    psxUniforms.uWet.value = wet;
    // (no rain round him under a roof: the tavern, a hall; world/tempest.ts indoors, set by main.ts)
    // (in a tavern: drawn out of its windows, not in the room: uRoom; in a hall with no box: none round him)
    const box = tempest.roomBox;
    if (box) U.uRoom.value.set(box.min.x, box.min.z, box.max.x, box.max.z);
    else U.uRoom.value.set(1, 1, 0, 0);
    const hide = tempest.indoors && !box;
    rain.visible = rainNow > 0.01 && !hide;
    rainSheets.visible = U.uTempest.value * rainNow > 0.02 && !hide;
    rainSheets.position.set(camPos.x, camPos.y, camPos.z);
    // a streak is one frame's fall: the frame's length, eased (a hitch does not stretch the rain)
    U.uExpo.value += (THREE.MathUtils.clamp(dt, 1 / 60, 1 / 24) - U.uExpo.value) * 0.1;
    const gusts = tempest.wind;
    if (gusts) {
      gusts.fronts(U.uGusts.value, U.uGustA0.value);
      U.uGustDir.value.set(gusts.dir.x, gusts.dir.y);
    }
    // puddles: rain fills them; fog and mist keep the big ones; a sunny day shrinks them, but an autumn sun never
    // dries the deepest hollows of the setts and ruts (picture round 2026-09-26: every made-over view had wet ground)
    const sunny = weather === "clear" && hourNow > 8 && hourNow < 18;
    const pudTarget = rainNow > 0.05 ? 0.7 : weather === "rain" || weather === "storm" ? 0.5 : weather === "fog" ? 0.34 : weather === "mist" ? 0.26 : sunny ? 0.1 : 0.12;
    pudBase += pudTarget > pudBase ? (pudTarget - pudBase) * Math.min(1, dt * 0.08) : Math.max(pudTarget - pudBase, -dt * 0.004);
    // the puddles are in the ground shader (retro/psx.ts option puddles)
    psxUniforms.uPuddle.value = Math.max(pudBase, wet * 0.75);

    // smoke and wind
    U.uSmoke.value = curve(SMOKE_BY_HOUR, hourNow) + (COLD[weather] ?? 0);
    // (M8f sync pass 3: by the clock every PC shares, as alive/wind.ts: the smoke leans the same way on every screen)
    const ts = sharedSeconds() % 1e6;
    const wa = 0.35 + Math.sin(ts * 0.013) * 0.25;
    // (the great storm: harder, and it swings with each gust at Jef: the rain lays over and straightens again)
    const ws = (WIND[weather] ?? 0.5) * (1 + 0.2 * Math.sin(ts * 0.07)) * (1 + 0.9 * U.uTempest.value) * (1 + 0.35 * tempest.gust * U.uTempest.value);
    U.uWind.value.set(Math.cos(wa) * ws, Math.sin(wa) * ws);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) fogCol.copy(fog.color);
    const day = 1 - night;
    // coal smoke: darker and browner than the sky by day, a shade lighter than the dark at night
    U.uSmokeCol.value.copy(fogCol).multiplyScalar(0.4 + 0.75 * night).add(smokeTint.setRGB(0.018, 0.015, 0.012).multiplyScalar(day));

    // window chunks: only near ones, only when it is dark
    const far = (fog?.far ?? 25) + 10;
    for (const c of winChunks) {
      const vis = night > 0.02 && c.centre.distanceTo(camPos) - c.radius < far;
      c.win.visible = vis;
    }

    updateBirds(t, Math.min(dt, 0.1), night);
  }

  return {
    update,
    chimneys: () => chimneyList,
    smokeLevel: () => U.uSmoke.value,
    setRain: (a) => {
      manualRain = THREE.MathUtils.clamp(a, 0, 1);
    },
    info: () => ({
      chimneys: chimneyCount,
      windows: windowCount,
      windowSpills: spillCount,
      windowsOnPlainWall: hiddenPanes,
      windowChunks: winChunks.length,
      birds: birds.length,
      birdsShown: birds.filter((b) => b.shown).length,
      rain: +rainNow.toFixed(3),
      wet: +wet.toFixed(3),
      night: +U.uNight.value.toFixed(3),
      smoke: +U.uSmoke.value.toFixed(3),
      hour: +hourNow.toFixed(2),
    }),
  };
}
