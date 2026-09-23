import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import { brickBandTexture, facadeAtlas, glassTexture, roofAtlas, slateTexture, stoneTexture } from "./cityTextures";
import { makeTextures } from "./textures";

// Antwerp, 1873, traced from the Vuillaume map (CC0) and built in Blender
// (tools/city, tools/blender). This module lays the ground and the quays, loads
// the houses, and answers "can I walk here?" from the walk map.

export interface Door {
  x: number;
  z: number;
  out: [number, number];
  width: number;
}

interface CityJson {
  area: number[][];
  land: number[][];
  quays: number[][];
  landmarks: Record<string, { fp: number[][] }>;
  doors: Record<string, Door>;
  bridges: Record<string, number[]>;
  walk: { x0: number; z0: number; res: number; w: number; h: number; file: string };
}

const data = CITY as unknown as CityJson;

export const DOORS = data.doors;

const EDGE = (CITY as unknown as { rijnkaaiEdge: Array<[number, number]> }).rijnkaaiEdge;
/** The river edge of the Rijnkaai: first dry z at this x (x from -70 to 90). */
export function edgeZ(x: number): number {
  const i = Math.max(0, Math.min(EDGE.length - 2, Math.floor(x - EDGE[0][0])));
  const [x0, z0] = EDGE[i];
  const [, z1] = EDGE[i + 1];
  return z0 + (z1 - z0) * Math.max(0, Math.min(1, x - x0));
}

/** A point just outside a door, `d` metres out, `side` metres along the wall. */
export function doorSpot(name: string, d = 1.5, side = 0): { x: number; z: number; face: [number, number] } {
  const door = DOORS[name];
  const [ox, oz] = door.out;
  return { x: door.x + ox * d - oz * side, z: door.z + oz * d + ox * side, face: [-ox, -oz] };
}

export const WALL = 1;
export const WATER = 2;
export const OUTSIDE = 4;

export interface CityWorld {
  group: THREE.Group;
  /** Resolves when the houses and the walk map are loaded. */
  ready: Promise<void>;
  /** Flags at a point: WALL, WATER, OUTSIDE (0 = open ground). Undefined until the walk map is in. */
  flags(x: number, z: number): number | undefined;
  /** Hide house chunks beyond the fog. */
  update(camera: THREE.Camera, far: number): void;
  landmarks: CityJson["landmarks"];
}

const LANDMARK_HEIGHT: Record<string, number> = {
  cathedral: 28,
  stadhuis: 20,
  vleeshuis: 22,
  steen: 12,
  carolus: 24,
  stpaul: 20,
  stjacob: 24,
  hanzehuis: 16,
};

export function buildCity(scene: THREE.Scene, mats: { cobble: THREE.Material; quayWall: THREE.Material; wallDecal: THREE.Material }, waterY: number): CityWorld {
  const group = new THREE.Group();
  group.name = "city";
  scene.add(group);

  // --- ground: the land of the traced map, cobbles everywhere
  {
    const pos: number[] = [];
    const uv: number[] = [];
    for (const t of data.land) {
      for (let i = 0; i < 3; i++) {
        const x = t[i * 2];
        const z = t[i * 2 + 1];
        pos.push(x, 0, z);
        uv.push(x / 2, z / 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    // wind every triangle upward
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i), az = p.getZ(i);
      const bx = p.getX(i + 1), bz = p.getZ(i + 1);
      const cx = p.getX(i + 2), cz = p.getZ(i + 2);
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (cross > 0) {
        // swap b and c so the normal points up (+y)
        p.setXYZ(i + 1, cx, 0, cz);
        p.setXYZ(i + 2, bx, 0, bz);
        const u = g.getAttribute("uv") as THREE.BufferAttribute;
        const ub = [u.getX(i + 1), u.getY(i + 1)];
        u.setXY(i + 1, u.getX(i + 2), u.getY(i + 2));
        u.setXY(i + 2, ub[0], ub[1]);
      }
    }
    g.computeVertexNormals();
    // the land is a few large triangles: no vertex snap and no affine warp on it,
    // or the cobbles swirl (the texture uses world coordinates, so it stays straight)
    const cob = mats.cobble as THREE.MeshPhongMaterial;
    const groundMat = psx(new THREE.MeshPhongMaterial({ map: cob.map, color: cob.color, specular: cob.specular, shininess: cob.shininess }), { noSnap: true, affine: 0 });
    const ground = new THREE.Mesh(g, groundMat);
    ground.name = "ground";
    group.add(ground);
  }

  // --- quay walls and edge stones along every water edge
  {
    const wall: number[] = [];
    const wallUv: number[] = [];
    const cope: number[] = [];
    const copeUv: number[] = [];
    const quad = (arr: number[], uvs: number[], a: number[], b: number[], c: number[], d: number[], L: number, H: number) => {
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
      uvs.push(0, 0, L, 0, L, H, 0, 0, L, H, 0, H);
    };
    for (const [ax, az, bx, bz] of data.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const y0 = waterY - 1.5;
      quad(wall, wallUv, [ax, y0, az], [bx, y0, bz], [bx, 0, bz], [ax, 0, az], L / 4, (0 - y0) / 4);
      // edge stones: a flat band on top, 0.5 m wide, slightly raised
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      const w = 0.25;
      quad(cope, copeUv, [ax - nx * w, 0.06, az - nz * w], [bx - nx * w, 0.06, bz - nz * w], [bx + nx * w, 0.06, bz + nz * w], [ax + nx * w, 0.06, az + nz * w], L, 0.5);
    }
    const mk = (pos: number[], uv: number[], mat: THREE.Material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      group.add(m);
      return m;
    };
    const wallMat = (mats.quayWall as THREE.MeshLambertMaterial).clone();
    wallMat.side = THREE.DoubleSide;
    const copeMat = (mats.wallDecal as THREE.MeshLambertMaterial).clone();
    copeMat.side = THREE.DoubleSide;
    mk(wall, wallUv, psx(wallMat, { noSnap: true, affine: 0 }));
    mk(cope, copeUv, psx(copeMat, { noSnap: true, affine: 0 }));
  }

  // --- landmarks: stand-in blocks until their Blender models are in
  const stone = psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), color: 0xb0a898 }));
  for (const [name, l] of Object.entries(data.landmarks)) {
    const shape = new THREE.Shape(l.fp.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: LANDMARK_HEIGHT[name] ?? 20, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3, uv.getY(i) / 3);
    const m = new THREE.Mesh(g, stone);
    m.name = `standin_${name}`;
    group.add(m);
  }

  // --- landmarks from Blender (tools/blender/build_landmarks.py) replace the stand-ins
  const lmMats: Record<string, THREE.Material> = {
    stone: psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), color: 0xd8d0c0, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    slate: psx(new THREE.MeshLambertMaterial({ map: slateTexture(), vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    glass: psx(new THREE.MeshLambertMaterial({ map: glassTexture(), vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    brickband: psx(new THREE.MeshLambertMaterial({ map: brickBandTexture(), vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    lead: psx(new THREE.MeshLambertMaterial({ color: 0x4a4e52, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
  };
  const lmLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath("/draco/"));
  const landmarks = lmLoader.loadAsync("/models/landmarks.glb").then((gltf) => {
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      m.material = lmMats[name] ?? lmMats.stone;
      meshes.push(m);
    });
    for (const m of meshes) {
      m.updateWorldMatrix(true, false);
      m.applyMatrix4(m.parent!.matrixWorld);
      const owner = m.name.startsWith("landmark_") ? m.name : (m.parent?.name ?? "");
      const standIn = group.getObjectByName(owner.replace(/_\d+$/, "").replace("landmark_", "standin_"));
      if (standIn) standIn.visible = false;
      group.add(m);
    }
  });

  // --- houses from Blender
  // both sides drawn: a wall seen from behind (a party wall, a gable back) is never a hole
  const DS = THREE.DoubleSide;
  const facade = psx(new THREE.MeshLambertMaterial({ map: facadeAtlas(), vertexColors: true, side: DS }), { atlas: 4, affine: 0 });
  const roof = psx(new THREE.MeshLambertMaterial({ map: roofAtlas(), vertexColors: true, side: DS }), { atlas: 2, affine: 0 });
  const wood = psx(new THREE.MeshLambertMaterial({ map: makeTextures().planks, vertexColors: true, side: DS }), { affine: 0.2 });
  const leaves = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: DS }), { affine: 0 });
  const trim = psx(new THREE.MeshLambertMaterial({ map: stoneTexture(), vertexColors: true, side: DS }), { affine: 0.2 });
  const chunks: THREE.Mesh[] = [];
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const houses = loader.loadAsync("/models/city.glb").then((gltf) => {
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      // glTF flips v; turn it back so storeys count up the wall
      const uv = g.getAttribute("uv") as THREE.BufferAttribute | undefined;
      if (uv) for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      const cell = g.getAttribute("uv1") as THREE.BufferAttribute | undefined;
      if (cell) {
        for (let i = 0; i < cell.count; i++) cell.setXY(i, Math.round(cell.getX(i)), Math.round(1 - cell.getY(i)));
        g.setAttribute("cell", cell);
        g.deleteAttribute("uv1");
      }
      const name = (m.material as THREE.Material).name;
      m.material = name === "facade" ? facade : name === "roof" ? roof : name === "wood" ? wood : name === "leaves" ? leaves : trim;
      g.computeBoundingSphere();
      chunks.push(m);
    });
    // the whole scene graph is Y-up already; move the meshes under our group
    for (const m of chunks) {
      m.updateWorldMatrix(true, false);
      m.applyMatrix4(m.parent!.matrixWorld);
      group.add(m);
    }
    draco.dispose();
  });

  // --- the walk map: R wall, G water, B outside the traced map
  const W = data.walk;
  let walk: Uint8Array | null = null;
  const walkReady = new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = W.w;
      c.height = W.h;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, W.w, W.h).data;
      walk = new Uint8Array(W.w * W.h);
      for (let i = 0; i < walk.length; i++) {
        walk[i] = (px[i * 4] > 127 ? WALL : 0) | (px[i * 4 + 1] > 127 ? WATER : 0) | (px[i * 4 + 2] > 127 ? OUTSIDE : 0);
      }
      resolve();
    };
    img.onerror = () => reject(new Error("walk map missing"));
    img.src = W.file;
  });

  function flags(x: number, z: number): number | undefined {
    if (!walk) return undefined;
    const c = Math.floor((z - W.z0) / W.res);
    const r = Math.floor((x - W.x0) / W.res);
    if (c < 0 || r < 0 || c >= W.w || r >= W.h) return OUTSIDE | WATER;
    return walk[r * W.w + c];
  }

  const tmp = new THREE.Vector3();
  function update(camera: THREE.Camera, far: number): void {
    const cp = camera.position;
    for (const m of chunks) {
      const s = m.geometry.boundingSphere!;
      tmp.copy(s.center);
      m.visible = tmp.distanceTo(cp) - s.radius < far + 10;
    }
  }

  return { group, ready: Promise.all([houses, walkReady, landmarks]).then(() => {}), flags, update, landmarks: data.landmarks };
}
