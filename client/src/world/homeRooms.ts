import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { Builder, canvasTex, flicker, frameRoom, lambert, mat, plaster, rand, tex, type Room, type Spot } from "./rooms";
import { makePiece, type Piece } from "./furniture";
import { createFires, type Fires } from "./fire";
import { CELL, CLASSES, footprint, FURNITURE, wallOf, type HomeClass, type Placed } from "../../../shared/homes";

// The rented rooms (M6 homes): one per class, sized and furnished by shared/homes.ts (the
// server's numbers), built in code like the taproom (world/rooms.ts). The room frame has the
// door at the origin, x across, z into the house. The room keeps its pieces on the engine's
// grid: `setPlaced` redraws what the server says stands where, `ghost` shows the piece Jef
// is moving, green where it may go and red where not.

export interface HomeRoom {
  cls: HomeClass;
  /** Redraw the pieces Jef owns (the server's list). */
  setPlaced(list: Placed[]): void;
  /** The piece Jef is moving (null: none), and whether it may go there. */
  ghost(g: { kind: string; gx: number; gz: number; rot: number; ok: boolean } | null): void;
  /** Where each placed piece is in the room frame (for "pick it up"). */
  pieces(): Array<{ id: number; kind: string; x: number; z: number; y: number }>;
  /** The bed's middle, and a point by it (for "go to bed"). */
  bed: { x: number; z: number; r: number };
  /** Fires Jef may warm himself at (the hearth, a stove), room frame. */
  fires(): Spot[];
  /** Is this floor point covered by a piece or the room's own furniture? */
  blocked(x: number, z: number, r: number): boolean;
}

/** Room frame centre of a footprint (floor pieces, rugs, the fixed furniture). */
export function footCentre(cls: HomeClass, gx: number, gz: number, w: number, d: number): { x: number; z: number } {
  const c = CLASSES[cls];
  return { x: -c.W / 2 + (gx + w / 2) * CELL, z: (gz + d / 2) * CELL };
}

/** Where a piece stands and how it is turned (room frame). */
export function pieceFrame(cls: HomeClass, kind: string, gx: number, gz: number, rot: number): { x: number; z: number; yaw: number } {
  const c = CLASSES[cls];
  const def = FURNITURE[kind];
  if (def?.layer === "wall") {
    const wall = wallOf(rot);
    const along = (wall === 0 || wall === 2 ? gx : gz) + def.w / 2;
    if (wall === 0) return { x: -c.W / 2 + along * CELL, z: c.D - 0.01, yaw: Math.PI };
    if (wall === 2) return { x: -c.W / 2 + along * CELL, z: 0.01, yaw: 0 };
    if (wall === 1) return { x: c.W / 2 - 0.01, z: along * CELL, yaw: -Math.PI / 2 };
    return { x: -c.W / 2 + 0.01, z: along * CELL, yaw: Math.PI / 2 };
  }
  if (def?.layer === "ceiling") return { ...footCentre(cls, gx, gz, 1, 1), yaw: 0 };
  const fp = footprint(def?.w ?? 1, def?.d ?? 1, rot);
  return { ...footCentre(cls, gx, gz, fp.w, fp.d), yaw: (rot * Math.PI) / 2 };
}

/** The painted street through the window: the houses opposite, a gas lamp, cobbles. */
function streetView(cls: HomeClass): THREE.CanvasTexture {
  const r = rand(cls.length * 131);
  return canvasTex(64, 64, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 40);
    sky.addColorStop(0, "#8a929a");
    sky.addColorStop(1, "#b0aca0");
    g.fillStyle = sky;
    g.fillRect(0, 0, 64, 64);
    if (cls === "cellar") {
      // at the level of the pavement: cobbles, a doorstep, a pair of boots going by
      g.fillStyle = "#5a5650";
      g.fillRect(0, 30, 64, 34);
      for (let y = 32; y < 64; y += 6) for (let x = (y / 6) % 2 ? 0 : 4; x < 64; x += 8) {
        g.fillStyle = `rgb(${90 + r() * 30},${88 + r() * 30},${84 + r() * 25})`;
        g.fillRect(x, y, 7, 5);
      }
      g.fillStyle = "#1a1612";
      g.fillRect(40, 16, 6, 16);
      g.fillRect(49, 18, 6, 14);
      return;
    }
    const low = cls === "garret" ? 10 : 22;
    for (let x = -4; x < 64; x += 14) {
      const h = 30 + r() * 20;
      g.fillStyle = ["#6a5446", "#5a4a40", "#7a6250", "#4e443c"][Math.floor(r() * 4)];
      g.fillRect(x, 64 - h - low, 13, h + low);
      g.beginPath();
      g.moveTo(x, 64 - h - low);
      g.lineTo(x + 6.5, 64 - h - low - 8);
      g.lineTo(x + 13, 64 - h - low);
      g.fill();
      for (let wy = 64 - h - low + 4; wy < 60; wy += 9) {
        g.fillStyle = r() < 0.3 ? "#d8b060" : "#2a2a30";
        g.fillRect(x + 3, wy, 3, 5);
        g.fillRect(x + 8, wy, 3, 5);
      }
    }
    if (cls === "garret") {
      // over the roofs: the cathedral spire in the haze
      g.fillStyle = "#6e7278";
      g.fillRect(44, 4, 5, 30);
      g.beginPath();
      g.moveTo(44, 4);
      g.lineTo(46.5, -6);
      g.lineTo(49, 4);
      g.fill();
    } else if (cls === "merchant") {
      // the river under the windows, a mast
      g.fillStyle = "#4a5a60";
      g.fillRect(0, 50, 64, 14);
      g.fillStyle = "#2a2218";
      g.fillRect(20, 10, 2, 42);
      g.fillRect(10, 46, 26, 5);
    } else {
      g.fillStyle = "#3a3a38";
      g.fillRect(0, 58, 64, 6);
      g.fillStyle = "#1a1816";
      g.fillRect(30, 30, 2, 28);
      g.fillStyle = "#e8c070";
      g.fillRect(28, 27, 6, 5);
    }
  }, false);
}

function wallpaper(): THREE.CanvasTexture {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = "#b8ae90";
    g.fillRect(0, 0, 32, 32);
    for (let x = 0; x < 32; x += 8) {
      g.fillStyle = "#a89e7e";
      g.fillRect(x, 0, 3, 32);
      g.fillStyle = "#8a6a5a";
      for (let y = 4; y < 32; y += 8) g.fillRect(x + 5, y, 2, 2);
    }
    g.fillStyle = "rgba(40,30,20,0.18)";
    g.fillRect(0, 0, 32, 5);
  });
}

interface Look {
  floor: THREE.Material;
  wall: THREE.Material;
  ceil: THREE.Material;
  beam: THREE.Material;
  fog: number;
  fill: [number, number];
  /** Metres of wall to one repeat of its texture. */
  tile: number;
}

function looks(cls: HomeClass, seed: number): Look {
  const beam = lambert("h_beam", { map: tex().planks, color: 0x4a3626 });
  const planks = lambert("h_planks", { map: tex().planks, color: 0x8a7058 });
  switch (cls) {
    case "cellar":
      return {
        floor: lambert("h_flags", { map: tex().cobble, color: 0x8a8278 }),
        wall: lambert("h_cellarbrick", { map: tex().brick, color: 0x8a6e60 }),
        ceil: lambert("h_ceilplank", { map: tex().planks, color: 0x4a3a2c }),
        beam,
        fog: 0x120e0a,
        fill: [0.8, 1.0],
        tile: 2.4,
      };
    case "garret":
      return {
        floor: planks,
        wall: mat(`h_plaster_g${seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(seed, [150, 138, 112]) }), { affine: 0.3 })),
        ceil: lambert("h_roofboards", { map: tex().planks, color: 0x6a5240 }),
        beam,
        fog: 0x16120e,
        fill: [1.0, 0.8],
        tile: 2.4,
      };
    case "widow":
      return {
        floor: lambert("h_scrubbed", { map: tex().planks, color: 0x9a8268 }),
        wall: mat("h_wallpaper", () => psx(new THREE.MeshLambertMaterial({ map: wallpaper() }), { affine: 0.3 })),
        ceil: lambert("h_ceilwhite", { color: 0xc8c0aa }),
        beam,
        fog: 0x18140f,
        fill: [1.1, 0.9],
        tile: 2.4,
      };
    case "alley":
      return {
        floor: lambert("h_redtile", { map: tex().brick, color: 0xb07058 }),
        wall: mat(`h_white${seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(seed, [196, 190, 172]) }), { affine: 0.3 })),
        ceil: lambert("h_ceilplank2", { map: tex().planks, color: 0x5a4432 }),
        beam,
        fog: 0x16120e,
        fill: [1.0, 0.85],
        tile: 2.4,
      };
    case "merchant":
      return {
        floor: lambert("h_polished", { map: tex().planks, color: 0x6a4a32 }),
        wall: mat("h_damask", () => psx(new THREE.MeshLambertMaterial({ map: damask() }), { affine: 0.3 })),
        ceil: lambert("h_ceilplaster", { color: 0xd8d0bc }),
        beam: lambert("h_cornice", { color: 0xcfc6ae }),
        fog: 0x1a1612,
        fill: [1.2, 1.0],
        tile: 0.8,
      };
  }
}

/**
 * A rented room of its class: walls, floor, ceiling (a garret's roof slopes down to knee
 * walls), the front wall with the door and its windows onto the street, the room's own
 * furniture (shared/homes.ts), its light (daylight at the windows, a candle, the hearth or
 * stove, a lamp Jef hangs), and the pieces Jef owns.
 */
export function buildHome(opts: { origin: { x: number; z: number }; yaw: number; cls: HomeClass; seed: number }): Room {
  const cls = opts.cls;
  const c = CLASSES[cls];
  const { W, D, H } = c;
  const L = looks(cls, opts.seed % 997);
  const { scene, group, toWorld } = frameRoom(opts.origin, opts.yaw, L.fog);
  (scene.fog as THREE.Fog).near = 6;
  (scene.fog as THREE.Fog).far = 24;
  // everything that never moves is built into `stat` and drawn merged by material at the end
  const stat = new THREE.Group();
  group.add(stat);
  const b = new Builder(stat);
  const garret = cls === "garret";
  const knee = 1.0;

  // floor and ceiling
  b.box(W, 0.1, D, 0, -0.05, D / 2, L.floor, { tile: cls === "alley" ? 0.8 : 1.4 });
  if (garret) {
    // the roof slopes from the knee walls up to the ridge
    const run = W / 2;
    const rise = H - knee;
    const len = Math.hypot(run, rise);
    const ang = Math.atan2(rise, run);
    for (const s of [-1, 1]) {
      const m = b.box(len, 0.06, D, (s * run) / 2, knee + rise / 2, D / 2, L.ceil, { tile: 1.2 });
      m.rotation.z = -s * ang;
      b.box(0.1, knee, D, s * (W / 2 + 0.05), knee / 2, D / 2, L.wall, { tile: 2.2 });
      for (let z = 0.6; z < D; z += 1.1) {
        const raf = b.box(len, 0.1, 0.08, (s * run) / 2, knee + rise / 2 - 0.06, z, L.beam);
        raf.rotation.z = -s * ang;
      }
    }
    b.box(0.14, 0.14, D, 0, H - 0.08, D / 2, L.beam);
  } else {
    b.box(W, 0.1, D, 0, H + 0.05, D / 2, L.ceil, { tile: 1.6 });
    for (const s of [-1, 1]) b.box(0.2, H, D, s * (W / 2 + 0.1), H / 2, D / 2, L.wall, { tile: L.tile });
    if (cls !== "merchant") for (let z = 1.0; z < D; z += 1.4) b.box(W, 0.18, 0.16, 0, H - 0.09, z, L.beam, { tile: 1.2 });
    else for (const s of [-1, 1]) b.box(0.12, 0.12, D, s * (W / 2 - 0.06), H - 0.06, D / 2, L.beam);
  }
  // back wall (a gable in the garret: the wall runs up to the ridge; the slopes hide its corners)
  b.box(W, H, 0.2, 0, H / 2, D + 0.1, L.wall, { tile: L.tile });
  if (cls === "merchant") {
    // panelling below the dado rail on three walls
    const panel = lambert("h_panel", { map: tex().planks, color: 0x4a3222 });
    b.box(W, 0.9, 0.04, 0, 0.45, D - 0.02, panel);
    for (const s of [-1, 1]) b.box(0.04, 0.9, D, s * (W / 2 - 0.02), 0.45, D / 2, panel);
  }

  // the front wall: the door in the middle, the windows in their spans
  const doorW = 0.9;
  const doorH = Math.min(2.0, H - 0.15);
  const win = c.windows.map(([a, z]) => ({ x0: -W / 2 + a * CELL + 0.05, x1: -W / 2 + (z + 1) * CELL - 0.05 }));
  const [wy0, wy1] = cls === "cellar" ? [1.35, 1.85] : garret ? [0.95, 1.4] : cls === "merchant" ? [0.7, 2.6] : [0.95, Math.min(2.05, H - 0.4)];
  const cuts = [{ x0: -doorW / 2, x1: doorW / 2, y0: 0, y1: doorH }, ...win.map((w) => ({ ...w, y0: wy0, y1: wy1 }))].sort((p, q) => p.x0 - q.x0);
  const frontH = H;
  let x = -W / 2;
  const front = (x0: number, x1: number, y0: number, y1: number) => {
    if (x1 - x0 > 0.01 && y1 - y0 > 0.01) b.box(x1 - x0, y1 - y0, 0.2, (x0 + x1) / 2, (y0 + y1) / 2, -0.1, L.wall, { tile: L.tile });
  };
  for (const cut of cuts) {
    front(x, cut.x0, 0, frontH);
    front(cut.x0, cut.x1, 0, cut.y0);
    front(cut.x0, cut.x1, cut.y1, frontH);
    x = cut.x1;
  }
  front(x, W / 2, 0, frontH);
  const doorMat = lambert("h_door", { map: tex().planks, color: 0x3a2a1c });
  b.box(doorW, doorH, 0.06, 0, doorH / 2, -0.03, doorMat);
  b.box(0.05, 0.05, 0.04, 0.33, 1.0, 0.02, lambert("f_iron", { color: 0x26221e }));
  const view = new THREE.MeshBasicMaterial({ map: streetView(cls), color: 0x404040 });
  for (const w of win) {
    b.plane(w.x1 - w.x0, wy1 - wy0, (w.x0 + w.x1) / 2, (wy0 + wy1) / 2, -0.12, 0, view);
    b.box(w.x1 - w.x0 + 0.08, 0.05, 0.14, (w.x0 + w.x1) / 2, wy0 - 0.02, -0.03, L.beam);
    b.box(0.04, wy1 - wy0, 0.05, (w.x0 + w.x1) / 2, (wy0 + wy1) / 2, -0.06, L.beam);
    b.box(w.x1 - w.x0, 0.04, 0.05, (w.x0 + w.x1) / 2, (wy0 + wy1) / 2, -0.06, L.beam);
  }
  if (cls === "merchant") merchantDress(b, W, D, H, win, wy0, wy1);
  if (cls === "widow") {
    // her crucifix on the back wall, a palm sprig behind it
    const dark = lambert("f_dark", { map: tex().planks, color: 0x4a3424 });
    b.box(0.04, 0.34, 0.03, -W / 2 + 3.5 * CELL, 1.75, D - 0.02, dark);
    b.box(0.2, 0.04, 0.03, -W / 2 + 3.5 * CELL, 1.82, D - 0.02, dark);
  }

  // light: daylight at the windows, a low fill, and the pieces' own lights
  const hemi = new THREE.HemisphereLight(0xa0a4a8, 0x6a5a48, 0.4);
  scene.add(hemi);
  scene.add(new THREE.AmbientLight(0x6a543c, 1.25));
  const winLight = new THREE.PointLight(0xb8c0c8, 0, 6, 1.4);
  winLight.position.set(win.length ? (win[0].x0 + win[0].x1) / 2 : 0, (wy0 + wy1) / 2, 0.6);
  group.add(winLight);

  // the room's own furniture
  type Lit = { light: THREE.PointLight; power: number; glow?: THREE.Sprite; seed: number; p: THREE.Vector3 };
  const lit: Lit[] = [];
  const fixedBlocks: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
  let fires: Fires | null = null;
  const fireSpots: Spot[] = [];
  const addLight = (pc: Piece, at: THREE.Object3D, into: Lit[]) => {
    if (!pc.light) return;
    const l = new THREE.PointLight(pc.light.color, pc.light.power, 6, 1.5);
    l.position.set(pc.light.x, pc.light.y, pc.light.z);
    at.add(l);
    into.push({ light: l, power: pc.light.power, glow: pc.light.glow, seed: into.length * 3.7 + 1, p: new THREE.Vector3() });
  };
  let bed = { x: 0, z: D - 1, r: 1 };
  for (const f of c.fixed) {
    const pc = makePiece(f.kind, H);
    const at = footCentre(cls, f.gx, f.gz, f.w, f.d);
    pc.group.position.set(at.x, 0, at.z);
    pc.group.rotation.y = (f.rot * Math.PI) / 2;
    stat.add(pc.group);
    addLight(pc, pc.group, lit);
    fixedBlocks.push({ minX: -W / 2 + f.gx * CELL, maxX: -W / 2 + (f.gx + f.w) * CELL, minZ: f.gz * CELL, maxZ: (f.gz + f.d) * CELL });
    if (f.kind.startsWith("bed")) bed = { x: at.x, z: at.z, r: Math.max(f.w, f.d) * CELL * 0.5 + 0.55 };
    if (f.kind === "hearth" || f.kind === "stove_tile" || f.kind === "mantel") {
      const dir = (f.rot * Math.PI) / 2;
      fireSpots.push({ x: at.x + Math.sin(dir) * 0.9, z: at.z + Math.cos(dir) * 0.9, yaw: dir + Math.PI });
      if (f.kind !== "stove_tile") {
        const back = f.kind === "mantel" ? -0.05 : 0.05;
        const fw = toWorld(at.x + Math.sin(dir) * back, at.z + Math.cos(dir) * back, 0.1);
        fires = createFires(scene, [{ x: fw.x, y: fw.y, z: fw.z, size: f.kind === "mantel" ? 0.4 : 0.35 }]);
      }
    }
  }
  if (cls === "merchant") {
    // a brass chandelier over the table
    const table = c.fixed.find((f) => f.kind === "table_fine");
    const pc = makePiece("chandelier", H);
    const at = table ? footCentre(cls, table.gx, table.gz, table.w, table.d) : { x: 0, z: D / 2 };
    pc.group.position.set(at.x, 0, at.z);
    stat.add(pc.group);
    addLight(pc, pc.group, lit);
  }
  mergeStatic(stat, group);

  // the pieces Jef owns
  const own = new THREE.Group();
  group.add(own);
  let ownLit: Lit[] = [];
  let placed: Array<{ p: Placed; x: number; z: number; y: number }> = [];
  let ownBlocks: typeof fixedBlocks = [];

  const ghostGroup = new THREE.Group();
  group.add(ghostGroup);
  const okMat = new THREE.MeshBasicMaterial({ color: 0x3a8a3a, transparent: true, opacity: 0.35, depthWrite: false });
  const badMat = new THREE.MeshBasicMaterial({ color: 0x9a2a22, transparent: true, opacity: 0.4, depthWrite: false });
  let ghostKey = "";
  let ghostPiece: Piece | null = null;
  const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), okMat);
  ghostGroup.add(marker);
  ghostGroup.visible = false;

  const blocked = (px: number, pz: number, r: number) =>
    [...fixedBlocks, ...ownBlocks].some((q) => px > q.minX - r && px < q.maxX + r && pz > q.minZ - r && pz < q.maxZ + r);

  const home: HomeRoom = {
    cls,
    bed,
    setPlaced(list) {
      for (const o of [...own.children]) own.remove(o);
      ownLit = [];
      ownBlocks = [];
      placed = [];
      for (const p of list) {
        const def = FURNITURE[p.kind];
        if (!def) continue;
        const pc = makePiece(p.kind, H);
        const f = pieceFrame(cls, p.kind, p.gx, p.gz, p.rot);
        pc.group.position.set(f.x, 0, f.z);
        pc.group.rotation.y = f.yaw;
        own.add(pc.group);
        addLight(pc, pc.group, ownLit);
        placed.push({ p, x: f.x, z: f.z, y: def.layer === "wall" ? 1.6 : def.layer === "ceiling" ? H - 0.6 : 0.4 });
        if (def.layer === "floor") {
          const fp = footprint(def.w, def.d, p.rot);
          ownBlocks.push({ minX: -W / 2 + p.gx * CELL + 0.05, maxX: -W / 2 + (p.gx + fp.w) * CELL - 0.05, minZ: p.gz * CELL + 0.05, maxZ: (p.gz + fp.d) * CELL - 0.05 });
        }
      }
    },
    ghost(gh) {
      if (!gh) {
        ghostGroup.visible = false;
        return;
      }
      const def = FURNITURE[gh.kind];
      if (!def) return;
      if (ghostKey !== gh.kind) {
        if (ghostPiece) ghostGroup.remove(ghostPiece.group);
        ghostPiece = makePiece(gh.kind, H);
        ghostGroup.add(ghostPiece.group);
        ghostKey = gh.kind;
      }
      const f = pieceFrame(cls, gh.kind, gh.gx, gh.gz, gh.rot);
      ghostPiece!.group.position.set(f.x, 0, f.z);
      ghostPiece!.group.rotation.y = f.yaw;
      marker.material = gh.ok ? okMat : badMat;
      if (def.layer === "wall") {
        marker.scale.set(def.w * CELL, 0.9, 1);
        marker.position.set(f.x + Math.sin(f.yaw) * 0.02, 1.6, f.z + Math.cos(f.yaw) * 0.02);
        marker.rotation.set(0, f.yaw, 0);
      } else {
        const fp = def.layer === "ceiling" ? { w: 1, d: 1 } : footprint(def.w, def.d, gh.rot);
        marker.scale.set(fp.w * CELL, fp.d * CELL, 1);
        marker.position.set(f.x, 0.02, f.z);
        marker.rotation.set(-Math.PI / 2, 0, 0);
      }
      ghostGroup.visible = true;
    },
    pieces() {
      return placed.map((q) => ({ id: q.p.id, kind: q.p.kind, x: q.x, z: q.z, y: q.y }));
    },
    fires() {
      const out = [...fireSpots];
      for (const q of placed) if (q.p.kind === "stove") out.push({ x: q.x, z: q.z, yaw: 0 });
      return out;
    },
    blocked,
  };

  const R = 0.28;
  const walk: Room["walk"] = (fx, fz, px, pz) => {
    const half = garret ? W / 2 - 0.55 : W / 2 - R;
    const free = (a: number, z: number) => a > -half && a < half && z > 0.35 && z < D - R && !blocked(a, z, R);
    if (free(px, pz)) return [px, pz];
    if (free(px, fz)) return [px, fz];
    if (free(fx, pz)) return [fx, pz];
    return [fx, fz];
  };

  const stands: Spot[] = [
    { x: 0.55, z: 0.75, yaw: 0 },
    { x: -0.55, z: 0.8, yaw: 0.2 },
  ];
  const winPt = new THREE.Vector3();
  let day = 0;
  const room: Room = {
    kind: "home",
    scene,
    group,
    walk,
    seats: [],
    stands,
    exit: { x: 0, z: 0.65, yaw: Math.PI },
    entry: { x: 0, z: 0.95, yaw: 0 },
    lamps: [],
    toWorld,
    home,
    setDaylight(k) {
      day = k;
      view.color.setScalar(0.12 + 0.88 * k);
      hemi.intensity = L.fill[1] + L.fill[0] * k;
      winLight.intensity = 2.5 * k * win.length;
    },
    update(t) {
      fires?.update(t);
      const all = [...lit, ...ownLit];
      room.lamps = [];
      all.forEach((q) => {
        const f = flicker(t, q.seed);
        q.light.intensity = q.power * f;
        if (q.glow) q.glow.material.opacity = 0.75 * f;
        if (room.lamps.length < 4) room.lamps.push({ p: q.light.getWorldPosition(q.p), w: 0.3 * f });
      });
      if (win.length && day > 0.2 && room.lamps.length < 4) room.lamps.push({ p: winLight.getWorldPosition(winPt), w: 0.12 * day });
    },
  };
  room.update(0, 0);
  return room;
}

/** Draw a group of still things as one mesh per material; its lights and glows move to `into`. */
function mergeStatic(stat: THREE.Group, into: THREE.Group): void {
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

/** A dark red damask paper with a gold figure, for the merchant's walls. */
function damask(): THREE.CanvasTexture {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = "#5a2420";
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = "rgba(190,150,80,0.45)";
    for (const [cx, cy] of [[8, 8], [24, 24]]) {
      g.beginPath();
      g.moveTo(cx, cy - 6);
      g.quadraticCurveTo(cx + 5, cy, cx, cy + 6);
      g.quadraticCurveTo(cx - 5, cy, cx, cy - 6);
      g.fill();
      g.fillRect(cx - 1, cy - 8, 2, 16);
    }
    g.fillStyle = "rgba(0,0,0,0.12)";
    g.fillRect(0, 0, 32, 3);
  });
}

/** The painted frieze under the ceiling: a band of scrolls on cream. */
function frieze(): THREE.CanvasTexture {
  return canvasTex(64, 16, (g) => {
    g.fillStyle = "#d8ccb0";
    g.fillRect(0, 0, 64, 16);
    g.fillStyle = "#8a6a2a";
    g.fillRect(0, 0, 64, 2);
    g.fillRect(0, 14, 64, 2);
    g.strokeStyle = "#5a6a4a";
    g.lineWidth = 1.5;
    for (let x = 0; x < 64; x += 16) {
      g.beginPath();
      g.arc(x + 8, 8, 4, Math.PI * 0.2, Math.PI * 1.8);
      g.stroke();
      g.fillStyle = "#9a3a2a";
      g.fillRect(x + 7, 7, 2, 2);
    }
  });
}

/** A Turkey carpet: a red field, a blue border, gold lozenges. */
function turkey(): THREE.CanvasTexture {
  return canvasTex(64, 48, (g) => {
    g.fillStyle = "#6a1c18";
    g.fillRect(0, 0, 64, 48);
    g.fillStyle = "#1e2a44";
    g.fillRect(4, 4, 56, 40);
    g.fillStyle = "#7a2a1e";
    g.fillRect(8, 8, 48, 32);
    g.fillStyle = "#c8a050";
    for (const [x, y] of [[32, 24], [18, 16], [46, 16], [18, 32], [46, 32]]) {
      g.beginPath();
      g.moveTo(x, y - 6);
      g.lineTo(x + 6, y);
      g.lineTo(x, y + 6);
      g.lineTo(x - 6, y);
      g.fill();
    }
    g.fillStyle = "#1e2a44";
    g.fillRect(31, 23, 2, 2);
    g.fillStyle = "#d8c8a0";
    for (let x = 0; x < 64; x += 4) {
      g.fillRect(x, 1, 2, 2);
      g.fillRect(x, 45, 2, 2);
    }
  }, false);
}

/** A small oil painting of a ship on the Schelde. */
function seascape(seed: number): THREE.CanvasTexture {
  const r = rand(seed);
  return canvasTex(32, 24, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 16);
    sky.addColorStop(0, "#6a7a8a");
    sky.addColorStop(1, "#c8b890");
    g.fillStyle = sky;
    g.fillRect(0, 0, 32, 24);
    g.fillStyle = "#3a4a4a";
    g.fillRect(0, 16, 32, 8);
    g.fillStyle = "#2a2018";
    const x = 8 + r() * 14;
    g.fillRect(x, 5, 1, 12);
    g.fillStyle = "#e0d8c0";
    g.beginPath();
    g.moveTo(x + 1, 6);
    g.lineTo(x + 7, 14);
    g.lineTo(x + 1, 14);
    g.fill();
    g.fillStyle = "#1a1410";
    g.fillRect(x - 4, 16, 14, 2);
  }, false);
}

/**
 * The merchant's floor dressed as a well-off man's rooms: a painted frieze under the
 * ceiling, a gilt dado rail, a Turkey carpet, heavy drapes with a pelmet at the tall
 * windows, two seascapes in gilt frames. Looks only: the grid, the fixed furniture and the
 * numbers are shared/homes.ts.
 */
function merchantDress(b: Builder, W: number, D: number, H: number, win: Array<{ x0: number; x1: number }>, wy0: number, wy1: number): void {
  const fr = mat("h_frieze", () => psx(new THREE.MeshLambertMaterial({ map: frieze() }), { affine: 0 }));
  const gilt = lambert("f_gilt", { color: 0xb08a3a });
  const band = 0.34;
  const y = H - band / 2 - 0.08;
  b.box(W - 0.02, band, 0.02, 0, y, D - 0.02, fr, { tile: 1.3 });
  for (const s of [-1, 1]) b.box(0.02, band, D - 0.02, s * (W / 2 - 0.02), y, D / 2, fr, { tile: 1.3 });
  b.box(W - 0.02, band, 0.02, 0, y, 0.02, fr, { tile: 1.3 });
  // the dado rail over the panelling
  b.box(W, 0.05, 0.06, 0, 0.92, D - 0.04, gilt);
  for (const s of [-1, 1]) b.box(0.06, 0.05, D, s * (W / 2 - 0.04), 0.92, D / 2, gilt);
  // the carpet under the table
  b.box(3.0, 0.01, 2.3, 0, 0.005, 3.0, mat("h_turkey", () => psx(new THREE.MeshLambertMaterial({ map: turkey() }), { affine: 0 })));
  // the drapes: two heavy panels either side of each window, a pelmet above, a gilt sill
  const drape = mat("h_drape", () => {
    const t = canvasTex(16, 32, (g) => {
      g.fillStyle = "#5a1614";
      g.fillRect(0, 0, 16, 32);
      for (let x = 0; x < 16; x += 4) {
        g.fillStyle = "rgba(0,0,0,0.3)";
        g.fillRect(x, 0, 1, 32);
        g.fillStyle = "rgba(255,200,160,0.1)";
        g.fillRect(x + 2, 0, 1, 32);
      }
      g.fillStyle = "#b08a3a";
      g.fillRect(0, 29, 16, 2);
    });
    return psx(new THREE.MeshLambertMaterial({ map: t }), { affine: 0.2 });
  });
  for (const w of win) {
    const top = Math.min(H - 0.45, wy1 + 0.25);
    for (const side of [w.x0 - 0.12, w.x1 + 0.12]) b.box(0.36, top - 0.02, 0.08, side, top / 2, 0.08, drape);
    b.box(w.x1 - w.x0 + 0.7, 0.26, 0.12, (w.x0 + w.x1) / 2, top + 0.1, 0.07, drape);
    b.box(w.x1 - w.x0 + 0.1, 0.04, 0.3, (w.x0 + w.x1) / 2, wy0 - 0.02, 0.1, gilt);
  }
  // two seascapes in gilt frames on the left wall
  [1.3, 2.45].forEach((z, i) => {
    b.box(0.05, 0.62, 0.8, -W / 2 + 0.03, 1.75, z, gilt);
    b.plane(0.7, 0.52, -W / 2 + 0.06, 1.75, z, Math.PI / 2, mat(`h_sea${i}`, () => psx(new THREE.MeshLambertMaterial({ map: seascape(17 + i * 31) }), { affine: 0 })));
  });
}
