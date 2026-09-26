import type { DB } from "../db.ts";
import { aboutPlayer, lookLine, phrasesBack, wordsFor, type Profile } from "../../../shared/character.ts";
import { storedProfile } from "./profile.ts";

// M7 character: the one place every prompt gets the player (ai/claude.ts callClaude runs every call
// through playerIn and playerOut). The engine writes "Jef" everywhere; with a profile made:
// - on the way out, "Jef" becomes the name ("the farm boy" the farm girl, "Jef, a young man" a young
//   woman), and the system prompt ends with THE PLAYER: the name, the sex, the age, the words people
//   use, the look in a line, and what 1873 thinks of a woman on the docks;
// - on the way back, the name in the model's answer becomes "Jef" again, so every check the engine
//   runs on the words (rumours start with "Jef", the ballad guard, the memories) holds as before.
// Without a profile (today's Jef, an old save) both are the identity: not a character changes.

/** THE PLAYER, for the end of the system prompt. */
export function playerBlock(p: Profile): string {
  const w = wordsFor(p);
  const woman = p.sex === "woman";
  const address = woman
    ? `People speak to her and of her as to a working woman of 1873: "missus", "lass", "girl", "my girl", "woman" (a child says "missus"); never "lad", "mister", "sir", "young man", "my son" or "he".`
    : `People speak to him as to a working man of 1873: ${p.age <= 30 ? `"lad", "young man", "mister", "friend"` : `"mister", "friend", "man" (not "lad" or "young man" at his age)`}.`;
  const period = woman
    ? `\nIn 1873 a woman does not work in the naties' gangs on the quays, drink in the dockers' taverns or walk the dark streets alone at night without people remarking on it. Townspeople may say so, in their words and their looks only: the rules of the game are the same for her.`
    : "";
  return `
THE PLAYER (the person the notes above and below call ${p.first}): ${w.full}, a ${p.age <= 30 ? "young " : ""}${w.man} of ${p.age}, new in Antwerp from the Kempen, poor, looking for work. ${w.He}: ${w.he}, ${w.him}, ${w.his}.
To look at: ${lookLine(p)}.
${address}
Where a note says "he", "him", "his", "lad" or "young man" of ${p.first}, it means ${p.first}: use ${w.he}, ${w.him}, ${w.his}, "${w.lad}", "${w.youngMan}". In the notes' headings JEF means ${p.first}. A townsperson who happens to share the first name ${p.first} is somebody else.${period}`;
}

export interface ModelRequest {
  system: string;
  prompt: string;
}

/** The request as the model sees it: the name and words put in, THE PLAYER at the end of the system prompt. */
export function playerIn<R extends ModelRequest>(db: DB, req: R): R {
  const p = storedProfile(db);
  if (!p) return req;
  return { ...req, system: aboutPlayer(p, req.system) + playerBlock(p), prompt: aboutPlayer(p, req.prompt) };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as a whole word (letters with accents count as letters). */
const wordRe = (s: string, after = "") => new RegExp(`(?<![\\p{L}\\p{M}])${esc(s)}(?![\\p{L}\\p{M}])${after}`, "gu");

/** The model's words about the player back in the engine's form: the name is "Jef" again. */
export function nameBack(p: Profile, text: string): string {
  if (p.first === "Jef") return phrasesBack(p, text);
  let t = text;
  // the full name first, then the first name alone, but not a townsperson of the same first name
  // ("Anna Maes" stays; "Anna", "Anna's", and "Anna Claes" when Claes is her own surname are the player)
  if (p.last) t = t.replace(wordRe(`${p.first} ${p.last}`), "Jef");
  return phrasesBack(p, t.replace(wordRe(p.first, "(?!\\s+\\p{Lu})"), "Jef"));
}

/** Every string in a parsed answer, name back to "Jef". */
export function namesBack<T>(p: Profile, v: T): T {
  if (typeof v === "string") return nameBack(p, v) as T;
  if (Array.isArray(v)) return v.map((x) => namesBack(p, x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = namesBack(p, x);
    return out as T;
  }
  return v;
}

/** A call's result with the name back in the engine's form (the identity without a profile). */
export function playerOut<R extends { ok: boolean; data?: unknown }>(db: DB, r: R): R {
  const p = storedProfile(db);
  if (!p || !r.ok || r.data === undefined) return r;
  return { ...r, data: namesBack(p, r.data) };
}

/**
 * The server's answer to the browser (a JSON text), with the player's name and words in (index.ts: every
 * /api answer and every push). Only whole-word "Jef" and the phrases that always mean the player change.
 */
export function shownJson(db: DB, json: string): string {
  const p = storedProfile(db);
  return p ? aboutPlayer(p, json) : json;
}
