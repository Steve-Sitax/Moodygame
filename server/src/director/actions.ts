import { sexed } from "../player/profile.ts"; // M7 character: lines said to the player follow the profile
import type { DB } from "../db.ts";
import type { Runner } from "../ai/claude.ts";
import { clock } from "../day.ts";
import { log } from "../game.ts";
import { pid } from "../player/current.ts";
import { SPOTS } from "../hooks/jobBoard.ts";
import { relationship, remember } from "../npcs.ts";
import { ITEMS, waresOf } from "../trade.ts";
import { gameMinute } from "../town/deeds.ts";
import { PLACES } from "../town/places.ts";
import { policeDispatch, policeState } from "../town/police.ts";
import type { Resident } from "../town/population.ts";
import { resident, town, TOWN_EMPLOYER_IDS } from "../town/store.ts";
import { nowOf, talkHooks, type ResidentLine } from "../town/talk.ts";
import { walkMap } from "../town/walkmap.ts";
import { notify } from "./bus.ts";
import { runConvo, type Purpose } from "./convo.ts";
import { eventSlice, writeEvent } from "./eventlog.ts";
import { streetCrimeOpen } from "./scenes.ts";
import {
  ActionProposalSchema,
  END_LINE,
  ERRAND_HARD_MIN,
  ERRAND_KINDS,
  FOLLOW_DEFAULT_MIN,
  FOLLOW_LOST_M,
  FOLLOW_MAX_MIN,
  FOLLOW_MIN_MIN,
  GO_TO_MAX_M,
  LOOK_FOR_MIN,
  LOOK_FOR_RADIUS_M,
  MAX_TALK_ACTIONS,
  REFUSE_LINE,
  RULES_FOR_MODEL,
  STORY_MINUTE_FACTOR,
  TALK_TO_MAX_M,
  TALK_TO_MIN,
  WAIT_MAX_MIN,
  WAIT_MIN_MIN,
  limitLine,
  walkMinutes,
  type ActionKind,
  type ActionProposal,
  type EngineKind,
  type RefuseReason,
} from "./vocab.ts";

// Townspeople who act (M4). A talk reply may carry a proposal ("follow", "go
// there", "fetch the police", ...). The ENGINE checks it in a fixed order
// (known kind, one thing at a time, not reserved, the trade, the stats, the
// target, the distance), clamps every number, and REPLACES the model's line
// with its own when it says no, so nobody says yes while the engine said no.
// An accepted action is a row in npc_action (it survives a reload); the client
// walks the person (game/actions.ts) and reports arrived / lost / blocked /
// done; the server ends what runs out of time (actionsTick) and runs the
// chains (fetch the police: go, report, the agent comes, looks, questions).
// Money moves only for a robbery the log knows of (restitution).


export interface ActionRow {
  id: number;
  npc_id: string;
  kind: EngineKind;
  target: string;
  target_x: number | null;
  target_z: number | null;
  reason: string;
  source: "talk" | "director" | "event" | "engine";
  event_id: number | null;
  status: "active" | "done" | "failed" | "stopped" | "refused";
  started: number;
  until: number;
  max_m: number;
  phase: string;
  x: number | null;
  z: number | null;
  outcome: string | null;
  data_json: string;
}

interface ActionData {
  /** The next link of a chain, started when this one is done. */
  then?: { kind: EngineKind; target?: string; target_x?: number; target_z?: number; minutes?: number; data?: ActionData };
  purpose?: Purpose;
  about?: string;
  /** Where Jef was when he asked. */
  jef?: { x: number; z: number };
  /** Column order in a procession (attend). */
  order?: number;
  /** attend: guests, crowd (onlookers), mourners ... ("lead" for a lead). */
  role?: string;
  /** M4b attend: the lead's part (bride, groom, fiddler, pickpocket, agent ...). */
  lead?: string;
  /** M4b bearers: which of the four. */
  n?: number;
  line?: string;
  /** M6 families and schemes: what a seek or a talk_to is for (the family_news row, the scheme). */
  news?: number;
  scheme?: number;
  reaction?: string;
  complaint?: number;
  /** go_to and the look about after it: the place's name, for the person's memory. */
  place?: string;
}

/** An agent sent to a place looks about it this long (game minutes; M7 clock: 120 -> 30, one real minute). */
const POLICE_LOOK_MIN = 30;
/** An errand still under way gets this much more time at once (game minutes; M7 clock: 60 -> 10, 20 real seconds). */
const ERRAND_MORE_MIN = 10;

// ------------------------------------------------------------------ what the client tells us

interface Known {
  x: number;
  z: number;
  at: number;
}
const KNOWN_TTL_MS = 15_000;
const sync = { x: NaN, z: NaN, at: 0, people: new Map<string, Known>() };

/** A point the client sent: finite numbers only, kept inside the map (+-2000 m); else null. */
export function clampXZ(x: unknown, z: unknown): { x: number; z: number } | null {
  if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x: Math.max(-2000, Math.min(2000, x)), z: Math.max(-2000, Math.min(2000, z)) };
}

/**
 * The client says where Jef is and who is in the street near him (every 2 s while actions run).
 * With `db`, only the town's residents are kept; stale entries go on every write.
 */
export function syncFromClient(body: unknown, now = Date.now(), db?: DB): { ok: boolean } {
  const b = (body ?? {}) as { x?: unknown; z?: unknown; people?: unknown };
  const jef = clampXZ(b.x, b.z);
  if (jef) {
    sync.x = jef.x;
    sync.z = jef.z;
    sync.at = now;
  }
  if (Array.isArray(b.people)) {
    for (const [id, k] of sync.people) if (now - k.at > KNOWN_TTL_MS) sync.people.delete(id);
    for (const p of b.people.slice(0, 60) as Array<{ id?: unknown; x?: unknown; z?: unknown }>) {
      if (typeof p?.id !== "string") continue;
      const at = clampXZ(p.x, p.z);
      const id = p.id.slice(0, 20);
      if (!at || (db && !town(db).byId.has(id))) continue;
      sync.people.set(id, { x: at.x, z: at.z, at: now });
    }
  }
  return { ok: true };
}

export function jefAt(now = Date.now()): { x: number; z: number } | null {
  return Number.isFinite(sync.x) && now - sync.at < KNOWN_TTL_MS * 4 ? { x: sync.x, z: sync.z } : null;
}

/**
 * M6 families: the people the client last saw in the street within r metres of (x, z), fresh
 * only (the engine's deterrence and witnesses). Ids and distances; nothing the client says is
 * trusted beyond who stood where.
 */
export function peopleNear(x: number, z: number, r: number, now = Date.now()): Array<{ id: string; d: number }> {
  const out: Array<{ id: string; d: number }> = [];
  for (const [id, k] of sync.people) {
    if (now - k.at > KNOWN_TTL_MS) continue;
    const d = Math.hypot(k.x - x, k.z - z);
    if (d <= r) out.push({ id, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

/**
 * M6: other modules plug into the actions here (director/families.ts, surprises.ts), so this file
 * needs no import of them. `reserved`: someone nobody may use for anything else (a stranger who
 * has not arrived, the fortune teller at her table). `report`: the client's word on a kind this
 * file does not walk itself ("seek"). `talkTo`: a talk_to with its own purpose (share, scheme)
 * when the two meet. `timeUp`: an action of theirs ran out of time.
 */
export const actionHooks = {
  reserved: [] as Array<(db: DB, id: string) => boolean>,
  report: {} as Record<string, (db: DB, a: ActionRow, rep: Report, runner?: Runner) => Promise<ActionRow | null>>,
  talkTo: {} as Record<string, (db: DB, a: ActionRow, runner?: Runner) => Promise<string>>,
  timeUp: {} as Record<string, (db: DB, a: ActionRow) => boolean>,
};

/** Test helper. */
export function resetSync(): void {
  sync.x = NaN;
  sync.z = NaN;
  sync.at = 0;
  sync.people.clear();
}

// ------------------------------------------------------------------ where people are

export interface Where {
  x: number;
  z: number;
  indoors: boolean;
}

/** Where the engine thinks a resident is now, from their schedule (the client knows better for those in the street). */
export function whereIs(db: DB, r: Resident): Where {
  const now = nowOf(db, r);
  const t = town(db).town;
  const pl = (id: string) => t.places[id];
  switch (now.act) {
    case "home":
      return { x: r.home.sx, z: r.home.sz, indoors: true };
    case "work": {
      const w = r.work;
      if (w.kind === "inside") return { x: w.door?.[0] ?? r.home.sx, z: w.door?.[1] ?? r.home.sz, indoors: true };
      if (w.at) return { x: w.at[0], z: w.at[1], indoors: false };
      if (w.a) return { x: w.a[0], z: w.a[1], indoors: false };
      if (w.route?.length) return { x: w.route[0][0], z: w.route[0][1], indoors: false };
      const p = pl(w.place);
      return p ? { x: p.x, z: p.z, indoors: false } : { x: r.home.sx, z: r.home.sz, indoors: true };
    }
    case "church":
      return { x: -262, z: 149.5, indoors: true };
    default: {
      const p = pl(now.place) ?? pl(r.work.place);
      if (p?.door) return { x: p.door[0], z: p.door[1], indoors: false };
      return p ? { x: p.x, z: p.z, indoors: false } : { x: r.home.sx, z: r.home.sz, indoors: true };
    }
  }
}

/** The client's word first (if fresh), else the schedule. */
export function posOf(db: DB, id: string, now = Date.now()): Where | null {
  const k = sync.people.get(id);
  if (k && now - k.at < KNOWN_TTL_MS) return { x: k.x, z: k.z, indoors: false };
  const r = resident(db, id);
  return r ? whereIs(db, r) : null;
}

// ------------------------------------------------------------------ targets

const norm = (s: string) => s.toLowerCase().replace(/^(the|a|an|agent|old|young|mister|missus|mr|mrs)\s+/g, "").replace(/[^a-z\s'-]/g, "").trim();

/** A person by name (full name, or a first name; the nearest to Jef when several share it). */
export function findPerson(db: DB, name: string, near?: { x: number; z: number } | null): Resident | null {
  const n = norm(name);
  if (!n) return null;
  const all = town(db).town.residents.filter((r) => r.trade !== "infant");
  const exact = all.filter((r) => norm(r.name) === n);
  const firsts = exact.length ? exact : all.filter((r) => norm(r.first) === n || norm(r.surname) === n);
  const list = firsts.length ? firsts : all.filter((r) => norm(r.name).includes(n) && n.length >= 4);
  if (!list.length) return null;
  if (list.length === 1 || !near) return list[0];
  return list
    .map((r) => ({ r, d: (() => { const p = posOf(db, r.id); return p ? Math.hypot(p.x - near.x, p.z - near.z) : 9e9; })() }))
    .sort((a, b) => a.d - b.d)[0].r;
}

export interface PlaceHit {
  id: string;
  label: string;
  x: number;
  z: number;
}

/** A place by id or by a bit of its label: the town's places (shops, taverns, squares), the board's spots. */
export function findPlace(db: DB, name: string): PlaceHit | null {
  const n = norm(name);
  if (!n) return null;
  const t = town(db).town;
  const hits: PlaceHit[] = [];
  for (const [id, p] of Object.entries(t.places)) hits.push({ id, label: p.label, x: p.door?.[0] ?? p.x, z: p.door?.[1] ?? p.z });
  for (const p of PLACES) if (!t.places[p.id]) hits.push({ id: p.id, label: p.label, x: p.x, z: p.z });
  for (const [id, s] of Object.entries(SPOTS)) if (!id.startsWith("_") && typeof s.label === "string") hits.push({ id, label: s.label, x: s.x, z: s.z });
  hits.push({ id: "cathedral_west", label: "the west door of the cathedral", x: -262, z: 149.5 });
  const byId = hits.find((h) => h.id === n.replace(/\s+/g, "_"));
  if (byId) return byId;
  const byLabel = hits.find((h) => norm(h.label) === n) ?? hits.find((h) => norm(h.label).includes(n)) ?? hits.find((h) => n.includes(norm(h.label)) && norm(h.label).length >= 5);
  return byLabel ?? null;
}

// ------------------------------------------------------------------ the open crime

export interface Crime {
  thief: string;
  amount_c: number;
  logId: number;
  day: number;
}

/** The last time Jef was robbed, if the money is not back yet (the engine fact the police case needs). */
export function crimeOpen(db: DB): Crime | null {
  // (M8c: the player's own robbery, not another player's)
  const rows = db.prepare("SELECT id, day, verb, object, text FROM log WHERE verb IN ('robbed', 'caught_thief', 'restitution') AND player_id = ? ORDER BY id DESC LIMIT 6").all(pid()) as Array<{
    id: number;
    day: number;
    verb: string;
    object: string | null;
    text: string;
  }>;
  const last = rows.find((r) => r.verb === "robbed");
  if (!last || !last.object) return null;
  const back = rows.find((r) => r.id > last.id && r.object === last.object && (r.verb === "caught_thief" || r.verb === "restitution"));
  if (back) return null;
  const m = /(\d+) centimes/.exec(last.text);
  const amount = m ? Number(m[1]) : 0;
  if (!amount) return null;
  return { thief: last.object, amount_c: amount, logId: last.id, day: last.day };
}

// ------------------------------------------------------------------ rows

const parseData = (r: ActionRow): ActionData => {
  try {
    return JSON.parse(r.data_json) as ActionData;
  } catch {
    return {};
  }
};

export function activeActions(db: DB): ActionRow[] {
  return db.prepare("SELECT * FROM npc_action WHERE status = 'active' ORDER BY id").all() as ActionRow[];
}

export function actionOf(db: DB, npcId: string): ActionRow | null {
  return (db.prepare("SELECT * FROM npc_action WHERE status = 'active' AND npc_id = ? ORDER BY id DESC LIMIT 1").get(npcId) as ActionRow | undefined) ?? null;
}

export function actionRow(db: DB, id: number): ActionRow | null {
  return (db.prepare("SELECT * FROM npc_action WHERE id = ?").get(id) as ActionRow | undefined) ?? null;
}

export interface NewAction {
  npc_id: string;
  kind: EngineKind;
  target?: string;
  target_x?: number | null;
  target_z?: number | null;
  reason?: string;
  source: ActionRow["source"];
  event_id?: number | null;
  minutes: number;
  max_m?: number;
  phase?: string;
  data?: ActionData;
}

/** Start an action (already checked). Writes the row and the event; tells the client. */
export function startAction(db: DB, a: NewAction): ActionRow {
  const now = gameMinute(db);
  const r = resident(db, a.npc_id);
  const pos = r ? posOf(db, a.npc_id) : null;
  const res = db
    .prepare(
      `INSERT INTO npc_action (npc_id, kind, target, target_x, target_z, reason, source, event_id, status, started, until, max_m, phase, x, z, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(a.npc_id, a.kind, a.target ?? "", a.target_x ?? null, a.target_z ?? null, (a.reason ?? "").slice(0, 120), a.source, a.event_id ?? null, now, now + a.minutes, a.max_m ?? 0, a.phase ?? "going", pos?.x ?? null, pos?.z ?? null, JSON.stringify(a.data ?? {}));
  const row = actionRow(db, Number(res.lastInsertRowid))!;
  const name = r?.name ?? a.npc_id;
  writeEvent(db, {
    kind: "action",
    verb: `action_${a.kind}`,
    actor: a.npc_id,
    target: a.target ?? null,
    text: describeStart(name, { ...row, target: targetLabel(db, row.target) }),
    x: a.target_x ?? null,
    z: a.target_z ?? null,
    ref_type: "npc_action",
    ref_id: row.id,
    weight: a.source === "talk" ? 4 : 3,
    who: [a.npc_id],
  });
  notify("actions");
  return row;
}

/** A person's or a place's name for a line the player may read: never a bare id (r147). */
function targetLabel(db: DB, t: string | null | undefined): string {
  if (!t) return "";
  const r = resident(db, t);
  if (r) return r.name;
  const n = db.prepare("SELECT name FROM npc WHERE id = ?").get(t) as { name: string } | undefined;
  if (n) return n.name;
  const p = PLACES.find((q) => q.id === t);
  return p?.label ?? t;
}

function describeStart(name: string, a: ActionRow): string {
  switch (a.kind) {
    case "follow":
      return `${name} set off with Jef${a.reason ? ` (${a.reason})` : ""}.`;
    case "go_to":
      return `${name} went to ${a.target || "a place"} for Jef.`;
    case "wait":
      return `${name} waited for Jef where they stood.`;
    case "talk_to":
      return `${name} went to have a word with ${a.target}.`;
    case "look_for":
      return `${name} went looking for ${a.target}.`;
    case "fetch_police":
      return `${name} went to fetch the police for Jef.`;
    case "attend":
      return `${name} joined ${a.target || "the gathering"}.`;
    case "seek":
      return `${name} went to find Jef${a.reason ? ` (${a.reason})` : ""}.`;
    case "routine":
      return `${name} set off with Jef${a.reason ? `: ${a.reason}` : ""}.`;
    default:
      return `${name} did something for Jef.`;
  }
}

/** End an action with a status and the engine's words; the client shows the line. */
export function endAction(db: DB, id: number, status: "done" | "failed" | "stopped", outcome: string, line = ""): ActionRow | null {
  const row = actionRow(db, id);
  if (!row || row.status !== "active") return row;
  db.prepare("UPDATE npc_action SET status = ?, outcome = ?, data_json = ? WHERE id = ?").run(status, outcome, JSON.stringify({ ...parseData(row), line }), id);
  const r = resident(db, row.npc_id);
  const name = r?.name ?? row.npc_id;
  rememberErrand(db, row, status, outcome);
  if (row.kind !== "attend") {
    writeEvent(db, {
      kind: "action",
      verb: `${row.kind}_${status}`,
      actor: row.npc_id,
      target: row.target || null,
      text: `${name}: ${row.kind.replace("_", " ")} ${status} (${outcome}).`,
      outcome,
      ref_type: "npc_action",
      ref_id: id,
      weight: status === "done" ? 3 : 2,
      who: [row.npc_id],
    });
  }
  notify("actions", { ended: { id, npc: row.npc_id, name, kind: row.kind, status, outcome, line } });
  return actionRow(db, id);
}

/**
 * Fixes 2026-09-24: what they did for Jef stays in their memory, in the engine's words. Steve sent
 * an agent to the cathedral; the walk timed out and, asked why, the agent made up "a funeral,
 * no thieves": the talk knew only the running action, so the model filled the gap. Errands for
 * Jef only (asked in talk, or the engine's links after them); follow and wait need no story.
 */
function rememberErrand(db: DB, row: ActionRow, status: string, outcome: string): void {
  if (row.source !== "talk" && row.source !== "engine") return;
  if (status === "stopped" || outcome === "event over") return;
  const data = parseData(row);
  const why = row.reason ? ` (${row.reason.slice(0, 60)})` : "";
  const who = row.target ? (resident(db, row.target)?.name ?? null) : null;
  const place = data.place ?? row.target;
  let text = "";
  switch (row.kind) {
    case "go_to":
      if (outcome === "arrived") text = data.then ? "" : `I went to ${place} for Jef${why}.`;
      else if (outcome === "blocked") text = `Jef sent me to ${place}${why}. I could not get through and turned back.`;
      else text = `Jef sent me to ${place}${why}. It was too far; I gave up on the way and turned back.`;
      break;
    case "look_for":
      if (outcome === "found" && who) text = `For Jef${why} I looked about and found ${who}.`;
      else text = `For Jef${why} I looked about ${data.place ?? "the place"}${who ? ` for ${who}` : ""} and found nothing.`;
      break;
    case "talk_to":
      if (status === "failed") text = `Jef asked me to speak to ${who ?? "someone"}${why}. I could not find them.`;
      break;
    case "fetch_police":
      text = status === "done" ? `I fetched an agent for Jef${why}.` : `Jef asked me to fetch the police${why}. I found no agent.`;
      break;
  }
  if (text) remember(db, row.npc_id, text, 4);
}

/** Every active action of one event ends (the event is over). */
export function endEventActions(db: DB, eventId: number): void {
  for (const a of activeActions(db).filter((x) => x.event_id === eventId)) endAction(db, a.id, "done", "event over");
}

// ------------------------------------------------------------------ the checks

export interface Accepted {
  ok: true;
  action: NewAction | null;
  /** What the person adds to their line (the limit), or the whole line for an instant thing. */
  line: string;
  /** No walking: it happened in the talk (an offer, the purse back, a stop). */
  instant: boolean;
  /** M6 gifts and hired hands: keep the person's own line and add this one after it (instant only). */
  keep?: boolean;
  /** M6: fields of the reply the engine sets (the model's trust delta is not the gift's). */
  patch?: Partial<ResidentLine>;
  /** M6: what the client shows with the line (the hand-over, a note). */
  extra?: Record<string, unknown>;
}
export interface Refused {
  ok: false;
  reason: RefuseReason;
  line: string;
  patch?: Partial<ResidentLine>;
  extra?: Record<string, unknown>;
}

/**
 * M6 gifts, the treat and hired hands (town/gifts.ts, treat.ts, hire.ts): a module that checks a
 * kind of proposal itself. null: not mine, the checks below go on.
 */
export const proposeHooks: Record<string, (db: DB, r: Resident, p: ActionProposal, at: { jef: { x: number; z: number } | null; mine: Where }) => Accepted | Refused | null> = {};

/** One read of what isReserved needs (the police visit, who is acting now), for a loop over the whole town. */
export interface ReserveSnap {
  agent: string | null;
  acting: Map<string, ActionRow>;
}
export function reserveSnap(db: DB): ReserveSnap {
  const v = policeState(db).visit;
  const acting = new Map<string, ActionRow>();
  for (const a of activeActions(db)) acting.set(a.npc_id, a); // by id: the newest wins, as in actionOf
  return { agent: v && v.state !== "due" ? v.agent : null, acting };
}

export function isReserved(db: DB, id: string, snap?: ReserveSnap): boolean {
  if (snap) {
    if (snap.agent === id) return true;
  } else {
    const v = policeState(db).visit;
    if (v && v.agent === id && v.state !== "due") return true;
  }
  const a = snap ? snap.acting.get(id) : actionOf(db, id);
  if (a && (a.source === "event" || a.source === "engine")) return true;
  return actionHooks.reserved.some((f) => f(db, id));
}

function isNightNow(db: DB): boolean {
  const h = clock(db).hour;
  return h >= 20 || h < 6;
}

const refuse = (reason: RefuseReason, line = REFUSE_LINE[reason]): Refused => ({ ok: false, reason, line });

/**
 * The engine checks a proposal in order: known kind, one action per person, at most
 * three asked in talk, not reserved, the trade, the stats, the target, the distance.
 */
export function validateProposal(db: DB, r: Resident, raw: unknown): Accepted | Refused {
  const parsed = ActionProposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: true, action: null, line: "", instant: false };
  const p = parsed.data;
  if (p.kind === "none") return { ok: true, action: null, line: "", instant: false };
  const jef = jefAt();
  // they are talking face to face: where the client saw them, else where Jef is, else the schedule's guess
  const known = sync.people.get(r.id);
  const mine: Where = known && Date.now() - known.at < KNOWN_TTL_MS ? { x: known.x, z: known.z, indoors: false } : jef ? { ...jef, indoors: false } : whereIs(db, r);
  const now = nowOf(db, r);
  const police = r.trade === "police" || r.trade === "water_bailiff";
  const crime = crimeOpen(db);
  // M4b: a robbery in the street that Jef saw counts too (the police will listen to a witness)
  const street = streetCrimeOpen(db);
  const crimeReason = /rob|thie|stol|pick|purse|pocket/i.test(p.reason) || !!crime || !!street?.witnessed;
  const own = proposeHooks[p.kind]?.(db, r, p, { jef, mine });
  if (own) return own;

  // stop: only what was asked in talk
  if (p.kind === "stop") {
    const a = actionOf(db, r.id);
    if (!a || a.source !== "talk") return refuse("nothing_to_stop");
    endAction(db, a.id, "stopped", "asked to stop", END_LINE.stopped);
    return { ok: true, action: null, line: END_LINE.stopped, instant: true };
  }

  // give: an offer from the wares, or the purse back; never other money
  if (p.kind === "give") {
    const wares = waresOf(db, r.id);
    const want = norm(p.item);
    const ware = want ? wares.find((w) => w.kind === want || norm(ITEMS[w.kind]?.name ?? "").includes(want)) : undefined;
    if (ware) {
      const nm = ITEMS[ware.kind].name;
      return { ok: true, action: null, line: `${nm[0].toUpperCase() + nm.slice(1)}? ${ware.price_c} centimes, and you pay at the counter like anyone else.`, instant: true };
    }
    if (crime && crime.thief === r.id && payBackInTalk(db, r, crime)) {
      return { ok: true, action: null, line: `Here. Your ${crime.amount_c} centimes. Take it and keep your voice down.`, instant: true };
    }
    return refuse("no_money");
  }

  // one thing at a time; the town's not an errand service
  const busy = actionOf(db, r.id);
  if (busy) {
    if (busy.source !== "talk") return refuse("reserved");
    return refuse("busy", busy.kind === p.kind ? "I'm on it already. Give me a moment." : REFUSE_LINE.busy);
  }
  if (activeActions(db).filter((a) => a.source === "talk").length >= MAX_TALK_ACTIONS) return refuse("too_many");
  if (isReserved(db, r.id)) return refuse("reserved");
  if (TOWN_EMPLOYER_IDS.includes(r.id)) return refuse("post");

  // the trade
  const keeper = (r.work.kind === "stall" || r.work.kind === "shop" || r.work.kind === "tavern") && now.act === "work";
  if (keeper) return refuse("at_stall");
  // the guard (town/garrison.ts): a sentry or the corporal is on guard the whole day, at the post or in the guard room
  if (r.work.kind === "guard") return refuse("post");
  if (r.age < 13 && (p.kind === "talk_to" || p.kind === "fetch_police" || p.kind === "look_for")) return refuse("child", sexed(db, REFUSE_LINE.child));

  // the stats
  if (p.kind === "follow") {
    const trust = relationship(db, r.id)?.trust ?? 0;
    if (!(trust >= 2 || r.stats.warmth >= 6 || (police && crimeReason))) return refuse("no_trust");
  }
  if (isNightNow(db) && r.stats.courage <= 3 && r.age >= 13) return refuse("dark");

  // the target, the way, the distance
  switch (p.kind) {
    case "follow": {
      const max = FOLLOW_MAX_MIN[r.trade] ?? (r.age < 13 ? FOLLOW_MAX_MIN.child : FOLLOW_DEFAULT_MIN);
      const minutes = p.minutes > 0 ? Math.max(FOLLOW_MIN_MIN, Math.min(max, p.minutes * STORY_MINUTE_FACTOR)) : max;
      return {
        ok: true,
        instant: false,
        line: limitLine("follow", minutes, police),
        action: { npc_id: r.id, kind: "follow", target: "Jef", reason: p.reason, source: "talk", minutes, max_m: FOLLOW_LOST_M, data: jef ? { jef } : {} },
      };
    }
    case "wait": {
      const minutes = Math.max(WAIT_MIN_MIN, Math.min(WAIT_MAX_MIN, p.minutes ? p.minutes * STORY_MINUTE_FACTOR : WAIT_MAX_MIN));
      return { ok: true, instant: false, line: limitLine("wait", minutes, police), action: { npc_id: r.id, kind: "wait", target: "here", reason: p.reason, source: "talk", minutes, target_x: mine.x, target_z: mine.z } };
    }
    case "go_to": {
      const place = findPlace(db, p.target);
      if (!place) return refuse("unknown_place");
      const open = walkMap().nearestOpen(place.x, place.z, 3);
      if (!open) return refuse("no_way");
      const d = Math.hypot(open.x - mine.x, open.z - mine.z);
      if (d > GO_TO_MAX_M) return refuse("too_far");
      const minutes = walkMinutes(d);
      // an agent sent to a place looks about it when he gets there (for the thief the log knows
      // of, else for anyone about), and says what he found; he does not just turn round
      const thief = police ? (crimeOpen(db)?.thief ?? (streetCrimeOpen(db)?.witnessed ? streetCrimeOpen(db)!.thief : null)) : null;
      const then: ActionData["then"] | undefined = police
        ? { kind: "look_for", target: thief ?? "", minutes: POLICE_LOOK_MIN, data: { purpose: "question", about: p.reason, place: place.label } }
        : undefined;
      return {
        ok: true,
        instant: false,
        line: limitLine("go_to", minutes, police),
        action: { npc_id: r.id, kind: "go_to", target: place.label, target_x: open.x, target_z: open.z, reason: p.reason, source: "talk", minutes, data: then ? { then, place: place.label } : { place: place.label } },
      };
    }
    case "talk_to":
    case "look_for": {
      const who = findPerson(db, p.target, jef ?? mine);
      if (!who || who.id === r.id) return refuse("unknown_person");
      const at = posOf(db, who.id)!;
      if (p.kind === "talk_to") {
        if (at.indoors) return refuse("indoors");
        const open = walkMap().nearestOpen(at.x, at.z, 3);
        if (!open) return refuse("no_way");
        if (Math.hypot(open.x - mine.x, open.z - mine.z) > TALK_TO_MAX_M) return refuse("too_far");
        const purpose: Purpose = police ? "question" : "chat";
        return {
          ok: true,
          instant: false,
          line: limitLine("talk_to", TALK_TO_MIN, police),
          action: { npc_id: r.id, kind: "talk_to", target: who.id, target_x: open.x, target_z: open.z, reason: p.reason, source: "talk", minutes: TALK_TO_MIN, data: { purpose, about: p.reason } },
        };
      }
      // M7 quest tests: a look about the street for someone at home at his dinner found "not a sign" after
      // half an hour; say so at once, as a talk_to does
      if (at.indoors) return refuse("indoors");
      const centre = jef ?? mine;
      return {
        ok: true,
        instant: false,
        line: limitLine("look_for", LOOK_FOR_MIN, police),
        action: { npc_id: r.id, kind: "look_for", target: who.id, target_x: centre.x, target_z: centre.z, reason: p.reason, source: "talk", minutes: LOOK_FOR_MIN, max_m: LOOK_FOR_RADIUS_M, data: { purpose: police ? "question" : "chat" } },
      };
    }
    case "fetch_police": {
      if (police) return refuse("busy", "I am the police. Tell me what happened.");
      const agent = policeDispatch(db, mine);
      if (!agent) return refuse("unknown_person", "There's no agent about at this hour. Try the post on the Grote Markt.");
      const at = posOf(db, agent)!;
      const open = walkMap().nearestOpen(at.x, at.z, 3) ?? { x: at.x, z: at.z };
      const d = Math.hypot(open.x - mine.x, open.z - mine.z);
      if (d > GO_TO_MAX_M) return refuse("too_far");
      const minutes = walkMinutes(d);
      return {
        ok: true,
        instant: false,
        line: limitLine("fetch_police", minutes, police),
        action: { npc_id: r.id, kind: "fetch_police", target: agent, target_x: open.x, target_z: open.z, reason: p.reason, source: "talk", minutes, data: { jef: jef ?? { x: mine.x, z: mine.z }, about: p.reason } },
      };
    }
    default:
      return { ok: true, action: null, line: "", instant: false };
  }
}

/** The thief himself hands the purse back when asked (the logged amount, once: the robbery must still be open). */
function payBackInTalk(db: DB, r: Resident, crime: Crime): boolean {
  const paid = db.transaction(() => {
    const c = crimeOpen(db);
    if (!c || c.logId !== crime.logId || c.thief !== r.id) return false;
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(crime.amount_c, pid());
    log(db, "restitution", r.id, `${r.name} gave Jef back the ${crime.amount_c} centimes he had lifted, when Jef asked him straight.`, r.id);
    return true;
  })();
  if (!paid) return false;
  remember(db, r.id, `Jef knew it was me and asked for his ${crime.amount_c} centimes back. I gave it him. He has a good eye.`, 7, "seen", null, { gist: "Jef got his money back from a pickpocket by asking him straight", tone: 1 });
  return true;
}

/**
 * The talk reply passes through here: the proposal is checked; on a refusal the
 * person's line is REPLACED by the engine's; on acceptance the limit is added.
 */
export function applyProposal(db: DB, r: Resident, line: ResidentLine): ResidentLine & { action_id: number | null; refused: RefuseReason | null } {
  const raw = (line as { action?: unknown }).action;
  if (!raw || (raw as ActionProposal).kind === "none") return { ...line, action_id: null, refused: null };
  const v = validateProposal(db, r, raw);
  if (!v.ok) {
    const p = ActionProposalSchema.safeParse(raw);
    writeEvent(db, { kind: "action", verb: "refused", actor: r.id, text: `${r.name} would not ${p.success ? p.data.kind.replace("_", " ") : "do it"} for Jef (${v.reason}).`, outcome: v.reason, weight: 2, who: [r.id] });
    db.prepare("INSERT INTO npc_action (npc_id, kind, target, reason, source, status, started, until, outcome) VALUES (?, ?, ?, ?, 'talk', 'refused', ?, ?, ?)").run(
      r.id,
      p.success ? p.data.kind : "none",
      p.success ? p.data.target.slice(0, 60) : "",
      p.success ? p.data.reason.slice(0, 120) : "",
      gameMinute(db),
      gameMinute(db),
      v.reason,
    );
    return { ...line, ...v.patch, npc_line: v.line, action_id: null, refused: v.reason, ...(v.extra ? { extra: v.extra } : {}) };
  }
  const more = { ...v.patch, ...(v.extra ? { extra: v.extra } : {}) };
  if (v.instant) return { ...line, ...more, npc_line: v.keep ? `${line.npc_line} ${v.line}`.trim() : v.line, action_id: null, refused: null };
  if (!v.action) return { ...line, ...more, action_id: null, refused: null };
  const row = startAction(db, v.action);
  return { ...line, ...more, npc_line: `${line.npc_line} ${v.line}`.trim(), end_conversation: line.end_conversation || v.action.kind !== "follow", action_id: row.id, refused: null };
}

// ------------------------------------------------------------------ the client's reports and the chains

export interface Report {
  phase: "arrived" | "lost" | "blocked" | "done";
  x?: number;
  z?: number;
  /** look_for: the person was seen. blocked: why. */
  found?: boolean;
  why?: string;
}

/** The client says what happened in the street. Runs the chain's next link. */
export async function reportAction(db: DB, id: number, rep: Report, runner?: Runner): Promise<ActionRow | null> {
  const a = actionRow(db, id);
  if (!a || a.status !== "active") return a;
  // a second report while the words are being written: the first one runs the chain
  if (a.phase === "talking") return a;
  const at = clampXZ(rep.x, rep.z);
  if (at) db.prepare("UPDATE npc_action SET x = ?, z = ? WHERE id = ?").run(at.x, at.z, id);
  const data = parseData(a);
  const r = resident(db, a.npc_id);
  if (!r) return endAction(db, id, "failed", "nobody by that name");
  const crime = crimeOpen(db);
  const police = r.trade === "police" || r.trade === "water_bailiff";
  const own = actionHooks.report[a.kind];
  if (own) return own(db, a, rep, runner);

  switch (a.kind) {
    case "follow":
      if (rep.phase === "lost") return endAction(db, id, "failed", "lost Jef", END_LINE.follow_lost);
      if (rep.phase === "blocked") return endAction(db, id, "failed", rep.why === "water" ? "water" : "blocked", rep.why === "water" ? END_LINE.follow_water : END_LINE.follow_blocked);
      return a;
    case "go_to":
      if (rep.phase === "arrived" || rep.phase === "done") {
        endAction(db, id, "done", "arrived", data.then ? "" : END_LINE.go_to_arrived);
        if (data.then) startNext(db, a, data.then);
        return actionRow(db, id);
      }
      if (rep.phase === "blocked") return endAction(db, id, "failed", "blocked", END_LINE.follow_blocked);
      return a;
    case "wait":
      return a;
    case "attend":
      // fixes 2026-09-24: at their place in the ring (or the row): "there", no longer "going"
      if (rep.phase === "arrived" && a.phase === "going") {
        db.prepare("UPDATE npc_action SET phase = 'there' WHERE id = ?").run(id);
        return actionRow(db, id);
      }
      // M7 funeral: at a hall's door on the way in (an "enter" stage): in; the hall's life seats them
      if (rep.phase === "arrived" && a.phase === "inside") {
        db.prepare("UPDATE npc_action SET phase = 'in' WHERE id = ?").run(id);
        return actionRow(db, id);
      }
      return a;
    case "look_for":
      if (rep.phase === "done" || rep.phase === "arrived") {
        if (rep.found) {
          endAction(db, id, "done", "found", END_LINE.look_for_found);
          const who = resident(db, a.target);
          if (who) {
            const at = posOf(db, who.id) ?? whereIs(db, who);
            startAction(db, {
              npc_id: r.id,
              kind: "talk_to",
              target: who.id,
              target_x: at.x,
              target_z: at.z,
              source: "engine",
              minutes: TALK_TO_MIN,
              reason: a.reason,
              data: { purpose: (data.purpose ?? (police ? "question" : "chat")) as Purpose, about: data.about },
            });
          }
          return actionRow(db, id);
        }
        return endAction(db, id, "done", "not found", END_LINE.look_for_time);
      }
      return a;
    case "talk_to": {
      if (rep.phase !== "arrived" && rep.phase !== "done") return rep.phase === "blocked" ? endAction(db, id, "failed", "blocked", END_LINE.talk_to_time) : a;
      const purpose = (data.purpose ?? "chat") as Purpose;
      // M6: a talk with its own purpose (a family passing on news, a scheme): its module writes and applies it
      const ownTalk = actionHooks.talkTo[purpose];
      if (ownTalk) {
        if (!claimTalk(db, id)) return actionRow(db, id);
        try {
          const outcome = await ownTalk(db, a, runner);
          endAction(db, id, "done", outcome || "talked", "");
        } catch (e) {
          endAction(db, id, "failed", String(e).slice(0, 80), END_LINE.talk_to_time);
        }
        return actionRow(db, id);
      }
      // the engine's verdict before the words: Jef's own purse first, else a robbery in the street Jef saw
      const street = streetCrimeOpen(db);
      const fixed =
        purpose !== "question"
          ? undefined
          : crime && (crime.thief === a.target || !street || street.thief !== a.target)
            ? { guilty: crime.thief === a.target, amount_c: crime.amount_c, log_id: crime.logId }
            : street
              ? { guilty: street.thief === a.target, amount_c: street.amount_c, victim: street.victim, crime_event: street.id }
              : { guilty: false, amount_c: 0 };
      if (!claimTalk(db, id)) return actionRow(db, id);
      try {
        const c = await runConvo(db, { a: r.id, b: a.target, purpose, about: data.about, fixed }, runner);
        endAction(db, id, "done", c.outcome === "none" ? "talked" : c.outcome, END_LINE.talk_to_done);
      } catch (e) {
        endAction(db, id, "failed", String(e).slice(0, 80), END_LINE.talk_to_time);
      }
      if (data.then) startNext(db, a, data.then);
      return actionRow(db, id);
    }
    case "fetch_police": {
      if (rep.phase !== "arrived" && rep.phase !== "done") return rep.phase === "blocked" ? endAction(db, id, "failed", "blocked", END_LINE.fetch_police_time) : a;
      const agent = resident(db, a.target);
      if (!agent) return endAction(db, id, "failed", "no agent", END_LINE.fetch_police_time);
      if (!claimTalk(db, id)) return actionRow(db, id);
      try {
        await runConvo(db, { a: r.id, b: agent.id, purpose: "report", about: data.about }, runner);
      } catch {
        // the engine's lines stood in
      }
      endAction(db, id, "done", "fetched", "");
      // M6 families: a complaint about Jef: the agent goes to find Jef for a word (director/families.ts)
      if (data.complaint) {
        startAction(db, { npc_id: agent.id, kind: "seek", target: "Jef", source: "engine", minutes: 60, reason: "a complaint about Jef", data: { reaction: "police_word", news: data.complaint } });
        return actionRow(db, id);
      }
      // the agent comes to where Jef was, then looks for the thief the log knows of, else waits for Jef there
      const jef = data.jef ?? jefAt() ?? whereIs(db, r);
      const spot = walkMap().nearestOpen(jef.x, jef.z, 6) ?? { x: jef.x, z: jef.z };
      const d = Math.hypot(spot.x - (posOf(db, agent.id)?.x ?? spot.x), spot.z - (posOf(db, agent.id)?.z ?? spot.z));
      const street = streetCrimeOpen(db);
      const thief = crime?.thief ?? (street?.witnessed ? street.thief : null);
      const then: ActionData["then"] = thief
        ? { kind: "look_for", target: thief, minutes: LOOK_FOR_MIN, data: { purpose: "question", about: "a robbery" } }
        : { kind: "wait", target: "Jef", minutes: WAIT_MAX_MIN };
      startAction(db, { npc_id: agent.id, kind: "go_to", target: "where Jef was robbed", target_x: spot.x, target_z: spot.z, source: "engine", minutes: walkMinutes(d, 5), reason: "fetched for Jef", data: { then } });
      return actionRow(db, id);
    }
    default:
      return a;
  }
}

/** Only one report gets to run the talk: the phase moves to "talking" once, conditionally. */
function claimTalk(db: DB, id: number): boolean {
  return db.prepare("UPDATE npc_action SET phase = 'talking' WHERE id = ? AND status = 'active' AND phase <> 'talking'").run(id).changes === 1;
}

function startNext(db: DB, prev: ActionRow, next: NonNullable<ActionData["then"]>): void {
  const tx = next.target_x ?? prev.x ?? prev.target_x ?? null;
  const tz = next.target_z ?? prev.z ?? prev.target_z ?? null;
  startAction(db, {
    npc_id: prev.npc_id,
    kind: next.kind,
    target: next.target ?? "",
    target_x: tx,
    target_z: tz,
    source: "engine",
    minutes: next.minutes ?? 30,
    max_m: next.kind === "look_for" ? LOOK_FOR_RADIUS_M : 0,
    reason: prev.reason,
    data: next.data ?? {},
  });
}

/** Every tick: what has run out of time ends with a line. */
export function actionsTick(db: DB): number {
  const now = gameMinute(db);
  let ended = 0;
  for (const a of activeActions(db)) {
    if (a.kind === "attend" || a.phase === "talking") continue;
    if (now < a.until) continue;
    // an errand still under way gets more time (only stuck, stopped or the hard cap ends it)
    if (ERRAND_KINDS.has(a.kind) && a.source !== "event" && now - a.started < ERRAND_HARD_MIN) {
      db.prepare("UPDATE npc_action SET until = ? WHERE id = ?").run(Math.min(a.started + ERRAND_HARD_MIN, now + ERRAND_MORE_MIN), a.id);
      continue;
    }
    const purpose = (parseData(a).purpose ?? "") as string;
    const hook = actionHooks.timeUp[a.kind] ?? actionHooks.timeUp[`talk_to:${purpose}`];
    if (hook && hook(db, a)) {
      ended++;
      continue;
    }
    const key = `${a.kind}_time`;
    endAction(db, a.id, a.kind === "wait" || a.kind === "go_to" ? "done" : "failed", "time", END_LINE[key] ?? "");
    ended++;
  }
  return ended;
}

/** For the client: the active actions with names, and the event's spot for attend. */
export function listActions(db: DB) {
  return activeActions(db).map((a) => {
    const r = resident(db, a.npc_id);
    const t = a.kind === "talk_to" || a.kind === "look_for" || a.kind === "fetch_police" ? resident(db, a.target) : null;
    const data = parseData(a);
    return {
      id: a.id,
      npc: a.npc_id,
      name: r?.name ?? a.npc_id,
      kind: a.kind,
      target: a.target,
      target_name: t?.name ?? null,
      target_x: a.target_x,
      target_z: a.target_z,
      source: a.source,
      event_id: a.event_id,
      phase: a.phase,
      until: a.until,
      max_m: a.max_m,
      order: data.order ?? 0,
      role: data.role ?? null,
      lead: data.lead ?? null,
      n: data.n ?? 0,
      reaction: data.reaction ?? null,
      minutes_left: Math.max(0, a.until - gameMinute(db)),
    };
  });
}

/** A new game: nothing running. */
export function clearActions(db: DB): void {
  db.prepare("DELETE FROM npc_action").run();
  resetSync();
}

// ------------------------------------------------------------------ the talk hooks (talk.ts calls these)

function taskLine(db: DB, r: Resident): string {
  const a = actionOf(db, r.id);
  if (!a) return "nothing for Jef";
  const left = Math.max(0, a.until - gameMinute(db));
  const t = a.target && resident(db, a.target)?.name;
  switch (a.kind) {
    case "follow":
      return `following Jef (about ${left} minutes left)`;
    case "go_to":
      return `on your way to ${a.target} for Jef`;
    case "wait":
      return `waiting here for Jef (about ${left} minutes left)`;
    case "talk_to":
      return `going to speak with ${t ?? a.target} for Jef`;
    case "look_for":
      return t ? `looking for ${t} for Jef` : `looking about ${parseData(a).place ?? "the place"} for Jef`;
    case "fetch_police":
      return "fetching the police for Jef";
    case "attend":
      return `at ${a.target}`;
    default:
      return "busy";
  }
}

/** What a lead is doing, for the talk prompt (fixes 2026-09-24: the person speaks from the event, not from the shop). */
const LEAD_DOING: Record<string, string> = {
  speaker: "you are the speaker: you stand before the crowd and hold forth, a paper in your hand; you were not at your trade when Jef came up",
  auctioneer: "you are the auctioneer, with your handbell and your board, calling the lots",
  bride: "you are the bride, in your dark best dress with the white veil; it is your wedding day",
  groom: "you are the groom, in your best coat; it is your wedding day",
  priest: "you are the priest, here for the service",
  widow: "you are the widow and walk behind the coffin; you are in mourning",
  bearers: "you carry the coffin with three other men",
  hawker: "you hawk your wares from a tray to the crowd",
  showman: "you are the showman, your monkey on your shoulder",
  drunkard: "you are drunk, a bottle in your hand, and loud",
  pickpocket: "you keep your eyes on the purses and say nothing of it",
  victim: "you have just had your purse taken and are upset",
  quarreller: "you are in a quarrel and hot about it",
  organ_grinder: "you play the barrel organ",
  fiddler: "you play the fiddle",
  accordionist: "you play the accordion",
  agent: "you are the police agent on the spot and keep order",
  ballad_singer: "you sing the day's ballad to the crowd and sell the printed sheets, a centime each",
  natie_foreman: "you are the natie foreman at the gate, hiring day men from your book",
  fireman: "you are a fireman of the pompiers at the fire",
};

/**
 * Fixes 2026-09-24: where they really are when an event took them from their day, for the prompt's
 * "You are ..." line. The talk prompt used the daily schedule alone, so a shopkeeper cast as the
 * preacher on the Steenplein spoke of Jef "blocking my door". null: not in an event, the schedule holds.
 */
export function eventDoing(db: DB, r: Resident): string | null {
  const a = actionOf(db, r.id);
  if (!a || a.kind !== "attend" || !a.event_id) return null;
  const ev = db.prepare("SELECT id, title, place, status, leads_json FROM town_event WHERE id = ?").get(a.event_id) as { id: number; title: string; place: string; status: string; leads_json: string } | undefined;
  if (!ev || ev.status !== "running") return null;
  const data = JSON.parse(a.data_json || "{}") as { about?: string; lead?: string };
  const places = town(db).town.places as Record<string, { label: string } | undefined>;
  const about = data.about ?? ev.place;
  const where = places[about]?.label ?? (about && !/^[a-z0-9_]+$/.test(about) ? about : (places[ev.place]?.label ?? "the square"));
  const lead = data.lead ?? (JSON.parse(ev.leads_json || "[]") as Array<{ id: string; role: string }>).find((l) => l.id === r.id)?.role;
  const part = (lead && LEAD_DOING[lead]) ?? "you stand in the crowd, watching, among your neighbours";
  const title = ev.title.replace(/^(a|an|the)\s+/i, "");
  if (a.phase === "going") return `on your way to ${where}, where the town's ${title} is on (${part}). You are not at your shop, stall or work`;
  // M7 funeral: gone into the cathedral with the event (an "enter" stage)
  if (a.phase === "in" || a.phase === "inside") return `inside the cathedral for the town's ${title}: ${part}. You are NOT at your shop, your stall or your work. Speak low: it is a church, and the service is on`;
  return `on ${where}, out in the open, in the middle of the town's ${title}: ${part}. You are NOT at your shop, your stall or your work; you left it for this. Speak from where you stand: the square, the crowd, the weather`;
}

export function talkContext(db: DB, r: Resident): string {
  const jef = jefAt();
  const near: string[] = [];
  if (jef) {
    for (const [id, k] of sync.people) {
      if (id === r.id || Date.now() - k.at > KNOWN_TTL_MS) continue;
      const o = resident(db, id);
      if (!o || Math.hypot(k.x - jef.x, k.z - jef.z) > 25) continue;
      near.push(`${o.name} (${o.trade.replace("_", " ")})`);
      if (near.length >= 6) break;
    }
  }
  const crime = crimeOpen(db);
  const street = streetCrimeOpen(db);
  const victim = street ? resident(db, street.victim) : null;
  const facts = db.prepare("SELECT text FROM world_fact WHERE tags LIKE '%notice%' OR tags LIKE '%rumour%' ORDER BY weight DESC, id DESC LIMIT 3").all() as Array<{ text: string }>;
  const lately = eventSlice(db, { about: r.id, limit: 5, maxChars: 500 });
  return `YOUR TASK NOW: ${taskLine(db, r)}.
PEOPLE NEAR: ${near.length ? near.join(", ") : "nobody you know"}.${crime ? `\nTHE TALK OF THE QUAYS: a man was robbed of ${crime.amount_c} centimes in the dark lately; nobody knows by whom.` : ""}${
    street && victim ? `\nTHE TALK OF THE STREET: a pickpocket took ${victim.name}'s purse at ${street.place} lately and got away.${street.witnessed && (r.trade === "police" || r.trade === "water_bailiff") ? " Jef was there and saw it; if he names the thief, you may go and question them (talk_to)." : ""}` : ""
  }${
    facts.length ? `\nTALK OF THE TOWN: ${facts.map((f) => f.text).join(" ")}` : ""
  }${lately.length ? `\nLATELY, THINGS YOU WERE IN:\n${lately.join("\n")}` : ""}`;
}

/** Wire the hooks into talk.ts (called once by routes.ts; tests call it too). */
export function installTalkHooks(): void {
  talkHooks.system = RULES_FOR_MODEL;
  talkHooks.context = talkContext;
  talkHooks.doing = eventDoing;
  talkHooks.proposal = (db, r, line) => applyProposal(db, r, line);
}

export type { ActionKind };
