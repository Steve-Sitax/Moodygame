import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import { GOTHIC, pointedAt, type GothicHall } from "../../../shared/gothicPlan";
import { SHELL_OPENINGS, type ChurchOpening } from "../../../shared/churchesShell";
import { inFrame, type ShellFace } from "../../../shared/shellOpening";
import { canvasTex, flicker, frameRoom, rand } from "./rooms";
import { Flames, Kit, lmMat, marble, painting, type MatDef } from "./landmarkKit";
import { M, walkGraph, type LandmarkRoom } from "./landmarkRooms";
import { buildHallSun } from "./hallSun";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import { altar, C, chandelier, figure, PIC, planarUV } from "./carolusHall";
import { lining, windowOpenings, type Lining } from "./realOpenings";
import { CHURCH_INSIDE_REACH, churchGlass, sunWindowsOf } from "./churches";
import { buildChurchSpaces } from "./churchSpaces";
import { psx } from "../retro/psx";
import type { World } from "./rijnkaai";
import type { InWorld } from "./inworld";

// Sint-Pauluskerk and Sint-Jacobskerk inside (M7, docs/milestones/M7-paul-james.md), standing in the world inside
// their Blender shells (tools/blender/build_churches.py stpaul(), stjacob()) and walked in by their plans
// (shared/gothicPlan.ts), the halls' way (world/hallInWorld.ts). One builder for both Gothic churches: round
// columns with leafy capitals, pointed arcades, rib vaults (a groin over each bay, its ribs on the creases),
// aisles vaulted bay by bay so the windows stand in their lunettes, chapels between the buttresses, the crossing
// and the transept, the choir and its apse; then each church's furnishing: St Paul's organ on the west gallery,
// its Verbrugghen confessionals, the fifteen Mysteries of the Rosary along the north aisle, the marble high altar;
// St James's tower hall, the marble choir screen with the organ on it, the ambulatory and Rubens's chapel behind
// the high altar. Floors of bluestone slabs with grave slabs (a Codex picture with its height map for the relief).

const flat = (c: string) =>
  canvasTex(8, 8, (g) => {
    g.fillStyle = c;
    g.fillRect(0, 0, 8, 8);
  });

let slabRelief: THREE.Texture | null = null;
function slabHeight(): THREE.Texture {
  if (slabRelief) return slabRelief;
  const t = new THREE.TextureLoader().load("/textures/pj_slabs_h.png");
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return (slabRelief = t);
}

const SLAB_TILE = 3.2;
const G = {
  floor: {
    key: "gh_floor",
    make: () =>
      psx(new THREE.MeshLambertMaterial({ map: PIC("/textures/pj_slabs.jpg", flat("#5a6068")), color: 0xc8ccd2, vertexColors: true }), {
        affine: 0,
        relief: { height: slabHeight(), depth: 0.0, tile: SLAB_TILE, bump: 1.4 },
      }),
  } as MatDef,
  wash: lmMat("gh_wash", { map: PIC("/textures/pj_wash.jpg", flat("#d8d2c4")), color: 0xe4ded0 }, 0.03),
  vault: lmMat("gh_vault", { map: PIC("/textures/pj_wash.jpg", flat("#d8d2c4")), color: 0xe8e2d6, side: THREE.DoubleSide }, 0.03),
  // (the stone pictures with bumps from their own picture, 2026-09-26: "churches do not forget bump mapping")
  white: lmMat("gh_white", { map: PIC("/textures/pj_white.jpg", flat("#c8c4bc")), color: 0xe0dcd4 }, 0.05, 1.2),
  sand: lmMat("gh_sand", { map: PIC("/textures/pj_brabant.jpg", flat("#b0a894")), color: 0xf2eadc }, 0.05, 1.2),
  oak: C.oak,
  oakPlain: C.oakPlain,
  marbleW: lmMat("gh_marble_w", { map: marble(false), color: 0xf0ece4 }, 0.05),
  marbleB: lmMat("gh_marble_b", { map: marble(true), color: 0xa0a0a0 }, 0.05),
  gilt: C.gilt,
  statue: C.statue,
  rush: M.rush,
  iron: M.iron,
  brass: M.brass,
  tin: M.tin,
  wax: M.wax,
  dark: C.dark,
};

const pictureMat = (key: string, url: string, stand: Parameters<typeof painting>[0], seed: number, flip = false): MatDef => {
  const t = PIC(url, painting(stand, seed).clone());
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  if (flip) {
    t.repeat.x = -1;
    t.offset.x = 1;
  }
  return lmMat(key, { map: t, emissiveMap: t, emissive: 0x5a4c3c, color: 0xc8c0b0 }, 0);
};
const PICS = {
  paul: {
    altar: pictureMat("gh_p_altar", "/textures/pj_paint_paul_altar.jpg", "descent", 51),
    side: pictureMat("gh_p_side", "/textures/pj_paint_rosary_b.jpg", "saint", 52),
    lady: pictureMat("gh_p_lady", "/textures/pj_paint_rosary_a.jpg", "assumption", 53),
    chapel: pictureMat("gh_p_chapel", "/textures/pj_paint_rosary_c.jpg", "saint", 54),
  },
  james: {
    altar: pictureMat("gh_j_altar", "/textures/pj_paint_james_altar.jpg", "saint", 61),
    side: pictureMat("gh_j_side", "/textures/pj_paint_rosary_c.jpg", "saint", 62, true),
    lady: pictureMat("gh_j_lady", "/textures/pj_paint_rosary_a.jpg", "assumption", 63, true),
    chapel: pictureMat("gh_j_chapel", "/textures/pj_paint_james_chapel.jpg", "assumption", 64),
  },
};
const ROSARY = [
  pictureMat("gh_rosary_a", "/textures/pj_paint_rosary_a.jpg", "assumption", 71),
  pictureMat("gh_rosary_b", "/textures/pj_paint_rosary_b.jpg", "saint", 72),
  pictureMat("gh_rosary_c", "/textures/pj_paint_rosary_c.jpg", "saint", 73),
  pictureMat("gh_rosary_d", "/textures/pj_paint_rosary_a.jpg", "assumption", 74, true),
  pictureMat("gh_rosary_e", "/textures/pj_paint_rosary_b.jpg", "saint", 75, true),
];

// ---------------------------------------------------------------- walls with pointed openings

type Opening = { u0: number; u1: number; y0: number; spring: number; head: "round" | "pointed" | "flat"; rise?: number };

function headPts(o: Opening, n = 10): Array<[number, number]> {
  const half = (o.u1 - o.u0) / 2;
  const c = (o.u0 + o.u1) / 2;
  if (o.head === "flat") return [[o.u0, o.spring], [o.u1, o.spring]];
  if (o.head === "round")
    return Array.from({ length: n + 1 }, (_, i) => {
      const a = Math.PI - (Math.PI * i) / n;
      return [c + half * Math.cos(a), o.spring + half * Math.sin(a)] as [number, number];
    });
  const rise = o.rise ?? 1.484 * half;
  return Array.from({ length: n + 1 }, (_, i) => {
    const u = o.u0 + ((o.u1 - o.u0) * i) / n;
    return [u, o.spring + pointedAt(u - c, half, rise)] as [number, number];
  });
}

/**
 * A wall from a to c (x, z) between y0 and y1, `t` thick (centred on the line), openings from the floor cut its
 * bottom edge (doorways, arcades), windows are holes. Pointed, round or flat heads.
 */
function wallG(k: Kit, def: MatDef, a: [number, number], c: [number, number], y0: number, y1: number, t: number, openings: Opening[], holes: Opening[], tile = 2.6, tint?: number): void {
  const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (import.meta.env.DEV) for (const o of openings) if (o.u0 < 0 || o.u1 > L || o.spring + (o.rise ?? o.u1 - o.u0) > y1) console.warn("gothicHall: an opening past its wall", a, c, o);
  const s = new THREE.Shape();
  s.moveTo(0, y0);
  for (const o of [...openings].sort((p, q) => p.u0 - q.u0)) {
    s.lineTo(o.u0, y0);
    for (const [u, y] of headPts(o)) s.lineTo(u, y);
    s.lineTo(o.u1, y0);
  }
  s.lineTo(L, y0);
  s.lineTo(L, y1);
  s.lineTo(0, y1);
  s.lineTo(0, y0);
  for (const w of holes) {
    // a hole past the wall's outline breaks the triangulation (faces over faces): say so in dev
    if (import.meta.env.DEV && (w.u0 < 0 || w.u1 > L || w.y0 < y0 || w.spring + (w.rise ?? 0) > y1)) console.warn("gothicHall: a window past its wall", a, c, w);
    const p = new THREE.Path();
    p.moveTo(w.u0, w.y0);
    p.lineTo(w.u1, w.y0);
    for (const [u, y] of [...headPts(w)].reverse()) p.lineTo(u, y);
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

/** The transverse ribs already drawn in this build (cleared per hall). */
const ribEdges = new Set<string>();

/** A rib vault over a rectangle: a groin (the higher of the two pointed barrels, across and along), its ribs on the creases and at its edges. */
function groin(k: Kit, def: MatDef, rib: MatDef, x0: number, x1: number, z0: number, z1: number, spring: number, riseX: number, riseZ: number, ribs = true): void {
  const n = 10;
  const hx = (x1 - x0) / 2;
  const hz = (z1 - z0) / 2;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const Y = (x: number, z: number) => spring + Math.max(pointedAt(x - cx, hx, riseX), pointedAt(z - cz, hz, riseZ));
  const pos: number[] = [];
  const at = (i: number, j: number): [number, number, number] => {
    const x = x0 + ((x1 - x0) * i) / n;
    const z = z0 + ((z1 - z0) * j) / n;
    return [x, Y(x, z), z];
  };
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const p00 = at(i, j);
      const p10 = at(i + 1, j);
      const p01 = at(i, j + 1);
      const p11 = at(i + 1, j + 1);
      // facing down
      pos.push(...p00, ...p10, ...p11, ...p00, ...p11, ...p01);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  planarUV(g, 3.0);
  k.add(g, def, 0, 0, 0, { flat: true, tint: 0.97 });
  if (!ribs) return;
  // the diagonal ribs from each corner to the crown, and the ridge ribs, a little under the surface
  const seg = (a: [number, number], b: [number, number], steps: number) => {
    for (let i = 0; i < steps; i++) {
      const pa = [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps];
      const pb = [a[0] + ((b[0] - a[0]) * (i + 1)) / steps, a[1] + ((b[1] - a[1]) * (i + 1)) / steps];
      const ya = Y(pa[0], pa[1]) - 0.1;
      const yb = Y(pb[0], pb[1]) - 0.1;
      const len = Math.hypot(pb[0] - pa[0], yb - ya, pb[1] - pa[1]);
      const bx = new THREE.BoxGeometry(0.2, 0.18, len);
      const mid = new THREE.Vector3((pa[0] + pb[0]) / 2, (ya + yb) / 2, (pa[1] + pb[1]) / 2);
      const dir = new THREE.Vector3(pb[0] - pa[0], yb - ya, pb[1] - pa[1]).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      bx.applyQuaternion(q);
      bx.translate(mid.x, mid.y, mid.z);
      k.add(bx, rib, 0, 0, 0, { flat: true, tint: 0.95 });
    }
  };
  for (const [ex, ez] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as Array<[number, number]>) seg([ex + (cx - ex) * 0.02, ez + (cz - ez) * 0.02], [cx, cz], 5);
  for (const [a, b] of [[[x0, z0], [x1, z0]], [[x0, z1], [x1, z1]]] as Array<[[number, number], [number, number]]>) {
    // (bays side by side share this edge: its rib once)
    const key = `${a[0].toFixed(2)},${a[1].toFixed(2)},${b[0].toFixed(2)},${b[1].toFixed(2)},${spring.toFixed(2)}`;
    if (ribEdges.has(key)) continue;
    ribEdges.add(key);
    seg(a, b, 8);
  }
}

/** A round column on an octagonal base with a leafy (cabbage) capital, from y0 to y1. */
function column(k: Kit, stone: MatDef, x: number, z: number, y0: number, y1: number, r: number): void {
  k.cyl(r * 1.45, r * 1.45, 0.55, x, y0, z, stone, { seg: 8 });
  k.cyl(r * 1.25, r * 1.4, 0.2, x, y0 + 0.55, z, stone, { seg: 8 });
  k.cyl(r, r * 1.05, y1 - y0 - 1.35, x, y0 + 0.75, z, stone, { seg: 12, tile: 1.8 });
  // the capital: a bell with two rows of curled leaves, a moulded abacus
  const yc = y1 - 0.6;
  k.cyl(r * 1.25, r, 0.45, x, yc, z, stone, { seg: 12 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
    const lx = x + Math.cos(a) * r * 1.12;
    const lz = z + Math.sin(a) * r * 1.12;
    k.box(0.22, 0.26, 0.12, lx, yc + (i % 2 ? 0.34 : 0.14), lz, stone, { ry: -a + Math.PI / 2, tint: 1.05 });
  }
  k.cyl(r * 1.45, r * 1.35, 0.2, x, y1 - 0.2, z, stone, { seg: 8 });
}

/** A clustered pier (the crossing): four shafts round a core. */
function pier(k: Kit, stone: MatDef, x: number, z: number, y1: number, r: number): void {
  k.cyl(r * 1.1, r * 1.1, y1 - 0.4, x, 0, z, stone, { seg: 12, tile: 1.8 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.cyl(r * 0.45, r * 0.45, y1, x + Math.cos(a) * r * 0.95, 0, z + Math.sin(a) * r * 0.95, stone, { seg: 8, tile: 1.8 });
  }
  k.cyl(r * 1.9, r * 1.9, 0.6, x, 0, z, stone, { seg: 8 });
}

/** A carved oak confessional against a wall along z at x (its face toward -sg), middle at z. */
function confessional(k: Kit, x: number, sg: number, z: number): void {
  const ry = sg < 0 ? Math.PI / 2 : -Math.PI / 2;
  k.box(1.3, 0.15, 3.0, x, 0.075, z, G.oakPlain);
  k.box(1.25, 2.6, 1.1, x, 1.45, z, G.oak, { tile: 1.2 });
  k.box(0.02, 1.7, 0.8, x - sg * 0.645, 1.2, z, G.dark);
  for (const s of [-1, 1]) {
    k.box(1.2, 0.12, 0.9, x, 2.65, z + s * 1.0, G.oak);
    k.box(1.2, 2.5, 0.1, x, 1.35, z + s * 1.46, G.oak, { tile: 1.2 });
    k.box(0.1, 2.5, 0.9, x + sg * 0.55, 1.35, z + s * 1.0, G.oak, { tile: 1.2 });
    k.box(0.5, 0.18, 0.8, x - sg * 0.1, 0.3, z + s * 1.0, G.oakPlain);
    // the life-size carved figures of saints and angels between the booths (Verbrugghen)
    figure(k, G.oak, x - sg * 0.62, 0.15, z + s * 1.6, 1.85, ry, s > 0);
  }
  k.box(1.35, 0.3, 3.1, x, 2.88, z, G.oak);
  k.cyl(0.55, 0.55, 1.2, x, 3.02, z, G.oak, { seg: 8, rz: Math.PI / 2, ry });
  figure(k, G.gilt, x - sg * 0.3, 3.55, z, 0.9, ry, true);
}

/** Oak choir stalls along a wall: two rows of seats, a panelled back with a cornice and carved finials. */
function stalls(k: Kit, x: number, z0: number, z1: number, side: number): void {
  const len = z1 - z0;
  const zc = (z0 + z1) / 2;
  k.box(0.9, 0.12, len, x, 0.06, zc, G.oakPlain);
  k.box(0.55, 0.45, len, x + side * 0.1, 0.22, zc, G.oakPlain, { tile: 1.2 });
  k.box(0.1, 2.4, len, x + side * 0.42, 1.2, zc, G.oak, { tile: 1.2 });
  k.box(0.5, 0.12, len, x + side * 0.25, 2.45, zc, G.oak);
  k.box(0.55, 0.9, len, x - side * 0.55, 0.45, zc, G.oak, { tile: 1.2 });
  for (let zz = z0 + 0.3; zz < z1; zz += 0.62) {
    k.box(0.06, 0.55, 0.06, x + side * 0.1, 0.72, zz, G.oak);
    k.cyl(0.07, 0.07, 0.35, x + side * 0.38, 2.51, zz, G.oak, { seg: 6 });
  }
}

/** A marble communion rail across x at z (a gate gap in the middle). */
function rail(k: Kit, x0: number, x1: number, z: number, gate: number): void {
  for (const [a, b] of [[x0, -gate], [gate, x1]] as Array<[number, number]>) {
    k.box(b - a, 0.12, 0.3, (a + b) / 2, 0.06, z, G.marbleB, { tile: 1.2 });
    k.box(b - a, 0.12, 0.38, (a + b) / 2, 0.92, z, G.marbleB, { tile: 1.2 });
    for (let x = a + 0.12; x < b - 0.06; x += 0.24) k.cyl(0.045, 0.07, 0.74, x, 0.12, z, G.marbleW, { seg: 5 });
  }
  for (const s of [-1, 1]) k.box(0.04, 0.8, 0.04, s * gate, 0.5, z, G.brass);
}

/** The pulpit on its column against a nave column (x, z): the carved figure under the tub, the stair, the sounding board with an angel. */
function pulpit(k: Kit, x: number, z: number, dir: number): void {
  figure(k, G.oak, x, 0, z, 1.9, dir > 0 ? -Math.PI / 2 : Math.PI / 2);
  k.cyl(0.25, 0.3, 1.3, x, 1.0, z, G.oak, { seg: 8 });
  k.cyl(0.8, 0.55, 1.15, x, 2.3, z, G.oak, { seg: 8, tile: 1.2 });
  k.cyl(0.84, 0.84, 0.1, x, 3.45, z, G.oak, { seg: 8 });
  for (let i = 0; i < 12; i++) k.box(0.8, 0.14, 0.2, x + dir * 0.2, 0.14 + i * 0.27, z - 2.3 + i * 0.13, G.oak);
  k.cyl(0.03, 0.03, 2.3, x - dir * 0.4, 3.5, z, G.oak, { seg: 4 });
  k.cyl(1.05, 1.05, 0.18, x - dir * 0.1, 5.8, z, G.oak, { seg: 10 });
  k.cyl(0.6, 1.05, 0.5, x - dir * 0.1, 5.98, z, G.oak, { seg: 10 });
  figure(k, G.gilt, x - dir * 0.1, 6.48, z, 0.95, dir > 0 ? -Math.PI / 2 : Math.PI / 2, true);
}

/** An organ: an oak case of towers of tin pipes with angels on it, facing -z (turned by ry). */
function organ(k: Kit, x: number, y: number, z: number, width: number, ry: number): void {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  const at = (dx: number, dz: number): [number, number] => [x + dx * c + dz * s, z - dx * s + dz * c];
  const B = (w: number, h: number, d: number, dx: number, yy: number, dz: number, def: MatDef) => {
    const [px, pz] = at(dx, dz);
    k.box(w, h, d, px, yy, pz, def, { ry, tile: 1.2 });
  };
  B(width, 1.5, 1.4, 0, y + 0.75, 0, G.oak);
  const towers: Array<[number, number, number]> = [
    [-width * 0.38, width * 0.2, 5.0],
    [-width * 0.15, width * 0.16, 4.0],
    [0, width * 0.22, 6.2],
    [width * 0.15, width * 0.16, 4.0],
    [width * 0.38, width * 0.2, 5.0],
  ];
  for (const [dx, w, h] of towers) {
    B(w + 0.2, 0.3, 1.2, dx, y + 1.65, 0, G.oak);
    B(w + 0.24, 0.4, 1.3, dx, y + 1.5 + h + 0.2, 0, G.oak);
    for (const sx of [-1, 1]) B(0.12, h, 1.1, dx + sx * (w / 2 + 0.06), y + 1.5 + h / 2, 0, G.oak);
    const n = Math.max(3, Math.round(w / 0.2));
    for (let i = 0; i < n; i++) {
      const u = dx - w / 2 + 0.1 + (i * (w - 0.2)) / Math.max(1, n - 1);
      const ph = h * (0.6 + 0.35 * Math.sin((i / Math.max(1, n - 1)) * Math.PI));
      const [px, pz] = at(u, -0.3);
      k.cyl(0.075, 0.075, ph, px, y + 1.8, pz, G.tin, { seg: 6 });
    }
    const [fx, fz] = at(dx, -0.2);
    figure(k, G.oak, fx, y + 1.5 + h + 0.4, fz, 1.2, ry + Math.PI, true);
  }
}

/** A statue on a corbel against a column (the Apostles on St James's nave columns). */
function statueOnColumn(k: Kit, x: number, z: number, y: number, face: number): void {
  const fx = face;
  k.box(0.5, 0.35, 0.5, x + fx * 0.55, y, z, G.white);
  figure(k, G.statue, x + fx * 0.6, y + 0.18, z, 1.6, fx > 0 ? -Math.PI / 2 : Math.PI / 2);
  k.box(0.6, 0.3, 0.55, x + fx * 0.55, y + 1.95, z, G.white);
  k.cyl(0.32, 0.0, 0.8, x + fx * 0.55, y + 2.1, z, G.white, { seg: 6 });
}

/** The shell's real openings of a church (shared/churchesShell.ts), in its hall's frame. */
export function churchRows(h: GothicHall): ChurchOpening[] {
  return inFrame(SHELL_OPENINGS.filter((o) => o.church === h.id), h.plan.origin, h.plan.yaw) as ChurchOpening[];
}

/** The church inside, built from its plan at the shell's place. */
export function buildGothicHall(h: GothicHall): LandmarkRoom {
  const P = h.plan;
  const { L, H, S: SH } = h;
  ribEdges.clear();
  const { scene, group, toWorld } = frameRoom(P.origin, P.yaw, 0x2a2622);
  scene.background = null;
  group.position.y = P.floorY;
  group.updateMatrixWorld(true);
  const fog = scene.fog as THREE.Fog;
  fog.near = 22;
  fog.far = 110;
  const k = new Kit(group);
  k.shadeTop = 18;
  const r = rand(h.id === "stpaul" ? 1517 : 1491);
  const paul = h.id === "stpaul";
  const S = paul ? G.white : G.sand; // the columns', arcades' and ribs' stone
  const WALL = G.wash;
  const flames = new Flames(group, 320, 0.14);
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.4, tint?: number) =>
    k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile, tint });
  const pics = paul ? PICS.paul : PICS.james;
  const arcTop = H.aisleSpring + H.aisleRise; // the arcade walls reach the aisles' vault crowns
  // the aisles' vaults across and along (issue #10: St Paul's lower, under the valleys of the aisles' row of cross
  // gables, 10.5 over the street at each bay's line: from inside, through the real windows, the street's roofs are drawn
  // too, and a vault over them was hidden by them)
  const aisleRiseX = paul ? 1.85 : H.aisleRise * 0.8;
  const aisleRiseZ = paul ? 4.5 : H.aisleRise;
  const naveTop = H.naveSpring + H.naveRise;
  const z0n = L.tower ? L.tower.z1 : L.west; // where the nave's arcades begin

  // ---- issue #10 (interiors are real): every wall of the hall behind a face of the shell is a lining
  // (world/realOpenings.ts), from the windows' reveals' back (SH.reveal) to the hall's inner face (SH.lining in),
  // cut exactly where the shell's windows and doors are; the glass is the shell's old panes, moved in (churchGlass).
  // Heights of the linings in world metres (W: from the hall's floor).
  const FY = P.floorY;
  const W = (y: number) => y + FY;
  const rows = churchRows(h);
  const face = (a: [number, number], c: [number, number], n: [number, number]): ShellFace => ({ a, c, n });
  type LOpts = { from?: number; to?: number; u0: number; u1: number; y0: number; y1: number; top?: Array<[number, number]>; doors?: Lining["doors"] };
  // (the linings' inner faces as lines: the sun's shafts do not pass through them, churches.ts sunWindowsOf)
  const wallLines: Array<[[number, number], [number, number]]> = [];
  const LIN = (def: MatDef, f: ShellFace, o: LOpts) => {
    const to = o.to ?? SH.lining;
    const fl = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
    const P = (u: number): [number, number] => [f.a[0] + ((f.c[0] - f.a[0]) * u) / fl - f.n[0] * to, f.a[1] + ((f.c[1] - f.a[1]) * u) / fl - f.n[1] * to];
    wallLines.push([P(o.u0), P(o.u1)]);
    return lining(k, def, { face: f, from: o.from ?? SH.reveal, to, u0: o.u0, u1: o.u1, y0: o.y0, y1: o.y1, top: o.top, doors: o.doors }, rows, FY, 2.6);
  };
  /** A pointed arch of the room's own cut from a lining's bottom (u along its face, local springing and rise). */
  const arch = (u0: number, u1: number, spring: number, rise: number) => {
    const o: Opening = { u0, u1, y0: 0, spring, head: "pointed", rise };
    return { u0, u1, top: W(spring + rise), head: headPts(o).map(([u, y]) => [u, W(y)] as [number, number]) };
  };
  const cos10 = Math.cos(Math.PI / 10);
  /** A corner of a five-sided end (the apse's, the ambulatory's) round (0, cz) at circumradius R. */
  const fivePt = (i: number, R: number, cz: number): [number, number] => {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    return [-Math.sin(a) * R, cz + Math.cos(a) * R];
  };
  const outOf = (p: [number, number], q: [number, number], c: [number, number]): [number, number] => {
    const mx = (p[0] + q[0]) / 2 - c[0];
    const mz = (p[1] + q[1]) / 2 - c[1];
    const l = Math.hypot(mx, mz);
    return [mx / l, mz / l];
  };
  const len = (p: [number, number], q: [number, number]) => Math.hypot(q[0] - p[0], q[1] - p[1]);

  // ================= floors
  for (const f of P.levels[0].floors) {
    if (f.maxZ <= 0.001) continue; // the porch is the street's
    box(f.minX, f.maxX, -0.12, 0, f.minZ, f.maxZ, G.floor, SLAB_TILE);
  }
  // the choir and the apse (and the ambulatory with its chapels) under the parts Jef does not walk: floored all the
  // same, a little lower
  {
    const xr = SH.amb ? SH.amb + 0.2 : L.choir + 0.2;
    box(-xr, xr, -0.16, -0.035, L.tx[1], L.apse.z + (SH.amb ? SH.amb + 1.7 : L.apse.r + 0.3), G.floor, SLAB_TILE);
  }
  // ================= the west front: lined behind the shell's face, cut at its door and its windows
  if (paul) {
    // one face from the south aisle's corner to the north chapels': over the nave to the vault, the aisles to their
    // vaults' crowns, the chapels to their ceiling
    const u1 = SH.aisle + SH.chapel - 0.25;
    const A = W(H.aisleSpring + aisleRiseX + 0.3); // (over the aisles' vaults, under their roofs)
    const N = W(naveTop + 0.5);
    const C = W(H.chapelCeil + 0.2);
    LIN(WALL, face([SH.aisle, 0], [-SH.chapel, 0], [0, -1]), {
      to: L.west,
      u0: 0.25,
      u1,
      y0: W(-0.04),
      y1: N,
      top: [[0.25, A], [SH.aisle - SH.nave, A], [SH.aisle - SH.nave, N], [SH.aisle + SH.nave, N], [SH.aisle + SH.nave, A], [2 * SH.aisle, A], [2 * SH.aisle, C], [u1, C]],
    });
  } else {
    // the tower's west face (the door, the great window over it) to the tower hall's vault; the aisles' and the
    // north chapels' west fronts (their ends tucked into the tower hall's side walls)
    LIN(WALL, face([SH.nave, 0], [-SH.nave, 0], [0, -1]), { to: L.west, u0: 0.1, u1: 2 * SH.nave - 0.1, y0: W(-0.04), y1: W(H.towerSpring! + H.towerRise! + 0.4) });
    LIN(WALL, face([SH.aisle, 0], [SH.nave, 0], [0, -1]), { u0: 0.25, u1: SH.aisle - SH.nave + 0.1, y0: W(-0.12), y1: W(arcTop + 0.3) });
    const u1 = SH.chapel - SH.nave - 0.25;
    LIN(WALL, face([-SH.nave, 0], [-SH.chapel, 0], [0, -1]), {
      u0: -0.1,
      u1,
      y0: W(-0.12),
      y1: W(arcTop + 0.3),
      top: [[-0.1, W(arcTop + 0.3)], [SH.aisle - SH.nave, W(arcTop + 0.3)], [SH.aisle - SH.nave, W(H.chapelCeil + 0.2)], [u1, W(H.chapelCeil + 0.2)]],
    });
  }
  // ================= the tower hall (St James): its side walls with arches to the aisles, the great arch to the nave,
  // its vault (issue #10: raised over the great west window's head, which it had cut across)
  if (L.tower) {
    const T = L.tower;
    const top = H.towerSpring! + H.towerRise! + 0.4;
    for (const sg of [-1, 1]) {
      const x = sg * (T.half + 0.32); // (its outer face 2 cm before the shell's tower face, in the aisle)
      // (to the east wall's middle: that wall's ends close these, no two faces in one plane)
      const [za, zb] = sg < 0 ? [T.z1 + 0.25, 0.3] : [0.3, T.z1 + 0.25];
      const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
      const o = [4.4, 8.0].map(toU).sort((p, q) => p - q);
      wallG(k, S, [x, za], [x, zb], -0.12, top, 0.6, [{ u0: o[0], u1: o[1], y0: -0.12, spring: 6.0, head: "pointed", rise: 2.8 }], [], 2.4);
    }
    // (its ends 6 cm proud of the side walls' faces, inside the arcade walls)
    wallG(k, S, [-T.half - 0.66, T.z1 + 0.3], [T.half + 0.66, T.z1 + 0.3], -0.12, top, 0.6,
      [{ u0: 1.06, u1: 2 * T.half + 0.26, y0: -0.12, spring: 11.5, head: "pointed", rise: 5.6 }], [], 2.4);
    groin(k, G.vault, S, -T.half, T.half, 1.4, T.z1, H.towerSpring!, H.towerRise!, H.towerRise!);
  }
  // ================= the arcades: columns, pointed arches, the walls over them; the clerestory lined behind the shell
  const colsZ = L.bays.slice(1, -1).filter((b) => b > z0n + 0.5);
  // (the arcade walls up to where the shell's clerestory face begins over the aisles' roofs; the linings from there)
  const clereFoot = paul ? arcTop + 0.9 : 18.75;
  for (const sg of [-1, 1]) {
    const x = sg * L.nave;
    const zs = [z0n, ...colsZ, L.tx[0]];
    // (beside St James's tower: from inside its east wall, so the two do not share a face)
    const zs0 = zs[0] + (L.tower ? 0.3 : 0);
    const [za, zb] = sg < 0 ? [zs[zs.length - 1], zs0] : [zs0, zs[zs.length - 1]];
    const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
    const openings: Opening[] = [];
    for (let i = 0; i + 1 < zs.length; i++) {
      const p = toU(i === 0 ? zs0 + 0.2 : zs[i] + 0.55);
      const q = toU(zs[i + 1] - (i === zs.length - 2 ? 0.75 : 0.55));
      openings.push({ u0: Math.min(p, q), u1: Math.max(p, q), y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise });
    }
    // (the arcade wall from the clerestory lining's inner face to 0.35 past the arcade's line, under the aisles' roofs)
    const xin = SH.nave - SH.lining;
    const xout = L.nave + 0.35;
    const xw = sg * ((xin + xout) / 2);
    const [wa, wb]: [[number, number], [number, number]] = [
      [xw, za],
      [xw, zb],
    ];
    wallG(k, S, wa, wb, -0.12, clereFoot, xout - xin, openings, [], 2.6);
    // the clerestory, lined behind the shell's face, flush with the arcade wall
    const z0c = L.tower ? L.tower.z1 : 0;
    LIN(S, face([sg * SH.nave, z0c], [sg * SH.nave, L.tx[0]], [sg, 0]), {
      u0: L.tower ? 0.1 : L.west - 0.2,
      u1: L.tx[0] - z0c + 0.1,
      y0: W(clereFoot),
      y1: W(naveTop + 0.3),
    });
    for (const zz of colsZ) {
      column(k, S, x, zz, 0, H.cap, 0.5);
      if (!paul) statueOnColumn(k, x, zz, H.cap - 2.8, -sg);
    }
    // the triforium's openwork parapet along the nave, over the aisles' crowns, before the wall's face
    const yt = arcTop + 0.4;
    const xp = sg * (xin - 0.12);
    box(xp - 0.12, xp + 0.12, yt, yt + 0.12, zs[0] + 0.3, zs[zs.length - 1] - 0.3, S, 2.4);
    box(xp - 0.12, xp + 0.12, yt + 0.9, yt + 1.02, zs[0] + 0.3, zs[zs.length - 1] - 0.3, S, 2.4);
    for (let zz = zs[0] + 0.5; zz < zs[zs.length - 1] - 0.4; zz += 0.45) k.box(0.1, 0.78, 0.1, xp, yt + 0.51, zz, S);
  }
  // the crossing's four piers
  for (const zz of L.tx) for (const sg of [-1, 1]) pier(k, S, sg * L.nave, zz, H.naveSpring, 0.62);
  // ================= the aisles' outer walls: lined behind the shell's, arches into the chapels, the windows over them
  // St Paul's aisles' walls under their row of cross gables: the linings' tops follow the gables (a little over)
  const gables: Array<[number, number]> | undefined = paul
    ? L.bays.flatMap((b, i) => (i + 1 < L.bays.length ? [[b, W(10.5 - FY + 0.25)], [(b + L.bays[i + 1]) / 2, W(14.5 - FY + 0.25)]] : [[b, W(10.5 - FY + 0.25)]])) as Array<[number, number]>
    : undefined;
  for (const sg of [-1, 1]) {
    const ch = L.chapels.find((c) => c.side === sg);
    const doors: Lining["doors"] = [];
    if (ch) {
      const bs = [ch.z0, ...L.bays.slice(1, -1).filter((b) => b > ch.z0 + 0.5 && b < ch.z1 - 0.5), ch.z1];
      for (let i = 0; i + 1 < bs.length; i++) {
        const p = bs[i] + (i === 0 ? 0.05 : 0.3);
        const q = i === bs.length - 2 ? Math.min(bs[i + 1] - 0.05, L.tx[0] - 0.3) : bs[i + 1] - 0.3;
        doors.push(arch(p, q, ch.ceil - 1.8, 1.7));
      }
    }
    LIN(WALL, face([sg * SH.aisle, 0], [sg * SH.aisle, L.tx[0]], [sg, 0]), {
      u0: 0.25,
      u1: L.tx[0] + SH.reveal + 0.1,
      y0: W(-0.12),
      y1: gables ? W(14.5 - FY + 0.25) : W(arcTop + 0.3),
      top: gables,
      doors,
    });
    if (ch) {
      // the chapels: their outer wall lined (St Paul's north chapels in one line with the transept's north end, lined
      // below), their partitions, a flat panelled ceiling
      const zc0 = paul ? 0 : ch.side < 0 ? 0 : ch.z0 - 0.25;
      if (!paul)
        LIN(WALL, face([sg * SH.chapel, zc0], [sg * SH.chapel, L.tx[0]], [sg, 0]), { u0: 0.25, u1: L.tx[0] + SH.reveal + 0.1 - zc0, y0: W(-0.12), y1: W(ch.ceil + 0.12) });
      for (const b of L.bays.slice(1, -1).filter((b) => b > ch.z0 + 0.5 && b < ch.z1 - 0.5))
        // (into both linings: no seam; 2 cm inside the arches' reveals: not in their faces)
        box(Math.min(ch.x, sg * L.aisle) - 0.1, Math.max(ch.x, sg * L.aisle) + 0.1, -0.12, ch.ceil + 0.05, b - 0.28, b + 0.28, WALL);
      box(Math.min(ch.x, sg * L.aisle) - 0.1, Math.max(ch.x, sg * L.aisle) + 0.1, ch.ceil, ch.ceil + 0.14, ch.z0 - 0.1, ch.z1 + 0.1, G.vault, 2.4, 1.45);
      // its ceiling's beams across each chapel
      for (let zz = ch.z0 + 1.0; zz < ch.z1 - 0.5; zz += 1.6)
        box(Math.min(ch.x, sg * L.aisle), Math.max(ch.x, sg * L.aisle), ch.ceil - 0.22, ch.ceil, zz - 0.1, zz + 0.1, G.oakPlain, 1.2, 1.3);
      // a small altar in each chapel under its window (the shell's)
      for (const w of rows.filter((o) => o.kind === "window" && o.zone === "hall" && Math.abs(o.x - sg * SH.chapel) < 0.05 && o.z > ch.z0 && o.z < ch.z1)) {
        box(ch.x - sg * 0.9, ch.x - sg * 0.1, 0, 1.0, w.z - 1.0, w.z + 1.0, G.marbleB, 1.2);
        box(ch.x - sg * 0.95, ch.x - sg * 0.05, 1.0, 1.08, w.z - 1.05, w.z + 1.05, G.marbleW, 1.2);
        for (const d of [-0.5, 0.5]) {
          k.cyl(0.022, 0.022, 0.26, ch.x - sg * 0.5, 1.08, w.z + d, G.wax, { seg: 4 });
          flames.addFlame(ch.x - sg * 0.5, 1.4, w.z + d);
        }
      }
      if (!paul && sg > 0) box(L.aisle - 0.1, ch.x + 0.1, -0.12, ch.ceil + 0.1, ch.z0 - 0.5, ch.z0, WALL); // the baptistery's wall
    }
  }
  // ================= the vaults: the nave bay by bay, the aisles, the crossing and the arms, the choir, the apse
  // (each a little into the linings round it: no seam at the walls)
  const naveBays = [z0n, ...colsZ, L.tx[0]];
  for (let i = 0; i + 1 < naveBays.length; i++) groin(k, G.vault, S, -L.nave + 0.35, L.nave - 0.35, naveBays[i], naveBays[i + 1], H.naveSpring, H.naveRise, H.naveRise);
  const aisleBays = [L.tower ? 0.55 : L.west, ...L.bays.slice(1, -1).filter((b) => b > 0.8), L.tx[0] + SH.reveal + 0.1];
  for (const sg of [-1, 1])
    for (let i = 0; i + 1 < aisleBays.length; i++) {
      // (beside St James's tower the aisle's vault meets the tower's side wall)
      const xi = L.tower && aisleBays[i + 1] <= L.tower.z1 + 0.01 ? L.tower.half + 0.6 : L.nave + 0.35;
      const [xa, xb] = sg < 0 ? [-L.aisle - 0.1, -xi] : [xi, L.aisle + 0.1];
      groin(k, G.vault, S, xa, xb, aisleBays[i], aisleBays[i + 1], H.aisleSpring, aisleRiseX, aisleRiseZ);
    }
  groin(k, G.vault, S, -L.nave + 0.35, L.nave - 0.35, L.tx[0], L.tx[1], H.naveSpring, H.naveRise, H.naveRise);
  for (const sg of [-1, 1]) {
    // (the arms' vaults end in their west and east faces' linings, behind the shell's faces)
    const xs = [L.nave - 0.35, (L.nave + L.arm) / 2, L.arm + 0.1].map((v) => sg * v);
    for (let i = 0; i + 1 < xs.length; i++)
      groin(k, G.vault, S, Math.min(xs[i], xs[i + 1]), Math.max(xs[i], xs[i + 1]), L.tx[0] + SH.reveal + 0.05, L.tx[1] - SH.reveal - 0.05, H.naveSpring, H.naveRise, H.naveRise);
  }
  // ================= the transept: its ends with the great windows, its west and east faces over the aisles
  const T0 = L.tx[0];
  const T1 = L.tx[1];
  const armTop = W(naveTop + 0.3);
  for (const sg of [-1, 1]) {
    // the arm's end (St Paul's north end is lined with the north chapels, in one line)
    if (!(paul && sg < 0)) LIN(WALL, face([sg * SH.arm, T0], [sg * SH.arm, T1], [sg, 0]), { u0: 0.25, u1: T1 - T0 - 0.25, y0: W(-0.12), y1: armTop });
    // the arm's west face: the arch from the aisle, the window over the aisle's roof (u from the face's start)
    {
      const [a, c]: [[number, number], [number, number]] = sg < 0 ? [[-SH.nave, T0], [-SH.arm, T0]] : [[SH.arm, T0], [SH.nave, T0]];
      const toU = (x: number) => (sg < 0 ? -SH.nave - x : SH.arm - x);
      const ua = toU(sg * (L.nave + 0.35));
      const ub = toU(sg * L.aisle);
      LIN(WALL, face(a, c, [0, -1]), {
        u0: sg < 0 ? 0 : 0.25,
        u1: sg < 0 ? SH.arm - SH.nave - 0.25 : SH.arm - SH.nave,
        y0: W(-0.12),
        y1: armTop,
        doors: [arch(Math.min(ua, ub), Math.max(ua, ub), H.aisleSpring - 0.2, Math.min(H.aisleRise * 0.76, aisleRiseX - 0.1))], // (under the aisle's vault's end)
      });
    }
    // the arm's east face: St James's arches into the choir's aisles; St Paul's north one lined, its south one a wall
    // against the tower (the shell has no face there under the tower's)
    if (paul && sg > 0) {
      const zq = T1 - SH.lining + 0.125;
      wallG(k, WALL, [SH.nave - 0.45, zq], [L.arm + 0.25, zq], -0.12, naveTop + 0.3, 0.25, [], [], 2.6);
      wallLines.push([[SH.nave - 0.45, T1 - SH.lining], [L.arm + 0.25, T1 - SH.lining]]);
    } else {
      const [a, c]: [[number, number], [number, number]] = sg < 0 ? [[-SH.nave, T1], [-SH.arm, T1]] : [[SH.arm, T1], [SH.nave, T1]];
      const toU = (x: number) => (sg < 0 ? -SH.nave - x : SH.arm - x);
      const doors: Lining["doors"] = [];
      if (L.amb) {
        const ua = toU(sg * (L.nave + 0.35));
        const ub = toU(sg * L.amb);
        doors.push(arch(Math.min(ua, ub), Math.max(ua, ub), H.ambSpring ?? H.aisleSpring, (H.ambRise ?? 2) * 0.76));
      }
      LIN(WALL, face(a, c, [0, 1]), { u0: sg < 0 ? 0 : 0.25, u1: sg < 0 ? SH.arm - SH.nave - 0.25 : SH.arm - SH.nave, y0: W(-0.12), y1: armTop, doors });
    }
  }
  if (paul) {
    // the north chapels' outer wall and the north arm's end: one face of the shell, lined together (the chapels to
    // their ceiling, the arm to its vault)
    const ch = L.chapels[0];
    LIN(WALL, face([-SH.chapel, 0], [-SH.chapel, T1], [-1, 0]), {
      u0: 0.25,
      u1: T1 - 0.25,
      y0: W(-0.12),
      y1: armTop,
      top: [[0.25, W(ch.ceil + 0.12)], [ch.z1, W(ch.ceil + 0.12)], [ch.z1, armTop], [T1 - 0.25, armTop]],
    });
  }
  // ================= the choir, its apse (and St James's choir aisles and ambulatory)
  const cz0 = L.tx[1];
  const cz1 = L.apse.z;
  const chFoot = L.amb ? 16.35 : -0.12; // (St James's choir: an arcade to its aisles under the clerestory)
  for (const sg of [-1, 1]) {
    const x = sg * (L.choir + 0.12);
    const [za, zb] = sg < 0 ? [cz1, cz0] : [cz0, cz1];
    const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
    if (L.amb) {
      // an arcade to the choir aisle, the clerestory over it lined behind the shell's
      const mid = (cz0 + cz1) / 2;
      const openings: Opening[] = [
        { u0: Math.min(toU(cz0 + 0.8), toU(mid - 0.55)), u1: Math.max(toU(cz0 + 0.8), toU(mid - 0.55)), y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise },
        { u0: Math.min(toU(mid + 0.55), toU(cz1 - 0.3)), u1: Math.max(toU(mid + 0.55), toU(cz1 - 0.3)), y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise },
      ];
      wallG(k, S, [x, za], [x, zb], -0.12, chFoot, 0.5, openings, [], 2.6);
      column(k, S, sg * L.choir, mid, 0, H.cap, 0.45);
      // the choir aisle's outer wall (lined), its vault
      LIN(WALL, face([sg * SH.amb!, cz0], [sg * SH.amb!, cz1], [sg, 0]), { u0: -0.5, u1: cz1 - cz0 + 0.25, y0: W(-0.12), y1: W(H.ambCeil! + 0.2) });
      groin(k, G.vault, S, sg < 0 ? -L.amb - 0.1 : L.choir + 0.35, sg < 0 ? -L.choir - 0.35 : L.amb + 0.1, cz0, cz1, H.ambSpring ?? 7, (H.ambRise ?? 3) * 0.8, H.ambRise ?? 3);
    }
    // the choir's side lined behind the shell's (St James's from the clerestory's foot, flush with the arcade wall)
    LIN(L.amb ? S : WALL, face([sg * SH.choir, cz0], [sg * SH.choir, cz1], [sg, 0]), {
      to: L.amb ? SH.choir - (L.choir + 0.12 - 0.25) : SH.lining,
      u0: -SH.lining,
      u1: cz1 - cz0 + 0.25,
      y0: W(chFoot),
      y1: W(naveTop + 0.3),
    });
  }
  {
    const nb = Math.max(1, Math.round((cz1 - cz0) / 6.5));
    for (let i = 0; i < nb; i++)
      groin(k, G.vault, S, -L.choir - 0.1, L.choir + 0.1, cz0 + ((cz1 - cz0) * i) / nb, cz0 + ((cz1 - cz0) * (i + 1)) / nb, H.naveSpring, H.naveRise * (L.choir / L.nave), H.naveRise);
  }
  // the apse: five sides lined behind the shell's (St James: an arcade on columns into the ambulatory under the
  // clerestory), a ribbed half dome over the windows' heads (St James's shallow, under the choir's vault's crown)
  const apseC: [number, number] = [0, cz1];
  const R5 = L.apse.r + 0.12; // (St James's arcade walls' line)
  const apsePt = (i: number): [number, number] => fivePt(i, R5, cz1);
  const shellApse = (i: number): [number, number] => fivePt(i, SH.apse, cz1);
  const apseIn = L.amb ? SH.apse - (SH.apse * cos10 - (R5 * cos10 - 0.225)) / cos10 : L.apse.r; // the lining's inner corners
  const domeY = L.amb ? H.apseSpring! : 19.0;
  const domeR = L.amb ? apseIn : L.apse.r;
  const domeH = L.amb ? H.apseRise! : domeR;
  for (let i = 0; i < 5; i++) {
    const p0 = shellApse(i);
    const p1 = shellApse(i + 1);
    const Lw = len(p0, p1);
    LIN(L.amb ? S : WALL, face(p0, p1, outOf(p0, p1, apseC)), {
      to: L.amb ? SH.apse * cos10 - (R5 * cos10 - 0.225) : SH.lining,
      u0: -0.25,
      u1: Lw + 0.25,
      y0: W(L.amb ? 16.35 : -0.12),
      y1: W(domeY + 0.2),
    });
    if (L.amb) {
      // the arcade into the ambulatory, the wall over it to the clerestory's foot
      const a0 = apsePt(i);
      const a1 = apsePt(i + 1);
      const La = len(a0, a1);
      wallG(k, S, a0, a1, -0.12, 16.35, 0.45, [{ u0: 0.5, u1: La - 0.5, y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise }], [], 2.6);
      column(k, S, a0[0], a0[1], 0, H.cap, 0.4);
    }
  }
  {
    const gdome = new THREE.SphereGeometry(domeR, 16, 8, 0, Math.PI, 0, Math.PI / 2);
    gdome.scale(1, domeH / domeR, 1);
    gdome.computeVertexNormals();
    planarUV(gdome, 3.0);
    k.add(gdome, G.vault, 0, domeY, cz1, { flat: true, tint: 0.95 });
    const Rr = domeR - 0.12;
    const Hr = domeH * (Rr / domeR);
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 5;
      for (let j = 0; j < 5; j++) {
        const t0 = (Math.PI / 2) * (j / 5);
        const t1 = (Math.PI / 2) * ((j + 1) / 5);
        const P0 = new THREE.Vector3(-Math.sin(a) * Math.cos(t0) * Rr, domeY + Math.sin(t0) * Hr, cz1 + Math.cos(a) * Math.cos(t0) * Rr);
        const P1 = new THREE.Vector3(-Math.sin(a) * Math.cos(t1) * Rr, domeY + Math.sin(t1) * Hr, cz1 + Math.cos(a) * Math.cos(t1) * Rr);
        const bl = P0.distanceTo(P1);
        const bx = new THREE.BoxGeometry(0.2, 0.18, bl);
        bx.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), P1.clone().sub(P0).normalize()));
        bx.translate((P0.x + P1.x) / 2, (P0.y + P1.y) / 2, (P0.z + P1.z) / 2);
        k.add(bx, S, 0, 0, 0, { flat: true });
      }
    }
    // the wall over the choir's vault's end, closing the apse's taller space toward the choir (seen from the apse)
    const xw = domeR + 0.25;
    wallG(k, WALL, [-xw, cz1 + 0.07], [xw, cz1 + 0.07], H.naveSpring - 0.3, domeY + domeH + 0.3, 0.1,
      [{ u0: xw - L.choir - 0.1, u1: xw + L.choir + 0.1, y0: H.naveSpring - 0.3, spring: H.naveSpring, head: "pointed", rise: H.naveRise * (L.choir / L.nave) }], [], 2.6);
  }
  if (L.amb) {
    // ---- the ambulatory: its five sides lined behind the shell's; the three radiating chapels (1626-38) open off the
    // middle ones (the shell's bays, 1.5 m out, their windows lined; Rubens's in the axis), railed off; a flat
    // panelled ceiling over its windows' heads, closed toward the choir's aisles over their vaults
    const RA = SH.amb!;
    const ceil = H.ambCeil!;
    const chCeil = 10.2; // the radiating chapels' ceiling, over their windows' heads (9.6 over the street)
    const ambPt = (i: number): [number, number] => fivePt(i, RA, cz1);
    const iron = G.iron;
    for (let i = 0; i < 5; i++) {
      const a = ambPt(i);
      const b = ambPt(i + 1);
      const Lw = len(a, b);
      const md = outOf(a, b, apseC);
      const radiating = i >= 1 && i <= 3;
      LIN(WALL, face(a, b, md), { u0: -0.25, u1: Lw + 0.25, y0: W(-0.12), y1: W(ceil + 0.2), doors: radiating ? [{ u0: 0.9, u1: Lw - 0.9, top: W(chCeil) }] : [] });
      if (!radiating) continue;
      // the chapel's bay: q0 .. q3 on the ambulatory's side, 1.5 m out (build_churches.py stjacob)
      const tn: [number, number] = [(b[0] - a[0]) / Lw, (b[1] - a[1]) / Lw];
      const q0: [number, number] = [a[0] + tn[0] * 0.9, a[1] + tn[1] * 0.9];
      const q3: [number, number] = [b[0] - tn[0] * 0.9, b[1] - tn[1] * 0.9];
      const q1: [number, number] = [q0[0] + md[0] * 1.5 + tn[0] * 0.9, q0[1] + md[1] * 1.5 + tn[1] * 0.9];
      const q2: [number, number] = [q3[0] + md[0] * 1.5 - tn[0] * 0.9, q3[1] + md[1] * 1.5 - tn[1] * 0.9];
      const sides: Array<[[number, number], [number, number], number, number]> = [
        [q0, q1, 0, 0.3],
        [q1, q2, -0.3, 0.3],
        [q2, q3, -0.3, 0],
      ];
      const nOf = (p: [number, number], q: [number, number]): [number, number] => {
        const d = [q[0] - p[0], q[1] - p[1]];
        const l = Math.hypot(d[0], d[1]);
        const n: [number, number] = [d[1] / l, -d[0] / l];
        return n[0] * md[0] + n[1] * md[1] >= 0 ? n : [-n[0], -n[1]];
      };
      for (const [p, q, e0, e1] of sides) LIN(WALL, face(p, q, nOf(p, q)), { u0: e0, u1: len(p, q) + e1, y0: W(-0.12), y1: W(chCeil + 0.12) });
      // the mouth's jambs: from the ambulatory's lining to the bay's side linings (the corner behind them closed)
      for (const [qq, qn] of [[q0, nOf(q0, q1)], [q3, nOf(q2, q3)]] as Array<[[number, number], [number, number]]>) {
        const A = [qq[0] - md[0] * SH.lining, qq[1] - md[1] * SH.lining];
        const B = [qq[0] - qn[0] * SH.lining, qq[1] - qn[1] * SH.lining];
        const y0 = -0.12;
        const y1 = chCeil + 0.1;
        const pos = [A[0], y0, A[1], B[0], y0, B[1], B[0], y1, B[1], A[0], y0, A[1], B[0], y1, B[1], A[0], y1, A[1]];
        const both = [...pos, ...[0, 2, 1, 3, 5, 4].flatMap((v) => pos.slice(v * 3, v * 3 + 3))];
        const gq = new THREE.BufferGeometry();
        gq.setAttribute("position", new THREE.Float32BufferAttribute(both, 3));
        gq.computeVertexNormals();
        planarUV(gq, 2.6);
        k.add(gq, WALL, 0, 0, 0, { flat: true });
      }
      // its ceiling (the bay's outline, into the linings)
      const sh = new THREE.Shape([q0, q1, q2, q3].map(([x, zz]) => new THREE.Vector2(x, zz)));
      const gc = new THREE.ShapeGeometry(sh, 1);
      gc.rotateX(Math.PI / 2);
      gc.translate(0, chCeil, 0);
      planarUV(gc, 2.4);
      k.add(gc, G.vault, 0, 0, 0, { flat: true, tint: 0.92 });
      // the iron rail across its mouth, on the ambulatory's side (the bay is shallow: Rubens's altar table stands in the mouth)
      const mx = (q0[0] + q3[0]) / 2 + md[0] * (-SH.lining - 0.1);
      const mz = (q0[1] + q3[1]) / 2 + md[1] * (-SH.lining - 0.1);
      const w = len(q0, q3) - 0.2;
      const ry = Math.atan2(-tn[1], tn[0]);
      k.box(w, 0.05, 0.05, mx, 1.0, mz, iron, { ry });
      k.box(w, 0.04, 0.04, mx, 0.15, mz, iron, { ry });
      for (let s = -w / 2; s <= w / 2 + 1e-6; s += 0.15) k.box(0.025, 0.85, 0.025, mx + tn[0] * s, 0.575, mz + tn[1] * s, iron);
    }
    // the ambulatory's ceiling: a flat panelled vault round the apse, into the linings
    const sh = new THREE.Shape();
    const RAin = RA - SH.lining / cos10 + 0.1;
    for (let i = 0; i <= 5; i++) {
      const [x, zz] = fivePt(i, RAin, cz1);
      if (i === 0) sh.moveTo(x, zz - cz1);
      else sh.lineTo(x, zz - cz1);
    }
    for (let i = 5; i >= 0; i--) {
      const [x, zz] = apsePt(i);
      sh.lineTo(x, zz - cz1);
    }
    const gc = new THREE.ShapeGeometry(sh, 1);
    gc.rotateX(Math.PI / 2);
    gc.translate(0, ceil, cz1);
    planarUV(gc, 2.4);
    k.add(gc, G.vault, 0, 0, 0, { flat: true, tint: 0.92 });
    // over the choir's aisles' vaults' ends: a wall up to the ambulatory's ceiling
    for (const sg of [-1, 1]) {
      const xa = sg < 0 ? -(RA - SH.lining + 0.1) : R5;
      const xb = sg < 0 ? -R5 : RA - SH.lining + 0.1;
      const ga = sg < 0 ? -L.amb - 0.1 : L.choir + 0.35;
      const gb = sg < 0 ? -L.choir - 0.35 : L.amb + 0.1;
      wallG(k, WALL, [xa, cz1 + 0.06], [xb, cz1 + 0.06], (H.ambSpring ?? 7) - 0.3, ceil + 0.05, 0.1,
        [{ u0: ga - xa, u1: gb - xa, y0: (H.ambSpring ?? 7) - 0.3, spring: H.ambSpring ?? 7, head: "pointed", rise: (H.ambRise ?? 3) * 0.8 }], [], 2.6);
    }
  }
  // ================= furnishing
  const F = h.F;
  // the floor's chairs in rows
  for (const b of F.chairs)
    for (let zz = b.minZ + 0.3; zz < b.maxZ - 0.2; zz += 0.95)
      for (let x = b.minX + 0.25; x < b.maxX - 0.1; x += 0.52) {
        k.box(0.42, 0.05, 0.4, x, 0.45, zz, G.rush, { tint: 0.9 + r() * 0.2 });
        k.box(0.4, 0.42, 0.34, x, 0.21, zz, G.oakPlain, { tint: 0.7 });
        k.box(0.42, 0.5, 0.04, x, 0.72, zz + 0.2, G.oakPlain, { tint: 0.85 });
      }
  pulpit(k, F.pulpit.x, F.pulpit.z, F.pulpit.x < 0 ? 1 : -1);
  for (const c of F.confessionals) confessional(k, c.x, c.side, c.z);
  for (const a of F.altars) {
    const ry = a.face === -1 ? -Math.PI / 2 : a.face === 1 ? Math.PI / 2 : 0;
    altar(k, flames, a.x, a.z, a.w, a.h, pics[a.pic], ry, a.pic !== "chapel");
    if (a.pic === "altar") {
      // the high altar's great marble portico rising to the vault: columns, an entablature, statues, the glory
      const zb = a.z - 0.3;
      for (const sx of [-1, 1])
        for (const d of [0.0, 0.8]) {
          const x = a.x + sx * (a.w / 2 + 0.4 + d);
          k.box(0.8, 1.6, 0.8, x, 0.8, zb, G.marbleW, { tile: 1.2 });
          k.cyl(0.28, 0.32, a.h - 2.6, x, 1.6, zb, G.marbleB, { seg: 10, tile: 1.2 });
          k.box(0.8, 0.5, 0.8, x, a.h - 0.75, zb, G.gilt);
        }
      box(a.x - a.w / 2 - 1.8, a.x + a.w / 2 + 1.8, a.h - 0.5, a.h + 0.4, zb - 0.5, zb + 0.5, G.marbleB, 1.2);
      box(a.x - a.w / 2 - 1.9, a.x + a.w / 2 + 1.9, a.h + 0.4, a.h + 0.6, zb - 0.6, zb + 0.6, G.marbleW, 1.2);
      figure(k, G.statue, a.x, a.h + 0.6, zb, 2.2, 0);
      for (const sx of [-1, 1]) {
        figure(k, G.statue, a.x + sx * (a.w / 2 + 1.2), a.h + 0.6, zb, 1.7, 0, true);
        figure(k, G.statue, a.x + sx * (a.w / 2 + 2.3), 1.6, zb - 0.6, 1.9, 0);
      }
      const rays = new THREE.CircleGeometry(1.4, 16);
      k.add(rays, G.gilt, a.x, a.h + 3.3, zb + 0.1, { ry: Math.PI, flat: true });
      if (!paul) {
        // the great wooden scallop shell over St James's altar (hung with black cloth in 1873)
        const shell = new THREE.SphereGeometry(3.2, 12, 6, 0, Math.PI, 0, Math.PI / 2);
        shell.scale(1, 0.6, 0.5);
        k.add(shell, G.dark, a.x, a.h + 1.2, zb + 0.4, { rx: -Math.PI / 2, flat: true, tint: 0.5 });
      }
    }
    if (a.pic === "chapel" && !paul) {
      // Faydherbe's marble Mater Dolorosa over Rubens's painting; the epitaph slab before it
      figure(k, G.statue, a.x, a.h * 0.55 + 2.2, a.z - 0.2, 1.4, 0);
      box(a.x - 1.1, a.x + 1.1, 0, 0.02, a.z - 3.0, a.z - 1.6, G.marbleW, 1.2);
    }
  }
  if (!F.organ.screen) rail(k, F.rail.x0, F.rail.x1, F.rail.z, F.rail.gate);
  for (const s of F.stalls) stalls(k, s.x, s.z0, s.z1, s.side);
  // the font
  k.cyl(0.24, 0.32, 0.85, F.font.x, 0, F.font.z, G.marbleB, { seg: 8 });
  k.cyl(0.52, 0.3, 0.32, F.font.x, 0.85, F.font.z, G.marbleW, { seg: 10 });
  k.cyl(0.05, 0.4, 0.8, F.font.x, 1.17, F.font.z, G.oak, { seg: 8 });
  k.cyl(0.0, 0.07, 0.25, F.font.x, 1.97, F.font.z, G.gilt, { seg: 6 });
  {
    // the oak draught porch inside the west door (shared/gothicPlan.ts porch): a panelled front with its double door
    // shut (the way in is by the sides), a doorway each side, a cornice, a carved crest with a gilt figure
    const { x, z0, z1, t, door, h: ph, doorH } = h.porch;
    box(-x, x, 0, ph, z1 - t, z1, G.oak, 1.2);
    for (const s of [-1, 1]) {
      const [xa, xb] = s < 0 ? [-x, -x + t] : [x - t, x];
      box(xa, xb, 0, ph, z0, door[0], G.oak, 1.2);
      box(xa, xb, 0, ph, door[1], z1, G.oak, 1.2);
      box(xa, xb, doorH, ph, door[0], door[1], G.oak, 1.2);
      // the leaves of the front's shut double door, and the panels' frames
      box(s * 0.9 - 0.42, s * 0.9 + 0.42, 0.1, 2.5, z1 - t - 0.03, z1 - t, G.oakPlain, 1.2);
      box(s * 0.9 - 0.42, s * 0.9 + 0.42, 0.1, 2.5, z1, z1 + 0.03, G.oakPlain, 1.2);
    }
    box(-x - 0.12, x + 0.12, ph, ph + 0.16, z0, z1 + 0.12, G.oak, 1.2);
    box(-0.9, 0.9, ph + 0.16, ph + 0.62, z1 - 0.06, z1 + 0.04, G.oak, 1.2);
    figure(k, G.gilt, 0, ph + 0.16, z1 - 0.3, 0.9, 0, true);
  }
  // the organ: St Paul's on its west gallery (on two columns), St James's on the marble choir screen
  const O = F.organ;
  if (!O.screen) {
    box(O.x0, O.x1, O.y - 0.3, O.y, O.z0, O.z1, S, 2.4);
    box(O.x0, O.x1, O.y, O.y + 1.1, O.z1 - 0.12, O.z1, G.oak, 1.2);
    for (const x of [-2.6, 2.6]) column(k, S, x, O.z1, 0, O.y - 0.3, 0.28);
    organ(k, 0, O.y, (O.z0 + O.z1) / 2 - 0.2, 8.6, Math.PI);
  } else {
    // the choir screen (1669): a marble wall with a gate, pilasters, a cornice and a balustrade, the organ on it
    const zc = (O.z0 + O.z1) / 2;
    for (const [a, b] of [[O.x0, -F.rail.gate], [F.rail.gate, O.x1]] as Array<[number, number]>) box(a, b, 0, O.y, O.z0, O.z1, G.marbleB, 1.2);
    box(-F.rail.gate, F.rail.gate, 3.6, O.y, O.z0, O.z1, G.marbleB, 1.2);
    for (const x of [O.x0 + 0.2, -F.rail.gate - 0.2, F.rail.gate + 0.2, O.x1 - 0.2]) box(x - 0.2, x + 0.2, 0, O.y, O.z0 - 0.1, O.z0, G.marbleW, 1.2);
    box(O.x0 - 0.2, O.x1 + 0.2, O.y, O.y + 0.4, O.z0 - 0.2, O.z1 + 0.2, G.marbleW, 1.2);
    for (let x = O.x0 + 0.2; x < O.x1 - 0.1; x += 0.3) k.cyl(0.05, 0.08, 0.7, x, O.y + 0.4, O.z0 - 0.05, G.marbleW, { seg: 5 });
    box(O.x0, O.x1, O.y + 1.1, O.y + 1.22, O.z0 - 0.12, O.z0 + 0.02, G.marbleB, 1.2);
    // the gate: gilded bars
    for (let x = -F.rail.gate + 0.1; x < F.rail.gate; x += 0.14) k.box(0.03, 3.4, 0.03, x, 1.8, zc, G.gilt);
    for (const x of [-2.4, 2.4]) figure(k, G.statue, x, O.y + 0.4, O.z0 + 0.2, 1.5, 0);
    organ(k, 0, O.y + 0.4, zc + 0.3, 8.2, 0);
    // the crucifix on the screen (1865)
    k.box(0.14, 3.2, 0.14, 0, O.y + 9.2, zc - 0.3, G.oak);
    k.box(1.6, 0.14, 0.14, 0, O.y + 11.4, zc - 0.3, G.oak);
  }
  // St Paul's fifteen Mysteries of the Rosary in gilded frames along the north aisle wall
  F.paintings.forEach((p, i) => {
    const def = ROSARY[i % ROSARY.length];
    k.plane(p.w, p.h, p.x + p.face * 0.075, p.y, p.z, def, { ry: p.face > 0 ? Math.PI / 2 : -Math.PI / 2 });
    box(p.x + p.face * 0.02 - 0.03, p.x + p.face * 0.02 + 0.03, p.y - p.h / 2 - 0.1, p.y + p.h / 2 + 0.1, p.z - p.w / 2 - 0.1, p.z + p.w / 2 + 0.1, G.gilt, 1);
  });
  // the brass chandeliers over the nave and the crossing
  for (const zz of [(z0n + L.tx[0]) * 0.35, (z0n + L.tx[0]) * 0.65, (L.tx[0] + L.tx[1]) / 2]) chandelier(k, flames, 0, 10.5, zz, H.naveSpring + H.naveRise - 0.3);
  // brass crown chandeliers (lichtkronen) over the aisles, one a bay, hung low on three chains: an open ring of brass
  // with its candles on the rim (unlit by day)
  {
    const cy = paul ? 6.2 : 7.0;
    const R = 1.2;
    const xc = (L.nave + 0.35 + L.aisle) / 2;
    const bayZ = [L.tower ? 0.55 : L.west, ...L.bays.slice(1, -1).filter((b) => b > 0.8), L.tx[0]];
    for (const sg of [-1, 1])
      for (let i = 0; i + 1 < bayZ.length; i++) {
        const x = sg * xc;
        const zz = (bayZ[i] + bayZ[i + 1]) / 2;
        k.cyl(R, R, 0.3, x, cy, zz, G.brass, { seg: 16, open: true });
        k.cyl(R + 0.05, R + 0.05, 0.06, x, cy + 0.3, zz, G.brass, { seg: 16, open: true });
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2;
          k.cyl(0.028, 0.028, 0.24, x + Math.cos(a) * R, cy + 0.36, zz + Math.sin(a) * R, G.wax, { seg: 4 });
        }
        for (let j = 0; j < 3; j++) {
          const a = (j / 3) * Math.PI * 2 + 0.3;
          k.cyl(0.012, 0.012, H.aisleSpring + 0.8 - cy, x + Math.cos(a) * R * 0.95, cy + 0.3, zz + Math.sin(a) * R * 0.95, G.iron, { seg: 3 });
        }
      }
  }
  // candle stands before the side altars
  for (const a of F.altars.filter((q) => q.face !== 0)) {
    const sx = a.face === 2 ? 0 : -a.face;
    const x = a.x + sx * 2.2;
    const zz = a.face === 2 ? a.z - 2.0 : a.z + 2.8;
    box(x - 0.3, x + 0.3, 0, 0.9, zz - 0.3, zz + 0.3, G.iron, 1);
    for (let i = 0; i < 9; i++) {
      const cx = x - 0.2 + (i % 3) * 0.2;
      const cz = zz - 0.2 + Math.floor(i / 3) * 0.2;
      k.cyl(0.015, 0.015, 0.1 + (i % 3) * 0.05, cx, 0.9, cz, G.wax, { seg: 4 });
      flames.addFlame(cx, 1.02 + (i % 3) * 0.05, cz);
    }
  }
  k.finish();
  // ================= issue #28: the church's parts behind its other real windows (the towers' rooms and belfries, the
  // roof spaces, St Paul's convent, St James's baptistery and sacristy: world/churchSpaces.ts), seen from the street only
  buildChurchSpaces({
    church: h.id,
    group,
    origin: P.origin,
    yaw: P.yaw,
    floorY: FY,
    rows,
    mats: { wall: G.wash, stone: S, timber: M.oak, oak: G.oak, floor: G.floor, vault: G.vault, iron: G.iron, bronze: G.brass, dark: G.dark, marbleW: G.marbleW, marbleB: G.marbleB, gilt: G.gilt, statue: G.statue, linen: M.linen, red: M.red, blue: M.blue, pictures: [pics.chapel, pics.side] },
  });

  // ================= light: daylight through the windows, the candles, the chandeliers
  // the sun through the south windows on the floor, the columns' and arcades' shadows across it, the shafts; the
  // moon by night (world/hallSun.ts)
  const floors = P.levels[0].floors.filter((f) => f.maxZ > 0.001);
  const sunLight = buildHallSun(group, {
    floor: {
      minX: Math.min(...floors.map((f) => f.minX)),
      maxX: Math.max(...floors.map((f) => f.maxX)),
      minZ: Math.min(...floors.map((f) => Math.max(0, f.minZ))),
      maxZ: Math.max(...floors.map((f) => f.maxZ)),
    },
    floors,
    // (issue #10: the shell's real windows, at their glass)
    windows: sunWindowsOf(rows.filter((o) => o.zone === "hall"), FY, { yaw: P.yaw, lines: wallLines }),
    piers: [
      ...colsZ.flatMap((zz) => [-1, 1].map((sg) => ({ x: sg * L.nave, z: zz, r: 0.5, h: H.cap }))),
      ...L.tx.flatMap((zz) => [-1, 1].map((sg) => ({ x: sg * L.nave, z: zz, r: 0.62, h: H.naveSpring }))),
    ],
    screens: [-1, 1].map((sg) => ({ along: "z" as const, at: sg * L.nave, from: z0n, to: L.tx[0], open: H.cap + H.arcRise * 0.5 })),
    // the arcades' walls over their arches, up to the clerestory's sills: lit across the nave
    walls: [-1, 1].map((sg) => {
      const sill = Math.min(...rows.filter((o) => o.kind === "window" && o.zone === "hall" && Math.abs(Math.abs(o.x) - SH.nave) < 0.05).map((o) => o.yb - FY), H.naveSpring);
      const x = sg * (SH.nave - SH.lining);
      return { a: [x, z0n + 0.3] as [number, number], b: [x, L.tx[0] - 0.7] as [number, number], y0: H.cap + H.arcRise + 0.15, y1: sill - 0.25, n: [-sg, 0] as [number, number] };
    }),
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
  const glass = churchGlass(h.id, scene);
  const pt = (c: number, x: number, y: number, zz: number, d: number) => {
    const l = new THREE.PointLight(c, 0, d, 1.5);
    l.position.set(x, y, zz);
    group.add(l);
    return l;
  };
  const altarL = pt(0xffb070, 0, 3.0, L.apse.z, 18);
  const naveL = pt(0xffc080, 0, 9.5, (z0n + L.tx[0]) / 2, 30);
  const crossL = pt(0xffc080, 0, 9.5, (L.tx[0] + L.tx[1]) / 2, 26);
  const dayFill = pt(0xd8dce0, 0, 14, (L.west + L.tx[1]) / 2, 60);
  let day = 1;
  let sky = 1;
  let ambK = 1;
  const light = () => {
    const d = day * (0.55 + 0.45 * sky);
    // by day bright, the sun's patches and shafts on top, the shade kept; by night blue-black round the candles,
    // the glass holding the moon
    const night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.35);
    const moon = night * THREE.MathUtils.clamp((sky - 0.55) * 2.2, 0.25, 1);
    hemi.intensity = (0.3 + 2.8 * d) * ambK;
    hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, night);
    hemi.groundColor.copy(GROUND_DAY).lerp(GROUND_NIGHT, night);
    amb.intensity = (0.2 + 0.6 * day) * ambK;
    amb.color.copy(AMB_DAY).lerp(AMB_NIGHT, night);
    dayFill.intensity = 12 * d;
    glass.set(day, sky, moon);
    sunLight.set(day, sky);
  };
  const free = (x: number, zz: number) => HP.freeAt(P, x, zz, 0.25, false);
  const path = walkGraph(P.nodes, free);
  const room: LandmarkRoom = {
    kind: "landmark",
    landmark: h.id as unknown as LandmarkRoom["landmark"],
    scene,
    group,
    walk: (fx, fz, x, zz) => (free(x, zz) ? [x, zz] : free(x, fz) ? [x, fz] : free(fx, zz) ? [fx, zz] : [fx, fz]),
    floor: (x, zz) => HP.floorAt(P, x, zz, 0),
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
      // (all night, shut or not: the altar's lamp and candles, the nave's and the crossing's lamps)
      const dark = 1 - THREE.MathUtils.smoothstep(day, 0.1, 0.45);
      altarL.intensity = (3.4 + 2 * dark) * flicker(t, 1.3);
      naveL.intensity = (4 + 9 * dark) * flicker(t, 2.1);
      crossL.intensity = (3 + 7 * dark) * flicker(t, 2.9);
      room.lamps = [
        { p: toWorld(0, L.apse.z, 2.4), w: 0.25 * flicker(t, 1.3) },
        { p: toWorld(0, (z0n + L.tx[0]) / 2, 10), w: 0.2 * flicker(t, 2.1) },
      ];
    },
  };
  room.update(0, 0);
  room.setDaylight(1);
  return room;
}

export interface GothicInWorld {
  halls: HallInWorld[];
  /** Jef is inside one of them (the footsteps' echo). */
  readonly indoors: boolean;
  update(t: number, dt: number, hour: number, day: number, sky: number): void;
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }>;
}

/**
 * St Paul's and St James's in the world: their halls, the west doors open from six in the morning to seven at night
 * (the sexton puts Jef out at closing), the church's echo while Jef is inside. No people of their own yet.
 */
export function gothicInWorld(
  world: World,
  inWorld: InWorld,
  hooks: { roomSound(k: string | null): void; say(t: string): void; jef(): { x: number; z: number; place(x: number, z: number, yaw: number): void } },
): GothicInWorld {
  // (issue #10: every real window of the shell an opening of the hall: the hall from the street, the street from inside;
  // #28: the windows of its towers, attics and annexes too, seen from the street only: from inside the hall they bring
  // no street in)
  const hallOnly = (o: { id: string; zone?: string }) => (o.zone === "hall" ? undefined : () => false);
  const halls = GOTHIC.map((g) =>
    createHallInWorld(world, inWorld, g.plan, buildGothicHall(g), { color: 0x2a2620, near: 22, far: 110 }, g.points, [], 0.3, windowOpenings(churchRows(g), (x, z) => HP.toWorld(g.plan, x, z), hallOnly)),
  );
  // (from inside, only the windows near the eye bring the street in: churches.ts CHURCH_INSIDE_REACH)
  for (const g of GOTHIC) {
    const iw = inWorld.all.find((r) => r.id === (g.plan.id as string));
    if (iw) iw.insideReach = CHURCH_INSIDE_REACH;
  }
  let inside = -1;
  let open = true;
  return {
    halls,
    get indoors() {
      return inside >= 0;
    },
    update(t, dt, hour, day, sky) {
      const want = hour >= 6 && hour < 19;
      const jef = hooks.jef();
      let now = -1;
      halls.forEach((hall, i) => {
        const k = hall.insideness(jef.x, jef.z);
        if (open && !want && k > 0.2) {
          const m = hall.plan.marks.door;
          const [sx, sz] = hall.world(m.x, m.z);
          jef.place(sx, sz, hall.plan.yaw);
          hooks.say("The sexton rattles his keys: the church is closing for the night. You step out into the street.");
        }
        hall.doorOpen = want;
        hall.update(t, dt, day, sky);
        if (inside === i ? k > 0.35 : k > 0.55) now = i;
      });
      open = want;
      if (now !== inside) {
        inside = now;
        hooks.roomSound(inside >= 0 ? "church" : null);
      }
    },
    pathPoints() {
      return halls.flatMap((hall) =>
        hall.doorOpen
          ? hall.points.map((p) => {
              const [x, zz] = hall.world(p.x, p.z);
              return { label: p.label, x, z: zz, reach: p.reach };
            })
          : [],
      );
    },
  };
}
