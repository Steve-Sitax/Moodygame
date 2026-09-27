import * as THREE from "three";
import { canvasTex, flicker, frameRoom, rand, tex, type Seat } from "./rooms";
import { signTexture } from "./textures";
import { createFires } from "./fire";
import {
  ashlar,
  billTex,
  Flames,
  goldLeather,
  Kit,
  lightShaft,
  lmBasic,
  lmMat,
  matOf,
  shaftMaterial,
  slabs,
  spines,
  stairSteps,
  whitewash,
  type MatDef,
  type Rect,
} from "./landmarkKit";
import { glassMat, M, paintMat, walkGraph, type LandmarkRoom, type Lookable, type Mark } from "./landmarkRooms";
import * as HP from "../../../shared/hallPlan";
import * as TH from "../../../shared/townhallPlan";
import * as VH from "../../../shared/vleeshuisPlan";
import * as OH from "../../../shared/oostershuisPlan";
import * as ST from "../../../shared/steenPlan";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import type { World } from "./rijnkaai";
import type { InWorld } from "./inworld";

// The town hall, the Vleeshuis, the Steen and the Oostershuis (M6 landmark interiors), built in
// code like the cathedral (world/landmarkRooms.ts). Research and sources in
// docs/milestones/M6-landmark-interiors.md. Each hall's frame: its main door at the origin,
// x across, z into the building; storeys over each other are walked with Levels (landmarkKit).

const H = {
  plaster: lmMat("lm_plaster", { map: whitewash(21, [196, 186, 162]), color: 0xd0c4a8 }, 0.1),
  panel: lmMat("lm_panel", { map: tex().planks, color: 0x9a6a44 }, 0.15),
  boards: lmMat("lm_boards", { map: tex().planks, color: 0xd0a878 }, 0.1),
  brick: lmMat("lm_brick", { map: tex().brick, color: 0xe0b098 }, 0.1),
  vaultBrick: lmMat("lm_vault_brick", { map: tex().brick, color: 0xe0b098, side: THREE.DoubleSide }, 0.1),
  vaultStone: lmMat("lm_vault_stone", { map: ashlar(31, [110, 110, 116]), color: 0xb8b8c0, side: THREE.DoubleSide }, 0.1),
  stoneGrey: lmMat("lm_stone_grey", { map: ashlar(31, [110, 110, 116]), color: 0xa8a8b0 }, 0.1),
  leather: lmMat("lm_leather", { map: goldLeather(), color: 0xc0a070 }, 0.1),
  green: lmMat("lm_green", { color: 0x2a4a2a }),
  books: lmMat("lm_books", { map: spines(), color: 0xc0b8a8 }, 0),
  paper: lmMat("lm_paper", { color: 0xe0d8c0 }),
  sack: lmMat("lm_sack", { map: tex().sack, color: 0xf0d8b0 }, 0.2),
  bale: lmMat("lm_bale", { map: tex().sack, color: 0xffffff }, 0.2),
  crate: lmMat("lm_crate", { map: tex().crate, color: 0xb09070 }, 0.2),
  rope: lmMat("lm_rope", { map: tex().rope, color: 0xb0a080 }, 0.2),
  timber: lmMat("lm_timber", { map: tex().planks, color: 0xb08860 }, 0.15),
  cloth: lmMat("lm_curtain", { color: 0x6a1814 }),
  backdrop: lmMat("lm_backdrop", { map: canvasTex(64, 32, (g) => {
    const sky = g.createLinearGradient(0, 0, 0, 20);
    sky.addColorStop(0, "#3a4a6a");
    sky.addColorStop(1, "#8a8a7a");
    g.fillStyle = sky;
    g.fillRect(0, 0, 64, 32);
    g.fillStyle = "#4a4038";
    // a painted castle and town, the stock scene of a Flemish history drama
    g.fillRect(6, 10, 14, 16);
    g.fillRect(8, 6, 4, 6);
    g.fillRect(16, 7, 4, 5);
    for (let x = 22; x < 64; x += 7) g.fillRect(x, 16 + ((x * 3) % 5), 6, 14);
    g.fillStyle = "#2a3a2a";
    g.fillRect(0, 26, 64, 6);
  }, false), color: 0xa89878 }, 0),
  glassCase: { key: "lm_glasscase", make: () => new THREE.MeshLambertMaterial({ color: 0xb8c8d0, transparent: true, opacity: 0.22, depthWrite: false, vertexColors: true }) },
  bronze: lmMat("lm_bronze", { color: 0x5a4a2a, emissive: 0x100a02 }),
  pot: lmMat("lm_pot", { color: 0x8a5a3a }),
  alabaster: lmMat("lm_alabaster", { color: 0xe8e0d0, emissive: 0x141210 }),
  steel: lmMat("lm_steel", { color: 0x8a8e94, emissive: 0x0a0a0c }),
  straw: lmMat("lm_straw", { map: tex().sack, color: 0xc8b070 }, 0.2),
};
const billMats = [0, 1, 2, 3].map((i) => lmMat(`lm_bill${i}`, { map: billTex(i), color: 0xd8d0c0 }, 0));
const sign = (text: string, key: string) => lmBasic(key, { map: signTexture(text), color: 0xb8ab8a });

type HallAir = { hemi: THREE.HemisphereLight; amb: THREE.AmbientLight; base: [THREE.Color, THREE.Color, THREE.Color] };
function lights(scene: THREE.Scene, sky: number, ground: number, amb: number): HallAir {
  const hemi = new THREE.HemisphereLight(sky, ground, 1.1);
  const a = new THREE.AmbientLight(amb, 0.9);
  scene.add(hemi, a);
  return { hemi, amb: a, base: [new THREE.Color(sky), new THREE.Color(ground), new THREE.Color(amb)] };
}

const MOON_SKY = new THREE.Color(0x56668c);
const MOON_GROUND = new THREE.Color(0x1a1612);
const MOON_AMB = new THREE.Color(0x262c40);
/**
 * The halls by night (Steve, 2026-09-27: "moody and cool"; the lamps burn all night, open or shut): the grey fill
 * of the day sinks to a blue-black, so the lamps' warm pools carry the room; the glass holds the moon's cold blue.
 * Call it last in a hall's light().
 */
function nightAir(L: HallAir, glasses: Array<{ mat: () => THREE.MeshBasicMaterial }>, day: number, sky: number): void {
  const night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.35);
  const moon = night * THREE.MathUtils.clamp((sky - 0.55) * 2.2, 0.25, 1);
  L.hemi.intensity *= 1 - 0.68 * night;
  L.amb.intensity *= 1 - 0.6 * night;
  L.hemi.color.copy(L.base[0]).lerp(MOON_SKY, night);
  L.hemi.groundColor.copy(L.base[1]).lerp(MOON_GROUND, night);
  L.amb.color.copy(L.base[2]).lerp(MOON_AMB, night);
  const g0 = 0.9 * day * sky;
  for (const g of glasses) g.mat().color.setRGB(0.07 + g0 + 0.05 * moon, 0.08 + g0 + 0.08 * moon, 0.1 + g0 + 0.17 * moon);
}

function point(group: THREE.Group, color: number, x: number, y: number, z: number, dist: number): THREE.PointLight {
  const l = new THREE.PointLight(color, 0, dist, 1.5);
  l.position.set(x, y, z);
  group.add(l);
  return l;
}

/** A chair of the grand rooms (leather seat, carved back), facing yaw. */
function chair(k: Kit, x: number, y: number, z: number, yaw: number, big = false): void {
  const s = big ? 1.25 : 1;
  const bx = -Math.sin(yaw) * 0.22;
  const bz = -Math.cos(yaw) * 0.22;
  k.box(0.46 * s, 0.07, 0.44, x, y + 0.46, z, H.leather, { ry: yaw });
  k.box(0.44 * s, 0.44, 0.4, x, y + 0.22, z, H.panel, { ry: yaw });
  k.box(0.46 * s, (big ? 0.9 : 0.6) , 0.05, x + bx, y + 0.5 + (big ? 0.45 : 0.3), z + bz, H.panel, { ry: yaw });
}

/** A desk with a ledger open and an inkstand. */
function desk(k: Kit, x: number, y: number, z: number, w = 1.4, yaw = 0): void {
  k.box(w, 0.06, 0.8, x, y + 0.78, z, H.panel, { ry: yaw });
  k.box(w, 0.74, 0.7, x, y + 0.37, z, H.panel, { ry: yaw, solid: true });
  k.box(0.5, 0.03, 0.36, x, y + 0.83, z, H.paper, { ry: yaw });
  k.box(0.08, 0.08, 0.08, x + w * 0.35, y + 0.85, z, M.black, { ry: yaw });
}

/** Chalk marks for cask heads, four to a texture: a year and a cross, a house's letters, strokes, a circle. */
function chalkTex(): THREE.CanvasTexture {
  return canvasTex(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = "rgba(236, 230, 214, 0.92)";
    g.fillStyle = "rgba(236, 230, 214, 0.92)";
    g.lineWidth = 1.6;
    g.font = "bold 11px 'Scheldemist Print', serif";
    g.fillText("71", 5, 14);
    g.beginPath();
    g.moveTo(18, 20);
    g.lineTo(28, 28);
    g.moveTo(28, 20);
    g.lineTo(18, 28);
    g.stroke();
    g.fillText("B.G.", 35, 15);
    g.beginPath();
    g.moveTo(35, 22);
    g.lineTo(60, 20);
    g.stroke();
    for (let i = 0; i < 4; i++) {
      g.beginPath();
      g.moveTo(6 + i * 5, 38);
      g.lineTo(7 + i * 5, 56);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(4, 50);
    g.lineTo(26, 44);
    g.stroke();
    g.beginPath();
    g.arc(48, 46, 9, 0, Math.PI * 2);
    g.stroke();
    g.fillText("R", 44, 50);
  }, false);
}

/** Bottle ends in their pigeonholes: dark glass, a glint, dusty timber between. */
function bottleTex(): THREE.CanvasTexture {
  return canvasTex(32, 32, (g) => {
    g.fillStyle = "#2a1c12";
    g.fillRect(0, 0, 32, 32);
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 2; x++) {
        const cx = 8 + x * 16;
        const cy = 8 + y * 16;
        g.fillStyle = "#120c08";
        g.fillRect(cx - 7, cy - 7, 14, 14);
        g.fillStyle = "#1c3020";
        g.beginPath();
        g.arc(cx, cy, 5.5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#0c140c";
        g.beginPath();
        g.arc(cx, cy, 2.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#7a9a6a";
        g.fillRect(cx - 3, cy - 4, 2, 1);
      }
  });
}

type Pool = [x: number, y: number, z: number, radius: number, strength: number];

/**
 * Pools of warm lamplight baked into the vertex colours of everything below `maxY` (the PS1 way:
 * the light lives in the corners): each vertex is warmed by the lamps near it, falling off to
 * nothing at the pool's edge. Runs once after the hall is built (its meshes are merged by then).
 */
function bakePools(group: THREE.Group, pools: Pool[], maxY: number): void {
  for (const o of group.children) {
    const m = o as THREE.Mesh;
    if (!m.isMesh) continue;
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
    const col = m.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
    if (!pos || !col) continue;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y > maxY) continue;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let w = 0;
      for (const [px, py, pz, rad, k] of pools) {
        const d = Math.hypot(x - px, (y - py) * 1.2, z - pz);
        if (d < rad) w += k * (1 - d / rad) ** 2;
      }
      if (w <= 0) continue;
      col.setXYZ(i, col.getX(i) * (1 + w * 1.7), col.getY(i) * (1 + w * 1.15), col.getZ(i) * (1 + w * 0.55));
    }
    col.needsUpdate = true;
  }
}

function looksAdd(list: Lookable[], id: string, x: number, z: number, r: number, label: string, text: string, y?: number): void {
  list.push({ id, x, z, r, label, text, ...(y !== undefined ? { y } : {}) });
}

/** A wall box with rectangular holes (doorways, windows): `along` x (its face across z t0..t1) or z (across x). Holes: [a0, a1, y0, y1]. */
function holed(k: Kit, along: "x" | "z", a0: number, a1: number, t0: number, t1: number, y0: number, y1: number, holes: Array<[number, number, number, number]>, m: MatDef, tile = 2): void {
  // a wall reaches a little under the floor and into the ceiling: the PS1 vertex snap never opens a seam there
  y0 -= 0.12;
  y1 += 0.12;
  const uniq = (v: number[]) => [...new Set(v.map((q) => +q.toFixed(4)))].sort((p, q) => p - q);
  const as = uniq([a0, a1, ...holes.flatMap(([h0, h1]) => [h0, h1])].filter((v) => v >= a0 && v <= a1));
  const ys = uniq([y0, y1, ...holes.flatMap(([, , h0, h1]) => [h0, h1])].filter((v) => v >= y0 && v <= y1));
  const cut = (a: number, y: number) => holes.some(([h0, h1, hy0, hy1]) => a > h0 && a < h1 && y > hy0 && y < hy1);
  for (let i = 0; i + 1 < as.length; i++) {
    const am = (as[i] + as[i + 1]) / 2;
    let start = -1;
    for (let j = 0; j <= ys.length - 1; j++) {
      const solid = j < ys.length - 1 && !cut(am, (ys[j] + ys[j + 1]) / 2);
      if (solid && start < 0) start = j;
      if (!solid && start >= 0) {
        const ya = ys[start];
        const yb = ys[j];
        const w = as[i + 1] - as[i];
        if (along === "x") k.box(w, yb - ya, t1 - t0, am, (ya + yb) / 2, (t0 + t1) / 2, m, { tile });
        else k.box(t1 - t0, yb - ya, w, (t0 + t1) / 2, (ya + yb) / 2, am, m, { tile });
        start = -1;
      }
    }
  }
}

/** A window seen from inside: a pane glowing with the day, a stone frame and a sill, on a wall's inner face (facing `dir` along z or x). */
function windowIn(k: Kit, along: "x" | "z", a: number, face: number, dir: 1 | -1, y0: number, y1: number, w: number, pane: MatDef, frame: MatDef): void {
  const ry = along === "x" ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  const at = (s: number, off: number): [number, number] => (along === "x" ? [a + s, face + dir * off] : [face + dir * off, a + s]);
  const [px, pz] = at(0, 0.02);
  k.plane(w, y1 - y0, px, (y0 + y1) / 2, pz, pane, { ry });
  // the cross of the mullion and the transom, the frame round it, the sill
  const bar = (bw: number, bh: number, s: number, y: number) => {
    const [x, z] = at(s, 0.05);
    if (along === "x") k.box(bw, bh, 0.08, x, y, z, frame);
    else k.box(0.08, bh, bw, x, y, z, frame);
  };
  bar(0.1, y1 - y0, 0, (y0 + y1) / 2);
  bar(w, 0.1, 0, y0 + (y1 - y0) * 0.62);
  for (const s of [-1, 1]) bar(0.16, y1 - y0 + 0.2, (s * (w + 0.16)) / 2, (y0 + y1) / 2);
  bar(w + 0.32, 0.16, 0, y1 + 0.08);
  const [sx, sz] = at(0, 0.12);
  if (along === "x") k.box(w + 0.4, 0.1, 0.24, sx, y0 - 0.05, sz, frame);
  else k.box(0.24, 0.1, w + 0.4, sx, y0 - 0.05, sz, frame);
}

// ================================================================ the town hall

/**
 * The Stadhuis (Cornelis Floris, 1561-65), as its offices were in 1873, standing in the world inside its
 * shell (M7 halls; the plan: shared/townhallPlan.ts): the vestibule behind the main door with the porter's
 * lodge and the notice board, the old inner courtyard roofed with glass and made into the great staircase
 * hall (Bourla's work, earlier in the century) with galleries round it, the civil registry's counter and
 * the clerks' office on the right; upstairs the wedding hall over the office (the Floris chimneypiece with
 * its two alabaster caryatids, windows on the Grote Markt), the aldermen's room behind it and the Leys hall
 * (Hendrik Leys's history paintings, inaugurated in 1870) on the left. A notice board by the door shows the
 * bills pasted up in the town.
 */
export function buildTownhall(): LandmarkRoom {
  const P = TH.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x2e2a22);
  // in the world the hall is drawn over the street (world/inworld.ts): no background of its own
  scene.background = null;
  group.position.y = TH.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 16;
  fog.far = 75;
  const k = new Kit(group);
  k.shadeTop = 12;
  const { UP, CEIL0: C0, CEIL1: C1, GLASS_Y: GY, VEST, COURT, OFFICE, LANDING, WEDDING, ALDERMEN, LEYS, FRONT, DOOR, STAIR } = TH;
  const floorM = lmMat("lm_th_floor", { map: slabs(7), color: 0xd0ccc4 }, 0.1, 0.01); // (bump maps on every floor, 2026-09-26)
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  // a wall reaches a little under the floor and into the ceiling: the PS1 vertex snap never opens a seam there
  const wall = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2) => box(x0, x1, y0 - 0.12, y1 + 0.12, z0, z1, m, tile);
  const floor = (r: Rect, y: number, m: MatDef, tile = 1.6) => k.box(r.maxX - r.minX, 0.1, r.maxZ - r.minZ, (r.minX + r.maxX) / 2, y - 0.05, (r.minZ + r.maxZ) / 2, m, { tile, flat: true });
  const ceiling = (r: Rect, y: number, m: MatDef = H.plaster) => k.box(r.maxX - r.minX, 0.25, r.maxZ - r.minZ, (r.minX + r.maxX) / 2, y + 0.125, (r.minZ + r.maxZ) / 2, m, { tile: 1.2 });
  const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

  // ---- floors: the ground floor's slabs and boards, the first floor's boards (over the office's ceiling)
  floor(R(-DOOR.hw - 0.2, DOOR.hw + 0.2, -0.02, FRONT.z1), 0, floorM);
  floor(VEST, 0, floorM);
  floor(R(-2.4, 2.4, VEST.maxZ, COURT.minZ), 0, floorM);
  floor(COURT, 0, floorM);
  floor(R(7.8, 8.5, 10.5, 13.5), 0, H.boards);
  floor(OFFICE, 0, H.boards, 1.4);
  const slab = (r: Rect) => k.box(r.maxX - r.minX, 0.3, r.maxZ - r.minZ, (r.minX + r.maxX) / 2, UP - 0.15, (r.minZ + r.maxZ) / 2, H.boards, { tile: 1.2, flat: true });
  slab(R(8.3, 24.6, FRONT.z0, 24.38));
  slab(R(-20.6, -8.3, FRONT.z0, 16.6));
  slab(R(5.9, 7.8, COURT.minZ, COURT.maxZ));
  slab(R(-7.8, -5.9, COURT.minZ, COURT.maxZ));
  slab(R(-5.9, 5.9, COURT.minZ, 10.4));
  slab(R(-7.9, 7.9, COURT.maxZ, 26.38));

  // ---- the front wall: the doorway's reveal (from the door's plane, where the portal ends), the vestibule, the office
  const DH = DOOR.h;
  for (const s of [-1, 1]) box(s > 0 ? DOOR.hw : -DOOR.hw - 0.3, s > 0 ? DOOR.hw + 0.3 : -DOOR.hw, 0, DH + 0.3, 0.0, FRONT.z0, M.stone, 1.6);
  box(-DOOR.hw - 0.3, DOOR.hw + 0.3, DH, DH + 0.3, 0.0, FRONT.z0, M.stone, 1.6);
  holed(k, "x", -5.4, 5.4, FRONT.z0, FRONT.z1, 0, C0, [[-DOOR.hw, DOOR.hw, -1, DH]], M.stone, 1.6);
  // the frontispiece's two side doors, shut from within
  for (const x of TH.SHELL.sideDoors) {
    box(x - 0.75, x + 0.75, 0, 3.3, FRONT.z1, FRONT.z1 + 0.08, M.oakDark, 1);
    box(x - 0.9, x + 0.9, 3.3, 3.5, FRONT.z1, FRONT.z1 + 0.14, M.stoneDark, 1);
  }
  const winGround = glassMat("grisaille", 43);
  const winUp = glassMat("grisaille", 42);
  holed(k, "x", 8.3, 20.6, FRONT.z0, FRONT.z1, 0, C0, TH.OFFICE_WINDOWS.map((x) => [x - 0.75, x + 0.75, 1.0, 5.0] as [number, number, number, number]), H.plaster);
  for (const x of TH.OFFICE_WINDOWS) windowIn(k, "x", x, FRONT.z1, 1, 1.0, 5.0, 1.5, winGround.def, M.stone);

  // ---- the vestibule: its walls and coffered ceiling, the porter's lodge, the notice board
  for (const s of [-1, 1]) wall(s > 0 ? VEST.maxX : VEST.minX - 0.4, s > 0 ? VEST.maxX + 0.4 : VEST.minX, 0, C0, FRONT.z0, VEST.maxZ + 0.4, M.stone, 1.6);
  ceiling(R(-5.4, 5.4, FRONT.z0, VEST.maxZ), C0);
  for (let z = 2.2; z < VEST.maxZ; z += 2.1) box(-5, 5, C0 - 0.3, C0, z - 0.12, z + 0.12, M.oakDark, 1);
  // the lodge: a glazed booth, its door at the back (to the vestibule)
  const LD = TH.LODGE_DOOR;
  box(-5, LD.x0, 0, 1.1, 5.15, 5.25, H.panel, 0.8);
  box(-2.45, -2.35, 0, 1.1, FRONT.z1, 5.2, H.panel, 0.8);
  k.box(0.08, 1.4, 4.0, -2.4, 1.8, 3.15, H.glassCase);
  k.box(LD.x0 + 5, 1.4, 0.08, (-5 + LD.x0) / 2, 1.8, 5.2, H.glassCase);
  box(LD.x0 - 0.06, LD.x0, 0, 2.5, 5.12, 5.28, M.oakDark, 1); // the door's posts, the door open inward
  box(LD.x1, LD.x1 + 0.06, 0, 2.5, 5.12, 5.28, M.oakDark, 1);
  box(LD.x1 - 0.05, LD.x1 + 0.01, 0, 2.1, 5.2, 4.45, M.oakDark, 1);
  box(LD.x1, -2.35, 0, 1.1, 5.15, 5.25, H.panel, 0.8);
  box(-5, -2.35, 2.5, 2.6, FRONT.z1, 5.3, H.panel, 1);
  desk(k, -4.3, 0, 3.0, 1.0, Math.PI / 2);
  k.box(0.08, 1.6, 2.6, 4.95, 1.9, TH.BOARD.z, H.panel);
  for (let i = 0; i < 6; i++) k.plane(0.55, 0.8, 4.9, 1.45 + (i % 2) * 0.85, TH.BOARD.z - 0.95 + Math.floor(i / 2) * 0.9, billMats[i % 4], { ry: -Math.PI / 2 });

  // ---- the staircase hall: the old courtyard under a glass roof, galleries on Floris's arcades
  const courtWall = (s: 1 | -1, doors: Array<[number, number, number, number]>) =>
    holed(k, "z", COURT.minZ - 0.4, COURT.maxZ + 0.4, s > 0 ? 7.8 : -8.5, s > 0 ? 8.5 : -7.8, 0, GY + 0.3, doors, M.stone, 1.6);
  courtWall(1, [
    [10.5, 13.5, -1, 3.3], // into the office
    [12.2, 14.2, UP - 0.1, UP + 3.0], // the wedding hall
    [19.2, 21.2, UP - 0.1, UP + 3.0], // the aldermen's room
  ]);
  courtWall(-1, [[12.2, 14.2, UP - 0.1, UP + 3.0]]); // the Leys hall
  // the same walls on to the front, beside the vestibule: the office's and the wedding hall's, the Leys hall's
  wall(7.8, 8.5, 0, C1, FRONT.z0, COURT.minZ - 0.4, H.plaster);
  wall(-8.5, -7.8, UP - 0.3, C1, FRONT.z0, COURT.minZ - 0.4, H.plaster);
  // the vestibule's back wall to the court: a round-headed arch through it
  holed(k, "x", -7.8, 7.8, VEST.maxZ, COURT.minZ, 0, GY + 0.3, [[-2.4, 2.4, -1, 4.2]], M.stone, 1.6);
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI;
    k.box(0.5, 0.35, 0.5, Math.cos(a) * 2.4, 4.2 + Math.sin(a) * 0.9, COURT.minZ + 0.05, M.stoneDark, { rz: a - Math.PI / 2 });
  }
  box(-2.4, 2.4, 4.2, 5.1, VEST.maxZ - 0.02, COURT.minZ + 0.02, M.stone, 1.6);
  // under the landing, and over its ceiling up to the glass
  wall(-7.8, 7.8, 0, UP - 0.3, COURT.maxZ, COURT.maxZ + 0.4, M.stone, 1.6);
  wall(-7.8, 7.8, C1, GY + 0.3, COURT.maxZ, COURT.maxZ + 0.4, M.stone, 1.6);
  // the landing in the stair block: its walls and ceiling
  for (const s of [-1, 1]) wall(s > 0 ? LANDING.maxX : -7.9, s > 0 ? 7.9 : LANDING.minX, UP, C1, COURT.maxZ, 26.38, M.stone, 1.6);
  wall(-7.9, 7.9, UP, C1, LANDING.maxZ, 26.38, M.stone, 1.6);
  ceiling(R(-7.9, 7.9, COURT.maxZ, 26.38), C1);
  // the arcade's shafts under the galleries, string courses round the court
  for (const [x, z] of TH.SHAFTS) {
    k.cyl(0.18, 0.21, UP - 0.6, x, 0, z, M.stoneDark, { seg: 6 });
    k.box(0.55, 0.3, 0.55, x, UP - 0.45, z, M.stone);
  }
  for (const y of [UP - 0.3, C1]) {
    box(-7.8, 7.8, y - 0.3, y, COURT.minZ, COURT.minZ + 0.25, M.stoneDark, 1.5);
    for (const s of [-1, 1]) box(s > 0 ? 7.55 : -7.8, s > 0 ? 7.8 : -7.55, y - 0.3, y, COURT.minZ, COURT.maxZ, M.stoneDark, 1.5);
  }
  // the galleries' balustrades
  const rail = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0);
    k.box(0.14, 0.1, L, (x0 + x1) / 2, UP + 0.95, (z0 + z1) / 2, M.marbleW, { ry });
    k.box(0.2, 0.12, L, (x0 + x1) / 2, UP + 0.06, (z0 + z1) / 2, M.marbleW, { ry });
    for (let d = 0.2; d < L; d += 0.42) k.cyl(0.045, 0.065, 0.85, x0 + ((x1 - x0) * d) / L, UP + 0.08, z0 + ((z1 - z0) * d) / L, M.marbleW, { seg: 4 });
  };
  rail(5.9, 10.4, 5.9, COURT.maxZ);
  rail(-5.9, 10.4, -5.9, COURT.maxZ);
  rail(-5.9, 10.4, 5.9, 10.4);
  rail(-5.9, COURT.maxZ + 0.05, -STAIR.rect.maxX - 0.15, COURT.maxZ + 0.05);
  rail(STAIR.rect.maxX + 0.15, COURT.maxZ + 0.05, 5.9, COURT.maxZ + 0.05);
  // the glass roof on iron bars
  const roofGlass = glassMat("grisaille", 41);
  for (let x = -6.24; x <= 6.3; x += 3.12) k.plane(3.1, COURT.maxZ - COURT.minZ, x, GY, (COURT.minZ + COURT.maxZ) / 2, roofGlass.def, { rx: Math.PI / 2 });
  for (let x = -7.8; x <= 7.9; x += 3.12) box(x - 0.06, x + 0.06, GY - 0.05, GY + 0.2, COURT.minZ, COURT.maxZ, M.iron, 1);
  for (let z = COURT.minZ + 2.7; z < COURT.maxZ; z += 2.7) box(-7.8, 7.8, GY - 0.05, GY + 0.12, z - 0.05, z + 0.05, M.iron, 1);
  // the grand stair: white stone steps, balustrades, a newel post either side at the foot
  stairSteps(k, STAIR, M.marbleW, M.marbleB);
  for (const x of [STAIR.rect.minX, STAIR.rect.maxX]) k.cyl(0.14, 0.18, 1.1, x, 0, STAIR.foot - 0.1, M.marbleB, { seg: 6 });

  // ---- the clerks' office: the civil registry's counter, desks, shelves of registers, the callers' bench
  wall(OFFICE.maxX, OFFICE.maxX + 0.4, 0, C0, FRONT.z0, OFFICE.maxZ + 0.4, H.plaster);
  wall(8.3, OFFICE.maxX + 0.4, 0, C0, OFFICE.maxZ, OFFICE.maxZ + 0.4, H.plaster);
  ceiling(R(8.3, OFFICE.maxX + 0.4, FRONT.z0, OFFICE.maxZ + 0.4), C0 - 0.25);
  const Cn = TH.COUNTER;
  box(Cn.x0, Cn.x1, 0, 1.05, Cn.z0, Cn.z1, H.panel, 1);
  box(Cn.x0 - 0.1, Cn.x1 + 0.1, 1.05, 1.11, Cn.z0 - 0.05, Cn.z1 + 0.05, M.oakDark, 1);
  k.box(0.3, 0.05, 0.4, (Cn.x0 + Cn.x1) / 2, 1.14, 9.4, H.paper);
  k.box(0.36, 0.06, 0.5, (Cn.x0 + Cn.x1) / 2, 1.14, 9.9, M.oakDark);
  for (const [x, z] of TH.DESKS) {
    desk(k, x, 0, z, 1.3);
    chair(k, x, 0, z - 0.75, 0);
  }
  for (let z = 2.1; z < 15.6; z += 2.2) k.box(0.5, 2.6, 2.0, OFFICE.maxX - 0.3, 1.3, z, H.books, { tile: 1 });
  k.box(TH.BENCH.x1 - TH.BENCH.x0, 0.45, 0.5, (TH.BENCH.x0 + TH.BENCH.x1) / 2, 0.23, TH.BENCH.z, H.panel);
  k.box(TH.BENCH.x1 - TH.BENCH.x0, 0.7, 0.08, (TH.BENCH.x0 + TH.BENCH.x1) / 2, 0.8, OFFICE.maxZ - 0.06, H.panel);
  const bench: Mark[] = TH.PLAN.sets.bench;

  // ---- upstairs: the wedding hall (gilded leather over panelling, windows on the square, the chimneypiece)
  holed(k, "x", 8.3, 24.6, FRONT.z0, FRONT.z1, UP, C1, TH.WEDDING_WINDOWS.map((x) => [x - 0.78, x + 0.78, UP + 1.5, UP + 5.4] as [number, number, number, number]), H.leather, 1.2);
  for (const x of TH.WEDDING_WINDOWS) windowIn(k, "x", x, FRONT.z1, 1, UP + 1.5, UP + 5.4, 1.56, winUp.def, M.stone);
  wall(WEDDING.maxX, WEDDING.maxX + 0.4, UP, C1, FRONT.z0, 17.0, H.leather, 1.2);
  wall(8.3, WEDDING.maxX + 0.4, UP, C1, WEDDING.maxZ, 17.0, H.leather, 1.2);
  box(8.5, WEDDING.maxX, UP, UP + 1.2, FRONT.z1, FRONT.z1 + 0.1, H.panel, 1);
  box(WEDDING.maxX - 0.1, WEDDING.maxX, UP, UP + 1.2, FRONT.z1, WEDDING.maxZ, H.panel, 1);
  ceiling(R(8.3, 24.6, FRONT.z0, 17.0), C1);
  for (let x = 10; x < WEDDING.maxX; x += 2.5) box(x - 0.15, x + 0.15, C1 - 0.35, C1, FRONT.z1, WEDDING.maxZ, M.oakDark, 1);
  // the Floris chimneypiece on the back wall: two alabaster caryatids carry the mantel; a fire burns
  const FX = TH.CHIMNEY.x;
  const FZ = TH.CHIMNEY.z;
  box(FX - 1.3, FX + 1.3, UP, UP + 1.4, FZ - 0.5, FZ, M.black, 1);
  for (const w of [-1.15, 1.15]) {
    k.cyl(0.16, 0.2, 1.3, FX + w, UP, FZ - 0.4, H.alabaster, { seg: 6 });
    k.cyl(0.13, 0.13, 0.25, FX + w, UP + 1.3, FZ - 0.4, H.alabaster, { seg: 6 });
  }
  box(FX - 1.6, FX + 1.6, UP + 1.55, UP + 1.9, FZ - 0.7, FZ, M.marbleB, 1);
  box(FX - 1.3, FX + 1.3, UP + 1.9, UP + 4.1, FZ - 0.35, FZ, M.marbleW, 1);
  k.plane(1.9, 1.6, FX, UP + 3.0, FZ - 0.36, paintMat("history", 3), { ry: Math.PI });
  const fireW = toWorld(FX, FZ - 0.3, UP + 0.1);
  const fires = createFires(scene, [{ x: fireW.x, y: fireW.y, z: fireW.z, size: 0.5 }]);
  for (const x of [11.0, 19.6]) {
    k.box(1.4, 1.8, 0.08, x, UP + 3.0, FZ - 0.04, M.gilt);
    k.plane(1.2, 1.6, x, UP + 3.0, FZ - 0.09, paintMat("portrait", Math.round(x * 7)), { ry: Math.PI });
  }
  // the table with its green cloth, the register, the alderman's chair; the rows of chairs facing it
  const TB = TH.TABLE;
  k.box(1.4, 0.8, 4.4, TB.x, UP + 0.4, TB.z, H.green);
  k.box(1.5, 0.05, 4.5, TB.x, UP + 0.82, TB.z, H.green);
  k.box(0.42, 0.03, 0.6, TB.x, UP + 0.86, TB.z - 1.2, H.paper);
  k.box(0.6, 0.08, 0.9, TB.x + 0.1, UP + 0.92, TB.z - 1.2, M.oakDark); // the register
  chair(k, TB.x + 1.0, UP, TB.z, -Math.PI / 2, true);
  chair(k, TB.x + 1.0, UP, TB.z - 1.6, -Math.PI / 2);
  const wChairs = TH.PLAN.sets.weddingChairs;
  for (const c of wChairs) chair(k, c.x - 0.02, UP, c.z, Math.PI / 2);
  // a crown of candles
  const CR = TH.CROWN;
  k.cyl(0.02, 0.02, C1 - UP - 3.2, CR.x, UP + 3.2, CR.z, M.iron, { seg: 3 });
  k.cyl(0.8, 0.8, 0.07, CR.x, UP + 3.1, CR.z, M.brass, { seg: 10, open: true });

  // ---- the aldermen's room: a desk, a portrait of the King, shelves
  wall(ALDERMEN.maxX, ALDERMEN.maxX + 0.4, UP, C1, 17.0, 24.38, H.plaster);
  wall(8.3, ALDERMEN.maxX + 0.4, UP, C1, ALDERMEN.maxZ, 24.38, H.plaster);
  wall(7.8, 8.5, UP, C1, COURT.maxZ, 24.38, H.plaster); // its wall to the landing, behind the court's
  ceiling(R(7.8, ALDERMEN.maxX + 0.4, 17.0, 24.38), C1);
  desk(k, TH.ALD_DESK.x, UP, TH.ALD_DESK.z, 1.8);
  chair(k, TH.ALD_DESK.x, UP, TH.ALD_DESK.z + 0.9, Math.PI, true);
  k.box(0.08, 1.8, 1.4, ALDERMEN.maxX - 0.07, UP + 2.8, 20.6, M.gilt);
  k.plane(1.2, 1.6, ALDERMEN.maxX - 0.12, UP + 2.8, 20.6, paintMat("portrait", 99), { ry: -Math.PI / 2 });
  for (let x = 10; x < ALDERMEN.maxX - 0.5; x += 2.2) k.box(2.0, 2.4, 0.4, x, UP + 1.2, ALDERMEN.maxZ - 0.22, H.books);

  // ---- the Leys hall: history paintings round the walls (1870), a long table
  holed(k, "x", -20.6, -8.3, FRONT.z0, FRONT.z1, UP, C1, TH.LEYS_WINDOWS.map((x) => [x - 0.78, x + 0.78, UP + 1.5, UP + 5.4] as [number, number, number, number]), H.plaster);
  for (const x of TH.LEYS_WINDOWS) windowIn(k, "x", x, FRONT.z1, 1, UP + 1.5, UP + 5.4, 1.56, winUp.def, M.stone);
  wall(-20.6, LEYS.minX, UP, C1, FRONT.z0, 16.6, H.plaster);
  wall(-20.6, -8.3, UP, C1, LEYS.maxZ, 16.6, H.plaster);
  ceiling(R(-20.6, -8.3, FRONT.z0, 16.6), C1);
  for (const [x, z, ry, w] of [[-11.8, LEYS.maxZ - 0.07, Math.PI, 3.6], [-16.8, LEYS.maxZ - 0.07, Math.PI, 3.6], [LEYS.minX + 0.07, 5.0, Math.PI / 2, 4.4], [LEYS.minX + 0.07, 11.0, Math.PI / 2, 4.4]] as Array<[number, number, number, number]>) {
    k.plane(w, 3.0, x, UP + 2.7, z, paintMat("history", Math.round(x * 3 + z)), { ry });
  }
  k.box(1.2, 0.8, 5, TH.LEYS_TABLE.x, UP + 0.4, TH.LEYS_TABLE.z, M.oakDark);

  k.finish();

  // light: the day from the glass roof and the windows; lamps and candles at dusk
  const L = lights(scene, 0xd8d8e0, 0x7a6a56, 0x5a4e40);
  const lampHall = point(group, 0xffb070, 0, 5, 15, 24);
  const lampVest = point(group, 0xffb070, 0, 4, 4.5, 10);
  const lampUp = point(group, 0xffb070, CR.x, UP + 2.8, CR.z, 16);
  const lampOffice = point(group, 0xffb070, 15, 3, 9, 13);
  const lampLeys = point(group, 0xffb070, -14.3, UP + 3, 8.6, 12);
  const fireL = point(group, 0xff8a40, FX, UP + 0.6, FZ - 0.9, 8);
  const candles = new Flames(group, 12, 0.15);
  for (let i = 0; i < 10; i++) candles.addFlame(CR.x + Math.cos((i / 10) * Math.PI * 2) * 0.8, UP + 3.25, CR.z + Math.sin((i / 10) * Math.PI * 2) * 0.8);
  const shaftMat = shaftMaterial();
  lightShaft(group, new THREE.Vector3(-2, GY - 0.2, 13), new THREE.Vector3(1, 0, 17), 3, shaftMat);
  lightShaft(group, new THREE.Vector3(3, GY - 0.2, 18), new THREE.Vector3(4.5, 0, 20.5), 2.2, shaftMat);

  // walking: by the plan (Jef in the world by World.addWalkArea; the people on the ground floor's graph)
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const looks: Lookable[] = [];
  looksAdd(looks, "board", 4.2, TH.BOARD.z, 1.5, "read the notice board", "The notice board by the door: a proclamation of the College of Burgomaster and Aldermen about dogs without muzzles, and the militia lists. Nothing new pasted up today.");
  looksAdd(looks, "register", 11.9, 9.6, 1.4, "look at the register on the counter", "The register of the civil state lies open on the counter: births, deaths and marriages in a clerk's copperplate. Nothing written in it yet today.");
  looksAdd(looks, "stair", 0, 9.8, 1.6, "look up the staircase", "The old courtyard of the town hall, roofed over with glass, and a great stair of white stone going up to the fine floor. Floris's arcades carry the galleries round it.");
  looksAdd(looks, "chimney", FX, FZ - 1.6, 1.8, "look at the chimneypiece", "The chimneypiece of the wedding hall: two women carved in alabaster carry the mantel on their heads, three hundred years old and scorched by the fire of the Spanish Fury. A fire burns under them.", UP);
  looksAdd(looks, "leys", -14.3, 12.6, 2.5, "look at the paintings", "The Leys hall: Hendrik Leys painted the town's old privileges and its burghers on these walls, finished only three years ago. Dark, stiff, splendid figures in black and red.", UP);
  looksAdd(looks, "square", 13.86, 2.2, 1.4, "look out at the square", "The Grote Markt through small leaded panes: the guild houses, the stalls, a dray at the well. The glass is old and bends the gables a little.", UP);
  // Jef may sit on the callers' bench and on the wedding hall's chairs at the ends of the front row
  const seats: Seat[] = [
    ...bench.map((b, i) => ({ x: b.x, z: b.z, yaw: Math.PI, table: 30 + i, h: 0.45, via: [] })),
    ...wChairs.filter((c) => c.x > 18 && (c.z === TH.ROW_Z[0] || c.z === TH.ROW_Z[5])).map((c, i) => ({ x: c.x, z: c.z, yaw: c.yaw, table: 40 + i, h: 0.46, via: [] })),
  ];
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const glasses = [roofGlass, winGround, winUp];
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    L.hemi.intensity = (1.6 + 2.6 * d) * ambK;
    L.amb.intensity = (0.9 + 0.4 * day) * ambK;
    for (const g of glasses) g.mat().color.setScalar(0.12 + 0.95 * day * sky);
    shaftMat.opacity = Math.max(0, day - 0.3) * 0.22 * Math.max(0, sky - 0.55) * 2.2;
    nightAir(L, glasses, day, sky);
  };
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "townhall",
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : free(x, fz) ? [x, fz] : free(fx, z) ? [fx, z] : [fx, fz]),
    floor: (x, z) => HP.floorAt(P, x, z, 0),
    peopleFloor: () => 0,
    seats,
    stands: [],
    exit: { ...P.marks.door, yaw: Math.PI },
    entry: { ...P.marks.door },
    entries: { main: { ...P.marks.door } },
    exits: { main: { ...P.marks.door, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.3,
    eye: 1.62,
    surface: "stone",
    sound: "hall",
    marks: { ...P.marks },
    sets: { ...P.sets },
    looks,
    path,
    setDaylight(kd, weather = 1) {
      day = kd;
      sky = weather;
      light();
      candles.showFirst(kd < 0.4 ? 12 : 0);
    },
    setAmbient(a) {
      ambK = a;
      light();
    },
    update(t) {
      fires.update(t);
      candles.update(t);
      const f = flicker(t, 3.1);
      // (the lamps burn all night, the hall shut or not: the porter's, the stair's, the offices')
      const dusk = 0.2 + 1.1 * (1 - THREE.MathUtils.smoothstep(day, 0.2, 0.5));
      lampHall.intensity = 5 * dusk * f;
      lampVest.intensity = 3 * dusk * f;
      lampUp.intensity = 4 * dusk * f;
      lampOffice.intensity = 4 * dusk * flicker(t, 1.3);
      lampLeys.intensity = 3 * dusk * flicker(t, 2.2);
      fireL.intensity = 6 * flicker(t * 1.6, 9);
      room.lamps = [{ p: fireW, w: 0.35 * f }];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

// ================================================================ the Vleeshuis

/**
 * The Vleeshuis in 1873, standing in the world inside its shell (M7 halls; the plan: shared/vleeshuisPlan.ts):
 * not the butchers' hall any more but the wine merchant Peyrot's warehouse (he bought it in 1841). The ground
 * floor's three aisles under brick vaults on stone columns, full of casks on stillages; cellarmen roll them
 * along the floor; the cellar master's desk by the south door, the hoist by the north door, the tasting table.
 * Upstairs, over the vaults and up the long stair along the north wall: the theatre hall that the society
 * Liefde en Eendragt used (a small stage at the east end with a painted backcloth, curtains, footlights,
 * benches) and a painter's studio at the west end under the gable's windows (painters rented studios there).
 */
export function buildVleeshuis(): LandmarkRoom {
  const P = VH.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x241a12);
  scene.background = null;
  group.position.y = VH.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 12;
  fog.far = 55;
  const k = new Kit(group);
  k.shadeTop = 9;
  const { IN, UP, CEIL1, VAULT, STAIR, SHELL: S } = VH;
  const X0 = IN.east;
  const X1 = IN.west;
  const Z0 = IN.south;
  const Z1 = IN.north;
  const D = Z1 - Z0;
  const DOOR = S.door;
  const DH = DOOR.spring - VH.FLOOR_Y;
  const NX = S.north_door_x;
  const r = rand(77);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

  // ---- the ground floor: slabs cut into metre squares so the lanterns' pools of light sit in their corners (baked below)
  {
    const fg = new THREE.PlaneGeometry(X1 - X0, D, Math.round(X1 - X0), Math.round(D));
    fg.rotateX(-Math.PI / 2);
    const fp = fg.getAttribute("position") as THREE.BufferAttribute;
    const fu = fg.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < fu.count; i++) fu.setXY(i, fp.getX(i) / 1.8, fp.getZ(i) / 1.8);
    k.add(fg, lmMat("lm_vh_floor", { map: slabs(8), color: 0xd8d0c4 }, 0.1, 0.01), (X0 + X1) / 2, 0, (Z0 + Z1) / 2, { flat: true });
  }
  const bluestone = lmMat("lm_vh_blue", { map: ashlar(33, [96, 102, 112]), color: 0xb0b4c0 }, 0.1);
  box(-DOOR.hw - 0.1, DOOR.hw + 0.1, -0.1, 0, -0.02, Z0, bluestone, 1); // the doorway's sill
  box(NX - DOOR.hw - 0.1, NX + DOOR.hw + 0.1, -0.1, 0, Z1, 14.72, bluestone, 1);

  // ---- the walls: brick below the upper floor, whitewash above; the doorways, the great windows, the cross windows
  const winHall = glassMat("grisaille", 52);
  const winUp = glassMat("grisaille", 51);
  const longWall = (z0: number, z1: number, doorX: number, face: number, dir: 1 | -1) => {
    // the ground floor (brick): the doorway under the arch's springing, the great windows of the bays but the door's
    const holes: Array<[number, number, number, number]> = [[doorX - DOOR.hw, doorX + DOOR.hw, -1, DH]];
    for (const bx of S.bays) if (Math.abs(bx - doorX) > 0.5) holes.push([bx - 1.0, bx + 1.0, 2.8, 7.6]);
    holed(k, "x", X0 - 0.65, X1 + 0.55, z0, z1, 0, UP, holes, H.brick, 1.2);
    for (const bx of S.bays) if (Math.abs(bx - doorX) > 0.5) {
      windowIn(k, "x", bx, face, dir, 2.8, 7.6, 2.0, winHall.def, M.stone);
      // the lower lights shuttered (a warehouse now)
      box(bx - 1.0, bx + 1.0, 2.8, 4.2, dir > 0 ? face + 0.02 : face - 0.1, dir > 0 ? face + 0.1 : face - 0.02, M.oakDark, 1);
    }
    // the upper floor (whitewash): cross windows in every bay
    holed(k, "x", X0 - 0.65, X1 + 0.55, z0, z1, UP, CEIL1, S.bays.map((bx) => [bx - 0.8, bx + 0.8, UP + 0.6, UP + 4.3] as [number, number, number, number]), H.plaster, 2);
    for (const bx of S.bays) windowIn(k, "x", bx, face, dir, UP + 0.6, UP + 4.3, 1.6, winUp.def, M.stone);
  };
  // from the doors' planes in: the shell's own reveals (bluestone) stand before them
  longWall(0, Z0, 0, Z0, 1);
  longWall(Z1, P.doors[1].z, NX, Z1, -1);
  const gable = (x0: number, x1: number, face: number, dir: 1 | -1, doors: boolean) => {
    // the east front's two doors are shut (Blender's leaves): oak doors on the inside; the great windows over them
    const holes: Array<[number, number, number, number]> = S.eastDoors.map((z) => [z - 1.1, z + 1.1, (doors ? 4.2 : 2.6), 7.6] as [number, number, number, number]);
    holed(k, "z", Z0 - 0.6, Z1 + 0.6, x0, x1, 0, UP, holes, H.brick, 1.2);
    for (const z of S.eastDoors) windowIn(k, "z", z, face, dir, doors ? 4.2 : 2.6, 7.6, 2.2, winHall.def, M.stone);
    if (doors) for (const z of S.eastDoors) {
      box(face + dir * 0.02, face + dir * 0.1, 0, DH, z - DOOR.hw + 0.1, z + DOOR.hw - 0.1, M.oakDark, 1);
      box(face + dir * 0.02, face + dir * 0.14, DH, DH + 0.2, z - DOOR.hw, z + DOOR.hw, bluestone, 1);
    }
    holed(k, "z", Z0 - 0.6, Z1 + 0.6, x0, x1, UP, CEIL1, S.eastDoors.map((z) => [z - 0.8, z + 0.8, UP + 0.6, UP + 4.3] as [number, number, number, number]), H.plaster, 2);
    for (const z of S.eastDoors) windowIn(k, "z", z, face, dir, UP + 0.6, UP + 4.3, 1.6, winUp.def, M.stone);
  };
  gable(-16.05, X0, X0, 1, true);
  gable(X1, 27.95, X1, -1, false);

  // ---- three aisles of brick vaults on stone columns, the arches along the column lines
  const AW = D / 3;
  // the north aisle is vaulted only east of the long stair; over the stair a timber ceiling, the stairwell open in it
  const VX = STAIR.head - 0.5;
  for (let i = 0; i < 3; i++) k.vault(AW + 0.05, VAULT.spring, VAULT.rise, (i === 2 ? VX : X1) - X0, X0, Z0 + AW * (i + 0.5), H.vaultBrick, { tile: 1.2, ry: Math.PI / 2 });
  k.archWall(AW, UP - 0.3 - VAULT.spring + 0.12, 0.25, AW - 0.1, 0, VAULT.rise, VX, VAULT.spring, Z0 + AW * 2.5, H.vaultBrick, { tile: 1.2, ry: Math.PI / 2 });
  k.box(X1 - VX, 0.3, STAIR.rect.minZ - 0.2 - VH.COL_Z[1], (VX + X1) / 2, UP - 0.45, (STAIR.rect.minZ - 0.2 + VH.COL_Z[1]) / 2, H.timber, { tile: 1.2 });
  for (let x = VX + 1.5; x < X1; x += 1.6) k.box(0.2, 0.3, STAIR.rect.minZ - 0.2 - VH.COL_Z[1], x, UP - 0.75, (STAIR.rect.minZ - 0.2 + VH.COL_Z[1]) / 2, H.timber);
  for (const z of VH.COL_Z) {
    for (const x of VH.COL_X) {
      k.cyl(0.4, 0.46, VAULT.spring - 0.3, x, 0, z, H.stoneGrey, { seg: 8 });
      k.box(1.1, 0.3, 1.1, x, VAULT.spring - 0.15, z, M.stone);
    }
    k.box(X1 - X0, 0.5, 0.55, (X0 + X1) / 2, VAULT.spring + 0.25, z, M.stone, { tile: 1.5 });
  }
  // over the vaults: the upper floor's slab (its underside hidden by the vaults), its boards
  const up0 = (x0: number, x1: number, z0: number, z1: number) => k.box(x1 - x0, 0.3, z1 - z0, (x0 + x1) / 2, UP - 0.15, (z0 + z1) / 2, H.boards, { tile: 1.2, flat: true });
  up0(X0, STAIR.rect.minX, Z0, Z1);
  up0(STAIR.rect.minX, STAIR.foot, Z0, STAIR.rect.minZ - 0.2);
  up0(STAIR.foot, X1, Z0, Z1);

  // ---- Peyrot's wine warehouse: casks lying on timber stillages, two high, heads to the aisles; chalk on the heads
  const wood = lmMat("lm_cask", { map: tex().planks, color: 0xd8a870 }, 0.2);
  const hoop = lmMat("lm_hoop", { color: 0x2a2622, side: THREE.DoubleSide });
  const chalkMat = lmMat("lm_vh_chalk", { map: chalkTex(), transparent: true, alphaTest: 0.35, depthWrite: false }, 0);
  const bottleRack = lmMat("lm_vh_bottles", { map: bottleTex(), color: 0xffffff }, 0.1);
  const bottleGlass = lmMat("lm_vh_glass", { color: 0x1e3a24, emissive: 0x020402 });
  const lanternGlass = lmBasic("lm_vh_lantern", { color: 0xffc478 });
  const chalk = (x: number, y: number, z: number, ry: number) => {
    const g = new THREE.PlaneGeometry(0.34, 0.26);
    const q = Math.floor(r() * 4);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (q % 2) * 0.5 + uv.getX(i) * 0.5, Math.floor(q / 2) * 0.5 + uv.getY(i) * 0.5);
    k.add(g, chalkMat, x, y, z, { ry, rz: (r() - 0.5) * 0.4, flat: true });
  };
  /** A stillage along x at z: two rails, casks lying heads out (to -z and +z), a second tier; chalk on the heads to the aisles. */
  const rack = (x0: number, x1: number, z: number, faces: number[]) => {
    for (const s of [-0.28, 0.28]) k.box(x1 - x0, 0.2, 0.16, (x0 + x1) / 2, 0.1, z + s, H.timber, {});
    for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.82) {
      k.barrel(x, 0.6, z, wood, hoop, { lying: true, ry: Math.PI / 2, tint: 0.8 + r() * 0.35 });
      if (x + 0.8 < x1 && r() < 0.94) k.barrel(x + 0.41, 1.24, z, wood, hoop, { lying: true, ry: Math.PI / 2, tint: 0.75 + r() * 0.35 });
      for (const f of faces) if (r() < 0.6) chalk(x, 0.62, z + f * 0.5, f > 0 ? 0 : Math.PI);
    }
  };
  for (const [x0, x1, z] of VH.RACKS) rack(x0, x1, z, z < 2 ? [1] : z > 13 ? [-1] : [-1, 1]);
  // racks of bottles on the east wall, between its two doors: pigeonholes of dark glass in a timber frame
  for (const b of VH.BOTTLES) {
    k.box(b.maxX - b.minX, 2.1, b.maxZ - b.minZ, (b.minX + b.maxX) / 2, 1.05, (b.minZ + b.maxZ) / 2, bottleRack, { tile: 0.5 });
    for (const z of [b.minZ, (b.minZ + b.maxZ) / 2, b.maxZ]) k.box(0.55, 2.2, 0.08, (b.minX + b.maxX) / 2, 1.1, z, H.timber);
    for (const y of [0.05, 1.05, 2.15]) k.box(0.55, 0.06, b.maxZ - b.minZ, (b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2, H.timber, { tile: 1 });
  }
  // the tasting table in the south aisle: bottles, glasses of red, a candle, the cellar book; a cask on a trestle with its tap
  {
    const TX = VH.TASTING.x;
    const TZ = VH.TASTING.z;
    k.box(1.7, 0.06, 0.8, TX, 0.8, TZ, M.oak);
    for (const [dx, dz] of [[-0.75, -0.32], [0.75, -0.32], [-0.75, 0.32], [0.75, 0.32]]) k.box(0.07, 0.78, 0.07, TX + dx, 0.39, TZ + dz, M.oakDark);
    for (const [sx, sz] of [[-0.4, -0.72], [0.45, 0.7]]) {
      k.cyl(0.19, 0.19, 0.05, TX + sx, 0.45, TZ + sz, M.oak, { seg: 8 });
      k.cyl(0.03, 0.03, 0.43, TX + sx, 0, TZ + sz, M.oakDark, { seg: 4 });
    }
    k.cyl(0.04, 0.045, 0.24, TX - 0.5, 0.83, TZ - 0.1, bottleGlass, { seg: 6 });
    k.cyl(0.016, 0.02, 0.09, TX - 0.5, 1.07, TZ - 0.1, bottleGlass, { seg: 4 });
    k.cyl(0.04, 0.045, 0.24, TX + 0.62, 0.83, TZ + 0.15, bottleGlass, { seg: 6 });
    k.box(0.28, 0.08, 0.08, TX + 0.2, 0.87, TZ - 0.25, bottleGlass, { ry: 0.5 });
    for (const [gx, gz] of [[-0.2, 0.1], [0.05, -0.05], [0.35, 0.18]]) {
      k.cyl(0.006, 0.006, 0.05, TX + gx, 0.83, TZ + gz, bottleGlass, { seg: 3 });
      k.cyl(0.03, 0.02, 0.07, TX + gx, 0.88, TZ + gz, H.cloth, { seg: 5 });
    }
    k.cyl(0.03, 0.035, 0.03, TX, 0.83, TZ, M.oakDark, { seg: 6 });
    k.cyl(0.013, 0.013, 0.13, TX, 0.86, TZ, H.paper, { seg: 5 });
    k.box(0.32, 0.04, 0.24, TX + 0.45, 0.85, TZ - 0.12, H.paper, { ry: -0.2 });
    for (const s of [-0.2, 0.2]) k.box(0.06, 0.62, 0.5, TX - 1.35 + s, 0.31, TZ, H.timber, { rz: s > 0 ? 0.12 : -0.12 });
    k.barrel(TX - 1.35, 0.82, TZ, wood, hoop, { lying: true, r: 0.24, len: 0.62, tint: 0.95 });
    k.box(0.12, 0.04, 0.04, TX - 1.35 + 0.36, 0.74, TZ, M.oakDark);
  }
  // the skids from the north door, casks are rolled in and out on them; the hoist over their foot
  for (const x of [NX - 0.5, NX + 0.5]) k.box(0.14, 0.1, 3.2, x, 0.05, Z1 - 1.6, H.timber);
  for (let i = 0; i < 5; i++) k.box(1.2, 0.05, 0.08, NX, 0.03, Z1 - 0.3 - i * 0.7, H.timber);
  const HX = VH.HOIST.x;
  const HZ = VH.HOIST.z;
  k.box(0.26, 3.3, 0.26, HX, 1.65, HZ, H.timber);
  k.box(2.6, 0.22, 0.22, HX - 1.2, 3.2, HZ, H.timber);
  k.box(0.1, 1.6, 0.1, HX - 0.5, 2.55, HZ, H.timber, { rz: 0.75 });
  k.box(0.16, 0.26, 0.12, NX, 3.0, HZ, M.oakDark);
  // lanterns hanging from the vaults on chains: the pools of warm light the cellar works by
  const AZ = [Z0 + AW / 2, Z0 + AW * 1.5, Z0 + AW * 2.5];
  const LANTERNS: Array<[number, number, number]> = [[-10, 2.75, AZ[1]], [-2.5, 2.75, AZ[1]], [5, 2.75, AZ[1]], [12.5, 2.75, AZ[1]], [20, 2.75, AZ[1]], [-8.5, 2.6, AZ[2]], [NX + 1.0, 2.45, AZ[2] + 0.4], [15, 2.6, AZ[0]], [-4.2, 2.6, AZ[0]], [22, 2.6, AZ[2]]];
  for (const [x, y, z] of LANTERNS) {
    const top = VAULT.spring + VAULT.rise * 0.8;
    k.cyl(0.012, 0.012, top - y - 0.2, x, y + 0.2, z, M.iron, { seg: 3 });
    k.cyl(0.09, 0.14, 0.06, x, y + 0.17, z, M.iron, { seg: 6 });
    k.box(0.2, 0.03, 0.2, x, y - 0.17, z, M.iron);
    for (const [dx, dz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) k.box(0.02, 0.32, 0.02, x + dx, y, z + dz, M.iron);
    k.box(0.16, 0.26, 0.16, x, y, z, lanternGlass, { flat: true });
  }
  // the cellar master's high desk by the south door, a lantern on it
  const DK = VH.DESK;
  k.box(1.2, 1.15, 0.6, DK.x, 0.58, DK.z, M.oakDark);
  k.box(1.3, 0.05, 0.7, DK.x, 1.2, DK.z, M.oak, { rx: -0.15 });
  k.box(0.5, 0.03, 0.35, DK.x, 1.25, DK.z, H.paper, { rx: -0.15 });
  // the long stair along the north wall, rising east to the landing; a timber screen under it to the hall
  stairSteps(k, STAIR, H.timber, M.oakDark);
  k.box(STAIR.foot - STAIR.head - 0.5, UP - 0.5, 0.12, (STAIR.head + STAIR.foot - 0.5) / 2, (UP - 0.5) / 2, STAIR.rect.minZ - 0.08, H.timber, { tile: 1 });

  // ---- upstairs: the theatre hall (a small stage at the east end with a painted backcloth, a proscenium, curtains, footlights; benches)
  const SX = VH.STAGE.x1;
  k.box(SX - X0, 0.8, D, (X0 + SX) / 2, UP + 0.4, (Z0 + Z1) / 2, H.boards, { tile: 1, flat: true });
  k.plane(D - 2, 4.4, X0 + 0.1, UP + 3, (Z0 + Z1) / 2, H.backdrop, { ry: Math.PI / 2 });
  for (const z of [Z0 + 1.2, Z1 - 1.2]) k.box(0.5, 5, 2.4, SX, UP + 2.5, z, H.panel);
  k.box(0.5, 1.0, D, SX, UP + 5.0, (Z0 + Z1) / 2, H.panel);
  for (const s of [-1, 1]) k.box(0.1, 3.9, 1.9, SX - 0.1, UP + 2.75, (Z0 + Z1) / 2 + s * 4.6, H.cloth);
  k.box(0.1, 0.8, D - 5, SX - 0.1, UP + 4.1, (Z0 + Z1) / 2, H.cloth);
  const benches = P.sets.theatreSeats;
  const bseats: Seat[] = [];
  for (const x of VH.BENCH_X) {
    for (const [z0, z1] of VH.BENCH_Z) {
      k.box(0.32, 0.05, z1 - z0, x, UP + 0.45, (z0 + z1) / 2, H.panel);
      for (const z of [z0 + 0.2, z1 - 0.2]) k.box(0.28, 0.43, 0.06, x, UP + 0.215, z, H.panel);
    }
    bseats.push({ x, z: VH.BENCH_Z[0][1] - 0.35, yaw: -Math.PI / 2, table: 60 + Math.round(x * 2), h: 0.47, via: [] }, { x, z: VH.BENCH_Z[1][0] + 0.35, yaw: -Math.PI / 2, table: 90 + Math.round(x * 2), h: 0.47, via: [] });
  }
  // the walls between the theatre and the landing, the landing and the studio (doorways); the rail round the stairwell
  holed(k, "z", Z0, Z1, 7.9, 8.3, UP, CEIL1, [[...VH.THEATRE_DOOR, UP - 1, UP + 2.8]], H.plaster, 2);
  holed(k, "z", Z0, STAIR.rect.minZ - 0.2, 11.2, 11.4, UP, CEIL1, [[...VH.STUDIO_DOOR, UP - 1, UP + 2.8]], H.plaster, 2);
  k.box(STAIR.foot - 11.4, 1.0, 0.1, (STAIR.foot + 11.4) / 2, UP + 0.5, STAIR.rect.minZ - 0.25, M.oakDark);
  k.box(0.1, 1.0, Z1 - STAIR.rect.minZ + 0.2, STAIR.foot + 0.05, UP + 0.5, (Z1 + STAIR.rect.minZ - 0.2) / 2, M.oakDark);
  // the roof trusses over the upper floor, the ceiling
  k.box(X1 - X0 + 1, 0.2, D + 1, (X0 + X1) / 2, CEIL1 + 0.1, (Z0 + Z1) / 2, H.plaster, { tile: 2 });
  for (let x = X0 + 2; x < X1; x += 3.2) k.box(0.3, 0.35, D, x, CEIL1 - 0.2, (Z0 + Z1) / 2, H.timber);
  // the painter's studio: easels with canvases by the gable's windows, the model's dais, a table of pots, a stove
  const easel = (x: number, z: number, yaw: number, kind: "portrait" | "landscape", seed: number) => {
    for (const w of [-0.35, 0.35]) k.box(0.05, 2.0, 0.05, x + Math.cos(yaw) * w, UP + 1.0, z - Math.sin(yaw) * w, H.timber, { ry: yaw, rx: 0.12 });
    k.box(0.05, 1.9, 0.05, x - Math.sin(yaw) * 0.35, UP + 0.95, z - Math.cos(yaw) * 0.35, H.timber, { ry: yaw, rx: -0.3 });
    k.box(0.9, 0.05, 0.12, x, UP + 0.9, z, H.timber, { ry: yaw });
    k.box(0.9, 1.1, 0.04, x + Math.sin(yaw) * 0.06, UP + 1.5, z + Math.cos(yaw) * 0.06, H.paper, { ry: yaw, rx: -0.1 });
    k.plane(0.84, 1.04, x + Math.sin(yaw) * 0.09, UP + 1.5, z + Math.cos(yaw) * 0.09, paintMat(kind, seed), { ry: yaw, rx: -0.1 });
  };
  easel(23.6, 6.5, -Math.PI / 2, "portrait", 61);
  easel(19.0, 9.2, -Math.PI * 0.8, "landscape", 62);
  easel(24.8, 10.0, -Math.PI * 0.35, "landscape", 63);
  k.box(2.8, 0.35, 2.2, 26.0, UP + 0.175, 2.7, H.panel);
  chair(k, 26.0, UP + 0.35, 2.7, -Math.PI / 2);
  k.box(0.05, 1.8, 2.4, X1 - 0.1, UP + 1.3, 2.7, H.cloth);
  k.box(1.6, 0.8, 0.8, 17.4, UP + 0.4, 1.7, M.oakDark);
  for (let i = 0; i < 6; i++) k.cyl(0.05, 0.05, 0.12, 16.9 + i * 0.18, UP + 0.8, 1.7 + (i % 2) * 0.2, H.pot, { seg: 5 });
  k.box(0.8, 1.4, 1.6, 27.0, UP + 0.7, 8.8, M.iron);
  k.cyl(0.08, 0.08, CEIL1 - UP - 1.4, 27.0, UP + 1.4, 8.8, M.iron, { seg: 5 });
  for (let i = 0; i < 5; i++) k.box(0.9, 1.1, 0.04, 12.2 + i * 0.15, UP + 0.55, 1.0, H.paper, { ry: 0.2 });
  k.finish();

  // light: lanterns in the cellar, the windows, the footlights when they play. The pools under the lanterns are
  // baked into the corners of the ground floor (PS1 vertex light); a few real lights flicker on top of them.
  bakePools(group, [...LANTERNS.map(([x, y, z]) => [x, y, z, 7, 2.1] as Pool), [VH.TASTING.x, 0.95, VH.TASTING.z, 3.2, 1.6], [DK.x, 1.6, DK.z, 3.4, 1.0]], UP - 0.4);
  const L = lights(scene, 0x9a8a78, 0x4a3a2a, 0x4a3a2a);
  const lanternA = point(group, 0xffa860, -6.2, 2.6, AZ[1], 13);
  const lanternB = point(group, 0xffa860, 8.7, 2.6, AZ[1], 13);
  const candleL = point(group, 0xffb060, VH.TASTING.x, 1.15, VH.TASTING.z, 4.5);
  const hoistL = point(group, 0xffa860, NX + 1.0, 2.3, AZ[2] + 0.4, 8);
  const deskL = point(group, 0xffb070, DK.x, 1.6, DK.z, 5);
  const stageL = point(group, 0xffc070, SX + 0.6, UP + 1.2, (Z0 + Z1) / 2, 12);
  const hallL = point(group, 0xffb070, -2, UP + 4, (Z0 + Z1) / 2, 18);
  const studioL = point(group, 0xd0d4dc, 22, UP + 3, 6, 16);
  const dayFill = point(group, 0xd0d4dc, 6, 3.2, (Z0 + Z1) / 2, 30);
  const flames = new Flames(group, 20, 0.16);
  for (const [x, y, z] of LANTERNS) flames.addFlame(x, y - 0.02, z);
  flames.addFlame(DK.x, 1.45, DK.z);
  flames.addFlame(VH.TASTING.x, 1.02, VH.TASTING.z);
  const foot = new Flames(group, 12, 0.13);
  for (let z = Z0 + 1.8; z < Z1 - 1.5; z += 1.1) foot.addFlame(SX + 0.35, UP + 0.9, z);
  const shaftMat = shaftMaterial();
  for (const bx of [12.55, 18.7]) lightShaft(group, new THREE.Vector3(bx, 7.2, Z0 + 0.2), new THREE.Vector3(bx + 0.8, 0, 5.2), 1.8, shaftMat);
  lightShaft(group, new THREE.Vector3(X1 - 0.3, UP + 3.0, 3.9), new THREE.Vector3(22.5, UP, 4.4), 1.6, shaftMat);
  let playing = false;
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const hoist = new THREE.Group();
  const hk = new Kit(hoist);
  hk.barrel(0, 0, 0, wood, hoop, { r: 0.3, len: 0.8, tint: 0.9 });
  hk.cyl(0.018, 0.018, 1, 0, 0, 0, H.rope, { seg: 4 });
  const [caskM, hoopM, ropeM] = hk.finish();
  for (const m of [caskM, hoopM]) if (m) m.matrixAutoUpdate = true;
  if (ropeM) ropeM.matrixAutoUpdate = true;
  hoist.position.set(NX, 0, HZ);
  group.add(hoist);

  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const U = UP;
  const looks: Lookable[] = [];
  looksAdd(looks, "barrels", -4, 3.0, 1.8, "look at the barrels", "Barrels of wine in racks two high, stencilled with the names of Bordeaux houses and Rhine towns. The old meat hall smells of oak and must now, not of blood.");
  looksAdd(looks, "vaults", 10.6, 7.35, 1.6, "look up at the vaults", "Brick vaults on stone columns, three aisles of them, built for the butchers' guild in 1504. Soot from lanterns streaks the brick.");
  looksAdd(looks, "tasting", VH.TASTING.x, VH.TASTING.z - 0.9, 1.5, "look at the tasting table", "A table among the casks: two bottles, three glasses with a red rim of wine, a candle stuck in its own wax, the cellar book open at a page of figures. Here the buyers taste before they bargain.");
  looksAdd(looks, "chalk", -4, 7.35, 1.4, "read the chalk on the casks", "Chalk on the cask heads, in the cellar master's hand: a cross, a year, the first letters of a Bordeaux house, a buyer's name half rubbed out.");
  looksAdd(looks, "bottles", X0 + 1.3, 7.4, 1.6, "look at the bottle racks", "Pigeonholes of dark bottles, necks in, dust on every one. The better growths lie down here till they are sold.");
  looksAdd(looks, "hoist", NX + 0.4, 11.4, 1.6, "look at the hoist", "A jib on a post over the skids by the north door, a pulley block and a rope. A cask swings slowly on it, going up to be rolled out or coming down to be laid on the stillage.");
  looksAdd(looks, "stage", SX + 1.6, (Z0 + Z1) / 2, 2.2, "look at the stage", "A small stage with a painted castle and town on the backcloth, red curtains looped back, a row of candle footlights. The society Liefde en Eendragt plays here.", U);
  looksAdd(looks, "studio", 21.5, 7.4, 1.8, "look at the canvases", "A studio: canvases turned to the wall, one on each easel half done, a model's platform with a draped chair. The light falls in a grey sheet from the gable's windows.", U);
  const glasses = [winHall, winUp];
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    L.hemi.intensity = (2.2 + 1.2 * d) * ambK;
    L.amb.intensity = (0.9 + 0.3 * day) * ambK;
    for (const g of glasses) g.mat().color.setScalar(0.12 + 0.9 * day * sky);
    dayFill.intensity = 6 * d;
    studioL.intensity = 5 * d;
    shaftMat.opacity = Math.max(0, day - 0.3) * 0.2 * Math.max(0, sky - 0.55) * 2.2;
    nightAir(L, glasses, day, sky);
  };
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "vleeshuis",
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : free(x, fz) ? [x, fz] : free(fx, z) ? [fx, z] : [fx, fz]),
    floor: (x, z) => HP.floorAt(P, x, z, 0),
    peopleFloor: () => 0,
    seats: bseats,
    stands: [],
    exit: { ...P.marks.door, yaw: Math.PI },
    entry: { ...P.marks.door },
    entries: { main: { ...P.marks.door }, north: { ...P.doors[1].step } },
    exits: { main: { ...P.marks.door, yaw: Math.PI }, north: { ...P.doors[1].step, yaw: 0 } },
    lamps: [],
    toWorld,
    pace: 1.25,
    eye: 1.6,
    surface: "stone",
    sound: "vault",
    marks: { ...P.marks },
    sets: { ...P.sets, theatreSeats: benches },
    looks,
    path,
    setLit(on) {
      playing = on;
      foot.showFirst(on ? 12 : 0);
    },
    // the theatre's windows glow to the street while the society plays (world/hallInWorld.ts GlowPane)
    nightGlow: () => (playing ? 1 : 0),
    setDaylight(kd, weather = 1) {
      day = kd;
      sky = weather;
      light();
    },
    setAmbient(a) {
      ambK = a;
      light();
    },
    update(t) {
      flames.update(t);
      foot.update(t);
      const f = flicker(t, 4.4);
      lanternA.intensity = 11 * f;
      lanternB.intensity = 11 * flicker(t, 1.9);
      candleL.intensity = 3 * flicker(t, 8.3);
      hoistL.intensity = 6 * flicker(t, 3.7);
      deskL.intensity = 2.5 * flicker(t, 6.6);
      // the hoist: the cask goes up and down on its rope, slowly, swinging a little
      const cy = 1.9 + Math.sin(t * 0.21) * 0.75;
      if (caskM) caskM.position.set(Math.sin(t * 0.9) * 0.04, cy, 0);
      if (hoopM) hoopM.position.copy(caskM?.position ?? hoopM.position);
      if (ropeM) {
        ropeM.scale.y = 2.9 - (cy + 0.4);
        ropeM.position.set(0, cy + 0.4, 0);
      }
      stageL.intensity = playing ? 6 * f : 0;
      hallL.intensity = playing ? 3 : day < 0.4 ? 2.4 : 0.8;
      room.lamps = [
        { p: toWorld(-10, AZ[1], 2.75), w: 0.3 * f },
        { p: toWorld(-2.5, AZ[1], 2.75), w: 0.3 * flicker(t, 2.7) },
        { p: toWorld(5, AZ[1], 2.75), w: 0.3 * flicker(t, 1.9) },
        { p: toWorld(12.5, AZ[1], 2.75), w: 0.3 * f },
        { p: toWorld(VH.TASTING.x, VH.TASTING.z, 1.0), w: 0.22 * flicker(t, 8.3) },
        { p: toWorld(NX + 1.0, AZ[2] + 0.4, 2.45), w: 0.28 * flicker(t, 3.7) },
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  void R;
  return room;
}

// ================================================================ the Steen

/**
 * Het Steen as the Museum of Antiquities (opened 1864 in the old castle and prison), standing in the world inside
 * its shell (M7 halls; the plan: shared/steenPlan.ts). From the raised courtyard the door leads into Charles V's
 * gatehouse: arms and armour for looking at only (a suit on its stand, racks of halberds and pikes, a case of
 * swords, a small bronze gun). Through a wide arch the hall of antiquities fills the old prison range: glass cases
 * of finds from the soil and the river (Roman pots and coins, medieval jugs, seals, fossils), tall cabinets, old
 * carved stones along the walls. A stair at its end goes down to the old prison cell under it, the last stop.
 */
export function buildSteen(): LandmarkRoom {
  const P = ST.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x26221c);
  scene.background = null;
  group.position.y = ST.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 12;
  fog.far = 50;
  const k = new Kit(group);
  k.shadeTop = 5;
  const r = rand(91);
  const { IN, SEAM, STAIR, CEIL, CELL_CEIL, DOWN, SHELL: S } = ST;
  const DOOR = S.door;
  const DH = DOOR.spring;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 1.6) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  const floor = lmMat("lm_st_floor", { map: slabs(9), color: 0xd0c8bc }, 0.1, 0.01);
  const win = glassMat("grisaille", 71);

  // ---- floors: the doorway's sill, the gatehouse and the hall (not over the stairwell), the cell's straw
  box(-DOOR.hw - 0.2, DOOR.hw + 0.2, -0.1, 0, -0.3, IN.front, M.stoneDark, 1); // the sill over the gap to the courtyard
  box(SEAM.x1, IN.west, -0.1, 0, IN.front, IN.back, floor, 1.4);
  box(SEAM.x0, SEAM.x1, -0.1, 0, ...SEAM.open, floor, 1.4);
  box(IN.east, SEAM.x0, -0.1, 0, IN.front, STAIR.rect.minZ, floor, 1.4);
  box(IN.east, STAIR.rect.minX, -0.1, 0, STAIR.rect.minZ, IN.back, floor, 1.4);
  box(STAIR.head, SEAM.x0, -0.1, 0, STAIR.rect.minZ, IN.back, floor, 1.4);
  box(IN.east, -8.0, DOWN - 0.1, DOWN, IN.front, IN.back, floor, 1.2);
  box(IN.east, -8.0, DOWN, DOWN + 0.02, IN.front, IN.back, H.straw, 0.8);

  // ---- the walls: Tournai stone. The lane wall with the doorway (the basket arch's springing) and the barred windows
  holed(k, "x", IN.east - 0.5, IN.west + 0.5, 0.2, IN.front, 0, CEIL, [
    [-DOOR.hw, DOOR.hw, -1, DH],
    ...S.windows.map((x) => [x - 0.7, x + 0.7, S.winY[0], S.winY[1]] as [number, number, number, number]),
    ...S.smallWindows.map((x) => [x - 0.35, x + 0.35, S.smallY[0], S.smallY[1]] as [number, number, number, number]),
  ], H.stoneGrey, 1.6);
  for (const x of S.windows) {
    windowIn(k, "x", x, 0.45, 1, S.winY[0], S.winY[1], 1.4, win.def, M.stoneDark);
    for (let i = -2; i <= 2; i++) box(x + i * 0.28 - 0.025, x + i * 0.28 + 0.025, S.winY[0], S.winY[1], 0.52, 0.57, M.iron, 1);
  }
  for (const x of S.smallWindows) {
    windowIn(k, "x", x, 0.45, 1, S.smallY[0], S.smallY[1], 0.7, win.def, M.stoneDark);
    for (let i = -1; i <= 1; i++) box(x + i * 0.2 - 0.02, x + i * 0.2 + 0.02, S.smallY[0], S.smallY[1], 0.52, 0.56, M.iron, 1);
  }
  // the doorway's reveal from the door's plane to the wall
  for (const s of [-1, 1]) box(s > 0 ? DOOR.hw : -DOOR.hw - 0.3, s > 0 ? DOOR.hw + 0.3 : -DOOR.hw, 0, DH + 0.3, 0, 0.2, H.stoneGrey, 1.4);
  box(-DOOR.hw - 0.3, DOOR.hw + 0.3, DH, DH + 0.3, 0, 0.2, H.stoneGrey, 1.4);
  holed(k, "x", IN.east - 0.5, IN.west + 0.5, IN.back, 8.0, DOWN, CEIL, [], H.stoneGrey, 1.6);
  holed(k, "z", 0.2, 8.0, IN.west, 2.7, 0, CEIL, [], H.stoneGrey, 1.6);
  holed(k, "z", 0.2, 8.0, -14.3, IN.east, DOWN, CEIL, [], H.stoneGrey, 1.6);
  // the lane wall down to the cell (behind the hall's floor), the cell's walls to the gatehouse's side
  holed(k, "x", IN.east - 0.5, -7.5, 0.2, IN.front, DOWN, 0, [], H.stoneGrey, 1.6);
  holed(k, "z", IN.front, IN.back, -8.0, -7.5, DOWN, 0, [], H.stoneGrey, 1.6);
  // the wall between the gatehouse and the hall of antiquities: a wide pointed arch through it
  k.archWall(6.8, CEIL + 0.12, SEAM.x1 - SEAM.x0, SEAM.open[1] - SEAM.open[0], 2.6, SEAM.archTop, (SEAM.x0 + SEAM.x1) / 2, 0, (SEAM.open[0] + SEAM.open[1]) / 2, H.stoneGrey, { tile: 1.6, ry: Math.PI / 2 });
  // the ceilings: oak beams and boards; the cell's low vault
  box(IN.east, IN.west, CEIL, CEIL + 0.3, IN.front - 0.1, IN.back + 0.1, M.oakDark, 1.2);
  for (let x = IN.east + 1.2; x < IN.west; x += 1.8) box(x - 0.15, x + 0.15, CEIL - 0.32, CEIL, IN.front, IN.back, H.timber, 1);
  box(IN.east, -8.0, -0.3, 0, IN.front, STAIR.rect.minZ - 0.15, H.vaultStone, 1.2); // the cell's flat stone ceiling (the hall's floor over it)

  // ---- the hall of antiquities: glass cases on tables, tall cabinets, carved stones
  const caseAt = (x: number, z: number, along: boolean) => {
    const [cw, cd] = along ? [2.2, 0.9] : [0.9, 2.2];
    k.box(cw, 0.8, cd, x, 0.4, z, M.oakDark, { tile: 0.8 });
    k.box(cw, 0.45, cd, x, 1.03, z, H.glassCase);
    for (let i = 0; i < 6; i++) {
      const ox = along ? (i - 2.5) * 0.32 : (r() - 0.5) * 0.5;
      const oz = along ? (r() - 0.5) * 0.5 : (i - 2.5) * 0.32;
      const kind = i % 3;
      if (kind === 0) k.cyl(0.06, 0.09, 0.2, x + ox, 0.82, z + oz, H.pot, { seg: 6 });
      else if (kind === 1) k.cyl(0.05, 0.05, 0.02, x + ox, 0.82, z + oz, H.bronze, { seg: 6 });
      else k.box(0.14, 0.05, 0.1, x + ox, 0.83, z + oz, i === 2 ? M.stoneDark : H.bronze);
    }
  };
  for (const [x, z, along] of ST.CASES) caseAt(x, z, along);
  for (const [x, z] of ST.CABINETS) {
    k.box(1.2, 2.2, 0.8, x, 1.1, z, H.glassCase);
    k.box(1.3, 0.1, 0.9, x, 0.05, z, M.oakDark);
    k.box(1.3, 0.1, 0.9, x, 2.25, z, M.oakDark);
    for (const y of [0.7, 1.5]) {
      k.box(1.1, 0.03, 0.7, x, y, z, M.oakDark);
      k.cyl(0.08, 0.1, 0.3, x - 0.3, y + 0.02, z, M.statue, { seg: 6 });
      k.cyl(0.07, 0.07, 0.35, x + 0.25, y + 0.02, z, H.bronze, { seg: 6 });
    }
  }
  for (const [x, z, kind] of ST.STONES) {
    if (kind === 0) k.box(0.9, 1.8, 0.18, x, 0.9, z, M.stoneDark, { rz: 0.06, tile: 0.8 });
    else if (kind === 1) {
      k.box(0.7, 0.9, 0.7, x, 0.45, z, M.stone);
      k.box(0.8, 0.5, 0.8, x, 1.15, z, M.stoneDark);
    } else if (kind === 2) {
      k.box(0.7, 1.1, 0.5, x, 0.55, z, M.stone);
      k.box(0.8, 0.12, 0.6, x, 1.16, z, M.stone);
    } else {
      k.box(0.2, 1.2, 1.0, x, 1.4, z, M.stoneDark);
      k.cyl(0.35, 0.35, 0.08, x + 0.12, 1.3, z, M.stone, { seg: 8, rz: Math.PI / 2 });
    }
  }
  // the stair down to the cell: worn steps, an iron rail round the well
  stairSteps(k, STAIR, M.stoneDark);
  box(STAIR.rect.minX - 0.1, ST.RAIL_END, 0, 1.0, STAIR.rect.minZ - 0.2, STAIR.rect.minZ - 0.12, M.iron, 1);
  box(STAIR.rect.minX - 0.1, STAIR.rect.minX - 0.02, 0, 1.0, STAIR.rect.minZ - 0.2, IN.back, M.iron, 1);

  // ---- the gatehouse: arms and armour, for looking at only
  const armour = (x: number, z: number, yaw: number) => {
    k.box(0.5, 0.1, 0.5, x, 0.05, z, M.oakDark);
    for (const s of [-0.12, 0.12]) k.cyl(0.07, 0.08, 0.85, x + Math.cos(yaw) * s, 0.1, z - Math.sin(yaw) * s, H.steel, { seg: 6 });
    k.cyl(0.2, 0.16, 0.6, x, 0.95, z, H.steel, { seg: 8 });
    k.cyl(0.22, 0.18, 0.12, x, 0.9, z, H.steel, { seg: 8 });
    for (const s of [-0.28, 0.28]) k.cyl(0.06, 0.07, 0.62, x + Math.cos(yaw) * s, 0.9, z - Math.sin(yaw) * s, H.steel, { seg: 5 });
    k.cyl(0.12, 0.14, 0.26, x, 1.6, z, H.steel, { seg: 7 });
    k.box(0.1, 0.04, 0.14, x + Math.sin(yaw) * 0.12, 1.72, z + Math.cos(yaw) * 0.12, M.black, { ry: yaw });
  };
  for (const [x, z] of ST.ARMOUR) armour(x, z, -Math.PI / 2);
  const RK = ST.RACK;
  k.box(0.2, 0.15, RK.z1 - RK.z0, RK.x, 0.3, (RK.z0 + RK.z1) / 2, M.oakDark);
  k.box(0.2, 0.15, RK.z1 - RK.z0, RK.x, 2.2, (RK.z0 + RK.z1) / 2, M.oakDark);
  for (let i = 0; i < 7; i++) {
    const z = RK.z0 + 0.2 + i * ((RK.z1 - RK.z0 - 0.4) / 6);
    k.cyl(0.025, 0.025, 3.2, RK.x - 0.05, 0, z, H.timber, { seg: 4 });
    k.box(0.04, 0.35, i % 2 ? 0.25 : 0.08, RK.x - 0.05, 3.35, z, H.steel);
  }
  for (const z of [2.0, 4.0]) k.cyl(0.4, 0.4, 0.06, IN.west - 0.05, 3.2, z, H.bronze, { seg: 10, rz: Math.PI / 2 });
  const SW = ST.SWORDS;
  k.box(2.4, 0.8, 0.9, SW.x, 0.4, SW.z, M.oakDark, { tile: 0.8 });
  k.box(2.4, 0.3, 0.9, SW.x, 0.95, SW.z, H.glassCase);
  for (let i = 0; i < 4; i++) k.box(1.8, 0.02, 0.06, SW.x, 0.82, SW.z - 0.3 + i * 0.2, H.steel, { ry: (r() - 0.5) * 0.1 });
  const GN = ST.GUN;
  k.box(0.9, 0.35, 1.6, GN.x, 0.35, GN.z, H.timber);
  // cyl stands on y (its centre at y + h/2), so a lying barrel's y is its centre less h/2: the barrel lies
  // on the carriage (centre 0.72), the muzzle toward the door (-z), over the wheels (walkthrough west 2026-09-25)
  k.cyl(0.16, 0.2, 1.7, GN.x, 0.72 - 0.85, GN.z - 0.1, H.bronze, { seg: 8, rx: -(Math.PI / 2 - 0.1) });
  for (const s of [-1, 1]) k.cyl(0.35, 0.35, 0.08, GN.x + s * 0.5, 0.31, GN.z - 0.35, H.timber, { seg: 10, rz: Math.PI / 2 });

  // ---- the cell: rings and chains in the walls, a bench, straw, a slit of grey light high in the end wall
  for (const [x, z] of [[-13.75, 2.2], [-13.75, 5.2], [-8.05, 3.0]] as Array<[number, number]>) {
    k.cyl(0.12, 0.12, 0.04, x, DOWN + 1.3, z, M.iron, { seg: 6, rz: Math.PI / 2 });
    for (let i = 0; i < 5; i++) k.box(0.05, 0.12, 0.04, x + (x < -10 ? 0.05 : -0.05), DOWN + 1.15 - i * 0.12, z, M.iron);
  }
  k.box(0.45, 0.45, 2.6, IN.east + 0.25, DOWN + 0.22, 3.3, H.timber);
  k.plane(0.12, 0.7, IN.east + 0.02, DOWN + 1.5, 4.6, win.def, { ry: Math.PI / 2 });
  k.finish();

  // light: lamps in the halls, the thin light in the cell
  const L = lights(scene, 0xb8b8b0, 0x4a4436, 0x3a342a);
  const lampA = point(group, 0xffb070, -8.2, 3.8, 4.2, 13);
  const lampB = point(group, 0xffb070, 0, 3.4, 4.2, 9);
  const cellL = point(group, 0xc8d0d8, -12.5, DOWN + 1.6, 4.6, 6);
  const dayFill = point(group, 0xd8d8e0, -6.5, 3.0, 3.0, 18);
  const shaftMat = shaftMaterial();
  for (const x of S.windows) lightShaft(group, new THREE.Vector3(x, 3.4, 0.6), new THREE.Vector3(x - 0.3, 0, 3.0), 1.1, shaftMat);
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const looks: Lookable[] = [];
  looksAdd(looks, "cases", -7.8, 2.6, 1.6, "look into the cases", "Under the glass: Roman pots and coins dug out of the old Burcht and the river mud, green bronze pins, a clay lamp, a medieval jug, wax seals of the guilds, a fossil shell as big as a hand. Each has a small card in careful French and Flemish.");
  looksAdd(looks, "cabinet", -6.3, 3.3, 1.3, "look into the cabinet", "A tall cabinet: small carved saints from demolished churches, a bronze mortar, a pewter jug with the town's arms.");
  looksAdd(looks, "stones", -12.6, 5.0, 1.5, "look at the old stones", "Carved stones along the wall: a tombstone with a knight worn almost smooth, the capital of a column from a church that is gone, a Roman altar stone, the arms of the town cut in stone.");
  looksAdd(looks, "armour", 0.8, 3.6, 1.4, "look at the armour", "A suit of armour on a stand, empty and patient, and racks of halberds and pikes of the town's old militia. For looking at only: the attendant watches your hands.");
  looksAdd(looks, "gun", ST.GUN.x, ST.GUN.z - 1.5, 1.5, "look at the bronze gun", "A small bronze gun on a wooden carriage, green with age, the maker's name and a date cast on the barrel.");
  looksAdd(looks, "stairdown", -8.4, 6.6, 1.2, "look down the stair", "A worn stair goes down into the dark: the old prison cells under the castle. The last stop of the museum.");
  looksAdd(looks, "cell", -11.2, 3.5, 2.2, "look round the cell", "The old prison of the Steen. Until fifty years ago men waited here for the judges: a low stone ceiling, iron rings in the wall, a bench, a slit of grey light. Names and crosses are scratched into the stone.", DOWN);
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    L.hemi.intensity = (2.0 + 1.4 * d) * ambK;
    L.amb.intensity = (0.8 + 0.3 * day) * ambK;
    win.mat().color.setScalar(0.12 + 0.9 * day * sky);
    dayFill.intensity = 6 * d;
    shaftMat.opacity = Math.max(0, day - 0.3) * 0.12 * Math.max(0, sky - 0.55) * 2.2;
    nightAir(L, [win], day, sky);
  };
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "steen",
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : free(x, fz) ? [x, fz] : free(fx, z) ? [fx, z] : [fx, fz]),
    floor: (x, z) => HP.floorAt(P, x, z, 0),
    peopleFloor: () => 0,
    seats: [],
    stands: [],
    exit: { ...P.marks.door, yaw: Math.PI },
    entry: { ...P.marks.door },
    entries: { main: { ...P.marks.door } },
    exits: { main: { ...P.marks.door, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.2,
    eye: 1.6,
    surface: "stone",
    sound: "museum",
    marks: { ...P.marks },
    sets: { ...P.sets },
    looks,
    path,
    setDaylight(kd, weather = 1) {
      day = kd;
      sky = weather;
      light();
    },
    setAmbient(a) {
      ambK = a;
      light();
    },
    update(t) {
      lampA.intensity = (day < 0.5 ? 7 : 3) * flicker(t, 2.3);
      lampB.intensity = (day < 0.5 ? 5.5 : 2.5) * flicker(t, 4.1);
      cellL.intensity = 0.6 + 1.2 * day;
      room.lamps = [{ p: toWorld(-8.2, 4.2, 3.8), w: 0.25 * flicker(t, 2.3) }];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  void CELL_CEIL;
  return room;
}

// ================================================================ the Oostershuis

/**
 * The Oostershuis, the house of the Hanse's merchants (Cornelis Floris, 1564-68), standing in the world inside
 * its shell (M7 halls; the plan: shared/oostershuisPlan.ts). The Hanse left long ago; from 1815 the building
 * served as warehouses, and in 1863 the Hanseatic cities ceded it to the Belgian State. Here, in the wing on the
 * dock: the vaulted gate passage through to the court (its gate barred), and either side of it a long timber
 * hall on posts under the first floor's joists, stacked with sacks, bales, crates and casks in the State's
 * keeping; the decimal scale and the storekeeper's desk by the passage, a hoist through a hatch in the
 * ceiling; natie men carry sacks.
 */
export function buildOostershuis(): LandmarkRoom {
  const P = OH.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x2e281e);
  scene.background = null;
  group.position.y = OH.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 16;
  fog.far = 75;
  const k = new Kit(group);
  k.shadeTop = 4.5;
  const r = rand(123);
  const { IN, PASS, DOOR, CEIL, POST_Z, HATCH, SCALE, DESK } = OH;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  const cobble = lmMat("lm_oh_cobble", { map: tex().cobble, color: 0x9a948c }, 0.1, 0.012);

  // ---- floors: cobbles in the gateway and the passage, boards in the halls
  box(-DOOR.hw - 0.2, DOOR.hw + 0.2, -0.1, 0, 0, IN.front, cobble, 1.4);
  box(-PASS.hw, PASS.hw, -0.1, 0, IN.front, IN.back, cobble, 1.4);
  box(IN.west, -PASS.wall, -0.1, 0, IN.front, IN.back, H.boards, 1.6);
  box(PASS.wall, IN.east, -0.1, 0, IN.front, IN.back, H.boards, 1.6);
  for (const s of [-1, 1]) box(s > 0 ? PASS.hw : -PASS.wall, s > 0 ? PASS.wall : -PASS.hw, -0.1, 0, ...PASS.open, H.boards, 1.2);

  // ---- the walls: brick; the front with the gateway and the arched warehouse doors (shut, their fanlights glazed)
  const fan = glassMat("grisaille", 81);
  holed(k, "x", IN.west - 0.2, IN.east + 0.2, 0.3, IN.front, 0, CEIL, [[-DOOR.hw, DOOR.hw, -1, DOOR.h]], H.brick, 1.6);
  for (const u of OH.SHELL.bays) {
    // the arched door seen from within: oak leaves, a round fanlight over them
    const x = u;
    box(x - 1.3, x + 1.3, 0, 2.9, IN.front, IN.front + 0.1, M.oakDark, 1);
    box(x - 0.05, x + 0.05, 0, 2.9, IN.front + 0.1, IN.front + 0.14, M.iron, 1);
    k.plane(2.4, 0.9, x, 3.4, IN.front + 0.03, fan.def);
    box(x - 1.45, x + 1.45, 2.9, 3.0, IN.front, IN.front + 0.16, M.stone, 1);
    box(x - 1.45, x + 1.45, 3.85, 3.95, IN.front, IN.front + 0.16, M.stone, 1);
  }
  holed(k, "x", IN.west - 0.2, IN.east + 0.2, IN.back, 9.9, 0, CEIL, [], H.brick, 1.6);
  for (const x of [IN.west - 0.2, IN.east]) holed(k, "z", 0.3, 9.9, x, x + 0.2, 0, CEIL, [], H.brick, 1.6);
  // the reveal of the gateway from the gate's plane to the front wall
  for (const s of [-1, 1]) box(s > 0 ? DOOR.hw : -DOOR.hw - 0.3, s > 0 ? DOOR.hw + 0.3 : -DOOR.hw, 0, DOOR.h + 0.3, 0, 0.3, M.stone, 1.4);
  box(-DOOR.hw - 0.3, DOOR.hw + 0.3, DOOR.h, DOOR.h + 0.3, 0, 0.3, M.stone, 1.4);

  // ---- the gate passage: brick walls with a wide opening to each hall, a brick barrel vault; the court gate barred
  for (const s of [-1, 1]) holed(k, "z", IN.front, IN.back, s > 0 ? PASS.hw : -PASS.wall, s > 0 ? PASS.wall : -PASS.hw, 0, CEIL, [[...PASS.open, -1, 2.9]], H.brick, 1.2);
  k.vault(PASS.hw * 2 + 0.3, 2.85, 1.05, IN.back - IN.front, 0, IN.front, H.vaultBrick, { tile: 1.2 });
  // over the vault and at its two ends: closed (nothing of the wing's inside shows past its edges)
  box(-PASS.wall, PASS.wall, CEIL, CEIL + 0.2, IN.front, IN.back + 0.2, H.brick, 1.2);
  for (const z of [IN.front, IN.back - 0.02]) k.archWall(PASS.hw * 2 + 0.3, CEIL + 0.3 - 2.85, 0.1, PASS.hw * 2, 0, 1.0, 0, 2.85, z, H.vaultBrick, { tile: 1.2 });
  box(-PASS.hw, PASS.hw, 0, CEIL, IN.back - 0.05, IN.back + 0.02, M.oakDark, 1);
  box(-PASS.hw, PASS.hw, 1.1, 1.24, IN.back - 0.2, IN.back - 0.05, M.iron, 1); // the bar across it
  for (const s of [-1, 1]) box(s * 1.1 - 0.05, s * 1.1 + 0.05, 0, 2.8, IN.back - 0.12, IN.back - 0.05, M.iron, 1);

  // ---- the halls' ceilings: planks on joists, beams on the posts, braces; the hatch and the hoist
  for (const [x0, x1] of [[IN.west, -PASS.wall], [PASS.wall, IN.east]]) {
    box(x0, x1, CEIL, CEIL + 0.2, IN.front, IN.back, H.timber, 1.2);
    for (let x = x0 + 0.6; x < x1; x += 1.2) box(x - 0.11, x + 0.11, CEIL - 0.25, CEIL, IN.front, IN.back, H.timber, 1);
    box(x0, x1, CEIL - 0.7, CEIL - 0.25, POST_Z - 0.2, POST_Z + 0.2, H.timber, 1);
  }
  for (const x of OH.POSTS_X) {
    k.box(0.4, CEIL - 0.7, 0.4, x, (CEIL - 0.7) / 2, POST_Z, H.timber, { tile: 1 });
    for (const d of [-1, 1]) k.box(1.4, 0.18, 0.18, x + d * 0.55, CEIL - 1.25, POST_Z, H.timber, { rz: -d * 0.75 });
  }
  k.box(2, 0.1, 2, HATCH.x, CEIL - 0.3, HATCH.z, M.black);
  k.box(3.2, 0.3, 0.3, HATCH.x, CEIL + 0.05, HATCH.z, H.timber);

  // ---- stacks: sacks in pyramids, bales corded, crates, casks (the plan's rects)
  const wood = lmMat("lm_cask", { map: tex().planks, color: 0xd8a870 }, 0.2);
  const hoop = lmMat("lm_hoop", { color: 0x2a2622, side: THREE.DoubleSide });
  for (const [kind, x0, x1, z0, z1] of OH.STACKS) {
    const nx = Math.max(1, Math.floor((x1 - x0) / 0.97));
    const nz = Math.max(1, Math.floor((z1 - z0) / 0.62));
    if (kind === "sacks") {
      for (let lvl = 0; lvl < 4; lvl++)
        for (let i = 0; i < nx - lvl; i++)
          for (let j = 0; j < nz; j++) k.box(0.95, 0.42, 0.6, x0 + 0.49 + (i + lvl / 2) * 0.97, 0.21 + lvl * 0.4, z0 + 0.31 + j * 0.62, H.sack, { ry: (r() - 0.5) * 0.15, tint: 0.85 + r() * 0.25 });
    } else if (kind === "bales") {
      const bx = Math.max(1, Math.floor((x1 - x0) / 1.25));
      const bz = Math.max(1, Math.floor((z1 - z0) / 1.0));
      for (let i = 0; i < bx; i++)
        for (let j = 0; j < bz; j++)
          for (let lvl = 0; lvl < 2; lvl++) {
            const x = x0 + 0.62 + i * 1.25;
            const z = z0 + 0.5 + j * 1.0;
            k.box(1.15, 0.9, 0.95, x, 0.45 + lvl * 0.92, z, H.bale, { tint: 0.85 + r() * 0.2 });
            for (const d of [-0.3, 0.3]) k.box(0.04, 0.92, 0.97, x + d, 0.45 + lvl * 0.92, z, H.rope);
          }
    } else if (kind === "crates") {
      const cx = Math.max(1, Math.floor((x1 - x0) / 1.15));
      const cz = Math.max(1, Math.floor((z1 - z0) / 0.95));
      for (let i = 0; i < cx; i++) for (let j = 0; j < cz; j++) for (let lvl = 0; lvl < 2; lvl++) if (lvl === 0 || r() < 0.6) k.box(1.1, 0.8, 0.9, x0 + 0.57 + i * 1.15, 0.4 + lvl * 0.82, z0 + 0.47 + j * 0.95, H.crate, { tint: 0.9 + r() * 0.2 });
    } else {
      for (let x = x0 + 0.4; x < x1 - 0.3; x += 0.8) k.barrel(x, 0.48, (z0 + z1) / 2, wood, hoop, { tint: 0.85 + r() * 0.3 });
    }
  }
  // the decimal scale and the storekeeper's desk by the passage
  k.box(1.2, 0.12, 1.2, SCALE.x, 0.06, SCALE.z, M.iron);
  k.box(0.12, 1.4, 0.12, SCALE.x, 0.8, SCALE.z - 0.6, M.iron);
  k.box(0.9, 0.08, 0.08, SCALE.x, 1.5, SCALE.z - 0.6, M.iron);
  k.box(0.6, 0.4, 0.6, SCALE.x, 0.32, SCALE.z + 0.1, H.sack);
  desk(k, DESK.x, 0, DESK.z, 1.6);
  k.box(0.4, 0.03, 0.3, DESK.x + 0.4, 0.84, DESK.z, H.books);
  chair(k, DESK.x, 0, DESK.z - 0.8, 0);
  // a board over the desk, on the front wall
  k.plane(2.2, 0.35, DESK.x, 2.4, IN.front + 0.18, sign("OOSTERSHUIS", "lm_oh_sign"), {});
  k.finish();

  // the hoist: a rope down through the hatch with a hook and a sack, going up and down
  const hoist = new THREE.Group();
  const ropeM = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 4), matOf(H.rope));
  const sackM = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), matOf(H.sack));
  const col = (n: number) => new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3);
  ropeM.geometry.setAttribute("color", col(ropeM.geometry.getAttribute("position").count));
  sackM.geometry.setAttribute("color", col(sackM.geometry.getAttribute("position").count));
  hoist.add(ropeM, sackM);
  hoist.position.set(HATCH.x, 0, HATCH.z);
  group.add(hoist);

  const L = lights(scene, 0xc8c0b0, 0x4e4230, 0x4a3e2e);
  const lampA = point(group, 0xffb070, DESK.x, 2.2, DESK.z + 0.6, 10);
  const lampW = point(group, 0xffb070, -17, 3.4, POST_Z, 16);
  const lampE = point(group, 0xffb070, 17, 3.4, POST_Z, 16);
  const dayFill = point(group, 0xd8d8e0, 0, 3.4, 4, 34);
  const flames = new Flames(group, 4, 0.16);
  flames.addFlame(DESK.x - 0.4, 1.1, DESK.z);
  const shaftMat = shaftMaterial();
  // (no light shaft through the gate: seen from the quay it stood in the gateway like a white board)
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const looks: Lookable[] = [];
  looksAdd(looks, "stacks", -24.5, 4.2, 1.8, "look at the stacks", "Sacks of coffee and grain in pyramids, bales of wool and cotton corded tight, crates and casks, each marked in chalk with a number from the storekeeper's book. It smells of jute, tar and old timber.");
  looksAdd(looks, "scale", SCALE.x - 1.2, SCALE.z, 1.4, "look at the scale", "A decimal scale on the floor: a sack goes on the platform, the storekeeper slides a weight along the beam and writes the figure down.");
  looksAdd(looks, "hall", 0, 4.5, 1.4, "look round the hall", "The house of the Hanse's merchants, three hundred years old: once their counting rooms and chambers, now a warehouse of the Belgian State. Forty windows, a great tower over the gate, and in here only dust and goods.");
  looksAdd(looks, "hoist", HATCH.x + 1.2, HATCH.z - 0.6, 1.5, "look up at the hoist", "A rope comes down through a hatch in the ceiling with a hook on it: goods go up and down between the floors on it.");
  looksAdd(looks, "court", 0, IN.back - 1.2, 1.4, "look at the court gate", "The gate to the court is barred. Through the cracks: cobbles, a pump, the four wings round it, their windows shuttered.");
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    L.hemi.intensity = (2.3 + 2.2 * d) * ambK;
    L.amb.intensity = (0.8 + 0.3 * day) * ambK;
    fan.mat().color.setScalar(0.12 + 0.9 * day * sky);
    dayFill.intensity = 8 * d;
    shaftMat.opacity = Math.max(0, day - 0.3) * 0.25 * Math.max(0, sky - 0.55) * 2.2;
    nightAir(L, [fan], day, sky);
  };
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "oostershuis",
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : free(x, fz) ? [x, fz] : free(fx, z) ? [fx, z] : [fx, fz]),
    floor: (x, z) => HP.floorAt(P, x, z, 0),
    peopleFloor: () => 0,
    seats: [],
    stands: [],
    exit: { ...P.marks.door, yaw: Math.PI },
    entry: { ...P.marks.door },
    entries: { main: { ...P.marks.door } },
    exits: { main: { ...P.marks.door, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.35,
    eye: 1.6,
    surface: "wood",
    sound: "store",
    marks: { ...P.marks },
    sets: { ...P.sets },
    looks,
    path,
    animate(t) {
      // the hoist goes up and down, slowly
      const y = 1.6 + Math.sin(t * 0.18) * 1.1;
      sackM.position.y = y;
      ropeM.scale.y = CEIL - y;
      ropeM.position.y = (CEIL + y) / 2 + 0.25;
    },
    setDaylight(kd, weather = 1) {
      day = kd;
      sky = weather;
      light();
    },
    setAmbient(a) {
      ambK = a;
      light();
    },
    update(t) {
      flames.update(t);
      lampA.intensity = 2.5 * flicker(t, 3.3);
      lampW.intensity = (day < 0.4 ? 9.5 : 3) * flicker(t, 1.7);
      lampE.intensity = (day < 0.4 ? 9.5 : 3) * flicker(t, 2.9);
      room.lamps = [{ p: toWorld(DESK.x - 0.4, DESK.z, 1.1), w: 0.2 * flicker(t, 3.3) }];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

// ================================================================ in the world (M7 halls)

/**
 * The halls that stand in the world inside their shells (M7 halls, docs/milestones/M7-halls-inworld.md):
 * each built from its plan, walked into through its street doors, drawn through them (world/hallInWorld.ts).
 */
export function hallsInWorld(world: World, inWorld: InWorld): HallInWorld[] {
  const thm = TH.PLAN.marks;
  return [
    createHallInWorld(world, inWorld, TH.PLAN, buildTownhall(), { color: 0x2a2620, near: 16, far: 75 }, [
      { label: "the vestibule and the porter's lodge", x: -1.2, z: 3.5, reach: 1.2 },
      { label: "the notice board", x: thm.board.x - 0.3, z: thm.board.z, reach: 1.2 },
      { label: "the foot of the great stair", x: 0, z: TH.STAIR.foot - 0.8, reach: 1.2 },
      { label: "the registry's counter", x: thm.counter.x, z: thm.counter.z, reach: 1.0 },
      { label: "the callers' bench", x: 10.4, z: TH.BENCH.z - 0.9, reach: 1.2 },
    ]),
    createHallInWorld(world, inWorld, VH.PLAN, buildVleeshuis(), { color: 0x241a12, near: 12, far: 55 }, [
      { label: "the cellar master's desk", x: VH.PLAN.marks.cellarDesk.x, z: VH.PLAN.marks.cellarDesk.z + 0.4, reach: 1.2 },
      { label: "the tasting table", x: VH.TASTING.x, z: VH.TASTING.z - 1.0, reach: 1.2 },
      { label: "the middle aisle", x: 16, z: 7.35, reach: 1.2 },
      { label: "the north door, from within", x: VH.SHELL.north_door_x, z: VH.IN.north - 1.2, reach: 1.2 },
      { label: "the foot of the long stair", x: VH.STAIR.foot + 0.6, z: 13.2, reach: 1.0 },
    ], [-6.25, 0, 6.3].flatMap((a) => [
      // the theatre's cross windows over the vaults, on both long sides
      { along: "x" as const, a, face: VH.SHELL.south, out: -1 as const, y0: 10.8 - VH.FLOOR_Y, y1: 14.1 - VH.FLOOR_Y, w: 1.5 },
      { along: "x" as const, a, face: VH.SHELL.north, out: 1 as const, y0: 10.8 - VH.FLOOR_Y, y1: 14.1 - VH.FLOOR_Y, w: 1.5 },
    ])),
    createHallInWorld(world, inWorld, OH.PLAN, buildOostershuis(), { color: 0x2a241c, near: 16, far: 70 }, [
      { label: "the gate passage", x: 0, z: 5.0, reach: 1.2 },
      { label: "the storekeeper's desk", x: OH.DESK.x + 1.4, z: OH.DESK.z + 1.0, reach: 1.2 },
      { label: "the scale", x: OH.SCALE.x - 1.1, z: OH.SCALE.z, reach: 1.0 },
      { label: "the west hall under the hoist", x: OH.HATCH.x + 1.2, z: OH.HATCH.z, reach: 1.2 },
      { label: "the east hall", x: 27, z: 5.0, reach: 1.2 },
    ]),
    createHallInWorld(world, inWorld, ST.PLAN, buildSteen(), { color: 0x26221c, near: 12, far: 50 }, [
      { label: "the gatehouse, the armour", x: 0.4, z: 3.6, reach: 1.2 },
      { label: "the hall of antiquities", x: -8.2, z: 3.1, reach: 1.2 },
      { label: "the stair down to the cell", x: ST.STAIR.head + 0.6, z: 6.6, reach: 1.0 },
    ]),
  ];
}
