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

interface Stair {
  side: string;
  /** The foot (y 0) and the head (y h), on the flight's middle line. */
  a: [number, number];
  b: [number, number];
  half: number;
  flight: [number, number, number, number];
  landing: [number, number, number, number];
}

interface Gate {
  id: string;
  name: string;
  house: [number, number, number, number];
  passage: [number, number, number, number];
  bridge: [number, number, number, number];
}

interface RampartData {
  h: number;
  inner: { west: number; north: number; east: number };
  tops: number[][][];
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

const inBox = (b: number[], x: number, z: number, m = 0) => x >= b[0] - m && x <= b[2] + m && z >= b[1] - m && z <= b[3] + m;

/** Inside the town's wall street, clear of the wall: nothing to ask. */
const clear = (x: number, z: number) => !R || (x > R.inner.west + 0.05 + 2.4 && x < R.inner.east - 0.05 - 2.4 && z < R.inner.north - 0.05 - 2.4 && z > 0.5);

/** Height of the wall's walk, a bastion top or a stair at (x, z), or null where the wall is not. */
export function rampartHeightAt(x: number, z: number): number | null {
  if (clear(x, z)) return null;
  const H = R!.h;
  for (const s of R!.stairs) {
    if (inBox(s.landing, x, z, 0.02)) return H;
    if (inBox(s.flight, x, z, 0.02)) {
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
  const rect = (b: number[], m: number) => ({ minX: b[0] - m, maxX: b[2] + m, minZ: b[1] - m, maxZ: b[3] + m });
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
  return (R?.gates ?? []).map((g) => ({ id: g.id, name: g.name, x: (g.passage[0] + g.passage[2]) / 2, z: (g.passage[1] + g.passage[3]) / 2 }));
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
  for (const g of (R?.gates ?? []) as Array<Gate & { posts: [number, number][]; out: [number, number] }>) {
    for (const [x, z] of g.posts) guards.push({ kind: "post", human: null, x, z, yaw: yawOf(-g.out[0], -g.out[1]) });
  }
  if (R) {
    const mid = (side: "west" | "north" | "east") => (R.inner[side] + (side === "west" ? -1 : 1) * 3.5);
    const rounds: Array<[[number, number], [number, number]]> = [
      [[mid("west"), 20], [mid("west"), 128]],
      [[-128, mid("north")], [66, mid("north")]],
      [[mid("east"), 140], [mid("east"), 280]],
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
