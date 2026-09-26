import * as THREE from "three";
import BUILD from "../../../shared/city_build.json";
import CITY from "../../../shared/city.json";
import GABLES from "../../../shared/city_gable_windows.json";
import INWORLD from "../../../shared/inworld_houses.json";
import { AI_BILL, blankRuns, districtOf, houseWalls, type BuildData, type District, type PosterWall } from "../../../shared/posterWalls";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { buildPosterAtlas, DESIGNS, SHAPE_M, type Atlas, type Cell, type Pool, type State } from "./posterArt";
import { buildFacadeProbe, paintUnder } from "./facadeProbe";
import type { StreetLife } from "./streetlife";
import { boxesOverlap, buildWallProbe, signOnWall, wallBox, type WallBox } from "./wallprobe";

// The bills on the town's walls (M7 posters, Steve 2026-09-26: "posters are also over windows and even a
// poster over a passage where we can walk through, so the poster mechanic needs more work and more
// variation depending on where in city they are"). This module puts up every printed bill of the town
// (street life and the clutter no longer paste their own): the engine's bills (game/ideas.ts) keep their
// places (the server's spots, /api/posters/spots), reserved here first.
//
// Where: only on plain wall. Every house wall that is open to the street or the air (shared/posterWalls.ts,
// as the Blender city builder lays it out), in the stretches clear of its windows, doorway, shop windows,
// the alley cottages' windows, the painted windows of the backs on the yards and the mouths of the covered
// passages; then street life's test (world/streetlife.ts clearOnWall): flat on the wall as built (rays
// against city.glb: no corner, no gap between houses, no archway, no door surround, nothing standing out,
// not sunk into the wall), clear of every sign, plate, number, bracket, awning and Madonna; the house there
// on the walk map and the street open before it; no door lantern, no rain butt or barrel right in front.
// No church, landmark or in-world house wall. The dev check (dev/postercheck.ts, __scheldemist.posters())
// tests them all again and must list nothing.
//
// What and how many: by the part of town (shared/posterWalls.ts districtOf): the quays sailings, sales and
// hands wanted; the fine squares few, neat and fresh (theatre, concerts, the Zoo, notary sales, the town's
// notices); the poor lanes many, layered, torn and faded, with scraps and glue marks; by a church the
// parish's notices; by the prison and the police wanted and reward bills. One atlas (world/posterArt.ts),
// one material, merged per 128 m chunk.

type Flags = (x: number, z: number) => number | undefined;
const WALL = 1;
const CHUNK = 128;
/** How far off the wall a bill's face is (the material's polygonOffset settles the rest). */
const OFF = 0.012;

export interface PosterItem {
  /** "bill", "stack", "scrap", "glue". */
  what: string;
  key: string;
  state: State | "";
  district: District;
  box: WallBox;
  wall: number;
}

export interface AiSpot {
  id: string;
  label: string;
  x: number;
  z: number;
  out: [number, number];
  at: [number, number];
}

export interface Posters {
  group: THREE.Group;
  items: PosterItem[];
  /** The engine's bills' places, as boxes (reserved: nothing of the town's goes over them). */
  aiSpots: Array<{ spot: AiSpot; box: WallBox }>;
  walls: PosterWall[];
  stats: { byDistrict: Record<string, number>; byWhat: Record<string, number>; byState: Record<string, number>; rejected: Record<string, number>; walls: Record<string, number>; tried: number; meshes: number; ms: number; facade: boolean };
}

export interface PosterOptions {
  streetLife: StreetLife;
  /** The houses as built (city.glb): a bill never goes over a painted window (world/facadeProbe.ts). */
  city?: THREE.Object3D;
  /** Things standing on the ground (colliders): a bill is not pasted right behind one. */
  avoid?: Rect[];
  seed?: number;
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Let a frame through (a message, not a timer: a hidden tab throttles timers to one a minute). */
const breathe = () =>
  new Promise<void>((r) => {
    const c = new MessageChannel();
    c.port1.onmessage = () => r();
    c.port2.postMessage(0);
  });

/** The box of a flat thing w x h on wall w at s along it, from y0 up, `off` out of it. */
export function billBox(kind: string, name: string, w: PosterWall, s: number, y0: number, bw: number, bh: number, off = OFF): WallBox {
  const hn = off / 2 + 0.002;
  return {
    kind, name, flat: true,
    cx: w.ax + w.tx * s + w.ox * hn,
    cz: w.az + w.tz * s + w.oz * hn,
    ux: w.tx, uz: w.tz, nx: w.ox, nz: w.oz,
    hu: bw / 2, hn, y0, y1: y0 + bh,
  };
}

/** The engine's bill at a server spot, as a box (the same size and height as game/ideas.ts draws it). */
export function aiSpotBox(p: AiSpot): WallBox {
  const hn = OFF / 2 + 0.002;
  return {
    kind: "poster", name: `bill ${p.id}`, flat: true,
    cx: p.x + p.out[0] * hn, cz: p.z + p.out[1] * hn,
    ux: -p.out[1], uz: p.out[0], nx: p.out[0], nz: p.out[1],
    hu: AI_BILL.w / 2, hn, y0: AI_BILL.y - AI_BILL.h / 2, y1: AI_BILL.y + AI_BILL.h / 2,
  };
}

/** The server's spots for its bills (null: not reachable now). */
export async function fetchAiSpots(): Promise<AiSpot[] | null> {
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch("/api/posters/spots", { signal: AbortSignal.timeout(5000) });
      if (r.ok) return ((await r.json()) as { spots: AiSpot[] }).spots;
    } catch {
      /* the server may be starting */
    }
    await sleep(1500);
  }
  return null;
}

/**
 * What and how much, by the part of town. `p`: a front's chance of bills on its piers, `max` how many there;
 * `blank`: a blank wall's (a blind side wall, a long plain stretch) chance of being pasted up, `fill` how much of
 * its length, `gap` the space between two bills there, `stack` a layered stack's share of them.
 */
interface Plan {
  p: number;
  max: number;
  blank: number;
  fill: number;
  gap: [number, number];
  pools: Array<[Pool, number]>;
  states: [number, number, number];
  stack: number;
  scraps: number;
  tilt: number;
}
const PLAN: Record<District, Plan> = {
  // the fine squares: few, full-size, fresh, level, well apart
  fine: { p: 0.8, max: 1, blank: 0.7, fill: 0.3, gap: [0.8, 1.6], pools: [["fine", 1]], states: [0.85, 0.15, 0], stack: 0, scraps: 0, tilt: 0.003 },
  // the quays and the poor lanes: dense, side by side and over each other, torn
  quay: { p: 0.5, max: 3, blank: 0.9, fill: 0.8, gap: [0.06, 0.16], pools: [["quay", 0.85], ["poor", 0.15]], states: [0.4, 0.4, 0.2], stack: 0.3, scraps: 0.4, tilt: 0.015 },
  poor: { p: 0.75, max: 5, blank: 0.95, fill: 0.9, gap: [0.06, 0.12], pools: [["poor", 0.85], ["police", 0.15]], states: [0.12, 0.38, 0.5], stack: 0.4, scraps: 0.7, tilt: 0.03 },
  middle: { p: 0.3, max: 2, blank: 0.65, fill: 0.5, gap: [0.08, 0.35], pools: [["poor", 0.4], ["quay", 0.2], ["fine", 0.25], ["church", 0.15]], states: [0.35, 0.45, 0.2], stack: 0.2, scraps: 0.3, tilt: 0.015 },
  church: { p: 0.75, max: 3, blank: 0.7, fill: 0.35, gap: [0.3, 0.8], pools: [["church", 0.8], ["fine", 0.2]], states: [0.6, 0.35, 0.05], stack: 0.05, scraps: 0.05, tilt: 0.006 },
  police: { p: 0.65, max: 3, blank: 0.85, fill: 0.6, gap: [0.08, 0.3], pools: [["police", 0.85], ["poor", 0.15]], states: [0.5, 0.35, 0.15], stack: 0.2, scraps: 0.2, tilt: 0.01 },
};
/** A blank stretch this long or longer is pasted up as a hoarding; a shorter one (a pier) takes a bill or two. */
const HOARDING_M = 1.6;

const pickW = <T,>(r: () => number, xs: Array<[T, number]>): T => {
  const sum = xs.reduce((s, [, w]) => s + w, 0);
  let k = r() * sum;
  for (const [x, w] of xs) if ((k -= w) <= 0) return x;
  return xs[xs.length - 1][0];
};

export async function createPosters(scene: THREE.Scene, flags: Flags, opts: PosterOptions): Promise<Posters> {
  const t0 = performance.now();
  const stats0 = { facade: false };
  const sl = opts.streetLife;
  const seed = opts.seed ?? 1873;
  const atlas: Atlas = await buildPosterAtlas(seed);
  const inWorld = (INWORLD as { houses: Array<{ house: number }> }).houses.map((h) => h.house);
  const walls = houseWalls(BUILD as unknown as BuildData, inWorld);
  const lamps = ((GABLES as unknown as { lamps?: number[][] }).lamps ?? []).map(([x, y, z]) => [x, y, z]);
  const poorts = ((CITY as unknown as { poorts?: number[][][] }).poorts ?? []).map((p) => {
    const xs = p.map((q) => q[0]);
    const zs = p.map((q) => q[1]);
    return { minX: Math.min(...xs) - 1, maxX: Math.max(...xs) + 1, minZ: Math.min(...zs) - 1, maxZ: Math.max(...zs) + 1 };
  });
  const at = (x: number, z: number) => flags(x, z) ?? WALL;
  const facade = opts.city ? buildFacadeProbe(opts.city) : null;
  const wallProbe = opts.city ? buildWallProbe(opts.city) : null;
  stats0.facade = !!facade;

  // the ground things, in a grid: nothing pasted right behind a barrel or a rain butt
  const AG = 8;
  const avoidGrid = new Map<string, Rect[]>();
  for (const a of opts.avoid ?? []) {
    if (a.maxX - a.minX > 40 || a.maxZ - a.minZ > 40) continue; // (the big keep-out areas are not things)
    for (let gx = Math.floor(a.minX / AG); gx <= Math.floor(a.maxX / AG); gx++)
      for (let gz = Math.floor(a.minZ / AG); gz <= Math.floor(a.maxZ / AG); gz++) {
        const k = `${gx},${gz}`;
        let l = avoidGrid.get(k);
        if (!l) avoidGrid.set(k, (l = []));
        l.push(a);
      }
  }
  // (a low thing, a crate or a bench under the bill, may stand there: its top under the bill's foot)
  const blocked = (x: number, z: number, y0: number) =>
    (avoidGrid.get(`${Math.floor(x / AG)},${Math.floor(z / AG)}`) ?? []).some((a) => (a.top ?? 99) > y0 - 0.05 && x > a.minX - 0.05 && x < a.maxX + 0.05 && z > a.minZ - 0.05 && z < a.maxZ + 0.05);

  /** Why not here (null: fine): the walk map, lanterns, passages, things in front, then street life's test. */
  const why = (w: PosterWall, b: WallBox): string | null => {
    const s = (b.cx - w.ax) * w.tx + (b.cz - w.az) * w.tz;
    const hu = b.hu;
    for (const e of [-hu, 0, hu]) {
      const x = w.ax + w.tx * (s + e);
      const z = w.az + w.tz * (s + e);
      if (!(at(x - w.ox * 0.3, z - w.oz * 0.3) & WALL)) return "no house behind";
      for (const d of [0.45, 0.9]) if (at(x + w.ox * d, z + w.oz * d) !== 0) return "no open street before it";
      for (const d of [0.3, 0.65]) if (blocked(x + w.ox * d, z + w.oz * d, b.y0)) return "something stands before it";
    }
    const mx = w.ax + w.tx * s, mz = w.az + w.tz * s;
    if (poorts.some((p) => mx > p.minX && mx < p.maxX && mz > p.minZ && mz < p.maxZ)) return "by a passage";
    if (lamps.some(([lx, ly, lz]) => Math.hypot(lx - mx, lz - mz) < hu + 0.35 && b.y1 > ly - 0.7)) return "a door lantern";
    const clear = sl.clearOnWall(b);
    if (clear) return clear;
    // (street life tests only its street fronts against the houses as built: every wall here)
    if (wallProbe) {
      const off = signOnWall(b, wallProbe);
      if (off) return off;
    }
    if (shopSigns.some((o) => Math.abs(o.cx - b.cx) < 4 && Math.abs(o.cz - b.cz) < 4 && boxesOverlap(b, o, -0.04))) return "a shop's sign";
    // the paint on the wall as built: a window, a lintel, a sill, a plinth the plan does not list
    if (facade && paintUnder(facade, b, 0.04, 0.14).painted > 0) return "over paint (a window, a sill)";
    return null;
  };

  // the shops' boards and brackets hung up since street life was placed (world/shopSigns.ts, tagged userData.wallSign)
  const shopSigns: WallBox[] = [];
  scene.traverse((o) => {
    const ws = o.userData.wallSign as { kind: string; name: string; flat: boolean } | undefined;
    const g = (o as THREE.Mesh).geometry;
    if (!ws || !g) return;
    o.updateWorldMatrix(true, false);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const nrm = new THREE.Vector3(0, 0, 1).transformDirection(o.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    shopSigns.push(wallBox(ws.kind, ws.name, ws.flat, [bb.min.x, bb.min.y, Math.min(bb.min.z, -0.005), bb.max.x, bb.max.y, Math.max(bb.max.z, 0.005)], p.x, p.y, p.z, Math.atan2(nrm.x, nrm.z)));
  });

  // the engine's bills first: their places are kept
  const aiSpots: Posters["aiSpots"] = [];
  for (const spot of (await fetchAiSpots()) ?? []) {
    const box = aiSpotBox(spot);
    aiSpots.push({ spot, box });
    sl.addWallItem(box);
  }

  // the street's width before a wall, and the water near
  const across = (x: number, z: number, ox: number, oz: number, max = 30): number => {
    for (let d = 0.5; d < max; d += 0.5) if (at(x + ox * d, z + oz * d) & WALL) return d;
    return max;
  };
  const wetOut = (x: number, z: number, ox: number, oz: number): boolean => {
    for (let d = 1; d < 30; d += 1) {
      const f = at(x + ox * d, z + oz * d);
      if (f & 2) return true;
      if (f & WALL) return false;
    }
    return false;
  };

  // the quay edges (city.json quays: segments)
  const quaySegs = (CITY as unknown as { quays?: number[][] }).quays ?? [];
  const quayDist = (x: number, z: number): number => {
    let best = Infinity;
    for (const [ax, az, bx, bz] of quaySegs) {
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
    return best;
  };

  const items: PosterItem[] = [];
  const quads: Array<{ cell: Cell; w: PosterWall; s: number; y0: number; bw: number; bh: number; off: number; tilt: number; shade: number }> = [];
  const stats: Posters["stats"] = { byDistrict: {}, byWhat: {}, byState: {}, rejected: {}, walls: {}, tried: 0, meshes: 0, ms: 0, facade: stats0.facade };
  const byPool = (pool: Pool) => DESIGNS.filter((d) => (d.pools[pool] ?? 0) > 0).map((d) => [d, d.pools[pool]!] as [typeof d, number]);

  const put = (w: PosterWall, district: District, what: string, key: string, state: State | "", cell: Cell | undefined, s: number, y0: number, bw: number, bh: number, tilt: number, shade: number, off = OFF): boolean => {
    if (!cell) return false; // (not in the atlas)
    stats.tried++;
    const b = billBox("poster", `${what} ${key}`, w, s, y0, bw, bh, off);
    // (a crooked bill: its corners reach a little further)
    const k = Math.abs(tilt);
    b.hu += (bh / 2) * k;
    b.y0 -= (bw / 2) * k;
    b.y1 += (bw / 2) * k;
    const no = why(w, b);
    if (no) {
      const k = `${district}: ${no.replace(/ \(.*$/, "").replace(/ by [0-9.]+ m/, "")}`;
      stats.rejected[k] = (stats.rejected[k] ?? 0) + 1;
      return false;
    }
    sl.addWallItem(b);
    items.push({ what, key, state, district, box: b, wall: w.id });
    quads.push({ cell, w, s, y0, bw, bh, off, tilt, shade });
    stats.byDistrict[district] = (stats.byDistrict[district] ?? 0) + 1;
    stats.byWhat[what] = (stats.byWhat[what] ?? 0) + 1;
    if (state) stats.byState[state] = (stats.byState[state] ?? 0) + 1;
    return true;
  };

  let n = 0;
  for (const w of walls) {
    if (++n % 200 === 0) await breathe();
    if (w.inWorld) continue;
    const r = rng(seed * 7 + w.house * 131 + w.id * 17);
    const mx = w.ax + w.tx * w.L * 0.5, mz = w.az + w.tz * w.L * 0.5;
    const width = across(mx + w.ox * 0.3, mz + w.oz * 0.3, w.ox, w.oz);
    const district = districtOf(mx, mz, { wall: w, width, water: wetOut(mx, mz, w.ox, w.oz), quay: quayDist(mx, mz) });
    const plan = PLAN[district];
    stats.walls[district] = (stats.walls[district] ?? 0) + 1;
    const stackPool = district === "middle" || district === "fine" ? "poor" : district;
    const stacksHere = atlas.stacks.filter((st) => st.pool === stackPool);
    const pickState = () => pickW<State>(r, [["fresh", plan.states[0]], ["faded", plan.states[1]], ["ragged", plan.states[2]]]);
    /** Scraps and glue marks by a bill at s (what is left of the bills pasted there before). */
    const scrapsBy = (s: number, hw: number, n: number) => {
      for (let k = 0, done = 0; k < n * 3 && done < n; k++) {
        const glue = r() < 0.4;
        const c = glue ? atlas.glue[Math.floor(r() * atlas.glue.length)] : atlas.scraps[Math.floor(r() * atlas.scraps.length)];
        const y0 = 0.6 + r() * 1.3;
        const ns = s + (r() < 0.5 ? -1 : 1) * (hw + 0.04 + r() * 0.3 + c.w / 2);
        if (!blankRuns(w, c.w / 2, y0, y0 + c.h, 0.1, 0.25).some(([a, b]) => ns >= a && ns <= b)) continue;
        if (put(w, district, glue ? "glue" : "scrap", c.key, "", atlas.cells.get(c.key), ns, y0, c.w, c.h, (r() - 0.5) * 0.2, 0.8 + r() * 0.2, glue ? OFF * 0.6 : OFF)) done++;
      }
    };

    // ---- the blank stretches: a blind side wall, a bared party wall, a long plain part of a front
    // (Steve, 2026-09-26: "make the posters bigger, and put more of them on big blank walls")
    const hoardings = blankRuns(w, 0, 0.7, 2.75, 0.12, 0.3).filter(([a, b]) => b - a >= HOARDING_M);
    let pasted = 0;
    if (hoardings.length && r() < plan.blank) {
      // (a blind wall takes the big sheets larger still: up to a quad crown, about 1 x 1.4 m)
      const blind = w.windows === "none";
      const neat = district === "fine" || district === "church";
      // the rows: one at eye height; on a blind wall in the lanes and on the quays a second above it
      // (a bill sticker's ladder: the old hoardings were pasted two sheets high)
      const rows: Array<{ foot: number; top: number; fill: number }> = [{ foot: neat ? 1.0 + r() * 0.1 : 0.75 + r() * 0.2, top: 2.75, fill: plan.fill }];
      if (blind && !neat && r() < (district === "middle" ? 0.6 : 0.9)) rows.push({ foot: 0, top: 3.35, fill: plan.fill * 0.75 });
      let rowTop = 0;
      for (const [ri, rw] of rows.entries()) {
        if (ri > 0) {
          if (rowTop <= 0 || rowTop + 0.12 + 0.6 > rw.top) break;
          rw.foot = rowTop + 0.1;
        }
        const band = ri === 0 ? hoardings : blankRuns(w, 0, rw.foot, rw.top, 0.12, 0.3).filter(([a, b]) => b - a >= HOARDING_M);
        for (const [h0, h1] of band) {
          // how much of it is pasted over: a stretch or two, the rest bare wall
          const len = h1 - h0;
          let want = len * rw.fill * (0.75 + r() * 0.5);
          let s = h0 + (district === "fine" ? len * (0.15 + r() * 0.3) : r() * Math.max(0, len - want));
          let fails = 0;
          let lastS = -1, lastHw = 0;
          while (s < h1 - 0.3 && want > 0.25 && fails < 6 && pasted < 22) {
            // a stack of old bills over each other, or one sheet
            let key: string, state: State, bw: number, bh: number, what: string;
            const st = ri === 0 && stacksHere.length && r() < plan.stack ? stacksHere[Math.floor(r() * stacksHere.length)] : null;
            if (st) {
              what = "stack";
              key = st.key;
              state = "ragged";
              bw = st.w;
              bh = st.h;
            } else {
              const pool = pickW(r, plan.pools);
              const cand = byPool(pool).map(([d, wt]) => [d, wt * (d.shape === "small" ? (neat ? 0 : 0.08) : d.shape === "big" ? 3 : 1)] as [(typeof DESIGNS)[number], number]);
              if (!cand.length) break;
              const d = pickW(r, cand);
              const k = blind ? 1.04 + r() * 0.08 : 1;
              bw = SHAPE_M[d.shape][0] * k;
              bh = SHAPE_M[d.shape][1] * k;
              what = "bill";
              key = d.key;
              state = pickState();
            }
            const foot = Math.max(0.65, Math.min(rw.foot + (neat ? 0 : (r() - 0.3) * 0.12), rw.top - bh));
            if (foot + bh > rw.top + 0.001) {
              fails++;
              continue;
            }
            const tilt = (r() - 0.5) * 2 * plan.tilt;
            const reach = bw + Math.abs(tilt) * bh;
            if (s + reach > h1 + 0.001) {
              fails++;
              s += 0.2;
              continue;
            }
            const mid = s + reach / 2;
            if (put(w, district, what, key, state, atlas.cells.get(what === "stack" ? key : `${key}:${state}`), mid, foot, bw, bh, tilt, 0.82 + r() * 0.18)) {
              pasted++;
              want -= bw;
              lastS = mid;
              lastHw = reach / 2;
              rowTop = Math.max(rowTop, foot + bh + Math.abs(tilt) * bw);
              s += reach + plan.gap[0] + r() * (plan.gap[1] - plan.gap[0]);
            } else {
              fails++;
              s += 0.25;
            }
          }
          if (ri === 0 && lastS >= 0 && r() < plan.scraps) scrapsBy(lastS, lastHw, 1 + Math.floor(r() * (district === "poor" ? 4 : 2)));
        }
      }
    }
    if (pasted || r() > plan.p) continue;

    // ---- a front's piers: a bill or two where they fit, side by side
    const count = 1 + Math.floor(r() * plan.max);
    let placed = 0;
    let last: { s: number; hw: number } | null = null;
    // the widest plain stretch at a bill's height: only bills that fit there (a pier between two windows takes a small one)
    const free = Math.max(0, ...blankRuns(w, 0, 0.8, 2.1, 0.12, 0.3).map(([a, b]) => b - a));
    for (let k = 0; k < count * 5 && placed < count; k++) {
      const pool = pickW(r, plan.pools);
      // (a sheet a little narrower than its shape to fit a pier: the printer's half sheets; never under 0.75 of it)
      const fit = (d: (typeof DESIGNS)[number]) => Math.min(1, (free - 0.01) / SHAPE_M[d.shape][0]);
      const cand = byPool(pool).filter(([d]) => fit(d) >= 0.75);
      if (!cand.length) continue;
      const d = pickW(r, cand);
      const kf = fit(d);
      const bw = SHAPE_M[d.shape][0] * kf, bh = SHAPE_M[d.shape][1] * kf;
      const state = pickState();
      // pasted at a hand's reach: the foot 0.8 to 1.1 m up (a small bill higher), the fine squares level
      const y0 = district === "fine" ? (d.shape === "small" ? 1.3 : 1.05) : (d.shape === "small" ? 1.25 : d.shape === "big" ? 0.75 : 0.85) + r() * 0.25;
      const runs = blankRuns(w, bw / 2, y0, y0 + bh, 0.12, 0.3).filter(([a, b]) => b >= a);
      if (!runs.length) continue;
      const [r0, r1] = runs[Math.floor(r() * runs.length)];
      let s = r0 + (r1 - r0) * r();
      // (a bill sticker pastes his bills side by side: next to the last one, if that stretch has room)
      if (last && district !== "fine" && district !== "church") {
        const ns = last.s + (r() < 0.5 ? -1 : 1) * (last.hw + 0.06 + r() * 0.08 + bw / 2);
        if (runs.some(([a, b]) => ns >= a && ns <= b)) s = ns;
      }
      const tilt = (r() - 0.5) * 2 * plan.tilt;
      if (put(w, district, "bill", d.key, state, atlas.cells.get(`${d.key}:${state}`), s, y0, bw, bh, tilt, 0.82 + r() * 0.18)) {
        placed++;
        last = { s, hw: bw / 2 + Math.abs(tilt) * bh };
      }
    }
    if (last && r() < plan.scraps) scrapsBy(last.s, last.hw, 1 + Math.floor(r() * (district === "poor" ? 3 : 1)));
  }

  // ---- the mesh: one material, merged per chunk
  const mat = psx(
    new THREE.MeshLambertMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }),
    { affine: 0 },
  );
  mat.name = "posters";
  const buckets = new Map<string, { pos: number[]; nor: number[]; uv: number[]; col: number[] }>();
  for (const q of quads) {
    const cx = q.w.ax + q.w.tx * q.s, cz = q.w.az + q.w.tz * q.s;
    const key = `${Math.floor(cx / CHUNK)},${Math.floor(cz / CHUNK)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { pos: [], nor: [], uv: [], col: [] }));
    const [u0, v0, u1, v1] = q.cell;
    const c = Math.cos(q.tilt), sn = Math.sin(q.tilt);
    const ym = q.y0 + q.bh / 2;
    const corner = (lu: number, lv: number, uu: number, vv: number) => {
      // turned by tilt in the wall's plane round the bill's middle
      const du = lu * c - lv * sn;
      const dv = lu * sn + lv * c;
      b!.pos.push(cx + q.w.tx * du + q.w.ox * q.off, ym + dv, cz + q.w.tz * du + q.w.oz * q.off);
      b!.nor.push(q.w.ox, 0, q.w.oz);
      b!.uv.push(uu, vv);
      b!.col.push(q.shade, q.shade * 0.99, q.shade * 0.96);
    };
    const hw = q.bw / 2, hh = q.bh / 2;
    // two triangles, facing out of the wall (u along the wall runs to the viewer's right)
    // (seen from the street the wall's direction runs to the right or the left: the corners go so that the
    // face looks out and the picture's left is on the viewer's left)
    const right = -q.w.tz * q.w.ox + q.w.tx * q.w.oz > 0;
    const [ua, ub] = [u0, u1];
    const f = right ? 1 : -1;
    corner(-hw * f, -hh, ua, v0);
    corner(hw * f, -hh, ub, v0);
    corner(hw * f, hh, ub, v1);
    corner(-hw * f, -hh, ua, v0);
    corner(hw * f, hh, ub, v1);
    corner(-hw * f, hh, ua, v1);
  }
  const group = new THREE.Group();
  group.name = "posters";
  for (const [key, b] of buckets) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = `posters_${key}`;
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  scene.add(group);
  stats.meshes = group.children.length;
  stats.ms = Math.round(performance.now() - t0);
  return { group, items, aiSpots, walls, stats };
}
