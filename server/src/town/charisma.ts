import type { DB } from "../db.ts";
import { pid } from "../player/current.ts";
import { pstate } from "../player/multi.ts";
import { storeText } from "../player/names.ts";

// Jef's good name in the town (M9 theft, Steve 2026-09-27: "we also lose charisma; if that is too
// low we get in the news anyway and police is called no matter what"). Steve: "better to use what we
// already have", so it is no new number in the save: it is read from what the town already keeps.
// The trust of the people who know him, the talk of his thieving (the rumours' gists), and his record
// with the police. Jobs, gifts and a kind word raise trust and so raise it; thefts, talk and fines
// lower it. The engine reads it; the player sees it only in words.

/** At or below this the town has had enough of him: a theft seen is the police and the paper, whatever he says. */
export const CHARISMA_LOW = 2;

/** The gists the town tells of Jef's thieving (M8c: this player's; a guest's gists carry his name). */
const THEFT_GISTS = ["Jef stole%", "Jef was about when%", "Jef was caught with%", "Jef ran from the police%", "Jef took % and gave it back%", "Jef was caught stealing%", "Jef picked%", "Jef was taken to the prison%"];

/** How many townspeople are talking about Jef's thieving now. */
export function theftTalkCount(db: DB): number {
  const like = THEFT_GISTS.map((g) => storeText(db, g));
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT npc_id) AS n FROM npc_memory WHERE tone < 0 AND gist IS NOT NULL AND COALESCE(about_player, 1) = ? AND
         (${like.map(() => "gist LIKE ?").join(" OR ")})`,
      )
      .get(pid(), ...like) as { n: number }
  ).n;
}

export interface NameParts {
  /** Mean trust of the people who know him (-5..10); 0 when nobody does yet. */
  trust: number;
  known: number;
  talk: number;
  fines: number;
  arrests: number;
  fled: number;
}

/** The parts, for the dev view and the tests. */
export function nameParts(db: DB): NameParts {
  const t = db.prepare("SELECT AVG(trust) AS a, COUNT(*) AS n FROM npc_relationship WHERE player_id = ? AND (times_met > 0 OR trust != 0)").get(pid()) as { a: number | null; n: number };
  const rec = pstate<{ record?: { fines?: number; arrests?: number; fled?: number } }>(db, "police")?.record ?? {};
  return { trust: t.n ? (t.a ?? 0) : 0, known: t.n, talk: theftTalkCount(db), fines: rec.fines ?? 0, arrests: rec.arrests ?? 0, fled: rec.fled ?? 0 };
}

/** Pure: the good name 0-10 from its parts (a newcomer nobody knows: 5). */
export function charismaOf(p: NameParts): number {
  const c = 5 + p.trust * 0.8 - p.talk * 0.35 - p.fines * 0.5 - p.arrests - p.fled * 0.5;
  return Math.max(0, Math.min(10, Math.round(c)));
}

/** Jef's good name now, 0-10. */
export function charisma(db: DB): number {
  return charismaOf(nameParts(db));
}

/** The good name in words (the pockets panel), never the number. */
export function charismaWords(c: number): string {
  if (c >= 8) return "The town speaks well of you.";
  if (c >= 6) return "People are friendly enough.";
  if (c >= 4) return "Nobody has much to say about you.";
  if (c > CHARISMA_LOW) return "People look at you sideways.";
  return "The town has had enough of you. One more slip and it is the police.";
}
