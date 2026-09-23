import type { DB } from "../db.ts";
import { DAY_NAMES } from "../day.ts";
import { EVENTLOG_SCHEMA } from "./schema.ts";

// The event log for AI context (M4). Everything that happens on the server
// lands in world_event as one short line of engine words (never a player's raw
// text), with who was in it in world_event_who. Two SQLite triggers mirror
// what the older helpers already write (log rows, rumours in npc_memory), so
// no helper file had to change. Actions, events and conversations write here
// directly (writeEvent). eventSlice() gives the director and the talk prompts
// the newest and the weightiest lines, trimmed to a budget.
//
// The migration is additive only (CREATE IF NOT EXISTS): old saves keep working.

export const EVENT_KINDS = ["action", "event", "talk", "deed", "rumour", "job", "police", "theft", "director", "log"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];


export function eventLogTables(db: DB): void {
  db.exec(EVENTLOG_SCHEMA);
}

export interface WorldEvent {
  id: number;
  day: number;
  hour: number;
  minute: number;
  kind: EventKind;
  verb: string;
  actor: string | null;
  target: string | null;
  place: string | null;
  x: number | null;
  z: number | null;
  text: string;
  outcome: string | null;
  ref_type: string | null;
  ref_id: number | null;
  weight: number;
  data_json: string;
}

export interface NewEvent {
  kind: EventKind;
  verb: string;
  text: string;
  actor?: string | null;
  target?: string | null;
  place?: string | null;
  x?: number | null;
  z?: number | null;
  outcome?: string | null;
  ref_type?: string | null;
  ref_id?: number | null;
  weight?: number;
  data?: unknown;
  /** People in it (residents or npcs), for world_event_who. */
  who?: string[];
}

/** Actions, events and conversations write here directly. Returns the row id. */
export function writeEvent(db: DB, e: NewEvent): number {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  const r = db
    .prepare(
      `INSERT INTO world_event (day, hour, minute, kind, verb, actor, target, place, x, z, text, outcome, ref_type, ref_id, weight, data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.day,
      p.hour,
      p.minute,
      e.kind,
      e.verb,
      e.actor ?? null,
      e.target ?? null,
      e.place ?? null,
      e.x ?? null,
      e.z ?? null,
      e.text.slice(0, 300),
      e.outcome ?? null,
      e.ref_type ?? null,
      e.ref_id ?? null,
      Math.max(1, Math.min(10, Math.round(e.weight ?? 3))),
      JSON.stringify(e.data ?? {}),
    );
  const id = Number(r.lastInsertRowid);
  const who = new Set([...(e.who ?? []), e.actor ?? "", e.target ?? ""].filter(Boolean));
  const ins = db.prepare("INSERT INTO world_event_who (event_id, who) SELECT ?, ? WHERE ? IN (SELECT id FROM npc)");
  for (const w of who) ins.run(id, w, w);
  return id;
}

export function eventsSince(db: DB, sinceId: number, limit = 50): WorldEvent[] {
  return db.prepare("SELECT * FROM world_event WHERE id > ? ORDER BY id LIMIT ?").all(sinceId, limit) as WorldEvent[];
}

/** One line of an event for a prompt. */
export function eventLine(e: WorldEvent): string {
  const wd = DAY_NAMES[((e.day - 1) % 7 + 7) % 7];
  return `- ${wd} ${e.hour}:${String(e.minute).padStart(2, "0")} [${e.kind}] ${e.text}${e.outcome ? ` (${e.outcome})` : ""}`;
}

/**
 * The newest and the weightiest events, one line each, newest last, trimmed to
 * maxChars. `about`: only events this person was in.
 */
export function eventSlice(db: DB, opts: { about?: string; limit?: number; maxChars?: number; sinceDay?: number } = {}): string[] {
  const limit = opts.limit ?? 20;
  const maxChars = opts.maxChars ?? 1500;
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  const sinceDay = opts.sinceDay ?? day - 2;
  const whoJoin = opts.about ? "JOIN world_event_who w ON w.event_id = e.id AND w.who = ?" : "";
  const args = opts.about ? [opts.about] : [];
  const newest = db
    .prepare(`SELECT e.* FROM world_event e ${whoJoin} WHERE e.day >= ? ORDER BY e.id DESC LIMIT ?`)
    .all(...args, sinceDay, limit) as WorldEvent[];
  const heavy = db
    .prepare(`SELECT e.* FROM world_event e ${whoJoin} WHERE e.day >= ? AND e.weight >= 6 ORDER BY e.weight DESC, e.id DESC LIMIT ?`)
    .all(...args, sinceDay, Math.ceil(limit / 2)) as WorldEvent[];
  const byId = new Map<number, WorldEvent>();
  for (const e of [...newest, ...heavy]) byId.set(e.id, e);
  const rows = [...byId.values()].sort((a, b) => a.id - b.id);
  // within the budget: drop the oldest light lines first, the heavy ones last
  const kept = rows.map((e) => ({ e, line: eventLine(e) }));
  const size = () => kept.reduce((a, k) => a + k.line.length + 1, 0);
  while (kept.length && (kept.length > limit || size() > maxChars)) {
    const i = kept.findIndex((k) => k.e.weight < 6);
    kept.splice(i >= 0 ? i : 0, 1);
  }
  return kept.map((k) => k.line);
}

/** Test and dev helper: how many events of a kind. */
export function countEvents(db: DB, kind?: EventKind): number {
  return kind
    ? (db.prepare("SELECT COUNT(*) n FROM world_event WHERE kind = ?").get(kind) as { n: number }).n
    : (db.prepare("SELECT COUNT(*) n FROM world_event").get() as { n: number }).n;
}
