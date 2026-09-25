import { z } from "zod";
import type { DB } from "../db.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, CONVO_CALLS_PER_DAY, RESIDENT_CALLS_PER_DAY, SURPRISE_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, DAY_NAMES, WEATHER_TEXT } from "../day.ts";
import { log, player } from "../game.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { applyTrust, remember } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { gameMinute } from "../town/deeds.ts";
import { shownTrade, TRADES } from "../town/places.ts";
import type { Resident } from "../town/population.ts";
import { withinFact } from "../town/rumours.ts";
import type { Seg } from "../town/schedule.ts";
import { resident, town } from "../town/store.ts";
import { nowOf, talkExtras, type ExtraTopic } from "../town/talk.ts";
import { AWAY, FORTUNE_ID, isAwayVisitor, saveVisitor, STRANGER_KINDS, strangerId, visitorOf, type StrangerKind, type VisitorResident } from "../town/visitors.ts";
import { actionHooks, actionOf, activeActions, isReserved, jefAt, posOf, reserveSnap, startAction, type ActionRow, type ReserveSnap } from "./actions.ts";
import { bus } from "./bus.ts";
import { publishConvo, type ConvoLine } from "./convo.ts";
import { eventSlice, writeEvent } from "./eventlog.ts";
import { startSeek } from "./families.ts";
import { VIOLENCE_RE } from "./vocab.ts";

// The AI unpredictability pack (M6, docs/milestones/M6-plan.md). The ENGINE owns every number
// and every outcome; the model words things (schema, 20 s, a fallback every time).
// 1. Madame Zelie, the fortune teller: for 5 centimes the cards, AI words from Jef's recent days.
//    The prophecy is a hidden PROMISE (a meeting, a loss, a gift, a stranger); the director is told
//    to bring it about within a day or two, and the engine keeps it itself if nobody does.
// 2. Strangers off the ships: now and then one arrives (the engine picks the kind; the model gives
//    the name, the story, the goal, the secret), stays 1 to 3 days, walks the town, talks, may ask
//    Jef to run an errand (the engine builds it and pays it), then leaves.
// 3. Schemes: each morning the engine gives two or three residents a small business of their own
//    (a lost dog, a debt, a courtship, a grudge); it plays as an M4 walk and a talk, Jef may help.
// 4. Rumours that twist: once a day the model rewords a few fresh tellings; each is checked against
//    the fact (town/rumours.ts withinFact) and the fact itself is never changed.
// 5. Dreams: at night a short dream from Jef's day (no effect on any number).

const SURPRISE_HOOKS = ["stranger_arrive", "rumour_twist", "dream"];

export function canCallSurprise(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare(`SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook IN (${SURPRISE_HOOKS.map(() => "?").join(", ")})`).get(day, ...SURPRISE_HOOKS) as { n: number }).n;
  return mine < SURPRISE_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}
function canCallResident(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook LIKE 'resident%'").get(day) as { n: number }).n;
  return mine < RESIDENT_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}
function canCallConvo(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook = 'npc_convo'").get(day) as { n: number }).n;
  return mine < CONVO_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

function st<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return fallback;
  const v = JSON.parse(row.value_json) as T | null;
  if (v === null || typeof v !== "object") return fallback;
  return fallback && typeof fallback === "object" ? ({ ...fallback, ...v } as T) : v;
}
function setSt(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

/** Model words that must not stand: a weapon, a killing, a sum of money. */
function clean(t: string, max = 300): string | null {
  const s = plainEnglish(t).trim();
  if (!s || VIOLENCE_RE.test(s)) return null;
  if (/\b\d+\s*(centimes?|francs?)\b/i.test(s)) return null;
  return s.slice(0, max);
}

/** What Jef lived through lately, engine words (for the cards and the dream). */
function jefsDays(db: DB, limit = 12): string[] {
  return eventSlice(db, { limit: 40, maxChars: 4000 })
    .filter((l) => /\bJef\b/.test(l) && !/\[director\]/.test(l))
    .slice(-limit);
}

// ================================================================== 1. the fortune teller

export const FORTUNE_C = 5;
export const PROMISE_KINDS = ["meeting", "loss", "gift", "stranger"] as const;
export type PromiseKind = (typeof PROMISE_KINDS)[number];
/** A loss the cards promised: at most this much, the engine's. */
export const PROMISE_LOSS_C = 5;

export interface Promise_ {
  day: number;
  kind: PromiseKind;
  text: string;
  /** The last day it may come true. */
  due: number;
  /** pending: paid, the words still being written; keeping: the engine is bringing it about now. */
  status: "open" | "kept" | "lapsed" | "pending" | "keeping";
  how?: string;
}
export function promiseOf(db: DB): Promise_ | null {
  const p = st<Promise_ | null>(db, "fortune_promise", null);
  return p && p.kind ? p : null;
}

export const FortuneSchema = z.object({
  prophecy: z.string().min(10).max(320),
  promise: z.enum(PROMISE_KINDS),
});

const FORTUNE_RULES = `
YOU NOW SPEAK AS MADAME ZELIE, an old fortune teller with a little table and a pack of worn cards on the Grote Markt, 1873.
- Jef has paid for his fortune. Read it from the cards and from what he lived through lately (below): vague, a little eerie,
  kind underneath, two to four short sentences in your own voice, as you turn the cards.
- promise: the one thing your fortune foretells for the next day or two: meeting (someone will come to him), loss (he will lose
  something small), gift (someone will give him something), or stranger (a stranger will cross his path). Hint at it; never
  name a person, a day or a sum.
- No weapons, no death, nobody hurt. ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

const FORTUNE_FALLBACK: Record<PromiseKind, string> = {
  meeting: "The Knave of Hearts, and next to him the road. Someone is looking for you, my dear. Let them find you.",
  loss: "The Five of Spades, upside down. Hold on to what is yours; something small slips away before long. Don't grieve it.",
  gift: "The Ace of Hearts. An open hand. Before two days are out, somebody gives you something you did not ask for.",
  stranger: "The Knight of Cups, come over the water. A stranger will know your name soon, and you his.",
};

/** Madame Zelie's lines for Jef (talk.ts talkExtras): the cards, once a day, when she is at her table. */
function fortuneTopics(db: DB, r: Resident): ExtraTopic[] {
  if (r.id !== FORTUNE_ID || nowOf(db, r).act !== "work") return [];
  const had = promiseOf(db);
  if (had && had.day === clock(db).day) return [];
  return [{ choice: `Read my fortune. (${FORTUNE_C} centimes)`, answer: (db2) => tellFortune(db2) }];
}

/** The cards: the engine takes the coin, the model words it, the engine keeps the promise. */
export async function tellFortune(db: DB, runner?: Runner, rng: () => number = Math.random): Promise<{ text: string; trust?: number }> {
  const p = player(db);
  let kind: PromiseKind = PROMISE_KINDS[Math.floor(rng() * PROMISE_KINDS.length)];
  let text = FORTUNE_FALLBACK[kind];
  // the coin and today's mark in one go, before the model call: a second click the same day pays nothing
  const paid = db.transaction((): "ok" | "poor" | "done" => {
    const today = clock(db).day;
    const had = promiseOf(db);
    if (had && had.day === today) return "done";
    if (player(db).money_c < FORTUNE_C) return "poor";
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(FORTUNE_C);
    log(db, "fortune", FORTUNE_ID, `Jef paid Madame Zelie ${FORTUNE_C} centimes to read his fortune.`);
    setSt(db, "fortune_promise", { day: today, kind, text, due: today + 2, status: "pending" } satisfies Promise_);
    return "ok";
  })();
  if (paid === "poor") return { text: "No coin, no cards, my dear. The cards are hungry too." };
  if (paid === "done") return { text: "The cards have spoken for today, my dear. Come back tomorrow." };
  let source = "engine";
  if (canCallResident(db)) {
    const c = clock(db);
    const prompt = `NOW
${c.weekday}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}.

JEF, AS THE TOWN SAW HIM LATELY (engine words, oldest first)
${jefsDays(db).join("\n") || "- nothing yet; he is new in town"}

HOW HE LOOKS
${p.money_c < 20 ? "thin purse" : "a few coins"}, ${p.health <= 4 ? "pale and worn" : "well enough"}, ${p.food <= 3 ? "hungry" : "fed"}.`;
    const res = await callClaude(db, { hook: "resident_fortune", system: SYSTEM + "\n" + FORTUNE_RULES, prompt, schema: FortuneSchema }, runner);
    const said = res.ok && res.data ? clean(res.data.prophecy, 320) : null;
    if (res.ok && res.data && said) {
      kind = res.data.promise;
      text = said;
      source = "claude";
    }
  }
  const day = promiseOf(db)?.day ?? clock(db).day;
  setSt(db, "fortune_promise", { day, kind, text, due: day + 2, status: "open" } satisfies Promise_);
  writeEvent(db, { kind: "talk", verb: "fortune", actor: FORTUNE_ID, target: "player", text: `Madame Zelie read Jef's cards (${source}); she foretold ${kind === "meeting" ? "a meeting" : kind === "loss" ? "a small loss" : kind === "gift" ? "a gift" : "a stranger"}.`, weight: 4, data: { promise: kind, text }, who: [FORTUNE_ID] });
  remember(db, FORTUNE_ID, "I read the cards for Jef, the new man. They had something to say.", 4, "seen", null, { gist: "Jef had his fortune told by Madame Zelie", tone: 0 });
  return { text: `She lays out the cards, one by one. ${text}` };
}

/** For the director's prompt: the promise to bring about, in words. */
export function promiseThread(db: DB): string | null {
  const p = promiseOf(db);
  if (!p || p.status !== "open") return null;
  const what = { meeting: "someone will come looking for Jef", loss: "Jef will lose something small", gift: "someone will give Jef something", stranger: "a stranger will cross Jef's path" }[p.kind];
  return `A PROMISE TO KEEP: Madame Zelie's cards told Jef that ${what}, by ${DAY_NAMES[(p.due - 1) % 7]} night. If an event can bring it about near Jef within the rules, make it; the engine keeps it otherwise.`;
}

/**
 * The engine keeps the cards' promise (the director's fallback): now and then from the day after,
 * surely on its last day. Returns how, or null. The loss is at most PROMISE_LOSS_C.
 */
export async function keepPromise(db: DB, opts: { rng?: () => number; runner?: Runner; force?: boolean } = {}): Promise<string | null> {
  const p = promiseOf(db);
  if (!p || p.status !== "open") return null;
  const c = clock(db);
  if (c.day > p.due) {
    setSt(db, "fortune_promise", { ...p, status: "lapsed" });
    return null;
  }
  if (c.hour < 8 || c.hour >= 20) return null;
  const rng = opts.rng ?? Math.random;
  const soon = c.day > p.day || gameMinute(db) - ((p.day - 1) * 1440) > 14 * 60;
  const last = c.day === p.due && c.hour >= 14;
  if (!opts.force && !last && !(soon && rng() < 0.3)) return null;
  // marked before any await: a second tick meanwhile finds it not open and leaves it be
  setSt(db, "fortune_promise", { ...p, status: "keeping" } satisfies Promise_);
  let how: string | null = null;
  try {
    how = await bringAbout(db, p, rng, opts.runner);
  } finally {
    const now = promiseOf(db);
    if (!how && now?.status === "keeping" && now.day === p.day) setSt(db, "fortune_promise", p);
  }
  const cur = promiseOf(db);
  if (!how || cur?.status !== "keeping" || cur.day !== p.day) return null;
  setSt(db, "fortune_promise", { ...p, status: "kept", how });
  writeEvent(db, { kind: "director", verb: "promise_kept", text: `The cards' promise came true: ${how}.`, weight: 3 });
  return how;
}

/** keepPromise's part that does it: who comes, what is lost, which stranger. null: not today. */
async function bringAbout(db: DB, p: Promise_, rng: () => number, runner?: Runner): Promise<string | null> {
  let how: string | null = null;
  const jef = jefAt();
  const near = (r: Resident) => {
    const at = posOf(db, r.id);
    return !!jef && !!at && !at.indoors && Math.hypot(at.x - jef.x, at.z - jef.z) < 200;
  };
  const snap = reserveSnap(db);
  const free = (r: Resident) => r.age >= 18 && !snap.acting.has(r.id) && !isReserved(db, r.id, snap) && r.trade !== "police" && !visitorOf(r);
  switch (p.kind) {
    case "meeting":
    case "gift": {
      const pool = town(db).town.residents.filter((r) => free(r) && near(r) && r.stats.warmth >= (p.kind === "gift" ? 5 : 6) && (p.kind !== "gift" || hasFood(db, r)));
      const r = pool[Math.floor(rng() * pool.length)];
      if (!r) return null;
      startSeek(db, r.id, p.kind === "gift" ? "gift" : "meet", { reason: "the cards said so" });
      how = `${r.name} went to find Jef`;
      break;
    }
    case "loss": {
      const money = player(db).money_c;
      const lost = Math.min(PROMISE_LOSS_C, money);
      if (lost > 0) {
        db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(lost);
        log(db, "lost", null, `A coin slipped through a hole in Jef's coat pocket: ${lost} centimes.`);
        bus.broadcast({ type: "families", say: `Your pocket feels lighter. A coin has slipped through a hole in the lining: ${lost} centimes gone.`, jobs: true });
        how = `lost ${lost} centimes`;
      } else how = "lost nothing he had";
      break;
    }
    case "stranger": {
      const here = strangersHere(db);
      if (!here.length) {
        const s = await arriveStranger(db, { runner, rng });
        how = s ? `${s.name} arrived` : null;
      } else how = `${here[0].name} is in town`;
      // the stranger comes to find Jef (the meeting the cards spoke of)
      const s = how && jef ? strangersHere(db)[0] : null;
      if (s && !actionOf(db, s.id)) startSeek(db, s.id, "meet", { reason: "the cards said so" });
      break;
    }
  }
  return how;
}

/** A gift comes from their own wares (families.ts giveGift): someone who sells food. */
function hasFood(_db: DB, r: Resident): boolean {
  return ["baker", "grocer", "fishwife", "market_woman"].includes(r.trade);
}

// ================================================================== 2. strangers off the ships

export const StrangerSchema = z.object({
  first: z.string().min(2).max(20),
  surname: z.string().min(2).max(24),
  origin: z.string().max(40),
  story: z.string().max(220),
  goal: z.string().max(140),
  secret: z.string().max(140),
  greeting: z.string().max(160),
});

const STRANGER_RULES = `
YOU NOW MAKE A STRANGER WHO HAS JUST COME TO ANTWERP, autumn 1873, off a ship or the Brussels road. The KIND is fixed below.
- first, surname: a name that fits where they come from (Holland, England, Germany, France, Norway, the Walloon country, the
  Kempen). origin: that town or country. Never a famous person.
- story: two short sentences, who they are and why they came. goal: what they want in Antwerp, small and concrete.
- secret: one thing they hide (not a crime of blood). greeting: the first thing they say to a young man who stops them.
- No weapons, no killing. ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

const STRANGER_FALLBACK: Record<StrangerKind, { first: string; surname: string; origin: string; story: string; goal: string; secret: string; greeting: string }> = {
  sailor: { first: "Jan", surname: "Hovinga", origin: "Harlingen", story: "A deck hand off a Dutch coaster, paid off at the Rijnkaai with a week to spare. He has been to Riga and back and talks of it.", goal: "to find word of his brother, a boatman on the Schelde", secret: "He jumped his last ship owing the mate money.", greeting: "You're local? Then you'll know the boatmen. I'm looking for one." },
  merchant: { first: "Arthur", surname: "Pembury", origin: "Hull", story: "A coffee merchant from Hull, come to see the new docks with his own eyes. He writes everything in a little book.", goal: "to find a chandler or grocer who will buy coffee by the sack", secret: "His firm is nearly bankrupt; this trip is his last chance.", greeting: "Good day. A town of warehouses, this. Who buys here, and who only talks?" },
  runaway: { first: "Marie", surname: "Lenoir", origin: "Namur", story: "A girl in service who ran from a hard house in Namur with a bundle and a few francs. She sleeps where she can.", goal: "to find honest work, washing or sewing, where nobody asks questions", secret: "She took her wages from her mistress's drawer before she ran.", greeting: "Please, mister. Is there anyone here who needs a girl for the washing?" },
  preacher: { first: "Elias", surname: "Groenveld", origin: "Utrecht", story: "A travelling preacher of temperance with a Bible worn soft. He has walked from Rotterdam, preaching in every square.", goal: "to be let preach at the church door on Sunday", secret: "He drank himself out of a good living ten years ago.", greeting: "Peace be with you, young man. Tell me: do the dockers here drink as hard as they say?" },
  gambler: { first: "Lucien", surname: "Dufresne", origin: "Lille", story: "A smooth man in a good coat gone thin, off the Ostend steamer. He shuffles a pack of cards without looking.", goal: "to find a back room and a few men with money for a game of cards tonight", secret: "His cards are marked, and he is known in Ghent for it.", greeting: "Ah, a face with sense in it. Tell me, where do men play cards in this town?" },
};

/** Where each kind spends a day in town (engine). */
const STRANGER_DAY: Record<StrangerKind, Seg[]> = {
  sailor: [[8, 11, "loiter", "rijnkaai"], [11, 14, "stroll", "play:vismarkt"], [14, 17, "loiter", "steenplein"], [17.5, 22.5, "tavern", "tavern:ankere"]],
  merchant: [[8.5, 12, "stroll", "play:grote_markt"], [12, 13, "tavern", "tavern:engel"], [13, 17, "loiter", "rijnkaai"], [18, 21, "stroll", "play:grote_markt"]],
  runaway: [[8, 12, "loiter", "steenplein"], [12, 16, "loiter", "play:vismarkt"], [16, 19, "loiter", "werf"]],
  preacher: [[9, 12, "loiter", "play:grote_markt"], [13, 17, "loiter", "play:vismarkt"], [17, 19, "stroll", "steenplein"]],
  gambler: [[10, 14, "stroll", "play:vismarkt"], [14, 18, "loiter", "steenplein"], [18, 23.5, "tavern", "tavern:schipke"]],
};

/** The errand a stranger may ask of Jef: whom to find (trades, in order), and what to ask. */
const ERRAND: Record<StrangerKind, { trades: string[]; ask: string; yes: string; no: string }> = {
  sailor: { trades: ["boatman", "sailor", "docker"], ask: "whether a boatman called {surname} works the river", yes: "he knows the man, and where he ties up", no: "he never heard the name" },
  merchant: { trades: ["chandler", "grocer", "tobacconist"], ask: "whether they would buy coffee by the sack", yes: "they would, at a fair price", no: "they have coffee enough" },
  runaway: { trades: ["laundress", "seamstress", "housewife"], ask: "whether they need a girl for the washing", yes: "they could use a pair of hands, for board", no: "they have no work to give" },
  preacher: { trades: ["sexton", "priest"], ask: "whether a travelling man may speak at the church door on Sunday", yes: "after the high mass, and briefly", no: "the church door is the church's" },
  gambler: { trades: ["publican"], ask: "whether there is a back room free tonight", yes: "there is, for a price", no: "not for card players" },
};
export const ERRAND_PAY_C = 15;

/**
 * What each kind of stranger wants, fixed by the engine: the errand asks exactly this, so the
 * model's greeting is told to be about it and the goal is the engine's (QA 2026-09-24: Halvor
 * Brekke asked where to sign on for the America ships, and his errand was about a boatman).
 */
const STRANGER_WANTS: Record<StrangerKind, string> = {
  sailor: "word of his brother, a boatman on the Schelde with the same surname as his own",
  merchant: "a chandler or grocer who will buy coffee by the sack",
  runaway: "honest work, washing or sewing, where nobody asks questions",
  preacher: "leave to preach at the church door on Sunday",
  gambler: "a back room at a tavern, and a few men with money, for a game of cards tonight",
};

/** The errand's question with the stranger's own name in it (the sailor's brother has his surname). */
function errandAsk(kind: StrangerKind, s: { surname?: string } | null | undefined): string {
  return ERRAND[kind].ask.replace("{surname}", s?.surname || "Hovinga");
}

export function strangersHere(db: DB): VisitorResident[] {
  return STRANGER_KINDS.map((k) => resident(db, strangerId(k)) as VisitorResident | undefined).filter((r): r is VisitorResident => !!r && !!visitorOf(r)?.here);
}

interface StrangerState {
  last: StrangerKind | null;
  next: number;
}

/** A name the model gave, checked: letters only, capitalised, not already a townsperson's. */
function goodName(db: DB, first: string, surname: string): boolean {
  const ok = (s: string) => /^[A-Z][A-Za-z'À-ſ-]{1,23}( [A-Z][A-Za-z'À-ſ-]{1,23})?$/.test(s) && !VIOLENCE_RE.test(s);
  if (!ok(first) || !ok(surname)) return false;
  const full = `${first} ${surname}`;
  return !town(db).town.residents.some((r) => r.name === full);
}

/** One arrival at a time: a second caller while the model words the first gets nothing. */
let arriving = false;

/** A stranger arrives: the engine picks the kind and the stay; the model words the rest. */
export async function arriveStranger(db: DB, opts: { kind?: StrangerKind; runner?: Runner; rng?: () => number } = {}): Promise<VisitorResident | null> {
  if (arriving) return null;
  arriving = true;
  try {
    return await arriveNow(db, opts);
  } finally {
    arriving = false;
  }
}

async function arriveNow(db: DB, opts: { kind?: StrangerKind; runner?: Runner; rng?: () => number }): Promise<VisitorResident | null> {
  const rng = opts.rng ?? Math.random;
  const s0 = st<StrangerState>(db, "strangers", { last: null, next: 0 });
  const away = STRANGER_KINDS.filter((k) => isAwayVisitor(resident(db, strangerId(k))));
  const pool = away.filter((k) => k !== s0.last);
  const kind = opts.kind && away.includes(opts.kind) ? opts.kind : (pool.length ? pool : away)[Math.floor(rng() * (pool.length || away.length))];
  if (!kind) return null;
  const r = resident(db, strangerId(kind)) as VisitorResident | undefined;
  if (!r) return null;
  let words = STRANGER_FALLBACK[kind];
  let source = "engine";
  if (canCallSurprise(db)) {
    const c = clock(db);
    const res = await callClaude(
      db,
      { hook: "stranger_arrive", system: SYSTEM + "\n" + STRANGER_RULES, prompt: `KIND: ${kind} (${r.sex === "f" ? "a young woman" : "a man"}, about ${r.age}).\nWHAT THEY WANT (fixed by the game; the greeting asks about this and nothing else): ${STRANGER_WANTS[kind]}.\nNOW: ${c.weekday}, ${WEATHER_TEXT[c.weather]}.`, schema: StrangerSchema },
      opts.runner,
    );
    const d = res.ok ? res.data : null;
    if (d && goodName(db, d.first.trim(), d.surname.trim())) {
      const story = clean(d.story, 220);
      const goal = clean(d.goal, 140);
      const secret = clean(d.secret, 140);
      const greeting = clean(d.greeting, 160);
      if (story && goal && secret && greeting) {
        // the goal is the engine's (the errand asks exactly this); the model words the rest
        words = { first: d.first.trim(), surname: d.surname.trim(), origin: plainEnglish(d.origin).slice(0, 40) || words.origin, story, goal: goal && `to find ${STRANGER_WANTS[kind]}`, secret, greeting };
        source = "claude";
      }
    }
  }
  const day = clock(db).day;
  const stay = 1 + Math.floor(rng() * 3);
  const upd: VisitorResident = {
    ...r,
    first: words.first,
    surname: words.surname,
    name: `${words.first} ${words.surname}`,
    origin: words.origin,
    sched: { day: STRANGER_DAY[kind], sunday: STRANGER_DAY[kind] },
    visitor: { ...r.visitor!, here: true, came: day, leaves: day + stay, story: words.story, goal: words.goal, secret: words.secret, greeting: words.greeting, origin: words.origin },
  };
  // a new face: nobody in town knows this one (the place's old memories and trust go)
  db.prepare("DELETE FROM npc_memory WHERE npc_id = ?").run(r.id);
  db.prepare("UPDATE npc_relationship SET trust = 0, affection = 0, respect = 0, fear = 0, times_met = 0, view_of_player = '' WHERE npc_id = ?").run(r.id);
  db.prepare("UPDATE resident SET persona = '' WHERE id = ?").run(r.id);
  saveVisitor(db, upd);
  setSt(db, "strangers", { last: kind, next: day + stay + 1 } satisfies StrangerState);
  setSt(db, `errand:${r.id}`, null);
  writeEvent(db, { kind: "event", verb: "stranger_arrived", actor: r.id, text: `A stranger came to town: ${upd.name} from ${words.origin}, ${upd.visitor!.label.replace(/^a stranger( off the ships)?,? ?/, "")}. ${words.story}`, weight: 4, data: { kind, source, stay }, who: [r.id] });
  bus.broadcast({ type: "families", visitor: publicVisitor(upd) });
  return resident(db, r.id) as VisitorResident;
}

/** A stranger's stay is over: the place is empty again. */
export function leaveStranger(db: DB, id: string): boolean {
  const r = resident(db, id) as VisitorResident | undefined;
  const v = visitorOf(r);
  if (!r || !v?.here) return false;
  const a = actionOf(db, id);
  if (a && a.source !== "event") db.prepare("UPDATE npc_action SET status = 'stopped', outcome = 'left town' WHERE id = ?").run(a.id);
  saveVisitor(db, { ...r, sched: AWAY, visitor: { ...v, here: false } });
  writeEvent(db, { kind: "event", verb: "stranger_left", actor: id, text: `${r.name} left Antwerp${v.goal ? `, ${errandDone(db, id) ? "the errand done" : "still wanting " + v.goal}` : ""}.`, weight: 3, who: [id] });
  bus.broadcast({ type: "families", visitor: publicVisitor(resident(db, id) as VisitorResident) });
  return true;
}

export function publicVisitor(r: VisitorResident) {
  const v = visitorOf(r)!;
  return { id: r.id, name: r.name, first: r.first, label: v.label, here: !!v.here, role: v.role, sched: r.sched, at: r.work.at ?? null };
}

/** Each hour: a stranger may arrive (by day, one at a time), and one whose stay is over leaves. */
export async function strangerTick(db: DB, opts: { runner?: Runner; rng?: () => number } = {}): Promise<string | null> {
  const c = clock(db);
  for (const s of strangersHere(db)) if (c.day > (s.visitor!.leaves ?? 99) || (c.day === s.visitor!.leaves && c.hour >= 16)) leaveStranger(db, s.id);
  if (c.hour < 8 || c.hour >= 17 || strangersHere(db).length) return null;
  const s0 = st<StrangerState>(db, "strangers", { last: null, next: 0 });
  if (c.day < s0.next) return null;
  if ((opts.rng ?? Math.random)() >= 0.2) return null;
  const s = await arriveStranger(db, opts);
  return s?.name ?? null;
}

// ---- the errand (engine-built): find someone, ask, come back

interface Errand {
  stranger: string;
  target: string;
  stage: "asked" | "answered" | "done";
  yes?: boolean;
  pay: number;
}
function errandOf(db: DB, strangerId_: string): Errand | null {
  return st<Errand | null>(db, `errand:${strangerId_}`, null);
}
function errandDone(db: DB, id: string): boolean {
  return errandOf(db, id)?.stage === "done";
}
/** An open errand whose target is this person. */
function errandFor(db: DB, target: string): Errand | null {
  for (const s of strangersHere(db)) {
    const e = errandOf(db, s.id);
    if (e && e.target === target && e.stage === "asked") return e;
  }
  return null;
}

function pickTarget(db: DB, kind: StrangerKind, rng: () => number): Resident | null {
  const want = ERRAND[kind].trades;
  for (const t of want) {
    const pool = town(db).town.residents.filter((r) => r.trade === t && r.age >= 16 && !visitorOf(r) && nowOf(db, r).act !== "home");
    if (pool.length) return pool[Math.floor(rng() * pool.length)];
  }
  for (const t of want) {
    const pool = town(db).town.residents.filter((r) => r.trade === t && r.age >= 16 && !visitorOf(r));
    if (pool.length) return pool[Math.floor(rng() * pool.length)];
  }
  return null;
}

function placeOf(db: DB, r: Resident): string {
  return town(db).town.places[r.work.place]?.label ?? town(db).town.places[r.work.place.replace(/^.*:/, "")]?.label ?? "the town";
}

function strangerTopics(db: DB, r: Resident): ExtraTopic[] {
  const v = visitorOf(r);
  const out: ExtraTopic[] = [];
  if (v?.role === "stranger" && v.here && v.kind) {
    const kind = v.kind;
    const e = errandOf(db, r.id);
    if (!e) {
      out.push({
        choice: "Can I help you with that?",
        answer: (db2) => {
          const t = pickTarget(db2, kind, Math.random);
          if (!t) return { text: "Kind of you. But I'll manage on my own." };
          setSt(db2, `errand:${r.id}`, { stranger: r.id, target: t.id, stage: "asked", pay: ERRAND_PAY_C } satisfies Errand);
          writeEvent(db2, { kind: "action", verb: "errand_given", actor: r.id, target: t.id, text: `${r.name} asked Jef to find ${t.name} and ask ${errandAsk(kind, r)}.`, weight: 3, who: [r.id, t.id] });
          return { text: `Would you? Find ${t.name}, the ${shownTrade(t)}, about ${placeOf(db2, t)}. Ask ${t.sex === "f" ? "her" : "him"} ${errandAsk(kind, r)}. Come back and tell me. ${ERRAND_PAY_C} centimes for your trouble.` };
        },
      });
    } else if (e.stage === "answered") {
      const t = resident(db, e.target);
      out.push({
        choice: `${t?.first ?? "They"} says ${e.yes ? ERRAND[kind].yes : ERRAND[kind].no}.`,
        answer: (db2) => {
          db2.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(e.pay);
          log(db2, "errand_paid", r.id, `${r.name} paid Jef ${e.pay} centimes for an errand.`, r.id);
          setSt(db2, `errand:${r.id}`, { ...e, stage: "done" });
          remember(db2, r.id, `Jef ran my errand in this strange town. An honest lad.`, 6, "seen", null, { gist: `Jef ran an errand for the stranger ${r.name}`, tone: 1 });
          writeEvent(db2, { kind: "job", verb: "errand_done", actor: r.id, text: `Jef brought ${r.name} the answer (${e.yes ? "yes" : "no"}) and was paid ${e.pay} centimes.`, weight: 4, who: [r.id] });
          bus.broadcast({ type: "families", jobs: true });
          return { text: e.yes ? `Is that so! Then my luck has turned. Here, ${e.pay} centimes, as promised.` : `Ah. Well, better to know. Here, ${e.pay} centimes, as promised.`, trust: 1 };
        },
      });
    }
  }
  // the one the errand is for
  const mine = errandFor(db, r.id);
  if (mine) {
    const s = resident(db, mine.stranger) as VisitorResident | undefined;
    const kind = visitorOf(s)?.kind;
    if (s && kind) {
      out.push({
        choice: `A stranger, ${s.name}, sent me. ${cap(errandAsk(kind, s))}?`,
        answer: (db2) => {
          const yes = r.stats.warmth + (10 - r.stats.greed) / 2 + Math.random() * 6 >= 9;
          setSt(db2, `errand:${s.id}`, { ...mine, stage: "answered", yes });
          remember(db2, r.id, `Jef came asking on behalf of a stranger, ${s.name}.`, 3);
          return { text: yes ? `Tell ${s.first}: ${ERRAND[kind].yes.replace(/^they /, "I ").replace(/^he /, "I ")}.` : `Tell ${s.first}: no. ${ERRAND[kind].no.replace(/^they /, "We ").replace(/^he /, "I ")}.` };
        },
      });
    }
  }
  return out;
}
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ================================================================== 3. schemes

export const SCHEME_KINDS = ["lost_dog", "pay_debt", "court", "grudge"] as const;
export type SchemeKind = (typeof SCHEME_KINDS)[number];

interface SchemeRow {
  id: number;
  day: number;
  kind: SchemeKind;
  a: string;
  b: string;
  hour: number;
  text: string;
  status: "planned" | "running" | "done" | "failed";
  outcome: string | null;
  jef_helped: number;
  tries: number;
  data_json: string;
}
export function schemesToday(db: DB): SchemeRow[] {
  return db.prepare("SELECT * FROM town_scheme WHERE day = ? ORDER BY id").all(clock(db).day) as SchemeRow[];
}
function schemeRow(db: DB, id: number): SchemeRow | null {
  return (db.prepare("SELECT * FROM town_scheme WHERE id = ?").get(id) as SchemeRow | undefined) ?? null;
}

const free = (db: DB, r: Resident, snap?: ReserveSnap) => r.age >= 18 && !visitorOf(r) && !isReserved(db, r.id, snap) && r.trade !== "police" && r.work.kind !== "guard" && r.trade !== "infant";

/** The morning's schemes: two or three, the engine's (who, what, when). Returns the rows made. */
export function planSchemes(db: DB, rng: () => number = Math.random): SchemeRow[] {
  const day = clock(db).day;
  if (schemesToday(db).length) return [];
  const snap = reserveSnap(db);
  const all = town(db).town.residents.filter((r) => free(db, r, snap));
  const used = new Set<string>();
  const n = 2 + (rng() < 0.5 ? 1 : 0);
  const kinds = [...SCHEME_KINDS].sort(() => rng() - 0.5).slice(0, n);
  const ins = db.prepare("INSERT INTO town_scheme (day, kind, a, b, hour, text, status, data_json) VALUES (?, ?, ?, ?, ?, ?, 'planned', ?)");
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  const neighbours = (a: Resident) => all.filter((o) => o.id !== a.id && !used.has(o.id) && o.household !== a.household && Math.hypot(o.home.sx - a.home.sx, o.home.sz - a.home.sz) < 90);
  for (const kind of kinds) {
    let a: Resident | undefined;
    let b: Resident | undefined;
    let text = "";
    let data: Record<string, unknown> = {};
    if (kind === "lost_dog") {
      a = pick(all.filter((r) => r.dog && !used.has(r.id)));
      b = a && pick(neighbours(a));
      if (a && b) text = `${a.name} has lost ${a.dog!.name}, the dog, and goes to ask ${b.name} if they have seen it.`;
      if (a) data = { dog: a.dog!.name, look: a.dog!.look };
    } else if (kind === "pay_debt") {
      a = pick(all.filter((r) => !used.has(r.id) && r.stats.honesty >= 5));
      b = a && pick(neighbours(a));
      const sum = 20 + Math.floor(rng() * 9) * 5;
      if (a && b) text = `${a.name} owes ${b.name} ${sum} centimes and means to settle it today.`;
      data = { sum };
    } else if (kind === "court") {
      const single = (r: Resident) => ["single", "lodger", "son", "daughter"].includes(r.family_role) && r.age >= 18 && r.age <= 40;
      a = pick(all.filter((r) => single(r) && !used.has(r.id)));
      b = a && pick(all.filter((o) => single(o) && o.sex !== a!.sex && o.household !== a!.household && Math.abs(o.age - a!.age) <= 8 && !used.has(o.id)));
      if (a && b) text = `${a.name} has an eye on ${b.name}, and means to ask ${b.sex === "f" ? "her" : "him"} to walk out on Sunday.`;
    } else {
      a = pick(all.filter((r) => r.stats.temper >= 6 && !used.has(r.id)));
      b = a && pick(neighbours(a));
      if (a && b) text = `${a.name} has an old grudge against ${b.name} and means to have it out today.`;
    }
    if (!a || !b || !text) continue;
    used.add(a.id);
    used.add(b.id);
    ins.run(day, kind, a.id, b.id, 9 + Math.floor(rng() * 9) + (rng() < 0.5 ? 0.5 : 0), text, JSON.stringify(data));
    writeEvent(db, { kind: "director", verb: "scheme", actor: a.id, target: b.id, text: `A scheme for today: ${text}`, weight: 2, who: [a.id, b.id] });
  }
  return schemesToday(db);
}

/** Every tick: a scheme whose hour has come starts (a walk and a talk); one that never could fails at 20:00. */
export function schemeTick(db: DB): number {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  let started = 0;
  for (const s of schemesToday(db).filter((x) => x.status === "planned")) {
    if (h < s.hour) continue;
    if (h >= 20) {
      db.prepare("UPDATE town_scheme SET status = 'failed', outcome = 'never came to it' WHERE id = ?").run(s.id);
      continue;
    }
    const a = resident(db, s.a);
    const b = resident(db, s.b);
    if (!a || !b) continue;
    const pb = posOf(db, b.id);
    if (actionOf(db, a.id) || isReserved(db, a.id) || !pb || pb.indoors) {
      db.prepare("UPDATE town_scheme SET tries = tries + 1 WHERE id = ?").run(s.id);
      continue;
    }
    startAction(db, { npc_id: a.id, kind: "talk_to", target: b.id, target_x: pb.x, target_z: pb.z, source: "engine", minutes: 50, reason: s.kind.replace("_", " "), data: { purpose: "scheme", scheme: s.id } });
    db.prepare("UPDATE town_scheme SET status = 'running' WHERE id = ?").run(s.id);
    started++;
  }
  return started;
}

const SCHEME_LINES: Record<SchemeKind, { ok: [string, string, string]; no: [string, string, string] }> = {
  lost_dog: {
    ok: ["{B}, have you seen {dog}? He's been gone since the morning.", "Your dog? He was nosing round the fish crates by the Vismarkt not an hour ago.", "Bless you. I'll go and fetch him."],
    no: ["{B}, have you seen {dog}? He's been gone since the morning.", "Not a whisker of him. Sorry.", "If you do, send him home. He'll be starving."],
  },
  pay_debt: {
    ok: ["{B}. What I owe you. It's all there, count it.", "Well now. I'd given it up for lost. Thank you.", "A debt's a debt."],
    no: ["{B}. About what I owe you. I can give you half now.", "Half. Again. And the rest?", "Saturday. On my mother's grave."],
  },
  court: {
    ok: ["{B}, would you walk out with me on Sunday, after mass?", "I might. If you wash behind your ears.", "I'll call for you, then."],
    no: ["{B}, would you walk out with me on Sunday, after mass?", "I've other plans. For every Sunday.", "Well. A man can ask."],
  },
  grudge: {
    ok: ["{B}. That business last winter. Let's put it to bed.", "It's gone on long enough. Here's my hand.", "Done, then."],
    no: ["{B}. That business last winter. You still owe me an apology.", "I owe you nothing, and you know it.", "Then we've nothing to say to each other."],
  },
};

/** A and B meet: the engine rolls the outcome, the lines are engine words (or the model's when Jef is near and the share allows). */
export async function runScheme(db: DB, id: number, runner?: Runner, rng: () => number = Math.random): Promise<string> {
  const s = schemeRow(db, id);
  if (!s || s.status === "done") return "nothing";
  const a = resident(db, s.a);
  const b = resident(db, s.b);
  if (!a || !b) return "nobody";
  const data = JSON.parse(s.data_json) as { dog?: string; sum?: number };
  const help = s.jef_helped ? 0.3 : 0;
  const chance =
    s.kind === "lost_dog" ? 0.45 + help : s.kind === "pay_debt" ? 0.4 + a.stats.wealth * 0.07 + help : s.kind === "court" ? 0.25 + b.stats.warmth * 0.05 + help : 0.2 + (b.stats.warmth - b.stats.temper) * 0.05 + a.stats.warmth * 0.03 + help;
  const ok = rng() < Math.max(0.05, Math.min(0.9, chance));
  const set = SCHEME_LINES[s.kind][ok ? "ok" : "no"];
  let lines: ConvoLine[] = set.map((t, i) => ({ who: i % 2 === 0 ? a.id : b.id, name: i % 2 === 0 ? a.first : b.first, text: t.replace("{B}", b.first).replace("{dog}", data.dog ?? "the dog") }));
  let source: "claude" | "engine" = "engine";
  const jef = jefAt();
  const pa = posOf(db, a.id);
  if (jef && pa && Math.hypot(pa.x - jef.x, pa.z - jef.z) < 45 && canCallConvo(db)) {
    const res = await callClaude(
      db,
      {
        hook: "npc_convo",
        system: SYSTEM + `\nYOU NOW WRITE A SHORT EXCHANGE BETWEEN TWO PEOPLE OF THE TOWN, 1873, overheard in the street. 3 or 4 lines, A first, taking turns, each by their stats. The OUTCOME is fixed by the game: lead to it, never change it, never name another sum. No weapons, nobody hurt. ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`,
        prompt: `A: ${a.name}, ${a.age}, ${TRADES[a.trade]?.label}, temper ${a.stats.temper}, warmth ${a.stats.warmth}.\nB: ${b.name}, ${b.age}, ${TRADES[b.trade]?.label}, temper ${b.stats.temper}, warmth ${b.stats.warmth}.\nWHAT: ${s.text}\nOUTCOME (fixed): ${ok ? "it goes well for A" : "it does not go A's way"}.`,
        schema: z.object({ lines: z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string().min(1).max(140) })).min(2).max(4) }),
      },
      runner,
    );
    const got = res.ok && res.data ? res.data.lines.map((l) => ({ who: l.speaker === "A" ? a.id : b.id, name: l.speaker === "A" ? a.first : b.first, text: clean(l.text, 140) })) : null;
    if (got && got.every((l) => l.text)) {
      lines = got as ConvoLine[];
      source = "claude";
    }
  }
  const outcome = ok ? "went well" : "went badly";
  db.prepare("UPDATE town_scheme SET status = 'done', outcome = ? WHERE id = ?").run(outcome, id);
  const eid = writeEvent(db, { kind: "talk", verb: "scheme_done", actor: a.id, target: b.id, text: `${s.text} It ${outcome}.`, outcome, weight: 3, data: { kind: s.kind, lines: lines.map((l) => `${l.name}: ${l.text}`), source, helped: !!s.jef_helped }, who: [a.id, b.id] });
  publishConvo({ id: eid, a: a.id, b: b.id, a_name: a.name, b_name: b.name, purpose: "scheme", lines, source, outcome, event_id: null });
  if (s.jef_helped && ok) {
    applyTrust(db, a.id, 1, 0);
    remember(db, a.id, `Jef helped me when I needed it. ${s.kind === "lost_dog" ? `${data.dog} is home.` : ""}`.trim(), 6, "seen", null, { gist: `Jef helped ${a.name} ${s.kind === "lost_dog" ? "find a lost dog" : s.kind === "court" ? "win a sweetheart" : s.kind === "grudge" ? "make peace with a neighbour" : "settle a debt"}`, tone: 1 });
  }
  return outcome;
}

function schemeTopics(db: DB, r: Resident): ExtraTopic[] {
  const s = schemesToday(db).find((x) => x.a === r.id && (x.status === "planned" || x.status === "running") && !x.jef_helped);
  if (!s) return [];
  const b = resident(db, s.b);
  const data = JSON.parse(s.data_json) as { dog?: string; look?: string };
  const say: Record<SchemeKind, string> = {
    lost_dog: `Would you? Keep an eye out for ${data.dog ?? "my dog"}. ${data.look ? `${cap(data.look)}.` : ""} He answers to his name.`,
    pay_debt: `It's between me and ${b?.first ?? "them"}. But tell ${b?.sex === "f" ? "her" : "him"} I'm good for it, if you see ${b?.sex === "f" ? "her" : "him"}.`,
    court: `Put in a good word with ${b?.first ?? "them"} for me, would you? Say I'm a steady sort.`,
    grudge: `Tell ${b?.first ?? "them"} I'm willing to shake hands, if ${b?.sex === "f" ? "she" : "he"} is. That's all.`,
  };
  return [
    {
      choice: "You look troubled. Can I help?",
      answer: (db2) => {
        db2.prepare("UPDATE town_scheme SET jef_helped = 1 WHERE id = ?").run(s.id);
        writeEvent(db2, { kind: "action", verb: "scheme_helped", actor: r.id, text: `Jef offered to help ${r.name}: ${s.text}`, weight: 3, who: [r.id] });
        return { text: say[s.kind].replace(/\s+/g, " ").trim() };
      },
    },
  ];
}

// ================================================================== 4. the model's drift of rumours (checked against the fact)

export const TwistSchema = z.object({ tellings: z.array(z.object({ id: z.number().int(), told: z.string().max(160) })).max(6) });

/** Once a day, after noon: the model rewords a few fresh tellings; each is checked against its fact. */
export async function twistRumours(db: DB, runner?: Runner, force = false): Promise<number> {
  const c = clock(db);
  const s = st<{ day: number }>(db, "twist", { day: 0 });
  if (!force && (s.day === c.day || c.hour < 12)) return 0;
  const rows = db
    .prepare(
      `SELECT id, gist, COALESCE(told_as, gist) AS told FROM npc_memory
       WHERE source = 'heard' AND day = ? AND gist IS NOT NULL AND gist <> '' AND weight >= 3 ORDER BY weight DESC, id DESC LIMIT 6`,
    )
    .all(c.day) as Array<{ id: number; gist: string; told: string }>;
  if (rows.length < 2 || !canCallSurprise(db)) return 0;
  setSt(db, "twist", { day: c.day });
  const res = await callClaude(
    db,
    {
      hook: "rumour_twist",
      system: SYSTEM + `\nYOU NOW PLAY THE TOWN'S GOSSIP, 1873: each rumour below is passed on once more, and the words drift a little in the telling (a livelier word, a hedge, a little colour). Keep EVERY fact: the same people, the same deed, nothing worse, nothing new; no new names, places, sums, crimes, blows, police or drink. Start each with "Jef". ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`,
      prompt: `RUMOURS (id: how it was told)\n${rows.map((r) => `${r.id}: ${r.told}`).join("\n")}\n\nGive each id its new telling.`,
      schema: TwistSchema,
    },
    runner,
  );
  if (!res.ok || !res.data) return 0;
  let n = 0;
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const t of res.data.tellings) {
    const row = byId.get(t.id);
    const told = plainEnglish(t.told).trim().replace(/\s+/g, " ");
    if (!row || !withinFact(row.gist, told)) continue;
    db.prepare("UPDATE npc_memory SET told_as = ? WHERE id = ?").run(told, row.id);
    writeEvent(db, { kind: "rumour", verb: "rumour_twist", text: `A rumour drifted in the telling: "${told}" (the fact: ${row.gist})`, weight: 1, data: { fact: row.gist, told } });
    n++;
  }
  return n;
}

// ================================================================== 5. dreams

export const DreamSchema = z.object({ dream: z.string().min(20).max(420) });

/** The engine's dream from the day's facts (the fallback). */
export function engineDream(db: DB, day: number): string {
  const rows = db.prepare("SELECT verb, text FROM log WHERE day = ? ORDER BY id").all(day) as Array<{ verb: string; text: string }>;
  const has = (v: string) => rows.some((r) => r.verb === v);
  const bits: string[] = [];
  if (has("robbed") || has("assaulted")) bits.push("A hand reaches into your coat, and when you turn there is only fog, and the fog is laughing.");
  if (has("finished_job")) bits.push("You carry sacks up a gangway that never ends; each one is lighter than the last, and at the top your mother counts them.");
  if (has("stole")) bits.push("A fishwife follows you through the streets with a herring in each hand, saying nothing at all.");
  if (has("fortune")) bits.push("The cards fall from the old woman's hands and turn into gulls.");
  if (has("supper")) bits.push("You sit at a long table in a warm kitchen; somebody keeps filling your bowl.");
  if (!bits.length) bits.push("You walk the quays in the fog, looking for the Kempen road home, and every lamp you pass goes out behind you.");
  bits.push("Somewhere a ship's bell rings, and you wake before you can count the strokes.");
  return bits.slice(-3).join(" ");
}

/** Jef slept: a short dream of the day that ended (the model's, checked, or the engine's). No number moves. */
export async function dreamOf(db: DB, runner?: Runner): Promise<{ text: string; source: "claude" | "engine" }> {
  const c = clock(db);
  const day = Math.max(1, c.hour <= 6 ? c.day - 1 : c.day);
  const had = st<{ day: number; text: string; source: "claude" | "engine" } | null>(db, "dream", null);
  if (had && had.day === day) return { text: had.text, source: had.source };
  let text = engineDream(db, day);
  let source: "claude" | "engine" = "engine";
  if (canCallSurprise(db)) {
    const facts = (db.prepare("SELECT text FROM log WHERE day = ? ORDER BY id DESC LIMIT 12").all(day) as Array<{ text: string }>).map((r) => `- ${r.text}`).reverse();
    const res = await callClaude(
      db,
      {
        hook: "dream",
        system: SYSTEM + `\nYOU NOW WRITE JEF'S DREAM, the night after the day below, in the second person ("You ..."): 3 to 5 short sentences, strange and a little sad, made of the day's things (people, the fog, the river, work, coins, home in the Kempen). No weapons, no death, no blood. Never a number. ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`,
        prompt: `THE DAY (engine words)\n${facts.join("\n") || "- a quiet day"}`,
        schema: DreamSchema,
      },
      runner,
    );
    const said = res.ok && res.data ? clean(res.data.dream, 420) : null;
    if (said && !/\d/.test(said)) {
      text = said;
      source = "claude";
    }
  }
  setSt(db, "dream", { day, text, source });
  writeEvent(db, { kind: "log", verb: "dream", text: `Jef dreamt (${source}): ${text.slice(0, 200)}`, weight: 1 });
  bus.broadcast({ type: "families", dream: text });
  return { text, source };
}

// ================================================================== the tick and the talk

let busy: Promise<unknown> | null = null;
interface SurpriseState {
  hour: number;
  day: number;
}

/** Every tick (the heavy parts once a game hour): schemes, strangers, the promise, the drift. */
export async function surprisesTick(db: DB, opts: { runner?: Runner; rng?: () => number } = {}): Promise<void> {
  const c = clock(db);
  if (c.hour >= 7) planSchemes(db, opts.rng);
  schemeTick(db);
  const s = st<SurpriseState>(db, "surprises", { hour: -1, day: 0 });
  if (s.hour === c.hour && s.day === c.day) return;
  setSt(db, "surprises", { hour: c.hour, day: c.day });
  await strangerTick(db, opts);
  await keepPromise(db, opts);
  await twistRumours(db, opts.runner);
}

export function surprisesTickAsync(db: DB): void {
  if (busy) return;
  busy = surprisesTick(db)
    .catch((e) => console.error("[surprises] tick", e))
    .finally(() => (busy = null));
}
export async function surprisesIdle(): Promise<void> {
  await busy?.catch(() => {});
}

let installed = false;
export function installSurprises(): void {
  if (installed) return;
  installed = true;
  // the fortune teller keeps to her table; strangers are nobody's to borrow for events
  actionHooks.reserved.push((db, id) => {
    // her whole working day (her dinner hour too): she goes back to the table, not to a street show
    if (id === FORTUNE_ID) {
      const c = clock(db);
      return c.hour >= 9 && c.hour < 18;
    }
    return !!visitorOf(resident(db, id));
  });
  actionHooks.talkTo.scheme = async (db, a: ActionRow, runner) => {
    const d = JSON.parse(a.data_json) as { scheme?: number };
    return d.scheme ? runScheme(db, d.scheme, runner) : "nothing";
  };
  actionHooks.timeUp["talk_to:scheme"] = (db, a) => {
    const d = JSON.parse(a.data_json) as { scheme?: number };
    if (d.scheme) db.prepare("UPDATE town_scheme SET status = 'failed', outcome = 'never found them' WHERE id = ? AND status = 'running'").run(d.scheme);
    return false; // the ordinary end line
  };
  talkExtras.topics.push((db, r) => [...fortuneTopics(db, r), ...strangerTopics(db, r), ...schemeTopics(db, r)]);
  talkExtras.greet.push((db, r, _mood, met) => {
    const v = visitorOf(r);
    if (r.id === FORTUNE_ID) return nowOf(db, r).act === "work" ? (met <= 1 ? "Come, sit, my dear. The cards are warm today. Five centimes, and they tell you everything." : "Back again? The cards remember you.") : "The cards sleep at this hour, and so should you.";
    if (v?.role === "stranger" && v.here && met <= 1 && v.greeting) return v.greeting;
    return null;
  });
  talkExtras.context.push((db, r) => {
    const v = visitorOf(r);
    const parts: string[] = [];
    if (r.id === FORTUNE_ID) parts.push("WHO YOU ARE: Madame Zelie, an old fortune teller with a little table and worn cards on the Grote Markt. Mysterious, shrewd, kind underneath. You read the cards only when Jef pays (the game offers it); otherwise you talk in hints.");
    if (v?.role === "stranger" && v.here) parts.push(`WHO YOU ARE (not what the trade line says): a stranger in Antwerp, from ${v.origin}. ${v.story} WHAT YOU WANT HERE: ${v.goal}. YOUR SECRET (never say it outright; you may hint if pressed): ${v.secret} You leave town soon.`);
    const sc = schemesToday(db).find((x) => (x.a === r.id || x.b === r.id) && x.status !== "done" && x.status !== "failed");
    if (sc) parts.push(`YOUR OWN BUSINESS TODAY: ${sc.text}`);
    return parts.join("\n");
  });
}

/** A new game: nothing of this stays. */
export function clearSurprises(db: DB): void {
  for (const k of ["fortune_promise", "strangers", "twist", "dream", "surprises"]) db.prepare("DELETE FROM world_state WHERE key = ?").run(k);
  db.prepare("DELETE FROM world_state WHERE key LIKE 'errand:%'").run();
  db.prepare("DELETE FROM town_scheme").run();
}

/** For the client: the fortune teller's table, the strangers in town, the last dream. */
export function surprisesState(db: DB) {
  const f = resident(db, FORTUNE_ID);
  return {
    fortune: f ? { id: f.id, at: f.work.at ?? null } : null,
    visitors: STRANGER_KINDS.map((k) => resident(db, strangerId(k)) as VisitorResident | undefined)
      .filter((r): r is VisitorResident => !!r)
      .map(publicVisitor),
    dream: st<{ day: number; text: string } | null>(db, "dream", null),
    schemes: schemesToday(db).map((s) => ({ id: s.id, kind: s.kind, a: s.a, b: s.b, hour: s.hour, status: s.status, outcome: s.outcome })),
  };
}

export { activeActions };
