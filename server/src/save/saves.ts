import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { z } from "zod";
import { DB_FILE } from "../config.ts";
import { bumpGeneration, openDb, type DB } from "../db.ts";
import { clock, resetTickLimit, TICK_MINUTES } from "../day.ts";
import { player } from "../game.ts";
import { dropTownCache } from "../town/store.ts";
import { dropTransport } from "../town/possessions.ts";
import { dropStealables } from "../town/deeds.ts";
import { dropGameWords } from "../ballads/guard.ts";
import { resetTalks } from "../hooks/dialogue.ts";
import { resetSync } from "../director/actions.ts";
import { resetConvos } from "../director/convo.ts";
import { resetThieves } from "../town/thieves.ts";
import { resetGangRoll } from "../night/gangs.ts";
import { resetRowClock } from "../rowing.ts";
import { CLIENT_STATE_SQL, SAVE_META_SQL } from "./schema.ts";
import { callsInFlight, withGate } from "./gate.ts";

// M7 save and pause: save games (docs/milestones/M7-save-pause.md).
//
// A save is ONE file: the whole database, copied with better-sqlite3's online backup while the
// gate is shut (save/gate.ts: no model call starts, the ones in flight finish and are applied
// first), with the browser's part in its client_state row and a save_meta table for the list.
// Five slots of the player's own and two autosaves that take turns. The saves of a database live
// beside it, in data/saves/<its name>/ (Steve's game: data/saves/game/; a test stack: its own).
//
// Loading copies a save into the live database in place (the same connection every route holds):
// the save is first opened on a copy of its own (db.ts openDb brings an older save up to this build),
// then every table is emptied and filled from it in one transaction, and the server's caches of the
// town and the talk are dropped. The browser then reloads and puts Jef back from client_state.

export const PLAYER_ID = 1;
export const SLOTS = ["slot1", "slot2", "slot3", "slot4", "slot5"] as const;
export const AUTOS = ["auto1", "auto2"] as const;
export type SlotId = (typeof SLOTS)[number] | (typeof AUTOS)[number];
export const isSlot = (s: unknown): s is SlotId => typeof s === "string" && ((SLOTS as readonly string[]).includes(s) || (AUTOS as readonly string[]).includes(s));

/** Where the saves of a database file live. */
export function saveDirFor(dbFile: string): string {
  if (process.env.SCHELDEMIST_SAVES) return path.resolve(process.env.SCHELDEMIST_SAVES);
  const base = dbFile === ":memory:" ? "memory" : path.basename(dbFile).replace(/\.sqlite$/i, "");
  const root = dbFile === ":memory:" ? path.join(process.cwd(), "data") : path.dirname(dbFile);
  return path.join(root, "saves", base);
}
let dir = saveDirFor(DB_FILE);
/** Tests: saves in a folder of their own. */
export function setSaveDir(d: string): void {
  dir = d;
}
export function saveDir(): string {
  return dir;
}
const fileOf = (slot: SlotId) => path.join(dir, `${slot}.sqlite`);

// ------------------------------------------------------------------ the browser's part

const num = (lo: number, hi: number) => z.number().finite().transform((v) => Math.max(lo, Math.min(hi, v)));
/**
 * What the browser sends with a save. Only its shape is checked and its numbers kept in bounds: none
 * of it is money, a need or a job's pay. Parts the server does not know pass through as they are
 * (each game part keeps its own), within 64 KB.
 */
export const ClientStateSchema = z
  .object({
    v: z.literal(1),
    clock: z.object({ day: z.number().int().min(1).max(7), hour: z.number().int().min(0).max(23), minute: z.number().int().min(0).max(59) }).optional(),
    place: z.string().max(80).optional(),
    pose: z
      .object({
        x: num(-2000, 2000),
        z: num(-2000, 2000),
        y: num(-30, 80),
        yaw: num(-1e4, 1e4),
        pitch: num(-1.6, 1.6),
        swimming: z.boolean().optional(),
        crouching: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type ClientState = z.infer<typeof ClientStateSchema>;
const MAX_STATE = 64 * 1024;

/** A place name for the list: plain words only. */
const cleanPlace = (s: unknown) => (typeof s === "string" ? s.replace(/[<>&"\u0000-\u001f]/g, "").trim().slice(0, 60) : "");
const cleanLabel = (s: unknown) => (typeof s === "string" ? s.replace(/[<>&"\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 30) : "");

export function writeClientState(db: DB, state: unknown): ClientState | null {
  const parsed = ClientStateSchema.safeParse(state);
  if (!parsed.success) return null;
  const json = JSON.stringify(parsed.data);
  if (json.length > MAX_STATE) return null;
  db.exec(CLIENT_STATE_SQL);
  db.prepare("INSERT INTO client_state (player_id, state_json, saved_at) VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET state_json = excluded.state_json, saved_at = excluded.saved_at").run(
    PLAYER_ID,
    json,
    new Date().toISOString(),
  );
  return parsed.data;
}

export function readClientState(db: DB): ClientState | null {
  try {
    const row = db.prepare("SELECT state_json FROM client_state WHERE player_id = ?").get(PLAYER_ID) as { state_json: string } | undefined;
    if (!row) return null;
    const p = ClientStateSchema.safeParse(JSON.parse(row.state_json));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/**
 * The clock to the minute: the browser shows the server's time run on between ticks (at most one
 * tick ahead, never past the hour). A save takes the minute on screen, so a load shows the same.
 */
function clockToScreen(db: DB, shown: ClientState["clock"]): void {
  if (!shown) return;
  const c = clock(db);
  if (shown.day !== c.day || shown.hour !== c.hour) return;
  if (shown.minute <= c.minute || shown.minute - c.minute >= TICK_MINUTES) return;
  db.prepare("UPDATE player SET minute = ? WHERE id = 1").run(shown.minute);
}

// ------------------------------------------------------------------ the list

export interface SaveInfo {
  slot: SlotId;
  kind: "slot" | "auto";
  label: string;
  saved_at: string;
  day: number;
  weekday: string;
  hour: number;
  minute: number;
  place: string;
  money_c: number;
  /** The town's seed: saves of one week share it. */
  week: number | null;
  version: number;
}

function readMeta(file: string): SaveInfo | null {
  let d: Database.Database | null = null;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    const rows = d.prepare("SELECT key, value_json FROM save_meta").all() as Array<{ key: string; value_json: string }>;
    const m = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value_json) as unknown]));
    return isSlot(m.slot) ? (m as unknown as SaveInfo) : null;
  } catch {
    return null;
  } finally {
    d?.close();
  }
}

/** Every save there is, the newest first. */
export function listSaves(): SaveInfo[] {
  const out: SaveInfo[] = [];
  for (const slot of [...SLOTS, ...AUTOS]) {
    const f = fileOf(slot);
    if (!fs.existsSync(f)) continue;
    const m = readMeta(f);
    if (m) out.push({ ...m, slot });
  }
  return out.sort((a, b) => b.saved_at.localeCompare(a.saved_at));
}

/** The autosave to write: the newest if it holds this very minute (no second copy of one moment), else the older. */
export function autoSlot(db: DB): SlotId {
  const c = clock(db);
  const autos = listSaves().filter((s) => s.kind === "auto");
  const newest = autos[0];
  if (newest && newest.day === c.day && newest.hour === c.hour && newest.minute === c.minute) return newest.slot;
  const free = AUTOS.find((a) => !autos.some((s) => s.slot === a));
  return free ?? autos[autos.length - 1].slot;
}

// ------------------------------------------------------------------ saving

export interface SaveOpts {
  slot: SlotId | "auto";
  label?: string;
  client?: unknown;
  /**
   * An autosave while Jef plays: it never holds the game up. It waits (at most `quietMs`) for a
   * moment with no model call in flight, then saves at once; no such moment: deferred, try later.
   */
  quiet?: boolean;
  quietMs?: number;
}
export type SaveResult = { ok: true; info: SaveInfo; drained: boolean; ms: number } | { ok: false; deferred?: boolean; error: string };

export async function saveGame(db: DB, o: SaveOpts): Promise<SaveResult> {
  const t0 = Date.now();
  if (o.quiet) {
    const end = Date.now() + (o.quietMs ?? 8000);
    while (callsInFlight() > 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    if (callsInFlight() > 0) return { ok: false, deferred: true, error: "the town is busy talking: saved later" };
  }
  return withGate("saving", async (drained) => {
    const slot = o.slot === "auto" ? autoSlot(db) : o.slot;
    const kind = slot.startsWith("auto") ? "auto" : "slot";
    fs.mkdirSync(dir, { recursive: true });
    const client = o.client !== undefined ? writeClientState(db, o.client) : readClientState(db);
    if (client) clockToScreen(db, client.clock);
    const c = clock(db);
    const p = player(db);
    const old = kind === "slot" && fs.existsSync(fileOf(slot)) ? readMeta(fileOf(slot)) : null;
    const seed = (() => {
      try {
        const r = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
        return r ? (Number((JSON.parse(r.value_json) as { seed?: unknown }).seed) || null) : null;
      } catch {
        return null;
      }
    })();
    const n = Number(slot.replace(/\D/g, ""));
    const info: SaveInfo = {
      slot,
      kind,
      label: kind === "auto" ? "Autosave" : cleanLabel(o.label) || old?.label || `Slot ${n}`,
      saved_at: new Date().toISOString(),
      day: c.day,
      weekday: c.weekday,
      hour: c.hour,
      minute: c.minute,
      place: cleanPlace(client?.place) || "Antwerp",
      money_c: p.money_c,
      week: seed,
      version: 1,
    };
    const tmp = path.join(dir, `${slot}.tmp-${process.pid}.sqlite`);
    for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
    try {
      await db.backup(tmp);
      const s = new Database(tmp);
      try {
        s.exec(SAVE_META_SQL);
        const put = s.prepare("INSERT INTO save_meta (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json");
        s.transaction(() => {
          for (const [k, v] of Object.entries(info)) put.run(k, JSON.stringify(v));
        })();
        s.pragma("journal_mode = DELETE");
      } finally {
        s.close();
      }
      fs.renameSync(tmp, fileOf(slot));
    } catch (e) {
      for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
      return { ok: false as const, error: `could not write the save: ${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true as const, info, drained, ms: Date.now() - t0 };
  });
}

// ------------------------------------------------------------------ loading

/** Copy every table of `file` into the live database in place (one transaction; triggers kept out of it). */
export function restoreInto(db: DB, file: string): void {
  const tables = (db.prepare("SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>).map((r) => r.name);
  const triggers = db.prepare("SELECT name, sql FROM main.sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all() as Array<{ name: string; sql: string }>;
  const hasSeq = !!db.prepare("SELECT 1 FROM main.sqlite_master WHERE name = 'sqlite_sequence'").get();
  db.pragma("foreign_keys = OFF");
  db.prepare("ATTACH DATABASE ? AS src").run(file);
  try {
    const srcTables = new Set((db.prepare("SELECT name FROM src.sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name));
    const cols = (schema: string, t: string) => (db.prepare(`PRAGMA ${schema}.table_info("${t}")`).all() as Array<{ name: string }>).map((c) => c.name);
    db.transaction(() => {
      for (const t of triggers) db.exec(`DROP TRIGGER IF EXISTS main."${t.name}"`);
      for (const t of tables) {
        db.exec(`DELETE FROM main."${t}"`);
        if (!srcTables.has(t)) continue;
        const have = new Set(cols("src", t));
        const both = cols("main", t).filter((c) => have.has(c));
        if (!both.length) continue;
        const list = both.map((c) => `"${c}"`).join(", ");
        db.exec(`INSERT INTO main."${t}" (${list}) SELECT ${list} FROM src."${t}"`);
      }
      if (hasSeq) {
        db.exec("DELETE FROM main.sqlite_sequence");
        if (srcTables.has("sqlite_sequence")) db.exec("INSERT INTO main.sqlite_sequence (name, seq) SELECT name, seq FROM src.sqlite_sequence");
      }
      for (const t of triggers) db.exec(t.sql);
    })();
  } finally {
    db.exec("DETACH DATABASE src");
    db.pragma("foreign_keys = ON");
  }
}

/** The server's own memory of the town and the talk, dropped after a load (as a new week does). */
export const AFTER_LOAD: Array<(db: DB) => void> = [];

function forgetCaches(db: DB): void {
  bumpGeneration();
  dropTownCache(db);
  dropTransport(db);
  dropStealables(db);
  dropGameWords(db);
  resetTalks();
  resetSync();
  resetConvos();
  resetThieves();
  resetGangRoll();
  resetRowClock();
  resetTickLimit();
  for (const f of AFTER_LOAD) f(db);
}

export type LoadResult = { ok: true; info: SaveInfo; client: ClientState | null; ms: number } | { ok: false; error: string };

export async function loadGame(db: DB, slot: SlotId): Promise<LoadResult> {
  const t0 = Date.now();
  const file = fileOf(slot);
  const info = fs.existsSync(file) ? readMeta(file) : null;
  if (!info) return { ok: false, error: "no such save" };
  return withGate("loading", async () => {
    // the save on a copy of its own: an older save is brought up to this build there, not in the live file
    const tmp = path.join(dir, `load-${process.pid}-${Date.now()}.sqlite`);
    try {
      fs.copyFileSync(file, tmp);
      const s = openDb(tmp);
      s.pragma("journal_mode = DELETE");
      s.close();
      db.exec(CLIENT_STATE_SQL);
      restoreInto(db, tmp);
    } catch (e) {
      return { ok: false as const, error: `could not load the save: ${e instanceof Error ? e.message : String(e)}` };
    } finally {
      for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, { force: true });
    }
    forgetCaches(db);
    return { ok: true as const, info: { ...info, slot }, client: readClientState(db), ms: Date.now() - t0 };
  });
}
