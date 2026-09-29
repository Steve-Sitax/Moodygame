import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { earthPaving, grassPaving, withPictures, type Paving } from "./paving";
import { crisp, fallingLeaves, treeMaterial } from "./trees3d";
import { createParkWildlife } from "./parkWildlife";
import { attachToMirror } from "./mirror";

// The Stadspark planted (the park pass, 2026-09-26; Steve: "the part with the ponds have no trees, bushes..
// make it look way better, but keep the grungy feel"). Eduard Keilig's English landscape park of 1867-69 on
// the old Spanish ramparts, in its fifth autumn: young trees on their stakes in loose groups, a few old trees
// kept from the ramparts, a clipped privet hedge and a border of evergreens and shrubs inside the railing,
// reeds, bulrushes and lilies at the pond, two flower beds dug over for winter, ducks and a pair of swans.
// The grungy part: the mist, the fallen leaves everywhere, the trodden mud along the gravel and before the
// benches, the soot on the white bridge.
//
// Where everything stands: tools/city/park.py --plants -> /models/park_plants.json (also the solids for the
// walk map, plan.py). The models: tools/blender/build_park_plants.py -> /models/park_plants.glb, one node a
// kind, placed and merged into one mesh a material (two draw calls for all of them) with the town trees' wind
// (world/trees3d.ts).
// The ground inside the railing is the park's own (plan.py leaves a hole there): lawn, gravel, the muddy
// edges and the beds, from pictures made with Codex (assets/ATTRIBUTION.md) with height maps from the same
// pictures (tools/textures/park_maps.py). The pond, the bank, the bridge, the rocks, benches and lanterns
// are churches.glb (tools/blender/build_churches.py).

type Tri = number[];
interface PlantsData {
  trees: Array<[number, number, string, number, number]>;
  plants: Array<[number, number, string, number, number, number]>;
  hedge: Array<[number, number, number, number, number, number]>;
  birds: Array<[number, number, number, string]>;
  drift?: Array<[number, number]>;
  ground: Record<"lawn" | "gravel" | "mud" | "bed" | "under", Tri[]>;
}

/** How high each tree's leaves start to fall (m over its foot, at scale 1). */
const LEAF_TOP: Record<string, number> = { old_oak: 14, old_elm: 9, old_plane: 9, old_bare: 8, weeping: 3.5, conifer: 0 };
const FALL_PER_TREE = 4;
/** Past this distance from the park (m, beyond the fog's end) nothing of it is drawn. */
const REACH = 40;

export interface ParkNature {
  update(camera: THREE.Camera, far: number, dt: number, hour: number): void;
}

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The park's ground: one mesh per kind, y a hair over 0 (the town's zones have a hole here), uv = world / tile. */
function groundMesh(tris: Tri[], mat: THREE.Material, tile: number, y: number, name: string): THREE.Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const t of tris) {
    let [ax, az, bx, bz, cx, cz] = t;
    if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) [bx, bz, cx, cz] = [cx, cz, bx, bz];
    for (const [x, z] of [
      [ax, az],
      [bx, bz],
      [cx, cz],
    ]) {
      pos.push(x, y, z);
      uv.push(x / tile, z / tile);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat);
  m.name = name;
  return m;
}

/** A painted stand-in until the picture loads, then the picture and its height map (never one without the other). */
function pave(base: Paving, pic: string): Paving {
  return withPictures(base, { map: `/textures/${pic}.jpg`, height: `/textures/${pic}_h.png` });
}

/** Flat fallen leaves: small diamonds lying on the ground, one draw call. */
function fallenLeaves(spots: Array<[number, number]>, y: number): THREE.InstancedMesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -0.06, 0.045, 0, 0, 0, 0, 0.06, -0.045, 0, 0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const mat = psx(new THREE.MeshLambertMaterial({ polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { affine: 0 });
  mat.name = "park_fallen_leaves";
  const im = new THREE.InstancedMesh(g, mat, spots.length);
  im.name = "park_fallen_leaves";
  const cols = [0xb88a2c, 0x9a4c1a, 0x6e4620, 0xc4a240, 0x7c5e26, 0x5a3c1c, 0xa06a24];
  const r = rand(1873);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  spots.forEach(([x, z], i) => {
    e.set((r() - 0.5) * 0.4, r() * Math.PI * 2, (r() - 0.5) * 0.4);
    q.setFromEuler(e);
    const k = 0.7 + r() * 0.8;
    s.set(k, 1, k);
    p.set(x, y + r() * 0.012, z);
    m4.compose(p, q, s);
    im.setMatrixAt(i, m4);
    const c = new THREE.Color(cols[Math.floor(r() * cols.length)]).multiplyScalar(0.8 + r() * 0.35);
    im.setColorAt(i, c);
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  return im;
}

export function loadParkNature(scene: THREE.Scene): ParkNature {
  const group = new THREE.Group();
  group.name = "park_nature";
  scene.add(group);
  const centre = new THREE.Vector3(-300, 0, 312);
  let radius = 70;
  let wildlife: ReturnType<typeof createParkWildlife> | null = null;

  const draco = new DRACOLoader().setDecoderPath("/draco/");
  Promise.all([
    fetch("/models/park_plants.json").then((r) => (r.ok ? r.json() : null)),
    new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/park_plants.glb"),
  ])
    .then(([data, gltf]) => {
      const D = data as PlantsData | null;
      if (!D) return;
      // ---- the ground
      const lawnPave = pave(grassPaving(), "park_lawn");
      const gravelPave = pave(earthPaving(), "park_gravel");
      const mudPave = pave(earthPaving(), "park_mud");
      const lawn = psx(new THREE.MeshLambertMaterial({ map: lawnPave.map }), {
        noSnap: true,
        affine: 0,
        wet: true,
        puddles: 0.2,
        detile: true,
        vary: 0.8,
        relief: { height: lawnPave.height, depth: 0.03, tile: 2.5, bump: 2.2 },
      });
      const gravel = psx(new THREE.MeshLambertMaterial({ map: gravelPave.map }), {
        noSnap: true,
        affine: 0,
        wet: true,
        puddles: 1.2,
        detile: true,
        vary: 0.8,
        relief: { height: gravelPave.height, depth: 0.03, tile: 2, bump: 2.8 },
      });
      const mud = psx(new THREE.MeshLambertMaterial({ map: mudPave.map }), {
        noSnap: true,
        affine: 0,
        wet: true,
        puddles: 1.6,
        detile: true,
        vary: 1,
        relief: { height: mudPave.height, depth: 0.035, tile: 2, bump: 3 },
      });
      const bed = psx(new THREE.MeshLambertMaterial({ map: mudPave.map, color: 0x9a8676 }), {
        noSnap: true,
        affine: 0,
        wet: true,
        puddles: 0.3,
        relief: { height: mudPave.height, depth: 0.04, tile: 1.6, bump: 3.2 },
      });
      // (under it all, 2 cm lower, plain dark earth: the cracks where two kinds of ground meet show earth, not the sky)
      const under = psx(new THREE.MeshLambertMaterial({ color: 0x2e261c }), { noSnap: true, affine: 0 });
      for (const [kind, mat, tile, y] of [
        ["lawn", lawn, 2.5, 0],
        ["gravel", gravel, 2, 0],
        ["mud", mud, 2, 0],
        ["bed", bed, 1.6, 0],
        ["under", under, 4, -0.02],
      ] as Array<["lawn" | "gravel" | "mud" | "bed" | "under", THREE.Material, number, number]>) {
        mat.name = `park_${kind}`;
        const tris = D.ground[kind] ?? [];
        if (!tris.length) continue;
        const mesh = groundMesh(tris, mat, tile, y, `park_ground_${kind}`);
        group.add(mesh);
        // (its puddles show the street mirror: never drawn into it, issue #23)
        if (kind !== "under") attachToMirror("puddles", mesh);
      }
      // ---- the plants: every kind instanced, bark and leaves
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
      const bark = treeMaterial(new THREE.MeshLambertMaterial({ map: barkMap, vertexColors: true }), false, true);
      bark.name = "park_bark";
      const leaves = treeMaterial(new THREE.MeshLambertMaterial({ map: leafMap, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }), true, true);
      leaves.name = "park_leaves";
      const geo = new Map<string, { bark?: THREE.BufferGeometry; leaves?: THREE.BufferGeometry }>();
      for (const node of gltf.scene.children) {
        node.updateMatrixWorld(true);
        const entry: { bark?: THREE.BufferGeometry; leaves?: THREE.BufferGeometry } = {};
        node.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          if ((mesh.material as THREE.Material).name === "tree_leaves") entry.leaves = g;
          else entry.bark = g;
        });
        geo.set(node.name, entry);
      }
      const byKind = new Map<string, THREE.Matrix4[]>();
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const put = (kind: string, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number) => {
        q.setFromAxisAngle(up, yaw);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
        const l = byKind.get(kind) ?? [];
        l.push(m4.clone());
        byKind.set(kind, l);
      };
      for (const [x, z, kind, s, yaw] of D.trees) put(kind, x, 0, z, yaw, s, s, s);
      for (const [x, z, kind, s, yaw, y] of D.plants) put(kind, x, y, z, yaw, s, s, s);
      // the hedge: a metre's model stretched to each piece (local x along it; the pieces meet end to end, no overlap:
      // two sides in one plane would flicker)
      for (const [x0, z0, x1, z1, h, w] of D.hedge) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 0.05) continue;
        put("hedge", (x0 + x1) / 2, 0, (z0 + z1) / 2, Math.atan2(-(z1 - z0), x1 - x0), len, h, w);
      }
      // every plant placed and merged into one mesh a material (two draw calls for all the park's plants; the wind
      // finds each plant's foot in aTreeAt)
      for (const [part, mat] of [
        ["bark", bark],
        ["leaves", leaves],
      ] as Array<["bark" | "leaves", THREE.Material]>) {
        const pieces: THREE.BufferGeometry[] = [];
        const foot = new THREE.Vector3();
        for (const [kind, mats] of byKind) {
          const src = geo.get(kind)?.[part];
          if (!src) continue;
          const flat = src.index ? src.toNonIndexed() : src;
          for (const m of mats) {
            const g = flat.clone().applyMatrix4(m);
            foot.setFromMatrixPosition(m);
            const n = g.getAttribute("position").count;
            const at = new Float32Array(n * 3);
            for (let i = 0; i < n; i++) at.set([foot.x, foot.y, foot.z], i * 3);
            g.setAttribute("aTreeAt", new THREE.BufferAttribute(at, 3));
            for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color", "aTreeAt"].includes(k)) g.deleteAttribute(k);
            pieces.push(g);
          }
        }
        if (!pieces.length) continue;
        const merged = mergeGeometries(pieces, false);
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.name = `park_plants_${part}`;
        group.add(mesh);
      }
      // ---- leaves falling from the trees, and lying on the ground: thick under the crowns, drifted against the
      // hedge and the kerb of the paths, a few everywhere
      const fall = fallingLeaves(
        D.trees
          .filter(([, , kind]) => (LEAF_TOP[kind] ?? 3.5) > 0)
          .map(([x, z, kind, s]) => ({ x, z, y0: 0, top: (LEAF_TOP[kind] ?? 3.2) * s, spread: kind.startsWith("old") ? 1.6 : 0.6 })),
        FALL_PER_TREE,
      );
      if (fall) group.add(fall);
      const r = rand(1869);
      const lying: Array<[number, number]> = [];
      const onGround = (x: number, z: number) => inTris(D.ground.lawn, x, z) || inTris(D.ground.gravel, x, z) || inTris(D.ground.mud, x, z);
      for (const [x, z, kind, s] of D.trees) {
        const crown = (kind.startsWith("old") ? 5 : kind === "conifer" ? 0 : 1.6) * s;
        const n = Math.round(crown * crown * (kind.startsWith("old") ? 5 : 9));
        for (let i = 0; i < n; i++) {
          const a = r() * Math.PI * 2;
          const d = crown * Math.sqrt(r()) * 1.15;
          const px = x + Math.cos(a) * d;
          const pz = z + Math.sin(a) * d;
          if (onGround(px, pz)) lying.push([px, pz]);
        }
      }
      for (const [x0, z0, x1, z1, h] of D.hedge) {
        if (h < 0.5) continue;
        const len = Math.hypot(x1 - x0, z1 - z0);
        const nx = -(z1 - z0) / (len || 1);
        const nz = (x1 - x0) / (len || 1);
        for (let i = 0; i < 6; i++) {
          const f = r();
          const side = r() < 0.5 ? -1 : 1;
          const off = 0.45 + r() * 0.35;
          const px = x0 + (x1 - x0) * f + nx * side * off;
          const pz = z0 + (z1 - z0) * f + nz * side * off;
          if (onGround(px, pz)) lying.push([px, pz]);
        }
      }
      for (const t of D.ground.gravel) {
        // along the gravel: a few blown onto it
        if (r() < 0.6) lying.push([(t[0] + t[2] + t[4]) / 3 + (r() - 0.5), (t[1] + t[3] + t[5]) / 3 + (r() - 0.5)]);
      }
      for (let i = 0; i < 900; i++) {
        const t = D.ground.lawn[Math.floor(r() * D.ground.lawn.length)];
        if (!t) break;
        let u = r();
        let v = r();
        if (u + v > 1) [u, v] = [1 - u, 1 - v];
        lying.push([t[0] + (t[2] - t[0]) * u + (t[4] - t[0]) * v, t[1] + (t[3] - t[1]) * u + (t[5] - t[1]) * v]);
      }
      // and out along the railing's kerb in the street, blown there in drifts
      for (const d of D.drift ?? []) lying.push(d);
      group.add(fallenLeaves(lying, 0.012));
      wildlife = createParkWildlife(scene, D);
      // how far the park reaches from its middle (for the distance cut)
      const box = new THREE.Box3().setFromObject(group);
      box.getCenter(centre);
      radius = box.getSize(new THREE.Vector3()).length() / 2;
      draco.dispose();
    })
    .catch((e) => console.warn("the park's plants did not load", e));

  return {
    update(camera, far, dt, hour) {
      const near = camera.position.distanceTo(centre) - radius < far + REACH;
      group.visible = near;
      wildlife?.(dt, hour, camera);
    },
  };
}

/** Is (x, z) inside one of the triangles? (the park's own ground: only for placing things, once) */
function inTris(tris: Tri[], x: number, z: number): boolean {
  for (const t of tris) {
    const [ax, az, bx, bz, cx, cz] = t;
    const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
    const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
    const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) return true;
  }
  return false;
}
