import * as THREE from "three";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import { LW_MIN } from "./tide";

// The land beyond the town wall (Steve, 2026-09-25: "Gates should be closed, we cannot leave the city. Because
// we can go up the walls, there must also be countryside"). Seen from the walk on the wall, over the moat: the
// flat Brabant fields of 1873 round Antwerp, stubble, ploughland and pasture in strips, hedges and rows of
// pollard willows between them, the roads out of the four gates lined with poplars, farmsteads along them,
// two windmills, the villages of Borgerhout and Berchem with their church spires, and a far tree line in the
// haze. Nobody walks here (the walk map has it outside): one mesh of vertex colours, the far bank's way
// (world/farbank.ts), in the ordinary fog.
//
// It covers the ground outside the map's area (city.json area), from the river bank up; the map's own land
// runs to that edge (the far bank past the moat is grass in the ground zones, the gate roads earth).

type V3 = [number, number, number];
type RGB = [number, number, number];

interface Gate {
  frame: { o: [number, number]; t: [number, number]; n: [number, number] };
  far_road: number[][];
  name: string;
}

const ALBEDO = 0.5; // (darker than the far bank's: seen close from the wall, next to the grass of the berm)
const REACH = 1100; // how far out the land goes (m)

export function buildCountryside(scene: THREE.Scene, waterY: number): THREE.Group {
  const g = new THREE.Group();
  g.name = "countryside";
  const area = (CITY as unknown as { area: number[][] }).area;
  const AX0 = Math.min(...area.map((p) => p[0]));
  const AX1 = Math.max(...area.map((p) => p[0]));
  const AZ1 = Math.max(...area.map((p) => p[1]));
  const gates = ((CITY as unknown as { decor?: { rampart?: { gates?: Gate[] } } }).decor?.rampart?.gates ?? []) as Gate[];

  const pos: number[] = [];
  const col: number[] = [];
  let seed = 1874;
  const r = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const tri = (a: V3, b: V3, c: V3, k: RGB) => {
    pos.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) col.push(k[0] * ALBEDO, k[1] * ALBEDO, k[2] * ALBEDO);
  };
  const quad = (a: V3, b: V3, c: V3, d: V3, k: RGB) => {
    tri(a, b, c, k);
    tri(a, c, d, k);
  };
  const shade = (k: RGB, f: number): RGB => [Math.min(1, k[0] * f), Math.min(1, k[1] * f), Math.min(1, k[2] * f)];
  /** A flat quad on the ground, wound to face up. */
  const flat = (x0: number, z0: number, x1: number, z1: number, y: number, k: RGB) => quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], k);
  const box = (x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, k: RGB) => {
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], k);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], shade(k, 0.8));
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], shade(k, 0.85));
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], shade(k, 0.9));
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], shade(k, 1.1));
  };
  /** A tree crown on a short trunk (farbank.ts): round for elms and willows, tall and narrow for poplars. */
  const tree = (x: number, z: number, h: number, w: number, k: RGB, n = 6, low = 0.35) => {
    const trunkTop = h * low;
    box(x - 0.25, x + 0.25, z - 0.25, z + 0.25, -0.3, trunkTop + 0.5, [0.14, 0.12, 0.1]);
    const midY = trunkTop + (h - trunkTop) * 0.45;
    const top: V3 = [x + (r() - 0.5) * w * 0.3, h, z + (r() - 0.5) * w * 0.3];
    const bot: V3 = [x, trunkTop, z];
    const a0 = r() * Math.PI * 2;
    const ring: V3[] = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const rr = w * (0.8 + r() * 0.35);
      ring.push([x + Math.cos(a) * rr, midY + (r() - 0.5) * h * 0.12, z + Math.sin(a) * rr]);
    }
    for (let i = 0; i < n; i++) {
      const p = ring[i];
      const q = ring[(i + 1) % n];
      tri(p, q, top, shade(k, 1.05));
      tri(q, p, bot, shade(k, 0.72));
    }
  };
  const AUTUMN: RGB[] = [
    [0.32, 0.28, 0.12],
    [0.24, 0.27, 0.13],
    [0.4, 0.3, 0.11],
    [0.28, 0.23, 0.12],
    [0.36, 0.25, 0.1],
  ];
  const autumn = (): RGB => AUTUMN[Math.floor(r() * AUTUMN.length)].map((v) => v * (0.9 + r() * 0.2)) as RGB;
  // the fields of late October: stubble, fresh ploughland, pasture, a crop of beet or cabbage
  const FIELDS: RGB[] = [
    [0.5, 0.44, 0.28], // stubble
    [0.34, 0.27, 0.19], // ploughed
    [0.3, 0.24, 0.17], // ploughed, wetter
    [0.27, 0.33, 0.18], // pasture
    [0.23, 0.3, 0.16], // pasture
    [0.3, 0.34, 0.2], // beet, cabbage
  ];

  /** Is (x, z) inside the map's own area (drawn by the city), or in the river? */
  const inArea = (x: number, z: number) => x > AX0 - 0.5 && x < AX1 + 0.5 && z < AZ1 + 0.5;

  // ---- the land: fields in a patchwork of strips round the map, from the river bank out to REACH
  const X0 = AX0 - REACH;
  const X1 = AX1 + REACH;
  const Z1 = AZ1 + REACH;
  const CELL = 90;
  for (let gx = X0; gx < X1; gx += CELL) {
    for (let gz = 0; gz < Z1; gz += CELL) {
      // cut the cell against the map's area: the part outside it, as up to three rects
      const parts: Array<[number, number, number, number]> = [];
      const cx1 = gx + CELL;
      const cz1 = gz + CELL;
      if (cx1 <= AX0 || gx >= AX1 || gz >= AZ1) parts.push([gx, gz, cx1, cz1]);
      else {
        if (gx < AX0) parts.push([gx, gz, AX0, cz1]);
        if (cx1 > AX1) parts.push([AX1, gz, cx1, cz1]);
        if (cz1 > AZ1) parts.push([Math.max(gx, AX0), AZ1, Math.min(cx1, AX1), cz1]);
      }
      for (const [x0, z0, x1, z1] of parts) {
        // two or three long strips per cell, their long side turned at random (the old strip fields)
        const n = 2 + Math.floor(r() * 2);
        const alongX = r() < 0.5;
        // next to the map's edge: pasture, so the grass of the far bank runs on into it
        const nearEdge = Math.max(AX0 - x1, x0 - AX1, z0 - AZ1) < CELL;
        for (let i = 0; i < n; i++) {
          const k = (nearEdge ? [0.23, 0.3, 0.15] : FIELDS[Math.floor(r() * FIELDS.length)]).map((v) => v * (0.92 + r() * 0.16)) as RGB;
          if (alongX) flat(x0, z0 + ((z1 - z0) * i) / n, x1, z0 + ((z1 - z0) * (i + 1)) / n, 0, k);
          else flat(x0 + ((x1 - x0) * i) / n, z0, x0 + ((x1 - x0) * (i + 1)) / n, z1, 0, k);
        }
        // a hedge or a row of pollard willows along one edge now and then
        if (r() < 0.45) {
          const onX = r() < 0.5;
          const L = onX ? x1 - x0 : z1 - z0;
          for (let s = 4; s < L - 4; s += 7 + r() * 6) {
            const x = onX ? x0 + s : x0 + 1;
            const z = onX ? z0 + 1 : z0 + s;
            if (inArea(x, z)) continue;
            tree(x, z, 4 + r() * 3, 2 + r() * 1.2, autumn(), 5, 0.3);
          }
        }
      }
    }
  }

  // ---- the river bank beyond the map: a grassed slope down to the mud at low water, both ends
  for (const [x0, x1] of [
    [X0, AX0],
    [AX1, X1],
  ] as const) {
    quad([x0, 0, 2], [x1, 0, 2], [x1, waterY - 0.6, -6], [x0, waterY - 0.6, -6], [0.22, 0.27, 0.15]);
    quad([x0, waterY - 0.6, -6], [x1, waterY - 0.6, -6], [x1, LW_MIN - 1.5, -22], [x0, LW_MIN - 1.5, -22], [0.23, 0.21, 0.18]);
  }

  // ---- the roads out of the gates, lined with poplars, and farmsteads along them
  for (const gt of gates) {
    const n = gt.frame.n;
    const t = gt.frame.t;
    // the far road's outer end on the map's edge: carry it on from there
    const ends = gt.far_road;
    const mx = (ends[2][0] + ends[3][0]) / 2;
    const mz = (ends[2][1] + ends[3][1]) / 2;
    let x = mx;
    let z = mz;
    let dx = n[0];
    let dz = n[1];
    // step out from the map's edge (the road inside it is the city's earth)
    let guard = 0;
    while (inArea(x, z) && guard++ < 400) {
      x += dx;
      z += dz;
    }
    const W = 3.2;
    for (let s = 0; s < REACH; s += 12) {
      // a gentle bend now and then
      const bend = (r() - 0.5) * 0.08;
      const ndx = dx * Math.cos(bend) - dz * Math.sin(bend);
      const ndz = dx * Math.sin(bend) + dz * Math.cos(bend);
      const nx = x + ndx * 12;
      const nz = z + ndz * 12;
      if (nz < 4) break;
      const px = -dz * W;
      const pz = dx * W;
      const qx = -ndz * W;
      const qz = ndx * W;
      // (a hair over the fields so it wins where it crosses them)
      quad([x - px, 0.04, z - pz], [x + px, 0.04, z + pz], [nx + qx, 0.04, nz + qz], [nx - qx, 0.04, nz - qz], [0.36, 0.31, 0.22]);
      // poplars both sides
      if (s % 24 === 0)
        for (const side of [-1, 1]) {
          const tx = x + px * side * 1.9;
          const tz = z + pz * side * 1.9;
          if (!inArea(tx, tz)) tree(tx, tz, 15 + r() * 5, 1.5 + r() * 0.4, (r() < 0.5 ? [0.3, 0.3, 0.12] : [0.42, 0.33, 0.12]).map((v) => v * (0.9 + r() * 0.2)) as RGB, 5, 0.16);
        }
      // a farmstead: a long low farmhouse and a barn with a big roof, a haystack
      if (s > 60 && s % 132 === 36) {
        const side = r() < 0.5 ? -1 : 1;
        const fx = x + px * side * 7 + dx * 4;
        const fz = z + pz * side * 7 + dz * 4;
        if (!inArea(fx, fz)) {
          const wall: RGB = r() < 0.6 ? [0.6, 0.57, 0.5] : [0.46, 0.3, 0.22];
          const hx = fx;
          const hz = fz;
          box(hx - 7, hx + 7, hz - 3.5, hz + 3.5, 0, 3.4, wall);
          const roof: RGB = r() < 0.5 ? [0.3, 0.2, 0.12] : [0.24, 0.22, 0.2];
          quad([hx - 7.4, 3.4, hz + 3.9], [hx + 7.4, 3.4, hz + 3.9], [hx + 7.4, 7.5, hz], [hx - 7.4, 7.5, hz], roof);
          quad([hx + 7.4, 3.4, hz - 3.9], [hx - 7.4, 3.4, hz - 3.9], [hx - 7.4, 7.5, hz], [hx + 7.4, 7.5, hz], shade(roof, 0.8));
          tri([hx - 7, 3.4, hz + 3.5], [hx - 7, 7.5, hz], [hx - 7, 3.4, hz - 3.5], shade(wall, 0.85));
          tri([hx + 7, 3.4, hz - 3.5], [hx + 7, 7.5, hz], [hx + 7, 3.4, hz + 3.5], shade(wall, 0.85));
          const bx = hx + 12;
          box(bx - 6, bx + 6, hz - 5, hz + 5, 0, 4, [0.33, 0.24, 0.17]);
          quad([bx - 6.4, 4, hz + 5.4], [bx + 6.4, 4, hz + 5.4], [bx + 6.4, 10, hz], [bx - 6.4, 10, hz], [0.36, 0.3, 0.16]);
          quad([bx + 6.4, 4, hz - 5.4], [bx - 6.4, 4, hz - 5.4], [bx - 6.4, 10, hz], [bx + 6.4, 10, hz], shade([0.36, 0.3, 0.16], 0.8));
          tree(hx - 12, hz + 6, 9 + r() * 3, 4 + r(), autumn(), 6);
          // a haystack
          const sx = hx + 4;
          const sz = hz + 10;
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            const b = ((i + 1) / 6) * Math.PI * 2;
            tri([sx + Math.cos(a) * 2.4, 0, sz + Math.sin(a) * 2.4], [sx + Math.cos(b) * 2.4, 0, sz + Math.sin(b) * 2.4], [sx, 4.2, sz], shade([0.62, 0.52, 0.28], 0.85 + 0.1 * Math.cos(a)));
          }
        }
      }
      x = nx;
      z = nz;
      dx = ndx;
      dz = ndz;
    }
    void t;
  }

  // ---- two windmills (post mills, sails set in a cross) and the villages with their spires
  const mill = (x: number, z: number, a0: number) => {
    const k: RGB = [0.42, 0.34, 0.26];
    box(x - 0.6, x + 0.6, z - 0.6, z + 0.6, 0, 5, [0.25, 0.2, 0.16]);
    box(x - 2.4, x + 2.4, z - 3, z + 3, 5, 11, k);
    quad([x - 2.6, 11, z + 3.2], [x + 2.6, 11, z + 3.2], [x + 2.6, 13, z], [x - 2.6, 13, z], shade(k, 0.7));
    quad([x + 2.6, 11, z - 3.2], [x - 2.6, 11, z - 3.2], [x - 2.6, 13, z], [x + 2.6, 13, z], shade(k, 0.6));
    const hub: V3 = [x, 9.5, z + 3.2];
    for (const a of [a0, a0 + Math.PI / 2, a0 + Math.PI, a0 + (3 * Math.PI) / 2]) {
      const ex = Math.cos(a) * 9;
      const ey = Math.sin(a) * 9;
      const px = -Math.sin(a) * 0.9;
      const py = Math.cos(a) * 0.9;
      quad(hub, [hub[0] + ex, hub[1] + ey, hub[2]], [hub[0] + ex + px, hub[1] + ey + py, hub[2]], [hub[0] + px, hub[1] + py, hub[2]], [0.62, 0.58, 0.5]);
    }
  };
  mill(AX1 + 260, 220, 0.4);
  mill(AX0 - 300, 520, 1.1);
  const village = (cx: number, cz: number, n: number) => {
    for (let i = 0; i < n; i++) {
      const x = cx + (r() - 0.5) * 140;
      const z = cz + (r() - 0.5) * 90;
      if (inArea(x, z)) continue;
      const w = 6 + r() * 5;
      const d = 7 + r() * 4;
      const h = 4.5 + r() * 3;
      const wall: RGB = r() < 0.5 ? [0.45, 0.29, 0.22] : [0.56, 0.53, 0.47];
      box(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h, wall);
      const top = h + w * 0.5;
      const roof: RGB = r() < 0.6 ? [0.32, 0.16, 0.12] : [0.21, 0.22, 0.24];
      quad([x - w / 2, h, z + d / 2], [x + w / 2, h, z + d / 2], [x + w / 2, top, z], [x - w / 2, top, z], roof);
      quad([x + w / 2, h, z - d / 2], [x - w / 2, h, z - d / 2], [x - w / 2, top, z], [x + w / 2, top, z], shade(roof, 0.8));
      tri([x - w / 2, h, z + d / 2], [x - w / 2, top, z], [x - w / 2, h, z - d / 2], shade(wall, 0.8));
      tri([x + w / 2, h, z - d / 2], [x + w / 2, top, z], [x + w / 2, h, z + d / 2], shade(wall, 0.8));
    }
    // the church: a nave and a tower with a spire
    const k: RGB = [0.5, 0.47, 0.4];
    box(cx - 14, cx + 14, cz - 6, cz + 6, 0, 11, k);
    quad([cx - 14.4, 11, cz + 6.4], [cx + 14.4, 11, cz + 6.4], [cx + 14.4, 17, cz], [cx - 14.4, 17, cz], [0.22, 0.23, 0.25]);
    quad([cx + 14.4, 11, cz - 6.4], [cx - 14.4, 11, cz - 6.4], [cx - 14.4, 17, cz], [cx + 14.4, 17, cz], [0.18, 0.19, 0.21]);
    box(cx - 20, cx - 13, cz - 3.5, cz + 3.5, 0, 26, k);
    const sx = cx - 16.5;
    for (const [a, b] of [
      [[-3.5, -3.5], [3.5, -3.5]],
      [[3.5, -3.5], [3.5, 3.5]],
      [[3.5, 3.5], [-3.5, 3.5]],
      [[-3.5, 3.5], [-3.5, -3.5]],
    ] as const)
      tri([sx + a[0], 26, cz + a[1]], [sx + b[0], 26, cz + b[1]], [sx, 44, cz], shade([0.2, 0.21, 0.23], 0.8 + 0.1 * a[0] / 3.5));
    for (let i = 0; i < 6; i++) tree(cx + (r() - 0.5) * 160, cz + 50 + r() * 30, 9 + r() * 4, 4 + r() * 1.5, autumn(), 6);
  };
  village(AX1 - 80, AZ1 + 520, 22); // Borgerhout, inland beyond the Keizerspoort
  village(AX0 + 60, AZ1 + 600, 18); // Berchem, beyond the Kipdorppoort
  village(AX0 - 420, 180, 12); // Kiel, up river beyond the south wall

  // ---- a far tree line in the haze all round
  for (const [x0, z0, x1, z1] of [
    [X0 + 40, Z1 - 60, X1 - 40, Z1 - 60],
    [X0 + 40, 20, X0 + 40, Z1 - 60],
    [X1 - 40, 20, X1 - 40, Z1 - 60],
  ] as const) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    let ph = 6;
    let px = x0;
    let pz = z0;
    for (let s = 12; s <= L; s += 10 + r() * 14) {
      const x = x0 + ((x1 - x0) * s) / L;
      const z = z0 + ((z1 - z0) * s) / L;
      const h = 6 + r() * 6;
      const k: RGB = [0.16 + r() * 0.03, 0.19 + r() * 0.03, 0.12];
      quad([px, -0.5, pz], [x, -0.5, z], [x, h, z], [px, ph, pz], k);
      px = x;
      pz = z;
      ph = h;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { affine: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = "countryside_land";
  g.add(mesh);
  scene.add(g);
  return g;
}
