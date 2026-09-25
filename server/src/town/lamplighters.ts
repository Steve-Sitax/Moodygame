import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { TRADES } from "./places.ts";
import { tidy, type Resident } from "./population.ts";
import { DAWN_LAST, DAWN_START, DUSK_LAST, DUSK_STAGGER_H, DUSK_START, type LampRound, type RoundLamp, type RPt } from "./lampround.ts";
import type { Seg } from "./schedule.ts";
import { dropTownCache, town } from "./store.ts";
import { walkMap } from "./walkmap.ts";

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
export const LAMPS_VERSION = 9;
const STATE_KEY = "townlife_lamps";

export interface LampRounds {
  v: number;
  rounds: LampRound[];
}

/** Every gas lamp of the town with its id. */
export function allLamps(): Array<{ id: string; x: number; z: number }> {
  const decor = ((CITY as unknown as { decor?: { lamps?: RPt[] } }).decor?.lamps ?? []) as RPt[];
  return [...QUAY_LAMPS.map(([x, z], i) => ({ id: `q${i}`, x, z })), ...decor.map(([x, z], i) => ({ id: `d${i}`, x, z }))];
}

/**
 * The three rounds (M7 lamps, 2026-09-25), in this order in the save. `start`: where the round's
 * lamplighter is sought when the town has none to spare (the man living nearest changes his trade).
 */
export const ROUNDS: ReadonlyArray<{ id: "west" | "market" | "east"; label: string; start: RPt }> = [
  { id: "west", label: "the west old town: the Werf, the Steenplein, the quay road to the Rijnkaai", start: [-300, 12] },
  { id: "market", label: "the Grote Markt, the Handschoenmarkt and the cathedral quarter", start: [-250, 100] },
  { id: "east", label: "the east quays: the Rijnkaai, the canal, the lock and the basins", start: [-20, 40] },
];

/**
 * Which round a lamp is on. The market quarter: west of the Steenplein's houses (x < -205) north of
 * the town hall's front, or anything west of the canal quarter north of the Handschoenmarkt street
 * (z > 120). The west old town: the rest west of x -145, and the quay road south of z 50 as far as the
 * Rijnkaai's first two lamps (x < -25). The east quays: everything else.
 */
export function roundOf(l: { x: number; z: number }): "west" | "market" | "east" {
  if (l.x < -145 && ((l.x < -205 && l.z > 55) || l.z > 120)) return "market";
  if (l.x < -145 || (l.z < 50 && l.x < -25)) return "west";
  return "east";
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
 */
export function buildRound(id: string, lamplighter: string, lamps: Array<{ id: string; x: number; z: number }>, home: RPt, dusk: number): LampRound {
  const withFoot: RoundLamp[] = [];
  for (const l of lamps) {
    const f = footOf(l.x, l.z);
    if (f) withFoot.push({ id: l.id, x: l.x, z: l.z, sx: f[0], sz: f[1] });
  }
  const pts = withFoot.map((l) => ({ x: l.sx, z: l.sz }));
  let best: number[] = [];
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
  const walk = (order: number[]): LampRound => {
    const tour = order.map((i) => withFoot[i]);
    const path: RPt[] = tour.length ? [[tour[0].sx, tour[0].sz]] : [];
    const at: number[] = [0];
    const kept: RoundLamp[] = tour.length ? [tour[0]] : [];
    for (let i = 1; i < tour.length; i++) {
      const a = kept[kept.length - 1];
      const b = tour[i];
      const leg = walkPath(a.sx, a.sz, b.sx, b.sz);
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
  if (br.fwd >= 0 && Math.abs(br.fwd - br.back) > 0.05) back = br.back < br.fwd;
  else {
    const a = pts[best[0]];
    const b = pts[best[best.length - 1]];
    back = Math.hypot(b.x - home[0], b.z - home[1]) < Math.hypot(a.x - home[0], a.z - home[1]);
  }
  return back ? walk([...best].reverse()) : round;
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
      .filter((r) => !taken(r) && r.sex === "m" && r.age >= 24 && r.age <= 58 && (r.trade === "docker" || r.trade === "porter") && ["head", "single", "lodger", "widower", "son"].includes(r.family_role))
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
      const dusk = DUSK_START + i * DUSK_STAGGER_H;
      const round = buildRound(spec.id, r.id, sets.get(spec.id)!, [r.home.sx, r.home.sz], dusk);
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
