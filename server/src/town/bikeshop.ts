import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { remember } from "../npcs.ts";
import { ITEM_BUY, ITEM_REF } from "../trade.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import { TRADES } from "./places.ts";
import { rngFrom, type Resident } from "./population.ts";
import { dropStealables, setVeloState, veloHooks, veloStates, type Velo, type VeloState } from "./deeds.ts";
import { BUSY_M, VELO_FETCH_FEE_C, VELO_HIRE_HOURS, VELO_PRICE, VELO_THEFT_PER_HOUR, WATCHED_M, type Pt } from "./transport.ts";

// The velocipede maker (M6 transport). Steve, 2026-09-24: "Also add a bike shop so we can buy
// and own a bike." Later the same day: "bikes don't get damage": a machine never breaks, a
// fall does not harm it, and there is no repair.
//
// Research (quick): the velocipede with pedals on the front hub came out of Paris in the
// 1860s (Michaux, then the Compagnie parisienne des velocipedes, 1867-69); carriage makers
// and smiths built them under licence or on their own and sold them abroad, the Low Countries
// among them. In 1868 machines were advertised in France from 200 to 400 francs (a boy's
// from 120); a fine iron one with bronze fittings, a brake and a varnished saddle cost 270
// francs in 1869. We found no named velocipede maker in Antwerp in 1873; a smith or carriage
// maker who builds and hires out boneshakers is the plausible trade, not a traced address.
// Sources: en.wikipedia.org/wiki/Velocipede ; en.wikipedia.org/wiki/French_bicycle_industry ;
// onlinebicyclemuseum.co.uk/1866-michaux-serpentine-velocipede/ ;
// fr.wikipedia.org/wiki/V%C3%A9locip%C3%A8de .
//
// The ENGINE's numbers (transport.ts VELO_PRICE): a second-hand machine 600 c, a new one
// 1200 c, a day's hire 30 c. At the game's pay (a job 50-150 c, two or three a day) the
// second-hand one is a hard week's saving, the new one two. A hire runs VELO_HIRE_HOURS game
// hours; not back at his door by then, his boy fetches it and the maker asks VELO_FETCH_FEE_C.
//
// Jef's own machine is saved on the server (world_state 'jef_velos' and the M3h velocipede
// states, deeds.ts): it stands where he left it and he rides it with the ordinary controls.
// Left alone in a busy place (a market, a quay, a tavern door) with Jef not by it, someone may
// ride off on it: VELO_THEFT_PER_HOUR each game hour. Then it is gone, the town talks, and the
// police can be asked: the theft is a robbery of Jef on the record (log 'robbed', the thief a
// pickpocket of the town), which the M4 police case takes up; a thief caught by the police
// pays its worth back (director/convo.ts, the engine's fixed outcome). At Jef's rented home's
// door (M6 homes) and at the maker's door it is safe.

export const SHOP_ID = "velo_maker";
const ANCHOR: Pt = [-150, 96]; // off the Grote Markt line, between the Vleeshuis and the canal

export interface VeloShop {
  id: string;
  label: string;
  step: Pt;
  wall: Pt;
  out: Pt;
  /** Where the maker stands at his door, and where the machines for sale and for hire stand. */
  at: [number, number, number];
  show: Array<[number, number, number]>;
}

export interface JefVelo {
  id: string;
  kind: "new" | "used" | "hire";
  /** Game minute bought or hired. */
  since: number;
  /** A hire: the game minute it must be back by. */
  until?: number;
  paid_c: number;
}
interface JefVelos {
  n: number;
  list: JefVelo[];
  /** A note for the client (stolen, fetched). */
  notice: { n: number; text: string } | null;
  /** The last game hour the theft roll ran. */
  rolled: number;
}

// ------------------------------------------------------------------ state

function getState<T>(db: DB, key: string): T | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}
function putState(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

export function veloShop(db: DB): VeloShop | null {
  return getState<VeloShop>(db, "veloshop");
}
export function jefVelos(db: DB): JefVelos {
  const s = getState<JefVelos>(db, "jef_velos");
  return { n: s?.n ?? 0, list: Array.isArray(s?.list) ? s!.list : [], notice: s?.notice ?? null, rolled: s?.rolled ?? -1 };
}
function saveJef(db: DB, s: JefVelos): void {
  putState(db, "jef_velos", s);
}
function notice(s: JefVelos, text: string): void {
  s.notice = { n: (s.notice?.n ?? 0) + 1, text };
}

const minuteNow = (db: DB) => {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return (p.day - 1) * 1440 + p.hour * 60 + p.minute;
};

// ------------------------------------------------------------------ the shop in the town

export function freeDoors(db: DB): HouseDoor[] {
  const t = town(db).town;
  const houses = new Set(t.residents.map((r) => r.home.house));
  const taken: Pt[] = [];
  for (const r of t.residents) {
    taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  for (const p of Object.values(t.places)) if (p.door) taken.push(p.door);
  for (const s of t.shops) taken.push(s.door);
  for (const key of ["homes", "poesje:door", "press"]) {
    const v = getState<{ homes?: Array<{ step: Pt }>; dealer?: { step: Pt } | null; sx?: number; sz?: number; post?: { step: Pt } | null; corners?: Array<{ x: number; z: number }> }>(db, key);
    if (!v) continue;
    for (const h of v.homes ?? []) taken.push(h.step);
    if (v.dealer) taken.push(v.dealer.step);
    if (typeof v.sx === "number" && typeof v.sz === "number") taken.push([v.sx, v.sz]);
    if (v.post) taken.push(v.post.step);
    for (const c of v.corners ?? []) taken.push([c.x, c.z]);
  }
  return houseDoors().filter((d) => !houses.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 5));
}

/**
 * The velocipede maker and his door, once (a new game, or an older save on its next start):
 * a NEW resident in a free house, the place 'velo_shop', world_state 'veloshop'. Nobody else
 * changes. Idempotent.
 */
export function ensureBikeShop(db: DB): boolean {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (!has || veloShop(db)) return false;
  if (db.prepare("SELECT 1 FROM npc WHERE id = ?").get(SHOP_ID)) return false;
  const t = town(db).town;
  const wm = walkMap();
  // a door with room in front: two machines stand out on the pavement beside it
  const doors = freeDoors(db)
    .filter((d) => d.storeys >= 2)
    .map((d) => {
      const along: Pt = [-d.out[1], d.out[0]];
      const pts: Array<[number, number, number]> = [];
      for (const s of [-1.9, 1.9, -2.7, 2.7]) {
        const x = d.x + d.out[0] * 1.0 + along[0] * s;
        const z = d.z + d.out[1] * 1.0 + along[1] * s;
        if (wm.open(x, z, 0.5) && wm.reachable(x, z)) pts.push([Math.round(x * 10) / 10, Math.round(z * 10) / 10, +Math.atan2(along[0], along[1]).toFixed(3)]);
      }
      return { d, pts, k: Math.hypot(d.sx - ANCHOR[0], d.sz - ANCHOR[1]) };
    })
    .filter((o) => o.pts.length >= 2 && wm.open(o.d.sx + o.d.out[0] * 0.9, o.d.sz + o.d.out[1] * 0.9, 0.4))
    .sort((a, b) => a.k - b.k);
  const pick = doors[0];
  if (!pick) return false;
  const d = pick.d;
  const rng = rngFrom((t.seed ^ 0x7e1_0c1) >>> 0);
  const first = ["Remi", "Achiel", "Florent", "Jules", "Cornelis"][Math.floor(rng() * 5)];
  const used = new Set(t.residents.map((r) => r.surname));
  const sn = ["Deschepper", "Smeets", "Van Tilt", "De Ridder", "Vanhecke"].find((s) => !used.has(s)) ?? "De Ridder";
  const at: [number, number, number] = [
    Math.round((d.sx + d.out[0] * 0.9) * 10) / 10,
    Math.round((d.sz + d.out[1] * 0.9) * 10) / 10,
    +Math.atan2(d.out[0], d.out[1]).toFixed(3),
  ];
  const hh = Math.max(0, ...t.residents.map((r) => r.household)) + 1;
  const r: Resident = {
    id: SHOP_ID,
    first,
    surname: sn,
    name: `${first} ${sn}`,
    age: 34 + Math.floor(rng() * 14),
    sex: "m",
    household: hh,
    family_role: "single",
    trade: "velo_maker" as Resident["trade"],
    faction: TRADES.velo_maker.faction,
    kind: "shopkeeper",
    home: { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz },
    work: { place: "velo_shop", kind: "post", at },
    sched: { day: [[8, 12.5, "work"], [13.5, 18.5, "work"]], sunday: [[8.75, 11, "church", "church"]] },
    stats: { honesty: 6, temper: 4, piety: 4, warmth: 5, greed: 5, courage: 6, gossip: 4, wealth: 5 },
    dog: null,
  };
  const shop: VeloShop = { id: SHOP_ID, label: `${r.name}'s velocipede workshop`, step: [d.sx, d.sz], wall: [d.x, d.z], out: d.out, at, show: pick.pts.slice(0, 2) };
  db.transaction(() => {
    db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)").run(r.id, r.name, TRADES.velo_maker.label, "town", r.faction);
    db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
    db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)").run(r.id, r.household, r.trade, JSON.stringify(r));
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (row) {
      const rest = JSON.parse(row.value_json) as { places: Record<string, unknown> };
      rest.places.velo_shop = { label: shop.label, x: d.sx, z: d.sz, r: 3, district: "town", door: [d.sx, d.sz], out: d.out };
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    }
    putState(db, "veloshop", shop);
  })();
  dropTownCache(db);
  dropStealables(db);
  return true;
}

// ------------------------------------------------------------------ Jef's machines

/** Jef's machines as velocipedes of the theft system (deeds.ts): owner "jef", his own. */
function jefAsVelos(db: DB): Velo[] {
  const shop = veloShop(db);
  const at = shop?.show[0] ?? [0, 0, 0];
  return jefVelos(db).list.map((v) => ({ id: v.id, owner: "jef", x: at[0], z: at[1], yaw: at[2], where: v.kind === "hire" ? "hired from the velocipede maker" : "his own" }));
}
veloHooks.jef = jefAsVelos;

/** What Jef has now (for the client): his machines, where they stand, the hire's end. */
export function jefVeloView(db: DB) {
  const s = jefVelos(db);
  const st = veloStates(db);
  const now = minuteNow(db);
  return {
    list: s.list.map((v) => ({ ...v, x: st[v.id]?.x, z: st[v.id]?.z, ridden: st[v.id]?.ridden ?? false, minutes_left: v.until !== undefined ? Math.max(0, v.until - now) : null })),
    notice: s.notice,
    shop: veloShop(db),
    prices: VELO_PRICE,
  };
}

function refuse(db: DB, kind: "new" | "used" | "hire"): void {
  if (!veloShop(db)) throw new GameError("there is no velocipede maker in this town", 409);
  const s = jefVelos(db);
  if (kind === "hire" && s.list.some((v) => v.kind === "hire")) throw new GameError("you have his hire machine already", 409);
  if (kind !== "hire" && s.list.some((v) => v.kind !== "hire")) throw new GameError("you have a velocipede of your own already", 409);
}

/** A new machine for Jef, standing at the maker's door (inside the buy's transaction). */
function give(db: DB, kind: "new" | "used" | "hire"): void {
  const s = jefVelos(db);
  const shop = veloShop(db)!;
  const now = minuteNow(db);
  const id = `velo:jef${++s.n}`;
  s.list.push({ id, kind, since: now, until: kind === "hire" ? now + VELO_HIRE_HOURS * 60 : undefined, paid_c: kind === "new" ? VELO_PRICE.new_c : kind === "used" ? VELO_PRICE.used_c : VELO_PRICE.hire_c });
  saveJef(db, s);
  const spot = shop.show[kind === "hire" ? 1 : 0] ?? shop.show[0];
  setVeloState(db, id, { x: spot[0], z: spot[1], yaw: spot[2], ridden: false, deed: null, own: true });
  log(db, kind === "hire" ? "hired_velo" : "bought_velo", id, kind === "hire" ? "Jef hired a velocipede for the day from the velocipede maker." : `Jef bought a ${kind === "new" ? "new" : "second-hand"} velocipede from the velocipede maker.`);
}

for (const [item, kind] of [["velocipede_new", "new"], ["velocipede_used", "used"], ["velocipede_hire", "hire"]] as const) {
  ITEM_REF[item] = (db) => {
    refuse(db, kind);
    return null;
  };
  ITEM_BUY[item] = (db) => give(db, kind);
}

/** Drop one of Jef's machines (fetched, stolen). */
function dropJef(db: DB, s: JefVelos, id: string): void {
  s.list = s.list.filter((v) => v.id !== id);
  setVeloState(db, id, null);
}

// ------------------------------------------------------------------ each game hour: hires that run out, thieves

/** Where Jef was last seen by the client (for "watched"); set by the route. */
const lastJef = new WeakMap<DB, { x: number; z: number; at: number }>();
export function jefSeen(db: DB, x: number, z: number, at = Date.now()): void {
  if (Number.isFinite(x) && Number.isFinite(z)) lastJef.set(db, { x, z, at });
}

const BUSY_IDS = new Set(["rijnkaai", "werf", "vismarkt", "grote_markt", "steenplein", "bassin", "bassin_south", "canal", "handschoenmarkt", "canal_quay"]);
/** A busy place: by a market, a quay or a tavern door. */
export function busyAt(db: DB, x: number, z: number): boolean {
  for (const [id, p] of Object.entries(town(db).town.places)) {
    if (!(BUSY_IDS.has(id) || id.startsWith("tavern:") || id.startsWith("market:"))) continue;
    if (Math.hypot(p.x - x, p.z - z) < BUSY_M + (id.startsWith("tavern:") ? 0 : p.r)) return true;
  }
  return false;
}

/** Safe: at Jef's rented home's door (M6 homes) or at the maker's. */
function safeAt(db: DB, x: number, z: number): boolean {
  const shop = veloShop(db);
  if (shop && Math.hypot(shop.step[0] - x, shop.step[1] - z) < 8) return true;
  const lease = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'home_lease'").get()
    ? (db.prepare("SELECT home FROM home_lease WHERE ended IS NULL ORDER BY id DESC LIMIT 1").get() as { home: string } | undefined)
    : undefined;
  if (!lease) return false;
  const home = getState<{ homes: Array<{ id: string; step: Pt }> }>(db, "homes")?.homes.find((h) => h.id === lease.home);
  return !!home && Math.hypot(home.step[0] - x, home.step[1] - z) < 8;
}

/**
 * The hour's work (from the tick): a hire that ran out is fetched (a fee), an unwatched
 * machine in a busy place may be ridden off. `rng` and `now` are test seams. Returns what happened.
 */
export function bikeHour(db: DB, rng: () => number = Math.random, now = Date.now()): string[] {
  // one transaction: a fee taken and the machine gone, or neither
  return db.transaction(() => bikeHourNow(db, rng, now))();
}

function bikeHourNow(db: DB, rng: () => number, now: number): string[] {
  const s = jefVelos(db);
  if (!s.list.length) return [];
  const minute = minuteNow(db);
  const hourNo = Math.floor(minute / 60);
  if (hourNo === s.rolled) return [];
  s.rolled = hourNo;
  const out: string[] = [];
  const st = veloStates(db);
  const p = player(db);
  const maker = town(db).byId.get(SHOP_ID);
  for (const v of [...s.list]) {
    const vs = st[v.id];
    if (!vs) continue;
    // a hire that ran out: his boy fetches it (not from under Jef: when he gets off)
    if (v.kind === "hire" && v.until !== undefined && minute >= v.until && !vs.ridden) {
      const shop = veloShop(db);
      const back = !!shop && Math.hypot(shop.step[0] - vs.x, shop.step[1] - vs.z) < 10;
      const fee = back ? 0 : Math.min(p.money_c, VELO_FETCH_FEE_C);
      if (fee) db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(fee);
      dropJef(db, s, v.id);
      const text = back
        ? "The day's hire is over; the velocipede is back at the maker's."
        : `The day's hire is over. The maker's boy fetched the velocipede from where you left it${fee ? `, and ${maker?.first ?? "the maker"} took ${fee} centimes for his trouble` : ""}.`;
      notice(s, text);
      log(db, "velo_fetched", v.id, text);
      out.push("fetched");
      continue;
    }
    // left alone in a busy place, Jef not by it: someone may ride off on it
    if (vs.ridden || safeAt(db, vs.x, vs.z) || !busyAt(db, vs.x, vs.z)) continue;
    const seen = lastJef.get(db);
    if (seen && now - seen.at < 30_000 && Math.hypot(seen.x - vs.x, seen.z - vs.z) < WATCHED_M) continue;
    const night = p.hour >= 20 || p.hour < 6;
    if (rng() >= (night ? VELO_THEFT_PER_HOUR.night : VELO_THEFT_PER_HOUR.day)) continue;
    stealFromJef(db, s, v, vs, rng);
    out.push("stolen");
  }
  saveJef(db, s);
  return out;
}

/** Someone rides off on Jef's machine: gone, a robbery on the record, the town talks. */
function stealFromJef(db: DB, s: JefVelos, v: JefVelo, vs: VeloState, rng: () => number): void {
  const t = town(db).town;
  const thieves = t.residents.filter((r) => r.trade === "thief");
  const thief = thieves.length ? thieves[Math.floor(rng() * thieves.length)] : null;
  const worth = v.paid_c;
  dropJef(db, s, v.id);
  const where = nearestPlaceLabel(db, vs.x, vs.z);
  const text = v.kind === "hire" ? "The velocipede you hired is gone from where you left it. The maker will want it paid for." : "Your velocipede is gone from where you left it. Somebody rode off on it.";
  notice(s, text);
  // on the record as a robbery of Jef: the M4 police case takes it up (director/actions.ts crimeOpen)
  if (thief) log(db, "robbed", thief.id, `Someone rode off on Jef's velocipede ${where}, worth ${worth} centimes.`, "world");
  // the town talks: someone who works by the spot saw a man ride off on it
  const near = t.residents
    .filter((r) => r.work.at && r.trade !== "thief")
    .map((r) => ({ r, d: Math.hypot(r.work.at![0] - vs.x, r.work.at![1] - vs.z) }))
    .sort((a, b) => a.d - b.d)[0];
  if (near && near.d < 60) {
    remember(db, near.r.id, `I saw a man ride off on the new man's velocipede ${where}. It was not Jef on it.`, 5, "seen", null, { gist: `Jef's velocipede was stolen ${where}`, tone: 0 });
  }
  // a hired machine lost: the maker is owed it, and remembers
  if (v.kind === "hire") remember(db, SHOP_ID, "The velocipede I hired to Jef was stolen from under his nose.", 4);
}

function nearestPlaceLabel(db: DB, x: number, z: number): string {
  let best = "in the street";
  let bd = 60;
  for (const p of Object.values(town(db).town.places)) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd && p.label) [bd, best] = [d, `by ${p.label}`];
  }
  return best;
}

/** A new game: Jef has no machine. */
export function clearJefVelos(db: DB): void {
  const s = jefVelos(db);
  for (const v of s.list) setVeloState(db, v.id, null);
  db.prepare("DELETE FROM world_state WHERE key = 'jef_velos'").run();
}
