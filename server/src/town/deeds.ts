import { z } from "zod";
import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { addPlayerColumn, pstate, RESET_HOOKS, setPstate } from "../player/multi.ts";
import { asPlayer, pid } from "../player/current.ts";
import { nameOf } from "../player/names.ts";
import { applyTrust, remember } from "../npcs.ts";
import { POCKET_SLOTS, atWork } from "../trade.ts";
import { fogDay, weather, type Weather } from "../day.ts";
import { activityAt } from "./schedule.ts";
import { TOWN_EMPLOYER_IDS, resident, town } from "./store.ts";
import { cityHouses, houseDoors, walkMap, WALL } from "./walkmap.ts";
import { shopTableSpot } from "../../../shared/shopFront.ts";
import type { Resident } from "./population.ts";
import { rowBoatHome, rowBoatStates, rowBoats, rowOn, rowState, setRowBoat, takePrompt, type LooseBoat } from "../rowing.ts";
import { HULLS } from "../../../shared/smallBoats.ts";
import { wantedFactor } from "../ideas/wanted.ts";
import { lampLit } from "./lampround.ts";
import { allLamps, lampRounds } from "./lamplighters.ts";
import { CHARISMA_LOW, charisma } from "./charisma.ts";
import SPOTS from "../../../shared/spots.json" with { type: "json" };
import CITY from "../../../shared/city.json" with { type: "json" };

// Theft (M3h). One system for everything Jef can take that is not his: the
// velocipedes by the doors of the well-off, the lanterns where people work,
// food off an open stall. Taking such a thing is a deed. The SERVER records
// what was taken, whose it was and who saw it; the client only reports the
// facts round Jef (who is near, how far, a clear line or not, which way they
// face), and every one of those facts is checked and clamped here, because
// the client is not trusted. Fog and the dark help the thief.
//
// Seen: trust lost with the owner and the witnesses, a memory each, a rumour
// that travels (rumours.ts), the owner shouts, chases or asks for it back, and
// the police come (police.ts). Unseen: the thing is Jef's, but the owner finds
// it gone, and a suspicion may start to go round a while later.

/** M3j: "boat" a rowing boat taken from its steps (rowing.ts); "boat_lost" one taken and wrecked; "boat_debt" a hired boat lost and never paid for. */
export type Thing = "velocipede" | "lantern" | "food" | "boat" | "boat_lost" | "boat_debt" | "handcart" | "purse";

/** Engine numbers per kind of thing: how bad it is (police points) and the fine. */
export const THINGS: Record<Thing, { severity: number; fine_c: number; noun: string }> = {
  velocipede: { severity: 3, fine_c: 60, noun: "velocipede" },
  lantern: { severity: 2, fine_c: 25, noun: "lantern" },
  food: { severity: 1, fine_c: 10, noun: "food" },
  boat: { severity: 3, fine_c: 50, noun: "rowing boat" },
  boat_lost: { severity: 5, fine_c: 100, noun: "rowing boat" },
  boat_debt: { severity: 2, fine_c: 30, noun: "boat" },
  // M6 handcart (town/handcart.ts): a household's handcart, taken from their door or their stall
  handcart: { severity: 2, fine_c: 40, noun: "handcart" },
  // M9 theft: a pocket picked (town/pickpocket.ts); took_c on the deed is the money, item_id a thing from it
  purse: { severity: 2, fine_c: 30, noun: "purse" },
};

/**
 * M6 handcart (town/handcart.ts sets these): a household's cart as a thing to take ("cart:<household>").
 * find: where it stands now and whether Jef has it already; taken: it is Jef's now (he holds it);
 * again: he takes hold of it again; home: back to its household; held: does he still have it for
 * this deed; gone: is it away from its household (the family cannot use it).
 */
export const cartHooks = {
  find: (_db: DB, _ref: string): { owner: string; x: number; z: number; yaw?: number; where: string; mine: { deed: number | null; held: boolean } | null; by?: number } | null => null,
  taken: (_db: DB, _ref: string, _deed: number, _at: { x: number; z: number; yaw: number }): void => {},
  again: (_db: DB, _ref: string): void => {},
  home: (_db: DB, _ref: string): void => {},
  held: (_db: DB, _d: DeedRow): boolean => false,
  gone: (_db: DB, _id: string): boolean => false,
};

/** Stall goods -> the food you can lift off the table. */
const FOOD_OF: Record<string, string> = { fish: "herring", bread: "bread", veg: "apple" };
const FOOD_NAME: Record<string, string> = { herring: "a herring", bread: "a loaf", apple: "an apple" };
/** A stall's table is not endless: this many lifts a day, then there is nothing in reach. */
const TAKES_PER_TABLE = 3;
/** How far the client may say Jef stands from the thing (m). */
const REACH_M = 4.5;

export const DEED_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS deed (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL, minute INTEGER NOT NULL,
  thing TEXT NOT NULL,
  item TEXT NOT NULL,
  ref TEXT NOT NULL,
  owner TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL,
  seen INTEGER NOT NULL,
  owner_saw INTEGER NOT NULL,
  witnesses TEXT NOT NULL DEFAULT '[]',
  item_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  rumour_at INTEGER
);`;

const ready = new WeakSet<DB>();
/** The deed table, made when the first deed is done (a save nobody stole in is left as it was). */
export function deedTables(db: DB): void {
  if (ready.has(db)) return;
  db.exec(DEED_SCHEMA);
  addPlayerColumn(db, "deed"); // M8c: whose deed
  deedColumns(db);
  ready.add(db);
}
/** M9 theft: took_c (money from a picked pocket), quiet (seen, but the talk is held back while someone has it out with him). */
function deedColumns(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(deed)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("took_c")) db.exec("ALTER TABLE deed ADD COLUMN took_c INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("quiet")) db.exec("ALTER TABLE deed ADD COLUMN quiet INTEGER NOT NULL DEFAULT 0");
}
/** Is there a deed table yet? Reading never makes one. */
export function hasDeeds(db: DB): boolean {
  if (ready.has(db)) return true;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deed'").get()) return false;
  addPlayerColumn(db, "deed");
  deedColumns(db);
  ready.add(db);
  return true;
}

export interface DeedRow {
  id: number;
  day: number;
  hour: number;
  minute: number;
  thing: Thing;
  item: string;
  ref: string;
  owner: string;
  x: number;
  z: number;
  seen: number;
  owner_saw: number;
  witnesses: string;
  item_id: number | null;
  /** M6: "let_off": the police believed his story; the thing went back all the same. */
  status: "open" | "returned" | "warned" | "fined" | "arrested" | "let_off" | "forgiven";
  rumour_at: number | null;
  /** M9: money from a picked pocket (a purse deed). */
  took_c?: number;
  /** M9: 1 while someone who saw it has it out with him (town/confront.ts): no talk, no police yet. */
  quiet?: number;
  /** M8c: whose deed (the player who took it). */
  player_id?: number;
}

/** A deed by its id, whoever's (the world's work reads it; a player's own route checks player_id). */
export function deedRow(db: DB, id: number): DeedRow | undefined {
  if (!hasDeeds(db)) return undefined;
  return db.prepare("SELECT * FROM deed WHERE id = ?").get(id) as DeedRow | undefined;
}

/** Game time in minutes since Monday 0:00: the clock for later rumours and police visits. */
export function gameMinute(db: DB): number {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return (p.day - 1) * 1440 + p.hour * 60 + p.minute;
}

function state<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as T) : fallback;
}
function setState(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

export function npcName(db: DB, id: string): string {
  return (db.prepare("SELECT name FROM npc WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "someone";
}
function firstName(db: DB, id: string): string {
  return resident(db, id)?.first ?? npcName(db, id).replace(/^(Widow|Agent|Pastoor|Meneer) /, "");
}

// ------------------------------------------------------------------ what there is to take

export interface Velo {
  id: string;
  owner: string;
  x: number;
  z: number;
  yaw: number;
  /** "from outside his house", "from outside Den Engel": for talk and memory. */
  where: string;
}
export interface WorkLamp {
  id: string;
  owner: string;
  x: number;
  z: number;
  /** Height it stands at (on a stall table it is higher than on the cobbles). */
  y: number;
  where: string;
}
export interface FoodSpot {
  id: string;
  keeper: string;
  x: number;
  z: number;
  item: string;
  where: string;
}
/**
 * M6 transport (town/possessions.ts, town/bikeshop.ts): more velocipedes than the six of M3h
 * (a few young men and clerks), where an owner's machine stands now by his day, and Jef's own
 * machines (bought or hired at the velocipede maker's). Defaults: the M3h behaviour.
 */
export const veloHooks = {
  extra: (_db: DB): Velo[] => [],
  at: (_db: DB, _v: Velo): { x: number; z: number; yaw: number } | null => null,
  jef: (_db: DB): Velo[] => [],
};

export interface Stealables {
  velos: Velo[];
  lamps: WorkLamp[];
  food: FoodSpot[];
}

type Pt = [number, number];
const spot = (id: string) => (SPOTS as unknown as Record<string, { x: number; z: number; label: string }>)[id];
const DOORS = (CITY as unknown as { designedDoors: Record<string, [number, number, number, number]> }).designedDoors;

const memo = new WeakMap<DB, Stealables>();

/** A point on open ground near (x, z), else the point itself. */
function open(x: number, z: number, max = 3): Pt {
  const q = walkMap().nearestOpen(x, z, max);
  return q ? [q.x, q.z] : [x, z];
}

/** Beside a house door, against the wall, where a well-off man leaves his velocipede. */
function byDoor(r: Resident): { x: number; z: number; yaw: number } | null {
  const d = houseDoors().find((h) => h.house === r.home.house);
  const out: Pt = d ? d.out : norm([r.home.sx - r.home.x, r.home.sz - r.home.z]);
  const x0 = d ? d.x : r.home.x;
  const z0 = d ? d.z : r.home.z;
  const side: Pt = [-out[1], out[0]];
  for (const o of [1.0, 1.25])
    for (const s of [1.7, -1.7, 2.4, -2.4]) {
      const x = x0 + out[0] * o + side[0] * s;
      const z = z0 + out[1] * o + side[1] * s;
      if (walkMap().open(x, z, 0.3) && walkMap().reachable(x, z)) return { x: r1(x), z: r1(z), yaw: Math.atan2(side[0], side[1]) };
    }
  return null;
}
const norm = (v: Pt): Pt => {
  const L = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / L, v[1] / L];
};
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Everything in the town that can be taken, made from the town itself (so the
 * same seed always gives the same list). Velocipedes: rare and dear in 1873,
 * so only the well-off have one: the merchants, the brewer, a draper or the
 * pawnbroker, the publican of Den Engel on the Grote Markt, a clerk at the
 * Entrepot. Lanterns: where people work after dark. Food: the open stalls.
 */
export function stealables(db: DB): Stealables {
  const had = memo.get(db);
  if (had) return had;
  const { town: t } = town(db);
  const R = t.residents;
  const velos: Velo[] = [];
  const addVelo = (r: Resident | undefined, where: string, at?: { x: number; z: number; yaw: number } | null) => {
    if (!r || velos.length >= 6 || velos.some((v) => v.owner === r.id)) return;
    const p = at ?? byDoor(r);
    if (!p) return;
    velos.push({ id: `velo:${velos.length + 1}`, owner: r.id, x: p.x, z: p.z, yaw: p.yaw, where });
  };
  for (const r of R.filter((r) => r.trade === "merchant").slice(0, 2)) addVelo(r, "from outside his house");
  addVelo(R.find((r) => r.id === "brouwer"), "from outside his house");
  const shopHead = R.find((r) => (r.trade === "draper" || r.trade === "pawnbroker") && r.family_role === "head");
  if (shopHead) addVelo(shopHead, "from outside his house");
  // a café on the Grote Markt: Den Engel (else any tavern with a publican)
  for (const key of ["tavern:engel", "tavern:bassin", "tavern:ankere"]) {
    const pl = t.places[key];
    const pub = R.find((r) => r.trade === "publican" && r.work.place === key);
    if (!pl?.door || !pub) continue;
    const out = pl.out ?? [0, -1];
    const side: Pt = [-out[1], out[0]];
    const [x, z] = open(pl.door[0] + side[0] * 2.2, pl.door[1] + side[1] * 2.2, 2);
    addVelo(pub, `from outside ${pl.label}`, { x: r1(x), z: r1(z), yaw: Math.atan2(side[0], side[1]) });
    break;
  }
  // the Entrepot office: the clerk there rides in from the town
  {
    const clerk = R.find((r) => r.trade === "clerk" && r.work.place === "entrepot") ?? R.find((r) => r.id === "katoen");
    const d = DOORS.entrepot;
    if (clerk && d) {
      const [dx, dz, ox, oz] = d;
      const [x, z] = open(dx + ox * 1.2 + oz * 3.2, dz + oz * 1.2 - ox * 3.2, 2);
      addVelo(clerk, "from outside the Entrepot office", { x: r1(x), z: r1(z), yaw: Math.atan2(-oz, ox) });
    }
  }
  // M6 transport: a few young men and clerks who ride far in their day (town/possessions.ts)
  for (const v of veloHooks.extra(db)) if (!velos.some((q) => q.id === v.id || q.owner === v.owner)) velos.push(v);

  // lanterns standing where people work (lit after dark)
  const lamps: WorkLamp[] = [];
  const addLamp = (id: string, owner: string | undefined, x: number, z: number, where: string, y = 0) => {
    if (!owner) return;
    const [ox, oz] = y > 0 ? [x, z] : open(x, z, 2.5);
    lamps.push({ id: `lamp:${id}`, owner, x: r1(ox), z: r1(oz), y, where });
  };
  const worksAt = (place: string, kind?: string) => R.find((r) => r.work.place === place && (!kind || r.work.kind === kind) && r.age >= 18);
  {
    const [hx, hz, ox, oz] = DOORS.hessenatie ?? [14, 46, 0, -1];
    addLamp("hessenatie", "sooi", hx + ox * 2.6 + 2.6, hz + oz * 2.6, "by the Hessenatie door");
  }
  const rk = R.find((r) => r.work.place === "rijnkaai" && r.work.kind === "haul" && r.work.a);
  if (rk?.work.a) addLamp("rijnkaai", rk.id, rk.work.a[0] + 1.6, rk.work.a[1] + 1.2, "on the Rijnkaai, where the dockers work");
  {
    const k = spot("katoen_door");
    addLamp("entrepot", "katoen", k.x - 2.2, k.z - 2.5, "by the Entrepot door");
  }
  const wf = R.find((r) => r.work.place === "werf" && r.work.kind === "haul" && r.work.a);
  if (wf?.work.a) addLamp("werf", wf.id, wf.work.a[0] + 1.6, wf.work.a[1] + 1.5, "on the Werf, where the dock gang works");
  // the lock of the Petit Bassin: the men of the bassin keep a lantern by the capstan
  addLamp("lock", worksAt("bassin", "haul")?.id, 99, 24.5, "by the lock of the Petit Bassin");
  {
    const b = spot("brewery_yard");
    addLamp("brewery", "brouwer", b.x + 1.5, b.z - 2.2, "by the brewery door");
  }
  // a lamp on a stall table at each market
  for (const place of ["vismarkt", "grote_markt"]) {
    const s = t.stalls.find((s) => s.place === place && s.keeper);
    if (!s) continue;
    const side: Pt = [-s.face[1], s.face[0]];
    addLamp(`stall_${place}`, s.keeper!, s.x + side[0] * 1.0, s.z + side[1] * 1.0, `on a stall at ${place === "vismarkt" ? "the Vismarkt" : "the Grote Markt"}`, 0.86);
  }

  // food on the open stalls and shop tables
  const food: FoodSpot[] = [];
  t.stalls.forEach((s, i) => {
    const item = FOOD_OF[s.goods];
    if (!item || !s.keeper) return;
    food.push({ id: `stall:${i}`, keeper: s.keeper, x: s.x, z: s.z, item, where: `${firstName(db, s.keeper)}'s stall` });
  });
  for (const sh of t.shops) {
    const item = FOOD_OF[sh.goods ?? ""];
    if (!item) continue;
    // the table beside the door, on the shop's own house front (shared/shopFront.ts, as client/src/game/stalls.ts draws it)
    const spot = shopTableSpot(cityHouses(), sh);
    if (!spot) continue;
    const [x, z] = spot.food;
    food.push({ id: `shop:${sh.id}`, keeper: sh.keeper, x: r1(x), z: r1(z), item, where: sh.label });
  }
  const out = { velos, lamps, food };
  memo.set(db, out);
  return out;
}

/** Forget the list (a new game makes a new town). */
export function dropStealables(db: DB): void {
  memo.delete(db);
}

// ------------------------------------------------------------------ where the velocipedes are now

export interface VeloState {
  x: number;
  z: number;
  yaw: number;
  /** Jef is on it. */
  ridden: boolean;
  /** The open deed that made it Jef's, if any. */
  deed: number | null;
  /** Lying on its side after a fall. */
  down?: boolean;
  /** M6: Jef's own machine (bought, or hired for the day): no deed, no owner to miss it. */
  own?: boolean;
  /** M8c: the player who has it (rides it, took it, or owns it); none: the host. */
  by?: number;
}

/** M8c: whose it is now (the rider, the taker, the owner), for a velocipede that is anyone's. */
export function veloBy(s: VeloState): number {
  return s.by ?? 1;
}

export function veloStates(db: DB): Record<string, VeloState> {
  const saved = state<Record<string, VeloState>>(db, "velos", {});
  const out: Record<string, VeloState> = {};
  for (const v of stealables(db).velos) {
    const s = saved[v.id] ?? { x: v.x, z: v.z, yaw: v.yaw, ridden: false, deed: null };
    // M6 transport: the owner's own machine goes where his day takes it (not while Jef has it)
    const at = s.deed === null && !s.ridden && !s.own ? veloHooks.at(db, v) : null;
    out[v.id] = at ? { ...s, x: at.x, z: at.z, yaw: at.yaw, down: false } : s;
  }
  // M6: Jef's own machines stand where he left them
  for (const v of veloHooks.jef(db)) out[v.id] = saved[v.id] ?? { x: v.x, z: v.z, yaw: v.yaw, ridden: false, deed: null, own: true, by: pid() };
  return out;
}
function saveVelo(db: DB, id: string, s: VeloState): void {
  // (M8c: over the saved states, so the other players' own machines keep theirs)
  const all = { ...state<Record<string, VeloState>>(db, "velos", {}), ...veloStates(db) };
  all[id] = s;
  setState(db, "velos", all);
}

/** M6 (town/bikeshop.ts): set or drop the saved state of a machine (Jef's own: bought, hired, stolen from him). */
export function setVeloState(db: DB, id: string, st: VeloState | null): void {
  const all = state<Record<string, VeloState>>(db, "velos", {});
  if (st) all[id] = st;
  else delete all[id];
  setState(db, "velos", all);
}

/** Back where it belongs (returned, or the police took it back to its owner). */
export function veloHome(db: DB, id: string): void {
  const v = stealables(db).velos.find((q) => q.id === id);
  if (v) saveVelo(db, id, { x: v.x, z: v.z, yaw: v.yaw, ridden: false, deed: null });
}

/** Jef gets off and leaves it here. The spot must be open ground; else the nearest that is. */
export function leaveVelo(db: DB, id: string, x: number, z: number, yaw: number, down = false): VeloState {
  const all = veloStates(db);
  const s = all[id];
  if (!s) throw new GameError("no such velocipede", 404);
  if (!s.ridden) throw new GameError("you are not on it", 409);
  // (M8c: only the rider gets off)
  if (veloBy(s) !== pid()) throw new GameError("someone else rides it", 409);
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new GameError("bad place", 400);
  const wm = walkMap();
  const q = wm.open(x, z, 0.25) ? { x, z } : wm.nearestOpen(x, z, 4);
  if (!q) throw new GameError("you cannot leave it there", 409);
  const next: VeloState = { x: r1(q.x), z: r1(q.z), yaw: Number.isFinite(yaw) ? +yaw.toFixed(3) : s.yaw, ridden: false, deed: s.deed, down, ...(s.own ? { own: true } : {}), ...(s.by !== undefined ? { by: s.by } : {}) };
  saveVelo(db, id, next);
  return next;
}

/** Lanterns taken today (the gang has a new one at dawn). */
function lampsTaken(db: DB, day: number): string[] {
  return state<string[]>(db, `lamps_taken:${day}`, []);
}
function tableTakes(db: DB, day: number): Record<string, number> {
  return state<Record<string, number>>(db, `table_takes:${day}`, {});
}

/** For the client: what stands where, now. No numbers about Jef. */
export function deedWorld(db: DB) {
  const s = stealables(db);
  const day = player(db).day;
  const taken = new Set(lampsTaken(db, day));
  const vs = veloStates(db);
  return {
    velos: [
      // (M8c: mine: taken by the player who asks; by: who rides it now, null when nobody does)
      ...s.velos.map((v) => ({ id: v.id, owner: v.owner, owner_name: npcName(db, v.owner), ...vs[v.id], mine: vs[v.id].deed !== null && veloBy(vs[v.id]) === pid(), by: vs[v.id].ridden ? veloBy(vs[v.id]) : null })),
      // M6: Jef's own (bought, or hired for the day)
      ...veloHooks.jef(db).filter((v) => vs[v.id]).map((v) => ({ id: v.id, owner: v.owner, owner_name: "you", ...vs[v.id], mine: true, own: true, by: vs[v.id].ridden ? veloBy(vs[v.id]) : null })),
    ],
    lamps: s.lamps.filter((l) => !taken.has(l.id)).map((l) => ({ ...l, owner_name: npcName(db, l.owner) })),
    food: s.food.map((f) => ({ ...f, name: FOOD_NAME[f.item] })),
  };
}

// ------------------------------------------------------------------ who saw it

/** One person near Jef, as the client reports it. Clamped below; never trusted as is. */
export const WitnessSchema = z.object({
  id: z.string().min(1).max(24),
  d: z.number(),
  los: z.boolean(),
  facing: z.number().optional(),
});
export const DeedRequestSchema = z.object({
  ref: z.string().min(1).max(40),
  x: z.number(),
  z: z.number(),
  witnesses: z.array(WitnessSchema).max(60).default([]),
  crouch: z.boolean().default(false),
  lantern: z.boolean().default(false),
});
export type DeedRequest = z.infer<typeof DeedRequestSchema>;

export interface Witness {
  id: string;
  d: number;
  los: boolean;
  facing: number;
  /** The owner, or the keeper of the stall. */
  owner: boolean;
}

/** How far a body is made out, by weather (m), in daylight. */
export const SIGHT_M: Record<Weather | "storm", number> = { clear: 38, mist: 26, rain: 20, fog: 13, storm: 16 };

export interface SeeCtx {
  weather: Weather | "storm";
  hour: number;
  /** Jef's lantern is lit in his hand: the dark does not hide him. */
  lantern: boolean;
  crouch: boolean;
  /** M9: how lit the spot of the deed is, 0-1 (lightAt: the day, a burning street lamp, his lantern). Missing: by the hour alone. */
  light?: number;
}

/** Light in the street, 0-1: night hides, dusk and dawn half hide. */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 20 || h < 6) return 0;
  if (h >= 18 || h < 7) return 0.5;
  return 1;
}

/**
 * M9 theft (Steve 2026-09-27: "we are better visible in light than in dark; in the dark people need to
 * be really close by and looking at us"; "pickpocketing under a street light can be seen from quite far").
 * The light at the spot: a dark street is NIGHT_LIGHT (sight a few metres), a burning gas lamp lights
 * LAMP_LIGHT at its foot and less out to LAMP_REACH_M, his own lit lantern LANTERN_LIGHT.
 */
export const NIGHT_LIGHT = 0.1;
export const LAMP_LIGHT = 0.85;
export const LAMP_REACH_M = 13;
export const LANTERN_LIGHT = 0.9;
/** Below this the street is dark: only a face turned his way sees anything. */
export const DARK_LIGHT = 0.4;

/** Light from one gas lamp at d metres (pure): full to 3 m, gone at LAMP_REACH_M. */
export function lampLight(d: number): number {
  if (d <= 3) return LAMP_LIGHT;
  if (d >= LAMP_REACH_M) return 0;
  return LAMP_LIGHT * (1 - (d - 3) / (LAMP_REACH_M - 3));
}

/** The light by the hour alone (0-1), no lamp: NIGHT_LIGHT at night, full by day. */
export function hourLight(hour: number): number {
  return NIGHT_LIGHT + (1 - NIGHT_LIGHT) * daylight(hour);
}

/** The strongest light of a burning street lamp at (x, z) at this hour (lamplighters' rounds; 0 by day). */
export function lampLightAt(db: DB, x: number, z: number, hour: number): number {
  if (daylight(hour) >= 1) return 0;
  let best = 0;
  const rounds = lampRounds(db)?.rounds ?? [];
  if (rounds.length) {
    const fog = fogDay(db);
    for (const r of rounds)
      r.lamps.forEach((l, k) => {
        const d = Math.hypot(l.x - x, l.z - z);
        if (d < LAMP_REACH_M && lampLight(d) > best && lampLit(r, k, hour, fog)) best = lampLight(d);
      });
  } else for (const l of allLamps()) best = Math.max(best, lampLight(Math.hypot(l.x - x, l.z - z)));
  return best;
}

/** How lit the spot is now, 0-1: the day, a burning street lamp near, his own lit lantern. */
export function lightAt(db: DB, x: number, z: number, hour: number, lantern = false): number {
  return Math.max(hourLight(hour), lampLightAt(db, x, z, hour), lantern ? LANTERN_LIGHT : 0);
}

/** The chance (0-1) that this person saw it. Pure: the numbers of the theft system. */
export function seeChance(w: Witness, c: SeeCtx, trade?: string, age = 30): number {
  const light = c.light ?? Math.max(hourLight(c.hour), c.lantern ? LANTERN_LIGHT : 0);
  const R = (SIGHT_M[c.weather] ?? 13) * light;
  const s = Math.max(0, Math.min(1, 1 - w.d / R));
  let p = w.los ? Math.pow(s, 0.6) : w.d < 4 ? 0.25 : 0; // no clear line: only a sound close by
  // who they are: the owner minds his own things; children and thieves are no witnesses to speak of
  let att = w.owner ? 0.9 : 0.6;
  if (age < 12) att = 0.45;
  if (trade === "thief") att = 0.3;
  if (trade === "police") att = 1;
  // a sentry on duty watches the street (but never lays hands on anyone: garrison.ts)
  if (trade === "sentry" || trade === "corporal") att = Math.max(att, 0.8);
  // in the dark only a face turned his way makes anything out
  const dark = light < DARK_LIGHT;
  const f = Math.max(-1, Math.min(1, w.facing));
  att *= f > 0.3 ? 1 : f > -0.3 ? (dark ? 0.3 : 0.6) : dark ? 0.05 : 0.25;
  p *= att;
  if (c.crouch) p *= 0.75;
  return Math.max(0, Math.min(1, p));
}

/** Can this person see anything at all now (out in the street, per the engine's clock)? */
export function isOutNow(db: DB, id: string): boolean {
  const r = resident(db, id);
  if (!r) return true; // the named people of the quay stand at their posts
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  const now = activityAt(r.sched, p.day, p.hour + p.minute / 60);
  if (now.act === "home" || now.act === "church") return false;
  if (now.act === "work" && r.work.kind === "inside") return false;
  return true;
}

/**
 * The client's list, cleaned: known people only, out in the street now, each
 * once, distances clamped to 0-80 m, facing to -1..1, at most 16. The owner of
 * a stall is added by the engine when the client left them out, at the
 * distance the engine knows (a keeper stands at the table).
 */
export function cleanWitnesses(db: DB, raw: DeedRequest["witnesses"], owner: string, known?: { x: number; z: number; at?: [number, number] | null }): Witness[] {
  const seen = new Set<string>();
  const exists = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  const out: Witness[] = [];
  for (const w of raw) {
    if (out.length >= 16) break;
    const id = w.id.trim();
    if (seen.has(id) || !exists.get(id) || !isOutNow(db, id)) continue;
    seen.add(id);
    const d = Number.isFinite(w.d) ? Math.max(0, Math.min(80, w.d)) : 80;
    const facing = Number.isFinite(w.facing) ? Math.max(-1, Math.min(1, w.facing!)) : 0.5;
    out.push({ id, d, los: w.los === true, facing, owner: id === owner });
  }
  // a keeper at the stall is where the engine says, whatever the client reports
  if (known?.at) {
    const d = Math.hypot(known.at[0] - known.x, known.at[1] - known.z) + 1.3;
    const mine = out.find((w) => w.id === owner);
    if (mine) {
      mine.d = Math.min(mine.d, d);
      mine.los = true;
    } else if (isOutNow(db, owner)) out.push({ id: owner, d, los: true, facing: 0.5, owner: true });
  }
  return out;
}

// ------------------------------------------------------------------ the deed

/**
 * What a witness does (M9 theft, Steve 2026-09-27: "if they are brave enough they come to confront, or
 * otherwise they go look for police and shout them over"). "confront": walks up to have it out with him
 * (town/confront.ts); "fetch": runs for the nearest agent, shouting; "shout": shouts and stays; "police":
 * an agent saw it himself. M7 boats keep "chase" and "ask" (their owner runs for the quay or asks).
 */
export type Reaction = "shout" | "chase" | "ask" | "confront" | "fetch" | "police";

export interface ReactionOut {
  who: string;
  name: string;
  kind: Reaction;
  line: string;
}

export interface DeedResult {
  deed: number | null;
  /** Taking back what is already Jef's (his stolen velocipede): no new deed. */
  again: boolean;
  seen: boolean;
  owner_saw: boolean;
  seen_by: Array<{ id: string; name: string }>;
  owner: { id: string; name: string };
  /** The first of `reactions` (the one the client plays first; M7 boats: the owner's). */
  reaction: ReactionOut | null;
  /** M9: everyone who does something about it (a confronter, a runner for the police, shouters). */
  reactions?: ReactionOut[];
  /** M9: who half saw it and looks your way ("Hm?"): run now and they are sure (town/confront.ts noticed). */
  suspects?: Array<{ id: string; name: string }>;
  text: string;
  police: boolean;
  /** M9: game minutes until the agent sets out (0: an agent saw it; FETCH_MIN: someone ran for one). */
  police_in?: number;
  /** M9: the agent who saw it himself. */
  police_agent?: string | null;
  item_id: number | null;
  /** M8d: other players who saw it (each is told, and the police may ask him). */
  players_saw?: Array<{ id: number; name: string }>;
}

/** M9: game minutes before the agent comes when a witness ran to fetch him (a game minute is two real seconds). */
export const FETCH_MIN = 6;
/** M9: a roll this much over the chance to see makes a suspect (half saw it) instead of nobody. */
export const SUSPECT_SPAN = 1.8;
/** M9: game minutes a suspect keeps looking (run while he does and he is sure). */
export const SUSPECT_MIN = 10;

// ------------------------------------------------------------------ M8d: players as witnesses

/** Another player in the game and where he stands (director/actions.ts playersAt; the thief himself left out). */
export interface OtherPlayer {
  id: number;
  x: number;
  z: number;
}

/** No house wall on the line between two points (the walk map's walls; the client's own check, game/deeds.ts los). */
export function clearLine(ax: number, az: number, bx: number, bz: number): boolean {
  const wm = walkMap();
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
  for (let i = 1; i < n; i++) if (wm.flags(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n) & WALL) return false;
  return true;
}

/**
 * The other players who saw a deed at `at`: within the street's sight by the weather and the light (a crouching
 * thief a quarter less), with a clear line. A player takes in what happens round him (no dice: the engine says he
 * saw it). Pure but for the walk map.
 */
export function playerEyes(others: OtherPlayer[], at: { x: number; z: number }, c: SeeCtx): Array<OtherPlayer & { d: number }> {
  const R = (SIGHT_M[c.weather] ?? 13) * (c.light ?? Math.max(hourLight(c.hour), c.lantern ? LANTERN_LIGHT : 0)) * (c.crouch ? 0.75 : 1);
  return others
    .map((o) => ({ ...o, d: Math.hypot(o.x - at.x, o.z - at.z) }))
    .filter((o) => Number.isFinite(o.d) && o.d <= R && clearLine(o.x, o.z, at.x, at.z))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);
}

/** Another player's name as a player is told it (a plain "Jef", the host, kept from the teller's own edge). */
function playerName(db: DB, id: number): string {
  const n = nameOf(db, id);
  return n === "Jef" ? "Je‍f" : n;
}

export interface SeenNotice {
  n: number;
  deed: number;
  text: string;
}

/** What player `who` saw ("You saw Anna take the lantern."): kept a short while in his own keys; the client says each once. */
export function noteSeen(db: DB, who: number, deed: number, text: string): void {
  const list = pstate<SeenNotice[]>(db, "deeds_seen", who) ?? [];
  const n = (list[list.length - 1]?.n ?? 0) + 1;
  setPstate(db, "deeds_seen", [...list, { n, deed, text }].slice(-6), who);
}

export function seenNotices(db: DB): SeenNotice[] {
  return pstate<SeenNotice[]>(db, "deeds_seen") ?? [];
}

/** How the owner answers a theft under their nose: by their stats (engine). */
export function reactionOf(db: DB, owner: string): Reaction {
  const r = resident(db, owner);
  // the quay's own people and the board's employers keep their posts: they shout, and remember
  if (!r || TOWN_EMPLOYER_IDS.includes(owner)) return "shout";
  if (r.age < 14 || r.age >= 65) return "shout";
  if (r.stats.courage >= 6 && r.stats.temper >= 5) return "chase";
  if (r.stats.warmth >= 6 || r.stats.courage <= 3) return "ask";
  return "shout";
}

function reactionLine(db: DB, who: string, kind: Reaction, noun: string, owner: boolean): string {
  const n = firstName(db, who);
  if (!owner) return `${n} shouts: "Thief! Stop, thief! That's not his ${noun}!"`;
  if (kind === "chase") return `${n} shouts and comes after you: "Stop! Thief! That's my ${noun}!"`;
  if (kind === "ask") return `${n}: "That's my ${noun}. Give it back, now, and we'll say no more."`;
  return `${n}: "Thief! Thief! That's my ${noun}!"`;
}

/** Find the thing the client means, and check it can be taken now. */
function findThing(db: DB, ref: string) {
  const s = stealables(db);
  if (ref.startsWith("velo:")) {
    const v = s.velos.find((q) => q.id === ref) ?? veloHooks.jef(db).find((q) => q.id === ref);
    if (!v) throw new GameError("no such velocipede", 404);
    const st = veloStates(db)[ref];
    return { thing: "velocipede" as Thing, item: "velocipede", owner: v.owner, x: st.x, z: st.z, where: v.where, noun: "velocipede", velo: st, at: null };
  }
  if (ref.startsWith("cart:")) {
    const c = cartHooks.find(db, ref);
    if (!c) throw new GameError("no such handcart", 404);
    return { thing: "handcart" as Thing, item: "handcart", owner: c.owner, x: c.x, z: c.z, where: c.where, noun: "handcart", velo: null, at: null, cart: c };
  }
  if (ref.startsWith("boat:")) {
    const b = rowBoats(db).find((q) => q.id === ref);
    if (!b) throw new GameError("no such boat", 404);
    const st = rowBoatStates(db)[ref];
    if (st.lostDay !== undefined) throw new GameError("it is gone", 409);
    return { thing: "boat" as Thing, item: b.kind, owner: b.owner ?? "", x: st.x, z: st.z, where: b.where, noun: HULLS[b.kind].noun, velo: null, at: null, boat: b };
  }
  if (ref.startsWith("lamp:")) {
    const l = s.lamps.find((q) => q.id === ref);
    if (!l) throw new GameError("no such lantern", 404);
    return { thing: "lantern" as Thing, item: "lantern", owner: l.owner, x: l.x, z: l.z, where: l.where, noun: "lantern", velo: null, at: null };
  }
  const f = s.food.find((q) => q.id === ref);
  if (!f) throw new GameError("nothing like that here", 404);
  const k = resident(db, f.keeper);
  const at: [number, number] | null = k?.work.at ? [k.work.at[0], k.work.at[1]] : null;
  return { thing: "food" as Thing, item: f.item, owner: f.keeper, x: f.x, z: f.z, where: f.where, noun: f.item === "herring" ? "fish" : f.item, velo: null, at };
}

function freeSlots(db: DB): number {
  return POCKET_SLOTS - (db.prepare("SELECT COUNT(*) AS n FROM item WHERE player_id = ?").get(pid()) as { n: number }).n;
}

/**
 * Jef takes a thing that is not his. The engine decides who saw it and what
 * it costs him. `rng` is a test seam.
 */
export function takeThing(db: DB, raw: unknown, rng: () => number = Math.random, others: OtherPlayer[] = []): DeedResult {
  deedTables(db);
  const parsed = DeedRequestSchema.safeParse(raw);
  if (!parsed.success) throw new GameError("bad report", 400);
  const req = parsed.data;
  if (!Number.isFinite(req.x) || !Number.isFinite(req.z)) throw new GameError("bad place", 400);
  const t = findThing(db, req.ref);
  // M7 boats: a boat has its own rules (only her owner's eyes count; one nobody owns is no theft); the
  // reach is to the nearest point of her hull (a long boat is got into at her end)
  const tb = (t as { boat?: LooseBoat }).boat;
  if (tb) {
    const st = rowBoatStates(db)[tb.id];
    const fx = Math.sin(st.yaw);
    const fz = Math.cos(st.yaw);
    const half = HULLS[tb.kind].half;
    const along = Math.max(-half, Math.min(half, (req.x - st.x) * fx + (req.z - st.z) * fz));
    if (Math.hypot(req.x - st.x - fx * along, req.z - st.z - fz * along) > REACH_M) throw new GameError("too far away to take it", 409);
    return takeBoat(db, req, tb);
  }
  if (Math.hypot(req.x - t.x, req.z - t.z) > REACH_M) throw new GameError("too far away to take it", 409);
  const p = player(db);
  const ownerName = npcName(db, t.owner);

  // can it be taken now?
  if (t.velo) {
    // (M8c: another player's, ridden or taken and not given back, is not there to take)
    if (t.velo.ridden && veloBy(t.velo) !== pid()) throw new GameError("someone else rides it", 409);
    if (t.velo.deed !== null && veloBy(t.velo) !== pid()) throw new GameError("someone else has that one", 409);
    if (t.velo.ridden) throw new GameError("you are already on it", 409);
    if (Object.values(veloStates(db)).some((s) => s.ridden && veloBy(s) === pid())) throw new GameError("you are already riding one", 409);
    if (t.velo.deed !== null || t.velo.own) {
      // his already (taken before and not given back, or his own): up he gets, no new deed
      saveVelo(db, req.ref, { ...t.velo, ridden: true, down: false, by: pid() });
      return { deed: t.velo.deed, again: true, seen: false, owner_saw: false, seen_by: [], owner: { id: t.owner, name: ownerName }, reaction: null, text: "", police: false, item_id: null };
    }
  } else if (t.thing === "boat") {
    // M3j: a rowing boat, like a velocipede: no pocket; his already (taken before): back in, no new deed
    const st = rowBoatStates(db)[req.ref];
    if (st.ridden) throw new GameError("you are already in it", 409);
    if (rowState(db).on) throw new GameError("you are in a boat already", 409);
    if (st.deed !== null) {
      setRowBoat(db, req.ref, { ...st, ridden: true });
      rowOn(db, req.ref);
      return { deed: st.deed, again: true, seen: false, owner_saw: false, seen_by: [], owner: { id: t.owner, name: ownerName }, reaction: null, text: "", police: false, item_id: null };
    }
  } else if (t.thing === "handcart") {
    // M6: a household's handcart: no pocket; his already (taken before): hold of it again, no new deed
    const c = (t as { cart?: ReturnType<typeof cartHooks.find> }).cart;
    // (M8c: another player has it)
    if (c?.by !== undefined && c.by !== pid()) throw new GameError("someone else has that one", 409);
    if (c?.mine) {
      if (c.mine.held) throw new GameError("you have hold of it already", 409);
      cartHooks.again(db, req.ref);
      return { deed: c.mine.deed, again: true, seen: false, owner_saw: false, seen_by: [], owner: { id: t.owner, name: ownerName }, reaction: null, text: "", police: false, item_id: null };
    }
  } else if (freeSlots(db) < 1) throw new GameError("your pockets are full", 409);
  if (t.thing === "lantern" && lampsTaken(db, p.day).includes(req.ref)) throw new GameError("it is gone already", 409);
  if (t.thing === "food") {
    if (!atWork(db, t.owner)) throw new GameError("the goods are under a tarred tarpaulin, tied down", 409);
    if ((tableTakes(db, p.day)[req.ref] ?? 0) >= TAKES_PER_TABLE) throw new GameError("nothing left within reach", 409);
  }

  // who saw it (M9: by the light at the spot: the day, a burning street lamp, his lantern)
  const ws = cleanWitnesses(db, req.witnesses, t.owner, { x: t.x, z: t.z, at: t.at });
  const ctx: SeeCtx = { weather: weather(db), hour: p.hour, lantern: req.lantern, crouch: req.crouch, light: lightAt(db, t.x, t.z, p.hour, req.lantern) };
  const saw: Witness[] = [];
  const suspects: Witness[] = [];
  let nearMiss = false;
  // M6 ideas: a wanted bill with Jef's name on a wall: the town watches him (ideas/wanted.ts)
  const eyes = wantedFactor(db);
  for (const w of ws) {
    const r = resident(db, w.id);
    const chance = Math.min(1, seeChance(w, ctx, r?.trade, r?.age ?? 40) * eyes);
    const u = rng();
    if (u < chance) saw.push(w);
    else {
      if (w.d < 12) nearMiss = true;
      // M9: half saw it: he looks your way, and makes up his mind by what you do next
      if (chance > 0.02 && u < chance * SUSPECT_SPAN && w.d < 25 && r?.trade !== "thief") suspects.push(w);
    }
  }
  // the owner at home by his door may look out of the window
  let windowSaw = false;
  if (t.velo && !ws.some((w) => w.owner)) {
    const r = resident(db, t.owner);
    if (r && !isOutNow(db, t.owner) && Math.hypot(r.home.sx - t.x, r.home.sz - t.z) < 6 && rng() < 0.12 * (0.5 + 0.5 * daylight(p.hour))) {
      windowSaw = true;
      saw.push({ id: t.owner, d: 4, los: true, facing: 1, owner: true });
    }
  }
  // thieves see, but thieves do not tell
  const tellers = saw.filter((w) => resident(db, w.id)?.trade !== "thief");
  const seen = tellers.length > 0;
  const ownerSaw = tellers.some((w) => w.owner);
  const now = gameMinute(db);
  const rumourAt = !seen && rng() < 0.25 + (nearMiss ? 0.25 : 0) ? now + 60 + Math.floor(rng() * 120) : null;

  let itemId: number | null = null;
  let deedId = 0;
  const pm = db.prepare("SELECT minute FROM player WHERE id = 1").get() as { minute: number };
  db.transaction(() => {
    if (t.thing !== "velocipede" && t.thing !== "boat" && t.thing !== "handcart") {
      const r = db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES (?, NULL, ?)").run(t.item, pid());
      itemId = Number(r.lastInsertRowid);
    }
    const ins = db
      .prepare(
        `INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status, rumour_at, player_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(p.day, p.hour, pm.minute, t.thing, t.item, req.ref, t.owner, t.x, t.z, seen ? 1 : 0, ownerSaw ? 1 : 0, JSON.stringify(tellers.map((w) => w.id)), itemId, rumourAt, pid());
    deedId = Number(ins.lastInsertRowid);
    if (t.velo) saveVelo(db, req.ref, { ...t.velo, ridden: true, deed: deedId, down: false, by: pid() });
    if (t.thing === "boat") {
      setRowBoat(db, req.ref, { ...rowBoatStates(db)[req.ref], ridden: true, deed: deedId });
      rowOn(db, req.ref);
    }
    if (t.thing === "handcart") {
      const c = (t as { cart?: ReturnType<typeof cartHooks.find> }).cart;
      cartHooks.taken(db, req.ref, deedId, { x: t.x, z: t.z, yaw: c?.yaw ?? 0 });
    }
    if (t.thing === "lantern") setState(db, `lamps_taken:${p.day}`, [...lampsTaken(db, p.day), req.ref]);
    if (t.thing === "food") {
      const tt = tableTakes(db, p.day);
      tt[req.ref] = (tt[req.ref] ?? 0) + 1;
      setState(db, `table_takes:${p.day}`, tt);
    }
    const took = t.thing === "food" ? `Jef took ${FOOD_NAME[t.item]} from ${t.where}` : `Jef took ${ownerName}'s ${t.noun} ${t.where}`;
    log(
      db,
      "stole",
      req.ref,
      seen ? `${took}, and ${ownerSaw ? `${ownerName} saw it` : `${tellers.length === 1 ? npcName(db, tellers[0].id) : `${tellers.length} people`} saw it`}.` : `${took}. Nobody saw.`,
    );
  })();

  const what = t.thing === "food" ? `${FOOD_NAME[t.item]} off ${t.where}` : `${ownerName}'s ${t.noun} ${t.where}`;
  // M8d: the other players who saw it are told (and the police may ask them: deedRoutes.ts, police.ts policeWitness)
  const eyes2 = playerEyes(others.filter((o) => o.id !== pid()), { x: t.x, z: t.z }, ctx);
  const thiefName = playerName(db, pid());
  for (const o of eyes2) noteSeen(db, o.id, deedId, `You saw ${thiefName} take ${what}.`);
  const playersSaw = eyes2.map((o) => ({ id: o.id, name: playerName(db, o.id) }));
  const gist = t.thing === "food" ? `Jef stole ${FOOD_NAME[t.item]} from ${t.where}` : `Jef stole ${ownerName}'s ${t.noun}`;
  const info: SeenInfo = {
    owner: t.owner,
    noun: t.noun,
    what,
    gist,
    ownerText: windowSaw ? `From my window I saw Jef take my ${t.noun}.` : `Jef took my ${t.noun} ${t.where.replace("his house", "my house")}, in front of my eyes.`,
  };
  const out = seen ? witnessed(db, deedId, tellers, info, { windowSaw }) : null;
  if (!seen) {
    // the owner finds it gone, sooner or later; nobody knows who
    remember(db, t.owner, t.thing === "food" ? `Somebody lifted ${FOOD_NAME[t.item]} off my table while I looked the other way.` : `Somebody took my ${t.noun} ${t.where}.`, 4);
  }
  const sus = seen ? [] : noteSuspects(db, deedId, suspects);

  const reaction = out?.reactions[0] ?? null;
  const text = seen
    ? windowSaw
      ? `A curtain moves in a window. Someone saw you.`
      : reaction
        ? reaction.line
        : `Somebody saw you. You can feel their eyes on your back.`
    : sus.length
      ? `${sus[0].name.split(" ")[0]} looks your way. Did ${resident(db, sus[0].id)?.sex === "f" ? "she" : "he"} see? Walk, don't run.`
      : t.thing === "velocipede"
        ? "Nobody seems to have seen. The velocipede is yours now, for what that is worth."
        : t.thing === "boat"
          ? "Nobody seems to have seen. You cast off: the boat is yours now, for what that is worth."
          : t.thing === "handcart"
            ? "Nobody seems to have seen. You take the shafts: the handcart is yours now, for what that is worth."
            : t.thing === "lantern"
              ? "Nobody saw. The lantern is yours now."
              : `Nobody saw. ${FOOD_NAME[t.item][0].toUpperCase() + FOOD_NAME[t.item].slice(1)} goes into your pocket.`;
  const watched = playersSaw.length ? ` ${playersSaw.map((p) => p.name).join(" and ")} saw it too.` : "";
  return {
    deed: deedId,
    again: false,
    seen,
    owner_saw: ownerSaw,
    seen_by: tellers.map((w) => ({ id: w.id, name: npcName(db, w.id) })),
    owner: { id: t.owner, name: ownerName },
    reaction,
    reactions: out?.reactions ?? [],
    suspects: sus,
    text: text + watched,
    police: out?.police ?? false,
    police_in: out?.police_in,
    police_agent: out?.police_agent ?? null,
    item_id: itemId,
    players_saw: playersSaw,
  };
}

// ------------------------------------------------------------------ M9: who does what about it

/** What a deed was, for the words of those who saw it. */
export interface SeenInfo {
  owner: string;
  noun: string;
  /** "Anna's lantern by the Hessenatie door", "a herring off Mie's stall". */
  what: string;
  /** The rumour: "Jef stole Anna's lantern". */
  gist: string;
  /** What the owner keeps of it, in her own words. */
  ownerText: string;
}

/** M9: what this witness does about a theft, by their stats (engine). "silent": says nothing, and remembers. */
export function roleOf(db: DB, id: string, owner: boolean): Reaction | "silent" {
  const r = resident(db, id);
  // the quay's own people and the board's employers keep their posts: they shout, and remember
  if (!r || TOWN_EMPLOYER_IDS.includes(id)) return "shout";
  if (r.trade === "police") return "police";
  // a sentry on duty never leaves his post (garrison.ts)
  if (r.trade === "sentry" || r.trade === "corporal") return "shout";
  if (r.age < 12) return "fetch";
  if (r.age >= 65) return "shout";
  if (r.stats.courage >= (owner ? 5 : 6)) return "confront";
  if (owner || r.stats.honesty >= 4) return "fetch";
  return "silent";
}

function roleLine(db: DB, who: string, kind: Reaction, info: SeenInfo, owner: boolean): string {
  const n = firstName(db, who);
  if (kind === "confront") return owner ? `${n} comes straight at you: "Hey! That's my ${info.noun}! What do you think you're doing?"` : `${n} steps up to you: "I saw that. That's not yours."`;
  if (kind === "fetch") return (resident(db, who)?.age ?? 30) < 12 ? `A child shrieks "Thief!" and runs off to fetch the police.` : `${n} shouts "Thief! Police! Police!" and runs off to fetch an agent.`;
  if (kind === "police") return `${n} of the police: "Halt! I saw that. Stay where you are."`;
  return reactionLine(db, who, "shout", info.noun, owner);
}

export interface Witnessed {
  reactions: ReactionOut[];
  /** Someone has it out with him first: no talk, no police yet (town/confront.ts decides). */
  quiet: boolean;
  police: boolean;
  police_in?: number;
  police_agent: string | null;
  /** His good name was too low: the police and the paper, whatever comes of it. */
  low: boolean;
}

/** One who has it out with Jef (M9; town/confront.ts reads and settles these). */
export interface Confront {
  deed: number;
  npc: string;
  owner: boolean;
  /** Game minute it began. */
  at: number;
  /** His good name was too low: sorry is not enough (the police come anyway). */
  low: boolean;
  stage: "open" | "bribe";
  /** The sum asked to say no more (stage "bribe"). */
  ask_c?: number;
  offered?: Record<string, string>;
  /** Model calls this talk has had (his own words read: town/confront.ts). */
  calls?: number;
}

export function confronts(db: DB): Confront[] {
  return pstate<Confront[]>(db, "confronts") ?? [];
}
export function setConfronts(db: DB, list: Confront[]): void {
  setPstate(db, "confronts", list);
}

/**
 * M9 theft: someone saw the deed. Who does what (roleOf): one brave witness (the owner first) comes to have
 * it out with him; one runs for the police; the rest shout or keep quiet. While someone has it out with
 * him, the talk and the police wait for how it ends (quiet): sorry and the thing back may settle it
 * (town/confront.ts). With a bad name (charisma at or below CHARISMA_LOW), or when an agent saw it, nothing
 * waits: the police are called and the paper hears of it, whatever he says.
 */
export function witnessed(db: DB, deedId: number, tellers: Witness[], info: SeenInfo, opts: { windowSaw?: boolean } = {}): Witnessed {
  const roles = tellers.map((w) => ({ w, role: roleOf(db, w.id, w.owner) }));
  const agent = roles.find((x) => x.role === "police")?.w.id ?? null;
  const low = charisma(db) <= CHARISMA_LOW;
  const confronter = opts.windowSaw || agent ? undefined : roles.filter((x) => x.role === "confront" && x.w.d < 30).sort((a, b) => Number(b.w.owner) - Number(a.w.owner) || a.w.d - b.w.d)[0];
  const fetcher = roles.filter((x) => x.role === "fetch" && x !== confronter).sort((a, b) => a.w.d - b.w.d)[0];
  const quiet = !!confronter && !low;
  if (quiet) {
    // they know, but it is between him and them for now: no rumour, no trust lost yet
    if (tellers.some((w) => w.owner)) remember(db, info.owner, info.ownerText, 5);
    for (const w of tellers.filter((w) => !w.owner).slice(0, 5)) remember(db, w.id, `I saw Jef take ${info.what}.`, 5);
    db.prepare("UPDATE deed SET quiet = 1 WHERE id = ?").run(deedId);
  } else spreadSeen(db, deedId, tellers, info);
  if (low) log(db, "caught_stealing", info.owner, `Jef was seen stealing ${info.what}; the town has had enough of him.`);
  if (confronter) {
    const list = confronts(db).filter((c) => c.npc !== confronter.w.id);
    setConfronts(db, [...list, { deed: deedId, npc: confronter.w.id, owner: confronter.w.owner, at: gameMinute(db), low, stage: "open" }]);
  }
  const reactions: ReactionOut[] = [];
  const add = (id: string, kind: Reaction, owner: boolean) => reactions.push({ who: id, name: npcName(db, id), kind, line: roleLine(db, id, kind, info, owner) });
  if (confronter) add(confronter.w.id, "confront", confronter.w.owner);
  // while one has it out with him the others watch how it goes (escalate sends the runner: town/confront.ts)
  if (quiet) return { reactions, quiet, police: false, police_agent: null, low };
  if (agent) add(agent, "police", false);
  if (fetcher && !agent) add(fetcher.w.id, "fetch", fetcher.w.owner);
  // one more who only shouts (the owner shouts first)
  const shouter = roles.filter((x) => x.role === "shout" && !reactions.some((r) => r.who === x.w.id)).sort((a, b) => Number(b.w.owner) - Number(a.w.owner) || a.w.d - b.w.d)[0];
  if (shouter && (!opts.windowSaw || !shouter.w.owner)) add(shouter.w.id, "shout", shouter.w.owner);
  const police = !quiet && roles.some((x) => x.role !== "silent");
  return { reactions, quiet, police, police_in: agent ? 0 : fetcher ? FETCH_MIN : undefined, police_agent: agent, low };
}

/** The deed is out: the owner and each witness remember it as a rumour, trust falls, the owner's people think less of him. */
export function spreadSeen(db: DB, deedId: number, tellers: Witness[] | string[], info: SeenInfo): void {
  const ids = tellers.map((w) => (typeof w === "string" ? w : w.id));
  if (ids.includes(info.owner)) {
    remember(db, info.owner, info.ownerText, 8, "seen", null, { gist: info.gist, tone: -2 });
    applyTrust(db, info.owner, -2, 0);
  }
  for (const id of ids.filter((id) => id !== info.owner).slice(0, 5)) {
    remember(db, id, `I saw Jef take ${info.what}.`, 6, "seen", null, { gist: info.gist, tone: -2 });
    applyTrust(db, id, -1, 0);
  }
  const faction = (db.prepare("SELECT faction FROM npc WHERE id = ?").get(info.owner) as { faction: string | null } | undefined)?.faction;
  if (faction) db.prepare("UPDATE faction_trust SET trust = MAX(-5, trust - 1) WHERE faction = ? AND player_id = ?").run(faction, pid());
  db.prepare("UPDATE deed SET quiet = 0 WHERE id = ?").run(deedId);
}

/** M9: the ones who half saw it (a few), kept a short while: run now and they are sure (town/confront.ts noticed). */
export function noteSuspects(db: DB, deedId: number, sus: Witness[]): Array<{ id: string; name: string }> {
  const pick = sus.sort((a, b) => a.d - b.d).slice(0, 3);
  if (!pick.length) return [];
  const now = gameMinute(db);
  const list = (pstate<Array<{ deed: number; ids: string[]; until: number }>>(db, "deed_suspects") ?? []).filter((s) => s.until > now);
  setPstate(db, "deed_suspects", [...list, { deed: deedId, ids: pick.map((w) => w.id), until: now + SUSPECT_MIN }].slice(-4));
  return pick.map((w) => ({ id: w.id, name: npcName(db, w.id) }));
}

/** M9: what the deed was, from its row (for a later witness, the confront, the police). */
export function seenInfoOf(db: DB, d: DeedRow): SeenInfo {
  const name = npcName(db, d.owner);
  const s = stealables(db);
  if (d.thing === "purse") {
    return { owner: d.owner, noun: "purse", what: `${name}'s purse`, gist: `Jef picked ${name}'s pocket`, ownerText: `Jef put his hand in my pocket, bold as brass.` };
  }
  if (d.thing === "food") {
    const where = s.food.find((f) => f.id === d.ref)?.where ?? `${name}'s stall`;
    const food = FOOD_NAME[d.item] ?? d.item;
    return { owner: d.owner, noun: d.item === "herring" ? "fish" : d.item, what: `${food} off ${where}`, gist: `Jef stole ${food} from ${where}`, ownerText: `Jef took ${food} off my table, in front of my eyes.` };
  }
  const noun = THINGS[d.thing]?.noun ?? d.thing;
  const where = d.thing === "velocipede" ? (s.velos.find((v) => v.id === d.ref)?.where ?? "") : d.thing === "lantern" ? (s.lamps.find((l) => l.id === d.ref)?.where ?? "") : "";
  return { owner: d.owner, noun, what: `${name}'s ${noun}${where ? ` ${where}` : ""}`, gist: `Jef stole ${name}'s ${noun}`, ownerText: `Jef took my ${noun}${where ? ` ${where.replace("his house", "my house")}` : ""}, in front of my eyes.` };
}

// ------------------------------------------------------------------ M7 boats: taking a boat

/**
 * How far the owner makes out a man at his boat (m): the weather's sight by daylight; at night only
 * by lamplight (a gas lamp of the quays near the boat, Jef's own lantern), else close by. Pure.
 */
export function boatSight(weather: Weather | "storm", hour: number, lit: { lantern: boolean; lamp: boolean }): number {
  const day = daylight(hour);
  const light = Math.max(0.25 + 0.75 * day, lit.lantern ? 0.9 : 0, lit.lamp ? 0.75 : 0);
  return (SIGHT_M[weather] ?? 13) * light;
}

/** The owner sees it: within sight, a clear line, and not with his back to it (unless he is close). Pure. */
export function ownerSees(w: Witness | undefined, range: number): boolean {
  if (!w || !w.los) return false;
  if (w.d > range) return false;
  return w.facing > -0.3 || w.d < 8;
}

/** The gas lamps of the quays (city.json decor): lit at night, they light a boat within reach. */
const QUAY_LAMPS = ((CITY as unknown as { decor?: { lamps?: Array<[number, number]> } }).decor?.lamps ?? []) as Array<[number, number]>;
export function quayLampNear(x: number, z: number, r = 11): boolean {
  return QUAY_LAMPS.some(([lx, lz]) => Math.hypot(lx - x, lz - z) <= r);
}

/** Game minutes an owner who only asked for his boat back waits before he goes to the police (town/rowDeeds.ts). */
export const BOAT_GRACE_MIN = 40;

function boatLine(db: DB, who: string, kind: Reaction, noun: string): string {
  const n = firstName(db, who);
  const what = noun === "rowing boat" ? "boat" : noun;
  if (kind === "chase") return `${n} shouts and runs for the quay: "Hey! That's my ${what}! Bring her back, you thief!"`;
  if (kind === "ask") return `${n}: "That's my ${what} you're in. Bring her back to where she lay, and we'll say no more."`;
  return `${n} shouts across the water: "Thief! That's my ${what}! Thief!"`;
}

/**
 * Jef takes a small boat (Steve, 2026-09-26: "we can take any of them to use. Only when owner within
 * sight he will be angry."). Only the owner's eyes count, and the engine judges them: within sight by
 * the weather and the light, a clear line, not turned away. Seen: he is angry (a shout; he runs for the
 * quay, or asks for her back), trust with him falls (clamped), he remembers it, and the police hear of
 * it (at once, or after BOAT_GRACE_MIN if he only asked and she is not back). Unseen: nothing now; he
 * may find her gone later and grumble (rowDeeds.ts boatTick). A boat nobody owns: no deed at all.
 */
function takeBoat(db: DB, req: DeedRequest, b: LooseBoat): DeedResult {
  const st = rowBoatStates(db)[b.id];
  if (st.ridden) throw new GameError("you are already in it", 409);
  if (rowState(db).on) throw new GameError("you are in a boat already", 409);
  const noun = HULLS[b.kind].noun;
  // his already (taken before and not given back), or nobody's: in he gets, no new deed
  if (st.deed !== null || !b.owner) {
    setRowBoat(db, b.id, { ...st, ridden: true });
    rowOn(db, b.id);
    if (!b.owner) log(db, "took_boat", b.id, `Jef took the ${noun} nobody owns, ${b.where}.`);
    return {
      deed: st.deed,
      again: st.deed !== null,
      seen: false,
      owner_saw: false,
      seen_by: [],
      owner: b.owner ? { id: b.owner, name: npcName(db, b.owner) } : { id: "", name: "" },
      reaction: null,
      text: b.owner ? "" : `Nobody's boat, and not much of one. You untie her and push off.`,
      police: false,
      item_id: null,
    };
  }
  deedTables(db);
  const owner = b.owner;
  const p = player(db);
  const pm = db.prepare("SELECT minute FROM player WHERE id = 1").get() as { minute: number };
  const ownerName = npcName(db, owner);
  // the owner's eyes only: the others on the quay shrug (boats are borrowed on the water all the time)
  const ws = cleanWitnesses(db, req.witnesses, owner);
  const ow = ws.find((w) => w.owner);
  const dark = daylight(p.hour) < 1;
  const range = boatSight(weather(db), p.hour, { lantern: req.lantern, lamp: dark && (quayLampNear(st.x, st.z) || quayLampNear(req.x, req.z)) });
  const saw = ownerSees(ow, range);
  const r = resident(db, owner);
  let kind: Reaction = saw ? reactionOf(db, owner) : "shout";
  // an owner who can run runs for the quay (Steve: "shouts, runs toward the quay")
  if (saw && kind === "shout" && r && r.age >= 14 && r.age < 65 && !TOWN_EMPLOYER_IDS.includes(owner)) kind = "chase";
  let deedId = 0;
  db.transaction(() => {
    const ins = db
      .prepare(
        `INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status, rumour_at, player_id)
         VALUES (?, ?, ?, 'boat', ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'open', NULL, ?)`,
      )
      .run(p.day, p.hour, pm.minute, b.kind, b.id, owner, st.x, st.z, saw ? 1 : 0, saw ? 1 : 0, JSON.stringify(saw ? [owner] : []), pid());
    deedId = Number(ins.lastInsertRowid);
    setRowBoat(db, b.id, { ...st, ridden: true, deed: deedId });
    rowOn(db, b.id);
    log(db, "stole", b.id, saw ? `Jef took ${ownerName}'s ${noun} ${b.where}, and ${ownerName} saw it.` : `Jef took ${ownerName}'s ${noun} ${b.where}. Nobody saw.`);
    if (saw) {
      remember(db, owner, `Jef took my ${noun} ${b.where}, in front of my eyes, and rowed off in her.`, 8, "seen", null, { gist: `Jef took ${ownerName}'s ${noun}`, tone: -2 });
      applyTrust(db, owner, -2, 0);
      const faction = (db.prepare("SELECT faction FROM npc WHERE id = ?").get(owner) as { faction: string | null } | undefined)?.faction;
      if (faction) db.prepare("UPDATE faction_trust SET trust = MAX(-5, trust - 1) WHERE faction = ? AND player_id = ?").run(faction, pid());
      // one who only asked goes to the police if she is not back in time (rowDeeds.ts boatTick; M8c: the player's own)
      if (kind === "ask") setPstate(db, "boat_asked", { ...(pstate<Record<string, number>>(db, "boat_asked") ?? {}), [String(deedId)]: gameMinute(db) });
    }
  })();
  const reaction = saw ? { who: owner, name: ownerName, kind, line: boatLine(db, owner, kind, noun) } : null;
  return {
    deed: deedId,
    again: false,
    seen: saw,
    owner_saw: saw,
    seen_by: saw ? [{ id: owner, name: ownerName }] : [],
    owner: { id: owner, name: ownerName },
    reaction,
    text: reaction ? reaction.line : `Nobody seems to have seen. You cast off in ${takePrompt(db, b).replace(/^take /, "")}.`,
    police: saw && kind !== "ask",
    item_id: null,
  };
}

/**
 * The thing goes back to its owner: Jef gave it when asked, or the owner caught
 * him and took it. Only an open deed; the thing must still be with Jef.
 */
/**
 * how: "gave" (asked for it back), "caught" (the owner took it off him), M9 "forgiven" (sorry was
 * enough: no rumour, status forgiven), M9 "handed" (handed back while it goes to the police anyway: no
 * memory here, town/confront.ts has them remember).
 */
export function returnThing(db: DB, id: number, how: "gave" | "caught" | "forgiven" | "handed"): { text: string } {
  const d = deedRow(db, id);
  // (M8c: only his own deed)
  if (!d || d.status !== "open" || (d.player_id ?? 1) !== pid()) throw new GameError("nothing to give back", 409);
  if (d.thing === "boat_lost" || d.thing === "boat_debt") throw new GameError("there is nothing to give back", 409);
  if (d.thing === "handcart" && !cartHooks.held(db, d)) throw new GameError("you have not got it any more", 409);
  if (d.thing !== "velocipede" && d.thing !== "boat" && d.thing !== "handcart" && d.thing !== "purse") {
    const has = db.prepare("SELECT 1 FROM item WHERE id = ? AND player_id = ?").get(d.item_id ?? -1, pid());
    if (!has) throw new GameError("you have not got it any more", 409);
  }
  const name = npcName(db, d.owner);
  const noun = d.thing === "food" ? FOOD_NAME[d.item] : d.thing === "purse" ? "the money" : `the ${d.thing}`;
  const trustBack = db.transaction((): boolean => {
    undoTake(db, d);
    db.prepare("UPDATE deed SET status = ?, rumour_at = NULL WHERE id = ?").run(how === "forgiven" ? "forgiven" : "returned", id);
    log(db, "gave_back", d.ref, how === "caught" ? `${name} caught Jef and took ${noun} back.` : `Jef gave ${noun} back to ${name}.`);
    return how === "gave" && giveBackTrust(db, d);
  })();
  thingHome(db, d);
  const mine = d.thing === "food" ? d.item : d.thing === "purse" ? "money" : d.thing;
  if (how === "gave") {
    remember(db, d.owner, `Jef gave my ${mine} back when I asked. Still, he took it.`, 4, "seen", null, {
      gist: `Jef took ${name}'s ${mine} and gave it back when asked`,
      tone: -1,
    });
    if (trustBack) applyTrust(db, d.owner, 1, 0);
  } else if (how === "caught") {
    remember(db, d.owner, `I caught Jef with my ${mine} and took it back off him.`, 6, "seen", null, {
      gist: `Jef was caught with ${name}'s ${mine} and had to hand it back`,
      tone: -2,
    });
  }
  const first = firstName(db, d.owner);
  return {
    text:
      how !== "caught"
        ? `You hand ${noun} back. ${first} takes it without a word of thanks.`
        : d.thing === "velocipede"
          ? `${first} grabs the handlebars and pulls. You are off, and the velocipede is ${first}'s again.`
          : `${first} catches your sleeve and takes ${noun} back off you.`,
  };
}

/**
 * M9: what he took leaves him (inside a transaction): the pocket item, the money of a picked pocket (as
 * much as he still has), a lantern back on its spot, a lift off a table back on the table.
 */
/** M9: is this pocket item stolen (a deed not yet settled)? The Berg lends half on it (paper/pawn.ts). */
export function stolenItem(db: DB, itemId: number): DeedRow | null {
  if (!hasDeeds(db)) return null;
  return (db.prepare("SELECT * FROM deed WHERE item_id = ? AND status = 'open'").get(itemId) as DeedRow | undefined) ?? null;
}

export function undoTake(db: DB, d: DeedRow): void {
  if (d.item_id !== null) db.prepare("DELETE FROM item WHERE id = ? AND player_id = ?").run(d.item_id, d.player_id ?? pid());
  if (d.thing === "purse" && (d.took_c ?? 0) > 0) db.prepare("UPDATE player SET money_c = MAX(0, money_c - ?) WHERE id = ?").run(d.took_c, d.player_id ?? pid());
  if (d.thing === "lantern") setState(db, `lamps_taken:${d.day}`, lampsTaken(db, d.day).filter((r) => r !== d.ref));
  if (d.thing === "food") {
    const tt = tableTakes(db, d.day);
    if (tt[d.ref]) {
      tt[d.ref] = Math.max(0, tt[d.ref] - 1);
      setState(db, `table_takes:${d.day}`, tt);
    }
  }
}

/** M9: a velocipede, boat or handcart back where it belongs (after undoTake, outside its transaction). */
export function thingHome(db: DB, d: DeedRow): void {
  if (d.thing === "velocipede") veloHome(db, d.ref);
  if (d.thing === "boat") rowBoatHome(db, d.ref);
  if (d.thing === "handcart") cartHooks.home(db, d.ref);
}

/**
 * Giving a stolen thing back earns the owner's +1 at most once a game day, and only for a deed
 * somebody saw (an unseen one the owner never knew of): take and give back is no trust farm.
 * The ledger (owner: the day it was granted) is the player's own (M8c: pstate) and goes with a new game.
 */
function giveBackTrust(db: DB, d: DeedRow): boolean {
  if (!d.seen) return false;
  const day = Math.floor(gameMinute(db) / 1440) + 1;
  const ledger = pstate<Record<string, number>>(db, "deed_trust_back") ?? {};
  if (ledger[d.owner] === day) return false;
  ledger[d.owner] = day;
  setPstate(db, "deed_trust_back", ledger);
  return true;
}

/** Unseen deeds that start to be talked about, when their hour comes (every tick; M8c: every player's, each about its own man). */
export function deedRumours(db: DB): number {
  if (!hasDeeds(db)) return 0;
  const now = gameMinute(db);
  const due = db.prepare("SELECT * FROM deed WHERE rumour_at IS NOT NULL AND rumour_at <= ?").all(now) as DeedRow[];
  for (const d of due) {
    db.prepare("UPDATE deed SET rumour_at = NULL WHERE id = ?").run(d.id);
    const name = npcName(db, d.owner);
    const where = stealables(db).food.find((f) => f.id === d.ref)?.where ?? `${name}'s stall`;
    const gone = d.thing === "food" ? `${FOOD_NAME[d.item] ?? d.item} went missing from ${where}` : `${name}'s ${THINGS[d.thing]?.noun ?? d.thing} went missing`;
    asPlayer(d.player_id ?? 1, () =>
      remember(db, d.owner, `Someone says the new man, Jef, was about when ${gone.replace(`${name}'s`, "my")}.`, 5, "heard", null, {
        gist: `Jef was about when ${gone}`,
        tone: -1,
      }),
    );
  }
  return due.length;
}

/** M8d: a player's man retires (player/multi.ts resetPlayer): what he took and still has goes back to its owners. */
RESET_HOOKS.push((db, id) => {
  if (!hasDeeds(db)) return;
  const open = db.prepare("SELECT * FROM deed WHERE status = 'open' AND player_id = ?").all(id) as DeedRow[];
  for (const d of open) {
    if (d.thing === "velocipede") veloHome(db, d.ref);
    if (d.thing === "boat") rowBoatHome(db, d.ref);
    if (d.thing === "handcart") asPlayer(id, () => cartHooks.home(db, d.ref));
  }
});

/** A new game: no deeds, no taken things. */
export function clearDeeds(db: DB): void {
  if (hasDeeds(db)) db.prepare("DELETE FROM deed").run();
  dropStealables(db);
}

/** Every deed, newest first (for other layers: M4's event director reads this). */
export function listDeeds(db: DB, limit = 50): DeedRow[] {
  if (!hasDeeds(db)) return [];
  return db.prepare("SELECT * FROM deed ORDER BY id DESC LIMIT ?").all(limit) as DeedRow[];
}

/** The player's deeds still open or talked about, for the police (police.ts). */
export function openDeeds(db: DB): DeedRow[] {
  if (!hasDeeds(db)) return [];
  return db.prepare("SELECT * FROM deed WHERE status IN ('open', 'returned') AND player_id = ? ORDER BY id").all(pid()) as DeedRow[];
}

export { FOOD_NAME };
