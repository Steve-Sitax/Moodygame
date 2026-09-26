import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import * as PP from "../../../shared/prisonPlan";
import { billTex, Flames, Kit, lmBasic, lmMat, matOf, type MatDef } from "./landmarkKit";
import { glassMat, M, walkGraph, type LandmarkRoom } from "./landmarkRooms";
import { canvasTex, flicker, frameRoom, rand } from "./rooms";
import { panel, planarUV } from "./carolusHall";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import { withPicture } from "./quayStone";
import { makeHuman, type Human, type HumanKind } from "../game/humans";
import type { World } from "./rijnkaai";
import type { InWorld } from "./inworld";

// The prison inside (M7 prison and squares, docs/milestones/M7-prison-squares.md): the rooms stand in the world
// inside the Blender shell (tools/blender/build_prison.py) and are walked by the plan (shared/prisonPlan.ts), the
// halls' way (world/hallInWorld.ts). The gate passage under the tower with its barrel vault and the inner grille;
// the guard room (the table with the book and the lamp, the stove, the bunk, the keys, the rifles); the visitors'
// room with its double grille and the warder's gangway between; the link to the watch pavilion (the chief warder's
// desk on its platform in the middle, iron galleries round it, the lantern's light from above); wing A's corridor
// with three storeys of cell doors along iron galleries under a whitewashed vault with its roof light, the iron
// stair at the far end, two cells standing open (the folding bed, the table and stool, the shelf, the bucket, the
// high barred window, a man at his oakum in one); wing B through its shut grille; the door out to the yard.
//
// Pictures: the whitewashed walls take the town's limewashed brick, the floors and door frames its bluestone
// (assets/ATTRIBUTION.md); the rest is painted here. The life: the warders by their shifts, the men in the ring at
// the hours of exercise, a man brought to the grille in visiting hours: all the server's (server/src/town/prison.ts).

const PIC = (url: string, fallback: THREE.Texture): THREE.Texture => {
  fallback.minFilter = THREE.LinearMipmapLinearFilter;
  fallback.magFilter = THREE.NearestFilter;
  fallback.generateMipmaps = true;
  fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
  return withPicture(fallback, url);
};
const flat = (c: string) =>
  canvasTex(8, 8, (g) => {
    g.fillStyle = c;
    g.fillRect(0, 0, 8, 8);
  });

/** Painted stand-in and dado: grey-green oil paint to shoulder height, as in every cellular prison. */
const C = {
  wash: lmMat("pr_in_wash", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#cfc8b8")), color: 0xcfc9bb }, 0.05),
  dado: lmMat("pr_in_dado", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#4a5448")), color: 0x4c5646, side: THREE.DoubleSide }, 0.05),
  vault: lmMat("pr_in_vault", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#d0cabc")), color: 0xd6d0c2, side: THREE.DoubleSide }, 0.03),
  flags: lmMat("pr_in_flags", { map: PIC("/textures/wall_ashlar_blue.jpg", flat("#5a5e60")), color: 0x9ea2a4 }, 0.05),
  blue: lmMat("pr_in_blue", { map: PIC("/textures/carolus_bluestone.jpg", flat("#6a6e70")), color: 0x9a9c9e }, 0.05),
  oak: lmMat("pr_in_oak", { map: PIC("/textures/carolus_oak.jpg", flat("#3a2618")), color: 0x7a6858 }, 0.1),
  door: lmMat("pr_in_door", { map: PIC("/textures/carolus_oak.jpg", flat("#3a2618")), color: 0x9a8470 }, 0.1),
  plank: M.oak,
  iron: M.iron,
  ironPaint: lmMat("pr_in_iron_paint", { color: 0x2a3228 }, 0),
  straw: lmMat("pr_in_straw", { color: 0x9a8a58 }, 0.1),
  blanket: lmMat("pr_in_blanket", { color: 0x5a5448 }, 0.1),
  linen: M.linen,
  tin: M.tin,
  brass: M.brass,
  black: M.black,
  paper: lmMat("pr_in_paper", { color: 0xd8d0b8 }, 0),
  bill: lmMat("pr_in_rules", { map: billTex(1855) }, 0),
  ledger: lmMat("pr_in_ledger", { color: 0x5a2a1a }, 0),
  dark: lmMat("pr_in_dark", { color: 0x0e0d0c }, 0),
  glow: lmBasic("pr_in_skylight", { color: 0xb8bcb8, fog: false }),
  lamp: lmBasic("pr_in_lamp", { color: 0xffc070 }),
};
const WIN = glassMat("grisaille", 73);

type P2 = [number, number];

/** A barrel vault along z (x middle, radius r, springing y) from z0 to z1, seen from below; or along x (axis "x"). */
function barrel(k: Kit, def: MatDef, c: number, spring: number, r: number, a0: number, a1: number, axis: "x" | "z" = "z", n = 10): void {
  const pos: number[] = [];
  const uv: number[] = [];
  const L = a1 - a0;
  const segs = Math.max(1, Math.ceil(L / 3));
  for (let s = 0; s < segs; s++) {
    const za = a0 + (L * s) / segs;
    const zb = a0 + (L * (s + 1)) / segs;
    for (let i = 0; i < n; i++) {
      const t0 = (Math.PI * i) / n;
      const t1 = (Math.PI * (i + 1)) / n;
      const p = (t: number, z: number): [number, number, number] => {
        const u = c + r * Math.cos(t);
        const y = spring + r * Math.sin(t);
        return axis === "z" ? [u, y, z] : [z, y, u];
      };
      const quad = [p(t0, za), p(t1, zb), p(t1, za), p(t0, za), p(t0, zb), p(t1, zb)];
      const us = [t0, t1, t1, t0, t0, t1];
      const vs = [za, zb, za, za, zb, zb];
      quad.forEach((q, j) => {
        pos.push(...q);
        uv.push((us[j] * r) / 2.4, vs[j] / 2.4);
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  k.add(g, def, 0, 0, 0, { flat: true });
}

/** A wall (panel) with a shoulder-high dado, from a to c (local x, z) facing the room on its left, `t` thick. */
function wall(k: Kit, a: P2, c: P2, y1: number, openings: Array<{ u0: number; u1: number; y0: number; spring: number; round?: boolean }> = [], windows: Array<{ u0: number; u1: number; y0: number; spring: number; round?: boolean }> = [], t = 0.3, dadoH = 1.4): void {
  panel(k, C.wash, a, c, 0, y1, t, openings, windows, 2.0);
  // the dado: a thin skin over the wall's lower part on the room's side
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const tx = (c[0] - a[0]) / L;
  const tz = (c[1] - a[1]) / L;
  // (the room lies to the left of a -> c: normal (-tz, tx)) pull the dado 2 cm into the room
  const nx = -tz;
  const nz = tx;
  const off = t / 2 + 0.02;
  // the dado in pieces between the openings that reach down through it (on both faces: the painted skin is
  // double-sided and 2 cm off the wall each side)
  const cuts = openings.filter((o) => o.y0 < dadoH).map((o) => [o.u0, o.u1] as P2).sort((p, q) => p[0] - q[0]);
  const pieces: P2[] = [];
  let u = 0;
  for (const [u0, u1] of cuts) {
    if (u0 > u + 0.02) pieces.push([u, u0]);
    u = Math.max(u, u1);
  }
  if (L > u + 0.02) pieces.push([u, L]);
  const ry = Math.atan2(tx, tz) + Math.PI / 2;
  for (const sgn of [1, -1])
    for (const [p0, p1] of pieces) {
      const um = (p0 + p1) / 2;
      k.box(p1 - p0, dadoH, 0.01, a[0] + tx * um + sgn * nx * off, dadoH / 2, a[1] + tz * um + sgn * nz * off, C.dado, { ry, tile: 1.6 });
    }
}

/** An iron grille: bars every `step` from a to c (local x, z), from y0 to y1, rails at the given heights. */
function grille(k: Kit, a: P2, c: P2, y0: number, y1: number, step = 0.12, rails: number[] = [], def: MatDef = C.iron): void {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const tx = (c[0] - a[0]) / L;
  const tz = (c[1] - a[1]) / L;
  const ry = Math.atan2(tx, tz) + Math.PI / 2;
  for (let s = step / 2; s < L; s += step) k.box(0.025, y1 - y0, 0.025, a[0] + tx * s, (y0 + y1) / 2, a[1] + tz * s, def);
  for (const y of [y0 + 0.05, y1 - 0.05, ...rails]) k.box(L, 0.05, 0.035, (a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2, def, { ry });
}

/** A cell door in a wall along x (its face at z, the corridor to `side`): stone frame, oak leaf with straps, judas, hatch. */
function cellDoor(k: Kit, x: number, z: number, y: number, side: 1 | -1, open = false): void {
  const w = 0.8;
  const h = 1.9;
  // the bluestone frame, proud of the whitewash
  const f = z + side * 0.04;
  k.box(0.14, h + 0.14, 0.08, x - w / 2 - 0.07, y + (h + 0.14) / 2, f, C.blue);
  k.box(0.14, h + 0.14, 0.08, x + w / 2 + 0.07, y + (h + 0.14) / 2, f, C.blue);
  k.box(w + 0.28, 0.16, 0.1, x, y + h + 0.08, f, C.blue);
  if (open) {
    // swung out into the corridor, hinged at the right jamb
    const hx = x + w / 2;
    const hz = z + side * 0.06;
    const ang = 1.25;
    const cx = hx - Math.cos(ang) * w * 0.5;
    const cz = hz + side * Math.sin(ang) * w * 0.5;
    k.box(w, h, 0.07, cx, y + h / 2, cz, C.door, { ry: side * ang });
    k.box(0.05, 0.05, 0.12, hx - 0.02, y + 1.0, hz + side * 0.05, C.iron);
    return;
  }
  const d = z + side * 0.02;
  k.box(w, h, 0.05, x, y + h / 2, d, C.door, { tile: 1.2 });
  for (const yy of [0.25, 0.95, 1.65]) k.box(w * 0.92, 0.06, 0.02, x, y + yy, d + side * 0.035, C.iron);
  k.box(0.26, 0.2, 0.02, x, y + 1.05, d + side * 0.04, C.iron); // the food hatch
  k.cyl(0.035, 0.035, 0.02, x, y + 1.52, d + side * 0.045, C.dark, { seg: 6, rx: Math.PI / 2 }); // the judas
  k.box(0.2, 0.05, 0.05, x + w / 2 - 0.12, y + 1.0, d + side * 0.05, C.iron); // the bolt
  k.cyl(0.07, 0.07, 0.01, x, y + 1.8, d + side * 0.045, C.paper, { seg: 8, rx: Math.PI / 2 }); // the number plate
}

/** A cell's inside: whitewashed, the high barred window, the folding bed, the table and stool, shelf, bucket, tap. */
function cellInside(k: Kit, x: number, zDoor: number, zBack: number, flames: Flames, occupied: boolean): void {
  const hw = PP.CELL_HW;
  const into = Math.sign(zBack - zDoor); // from the door into the cell
  const z0 = Math.min(zDoor, zBack);
  const z1 = Math.max(zDoor, zBack);
  // side walls (the cell partitions) and the back wall with its window
  wall(k, [x - hw, zBack], [x - hw, zDoor], 3.4, [], [], 0.3, 1.1);
  wall(k, [x + hw, zDoor], [x + hw, zBack], 3.4, [], [], 0.3, 1.1);
  k.box(2 * hw, 3.4, 0.05, x, 1.7, zBack - into * 0.01, C.wash, { tile: 2 });
  k.box(0.62, 1.05, 0.06, x, 2.3 + 0.52, zBack - into * 0.03, WIN.def);
  for (const dx of [-0.2, 0, 0.2]) k.box(0.03, 1.05, 0.03, x + dx, 2.82, zBack - into * 0.06, C.iron);
  k.box(0.7, 0.08, 0.3, x, 2.26, zBack - into * 0.15, C.blue); // the sill, splayed
  k.box(2 * hw, 0.05, z1 - z0, x, 3.4, (z0 + z1) / 2, C.vault, { tile: 2 }); // the ceiling
  k.box(2 * hw, 0.04, z1 - z0, x, 0.02, (z0 + z1) / 2, C.flags, { tile: 1.2 });
  // the folding bed down, along the left wall: iron frame, straw mattress, grey blanket, a rolled coat for a pillow
  const bx = x - hw + 0.42;
  const bz0 = zDoor + into * 0.6;
  const bz1 = zBack - into * 0.05;
  const bl = Math.abs(bz1 - bz0);
  const bzc = (bz0 + bz1) / 2;
  k.box(0.72, 0.05, bl, bx, 0.45, bzc, C.iron);
  for (const s of [-1, 1]) k.box(0.04, 0.45, 0.04, bx + s * 0.33, 0.22, bz0 + into * 0.05, C.iron);
  k.box(0.66, 0.1, bl - 0.08, bx, 0.53, bzc, C.straw, { tile: 0.8 });
  k.box(0.68, 0.04, bl * 0.6, bx, 0.6, bzc - into * bl * 0.15, C.blanket);
  k.cyl(0.1, 0.1, 0.55, bx, 0.62, bz1 - into * 0.25, C.blanket, { rz: Math.PI / 2, seg: 6 });
  // the hinged table on the right wall, the stool, the shelf with the Bible, a tin plate and mug
  const tx = x + hw - 0.35;
  const tz = zBack - into * 0.35;
  k.box(0.55, 0.04, 0.6, tx, 0.78, tz, C.plank);
  k.box(0.04, 0.76, 0.04, tx - 0.2, 0.38, tz, C.iron);
  k.box(0.32, 0.04, 0.32, tx - 0.3, 0.45, tz - into * 0.6, C.plank);
  for (const [dx, dz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) k.box(0.03, 0.44, 0.03, tx - 0.3 + dx, 0.22, tz - into * 0.6 + dz, C.plank);
  k.box(0.6, 0.03, 0.2, x + hw - 0.32, 1.9, zBack - into * 0.12, C.plank);
  k.box(0.14, 0.2, 0.05, x + hw - 0.45, 2.0, zBack - into * 0.14, C.ledger);
  k.cyl(0.05, 0.04, 0.09, x + hw - 0.22, 1.95, zBack - into * 0.14, C.tin, { seg: 6 });
  k.cyl(0.11, 0.11, 0.015, tx + 0.1, 0.81, tz, C.tin, { seg: 8 });
  // the bucket with its lid in the corner by the door, the water tap, the cell rules on a board
  k.cyl(0.16, 0.13, 0.36, x + hw - 0.25, 0, zDoor + into * 0.35, C.oak, { seg: 8 });
  k.cyl(0.17, 0.17, 0.03, x + hw - 0.25, 0.36, zDoor + into * 0.35, C.oak, { seg: 8 });
  k.box(0.04, 0.2, 0.04, x + hw - 0.05, 1.1, zDoor + into * 0.9, C.brass);
  k.box(0.02, 0.42, 0.3, x - hw + 0.02, 1.55, zDoor + into * 0.5, C.bill);
  // a gas jet over the door (lit at dusk)
  k.box(0.04, 0.04, 0.2, x, 2.4, zDoor + into * 0.12, C.brass);
  flames.addFlame(x, 2.48, zDoor + into * 0.22);
  // a heap of oakum and tarred rope on the floor: his day's work
  if (occupied) {
    k.box(0.5, 0.12, 0.4, x + 0.15, 0.06, bzc, C.straw, { tile: 0.5, tint: 0.7 });
    k.cyl(0.18, 0.2, 0.14, x + 0.55, 0, bzc + into * 0.4, C.oak, { seg: 8, tint: 0.6 });
  }
}

/** A cell wing's inside (sign 1: wing A, walked; -1: wing B, seen through its grille). */
function wingInside(k: Kit, sg: 1 | -1, flames: Flames, openCells: boolean): void {
  const W = PP.IN.wing;
  const xa = PP.IN.pavR;
  const xb = W.x1;
  const X = (x: number) => sg * x;
  const seg = (a: number, b: number): [P2, P2] => (sg > 0 ? [[a, 0], [b, 0]] : [[-b, 0], [-a, 0]]);
  void seg;
  const vaultTop = PP.IN.vaultSpring;
  // the cell fronts of both rows, full height to the vault, with a door on each storey
  const levels = [0, ...PP.IN.galleries];
  for (const row of ["S", "N"] as const) {
    const zf = row === "S" ? W.corrS : W.corrN; // the fronts' face on the corridor
    const side: 1 | -1 = row === "S" ? 1 : -1; // the corridor lies to +z of the south row
    const ops: Array<{ u0: number; u1: number; y0: number; spring: number; round?: boolean }> = [];
    const wins: Array<{ u0: number; u1: number; y0: number; spring: number; round?: boolean }> = [];
    for (const cx of PP.CELLS) {
      for (const y of levels) {
        const isYard = sg > 0 && row === "S" && y === 0 && Math.abs(cx - PP.YARD_DOOR.x) < 0.2;
        const hw = isYard ? PP.YARD_DOOR.hw : 0.4;
        const u = cx - xa;
        if (y === 0) ops.push({ u0: u - hw, u1: u + hw, y0: 0, spring: isYard ? PP.YARD_DOOR.spring : 1.9, round: isYard });
        else wins.push({ u0: u - 0.4, u1: u + 0.4, y0: y, spring: y + 1.9 });
      }
    }
    // the wall runs along x at z = zf ± 0.15 (0.3 thick); a -> c with the corridor on its left
    const zc = zf - side * 0.15;
    const a: P2 = side > 0 ? [X(xb), zc] : [X(xa), zc];
    const c: P2 = side > 0 ? [X(xa), zc] : [X(xb), zc];
    // (panel's u runs from a; for wing A's south row a is the far end, so mirror the openings' u)
    const L = xb - xa;
    const flip = (o: { u0: number; u1: number; y0: number; spring: number; round?: boolean }) => ({ ...o, u0: L - o.u1, u1: L - o.u0 });
    // (a is the far end on the south row: its u runs from the far end, so the openings' u are mirrored)
    const mirror = side > 0;
    wall(k, a, c, vaultTop, mirror ? ops.map(flip) : ops, mirror ? wins.map(flip) : wins, 0.3, 1.4);
    // the doors
    for (const cx of PP.CELLS) {
      for (const y of levels) {
        const isYard = sg > 0 && row === "S" && y === 0 && Math.abs(cx - PP.YARD_DOOR.x) < 0.2;
        if (isYard) continue;
        const isOpen = openCells && y === 0 && PP.OPEN_CELLS.some((o) => o.row === row && Math.abs(o.x - cx) < 0.2);
        cellDoor(k, X(cx), zf, y, side, isOpen);
      }
    }
  }
  // the floor, the galleries with their brackets and railings, the bridges across, the stair at the far end
  k.box(xb - xa, 0.05, W.corrN - W.corrS, X((xa + xb) / 2), -0.02, (W.corrS + W.corrN) / 2, C.flags, { tile: 1.6 });
  const gw = PP.IN.galleryW;
  for (const y of PP.IN.galleries) {
    for (const [z0, z1, edge] of [[W.corrS, W.corrS + gw, W.corrS + gw], [W.corrN - gw, W.corrN, W.corrN - gw]] as Array<[number, number, number]>) {
      k.box(xb - xa, 0.06, z1 - z0, X((xa + xb) / 2), y - 0.03, (z0 + z1) / 2, C.plank, { tile: 1.2 });
      k.box(xb - xa, 0.14, 0.05, X((xa + xb) / 2), y - 0.12, edge, C.ironPaint);
      // the railing: posts, a top rail, a mid rail
      k.box(xb - xa, 0.04, 0.04, X((xa + xb) / 2), y + 1.0, edge, C.ironPaint);
      k.box(xb - xa, 0.03, 0.03, X((xa + xb) / 2), y + 0.5, edge, C.ironPaint);
      for (let x = xa + 0.2; x < xb; x += 1.4) {
        k.box(0.04, 1.0, 0.04, X(x), y + 0.5, edge, C.ironPaint);
        // a bracket under the gallery: a diagonal iron strut into the cell front
        const zw = edge < (W.corrS + W.corrN) / 2 ? W.corrS : W.corrN;
        const dz = edge - zw;
        k.box(0.04, 0.04, Math.hypot(dz, 0.7), X(x), y - 0.45, (edge + zw) / 2, C.ironPaint, { rx: Math.atan2(0.7, Math.abs(dz)) * Math.sign(dz) });
      }
    }
    // two bridges across the void
    for (const bxw of [xa + 7.0, xa + 15.4]) {
      k.box(1.0, 0.06, W.corrN - W.corrS - 2 * gw, X(bxw), y - 0.03, (W.corrS + W.corrN) / 2, C.plank, { tile: 1.2 });
      for (const s of [-0.5, 0.5]) k.box(0.04, 0.04, W.corrN - W.corrS - 2 * gw, X(bxw + s), y + 1.0, (W.corrS + W.corrN) / 2, C.ironPaint);
    }
  }
  // the iron stair at the far end: two flights along x on the north side (ground to the first gallery, then up)
  for (const [y0, y1, x0, x1] of [[0, PP.IN.galleries[0], 24.2, W.x1], [PP.IN.galleries[0], PP.IN.galleries[1], 24.2, W.x1]] as Array<[number, number, number, number]>) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const xx = y0 === 0 ? x1 - (x1 - x0) * t : x0 + (x1 - x0) * t;
      k.box((x1 - x0) / n + 0.02, 0.04, 0.9, X(xx), y0 + (y1 - y0) * t, W.corrN - 0.5, C.ironPaint);
    }
    k.box(Math.hypot(x1 - x0, y1 - y0), 0.04, 0.04, X((x0 + x1) / 2), (y0 + y1) / 2 + 0.9, W.corrN - 1.0, C.ironPaint, { rz: (y0 === 0 ? 1 : -1) * sg * Math.atan2(y1 - y0, x1 - x0) });
  }
  // the far end wall with its tall barred window and the gallery walkway across it
  const ex = X(xb);
  k.box(0.3, vaultTop + 2, W.corrN - W.corrS, ex + sg * 0.15, (vaultTop + 2) / 2, (W.corrS + W.corrN) / 2, C.wash, { tile: 2 });
  k.box(0.05, 3.2, 1.1, ex - sg * 0.02, 5.4, (W.corrS + W.corrN) / 2, WIN.def);
  for (const dz of [-0.35, 0, 0.35]) k.box(0.04, 3.2, 0.04, ex - sg * 0.05, 5.4, (W.corrS + W.corrN) / 2 + dz, C.iron);
  // the vault over the corridor: whitewashed, the roof light along its crown
  const half = (W.corrN - W.corrS) / 2;
  const zm = (W.corrS + W.corrN) / 2;
  barrel(k, C.vault, zm, vaultTop, half, X(xa), X(xb), "x");
  k.box(xb - xa, 0.03, 0.7, X((xa + xb) / 2), vaultTop + half - 0.02, zm, C.glow);
  for (let x = xa + 0.7; x < xb; x += 1.4) k.box(0.05, 0.05, 0.75, X(x), vaultTop + half - 0.05, zm, C.iron);
  // gas brackets along the ground floor fronts, lit at dusk
  for (const x of [9.0, 16.5, 23.5]) {
    k.box(0.04, 0.04, 0.3, X(x), 2.3, W.corrS + 0.15, C.brass);
    flames.addFlame(X(x), 2.38, W.corrS + 0.3);
  }
  // the open cells
  if (openCells) {
    cellInside(k, 10.2, W.corrN + 0.3, W.z1, flames, false);
    cellInside(k, 18.6, W.corrS - 0.3, W.z0, flames, true);
    // the yard door's passage through the south row: whitewashed sides, a low vault
    const yd = PP.YARD_DOOR;
    for (const s of [-1, 1]) k.box(0.3, 2.5, W.corrS - yd.z - 0.6, yd.x + s * (yd.hw + 0.15), 1.25, (yd.z + 0.6 + W.corrS) / 2, C.wash, { tile: 2 });
    barrel(k, C.vault, yd.x, yd.spring, yd.hw, yd.z + 0.6, W.corrS, "z", 6);
  }
}

/** The prison's rooms, built from the plan at the shell's place (the group in the world by the plan's frame). */
export function buildPrisonHall(): LandmarkRoom {
  const P = PP.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x22241f);
  scene.background = null;
  group.position.y = PP.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 14;
  fog.far = 70;
  const k = new Kit(group);
  k.shadeTop = 10;
  const r = rand(1855);
  const flames = new Flames(group, 80, 0.12);
  const I = PP.IN;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.0, tint?: number) =>
    k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile, tint });

  // ---- the gate passage under the tower: bluestone walls to the springing, a barrel vault, the flags
  const ph = I.passHW;
  const sp = PP.PARTS.gate.spring;
  box(-ph, ph, -0.05, 0.0, I.gateFace, I.passEnd, C.flags, 1.6);
  // west wall (the guard room's door) and east wall (the visitors' door), blue stone below, washed above
  panel(k, C.blue, [-ph - 0.15, I.passEnd], [-ph - 0.15, I.gateInner], 0, sp, 0.3, [{ u0: I.passEnd - 6.4, u1: I.passEnd - 4.8, y0: 0, spring: 2.4 }], [{ u0: I.passEnd - 3.4, u1: I.passEnd - 2.6, y0: 1.4, spring: 1.9 }], 1.6);
  panel(k, C.blue, [ph + 0.15, I.gateInner], [ph + 0.15, I.passEnd], 0, sp, 0.3, [{ u0: 0.8 - I.gateInner, u1: 2.4 - I.gateInner, y0: 0, spring: 2.4 }], [], 1.6);
  barrel(k, C.vault, 0, sp, ph, I.gateInner, I.passEnd, "z", 12);
  // the porter's hatch into the guard room (a small barred opening), a bench, the notice of the hours, the bell pull
  grille(k, [-ph + 0.02, I.passEnd - 3.4], [-ph + 0.02, I.passEnd - 2.6], 1.4, 1.9, 0.1);
  box(ph - 0.45, ph - 0.05, 0.42, 0.48, 5.0, 7.4, C.plank, 1.2);
  for (const z of [5.2, 7.2]) box(ph - 0.4, ph - 0.1, 0, 0.42, z - 0.05, z + 0.05, C.plank);
  k.box(0.02, 0.6, 0.45, ph - 0.03, 1.7, 3.4, C.bill, { ry: 0 });
  k.box(0.02, 0.02, 1.2, -ph + 0.05, 2.6, 0.9, C.iron);
  k.cyl(0.03, 0.03, 0.9, -ph + 0.06, 1.9, 0.9, C.iron, { seg: 4 });
  // the lantern hanging from the crown
  k.cyl(0.01, 0.01, 0.5, 0, sp + ph - 0.5, 4.6, C.iron, { seg: 4 });
  k.box(0.22, 0.3, 0.22, 0, sp + ph - 0.7, 4.6, C.lamp);
  k.box(0.26, 0.04, 0.26, 0, sp + ph - 0.53, 4.6, C.iron);
  // the inner grille at the passage's end: two leaves standing open against the walls, the arch's fixed head
  grille(k, [-ph, I.passEnd], [-ph + 0.15, I.passEnd - 1.6], 0, 2.9, 0.13, [1.0, 2.0]);
  grille(k, [ph, I.passEnd], [ph - 0.15, I.passEnd - 1.6], 0, 2.9, 0.13, [1.0, 2.0]);
  grille(k, [-ph, I.passEnd - 0.05], [ph, I.passEnd - 0.05], 2.95, sp + ph - 0.1, 0.13, []);

  // ---- the guard room
  const F = I.front;
  const gx0 = F.x0;
  const gx1 = -I.passWall;
  const gy = 4.0;
  box(gx0, gx1, -0.05, 0.0, F.z0, F.z1, C.flags, 1.6);
  // front wall (the street) with its two barred windows, the end wall, the back wall, the passage wall (with the door)
  // the front wall (the street) with its two barred windows (the shell's, x -5.52 and -7.28; panel's u runs from gx1)
  wall(k, [gx1, F.z0], [gx0, F.z0], gy, [], [
    { u0: gx1 - -5.52 - 0.35, u1: gx1 - -5.52 + 0.35, y0: 1.9, spring: 2.75, round: true },
    { u0: gx1 - -7.28 - 0.35, u1: gx1 - -7.28 + 0.35, y0: 1.9, spring: 2.75, round: true },
  ]);
  for (const xw of [-5.52, -7.28]) {
    k.box(0.7, 1.2, 0.04, xw, 2.45, F.z0 - 0.1, WIN.def);
    for (const dx of [-0.2, 0, 0.2]) k.box(0.03, 1.2, 0.03, xw + dx, 2.45, F.z0 - 0.05, C.iron);
  }
  wall(k, [gx0, F.z0], [gx0, F.z1], gy);
  wall(k, [gx0, F.z1], [gx1, F.z1], gy);
  // (the passage side: its wall is the passage's, 0.3 m; this face on the room's side)
  box(gx0, gx1, gy, gy + 0.08, F.z0, F.z1, C.vault, 2.0);
  for (let x = gx0 + 1.1; x < gx1; x += 1.8) box(x - 0.1, x + 0.1, gy - 0.22, gy, F.z0, F.z1, C.oak, 1.2);
  // the table, its book, the lamp and the ink; chairs; the stove with its pipe; the bunk; the cupboard; rifles; keys
  box(-8.3, -6.1, 0.76, 0.8, 3.2, 4.3, C.plank, 1.2);
  for (const [x, z] of [[-8.2, 3.3], [-6.2, 3.3], [-8.2, 4.2], [-6.2, 4.2]]) box(x - 0.03, x + 0.03, 0, 0.76, z - 0.03, z + 0.03, C.plank);
  box(-7.6, -7.1, 0.8, 0.86, 3.5, 3.9, C.ledger);
  box(-7.58, -7.12, 0.86, 0.87, 3.52, 3.88, C.paper);
  k.cyl(0.05, 0.07, 0.18, -6.6, 0.8, 3.7, C.brass, { seg: 6 });
  k.box(0.12, 0.14, 0.12, -6.6, 1.05, 3.7, C.lamp);
  k.cyl(0.03, 0.03, 0.05, -7.0, 0.8, 4.05, C.black, { seg: 6 });
  for (const [x, z, ry] of [[-7.2, 4.9, 0], [-7.8, 2.6, Math.PI], [-5.6, 3.75, -Math.PI / 2]] as Array<[number, number, number]>) {
    k.box(0.42, 0.04, 0.42, x, 0.45, z, C.plank, { ry });
    for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) k.box(0.03, 0.45, 0.03, x + dx, 0.22, z + dz, C.plank);
    k.box(0.42, 0.5, 0.03, x - Math.sin(ry) * 0.2, 0.75, z - Math.cos(ry) * 0.2, C.plank, { ry });
  }
  k.cyl(0.4, 0.42, 0.9, -10.95, 0, 7.2, C.iron, { seg: 8 });
  k.cyl(0.08, 0.08, gy - 0.9, -10.95, 0.9, 7.2, C.iron, { seg: 6 });
  k.box(0.16, 0.12, 0.02, -10.95, 0.45, 6.79, C.lamp);
  box(-11.4, -9.5, 0.4, 0.5, 0.6, 1.5, C.plank, 1.2);
  box(-11.35, -9.55, 0.5, 0.62, 0.65, 1.45, C.blanket);
  for (const x of [-11.35, -9.55]) box(x - 0.03, x + 0.03, 0, 0.4, 0.62, 1.48, C.plank);
  box(-4.1, -2.5, 0, 2.1, 0.6, 1.1, C.oak, 1.2);
  box(-11.4, -11.3, 0.8, 2.0, 3.0, 5.2, C.oak, 1.2);
  for (let z = 3.2; z < 5.1; z += 0.35) {
    k.cyl(0.02, 0.02, 1.3, -11.22, 0.75, z, C.iron, { seg: 4 });
    k.box(0.06, 0.3, 0.08, -11.22, 0.9, z, C.oak);
  }
  box(-2.42, -2.36, 1.4, 2.0, 2.4, 3.6, C.oak, 1.2);
  for (let i = 0; i < 9; i++) k.cyl(0.012, 0.012, 0.14, -2.45, 1.8 - (i % 3) * 0.18, 2.55 + Math.floor(i / 3) * 0.4, C.brass, { seg: 4 });
  k.cyl(0.22, 0.22, 0.06, -7.2, 2.9, F.z1 - 0.05, C.paper, { seg: 12, rx: Math.PI / 2 });
  for (const x of [-4.6, -4.2]) k.cyl(0.1, 0.1, 0.12, x, 1.65, F.z1 - 0.12, C.black, { seg: 8 });
  k.box(0.9, 0.05, 0.08, -4.4, 1.55, F.z1 - 0.06, C.oak);

  // ---- the visitors' room: the visitors' side, the double grille with the gangway, the prisoners' side
  const vx0 = I.passWall;
  const vx1 = F.x1;
  box(vx0, vx1, -0.05, 0.0, F.z0, F.z1, C.flags, 1.6);
  wall(k, [vx1, F.z0], [vx0, F.z0], gy, [], [
    { u0: vx1 - 5.52 - 0.35, u1: vx1 - 5.52 + 0.35, y0: 1.9, spring: 2.75, round: true },
    { u0: vx1 - 7.28 - 0.35, u1: vx1 - 7.28 + 0.35, y0: 1.9, spring: 2.75, round: true },
  ]);
  for (const xw of [5.52, 7.28]) {
    k.box(0.7, 1.2, 0.04, xw, 2.45, F.z0 - 0.1, WIN.def);
    for (const dx of [-0.2, 0, 0.2]) k.box(0.03, 1.2, 0.03, xw + dx, 2.45, F.z0 - 0.05, C.iron);
  }
  wall(k, [vx1, F.z1], [vx1, F.z0], gy);
  wall(k, [vx0, F.z1], [vx1, F.z1], gy, [{ u0: 6.8 - vx0 - 0.45, u1: 6.8 - vx0 + 0.45, y0: 0, spring: 2.0 }]);
  cellDoor(k, 6.8, F.z1, 0, -1, false);
  box(vx0, vx1, gy, gy + 0.08, F.z0, F.z1, C.vault, 2.0);
  for (const zg of [I.grille1, I.grille2]) {
    grille(k, [vx0, zg], [vx1, zg], 1.0, gy - 0.05, 0.11, [2.2]);
    // the wooden ledge and the panelled dado under each grille
    box(vx0, vx1, 0, 1.0, zg - 0.05, zg + 0.05, C.oak, 1.2);
    box(vx0, vx1, 1.0, 1.05, zg - 0.14, zg + 0.14, C.plank, 1.2);
  }
  // the warder's stool in the gangway, the benches, the lamp over the grille
  box(3.25, 3.55, 0.45, 0.5, 3.85, 4.15, C.plank);
  box(3.36, 3.44, 0, 0.45, 3.96, 4.04, C.plank);
  for (const [a, b] of [[3.6, 5.8], [8.0, 10.2]]) {
    box(a, b, 0.42, 0.48, 0.62, 0.98, C.plank, 1.2);
    for (const x of [a + 0.1, b - 0.1]) box(x - 0.03, x + 0.03, 0, 0.42, 0.65, 0.95, C.plank);
  }
  box(3.0, 10.6, 0.42, 0.48, 7.6, 8.0, C.plank, 1.2);
  k.cyl(0.01, 0.01, 0.6, 6.8, gy - 0.6, 4.0, C.iron, { seg: 4 });
  k.box(0.2, 0.26, 0.2, 6.8, gy - 0.75, 4.0, C.lamp);
  k.box(0.02, 0.6, 0.45, vx1 - 0.03, 1.8, 2.0, C.bill);

  // ---- the link: a flagged corridor, doors to the offices (shut), a flat ceiling with beams, a gas bracket
  const lh = I.linkHW;
  box(-lh, lh, -0.05, 0.0, I.passEnd, I.linkEnd, C.flags, 1.6);
  wall(k, [-lh, I.linkEnd], [-lh, I.passEnd], 3.6, [{ u0: 1.6, u1: 2.6, y0: 0, spring: 2.2 }]);
  wall(k, [lh, I.passEnd], [lh, I.linkEnd], 3.6, [{ u0: 2.0, u1: 3.0, y0: 0, spring: 2.2 }]);
  for (const [x, z, s] of [[-lh, I.linkEnd - 2.1, 1], [lh, I.passEnd + 2.5, -1]] as Array<[number, number, number]>) box(x - 0.03, x + 0.03, 0, 2.2, z - 0.5, z + 0.5, C.door, 1.2), void s;
  box(-lh, lh, 3.6, 3.66, I.passEnd, I.linkEnd, C.vault, 2.0);
  k.box(0.04, 0.04, 0.3, lh - 0.15, 2.3, 11.3, C.brass);
  flames.addFlame(lh - 0.3, 2.38, 11.3);

  // ---- the pavilion: an octagon three storeys high with galleries round, the chief warder's desk, the lantern
  const pz = I.pavZ;
  const pr = I.pavR / Math.cos(Math.PI / 8); // the inner circumradius
  const pH = 16.8;
  const corner = (i: number): P2 => [pr * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), pz + pr * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)];
  for (let i = 0; i < 8; i++) {
    const a = corner(i);
    const c = corner(i + 1);
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2 - pz;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    // wall faces the centre: the room on the left of c -> a
    const ops: Array<{ u0: number; u1: number; y0: number; spring: number; round?: boolean }> = [];
    const wins: Array<{ u0: number; u1: number; y0: number; spring: number; round?: boolean }> = [];
    if (Math.abs(mx) > 4 && Math.abs(mz) < 1) ops.push({ u0: L / 2 - 1.7, u1: L / 2 + 1.7, y0: 0, spring: I.vaultSpring, round: true }); // to a wing
    else if (mz < -4) ops.push({ u0: L / 2 - lh, u1: L / 2 + lh, y0: 0, spring: 3.6 }); // to the link
    else if (mz > 4) wins.push({ u0: L / 2 - 0.35, u1: L / 2 + 0.35, y0: 2.2, spring: 3.25, round: true }, { u0: L / 2 - 0.35, u1: L / 2 + 0.35, y0: 6.4, spring: 7.55, round: true });
    wins.push({ u0: L / 2 - 0.45, u1: L / 2 + 0.45, y0: 15.0, spring: 16.45, round: true });
    panel(k, C.wash, c, a, 0, pH, 0.3, ops, wins, 2.0);
    for (const w of wins) {
      const u = (w.u0 + w.u1) / 2;
      const t = u / L;
      const px = c[0] + (a[0] - c[0]) * t;
      const pzz = c[1] + (a[1] - c[1]) * t;
      const ry = Math.atan2(a[0] - c[0], a[1] - c[1]) + Math.PI / 2;
      const out = 0.18;
      const ox = (px / Math.hypot(px, pzz - pz)) * out;
      const oz = ((pzz - pz) / Math.hypot(px, pzz - pz)) * out;
      k.box(w.u1 - w.u0, w.spring - w.y0 + (w.round ? (w.u1 - w.u0) / 2 : 0), 0.04, px + ox, (w.y0 + w.spring) / 2 + 0.1, pzz + oz, WIN.def, { ry });
    }
    // the dado
    panel(k, C.dado, [c[0] * 0.995, pz + (c[1] - pz) * 0.995], [a[0] * 0.995, pz + (a[1] - pz) * 0.995], 0, 1.4, 0.02, ops.map((o) => ({ ...o, y0: 0, spring: 1.6, round: false })), [], 1.6);
  }
  // the floor, the galleries round (an octagonal ring with its railing), the ceiling with the lantern's light
  const oct = (rr: number, y: number, def: MatDef) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      if (i === 0) s.moveTo(rr * Math.cos(a), rr * Math.sin(a));
      else s.lineTo(rr * Math.cos(a), rr * Math.sin(a));
    }
    const g = new THREE.ShapeGeometry(s, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, pz);
    planarUV(g, 1.6);
    k.add(g, def, 0, 0, 0, { flat: true });
  };
  oct(pr, 0.002, C.flags);
  for (const y of I.galleries) {
    const ring = new THREE.Shape();
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      if (i === 0) ring.moveTo(pr * Math.cos(a), pr * Math.sin(a));
      else ring.lineTo(pr * Math.cos(a), pr * Math.sin(a));
    }
    const hole = new THREE.Path();
    const ri = pr - 1.0;
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      if (i === 0) hole.moveTo(ri * Math.cos(a), ri * Math.sin(a));
      else hole.lineTo(ri * Math.cos(a), ri * Math.sin(a));
    }
    ring.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, y - 0.08, pz);
    planarUV(g, 1.2);
    k.add(g, C.plank, 0, 0, 0, { flat: true });
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI / 8 + (i * Math.PI) / 4;
      const a1 = a0 + Math.PI / 4;
      const p0: P2 = [ri * Math.cos(a0), pz + ri * Math.sin(a0)];
      const p1: P2 = [ri * Math.cos(a1), pz + ri * Math.sin(a1)];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const ry = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) + Math.PI / 2;
      k.box(L, 0.04, 0.04, (p0[0] + p1[0]) / 2, y + 1.0, (p0[1] + p1[1]) / 2, C.ironPaint, { ry });
      k.box(L, 0.14, 0.05, (p0[0] + p1[0]) / 2, y - 0.14, (p0[1] + p1[1]) / 2, C.ironPaint, { ry });
      k.box(0.05, 1.0, 0.05, p0[0], y + 0.5, p0[1], C.ironPaint);
    }
  }
  oct(pr + 0.2, pH, C.vault);
  k.cyl(1.4, 1.4, 0.05, 0, pH - 0.06, pz, C.glow, { seg: 8 });
  // the platform and the chief warder's desk, his book, the bell; the big clock over the link's arch
  box(-1.3, 1.3, 0, 0.38, 18.0, 20.0, C.oak, 1.2);
  box(-1.0, 1.0, 0.38, 1.35, 18.2, 18.7, C.oak, 1.2);
  box(-1.05, 1.05, 1.35, 1.4, 18.1, 18.9, C.plank, 1.2);
  box(-0.4, 0.3, 1.4, 1.46, 18.3, 18.75, C.ledger);
  k.cyl(0.07, 0.09, 0.1, 0.7, 1.4, 18.5, C.brass, { seg: 8 });
  k.cyl(0.55, 0.55, 0.08, 0, 5.2, pz - I.pavR + 0.08, C.paper, { seg: 16, rx: Math.PI / 2 });
  k.cyl(0.6, 0.6, 0.06, 0, 5.2, pz - I.pavR + 0.05, C.oak, { seg: 16, rx: Math.PI / 2 });
  // wing A (walked) and wing B (seen through its grille)
  wingInside(k, 1, flames, true);
  wingInside(k, -1, flames, false);
  grille(k, [-I.pavR - 0.05, I.wing.corrS], [-I.pavR - 0.05, I.wing.corrN], 0, 4.4, 0.12, [1.1, 2.2, 3.3]);
  void r;
  k.finish();

  // ---- lights: daylight from the roof lights and windows, the lamps, the gas at dusk
  const hemi = new THREE.HemisphereLight(0xd0d4d0, 0x3a3a34, 1.0);
  const amb = new THREE.AmbientLight(0x4a4a44, 0.8);
  scene.add(hemi, amb);
  const pt = (c: number, x: number, y: number, z: number, d: number) => {
    const l = new THREE.PointLight(c, 0, d, 1.5);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  };
  const passL = pt(0xffb870, 0, 3.6, 4.6, 10);
  const guardL = pt(0xffb060, -6.6, 1.4, 3.7, 9);
  const visitL = pt(0xffb870, 6.8, 3.0, 4.0, 10);
  const pavL = pt(0xffc080, 0, 3.0, 18.5, 14);
  const wingL = pt(0xffc080, 16, 3.0, 19.5, 16);
  const dayFill = pt(0xd8dce0, 14, 9, 19.5, 40);
  const pavFill = pt(0xd8dce0, 0, 14, 19, 26);
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    hemi.intensity = (1.2 + 1.8 * d) * ambK;
    amb.intensity = (0.6 + 0.3 * day) * ambK;
    dayFill.intensity = 7 * d;
    pavFill.intensity = 6 * d;
    WIN.mat().color.setScalar(0.1 + 0.9 * day * sky);
    (matOf(C.glow) as THREE.MeshBasicMaterial).color.setScalar(0.12 + 0.75 * day * sky);
  };
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "prison" as unknown as LandmarkRoom["landmark"],
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : free(x, fz) ? [x, fz] : free(fx, z) ? [fx, z] : [fx, fz]),
    floor: (x, z) => HP.floorAt(P, x, z, 0),
    peopleFloor: () => 0,
    seats: [],
    stands: [],
    exit: { ...P.marks.door, yaw: Math.PI },
    entry: { ...P.marks.inside },
    entries: { main: { ...P.marks.inside } },
    exits: { main: { ...P.marks.door, yaw: Math.PI } },
    lamps: [],
    toWorld,
    pace: 1.3,
    eye: 1.6,
    surface: "stone",
    sound: "vault",
    marks: { ...P.marks },
    sets: {},
    looks: [],
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
      const dusk = day < 0.45;
      flames.update(t);
      flames.points.visible = dusk;
      passL.intensity = 2.4 * flicker(t, 1.1);
      guardL.intensity = 2.8 * flicker(t, 2.3);
      visitL.intensity = 2.2 * flicker(t, 3.1);
      pavL.intensity = (dusk ? 6 : 2) * flicker(t, 1.7);
      wingL.intensity = (dusk ? 7 : 1.5) * flicker(t, 2.9);
      room.lamps = [
        { p: toWorld(0, 4.5, 4.6), w: 0.18 * flicker(t, 1.1) },
        { p: toWorld(-6.6, 1.3, 3.7), w: 0.2 * flicker(t, 2.3) },
        { p: toWorld(6.8, 3.2, 4.0), w: 0.16 * flicker(t, 3.1) },
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

// ================================================================ the prison in the world

/** Where paths() checks the prison inside (local points; only while the gate stands open). */
export const PRISON_POINTS: HallInWorld["points"] = [
  { label: "the prison, inside the gate", x: 0, z: 1.6, reach: 1.2 },
  { label: "the prison, the guard room", x: -5.0, z: 6.4, reach: 1.0 },
  { label: "the prison, the visitors' grille", x: 6.8, z: 3.0, reach: 1.0 },
  { label: "the prison, the watch pavilion", x: 3.2, z: 19, reach: 1.2 },
  { label: "the prison, the cell corridor", x: 16.5, z: 19.5, reach: 1.2 },
  { label: "the prison, at an open cell's door", x: 10.2, z: 20.6, reach: 0.8 },
  { label: "the prison, at the other open cell's door", x: 18.6, z: 18.4, reach: 0.8 },
  { label: "the prison, the yard door", x: 13.0, z: 16.0, reach: 0.8 },
];
/** Where paths() checks the yard (local): by the ring, its benches. */
export const YARD_POINTS: HallInWorld["points"] = [
  { label: "the prison yard, by the ring", x: PP.PARTS.ring.x - PP.PARTS.ring.r_out - 1.0, z: PP.PARTS.ring.z, reach: 1.0 },
  { label: "the prison yard, a bench", x: 16.0, z: 1.8, reach: 0.8 },
];

export interface PrisonState {
  visiting: boolean;
  exercise: boolean;
  dayShift: boolean;
  warders: Array<{ role: string; name: string }>;
  inmates: Array<{ id: string; name: string; crime: string; since: number; until: number }>;
  ring: number;
}

export interface PrisonInWorld {
  hall: HallInWorld;
  readonly indoors: boolean;
  update(t: number, dt: number, day: number, hour: number, daylight: number, sky: number): void;
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }>;
  /** E: Jef at the grille, by a warder: what he may do there (null: nothing here). */
  action(x: number, z: number): { label: string; run(): void } | null;
  /** Dev: the state from the server, the figures drawn. */
  info(): unknown;
}

/**
 * The prison in the world: its hall (open in visiting hours; a warder shows Jef out at the end), the yard as a walk
 * area of its own beyond wing A's door, the warders at their posts by their shifts, the men walking the ring at the
 * hours of exercise, a man brought to the grille when Jef asks for a visit. All hours and people from the server.
 */
export function prisonInWorld(
  world: World,
  inWorld: InWorld,
  hooks: {
    roomSound(k: string | null): void;
    say(t: string): void;
    jef(): { x: number; z: number; place(x: number, z: number, yaw: number): void };
    talk(id: string, name: string): void;
  },
): PrisonInWorld {
  const room = buildPrisonHall();
  const hall = createHallInWorld(world, inWorld, PP.PLAN, room, { color: 0x22241f, near: 14, far: 70 }, PRISON_POINTS);
  // ---- the yard: a walk area of its own (the walk map has the whole compound as wall)
  const L = (x: number, z: number) => PP.toLocal(x, z);
  const inR = (rs: typeof PP.YARD, x: number, z: number, m = 0) => rs.some((q) => x > q.minX - m && x < q.maxX + m && z > q.minZ - m && z < q.maxZ + m);
  const yardHas = (x: number, z: number) => inR(PP.YARD, ...L(x, z));
  const ringers: Array<{ h: Human | null; a: number; kind: HumanKind }> = [];
  const yardHits = (x: number, z: number, r: number) => {
    const [lx, lz] = L(x, z);
    if (inR(PP.YARD_SOLIDS, lx, lz, r)) return true;
    return false;
  };
  const yb = (() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const q of PP.YARD)
      for (const [x, z] of [[q.minX, q.minZ], [q.maxX, q.minZ], [q.maxX, q.maxZ], [q.minX, q.maxZ]] as P2[]) {
        const [wx, wz] = PP.toWorld(x, z);
        minX = Math.min(minX, wx);
        maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz);
        maxZ = Math.max(maxZ, wz);
      }
    return { minX, maxX, minZ, maxZ };
  })();
  let doorOpen = true;
  world.addWalkArea({
    box: yb,
    has: yardHas,
    walkable: (x, z) => doorOpen && yardHas(x, z) && inR(PP.YARD, ...L(x, z)),
    floor: () => 0,
    hits: (x, z, r) => yardHits(x, z, r),
  });

  // ---- the people: warders and men, drawn by the state from the server
  let state: PrisonState | null = null;
  let lastFetch = -1e9;
  const fetchState = () => {
    void fetch("/api/prison", { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: PrisonState | null) => {
        if (s) state = s;
      })
      .catch(() => {});
  };
  type Fig = { h: Human | null; kind: HumanKind; x: number; z: number; yaw: number; motion: "idle" | "sit" | "walk" | "behind"; inHall: boolean; on: () => boolean; seat: number };
  const figs: Fig[] = [];
  const fig = (kind: HumanKind, x: number, z: number, yaw: number, motion: Fig["motion"], inHall: boolean, on: () => boolean, seat = 0.45) => figs.push({ h: null, kind, x, z, yaw, motion, inHall, on, seat });
  const has = (role: string) => !!state?.warders.some((w) => w.role === role);
  const M_ = PP.PLAN.marks;
  fig("police", M_.guardTable.x, M_.guardTable.z, M_.guardTable.yaw, "sit", true, () => has("guard"));
  fig("police", M_.chief.x, M_.chief.z, M_.chief.yaw, "behind", true, () => has("chief"));
  fig("police", M_.gangway.x, M_.gangway.z, M_.gangway.yaw, "sit", true, () => !!state?.visiting && has("visits"), 0.5);
  fig("police", 16.5, 19.5, -Math.PI / 2, "idle", true, () => has("chief") && !!state?.dayShift);
  fig("police", PP.GATE_WARDER.x, PP.GATE_WARDER.z, Math.PI, "behind", false, () => has("gate") || has("gate_night"));
  fig("police", PP.PARTS.ring.x, PP.PARTS.ring.z, 0, "behind", false, () => !!state?.exercise && has("yard"));
  // a man at his oakum in the open cell, on the edge of his bed
  fig("docker_c", 18.0, 16.1, Math.PI / 2, "sit", true, () => true, 0.55);
  // the man brought to the grille (a visit)
  let visitor: { id: string; name: string } | null = null;
  fig("docker_a", M_.prisoner.x, M_.prisoner.z, M_.prisoner.yaw, "idle", true, () => !!visitor);
  const KINDS: HumanKind[] = ["docker_a", "docker_b", "docker_c", "old_man", "beggar", "sailor_b", "docker_c", "old_man", "docker_b", "docker_a"];
  for (let i = 0; i < 10; i++) ringers.push({ h: null, a: (i / 10) * Math.PI * 2, kind: KINDS[i] });

  const toW = (x: number, z: number) => PP.toWorld(x, z);
  let inside = false;
  const RING_R = (PP.PARTS.ring.r_in + PP.PARTS.ring.r_out) / 2;
  return {
    hall,
    get indoors() {
      return inside;
    },
    update(t, dt, dayN, hour, daylight, sky) {
      void dayN;
      void hour;
      if (t - lastFetch > (state ? 10 : 2)) {
        lastFetch = t;
        fetchState();
      }
      const want = state ? state.visiting : false;
      const jef = hooks.jef();
      const k = hall.insideness(jef.x, jef.z);
      const [jx, jz] = L(jef.x, jef.z);
      const inYard = inR(PP.YARD, jx, jz);
      if (doorOpen && !want && (k > 0.2 || inYard)) {
        const [sx, sz] = toW(PP.PLAN.marks.door.x, PP.PLAN.marks.door.z);
        jef.place(sx, sz, PP.YAW); // (facing away from the gate, down the wall street)
        hooks.say("\"Visiting hours are over.\" A warder walks you back down the passage, and the gate shuts behind you.");
        visitor = null;
      }
      doorOpen = want;
      hall.doorOpen = want;
      hall.update(t, dt, daylight, sky);
      const now = inside ? k > 0.35 : k > 0.55;
      if (now !== inside) {
        inside = now;
        hooks.roomSound(inside ? "vault" : null);
      }
      // the figures: in the hall's scene (its frame) or the street's (world)
      for (const f of figs) {
        const on = f.on();
        if (!on) {
          if (f.h) f.h.root.visible = false;
          continue;
        }
        if (!f.h) {
          f.h = makeHuman(f.kind);
          if (!f.h) continue;
          if (f.inHall) room.group.add(f.h.root);
          else world.scene.add(f.h.root);
          f.h.play(f.motion, 0);
        }
        const h = f.h;
        h.root.visible = true;
        if (f.inHall) {
          h.root.position.set(f.x, f.motion === "sit" ? h.sitDrop(f.seat) : 0, f.z);
          h.root.rotation.y = f.yaw;
        } else {
          const [wx, wz] = toW(f.x, f.z);
          h.root.position.set(wx, 0, wz);
          h.root.rotation.y = f.yaw + PP.YAW;
        }
        h.update(Math.min(dt, 0.1));
      }
      // the men in the ring: walking round, clockwise, a few paces apart, at the hours of exercise
      const n = state?.exercise ? state.ring : 0;
      ringers.forEach((q, i) => {
        if (i >= n) {
          if (q.h) q.h.root.visible = false;
          return;
        }
        if (!q.h) {
          q.h = makeHuman(q.kind);
          if (!q.h) return;
          world.scene.add(q.h.root);
          q.h.play("walk", 0);
          q.h.setPace(0.8);
        }
        q.a -= (0.8 / RING_R) * dt;
        const lx = PP.PARTS.ring.x + Math.cos(q.a) * RING_R;
        const lz = PP.PARTS.ring.z + Math.sin(q.a) * RING_R;
        const [wx, wz] = toW(lx, lz);
        q.h.root.visible = true;
        q.h.root.position.set(wx, 0.05, wz);
        // facing along the ring (clockwise in the frame)
        const tx = Math.sin(q.a);
        const tz = -Math.cos(q.a);
        q.h.root.rotation.y = Math.atan2(tx, tz) + PP.YAW;
        q.h.update(Math.min(dt, 0.1));
      });
    },
    pathPoints() {
      if (!hall.doorOpen) return [];
      return [...PRISON_POINTS, ...YARD_POINTS].map((p) => {
        const [x, z] = toW(p.x, p.z);
        return { label: p.label, x, z, reach: p.reach };
      });
    },
    action(x, z) {
      const [lx, lz] = L(x, z);
      // at the grille in the visitors' room
      if (hall.doorOpen && lx > PP.IN.passWall && lx < PP.IN.front.x1 && lz > PP.IN.grille1 - 1.2 && lz < PP.IN.grille1 + 0.2) {
        return {
          label: "ask to see a prisoner",
          run() {
            void fetch("/api/prison/visit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(8000) })
              .then((r) => r.json())
              .then((v: { ok: boolean; id?: string; name?: string; text: string }) => {
                hooks.say(v.text);
                if (v.ok && v.id && v.name) {
                  visitor = { id: v.id, name: v.name };
                  hooks.talk(v.id, v.name);
                }
              })
              .catch(() => hooks.say("The warder does not hear you."));
          },
        };
      }
      // by a warder: the gate warder on the street, the yard warder, the chief at his desk
      const near = (px: number, pz: number, r: number) => Math.hypot(lx - px, lz - pz) < r;
      const ask = (role: string) => ({
        label: "speak to the warder",
        run() {
          void fetch("/api/prison/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }), signal: AbortSignal.timeout(8000) })
            .then((r) => r.json())
            .then((v: { text: string }) => hooks.say(v.text))
            .catch(() => {});
        },
      });
      if (near(PP.GATE_WARDER.x, PP.GATE_WARDER.z, 2.0) || near(0, -1.8, 1.6)) return ask(state?.dayShift ? "gate" : "gate_night");
      if (state?.exercise && near(PP.PARTS.ring.x, PP.PARTS.ring.z, PP.PARTS.ring.r_out + 1.5)) return ask("yard");
      if (hall.doorOpen && near(PP.PLAN.marks.chief.x, PP.PLAN.marks.chief.z, 2.4)) return ask("chief");
      if (hall.doorOpen && near(PP.PLAN.marks.gangway.x, PP.PLAN.marks.gangway.z, 2.2)) return ask("visits");
      return null;
    },
    info() {
      return { state, doorOpen, inside, visitor, figs: figs.map((f) => ({ kind: f.kind, on: f.on(), drawn: !!f.h?.root.visible })), ring: ringers.filter((q) => q.h?.root.visible).length };
    },
  };
}
