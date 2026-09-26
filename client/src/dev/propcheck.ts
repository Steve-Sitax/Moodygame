import * as THREE from "three";
import CITY from "../../../shared/city.json";
import { LANDMARK_DOORS } from "../../../shared/landmarks";
import { stallThings, thingLocal } from "../game/stallSpots";
import { facadeOpenings } from "../world/cityTextures";
import { landmarkDoorKeepOut } from "../world/doorKeep";
import { propThings, ptsBox, type PropThing } from "../world/propSpots";
import type { Posters } from "../world/posters";
import type { StreetLife } from "../world/streetlife";
import { BUILDING_GROUPS, boxesOverlap, buildGroundProbe, buildingRoots, buildWallProbe, type GroundProbe, type WallBox, type WallProbe } from "../world/wallprobe";
import { allDoors, depthIn } from "./stallcheck";

// The prop check (dev, `await __scheldemist.propcheck()`, Steve 2026-09-26: "barrels and crates in walls"):
// every solid prop the town sets down (world/propSpots.ts: clutter, litter, quay goods, quay furniture,
// street life's pumps and troughs, the trades, the town's places ...), its footprint from its model's
// points, turned and scaled as placed, tested against:
//   - wall: the houses and buildings as built (city.glb with the landmarks, the churches, the prison, the
//     Steen, the Vleeshuis, the town hall, the cathedral, the town wall, the alleys' back walls): level rays
//     across the prop at three heights over the kerb (a wall face, a shopfront's sill or pilaster, a door
//     step or a gateway's pier running through it), and its points inside a house's or landmark's plan;
//   - door: the doorway and 0.9 m of street before every door (the houses', the shops', the homes', the
//     game's, the landmarks' porches);
//   - passage: the open ways from the streets into the back alleys (2.2 m between two houses);
//   - prop: another prop (not of its own heap or stack), a stall, a shop table or its goods;
//   - bill: a prop within 0.7 m of a bill on the wall, over its foot (it hides it);
//   - ground: its foot (its model's lowest points) on the ground as built (not floating, not sunk into a
//     kerb, a step or a quay's coping), not over the water.
// Paths are `__scheldemist.paths()`'s. It must list nothing (or only what `ok` explains).

type P = [number, number];
const WATER = 2;
/** world.groundAt counts a collider's top this far over the feet as ground (world/rijnkaai.ts STEP). */
const STEP_UP = 0.36;
/** The kerbs of the street fronts stand 0.12 m: rays run over them. */
const OVER_KERB = 0.15;
const CELL = 8;
/** Round models: tested as a circle in their box, not its corners. */
const ROUND = /(barrel|keg|cask|rain_butt|tub|bucket|butt|pot|churn|drum|tar_fire|well|bollard|guard_stone|post)/i;

export interface PropProblem {
  kind: "wall" | "door" | "passage" | "prop" | "bill" | "ground" | "water";
  src: string;
  name: string;
  x: number;
  z: number;
  problem: string;
}

export interface PropCheckWorld {
  scene: THREE.Scene;
  city: { group: THREE.Object3D; flags(x: number, z: number): number | undefined };
  groundAt(x: number, z: number, radius: number, feet: number): number;
  streetLife(): StreetLife | null;
  posters(): Posters | null;
}

let probeCache: { key: string; probe: WallProbe } | null = null;
let groundCache: { key: string; probe: GroundProbe } | null = null;
function groundProbe(roots: THREE.Object3D[]): GroundProbe {
  const key = roots.map((r) => r.uuid).join(",");
  if (groundCache?.key !== key) groundCache = { key, probe: buildGroundProbe(roots) };
  return groundCache.probe;
}
function buildingProbe(scene: THREE.Scene): { probe: WallProbe; roots: string[]; objects: THREE.Object3D[] } {
  const roots = buildingRoots(scene);
  const key = roots.map((r) => `${r.name}:${r.uuid}`).join(",");
  if (probeCache?.key !== key) probeCache = { key, probe: buildWallProbe(roots) };
  return { probe: probeCache.probe, roots: roots.map((r) => r.name), objects: roots };
}

interface Frame {
  t: PropThing;
  /** Box in its own frame, scaled: u (x) along, y up, v (z) out. */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  y0: number;
  y1: number;
  round: boolean;
  c: number;
  s: number;
  w(u: number, v: number): P;
  box: WallBox;
  small: boolean;
  /** Its foot (its points within 10 cm of its lowest), in the world: [x, y, z] each. */
  feet: Array<[number, number, number]>;
}

const footCache = new WeakMap<object, number[]>();
/** The foot of a model: its points within 10 cm of its lowest, [x, y, z, ...] in its own frame (at most 48 of them, spread over it). */
function footOf(pts: PropThing["pts"], y0: number): number[] {
  const key = pts[0] as object;
  let f = pts.length === 1 ? footCache.get(key) : undefined;
  if (f) return f;
  const all: number[] = [];
  for (const p of pts) for (let i = 0; i + 2 < p.length; i += 3) if (p[i + 1] <= y0 + 0.1) all.push(p[i], p[i + 1], p[i + 2]);
  const n = all.length / 3;
  const step = Math.max(1, Math.ceil(n / 48));
  f = [];
  for (let i = 0; i < n; i += step) f.push(all[i * 3], all[i * 3 + 1], all[i * 3 + 2]);
  if (pts.length === 1) footCache.set(key, f);
  return f;
}

function frameOf(t: PropThing): Frame | null {
  const b = ptsBox(t.pts);
  if (!Number.isFinite(b[0])) return null;
  const [sx, sy, sz] = t.s ?? [1, 1, 1];
  const u0 = Math.min(b[0] * sx, b[3] * sx), u1 = Math.max(b[0] * sx, b[3] * sx);
  const v0 = Math.min(b[2] * sz, b[5] * sz), v1 = Math.max(b[2] * sz, b[5] * sz);
  const y0 = t.y + Math.min(b[1] * sy, b[4] * sy), y1 = t.y + Math.max(b[1] * sy, b[4] * sy);
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  const w = (u: number, v: number): P => [t.x + u * c + v * s, t.z - u * s + v * c];
  const [cx, cz] = w((u0 + u1) / 2, (v0 + v1) / 2);
  const box: WallBox = { kind: t.src, name: t.name, flat: false, cx, cz, ux: c, uz: -s, nx: s, nz: c, hu: (u1 - u0) / 2, hn: (v1 - v0) / 2, y0, y1 };
  const round = ROUND.test(t.name) && Math.abs(u1 - u0 - (v1 - v0)) < 0.25 * Math.max(u1 - u0, v1 - v0);
  const small = y1 - y0 < 0.2 || (u1 - u0) * (v1 - v0) < 0.04;
  const fl = footOf(t.pts, Math.min(b[1], b[4]));
  const feet: Array<[number, number, number]> = [];
  for (let i = 0; i < fl.length; i += 3) {
    const [x, z] = w(fl[i] * sx, fl[i + 2] * sz);
    feet.push([x, t.y + fl[i + 1] * sy, z]);
  }
  return { t, u0, u1, v0, v1, y0, y1, round, c, s, w, box, small, feet };
}

/** Level rays across a prop (chords, for a round one) at a height: the first wall met inside it, or null. */
function wallThrough(f: Frame, probe: WallProbe, y: number, inset: number, occupied?: (x: number, y: number, z: number) => boolean): string | null {
  const cu = (f.u0 + f.u1) / 2, cv = (f.v0 + f.v1) / 2;
  const ru = (f.u1 - f.u0) / 2 - inset, rv = (f.v1 - f.v0) / 2 - inset;
  if (ru <= 0.01 || rv <= 0.01) return null;
  for (const k of [-0.75, 0, 0.75]) {
    // along u, at v = cv + k rv; across (along v), at u = cu + k ru
    const hu = f.round ? ru * Math.sqrt(1 - k * k) : ru;
    const hv = f.round ? rv * Math.sqrt(1 - k * k) : rv;
    {
      const [ax, az] = f.w(cu - hu, cv + k * rv);
      const d = probe(ax, y, az, f.c, -f.s, 2 * hu);
      if (d !== null && (!occupied || occupied(ax + f.c * d, y, az - f.s * d))) return `a wall runs through it (${(d - hu).toFixed(2)} m from its middle along, ${(k * rv).toFixed(2)} m out, ${y.toFixed(2)} m up)`;
    }
    {
      const [ax, az] = f.w(cu + k * ru, cv - hv);
      const d = probe(ax, y, az, f.s, f.c, 2 * hv);
      if (d !== null && (!occupied || occupied(ax + f.s * d, y, az + f.c * d))) return `a wall runs through it (${(k * ru).toFixed(2)} m along, ${(d - hv).toFixed(2)} m from its middle out, ${y.toFixed(2)} m up)`;
    }
  }
  return null;
}

export interface PropCheckOpts {
  /** Only props whose layer or model name contains this. */
  only?: string;
  /** How many of the list to return (all by default). */
  list?: number;
  /** Only within r metres of [x, z]. */
  near?: [number, number, number];
}

export function checkProps(world: PropCheckWorld, town: Parameters<typeof allDoors>[0], opts: PropCheckOpts = {}) {
  const t0 = performance.now();
  const { probe, roots, objects } = buildingProbe(world.scene);
  const ground = groundProbe(objects);
  const flags = (x: number, z: number) => world.city.flags(x, z) ?? 0;
  const problems: PropProblem[] = [];
  const sl = world.streetLife();
  const posters = world.posters();

  const frames: Frame[] = [];
  for (const t of propThings) {
    const f = frameOf(t);
    if (f) frames.push(f);
  }
  const want = (f: Frame) =>
    (!opts.only || f.t.src.includes(opts.only) || f.t.name.includes(opts.only)) && (!opts.near || Math.hypot(f.t.x - opts.near[0], f.t.z - opts.near[1]) < opts.near[2]);
  const grid = new Map<string, Frame[]>();
  for (const f of frames) {
    const k = `${Math.floor(f.box.cx / CELL)},${Math.floor(f.box.cz / CELL)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(f);
  }
  const near = <T,>(g: Map<string, T[]>, x: number, z: number): T[] => {
    const out: T[] = [];
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(g.get(`${gx + i},${gz + j}`) ?? []));
    return out;
  };

  // --- the doors: the doorway and 0.9 m before it
  const doorBoxes: WallBox[] = [];
  const doorAt = (x: number, z: number, ox: number, oz: number, half: number, label: string) =>
    doorBoxes.push({ kind: "door", name: label, flat: false, cx: x + ox * 0.45, cz: z + oz * 0.45, ux: -oz, uz: ox, nx: ox, nz: oz, hu: half, hn: 0.45, y0: 0, y1: 2.2 });
  for (const d of allDoors(town)) doorAt(d.x, d.z, d.ox, d.oz, d.half, d.label);
  if (sl) {
    const GH = sl.ground_h, SH = sl.storey_h;
    for (const w of sl.walls) {
      const [ax, az, bx, bz, ox, oz, H, , kind, style, door] = w;
      if (door < 0 || kind !== 0) continue;
      const L = Math.hypot(bx - ax, bz - az) || 1;
      const tx = (bx - ax) / L, tz = (bz - az) / L;
      const op = facadeOpenings(L, H, true, style, GH, SH).find((o) => o.what === "door");
      const s = door * L;
      // the leaf between the jambs of its stone surround (0.2 m each side)
      const half = op ? Math.max(0.45, (op.s1 - op.s0) / 2 - 0.2) : 0.6;
      doorAt(ax + tx * s, az + tz * s, ox, oz, half, `the house door at ${(ax + tx * s).toFixed(0)}, ${(az + tz * s).toFixed(0)}`);
    }
  }
  for (const d of LANDMARK_DOORS) {
    const dd = d as unknown as { id?: string; step: P };
    doorBoxes.push({ kind: "door", name: `landmark door ${dd.id ?? ""}`, flat: false, cx: dd.step[0], cz: dd.step[1], ux: 1, uz: 0, nx: 0, nz: 1, hu: 0.9, hn: 0.9, y0: 0, y1: 2.2 });
  }
  for (const r of landmarkDoorKeepOut()) {
    doorBoxes.push({ kind: "door", name: "a landmark's porch", flat: false, cx: (r.minX + r.maxX) / 2, cz: (r.minZ + r.maxZ) / 2, ux: 1, uz: 0, nx: 0, nz: 1, hu: (r.maxX - r.minX) / 2, hn: (r.maxZ - r.minZ) / 2, y0: 0, y1: 2.2 });
  }
  const doorGrid = new Map<string, WallBox[]>();
  for (const d of doorBoxes) {
    const k = `${Math.floor(d.cx / CELL)},${Math.floor(d.cz / CELL)}`;
    let l = doorGrid.get(k);
    if (!l) doorGrid.set(k, (l = []));
    l.push(d);
  }
  // --- the passages into the back alleys
  const passages = ((CITY as unknown as { alleys?: { passages?: number[][] } }).alleys?.passages ?? []).map(([x0, z0, x1, z1]): WallBox => ({
    kind: "passage", name: `the passage at ${((x0 + x1) / 2).toFixed(0)}, ${((z0 + z1) / 2).toFixed(0)}`, flat: false,
    cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, ux: 1, uz: 0, nx: 0, nz: 1, hu: Math.abs(x1 - x0) / 2, hn: Math.abs(z1 - z0) / 2, y0: 0, y1: 3,
  }));
  // --- the stalls, shop tables and goods set out (the stall check's things), their low layer
  const stallBoxes: WallBox[] = [];
  for (const st of stallThings) {
    const L = thingLocal(st);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i + 2 < L.length; i += 3) {
      if (L[i + 1] >= 1.3) continue;
      u0 = Math.min(u0, L[i]);
      u1 = Math.max(u1, L[i]);
      y0 = Math.min(y0, L[i + 1]);
      y1 = Math.max(y1, L[i + 1]);
      v0 = Math.min(v0, L[i + 2]);
      v1 = Math.max(v1, L[i + 2]);
    }
    if (!Number.isFinite(u0)) continue;
    const c = Math.cos(st.yaw), s = Math.sin(st.yaw);
    const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2;
    stallBoxes.push({ kind: st.kind, name: st.label, flat: false, cx: st.x + mu * c + mv * s, cz: st.z - mu * s + mv * c, ux: c, uz: -s, nx: s, nz: c, hu: (u1 - u0) / 2, hn: (v1 - v0) / 2, y0, y1 });
  }
  const stallGrid = new Map<string, WallBox[]>();
  for (const b of stallBoxes) {
    const k = `${Math.floor(b.cx / CELL)},${Math.floor(b.cz / CELL)}`;
    let l = stallGrid.get(k);
    if (!l) stallGrid.set(k, (l = []));
    l.push(b);
  }
  // --- the bills on the walls (and the engine's places for its own)
  const bills: WallBox[] = [...(posters?.items.filter((p) => p.what === "bill" || p.what === "stack").map((p) => p.box) ?? []), ...(posters?.aiSpots.map((a) => a.box) ?? [])];
  const billGrid = new Map<string, WallBox[]>();
  for (const b of bills) {
    const k = `${Math.floor(b.cx / CELL)},${Math.floor(b.cz / CELL)}`;
    let l = billGrid.get(k);
    if (!l) billGrid.set(k, (l = []));
    l.push(b);
  }

  const seenPair = new Set<Frame>();
  let checked = 0;
  for (const f of frames) {
    if (!want(f)) continue;
    checked++;
    const t = f.t;
    const say = (kind: PropProblem["kind"], problem: string) => problems.push({ kind, src: t.src, name: t.name, x: +t.x.toFixed(2), z: +t.z.toFixed(2), problem });
    // 1. into a wall: the buildings as built, at three heights over the kerb; and the plans of the houses
    {
      let cut: string | null = null;
      const h = f.y1 - f.y0;
      const ys = h < 0.3 ? [f.y0 + Math.max(OVER_KERB, h * 0.6)] : [f.y0 + OVER_KERB, f.y0 + h * 0.5, f.y1 - 0.06];
      // (a big thing, a trade's whole workplace or a heap, is not all box: a wall met where none of its model
      // is near does not go through it)
      let occupied: ((x: number, y: number, z: number) => boolean) | undefined;
      if ((f.u1 - f.u0) * (f.v1 - f.v0) > 2) {
        const [sx, sy, sz] = t.s ?? [1, 1, 1];
        const wp: number[] = [];
        for (const p of t.pts) {
          const step = Math.max(1, Math.floor(p.length / 3 / 4000)) * 3;
          for (let i = 0; i + 2 < p.length; i += step) {
            const [x, z] = f.w(p[i] * sx, p[i + 2] * sz);
            wp.push(x, t.y + p[i + 1] * sy, z);
          }
        }
        occupied = (x, y, z) => {
          for (let i = 0; i < wp.length; i += 3) if (Math.abs(wp[i] - x) < 0.3 && Math.abs(wp[i + 2] - z) < 0.3 && Math.abs(wp[i + 1] - y) < 0.4) return true;
          return false;
        };
      }
      for (const y of ys) {
        if (y >= f.y1) continue;
        cut = wallThrough(f, probe, y, 0.03, occupied);
        if (cut) break;
      }
      if (cut) say("wall", cut);
      else {
        // wholly inside a building (no face crosses it): its middle in a house's or landmark's plan, more
        // than 0.3 m in, where the walk map has walls all round it too (the plans of a few houses run over
        // alleys and courts cut through them later: there the walk map is open), and walls of the buildings
        // as built all round
        const [mx, mz] = f.w((f.u0 + f.u1) / 2, (f.v0 + f.v1) / 2);
        const dp = depthIn(mx, mz);
        // (the walk map keeps half a metre off every wall: a thing against one has its middle in that margin,
        // but not the ground a little further out)
        const walled = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]].every(([ex, ez]) => flags(mx + ex, mz + ez) & 1);
        if (dp.d > 0.3 && walled) {
          const y = f.y0 + Math.min(0.5, (f.y1 - f.y0) / 2);
          let walls = 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (probe(mx, y, mz, dx, dz, 30) !== null) walls++;
          if (walls === 4) say("wall", `inside ${dp.name}, ${dp.d.toFixed(2)} m in`);
        }
      }
    }
    // 2. in a doorway, or before a door (a crust of bread or a cabbage leaf does not bar it)
    if (!f.small) for (const d of near(doorGrid, f.box.cx, f.box.cz)) {
      if (boxesOverlap(f.box, d, 0.02)) {
        say("door", `stands in the doorway of ${d.name}, or less than 0.9 m before it`);
        break;
      }
    }
    // 3. in a passage into the back alleys
    if (!f.small) for (const p of passages) {
      if (Math.abs(p.cx - f.box.cx) > 10 || Math.abs(p.cz - f.box.cz) > 10) continue;
      if (boxesOverlap(f.box, p, 0.02)) {
        say("passage", `stands in ${p.name}`);
        break;
      }
    }
    // 4. another prop (not of its own heap), a stall
    if (!f.small && !t.onTop) {
      for (const o of near(grid, f.box.cx, f.box.cz)) {
        if (o === f || o.small || o.t.onTop || seenPair.has(o) || (t.set && o.t.set === t.set)) continue;
        if (!boxesOverlap(f.box, o.box, 0.04)) continue;
        // two round things: by their circles
        if (f.round && o.round) {
          const r1 = Math.min(f.box.hu, f.box.hn), r2 = Math.min(o.box.hu, o.box.hn);
          if (Math.hypot(f.box.cx - o.box.cx, f.box.cz - o.box.cz) > r1 + r2 - 0.04) continue;
        }
        say("prop", `overlaps ${o.t.src} ${o.t.name} at ${o.t.x.toFixed(1)}, ${o.t.z.toFixed(1)}`);
      }
      seenPair.add(f);
      for (const b of near(stallGrid, f.box.cx, f.box.cz)) {
        if (boxesOverlap(f.box, b, 0.03)) {
          say("prop", `overlaps ${b.kind} ${b.name}`);
          break;
        }
      }
    }
    // 5. before a bill: within 0.8 m of its wall, over its foot
    for (const b of near(billGrid, f.box.cx, f.box.cz)) {
      const reach: WallBox = { ...b, cx: b.cx + b.nx * 0.35, cz: b.cz + b.nz * 0.35, hn: 0.35 + b.hn, y0: b.y0 + 0.05, y1: b.y1 };
      if (f.y1 > b.y0 + 0.05 && boxesOverlap(f.box, reach, 0.02)) {
        say("bill", `stands before the bill ${b.name} (${b.y0.toFixed(2)} m up) and hides it`);
        break;
      }
    }
    // 6. the ground: over the water; floating or sunk at its foot (its model's own lowest points: a pump's
    // spout or a cart's shafts over the kerb's edge stand in the air as they should)
    {
      let wet = 0;
      let off = 0;
      const y = f.y0; // (its lowest: the foot's other points are the band of 10 cm over it)
      for (const [x, , z] of f.feet) {
        // the ground as built (a kerb, a step, a quay's coping); where none is built, the game's ground
        // (a point on the seam between two kerb slabs meets neither: a hair to the side)
        const gb = ground(x, z, y + 0.4) ?? ground(x + 0.02, z + 0.02, y + 0.4) ?? ground(x - 0.02, z - 0.02, y + 0.4);
        // (the walk map's water: where no quay, step or pontoon is built under the foot)
        if (flags(x, z) & WATER && (gb === null || gb < y - 0.3)) wet++;
        if (t.onTop) continue;
        const g = gb ?? world.groundAt(x, z, 0, y - STEP_UP + 0.05);
        if (Math.abs(g - y) > 1.5) continue; // a floor inside a house, or the quay's foot: not its street
        if (Math.abs(g - y) > Math.abs(off)) off = g - y;
      }
      if (wet) say("water", `over the water (${wet} of ${f.feet.length} points of its foot)`);
      if (off < -0.08) say("ground", `floats ${(-off).toFixed(2)} m over the ground at its foot`);
      else if (off > 0.1) say("ground", `sunk ${off.toFixed(2)} m into the ground at its foot`);
    }
  }
  const byKind: Record<string, number> = {};
  const bySrc: Record<string, number> = {};
  for (const p of problems) {
    byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
    const k = `${p.src} ${p.name}: ${p.kind}`;
    bySrc[k] = (bySrc[k] ?? 0) + 1;
  }
  const props: Record<string, number> = {};
  for (const f of frames) if (want(f)) props[f.t.src] = (props[f.t.src] ?? 0) + 1;
  return {
    props: checked,
    bySource: props,
    problems: problems.length,
    byKind,
    bySrc: Object.fromEntries(Object.entries(bySrc).sort((a, b) => b[1] - a[1])),
    list: opts.list === undefined ? problems : problems.slice(0, opts.list),
    buildings: roots,
    ms: Math.round(performance.now() - t0),
  };
}

/** Dev: what a level ray meets among the buildings (mesh names, distances), to see why a prop is flagged. */
export function rayHits(scene: THREE.Scene, x: number, y: number, z: number, dx: number, dz: number, maxD: number): Array<{ name: string; d: number; parent: string }> {
  const roots = scene.children.filter((c) => BUILDING_GROUPS.includes(c.name));
  const rc = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(dx, 0, dz).normalize(), 0, maxD);
  return rc.intersectObjects(roots, true).map((h) => ({ name: h.object.name, d: +h.distance.toFixed(3), parent: h.object.parent?.name ?? "" }));
}

/** Dev: a prop's frame (its box in the world) and the list entries near a point. */
export function propsNear(x: number, z: number, r = 2) {
  return propThings.filter((t) => Math.hypot(t.x - x, t.z - z) < r).map((t) => ({ src: t.src, name: t.name, x: t.x, y: t.y, z: t.z, yaw: t.yaw, box: ptsBox(t.pts), s: t.s }));
}

/** Dev: the ground as built under a point (the highest level face at or under yTop), or null. */
export function groundUnder(scene: THREE.Scene, x: number, z: number, yTop = 1): number | null {
  return groundProbe(buildingRoots(scene))(x, z, yTop);
}
