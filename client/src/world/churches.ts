import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";

// The churches of the angled streets (Sint-Carolus Borromeus, Sint-Pauluskerk, Sint-Jacobskerk), the Stadspark's
// pond, bridge, benches, lanterns and railing, and the town pump that stands in every court of the back alleys
// (tools/blender/build_churches.py -> /models/churches.glb and /models/park.json; tools/city/streets.py, alleys.py).
// The walk map (plan.py) already has the churches, the pond and the park's furniture as walls; here the models,
// the pumps' posts as colliders, and the height of the footbridge's deck (rijnkaai.ts baseAt).

interface ParkData {
  bridge: { from: [number, number]; to: [number, number]; width: number; deck: Array<[number, number]> };
}

let park: ParkData | null = null;
const parkReady = fetch("/models/park.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    park = d as ParkData | null;
  })
  .catch(() => {});
void parkReady;

/** The footbridge's deck height at (x, z), or null off it. */
export function parkBridgeHeight(x: number, z: number): number | null {
  if (!park) return null;
  const { from, to, width, deck } = park.bridge;
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L;
  const uz = dz / L;
  const s = (x - from[0]) * ux + (z - from[1]) * uz;
  const o = -(x - from[0]) * uz + (z - from[1]) * ux;
  if (s < 0 || s > L || Math.abs(o) > width / 2) return null;
  for (let i = 0; i < deck.length - 1; i++) {
    const [s0, y0] = deck[i];
    const [s1, y1] = deck[i + 1];
    if (s >= s0 && s <= s1) return y0 + ((y1 - y0) * (s - s0)) / (s1 - s0 || 1);
  }
  return deck[deck.length - 1][1];
}

/** The covered passages into the gangs (plan.py city.json poorts, 1.5 m past each mouth): street things keep out. */
export function poortKeepOut(): Rect[] {
  const P = ((CITY as unknown as { poorts?: number[][][] }).poorts ?? []) as number[][][];
  return P.map((r) => ({ minX: Math.min(...r.map((p) => p[0])), maxX: Math.max(...r.map((p) => p[0])), minZ: Math.min(...r.map((p) => p[1])), maxZ: Math.max(...r.map((p) => p[1])) }));
}

const PUMPS = ((CITY as unknown as { alleys?: { pumps?: Array<[number, number]> } }).alleys?.pumps ?? []) as Array<[number, number]>;

/** The pumps' posts: solid (the crowd and the props keep off them). */
export function pumpColliders(): Rect[] {
  return PUMPS.map(([x, z]) => ({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 }));
}

export interface ChurchesModel {
  group: THREE.Group;
  update(camera: THREE.Camera, far: number): void;
}

export function loadChurches(scene: THREE.Scene): ChurchesModel {
  const group = new THREE.Group();
  group.name = "churches";
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  const parts: THREE.Object3D[] = [];
  const matFor = (src: THREE.MeshStandardMaterial): THREE.Material => {
    const have = mats.get(src.name);
    if (have) return have;
    const map = src.map;
    if (map) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapLinearFilter;
      map.generateMipmaps = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    let m: THREE.Material;
    if (src.name.endsWith("_glow")) m = psx(new THREE.MeshBasicMaterial({ map: map ?? null, color: map ? 0xffffff : 0xffd890 }), { affine: 0 });
    else if (src.name === "park_water")
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : 0x3a4a4c, vertexColors: true, transparent: true, opacity: 0.88 }), { affine: 0, wet: true });
    // (the railing's pickets are single faces: both sides)
    else m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : src.color, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 });
    m.name = src.name;
    mats.set(src.name, m);
    return m;
  };
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/churches.glb")
    .then((gltf) => {
      let pumpSrc: THREE.Object3D | null = null;
      const meshes: THREE.Mesh[] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.getAttribute("color")) {
          const n = m.geometry.getAttribute("position").count;
          m.geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        }
        const src = Array.isArray(m.material) ? m.material : [m.material];
        const out = src.map((s) => matFor(s as THREE.MeshStandardMaterial));
        m.material = Array.isArray(m.material) ? out : out[0];
        meshes.push(m);
      });
      for (const m of meshes) {
        let top: THREE.Object3D = m;
        while (top.parent && top.parent !== gltf.scene) top = top.parent;
        if (top.name === "pump") {
          pumpSrc = top;
          continue;
        }
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        m.geometry.computeBoundingSphere();
        group.add(m);
        parts.push(m);
      }
      // a pump in every court of the alleys (its model faces +z: a quarter turn by its place)
      if (pumpSrc) {
        const src = pumpSrc as THREE.Object3D;
        src.updateWorldMatrix(true, true);
        for (const [x, z] of PUMPS) {
          const p = src.clone(true);
          p.position.set(x, 0, z);
          p.rotation.set(0, (Math.floor(Math.abs(x * 7.31 + z * 3.17)) % 4) * (Math.PI / 2), 0);
          group.add(p);
          parts.push(p);
        }
      }
      // the stand-ins the landmark model still carries for these three (landmarks.glb) are hidden
      scene.traverse((o) => {
        if (/^landmark_(carolus|stpaul|stjacob)/.test(o.name) || /^standin_(carolus|stpaul|stjacob)/.test(o.name)) o.visible = false;
      });
      draco.dispose();
    })
    .catch((e) => console.warn("churches.glb did not load", e));
  const tmp = new THREE.Vector3();
  const sph = new THREE.Sphere();
  return {
    group,
    update(camera, far) {
      const cp = camera.position;
      for (const p of parts) {
        const m = p as THREE.Mesh;
        if (m.isMesh) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          sph.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
        } else sph.set(tmp.copy(p.position), 3);
        p.visible = sph.center.distanceTo(cp) - sph.radius < far + 20;
      }
      // (the landmark stand-ins may load after this model: keep them hidden)
      for (const o of scene.children) if (o.name === "city") for (const c of o.children) if (/^(landmark|standin)_(carolus|stpaul|stjacob)/.test(c.name)) c.visible = false;
    },
  };
}
