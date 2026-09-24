import type { DB } from "../db.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, IDEAS_CALLS_PER_DAY } from "../config.ts";
import { town } from "../town/store.ts";

// Small shared pieces of the M6 AI ideas (ideas/): the budget share, the clock,
// and the checks every model text goes through. The engine owns every fact and
// number; these checks make sure the words do not add any.

export const IDEAS_HOOKS = ["poster", "letter_reply", "trouble", "diary"] as const;

/** The ideas' share of the day's calls (config.ts), never the reserve. */
export function canCallIdeas(db: DB): boolean {
  const day = now(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare(`SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook IN (${IDEAS_HOOKS.map(() => "?").join(", ")})`).get(day, ...IDEAS_HOOKS) as { n: number }).n;
  return mine < IDEAS_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

export function now(db: DB): { day: number; hour: number; minute: number } {
  return db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
}

export function flag(db: DB, key: string): number {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  return row ? Number(JSON.parse(row.value_json)) : 0;
}

export function setFlag(db: DB, key: string, v: number): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

export const round5 = (n: number) => Math.round(n / 5) * 5;
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** A sum written in words ("five francs", "a hundred centimes"): never allowed, the engine writes digits. */
export const WORD_SUMS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|a|some|many)\s+(francs?|centimes?|guilders?|pounds?|napoleons?|louis|sous?|crowns?|thalers?)\b/i;
/** Tells of a gift or payment the engine never made. */
export const GIFTS = /\b(enclos\w*|banknote|bank note|money order|postal order|gold coins?|i send you (some|a little)? ?money|here is (some|a little) money|reward you with|i will pay you|i shall pay you|take this purse)\b/i;

/** Every number in the text is one the engine gave (its facts), and no sum is written in words. */
export function numbersOk(text: string, allowed: Iterable<string>): boolean {
  const ok = new Set(allowed);
  if (WORD_SUMS.test(text)) return false;
  return (text.match(/\d+/g) ?? []).every((d) => ok.has(d));
}

/** The digits in a set of engine facts. */
export function digitsOf(...texts: string[]): string[] {
  return texts.flatMap((t) => t.match(/\d+/g) ?? []);
}

/**
 * Names: the text may name only the people the engine gave it. Any other resident's full
 * name, or Jef when he is not in the facts, fails the text.
 */
export function namesOk(db: DB, text: string, allowed: string[], jefAllowed: boolean): boolean {
  if (!jefAllowed && /\bJef\b/.test(text)) return false;
  const ok = allowed.map((a) => a.toLowerCase());
  const t = text.toLowerCase();
  for (const r of town(db).town.residents) {
    const n = r.name.toLowerCase();
    if (t.includes(n) && !ok.some((a) => a.includes(n) || n.includes(a))) return false;
  }
  return true;
}

/** Words that leave 1873 (the model talking about itself, the game, modern things). */
export const OUT_OF_WORLD = /\b(computer|internet|telephone|robots?|prompts?|artificial intelligence|language model|chatbot|assistant|video game|the player|instructions|my rules)\b|\bAI\b/i;
