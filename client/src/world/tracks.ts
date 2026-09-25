import * as THREE from "three";
import { psx } from "../retro/psx";
import { settsPaving } from "./paving";
import type { Rect } from "./geom";

// The quay railway (tools/city/design.py DECOR "tracks" and "crane_rails"): iron rails
// laid flush in a band of granite setts, as on the period photos of the quays. Corners
// are rounded into arcs, so the lines flow. The portal cranes stand over the railway
// and run on their own rails either side of it. Everything lies on the ground at y = 0:
// the setts band is drawn with a polygon offset, so it never fights with the paving.

export interface TrackLine {
  pts: Array<[number, number]>;
  /** Corner radius: one for all corners, or one per point (first and last are not corners). */
  r: number | number[];
}

export interface TrackData {
  tracks?: TrackLine[];
  crane_rails?: Array<[number, number, number, number]>;
}

const GAUGE = 1.435;
const BAND = 2.2;
const RAIL_W = 0.075;
const RAIL_H = 0.035;

type P = [number, number];
type V3 = [number, number, number];

/** A polyline with every corner rounded into an arc (a point about every metre on the arcs). */
export function smoothLine(line: TrackLine): P[] {
  const pts = line.pts;
  const out: P[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const r = Array.isArray(line.r) ? (line.r[i] ?? 0) : line.r;
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const [cx, cz] = pts[i + 1];
    const l1 = Math.hypot(bx - ax, bz - az);
    const l2 = Math.hypot(cx - bx, cz - bz);
    const d1x = (bx - ax) / l1;
    const d1z = (bz - az) / l1;
    const d2x = (cx - bx) / l2;
    const d2z = (cz - bz) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, d1x * d2x + d1z * d2z)));
    if (r <= 0 || turn < 1e-3) {
      out.push([bx, bz]);
      continue;
    }
    // never longer than half of either leg, so neighbouring arcs do not overlap
    const t = Math.min(r * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const rr = t / Math.tan(turn / 2);
    const side = Math.sign(d1x * d2z - d1z * d2x);
    // centre of the arc: from the start of the arc, square to the way in, on the inside
    const sx = bx - d1x * t;
    const sz = bz - d1z * t;
    const nx = -d1z * side;
    const nz = d1x * side;
    const ox = sx + nx * rr;
    const oz = sz + nz * rr;
    const a0 = Math.atan2(sz - oz, sx - ox);
    const n = Math.max(2, Math.ceil(rr * turn));
    for (let k = 0; k <= n; k++) {
      const a = a0 + side * turn * (k / n);
      out.push([ox + Math.cos(a) * rr, oz + Math.sin(a) * rr]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** A side normal at each point, from the neighbours on either side. */
function normals(line: P[]): P[] {
  const out: P[] = [];
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    out.push([-(b[1] - a[1]) / l, (b[0] - a[0]) / l]);
  }
  return out;
}

/** Triangles with uv and a grey shade per vertex. */
class Strip {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  quad(a: V3, b: V3, c: V3, d: V3, uv: [number, number, number, number], shade: number): void {
    for (const p of [a, b, c, a, c, d]) this.pos.push(...p);
    const [u0, v0, u1, v1] = uv;
    this.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let i = 0; i < 6; i++) this.col.push(shade, shade, shade);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    faceUp(g);
    g.computeVertexNormals();
    return g;
  }
}

/** Flat triangles must face up (+y): swap two corners of any that face down. */
function faceUp(g: THREE.BufferGeometry): void {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const attrs = Object.values(g.attributes) as THREE.BufferAttribute[];
  for (let i = 0; i < p.count; i += 3) {
    const ay = p.getY(i);
    if (Math.abs(p.getY(i + 1) - ay) > 1e-5 || Math.abs(p.getY(i + 2) - ay) > 1e-5) continue;
    const ax = p.getX(i);
    const az = p.getZ(i);
    const ny = (p.getZ(i + 1) - az) * (p.getX(i + 2) - ax) - (p.getX(i + 1) - ax) * (p.getZ(i + 2) - az);
    if (ny >= 0) continue;
    for (const at of attrs) {
      const s = at.itemSize;
      const arr = at.array as Float32Array;
      for (let k = 0; k < s; k++) {
        const t = arr[(i + 1) * s + k];
        arr[(i + 1) * s + k] = arr[(i + 2) * s + k];
        arr[(i + 2) * s + k] = t;
      }
    }
  }
}

/** The flat band of setts along a line, from offset o0 to o1 across it, rows v0..v1 of the texture. */
function band(s: Strip, line: P[], nrm: P[], o0: number, o1: number, v0: number, v1: number): void {
  let dist = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const [nax, naz] = nrm[i];
    const [nbx, nbz] = nrm[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const u0 = dist / 2;
    const u1 = (dist + L) / 2;
    dist += L;
    s.quad(
      [ax + nax * o0, 0, az + naz * o0],
      [bx + nbx * o0, 0, bz + nbz * o0],
      [bx + nbx * o1, 0, bz + nbz * o1],
      [ax + nax * o1, 0, az + naz * o1],
      [u0, v0, u1, v1],
      1,
    );
  }
}

/** One iron rail along a line at offset o: a bright worn top and two dark rusty sides. */
function rail(s: Strip, line: P[], nrm: P[], o: number): void {
  const h = RAIL_H;
  const w = RAIL_W / 2;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const [nax, naz] = nrm[i];
    const [nbx, nbz] = nrm[i + 1];
    const A = (k: number, y: number): V3 => [ax + nax * (o + k), y, az + naz * (o + k)];
    const B = (k: number, y: number): V3 => [bx + nbx * (o + k), y, bz + nbz * (o + k)];
    s.quad(A(-w, h), B(-w, h), B(w, h), A(w, h), [0, 0, 1, 1], 1);
    s.quad(A(w, 0), B(w, 0), B(w, h), A(w, h), [0, 0, 1, 1], 0.28);
    s.quad(A(-w, 0), B(-w, 0), B(-w, h), A(-w, h), [0, 0, 1, 1], 0.28);
  }
}

/** Boxes round the tracks and crane rails, for props to keep off them. */
export function trackKeepOut(data: TrackData): Rect[] {
  const out: Rect[] = [];
  const add = (a: P, b: P, m: number) =>
    out.push({ minX: Math.min(a[0], b[0]) - m, maxX: Math.max(a[0], b[0]) + m, minZ: Math.min(a[1], b[1]) - m, maxZ: Math.max(a[1], b[1]) + m });
  for (const t of data.tracks ?? []) {
    const line = smoothLine(t);
    for (let i = 0; i < line.length - 1; i++) add(line[i], line[i + 1], BAND / 2 + 0.4);
  }
  for (const [x0, z0, x1, z1] of data.crane_rails ?? []) add([x0, z0], [x1, z1], 0.6);
  return out;
}

/**
 * The line in pieces at most `step` long, split where it crosses a bridge: bridges
 * carry their own rails on their decks (they open, and the deck is not at y = 0).
 */
function offBridges(line: P[], bridges: Rect[], step = 0.5): P[][] {
  const on = (x: number, z: number) => bridges.some((b) => x > b.minX - 0.2 && x < b.maxX + 0.2 && z > b.minZ - 0.2 && z < b.maxZ + 0.2);
  const runs: P[][] = [];
  let run: P[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) {
      const p0: P = [ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n];
      const p1: P = [ax + ((bx - ax) * (k + 1)) / n, az + ((bz - az) * (k + 1)) / n];
      if (on((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)) {
        if (run.length > 1) runs.push(run);
        run = [];
        continue;
      }
      if (!run.length) run.push(p0);
      run.push(p1);
    }
  }
  if (run.length > 1) runs.push(run);
  // straight stretches back to their ends: fewer triangles
  return runs.map((r) => r.filter((p, i) => {
    if (i === 0 || i === r.length - 1) return true;
    const [ax, az] = r[i - 1];
    const [bx, bz] = r[i + 1];
    return Math.abs((p[0] - ax) * (bz - az) - (p[1] - az) * (bx - ax)) > 1e-4;
  }));
}

/** Lay the railway into the scene: two meshes (the setts, the rails). Not over the bridges. */
export function buildTracks(scene: THREE.Scene, data: TrackData, bridges: Rect[] = []): THREE.Group {
  const group = new THREE.Group();
  group.name = "tracks";
  const bandS = new Strip();
  const railS = new Strip();
  for (const t of data.tracks ?? []) {
    if (t.pts.length < 2) continue;
    for (const line of offBridges(smoothLine(t), bridges)) {
      const nrm = normals(line);
      band(bandS, line, nrm, -BAND / 2, BAND / 2, 0, 1);
      rail(railS, line, nrm, -GAUGE / 2);
      rail(railS, line, nrm, GAUGE / 2);
    }
  }
  for (const [x0, z0, x1, z1] of data.crane_rails ?? []) {
    const line: P[] = [
      [x0, z0],
      [x1, z1],
    ];
    const nrm = normals(line);
    // a narrow strip of setts from the middle of the texture (no grooves there), and a row of
    // long edge stones either side, where it meets the paving (as along the railway)
    band(bandS, line, nrm, -0.3, 0.3, 0.36, 0.64);
    band(bandS, line, nrm, -0.44, -0.3, 0.0, 0.055);
    band(bandS, line, nrm, 0.3, 0.44, 0.0, 0.055);
    rail(railS, line, nrm, 0);
  }
  // uneven setts with a height map, like the streets (world/paving.ts settsPaving)
  const setts = settsPaving();
  const bandMat = psx(
    // no depth written: where two tracks cross or join their bands overlap and would fight (z-fight check)
    new THREE.MeshLambertMaterial({ map: setts.map, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4, depthWrite: false }),
    // relief light from the height map (no parallax: the band's uv runs along the line, not north)
    { noSnap: true, affine: 0, vary: 0.8, relief: { height: setts.height, id: setts.id, holes: 0.3, depth: 0, tile: 2, bump: 3.4 } },
  );
  const railMat = psx(
    new THREE.MeshPhongMaterial({ color: 0x8a8680, vertexColors: true, specular: 0x6a6a6a, shininess: 40, side: THREE.DoubleSide }),
    { noSnap: true, affine: 0 },
  );
  const bandMesh = new THREE.Mesh(bandS.geometry(), bandMat);
  bandMesh.name = "track_setts";
  const railMesh = new THREE.Mesh(railS.geometry(), railMat);
  railMesh.name = "track_rails";
  group.add(bandMesh, railMesh);
  scene.add(group);
  return group;
}
