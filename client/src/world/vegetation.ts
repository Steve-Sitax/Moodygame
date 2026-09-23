import * as THREE from "three";
import { psx } from "../retro/psx";
import { earthTexture } from "./cityTextures";
import type { Rect } from "./geom";

// Green (and brown) things in the stone city (Steve, 2026-09-23: "trees should not come
// straight out of the pavement; they have a space with dirt. Grasses, flowers on certain
// places, or dead bushes"). In 1873 the young trees of the Steenplein and the Werf stood
// in square pits of bare earth edged with stone. Grass and weeds grow where feet do not
// go: along the foot of walls and in corners. Autumn: a few late flowers, some bushes
// already bare. Everything is instanced (one draw call per kind); no colliders.

type Flags = (x: number, z: number) => number | undefined;
type P = [number, number];

const WALL = 1;
const PIT = 0.8; // half size of a tree pit (1.6 m square)

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function alphaTex(size: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, size, size);
  draw(g, rand(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** Grass blades: thin strokes from the bottom, some bent, green going to straw. */
function grassTex(): THREE.CanvasTexture {
  return alphaTex(32, (g, r) => {
    for (let i = 0; i < 26; i++) {
      const x = 2 + r() * 28;
      const h = 8 + r() * 22;
      const lean = (r() - 0.5) * 8;
      const v = r();
      g.strokeStyle = v < 0.55 ? `rgb(${70 + r() * 30},${92 + r() * 30},${40 + r() * 20})` : `rgb(${130 + r() * 40},${120 + r() * 30},${60 + r() * 20})`;
      g.lineWidth = 1 + (r() < 0.3 ? 1 : 0);
      g.beginPath();
      g.moveTo(x, 32);
      g.quadraticCurveTo(x + lean * 0.3, 32 - h * 0.6, x + lean, 32 - h);
      g.stroke();
    }
  }, 11);
}

/** Late flowers in the grass: asters (mauve), dandelions (yellow), yarrow (white). */
function flowerTex(): THREE.CanvasTexture {
  return alphaTex(32, (g, r) => {
    for (let i = 0; i < 14; i++) {
      const x = 3 + r() * 26;
      const h = 10 + r() * 16;
      g.strokeStyle = `rgb(${60 + r() * 20},${85 + r() * 20},${40})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + (r() - 0.5) * 3, 32 - h);
      g.stroke();
      const k = r();
      g.fillStyle = k < 0.45 ? "#9a78b8" : k < 0.75 ? "#d8b830" : "#e8e4d8";
      g.fillRect(Math.round(x - 1), Math.round(32 - h - 2), 3, 3);
    }
  }, 13);
}

/** A bare bush in autumn: brown twigs, a few last leaves. */
function bushTex(): THREE.CanvasTexture {
  return alphaTex(64, (g, r) => {
    const twig = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y - Math.sin(a) * len;
      g.strokeStyle = `rgb(${62 + r() * 20},${48 + r() * 12},${36})`;
      g.lineWidth = w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x2, y2);
      g.stroke();
      if (depth > 0) for (let k = 0; k < 2; k++) twig(x2, y2, a + (r() - 0.5) * 1.1, len * (0.6 + r() * 0.2), Math.max(1, w - 1), depth - 1);
      else if (r() < 0.25) {
        g.fillStyle = r() < 0.5 ? "#8a5a22" : "#6a4a1a";
        g.fillRect(Math.round(x2), Math.round(y2), 2, 2);
      }
    };
    for (let i = 0; i < 5; i++) twig(26 + r() * 12, 64, Math.PI / 2 + (r() - 0.5) * 1.2, 14 + r() * 8, 2, 4);
  }, 17);
}

/** Fallen leaves round a tree: loose flecks of rust, ochre and brown on nothing. */
function leavesTex(): THREE.CanvasTexture {
  return alphaTex(64, (g, r) => {
    const cols = ["#8a4a18", "#a86a20", "#6e3a14", "#b88a30", "#7a3010"];
    for (let i = 0; i < 160; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 30;
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(Math.round(32 + Math.cos(a) * d), Math.round(32 + Math.sin(a) * d), 2, r() < 0.5 ? 1 : 2);
    }
  }, 19);
}

/** Two crossed upright quads, base at y = 0, width w and height h. */
function crossGeo(w: number, h: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pos = [...(a.getAttribute("position").array as Float32Array), ...(b.getAttribute("position").array as Float32Array)];
  const uv = [...(a.getAttribute("uv").array as Float32Array), ...(b.getAttribute("uv").array as Float32Array)];
  const ia = Array.from(a.getIndex()!.array);
  const ib = Array.from(b.getIndex()!.array).map((i) => i + 4);
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...ia, ...ib]);
  // normals up: grass lit like the ground, not like a wall
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(8).fill([0, 1, 0]).flat(), 3));
  return g;
}

function plantMat(map: THREE.Texture): THREE.Material {
  return psx(new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: false }), { affine: 0 });
}

export interface VegetationOptions {
  trees: P[];
  /** Keep grass and bushes off these (the railway, doors, stalls, lanes). */
  avoid?: Rect[];
  seed?: number;
}

export function buildVegetation(scene: THREE.Scene, flags: Flags, opts: VegetationOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = "vegetation";
  const r = rand(opts.seed ?? 1873);
  const avoid = opts.avoid ?? [];
  const blocked = (x: number, z: number, m: number) => avoid.some((b) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m);
  const open = (x: number, z: number) => flags(x, z) === 0;
  const nearTree = (x: number, z: number, d: number) => opts.trees.some(([tx, tz]) => Math.abs(tx - x) < d && Math.abs(tz - z) < d);

  // --- tree pits: bare earth in a square of edge stones, fallen leaves round them
  {
    const earth = earthTexture();
    earth.wrapS = earth.wrapT = THREE.RepeatWrapping;
    const pitMat = psx(
      new THREE.MeshLambertMaterial({ map: earth, color: 0x8a7a66, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }),
      { noSnap: true, affine: 0 },
    );
    const pitGeo = new THREE.PlaneGeometry(PIT * 2, PIT * 2).rotateX(-Math.PI / 2).translate(0, 0.006, 0);
    const pits = new THREE.InstancedMesh(pitGeo, pitMat, opts.trees.length);
    const kerbGeo = new THREE.BufferGeometry();
    {
      // four edge stones, 12 cm wide, 8 cm high
      const parts: THREE.BufferGeometry[] = [];
      for (const [sx, sz, w, d] of [[0, PIT, PIT * 2 + 0.24, 0.12], [0, -PIT, PIT * 2 + 0.24, 0.12], [PIT, 0, 0.12, PIT * 2], [-PIT, 0, 0.12, PIT * 2]] as const) {
        parts.push(new THREE.BoxGeometry(w, 0.08, d).translate(sx, 0.04, sz));
      }
      const pos: number[] = [];
      const nor: number[] = [];
      for (const p of parts) {
        const q = p.toNonIndexed();
        pos.push(...(q.getAttribute("position").array as Float32Array));
        nor.push(...(q.getAttribute("normal").array as Float32Array));
      }
      kerbGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      kerbGeo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    }
    const kerbMat = psx(new THREE.MeshLambertMaterial({ color: 0x8e8a80 }), { affine: 0 });
    const kerbs = new THREE.InstancedMesh(kerbGeo, kerbMat, opts.trees.length);
    const leafGeo = new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2).translate(0, 0.012, 0);
    const leafMat = psx(
      new THREE.MeshLambertMaterial({ map: leavesTex(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 }),
      { noSnap: true, affine: 0 },
    );
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, opts.trees.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    opts.trees.forEach(([x, z], i) => {
      pits.setMatrixAt(i, m.makeTranslation(x, 0, z));
      kerbs.setMatrixAt(i, m.makeTranslation(x, 0, z));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2);
      leaves.setMatrixAt(i, m.compose(new THREE.Vector3(x + (r() - 0.5), 0, z + (r() - 0.5)), q, one));
    });
    for (const im of [pits, kerbs, leaves]) {
      im.frustumCulled = false;
      group.add(im);
    }
  }

  // --- where plants grow: open ground at the foot of a wall, in corners, in the tree pits
  type Spot = { x: number; z: number; s: number; yaw: number };
  const grass: Spot[] = [];
  const flowers: Spot[] = [];
  const bushes: Spot[] = [];
  const wallDir = (x: number, z: number): number => {
    // how many of 8 directions hit a wall within 0.9 m: 1 = a wall, 2-3 = a corner
    let n = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (flags(x + Math.cos(a) * 0.9, z + Math.sin(a) * 0.9) === WALL) n++;
    }
    return n;
  };
  for (let z = -60; z < 300; z += 0.8) {
    for (let x = -340; x < 200; x += 0.8) {
      const px = x + (r() - 0.5) * 0.7;
      const pz = z + (r() - 0.5) * 0.7;
      if (!open(px, pz)) continue;
      const w = wallDir(px, pz);
      if (w === 0 || nearTree(px, pz, PIT + 0.5) || blocked(px, pz, 0.8)) continue;
      const corner = w >= 3;
      const roll = r();
      if (corner && roll < 0.04) bushes.push({ x: px, z: pz, s: 0.8 + r() * 0.7, yaw: r() * Math.PI });
      else if (corner && roll < 0.1) flowers.push({ x: px, z: pz, s: 0.7 + r() * 0.5, yaw: r() * Math.PI });
      else if (roll < (corner ? 0.6 : 0.3)) grass.push({ x: px, z: pz, s: 0.6 + r() * 0.8, yaw: r() * Math.PI });
    }
  }
  // the tree pits: grass at the edges, now and then a few flowers
  for (const [tx, tz] of opts.trees) {
    for (let k = 0; k < 7; k++) {
      const a = r() * Math.PI * 2;
      const d = PIT * (0.45 + r() * 0.45);
      (r() < 0.2 ? flowers : grass).push({ x: tx + Math.cos(a) * d, z: tz + Math.sin(a) * d, s: 0.6 + r() * 0.5, yaw: r() * Math.PI });
    }
  }

  const place = (spots: Spot[], geo: THREE.BufferGeometry, mat: THREE.Material, tint: () => THREE.Color) => {
    if (!spots.length) return;
    const im = new THREE.InstancedMesh(geo, mat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    spots.forEach((s, i) => {
      q.setFromAxisAngle(up, s.yaw);
      im.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0, s.z), q, new THREE.Vector3(s.s, s.s, s.s)));
      im.setColorAt(i, tint());
    });
    im.frustumCulled = false;
    group.add(im);
  };
  const c = new THREE.Color();
  place(grass, crossGeo(0.6, 0.45), plantMat(grassTex()), () => c.setRGB(0.8 + r() * 0.3, 0.8 + r() * 0.25, 0.7 + r() * 0.2));
  place(flowers, crossGeo(0.5, 0.42), plantMat(flowerTex()), () => c.setRGB(1, 1, 1));
  place(bushes, crossGeo(1.3, 1.3), plantMat(bushTex()), () => c.setRGB(0.9 + r() * 0.2, 0.9 + r() * 0.15, 0.9));

  scene.add(group);
  return group;
}
