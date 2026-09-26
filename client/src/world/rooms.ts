import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { makeTextures, signTexture, glowTexture } from "./textures";
import { createFires, type Fires } from "./fire";
import type { HomeRoom } from "./homeRooms";
import type { Rect } from "../../../shared/hallPlan";
import { SILL, type HousePlan } from "../../../shared/housePlan";

// Rooms you walk into (M6): a tavern's taproom and the Poesje's cellar, built in code in the
// PS1 way (a few boxes, painted 64 px textures, lamp and fire light). M7: each stands inside its
// own city house (shared/housePlan.ts; world/houseInWorld.ts puts it in the world): the room's frame
// is the house's (the door at the origin on the front face, +z into the house, x across), its scene is
// drawn over the street through the door and the windows, and walked by the plan. Nothing here is the
// server's: people come from the town.

export interface Spot {
  x: number;
  z: number;
  /** The way a person there faces (atan2(dx, dz), the humans' convention). */
  yaw: number;
}
export interface Seat extends Spot {
  /** Which table (or bench row) it belongs to. */
  table: number;
  /** The way in from the room's aisle to the seat (room frame), last point next to it. */
  via: Array<[number, number]>;
  /** Seat height (m). */
  h: number;
}

export interface Stage {
  /** Where the puppets hang (room frame), feet height, and the curtain to open (0 shut .. 1 open). */
  spots: Spot[];
  feetY: number;
  setCurtain(open: number): void;
}

export interface Room {
  /** M7 shops: "shop", a shop's ground floor (world/shopRooms.ts). */
  kind: "tavern" | "cellar" | "home" | "landmark" | "shop";
  scene: THREE.Scene;
  group: THREE.Group;
  /** Keep a walker of radius 0.3 inside and off the furniture (room frame). */
  walk(fx: number, fz: number, x: number, z: number): [number, number];
  seats: Seat[];
  /** For those who stand (women in skirts, the aproned, the overflow). */
  stands: Spot[];
  /** M7 shops: where the keeper's wife or helper stands behind the counter (the keeper at `keeper`). */
  serve?: Spot[];
  keeper?: Spot;
  counter?: Spot;
  fire?: Spot;
  /** Just inside the door: E goes out. And where Jef comes in. */
  exit: Spot;
  entry: Spot;
  stage?: Stage;
  /** M6 homes: the rented room's grid, its pieces and the ghost of the one Jef moves (world/homeRooms.ts). */
  home?: HomeRoom;
  /**
   * M6 landmark interiors (world/landmarkRooms.ts): the floor's height (stairs, a raised choir),
   * the walking pace and eye height in a tall hall, the steps' sound, and the room's sound.
   */
  floor?(x: number, z: number): number;
  pace?: number;
  eye?: number;
  surface?: "stone" | "wood";
  sound?: string;
  /** Lamp and fire points (world) and their brightness now, for the psx glow in the smoke. */
  lamps: Array<{ p: THREE.Vector3; w: number }>;
  /** Room frame -> world. */
  toWorld(x: number, z: number, y?: number): THREE.Vector3;
  /** M7 in the world: world -> room frame. */
  toLocal?(wx: number, wz: number): [number, number];
  /** M7 in the world: the furniture that stops walking (the house's frame), on this storey of the plan; where Jef may not go. */
  solids?: Rect[];
  level?: number;
  jefOnly?: Rect[];
  /** M7 in the world: dimmer from the bright street by day (1 inside). */
  setAmbient?(k: number): void;
  /** M7 in the world: the lamps and the fire lit (1) or out (0: a tavern shut for the night, only the embers). */
  setLamps?(k: number): void;
  /** Daylight at the windows, 0 (night) .. 1 (noon). */
  setDaylight(k: number): void;
  update(t: number, dt: number): void;
}

// ---------------------------------------------------------------- paint

export function canvasTex(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  paint(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Lime plaster gone yellow with smoke: blotches, soot toward the top, scuffs toward the floor. */
export function plaster(seed: number, base: [number, number, number]): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(64, 64, (g) => {
    g.fillStyle = `rgb(${base.join(",")})`;
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 90; i++) {
      const v = (r() - 0.5) * 30;
      g.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v * 0.8},0.35)`;
      g.fillRect(r() * 64, r() * 64, 3 + r() * 9, 2 + r() * 7);
    }
    for (let y = 0; y < 64; y++) {
      g.fillStyle = `rgba(20,14,8,${Math.max(0, 0.35 - y / 64) * 0.9})`;
      g.fillRect(0, y, 64, 1);
    }
    // M7 shops (the lead, 2026-09-26): thin water stains lower down, not dark bars hanging from the top edge (nearest
    // filtered and of every length, those read as a staircase along the ceiling in every room)
    for (let i = 0; i < 10; i++) {
      g.fillStyle = "rgba(40,30,20,0.12)";
      g.fillRect(r() * 64, 18 + r() * 30, 1, 6 + r() * 12);
    }
  });
}

function cloth(color: string, folds = 6): THREE.CanvasTexture {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = color;
    g.fillRect(0, 0, 32, 32);
    for (let i = 0; i < folds; i++) {
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(((i + 0.5) * 32) / folds, 0, 2, 32);
      g.fillStyle = "rgba(255,230,200,0.12)";
      g.fillRect(((i + 0.5) * 32) / folds - 2, 0, 1, 32);
    }
    g.fillStyle = "rgba(210,170,60,0.8)";
    g.fillRect(0, 28, 32, 2);
  });
}

/** The painted backcloth of the puppet stage: the town on the Schelde with the cathedral spire. */
function backdrop(): THREE.CanvasTexture {
  return canvasTex(128, 64, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 44);
    sky.addColorStop(0, "#40506a");
    sky.addColorStop(1, "#8a8f86");
    g.fillStyle = sky;
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = "#2c2a2e";
    // the spire
    g.fillRect(84, 8, 8, 36);
    g.beginPath();
    g.moveTo(84, 8);
    g.lineTo(88, -2);
    g.lineTo(92, 8);
    g.fill();
    // gables
    for (let x = 0; x < 128; x += 14) {
      const h = 18 + ((x * 7) % 11);
      g.fillStyle = x % 28 ? "#4a3a30" : "#5a4636";
      g.fillRect(x, 44 - h, 13, h);
      g.beginPath();
      g.moveTo(x, 44 - h);
      g.lineTo(x + 6.5, 44 - h - 7);
      g.lineTo(x + 13, 44 - h);
      g.fill();
      g.fillStyle = "#d8b060";
      g.fillRect(x + 4, 44 - h + 5, 2, 3);
    }
    // the river and a sail
    g.fillStyle = "#3a4a52";
    g.fillRect(0, 44, 128, 20);
    g.fillStyle = "#c8c0a8";
    g.beginPath();
    g.moveTo(30, 52);
    g.lineTo(38, 36);
    g.lineTo(38, 52);
    g.fill();
    g.fillStyle = "#2a2018";
    g.fillRect(24, 52, 20, 3);
  }, false);
}

/** The proscenium front of the puppet booth: dark red boards, a gilt frame, a painted name. */
function boothFront(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = "#5a1a14";
    g.fillRect(0, 0, 64, 64);
    for (let x = 0; x < 64; x += 8) {
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(x, 0, 1, 64);
    }
    g.strokeStyle = "#b08a3a";
    g.lineWidth = 2;
    g.strokeRect(3, 3, 58, 58);
    g.fillStyle = "rgba(176,138,58,0.7)";
    for (let i = 0; i < 6; i++) g.fillRect(10 + i * 9, 30, 4, 4);
  });
}

/** A vogelpik board, the Flemish darts: rings and numbers. */
function vogelpik(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.fillStyle = "#2a2018";
    g.fillRect(0, 0, 64, 64);
    const rings = ["#e0d6c0", "#1a1a1a", "#b0302a", "#e0d6c0", "#1a1a1a", "#b0302a"];
    rings.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(32, 32, 28 - i * 4.5, 0, Math.PI * 2);
      g.fill();
    });
    g.fillStyle = "#e0d6c0";
    g.font = "bold 7px Georgia";
    g.textAlign = "center";
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.fillText(String([20, 1, 18, 4, 13, 6, 10, 15][i]), 32 + Math.sin(a) * 24, 34 - Math.cos(a) * 24);
    }
  }, false);
}

// ---------------------------------------------------------------- building blocks

const mats = new Map<string, THREE.Material>();
export function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}
export const lambert = (key: string, o: THREE.MeshLambertMaterialParameters, affine = 0.4) => mat(key, () => psx(new THREE.MeshLambertMaterial(o), { affine }));

let texCache: ReturnType<typeof makeTextures> | null = null;
export const tex = () => (texCache ??= makeTextures());

/** A box whose texture tiles by its size (`tile` metres a repeat). */
export function boxGeo(w: number, h: number, d: number, tile = 1): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  // faces +x, -x, +y, -y, +z, -z; four vertices each
  const size: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * size[f][0]) / tile, (uv.getY(i) * size[f][1]) / tile);
    }
  return g;
}

export class Builder {
  readonly boxes: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  constructor(readonly group: THREE.Group) {}
  /** A box by its centre; `solid` adds it to the walk blocks. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, opts: { tile?: number; solid?: boolean; ry?: number } = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(boxGeo(w, h, d, opts.tile ?? 1), m);
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    this.group.add(mesh);
    if (opts.solid) {
      const rw = opts.ry ? Math.abs(Math.cos(opts.ry)) * w + Math.abs(Math.sin(opts.ry)) * d : w;
      const rd = opts.ry ? Math.abs(Math.sin(opts.ry)) * w + Math.abs(Math.cos(opts.ry)) * d : d;
      this.boxes.push({ minX: x - rw / 2, maxX: x + rw / 2, minZ: z - rd / 2, maxZ: z + rd / 2 });
    }
    return mesh;
  }
  cyl(r: number, h: number, x: number, y: number, z: number, m: THREE.Material, solid = false, seg = 8): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    if (solid) this.boxes.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r });
    return mesh;
  }
  plane(w: number, h: number, x: number, y: number, z: number, ry: number, m: THREE.Material): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.group.add(mesh);
    return mesh;
  }
  /** A barrel: a bulging stave cylinder with two dark hoops. */
  barrel(x: number, y: number, z: number, lying = false, solid = true): void {
    const g = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10);
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const k = 1 + 0.12 * (1 - (pos.getY(i) / 0.4) ** 2);
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i), pos.getZ(i) * k);
    }
    g.computeVertexNormals();
    const b = new THREE.Mesh(g, lambert("barrel", { map: tex().planks, color: 0x9a7a58 }));
    b.position.set(x, y, z);
    if (lying) b.rotation.z = Math.PI / 2;
    this.group.add(b);
    for (const s of [-0.24, 0.24]) {
      const hoop = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.05, 10, 1, true), lambert("hoop", { color: 0x2a2622, side: THREE.DoubleSide }));
      hoop.position.set(lying ? x + s : x, lying ? y : y + s, z);
      if (lying) hoop.rotation.z = Math.PI / 2;
      this.group.add(hoop);
    }
    if (solid) this.boxes.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
  }
}

/** A hanging oil lamp: a chain, a brass font, a glass chimney that glows; with its light. */
export function hangingLamp(b: Builder, x: number, y: number, z: number, top: number, lights: THREE.PointLight[], glows: THREE.Sprite[]): void {
  b.cyl(0.012, top - y - 0.15, x, (top + y + 0.15) / 2, z, lambert("iron", { color: 0x1c1a18 }), false, 4);
  b.cyl(0.09, 0.1, x, y, z, lambert("brass", { color: 0x8a6a2a }), false, 8);
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.18, 6), mat("lampglass", () => new THREE.MeshBasicMaterial({ color: 0xffd490 })));
  glass.position.set(x, y + 0.14, z);
  b.group.add(glass);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb060, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
  glow.scale.set(0.9, 0.9, 1);
  glow.position.set(x, y + 0.14, z);
  b.group.add(glow);
  glows.push(glow);
  const l = new THREE.PointLight(0xffb070, 8, 10, 1.5);
  l.position.set(x, y + 0.1, z);
  b.group.add(l);
  lights.push(l);
}

export function frameRoom(origin: { x: number; z: number }, yaw: number, fog: number): { scene: THREE.Scene; group: THREE.Group; toWorld: Room["toWorld"]; toLocal: (wx: number, wz: number) => [number, number] } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fog);
  scene.fog = new THREE.Fog(fog, 3.5, 20);
  const group = new THREE.Group();
  group.position.set(origin.x, 0, origin.z);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  scene.add(group);
  const toWorld = (x: number, z: number, y = 0) => group.localToWorld(new THREE.Vector3(x, y, z));
  const toLocal = (wx: number, wz: number): [number, number] => {
    const v = group.worldToLocal(new THREE.Vector3(wx, 0, wz));
    return [v.x, v.z];
  };
  return { scene, group, toWorld, toLocal };
}

// ---------------------------------------------------------------- walls with holes (M7 in the world)

/** A hole in a wall face: s along the face from its start, heights (world y of the room's frame). */
export type FaceHole = { s0: number; s1: number; y0: number; y1: number };

/**
 * M7: an inner wall face (one plane, facing into the room) from a to c along the floor, y0..y1, with holes
 * left out (a grid of rectangles split at the holes' edges). Texture in metres (`tile` a repeat).
 */
export function wallFace(group: THREE.Group, a: [number, number], c: [number, number], y0: number, y1: number, inward: [number, number], holes: FaceHole[], m: THREE.Material, tile = 2.4): THREE.Mesh | null {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (L < 0.01 || y1 - y0 < 0.01) return null;
  const tx = (c[0] - a[0]) / L;
  const tz = (c[1] - a[1]) / L;
  const hs = holes.filter((h) => h.s1 > 0 && h.s0 < L && h.y1 > y0 && h.y0 < y1);
  const xs = [...new Set([0, L, ...hs.flatMap((h) => [h.s0, h.s1]).filter((v) => v > 0 && v < L)])].sort((p, q) => p - q);
  const ys = [...new Set([y0, y1, ...hs.flatMap((h) => [h.y0, h.y1]).filter((v) => v > y0 && v < y1)])].sort((p, q) => p - q);
  const pos: number[] = [];
  const uv: number[] = [];
  // the winding so that the face looks along `inward`
  const flip = tx * inward[1] - tz * inward[0] < 0;
  for (let i = 0; i + 1 < xs.length; i++)
    for (let j = 0; j + 1 < ys.length; j++) {
      const s0 = xs[i];
      const s1 = xs[i + 1];
      const ya = ys[j];
      const yb = ys[j + 1];
      const sm = (s0 + s1) / 2;
      const ym = (ya + yb) / 2;
      if (hs.some((h) => sm > h.s0 && sm < h.s1 && ym > h.y0 && ym < h.y1)) continue;
      const P = (s: number, y: number) => [a[0] + tx * s, y, a[1] + tz * s];
      const quad = [P(s0, ya), P(s1, ya), P(s1, yb), P(s0, ya), P(s1, yb), P(s0, yb)];
      const quv = [[s0, ya], [s1, ya], [s1, yb], [s0, ya], [s1, yb], [s0, yb]];
      const order = flip ? [0, 2, 1, 3, 5, 4] : [0, 1, 2, 3, 4, 5];
      for (const k of order) {
        pos.push(...quad[k]);
        uv.push(quv[k][0] / tile, quv[k][1] / tile);
      }
    }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, m);
  group.add(mesh);
  return mesh;
}

/** The holes of a house's windows on one face of a room (local x or z along it from `from`), with the door's. */
export function holesOn(plan: HousePlan, face: "front" | "minX" | "maxX", from: number, door: boolean): FaceHole[] {
  const out: FaceHole[] = [];
  for (const w of plan.windows) {
    if (w.kind !== "hole") continue;
    const f = w.out[1] < -0.5 ? "front" : w.out[0] > 0.5 ? "maxX" : w.out[0] < -0.5 ? "minX" : null;
    if (f !== face) continue;
    const [a, b] = face === "front" ? [w.a[0], w.b[0]] : [w.a[1], w.b[1]];
    out.push({ s0: Math.min(a, b) - from, s1: Math.max(a, b) - from, y0: w.y0, y1: w.y1 });
  }
  if (door) {
    const hw = plan.door.w / 2;
    out.push({ s0: -hw - from, s1: hw - from, y0: -1, y1: plan.door.yt });
  }
  return out;
}

/**
 * M7: a wall face beside a flight (along z at x), from the floor yb up to a top that slopes from yA at zA to
 * yB at zB, facing along x by the sign of inward. Two triangles.
 */
function slopedWall(group: THREE.Group, x: number, zA: number, zB: number, yb: number, yA: number, yB: number, inward: number, m: THREE.Material): void {
  const pts = [
    [x, yb, zA], [x, yb, zB], [x, yB, zB],
    [x, yb, zA], [x, yB, zB], [x, yA, zA],
  ];
  if (inward > 0) [pts[1], pts[2], pts[4], pts[5]] = [pts[2], pts[1], pts[5], pts[4]];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(pts.flatMap((q) => [q[2] / 0.9, q[1] / 0.9]), 2));
  g.computeVertexNormals();
  group.add(new THREE.Mesh(g, m));
}

/** Draw a group of still things as one mesh per material; its lights and glows move to `into` (M6 homes, M7 all rooms). */
export function mergeStatic(stat: THREE.Group, into: THREE.Group): void {
  stat.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(stat.matrixWorld).invert();
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const move: THREE.Object3D[] = [];
  const rel = new THREE.Matrix4();
  stat.traverse((o) => {
    if (o === stat) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !Array.isArray(m.material)) {
      rel.multiplyMatrices(inv, m.matrixWorld);
      let geo = m.geometry.clone().applyMatrix4(rel);
      if (geo.index) geo = geo.toNonIndexed();
      for (const k of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(k)) geo.deleteAttribute(k);
      if (!geo.getAttribute("normal")) geo.computeVertexNormals();
      if (!geo.getAttribute("uv")) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
      const list = by.get(m.material) ?? [];
      list.push(geo);
      by.set(m.material, list);
    } else if ((o as THREE.Sprite).isSprite || (o as THREE.Light).isLight) move.push(o);
  });
  for (const o of move) into.attach(o);
  for (const ch of [...stat.children]) stat.remove(ch);
  for (const [m, geos] of by) {
    const merged = mergeGeometries(geos, false);
    if (merged) stat.add(new THREE.Mesh(merged, m));
  }
}

/** Builder boxes as plan rects. */
export function rectsOf(boxes: Builder["boxes"]): Rect[] {
  return boxes.map((q) => ({ minX: q.minX, maxX: q.maxX, minZ: q.minZ, maxZ: q.maxZ }));
}

export function flicker(t: number, seed: number): number {
  return 0.9 + Math.sin(t * 7.3 + seed) * 0.04 + Math.sin(t * 17.1 + seed * 3) * 0.03 + Math.sin(t * 2.1 + seed) * 0.03;
}

/** A room's lights that dim from the bright street by day (the eye comes in from outside). */
export function ambientOf(hemi: THREE.HemisphereLight, amb: THREE.AmbientLight): (k: number) => void {
  const h0 = hemi.intensity;
  const a0 = amb.intensity;
  return (k) => {
    hemi.intensity = h0 * k;
    amb.intensity = a0 * k;
  };
}

// ---------------------------------------------------------------- the taproom

/**
 * M7: a taproom in its own house (shared/housePlan.ts): the ground floor behind the street door, under a
 * beamed ceiling. The counter along the side wall nearer the door, the keeper behind it, shelves of bottles
 * and the tavern's name over them; a rack of barrels in the back corner; the fireplace in the back wall;
 * tables with benches along the far wall, the first by the front window; stools at the counter; a vogelpik
 * board. The walls stand 0.2 m inside the house's faces with the window holes of the house (the street
 * shows through them). `seed` varies the plaster and the tint a little from tavern to tavern.
 */
export function buildTavern(opts: { plan: HousePlan; label: string; seed: number }): Room {
  const p = opts.plan;
  const I = p.room.rect;
  const F = p.room.y;
  const H = 3.2;
  const { scene, group, toWorld, toLocal } = frameRoom(p.origin, p.yaw, 0x1a130d);
  scene.background = null;
  // everything that never moves is built into `stat` and drawn merged by material at the end
  const stat = new THREE.Group();
  group.add(stat);
  const b = new Builder(stat);
  const r = rand(opts.seed);
  const tint: [number, number, number] = [150 + r() * 30, 132 + r() * 20, 96 + r() * 20];
  const wall = mat(`plaster${opts.seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(opts.seed, tint) }), { affine: 0.3 }));
  const floor = lambert("floor", { map: tex().planks, color: 0x8a7058 });
  const beam = lambert("beam", { map: tex().planks, color: 0x4a3626 });
  const wood = lambert("wood", { map: tex().planks, color: 0x7a5a3e });
  const dark = lambert("darkwood", { map: tex().planks, color: 0x3e2c1e });
  const brick = lambert("brick", { map: tex().brick, color: 0xb08a78 });
  const iron = lambert("iron", { color: 0x1c1a18 });
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = I;
  // the counter's side: the side wall nearer the door (x 0)
  const ns = x1 < -x0 ? 1 : -1;
  const nearW = ns > 0 ? x1 : x0;
  const farW = ns > 0 ? x0 : x1;
  const X = (d: number) => nearW - ns * d;
  const XF = (d: number) => farW + ns * d;
  const span = (a: number, c: number) => [Math.min(a, c), Math.max(a, c)] as const;
  const box = (xa: number, xb: number, y: number, h: number, za: number, zb: number, m: THREE.Material, o: { tile?: number; solid?: boolean } = {}) => {
    const [a, c] = span(xa, xb);
    return b.box(c - a, h, zb - za, (a + c) / 2, y + h / 2, (za + zb) / 2, m, o);
  };

  // floor, ceiling, the walls (the front and the street's side walls with their holes)
  box(x0, x1, F - 0.1, 0.1, z0, z1, floor, { tile: 1.4 });
  box(x0, x1, F + H, 0.1, z0, z1, dark, { tile: 1.6 });
  wallFace(stat, [x0, z0], [x1, z0], F, F + H, [0, 1], holesOn(p, "front", x0, true), wall);
  wallFace(stat, [x0, z1], [x0, z0], F, F + H, [1, 0], holesOn(p, "minX", z1, false).map((h) => ({ ...h, s0: -h.s1, s1: -h.s0 })), wall);
  wallFace(stat, [x1, z0], [x1, z1], F, F + H, [-1, 0], holesOn(p, "maxX", z0, false), wall);
  wallFace(stat, [x1, z1], [x0, z1], F, F + H, [0, -1], [], wall);
  // beams across, and one along
  for (let z = z0 + 1.2; z < z1 - 0.3; z += 1.5) box(x0, x1, F + H - 0.22, 0.22, z - 0.1, z + 0.1, beam, { tile: 1.2 });
  box(-0.13, 0.13, F + H - 0.56, 0.26, z0, z1, beam, { tile: 1.2 });

  // the counter along the near wall, from 2.1 m in; the keeper behind it; a return to the wall at its front end
  const zc0 = z0 + 2.1;
  const zc1 = Math.max(zc0 + 2.4, Math.min(zc0 + 3.6, z1 - 2.6));
  const zcm = (zc0 + zc1) / 2;
  box(X(1.35), X(0.75), F, 1.02, zc0, zc1, wood, { tile: 0.9, solid: true });
  box(X(1.45), X(0.65), F + 1.02, 0.06, zc0 - 0.1, zc1 + 0.1, dark, { tile: 0.9 });
  box(X(1.39), X(1.33), F, 0.9, zc0, zc1, dark, { tile: 0.9 });
  box(X(0.75), nearW, F, 1.02, zc0, zc0 + 0.08, wood, { solid: true });
  const jefOnly = [{ minX: span(X(0.75), nearW)[0], maxX: span(X(0.75), nearW)[1], minZ: zc0 - 0.1, maxZ: zc1 + 0.9 }];
  // shelves of bottles on the near wall behind the keeper, where no window is; the name over them
  const nearWins = holesOn(p, ns > 0 ? "maxX" : "minX", 0, false).map((h) => [h.s0 - 0.15, h.s1 + 0.15] as const);
  const free: Array<[number, number]> = [];
  let s = zc0;
  for (const [a, c] of [...nearWins].sort((q, w) => q[0] - w[0])) {
    if (c < s || a > zc1) continue;
    if (a > s + 0.5) free.push([s, Math.min(a, zc1)]);
    s = Math.max(s, c);
  }
  if (zc1 > s + 0.5) free.push([s, zc1]);
  for (const [a, c] of free)
    for (const y of [1.3, 1.75]) {
      box(X(0.31), X(0.01), F + y - 0.02, 0.04, a, c, dark);
      for (let z = a + 0.15; z < c - 0.1; z += 0.27) {
        const green = r() < 0.5;
        b.cyl(0.04, 0.24, X(0.16), F + y + 0.14, z + r() * 0.05, lambert(green ? "bottleg" : "bottleb", { color: green ? 0x2c4a2a : 0x5a3a1a }), false, 6);
      }
    }
  const sign = new THREE.MeshBasicMaterial({ map: signTexture(opts.label.toUpperCase()), color: 0xb0a080 });
  const longest = free.sort((q, w) => w[1] - w[0] - (q[1] - q[0]))[0];
  if (longest && longest[1] - longest[0] > 2.0) b.plane(Math.min(2.6, longest[1] - longest[0] - 0.2), 0.33, X(0.02), F + 2.2, (longest[0] + longest[1]) / 2, ns > 0 ? -Math.PI / 2 : Math.PI / 2, sign);
  else b.plane(1.8, 0.28, 0, F + H - 0.2, z0 + 0.02, 0, sign);
  // barrels on a rack in the back corner on the near side, taps out
  box(X(1.3), nearW, F, 0.3, z1 - 1.9, z1, dark, { solid: true });
  for (const z of [z1 - 1.5, z1 - 0.75]) b.barrel(X(0.65), F + 0.62, z, true, false);
  b.barrel(X(0.65), F + 1.22, z1 - 1.12, true, false);

  // the fireplace in the back wall, between the rack and the far wall
  const fx = THREE.MathUtils.clamp((XF(0) + X(1.3)) / 2, Math.min(XF(1.1), X(2.4)), Math.max(XF(1.1), X(2.4)));
  for (const sgn of [-1, 1]) b.box(0.5, 0.95, 0.7, fx + sgn * 0.8, F + 0.475, z1 - 0.35, brick, { tile: 0.8 });
  b.box(2.1, 0.3, 0.7, fx, F + 1.1, z1 - 0.35, brick, { tile: 0.8 });
  b.plane(1.1, 0.95, fx, F + 0.475, z1 - 0.04, Math.PI, mat("hearth", () => new THREE.MeshBasicMaterial({ color: 0x0c0806 })));
  b.box(1.1, 0.04, 0.66, fx, F + 0.02, z1 - 0.35, mat("hearthstone", () => new THREE.MeshBasicMaterial({ color: 0x1a1410 })));
  b.box(2.4, 0.1, 0.85, fx, F + 1.3, z1 - 0.4, dark);
  b.box(1.5, H - 1.35, 0.5, fx, F + 1.35 + (H - 1.35) / 2, z1 - 0.25, brick, { tile: 0.8 });
  b.boxes.push({ minX: fx - 1.05, maxX: fx + 1.05, minZ: z1 - 0.75, maxZ: z1 });
  b.cyl(0.02, 0.5, fx - 0.25, F + 0.3, z1 - 0.45, iron, false, 4);
  b.cyl(0.02, 0.5, fx + 0.25, F + 0.3, z1 - 0.45, iron, false, 4);
  const fireWorld = toWorld(fx, z1 - 0.45, F + 0.12);
  const fires: Fires = createFires(scene, [{ x: fireWorld.x, y: fireWorld.y, z: fireWorld.z, size: 0.55 }]);

  // tables along the far wall, the first by the front window; benches either side
  const XA = (XF(2.27) + X(1.8)) / 2; // the aisle between the tables and the counter
  const seats: Seat[] = [];
  const tx = XF(1.25);
  let id = 0;
  for (let z = z0 + 1.45; z + 0.85 < z1 - 1.5; z += 3.0) {
    const [tw, td] = [0.8, 1.6];
    b.box(tw, 0.06, td, tx, F + 0.76, z, wood, { tile: 0.8 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.07, 0.74, 0.07, tx + dx * (tw / 2 - 0.1), F + 0.37, z + dz * (td / 2 - 0.1), dark);
    b.boxes.push({ minX: tx - tw / 2, maxX: tx + tw / 2, minZ: z - td / 2, maxZ: z + td / 2 });
    for (const sgn of [-1, 1]) {
      const bx = tx + sgn * 0.72;
      b.box(0.3, 0.05, 1.7, bx, F + 0.45, z, wood, { tile: 0.8 });
      b.box(0.25, 0.43, 0.06, bx, F + 0.215, z - 0.7, dark);
      b.box(0.25, 0.43, 0.06, bx, F + 0.215, z + 0.7, dark);
      for (const o of [-0.42, 0.42]) {
        const sz = z + o;
        // round the end of the bench nearest the seat (the far end when the near one is against the front wall)
        const zEnd = z + Math.sign(o) * 1.25 < z0 + 0.6 ? z + 1.25 : z + Math.sign(o) * 1.25;
        seats.push({ x: bx, z: sz, yaw: Math.atan2(tx - bx, 0), table: id, h: 0.47, via: [[XA, zEnd], [bx, zEnd]] });
      }
    }
    id++;
  }
  // stools at the counter
  const stoolZ = zc1 - zc0 > 3.2 ? [zc0 + 0.6, zcm, zc1 - 0.6] : [zc0 + 0.6, zc1 - 0.6];
  for (const z of stoolZ) {
    b.cyl(0.18, 0.05, X(1.8), F + 0.66, z, wood, false, 8);
    b.cyl(0.03, 0.64, X(1.8), F + 0.32, z, dark, false, 4);
    seats.push({ x: X(1.8), z, yaw: Math.atan2(ns, 0), table: 9, h: 0.68, via: [[XA, z]] });
  }
  // the vogelpik board on the far wall at the back, and its chalk line
  const farWins = holesOn(p, ns > 0 ? "minX" : "maxX", 0, false);
  const vz = z1 - 1.0;
  if (!farWins.some((h) => h.s0 - 0.5 < vz && h.s1 + 0.5 > vz)) {
    b.plane(0.5, 0.5, XF(0.02), F + 1.65, vz, ns > 0 ? Math.PI / 2 : -Math.PI / 2, mat("vogelpik", () => psx(new THREE.MeshLambertMaterial({ map: vogelpik() }), { affine: 0 })));
    box(XF(2.3), XF(2.34), F, 0.01, vz - 0.6, vz + 0.6, mat("chalk", () => new THREE.MeshBasicMaterial({ color: 0x6a665c })));
  }

  // light: two hanging lamps over the aisle, the fire, a low warm fill
  const lights: THREE.PointLight[] = [];
  const glows: THREE.Sprite[] = [];
  hangingLamp(b, XA, F + 2.35, z0 + (z1 - z0) * 0.33, F + H, lights, glows);
  hangingLamp(b, XA, F + 2.35, z0 + (z1 - z0) * 0.7, F + H, lights, glows);
  const fireLight = new THREE.PointLight(0xff8a40, 9, 8, 1.4);
  fireLight.position.set(fx, F + 0.8, z1 - 1.0);
  group.add(fireLight);
  const hemi = new THREE.HemisphereLight(0x7a5a44, 0x241810, 1.4);
  const amb = new THREE.AmbientLight(0x4a3624, 0.7);
  scene.add(hemi, amb);

  const face = (x: number, z: number, tx2: number, tz2: number) => Math.atan2(tx2 - x, tz2 - z);
  const stands: Spot[] = [
    { x: X(1.85), z: zc0 + 1.1, yaw: face(X(1.85), 0, nearW, 0) },
    { x: X(1.85), z: zc1 - 1.1, yaw: face(X(1.85), 0, nearW, 0) },
    { x: XA, z: z0 + 1.0, yaw: face(XA, z0 + 1.0, fx, z1) },
    { x: XA + ns * 0.3, z: zcm + 0.5, yaw: face(0, 0, ns, 0) },
    { x: fx + ns * 1.3, z: z1 - 1.35, yaw: face(fx + ns * 1.3, z1 - 1.35, fx, z1) },
    { x: XA - ns * 0.3, z: z1 - 2.0, yaw: face(0, 0, -ns, 0) },
    { x: XA, z: zc1 + 0.6, yaw: face(XA, zc1 + 0.6, X(1), zcm) },
    { x: X(1.9), z: zc0 - 0.5, yaw: face(0, 0, 0, 1) },
  ];
  const solids = rectsOf(b.boxes);
  mergeStatic(stat, group);
  let litK = 1;
  const lampPts = lights.map((l) => ({ l, p: new THREE.Vector3() }));
  const firePt = toWorld(fx, z1 - 0.6, F + 0.6);
  const room: Room = {
    kind: "tavern",
    scene,
    group,
    walk: (fx0, fz0) => [fx0, fz0],
    seats,
    stands,
    keeper: { x: X(0.4), z: zcm, yaw: face(0, 0, -ns, 0) },
    counter: { x: X(1.85), z: zcm, yaw: face(0, 0, ns, 0) },
    fire: { x: fx, z: z1 - 1.3, yaw: 0 },
    exit: { x: 0, z: z0 + 0.3, yaw: Math.PI },
    entry: { x: 0, z: z0 + 0.8, yaw: 0 },
    lamps: [],
    toWorld,
    toLocal,
    floor: () => F,
    solids,
    level: 0,
    jefOnly,
    setAmbient: ambientOf(hemi, amb),
    setLamps(k) {
      litK = k;
    },
    setDaylight() {},
    update(t) {
      fires.update(t);
      lights.forEach((l, i) => {
        const f = flicker(t, i * 5.1) * litK;
        l.intensity = 8 * f;
        glows[i].material.opacity = 0.75 * f;
      });
      const ff = flicker(t * 1.7, 9) * (0.85 + Math.sin(t * 11) * 0.08) * (0.15 + 0.85 * litK);
      fireLight.intensity = 9 * ff;
      room.lamps = [...lampPts.map(({ l, p: v }, i) => ({ p: l.getWorldPosition(v), w: 0.45 * flicker(t, i * 5.1) })), { p: firePt, w: 0.55 * ff }];
    },
  };
  room.update(0, 0);
  return room;
}

// ---------------------------------------------------------------- the Poesje's cellar

/**
 * M7: the puppet cellar under its house (shared/housePlan.ts): inside the street door a landing, a flight
 * down along the door's line into the brick cellar, benches in rows, and at the far end the booth: a red
 * and gilt front with an opening, a curtain that parts, a painted backcloth, footlights and a lamp. The
 * puppets hang at `stage.spots` (the house's frame, heights over the street).
 */
export function buildCellar(opts: { plan: HousePlan }): Room {
  const p = opts.plan;
  const I = p.room.rect;
  const FY = p.room.y;
  const CEIL = FY + 2.55;
  const { scene, group, toWorld, toLocal } = frameRoom(p.origin, p.yaw, 0x1a130e);
  scene.background = null;
  const stat = new THREE.Group();
  group.add(stat);
  const b = new Builder(stat);
  const brick = lambert("cellarbrick", { map: tex().brick, color: 0x9a7a6a });
  const flags = lambert("flags", { map: tex().cobble, color: 0x8a8278 });
  const wood = lambert("wood", { map: tex().planks, color: 0x7a5a3e });
  const dark = lambert("darkwood", { map: tex().planks, color: 0x3e2c1e });
  const stepM = lambert("step", { map: tex().slate, color: 0x807870 });
  const { minX: x0, maxX: x1, minZ: z0, maxZ: z1 } = I;
  const fl = p.flights[0];
  const lane = fl.rect;
  const land = p.landings[0].rect;
  const LY = SILL;
  const nearPlus = x1 - lane.maxX < lane.minX - x0;
  const hallEdge = nearPlus ? lane.minX : lane.maxX; // the lane's side toward the hall
  const nearEdge = nearPlus ? lane.maxX : lane.minX;
  const nearW = nearPlus ? x1 : x0;
  const span = (a: number, c: number) => [Math.min(a, c), Math.max(a, c)] as const;
  const box = (xa: number, xb: number, y: number, h: number, za: number, zb: number, m: THREE.Material, o: { tile?: number; solid?: boolean } = {}) => {
    const [a, c] = span(xa, xb);
    return b.box(c - a, h, zb - za, (a + c) / 2, y + h / 2, (za + zb) / 2, m, o);
  };
  const TOP = LY + 2.4;

  // the landing inside the street door: its floor, its walls, its ceiling
  box(land.minX, land.maxX, FY, LY - FY, z0, lane.minZ, flags, { tile: 1.2 });
  wallFace(stat, [land.minX, z0], [land.maxX, z0], LY, TOP, [0, 1], holesOn(p, "front", land.minX, true), brick, 0.9);
  const outerX = nearPlus ? land.minX : land.maxX;
  wallFace(stat, nearPlus ? [outerX, z0] : [outerX, lane.minZ], nearPlus ? [outerX, lane.minZ] : [outerX, z0], LY, TOP, [nearPlus ? 1 : -1, 0], [], brick, 0.9);
  box(land.minX, land.maxX, TOP, 0.1, z0, lane.minZ, dark);
  // the flight: steps, the wall on the near side up to the soffit, the soffit sloping down with the flight
  const n = fl.steps;
  const tread = (fl.foot - fl.head) / n;
  for (let i = 0; i < n; i++) {
    const zt = fl.head + tread * i;
    const yTop = LY - ((LY - FY) * (i + 1)) / n;
    box(lane.minX, lane.maxX, FY, yTop - FY, zt, zt + tread + 0.02, stepM, { tile: 0.6 });
  }
  const soffit = (z: number) => TOP - ((TOP - CEIL) * THREE.MathUtils.clamp((z - fl.head) / (fl.foot - fl.head), 0, 1));
  // the near side of the flight: a wall from the cellar floor up to the landing's ceiling, then the soffit
  const nearIn: [number, number] = [nearPlus ? -1 : 1, 0];
  wallFace(stat, nearPlus ? [nearEdge, lane.minZ] : [nearEdge, z0], nearPlus ? [nearEdge, z0] : [nearEdge, lane.minZ], FY, TOP, nearIn, [], brick, 0.9);
  slopedWall(stat, nearEdge, fl.head, fl.foot, FY, TOP, CEIL, nearIn[0], brick);
  // the soffit over the flight, sloping down with it to the cellar's ceiling at its foot
  const sofM = mat("cellarsoffit", () => psx(new THREE.MeshLambertMaterial({ map: tex().planks, color: 0x3e2c1e, side: THREE.DoubleSide }), { affine: 0.3 }));
  const sof = new THREE.Mesh(new THREE.PlaneGeometry(lane.maxX - lane.minX, Math.hypot(fl.foot - fl.head, TOP - CEIL)), sofM);
  sof.position.set((lane.minX + lane.maxX) / 2, (TOP + CEIL) / 2 + soffit(0) * 0, (fl.head + fl.foot) / 2);
  sof.rotation.x = Math.PI / 2 + Math.atan2(TOP - CEIL, fl.foot - fl.head);
  stat.add(sof);
  // the hall side: the landing's wall above the cellar's ceiling, and over the flight a wall from the ceiling to the soffit
  const hallIn: [number, number] = [nearPlus ? 1 : -1, 0];
  wallFace(stat, nearPlus ? [hallEdge, z0] : [hallEdge, lane.minZ], nearPlus ? [hallEdge, lane.minZ] : [hallEdge, z0], CEIL, TOP, hallIn, [], brick, 0.9);
  slopedWall(stat, hallEdge, fl.head, fl.foot, CEIL, TOP, CEIL, hallIn[0], brick);
  // a rail on posts along the steps on the hall side
  const railAt = (z: number) => LY - ((LY - FY) * (z - fl.head)) / (fl.foot - fl.head) + 0.95;
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, Math.hypot(fl.foot - fl.head, LY - FY)), dark);
  rail.position.set(hallEdge, (railAt(fl.head) + railAt(fl.foot)) / 2, (fl.head + fl.foot) / 2);
  rail.rotation.x = Math.atan2(LY - FY, fl.foot - fl.head);
  stat.add(rail);
  for (let z = fl.head + 0.8; z < fl.foot; z += 0.8) box(hallEdge - 0.025, hallEdge + 0.025, railAt(z) - 0.95, 0.95, z - 0.025, z + 0.025, dark);

  // the cellar hall: floor, walls, a flat brick ceiling on arches (not over the flight)
  box(x0, x1, FY - 0.1, 0.1, z0, z1, flags, { tile: 1.2 });
  const hallX0 = nearPlus ? x0 : hallEdge;
  const hallX1 = nearPlus ? hallEdge : x1;
  wallFace(stat, [hallX0, z0], [hallX1, z0], FY, CEIL, [0, 1], [], brick, 0.9);
  wallFace(stat, [x0, z1], [x0, z0], FY, CEIL, [1, 0], [], brick, 0.9);
  wallFace(stat, [x1, z0], [x1, z1], FY, CEIL, [-1, 0], [], brick, 0.9);
  wallFace(stat, [x1, z1], [x0, z1], FY, CEIL, [0, -1], [], brick, 0.9);
  // the near slot beyond the flight's end is part of the hall; before it, the wall at the lane's near edge
  wallFace(stat, nearPlus ? [nearW, fl.foot] : [nearEdge, fl.foot], nearPlus ? [nearEdge, fl.foot] : [nearW, fl.foot], FY, CEIL, [0, 1], [], brick, 0.9);
  const ceilM = mat("cellarceil", () => psx(new THREE.MeshLambertMaterial({ map: tex().brick, color: 0x7a5a4a, side: THREE.DoubleSide }), { affine: 0.3 }));
  box(hallX0, hallX1, CEIL, 0.1, z0, fl.foot, ceilM, { tile: 0.9 });
  box(x0, x1, CEIL, 0.1, fl.foot, z1, ceilM, { tile: 0.9 });
  for (let z = fl.foot + 0.9; z < z1 - 0.3; z += 1.6) box(x0, x1, CEIL - 0.25, 0.25, z - 0.15, z + 0.15, brick, { tile: 0.9 });

  // the booth at the far end: a front with an opening 2.2 by 1.1, from 0.95 m up
  const BZ = z1 - 2.0;
  const OY0 = FY + 0.95;
  const OY1 = FY + 2.05;
  const cxB = (x0 + x1) / 2;
  const W = x1 - x0;
  const front = mat("booth", () => psx(new THREE.MeshLambertMaterial({ map: boothFront() }), { affine: 0.3 }));
  const side = (W - 2.2) / 2;
  b.box(side, 2.1, 0.1, x0 + side / 2, FY + 1.05, BZ, front, { tile: 1.1 });
  b.box(side, 2.1, 0.1, x1 - side / 2, FY + 1.05, BZ, front, { tile: 1.1 });
  b.box(2.2, 0.95, 0.1, cxB, FY + 0.475, BZ, mat("skirt", () => psx(new THREE.MeshLambertMaterial({ map: cloth("#3a2a4a", 8) }), { affine: 0.2 })), { tile: 1.1 });
  b.box(2.2, CEIL - OY1, 0.1, cxB, (OY1 + CEIL) / 2, BZ, front, { tile: 1.1 });
  b.boxes.push({ minX: x0, maxX: x1, minZ: BZ - 0.1, maxZ: z1 });
  const name = new THREE.MeshBasicMaterial({ map: signTexture("POESJE"), color: 0xc8a860 });
  b.plane(1.6, 0.22, cxB, OY1 + 0.2, BZ - 0.06, Math.PI, name);
  b.box(2.3, 0.05, 1.5, cxB, OY0 - 0.03, BZ + 0.75, dark);
  b.plane(2.3, 1.25, cxB, OY0 + 0.6, BZ + 1.45, Math.PI, mat("backdrop", () => psx(new THREE.MeshLambertMaterial({ map: backdrop() }), { affine: 0 })));
  const curtainMat = mat("curtain", () => psx(new THREE.MeshLambertMaterial({ map: cloth("#8a1a16", 5), side: THREE.DoubleSide }), { affine: 0.2 }));
  const curtains = [-1, 1].map((sgn) => ({ m: new Builder(group).plane(1.12, 1.12, cxB + sgn * 0.55, (OY0 + OY1) / 2, BZ + 0.08, Math.PI, curtainMat), s: sgn }));
  const flames: THREE.Sprite[] = [];
  for (const x of [-0.8, 0, 0.8]) {
    b.cyl(0.02, 0.1, cxB + x, OY0 + 0.02, BZ - 0.12, mat("candle", () => new THREE.MeshBasicMaterial({ color: 0xd8d0b8 })), false, 5);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.scale.set(0.18, 0.26, 1);
    f.position.set(cxB + x, OY0 + 0.13, BZ - 0.12);
    group.add(f);
    flames.push(f);
  }
  b.box(2.2, 0.06, 0.2, cxB, OY0 - 0.02, BZ - 0.12, dark);
  const footLight = new THREE.PointLight(0xffc070, 4.5, 5, 1.4);
  footLight.position.set(cxB, OY0 + 0.4, BZ - 0.5);
  group.add(footLight);

  // benches in rows, facing the booth, an aisle along the near wall to the flight's foot
  const aisleX = nearPlus ? x1 - 0.55 : x0 + 0.55;
  const bench0 = nearPlus ? x0 + 0.25 : aisleX + 0.45;
  const bench1 = nearPlus ? aisleX - 0.45 : x1 - 0.25;
  const seats: Seat[] = [];
  const foot: [number, number] = [(lane.minX + lane.maxX) / 2, fl.foot + 0.35];
  let row = 0;
  for (let z = BZ - 1.3; z > fl.foot + 0.6; z -= 1.0) {
    box(bench0, bench1, FY + 0.4, 0.05, z - 0.15, z + 0.15, wood, { tile: 0.8, solid: true });
    for (const x of [bench0 + 0.1, bench1 - 0.1]) box(x - 0.03, x + 0.03, FY, 0.4, z - 0.12, z + 0.12, dark);
    const k = Math.max(2, Math.floor((bench1 - bench0) / 0.85));
    for (let i = 0; i < k; i++) {
      const x = bench0 + ((i + 0.5) * (bench1 - bench0)) / k;
      seats.push({ x, z: z - 0.02, yaw: 0, table: row, h: 0.44, via: [foot, [aisleX, z - 0.55], [x, z - 0.55]] });
    }
    row++;
  }
  const stands: Spot[] = [
    { x: aisleX, z: BZ - 1.2, yaw: -0.3 * (nearPlus ? 1 : -1) },
    { x: aisleX, z: BZ - 2.4, yaw: -0.2 * (nearPlus ? 1 : -1) },
    { x: aisleX, z: BZ - 3.4, yaw: 0 },
    { x: (bench0 + bench1) / 2 - 0.5, z: fl.foot + 0.25, yaw: 0 },
    { x: (bench0 + bench1) / 2 + 0.5, z: fl.foot + 0.3, yaw: 0.1 },
    { x: nearPlus ? hallX0 + 0.5 : hallX1 - 0.5, z: z0 + 1.6, yaw: 0.2 },
  ];

  // light: a lamp over the rows, the footlights, a candle in a niche at the flight's foot, a lamp at the landing
  const lights: THREE.PointLight[] = [];
  const glows: THREE.Sprite[] = [];
  hangingLamp(b, (bench0 + bench1) / 2, FY + 1.75, (fl.foot + BZ) / 2, CEIL, lights, glows);
  const niche = new THREE.PointLight(0xffa860, 3, 6, 1.5);
  niche.position.set(foot[0], FY + 1.4, fl.foot + 0.2);
  group.add(niche);
  const landLamp = new THREE.PointLight(0xffa860, 2.2, 5, 1.5);
  landLamp.position.set(0, LY + 2.0, (z0 + lane.minZ) / 2);
  group.add(landLamp);
  const hemi = new THREE.HemisphereLight(0x6a5040, 0x1a120c, 1.5);
  const amb = new THREE.AmbientLight(0x3a2c20, 0.7);
  scene.add(hemi, amb);

  const solids = rectsOf(b.boxes);
  mergeStatic(stat, group);
  let curtain = 0;
  const footPt = toWorld(cxB, BZ - 0.3, OY0 + 0.3);
  const lampP = new THREE.Vector3();
  const room: Room = {
    kind: "cellar",
    scene,
    group,
    walk: (fx0, fz0) => [fx0, fz0],
    seats,
    stands,
    exit: { x: 0, z: z0 + 0.3, yaw: Math.PI },
    entry: { x: 0, z: z0 + 0.8, yaw: 0 },
    stage: {
      spots: [
        { x: cxB - 0.62, z: BZ + 0.55, yaw: Math.PI },
        { x: cxB + 0.62, z: BZ + 0.55, yaw: Math.PI },
        { x: cxB, z: BZ + 0.85, yaw: Math.PI },
      ],
      feetY: OY0 + 0.06,
      setCurtain(o) {
        curtain = Math.max(0, Math.min(1, o));
      },
    },
    lamps: [],
    toWorld,
    toLocal,
    floor(x, z) {
      if (x > lane.minX && x < lane.maxX && z > fl.head && z < fl.foot) return LY - ((LY - FY) * Math.ceil(((z - fl.head) / (fl.foot - fl.head)) * n)) / n;
      if (z < fl.head && x > land.minX && x < land.maxX) return LY;
      return FY;
    },
    solids,
    level: 1,
    setAmbient: ambientOf(hemi, amb),
    setDaylight() {},
    update(t, dt) {
      for (const c of curtains) {
        const target = cxB + c.s * (0.55 + curtain * 1.05);
        c.m.position.x += (target - c.m.position.x) * Math.min(1, dt * 3);
      }
      flames.forEach((f, i) => {
        const k = flicker(t * 1.3, i * 2.7);
        f.material.opacity = 0.85 * k;
        f.scale.y = 0.24 * k;
      });
      const k = flicker(t, 3.3);
      footLight.intensity = 4.5 * k;
      lights[0].intensity = 7 * flicker(t, 1.1);
      niche.intensity = 3 * flicker(t, 4.2);
      glows[0].material.opacity = 0.7 * flicker(t, 1.1);
      room.lamps = [
        { p: footPt, w: 0.35 * k },
        { p: lights[0].getWorldPosition(lampP), w: 0.4 * flicker(t, 1.1) },
      ];
    },
  };
  room.update(0, 0);
  return room;
}
