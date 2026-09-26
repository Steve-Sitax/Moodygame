import { z } from "zod";
import type { DB } from "../db.ts";
import { TAVERN_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { relationship, remember, topMemories, trustText } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { TRADES } from "../town/places.ts";
import { personaLine, resident } from "../town/store.ts";
import type { Resident } from "../town/population.ts";
import { runConvo } from "../director/convo.ts";
import { eventLine, writeEvent, type WorldEvent } from "../director/eventlog.ts";
import { callTimeout, canCallShare, getState, keeperAtWork, keeperOf, minuteNow, patronsIn, setState, tavernLabel } from "./state.ts";

// The taverns inside (M6). Jef walks in at the door; the keeper stands behind his
// counter, the drinkers the schedule puts here sit at the tables. The ENGINE owns
// every number: the dice and their odds, the stakes and the caps, the warmth of the
// fire, how tipsy a drink makes you. The model writes words only: a patron's remarks
// at dice, and a snatch of gossip built from facts the engine picked out of the
// world_event log. Every call has its share of the day's budget, a 20 s timeout
// and engine lines behind it.

// ---------------------------------------------------------------- numbers

/** Pitjesbak for small stakes: what you may put down, and the caps. */
export const DICE = {
  stakes: [2, 5, 10],
  /** Throws a day, all patrons together. */
  gamesPerDay: 12,
  /** Jef never loses more than this at dice in one day (net). */
  lossCapPerDay: 30,
} as const;
/** A patron stops when Jef has taken this much off him today (net): 10 c, and 4 c more per point of wealth. */
export function patronCap(r: Resident): number {
  return 10 + 4 * r.stats.wealth;
}

/** Tipsy points per drink; they wear off over three game hours. At most 4. */
export const TIPSY_PER_DRINK: Record<string, number> = { beer: 1, jenever: 2 };
export const TIPSY_MINUTES = 180;
export const TIPSY_MAX = 4;

/** The fire: +1 warmth, once a game hour. */
export const FIRE_WARMTH = 1;
export const FIRE_EVERY_MIN = 60;

/** Gossip at a table: at most once a game hour per tavern; the model's chatter (M4 convo) once in two. */
export const GOSSIP_EVERY_MIN = 60;
export const CHAT_MODEL_EVERY_MIN = 120;

export const TAVERN_HOOKS = ["tavern_dice", "tavern_gossip"];
export function canCallTavern(db: DB): boolean {
  return canCallShare(db, TAVERN_HOOKS, TAVERN_CALLS_PER_DAY);
}

// ---------------------------------------------------------------- text guards (shared with the Poesje)

const ROUGH = /\b(fuck\w*|shit\w*|bastard\w*|whore\w*|cunt\w*|bitch\w*|damn\w*|bloody|christ|jesus|kill\w*|murder\w*|rape\w*|nigg\w*|jew\w*|gypsy)\b/i;
/** A line of model text fit for the game: plain English, short, tame, and it names no sum (the engine names sums). */
export function cleanLine(s: string, max = 150, allowNumbers = false): string | null {
  const t = plainEnglish(String(s ?? "").replace(/[\r\n\t]+/g, " ")).slice(0, max).trim();
  if (!t) return null;
  if (ROUGH.test(t)) return null;
  if (!allowNumbers && /\d|\bfrancs?\b|\bcentimes?\b|\bsous?\b/i.test(t)) return null;
  if (/[<>{}`\\]|https?:|\bsystem prompt\b|\bAI\b|\bmodel\b/i.test(t)) return null;
  return t;
}

// ---------------------------------------------------------------- the tavern now

export interface TavernNow {
  place: string;
  label: string;
  open: boolean;
  keeper: { id: string; name: string; first: string; kind: string } | null;
  patrons: Array<{ id: string; name: string; first: string; kind: string; sex: "m" | "f"; age: number; stand?: boolean; role?: string }>;
}

/**
 * M6 ballads: others who come into a tavern by the engine's own plan, not their schedule (the
 * ballad singer in the evening, standing to sing). Registered by their modules.
 */
export const TAVERN_GUESTS: Array<(db: DB, place: string) => Array<{ r: Resident; stand?: boolean; role?: string }>> = [];

export function tavernNow(db: DB, place: string): TavernNow {
  const k = keeperOf(db, place);
  const open = keeperAtWork(db, place);
  const regulars = open ? patronsIn(db, place) : [];
  const guests = open ? TAVERN_GUESTS.flatMap((f) => f(db, place)).filter((g) => !regulars.some((r) => r.id === g.r.id)) : [];
  return {
    place,
    label: tavernLabel(db, place),
    open,
    keeper: k ? { id: k.id, name: k.name, first: k.first, kind: k.kind } : null,
    patrons: [
      ...regulars.map((r) => ({ id: r.id, name: r.name, first: r.first, kind: r.kind, sex: r.sex, age: r.age })),
      ...guests.map((g) => ({ id: g.r.id, name: g.r.name, first: g.r.first, kind: g.r.kind, sex: g.r.sex, age: g.r.age, ...(g.stand ? { stand: true } : {}), ...(g.role ? { role: g.role } : {}) })),
    ],
  };
}

function needOpen(db: DB, place: string): void {
  if (!keeperAtWork(db, place)) throw new GameError(`${tavernLabel(db, place)} is shut`, 409);
}

function needPatron(db: DB, place: string, id: string): Resident {
  const r = patronsIn(db, place).find((p) => p.id === id);
  if (!r) throw new GameError("they are not drinking here now", 409);
  return r;
}

// ---------------------------------------------------------------- tipsy

/**
 * How tipsy Jef is now, 0 to 4: every beer or jenever of the last three game hours,
 * each wearing off in a straight line. Read from the event log (a drink bought at
 * any counter, or drunk from the pocket), so no drink escapes it.
 */
export function tipsy(db: DB): number {
  const now = minuteNow(db);
  const rows = db
    .prepare(
      `SELECT target, day * 1440 + hour * 60 + minute AS m FROM world_event
       WHERE verb IN ('bought', 'drank') AND target IN ('beer', 'jenever') AND day >= ?`,
    )
    .all(clock(db).day - 1) as Array<{ target: string; m: number }>;
  let t = 0;
  for (const r of rows) {
    const age = now - r.m;
    if (age < 0 || age >= TIPSY_MINUTES) continue;
    t += (TIPSY_PER_DRINK[r.target] ?? 0) * (1 - age / TIPSY_MINUTES);
  }
  return Math.round(Math.min(TIPSY_MAX, t) * 100) / 100;
}

// ---------------------------------------------------------------- the fire

export function warmByFire(db: DB, place: string): { text: string; warmed: boolean } {
  needOpen(db, place);
  const now = minuteNow(db);
  const last = getState<number>(db, "interior:fire", -1e9);
  if (now - last < FIRE_EVERY_MIN) return { text: "You hold your hands to the fire. You are as warm as it will make you for now.", warmed: false };
  db.transaction(() => {
    db.prepare("UPDATE player SET warmth = MIN(10, warmth + ?) WHERE id = 1").run(FIRE_WARMTH);
    setState(db, "interior:fire", now);
    log(db, "warmed", place, `Jef warmed himself at the fire in ${tavernLabel(db, place)}.`);
  })();
  return { text: "The heat gets into your hands, then your coat. You stop shivering.", warmed: true };
}

// ---------------------------------------------------------------- pitjesbak

export type Dice3 = [number, number, number];
export interface Throw {
  dice: Dice3;
  /** 2: three alike; 1: six-five-four; 0: points. */
  rank: 0 | 1 | 2;
  points: number;
  name: string;
}

const pip = (d: number) => (d === 1 ? 100 : d === 6 ? 60 : d);
const FACE = ["", "aces", "twos", "threes", "fours", "fives", "sixes"];

/**
 * Pitjesbak, the simple way: three dice, one throw each. An ace counts 100, a six 60,
 * the others their pips. Six-five-four ("sixty-nine") beats any points; three alike
 * beat everything, three aces best. Equal throws: the stakes stay where they are.
 */
export function scoreThrow(d: Dice3): Throw {
  const s = [...d].sort((a, b) => a - b);
  if (s[0] === s[2]) return { dice: d, rank: 2, points: s[0] === 1 ? 7 : s[0], name: `three ${FACE[s[0]]}` };
  if (s[0] === 4 && s[1] === 5 && s[2] === 6) return { dice: d, rank: 1, points: 69, name: "sixty-nine" };
  const points = d.reduce((a, x) => a + pip(x), 0);
  return { dice: d, rank: 0, points, name: `${points}` };
}

/** 1: a beats b; -1: b beats a; 0: equal. */
export function compareThrows(a: Throw, b: Throw): 1 | 0 | -1 {
  if (a.rank !== b.rank) return a.rank > b.rank ? 1 : -1;
  if (a.points !== b.points) return a.points > b.points ? 1 : -1;
  return 0;
}

export function rollDice(rng: () => number = Math.random): Dice3 {
  const one = () => 1 + Math.min(5, Math.floor(rng() * 6));
  return [one(), one(), one()];
}

interface DiceLedger {
  games: number;
  /** Jef's net at dice today, centimes. */
  net: number;
  /** Per patron: what Jef has won off them today (net, may be negative). */
  won: Record<string, number>;
}
const ledger = (db: DB) => getState<DiceLedger>(db, `interior:dice:${clock(db).day}`, { games: 0, net: 0, won: {} });

export function diceLeft(db: DB): { games: number; loss_c: number } {
  const l = ledger(db);
  return { games: Math.max(0, DICE.gamesPerDay - l.games), loss_c: Math.max(0, DICE.lossCapPerDay + Math.min(0, l.net)) };
}

// the patron's remarks: the model's (one call a sitting), or these
export const TauntSchema = z.object({
  greet: z.string().min(1).max(120),
  jef_wins: z.array(z.string().min(1).max(120)).min(1).max(3),
  patron_wins: z.array(z.string().min(1).max(120)).min(1).max(3),
  draw: z.string().min(1).max(120),
  refuse: z.string().min(1).max(120),
});
export type Taunts = z.infer<typeof TauntSchema>;

export function fallbackTaunts(r: Resident): Taunts {
  const hot = r.stats.temper >= 6;
  const kind = r.stats.warmth >= 6;
  return {
    greet: hot ? "Sit, then. And keep your hands where I can see them." : kind ? "A throw or two? Why not, it's a long evening." : "Dice? Put your money down first.",
    jef_wins: hot ? ["Luck. Pure dumb luck.", "Again. Now."] : ["Well thrown, curse you.", "The dice like a new face."],
    patron_wins: hot ? ["Ha! Pay up, farm boy.", "That's the Kempen for you."] : kind ? ["Sorry, friend. The cup was kind to me.", "Better luck on the next one."] : ["Mine.", "Thank you kindly."],
    draw: "Nobody's the richer. Throw again.",
    refuse: hot ? "Enough. My purse is shut for tonight." : "No more for me tonight, I've a wife to answer to.",
  };
}

const TAUNT_RULES = `
YOU NOW WRITE SHORT REMARKS FOR A GAME OF DICE (pitjesbak) IN A TAVERN, 1873.
The person below plays Jef for a few centimes a throw. Write what they say, in their own voice, by their stats:
- greet: one line as they agree to play. jef_wins: 1 to 3 lines when Jef wins a throw. patron_wins: 1 to 3 lines when they win.
  draw: one line on equal throws. refuse: one line when they stop playing.
- Each line one short sentence, at most 15 words. Taunting is fine, cruelty is not. No oaths, no threats of real harm.
- Never name a sum, a number or a coin: the game names the stakes.
- What they know of Jef is all they know of him. Never invent things Jef did.
- ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

function personBlock(db: DB, r: Resident): string {
  const s = r.stats;
  const rel = relationship(db, r.id);
  const mem = topMemories(db, r.id, 3);
  const persona = personaLine(db, r.id);
  return `${r.name}, ${r.age}, ${r.sex === "f" ? "woman" : "man"}, ${TRADES[r.trade].label}. Stats 0-10: temper ${s.temper}, warmth ${s.warmth}, greed ${s.greed}, honesty ${s.honesty}, gossip ${s.gossip}.${persona ? ` ${persona}` : ""}
Trust in Jef ${trustText(rel?.trust ?? 0)}. Knows of Jef: ${mem.length ? mem.map((m) => m.text).join(" / ") : "nothing; a stranger"}`;
}

function cleanTaunts(t: Taunts, fb: Taunts): Taunts {
  const one = (s: string, f: string) => cleanLine(s, 120) ?? f;
  const many = (a: string[], f: string[]) => {
    const ok = a.map((s) => cleanLine(s, 120)).filter((s): s is string => !!s);
    return ok.length ? ok : f;
  };
  return { greet: one(t.greet, fb.greet), jef_wins: many(t.jef_wins, fb.jef_wins), patron_wins: many(t.patron_wins, fb.patron_wins), draw: one(t.draw, fb.draw), refuse: one(t.refuse, fb.refuse) };
}

const tauntKey = (db: DB, id: string) => `interior:taunts:${clock(db).day}:${id}`;
const writing = new Map<string, Promise<unknown>>();

/** The remarks for this patron today: the model's once written, else the engine's. */
export function tauntsFor(db: DB, r: Resident): { taunts: Taunts; source: "claude" | "engine" } {
  const got = getState<{ taunts: Taunts; source: "claude" } | null>(db, tauntKey(db, r.id), null);
  return got ?? { taunts: fallbackTaunts(r), source: "engine" };
}

/** One call a sitting (hook tavern_dice), in the background; the throws never wait for it. */
export async function writeTaunts(db: DB, r: Resident, place: string, runner?: Runner): Promise<"claude" | "engine" | "cached"> {
  const key = tauntKey(db, r.id);
  if (getState(db, key, null)) return "cached";
  if (!canCallTavern(db)) return "engine";
  const c = clock(db);
  const prompt = `PERSON: ${personBlock(db, r)}

NOW
${c.weekday}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}. Inside ${tavernLabel(db, place)}, at a table, the dice cup between them.`;
  const res = await callClaude(db, { hook: "tavern_dice", system: SYSTEM + "\n" + TAUNT_RULES, prompt, schema: TauntSchema, timeoutMs: callTimeout() }, runner);
  if (!res.ok || !res.data) return "engine";
  setState(db, key, { taunts: cleanTaunts(res.data, fallbackTaunts(r)), source: "claude" });
  return "claude";
}

/** Jef sits down to play with a patron: their greeting now; their own words follow when written. */
export function sitToDice(db: DB, place: string, patronId: string, runner?: Runner): { line: string; stakes: readonly number[]; left: { games: number; loss_c: number }; source: string } {
  needOpen(db, place);
  const r = needPatron(db, place, patronId);
  const t = tauntsFor(db, r);
  const key = `${clock(db).day}:${r.id}`;
  if (t.source === "engine" && !writing.has(key)) {
    const p = writeTaunts(db, r, place, runner).catch(() => "engine").finally(() => writing.delete(key));
    writing.set(key, p);
  }
  return { line: `${r.first}: ${t.taunts.greet}`, stakes: DICE.stakes, left: diceLeft(db), source: t.source };
}

/** Test seam: wait for a remark being written. */
export async function tauntsSettled(): Promise<void> {
  await Promise.all([...writing.values()]);
}

export interface DiceResult {
  jef: Throw;
  them: Throw;
  /** 1 Jef won, -1 lost, 0 equal. */
  result: 1 | 0 | -1;
  net_c: number;
  line: string;
  left: { games: number; loss_c: number };
}

/** One throw each for a stake. The engine rolls, compares and pays; the patron only talks. */
export function throwDice(db: DB, place: string, patronId: string, stake: number, rng: () => number = Math.random): DiceResult {
  needOpen(db, place);
  const r = needPatron(db, place, patronId);
  if (!(DICE.stakes as readonly number[]).includes(stake)) throw new GameError(`the stakes here are ${DICE.stakes.join(", ")} centimes`, 400);
  const l = ledger(db);
  const t = tauntsFor(db, r).taunts;
  if (l.games >= DICE.gamesPerDay) throw new GameError(`${r.first}: "The cup's had enough for one day, and so have you."`, 409);
  if (l.net - stake < -DICE.lossCapPerDay) throw new GameError(`You have lost enough at dice for one day. Keep the rest for bread.`, 409);
  if ((l.won[r.id] ?? 0) + stake > patronCap(r)) throw new GameError(`${r.first}: "${t.refuse}"`, 409);
  if (player(db).money_c < stake) throw new GameError(`not enough money: ${stake} c on the table`, 409);

  const jef = scoreThrow(rollDice(rng));
  const them = scoreThrow(rollDice(rng));
  const result = compareThrows(jef, them);
  const net = result * stake;
  const label = tavernLabel(db, place);
  db.transaction(() => {
    if (net) db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(net);
    l.games++;
    l.net += net;
    l.won[r.id] = (l.won[r.id] ?? 0) + net;
    setState(db, `interior:dice:${clock(db).day}`, l);
    const what = result > 0 ? `won ${stake} centimes off ${r.name}` : result < 0 ? `lost ${stake} centimes to ${r.name}` : `threw even with ${r.name}`;
    log(db, "diced", r.id, `Jef ${what} at dice in ${label}.`);
  })();
  if (result > 0) remember(db, r.id, `Jef beat me at dice in ${label} for ${stake} centimes.`, stake >= 10 ? 3 : 2);
  else if (result < 0) remember(db, r.id, `I took ${stake} centimes off Jef at dice in ${label}.`, 2);
  const pickOf = (a: string[]) => a[Math.floor(rng() * a.length) % a.length];
  const words = result > 0 ? pickOf(t.jef_wins) : result < 0 ? pickOf(t.patron_wins) : t.draw;
  return { jef, them, result, net_c: net, line: `${r.first}: ${words}`, left: diceLeft(db) };
}

// ---------------------------------------------------------------- gossip at the tables

export const GossipSchema = z.object({
  lines: z.array(z.object({ speaker: z.enum(["A", "B"]), text: z.string().min(1).max(160) })).min(2).max(4),
});

const GOSSIP_RULES = `
YOU NOW WRITE A SNATCH OF TAVERN GOSSIP, 1873, overheard by Jef at the next table. They do not know he listens.
- 2 to 4 lines, taking turns, A first. Each line one or two short sentences in that person's own voice.
- It is about the FACTS below, which really happened in town. Twist them the way tavern talk does: get a detail wrong,
  make it bigger, guess at the reason, blame someone. But keep each fact recognisable. Invent no deaths and no new crimes.
- Names: only people named in the facts, and A and B themselves. Jef may come up if a fact is about him.
- Never name a sum or a number of coins. No oaths.
- ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

const DULL = new Set(["bought", "drank", "ate", "talked", "convo", "gossip", "diced", "warmed", "paid_show", "poesje_show", "arrived", "job_board", "said_strange"]);

/** The engine's pick: one or two weighty things of the last two days nobody here has gossiped about yet. */
export function gossipFacts(db: DB, max = 2): WorldEvent[] {
  const used = new Set(getState<number[]>(db, "interior:gossip_used", []));
  const rows = db
    .prepare("SELECT * FROM world_event WHERE day >= ? AND weight >= 3 ORDER BY weight DESC, id DESC LIMIT 60")
    .all(clock(db).day - 1) as WorldEvent[];
  return rows.filter((e) => !used.has(e.id) && !DULL.has(e.verb)).slice(0, max);
}

const SMALL_TALK: Array<[string, string]> = [
  ["The fog's in my bones again tonight.", "Drink up, it goes out the same way it came in."],
  ["They say the Red Star ships take a thousand at a time.", "And bring back not one of them."],
  ["The naties are hiring short this week.", "They always are when you need it."],
  ["My wife says I drink too much.", "Your wife says a lot of things."],
];

export interface GossipResult {
  lines: Array<{ who: string; name: string; text: string }>;
  source: "claude" | "engine";
  facts: string[];
}

export function engineGossip(a: Resident, b: Resident, facts: WorldEvent[]): GossipResult["lines"] {
  if (!facts.length) {
    const [x, y] = SMALL_TALK[(a.id.charCodeAt(a.id.length - 1) + b.id.charCodeAt(b.id.length - 1)) % SMALL_TALK.length];
    return [
      { who: a.id, name: a.first, text: x },
      { who: b.id, name: b.first, text: y },
    ];
  }
  const f = facts[0].text.replace(/\.$/, "");
  return [
    { who: a.id, name: a.first, text: `Did you hear? ${f}.` },
    { who: b.id, name: b.first, text: b.stats.temper >= 6 ? "I heard worse. I heard it was twice that." : "Is that so. Well, it's not the first time." },
  ];
}

/**
 * Jef sits near two drinkers: he overhears them. The engine picks the facts from the
 * event log; the model only words them (hook tavern_gossip); late or over budget, the
 * engine says it plain. Once a game hour per tavern.
 */
export async function overhear(db: DB, place: string, aId: string, bId: string, runner?: Runner): Promise<GossipResult> {
  needOpen(db, place);
  if (aId === bId) throw new GameError("two people are needed for gossip", 400);
  const a = needPatron(db, place, aId);
  const b = needPatron(db, place, bId);
  const now = minuteNow(db);
  const last = getState<Record<string, number>>(db, "interior:gossip_last", {});
  if (now - (last[place] ?? -1e9) < GOSSIP_EVERY_MIN) throw new GameError("they talk of nothing much just now", 409);
  last[place] = now;
  setState(db, "interior:gossip_last", last);

  const facts = gossipFacts(db);
  let lines: GossipResult["lines"] | null = null;
  if (facts.length && canCallTavern(db)) {
    const c = clock(db);
    const prompt = `PERSON A: ${personBlock(db, a)}

PERSON B: ${personBlock(db, b)}

FACTS (what really happened; the game's words):
${facts.map(eventLine).join("\n")}

NOW
${c.weekday}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}. Inside ${tavernLabel(db, place)}, over a drink.`;
    const res = await callClaude(db, { hook: "tavern_gossip", system: SYSTEM + "\n" + GOSSIP_RULES, prompt, schema: GossipSchema, timeoutMs: callTimeout() }, runner);
    if (res.ok && res.data) {
      const ok = res.data.lines.map((l) => ({ l, t: cleanLine(l.text, 160) }));
      if (ok.every((x) => x.t))
        lines = ok.map(({ l, t }) => ({ who: l.speaker === "A" ? a.id : b.id, name: l.speaker === "A" ? a.first : b.first, text: t! }));
    }
  }
  const source = lines ? "claude" : "engine";
  lines ??= engineGossip(a, b, facts);
  if (facts.length) setState(db, "interior:gossip_used", [...getState<number[]>(db, "interior:gossip_used", []), ...facts.map((f) => f.id)].slice(-200));
  writeEvent(db, {
    kind: "talk",
    verb: "gossip",
    actor: a.id,
    target: b.id,
    place,
    text: `${a.name} and ${b.name} gossiped in ${tavernLabel(db, place)}${facts.length ? ` about: ${facts[0].text}` : ""}`.slice(0, 280),
    weight: 2,
    who: [a.id, b.id],
    data: { source },
  });
  return { lines, source, facts: facts.map((f) => f.text) };
}

// ---------------------------------------------------------------- chatter (M4 convo)

/**
 * Two drinkers at a table talk (the M4 conversation, its own share of calls); at most
 * once in two game hours per tavern through it, in between the engine's small talk.
 */
export async function tavernChat(db: DB, place: string, aId: string, bId: string, runner?: Runner): Promise<GossipResult> {
  needOpen(db, place);
  if (aId === bId) throw new GameError("two people are needed for a talk", 400);
  const a = needPatron(db, place, aId);
  const b = needPatron(db, place, bId);
  const now = minuteNow(db);
  const last = getState<Record<string, number>>(db, "interior:chat_last", {});
  if (now - (last[place] ?? -1e9) >= CHAT_MODEL_EVERY_MIN) {
    last[place] = now;
    setState(db, "interior:chat_last", last);
    const c = await runConvo(db, { a: a.id, b: b.id, purpose: "chat", about: `the evening in ${tavernLabel(db, place)}, over a drink` }, runner);
    return { lines: c.lines, source: c.source, facts: [] };
  }
  return { lines: engineGossip(a, b, []), source: "engine", facts: [] };
}

/** Test helper: is this resident drinking here? */
export function drinksHere(db: DB, place: string, id: string): boolean {
  return patronsIn(db, place).some((r) => r.id === id) || !!(resident(db, id) && keeperOf(db, place)?.id === id);
}
