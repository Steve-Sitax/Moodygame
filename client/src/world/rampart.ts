import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { makeHuman, type Human } from "../game/humans";

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

export interface WallModel {
  group: THREE.Group;
  ready: Promise<void>;
  /** Hide the chunks beyond the fog. */
  update(camera: THREE.Camera, far: number): void;
}

/**
 * The wall's model (wall.glb): each material keeps the little texture the Blender script painted into
 * it, drawn the game's way (psx, vertex colours); lantern glass ("*_glow") is drawn unlit and bright.
 */
export function loadWall(scene: THREE.Scene): WallModel {
  const group = new THREE.Group();
  group.name = "town_wall";
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  const chunks: THREE.Mesh[] = [];
  let millSails: THREE.Object3D | null = null;
  /** The mill's axle (build_wall.py MILL_HUB): out to the field, tilted up. */
  const AXLE = new THREE.Vector3(0.00074, 0.13917, 0.99027).normalize();
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
    if (src.name.endsWith("_glow")) {
      m = psx(new THREE.MeshBasicMaterial({ map: map ?? null, color: map ? 0xffffff : 0xffd890, vertexColors: false }), { affine: 0 });
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
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const ready = new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/wall.glb")
    .then((gltf) => {
      const meshes: THREE.Mesh[] = [];
      // the mill's sails turn about their hub (build_wall.py: node "mill_sails", origin on the hub, the axle its local +z tilted up)
      const sails = gltf.scene.getObjectByName("mill_sails");
      if (sails) {
        sails.updateWorldMatrix(true, true);
        const hub = new THREE.Vector3().setFromMatrixPosition(sails.matrixWorld);
        const pivot = new THREE.Group();
        pivot.name = "mill_sails_pivot";
        pivot.position.copy(hub);
        group.add(pivot);
        sails.removeFromParent();
        sails.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh) return;
          if (!m.geometry.getAttribute("color")) {
            const n = m.geometry.getAttribute("position").count;
            m.geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
          }
          const src = Array.isArray(m.material) ? m.material : [m.material];
          const out = src.map((q) => matFor(q as THREE.MeshStandardMaterial));
          m.material = Array.isArray(m.material) ? out : out[0];
        });
        sails.position.set(0, 0, 0);
        pivot.add(sails);
        millSails = sails;
      }
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.getAttribute("color")) {
          // no vertex colours in this part: white, so the Lambert material's vertexColors reads 1
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
        group.add(m);
        chunks.push(m);
      }
      draco.dispose();
    })
    .catch((e) => console.warn("wall.glb did not load", e));
  const tmp = new THREE.Vector3();
  return {
    group,
    ready: ready.then(() => {}),
    update(camera, far) {
      const cp = camera.position;
      // the sails turn slowly, the wind of an autumn day (a turn in about 9 s)
      if (millSails) millSails.quaternion.setFromAxisAngle(AXLE, (performance.now() / 1000) * 0.7);
      for (const m of chunks) {
        const s = m.geometry.boundingSphere!;
        tmp.copy(s.center).applyMatrix4(m.matrixWorld);
        m.visible = tmp.distanceTo(cp) - s.radius < far + 20;
      }
    },
  };
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
