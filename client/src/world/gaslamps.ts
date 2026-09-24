import * as THREE from "three";
import { psxUniforms } from "../retro/psx";
import { fireViewHeight } from "./fire";

// The gas lamps one by one (M6 town life): each lamp of the town has its own lit state, set
// by the lamplighter's progress (game/lamplighter.ts, server town/lampround.ts). Cheap: no new
// lights. The six lamps of the Rijnkaai quay keep their own point lights and fog glow and are
// only gated per lamp here; the 32 lamps of the city (props.glb "gas_lamp") get their glass
// coloured per lamp and one Points object for all their halos, with a per-lamp attribute.
// A lamp nobody has set follows the clock as before (lit when it is dark).

export interface GasLamps {
  /** A city lamp as placed (props.glb gas_lamp), index i of city.json decor.lamps: id "d<i>". */
  addDecor(i: number, obj: THREE.Object3D, x: number, z: number): void;
  /** The lamplighter's word: this lamp burns (true) or not. */
  set(id: string, on: boolean): void;
  /** The eased level (0..1) of a quay lamp, "q<i>", for rijnkaai.ts's lights. */
  quay(i: number): number;
  /** Once a frame: `dark` how dark it is (the clock's 0..1), the fog colour for unlit glass. */
  update(dt: number, dark: number, fog: THREE.Color): void;
  /** Where each lamp is (the post, the glass at 3.65 m). */
  lamps(): Array<{ id: string; x: number; z: number }>;
  info(): { lamps: number; on: number; set: number };
}

const GLASS_Y = 3.65;

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

export function createGasLamps(scene: THREE.Scene, quay: Array<{ x: number; z: number }>): GasLamps {
  interface L {
    id: string;
    x: number;
    z: number;
    want: number;
    level: number;
    set: boolean;
    glass: THREE.MeshBasicMaterial[];
    slot: number;
  }
  const all = new Map<string, L>();
  quay.forEach((q, i) => all.set(`q${i}`, { id: `q${i}`, x: q.x, z: q.z, want: 1, level: 1, set: false, glass: [], slot: -1 }));

  // the city lamps' halos: one Points object, a slot per lamp, the lit level as an attribute
  const MAX = 64;
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
  const halos = new THREE.Points(geo, mat);
  halos.frustumCulled = false;
  halos.renderOrder = 3;
  halos.name = "gas_lamp_halos";
  scene.add(halos);
  let used = 0;
  const litGlass = new THREE.Color();
  const tmp = new THREE.Color();

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
      all.set(`d${i}`, { id: `d${i}`, x, z, want: 1, level: 1, set: false, glass, slot });
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
    update(dt, dark, fog) {
      uniforms.uViewH.value = fireViewHeight();
      const k = Math.min(1, dt * 2.5); // the gas catches in about half a second
      let dirty = false;
      for (const l of all.values()) {
        l.level += (l.want - l.level) * k;
        if (l.slot < 0 && !l.glass.length) continue;
        const v = Math.max(0, Math.min(1, l.level * dark));
        for (const g of l.glass) {
          // unlit glass takes the colour of the air round it (as the quay lamps do)
          g.color.copy(tmp.copy(fog).multiplyScalar(0.8 * (1 - v))).add(litGlass.setRGB(1.0 * v, 0.72 * v, 0.38 * v));
        }
        if (l.slot >= 0 && Math.abs(lit[l.slot] - v) > 0.002) {
          lit[l.slot] = v;
          dirty = true;
        }
      }
      if (dirty) geo.attributes.aLit.needsUpdate = true;
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
  };
}
