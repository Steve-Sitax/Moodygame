import * as THREE from "three";
import { MAX_SPILL, psxUniforms, spillGlsl } from "../retro/psx";

// Light that spills out of lit openings and flames onto the street (Steve, 2026-09-26: "light from some windows
// starts on the street only after the small sidewalk. It is very abrupt and not realistic"; "make it look better
// and the same everywhere, no matter where a light might go on").
//
// One system for all of it. Whatever glows at night registers a source here: the painted windows as the
// households light them (world/ambient.ts), the rooms that stand in the world through their cut windows and open
// doors (world/houseInWorld.ts: shops, taverns, homes), the halls' lit windows and doors (world/hallInWorld.ts),
// the gas lamps (world/gaslamps.ts, every lamp registered there, the quay's and any added later), the lanterns
// people carry (world/lanternLights.ts, every addLantern), and every other lantern, lit room window or fire drawn
// with a "glow" material (the scan below: the Madonnas' lanterns, the quay steps', the wall's, the prison's, the
// forges).
//
// The nearest MAX_SPILL sources (the brighter and the ones ahead count as nearer) are worked out per pixel in every
// lit psx material (retro/psx.ts spillGlsl): the ground of every kind at its own height (slabs, kerbs, setts,
// steps, the quay, mud), the walls and the people, by their normals. A window lights from its sill and sides down
// to the foot of its wall and out, bright under it and fading with distance and angle, and the room's lamp throws
// the window's shape with its bars as soft darker stripes further out. The rest get a cheap pool on the ground (one
// instanced decal, the same light for flat ground), laid at the highest ground under it (a pavement's top, never
// under it) and stopped where the ground drops away. A source moving between the two fades over half a second.
// No real three.js light is added: the light count never changes (docs/rendering.md).

export type SpillKind = "shop" | "tavern" | "room" | "upper" | "garret" | "door" | "hall" | "lamp" | "lantern" | "glow";

/** on, off, morning on, morning off; hours from noon (25 = 1:00 at night), as ambient.ts Lit. */
export type SpillSched = [number, number, number, number];

export interface SpillSource {
  kind: SpillKind;
  label: string;
  /** The middle of the opening (on the wall's face) or the flame. */
  x: number;
  y: number;
  z: number;
  /** The way out of the wall (unit, horizontal); 0, 0 for a lamp or lantern. */
  nx: number;
  nz: number;
  /** Half the opening's width and height (a flame: its size). */
  hw: number;
  hh: number;
  /** Linear colour. */
  color: THREE.Color;
  /** Brightness at full level (a gas lamp's point light is 26 with decay 1.7). */
  power: number;
  range: number;
  decay: number;
  /** How far behind the glass the room's lamp stands (0: no shape thrown). */
  depth: number;
  /** Softening near the opening (m^2). */
  soft: number;
  /** Panes: columns * 10 + rows (0: none). */
  bars: number;
  /** 0..1 now. The owner sets it, or the schedule does (`sched`, with the clock set by setSpillClock). */
  level: number;
  sched?: SpillSched;
  /** The ground under it (NaN: worked out from the world). */
  ground: number;
  /** Dev: what its glow shows now (the pane, the glass), 0..1. Defaults to `level`. */
  glow?: () => number;
  /** Dev: how much of its light a real three.js light gives now (a gas lamp or lantern near the eye), 0..1. */
  real?: () => number;
  /** It moves (a carried lantern): its ground pool is worked out again as it goes. */
  moving?: boolean;
  /** (the glow scan) a lamp registered elsewhere stands here: this one gives no light of its own */
  dup?: boolean;
  /** (the system's) weight among the per-pixel sources, 0..1; power now; the pool worked out */
  w: number;
  now: number;
  pool: Pool | null;
  score: number;
}

interface Pool {
  /** where it was worked out (a moving source) */
  x: number;
  z: number;
  /** the ground it is lit at, the height it is laid at */
  g: number;
  y: number;
  /** centre, the way it faces (out of the wall), its half width across and its reach out (or a disc's radius) */
  cx: number;
  cz: number;
  hw: number;
  near: number;
  far: number;
}

const sources = new Set<SpillSource>();
/** The graphics budget (setSpillBudget): how many sources are worked out per pixel, and the window bars in the pools. */
let budget = MAX_SPILL;
let barsOn = true;
/** Dev (a picture without it, its cost): false draws no spilt light at all. */
let spillOn = true;

/**
 * The settings' knob for the light that spills (a graphics preset): `perPixel` sources worked out per pixel on the
 * ground, the walls and the people (0 .. MAX_SPILL; the rest light the ground as cheap pools), and whether the
 * windows' bars show in their light. Low about 8, medium 16, high MAX_SPILL (the default). Below 0 (dev): none at all,
 * not even the pools.
 */
export function setSpillBudget(perPixel: number, bars = true): void {
  spillOn = perPixel >= 0;
  budget = Math.max(0, Math.min(MAX_SPILL, Math.round(perPixel)));
  barsOn = bars;
}

export function spillBudget(): { perPixel: number; bars: boolean; max: number; on: boolean } {
  return { perPixel: budget, bars: barsOn, max: MAX_SPILL, on: spillOn };
}

let clockH = 12;
let clockNight = 0;

/** The clock the scheduled sources (the painted windows) follow: hour from noon (ambient.ts uHourN) and the dark. */
export function setSpillClock(hourN: number, night: number): void {
  clockH = hourN;
  clockNight = night;
}

type SpillInit = Partial<SpillSource> & Pick<SpillSource, "kind" | "x" | "y" | "z">;

/** Kinds as the eye knows them: how bright, how far, what colour (gas amber, oil and candle orange). */
// window, door and hall strengths x1.6 after Steve's first look (2026-09-26: the pool under a window read too faint)
const KIND: Record<SpillKind, { power: number; range: number; decay: number; depth: number; soft: number; color: number }> = {
  shop: { power: 200, range: 10, decay: 2, depth: 2.4, soft: 0.8, color: 0xffb466 },
  tavern: { power: 184, range: 10, decay: 2, depth: 2.6, soft: 0.8, color: 0xffa050 },
  room: { power: 93, range: 8, decay: 2, depth: 2.2, soft: 0.7, color: 0xff8a3c },
  upper: { power: 35, range: 9, decay: 2, depth: 2.2, soft: 0.6, color: 0xff8a3c },
  garret: { power: 18, range: 6, decay: 2, depth: 1.6, soft: 0.5, color: 0xff7a30 },
  door: { power: 128, range: 9, decay: 2, depth: 3, soft: 0.8, color: 0xffa050 },
  hall: { power: 136, range: 14, decay: 2, depth: 4, soft: 0.9, color: 0xffa858 },
  lamp: { power: 26, range: 18, decay: 1.7, depth: 0, soft: 0, color: 0xffa048 },
  lantern: { power: 3.6, range: 10, decay: 1.25, depth: 0, soft: 0, color: 0xffa048 },
  glow: { power: 2.4, range: 7, decay: 1.5, depth: 0, soft: 0.05, color: 0xff9a44 },
};

/** Register a source; it lights the world until removeSpill. Missing fields come from its kind. */
export function addSpill(init: SpillInit): SpillSource {
  const k = KIND[init.kind];
  const s: SpillSource = {
    label: init.kind,
    nx: 0,
    nz: 0,
    hw: 0.1,
    hh: 0.1,
    color: new THREE.Color(k.color),
    power: k.power,
    range: k.range,
    decay: k.decay,
    depth: k.depth,
    soft: k.soft,
    bars: 0,
    level: 0,
    ground: NaN,
    ...init,
    w: 0,
    now: 0,
    pool: null,
    score: 0,
  };
  sources.add(s);
  return s;
}

export function removeSpill(s: SpillSource | null | undefined): void {
  if (s) sources.delete(s);
}

function smooth(x: number, e0: number, e1: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** A schedule's level now (ambient.ts litNow, the same sums). */
function schedLevel(l: SpillSched): number {
  const h = clockH;
  const eve = smooth(h, l[0], l[0] + 0.12) * (1 - smooth(h, l[1], l[1] + 0.12));
  const morn = smooth(h, l[2], l[2] + 0.12) * (1 - smooth(h, l[3], l[3] + 0.12));
  return Math.max(eve, morn) * clockNight;
}

function levelOf(s: SpillSource): number {
  return s.sched ? schedLevel(s.sched) : Math.max(0, Math.min(1, s.level));
}

/**
 * The light one source gives a point (x, y, z) with normal (nx, ny, nz): retro/psx.ts spillOne in TypeScript, for the
 * dev check (where a pool starts) only.
 */
function spillAt(s: SpillSource, power: number, x: number, y: number, z: number, Nx: number, Ny: number, Nz: number): number {
  const dx = x - s.x;
  const dy = y - s.y;
  const dz = z - s.z;
  const dd = dx * dx + dy * dy + dz * dz;
  const r2 = s.range * s.range;
  if (dd >= r2) return 0;
  const q = dd / r2;
  const fade = (1 - q * q) ** 2;
  if (s.nx * s.nx + s.nz * s.nz < 0.01) {
    const dl = Math.sqrt(dd);
    const cr = Math.max(-(Nx * dx + Ny * dy + Nz * dz) / Math.max(dl, 1e-4), 0);
    return (power * cr * fade) / (Math.max(dl, 0.05) ** s.decay + s.soft);
  }
  const o = dx * s.nx + dz * s.nz;
  if (o < -0.08) return 0;
  const ux = -s.nz;
  const uz = s.nx;
  const sa = dx * ux + dz * uz;
  const ex = Math.max(-s.hw, Math.min(s.hw, sa));
  const ey = Math.max(-s.hh, Math.min(s.hh, dy));
  let L1x = ux * ex - dx;
  let L1y = ey - dy;
  let L1z = uz * ex - dz;
  const l1 = Math.hypot(L1x, L1y, L1z);
  L1x /= Math.max(l1, 1e-4);
  L1y /= Math.max(l1, 1e-4);
  L1z /= Math.max(l1, 1e-4);
  const l2 = Math.sqrt(dd);
  const L2x = -dx / Math.max(l2, 1e-4);
  const L2y = -dy / Math.max(l2, 1e-4);
  const L2z = -dz / Math.max(l2, 1e-4);
  const under = 0.45 * Math.max(0, Math.min(1, Ny)) * (1 - smooth(Math.abs(sa), s.hw, s.hw + 0.6 + 0.5 * Math.max(o, 0)));
  const lobe = (under + (1 - under) * Math.max(-(L1x * s.nx + L1z * s.nz), 0)) * smooth(o, -0.08, 0.1);
  const cr = 0.5 * (Math.max(Nx * L1x + Ny * L1y + Nz * L1z, 0) + Math.max(Nx * L2x + Ny * L2y + Nz * L2z, 0));
  const fall = 0.5 * (1 / ((l1 * l1) ** (s.decay * 0.5) + s.soft) + 1 / ((l2 * l2) ** (s.decay * 0.5) + s.soft));
  let pat = 1;
  if (s.depth > 0) {
    const lx = -s.nx * s.depth;
    const ly = s.hh * 0.35;
    const lz = -s.nz * s.depth;
    const k = s.depth / Math.max(s.depth + o, 0.05);
    const wx = lx + (dx - lx) * k;
    const wy = ly + (dy - ly) * k;
    const wz = lz + (dz - lz) * k;
    const ws = (wx * ux + wz * uz) / s.hw;
    const wt = wy / s.hh;
    const sw = 0.1 + 0.08 * Math.max(o, 0);
    const m = (1 - smooth(Math.abs(ws), 1 - sw, 1 + sw)) * (1 - smooth(Math.abs(wt), 1 - sw, 1 + sw));
    pat = 0.5 + 0.5 * m;
  }
  return power * lobe * cr * fall * fade * pat;
}

export interface SpillRow {
  label: string;
  kind: SpillKind;
  at: [number, number, number];
  /** the way out of its wall (an opening) */
  n?: [number, number];
  d: number;
  level: number;
  glow: number;
  /** per pixel (weight), as a ground pool, or not at all */
  spills: "pixel" | "pool" | "both" | "light" | "no";
  /** the light at the wall's foot against the brightest on the ground before it (openings) */
  foot: number | null;
  problems: string[];
}

export interface Spill {
  /**
   * Once a frame, after the owners have set their levels (gas lamps, lanterns, rooms). `snap`: the weights jump to
   * where they are going (a picture from another place).
   */
  update(dt: number, camera: THREE.Camera, snap?: boolean): void;
  info(): { sources: number; lit: number; pixel: number; pools: number; ms: number; kinds: Record<string, number> };
  /** Dev (__scheldemist.spill()): every lit source in view range, whether it spills and glows; `problems` must be empty. */
  check(camera: THREE.Camera, all?: boolean): { view: number; lit: number; rows: SpillRow[]; problems: string[] };
  /** The glow scan: meshes drawn with a glow material become sources (runs itself every 2 s). */
  scan(): number;
}

/** How many ground pools at most (the sources past the per-pixel ones). */
const MAX_POOLS = 1024;
/** New ground pools worked out at most this many a frame (each asks the ground a few dozen times). */
const NEW_POOLS = 48;
/** A source this far from the eye must light per pixel if it lights no ground (a window high up: its light is on the walls). */
const NEAR_WALLS = 18;
/** A source joins or leaves the per-pixel ones in about half a second. */
const FADE = 2.2;
/** The sources are ranked again this often (s), or at once when the eye moves 2 m or turns. */
const RANK_DT = 0.1;
/**
 * The pools stand in for flat ground of this colour (the per-pixel light is times the stone's own): the town's
 * setts, flags and mud under their grime come to about this at night (matched by eye, foot133 at 20:10, 2026-09-26).
 */
const POOL_ALBEDO = 0.07;

/**
 * `walkGround`: the walk's ground (world.groundAt: it answers only within a step or two of the feet asked with, and
 * not where the walk map stops short of a wall: below -5 then); `base`: the street's own level there (the water: a drop).
 */
export function createSpill(scene: THREE.Scene, walkGround: (x: number, z: number, feet: number) => number, base: (x: number, z: number) => number): Spill {
  const groundAt = (x: number, z: number, feet: number) => {
    const h = walkGround(x, z, feet);
    return h > -5 ? h : base(x, z);
  };
  // ---- the per-pixel slots
  interface Slot {
    src: SpillSource | null;
    w: number;
  }
  const slots: Slot[] = Array.from({ length: MAX_SPILL }, () => ({ src: null, w: 0 }));

  // ---- the ground pools: one instanced decal, the same light as the per-pixel one on flat ground
  const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const attr = (n: number) => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  const aA = attr(4);
  const aB = attr(4);
  const aC = attr(4);
  const aD = attr(4);
  const aG = attr(1);
  geo.setAttribute("aA", aA);
  geo.setAttribute("aB", aB);
  geo.setAttribute("aC", aC);
  geo.setAttribute("aD", aD);
  geo.setAttribute("aG", aG);
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uAlbedo: { value: POOL_ALBEDO } },
    vertexShader: /* glsl */ `
      attribute vec4 aA;
      attribute vec4 aB;
      attribute vec4 aC;
      attribute vec4 aD;
      attribute float aG;
      varying vec4 vA;
      varying vec4 vB;
      varying vec4 vC;
      varying vec4 vD;
      varying vec3 vP;
      varying vec2 vQ;
      varying float vFogDepth;
      void main() {
        vQ = uv * 2.0 - 1.0;
        vA = aA;
        vB = aB;
        vC = aC;
        vD = aD;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        // lit as the ground it stands for (the source's own ground), laid at the highest ground under it
        vP = vec3(wp.x, aG, wp.z);
        vec4 mv = viewMatrix * wp;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uAlbedo;
      uniform float fogNear;
      uniform float fogFar;
      varying vec4 vA;
      varying vec4 vB;
      varying vec4 vC;
      varying vec4 vD;
      varying vec3 vP;
      varying vec2 vQ;
      varying float vFogDepth;
      ${spillGlsl}
      void main() {
        vec3 E = spillOne(vP, vec3(0.0, 1.0, 0.0), vA, vB, vC, vD);
        // (no edge where the quad ends: the light is let go before it)
        float edge = (1.0 - smoothstep(0.7, 1.0, abs(vQ.x))) * (1.0 - smoothstep(0.75, 1.0, -vQ.y)); // (uv.y 0: the far end)
        if (dot(vB.xy, vB.xy) < 0.01) edge = 1.0 - smoothstep(0.7, 1.0, length(vQ));
        float fog = smoothstep(fogNear, fogFar, vFogDepth);
        gl_FragColor = vec4(E * edge * uAlbedo * 0.3183 * (1.0 - fog), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const pools = new THREE.InstancedMesh(geo, poolMat, MAX_POOLS);
  pools.name = "spill_ground_pools";
  pools.count = 0;
  pools.frustumCulled = false;
  pools.renderOrder = 2;
  scene.add(pools);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pv = new THREE.Vector3();
  const sv = new THREE.Vector3();

  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  const ranked: SpillSource[] = [];
  /** what the last ranking chose: the per-pixel ones, then the ones whose light reaches the ground (the pools) */
  const active: SpillSource[] = [];
  /** the pools laid out at the last ranking, in their instance order */
  const poolList: SpillSource[] = [];
  const want = new Set<SpillSource>();
  const rankEye = new THREE.Vector3(Infinity, 0, 0);
  const rankLook = new THREE.Vector3();
  let rankT = 0;
  let litN = 0;
  /** this frame's counts, and the CPU time of an update (ms, eased) */
  let stats = { lit: 0, pixel: 0, pools: 0, ms: 0 };
  const inPool = new Set<SpillSource>();

  /** The ground a source stands on (worked out once for a still one). */
  function groundOf(s: SpillSource): number {
    if (Number.isFinite(s.ground)) return s.ground;
    const open = s.nx * s.nx + s.nz * s.nz > 0.01;
    // an opening: the ground just before its wall, no higher than its sill; a flame: under it (the walk's
    // ground answers only within a step or two of the feet asked with: step down until it does)
    const top = open ? s.y - s.hh + 0.05 : s.y - 0.3;
    const x = s.x + s.nx * 0.35;
    const z = s.z + s.nz * 0.35;
    let g = NaN;
    for (let feet = top; feet > top - 12 && Number.isNaN(g); feet -= 0.5) {
      const h = walkGround(x, z, feet);
      if (h > -5 && h <= top + 0.3) g = h;
    }
    if (Number.isNaN(g)) g = Math.min(base(x, z), top);
    if (!s.moving) s.ground = g;
    return g;
  }

  /** Does its light reach the ground (a window high up lights the walls across, not the street)? */
  function reachesGround(s: SpillSource): boolean {
    return s.y - s.hh - groundOf(s) < s.range * 0.7;
  }

  /** Where a source's ground pool lies: never under a pavement's top, never over a drop. */
  /** Is its pool worked out and still good (a moving source: within 0.75 m of where it was)? */
  function poolReady(s: SpillSource): boolean {
    const p = s.pool;
    return !!p && (!s.moving || Math.abs(p.x - s.x) + Math.abs(p.z - s.z) < 0.75);
  }

  function poolOf(s: SpillSource): Pool {
    const p = s.pool;
    if (p && poolReady(s)) return p;
    const g = groundOf(s);
    const at = (x: number, z: number) => groundAt(x, z, g + 0.4);
    // (the highest ground within a kerb's step of the source's, so the pool lies on a pavement's top)
    let top = g;
    const onLevel = (x: number, z: number) => {
      const h = at(x, z);
      if (h > g + 0.35 || h < g - 0.35) return false;
      top = Math.max(top, h);
      return true;
    };
    let pool: Pool;
    if (s.nx * s.nx + s.nz * s.nz > 0.01) {
      // an opening: a strip before the wall, as wide as the light's lobe, out to where the ground drops away
      const ux = -s.nz;
      const uz = s.nx;
      const reach = Math.min(s.range, 8);
      let far = reach;
      for (const d of [0.4, 1, 2, 3, 4.5, 6, 8]) {
        if (d > reach) break;
        let ok = true;
        for (const a of [-1, 0, 1]) ok = onLevel(s.x + s.nx * d + ux * a * (s.hw + d * 0.5), s.z + s.nz * d + uz * a * (s.hw + d * 0.5)) && ok;
        if (!ok) {
          far = Math.max(0.4, d - 0.4);
          break;
        }
      }
      const hw = s.hw + Math.min(far * 0.8, 5);
      pool = { x: s.x, z: s.z, g, y: top + 0.03, cx: s.x, cz: s.z, hw, near: -0.12, far };
    } else {
      // a flame: a disc, shifted away from a drop so it stays on the flat (gaslamps.ts had it so)
      const R = Math.min(s.range * 0.55, 8);
      const N = 16;
      let dx = 0;
      let dz = 0;
      let rMin = R;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        let r = R;
        for (const d of [1, 2, 3, 4.5, 6, R]) {
          if (d > R) break;
          if (!onLevel(s.x + Math.cos(a) * d, s.z + Math.sin(a) * d)) {
            r = Math.max(0, d - 0.6);
            break;
          }
        }
        rMin = Math.min(rMin, r);
        dx += Math.cos(a) * (R - r);
        dz += Math.sin(a) * (R - r);
      }
      let best = { cx: s.x, cz: s.z, r: rMin };
      const dl = Math.hypot(dx, dz);
      if (!s.moving && rMin < R && dl > 0) {
        const ux = -dx / dl;
        const uz = -dz / dl;
        for (const sh of [0.5, 1, 1.5, 2, 3, 4]) {
          for (let rr = R; rr > best.r; rr -= 0.5) {
            const cx = s.x + ux * sh;
            const cz = s.z + uz * sh;
            let ok = onLevel(cx, cz);
            for (let i = 0; i < N && ok; i++) {
              const a = (i / N) * Math.PI * 2;
              ok = onLevel(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) && onLevel(cx + Math.cos(a) * rr * 0.55, cz + Math.sin(a) * rr * 0.55);
            }
            if (ok) {
              if (rr > best.r) best = { cx, cz, r: rr };
              break;
            }
          }
        }
      }
      pool = { x: s.x, z: s.z, g, y: top + 0.03, cx: best.cx, cz: best.cz, hw: best.r, near: best.r, far: best.r };
    }
    s.pool = pool;
    return pool;
  }

  /** A pool's quad and its light: across the opening's wall and out from it, or a disc round a flame. */
  function placePool(k: number, s: SpillSource, p: Pool, pw: number): void {
    if (s.nx * s.nx + s.nz * s.nz > 0.01) {
      const mid = (p.near + p.far) / 2;
      pv.set(s.x + s.nx * mid, p.y, s.z + s.nz * mid);
      q.setFromAxisAngle(up, Math.atan2(s.nx, s.nz));
      sv.set(p.hw * 2, 1, p.far - p.near);
    } else {
      pv.set(p.cx, p.y, p.cz);
      q.identity();
      sv.set(p.hw * 2, 1, p.hw * 2);
    }
    m4.compose(pv, q, sv);
    pools.setMatrixAt(k, m4);
    aA.setXYZW(k, s.x, s.y, s.z, pw);
    aG.setX(k, p.g);
  }

  function upload(a: THREE.InstancedBufferAttribute, k: number): void {
    a.clearUpdateRanges();
    a.addUpdateRange(0, Math.max(1, k) * a.itemSize);
    a.needsUpdate = true;
  }

  function assign(want: Set<SpillSource>, dt: number, snap: boolean): void {
    for (const sl of slots) {
      if (!sl.src) continue;
      if (want.has(sl.src) && sources.has(sl.src)) sl.w = snap ? 1 : Math.min(1, sl.w + dt * FADE);
      else {
        sl.w = snap ? 0 : Math.max(0, sl.w - dt * FADE);
        if (sl.w <= 0 || !sources.has(sl.src)) {
          sl.src.w = 0;
          sl.src = null;
        }
      }
      if (sl.src) sl.src.w = sl.w;
    }
    for (const s of want) {
      if (!sources.has(s) || slots.some((sl) => sl.src === s)) continue;
      const free = slots.find((sl) => !sl.src);
      if (free) {
        free.src = s;
        free.w = snap ? 1 : 0;
        s.w = free.w;
      }
    }
  }

  // ---- the glow scan: meshes drawn with a "glow" material (lanterns, lit rooms, fires) become sources
  const scanned = new Map<THREE.BufferGeometry, SpillSource[]>();
  const glowMats = new Set<THREE.MeshBasicMaterial>();
  const colorLevel = (m: THREE.MeshBasicMaterial) => {
    const c = m.color;
    const v = Math.max(c.r, c.g, c.b) * (m.transparent ? m.opacity : 1) * (m.visible ? 1 : 0);
    return smooth(v, 0.3, 0.85);
  };
  function scan(): number {
    let added = 0;
    // (the matrices as the last frame drew them: glow things stand still)
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      const mat = mesh.material as THREE.MeshBasicMaterial;
      if (Array.isArray(mat) || !(mat as THREE.Material).isMaterial || mat.type !== "MeshBasicMaterial") return;
      const name = `${mat.name}|${mesh.name}`;
      if (!/(^|_)(glow|fire)(\||_|$)/.test(mat.name) && !mesh.userData.spillGlow) return;
      if (/house_glow_|_lit_windows/.test(name)) return; // the rooms and halls register their own
      const g = mesh.geometry;
      if (scanned.has(g)) return;
      const P = g.getAttribute("position");
      if (!P || P.count > 20000) return;
      // the pieces of a merged mesh: points within 0.45 m of each other are one lantern, one window, one fire
      const idx = g.index;
      const tris = idx ? idx.count / 3 : P.count / 3;
      const parent = new Int32Array(P.count).map((_, i) => i);
      const find = (i: number): number => {
        while (parent[i] !== i) i = parent[i] = parent[parent[i]];
        return i;
      };
      const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
      for (let t = 0; t < tris; t++) {
        const a = find(vi(t, 0));
        for (const k of [1, 2]) {
          const b = find(vi(t, k));
          if (a !== b) parent[b] = a;
        }
      }
      const v = new THREE.Vector3();
      const boxes = new Map<number, THREE.Box3>();
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(mesh.matrixWorld);
        const r = find(i);
        let b = boxes.get(r);
        if (!b) boxes.set(r, (b = new THREE.Box3()));
        b.expandByPoint(v);
      }
      // join the parts that touch (a lantern's four panes)
      const list = [...boxes.values()];
      const merged: THREE.Box3[] = [];
      for (const b of list) {
        const hit = merged.find((m) => m.distanceToPoint(b.getCenter(v)) < 0.45);
        if (hit) hit.union(b);
        else merged.push(b.clone());
      }
      const out: SpillSource[] = [];
      const fire = /fire/.test(mat.name);
      for (const b of merged) {
        const size = b.getSize(new THREE.Vector3());
        if (size.x > 12 || size.z > 12) continue;
        const c = b.getCenter(new THREE.Vector3());
        const big = Math.max(size.x, size.z, size.y) > 0.9;
        const s = addSpill({
          kind: "glow",
          label: `${mat.name || mesh.name} glow`,
          x: c.x,
          y: c.y,
          z: c.z,
          hw: Math.max(size.x, size.z) / 2,
          hh: size.y / 2,
          power: fire ? 4 : big ? 3.2 : 2.2,
          range: fire ? 8 : big ? 8 : 7,
          color: new THREE.Color(fire ? 0xff7a2c : 0xff9a44),
        });
        const m = mat;
        s.glow = () => colorLevel(m);
        out.push(s);
        added++;
      }
      glowMats.add(mat);
      scanned.set(g, out);
      g.addEventListener("dispose", () => {
        for (const s of scanned.get(g) ?? []) removeSpill(s);
        scanned.delete(g);
      });
    });
    // a glow that is the glass of a lamp registered by its owner (the wall's lanterns are gas lamps, rampart.ts)
    const lamps = [...sources].filter((s) => s.kind === "lamp" || s.kind === "lantern");
    for (const list of scanned.values())
      for (const s of list) s.dup = lamps.some((l) => Math.abs(l.x - s.x) < 0.8 && Math.abs(l.z - s.z) < 0.8 && Math.abs(l.y - s.y) < 1.2);
    return added;
  }
  let scanT = 1;
  let scanAge = 0;
  /** the dark as the glow sources see it (they glow by day too; they spill only at night) */
  let dark = 0;

  return {
    update(dt, camera, snap = false) {
      const t0 = performance.now();
      // new glow things are looked for every 2 s while the town comes in, then every 8 s
      scanT -= dt;
      scanAge += dt;
      if (scanT <= 0) {
        scanT = scanAge < 40 ? 2 : 8;
        scan();
      }
      dark = clockNight;
      camera.getWorldPosition(eye);
      camera.getWorldDirection(look);
      const nowOf = (s: SpillSource) => {
        const level = s.kind === "glow" ? (s.dup ? 0 : (s.glow?.() ?? 0) * dark) : levelOf(s);
        s.now = s.power * level;
        return s.now;
      };
      // the ranking, ten times a second (or at once when the eye jumps or turns): every source; between, only
      // the ones it chose follow their levels and places
      rankT -= dt;
      const ranking = snap || rankT <= 0 || eye.distanceToSquared(rankEye) > 4 || look.dot(rankLook) < 0.97;
      if (ranking) {
        rankT = RANK_DT;
        rankEye.copy(eye);
        rankLook.copy(look);
        const fog = scene.fog as THREE.Fog | null;
        const view = Math.min(170, (fog?.far ?? 150) + 12);
        ranked.length = 0;
        let lit = 0;
        for (const s of sources) {
          const dx = s.x - eye.x;
          const dy = s.y - eye.y;
          const dz = s.z - eye.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d - s.range > view) {
            s.now = 0;
            continue;
          }
          if (nowOf(s) < 0.02) continue;
          lit++;
          const ahead = (dx * look.x + dz * look.z) / Math.max(Math.hypot(dx, dz), 0.01);
          // the nearer, the brighter and the ones ahead first; one already lit keeps its place unless another is clearly nearer
          let score = (Math.max(0, d - s.range * 0.25) * (ahead > -0.3 ? 1 : 1.6)) / Math.min(1.6, Math.max(0.55, Math.sqrt(s.now / 4)));
          if (s.w > 0) score -= 2.5;
          s.score = score;
          ranked.push(s);
        }
        ranked.sort((a, b) => a.score - b.score);
        want.clear();
        active.length = 0;
        for (const s of ranked) {
          if (want.size < budget) {
            want.add(s);
            active.push(s);
          } else if (active.length < MAX_POOLS + MAX_SPILL && reachesGround(s)) active.push(s);
        }
        litN = lit;
      } else for (const s of active) nowOf(s);
      assign(want, dt, snap);

      // the per-pixel list: the active slots first, then an empty one ends it
      const A = psxUniforms.uSpillA.value;
      const B = psxUniforms.uSpillB.value;
      const C = psxUniforms.uSpillC.value;
      const D = psxUniforms.uSpillD.value;
      let n = 0;
      for (const sl of slots) {
        const s = sl.src;
        if (!s || sl.w <= 0 || s.now <= 0) continue;
        A[n].set(s.x, s.y, s.z, s.now * sl.w);
        B[n].set(s.nx, s.nz, s.hw, s.hh);
        C[n].set(s.color.r, s.color.g, s.color.b, barsOn ? s.bars : 0);
        D[n].set(s.range, s.decay, s.depth, s.soft);
        n++;
      }
      for (let i = n; i < MAX_SPILL; i++) A[i].w = 0;

      // the ground pools: what the per-pixel light does not give (or only part-way, while it fades). Laid out again
      // with each ranking; between, only their light (and a moving lantern's place) is written.
      let k = poolList.length;
      if (ranking || !spillOn) {
        let fresh = 0;
        k = 0;
        poolList.length = 0;
        inPool.clear();
        for (const s of active) {
          if (k >= MAX_POOLS || !spillOn) break;
          if (!sources.has(s)) continue;
          const pw = s.now * (1 - s.w);
          // (a per-pixel one fading out gets its pool now: it may be wanted before the next ranking)
          if (pw < 0.02 && !(s.w > 0 && !want.has(s))) continue;
          if (!poolReady(s)) {
            if (fresh >= NEW_POOLS && !snap) continue;
            fresh++;
          }
          if (!reachesGround(s)) continue;
          const p = poolOf(s);
          if (p.far < 0.3) continue;
          placePool(k, s, p, pw);
          aB.setXYZW(k, s.nx, s.nz, s.hw, s.hh);
          aC.setXYZW(k, s.color.r, s.color.g, s.color.b, barsOn ? s.bars : 0);
          aD.setXYZW(k, s.range, s.decay, s.depth, s.soft);
          poolList.push(s);
          inPool.add(s);
          k++;
        }
        for (const a of [aB, aC, aD]) upload(a, k);
      } else {
        for (let i = 0; i < k; i++) {
          const s = poolList[i];
          const pw = sources.has(s) ? s.now * (1 - s.w) : 0;
          if (s.moving && s.pool) placePool(i, s, poolOf(s), pw);
          else aA.setW(i, pw);
        }
      }
      pools.count = k;
      pools.visible = k > 0;
      if (k) {
        // (only the part in use goes to the GPU)
        pools.instanceMatrix.clearUpdateRanges();
        pools.instanceMatrix.addUpdateRange(0, k * 16);
        pools.instanceMatrix.needsUpdate = true;
        upload(aA, k);
        upload(aG, k);
      }
      stats = { lit: litN, pixel: n, pools: k, ms: +(stats.ms * 0.9 + (performance.now() - t0) * 0.1).toFixed(3) };
    },
    info() {
      const kinds: Record<string, number> = {};
      for (const s of sources) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
      return { sources: sources.size, ...stats, kinds };
    },
    scan,
    check(camera, all = false) {
      // (as things stand now: every owner's level of the last frame, every pool worked out)
      this.update(0, camera, true);
      camera.getWorldPosition(eye);
      const fog = scene.fog as THREE.Fog | null;
      const view = Math.min(120, (fog?.far ?? 120) + 5);
      const rows: SpillRow[] = [];
      const problems: string[] = [];
      let lit = 0;
      for (const s of sources) {
        if (s.dup) continue;
        const level = s.kind === "glow" ? (s.glow?.() ?? 0) * dark : levelOf(s);
        const glow = s.kind === "glow" ? level : s.glow ? s.glow() : level;
        const now = s.power * level;
        const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
        if (d > view || (now < 0.02 && glow < 0.02 && !((s.real?.() ?? 0) > 0))) continue;
        lit++;
        const px = s.w > 0.05;
        const pl = inPool.has(s);
        const real = s.real?.() ?? 0;
        const spills: SpillRow["spills"] = px && pl ? "both" : px ? "pixel" : pl ? "pool" : real > 0.5 ? "light" : "no";
        const pr: string[] = [];
        const mustLight = reachesGround(s) || d < NEAR_WALLS;
        // (a source fading in or out may be a frame apart from its glow: only a clear mismatch counts)
        if (glow > 0.1 && now >= 0.02 && spills === "no" && mustLight) pr.push("glows but throws no light (over the budget?)");
        if (glow > 0.1 && level < 0.03 && real <= 0.5) pr.push("glows but throws no light (no power)");
        if (level > 0.1 && glow < 0.03) pr.push("throws light but does not glow");
        let foot: number | null = null;
        if (s.nx * s.nx + s.nz * s.nz > 0.01 && now >= 0.02) {
          // the light on the ground at the wall's foot against the brightest before it
          const g = groundOf(s);
          const at = (o: number) => spillAt(s, now, s.x + s.nx * o, g, s.z + s.nz * o, 0, 1, 0);
          let best = 0;
          for (let o = 0.2; o <= Math.min(6, s.range); o += 0.2) best = Math.max(best, at(o));
          foot = best > 1e-3 ? +(at(0.12) / best).toFixed(2) : null;
          if (foot !== null && foot < 0.3) pr.push(`its pool starts away from its wall (the foot has ${Math.round(foot * 100)}% of the brightest)`);
          if (pl) {
            const p = poolOf(s);
            if (p.near > 0) pr.push(`its ground pool starts ${p.near.toFixed(2)} m out`);
            const foot0 = groundAt(s.x + s.nx * 0.3, s.z + s.nz * 0.3, g + 0.4);
            if (p.y < foot0 - 0.005 && foot0 - g < 0.35) pr.push(`its ground pool lies under the ground at its foot (${p.y.toFixed(2)} < ${foot0.toFixed(2)})`);
          }
        }
        for (const p of pr) problems.push(`${s.label} at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}): ${p}`);
        if (all || pr.length || rows.length < 60)
          rows.push({ label: s.label, kind: s.kind, at: [+s.x.toFixed(1), +s.y.toFixed(2), +s.z.toFixed(1)], ...(s.nx || s.nz ? { n: [+s.nx.toFixed(2), +s.nz.toFixed(2)] as [number, number] } : {}), d: +d.toFixed(1), level: +level.toFixed(2), glow: +glow.toFixed(2), spills, foot, problems: pr });
      }
      rows.sort((a, b) => a.d - b.d);
      return { view, lit, rows, problems };
    },
  };
}
