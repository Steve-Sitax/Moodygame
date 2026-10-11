import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { sharedMaterial } from "../world/staticMerge";
import { CRATE_CLASS, CRATE_GOODS, crateLabelFor, pickCrate, type CrateClass } from "../../../shared/crateCatalog";

// The one packing crate (Steve 2026-10-11: "wooden boxes have a bunch of textures, I think we only need one, and make
// it high detail"; CLAUDE.md: one model per thing, changed everywhere). tools/blender/build_crate.py ->
// /models/crate.glb: the closed crate and the open one (its lid leaning on an end, straw inside), one picture, one
// material. Sizes are classes of the same model, scaled as a whole (shared/crateCatalog.ts CRATE_CLASS). What it says
// is its goods' stencil (shared/crateCatalog.ts CRATE_GOODS): the front and back boards are moved to the goods' cell
// of the picture, so every crate is one material and merges with every other (docs/performance.md).
//
// Every crate of the town is this one: the goods items (job goods, the piles, the Rijnkaai's big cases, the heaps'
// pieces) in hands, on carts and on the ground (game/goods.ts, props.ts), the quays' heaps (world/quaygoods.ts), the
// props' crates (world/props3d.ts), the clutter, the dockers' loads and seats (game/crowd.ts), the residents' carts
// (world/traffic.ts), the wagons and the crane hooks (world/railway.ts, rijnkaai.ts), the rooms and the halls.

export { crateLabelFor, pickCrate, CRATE_CLASS, type CrateClass };

/**
 * The crates that were props.glb's models (the goods items' "p:" looks, the props' scatter): the one crate at a size
 * class, closed or open (the lid off, leaning on it). The model name -> class, open.
 */
export const PROP_CRATES: Record<string, [CrateClass, boolean]> = {
  crate: ["large", false],
  crate_small: ["small", false],
  crate_seat: ["small", false],
  crate_big: ["big", false],
  crate_open: ["big", true],
  crate_broken: ["big", true],
};

interface Loaded {
  /** Per variant (closed, open): the body and the marks (the stencilled faces, in cell 0). */
  closed: { body: THREE.BufferGeometry; marks: THREE.BufferGeometry };
  open: { body: THREE.BufferGeometry; marks: THREE.BufferGeometry };
  /** The goods cells in the picture: width, height (uv), columns. */
  cells: [number, number, number];
  map: THREE.Texture;
}

let loaded: Loaded | null = null;
let loading: Promise<Loaded> | null = null;
const waiting: Array<() => void> = [];

/** Load crate.glb once (the town's loading waits for it: it is small). */
export function loadCrates(): Promise<void> {
  loading ??= load();
  return loading.then(() => undefined);
}
/** The crate is in (the sync calls below return null until then). */
export const cratesReady = (): boolean => loaded !== null;
/** Run `f` once the crate is in (at once if it is). */
export function whenCrates(f: () => void): void {
  if (loaded) f();
  else {
    waiting.push(f);
    void loadCrates();
  }
}

async function load(): Promise<Loaded> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/crate.glb");
  draco.dispose();
  gltf.scene.updateMatrixWorld(true);
  let map: THREE.Texture | null = null;
  let cells: [number, number, number] = [432 / 4096, 462 / 2048, 9];
  const part = (name: string): THREE.BufferGeometry => {
    const o = gltf.scene.getObjectByName(name) as THREE.Mesh | undefined;
    if (!o?.isMesh) throw new Error(`crate.glb: no ${name}`);
    map ??= (o.material as THREE.MeshStandardMaterial).map;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) g.deleteAttribute(k);
    // (glTF colours are linear and may come as 4 numbers: the shade as a plain factor, 3 numbers)
    const c = g.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (c && c.itemSize === 4) {
      const a = new Float32Array(c.count * 3);
      for (let i = 0; i < c.count; i++) {
        a[i * 3] = c.getX(i);
        a[i * 3 + 1] = c.getY(i);
        a[i * 3 + 2] = c.getZ(i);
      }
      g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    }
    return g;
  };
  const root = gltf.scene.getObjectByName("crate");
  const ex = root?.userData?.crate_cells as number[] | undefined;
  if (ex) cells = [ex[0], ex[1], ex[2]];
  const out: Loaded = {
    closed: { body: part("crate"), marks: part("crate_marks") },
    open: { body: part("crate_open"), marks: part("crate_open_marks") },
    cells,
    map: map!,
  };
  // (the bump audit: a texture named for what it is: "crate wood" reads as wood, world/bumps.ts)
  out.map.name = "crate wood";
  out.map.colorSpace = THREE.SRGBColorSpace;
  out.map.anisotropy = 8;
  loaded = out;
  for (const f of waiting.splice(0)) f();
  return out;
}

let mat: THREE.Material | null = null;
let instMat: THREE.Material | null = null;
/** The crate's material: one for every crate of the town (psx Lambert with the picture and the baked shade). */
export function crateMaterial(): THREE.Material {
  if (!loaded) throw new Error("crate not loaded");
  if (!mat) {
    mat = sharedMaterial(psx(new THREE.MeshLambertMaterial({ map: loaded.map, vertexColors: true })));
    mat.name = "crate wood";
  }
  return mat;
}
/** The same for an InstancedMesh (a material used by one is used by nothing else: docs/performance.md). */
export function crateInstancedMaterial(): THREE.Material {
  if (!loaded) throw new Error("crate not loaded");
  if (!instMat) {
    instMat = sharedMaterial(psx(new THREE.MeshLambertMaterial({ map: loaded.map, vertexColors: true })));
    instMat.name = "crate wood";
  }
  return instMat;
}

const geos = new Map<string, THREE.BufferGeometry>();

/**
 * The crate's geometry for the goods `cell` (CRATE_GOODS index), closed or open, at class 1, its foot at y 0, its
 * front (the stencil) toward +z; shared, do not dispose. Null until the crate is in.
 */
export function crateGeometry(cell: number, open = false): THREE.BufferGeometry | null {
  if (!loaded) return null;
  const k = ((cell % CRATE_GOODS.length) + CRATE_GOODS.length) % CRATE_GOODS.length;
  const key = `${k}|${open ? 1 : 0}`;
  let g = geos.get(key);
  if (g) return g;
  const v = open ? loaded.open : loaded.closed;
  const marks = v.marks.clone();
  const [du, dv] = crateCellShift(k);
  const uv = marks.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv);
  g = mergeGeometries([v.body, marks], false)!;
  marks.dispose();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = `crate ${CRATE_GOODS[k].what.toLowerCase()}${open ? " open" : ""}`;
  geos.set(key, g);
  return g;
}

/** A crate as a mesh: the goods `cell`, closed or open, scaled to its class (or `scale`). Null until the crate is in. */
export function crateMesh(cell: number, opts: { open?: boolean; cls?: CrateClass; scale?: number } = {}): THREE.Mesh | null {
  const g = crateGeometry(cell, opts.open);
  if (!g) return null;
  const m = new THREE.Mesh(g, crateMaterial());
  m.name = "crate";
  m.scale.setScalar(opts.scale ?? CRATE_CLASS[opts.cls ?? "standard"]);
  return m;
}

/** The crate of a goods item (its stencil by its id: the same wherever it goes). */
export function crateOf(id: string | null | undefined, opts: { open?: boolean; cls?: CrateClass; scale?: number } = {}): THREE.Mesh | null {
  return crateMesh(crateLabelFor(id), opts);
}

/** The crate's two parts at class 1 (shared, do not change): the body, and the marks (the stencilled faces, in cell 0). */
export function crateParts(open = false): { body: THREE.BufferGeometry; marks: THREE.BufferGeometry } | null {
  return loaded ? (open ? loaded.open : loaded.closed) : null;
}

/** How far the marks' uv move for the goods `cell` (CRATE_GOODS index): add to u and v (glTF uv, v down). */
export function crateCellShift(cell: number): [number, number] {
  const [cw, ch, cols] = loaded?.cells ?? [432 / 4096, 462 / 2048, 9];
  const k = ((cell % CRATE_GOODS.length) + CRATE_GOODS.length) % CRATE_GOODS.length;
  return [(k % cols) * cw, Math.floor(k / cols) * ch];
}

/** A crate's vertices as flat arrays (for the merged scenery: quay goods, clutter): `label` marks the stencilled faces. */
export interface CrateArrays {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  label: boolean;
}

/** The one crate placed by `M` (in its model's frame: its foot, its turn, its scale) as two flat parts. Empty until it is in. */
export function crateArrays(M: THREE.Matrix4, open = false): CrateArrays[] {
  const cp = crateParts(open);
  if (!cp) return [];
  const nm = new THREE.Matrix3().getNormalMatrix(M);
  const v = new THREE.Vector3();
  return ([[cp.body, false], [cp.marks, true]] as const).map(([g, label]) => {
    const P = g.getAttribute("position");
    const N = g.getAttribute("normal");
    const U = g.getAttribute("uv");
    const C = g.getAttribute("color");
    const n = P.count;
    const a: CrateArrays = { pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3), label };
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      a.pos.set([v.x, v.y, v.z], i * 3);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      a.nor.set([v.x, v.y, v.z], i * 3);
      a.uv[i * 2] = U.getX(i);
      a.uv[i * 2 + 1] = U.getY(i);
      a.col.set(C ? [C.getX(i), C.getY(i), C.getZ(i)] : [1, 1, 1], i * 3);
    }
    return a;
  });
}

/** A crate's place in a model: x, y (its foot), z, turn, scale, open. */
export type CratePlace = [number, number, number, number, number, boolean];
/** The matrix of a crate's place. */
export function crateMatrix([x, y, z, yaw, s]: CratePlace): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s));
}
