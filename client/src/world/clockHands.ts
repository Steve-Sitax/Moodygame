import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { psx } from "../retro/psx";

// Every clock in the game shows the game's own time (Steve, 2026-09-26; CLAUDE.md). One place for all
// of them: a dial is registered here (a room's wall clock, a clock case in a home, the clockmaker's wall,
// a shop sign, a tower clock of a model file) and gets live hands: one small mesh per dial (the hour
// hand, the minute hand and the hub in one geometry, one draw), just in front of the painted face. The
// faces carry no painted hands any more. Once a game minute (setClockHands, from the frame) every dial's
// hands are laid again: the minute hand jumps a minute like a tower clock's, the hour hand goes on with
// the minutes. Dials are held weakly: a room or a piece that is thrown away takes its clock with it.
//
// Model files (tools/blender): an empty named `clock_face_<name>` at the middle of the dial's face, with
// the custom property `radius` (metres, the face's outer edge). Its facing: the custom properties
// nx, ny, nz (glTF / game axes, out of the face), or else the empty's own axes: Blender -Y out of the face,
// Blender +Z up (in three: +Z out, +Y up). Optional: `style` ("iron" or "gilt"). Every GLTFLoader in the
// game hands its file through here first (the parse below), so any model can carry clocks; the hands
// hang on the model's nearest part, in the place the game puts that part.
//
// The dev check: __scheldemist.clocks() (main.ts): every dial, where, the time it shows against the game's.

export interface HandsLook {
  /** The material of the hands (reuse the room's or the model's own kind: docs/rendering.md). */
  mat: THREE.Material;
  /** Lengths and widths as parts of the face's radius. */
  minute?: number;
  hour?: number;
  width?: number;
}

export interface DialOpts extends HandsLook {
  /** The middle of the face, in the parent's frame. */
  at: [number, number, number];
  /** Out of the face, in the parent's frame (default: from `ry`, else +z). */
  normal?: [number, number, number];
  /** The way the face looks, as a wall picture's ry (normal = sin ry, 0, cos ry). */
  ry?: number;
  /** The face's radius (to the outer edge of its ring), metres. */
  radius: number;
  /** How far in front of the face the hands lie (default: 3 % of the radius, at least 4 mm). */
  lift?: number;
  /** What it is: "shop wall clock", "tower clock" (for the check). */
  kind: string;
  /** Where (for the check; else found from the parents' names). */
  where?: string;
}

interface Dial {
  mesh: WeakRef<THREE.Mesh>;
  geo: WeakRef<THREE.BufferGeometry>;
  kind: string;
  where: string;
  radius: number;
  minute: number;
  hour: number;
  width: number;
  /** The minute of the 12 hours the hands show now (-1: not laid yet). */
  shows: number;
  /** Where it came from: code, a model's marker. */
  from: "code" | "model";
}

const dials: Dial[] = [];
/** The game's minute of the day now (floor of the HUD's hourF * 60), -1 before the first frame. */
let gameMinute = -1;
/** The clock's time before the game has one: ten past ten, as a shop window shows it. */
const IDLE_MINUTE = 10 * 60 + 10;

// ---------------------------------------------------------------- the hands' shape

const HUB_N = 8;
const VERTS = 4 + 4 + 1 + HUB_N;

function handsGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(VERTS * 3), 3));
  const n = new Float32Array(VERTS * 3);
  for (let i = 0; i < VERTS; i++) n[i * 3 + 2] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(VERTS * 2), 2));
  g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(VERTS * 3).fill(1), 3));
  const idx: number[] = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  for (let i = 0; i < HUB_N; i++) idx.push(8, 9 + i, 9 + ((i + 1) % HUB_N));
  g.setIndex(idx);
  return g;
}

/** Lay the hands at this minute of the 12 hours (0..719), in the face's plane (x right, y up, z out). */
function layHands(g: THREE.BufferGeometry, d: Dial, m12: number): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  const R = d.radius;
  const w = d.width * R;
  const lift = 0; // the mesh itself sits in front of the face; the hands stack by a hair
  const hand = (o: number, ang: number, len: number, half: number, z: number) => {
    const dx = Math.sin(ang);
    const dy = Math.cos(ang);
    const px = Math.cos(ang);
    const py = -Math.sin(ang);
    const tail = len * 0.22;
    const at = len * 0.12;
    const put = (i: number, x: number, y: number) => {
      a[(o + i) * 3] = x;
      a[(o + i) * 3 + 1] = y;
      a[(o + i) * 3 + 2] = lift + z;
    };
    put(0, -dx * tail, -dy * tail);
    put(1, px * half + dx * at, py * half + dy * at);
    put(2, dx * len, dy * len);
    put(3, -px * half + dx * at, -py * half + dy * at);
  };
  const minuteAng = ((m12 % 60) / 60) * Math.PI * 2;
  const hourAng = (m12 / 720) * Math.PI * 2;
  const step = Math.max(0.0008, R * 0.006);
  hand(0, hourAng, d.hour * R, w * 0.62, 0);
  hand(4, minuteAng, d.minute * R, w * 0.45, step);
  const hub = w * 0.55;
  a[8 * 3] = 0;
  a[8 * 3 + 1] = 0;
  a[8 * 3 + 2] = step * 2;
  for (let i = 0; i < HUB_N; i++) {
    const t = (i / HUB_N) * Math.PI * 2;
    a[(9 + i) * 3] = Math.cos(t) * hub;
    a[(9 + i) * 3 + 1] = Math.sin(t) * hub;
    a[(9 + i) * 3 + 2] = step * 2;
  }
  pos.needsUpdate = true;
  g.computeBoundingSphere();
  d.shows = m12;
}

const nowM12 = () => (gameMinute < 0 ? IDLE_MINUTE : gameMinute) % 720;

// ---------------------------------------------------------------- dials

/** Hands on a dial: a mesh added to `parent` (not merged with the room's still things: rooms.ts mergeStatic keeps it live). */
export function addDial(parent: THREE.Object3D, o: DialOpts): THREE.Mesh {
  const n = new THREE.Vector3(...(o.normal ?? (o.ry !== undefined ? [Math.sin(o.ry), 0, Math.cos(o.ry)] : [0, 0, 1]))).normalize();
  const mesh = new THREE.Mesh(handsGeometry(), o.mat);
  const lift = o.lift ?? Math.max(0.004, o.radius * 0.03);
  mesh.position.set(o.at[0] + n.x * lift, o.at[1] + n.y * lift, o.at[2] + n.z * lift);
  mesh.quaternion.copy(facing(n, new THREE.Vector3(0, 1, 0)));
  place(mesh, o, "code");
  parent.add(mesh);
  return mesh;
}

/** The turn that puts +z along n with +y as near to `up` as it can. */
function facing(n: THREE.Vector3, up: THREE.Vector3): THREE.Quaternion {
  const z = n.clone().normalize();
  let x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-8) x = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), z);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function place(mesh: THREE.Mesh, o: Pick<DialOpts, "radius" | "minute" | "hour" | "width" | "kind" | "where">, from: Dial["from"]): Dial {
  mesh.name = "clock_hands";
  mesh.userData.liveClock = true;
  const d: Dial = {
    mesh: new WeakRef(mesh),
    geo: new WeakRef(mesh.geometry),
    kind: o.kind,
    where: o.where ?? "",
    radius: o.radius,
    minute: o.minute ?? 0.72,
    hour: o.hour ?? 0.48,
    width: o.width ?? 0.08,
    shows: -1,
    from,
  };
  layHands(mesh.geometry, d, nowM12());
  dials.push(d);
  return d;
}

let pruneAt = 0;
/** Once a frame from main.ts: the game's hour with its fraction (jobs.day.hourF, the HUD's time). */
export function setClockHands(hourF: number): void {
  const m = Math.floor(hourF * 60 + 1e-6);
  if (pending.length) resolveMarkers();
  if (m === gameMinute) return;
  gameMinute = m;
  const m12 = nowM12();
  let dead = false;
  for (const d of dials) {
    const g = d.geo.deref();
    if (!g) {
      dead = true;
      continue;
    }
    if (d.shows !== m12) layHands(g, d, m12);
  }
  if (dead || ++pruneAt % 600 === 0) {
    for (let i = dials.length - 1; i >= 0; i--) if (!dials[i].geo.deref() || !dials[i].mesh.deref()) dials.splice(i, 1);
  }
}

// ---------------------------------------------------------------- model files: clock_face_* markers

interface Marker {
  name: string;
  /** The face in the file's space: where, out, up. */
  M: THREE.Matrix4;
  radius: number;
  style: string;
  minute?: number;
  hour?: number;
  width?: number;
  /** The file's meshes, nearest first: one of them, once the game has put it in place, carries the hands. */
  near: THREE.Mesh[];
  root: THREE.Object3D;
  since: number;
}
const pending: Marker[] = [];
const markersSeen: Array<{ name: string; hung: boolean; why?: string }> = [];

let towerMats: Record<string, THREE.Material> | null = null;
/** Tower hands: the same psx kind as the landmarks' lead and gilt (world/city.ts), so no new shader. */
function towerMat(style: string): THREE.Material {
  towerMats ??= {
    iron: psx(new THREE.MeshLambertMaterial({ color: 0x141412, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
    gilt: psx(new THREE.MeshLambertMaterial({ color: 0xc8a040, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 }),
  };
  return towerMats[style] ?? towerMats.iron;
}

function scanMarkers(root: THREE.Object3D): void {
  const found: THREE.Object3D[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (/^clock_face/i.test(o.name)) found.push(o);
  });
  if (!found.length) return;
  // dials painted in the cathedral's atlas (tools/blender/build_landmarks.py: a dark face in a gilt ring) get gilt hands
  let cathAtlas = false;
  const meshes: Array<{ m: THREE.Mesh; c: THREE.Vector3 }> = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) if (mt.name === "cath_atlas") cathAtlas = true;
    m.geometry.computeBoundingBox();
    meshes.push({ m, c: m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld) });
  });
  for (const o of found) {
    const u = o.userData ?? {};
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const ax = new THREE.Matrix4().extractRotation(o.matrixWorld);
    const hasN = [u.nx, u.ny, u.nz].some((v) => typeof v === "number");
    const n = hasN ? new THREE.Vector3(+u.nx || 0, +u.ny || 0, +u.nz || 0) : new THREE.Vector3(0, 0, 1).applyMatrix4(ax);
    const up = hasN ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 1, 0).applyMatrix4(ax);
    const q = facing(n, up);
    const radius = +u.radius || 0.5;
    const lift = Math.max(0.006, radius * 0.03);
    const M = new THREE.Matrix4().compose(p.clone().addScaledVector(n.clone().normalize(), lift), q, new THREE.Vector3(1, 1, 1));
    const near = meshes
      .map((e) => ({ m: e.m, d: e.c.distanceTo(p) }))
      .sort((a, b) => a.d - b.d)
      .map((e) => e.m);
    const style = typeof u.style === "string" ? u.style : cathAtlas || /cathedral|hanze/i.test(o.name) ? "gilt" : "iron";
    pending.push({ name: o.name, M, radius, style, minute: u.minute, hour: u.hour, width: u.width, near, root, since: performance.now() });
  }
}

function isUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Markers whose model the game has put in place: hang their hands on the nearest part that left the file. */
function resolveMarkers(): void {
  for (let i = pending.length - 1; i >= 0; i--) {
    const k = pending[i];
    const anchor = k.near.find((m) => m.parent && !isUnder(m, k.root) && !(m.parent as THREE.LOD).isLOD);
    if (!anchor) {
      // the file's parts never left it (a model loaded for its pieces, cloned elsewhere): give up after a while
      if (performance.now() - k.since > 120_000) {
        markersSeen.push({ name: k.name, hung: false, why: "its model's parts never went into the scene" });
        pending.splice(i, 1);
      }
      continue;
    }
    // the part's own matrix is its place in the file (the loaders bake the file's frame into it, or into
    // the geometry with an identity matrix): the hands, its child, take the file's place of the face
    anchor.updateMatrix();
    const local = new THREE.Matrix4().copy(anchor.matrix).invert().multiply(k.M);
    const mesh = new THREE.Mesh(handsGeometry(), towerMat(k.style));
    local.decompose(mesh.position, mesh.quaternion, mesh.scale);
    place(mesh, { radius: k.radius, minute: k.minute, hour: k.hour, width: k.width ?? 0.14, kind: `${k.style === "gilt" ? "gilt" : "iron"} hands on a model's dial`, where: `${anchor.name || "a model"} (${k.name})` }, "model");
    anchor.add(mesh);
    markersSeen.push({ name: k.name, hung: true });
    pending.splice(i, 1);
  }
}

// Every model file goes through GLTFLoader.parse (load, loadAsync and parse of a fetched buffer): look for
// clock markers there, before the loader's own code takes the meshes out of the file.
{
  type Parse = (this: unknown, data: unknown, path: unknown, onLoad: (g: { scene: THREE.Object3D }) => void, onError?: unknown) => void;
  const proto = GLTFLoader.prototype as unknown as { parse: Parse; __clockHook?: boolean };
  if (!proto.__clockHook) {
    proto.__clockHook = true;
    const parse = proto.parse;
    proto.parse = function (data, path, onLoad, onError) {
      return parse.call(
        this,
        data,
        path,
        (gltf: { scene: THREE.Object3D }) => {
          try {
            scanMarkers(gltf.scene);
          } catch (e) {
            console.warn("clock markers:", e);
          }
          onLoad(gltf);
        },
        onError,
      );
    };
  }
}

// ---------------------------------------------------------------- the dev check

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

/**
 * Dev (__scheldemist.clocks()): every clock face with live hands in the scene, the rooms and the halls:
 * where, what, whether it is in the scene and shown, the time it shows against the game's (12 hours), and
 * whether its hands lie on a face (a ray from in front of it meets its own model within 10 cm behind them).
 */
export function clockReport(scene: THREE.Scene, hourF?: number): {
  game: string;
  total: number;
  running: number;
  problems: string[];
  markers: { hung: string[]; pending: string[]; failed: string[] };
  byKind: Record<string, number>;
  list: Array<{ kind: string; where: string; at: [number, number, number]; facing: [number, number, number]; radius: number; inScene: boolean; shown: boolean; shows: string; offBy: number; running: boolean; onFace: boolean | null }>;
} {
  // the game's time now (the HUD's), not the last minute the frame laid: a tab that draws no frames shows it
  const now = hourF === undefined ? (gameMinute < 0 ? IDLE_MINUTE : gameMinute) : Math.floor(hourF * 60 + 1e-6);
  const m12 = now % 720;
  const list: ReturnType<typeof clockReport>["list"] = [];
  const problems: string[] = [];
  const byKind: Record<string, number> = {};
  const ray = new THREE.Raycaster();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (const d of dials) {
    const mesh = d.mesh.deref();
    if (!mesh) continue;
    let top: THREE.Object3D = mesh;
    let shown = true;
    for (let o: THREE.Object3D | null = mesh; o; o = o.parent) {
      top = o;
      if (!o.visible) shown = false;
    }
    const inScene = top === scene || (top as THREE.Scene).isScene === true;
    let where = d.where;
    if (!where) for (let o: THREE.Object3D | null = mesh.parent; o && !where; o = o.parent) if (o.name && !/^clock/.test(o.name)) where = o.name;
    mesh.updateWorldMatrix(true, false);
    p.setFromMatrixPosition(mesh.matrixWorld);
    n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
    // on its face: from 20 cm in front, along the face's normal backwards, the first thing that is not the hands
    let onFace: boolean | null = null;
    let why = "";
    const host = mesh.parent?.parent ?? mesh.parent;
    if (host) {
      host.updateMatrixWorld(true);
      ray.set(p.clone().addScaledVector(n, 0.2), n.clone().negate());
      ray.far = 0.2 + 0.1 + d.radius * 0.1;
      const solid: THREE.Object3D[] = [];
      host.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && o !== mesh && !o.userData.liveClock) solid.push(o);
      });
      const hits = ray.intersectObjects(solid, false);
      onFace = hits.length > 0 && hits[0].distance >= 0.2 - 0.002;
      if (!onFace) why = hits.length ? ` (the first thing behind them ${(hits[0].distance - 0.2).toFixed(3)} m from them: ${hits[0].object.name || (hits[0].object as THREE.Mesh).geometry?.type})` : " (nothing behind them)";
    }
    const off = Math.min((d.shows - m12 + 720) % 720, (m12 - d.shows + 720) % 720);
    const running = d.shows >= 0 && off <= 1;
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    const e = { kind: d.kind, where: where || "?", at: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] as [number, number, number], facing: [+n.x.toFixed(2), +n.y.toFixed(2), +n.z.toFixed(2)] as [number, number, number], radius: +d.radius.toFixed(3), inScene, shown, shows: hm(d.shows < 0 ? 0 : d.shows), offBy: off, running, onFace };
    list.push(e);
    if (!running) problems.push(`${e.kind} at ${e.where} shows ${e.shows}, the game says ${hm(m12)}`);
    if (onFace === false) problems.push(`${e.kind} at ${e.where} (${e.at.join(", ")}): its hands do not lie on a face${why}`);
  }
  if (now !== gameMinute) problems.push(`the hands were last laid at ${hm(Math.max(0, gameMinute))}: no frame since (a hidden tab: t.run(1) first)`);
  for (const k of pending) problems.push(`marker ${k.name} not hung yet`);
  for (const k of markersSeen) if (!k.hung) problems.push(`marker ${k.name}: ${k.why}`);
  return {
    game: `${hm(now)} (${hm(m12)} on a dial)`,
    total: list.length,
    running: list.filter((e) => e.running).length,
    problems,
    markers: { hung: markersSeen.filter((k) => k.hung).map((k) => k.name), pending: pending.map((k) => k.name), failed: markersSeen.filter((k) => !k.hung).map((k) => k.name) },
    byKind,
    list,
  };
}
