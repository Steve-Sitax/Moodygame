import * as THREE from "three";

// PS1-style material patch: vertex snap, affine texture warp, and fog that
// picks up warm light from the gas lamps (analytic in-scatter per lamp).
// Numbers here are look settings from docs/05-art-direction.md.

export const MAX_LAMPS = 6;

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
  uDirtBox: { value: new THREE.Vector4(-340, -80, 540, 380) },
  /** Sea state: 1 = the river's usual chop, about 3.5 = a storm (world/rijnkaai.ts eases it by weather). */
  uSea: { value: 1 },
  /** Puddles on the ground, 0..1 (world/ambient.ts: rain fills them, a sunny day dries them). */
  uPuddle: { value: 0 },
  /** The ground mirror (world/mirror.ts): the street seen from under the paving. */
  uMirror: { value: null as THREE.Texture | null },
  uMirrorMat: { value: new THREE.Matrix4() },
  /** Where water lies: a soft tiling noise (low spots fill first). */
  uPudNoise: { value: null as THREE.Texture | null },
};

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
  };
  /**
   * Large, soft patches of lighter and darker stone (worn, repaired, dirtier) over flat
   * ground, so a tiled paving does not look like one repeated pattern. 0..1 strength.
   */
  vary?: number;
  /** Break up the tiling of a ground texture: a second, turned and scaled sample blended in by a slow noise (needs vary). */
  detile?: boolean;
}

const commonVertex = /* glsl */ `
uniform float uSea;
uniform vec2 uSnapRes;
uniform float uTime;
varying vec3 vPsxWorld;
#ifdef USE_MAP
varying vec3 vAffineUv;
#endif
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
  return tight + wide * 0.22 * smoothstep(14.0, 4.0, d);
}
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
    if (opts.vary) {
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
    fs = fs.replace(
      "#include <common>",
      "#include <common>\n" +
        commonFragment +
        (opts.atlas ? "varying vec2 vCell;\n" : "") +
        (opts.wet || opts.water ? wetFragment : "") +
        (opts.puddles ? "uniform float uPuddle;\nuniform sampler2D uMirror;\nuniform mat4 uMirrorMat;\nuniform sampler2D uPudNoise;\n" : "") +
        (opts.wet || opts.puddles || opts.vary ? pudNoiseGlsl : "") +
        (opts.vary ? "uniform sampler2D uDirt;\nuniform vec4 uDirtBox;\n" : "") +
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
          for (int i = 0; i < 14; i++) {
            if (depth >= hDepth) break;
            ruv += duv;
            hDepth = 1.0 - psxRelH(ruv, psxWear);
            depth += dl;
          }
          psxUv = ruv;
        }`
            : ""
        }
        vec4 sampledDiffuseColor = texture2D(map, psxUv);
        ${
          opts.detile
            ? `{
          // no tile repeats in a grid: where a slow noise says so, the same texture turned 37 deg and scaled
          vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * psxUv * 0.77 + vec2(0.31, 0.57);
          float dm = smoothstep(0.35, 0.65, pudVal(vPsxWorld.xz / 7.0));
          sampledDiffuseColor = mix(sampledDiffuseColor, texture2D(map, uv2), dm);
        }`
            : ""
        }
        diffuseColor *= sampledDiffuseColor;
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
          float e = 1.0 / 128.0;
          float hC = psxRelH(psxUv, psxWear);
          psxH = hC;
          float hX = psxRelH(psxUv + vec2(e, 0.0), psxWear) - psxRelH(psxUv - vec2(e, 0.0), psxWear);
          float hZ = psxRelH(psxUv + vec2(0.0, e), psxWear) - psxRelH(psxUv - vec2(0.0, e), psxWear);
          vec3 rn = normalize(vec3(-hX * uReliefBump, 1.0, -hZ * uReliefBump));
          float lit = clamp(dot(rn, normalize(vec3(-0.45, 0.8, -0.35))), 0.0, 1.0);
          // a stone that stands high catches the light; a sunk one lies in its own shade
          float relief = mix(0.6, 1.12, lit) * (0.55 + 0.45 * hC);
          // worn by the wheels: smoother, the tops polished a little lighter
          relief = mix(relief, 1.0 + 0.12 * hC, psxWear * 0.45);
          float far = smoothstep(8.0, 22.0, length(vPsxWorld - cameraPosition));
          diffuseColor.rgb *= mix(relief, 0.86, far);
          ${
            opts.relief.id
              ? `{
            vec3 sid = texture2D(uStoneId, psxUv).rgb;
            if (sid.g > 0.5) {
              float r = psxStoneR(psxUv, sid);
              vec2 ms = psxStoneMS(r, psxWear);
              // each stone its own tone: lighter, darker, warmer, bluer (the tile's tones never line up)
              vec3 st = vec3(0.8 + 0.36 * fract(r * 91.3)) * mix(vec3(1.06, 1.0, 0.9), vec3(0.94, 0.98, 1.06), fract(r * 17.9));
              // a stone gone: a hole of mud and muck; further off only a dark patch (no flicker)
              st = mix(st, vec3(0.2, 0.15, 0.1) * (0.7 + 0.6 * fract(r * 7.7)), ms.x);
              st = mix(st, st * 0.85, ms.y * (1.0 - ms.x));
              float farS = smoothstep(14.0, 30.0, length(vPsxWorld - cameraPosition));
              diffuseColor.rgb *= mix(st, vec3(mix(1.0, 0.6, ms.x)), farS);
            }
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
    fs = fs.replace(
      "#include <fog_fragment>",
      /* glsl */ `#ifdef USE_FOG
      {
        vec3 ro = cameraPosition;
        vec3 toFrag = vPsxWorld - ro;
        float len = length(toFrag);
        vec3 rd = toFrag / max(len, 1e-4);
        float glow = 0.0;
        for (int i = 0; i < MAX_LAMPS; i++) {
          glow += uLamps[i].w * lampScatter(ro, rd, len, uLamps[i].xyz);
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
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `psx-${opts.water ? 2 : 0}-${opts.noSnap ? 1 : 0}-${opts.atlas ?? 0}-${opts.fogReach ?? 1}${opts.wet ? "-wet" : ""}${opts.puddles ? `-pud${opts.puddles}` : ""}${opts.relief ? `-rel${opts.relief.tile}${opts.relief.id ? `-id${opts.relief.holes ?? 0}` : ""}` : ""}${opts.vary ? `-v${opts.vary}` : ""}${opts.detile ? "-dt" : ""}`;
  return mat;
}
