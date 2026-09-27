import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";

// The goods wagons of the quay railway, built in Blender (tools/blender/build_wagons.py ->
// /models/wagons.glb): the three wagon kinds, the wheel set, the three-link coupling and the goods
// units, each in the frame railway.ts gives its code-built part (a wagon's origin on the ground at
// its middle, +z its front; the wheel set on its axle; the coupling 1 m along z; a unit standing on
// its origin). The wagon parts share one atlas material (4 x 4 cells of 64 px, the props' psx
// settings: no new shader kind); the goods units are drawn with the props' goods atlas material.
// If the file does not load, the railway keeps its code-built parts.

export type WagonPart = "open" | "flat" | "van";
export type WagonGoods = "sacks" | "casks" | "bales" | "crates";

export interface WagonModels {
  wagon: Record<WagonPart, THREE.BufferGeometry>;
  wheelset: THREE.BufferGeometry;
  coupling: THREE.BufferGeometry;
  goods: Record<WagonGoods, THREE.BufferGeometry>;
  /** The wagons' atlas material (psx, atlas 4). */
  material: THREE.Material;
}

let loading: Promise<WagonModels | null> | null = null;

/** Load wagons.glb once (never rejects: null when it fails, and the railway draws its own parts). */
export function loadWagons(): Promise<WagonModels | null> {
  if (!loading)
    loading = load().catch((e) => {
      console.warn("wagons.glb did not load; the train keeps its code-built wagons", e);
      return null;
    });
  return loading;
}

async function load(): Promise<WagonModels> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/wagons.glb");
  draco.dispose();
  let material: THREE.Material | null = null;
  const geo = new Map<string, THREE.BufferGeometry>();
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const src = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    if (src.name === "wagons" && !material) {
      const map = src.map;
      if (map) {
        map.magFilter = THREE.NearestFilter;
        map.minFilter = THREE.NearestFilter;
        map.generateMipmaps = false;
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.name = "wagons";
        map.needsUpdate = true;
      }
      material = psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { affine: 0.6, atlas: 4 });
      material.name = "wagons";
    }
    const g = m.geometry;
    // the second uv set is the atlas cell (column, row); glTF turned v over, so turn it back (as props3d.ts)
    const cell = g.getAttribute("uv1") as THREE.BufferAttribute | undefined;
    if (cell) {
      const c = new Float32Array(cell.count * 2);
      for (let i = 0; i < cell.count; i++) {
        c[i * 2] = Math.round(cell.getX(i));
        c[i * 2 + 1] = Math.round(1 - cell.getY(i));
      }
      g.setAttribute("cell", new THREE.BufferAttribute(c, 2));
      g.deleteAttribute("uv1");
    }
    // the node's own transform is the identity (the parts are built in place): keep the geometry as it is
    g.applyMatrix4(m.matrixWorld);
    g.computeBoundingSphere();
    geo.set(m.name || m.parent?.name || "", g);
    if (m.parent && m.parent !== gltf.scene) geo.set(m.parent.name, g);
  });
  const get = (name: string) => {
    const g = geo.get(name);
    if (!g) throw new Error(`wagons.glb has no ${name}`);
    return g;
  };
  if (!material) throw new Error("wagons.glb has no wagons material");
  return {
    wagon: { open: get("wagon_open"), flat: get("wagon_flat"), van: get("wagon_van") },
    wheelset: get("wheelset"),
    coupling: get("coupling"),
    goods: { sacks: get("goods_sacks"), casks: get("goods_casks"), bales: get("goods_bales"), crates: get("goods_crates") },
    material,
  };
}
