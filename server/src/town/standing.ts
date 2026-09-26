import type { DB } from "../db.ts";
import { HAUNTS, PATROLS, shownTrade, STATS, TRADES, type Stat, type TradeId } from "./places.ts";
import { rngFrom, tidy, type Home, type Pt, type Resident, type Stats, type Town } from "./population.ts";
import type { Seg } from "./schedule.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import { INWORLD_HOUSES } from "./kept.ts";

// M7 walk-up: the standing roles (Steve, 2026-09-26: "customs, police or even thieves linger around and
// come up or follow when they know you do a quest"). The people a job needs must always be somewhere in
// the town, so that the engine can send the nearest (town/walkup.ts) instead of making one out of nothing.
// The town already has four customs officers on the quays by day (garrison.ts), four agents of police
// (half by night) and five thieves; this adds, once, in place (a save keeps everyone it had):
//
// - customs: an officer at the Entrepot's gate, one at the lock bridges, and a night watch of the customs
//   on the Rijnkaai (18:00 to 6:00), so a load is never out of a customs man's reach;
// - police: a day and a night agent on every beat (the quays, the town, the Werf, and a new beat round
//   the Petit Bassin), so every district has a patrol at every hour;
// - thieves: two who loiter on the quays by day (the Rijnkaai, the Werf), drink in the evening, and
//   haunt the dark corners by the water at night.
//
// Their ids are "wu01" ...; their own random stream (seed ^ STANDING_SALT), so the rest stays as it was.

const STANDING_SALT = 0x3a1c0926;

const FIRST = ["Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "Constant", "August", "Victor", "Emiel", "Alfons", "Leon", "Jules", "Petrus", "Jozef", "Staf", "Lode", "Ward", "Dries", "Remi", "Cyriel", "Honoré"];
const SUR = ["Verbruggen", "Van Loon", "De Backer", "Peeters", "Janssens", "Van Hoof", "Mertens", "Aerts", "Goossens", "Stevens", "Van Dijck", "Michiels", "Wuyts", "Smets", "Cools", "Hermans", "Van den Broeck", "Geerts", "Vervoort", "Bogaerts"];
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);

/** The police beats (PATROLS has three; the Petit Bassin's is new here). */
export const BASSIN_BEAT: Pt[] = [[76, 12], [110, 16], [140, 9.5], [150, 115], [112, 117], [92, 117]];
const BEATS: Record<string, Pt[]> = { ...PATROLS, bassin: BASSIN_BEAT };
const ENTREPOT_ROUTE: Pt[] = [[165, 75], [181, 75], [182, 90], [166, 92]];
const LOCK_ROUTE: Pt[] = [[104, 4], [118, 4], [118, 45], [104, 45]];
const RIJNKAAI_NIGHT: Pt[] = [[-28, 14], [-6, 15], [18, 14], [44, 14]];

export interface Standing {
  residents: Resident[];
}

/** Day or night shift of an agent (the population's rule: an even last digit walks by night). */
export function policeShift(r: Resident): "day" | "night" {
  const first = r.sched.day[0];
  if (first) return first[0] >= 17 ? "night" : "day";
  return r.id.charCodeAt(r.id.length - 1) % 2 === 0 ? "night" : "day";
}

/** The standing roles a town still lacks (pure: the same seed and residents give the same people). */
export function generateStanding(seed: number, places: Town["places"], residents: readonly Resident[]): Standing {
  const rng = rngFrom((seed ^ STANDING_SALT) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;
  const wm = walkMap();
  const snap = (x: number, z: number, max = 12): Pt | null => {
    const q = wm.nearestOpen(x, z, max);
    return q ? [Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10] : null;
  };
  const route = (pts: Pt[]): Pt[] => pts.map(([x, z]) => snap(x, z)).filter((p): p is Pt => !!p);
  const out: Resident[] = [];
  const usedNames = new Set(residents.map((r) => r.name));
  const usedHouses = new Set([...residents.map((r) => r.home.house).filter((h) => h >= 0), ...INWORLD_HOUSES]);
  let household = residents.reduce((m, r) => Math.max(m, r.household), 0);
  let n = residents.filter((r) => /^wu\d+$/.test(r.id)).length;
  const doors = houseDoors();
  const doorNear = (x: number, z: number): HouseDoor => {
    const byD = doors.map((d) => ({ d, k: Math.hypot(d.sx - x, d.sz - z) })).sort((a, b) => a.k - b.k);
    const d = (byD.find((o) => o.k <= 220 && !usedHouses.has(o.d.house)) ?? byD[0]).d;
    usedHouses.add(d.house);
    return d;
  };
  const homeAt = (d: HouseDoor): Home => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });
  const statsFor = (trade: TradeId): Stats => {
    const def = TRADES[trade];
    const s = {} as Stats;
    for (const k of STATS) {
      const v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (def.bias?.[k as Stat] ?? 0);
      s[k as Stat] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(def.wealth[0], def.wealth[1]);
    return s;
  };
  const name = (): { first: string; surname: string } => {
    for (let i = 0; i < 80; i++) {
      const first = pick(FIRST);
      const surname = pick(SUR);
      if (TAKEN.has(first) || TAKEN.has(surname)) continue;
      if (!usedNames.has(`${first} ${surname}`)) {
        usedNames.add(`${first} ${surname}`);
        return { first, surname };
      }
    }
    return { first: pick(FIRST), surname: `${pick(SUR)}-${n}` };
  };
  const add = (trade: TradeId, kind: string, age: number, near: Pt, work: Resident["work"], sched: { day: Seg[]; sunday: Seg[] }): Resident => {
    const nm = name();
    const r: Resident = {
      id: `wu${String(++n).padStart(2, "0")}`,
      first: nm.first,
      surname: nm.surname,
      name: `${nm.first} ${nm.surname}`,
      age,
      sex: "m",
      household: ++household,
      family_role: "single",
      trade,
      faction: TRADES[trade].faction,
      kind,
      home: homeAt(doorNear(near[0], near[1])),
      work,
      sched: { day: tidy(sched.day), sunday: tidy(sched.sunday) },
      stats: statsFor(trade),
      dog: null,
    };
    out.push(r);
    return r;
  };
  const faces = (pts: Pt[], mid: Pt) => pts.map(([x, z]) => Math.round(Math.atan2(x - mid[0], z - mid[1]) * 100) / 100);

  // --- customs: the Entrepot's gate, the lock bridges, the night watch on the Rijnkaai
  const customs = residents.filter((r) => r.trade === "customs");
  const hasCustoms = (place: string, night: boolean) => customs.some((r) => r.work.place === place && (policeShift(r) === "night") === night);
  const customsMan = (place: string, pts: Pt[], mid: Pt, night: boolean) => {
    const rt = route(pts);
    if (rt.length < 2 || hasCustoms(place, night)) return;
    // (the night watch hands over to the day men at seven; the day men eat at another hour than the quays' four)
    const day: Seg[] = night ? [[j(17.75), 31.25, "work"]] : [[j(6.75), 11.5, "work"], [12.25, j(18.25), "work"]];
    add("customs", "customs", int(28, 55), mid, { place, kind: "inspect", route: rt, faces: faces(rt, mid) }, { day, sunday: night ? day : [[j(8), 12, "work"]] });
  };
  if (places.entrepot) customsMan("entrepot", ENTREPOT_ROUTE, [places.entrepot.x, places.entrepot.z], false);
  customsMan("lock", LOCK_ROUTE, [110, 24], false);
  customsMan("rijnkaai", RIJNKAAI_NIGHT, [0, 30], true);

  // --- police: a day and a night agent on every beat
  const agents = residents.filter((r) => r.trade === "police");
  for (const [beat, pts] of Object.entries(BEATS)) {
    const rt = route(pts);
    if (rt.length < 2) continue;
    for (const shift of ["day", "night"] as const) {
      if (agents.some((a) => a.work.place === beat && policeShift(a) === shift)) continue;
      // (the day men eat at noon, the quays' agents at one: a beat is never empty at dinner time)
      const day: Seg[] = shift === "night" ? [[j(18, 0.25), 30, "work"]] : [[6, 12, "work"], [12.75, j(19, 0.25), "work"]];
      add("police", "police", int(24, 50), rt[0], { place: beat, kind: "patrol", route: rt }, { day, sunday: day.map((s) => [...s] as Seg) });
    }
  }

  // --- thieves on the quays by day
  const quayThieves = residents.filter((r) => r.trade === "thief" && r.sched.day.some((s) => s[2] === "loiter" && (s[3] === "rijnkaai" || s[3] === "werf")));
  for (const quay of ["rijnkaai", "werf"]) {
    if (quayThieves.some((r) => r.sched.day.some((s) => s[3] === quay)) || !places[quay]) continue;
    const at: Pt = [places[quay].x, places[quay].z];
    const haunts = HAUNTS.map(([x, z]) => ({ p: snap(x, z), d: Math.hypot(x - at[0], z - at[1]) }))
      .filter((h): h is { p: Pt; d: number } => !!h.p)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((h) => h.p);
    const tavern = Object.keys(places).filter((k) => k.startsWith("tavern:")).sort((a, b) => Math.hypot(places[a].x - at[0], places[a].z - at[1]) - Math.hypot(places[b].x - at[0], places[b].z - at[1]))[0] ?? null;
    const day: Seg[] = [[j(10), j(17), "loiter", quay], ...(tavern ? [[j(18), 21, "tavern", tavern] as Seg] : []), [21, j(28, 0.5), "work"]];
    add("thief", "thief", int(17, 32), at, { place: "night", kind: "roam", route: haunts }, { day, sunday: day.map((s) => [...s] as Seg) });
  }
  return { residents: out };
}

/**
 * Give a save its standing roles (once, in place): the same people a new game with this town's seed
 * would have. Adds rows only (npc, npc_relationship, resident). Returns how many were added.
 */
export function ensureStanding(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0;
  if ((db.prepare("SELECT COUNT(*) AS n FROM resident WHERE id LIKE 'wu%'").get() as { n: number }).n > 0) return 0;
  const t = town(db).town;
  const g = generateStanding(t.seed, t.places, t.residents);
  if (!g.residents.length) return 0;
  const insNpc = db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let added = 0;
  db.transaction(() => {
    for (const r of g.residents) {
      if (hasNpc.get(r.id)) continue;
      insNpc.run(r.id, r.name, shownTrade(r), t.places[r.work.place]?.district ?? "quays", r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added++;
    }
  })();
  dropTownCache(db);
  return added;
}
