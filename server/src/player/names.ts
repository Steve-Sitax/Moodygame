import type { DB } from "../db.ts";
import { pid } from "./current.ts";
import { storedProfile } from "./profile.ts";

// M8c multiplayer: "Jef" in the engine's words, with more than one player (docs/milestones/M8c.md).
//
// The engine writes "Jef" for "the player" everywhere, and the edges put the name in (player/prompt.ts: the
// prompts and every answer to the browser, by the profile of the player who asks). With several players:
// - fresh words made for a player are his: the edge of his request puts his name in, as before;
// - words kept where every player's things lie together (the town's log, what the townspeople remember, the
//   events) must say whom they are about: a guest's are kept with his own name (storeText); the host's keep
//   "Jef", as every older save has them;
// - when a guest's request reads such kept words, "Jef" there is the host (readText): it becomes the host's
//   name, written so the guest's own edge does not take it for him.

const JEF = /(?<![\p{L}\p{M}])Jef(?![\p{L}\p{M}])/gu;

/** A player's first name: his profile's, else the name he joined with, else Jef (the host) or "the visitor". */
export function nameOf(db: DB, id = pid()): string {
  const p = storedProfile(db, id);
  if (p?.first) return p.first;
  if (id === 1) return "Jef";
  const r = db.prepare("SELECT name FROM mp_player WHERE id = ?").get(id) as { name?: string } | undefined;
  return r?.name || "the visitor";
}

/** Words about the player to keep in a shared place: a guest's with his own name; the host's as they are. */
export function storeText(db: DB, text: string, id = pid()): string {
  return id === 1 ? text : text.replace(JEF, nameOf(db, id));
}

/**
 * Kept words, read for a guest: "Jef" in them is the host. His name goes in (when the host is still "Jef",
 * with an invisible joiner inside, so the guest's own edge does not make it the guest's name).
 */
export function readText(db: DB, text: string, id = pid()): string {
  if (id === 1) return text;
  const host = nameOf(db, 1);
  return text.replace(JEF, host === "Jef" ? "Je‍f" : host);
}
