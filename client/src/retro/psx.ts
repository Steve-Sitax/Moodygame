import * as THREE from "three";

// PS1-style material patch: vertex snap, affine texture warp, and fog that
// picks up warm light from the gas lamps (analytic in-scatter per lamp).
// Numbers here are look settings from docs/05-art-direction.md.

export const MAX_LAMPS = 6;

/**
 * Light that spills out of lit windows, open doors, lamps and lanterns (world/spill.ts): the nearest MAX_SPILL
 * sources are worked out in every lit psx material (ground of every kind, walls, people), the rest are cheap pools
 * on the ground (spill.ts). Each source is four vec4s, the active ones first (power 0 ends the list):
 *   A: centre of the opening or the flame (world), power (already times its level)
 *   B: the way out of the wall (x, z; 0, 0 for a lamp or lantern), half width, half height of the opening
 *   C: colour (linear), bars (columns * 10 + rows of panes; 0 none)
 *   D: range (m), decay, depth of the lamp behind the glass (m), softening (m^2)
 */
export const MAX_SPILL = 48;

export const psxUniforms = {
  uSnapRes: { value: new THREE.Vector2(240, 135) },
  uTime: { value: 0 },
  // xyz = lamp position, w = current brightness (flicker)
  uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uLampColor: { value: new THREE.Color(1.0, 0.62, 0.28) },
  uScatter: { value: 0.55 },
  /** Wet ground (rain), 0..1: only on materials made with psx(mat, { wet: true }). */
  uWet: { value: 0 },
  /** Rain on the water, 0..1: rings on the water material (psx(mat, { water: true })). */
  uRain: { value: 0 },
  /** Distance from the water to the nearest quay wall, R = 0..8 m (world/quaysteps.ts shoreTexture): foam at the walls. */
  uShore: { value: farShore() as THREE.Texture },
  /** Where uShore lies: x0, z0, width, depth (metres). */
  uShoreBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** M3j (world/litter.ts): how foul the water is, R 0..1 (the vlieten, the canal, the walls by the fish market), and where: x0, z0, w, h. */
  uFoul: { value: noFoul() as THREE.Texture },
  uFoulBox: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** The river's own planar mirror (world/mirror.ts, set in rijnkaai.ts): picture, world -> picture, 0 = none yet. */
  uWaterMirror: { value: farShore() as THREE.Texture },
  uWaterMirrorMat: { value: new THREE.Matrix4() },
  uWaterMirrorOn: { value: 0 },
  /** Grime and mud on the paving, 1 px per metre (world/dirt.ts), and where it lies: x0, z0, w, h. */
  uDirt: { value: null as THREE.Texture | null },
  uDirtBox: { value: new THREE.Vector4(-348, -80, 556, 388) }, // world/dirt.ts sets it from world/townBox.ts
  /** Sea state: 1 = the river's usual chop, about 3.5 = a storm (world/rijnkaai.ts eases it by weather). */
  uSea: { value: 1 },
  /** Puddles on the ground, 0..1 (world/ambient.ts: rain fills them, a sunny day dries them). */
  uPuddle: { value: 0 },
  /** The ground mirror (world/mirror.ts): the street seen from under the paving. */
  uMirror: { value: null as THREE.Texture | null },
  uMirrorMat: { value: new THREE.Matrix4() },
  /** Where water lies: a soft tiling noise (low spots fill first). */
  uPudNoise: { value: null as THREE.Texture | null },
  /** The spill sources (world/spill.ts; see MAX_SPILL). */
  uSpillA: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uSpillB: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector4()) },
  uSpillC: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector4()) },
  uSpillD: { value: Array.from({ length: MAX_SPILL }, () => new THREE.Vector4(1, 2, 0, 1)) },
};

/**
 * The light one spill source gives a point P with normal N (irradiance, three.js units: a lamp of power I and decay
 * k gives I cos / d^k, as its point light would). A window or door is an opening with a soft lobe out of the wall:
 * lit from its nearest point and its middle (bright right under and before it, from the wall's foot on, fading
 * with distance and angle), and the room's lamp behind the glass throws the window's shape with its bars as softer,
 * darker stripes further out. Shared by the psx materials and the far pools (world/spill.ts).
 */
export const spillGlsl = /* glsl */ `
vec3 spillOne(vec3 P, vec3 N, vec4 A, vec4 B, vec4 C, vec4 D) {
  vec3 d = P - A.xyz;
  float dd = dot(d, d);
  float r2 = D.x * D.x;
  if (dd >= r2) return vec3(0.0);
  float q = dd / r2;
  float fade = (1.0 - q * q);
  fade *= fade;
  vec3 n = vec3(B.x, 0.0, B.y);
  if (dot(n, n) < 0.01) {
    // a lamp or a lantern: a point light
    float dl = sqrt(dd);
    float cr = max(dot(N, -d / max(dl, 1e-4)), 0.0);
    return C.rgb * (A.w * cr * fade / (pow(max(dl, 0.05), D.y) + D.w));
  }
  float o = dot(d, n);
  if (o < -0.08) return vec3(0.0);
  vec3 u = vec3(-n.z, 0.0, n.x);
  float s = dot(d, u);
  // the nearest point of the opening, and its middle
  vec3 e = vec3(clamp(s, -B.z, B.z), clamp(d.y, -B.w, B.w), 0.0);
  vec3 L1 = u * e.x + vec3(0.0, e.y, 0.0) - d;
  float l1 = length(L1);
  vec3 L2 = -d;
  float l2 = sqrt(dd);
  L1 /= max(l1, 1e-4);
  L2 /= max(l2, 1e-4);
  // the lobe out of the opening; the ground under it takes some light even straight below the sill (the room's
  // light through the whole pane, the frame and the reveal: a pool from the wall's foot on), a wall along it none
  float under = 0.45 * clamp(N.y, 0.0, 1.0) * (1.0 - smoothstep(B.z, B.z + 0.6 + 0.5 * max(o, 0.0), abs(s)));
  float lobe = (under + (1.0 - under) * max(dot(-L1, n), 0.0)) * smoothstep(-0.08, 0.1, o);
  float cr = 0.5 * (max(dot(N, L1), 0.0) + max(dot(N, L2), 0.0));
  float fall = 0.5 * (1.0 / (pow(l1 * l1, D.y * 0.5) + D.w) + 1.0 / (pow(l2 * l2, D.y * 0.5) + D.w));
  // the opening's shape thrown by the lamp inside (D.z behind the glass, a little over the middle), its bars
  float pat = 1.0;
  if (D.z > 0.0) {
    vec3 lamp = vec3(0.0, B.w * 0.35, 0.0) - n * D.z;
    vec3 rel = d - lamp;
    float k = D.z / max(D.z + o, 0.05);
    vec3 w = lamp + rel * k;
    float ws = dot(w, u) / B.z;
    float wt = w.y / B.w;
    float sw = 0.1 + 0.08 * max(o, 0.0);
    float m = (1.0 - smoothstep(1.0 - sw, 1.0 + sw, abs(ws))) * (1.0 - smoothstep(1.0 - sw, 1.0 + sw, abs(wt)));
    if (C.w > 0.5) {
      float cols = floor(C.w / 10.0 + 0.01);
      float rows = C.w - cols * 10.0;
      float fx = (ws * 0.5 + 0.5) * cols;
      float fy = (wt * 0.5 + 0.5) * rows;
      float bw = 0.05 + 0.05 * max(o, 0.0);
      float bx = (1.0 - smoothstep(bw, bw + 0.12, abs(fx - floor(fx + 0.5)))) * step(0.5, fx) * step(fx, cols - 0.5);
      float by = (1.0 - smoothstep(bw, bw + 0.12, abs(fy - floor(fy + 0.5)))) * step(0.5, fy) * step(fy, rows - 0.5);
      m *= 1.0 - 0.5 * max(bx, by);
    }
    pat = 0.5 + 0.5 * m;
  }
  return C.rgb * (A.w * lobe * cr * fall * fade * pat);
}
`;

/** All the spill sources at P (normal N): the list ends at the first with no power. */
const spillSumGlsl = /* glsl */ `
#define MAX_SPILL ${MAX_SPILL}
uniform vec4 uSpillA[MAX_SPILL];
uniform vec4 uSpillB[MAX_SPILL];
uniform vec4 uSpillC[MAX_SPILL];
uniform vec4 uSpillD[MAX_SPILL];
${spillGlsl}
vec3 psxSpill(vec3 P, vec3 N) {
  vec3 E = vec3(0.0);
  for (int i = 0; i < MAX_SPILL; i++) {
    if (uSpillA[i].w <= 0.0) break;
    E += spillOne(P, N, uSpillA[i], uSpillB[i], uSpillC[i], uSpillD[i]);
  }
  return E;
}
`;

/** Wet stone and puddles: the spill sources mirrored as streaks (needs wetStreak and spillSumGlsl). */
const spillWetGlsl = /* glsl */ `
vec3 psxSpillWet(vec3 P, vec3 rr) {
  vec3 E = vec3(0.0);
  for (int i = 0; i < MAX_SPILL; i++) {
    vec4 A = uSpillA[i];
    if (A.w <= 0.0) break;
    vec3 d = P - A.xyz;
    float r = uSpillD[i].x * 1.6;
    float dd = dot(d, d);
    if (dd > r * r) continue;
    // (a window's glow sits a little out of its wall, so the streak is not cut by it)
    vec3 c = A.xyz + vec3(uSpillB[i].x, 0.0, uSpillB[i].y) * 0.3;
    E += uSpillC[i].rgb * A.w * wetStreak(P, rr, c) * (1.0 - dd / (r * r));
  }
  return E;
}
`;

/** A soft tiling value noise, 128 x 128: where the puddles lie (psx option `puddles`). */
function puddleNoise(): THREE.DataTexture {
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  let seed = 1873;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const octave = (cells: number) => {
    const g = Array.from({ length: cells * cells }, rnd);
    return (x: number, y: number) => {
      const fx = (x / N) * cells;
      const fy = (y / N) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const sx = fx - x0;
      const sy = fy - y0;
      const u = sx * sx * (3 - 2 * sx);
      const v = sy * sy * (3 - 2 * sy);
      const at = (i: number, j: number) => g[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * u;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * u;
      return a + (b - a) * v;
    };
  };
  const o1 = octave(6);
  const o2 = octave(12);
  const o3 = octave(32);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const n = o1(x, y) * 0.6 + o2(x, y) * 0.28 + o3(x, y) * 0.12;
      const i = (y * N + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = Math.round(n * 255);
      data[i + 3] = 255;
    }
  const t = new THREE.DataTexture(data, N, N);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Until the litter layer sets its own: clean water everywhere. */
function noFoul(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

/** Until the city sets its own: no wall anywhere near. */
function farShore(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

/**
 * Height of the water waves above the still level at world (x, z), time t (uTime).
 * The same sum as the water vertex shader below: keep the two in step (the swimmer's eye rides on it).
 */
export function waveAt(x: number, z: number, t: number): number {
  return (
    (Math.sin(x * 0.11 + z * 0.07 + t * 0.45) * 0.08 +
      Math.sin(x * 0.35 + t * 0.9) * 0.07 +
      Math.sin(z * 0.55 - t * 0.7 + x * 0.2) * 0.05 +
      Math.sin((x + z) * 1.3 + t * 1.7) * 0.02) *
    psxUniforms.uSea.value
  );
}

/** M3j foul water: a small value noise of its own (the water shader has no pudVal). */
const foulGlsl = /* glsl */ `
float foulHash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float foulVal(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(foulHash(i), foulHash(i + vec2(1.0, 0.0)), u.x), mix(foulHash(i + vec2(0.0, 1.0)), foulHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** Value noise from a hash of the cell corners: no texture, so no tiling (the puddles). */
const pudNoiseGlsl = /* glsl */ `
float pudHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float pudVal(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pudHash(i);
  float b = pudHash(i + vec2(1.0, 0.0));
  float c = pudHash(i + vec2(0.0, 1.0));
  float d = pudHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
`;

export interface PsxOptions {
  /** Animate vertices as water waves. */
  water?: boolean;
  /** Affine texture warp strength, 0..1. */
  affine?: number;
  /** Skip vertex snap (UI-ish objects like the sky). */
  noSnap?: boolean;
  /**
   * Texture atlas of N x N cells (the city houses): the geometry has a "cell"
   * attribute (column, row) and the uv repeats inside that cell.
   */
  atlas?: number;
  /** Fog reaches this many times further (landmarks: a shape in the fog from afar). */
  fogReach?: number;
  /**
   * Flat ground that gets wet in the rain (uWet): darker stone, a sheen of sky at
   * grazing angles, gas lamps mirrored in streaks. Assumes the surface faces up.
   */
  wet?: boolean;
  /**
   * Puddles on this ground (needs `wet`): how much more or less water lies here than
   * elsewhere (1 = the city's normal; earth quays more, flagstones less).
   */
  puddles?: number;
  /**
   * false: this lit material takes no light from the spill sources (world/spill.ts). Every other lit psx
   * material (not the water) does.
   */
  spill?: boolean;
  /**
   * Stones that stand up (flat ground only, uv = world xz / tile): a height map for
   * parallax (the stones hide the joints behind them at a slant) and for a relief light
   * worked out here (lit tops, dark joints) that reads in any light.
   */
  relief?: {
    height: THREE.Texture;
    depth: number;
    tile: number;
    bump?: number;
    /** Stone ids (world/paving.ts): each stone rolls its own height, tone and sinking in world space. */
    id?: THREE.Texture;
    /** How many stones sink or have gone (1 = old street setts; 0 = none gone, a few sunk). */
    holes?: number;
    /**
     * How far the relief light and the stones' tones reach before they melt into an even tone, as a factor on
     * 8 to 22 m (and 14 to 30 m for the tones). Big stones keep their shape further off without a shimmer (the town
     * wall's walk, the look pass 2026-09-26: 2). Default 1.
     */
    reach?: number;
  };
  /**
   * Large, soft patches of lighter and darker stone (worn, repaired, dirtier) over flat
   * ground, so a tiled paving does not look like one repeated pattern. 0..1 strength.
   */
  vary?: number;
  /** Break up the tiling of a ground texture: a second, turned and scaled sample blended in by a slow noise (needs vary). */
  detile?: boolean;
  /**
   * Bump maps on every floor (2026-09-26): the faces of this material that lie flat and low (pavements, kerbs, door
   * steps: up-facing, below `yMax` metres) are drawn as stone slabs laid in world metres (`map` and its `height`, one
   * tile `tile` m), with the ground's relief light, whatever the mesh's own uv there. The rest keeps its texture.
   */
  slabs?: { map: THREE.Texture; height: THREE.Texture; tile: number; yMax: number };
  /**
   * Dirt at the foot of the walls (Steve, 2026-09-26: "bit more dirty on the underside where it touches the road"):
   * on the upright faces of this material, a band 0.5 to 1.2 m over the street, darker, splashed with mud, the damp
   * rising with a tide line at its top, uneven along the wall. `amount` 0..1; `vertexWear`: the house's own wear in
   * the vertex colour's alpha (build_city.py wear_of) sets how high and how dark. Less on the fine squares (FOOT_FINE),
   * more where the street by the wall is dirty (world/dirt.ts). World space: any building, any uv.
   */
  foot?: { amount: number; vertexWear?: boolean };
  /**
   * Big soft patches of lighter, darker, warmer and sootier stone over the upright faces (world metres, a noise that
   * never repeats), so a picture repeated over a big wall does not show its grid. Colour only: the bumps stay those of
   * the picture under it. 0..1 strength.
   */
  mottle?: number;
}

/**
 * The fine squares and their reach (tools/blender/build_city.py FINE_PLACES: the Grote Markt, the Handschoenmarkt and
 * the cathedral's square, the Conscienceplein, the Stadspark's fronts): x, z, radius. The foot of the walls is kept
 * cleaner there.
 */
const FOOT_FINE: Array<[number, number, number]> = [[-254, 94, 48], [-262, 132, 32], [-262, 175, 50], [-116, 160, 30], [-300, 318, 45]];

/**
 * The GLSL of `foot` and `mottle` (needs pudNoiseGlsl, uDirt and uDirtBox). psxFootDirt darkens `c` at the foot of an
 * upright face; psxMottle tones it in big patches. Both in world space, from the face's own normal.
 */
const footGlsl = /* glsl */ `
vec3 psxFaceN() { return normalize(cross(dFdx(vPsxWorld), dFdy(vPsxWorld))); }
// along the wall, in metres (the ground's xz on the wall's own line)
float psxAlong(vec3 n) {
  vec2 t = vec2(-n.z, n.x);
  float l = length(t);
  return l > 0.2 ? dot(vPsxWorld.xz, t / l) : vPsxWorld.x + vPsxWorld.z;
}
vec3 psxFootDirt(vec3 c, float amount) {
  float y = vPsxWorld.y;
  if (y > 1.7 || y < -0.4 || amount <= 0.0) return c;
  vec3 n = psxFaceN();
  float vert = 1.0 - smoothstep(0.45, 0.75, abs(n.y));
  if (vert <= 0.0) return c;
  float s = psxAlong(n);
  // the street before the wall: its grime and mud (world/dirt.ts), 0.5 m out from the face
  vec2 out2 = vPsxWorld.xz + normalize(n.xz + 1e-5) * 0.5;
  float street = texture2D(uDirt, (out2 - uDirtBox.xy) / uDirtBox.zw).r;
  float street2 = texture2D(uDirt, (vPsxWorld.xz - normalize(n.xz + 1e-5) * 0.5 - uDirtBox.xy) / uDirtBox.zw).r;
  street = max(street, street2);
  // the fine squares kept cleaner
  float fine = 0.0;
  ${FOOT_FINE.map(([x, z, r]) => `fine = max(fine, 1.0 - smoothstep(${(r * 0.65).toFixed(1)}, ${r.toFixed(1)}, length(vPsxWorld.xz - vec2(${x.toFixed(1)}, ${z.toFixed(1)}))));`).join("\n  ")}
  // (tuning 2026-09-26, Steve: "stronger foot-of-wall dirt": clear at 5-15 m in the back lanes and on the quays, the
  // fine squares still light; was 0.65 + 0.7 street, 0.35 fine, 1.2)
  float a = clamp(amount * (0.85 + 0.85 * street) * mix(1.0, 0.3, fine), 0.0, 1.35);
  // the damp's top: 0.5 m on a kept wall, 1.2 m on a foul one, ragged along the wall (metres and hand spans)
  float top = mix(0.55, 1.4, clamp(a, 0.0, 1.0)) + 0.22 * (pudVal(vec2(s / 1.6, 3.1)) - 0.5) + 0.1 * (pudVal(vec2(s / 0.37, 7.7)) - 0.5);
  float damp = 1.0 - smoothstep(top - 0.2, top, y);
  // the tide line: salts left where the damp stops, a darker thin run just under its top
  float tide = smoothstep(top - 0.16, top - 0.05, y) * (1.0 - smoothstep(top - 0.05, top, y));
  // splashed mud from the wheels and the feet: specks and blots, thicker and more of them near the street
  float low = 1.0 - smoothstep(0.0, 0.55, y);
  // (in clusters where a wheel threw them, a metre or two apart, not an even grain over the wall)
  float clus = smoothstep(0.35, 0.75, pudVal(vec2(s / 0.9, y / 0.5) + 41.3));
  float sp = pudVal(vec2(s, y) * vec2(8.0, 6.5) + 13.7) * 0.75 + pudVal(vec2(s, y) * vec2(19.0, 16.0) - 5.1) * 0.25;
  float splash = smoothstep(0.74 - 0.2 * low * a - 0.1 * clus, 0.79 - 0.2 * low * a - 0.1 * clus, sp) * clus * smoothstep(0.0, 0.1, top - y);
  // the kick of the street's own muck along the very bottom
  float muck = 1.0 - smoothstep(0.02, 0.2 + 0.18 * a + 0.12 * pudVal(vec2(s / 0.5, 1.3)), y);
  vec3 d = c;
  // the damp: darker and a little green-brown, most at the bottom
  d *= mix(vec3(1.0), vec3(0.42, 0.4, 0.33), damp * (0.55 + 0.5 * a) * (0.75 + 0.25 * (1.0 - y / max(top, 0.1))));
  d *= mix(vec3(1.0), vec3(0.6, 0.58, 0.52), tide * a);
  // (and just over it the salts it leaves, a pale ragged bloom: the damp's edge reads at 10 m)
  d *= 1.0 + 0.22 * a * smoothstep(top - 0.02, top + 0.03, y) * (1.0 - smoothstep(top + 0.05, top + 0.16, y)) * step(0.45, pudVal(vec2(s / 0.6, 5.3)));
  d = mix(d, d * vec3(0.42, 0.36, 0.28), clamp(splash * (0.5 + 0.5 * a), 0.0, 1.0));
  d = mix(d, d * vec3(0.27, 0.23, 0.17), muck * (0.5 + 0.5 * a));
  return mix(c, d, vert);
}
vec3 psxMottle(vec3 c, float k) {
  vec3 n = psxFaceN();
  float vert = 1.0 - smoothstep(0.45, 0.75, abs(n.y));
  if (vert <= 0.0 || k <= 0.0) return c;
  // (far off it would shimmer: it only tones, a slow noise at 1.5 to 9 m)
  vec2 w = vec2(psxAlong(n), vPsxWorld.y);
  float big = pudVal(w / 8.5 + 3.3) - 0.5;
  float mid = pudVal(w / 3.1 - 11.9) - 0.5;
  float small = pudVal(w / 1.3 + 27.1) - 0.5;
  vec3 t = vec3(1.0 + (big * 0.28 + mid * 0.18 + small * 0.08) * k);
  // warmer where it was patched, greyer and darker where the smoke settled
  t *= mix(vec3(1.0), vec3(1.05, 1.0, 0.93), smoothstep(0.12, 0.3, mid) * k);
  t *= mix(vec3(1.0), vec3(0.82, 0.8, 0.78), smoothstep(0.1, 0.35, big) * k * 0.8);
  return c * mix(vec3(1.0), t, vert);
}
`;

const commonVertex = /* glsl */ `
uniform float uSea;
uniform vec2 uSnapRes;
uniform float uTime;
varying vec3 vPsxWorld;
#ifdef USE_MAP
varying vec3 vAffineUv;
#endif
`;

/**
 * The lamps' light scattered toward the eye by the air (psx fog, and the sky dome: world/sky.ts, so the far fog
 * and the sky behind it glow alike; night fog 2026-09-26). `lampScatter(ro, rd, len, p)`: along the ray from `ro`
 * in `rd` for `len` metres, from a point light at `p`. SCATTER_REACH: the air past this many fog-fars adds no more
 * (it is lost in the fog): the far houses and the sky over them take the same glow, so neither shows against
 * the other.
 */
export const SCATTER_REACH = 1.5;
/**
 * The lamps light the low air: a ray that climbs leaves it about this many metres over the eye (it gathers no more
 * glow past there). The sky over the roofs is then not lit as the fog down in the street is, and a roof lower than
 * this gathers no more along its ray than the sky just over it (world/sky.ts FOG_DECK is the same height).
 */
export const AIR_DECK = 16;
export const LAMP_SCATTER_GLSL = /* glsl */ `
// How far along a ray (len metres to its surface, rd its way) the lamps' glow is gathered: to the surface, never past
// SCATTER_REACH fog-fars (lost in the fog), nor out of the low air the lamps light (AIR_DECK m over the eye).
float glowReach(float len, float far, vec3 rd) {
  return min(min(len, far * ${SCATTER_REACH.toFixed(2)}), ${AIR_DECK.toFixed(1)} / max(rd.y, 0.01));
}
// Light scattered toward the eye along the view ray, from one point light.
// Closed form of integral 1/(h^2 + t^2)^2 dt over the ray segment: a tight
// halo that stays near the lamp, so the fog is only warm under the lamps.
float halfScatter(float t, float h) {
  float h2 = h * h;
  return 0.5 * (t / (h2 * (h2 + t * t)) + atan(t / h) / (h2 * h));
}
float lampScatter(vec3 ro, vec3 rd, float len, vec3 p) {
  vec3 q = p - ro;
  float t0 = dot(q, rd);
  float d = length(q - rd * t0);
  float h = d + 1.2;
  float tight = halfScatter(len - t0, h) - halfScatter(-t0, h);
  // soft wide term, integral of 1/(h^2 + t^2), faded out past ~12 m
  float hw = d + 2.5;
  float wide = (atan((len - t0) / hw) - atan(-t0 / hw)) / hw;
  // fog throws light on forward (night fog, 2026-09-26): a lamp ahead glows as before, a lamp beside the eye
  // lights the air in front of it about a third as much, one behind an eighth; so the air round a lamp glows
  // and a lamp at your shoulder does not lift the whole view (the sky takes the same glow now: world/sky.ts).
  // The angle is taken a little before the ray's nearest point to the lamp (on the eye's side), where most of
  // its light is turned toward the eye.
  vec3 x = rd * clamp(t0 - hw, 0.0, len) - q;
  float phase = 0.12 + 0.88 * smoothstep(-0.5, 1.0, dot(normalize(x + vec3(0.0, 1e-4, 0.0)), -rd));
  // (the wide wash 0.22 -> 0.165 with it: the sky under the lamps glows too now, and the night stays as dark)
  return (tight + wide * 0.165 * smoothstep(14.0, 4.0, d)) * phase;
}
`;

const commonFragment = /* glsl */ `
#define MAX_LAMPS ${MAX_LAMPS}
uniform vec4 uLamps[MAX_LAMPS];
uniform vec3 uLampColor;
uniform float uScatter;
uniform float uAffine;
varying vec3 vPsxWorld;
#ifdef USE_MAP
varying vec3 vAffineUv;
#endif

${LAMP_SCATTER_GLSL}
// Mirror image of a lamp on the water: only the sharp core, no wide wash.
float lampReflect(vec3 ro, vec3 rd, vec3 p) {
  vec3 q = p - ro;
  float t0 = dot(q, rd);
  if (t0 < 0.0) return 0.0;
  float h = length(q - rd * t0) + 0.6;
  return min(halfScatter(60.0 - t0, h) - halfScatter(-t0, h), 4.0);
}
`;

// Wet ground and rain on the water (world/ambient.ts drives uWet and uRain).
const wetFragment = /* glsl */ `
uniform float uTime;
uniform float uWet;
uniform float uRain;
// A lamp mirrored in wet stone: a streak that runs toward the eye, narrow across.
float wetStreak(vec3 ro, vec3 rr, vec3 p) {
  vec3 q = p - ro;
  float t0 = dot(q, rr);
  if (t0 < 0.0) return 0.0;
  vec3 perp = q - rr * t0;
  vec3 across = normalize(vec3(-rr.z, 0.0, rr.x) + 1e-5);
  float da = dot(perp, across);
  float dv = length(perp - across * da);
  return 1.0 / (1.0 + da * da * 5.0 + dv * dv * 0.35) / (1.0 + t0 * 0.08);
}
// Rain rings: drops land in a grid of cells, each ring grows and fades.
float rainRings(vec2 wp, float t, float amount) {
  float ring = 0.0;
  for (int k = 0; k < 2; k++) {
    vec2 g = wp * 1.3 + float(k) * vec2(0.37, 0.71);
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = fract(sin(dot(id, vec2(127.1, 311.7)) + float(k) * 13.1) * 43758.5453);
    vec2 c = (vec2(fract(h * 7.13), fract(h * 3.71)) - 0.5) * 0.4;
    float ph = fract(t * 0.8 + h * 5.0);
    float d = length(f - c);
    ring += smoothstep(0.045, 0.0, abs(d - ph * 0.3)) * (1.0 - ph) * step(h, amount * 1.1);
  }
  return ring;
}
`;

export function psx<T extends THREE.Material>(mat: T, opts: PsxOptions = {}): T {
  const affine = opts.affine ?? 1.0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = psxUniforms.uSnapRes;
    shader.uniforms.uTime = psxUniforms.uTime;
    shader.uniforms.uSea = psxUniforms.uSea;
    shader.uniforms.uLamps = psxUniforms.uLamps;
    shader.uniforms.uLampColor = psxUniforms.uLampColor;
    shader.uniforms.uScatter = psxUniforms.uScatter;
    shader.uniforms.uAffine = { value: affine };
    if (opts.vary || opts.foot || opts.mottle) {
      shader.uniforms.uDirt = psxUniforms.uDirt;
      shader.uniforms.uDirtBox = psxUniforms.uDirtBox;
    }
    if (opts.relief) {
      shader.uniforms.uHeight = { value: opts.relief.height };
      shader.uniforms.uReliefDepth = { value: opts.relief.depth };
      shader.uniforms.uReliefTile = { value: opts.relief.tile };
      shader.uniforms.uReliefBump = { value: opts.relief.bump ?? 3 };
      if (opts.relief.id) shader.uniforms.uStoneId = { value: opts.relief.id };
    }
    if (opts.slabs) {
      shader.uniforms.uSlabMap = { value: opts.slabs.map };
      shader.uniforms.uSlabH = { value: opts.slabs.height };
    }
    if (opts.wet || opts.water) {
      shader.uniforms.uWet = psxUniforms.uWet;
      shader.uniforms.uRain = psxUniforms.uRain;
    }
    if (opts.puddles) {
      psxUniforms.uPudNoise.value ??= puddleNoise();
      shader.uniforms.uPuddle = psxUniforms.uPuddle;
      shader.uniforms.uMirror = psxUniforms.uMirror;
      shader.uniforms.uMirrorMat = psxUniforms.uMirrorMat;
      shader.uniforms.uPudNoise = psxUniforms.uPudNoise;
    }
    if (opts.water) {
      shader.uniforms.uShore = psxUniforms.uShore;
      shader.uniforms.uShoreBox = psxUniforms.uShoreBox;
      shader.uniforms.uWaterMirror = psxUniforms.uWaterMirror;
      shader.uniforms.uWaterMirrorMat = psxUniforms.uWaterMirrorMat;
      shader.uniforms.uWaterMirrorOn = psxUniforms.uWaterMirrorOn;
      shader.uniforms.uFoul = psxUniforms.uFoul;
      shader.uniforms.uFoulBox = psxUniforms.uFoulBox;
    }

    let vs = shader.vertexShader;
    vs = vs.replace(
      "#include <common>",
      "#include <common>\n" + commonVertex + (opts.atlas ? "attribute vec2 cell;\nvarying vec2 vCell;\n" : "") + (opts.water ? "varying float vWaveH;\n" : ""),
    );
    if (opts.atlas) vs = vs.replace("#include <uv_vertex>", "#include <uv_vertex>\nvCell = cell;");

    if (opts.water) {
      // Plane is rotated -90 deg on X: local x = world x, local y = -world z,
      // local z = world up. Waves are a sum of sines; normals from their slope.
      vs = vs.replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `vec3 objectNormal;
        {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float t = uTime;
          // slopes of the waves below (a little steeper than true, for the glints)
          float sw = cos(wp.x * 0.11 + wp.z * 0.07 + t * 0.45);
          float dx = sw * 0.018
                   + cos(wp.x * 0.35 + t * 0.9) * 0.045
                   + cos(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.016
                   + cos((wp.x + wp.z) * 1.3 + t * 1.7) * 0.039
                   + cos(wp.x * 3.1 - wp.z * 1.7 + t * 2.3) * 0.07;
          float dz = sw * 0.012
                   + cos(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.05
                   + cos((wp.x + wp.z) * 1.3 + t * 1.7) * 0.039
                   - cos(wp.x * 3.1 - wp.z * 1.7 + t * 2.3) * 0.04;
          objectNormal = normalize(vec3(-dx, dz, 1.0));
        }
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      );
      vs = vs.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          // a long slow swell under shorter waves; waveAt() in TypeScript is the same sum
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float w = sin(wp.x * 0.11 + wp.z * 0.07 + uTime * 0.45) * 0.08
                  + sin(wp.x * 0.35 + uTime * 0.9) * 0.07
                  + sin(wp.z * 0.55 - uTime * 0.7 + wp.x * 0.2) * 0.05
                  + sin((wp.x + wp.z) * 1.3 + uTime * 1.7) * 0.02;
          w *= uSea;
          transformed.z += w;
          vWaveH = w / 0.22;
        }`,
      );
    }

    vs = vs.replace(
      "#include <project_vertex>",
      /* glsl */ `#include <project_vertex>
      vPsxWorld = (inverse(viewMatrix) * mvPosition).xyz;
      ${
        opts.noSnap
          ? ""
          : `{
        // snap only past arm's length: up close the jitter just looks broken
        vec2 grid = uSnapRes;
        vec2 ndc = gl_Position.xy / gl_Position.w;
        vec2 snapped = floor(ndc * grid + 0.5) / grid;
        float k = smoothstep(1.5, 4.0, gl_Position.w);
        gl_Position.xy = mix(ndc, snapped, k) * gl_Position.w;
      }`
      }
      #ifdef USE_MAP
      vAffineUv = vec3(vMapUv * gl_Position.w, gl_Position.w);
      #endif`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    // light spilt from lit windows, doors, lamps and lanterns (world/spill.ts): every lit material but the water
    const spillOn = !opts.water && opts.spill !== false && fs.includes("#include <lights_fragment_end>");
    if (spillOn) {
      shader.uniforms.uSpillA = psxUniforms.uSpillA;
      shader.uniforms.uSpillB = psxUniforms.uSpillB;
      shader.uniforms.uSpillC = psxUniforms.uSpillC;
      shader.uniforms.uSpillD = psxUniforms.uSpillD;
    }
    fs = fs.replace(
      "#include <common>",
      "#include <common>\n" +
        commonFragment +
        (opts.atlas ? "varying vec2 vCell;\n" : "") +
        (opts.wet || opts.water ? wetFragment : "") +
        (spillOn ? spillSumGlsl : "") +
        (spillOn && opts.wet ? spillWetGlsl : "") +
        (opts.puddles ? "uniform float uPuddle;\nuniform sampler2D uMirror;\nuniform mat4 uMirrorMat;\nuniform sampler2D uPudNoise;\n" : "") +
        (opts.wet || opts.puddles || opts.vary || opts.foot || opts.mottle ? pudNoiseGlsl : "") +
        (opts.vary || opts.foot || opts.mottle ? "uniform sampler2D uDirt;\nuniform vec4 uDirtBox;\n" : "") +
        (opts.foot || opts.mottle ? footGlsl : "") +
        (opts.slabs ? "uniform sampler2D uSlabMap;\nuniform sampler2D uSlabH;\n" : "") +
        (opts.relief ? "uniform sampler2D uHeight;\nuniform float uReliefDepth;\nuniform float uReliefTile;\nuniform float uReliefBump;\n" : "") +
        (opts.relief?.id
          ? /* glsl */ `uniform sampler2D uStoneId;
// every stone its own dice: its number in the tile mixed with the tile's place in the world
float psxStoneR(vec2 uv, vec3 s) {
  vec2 t = floor(uv) - vec2(step(0.5, s.b), 0.0);
  return fract(sin(dot(vec3(t, floor(s.r * 255.0 + 0.5)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
// x: gone (a muddy hole), y: sunk; far more of both in the wheel lines of the cart roads
vec2 psxStoneMS(float r, float wear) {
  float holes = ${(opts.relief.holes ?? 0).toFixed(2)};
  return vec2(step(r, (0.012 + 0.07 * wear) * holes), step(r, (0.06 + 0.22 * wear) * holes + 0.02));
}
float psxRelH(vec2 uv, float wear) {
  float h = texture2D(uHeight, uv).r;
  vec3 s = texture2D(uStoneId, uv).rgb;
  if (s.g < 0.5) return h;
  float r = psxStoneR(uv, s);
  vec2 ms = psxStoneMS(r, wear);
  // no two stones at the same height; worn ones rounder and lower; sunk ones low; gone ones a hole
  float top = mix(0.35 + 0.65 * fract(r * 53.7), 0.22, ms.y) * (1.0 - 0.3 * wear);
  return mix(h * top, 0.02, ms.x);
}
`
          : opts.relief
            ? "float psxRelH(vec2 uv, float wear) { return texture2D(uHeight, uv).r; }\n"
            : "") +
        (opts.relief
          ? /* glsl */ `
// the relief light at uv (lit tops from the sky, dark joints; worn by the wheels: smoother, the tops polished a
// little lighter). The step is two texels of a picture's 512 px map (1 cm) and one of the painted 128 px maps:
// a step of 4 texels on the pictures drew the lit edge and the dark joint 2 cm wider than the stones in the colour.
float psxReliefLight(vec2 uv, float wear, out float hC) {
  float e = 2.0 / max(float(textureSize(uHeight, 0).x), 256.0);
  hC = psxRelH(uv, wear);
  float hX = psxRelH(uv + vec2(e, 0.0), wear) - psxRelH(uv - vec2(e, 0.0), wear);
  float hZ = psxRelH(uv + vec2(0.0, e), wear) - psxRelH(uv - vec2(0.0, e), wear);
  vec3 rn = normalize(vec3(-hX * uReliefBump, 1.0, -hZ * uReliefBump));
  float lit = clamp(dot(rn, normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
  // a stone that stands high catches the light; a sunk one lies in its own shade
  float relief = mix(0.6, 1.12, lit) * (0.55 + 0.45 * hC);
  return mix(relief, 1.0 + 0.12 * hC, wear * 0.45);
}
`
          : "") +
        (opts.relief?.id
          ? /* glsl */ `
// each stone its own tone: lighter, darker, warmer, bluer (the tile's tones never line up); a stone gone is a
// hole of mud and muck; further off (farS) only a dark patch (no flicker)
vec3 psxStoneTone(vec2 uv, float wear, float farS) {
  vec3 sid = texture2D(uStoneId, uv).rgb;
  if (sid.g <= 0.5) return vec3(1.0);
  float r = psxStoneR(uv, sid);
  vec2 ms = psxStoneMS(r, wear);
  vec3 st = vec3(0.8 + 0.36 * fract(r * 91.3)) * mix(vec3(1.06, 1.0, 0.9), vec3(0.94, 0.98, 1.06), fract(r * 17.9));
  st = mix(st, vec3(0.2, 0.15, 0.1) * (0.7 + 0.6 * fract(r * 7.7)), ms.x);
  st = mix(st, st * 0.85, ms.y * (1.0 - ms.x));
  return mix(st, vec3(mix(1.0, 0.6, ms.x)), farS);
}
`
          : "") +
        (opts.water
          ? "uniform sampler2D uShore;\nuniform vec4 uShoreBox;\nvarying float vWaveH;\nuniform sampler2D uWaterMirror;\nuniform mat4 uWaterMirrorMat;\nuniform float uWaterMirrorOn;\nuniform sampler2D uFoul;\nuniform vec4 uFoulBox;\n" + foulGlsl
          : ""),
    );
    fs = fs.replace(
      "#include <map_fragment>",
      /* glsl */ `float psxH = 0.5; // how high the stone is here (relief height map); the puddles leave the tops dry
      // how worn the ground is here: the cart roads (world/dirt.ts, green channel)
      float psxWear = ${opts.vary ? "texture2D(uDirt, (vPsxWorld.xz - uDirtBox.xy) / uDirtBox.zw).g" : "0.0"};
      #ifdef USE_MAP
      {
        // affine warp fades in with distance: textures swim a little far off,
        // but stay straight at your feet and on walls you touch
        vec2 affUv = vAffineUv.xy / vAffineUv.z;
        float near = smoothstep(4.0, 14.0, length(vPsxWorld - cameraPosition));
        vec2 psxUv = mix(vMapUv, affUv, uAffine * near);
        ${opts.atlas ? `psxUv = (vCell + fract(psxUv)) / ${opts.atlas.toFixed(1)};` : ""}
        ${
          opts.relief && opts.relief.depth > 0
            ? `// parallax occlusion: step into the stones along the view ray, near the eye only
        vec3 relV = cameraPosition - vPsxWorld;
        float relDist = length(relV);
        relV /= max(relDist, 1e-4);
        float relFade = 1.0 - smoothstep(6.0, 14.0, relDist);
        if (relFade > 0.0) {
          float layers = mix(14.0, 5.0, clamp(relV.y, 0.0, 1.0));
          float dl = 1.0 / layers;
          vec2 duv = (-relV.xz / max(relV.y, 0.2)) * (uReliefDepth * relFade / uReliefTile) * dl;
          vec2 ruv = psxUv;
          float depth = 0.0;
          float hDepth = 1.0 - psxRelH(ruv, psxWear);
          int steps = 0;
          for (int i = 0; i < 14; i++) {
            if (depth >= hDepth) break;
            ruv += duv;
            hDepth = 1.0 - psxRelH(ruv, psxWear);
            depth += dl;
            steps++;
          }
          if (steps > 0) {
            // between the last two steps where the ray met the stone: no stair steps along the joints at a slant
            float after = hDepth - depth;
            float before = (1.0 - psxRelH(ruv - duv, psxWear)) - (depth - dl);
            ruv -= duv * clamp(after / min(after - before, -1e-4), 0.0, 1.0);
          }
          psxUv = ruv;
        }`
            : ""
        }
        vec4 sampledDiffuseColor = texture2D(map, psxUv);
        // the turned second sample of detile, and how much of it shows here (the relief below follows it)
        vec2 psxUv2 = psxUv;
        float psxDm = 0.0;
        ${
          opts.detile
            ? `{
          // no tile repeats in a grid: where a slow noise says so, the same texture turned 37 deg and scaled
          psxUv2 = mat2(0.8, -0.6, 0.6, 0.8) * psxUv * 0.77 + vec2(0.31, 0.57);
          psxDm = smoothstep(0.35, 0.65, pudVal(vPsxWorld.xz / 7.0));
          sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(map, psxUv2), psxDm);
        }`
            : ""
        }
        diffuseColor *= sampledDiffuseColor;
        ${
          opts.slabs
            ? `{
          // pavements, kerbs and door steps: slabs in world metres with their own relief (bump maps on every floor)
          vec3 fN = normalize(cross(dFdx(vPsxWorld), dFdy(vPsxWorld)));
          if (abs(fN.y) > 0.9 && vPsxWorld.y < ${opts.slabs.yMax.toFixed(2)}) {
            vec2 suv = vPsxWorld.xz / ${opts.slabs.tile.toFixed(2)};
            diffuseColor.rgb = diffuse * texture2D(uSlabMap, suv).rgb * 1.25; // (as light as the pale kerbs were)
            float e = 1.0 / 128.0;
            float sh = texture2D(uSlabH, suv).r;
            float sx = texture2D(uSlabH, suv + vec2(e, 0.0)).r - texture2D(uSlabH, suv - vec2(e, 0.0)).r;
            float sz = texture2D(uSlabH, suv + vec2(0.0, e)).r - texture2D(uSlabH, suv - vec2(0.0, e)).r;
            vec3 rn = normalize(vec3(-sx * 1.6, 1.0, -sz * 1.6));
            float lit = clamp(dot(rn, normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
            float rel = mix(0.6, 1.12, lit) * (0.55 + 0.45 * sh);
            diffuseColor.rgb *= mix(rel, 0.86, smoothstep(8.0, 22.0, length(vPsxWorld - cameraPosition)));
          }
        }`
            : ""
        }
        ${
          opts.vary
            ? `{
          // patches: worn paths, newer stones where it was mended, dirt by the walls
          vec2 vp = vPsxWorld.xz;
          float big = pudVal(vp / 23.0) - 0.5;
          float mid = pudVal(vp / 6.5 + 17.3) - 0.5;
          float mend = smoothstep(0.78, 0.82, pudVal(vp / 4.1 - 41.0));
          vec3 tone = vec3(1.0 + (big * 0.26 + mid * 0.16) * ${(opts.vary ?? 0).toFixed(2)});
          tone *= mix(vec3(1.0), vec3(1.07, 1.05, 1.0), mend * ${(opts.vary ?? 0).toFixed(2)});
          tone *= mix(vec3(1.0), vec3(0.93, 0.95, 1.0), smoothstep(0.1, 0.4, mid) * 0.5 * ${(opts.vary ?? 0).toFixed(2)});
          // grime in the gutters by the walls, mud and dung on the open ground (world/dirt.ts),
          // broken up so it does not lie in smooth blobs
          float dirt = texture2D(uDirt, (vp - uDirtBox.xy) / uDirtBox.zw).r;
          dirt *= 0.6 + 0.8 * pudVal(vp * 1.7 + 5.1);
          // (linear light: a factor of 0.25 shows as about half as bright on screen)
          tone *= mix(vec3(1.0), vec3(0.24, 0.19, 0.13), clamp(dirt, 0.0, 1.0));
          diffuseColor.rgb *= tone;
        }`
            : ""
        }
        ${
          opts.relief
            ? `{
          // relief light from the height map: the tops lit from the sky, the joints dark;
          // it melts into an even tone further off (no shimmer)
          float hC;
          float relief = psxReliefLight(psxUv, psxWear, hC);
          ${
            opts.detile
              ? `if (psxDm > 0.001) {
            // where the colour is the turned sample, so is the relief: the lit tops and dark joints on its stones
            float hC2;
            float relief2 = psxReliefLight(psxUv2, psxWear, hC2);
            relief = mix(relief, relief2, psxDm);
            hC = mix(hC, hC2, psxDm);
          }`
              : ""
          }
          psxH = hC;
          float far = smoothstep(${(8 * (opts.relief.reach ?? 1)).toFixed(1)}, ${(22 * (opts.relief.reach ?? 1)).toFixed(1)}, length(vPsxWorld - cameraPosition));
          diffuseColor.rgb *= mix(relief, 0.86, far);
          ${
            opts.relief.id
              ? `{
            float farS = smoothstep(${(14 * (opts.relief.reach ?? 1)).toFixed(1)}, ${(30 * (opts.relief.reach ?? 1)).toFixed(1)}, length(vPsxWorld - cameraPosition));
            vec3 st = psxStoneTone(psxUv, psxWear, farS);
            ${opts.detile ? "if (psxDm > 0.001) st = mix(st, psxStoneTone(psxUv2, psxWear, farS), psxDm);" : ""}
            diffuseColor.rgb *= st;
          }`
              : ""
          }
        }`
            : ""
        }
        ${
          opts.water
            ? `{
          // far off, the ripples melt into one dark tone (no shimmer at the fog line)
          vec2 wxz = vPsxWorld.xz;
          float detail = smoothstep(70.0, 10.0, length(vPsxWorld - cameraPosition));
          diffuseColor.rgb = mix(diffuse * vec3(0.045, 0.062, 0.05), diffuseColor.rgb, detail);
          // wave crests a shade lighter, troughs darker
          diffuseColor.rgb *= 1.0 + vWaveH * 0.18;
          // along the walls: lighter, silty water and foam lapping at the stone, in 20 cm pixels
          float shore = texture2D(uShore, (wxz - uShoreBox.xy) / uShoreBox.zw).r * 8.0;
          vec2 cell = floor(wxz * 5.0);
          float n = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
          float lap = 0.5 + 0.5 * sin(uTime * 1.1 + wxz.x * 0.45 + wxz.y * 0.3);
          float reach = (0.2 + 0.5 * lap) * (0.45 + 0.75 * n);
          float foam = step(shore, reach) * (0.55 + 0.45 * step(0.5, n));
          float silt = smoothstep(2.5, 0.2, shore);
          diffuseColor.rgb *= 1.0 + silt * 0.45;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.32, 0.29), foam * 0.8);
          // M3j: foul water (world/litter.ts uFoul): browner and duller
          float foulD = texture2D(uFoul, (wxz - uFoulBox.xy) / uFoulBox.zw).r;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.74, 0.5), foulD);
        }`
            : ""
        }
      }
      #endif`,
    );
    if (spillOn) {
      fs = fs.replace(
        "#include <lights_fragment_end>",
        /* glsl */ `#include <lights_fragment_end>
      {
        // the spill sources light this face as point lights would (world/spill.ts), by its own normal
        vec3 spillN = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
        reflectedLight.directDiffuse += psxSpill(vPsxWorld, spillN) * BRDF_Lambert(diffuseColor.rgb);
      }`,
      );
    }
    if (opts.wet && fs.includes("#include <lights_phong_fragment>")) {
      // Dry stone is matte (the quay sheen, 2026-09-27; Steve: "a shine over it and it looks like flat plastic"): the
      // sun's Phong highlight lies on the flat face of the ground, not on the stones (the relief is in the colour
      // only), so a dry quay turned into one smooth sheen looking toward the sun, the Fresnel brightest at a slant.
      // The highlight now comes with the wet, in the rain's patches as the wet shading below (a film of water is
      // smooth: the rain's sheen stays as it was); dry, the ground is as matte as the rail band's setts.
      fs = fs.replace(
        "#include <lights_phong_fragment>",
        /* glsl */ `#include <lights_phong_fragment>
      {
        float spPatch = pudVal(vPsxWorld.xz / 1.7) * 0.6 + pudVal(vPsxWorld.xz * 4.0) * 0.4;
        material.specularColor *= uWet * smoothstep(0.15, 0.65, spPatch + uWet * 0.35);
      }`,
      );
    }
    if (opts.foot || opts.mottle) {
      // (after the colour, the vertex colour and whatever a later patch draws there, houseGrime.ts; before the light)
      const wearOf = opts.foot?.vertexWear ? "\n        #ifdef USE_COLOR_ALPHA\n        fA *= 0.25 + 0.9 * vColor.a;\n        #endif" : "";
      fs = fs.replace(
        "#include <emissivemap_fragment>",
        /* glsl */ `{
        ${opts.mottle ? `diffuseColor.rgb = psxMottle(diffuseColor.rgb, ${opts.mottle.toFixed(2)});` : ""}
        ${opts.foot ? `float fA = ${opts.foot.amount.toFixed(2)};${wearOf}\n        diffuseColor.rgb = psxFootDirt(diffuseColor.rgb, fA);` : ""}
      }
      #include <emissivemap_fragment>`,
      );
    }
    fs = fs.replace(
      "#include <fog_fragment>",
      /* glsl */ `#ifdef USE_FOG
      {
        vec3 ro = cameraPosition;
        vec3 toFrag = vPsxWorld - ro;
        float len = length(toFrag);
        vec3 rd = toFrag / max(len, 1e-4);
        float glow = 0.0;
        // (the sky dome gathers its glow the same way: world/sky.ts)
        float glowLen = glowReach(len, fogFar, rd);
        for (int i = 0; i < MAX_LAMPS; i++) {
          glow += uLamps[i].w * lampScatter(ro, rd, glowLen, uLamps[i].xyz);
        }
        float fogFactor = smoothstep(fogNear, fogFar * ${(opts.fogReach ?? 1).toFixed(2)}, vFogDepth);
        ${
          (opts.fogReach ?? 1) > 1
            ? `// a landmark seen further than the fog: past the normal fog it becomes one soft
        // silhouette tone, so its dark windows do not stay black against the grey
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * 0.74, smoothstep(fogNear, fogFar, vFogDepth));`
            : ""
        }
        ${
          opts.water
            ? `{
          // a dark mirror: the misty sky at low angles, black water looking down, the gas
          // lamps drawn out into long broken streaks by fine ripples (in chunky world pixels)
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec2 rp = floor(vPsxWorld.xz * 6.0) / 6.0;
          vec2 rip = vec2(sin(rp.x * 2.7 + rp.y * 0.9 + uTime * 1.9), sin(rp.y * 3.3 - rp.x * 0.7 - uTime * 1.5)) * 0.06;
          vec3 rn = normalize(wn + vec3(rip.x, 0.0, rip.y));
          float cosV = max(dot(rn, -rd), 0.0);
          if (uWaterMirrorOn > 0.5) {
            // the quays, ships and sky mirrored (world/mirror.ts), shaken by the ripples
            vec4 mr = uWaterMirrorMat * vec4(vPsxWorld, 1.0);
            mr.xy += rip * 0.35 * mr.w;
            vec3 mc = texture2DProj(uWaterMirror, mr).rgb;
            float f = max(0.22, 0.04 + 0.96 * pow(1.0 - cosV, 5.0));
            gl_FragColor.rgb = mix(gl_FragColor.rgb, mc * 0.92, clamp(f, 0.0, 0.9));
          } else {
            float fres = pow(1.0 - cosV, 4.0);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * 1.08, clamp(fres * 0.8, 0.0, 0.75));
          }
          {
            // M3j: the vlieten and the canal were open sewers (world/litter.ts): murky water that
            // mirrors less, and a dull skin of scum drifting in patches
            float foul = texture2D(uFoul, (vPsxWorld.xz - uFoulBox.xy) / uFoulBox.zw).r;
            if (foul > 0.01) {
              vec2 sp = vPsxWorld.xz * 0.8 + vec2(uTime * 0.03, uTime * 0.017);
              float scum = smoothstep(0.5, 0.68, foulVal(sp) * 0.7 + foulVal(sp * 3.1 + 7.7) * 0.3) * foul;
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * vec3(0.3, 0.28, 0.22), foul * 0.45);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * vec3(0.26, 0.23, 0.17) + vec3(0.03, 0.024, 0.014), scum * 0.8);
            }
          }
          vec3 rr = reflect(rd, rn);
          float refl = 0.0;
          float streak = 0.0;
          for (int i = 0; i < MAX_LAMPS; i++) {
            refl += uLamps[i].w * lampReflect(vPsxWorld, rr, uLamps[i].xyz);
            streak += uLamps[i].w * wetStreak(vPsxWorld, rr, uLamps[i].xyz);
          }
          float dash = 0.5 + 0.5 * sin(rp.y * 7.0 + rp.x * 1.3 + uTime * 2.2);
          gl_FragColor.rgb += uLampColor * (refl * 0.09 + streak * 0.5 * dash * dash);
          if (uRain > 0.001) {
            // rain on the water: rings that catch the sky
            gl_FragColor.rgb += (fogColor * 0.7 + 0.015) * rainRings(vPsxWorld.xz, uTime, uRain) * 0.6 * uRain;
          }
        }`
            : ""
        }
        ${
          opts.wet
            ? `if (uWet > 0.001) {
          // Wet stone after Lagarde (Steve: "wet surfaces are extremely shiny"): porous
          // stone goes DARKER, the joints darkest; it gets wet in patches, not all at
          // once; and it shines only in small broken glints at a slant, where the top of
          // a sett catches the light (a cheap bump: every 20 cm face tilts its own way).
          // Only the puddles are mirrors.
          float stone = smoothstep(0.06, 0.4, dot(diffuseColor.rgb, vec3(0.333)));
          float patchy = pudVal(vPsxWorld.xz / 1.7) * 0.6 + pudVal(vPsxWorld.xz * 4.0) * 0.4;
          float wetK = uWet * smoothstep(0.15, 0.65, patchy + uWet * 0.35);
          gl_FragColor.rgb *= 1.0 - 0.36 * wetK * (1.25 - 0.5 * stone);
          float grazing = pow(1.0 - clamp(-rd.y, 0.0, 1.0), 3.0);
          // half-metre faces: big enough to show at the game's picture size
          float glint = step(0.6, pudHash(floor(vPsxWorld.xz * 2.2)));
          gl_FragColor.rgb += fogColor * grazing * 0.2 * wetK * stone * (0.25 + 0.75 * glint);
          vec3 rr = vec3(rd.x, -rd.y, rd.z);
          float wrefl = 0.0;
          for (int i = 0; i < MAX_LAMPS; i++) {
            wrefl += uLamps[i].w * wetStreak(vPsxWorld, rr, uLamps[i].xyz);
          }
          gl_FragColor.rgb += uLampColor * wrefl * wetK * stone * (0.15 + 0.85 * glint) * 0.4;
          ${spillOn ? "gl_FragColor.rgb += psxSpillWet(vPsxWorld, rr) * wetK * (0.35 + 0.65 * stone) * (0.55 + 0.45 * glint) * 0.02;" : ""}
          if (uRain > 0.001) gl_FragColor.rgb += fogColor * rainRings(vPsxWorld.xz * 1.6, uTime * 1.3, uRain * 0.6) * 0.18 * wetK;
        }`
            : ""
        }
        ${
          opts.puddles
            ? `if (uPuddle > 0.001) {
          // Puddles in the paving (after Lagarde's wet surfaces): water lies where a soft
          // noise is highest, so the edges are ragged, not round; a dark damp band round it;
          // the water shows the ground under it looking down and turns to a mirror at a
          // slant (Fresnel), with the street itself mirrored (world/mirror.ts).
          // value noise worked out here from the world position: it never repeats (Steve: "puddles repeat")
          vec2 pp = vPsxWorld.xz;
          float pn = pudVal(pp / 17.0) * 0.55 + pudVal(pp / 7.3 + 31.7) * 0.3 + pudVal(pp / 2.9 - 12.1) * 0.15;
          // the sum bunches round 0.5: stretch it so the fill level is the wet share of the ground
          pn = clamp((pn - 0.5) * 2.4 + 0.5, 0.0, 1.0);
          float lvl = clamp(uPuddle * ${(opts.puddles ?? 1).toFixed(2)}, 0.0, 1.0);
          // at most about a quarter of the ground is puddle, even in a storm: the rest is wet stone
          float th = 0.97 - lvl * 0.22;
          float water = smoothstep(th, th + 0.018, pn);
          // broken into puddles a few metres across (QA 2026-09-24: in a narrow lane one big patch of
          // the slow noise filled it wall to wall, a street-long mirror): a second, finer noise cuts it up
          water *= smoothstep(0.46, 0.56, pudVal(pp / 2.1 + 57.1)) * smoothstep(0.3, 0.42, pudVal(pp / 4.7 - 23.9));
          // stones and pebbles stand out of the water: the shallower the puddle, the more of them
          ${opts.relief ? "water *= 1.0 - smoothstep(0.6 + lvl * 0.2, 0.7 + lvl * 0.2, psxH) * (1.0 - smoothstep(th + 0.05, th + 0.3, pn));" : ""}
          water = clamp(water, 0.0, 1.0);
          float damp = smoothstep(th - 0.09, th, pn);
          gl_FragColor.rgb *= 1.0 - 0.38 * damp * (1.0 - water);
          if (water > 0.0) {
            float cosT = clamp(-rd.y, 0.0, 1.0);
            float F = max(0.02 + 0.98 * pow(1.0 - cosT, 5.0), 0.22);
            vec2 rp = floor(vPsxWorld.xz * 8.0) / 8.0;
            vec2 wob = vec2(sin(rp.x * 3.1 + uTime * 1.7), sin(rp.y * 2.7 - uTime * 1.3)) * 0.0025;
            ${opts.wet ? "if (uRain > 0.001) wob += vec2(rainRings(vPsxWorld.xz * 1.4, uTime * 1.2, uRain)) * 0.012;" : ""}
            vec4 mr = uMirrorMat * vec4(vPsxWorld, 1.0);
            mr.xy += wob * mr.w;
            vec3 refl = texture2DProj(uMirror, mr).rgb * 1.1;
            vec3 rr = vec3(rd.x, -rd.y, rd.z);
            float lamp = 0.0;
            for (int i = 0; i < MAX_LAMPS; i++) lamp += uLamps[i].w * wetStreak(vPsxWorld, rr, uLamps[i].xyz);
            refl += uLampColor * lamp * 0.8;
            ${spillOn && opts.wet ? "refl += psxSpillWet(vPsxWorld, rr) * 0.05;" : ""}
            // shallow, a little brown: the ground under it, darker
            vec3 under = gl_FragColor.rgb * vec3(0.52, 0.48, 0.42);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(under, refl, F), water);
          }
        }`
            : ""
        }
        vec3 halo = uLampColor * glow * uScatter;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        // in-scatter sits in the air between eye and surface
        gl_FragColor.rgb += halo * (0.35 + 0.65 * fogFactor);
      }
      #endif`,
    );
    // (bump part, the bump audit 2026-09-26) an atlas material's bump map is read in its cell, as its colour is
    if (opts.atlas) fs = fs.replace("#include <bumpmap_pars_fragment>", atlasBumpGlsl(opts.atlas));
    shader.fragmentShader = fs;
  };
  // M7 rendering (world/cull.ts): how far the fog lets this material show, and water (waves reach over the sheet)
  mat.userData.psx = { fogReach: opts.fogReach ?? 1, water: !!opts.water };
  mat.customProgramCacheKey = () => `psx-${opts.water ? 2 : 0}-${opts.noSnap ? 1 : 0}-${opts.atlas ?? 0}-${opts.fogReach ?? 1}${opts.wet ? "-wet" : ""}${opts.puddles ? `-pud${opts.puddles}` : ""}${opts.relief ? `-rel${opts.relief.tile}${opts.relief.id ? `-id${opts.relief.holes ?? 0}` : ""}${opts.relief.reach ? `-r${opts.relief.reach}` : ""}` : ""}${opts.vary ? `-v${opts.vary}` : ""}${opts.detile ? "-dt" : ""}${opts.slabs ? `-slab${opts.slabs.tile}-${opts.slabs.yMax}` : ""}${opts.foot ? `-foot${opts.foot.amount}${opts.foot.vertexWear ? "w" : ""}` : ""}${opts.mottle ? `-mot${opts.mottle}` : ""}${opts.spill === false ? "-nosp" : ""}`;
  return mat;
}

/**
 * The foot of the walls (and the mottle) on a material already made with psx(), for a module that builds its own
 * materials (the cathedral's outside, world/cathedralOutside.ts: one call in its material factory). The same as the
 * psx options `foot: { amount }` and `mottle`.
 */
export function footDirt<T extends THREE.Material>(mat: T, amount = 0.5, mottle = 0): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    if (!shader.fragmentShader.includes("varying vec3 vPsxWorld;") || shader.fragmentShader.includes("vec3 psxFootDirt(")) return;
    shader.uniforms.uDirt = psxUniforms.uDirt;
    shader.uniforms.uDirtBox = psxUniforms.uDirtBox;
    let fs = shader.fragmentShader;
    const head =
      (fs.includes("float pudHash(") ? "" : pudNoiseGlsl) + (fs.includes("uniform sampler2D uDirt;") ? "" : "uniform sampler2D uDirt;\nuniform vec4 uDirtBox;\n") + footGlsl;
    fs = fs.replace("void main() {", head + "\nvoid main() {");
    fs = fs.replace(
      "#include <emissivemap_fragment>",
      `{
        ${mottle > 0 ? `diffuseColor.rgb = psxMottle(diffuseColor.rgb, ${mottle.toFixed(2)});` : ""}
        diffuseColor.rgb = psxFootDirt(diffuseColor.rgb, ${amount.toFixed(2)});
      }
      #include <emissivemap_fragment>`,
    );
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `${prevKey()}-footdirt${amount}-${mottle}`;
  mat.needsUpdate = true;
  return mat;
}

// --- Bump maps on the house walls (Steve, 2026-09-26: "do bump mapping on all buildings") ---
// The plain wall of the houses is a picture per layer of a texture array (world/houseGrime.ts WALL_PICS). Each
// picture has a height map made from it by tools/textures/wall_heights.py (brick and stone faces high with rounded
// arrises, the joints sunk; plaster nearly flat with its lumps and cracks; roughcast small lumps). The wall's normal
// is tilted by it, so the sky light, the sun and the gas lamps pick out the courses as real light does, and the joints
// are darkened (they get less light). A height map is used only when wall_heights.json names it with the hash of the
// picture it was made from: a picture replaced without running the tool again gets a flat wall, never old bricks.

const WALL_H = 512;
/** How hard each kind of wall stands out (plaster pictures are flattened in houseGrime.ts: their relief is too). */
const WALL_KIND_BUMP: Record<string, number> = { brick: 1, plaster: 0.12, rough: 0.18 };

const wallReliefU = {
  uWallH: { value: null as THREE.DataArrayTexture | null },
  /** Per layer: 0 = no height map (flat), else how strong. */
  uWallHK: { value: [] as number[] },
  /** Per layer: where a bed joint runs across the picture (v, 0..1), from its height map; -1 = no courses (no bands). */
  uWallBed: { value: [] as number[] },
};

/**
 * The row of a height map that is most nearly all joint from side to side (a bed joint of the courses), as v 0..1,
 * or -1 when no row is (plaster, or courses that wander). The joints are the lowest third of the map; a row counts
 * when, within 2 px up or down, 96 % of its columns are joint.
 */
function bedJoint(h: Uint8Array, off: number): number {
  const N = WALL_H;
  const hist = new Uint32Array(256);
  for (let p = 0; p < N * N; p++) hist[h[off + p]]++;
  let acc = 0;
  let p30 = 0;
  while (p30 < 255 && (acc += hist[p30]) < N * N * 0.3) p30++;
  let best = -1;
  let bestCov = 0;
  for (let r = 0; r < N; r++) {
    let cov = 0;
    for (let x = 0; x < N; x++) {
      let lo = 255;
      for (let d = -2; d <= 2; d++) lo = Math.min(lo, h[off + (((r + d + N) % N) * N) + x]);
      if (lo < p30) cov++;
    }
    if (cov > bestCov) (bestCov = cov), (best = r);
  }
  return bestCov >= N * 0.96 ? (best + 0.5) / N : -1;
}

async function sha256(url: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await (await fetch(url)).arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function wallHeights(names: string[]): void {
  const n = names.length;
  const data = new Uint8Array(WALL_H * WALL_H * n);
  const t = new THREE.DataArrayTexture(data, WALL_H, WALL_H, n);
  t.format = THREE.RedFormat;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  wallReliefU.uWallH.value = t;
  wallReliefU.uWallHK.value = names.map(() => 0);
  wallReliefU.uWallBed.value = names.map(() => -1);
  const c = document.createElement("canvas");
  c.width = c.height = WALL_H;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  const load = (url: string) =>
    new Promise<HTMLImageElement>((ok, no) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => no(new Error(url));
      img.src = url;
    });
  fetch("/textures/wall_heights.json")
    .then((r) => r.json() as Promise<Record<string, { sha256: string; kind: string; bump?: number }>>)
    .then(async (made) => {
      const k = names.map(() => 0);
      const bed = names.map(() => -1);
      await Promise.all(
        names.map(async (name, i) => {
          const m = made[name];
          if (!m) return;
          const sha = await sha256(`/textures/wall_${name}.jpg`).catch(() => null);
          if (sha && sha !== m.sha256) {
            console.warn(`wall_${name}_h.png was made from another picture: that wall stays flat (run tools/textures/wall_heights.py ${name})`);
            return;
          }
          const img = await load(`/textures/wall_${name}_h.png`);
          g.drawImage(img, 0, 0, WALL_H, WALL_H);
          const px = g.getImageData(0, 0, WALL_H, WALL_H).data;
          const off = i * WALL_H * WALL_H;
          for (let p = 0; p < WALL_H * WALL_H; p++) data[off + p] = px[p * 4];
          k[i] = m.bump ?? WALL_KIND_BUMP[m.kind] ?? 1;
          // (bricks and stones only: the colour and the height map take the bands together, so both wait for this)
          if (m.kind === "brick") bed[i] = bedJoint(data, off);
        }),
      );
      t.needsUpdate = true;
      wallReliefU.uWallHK.value = k;
      wallReliefU.uWallBed.value = bed;
    })
    .catch((e) => console.warn("wall height maps did not load: the walls stay flat", e));
}

/**
 * The GLSL: `wallTileUv(layer, w / tile, key)` gives the picture's uv (the bands, anti-tiling) and its mirror, for the
 * colour and the relief alike; `wallRelief(layer, uv, mirror, wn)` in the house material's colour code (houseGrime.ts,
 * inside #ifdef WALL_RELIEF) returns the darkening of the joints and a little sky light on the tops, and leaves the
 * tilt for the lights in gWallDN (world space), which the normal takes after normal_fragment_maps.
 */
const wallReliefGlsl = /* glsl */ `
#define WALL_RELIEF
uniform highp sampler2DArray uWallH;
uniform float uWallHK[WALL_LAYERS];
uniform float uWallBed[WALL_LAYERS];
vec3 gWallDN = vec3(0.0);
// (the gradients of the untouched uv: at a band's edge the shifted uv jumps, and the mip would jump with it)
vec2 gWallGx = vec2(0.0);
vec2 gWallGy = vec2(0.0);
float wallH(vec2 uv, float layer) { return textureGrad(uWallH, vec3(uv, layer), gWallGx, gWallGy).r; }
// Anti-tiling (Steve, 2026-09-26: "big flat sides ... repeating textures"): a wall of bricks or stones is cut into
// bands one picture high, each cut on a bed joint of the picture (uWallBed, found in its height map), and every band
// slid along the wall by its own dice and now and then mirrored. The courses run on unbroken, the bond changes at the
// joint as a real wall's does, and no picture sits over the one below it. The colour, the height map and every later
// sample take this same uv, so the bumps lie under the bricks drawn. Plaster and render (no courses): no bands.
// Returns the picture's uv and the mirror (1 or -1); raw = w / tile, key = the wall's own dice.
vec3 wallTileUv(float layer, vec2 raw, float key) {
  gWallGx = dFdx(raw);
  gWallGy = dFdy(raw);
  float ph = uWallBed[int(layer)];
  if (ph < 0.0) return vec3(raw, 1.0);
  float b = floor(raw.y - ph);
  float h = fract(sin(b * 12.9898 + key * 78.233) * 43758.5453);
  float f = fract(h * 91.7) < 0.35 ? -1.0 : 1.0;
  return vec3(raw.x * f + h * 5.0, raw.y, f);
}
float wallRelief(float layer, vec2 uv, float flip, vec3 wn) {
  // how many texels of the height map one pixel covers: the step grows with it (so the slope is the mip's, not the
  // base map's: small courses at 5 to 10 m striped like corrugated sheet), and the relief fades where the joints get
  // smaller than a pixel or two (the lead's review, 2026-09-26)
  float fp = max(length(gWallGx), length(gWallGy)) * ${WALL_H.toFixed(1)};
  float k = uWallHK[int(layer)];
  float fade = (1.0 - smoothstep(10.0, 28.0, length(vPsxWorld - cameraPosition))) * (1.0 - smoothstep(2.5, 5.0, fp));
  if (k <= 0.0 || fade <= 0.0 || abs(wn.y) > 0.7) return 1.0;
  // two texels of the 512 px map near (about 7 mm on a 1.9 m brick tile), a pixel's worth further off
  float e = max(2.0, fp) / ${WALL_H.toFixed(1)};
  float h = wallH(uv, layer);
  // (a mirrored band runs the picture backwards along the wall: its slope along turns round with it)
  float dU = (wallH(uv + vec2(e, 0.0), layer) - wallH(uv - vec2(e, 0.0), layer)) * flip;
  float dV = wallH(uv + vec2(0.0, e), layer) - wallH(uv - vec2(0.0, e), layer);
  // the wall's own frame, as houseGrime.ts gWallUv lays the picture: along (u) and up (v)
  vec3 along = normalize(vec3(-wn.z, 0.0, wn.x));
  vec3 up = vec3(0.0, 1.0, 0.0);
  float b = 2.0 * k * fade;
  vec3 nW = normalize(wn - along * dU * b - up * dV * b);
  gWallDN = nW - wn;
  // a little sky light on the tops (it reads in any light, as the ground's relief does), the joints in shade
  vec3 L = normalize(up * 0.8 - along * 0.3 + wn * 0.5);
  float lit = clamp(dot(nW, L), 0.0, 1.0) / max(dot(wn, L), 0.3);
  float ao = (0.7 + 0.36 * h) / (0.7 + 0.36 * 0.8);
  return mix(1.0, mix(1.0, lit, 0.35) * mix(1.0, ao, k), fade);
}
`;

/**
 * Put the wall relief on a house material that houseGrime.ts has dressed (its #ifdef WALL_RELIEF line calls it).
 * `names` are the texture array's layers in order (houseGrime.ts WALL_PICS).
 */
export function wallRelief(mat: THREE.Material, names: string[]): void {
  if (!wallReliefU.uWallH.value) wallHeights(names);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, wallReliefU);
    let fs = shader.fragmentShader;
    // (before main: vPsxWorld is declared by then; the functions go before the first use in main)
    fs = fs.replace("void main() {", wallReliefGlsl.replaceAll("WALL_LAYERS", String(names.length)) + "\nvoid main() {");
    fs = fs.replace(
      "#include <normal_fragment_maps>",
      "#include <normal_fragment_maps>\n  normal = normalize(normal + faceDirection * (viewMatrix * vec4(gWallDN, 0.0)).xyz);",
    );
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `${prevKey()}-wallrelief`;
  mat.needsUpdate = true;
}

// --- Bump maps on every floor (Steve, 2026-09-26: "the floor over all of town is not all bump-mapped: do all") ---
// The painted textures of the pavements, kerbs, edge stones, stone flights, decks and the floors inside (flags,
// boards, tiles, slabs) get a height map worked out from their own colour (light stone high, dark joints low, the
// fine grain smoothed), so the bump can never disagree with the picture. It goes in as three.js's own bumpMap: the
// normal is tilted with the screen-space derivatives of the uv, so it works on any face and any uv layout and reads
// under the sun, the sky and the gas lamps. Not for atlas materials (their uv is remapped per cell in psx). A texture
// swapped for a picture later (withPicture) gets its height made again from the picture.

const bumpCache = new WeakMap<THREE.Texture, THREE.Texture>();
/** (the bump audit) the sharp ones: small pictures made bigger first, so a joint's slope is a fraction of a texel */
const sharpCache = new WeakMap<THREE.Texture, THREE.Texture>();

/** A box blur that wraps (the textures tile), `r` texels each way, on a w x h field. */
function wrapBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const n = 2 * r + 1;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let d = -r; d <= r; d++) s += src[row + (((d % w) + w) % w)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / n;
      s += src[row + ((x + r + 1) % w)] - src[row + ((((x - r) % w) + w) % w)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let d = -r; d <= r; d++) s += tmp[(((d % h) + h) % h) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n;
      s += tmp[((y + r + 1) % h) * w + x] - tmp[((((y - r) % h) + h) % h) * w + x];
    }
  }
  return out;
}

/** (bump part, the bump audit) The pictures waiting to be read back for a sharp height map, and their jobs. */
const sharpJobs: Array<{ img: CanvasImageSource; w: number; h: number; done: (px: ImageData) => void }> = [];
let sharpTimer: ReturnType<typeof setTimeout> | null = null;

function sharpRead(img: CanvasImageSource, w: number, h: number, done: (px: ImageData) => void): void {
  sharpJobs.push({ img, w, h, done });
  sharpTimer ??= setTimeout(sharpFlush, 0);
}

/**
 * Every picture waiting is drawn into one sheet on the GPU (copies, no waiting) and the sheet read back once; the
 * height maps are then worked out in slices of about 25 ms, so the loading and the game never stand still for them.
 */
function sharpFlush(): void {
  sharpTimer = null;
  const jobs = sharpJobs.splice(0);
  const SW = 2048;
  const SH = 4096;
  const ready: Array<{ px: ImageData; done: (px: ImageData) => void }> = [];
  while (jobs.length) {
    let x = 0;
    let y = 0;
    let rowH = 0;
    const put: Array<[number, number]> = [];
    let n = 0;
    for (; n < jobs.length; n++) {
      const j = jobs[n];
      if (x + j.w > SW) {
        x = 0;
        y += rowH;
        rowH = 0;
      }
      if (y + j.h > SH && n > 0) break;
      put.push([x, y]);
      x += j.w;
      rowH = Math.max(rowH, j.h);
    }
    const batch = jobs.splice(0, n);
    const sheet = document.createElement("canvas");
    sheet.width = SW;
    sheet.height = Math.max(1, y + rowH);
    const g = sheet.getContext("2d")!;
    batch.forEach((j, i) => g.drawImage(j.img, put[i][0], put[i][1], j.w, j.h));
    const all = g.getImageData(0, 0, sheet.width, sheet.height).data;
    batch.forEach((j, i) => {
      const px = new ImageData(j.w, j.h);
      for (let r = 0; r < j.h; r++) {
        const from = ((put[i][1] + r) * SW + put[i][0]) * 4;
        px.data.set(all.subarray(from, from + j.w * 4), r * j.w * 4);
      }
      ready.push({ px, done: j.done });
    });
  }
  const work = () => {
    const t0 = performance.now();
    while (ready.length && performance.now() - t0 < 25) {
      const r = ready.shift()!;
      try {
        r.done(r.px);
      } catch (e) {
        console.warn("bump: a height map was not made", e);
      }
    }
    if (ready.length) setTimeout(work, 0);
  };
  work();
}

function heightFromColour(map: THREE.Texture, sharp = false): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 4;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = map.wrapS;
  t.wrapT = map.wrapT;
  t.repeat.copy(map.repeat);
  t.offset.copy(map.offset);
  t.center.copy(map.center);
  t.rotation = map.rotation;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  const fill = () => {
    const img = map.image as { width: number; height: number } & CanvasImageSource;
    if (!img?.width) return;
    const k = Math.min(1, 512 / Math.max(img.width, img.height));
    const w = Math.max(4, Math.round(img.width * k));
    const h = Math.max(4, Math.round(img.height * k));
    // (bump part, the bump audit) the sharp ones are read back together, a few times a second at most: reading one
    // painted canvas back from the GPU stalls it for 10 to 20 ms, and there are some 200 of them
    if (sharp) sharpRead(img, w, h, make);
    else {
      c.width = w;
      c.height = h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0, w, h);
      make(g.getImageData(0, 0, w, h));
    }
  };
  const make = (px: ImageData) => {
    const w = px.width;
    const h = px.height;
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = (px.data[i * 4] * 0.3 + px.data[i * 4 + 1] * 0.59 + px.data[i * 4 + 2] * 0.11) / 255;
    // a box blur that wraps (the textures tile), twice: the stone's own level round each texel
    // (boot, the loading screen: as a running sum along each row, then each column; the same numbers as
    // adding up the 2r + 1 texels each time, 5 times faster: this ran for seconds while the town loaded)
    const blur = (src: Float32Array, r: number) => {
      const n = 2 * r + 1;
      const tmp = new Float32Array(w * h);
      const out = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = y * w;
        let s = 0;
        for (let d = -r; d <= r; d++) s += src[row + (((d % w) + w) % w)];
        for (let x = 0; x < w; x++) {
          tmp[row + x] = s / n;
          s += src[row + ((x + r + 1) % w)] - src[row + ((((x - r) % w) + w) % w)];
        }
      }
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += tmp[(((d % h) + h) % h) * w + x];
        for (let y = 0; y < h; y++) {
          out[y * w + x] = s / n;
          s += tmp[((y + r + 1) % h) * w + x] - tmp[((((y - r) % h) + h) % h) * w + x];
        }
      }
      return out;
    };
    const R = Math.max(2, Math.round(Math.min(w, h) / 16));
    const low = blur(blur(lum, R), R);
    const hp = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) hp[i] = lum[i] - low[i];
    // the 98th percentile of the relief's size (bump part, the bump audit: counted in 4096 bins, not sorted: the same
    // number to a 4096th of the largest, and a sort of a 512 px map took 20 ms)
    let most = 0;
    for (let i = 0; i < w * h; i++) most = Math.max(most, Math.abs(hp[i]));
    const bins = new Uint32Array(4096);
    const toBin = 4095 / (most || 1);
    for (let i = 0; i < w * h; i++) bins[Math.round(Math.abs(hp[i]) * toBin)]++;
    let seen = 0;
    let b98 = 0;
    const want = Math.floor(w * h * 0.98) + 1;
    while (b98 < 4095 && (seen += bins[b98]) < want) b98++;
    const top = b98 / toBin || 1;
    // (bump part, the bump audit 2026-09-26) sharp: a small picture drawn pixel sharp (64 px a metre and less) had
    // joints a few centimetres wide in its height, too gentle a slope to light: each texel made u x u first, the
    // steps between them smoothed over a third of a texel, so the joints are as sharp as the picture's own pixels
    const u = sharp ? Math.max(1, Math.min(8, Math.floor(256 / Math.max(w, h)))) : 1;
    if (u > 1) {
      const W = w * u;
      const H = h * u;
      let big: Float32Array = new Float32Array(W * H);
      for (let y = 0; y < H; y++) {
        const sy = ((y / u) | 0) * w;
        for (let x = 0; x < W; x++) big[y * W + x] = Math.min(1, Math.max(0, 0.5 + (0.5 * hp[sy + ((x / u) | 0)]) / top));
      }
      const r = Math.max(1, Math.round(u / 4));
      big = wrapBlur(wrapBlur(big, W, H, r), W, H, r);
      c.width = W;
      c.height = H;
      const pb = g.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const v = Math.round(255 * big[i]);
        pb.data[i * 4] = pb.data[i * 4 + 1] = pb.data[i * 4 + 2] = v;
        pb.data[i * 4 + 3] = 255;
      }
      g.putImageData(pb, 0, 0);
    } else {
      const fine = blur(hp, 1);
      for (let i = 0; i < w * h; i++) {
        const v = Math.round(255 * Math.min(1, Math.max(0, 0.5 + (0.5 * fine[i]) / top)));
        px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = v;
        px.data[i * 4 + 3] = 255;
      }
      g.putImageData(px, 0, 0);
    }
    t.flipY = map.flipY;
    t.dispose();
    t.needsUpdate = true;
  };
  const img = map.image as HTMLImageElement | undefined;
  if (img instanceof HTMLImageElement && !img.complete) img.addEventListener("load", fill, { once: true });
  else fill();
  // (the churches' bump maps, 2026-09-26: a stand-in swapped for its picture later (world/quayStone.ts withPicture) takes
  // its height map along, made again from the picture, so the relief is never the stand-in's)
  const prev = map.userData.onPicture as (() => void) | undefined;
  map.userData.onPicture = () => {
    prev?.();
    fill();
  };
  return t;
}

/**
 * The bump of an atlas material (the bump audit, 2026-09-26: the boats, the props, the roofs): three.js's bump reads its
 * map at the mesh's own uv, but an atlas material draws each face from its cell (psx `atlas`: the uv repeats inside the
 * cell). This reads the height map (made from the whole atlas picture) in the same cell, the neighbours one screen pixel
 * over wrapped inside it too, so the bumps lie under the picture drawn and no cell bleeds into the next.
 */
function atlasBumpGlsl(n: number): string {
  const N = n.toFixed(1);
  return /* glsl */ `
#ifdef USE_BUMPMAP
  uniform sampler2D bumpMap;
  uniform float bumpScale;
  vec2 dHdxy_fwd() {
    vec2 raw = vBumpMapUv;
    vec2 dx = dFdx(raw);
    vec2 dy = dFdy(raw);
    vec2 gx = dx / ${N};
    vec2 gy = dy / ${N};
    float Hll = bumpScale * textureGrad(bumpMap, (vCell + fract(raw)) / ${N}, gx, gy).x;
    float dBx = bumpScale * textureGrad(bumpMap, (vCell + fract(raw + dx)) / ${N}, gx, gy).x - Hll;
    float dBy = bumpScale * textureGrad(bumpMap, (vCell + fract(raw + dy)) / ${N}, gx, gy).x - Hll;
    return vec2(dBx, dBy);
  }
  vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
    vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
    vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
    vec3 vN = surf_norm;
    vec3 R1 = cross(vSigmaY, vN);
    vec3 R2 = cross(vN, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
#endif
`;
}

/**
 * A bump map from the material's own colour map. `depth`: three.js's bumpScale, which tilts the normal by the height's
 * change from one screen pixel to the next (about 1 for stone, 0.8 for wood, 0.2 for cloth). A value under 0.05 is
 * read as metres, 1 cm = 1.0 (the bump audit, 2026-09-26: the floors were given 0.003 to 0.012 "metres", which three.js
 * r186 draws as nothing). `sharp`: a small picture's height map made bigger first (world/bumps.ts uses it).
 */
export function bumpFromMap<T extends THREE.Material>(mat: T, depth = 0.01, sharp = false): T {
  const m = mat as unknown as THREE.MeshLambertMaterial;
  if (!m.map) return mat;
  const cache = sharp ? sharpCache : bumpCache;
  let h = cache.get(m.map);
  if (!h) cache.set(m.map, (h = heightFromColour(m.map, sharp)));
  m.bumpMap = h;
  m.bumpScale = depth < 0.05 ? depth * 100 : depth;
  if (depth < 0.05) m.userData.bumpBefore = depth; // (the bump audit's before and after pictures)
  m.needsUpdate = true;
  return mat;
}
