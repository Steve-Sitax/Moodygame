import * as THREE from "three";
import * as HP from "../../../shared/hallPlan";
import type { HallPlan } from "../../../shared/hallPlan";
import type { InWorld, InWorldRoom, Opening } from "../world/inworld";

// The interior check (dev, __scheldemist.interiorcheck(id?); docs/building-with-interior.md; M7 prison real,
// 2026-09-26). Steve's rule: interiors are real, never instanced. For every building with an inside (every room of
// world/inworld.ts: the prison, the cathedral, the churches, the landmark halls, the taverns, the shops, the homes):
//  - its shell's real openings: the empties "opening_<id>" a Blender shell writes (tools/blender/build_prison.py is
//    the first). A shell without them is an older one: its glass (a material named glass) over the room is listed,
//    and a house's painted "glow" windows from its plan, as windows the room does not stand behind;
//  - for each opening: is it an opening of the in-world room (drawn through it)? does a real room stand behind it (rays
//    from outside through it reach the room's geometry, not a pane of the shell or nothing)? does the room's lining
//    meet the shell's reveal (no gap where the street shows)? does the room stay inside the shell round it?
//  - every opening of the room has a hole in the shell (no door or window drawn through a wall);
//  - every walkable floor of its plan is reached on foot from a door (a flood of the plan, storeys and stairs too).
// It must list nothing wrong. Rays run on a triangle grid of the shell and the room (no library), a few seconds a
// building at most.

export interface CheckTarget {
  id: string;
  label: string;
  room: InWorldRoom;
  /** Its walking plan (halls, houses), if it has one; and whether its doors are shut to Jef for good (a private house). */
  plan?: HallPlan;
  locked?: boolean;
  /** A house's painted windows over its room (world: middle, out, half width, half height). */
  painted?: Array<{ label: string; c: THREE.Vector3; n: THREE.Vector3; hw: number; hh: number }>;
}

interface Tri {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  n: THREE.Vector3;
  room: boolean;
  glass: boolean;
  two: boolean;
  name: string;
}

/** Triangles in a uniform grid (world), for fast rays. */
class TriGrid {
  readonly tris: Tri[] = [];
  private cells = new Map<number, number[]>();
  private box = new THREE.Box3();
  constructor(private readonly cell = 0.6) {}
  add(mesh: THREE.Mesh, room: boolean, within?: THREE.Box3): void {
    const g = mesh.geometry;
    const pos = g.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const idx = g.index;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const m0 = mats[0] as THREE.Material & { opacity?: number; transparent?: boolean };
    const glass = !!mesh.userData.glass || /glass/i.test(m0.name ?? "") || (m0.transparent === true && (m0.opacity ?? 1) < 0.95);
    const two = m0.side === THREE.DoubleSide;
    mesh.updateWorldMatrix(true, false);
    const M = mesh.matrixWorld;
    // (a mirrored mesh, a home's room turned across: three.js draws its faces the other way round, so do we)
    const flip = M.determinant() < 0;
    const n = idx ? idx.count : pos.count;
    const v = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(M);
    for (let i = 0; i + 2 < n; i += 3) {
      const a = v(i);
      const b = v(i + 1);
      const c = v(i + 2);
      if (within && !within.intersectsBox(new THREE.Box3().setFromPoints([a, b, c]))) continue;
      const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (nn.lengthSq() < 1e-12) continue;
      nn.normalize();
      if (flip) nn.negate();
      this.tris.push({ a, b, c, n: nn, room, glass, two, name: mesh.name || mesh.parent?.name || "?" });
    }
  }
  /** Grid the triangles within `bounds` (a big triangle, a ground or a roof, only in the cells within it). */
  build(bounds?: THREE.Box3): void {
    this.box.makeEmpty();
    for (const t of this.tris) this.box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
    if (bounds) this.box.intersect(bounds);
    const tb = new THREE.Box3();
    this.tris.forEach((t, i) => {
      tb.makeEmpty().expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
      tb.intersect(this.box);
      if (tb.isEmpty()) return;
      const [i0, j0, k0] = this.ijk(tb.min);
      const [i1, j1, k1] = this.ijk(tb.max);
      for (let x = i0; x <= i1; x++) for (let y = j0; y <= j1; y++) for (let z = k0; z <= k1; z++) {
        const key = this.key(x, y, z);
        let c = this.cells.get(key);
        if (!c) this.cells.set(key, (c = []));
        c.push(i);
      }
    });
  }
  private ijk(p: THREE.Vector3): [number, number, number] {
    return [Math.floor((p.x - this.box.min.x) / this.cell), Math.floor((p.y - this.box.min.y) / this.cell), Math.floor((p.z - this.box.min.z) / this.cell)];
  }
  private key(i: number, j: number, k: number): number {
    return (i + 1024) * 4194304 + (j + 1024) * 2048 + (k + 1024);
  }
  /** Hits along a ray (front faces, or both sides of a two-sided material), nearest first, up to `far`. */
  cast(o: THREE.Vector3, d: THREE.Vector3, far: number, want: (t: Tri) => boolean = () => true): Array<{ t: number; tri: Tri }> {
    const out: Array<{ t: number; tri: Tri }> = [];
    const seen = new Set<number>();
    // every cell along the segment (a 3D DDA), from where it enters the grid's box
    const inv = [1 / d.x, 1 / d.y, 1 / d.z];
    let t0 = 0;
    let t1 = far;
    const mn = [this.box.min.x, this.box.min.y, this.box.min.z];
    const mxv = [this.box.max.x, this.box.max.y, this.box.max.z];
    const oo = [o.x, o.y, o.z];
    for (let a = 0; a < 3; a++) {
      if (!isFinite(inv[a])) {
        if (oo[a] < mn[a] || oo[a] > mxv[a]) return out;
        continue;
      }
      let ta = (mn[a] - oo[a]) * inv[a];
      let tb = (mxv[a] - oo[a]) * inv[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t0 > t1) return out;
    const p = new THREE.Vector3().copy(o).addScaledVector(d, t0 + 1e-6);
    let [i, j, k] = this.ijk(p);
    const dd = [d.x, d.y, d.z];
    const step = dd.map((v) => (v > 0 ? 1 : v < 0 ? -1 : 0));
    const cellIdx = [i, j, k];
    const tMax = [0, 1, 2].map((a) => {
      if (step[a] === 0) return Infinity;
      const edge = mn[a] + (cellIdx[a] + (step[a] > 0 ? 1 : 0)) * this.cell;
      return (edge - oo[a]) * inv[a];
    });
    const tDelta = [0, 1, 2].map((a) => (step[a] === 0 ? Infinity : Math.abs(this.cell * inv[a])));
    let tCell = t0;
    let best = Infinity;
    for (let guard = 0; guard < 4000 && tCell <= t1 && tCell <= best; guard++) {
      const c = this.cells.get(this.key(i, j, k));
      if (c)
        for (const ti of c) {
          if (seen.has(ti)) continue;
          seen.add(ti);
          const tri = this.tris[ti];
          if (!want(tri)) continue;
          if (!tri.two && tri.n.dot(d) > 0) continue;
          const t = rayTri(o, d, tri);
          if (t !== null && t <= far) {
            out.push({ t, tri });
            best = Math.min(best, t);
          }
        }
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
      tCell = tMax[a];
      tMax[a] += tDelta[a];
      if (a === 0) i += step[0];
      else if (a === 1) j += step[1];
      else k += step[2];
    }
    return out.sort((x, y) => x.t - y.t);
  }
}

const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const pv = new THREE.Vector3();
const tv = new THREE.Vector3();
const qv = new THREE.Vector3();
function rayTri(o: THREE.Vector3, d: THREE.Vector3, tri: Tri): number | null {
  e1.subVectors(tri.b, tri.a);
  e2.subVectors(tri.c, tri.a);
  pv.crossVectors(d, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-10) return null;
  const inv = 1 / det;
  tv.subVectors(o, tri.a);
  const u = tv.dot(pv) * inv;
  if (u < 0 || u > 1) return null;
  qv.crossVectors(tv, e1);
  const v = d.dot(qv) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = e2.dot(qv) * inv;
  return t > 1e-4 ? t : null;
}

interface Marker {
  id: string;
  kind: string;
  label: string;
  shape: string;
  c: THREE.Vector3;
  n: THREE.Vector3;
  t: THREE.Vector3;
  hw: number;
  yb: number;
  yt: number;
  arch: boolean;
  depth: number;
  r?: number;
}

function markersIn(scene: THREE.Scene, box: THREE.Box3): Marker[] {
  const out: Marker[] = [];
  const q = new THREE.Quaternion();
  scene.traverse((o) => {
    if (!/^opening_/.test(o.name)) return;
    const u = o.userData ?? {};
    // (a marker has its kind: other models may name a part "opening_...")
    if (!u.kind) return;
    const c = o.getWorldPosition(new THREE.Vector3());
    if (!box.containsPoint(c)) return;
    o.parent?.getWorldQuaternion(q);
    const n = new THREE.Vector3(+u.nx || 0, +u.ny || 0, +u.nz || 0).applyQuaternion(q).normalize();
    const t = new THREE.Vector3(+u.tx || 0, 0, +u.tz || 0).applyQuaternion(q).normalize();
    out.push({ id: o.name.replace(/^opening_/, ""), kind: String(u.kind ?? "window"), label: String(u.label ?? o.name), shape: String(u.shape ?? "rect"), c, n, t, hw: +u.hw || 0.3, yb: +u.yb || c.y - 0.5, yt: +u.yt || c.y + 0.5, arch: !!+u.arch, depth: +u.depth || 0.3, r: u.r !== undefined ? +u.r : undefined });
  });
  return out;
}

export interface InteriorReport {
  id: string;
  label: string;
  shellOpenings: number | "none";
  registered: { doors: number; windows: number };
  problems: string[];
  notes: string[];
}

/** Check one room (or every room when `only` is not given). */
export function checkInteriors(scene: THREE.Scene, _inWorld: InWorld, targets: CheckTarget[], only?: string): { buildings: InteriorReport[]; problems: number; ms: number } {
  const t0 = performance.now();
  const reports: InteriorReport[] = [];
  // every shell opening belongs to one room: the one it is an opening of, else the one behind it
  const all = markersIn(scene, new THREE.Box3(new THREE.Vector3(-1e6, -1e6, -1e6), new THREE.Vector3(1e6, 1e6, 1e6)));
  const boxes = new Map(targets.map((T) => [T, roomBox(T.room)]));
  const owner = new Map<Marker, CheckTarget | null>();
  for (const m of all) {
    let o: CheckTarget | null = targets.find((T) => T.room.openings.some((op) => (m.kind === "door") === (op.kind === "door") && op.box.clone().expandByScalar(0.15).containsPoint(m.c))) ?? null;
    if (!o) {
      const b = m.c.clone().addScaledVector(m.n, -(m.depth + 0.5));
      o = targets.find((T) => boxes.get(T)!.containsPoint(b)) ?? null;
    }
    owner.set(m, o);
  }
  for (const T of targets) {
    if (only && !T.id.includes(only) && !T.label.toLowerCase().includes(only.toLowerCase())) continue;
    reports.push(checkOne(scene, T, all.filter((m) => owner.get(m) === T)));
  }
  const orphans = all.filter((m) => !owner.get(m) && (!only || m.label.toLowerCase().includes(only.toLowerCase()) || m.id.includes(only)));
  if (orphans.length) reports.push({ id: "(none)", label: "shell openings with no room behind", shellOpenings: orphans.length, registered: { doors: 0, windows: 0 }, problems: orphans.map((m) => `${m.label} (${m.id}): a real opening with no room behind it`), notes: [] });
  return { buildings: reports, problems: reports.reduce((a, r) => a + r.problems.length, 0), ms: Math.round(performance.now() - t0) };
}

function roomBox(room: InWorldRoom): THREE.Box3 {
  const b = new THREE.Box3();
  room.scene.updateMatrixWorld(true);
  room.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    b.union(bb);
  });
  return b;
}

function checkOne(scene: THREE.Scene, T: CheckTarget, markers: Marker[]): InteriorReport {
  const problems: string[] = [];
  const notes: string[] = [];
  const room = T.room;
  const rb = roomBox(room);
  const near = rb.clone().expandByScalar(1.5);
  // the shell: the street's meshes round the room (not people, animals, points, instanced street things)
  const grid = new TriGrid();
  let shellTris = 0;
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh || !m.visible) return;
    let p: THREE.Object3D | null = m;
    while (p) {
      if (!p.visible) return;
      p = p.parent;
    }
    if (!m.geometry?.getAttribute("position")) return;
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
    if (!bb.intersectsBox(near)) return;
    const before = grid.tris.length;
    grid.add(m, false, near);
    shellTris += grid.tris.length - before;
  });
  room.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    // (issue #29: a city house's punch lies in its openings and draws nothing: not the room)
    if (/^house_punch/.test((m.material as THREE.Material).name ?? "")) return;
    grid.add(m, true);
  });
  grid.build(near.clone().expandByScalar(1.0));
  const doors = room.openings.filter((o) => o.kind === "door").length;
  const report: InteriorReport = { id: T.id, label: T.label, shellOpenings: "none", registered: { doors, windows: room.openings.length - doors }, problems, notes };
  const up = new THREE.Vector3(0, 1, 0);
  const reach = Math.max(40, rb.getSize(new THREE.Vector3()).length() + 2);
  const fmt = (v: THREE.Vector3) => `${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)}`;
  const regOf = (m: Marker): Opening | undefined =>
    room.openings.find((o) => (m.kind === "door") === (o.kind === "door") && o.box.clone().expandByScalar(0.15).containsPoint(m.c));
  if (markers.length) {
    report.shellOpenings = markers.length;
    for (const m of markers) {
      const L = `${m.label} (${m.id})`;
      const reg = regOf(m);
      if (!reg) problems.push(`${L}: not an opening of the room (it is not drawn through it)`);
      const open = reg ? reg.open() : true;
      // a real room behind: rays from outside through the opening (clear of its bars) reach the room first
      const pts: THREE.Vector3[] = [];
      const side = m.t;
      if (m.shape === "round") {
        const r = m.r ?? m.hw;
        for (const [a, f] of [[0.6, 0.45], [2.2, 0.55], [3.9, 0.5], [5.2, 0.6]]) pts.push(m.c.clone().addScaledVector(side, Math.cos(a) * r * f).addScaledVector(up, Math.sin(a) * r * f));
      } else if (m.shape === "quad") {
        for (const f of [-0.37, -0.13, 0.11, 0.33]) pts.push(m.c.clone().addScaledVector(side, f * m.hw * 2));
      } else {
        const body = m.arch ? m.yt - m.hw - m.yb : m.yt - m.yb;
        for (const fu of [-0.37, -0.13, 0.13, 0.37]) for (const fy of [0.18, 0.54]) pts.push(new THREE.Vector3(m.c.x, m.yb + body * fy, m.c.z).addScaledVector(side, fu * m.hw * 2));
      }
      let toRoom = 0;
      let toShell = 0;
      let toNothing = 0;
      for (const p of pts) {
        const o = p.clone().addScaledVector(m.n, 0.6);
        const d = m.n.clone().negate();
        // (issue #25: as far as the room reaches, not 40 m: the cathedral's nave runs 77 m from its west door)
        const hits = grid.cast(o, d, reach, (t) => !t.glass);
        const h = hits[0];
        // (a ray may cross the room and leave by a window opposite, or meet the shell far across it: the room is there)
        const through = room.openings.some((op) => op !== reg && new THREE.Ray(o, d).intersectsBox(op.box));
        if (!h) {
          if (through) toRoom++;
          else toNothing++;
        } else if (h.tri.room || h.t > 0.6 + m.depth + 0.35) toRoom++;
        else toShell++;
      }
      if (m.kind === "door" && !open) notes.push(`${L}: shut now (its leaves); not looked through`);
      else if (toRoom === 0 && toShell >= pts.length * 0.6) problems.push(`${L}: the shell is closed there (a pane or a wall of the shell, no room behind it)`);
      else if (toRoom === 0 && toNothing) problems.push(`${L}: nothing behind it (the street's sky or its fog shows through)`);
      else if (toRoom < pts.length * 0.3) problems.push(`${L}: the room shows through only ${toRoom} of ${pts.length} rays`);
      // the room's lining meets the shell's reveal: from just behind the reveal's back, sideways and down, the room is near
      // (issue #10: or, for a room that draws its own reveal from the shell's face to its wall, a city house's single
      // faced walls, just in front of the reveal's back: its own reveal is there, no gap between the two)
      if (m.shape === "rect" || m.shape === "round") {
        const mid = m.shape === "round" ? m.c.y : (m.yb + Math.min(m.yt, m.arch ? m.yt - m.hw : m.yt)) / 2;
        const back = new THREE.Vector3(m.c.x, mid, m.c.z).addScaledVector(m.n, -(m.depth + 0.04));
        const front = m.depth > 0.06 ? new THREE.Vector3(m.c.x, mid, m.c.z).addScaledVector(m.n, -(m.depth - 0.04)) : null;
        const reachSide = (m.shape === "round" ? (m.r ?? m.hw) : m.hw) + 0.1;
        const dirs: Array<[THREE.Vector3, number, string]> = [
          [m.t.clone(), reachSide, "along"],
          [m.t.clone().negate(), reachSide, "along"],
          [up.clone().negate(), mid - (m.shape === "round" ? m.c.y - (m.r ?? m.hw) : m.yb) + 0.1, "down"],
        ];
        if (!(m.kind === "door")) for (const [d, far, what] of dirs) {
          const h = grid.cast(back, d, far, (t) => t.room && !t.glass)[0] ?? (front ? grid.cast(front, d, far, (t) => t.room && !t.glass)[0] : undefined);
          if (!h) {
            problems.push(`${L}: a gap between the shell's reveal and the room's wall (${what}, at ${fmt(back)}): the street shows there`);
            break;
          }
        }
      }
      // the room inside the shell round it: rays from outside a little off the opening meet the shell before the room
      if (m.shape !== "quad") {
        const rad = (m.shape === "round" ? (m.r ?? m.hw) : m.hw) + 0.35;
        const mid = m.shape === "round" ? m.c.y : (m.yb + m.yt) / 2;
        const hh = m.shape === "round" ? rad : (m.yt - m.yb) / 2 + 0.35;
        for (const [fu, fy] of [[-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]]) {
          // (a hair off round numbers: never exactly along the shell's own edges)
          const p = new THREE.Vector3(m.c.x, mid + fy * hh + 0.0137, m.c.z).addScaledVector(m.t, fu * rad + 0.0113);
          const o = p.clone().addScaledVector(m.n, 1.5);
          const d = m.n.clone().negate();
          const s = grid.cast(o, d, 4, (t) => !t.room)[0];
          const r = grid.cast(o, d, 4, (t) => t.room && !t.glass)[0];
          if (r && (!s || r.t < s.t - 0.005)) {
            // (a neighbouring opening's own hole there is fine)
            const inHole = markers.some((q) => q !== m && Math.hypot(q.c.x - p.x, q.c.z - p.z) < q.hw + 0.25 && p.y > q.yb - 0.2 && p.y < q.yt + 0.2);
            if (!inHole) problems.push(`${L}: the room stands out of the shell next to it (at ${fmt(p)}${s ? "" : ", no shell wall there"})`);
          }
        }
      }
    }
    // every door and window of the room has a hole in the shell
    for (const o of room.openings) {
      const hole = markers.some((m) => (m.kind === "door") === (o.kind === "door") && o.box.clone().expandByScalar(0.15).containsPoint(m.c));
      if (!hole) problems.push(`${o.label}: an opening of the room with no hole in the shell there`);
    }
  } else {
    // an older shell: its glass over the room is a pane of the shell, not a window of the room
    const panes = new Map<string, { n: number; c: THREE.Vector3 }>();
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (!mats.some((q) => /glass/i.test(q?.name ?? ""))) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
      if (!bb.intersectsBox(rb)) return;
      // the glass triangles inside the room's box, gathered by 1.5 m cells
      const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
      const idx = m.geometry.index;
      const groups = m.geometry.groups.length ? m.geometry.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
      for (const g of groups) {
        const mt = mats[g.materialIndex ?? 0];
        if (!/glass/i.test(mt?.name ?? "")) continue;
        for (let i = g.start; i + 2 < g.start + g.count; i += 3) {
          const c = new THREE.Vector3();
          for (let j = 0; j < 3; j++) c.add(new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(m.matrixWorld));
          c.multiplyScalar(1 / 3);
          if (!rb.containsPoint(c)) continue;
          if (room.openings.some((op) => op.kind === "window" && op.box.containsPoint(c))) continue;
          const key = `${Math.round(c.x / 1.5)},${Math.round(c.y / 1.5)},${Math.round(c.z / 1.5)}`;
          const e = panes.get(key);
          if (e) e.n++;
          else panes.set(key, { n: 1, c });
        }
      }
    });
    if (report.registered.windows > 0) problems.push(`its room has ${report.registered.windows} windows but the shell shows no opening markers (not loaded yet, or an older shell): run the check again`);
    if (panes.size) problems.push(`the shell has no opening markers; ${panes.size} places of its glass over the room are the shell's panes, not windows of the room (e.g. at ${[...panes.values()].slice(0, 3).map((p) => fmt(p.c)).join("; ")})`);
    else notes.push("the shell has no opening markers (an older shell): only its doors are known");
  }
  // (issue #10: with or without markers: a house's painted windows over its room are never real ones)
  for (const p of T.painted ?? []) problems.push(`${p.label}: a painted window over the room (lit at night), not a real one`);
  // walking: every walkable floor of the plan is reached on foot from its doors
  if (T.plan && !T.locked) {
    const miss = walkIslands(T.plan);
    for (const m of miss) problems.push(`not reached on foot: ${m}`);
  } else if (T.locked) notes.push("its doors stay shut: its rooms are seen, not walked");
  notes.push(`${shellTris} shell triangles and ${grid.tris.length - shellTris} of the room looked at`);
  return report;
}

/** Floors of a plan not reached from its doors (a flood on a 0.25 m grid, every storey and stair; a body of 0.3 m). */
function walkIslands(P: HallPlan): string[] {
  const cell = 0.25;
  const r = 0.3;
  const key = (i: number, j: number, y: number) => `${i},${j},${y.toFixed(2)}`;
  const seen = new Map<string, number>();
  const ok = (x: number, z: number, feet: number): { y: number; level: number } | null => {
    if (!HP.walkable(P, x, z, feet)) return null;
    const f = HP.footing(P, x, z, feet);
    if (!f) return null;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (!HP.walkable(P, x + Math.cos(a) * (r + 0.15), z + Math.sin(a) * (r + 0.15), f.y)) return null;
    }
    // (the people's way: a keeper goes behind his counter, a beadle through the clergy's gate)
    if (HP.hits(P, x, z, r, f.y, false)) return null;
    return f;
  };
  const q: Array<[number, number, number]> = [];
  for (const d of P.doors) {
    const x = d.x;
    const z = d.inner + d.dir * 0.8;
    const i = Math.round(x / cell);
    const j = Math.round(z / cell);
    const s = ok(i * cell, j * cell, P.levels[0].y + d.y);
    if (s && !seen.has(key(i, j, s.y))) {
      seen.set(key(i, j, s.y), s.level);
      q.push([i, j, s.y]);
    }
  }
  while (q.length) {
    const [i, j, y] = q.shift()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = ok((i + di) * cell, (j + dj) * cell, y);
      if (!n) continue;
      const k = key(i + di, j + dj, n.y);
      if (seen.has(k)) continue;
      seen.set(k, n.level);
      q.push([i + di, j + dj, n.y]);
    }
  }
  const reached = new Set<string>();
  for (const k of seen.keys()) {
    const [i, j, y] = k.split(",");
    reached.add(`${i},${j},${(+y).toFixed(1)}`);
  }
  const out: string[] = [];
  P.levels.forEach((Lv, li) => {
    let missed = 0;
    let first: [number, number] | null = null;
    let total = 0;
    for (const f of Lv.floors)
      for (let x = Math.ceil(f.minX / cell) * cell; x <= f.maxX; x += cell)
        for (let z = Math.ceil(f.minZ / cell) * cell; z <= f.maxZ; z += cell) {
          const s = ok(x, z, Lv.y);
          if (!s || s.level !== li) continue;
          total++;
          const i = Math.round(x / cell);
          const j = Math.round(z / cell);
          if (!reached.has(`${i},${j},${s.y.toFixed(1)}`)) {
            missed++;
            first ??= [x, z];
          }
        }
    if (missed > 3 && first) out.push(`storey ${li} (${Lv.y} m): ${missed} of ${total} free places, e.g. at ${first[0].toFixed(2)}, ${first[1].toFixed(2)} (the plan's frame)`);
  });
  return out;
}

/** The check's targets from the game's buildings: every room of world/inworld.ts, with its plan when it has one. */
export function targetsFrom(
  inWorld: InWorld,
  halls: Array<{ plan: HallPlan; doorOpen: boolean }>,
  houses: Array<{ id: string; plan: HallPlan & { windows?: Array<{ a: [number, number]; b: [number, number]; y0: number; y1: number; out: [number, number]; kind: string }> }; world(x: number, z: number): [number, number] }>,
  locked: string[] = [],
): CheckTarget[] {
  const NAMES: Record<string, string> = { prison: "the prison", prison_chapel: "the prison's chapel", prison_governor: "the prison governor's house", cathedral: "the cathedral" };
  return inWorld.all.map((room) => {
    const h = halls.find((q) => (q.plan.id as string) === room.id);
    const hs = houses.find((q) => q.id === room.id);
    const painted: CheckTarget["painted"] = [];
    if (hs?.plan.windows)
      for (const w of hs.plan.windows) {
        if (w.kind !== "glow") continue;
        const [ax, az] = hs.world(...w.a);
        const [bx, bz] = hs.world(...w.b);
        const [ox, oz] = hs.world((w.a[0] + w.b[0]) / 2 + w.out[0], (w.a[1] + w.b[1]) / 2 + w.out[1]);
        const c = new THREE.Vector3((ax + bx) / 2, hs.plan.floorY + (w.y0 + w.y1) / 2, (az + bz) / 2);
        painted.push({ label: `${room.id}, a window upstairs`, c, n: new THREE.Vector3(ox - c.x, 0, oz - c.z).normalize(), hw: Math.hypot(bx - ax, bz - az) / 2, hh: (w.y1 - w.y0) / 2 });
      }
    return { id: room.id, label: NAMES[room.id] ?? room.id, room, plan: h?.plan ?? hs?.plan, locked: locked.includes(room.id), painted };
  });
}
