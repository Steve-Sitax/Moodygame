import { z } from "zod";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { SYSTEM } from "./jobBoard.ts";
import { PLACED, npcRow, relationship, topMemories } from "../npcs.ts";
import type { Ending } from "../day.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";

// epilogue hook (docs/03). Written once, from the whole week. Numbers and facts
// come from the engine; Claude only tells what became of Jef.

export const EpilogueSchema = z.object({
  title: z.string().min(3).max(80),
  paragraphs: z.array(z.string().min(40).max(1200)).length(2),
});

export function buildPrompt(db: DB, e: Ending): string {
  const p = db.prepare("SELECT name, money_c, food, warmth, health, sleep, day, rent_paid_until FROM player WHERE id = 1").get() as Record<string, number | string>;
  const trust = db.prepare("SELECT faction, trust FROM faction_trust ORDER BY trust DESC").all() as Array<{ faction: string; trust: number }>;
  const log = (db.prepare("SELECT day, hour, text FROM log ORDER BY id DESC LIMIT 80").all() as Array<{ day: number; hour: number; text: string }>).reverse();
  const people = Object.keys(PLACED)
    .map((id) => {
      const n = npcRow(db, id)!;
      const r = relationship(db, id);
      const m = topMemories(db, id, 2).map((x) => x.text);
      return `- ${n.name} (${n.role}): trust ${r.trust}/10, met ${r.times_met} times. ${r.view_of_player || "Hardly knows him."}${m.length ? " Remembers: " + m.join(" / ") : ""}`;
    })
    .join("\n");
  return `The story of Jef's first week in Antwerp is over. Write the epilogue.

HOW IT ENDED
${e.kind === "health" ? `His body gave out on day ${e.day}. This is an early, bad ending: cold, hunger or a night too many on the quay.` : "He lived through the whole week, to Sunday night."}

HOW HE STANDS AT THE END
Money: ${p.money_c} centimes. Belly ${p.food}/10, warmth ${p.warmth}/10, health ${p.health}/10. Rent for the week ${Number(p.rent_paid_until) >= 7 ? "paid" : "not paid"}.
Trust per faction (0-10): ${trust.map((t) => `${t.faction} ${t.trust}`).join(", ")}.

THE PEOPLE OF THE RIJNKAAI
${people}

THE WEEK, AS THE LOG HAS IT (oldest first)
${log.map((l) => `- day ${l.day}, ${String(l.hour).padStart(2, "0")}:00 ${l.text}`).join("\n")}

WRITE
- title: a short title for Jef's week, like a chapter heading.
- paragraphs: exactly two. The first tells what the week was, using real moments from the log and the people above.
  The second tells what became of Jef after, in the years that followed, as it fits how he stands now
  (a man with trust among the naties might become a regular docker; a smuggler's friend might end in the Steen;
  a sick man might not see the spring). No happy ending he did not earn. Past tense, period voice, no modern words.
${LANGUAGE_RULE}`;
}

export function fallbackEpilogue(e: Ending): { title: string; paragraphs: string[] } {
  return e.kind === "health"
    ? {
        title: "The fog keeps what it takes",
        paragraphs: [
          "Jef came to the Rijnkaai with fifty centimes and no name, and for a few days he carried what he was told to carry. The cold and the hunger were patient with him, and then they were not.",
          "They found him one morning under a tarpaulin by the bollards. The Hessenatie paid for nothing, and the priest said a few words that the wind took away. Nobody on the kaai remembered his surname.",
        ],
      }
    : {
        title: "A week on the Rijnkaai",
        paragraphs: [
          "Jef lived through his first week on the Rijnkaai: fog in the morning, work when there was work, a herring when there was money for one. Some on the quay began to know his face.",
          "What came after is not written down. Maybe he stayed and became one of the day men the naties call by name. Maybe he went back to the Kempen with a cough and a story. The Schelde does not say.",
        ],
      };
}

export async function writeEpilogue(db: DB, e: Ending, runner?: Runner) {
  const res = await callClaude(db, { hook: "epilogue", system: SYSTEM, prompt: buildPrompt(db, e), schema: EpilogueSchema }, runner);
  const text = res.ok && res.data ? { title: res.data.title, paragraphs: res.data.paragraphs.map(plainEnglish) } : null;
  return { epilogue: text ?? fallbackEpilogue(e), source: res.ok ? ("claude" as const) : ("fallback" as const), error: res.error };
}
