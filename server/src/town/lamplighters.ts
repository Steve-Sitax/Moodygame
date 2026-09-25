import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { TRADES } from "./places.ts";
import { tidy, type Resident } from "./population.ts";
import { DAWN_SPAN_H, DAWN_START, DUSK_SPAN_H, DUSK_START, type LampRound, type RoundLamp, type RPt } from "./lampround.ts";
import type { Seg } from "./schedule.ts";
import { dropTownCache, town } from "./store.ts";
import { walkMap } from "./walkmap.ts";

// The lamplighters (M6 town life, Steve 2026-09-24: "the lamplighter"). Antwerp's gas lamps
// were lit by hand: at dusk a lamplighter walked his round with a long pole and a ladder over
// his shoulder, lamp to lamp, and at dawn he walked it again to put them out. Here two
// lamplighters share the town's 38 gas lamps (the six of the Rijnkaai quay and the 32 of the
// city), west and east, each on a real path over the walk map. The rounds, the times and the
// order are the ENGINE's (lampround.ts); the client lights each lamp when he reaches it.
//
// Save migration (ensureLamplighters): an older save keeps every resident, memory and
// relationship. The town's lamplighter (if it has one) takes a round; the second is a man of
// the town who changes his trade (a docker or a porter, living nearest the round's start):
// his name, family, home, stats and memories stay. No new house is taken (the homes helper
// rents houses out). Runs once per version (world_state 'townlife_lamps').

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
 */
export const LAMPS_VERSION = 5;
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

/** One round over these lamps, starting near `start` (the lamplighter's door). */
export function buildRound(id: string, lamplighter: string, lamps: Array<{ id: string; x: number; z: number }>, start: RPt, dusk: number): LampRound {
  const withFoot: RoundLamp[] = [];
  for (const l of lamps) {
    const f = footOf(l.x, l.z);
    if (f) withFoot.push({ id: l.id, x: l.x, z: l.z, sx: f[0], sz: f[1] });
  }
  const tour = order(withFoot.map((l) => ({ x: l.sx, z: l.sz })), start).map((i) => withFoot[i]);
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
}

// ------------------------------------------------------------------ the save

export function lampRounds(db: DB): LampRounds | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(STATE_KEY) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as LampRounds) : null;
}

/** The lamplighter's day: the dawn round and the dusk round (the rest of his day stays as it was). */
function lamplighterSched(r: Resident, dusk: number): Resident["sched"] {
  const keep = (segs: Seg[]) => segs.filter((s) => s[2] !== "work" && s[1] <= dusk - 0.25 && !(s[0] < DAWN_START + DAWN_SPAN_H + 0.1 && s[1] > DAWN_START - 0.1));
  const work: Seg[] = [
    [DAWN_START - 0.1, DAWN_START + DAWN_SPAN_H + 0.1, "work"],
    [dusk - 0.1, dusk + DUSK_SPAN_H + 0.1, "work"],
  ];
  return { day: tidy([...keep(r.sched.day), ...work]), sunday: tidy([...keep(r.sched.sunday), ...work]) };
}

/**
 * Give the save its two lamplighters and their rounds (once per LAMPS_VERSION). Only the two
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
  // west: the Werf, the Steenplein and the Grote Markt; east: the Vismarkt, the Rijnkaai, the canal and the basins
  const west = lamps.filter((l) => l.x < -145);
  const east = lamps.filter((l) => l.x >= -145);
  const WEST_START: RPt = [-300, 12];
  const EAST_START: RPt = [-140, 30];
  const lighters = t.residents.filter((r) => r.trade === "lamplighter").sort((a, b) => a.id.localeCompare(b.id));
  const byStart = (st: RPt) => (a: Resident, b: Resident) => Math.hypot(a.home.sx - st[0], a.home.sz - st[1]) - Math.hypot(b.home.sx - st[0], b.home.sz - st[1]);
  const picks: Resident[] = [];
  if (lighters.length) picks.push(lighters.sort(byStart(WEST_START))[0]);
  // the second (and first, if none): a man of the town who changes his trade
  const used = new Set(picks.map((r) => r.id));
  const others = lighters.filter((r) => !used.has(r.id));
  while (picks.length < 2) {
    const want = picks.length === 0 ? WEST_START : EAST_START;
    const other = others.shift();
    if (other) {
      picks.push(other);
      continue;
    }
    const man = t.residents
      .filter((r) => !picks.includes(r) && r.sex === "m" && r.age >= 24 && r.age <= 58 && (r.trade === "docker" || r.trade === "porter") && ["head", "single", "lodger", "widower", "son"].includes(r.family_role))
      .sort(byStart(want))[0];
    if (!man) break;
    picks.push(man);
  }
  if (!picks.length) return null;
  const rounds: LampRound[] = [];
  const upd = db.prepare("UPDATE resident SET trade = ?, data_json = ? WHERE id = ?");
  const role = db.prepare("UPDATE npc SET role = ? WHERE id = ?");
  db.transaction(() => {
    picks.forEach((r, i) => {
      // with one lamplighter only, he walks every lamp
      const set = picks.length === 1 ? lamps : i === 0 ? west : east;
      const dusk = DUSK_START + i * 0.1;
      const round = buildRound(i === 0 ? "west" : "east", r.id, set, [r.home.sx, r.home.sz], dusk);
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
