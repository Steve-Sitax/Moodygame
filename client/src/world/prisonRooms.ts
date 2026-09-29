import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import * as PP from "../../../shared/prisonPlan";
import { SHELL_OPENINGS } from "../../../shared/prisonShell";
import type { ShellFace, ShellOpening } from "../../../shared/shellOpening";
import { billTex, Flames, glass as glassTex, Kit, lmBasic, lmMat, matOf, type MatDef } from "./landmarkKit";
import { M, walkGraph, type LandmarkRoom } from "./landmarkRooms";
import { canvasTex, flicker, frameRoom, tex } from "./rooms";
import { addDial } from "./clockHands";
import { panel, planarUV } from "./carolusHall";
import { withPicture } from "./quayStone";
import { glassPanes, lining } from "./realOpenings";

// The prison's insides (M7 prison real, 2026-09-26; docs/milestones/M7-prison-real.md). Steve: "Prison does not seem to
// have a real internal but instanced? Never do instanced, always go real." Every part the shell shows is built here at
// the shell's true size, in the prison's frame (shared/prisonPlan.ts), its walls cut where the shell's real openings
// are (shared/prisonShell.ts, written by tools/blender/build_prison.py; world/realOpenings.ts):
//  - buildPrisonHall: the gate passage, the guard room, the visitors' room, the offices and the records room over
//    them, the clock room in the tower top (locked) and its two bartizans, the link and the landing over it, the
//    watch pavilion with its galleries, both cell wings: every cell of three storeys either side (two open in each
//    wing), the galleries, bridges and scissor stairs, the corridor open to its roof lights;
//  - buildChapel: the chapel in the west court: the prisoners' stalls, the pulpit, the harmonium, the altar in the apse;
//  - buildGovernor: the governor's house: three storeys of rooms and the garret behind the dormers (shut to Jef).
// The glass of every window is the rooms' (the shell has the bars). At night the parts are lit by the prison's
// routine (PP.prisonLights): the cells' gas till eight, the corridors low all night, the guard room, the offices till
// seven, the governor's evening; the lamps are few (ROOM_POINT_LIGHTS), the rest is each part's own glow.

const FY = PP.FLOOR_Y;
/** World height to the prison's room frame. */
const ly = (y: number) => y - FY;

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

/** Whitewash over a grey-green dado, as in every cellular prison; bluestone, oak, iron. */
export const C = {
  wash: lmMat("pr_in_wash", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#cfc8b8")), color: 0xcfc9bb }, 0.05),
  /** The cells' whitewash: lit from inside at night by their gas (its glow is set by the routine). */
  cellWash: lmMat("pr_cell_wash", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#cfc8b8")), color: 0xc8c2b4, emissive: 0x000000 }, 0.05),
  dado: lmMat("pr_in_dado", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#4a5448")), color: 0x4c5646, side: THREE.DoubleSide }, 0.05),
  vault: lmMat("pr_in_vault", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#d0cabc")), color: 0xd6d0c2, side: THREE.DoubleSide }, 0.03),
  flags: lmMat("pr_in_flags", { map: PIC("/textures/wall_ashlar_blue.jpg", flat("#5a5e60")), color: 0x9ea2a4 }, 0.05),
  blue: lmMat("pr_in_blue", { map: PIC("/textures/carolus_bluestone.jpg", flat("#6a6e70")), color: 0x9a9c9e }, 0.05),
  oak: lmMat("pr_in_oak", { map: PIC("/textures/carolus_oak.jpg", flat("#3a2618")), color: 0x7a6858 }, 0.1),
  /** The cell doors: plain oak planks, painted (not the Carolus's carved oak). */
  door: lmMat("pr_in_door", { map: tex().planks, color: 0x6e5a48 }, 0.1),
  /** The offices: a buff distemper over a brown dado; boards underfoot. */
  office: lmMat("pr_office_wall", { map: PIC("/textures/wall_plaster_smooth.jpg", flat("#b8a888")), color: 0xc4b294, emissive: 0x000000 }, 0.05),
  boards: lmMat("pr_boards", { map: tex().planks, color: 0x8a6a4c }, 0.1),
  /** The governor's house: papered rooms. */
  paper: lmMat("pr_gov_paper", { map: PIC("/textures/cafe_wallpaper_red.jpg", flat("#6a3a30")), color: 0xa89078, emissive: 0x000000 }, 0.05),
  carpet: lmMat("pr_gov_carpet", { map: tex().sack, color: 0x6a3428 }, 0.1),
  plank: M.oak,
  iron: M.iron,
  ironPaint: lmMat("pr_in_iron_paint", { color: 0x2a3228 }, 0),
  straw: lmMat("pr_in_straw", { color: 0x9a8a58 }, 0.1),
  blanket: lmMat("pr_in_blanket", { color: 0x5a5448 }, 0.1),
  linen: M.linen,
  tin: M.tin,
  brass: M.brass,
  black: M.black,
  paper_: lmMat("pr_in_paper", { color: 0xd8d0b8 }, 0),
  bill: lmMat("pr_in_rules", { map: billTex(1855) }, 0),
  ledger: lmMat("pr_in_ledger", { color: 0x5a2a1a }, 0),
  dark: lmMat("pr_in_dark", { color: 0x0e0d0c }, 0),
  glow: lmBasic("pr_in_skylight", { color: 0xb8bcb8, fog: false }),
  lamp: lmBasic("pr_in_lamp", { color: 0xffc070 }),
};

type P2 = [number, number];
type Hole = { u0: number; u1: number; y0: number; spring: number; round?: boolean };

/** A barrel vault along z (x middle, radius r, springing y) from z0 to z1, seen from below; or along x (axis "x"). */
function barrel(k: Kit, def: MatDef, c: number, spring: number, r: number, a0: number, a1: number, axis: "x" | "z" = "z", n = 10): void {
  const pos: number[] = [];
  const uv: number[] = [];
  const L = a1 - a0;
  const segs = Math.max(1, Math.ceil(Math.abs(L) / 3));
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

/** A wall (panel) with a shoulder-high dado, from a to c (local x, z), `t` thick, its doorways and windows. */
function wall(k: Kit, a: P2, c: P2, y1: number, openings: Hole[] = [], windows: Hole[] = [], t = 0.3, dadoH = 1.4, def: MatDef = C.wash, y0 = 0): void {
  panel(k, def, a, c, y0, y1, t, openings, windows, 2.0);
  if (dadoH <= 0) return;
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const tx = (c[0] - a[0]) / L;
  const tz = (c[1] - a[1]) / L;
  const nx = -tz;
  const nz = tx;
  const off = t / 2 + 0.02;
  const cuts = openings.filter((o) => o.y0 < y0 + dadoH).map((o) => [o.u0, o.u1] as P2).sort((p, q) => p[0] - q[0]);
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
      k.box(p1 - p0, dadoH, 0.01, a[0] + tx * um + sgn * nx * off, y0 + dadoH / 2, a[1] + tz * um + sgn * nz * off, C.dado, { ry, tile: 1.6 });
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
function cellDoor(k: Kit, x: number, z: number, y: number, side: 1 | -1, open = false, hatchOpen = false): void {
  const w = 0.8;
  const h = 1.9;
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
  if (hatchOpen) {
    // the leaf round the open food hatch (0.26 x 0.2 at 1.05): four pieces, the hatch's flap let down on its chains
    const hy0 = 0.95;
    const hy1 = 1.15;
    k.box(w, hy0, 0.05, x, y + hy0 / 2, d, C.door, { tile: 1.2 });
    k.box(w, h - hy1, 0.05, x, y + (h + hy1) / 2, d, C.door, { tile: 1.2 });
    k.box((w - 0.26) / 2, hy1 - hy0, 0.05, x - w / 2 + (w - 0.26) / 4, y + (hy0 + hy1) / 2, d, C.door);
    k.box((w - 0.26) / 2, hy1 - hy0, 0.05, x + w / 2 - (w - 0.26) / 4, y + (hy0 + hy1) / 2, d, C.door);
    k.box(0.26, 0.02, 0.2, x, y + hy0 - 0.01, d + side * 0.12, C.iron);
  } else {
    k.box(w, h, 0.05, x, y + h / 2, d, C.door, { tile: 1.2 });
    k.box(0.26, 0.2, 0.02, x, y + 1.05, d + side * 0.04, C.iron); // the shut food hatch
  }
  for (const yy of [0.25, 1.65]) k.box(w * 0.92, 0.06, 0.02, x, y + yy, d + side * 0.035, C.iron);
  k.cyl(0.035, 0.035, 0.02, x, y + 1.52, d + side * 0.045, C.dark, { seg: 6, rx: Math.PI / 2 }); // the judas
  k.box(0.2, 0.05, 0.05, x + w / 2 - 0.12, y + 1.0, d + side * 0.05, C.iron); // the bolt
  k.cyl(0.07, 0.07, 0.01, x, y + 1.8, d + side * 0.045, C.paper_, { seg: 8, rx: Math.PI / 2 }); // the number plate
}

/** A cell's things (inside its walls): the iron bed with straw and blanket, the hinged table and stool, the shelf
 * with the Bible and the tin mug, the bucket, the tap, the rules on a board, a gas jet; a man's oakum if held. */
function cellThings(k: Kit, c: ReturnType<typeof PP.cellBox>, row: "N" | "S", flames: Flames, occupied: boolean, seed: number): void {
  const { x0, x1, zDoor, zBack, into, xm, bx, bl, bzc, folded, tx, tz } = PP.cellFurniture(c, row, seed);
  const y = c.y0;
  // by day half the beds stand folded against the wall (the rule), the rest are down
  if (folded) {
    k.box(0.08, 1.7, 0.7, x0 + 0.06, y + 0.95, bzc, C.iron);
    k.box(0.1, 1.5, 0.62, x0 + 0.12, y + 0.95, bzc, C.straw, { tile: 0.8 });
  } else {
    k.box(0.72, 0.05, bl, bx, y + 0.45, bzc, C.iron);
    k.box(0.66, 0.1, bl - 0.08, bx, y + 0.53, bzc, C.straw, { tile: 0.8 });
    k.box(0.68, 0.04, bl * 0.6, bx, y + 0.6, bzc - into * bl * 0.15, C.blanket);
  }
  k.box(0.55, 0.04, 0.6, tx, y + 0.78, tz, C.plank);
  k.box(0.04, 0.76, 0.04, tx - 0.2, y + 0.38, tz, C.iron);
  k.box(0.32, 0.45, 0.32, tx - 0.3, y + 0.225, tz - into * 0.6, C.plank);
  k.box(0.6, 0.03, 0.2, x1 - 0.32, y + 1.9, zBack - into * 0.12, C.plank);
  k.box(0.14, 0.2, 0.05, x1 - 0.45, y + 2.0, zBack - into * 0.14, C.ledger);
  k.cyl(0.05, 0.04, 0.09, x1 - 0.22, y + 1.915, zBack - into * 0.14, C.tin, { seg: 6 });
  k.cyl(0.16, 0.13, 0.36, x1 - 0.25, y, zDoor + into * 0.35, C.oak, { seg: 8 });
  k.box(0.04, 0.2, 0.04, x1 - 0.05, y + 1.1, zDoor + into * 0.9, C.brass);
  k.box(0.02, 0.42, 0.3, x0 + 0.02, y + 1.55, zDoor + into * 0.5, C.bill);
  // the gas jet over the door (lit from dusk to lights out)
  k.box(0.04, 0.04, 0.2, xm, y + 2.4, zDoor + into * 0.12, C.brass);
  flames.addFlame(xm, y + 2.48, zDoor + into * 0.22);
  if (occupied) {
    k.box(0.5, 0.12, 0.4, xm + 0.15, y + 0.06, bzc, C.straw, { tile: 0.5, tint: 0.7 });
    k.cyl(0.18, 0.2, 0.14, xm + 0.5, y, bzc + into * 0.4, C.oak, { seg: 8, tint: 0.6 });
  }
}

/** A quad of four local points (a ceiling's slope, a gallery's plank), into a kit. */
function quad(k: Kit, def: MatDef, p: Array<[number, number, number]>, tile = 2.0): void {
  const g = new THREE.BufferGeometry();
  const pos = [p[0], p[1], p[2], p[0], p[2], p[3]].flat();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  planarUV(g, tile);
  k.add(g, def, 0, 0, 0, { flat: true });
}

/** An iron stair of straight flight: steps, two strings and a hand rail each side (local; along x or z). */
function flight(k: Kit, along: "x" | "z", foot: number, head: number, y0: number, y1: number, a0: number, a1: number, rise = 0.18): void {
  const n = Math.max(2, Math.round((y1 - y0) / rise));
  const run = head - foot;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const c = foot + run * t;
    const y = y0 + ((y1 - y0) * (i + 1)) / n;
    const w = Math.abs(run) / n + 0.02;
    if (along === "x") k.box(w, 0.04, a1 - a0, c, y - 0.02, (a0 + a1) / 2, C.ironPaint);
    else k.box(a1 - a0, 0.04, w, (a0 + a1) / 2, y - 0.02, c, C.ironPaint);
  }
  const L = Math.hypot(run, y1 - y0);
  const ang = Math.atan2(y1 - y0, Math.abs(run));
  for (const a of [a0, a1])
    for (const [dy, th] of [[-0.08, 0.16], [0.95, 0.04]] as Array<[number, number]>) {
      if (along === "x") k.box(L, th, 0.04, (foot + head) / 2, (y0 + y1) / 2 + dy, a, C.ironPaint, { rz: Math.sign(run) * ang });
      else k.box(0.04, th, L, a, (y0 + y1) / 2 + dy, (foot + head) / 2, C.ironPaint, { rx: -Math.sign(run) * ang });
    }
}

/** A railing along a line (local, level y): posts every 1.2 m, a top and a mid rail. */
function railing(k: Kit, a: P2, c: P2, y: number): void {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (L < 0.05) return;
  const ry = Math.atan2(c[0] - a[0], c[1] - a[1]) + Math.PI / 2;
  const mx = (a[0] + c[0]) / 2;
  const mz = (a[1] + c[1]) / 2;
  k.box(L, 0.04, 0.04, mx, y + 1.0, mz, C.ironPaint, { ry });
  k.box(L, 0.03, 0.03, mx, y + 0.5, mz, C.ironPaint, { ry });
  const n = Math.max(1, Math.round(L / 1.2));
  for (let i = 0; i <= n; i++) k.box(0.04, 1.0, 0.04, a[0] + ((c[0] - a[0]) * i) / n, y + 0.5, a[1] + ((c[1] - a[1]) * i) / n, C.ironPaint);
}

/** The shell's openings behind which this room stands (by the plan's zones). */
export function openingsOf(room: PP.Zone["room"]): ShellOpening[] {
  return SHELL_OPENINGS.filter((o) => PP.zoneOf(o)?.room === room);
}

/** A face of the shell by its ends and way out (the frame's x, z). */
const F = (a: P2, c: P2, n: P2): ShellFace => ({ a, c, n });

export interface PrisonHallBuilt {
  room: LandmarkRoom;
  /** The prison's windows (shell openings) its room stands behind. */
  windows: ShellOpening[];
  /** The glass (clear): its look from outside by day and from inside (set each frame by the air). */
  glass: THREE.MeshBasicMaterial;
  /** The routine's light at this hour: the parts' glow and lamps (dusk 0 day .. 1 night). */
  night(l: ReturnType<typeof PP.prisonLights>, dusk: number): void;
}

/** The prison's rooms, built from the plan at the shell's place (the group in the world by the plan's frame). */
export function buildPrisonHall(): PrisonHallBuilt {
  const P = PP.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x22241f);
  scene.background = null;
  group.position.y = FY;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 14;
  fog.far = 70;
  // one kit per part: each merges its own pieces, so a part out of view is not drawn (three.js culls by its sphere)
  const part = (name: string) => {
    const g = new THREE.Group();
    g.name = `prison_in_${name}`;
    group.add(g);
    const k = new Kit(g);
    k.shadeTop = 10;
    return k;
  };
  const kF = part("front");
  const kP = part("pavilion");
  const kA = part("wingA");
  const kB = part("wingB");
  const flames = new Flames(group, 200, 0.12);
  const I = PP.IN;
  const T = I.tower;
  const windows = openingsOf("prison");
  const box = (k: Kit, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.0, tint?: number) =>
    k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile, tint });
  const line = (k: Kit, def: MatDef, L: Parameters<typeof lining>[2], tile = 2.0) => lining(k, def, L, windows, FY, tile);

  // ================================================================ the front building, the gate tower, the link
  const k = kF;
  const ph = I.passHW;
  const sp = PP.PARTS.gate.spring;
  const pEnd = T.z1; // the passage's vault ends at the tower's back wall
  // ---- the gate passage: bluestone walls to the springing, a barrel vault, the flags
  box(k, -ph, ph, -0.05, 0.0, I.gateFace, I.passEnd, C.flags, 1.6);
  // (west: the guard room's door and the porter's hatch; east: the visitors' door and the prisoners' side's door)
  panel(k, C.blue, [-ph - 0.15, pEnd], [-ph - 0.15, I.gateInner], 0, sp, 0.3, [{ u0: pEnd - 6.4, u1: pEnd - 4.8, y0: 0, spring: 2.4 }], [{ u0: pEnd - 3.4, u1: pEnd - 2.6, y0: 1.4, spring: 1.9 }], 1.6);
  panel(k, C.blue, [ph + 0.15, I.gateInner], [ph + 0.15, pEnd], 0, sp, 0.3, [{ u0: 0.8 - I.gateInner, u1: 2.4 - I.gateInner, y0: 0, spring: 2.4 }, { u0: 6.6 - I.gateInner, u1: 7.4 - I.gateInner, y0: 0, spring: 2.0 }], [], 1.6);
  barrel(k, C.vault, 0, sp, ph, I.gateInner, pEnd, "z", 12);
  grille(k, [-ph + 0.02, 2.6], [-ph + 0.02, 3.4], 1.4, 1.9, 0.1);
  box(k, ph - 0.45, ph - 0.05, 0.42, 0.48, 5.0, 7.4, C.plank, 1.2);
  for (const z of [5.2, 7.2]) box(k, ph - 0.4, ph - 0.1, 0, 0.42, z - 0.05, z + 0.05, C.plank);
  k.box(0.02, 0.6, 0.45, ph - 0.03, 1.7, 3.4, C.bill);
  k.box(0.02, 0.02, 1.2, -ph + 0.05, 2.6, 0.9, C.iron);
  k.cyl(0.03, 0.03, 0.9, -ph + 0.06, 1.9, 0.9, C.iron, { seg: 4 });
  k.cyl(0.01, 0.01, 0.5, 0, sp + ph - 0.5, 4.6, C.iron, { seg: 4 });
  k.box(0.22, 0.3, 0.22, 0, sp + ph - 0.7, 4.6, C.lamp);
  k.box(0.26, 0.04, 0.26, 0, sp + ph - 0.53, 4.6, C.iron);
  // the inner grille in the doorway through the tower's back wall: two leaves standing open against the walls
  grille(k, [-ph, pEnd], [-ph + 0.15, pEnd - 1.4], 0, 2.9, 0.13, [1.0, 2.0]);
  grille(k, [ph, pEnd], [ph - 0.15, pEnd - 1.4], 0, 2.9, 0.13, [1.0, 2.0]);
  // the tower's back wall: the doorway from the passage to the link below, the records room's door to the landing over it
  wall(k, [-2.2, pEnd + 0.14], [2.2, pEnd + 0.14], 3.5, [{ u0: 2.2 - ph, u1: 2.2 + ph, y0: 0, spring: 3.3 }], [], 0.28, 0);
  wall(k, [-T.x, pEnd + 0.14], [T.x, pEnd + 0.14], PP.LV.tower + 4.8, [], [{ u0: T.x + I.towerSteps.x0, u1: T.x + I.towerSteps.x1, y0: PP.LV.tower, spring: PP.LV.tower + 2.1 }], 0.28, 0, C.wash, 3.5);

  // ---- the guard room (west) and the visitors' room (east): their linings of the front building's faces (both
  // storeys: the offices over them share them)
  const Fr = I.front;
  const top = 8.2; // the offices' ceiling (world): the lead roof lies over it
  for (const s of [-1, 1] as const) {
    const xs = (x: number) => s * x;
    // the street face between the corner tower and the gate tower
    line(k, C.wash, { face: s < 0 ? F([-8.6, 0], [-4.2, 0], [0, -1]) : F([4.2, 0], [8.6, 0], [0, -1]), from: 0.35, to: 0.65, y0: FY, y1: top });
    // the corner tower's front (0.3 m proud), inside the room's end
    line(k, C.wash, { face: s < 0 ? F([-12.3, -0.3], [-8.6, -0.3], [0, -1]) : F([8.6, -0.3], [12.3, -0.3], [0, -1]), u0: s < 0 ? 0.9 : 0, u1: s < 0 ? 3.7 : 2.8, from: 0.3, to: 0.95, y0: FY, y1: top });
    // the end wall
    line(k, C.wash, { face: F([xs(12), 0], [xs(12), 9], [s, 0]), u0: Fr.z0 - 0.02, u1: Fr.z1 + 0.02, from: 0.3, to: 0.6, y0: FY, y1: top });
    // the back (to the courts) as far as the gate tower's side
    line(k, C.wash, { face: s < 0 ? F([-12, 9], [-2.0, 9], [0, 1]) : F([2.0, 9], [12, 9], [0, 1]), u0: s < 0 ? 0.6 : 0, u1: s < 0 ? 10.0 : 9.4, from: 0.3, to: 0.6, y0: FY, y1: ly(4.3) + FY });
    line(k, C.office, { face: s < 0 ? F([-12, 9], [-4.2, 9], [0, 1]) : F([4.2, 9], [12, 9], [0, 1]), u0: s < 0 ? 0.6 : 0, u1: s < 0 ? 7.8 : 7.2, from: 0.3, to: 0.6, y0: 4.3, y1: top });
    // the ground rooms' dado along the street (a skin 2 cm off the lining)
    box(k, Math.min(xs(2.0), xs(Fr.x1)), Math.max(xs(2.0), xs(Fr.x1)), 0, 1.4, Fr.z0, Fr.z0 + 0.02, C.dado, 1.6);
    // the floor and the ceiling (the offices' floor over it: a slab)
    box(k, Math.min(xs(2.0), xs(Fr.x1)), Math.max(xs(2.0), xs(Fr.x1)), -0.05, 0.0, Fr.z0 - 0.35, Fr.z1, C.flags, 1.6);
    box(k, Math.min(xs(2.0), xs(Fr.x1)), Math.max(xs(2.0), xs(Fr.x1)), 3.9, PP.LV.office - 0.06, Fr.z0 - 0.35, Fr.z1, C.vault, 2.0);
    for (let x = 2.9; x < Fr.x1; x += 1.8) box(k, xs(x) - 0.1, xs(x) + 0.1, 3.68, 3.9, Fr.z0, Fr.z1, C.oak, 1.2);
  }
  // (the corner towers' deeper reveals: their floor pieces run into the window bays)
  // ---- the guard room's things: the table with its book, the lamp and the ink; chairs; the stove; the bunk; the cupboard; rifles; keys
  box(k, -8.3, -6.1, 0.76, 0.8, 3.2, 4.3, C.plank, 1.2);
  for (const [x, z] of [[-8.2, 3.3], [-6.2, 3.3], [-8.2, 4.2], [-6.2, 4.2]]) box(k, x - 0.03, x + 0.03, 0, 0.76, z - 0.03, z + 0.03, C.plank);
  box(k, -7.6, -7.1, 0.8, 0.86, 3.5, 3.9, C.ledger);
  box(k, -7.58, -7.12, 0.86, 0.87, 3.52, 3.88, C.paper_);
  k.cyl(0.05, 0.07, 0.18, -6.6, 0.8, 3.7, C.brass, { seg: 6 });
  k.box(0.12, 0.14, 0.12, -6.6, 1.05, 3.7, C.lamp);
  k.cyl(0.03, 0.03, 0.05, -7.0, 0.8, 4.05, C.black, { seg: 6 });
  for (const [x, z, ry] of [[-7.2, 4.9, 0], [-7.8, 2.6, Math.PI], [-5.6, 3.75, -Math.PI / 2]] as Array<[number, number, number]>) {
    k.box(0.42, 0.04, 0.42, x, 0.45, z, C.plank, { ry });
    for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) k.box(0.03, 0.45, 0.03, x + dx, 0.22, z + dz, C.plank);
    k.box(0.42, 0.5, 0.03, x - Math.sin(ry) * 0.2, 0.75, z - Math.cos(ry) * 0.2, C.plank, { ry });
  }
  k.cyl(0.4, 0.42, 0.9, -10.95, 0, 7.2, C.iron, { seg: 8 });
  k.cyl(0.08, 0.08, 3.9 - 0.9, -10.95, 0.9, 7.2, C.iron, { seg: 6 });
  k.box(0.16, 0.12, 0.02, -10.95, 0.45, 6.79, C.lamp);
  box(k, -11.4, -9.5, 0.4, 0.5, 0.65, 1.5, C.plank, 1.2);
  box(k, -11.35, -9.55, 0.5, 0.62, 0.7, 1.45, C.blanket);
  box(k, -4.1, -2.5, 0, 2.1, 0.65, 1.1, C.oak, 1.2);
  box(k, -11.4, -11.3, 0.8, 2.0, 3.0, 5.2, C.oak, 1.2);
  for (let z = 3.2; z < 5.1; z += 0.35) {
    k.cyl(0.02, 0.02, 1.3, -11.22, 0.75, z, C.iron, { seg: 4 });
    k.box(0.06, 0.3, 0.08, -11.22, 0.9, z, C.oak);
  }
  box(k, -2.42, -2.36, 1.4, 2.0, 2.4, 3.6, C.oak, 1.2);
  for (let i = 0; i < 9; i++) k.cyl(0.012, 0.012, 0.14, -2.45, 1.8 - (i % 3) * 0.18, 2.55 + Math.floor(i / 3) * 0.4, C.brass, { seg: 4 });
  for (const x of [-4.6, -4.2]) k.cyl(0.1, 0.1, 0.12, x, 1.65, Fr.z1 - 0.12, C.black, { seg: 8 });
  k.box(0.9, 0.05, 0.08, -4.4, 1.55, Fr.z1 - 0.06, C.oak);
  // the guard room's wall to the passage and the visitors' room's (their doors; the passage's bluestone behind)
  wall(k, [-2.0 - 0.15, Fr.z0], [-2.0 - 0.15, Fr.z1], 3.9, [{ u0: 4.8 - Fr.z0, u1: 6.4 - Fr.z0, y0: 0, spring: 2.4 }], [{ u0: 2.6 - Fr.z0, u1: 3.4 - Fr.z0, y0: 1.4, spring: 1.9 }], 0.02, 1.4);
  wall(k, [2.0 + 0.15, Fr.z1], [2.0 + 0.15, Fr.z0], 3.9, [{ u0: Fr.z1 - 2.4, u1: Fr.z1 - 0.8, y0: 0, spring: 2.4 }, { u0: Fr.z1 - 7.4, u1: Fr.z1 - 6.6, y0: 0, spring: 2.0 }], [], 0.02, 1.4);

  // ---- the visitors' room: the visitors' side, the double grille with the gangway, the prisoners' side
  const vx0 = I.passWall;
  const vx1 = Fr.x1;
  // the prisoners' side's door from the passage (shut; the man is brought through it)
  k.box(0.05, 1.9, 0.8, 2.0 + 0.3, 0.95, 7.0, C.door, { tile: 1.2 });
  for (const yy of [0.25, 0.95, 1.65]) k.box(0.02, 0.06, 0.74, 2.0 + 0.34, yy, 7.0, C.iron);
  for (const zg of [I.grille1, I.grille2]) {
    grille(k, [vx0, zg], [vx1, zg], 1.0, 3.85, 0.11, [2.2]);
    box(k, vx0, vx1, 0, 1.0, zg - 0.05, zg + 0.05, C.oak, 1.2);
    box(k, vx0, vx1, 1.0, 1.05, zg - 0.14, zg + 0.14, C.plank, 1.2);
  }
  box(k, 3.25, 3.55, 0.45, 0.5, 3.85, 4.15, C.plank);
  box(k, 3.36, 3.44, 0, 0.45, 3.96, 4.04, C.plank);
  for (const [a, b] of [[3.6, 5.8], [8.0, 10.2]]) {
    box(k, a, b, 0.42, 0.48, 0.67, 0.98, C.plank, 1.2);
    for (const x of [a + 0.1, b - 0.1]) box(k, x - 0.03, x + 0.03, 0, 0.42, 0.7, 0.95, C.plank);
  }
  box(k, 3.0, 10.6, 0.42, 0.48, 7.6, 8.0, C.plank, 1.2);
  k.cyl(0.01, 0.01, 0.6, 6.8, 3.3, 4.0, C.iron, { seg: 4 });
  k.box(0.2, 0.26, 0.2, 6.8, 3.15, 4.0, C.lamp);
  k.box(0.02, 0.6, 0.45, vx1 - 0.03, 1.8, 2.0, C.bill);

  // ---- the offices over them (floor 4.2): the director's room and the clerk's (west), the registry and the doctor's (east)
  const oy = PP.LV.office;
  const oTop = ly(top);
  for (const s of [-1, 1] as const) {
    const xs = (x: number) => s * x;
    const [a, b] = [Math.min(xs(4.2), xs(Fr.x1)), Math.max(xs(4.2), xs(Fr.x1))];
    box(k, a, b, oy - 0.04, oy, Fr.z0 - 0.35, Fr.z1, C.boards, 1.2);
    box(k, a, b, oTop, oTop + 0.1, Fr.z0 - 0.35, Fr.z1, C.vault, 2.0);
    // the brown dado and the picture rail
    box(k, a, b, oy, oy + 0.85, Fr.z0, Fr.z0 + 0.02, C.oak, 1.2);
    box(k, a, b, oy, oy + 0.85, Fr.z1 - 0.02, Fr.z1, C.oak, 1.2);
    // the partition between the two rooms (its door at the back)
    wall(k, [xs(I.officeWall), Fr.z0], [xs(I.officeWall), Fr.z1], oTop, [{ u0: 6.7 - Fr.z0, u1: 7.9 - Fr.z0, y0: oy, spring: oy + 2.2 }], [], 0.2, 0, C.office, oy);
    // the gate tower's side: its door up to the records room (a short flight in the office)
    wall(k, [xs(4.05), Fr.z0 - 0.4], [xs(4.05), T.z1], ly(9.9), [{ u0: 6.5 - Fr.z0 + 0.4, u1: 7.7 - Fr.z0 + 0.4, y0: oy, spring: PP.LV.tower + 2.1 }], [], 0.3, 0, C.office, oy);
    flight(k, "x", xs(5.2), xs(4.2), oy, PP.LV.tower, 6.5, 7.7, 0.2);
  }
  // the director's desk, his chair, a press, the map of the prison; the clerk's presses and desk
  box(k, -7.4, -5.2, oy + 0.76, oy + 0.8, 4.9, 6.1, C.oak, 1.2);
  box(k, -7.3, -5.3, oy, oy + 0.76, 5.0, 6.0, C.oak, 1.2);
  box(k, -6.5, -6.0, oy, oy + 0.95, 6.3, 6.8, C.oak);
  box(k, -6.6, -5.9, oy + 0.9, oy + 1.4, 6.75, 6.8, C.oak);
  box(k, -6.8, -6.0, oy + 0.8, oy + 0.82, 5.3, 5.8, C.paper_);
  k.box(1.2, 0.9, 0.02, -6.4, oy + 1.9, Fr.z1 - 0.03, C.bill);
  box(k, -11.4, -10.9, oy, oy + 2.3, 1.2, 5.0, C.oak, 1.2);
  box(k, -10.2, -9.4, oy + 0.9, oy + 0.95, 3.2, 4.2, C.oak, 1.2);
  box(k, -10.15, -9.45, oy, oy + 0.9, 3.3, 4.1, C.oak, 1.2);
  for (let i = 0; i < 6; i++) box(k, -10.95, -10.9, oy + 0.3 + i * 0.35, oy + 0.6 + i * 0.35, 1.3, 4.9, C.ledger, 0.5);
  // the registry: the long desk with its ledgers, the presses; the doctor's couch, cupboard and washstand
  box(k, 5.2, 7.0, oy + 0.9, oy + 0.95, 3.8, 4.6, C.oak, 1.2);
  box(k, 5.3, 6.9, oy, oy + 0.9, 3.9, 4.5, C.oak, 1.2);
  for (const x of [5.5, 6.1, 6.6]) box(k, x - 0.2, x + 0.2, oy + 0.95, oy + 1.0, 4.0, 4.35, C.ledger);
  box(k, 4.2, 4.7, oy, oy + 2.3, 1.0, 5.6, C.oak, 1.2);
  box(k, 9.6, 11.4, oy + 0.45, oy + 0.6, 6.2, 7.2, C.blanket);
  box(k, 9.6, 11.4, oy, oy + 0.45, 6.2, 7.2, C.oak);
  box(k, 10.9, 11.4, oy, oy + 1.9, 1.2, 3.2, C.oak, 1.2);
  box(k, 9.4, 10.0, oy, oy + 0.8, 1.0, 1.5, C.oak);
  k.cyl(0.18, 0.12, 0.1, 9.7, oy + 0.8, 1.25, C.tin, { seg: 8 });

  // ---- the records room in the gate tower (floor 5.0, over the passage's vault)
  const ty = PP.LV.tower;
  box(k, -T.x, T.x, ty - 0.2, ty, T.z0 - 0.35, T.z1, C.boards, 1.2);
  line(k, C.wash, { face: F([4.2, -0.6], [-4.2, -0.6], [0, -1]), u0: 0.3, u1: 8.1, from: 0.35, to: 0.7, y0: ty + FY, y1: 9.9 });
  box(k, -T.x, T.x, ly(9.9) - 0.1, ly(9.9), T.z0 - 0.35, T.z1, C.vault, 2.0);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) box(k, s * T.x - s * 0.45, s * T.x, ty + 0.2 + i * 0.5, ty + 0.24 + i * 0.5, 0.6, 5.8, C.plank, 1.2);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 12; j++) box(k, s * T.x - s * 0.4, s * T.x - s * 0.05, ty + 0.25 + i * 0.5, ty + 0.62 + i * 0.5, 0.7 + j * 0.42, 1.0 + j * 0.42, C.ledger, 0.5, 0.7 + ((i * 7 + j * 3) % 5) * 0.08);
  }
  box(k, -1.2, 1.2, ty + 0.76, ty + 0.8, 3.4, 4.6, C.oak, 1.2);
  box(k, -1.1, 1.1, ty, ty + 0.76, 3.5, 4.5, C.oak, 1.2);
  box(k, -0.4, 0.3, ty + 0.8, ty + 0.86, 3.7, 4.2, C.ledger);
  // the ladder up to the clock room's hatch
  for (const x of [2.7, 3.3]) k.box(0.06, ly(9.9) - ty, 0.06, x, (ly(9.9) + ty) / 2, 8.2, C.plank, { rx: -0.12 });
  for (let y = ty + 0.3; y < ly(9.9); y += 0.3) k.box(0.6, 0.04, 0.04, 3.0, y, 8.2 + (y - ty) * 0.12 - 0.3, C.plank);
  box(k, 2.6, 3.4, ly(9.9) - 0.12, ly(9.9) - 0.02, 7.6, 8.5, C.oak, 1.2);

  // ---- the clock room in the tower's top (locked; seen through its three windows) and the bartizans off it
  const cy0 = ly(10.0);
  box(k, -T.clockX, T.clockX, cy0 - 0.1, cy0, T.clockZ0, T.clockZ1, C.boards, 1.2);
  for (const s of [-1, 1] as const) line(k, C.wash, { face: F([s * 4.2, -0.6], [s * 4.2, 9], [s, 0]), u0: 0.3, u1: 9.3, from: 0.3, to: 0.6, y0: 10.0, y1: 13.4 });
  line(k, C.wash, { face: F([-4.2, 9], [4.2, 9], [0, 1]), u0: 0.6, u1: 7.8, from: 0.3, to: 0.6, y0: 10.0, y1: 13.4 });
  line(k, C.wash, { face: F([4.2, -0.6], [-4.2, -0.6], [0, -1]), u0: 0.6, u1: 7.8, from: 0.02, to: 0.3, y0: 10.0, y1: 13.4 });
  box(k, -T.clockX, T.clockX, ly(13.4) - 0.05, ly(13.4) + 0.05, T.clockZ0, T.clockZ1, C.plank, 1.2);
  // the clock's movement behind its dial: the iron frame, the wheels, the pendulum and the weights down a shaft
  box(k, -0.5, 0.5, ly(10.6), ly(11.6), -0.25, 0.35, C.iron, 1.0);
  box(k, -0.45, 0.45, ly(10.0), ly(10.6), 0.0, 0.3, C.oak, 1.0);
  for (const x of [-0.25, 0.1, 0.3]) k.cyl(0.14, 0.14, 0.02, x, ly(11.1), -0.28, C.brass, { seg: 10, rx: Math.PI / 2 });
  k.box(0.02, 1.4, 0.02, 0, ly(10.9), 0.45, C.brass);
  k.cyl(0.1, 0.1, 0.03, 0, ly(10.15), 0.45, C.brass, { seg: 10, rx: Math.PI / 2 });
  for (const x of [-0.3, 0.3]) k.cyl(0.08, 0.08, 0.5, x, ly(10.2), 0.2, C.iron, { seg: 8 });
  // the bartizans: small dark turrets off the clock room, lined behind the shell's ten faces (their slits cut through)
  for (const s of [-1, 1] as const) {
    const cx = s * 4.2;
    const cz = -0.6;
    const R0 = 0.75;
    const r = 0.5;
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a0 = (2 * Math.PI * i) / n;
      const a1 = (2 * Math.PI * (i + 1)) / n;
      const am = (a0 + a1) / 2;
      // not the faces within the tower's corner (the tower's own walls stand there)
      if (s * Math.cos(am) < -0.3 && Math.sin(am) > 0.3) continue;
      const face = F([cx + R0 * Math.cos(a0), cz + R0 * Math.sin(a0)], [cx + R0 * Math.cos(a1), cz + R0 * Math.sin(a1)], [Math.cos(am), Math.sin(am)]);
      line(k, C.blue, { face, from: 0.25, to: 0.3, y0: 9.9, y1: 14.4 }, 1.0);
    }
    // the tower's faces inside it, lined 2 cm off (so the turret is one room)
    for (const q of [
      [[cx, ly(9.9), cz - 0.02], [cx - s * r, ly(9.9), cz - 0.02], [cx - s * r, ly(14.4), cz - 0.02], [cx, ly(14.4), cz - 0.02]],
      [[cx + s * 0.02, ly(9.9), cz + r], [cx + s * 0.02, ly(9.9), cz], [cx + s * 0.02, ly(14.4), cz], [cx + s * 0.02, ly(14.4), cz + r]],
    ] as Array<Array<[number, number, number]>>) {
      quad(k, C.blue, q, 1.0);
      quad(k, C.blue, [...q].reverse(), 1.0);
    }
    k.cyl(r, r, 0.05, cx, ly(9.9), cz, C.boards, { seg: n });
    k.cyl(r, r, 0.05, cx, ly(14.35), cz, C.plank, { seg: n });
  }

  // ---- the link: its linings, the ground floor, the landing over it with its stair and the steps to the records room
  const lz0 = T.z1 + 0.28;
  const lz1 = 13.5;
  for (const s of [-1, 1] as const)
    line(k, C.wash, { face: F([s * 2.8, 9], [s * 2.8, 15], [s, 0]), u0: lz0 - 9, u1: lz1 - 9, from: 0.3, to: 0.6, y0: FY, y1: 7.3 });
  box(k, -I.linkHW, I.linkHW, -0.05, 0, I.passEnd, I.linkEnd, C.flags, 1.6);
  box(k, -I.linkHW, I.linkHW, 0.0, 1.4, lz0, lz0 + 0.02, C.dado, 1.6);
  const LS = I.linkStair;
  const g1 = PP.LV.g1;
  // the landing's floor round the stair's well
  box(k, -I.linkHW, LS.x0, g1 - 0.1, g1, lz0, I.linkZ1, C.boards, 1.2);
  box(k, LS.x0, I.linkHW, g1 - 0.1, g1, lz0, LS.z0, C.boards, 1.2);
  box(k, -1.0, 1.0, g1 - 0.1, g1, I.linkZ1, I.linkEnd, C.boards, 1.2);
  box(k, -I.linkHW, I.linkHW, 7.1, 7.2, lz0, lz1, C.vault, 2.0);
  flight(k, "z", LS.z1, LS.z0, 0, g1, LS.x0, LS.x1);
  railing(k, [LS.x0, LS.z0], [LS.x0, LS.z1], g1);
  const TS = I.towerSteps;
  flight(k, "z", TS.z1, TS.z0, g1, ty, TS.x0, TS.x1, 0.2);
  k.box(0.04, 0.04, 0.3, I.linkHW - 0.15, 2.3, 11.3, C.brass);
  flames.addFlame(I.linkHW - 0.3, 2.38, 11.3);
  k.box(0.02, 0.6, 0.45, -I.linkHW + 0.03, 1.7, 10.8, C.bill);

  // ================================================================ the watch pavilion
  const kp = kP;
  const pz = I.pavZ;
  const Rout = PP.PARTS.pavilion.r; // the shell's circumradius
  const apoOut = Rout * Math.cos(Math.PI / 8);
  const inner = apoOut - I.pavR;
  const oc = (i: number): P2 => [Rout * Math.cos(Math.PI / 8 + (i * Math.PI) / 4), pz + Rout * Math.sin(Math.PI / 8 + (i * Math.PI) / 4)];
  for (let i = 0; i < 8; i++) {
    const a = oc(i);
    const c = oc(i + 1);
    const mx = (a[0] + c[0]) / 2;
    const mz = (a[1] + c[1]) / 2 - pz;
    const L_ = Math.hypot(mx, mz);
    const n: P2 = [mx / L_, mz / L_];
    const face = F(a, c, n);
    const Lf = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const along = (x: number, z: number) => ((x - a[0]) * (c[0] - a[0]) + (z - a[1]) * (c[1] - a[1])) / Lf;
    const doors: Array<{ u0: number; u1: number; top: number }> = [];
    const holes: Array<Array<[number, number]>> = [];
    if (Math.abs(n[0]) > 0.9) {
      // to a wing: the corridor's width, up to the top cells' ceiling
      const u0 = along(n[0] * apoOut, PP.IN.wing.corrS);
      const u1 = along(n[0] * apoOut, PP.IN.wing.corrN);
      doors.push({ u0: Math.min(u0, u1), u1: Math.max(u0, u1), top: 10.7 });
    } else if (n[1] < -0.9) {
      // to the link: its ground floor, and the landing's door onto the first gallery
      doors.push({ u0: along(-I.linkHW, 0), u1: along(I.linkHW, 0), top: 3.6 });
      const [h0, h1] = [along(-1.0, 0), along(1.0, 0)];
      holes.push([[h0, 3.7], [h1, 3.7], [h1, 5.9], [h0, 5.9]]);
    }
    line(kp, C.wash, { face, from: 0.4, to: inner, y0: FY, y1: FY + I.pavTop, doors, holes });
    line(kp, C.dado, { face, from: inner, to: inner + 0.02, y0: FY, y1: FY + 1.4, doors: doors.map((d) => ({ ...d, u0: d.u0 - 0.02, u1: d.u1 + 0.02 })) });
  }
  // the floor, the galleries round (an octagonal ring with its railing), the ceiling with the lantern's light
  const pr = I.pavR / Math.cos(Math.PI / 8);
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
    kp.add(g, def, 0, 0, 0, { flat: true });
  };
  oct(pr, 0.002, C.flags);
  const ri = (I.pavR - I.pavGalleryW) / Math.cos(Math.PI / 8);
  for (const y of I.galleries) {
    const ring = new THREE.Shape();
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      if (i === 0) ring.moveTo(pr * Math.cos(a), pr * Math.sin(a));
      else ring.lineTo(pr * Math.cos(a), pr * Math.sin(a));
    }
    const hole = new THREE.Path();
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
    kp.add(g, C.plank, 0, 0, 0, { flat: true });
    for (let i = 0; i < 8; i++) {
      const a0 = Math.PI / 8 + (i * Math.PI) / 4;
      const a1 = a0 + Math.PI / 4;
      const p0: P2 = [ri * Math.cos(a0), pz + ri * Math.sin(a0)];
      const p1: P2 = [ri * Math.cos(a1), pz + ri * Math.sin(a1)];
      const Lr = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const ry = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) + Math.PI / 2;
      kp.box(Lr, 0.14, 0.05, (p0[0] + p1[0]) / 2, y - 0.14, (p0[1] + p1[1]) / 2, C.ironPaint, { ry });
      railing(kp, p0, p1, y);
      // brackets under the ring
      const bx = (p0[0] + p1[0]) / 2;
      const bz = (p0[1] + p1[1]) / 2;
      const ox = bx / Math.hypot(bx, bz - pz);
      const oz = (bz - pz) / Math.hypot(bx, bz - pz);
      kp.box(0.05, 0.05, Math.hypot(I.pavGalleryW, 0.8), bx + ox * I.pavGalleryW * 0.5, y - 0.5, bz + oz * I.pavGalleryW * 0.5, C.ironPaint, { ry: Math.atan2(ox, oz), rx: Math.atan2(0.8, I.pavGalleryW) });
    }
    // where the ring meets a wing: a rail across the corridor's void between its two galleries
    for (const s of [-1, 1]) railing(kp, [s * I.pavR, I.wing.corrS + I.galleryW], [s * I.pavR, I.wing.corrN - I.galleryW], y);
  }
  oct(pr + 0.2, I.pavTop, C.vault);
  kp.cyl(1.4, 1.4, 0.05, 0, I.pavTop - 0.06, pz, C.glow, { seg: 8 });
  // the platform and the chief warder's desk, his book, the bell; the big clock over the link's arch, above the second gallery
  box(kp, -1.3, 1.3, 0, 0.38, 18.0, 20.0, C.oak, 1.2);
  box(kp, -1.0, 1.0, 0.38, 1.35, 18.2, 18.7, C.oak, 1.2);
  box(kp, -1.05, 1.05, 1.35, 1.4, 18.1, 18.9, C.plank, 1.2);
  box(kp, -0.4, 0.3, 1.4, 1.46, 18.3, 18.75, C.ledger);
  kp.cyl(0.07, 0.09, 0.1, 0.7, 1.4, 18.5, C.brass, { seg: 8 });
  const clockY = 9.6;
  const cz = pz - I.pavR + 0.23;
  kp.cyl(0.55, 0.55, 0.08, 0, clockY - 0.04, cz, C.paper_, { seg: 16, rx: Math.PI / 2 });
  kp.cyl(0.6, 0.6, 0.06, 0, clockY - 0.03, cz - 0.03, C.oak, { seg: 16, rx: Math.PI / 2 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    kp.box(i % 3 ? 0.03 : 0.05, i % 3 ? 0.08 : 0.11, 0.006, Math.sin(a) * 0.44, clockY + Math.cos(a) * 0.44, cz + 0.043, C.ironPaint, { rz: -a });
  }
  addDial(group, { at: [0, clockY, cz + 0.04], normal: [0, 0, 1], radius: 0.55, lift: 0.01, mat: matOf(C.ironPaint), minute: 0.8, hour: 0.52, width: 0.12, kind: "prison hall clock", where: "the prison's watch pavilion, over the link's arch" });

  // ================================================================ the cell wings
  const wingLights: THREE.PointLight[] = [];
  for (const wing of ["A", "B"] as const) buildWing(wing === "A" ? kA : kB, wing, flames, windows, box);

  kF.finish();
  kP.finish();
  kA.finish();
  kB.finish();

  // ---- the glass of every window the prison's rooms stand behind (the shell has the bars)
  const glassMat = new THREE.MeshBasicMaterial({ color: 0xa8b4bc, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  const gg = glassPanes(windows, FY);
  if (gg) {
    const gm = new THREE.Mesh(gg, glassMat);
    gm.name = "prison_glass";
    gm.userData.glass = true;
    gm.renderOrder = 5;
    group.add(gm);
  }

  // ---- lights: daylight from the roof lights and windows, the lamps, the gas at dusk (at most ROOM_POINT_LIGHTS)
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
  wingLights.push(pt(0xffc080, 16, 3.0, 19.5, 16), pt(0xffc080, -16, 3.0, 19.5, 16));
  const officeL = pt(0xffb870, -6.4, oy + 2.2, 4.4, 9);
  const dayFill = pt(0xd8dce0, 0, 12, 19.5, 44);
  const pavFill = pt(0xd8dce0, 0, 14, 19, 26);
  let day = 1;
  let sky = 1;
  let ambK = 1;
  let lit = PP.prisonLights(1, 12);
  let dusk = 0;
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    // (whitewash in grey daylight; from the bright street (ambK under 1) the rooms look dim through their windows)
    hemi.intensity = (0.9 + 1.3 * d) * ambK;
    amb.intensity = (0.45 + 0.25 * day) * ambK;
    dayFill.intensity = 6 * d * ambK;
    pavFill.intensity = 5 * d * ambK;
    (matOf(C.glow) as THREE.MeshBasicMaterial).color.setScalar(0.12 + 0.75 * day * sky);
  };
  const warm = new THREE.Color(0xffb060);
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
      // (from the bright street by day the prison's rooms look darker still than a house's: grey stone, small panes)
      ambK = a * a;
      light();
    },
    update(t) {
      flames.update(t);
      // the gas: the cells' till lights out, the corridors' and the pavilion's all night (low), the guard room's always
      flames.points.visible = dusk > 0.05;
      passL.intensity = 2.4 * flicker(t, 1.1);
      guardL.intensity = 2.8 * flicker(t, 2.3) * (0.4 + 0.6 * lit.guard);
      visitL.intensity = 2.2 * flicker(t, 3.1) * (1 - dusk * 0.8);
      pavL.intensity = (2 + 4 * dusk * lit.corridors) * flicker(t, 1.7);
      for (const [i, l] of wingLights.entries()) l.intensity = (1.5 + 5 * dusk * lit.corridors) * flicker(t, 2.9 + i);
      officeL.intensity = 3.0 * dusk * lit.offices * flicker(t, 4.1);
      room.lamps = [
        { p: toWorld(0, 4.5, 4.6), w: 0.18 * flicker(t, 1.1) },
        { p: toWorld(-6.6, 1.3, 3.7), w: 0.2 * flicker(t, 2.3) },
        { p: toWorld(6.8, 3.2, 4.0), w: 0.16 * flicker(t, 3.1) },
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return {
    room,
    windows,
    glass: glassMat,
    night(l, dk) {
      lit = l;
      dusk = dk;
      // each part's own glow at night (its gas seen through its windows): emissive, never a light more
      (matOf(C.cellWash) as THREE.MeshLambertMaterial).emissive.copy(warm).multiplyScalar(0.22 * dk * l.cells);
      (matOf(C.office) as THREE.MeshLambertMaterial).emissive.copy(warm).multiplyScalar(0.18 * dk * l.offices);
    },
  };
}

/** One wing's inside (A at +x, B its mirror): corridor, galleries, stairs, every cell, the yard passage. */
function buildWing(k: Kit, wing: "A" | "B", flames: Flames, windows: ShellOpening[], box: (k: Kit, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile?: number, tint?: number) => void): void {
  const sg = wing === "A" ? 1 : -1;
  const X = (x: number) => sg * x;
  const Wn = PP.IN.wing;
  const I = PP.IN;
  const xa = Wn.xa;
  const xb = Wn.x1;
  const bx = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.0, tint?: number) => box(k, Math.min(X(x0), X(x1)), Math.max(X(x0), X(x1)), y0, y1, z0, z1, m, tile, tint);
  const line = (def: MatDef, L: Parameters<typeof lining>[2]) => lining(k, def, L, windows, FY);
  const slope = Math.tan((33 * Math.PI) / 180);
  const zc = (PP.PARTS.wingA.z0 + PP.PARTS.wingA.z1) / 2;
  const yr = PP.PARTS.wingA.h + slope * ((PP.PARTS.wingA.z1 - PP.PARTS.wingA.z0) / 2);
  /** The boarded ceiling under the roof (world y), a little under the slate's underside. */
  const boards = (z: number) => yr - Math.abs(z - zc) * slope - 0.2 - 0.04;
  const cellTop = 10.9; // the top cells' slab's top (world): the roof's space over it
  const S = PP.PARTS.wingA;

  // ---- the outer walls: each storey's lining of the south and north faces (their cells' windows), the end
  for (const [zf, n] of [[S.z0, -1], [S.z1, 1]] as Array<[number, 1 | -1]>) {
    const face = F([0, zf], [X(S.x1), zf], [0, n]);
    for (let s = 0; s < 3; s++) line(C.cellWash, { face, u0: 5.85, u1: 28.12, from: 0.28, to: 0.6, y0: FY + 3.6 * s, y1: s === 2 ? cellTop : FY + 3.6 * (s + 1) });
  }
  const endFace = F([X(S.x1), S.z0], [X(S.x1), S.z1], [sg, 0]);
  line(C.cellWash, { face: endFace, u0: 0.28, u1: Wn.corrS - 0.3 - S.z0, from: 0.28, to: 0.6, y0: FY, y1: cellTop });
  line(C.cellWash, { face: endFace, u0: Wn.corrN + 0.3 - S.z0, u1: S.z1 - S.z0 - 0.28, from: 0.28, to: 0.6, y0: FY, y1: cellTop });
  // the corridor's end: its two windows, then the gable over the eaves with the oculus (lined to the boards)
  line(C.wash, { face: endFace, u0: Wn.corrS - 0.3 - S.z0, u1: Wn.corrN + 0.3 - S.z0, from: 0.28, to: 0.6, y0: FY, y1: S.h });
  const gu = (z: number) => z - S.z0;
  line(C.wash, {
    face: endFace,
    u0: gu(Wn.corrS - 0.3),
    u1: gu(Wn.corrN + 0.3),
    from: 0.02,
    to: 0.6,
    y0: S.h,
    y1: boards(zc),
    top: [[gu(Wn.corrS - 0.3), boards(Wn.corrS - 0.3)], [gu(zc), boards(zc)], [gu(Wn.corrN + 0.3), boards(Wn.corrN + 0.3)]],
  });

  // ---- the corridor's floor, the cell fronts either side (a door on every storey), the boarded roof and its lights
  bx(I.pavR, xb, -0.05, 0, Wn.corrS, Wn.corrN, C.flags, 1.6);
  const fronts: Array<["S" | "N", number, 1 | -1]> = [["S", Wn.corrS - 0.15, 1], ["N", Wn.corrN + 0.15, -1]];
  for (const [row, zf, side] of fronts) {
    const ops: Hole[] = [];
    const wins: Hole[] = [];
    for (let kk = 0; kk < PP.CELLS.length; kk++) {
      const cx = PP.CELLS[kk];
      for (let s = 0; s < 3; s++) {
        const yard = PP.isYardPassage(row, s, kk);
        const hw = yard ? PP.YARD_DOOR.hw : 0.4;
        const u = cx - xa;
        if (s === 0) ops.push({ u0: u - hw, u1: u + hw, y0: 0, spring: yard ? PP.YARD_DOOR.spring : 1.9, round: yard });
        else wins.push({ u0: u - 0.4, u1: u + 0.4, y0: 3.6 * s, spring: 3.6 * s + 1.9 });
      }
    }
    // (panel's u runs from its first point: mirror the openings where it runs from the far end)
    const L = xb - xa;
    const flip = (o: Hole): Hole => ({ ...o, u0: L - o.u1, u1: L - o.u0 });
    const a: P2 = [X(xa), zf];
    const c: P2 = [X(xb), zf];
    const fromFar = sg * side < 0; // panel's left side must face the corridor: pick the run's way so it does
    const [pa, pc] = fromFar ? [c, a] : [a, c];
    wall(k, pa, pc, ly(boards(zf + side * 0.15)) - 0.005, fromFar ? ops.map(flip) : ops, fromFar ? wins.map(flip) : wins, 0.3, 1.4);
    for (let kk = 0; kk < PP.CELLS.length; kk++)
      for (let s = 0; s < 3; s++) {
        if (PP.isYardPassage(row, s, kk)) continue;
        const open = s === 0 && PP.OPEN_CELLS.some((o) => o.wing === wing && o.row === row && Math.abs(o.x - PP.CELLS[kk]) < 0.2);
        cellDoor(k, X(PP.CELLS[kk]), zf + side * 0.15, 3.6 * s, side, open, !open && (kk * 3 + s * 5 + (row === "S" ? 1 : 0)) % 4 === 0);
      }
  }
  // the boards under the roof: either slope, leaving the roof lights open (their glass is the rooms': glassPanes)
  const rl0 = 6.4;
  const rl1 = S.x1 - 1.2;
  const strips: Array<[number, number, number, number]> = [];
  for (const s of [-1, 1]) {
    const zs = s < 0 ? [Wn.corrS, zc - 1.4, zc - 0.2, zc] : [zc, zc + 0.2, zc + 1.4, Wn.corrN];
    strips.push([xa, xb, zs[0], zs[1]], [xa, rl0, zs[1], zs[2]], [rl1, xb, zs[1], zs[2]], [xa, xb, zs[2], zs[3]]);
  }
  for (const [x0, x1, z0, z1] of strips) {
    const p = (x: number, z: number): [number, number, number] => [X(x), ly(boards(z)), z];
    quad(k, C.vault, [p(x0, z0), p(x1, z0), p(x1, z1), p(x0, z1)]);
  }
  // purlins and the roof lights' iron bars seen from below
  for (let x = xa + 0.6; x < xb; x += 1.4) for (const s of [-1, 1]) bx(x - 0.06, x + 0.06, ly(boards(zc + s * 0.8)) - 0.14, ly(boards(zc + s * 0.8)) - 0.02, zc + s * 0.8 - 0.06, zc + s * 0.8 + 0.06, C.oak, 1.0);

  // ---- the cells: partitions, the storeys' slabs, their floors, their things
  for (const [z0, z1] of [[S.z0 + 0.28, Wn.corrS - 0.3], [Wn.corrN + 0.3, S.z1 - 0.28]] as Array<[number, number]>) {
    for (let kk = 0; kk <= PP.CELLS.length - 1; kk++) {
      const x = 6.0 + 2.8 * kk;
      bx(x - 0.15, x + 0.15, 0, ly(cellTop), z0, z1, C.cellWash, 2.0);
    }
    for (let s = 0; s < 3; s++) bx(5.85, xb, 3.6 * s + I.cellH, 3.6 * s + 3.6, z0, z1, C.vault, 2.0);
    bx(5.85, xb, -0.05, 0, z0, z1, C.flags, 1.2);
  }
  for (const row of ["S", "N"] as const)
    for (let s = 0; s < 3; s++)
      for (let kk = 0; kk < PP.CELLS.length; kk++) {
        if (PP.isYardPassage(row, s, kk)) {
          // the passage to the yard door: flagged, whitewashed, a low vault
          const yd = PP.YARD_DOOR;
          barrel(k, C.vault, X(yd.x), yd.spring, yd.hw + 0.4, yd.z + 0.5, Wn.corrS - 0.3, "z", 8);
          continue;
        }
        const c = PP.cellBox(wing, row, s, kk);
        const occupied = (kk + s * 2 + (row === "N" ? 1 : 0)) % 5 !== 2;
        cellThings(k, c, row, flames, occupied, kk * 7 + s * 3 + (row === "N" ? 11 : 0) + (wing === "B" ? 5 : 0));
      }

  // ---- the galleries over the corridor, the bridges and the landings, the scissor stair
  const gw = I.galleryW;
  for (const [gi, y] of I.galleries.entries()) {
    const landing = gi === 0 ? I.stair.x1 + 0.6 : I.stair.x0 - 0.6;
    for (const [z0, z1, edge] of [[Wn.corrS, Wn.corrS + gw, Wn.corrS + gw], [Wn.corrN - gw, Wn.corrN, Wn.corrN - gw]] as Array<[number, number, number]>) {
      bx(I.pavR, xb, y - 0.06, y, z0, z1, C.plank, 1.2);
      bx(I.pavR, xb, y - 0.2, y - 0.06, edge - 0.025, edge + 0.025, C.ironPaint);
      // the railing, broken where a bridge or a landing joins
      const gaps = [[12.36 - 0.6, 12.36 + 0.6], [landing - 0.6, landing + 0.6]].sort((p, q) => p[0] - q[0]);
      let from: number = I.pavR;
      for (const [g0, g1] of gaps) {
        railing(k, [X(from), edge], [X(g0), edge], y);
        from = g1;
      }
      railing(k, [X(from), edge], [X(xb), edge], y);
      // brackets into the cell fronts
      const zw = edge < zc ? Wn.corrS : Wn.corrN;
      for (let x = I.pavR + 0.7; x < xb; x += 1.4) {
        const dz = edge - zw;
        k.box(0.04, 0.04, Math.hypot(dz, 0.7), X(x), y - 0.45, (edge + zw) / 2, C.ironPaint, { rx: Math.atan2(0.7, Math.abs(dz)) * Math.sign(dz) });
      }
    }
    for (const bxw of [12.36, landing]) {
      bx(bxw - 0.6, bxw + 0.6, y - 0.06, y, Wn.corrS + gw, Wn.corrN - gw, C.plank, 1.2);
      // (the landing's rail on the stair's side stays open where the flights meet it)
      for (const e of [bxw - 0.6, bxw + 0.6]) {
        const toStair = bxw !== 12.36 && Math.abs(e - (gi === 0 ? I.stair.x1 : I.stair.x0)) < 0.01;
        if (toStair) {
          railing(k, [X(e), Wn.corrS + gw], [X(e), I.stair.z0], y);
          railing(k, [X(e), I.stair.z1], [X(e), Wn.corrN - gw], y);
        } else railing(k, [X(e), Wn.corrS + gw], [X(e), Wn.corrN - gw], y);
      }
    }
  }
  flight(k, "x", X(I.stair.x0), X(I.stair.x1), 0, I.galleries[0], I.stair.z0, I.stair.z1);
  flight(k, "x", X(I.stair.x1), X(I.stair.x0), I.galleries[0], I.galleries[1], I.stair.z0, I.stair.z1);
  // gas brackets along the ground floor's fronts and the galleries, lit at dusk
  for (const y of [0, ...I.galleries])
    for (const x of [9.0, 16.5, 23.5]) {
      k.box(0.04, 0.04, 0.3, X(x), y + 2.3, Wn.corrS + 0.15, C.brass);
      flames.addFlame(X(x), y + 2.38, Wn.corrS + 0.3);
    }
  k.box(0.02, 0.6, 0.45, X(xa + 1.2), 1.7, Wn.corrN - 0.03, C.bill);
}

// ================================================================ the chapel

export interface SmallRoomBuilt {
  room: LandmarkRoom;
  windows: ShellOpening[];
  glass: THREE.MeshBasicMaterial;
  night(l: ReturnType<typeof PP.prisonLights>, dusk: number): void;
}

/** The chapel in the west court: the stalls either side of the aisle, the pulpit, the harmonium, the altar in the apse. */
export function buildChapel(): SmallRoomBuilt {
  const P = PP.CHAPEL_PLAN;
  const CY = PP.CHAPEL_FLOOR_Y;
  const cl = (y: number) => y - CY;
  // (built in the prison's frame; its walking plan has a frame of its own: shared/prisonPlan.ts CHAPEL_PLAN)
  const { scene, group, toWorld } = frameRoom(PP.ORIGIN, PP.YAW, 0x2a2622);
  scene.background = null;
  group.position.y = CY;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 12;
  fog.far = 50;
  const k = new Kit(group);
  k.shadeTop = 8;
  const windows = openingsOf("prison_chapel");
  const Ch = PP.CHAPEL;
  const cp = PP.PARTS.chapel;
  const pitch = Math.tan((42 * Math.PI) / 180);
  const yr = cp.h + pitch * ((cp.x1 - cp.x0) / 2);
  const boards = (x: number) => yr - Math.abs(x - Ch.xm) * pitch - 0.2 - 0.04;
  const line = (def: MatDef, L: Parameters<typeof lining>[2]) => lining(k, def, L, windows, CY);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.0) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  // the long sides, the front with its door and the rose over it, the apse
  for (const s of [-1, 1]) {
    const x = s < 0 ? cp.x0 : cp.x1;
    line(C.wash, { face: F([x, cp.z0], [x, Ch.z1], [s, 0]), u0: 0.3, u1: Ch.z1 - cp.z0, from: 0.3, to: 0.6, y0: CY, y1: boards(s < 0 ? Ch.x0 : Ch.x1) });
  }
  const front = F([cp.x0, cp.z0], [cp.x1, cp.z0], [0, -1]);
  const fu = (x: number) => x - cp.x0;
  line(C.wash, { face: front, u0: fu(Ch.x0), u1: fu(Ch.x1), from: 0.3, to: 0.6, y0: CY, y1: cp.h });
  line(C.wash, { face: front, u0: fu(Ch.x0), u1: fu(Ch.x1), from: 0.02, to: 0.6, y0: cp.h, y1: boards(Ch.xm), top: [[fu(Ch.x0), boards(Ch.x0)], [fu(Ch.xm), boards(Ch.xm)], [fu(Ch.x1), boards(Ch.x1)]] });
  // the back over the apse's arch (the nave's whole width opens into the apse under it)
  const apseTop = 7.5;
  const backF = F([cp.x0, Ch.z1], [cp.x1, Ch.z1], [0, 1]);
  line(C.wash, { face: backF, u0: fu(Ch.x0), u1: fu(Ch.x1), from: 0.02, to: 0.3, y0: apseTop, y1: boards(Ch.xm), top: [[fu(Ch.x0), boards(Ch.x0)], [fu(Ch.xm), boards(Ch.xm)], [fu(Ch.x1), boards(Ch.x1)]] });
  const ar = (cp.x1 - cp.x0) / 2;
  const ap = (i: number): P2 => [Ch.xm - ar * Math.cos((Math.PI * i) / 4), Ch.z1 + ar * Math.sin((Math.PI * i) / 4)];
  const apo = ar * Math.cos(Math.PI / 8);
  const innerApo = Ch.apseR * Math.cos(Math.PI / 8);
  for (let i = 0; i < 4; i++) {
    const a = ap(i);
    const c = ap(i + 1);
    const mx = (a[0] + c[0]) / 2 - Ch.xm;
    const mz = (a[1] + c[1]) / 2 - Ch.z1;
    const L_ = Math.hypot(mx, mz);
    line(C.wash, { face: F(a, c, [mx / L_, mz / L_]), from: 0.25, to: apo - innerApo, y0: CY, y1: apseTop });
  }
  // floors, the boarded roof, the apse's ceiling
  box(Ch.x0, Ch.x1, -0.05, 0, Ch.z0 - 0.3, Ch.z1, C.boards, 1.2);
  box(Ch.x1, Ch.side.reveal, -0.05, 0, Ch.side.z - Ch.side.hw - 0.02, Ch.side.z + Ch.side.hw + 0.02, C.flags, 1.2);
  const aIn = (i: number): P2 => [Ch.xm - Ch.apseR * Math.cos((Math.PI * i) / 4), Ch.z1 + Ch.apseR * Math.sin((Math.PI * i) / 4)];
  for (const [y, def] of [[0.001, C.flags], [cl(apseTop), C.vault]] as Array<[number, MatDef]>) {
    const sh = new THREE.Shape();
    sh.moveTo(Ch.x0, -Ch.z1);
    for (let i = 0; i <= 4; i++) sh.lineTo(aIn(i)[0], -aIn(i)[1]);
    const g = new THREE.ShapeGeometry(sh, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    planarUV(g, 1.6);
    k.add(g, def, 0, 0, 0, { flat: true });
  }
  for (const s of [-1, 1]) {
    const xe = s < 0 ? Ch.x0 : Ch.x1;
    quad(k, C.vault, [[xe, cl(boards(xe)), Ch.z0 - 0.3], [Ch.xm, cl(boards(Ch.xm)), Ch.z0 - 0.3], [Ch.xm, cl(boards(Ch.xm)), Ch.z1], [xe, cl(boards(xe)), Ch.z1]]);
  }
  // the roof's tie beams
  for (let z = Ch.z0 + 1.2; z < Ch.z1; z += 2.4) box(Ch.x0, Ch.x1, cl(boards(Ch.x0)) - 0.25, cl(boards(Ch.x0)) - 0.05, z - 0.1, z + 0.1, C.oak, 1.2);
  // the prisoners' stalls: tiered rows either side of the aisle, each man in his box, seeing only the altar
  for (const [x0, x1] of [[Ch.x0, -18.0], [-16.4, Ch.x1]]) {
    for (let r = 0; r < 5; r++) {
      const z = 3.4 + r * 0.9;
      const y = r * 0.12;
      box(x0, x1, 0, y + 0.05, z, z + 0.9, C.oak, 1.2);
      box(x0, x1, y + 0.4, y + 0.45, z + 0.45, z + 0.8, C.plank, 1.2);
      box(x0, x1, y, y + 1.5, z + 0.85, z + 0.9, C.oak, 1.2);
      for (let x = x0; x <= x1 + 0.01; x += (x1 - x0) / 3) box(x - 0.02, x + 0.02, y, y + 1.6, z, z + 0.9, C.oak, 1.2);
    }
  }
  // the pulpit, the harmonium, the rail, the altar with its cross and candlesticks
  box(-20.2, -19.4, 0, 1.2, 8.2, 9.0, C.oak, 1.2);
  box(-20.3, -19.3, 1.2, 1.3, 8.1, 9.1, C.plank, 1.2);
  box(-20.3, -19.4, 0, 0.95, 9.4, 10.0, C.oak, 1.2);
  box(-20.3, -20.1, 0.95, 1.2, 9.4, 10.0, C.oak, 1.2);
  box(-19.9, -14.5, 0.75, 0.82, 10.68, 10.76, C.oak, 1.2);
  for (let x = -19.8; x < -14.5; x += 0.45) box(x - 0.02, x + 0.02, 0, 0.75, 10.7, 10.74, C.oak);
  box(-18.2, -16.2, 0, 0.95, 11.8, 12.6, C.linen, 1.0);
  box(-18.3, -16.1, 0.95, 1.0, 11.75, 12.65, C.oak, 1.2);
  box(Ch.xm - 0.03, Ch.xm + 0.03, 1.0, 1.9, 12.4, 12.46, C.brass);
  box(Ch.xm - 0.25, Ch.xm + 0.25, 1.55, 1.61, 12.4, 12.46, C.brass);
  for (const x of [-17.8, -16.6]) k.cyl(0.04, 0.06, 0.45, x, 1.0, 12.3, C.brass, { seg: 6 });
  const flames = new Flames(group, 8, 0.1);
  for (const x of [-17.8, -16.6]) flames.addFlame(x, 1.52, 12.3);
  k.finish();
  // the leaded glass of its windows and its rose
  const glassMat = new THREE.MeshBasicMaterial({ map: glassTex("grisaille", 61), color: 0x8a8e88, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
  const gg = glassPanes(windows, CY);
  if (gg) {
    const gm = new THREE.Mesh(gg, glassMat);
    gm.name = "prison_chapel_glass";
    gm.userData.glass = true;
    gm.renderOrder = 5;
    group.add(gm);
  }
  const hemi = new THREE.HemisphereLight(0xd8d4c8, 0x3a3630, 1.0);
  scene.add(hemi);
  const lampA = new THREE.PointLight(0xffc080, 0, 12, 1.5);
  lampA.position.set(Ch.xm, 4.0, 5.0);
  const lampB = new THREE.PointLight(0xffc080, 0, 9, 1.5);
  lampB.position.set(Ch.xm, 2.0, 11.4);
  group.add(lampA, lampB);
  let day = 1;
  let sky = 1;
  let ambK = 1;
  let on = 0;
  const light = () => {
    hemi.intensity = (1.0 + 1.6 * day * (0.55 + 0.45 * sky)) * ambK;
    // (the glass's own shade by the hour is set from outside: world/prisonHall.ts; lit from within at evening prayers)
    if (on > 0.05) glassMat.color.setScalar(0.35 + 0.5 * on);
  };
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "prison_chapel" as unknown as LandmarkRoom["landmark"],
    // (walk, floor, marks and path are in the plan's own frame)
    scene,
    group,
    walk: (fx, fz, x, z) => (free(x, z) ? [x, z] : [fx, fz]),
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
    pace: 1.2,
    eye: 1.6,
    surface: "wood",
    sound: "church",
    marks: { ...P.marks },
    sets: {},
    looks: [],
    path: walkGraph(P.nodes, free),
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
      flames.points.visible = on > 0.05;
      lampA.intensity = 4 * on * flicker(t, 5.1);
      lampB.intensity = 3 * on * flicker(t, 6.3);
      room.lamps = on > 0.05 ? [{ p: toWorld(Ch.xm, 4.0, 5.0), w: 0.15 * on }] : [];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return {
    room,
    windows,
    glass: glassMat,
    night(l, dk) {
      on = l.chapel * dk;
      light();
    },
  };
}

// ================================================================ the governor's house

/** The governor's house: three storeys of papered rooms, the hall with its stair, the garret behind the dormers. */
export function buildGovernor(): SmallRoomBuilt {
  const P = PP.GOV_PLAN;
  const GY = PP.GOV_FLOOR_Y;
  const gl = (y: number) => y - GY;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x241e18);
  scene.background = null;
  group.position.y = GY;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 8;
  fog.far = 30;
  const k = new Kit(group);
  k.shadeTop = 4;
  const windows = openingsOf("prison_governor");
  const G = PP.GOV;
  const gv = PP.PARTS.governor;
  const line = (def: MatDef, L: Parameters<typeof lining>[2]) => lining(k, def, L, windows, GY);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.0) => k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile });
  const ceil = GY + G.ceil;
  // the four faces' linings (every sash window cut; the doors from the floor)
  line(C.paper, { face: F([gv.x0, gv.z0], [gv.x1, gv.z0], [0, -1]), u0: 0.5, u1: 10.0, from: 0.22, to: 0.5, y0: GY, y1: ceil });
  line(C.paper, { face: F([gv.x0, gv.z0], [gv.x0, gv.z1], [-1, 0]), u0: 0.5, u1: 10.0, from: 0.22, to: 0.5, y0: GY, y1: ceil });
  line(C.paper, { face: F([gv.x0, gv.z1], [gv.x1, gv.z1], [0, 1]), u0: 0.5, u1: 10.0, from: 0.22, to: 0.5, y0: GY, y1: ceil });
  line(C.paper, { face: F([gv.x1, gv.z0], [gv.x1, gv.z1], [1, 0]), u0: 0.5, u1: 10.0, from: 0.22, to: 0.5, y0: GY, y1: ceil });
  // the storeys' floors and ceilings, the partitions with their doors
  const [s0, s1, s2] = G.storeys;
  for (const [y, top] of [[s0, s1 - 0.3], [s1, s2 - 0.3], [s2, G.ceil]]) {
    box(G.x0, G.x1, y - 0.04, y, G.z0, G.z1, C.boards, 1.2);
    box(G.x0, G.x1, top, top + 0.06, G.z0, G.z1, C.vault, 2.0);
    for (const px of G.part) wall(k, [px, G.z0], [px, G.z1], top, [{ u0: 4.0, u1: 4.9, y0: y, spring: y + 2.1 }], [], 0.15, 0, C.paper, y);
    // the carpet in the rooms either side
    box(G.x0 + 0.6, G.part[0] - 0.6, y, y + 0.01, G.z0 + 0.6, G.z1 - 0.6, C.carpet, 1.0);
    box(G.part[1] + 0.6, G.x1 - 0.6, y, y + 0.01, G.z0 + 0.6, G.z1 - 0.6, C.carpet, 1.0);
  }
  // the hall's stair up the storeys (along its back half)
  flight(k, "z", 5.0, 9.4, s0, s1, -28.4, -27.3, 0.2);
  flight(k, "z", 9.4, 5.0, s1, s2, -27.2, -26.1, 0.2);
  // his office (west, ground): the desk, the chair, the bookcase, the fire; the parlour (east): sofa, table, the piano
  box(-24.8, -23.2, 0.76, 0.8, 5.6, 6.8, C.oak, 1.2);
  box(-24.7, -23.3, 0, 0.76, 5.7, 6.7, C.oak, 1.2);
  box(-25.6, -23.2, 0, 2.3, G.z1 - 0.45, G.z1 - 0.05, C.oak, 1.2);
  for (let i = 0; i < 5; i++) box(-25.5, -23.3, 0.3 + i * 0.42, 0.62 + i * 0.42, G.z1 - 0.4, G.z1 - 0.1, C.ledger, 0.5);
  box(G.x1 - 0.3, G.x1, 0, 1.2, 3.8, 5.2, C.blue, 1.0);
  box(G.x1 - 0.35, G.x1 - 0.25, 0.1, 0.8, 4.1, 4.9, C.dark);
  box(-31.2, -29.4, 0, 0.45, 6.0, 6.8, C.carpet, 1.0);
  box(-31.2, -29.4, 0.45, 0.9, 6.7, 6.9, C.carpet, 1.0);
  box(-30.6, -29.8, 0, 0.72, 4.2, 5.0, C.oak, 1.2);
  box(-31.8, -30.4, 0, 1.2, 8.8, 9.6, C.black, 1.0);
  // the bedrooms (first floor) and the children's and the maid's rooms (second): beds, wardrobes, washstands
  for (const [y, beds] of [[s1, 2], [s2, 3]] as Array<[number, number]>) {
    for (let i = 0; i < beds; i++) {
      const x = G.x0 + 0.6 + i * 1.1;
      box(x, x + 0.9, y, y + 0.55, 7.8, 9.8, C.linen, 1.0);
      box(x, x + 0.9, y, y + 1.1, 9.75, 9.85, C.oak, 1.2);
    }
    box(-25.4, -23.4, y, y + 2.0, G.z1 - 0.6, G.z1 - 0.05, C.oak, 1.2);
    box(-24.0, -23.2, y, y + 0.8, 1.0, 1.5, C.oak, 1.0);
    k.cyl(0.18, 0.12, 0.1, -23.6, y + 0.8, 1.25, C.tin, { seg: 8 });
  }
  // the garret behind each dormer: a small lined bay under the roof with a trunk and lumber
  for (const dx of [-25.15, -29.35]) {
    const y0 = gl(gv.h - 0.3 + 0.6);
    const y1 = gl(gv.h - 0.3 + 1.95);
    const z0 = 0.5;
    const z1 = 1.55;
    box(dx - 0.52, dx - 0.5, y0, y1, z0, z1, C.plank, 1.0);
    box(dx + 0.5, dx + 0.52, y0, y1, z0, z1, C.plank, 1.0);
    box(dx - 0.52, dx + 0.52, y0, y1, z1, z1 + 0.02, C.plank, 1.0);
    box(dx - 0.52, dx + 0.52, y0 - 0.04, y0, z0 - 0.4, z1, C.boards, 1.0);
    box(dx - 0.52, dx + 0.52, y1, y1 + 0.03, z0 - 0.4, z1, C.plank, 1.0);
    box(dx - 0.3, dx + 0.2, y0, y0 + 0.4, 1.0, 1.5, C.oak, 0.8);
    line(C.plank, { face: F([dx + 0.6, gv.z0 + 0.4], [dx - 0.6, gv.z0 + 0.4], [0, -1]), u0: 0.08, u1: 1.12, from: 0.12, to: 0.2, y0: gv.h - 0.3 + 0.6, y1: gv.h - 0.3 + 1.95 });
  }
  k.finish();
  const glassMat = new THREE.MeshBasicMaterial({ color: 0xa8b4bc, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide });
  const gg = glassPanes(windows, GY);
  if (gg) {
    const gm = new THREE.Mesh(gg, glassMat);
    gm.name = "prison_governor_glass";
    gm.userData.glass = true;
    gm.renderOrder = 5;
    group.add(gm);
  }
  const hemi = new THREE.HemisphereLight(0xd8d0c0, 0x3a3228, 1.0);
  scene.add(hemi);
  const lamps = [s0, s1, s2].map((y, i) => {
    const l = new THREE.PointLight(0xffb060, 0, 9, 1.5);
    l.position.set(i === 0 ? -24.2 : -30.2, y + 1.2, 5.5);
    group.add(l);
    return l;
  });
  let day = 1;
  let ambK = 1;
  let on = 0;
  const light = () => {
    hemi.intensity = (0.8 + 1.4 * day) * ambK;
  };
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "prison_governor" as unknown as LandmarkRoom["landmark"],
    scene,
    group,
    walk: (fx, fz) => [fx, fz],
    floor: () => 0,
    peopleFloor: () => 0,
    seats: [],
    stands: [],
    exit: { ...P.marks.door, yaw: Math.PI },
    entry: { x: G.door.x, z: 1.2, yaw: 0 },
    entries: {},
    exits: {},
    lamps: [],
    toWorld,
    pace: 1.2,
    eye: 1.6,
    surface: "wood",
    sound: "room",
    marks: { ...P.marks },
    sets: {},
    looks: [],
    path: (from, to) => [from, to],
    setDaylight(kd) {
      day = kd;
      light();
    },
    setAmbient(a) {
      ambK = a;
      light();
    },
    update(t) {
      lamps.forEach((l, i) => (l.intensity = 3.2 * on * (i === 0 ? 1 : 0.7) * flicker(t, 7 + i)));
      room.lamps = on > 0.05 ? [{ p: toWorld(-24.2, 1.2, 5.5), w: 0.14 * on }] : [];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return {
    room,
    windows,
    glass: glassMat,
    night(l, dk) {
      on = l.governor * dk;
      (matOf(C.paper) as THREE.MeshLambertMaterial).emissive.set(0xffb060).multiplyScalar(0.16 * on);
    },
  };
}
