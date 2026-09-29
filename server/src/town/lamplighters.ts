import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { TRADES } from "./places.ts";
import { tidy, type Resident } from "./population.ts";
import { DAWN_LAST, DAWN_START, DUSK_LAST, DUSK_SLOTS, DUSK_STAGGER_H, DUSK_START, type LampHelp, type LampRound, type RoundLamp, type RPt } from "./lampround.ts";
import { worldClock } from "../mp/worldClock.ts";
import type { Seg } from "./schedule.ts";
import { dropTownCache, town } from "./store.ts";
import { walkMap } from "./walkmap.ts";
import { wallLamps } from "./wallDressing.ts";
import { isWallLamp } from "../../../shared/wallLamps.ts";

// The lamplighters (M6 town life, Steve 2026-09-24: "the lamplighter"). Antwerp's gas lamps
// were lit by hand: at dusk a lamplighter walked his round with a long pole and a ladder over
// his shoulder, lamp to lamp, and at dawn he walked it again to put them out. Here three
// lamplighters share the town's 72 gas lamps (the six of the Rijnkaai quay and the 66 of the
// city; M7 lamps, 2026-09-25: a third round for the market quarter), each on a real path over
// the walk map: the west old town by the river, the Grote Markt with the Handschoenmarkt and the
// cathedral quarter, and the east quays. The rounds, the times and the order are the ENGINE's
// (lampround.ts); the client lights each lamp when he reaches it.
//
// Save migration (ensureLamplighters): an older save keeps every resident, memory and
// relationship. Whoever walked a round before keeps it; the town's other lamplighters take the
// rounds left; a round with nobody yet goes to a man of the town who changes his trade (a docker
// or a porter, living nearest the round's start): his name, family, home, stats and memories
// stay. No new house is taken (the homes helper rents houses out). Runs once per version
// (world_state 'townlife_lamps').

/** The six gas lamps of the Rijnkaai quay (world/rijnkaai.ts lampSpots, where they stand as built). */
export const QUAY_LAMPS: RPt[] = [
  [-48, 2.2],
  [-30, 2.2],
  [-10, 20.4],
  [4, 2.2],
  [24, 2.2],
  [44, 19.8],
];
/**
 * 4: the Oostershuis lamp moved off the gate to the pier beside it (M7 doors, 2026-09-25): its stand with it.
 * 5: M7 lamps (2026-09-25): 34 new lamps (the Grote Markt, the Handschoenmarkt, the cathedral quarter, the
 * lock bridge, main streets); d22 and d23 out of the town hall's walls, d26 and d27 out of the canal.
 * 6 to 9: M7 lamps, a third lamplighter (2026-09-25, tuned the same day; each step rebuilt a save's rounds):
 * three rounds (west, market, east) that a lamplighter Jef follows can finish in the dusk window at a walk;
 * the windows longer (lampround.ts); each tour tightened with the walked lengths and walked the way that
 * crosses its opening bridges earlier; the lamplighter's day until full dark and full day.
 */
// 10: M7 prison and squares, the Sint-Jansplein's four lamps d66..d69.
// 11: issue #14 (2026-09-29): the town wall's 65 lamps on five rounds of their own, five more lamplighters; a lamp the
// way passes is lit on the way (the market round lit d43 before d42, walking past it).
export const LAMPS_VERSION = 11;
const STATE_KEY = "townlife_lamps";

export interface LampRounds {
  v: number;
  rounds: LampRound[];
}

/**
 * Every gas lamp of the town with its id: the quay's, the city's (city.json decor.lamps) and the town wall's (issue
 * #14: the walk's lamps and the lanterns of the guard houses and gates, from wall.glb's dressing, numbered by
 * shared/wallLamps.ts as the client numbers them). `hung`: a lantern on a wall or a bracket, no post on the ground.
 */
export function allLamps(): Array<{ id: string; x: number; z: number; hung?: true }> {
  const decor = ((CITY as unknown as { decor?: { lamps?: RPt[] } }).decor?.lamps ?? []) as RPt[];
  return [
    ...QUAY_LAMPS.map(([x, z], i) => ({ id: `q${i}`, x, z })),
    ...decor.map(([x, z], i) => ({ id: `d${i}`, x, z })),
    ...wallLamps().map((l) => (l.kind === "lantern" ? { id: l.id, x: l.x, z: l.z, hung: true as const } : { id: l.id, x: l.x, z: l.z })),
  ];
}

/**
 * The rounds (M7 lamps, 2026-09-25; the town wall's since issue #14), in this order in the save. `start`: where the
 * round's lamplighter is sought when the town has none to spare (the man living nearest changes his trade).
 */
export const ROUNDS: ReadonlyArray<{ id: RoundId; label: string; start: RPt }> = [
  { id: "west", label: "the west old town: the Werf, the Steenplein, the quay road to the Rijnkaai", start: [-300, 12] },
  { id: "market", label: "the Grote Markt, the Handschoenmarkt and the cathedral quarter", start: [-250, 100] },
  { id: "east", label: "the east quays: the Rijnkaai, the lock and the basins", start: [-20, 40] },
  // M7 prison and squares (LAMPS_VERSION 10): the Sint-Jansplein's lamps lie far up the angled streets; a fourth man
  // takes them with the canal's quays and the street west of the Vleeshuis quarter on his way there
  { id: "north", label: "the canal's quays and the angled streets up to the Sint-Jansplein", start: [-80, 150] },
  // The town wall (issue #14, LAMPS_VERSION 11; Steve 2026-09-29: "lamp lighter can do it, maybe more lighters
  // needed"): the 34 lamps of the walk and the 31 lanterns of the guard houses and gates, five more men. The walk on
  // top is cut at each gate (the gate houses stand across it) and the stair by a gate climbs from its far side, so a
  // round begins at a gate in the street, climbs that stair and walks the top to the next gate's near side; the first
  // takes the stretch from the river to the Rode Poort with that gate, the second the long walk after it. At a walk,
  // followed from the first lamp: about 230, 250, 165, 340 and 180 s.
  { id: "wall_rode", label: "the town wall from the river to the Rode Poort, and the gate", start: [200, 60] },
  { id: "wall_north", label: "the wall walk from the Rode Poort round the north-east bastion to the Keizerspoort", start: [185, 290] },
  { id: "wall_keizer", label: "the Keizerspoort and the wall walk on to the Kipdorppoort", start: [30, 335] },
  { id: "wall_kipdorp", label: "the Kipdorppoort and the wall walk round the south-east bastion to the Sint-Jorispoort", start: [-200, 330] },
  { id: "wall_joris", label: "the Sint-Jorispoort and the wall walk down to the river", start: [-335, 110] },
];
export type RoundId = "west" | "market" | "east" | "north" | "wall_rode" | "wall_north" | "wall_keizer" | "wall_kipdorp" | "wall_joris";
/** The town wall's rounds (their lamps are walked along the wall, lampround.ts inOrder). */
export const isWallRound = (id: string) => id.startsWith("wall_");

/**
 * Which wall round a wall lamp is on, by where it lies along the wall (wallS): from the river to just past the Rode
 * Poort's lamps; from there to just before the Keizerspoort's; from the Keizerspoort to just before the
 * Kipdorppoort's; from the Kipdorppoort to just before the Sint-Jorispoort's; from the Sint-Jorispoort to the river.
 */
function wallRoundOf(x: number, z: number): RoundId {
  const gateS = (id: string) => {
    const g = RAMPART?.gates.find((q) => q.id === id);
    return g ? wallS((g.posts[0][0] + g.posts[1][0]) / 2, (g.posts[0][1] + g.posts[1][1]) / 2) : Infinity;
  };
  const s = wallS(x, z);
  // (a gate's own lamps lie within about 5 m of it along the wall; its neighbours on the walk 15 m or more)
  if (s < gateS("rode_poort") + 12) return "wall_rode";
  if (s < gateS("keizerspoort") - 9) return "wall_north";
  if (s < gateS("kipdorppoort") - 9) return "wall_keizer";
  if (s < gateS("sint_jorispoort") - 9) return "wall_kipdorp";
  return "wall_joris";
}

/**
 * Which round a lamp is on. The town wall's lamps: its five rounds (wallRoundOf). The north: the Sint-Jansplein and
 * the canal's quays (below). The market quarter: west of the Steenplein's houses (x < -205) north of the town hall's
 * front, or anything west of the canal quarter north of the Handschoenmarkt street (z > 120). The west old town: the
 * rest west of x -145, and the quay road south of z 50 as far as x -100. The east quays: everything else.
 */
export function roundOf(l: { id?: string; x: number; z: number }): RoundId {
  if (l.id && isWallLamp(l.id)) return wallRoundOf(l.x, l.z);
  // M7 prison and squares (LAMPS_VERSION 10): the Sint-Jansplein's four lamps (d66..d69, z > 250) and the canal's quays
  // with the street west of the Vleeshuis quarter (x -155..-60, north of z 55) are the north round; the quay road from
  // x -100 to the Rijnkaai goes to the east round. Followed at a walk the four take 378, 422, 433 and 440 s (three
  // rounds could not take the square: 685 s for the east round, 432 s the most a window holds at a brisk walk)
  if ((l.z > 250 && l.x > -60) || (l.x < -60 && l.x > -155 && l.z > 55)) return "north";
  if (l.x < -145 && ((l.x < -205 && l.z > 55) || l.z > 120)) return "market";
  if (l.x < -145 || (l.z < 50 && l.x < -100)) return "west";
  return "east";
}

// ------------------------------------------------------------------ the town wall

interface RampSeg {
  name: string;
  o: RPt;
  t: RPt;
  n: RPt;
  len: number;
}
interface RampGate {
  id: string;
  name: string;
  out: RPt;
  bridge: number[][];
  posts: RPt[];
}
const RAMPART = (CITY as unknown as { decor?: { rampart?: { segments: RampSeg[]; gates: RampGate[] } } }).decor?.rampart ?? null;

/**
 * How far along the town wall a point lies: metres from the wall's east end at the river (by the Rode Poort's side),
 * round the three land sides, to its west end (tools/city/rampart.py's segments, in their order).
 */
export function wallS(x: number, z: number): number {
  let acc = 0;
  let best = Infinity;
  let bestS = 0;
  for (const g of RAMPART?.segments ?? []) {
    const dx = x - g.o[0];
    const dz = z - g.o[1];
    const s = Math.max(0, Math.min(g.len, dx * g.t[0] + dz * g.t[1]));
    const d = Math.hypot(dx - g.t[0] * s, dz - g.t[1] * s);
    if (d < best) {
      best = d;
      bestS = acc + s;
    }
    acc += g.len;
  }
  return Math.round(bestS * 10) / 10;
}

/**
 * The gate a lamp outside the town belongs to (a lantern on a gate's field face, the lamp at its bridge's far end:
 * the gates are shut and nobody walks past their leaves), and where its lamplighter stands for it: the wicket in
 * the gate's leaves, the passage's last open ground. He steps out through the wicket to light them (the walk map
 * ends at the leaves). Null for any other lamp.
 */
export function wicketFoot(x: number, z: number): { gate: string; foot: RPt } | null {
  const wm = walkMap();
  for (const g of RAMPART?.gates ?? []) {
    // the gate's middle line runs out along `out` from between its sentries' posts
    const [p, q] = g.posts;
    const cx = (p[0] + q[0]) / 2;
    const cz = (p[1] + q[1]) / 2;
    const along = (x - cx) * g.out[0] + (z - cz) * g.out[1];
    const sideS = (x - cx) * -g.out[1] + (z - cz) * g.out[0];
    const side = Math.abs(sideS);
    if (along < 0 || along > 60 || side > 6) continue;
    // the passage's last open ground on its middle line (the leaves stand just past it)
    let last = -1;
    for (let d = 0; d <= 40; d += 0.25) {
      if (!wm.reachable(cx + g.out[0] * d, cz + g.out[1] * d)) break;
      last = d;
    }
    if (last < 0 || along <= last + 0.5) return null; // inside the leaves: an ordinary lamp
    // he stands at the leaves on the lamp's side of the passage (a lamp far out: half a metre further in), so each
    // lamp of the gate has its own spot and the round steps from one to the next
    const back = along > last + 8 ? 0.6 : 0;
    for (let d = last - back; d >= 0; d -= 0.25)
      for (let s = Math.min(1.2, side); s >= 0; s -= 0.2) {
        const fx = cx + g.out[0] * d - g.out[1] * s * Math.sign(sideS);
        const fz = cz + g.out[1] * d + g.out[0] * s * Math.sign(sideS);
        if (wm.reachable(fx, fz) && wm.open(fx, fz, 0.35)) return { gate: g.id, foot: [Math.round(fx * 10) / 10, Math.round(fz * 10) / 10] };
      }
  }
  return null;
}

// ------------------------------------------------------------------ paths on the walk map

/** The lamp posts' cells a cart keeps off (M7 lamps): every cell within `clear` + 0.3 m of a post, per clear. */
const postCells = new Map<number, Set<number>>();
function lampPostCells(clear: number): Set<number> {
  let s = postCells.get(clear);
  if (s) return s;
  s = new Set<number>();
  const { x0, z0, res, w, h } = walkMap().info;
  const R = clear + 0.3;
  for (const l of allLamps()) {
    if (l.hung) continue;
    const r0 = Math.floor((l.x - R - x0) / res);
    const r1 = Math.floor((l.x + R - x0) / res);
    const c0 = Math.floor((l.z - R - z0) / res);
    const c1 = Math.floor((l.z + R - z0) / res);
    for (let r = Math.max(0, r0); r <= Math.min(h - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(w - 1, c1); c++) {
        if (Math.hypot(x0 + (r + 0.5) * res - l.x, z0 + (c + 0.5) * res - l.z) <= R) s.add(r * w + c);
      }
  }
  postCells.set(clear, s);
  return s;
}

/**
 * A* over the walk map's reachable cells (8 ways, no cutting corners), simplified to a few points.
 * `clear`: more room round each cell (a horse and cart need about a metre each side); with room asked
 * for, the way keeps that room from the gas lamps' posts too (M7 lamps: a hearse or the fire pump never
 * drives through a lamp standing on a square). A walker (`clear` 0) passes them by a hand's breadth.
 */
export function walkPath(ax: number, az: number, bx: number, bz: number, maxExpand = 400_000, clear = 0): RPt[] | null {
  const wm = walkMap();
  const { x0, z0, res, w, h } = wm.info;
  // cell (row r along x, col c along z), as walkmap.ts
  const cellOf = (x: number, z: number) => [Math.floor((x - x0) / res), Math.floor((z - z0) / res)] as const;
  const centre = (r: number, c: number): RPt => [x0 + (r + 0.5) * res, z0 + (c + 0.5) * res];
  const roomy = new Map<number, boolean>();
  const posts = clear ? lampPostCells(clear) : null;
  const ok = (r: number, c: number) => {
    if (r < 0 || c < 0 || r >= h || c >= w || !wm.reachable(...centre(r, c))) return false;
    if (!clear) return true;
    const k = r * w + c;
    let v = roomy.get(k);
    if (v === undefined) roomy.set(k, (v = wm.open(...centre(r, c), clear)));
    return v;
  };
  const [sr, sc] = cellOf(ax, az);
  const [tr, tc] = cellOf(bx, bz);
  if (!ok(sr, sc) || !ok(tr, tc)) return null;
  const key = (r: number, c: number) => r * w + c;
  // (the start and the end may lie by a post: the way to and from them does not)
  const byPost = (k: number) => !!posts && posts.has(k) && k !== key(sr, sc) && k !== key(tr, tc);
  const g = new Map<number, number>();
  const from = new Map<number, number>();
  const heap: Array<[number, number]> = [];
  const push = (f: number, k: number) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const hdist = (r: number, c: number) => Math.hypot(r - tr, c - tc);
  const s = key(sr, sc);
  const t = key(tr, tc);
  g.set(s, 0);
  push(hdist(sr, sc), s);
  const closed = new Set<number>();
  let n = 0;
  while (heap.length && n++ < maxExpand) {
    const [, k] = pop();
    if (k === t) break;
    if (closed.has(k)) continue;
    closed.add(k);
    const r = Math.floor(k / w);
    const c = k % w;
    const gk = g.get(k)!;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (!ok(rr, cc)) continue;
        if (dr && dc && (!ok(r + dr, c) || !ok(r, c + dc))) continue;
        const nk = key(rr, cc);
        if (byPost(nk)) continue;
        const ng = gk + (dr && dc ? Math.SQRT2 : 1);
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          from.set(nk, k);
          push(ng + hdist(rr, cc), nk);
        }
      }
  }
  if (!g.has(t)) return null;
  const cells: RPt[] = [];
  for (let k: number | undefined = t; k !== undefined; k = from.get(k)) cells.push(centre(Math.floor(k / w), k % w));
  cells.reverse();
  cells[0] = [ax, az];
  cells[cells.length - 1] = [bx, bz];
  return simplify(cells, clear);
}

/** Keep a point only where the straight line from the last kept one would leave the walkable cells. */
function simplify(pts: RPt[], room = 0): RPt[] {
  if (pts.length <= 2) return pts;
  const wm = walkMap();
  const { x0, z0, res, w } = wm.info;
  const posts = room ? lampPostCells(room) : null;
  const byPost = (x: number, z: number) => !!posts && posts.has(Math.floor((x - x0) / res) * w + Math.floor((z - z0) / res));
  const clear = (a: RPt, b: RPt) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.ceil(L / 0.25);
    for (let i = 1; i < n; i++) {
      const k = i / n;
      const x = a[0] + (b[0] - a[0]) * k;
      const z = a[1] + (b[1] - a[1]) * k;
      if (!wm.reachable(x, z) || (room && (!wm.open(x, z, room) || byPost(x, z)))) return false;
    }
    return true;
  };
  const out: RPt[] = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100] as RPt);
}

const plen = (p: RPt[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/** Where a lamplighter stands at a lamp's foot: open, reachable ground about 0.9 m from the post. */
export function footOf(x: number, z: number): RPt | null {
  const wm = walkMap();
  for (const d of [0.9, 1.2, 1.6])
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
      const q: RPt = [Math.round((x + Math.cos(a) * d) * 10) / 10, Math.round((z + Math.sin(a) * d) * 10) / 10];
      if (wm.reachable(q[0], q[1]) && wm.open(q[0], q[1], 0.35)) return q;
    }
  const q = wm.nearestOpen(x, z, 6);
  return q ? [q.x, q.z] : null;
}

/** The order of a round: nearest neighbour from the start, then 2-opt (straight-line lengths). */
function order(pts: Array<{ x: number; z: number }>, start: RPt): number[] {
  const n = pts.length;
  if (!n) return [];
  const d = (i: number, j: number) => Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
  const left = new Set(pts.map((_p, i) => i));
  let cur = [...left].sort((a, b) => Math.hypot(pts[a].x - start[0], pts[a].z - start[1]) - Math.hypot(pts[b].x - start[0], pts[b].z - start[1]))[0];
  const tour = [cur];
  left.delete(cur);
  while (left.size) {
    let best = -1;
    let bd = Infinity;
    for (const j of left)
      if (d(cur, j) < bd) {
        bd = d(cur, j);
        best = j;
      }
    tour.push(best);
    left.delete(best);
    cur = best;
  }
  // 2-opt on an open path (the first lamp stays first)
  for (let pass = 0; pass < 8; pass++) {
    let better = false;
    for (let i = 1; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        const a = tour[i - 1];
        const b = tour[i];
        const c = tour[j];
        const e = j + 1 < n ? tour[j + 1] : -1;
        const before = d(a, b) + (e >= 0 ? d(c, e) : 0);
        const after = d(a, c) + (e >= 0 ? d(b, e) : 0);
        if (after < before - 0.01) {
          tour.splice(i, j - i + 1, ...tour.slice(i, j + 1).reverse());
          better = true;
        }
      }
    if (!better) break;
  }
  return tour;
}

/**
 * The opening bridges (city.json designedBridges, kind "draw": the canal's three, the vliet's two, the lock
 * bridge). A boat passing holds walkers at the ends for a minute or two of real time.
 */
const DRAW_BRIDGES: Array<[number, number, number, number]> = Object.values(
  ((CITY as unknown as { designedBridges?: Record<string, { kind: string; rect: [number, number, number, number] }> }).designedBridges ?? {}),
)
  .filter((b) => b.kind === "draw")
  .map((b) => b.rect);

/** How far along a path (0..1) its last step on an opening bridge lies, walked forward and walked back; -1: none. */
export function bridgeEnds(path: RPt[]): { fwd: number; back: number } {
  const len = plen(path) || 1;
  let first = -1;
  let last = -1;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k <= n; k++) {
      const x = ax + ((bx - ax) * k) / n;
      const z = az + ((bz - az) * k) / n;
      if (DRAW_BRIDGES.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1)) {
        const d = acc + (L * k) / n;
        if (first < 0) first = d;
        last = d;
      }
    }
    acc += L;
  }
  return first < 0 ? { fwd: -1, back: -1 } : { fwd: last / len, back: (len - first) / len };
}

/** Walked lengths between two feet (the walk map does not change while the server runs). */
const legCache = new Map<string, number>();
function legLen(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const k = a.x < b.x || (a.x === b.x && a.z <= b.z) ? `${a.x},${a.z},${b.x},${b.z}` : `${b.x},${b.z},${a.x},${a.z}`;
  let v = legCache.get(k);
  if (v === undefined) {
    const p = walkPath(a.x, a.z, b.x, b.z);
    v = p ? plen(p) : Infinity;
    legCache.set(k, v);
  }
  return v;
}

/**
 * A round's leg from one lamp's foot to the next, kept (the walk map does not change while the server runs): every
 * new save builds the same rounds, and the town wall's legs are long (issue #14: 0.8 s a save without).
 */
const legPaths = new Map<string, RPt[] | null>();
function legPath(ax: number, az: number, bx: number, bz: number): RPt[] | null {
  const k = `${ax},${az},${bx},${bz}`;
  let p = legPaths.get(k);
  if (p === undefined) legPaths.set(k, (p = walkPath(ax, az, bx, bz)));
  return p;
}

/**
 * 2-opt again with the walked lengths (the first lamp stays first): the straight lines do not see the
 * water or the blocks (the west round came out 20 m shorter). A swap is walked out only where the
 * straight lines (never longer than the walk) leave room for a gain.
 */
function walked2opt(pts: Array<{ x: number; z: number }>, tour: number[]): number[] {
  const t = [...tour];
  const n = t.length;
  const straight = (i: number, j: number) => Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z);
  const real = (i: number, j: number) => legLen(pts[i], pts[j]);
  for (let pass = 0; pass < 6; pass++) {
    let better = false;
    for (let i = 1; i < n - 1; i++)
      for (let j = i + 1; j < n; j++) {
        const a = t[i - 1];
        const b = t[i];
        const c = t[j];
        const e = j + 1 < n ? t[j + 1] : -1;
        const before = real(a, b) + (e >= 0 ? real(c, e) : 0);
        if (straight(a, c) + (e >= 0 ? straight(b, e) : 0) >= before - 0.5) continue;
        const after = real(a, c) + (e >= 0 ? real(b, e) : 0);
        if (after < before - 0.5) {
          t.splice(i, j - i + 1, ...t.slice(i, j + 1).reverse());
          better = true;
        }
      }
    if (!better) break;
  }
  return t;
}

/** A tour's straight-line length. */
const tourLen = (pts: Array<{ x: number; z: number }>, t: number[]) => t.reduce((a, j, i) => (i ? a + Math.hypot(pts[j].x - pts[t[i - 1]].x, pts[j].z - pts[t[i - 1]].z) : 0), 0);

/**
 * One round over these lamps. M7 lamps: the shortest open tour with every lamp tried as the first
 * (straight lines). It is walked the way that crosses its opening bridges earlier, so that a wait for a
 * boat comes while there is still time to make it up; with no bridge (or as good both ways), from the end
 * nearer `home` (the lamplighter's door). Before, the tour began at the lamp nearest his door, which could
 * lie in the middle of his lamps and cost a long walk back.
 * `inOrder` (the town wall's rounds, #14): the lamps are walked in the order given (along the wall), only the
 * direction is chosen. The wall is one long line: the tour search strands a lamp and walks the wall twice.
 */
export function buildRound(id: string, lamplighter: string, lamps: Array<{ id: string; x: number; z: number }>, home: RPt, dusk: number, inOrder = false): LampRound {
  const withFoot: RoundLamp[] = [];
  for (const l of lamps) {
    // (a lamp outside a shut gate: lit from its wicket, #14)
    const w = isWallLamp(l.id) ? wicketFoot(l.x, l.z) : null;
    const f = w ? w.foot : footOf(l.x, l.z);
    if (f) withFoot.push(w ? { id: l.id, x: l.x, z: l.z, sx: f[0], sz: f[1], wicket: w.gate } : { id: l.id, x: l.x, z: l.z, sx: f[0], sz: f[1] });
  }
  const pts = withFoot.map((l) => ({ x: l.sx, z: l.sz }));
  let best: number[] = [];
  if (inOrder) best = pts.map((_p, i) => i);
  else {
    let bestLen = Infinity;
    for (const p of pts) {
      const t = order(pts, [p.x, p.z]);
      const L = tourLen(pts, t);
      if (L < bestLen - 0.01) {
        bestLen = L;
        best = t;
      }
    }
    best = walked2opt(pts, best);
  }
  const walk = (order: number[]): LampRound => {
    const tour = order.map((i) => withFoot[i]);
    const path: RPt[] = tour.length ? [[tour[0].sx, tour[0].sz]] : [];
    const at: number[] = [0];
    const kept: RoundLamp[] = tour.length ? [tour[0]] : [];
    for (let i = 1; i < tour.length; i++) {
      const a = kept[kept.length - 1];
      const b = tour[i];
      const leg = legPath(a.sx, a.sz, b.sx, b.sz);
      if (!leg) continue; // no way on foot: that lamp is left out of the round (it keeps to the clock)
      path.push(...leg.slice(1));
      at.push(plen(path));
      kept.push(b);
    }
    return { id, lamplighter, lamps: kept, path, at: at.slice(0, kept.length), len: plen(path), dusk };
  };
  if (best.length < 2) return walk(best);
  const round = walk(best);
  const br = bridgeEnds(round.path);
  let back: boolean;
  const gateAt = best.findIndex((i) => withFoot[i].wicket);
  // a wall round with a gate begins at the gate, in the street, and ends up on the walk (a player's stretch is the
  // round's end: town/lampjob.ts; he cannot go out through the wicket)
  if (inOrder && gateAt >= 0) back = gateAt >= best.length / 2;
  else if (br.fwd >= 0 && Math.abs(br.fwd - br.back) > 0.05) back = br.back < br.fwd;
  else {
    const a = pts[best[0]];
    const b = pts[best[best.length - 1]];
    back = Math.hypot(b.x - home[0], b.z - home[1]) < Math.hypot(a.x - home[0], a.z - home[1]);
  }
  return walk(onTheWay(withFoot, back ? [...best].reverse() : best));
}

/** Metres from a polyline to a point, and how far along the line its nearest point lies. */
function nearOnPath(path: RPt[], x: number, z: number): { d: number; along: number } {
  let d = Infinity;
  let along = 0;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const e = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (e < d) {
      d = e;
      along = acc + Math.sqrt(L2) * t;
    }
    acc += Math.sqrt(L2);
  }
  return { d, along };
}

/** A lamp later in the round that a leg walks past within this (its foot or its post) is lit on the way. */
const PASS_M = 1.5;

/**
 * Light on the way (issue #14: the market round walked past d42 to light d43 and came back to it): where the way
 * to the next lamp passes a lamp still to come, that lamp is lit as he passes it. The walk stays the same way.
 */
function onTheWay(lamps: RoundLamp[], tour: number[]): number[] {
  const t = [...tour];
  for (let k = 1; k < t.length; k++) {
    const a = lamps[t[k - 1]];
    const b = lamps[t[k]];
    const leg = legPath(a.sx, a.sz, b.sx, b.sz);
    if (!leg || leg.length < 2) continue;
    let pick = -1;
    let first = Infinity;
    for (let j = k + 1; j < t.length; j++) {
      const l = lamps[t[j]];
      const foot = nearOnPath(leg, l.sx, l.sz);
      const post = l.wicket ? { d: Infinity, along: 0 } : nearOnPath(leg, l.x, l.z);
      const near = foot.d <= post.d ? foot : post;
      if (near.d <= PASS_M && near.along < first) {
        first = near.along;
        pick = j;
      }
    }
    if (pick >= 0) t.splice(k, 0, ...t.splice(pick, 1));
  }
  return t;
}

// ------------------------------------------------------------------ the save

export function lampRounds(db: DB): LampRounds | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(STATE_KEY) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as LampRounds) : null;
}

/** The lamplighter's day: the dawn round and the dusk round, each until full day or full dark (the rest of his day stays as it was). */
function lamplighterSched(r: Resident, dusk: number): Resident["sched"] {
  const keep = (segs: Seg[]) => segs.filter((s) => s[2] !== "work" && s[1] <= dusk - 0.25 && !(s[0] < DAWN_LAST && s[1] > DAWN_START - 0.1));
  const work: Seg[] = [
    [DAWN_START - 0.1, DAWN_LAST, "work"],
    [dusk - 0.1, DUSK_LAST, "work"],
  ];
  return { day: tidy([...keep(r.sched.day), ...work]), sunday: tidy([...keep(r.sched.sunday), ...work]) };
}

/**
 * Give the save its three lamplighters and their rounds (once per LAMPS_VERSION). Only the
 * lamplighters' records change (trade, work, schedule); every other resident, memory and
 * relationship stays. Returns the rounds, or null when the town has no residents yet.
 */
export function ensureLamplighters(db: DB): LampRounds | null {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (!has) return null;
  const before = lampRounds(db);
  if (before?.v === LAMPS_VERSION && before.rounds.length) return before;
  const t = town(db).town;
  const lamps = allLamps();
  const lighters = t.residents.filter((r) => r.trade === "lamplighter").sort((a, b) => a.id.localeCompare(b.id));
  const byStart = (st: RPt) => (a: Resident, b: Resident) => Math.hypot(a.home.sx - st[0], a.home.sz - st[1]) - Math.hypot(b.home.sx - st[0], b.home.sz - st[1]);
  const who = new Map<string, Resident>();
  const taken = (r: Resident) => [...who.values()].includes(r);
  // 1. whoever walked a round before keeps it (an older save: the west and the east round)
  for (const spec of ROUNDS) {
    const id = before?.rounds.find((x) => x.id === spec.id)?.lamplighter;
    const r = id ? lighters.find((x) => x.id === id) : undefined;
    if (r && !taken(r)) who.set(spec.id, r);
  }
  // 2. the town's other lamplighters take the rounds left, the one living nearest its start
  for (const spec of ROUNDS) {
    if (who.has(spec.id)) continue;
    const r = lighters.filter((x) => !taken(x)).sort(byStart(spec.start))[0];
    if (r) who.set(spec.id, r);
  }
  // 3. a round with nobody: a man of the town changes his trade
  for (const spec of ROUNDS) {
    if (who.has(spec.id)) continue;
    const man = t.residents
      // (M7 back of town: the back's own dockers keep their trade: bk ids, town/backtown.ts)
      .filter((r) => !taken(r) && !/^bk[0-9]+$/.test(r.id) && r.sex === "m" && r.age >= 24 && r.age <= 58 && (r.trade === "docker" || r.trade === "porter") && ["head", "single", "lodger", "widower", "son"].includes(r.family_role))
      .sort(byStart(spec.start))[0];
    if (man) who.set(spec.id, man);
  }
  const picks = ROUNDS.filter((spec) => who.has(spec.id)).map((spec) => ({ spec, r: who.get(spec.id)! }));
  if (!picks.length) return null;
  const rounds: LampRound[] = [];
  const upd = db.prepare("UPDATE resident SET trade = ?, data_json = ? WHERE id = ?");
  const role = db.prepare("UPDATE npc SET role = ? WHERE id = ?");
  // every lamp is on a round: a round nobody walks hands its lamps to the nearest round that has a man
  const sets = new Map<string, typeof lamps>(picks.map((p) => [p.spec.id, []]));
  const near = (l: { x: number; z: number }) => (a: (typeof picks)[number], b: (typeof picks)[number]) => Math.hypot(a.spec.start[0] - l.x, a.spec.start[1] - l.z) - Math.hypot(b.spec.start[0] - l.x, b.spec.start[1] - l.z);
  for (const l of lamps) {
    const own = roundOf(l);
    sets.get(sets.has(own) ? own : [...picks].sort(near(l))[0].spec.id)!.push(l);
  }
  db.transaction(() => {
    picks.forEach(({ spec, r }, i) => {
      // (the rounds start in DUSK_SLOTS turns a little apart; the wall's rounds share the town's turns)
      const dusk = DUSK_START + (i % DUSK_SLOTS) * DUSK_STAGGER_H;
      const wall = isWallRound(spec.id);
      const mine = sets.get(spec.id)!;
      if (wall) mine.sort((a, b) => wallS(a.x, a.z) - wallS(b.x, b.z));
      const round = buildRound(spec.id, r.id, mine, [r.home.sx, r.home.sz], dusk, wall);
      rounds.push(round);
      const rec: Resident = JSON.parse(JSON.stringify(r)) as Resident;
      rec.trade = "lamplighter";
      rec.faction = TRADES.lamplighter.faction;
      rec.work = { place: "lamps", kind: "patrol", route: round.lamps.map((l) => [l.sx, l.sz]) };
      rec.sched = lamplighterSched(r, dusk);
      upd.run("lamplighter", JSON.stringify(rec), r.id);
      role.run(TRADES.lamplighter.label, r.id);
    });
    const out: LampRounds = { v: LAMPS_VERSION, rounds };
    db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(STATE_KEY, JSON.stringify(out));
  })();
  dropTownCache(db);
  return { v: LAMPS_VERSION, rounds };
}

const HELP_KEY = "lamps_help";

// ------------------------------------------------------------------ the lamps a player lights tonight (town/lampjob.ts; world state)

export function lampHelp(db: DB): LampHelp | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(HELP_KEY) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as LampHelp) : null;
}

export function saveHelp(db: DB, h: LampHelp | null): void {
  if (!h) db.prepare("DELETE FROM world_state WHERE key = ?").run(HELP_KEY);
  else db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(HELP_KEY, JSON.stringify(h));
}

/** Today's help as the clients see it (null when none, or another day's). */
export function lampHelpNow(db: DB): LampHelp | null {
  const h = lampHelp(db);
  return h && h.day === worldClock(db).day ? h : null;
}
