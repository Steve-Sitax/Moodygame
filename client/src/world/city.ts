import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { psx, psxUniforms } from "../retro/psx";
import { createMirror } from "./mirror";
import { cobblePaving, edgeStoneTexture, flagPaving } from "./paving";
import { brickBandTexture, earthTexture, facadeAtlas, glassTexture, leafTexture, roofAtlas, slateTexture, stoneTexture } from "./cityTextures";
import { makeTextures } from "./textures";
import { slimeCuts, slimeShade } from "./quaysteps";

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

  // the street mirrored in the puddles (world/mirror.ts), drawn only while there are puddles
  const groundMirror = createMirror(0, { width: 480, height: 270, enabled: () => psxUniforms.uPuddle.value > 0.01 });
  psxUniforms.uMirror.value = groundMirror.texture;
  psxUniforms.uMirrorMat.value = groundMirror.matrix;

  // --- ground: three kinds of paving (tools/city/plan.py ground_zones): earth on the
  // working quays, flagstones on the squares, cobbles in the streets. The land is a
  // few large triangles: no vertex snap and no affine warp on it, or it swirls (the
  // texture uses world coordinates, so it stays straight).
  {
    const cob = mats.cobble as THREE.MeshPhongMaterial;
    const zones = (data as unknown as { ground?: Record<string, number[][]> }).ground ?? { cobble: data.land };
    const BUMP = 4;
    const earthTex = earthTexture();
    // cobbles and flagstones with height maps (world/paving.ts): they stand up (psx relief)
    const cobPave = cobblePaving();
    const flagPave = flagPaving();
    const zoneMat: Record<string, [THREE.Material, number]> = {
      // bump maps from the texture itself: light stone stands up, dark joints sink, so the
      // sun and the gas lamps pick out every sett (Steve: "bump mapping?")
      cobble: [psx(new THREE.MeshPhongMaterial({ map: cobPave.map, color: 0xffffff, specular: cob.specular, shininess: cob.shininess }), { noSnap: true, affine: 0, wet: true, puddles: 1, vary: 1, relief: { height: cobPave.height, depth: 0.05, tile: 2, bump: 2.4 } }), 2],
      earth: [psx(new THREE.MeshLambertMaterial({ map: earthTex, bumpMap: earthTex, bumpScale: BUMP * 0.6 }), { noSnap: true, affine: 0, wet: true, puddles: 1.3, vary: 1 }), 4],
      flags: [psx(new THREE.MeshPhongMaterial({ map: flagPave.map, specular: 0x1a1a1a, shininess: 12 }), { noSnap: true, affine: 0, wet: true, puddles: 0.75, vary: 0.8, relief: { height: flagPave.height, depth: 0.025, tile: 4, bump: 1.6 } }), 4],
    };
    for (const [zone, tris] of Object.entries(zones)) {
      if (zone === "edges") continue;
      const [mat, tile] = zoneMat[zone] ?? zoneMat.cobble;
      const pos: number[] = [];
      const uv: number[] = [];
      for (const t of tris) {
        // wind every triangle upward (normal +y)
        let [ax, az, bx, bz, cx, cz] = t;
        if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) [bx, bz, cx, cz] = [cx, cz, bx, bz];
        for (const [x, z] of [[ax, az], [bx, bz], [cx, cz]]) {
          pos.push(x, 0, z);
          uv.push(x / tile, z / tile);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const ground = new THREE.Mesh(g, mat);
      ground.name = `ground_${zone}`;
      groundMirror.attach(ground);
      group.add(ground);
    }
  }

  // --- edge stones along every seam where two pavings meet (tools/city/plan.py ground edges):
  // a row of long granite kerbs covers the cut, as in a real street
  {
    const edges = ((data as unknown as { ground?: { edges?: Array<Array<[number, number]>> } }).ground?.edges ?? []) as Array<Array<[number, number]>>;
    const W = 0.34;
    const pos: number[] = [];
    const uv: number[] = [];
    for (const line of edges) {
      let dist = 0;
      const n = line.length;
      const side = (i: number): [number, number] => {
        const a = line[Math.max(0, i - 1)];
        const b = line[Math.min(n - 1, i + 1)];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
      };
      for (let i = 0; i < n - 1; i++) {
        const [ax, az] = line[i];
        const [bx, bz] = line[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const [nax, naz] = side(i);
        const [nbx, nbz] = side(i + 1);
        const h = W / 2;
        const u0 = dist / 2;
        const u1 = (dist + L) / 2;
        dist += L;
        const A0 = [ax - nax * h, az - naz * h];
        const A1 = [ax + nax * h, az + naz * h];
        const B0 = [bx - nbx * h, bz - nbz * h];
        const B1 = [bx + nbx * h, bz + nbz * h];
        // two triangles, both wound to face up
        for (const [p, u, v] of [[A0, u0, 0], [B1, u1, 1], [B0, u1, 0], [A0, u0, 0], [A1, u0, 1], [B1, u1, 1]] as const) {
          pos.push(p[0], 0, p[1]);
          uv.push(u, v);
        }
      }
    }
    if (pos.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const mat = psx(
        new THREE.MeshLambertMaterial({ map: edgeStoneTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }),
        { noSnap: true, affine: 0, wet: true },
      );
      const seam = new THREE.Mesh(g, mat);
      seam.name = "ground_seams";
      group.add(seam);
    }
  }

  // --- quay walls and edge stones along every water edge
  {
    const wall: number[] = [];
    const wallUv: number[] = [];
    const wallCol: number[] = [];
    const cope: number[] = [];
    const copeUv: number[] = [];
    const quad = (arr: number[], uvs: number[], a: number[], b: number[], c: number[], d: number[], L: number, H: number) => {
      arr.push(...a, ...b, ...c, ...a, ...c, ...d);
      uvs.push(0, 0, L, 0, L, H, 0, 0, L, H, 0, H);
    };
    // the wall in bands, coloured by height: green slime at the waterline, a dark wet band above it
    const shade = slimeShade(waterY);
    const y0 = waterY - 1.5;
    const bands = [y0, ...slimeCuts(waterY).filter((y) => y > y0 && y < 0), 0];
    for (const [ax, az, bx, bz] of data.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      for (let i = 0; i < bands.length - 1; i++) {
        const [ya, yb] = [bands[i], bands[i + 1]];
        const [va, vb] = [(ya - y0) / 4, (yb - y0) / 4];
        wall.push(ax, ya, az, bx, ya, bz, bx, yb, bz, ax, ya, az, bx, yb, bz, ax, yb, az);
        wallUv.push(0, va, L / 4, va, L / 4, vb, 0, va, L / 4, vb, 0, vb);
        for (const y of [ya, ya, yb, ya, yb, yb]) wallCol.push(...shade(y));
      }
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
    wallMat.vertexColors = true;
    const copeMat = (mats.wallDecal as THREE.MeshLambertMaterial).clone();
    copeMat.side = THREE.DoubleSide;
    mk(wall, wallUv, psx(wallMat, { noSnap: true, affine: 0 })).geometry.setAttribute("color", new THREE.Float32BufferAttribute(wallCol, 3));
    mk(cope, copeUv, psx(copeMat, { noSnap: true, affine: 0, wet: true }));
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
    // the gilt cross, ball and clock dials of the cathedral
    gilt: psx(new THREE.MeshLambertMaterial({ color: 0xc8a040, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
  };
  const lmLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath("/draco/"));
  const landmarks = lmLoader.loadAsync("/models/landmarks.glb").then((gltf) => {
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.material as THREE.Material).name;
      // "<building>_atlas": windows, clock, statues painted into a texture in the glb
      if (name.endsWith("_atlas") && !lmMats[name]) {
        const map = (m.material as THREE.MeshStandardMaterial).map;
        if (map) {
          map.magFilter = THREE.NearestFilter;
          map.minFilter = THREE.NearestFilter;
          map.generateMipmaps = false;
          lmMats[name] = psx(new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 });
        }
      }
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
  const leaves = psx(new THREE.MeshLambertMaterial({ map: leafTexture(), vertexColors: true, side: DS }), { affine: 0 });
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
