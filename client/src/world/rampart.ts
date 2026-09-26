import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { makeHuman, type Human } from "../game/humans";
import { grassPaving, quayPaving, withPictures } from "./paving";
import type { GasLamps } from "./gaslamps";
import type { Props } from "./props3d";
import { buildRampartNature, type RampartNature } from "./rampartNature";
import { loadTownWallBumps, townWallBump } from "./townWallBumps";
import { addProp } from "./propSpots";
import { buildWallLife, type WallLife } from "./wallLife";

// The town wall (Steve, 2026-09-25; tools/city/rampart.py, tools/blender/build_wall.py -> wall.glb).
// The walk map has the walk on the wall, the bastion tops and the stairs as open ground and the parapets,
// railings, guard houses and gate towers as walls, so the only way up is a stair; this gives the heights
// (rijnkaai.ts baseAt), as steenramp.ts does for the Steen's courtyard. People in the crowd walk up too:
// the ramparts were the town's promenade.

type Ring = number[][];

interface Frame {
  /** Start of the segment on the field face, along it, out to the field. */
  o: [number, number];
  t: [number, number];
  n: [number, number];
}

interface Stair {
  seg: string;
  /** The foot (y 0) and the head (y h), on the flight's middle line. */
  a: [number, number];
  b: [number, number];
  half: number;
  /** Four corners each (the wall is bent: any angle). */
  flight: Ring;
  landing: Ring;
}

interface Gate {
  id: string;
  name: string;
  seg: string;
  s: number;
  frame: Frame;
  house: Ring;
  passage: Ring;
  bridge: Ring;
  out: [number, number];
  posts: [number, number][];
}

interface RampartData {
  h: number;
  t: number;
  inner: { west: number; north: number; east: number };
  /** Inside this ring (2.6 m clear of the town face) nothing of the wall stands. */
  clear: Ring;
  segments: Array<Frame & { name: string; len: number }>;
  tops: Ring[];
  stairs: Stair[];
  gates: Gate[];
}

const R = (CITY as unknown as { decor?: { rampart?: RampartData } }).decor?.rampart ?? null;

/** Bounding boxes of the top rings, for a quick no. */
const TOPS = (R?.tops ?? []).map((ring) => {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  return { ring, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
});

const inRing = (ring: number[][], x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

const boxOf = (ring: Ring) => ({
  minX: Math.min(...ring.map((p) => p[0])),
  maxX: Math.max(...ring.map((p) => p[0])),
  minZ: Math.min(...ring.map((p) => p[1])),
  maxZ: Math.max(...ring.map((p) => p[1])),
});
const STAIRS = (R?.stairs ?? []).map((s) => ({ s, flight: boxOf(s.flight), landing: boxOf(s.landing) }));
const inPoly = (ring: Ring, box: Rect, x: number, z: number) => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ && inRing(ring, x, z);
/** The clear ring, and a box well inside it (most questions end there). */
const CLEAR = R?.clear ?? null;
// (the wall only ever bends outward from the straight line between its two ends at the river, so the box
// between those ends, below the lowest corner of the town face, is inside)
const CLEAR_IN: Rect | null = (() => {
  const L = (R as unknown as { inner_line?: Ring } | null)?.inner_line;
  if (!L || L.length < 3) return null;
  const a = L[0];
  const b = L[L.length - 1];
  return { minX: Math.min(a[0], b[0]) + 3, maxX: Math.max(a[0], b[0]) - 3, minZ: 1, maxZ: Math.min(...L.slice(1, -1).map((p) => p[1])) - 3 };
})();

/** Inside the town's wall street, clear of the wall: nothing to ask. */
const clear = (x: number, z: number) => {
  if (!R || !CLEAR) return true;
  if (z <= 0.5) return false;
  if (CLEAR_IN && x > CLEAR_IN.minX && x < CLEAR_IN.maxX && z > CLEAR_IN.minZ && z < CLEAR_IN.maxZ) return true;
  return inRing(CLEAR, x, z);
};

/** Height of the wall's walk, a bastion top or a stair at (x, z), or null where the wall is not. */
export function rampartHeightAt(x: number, z: number): number | null {
  if (clear(x, z)) return null;
  const H = R!.h;
  for (const { s, flight, landing } of STAIRS) {
    if (inPoly(s.landing, landing, x, z)) return H;
    if (inPoly(s.flight, flight, x, z)) {
      const [ax, az] = s.a;
      const [bx, bz] = s.b;
      const dx = bx - ax;
      const dz = bz - az;
      const k = ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1);
      return H * Math.max(0, Math.min(1, k));
    }
  }
  for (const t of TOPS) {
    if (x < t.minX || x > t.maxX || z < t.minZ || z > t.maxZ) continue;
    if (inRing(t.ring, x, z)) return H;
  }
  return null;
}

/** On a wall stair's flight or landing, or a step off its foot (the look pass: the crowd's grid keeps a narrower berth
 * there, game/crowd.ts `narrow`, so townspeople walk up to the walk instead of only reaching it unseen). */
export function rampartStairAt(x: number, z: number): boolean {
  for (const { s, flight, landing } of STAIRS) {
    const out = (b: Rect) => x < b.minX - 1.5 || x > b.maxX + 1.5 || z < b.minZ - 1.5 || z > b.maxZ + 1.5;
    if (out(flight) && out(landing)) continue;
    if (inPoly(s.flight, flight, x, z) || inPoly(s.landing, landing, x, z)) return true;
    const [ax, az] = s.a;
    if (Math.hypot(x - ax, z - az) < 1.2) return true;
  }
  return false;
}

/** The stairs, the gate passages and the bridges: props, carts and street things keep off them. */
export function rampartKeepOut(): Rect[] {
  if (!R) return [];
  const out: Rect[] = [];
  const rect = (ring: Ring, m: number) => {
    const b = boxOf(ring);
    return { minX: b.minX - m, maxX: b.maxX + m, minZ: b.minZ - m, maxZ: b.maxZ + m };
  };
  for (const s of R.stairs) {
    out.push(rect(s.flight, 0.8), rect(s.landing, 0.8));
    // the foot: room to step on
    const [ax, az] = s.a;
    out.push({ minX: ax - 1.6, maxX: ax + 1.6, minZ: az - 1.6, maxZ: az + 1.6 });
  }
  for (const g of R.gates) out.push(rect(g.passage, 1.5), rect(g.bridge, 0.5));
  return out;
}

/** The gates, for the map and the places: name and the middle of the passage. */
export function rampartGates(): Array<{ id: string; name: string; x: number; z: number }> {
  return (R?.gates ?? []).map((g) => ({ id: g.id, name: g.name, x: g.passage.reduce((a, p) => a + p[0], 0) / 4, z: g.passage.reduce((a, p) => a + p[1], 0) / 4 }));
}

/** M7 sleep: the wall walk's benches once wall.glb is in (the server reads the same list: server/src/rest.ts). */
export let wallBenchSpots: Array<{ x: number; z: number; y: number }> = [];

/**
 * M7 mills (game/mills.ts, shared/mills.ts millTurning): how fast each mill's sails turn now, by its sails' node
 * name (0 still: fog, a gale, night, Sunday; 1 an ordinary breeze). Unset: 1, as before.
 */
export const millSails: Record<string, number> = {};

/** What build_wall.py placed on the wall (pass 2: the node "wall_dressing" in wall.glb). */
export interface WallDressing {
  /** The mills: the tower's foot (r), the tail pole's capstan, a stage's reach; the sails' node and axle. */
  mills: Array<{ x: number; z: number; r: number; tail?: [number, number]; stage?: number; sails: string; axle: [number, number, number] }>;
  /** Benches: centre, height, along (a), length and depth. */
  benches: Array<{ x: number; z: number; y: number; a: [number, number]; len: number; dep: number; kind: number }>;
  /** The gas lamps on the walk: x, z, the walk's height (props.glb gas_lamp stands there). */
  lamps: Array<[number, number, number]>;
  /** The lanterns of the guard houses and gates: their glass. */
  lanterns: Array<[number, number, number]>;
  /** The look pass: the lawns on the land bastions (outline, the paved squares in them, the trodden path across). */
  lawns?: Array<{ ring: number[][]; paved: number[][][]; path: number[][] }>;
  /** The look pass: every solid prop on the walk as a box (middle, along, length, depth, top over y). */
  props?: Array<{ name: string; x: number; z: number; y: number; a: [number, number]; len: number; dep: number; top: number; set?: string | null }>;
  /** The look pass: the stretch of breastwork the town's gang pulls down (server/src/town/wallfolk.ts has it too). */
  works?: { seg: string; s0: number; s1: number };
  /** The look pass: where a sentry stands before each sentry box on the walk, and the way he faces. */
  sentry_boxes?: Array<{ x: number; z: number; face: [number, number] }>;
}

export interface WallModel {
  group: THREE.Group;
  ready: Promise<void>;
  /** The walk's furniture, once wall.glb has loaded. */
  dressing: Promise<WallDressing>;
  /** Hide the chunks beyond the fog; `dark` (0 day .. 1 night) lights the lanterns and the guard rooms. */
  update(camera: THREE.Camera, far: number, dark?: number): void;
}

/** The gas lamps on the walk (wallLamps): hidden past the fog or this far (their halos still show). */
const lampNodes: THREE.Object3D[] = [];
const LAMP_REACH = 160;

/**
 * The walk's paving: big worn setts in courses across the walk, moss and soil in the joints (the look pass,
 * 2026-09-26: its own Codex picture and the maps tools/textures/setts_maps.py made from it; Steve: "the walk is a flat
 * grey smear"). The stones are big enough to keep their relief further off than the street's (psx relief reach).
 */
const WALK_TILE = 2.4;
/** build_wall.py TILE: metres per repeat of the painted cobble and grass in the glb's uvs. */
const GLB_COBBLE = 1.6;
const GLB_GRASS = 3.0;
const GRASS_TILE = 4.0;

/**
 * The wall's model (wall.glb): each material keeps the little texture the Blender script painted into
 * it, drawn the game's way (psx, vertex colours); lantern glass ("*_glow") is drawn unlit and bright.
 * Pass 2 (2026-09-25): the walk in the city's setts and the bastions in its grass (world/paving.ts, wet,
 * with relief, wet in the rain), two mills with turning sails, the lanterns and guard rooms lit by night.
 */
export function loadWall(scene: THREE.Scene): WallModel {
  const group = new THREE.Group();
  group.name = "town_wall";
  scene.add(group);
  const propsGroup = new THREE.Group();
  propsGroup.name = "town_wall_props";
  scene.add(propsGroup);
  const mats = new Map<string, THREE.Material>();
  const chunks: THREE.Mesh[] = [];
  const sails: Array<{ node: THREE.Object3D; axle: THREE.Vector3; speed: number; phase: number; name: string; angle: number; cur: number }> = [];
  let sailT = performance.now() / 1000; // (M7 mills)
  const glows: Array<{ m: THREE.MeshBasicMaterial; day: number }> = [];
  let nature: RampartNature | null = null;
  let life: WallLife | null = null;
  let lifeT = performance.now();
  let walkMat: THREE.Material | null = null;
  let grassMat: THREE.Material | null = null;
  const matFor = (src: THREE.MeshStandardMaterial): THREE.Material => {
    const have = mats.get(src.name);
    if (have) return have;
    const map = src.map;
    if (map) {
      // pixels up close (the PS1 look), smaller copies further off: long brick faces made rings (moire) without
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapLinearFilter;
      map.generateMipmaps = true;
      map.needsUpdate = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
    }
    let m: THREE.Material;
    if (src.name === "wall_cobble") {
      // the walk and the gate passages: granite setts as on the quays, wet in the rain, each stone its own
      // tone. No parallax: the uvs run along each piece of the wall, not the world's axes (psx relief assumes those)
      const pave = quayPaving();
      // colour, height and stone map in together, or the painted ones stay (bump maps checked, 2026-09-26)
      withPictures(pave, { map: "/textures/wall_walk_setts.jpg", height: "/textures/wall_walk_setts_h.png", id: "/textures/wall_walk_setts_id.png" });
      m = psx(new THREE.MeshPhongMaterial({ map: pave.map, color: 0xf0f0f0, specular: 0x363636, shininess: 22, vertexColors: true }), {
        noSnap: true,
        affine: 0,
        fogReach: 2.2,
        // wet in the rain, but no puddles: the puddles show the street mirror, whose plane is the street (y 0),
        // so up here at 6.5 m they showed the wall upside down in the walk (the lead's check, 2026-09-25)
        wet: true,
        vary: 1,
        relief: { height: pave.height, id: pave.id, holes: 0.05, depth: 0, tile: WALK_TILE, bump: 3.6, reach: 1.7 },
      });
      walkMat = m;
    } else if (src.name === "wall_grass") {
      const gp = grassPaving();
      m = psx(new THREE.MeshLambertMaterial({ map: gp.map, vertexColors: true }), {
        noSnap: true,
        affine: 0,
        fogReach: 2.2,
        wet: true,
        detile: true,
        vary: 0.6,
        relief: { height: gp.height, depth: 0.03, tile: GRASS_TILE, bump: 2.4 },
      });
      grassMat = m;
    } else if (src.name.endsWith("_glow")) {
      const b = new THREE.MeshBasicMaterial({ map: map ?? null, color: map ? 0xffffff : 0xffd890, vertexColors: false });
      // lantern glass and the lit guard rooms: bright by night, dull by day (update's `dark`)
      glows.push({ m: b, day: src.name === "wall_room_glow" ? 0.2 : 0.42 });
      m = psx(b, { affine: 0 });
    } else if (src.name === "wall_canvas") {
      // the sail cloth: pale linen that stays pale seen against the sky (a little of its own light)
      m = psx(
        new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true, side: THREE.DoubleSide, emissive: 0x3c3934, emissiveMap: map ?? null }),
        { fogReach: 2.2, affine: 0 },
      );
    } else if (src.name.endsWith("_decal")) {
      // moss laid 2 cm off the wall (build_wall.py): cut out by its alpha, pulled toward the eye, no depth written
      m = psx(
        new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6, depthWrite: false, side: THREE.DoubleSide }),
        { fogReach: 2.2, affine: 0 },
      );
    } else {
      // (2026-09-26: the brick and stone of the wall, its gates and guard houses: mud and damp at the foot, big soft
      // patches so the picture shows no grid; retro/psx.ts foot and mottle)
      const masonry = /^wall_(brick|quoin|plinth|stone)$/.test(src.name);
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : src.color, vertexColors: true, side: THREE.DoubleSide }), {
        fogReach: 2.2,
        affine: 0,
        ...(masonry ? { foot: { amount: 0.6 }, mottle: src.name === "wall_brick" || src.name === "wall_stone" ? 0.45 : 0 } : {}),
      });
    }
    m.name = src.name;
    townWallBump(m, src.name); // (the bump audit, 2026-09-26: its height map from its own picture, world/townWallBumps.ts)
    mats.set(src.name, m);
    return m;
  };
  /** A mesh's colours (white if it has none) and the game's material; the walk's and the grass's uvs to their new tiles. */
  const dress = (m: THREE.Mesh) => {
    if (!m.geometry.getAttribute("color")) {
      // no vertex colours in this part: white, so the Lambert material's vertexColors reads 1
      const n = m.geometry.getAttribute("position").count;
      m.geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    }
    const src = Array.isArray(m.material) ? m.material : [m.material];
    const out = src.map((q) => matFor(q as THREE.MeshStandardMaterial));
    m.material = Array.isArray(m.material) ? out : out[0];
    const one = Array.isArray(m.material) ? null : m.material;
    const k = one && one === walkMat ? GLB_COBBLE / WALK_TILE : one && one === grassMat ? GLB_GRASS / GRASS_TILE : 1;
    const uv = m.geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
    if (k !== 1 && uv) {
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
      uv.needsUpdate = true;
    }
  };
  let dressingOk: (d: WallDressing) => void = () => {};
  let dressingNo: (e: unknown) => void = () => {};
  const dressing = new Promise<WallDressing>((ok, no) => {
    dressingOk = ok;
    dressingNo = no;
  });
  dressing.catch(() => {});
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const ready = new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/wall.glb")
    .then((gltf) => {
      void loadTownWallBumps(gltf); // (the bump audit: the height maps, each checked against its picture)
      const meshes: THREE.Mesh[] = [];
      const node = gltf.scene.getObjectByName("wall_dressing");
      let d: WallDressing = { mills: [], benches: [], lamps: [], lanterns: [] };
      try {
        if (node?.userData.dressing) d = JSON.parse(node.userData.dressing as string) as WallDressing;
        wallBenchSpots = d.benches.map((q) => ({ x: q.x, z: q.z, y: q.y })); // M7 sleep: Jef may sleep on them (game/sleep.ts)
        // the look pass: the props on the walk into the town-wide prop check (dev/propcheck.ts), each as its box
        for (const q of d.props ?? []) {
          const [x0, x1, z0, z1] = [-q.len / 2, q.len / 2, -q.dep / 2, q.dep / 2];
          const pts = new Float32Array([x0, 0, z0, x1, 0, z0, x0, 0, z1, x1, 0, z1, x0, q.top, z0, x1, q.top, z0, x0, q.top, z1, x1, q.top, z1]);
          addProp({ src: "town wall", name: q.name, x: q.x, y: q.y, z: q.z, yaw: Math.atan2(-q.a[1], q.a[0]), pts: [pts], set: q.set ?? undefined });
        }
      } catch (e) {
        console.warn("wall.glb: no dressing", e);
      }
      node?.removeFromParent();
      // each mill's sails turn about their hub (build_wall.py: node "<mill>_sails", origin on the hub, the axle
      // in its extras, tilted up toward the field)
      d.mills.forEach((mill, i) => {
        const sn = gltf.scene.getObjectByName(mill.sails);
        if (!sn) return;
        sn.updateWorldMatrix(true, true);
        const pivot = new THREE.Group();
        pivot.name = `${mill.sails}_pivot`;
        pivot.position.setFromMatrixPosition(sn.matrixWorld);
        group.add(pivot);
        sn.removeFromParent();
        sn.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) dress(m);
        });
        sn.position.set(0, 0, 0);
        pivot.add(sn);
        const ax = (sn.userData.axle as number[] | undefined) ?? mill.axle;
        sails.push({ node: sn, axle: new THREE.Vector3(ax[0], ax[1], ax[2]).normalize(), speed: i === 0 ? 0.7 : 0.55, phase: i * 1.3, name: mill.sails, angle: i * 1.3, cur: millSails[mill.sails] ?? 1 }); // (M7 mills: name, angle, cur)
      });
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        dress(m);
        meshes.push(m);
      });
      for (const m of meshes) {
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        m.geometry.computeBoundingSphere();
        // (the look pass: the props on the walk in a group of their own, not the wall's: world/wallprobe.ts)
        (m.name.startsWith("wall_props") ? propsGroup : group).add(m);
        chunks.push(m);
      }
      draco.dispose();
      nature = buildRampartNature(scene, d);
      life = buildWallLife(scene, d); // (the look pass: crows, the kite)
      dressingOk(d);
    })
    .catch((e) => {
      console.warn("wall.glb did not load", e);
      dressingNo(e);
    });
  const tmp = new THREE.Vector3();
  let darkNow = -1;
  return {
    group,
    ready: ready.then(() => {}),
    dressing,
    update(camera, far, dark) {
      const cp = camera.position;
      // the sails turn slowly, the wind of an autumn day (a turn in about 9 s; the second mill a little slower)
      // (M7 mills: only with wind, by day, on a working day: game/mills.ts sets millSails; they come up to speed and run down)
      const t = performance.now() / 1000;
      const dt = Math.min(0.25, Math.max(0, t - sailT));
      sailT = t;
      for (const s of sails) {
        const want = millSails[s.name] ?? 1;
        s.cur += (want - s.cur) * Math.min(1, dt * 0.15);
        s.angle += dt * s.speed * s.cur;
        s.node.quaternion.setFromAxisAngle(s.axle, s.angle);
      }
      for (const m of chunks) {
        const s = m.geometry.boundingSphere!;
        tmp.copy(s.center).applyMatrix4(m.matrixWorld);
        m.visible = tmp.distanceTo(cp) - s.radius < far + 20;
      }
      if (dark !== undefined && Math.abs(dark - darkNow) > 0.004) {
        darkNow = dark;
        for (const g of glows) g.m.color.setScalar(g.day + (1 - g.day) * Math.min(1, dark));
      }
      nature?.update(camera, far);
      const now = performance.now();
      life?.update(Math.min(0.1, (now - lifeT) / 1000), camera, darkNow < 0 ? 0 : darkNow);
      lifeT = now;
      const lr = Math.min(far + 20, LAMP_REACH);
      for (const o of lampNodes) o.visible = Math.hypot(o.position.x - cp.x, o.position.z - cp.z) < lr;
    },
  };
}

/**
 * What Jef bumps into on the wall (pass 2): the mills' towers (the second one is not in the walk map), the
 * first mill's capstan, the benches. Colliders are boxes on the world's axes: a turned bench is three small
 * boxes along its length.
 */
export function wallColliders(d: WallDressing): Rect[] {
  const out: Rect[] = [];
  for (const m of d.mills) {
    // a disc as a cross of three boxes
    const r = m.r;
    const k = r * 0.72;
    out.push({ minX: m.x - r, maxX: m.x + r, minZ: m.z - k, maxZ: m.z + k });
    out.push({ minX: m.x - k, maxX: m.x + k, minZ: m.z - r, maxZ: m.z + r });
    out.push({ minX: m.x - r * 0.9, maxX: m.x + r * 0.9, minZ: m.z - r * 0.9, maxZ: m.z + r * 0.9 });
    if (m.tail) out.push({ minX: m.tail[0] - 0.75, maxX: m.tail[0] + 0.75, minZ: m.tail[1] - 0.75, maxZ: m.tail[1] + 0.75 });
  }
  for (const b of [...d.benches, ...(d.props ?? []).map((q) => ({ ...q, y: q.y + q.top - 0.5 }))]) {
    const [ax, az] = b.a;
    const ox = -az;
    const oz = ax;
    for (const f of [-1 / 3, 0, 1 / 3]) {
      const cx = b.x + ax * b.len * f;
      const cz = b.z + az * b.len * f;
      const hl = b.len / 6;
      const hd = b.dep / 2;
      const ex = Math.abs(ax) * hl + Math.abs(ox) * hd;
      const ez = Math.abs(az) * hl + Math.abs(oz) * hd;
      out.push({ minX: cx - ex, maxX: cx + ex, minZ: cz - ez, maxZ: cz + ez, top: b.y + 0.5 });
    }
  }
  return out;
}

/**
 * The gas lamps on the walk (the town's own model, props.glb gas_lamp) and the lanterns of the guard houses
 * and gates, each one of the town's gas lamps (world/gaslamps.ts): lit at dusk, a halo, a pool of light on
 * the stones, the point lights and the wet streaks when near. Nobody sets them, so they follow the clock.
 * Returns the lamp posts' colliders.
 */
export function wallLamps(scene: THREE.Scene, gasLamps: GasLamps, props: Props, d: WallDressing): Rect[] {
  const group = new THREE.Group();
  group.name = "wall_lamps";
  scene.add(group);
  const out: Rect[] = [];
  let id = 1000; // (the city's lamps are d0.., decor.lamps: these come after, far past them)
  for (const [x, z, y] of d.lamps) {
    const obj = props.place("gas_lamp", x, z, 0, group);
    obj.position.y = y;
    obj.updateMatrixWorld(true);
    lampNodes.push(obj);
    gasLamps.addDecor(id++, obj, x, z, { glass: y + 3.65, ground: y });
    out.push({ minX: x - 0.2, maxX: x + 0.2, minZ: z - 0.2, maxZ: z + 0.2 });
  }
  for (const [x, y, z] of d.lanterns) {
    gasLamps.addDecor(id++, new THREE.Object3D(), x, z, { glass: y, ground: rampartHeightAt(x, z) ?? 0 });
  }
  return out;
}

interface Guard {
  kind: "post" | "round";
  human: Human | null;
  x: number;
  z: number;
  yaw: number;
  /** A round: from a to b and back on the walk, a halt at each end. */
  a?: [number, number];
  b?: [number, number];
  toB?: boolean;
  wait?: number;
}

/**
 * Sentries of the garrison at the town wall (drawn here, not townspeople): two at each gate on the town
 * side of the arch, facing the street. (The rounds of the walk and the sentry boxes on it are townspeople
 * with a day since the look pass: server/src/town/wallfolk.ts.)
 */
export function wallGuards(scene: THREE.Scene, heightAt: (x: number, z: number) => number) {
  const group = new THREE.Group();
  group.name = "wall_guards";
  scene.add(group);
  const guards: Guard[] = [];
  const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
  for (const g of R?.gates ?? []) {
    for (const [x, z] of g.posts) guards.push({ kind: "post", human: null, x, z, yaw: yawOf(-g.out[0], -g.out[1]) });
  }
  // (the look pass, 2026-09-26: the rounds of the walk are the garrison's own men now, townspeople with a day:
  // server/src/town/wallfolk.ts. The sentries at the gates stay drawn here.)
  const SPEED = 0.9;
  return {
    group,
    update(dt: number, camera: THREE.Camera | null): void {
      const far = ((scene.fog as THREE.Fog | null)?.far ?? 60) + 20;
      for (const gd of guards) {
        const near = !camera || Math.hypot(camera.position.x - gd.x, camera.position.z - gd.z) < far;
        if (!near) {
          if (gd.human) gd.human.root.visible = false;
          continue;
        }
        if (!gd.human) {
          gd.human = makeHuman("sentry");
          if (!gd.human) continue;
          group.add(gd.human.root);
          gd.human.play(gd.kind === "post" ? "idle" : "walk", 0);
        }
        const h = gd.human;
        h.root.visible = true;
        if (gd.kind === "round") {
          const [tx, tz] = gd.toB ? gd.b! : gd.a!;
          const d = Math.hypot(tx - gd.x, tz - gd.z);
          const blocked = !!camera && Math.hypot(camera.position.x - gd.x, camera.position.z - gd.z) < 1.4;
          if (gd.wait! > 0) {
            gd.wait! -= dt;
            if (gd.wait! <= 0) {
              gd.toB = !gd.toB;
              h.play("walk");
            }
          } else if (d < 0.2) {
            gd.wait = 6;
            h.play("idle");
          } else if (!blocked) {
            const k = Math.min(1, (SPEED * dt) / d);
            gd.x += (tx - gd.x) * k;
            gd.z += (tz - gd.z) * k;
            gd.yaw = yawOf(tx - gd.x, tz - gd.z);
            h.setPace(SPEED);
          }
        }
        h.root.position.set(gd.x, heightAt(gd.x, gd.z), gd.z);
        h.root.rotation.y = gd.yaw;
        h.update(Math.min(dt, 0.1));
      }
    },
  };
}
