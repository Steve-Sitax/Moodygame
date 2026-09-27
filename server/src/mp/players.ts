import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { DB } from "../db.ts";

// M8a multiplayer (docs/multiplayer-plan.md 2.2): who joined. The host is player 1 (the one who plays on the
// host PC, no token needed there). A guest types the join code from the host's screen once; the server
// answers with a player token (128 random bits). The browser keeps it and sends it with every request
// (header X-Scheldemist-Player) and on the movement socket; the server keeps only its SHA-256.
// Wrong codes: 5 tries a minute per address.

export const MP_PLAYER_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS mp_player (
  id INTEGER PRIMARY KEY CHECK (id >= 2),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  admin INTEGER NOT NULL DEFAULT 0,
  pose_json TEXT,
  created_at TEXT NOT NULL,
  seen_at TEXT
);
`;

export const HOST_ID = 1;
/** Six players at most (the host and five guests). */
export const MAX_PLAYERS = 6;

export interface MpPlayer {
  id: number;
  name: string;
  admin: boolean;
}

const hashOf = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/** Letters and digits that are not easily mixed up (no I, L, O, 0, 1). */
const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";

/** A join code like KADE-47: four letters, two digits. */
export function newJoinCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += LETTERS[randomInt(LETTERS.length)];
  s += "-";
  for (let i = 0; i < 2; i++) s += DIGITS[randomInt(DIGITS.length)];
  return s;
}

/** A typed code as the server compares it: upper case, no spaces or dashes. */
export const codeKey = (code: unknown): string => (typeof code === "string" ? code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) : "");

export function sameCode(a: string, b: unknown): boolean {
  const x = Buffer.from(codeKey(a));
  const y = Buffer.from(codeKey(b));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** A name as a guest may type it: letters, spaces, hyphens and apostrophes, 1 to 20 of them. Data, never an order. */
export function cleanGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{M} '\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20);
  return s.length >= 1 ? s : null;
}

// ------------------------------------------------------------------ tries per address

const tries = new Map<string, number[]>();
/** May this address try a code now? 5 tries a minute. */
export function mayTry(addr: string, now = Date.now()): boolean {
  const list = (tries.get(addr) ?? []).filter((t) => now - t < 60_000);
  tries.set(addr, list);
  return list.length < 5;
}
export function countTry(addr: string, now = Date.now()): void {
  const list = tries.get(addr) ?? [];
  list.push(now);
  tries.set(addr, list);
}
/** Test helper. */
export function forgetTries(): void {
  tries.clear();
}

// ------------------------------------------------------------------ the table

export function listPlayers(db: DB): MpPlayer[] {
  return (db.prepare("SELECT id, name, admin FROM mp_player ORDER BY id").all() as Array<{ id: number; name: string; admin: number }>).map((r) => ({ id: r.id, name: r.name, admin: r.admin === 1 }));
}

export function playerById(db: DB, id: number): MpPlayer | null {
  const r = db.prepare("SELECT id, name, admin FROM mp_player WHERE id = ?").get(id) as { id: number; name: string; admin: number } | undefined;
  return r ? { id: r.id, name: r.name, admin: r.admin === 1 } : null;
}

/** A new guest: a new id and a new token (only the hash is kept). Null when the house is full. */
export function addGuest(db: DB, name: string): { id: number; token: string } | null {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM mp_player").get() as { n: number }).n;
  if (n >= 64) return null; // stale rows are removed by the host; 64 keeps a runaway loop small
  // M8d: a number is never given twice: a removed guest's man, his look and his things stay under his own
  // number (the townspeople remember him), so a new guest gets a number no player row or profile has
  const top = (sql: string) => ((db.prepare(sql).get() as { m: number | null } | undefined)?.m ?? HOST_ID);
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const id = Math.max(top("SELECT MAX(id) AS m FROM mp_player"), has("player") ? top("SELECT MAX(id) AS m FROM player") : HOST_ID, has("player_profile") ? top("SELECT MAX(player_id) AS m FROM player_profile") : HOST_ID) + 1;
  const token = randomBytes(16).toString("hex");
  db.prepare("INSERT INTO mp_player (id, name, token_hash, admin, created_at) VALUES (?, ?, ?, 0, ?)").run(id, name, hashOf(token), new Date().toISOString());
  return { id, token };
}

/** The player a token belongs to, or null. */
export function playerOfToken(db: DB, token: unknown): MpPlayer | null {
  if (typeof token !== "string" || !/^[0-9a-f]{32}$/.test(token)) return null;
  const r = db.prepare("SELECT id, name, admin FROM mp_player WHERE token_hash = ?").get(hashOf(token)) as { id: number; name: string; admin: number } | undefined;
  return r ? { id: r.id, name: r.name, admin: r.admin === 1 } : null;
}

export function renameGuest(db: DB, id: number, name: string): void {
  db.prepare("UPDATE mp_player SET name = ? WHERE id = ?").run(name, id);
}

export function setAdmin(db: DB, id: number, on: boolean): void {
  db.prepare("UPDATE mp_player SET admin = ? WHERE id = ?").run(on ? 1 : 0, id);
}

/**
 * M8e review 4 (docs/milestones/M8e.md): a new token for the same player; the old one stops working at once (only
 * one token a player). Used when he moves to the secure address: the old token went over plain http, where anyone
 * on the line could have read it; kept valid, a copy of it would go on playing his man after he moved.
 */
export function rotateToken(db: DB, id: number): string | null {
  const token = randomBytes(16).toString("hex");
  return db.prepare("UPDATE mp_player SET token_hash = ? WHERE id = ?").run(hashOf(token), id).changes > 0 ? token : null;
}

// ------------------------------------------------------------------ moving to another address (M8e review 4)

/** A move code lives this long (the new page redeems it at once). */
export const MOVE_MS = 60_000;
/** code hash -> the player and when the code ends. In memory only: a restart ends every code. */
const moves = new Map<string, { id: number; until: number }>();

/**
 * A one-time code that moves a guest's man to another address of the host (http to https, another name): 128
 * random bits, 60 s, single use, kept only as its SHA-256. A new code for the same player ends his older one.
 */
export function newMoveCode(id: number, now = Date.now()): string {
  for (const [k, v] of moves) if (v.id === id || v.until <= now) moves.delete(k);
  const code = randomBytes(16).toString("hex");
  moves.set(hashOf(code), { id, until: now + MOVE_MS });
  return code;
}

/** The player a move code is for, once (a used, unknown or expired code: null). */
export function takeMoveCode(code: unknown, now = Date.now()): number | null {
  if (typeof code !== "string" || !/^[0-9a-f]{32}$/.test(code)) return null;
  const k = hashOf(code);
  const m = moves.get(k);
  moves.delete(k);
  return m && m.until > now ? m.id : null;
}

/** Test helper. */
export function forgetMoveCodes(): void {
  moves.clear();
}

/** The host removes a player: his token stops working. */
export function removeGuest(db: DB, id: number): boolean {
  for (const [k, v] of moves) if (v.id === id) moves.delete(k); // (and a move code he had)
  return db.prepare("DELETE FROM mp_player WHERE id = ?").run(id).changes > 0;
}

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Where a guest stood last (he comes back there). */
export function savePose(db: DB, id: number, p: Pose): void {
  if (id === HOST_ID) return;
  db.prepare("UPDATE mp_player SET pose_json = ?, seen_at = ? WHERE id = ?").run(JSON.stringify({ x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yaw: +p.yaw.toFixed(3) }), new Date().toISOString(), id);
}

export function poseOf(db: DB, id: number): Pose | null {
  const r = db.prepare("SELECT pose_json FROM mp_player WHERE id = ?").get(id) as { pose_json: string | null } | undefined;
  if (!r?.pose_json) return null;
  try {
    const p = JSON.parse(r.pose_json) as Pose;
    return [p.x, p.y, p.z, p.yaw].every((v) => typeof v === "number" && Number.isFinite(v)) ? p : null;
  } catch {
    return null;
  }
}
