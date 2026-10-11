import * as THREE from "three";
import { CANAL_BED, CHAMBER, levelAt, regionAt, water } from "../world/tide";
import { WATER_Y } from "../world/rijnkaai";
import { floorOf } from "../game/boatMoorings";
import { HULLS, MOORINGS, isSmallKind, type SmallKind } from "../../../shared/smallBoats";

// W1 (docs/plans/next-update.md, section 4): the boat-water check. Every vessel in the scene (the still
// ships, the moored rows, the small boats, the river traffic, the anchorage and its tows, the lock's boats,
// the liner, the ferry and the landing stage) at the tide levels below, each held (t.tide) and run with
// the test steps (t.step) for `seconds` of game time, so the moving boats move. Per hull, measured on the
// drawn geometry (world vertices of the meshes, not the game's own numbers):
//   - the keel against the mud the tide lays bare (the drawn tide_mud mesh: the canal and vliet beds and
//     the bank at the foot of every river wall): "in the mud" when any part of her bottom is under it;
//   - her waterline against the water's level where she lies (levelAt: the river, the dock, the sloping
//     lock chamber), within 5 cm, mean over the run (the heave averages out): "under water" when lower,
//     "in the air" when higher with nothing under her keel to hold her up;
//   - her water cap (the invisible lid that keeps the river out of an open hull) drawn, on her rail, and
//     the rail above the water;
// plus probes for the faults the plan lists in 1.2 that are not a hull's height (the ladder climb, a
// drifted boat's floor, the chamber's slope for instanced boats, the cranes' loads, heights fixed at
// build time, the bed mesh against CANAL_BED, the moving ships' clearance). `problems` must be empty.
//
// Dev: `await __scheldemist.boatWater()` or `await __scheldemist.t.boatWater({ levels: [-5.2], seconds: 20 })`.
// It holds the tide while it runs and lets it go (back to the clock or the old hold) at the end.

/** The levels (m, quay top 0): spring low, mean low, the brig's floor, half tide, mean high, spring high, the storm's top. */
export const BOAT_WATER_LEVELS: Array<{ y: number; name: string; storm?: boolean }> = [
  { y: -5.2, name: "spring low water" },
  { y: -4.95, name: "mean low water" },
  { y: -4.4, name: "the brig's floor" },
  { y: -2.8, name: "half tide" },
  { y: -0.65, name: "mean high water" },
  { y: -0.4, name: "spring high water" },
  { y: -0.5, name: "the great storm's top (storm sea)", storm: true },
];

const AFLOAT = 0.05; // waterline within this of the level
const MUD = 0.06; // a bottom deeper than this under the mud is in it
const HOLD = 0.06; // a keel this close over the mud rests on it
const CELL = 0.25; // the mud grid
const STORM_SEA = 3.6 + 2.6; // world/rijnkaai.ts: the sea at the great storm's height

export interface BoatWaterOptions {
  /** Levels to test (default BOAT_WATER_LEVELS). */
  levels?: number[];
  /** Game seconds to run at each level (default 60). */
  seconds?: number;
  /** Seconds between samples (default 0.5). */
  sample?: number;
  /** Start a tug through the lock first, so the chamber has a boat in it (default true). */
  lockBoat?: boolean;
  /** Run the probes (default true). */
  probes?: boolean;
}

interface Vessel {
  key: string;
  name: string;
  kind: string;
  source: "still" | "moored" | "small" | "river" | "anchorage" | "lock" | "bridge" | "rowing" | "ferry" | "stage" | "other";
  moving: boolean;
  x: number;
  z: number;
  /** Waterline now (world y), and the meshes of her hull now in world space. */
  y: number;
  hull: Array<{ geo: THREE.BufferGeometry; m: THREE.Matrix4 }>;
  caps: Array<{ geo: THREE.BufferGeometry; m: THREE.Matrix4 }>;
  /** Her own floor, if her owner gave her one (the brig, a lying small boat). */
  floor?: number;
}

interface Stat {
  v: Vessel;
  n: number;
  sum: number;
  min: number;
  max: number;
  region: number;
  level: number;
  pen: number;
  clear: number;
  over: "toe" | "bed" | "";
  keel: number;
  mudY: number;
  railLow: number;
  /** Where she was when her bottom went deepest into the mud (a moving hull moves on). */
  worst: { name: string; x: number; z: number; y: number; level: number; region: number } | null;
}

type Host = {
  world: {
    scene: THREE.Scene;
    boats(): {
      placements(): ReadonlyArray<{ name: string; x: number; z: number; yaw: number; floor: number; y: () => number; single: boolean; obj?: THREE.Object3D; world?: THREE.Matrix4 }>;
      fleetOf(scene: THREE.Object3D, list: Array<{ name: string; x: number; z: number; yaw: number; floor: number }>): { hide(i: number, h: boolean): void; world(i: number): THREE.Matrix4 };
      update(t: number, dt: number, lit?: number): void;
      deck(name: string, x: number, z: number, yaw: number): { y: number } | null;
      extra(name: string, key: string): unknown;
      dims(name: string): { length: number; beam: number; height: number };
    } | null;
    lock(): { passNow(dir?: "in" | "out", names?: string[]): void; traffic?(): { state: string } } | null;
    railway(): { info(): Record<string, unknown> } | null;
    baseAt(x: number, z: number): number;
    boatFree(x: number, z: number, r: number): boolean;
    tideDev: { read(): string; hold(v: "high" | "low" | number | null): void; target(): number };
  };
  rowing: Record<string, unknown> & { boatCheck(): { problems: string[] } };
  player: { x: number; z: number; climbTo: (keys: Array<[number, number, number, number]>, then?: () => void) => void };
  psxUniforms?: { uSea: { value: number } };
  step(s: number): void;
  t: { tide(v: number | "high" | "low" | null): unknown };
};

const host = (): Host => (window as unknown as { __scheldemist: Host }).__scheldemist;
const r2 = (v: number) => Math.round(v * 100) / 100;
const yieldNow = () => new Promise<void>((res) => {
  // (not throttled in a hidden tab, unlike setTimeout)
  const ch = new MessageChannel();
  ch.port1.onmessage = () => res();
  ch.port2.postMessage(0);
});

// ---- the mud: the drawn tide_mud mesh, rasterised once into 25 cm cells (the highest mud in each, and
// whether that is the canal's bed or the bank at a wall's foot)
type MudGrid = { get(x: number, z: number): { y: number; bed: boolean } | null; bedRange: [number, number]; canal(x: number, z: number): boolean };
const mudKey = (i: number, j: number) => (i + 8192) * 16384 + (j + 8192);
/** The beds world/rijnkaai.ts gives world/tidemud.ts (built last, in 4 m cells: the mesh's last triangles). */
const BEDS = [
  { minX: -82, maxX: -70, minZ: 0.5, maxZ: 205 },
  { minX: -150, maxX: -142, minZ: 0.5, maxZ: 72 },
];
function mudGrid(scene: THREE.Scene): MudGrid | null {
  const mesh = scene.getObjectByName("tide_mud") as THREE.Mesh | undefined;
  if (!mesh?.isMesh) return null;
  mesh.updateMatrixWorld(true);
  const pos = mesh.geometry.getAttribute("position");
  const cells = new Map<number, number>();
  const bedCell = new Set<number>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const idx = mesh.geometry.index;
  const n = idx ? idx.count : pos.count;
  const at = (k: number) => (idx ? idx.getX(k) : k);
  // (D1: the mesh says where its beds start, world/tidemud.ts userData.bedFrom; else the old 4 m cells at its end)
  const bedFrom = (mesh.userData.bedFrom as number | undefined) ?? n - 6 * BEDS.reduce((s, r) => s + Math.ceil((r.maxX - r.minX) / 4) * Math.ceil((r.maxZ - r.minZ) / 4), 0);
  for (let t = 0; t + 2 < n; t += 3) {
    a.fromBufferAttribute(pos, at(t)).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(pos, at(t + 1)).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(pos, at(t + 2)).applyMatrix4(mesh.matrixWorld);
    const bed = t >= bedFrom;
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-9) continue;
    const i0 = Math.floor(Math.min(a.x, b.x, c.x) / CELL);
    const i1 = Math.floor(Math.max(a.x, b.x, c.x) / CELL);
    const j0 = Math.floor(Math.min(a.z, b.z, c.z) / CELL);
    const j1 = Math.floor(Math.max(a.z, b.z, c.z) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const px = (i + 0.5) * CELL;
        const pz = (j + 0.5) * CELL;
        const l1 = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d;
        const l2 = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
        const y = l1 * a.y + l2 * b.y + l3 * c.y;
        const k = mudKey(i, j);
        const o = cells.get(k);
        if (o === undefined || y > o) {
          cells.set(k, y);
          if (bed) bedCell.add(k);
          else bedCell.delete(k);
        }
      }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of bedCell) {
    const y = cells.get(k)!;
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  return {
    get(x, z) {
      const k = mudKey(Math.floor(x / CELL), Math.floor(z / CELL));
      const y = cells.get(k);
      return y === undefined ? null : { y, bed: bedCell.has(k) };
    },
    bedRange: [lo, hi],
    canal: (x, z) => BEDS.some((r) => x > r.minX - 1 && x < r.maxX + 1 && z > r.minZ - 1 && z < r.maxZ + 1),
  };
}

// ---- the vessels drawn now
const SOURCES: Record<string, Vessel["source"]> = {
  river_traffic: "river",
  anchorage: "anchorage",
  lock: "lock",
  opening_bridges: "bridge",
};
function inScene(o: THREE.Object3D, scene: THREE.Scene): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (!p.visible) return false;
    if (p === scene) return true;
  }
  return false;
}
function sourceOf(o: THREE.Object3D): Vessel["source"] {
  for (let p = o.parent; p; p = p.parent) {
    const s = SOURCES[p.name];
    if (s) return s;
    if (p.name.startsWith("anchorage")) return "anchorage";
  }
  return "still";
}
const isCap = (m: THREE.Mesh) => {
  const mat = m.material as THREE.Material | THREE.Material[];
  return !Array.isArray(mat) && mat.name === "cap";
};
function meshesOf(root: THREE.Object3D): { hull: Vessel["hull"]; caps: Vessel["caps"] } {
  const hull: Vessel["hull"] = [];
  const caps: Vessel["caps"] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    for (let p: THREE.Object3D | null = m; p && p !== root.parent; p = p.parent) if (!p.visible && !isCap(m)) return;
    if (isCap(m)) caps.push({ geo: m.geometry, m: m.matrixWorld });
    else hull.push({ geo: m.geometry, m: m.matrixWorld });
  });
  return { hull, caps };
}

function vessels(h: Host, skip: Set<THREE.Object3D>): Vessel[] {
  const scene = h.world.scene;
  const bs = h.world.boats();
  const out: Vessel[] = [];
  const v = new THREE.Vector3();
  // single copies: place()d by the rows' builder, the river, the anchorage, the lock, the rowing boats
  for (const p of bs?.placements() ?? []) {
    if (!p.obj || skip.has(p.obj) || !inScene(p.obj, scene) || p.name === "portal_crane" || p.name === "hand_crane") continue;
    const o = p.obj;
    o.getWorldPosition(v);
    let source = sourceOf(o);
    if (source === "still" && isSmallKind(p.name)) source = "rowing";
    const { hull, caps } = meshesOf(o);
    out.push({ key: o.uuid, name: `${p.name} at (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`, kind: p.name, source, moving: ["river", "anchorage", "lock", "bridge"].includes(source), x: v.x, z: v.z, y: v.y, hull, caps, floor: o.userData.floor as number | undefined });
  }
  // the instanced fleets: the moored rows and the small boats at their moorings (one InstancedMesh per part)
  const fleets = new Map<string, THREE.InstancedMesh[]>();
  scene.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh || !/_(moored|small)$/.test(im.name) || !inScene(im, scene)) return;
    const k = `${im.parent?.uuid}:${im.name}:${im.count}`;
    let l = fleets.get(k);
    if (!l) fleets.set(k, (l = []));
    l.push(im);
  });
  const mi = new THREE.Matrix4();
  for (const [k, ims] of fleets) {
    const name = ims[0].name;
    const small = name.endsWith("_small");
    const kind = name.replace(/_(moored|small)$/, "");
    const lead = ims.find((im) => !isCap(im)) ?? ims[0];
    for (let i = 0; i < lead.count; i++) {
      lead.getMatrixAt(i, mi);
      if (Math.abs(mi.determinant()) < 1e-9) continue; // hidden: taken from her mooring
      const frame = new THREE.Matrix4().multiplyMatrices(lead.matrixWorld, mi);
      const hull: Vessel["hull"] = [];
      const caps: Vessel["caps"] = [];
      for (const im of ims) {
        const m = new THREE.Matrix4();
        im.getMatrixAt(i, m);
        m.premultiply(im.matrixWorld);
        (isCap(im) ? caps : hull).push({ geo: im.geometry, m });
      }
      const x = frame.elements[12];
      const z = frame.elements[14];
      out.push({ key: `${k}:${i}`, name: `${kind} ${small ? "at her mooring" : "moored"} at (${x.toFixed(1)}, ${z.toFixed(1)})`, kind, source: small ? "small" : "moored", moving: false, x, z, y: frame.elements[13], hull, caps });
    }
  }
  // the ferry (the arrival) and the Werf landing stage: ferry.glb, their own owners
  for (const [nm, source] of [["arrival_ferry", "ferry"], ["landing_stage", "stage"]] as const) {
    const o = scene.getObjectByName(nm);
    if (!o || !inScene(o, scene)) continue;
    o.getWorldPosition(v);
    const { hull, caps } = meshesOf(o);
    out.push({ key: o.uuid, name: `${nm.replace("arrival_", "")} at (${v.x.toFixed(1)}, ${v.z.toFixed(1)})`, kind: nm === "arrival_ferry" ? "ferry" : "landing_stage", source, moving: false, x: v.x, z: v.z, y: v.y, hull, caps });
  }
  return out;
}

// ---- her bottom against the mud, her rail against the water
const dedupe = new WeakMap<THREE.BufferGeometry, Float32Array>();
function pointsOf(g: THREE.BufferGeometry): Float32Array {
  let p = dedupe.get(g);
  if (p) return p;
  const pos = g.getAttribute("position");
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(z * 10)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x, y, z);
  }
  dedupe.set(g, (p = new Float32Array(out)));
  return p;
}
function measure(v: Vessel, mud: MudGrid | null): { pen: number; clear: number; over: Stat["over"]; keel: number; mudY: number; railLow: number } {
  let pen = -Infinity;
  let clear = Infinity;
  let over: Stat["over"] = "";
  let keel = Infinity;
  let mudY = NaN;
  const p = new THREE.Vector3();
  for (const { geo, m } of v.hull) {
    const pts = pointsOf(geo);
    for (let i = 0; i < pts.length; i += 3) {
      p.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m);
      if (p.y > v.y + 0.1) continue; // above her waterline: no mud reaches it
      keel = Math.min(keel, p.y);
      if (!mud) continue;
      const g = mud.get(p.x, p.z);
      if (!g) continue;
      const d = g.y - p.y;
      if (d > pen) {
        pen = d;
        over = g.bed ? "bed" : "toe";
        mudY = g.y;
      }
      clear = Math.min(clear, -d);
    }
  }
  let railLow = Infinity;
  for (const { geo, m } of v.caps) {
    const pts = pointsOf(geo);
    for (let i = 0; i < pts.length; i += 3) railLow = Math.min(railLow, p.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m).y);
  }
  return { pen, clear, over, keel, mudY, railLow };
}

/**
 * The cap against her rail, once a kind: the lid is cut on her inner rail line, so each corner of it should
 * sit on a point of her hull (within a hand); a lid well above the hull hides the water behind her, one
 * well below lets the river show between it and the rail.
 */
function capOnRail(v: Vessel): string | null {
  if (!v.caps.length) return null;
  const p = new THREE.Vector3();
  const hull: number[] = [];
  for (const { geo, m } of v.hull) {
    const pts = pointsOf(geo);
    for (let i = 0; i < pts.length; i += 3) {
      p.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m);
      hull.push(p.x, p.y, p.z);
    }
  }
  const ds: number[] = [];
  const dys: number[] = [];
  for (const { geo, m } of v.caps) {
    const pts = pointsOf(geo);
    for (let i = 0; i < pts.length; i += 3) {
      p.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(m);
      let best = Infinity;
      let dy = 0;
      for (let k = 0; k < hull.length; k += 3) {
        const d = (hull[k] - p.x) ** 2 + (hull[k + 1] - p.y) ** 2 + (hull[k + 2] - p.z) ** 2;
        if (d < best) {
          best = d;
          dy = p.y - hull[k + 1];
        }
      }
      ds.push(Math.sqrt(best));
      dys.push(dy);
    }
  }
  if (!ds.length) return null;
  const order = ds.map((_, i) => i).sort((a, b) => ds[a] - ds[b]);
  const mid = order[Math.floor(order.length / 2)];
  const far = ds.filter((d) => d > 0.25).length;
  if (ds[mid] > 0.25) return `her cap's corners lie ${ds[mid].toFixed(2)} m (median) from her hull, ${dys[mid] > 0 ? `${dys[mid].toFixed(2)} m above` : `${(-dys[mid]).toFixed(2)} m below`} the nearest point of it (${far} of ${ds.length} corners off her rail)`;
  return null;
}

export interface BoatWaterLevel {
  level: number;
  name: string;
  hulls: number;
  afloat: number;
  aground: number;
  moving: number;
  problems: string[];
}

export interface BoatWaterReport {
  levels: BoatWaterLevel[];
  probes: Array<{ case: number; what: string; problems: string[]; notes: string[] }>;
  noCap: string[];
  capRail: string[];
  smallBoats: string[];
  bedMesh: [number, number] | null;
  problems: string[];
  cases: Record<string, number>;
  seconds: number;
  ms: number;
  notCovered: string[];
}

/**
 * Which case of the plan's list (1.2) a hull's finding is; 0 for a new one (`hint` says what it is).
 * 1 the moored rows and the wall lighter in the bank's mud; 3 a drifted boat; 4 the lock chamber's slope;
 * 7 the canal and vliet mud against CANAL_BED; 10 the moving ships.
 */
function caseOf(v: Vessel, s: Stat): { c: number; hint: string } {
  const w = s.worst;
  if (v.moving) {
    if (w && s.pen > MUD && w.x > 98 && w.x < 122 && w.z > -8 && w.z < 46) return { c: 10, hint: " (in the lock: world/tidemud.ts draws the river walls' mud banks inside the lock channel and chamber too)" };
    if (w && s.pen > MUD && s.over === "toe" && Math.abs(w.z) < 8) return { c: 1, hint: " (a tow walked in against the wall: anchorage.ts)" };
    if (s.region === 2) return { c: 4, hint: "" };
    return { c: 10, hint: "" };
  }
  if (s.region === 2) return { c: 4, hint: "" };
  if (s.v.floor !== undefined && Number.isFinite(s.v.floor) && v.source === "still") return { c: 0, hint: ` (new: her own floor ${s.v.floor.toFixed(2)} has no drawn bed under it)` };
  if (s.over && mudCanal(v)) return { c: 7, hint: "" };
  if (v.source === "small" || v.source === "rowing") return { c: 0, hint: " (new: her floor, boatMoorings mudAt's straight slope and HULLS' draft, against the drawn bank and her drawn keel)" };
  if (s.over === "toe") return { c: 1, hint: "" };
  return { c: 0, hint: "" };
}
let mudCanal: (v: Vessel) => boolean = () => false;

export async function boatWaterCheck(opts: BoatWaterOptions = {}): Promise<BoatWaterReport> {
  const t0 = performance.now();
  const h = host();
  const bs = h.world.boats();
  if (!bs) throw new Error("the boats are not in yet");
  const seconds = opts.seconds ?? 60;
  const sample = opts.sample ?? 0.5;
  const levels = (opts.levels ?? BOAT_WATER_LEVELS.map((l) => l.y)).map((y) => BOAT_WATER_LEVELS.find((l) => Math.abs(l.y - y) < 1e-6) ?? { y, name: `${y} m` });
  const scene = h.world.scene;
  const mud = mudGrid(scene);
  mudCanal = (v) => !!mud?.canal(v.x, v.z);
  const report: BoatWaterReport = { levels: [], probes: [], noCap: [], capRail: [], smallBoats: [], bedMesh: mud ? [r2(mud.bedRange[0]), r2(mud.bedRange[1])] : null, problems: [], cases: {}, seconds, ms: 0, notCovered: [] };
  if (!mud) report.problems.push("no tide_mud mesh in the scene: the keels are not checked against the mud");
  const tag = (c: number, p: string) => {
    report.cases[c] = (report.cases[c] ?? 0) + 1;
    return c ? `[case ${c}] ${p}` : p;
  };
  const oldHold = (() => {
    const r = h.world.tideDev.read();
    const m = /held at ([+-][\d.]+) m/.exec(r);
    return m ? Number(m[1]) : /held at high/.test(r) ? "high" : /held at low/.test(r) ? "low" : null;
  })();
  const seaWas = h.psxUniforms?.uSea.value;
  const probeObjs = new Set<THREE.Object3D>();
  try {
    if (opts.lockBoat ?? true) {
      try {
        if (h.world.lock()?.traffic?.().state === "idle") h.world.lock()?.passNow("in", ["tug"]);
      } catch {
        /* the lock is busy */
      }
    }
    const capsSeen = new Set<string>();
    let smallDone = false;
    for (const L of levels) {
      h.t.tide(L.y);
      const stats = new Map<string, Stat>();
      const lvl: BoatWaterLevel = { level: L.y, name: L.name, hulls: 0, afloat: 0, aground: 0, moving: 0, problems: [] };
      const look = (geometry: boolean) => {
        for (const v of vessels(h, probeObjs)) {
          const level = levelAt(v.x, v.z);
          let s = stats.get(v.key);
          if (!s) stats.set(v.key, (s = { v, n: 0, sum: 0, min: Infinity, max: -Infinity, region: regionAt(v.x, v.z), level, pen: -Infinity, clear: Infinity, over: "", keel: NaN, mudY: NaN, railLow: Infinity, worst: null }));
          s.v = v;
          const dy = v.y - level;
          s.n++;
          s.sum += dy;
          s.min = Math.min(s.min, dy);
          s.max = Math.max(s.max, dy);
          s.level = level;
          if (geometry || v.moving) {
            const m = measure(v, mud);
            if (m.pen > s.pen) Object.assign(s, { pen: m.pen, over: m.over, keel: m.keel, mudY: m.mudY, worst: { name: v.name, x: v.x, z: v.z, y: v.y, level, region: regionAt(v.x, v.z) } });
            if (Number.isNaN(s.keel)) s.keel = m.keel;
            s.clear = Math.min(s.clear, m.clear);
            s.railLow = Math.min(s.railLow, m.railLow - level);
          }
          if (!capsSeen.has(v.kind) && v.hull.length) {
            capsSeen.add(v.kind);
            if (!v.caps.length && v.kind !== "landing_stage" && v.kind !== "pontoon_section") report.noCap.push(`${v.kind} (${v.source}): no water cap drawn: the river shows inside her`);
            const rail = capOnRail(v);
            if (rail) report.capRail.push(`${v.kind} (${v.source}): ${rail}`);
          }
        }
      };
      const storm = !!(L as { storm?: boolean }).storm;
      let ran = 0;
      let nextGeo = 0;
      while (ran < seconds - 1e-6) {
        if (h.psxUniforms) h.psxUniforms.uSea.value = storm ? STORM_SEA : seaWas ?? h.psxUniforms.uSea.value;
        const dt = Math.min(sample, seconds - ran);
        h.step(dt);
        ran += dt;
        const geo = ran >= nextGeo || ran >= seconds - 1e-6;
        if (geo) nextGeo += 10;
        look(geo);
        await yieldNow();
      }
      for (const s of stats.values()) {
        const v = s.v;
        lvl.hulls++;
        if (v.moving) lvl.moving++;
        const mean = s.sum / Math.max(1, s.n);
        const rests = s.pen > -HOLD && s.pen !== -Infinity;
        if (rests) lvl.aground++;
        else lvl.afloat++;
        const where = `${v.name}${v.moving ? ` (${v.source}, moving)` : v.source === "still" || v.source === "moored" || v.source === "small" ? "" : ` (${v.source})`}`;
        const k = caseOf(v, s);
        const say = (p: string) => lvl.problems.push(tag(k.c, p + k.hint));
        const w = s.worst;
        if (s.pen > MUD && w) say(`${v.moving ? w.name : where}${v.moving ? ` (${v.source}, moving)` : ""}: her bottom is ${s.pen.toFixed(2)} m in the ${s.over === "bed" ? "canal bed's" : "wall's bank of"} mud (her waterline ${r2(w.y)}, the water ${r2(w.level)}, the mud ${r2(s.mudY)})`);
        else if (mean > AFLOAT && !rests) say(`${where}: she floats ${mean.toFixed(2)} m over the water (waterline ${r2(s.level + mean)}, the water ${r2(s.level)}) with nothing under her keel to hold her up${Number.isFinite(s.clear) ? ` (the mud is ${s.clear.toFixed(2)} m under her)` : ""}`);
        if (mean < -AFLOAT) say(`${where}: she lies ${(-mean).toFixed(2)} m under the water (waterline ${r2(s.level + mean)}, the water ${r2(s.level)})`);
        if (v.caps.length && s.railLow < -0.1 && s.pen <= MUD) lvl.problems.push(tag(storm ? 0 : k.c, `${where}: her rail goes ${(-s.railLow).toFixed(2)} m under the water${storm ? " (new: in the storm's sea her heave and roll put it under)" : k.hint}`));
      }
      if (opts.probes ?? true) probesAt(h, L.y, report, tag, stats, mud);
      report.levels.push(lvl);
      // (the small boats' own check, once, in a calm sea: it looks at one moment, the heave in it)
      if (!smallDone && !storm) {
        smallDone = true;
        report.smallBoats = h.rowing.boatCheck().problems.map((p) => `small boats (rowing.boatCheck, at ${L.y.toFixed(2)}): ${p}`);
      }
    }
    // (the chamber's slope is steepest with the river far from the dock: at the lowest level tested)
    if (h.psxUniforms && seaWas !== undefined) h.psxUniforms.uSea.value = seaWas;
    if (opts.probes ?? true) {
      h.t.tide(Math.min(...levels.map((l) => l.y)));
      await chamberProbe(h, report, tag, probeObjs);
    }
    if (opts.probes ?? true) driftProbe(h, report, tag, mud);
  } finally {
    h.world.tideDev.hold(oldHold as "high" | "low" | number | null);
    if (h.psxUniforms && seaWas !== undefined) h.psxUniforms.uSea.value = seaWas;
    h.step(0.1);
  }
  // the bed under the canal boats: one number in the game (CANAL_BED), a drawn mesh that is not flat
  if (mud && Number.isFinite(mud.bedRange[0])) {
    const [lo, hi] = mud.bedRange;
    const probe = { case: 7, what: "the canal and vliet bed mesh against CANAL_BED (the boats' floor)", problems: [] as string[], notes: [`the drawn bed lies from ${lo.toFixed(2)} to ${hi.toFixed(2)}; CANAL_BED is ${CANAL_BED}`] };
    if (hi > CANAL_BED + 0.03 || lo < CANAL_BED - 0.03) probe.problems.push(tag(7, `the drawn canal and vliet beds lie from ${(lo - CANAL_BED).toFixed(2)} to +${(hi - CANAL_BED).toFixed(2)} m off the flat CANAL_BED (${CANAL_BED}) the boats take the ground on (world/tidemud.ts against world/tide.ts)`));
    report.probes.push(probe);
  }
  for (const l of report.levels) report.problems.push(...l.problems.map((p) => `${l.level.toFixed(2)} (${l.name}): ${p}`));
  for (const p of report.probes) report.problems.push(...p.problems);
  report.problems.push(...report.noCap, ...report.capRail, ...report.smallBoats);
  report.notCovered = [
    "the hulls' sides against the quay walls and each other (rowing.boatCheck() does the small boats)",
    "the ships' mooring lines (only the small boats' lines, through rowing.boatCheck())",
    "a boat on the mud is judged by her drawn bottom; the mud past the bank's outer edge (3.6 m from a wall) is open river with no bed",
    "the river's waves: the waterline is the mean over the run, the rail the lowest seen",
  ];
  report.ms = Math.round(performance.now() - t0);
  return report;
}

// ---- probes for the faults that are not a hull's height
type Tag = (c: number, p: string) => string;
function probesAt(h: Host, level: number, report: BoatWaterReport, tag: Tag, stats: Map<string, Stat>, mud: MudGrid | null): void {
  const get = (c: number, what: string) => {
    let p = report.probes.find((q) => q.case === c && q.what === what);
    if (!p) report.probes.push((p = { case: c, what, problems: [], notes: [] }));
    return p;
  };
  const L = level.toFixed(2);
  const bs = h.world.boats()!;
  const rowing = h.rowing as unknown as {
    data: { boats: Array<{ id: string; kind: SmallKind; home: { x: number; z: number; yaw: number }; lost?: boolean }>; landings: Array<{ id: string; x: number; z: number; landing: [number, number]; label: string }> } | null;
    fleet: { world(i: number): THREE.Matrix4 } | null;
    fleetIdx: Map<string, number>;
    homeLying(b: unknown): unknown;
    climbInto(l: unknown, via: { ladder?: unknown }, then: () => void): void;
  };
  // case 2: the ladder climb into a boat that lies on the mud: where rowing.ts sets Jef down (his last key)
  {
    const p = get(2, "the ladder climb into a small boat (game/rowing.ts climbInto)");
    const w = rowing.data;
    const pl = h.player;
    const real = pl.climbTo;
    let worst: { d: number; text: string } | null = null;
    let n = 0;
    let aground = 0;
    let under = 0;
    try {
      for (const b of w?.boats ?? []) {
        const m = MOORINGS.find((q) => q.id === b.id);
        if (!m || b.lost || m.board.kind !== "ladder") continue;
        const hull = HULLS[b.kind];
        const lv = levelAt(b.home.x, b.home.z);
        const floor = floorOf(b.kind, b.home.x, b.home.z, b.home.yaw);
        const i = rowing.fleetIdx?.get(b.id);
        const shown = i !== undefined && rowing.fleet ? rowing.fleet.world(i).elements[13] : Math.max(lv, floor);
        let keys: Array<[number, number, number, number]> = [];
        pl.climbTo = (k) => void (keys = k);
        rowing.climbInto(rowing.homeLying(b), { ladder: m.board }, () => {});
        pl.climbTo = real;
        const last = keys[keys.length - 1];
        if (!last) continue;
        n++;
        if (floor <= lv) continue;
        aground++;
        const want = shown + hull.seatY - 0.2;
        const d = want - last[1];
        if (d > 0.05) under++;
        if (d > 0.05 && (!worst || d > worst.d)) worst = { d, text: `${b.id} (${b.kind}) at (${b.home.x.toFixed(1)}, ${b.home.z.toFixed(1)}): Jef set down at y ${last[1].toFixed(2)}, her thwart at ${want.toFixed(2)}` };
      }
    } finally {
      pl.climbTo = real;
    }
    if (under && worst) p.problems.push(tag(2, `${L}: the climb down a ladder into a boat lying on the mud ends under her thwart in ${under} of ${aground} boats, by up to ${worst.d.toFixed(2)} m (${worst.text}): it aims at the water's level, not at the boat`));
    p.notes.push(`${L}: ${n} ladder boats climbed into (keys only, nothing moved), ${aground} on the mud${worst ? `; worst ${worst.text}, ${worst.d.toFixed(2)} m` : ""}`);
  }
  const lengthOf = (k: string) => {
    try {
      return bs.dims(k).length;
    } catch {
      return 0; // (not a boats.glb model: the ferry, the landing stage)
    }
  };
  // case 5: the cranes set loads down in a hold at the water's level plus a fixed offset (world/railway.ts)
  {
    const p = get(5, "the cranes' loads against the holds under them (world/railway.ts)");
    const info = h.world.railway()?.info() as { cranes?: Array<{ at: [number, number]; mode: string }> } | undefined;
    for (const c of info?.cranes ?? []) {
      if (c.mode !== "ship") continue;
      const [cx, cz] = c.at;
      const codeY = levelAt(cx, cz) + 0.25; // railway.ts: levelAt(site) + (shipY - waterY), shipY = waterY + 0.25
      let best: Stat | null = null;
      let bd = 26;
      for (const s of stats.values()) {
        const d = Math.hypot(s.v.x - cx, s.v.z - cz);
        if (d < bd && !s.v.moving && lengthOf(s.v.kind) >= 9) {
          bd = d;
          best = s;
        }
      }
      if (!best) continue;
      const shipY = best.level + best.sum / Math.max(1, best.n) + 0.25;
      if (shipY - codeY > 0.1) p.problems.push(tag(5, `${L}: the crane at (${cx}, ${cz}) lowers its loads to y ${codeY.toFixed(2)}, ${(shipY - codeY).toFixed(2)} m under the hold of the ${best.v.name} beside it (she lies at ${(shipY - 0.25).toFixed(2)})`));
      else p.notes.push(`${L}: the crane at (${cx}, ${cz}) and the ${best.v.name}: loads at ${codeY.toFixed(2)}, hold at ${shipY.toFixed(2)}`);
    }
  }
  // case 6: heights fixed when the world was built
  {
    const p = get(6, "heights fixed at build time");
    // the brig's walkable deck (rijnkaai.ts DECK) against her drawn deck (her model's deck extra)
    const brig = [...stats.values()].find((s) => s.v.kind === "brig");
    const d = brig ? bs.deck("brig", brig.v.x, brig.v.z, Math.PI / 2) : null;
    if (brig && d) {
      const drawn = brig.v.y + (d.y - levelAt(brig.v.x, brig.v.z));
      const walk = h.world.baseAt(-40, -7.2);
      if (Math.abs(drawn - walk) > 0.1) p.problems.push(tag(6, `${L}: the Anna Maria's walkable deck is at y ${walk.toFixed(2)}, her drawn deck at ${drawn.toFixed(2)} (${(walk - drawn).toFixed(2)} m)`));
      else p.notes.push(`${L}: the brig's deck walk ${walk.toFixed(2)} = drawn ${drawn.toFixed(2)}`);
    }
    // the Werf landing stage / pontoon: its walk floor against its drawn deck
    const stage = [...stats.values()].find((s) => s.v.kind === "landing_stage");
    if (stage) {
      const top = Number(bs.extra("pontoon_section", "deck_top") ?? 1.8);
      const walk = h.world.baseAt(-249, -30);
      const drawn = stage.v.y + top;
      if (Math.abs(walk - drawn) > 0.15) p.problems.push(tag(6, `${L}: the Werf landing stage's walk floor is at y ${walk.toFixed(2)}, its drawn deck near ${drawn.toFixed(2)}`));
      else p.notes.push(`${L}: the landing stage walk ${walk.toFixed(2)}, drawn ${drawn.toFixed(2)}`);
    }
    // the hire landings: rowing.ts calls one flooded when the water stands 0.7 m over WATER_Y, whatever its own height
    for (const Ld of rowing.data?.landings ?? []) {
      const floorY = h.world.baseAt(Ld.landing[0], Ld.landing[1]);
      const lv = levelAt(Ld.x, Ld.z);
      const rule = lv > WATER_Y + 0.4 + 0.3;
      const truth = lv > floorY + 0.3;
      p.notes.push(`${L}: the hire landing ${Ld.id}: floor ${floorY.toFixed(2)}, water ${lv.toFixed(2)}, rowing.ts ${rule ? "flooded" : "dry"}, really ${truth ? "flooded" : "dry"}`);
      if (rule !== truth && Number.isFinite(floorY)) p.problems.push(tag(6, `${L}: the hire landing ${Ld.id} (${Ld.label}): its floor is at y ${floorY.toFixed(2)}; the water there is ${lv.toFixed(2)}, so it is ${truth ? "under water" : "dry"}, but rowing.ts takes it as ${rule ? "flooded" : "dry"} (it reads WATER_Y ${WATER_Y} + 0.7, fixed)`));
    }
    // the fishing float off the Steen (world/steenlife.ts): on the water when Jef is near enough to see it
    let float: THREE.Mesh | null = null;
    h.world.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!float && m.isMesh && (m.geometry as THREE.SphereGeometry).parameters?.radius === 0.03 && ((m.material as THREE.MeshLambertMaterial).color?.getHex?.() ?? 0) === 0xb03a28) float = m;
    });
    if (float) {
      const f = float as THREE.Mesh;
      const at = new THREE.Vector3();
      f.getWorldPosition(at);
      const lv = levelAt(at.x, at.z);
      const near = Math.hypot(at.x - h.player.x, at.z - h.player.z) < 60;
      if (f.visible && near && Math.abs(at.y - lv) > 0.1) p.problems.push(tag(6, `${L}: the fishing float off the Steen is at y ${at.y.toFixed(2)}, the water at ${lv.toFixed(2)}`));
      else p.notes.push(`${L}: the fishing float at ${at.y.toFixed(2)}, the water ${lv.toFixed(2)}${near ? "" : " (Jef far: it follows the water only when he is near)"}`);
    }
    // the timber pier's braces and rubbing strake (world/pier.ts): built round WATER_Y
    const strake = [WATER_Y + 0.55, WATER_Y + 0.8];
    const lv = level;
    if (lv > strake[1] + 0.6 || lv < strake[0] - 0.6)
      p.problems.push(tag(6, `${L}: the pier's rubbing strake (y ${strake[0].toFixed(2)} to ${strake[1].toFixed(2)}, where the lighters lie against it) and the lower ends of its braces (${(WATER_Y + 0.35).toFixed(2)}) were built for the water at WATER_Y (${WATER_Y}): the water stands ${lv > strake[1] ? `${(lv - strake[1]).toFixed(2)} m over` : `${(strake[0] - lv).toFixed(2)} m under`} the strake (world/pier.ts:80-93)`));
  }
  // case 10: the moving ships never take the ground: how near their keels come to the mud
  {
    const p = get(10, "the moving ships' keels against the beds (river, anchorage, lock tows)");
    let worst: Stat | null = null;
    for (const s of stats.values()) if (s.v.moving && Number.isFinite(s.clear) && (!worst || s.clear < worst.clear)) worst = s;
    const moving = [...stats.values()].filter((s) => s.v.moving).length;
    p.notes.push(`${L}: ${moving} moving hulls seen; ${worst ? `the nearest to the mud: ${worst.v.name}, ${worst.clear.toFixed(2)} m over it` : "none came over the mud"}`);
    if (worst && worst.clear < 0.3 && worst.pen <= MUD) p.problems.push(tag(10, `${L}: the ${worst.v.name} (${worst.v.source}) passes ${worst.clear.toFixed(2)} m over the mud: a deeper hull would cut it (moving ships never take the ground)`));
    void mud;
  }
}

/** Case 4: the lock chamber sloping between its ends (both pairs of gates open, river and dock apart): instanced boats against single ones. */
async function chamberProbe(h: Host, report: BoatWaterReport, tag: Tag, probeObjs: Set<THREE.Object3D>): Promise<void> {
  const bs = h.world.boats()!;
  const p = { case: 4, what: "the lock chamber at both ends: instanced and single boats on its slope (world/boats.ts writeFleet, levelOf)", problems: [] as string[], notes: [] as string[] };
  report.probes.push(p);
  // two instanced rowing boats at the two ends of the chamber (a fleet of their own, never drawn), and the boats the game has there
  const holder = new THREE.Group();
  const ends = [CHAMBER.minZ + 4, CHAMBER.maxZ - 4];
  const fleet = bs.fleetOf(holder, ends.map((z) => ({ name: "rowboat", x: 110, z, yaw: 0, floor: -Infinity })));
  const save = { a: water.chamberA, b: water.chamberB, c: water.chamber };
  const sea = h.psxUniforms?.uSea.value;
  if (h.psxUniforms) h.psxUniforms.uSea.value = 0; // (no heave: the level alone)
  try {
    for (const [A, B, what] of [
      [water.river, water.river, "level with the river"],
      [water.dock, water.dock, "level with the dock"],
      [water.river, water.dock, "sloping from the river gates to the dock gates"],
    ] as Array<[number, number, string]>) {
      water.chamberA = A;
      water.chamberB = B;
      water.chamber = (A + B) / 2;
      bs.update(performance.now() / 1000, 0);
      for (const [i, z] of ends.entries()) {
        const y = fleet.world(i).elements[13];
        const want = levelAt(110, z);
        if (Math.abs(y - want) > AFLOAT + 0.08) p.problems.push(tag(4, `the chamber ${what} (river end ${A.toFixed(2)}, dock end ${B.toFixed(2)}): an instanced boat at its ${z < 25 ? "river" : "dock"} end (110, ${z}) floats at ${y.toFixed(2)}, the water there is ${want.toFixed(2)}: writeFleet takes the chamber's mean (tide.ts levelOf)`));
        else p.notes.push(`${what}: instanced boat at z ${z}: ${y.toFixed(2)}, water ${want.toFixed(2)}`);
      }
      for (const v of vessels(h, probeObjs)) {
        if (regionAt(v.x, v.z) !== 2) continue;
        const want = levelAt(v.x, v.z);
        const dy = v.y - want;
        if (Math.abs(dy) > AFLOAT + 0.08) p.problems.push(tag(4, `the chamber ${what}: the ${v.name} (${v.source}) floats at ${v.y.toFixed(2)}, the water there is ${want.toFixed(2)}`));
        else p.notes.push(`${what}: the ${v.name} (${v.source}) at ${v.y.toFixed(2)}, the water ${want.toFixed(2)}`);
      }
    }
  } finally {
    water.chamberA = save.a;
    water.chamberB = save.b;
    water.chamber = save.c;
    fleet.hide(0, true);
    fleet.hide(1, true);
    if (h.psxUniforms && sea !== undefined) h.psxUniforms.uSea.value = sea;
    bs.update(performance.now() / 1000, 0);
  }
  await yieldNow();
}

/** Case 3: a small boat left out drifts with the tide (game/rowing.ts update): her floor where she comes to lie. */
function driftProbe(h: Host, report: BoatWaterReport, tag: Tag, mud: MudGrid | null): void {
  const p = { case: 3, what: "a boat drifting with the tide keeps the floor of the spot she left (game/rowing.ts)", problems: [] as string[], notes: [] as string[] };
  report.probes.push(p);
  const rowing = h.rowing as unknown as {
    lay(key: string, kind: SmallKind, x: number, z: number, yaw: number, drift?: boolean): { x: number; z: number; yaw: number; obj: THREE.Object3D; drift: boolean } | null;
    drop(l: unknown): void;
    lying: Map<string, { drift: boolean }>;
    current(x: number, z: number): [number, number];
    update(dt: number): void;
  };
  const kind: SmallKind = "rowboat";
  // a start on the river by a wall where her floor (the bank's mud) gives out within a few metres downstream
  const [cx] = rowing.current(-60, -3);
  if (!cx) {
    p.notes.push("no tidal current now (slack water by the clock): nothing drifts");
    return;
  }
  const dir = Math.sign(cx);
  let start: { x: number; z: number; f0: number; x1: number; f1: number } | null = null;
  for (let x = -330; x < 200 && !start; x += 1)
    for (const z of [-1.6, -2.2]) {
      const f0 = floorOf(kind, x, z, Math.PI / 2);
      if (f0 === -Infinity || !h.world.boatFree(x, z, 1.2)) continue;
      for (let s = 3; s <= 12; s += 1) {
        const f1 = floorOf(kind, x + dir * s, z, Math.PI / 2);
        if (!h.world.boatFree(x + dir * s, z, 1.2)) break;
        if (Math.abs(f1 - f0) > 0.3) {
          start = { x, z, f0, x1: x + dir * s, f1 };
          break;
        }
      }
      if (start) break;
    }
  if (!start) {
    p.notes.push("no stretch of wall found where the bank's mud gives out");
    return;
  }
  const others = [...rowing.lying.values()].filter((l) => l.drift);
  for (const o of others) o.drift = false; // (only the probe moves)
  const l = rowing.lay("w1-drift-probe", kind, start.x, start.z, Math.PI / 2, true);
  try {
    if (!l) {
      p.notes.push("no rowing boat to lay out");
      return;
    }
    // the drift's own step, over the distance in one go (0.8 x the current, rowing.ts update)
    const dt = Math.abs(start.x1 - start.x) / (Math.abs(cx) * 0.8);
    rowing.update(dt);
    const now = floorOf(kind, l.x, l.z, l.yaw);
    const kept = l.obj.userData.floor as number;
    const mudNow = mud?.get(l.x, l.z)?.y;
    const msg = `a rowing boat laid adrift at (${start.x}, ${start.z}) (floor ${start.f0.toFixed(2)}) drifted to (${l.x.toFixed(1)}, ${l.z.toFixed(1)}): she keeps the floor ${kept === -Infinity ? "none" : kept.toFixed(2)}, the floor there is ${now === -Infinity ? "none (deep water)" : now.toFixed(2)}${mudNow !== undefined ? ` (drawn mud ${mudNow.toFixed(2)})` : ""}`;
    if (Math.abs(l.x - start.x) < 0.5) p.notes.push(`the boat did not drift (walls or hulls in the way): ${msg}`);
    else if ((kept === -Infinity) !== (now === -Infinity) || Math.abs(kept - now) > 0.1) p.problems.push(tag(3, `${msg}: at low water she ${now === -Infinity || now < kept ? "hangs over the water" : "sinks into the mud"}`));
    else p.notes.push(msg);
  } finally {
    if (l) rowing.drop(l);
    for (const o of others) o.drift = true;
  }
}
