import * as THREE from "three";
import { LW_MIN } from "./tide";
import { psx } from "../retro/psx";

// The far bank of the Schelde (the left bank, the Vlaams Hoofd), across the
// river from the quays: in 1873 low polder land behind a dyke, rows of trees, a few inns
// and houses at the ferry landing, the earthworks of the Tete de Flandre fort, a mill.
// World frame: x runs along the river, the water is at z < 0.
//
// Fixes 2026-09-24 (the photographer's shots 22 and 23: "flat pale boxes floating on the
// horizon"): it now reads as a low dyke line. The dyke rises from the mud below the lowest
// water (M6 tides) to a crest 3 m above the highest; everything else stands on the polder behind
// it, lower than the crest, so from the quays no base shows and nothing floats: rows of round
// crowns and poplars (low-poly lumps, not boxes on sticks), a few houses and inns at the ferry
// landing showing their upper walls and roofs over the dyke, the fort's grassed ramparts, a mill,
// and a far tree line in the haze. Darker, earthy colours; the ordinary fog (no longer carried
// past the fog as a flat pale silhouette), so on a grey day it fades out with the rest.

const BANK_Z = -290; // the waterline of the far bank (the river is wider; the fog needs it nearer)
const X0 = -900;
const X1 = 800;
/** Heights above the river at half tide (waterY). */
const CREST = 5.6;
const POLDER = 3.0;
const ALBEDO = 0.55;

export function buildFarBank(scene: THREE.Scene, waterY: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "far_bank";
  const pos: number[] = [];
  const col: number[] = [];
  let seed = 1873;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // the colours below are the land's own; the lights here are bright (sky 2.1, the sun on top),
  // so they go in at ALBEDO of that, or the bank reads pale (it did)
  const tri = (a: number[], b: number[], c: number[], k: number[]) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(k[0] * ALBEDO, k[1] * ALBEDO, k[2] * ALBEDO);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[], k: number[]) => {
    tri(a, b, c, k);
    tri(a, c, d, k);
  };
  const shade = (k: number[], f: number) => k.map((v) => Math.min(1, v * f));
  /** A box, faces toward the town (+z), the ends and the top: it is only ever seen from across the river. */
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, k: number[]) => {
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], shade(k, 1.1));
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(k, 0.8));
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(k, 0.8));
  };
  /**
   * A tree crown: an uneven lump (a ring of `n` points at its widest, a top and a bottom point),
   * on a short trunk from the polder. Round for elms and willows, tall and narrow for poplars.
   */
  const tree = (x: number, z: number, base: number, h: number, w: number, k: number[], n = 6, low = 0.35) => {
    const trunkTop = base + h * low;
    box(x - 0.25, x + 0.25, z - 0.25, z + 0.25, base - 0.5, trunkTop + 0.5, [0.13, 0.11, 0.09]);
    const midY = trunkTop + (h - h * low) * 0.45;
    const top = [x + (r() - 0.5) * w * 0.3, base + h, z + (r() - 0.5) * w * 0.3];
    const bot = [x, trunkTop, z];
    const a0 = r() * Math.PI * 2;
    const ring: number[][] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const rr = w * (0.8 + r() * 0.35);
      ring.push([x + Math.cos(a) * rr, midY + (r() - 0.5) * h * 0.12, z + Math.sin(a) * rr]);
    }
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      // the light from above and from the town's side
      const face = (p[2] + q[2]) / 2 - z;
      const f = 0.85 + 0.25 * Math.max(-1, Math.min(1, face / w));
      tri(p, q, top, shade(k, f * 1.08));
      tri(q, p, bot, shade(k, f * 0.72));
    }
  };
  const y = waterY;

  // ---- the bank itself: mud, the stone foot, the dyke, its crest, the polder behind
  // the mud flat in front of the dyke, bare at low water (M6 tides: the river falls to LW_MIN)
  quad([X0, LW_MIN - 1.5, BANK_Z + 28], [X1, LW_MIN - 1.5, BANK_Z + 28], [X1, y - 0.8, BANK_Z], [X0, y - 0.8, BANK_Z], [0.23, 0.21, 0.18]);
  // the stone foot, with a darker wet band
  quad([X0, y - 0.8, BANK_Z], [X1, y - 0.8, BANK_Z], [X1, y + 1.4, BANK_Z - 2.5], [X0, y + 1.4, BANK_Z - 2.5], [0.27, 0.26, 0.24]);
  // the grassed face of the dyke, in long strips of slightly different greens (mown, rough)
  for (let x = X0; x < X1; ) {
    const w = 40 + r() * 70;
    const x2 = Math.min(X1, x + w);
    const k = [0.19 + r() * 0.04, 0.24 + r() * 0.04, 0.14 + r() * 0.03];
    quad([x, y + 1.4, BANK_Z - 2.5], [x2, y + 1.4, BANK_Z - 2.5], [x2, y + CREST, BANK_Z - 11], [x, y + CREST, BANK_Z - 11], k);
    x = x2;
  }
  // the crest with its path, and the land side down to the polder
  quad([X0, y + CREST, BANK_Z - 11], [X1, y + CREST, BANK_Z - 11], [X1, y + CREST, BANK_Z - 14], [X0, y + CREST, BANK_Z - 14], [0.33, 0.31, 0.25]);
  quad([X0, y + CREST, BANK_Z - 14], [X1, y + CREST, BANK_Z - 14], [X1, y + POLDER, BANK_Z - 22], [X0, y + POLDER, BANK_Z - 22], [0.18, 0.22, 0.13]);
  quad([X0, y + POLDER, BANK_Z - 22], [X1, y + POLDER, BANK_Z - 22], [X1, y + POLDER, BANK_Z - 320], [X0, y + POLDER, BANK_Z - 320], [0.2, 0.24, 0.15]);

  // ---- a far tree line in the haze: a low jagged band across the polder
  {
    const z = BANK_Z - 150;
    let prevX = X0;
    let prevH = 6;
    for (let x = X0 + 12; x <= X1; x += 10 + r() * 14) {
      const h = 5 + r() * 5;
      const k = [0.15 + r() * 0.03, 0.18 + r() * 0.03, 0.12];
      quad([prevX, y + POLDER - 0.5, z], [x, y + POLDER - 0.5, z], [x, y + POLDER + h, z], [prevX, y + POLDER + prevH, z], k);
      prevX = x;
      prevH = h;
    }
  }

  // ---- rows of trees along the dyke, on the polder behind it: elms and willows, poplars in rows
  const AUTUMN = [
    [0.3, 0.27, 0.12],
    [0.22, 0.26, 0.12],
    [0.38, 0.3, 0.11],
    [0.26, 0.22, 0.12],
    [0.34, 0.24, 0.1],
  ];
  for (let x = X0 + 20; x < X1; ) {
    const gap = r();
    if (gap < 0.12) {
      x += 30 + r() * 50; // an open stretch
      continue;
    }
    const z = BANK_Z - 24 - r() * 22;
    const k = AUTUMN[Math.floor(r() * AUTUMN.length)].map((v) => v * (0.9 + r() * 0.2));
    if (r() < 0.3) {
      // a short row of poplars
      const n = 3 + Math.floor(r() * 5);
      const tone = r() < 0.5 ? [0.2, 0.24, 0.12] : [0.36, 0.31, 0.12];
      for (let i = 0; i < n; i++) tree(x + i * 5.5, z, y + POLDER, 13 + r() * 6, 1.4 + r() * 0.5, tone.map((v) => v * (0.92 + r() * 0.16)), 5, 0.18);
      x += n * 5.5 + 6 + r() * 12;
    } else {
      tree(x, z, y + POLDER, 8 + r() * 4, 3.2 + r() * 1.8, k, 6);
      x += 7 + r() * 11;
    }
  }

  // ---- the ferry landing (the Vlaams Hoofd): inns and houses close behind the dyke, showing
  // their upper walls and roofs over it; a few more along the dyke further down
  const houses: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) houses.push([-300 + i * 13 + r() * 6, BANK_Z - 17 - r() * 6]);
  for (let i = 0; i < 5; i++) houses.push([150 + r() * 380, BANK_Z - 17 - r() * 8]);
  for (const [x, z] of houses) {
    const w = 6 + r() * 5;
    const d = 7 + r() * 4;
    const h = 5.5 + r() * 3.5;
    const base = y + POLDER - 0.5;
    const wall = r() < 0.45 ? [0.42, 0.27, 0.21] : r() < 0.7 ? [0.55, 0.53, 0.47] : [0.48, 0.44, 0.36];
    box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, base, base + h, wall);
    // dark windows in a row on the upper floor, toward the river
    const wy = base + h - 1.9;
    for (let k = -1; k <= 1; k++) {
      const wx = x + (k * w) / 3.2;
      quad([wx - 0.45, wy, z + d / 2 + 0.03], [wx + 0.45, wy, z + d / 2 + 0.03], [wx + 0.45, wy + 1.1, z + d / 2 + 0.03], [wx - 0.45, wy + 1.1, z + d / 2 + 0.03], [0.1, 0.1, 0.11]);
    }
    // a gable roof along x (red tiles or grey slate)
    const top = base + h + w * 0.5;
    const roof = r() < 0.6 ? [0.3, 0.15, 0.11] : [0.2, 0.21, 0.23];
    quad([x - w / 2, base + h, z + d / 2], [x + w / 2, base + h, z + d / 2], [x + w / 2, top, z], [x - w / 2, top, z], roof);
    quad([x + w / 2, base + h, z - d / 2], [x - w / 2, base + h, z - d / 2], [x - w / 2, top, z], [x + w / 2, top, z], shade(roof, 0.8));
    tri([x - w / 2, base + h, z + d / 2], [x - w / 2, top, z], [x - w / 2, base + h, z - d / 2], shade(wall, 0.8));
    tri([x + w / 2, base + h, z - d / 2], [x + w / 2, top, z], [x + w / 2, base + h, z + d / 2], shade(wall, 0.8));
    // a chimney
    const cx = x + (r() - 0.5) * w * 0.5;
    box(cx - 0.4, cx + 0.4, z - 0.4, z + 0.4, top - 1.5, top + 1.2, [0.3, 0.2, 0.17]);
  }

  // ---- the earthworks of the fort (Tete de Flandre): long low grassed ramparts with sloped faces
  for (const [x, len] of [[80, 180], [300, 120]] as const) {
    const z0 = BANK_Z - 70;
    const z1 = BANK_Z - 52;
    const b = y + POLDER - 0.5;
    const t = y + POLDER + 5;
    const k = [0.2, 0.25, 0.14];
    quad([x, b, z1], [x + len, b, z1], [x + len, t, z1 - 5], [x, t, z1 - 5], k);
    quad([x, t, z1 - 5], [x + len, t, z1 - 5], [x + len, t, z0 + 5], [x, t, z0 + 5], shade(k, 1.12));
    tri([x, b, z1], [x, t, z1 - 5], [x - 6, b, z1 - 5], shade(k, 0.85));
    tri([x + len, t, z1 - 5], [x + len, b, z1], [x + len + 6, b, z1 - 5], shade(k, 0.85));
  }

  // ---- a windmill on the polder, sails set in a cross
  {
    const x = -520;
    const z = BANK_Z - 30;
    const base = y + POLDER - 0.5;
    // a tapering tower (eight sides would be lost at this distance: four, and a cap)
    const k = [0.46, 0.42, 0.35];
    quad([x - 2.8, base, z + 2.8], [x + 2.8, base, z + 2.8], [x + 1.8, base + 12, z + 1.8], [x - 1.8, base + 12, z + 1.8], k);
    quad([x - 2.8, base, z - 2.8], [x - 2.8, base, z + 2.8], [x - 1.8, base + 12, z + 1.8], [x - 1.8, base + 12, z - 1.8], shade(k, 0.8));
    quad([x + 2.8, base, z + 2.8], [x + 2.8, base, z - 2.8], [x + 1.8, base + 12, z - 1.8], [x + 1.8, base + 12, z + 1.8], shade(k, 0.8));
    tri([x - 2.1, base + 12, z + 2.1], [x + 2.1, base + 12, z + 2.1], [x, base + 14.5, z], [0.22, 0.18, 0.16]);
    const hub = [x, base + 12.5, z + 2.6];
    for (const a of [0.3, 0.3 + Math.PI / 2, 0.3 + Math.PI, 0.3 + (3 * Math.PI) / 2]) {
      const ex = Math.cos(a) * 9;
      const ey = Math.sin(a) * 9;
      const px = -Math.sin(a) * 0.9;
      const py = Math.cos(a) * 0.9;
      quad([hub[0], hub[1], hub[2]], [hub[0] + ex, hub[1] + ey, hub[2]], [hub[0] + ex + px, hub[1] + ey + py, hub[2]], [hub[0] + px, hub[1] + py, hub[2]], [0.62, 0.58, 0.5]);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // the ordinary fog (fixes 2026-09-24: carried past the fog it turned into flat pale shapes)
  const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { affine: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = "far_bank_land";
  g.add(mesh);
  scene.add(g);
  return g;
}
