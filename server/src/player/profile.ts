import { z } from "zod";
import type { DB } from "../db.ts";
import {
  JEF,
  AGE_MAX,
  AGE_MIN,
  NAME_MAX,
  aboutPlayer,
  addressed,
  appearanceCode,
  clampProfile,
  lookLine,
  wordsFor,
  type Profile,
  type Words,
} from "../../../shared/character.ts";

// M7 character: the player's profile, kept by player id (today only player 1; multiplayer later: one
// row a player). What a character is (the options, the palette, the clamp, the appearance code) lives
// in shared/character.ts; this is the server's side: the table, the schema at the door, and the one
// place every prompt and every hand-written line asks for the name, the sex, the words and the look.
//
// The engine's own text keeps calling the player "Jef" (the rumour checks, the ballad guard, the
// memories all look for that word). The name is put in at the edges: player/prompt.ts turns "Jef"
// into the profile's name on the way to a model and back to "Jef" on the way in, and the server's
// answers to the browser (index.ts) show the name. A missing profile is today's Jef: nothing changes.

export const PROFILE_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS player_profile (
  player_id INTEGER PRIMARY KEY,
  profile_json TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** The one player today (multiplayer later: every call takes the player's id). */
export const PLAYER_ONE = 1;

/**
 * The door: a body must be an object whose fields have the right types and bounds; anything else in a
 * field is caught and put back to the sex's default by the clamp (shared clampProfile). Text is data:
 * a name is letters, spaces, hyphens and apostrophes, capped, never an order (shared cleanName).
 */
const Slot = z.object({ kind: z.string().max(24).optional().catch(undefined), colour: z.string().max(24).optional().catch(undefined) }).partial().catch({});
export const ProfileInput = z
  .object({
    first: z.string().max(200).optional().catch(undefined),
    last: z.string().max(200).optional().catch(undefined),
    sex: z.enum(["man", "woman"]).optional().catch(undefined),
    age: z.coerce.number().min(0).max(200).optional().catch(undefined),
    build: z.string().max(24).optional().catch(undefined),
    skin: z.string().max(24).optional().catch(undefined),
    hair: z.object({ colour: z.string().max(24).optional().catch(undefined), style: z.string().max(24).optional().catch(undefined) }).partial().optional().catch(undefined),
    face: z.string().max(24).optional().catch(undefined),
    clothes: z
      .object({ head: Slot, coat: Slot, shirt: Slot, vest: Slot, lower: Slot, apron: Slot, feet: Slot })
      .partial()
      .optional()
      .catch(undefined),
    best: z.boolean().optional().catch(undefined),
  })
  .strip();

/** Checked, clamped: a whole profile, and the fields that had to be put back. */
export function checkProfile(raw: unknown): { profile: Profile; fixed: string[] } | null {
  const shape = ProfileInput.safeParse(raw);
  if (!shape.success) return null;
  return clampProfile(shape.data);
}

function hasTable(db: DB): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'player_profile'").get();
}

/** The row as stored, or null (no profile: today's Jef). */
export function storedProfile(db: DB, id = PLAYER_ONE): Profile | null {
  if (!hasTable(db)) return null;
  const row = db.prepare("SELECT profile_json FROM player_profile WHERE player_id = ?").get(id) as { profile_json: string } | undefined;
  if (!row) return null;
  try {
    // an older or hand-edited row goes through the clamp as well
    return clampProfile(JSON.parse(row.profile_json)).profile;
  } catch {
    return null;
  }
}

/** The player's profile: the stored one, or today's Jef. */
export function profileOf(db: DB, id = PLAYER_ONE): Profile {
  return storedProfile(db, id) ?? JEF;
}

/** Is this game's player someone other than the old Jef (a profile was made)? */
export const hasProfile = (db: DB, id = PLAYER_ONE): boolean => storedProfile(db, id) !== null;

/** Store a checked profile; the player row's name follows (the job board's prompt reads it). */
export function saveProfile(db: DB, p: Profile, id = PLAYER_ONE): { profile: Profile; code: string } {
  db.exec(PROFILE_SQL);
  const code = appearanceCode(p);
  db.prepare(
    `INSERT INTO player_profile (player_id, profile_json, code, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET profile_json = excluded.profile_json, code = excluded.code, updated_at = excluded.updated_at`,
  ).run(id, JSON.stringify(p), code, new Date().toISOString());
  // the engine's row keeps the canonical "Jef" in its text; the name column is the shown name
  if (id === PLAYER_ONE) db.prepare("UPDATE player SET name = ? WHERE id = 1").run(p.first);
  return { profile: p, code };
}

/** The name for the player row when a new week is seeded (db.ts seed): the profile's, or Jef. */
export function seedName(db: DB): string {
  return storedProfile(db)?.first ?? "Jef";
}

/** He or she, lad or lass... for this game's player. */
export const words = (db: DB, id = PLAYER_ONE): Words => wordsFor(profileOf(db, id));

/** The look in words (for the models): "a woman of about 30, slight, ... and clogs". */
export const look = (db: DB, id = PLAYER_ONE): string => lookLine(profileOf(db, id));

/**
 * A hand-written line said TO the player: "lad" becomes "lass", "mister" "missus", "young man" "young
 * woman" and so on when the player is a woman (shared addressed()). The name is put in by the answer
 * to the browser, so "Jef" in the line may stay.
 */
export function sexed(db: DB, text: string): string {
  const p = storedProfile(db);
  return p ? addressed(p, text) : text;
}

/** The same, choosing between two hand-written forms. */
export function byPlayerSex<T>(db: DB, man: T, woman: T): T {
  return storedProfile(db)?.sex === "woman" ? woman : man;
}

/** Text the browser shows: "Jef" becomes the name; "the farm boy", "a young man on the quays" follow the profile. */
export function shownText(db: DB, text: string): string {
  const p = storedProfile(db);
  return p ? aboutPlayer(p, text) : text;
}

export const LIMITS = { AGE_MIN, AGE_MAX, NAME_MAX };
