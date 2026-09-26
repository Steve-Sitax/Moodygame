import { TOWN } from "./townBox";
import * as THREE from "three";
import { psx, psxUniforms } from "../retro/psx";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
    for (let i = 0; i < 20; i++) {
      const x = 2 + r() * 28;
      const h = 8 + r() * 22;
      const lean = (r() - 0.5) * 8;
      const v = r();
      g.strokeStyle = v < 0.45 ? `rgb(${65 + r() * 25},${78 + r() * 25},${43 + r() * 18})` : `rgb(${112 + r() * 30},${100 + r() * 25},${61 + r() * 18})`;
      g.lineWidth = 1 + (r() < 0.3 ? 1 : 0);
      g.beginPath();
      g.moveTo(x, 32);
      g.quadraticCurveTo(x + lean * 0.3, 32 - h * 0.6, x + lean, 32 - h);
      g.stroke();
      if (i % 5 === 0) {
        // Bent seed stems survive after the green blades have died back.
        g.fillStyle = "#786746";
        for (let j = 0; j < 3; j++) g.fillRect(Math.round(x + lean) + (j % 2 ? 1 : -1), Math.round(32 - h + j * 2), 2, 1);
      }
    }
  }, 11);
}

/** Late flowers in the grass: asters (mauve), dandelions (yellow), yarrow (white). */
function flowerTex(): THREE.CanvasTexture {
  return alphaTex(32, (g, r) => {
    for (let i = 0; i < 9; i++) {
      const x = 3 + r() * 26;
      const h = 10 + r() * 16;
      g.strokeStyle = `rgb(${60 + r() * 20},${85 + r() * 20},${40})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, 32);
      g.lineTo(x + (r() - 0.5) * 3, 32 - h);
      g.stroke();
      const k = r();
      g.fillStyle = k < 0.35 ? "#88748e" : k < 0.55 ? "#b29a4b" : k < 0.75 ? "#c0b8a0" : "#716048";
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

/** Three bent fans, rooted together: uneven clumps rather than a rigid billboard cross. */
function crossGeo(w: number, h: number): THREE.BufferGeometry {
  const fans = [0, 1, 2].map(k => {
    const height = h * [1, 0.79, 0.91][k];
    const a = new THREE.PlaneGeometry(w, height, 1, 2).translate(0, height / 2, 0);
    const pos = a.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / height;
      pos.setXYZ(i, pos.getX(i) * (0.65 + 0.35 * t), pos.getY(i), t * t * h * [0.18, -0.12, 0.1][k]);
    }
    a.rotateY(k * Math.PI / 3 + (k === 1 ? 0.16 : 0));
    const ids = Array.from(a.getIndex()!.array);
    a.setIndex([...ids, ...ids.flatMap((_, i) => i % 3 === 0 ? [ids[i], ids[i + 2], ids[i + 1]] : [])]);
    a.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.count).fill([0, 1, 0]).flat(), 3));
    return a;
  });
  const g = mergeGeometries(fans)!;
  fans.forEach(f => f.dispose());
  return g;
}

function plantMat(map: THREE.Texture): THREE.Material {
  const mat = psx(new THREE.MeshLambertMaterial({ map, alphaTest: 0.5, side: THREE.FrontSide, vertexColors: false }), { affine: 0 });
  const base = mat.onBeforeCompile, key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.uniforms.uPlantWet = psxUniforms.uWet;
    shader.fragmentShader = "uniform float uPlantWet;\n" + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.18 * uPlantWet;");
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float plantPhase = 0.0;
      #ifdef USE_INSTANCING
        plantPhase = instanceMatrix[3].x * 0.73 + instanceMatrix[3].z * 0.31;
      #endif
      transformed.x += sin(uTime * 1.5 + plantPhase) * position.y * position.y * (0.018 + 0.025 * uSea);`);
  };
  mat.customProgramCacheKey = () => key() + "-small-plants-v1";
  return mat;
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
  for (let z = -60; z < TOWN.z0 + TOWN.h; z += 0.8) {
    for (let x = TOWN.x0; x < TOWN.x0 + TOWN.w; x += 0.8) {
      const px = x + (r() - 0.5) * 0.7;
      const pz = z + (r() - 0.5) * 0.7;
      if (!open(px, pz)) continue;
      const w = wallDir(px, pz);
      if (w === 0 || nearTree(px, pz, PIT + 0.5) || blocked(px, pz, 0.8)) continue;
      const corner = w >= 3;
      const roll = r();
      // grass does not grow on paved stone: only in forgotten corners (bushes, a few flowers,
      // a little grass) and as small weeds in the cracks right at the wall foot
      if (corner && roll < 0.03) bushes.push({ x: px, z: pz, s: 0.8 + r() * 0.7, yaw: r() * Math.PI });
      else if (corner && roll < 0.06) flowers.push({ x: px, z: pz, s: 0.5 + r() * 0.35, yaw: r() * Math.PI });
      else if (corner && roll < 0.2) grass.push({ x: px, z: pz, s: 0.45 + r() * 0.4, yaw: r() * Math.PI });
      else if (w >= 2 && roll < 0.07) grass.push({ x: px, z: pz, s: 0.25 + r() * 0.2, yaw: r() * Math.PI });
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
