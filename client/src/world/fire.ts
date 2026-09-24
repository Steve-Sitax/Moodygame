import * as THREE from "three";
import { psxUniforms } from "../retro/psx";

// Open fires (Steve: "more realistic fire in fire basket"): the tar-barrel fires on the quays,
// and any brazier or forge that wants one. Each fire is a few dozen particles worked out on the
// graphics card from their own seed and the clock: tongues of flame that rise, sway in the draught
// and burn from a white-yellow core to orange to deep red; sparks that shoot up and wink out; a
// wisp of smoke above; a warm glow in the air round it. No lights of its own (cheap); the glow
// and the flames are additive, so they never darken the fog.

export interface FireSpot {
  x: number;
  y: number; // where the flames start (the top of the fuel)
  z: number;
  /** 1 = a tar barrel; 0.6 = a brazier; 1.5 = a big bonfire. */
  size?: number;
}

const FLAMES = 34;
const SPARKS = 10;
const SMOKE_DEFAULT = 10;

/** The render height (settings): point sizes are in its pixels. */
let viewH = 270;
export function setFireViewHeight(h: number): void {
  viewH = h;
}
/** The render height now (the gas lamps' halos size their points by it too). */
export function fireViewHeight(): number {
  return viewH;
}

export interface Fires {
  group: THREE.Group;
  update(t: number): void;
  /** M6 house fire: how fierce (0 out .. 1 full), and how thick the smoke (0..1.5; steam when the water hits). */
  setLevel(flame: number, smoke?: number): void;
  /** Take it out of the scene and free the GPU side. */
  dispose(): void;
}

/** M6: `smoke` particles per spot (default 10; a burning house wants a column of it). */
export function createFires(scene: THREE.Scene, spots: FireSpot[], opts: { smoke?: number } = {}): Fires {
  const group = new THREE.Group();
  group.name = "fires";
  const SMOKE = opts.smoke ?? SMOKE_DEFAULT;
  const per = FLAMES + SPARKS + SMOKE;
  const n = spots.length * per;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n * 2); // x: seed 0..1, y: kind (0 flame, 1 spark, 2 smoke)
  const size = new Float32Array(n);
  let k = 0;
  let s = 1873;
  const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const f of spots) {
    for (let i = 0; i < per; i++, k++) {
      pos.set([f.x, f.y, f.z], k * 3);
      seed[k * 2] = r();
      seed[k * 2 + 1] = i < FLAMES ? 0 : i < FLAMES + SPARKS ? 1 : 2;
      size[k] = f.size ?? 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 2));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: psxUniforms.uTime,
    uViewH: { value: 270 },
    uLevel: { value: 1 },
    uSmoke: { value: 1 },
  };
  const vs = /* glsl */ `
    uniform float uTime;
    uniform float uViewH;
    uniform float uLevel;
    attribute vec2 aSeed;
    attribute float aSize;
    varying float vLife;
    varying float vKind;
    varying float vFogDepth;
    varying float vSeed;
    float hash(float n) { return fract(sin(n * 91.345) * 47453.5453); }
    void main() {
      float sd = aSeed.x;
      float kind = aSeed.y;
      vKind = kind;
      vSeed = sd;
      float life = kind < 0.5 ? 0.55 + 0.35 * hash(sd) : kind < 1.5 ? 1.1 + 0.8 * hash(sd) : 3.5 + 2.0 * hash(sd);
      float age = fract(uTime / life + sd * 7.13);
      vLife = age;
      vec3 p = position;
      float a = hash(sd + 1.0) * 6.2832;
      float rad = hash(sd + 2.0);
      if (kind < 0.5) {
        // a tongue of flame: starts spread over the fuel, rises and narrows, sways
        float spread = 0.22 * aSize * (1.0 - age * 0.7);
        p.x += cos(a) * rad * spread + sin(uTime * 7.0 + sd * 40.0) * 0.05 * age * aSize;
        p.z += sin(a) * rad * spread + cos(uTime * 6.1 + sd * 33.0) * 0.05 * age * aSize;
        p.y += age * (0.55 + 0.35 * hash(sd + 3.0)) * aSize;
      } else if (kind < 1.5) {
        // a spark: shoots up fast, drifts, fades
        p.x += cos(a) * rad * 0.15 * aSize + sin(sd * 20.0 + uTime) * 0.3 * age;
        p.z += sin(a) * rad * 0.15 * aSize + cos(sd * 17.0 + uTime) * 0.3 * age;
        p.y += age * (1.8 + 1.2 * hash(sd + 4.0)) * aSize;
      } else {
        // smoke: rises slowly from above the flames, spreads, drifts on the wind
        p.y += (0.6 + age * 2.6) * aSize;
        p.x += age * age * 0.9 + cos(a) * age * 0.3;
        p.z += age * age * 0.4 + sin(a) * age * 0.3;
      }
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vFogDepth = -mv.z;
      gl_Position = projectionMatrix * mv;
      float px = kind < 0.5 ? (0.28 - 0.18 * age) * aSize * uLevel : kind < 1.5 ? 0.035 * step(0.05, uLevel) : (0.35 + 0.9 * age) * aSize;
      gl_PointSize = clamp(px * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1), 1.0, 64.0);
    }`;
  const fs = /* glsl */ `
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform float uLevel;
    varying float vLife;
    varying float vKind;
    varying float vFogDepth;
    varying float vSeed;
    void main() {
      if (uLevel < 0.01) discard;
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c) * 2.0;
      if (d > 1.0) discard;
      float fog = smoothstep(fogNear, fogFar, vFogDepth);
      if (vKind < 0.5) {
        // flame: white-yellow core, orange, deep red, gone; a ragged edge
        float t = vLife;
        vec3 col = mix(vec3(1.0, 0.92, 0.6), vec3(1.0, 0.55, 0.12), smoothstep(0.0, 0.35, t));
        col = mix(col, vec3(0.7, 0.14, 0.03), smoothstep(0.35, 0.85, t));
        float edge = 1.0 - smoothstep(0.35, 1.0, d + fract(sin(vSeed * 91.0 + floor(t * 12.0)) * 43758.5) * 0.25);
        float a = edge * (1.0 - smoothstep(0.6, 1.0, t)) * 0.9;
        gl_FragColor = vec4(col * a * (1.0 - fog * 0.85), 1.0);
      } else if (vKind < 1.5) {
        float a = (1.0 - vLife) * step(0.3, fract(vSeed * 13.0 + vLife * 9.0));
        gl_FragColor = vec4(vec3(1.0, 0.7, 0.3) * a * (1.0 - fog), 1.0);
      } else {
        discard;
      }
    }`;
  const flameMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vs,
    fragmentShader: fs,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  // smoke is drawn apart, blended normally (it darkens a little)
  const smokeMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vs,
    fragmentShader: /* glsl */ `
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;
      uniform float uSmoke;
      varying float vLife;
      varying float vKind;
      varying float vFogDepth;
      void main() {
        if (vKind < 1.5 || uSmoke < 0.01) discard;
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (d > 1.0) discard;
        float a = min(0.85, (1.0 - d) * smoothstep(0.0, 0.15, vLife) * (1.0 - vLife) * 0.35 * min(uSmoke, 2.5));
        vec3 col = mix(vec3(0.16, 0.15, 0.14), fogColor, 0.4 + 0.5 * vLife);
        float fog = smoothstep(fogNear, fogFar, vFogDepth);
        gl_FragColor = vec4(mix(col, fogColor, fog), a * (1.0 - fog));
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const flames = new THREE.Points(geo, flameMat);
  const smoke = new THREE.Points(geo, smokeMat);
  flames.frustumCulled = false;
  smoke.frustumCulled = false;
  smoke.renderOrder = 4;
  flames.renderOrder = 5;
  group.add(smoke, flames);

  // the glow in the air round each fire: a soft additive sprite that breathes
  const glowTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, "rgba(255,170,80,0.9)");
    grd.addColorStop(0.4, "rgba(255,110,40,0.35)");
    grd.addColorStop(1, "rgba(255,80,20,0)");
    g.fillStyle = grd;
    g.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(c);
  })();
  const glows: Array<{ sp: THREE.Sprite; base: number; sd: number }> = [];
  for (const f of spots) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, fog: true }));
    const b = 2.6 * (f.size ?? 1);
    sp.scale.set(b, b, 1);
    sp.position.set(f.x, f.y + 0.35 * (f.size ?? 1), f.z);
    group.add(sp);
    glows.push({ sp, base: b, sd: r() * 10 });
  }
  scene.add(group);
  let level = 1;
  return {
    group,
    update(t: number) {
      uniforms.uViewH.value = viewH;
      for (const g of glows) {
        const f = 0.85 + 0.1 * Math.sin(t * 9.1 + g.sd) + 0.06 * Math.sin(t * 23.7 + g.sd * 3);
        g.sp.scale.set(g.base * f * (0.3 + 0.7 * level), g.base * f * (0.3 + 0.7 * level), 1);
        (g.sp.material as THREE.SpriteMaterial).opacity = 0.45 * f * level;
      }
    },
    setLevel(flame: number, smoke = 1) {
      level = Math.max(0, Math.min(1, flame));
      uniforms.uLevel.value = level;
      uniforms.uSmoke.value = Math.max(0, smoke);
    },
    dispose() {
      group.removeFromParent();
      geo.dispose();
      flameMat.dispose();
      smokeMat.dispose();
      for (const g of glows) g.sp.material.dispose();
    },
  };
}
