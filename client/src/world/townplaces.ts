import { modelCollider, modelShape } from "./modelCollision";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import TP from "../../../shared/townplaces.json";
import { psx } from "../retro/psx";
import { earthPaving, EDGE_BUMP, edgeStoneTextures, flagPaving, quayPaving, withPictures } from "./paving";
import { rectAround, type Rect } from "./geom";
import { buildTrees3D } from "./trees3d";
import { addProp } from "./propSpots";

// The round square and the greens (M7 prison and squares, docs/milestones/M7-prison-squares.md; the numbers in
// shared/townplaces.json from tools/city/places.py).
//
// The Sint-Jansplein: the plan's round place where streets L and B meet, 14.7 m to the house fronts, laid out as a
// rond-point of the 1860s. Its ground is drawn here (the zones leave a hole for it, plan.py ground_zones): a pavement
// of flags along the fronts, the carriageway of granite setts laid in rings (the quays' picture on rings of uv: the
// setts follow the circle), bluestone kerbs, the island in gravel with a ring of flags round the fountain. On the
// island: the fountain with St John on it, eight plane trees in iron grilles, benches, the newspaper kiosk, the
// urinal (models: tools/blender/build_places.py -> /models/places.glb). Its four gas lamps are the town's own
// (city.json decor.lamps d66..d69, on the lamplighters' rounds).
//
// The greens (lawns and gravel walks are the ground zones' grass and earth): low iron railings, benches, trees,
// round flower beds, and in St James's churchyard a calvary and old grave slabs against the church.

type P2 = [number, number];
interface Green {
  id: string;
  label: string;
  kind: string;
  grass: P2[][];
  paths: P2[][];
  rails: P2[][];
  trees: Array<[number, number, string]>;
  benches: Array<[number, number, number]>;
  beds: Array<{ c: P2; r: number }>;
  extras: Array<{ kind: string; x: number; z: number; yaw: number }>;
  points: P2[];
}
interface Rond {
  label: string;
  c: P2;
  r_front: number;
  r_walk: number;
  r_island: number;
  r_path_in: number;
  r_path_out: number;
  r_basin: number;
  r_disc: number;
  trees: P2[];
  benches: Array<[number, number, number]>;
  kiosk: [number, number, number];
  urinal: [number, number, number];
  fountain: P2;
}
const DATA = TP as unknown as { rond: Rond; greens: Green[] };
export const ROND = DATA.rond;
export const GREENS = DATA.greens;

/** Where paths() checks the new places (every bench's front, the kiosk's window, the urinal, the fountain, the greens' walks). */
export function townPlacePoints(): Array<{ label: string; x: number; z: number; reach: number }> {
  const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
  const front = (x: number, z: number, yaw: number, d: number): P2 => [x + Math.sin(yaw) * d, z + Math.cos(yaw) * d];
  ROND.benches.forEach(([x, z, y], i) => {
    const [fx, fz] = front(x, z, y, 0.75);
    out.push({ label: `${ROND.label}, bench ${i + 1}`, x: fx, z: fz, reach: 0.8 });
  });
  {
    const [x, z, y] = ROND.kiosk;
    const [fx, fz] = front(x, z, y, 1.9);
    out.push({ label: `${ROND.label}, the newspaper kiosk`, x: fx, z: fz, reach: 0.9 });
  }
  {
    const [x, z, y] = ROND.urinal;
    const [fx, fz] = front(x, z, y, -1.0);
    out.push({ label: `${ROND.label}, the urinal`, x: fx, z: fz, reach: 0.9 });
  }
  out.push({ label: `${ROND.label}, the fountain`, x: ROND.fountain[0] + ROND.r_basin + 0.9, z: ROND.fountain[1], reach: 0.9 });
  for (const g of GREENS) {
    g.benches.forEach(([x, z, y], i) => {
      const [fx, fz] = front(x, z, y, 0.75);
      out.push({ label: `${g.label}, bench ${i + 1}`, x: fx, z: fz, reach: 0.8 });
    });
    g.points.forEach(([x, z], i) => out.push({ label: `${g.label}, point ${i + 1}`, x, z, reach: 1.0 }));
  }
  return out;
}

// ------------------------------------------------------------------ the round square's ground

/** An annulus r0..r1 round c, in rings of `ring` metres and segments of about `seg` metres; uv by `uvOf`. */
function annulus(c: P2, r0: number, r1: number, ring: number, seg: number, y: number, uvOf: (x: number, z: number, r: number, a: number, band: number) => P2): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const nb = Math.max(1, Math.round((r1 - r0) / ring));
  for (let b = 0; b < nb; b++) {
    const ra = r0 + ((r1 - r0) * b) / nb;
    const rb = r0 + ((r1 - r0) * (b + 1)) / nb;
    const ns = Math.max(12, Math.round((2 * Math.PI * rb) / seg));
    for (let i = 0; i < ns; i++) {
      const a0 = (2 * Math.PI * i) / ns;
      const a1 = (2 * Math.PI * (i + 1)) / ns;
      const p = (r: number, a: number) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as P2;
      const q = [
        [ra, a0],
        [rb, a0],
        [rb, a1],
        [ra, a0],
        [rb, a1],
        [ra, a1],
      ];
      // wound upward (normal +y): a0 -> a1 counter-clockwise seen from above is clockwise in x-z with y up
      for (const [r, a] of [q[0], q[2], q[1], q[3], q[5], q[4]]) {
        const [x, z] = p(r, a);
        pos.push(x, y, z);
        const [u, v] = uvOf(x, z, r, a, b);
        uv.push(u, v);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function rondGround(group: THREE.Group): void {
  const R = ROND;
  const c = R.c;
  const world = (tile: number) => (x: number, z: number): P2 => [x / tile, z / tile];
  // the pavement: flags along the house fronts (under the fronts to the disc's edge)
  const flag = flagPaving();
  const flagMat = psx(new THREE.MeshPhongMaterial({ map: flag.map, specular: 0x1a1a1a, shininess: 12 }), {
    noSnap: true, affine: 0, wet: true, puddles: 0.75, vary: 0.8, relief: { height: flag.height, id: flag.id, holes: 0, depth: 0.025, tile: 4, bump: 1.6 },
  });
  const pave = new THREE.Mesh(annulus(c, R.r_walk + 0.15, R.r_disc, 1.1, 2.2, 0, world(4)), flagMat);
  pave.name = "rond_pavement";
  // the carriageway: setts in rings. u runs round the ring (an even number of tiles per ring, so the seam meets),
  // v outward; each 0.5 m ring laid on its own (its setts do not line up with the next ring's, as when laid).
  // No parallax (it steps along world x-z, not along these rings): the relief light and the per-stone dice only.
  const setts = withPictures(quayPaving(), { map: "/textures/quay_setts.jpg", height: "/textures/quay_setts_h.png", id: "/textures/quay_setts_id.png" });
  const settMat = psx(new THREE.MeshPhongMaterial({ map: setts.map, color: 0xffffff, specular: 0x363636, shininess: 22 }), {
    noSnap: true, affine: 0, wet: true, puddles: 1.15, vary: 1, relief: { height: setts.height, id: setts.id, holes: 0.05, depth: 0, tile: 2.5, bump: 3.2 },
  });
  const TILE = 2.5;
  const road = new THREE.Mesh(
    annulus(c, R.r_island + 0.15, R.r_walk - 0.15, 0.5, 0.9, 0, (_x, _z, r, a, band) => {
      const rm = R.r_island + 0.15 + (band + 0.5) * 0.5;
      const n = Math.max(2, Math.round((2 * Math.PI * rm) / TILE));
      return [(a / (2 * Math.PI)) * n + band * 0.37, r / TILE];
    }),
    settMat,
  );
  road.name = "rond_road";
  // the island: gravel, and a ring of flags round the fountain
  const earth = earthPaving();
  const earthMat = psx(new THREE.MeshLambertMaterial({ map: earth.map }), { noSnap: true, affine: 0, wet: true, puddles: 1.3, vary: 1, detile: true, relief: { height: earth.height, depth: 0.045, tile: 4, bump: 3.2 } });
  const island = new THREE.Mesh(
    mergeGeometries([annulus(c, 0, R.r_path_in, 0.9, 1.4, 0, world(4)), annulus(c, R.r_path_out, R.r_island - 0.15, 0.9, 1.6, 0, world(4))])!,
    earthMat,
  );
  island.name = "rond_island";
  const ringPath = new THREE.Mesh(annulus(c, R.r_path_in, R.r_path_out, 0.8, 1.2, 0, world(4)), flagMat);
  ringPath.name = "rond_path";
  // the kerbs: bluestone edge stones on both edges of the carriageway, and round the fountain's walk
  const edge = edgeStoneTextures();
  const kerbMat = psx(new THREE.MeshLambertMaterial({ map: edge.map, bumpMap: edge.height, bumpScale: EDGE_BUMP, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { noSnap: true, affine: 0, wet: true });
  const kerb = (r: number, w: number) =>
    annulus(c, r - w / 2, r + w / 2, w, 0.9, 0.004, (_x, _z, _r, a, _b) => {
      const n = Math.round((2 * Math.PI * r) / 2);
      return [(a / (2 * Math.PI)) * n, (_r - (r - w / 2)) / w];
    });
  const kerbs = new THREE.Mesh(mergeGeometries([kerb(R.r_walk, 0.3), kerb(R.r_island, 0.3), kerb(R.r_path_in, 0.22), kerb(R.r_path_out, 0.22)])!, kerbMat);
  kerbs.name = "rond_kerbs";
  group.add(pave, road, island, ringPath, kerbs);
}

// ------------------------------------------------------------------ railings (low iron, drawn in code)

function railings(lines: P2[][]): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  const bar = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number) => {
    const L = Math.hypot(bx - ax, by - ay, bz - az);
    const g = new THREE.BoxGeometry(w, L, w);
    g.translate(0, L / 2, 0);
    const dir = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    g.applyQuaternion(q);
    g.translate(ax, ay, az);
    geos.push(g);
  };
  for (const line of lines) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.2) continue;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      // posts with a ball, every 1.6 m at most
      const np = Math.max(1, Math.ceil(L / 1.6));
      for (let k = 0; k <= np; k++) {
        const x = ax + (ux * L * k) / np;
        const z = az + (uz * L * k) / np;
        bar(x, 0, z, x, 0.68, z, 0.05);
        const s = new THREE.SphereGeometry(0.04, 5, 3);
        s.translate(x, 0.71, z);
        geos.push(s.toNonIndexed());
      }
      // two rails and the pickets with points
      bar(ax, 0.1, az, bx, 0.1, bz, 0.03);
      bar(ax, 0.56, az, bx, 0.56, bz, 0.03);
      const nk = Math.floor(L / 0.13);
      for (let k = 1; k < nk; k++) {
        const x = ax + ux * k * 0.13;
        const z = az + uz * k * 0.13;
        bar(x, 0.1, z, x, 0.62, z, 0.016);
        const cone = new THREE.ConeGeometry(0.018, 0.06, 4);
        cone.translate(x, 0.65, z);
        geos.push(cone.toNonIndexed());
      }
    }
  }
  if (!geos.length) return null;
  const ng = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of ng) {
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  }
  return mergeGeometries(ng);
}

// ------------------------------------------------------------------ the whole

export interface TownPlaces {
  colliders: Rect[];
  update(camera: THREE.Camera, far: number): void;
}

export function loadTownPlaces(scene: THREE.Scene, ready: Promise<unknown>): TownPlaces {
  const root = new THREE.Group();
  root.name = "townplaces";
  scene.add(root);
  // one group per place (the square, each green), for culling by distance
  const groups = new Map<string, { g: THREE.Group; c: P2; r: number }>();
  const groupOf = (id: string, c: P2, r: number) => {
    let e = groups.get(id);
    if (!e) {
      const g = new THREE.Group();
      g.name = `place_${id}`;
      root.add(g);
      e = { g, c, r };
      groups.set(id, e);
    }
    return e.g;
  };
  const rondG = groupOf("rond", ROND.c, ROND.r_disc + 10);
  rondGround(rondG);
  const greenCentre = (g: Green): P2 => {
    const pts = g.grass.flat();
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  };
  const ironMat = psx(new THREE.MeshLambertMaterial({ color: 0x1a2a20 }), { affine: 0 });
  ironMat.name = "places_rail";
  for (const g of GREENS) {
    const grp = groupOf(g.id, greenCentre(g), 40);
    const rg = railings(g.rails);
    if (rg) {
      const m = new THREE.Mesh(rg, ironMat);
      m.name = `${g.id}_railing`;
      grp.add(m);
    }
  }

  // the colliders (Jef and the crowd bump into them; the walk map has them as wall too, plan.py)
  const colliders: Rect[] = [];
  const [fx, fz] = ROND.fountain;
  colliders.push(rectAround(fx, fz, ROND.r_basin * 0.93, ROND.r_basin * 0.93, 0.62));
  for (const [x, z] of ROND.trees) colliders.push(rectAround(x, z, 0.22, 0.22));
  const benchRect = (x: number, z: number, yaw: number): Rect => {
    const s = Math.abs(Math.sin(yaw));
    const c = Math.abs(Math.cos(yaw));
    return rectAround(x, z, 0.95 * c + 0.32 * s, 0.95 * s + 0.32 * c);
  };
  for (const [x, z, y] of ROND.benches) colliders.push(benchRect(x, z, y));
  colliders.push(rectAround(ROND.kiosk[0], ROND.kiosk[1], 1.15, 1.15));
  colliders.push(benchRect(ROND.urinal[0], ROND.urinal[1], ROND.urinal[2]));
  for (const g of GREENS) {
    for (const [x, z] of g.trees) colliders.push(rectAround(x, z, 0.22, 0.22));
    for (const [x, z, y] of g.benches) colliders.push(benchRect(x, z, y));
    for (const line of g.rails)
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i];
        const [bx, bz] = line[i + 1];
        colliders.push({ minX: Math.min(ax, bx) - 0.06, maxX: Math.max(ax, bx) + 0.06, minZ: Math.min(az, bz) - 0.06, maxZ: Math.max(az, bz) + 0.06, top: 0.72 });
      }
    for (const e of g.extras) if (e.kind === "calvary") colliders.push(rectAround(e.x, e.z, 1.1, 0.9));
  }

  // the trees: plane trees on the square, limes and elms on the greens (world/trees3d.ts)
  const treeKind = new Map<string, string>();
  const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;
  for (const [x, z] of ROND.trees) treeKind.set(key(x, z), "tree_plane");
  for (const g of GREENS) for (const [x, z, k] of g.trees) treeKind.set(key(x, z), k);
  ready
    .then(() =>
      buildTrees3D(scene, [...ROND.trees, ...GREENS.flatMap((g) => g.trees.map(([x, z]) => [x, z] as P2))], { kindAt: (x, z) => treeKind.get(key(x, z)) ?? null }),
    )
    .catch((e) => console.warn("the places' trees did not load", e));

  // the furniture from places.glb: copies merged per place and material
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/places.glb")
    .then((gltf) => {
      const mats = new Map<string, THREE.Material>();
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
        if (src.name === "pl_water") m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: 0xa8b4b8, vertexColors: true, transparent: true, opacity: 0.85 }), { affine: 0, wet: true });
        else if (src.name === "pl_iron" || src.name === "pl_atlas") m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true, side: THREE.DoubleSide }), { affine: 0 });
        else m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true }), { affine: 0 });
        m.name = src.name;
        mats.set(src.name, m);
        return m;
      };
      // each model: its geometry per material, in its own frame
      const models = new Map<string, Array<{ geo: THREE.BufferGeometry; mat: THREE.Material }>>();
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        let top: THREE.Object3D = m;
        while (top.parent && top.parent !== gltf.scene) top = top.parent;
        const list = models.get(top.name) ?? [];
        const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
        if (!geo.getAttribute("color")) geo.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 3).fill(1), 3));
        const srcs = Array.isArray(m.material) ? m.material : [m.material];
        if (geo.groups.length > 1) {
          for (const gr of geo.groups) {
            const part = subGeometry(geo, gr.start, gr.count);
            list.push({ geo: part, mat: matFor(srcs[gr.materialIndex ?? 0] as THREE.MeshStandardMaterial) });
          }
        } else list.push({ geo, mat: matFor(srcs[0] as THREE.MeshStandardMaterial) });
        models.set(top.name, list);
      });
      // placed copies, per place
      const put = new Map<THREE.Group, Map<THREE.Material, THREE.BufferGeometry[]>>();
      const place = (grp: THREE.Group, name: string, x: number, z: number, yaw: number, scale = 1) => {
        const parts = models.get(name);
        if (!parts) return;
        if (["fountain", "kiosk", "urinal", "bench", "calvary"].includes(name)) {
          const shape = modelShape(parts, () => parts.filter(p => p.mat.name !== "pl_water").map(p => (p.geo.index ? p.geo.toNonIndexed() : p.geo).getAttribute("position").array));
          const exact = modelCollider(shape, x, z, yaw, 0, scale, 1, scale);
          const rect = colliders.find(r => Math.abs((r.minX + r.maxX) / 2 - x) < 0.01 && Math.abs((r.minZ + r.maxZ) / 2 - z) < 0.01);
          if (rect) { rect.surface = exact.surface; rect.top = exact.top; }
        }
        const m4 = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, 1, scale));
        // (the prop check: dev/propcheck.ts)
        addProp({ src: "town places", name, x, y: 0, z, yaw, s: [scale, 1, scale], pts: parts.map((q) => q.geo.getAttribute("position").array) });
        let byMat = put.get(grp);
        if (!byMat) put.set(grp, (byMat = new Map()));
        for (const p of parts) {
          const g = p.geo.clone().applyMatrix4(m4);
          const l = byMat.get(p.mat) ?? [];
          l.push(g);
          byMat.set(p.mat, l);
        }
      };
      place(rondG, "fountain", fx, fz, 0);
      place(rondG, "kiosk", ROND.kiosk[0], ROND.kiosk[1], ROND.kiosk[2]);
      place(rondG, "urinal", ROND.urinal[0], ROND.urinal[1], ROND.urinal[2]);
      for (const [x, z, y] of ROND.benches) place(rondG, "bench", x, z, y);
      for (const [x, z] of ROND.trees) place(rondG, "tree_grille", x, z, Math.atan2(x - ROND.c[0], z - ROND.c[1]));
      for (const g of GREENS) {
        const grp = groups.get(g.id)!.g;
        for (const [x, z, y] of g.benches) place(grp, "bench", x, z, y);
        for (const b of g.beds) place(grp, "flowerbed", b.c[0], b.c[1], 0, b.r);
        for (const e of g.extras) place(grp, e.kind, e.x, e.z, e.yaw);
      }
      for (const [grp, byMat] of put) {
        for (const [mat, geos] of byMat) {
          const merged = mergeGeometries(geos.map(normalizeAttrs));
          if (!merged) continue;
          merged.computeBoundingSphere();
          const mesh = new THREE.Mesh(merged, mat);
          mesh.name = `${grp.name}_${mat.name}`;
          grp.add(mesh);
        }
      }
      draco.dispose();
    })
    .catch((e) => console.warn("places.glb did not load", e));

  return {
    colliders,
    update(camera, far) {
      const cp = camera.position;
      for (const { g, c, r } of groups.values()) g.visible = Math.hypot(cp.x - c[0], cp.z - c[1]) - r < far + 20;
    },
  };
}

/** The triangles start..start+count of an indexed or plain geometry, as a plain geometry. */
function subGeometry(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) {
    const attr = a as THREE.BufferAttribute;
    out.setAttribute(k, new THREE.BufferAttribute((attr.array as Float32Array).slice(start * attr.itemSize, (start + count) * attr.itemSize), attr.itemSize, attr.normalized));
  }
  return out;
}

/** The same attributes on every copy (position, normal, uv, color), non-indexed, for merging. */
function normalizeAttrs(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  const count = n.getAttribute("position").count;
  if (!n.getAttribute("uv")) n.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  if (!n.getAttribute("color")) n.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  const c = n.getAttribute("color");
  if (c.itemSize === 4) {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      a[i * 3] = c.getX(i);
      a[i * 3 + 1] = c.getY(i);
      a[i * 3 + 2] = c.getZ(i);
    }
    n.setAttribute("color", new THREE.Float32BufferAttribute(a, 3));
  }
  for (const k of Object.keys(n.attributes)) if (!["position", "normal", "uv", "color"].includes(k)) n.deleteAttribute(k);
  if (!n.getAttribute("normal")) n.computeVertexNormals();
  return n;
}
