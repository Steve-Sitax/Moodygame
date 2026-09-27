import { z } from "zod";
import { gameGeneration, type DB } from "../db.ts";
import { POESJE_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { pid } from "../player/current.ts";
import { pstate, setPstate } from "../player/multi.ts";
import { LANGUAGE_RULE } from "../text.ts";
import { activityAt } from "../town/schedule.ts";
import { town } from "../town/store.ts";
import { houseDoors } from "../town/walkmap.ts";
import INWORLD from "../../../shared/inworld_houses.json" with { type: "json" };

/** M7: the house whose cellar stands in the world (shared/inworld_houses.json); preferred when it is free. */
const INWORLD_CELLAR = (INWORLD as { houses: Array<{ kind: string; house: number }> }).houses.find((e) => e.kind === "cellar")?.house ?? -1;
import { writeEvent, type WorldEvent } from "../director/eventlog.ts";
import { callTimeout, canCallShare, getState, hourNow, setState } from "./state.ts";
import { cleanLine } from "./tavern.ts";

// The Poesje (M6): Antwerp's puppet cellar. From 1862 the best known of them played in a
// cellar in the Repenstraat, by the Vleeshuis, for dockers, sailors and children, for a
// few cents, in rough Antwerp talk, with rod puppets: De Neus (the big-nosed lead, the
// "Poesje" everyone came for) and De Schele (cross-eyed, stuttering, wiser than he looks).
// Here the cellar door is opposite the Vleeshuis. Every evening a short play: the ENGINE
// picks one to three facts from the event log (the director's events, robberies, the
// police, what Jef did, the weather); the model writes six to ten lines about them
// (hook poesje_show, its own share); late, wrong, rough or over budget: the engine's play.
// Admission is an engine price, paid at the door.

export const POESJE = {
  /** The door opens at half past six; the play runs from seven to ten; the last are let in at ten. */
  doorOpens: 18.5,
  showFrom: 19,
  showTo: 22,
  price_c: 5,
  /** Opposite the Vleeshuis (the Repenstraat of our compact map). */
  anchor: { x: -120, z: 82 },
  label: "the Poesje",
} as const;

export const POESJE_HOOKS = ["poesje_show"];
export function canCallPoesje(db: DB): boolean {
  return canCallShare(db, POESJE_HOOKS, POESJE_CALLS_PER_DAY);
}

export interface PoesjeDoor {
  house: number;
  x: number;
  z: number;
  out: [number, number];
  /** The step outside, on reachable ground. */
  sx: number;
  sz: number;
}

/** The cellar door: the house door nearest the anchor that no shop or tavern has. Kept once found. */
export function poesjeDoor(db: DB): PoesjeDoor | null {
  const kept = getState<PoesjeDoor | null>(db, "poesje:door", null);
  if (kept) return kept;
  const taken = Object.values(town(db).town.places)
    .filter((p) => p.door)
    .map((p) => p.door!);
  const free = houseDoors().filter((h) => !taken.some(([x, z]) => Math.hypot(x - h.sx, z - h.sz) < 3));
  const d =
    free.find((h) => h.house === INWORLD_CELLAR) ??
    free.map((h) => ({ h, k: Math.hypot(h.sx - POESJE.anchor.x, h.sz - POESJE.anchor.z) })).sort((a, b) => a.k - b.k)[0]?.h;
  if (!d) return null;
  const door: PoesjeDoor = { house: d.house, x: d.x, z: d.z, out: d.out, sx: d.sx, sz: d.sz };
  setState(db, "poesje:door", door);
  return door;
}

/** Can Jef go down now? From half past six to ten in the evening. */
export function doorOpen(db: DB): boolean {
  const h = hourNow(db);
  return h >= POESJE.doorOpens && h < POESJE.showTo;
}

// ---------------------------------------------------------------- the play

export const PUPPETS = ["neus", "schele", "third"] as const;
export const PlaySchema = z.object({
  title: z.string().min(1).max(60),
  /** Who the third puppet is tonight ("the Agent", "a Pickpocket", "Jef the farm boy"). */
  third: z.string().min(1).max(30),
  lines: z.array(z.object({ who: z.enum(PUPPETS), text: z.string().min(1).max(150) })).min(6).max(10),
});
export type Play = z.infer<typeof PlaySchema>;

export interface Show {
  day: number;
  play: Play;
  source: "claude" | "engine";
  facts: string[];
  /** A fact about Jef was in it: he may see himself mocked. */
  aboutJef: boolean;
}

const DULL = new Set(["bought", "drank", "ate", "talked", "convo", "gossip", "diced", "warmed", "paid_show", "poesje_show", "arrived", "job_board", "said_strange", "took_job"]);

interface Fact {
  text: string;
  jef: boolean;
}

/**
 * The engine's pick for tonight: the weightiest things of the last two days, the town's
 * events first, then robberies and the police, then Jef's doings; at most three, never two
 * of the same verb. The weather is the filler, so there is always one.
 */
export function showFacts(db: DB, max = 3): Fact[] {
  const c = clock(db);
  const rows = db
    .prepare("SELECT * FROM world_event WHERE day >= ? AND weight >= 3 ORDER BY id DESC LIMIT 120")
    .all(c.day - 1) as WorldEvent[];
  const score = (e: WorldEvent) =>
    e.weight + (e.kind === "event" ? 3 : 0) + (e.kind === "theft" || e.kind === "police" ? 2 : 0) + (e.actor === "player" ? 2 : 0) + (e.day === c.day ? 1 : 0);
  const out: Fact[] = [];
  const verbs = new Set<string>();
  for (const e of rows.filter((r) => !DULL.has(r.verb)).sort((a, b) => score(b) - score(a) || b.id - a.id)) {
    if (out.length >= max) break;
    if (verbs.has(e.verb)) continue;
    verbs.add(e.verb);
    out.push({ text: e.text, jef: e.actor === "player" || /\bJef\b/.test(e.text) });
  }
  if (out.length < max) out.push({ text: `The weather today: ${WEATHER_TEXT[c.weather]}.`, jef: false });
  return out;
}

const PLAY_RULES = `
YOU NOW WRITE TONIGHT'S SHORT PLAY FOR THE POESJE, Antwerp's puppet cellar by the Vleeshuis, 1873.
The audience: dockers, sailors, their children, a few urchins. Rod puppets half a man high. Three puppets:
- neus: De Neus, the Poesje, the big-nosed loudmouth, boastful, quick with his stick.
- schele: De Schele, cross-eyed, stammers (a letter or two doubled, like "b-b-but"), slower but the wiser.
- third: one more figure you name in "third" (a short title: "the Agent", "a Pickpocket", "Jef the Farm Boy", "the Bride").
Write 6 to 10 lines, taking turns, about the FACTS below, which really happened in town lately: turn them into
rough, funny puppet business, get things wrong on purpose, mock the proud and the police a little, and end on a
punchline and a knock of the stick. Jef may be mocked if a fact is about him.
Keep it tame: no oaths, no cruelty, nobody dies, nothing about religion, no sums of money or numbers.
Each line one or two short sentences. The title at most six words.
${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

const TITLES = ["The Fog Over the Schelde", "Neus and the Lost Purse", "A Wedding Gone Wrong", "Schele Goes to Sea", "Who Stole the Herring?"];

/** The engine's play: always there, built from the same facts. */
export function fallbackPlay(facts: Fact[], day: number): Play {
  const f = facts.map((x) => x.text.replace(/\.$/, ""));
  const jef = facts.some((x) => x.jef);
  const lines: Play["lines"] = [
    { who: "neus", text: "Dockers, sailors and small fry! Hats off, noses up, the Poesje is on!" },
    { who: "schele", text: "N-n-news, Neus? I heard some. I think." },
    { who: "neus", text: `Heard? I saw it with my own nose. ${f[0]}.` },
    { who: "third", text: jef ? "It wasn't like that at all! I only came to town for work!" : "Lies! It was nothing of the sort!" },
    { who: "schele", text: "Th-that's not how it went, Neus. It went w-worse." },
  ];
  if (f[1]) lines.push({ who: "neus", text: `And that's not all. ${f[1]}.` }, { who: "third", text: "I'll have the police on the lot of you!" });
  lines.push({ who: "neus", text: "The police? They're in the tavern with the rest of us!" }, { who: "schele", text: "Then g-g-give him the stick, Neus. Gently." }, { who: "neus", text: "Gently it is. Knock! And good night to you all!" });
  return { title: jef ? "Jef the Farm Boy Comes to Town" : TITLES[day % TITLES.length], third: jef ? "Jef the Farm Boy" : "a Know-all", lines: lines.slice(0, 10) };
}

/** The model's play, checked: every line tame and plain, a third that is a short title. */
export function cleanPlay(p: Play): Play | null {
  const title = cleanLine(p.title, 60);
  const third = cleanLine(p.third, 30);
  if (!title || !third) return null;
  const lines: Play["lines"] = [];
  for (const l of p.lines) {
    const t = cleanLine(l.text, 150);
    if (!t) return null;
    lines.push({ who: l.who, text: t });
  }
  return lines.length >= 6 ? { title, third, lines } : null;
}

const showKey = (day: number) => `poesje:show:${day}`;
let writing: Promise<Show> | null = null;

export function showToday(db: DB): Show | null {
  return getState<Show | null>(db, showKey(clock(db).day), null);
}

/** Tonight's play: written once a day (in the background from five in the evening), kept. */
export async function writeShow(db: DB, runner?: Runner): Promise<Show> {
  const have = showToday(db);
  if (have) return have;
  if (writing) return writing;
  writing = (async () => {
    const c = clock(db);
    const facts = showFacts(db);
    const gen = gameGeneration();
    let play: Play | null = null;
    if (canCallPoesje(db)) {
      const prompt = `FACTS (what really happened in town lately; the game's words):
${facts.map((f) => `- ${f.text}`).join("\n")}

TONIGHT
${c.weekday} evening, ${WEATHER_TEXT[c.weather]}.`;
      const res = await callClaude(db, { hook: "poesje_show", system: SYSTEM + "\n" + PLAY_RULES, prompt, schema: PlaySchema, timeoutMs: callTimeout() }, runner);
      if (res.ok && res.data) play = cleanPlay(res.data);
    }
    const show: Show = { day: c.day, play: play ?? fallbackPlay(facts, c.day), source: play ? "claude" : "engine", facts: facts.map((f) => f.text), aboutJef: facts.some((f) => f.jef) };
    // the day may have turned while it was written: it belongs to the day it was begun
    // and a new game begun meanwhile does not get the old week's play
    if (gameGeneration() === gen && !getState(db, showKey(c.day), null)) setState(db, showKey(c.day), show);
    return show;
  })();
  try {
    return await writing;
  } finally {
    writing = null;
  }
}

/** Is a play being written right now? */
export function showWriting(): boolean {
  return writing !== null;
}

// ---------------------------------------------------------------- the audience and the door

/**
 * Tonight's audience, picked by the engine: children and working men of the town who are
 * free at eight in the evening (at home or about, not at work, not in a tavern). Up to 14.
 */
export function audience(db: DB): string[] {
  const c = clock(db);
  const want = new Set(["child", "street_child", "errand_boy", "docker", "natie", "sailor", "boatman", "porter"]);
  const free = town(db).town.residents.filter((r) => {
    if (!want.has(r.trade) || r.age < 6) return false;
    const act = activityAt(r.sched, c.day, 20).act;
    return act === "home" || act === "play" || act === "loiter";
  });
  // the same evening, the same faces; another evening, others
  const h = (s: string) => {
    let x = c.day * 7919;
    for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return x;
  };
  const sorted = free.sort((a, b) => h(a.id) - h(b.id));
  const kids = sorted.filter((r) => r.age < 16).slice(0, 6);
  const men = sorted.filter((r) => r.age >= 16).slice(0, 14 - kids.length);
  return [...kids, ...men].map((r) => r.id);
}

/**
 * Down the steps: pay at the door (an engine price, once an evening; back in the same
 * evening is free). Watching makes a line in the event log; a play that mocked Jef is
 * remembered by a few of the audience.
 */
export function admit(db: DB): { paid_c: number; line: string } {
  if (!doorOpen(db)) throw new GameError("the cellar door is shut; the Poesje plays from seven in the evening", 409);
  const day = clock(db).day;
  const paidKey = `poesje:paid:${day}`;
  // (M8c: each player pays at the door once an evening)
  if (pstate(db, paidKey)) return { paid_c: 0, line: "The woman at the door knows your face and waves you down the steps." };
  if (player(db).money_c < POESJE.price_c) throw new GameError(`not enough money: ${POESJE.price_c} c to go down`, 409);
  const show = showToday(db);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(POESJE.price_c, pid());
    setPstate(db, paidKey, true);
    log(db, "paid_show", "poesje", `Jef paid ${POESJE.price_c} centimes to see the Poesje.`);
  })();
  if (show) {
    writeEvent(db, { kind: "event", verb: "poesje_show", place: "poesje", text: `The Poesje played "${show.play.title}" in the cellar by the Vleeshuis; Jef was in the audience.`, weight: show.aboutJef ? 4 : 2 });
    if (show.aboutJef)
      for (const id of audience(db).slice(0, 4))
        remember(db, id, `At the Poesje they made fun of Jef, the farm boy: "${show.play.title}". He was sitting right there.`, 3, "seen", null, { gist: "Jef was made fun of at the Poesje", tone: 0 });
  }
  return { paid_c: POESJE.price_c, line: `You pay ${POESJE.price_c} centimes to the woman at the door and go down the steps into the smoke.` };
}
