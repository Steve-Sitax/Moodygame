import * as THREE from "three";
import CITY from "../../../shared/city.json";
import INWORLD from "../../../shared/inworld_houses.json";
import { psx, AIR_GLOW_GLSL, airGlowUniforms } from "../retro/psx";

// Works chimneys on the skyline (picture round 2026-09-26, package 5: "two or three brewery or works chimneys beyond
// the canal and the Entrepot"). Antwerp in 1873 had its industry inside and just outside the walls:
// - the breweries along the Brouwersvliet, the brewers' canal (in the game the Canal des Brasseurs), which gave the
//   street its name; they brewed with steam by then and each had its tall stack in the yard behind the brewhouse;
// - a sugar refinery in an old brewery between the Hessenstraatje and the Oude Leeuwenrui, by the Hessenhuis (in the
//   game the Hanseatic House);
// - the gasworks of the Imperial Continental Gas Association (Sint-Andries, the Kronenburgstraat), south of the old
//   town toward the Kiel: a retort house, its chimney and a gasholder in its guide frame.
// (Inventaris Onroerend Erfgoed: Brouwersvliet, Oudeleeuwenrui, ICGA; see the round2 report.)
// In the town the stacks stand in the middle of a block, in a yard nobody can walk into (the walk map is solid there
// for 5 m round, well away from any door, shop or house with a room inside): only the part over the roofs is seen.
// The gasworks stands outside the wall, on the fields beyond the south moat. Each stack smokes: a thick dark coal
// plume, bent over by the wind the chimney smoke goes with (world/ambient.ts), lying out far over the roofs. The
// brewery and the refinery work by day, the gasworks day and night.
// Drawing: one mesh (vertex colours) seen like a landmark past the fog (fogReach 2.2: a soft silhouette), one Points
// object for all the smoke. Two draw calls.

type Flags = (x: number, z: number) => number | undefined;

interface Stack {
  name: string;
  x: number;
  z: number;
  /** Ground (m) and the stack's height over it. */
  y: number;
  h: number;
  /** Radius at the foot and at the top. */
  r0: number;
  r1: number;
  /** Hours it smokes [from, to], and how thick (0..1). */
  hours: [number, number];
  thick: number;
}

/** Where to look for a spot in a block, and how far round it. */
interface Want {
  name: string;
  x: number;
  z: number;
  reach: number;
  h: number;
  hours: [number, number];
  thick: number;
}

const WANTS: Want[] = [
  // the brewers' canal: a brewery on each side, the stacks in their yards
  { name: "brewery on the canal, west side", x: -100, z: 128, reach: 34, h: 44, hours: [5, 20], thick: 0.75 },
  { name: "brewery on the canal, east side", x: -52, z: 172, reach: 34, h: 40, hours: [5.5, 19.5], thick: 0.65 },
  // the sugar refinery by the Hessenhuis
  { name: "sugar refinery by the Hanseatic House", x: 138, z: 170, reach: 40, h: 52, hours: [4.5, 21], thick: 0.85 },
];

/** The gasworks beyond the south moat, on the fields (the countryside's own ground, y about 0). */
const GASWORKS = { name: "gasworks beyond the south wall", x: -520, z: 205, h: 55 };

const BRICK: [number, number, number] = [0.34, 0.2, 0.15];
const SOOT: [number, number, number] = [0.08, 0.075, 0.07];
const IRON: [number, number, number] = [0.16, 0.16, 0.17];
const SLATE: [number, number, number] = [0.19, 0.2, 0.22];

export interface Works {
  group: THREE.Group;
  /** Once a frame: the clock (0-24), the weather, the air's colour (the fog). */
  update(t: number, dt: number, hour: number, weather: string, air: THREE.Color): void;
  info(): { stacks: Array<{ name: string; x: number; z: number; h: number; smoking: boolean }> };
}

const WIND: Record<string, number> = { fog: 0.35, mist: 0.6, clear: 0.9, rain: 1.5, storm: 3.2 };

export function createWorks(scene: THREE.Scene, flags: Flags, ready: Promise<unknown>): Works {
  const group = new THREE.Group();
  group.name = "works";
  scene.add(group);
  const stacks: Stack[] = [];
  const U = {
    uTime: { value: 0 },
    uWind: { value: new THREE.Vector2(0.9, 0.35) },
    uCol: { value: new THREE.Color(0.1, 0.1, 0.1) },
    uScale: { value: 150 },
  };
  let smoke: THREE.Points | null = null;

  ready.then(() => {
    const doors: Array<[number, number]> = [];
    for (const d of Object.values((CITY as unknown as { doors: Record<string, { x: number; z: number }> }).doors)) doors.push([d.x, d.z]);
    for (const h of (INWORLD as unknown as { houses: Array<{ door?: [number, number] }> }).houses ?? []) if (h.door) doors.push(h.door);
    const places = Object.values((CITY as unknown as { places: Record<string, { x: number; z: number; kind: string }> }).places).filter((p) => p.kind === "building");
    const solidRound = (x: number, z: number, r: number) => {
      if (flags(x, z) !== 1) return false;
      for (const rr of [r * 0.5, r])
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          if (flags(x + Math.cos(a) * rr, z + Math.sin(a) * rr) !== 1) return false;
        }
      return true;
    };
    for (const w of WANTS) {
      let best: [number, number] | null = null;
      let bestD = 1e9;
      for (let dx = -w.reach; dx <= w.reach; dx += 1.5)
        for (let dz = -w.reach; dz <= w.reach; dz += 1.5) {
          const d = Math.hypot(dx, dz);
          if (d > w.reach) continue;
          const x = w.x + dx;
          const z = w.z + dz;
          // deep in the block: 5.5 m of solid round it (a yard), no door within 14 m, no landmark within 22 m
          if (!solidRound(x, z, 5.5)) continue;
          if (doors.some(([ax, az]) => Math.hypot(ax - x, az - z) < 14)) continue;
          if (places.some((p) => Math.hypot(p.x - x, p.z - z) < 22)) continue;
          // (the most solid spot near the wanted one: deeper in the block wins over a little nearer)
          const score = d - (solidRound(x, z, 8) ? 6 : 0);
          if (score < bestD) {
            bestD = score;
            best = [x, z];
          }
        }
      if (best) stacks.push({ name: w.name, x: best[0], z: best[1], y: 0, h: w.h, r0: 1.9, r1: 1.1, hours: w.hours, thick: w.thick });
    }
    stacks.push({ name: GASWORKS.name, x: GASWORKS.x, z: GASWORKS.z, y: -0.2, h: GASWORKS.h, r0: 1.9, r1: 1.1, hours: [0, 24], thick: 1 });
    build();
  }).catch((e) => {
    group.userData.error = String(e);
    console.warn("works did not build", e);
  });

  function build(): void {
    const pos: number[] = [];
    const col: number[] = [];
    const tri = (a: number[], b: number[], c: number[], k: number[]) => {
      pos.push(...a, ...b, ...c);
      for (let i = 0; i < 3; i++) col.push(k[0], k[1], k[2]);
    };
    const quad = (a: number[], b: number[], c: number[], d: number[], k: number[]) => {
      tri(a, b, c, k);
      tri(a, c, d, k);
    };
    const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
    const shade = (k: number[], f: number) => k.map((v) => Math.min(1, v * f));
    /** A ring band from (y0, r0) to (y1, r1), n sides, colours at its foot and top. */
    const band = (x: number, z: number, y0: number, r0: number, y1: number, r1: number, k0: number[], k1: number[], n = 8) => {
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2 + Math.PI / n;
        const a1 = ((i + 1) / n) * Math.PI * 2 + Math.PI / n;
        // (lit from the south-west as the sun is: rijnkaai.ts SUN_HIGH)
        const f = 0.78 + 0.28 * Math.max(0, -Math.cos((a0 + a1) / 2 - 0.5));
        quad([x + Math.cos(a0) * r0, y0, z + Math.sin(a0) * r0], [x + Math.cos(a0) * r1, y1, z + Math.sin(a0) * r1], [x + Math.cos(a1) * r1, y1, z + Math.sin(a1) * r1], [x + Math.cos(a1) * r0, y0, z + Math.sin(a1) * r0], shade(mix(k0, k1, 0.5), f));
      }
    };
    const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, k: number[]) => {
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k);
      quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(k, 0.85));
      quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(k, 0.8));
      quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(k, 0.95));
      quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], shade(k, 1.1));
    };
    /** A gabled shed along x. */
    const shed = (cx: number, cz: number, w: number, d: number, y: number, h: number, wall: number[], roof: number[]) => {
      box(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, y, y + h, wall);
      const top = y + h + d * 0.35;
      quad([cx - w / 2, y + h, cz + d / 2], [cx + w / 2, y + h, cz + d / 2], [cx + w / 2, top, cz], [cx - w / 2, top, cz], roof);
      quad([cx + w / 2, y + h, cz - d / 2], [cx - w / 2, y + h, cz - d / 2], [cx - w / 2, top, cz], [cx + w / 2, top, cz], shade(roof, 0.8));
      tri([cx - w / 2, y + h, cz + d / 2], [cx - w / 2, top, cz], [cx - w / 2, y + h, cz - d / 2], shade(wall, 0.8));
      tri([cx + w / 2, y + h, cz - d / 2], [cx + w / 2, top, cz], [cx + w / 2, y + h, cz + d / 2], shade(wall, 0.9));
    };
    for (const s of stacks) {
      const { x, z, y, h, r0, r1 } = s;
      // the square plinth, then the tapered shaft in bands (darker with soot toward the top), a corbelled cap
      box(x - r0 * 1.2, x + r0 * 1.2, z - r0 * 1.2, z + r0 * 1.2, y, y + 4, shade(BRICK, 0.9));
      const N = 6;
      for (let i = 0; i < N; i++) {
        const t0 = i / N;
        const t1 = (i + 1) / N;
        const k0 = mix(BRICK, SOOT, Math.pow(t0, 2.2) * 0.8);
        const k1 = mix(BRICK, SOOT, Math.pow(t1, 2.2) * 0.8);
        band(x, z, y + 4 + (h - 5.2) * t0, r0 + (r1 - r0) * t0, y + 4 + (h - 5.2) * t1, r0 + (r1 - r0) * t1, k0, k1);
      }
      const yc = y + h - 1.2;
      band(x, z, yc, r1, yc + 0.35, r1 * 1.3, SOOT, SOOT);
      band(x, z, yc + 0.35, r1 * 1.3, y + h, r1 * 1.3, SOOT, SOOT);
      // the mouth: black, a ring inside
      for (let i = 0; i < 8; i++) {
        const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const a1 = ((i + 1) / 8) * Math.PI * 2 + Math.PI / 8;
        quad([x + Math.cos(a0) * r1 * 1.3, y + h, z + Math.sin(a0) * r1 * 1.3], [x + Math.cos(a0) * r1 * 0.8, y + h, z + Math.sin(a0) * r1 * 0.8], [x + Math.cos(a1) * r1 * 0.8, y + h, z + Math.sin(a1) * r1 * 0.8], [x + Math.cos(a1) * r1 * 1.3, y + h, z + Math.sin(a1) * r1 * 1.3], SOOT);
        tri([x + Math.cos(a1) * r1 * 0.8, y + h - 0.5, z + Math.sin(a1) * r1 * 0.8], [x + Math.cos(a0) * r1 * 0.8, y + h - 0.5, z + Math.sin(a0) * r1 * 0.8], [x, y + h - 0.5, z], [0.02, 0.02, 0.02]);
      }
    }
    // the gasworks: a retort house with its louvred ridge, a coal store, the gasholder in its frame
    {
      const g = stacks.find((s) => s.name === GASWORKS.name);
      if (g) {
        const y = g.y;
        shed(g.x + 14, g.z - 2, 30, 14, y, 9, [0.3, 0.19, 0.15], SLATE);
        box(g.x + 8, g.x + 20, g.z - 2.6, g.z - 1.4, y + 9 + 14 * 0.35 - 0.2, y + 9 + 14 * 0.35 + 1.4, shade(SLATE, 0.8)); // the louvre
        shed(g.x - 4, g.z + 16, 18, 10, y, 6, [0.28, 0.2, 0.16], [0.24, 0.16, 0.13]);
        // the gasholder: its bell in the tank, eight cast-iron columns and a ring girder
        const hx = g.x - 26;
        const hz = g.z - 10;
        const R = 12;
        band(hx, hz, y, R, y + 8.5, R, IRON, IRON, 16);
        band(hx, hz, y + 8.5, R, y + 9.5, R * 0.8, shade(IRON, 1.2), shade(IRON, 1.2), 16);
        for (let i = 0; i < 16; i++) {
          const a0 = (i / 16) * Math.PI * 2;
          const a1 = ((i + 1) / 16) * Math.PI * 2;
          tri([hx + Math.cos(a0) * R * 0.8, y + 9.5, hz + Math.sin(a0) * R * 0.8], [hx + Math.cos(a1) * R * 0.8, y + 9.5, hz + Math.sin(a1) * R * 0.8], [hx, y + 10.2, hz], shade(IRON, 1.25));
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const cx = hx + Math.cos(a) * (R + 0.8);
          const cz = hz + Math.sin(a) * (R + 0.8);
          box(cx - 0.35, cx + 0.35, cz - 0.35, cz + 0.35, y, y + 15, IRON);
        }
        band(hx, hz, y + 14.2, R + 0.9, y + 15, R + 0.9, IRON, IRON, 16);
        band(hx, hz, y + 14.2, R + 0.7, y + 15, R + 0.7, IRON, IRON, 16);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    // seen like a landmark: past the fog a soft silhouette (psx fogReach), culled beyond 2.2 fog-fars (world/cull.ts)
    const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { affine: 0, fogReach: 2.2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "works_stacks";
    group.add(mesh);

    // ---- the smoke: PER puffs a stack, each rising out of the mouth and lying out down the wind
    const PER = 26;
    const P = new Float32Array(stacks.length * PER * 3);
    const A = new Float32Array(stacks.length * PER * 4);
    let seed = 7;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    stacks.forEach((s, i) => {
      for (let k = 0; k < PER; k++) {
        const j = i * PER + k;
        P.set([s.x, s.y + s.h + 0.2, s.z], j * 3);
        // (phase, a random, its stack's index, and a placeholder for how much it smokes now)
        A.set([(k + r() * 0.5) / PER, r(), i, 0], j * 4);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(P, 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(A, 4));
    const smat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), ...U, ...airGlowUniforms() },
      fog: true,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uWind;
        uniform float uScale;
        uniform float fogFar;
        ${AIR_GLOW_GLSL}
        attribute vec4 aSeed;
        varying float vAlpha;
        varying float vFogDepth;
        varying float vSeed;
        varying vec3 vGlow;
        void main() {
          float life = 26.0 + aSeed.y * 8.0;
          float age = fract(uTime / life + aSeed.x);
          vec3 p = position;
          float ws = length(uWind);
          // a hot stack's plume: up 6-10 m, then lying over and away with the wind, spreading as it goes
          p.y += (9.0 / (1.0 + 0.5 * ws)) * (1.0 - exp(-age * 4.0)) + age * 5.0;
          p.xz += uWind * age * life * (0.6 + 0.8 * age);
          p.xz += vec2(sin(uTime * 0.4 + aSeed.y * 6.28 + age * 5.0), cos(uTime * 0.33 + aSeed.y * 9.0 + age * 4.0)) * 1.4 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vFogDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
          float size = 2.2 + age * 13.0;
          gl_PointSize = min(size * uScale / max(gl_Position.w, 0.5), 160.0);
          vAlpha = aSeed.w * smoothstep(0.0, 0.05, age) * pow(1.0 - age, 1.3);
          vSeed = aSeed.y;
          if (vAlpha < 0.005 || vFogDepth > fogFar * 2.3) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          // the gas lamps' glow in the air in front of the plume, as in front of the sky behind it (retro/psx.ts)
          else vGlow = airGlow((modelMatrix * vec4(p, 1.0)).xyz, fogFar);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uCol;
        uniform vec3 fogColor;
        uniform float fogNear;
        uniform float fogFar;
        varying float vAlpha;
        varying float vFogDepth;
        varying float vSeed;
        varying vec3 vGlow;
        float h12(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          if (d > 1.0) discard;
          float mottle = 0.55 + 0.45 * h12(floor(gl_PointCoord * 6.0) + vSeed * 71.0);
          float f = smoothstep(fogNear, fogFar * 2.2, vFogDepth);
          float a = min(vAlpha * (1.0 - d * d) * mottle, 0.75) * (1.0 - f * 0.85);
          if (a < 0.008) discard;
          gl_FragColor = vec4(mix(uCol, fogColor * 0.8, f) + vGlow * (0.35 + 0.65 * smoothstep(fogNear, fogFar, vFogDepth)), a);
          #include <colorspace_fragment>
        }`,
    });
    smat.userData.fogReach = 2.3;
    smoke = new THREE.Points(g, smat);
    smoke.name = "works_smoke";
    smoke.frustumCulled = false;
    smoke.renderOrder = 2;
    const sz = new THREE.Vector2();
    smoke.onBeforeRender = (renderer, _s, camera) => {
      const rt = renderer.getRenderTarget();
      const hh = rt ? rt.height : renderer.getDrawingBufferSize(sz).y;
      U.uScale.value = (hh / 2) * (camera as THREE.PerspectiveCamera).projectionMatrix.elements[5];
    };
    group.add(smoke);
  }

  const inHours = (h: number, [a, b]: [number, number]) => (a <= b ? h >= a && h <= b : h >= a || h <= b);
  let lastHour = -1;
  function update(t: number, dt: number, hour: number, weather: string, air: THREE.Color): void {
    U.uTime.value = t;
    // the smoke's wind (ambient.ts), the same veer
    const wa = 0.35 + Math.sin(t * 0.013) * 0.25;
    const ws = (WIND[weather] ?? 0.5) * (1 + 0.2 * Math.sin(t * 0.07));
    U.uWind.value.set(Math.cos(wa) * ws, Math.sin(wa) * ws);
    // coal smoke: darker than the air by day, a little lighter than the dark at night
    const night = hour < 6.5 || hour > 18.5 ? 1 : 0;
    U.uCol.value.copy(air).multiplyScalar(night ? 1.25 : 0.42);
    if (!smoke || Math.abs(hour - lastHour) < 0.05) return;
    lastHour = hour;
    const a = smoke.geometry.getAttribute("aSeed") as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++) {
      const s = stacks[Math.round(a.getZ(i))];
      a.setW(i, s && inHours(hour, s.hours) ? 0.55 * s.thick : 0);
    }
    a.needsUpdate = true;
    void dt;
  }

  const info = () => ({ stacks: stacks.map((s) => ({ name: s.name, x: +s.x.toFixed(1), z: +s.z.toFixed(1), h: s.h, smoking: inHours(lastHour, s.hours) })) });
  // (the dev's way in: scene.getObjectByName("works").userData.info())
  group.userData.info = info;
  return { group, update, info };
}
