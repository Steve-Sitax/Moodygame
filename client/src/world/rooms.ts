import * as THREE from "three";
import { psx } from "../retro/psx";
import { makeTextures, signTexture, glowTexture } from "./textures";
import { createFires, type Fires } from "./fire";
import type { HomeRoom } from "./homeRooms";

// Rooms you walk into (M6): a tavern's taproom and the Poesje's cellar, built in code in the
// PS1 way (a few boxes, painted 64 px textures, lamp and fire light). Each room is its own
// small scene; game/interiors.ts puts it at the door it belongs to (the room's frame: the door
// at the origin, the room running along +z into the house, x across) and renders it instead
// of the street while Jef is inside. Nothing here is the server's: people come from the town.

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
  kind: "tavern" | "cellar" | "home" | "landmark";
  scene: THREE.Scene;
  group: THREE.Group;
  /** Keep a walker of radius 0.3 inside and off the furniture (room frame). */
  walk(fx: number, fz: number, x: number, z: number): [number, number];
  seats: Seat[];
  /** For those who stand (women in skirts, the aproned, the overflow). */
  stands: Spot[];
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
    for (let i = 0; i < 12; i++) {
      g.fillStyle = "rgba(40,30,20,0.25)";
      g.fillRect(r() * 64, 0, 1, 10 + r() * 30);
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

function walker(W: number, zMin: number, D: number, boxes: Builder["boxes"]): Room["walk"] {
  const R = 0.3;
  const free = (x: number, z: number) =>
    x > -W / 2 + R && x < W / 2 - R && z > zMin && z < D - R && !boxes.some((b) => x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R);
  return (fx, fz, x, z) => {
    if (free(x, z)) return [x, z];
    if (free(x, fz)) return [x, fz];
    if (free(fx, z)) return [fx, z];
    return [fx, fz];
  };
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

export function frameRoom(origin: { x: number; z: number }, yaw: number, fog: number): { scene: THREE.Scene; group: THREE.Group; toWorld: Room["toWorld"] } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(fog);
  scene.fog = new THREE.Fog(fog, 3.5, 20);
  const group = new THREE.Group();
  group.position.set(origin.x, 0, origin.z);
  group.rotation.y = yaw;
  group.updateMatrixWorld(true);
  scene.add(group);
  const toWorld = (x: number, z: number, y = 0) => group.localToWorld(new THREE.Vector3(x, y, z));
  return { scene, group, toWorld };
}

export function flicker(t: number, seed: number): number {
  return 0.9 + Math.sin(t * 7.3 + seed) * 0.04 + Math.sin(t * 17.1 + seed * 3) * 0.03 + Math.sin(t * 2.1 + seed) * 0.03;
}

// ---------------------------------------------------------------- the taproom

/**
 * A taproom, 8.4 by 10 m under a beamed ceiling: the counter on the right with the keeper
 * behind it, shelves of bottles and a rack of barrels; the fireplace in the back wall; three
 * tables with benches; two barrels by the door to stand at; a vogelpik board; two windows.
 * `seed` varies the plaster and the tint a little from tavern to tavern.
 */
export function buildTavern(opts: { origin: { x: number; z: number }; yaw: number; label: string; seed: number }): Room {
  const W = 8.4;
  const D = 10;
  const H = 2.85;
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x1a130d);
  const b = new Builder(group);
  const r = rand(opts.seed);
  const tint: [number, number, number] = [150 + r() * 30, 132 + r() * 20, 96 + r() * 20];
  const wall = mat(`plaster${opts.seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(opts.seed, tint) }), { affine: 0.3 }));
  const floor = lambert("floor", { map: tex().planks, color: 0x8a7058 });
  const beam = lambert("beam", { map: tex().planks, color: 0x4a3626 });
  const wood = lambert("wood", { map: tex().planks, color: 0x7a5a3e });
  const dark = lambert("darkwood", { map: tex().planks, color: 0x3e2c1e });
  const brick = lambert("brick", { map: tex().brick, color: 0xb08a78 });
  const iron = lambert("iron", { color: 0x1c1a18 });

  // floor, ceiling, walls (the front wall with the door gap and two windows)
  b.box(W, 0.1, D, 0, -0.05, D / 2, floor, { tile: 1.4 });
  b.box(W, 0.1, D, 0, H + 0.05, D / 2, dark, { tile: 1.6 });
  b.box(0.2, H, D, -W / 2 - 0.1, H / 2, D / 2, wall, { tile: 2.4 });
  b.box(0.2, H, D, W / 2 + 0.1, H / 2, D / 2, wall, { tile: 2.4 });
  b.box(W, H, 0.2, 0, H / 2, D + 0.1, wall, { tile: 2.4 });
  const front = (x0: number, x1: number, y0: number, y1: number) => b.box(x1 - x0, y1 - y0, 0.2, (x0 + x1) / 2, (y0 + y1) / 2, -0.1, wall, { tile: 2.4 });
  front(-W / 2, -2.2, 0, H);
  front(-2.2, -1.0, 0, 1.0);
  front(-2.2, -1.0, 2.0, H);
  front(-1.0, -0.6, 0, H);
  front(0.6, 1.0, 0, H);
  front(1.0, 2.2, 0, 1.0);
  front(1.0, 2.2, 2.0, H);
  front(2.2, W / 2, 0, H);
  front(-0.6, 0.6, 2.15, H);
  // the door (shut behind you), its frame and the windows' panes (their light follows the hour)
  b.box(1.2, 2.15, 0.06, 0, 1.075, -0.02, lambert("door", { map: tex().planks, color: 0x3a2a1c }));
  for (const x of [-0.63, 0.63]) b.box(0.08, 2.2, 0.12, x, 1.1, 0.02, beam);
  const pane = new THREE.MeshBasicMaterial({ color: 0x223040 });
  for (const x of [-1.6, 1.6]) {
    b.plane(1.1, 0.95, x, 1.5, -0.01, 0, pane);
    b.box(1.2, 0.06, 0.1, x, 1.0, 0.02, beam);
    b.box(0.05, 1.0, 0.06, x, 1.5, 0.01, dark);
    b.box(1.1, 0.05, 0.06, x, 1.5, 0.01, dark);
  }
  // beams across, and one along
  for (let z = 1.2; z < D; z += 1.5) b.box(W, 0.22, 0.2, 0, H - 0.11, z, beam, { tile: 1.2 });
  b.box(0.26, 0.26, D, 0, H - 0.3, D / 2, beam, { tile: 1.2 });

  // the counter on the right, the keeper behind it
  const cx0 = 2.15;
  b.box(0.6, 1.02, 4.2, cx0 + 0.3, 0.51, 5.3, wood, { tile: 0.9, solid: true });
  b.box(0.8, 0.06, 4.4, cx0 + 0.3, 1.05, 5.3, dark, { tile: 0.9 });
  b.box(0.08, 0.9, 4.2, cx0 - 0.02, 0.45, 5.3, dark, { tile: 0.9 });
  // shelves of bottles on the right wall, and the painted name over them
  for (const y of [1.3, 1.75]) {
    b.box(0.3, 0.04, 3.4, W / 2 - 0.16, y, 5.3, dark);
    for (let i = 0; i < 12; i++) {
      const z = 3.8 + i * 0.27 + r() * 0.05;
      const green = r() < 0.5;
      b.cyl(0.04, 0.24, W / 2 - 0.16, y + 0.14, z, lambert(green ? "bottleg" : "bottleb", { color: green ? 0x2c4a2a : 0x5a3a1a }), false, 6);
    }
  }
  const sign = new THREE.MeshBasicMaterial({ map: signTexture(opts.label.toUpperCase()), color: 0xb0a080 });
  b.plane(2.6, 0.33, W / 2 - 0.02, 2.2, 5.3, -Math.PI / 2, sign);
  // barrels on a rack in the back-right corner, taps out
  b.box(1.2, 0.3, 1.8, W / 2 - 0.65, 0.15, D - 1.2, dark, { solid: true });
  for (const z of [D - 1.75, D - 1.05]) b.barrel(W / 2 - 0.65, 0.62, z, true, false);
  b.barrel(W / 2 - 0.65, 1.22, D - 1.4, true, false);

  // the fireplace in the back wall, left of centre
  const fx = -1.9;
  // the chimney breast: two jambs and a lintel round an opening 1.1 by 0.95, a sooty back
  for (const s of [-1, 1]) b.box(0.5, 0.95, 0.7, fx + s * 0.8, 0.475, D - 0.35, brick, { tile: 0.8 });
  b.box(2.1, 0.3, 0.7, fx, 1.1, D - 0.35, brick, { tile: 0.8 });
  b.plane(1.1, 0.95, fx, 0.475, D - 0.04, Math.PI, mat("hearth", () => new THREE.MeshBasicMaterial({ color: 0x0c0806 })));
  b.box(1.1, 0.04, 0.66, fx, 0.02, D - 0.35, mat("hearthstone", () => new THREE.MeshBasicMaterial({ color: 0x1a1410 })));
  b.box(2.4, 0.1, 0.85, fx, 1.3, D - 0.4, dark);
  b.box(1.5, H - 1.35, 0.5, fx, 1.35 + (H - 1.35) / 2, D - 0.25, brick, { tile: 0.8 });
  b.boxes.push({ minX: fx - 1.05, maxX: fx + 1.05, minZ: D - 0.75, maxZ: D });
  b.cyl(0.02, 0.5, fx - 0.25, 0.3, D - 0.45, iron, false, 4); // fire dogs
  b.cyl(0.02, 0.5, fx + 0.25, 0.3, D - 0.45, iron, false, 4);
  b.box(0.08, 0.5, 0.5, fx + 0.7, 0.9, D - 0.95, iron); // a kettle's crane
  const fireWorld = toWorld(fx, D - 0.45, 0.12);
  const fires: Fires = createFires(scene, [{ x: fireWorld.x, y: fireWorld.y, z: fireWorld.z, size: 0.55 }]);

  // three tables with benches: two along the left wall, one crosswise at the back
  const seats: Seat[] = [];
  const table = (x: number, z: number, along: boolean, id: number) => {
    const [tw, td] = along ? [0.8, 1.6] : [1.6, 0.8];
    b.box(tw, 0.06, td, x, 0.76, z, wood, { tile: 0.8 });
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.07, 0.74, 0.07, x + dx * (tw / 2 - 0.1), 0.37, z + dz * (td / 2 - 0.1), dark);
    b.boxes.push({ minX: x - tw / 2, maxX: x + tw / 2, minZ: z - td / 2, maxZ: z + td / 2 });
    for (const s of [-1, 1]) {
      const bx = along ? x + s * 0.72 : x;
      const bz = along ? z : z + s * 0.72;
      b.box(along ? 0.3 : 1.7, 0.05, along ? 1.7 : 0.3, bx, 0.45, bz, wood, { tile: 0.8 });
      b.box(along ? 0.25 : 0.06, 0.43, along ? 0.06 : 0.25, bx - (along ? 0 : 0.7), 0.215, bz - (along ? 0.7 : 0), dark);
      b.box(along ? 0.25 : 0.06, 0.43, along ? 0.06 : 0.25, bx + (along ? 0 : 0.7), 0.215, bz + (along ? 0.7 : 0), dark);
      for (const o of [-0.42, 0.42]) {
        const sx = along ? bx : bx + o;
        const sz = along ? bz + o : bz;
        // round the end of the bench nearest the seat, from the middle of the room
        const end = Math.sign(o);
        const via: Array<[number, number]> = along
          ? [[-1.2, z + end * 1.25], [bx, z + end * 1.25]]
          : [[x + end * 1.3, 6.9], [x + end * 1.3, bz]];
        seats.push({ x: sx, z: sz, yaw: Math.atan2(x - sx, z - sz), table: id, h: 0.47, via });
      }
    }
  };
  table(-2.9, 2.9, true, 0);
  table(-2.9, 6.1, true, 1);
  table(0.2, 8.1, false, 2);
  // a stool or two at the counter
  for (const z of [4.2, 6.4]) {
    b.cyl(0.18, 0.05, cx0 - 0.45, 0.66, z, wood, false, 8);
    b.cyl(0.03, 0.64, cx0 - 0.45, 0.32, z, dark, false, 4);
    seats.push({ x: cx0 - 0.45, z, yaw: Math.PI / 2, table: 9, h: 0.68, via: [[cx0 - 1.0, z]] });
  }
  // two standing barrels by the door, a candle stub on each
  b.barrel(2.9, 0.4, 1.3);
  b.barrel(-3.2, 0.4, 0.95);
  // the vogelpik board on the left wall, above the back table's end
  b.plane(0.5, 0.5, -W / 2 + 0.02, 1.65, 8.3, Math.PI / 2, mat("vogelpik", () => psx(new THREE.MeshLambertMaterial({ map: vogelpik() }), { affine: 0 })));
  b.box(0.04, 0.02, 1.2, -W / 2 + 2.3, 0.01, 8.3, mat("chalk", () => new THREE.MeshBasicMaterial({ color: 0x6a665c })));

  // light: two hanging lamps, the fire, a low warm fill
  const lights: THREE.PointLight[] = [];
  const glows: THREE.Sprite[] = [];
  hangingLamp(b, -1.4, 2.05, 4.4, H, lights, glows);
  hangingLamp(b, 1.1, 2.05, 7.2, H, lights, glows);
  const fireLight = new THREE.PointLight(0xff8a40, 9, 8, 1.4);
  fireLight.position.set(fx, 0.8, D - 1.0);
  group.add(fireLight);
  const fill = new THREE.HemisphereLight(0x7a5a44, 0x241810, 1.4);
  scene.add(fill);
  scene.add(new THREE.AmbientLight(0x4a3624, 0.7));

  const stands: Spot[] = [
    { x: 1.55, z: 3.7, yaw: Math.PI / 2 },
    { x: 1.55, z: 6.9, yaw: Math.PI / 2 },
    { x: 2.35, z: 1.9, yaw: Math.PI },
    { x: 2.2, z: 0.9, yaw: -Math.PI / 2 },
    { x: -2.6, z: 0.8, yaw: Math.PI / 2 },
    { x: -0.3, z: 6.3, yaw: -Math.PI / 2 },
    { x: -1.2, z: D - 1.6, yaw: Math.PI * 0.9 },
    { x: 1.3, z: 5.3, yaw: Math.PI / 2 },
  ];
  const lampPts = lights.map((l) => ({ l, p: new THREE.Vector3() }));
  const firePt = toWorld(fx, D - 0.6, 0.6);
  const room: Room = {
    kind: "tavern",
    scene,
    group,
    walk: walker(W, 0.35, D, b.boxes),
    seats,
    stands,
    keeper: { x: W / 2 - 0.75, z: 5.3, yaw: -Math.PI / 2 },
    counter: { x: 1.55, z: 5.3, yaw: Math.PI / 2 },
    fire: { x: fx, z: D - 1.5, yaw: 0 },
    exit: { x: 0, z: 0.7, yaw: Math.PI },
    entry: { x: 0, z: 1.0, yaw: 0 },
    lamps: [],
    toWorld,
    setDaylight(k) {
      pane.color.setRGB(0.13 + 0.45 * k, 0.17 + 0.47 * k, 0.24 + 0.46 * k);
    },
    update(t) {
      fires.update(t);
      lights.forEach((l, i) => {
        const f = flicker(t, i * 5.1);
        l.intensity = 8 * f;
        glows[i].material.opacity = 0.75 * f;
      });
      const ff = flicker(t * 1.7, 9) * (0.85 + Math.sin(t * 11) * 0.08);
      fireLight.intensity = 9 * ff;
      room.lamps = [
        ...lampPts.map(({ l, p }, i) => ({ p: l.getWorldPosition(p), w: 0.45 * flicker(t, i * 5.1) })),
        { p: firePt, w: 0.55 * ff },
      ];
    },
  };
  room.update(0, 0);
  return room;
}

// ---------------------------------------------------------------- the Poesje's cellar

/**
 * The puppet cellar: a brick barrel vault 6 by 11 m, the steps down behind you, five
 * benches, and at the far end the booth: a red and gilt front with an opening, a curtain
 * that parts, a painted backcloth, footlights and a lamp. The puppets hang at `stage.spots`.
 */
export function buildCellar(opts: { origin: { x: number; z: number }; yaw: number }): Room {
  const W = 6;
  const D = 11;
  const SPRING = 1.35;
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, 0x1a130e);
  const b = new Builder(group);
  const brick = lambert("cellarbrick", { map: tex().brick, color: 0x9a7a6a });
  const flags = lambert("flags", { map: tex().cobble, color: 0x8a8278 });
  const wood = lambert("wood", { map: tex().planks, color: 0x7a5a3e });
  const dark = lambert("darkwood", { map: tex().planks, color: 0x3e2c1e });

  b.box(W, 0.1, D, 0, -0.05, D / 2, flags, { tile: 1.2 });
  b.box(0.3, SPRING, D, -W / 2 - 0.15, SPRING / 2, D / 2, brick, { tile: 0.9 });
  b.box(0.3, SPRING, D, W / 2 + 0.15, SPRING / 2, D / 2, brick, { tile: 0.9 });
  b.box(W, 2.6, 0.3, 0, 1.3, D + 0.15, brick, { tile: 0.9 });
  // the vault: half a cylinder along z, flattened
  const vg = new THREE.CylinderGeometry(W / 2 + 0.02, W / 2 + 0.02, D, 14, 1, true, -Math.PI / 2, Math.PI);
  const uv = vg.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 9, uv.getY(i) * 11);
  const vmat = mat("vault", () => psx(new THREE.MeshLambertMaterial({ map: tex().brick, color: 0x8a6a5a, side: THREE.BackSide }), { affine: 0.3 }));
  const vault = new THREE.Mesh(vg, vmat);
  // the cylinder's axis along the room (z), its open half upward
  vault.rotation.x = -Math.PI / 2;
  vault.scale.set(1, 1, 0.38);
  vault.position.set(0, SPRING, D / 2);
  group.add(vault);
  // the front wall, the steps up to the street door behind you
  b.box(W, 2.6, 0.3, 0, 1.3, -0.15, brick, { tile: 0.9 });
  for (let i = 0; i < 7; i++) b.box(1.1, 0.19 * (i + 1), 0.24, 2.2, (0.19 * (i + 1)) / 2, 1.75 - i * 0.24, lambert("step", { map: tex().slate, color: 0x807870 }), { solid: i >= 1 });
  b.box(1.1, 0.9, 0.05, 2.2, 1.33 + 0.9, 0.02, mat("streetdoor", () => new THREE.MeshBasicMaterial({ color: 0x2a3440 })));

  // benches in five rows, an aisle on the right by the steps
  const seats: Seat[] = [];
  const rows = [3.1, 4.2, 5.3, 6.4, 7.5];
  rows.forEach((z, i) => {
    b.box(4.4, 0.05, 0.3, -0.5, 0.42, z, wood, { tile: 0.8, solid: true });
    for (const x of [-2.5, 1.5]) b.box(0.06, 0.4, 0.24, x, 0.2, z, dark);
    for (const x of [-2.2, -1.2, -0.2, 0.9]) seats.push({ x, z: z - 0.02, yaw: 0, table: i, h: 0.44, via: [[2.3, z + 0.5], [x, z + 0.5]] });
  });
  const stands: Spot[] = [
    { x: 2.3, z: 3.6, yaw: 0 },
    { x: 2.35, z: 5.0, yaw: -0.2 },
    { x: 2.3, z: 6.4, yaw: -0.3 },
    { x: -2.6, z: 2.3, yaw: 0.2 },
    { x: -1.6, z: 2.2, yaw: 0.1 },
    { x: 2.4, z: 7.6, yaw: -0.4 },
  ];

  // the booth: a front with an opening 2.2 by 1.1, from 0.95 m up
  const BZ = 8.8;
  const OY0 = 0.95;
  const OY1 = 2.05;
  const front = mat("booth", () => psx(new THREE.MeshLambertMaterial({ map: boothFront() }), { affine: 0.3 }));
  b.box(1.9, 2.6, 0.1, -2.05, 1.3, BZ, front, { tile: 1.1 });
  b.box(1.9, 2.6, 0.1, 2.05, 1.3, BZ, front, { tile: 1.1 });
  b.box(2.2, OY0, 0.1, 0, OY0 / 2, BZ, mat("skirt", () => psx(new THREE.MeshLambertMaterial({ map: cloth("#3a2a4a", 8) }), { affine: 0.2 })), { tile: 1.1 });
  b.box(2.2, 0.6, 0.1, 0, OY1 + 0.3, BZ, front, { tile: 1.1 });
  b.boxes.push({ minX: -W / 2, maxX: W / 2, minZ: BZ - 0.1, maxZ: D });
  const name = new THREE.MeshBasicMaterial({ map: signTexture("POESJE"), color: 0xc8a860 });
  // planes face +z by default; these face the audience (-z)
  b.plane(1.6, 0.22, 0, OY1 + 0.3, BZ - 0.06, Math.PI, name);
  // the little stage inside: a floor and the painted backcloth
  b.box(2.3, 0.05, 1.5, 0, OY0 - 0.03, BZ + 0.75, dark);
  b.plane(2.3, 1.25, 0, OY0 + 0.6, BZ + 1.45, Math.PI, mat("backdrop", () => psx(new THREE.MeshLambertMaterial({ map: backdrop() }), { affine: 0 })));
  // the curtain: two halves that slide apart behind the front panels
  const curtainMat = mat("curtain", () => psx(new THREE.MeshLambertMaterial({ map: cloth("#8a1a16", 5), side: THREE.DoubleSide }), { affine: 0.2 }));
  const curtains = [-1, 1].map((s) => {
    const m = b.plane(1.12, 1.12, s * 0.55, (OY0 + OY1) / 2, BZ + 0.08, Math.PI, curtainMat);
    return { m, s };
  });
  // footlights: three candle flames at the lip, and a lamp on a hook over the audience
  const flames: THREE.Sprite[] = [];
  for (const x of [-0.8, 0, 0.8]) {
    b.cyl(0.02, 0.1, x, OY0 + 0.02, BZ - 0.12, mat("candle", () => new THREE.MeshBasicMaterial({ color: 0xd8d0b8 })), false, 5);
    const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffb050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.scale.set(0.18, 0.26, 1);
    f.position.set(x, OY0 + 0.13, BZ - 0.12);
    group.add(f);
    flames.push(f);
  }
  b.box(2.2, 0.06, 0.2, 0, OY0 - 0.02, BZ - 0.12, dark);
  const footLight = new THREE.PointLight(0xffc070, 4.5, 5, 1.4);
  footLight.position.set(0, OY0 + 0.4, BZ - 0.5);
  group.add(footLight);
  const lights: THREE.PointLight[] = [];
  const glows: THREE.Sprite[] = [];
  hangingLamp(b, 0.3, 1.9, 4.6, 2.35, lights, glows);
  // a candle in a niche by the steps, so the vault and the walls read in the gloom
  const niche = new THREE.PointLight(0xffa860, 3, 6, 1.5);
  niche.position.set(-2.6, 1.4, 2.4);
  group.add(niche);
  scene.add(new THREE.HemisphereLight(0x6a5040, 0x1a120c, 1.5));
  scene.add(new THREE.AmbientLight(0x3a2c20, 0.7));

  let curtain = 0;
  const footPt = toWorld(0, BZ - 0.3, OY0 + 0.3);
  const lampP = new THREE.Vector3();
  const room: Room = {
    kind: "cellar",
    scene,
    group,
    walk: walker(W, 1.95, D, b.boxes),
    seats,
    stands,
    exit: { x: 2.2, z: 2.2, yaw: Math.PI },
    entry: { x: 2.2, z: 2.4, yaw: 0 },
    stage: {
      spots: [
        { x: -0.62, z: BZ + 0.55, yaw: Math.PI },
        { x: 0.62, z: BZ + 0.55, yaw: Math.PI },
        { x: 0, z: BZ + 0.85, yaw: Math.PI },
      ],
      feetY: OY0 + 0.06,
      setCurtain(open) {
        curtain = Math.max(0, Math.min(1, open));
      },
    },
    lamps: [],
    toWorld,
    setDaylight() {},
    update(t, dt) {
      for (const c of curtains) {
        const target = c.s * (0.55 + curtain * 1.05);
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
