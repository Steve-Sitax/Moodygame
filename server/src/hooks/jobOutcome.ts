import { z } from "zod";
import { plainEnglish } from "../text.ts";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { ALL_EMPLOYERS, SPOTS, SYSTEM, type JobRow } from "./jobBoard.ts";
import type { Settlement } from "../game.ts";

// job_outcome hook, docs/03. The engine has already paid and moved trust.
// Claude only says how it went, in the employer's voice, and what they remember.

export const OutcomeSchema = z.object({
  narration: z.string().min(10).max(320),
  memory: z.string().min(5).max(180),
  weight: z.number().int().min(1).max(10),
});
export type Outcome = z.infer<typeof OutcomeSchema>;

export function buildPrompt(job: JobRow, s: Settlement): string {
  const d = ALL_EMPLOYERS[job.employer_npc];
  const e = d ? { name: job.employer_name, note: d.note } : undefined;
  return `A job on the quays has just ended. Write how it ends.

EMPLOYER
${e ? `${e.name}: ${e.note}.` : job.employer_name}

THE JOB
"${job.title}": ${job.pitch}
${workLine(job)}

WHAT HAPPENED (engine facts, all true, do not change them)
${s.facts.map((f) => "- " + f).join("\n")}
- Paid by the employer: ${s.pay_c} centimes.${s.extra_c ? ` Coin from others: ${s.extra_c} centimes.` : ""}
- ${s.caught ? "The employer knows about the misdeed." : "The employer does not know about any misdeed."}

WRITE
- narration: 1 or 2 short sentences. What ${e?.name ?? "the employer"} says or does as the job ends, in their voice.
  If the employer does not know about a misdeed, they must not mention it.
- memory: one sentence, how ${e?.name ?? "the employer"} will remember Jef after this. Their point of view, plain.
- weight: 1 to 10, how much this sticks with them. Plain work 3-4, a theft or a rescue 7-9.`;
}

const place = (id: string) => (SPOTS as Record<string, { label: string } | undefined>)[id]?.label ?? id;

/**
 * The work as the engine set it (M7 quest tests: the outcome named "the Hessenatie door" for a brewer's
 * barrels and "barrels" for sacks, because the pitch was all it had and the engine may move a place).
 */
export function workLine(job: JobRow): string {
  const t = job.task;
  if (!t) return "";
  const w =
    t.kind === "carry"
      ? `${t.count} ${t.goods} from ${place(t.from)} to ${place(t.to)}${t.cart ? ", on the employer's handcart" : ""}`
      : t.kind === "deliver"
        ? `${t.goods === "parcel" ? "a parcel" : `one of the ${t.goods}`} from ${place(t.from)} to ${t.recipient} at ${place(t.to)}`
        : t.kind === "watch"
          ? `a watch over the ${t.goods} at ${place(t.post)}`
          : t.stops.some((s) => s.what === "telegraph")
            ? "a telegram to send"
            : `${t.stops.length} letters to doors`;
  return `The work, as it really was (these goods and places, whatever the pitch says): ${w}.`;
}

/** Hand-written line when the model is late or wrong. */
export function fallbackOutcome(job: JobRow, s: Settlement): Outcome {
  const who = job.employer_name;
  const narration = s.caught
    ? `${who} looks at you a long time. "Not a centime. Get off my kaai."`
    : s.pay_c === 0
      ? `${who} shakes their head. "Nothing done, nothing paid."`
      : `${who} counts it over and pays ${s.pay_c} centimes. "Good. Come back tomorrow."`;
  return { narration, memory: s.facts[0] ?? "Jef did a job.", weight: s.caught ? 7 : 4 };
}

export async function writeOutcome(db: DB, job: JobRow, s: Settlement, runner?: Runner, timeoutMs?: number) {
  const res = await callClaude(
    db,
    { hook: "job_outcome", system: SYSTEM, prompt: buildPrompt(job, s), schema: OutcomeSchema, timeoutMs },
    runner,
  );
  const out = res.ok && res.data ? { ...res.data, narration: plainEnglish(res.data.narration) } : fallbackOutcome(job, s);
  return { outcome: out, source: res.ok ? ("claude" as const) : ("fallback" as const), error: res.error };
}
