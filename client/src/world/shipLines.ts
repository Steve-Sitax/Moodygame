import * as THREE from "three";
import { capMaterial, loadBoats, type BoatName, type Placement } from "./boats";
import { HULLS } from "../../../shared/smallBoats";
import { DOCK_Y, LW_MIN, levelAt, regionAt } from "./tide";

// The mooring lines of the boats that lie along the quay walls (D4, 2026-10-11; Steve: "make docks look way
// better", the look survey: "the big ships tied to the quay"). Every barge, lighter, tug and hengst moored in a row
// along a wall has a bow line and a stern line to bollards on the quay (the longer ones two springs as well); the
// boats of an outer row are tied to the boat inside them with breast lines. The quay ends are the eyes dropped over
// the bollards (quayfurniture.ts lays them, and the bollards, from the lines asked for here).
//
// The lines move with the tide (the boats rise and fall some 5 m on the river): each line has its length, set so it is
// just taut at the lowest spring ebb; at high water the same rope hangs slack in a curve, never into the water. Where
// a line comes up from a boat lying low it bears on the coping's nose and runs straight from there to the bollard.
// The Petit Bassin keeps one level, so its lines just hang a little slack.
//
// One mesh per 64 m chunk (tubes of the tarred hawser in the quay furniture's own atlas and material), a fixed number
// of points a line: when the water has moved more than a centimetre the positions are written again in place.
// Godot draws the same lines from the bake (the node "ship_lines" carries them in its extras):
// godot/src/Movers/ShipLines.cs does the same sums.

/** Points along a line (the tube's rings). Godot's port keeps the same numbers. */
export const LINE_PTS = 14;
/** Sides of the tube. */
export const LINE_SIDES = 6;

/** A boat lying along a wall, as the lines see her. */
export interface Hull {
  name: BoatName;
  x: number;
  z: number;
  yaw: number;
  /** Her waterline never goes below this (the mud + her draft), or -99. */
  floor: number;
  /** Her rail in her own frame (x across, y up from her waterline, z along, bow +z): the water cap's outline. */
  rail: Array<[number, number, number]>;
  minZ: number;
  maxZ: number;
}

/** One end of a line: fixed in the world (v = -1), or on boat v (y over her waterline). */
export interface End {
  x: number;
  y: number;
  z: number;
  v: number;
}

export interface Line {
  a: End;
  b: End;
  /** The rope's length (m). */
  len: number;
  /** Where it bears on the coping's nose (x, y, z), if it can. */
  edge: [number, number, number] | null;
}

/** The kinds that have their own moorings (the small boats: game/boatMoorings.ts) or no wall to lie at. */
const NOT_HERE = new Set<string>([...Object.keys(HULLS), "pontoon_section", "brig", "liner", "steamer", "barque", "barque_sail"]);

/**
 * The boats lying in rows along the quays, with their rails (from their water caps). Read once the rows are placed
 * (rijnkaai.ts places them as soon as boats.glb is in): waits for the boats and a moment more.
 */
export async function mooredHulls(scene: THREE.Scene): Promise<Hull[]> {
  const boats = await loadBoats();
  await new Promise((r) => setTimeout(r, 50));
  const rails = new Map<string, Array<[number, number, number]>>();
  // the rows are instanced: each kind's water cap is the InstancedMesh of that kind with the cap material, in the
  // boat's own frame (the cap is a child at the model's origin)
  scene.traverse((o) => {
    const m = o as THREE.InstancedMesh;
    if (!m.isInstancedMesh || m.material !== capMaterial || !/_moored$/.test(m.name)) return;
    const kind = m.name.replace(/_moored$/, "");
    if (rails.has(kind)) return;
    const P = m.geometry.getAttribute("position");
    const pts: Array<[number, number, number]> = [];
    for (let i = 0; i < P.count; i++) pts.push([P.getX(i), P.getY(i), P.getZ(i)]);
    rails.set(kind, pts);
  });
  const out: Hull[] = [];
  for (const p of boats.placements() as readonly Placement[]) {
    if (p.single || !p.world || NOT_HERE.has(p.name)) continue;
    const rail = rails.get(p.name);
    if (!rail || rail.length < 3) continue;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const q of rail) {
      minZ = Math.min(minZ, q[2]);
      maxZ = Math.max(maxZ, q[2]);
    }
    out.push({ name: p.name, x: p.x, z: p.z, yaw: p.yaw, floor: Number.isFinite(p.floor) ? p.floor : -99, rail, minZ, maxZ });
  }
  return out;
}

/** The rail on side `sx` (+1 her port, -1 starboard) at station z (her frame): x, y (over her waterline). */
export function railAt(h: Hull, sx: number, z: number): [number, number] {
  let best: [number, number] = [0, 1];
  let bd = Infinity;
  for (const [x, y, zz] of h.rail) {
    if (x * sx <= 0) continue;
    const d = Math.abs(zz - z) - Math.abs(x) * 0.01;
    if (d < bd) {
      bd = d;
      best = [x, y];
    }
  }
  return best;
}

/** Her frame to the world (x, z). */
export function hullToWorld(h: Hull, lx: number, lz: number): [number, number] {
  const c = Math.cos(h.yaw);
  const s = Math.sin(h.yaw);
  return [h.x + lx * c + lz * s, h.z - lx * s + lz * c];
}

/** The level a boat's waterline stands at now. */
export const hullY = (h: { x: number; z: number; floor: number }): number => Math.max(levelAt(h.x, h.z), h.floor);
/** The lowest it ever stands (springs' low water on the river, the dock's one level). */
export const hullLowY = (h: { x: number; z: number; floor: number }): number => Math.max(regionAt(h.x, h.z) === 1 ? DOCK_Y : LW_MIN, h.floor);

// ---------------------------------------------------------------- the shape of a line (Godot: ShipLines.cs, the same)

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpE = new THREE.Vector3();

/** A hanging rope from p to q, `len` long: LINE_PTS - k points into out from index i0 (q included). */
function hang(p: THREE.Vector3, q: THREE.Vector3, len: number, water: number, out: Float32Array, i0: number, n: number): void {
  const c = p.distanceTo(q);
  const slack = Math.max(0, len - c);
  // a parabola's length over its chord: c + 8 h^2 / (3 c)
  let h = Math.sqrt((3 * Math.max(c, 0.01) * slack) / 8);
  // never into the water
  for (let k = 1; k < n; k++) {
    const f = k / n;
    const room = (p.y + (q.y - p.y) * f - (water + 0.04)) / (4 * f * (1 - f));
    if (room < h) h = Math.max(0, room);
  }
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    const o = (i0 + k - 1) * 3;
    out[o] = p.x + (q.x - p.x) * f;
    out[o + 1] = p.y + (q.y - p.y) * f - h * 4 * f * (1 - f);
    out[o + 2] = p.z + (q.z - p.z) * f;
  }
}

/**
 * The points of a line now (LINE_PTS of them, from a to b), the ends at these heights. `water`: the level under it.
 * Bears on the coping's nose (edge) when the hanging rope would pass under it there.
 */
export function linePoints(l: Line, ay: number, by: number, water: number, out: Float32Array): void {
  const A = tmpA.set(l.a.x, ay, l.a.z);
  const B = tmpB.set(l.b.x, by, l.b.z);
  out[0] = A.x;
  out[1] = A.y;
  out[2] = A.z;
  const n = LINE_PTS - 1;
  if (l.edge) {
    // the rope's height over the nose if it hung free: the nose is where the plan crosses it (edge's place)
    const E = tmpE.set(l.edge[0], l.edge[1], l.edge[2]);
    const tot = Math.hypot(B.x - A.x, B.z - A.z) || 1;
    const te = Math.hypot(E.x - A.x, E.z - A.z) / tot;
    const c = A.distanceTo(B);
    const slack = Math.max(0, l.len - c);
    const h = Math.sqrt((3 * Math.max(c, 0.01) * slack) / 8);
    const yFree = A.y + (B.y - A.y) * te - h * 4 * te * (1 - te);
    if (yFree < E.y) {
      // over the nose: straight from the eye to the nose (2 points), hanging from there to the boat
      out[3] = E.x;
      out[4] = E.y;
      out[5] = E.z;
      hang(E, B, l.len - A.distanceTo(E), water, out, 2, n - 1);
      return;
    }
  }
  hang(A, B, l.len, water, out, 1, n);
}

// ---------------------------------------------------------------- the drawing

export interface ShipLinesData {
  /** The boats the lines are tied to: x, z, floor. */
  vessels: Array<[number, number, number]>;
  lines: Line[];
}

export interface ShipLines {
  group: THREE.Group;
  /** Once a frame: writes the lines again when the water has moved; `cam` hides the chunks beyond the fog. */
  update(cam?: THREE.Camera, far?: number): void;
  info(): { lines: number; chunks: number; triangles: number; rebuilds: number };
}

/**
 * The lines drawn as tubes in `mat` (the quay furniture's solid material), the hawser's cell `uv` (u0, v0, u1, v1).
 * `r`: the rope's radius.
 */
export function drawShipLines(data: ShipLinesData, mat: THREE.Material, uv: [number, number, number, number], r: number): ShipLines {
  const group = new THREE.Group();
  group.name = "ship_lines";
  const CH = 64;
  const byChunk = new Map<string, number[]>();
  data.lines.forEach((l, i) => {
    const k = `${Math.floor(l.a.x / CH)},${Math.floor(l.a.z / CH)}`;
    let a = byChunk.get(k);
    if (!a) byChunk.set(k, (a = []));
    a.push(i);
  });
  // (Godot: the lines, their boats and the cell in the extras)
  group.userData.shipLines = {
    pts: LINE_PTS,
    sides: LINE_SIDES,
    r,
    uv,
    vessels: data.vessels.map((v) => v.map((q) => Math.round(q * 1000) / 1000)),
    lines: data.lines.map((l) => [l.a.x, l.a.y, l.a.z, l.a.v, l.b.x, l.b.y, l.b.z, l.b.v, l.len, ...(l.edge ?? [NaN, NaN, NaN])].map((q) => (Number.isFinite(q) ? Math.round(q * 1000) / 1000 : null))),
  };
  const RING = LINE_SIDES + 1; // (the seam's vertex twice, so the cell's u runs 0..1 once round)
  const per = LINE_PTS * RING;
  const chunks: Array<{ mesh: THREE.Mesh; idx: number[]; pos: THREE.BufferAttribute; nor: THREE.BufferAttribute }> = [];
  for (const [k, idx] of byChunk) {
    const g = new THREE.BufferGeometry();
    const nv = idx.length * per;
    const pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    const nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    const uvs = new Float32Array(nv * 2);
    const col = new Float32Array(nv * 3).fill(0.9);
    const index: number[] = [];
    for (let li = 0; li < idx.length; li++) {
      const base = li * per;
      for (let p = 0; p < LINE_PTS; p++)
        for (let s = 0; s < RING; s++) {
          const vi = base + p * RING + s;
          uvs[vi * 2] = uv[0] + ((uv[2] - uv[0]) * s) / LINE_SIDES;
          uvs[vi * 2 + 1] = uv[1] + (uv[3] - uv[1]) * (p % 2);
        }
      for (let p = 0; p < LINE_PTS - 1; p++)
        for (let s = 0; s < LINE_SIDES; s++) {
          const s1 = s + 1;
          const a = base + p * RING + s;
          const b = base + p * RING + s1;
          const c = base + (p + 1) * RING + s1;
          const d = base + (p + 1) * RING + s;
          index.push(a, b, c, a, c, d);
        }
    }
    g.setAttribute("position", pos);
    g.setAttribute("normal", nor);
    g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setIndex(index);
    pos.setUsage(THREE.DynamicDrawUsage);
    nor.setUsage(THREE.DynamicDrawUsage);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `ship_lines_${k}`;
    mesh.userData.lines = idx;
    group.add(mesh);
    chunks.push({ mesh, idx, pos, nor });
  }

  const pts = new Float32Array(LINE_PTS * 3);
  const last = new Float32Array(data.vessels.length).fill(NaN);
  const now = new Float32Array(data.vessels.length);
  const t = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  const n2 = new THREE.Vector3();
  const up = new THREE.Vector3();
  let rebuilds = 0;
  const yOf = (e: End) => (e.v < 0 ? e.y : now[e.v] + e.y);
  const write = (force: boolean) => {
    let moved = force;
    data.vessels.forEach(([x, z, floor], i) => {
      now[i] = hullY({ x, z, floor });
      if (!(Math.abs(now[i] - last[i]) < 0.01)) moved = true;
    });
    if (!moved) return;
    last.set(now);
    rebuilds++;
    for (const c of chunks) {
      const P = c.pos.array as Float32Array;
      const N = c.nor.array as Float32Array;
      c.idx.forEach((li, j) => {
        const l = data.lines[li];
        const vv = l.b.v >= 0 ? l.b.v : l.a.v;
        const water = vv >= 0 ? levelAt(data.vessels[vv][0], data.vessels[vv][1]) : -9;
        linePoints(l, yOf(l.a), yOf(l.b), water, pts);
        const base = j * per;
        for (let p = 0; p < LINE_PTS; p++) {
          const p0 = Math.max(0, p - 1);
          const p1 = Math.min(LINE_PTS - 1, p + 1);
          t.set(pts[p1 * 3] - pts[p0 * 3], pts[p1 * 3 + 1] - pts[p0 * 3 + 1], pts[p1 * 3 + 2] - pts[p0 * 3 + 2]).normalize();
          up.set(0, 1, 0);
          if (Math.abs(t.y) > 0.95) up.set(1, 0, 0);
          n1.crossVectors(t, up).normalize();
          n2.crossVectors(n1, t).normalize();
          for (let s = 0; s < RING; s++) {
            const a = (2 * Math.PI * s) / LINE_SIDES;
            const cx = Math.cos(a);
            const sx = Math.sin(a);
            const nx = n1.x * cx + n2.x * sx;
            const ny = n1.y * cx + n2.y * sx;
            const nz = n1.z * cx + n2.z * sx;
            const o = (base + p * RING + s) * 3;
            P[o] = pts[p * 3] + nx * r;
            P[o + 1] = pts[p * 3 + 1] + ny * r;
            P[o + 2] = pts[p * 3 + 2] + nz * r;
            N[o] = nx;
            N[o + 1] = ny;
            N[o + 2] = nz;
          }
        }
      });
      c.pos.needsUpdate = true;
      c.nor.needsUpdate = true;
      if (!c.mesh.geometry.boundingSphere) {
        c.mesh.geometry.computeBoundingSphere();
        // the tide lifts them some 5 m: room for that round the chunk
        c.mesh.geometry.boundingSphere!.radius += 5;
      }
    }
  };
  write(true);
  return {
    group,
    update(cam, far = 70) {
      write(false);
      if (cam)
        for (const c of chunks) {
          const s = c.mesh.geometry.boundingSphere!;
          c.mesh.visible = s.center.distanceTo(cam.position) - s.radius < far;
        }
    },
    info: () => ({ lines: data.lines.length, chunks: chunks.length, triangles: data.lines.length * (LINE_PTS - 1) * LINE_SIDES * 2, rebuilds }),
  };
}
