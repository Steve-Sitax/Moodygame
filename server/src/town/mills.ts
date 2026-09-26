import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { clock, weather } from "../day.ts";
import { DEV } from "../config.ts";
import { GameError, settleExtras, takeHooks } from "../game.ts";
import { boardExtras, maxTier, TIER_PAY, type CarryTask, type JobRow, type MillTask, type Twist } from "../hooks/jobBoard.ts";
import { cartWorkOpen, walkDist } from "../hooks/loads.ts";
import { sellerPrice } from "../trade.ts";
import { shownTrade, TRADES, type TradeId } from "./places.ts";
import { rngFrom, tidy, type Home, type Resident, type Stats, type TownPlace } from "./population.ts";
import type { Seg } from "./schedule.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, type HouseDoor } from "./walkmap.ts";
import { INWORLD_HOUSES } from "./kept.ts";
import {
  absMin,
  breadExtra,
  FLOUR_LOW,
  FLOUR_WARES,
  freshStocks,
  GRAIN_LOW,
  HELP_MIN,
  HELP_PAY,
  HELP_TURNS,
  manRuns,
  millById,
  millPay,
  millTurning,
  MILLS,
  runNow,
  runsOf,
  stepStocks,
  type MillDef,
  type Stocks,
} from "../../../shared/mills.ts";
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import { realS } from "../../../shared/clock.ts";

// M7 mills (Steve 2026-09-26: "millers and transport from mill to bakery or docks or from docks, and
// potential jobs"). The ENGINE's side of the two mills on the town wall (shared/mills.ts has the data and the
// rules both sides read):
//
// - the people: a miller and his man at each mill, added once in place to every town (ids ml01..ml04): the
//   miller at his mill by day (the client has him turn the cap when the wind backs), the man hauling the sacks
//   between the mill and the sack store at the foot of the wall stair, out with the cart at dawn (flour to the
//   bakery) and after dinner (grain from a dock), at the tavern in the evening;
// - the stocks: grain and flour at each mill, flour in each bakery's loft, moved on with the clock (the bake at
//   three, the carts at the ends of their runs, the stones in the wind by day); the bread's price follows the
//   loft (a centime or two more when it runs short);
// - the work for Jef, built by the engine with hand-written words (no model call): flour from the sack store to
//   the bakery when the loft runs low (for the baker), grain from the dock to the store when the mill runs low,
//   and an hour's help at a windy mill (both for the miller). Pay by the way on foot and the weight, clamped to
//   the tier's band. They show on the board and in talk with the miller or the baker (employer_npc).

const MILLS_SALT = 0x6d111526;
const SPOTS = SPOT_TABLE as unknown as Record<string, { x: number; z: number; label: string; dir: [number, number] }>;

// ------------------------------------------------------------------ the people

const FIRST = ["Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "August", "Emiel", "Theofiel", "Achiel", "Petrus", "Jozef", "Rik", "Fons", "Lode", "Dries", "Remi", "Cyriel", "Florent", "Gustaaf"];
const SUR = ["Van de Velde", "Meulemans", "De Meulenaere", "Verhaegen", "Claessens", "Van Aken", "Moens", "Wauters", "Peeters", "Janssens", "Van Genechten", "Maes", "Dockx", "Verlinden", "Van Camp", "Schoofs", "Bosmans", "Luyckx"];
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);

/** The mill's people: [the miller, his man]. */
export const MILL_PEOPLE: Record<string, [string, string]> = { mill_mid: ["ml01", "ml02"], mill_ne: ["ml03", "ml04"] };
export const MILLER_IDS = new Set(["ml01", "ml03"]);

/** A mill as a town place (the talk and the map say where the miller works). */
function millPlace(m: MillDef): TownPlace {
  return { label: m.label, x: m.door[0], z: m.door[1], r: 5, district: m.id === "mill_mid" ? "canal" : "eilandje" };
}

/** The millers and their men a town still lacks (pure: the same seed and residents give the same people). */
export function generateMillers(seed: number, places: Record<string, TownPlace>, residents: readonly Resident[]): { residents: Resident[]; places: Record<string, TownPlace> } {
  const rng = rngFrom((seed ^ MILLS_SALT) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;
  const usedNames = new Set(residents.map((r) => r.name));
  const usedHouses = new Set([...residents.map((r) => r.home.house).filter((h) => h >= 0), ...INWORLD_HOUSES]);
  let household = residents.reduce((m, r) => Math.max(m, r.household), 0);
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
    for (const k of ["honesty", "temper", "piety", "warmth", "greed", "courage", "gossip"] as const) {
      const v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (def.bias?.[k] ?? 0);
      s[k] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(def.wealth[0], def.wealth[1]);
    return s;
  };
  const name = (surname?: string): { first: string; surname: string } => {
    for (let i = 0; i < 80; i++) {
      const first = pick(FIRST);
      const sur = surname ?? pick(SUR);
      if (TAKEN.has(first) || TAKEN.has(sur)) continue;
      if (!usedNames.has(`${first} ${sur}`)) {
        usedNames.add(`${first} ${sur}`);
        return { first, surname: sur };
      }
    }
    return { first: pick(FIRST), surname: `${pick(SUR)}-${usedNames.size}` };
  };
  const taverns = Object.keys(places).filter((k) => k.startsWith("tavern:"));
  const tavernNear = (x: number, z: number) => taverns.sort((a, b) => Math.hypot(places[a].x - x, places[a].z - z) - Math.hypot(places[b].x - x, places[b].z - z))[0] ?? null;
  const out: Resident[] = [];
  const outPlaces: Record<string, TownPlace> = {};
  const have = new Set(residents.map((r) => r.id));
  for (const m of MILLS) {
    const [millerId, manId] = MILL_PEOPLE[m.id];
    if (!places[m.id]) outPlaces[m.id] = millPlace(m);
    const yard = SPOTS[m.yard];
    // the stair's foot side of the store: the man walks between the mill's door and the pile
    const b: [number, number] = [Math.round((yard.x - yard.dir[1] * 1.2) * 10) / 10, Math.round((yard.z + yard.dir[0] * 1.2) * 10) / 10];
    const face = Math.round(Math.atan2(m.door[0] - m.tower[0], m.door[1] - m.tower[1]) * 100) / 100;
    const add = (id: string, trade: TradeId, kind: string, age: number, home: Home, hh: number, nm: { first: string; surname: string }, work: Resident["work"], day: Seg[], sunday: Seg[], role: string) => {
      if (have.has(id)) return;
      out.push({
        id,
        first: nm.first,
        surname: nm.surname,
        name: `${nm.first} ${nm.surname}`,
        age,
        sex: "m",
        household: hh,
        family_role: role,
        trade,
        faction: TRADES[trade].faction,
        kind,
        home,
        work,
        sched: { day: tidy(day), sunday: tidy(sunday) },
        stats: statsFor(trade),
        dog: null,
      });
    };
    // the miller: at his mill by day, a pot at the tavern after; on Sunday the sails stand, he goes to mass
    {
      const nm = name();
      const home = homeAt(doorNear(yard.x, yard.z));
      const tav = tavernNear(home.sx, home.sz);
      const day: Seg[] = [[j(5.75), 12, "work"], [12.75, 18.5, "work"], ...(tav ? [[j(19), j(21.25), "tavern", tav] as Seg] : [])];
      const sunday: Seg[] = [[j(8.75), j(11), "church", "church"], ...(tav ? [[j(16), j(19), "tavern", tav] as Seg] : [])];
      add(millerId, "miller", "baker", int(42, 60), home, ++household, nm, { place: m.id, kind: "post", at: [m.door[0], m.door[1], face] }, day, sunday, "head");
    }
    // his man: the cart out at dawn and after dinner (shared/mills.ts runsOf), the sacks down the stair between
    {
      const nm = name();
      const home = homeAt(doorNear(yard.x + 12, yard.z - 12));
      const tav = tavernNear(home.sx, home.sz);
      const runs = manRuns(m);
      const flour = runs.find((r) => r[2] === "flour")!;
      const grain = runs.find((r) => r[2] === "grain")!;
      const day: Seg[] = [
        [flour[0] - 0.25, flour[1], "work", "flour"],
        [flour[1], 12, "work"],
        [12.75, grain[0], "work"],
        [grain[0], grain[1], "work", "grain"],
        ...(grain[1] < 18.5 ? [[grain[1], 18.5, "work"] as Seg] : []),
        ...(tav ? [[Math.max(19, grain[1] + 0.5), j(21.5), "tavern", tav] as Seg] : []),
      ];
      const sunday: Seg[] = tav ? [[j(11), j(13), "tavern", tav], [j(17), j(20), "tavern", tav]] : [];
      add(manId, "miller_man", "docker_b", int(19, 34), home, ++household, nm, { place: m.id, kind: "haul", a: [m.door[0], m.door[1]], b }, day, sunday, "single");
    }
  }
  return { residents: out, places: outPlaces };
}

/** Give a save its millers and their men and the mills as places (once, in place). Returns how many were added. */
export function ensureMills(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0;
  if ((db.prepare("SELECT COUNT(*) AS n FROM resident WHERE id LIKE 'ml%'").get() as { n: number }).n > 0) return 0;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (!row) return 0;
  const t = town(db).town;
  const g = generateMillers(t.seed, t.places, t.residents);
  const rest = JSON.parse(row.value_json) as { places: Record<string, TownPlace> };
  const insNpc = db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let added = 0;
  db.transaction(() => {
    const places = { ...rest.places, ...g.places };
    for (const r of g.residents) {
      if (hasNpc.get(r.id)) continue;
      insNpc.run(r.id, r.name, shownTrade(r), places[r.work.place]?.district ?? "town", r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added++;
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places }));
  })();
  dropTownCache(db);
  return added;
}

// ------------------------------------------------------------------ the stocks

const KEY = "mills";
const nowMin = (db: DB) => {
  const c = clock(db);
  return absMin(c.day, c.hour, c.minute);
};

function readStocks(db: DB): Stocks | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(KEY) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as Stocks;
  } catch {
    return null;
  }
}
function writeStocks(db: DB, s: Stocks): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(KEY, JSON.stringify(s));
}

/** The stocks now: moved on with the clock since they were last counted (a new week, or a clock set back: afresh). */
export function millStocks(db: DB): Stocks {
  const now = nowMin(db);
  let s = readStocks(db);
  if (!s || now < s.at - 5 || !MILLS.every((m) => s!.mills[m.id] && s!.bakeries[m.bakery])) s = freshStocks(now);
  const w = weather(db);
  stepStocks(s, now, () => w);
  writeStocks(db, s);
  return s;
}

/** Change a stock by the engine's rules (Jef's work, the dev menu), clamped at 0. */
function adjust(db: DB, f: (s: Stocks) => void): Stocks {
  const s = millStocks(db);
  f(s);
  for (const m of Object.values(s.mills)) {
    m.grain = Math.max(0, Math.round(m.grain));
    m.flour = Math.max(0, Math.round(m.flour));
  }
  for (const b of Object.values(s.bakeries)) b.flour = Math.max(0, Math.round(b.flour));
  writeStocks(db, s);
  return s;
}

/** The bread's price: a centime or two more when the bakery's loft runs short (shared/mills.ts breadExtra). */
sellerPrice.push((db, seller, kind, price) => {
  if (!FLOUR_WARES.has(kind)) return price;
  const shop = town(db).town.shops.find((s) => s.keeper === seller) ?? null;
  const own = shop ?? town(db).town.shops.find((s) => s.id === town(db).byId.get(seller)?.work.shop);
  if (!own || !MILLS.some((m) => m.bakery === own.id)) return price;
  const s = readStocks(db);
  const f = s?.bakeries[own.id]?.flour;
  return f === undefined ? price : price + breadExtra(f);
});

// ------------------------------------------------------------------ the work

type MillJobKind = "flour" | "grain" | "help";
interface MillMeta {
  mill: string;
  mk: MillJobKind;
  /** Flour set aside at the store for this job when it was taken. */
  reserved?: number;
}

const bakerOf = (db: DB, m: MillDef): string | null => town(db).town.shops.find((s) => s.id === m.bakery)?.keeper ?? null;
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const WORDS: Record<MillJobKind, Array<{ title: string; pitch: (m: MillDef, n: number, cart: boolean) => string }>> = {
  flour: [
    {
      title: "Flour for the bakery",
      pitch: (m, n, cart) =>
        `My loft is near empty and the mill's cart will not come till dawn. ${cart ? `Take the miller's barrow and bring ${n === 3 ? "three sacks" : `${n} sacks`}` : "Bring me a sack"} of flour from ${SPOTS[m.yard].label} at the foot of the wall, to my door. Keep it dry.`,
    },
    {
      title: "A sack from the mill",
      pitch: (m, n, cart) => `The dough won't wait for the miller. ${cart ? `${n === 3 ? "Three sacks" : `${n} sacks`} of flour on his barrow` : "One sack of flour on your back"} from ${SPOTS[m.yard].label} to my bakehouse, and mind the gutters.`,
    },
  ],
  grain: [
    {
      title: "Grain up from the dock",
      pitch: (m, n, cart) => `A barge of Zeeland rye lies at ${SPOTS[m.grain].label}. ${cart ? `Load ${n === 3 ? "three sacks" : `${n} sacks`} on my barrow` : "Bring me a sack"} to ${SPOTS[m.yard].label}; the natie's men will show you which.`,
    },
    {
      title: "Rye for the mill",
      pitch: (m, n, cart) => `The stones are hungry and my man is out with the cart. ${cart ? `${n === 3 ? "Three sacks" : `${n} sacks`} of rye by barrow` : "A sack of rye"} from ${SPOTS[m.grain].label} to the store at the foot of the wall, before the wind drops.`,
    },
  ],
  help: [
    {
      title: "An hour at the mill",
      pitch: (m) => `The wind keeps backing today. Give me an hour at ${m.label} on the wall: when I call, put your shoulder to the capstan and bring her face round to the wind.`,
    },
  ],
};

const TWISTS: Record<"flour" | "grain", Twist[]> = {
  // a sack split (fill your pockets), a sack of wet flour heavier than it should be, a man who wants to buy one
  flour: ["none", "none", "broken_goods", "heavy_load", "stranger_offer"],
  // a split sack, the natie's man counting, a buyer in the street (and the M6 trouble roll's customs at the dock)
  grain: ["none", "none", "broken_goods", "foreman_watches", "stranger_offer"],
};

/** The mill work open or in hand today, by its mark (mill:kind). */
function millJobsToday(db: DB, day: number): Array<{ id: number; status: string; meta: MillMeta }> {
  const rows = db.prepare("SELECT id, status, task_json FROM job WHERE source = 'mill' AND (day = ? OR status = 'taken')").all(day) as Array<{ id: number; status: string; task_json: string }>;
  const out: Array<{ id: number; status: string; meta: MillMeta }> = [];
  for (const r of rows) {
    try {
      const t = JSON.parse(r.task_json) as { millJob?: MillMeta };
      if (t.millJob) out.push({ id: r.id, status: r.status, meta: t.millJob });
    } catch {
      /* not ours */
    }
  }
  return out;
}

/** The engine's mill job of this kind for this mill (words, load, pay, twist); null when it does not fit now. */
export function buildMillJob(db: DB, m: MillDef, kind: MillJobKind, opts: { cart?: boolean; twist?: Twist } = {}): { title: string; employer: string; task_type: string; pay_c: number; pitch: string; task: CarryTask | MillTask; risk: string } | null {
  const c = clock(db);
  const rng = rngFrom(hash(`${m.id}:${kind}:${c.day}`));
  const band = TIER_PAY[maxTier(db)];
  const words = WORDS[kind][Math.floor(rng() * WORDS[kind].length)];
  const meta: MillMeta = { mill: m.id, mk: kind };
  if (kind === "help") {
    const miller = MILL_PEOPLE[m.id][0];
    const cap = m.capstan ?? [m.door[0] + 1.2, m.door[1] - 0.8];
    const task: MillTask & { millJob: MillMeta } = {
      kind: "mill",
      goods: "sacks",
      mill: m.id,
      post: { x: m.door[0], z: m.door[1], label: m.label },
      capstan: { x: cap[0], z: cap[1] },
      duration_s: realS(HELP_MIN),
      turns: HELP_TURNS,
      twist: "none",
      limit_s: null,
      millJob: meta,
    };
    return { title: words.title, employer: miller, task_type: "mill", pay_c: Math.max(band[0], Math.min(band[1], HELP_PAY)), pitch: words.pitch(m, 1, false), task, risk: "low" };
  }
  const from = kind === "flour" ? m.yard : m.grain;
  const to = kind === "flour" ? m.bakeryDoor : m.yard;
  const employer = kind === "flour" ? bakerOf(db, m) : MILL_PEOPLE[m.id][0];
  if (!employer) return null;
  const cart = opts.cart ?? (cartWorkOpen(db) && rng() < 0.5);
  const count = cart ? 3 : 1;
  let twist = opts.twist ?? TWISTS[kind][Math.floor(rng() * TWISTS[kind].length)];
  if (cart && twist === "heavy_load") twist = "none";
  const way = walkDist(from, to);
  const pay_c = millPay(count, way, cart, band);
  const task: CarryTask & { millJob: MillMeta } = { kind: "carry", goods: "sacks", count, from: from as CarryTask["from"], to: to as CarryTask["to"], twist, limit_s: null, ...(cart ? { cart: true } : {}), millJob: meta };
  return { title: words.title, employer, task_type: "carry", pay_c, pitch: words.pitch(m, count, cart), task, risk: twist === "none" ? "low" : "medium" };
}

function insertJob(db: DB, j: NonNullable<ReturnType<typeof buildMillJob>>): number {
  const { day } = clock(db);
  const district = (db.prepare("SELECT district FROM npc WHERE id = ?").get(j.employer) as { district: string } | undefined)?.district ?? "town";
  const faction = (db.prepare("SELECT faction FROM npc WHERE id = ?").get(j.employer) as { faction: string | null } | undefined)?.faction ?? null;
  const r = db
    .prepare(
      `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mill', 'offered')`,
    )
    .run(day, j.title, j.employer, district, j.task_type, j.pay_c, j.risk, maxTier(db), faction, j.pitch, JSON.stringify(j.task));
  return Number(r.lastInsertRowid);
}

/**
 * Put up the mills' work that fits now (at most one of a kind per mill a day): flour when the bakery's loft
 * will be short (the cart's load on its way counted in) and the store has a sack, grain when the mill runs
 * low, and an hour's help on a working day with wind. Returns the ids put up.
 */
export function offerMillJobs(db: DB): number[] {
  const c = clock(db);
  const s = millStocks(db);
  const have = millJobsToday(db, c.day);
  const out: number[] = [];
  const h = c.hour + c.minute / 60;
  for (const m of MILLS) {
    const had = (k: MillJobKind) => have.some((j) => j.meta.mill === m.id && j.meta.mk === k);
    const run = runNow(m, c.day, h);
    const incoming = run?.run.kind === "flour" && (run.phase === "go" || run.phase === "unload") ? (s.carts[m.id] ?? 0) : 0;
    if (!had("flour") && h >= 5 && h < 19 && s.bakeries[m.bakery].flour + incoming <= FLOUR_LOW && s.mills[m.id].flour >= 1) {
      const j = buildMillJob(db, m, "flour");
      if (j && (j.task as CarryTask).count <= s.mills[m.id].flour) out.push(insertJob(db, j));
      else if (j) {
        const one = buildMillJob(db, m, "flour", { cart: false });
        if (one) out.push(insertJob(db, one));
      }
    }
    if (!had("grain") && h >= 6 && h < 17 && s.mills[m.id].grain <= GRAIN_LOW) {
      const j = buildMillJob(db, m, "grain");
      if (j) out.push(insertJob(db, j));
    }
    if (!had("help") && h >= 7 && h < 16 && millTurning(c.weather, c.day, h) > 0 && s.mills[m.id].grain >= 1) {
      const j = buildMillJob(db, m, "help");
      if (j) out.push(insertJob(db, j));
    }
  }
  return out;
}

const metaOf = (j: JobRow): MillMeta | null => (j.source === "mill" ? ((j.task as unknown as { millJob?: MillMeta } | null)?.millJob ?? null) : null);

// taken: the flour is set aside at the store (the mill's cart will not take it)
takeHooks.push((db, j) => {
  const meta = metaOf(j);
  if (!meta || meta.mk !== "flour" || j.task?.kind !== "carry") return;
  const n = j.task.count;
  let got = 0;
  adjust(db, (s) => {
    const mill = s.mills[meta.mill];
    if (!mill) return;
    got = Math.min(n, mill.flour);
    mill.flour -= got;
  });
  const task = { ...j.task, millJob: { ...meta, reserved: got } };
  db.prepare("UPDATE job SET task_json = ? WHERE id = ?").run(JSON.stringify(task), j.id);
});

// settled: what reached the bakery or the store counts; the hour's help ground a sack more
settleExtras.push((db, j, s) => {
  const meta = metaOf(j);
  const m = meta ? millById(meta.mill) : undefined;
  if (!meta || !m) return;
  const t = j.task;
  if (meta.mk === "help") {
    const turned = s.facts.some((f) => /every time|turned the cap/.test(f));
    if (turned)
      adjust(db, (st) => {
        const mill = st.mills[m.id];
        if (mill.grain > 0) {
          mill.grain -= 1;
          mill.flour += 1;
        }
      });
    return;
  }
  if (t?.kind !== "carry") return;
  const brought = Number(/brought (\d+) of/.exec(s.facts[0] ?? "")?.[1] ?? t.progress?.delivered ?? 0);
  adjust(db, (st) => {
    if (meta.mk === "flour") {
      st.bakeries[m.bakery].flour += brought;
      // what was set aside and not brought is gone (lost, sold, split)
    } else st.mills[m.id].grain += brought;
  });
});

// ------------------------------------------------------------------ the view and the routes

export function millsView(db: DB) {
  const s = millStocks(db);
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  return {
    day: c.day,
    weather: c.weather,
    mills: MILLS.map((m) => ({
      id: m.id,
      label: m.label,
      miller: MILL_PEOPLE[m.id][0],
      man: MILL_PEOPLE[m.id][1],
      baker: bakerOf(db, m),
      grain: s.mills[m.id].grain,
      flour: s.mills[m.id].flour,
      bakery: s.bakeries[m.bakery].flour,
      cart: s.carts[m.id] ?? 0,
      turning: millTurning(c.weather, c.day, h),
      run: runNow(m, c.day, h),
      runs: runsOf(m, c.day),
    })),
  };
}

export function mountMills(app: Hono, deps: { db: DB; payload: () => Record<string, unknown>; broadcast: (m: unknown) => void }): void {
  const { db, payload, broadcast } = deps;
  let lastHour = -1;
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      const c = clock(db);
      millStocks(db);
      // the work is looked at every game hour (and after a new board: boardExtras)
      if (c.hour !== lastHour) {
        lastHour = c.hour;
        if (offerMillJobs(db).length) broadcast({ type: "jobs", ...payload() });
      }
    } catch (e) {
      console.error("[mills] tick", e);
    }
  });
  app.get("/api/mills", (c) => c.json(millsView(db)));
  if (DEV) {
    /** Dev: a mill job now ({ mill, kind: flour | grain | help, cart?, twist? }), offered on today's board. */
    app.post("/api/dev/mills/job", async (c) => {
      const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { mill?: string; kind?: string; cart?: boolean; twist?: string };
      const m = millById(b.mill ?? "mill_mid") ?? MILLS[0];
      const kind: MillJobKind = b.kind === "grain" || b.kind === "help" ? b.kind : "flour";
      const tw = typeof b.twist === "string" && ["none", "broken_goods", "stranger_offer", "foreman_watches", "heavy_load"].includes(b.twist) ? (b.twist as Twist) : undefined;
      const j = buildMillJob(db, m, kind, { cart: typeof b.cart === "boolean" ? b.cart : undefined, twist: tw });
      if (!j) throw new GameError("no baker for that mill", 409);
      const id = insertJob(db, j);
      broadcast({ type: "jobs", ...payload() });
      return c.json({ id, title: j.title, pay_c: j.pay_c, task: j.task, employer: j.employer });
    });
    /** Dev: set a stock ({ mill, grain?, flour?, bakery? }). */
    app.post("/api/dev/mills/stock", async (c) => {
      const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { mill?: string; grain?: number; flour?: number; bakery?: number };
      const m = millById(b.mill ?? "mill_mid") ?? MILLS[0];
      const s = adjust(db, (st) => {
        if (Number.isFinite(b.grain)) st.mills[m.id].grain = Number(b.grain);
        if (Number.isFinite(b.flour)) st.mills[m.id].flour = Number(b.flour);
        if (Number.isFinite(b.bakery)) st.bakeries[m.bakery].flour = Number(b.bakery);
      });
      return c.json(s);
    });
  }
}

// after a new board (the day's first), the mills' work goes up with it
boardExtras.push((db) => void offerMillJobs(db));
