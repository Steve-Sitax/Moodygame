import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import * as CP from "../../../shared/carolusPlan";
import { canvasTex, flicker, frameRoom, rand } from "./rooms";
import { Flames, Kit, lmMat, marble, matOf, painting, type MatDef } from "./landmarkKit";
import { M, paintMat, walkGraph, type LandmarkRoom } from "./landmarkRooms";
import { buildHallSun } from "./hallSun";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import { withPicture } from "./quayStone";
import { SHELL_OPENINGS, type ChurchOpening } from "../../../shared/churchesShell";
import { inFrame, type ShellFace } from "../../../shared/shellOpening";
import { lining, windowOpenings, type Lining } from "./realOpenings";
import { CHURCH_INSIDE_REACH, churchGlass, sunWindowsOf } from "./churches";
import { buildChurchSpaces } from "./churchSpaces";
import type { World } from "./rijnkaai";
import type { InWorld } from "./inworld";

// Sint-Carolus Borromeus inside (M7, docs/milestones/M7-carolus.md): the Jesuits' church as it stood in 1873,
// standing in the world inside its Blender shell (tools/blender/build_churches.py carolus(), CF OPEN) and walked
// in by its plan (shared/carolusPlan.ts), the halls' way (world/hallInWorld.ts). After the 1718 fire: grey stone
// columns, Doric below and Ionic on the galleries, round arches, a white barrel vault with broad transverse
// arches where Rubens's ceilings had been, flat stucco ceilings over the galleries. The organ on its loft over
// the door, carved oak confessionals with angels between them along the aisles, Van Baurscheit's oak pulpit on a
// column, rush chairs in rows, the marble communion rail before the raised choir, the marble high altar with its
// tall painting (the frame of the painting-change machine) in the round apse; the Lady Chapel off the south aisle
// in coloured marble with its white rail. Black and white marble on the floor. Pictures: Codex textures for the
// oak, the stucco and the marble panels (assets/ATTRIBUTION.md); the paintings and the floor are painted in code
// until their pictures can be made.

export const PIC = (url: string, fallback: THREE.Texture): THREE.Texture => {
  fallback.minFilter = THREE.LinearMipmapLinearFilter;
  fallback.magFilter = THREE.NearestFilter;
  fallback.generateMipmaps = true;
  fallback.anisotropy = 4;
  fallback.wrapS = fallback.wrapT = THREE.RepeatWrapping;
  return withPicture(fallback, url);
};
const flat = (c: string) => canvasTex(8, 8, (g) => {
  g.fillStyle = c;
  g.fillRect(0, 0, 8, 8);
});

/** The floor: black and white marble slabs laid diagonally, painted here until the picture (carolus_floor.jpg) has loaded. */
function floorTex(): THREE.CanvasTexture {
  const r = rand(1621);
  const t = canvasTex(128, 128, (g) => {
    const s = 32;
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const k = (Math.floor((x + y) / s) + Math.floor((x - y + 128) / s)) % 2;
        const n = 0.9 + r() * 0.12;
        const c = k ? [214 * n, 208 * n, 196 * n] : [34 * n, 32 * n, 34 * n];
        g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
        g.fillRect(x, y, 1, 1);
      }
    // veins, and the joints
    g.strokeStyle = "rgba(90,86,88,0.35)";
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = r() * 128;
      let y = r() * 128;
      g.moveTo(x, y);
      for (let j = 0; j < 8; j++) g.lineTo((x += (r() - 0.3) * 12), (y += (r() - 0.5) * 10));
      g.stroke();
    }
    g.strokeStyle = "rgba(20,18,16,0.5)";
    for (let d = -128; d < 256; d += 32) {
      g.beginPath();
      g.moveTo(d, 0);
      g.lineTo(d + 128, 128);
      g.moveTo(d, 128);
      g.lineTo(d + 128, 0);
      g.stroke();
    }
  });
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

/** The Carolus hall's materials (St Paul and St James use some of them: world/gothicHall.ts). */
export const C = {
  floor: lmMat("cb_floor", { map: PIC("/textures/carolus_floor.jpg", floorTex()), color: 0xd8d4cc }, 0.05, 1.0),
  // (bumps from its own picture, 2026-09-26: "churches do not forget bump mapping")
  stone: lmMat("cb_stone", { map: PIC("/textures/carolus_bluestone.jpg", flat("#8a8c8e")), color: 0xc4c4c2 }, 0.05, 1.2),
  plaster: lmMat("cb_plaster", { map: PIC("/textures/carolus_plaster.jpg", flat("#d8d2c4")), color: 0xe8e2d4 }, 0.05),
  vault: lmMat("cb_vault", { map: PIC("/textures/carolus_plaster.jpg", flat("#d8d2c4")), color: 0xece6d8, side: THREE.DoubleSide }, 0.03),
  wash: lmMat("cb_wash", { map: flat("#dcd6c8"), color: 0xe0dacb }, 0),
  oak: lmMat("cb_oak", { map: PIC("/textures/carolus_oak.jpg", flat("#3a2618")), color: 0xb89a80 }, 0.1),
  oakPlain: lmMat("cb_oak_plain", { map: PIC("/textures/carolus_oak.jpg", flat("#3a2618")), color: 0x8a7060 }, 0.1),
  panel: lmMat("cb_marble_panel", { map: PIC("/textures/carolus_marble_panel.jpg", flat("#6a2a20")), color: 0xe0d8d0 }, 0.05),
  marbleW: lmMat("cb_marble_w", { map: marble(false), color: 0xf0ece4 }, 0.05),
  marbleB: lmMat("cb_marble_b", { map: marble(true), color: 0xa0a0a0 }, 0.05),
  gilt: lmMat("cb_gilt", { color: 0xc09a40, emissive: 0x3a2808 }, 0),
  statue: lmMat("cb_statue", { color: 0xe4ddd0, emissive: 0x100e0c }, 0),
  rush: M.rush,
  iron: M.iron,
  brass: M.brass,
  tin: M.tin,
  wax: M.wax,
  red: M.red,
  dark: lmMat("cb_dark", { color: 0x121010 }, 0),
};

/** A painting (a Codex picture; the painted stand-in until it loads): dark, but it reads in the gloom as varnish catches the candles. */
const picture = (key: string, url: string, stand: Parameters<typeof painting>[0], seed: number, flip = false): MatDef => {
  const t = PIC(url, painting(stand, seed).clone());
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (flip) {
    t.repeat.x = -1;
    t.offset.x = 1;
  }
  return lmMat(key, { map: t, emissiveMap: t, emissive: 0x5a4c3c, color: 0xc8c0b0 }, 0);
};
const P_ALTAR = picture("cb_paint_altar", "/textures/carolus_paint_altar.jpg", "assumption", 21);
const P_LADY = picture("cb_paint_lady", "/textures/carolus_paint_lady.jpg", "assumption", 41);
const P_SIDE = picture("cb_paint_side", "/textures/carolus_paint_side.jpg", "saint", 22);
const P_SIDE2 = picture("cb_paint_side2", "/textures/carolus_paint_side.jpg", "saint", 23, true);

export type Hole = { u0: number; u1: number; y0: number; spring: number; round?: boolean };

/** Round or square heads as points from the left springing over the top to the right one (u, y). */
function head(h: Hole, n = 10): Array<[number, number]> {
  const r = (h.u1 - h.u0) / 2;
  const c = (h.u0 + h.u1) / 2;
  if (!h.round) return [[h.u0, h.spring], [h.u1, h.spring]];
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = Math.PI - (Math.PI * i) / n;
    return [c + r * Math.cos(a), h.spring + r * Math.sin(a)] as [number, number];
  });
}

/** Planar texture co-ordinates in metres by each face's normal (world frame of the room). */
export function planarUV(g: THREE.BufferGeometry, tile: number): void {
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i));
    const ny = Math.abs(nrm.getY(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const [u, v] = ny > 0.6 ? [x, z] : nx > 0.6 ? [z, y] : nx > 0.2 ? [x * 0.7 + z * 0.7, y] : [x, y];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

/**
 * A wall from a to c (room frame x, z) between y0 and y1, `t` thick (centred on the line), its openings from the
 * floor (doorways, arches: they cut the bottom edge) and its windows (holes), round or square headed.
 * `scallop`: arches between piers cut from the bottom edge (an arcade: the wall stands on the columns).
 */
export function panel(k: Kit, def: MatDef, a: [number, number], c: [number, number], y0: number, y1: number, t: number, openings: Hole[], windows: Hole[], tile = 2.4, tint?: number): void {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const s = new THREE.Shape();
  s.moveTo(0, y0);
  for (const o of [...openings].sort((p, q) => p.u0 - q.u0)) {
    s.lineTo(o.u0, y0);
    for (const [u, y] of head(o)) s.lineTo(u, y);
    s.lineTo(o.u1, y0);
  }
  s.lineTo(L, y0);
  s.lineTo(L, y1);
  s.lineTo(0, y1);
  s.lineTo(0, y0);
  for (const w of windows) {
    const p = new THREE.Path();
    p.moveTo(w.u0, w.y0);
    p.lineTo(w.u1, w.y0);
    for (const [u, y] of [...head(w)].reverse()) p.lineTo(u, y);
    p.lineTo(w.u0, w.y0);
    s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 1 });
  const tx = (c[0] - a[0]) / L;
  const tz = (c[1] - a[1]) / L;
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(tx, 0, tz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-tz, 0, tx));
  m.setPosition(a[0] + tz * (t / 2), 0, a[1] - tx * (t / 2));
  g.applyMatrix4(m);
  g.computeVertexNormals();
  planarUV(g, tile);
  k.add(g, def, 0, 0, 0, { tint });
}

/** An arcade's wall along z at x (room frame): scalloped arches between the piers at `piers` (z, half width), from `yb` (the capitals' top) to `yt`. */
function arcade(k: Kit, def: MatDef, x: number, piers: Array<[number, number]>, yb: number, yt: number, t: number): void {
  const z0 = piers[0][0] - piers[0][1];
  const zN = piers[piers.length - 1][0] + piers[piers.length - 1][1];
  const openings: Hole[] = [];
  for (let i = 0; i + 1 < piers.length; i++) openings.push({ u0: piers[i][0] + piers[i][1] - z0, u1: piers[i + 1][0] - piers[i + 1][1] - z0, y0: yb, spring: yb, round: true });
  panel(k, def, [x, z0], [x, zN], yb, yt, t, openings, [], 2.4);
}

/** A half ring (an arch's face) across the nave at z: radii r0..r1 round (0, y), `d` deep along z. */
function archRing(k: Kit, def: MatDef, x: number, y: number, z: number, r0: number, r1: number, d: number, tint?: number): void {
  const s = new THREE.Shape();
  const n = 16;
  s.moveTo(r1, -0.06); // (its feet go a little way down into the cornice it stands on)
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * i) / n;
    s.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
  }
  s.lineTo(-r1, -0.06);
  s.lineTo(-r0, -0.06);
  for (let i = n; i >= 0; i--) {
    const a = (Math.PI * i) / n;
    s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  s.lineTo(r0, -0.06);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 1 });
  g.translate(x, y, z - d / 2);
  g.computeVertexNormals();
  planarUV(g, 2.4);
  k.add(g, def, 0, 0, 0, { tint, flat: true });
}

/** A column: plinth, base, shaft with a little entasis, Doric or Ionic capital with its abacus; from y0 to y1. */
function column(k: Kit, def: MatDef, x: number, z: number, y0: number, y1: number, r: number, ionic: boolean): void {
  const h = y1 - y0;
  k.box(r * 2.5, 0.22, r * 2.5, x, y0 + 0.11, z, def, { tile: 1.2 });
  k.cyl(r * 1.12, r * 1.18, 0.14, x, y0 + 0.22, z, def, { seg: 10 });
  const sh = h - 0.36 - (ionic ? 0.42 : 0.5);
  k.cyl(r * 0.88, r, sh, x, y0 + 0.36, z, def, { seg: 10, tile: 1.6 });
  const cy = y0 + 0.36 + sh;
  if (ionic) {
    k.cyl(r * 1.05, r * 0.9, 0.16, x, cy, z, def, { seg: 10 });
    k.cyl(0.12, 0.12, r * 2.3, x, cy + 0.24 - r * 1.15, z, def, { seg: 6, rz: Math.PI / 2 });
    k.box(r * 2.7, 0.1, r * 2.7, x, y1 - 0.05, z, def, { tile: 1.2 });
    k.box(r * 2.6, 0.16, r * 1.6, x, cy + 0.24, z, def, { tile: 1.2 });
  } else {
    k.cyl(r * 1.35, r * 0.92, 0.22, x, cy, z, def, { seg: 10 });
    k.box(r * 2.9, y1 - cy - 0.22, r * 2.9, x, (y1 + cy + 0.22) / 2, z, def, { tile: 1.2 });
  }
}

/** A carved figure (a saint, an angel herm): robe, arms, head; oak or white stone. */
export function figure(k: Kit, def: MatDef, x: number, y: number, z: number, h: number, yaw = 0, wings = false): void {
  k.cyl(0.13 * h, 0.2 * h, 0.72 * h, x, y, z, def, { seg: 8 });
  k.cyl(0.1 * h, 0.13 * h, 0.12 * h, x, y + 0.72 * h, z, def, { seg: 8 });
  k.cyl(0.075 * h, 0.075 * h, 0.12 * h, x, y + 0.85 * h, z, def, { seg: 6 });
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  k.box(0.24 * h, 0.07 * h, 0.1 * h, x + fx * 0.12 * h, y + 0.62 * h, z + fz * 0.12 * h, def, { ry: yaw });
  if (wings) for (const s of [-1, 1]) k.box(0.05 * h, 0.5 * h, 0.3 * h, x - fx * 0.12 * h + fz * s * 0.16 * h, y + 0.62 * h, z - fz * 0.12 * h - fx * s * 0.16 * h, def, { ry: yaw + s * 0.5 });
}

/** A carved oak confessional against the aisle wall (sg: the wall's side), its middle at z: the priest's booth under a curved crest, two open kneeling booths, three angel herms. */
function confessional(k: Kit, sg: number, z: number): void {
  const xw = sg * CP.IN.aisle;
  const x = xw - sg * 0.65;
  const ry = sg < 0 ? Math.PI / 2 : -Math.PI / 2;
  k.box(1.3, 0.15, 3.0, x, 0.075, z, C.oakPlain);
  k.box(1.25, 2.5, 1.1, x, 1.4, z, C.oak, { tile: 1.2 });
  k.box(0.02, 1.7, 0.8, x - sg * 0.645, 1.2, z, C.dark);
  for (const s of [-1, 1]) {
    k.box(1.2, 0.12, 0.9, x, 2.55, z + s * 1.0, C.oak);
    k.box(1.2, 2.4, 0.1, x, 1.3, z + s * 1.46, C.oak, { tile: 1.2 });
    k.box(0.1, 2.4, 0.9, x + sg * 0.55, 1.3, z + s * 1.0, C.oak, { tile: 1.2 });
    k.box(0.5, 0.18, 0.8, x - sg * 0.1, 0.3, z + s * 1.0, C.oakPlain);
    figure(k, C.oak, x - sg * 0.62, 0.15, z + s * 0.56, 1.7, ry, true);
  }
  k.box(1.35, 0.3, 3.1, x, 2.78, z, C.oak);
  k.cyl(0.55, 0.55, 1.2, x, 2.92, z, C.oak, { seg: 8, rz: Math.PI / 2, ry });
  figure(k, C.gilt, x - sg * 0.3, 3.45, z, 0.9, ry, true);
}

/** A retable against a wall facing -z (or turned by ry): a marble base and table, black columns, the painting, the pediment, statues; candles on the table. */
export function altar(k: Kit, flames: Flames, x: number, z: number, w: number, h: number, pic: MatDef, ry = 0, statues = true, yb = 0): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + dx * c + dz * s, z - dx * s + dz * c];
  const B = (bw: number, bh: number, bd: number, dx: number, y: number, dz: number, def: MatDef) => {
    const [px, pz] = at(dx, dz);
    k.box(bw, bh, bd, px, y + yb, pz, def, { ry, tile: 1.2 });
  };
  B(w * 0.8, 1.0, 0.9, 0, 0.5, -0.45, C.marbleB);
  B(w * 0.84, 0.08, 1.0, 0, 1.04, -0.45, C.marbleW);
  B(w, 1.2, 0.5, 0, 0.6, 0.25, C.marbleB);
  B(w * 0.6, 0.35, 0.3, 0, 1.25, -0.1, C.gilt);
  const pw = w * 0.52;
  const ph = h * 0.52;
  const [ppx, ppz] = at(0, 0.02);
  k.plane(pw, ph, ppx, yb + 1.3 + ph / 2 + 0.2, ppz, pic, { ry: ry + Math.PI });
  B(pw + 0.3, 0.16, 0.12, 0, 1.4, -0.05, C.gilt);
  B(pw + 0.3, 0.16, 0.12, 0, 1.5 + ph + 0.08, -0.05, C.gilt);
  for (const sx of [-1, 1]) {
    B(0.16, ph + 0.3, 0.08, sx * (pw / 2 + 0.08), 1.45 + ph / 2, -0.05, C.gilt);
    for (const off of [0.28, 0.72]) {
      const [cx, cz] = at(sx * (pw / 2 + off), -0.15);
      k.cyl(0.14, 0.16, ph + 0.2, cx, yb + 1.2, cz, C.marbleB, { seg: 8 });
      k.box(0.44, 0.2, 0.44, cx, yb + 1.3 + ph + 0.3, cz, C.gilt);
    }
    if (statues) {
      const [fx, fz] = at(sx * (pw / 2 + 1.25), -0.2);
      figure(k, C.statue, fx, yb + 1.2, fz, 1.9, ry + Math.PI);
    }
  }
  B(w * 0.95, 0.4, 0.7, 0, 1.6 + ph + 0.2, -0.1, C.marbleB);
  B(w * 0.7, 0.9, 0.2, 0, 2.3 + ph + 0.2, 0.1, C.marbleW);
  const [gx, gz] = at(0, -0.1);
  k.cyl(0.42, 0.42, 0.1, gx, yb + 2.4 + ph + 0.3, gz, C.gilt, { seg: 12, rx: Math.PI / 2, ry });
  for (let i = -2; i <= 2; i++) {
    const [cx, cz] = at(i * w * 0.14, -0.25);
    k.cyl(0.03, 0.05, 0.5, cx, yb + 1.08, cz, C.brass, { seg: 5 });
    k.cyl(0.022, 0.022, 0.24, cx, yb + 1.58, cz, C.wax, { seg: 5 });
    flames.addFlame(cx, yb + 1.87, cz);
  }
}

/** A brass chandelier on its chain: a ring of candle arms. */
export function chandelier(k: Kit, flames: Flames, x: number, y: number, z: number, top: number): void {
  k.cyl(0.02, 0.02, top - y, x, y, z, C.iron, { seg: 4 });
  k.cyl(0.14, 0.2, 0.5, x, y - 0.25, z, C.brass, { seg: 8 });
  k.cyl(0.8, 0.8, 0.05, x, y - 0.35, z, C.brass, { seg: 12, open: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const cx = x + Math.cos(a) * 0.8;
    const cz = z + Math.sin(a) * 0.8;
    k.cyl(0.018, 0.018, 0.2, cx, y - 0.3, cz, C.wax, { seg: 4 });
    flames.addFlame(cx, y - 0.04, cz);
  }
}

/** The shell's real openings of the Carolus (shared/churchesShell.ts), in its hall's frame. */
export function carolusRows(): ChurchOpening[] {
  return inFrame(SHELL_OPENINGS.filter((o) => o.church === "carolus"), CP.PLAN.origin, CP.PLAN.yaw) as ChurchOpening[];
}

/** The church inside, built from the plan at the shell's place (its group in the world by the plan's frame). */
export function buildCarolusHall(): LandmarkRoom {
  const P = CP.PLAN;
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x2a2622);
  scene.background = null;
  group.position.y = CP.FLOOR_Y;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 18;
  fog.far = 90;
  const k = new Kit(group);
  k.shadeTop = 16;
  const r = rand(1615);
  const { IN, HT, BAYS, CHAPEL, DOOR, RAIL, CHAIRS, PULPIT } = CP;
  const flames = new Flames(group, 200, 0.14);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.4, tint?: number) =>
    k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile, tint });
  // ---- issue #10 (interiors are real): the hall's walls behind the shell's faces are linings (world/realOpenings.ts),
  // from the windows' reveals' back to the hall's inner face, cut exactly where the shell's windows and door are; the
  // glass is the shell's old panes, moved in (churches.ts churchGlass). Linings' heights in world metres.
  const FY = CP.FLOOR_Y;
  const W = (y: number) => y + FY;
  const rows = carolusRows();
  const face = (a: [number, number], c: [number, number], n: [number, number]): ShellFace => ({ a, c, n });
  const wallLines: Array<[[number, number], [number, number]]> = [];
  const LIN = (def: MatDef, f: ShellFace, o: { from: number; to: number; u0: number; u1: number; y0: number; y1: number; doors?: Lining["doors"] }) => {
    const fl = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
    const P = (u: number): [number, number] => [f.a[0] + ((f.c[0] - f.a[0]) * u) / fl - f.n[0] * o.to, f.a[1] + ((f.c[1] - f.a[1]) * u) / fl - f.n[1] * o.to];
    wallLines.push([P(o.u0), P(o.u1)]);
    lining(k, def, { face: f, from: o.from, to: o.to, u0: o.u0, u1: o.u1, y0: o.y0, y1: o.y1, doors: o.doors }, rows, FY, 2.4);
  };
  const { SHELL: SH, APSE_DOME } = CP;

  // ---- floors: marble in the nave, the aisles, the doorway (the shell's sill is the doorway's first metre), the choir and the chapel
  box(-DOOR.hw - 0.05, DOOR.hw + 0.05, -0.1, 0, 1.0, IN.west, C.floor, 1.6);
  box(-IN.aisle, IN.aisle, -0.1, 0, IN.west, IN.east, C.floor, 1.6);
  box(-IN.choir, IN.choir, -0.1, 0.15, IN.east, IN.east + 0.3, C.marbleW, 1.2);
  box(-IN.choir, IN.choir, -0.1, 0.3, IN.east + 0.3, IN.east + 0.6, C.marbleW, 1.2);
  box(-IN.choir, IN.choir, -0.1, CP.SANCTUARY, IN.east + 0.6, IN.apse, C.floor, 1.6);
  box(-IN.apseR - 0.1, IN.apseR + 0.1, -0.18, CP.SANCTUARY, IN.apse, IN.apse + IN.apseR + 0.1, C.floor, 1.6);
  box(CHAPEL.x0, CHAPEL.x1, -0.1, 0, CHAPEL.z0, CHAPEL.z1, C.floor, 1.6);
  box(IN.aisle, CHAPEL.x0, -0.1, 0, CHAPEL.door[0], CHAPEL.door[1], C.marbleW, 1.2);

  // ---- the west wall: the front lined behind its face from the reveals' back (its round windows over the side doors,
  // 0.4 deep) to the wall's inner face, cut at the door (the shell's, from the sill) and at those windows
  LIN(C.wash, face([-SH.aisle, 0], [SH.aisle, 0], [0, -1]), { from: 0.4, to: IN.west, u0: 0.25, u1: 2 * SH.aisle - 0.25, y0: W(-0.04), y1: W(HT.spring + HT.vaultR + 0.4) });
  // ---- the aisles' outer walls, lined behind the shell's (its reveals 0.35 deep, the old wall's inner face kept): the
  // gallery windows over the aisles, the Lady Chapel's arch in the south one
  const galleryWins = rows.filter((o) => o.kind === "window" && o.zone === "hall" && Math.abs(Math.abs(o.x) - SH.aisle) < 0.05);
  for (const sg of [-1, 1]) {
    const doors: Lining["doors"] = sg > 0 ? [{ u0: CHAPEL.door[0], u1: CHAPEL.door[1], top: W(CHAPEL.doorSpring + (CHAPEL.door[1] - CHAPEL.door[0]) / 2), round: true }] : [];
    LIN(C.wash, face([sg * SH.aisle, 0], [sg * SH.aisle, IN.east + 1], [sg, 0]), { from: 0.35, to: SH.aisle - IN.aisle, u0: IN.west - 0.3, u1: IN.east + 0.25, y0: W(-0.12), y1: W(HT.galleryCeil + 0.12), doors });
    for (const o of galleryWins.filter((q) => Math.sign(q.x) === sg)) {
      // the stone sill inside
      box(sg < 0 ? -IN.aisle : IN.aisle - 0.3, sg < 0 ? -IN.aisle + 0.3 : IN.aisle, o.yb - FY - 0.12, o.yb - FY, o.z - o.hw - 0.1, o.z + o.hw + 0.1, C.stone, 1.2);
    }
    // the oak panelling along the aisle wall (the confessionals stand in it)
    for (let z = IN.west + 0.6; z < IN.east - 0.4; z += 2.4) {
      const z1 = Math.min(z + 2.4, IN.east - 0.2);
      if (sg > 0 && z1 > CHAPEL.door[0] - 0.2 && z < CHAPEL.door[1] + 0.2) continue;
      k.plane(z1 - z, 2.3, sg * (IN.aisle - 0.08), 1.15, (z + z1) / 2, C.oakPlain, { ry: sg < 0 ? Math.PI / 2 : -Math.PI / 2, flat: false });
    }
    // the aisles' east end walls, the choir's side walls
    box(sg < 0 ? -12.5 : 6.55, sg < 0 ? -6.55 : 12.5, -0.12, HT.galleryCeil + 0.12, IN.east, IN.east + 0.22, C.wash);
    box(sg < 0 ? -6.1 : IN.choir, sg < 0 ? -IN.choir : 6.1, -0.12, HT.spring + 0.1, IN.east, IN.apse + 0.1, C.wash);
  }

  // ---- the arcades: Doric columns and round arches below, the gallery floor, Ionic columns and arches above, the entablature
  const piersLow: Array<[number, number]> = BAYS.map((z, i) => [z + (i === 0 ? 0.2 : i === BAYS.length - 1 ? -0.2 : 0), i === 0 || i === BAYS.length - 1 ? 0.2 : 0.45]);
  for (const sg of [-1, 1]) {
    const x = sg * IN.arcade;
    arcade(k, C.stone, x, piersLow, HT.cap, HT.galleryTop, IN.arcadeHalf * 2);
    arcade(k, C.stone, x, BAYS.map((z, i) => [z + (i === 0 ? 0.2 : i === BAYS.length - 1 ? -0.2 : 0), i === 0 || i === BAYS.length - 1 ? 0.2 : 0.38]), HT.upperCap, HT.spring + 0.25, IN.arcadeHalf * 2);
    for (const z of BAYS.slice(1, -1)) {
      column(k, C.stone, x, z, 0, HT.cap, 0.42, false);
      column(k, C.stone, x, z, HT.galleryTop, HT.upperCap, 0.34, true);
    }
    // the responds against the west wall and at the east end
    for (const z of [IN.west + 0.2, IN.east - 0.2]) {
      box(x - 0.4, x + 0.4, -0.12, HT.cap, z - 0.2, z + 0.2, C.stone, 1.6);
      box(x - 0.4, x + 0.4, HT.galleryTop - 0.02, HT.upperCap, z - 0.2, z + 0.2, C.stone, 1.6);
    }
    // the gallery's floor over the aisle, its stucco ceiling, the balustrade on the arcade. Issue #28: from the second
    // bay on: the first bay of each aisle stands open from its floor to a ceiling under the aisle's roof, so the round
    // window over the side door (6.1..8.1, the gallery's floor crossed it) and the front's middle-storey window over it
    // (13.0..17.0, over the gallery's ceiling) read whole; a balustrade closes the gallery's end over it
    const gx0 = sg < 0 ? -IN.aisle : x + IN.arcadeHalf;
    const gx1 = sg < 0 ? x - IN.arcadeHalf : IN.aisle;
    box(gx0, gx1, HT.gallery, HT.galleryTop, BAYS[1], IN.east, C.plaster, 3.0);
    box(gx0, gx1, HT.galleryCeil, HT.galleryCeil + 0.12, BAYS[1], IN.east, C.plaster, 3.0);
    {
      const zb = BAYS[1];
      box(gx0, gx1, HT.gallery - 0.25, HT.galleryTop, zb - 0.1, zb, C.stone, 1.2);
      box(gx0, gx1, HT.galleryTop, HT.galleryTop + 0.14, zb - 0.1, zb + 0.1, C.stone, 1.2);
      box(gx0, gx1, HT.galleryTop + 0.86, HT.galleryTop + 1.0, zb - 0.11, zb + 0.11, C.stone, 1.2);
      for (let xx = gx0 + 0.25; xx < gx1 - 0.15; xx += 0.32) k.cyl(0.05, 0.08, 0.72, xx, HT.galleryTop + 0.14, zb, C.marbleW, { seg: 5 });
      // the first bay's ceiling under the aisle's lean-to roof (build_churches.py CF: AE 15.4 at the aisle's wall, AH 18.6
      // at the nave's; its underside through them), 0.15 under it; the walls round it up to it
      const roof = (ax: number) => 15.4 + ((18.6 - 15.4) * (12.8 - ax)) / (12.8 - 6.5) - FY - 0.15;
      const xa = sg * 12.75;
      const xb = sg * (IN.arcade + IN.arcadeHalf);
      const ceil = new THREE.BufferGeometry();
      const pts = [
        [xa, roof(12.75), IN.west - 0.1],
        [xb, roof(IN.arcade + IN.arcadeHalf), IN.west - 0.1],
        [xb, roof(IN.arcade + IN.arcadeHalf), zb + 0.1],
        [xa, roof(12.75), zb + 0.1],
      ];
      // (facing down into the bay)
      const q = pts.map(([a, b, c]) => new THREE.Vector3(a, b, c));
      const up = new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[2], q[0])).y > 0;
      ceil.setAttribute("position", new THREE.Float32BufferAttribute((up ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]).flatMap((i) => pts[i]), 3));
      ceil.computeVertexNormals();
      planarUV(ceil, 3.0);
      k.add(ceil, C.plaster, 0, 0, 0, { flat: true, tint: 0.9 });
      // the aisle wall's lining on up to it, the wall over the upper arcade to it, the gallery's end wall over its ceiling
      box(Math.min(sg * 12.25, sg * 12.5), Math.max(sg * 12.25, sg * 12.5), HT.galleryCeil, roof(12.25) + 0.05, IN.west - 0.1, zb + 0.1, C.wash);
      box(Math.min(sg * IN.arcade, xb), Math.max(sg * IN.arcade, xb), HT.spring, roof(IN.arcade) + 0.05, IN.west - 0.1, zb + 0.1, C.wash);
      box(gx0, gx1, HT.galleryCeil, roof(IN.arcade) + 0.05, zb - 0.1, zb + 0.1, C.wash, 2.4, 0.95);
    }
    for (let i = 0; i + 1 < BAYS.length; i++) {
      const z0 = BAYS[i] + (i === 0 ? 0.45 : 0.5);
      const z1 = BAYS[i + 1] - (i === BAYS.length - 2 ? 0.45 : 0.5);
      box(x - 0.2, x + 0.2, HT.galleryTop, HT.galleryTop + 0.14, z0, z1, C.stone, 1.2);
      box(x - 0.22, x + 0.22, HT.galleryTop + 0.86, HT.galleryTop + 1.0, z0, z1, C.stone, 1.2);
      for (let z = z0 + 0.18; z < z1 - 0.1; z += 0.32) k.cyl(0.05, 0.08, 0.72, x, HT.galleryTop + 0.14, z, C.marbleW, { seg: 5 });
    }
    // the entablature over the upper arcade, along the nave and the choir
    box(x - 0.55, x + 0.55, HT.entab, HT.spring - 0.18, IN.west, IN.apse, C.wash, 2.4, 0.95);
    box(x - 0.7, x + 0.7, HT.spring - 0.18, HT.spring, IN.west, IN.apse, C.wash, 2.4);
  }
  // the organ loft over the first bay: its floor, its oak front, two columns under it
  box(-IN.arcade + IN.arcadeHalf, IN.arcade - IN.arcadeHalf, HT.gallery, HT.galleryTop, IN.west, BAYS[1], C.plaster, 3.0);
  box(-IN.arcade + IN.arcadeHalf, IN.arcade - IN.arcadeHalf, HT.galleryTop, HT.galleryTop + 1.1, BAYS[1] - 0.12, BAYS[1], C.oak, 1.2);
  box(-IN.arcade + IN.arcadeHalf, IN.arcade - IN.arcadeHalf, HT.gallery - 0.35, HT.gallery, BAYS[1] - 0.2, BAYS[1] + 0.05, C.stone, 1.6);
  for (const x of [-2.6, 2.6]) column(k, C.stone, x, BAYS[1], 0, HT.gallery - 0.35, 0.26, false);
  // the organ: an oak case of three towers of pipes, angels with trumpets on it
  box(-4.2, 4.2, HT.galleryTop, HT.galleryTop + 1.4, 1.6, 2.9, C.oak, 1.2);
  for (const [cx, w, top] of [[-3.1, 1.7, 5.6], [0, 2.2, 6.6], [3.1, 1.7, 5.6]] as Array<[number, number, number]>) {
    const y0 = HT.galleryTop + 1.4;
    box(cx - w / 2 - 0.12, cx - w / 2, y0, y0 + top, 1.7, 2.8, C.oak, 1.2);
    box(cx + w / 2, cx + w / 2 + 0.12, y0, y0 + top, 1.7, 2.8, C.oak, 1.2);
    box(cx - w / 2 - 0.2, cx + w / 2 + 0.2, y0 + top, y0 + top + 0.35, 1.6, 2.9, C.oak, 1.2);
    const n = Math.round(w / 0.22);
    for (let i = 0; i < n; i++) {
      const px = cx - w / 2 + 0.11 + (i * (w - 0.22)) / Math.max(1, n - 1);
      const ph = top * (0.55 + 0.4 * Math.sin((i / Math.max(1, n - 1)) * Math.PI));
      k.cyl(0.08, 0.08, ph, px, y0 + 0.2, 2.6, C.tin, { seg: 6 });
    }
    figure(k, C.oak, cx, y0 + top + 0.35, 2.2, 1.3, 0, true);
  }
  box(-1.4, 1.4, HT.galleryTop + 1.4, HT.galleryTop + 3.2, 1.75, 2.75, C.oak, 1.2);

  // ---- the barrel vault with its transverse arches; the choir's arch; the half dome of the apse (issue #10: raised
  // over the shell's apse windows' heads, a shallow dome up to the barrel's crown; a wall closes the apse's taller
  // space over the choir's arch)
  k.vault(HT.vaultR * 2, HT.spring, HT.vaultR, IN.apse - IN.west, 0, IN.west, C.vault, { tile: 3.0 });
  for (const z of BAYS.slice(1)) archRing(k, C.vault, 0, HT.spring, z, HT.vaultR - 0.34, HT.vaultR + 0.05, 0.6, 0.9);
  archRing(k, C.wash, 0, HT.spring, IN.apse, IN.apseR, HT.vaultR + 0.05, 0.4, 0.92);
  const domeY = APSE_DOME.spring;
  {
    const g = new THREE.SphereGeometry(IN.apseR + 0.05, 14, 6, 0, Math.PI, 0, Math.PI / 2);
    g.scale(1, APSE_DOME.rise / (IN.apseR + 0.05), 1);
    g.computeVertexNormals();
    planarUV(g, 3.0);
    k.add(g, C.vault, 0, domeY, IN.apse, { flat: true, tint: 0.95 });
    const xw = IN.apseR + 0.6;
    panel(k, C.wash, [-xw, IN.apse + 0.24], [xw, IN.apse + 0.24], HT.spring - 0.1, domeY + APSE_DOME.rise + 0.3, 0.06,
      [{ u0: xw - IN.apseR, u1: xw + IN.apseR, y0: HT.spring - 0.1, spring: HT.spring, round: true }], [], 2.4);
  }
  // the apse's five sides lined behind the shell's (the inner faces where the old walls' were), windows in the three
  // middle ones; grey stone pilasters at its corners, the sanctuary's cornice under the half dome
  const cos10 = Math.cos(Math.PI / 10);
  const R0 = IN.apseR + 0.12;
  for (let i = 0; i < 5; i++) {
    const a0 = -Math.PI / 2 + (Math.PI * i) / 5;
    const a1 = -Math.PI / 2 + (Math.PI * (i + 1)) / 5;
    const s0: [number, number] = [Math.sin(a0) * SH.apse, IN.apse + Math.cos(a0) * SH.apse];
    const s1: [number, number] = [Math.sin(a1) * SH.apse, IN.apse + Math.cos(a1) * SH.apse];
    const Ls = Math.hypot(s1[0] - s0[0], s1[1] - s0[1]);
    const am = (a0 + a1) / 2;
    LIN(C.wash, face(s0, s1, [Math.sin(am), Math.cos(am)]), { from: 0.4, to: SH.apse * cos10 - (R0 * cos10 - 0.12), u0: -0.25, u1: Ls + 0.25, y0: W(-0.12), y1: W(domeY + 0.3) });
    const p0: [number, number] = [Math.sin(a0) * R0 * -1, IN.apse + Math.cos(a0) * R0];
    const p1: [number, number] = [Math.sin(a1) * R0 * -1, IN.apse + Math.cos(a1) * R0];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    {
      const tx = (p1[0] - p0[0]) / L;
      const tz = (p1[1] - p0[1]) / L;
      let nx = -tz;
      let nz = tx;
      const mx = (p0[0] + p1[0]) / 2;
      const mz = (p0[1] + p1[1]) / 2;
      if (nx * (0 - mx) + nz * (IN.apse - mz) < 0) [nx, nz] = [-nx, -nz];
      const fry = Math.atan2(-tz, tx);
      k.box(L - 0.36, 0.32, 0.3, mx + nx * 0.25, domeY - 0.2, mz + nz * 0.25, C.stone, { ry: fry, tile: 1.6 });
      if (i >= 1) k.box(0.6, domeY - 0.01, 0.34, p0[0] + nx * 0.2 + tx * 0.05, (domeY - 0.01) / 2 - 0.005, p0[1] + nz * 0.2 + tz * 0.05, C.stone, { ry: fry, tile: 1.6 });
    }
  }
  // the returns between the apse and the choir's walls
  for (const sg of [-1, 1]) box(sg < 0 ? -6.05 : IN.apseR - 0.1, sg < 0 ? -IN.apseR + 0.1 : 6.05, -0.12, domeY + 0.3, IN.apse - 0.12, IN.apse + 0.12, C.wash);

  // ---- the high altar: marble, black columns, the tall painting in its gilded frame (the frame of the change machine)
  altar(k, flames, 0, 31.4, 5.6, 11.0, P_ALTAR, 0, true, CP.SANCTUARY);
  box(-2.4, 2.4, CP.SANCTUARY, CP.SANCTUARY + 0.25, 29.3, 30.6, C.marbleW, 1.2);
  // ---- the communion rail: white marble balusters, a black rail, the gate
  for (const [x0, x1] of [[-IN.arcade + 0.4, -RAIL.gate], [RAIL.gate, IN.arcade - 0.4]] as Array<[number, number]>) {
    box(x0, x1, 0, 0.12, RAIL.z0, RAIL.z1, C.marbleB, 1.2);
    box(x0, x1, 0.86, 0.98, RAIL.z0 - 0.04, RAIL.z1 + 0.04, C.marbleB, 1.2);
    for (let x = x0 + 0.12; x < x1 - 0.06; x += 0.24) k.cyl(0.045, 0.07, 0.74, x, 0.12, (RAIL.z0 + RAIL.z1) / 2, C.marbleW, { seg: 5 });
  }
  for (const s of [-1, 1]) box(s * RAIL.gate - 0.04 * s, s * 0.02, 0.1, 0.9, RAIL.z0 + 0.1, RAIL.z0 + 0.14, C.brass, 1);
  // ---- the side altars at the aisles' ends (St Ignatius, St Francis Xavier)
  altar(k, flames, -9.2, IN.east - 0.3, 3.6, 5.8, P_SIDE, 0, false);
  altar(k, flames, 9.2, IN.east - 0.3, 3.6, 5.8, P_SIDE2, 0, false);

  // ---- the chairs: rush seats in rows either side of the middle way
  for (const sg of [-1, 1])
    for (let z = CHAIRS.z0 + 0.3; z < CHAIRS.z1 - 0.2; z += CHAIRS.row)
      for (let x = CHAIRS.x0 + 0.25; x < CHAIRS.x1 - 0.1; x += 0.52) {
        if (sg < 0 && z > CP.CHAIR_GAP[0] && z < CP.CHAIR_GAP[1]) continue;
        const cx = sg * x;
        k.box(0.42, 0.05, 0.4, cx, 0.45, z, C.rush, { tint: 0.9 + r() * 0.2 });
        k.box(0.4, 0.42, 0.34, cx, 0.21, z, C.oakPlain, { tint: 0.7 });
        k.box(0.42, 0.5, 0.04, cx, 0.72, z + 0.2, C.oakPlain, { tint: 0.85 });
      }
  // ---- the pulpit on its column: the tub on a carved figure, the stair round the column, the sounding board with an angel
  {
    const { x, z } = PULPIT;
    figure(k, C.oak, x, 0, z, 1.9, Math.PI / 2);
    k.cyl(0.25, 0.3, 1.3, x, 1.0, z, C.oak, { seg: 8 });
    k.cyl(0.78, 0.55, 1.1, x, 2.3, z, C.oak, { seg: 8, tile: 1.2 });
    k.cyl(0.82, 0.82, 0.1, x, 3.4, z, C.oak, { seg: 8 });
    for (let i = 0; i < 12; i++) k.box(0.8, 0.14, 0.2, x - 0.3, 0.14 + i * 0.27, z - 2.35 + i * 0.13, C.oak);
    k.box(0.08, 3.4, 1.6, x + 0.12, 1.9, z - 1.5, C.oak, { rx: -0.45 });
    k.cyl(0.03, 0.03, 2.2, x - 0.4, 3.5, z, C.oak, { seg: 4 });
    k.cyl(1.0, 1.0, 0.18, x + 0.1, 5.7, z, C.oak, { seg: 10 });
    k.cyl(0.6, 1.0, 0.5, x + 0.1, 5.88, z, C.oak, { seg: 10 });
    figure(k, C.gilt, x + 0.1, 6.38, z, 0.9, Math.PI / 2, true);
  }
  // ---- the confessionals and the Stations of the Cross (1839) between them
  for (const c of CP.CONFESSIONALS) confessional(k, c.x, c.z);
  for (const sg of [-1, 1])
    for (let i = 0; i < 7; i++) {
      const z = IN.west + 2.2 + i * 3.4;
      if (CP.CONFESSIONALS.some((c) => c.x === sg && Math.abs(c.z - z) < 1.9)) continue;
      if (sg > 0 && z > CHAPEL.door[0] - 0.8 && z < CHAPEL.door[1] + 0.8) continue;
      k.plane(0.7, 0.9, sg * (IN.aisle - 0.14), 3.3, z, paintMat("history", 30 + i + (sg > 0 ? 7 : 0)), { ry: sg < 0 ? Math.PI / 2 : -Math.PI / 2 });
      box(sg * (IN.aisle - 0.1) - 0.02, sg * (IN.aisle - 0.1) + 0.02, 2.78, 3.82, z - 0.42, z + 0.42, C.gilt, 1);
    }
  // ---- the font by the door
  k.cyl(0.22, 0.3, 0.8, CP.FONT.x, 0, CP.FONT.z, C.marbleB, { seg: 8 });
  k.cyl(0.5, 0.3, 0.3, CP.FONT.x, 0.8, CP.FONT.z, C.marbleW, { seg: 10 });
  k.cyl(0.18, 0.5, 0.35, CP.FONT.x, 1.1, CP.FONT.z, C.brass, { seg: 10 });
  // ---- the chandeliers over the nave
  for (const z of [8.5, 14.5, 20.5]) chandelier(k, flames, 0, 9.2, z, HT.spring + HT.vaultR - 0.3);

  // ---- the Lady Chapel: marble walls, a coffered ceiling with small paintings, the altar, the rail, benches, candles
  {
    const { x0, x1, z0, z1, ceil } = CHAPEL;
    // (its outer wall lined behind the shell's, cut at the shell's three windows)
    LIN(C.panel, face([SH.chapel, SH.chapelFrom], [SH.chapel, z1 + 1], [1, 0]), { from: 0.35, to: SH.chapel - x1, u0: z0 - 0.25 - SH.chapelFrom, u1: z1 + 0.25 - SH.chapelFrom, y0: W(-0.12), y1: W(ceil + 0.12) });
    box(x0 + 0.03, x1 + 0.1, -0.12, ceil + 0.08, z0 - 0.22, z0, C.panel, 2.0);
    box(x0 + 0.03, x1 + 0.1, -0.12, ceil + 0.08, z1, z1 + 0.22, C.panel, 2.0);
    // the aisle wall's chapel side, clad in marble round the arch
    panel(k, C.panel, [x0 + 0.025, z0], [x0 + 0.025, z1], -0.12, ceil + 0.05, 0.05, [{ u0: CHAPEL.door[0] - z0, u1: CHAPEL.door[1] - z0, y0: -0.12, spring: CHAPEL.doorSpring, round: true }], [], 2.0);
    box(x0, x1, ceil, ceil + 0.12, z0, z1, C.plaster, 2.4);
    for (const [cx, cz] of [[14.6, 14.5], [18.8, 14.5], [14.6, 20.0], [18.8, 20.0]] as Array<[number, number]>) {
      k.plane(1.4, 1.0, cx, ceil - 0.01, cz, paintMat("saint", 40 + Math.round(cx + cz)), { rx: Math.PI / 2 });
      box(cx - 0.8, cx + 0.8, ceil - 0.08, ceil - 0.02, cz - 0.6, cz + 0.6, C.gilt, 1);
    }
    altar(k, flames, (x0 + x1) / 2, z1 - 0.37, 4.2, 7.2, P_LADY, 0, true);
    for (const [a, b] of [[x0, 16.1], [17.5, x1]] as Array<[number, number]>) {
      box(a, b, 0, 0.12, 21.4, 21.7, C.marbleB, 1.2);
      box(a, b, 0.86, 0.98, 21.36, 21.74, C.marbleW, 1.2);
      for (let x = a + 0.12; x < b - 0.06; x += 0.24) k.cyl(0.045, 0.07, 0.74, x, 0.12, 21.55, C.marbleW, { seg: 5 });
    }
    for (const z of [18.05, 19.25]) {
      box(14.4, 19.2, 0.42, 0.48, z - 0.25, z + 0.25, C.oakPlain, 1.2);
      box(14.5, 19.1, 0, 0.42, z - 0.05, z + 0.05, C.oakPlain, 1.2);
      box(14.4, 19.2, 0.48, 0.95, z + 0.2, z + 0.25, C.oakPlain, 1.2);
    }
    // the candle stand before the rail
    box(13.1, 13.7, 0, 0.9, 20.4, 21.0, C.iron, 1);
    for (let i = 0; i < 12; i++) {
      const cx = 13.15 + (i % 4) * 0.16;
      const cz = 20.48 + Math.floor(i / 4) * 0.2;
      k.cyl(0.015, 0.015, 0.1 + (i % 3) * 0.05, cx, 0.9, cz, C.wax, { seg: 4 });
      flames.addFlame(cx, 1.02 + (i % 3) * 0.05, cz);
    }
    // two saints in marble either side of the arch
    for (const z of [12.5, 23.3]) figure(k, C.statue, 13.2, 0, z, 2.1, Math.PI / 2);
  }
  k.finish();
  // ---- issue #28: the church's parts behind its other real windows (the tower's rooms, belfry and lanterns, the stair
  // towers, the Jesuit house, the sacristy, the Lady Chapel range's porch, sacristy and roof space:
  // world/churchSpaces.ts), seen from the street only
  buildChurchSpaces({
    church: "carolus",
    group,
    origin: P.origin,
    yaw: P.yaw,
    floorY: FY,
    rows,
    mats: { wall: C.wash, stone: C.stone, timber: M.oak, oak: C.oak, floor: C.floor, vault: C.plaster, iron: C.iron, bronze: C.brass, dark: C.dark, marbleW: C.marbleW, marbleB: C.marbleB, gilt: C.gilt, statue: C.statue, linen: M.linen, red: C.red, blue: M.blue, pictures: [P_SIDE, P_LADY] },
  });

  // ---- lights: daylight from the gallery windows, candles, the chandeliers
  // the sun through the gallery windows over the galleries' floors into the nave, the Lady Chapel's and the apse's
  // coloured glass; the columns' shadows; the moon by night (world/hallSun.ts)
  // (issue #10: the shell's real windows, at their glass; no shaft through a wall of the hall)
  const sunWins = sunWindowsOf(rows.filter((o) => o.zone === "hall"), FY, { yaw: CP.PLAN.yaw, lines: wallLines });
  const sunLight = buildHallSun(group, {
    floor: { minX: -IN.aisle, maxX: CHAPEL.x1, minZ: IN.west, maxZ: IN.east },
    floors: [
      { minX: -IN.aisle, maxX: IN.aisle, minZ: IN.west, maxZ: IN.east },
      { minX: CHAPEL.x0, maxX: CHAPEL.x1, minZ: CHAPEL.z0, maxZ: CHAPEL.z1 },
      { minX: IN.aisle, maxX: CHAPEL.x0, minZ: CHAPEL.door[0], maxZ: CHAPEL.door[1] },
    ],
    windows: sunWins,
    piers: [-1, 1].flatMap((sg) => BAYS.slice(1, -1).map((z) => ({ x: sg * IN.arcade, z, r: 0.42, h: HT.cap }))),
    screens: [
      ...[-1, 1].map((sg) => ({ along: "z" as const, at: sg * IN.arcade, from: IN.west, to: IN.east, open: 0, solid: [[HT.cap + 1.0, HT.galleryTop + 0.1], [HT.upperCap + 1.2, 99]] as Array<[number, number]> })),
      // the south aisle's wall between the Lady Chapel and the aisle: its arch the only way through
      { along: "z" as const, at: IN.aisle + 0.12, from: CHAPEL.z0, to: CHAPEL.door[0], open: -1 },
      { along: "z" as const, at: IN.aisle + 0.12, from: CHAPEL.door[0], to: CHAPEL.door[1], open: CHAPEL.doorSpring },
      { along: "z" as const, at: IN.aisle + 0.12, from: CHAPEL.door[1], to: CHAPEL.z1, open: -1 },
    ],
    slabs: [-1, 1].map((sg) => ({ minX: sg < 0 ? -IN.aisle : IN.arcade + IN.arcadeHalf, maxX: sg < 0 ? -(IN.arcade + IN.arcadeHalf) : IN.aisle, minZ: BAYS[1], maxZ: IN.east, y: HT.galleryTop })),
    power: 1.1,
  });
  const hemi = new THREE.HemisphereLight(0xd8d4cc, 0x4a4036, 1.1);
  const amb = new THREE.AmbientLight(0x5a5048, 0.9);
  const HEMI_DAY = new THREE.Color(0xd8d4cc);
  const HEMI_NIGHT = new THREE.Color(0x56668c);
  const GROUND_DAY = new THREE.Color(0x4a4036);
  const GROUND_NIGHT = new THREE.Color(0x1a1612);
  const AMB_DAY = new THREE.Color(0x5a5048);
  const AMB_NIGHT = new THREE.Color(0x262c40);
  scene.add(hemi, amb);
  // the stained glass: the shell's old panes, moved into the hall (issue #10), lit by the day or the moon
  const glass = churchGlass("carolus", scene);
  const pt = (c: number, x: number, y: number, z: number, d: number) => {
    const l = new THREE.PointLight(c, 0, d, 1.5);
    l.position.set(x, y, z);
    group.add(l);
    return l;
  };
  const altarL = pt(0xffb070, 0, 3.0, 29.0, 16);
  const naveL = pt(0xffc080, 0, 8.4, 14.5, 26);
  const chapelL = pt(0xffb070, 16.8, 3.2, 21.5, 14);
  const dayFill = pt(0xd8dce0, 0, 11, 13, 40);
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    // bright by day with the sun's patches on top; blue-black by night round the candles, the glass holding the moon
    const night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.35);
    const moon = night * THREE.MathUtils.clamp((sky - 0.55) * 2.2, 0.25, 1);
    hemi.intensity = (0.3 + 2.9 * d) * ambK;
    hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, night);
    hemi.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, night);
    amb.intensity = (0.2 + 0.65 * day) * ambK;
    amb.color.copy(AMB_DAY).lerp(AMB_NIGHT, night);
    dayFill.intensity = 9 * d;
    glass.set(day, sky, moon);
    sunLight.set(day, sky);
  };
  const free = (x: number, z: number) => HP.freeAt(P, x, z, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: "carolus" as unknown as LandmarkRoom["landmark"],
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
    sound: "church",
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
      flames.update(t);
      // (all night, shut or not: the altar's candles, the chandeliers' lamps, the Lady Chapel's candles)
      const dark = 1 - THREE.MathUtils.smoothstep(day, 0.1, 0.45);
      altarL.intensity = (3.2 + 2 * dark) * flicker(t, 1.3);
      naveL.intensity = (4 + 7 * dark) * flicker(t, 2.1);
      chapelL.intensity = (3.0 + 1.5 * dark) * flicker(t, 3.7);
      room.lamps = [
        { p: toWorld(0, 29.0, 2.4), w: 0.25 * flicker(t, 1.3) },
        { p: toWorld(0, 14.5, 8.8), w: 0.2 * flicker(t, 2.1) },
        { p: toWorld(13.4, 20.7, 1.1), w: 0.2 * flicker(t, 3.7) },
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  void matOf;
  void painting;
  return room;
}

/** Where paths() checks the church inside (local points; only while the door stands open). */
export const CAROLUS_POINTS: HallInWorld["points"] = [
  { label: "the Carolus, inside the door", x: 0, z: 3.2, reach: 1.2 },
  { label: "the Carolus, the nave", x: 0, z: 12, reach: 1.2 },
  { label: "the Carolus, a row of chairs", x: 5.45, z: 12.5, reach: 1.0 },
  { label: "the Carolus, the pulpit", x: -3.9, z: CP.PULPIT.z, reach: 1.0 },
  { label: "the Carolus, a confessional", x: -10.3, z: 11.4, reach: 1.0 },
  { label: "the Carolus, the communion rail", x: 0, z: 25.0, reach: 1.0 },
  { label: "the Carolus, St Ignatius's altar", x: 9.2, z: 24.4, reach: 1.0 },
  { label: "the Carolus, the Lady Chapel", x: 16.8, z: 16.0, reach: 1.2 },
  { label: "the Carolus, the Lady Chapel's rail", x: 16.8, z: 20.9, reach: 1.0 },
  { label: "the Carolus, the font", x: -9.3, z: 4.4, reach: 1.0 },
];

export interface CarolusInWorld {
  hall: HallInWorld;
  /** Jef is inside (the footsteps' echo, the room's sound). */
  readonly indoors: boolean;
  update(t: number, dt: number, hour: number, day: number, sky: number): void;
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }>;
}

/**
 * The Carolus in the world: its hall, the door open from six in the morning to seven at night (the sexton puts
 * Jef out at closing), the church's echo while Jef is inside. No people of its own yet.
 */
export function carolusInWorld(
  world: World,
  inWorld: InWorld,
  hooks: { roomSound(k: string | null): void; say(t: string): void; jef(): { x: number; z: number; place(x: number, z: number, yaw: number): void } },
): CarolusInWorld {
  // (issue #10: every real window of the shell an opening of the hall: the hall from the street, the street from inside)
  // (#28: the windows of its tower, stair towers and annexes too, seen from the street only: from inside they bring no street in)
  const hallOnly = (o: { id: string; zone?: string }) => (o.zone === "hall" ? undefined : () => false);
  const hall = createHallInWorld(world, inWorld, CP.PLAN, buildCarolusHall(), { color: 0x2a2620, near: 18, far: 90 }, CAROLUS_POINTS, [], 0.3, windowOpenings(carolusRows(), (x, z) => HP.toWorld(CP.PLAN, x, z), hallOnly));
  // (from inside, only the windows near the eye bring the street in: churches.ts CHURCH_INSIDE_REACH)
  const iw = inWorld.all.find((r) => r.id === "carolus");
  if (iw) iw.insideReach = CHURCH_INSIDE_REACH;
  let inside = false;
  let open = true;
  return {
    hall,
    get indoors() {
      return inside;
    },
    update(t, dt, hour, day, sky) {
      const want = hour >= 6 && hour < 19;
      const jef = hooks.jef();
      const k = hall.insideness(jef.x, jef.z);
      if (open && !want && k > 0.2) {
        // closing time: the sexton walks Jef out onto the terrace, then the leaves turn shut
        const [sx, sz] = hall.world(CP.PLAN.marks.door.x, CP.PLAN.marks.door.z);
        jef.place(sx, sz, Math.PI);
        hooks.say("The sexton rattles his keys: the church is closing for the night. You step out onto the terrace.");
      }
      open = want;
      hall.doorOpen = want;
      hall.update(t, dt, day, sky);
      const now = inside ? k > 0.35 : k > 0.55;
      if (now !== inside) {
        inside = now;
        hooks.roomSound(inside ? "church" : null);
      }
    },
    pathPoints() {
      if (!hall.doorOpen) return [];
      return CAROLUS_POINTS.map((p) => {
        const [x, z] = hall.world(p.x, p.z);
        return { label: p.label, x, z, reach: p.reach };
      });
    },
  };
}
