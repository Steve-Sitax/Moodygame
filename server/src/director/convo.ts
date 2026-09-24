import { z } from "zod";
import type { DB } from "../db.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, CONVO_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { log } from "../game.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { applyTrust, relationship, remember, topMemories, trustText } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { TRADES } from "../town/places.ts";
import { personaLine, resident, town } from "../town/store.ts";
import type { Resident } from "../town/population.ts";
import { notify } from "./bus.ts";
import { writeEvent } from "./eventlog.ts";
import { CONVO_FALLBACK, TALK_TO_MAX_LINES } from "./vocab.ts";

// Two townspeople talk in the street (M4): a police agent questions a suspect,
// a neighbour passes on a rumour, two sellers quarrel. The model writes the
// lines (hook npc_convo, its own share of the day's calls, never the reserve);
// the ENGINE fixes the outcome before the call and applies it after: money
// moves only for a robbery the log knows of, trust moves by at most one, a
// rumour passed on is the engine's own gist. Late or over budget: engine lines.
// The client shows the lines as paper tags over their heads with a murmur.

export const ConvoSchema = z.object({
  lines: z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string().min(1).max(140) })).min(2).max(TALK_TO_MAX_LINES),
  memory_a: z.string().max(160),
  memory_b: z.string().max(160),
  outcome_kind: z.enum(["none", "pass_rumour", "agree", "refuse"]),
  /** How the talk changes how each sees Jef: -1, 0 or 1. */
  trust_a: z.number().int().min(-1).max(1),
  trust_b: z.number().int().min(-1).max(1),
});
export type ConvoOut = z.infer<typeof ConvoSchema>;

/** M6: "share" (a household passing on news of Jef) and "scheme" (a resident's own business of the day) are run by their own modules. */
export type Purpose = "chat" | "question" | "invite" | "argue" | "report" | "share" | "scheme" | "menace";

export interface ConvoLine {
  who: string;
  name: string;
  text: string;
}

export interface ConvoResult {
  id: number;
  a: string;
  b: string;
  a_name: string;
  b_name: string;
  purpose: Purpose;
  lines: ConvoLine[];
  source: "claude" | "engine";
  outcome: string;
  /** Real time it was made (the client shows it once). */
  at: number;
  event_id: number | null;
}

export interface ConvoOpts {
  a: string;
  b: string;
  purpose: Purpose;
  /** What it is about, in engine words (an event's text, a robbery). */
  about?: string;
  /**
   * A questioning: the engine's verdict, fixed before the call. `victim` (M4b): a robbery in
   * the street Jef saw; the purse goes back to the victim, never to Jef.
   */
  fixed?: { guilty: boolean; amount_c: number; victim?: string; crime_event?: number };
  event_id?: number;
}

const RULES = `
YOU NOW WRITE A SHORT EXCHANGE BETWEEN TWO PEOPLE OF THE TOWN, 1873, in the street, overheard.
- 2 to ${TALK_TO_MAX_LINES} lines, taking turns, A first. Each line one short sentence or two, in that person's own voice, by their stats.
- The OUTCOME given below is fixed by the game. Write the lines so they lead to it; never contradict it, never name another sum.
- What each knows of Jef is all they know of him. Never invent things Jef did.
- ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}
- memory_a, memory_b: one sentence each of what they will remember of this, or "".
- outcome_kind: pass_rumour if A told B something about Jef; agree if B agreed to what A wanted; refuse if B refused; else none.
- trust_a, trust_b: how this talk changes how each sees Jef, -1, 0 or 1. Usually 0.`;

/** Calls left for conversations today: their own share, and never the reserve. */
export function canCallConvo(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook = 'npc_convo'").get(day) as { n: number }).n;
  return mine < CONVO_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

function personBlock(db: DB, tag: string, r: Resident): string {
  const s = r.stats;
  const rel = relationship(db, r.id);
  const mem = topMemories(db, r.id, 3);
  const persona = personaLine(db, r.id);
  return `PERSON ${tag}: ${r.name}, ${r.age}, ${r.sex === "f" ? "woman" : "man"}, ${TRADES[r.trade].label}.
Stats 0-10: honesty ${s.honesty}, temper ${s.temper}, warmth ${s.warmth}, greed ${s.greed}, courage ${s.courage}, gossip ${s.gossip}.${persona ? ` ${persona}` : ""}
Trust in Jef ${trustText(rel?.trust ?? 0)}. Knows of Jef: ${mem.length ? mem.map((m) => m.text).join(" / ") : "nothing; a stranger"}`;
}

function purposeText(db: DB, o: ConvoOpts, a: Resident, b: Resident): string {
  switch (o.purpose) {
    case "question":
      if (o.fixed?.victim) {
        const v = town(db).byId.get(o.fixed.victim);
        const vn = v?.first ?? "someone";
        return o.fixed.guilty
          ? `${a.first} (a police agent) questions ${b.first} about the purse taken from ${vn} in the street; Jef saw it and told the police. OUTCOME (fixed): ${b.first} did take it, ${o.fixed.amount_c} centimes. ${b.first} denies it at first, then hands the ${o.fixed.amount_c} centimes over for ${vn}. No arrest today. Jef gets nothing.`
          : `${a.first} (a police agent) questions ${b.first} about the purse taken from ${vn} in the street. OUTCOME (fixed): ${b.first} did NOT do it and is offended at being accused. ${a.first} lets it go.`;
      }
      return o.fixed?.guilty
        ? `${a.first} (a police agent) questions ${b.first} about Jef's purse. OUTCOME (fixed): ${b.first} did pick Jef's pocket for ${o.fixed.amount_c} centimes. ${b.first} denies it at first, then hands the ${o.fixed.amount_c} centimes over. No arrest today.`
        : `${a.first} (a police agent) questions ${b.first} about Jef's purse. OUTCOME (fixed): ${b.first} did NOT do it and is offended at being accused. ${a.first} lets it go.`;
    case "report":
      // M6 families: a complaint about Jef, not a robbery; the agent will have a word with him (no arrest)
      if (o.about?.startsWith("complaint:"))
        return `${a.first} has come to a police agent, ${b.first}, with a complaint about a man called Jef: ${o.about.slice(10).trim()} OUTCOME (fixed): ${b.first} agrees to go and have a word with Jef. Nobody is arrested for words.`;
      return `${a.first} has come to fetch ${b.first}, a police agent: a man called Jef says he was robbed${o.about ? ` (${o.about})` : ""}. OUTCOME (fixed): ${b.first} agrees to come and see.`;
    case "invite":
      return `${a.first} asks ${b.first} to come along${o.about ? `: ${o.about}` : ""}. OUTCOME (fixed): ${b.first} agrees.`;
    case "argue":
      return `${a.first} and ${b.first} quarrel in the street${o.about ? ` about ${o.about}` : ""}, loud enough for a crowd to gather. Nobody fights: words only.`;
    default:
      return `${a.first} stops ${b.first} for a word${o.about ? ` about ${o.about}` : ""}. If ${a.first} has heard something of Jef and likes to gossip, it may come up.`;
  }
}

function prompt(db: DB, o: ConvoOpts, a: Resident, b: Resident): string {
  const c = clock(db);
  return `${personBlock(db, "A", a)}

${personBlock(db, "B", b)}

NOW
${c.weekday}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}. In the street, near ${town(db).town.places[a.work.place]?.label ?? "the quays"}.

WHAT HAPPENS
${purposeText(db, o, a, b)}`;
}

let nextId = 1;
const recent: ConvoResult[] = [];
const RECENT_MS = 120_000;

/** Conversations of the last two minutes (the client shows them once). */
export function recentConvos(): ConvoResult[] {
  const now = Date.now();
  while (recent.length && now - recent[0].at > RECENT_MS) recent.shift();
  return recent.slice();
}

/** M6: a conversation another module wrote (a family, a scheme, a menace): shown once, like any other. */
export function publishConvo(c: Omit<ConvoResult, "id" | "at"> & { id?: number }): ConvoResult {
  const result: ConvoResult = { ...c, id: c.id || nextId++, at: Date.now() };
  recent.push(result);
  notify("convo", { convo: result });
  return result;
}

/** Test helper. */
export function resetConvos(): void {
  recent.length = 0;
}

function engineLines(o: ConvoOpts, a: Resident, b: Resident): ConvoLine[] {
  const key = o.purpose === "report" && o.about?.startsWith("complaint:") ? "complaint" : o.purpose === "question" ? (o.fixed?.victim ? (o.fixed.guilty ? "street_guilty" : "street_innocent") : o.fixed?.guilty ? "question_guilty" : "question_innocent") : o.purpose;
  const set = CONVO_FALLBACK[key] ?? CONVO_FALLBACK.chat;
  return set.map((f, i) => {
    const s = f(a.first, b.first);
    const text = s.replace(/^[^:]+:\s*/, "");
    const who = i % 2 === 0 ? a : b;
    return { who: who.id, name: who.first, text };
  });
}

/** The talk of the town: the thief's purse comes back through the engine, never through words. */
function payBack(db: DB, thief: Resident, amount: number): void {
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(amount);
    log(db, "restitution", thief.id, `The police made ${thief.name} give Jef back his ${amount} centimes.`, "world");
  })();
}

/**
 * Run one conversation and apply its outcome. Never throws for a missing model:
 * the engine's lines stand in. Both people must be residents.
 */
export async function runConvo(db: DB, o: ConvoOpts, runner?: Runner): Promise<ConvoResult> {
  const a = resident(db, o.a);
  const b = resident(db, o.b);
  if (!a || !b) throw new Error(`convo: unknown person ${!a ? o.a : o.b}`);
  let out: ConvoOut | null = null;
  if (canCallConvo(db)) {
    const res = await callClaude(db, { hook: "npc_convo", system: SYSTEM + "\n" + RULES, prompt: prompt(db, o, a, b), schema: ConvoSchema }, runner);
    if (res.ok && res.data) out = res.data;
  }
  const lines: ConvoLine[] = out
    ? out.lines.map((l) => ({ who: l.speaker === "A" ? a.id : b.id, name: l.speaker === "A" ? a.first : b.first, text: plainEnglish(l.text) }))
    : engineLines(o, a, b);
  let outcome: string = out?.outcome_kind ?? "none";

  // the engine's side: memories, trust by at most one, the rumour passed, the purse
  if (o.purpose === "question" && o.fixed?.victim) {
    // M4b: a robbery in the street Jef saw. The purse goes back to the victim on the record; Jef's money never moves.
    const v = resident(db, o.fixed.victim);
    if (o.fixed.guilty && v) {
      const text = `${a.name} of the police made ${b.name} give ${v.name} back the ${o.fixed.amount_c} centimes he took in the street; Jef had seen it.`;
      writeEvent(db, { kind: "theft", verb: "robbery_solved", actor: a.id, target: b.id, text, outcome: "guilty", ref_type: "world_event", ref_id: o.fixed.crime_event ?? null, weight: 7, data: { thief: b.id, victim: v.id, amount_c: o.fixed.amount_c }, who: [a.id, b.id, v.id] });
      remember(db, a.id, `On Jef's word I made ${b.name} give ${v.name} back the ${o.fixed.amount_c} centimes he lifted.`, 6);
      remember(db, b.id, `Jef saw me take ${v.name}'s purse and set the police on me. I had to give it back.`, 8, "seen", null, { gist: `Jef told the police who took ${v.name}'s purse`, tone: 0 });
      remember(db, v.id, `Jef saw who took my purse and told the police. I have my ${o.fixed.amount_c} centimes back.`, 7, "seen", null, { gist: `Jef helped ${v.name} get her purse back through the police`.replace(" her ", v.sex === "m" ? " his " : " her "), tone: 1 });
      applyTrust(db, b.id, -1, 0);
      applyTrust(db, v.id, 1, 0);
      outcome = "guilty";
    } else {
      remember(db, a.id, `Jef had me question ${b.name} over a purse taken in the street. Nothing in it.`, 4);
      remember(db, b.id, `Jef sent the police after me for nothing. I'll not forget it.`, 6, "seen", null, { gist: `Jef accused ${b.name} to the police for nothing`, tone: -1 });
      applyTrust(db, b.id, -1, 0);
      outcome = "innocent";
    }
  } else if (o.purpose === "question" && o.fixed) {
    if (o.fixed.guilty) {
      payBack(db, b, o.fixed.amount_c);
      remember(db, a.id, `I made ${b.name} give Jef back the ${o.fixed.amount_c} centimes he lifted.`, 7, "seen", null, { gist: "Jef got his money back through the police", tone: 1 });
      remember(db, b.id, `The police made me give Jef his ${o.fixed.amount_c} centimes back. He set them on me.`, 8, "seen", null, { gist: `Jef set the police on ${b.name} and got his money back`, tone: 0 });
      applyTrust(db, b.id, -1, 0);
      outcome = "guilty";
    } else {
      remember(db, a.id, `Jef had me question ${b.name} over a purse. Nothing in it.`, 4);
      remember(db, b.id, `Jef sent the police after me for nothing. I'll not forget it.`, 6, "seen", null, { gist: `Jef accused ${b.name} to the police for nothing`, tone: -1 });
      applyTrust(db, b.id, -1, 0);
      outcome = "innocent";
    }
  } else {
    if (out?.memory_a.trim()) remember(db, a.id, out.memory_a, 4);
    if (out?.memory_b.trim()) remember(db, b.id, out.memory_b, 4);
    if (out) {
      applyTrust(db, a.id, out.trust_a, 0);
      applyTrust(db, b.id, out.trust_b, 0);
    }
    if (outcome === "pass_rumour" || (!out && o.purpose === "chat" && a.stats.gossip >= 6)) {
      if (passRumour(db, a.id, b.id)) outcome = "pass_rumour";
      else if (outcome === "pass_rumour") outcome = "none";
    }
    if (o.purpose === "report" || o.purpose === "invite") outcome = "agree"; // fixed by the engine
  }

  const id = nextId++;
  const text = o.purpose === "question" ? `${a.name} of the police questioned ${b.name} about ${o.fixed?.victim ? "a purse taken in the street" : "Jef's purse"}` : o.purpose === "report" ? `${a.name} fetched ${b.name} of the police for Jef` : o.purpose === "argue" ? `${a.name} and ${b.name} quarrelled in the street` : `${a.name} spoke with ${b.name}`;
  const eid = writeEvent(db, {
    kind: "talk",
    verb: "convo",
    actor: a.id,
    target: b.id,
    text,
    outcome,
    weight: o.purpose === "question" ? 6 : o.purpose === "argue" ? 4 : 3,
    data: { purpose: o.purpose, lines: lines.map((l) => `${l.name}: ${l.text}`), source: out ? "claude" : "engine" },
    who: [a.id, b.id],
    ref_type: o.event_id ? "town_event" : null,
    ref_id: o.event_id ?? null,
  });
  const result: ConvoResult = { id: eid || id, a: a.id, b: b.id, a_name: a.name, b_name: b.name, purpose: o.purpose, lines, source: out ? "claude" : "engine", outcome, at: Date.now(), event_id: o.event_id ?? null };
  recent.push(result);
  notify("convo", { convo: result });
  return result;
}

/** A's strongest rumour about Jef that B has not heard: B hears it now (the engine's gist, not the model's). */
export function passRumour(db: DB, from: string, to: string): boolean {
  const rows = db
    .prepare(
      `SELECT id, gist, tone, weight, COALESCE(origin, id) AS origin FROM npc_memory
       WHERE npc_id = ? AND gist IS NOT NULL AND gist <> '' AND weight >= 2 ORDER BY weight DESC, id DESC LIMIT 5`,
    )
    .all(from) as Array<{ id: number; gist: string; tone: number; weight: number; origin: number }>;
  const knows = db.prepare("SELECT 1 FROM npc_memory WHERE npc_id = ? AND (origin = ? OR id = ?) LIMIT 1");
  const r = rows.find((x) => !knows.get(to, x.origin, x.origin));
  if (!r) return false;
  const day = clock(db).day;
  const teller = (db.prepare("SELECT name FROM npc WHERE id = ?").get(from) as { name: string } | undefined)?.name ?? "someone";
  db.prepare(
    `INSERT INTO npc_memory (npc_id, text, source, heard_from, weight, day, spread, gist, tone, origin, town_spread)
     VALUES (?, ?, 'heard', ?, ?, ?, 1, ?, ?, ?, 0)`,
  ).run(to, `${teller} told me: ${r.gist}`, from, Math.max(1, r.weight - 1), day, r.gist, r.tone, r.origin);
  return true;
}
