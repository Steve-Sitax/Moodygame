import { z } from "zod";
import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { applyTrust, remember } from "../npcs.ts";
import { POCKET_SLOTS, atWork } from "../trade.ts";
import { weather, type Weather } from "../day.ts";
import { activityAt } from "./schedule.ts";
import { TOWN_EMPLOYER_IDS, resident, town } from "./store.ts";
import { houseDoors, walkMap } from "./walkmap.ts";
import type { Resident } from "./population.ts";
import { rowBoatHome, rowBoatStates, rowBoats, rowOn, rowState, setRowBoat } from "../rowing.ts";
import { wantedFactor } from "../ideas/wanted.ts";
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
export type Thing = "velocipede" | "lantern" | "food" | "boat" | "boat_lost" | "boat_debt" | "handcart";

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
};

/**
 * M6 handcart (town/handcart.ts sets these): a household's cart as a thing to take ("cart:<household>").
 * find: where it stands now and whether Jef has it already; taken: it is Jef's now (he holds it);
 * again: he takes hold of it again; home: back to its household; held: does he still have it for
 * this deed; gone: is it away from its household (the family cannot use it).
 */
export const cartHooks = {
  find: (_db: DB, _ref: string): { owner: string; x: number; z: number; yaw?: number; where: string; mine: { deed: number | null; held: boolean } | null } | null => null,
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
  ready.add(db);
}
/** Is there a deed table yet? Reading never makes one. */
export function hasDeeds(db: DB): boolean {
  if (ready.has(db)) return true;
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'deed'").get()) return false;
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
  status: "open" | "returned" | "warned" | "fined" | "arrested" | "let_off";
  rumour_at: number | null;
}

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
    const [ox, oz] = sh.out;
    // the table beside the door (the same sum as client/src/game/stalls.ts)
    const x = sh.wall[0] - oz * 1.9 + ox * 0.6;
    const z = sh.wall[1] + ox * 1.9 + oz * 0.6;
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
  for (const v of veloHooks.jef(db)) out[v.id] = saved[v.id] ?? { x: v.x, z: v.z, yaw: v.yaw, ridden: false, deed: null, own: true };
  return out;
}
function saveVelo(db: DB, id: string, s: VeloState): void {
  const all = veloStates(db);
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
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new GameError("bad place", 400);
  const wm = walkMap();
  const q = wm.open(x, z, 0.25) ? { x, z } : wm.nearestOpen(x, z, 4);
  if (!q) throw new GameError("you cannot leave it there", 409);
  const next: VeloState = { x: r1(q.x), z: r1(q.z), yaw: Number.isFinite(yaw) ? +yaw.toFixed(3) : s.yaw, ridden: false, deed: s.deed, down, ...(s.own ? { own: true } : {}) };
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
      ...s.velos.map((v) => ({ id: v.id, owner: v.owner, owner_name: npcName(db, v.owner), ...vs[v.id], mine: vs[v.id].deed !== null })),
      // M6: Jef's own (bought, or hired for the day)
      ...veloHooks.jef(db).filter((v) => vs[v.id]).map((v) => ({ id: v.id, owner: v.owner, owner_name: "you", ...vs[v.id], mine: true, own: true })),
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
}

/** Light in the street, 0-1: night hides, dusk and dawn half hide. */
export function daylight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 20 || h < 6) return 0;
  if (h >= 18 || h < 7) return 0.5;
  return 1;
}

/** The chance (0-1) that this person saw it. Pure: the numbers of the theft system. */
export function seeChance(w: Witness, c: SeeCtx, trade?: string, age = 30): number {
  const light = c.lantern ? 0.9 : 0.45 + 0.55 * daylight(c.hour);
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
  const f = Math.max(-1, Math.min(1, w.facing));
  att *= f > 0.3 ? 1 : f > -0.3 ? 0.6 : 0.25;
  p *= att;
  if (c.crouch) p *= 0.75;
  return Math.max(0, Math.min(1, p));
}

/** Can this person see anything at all now (out in the street, per the engine's clock)? */
function isOutNow(db: DB, id: string): boolean {
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

export type Reaction = "shout" | "chase" | "ask";

export interface DeedResult {
  deed: number | null;
  /** Taking back what is already Jef's (his stolen velocipede): no new deed. */
  again: boolean;
  seen: boolean;
  owner_saw: boolean;
  seen_by: Array<{ id: string; name: string }>;
  owner: { id: string; name: string };
  reaction: { who: string; name: string; kind: Reaction; line: string } | null;
  text: string;
  police: boolean;
  item_id: number | null;
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
    return { thing: "boat" as Thing, item: b.kind, owner: b.owner, x: st.x, z: st.z, where: b.where, noun: "rowing boat", velo: null, at: null };
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
  return POCKET_SLOTS - (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n;
}

/**
 * Jef takes a thing that is not his. The engine decides who saw it and what
 * it costs him. `rng` is a test seam.
 */
export function takeThing(db: DB, raw: unknown, rng: () => number = Math.random): DeedResult {
  deedTables(db);
  const parsed = DeedRequestSchema.safeParse(raw);
  if (!parsed.success) throw new GameError("bad report", 400);
  const req = parsed.data;
  if (!Number.isFinite(req.x) || !Number.isFinite(req.z)) throw new GameError("bad place", 400);
  const t = findThing(db, req.ref);
  if (Math.hypot(req.x - t.x, req.z - t.z) > REACH_M) throw new GameError("too far away to take it", 409);
  const p = player(db);
  const ownerName = npcName(db, t.owner);

  // can it be taken now?
  if (t.velo) {
    if (t.velo.ridden) throw new GameError("you are already on it", 409);
    if (Object.values(veloStates(db)).some((s) => s.ridden)) throw new GameError("you are already riding one", 409);
    if (t.velo.deed !== null || t.velo.own) {
      // his already (taken before and not given back, or his own): up he gets, no new deed
      saveVelo(db, req.ref, { ...t.velo, ridden: true, down: false });
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

  // who saw it
  const ws = cleanWitnesses(db, req.witnesses, t.owner, { x: t.x, z: t.z, at: t.at });
  const ctx: SeeCtx = { weather: weather(db), hour: p.hour, lantern: req.lantern, crouch: req.crouch };
  const saw: Witness[] = [];
  let nearMiss = false;
  // M6 ideas: a wanted bill with Jef's name on a wall: the town watches him (ideas/wanted.ts)
  const eyes = wantedFactor(db);
  for (const w of ws) {
    const r = resident(db, w.id);
    const chance = Math.min(1, seeChance(w, ctx, r?.trade, r?.age ?? 40) * eyes);
    if (rng() < chance) saw.push(w);
    else if (w.d < 12) nearMiss = true;
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
      const r = db.prepare("INSERT INTO item (kind, job_id) VALUES (?, NULL)").run(t.item);
      itemId = Number(r.lastInsertRowid);
    }
    const ins = db
      .prepare(
        `INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status, rumour_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(p.day, p.hour, pm.minute, t.thing, t.item, req.ref, t.owner, t.x, t.z, seen ? 1 : 0, ownerSaw ? 1 : 0, JSON.stringify(tellers.map((w) => w.id)), itemId, rumourAt);
    deedId = Number(ins.lastInsertRowid);
    if (t.velo) saveVelo(db, req.ref, { ...t.velo, ridden: true, deed: deedId, down: false });
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
  const gist = t.thing === "food" ? `Jef stole ${FOOD_NAME[t.item]} from ${t.where}` : `Jef stole ${ownerName}'s ${t.noun}`;
  if (seen) {
    // the owner, and each witness: a memory, trust lost, a rumour that travels
    if (ownerSaw) {
      remember(db, t.owner, windowSaw ? `From my window I saw Jef take my ${t.noun}.` : `Jef took my ${t.noun} ${t.where.replace("his house", "my house")}, in front of my eyes.`, 8, "seen", null, { gist, tone: -2 });
      applyTrust(db, t.owner, -2, 0);
    }
    for (const w of tellers.filter((w) => !w.owner).slice(0, 5)) {
      remember(db, w.id, `I saw Jef take ${what}.`, 6, "seen", null, { gist, tone: -2 });
      applyTrust(db, w.id, -1, 0);
    }
    const faction = (db.prepare("SELECT faction FROM npc WHERE id = ?").get(t.owner) as { faction: string | null } | undefined)?.faction;
    if (faction) db.prepare("UPDATE faction_trust SET trust = MAX(-5, trust - 1) WHERE faction = ?").run(faction);
  } else {
    // the owner finds it gone, sooner or later; nobody knows who
    remember(db, t.owner, t.thing === "food" ? `Somebody lifted ${FOOD_NAME[t.item]} off my table while I looked the other way.` : `Somebody took my ${t.noun} ${t.where}.`, 4);
  }

  // what the owner does, and who shouts
  let reaction: DeedResult["reaction"] = null;
  const ownerW = tellers.find((w) => w.owner);
  if (ownerW && !windowSaw && ownerW.d < 30) {
    const kind = reactionOf(db, t.owner);
    reaction = { who: t.owner, name: ownerName, kind, line: reactionLine(db, t.owner, kind, t.noun, true) };
  } else if (tellers.length) {
    const loud = tellers.map((w) => ({ w, r: resident(db, w.id) })).find(({ r }) => !r || r.stats.courage >= 4);
    if (loud) reaction = { who: loud.w.id, name: npcName(db, loud.w.id), kind: "shout", line: reactionLine(db, loud.w.id, "shout", t.noun, false) };
  }
  const text = seen
    ? windowSaw
      ? `A curtain moves in a window. Someone saw you.`
      : reaction
        ? reaction.line
        : `Somebody saw you. You can feel their eyes on your back.`
    : t.thing === "velocipede"
      ? "Nobody seems to have seen. The velocipede is yours now, for what that is worth."
      : t.thing === "boat"
        ? "Nobody seems to have seen. You cast off: the boat is yours now, for what that is worth."
      : t.thing === "handcart"
        ? "Nobody seems to have seen. You take the shafts: the handcart is yours now, for what that is worth."
      : t.thing === "lantern"
        ? "Nobody saw. The lantern is yours now."
        : `Nobody saw. ${FOOD_NAME[t.item][0].toUpperCase() + FOOD_NAME[t.item].slice(1)} goes into your pocket.`;
  return {
    deed: deedId,
    again: false,
    seen,
    owner_saw: ownerSaw,
    seen_by: tellers.map((w) => ({ id: w.id, name: npcName(db, w.id) })),
    owner: { id: t.owner, name: ownerName },
    reaction,
    text,
    police: seen,
    item_id: itemId,
  };
}

/**
 * The thing goes back to its owner: Jef gave it when asked, or the owner caught
 * him and took it. Only an open deed; the thing must still be with Jef.
 */
export function returnThing(db: DB, id: number, how: "gave" | "caught"): { text: string } {
  const d = deedRow(db, id);
  if (!d || d.status !== "open") throw new GameError("nothing to give back", 409);
  if (d.thing === "boat_lost" || d.thing === "boat_debt") throw new GameError("there is nothing to give back", 409);
  if (d.thing === "handcart" && !cartHooks.held(db, d)) throw new GameError("you have not got it any more", 409);
  if (d.thing !== "velocipede" && d.thing !== "boat" && d.thing !== "handcart") {
    const has = db.prepare("SELECT 1 FROM item WHERE id = ?").get(d.item_id ?? -1);
    if (!has) throw new GameError("you have not got it any more", 409);
  }
  const name = npcName(db, d.owner);
  const noun = d.thing === "food" ? FOOD_NAME[d.item] : `the ${d.thing}`;
  db.transaction(() => {
    if (d.item_id !== null) db.prepare("DELETE FROM item WHERE id = ?").run(d.item_id);
    db.prepare("UPDATE deed SET status = 'returned', rumour_at = NULL WHERE id = ?").run(id);
    log(db, "gave_back", d.ref, how === "gave" ? `Jef gave ${noun} back to ${name}.` : `${name} caught Jef and took ${noun} back.`);
  })();
  if (d.thing === "velocipede") veloHome(db, d.ref);
  if (d.thing === "boat") rowBoatHome(db, d.ref);
  if (d.thing === "handcart") cartHooks.home(db, d.ref);
  if (how === "gave") {
    remember(db, d.owner, `Jef gave my ${d.thing === "food" ? d.item : d.thing} back when I asked. Still, he took it.`, 4, "seen", null, {
      gist: `Jef took ${name}'s ${d.thing === "food" ? d.item : d.thing} and gave it back when asked`,
      tone: -1,
    });
    applyTrust(db, d.owner, 1, 0);
  } else {
    remember(db, d.owner, `I caught Jef with my ${d.thing === "food" ? d.item : d.thing} and took it back off him.`, 6, "seen", null, {
      gist: `Jef was caught with ${name}'s ${d.thing === "food" ? d.item : d.thing} and had to hand it back`,
      tone: -2,
    });
  }
  const first = firstName(db, d.owner);
  return {
    text:
      how === "gave"
        ? `You hand ${noun} back. ${first} takes it without a word of thanks.`
        : d.thing === "velocipede"
          ? `${first} grabs the handlebars and pulls. You are off, and the velocipede is ${first}'s again.`
          : `${first} catches your sleeve and takes ${noun} back off you.`,
  };
}

/** Unseen deeds that start to be talked about, when their hour comes (every tick). */
export function deedRumours(db: DB): number {
  if (!hasDeeds(db)) return 0;
  const now = gameMinute(db);
  const due = db.prepare("SELECT * FROM deed WHERE rumour_at IS NOT NULL AND rumour_at <= ?").all(now) as DeedRow[];
  for (const d of due) {
    db.prepare("UPDATE deed SET rumour_at = NULL WHERE id = ?").run(d.id);
    const name = npcName(db, d.owner);
    const where = stealables(db).food.find((f) => f.id === d.ref)?.where ?? `${name}'s stall`;
    const gone = d.thing === "food" ? `${FOOD_NAME[d.item] ?? d.item} went missing from ${where}` : `${name}'s ${THINGS[d.thing]?.noun ?? d.thing} went missing`;
    remember(db, d.owner, `Someone says the new man, Jef, was about when ${gone.replace(`${name}'s`, "my")}.`, 5, "heard", null, {
      gist: `Jef was about when ${gone}`,
      tone: -1,
    });
  }
  return due.length;
}

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

/** Deeds still open or talked about, for the police (police.ts). */
export function openDeeds(db: DB): DeedRow[] {
  if (!hasDeeds(db)) return [];
  return db.prepare("SELECT * FROM deed WHERE status IN ('open', 'returned') ORDER BY id").all() as DeedRow[];
}

export { FOOD_NAME };
