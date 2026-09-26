import * as THREE from "three";
import { addSpill, removeSpill, type SpillSource } from "./spill";

// Carried lanterns light the world (2026-09-24, Steve: "live lighting and shadows on the ground").
//
// Every lit lantern (townspeople, the lamplighters and police, Jef's own, the ones standing where
// people work) is a source here. The nearest few to the eye get a real three.js point light from a
// fixed pool, warm and flickering like the gas lamps (world/rijnkaai.ts: the same colour, a softer decay);
// the nearest of all casts real shadows (a cube shadow map: the carrier's legs, the people round
// him). The rest light the street through world/spill.ts (2026-09-26): the nearest per pixel on the
// ground, the walls and the people as the point light would, the others as a pool on the ground,
// stopped where the ground drops away. A lantern that joins or leaves the pool fades over half a second,
// and its spilt light fades the other way: nothing pops. Every lantern made with addLantern spills.
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
  /** its light past the real lights (world/spill.ts) */
  spill: SpillSource | null;
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
  const s: LanternSource = { pos: new THREE.Vector3(0, -999, 0), ground: 0, on: 0, power: opts.power ?? 1, own: !!opts.own, seed: (seedN++ * 1.618) % 7, level: 0, spill: null };
  sources.add(s);
  return s;
}

export function removeLantern(s: LanternSource | null | undefined): void {
  if (!s) return;
  sources.delete(s);
  removeSpill(s.spill);
  s.spill = null;
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
  private readonly p = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private t = 0;
  private recvT = 0;
  private readonly ranked: Array<{ s: LanternSource; score: number; b: number }> = [];
  /** Dev: on/off (the pool's lights, the shadows, the ground pools). */
  enabled = true;
  shadows = true;
  /** Dev: false puts every lantern on the spilt light (world/spill.ts; to match the two by eye). */
  lights = true;
  stats = { sources: 0, lit: 0, lights: 0, shadowLights: 0, spilling: 0, casters: 0 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    /** (unused since world/spill.ts lays the pools; kept for the callers) */
    _groundAt: (x: number, z: number, feet: number) => number = () => 0,
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
        if ((o as THREE.Mesh).isMesh && !o.receiveShadow && o.name !== "spill_ground_pools") o.receiveShadow = true;
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

    // the light the real lights do not give (or only part-way, while they fade): through world/spill.ts, every lantern
    let spilling = 0;
    for (const s of sources) {
      const b = bOf.get(s) ?? 0;
      const rest = 1 - Math.min(1, pooled(s, null));
      if (!s.spill) {
        if (b * rest < 0.01) continue;
        s.spill = addSpill({ kind: "lantern", label: s.own ? "Jef's lantern" : "a carried lantern", x: s.pos.x, y: s.pos.y, z: s.pos.z, power: POWER, decay: DECAY, range: RANGE, moving: true, hw: 0.08, hh: 0.12 });
      }
      const sp = s.spill;
      sp.x = s.pos.x;
      sp.y = s.pos.y;
      sp.z = s.pos.z;
      sp.ground = s.ground;
      sp.level = Math.max(0, Math.min(1, b * rest * flicker(t, s.seed)));
      const glow = Math.min(1, b > 0.01 ? s.level * s.power : 0);
      sp.glow = () => glow;
      sp.real = () => (b > 0.01 ? 1 - rest : 0);
      if (sp.level > 0.01) spilling++;
    }
    this.stats = { sources: sources.size, lit, lights, shadowLights: this.slots.filter((s) => s.shadow && s.light.intensity > 0).length, spilling, casters: nCast };
  }

  private shadowOn = false;
  private shadowT = 1;

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
