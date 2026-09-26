import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import { GOTHIC, pointedAt, type GothicHall, type GWindow } from "../../../shared/gothicPlan";
import { canvasTex, flicker, frameRoom, rand } from "./rooms";
import { Flames, Kit, lmMat, marble, painting, type MatDef } from "./landmarkKit";
import { glassMat, M, walkGraph, type LandmarkRoom } from "./landmarkRooms";
import { createHallInWorld, type HallInWorld } from "./hallInWorld";
import { altar, C, chandelier, figure, PIC, planarUV } from "./carolusHall";
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
  white: lmMat("gh_white", { map: PIC("/textures/pj_white.jpg", flat("#c8c4bc")), color: 0xe0dcd4 }, 0.05, 0.02),
  sand: lmMat("gh_sand", { map: PIC("/textures/pj_brabant.jpg", flat("#b0a894")), color: 0xf2eadc }, 0.05, 0.02),
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

/** A glass pane in a window (a pointed head), on a wall across x at z or along z at x, facing the room. */
function pane(k: Kit, w: GWindow, def: MatDef, lead: MatDef): void {
  const half = w.w / 2;
  const ys = w.y1 - 0.742 * w.w;
  // (a little larger than the hole: seen at a slant from close by, the glass still covers the opening's edge)
  const e = 0.09;
  const s = new THREE.Shape();
  s.moveTo(-half - e, w.y0 - e);
  s.lineTo(half + e, w.y0 - e);
  for (let i = 0; i <= 10; i++) {
    const u = half - (w.w * i) / 10;
    s.lineTo(u * (1 + e / half), ys + pointedAt(u, half, 0.742 * w.w) + e);
  }
  s.lineTo(-half - e, w.y0 - e);
  const g = new THREE.ShapeGeometry(s, 1);
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + half) / w.w, (uv.getY(i) - w.y0) / (w.y1 - w.y0));
  // the face looks at the room: a wall across x (at z) facing +z or -z, a wall along z (at x) facing +x or -x
  const ry = w.wall === "x" ? (w.inward > 0 ? 0 : Math.PI) : w.inward > 0 ? Math.PI / 2 : -Math.PI / 2;
  const [px, pz] = w.wall === "x" ? [w.c, w.at + w.inward * 0.02] : [w.at + w.inward * 0.02, w.c];
  k.add(g, def, px, 0, pz, { ry, flat: true });
  // a second pane inside the reveal: seen along the wall from close by, the eye slips past the first one's edge
  // into the opening, and there it meets glass instead of the sky
  const [bx, bz] = w.wall === "x" ? [w.c, w.at - w.inward * 0.15] : [w.at - w.inward * 0.15, w.c];
  k.add(g.clone(), def, bx, 0, bz, { ry, flat: true });
  // the lights' mullions, a transom
  for (let i = 1; i < w.lights; i++) {
    const u = -half + (w.w * i) / w.lights;
    const [mx, mz] = w.wall === "x" ? [w.c + u, w.at + w.inward * 0.07] : [w.at + w.inward * 0.07, w.c - u * (w.inward > 0 ? 1 : -1)];
    k.box(w.wall === "x" ? 0.09 : 0.09, ys - w.y0 + 0.3, 0.09, mx, (w.y0 + ys + 0.3) / 2, mz, lead);
  }
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

/** The church inside, built from its plan at the shell's place. */
export function buildGothicHall(h: GothicHall): LandmarkRoom {
  const P = h.plan;
  const { L, H } = h;
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
  const glassG = glassMat("grisaille", paul ? 91 : 93);
  const glassC = glassMat("colour", paul ? 92 : 94);
  const lead = G.iron;
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m: MatDef, tile = 2.4, tint?: number) =>
    k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, m, { tile, tint });
  const pics = paul ? PICS.paul : PICS.james;
  const arcTop = H.aisleSpring + H.aisleRise; // the arcade walls reach the aisles' vault crowns
  const naveTop = H.naveSpring + H.naveRise;
  const z0n = L.tower ? L.tower.z1 : L.west; // where the nave's arcades begin
  const winOn = (wall: "x" | "z", at: number) => h.windows.filter((w) => w.wall === wall && Math.abs(w.at - at) < 0.3);
  const holesOf = (ws: GWindow[], toU: (c: number) => number): Opening[] =>
    ws.map((w) => ({ u0: toU(w.c) - w.w / 2, u1: toU(w.c) + w.w / 2, y0: w.y0, spring: w.y1 - 0.742 * w.w, head: "pointed" as const, rise: 0.742 * w.w }));

  // ================= floors
  for (const f of P.levels[0].floors) {
    if (f.maxZ <= 0.001) continue; // the porch is the street's
    box(f.minX, f.maxX, -0.12, 0, f.minZ, f.maxZ, G.floor, SLAB_TILE);
  }
  // the choir and the apse (and the ambulatory) under the parts Jef does not walk: floored all the same, a little lower
  {
    const xr = L.amb ?? L.choir + 0.2;
    box(-xr, xr, -0.16, -0.035, L.tx[1], L.apse.z + (L.amb ?? L.apse.r) + 0.3, G.floor, SLAB_TILE);
  }
  // ================= the west wall(s): the doorway (a little wider than the shell's), the windows
  const dw = h.door;
  const westHalf = L.tower ? L.tower.half + 0.66 : L.aisle + 0.25;
  wallG(k, WALL, [-westHalf, dw.inner / 2 + 0.05], [westHalf, dw.inner / 2 + 0.05], -0.12, L.tower ? 21 : naveTop + 0.5, dw.inner - 0.1,
    [{ u0: westHalf - dw.hw - 0.06, u1: westHalf + dw.hw + 0.06, y0: -0.12, spring: dw.spring, head: dw.round ? "round" : "pointed", rise: 0.742 * (2 * dw.hw + 0.12) }],
    holesOf(winOn("x", L.west).filter((w) => Math.abs(w.c) < westHalf), (c) => c + westHalf));
  for (const w of winOn("x", L.west).filter((w) => Math.abs(w.c) < westHalf)) pane(k, w, glassG.def, lead);
  if (L.tower) {
    // the aisles' own west walls beside the tower
    for (const sg of [-1, 1]) {
      const a0 = sg * (L.tower.half + 0.6);
      const a1 = sg * (L.aisle + 0.25);
      const ws = h.windows.filter((w) => w.wall === "x" && w.at < 1 && Math.sign(w.c) === sg);
      const [ua, ub] = sg < 0 ? [a1, a0] : [a0, a1];
      wallG(k, WALL, [ua, 0.3], [ub, 0.3], -0.12, H.aisleSpring + H.aisleRise + 0.3, 0.5, [], holesOf(ws, (c) => c - ua));
      for (const w of ws) pane(k, { ...w, at: 0.55 }, glassG.def, lead);
    }
    // the north chapels' west wall
    wallG(k, WALL, [-20.45, 0.3], [-L.aisle - 0.25, 0.3], -0.12, H.chapelCeil + 0.2, 0.5, [], []);
  } else {
    for (const ch of L.chapels) if (ch.z0 < 1.5) wallG(k, WALL, [ch.side * (Math.abs(ch.x) + 0.35), ch.z0 / 2 + 0.05], [ch.side * (L.aisle + 0.25), ch.z0 / 2 + 0.05], -0.12, ch.ceil + 0.2, ch.z0 - 0.1, [], []);
  }
  // ================= the tower hall (St James): its side walls with arches to the aisles, the great arch to the nave, its vault
  if (L.tower) {
    const T = L.tower;
    for (const sg of [-1, 1]) {
      const x = sg * (T.half + 0.3);
      // (to the east wall's middle: that wall's ends close these, no two faces in one plane)
      const [za, zb] = sg < 0 ? [T.z1 + 0.25, 0.3] : [0.3, T.z1 + 0.25];
      const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
      const o = [4.4, 8.0].map(toU).sort((p, q) => p - q);
      wallG(k, S, [x, za], [x, zb], -0.12, 20.9, 0.6, [{ u0: o[0], u1: o[1], y0: -0.12, spring: 6.0, head: "pointed", rise: 2.8 }], [], 2.4);
    }
    // (its ends 6 cm proud of the side walls' faces, inside the arcade walls)
    wallG(k, S, [-T.half - 0.66, T.z1 + 0.3], [T.half + 0.66, T.z1 + 0.3], -0.12, naveTop + 0.4, 0.6,
      [{ u0: 1.06, u1: 2 * T.half + 0.26, y0: -0.12, spring: 11.5, head: "pointed", rise: 5.6 }], [], 2.4);
    groin(k, G.vault, S, -T.half, T.half, 1.4, T.z1, 14.0, 5.0, 5.0);
    // the font by the door
  }
  // ================= the arcades: columns, pointed arches, the walls over them up to the vault, the clerestory
  const colsZ = L.bays.slice(1, -1).filter((b) => b > z0n + 0.5);
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
    const clere = holesOf(winOn("z", x), toU);
    wallG(k, S, [x, za], [x, zb], -0.12, naveTop + 0.3, 0.7, openings, clere, 2.6);
    for (const w of winOn("z", x)) pane(k, { ...w, at: x - sg * 0.36 }, glassG.def, lead);
    for (const zz of colsZ) {
      column(k, S, x, zz, 0, H.cap, 0.5);
      if (!paul) statueOnColumn(k, x, zz, H.cap - 2.8, -sg);
    }
    // the triforium's openwork parapet along the nave, over the aisles' crowns
    const yt = arcTop + 0.4;
    box(x - sg * 0.35 - 0.12, x - sg * 0.35 + 0.12, yt, yt + 0.12, zs[0] + 0.3, zs[zs.length - 1] - 0.3, S, 2.4);
    box(x - sg * 0.35 - 0.12, x - sg * 0.35 + 0.12, yt + 0.9, yt + 1.02, zs[0] + 0.3, zs[zs.length - 1] - 0.3, S, 2.4);
    for (let zz = zs[0] + 0.5; zz < zs[zs.length - 1] - 0.4; zz += 0.45) k.box(0.1, 0.78, 0.1, x - sg * 0.35, yt + 0.51, zz, S);
  }
  // the crossing's four piers
  for (const zz of L.tx) for (const sg of [-1, 1]) pier(k, S, sg * L.nave, zz, H.naveSpring, 0.62);
  // ================= the aisles' outer walls: arches into the chapels, the windows over them
  for (const sg of [-1, 1]) {
    const x = sg * (L.aisle + 0.12);
    // (to inside the transept's west wall: no end face in that wall's face)
    const za = sg < 0 ? L.tx[0] - 0.1 : L.west - (L.tower ? 0.8 : 0);
    const zb = sg < 0 ? L.west - (L.tower ? 0.8 : 0) : L.tx[0] - 0.1;
    const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
    const ch = L.chapels.find((c) => c.side === sg);
    const openings: Opening[] = [];
    if (ch) {
      const bs = [ch.z0, ...L.bays.slice(1, -1).filter((b) => b > ch.z0 + 0.5 && b < ch.z1 - 0.5), ch.z1];
      for (let i = 0; i + 1 < bs.length; i++) {
        const p = toU(bs[i] + (i === 0 ? 0.05 : 0.3));
        const q = toU(bs[i + 1] - (i === bs.length - 2 ? 0.05 : 0.3));
        openings.push({ u0: Math.min(p, q), u1: Math.max(p, q), y0: -0.12, spring: ch.ceil - 1.8, head: "pointed", rise: 1.7 });
      }
    }
    const ws = winOn("z", sg * L.aisle);
    wallG(k, WALL, [x, za], [x, zb], -0.12, arcTop + 0.2, 0.25, openings, holesOf(ws, toU), 2.6);
    for (const w of ws) pane(k, { ...w, at: sg * (L.aisle - 0.02) }, paul && sg > 0 ? glassG.def : glassG.def, lead);
    if (ch) {
      // the chapels: their outer wall with windows, their partitions, a flat panelled ceiling
      const xo = ch.x + sg * 0.12;
      // (a little past both ends, into the walls that close the row of chapels, so no seam opens at the corners)
      const [ca, cb] = sg < 0 ? [ch.z1 + 0.15, ch.z0 - 0.15] : [ch.z0 - 0.15, ch.z1 + 0.15];
      const toUc = (zz: number) => (sg < 0 ? ca - zz : zz - ca);
      // (only its own: St Paul's transept end stands in the same line)
      const cws = winOn("z", ch.x).filter((w) => w.c > ch.z0 && w.c < ch.z1);
      wallG(k, WALL, [xo, ca], [xo, cb], -0.12, ch.ceil + 0.12, 0.25, [], holesOf(cws, toUc), 2.6);
      for (const w of cws) pane(k, { ...w, at: ch.x - sg * 0.02 }, glassG.def, lead);
      for (const b of L.bays.slice(1, -1).filter((b) => b > ch.z0 + 0.5 && b < ch.z1 - 0.5))
        // (2 cm inside the arches' reveals: not in their faces)
        box(Math.min(ch.x, sg * L.aisle), Math.max(ch.x, sg * L.aisle), -0.12, ch.ceil + 0.05, b - 0.28, b + 0.28, WALL);
      box(Math.min(ch.x, sg * L.aisle) - 0.1, Math.max(ch.x, sg * L.aisle) + 0.1, ch.ceil, ch.ceil + 0.14, ch.z0 - 0.1, ch.z1 + 0.1, G.vault, 2.4, 1.45);
      // its ceiling's beams across each chapel
      for (let zz = ch.z0 + 1.0; zz < ch.z1 - 0.5; zz += 1.6)
        box(Math.min(ch.x, sg * L.aisle), Math.max(ch.x, sg * L.aisle), ch.ceil - 0.22, ch.ceil, zz - 0.1, zz + 0.1, G.oakPlain, 1.2, 1.3);
      for (const w of cws) {
        // a small altar in each chapel under its window
        box(ch.x - sg * 0.9, ch.x - sg * 0.1, 0, 1.0, w.c - 1.0, w.c + 1.0, G.marbleB, 1.2);
        box(ch.x - sg * 0.95, ch.x - sg * 0.05, 1.0, 1.08, w.c - 1.05, w.c + 1.05, G.marbleW, 1.2);
        for (const d of [-0.5, 0.5]) {
          k.cyl(0.022, 0.022, 0.26, ch.x - sg * 0.5, 1.08, w.c + d, G.wax, { seg: 4 });
          flames.addFlame(ch.x - sg * 0.5, 1.4, w.c + d);
        }
      }
      if (!paul && sg > 0) box(L.aisle, ch.x, -0.12, ch.ceil + 0.1, ch.z0 - 0.5, ch.z0, WALL); // the baptistery's wall
    }
  }
  // ================= the vaults: the nave bay by bay, the aisles, the crossing and the arms, the choir, the apse
  const naveBays = [z0n, ...colsZ, L.tx[0]];
  for (let i = 0; i + 1 < naveBays.length; i++) groin(k, G.vault, S, -L.nave + 0.35, L.nave - 0.35, naveBays[i], naveBays[i + 1], H.naveSpring, H.naveRise, H.naveRise);
  const aisleBays = [L.tower ? 0.55 : L.west, ...L.bays.slice(1, -1).filter((b) => b > 0.8), L.tx[0]];
  for (const sg of [-1, 1])
    for (let i = 0; i + 1 < aisleBays.length; i++) {
      // (beside St James's tower the aisle's vault meets the tower's side wall)
      const xi = L.tower && aisleBays[i + 1] <= L.tower.z1 + 0.01 ? L.tower.half + 0.6 : L.nave + 0.35;
      const [xa, xb] = sg < 0 ? [-L.aisle, -xi] : [xi, L.aisle];
      groin(k, G.vault, S, xa, xb, aisleBays[i], aisleBays[i + 1], H.aisleSpring, H.aisleRise * 0.8, H.aisleRise);
    }
  groin(k, G.vault, S, -L.nave + 0.35, L.nave - 0.35, L.tx[0], L.tx[1], H.naveSpring, H.naveRise, H.naveRise);
  for (const sg of [-1, 1]) {
    const xs = [L.nave - 0.35, (L.nave + L.arm) / 2, L.arm].map((v) => sg * v);
    for (let i = 0; i + 1 < xs.length; i++) groin(k, G.vault, S, Math.min(xs[i], xs[i + 1]), Math.max(xs[i], xs[i + 1]), L.tx[0], L.tx[1], H.naveSpring, H.naveRise, H.naveRise);
  }
  // ================= the transept: its ends with the great windows, its west and east faces over the aisles
  for (const sg of [-1, 1]) {
    const x = sg * (L.arm + 0.12);
    const [za, zb] = sg < 0 ? [L.tx[1], L.tx[0]] : [L.tx[0], L.tx[1]];
    const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
    // (only its own: St Paul's north chapels stand in the same line)
    const ws = winOn("z", sg * L.arm).filter((w) => w.c > L.tx[0] && w.c < L.tx[1]);
    wallG(k, WALL, [x, za], [x, zb], -0.12, naveTop + 0.4, 0.25, [], holesOf(ws, toU), 2.6);
    for (const w of ws) pane(k, { ...w, at: sg * (L.arm - 0.02) }, glassC.def, lead);
    for (const [zz, dir] of [[L.tx[0], 1], [L.tx[1], -1]] as Array<[number, number]>) {
      const zw = zz - dir * 0.12;
      const inner = zz === L.tx[1] && L.amb ? L.amb : dir > 0 ? L.aisle : L.choir + 0.35;
      const x0 = sg * (L.nave + 0.35);
      const x1 = sg * (L.arm + 0.25);
      const [ua, ub] = sg < 0 ? [x1, x0] : [x0, x1];
      const toUx = (xx: number) => xx - ua;
      const ws2 = h.windows.filter((w) => w.wall === "x" && Math.abs(w.at - zz) < 0.3 && Math.sign(w.c) === sg);
      // the opening where the aisle (or the choir aisle) meets the arm
      const oa = toUx(sg * (L.nave + 0.35));
      const ob = toUx(sg * inner);
      const openings: Opening[] =
        zz === L.tx[0] || L.amb ? [{ u0: Math.min(oa, ob), u1: Math.max(oa, ob), y0: -0.12, spring: dir > 0 ? H.aisleSpring : (H.ambSpring ?? H.aisleSpring), head: "pointed", rise: (dir > 0 ? H.aisleRise : (H.ambRise ?? 2)) * 0.76 }] : [];
      wallG(k, WALL, [ua, zw], [ub, zw], -0.12, naveTop + 0.3, 0.25, openings, holesOf(ws2, toUx), 2.6);
      for (const w of ws2) pane(k, { ...w, at: zz - dir * 0.02 }, glassG.def, lead);
    }
  }
  // ================= the choir, its apse (and St James's choir aisles and ambulatory)
  const cz0 = L.tx[1];
  const cz1 = L.apse.z;
  for (const sg of [-1, 1]) {
    const x = sg * (L.choir + 0.12);
    const [za, zb] = sg < 0 ? [cz1, cz0] : [cz0, cz1];
    const toU = (zz: number) => (sg < 0 ? za - zz : zz - za);
    const ws = winOn("z", sg * L.choir);
    if (L.amb) {
      // an arcade to the choir aisle, a clerestory over it
      const mid = (cz0 + cz1) / 2;
      const openings: Opening[] = [
        { u0: Math.min(toU(cz0 + 0.8), toU(mid - 0.55)), u1: Math.max(toU(cz0 + 0.8), toU(mid - 0.55)), y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise },
        { u0: Math.min(toU(mid + 0.55), toU(cz1 - 0.3)), u1: Math.max(toU(mid + 0.55), toU(cz1 - 0.3)), y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise },
      ];
      wallG(k, S, [x, za], [x, zb], -0.12, naveTop + 0.3, 0.5, openings, holesOf(ws, toU), 2.6);
      column(k, S, sg * L.choir, mid, 0, H.cap, 0.45);
      // the choir aisle's outer wall with its windows, its vault
      const xo = sg * (L.amb + 0.12);
      const aws = winOn("z", sg * L.amb);
      wallG(k, WALL, [xo, za], [xo, zb], -0.12, (H.ambSpring ?? 7) + (H.ambRise ?? 3) + 0.3, 0.25, [], holesOf(aws, toU), 2.6);
      for (const w of aws) pane(k, { ...w, at: sg * (L.amb - 0.02) }, glassG.def, lead);
      groin(k, G.vault, S, sg < 0 ? -L.amb : L.choir + 0.35, sg < 0 ? -L.choir - 0.35 : L.amb, cz0, cz1, H.ambSpring ?? 7, (H.ambRise ?? 3) * 0.8, H.ambRise ?? 3);
    } else {
      wallG(k, WALL, [x, za], [x, zb], -0.12, naveTop + 0.3, 0.25, [], holesOf(ws, toU), 2.6);
    }
    for (const w of ws) pane(k, { ...w, at: sg * (L.choir - 0.02) }, glassC.def, lead);
  }
  {
    const nb = Math.max(1, Math.round((cz1 - cz0) / 6.5));
    for (let i = 0; i < nb; i++)
      groin(k, G.vault, S, -L.choir, L.choir, cz0 + ((cz1 - cz0) * i) / nb, cz0 + ((cz1 - cz0) * (i + 1)) / nb, H.naveSpring, H.naveRise * (L.choir / L.nave), H.naveRise);
  }
  // the apse: five walls (St James: an arcade on columns into the ambulatory under a clerestory), windows, a ribbed half dome
  const R5 = L.apse.r + 0.12;
  const domeY = L.amb ? H.naveSpring + 0.2 : 19.0;
  const apsePt = (i: number): [number, number] => {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    return [-Math.sin(a) * R5, cz1 + Math.cos(a) * R5];
  };
  for (let i = 0; i < 5; i++) {
    const p0 = apsePt(i);
    const p1 = apsePt(i + 1);
    const Lw = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const clere = L.amb
      ? [{ u0: Lw / 2 - 1.0, u1: Lw / 2 + 1.0, y0: 12.6, spring: 19.0 - 1.48, head: "pointed" as const, rise: 1.48 }]
      : [{ u0: Lw / 2 - 0.9, u1: Lw / 2 + 0.9, y0: 10.4, spring: 18.6 - 1.34, head: "pointed" as const, rise: 1.34 }];
    const openings: Opening[] = L.amb ? [{ u0: 0.5, u1: Lw - 0.5, y0: -0.12, spring: H.cap, head: "pointed", rise: H.arcRise }] : [];
    wallG(k, L.amb ? S : WALL, p0, p1, -0.12, domeY + 0.1, L.amb ? 0.45 : 0.25, openings, clere, 2.6);
    const mx = (p0[0] + p1[0]) / 2;
    const mz = (p0[1] + p1[1]) / 2;
    const ry = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    const c0 = clere[0];
    const pw: GWindow = { wall: "x", at: 0, c: 0, w: c0.u1 - c0.u0, y0: c0.y0, y1: c0.spring + (c0.rise ?? 1), inward: 1, lights: 2 };
    // the pane turned into the wall's plane
    const g2 = new THREE.PlaneGeometry(pw.w, pw.y1 - pw.y0);
    k.add(g2, glassC.def, mx * 0.995, (pw.y0 + pw.y1) / 2, cz1 + (mz - cz1) * 0.995, { ry: ry + Math.PI / 2, flat: true });
    if (L.amb) column(k, S, p0[0], p0[1], 0, H.cap, 0.4);
  }
  {
    const gdome = new THREE.SphereGeometry(R5, 16, 8, 0, Math.PI, 0, Math.PI / 2);
    gdome.computeVertexNormals();
    planarUV(gdome, 3.0);
    k.add(gdome, G.vault, 0, domeY, cz1, { flat: true, tint: 0.95 });
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 5;
      for (let j = 0; j < 5; j++) {
        const t0 = (Math.PI / 2) * (j / 5);
        const t1 = (Math.PI / 2) * ((j + 1) / 5);
        const P0 = new THREE.Vector3(-Math.sin(a) * Math.cos(t0) * (R5 - 0.12), domeY + Math.sin(t0) * (R5 - 0.12), cz1 + Math.cos(a) * Math.cos(t0) * (R5 - 0.12));
        const P1 = new THREE.Vector3(-Math.sin(a) * Math.cos(t1) * (R5 - 0.12), domeY + Math.sin(t1) * (R5 - 0.12), cz1 + Math.cos(a) * Math.cos(t1) * (R5 - 0.12));
        const len = P0.distanceTo(P1);
        const bx = new THREE.BoxGeometry(0.2, 0.18, len);
        bx.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), P1.clone().sub(P0).normalize()));
        bx.translate((P0.x + P1.x) / 2, (P0.y + P1.y) / 2, (P0.z + P1.z) / 2);
        k.add(bx, S, 0, 0, 0, { flat: true });
      }
    }
  }
  if (L.amb) {
    // the ambulatory's outer walls round the apse (the three radiating chapels' openings in the middle ones), a flat vault
    const RA = L.amb + 0.12;
    const ambPt = (i: number): [number, number] => {
      const a = -Math.PI / 2 + (Math.PI * i) / 5;
      return [-Math.sin(a) * RA, cz1 + Math.cos(a) * RA];
    };
    for (let i = 0; i < 5; i++) {
      const p0 = ambPt(i);
      const p1 = ambPt(i + 1);
      const Lw = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      const hole: Opening = i >= 1 && i <= 3 ? { u0: Lw / 2 - 0.8, u1: Lw / 2 + 0.8, y0: 2.6, spring: 9.6 - 1.19, head: "pointed", rise: 1.19 } : { u0: Lw / 2 - 1.5, u1: Lw / 2 + 1.5, y0: 2.8, spring: 10.4 - 2.23, head: "pointed", rise: 2.23 };
      wallG(k, WALL, p0, p1, -0.12, (H.ambSpring ?? 7) + (H.ambRise ?? 3) + 0.4, 0.25, [], i === 2 ? [] : [hole], 2.6);
      if (i !== 2) {
        const mx = (p0[0] + p1[0]) / 2;
        const mz = (p0[1] + p1[1]) / 2;
        const ry = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
        const g2 = new THREE.PlaneGeometry(hole.u1 - hole.u0, hole.spring + (hole.rise ?? 1) - hole.y0);
        k.add(g2, glassG.def, mx * 0.995, (hole.y0 + hole.spring + (hole.rise ?? 1)) / 2, cz1 + (mz - cz1) * 0.995, { ry: ry + Math.PI / 2, flat: true });
      }
    }
    // the ambulatory's ceiling: a flat panelled vault round the apse
    const sh = new THREE.Shape();
    for (let i = 0; i <= 5; i++) {
      const [x, zz] = ambPt(i);
      if (i === 0) sh.moveTo(x, zz - cz1);
      else sh.lineTo(x, zz - cz1);
    }
    for (let i = 5; i >= 0; i--) {
      const [x, zz] = apsePt(i);
      sh.lineTo(x, zz - cz1);
    }
    const gc = new THREE.ShapeGeometry(sh, 1);
    gc.rotateX(Math.PI / 2);
    gc.translate(0, (H.ambSpring ?? 7) + (H.ambRise ?? 3) * 0.75, cz1);
    planarUV(gc, 2.4);
    k.add(gc, G.vault, 0, 0, 0, { flat: true, tint: 0.92 });
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

  // ================= light: daylight through the windows, the candles, the chandeliers
  const hemi = new THREE.HemisphereLight(0xd8d4cc, 0x4a4036, 1.1);
  const amb = new THREE.AmbientLight(0x5a5048, 0.9);
  scene.add(hemi, amb);
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
    hemi.intensity = (1.5 + 2.2 * d) * ambK;
    amb.intensity = (0.7 + 0.35 * day) * ambK;
    dayFill.intensity = 14 * d;
    for (const gm of [glassG, glassC]) gm.mat().color.setScalar(0.1 + 0.95 * day * sky);
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
      altarL.intensity = 3.4 * flicker(t, 1.3);
      naveL.intensity = (day < 0.4 ? 10 : 4) * flicker(t, 2.1);
      crossL.intensity = (day < 0.4 ? 8 : 3) * flicker(t, 2.9);
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
  const halls = GOTHIC.map((g) => createHallInWorld(world, inWorld, g.plan, buildGothicHall(g), { color: 0x2a2620, near: 22, far: 110 }, g.points));
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
