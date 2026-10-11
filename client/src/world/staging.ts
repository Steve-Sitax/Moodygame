import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { sharedMaterial } from "./staticMerge";
import { bumpTag } from "./bumps";
import { crateMesh, pickCrate, whenCrates } from "../game/crateModel";
import { crateHeight } from "../../../shared/crateCatalog";
import { pickSack, sackMesh } from "../game/sackModel";
import type { Rect } from "./geom";

// Timber stagings over the water (Steve 2026-10-11: "You can create a detailed wooden step/space that hangs over water
// and is supported for holding goods"): a deck of planks cantilevered from the quay wall on joists, each joist held by
// a raking strut from an iron shoe low on the wall, bolted with iron knees and straps; a fascia along its outer edge,
// a railing on the water side and at both ends, open to the quay; a davit post with its block and rope for hoisting
// from a boat below, and goods on it (the one crate of the town, a sack). Flush with the quay: you walk out onto it
// (rijnkaai.ts: walkable, railed, no water under its deck for the walk map; the Godot port walks on the bake's meshes).
//
// Where: on quays where goods are handled, clear of the moored boats' berths, the cranes' runways, the stone flights,
// the ladders and the small boats' moorings (checked 2026-10-11 against rijnkaai.ts moor(), boats.ts, the steps).

export interface Staging {
  id: string;
  /** The middle of its root on the quay edge (the deck's top is the quay's, y 0). */
  x: number;
  z: number;
  /** Out over the water (unit, along x or z). */
  nx: number;
  nz: number;
  /** Its length along the quay and how far it reaches out (m). */
  len: number;
  depth: number;
}

export const STAGINGS: readonly Staging[] = [
  // the Rijnkaai between the bollards at x 27 and x 34.5, clear of the ladder at x 16 and the flight at x 50
  { id: "rijnkaai", x: 30.8, z: 0, nx: 0, nz: -1, len: 5.6, depth: 2.6 },
  // the Bassin's south quay, west of the bollard at x 80 and the ladder at x 84, short of the first barge on the west
  // quay's row (z 50)
  { id: "bassin", x: 74.6, z: 46, nx: 0, nz: 1, len: 6.0, depth: 2.4 },
];

/** Along the quay: up x out (so the staging's frame u, up, out is right-handed). */
const along = (s: Staging): [number, number] => [s.nz, -s.nx];
/** A point of a staging's frame (u along the quay, v out) in the world. */
export function stagingPoint(s: Staging, u: number, v: number): [number, number] {
  const [ux, uz] = along(s);
  return [s.x + ux * u + s.nx * v, s.z + uz * u + s.nz * v];
}
/** The deck's area as a world rect (axis-aligned: every staging lies along x or z). */
export function stagingRect(s: Staging, pad = 0): Rect {
  const p = [stagingPoint(s, -s.len / 2, 0), stagingPoint(s, s.len / 2, s.depth)];
  return { minX: Math.min(p[0][0], p[1][0]) - pad, maxX: Math.max(p[0][0], p[1][0]) + pad, minZ: Math.min(p[0][1], p[1][1]) - pad, maxZ: Math.max(p[0][1], p[1][1]) + pad };
}
/** The quay ground at each staging's root (2 m in from the edge, its length and a little): kept clear of the town's things. */
export function stagingRoots(): Rect[] {
  return STAGINGS.map((s) => {
    const p = [stagingPoint(s, -s.len / 2 - 0.4, -2.0), stagingPoint(s, s.len / 2 + 0.4, 0.2)];
    return { minX: Math.min(p[0][0], p[1][0]), maxX: Math.max(p[0][0], p[1][0]), minZ: Math.min(p[0][1], p[1][1]), maxZ: Math.max(p[0][1], p[1][1]), top: 0.01 };
  });
}
/** On a staging's deck (inside its railing). */
export function onStaging(x: number, z: number): boolean {
  for (const s of STAGINGS) {
    const r = stagingRect(s);
    if (x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ) return true;
  }
  return false;
}

// ------------------------------------------------------------------ the timber's picture

/** Pine baulks and planks: four boards on one picture (each a row), the grain repeating every 2 m along. */
let timberTex: THREE.CanvasTexture | null = null;
function timber(): THREE.CanvasTexture {
  if (timberTex) return timberTex;
  const W = 1024;
  const H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  let s = 1873;
  const R = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rgb = (r: number, gg: number, b: number, a = 1) => `rgba(${r | 0},${gg | 0},${b | 0},${a})`;
  for (let row = 0; row < 4; row++) {
    const y0 = row * 128;
    const tone = [0.92, 1.0, 0.85, 0.96][row];
    // tarred and weathered pine: grey-brown, darker toward the water's end
    g.fillStyle = rgb(118 * tone, 96 * tone, 70 * tone);
    g.fillRect(0, y0, W, 128);
    // the grain: wavy lines whose waves repeat across the picture (whole periods), so it tiles along
    for (let i = 0; i < 46; i++) {
      const yy = y0 + 4 + R() * 120;
      const amp = 0.6 + R() * 2.4;
      const k1 = 1 + Math.floor(R() * 4);
      const k2 = 3 + Math.floor(R() * 6);
      const ph = R() * 6.28;
      g.strokeStyle = rgb(58, 40, 24, 0.12 + R() * 0.3);
      g.lineWidth = 0.6 + R() * 1.6;
      g.beginPath();
      for (let x = 0; x <= W; x += 8) {
        const y = yy + Math.sin((x / W) * Math.PI * 2 * k1 + ph) * amp + Math.sin((x / W) * Math.PI * 2 * k2 + ph * 2) * amp * 0.4;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    // knots, a split, iron stains
    for (let k = 0; k < 3; k++) {
      const kx = R() * W;
      const ky = y0 + 20 + R() * 88;
      const kr = 3 + R() * 6;
      const kg = g.createRadialGradient(kx, ky, 0, kx, ky, kr);
      kg.addColorStop(0, rgb(40, 26, 14, 0.95));
      kg.addColorStop(1, rgb(80, 56, 32, 0));
      g.fillStyle = kg;
      g.beginPath();
      g.ellipse(kx, ky, kr * 1.6, kr, 0, 0, 6.29);
      g.fill();
    }
    g.strokeStyle = rgb(24, 16, 10, 0.6);
    g.lineWidth = 1;
    g.beginPath();
    const sx = R() * W;
    g.moveTo(sx, y0 + 64 + (R() - 0.5) * 30);
    g.lineTo(sx + 60 + R() * 120, y0 + 64 + (R() - 0.5) * 30);
    g.stroke();
    // weathering: grey in blotches, darker wet streaks, fibres
    for (let k = 0; k < 900; k++) {
      g.fillStyle = R() < 0.5 ? rgb(150, 145, 135, R() * 0.12) : rgb(30, 24, 18, R() * 0.18);
      g.fillRect(R() * W, y0 + R() * 128, 6 + R() * 40, 1 + R() * 2);
    }
    // the board's edges: worn pale, a dark seam
    g.fillStyle = rgb(180, 160, 130, 0.2);
    g.fillRect(0, y0, W, 3);
    g.fillStyle = rgb(20, 14, 8, 0.5);
    g.fillRect(0, y0 + 125, W, 3);
    // nail heads every 50 cm (where a plank crosses a joist)
    for (let x = 12; x < W; x += 256)
      for (const ny of [y0 + 30, y0 + 98]) {
        g.fillStyle = rgb(60, 30, 14, 0.5);
        g.fillRect(x - 2, ny, 4, 12);
        g.fillStyle = rgb(28, 24, 22);
        g.beginPath();
        g.arc(x, ny, 3, 0, 6.29);
        g.fill();
      }
  }
  const t = new THREE.CanvasTexture(c);
  t.name = "staging timber wood";
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  bumpTag(t, "wood");
  timberTex = t;
  return t;
}

// ------------------------------------------------------------------ the parts

const ROW_H = 0.25;
/** Metres of timber one picture covers along the grain. */
const TEX_L = 2.0;

/**
 * A timber from a to b (local metres: u along the quay, y up, v out), w by h in section (w across in the horizontal,
 * h in the vertical plane of its line), the grain along it, on the picture's `row`.
 */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, row: number, roll = 0): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const L = d.length();
  const g = new THREE.BoxGeometry(w, L, h);
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const nor = g.getAttribute("normal") as THREE.BufferAttribute;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  const off = (row % 4) * 0.37 + a.x * 0.13; // (each timber its own part of the grain)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i) + L / 2;
    const z = pos.getZ(i);
    const ny = Math.abs(nor.getY(i));
    const cross = Math.abs(nor.getX(i)) > 0.5 ? (z + h / 2) / h : (x + w / 2) / w;
    const v = 1 - (row * ROW_H + 0.02 + cross * (ROW_H - 0.04));
    if (ny > 0.5) uv.setXY(i, off + (x + w / 2) * 0.05, v);
    else uv.setXY(i, off + y / TEX_L, v);
  }
  g.translate(0, L / 2, 0);
  if (roll) g.rotateY(roll);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  // (a horizontal timber keeps its section level: the box's z is turned to world up)
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
  if (Math.abs(d.y) < 0.999 * L) {
    const dir = d.clone().normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const vert = new THREE.Vector3().crossVectors(side, dir).normalize();
    m.makeBasis(side, dir, vert);
  }
  g.applyMatrix4(m);
  g.translate(a.x, a.y, a.z);
  return g;
}
/** A box from lo to hi (local), the grain along its longest side. */
function block(lo: [number, number, number], hi: [number, number, number], row: number): THREE.BufferGeometry {
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const ax = ext.indexOf(Math.max(...ext));
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const a = new THREE.Vector3(...mid);
  const b = new THREE.Vector3(...mid);
  a.setComponent(ax, lo[ax]);
  b.setComponent(ax, hi[ax]);
  const [w, h] = ax === 0 ? [ext[2], ext[1]] : ax === 2 ? [ext[0], ext[1]] : [ext[0], ext[2]];
  return beam(a, b, w, h, row);
}

/** A plain iron part (a plate, a bolt's head). */
function ironBox(lo: [number, number, number], hi: [number, number, number]): THREE.BufferGeometry {
  return new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]).translate((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
}
function bolt(x: number, y: number, z: number, axis: "u" | "v" | "y"): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8);
  if (axis === "u") g.rotateZ(Math.PI / 2);
  else if (axis === "v") g.rotateX(Math.PI / 2);
  return g.translate(x, y, z);
}

/** The baked shade: darker under the deck and toward the water. */
function shade(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute("position");
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = y >= -0.001 ? 1 : 0.5 + 0.35 * Math.max(0, Math.min(1, (y + 2) / 2));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}

export interface Stagings {
  group: THREE.Group;
  /** Its railings, its davit and its goods: walk colliders. */
  colliders: Rect[];
}

/** Build every staging (once). */
export function buildStagings(scene: THREE.Scene, mats: { iron: THREE.Material; rope: THREE.Material }): Stagings {
  const group = new THREE.Group();
  group.name = "quay_staging";
  scene.add(group);
  const colliders: Rect[] = [];
  const wood = sharedMaterial(psx(new THREE.MeshLambertMaterial({ map: timber(), vertexColors: true })));
  wood.name = "staging timber wood";
  for (const s of STAGINGS) {
    const T: THREE.BufferGeometry[] = [];
    const I: THREE.BufferGeometry[] = [];
    const Rp: THREE.BufferGeometry[] = [];
    const L = s.len;
    const D = s.depth;
    const V = (u: number, y: number, v: number) => new THREE.Vector3(u, y, v);
    // the deck: planks along the quay, 22 cm wide with a finger's gap, on joists out from the wall
    const nP = Math.floor((D - 0.02) / 0.232);
    const pw = (D - 0.02 - (nP - 1) * 0.008) / nP;
    for (let k = 0; k < nP; k++) {
      const v0 = 0.01 + k * (pw + 0.008);
      T.push(block([-L / 2, -0.055, v0], [L / 2, 0, v0 + pw], k % 4));
    }
    const nJ = Math.max(3, Math.ceil(L / 1.1) + 1);
    const ju = (k: number) => -L / 2 + 0.12 + (k * (L - 0.24)) / (nJ - 1);
    // the wall plate bolted to the quay's face, the joists on it, the struts under them from iron shoes low on the wall
    T.push(block([-L / 2 - 0.1, -0.62, 0.0], [L / 2 + 0.1, -0.32, 0.16], 1));
    for (let k = 0; k < nJ; k++) {
      const u = ju(k);
      T.push(block([u - 0.08, -0.32, 0.0], [u + 0.08, -0.055, D - 0.1], 2));
      const foot = V(u, -1.78, 0.06);
      const top = V(u, -0.36, D * 0.68);
      T.push(beam(foot, top, 0.14, 0.14, 3));
      // the shoe: an iron cup on the wall, bolted; the knee: plates either side of the joist where the strut meets it
      I.push(ironBox([u - 0.09, -1.92, 0.0], [u + 0.09, -1.66, 0.02]));
      I.push(ironBox([u - 0.09, -1.92, 0.0], [u + 0.09, -1.9, 0.2]));
      for (const y of [-1.86, -1.72]) I.push(bolt(u - 0.05, y, 0.025, "v"), bolt(u + 0.05, y, 0.025, "v"));
      for (const side of [-1, 1]) {
        I.push(ironBox([u + side * 0.08, -0.42, D * 0.62], [u + side * 0.086, -0.12, D * 0.74]));
        I.push(bolt(u + side * 0.09, -0.2, D * 0.68, "u"));
      }
      // the joist's iron strap down over the wall plate, bolted through it
      I.push(ironBox([u - 0.04, -0.6, -0.006], [u + 0.04, -0.05, 0.0]));
      for (const y of [-0.52, -0.4]) I.push(bolt(u, y, -0.01, "v"));
    }
    // the fascia along the outer edge, the railing on the water side and at both ends
    T.push(block([-L / 2, -0.32, D - 0.1], [L / 2, -0.03, D], 0));
    const H = 1.05;
    for (let k = 0; k < nJ; k++) T.push(block([ju(k) - 0.05, -0.32, D - 0.2], [ju(k) + 0.05, H, D - 0.1], (k + 1) % 4));
    T.push(block([-L / 2 - 0.02, H - 0.08, D - 0.22], [L / 2 + 0.02, H, D - 0.08], 2));
    T.push(block([-L / 2, 0.48, D - 0.19], [L / 2, 0.56, D - 0.13], 1));
    T.push(block([-L / 2, 0.0, D - 0.2], [L / 2, 0.15, D - 0.165], 3));
    for (const side of [-1, 1]) {
      const u = side * (L / 2 - 0.05);
      for (const v of [0.35, D * 0.55]) T.push(block([u - 0.05, -0.32, v - 0.05], [u + 0.05, H, v + 0.05], 0));
      T.push(block([u - 0.07, H - 0.08, 0.28], [u + 0.07, H, D - 0.1], 2));
      T.push(block([u - 0.03, 0.48, 0.3], [u + 0.03, 0.56, D - 0.12], 1));
      T.push(block([u - 0.02, 0.0, 0.3], [u + 0.02, 0.15, D - 0.12], 3));
    }
    // the davit: a post at the outer corner, its arm over the water, a block, the fall and a hook
    const du = L / 2 - 0.42;
    T.push(block([du - 0.09, -0.32, D - 0.42], [du + 0.09, 3.1, D - 0.24], 1));
    T.push(beam(V(du, 2.95, D - 0.33), V(du, 2.95, D + 1.05), 0.12, 0.14, 0));
    T.push(beam(V(du, 2.1, D - 0.33), V(du, 2.88, D + 0.4), 0.09, 0.09, 3));
    I.push(ironBox([du - 0.06, 2.72, D + 0.92], [du + 0.06, 2.88, D + 0.98]));
    I.push(ironBox([du - 0.1, 2.84, D + 0.9], [du + 0.1, 2.88, D + 1.0]));
    {
      const fall = new THREE.CylinderGeometry(0.012, 0.012, 2.2, 6).translate(du, 2.72 - 1.1, D + 0.95);
      Rp.push(fall);
      I.push(new THREE.TorusGeometry(0.06, 0.012, 6, 10, Math.PI * 1.4).rotateZ(Math.PI * 0.8).translate(du, 0.55, D + 0.95));
      // the hauling end tied off round a cleat on the post
      I.push(ironBox([du - 0.11, 1.1, D - 0.25], [du + 0.11, 1.14, D - 0.22]));
      Rp.push(new THREE.TorusGeometry(0.1, 0.014, 6, 12).rotateX(Math.PI / 2).translate(du, 1.0, D - 0.33));
    }
    // to world: u along the quay, v out over the water
    const [ux, uz] = along(s);
    const M = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(s.nx, 0, s.nz));
    M.setPosition(s.x, 0, s.z);
    const meshOf = (geos: THREE.BufferGeometry[], mat: THREE.Material, name: string, colour: boolean) => {
      const parts = geos.map((g) => {
        const q = g.index ? g.toNonIndexed() : g;
        for (const k of Object.keys(q.attributes)) if (!["position", "normal", "uv"].includes(k)) q.deleteAttribute(k);
        if (!q.getAttribute("uv")) q.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(q.getAttribute("position").count * 2), 2));
        return colour ? shade(q) : q;
      });
      const g = mergeGeometries(parts, false)!;
      g.applyMatrix4(M);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = name;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    };
    meshOf(T, wood, `staging_timber_${s.id}`, true);
    meshOf(I, mats.iron, `staging_iron_${s.id}`, false);
    meshOf(Rp, mats.rope, `staging_rope_${s.id}`, false);
    // the colliders: the railing (water side, both ends), the davit post
    const W = (u: number, v: number) => stagingPoint(s, u, v);
    const rectOf = (u0: number, u1: number, v0: number, v1: number, top: number): Rect => {
      const [ax, az] = W(u0, v0);
      const [bx, bz] = W(u1, v1);
      return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz), top };
    };
    colliders.push(rectOf(-L / 2 - 0.05, L / 2 + 0.05, D - 0.24, D + 0.02, H));
    for (const side of [-1, 1]) colliders.push(rectOf(side * (L / 2 - 0.12), side * (L / 2 + 0.05), 0.25, D, H));
    colliders.push(rectOf(du - 0.12, du + 0.12, D - 0.46, D - 0.2, 3.1));
    // the goods on it, by the railing (the walkway along the quay side stays clear): the one crate, a sack
    const goods: Array<[number, number, number, number, string]> = [
      [-L / 2 + 0.75, D - 0.62, 0, 0.04, "crate"],
      [-L / 2 + 0.76, D - 0.6, crateHeight("standard"), -0.1, "crate"],
      [-L / 2 + 1.75, D - 0.58, 0, 0.02, "crate small"],
      [-L / 2 + 2.75, D - 0.55, 0, 0.15, "sack"],
    ];
    whenCrates(() => {
      for (const [u, v, y, yaw, what] of goods) {
        const [x, z] = W(u, v);
        // (the stencil toward the quay)
        const turn = Math.atan2(-s.nx, -s.nz) + yaw;
        let o: THREE.Object3D | null = null;
        if (what.startsWith("crate")) o = crateMesh(pickCrate(`staging:${s.id}`), what === "crate small" ? { cls: "small" } : {});
        else o = sackMesh(pickSack(`staging:${s.id}`, "quay"));
        if (!o) continue;
        o.position.set(x, y, z);
        o.rotation.y = turn;
        group.add(o);
      }
    });
    for (const [u, v, y, , what] of goods) {
      if (y > 0) continue;
      const half = what === "sack" ? [0.45, 0.27] : what === "crate small" ? [0.36, 0.26] : [0.42, 0.3];
      colliders.push(rectOf(u - half[0], u + half[0], v - half[1], v + half[1], what === "sack" ? 0.3 : what === "crate" ? 2 * crateHeight("standard") : crateHeight("small")));
    }
  }
  return { group, colliders };
}
