import type { DB } from "./db.ts";
import { GameError, log, player } from "./game.ts";
import { applyTrust, remember } from "./npcs.ts";
import { town } from "./town/store.ts";

// Rowing boats (M3j). Steve, 2026-09-23: "We should be able to take a boat and row to other
// places. Bridge goes up if we don't fit underneath. Only rowing boats, no big ones."
// And: "We should be able to get out of a boat anywhere." "If it is a collision place, i.e. a
// bridge, or in the path of a big boat, it breaks, sinks and disappears."
//
// A waterman hires out rowing boats at three flights of quay steps (the Rijnkaai by the Anna
// Maria's berth, the Vismarkt, the Petit Bassin; the Werf's own flight cannot be walked to from
// the quay, the Werf store stands at its head). The ENGINE owns every number: the hire, what is owed for keeping it too
// long, the fine for a boat left anywhere but a hire landing (his boy fetches it an hour
// later), what a lost boat costs, and what a row does to the needs. The client only says what
// happened (I hired at this landing, I got out here, the boat broke); every fact is checked
// and every sum clamped here. A few boats lie unattended at other steps: taking one is theft,
// a deed of the M3h system (town/deeds.ts, thing "boat"); losing a stolen boat is worse
// (thing "boat_lost"). What the waterman cannot get paid for a lost boat becomes a debt; if it
// is still owed after a night, he goes to the police (town/rowDeeds.ts, thing "boat_debt").

/** The hire, in centimes. */
export const ROW_HIRE_C = 10;
/** Game hours the hire covers (M7 clock: 6 -> 2; a game hour is two real minutes now): two hours
 * are four real minutes, enough to row from the Werf to the head of the canal and back. */
export const ROW_HIRE_HOURS = 2;
/** Each game hour, or part of one, over the hire. */
export const ROW_LATE_C = 2;
/** The most he asks for being late. */
export const ROW_LATE_MAX_C = 20;
/** A hired boat left anywhere but a hire landing: his boy has to go and fetch it. */
export const ROW_LEFT_FINE_C = 15;
/** ...and the boy finds it this many game minutes after you left it. */
export const ROW_FETCH_MIN = 60;
/** A lost boat (broken and sunk): what the waterman asks, by kind; always within the clamp below. */
export const ROW_LOST_C: Record<BoatKind, number> = { rowboat: 100, punt: 70 };
export const ROW_LOST_MIN_C = 60;
export const ROW_LOST_MAX_C = 120;
/** The most anyone can owe the watermen. */
export const ROW_DEBT_MAX_C = 150;
/** Hard strokes that cost one more point of food (Shift). */
export const ROW_EFFORT_PER_FOOD = 60;
/** At most this many hard strokes a real second (the client's count is clamped by the clock). */
export const ROW_STROKES_PER_S = 1;

export type BoatKind = "rowboat" | "punt";
export type LandingId = "rijnkaai" | "vismarkt" | "bassin";

export interface Flight {
  /** Top of the flight on the quay line (world/rijnkaai.ts FLIGHTS), the way down (t), the water side (n). */
  top: [number, number];
  t: [number, number];
  n: [number, number];
}

/** Sizes of a flight of steps (client/src/world/quaysteps.ts): 13 treads of 0.32 m, then a 2.4 m landing, 1.62 m wide. */
const FLIGHT_LEN = 4.16;
const LANDING_LEN = 2.4;
const FLIGHT_W = 1.62;

/** A boat's berth beside the landing of a flight: centre, and the bow pointing on down the wall. */
export function berthOf(f: Flight): { x: number; z: number; yaw: number; landing: [number, number] } {
  const s = FLIGHT_LEN + LANDING_LEN / 2 + 0.05;
  const u = FLIGHT_W + 0.78 + 0.6; // room to turn away from the steps
  const x = f.top[0] + f.t[0] * s + f.n[0] * u;
  const z = f.top[1] + f.t[1] * s + f.n[1] * u;
  const lx = f.top[0] + f.t[0] * (FLIGHT_LEN + LANDING_LEN / 2) + f.n[0] * FLIGHT_W * 0.5;
  const lz = f.top[1] + f.t[1] * (FLIGHT_LEN + LANDING_LEN / 2) + f.n[1] * FLIGHT_W * 0.5;
  return { x: r2(x), z: r2(z), yaw: +Math.atan2(f.t[0], f.t[1]).toFixed(4), landing: [r2(lx), r2(lz)] };
}

/** The hire landings: the waterman's boats lie at the foot of these flights. */
export const LANDINGS: Record<LandingId, { label: string; flight: Flight; kind: BoatKind; place: string }> = {
  rijnkaai: { label: "the Rijnkaai steps", flight: { top: [-4, 0], t: [-1, 0], n: [0, -1] }, kind: "rowboat", place: "werf" },
  vismarkt: { label: "the Vismarkt steps", flight: { top: [-110, 0], t: [-1, 0], n: [0, -1] }, kind: "rowboat", place: "vismarkt" },
  bassin: { label: "the Petit Bassin steps", flight: { top: [90, 46], t: [1, 0], n: [0, 1] }, kind: "punt", place: "canal" },
};
export const LANDING_IDS = Object.keys(LANDINGS) as LandingId[];
export function isLanding(s: unknown): s is LandingId {
  return typeof s === "string" && Object.hasOwn(LANDINGS, s);
}

/** Unattended boats, tied up at other steps: their owners are boatmen of the town. */
const LOOSE: Array<{ id: string; flight: Flight; kind: BoatKind; place: string; where: string }> = [
  { id: "boat:canal", flight: { top: [-70, 38], t: [0, 1], n: [-1, 0] }, kind: "punt", place: "canal", where: "from the canal steps" },
  { id: "boat:cartstand", flight: { top: [50, 0], t: [1, 0], n: [0, -1] }, kind: "rowboat", place: "werf", where: "from the steps by the cart stand" },
  { id: "boat:north", flight: { top: [186, 0], t: [1, 0], n: [0, -1] }, kind: "punt", place: "vismarkt", where: "from the steps north of the lock" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ state

function state<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return fallback;
  }
}
function setState(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

/** Game minutes since Monday 0:00. */
export function rowMinute(db: DB): number {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return (p.day - 1) * 1440 + p.hour * 60 + p.minute;
}

export interface Hire {
  landing: LandingId;
  kind: BoatKind;
  /** Game minute the hire was paid. */
  since: number;
  /** Left where the waterman does not want it: where, and when (game minute). */
  left: { x: number; z: number; at: number } | null;
}

export interface RowState {
  hire: Hire | null;
  /** What Jef sits in now: "hire", a loose boat's id, or null. */
  on: string | null;
  /** Game minute he got in last (a long row makes him hungrier). */
  onSince: number;
  /** Hard strokes not yet paid for in food. */
  effort: number;
  /** Owed to the watermen (lost boat not paid, late money). */
  debt_c: number;
  /** Whose debt it is (the waterman's resident id), for the police. */
  debt_to: string | null;
  /** The day the debt began: still owed after a night, it goes to the police (town/rowDeeds.ts). */
  debt_day: number | null;
  /** A note for the client (the boy fetched the boat; the debt went to the police). */
  notice: { n: number; text: string } | null;
}


export function rowState(db: DB): RowState {
  const s = state<Partial<RowState>>(db, "row", {});
  return {
    hire: s.hire && isLanding(s.hire.landing) ? s.hire : null,
    on: typeof s.on === "string" ? s.on : null,
    onSince: Number(s.onSince) || 0,
    effort: Math.max(0, Math.min(2 * ROW_EFFORT_PER_FOOD, Number(s.effort) || 0)),
    debt_c: Math.max(0, Math.min(ROW_DEBT_MAX_C, Math.round(Number(s.debt_c) || 0))),
    debt_to: typeof s.debt_to === "string" ? s.debt_to : null,
    debt_day: typeof s.debt_day === "number" ? s.debt_day : null,
    notice: s.notice ?? null,
  };
}
export function saveRow(db: DB, s: RowState): void {
  setState(db, "row", s);
}
export function notice(s: RowState, text: string): void {
  s.notice = { n: (s.notice?.n ?? 0) + 1, text };
}

/** Is Jef in a boat now (for the hourly needs)? */
export function rowing(db: DB): boolean {
  return rowState(db).on !== null;
}

// ------------------------------------------------------------------ the watermen and the boats

export interface LooseBoat {
  id: string;
  kind: BoatKind;
  owner: string;
  x: number;
  z: number;
  yaw: number;
  /** Where Jef stands to step in (the landing of the flight). */
  landing: [number, number];
  where: string;
}

const memo = new WeakMap<DB, { seed: number; boats: LooseBoat[]; watermen: Record<LandingId, string | null> }>();

function people(db: DB) {
  const t = town(db).town;
  const had = memo.get(db);
  if (had && had.seed === t.seed) return had;
  const boatmen = t.residents.filter((r) => r.trade === "boatman" && r.age >= 18);
  const used = new Set<string>();
  // the watermen: a boatman of the place if there is one, else any boatman not yet taken
  const pick = (place: string) => {
    const r = boatmen.find((q) => q.work.place === place && !used.has(q.id)) ?? boatmen.find((q) => !used.has(q.id));
    if (r) used.add(r.id);
    return r?.id ?? null;
  };
  const watermen = { rijnkaai: pick("werf"), vismarkt: pick("vismarkt"), bassin: pick("canal") } as Record<LandingId, string | null>;
  // the owners of the loose boats: the other boatmen, then men of the quays (a sailor, a docker keeps a boat too)
  const quayMen = t.residents.filter((r) => ["sailor", "docker", "natie", "porter"].includes(r.trade) && r.sex === "m" && r.age >= 20 && r.age < 65);
  const boats: LooseBoat[] = [];
  for (const b of LOOSE) {
    const owner = boatmen.find((r) => r.work.place === b.place && !used.has(r.id)) ?? boatmen.find((r) => !used.has(r.id)) ?? quayMen.find((r) => r.work.place === b.place && !used.has(r.id)) ?? quayMen.find((r) => !used.has(r.id));
    if (!owner) continue;
    used.add(owner.id);
    const berth = berthOf(b.flight);
    boats.push({ id: b.id, kind: b.kind, owner: owner.id, x: berth.x, z: berth.z, yaw: berth.yaw, landing: berth.landing, where: b.where });
  }
  const out = { seed: t.seed, boats, watermen };
  memo.set(db, out);
  return out;
}

/** The boats that lie unattended, made from the town (same seed, same owners). */
export function rowBoats(db: DB): LooseBoat[] {
  return people(db).boats;
}

/** The waterman who hires out at a landing (a boatman of the town), or null in a town without one. */
export function waterman(db: DB, landing: LandingId): string | null {
  return people(db).watermen[landing];
}

export interface BoatState {
  x: number;
  z: number;
  yaw: number;
  /** Jef sits in it. */
  ridden: boolean;
  /** The open deed that made it Jef's. */
  deed: number | null;
  /** Broken and sunk; a new one lies there from the next morning. */
  lostDay?: number;
}

export function rowBoatStates(db: DB): Record<string, BoatState> {
  const saved = state<Record<string, BoatState>>(db, "row_boats", {});
  const day = player(db).day;
  const out: Record<string, BoatState> = {};
  for (const b of rowBoats(db)) {
    const s = saved[b.id];
    // a lost boat is replaced the next morning
    out[b.id] = s && !(s.lostDay !== undefined && s.lostDay < day) ? s : { x: b.x, z: b.z, yaw: b.yaw, ridden: false, deed: null };
  }
  return out;
}
export function setRowBoat(db: DB, id: string, s: BoatState): void {
  const all = rowBoatStates(db);
  all[id] = s;
  setState(db, "row_boats", all);
}

/** Back where it belongs (given back, or the police saw to it). Jef is out of it. */
export function rowBoatHome(db: DB, id: string): void {
  const b = rowBoats(db).find((q) => q.id === id);
  if (!b) return;
  const st = rowBoatStates(db)[id];
  if (st?.lostDay !== undefined) return; // at the bottom of the river: nothing to bring home
  setRowBoat(db, id, { x: b.x, z: b.z, yaw: b.yaw, ridden: false, deed: null });
  const s = rowState(db);
  if (s.on === id) {
    s.on = null;
    saveRow(db, s);
  }
}

/** Jef sits in a loose boat now (deeds.ts calls this when he takes one). */
export function rowOn(db: DB, what: string): void {
  const s = rowState(db);
  s.on = what;
  s.onSince = rowMinute(db);
  saveRow(db, s);
}

// ------------------------------------------------------------------ money

/** What the waterman asks for being late now (0 while the hire runs). */
export function lateFee(h: Hire, now: number): number {
  const over = now - h.since - ROW_HIRE_HOURS * 60;
  if (over <= 0) return 0;
  return Math.min(ROW_LATE_MAX_C, Math.ceil(over / 60) * ROW_LATE_C);
}

/** What a lost boat costs (by kind, clamped). */
export function lostFee(kind: BoatKind): number {
  return Math.max(ROW_LOST_MIN_C, Math.min(ROW_LOST_MAX_C, ROW_LOST_C[kind] ?? ROW_LOST_MAX_C));
}

/** Take what Jef can pay of a sum; the rest is owed to `to`. Returns what he paid. */
function charge(db: DB, s: RowState, sum: number, to: string | null): { paid: number; owed: number } {
  sum = Math.max(0, Math.round(sum));
  const money = player(db).money_c;
  const paid = Math.min(money, sum);
  if (paid) db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(paid);
  const owed = sum - paid;
  if (owed) {
    if (!s.debt_c) s.debt_day = player(db).day;
    s.debt_c = Math.min(ROW_DEBT_MAX_C, s.debt_c + owed);
    s.debt_to = to ?? s.debt_to;
  }
  return { paid, owed };
}

const LANDING_REACH = 9; // metres from a berth that count as "at the landing"

/** The hire landing whose berth is within reach of (x, z), if any. */
export function landingAt(x: number, z: number): LandingId | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  for (const id of LANDING_IDS) {
    const b = berthOf(LANDINGS[id].flight);
    if (Math.hypot(b.x - x, b.z - z) <= LANDING_REACH) return id;
  }
  return null;
}

function stormy(db: DB): boolean {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'weather'").get() as { value_json: string } | undefined;
  return row ? row.value_json === '"storm"' : false;
}
function wet(db: DB): boolean {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'weather'").get() as { value_json: string } | undefined;
  return row ? row.value_json === '"storm"' || row.value_json === '"rain"' : false;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
function first(db: DB, id: string | null): string {
  if (!id) return "The waterman";
  const n = (db.prepare("SELECT name FROM npc WHERE id = ?").get(id) as { name: string } | undefined)?.name;
  return n ? n.split(" ")[0] : "The waterman";
}

// ------------------------------------------------------------------ hire, get in, get out

/** Hire a boat at a landing. Jef must stand by it; old debts are paid first; never in a gale. */
export function hireBoat(db: DB, landing: unknown, x: number, z: number): { fee_c: number; debt_paid_c: number; kind: BoatKind; text: string } {
  if (!isLanding(landing)) throw new GameError("no such landing", 400);
  const L = LANDINGS[landing];
  const berth = berthOf(L.flight);
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(berth.landing[0] - x, berth.landing[1] - z) > 5) throw new GameError("too far from the boat", 409);
  const s = rowState(db);
  if (s.on) throw new GameError("you are in a boat already", 409);
  if (s.hire) throw new GameError("you have one of his boats out already", 409);
  const who = first(db, waterman(db, landing));
  if (stormy(db)) throw new GameError(`${who} will not let a boat out in this gale`, 409);
  const need = ROW_HIRE_C + s.debt_c;
  if (player(db).money_c < need)
    throw new GameError(s.debt_c ? `${who} wants the ${s.debt_c} c you owe the watermen first, and ${ROW_HIRE_C} c for the boat` : `not enough money: the boat is ${ROW_HIRE_C} c`, 409);
  const debt = s.debt_c;
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(need);
    s.debt_c = 0;
    s.debt_to = null;
    s.debt_day = null;
    s.hire = { landing, kind: L.kind, since: rowMinute(db), left: null };
    s.on = "hire";
    s.onSince = rowMinute(db);
    saveRow(db, s);
    log(db, "hired_boat", landing, `Jef hired a ${L.kind === "punt" ? "punt" : "rowing boat"} at ${L.label} for ${ROW_HIRE_C} centimes${debt ? `, and paid ${debt} centimes he owed` : ""}.`);
  })();
  return {
    fee_c: ROW_HIRE_C,
    debt_paid_c: debt,
    kind: L.kind,
    text: `${debt ? `You pay ${who} the ${debt} c you owed. ` : ""}${who} takes ${ROW_HIRE_C} c and holds the boat while you step down into it. "Back by ${ROW_HIRE_HOURS} hours from now, at any of our steps."`,
  };
}

/** Get back into the hired boat you left somewhere (before his boy has fetched it). */
export function boardHired(db: DB, x: number, z: number): { text: string } {
  const s = rowState(db);
  if (s.on) throw new GameError("you are in a boat already", 409);
  const h = s.hire;
  if (!h) throw new GameError("you have no boat out", 409);
  // the client says where the boat is now (it drifts); the engine only checks it is his and not fetched yet
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new GameError("bad place", 400);
  s.on = "hire";
  s.onSince = rowMinute(db);
  h.left = null;
  saveRow(db, s);
  return { text: "You climb back into the boat." };
}

export interface LeaveResult {
  returned: boolean;
  late_c: number;
  paid_c: number;
  owed_c: number;
  text: string;
}

/**
 * Jef gets out (at steps, a ladder, a pontoon, or over the side into the water). A hired boat
 * at a hire landing goes back to the waterman (late money taken); anywhere else it stays, and
 * his boy fetches it later for a fine (rowTick). A stolen boat stays where it is.
 */
export function leaveBoat(db: DB, x: number, z: number, yaw: number, ashore = true): LeaveResult {
  const s = rowState(db);
  if (!s.on) return { returned: false, late_c: 0, paid_c: 0, owed_c: 0, text: "" };
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new GameError("bad place", 400);
  const now = rowMinute(db);
  if (s.on !== "hire") {
    const id = s.on;
    const st = rowBoatStates(db)[id];
    s.on = null;
    db.transaction(() => {
      if (st) setRowBoat(db, id, { ...st, x: r2(x), z: r2(z), yaw: Number.isFinite(yaw) ? +yaw.toFixed(3) : st.yaw, ridden: false });
      saveRow(db, s);
    })();
    return { returned: false, late_c: 0, paid_c: 0, owed_c: 0, text: "" };
  }
  const h = s.hire!;
  // handed back only by a man who steps ashore there (over the side into the water is not giving it back)
  const at = ashore ? landingAt(x, z) : null;
  s.on = null;
  if (at) {
    const late = lateFee(h, now);
    let r = { paid: 0, owed: 0 };
    db.transaction(() => {
      r = charge(db, s, late, waterman(db, at));
      s.hire = null;
      saveRow(db, s);
      log(db, "returned_boat", at, `Jef brought the boat back to ${LANDINGS[at].label}${late ? `, ${late} centimes late money` : ""}.`);
    })();
    const who = first(db, waterman(db, at));
    return {
      returned: true,
      late_c: late,
      paid_c: r.paid,
      owed_c: r.owed,
      text: late
        ? r.owed
          ? `${who} ties the boat up. "Late. ${late} c." You give him ${r.paid} c; the rest you owe.`
          : `${who} ties the boat up. "You kept it long. ${late} c." You pay.`
        : `${who} ties the boat up and nods. "Good."`,
    };
  }
  h.left = { x: r2(x), z: r2(z), at: now };
  saveRow(db, s);
  return { returned: false, late_c: 0, paid_c: 0, owed_c: 0, text: "" };
}

/** Every tick: the waterman's boy fetches a boat left elsewhere, and Jef pays for it. */
export function rowTick(db: DB): string | null {
  const s = rowState(db);
  const h = s.hire;
  if (!h?.left) return null;
  const now = rowMinute(db);
  if (now - h.left.at < ROW_FETCH_MIN) return null;
  return fetchBoat(db, s, now, "fetched");
}

/** The hired boat goes back to the waterman from wherever it was left, at a price. */
function fetchBoat(db: DB, s: RowState, now: number, why: "fetched" | "night"): string {
  const h = s.hire!;
  const who = waterman(db, h.landing);
  const late = lateFee(h, now);
  const sum = ROW_LEFT_FINE_C + late;
  let r = { paid: 0, owed: 0 };
  db.transaction(() => {
    r = charge(db, s, sum, who);
    s.hire = null;
    if (s.on === "hire") s.on = null;
    const text =
      why === "night"
        ? `The waterman took his boat back for the night and ${r.paid} c from you${r.owed ? `; you owe him ${r.owed} c more` : ""}.`
        : `The waterman's boy found the boat where you left it and rowed it home. ${cap(first(db, who))} took ${r.paid} c for his trouble${r.owed ? `; you owe him ${r.owed} c more` : ""}.`;
    notice(s, text);
    saveRow(db, s);
    log(db, "boat_fetched", h.landing, `The waterman had the boat Jef left fetched, and took ${r.paid} centimes${r.owed ? ` (${r.owed} still owed)` : ""}.`);
    if (who) remember(db, who, "Jef left my boat lying out on the water and I had to send the boy for it.", 4, "seen", null, { gist: "Jef left a hired boat lying on the water", tone: -1 });
  })();
  return s.notice!.text;
}

/** A hired boat broke and sank: the waterman wants the boat paid. The police only if it stays unpaid (rowDeeds.ts). */
export function loseHired(db: DB, cause: unknown): { lost_c: number; paid_c: number; owed_c: number; text: string } {
  const s = rowState(db);
  const h = s.hire;
  if (!h || (s.on !== "hire" && !h.left)) throw new GameError("you have no hired boat out", 409);
  const why = cause === "ship" ? "run down by a ship" : cause === "bridge" ? "smashed at a bridge" : "broken";
  const who = waterman(db, h.landing);
  const now = rowMinute(db);
  const lost = lostFee(h.kind) + lateFee(h, now);
  let r = { paid: 0, owed: 0 };
  db.transaction(() => {
    r = charge(db, s, lost, who);
    s.hire = null;
    s.on = null;
    saveRow(db, s);
    log(db, "lost_boat", h.landing, `Jef lost the waterman's boat, ${why}. He paid ${r.paid} centimes${r.owed ? ` and owes ${r.owed}` : ""}.`);
    if (who) {
      remember(db, who, `Jef lost my ${h.kind === "punt" ? "punt" : "boat"}, ${why}.${r.owed ? ` He still owes me ${r.owed} centimes.` : ""}`, 6, "seen", null, { gist: `Jef lost a hired boat, ${why}`, tone: -1 });
      applyTrust(db, who, -1, 0);
    }
  })();
  const name = first(db, who);
  return {
    lost_c: lost,
    paid_c: r.paid,
    owed_c: r.owed,
    text: r.owed
      ? `${name} will want ${lost} c for his boat. You had ${r.paid} c; you owe him ${r.owed} c. If it is not paid by morning, he goes to the police.`
      : `${name} will want ${lost} c for his boat. It comes out of your pocket.`,
  };
}

/** Shift strokes, counted by the client, clamped by the clock (at most ROW_STROKES_PER_S a real second). */
let lastStrokeAt = 0;
export function rowEffort(db: DB, hard: unknown, now = Date.now()): number {
  const s = rowState(db);
  if (!s.on) return 0;
  const n = Math.max(0, Math.floor(Number(hard) || 0));
  const allowed = Math.floor(Math.max(0, Math.min(30, (now - lastStrokeAt) / 1000)) * ROW_STROKES_PER_S);
  lastStrokeAt = now;
  const add = Math.min(n, allowed);
  s.effort = Math.min(2 * ROW_EFFORT_PER_FOOD, s.effort + add);
  saveRow(db, s);
  return add;
}
/** Test helper. */
export function resetRowClock(): void {
  lastStrokeAt = 0;
}

// ------------------------------------------------------------------ needs (day.ts applyHour)

/**
 * On the water the wind gets at you: warmth -1 every 4 h by day (on foot 5), every 3 h by day
 * in rain or a gale, every 2 h at night (on foot 3). Null when not rowing.
 */
export function rowChillEvery(db: DB, cold: boolean): number | null {
  if (!rowing(db)) return null;
  return cold ? 2 : wet(db) ? 3 : 4;
}

/**
 * Food a row costs this hour, on top of the usual: 1 every 4th hour once he has been in the
 * boat 2 hours or more (a long row), and 1 for each ROW_EFFORT_PER_FOOD hard strokes, at most 1
 * of those an hour. 0 when not rowing.
 */
export function rowFood(db: DB, hour: number): number {
  const s = rowState(db);
  if (!s.on) return 0;
  let f = 0;
  if (hour % 4 === 0 && rowMinute(db) - s.onSince >= 120) f++;
  if (s.effort >= ROW_EFFORT_PER_FOOD) {
    f++;
    s.effort -= ROW_EFFORT_PER_FOOD;
    saveRow(db, s);
  }
  return f;
}

/**
 * The night (day.ts sleep): nobody rows through it. A hired boat still out goes back to the
 * waterman at the price of one left elsewhere; a stolen boat stays where it lies.
 */
export function endRowNight(db: DB): void {
  const s = rowState(db);
  if (s.on && s.on !== "hire") {
    const st = rowBoatStates(db)[s.on];
    if (st) setRowBoat(db, s.on, { ...st, ridden: false });
    s.on = null;
    saveRow(db, s);
  }
  if (s.hire) fetchBoat(db, rowState(db), rowMinute(db), "night");
}

/** For the client: the landings, the loose boats, the hire and the numbers. No needs. */
export function rowWorld(db: DB) {
  const s = rowState(db);
  const now = rowMinute(db);
  const states = rowBoatStates(db);
  return {
    landings: LANDING_IDS.map((id) => {
      const b = berthOf(LANDINGS[id].flight);
      return { id, label: LANDINGS[id].label, kind: LANDINGS[id].kind, top: LANDINGS[id].flight.top, landing: b.landing, x: b.x, z: b.z, yaw: b.yaw, waterman: first(db, waterman(db, id)) };
    }),
    boats: rowBoats(db).map((b) => {
      const st = states[b.id];
      return { id: b.id, kind: b.kind, owner: b.owner, owner_name: first(db, b.owner), landing: b.landing, where: b.where, x: st.x, z: st.z, yaw: st.yaw, ridden: st.ridden, mine: st.deed !== null, lost: st.lostDay !== undefined };
    }),
    hire: s.hire ? { landing: s.hire.landing, kind: s.hire.kind, minutes: now - s.hire.since, time_left_min: Math.max(0, s.hire.since + ROW_HIRE_HOURS * 60 - now), late_c: lateFee(s.hire, now), left: s.hire.left } : null,
    on: s.on,
    debt_c: s.debt_c,
    notice: s.notice,
    storm: stormy(db),
    fees: { hire_c: ROW_HIRE_C, hours: ROW_HIRE_HOURS, late_c: ROW_LATE_C, left_fine_c: ROW_LEFT_FINE_C },
  };
}
