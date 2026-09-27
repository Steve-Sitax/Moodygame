import * as THREE from "three";

// The sun and the moon through a hall's windows (Steve, 2026-09-27: "the special buildings need some better lighting
// inside ... make it moody and cool. Churches bright but with shadow work"; the Codex mood passes of the cathedral and
// St James at midday and by night, docs/milestones/hall-light.md).
//
// No real light and no shadow map (docs/rendering.md). The sun (the street's bearing, an autumn noon's height) is
// traced once, when the hall is built, from every texel of the floor back up toward it: where the ray leaves through a window the
// floor is lit, in the glass's colour; a pier, a column or the wall over an arcade in its way throws its shadow, a
// mullion a thin dark bar. The floor light is one quad over the floor that lights what is under it by its own colour
// (dst * (1 + src): a pale slab gets brighter than a black one, as sunlight does); so is each wall the sun falls
// on across the hall (the arcade's wall over its arches, lit through the clerestory). The shafts are two crossed sheets per
// window, the light's own path to its patch, with a little dust in them. By night the same paths carry the moon, cold
// and faint. The owner calls set() with the hall's daylight.

/** A window in the hall's frame (local metres, floor y 0). */
export interface SunWindow {
  /** its middle on the wall's plane */
  x: number;
  z: number;
  /** the way into the room (unit, level) */
  nx: number;
  nz: number;
  /** half its width, sill and head */
  hw: number;
  y0: number;
  y1: number;
  /** lights (mullions + 1); a pointed head from `spring` */
  lights?: number;
  spring?: number;
  /** stained glass: its light in colours */
  colour?: boolean;
  /** a shaft drawn for it */
  shaft?: boolean;
}

/** A pier or column: its middle, radius (or half width), height. */
export interface SunPier {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** A wall line with openings under `open` (an arcade: open up to its arches, wall above). */
export interface SunScreen {
  /** "x": a wall along z at x = at (from..to along z); "z": along x at z = at */
  along: "z" | "x";
  at: number;
  from: number;
  to: number;
  open: number;
  /** or: solid only in these height bands (a gallery's floor and the wall over its arches) */
  solid?: Array<[number, number]>;
}

/** A floor over part of the hall (a gallery, a loft): the light from above stops on it. */
export interface SunSlab {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

export interface HallSunSpec {
  /** the floor's box (local) and texels per metre */
  floor: { minX: number; maxX: number; minZ: number; maxZ: number };
  res?: number;
  windows: SunWindow[];
  piers?: SunPier[];
  screens?: SunScreen[];
  slabs?: SunSlab[];
  /** walls the sun falls on (a to b along the floor, y0..y1; only their solid part: over the arches) */
  walls?: Array<{ a: [number, number]; b: [number, number]; y0: number; y1: number; n: [number, number]; off?: number }>;
  /** only these rects are lit (the floors); else the whole box */
  floors?: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
  /** the floor light's y (over the floor's own top) */
  y?: number;
  /** strength of the sun's patches and the shafts at a clear noon */
  power?: number;
  shafts?: number;
}

export interface HallSun {
  group: THREE.Group;
  /** day 0..1, sky (weather 0.5..1), the room's ambient knob */
  set(day: number, sky: number): void;
  /** Dev: how much floor is lit, the windows that let the sun in, the build's ms. */
  info(): { litTexels: number; wallTexels: number; texels: number; sunWindows: number; shafts: number; ms: number };
}

/**
 * Toward the sun, world: the street's sun's bearing (rijnkaai.ts SUN_HIGH), at an autumn noon's height over Antwerp
 * (30 degrees: 51 north, late September to October), so the light comes well into the halls.
 */
const SUN_TOWARD = new THREE.Vector3(-0.806, Math.tan(Math.PI / 6), 0.591).normalize();

const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// the colours of the stained glass as light: ruby, cobalt, gold, a green, a violet, and much pale glass between
const STAINED: Array<[number, number, number]> = [
  [1.0, 0.32, 0.26],
  [0.36, 0.5, 1.0],
  [1.0, 0.78, 0.36],
  [0.5, 0.9, 0.5],
  [0.8, 0.45, 0.95],
  [1.0, 0.93, 0.8],
  [1.0, 0.93, 0.8],
];

let beamTex: THREE.CanvasTexture | null = null;
/** A shaft's picture: bright at the glass, fading to the floor, soft at its edges, a little dust in it. */
function beamTexture(): THREE.CanvasTexture {
  if (beamTex) return beamTex;
  const W = 32;
  const H = 128;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(255,244,222,1)");
  grad.addColorStop(0.55, "rgba(255,238,210,0.55)");
  grad.addColorStop(1, "rgba(255,232,200,0.08)");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // streaks along the shaft (the light through the leading), then the motes
  for (let i = 0; i < W; i++) {
    const k = 0.72 + 0.28 * hash(i, 3.7);
    g.fillStyle = `rgba(0,0,0,${(1 - k).toFixed(3)})`;
    g.fillRect(i, 0, 1, H);
  }
  for (let i = 0; i < 70; i++) {
    g.fillStyle = `rgba(255,250,235,${(0.25 + 0.5 * hash(i, 9.1)).toFixed(2)})`;
    g.fillRect(Math.floor(hash(i, 1.3) * W), Math.floor(hash(i, 5.9) * H), 1, 1);
  }
  // soft edges across
  const img = g.getImageData(0, 0, W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const e = Math.min(x + 0.5, W - x - 0.5) / (W * 0.3);
      const k = Math.min(1, e) ** 1.5;
      const p = (y * W + x) * 4;
      for (let q = 0; q < 3; q++) img.data[p + q] *= k;
    }
  g.putImageData(img, 0, 0);
  beamTex = new THREE.CanvasTexture(c);
  beamTex.colorSpace = THREE.SRGBColorSpace;
  beamTex.magFilter = THREE.LinearFilter;
  beamTex.minFilter = THREE.LinearFilter;
  beamTex.generateMipmaps = false;
  return beamTex;
}

/** A light picture (RGBA bytes, W x H) softened a little: the sun is not a point. */
function soften(data: Uint8Array, W: number, H: number): THREE.DataTexture {
  const soft = new Uint8Array(W * H * 4);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      for (let q = 0; q < 3; q++) {
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
            const wgt = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
            s += data[(jj * W + ii) * 4 + q] * wgt;
            n += wgt;
          }
        soft[(j * W + i) * 4 + q] = s / n;
      }
      soft[(j * W + i) * 4 + 3] = 255;
    }
  const tex = new THREE.DataTexture(soft, W, H, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** The light on a surface: it lights what is under it by its own colour (dst * (1 + src)). */
function lightMaterial(tex: THREE.Texture): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    map: tex,
    color: 0x000000,
    transparent: true,
    depthWrite: false,
    fog: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.DstColorFactor,
    blendDst: THREE.OneFactor,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  m.name = "hall_sun_light";
  return m;
}

/** Build a hall's sun: `frame` is the hall's frame (its matrixWorld set); `spec` in that frame. */
export function buildHallSun(frame: THREE.Group, spec: HallSunSpec): HallSun {
  const t0 = performance.now();
  const group = new THREE.Group();
  group.name = "hall_sun";
  frame.add(group);
  frame.updateMatrixWorld(true);
  // the sun's way in the hall's frame: d the light's travel (down), dh level and unit
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  const toward = SUN_TOWARD.clone().transformDirection(inv);
  const d = toward.clone().negate();
  const dh = new THREE.Vector2(d.x, d.z);
  const dhl = dh.length();
  dh.normalize();
  const slope = -d.y / dhl; // rise per metre across
  const res = spec.res ?? 4;
  const sunWins = spec.windows.filter((w) => w.nx * d.x + w.nz * d.z > 0.08);
  const piers = spec.piers ?? [];
  const screens = spec.screens ?? [];
  const slabs = spec.slabs ?? [];
  const solidAt = (s: SunScreen, y: number) => (s.solid ? s.solid.some(([a, b]) => y >= a && y <= b) : y > s.open);
  // how much each window lights (a shaft only where its light lands)
  const hits = new Map<SunWindow, number>();
  const col: [number, number, number] = [0, 0, 0];

  /** The sun at a point (x, qy, z) of the hall: its colour summed over the windows it comes through (col); false in shade. */
  function trace(x: number, qy: number, z: number): boolean {
    // a pier's shadow: behind it along the light, as far as its height throws
    for (const p of piers) {
      const wx = x - p.x;
      const wz = z - p.z;
      const s = wx * dh.x + wz * dh.y;
      if (s < -p.r || s > (p.h - qy) / slope) continue;
      if (Math.abs(wx * dh.y - wz * dh.x) < p.r) return false;
    }
    col[0] = col[1] = col[2] = 0;
    let any = false;
    for (const w of sunWins) {
      // back up the ray to the window's plane
      const into = (x - w.x) * w.nx + (z - w.z) * w.nz;
      if (into <= 0) continue;
      const run = into / (dh.x * w.nx + dh.y * w.nz); // metres across, back toward the window
      if (run <= 0) continue;
      const y = qy + run * slope;
      if (y < w.y0 || y > w.y1) continue;
      const px = x - dh.x * run;
      const pz = z - dh.y * run;
      const u = (px - w.x) * -w.nz + (pz - w.z) * w.nx; // along the wall
      if (Math.abs(u) > w.hw) continue;
      // a pointed head: the arch narrows it
      const sp = w.spring ?? w.y1 - w.hw * 1.3;
      if (y > sp) {
        const k = (y - sp) / Math.max(0.01, w.y1 - sp);
        if (Math.abs(u) > w.hw * Math.sqrt(Math.max(0, 1 - k * k))) continue;
      }
      // a mullion
      const n = w.lights ?? 2;
      const uf = ((u + w.hw) / (2 * w.hw)) * n;
      const m = Math.abs(uf - Math.round(uf));
      if (Math.round(uf) > 0 && Math.round(uf) < n && m < 0.045 * n) continue;
      // a wall over an arcade on the way
      let blocked = false;
      for (const s of screens) {
        if (s.along === "z") {
          const t = (s.at - x) / -dh.x; // metres back to the line
          if (!(t > 0 && t < run)) continue;
          const zz = z - dh.y * t;
          if (zz < s.from || zz > s.to) continue;
          if (solidAt(s, qy + t * slope)) blocked = true;
        } else {
          const t = (s.at - z) / -dh.y;
          if (!(t > 0 && t < run)) continue;
          const xx = x - dh.x * t;
          if (xx < s.from || xx > s.to) continue;
          if (solidAt(s, qy + t * slope)) blocked = true;
        }
        if (blocked) break;
      }
      // a gallery's floor between the window and the point
      if (!blocked)
        for (const sl of slabs) {
          const t = (sl.y - qy) / slope;
          if (t <= 0 || t >= run) continue;
          const xx = x - dh.x * t;
          const zz = z - dh.y * t;
          if (xx > sl.minX && xx < sl.maxX && zz > sl.minZ && zz < sl.maxZ) {
            blocked = true;
            break;
          }
        }
      if (blocked) continue;
      // its colour: clear glass warm white, stained glass in blotches of colour
      let c: [number, number, number] = [1.0, 0.95, 0.84];
      if (w.colour) c = STAINED[Math.floor(hash(Math.floor(u / 0.35), Math.floor(y / 0.45)) * STAINED.length)];
      col[0] += c[0];
      col[1] += c[1];
      col[2] += c[2];
      hits.set(w, (hits.get(w) ?? 0) + 1);
      any = true;
    }
    return any;
  }

  // ---- the floor
  const F = spec.floor;
  const W = Math.max(2, Math.ceil((F.maxX - F.minX) * res));
  const H = Math.max(2, Math.ceil((F.maxZ - F.minZ) * res));
  const floors = spec.floors;
  const data = new Uint8Array(W * H * 4);
  let lit = 0;
  for (let j = 0; j < H; j++) {
    const z = F.minZ + (j + 0.5) / res;
    for (let i = 0; i < W; i++) {
      const x = F.minX + (i + 0.5) / res;
      if (floors && !floors.some((f) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ)) continue;
      if (!trace(x, 0, z)) continue;
      lit++;
      const p = (j * W + i) * 4;
      data[p] = Math.min(255, col[0] * 180);
      data[p + 1] = Math.min(255, col[1] * 180);
      data[p + 2] = Math.min(255, col[2] * 180);
    }
  }
  const lightMats: Array<{ m: THREE.MeshBasicMaterial; k: number }> = [];
  const floorMat = lightMaterial(soften(data, W, H));
  lightMats.push({ m: floorMat, k: 1 });
  const fq = new THREE.PlaneGeometry(F.maxX - F.minX, F.maxZ - F.minZ);
  // (the plane's uv v runs up its y: after the turn to the floor, v runs toward -z; the texture's rows run +z)
  fq.rotateX(-Math.PI / 2);
  const uv = fq.getAttribute("uv") as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - uv.getY(k));
  const floorMesh = new THREE.Mesh(fq, floorMat);
  floorMesh.position.set((F.minX + F.maxX) / 2, spec.y ?? 0.012, (F.minZ + F.maxZ) / 2);
  floorMesh.renderOrder = 1;
  floorMesh.name = "hall_sun_floor";
  group.add(floorMesh);

  // ---- the walls the sun falls on across the hall (the arcade's wall over its arches, lit through the clerestory)
  let wallLit = 0;
  for (const wr of spec.walls ?? []) {
    const ax = wr.b[0] - wr.a[0];
    const az = wr.b[1] - wr.a[1];
    const L = Math.hypot(ax, az);
    // its face (into the room): lit only if it looks toward the light
    const [nx, nz] = wr.n;
    const cos = -(nx * d.x + nz * d.z);
    if (cos < 0.12) continue;
    const off = wr.off ?? 0.04;
    const WW = Math.max(2, Math.ceil(L * res));
    const HH = Math.max(2, Math.ceil((wr.y1 - wr.y0) * res));
    const wd = new Uint8Array(WW * HH * 4);
    let n = 0;
    for (let j = 0; j < HH; j++) {
      const y = wr.y0 + (j + 0.5) / res;
      for (let i = 0; i < WW; i++) {
        const s = (i + 0.5) / res;
        const x = wr.a[0] + (ax / L) * s + nx * off;
        const z = wr.a[1] + (az / L) * s + nz * off;
        if (!trace(x, y, z)) continue;
        n++;
        // (the wall takes the light at a slant: its cosine against the floor's)
        const k = (cos / -d.y) * 180;
        const p = (j * WW + i) * 4;
        wd[p] = Math.min(255, col[0] * k);
        wd[p + 1] = Math.min(255, col[1] * k);
        wd[p + 2] = Math.min(255, col[2] * k);
      }
    }
    if (!n) continue;
    wallLit += n;
    const m = lightMaterial(soften(wd, WW, HH));
    lightMats.push({ m, k: 1 });
    const g = new THREE.BufferGeometry();
    const P = [
      [wr.a[0] + nx * off, wr.y0, wr.a[1] + nz * off],
      [wr.b[0] + nx * off, wr.y0, wr.b[1] + nz * off],
      [wr.b[0] + nx * off, wr.y1, wr.b[1] + nz * off],
      [wr.a[0] + nx * off, wr.y1, wr.a[1] + nz * off],
    ];
    g.setAttribute("position", new THREE.Float32BufferAttribute(P.flat(), 3));
    // (the picture's rows run up the wall from y0: v 0 at the foot)
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeBoundingSphere();
    const wm = new THREE.Mesh(g, m);
    wm.renderOrder = 1;
    wm.name = "hall_sun_wall";
    group.add(wm);
  }

  // ---- the shafts: from the glass down along the light to where it lands, two crossed sheets each
  const beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0x000000, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  beamMat.name = "hall_sun_shaft";
  const beams: THREE.BufferGeometry[] = [];
  for (const w of sunWins.filter((q) => q.shaft !== false && (hits.get(q) ?? 0) > 2.5 * res * res)) {
    const y = (w.y0 + Math.min(w.y1, w.spring ?? w.y1)) / 2;
    const hgt = Math.min(w.y1, w.spring ?? w.y1) - w.y0;
    const len = y / -d.y;
    const top = new THREE.Vector3(w.x, y, w.z);
    const bot = top.clone().addScaledVector(d, len);
    const along = new THREE.Vector3(-w.nz, 0, w.nx).multiplyScalar(w.hw * 0.92);
    const up = new THREE.Vector3(0, hgt * 0.45, 0);
    // a sheet across the window's width, and one up its height, both along the light
    for (const side of [along, up]) {
      const g = new THREE.BufferGeometry();
      const P = [top.clone().sub(side), top.clone().add(side), bot.clone().add(side), bot.clone().sub(side)];
      g.setAttribute("position", new THREE.Float32BufferAttribute(P.flatMap((v) => [v.x, v.y, v.z]), 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      beams.push(g);
    }
  }
  if (beams.length) {
    const merged = new THREE.BufferGeometry();
    const pos: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    for (const g of beams) {
      const base = pos.length / 3;
      pos.push(...(g.getAttribute("position").array as Float32Array));
      uvs.push(...(g.getAttribute("uv").array as Float32Array));
      idx.push(...(g.index!.array as Uint16Array).map((q) => q + base));
      g.dispose();
    }
    merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    merged.setIndex(idx);
    merged.computeBoundingSphere();
    const shaftMesh = new THREE.Mesh(merged, beamMat);
    shaftMesh.renderOrder = 3;
    shaftMesh.name = "hall_sun_shafts";
    group.add(shaftMesh);
  }
  const power = spec.power ?? 1;
  const shaftK = spec.shafts ?? 1;
  const SUN = new THREE.Color(1.0, 0.93, 0.8);
  const MOON = new THREE.Color(0.42, 0.55, 0.85);
  const moonC = new THREE.Color();
  const ms = performance.now() - t0;
  const info = () => ({ litTexels: lit, wallTexels: wallLit, texels: W * H, sunWindows: sunWins.length, shafts: beams.length / 2, ms: Math.round(ms) });
  // (dev: the halls' checks find it in the room's scene)
  group.userData.sunInfo = info;
  return {
    group,
    set(day, sky) {
      // the sun only in clear or thin weather; the moon on clear nights
      const clear = THREE.MathUtils.clamp((sky - 0.55) * 2.2, 0, 1);
      const sun = THREE.MathUtils.smoothstep(day, 0.15, 0.6) * clear;
      const moon = (1 - THREE.MathUtils.smoothstep(day, 0.0, 0.25)) * clear;
      // (a patch of sun is several times the light of the sky inside: the slab under it x4 and more)
      for (const { m, k } of lightMats) m.color.copy(SUN).multiplyScalar(4.2 * power * k * sun).add(moonC.copy(MOON).multiplyScalar(0.45 * power * k * moon));
      beamMat.color.copy(SUN).multiplyScalar(0.22 * shaftK * sun).add(moonC.copy(MOON).multiplyScalar(0.035 * shaftK * moon));
    },
    info,
  };
}
