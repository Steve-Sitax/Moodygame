import * as THREE from "three";

// Carried lanterns light the world (2026-09-24, Steve: "live lighting and shadows on the ground").
//
// Every lit lantern (townspeople, the lamplighters and police, Jef's own, the ones standing where
// people work) is a source here. The nearest few to the eye get a real three.js point light from a
// fixed pool, warm and flickering like the gas lamps (world/rijnkaai.ts: the same colour, a softer decay);
// the nearest of all casts real shadows (a cube shadow map: the carrier's legs, the people round
// him). The rest get a cheap pool of light on the cobbles (one instanced decal: the warm light the
// point light would give flat stone, stopped where the ground drops away). A lantern that joins or
// leaves the pool fades over half a second, and its ground pool fades the other way: nothing pops.
//
// The pool's lights are in the scene from the start and never leave it (intensity 0 when idle), and
// the shadow ones always say castShadow: the light count and shadow count never change, so no
// shader is ever rebuilt. The shadow map is drawn 30 times a second in the main pass (the mirrors
// reuse it), only while a shadow light burns; once at the start, empty, so no draw ever samples a
// missing map (that left the world undrawn by day in a first version).

/** A lantern that may light the world. The owner moves `pos` and sets `on` every frame. */
export interface LanternSource {
  /** The flame, world coordinates. */
  readonly pos: THREE.Vector3;
  /** The ground under it (for the pool of light on the cobbles). */
  ground: number;
  /** 0 out, 1 burning: where it is going (it eases there). */
  on: number;
  /** How bright, 1 = a townsman's lantern. Jef's own sets its own, darkness included. */
  power: number;
  /** Jef's own lantern: first in the pool, not scaled by the dark (its owner does that). */
  own: boolean;
  readonly seed: number;
  /** (the pool's) eased level 0..1 */
  level: number;
}

/**
 * How dark it is for a lantern (0 by day, 1 at night) at this hour: the clock's curve that Jef's own
 * lantern and the pool use (main.ts lanternDark, deeds.ts). M7 fog lamps: the crowd's lanterns too.
 */
export function lanternDarkAt(h: number): number {
  const d = h >= 19.5 || h < 5.5 ? 1 : h >= 18 ? (h - 18) / 1.5 : h < 7 ? (7 - h) / 1.5 : 0;
  return Math.max(0, Math.min(1, d));
}

const sources = new Set<LanternSource>();
let seedN = 0;

export function addLantern(opts: { own?: boolean; power?: number } = {}): LanternSource {
  const s: LanternSource = { pos: new THREE.Vector3(0, -999, 0), ground: 0, on: 0, power: opts.power ?? 1, own: !!opts.own, seed: (seedN++ * 1.618) % 7, level: 0 };
  sources.add(s);
  return s;
}

export function removeLantern(s: LanternSource | null | undefined): void {
  if (s) sources.delete(s);
}

/**
 * People (and props) whose shadow a lantern may throw. Only those near a shadow light cast, so the
 * cube map draws a handful of bodies, not the town.
 */
interface Caster {
  root: THREE.Object3D;
  meshes: THREE.Mesh[];
  on: boolean;
}
const casters = new Map<THREE.Object3D, Caster>();

export function addCaster(root: THREE.Object3D): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  casters.set(root, { root, meshes, on: false });
}

export function removeCaster(root: THREE.Object3D): void {
  const c = casters.get(root);
  if (c) for (const m of c.meshes) m.castShadow = false;
  casters.delete(root);
}

/**
 * The warm of the gas lamps (rijnkaai.ts quay lamps: 0xffa048). They fall off with decay 1.7 from
 * 3.65 m up; a lantern hangs at the knee, so with the same decay its light would be a hot spot at the
 * feet and nothing a stride away (and its shadows would fall where there is no light to miss). A
 * softer fall-off gives the same pool of light round the carrier as the gas lamp gives round its post.
 */
const COLOR = 0xffa048;
const DECAY = 1.25;
/** A townsman's lantern: a candle behind horn, far weaker than a gas lamp (26 at 3.65 m). */
const POWER = 3.6;
const RANGE = 10;
/**
 * How many real lights, and how many of them throw shadows. Measured 2026-09-24 (RTX 5090, test save,
 * night, 13 to 34 carriers): the lights cost no CPU to speak of; the one shadow light 0.5 to 1 ms a
 * frame drawn every frame (six passes over the scene), so its map is drawn at 30 Hz (SHADOW_DT).
 */
export const POOL = 4;
export const SHADOWS = 1;
const FADE = 2.2; // per second: a lantern joins or leaves the pool in about half a second
const MAX_DECALS = 48;
/** A ground pool's radius, metres (the point light's reach on the ground that still shows). */
const POOL_R = 5;
/** The shadow map is drawn again this often, seconds. */
const SHADOW_DT = 1 / 30;
/** People who throw a shadow: within this of a shadow light. */
const CAST_REACH = 6.5;

interface Slot {
  light: THREE.PointLight;
  shadow: boolean;
  src: LanternSource | null;
  w: number;
}

/** The flicker of a candle behind horn: the gas lamps' sums, a little quicker and more restless. */
function flicker(t: number, seed: number): number {
  let v = 0.88 + Math.sin(t * 1.9 + seed * 2.1) * 0.05 + Math.sin(t * 8.3 + seed * 5.3) * 0.04 + Math.sin(t * 19.1 + seed * 1.7) * 0.03;
  const dip = Math.sin(t * 0.83 + seed * 3.3) * Math.sin(t * 2.9 + seed);
  if (dip > 0.94) v *= 0.75;
  return v;
}

export class LanternLights {
  private readonly slots: Slot[] = [];
  private readonly decals: THREE.InstancedMesh;
  private readonly decalPow: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly p = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private t = 0;
  private recvT = 0;
  private readonly ranked: Array<{ s: LanternSource; score: number; b: number }> = [];
  /** Dev: on/off (the pool's lights, the shadows, the ground pools). */
  enabled = true;
  shadows = true;
  /** Dev: false puts every lantern on the cheap ground pools (to match the two by eye). */
  lights = true;
  /**
   * The ground pools add the light the point light would give flat stone of about this brightness
   * (matched by eye to the real lights at night, 2026-09-24, the Rijnkaai). Not in proportion to the
   * stone's own colour: at night that colour is nearly black, and a pool that multiplied it would
   * blow up whatever shows behind an edge it hangs over.
   */
  readonly decalGain = { value: 0.07 };
  /** Where a ground pool must stop: the ground drops away (the quay edge, steps). Cached per lantern. */
  private readonly reach = new Map<LanternSource, { x: number; z: number; r: number }>();
  stats = { sources: 0, lit: 0, lights: 0, shadowLights: 0, decals: 0, casters: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    /** The ground's height at (x, z) (world.groundAt): a pool never hangs out over a drop. */
    private readonly groundAt: (x: number, z: number, feet: number) => number = () => 0,
  ) {
    // before any shader is built (main.ts makes this right after the renderer)
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    // the first render draws the (empty) shadow maps: see update(), "primed"
    renderer.shadowMap.needsUpdate = true;
    for (let i = 0; i < POOL; i++) {
      const light = new THREE.PointLight(COLOR, 0, RANGE, DECAY);
      light.name = `lantern_pool_${i}`;
      const shadow = i < SHADOWS;
      if (shadow) {
        light.castShadow = true;
        // PS1-coarse: 256 a face is a few cm on the cobbles near the carrier
        light.shadow.mapSize.set(256, 256);
        light.shadow.camera.near = 0.12;
        light.shadow.camera.far = RANGE;
        light.shadow.bias = -0.004;
      }
      scene.add(light);
      this.slots.push({ light, shadow, src: null, w: 0 });
    }

    // the cheap ground pools: the warm light a lantern throws on flat stone, added
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // per pool: the light at the lantern's foot (as the point light gives it), its height, the pool's radius
    this.decalPow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 3), 3);
    this.decalPow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aPow", this.decalPow);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uColor: { value: new THREE.Color(COLOR) }, uGain: this.decalGain },
      vertexShader: /* glsl */ `
        attribute vec3 aPow;
        varying vec3 vPow;
        varying vec2 vUv;
        varying float vFogDepth;
        void main() {
          vPow = aPow;
          vUv = uv;
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGain;
        uniform float fogNear;
        uniform float fogFar;
        varying vec3 vPow;
        varying vec2 vUv;
        varying float vFogDepth;
        void main() {
          // metres from the foot of the lantern (vPow.z: the pool's radius)
          float r = length(vUv * 2.0 - 1.0) * vPow.z;
          // what the point light gives flat ground, cos / d^decay, relative to the foot; soft edge
          float h = vPow.y;
          float fall = pow(h / sqrt(r * r + h * h), ${(DECAY + 1).toFixed(2)}) * smoothstep(vPow.z, vPow.z * 0.6, r);
          float fog = smoothstep(fogNear, fogFar, vFogDepth);
          gl_FragColor = vec4(uColor * vPow.x * uGain * fall * (1.0 - fog), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(geo, mat, MAX_DECALS);
    this.decals.name = "lantern_ground_pools";
    this.decals.count = 0;
    this.decals.frustumCulled = false; // M7 culler: never culled (it moves every frame)
    this.decals.renderOrder = 2;
    scene.add(this.decals);
  }

  /**
   * Once a frame, after everyone has moved their lanterns. `dark` 0 by day to 1 at night (the
   * clock, as deeds.ts reckons it for Jef's lantern).
   */
  update(dt: number, camera: THREE.Camera, dark: number): void {
    this.t += dt;
    const t = this.t;
    camera.getWorldPosition(this.p);
    camera.getWorldDirection(this.camDir);
    const cx = this.p.x;
    const cy = this.p.y;
    const cz = this.p.z;

    // every so often: everything in the scene takes the lanterns' shadows (a uniform, no rebuild)
    this.recvT -= dt;
    if (this.recvT <= 0) {
      this.recvT = 1;
      this.scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !o.receiveShadow && o !== this.decals) o.receiveShadow = true;
      });
    }

    // the lanterns, brightest and nearest first (a little behind the eye still counts: it lights the
    // ground in front of you)
    const ranked = this.ranked;
    ranked.length = 0;
    let lit = 0;
    for (const s of sources) {
      s.level += (Math.max(0, Math.min(1, s.on)) - s.level) * Math.min(1, dt * 4);
      const b = s.level * s.power * (s.own ? 1 : dark) * (this.enabled ? 1 : 0);
      if (b < 0.01) continue;
      lit++;
      const dx = s.pos.x - cx;
      const dy = s.pos.y - cy;
      const dz = s.pos.z - cz;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const ahead = (dx * this.camDir.x + dz * this.camDir.z) / Math.max(d, 0.01);
      let score = s.own ? -100 : d * (ahead > -0.3 ? 1 : 1.5) - b;
      // a lantern already lit by the pool keeps its place unless another is clearly nearer
      for (const sl of this.slots) if (sl.src === s && sl.w > 0) score -= 1.5;
      ranked.push({ s, score, b });
    }
    ranked.sort((a, b) => a.score - b.score);

    // who should have a light, and who a shadow light
    const want = new Map<LanternSource, boolean>();
    for (let i = 0; i < ranked.length && i < POOL && this.lights; i++) {
      if (ranked[i].score > RANGE * 5) break; // too far to matter: ground pool only
      want.set(ranked[i].s, i < SHADOWS && this.shadows);
    }
    // a slot serves its lantern while the lantern wants that kind of light; else it fades out, then frees
    const serves = (sl: Slot) => !!sl.src && sources.has(sl.src) && want.get(sl.src) === sl.shadow;
    for (const sl of this.slots) {
      if (!sl.src || serves(sl)) continue;
      sl.w = Math.max(0, sl.w - dt * FADE);
      if (sl.w <= 0) sl.src = null;
    }
    const pooled = (s: LanternSource, but: Slot | null) => {
      let sum = 0;
      for (const sl of this.slots) if (sl.src === s && sl !== but) sum += sl.w;
      return sum;
    };
    // wanted lanterns without a slot of their kind take a free one of that kind
    for (const [s, shadow] of want) {
      if (this.slots.some((sl) => sl.src === s && sl.shadow === shadow)) continue;
      const free = this.slots.find((sl) => !sl.src && sl.shadow === shadow);
      if (free) {
        free.src = s;
        free.w = 0;
      }
    }
    // fade in (never more than the lantern has: a crossfade from the other kind keeps the sum at 1)
    for (const sl of this.slots) if (serves(sl)) sl.w = Math.max(0, Math.min(1 - pooled(sl.src!, sl), sl.w + dt * FADE));

    // the lights
    let lights = 0;
    let shadowOn = false;
    const bOf = new Map<LanternSource, number>();
    for (const r of ranked) bOf.set(r.s, r.b);
    for (const sl of this.slots) {
      const s = sl.src;
      const b = s ? (bOf.get(s) ?? 0) : 0;
      if (!s || sl.w <= 0 || b <= 0) {
        sl.light.intensity = 0;
        if (sl.shadow) sl.light.shadow.autoUpdate = false;
        continue;
      }
      lights++;
      sl.light.position.copy(s.pos);
      sl.light.updateMatrixWorld();
      sl.light.intensity = POWER * b * sl.w * flicker(t, s.seed);
      if (sl.shadow) {
        sl.light.shadow.autoUpdate = true;
        shadowOn = true;
      }
    }
    // Until a shadow light has drawn its cube map once, every lit material would sample an empty
    // cube with a shadow sampler (a GL error: the ground, the houses and the boats not drawn at all,
    // day or night). So the maps are drawn once at the start, dark and empty, before anything else.
    let primed = true;
    for (const sl of this.slots) {
      if (!sl.shadow || sl.light.shadow.map) continue;
      primed = false;
      sl.light.shadow.autoUpdate = true;
    }
    this.shadowOn = shadowOn;
    // the cube map is six passes over the scene (about 0.7 ms): drawn 30 times a second, not every
    // frame (the flame's flicker is the light's strength, not its map; a walker moves 4 cm between)
    this.shadowT += dt;
    const due = this.shadowT >= SHADOW_DT;
    if (due) this.shadowT = 0;
    this.renderer.shadowMap.needsUpdate = (shadowOn && due) || !primed;

    // who throws a shadow: bodies near a burning shadow light
    let nCast = 0;
    for (const c of casters.values()) {
      let on = false;
      if (shadowOn && c.root.parent) {
        const e = c.root.matrixWorld.elements;
        for (const sl of this.slots) {
          if (!sl.shadow || !sl.src || sl.light.intensity <= 0) continue;
          const dx = e[12] - sl.light.position.x;
          const dz = e[14] - sl.light.position.z;
          if (dx * dx + dz * dz < CAST_REACH * CAST_REACH) on = true;
        }
      }
      if (on) nCast++;
      if (on !== c.on) {
        c.on = on;
        for (const m of c.meshes) m.castShadow = on;
      }
    }

    // the ground pools: what the real lights do not give
    let n = 0;
    for (const r of ranked) {
      if (n >= MAX_DECALS) break;
      const s = r.s;
      const rest = 1 - Math.min(1, pooled(s, null));
      const pw = r.b * rest;
      if (pw < 0.02) continue;
      const dx = s.pos.x - cx;
      const dz = s.pos.z - cz;
      if (dx * dx + dz * dz > 90 * 90) continue;
      const h = Math.max(0.3, s.pos.y - s.ground);
      const rad = this.poolReach(s);
      if (rad < 0.5) continue;
      this.m.compose(this.p.set(s.pos.x, s.ground + 0.05, s.pos.z), this.q, this.one.set(rad * 2, 1, rad * 2));
      this.decals.setMatrixAt(n, this.m);
      this.decalPow.setXYZ(n, (POWER * pw * flicker(t, s.seed)) / Math.pow(h, DECAY), h, rad);
      n++;
    }
    this.one.set(1, 1, 1);
    for (const k of this.reach.keys()) if (!sources.has(k)) this.reach.delete(k);
    this.decals.count = n;
    this.decals.visible = n > 0;
    if (n) {
      this.decals.instanceMatrix.needsUpdate = true;
      this.decalPow.needsUpdate = true;
    }
    this.stats = { sources: sources.size, lit, lights, shadowLights: this.slots.filter((s) => s.shadow && s.light.intensity > 0).length, decals: n, casters: nCast };
  }

  private shadowOn = false;
  private shadowT = 1;

  /** How far a lantern's ground pool may reach before the ground drops away (0.75 m of walking between looks). */
  private poolReach(s: LanternSource): number {
    const c = this.reach.get(s);
    if (c && Math.abs(c.x - s.pos.x) + Math.abs(c.z - s.pos.z) < 0.75) return c.r;
    let r = POOL_R;
    for (let i = 0; i < 8 && r > 0; i++) {
      const a = (i / 8) * Math.PI * 2;
      for (const d of [1, 2, 3.5, POOL_R]) {
        if (d >= r) break;
        const g = this.groundAt(s.pos.x + Math.cos(a) * d, s.pos.z + Math.sin(a) * d, s.ground);
        if (Math.abs(g - s.ground) > 0.25) {
          r = Math.max(0, d - 0.6);
          break;
        }
      }
    }
    this.reach.set(s, { x: s.pos.x, z: s.pos.z, r });
    return r;
  }

  /** Dev perf(): each timed frame (1/60 s) pays for the shadow maps as a real frame would. */
  redraw(dt = 1 / 60): void {
    this.shadowT += dt;
    const due = this.shadowT >= SHADOW_DT;
    if (due) this.shadowT = 0;
    this.renderer.shadowMap.needsUpdate = this.shadowOn && due;
  }

  /** Dev: the pool as it stands. */
  info() {
    return {
      ...this.stats,
      enabled: this.enabled,
      shadows: this.shadows,
      slots: this.slots.map((s) => ({ shadow: s.shadow, w: +s.w.toFixed(2), i: +s.light.intensity.toFixed(2), at: s.src ? [+s.src.pos.x.toFixed(1), +s.src.pos.y.toFixed(2), +s.src.pos.z.toFixed(1)] : null })),
    };
  }
}
