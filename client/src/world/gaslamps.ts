import * as THREE from "three";
import { MAX_LAMPS, psxUniforms } from "../retro/psx";
import { fireViewHeight } from "./fire";
import { lampFog, type LampFog } from "./lampFog";

// The gas lamps one by one (M6 town life): each lamp of the town has its own lit state, set
// by the lamplighter's progress (game/lamplighter.ts, server town/lampround.ts). The six lamps of
// the Rijnkaai quay keep their own glass, halo and flicker (rijnkaai.ts); the lamps of the city
// (props.glb "gas_lamp", city.json decor.lamps) get their glass coloured per lamp and one Points
// object for all their halos, with a per-lamp attribute. A lamp nobody has set follows the clock.
//
// M7 lamps (2026-09-25): every lamp lights the ground. The scene keeps its six gas-lamp point lights
// (the quay lamps' own, made in rijnkaai.ts: the light count never changes, so no shader is rebuilt)
// and the psx lamp slots (retro/psx.ts MAX_LAMPS: the glow in the fog, the streaks on wet stone and
// water); both now go to the lit lamps nearest the eye, whichever they are, and move on as you walk
// (a lamp that joins or leaves fades over half a second). The last psx slot stays free for Jef's
// lantern (game/lantern.ts takes a free one first). Every other lit lamp throws a cheap pool of
// light on the cobbles (one instanced decal, as world/lanternLights.ts does for the lanterns): the
// light the point light would give flat stone, stopped where the ground drops away (a quay edge).
//
// M7 fog lamps (2026-09-25): on a day of thick fog the lamplighters leave the lamps lit (lampround.ts
// FogDay); by day such a lamp glows in the grey (FOG_DAY_GLOW) and lights the ground a little. Its
// glass now fogs like the post (lampFog.ts): no dark box, no lit square hanging in the fog on its own.

export interface GasLamps {
  /** A city lamp as placed (props.glb gas_lamp), index i of city.json decor.lamps: id "d<i>". */
  addDecor(i: number, obj: THREE.Object3D, x: number, z: number): void;
  /** The lamplighter's word: this lamp burns (true) or not. */
  set(id: string, on: boolean): void;
  /** The eased level (0..1) of a quay lamp, "q<i>", for rijnkaai.ts's glass and halo. */
  quay(i: number): number;
  /** A quay lamp's flame as rijnkaai.ts works it out (lit, the clock's dark and its flicker), 0..1. */
  quayFlame(i: number, level: number): void;
  /**
   * Once a frame: `dark` how dark it is (the clock's 0..1), the fog colour for unlit glass, the eye.
   * `air` (M7 fog lamps): how thick the air is by day (0 clear .. 1 fog): a lamp lit by day in the
   * fog glows in it (the glass, the halo, the glow in the air), and lights the ground a little.
   */
  update(dt: number, dark: number, fog: THREE.Color, camera?: THREE.Camera | null, air?: number): void;
  /** Where each lamp is (the post, the glass at 3.65 m). */
  lamps(): Array<{ id: string; x: number; z: number }>;
  info(): { lamps: number; on: number; set: number };
  /** Dev: who has the lights and the psx slots now, and how many ground pools are drawn. */
  lightInfo(): { lights: Array<{ id: string | null; w: number; i: number }>; slots: Array<{ id: string | null; w: number }>; pools: number; lit: number };
}

const GLASS_Y = 3.65;
/** The quay lamps' point light (rijnkaai.ts gasLamp): intensity at full flame, and its decay. */
const POWER = 26;
const DECAY = 1.7;
/** A lamp joins or leaves the lights in about half a second. */
const FADE = 2.2;
/** Ground pools: radius (m), how far off they are still drawn, how many at most. */
const POOL_R = 8;
const POOL_FAR = 110;
const MAX_POOLS = 96;
/** psx slots for the gas lamps; the last one is left for Jef's lantern (game/lantern.ts). */
const GAS_SLOTS = MAX_LAMPS - 1;
/**
 * M7 fog lamps: a lamp lit by day in thick fog shows this much of its night glow (glass, halo, the glow
 * in the air), and lights the ground this much of its night light (the day is bright round it).
 */
export const FOG_DAY_GLOW = 0.8;
export const FOG_DAY_GROUND = 0.3;
/** Lit glass shows this much further through the fog than the post (in fog-fars); unlit as the post. */
export const LIT_REACH = 0.6;

/**
 * The colour of a lamp's glass: `v` 0 unlit (the colour of the air round it, a little darker, so it
 * never shows as a black box) to 1 burning. The fog does the distance (lampFog.ts).
 */
export function glassColor(out: THREE.Color, fog: THREE.Color, v: number): THREE.Color {
  const k = Math.max(0, Math.min(1, v));
  return out.setRGB(fog.r * 0.8 * (1 - k) + 1.0 * k, fog.g * 0.8 * (1 - k) + 0.72 * k, fog.b * 0.8 * (1 - k) + 0.38 * k);
}

function haloTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,190,110,0.95)");
  grd.addColorStop(0.35, "rgba(255,150,70,0.4)");
  grd.addColorStop(1, "rgba(255,120,40,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Gas flame: slow breathing, small fast noise, now and then a dip (rijnkaai.ts flicker, not broken). */
function flicker(t: number, seed: number): number {
  let v = 0.9 + Math.sin(t * 1.3 + seed * 2.1) * 0.04 + Math.sin(t * 7.7 + seed * 5.3) * 0.03 + Math.sin(t * 17.3 + seed * 1.7) * 0.02;
  const dip = Math.sin(t * 0.61 + seed * 3.3) * Math.sin(t * 2.3 + seed);
  if (dip > 0.93) v *= 0.6;
  return v;
}

export function createGasLamps(
  scene: THREE.Scene,
  quay: Array<{ x: number; z: number }>,
  /** The scene's gas-lamp point lights (the quay lamps' own): lent to the nearest lit lamps. */
  lights: THREE.PointLight[] = [],
  /** The ground's height (world.groundAt): a pool never hangs out over a drop. */
  groundAt: (x: number, z: number) => number = () => 0,
): GasLamps {
  interface L {
    id: string;
    x: number;
    z: number;
    want: number;
    level: number;
    set: boolean;
    glass: THREE.MeshBasicMaterial[];
    /** how far each glass shows through the fog (lampFog.ts) */
    reach: LampFog[];
    slot: number;
    seed: number;
    /** quay lamps: the flame rijnkaai.ts works out; -1 for a city lamp */
    flame: number;
    /** this frame's light, 0..1: in the glass and the air (b), on the ground (g) */
    b: number;
    g: number;
    /** the ground pool: foot height, centre, radius (worked out once) */
    pool: { g: number; cx: number; cz: number; r: number } | null;
  }
  const all = new Map<string, L>();
  quay.forEach((q, i) =>
    all.set(`q${i}`, { id: `q${i}`, x: q.x, z: q.z, want: 1, level: 1, set: false, glass: [], reach: [], slot: -1, seed: i * 1.37 + 0.5, flame: 0, b: 0, g: 0, pool: null }),
  );

  // the city lamps' halos: one Points object, a slot per lamp, the lit level as an attribute
  const MAX = 160;
  const pos = new Float32Array(MAX * 3).fill(0);
  const lit = new Float32Array(MAX).fill(0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aLit", new THREE.BufferAttribute(lit, 1));
  geo.setDrawRange(0, 0);
  const uniforms = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uMap: { value: haloTexture() }, uTime: psxUniforms.uTime, uViewH: { value: 270 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uViewH;
      attribute float aLit;
      varying float vLit;
      varying float vFogDepth;
      void main() {
        vLit = aLit;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // M7 fog lamps: the halo sits a little in front of the glass, so the glass (fogged with its
        // post, lampFog.ts) never cuts a dark lamp shape out of its own glow far off in the fog
        mv.xyz += normalize(-mv.xyz) * 0.45;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
        // a halo about 1.8 m across, in screen pixels
        gl_PointSize = aLit < 0.01 ? 0.0 : clamp(1.8 * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1), 1.0, 96.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      varying float vLit;
      varying float vFogDepth;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        float fog = smoothstep(fogNear, fogFar * 1.4, vFogDepth);
        gl_FragColor = vec4(t.rgb * t.a * vLit * 0.6 * (1.0 - fog * 0.8), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  // M7 rendering (world/cull.ts): an unlit halo is not drawn (size 0), so it shows nothing past the fog
  mat.userData.litAttr = "aLit";
  const halos = new THREE.Points(geo, mat);
  halos.frustumCulled = false;
  halos.renderOrder = 3;
  halos.name = "gas_lamp_halos";
  scene.add(halos);
  let used = 0;

  // ---- M7 lamps: the lights and the psx slots go to the nearest lit lamps
  interface Slot {
    lamp: L | null;
    w: number;
  }
  const lightSlots: Slot[] = lights.map(() => ({ lamp: null, w: 0 }));
  const psxSlots: Slot[] = Array.from({ length: Math.min(GAS_SLOTS, psxUniforms.uLamps.value.length) }, () => ({ lamp: null, w: 0 }));
  const eye = new THREE.Vector3();
  const look = new THREE.Vector3();
  let t = 0;
  const ranked: Array<{ l: L; score: number }> = [];

  // the ground pools: what the point lights do not give (world/lanternLights.ts, with a gas lamp's height and decay)
  const poolGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  // per pool: the light at the foot, the lamp's height over the ground, the pool's radius; the foot's offset from the pool's centre
  const poolPow = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 3), 3);
  const poolFoot = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 2), 2);
  poolPow.setUsage(THREE.DynamicDrawUsage);
  poolFoot.setUsage(THREE.DynamicDrawUsage);
  poolGeo.setAttribute("aPow", poolPow);
  poolGeo.setAttribute("aFoot", poolFoot);
  const poolGain = { value: 0.07 }; // as the lanterns' pools: matched by eye to the real lights (lanternLights.ts)
  const poolMat = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uColor: { value: new THREE.Color(0xffa048) }, uGain: poolGain },
    vertexShader: /* glsl */ `
      attribute vec3 aPow;
      attribute vec2 aFoot;
      varying vec3 vPow;
      varying vec2 vRel;
      varying vec2 vUv;
      varying float vFogDepth;
      void main() {
        vPow = aPow;
        vUv = uv;
        // metres from the lamp's foot (the pool may be shifted off it, away from a drop)
        vRel = (uv * 2.0 - 1.0) * aPow.z - aFoot;
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
      varying vec2 vRel;
      varying vec2 vUv;
      varying float vFogDepth;
      void main() {
        float r = length(vRel);
        float edge = length(vUv * 2.0 - 1.0);
        // what the point light gives flat ground, cos / d^decay, relative to the foot; soft edge
        float h = vPow.y;
        float fall = pow(h / sqrt(r * r + h * h), ${(DECAY + 1).toFixed(2)}) * smoothstep(1.0, 0.6, edge);
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
  const pools = new THREE.InstancedMesh(poolGeo, poolMat, MAX_POOLS);
  pools.name = "gas_lamp_ground_pools";
  pools.count = 0;
  pools.frustumCulled = false;
  pools.renderOrder = 2;
  scene.add(pools);
  const pm = new THREE.Matrix4();
  const pq = new THREE.Quaternion();
  const pp = new THREE.Vector3();
  const ps = new THREE.Vector3();
  let poolsDrawn = 0;
  let litCount = 0;

  /** Where a lamp's pool may lie: the ground within a step of its foot's (worked out once: lamps stand still). */
  function poolOf(l: L): NonNullable<L["pool"]> {
    if (l.pool) return l.pool;
    const g = groundAt(l.x, l.z);
    const flat = (x: number, z: number) => Math.abs(groundAt(x, z) - g) <= 0.25;
    const N = 16;
    const reach: number[] = [];
    let dx = 0;
    let dz = 0;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      let r = POOL_R;
      for (const d of [1, 2, 3, 4.5, 6, POOL_R]) {
        if (!flat(l.x + Math.cos(a) * d, l.z + Math.sin(a) * d)) {
          r = Math.max(0, d - 0.6);
          break;
        }
      }
      reach.push(r);
      dx += Math.cos(a) * (POOL_R - r);
      dz += Math.sin(a) * (POOL_R - r);
    }
    let best = { g, cx: l.x, cz: l.z, r: Math.min(...reach) };
    const dl = Math.hypot(dx, dz);
    if (best.r < POOL_R && dl > 0) {
      // shift the pool away from the drop: the biggest disc that stays on the flat
      const ux = -dx / dl;
      const uz = -dz / dl;
      for (const s of [0.5, 1, 1.5, 2, 3, 4, 5])
        for (let rr = POOL_R; rr > best.r; rr -= 0.5) {
          const cx = l.x + ux * s;
          const cz = l.z + uz * s;
          let ok = flat(cx, cz);
          for (let i = 0; i < N && ok; i++) {
            const a = (i / N) * Math.PI * 2;
            ok = flat(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr) && flat(cx + Math.cos(a) * rr * 0.55, cz + Math.sin(a) * rr * 0.55);
          }
          if (ok) {
            if (rr > best.r) best = { g, cx, cz, r: rr };
            break;
          }
        }
    }
    l.pool = best;
    return best;
  }

  /** A slot follows its lamp while the lamp is wanted; else it fades out and frees; wanted lamps take free slots. */
  function assign(slots: Slot[], want: Set<L>, dt: number): void {
    for (const s of slots) {
      if (!s.lamp) continue;
      if (want.has(s.lamp)) s.w = Math.min(1, s.w + dt * FADE);
      else {
        s.w = Math.max(0, s.w - dt * FADE);
        if (s.w <= 0) s.lamp = null;
      }
    }
    for (const l of want) {
      if (slots.some((s) => s.lamp === l)) continue;
      const free = slots.find((s) => !s.lamp);
      if (free) {
        free.lamp = l;
        free.w = 0;
      }
    }
  }

  return {
    addDecor(i, obj, x, z) {
      const glass: THREE.MeshBasicMaterial[] = [];
      obj.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.Material).name === "glass") glass.push(m.material as THREE.MeshBasicMaterial);
      });
      const slot = used < MAX ? used++ : -1;
      if (slot >= 0) {
        pos.set([x, GLASS_Y, z], slot * 3);
        geo.attributes.position.needsUpdate = true;
        geo.setDrawRange(0, used);
      }
      // M7 fog lamps: the glass fogs like its post (a lit one shows a little further)
      const reach = glass.map((m) => lampFog(m, 1, 1 + LIT_REACH));
      all.set(`d${i}`, { id: `d${i}`, x, z, want: 1, level: 1, set: false, glass, reach, slot, seed: i * 2.31 + 7.1, flame: -1, b: 0, g: 0, pool: null });
    },
    set(id, on) {
      const l = all.get(id);
      if (!l) return;
      l.set = true;
      l.want = on ? 1 : 0;
    },
    quay(i) {
      return all.get(`q${i}`)?.level ?? 1;
    },
    quayFlame(i, level) {
      const l = all.get(`q${i}`);
      if (l) l.flame = level;
    },
    update(dt, dark, fog, camera, air = 0) {
      t += dt;
      uniforms.uViewH.value = fireViewHeight();
      const k = Math.min(1, dt * 2.5); // the gas catches in about half a second
      // M7 fog lamps: by day a lit lamp shows in thick air (its glow), and lights the ground a little
      const glow = Math.max(dark, FOG_DAY_GLOW * air);
      const ground = glow > 0 ? Math.max(dark, FOG_DAY_GROUND * air) / glow : 0;
      let dirty = false;
      for (const l of all.values()) {
        l.level += (l.want - l.level) * k;
        const v = Math.max(0, Math.min(1, l.level * glow));
        l.b = l.flame >= 0 ? l.flame : v * flicker(t, l.seed);
        l.g = l.b * ground;
        if (l.slot < 0 && !l.glass.length) continue;
        for (const g of l.glass) glassColor(g.color, fog, v);
        for (const r of l.reach) r.value = 1 + LIT_REACH * v;
        if (l.slot >= 0 && Math.abs(lit[l.slot] - v) > 0.002) {
          lit[l.slot] = v;
          dirty = true;
        }
      }
      if (dirty) geo.attributes.aLit.needsUpdate = true;

      // the lit lamps, nearest the eye first (a little behind still counts: it lights the ground ahead)
      if (camera) {
        camera.getWorldPosition(eye);
        camera.getWorldDirection(look);
      }
      ranked.length = 0;
      litCount = 0;
      for (const l of all.values()) {
        if (l.b < 0.01) continue;
        litCount++;
        const dx = l.x - eye.x;
        const dz = l.z - eye.z;
        const d = Math.hypot(dx, GLASS_Y - eye.y, dz);
        const ahead = (dx * look.x + dz * look.z) / Math.max(Math.hypot(dx, dz), 0.01);
        let score = d * (ahead > -0.3 ? 1 : 1.4);
        // a lamp already lit keeps its light unless another is clearly nearer
        if (lightSlots.some((s) => s.lamp === l && s.w > 0)) score -= 3;
        ranked.push({ l, score });
      }
      ranked.sort((a, b) => a.score - b.score);
      const wantLight = new Set<L>();
      const wantSlot = new Set<L>();
      for (let i = 0; i < ranked.length; i++) {
        if (i < lightSlots.length) wantLight.add(ranked[i].l);
        if (i < psxSlots.length) wantSlot.add(ranked[i].l);
      }
      assign(lightSlots, wantLight, dt);
      assign(psxSlots, wantSlot, dt);
      lightSlots.forEach((s, i) => {
        const light = lights[i];
        const l = s.lamp;
        if (!l || s.w <= 0 || l.g <= 0) {
          light.intensity = 0;
          return;
        }
        light.position.set(l.x, GLASS_Y, l.z);
        light.updateMatrixWorld();
        light.intensity = POWER * l.g * s.w;
      });
      const uL = psxUniforms.uLamps.value;
      psxSlots.forEach((s, i) => {
        const l = s.lamp;
        if (!l || s.w <= 0) uL[i].set(0, -999, 0, 0);
        else uL[i].set(l.x, GLASS_Y, l.z, l.b * s.w);
      });
      // the slots past the gas lamps' (the lantern's): empty unless the lantern takes one after this
      for (let i = psxSlots.length; i < uL.length; i++) uL[i].set(0, -999, 0, 0);

      // the ground pools: the lit lamps the point lights do not light (or only part-way, while they fade)
      let n = 0;
      for (const r of ranked) {
        if (n >= MAX_POOLS) break;
        const l = r.l;
        let rest = 1;
        for (const s of lightSlots) if (s.lamp === l) rest -= s.w;
        const pw = l.g * Math.max(0, rest);
        if (pw < 0.02) continue;
        if (Math.hypot(l.x - eye.x, l.z - eye.z) > POOL_FAR) continue;
        const pl = poolOf(l);
        if (pl.r < 0.8) continue;
        const h = Math.max(0.5, GLASS_Y);
        pm.compose(pp.set(pl.cx, pl.g + 0.05, pl.cz), pq, ps.set(pl.r * 2, 1, pl.r * 2));
        pools.setMatrixAt(n, pm);
        poolPow.setXYZ(n, (POWER * pw) / Math.pow(h, DECAY), h, pl.r);
        poolFoot.setXY(n, l.x - pl.cx, l.z - pl.cz);
        n++;
      }
      poolsDrawn = n;
      pools.count = n;
      pools.visible = n > 0;
      if (n) {
        pools.instanceMatrix.needsUpdate = true;
        poolPow.needsUpdate = true;
        poolFoot.needsUpdate = true;
      }
    },
    lamps() {
      return [...all.values()].map((l) => ({ id: l.id, x: l.x, z: l.z }));
    },
    info() {
      let on = 0;
      let set = 0;
      for (const l of all.values()) {
        if (l.want > 0.5) on++;
        if (l.set) set++;
      }
      return { lamps: all.size, on, set };
    },
    lightInfo() {
      return {
        lights: lightSlots.map((s, i) => ({ id: s.lamp?.id ?? null, w: +s.w.toFixed(2), i: +(lights[i]?.intensity ?? 0).toFixed(1) })),
        slots: psxSlots.map((s) => ({ id: s.lamp?.id ?? null, w: +s.w.toFixed(2) })),
        pools: poolsDrawn,
        lit: litCount,
      };
    },
  };
}
