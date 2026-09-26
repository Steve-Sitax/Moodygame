import * as THREE from "three";
import BUILD from "../../../shared/city_build.json";
import CITY from "../../../shared/city.json";
import { stallThings, thingLocal, type StallThing } from "../game/stallSpots";
import type { StreetLife } from "../world/streetlife";
import { boxesOverlap, buildWallProbe, type WallBox, type WallProbe } from "../world/wallprobe";

// The stall check (dev, __scheldemist.stallcheck()): every market stall, the town's stalls, the shop
// tables with their awnings, the stalls against the cathedral and the goods set out before the shops,
// tested against the houses as built and the walk map (Steve 2026-09-26: "some shops are weirdly
// going over a corner"). For each thing, its model's points in two layers (low: table, legs, goods,
// crates; high: the awning or roof over 1.3 m):
//   - into a house: no point of either layer inside a house or landmark footprint, and no wall of
//     the real geometry (city.glb) running through the layer (level rays along and across it);
//   - past a corner: a thing hung on a wall (a shop's table and awning) has the wall right behind it
//     from end to end, at the table's and the awning's height;
//   - on the walk map: its low layer on open ground (not a wall, not water);
//   - in a doorway: its low layer clear of the step before every door (the houses', the game's);
//   - blocking a passage: at least `front` m (1.5) of open street before it;
//   - floating or sunk: the ground under its corners at its feet;
//   - overlapping another stall thing, or a sign, board or awning on the wall (street life).
// It must list nothing.

type P = [number, number];
const WALL = 1;
const WATER = 2;
/** world.groundAt counts a collider's top this far over the feet as ground (world/rijnkaai.ts STEP). */
const STEP_UP = 0.36;

export interface StallProblem {
  kind: string;
  label: string;
  x: number;
  z: number;
  problem: string;
}

interface Box {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  y0: number;
  y1: number;
}

interface Fp {
  pts: P[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  name: string;
}

let probeCache: { root: THREE.Object3D; probe: WallProbe } | null = null;
let fpCache: { grid: Map<string, Fp[]> } | null = null;

const CELL = 8;
function footprints(): Map<string, Fp[]> {
  if (fpCache) return fpCache.grid;
  const grid = new Map<string, Fp[]>();
  const add = (pts: P[], name: string) => {
    const xs = pts.map((p) => p[0]);
    const zs = pts.map((p) => p[1]);
    const f: Fp = { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), name };
    for (let i = Math.floor(f.minX / CELL); i <= Math.floor(f.maxX / CELL); i++) {
      for (let j = Math.floor(f.minZ / CELL); j <= Math.floor(f.maxZ / CELL); j++) {
        const k = `${i},${j}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(f);
      }
    }
  };
  const b = BUILD as unknown as { houses: Array<{ fp: number[][]; gone?: boolean }>; landmarks: Record<string, { fp: number[][] }> };
  b.houses.forEach((h, i) => {
    if (!h.gone) add(h.fp as P[], `house ${i}`);
  });
  for (const [k, l] of Object.entries(b.landmarks ?? {})) add(l.fp as P[], k);
  fpCache = { grid };
  return grid;
}

/** How deep inside a footprint (m) the point is: > 0 inside, else 0. */
export function depthIn(x: number, z: number): { d: number; name: string } {
  const l = footprints().get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
  let best = { d: 0, name: "" };
  for (const f of l) {
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    let inside = false;
    let dm = Infinity;
    const n = f.pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, zi] = f.pts[i];
      const [xj, zj] = f.pts[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const ex = xj - xi, ez = zj - zi;
      const L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - xi) * ex + (z - zi) * ez) / L2));
      dm = Math.min(dm, Math.hypot(x - (xi + ex * t), z - (zi + ez * t)));
    }
    if (inside && dm > best.d) best = { d: dm, name: f.name };
  }
  return best;
}

export interface StallCheckWorld {
  city: { group: THREE.Object3D; flags(x: number, z: number): number | undefined };
  groundAt(x: number, z: number, radius: number, feet: number): number;
  streetLife(): StreetLife | null;
}

export interface Door {
  x: number;
  z: number;
  ox: number;
  oz: number;
  half: number;
  label: string;
}

export function checkStalls(world: StallCheckWorld, doors: Door[], opts: { only?: string } = {}) {
  const t0 = performance.now();
  if (probeCache?.root !== world.city.group) probeCache = { root: world.city.group, probe: buildWallProbe(world.city.group) };
  const probe = probeCache.probe;
  const flags = (x: number, z: number) => world.city.flags(x, z) ?? 0;
  const problems: StallProblem[] = [];
  const things = stallThings.filter((t) => !opts.only || t.kind.includes(opts.only) || t.label.includes(opts.only));

  // each thing's two layers, in its own frame
  const layers = new Map<StallThing, { low: Box | null; high: Box | null }>();
  for (const t of stallThings) {
    const L = thingLocal(t);
    const mk = (): Box => ({ u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity, y0: Infinity, y1: -Infinity });
    const low = mk();
    const high = mk();
    for (let i = 0; i + 2 < L.length; i += 3) {
      const b = L[i + 1] < 1.3 ? low : high;
      b.u0 = Math.min(b.u0, L[i]);
      b.u1 = Math.max(b.u1, L[i]);
      b.y0 = Math.min(b.y0, L[i + 1]);
      b.y1 = Math.max(b.y1, L[i + 1]);
      b.v0 = Math.min(b.v0, L[i + 2]);
      b.v1 = Math.max(b.v1, L[i + 2]);
    }
    layers.set(t, { low: Number.isFinite(low.u0) ? low : null, high: Number.isFinite(high.u0) ? high : null });
  }
  const frame = (t: StallThing) => {
    const c = Math.cos(t.yaw);
    const s = Math.sin(t.yaw);
    return {
      w: (u: number, v: number): P => [t.x + u * c + v * s, t.z - u * s + v * c],
      ux: c, uz: -s, nx: s, nz: c,
    };
  };
  const wallBoxOf = (t: StallThing, b: Box, kind: string): WallBox => {
    const f = frame(t);
    const [cx, cz] = f.w((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2);
    return { kind, name: t.label, flat: false, cx, cz, ux: f.ux, uz: f.uz, nx: f.nx, nz: f.nz, hu: (b.u1 - b.u0) / 2, hn: (b.v1 - b.v0) / 2, y0: b.y0, y1: b.y1 };
  };
  const lowBoxes = new Map<StallThing, WallBox>();
  for (const t of stallThings) {
    const l = layers.get(t)!.low;
    if (l) lowBoxes.set(t, wallBoxOf(t, l, t.kind));
  }
  const grid = new Map<string, StallThing[]>();
  for (const t of stallThings) {
    const k = `${Math.floor(t.x / CELL)},${Math.floor(t.z / CELL)}`;
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(t);
  }
  const near = (x: number, z: number) => {
    const out: StallThing[] = [];
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${gx + i},${gz + j}`) ?? []));
    return out;
  };
  const insideOther = (self: StallThing, x: number, z: number) => {
    for (const o of near(x, z)) {
      if (o === self) continue;
      const b = lowBoxes.get(o);
      if (!b) continue;
      const dx = x - b.cx, dz = z - b.cz;
      if (Math.abs(dx * b.ux + dz * b.uz) < b.hu && Math.abs(dx * b.nx + dz * b.nz) < b.hn) return true;
    }
    return false;
  };
  const sl = world.streetLife();
  const wallItems = sl ? sl.wallItems.filter((w) => !w.flat || w.kind === "shop board" || w.kind === "board") : [];

  const seenPair = new Set<string>();
  for (const t of things) {
    const say = (problem: string) => problems.push({ kind: t.kind, label: t.label, x: +t.x.toFixed(1), z: +t.z.toFixed(1), problem });
    const { low, high } = layers.get(t)!;
    const f = frame(t);
    const back = t.wall ? 0.12 : 0.0; // a wall-hung thing's back lies on the wall
    // 1. into a house: points of each layer inside a footprint; walls through the layer
    for (const [name, b] of [["table and goods", low], ["awning", high]] as Array<[string, Box | null]>) {
      if (!b) continue;
      let worst = { d: 0, name: "" };
      for (let u = b.u0 + 0.03; u <= b.u1 - 0.03 + 1e-6; u += Math.max(0.1, (b.u1 - b.u0 - 0.06) / 12)) {
        for (let v = Math.max(b.v0, b.v0 + back) + 0.03; v <= b.v1 - 0.03 + 1e-6; v += Math.max(0.1, (b.v1 - b.v0 - 0.06) / 6)) {
          const [x, z] = f.w(u, v);
          const d = depthIn(x, z);
          if (d.d > worst.d) worst = d;
        }
      }
      if (worst.d > (t.leanTo ? 0.35 : 0.06)) say(`${name} ${worst.d.toFixed(2)} m into ${worst.name}`);
      // level rays along the layer's edges and middle, at its heights (the real walls, gateways, steps)
      const ys = [b.y0 + 0.15, (b.y0 + b.y1) / 2, b.y1 - 0.05].filter((y) => y > 0.1);
      const vs = [Math.max(b.v0, b.v0 + back + 0.05) + 0.02, (b.v0 + b.v1) / 2, b.v1 - 0.02];
      let cut = "";
      for (const y of ys) {
        for (const v of vs) {
          const [ax, az] = f.w(b.u0, v);
          const len = b.u1 - b.u0;
          const d = probe(ax, y, az, f.ux, f.uz, len);
          if (d !== null && !cut) cut = `a wall runs through the ${name} (${(b.u0 + d).toFixed(2)} m along, ${y.toFixed(2)} m up)`;
        }
        if (t.leanTo) continue;
        for (const u of [b.u0 + 0.03, (b.u0 + b.u1) / 2, b.u1 - 0.03]) {
          const v0 = Math.max(b.v0, b.v0 + back + 0.05);
          const [ax, az] = f.w(u, v0);
          const d = probe(ax, y, az, f.nx, f.nz, b.v1 - v0);
          if (d !== null && !cut) cut = `a wall runs through the ${name} (${u.toFixed(2)} m along, ${(v0 + d).toFixed(2)} m out, ${y.toFixed(2)} m up)`;
        }
      }
      if (cut) say(cut);
    }
    // 2. hung on a wall: the house behind it all along (not past a corner or the house's end), and
    //    nothing standing out of the wall there (a gateway's pier, the next house's front)
    if (t.wall) {
      for (const [name, b] of [["table", low], ["awning", high]] as Array<[string, Box | null]>) {
        if (!b) continue;
        const y = name === "table" ? 0.9 : Math.min(b.y1 - 0.1, 2.3);
        let bad = "";
        const n = Math.max(2, Math.ceil((b.u1 - b.u0) / 0.2));
        for (let i = 0; i <= n && !bad; i++) {
          const u = b.u0 + 0.02 + ((b.u1 - b.u0 - 0.04) * i) / n;
          const [bx, bz] = f.w(u, -0.25);
          if (depthIn(bx, bz).d < 0.1) bad = `no house behind the ${name} ${u.toFixed(2)} m along: it runs past the corner or the house's end`;
          const [x, z] = f.w(u, 0.5);
          const d = probe(x, y, z, -f.nx, -f.nz, 1.2);
          if (!bad && d !== null && d < 0.38) bad = `something stands out of the wall behind the ${name} (${u.toFixed(2)} m along, ${(0.5 - d).toFixed(2)} m)`;
        }
        if (bad) say(bad);
      }
    }
    if (!low) continue;
    // 3. on the walk map: the low layer on open ground
    {
      let blocked = 0;
      let all = 0;
      let water = 0;
      for (let u = low.u0 + 0.1; u <= low.u1 - 0.1 + 1e-6; u += 0.25) {
        for (let v = Math.max(low.v0, t.wall ? 0.45 : low.v0) + 0.1; v <= low.v1 - 0.1 + 1e-6; v += 0.25) {
          const [x, z] = f.w(u, v);
          const fl = flags(x, z);
          all++;
          if (fl & WALL) blocked++;
          if (fl & WATER) water++;
        }
      }
      if (water) say(`over the water on the walk map (${water} of ${all} points)`);
      if (blocked > Math.max(1, all * 0.15)) say(`on walls of the walk map (${blocked} of ${all} points)`);
    }
    // 4. in a doorway
    const lb = lowBoxes.get(t)!;
    for (const d of doors) {
      if (Math.abs(d.x - t.x) > 8 || Math.abs(d.z - t.z) > 8) continue;
      const door: WallBox = { kind: "door", name: d.label, flat: false, cx: d.x + d.ox * 0.6, cz: d.z + d.oz * 0.6, ux: -d.oz, uz: d.ox, nx: d.ox, nz: d.oz, hu: d.half + 0.1, hn: 0.6, y0: 0, y1: 2 };
      if (boxesOverlap(lb, door, 0.02)) say(`stands in the doorway of ${d.label}`);
    }
    // 5. a passage: open street before it
    {
      const need = t.front ?? 1.5;
      let worst = Infinity;
      for (const u of [low.u0 + 0.15, (low.u0 + low.u1) / 2, low.u1 - 0.15]) {
        let run = 0;
        for (let v = low.v1 + 0.1; v <= low.v1 + need + 0.05; v += 0.1) {
          const [x, z] = f.w(u, v);
          if (flags(x, z) !== 0 || insideOther(t, x, z)) break;
          run = v - low.v1;
        }
        worst = Math.min(worst, run);
      }
      if (worst < need - 0.1) say(`only ${worst.toFixed(1)} m of open ground before it (${need} m wanted): it blocks the way`);
    }
    // 6. floating or sunk: the ground at its feet
    {
      let off = 0;
      const vb = t.wall ? Math.max(low.v0, 0.4) : low.v0 + 0.05;
      for (const [u, v] of [[low.u0 + 0.05, vb], [low.u1 - 0.05, vb], [low.u0 + 0.05, low.v1 - 0.05], [low.u1 - 0.05, low.v1 - 0.05]]) {
        const [x, z] = f.w(u, v);
        const g = world.groundAt(x, z, 0, low.y0 - STEP_UP + 0.05); // (low feet: not standing on the thing's own collider)
        if (Math.abs(g - low.y0) > 1.5) continue; // a floor inside a house, not the street
        if (Math.abs(g - low.y0) > Math.abs(off)) off = g - low.y0;
      }
      if (off < -0.08) say(`floats ${(-off).toFixed(2)} m over the ground at a corner`);
      else if (off > 0.12) say(`sunk ${off.toFixed(2)} m into the ground at a corner`);
    }
    // 7. overlaps: other stall things; signs and awnings on the wall
    for (const o of near(t.x, t.z)) {
      if (o === t) continue;
      const ob = lowBoxes.get(o);
      if (!ob || !boxesOverlap(lb, ob, 0.03)) continue;
      const key = [t.label, o.label].sort().join("/");
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      say(`overlaps ${o.kind} ${o.label}`);
    }
    if (t.wall) {
      for (const b of [low, high]) {
        if (!b) continue;
        const wb = wallBoxOf(t, b, t.kind);
        for (const w of wallItems) {
          if (Math.abs(w.cx - t.x) > 6 || Math.abs(w.cz - t.z) > 6) continue;
          // a street life awning slopes down from the wall (its box's top at the wall, its bottom at the front edge):
          // what stands under it clears it if it stays under its underside where it reaches out to
          if (w.kind === "awning" && b.y1 < w.y1 - ((w.y1 - w.y0) * Math.min(b.v1 + 0.15, 2 * w.hn)) / (2 * w.hn) - 0.05) continue;
          if (boxesOverlap(wb, w, 0.02)) {
            say(`overlaps the ${w.kind} ${w.name} on the wall`);
            break;
          }
        }
      }
    }
  }
  const byProblem: Record<string, number> = {};
  for (const p of problems) {
    const k = `${p.kind}: ${p.problem.replace(/ \(.*$/, "").replace(/[0-9.]+ m/g, "N m").replace(/(into|of|overlaps( the)?) .*$/, "$1 ...")}`;
    byProblem[k] = (byProblem[k] ?? 0) + 1;
  }
  const byKind: Record<string, number> = {};
  for (const t of things) byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
  return { things: things.length, byKind, problems: problems.length, byProblem, list: problems, ms: Math.round(performance.now() - t0) };
}

/** Every door of the town for the doorway test: the houses' front doors, the game's own doors, the town's shops, taverns and homes. */
export function allDoors(town: { shops: Array<{ label: string; wall: P; out: P }>; residents: Array<{ home: { x: number; z: number; sx: number; sz: number } }> } | null): Door[] {
  const out: Door[] = [];
  const doorsC = (CITY as unknown as { doors: Record<string, { x: number; z: number; out: P; width: number }> }).doors;
  for (const [k, d] of Object.entries(doorsC)) if (d.width < 12) out.push({ x: d.x, z: d.z, ox: d.out[0], oz: d.out[1], half: d.width / 2, label: k });
  const seen = new Set<string>();
  const add = (x: number, z: number, sx: number, sz: number, label: string) => {
    const k = `${x.toFixed(1)},${z.toFixed(1)}`;
    if (seen.has(k)) return;
    seen.add(k);
    const L = Math.hypot(sx - x, sz - z) || 1;
    out.push({ x, z, ox: (sx - x) / L, oz: (sz - z) / L, half: 0.55, label });
  };
  for (const s of town?.shops ?? []) add(s.wall[0], s.wall[1], s.wall[0] + s.out[0], s.wall[1] + s.out[1], s.label);
  for (const r of town?.residents ?? []) add(r.home.x, r.home.z, r.home.sx, r.home.sz, `the house door at ${r.home.x.toFixed(0)}, ${r.home.z.toFixed(0)}`);
  return out;
}
