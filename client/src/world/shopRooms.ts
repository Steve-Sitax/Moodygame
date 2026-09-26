import * as THREE from "three";
import { psx } from "../retro/psx";
import type { HousePlan } from "../../../shared/housePlan";
import { SHOP_LOOK, type ShopTrade } from "../../../shared/shops";
import { ambientOf, Builder, flicker, frameRoom, holesOn, lambert, mat, mergeStatic, plaster, rand, rectsOf, tex, wallFace, type Room, type Seat, type Spot } from "./rooms";
import { boardTex, checkerTex, clockFaceTex, Kit, M, marbleTex, mirrorTex, paintingTex, paintMat, picMat, posterTex, rowTex, whiteTilesTex } from "./interiorKit";

// M7 shops (docs/milestones/M7-shops.md): a shop's ground floor in its own city house (shared/housePlan.ts kind
// "shop", world/houseInWorld.ts puts it in the world), the way a taproom stands in its house (rooms.ts
// buildTavern). One plan for every shop, dressed by its trade:
//  - the counter along the side wall nearer the street door, from 1.3 m in, the keeper behind it, his wife or
//    helper at its front end, shelves floor to ceiling on the wall behind them;
//  - the other side wall: open shelves, bins, sacks or cases, the trade's own things; a window display behind
//    the front window (seen from the street); at the back a door to the back rooms and a stove (a baker's oven);
//  - two hanging lamps, a beamed ceiling, the floor of the trade (boards, tiles with sawdust, flags);
//  - where customers stand (in front of the counter, at the shelves, at the window) and, in the barber's and at
//    the Berg, where they sit and wait.
// Concept pictures for the trades were made with Codex (scratch only, not in the repo); the textures that
// entered the repo are in assets/ATTRIBUTION.md.

interface Ctx {
  p: HousePlan;
  b: Builder;
  k: Kit;
  r: () => number;
  F: number;
  H: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** +1: the near (counter) wall is at x1; -1: at x0. */
  ns: number;
  nearW: number;
  farW: number;
  /** x at d metres in from the near wall, from the far wall. */
  X: (d: number) => number;
  XF: (d: number) => number;
  zc0: number;
  zc1: number;
  zcm: number;
  /** The front window holes' spans in x (the display goes behind them). */
  fronts: Array<[number, number]>;
  /** Holes on the near wall and the far wall (z spans), to keep shelves off them. */
  nearHoles: Array<[number, number]>;
  farHoles: Array<[number, number]>;
  lights: THREE.PointLight[];
  glows: THREE.Sprite[];
  seats: Seat[];
  stands: Spot[];
  /** Extra world lights that flicker (a forge, an oven), with their base power. */
  fires: Array<{ l: THREE.PointLight; w: number; p: THREE.Vector3 }>;
  /** Faces toward the near wall / the far wall / the back / the front (yaw, the humans' convention). */
  toNear: number;
  toFar: number;
}

const face = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
const span = (a: number, c: number): [number, number] => [Math.min(a, c), Math.max(a, c)];

/** Free runs along [a, b] that keep clear of the holes (with a margin). */
function freeRuns(a: number, b: number, holes: Array<[number, number]>, m = 0.15): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let s = a;
  for (const [h0, h1] of [...holes].sort((p, q) => p[0] - q[0])) {
    if (h1 + m < s || h0 - m > b) continue;
    if (h0 - m > s + 0.3) out.push([s, Math.min(b, h0 - m)]);
    s = Math.max(s, h1 + m);
  }
  if (b > s + 0.3) out.push([s, b]);
  return out;
}

// ------------------------------------------------------------------ the parts every shop has

/** Shelving on a side wall from z a to z b: uprights, boards at the heights, and what stands on them. */
function wallShelves(c: Ctx, onNear: boolean, za: number, zb: number, heights: number[], fill: (y: number, za: number, zb: number, x: number, row: number) => void, depth = 0.34): void {
  const W = onNear ? c.nearW : c.farW;
  const sgn = onNear ? -c.ns : c.ns; // into the room from that wall
  const xi = W + sgn * depth;
  const wood = M.darkOak();
  for (const [a, b] of freeRuns(za, zb, onNear ? c.nearHoles : c.farHoles)) {
    c.k.bx(W, xi, c.F, heights[heights.length - 1] + 0.04, a, a + 0.05, wood);
    c.k.bx(W, xi, c.F, heights[heights.length - 1] + 0.04, b - 0.05, b, wood);
    heights.forEach((y, row) => {
      c.k.bx(W, xi, c.F + y - 0.03, 0.03, a, b, wood);
      fill(c.F + y, a + 0.06, b - 0.06, (W + xi) / 2, row);
    });
  }
}

/** A shelf row picture along z at x (facing into the room). */
function row(c: Ctx, onNear: boolean, y: number, za: number, zb: number, h: number, kind: Parameters<typeof rowTex>[0], seed: number, inset = 0.12): void {
  const W = onNear ? c.nearW : c.farW;
  const sgn = onNear ? -c.ns : c.ns;
  const x = W + sgn * inset;
  // a plane along z facing +x (ry pi/2) or -x (ry -pi/2)
  c.k.shelfRow([x, y, za], [x, y, zb], h, kind, seed, sgn > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/** The counter: a panelled front toward the shop, a top, a return to the wall at its front end. */
function counter(c: Ctx, top: THREE.Material, body: THREE.Material = M.oak()): void {
  const { X, F, zc0, zc1 } = c;
  c.k.bx(X(1.35), X(0.8), F, 0.92, zc0, zc1, body, true, 0.9);
  c.k.bx(X(1.42), X(0.74), F + 0.92, 0.05, zc0 - 0.06, zc1 + 0.06, top, false, 0.9);
  // the return to the wall at its front end (the keeper comes round the back)
  c.k.bx(X(0.8), c.nearW, F, 0.92, zc0, zc0 + 0.06, body, true);
  c.k.bx(X(0.8), c.nearW, F + 0.92, 0.05, zc0 - 0.06, zc0 + 0.1, top);
  // raised panels on the front
  const fx = X(1.37);
  for (let z = zc0 + 0.12; z < zc1 - 0.5; z += 0.7) c.k.bx(fx, fx + c.ns * 0.02, F + 0.18, 0.56, z + 0.06, z + 0.6, M.darkOak());
  c.k.bx(X(1.36), X(1.33), F, 0.1, zc0, zc1, M.darkOak());
}

/** A door to the back rooms in the back wall (painted panel door in its frame), and a clock over it. */
function backDoor(c: Ctx, x: number): void {
  const z = c.z1 - 0.02;
  const g = new THREE.Group();
  g.position.set(x, c.F, z);
  const oak = M.darkOak();
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.05, 0.04), oak);
  leaf.position.set(0, 1.025, -0.02);
  g.add(leaf);
  for (const y of [0.55, 1.45]) {
    const pnl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.03), M.oak());
    pnl.position.set(0, y, -0.05);
    g.add(pnl);
  }
  for (const [w, h, px, py] of [[0.08, 2.15, -0.465, 1.075], [0.08, 2.15, 0.465, 1.075], [1.01, 0.08, 0, 2.11]] as Array<[number, number, number, number]>) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), oak);
    f.position.set(px, py, -0.035);
    g.add(f);
  }
  const knob = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.06), M.brass());
  knob.position.set(0.32, 1.0, -0.07);
  g.add(knob);
  c.b.group.add(g);
  c.b.boxes.push({ minX: x - 0.5, maxX: x + 0.5, minZ: c.z1 - 0.15, maxZ: c.z1 });
  c.k.clock(x, c.F + 2.45, c.z1 - 0.02, 0.28, Math.PI, M.basic("sh_clockface", () => clockFaceTex(2)), "shop clock over the back door", M.darkOak());
}

/** The window display: a low platform behind each front window, its goods on it (seen from the street). */
function windowDisplay(c: Ctx, goods: (x0: number, x1: number, y: number, z: number) => void): void {
  for (const [a, b] of c.fronts) {
    const za = c.z0;
    const zb = c.z0 + 0.55;
    c.k.bx(a + 0.05, b - 0.05, c.F, 0.62, za, zb, M.darkOak(), true);
    c.k.bx(a + 0.05, b - 0.05, c.F + 0.62, 0.03, za, zb, lambert("sh_display_cloth", { color: 0x4a2a22 }, 0));
    goods(a + 0.15, b - 0.15, c.F + 0.65, (za + zb) / 2);
  }
}

/** Hooks a customer stands at: before the counter, at the far shelves, by the window. */
function customerStands(c: Ctx, extra: Spot[] = []): Spot[] {
  const { X, XF, zc0, zc1, zcm } = c;
  const x = X(1.95);
  const out: Spot[] = [
    { x, z: zcm, yaw: c.toNear },
    { x, z: Math.max(zc0 + 0.4, zcm - 0.9), yaw: c.toNear },
    { x, z: Math.min(zc1 - 0.3, zcm + 0.9), yaw: c.toNear },
    { x: XF(0.95), z: c.z0 + (c.z1 - c.z0) * 0.55, yaw: c.toFar },
    { x: (x + XF(0.95)) / 2, z: c.z1 - 1.5, yaw: face(0, 0, 0, 1) },
    ...extra,
  ];
  return out;
}

// ------------------------------------------------------------------ the trades

function dressBaker(c: Ctx): void {
  const { k, F, X, XF, zc0, zc1 } = c;
  // bread on the shelves behind the counter: real loaves, a few rolls in baskets
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.5, 0.95, 1.4, 1.85], (y, a, b, x) => {
    for (let z = a + 0.15; z < b - 0.1; z += 0.3) k.loaf(x, y, z, Math.PI / 2 + (c.r() - 0.5) * 0.4, 0.95 + c.r() * 0.2, c.r() < 0.3 ? 0x6a3e1c : 0x9a6a36);
  });
  counter(c, M.oak());
  // baskets of rolls and a scale on the counter
  for (const z of [zc0 + 0.35, zc1 - 0.45]) {
    k.b.cyl(0.2, 0.14, X(1.1), F + 0.99, z, lambert("sh_basket", { map: tex().planks, color: 0xb0905a }), false, 8);
    for (let i = 0; i < 5; i++) k.loaf(X(1.1) + (c.r() - 0.5) * 0.2, F + 1.06, z + (c.r() - 0.5) * 0.2, c.r() * 3, 0.45, 0xb07a40);
  }
  scale(c, X(1.1), c.zcm);
  // the far wall: a slanted rack of loaves, a table of cakes and tarts under a cloth
  const rz0 = c.z0 + 1.0;
  const rz1 = Math.min(c.z1 - 2.3, rz0 + 2.4);
  for (const [a, b2] of freeRuns(rz0, rz1, c.farHoles)) {
    for (let t = 0; t < 3; t++) {
      const y = F + 0.55 + t * 0.45;
      const board = k.bx(XF(0.05), XF(0.55), y, 0.03, a, b2, M.pine());
      board.rotation.z = c.ns * 0.25;
      for (let z = a + 0.15; z < b2 - 0.1; z += 0.28) k.loaf(XF(0.32), y + 0.03, z, Math.PI / 2 + (c.r() - 0.5) * 0.4, 0.9 + c.r() * 0.2, c.r() < 0.4 ? 0x5a3418 : 0xa06a34);
    }
    c.k.bx(XF(0), XF(0.6), F, 0.5, a, b2, M.darkOak(), true);
  }
  const tz = Math.min(c.z1 - 1.6, rz1 + 0.7);
  k.squareTable(XF(0.95), tz, F, 0.7, 0.9, M.pine());
  k.bx(XF(0.58), XF(1.32), F + 0.77, 0.01, tz - 0.47, tz + 0.47, M.white());
  for (let i = 0; i < 3; i++) k.b.cyl(0.12, 0.05, XF(0.95), F + 0.8, tz - 0.28 + i * 0.28, lambert(`sh_tart_${i}`, { color: [0x8a3a2a, 0xc0903a, 0x6a2a3a][i] }, 0), false, 10);
  // flour sacks by the oven, a bread peel leaning, the oven door in the back wall with its glow
  for (let i = 0; i < 2; i++) k.sack(XF(0.35), c.z1 - 0.5 - i * 0.55, F, 0xe8e2d0);
  k.b.box(0.05, 1.8, 0.3, XF(0.08), F + 0.9, c.z1 - 2.0, M.pine(), { ry: 0.08 });
  const ox = (X(0) + XF(0)) / 2;
  k.bx(ox - 0.7, ox + 0.7, F, 1.7, c.z1 - 0.25, c.z1, lambert("sh_ovenbrick", { map: tex().brick, color: 0xa07060 }), true, 0.8);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), M.iron());
  door.position.set(ox, F + 0.95, c.z1 - 0.26);
  door.rotation.y = Math.PI;
  k.b.group.add(door);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.06), M.glow(0xff9a40));
  glow.position.set(ox, F + 0.74, c.z1 - 0.27);
  glow.rotation.y = Math.PI;
  k.b.group.add(glow);
  fireLight(c, ox, F + 0.9, c.z1 - 0.6, 3.5);
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.12; x < b; x += 0.28) k.loaf(x, y, z + (c.r() - 0.5) * 0.15, c.r(), 1.0, 0x8a5a2a);
    k.b.cyl(0.14, 0.05, (a + b) / 2, y + 0.03, z, lambert("sh_peperkoek", { color: 0x5a3010 }), false, 8);
  });
  c.k.wallPic(X(0.02), F + 2.35, c.zcm, 0.9, 0.3, c.ns > 0 ? -Math.PI / 2 : Math.PI / 2, M.basic("sh_board_baker", () => boardTex(["BREAD - 6 C", "PEPERKOEK 3 C"], "#1a2e1f", "#e8d8a0", 256, 80)));
}

function dressButcher(c: Ctx): void {
  const { k, F, X, XF, zc0, zc1 } = c;
  counter(c, M.marble(), paintMat("sh_counter_marble", () => marbleTex("#c8c4b8", "rgba(80,80,86,0.3)", 9), 0xffffff));
  // the meat rail along the near wall behind the counter: iron hooks, sides of pork, legs, sausages
  const rx = X(0.35);
  k.bx(rx - 0.03, rx + 0.03, F + 2.15, 0.04, zc0, zc1, M.iron());
  const meat = paintMat("sh_meat", () => meatTex(), 0xffffff, 0, 0.1);
  const fat = lambert("sh_fat", { color: 0xc8b49a }, 0);
  for (let z = zc0 + 0.25; z < zc1 - 0.1; z += 0.42) {
    const kind = Math.floor(c.r() * 3);
    k.b.cyl(0.008, 0.2, rx, F + 2.03, z, M.iron(), false, 3);
    if (kind === 0) {
      // a side of pork: a long lump, the fat on its back, the knuckle at the bottom
      const side = new THREE.Mesh(new THREE.SphereGeometry(0.16, 7, 6), meat);
      side.scale.set(0.5, 2.6, 1.0);
      side.position.set(rx, F + 1.55, z);
      k.b.group.add(side);
      const back = new THREE.Mesh(new THREE.SphereGeometry(0.15, 7, 6), fat);
      back.scale.set(0.38, 2.4, 0.7);
      back.position.set(rx + c.ns * 0.035, F + 1.57, z - 0.03);
      k.b.group.add(back);
      k.b.cyl(0.025, 0.12, rx, F + 1.15, z, fat, false, 5);
    } else if (kind === 1) {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.13, 0.55, 6), meat);
      g.position.set(rx, F + 1.62, z);
      k.b.group.add(g);
    } else for (let i = 0; i < 4; i++) k.b.cyl(0.025, 0.4, rx, F + 1.72, z - 0.12 + i * 0.08, lambert("sh_sausage", { color: 0x6a2418 }, 0), false, 5);
  }
  // the far wall: a marble slab on iron legs with trays of cuts, a second rail with hooks and sausages over it
  const sz0 = c.z0 + 1.0;
  const sz1 = Math.min(c.z1 - 1.8, sz0 + 2.6);
  for (const [a, b2] of freeRuns(sz0, sz1, c.farHoles)) {
    k.bx(XF(0.02), XF(0.62), F + 0.85, 0.05, a, b2, M.marble());
    for (const z of [a + 0.1, b2 - 0.1]) k.bx(XF(0.08), XF(0.14), F, 0.85, z - 0.03, z + 0.03, M.iron());
    k.b.boxes.push({ minX: Math.min(XF(0), XF(0.62)), maxX: Math.max(XF(0), XF(0.62)), minZ: a, maxZ: b2 });
    for (let z = a + 0.25; z < b2 - 0.2; z += 0.5) {
      k.b.box(0.34, 0.03, 0.4, XF(0.32), F + 0.915, z, M.zinc());
      k.b.box(0.26, 0.06, 0.3, XF(0.32), F + 0.95, z, c.r() < 0.5 ? meat : lambert("sh_pink", { color: 0xb86a5a }, 0));
    }
    const hx = XF(0.12);
    k.bx(hx - 0.02, hx + 0.02, F + 2.05, 0.03, a, b2, M.iron());
    for (let z = a + 0.2; z < b2 - 0.1; z += 0.35) {
      k.b.cyl(0.006, 0.15, hx, F + 1.97, z, M.iron(), false, 3);
      for (let i = 0; i < 3; i++) k.b.cyl(0.022, 0.34, hx, F + 1.72, z - 0.05 + i * 0.05, lambert("sh_sausage", { color: 0x6a2418 }, 0), false, 5);
    }
  }
  // the chopping block and a cleaver, a hanging scale
  const bz = c.z1 - 1.0;
  k.b.cyl(0.32, 0.8, XF(0.7), F + 0.4, bz, lambert("sh_block", { map: tex().planks, color: 0x8a6a4a }), true, 9);
  k.b.box(0.05, 0.02, 0.22, XF(0.7), F + 0.82, bz, M.zinc(), { ry: 0.4 });
  // the hanging scale over the counter's back end (not before the keeper's face)
  k.b.cyl(0.14, 0.02, X(1.1), F + 1.6, zc1 - 0.35, M.brass(), false, 8);
  k.b.cyl(0.005, 0.5, X(1.1), F + 1.85, zc1 - 0.35, M.iron(), false, 3);
  // a tub of offal on the floor, the tiles' drain
  k.b.cyl(0.25, 0.45, XF(0.4), F + 0.225, c.z1 - 2.0, lambert("sh_tub", { map: tex().planks, color: 0x7a5a3a }), true, 8);
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.1; x < b; x += 0.3) k.b.box(0.22, 0.1, 0.18, x, y + 0.05, z, c.r() < 0.5 ? meat : lambert("sh_pink", { color: 0xb86a5a }, 0));
    k.b.box(b - a, 0.02, 0.4, (a + b) / 2, y + 0.005, z, lambert("sh_parsley", { color: 0x3a6a2a }, 0));
  });
  c.k.wallPic(XF(0.02), F + 2.3, c.z0 + 1.6, 0.8, 0.3, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic("sh_board_butcher", () => boardTex(["BRAWN 4 - SAUSAGE 7", "BACON 10 C"], "#661410", "#eee0c0", 256, 72)));
}

function dressGrocer(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.55, 1.05, 1.55, 2.05], (y, a, b, _x, rw) => row(c, true, y, a, b, 0.4, rw % 2 ? "jars" : "tins", rw + 1));
  counter(c, M.oak());
  scale(c, X(1.1), c.zcm);
  // bins of vegetables tipped toward the aisle on the far side, sacks of potatoes, strings of onions
  const goods = [0x9a3a22, 0xb89a4a, 0x7a8a3a, 0xa05a2a, 0x6a4a2a];
  let i = 0;
  for (let z = c.z0 + 1.2; z < c.z1 - 1.0; z += 0.7) k.crate(XF(0.33), z, F + 0.3, goods[i++ % goods.length], Math.PI / 2);
  k.bx(XF(0), XF(0.62), F, 0.3, c.z0 + 0.9, c.z1 - 0.9, M.pine(), true);
  for (let z = c.z0 + 1.2; z < c.z1 - 1.0; z += 1.2) k.b.cyl(0.02, 0.6, XF(0.05), F + 1.9, z, lambert("sh_onions", { color: 0xa8743a }, 0), false, 5);
  k.sack(XF(0.9), c.z1 - 0.6, F, 0x8a6a3a);
  k.sack(XF(1.45), c.z1 - 0.55, F, 0x8a6a3a);
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.2; x < b - 0.1; x += 0.55) k.crate(x, z, y, goods[Math.floor(c.r() * goods.length)], 0, false);
  });
}

function dressColonial(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  // the wall of little drawers behind the counter (a Codex picture), tins above them
  const drawers = picMat("sh_drawers", "/textures/shop_drawers.jpg", () => drawersTex(), 0xffffff, 0, 0.05);
  for (const [a, b] of freeRuns(zc0 - 0.2, c.z1 - 0.3, c.nearHoles)) {
    const xw = X(0.3);
    c.k.bx(c.nearW, xw, F, 1.8, a, b, M.darkOak(), false);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 1.5), drawers);
    const uv = pl.geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * (b - a)) / 1.5);
    pl.position.set(xw - c.ns * 0.005, F + 0.95, (a + b) / 2);
    pl.rotation.y = c.ns > 0 ? -Math.PI / 2 : Math.PI / 2;
    k.b.group.add(pl);
    c.k.bx(c.nearW, xw, F + 2.15, 0.03, a, b, M.darkOak());
    row(c, true, F + 1.82, a, b, 0.3, "tins", 2, 0.16);
    row(c, true, F + 2.18, a, b, 0.32, "tins", 3, 0.16);
  }
  counter(c, M.oak());
  scale(c, X(1.05), c.zcm - 0.4);
  // tall glass jars of candy, sugar loaves in blue paper, a coffee mill
  const jarM = lambert("sh_jarglass", { color: 0xb8c8c0 }, 0);
  const candy = [0xc05a5a, 0xe8e0d0, 0x6a3a1a];
  candy.forEach((cc, i) => {
    const z = c.zcm + 0.25 + i * 0.28;
    k.jar(X(1.05), F + 0.97, z, 0.1, 0.34, jarM, M.glass());
    k.b.cyl(0.085, 0.22, X(1.05), F + 1.08, z, lambert(`sh_candy_${i}`, { color: cc }, 0), false, 8);
  });
  const blue = lambert("sh_sugarpaper", { color: 0x2a4a8a }, 0);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.22, 6), blue);
    cone.position.set(X(1.1), F + 1.08, c.zc0 + 0.25 + i * 0.16);
    k.b.group.add(cone);
  }
  k.b.box(0.18, 0.18, 0.18, X(1.05), F + 1.06, c.zc1 - 0.3, M.oak());
  k.b.cyl(0.07, 0.1, X(1.05), F + 1.2, c.zc1 - 0.3, M.iron(), false, 8);
  // sacks of coffee, rice and beans along the far wall, barrels, a ladder
  const g2 = [0x4a2a14, 0xe8e0d0, 0x8a6a3a, 0x3a2410, 0xc8a060];
  let i = 0;
  for (let z = c.z0 + 1.2; z < c.z1 - 0.8; z += 0.6) k.sack(XF(0.32), z, F, g2[i++ % g2.length]);
  wallShelves(c, false, c.z0 + 0.9, c.z1 - 0.4, [1.1, 1.55, 2.0], (y, a, b, _x, rw) => row(c, false, y, a, b, 0.36, rw % 2 ? "tins" : "jars", 7 + rw));
  k.b.box(0.5, 2.6, 0.05, X(0.55), F + 1.3, c.z1 - 0.9, M.pine(), { ry: 0 });
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.1; x < b; x += 0.25) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), c.r() < 0.5 ? blue : lambert("sh_tin_red", { color: 0x8a2a1a }, 0));
      cone.position.set(x, y + 0.15, z);
      k.b.group.add(cone);
    }
  });
}

function dressTobacco(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.5, 0.95, 1.4, 1.85, 2.3], (y, a, b, _x, rw) => row(c, true, y, a, b, 0.36, rw % 2 ? "boxes" : "jars", rw + 3));
  counter(c, M.oak());
  // a glass case of cigars on the counter, the little lamp to light them, a Delft jar
  k.bx(X(1.3), X(0.85), F + 1.16, 0.02, c.zcm - 0.4, c.zcm + 0.3, M.glass());
  for (const z of [c.zcm - 0.4, c.zcm + 0.3]) k.bx(X(1.3), X(0.85), F + 0.97, 0.2, z - 0.01, z + 0.01, M.darkOak());
  k.bx(X(1.28), X(0.87), F + 0.97, 0.06, c.zcm - 0.38, c.zcm + 0.28, lambert("sh_cigars", { color: 0x6a3a1a }, 0));
  k.b.cyl(0.03, 0.12, X(1.2), F + 1.03, c.zc0 + 0.3, M.brass(), false, 6);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 4), M.glow(0xffb040));
  flame.position.set(X(1.2), F + 1.12, c.zc0 + 0.3);
  k.b.group.add(flame);
  k.jar(X(1.05), F + 0.97, c.zc1 - 0.35, 0.11, 0.3, lambert("sh_delft", { color: 0xe0e4ec }, 0), lambert("sh_delftblue", { color: 0x2a3a7a }, 0));
  // clay pipes in a rack on the far wall, bunches of tobacco leaf drying, a carved sign
  const rackZ = c.z0 + (c.z1 - c.z0) * 0.45;
  k.bx(XF(0), XF(0.05), F + 1.2, 0.7, rackZ - 0.5, rackZ + 0.5, M.darkOak());
  for (let i = 0; i < 9; i++) k.b.cyl(0.008, 0.36, XF(0.08), F + 1.52, rackZ - 0.4 + i * 0.1, M.white(), false, 3);
  for (let z = c.z0 + 1.1; z < c.z1 - 0.8; z += 0.9) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.55, 5), lambert("sh_leaf", { color: 0x6a4a22 }, 0));
    leaf.position.set(XF(0.5), F + 2.3, z);
    leaf.rotation.x = Math.PI;
    k.b.group.add(leaf);
  }
  k.bx(XF(0), XF(0.5), F, 0.9, c.z1 - 1.8, c.z1 - 0.9, M.oak(), true);
  row(c, false, F + 0.92, c.z1 - 1.75, c.z1 - 0.95, 0.25, "boxes", 5, 0.25);
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.1; x < b; x += 0.22) k.b.box(0.18, 0.05, 0.12, x, y + 0.025, z, lambert("sh_cigarbox", { color: 0x8a5a2a }, 0), { ry: c.r() * 0.3 });
    k.jar((a + b) / 2, y, z, 0.1, 0.28, lambert("sh_delft", { color: 0xe0e4ec }, 0), lambert("sh_delftblue", { color: 0x2a3a7a }, 0));
  });
}

function dressApothecary(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  // the cabinet of porcelain jars behind the counter (a Codex picture), little drawers below
  const jars = picMat("sh_jarsrow", "/textures/shop_jars.jpg", () => rowTex("jars", 1), 0xffffff, 0, 0.05);
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [1.0, 1.45, 1.9, 2.35], (y, a, b, x) => {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.42), jars);
    const uv = pl.geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * (b - a)) / 1.3);
    pl.position.set(x - c.ns * 0.02, y + 0.21, (a + b) / 2);
    pl.rotation.y = c.ns > 0 ? -Math.PI / 2 : Math.PI / 2;
    k.b.group.add(pl);
  });
  const drawers = picMat("sh_drawers", "/textures/shop_drawers.jpg", () => drawersTex(), 0xffffff, 0, 0.05);
  for (const [a, b] of freeRuns(zc0 - 0.2, c.z1 - 0.3, c.nearHoles)) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.9), drawers);
    pl.position.set(X(0.34) - c.ns * 0.005, F + 0.5, (a + b) / 2);
    pl.rotation.y = c.ns > 0 ? -Math.PI / 2 : Math.PI / 2;
    k.b.group.add(pl);
    c.k.bx(c.nearW, X(0.34), F, 0.95, a, b, M.darkOak());
  }
  counter(c, M.marble(), M.mahogany());
  scale(c, X(1.1), c.zcm - 0.3);
  // mortar and pestle, a row of bottles on the counter
  k.b.cyl(0.1, 0.1, X(1.1), F + 1.02, c.zcm + 0.35, M.white(), false, 8);
  k.b.cyl(0.015, 0.22, X(1.12), F + 1.12, c.zcm + 0.37, M.white(), false, 4);
  for (let i = 0; i < 4; i++) k.bottle(X(1.0), F + 0.97, c.zc1 - 0.2 - i * 0.12, [0x3a2a1a, 0x2a3a4a, 0x5a2a2a, 0x2a4a2a][i], 0.2);
  // the far wall: a glass-fronted cabinet
  wallShelves(c, false, c.z0 + 1.0, c.z1 - 0.5, [0.9, 1.35, 1.8, 2.25], (y, a, b, _x, rw) => row(c, false, y, a, b, 0.36, rw % 2 ? "bottles" : "jars", 11 + rw), 0.4);
  // the show globes in the window: big glass carboys of coloured water, lit from behind at night
  windowDisplay(c, (a, b, y, z) => {
    const cols = [0xa01a1a, 0x1a6a3a, 0x1a3a9a];
    let i = 0;
    for (let x = a + 0.2; x < b - 0.1; x += 0.5) {
      const col = cols[i++ % cols.length];
      const g = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(`sh_globe_${col.toString(16)}`, () => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 })));
      g.position.set(x, y + 0.2, z);
      k.b.group.add(g);
      k.b.cyl(0.04, 0.16, x, y + 0.42, z, M.glass(), false, 6);
    }
  });
  c.k.wallPic(XF(0.02), F + 2.55, c.z0 + 1.0, 0.6, 0.25, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic("sh_board_apo", () => boardTex(["PHARMACIE"], "#1a2942", "#e6dcbc", 192, 64)));
}

function dressBarber(c: Ctx): Seat[] {
  const { k, F, X, XF } = c;
  // no long counter: a small till by the door, the rest is the barber's
  const zc0 = c.zc0;
  k.bx(X(1.25), X(0.75), F, 0.95, zc0, zc0 + 0.9, M.mahogany(), true);
  k.bx(X(1.3), X(0.7), F + 0.95, 0.04, zc0 - 0.03, zc0 + 0.93, M.marble());
  // the mirror on the far wall, the chair before it, a basin on its stand, razors and strops, bottles
  const mz = c.z0 + (c.z1 - c.z0) * 0.5;
  c.k.wallPic(XF(0.02), F + 1.55, mz, 0.9, 1.1, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic("sh_mirror", () => mirrorTex(4)), lambert("sh_gilt", { color: 0xa08030 }, 0));
  k.bx(XF(0), XF(0.45), F, 0.85, mz - 0.7, mz + 0.7, M.mahogany(), true);
  k.bx(XF(0), XF(0.48), F + 0.85, 0.04, mz - 0.72, mz + 0.72, M.marble());
  for (let i = 0; i < 5; i++) k.bottle(XF(0.2), F + 0.89, mz - 0.5 + i * 0.22, [0x5a2a1a, 0x2a4a2a, 0xa08040, 0x3a3a5a, 0x6a2a3a][i], 0.18);
  k.b.cyl(0.2, 0.08, XF(0.25), F + 0.93, mz + 0.45, M.white(), false, 10);
  // the chair: a heavy seat on an iron pedestal, arms, a high back, a head rest, facing the mirror
  const cx = XF(1.15);
  const chairYaw = face(cx, mz, XF(0), mz);
  const g = new THREE.Group();
  g.position.set(cx, F, mz);
  g.rotation.y = chairYaw;
  const leather = lambert("sh_leather", { color: 0x2a1a14 }, 0.1);
  const part = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    g.add(b);
  };
  part(0.25, 0.4, 0.25, 0, 0.2, 0, M.iron());
  part(0.55, 0.12, 0.55, 0, 0.5, 0, leather);
  part(0.55, 0.7, 0.1, 0, 0.9, -0.27, leather);
  part(0.3, 0.14, 0.08, 0, 1.33, -0.29, leather);
  for (const s of [-1, 1]) part(0.07, 0.07, 0.5, s * 0.28, 0.72, 0, M.mahogany());
  part(0.4, 0.05, 0.25, 0, 0.18, 0.45, M.iron());
  k.b.group.add(g);
  k.b.boxes.push({ minX: cx - 0.4, maxX: cx + 0.4, minZ: mz - 0.4, maxZ: mz + 0.4 });
  // towels on a rail, the strop, a shaving mug on the counter, a waiting bench on the near side
  k.b.box(0.04, 0.04, 0.6, X(0.05), F + 1.5, c.z1 - 1.2, M.brass());
  k.b.box(0.02, 0.5, 0.25, X(0.07), F + 1.25, c.z1 - 1.35, M.white());
  k.b.box(0.02, 0.5, 0.25, X(0.07), F + 1.25, c.z1 - 1.05, M.white());
  k.b.box(0.02, 0.6, 0.06, XF(0.03), F + 1.4, mz + 0.9, leather);
  const seats: Seat[] = [];
  const bx0 = X(0.3);
  const bz0 = zc0 + 1.3;
  const bz1 = Math.min(c.z1 - 1.6, bz0 + 1.8);
  k.bx(c.nearW, X(0.45), F + 0.42, 0.05, bz0, bz1, M.oak(), true, 0.8);
  for (const z of [bz0 + 0.1, bz1 - 0.1]) k.bx(c.nearW, X(0.45), F, 0.42, z - 0.04, z + 0.04, M.darkOak());
  k.bx(c.nearW, X(0.05), F + 0.47, 0.5, bz0, bz1, M.oak());
  for (let z = bz0 + 0.35; z < bz1 - 0.2; z += 0.6) seats.push({ x: bx0 - c.ns * 0.05, z, yaw: c.toFar, table: 0, h: 0.46, via: [[X(1.2), z]] });
  // the barber's chair takes a customer too (sitting, facing the mirror)
  seats.push({ x: cx, z: mz, yaw: chairYaw, table: 1, h: 0.56, via: [[XF(1.9), mz - 0.2]] });
  // the pole and basin sign painted small on the back wall, a price board
  c.k.wallPic((X(0) + XF(0)) / 2, F + 2.2, c.z1 - 0.02, 0.9, 0.35, Math.PI, M.basic("sh_board_barber", () => boardTex(["SHAVE 3 C", "HAIRCUT 6 C"], "#e6ddc8", "#4d140f", 256, 96)));
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.1; x < b; x += 0.2) k.bottle(x, y, z, [0x5a2a1a, 0x2a4a2a, 0xa08040][Math.floor(c.r() * 3)], 0.22);
  });
  return seats;
}

/** A hat on a head block, or on a shelf: top hat, bowler, cap. */
function hat(k: Kit, x: number, y: number, z: number, kind: number): void {
  const felt = lambert(kind === 2 ? "sh_hat_tweed" : kind === 1 ? "sh_hat_brown" : "sh_hat_black", { color: kind === 2 ? 0x5a5040 : kind === 1 ? 0x4a3020 : 0x141414 }, 0);
  if (kind === 0) {
    k.b.cyl(0.14, 0.01, x, y + 0.005, z, felt, false, 10);
    k.b.cyl(0.09, 0.2, x, y + 0.11, z, felt, false, 10);
  } else if (kind === 1) {
    k.b.cyl(0.14, 0.01, x, y + 0.005, z, felt, false, 10);
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.095, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), felt);
    d.position.set(x, y + 0.01, z);
    d.scale.y = 1.1;
    k.b.group.add(d);
  } else {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), felt);
    d.position.set(x, y, z);
    d.scale.y = 0.45;
    k.b.group.add(d);
    k.b.box(0.1, 0.01, 0.08, x, y + 0.005, z + 0.1, felt);
  }
}

function dressHatter(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.6, 1.1, 1.6, 2.1], (y, a, b, x, rw) => {
    if (rw >= 2) row(c, true, y, a, b, 0.4, "hatboxes", rw);
    else for (let z = a + 0.18; z < b - 0.1; z += 0.34) hat(k, x, y, z, Math.floor(c.r() * 3));
  });
  counter(c, M.oak(), M.mahogany());
  // hat boxes on the counter, a table in the middle with hats on wooden heads, a tall mirror
  for (let i = 0; i < 3; i++) k.b.cyl(0.17, 0.22, X(1.05), F + 1.08 + i * 0.001, c.zc1 - 0.3 - i * 0.4, lambert("sh_hatbox", { color: [0x8a7a60, 0x3a2a22, 0xa08a6a][i] }, 0), false, 10);
  const tz = c.z0 + (c.z1 - c.z0) * 0.55;
  k.squareTable(XF(0.8), tz, F, 0.7, 1.4, M.mahogany());
  for (const dz of [-0.45, 0, 0.45]) {
    k.b.cyl(0.02, 0.3, XF(0.8), F + 0.92, tz + dz, M.darkOak(), false, 4);
    k.b.cyl(0.08, 0.16, XF(0.8), F + 1.12, tz + dz, lambert("sh_block_head", { color: 0xb89a70 }, 0), false, 8);
    hat(k, XF(0.8), F + 1.2, tz + dz, Math.floor(c.r() * 3));
  }
  c.k.wallPic(XF(0.02), F + 1.3, c.z1 - 1.0, 0.5, 1.5, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic("sh_mirror", () => mirrorTex(4)), M.darkOak());
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.15; x < b - 0.05; x += 0.35) {
      k.b.cyl(0.015, 0.25, x, y + 0.125, z, M.darkOak(), false, 4);
      hat(k, x, y + 0.26, z, Math.floor(c.r() * 3));
    }
  });
}

function dressRoaster(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.6, 1.1, 1.6, 2.1], (y, a, b, _x, rw) => row(c, true, y, a, b, 0.38, rw % 2 ? "tins" : "boxes", 20 + rw));
  counter(c, M.oak());
  scale(c, X(1.1), c.zcm - 0.4);
  // a coffee pot on the counter, thick cups; the roasting drum on its brick furnace at the back
  k.b.cyl(0.08, 0.24, X(1.05), F + 1.09, c.zcm + 0.35, M.copper(), false, 8);
  for (let i = 0; i < 3; i++) k.b.cyl(0.04, 0.07, X(1.2), F + 1.0, c.zcm + 0.05 + i * 0.1, M.white(), false, 6);
  const dx = XF(1.0);
  const dz = c.z1 - 0.9;
  k.bx(dx - 0.55, dx + 0.55, F, 0.7, dz - 0.45, dz + 0.45, lambert("sh_ovenbrick", { map: tex().brick, color: 0xa07060 }), true, 0.8);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 10), M.iron());
  drum.rotation.z = Math.PI / 2;
  drum.position.set(dx, F + 1.05, dz);
  k.b.group.add(drum);
  k.b.box(0.06, 0.06, 0.5, dx + 0.45, F + 1.05, dz, M.iron());
  k.b.cyl(0.1, 1.6, dx, F + 2.1, dz, M.iron(), false, 6);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.12), M.glow(0xff8030));
  gl.position.set(dx, F + 0.35, dz - 0.46);
  gl.rotation.y = Math.PI;
  k.b.group.add(gl);
  fireLight(c, dx, F + 0.6, dz - 0.8, 3);
  // sacks of green beans and a cooling sieve
  for (let i = 0; i < 3; i++) k.sack(XF(0.33), c.z0 + 1.2 + i * 0.6, F, 0x6a7a4a);
  k.b.cyl(0.4, 0.12, XF(0.55), F + 0.62, c.z0 + 3.2, M.copper(), true, 12);
  k.b.cyl(0.36, 0.02, XF(0.55), F + 0.69, c.z0 + 3.2, lambert("sh_beans", { color: 0x3a2010 }, 0), false, 12);
  // a standing table for a cup
  k.b.cyl(0.25, 0.04, X(2.4), F + 1.05, c.z1 - 1.9, M.oak(), false, 8);
  k.b.cyl(0.04, 1.03, X(2.4), F + 0.52, c.z1 - 1.9, M.iron(), true, 5);
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.15; x < b; x += 0.4) k.sack(x, z, y, 0x3a2010, false);
  });
}

function dressPrinter(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.7, 1.2, 1.7, 2.2], (y, a, b, _x, rw) => row(c, true, y, a, b, 0.4, rw % 2 ? "books" : "boxes", 30 + rw));
  counter(c, M.oak());
  // stacks of paper on the counter
  for (let i = 0; i < 3; i++) k.b.box(0.3, 0.1 + i * 0.03, 0.4, X(1.05), F + 1.02 + i * 0.015, c.zc0 + 0.35 + i * 0.45, lambert("sh_paper", { color: 0xe0d8c0 }, 0));
  // the iron hand press at the back: two cheeks, the head, the platen, the bed and its rails, the bar
  const px = XF(1.1);
  const pz = c.z1 - 1.3;
  const iron = M.iron();
  for (const s of [-0.35, 0.35]) k.b.box(0.1, 1.9, 0.14, px, F + 0.95, pz + s, iron);
  k.b.box(0.22, 0.3, 0.84, px, F + 1.8, pz, iron);
  k.b.box(0.55, 0.06, 0.6, px, F + 1.1, pz, iron);
  k.b.box(1.6, 0.08, 0.66, px - 0.2, F + 0.82, pz, iron);
  k.b.box(1.6, 0.8, 0.5, px - 0.2, F + 0.4, pz, M.darkOak());
  k.b.box(0.03, 0.03, 0.6, px + 0.1, F + 1.4, pz - 0.5, M.iron(), { ry: 0.6 });
  k.b.boxes.push({ minX: px - 1.0, maxX: px + 0.6, minZ: pz - 0.5, maxZ: pz + 0.5 });
  // type cases on their stands along the far wall, sheets hanging to dry overhead
  for (let z = c.z0 + 1.1; z < pz - 0.9; z += 0.95) {
    k.bx(XF(0), XF(0.55), F, 1.05, z - 0.4, z + 0.4, M.oak(), true);
    const tc = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.75), paintMat("sh_typecase", () => typeCaseTex()));
    tc.position.set(XF(0.3), F + 1.12, z);
    tc.rotation.set(-Math.PI / 2 + 0.35, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, 0, "YXZ");
    k.b.group.add(tc);
  }
  for (let z = c.z0 + 1.0; z < c.z1 - 0.5; z += 0.5) {
    k.b.box(0.005, 0.32, 0.4, (X(2.0) + XF(0.9)) / 2, F + 2.45, z, lambert("sh_sheet", { color: 0xe8e0c8, side: THREE.DoubleSide }, 0));
  }
  k.bx(X(2.0), XF(0.9), F + 2.62, 0.01, c.z0 + 0.8, c.z1 - 0.4, M.iron());
  windowDisplay(c, (a, b, y, z) => {
    c.k.wallPic((a + b) / 2, y + 0.35, z + 0.1, Math.min(0.5, b - a - 0.1), 0.65, Math.PI, M.basic("sh_poster_print", () => posterTex(["ALMANAC", "1874", "FOR ANTWERP", "10 CENTIMES"], "#e0d6b8", "#2a2018", "ship", 3)));
  });
}

function dressBooks(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  const books = picMat("sh_books", "/textures/shop_books.jpg", () => rowTex("books", 2), 0xffffff, 0, 0.05);
  const bookRow = (onNear: boolean, y: number, a: number, b: number, x: number) => {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.38), books);
    const uv = pl.geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (uv.getX(i) * (b - a)) / 1.2);
    const sgn = onNear ? -c.ns : c.ns;
    pl.position.set(x + sgn * 0.04, y + 0.19, (a + b) / 2);
    pl.rotation.y = sgn > 0 ? Math.PI / 2 : -Math.PI / 2;
    k.b.group.add(pl);
  };
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.45, 0.9, 1.35, 1.8, 2.25], (y, a, b, x) => bookRow(true, y, a, b, x));
  wallShelves(c, false, c.z0 + 0.8, c.z1 - 0.3, [0.1, 0.55, 1.0, 1.45, 1.9, 2.35], (y, a, b, x) => bookRow(false, y, a, b, x), 0.32);
  counter(c, M.oak());
  // piles of books on the counter and a table, the ladder
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3 + (i % 3); j++) k.b.box(0.22, 0.05, 0.3, X(1.05), F + 0.995 + j * 0.05, c.zc0 + 0.3 + i * 0.35, lambert(`sh_book_${(i + j) % 4}`, { color: [0x5a2a1a, 0x2a3a2a, 0x1a2a3a, 0x4a3a22][(i + j) % 4] }, 0), { ry: (c.r() - 0.5) * 0.3 });
  const tz = c.z0 + (c.z1 - c.z0) * 0.55;
  k.squareTable((X(1.9) + XF(0.4)) / 2 + (XF(0.4) - X(1.9)) * 0.15, tz, F, 0.6, 1.1, M.oak());
  for (let j = 0; j < 5; j++) k.b.box(0.24, 0.05, 0.32, (X(1.9) + XF(0.4)) / 2 + (XF(0.4) - X(1.9)) * 0.15, F + 0.8 + j * 0.05, tz - 0.3 + (j % 2) * 0.5, lambert(`sh_book_${j % 4}`, { color: [0x5a2a1a, 0x2a3a2a, 0x1a2a3a, 0x4a3a22][j % 4] }, 0), { ry: c.r() * 0.4 });
  k.b.box(0.45, 2.4, 0.05, XF(0.5), F + 1.2, c.z1 - 1.0, M.pine());
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.1; x < b; x += 0.18) {
      const bk = k.b.box(0.14, 0.2, 0.03, x, y + 0.1, z + 0.1, lambert(`sh_book_${Math.floor(c.r() * 4)}`, { color: [0x5a2a1a, 0x2a3a2a, 0x1a2a3a, 0x4a3a22][Math.floor(c.r() * 4)] }, 0));
      bk.rotation.x = -0.2;
    }
  });
}

function dressClocks(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [1.2, 1.7], (y, a, b, x) => {
    for (let z = a + 0.2; z < b - 0.1; z += 0.35) {
      k.b.box(0.16, 0.26, 0.2, x, y + 0.13, z, M.mahogany());
      k.clock(x - c.ns * 0.081, y + 0.16, z, 0.13, c.ns > 0 ? -Math.PI / 2 : Math.PI / 2, M.basic(`sh_face_${Math.floor(z * 10) % 3}`, () => clockFaceTex(Math.floor(z * 10) % 3)), "clockmaker's shelf clock");
    }
  });
  // a glass counter of watches
  counter(c, M.glass(), M.mahogany());
  k.bx(X(1.3), X(0.85), F + 0.9, 0.02, c.zc0 + 0.1, c.zc1 - 0.1, lambert("sh_velvet", { color: 0x3a1a22 }, 0));
  for (let z = c.zc0 + 0.25; z < c.zc1 - 0.2; z += 0.2) k.b.cyl(0.035, 0.012, X(1.1), F + 0.925, z, [M.zinc(), M.brass()][Math.floor(c.r() * 2)], false, 8);
  // wall clocks all over the far wall, their pendulums; a tall case clock by the back
  for (let z = c.z0 + 0.9; z < c.z1 - 1.2; z += 0.6)
    for (const y of [1.2, 1.85, 2.45]) {
      if (c.farHoles.some(([a, b]) => z > a - 0.4 && z < b + 0.4)) continue;
      const big = c.r() < 0.35;
      k.bx(c.farW, XF(0.12), F + y - (big ? 0.35 : 0.2), big ? 0.7 : 0.4, z - 0.17, z + 0.17, M.mahogany());
      k.clock(XF(0.125), F + y, z, 0.24, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic(`sh_face_${Math.floor(y * z) % 3}`, () => clockFaceTex(Math.floor(y * z) % 3)), "clockmaker's wall clock");
      if (big) k.b.box(0.01, 0.02, 0.1, XF(0.13), F + y - 0.25, z, M.brass());
    }
  const cz = c.z1 - 0.6;
  k.bx(XF(0.05), XF(0.5), F, 2.2, cz - 0.25, cz + 0.25, M.mahogany(), true);
  k.clock(XF(0.505), F + 1.85, cz, 0.3, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic("sh_face_tall", () => clockFaceTex(1)), "clockmaker's tall case clock");
  // the workbench at the back with its lamp and tools, a stool
  const wz = c.z1 - 1.6;
  k.bx(X(2.2), X(1.5), F, 0.85, wz - 0.5, wz + 0.5, M.oak(), true);
  for (let i = 0; i < 6; i++) k.b.box(0.08, 0.01, 0.02, X(1.8) + (c.r() - 0.5) * 0.4, F + 0.86, wz + (c.r() - 0.5) * 0.6, M.brass());
  k.b.cyl(0.05, 0.3, X(1.9), F + 1.0, wz + 0.35, M.brass(), false, 6);
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.15; x < b; x += 0.3) {
      k.b.box(0.2, 0.32, 0.12, x, y + 0.16, z, M.mahogany());
      k.clock(x, y + 0.2, z - 0.061, 0.14, Math.PI, M.basic("sh_face_win", () => clockFaceTex(0)), "clockmaker's window clock");
    }
  });
}

function dressChandler(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.6, 1.1, 1.6, 2.1], (y, a, b, _x, rw) => row(c, true, y, a, b, 0.38, rw % 2 ? "tins" : "bottles", 40 + rw));
  counter(c, M.oak());
  // coils of rope on the floor and hanging, lanterns from the beams, barrels of biscuit, oilskins on pegs
  const rope = lambert("sh_rope", { map: tex().rope, color: 0xb09a70 });
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 5, 10), rope);
    t.rotation.x = Math.PI / 2;
    t.position.set(XF(0.45), F + 0.08 + i * 0.14, c.z0 + 1.3);
    k.b.group.add(t);
  }
  k.b.boxes.push({ minX: Math.min(XF(0.1), XF(0.8)), maxX: Math.max(XF(0.1), XF(0.8)), minZ: c.z0 + 0.95, maxZ: c.z0 + 1.65 });
  for (let z = c.z0 + 2.2; z < c.z1 - 1.0; z += 0.8) k.b.barrel(XF(0.4), F + 0.4, z, false, true);
  for (let z = c.z0 + 1.2; z < c.z1 - 0.8; z += 0.9) k.b.box(0.18, 0.26, 0.18, (X(1.8) + XF(0.6)) / 2, F + 2.45, z, M.iron());
  for (let z = c.z1 - 1.4; z < c.z1 - 0.2; z += 0.4) {
    const coat = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.25, 1.1, 6), lambert("sh_oilskin", { color: 0x6a5a1a }, 0));
    coat.position.set(XF(0.2), F + 1.3, z);
    k.b.group.add(coat);
  }
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.15; x < b; x += 0.4) k.b.box(0.18, 0.26, 0.18, x, y + 0.13, z, M.iron());
  });
}

function dressCobbler(c: Ctx): void {
  const { k, F, XF, zc0 } = c;
  // boots in rows on the shelves behind the counter
  const boot = lambert("sh_boot", { color: 0x2a1a12 }, 0);
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.5, 1.0, 1.5, 2.0], (y, a, b, x) => {
    for (let z = a + 0.12; z < b - 0.1; z += 0.22) {
      k.b.box(0.1, 0.2, 0.08, x, y + 0.1, z, boot);
      k.b.box(0.24, 0.07, 0.09, x - c.ns * 0.02, y + 0.035, z, boot);
    }
  });
  counter(c, M.oak());
  // the low bench by the far side with the cobbler's stool, lasts, a hide hanging, leather scraps
  const wz = c.z0 + (c.z1 - c.z0) * 0.55;
  k.bx(XF(0.1), XF(0.8), F, 0.5, wz - 0.6, wz + 0.6, M.oak(), true);
  for (let i = 0; i < 6; i++) k.b.box(0.08, 0.02, 0.03, XF(0.45) + (c.r() - 0.5) * 0.4, F + 0.51, wz + (c.r() - 0.5) * 0.9, M.iron());
  k.b.cyl(0.18, 0.04, XF(1.2), F + 0.4, wz, M.oak(), false, 8);
  k.b.cyl(0.03, 0.38, XF(1.2), F + 0.19, wz, M.darkOak(), false, 4);
  const hide = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), lambert("sh_hide", { color: 0x8a5a30, side: THREE.DoubleSide }, 0));
  hide.position.set(XF(0.03), F + 1.8, wz + 1.2);
  hide.rotation.y = c.ns > 0 ? Math.PI / 2 : -Math.PI / 2;
  k.b.group.add(hide);
  for (let i = 0; i < 5; i++) k.b.box(0.1, 0.18, 0.08, XF(0.3), F + 0.7 + 0.001 * i, wz - 1.2 + i * 0.15, lambert("sh_last", { color: 0xa08060 }, 0));
  windowDisplay(c, (a, b, y, z) => {
    for (let x = a + 0.1; x < b; x += 0.25) {
      k.b.box(0.08, 0.2, 0.1, x, y + 0.1, z, boot);
      k.b.box(0.08, 0.07, 0.25, x, y + 0.035, z - 0.06, boot);
    }
  });
}

function dressDraper(c: Ctx): void {
  const { k, F, X, XF, zc0 } = c;
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.4, 0.85, 1.3, 1.75, 2.2], (y, a, b, _x, rw) => row(c, true, y, a, b, 0.42, "bolts", 50 + rw));
  counter(c, M.oak(), M.mahogany());
  // bolts laid out on the counter, the brass yard rule along its edge, scissors
  const bcols = [0x3a4a5a, 0x6a2a2a, 0x4a5a3a, 0x8a7a5a];
  for (let i = 0; i < 3; i++) {
    const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.6), lambert(`sh_bolt_${i}`, { color: bcols[i] }, 0.1));
    bolt.position.set(X(1.1), F + 1.02 + i * 0.1, c.zcm - 0.3 + i * 0.05);
    k.b.group.add(bolt);
  }
  k.b.box(0.02, 0.01, 0.92, X(1.38), F + 0.975, c.zcm + 0.2, M.brass());
  // the far wall's shelves of cloth and a dress form
  wallShelves(c, false, c.z0 + 0.9, c.z1 - 0.4, [0.5, 1.0, 1.5, 2.0], (y, a, b, _x, rw) => row(c, false, y, a, b, 0.44, "bolts", 60 + rw), 0.45);
  const fz = c.z1 - 1.2;
  const fx = (X(1.9) + XF(0.5)) / 2;
  k.b.cyl(0.02, 1.0, fx, F + 0.5, fz, M.darkOak(), true, 4);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.12, 0.6, 8), lambert("sh_form", { color: 0x5a4a3a }, 0));
  torso.position.set(fx, F + 1.3, fz);
  k.b.group.add(torso);
  windowDisplay(c, (a, b, y, z) => {
    let i = 0;
    for (let x = a + 0.12; x < b; x += 0.26) {
      const bolt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.12), lambert(`sh_bolt_${i % 3}`, { color: bcols[i % 3] }, 0.1));
      bolt.position.set(x, y + 0.25, z);
      bolt.rotation.x = -0.25;
      k.b.group.add(bolt);
      i++;
    }
  });
}

function dressBerg(c: Ctx): Seat[] {
  const { k, F, X, XF, zc0 } = c;
  // pledges in bundles with their tickets on the shelves behind the grille
  const bundle = lambert("sh_bundle", { map: tex().sack, color: 0x9a8a6a });
  wallShelves(c, true, zc0 - 0.2, c.z1 - 0.3, [0.5, 1.0, 1.5, 2.0, 2.5], (y, a, b, x) => {
    for (let z = a + 0.15; z < b - 0.1; z += 0.3) {
      k.b.box(0.24, 0.2 + c.r() * 0.12, 0.24, x, y + 0.12, z, bundle);
      k.b.box(0.005, 0.06, 0.04, x - c.ns * 0.125, y + 0.1, z, M.white());
    }
  });
  counter(c, M.oak(), M.darkOak());
  // the grille over the counter: iron bars up to a rail, a window in it
  const gx = X(1.38);
  for (let z = c.zc0; z <= c.zc1; z += 0.12) {
    if (Math.abs(z - c.zcm) < 0.3) continue;
    k.b.cyl(0.008, 1.25, gx, F + 1.6, z, M.iron(), false, 3);
  }
  k.bx(gx - 0.02, gx + 0.02, F + 2.22, 0.04, c.zc0, c.zc1, M.iron());
  // the ledger on the counter, a notice, a bench to wait on, the clock
  k.b.box(0.3, 0.05, 0.42, X(1.05), F + 1.0, c.zcm, lambert("sh_ledger", { color: 0x3a1a12 }, 0));
  c.k.wallPic(XF(0.02), F + 1.7, c.z0 + 1.2, 0.5, 0.7, c.ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic("sh_notice_berg", () => posterTex(["NOTICE", "Pledges not", "redeemed are", "sold at the", "Berg's sale"], "#d8ccb0", "#2a2018", "none", 7)));
  const seats: Seat[] = [];
  const bz0 = c.z0 + 2.0;
  const bz1 = Math.min(c.z1 - 1.0, bz0 + 2.2);
  k.bx(c.farW, XF(0.42), F + 0.42, 0.05, bz0, bz1, M.oak(), true, 0.8);
  for (const z of [bz0 + 0.1, bz1 - 0.1]) k.bx(c.farW, XF(0.42), F, 0.42, z - 0.04, z + 0.04, M.darkOak());
  for (let z = bz0 + 0.35; z < bz1 - 0.2; z += 0.6) seats.push({ x: XF(0.25), z, yaw: c.toNear, table: 0, h: 0.46, via: [[XF(1.0), z]] });
  return seats;
}

// ------------------------------------------------------------------ small shared pieces

function scale(c: Ctx, x: number, z: number): void {
  const { k, F } = c;
  const y = F + 0.97;
  k.b.box(0.34, 0.04, 0.16, x, y + 0.02, z, M.brass());
  k.b.cyl(0.015, 0.3, x, y + 0.19, z, M.brass(), false, 4);
  k.b.box(0.36, 0.015, 0.015, x, y + 0.34, z, M.brass());
  for (const s of [-0.16, 0.16]) k.b.cyl(0.08, 0.015, x + s * (c.ns > 0 ? 0 : 0), y + 0.2, z + s, M.brass(), false, 8);
}

function fireLight(c: Ctx, x: number, y: number, z: number, w: number): void {
  const l = new THREE.PointLight(0xff8a40, w, 6, 1.5);
  l.position.set(x, y, z);
  c.b.group.add(l);
  c.fires.push({ l, w, p: new THREE.Vector3() });
}

/** A moulding round the top of a room's walls, 0.16 m deep: a straight line where each wall meets the ceiling. */
export function cornice(k: Kit, x0: number, x1: number, z0: number, z1: number, top: number, m: THREE.Material): void {
  const d = 0.1;
  const h = 0.16;
  k.bx(x0, x0 + d, top - h, h, z0, z1, m);
  k.bx(x1 - d, x1, top - h, h, z0, z1, m);
  k.bx(x0, x1, top - h, h, z0, z0 + d, m);
  k.bx(x0, x1, top - h, h, z1 - d, z1, m);
  k.bx(x0, x0 + d * 1.6, top - h - 0.04, 0.04, z0, z1, m);
  k.bx(x1 - d * 1.6, x1, top - h - 0.04, 0.04, z0, z1, m);
  k.bx(x0, x1, top - h - 0.04, 0.04, z0, z0 + d * 1.6, m);
  k.bx(x0, x1, top - h - 0.04, 0.04, z1 - d * 1.6, z1, m);
}

/** Raw meat: dark red with pink and white marbling. */
function meatTex(): THREE.CanvasTexture {
  return canvasTexOf(32, 32, (g) => {
    g.fillStyle = "#6a1c18";
    g.fillRect(0, 0, 32, 32);
    let s = 7;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() < 0.5 ? "rgba(160,70,62,0.7)" : "rgba(120,36,30,0.8)";
      g.fillRect(r() * 32, r() * 32, 2 + r() * 6, 1 + r() * 3);
    }
    g.strokeStyle = "rgba(220,200,170,0.75)";
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(r() * 32, r() * 32);
      g.quadraticCurveTo(r() * 32, r() * 32, r() * 32, r() * 32);
      g.lineWidth = 0.6 + r();
      g.stroke();
    }
  });
}

/** The wall of small drawers with white label plates (stand-in for the Codex picture). */
function drawersTex(): THREE.CanvasTexture {
  return canvasTexOf(64, 64, (g) => {
    g.fillStyle = "#2a1a10";
    g.fillRect(0, 0, 64, 64);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++) {
        g.fillStyle = "#4a3020";
        g.fillRect(x * 10.6 + 1, y * 10.6 + 1, 9, 9);
        g.fillStyle = "#e0dccf";
        g.fillRect(x * 10.6 + 3, y * 10.6 + 3, 5, 2);
        g.fillStyle = "#b08a3a";
        g.fillRect(x * 10.6 + 5, y * 10.6 + 7, 1, 1);
      }
  });
}

/** A printer's type case seen from above: the little boxes. */
function typeCaseTex(): THREE.CanvasTexture {
  return canvasTexOf(32, 48, (g) => {
    g.fillStyle = "#3a2618";
    g.fillRect(0, 0, 32, 48);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 6; x++) {
        g.fillStyle = (x + y) % 3 ? "#5a4a3a" : "#4a4440";
        g.fillRect(x * 5.3 + 1, y * 6 + 1, 4, 5);
      }
  });
}

function canvasTexOf(w: number, h: number, paint: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  paint(cv.getContext("2d")!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ------------------------------------------------------------------ the floor, the walls, the light, per trade

interface Finish {
  floor: () => THREE.Material;
  wall: () => THREE.Material;
  /** A dado of panelling or tiles up to this height (0: none). */
  dado: number;
  dadoMat?: () => THREE.Material;
  lamp: "oil" | "globe";
  fog: number;
  /** A poster or picture on the far wall near the front. */
  pic?: () => THREE.Material;
}

const boards = (c: number) => () => paintMat(`sh_boards_${c.toString(16)}`, () => tex().planks, c, 0.005, 0.3);
const tiles = (a: string, b: string, n: number, saw: number, key: string) => () => paintMat(`sh_tiles_${key}`, () => checkerTex(a, b, n, key.length * 7, saw), 0xffffff, 0.003, 0.2);
const flags = () => paintMat("sh_flags", () => tex().cobble, 0x9a9288, 0.01, 0.3);
const plasterOf = (seed: number, tint: [number, number, number]) => () => mat(`sh_plaster_${seed}`, () => psx(new THREE.MeshLambertMaterial({ map: plaster(seed, tint) }), { affine: 0.3 }));

const FINISH: Record<ShopTrade, Finish> = {
  baker: { floor: tiles("#8a4a32", "#b0a080", 8, 60, "baker"), wall: plasterOf(301, [196, 184, 150]), dado: 0.9, lamp: "oil", fog: 0x2a2016 },
  butcher: { floor: tiles("#9a3a2a", "#d8d0c0", 8, 220, "butcher"), wall: () => paintMat("sh_whitetiles", whiteTilesTex, 0xffffff, 0, 0.1), dado: 0, lamp: "globe", fog: 0x2a2420 },
  grocer: { floor: boards(0x8a6a4a), wall: plasterOf(303, [176, 160, 120]), dado: 1.0, lamp: "oil", fog: 0x221a12 },
  colonial: { floor: boards(0x7a5a3a), wall: plasterOf(304, [150, 128, 96]), dado: 1.0, lamp: "oil", fog: 0x221a12 },
  tobacconist: { floor: boards(0x6a4a30), wall: plasterOf(305, [140, 110, 80]), dado: 1.1, lamp: "oil", fog: 0x2a2018 },
  pawnbroker: { floor: boards(0x6a5a48), wall: plasterOf(306, [150, 146, 128]), dado: 1.1, lamp: "oil", fog: 0x1a1a18 },
  cobbler: { floor: boards(0x7a5a40), wall: plasterOf(307, [160, 140, 110]), dado: 0, lamp: "oil", fog: 0x221a12 },
  draper: { floor: boards(0x8a6a4a), wall: plasterOf(308, [186, 176, 150]), dado: 1.0, lamp: "globe", fog: 0x221e18 },
  apothecary: { floor: tiles("#1a1a1c", "#d8d4c8", 8, 0, "apothecary"), wall: plasterOf(309, [196, 190, 170]), dado: 1.0, lamp: "globe", fog: 0x1e1c1a },
  barber: { floor: tiles("#6a2a22", "#c8c0b0", 10, 30, "barber"), wall: plasterOf(310, [190, 176, 150]), dado: 1.1, lamp: "globe", fog: 0x221e1a, pic: () => M.basic("sh_poster_barber", () => posterTex(["BAY RUM", "HAIR OIL", "PARIS"], "#1a2a3a", "#e0d0a0", "none", 5)) },
  hatter: { floor: boards(0x7a5a40), wall: plasterOf(311, [170, 160, 140]), dado: 1.0, lamp: "globe", fog: 0x201c18 },
  roaster: { floor: flags, wall: plasterOf(312, [150, 126, 100]), dado: 0, lamp: "oil", fog: 0x2a1c12 },
  printer: { floor: boards(0x5a4a3a), wall: plasterOf(313, [170, 166, 150]), dado: 0, lamp: "oil", fog: 0x1e1c18, pic: () => M.basic("sh_poster_print2", () => posterTex(["AUCTION", "OF A SHIP'S", "CARGO", "AT THE", "ENTREPOT"], "#e0d6b8", "#2a2018", "none", 4)) },
  bookseller: { floor: boards(0x6a4a30), wall: plasterOf(314, [160, 146, 120]), dado: 0, lamp: "oil", fog: 0x1e1812 },
  clockmaker: { floor: boards(0x6a5040), wall: plasterOf(315, [176, 166, 140]), dado: 1.0, lamp: "globe", fog: 0x1e1a16 },
  chandler: { floor: boards(0x6a5a44), wall: plasterOf(316, [150, 146, 136]), dado: 0, lamp: "oil", fog: 0x1a1a18, pic: () => M.basic("sh_poster_chandler", () => posterTex(["RED STAR LINE", "ANTWERP", "NEW YORK", "EVERY WEEK"], "#1a2a4a", "#e8dcc0", "ship", 6)) },
};

const DRESS: Record<ShopTrade, (c: Ctx) => Seat[] | void> = {
  baker: dressBaker,
  butcher: dressButcher,
  grocer: dressGrocer,
  colonial: dressColonial,
  tobacconist: dressTobacco,
  apothecary: dressApothecary,
  barber: dressBarber,
  hatter: dressHatter,
  roaster: dressRoaster,
  printer: dressPrinter,
  bookseller: dressBooks,
  clockmaker: dressClocks,
  chandler: dressChandler,
  cobbler: dressCobbler,
  draper: dressDraper,
  pawnbroker: dressBerg,
};

/** A shop's ground floor in its own house (shared/housePlan.ts kind "shop"), dressed by its trade. */
export function buildShop(opts: { plan: HousePlan; trade: ShopTrade; label: string; seed: number }): Room {
  const p = opts.plan;
  const I = p.room.rect;
  const F = p.room.y;
  const H = 3.1;
  const fin = FINISH[opts.trade];
  const { scene, group, toWorld, toLocal } = frameRoom(p.origin, p.yaw, fin.fog);
  scene.background = null;
  const stat = new THREE.Group();
  group.add(stat);
  const b = new Builder(stat);
  const k = new Kit(b);
  const r = rand(opts.seed);
  const { minX: x0, maxX: x1, minZ: z0, maxZ: zHouse } = I;
  // a deep house keeps its back room behind a partition with a door: the shop is the front 6.6 m
  const z1 = zHouse - z0 > 8.2 ? z0 + 6.6 : zHouse;
  // the counter along the side wall nearer the door, as in the taprooms; but when the door is close to that wall
  // (a narrow shop with its door in the side bay) along the other one, so the way in from the door stays free
  const near0 = x1 < -x0 ? 1 : -1;
  const ns = Math.min(x1, -x0) < 2.0 ? -near0 : near0;
  const nearW = ns > 0 ? x1 : x0;
  const farW = ns > 0 ? x0 : x1;
  const X = (d: number) => nearW - ns * d;
  const XF = (d: number) => farW + ns * d;
  const zc0 = z0 + 1.45;
  const zc1 = Math.max(zc0 + 1.8, Math.min(zc0 + 3.4, z1 - 1.7));
  const zspan = (face: "minX" | "maxX") => holesOn(p, face, 0, false).map((h) => [h.s0, h.s1] as [number, number]);
  const nearFace = ns > 0 ? "maxX" : "minX";
  const farFace = ns > 0 ? "minX" : "maxX";
  const fronts = p.windows.filter((w) => w.kind === "hole" && w.out[1] < -0.5).map((w) => span(w.a[0], w.b[0]));
  const c: Ctx = {
    p, b, k, r, F, H, x0, x1, z0, z1, ns, nearW, farW, X, XF, zc0, zc1, zcm: (zc0 + zc1) / 2,
    fronts, nearHoles: zspan(nearFace), farHoles: zspan(farFace),
    lights: [], glows: [], seats: [], stands: [], fires: [],
    toNear: ns > 0 ? Math.PI / 2 : -Math.PI / 2,
    toFar: ns > 0 ? -Math.PI / 2 : Math.PI / 2,
  };

  // floor, ceiling, walls (the house's holes), a dado, beams
  const wall = fin.wall();
  k.bx(x0, x1, F - 0.1, 0.1, z0, zHouse, fin.floor(), false, 2.0);
  k.bx(x0, x1, F + H, 0.1, z0, zHouse, M.darkOak(), false, 1.6);
  wallFace(stat, [x0, z0], [x1, z0], F, F + H, [0, 1], holesOn(p, "front", x0, true), wall, H + 0.2);
  wallFace(stat, [x0, zHouse], [x0, z0], F, F + H, [1, 0], holesOn(p, "minX", zHouse, false).map((h) => ({ ...h, s0: -h.s1, s1: -h.s0 })), wall, H + 0.2);
  wallFace(stat, [x1, z0], [x1, zHouse], F, F + H, [-1, 0], holesOn(p, "maxX", z0, false), wall, H + 0.2);
  wallFace(stat, [x1, z1], [x0, z1], F, F + H, [0, -1], [], wall, H + 0.2);
  if (z1 < zHouse - 0.05) {
    // the partition to the back room: its back face too (seen through a side window further back), and the house's back wall
    wallFace(stat, [x0, z1 + 0.12], [x1, z1 + 0.12], F, F + H, [0, 1], [], wall);
    k.bx(x0, x1, F, H, z1, z1 + 0.12, M.darkOak(), true);
    wallFace(stat, [x1, zHouse], [x0, zHouse], F, F + H, [0, -1], [], wall);
  }
  if (fin.dado > 0) {
    const dm = fin.dadoMat?.() ?? M.darkOak();
    const inset = 0.02;
    wallFace(stat, [x0 + inset, z1 - inset], [x0 + inset, z0 + inset], F, F + fin.dado, [1, 0], holesOn(p, "minX", z1, false).map((h) => ({ ...h, s0: -h.s1, s1: -h.s0 })), dm, 1.2);
    wallFace(stat, [x1 - inset, z0 + inset], [x1 - inset, z1 - inset], F, F + fin.dado, [-1, 0], holesOn(p, "maxX", z0, false), dm, 1.2);
    wallFace(stat, [x1, z1 - inset], [x0, z1 - inset], F, F + fin.dado, [0, -1], [], dm, 1.2);
    // a rail on top of the dado
    for (const [xa, xb, za, zb] of [[x0, x0 + 0.04, z0, z1], [x1 - 0.04, x1, z0, z1], [x0, x1, z1 - 0.04, z1]] as Array<[number, number, number, number]>) k.bx(xa, xb, F + fin.dado, 0.04, za, zb, M.darkOak());
  }
  for (let z = z0 + 1.0; z < z1 - 0.3; z += 1.4) k.bx(x0, x1, F + H - 0.18, 0.18, z - 0.08, z + 0.08, M.darkOak(), false, 1.2);
  // a straight cornice where every wall meets the ceiling
  cornice(k, x0, x1, z0, z1, F + H, M.darkOak());

  // the trade
  const seats = DRESS[opts.trade](c) ?? [];
  if (opts.trade !== "baker") {
    // the stove in the back corner on the far side, its pipe to the ceiling (not at the baker's: the oven)
    const sx = XF(0.55);
    const sz = z1 - 0.5;
    if (!b.boxes.some((q) => sx > q.minX - 0.4 && sx < q.maxX + 0.4 && sz > q.minZ - 0.4 && sz < q.maxZ + 0.4)) k.stove(sx, sz, F, F + H);
  }
  backDoor(c, (X(0.9) + XF(0.9)) / 2 + (opts.trade === "baker" ? (X(0) - XF(0)) * 0.3 : 0));
  if (fin.pic) k.wallPic(XF(0.02), F + 1.8, z0 + 0.9 + 0.4, 0.45, 0.68, ns > 0 ? Math.PI / 2 : -Math.PI / 2, fin.pic());
  else k.wallPic(XF(0.02), F + 1.9, z1 - 0.9, 0.5, 0.38, ns > 0 ? Math.PI / 2 : -Math.PI / 2, M.basic(`sh_paint_${opts.seed % 3}`, () => paintingTex((["ship", "land", "saint"] as const)[opts.seed % 3], opts.seed)), M.darkOak());
  // the name inside over the counter's wall
  const sign = M.basic(`sh_inname_${opts.trade}`, () => boardTex([SHOP_LOOK[opts.trade].sign.split("|")[0]], "#1a1410", "#c8b070", 384, 48));
  if (!c.nearHoles.some(([a2, b2]) => b2 > zc0 && a2 < zc1)) k.wallPic(X(0.02), F + H - 0.3, (zc0 + zc1) / 2, Math.min(1.8, zc1 - zc0), 0.22, ns > 0 ? -Math.PI / 2 : Math.PI / 2, sign);
  // the lamps: over the counter and over the floor
  k.lamp(X(1.1), F + 2.35, zc0 + (zc1 - zc0) * 0.3, F + H, fin.lamp, c.lights, c.glows, 7);
  k.lamp((X(2.0) + XF(0.8)) / 2, F + 2.35, z0 + (z1 - z0) * 0.62, F + H, fin.lamp, c.lights, c.glows, 7);
  const hemi = new THREE.HemisphereLight(0x9a8a70, 0x2a2018, 1.6);
  const amb = new THREE.AmbientLight(0x5a4a38, 0.9);
  scene.add(hemi, amb);

  // where the keeper stands, his wife, the customers; Jef stays out from behind the counter
  const keeper: Spot = { x: X(0.42), z: c.zcm, yaw: c.toFar };
  const serve: Spot[] = [{ x: X(0.42), z: zc0 + 0.35, yaw: c.toFar }];
  const stands = customerStands(c);
  if (opts.trade === "barber") keeper.x = XF(1.6);
  const jefOnly = opts.trade === "barber" ? [] : [{ minX: span(X(0.74), nearW)[0], maxX: span(X(0.74), nearW)[1], minZ: zc0 - 0.1, maxZ: z1 }];
  const solids = rectsOf(b.boxes);
  mergeStatic(stat, group);
  let litK = 1;
  const lampPts = c.lights.map((l) => ({ l, p: new THREE.Vector3() }));
  const room: Room = {
    kind: "shop",
    scene,
    group,
    walk: (fx0, fz0) => [fx0, fz0],
    seats,
    stands,
    serve,
    keeper,
    counter: opts.trade === "barber" ? { x: X(1.9), z: zc0 + 0.45, yaw: c.toNear } : { x: X(1.9), z: c.zcm, yaw: c.toNear },
    exit: { x: 0, z: z0 + 0.3, yaw: Math.PI },
    entry: { x: 0, z: z0 + 0.8, yaw: 0 },
    lamps: [],
    toWorld,
    toLocal,
    floor: () => F,
    solids,
    level: 0,
    jefOnly,
    sound: "shop",
    setAmbient: ambientOf(hemi, amb),
    setLamps(v) {
      litK = v;
    },
    setDaylight() {},
    update(t) {
      c.lights.forEach((l, i) => {
        const f = flicker(t, i * 5.1) * litK;
        l.intensity = 7 * f;
        c.glows[i].material.opacity = 0.5 * f;
      });
      for (const f of c.fires) f.l.intensity = f.w * flicker(t * 1.7, 3) * (0.3 + 0.7 * litK);
      room.lamps = lampPts.map(({ l, p: v }, i) => ({ p: l.getWorldPosition(v), w: 0.4 * flicker(t, i * 5.1) * litK }));
    },
  };
  room.update(0, 0);
  return room;
}
