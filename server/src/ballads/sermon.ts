import { z } from "zod";
import type { DB } from "../db.ts";
import { SERMON_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { log } from "../game.ts";
import { writeEvent } from "../director/eventlog.ts";
import { callTimeout, canCallShare, getState, hourNow, setState } from "../interiors/state.ts";
import { resident } from "../town/store.ts";
import { jefInside, landmarkNow } from "../landmarks/life.ts";
import { isSunday, massAt } from "../../../shared/landmarks.ts";
import { jefHint, sermonFacts, type Fact, type Hint } from "./facts.ts";
import { allowedNames, cleanVerse, plainWords } from "./guard.ts";

// The Sunday sermon (M6, Steve 2026-09-24). At high mass (Sunday, nine to eleven) the priest
// climbs the pulpit and preaches six to ten short lines about the week's sins and scandals in
// town. The ENGINE picks the facts from the log since Monday (facts.ts: the thefts, the
// quarrels, the drinking, a fire as a warning, the emigrants leaving, a rumour) and whether a
// rumour names Jef this week (then the sermon may hint at "a young man on the quays", never his
// name). The model words it (hook "sermon", one call a Sunday); every line is checked (guard.ts:
// no call to harm anyone, no real people, tame); late, wrong or over budget: the engine's sermon.
//
// The engine's rule for Jef: if he is inside the cathedral when the sermon ends, his trust with
// the kerk (the church) moves by one, once a Sunday: -1 when the sermon warned of the young man on
// the quays (the rows turn to look at him), +1 otherwise (the priest saw him at mass). Clamped 0-10.

export const SERMON_HOOKS = ["sermon"];
export function canCallSermon(db: DB): boolean {
  return canCallShare(db, SERMON_HOOKS, SERMON_CALLS_PER_DAY);
}

export const SermonSchema = z.object({ lines: z.array(z.string().min(1).max(160)).min(6).max(10) });

export interface Sermon {
  day: number;
  lines: string[];
  source: "claude" | "engine";
  facts: string[];
  kinds: string[];
  hint: Hint | null;
}

const RULES = `
YOU ARE THE PARISH PRIEST OF THE CATHEDRAL OF OUR LADY IN ANTWERP, 1873, in the pulpit at Sunday high mass.
Write the sermon: 6 to 10 short lines, spoken one after the other, each one or two sentences.
- About the week's sins and scandals in the town, from the FACTS below only (thefts, quarrels, drink, a fire as a
  warning of how quickly all is ash, families leaving for America). Warn, exhort, console; stern but fatherly, a
  touch of dry wit. Begin by addressing the faithful; end with a blessing or "Amen".
- Never name any person, of the town or of the world: speak of "a household", "certain men", "a young woman".
  If there is a HINT, you may speak of "a young man on the quays" once, as the HINT says; never any other name.
- Never call for anyone to be punished, driven out, beaten or harmed; judgement is God's. No politics, no king,
  no government, no other faith attacked.
- No sums of money, no numbers in figures, no Latin. Tame and fit for children in the front rows.
${"Language: plain English. Dutch only in the names of places and for jenever."}`;

const OPENINGS = ["My brothers and sisters in Christ, this week our town has given the devil good sport.", "Beloved in the Lord, I have heard more this week than a priest likes to hear."];
const BY_KIND: Record<string, string> = {
  robbery: "Purses were lifted in our open streets. Thou shalt not steal: it was not written for the rich alone.",
  scuffle: "Neighbours raised their voices and their hands in the market. Anger is a fire in a wooden house; do not feed it.",
  drink: "The taverns did good trade and the families bad. Jenever warms the belly for an hour and chills the home for a week.",
  fire: "A house burned in our streets. Let it remind you how quickly all we hold can turn to ash, and look to your souls as to your chimneys.",
  liner: "Families left us for America on the great ship. Pray for them on the sea, and may they keep the faith in a strange land.",
  emigrants: "Strangers wait on our quays with their chests for the ship. Be kind to them; the Holy Family too were travellers.",
  funeral: "We buried one of our own this week. Remember that none of us knows the hour.",
  wedding: "Two young people were joined at this altar. Honour the vows you make here; they are heavier than they look.",
  rumour: "And the town has talked, as it always talks. Hold your tongues, for the tongue is a small thing that sets great fires.",
  event: "The squares were full of noise and show this week. Remember that the Sabbath is kept in the heart, not only in church.",
};
const HINT_LINE: Record<Hint["kind"], string> = {
  warn: "And I hear talk of a young man on the quays. Talk is not proof, but let him look to his conduct, for the Lord sees what the quays do not.",
  praise: "I hear too of a young man on the quays who did a kindness where none was owed. Go and do likewise.",
};
const FILLER = [
  "Keep the Sabbath holy, and your hands in your own pockets.",
  "Work honestly, drink little, and remember the poor at your door.",
  "Honour your father and your mother, even when they are wrong.",
  "The fog comes up the Schelde every morning, and still the ships find their way. So may you.",
  "Put a little by for the winter, and a little more for the poor box.",
];
const CLOSING = "Go in peace, and may Our Lady keep the fog from your hearts. Amen.";

/** The engine's sermon: always there, from the same facts and hint. */
export function fallbackSermon(facts: Fact[], hint: Hint | null, day: number): string[] {
  const lines = [OPENINGS[day % OPENINGS.length]];
  for (const f of facts) if (BY_KIND[f.kind] && !lines.includes(BY_KIND[f.kind])) lines.push(BY_KIND[f.kind]);
  if (hint) lines.push(HINT_LINE[hint.kind]);
  for (const f of FILLER) if (lines.length < 5) lines.push(f);
  return [...lines.slice(0, 9), CLOSING];
}

/** The model's sermon, checked: one line that names someone, calls for harm or is rough, and it is the engine's. */
export function cleanSermon(db: DB, lines: string[], facts: Fact[], hint: Hint | null): string[] | null {
  // names: the game's own, faith and places (the rules ask it to name nobody; no stranger's name gets through)
  const allowed = allowedNames(db, []);
  for (const w of plainWords(lines)) allowed.add(w);
  for (const f of facts) for (const w of f.text.toLowerCase().match(/[a-z'-]+/g) ?? []) if (["america", "kempenland", "schelde"].includes(w)) allowed.add(w);
  const out: string[] = [];
  for (const l of lines) {
    if (/\bJef\b/.test(l)) return null;
    // the young man on the quays only when the engine says the town talks of him
    if (!hint && /\byoung man on the quays?\b/i.test(l)) return null;
    const t = cleanVerse(l, allowed, 160);
    if (!t) return null;
    out.push(t);
  }
  return out.length >= 6 ? out : null;
}

const key = (day: number) => `sermon:${day}`;
let writing: Promise<Sermon> | null = null;

export function sermonOf(db: DB, day: number): Sermon | null {
  return getState<Sermon | null>(db, key(day), null);
}
export function sermonWriting(): boolean {
  return writing !== null;
}

/** This Sunday's sermon: written once (in the background from six on Sunday morning), kept. Null on a weekday. */
export async function writeSermon(db: DB, runner?: Runner): Promise<Sermon | null> {
  const c = clock(db);
  if (!isSunday(c.day)) return null;
  const have = sermonOf(db, c.day);
  if (have) return have;
  if (writing) return writing;
  writing = (async () => {
    const facts = sermonFacts(db);
    const hint = jefHint(db);
    let lines: string[] | null = null;
    if (canCallSermon(db)) {
      const prompt = `FACTS (this week in the town; the game's words):
${facts.length ? facts.map((f) => `- ${f.text}`).join("\n") : "- A quiet week: fog, work on the quays, the taverns."}
${hint ? `\nHINT: the town talks of this: ${hint.said}. You may hint at "a young man on the quays" (${hint.kind === "warn" ? "a warning" : "a word of praise"}), never a name.` : "\nNo HINT: do not speak of any young man on the quays."}

NOW
Sunday high mass, ${WEATHER_TEXT[c.weather]} outside, the nave full.`;
      const res = await callClaude(db, { hook: "sermon", system: RULES, prompt, schema: SermonSchema, timeoutMs: callTimeout() }, runner);
      if (res.ok && res.data) {
        lines = cleanSermon(db, res.data.lines, facts, hint);
        if (!lines) console.log(`[sermon] the model's sermon was refused: ${res.data.lines.find((l) => !cleanSermon(db, [l, l, l, l, l, l], facts, hint)) ?? "?"}`);
      } else console.log(`[sermon] no sermon from the model: ${res.error ?? "no answer"}`);
    }
    const s: Sermon = { day: c.day, lines: lines ?? fallbackSermon(facts, hint, c.day), source: lines ? "claude" : "engine", facts: facts.map((f) => f.text), kinds: facts.map((f) => f.kind), hint };
    if (!sermonOf(db, c.day)) setState(db, key(c.day), s);
    return sermonOf(db, c.day) ?? s;
  })();
  try {
    return await writing;
  } finally {
    writing = null;
  }
}

// ------------------------------------------------------------------ the congregation

const WHISPERS: Record<string, string> = {
  robbery: "He means the purse that went on the square. I know whose it was.",
  scuffle: "That's for the two at the market, mark my words.",
  drink: "He looked straight at the pew by the pillar when he said jenever.",
  fire: "Ash, he says. My sister still smells of the smoke.",
  liner: "My cousin was on that ship. Not a letter yet.",
  emigrants: "Kind to them, he says. They sleep twelve to a room at the Logement.",
  rumour: "Hold our tongues? Then what would Sunday be for?",
};

export interface SermonView {
  day: number;
  lines: string[];
  source: "claude" | "engine";
  hint: Hint["kind"] | null;
  /** A gossip in the rows whispers to her neighbour (engine words), and those who nod. */
  gossip: { id: string; name: string; to: string | null; text: string } | null;
  nodders: string[];
  heard: boolean;
}

/** For the client: the sermon and the congregation's parts (who whispers, who nods), the engine's choice. */
export function sermonView(db: DB, s: Sermon): SermonView {
  const now = landmarkNow(db, "cathedral");
  const flock = now.people.filter((p) => p.role === "worshipper").map((p) => ({ p, r: resident(db, p.id) }));
  const gossipers = flock.filter((x) => x.r).sort((a, b) => b.r!.stats.gossip - a.r!.stats.gossip);
  const g = gossipers[0];
  const kind = s.hint?.kind === "warn" ? "hint" : s.kinds.find((k) => WHISPERS[k]) ?? null;
  const text = kind === "hint" ? "A young man on the quays? Everybody knows who he means." : kind ? WHISPERS[kind] : "Short today. The roast will not be burnt.";
  const to = g ? (flock.find((x) => x.p.id !== g.p.id && x.p.sex === "f")?.p.id ?? flock.find((x) => x.p.id !== g.p.id)?.p.id ?? null) : null;
  const nodders = flock.filter((x) => x.r && x.r.stats.piety >= 6 && x.p.id !== g?.p.id).slice(0, 8).map((x) => x.p.id);
  return {
    day: s.day,
    lines: s.lines,
    source: s.source,
    hint: s.hint?.kind ?? null,
    gossip: g ? { id: g.p.id, name: g.p.first, to, text } : null,
    nodders,
    heard: !!getState(db, `sermon:heard:${s.day}`, false),
  };
}

// ------------------------------------------------------------------ Jef in the nave: the kerk's trust

/**
 * The sermon has ended with Jef inside the cathedral. The engine's rule, once a Sunday: trust
 * with the kerk -1 if the sermon warned of the young man on the quays, else +1; 0 to 10.
 */
export function hearSermon(db: DB): { delta: number; text: string } {
  const c = clock(db);
  const h = hourNow(db);
  const s = sermonOf(db, c.day);
  const mass = massAt(c.day, h);
  // the sermon may run a little past the end of high mass
  const inHigh = (mass?.kind === "high") || (isSunday(c.day) && h >= 9 && h < 11.5);
  if (!s || !isSunday(c.day) || !inHigh) return { delta: 0, text: "" };
  if (jefInside() !== "cathedral") return { delta: 0, text: "" };
  const k = `sermon:heard:${c.day}`;
  if (getState(db, k, false)) return { delta: 0, text: "" };
  setState(db, k, true);
  const delta = s.hint?.kind === "warn" ? -1 : 1;
  db.prepare("UPDATE faction_trust SET trust = MAX(-5, MIN(10, trust + ?)) WHERE faction = 'kerk'").run(delta);
  const text =
    delta < 0
      ? "Heads turn along the rows toward you. Somebody tuts. The church will remember that you were here, and what was said."
      : "The priest's eye rests on you a moment from the pulpit, and he nods. The church takes note of a new face at mass.";
  log(db, "heard_sermon", "kerk", delta < 0 ? "Jef was at high mass when the priest warned of a young man on the quays; heads turned." : "Jef heard the Sunday sermon at high mass in the cathedral.");
  return { delta, text };
}

/** Once on Sunday, after high mass: the sermon goes in the log (the engine's words, never the model's). */
export function logSermon(db: DB): void {
  const c = clock(db);
  if (!isSunday(c.day) || hourNow(db) < 11) return;
  const s = sermonOf(db, c.day);
  if (!s || getState(db, `sermon:logged:${c.day}`, false)) return;
  setState(db, `sermon:logged:${c.day}`, true);
  const WORDS: Record<string, string> = { robbery: "theft", scuffle: "quarrels", drink: "drink", fire: "the fire", liner: "the emigrants leaving", emigrants: "the strangers on the quays", rumour: "gossip", funeral: "death", wedding: "marriage", event: "the Sabbath" };
  const topics = [...new Set(s.kinds.map((k) => WORDS[k]).filter(Boolean))];
  writeEvent(db, {
    kind: "event",
    verb: "sermon",
    place: "cathedral",
    text: `At high mass the parish priest preached ${topics.length ? `on ${topics.join(", ")}` : "on keeping the Sabbath"}${s.hint?.kind === "warn" ? ", and warned of a young man on the quays" : ""}.`,
    weight: 3,
  });
}
