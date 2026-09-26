import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { withPicture } from "./quayStone";
import * as PP from "../../../shared/prisonPlan";

// The prison of 1855 (M7 prison and squares, docs/milestones/M7-prison-squares.md): the Blender shell
// (tools/blender/build_prison.py -> /models/prison.glb), built in the prison's own frame (shared/prisonPlan.ts)
// and placed here at the frame's origin, turned by its yaw. The walk map has the whole compound as wall
// (tools/city/places.py); Jef walks in by the gate (world/prisonHall.ts, the halls' in-world code) and out into
// the exercise yard (a walk area of its own there).
//
// The brick and the bluestone take the town's own pictures (the old brick of the house walls, the bluestone
// ashlar; assets/ATTRIBUTION.md), a repeat per 1.9 m and 3.2 m as the model's uv (build_prison.py TILE); the
// painted textures in the glb show until they load. The lanterns' glass (pr_glow) is dull by day and lit from dusk.

const PICTURES: Record<string, string> = {
  pr_brick: "/textures/wall_brick.jpg",
  pr_blue: "/textures/wall_ashlar_blue.jpg",
};
/**
 * The pictures' own height maps (tools/textures/wall_heights.py, the same the house walls use), laid on as bump maps
 * when the picture comes in, never before: the painted stand-in has other bricks (2026-09-26, bump maps on the walls).
 */
const HEIGHTS: Record<string, string> = {
  pr_brick: "/textures/wall_brick_h.png",
  pr_blue: "/textures/wall_ashlar_blue_h.png",
};
/** A weathered prison: the pictures a shade darker and colder than the town's houses. */
const TINT: Record<string, THREE.Color> = {
  pr_brick: new THREE.Color(0.74, 0.68, 0.64),
  pr_blue: new THREE.Color(0.74, 0.76, 0.8),
};

export interface PrisonModel {
  group: THREE.Group;
  /** Each frame: distance culling, the lanterns lit when the lamps are. */
  update(camera: THREE.Camera, far: number, lit: number): void;
}

export function loadPrison(scene: THREE.Scene): PrisonModel {
  const group = new THREE.Group();
  group.name = "prison";
  group.position.set(PP.ORIGIN.x, 0, PP.ORIGIN.z);
  group.rotation.y = PP.YAW;
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  let glow: THREE.MeshBasicMaterial | null = null;
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
    const picture = PICTURES[src.name];
    if (map && picture) {
      map.magFilter = THREE.LinearFilter;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.anisotropy = 4;
      const hUrl = HEIGHTS[src.name];
      if (hUrl)
        map.userData.onPicture = () => {
          const h = new THREE.TextureLoader().load(hUrl, () => {
            const lm = mats.get(src.name) as THREE.MeshLambertMaterial | undefined;
            if (!lm) return;
            lm.bumpMap = h;
            lm.bumpScale = 1.0;
            lm.needsUpdate = true;
          });
          h.flipY = map.flipY;
          h.wrapS = h.wrapT = THREE.RepeatWrapping;
          h.repeat.copy(map.repeat);
          h.offset.copy(map.offset);
          h.magFilter = THREE.LinearFilter;
          h.minFilter = THREE.LinearMipmapLinearFilter;
        };
      withPicture(map, picture);
    }
    let m: THREE.Material;
    if (src.name === "pr_glow") {
      glow = new THREE.MeshBasicMaterial({ map: map ?? null, color: 0x2a2620 });
      m = psx(glow, { affine: 0 });
    } else if (src.name === "pr_atlas") {
      // (the atlas: nearest, no warp: the bars stay straight)
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true }), { fogReach: 2.0, affine: 0, foot: { amount: 0.8 } });
    } else if (src.name === "pr_iron") {
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.0, affine: 0 });
    } else {
      // (the walls: mud and damp at the foot, big soft patches so the picture shows no grid: retro/psx.ts foot, mottle)
      const wall = src.name === "pr_brick" || src.name === "pr_blue";
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: TINT[src.name] ?? 0xffffff, vertexColors: true }), { fogReach: 2.0, affine: 0, ...(wall ? { foot: { amount: 0.8 }, mottle: 0.5 } : {}) });
    }
    m.name = src.name;
    mats.set(src.name, m);
    return m;
  };
  const parts: THREE.Mesh[] = [];
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/prison.glb")
    .then((gltf) => {
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
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        m.geometry.computeBoundingSphere();
        m.name = m.name || "prison_part";
        group.add(m);
        parts.push(m);
      }
      draco.dispose();
    })
    .catch((e) => console.warn("prison.glb did not load", e));
  const sph = new THREE.Sphere();
  const lampOn = new THREE.Color(1.6, 1.2, 0.72);
  const lampOff = new THREE.Color(0.2, 0.21, 0.2);
  return {
    group,
    update(camera, far, lit) {
      const cp = camera.position;
      for (const m of parts) {
        sph.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
        m.visible = sph.center.distanceTo(cp) - sph.radius < far + 20;
      }
      if (glow) glow.color.copy(lampOff).lerp(lampOn, THREE.MathUtils.clamp(lit, 0, 1));
    },
  };
}
