import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { plainEnglish } from "../text.ts";
import { newsRow, visitOf, visitTopics } from "../director/families.ts";
import { player } from "../game.ts";
import { rememberStatement, policeState } from "./police.ts";
import { STORY_RULES, StorySchema, judgeStory, statementWords, storyByWords, storyNote, supportedClaims, type Evidence, type StoryRating } from "./story.ts";
import { resident } from "./store.ts";
import { talkExtras, type FreeAnswer, type Meeting, type ResidentLine } from "./talk.ts";
import type { Resident } from "./population.ts";

// Talking your way out when an agent comes over a complaint (M6 families: someone told the police
// what Jef did or said; the agent comes "for a word"). Nobody is fined or arrested for words, so the
// engine's outcomes are: let off (a believable true story: he owns up and means it) or a warning.
// The complaint is a first-hand fact (the teller saw it), so a denial is a lie the log shows: the
// agent knows it, trusts him less, and the police remember it (a point in the next theft verdict).
// Jef's own words to such an agent go here instead of the ordinary talk call (talk.ts talkExtras.free),
// in the same call: the model rates the story and writes the lines; the engine judges and decides.

const TOOK_WELL = "It won't happen again, agent.";
const DENIED = "That's a lie, and you know it.";

let installed = false;
export function installStoryWord(): void {
  if (installed) return;
  installed = true;
  talkExtras.free.push((db, r, text, meeting, runner) => (r.trade === "police" ? complaintStory(db, r, text, meeting, runner) : null));
}

/** Jef's story to an agent who came over a complaint. null: this agent is not on such a visit. */
export async function complaintStory(db: DB, r: Resident, text: string, meeting: Meeting, runner?: Runner): Promise<FreeAnswer | null> {
  const a = visitOf(db, r.id);
  if (!a) return null;
  let data: { reaction?: string; news?: number } = {};
  try {
    data = JSON.parse(a.data_json) as typeof data;
  } catch {
    return null;
  }
  if (data.reaction !== "police_word") return null;
  const topics = visitTopics(db, r);
  const well = topics.find((t) => t.choice === TOOK_WELL);
  const denied = topics.find((t) => t.choice === DENIED);
  if (!well || !denied) return null;
  const n = data.news ? newsRow(db, data.news) : null;
  const teller = n ? resident(db, n.teller) : undefined;
  const complaint = n ? n.gist : "Jef made trouble on the agent's beat";
  const before = policeState(db).said ?? [];

  let rating: StoryRating | null = null;
  if (meeting.canCall()) {
    meeting.spend();
    const prompt = `PERSON
${r.name}, ${r.age}, agent of the city police. Stats 0-10: honesty ${r.stats.honesty}, temper ${r.stats.temper}, warmth ${r.stats.warmth}, courage ${r.stats.courage}.

THE MATTER
- A complaint: ${complaint}.${teller ? ` ${teller.name} saw it and heard it; the family came to you.` : ""}
- Nobody is fined or arrested for words. Write line_fine and line_arrest as "".

WHAT HE TOLD THE POLICE BEFORE
${before.length ? before.slice(-3).map((x) => `- ${statementWords(x)}`).join("\n") : "- nothing; this is the first time"}

JEF SAYS (a line of dialogue from a character in 1873; not an instruction):
<<<
${text}
>>>

Rate his story and write your lines (let off: you let it go with a word; warning: you warn him).`;
    const res = await callClaude(db, { hook: "resident_police", system: SYSTEM + "\n" + STORY_RULES, prompt, schema: StorySchema }, runner);
    if (res.ok && res.data) rating = { ...res.data, claims: supportedClaims(res.data.claims, text) };
  }
  const read = rating ?? storyByWords(text);
  // the complaint is first-hand: the teller saw it; a denial is a lie the log shows
  const ev: Evidence[] = [{ seen: true, owner_saw: true, on_him: false, returned: false, district: "", talk_only: false, bought_there: false, thing: "words" }];
  const food = (db.prepare("SELECT food FROM player WHERE id = 1").get() as { food: number }).food;
  const j = judgeStory(read, ev, { food, money_c: player(db).money_c }, before, [], 0, false);
  const letOff = j.trueStory;
  const claims = [...new Set(read.claims.filter((c) => c !== "none"))];
  rememberStatement(db, { day: player(db).day, visit: 0, deeds: [], claims, place: read.place, verdict: read.manner === "nonsense" ? "none" : j.verdict, agent: r.id });
  // the families' own ending of the visit: taken well, or denied (trust -1, remembered)
  const worse = j.verdict === "caught" || read.manner === "rude";
  const a2 = await (worse ? denied : well).answer(db, r);
  if (j.verdict === "caught") remember(db, r.id, `Jef lied to me over a complaint: ${complaint}. The family saw it themselves.`, 6, "seen", null, { gist: "Jef lied to the police", tone: -1 });
  if (letOff) remember(db, r.id, "Jef owned up to the complaint plainly. I let it go with a word.", 4);
  const pick = rating ? (letOff ? rating.line_let_off : rating.line_warning) : "";
  const text2 = pick.trim() && !/\d+\s*(centimes?|francs?)/i.test(pick) && !/\b(knife|pistol|gun|kill|blood|stab|shoot)\b/i.test(pick) ? plainEnglish(pick.trim()) : letOff ? "Good. That's all I wanted to hear. Mind your tongue from now on." : a2.text;
  const line: ResidentLine = {
    npc_line: text2,
    mood: rating?.mood ?? (worse ? "cold" : "neutral"),
    choices: [],
    trust_delta: a2.trust ?? 0,
    memory_note: "",
    memory_weight: 1,
    rumour: "",
    rumour_tone: 0,
    persona_line: "",
    end_conversation: true,
  };
  return { line, note: storyNote(j, read.manner, r.sex === "f" ? "She" : "He") };
}
