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

/** The walk's paving (pass 2): the quays' granite setts (the Codex picture and its maps), a little smaller. */
const WALK_TILE = 2.0;
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
  const mats = new Map<string, THREE.Material>();
  const chunks: THREE.Mesh[] = [];
  const sails: Array<{ node: THREE.Object3D; axle: THREE.Vector3; speed: number; phase: number }> = [];
  const glows: Array<{ m: THREE.MeshBasicMaterial; day: number }> = [];
  let nature: RampartNature | null = null;
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
      withPictures(pave, { map: "/textures/quay_setts.jpg", height: "/textures/quay_setts_h.png", id: "/textures/quay_setts_id.png" });
      m = psx(new THREE.MeshPhongMaterial({ map: pave.map, color: 0xf0f0f0, specular: 0x363636, shininess: 22, vertexColors: true }), {
        noSnap: true,
        affine: 0,
        fogReach: 2.2,
        // wet in the rain, but no puddles: the puddles show the street mirror, whose plane is the street (y 0),
        // so up here at 6.5 m they showed the wall upside down in the walk (the lead's check, 2026-09-25)
        wet: true,
        vary: 1,
        relief: { height: pave.height, id: pave.id, holes: 0.05, depth: 0, tile: WALK_TILE, bump: 3.2 },
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
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : src.color, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 });
    }
    m.name = src.name;
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
      const meshes: THREE.Mesh[] = [];
      const node = gltf.scene.getObjectByName("wall_dressing");
      let d: WallDressing = { mills: [], benches: [], lamps: [], lanterns: [] };
      try {
        if (node?.userData.dressing) d = JSON.parse(node.userData.dressing as string) as WallDressing;
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
        sails.push({ node: sn, axle: new THREE.Vector3(ax[0], ax[1], ax[2]).normalize(), speed: i === 0 ? 0.7 : 0.55, phase: i * 1.3 });
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
        group.add(m);
        chunks.push(m);
      }
      draco.dispose();
      nature = buildRampartNature(scene, d);
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
      const t = performance.now() / 1000;
      for (const s of sails) s.node.quaternion.setFromAxisAngle(s.axle, t * s.speed + s.phase);
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
  for (const b of d.benches) {
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
 * side of the arch, facing the street, and one on a round along the walk of each side, a halt at each
 * end. They stand still where the player stands in their way.
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
  if (R) {
    // a round along the middle of the walk on three segments of the bent wall: s from .. to (m)
    const onWalk = (name: string, s: number): [number, number] => {
      const g = R.segments.find((q) => q.name === name)!;
      const off = R.t / 2 - R.t; // the middle of the walk, from the field face inward
      return [g.o[0] + g.t[0] * s + g.n[0] * off, g.o[1] + g.t[1] * s + g.n[1] * off];
    };
    const rounds: Array<[[number, number], [number, number]]> = [
      [onWalk("seg1", 45), onWalk("seg1", 95)],
      [onWalk("seg5", 100), onWalk("seg5", 170)],
      [onWalk("seg8", 20), onWalk("seg8", 50)],
    ];
    for (const [a, b] of rounds) guards.push({ kind: "round", human: null, x: a[0], z: a[1], yaw: yawOf(b[0] - a[0], b[1] - a[1]), a, b, toB: true, wait: 0 });
  }
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
