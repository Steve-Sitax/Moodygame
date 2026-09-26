import * as THREE from "three";
import type { SpillSource } from "./spill";
import { fireViewHeight } from "./fire";

// Lights seen from far (night fog, 2026-09-26, Steve: "not all lights are visible from far. On the start pier the
// lights were not visible from a bit further, but the big lights in the city were"). The city's gas lamps have a
// halo each (world/gaslamps.ts: a point sprite that fades with the fog to a fifth, never out), so they read from
// far; a lantern's or a lit room's glass fogs out with what it hangs on (world/lampFog.ts, 1.2 to 1.3 fog-fars) and
// then nothing was left of it. Now every other light the town registers in world/spill.ts gets the same kind of
// halo, one point each in one draw call: the lanterns (carried by townspeople, the lamplighters and the police, on
// the boats and the landing stage, the quest boxes', the ferry's), every "glow" thing (the Madonnas' lanterns, the
// quay steps', the wall's, the stalls', the forges and the fires) and the lit rooms and halls seen through their
// windows and doors (the painted windows of world/ambient.ts carry their own glow far already).
//
// Near, the thing's own glass and halo are what shows: the far glow comes in from half the fog's far end, is whole
// by 0.9, and then fades with the fog as the gas lamps' halos do (to a fifth at 1.4 fog-fars and on), out at the
// edge of what is looked at (FAR_VIEW), gently. Nothing pops: the list is the nearest MAX_FAR lit ones, and a light
// joining or leaving it is already faint (far) or eases in (its level).

const MAX_FAR = 256;
/** The far glow reaches this many fog-fars (never past FAR_MAX metres), fading out over its last quarter. */
const FAR_REACH = 3;
const FAR_MAX = 260;

export interface FarGlow {
  points: THREE.Points;
  /** Once a frame: `list` the lit sources (the spill's own), `eye` the camera's place, `fogFar` the fog's end. */
  update(sources: Iterable<SpillSource>, levelOf: (s: SpillSource) => number, eye: THREE.Vector3, fogFar: number, rank: boolean): void;
  /** Dev: how much far glow this source shows seen from `eye` (0..1), or null when it gets none (not its kind). */
  weight(s: SpillSource, eye: THREE.Vector3, fogNear: number, fogFar: number): number | null;
  info(): { shown: number; max: number };
}

/** Which sources get a far glow, how big (m across) and how bright (1 = a gas lamp's halo). */
export function farKind(s: SpillSource): { size: number; gain: number } | null {
  if (s.dup) return null;
  if (s.kind === "lantern") return s.label === "Jef's lantern" ? null : { size: 1.4, gain: 0.6 };
  if (s.kind === "glow") return { size: Math.min(2.2, 0.9 + s.hw * 1.2), gain: 0.55 };
  if (s.kind === "lamp") return null; // the gas lamps have their own halos (gaslamps.ts, rijnkaai.ts)
  // (the painted windows follow a schedule and glow far on their own: world/ambient.ts)
  if (s.sched) return null;
  // a lit room or hall through its window or door: a soft, low glow the size of the opening
  return { size: Math.min(2.4, 0.8 + Math.max(s.hw, s.hh) * 1.4), gain: s.kind === "garret" || s.kind === "upper" ? 0.2 : 0.3 };
}

/** The far glow's fade, as the shader does it (d metres from the eye). */
function fadeAt(d: number, fogNear: number, fogFar: number): number {
  const ss = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const view = Math.min(FAR_MAX, fogFar * FAR_REACH);
  return ss(fogFar * 0.5, fogFar * 0.9, d) * (1 - 0.8 * ss(fogNear, fogFar * 1.4, d)) * (1 - ss(view * 0.75, view, d));
}

export function createFarGlow(scene: THREE.Scene): FarGlow {
  const pos = new Float32Array(MAX_FAR * 3);
  const lit = new Float32Array(MAX_FAR);
  const col = new Float32Array(MAX_FAR * 3);
  const size = new Float32Array(MAX_FAR);
  const geo = new THREE.BufferGeometry();
  const aPos = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  const aLit = new THREE.BufferAttribute(lit, 1).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  const aSize = new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", aPos);
  geo.setAttribute("aLit", aLit);
  geo.setAttribute("aCol", aCol);
  geo.setAttribute("aSize", aSize);
  geo.setDrawRange(0, 0);
  const uniforms = { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uViewH: { value: 270 }, uReach: { value: FAR_REACH }, uMax: { value: FAR_MAX } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      uniform float uViewH;
      uniform float uReach;
      uniform float uMax;
      uniform float fogNear;
      uniform float fogFar;
      attribute float aLit;
      attribute vec3 aCol;
      attribute float aSize;
      varying vec3 vCol;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // (in front of the glass, as the gas lamps' halos: the fogged glass never cuts a dark shape out of it)
        mv.xyz += normalize(-mv.xyz) * 0.45;
        float d = length(mv.xyz);
        float view = min(uMax, fogFar * uReach);
        float k = smoothstep(fogFar * 0.5, fogFar * 0.9, d) * (1.0 - 0.8 * smoothstep(fogNear, fogFar * 1.4, d)) * (1.0 - smoothstep(view * 0.75, view, d));
        vCol = aCol * aLit * k;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aLit * k < 0.004 ? 0.0 : clamp(aSize * projectionMatrix[1][1] * uViewH * 0.5 / max(-mv.z, 0.1), 2.0, 64.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        // a soft round glow with a small bright core (no picture: one shader, nothing to load)
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - r), 2.2) * 0.8 + 0.35 * smoothstep(0.35, 0.0, r);
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  });
  mat.name = "far_glow";
  const points = new THREE.Points(geo, mat);
  points.name = "far_glow";
  points.frustumCulled = false;
  points.renderOrder = 3;
  scene.add(points);

  let list: SpillSource[] = [];
  const cand: Array<{ s: SpillSource; d: number }> = [];
  const tmp = new THREE.Color();
  return {
    points,
    update(sources, levelOf, eye, fogFar, rank) {
      const view = Math.min(FAR_MAX, fogFar * FAR_REACH);
      if (rank) {
        cand.length = 0;
        for (const s of sources) {
          if (!farKind(s)) continue;
          const d = Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z);
          if (d > view || d < fogFar * 0.4) continue;
          if (levelOf(s) < 0.02) continue;
          cand.push({ s, d });
        }
        cand.sort((a, b) => a.d - b.d);
        list = cand.slice(0, MAX_FAR).map((c) => c.s);
      }
      let n = 0;
      for (const s of list) {
        const k = farKind(s);
        if (!k) continue;
        const v = levelOf(s);
        pos[n * 3] = s.x;
        pos[n * 3 + 1] = s.y;
        pos[n * 3 + 2] = s.z;
        lit[n] = Math.min(1, v) * k.gain;
        // the colour at a gas lamp halo's brightness: its hue, the brightest channel at 1
        tmp.copy(s.color);
        const m = Math.max(tmp.r, tmp.g, tmp.b, 1e-3);
        col[n * 3] = tmp.r / m;
        col[n * 3 + 1] = tmp.g / m;
        col[n * 3 + 2] = tmp.b / m;
        size[n] = k.size;
        n++;
      }
      geo.setDrawRange(0, n);
      for (const a of [aPos, aLit, aCol, aSize]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
      // (point sizes in the render's own pixels, as the gas lamps' halos: the settings' render height)
      uniforms.uViewH.value = fireViewHeight();
    },
    weight(s, eye, fogNear, fogFar) {
      const k = farKind(s);
      if (!k) return null;
      return fadeAt(Math.hypot(s.x - eye.x, s.y - eye.y, s.z - eye.z), fogNear, fogFar);
    },
    info: () => ({ shown: geo.drawRange.count, max: MAX_FAR }),
  };
}
