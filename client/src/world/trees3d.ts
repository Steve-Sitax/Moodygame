import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx, psxUniforms } from "../retro/psx";

// The trees of the Steenplein and the Werf in autumn (Steve, 2026-09-23: "trees are blobs,
// make them nicer, more detailed"). Models from tools/blender/build_trees.py ->
// /models/trees.glb: a young lime, an elm, a half-bare plane and a bare elm, with real
// branches and crowns of crossed leaf cards (and a pollarded willow, for a canal bank
// when the map has one). One tree per DECOR "trees" position (tools/city/design.py),
// the kind picked by a seed from the position; random yaw, size +-15 %.
//
// Drawing: one InstancedMesh per kind and material (bark, leaves), so 2 draw calls a kind.
// The leaves sway in the wind (more in a storm: uSea) and flutter; the whole crown bends a
// little. Leaf normals point out of the crown and up (set in Blender) and are not flipped on
// the back face, so the sky lights the leaves from both sides. A few leaves fall and drift
// down under each tree (one more draw call). The tree pits are vegetation.ts; the trunk
// colliders are rijnkaai.ts.

type P = [number, number];

/** Kinds placed on the rows, by name in trees.glb. */
const NARROW: Array<[string, number]> = [["tree_lime", 0.62], ["tree_elm", 0.13], ["tree_bare", 0.25]];
const WIDE: Array<[string, number]> = [["tree_plane", 0.42], ["tree_elm", 0.38], ["tree_bare", 0.2]];

const FALLING_PER_TREE = 5;

function hash(x: number, z: number, k = 0): number {
  let h = Math.imul(Math.round(x * 10) | 0, 73856093) ^ Math.imul(Math.round(z * 10) | 0, 19349663) ^ Math.imul(k + 1, 83492791);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function pick(list: Array<[string, number]>, r: number): string {
  let acc = 0;
  for (const [name, w] of list) {
    acc += w;
    if (r < acc) return name;
  }
  return list[list.length - 1][0];
}

const swayGlsl = (leaf: boolean) => /* glsl */ `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec3 treeAt = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
  #else
  vec3 treeAt = vec3(0.0);
  #endif
  float ph = treeAt.x * 0.21 + treeAt.z * 0.17;
  float wind = 0.55 + 0.45 * uSea;
  float hh = max(transformed.y - 2.0, 0.0);
  float bend = hh * hh * 0.0011 * wind;
  float g = sin(uTime * 0.83 + ph) + 0.45 * sin(uTime * 2.07 + ph * 1.7);
  transformed.x += g * bend;
  transformed.z += sin(uTime * 0.61 + ph * 1.3) * bend * 0.6;
  ${
    leaf
      ? `float fl = sin(uTime * 3.4 + dot(position, vec3(1.7, 2.3, 1.1)) + ph) * 0.035 * wind * min(hh, 1.0);
  transformed += objectNormal * fl;
  transformed.y += cos(uTime * 2.9 + dot(position, vec3(2.1, 0.7, 1.9))) * 0.02 * wind * min(hh, 1.0);`
      : ""
  }
}`;

/** psx() plus the wind; leaves also keep their normal on the back face. */
function treeMaterial<T extends THREE.Material>(mat: T, leaf: boolean): T {
  psx(mat, { affine: 0 });
  const base = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", swayGlsl(leaf));
    if (leaf) {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <normal_fragment_begin>",
        THREE.ShaderChunk.normal_fragment_begin.replace("gl_FrontFacing ? 1.0 : - 1.0", "1.0"),
      );
    }
  };
  mat.customProgramCacheKey = () => key.call(mat) + (leaf ? "-treeleaf" : "-treebark");
  return mat;
}

function crisp(t: THREE.Texture | null): void {
  if (!t) return;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
}

export interface Trees3D {
  /** Kind name per tree position, in the order given. */
  kinds: string[];
  meshes: THREE.Object3D[];
}

/**
 * Load trees.glb and plant one tree at each (x, z). `baseAt` gives the ground height
 * (default 0). `willows`: extra positions for pollarded willows (a canal bank).
 */
export async function buildTrees3D(
  scene: THREE.Scene,
  trees: P[],
  opts: { baseAt?: (x: number, z: number) => number; willows?: P[]; kindAt?: (x: number, z: number) => string | null } = {},
): Promise<Trees3D> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/trees.glb");
  draco.dispose();

  // the two materials, with the maps from the file
  let barkMap: THREE.Texture | null = null;
  let leafMap: THREE.Texture | null = null;
  gltf.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m?.map) return;
    if (m.name === "tree_leaves") leafMap ??= m.map;
    else if (m.name === "tree_bark") barkMap ??= m.map;
  });
  crisp(barkMap);
  crisp(leafMap);
  const bark = treeMaterial(new THREE.MeshLambertMaterial({ map: barkMap, vertexColors: true }), false);
  bark.name = "trees_bark";
  const leaves = treeMaterial(
    new THREE.MeshLambertMaterial({ map: leafMap, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }),
    true,
  );
  leaves.name = "trees_leaves";

  // geometry per kind and material, in the kind's own frame
  const geo = new Map<string, { bark?: THREE.BufferGeometry; leaves?: THREE.BufferGeometry }>();
  for (const node of gltf.scene.children) {
    node.updateMatrixWorld(true);
    const entry: { bark?: THREE.BufferGeometry; leaves?: THREE.BufferGeometry } = {};
    node.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const name = (mesh.material as THREE.Material).name;
      if (name === "tree_leaves") entry.leaves = g;
      else entry.bark = g;
    });
    geo.set(node.name, entry);
  }

  // which kind stands where: rows planted close (the Steenplein) get limes, wide ones (the
  // Werf) planes and elms; some of each already bare
  const spots: Array<{ kind: string; x: number; z: number }> = [];
  for (const [x, z] of trees) {
    let nn = Infinity;
    for (const [x2, z2] of trees) if (x2 !== x || z2 !== z) nn = Math.min(nn, Math.hypot(x2 - x, z2 - z));
    const kind = opts.kindAt?.(x, z) ?? pick(nn >= 10 ? WIDE : NARROW, hash(x, z)); // (M7 prison and squares: kindAt)
    spots.push({ kind, x, z });
  }
  for (const [x, z] of opts.willows ?? []) spots.push({ kind: "tree_willow", x, z });

  const baseAt = opts.baseAt ?? (() => 0);
  const byKind = new Map<string, THREE.Matrix4[]>();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  for (const s of spots) {
    if (!geo.has(s.kind)) continue;
    const yaw = hash(s.x, s.z, 1) * Math.PI * 2;
    const k = 0.85 + 0.3 * hash(s.x, s.z, 2);
    q.setFromAxisAngle(up, yaw);
    m4.compose(new THREE.Vector3(s.x, baseAt(s.x, s.z), s.z), q, new THREE.Vector3(k, k, k));
    const list = byKind.get(s.kind) ?? [];
    list.push(m4.clone());
    byKind.set(s.kind, list);
  }

  const meshes: THREE.Object3D[] = [];
  for (const [kind, mats] of byKind) {
    const g = geo.get(kind)!;
    for (const [part, mat] of [
      [g.bark, bark],
      [g.leaves, leaves],
    ] as Array<[THREE.BufferGeometry | undefined, THREE.Material]>) {
      if (!part) continue;
      const im = new THREE.InstancedMesh(part, mat, mats.length);
      mats.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.name = `${kind}_${mat === bark ? "bark" : "leaves"}`;
      scene.add(im);
      meshes.push(im);
    }
  }

  // falling leaves: small diamonds that drift and turn on their way down
  const n = spots.length * FALLING_PER_TREE;
  if (n) {
    const leafGeo = new THREE.BufferGeometry();
    leafGeo.setAttribute("position", new THREE.Float32BufferAttribute([0, -0.05, 0, 0.035, 0, 0, 0, 0.05, 0, -0.035, 0, 0], 3));
    leafGeo.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    leafGeo.setIndex([0, 1, 2, 0, 2, 3]);
    const leafMat = psx(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), { affine: 0 });
    leafMat.name = "trees_falling";
    const fall = new THREE.InstancedMesh(leafGeo, leafMat, n);
    fall.name = "trees_falling";
    fall.frustumCulled = false;
    const cols = [0xc89a30, 0xa8541c, 0x7a4f22, 0xd0b048, 0x8a6a2a];
    const drops = Array.from({ length: n }, (_, i) => {
      const s = spots[Math.floor(i / FALLING_PER_TREE)];
      const r = (k: number) => hash(s.x + i * 0.37, s.z, 10 + k);
      fall.setColorAt(i, new THREE.Color(cols[Math.floor(r(0) * cols.length)]));
      return {
        x: s.x,
        z: s.z,
        y0: baseAt(s.x, s.z),
        top: s.kind === "tree_willow" ? 4 : 7 + r(1) * 2,
        rad: 0.6 + r(2) * 2.4,
        a0: r(3) * Math.PI * 2,
        speed: 0.35 + r(4) * 0.3,
        phase: r(5),
        spin: 1.5 + r(6) * 2.5,
      };
    });
    if (fall.instanceColor) fall.instanceColor.needsUpdate = true;
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    let last = -1;
    fall.onBeforeRender = () => {
      const t = psxUniforms.uTime.value;
      if (t === last) return; // the mirrors draw the scene too: once a frame is enough
      last = t;
      const wind = 0.55 + 0.45 * psxUniforms.uSea.value;
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        const life = d.top / d.speed; // seconds to fall
        const f = (t / life + d.phase) % 1;
        const y = d.top * (1 - f);
        const a = d.a0 + f * 2.2;
        const sway = Math.sin(t * 1.3 + i) * 0.5 * wind;
        pos.set(d.x + Math.cos(a) * d.rad + sway + f * 1.5 * wind, d.y0 + y + 0.03, d.z + Math.sin(a) * d.rad + Math.cos(t * 1.1 + i) * 0.3);
        e.set(t * d.spin + i, t * d.spin * 0.7, Math.sin(t * 2 + i) * 0.8);
        q.setFromEuler(e);
        m4.compose(pos, q, one);
        fall.setMatrixAt(i, m4);
      }
      fall.instanceMatrix.needsUpdate = true;
    };
    scene.add(fall);
    meshes.push(fall);
  }

  return { kinds: spots.map((s) => s.kind), meshes };
}
