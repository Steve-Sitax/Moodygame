import * as THREE from "three";
import { psx, psxUniforms } from "../../retro/psx";
import { TARGET_HEIGHT } from "../../retro/retroPass";
import type { World } from "../rijnkaai";
import type { Wind } from "./wind";

// M7 alive (docs/milestones/M7-alive.md): what every part of the town's small life shares. The
// frame (the clock, the weather, the rain, the dark, the fog), a seeded random, the shader bits of
// point sprites (the PS1 snap and the fog, as world/ambient.ts does them), and a flock of small
// birds in one instanced mesh with beating wings.

export type Weather = "fog" | "mist" | "clear" | "rain" | "storm";

/** Once a frame, for every part. */
export interface Frame {
  t: number;
  dt: number;
  cam: THREE.Camera;
  /** The camera's place (Jef's eye). */
  eye: THREE.Vector3;
  /** Game hour, 0-24 with fractions. */
  hour: number;
  day: number;
  weather: Weather;
  /** 0 by day, 1 at night (as world/ambient.ts: a dark day darkens earlier). */
  night: number;
  /** Rain falling now, 0..1 (psx uRain), and the ground's wetness (uWet). */
  rain: number;
  wet: number;
  /** The fog's far end now (metres): nothing is drawn or moved beyond it. */
  fogFar: number;
  /** Cold, 0..1: the night and early morning, fog and a clear sky (autumn). */
  cold: number;
}

/** A code-made sound at a place (audio/soundscape.ts placed()). */
export interface AliveSound {
  placed(
    at: { x: number; y?: number; z: number },
    o: { ref: number; reach: number; max: number; rolloff?: number; wet?: number; occl?: number; gain?: number; must?: boolean },
    make: (ctx: BaseAudioContext, out: AudioNode, t0: number, noise: AudioBuffer) => number,
  ): boolean;
}

export interface Ctx {
  scene: THREE.Scene;
  world: World;
  /** The walk map: 0 = open ground, 1 wall, 2 water, 4 outside; undefined before it is in. */
  flags: (x: number, z: number) => number | undefined;
  wind: Wind;
  sound: () => AliveSound | null;
}

/** One part of the town's life. */
export interface Part {
  name: string;
  update(f: Frame): void;
  info(): Record<string, unknown>;
  /** Dev: switched off, it shows nothing and costs nothing. */
  setOn(on: boolean): void;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const ramp = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
/** 1 inside [a, b] of the day's hours (wrapping midnight when a > b), easing over `e` hours at each end. */
export function hours(h: number, a: number, b: number, e = 0.5): number {
  const inside = (x: number) => (a <= b ? x >= a && x <= b : x >= a || x <= b);
  if (!inside(h)) return 0;
  const da = (h - a + 24) % 24;
  const db = (b - h + 24) % 24;
  return clamp01(Math.min(da, db) / e);
}

/** Open street ground with room round it (r metres each way). */
export function openAt(flags: Ctx["flags"], x: number, z: number, r = 0.6): boolean {
  return flags(x, z) === 0 && flags(x + r, z) === 0 && flags(x - r, z) === 0 && flags(x, z + r) === 0 && flags(x, z - r) === 0;
}

// ------------------------------------------------------------------ point sprites

/** Point sizes are in the render target's pixels (settings change it: main.ts). */
export const VIEW_H = { value: TARGET_HEIGHT };
export function setAliveViewHeight(h: number): void {
  VIEW_H.value = h;
}

export const VCOMMON = /* glsl */ `
uniform vec2 uSnapRes;
uniform float uTime;
uniform float uViewH;
varying float vFogDepth;
vec4 psxSnap(vec4 p) {
  vec2 ndc = p.xy / p.w;
  vec2 s = floor(ndc * uSnapRes + 0.5) / uSnapRes;
  p.xy = mix(ndc, s, smoothstep(1.5, 4.0, p.w)) * p.w;
  return p;
}
float pointPx(float metres, vec4 clip) { return metres * projectionMatrix[1][1] * uViewH * 0.5 / max(clip.w, 0.1); }
`;

export const FCOMMON = /* glsl */ `
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying float vFogDepth;
float fogK() { return smoothstep(fogNear, fogFar, vFogDepth); }
float hash12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

export const TIME = { value: 0 };

export function pointMat(p: { vertexShader: string; fragmentShader: string; uniforms?: Record<string, THREE.IUniform>; additive?: boolean; fogReach?: number }): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uSnapRes: psxUniforms.uSnapRes,
      uTime: TIME,
      uViewH: VIEW_H,
      ...(p.uniforms ?? {}),
    },
    vertexShader: p.vertexShader,
    fragmentShader: p.fragmentShader,
    fog: true,
    transparent: true,
    depthWrite: false,
    blending: p.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  m.userData.fogReach = p.fogReach ?? 1;
  return m;
}

/** A colour written as it should look (sRGB 0..1) into the linear values vertex colours take. */
export function srgb(r: number, g: number, b: number): number[] {
  const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

// ------------------------------------------------------------------ small birds

/** A bird's shape (forward +z, wings along x), coloured, `span` metres wingtip to wingtip. */
/** `plump`: a fuller body than a gull's (a sparrow is mostly body). */
export function birdShape(span: number, body: number[], wing: number[], tip: number[], beak: number[], long = 1, plump = 1): THREE.BufferGeometry {
  const P: number[] = [];
  const C: number[] = [];
  const k = span / 1.32;
  [body, wing, tip, beak] = [body, wing, tip, beak].map((c) => srgb(c[0], c[1], c[2]));
  const tri = (a: number[], b: number[], c: number[], col: number[]) => {
    P.push(...a.map((v) => v * k), ...b.map((v) => v * k), ...c.map((v) => v * k));
    C.push(...col, ...col, ...col);
  };
  const nose = [0, 0.02, 0.28 * long];
  const tail = [0, 0.0, -0.24 * long];
  const top = [0, 0.08 * plump, 0.02];
  const bot = [0, -0.07 * plump, 0.03];
  const l = [-0.085, 0, 0.03]; // (not wider: the wing fold starts at 0.05)
  const r = [0.085, 0, 0.03];
  tri(nose, r, top, body);
  tri(nose, top, l, body);
  tri(nose, bot, r, body);
  tri(nose, l, bot, body);
  tri(tail, top, r, body);
  tri(tail, l, top, body);
  tri(tail, r, bot, body);
  tri(tail, bot, l, body);
  tri([0, 0.03, 0.34 * long], [-0.02, 0.015, 0.27 * long], [0.02, 0.015, 0.27 * long], beak);
  tri([-0.08, 0.01, -0.36 * long], [0.08, 0.01, -0.36 * long], [0, 0.01, -0.18 * long], wing);
  for (const s of [-1, 1]) {
    const rf = [s * 0.07, 0.012, 0.09];
    const rb = [s * 0.07, 0.012, -0.08];
    const mf = [s * 0.36, 0.02, 0.07];
    const mb = [s * 0.36, 0.02, -0.11];
    const tp = [s * 0.66, 0.0, -0.1];
    tri(rf, mf, mb, wing);
    tri(rf, mb, rb, wing);
    tri(mf, tp, mb, tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Birds (or bats) in one instanced mesh: set each one's place, heading, size and wings every frame.
 * The wings beat about the body (aWing.x, radians) or fold along the back (aWing.y), in the shader.
 */
export class Flight {
  readonly mesh: THREE.InstancedMesh;
  private wing: THREE.InstancedBufferAttribute;
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, "YXZ");
  private s = new THREE.Vector3();
  private n = 0;
  /** `span`: the shape's wingspan (birdShape): the fold is worked out in the bird's own size. */
  constructor(geo: THREE.BufferGeometry, readonly max: number, name: string, span = 1.32) {
    const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), { affine: 0 });
    const base = mat.onBeforeCompile;
    const k = { value: span / 1.32 };
    mat.onBeforeCompile = (shader, renderer) => {
      base.call(mat, shader, renderer);
      shader.uniforms.uBirdK = k;
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec2 aWing;\nuniform float uBirdK;").replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          float ax = abs(transformed.x) / uBirdK;
          float wing = smoothstep(0.05, 0.08, ax);
          float a = aWing.x * wing * (1.0 + 0.5 * smoothstep(0.2, 0.45, ax));
          float bx = mix(ax * cos(a), ax * 0.18, aWing.y * wing) * uBirdK;
          float by = mix(ax * sin(a), 0.03, aWing.y * wing) * uBirdK;
          ax *= uBirdK;
          transformed.z -= aWing.y * wing * ax * 0.45;
          transformed.x = sign(transformed.x) * mix(ax, bx, wing);
          transformed.y += by * wing;
        }`,
      );
    };
    mat.customProgramCacheKey = () => "alive-flight";
    this.wing = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2);
    this.wing.setUsage(THREE.DynamicDrawUsage);
    const g = geo.clone();
    g.setAttribute("aWing", this.wing);
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = name;
  }
  begin(): void {
    this.n = 0;
  }
  add(p: THREE.Vector3, yaw: number, pitch: number, roll: number, scale: number, flap: number, fold: number, color?: THREE.Color): void {
    if (this.n >= this.max) return;
    if (color) this.mesh.setColorAt(this.n, color);
    this.e.set(pitch, yaw, roll);
    this.q.setFromEuler(this.e);
    this.m4.compose(p, this.q, this.s.set(scale, scale, scale));
    this.mesh.setMatrixAt(this.n, this.m4);
    this.wing.setXY(this.n, flap, fold);
    this.n++;
  }
  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.wing.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  get count(): number {
    return this.n;
  }
}
