import { z } from "zod";
import type { DB } from "../db.ts";
import { BALLAD_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { LANGUAGE_RULE } from "../text.ts";
import { POCKET_SLOTS, ITEMS } from "../trade.ts";
import { activityAt } from "../town/schedule.ts";
import { resident, town } from "../town/store.ts";
import type { Resident } from "../town/population.ts";
import { activeActions } from "../director/actions.ts";
import { writeEvent } from "../director/eventlog.ts";
import { cancelEvent, castEngineLead, eventRow, gather, liveEvents, planEvent, type EventRow, type StoredStage } from "../director/scheduler.ts";
import { planFromTemplate, templateById } from "../director/templates.ts";
import { callTimeout, canCallShare, getState, hourNow, keeperOf, setState, tavernLabel } from "../interiors/state.ts";
import { balladFacts, type Fact } from "./facts.ts";
import { allowedNames, cleanVerse, plainWords } from "./guard.ts";

// The ballad singer (M6, Steve 2026-09-24). A man in rags with a sheaf of printed sheets sings
// the day's new ballad at a busy corner in the morning and in the afternoon, and in a tavern in
// the evening; a small crowd gathers (an M4 gather); Jef can buy a sheet for a centime and read
// it from his pockets. The ballad is new each day: the ENGINE picks two or three things that
// really happened in town lately from the event log (facts.ts: a fire, a robbery, Jef's deeds if
// someone saw them, a wedding, the liner, the tide) and the model writes two or three short
// verses and a chorus in the broadside style of the period (hook "ballad", its own small share,
// 20 s). Every line is checked (guard.ts); one bad line and the whole ballad is the engine's,
// made from the same facts. The singer, the corners, the hours, the price: the engine's.

export const BALLAD_HOOKS = ["ballad"];
export function canCallBallad(db: DB): boolean {
  return canCallShare(db, BALLAD_HOOKS, BALLAD_CALLS_PER_DAY);
}

/** A sheet costs a centime (a broadside sold in the street). */
export const SHEET_C = 1;
ITEMS.ballad = { name: "a ballad sheet", use: "read", note: "Coarse grey paper, a smudged woodcut at the top, the words in cramped type." };

/** When and where he sings: two corners by day, a tavern in the evening (hours, fractional). */
export const SLOTS = {
  morning: { from: 9.5, to: 12.5 },
  afternoon: { from: 14, to: 17 },
  evening: { from: 19.5, to: 21.5 },
} as const;
/** The busy corners he stands at (event places), turned by the day. */
export const CORNERS = ["grote_markt", "vismarkt", "handschoenmarkt", "steenplein"];
/** A small crowd: the M4 gather clamps it again. */
export const CROWD = 10;
/** Planned this long before the slot, so the singer and the crowd walk there. */
const PLAN_AHEAD_MIN = 60;

// ------------------------------------------------------------------ the words

const Line = z.string().min(1).max(110);
export const BalladSchema = z.object({
  title: z.string().min(1).max(60),
  verses: z.array(z.array(Line).min(4).max(4)).min(2).max(3),
  chorus: z.array(Line).min(2).max(4),
});
export type BalladText = z.infer<typeof BalladSchema>;

export interface Ballad {
  day: number;
  text: BalladText;
  source: "claude" | "engine";
  facts: string[];
  aboutJef: boolean;
}

const RULES = `
YOU NOW WRITE TODAY'S STREET BALLAD for a ballad singer in Antwerp, autumn 1873: the kind of song printed on a cheap
broadside, sold for a centime and sung at street corners and in taverns to an old tune everybody knows.
- 2 or 3 verses of exactly 4 short lines (one verse a fact; 2 verses when there are two facts), and a chorus of
  2 lines sung after each verse. Be quick and plain: a street song, not a poem.
- Lines of 6 to 10 words, a plain beat, simple rhymes (the 2nd and 4th lines at least). Period broadside style:
  "Come all you good people", a moral at the end, a little mockery of the proud, a sigh for the poor.
- The song is about the FACTS below, which really happened in town lately. Sing them, bend them a little for the
  rhyme, but invent no other happenings. One verse for each fact is best.
- Names: only names that are in the FACTS. Never name any real person, king, politician or famous man.
- Keep it tame: no oaths, nobody killed, no blood, no weapons, no call to harm anyone. No sums of money, no numbers
  written in figures. Jef may be sung about only if a fact is about him.
- The title at most six words.
${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

const OPENERS = ["Come gather round, good people all,", "Now hear the news from quay and square,", "Another tale I have to tell,", "Come listen, dockers, wives and all,"];
const KIND_LINE: Record<string, [string, string]> = {
  fire: ["The smoke rose black above the roofs,", "and buckets ran from hand to hand."],
  robbery: ["A purse was lifted in the crowd,", "and quick feet ran across the stones."],
  jef: ["The farm boy Jef was in it too,", "and half the quay was there to see."],
  wedding: ["The bells rang out, the guests made merry,", "and who will pay the bill? Not me."],
  funeral: ["The bell went slow, the black cloth hung,", "and all the street took off its hat."],
  scuffle: ["Two hot heads shoved and shouted loud,", "until the agent pulled them apart."],
  liner: ["The Kempenland lies at her chain,", "with chests and children bound away."],
  emigrants: ["They came with chests from far away,", "to wait for ships to the new land."],
  ship: ["A ship came in upon the tide,", "with sailors glad to walk on land."],
  event: ["The square was full, the talk was loud,", "and everybody had a view."],
  police: ["The agent came with measured tread,", "and wrote it in his little book."],
  tide: ["The Schelde rose, the Schelde fell,", "as it has done since time began."],
};
const MORALS = ["So mind your purse and mind your way.", "So keep your head, and pray for rain.", "And that's the truth, or near enough.", "So God be good to all of us."];
const CHORUS: BalladText["chorus"][] = [
  ["Sing hey for the Schelde, sing ho for the fog,", "Antwerp keeps singing whatever may come."],
  ["Oh the fog on the river, the rain on the quay,", "there's news in the town for a centime from me."],
];
const TITLES = ["A New Song of the Town", "The Week on the Quays", "News from the Schelde", "A True and Merry Song"];

/** A fact as a line to sing: no sums, not too long. */
function singable(f: Fact): string {
  let t = f.text
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\b\d+\s*(centimes?|francs?|c)\b/gi, "a purse")
    .replace(/\d+/g, "some")
    .replace(/[;:].*$/, "")
    .replace(/\.$/, "")
    .trim();
  if (t.length > 100) t = t.slice(0, 100).replace(/\s+\S*$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1) + ",";
}

/** The engine's ballad: always there, made from the same facts. */
export function fallbackBallad(facts: Fact[], day: number): BalladText {
  const verses = facts.slice(0, 3).map((f, i) => {
    const [a, b] = KIND_LINE[f.kind] ?? KIND_LINE.event;
    return [OPENERS[(day + i) % OPENERS.length], singable(f), a, i === facts.length - 1 ? MORALS[day % MORALS.length] : b.charAt(0).toUpperCase() + b.slice(1)];
  });
  while (verses.length < 2) verses.push([OPENERS[(day + verses.length) % OPENERS.length], ...KIND_LINE.tide.map((l, k) => (k === 0 ? l : l.charAt(0).toUpperCase() + l.slice(1))), MORALS[(day + 1) % MORALS.length]]);
  const jef = facts.some((f) => f.jef);
  return { title: jef ? "The Farm Boy on the Quays" : TITLES[day % TITLES.length], verses, chorus: CHORUS[day % CHORUS.length] };
}

/** The model's ballad, checked line by line; one bad line and it is thrown out whole. */
export function cleanBallad(db: DB, b: BalladText, facts: Fact[]): BalladText | null {
  const allowed = allowedNames(db, facts.map((f) => f.text));
  for (const w of plainWords([b.title, ...b.verses.flat(), ...b.chorus])) allowed.add(w);
  const title = cleanVerse(b.title, allowed, 60);
  if (!title) return null;
  const verses: string[][] = [];
  for (const v of b.verses) {
    const out: string[] = [];
    for (const l of v) {
      const t = cleanVerse(l, allowed);
      if (!t) return null;
      out.push(t);
    }
    verses.push(out);
  }
  const chorus: string[] = [];
  for (const l of b.chorus) {
    const t = cleanVerse(l, allowed);
    if (!t) return null;
    chorus.push(t);
  }
  // Jef only if a fact is about him
  if (!facts.some((f) => f.jef) && [title, ...verses.flat(), ...chorus].some((l) => /\bJef\b/.test(l))) return null;
  return { title, verses, chorus };
}

/** For the server's log: the first line the guard refused (game text, never the player's). */
function refusedLine(db: DB, b: BalladText, facts: Fact[]): string | null {
  const allowed = allowedNames(db, facts.map((f) => f.text));
  for (const w of plainWords([b.title, ...b.verses.flat(), ...b.chorus])) allowed.add(w);
  if (!cleanVerse(b.title, allowed, 60)) return b.title;
  for (const l of [...b.verses.flat(), ...b.chorus]) if (!cleanVerse(l, allowed)) return l;
  return null;
}

const balladKey = (day: number) => `ballad:${day}`;
let writing: Promise<Ballad> | null = null;

export function balladToday(db: DB): Ballad | null {
  return getState<Ballad | null>(db, balladKey(clock(db).day), null);
}
export function balladOf(db: DB, day: number): Ballad | null {
  return getState<Ballad | null>(db, balladKey(day), null);
}
export function balladWriting(): boolean {
  return writing !== null;
}

/** Today's ballad: written once a day (in the background from seven in the morning), kept. */
export async function writeBallad(db: DB, runner?: Runner): Promise<Ballad> {
  const have = balladToday(db);
  if (have) return have;
  if (writing) return writing;
  writing = (async () => {
    const c = clock(db);
    const facts = balladFacts(db);
    let text: BalladText | null = null;
    if (canCallBallad(db)) {
      const prompt = `FACTS (what really happened in town lately; the game's words):
${facts.map((f) => `- ${f.text}`).join("\n")}

TODAY
${c.weekday}, ${WEATHER_TEXT[c.weather]}.`;
      const res = await callClaude(db, { hook: "ballad", system: SYSTEM + "\n" + RULES, prompt, schema: BalladSchema, timeoutMs: callTimeout() }, runner);
      if (res.ok && res.data) {
        text = cleanBallad(db, res.data, facts);
        if (!text) console.log(`[ballad] the model's ballad was refused: ${refusedLine(db, res.data, facts) ?? "Jef without a fact"}`);
      } else console.log(`[ballad] no ballad from the model: ${res.error ?? "no answer"}`);
    }
    const b: Ballad = { day: c.day, text: text ?? fallbackBallad(facts, c.day), source: text ? "claude" : "engine", facts: facts.map((f) => f.text), aboutJef: facts.some((f) => f.jef) };
    if (!getState(db, balladKey(c.day), null)) setState(db, balladKey(c.day), b);
    return balladOf(db, c.day) ?? b;
  })();
  try {
    return await writing;
  } finally {
    writing = null;
  }
}

// ------------------------------------------------------------------ the singer

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Who may sing: the town's beggars first (rags), else an old man of the poor. */
function candidates(db: DB): Resident[] {
  const t = town(db).town.residents;
  const beggars = t.filter((r) => r.trade === "beggar" && r.age >= 18);
  const poor = t.filter((r) => r.sex === "m" && r.age >= 40 && r.stats.wealth <= 2 && ["retired", "docker", "boatman", "sailor"].includes(r.trade));
  return [...beggars.sort((a, b) => (a.sex === "m" ? 0 : 1) - (b.sex === "m" ? 0 : 1) || hash(a.id) - hash(b.id)), ...poor.sort((a, b) => hash(a.id) - hash(b.id))];
}

/** The town's ballad singer: picked once by the engine and kept. */
export function balladSinger(db: DB): Resident | null {
  const kept = getState<string | null>(db, "ballad:singer", null);
  const r = kept ? resident(db, kept) : undefined;
  if (r) return r;
  const pick = candidates(db)[0];
  if (!pick) return null;
  setState(db, "ballad:singer", pick.id);
  return pick;
}

/** Not in another event, not on an errand: free to sing now. Else the next of the town's poor. */
function freeSinger(db: DB, ev: EventRow): Resident | null {
  const inOthers = new Set(liveEvents(db).filter((o) => o.id !== ev.id).flatMap((o) => [...(JSON.parse(o.people_json || "[]") as string[]), ...(JSON.parse(o.leads_json || "[]") as Array<{ id: string }>).map((l) => l.id)]));
  const busy = new Set(activeActions(db).filter((a) => a.event_id !== ev.id).map((a) => a.npc_id));
  const main = balladSinger(db);
  const list = main ? [main, ...candidates(db).filter((r) => r.id !== main.id)] : candidates(db);
  return list.find((r) => !inOthers.has(r.id) && !busy.has(r.id)) ?? null;
}

// ------------------------------------------------------------------ the day's plan

/** Today's two corners (morning, afternoon), turned by the day. */
export function cornersOf(day: number): [string, string] {
  const i = day % CORNERS.length;
  return [CORNERS[i], CORNERS[(i + 2) % CORNERS.length]];
}

/** The evening's tavern: one whose keeper is behind his counter at eight, turned by the day. */
export function eveningTavern(db: DB, day: number): { place: string; label: string } | null {
  const places = Object.keys(town(db).town.places).filter((k) => k.startsWith("tavern:")).sort();
  const open = places.filter((p) => {
    const k = keeperOf(db, p);
    return !!k && activityAt(k.sched, day, 20).act === "work";
  });
  if (!open.length) return null;
  const p = open[hash(`tavern:${day}`) % open.length];
  return { place: p, label: tavernLabel(db, p) };
}

/** The ballad events of today (planned, running or done). */
function todays(db: DB): EventRow[] {
  return db.prepare("SELECT * FROM town_event WHERE template = 'ballad' AND day = ? AND status <> 'cancelled' ORDER BY id").all(clock(db).day) as EventRow[];
}

/** Every tick: plan the morning's and the afternoon's singing a little before it starts. */
export function balladTick(db: DB): void {
  const c = clock(db);
  const now = c.hour * 60 + c.minute;
  const [am, pm] = cornersOf(c.day);
  const had = todays(db).length;
  for (const [i, slot, corner] of [[0, SLOTS.morning, am], [1, SLOTS.afternoon, pm]] as const) {
    if (had > i) continue;
    const start = slot.from * 60;
    if (now < start - PLAN_AHEAD_MIN || now >= slot.to * 60 - 60) continue;
    planBallad(db, corner, Math.max(0, start - now));
    return;
  }
}

/** Plan the singing at a corner (or, if taken, at the next free one). */
export function planBallad(db: DB, corner?: string, startIn = 0, dev = false) {
  const t = templateById("ballad");
  if (!t) return { ok: false as const, why: "no ballad template" };
  const order = corner ? [corner, ...CORNERS.filter((k) => k !== corner)] : CORNERS;
  let last = "";
  for (const place of order) {
    const r = planEvent(db, planFromTemplate(t, "engine", { place, start_in_min: startIn, why: "the ballad singer's round" }), { dev });
    if (r.ok) {
      // fixes 2026-09-24: the singer and his crowd set off now, so they stand at the corner when
      // it starts (a game hour is 20 s of play: gathered at the start, they came in late)
      callSinging(db, r.event);
      return { ok: true as const, event: eventRow(db, r.event.id) ?? r.event };
    }
    last = r.why;
  }
  return { ok: false as const, why: last };
}

/**
 * The singer to his corner (a lead the engine casts) and a small crowd round him. Called when the
 * singing is planned and again when it starts (nothing twice: a free singer is cast once, the
 * crowd is topped up to CROWD). The crowd from nearby first (gather: by home, near first).
 * Returns the crowd, or null when no singer is free.
 */
export function callSinging(db: DB, ev: EventRow): string[] | null {
  const s = (JSON.parse(ev.stages_json) as StoredStage[])[0];
  const at = { x: s?.x ?? ev.x, z: s?.z ?? ev.z };
  let cur = eventRow(db, ev.id) ?? ev;
  const leads = JSON.parse(cur.leads_json || "[]") as Array<{ role: string; id: string }>;
  if (!leads.some((l) => l.role === "ballad_singer")) {
    const singer = freeSinger(db, cur);
    if (!singer) return null;
    castEngineLead(db, cur, singer.id, "ballad_singer", at);
    cur = eventRow(db, ev.id) ?? cur;
  }
  const people = JSON.parse(cur.people_json || "[]") as string[];
  const have = people.length - 1;
  if (have < CROWD) gather(db, cur, "crowd", CROWD - have, at, s?.label ?? ev.place);
  cur = eventRow(db, ev.id) ?? cur;
  const lead = (JSON.parse(cur.leads_json || "[]") as Array<{ role: string; id: string }>).find((l) => l.role === "ballad_singer");
  return (JSON.parse(cur.people_json || "[]") as string[]).filter((id) => id !== lead?.id);
}

/**
 * The act of the ballad's one stage (scheduler.ts): the singer takes his corner and a small crowd
 * stands round him (called when it was planned; topped up now). A song about Jef is remembered by
 * a few of them.
 */
export function runBalladAct(db: DB, ev: EventRow, s: StoredStage, _i: number): void {
  if (s.act !== "ballad_sing") return;
  const at = { x: s.x ?? ev.x, z: s.z ?? ev.z };
  const crowd = callSinging(db, ev);
  const lead = (JSON.parse((eventRow(db, ev.id) ?? ev).leads_json || "[]") as Array<{ role: string; id: string }>).find((l) => l.role === "ballad_singer");
  const singer = lead ? resident(db, lead.id) : null;
  if (!crowd || !singer) {
    cancelEvent(db, ev.id);
    return;
  }
  const b = balladToday(db);
  writeEvent(db, {
    kind: "event",
    verb: "ballad_sung",
    actor: singer.id,
    place: ev.place,
    x: at.x,
    z: at.z,
    text: `The ballad singer ${singer.name} sang ${b ? `"${b.text.title}"` : "the day's new ballad"} at ${s.label ?? ev.place}, and sold his sheets.`,
    ref_type: "town_event",
    ref_id: ev.id,
    weight: 2,
    who: [singer.id],
  });
  if (b?.aboutJef)
    for (const id of crowd.slice(0, 4))
      remember(db, id, `A ballad singer sang about Jef, the farm boy, at ${s.label ?? "the corner"}: "${b.text.title}".`, 3);
}

// ------------------------------------------------------------------ now

export interface SingingNow {
  kind: "street" | "tavern";
  event: number | null;
  place: string;
  label: string;
  x: number | null;
  z: number | null;
  from: number;
  to: number;
  /** "planned" before the singer is there, "running" while he sings. */
  status: string;
}

/** Where the singer sings now (or next today), if anywhere. */
export function singingNow(db: DB): SingingNow | null {
  const h = hourNow(db);
  const ev = todays(db).find((e) => e.status === "running") ?? todays(db).find((e) => e.status === "planned");
  if (ev) {
    const slot = h < 13 ? SLOTS.morning : SLOTS.afternoon;
    return { kind: "street", event: ev.id, place: ev.place, label: ((JSON.parse(ev.stages_json) as StoredStage[])[0]?.label ?? ev.place), x: ev.x, z: ev.z, from: slot.from, to: slot.to, status: ev.status };
  }
  if (h >= SLOTS.evening.from - 0.5 && h < SLOTS.evening.to) {
    const t = eveningTavern(db, clock(db).day);
    if (t) return { kind: "tavern", event: null, place: t.place, label: t.label, x: null, z: null, from: SLOTS.evening.from, to: SLOTS.evening.to, status: h >= SLOTS.evening.from ? "running" : "planned" };
  }
  return null;
}

/** For the tavern's people (interiors/tavern.ts): the singer is in this tavern now. */
export function tavernSinger(db: DB, place: string): Resident | null {
  const n = singingNow(db);
  if (!n || n.kind !== "tavern" || n.place !== place || n.status !== "running") return null;
  const s = balladSinger(db);
  if (!s) return null;
  // not while an event of the town holds him
  if (activeActions(db).some((a) => a.npc_id === s.id)) return null;
  return s;
}

// ------------------------------------------------------------------ the sheet

/**
 * Jef buys a sheet from the singer (an engine price, one a day): the singer must be singing
 * now, the ballad written, a centime in Jef's pocket and a free pocket for it.
 */
export function buySheet(db: DB): { paid_c: number; text: string } {
  const day = clock(db).day;
  const b = balladToday(db);
  const n = singingNow(db);
  if (!b || !n || n.status !== "running") throw new GameError("the ballad singer is not selling now", 409);
  if (db.prepare("SELECT 1 FROM item WHERE kind = 'ballad' AND ref = ?").get(day)) throw new GameError("you have today's sheet already", 409);
  if (player(db).money_c < SHEET_C) throw new GameError("not enough money: a sheet is a centime", 409);
  if ((db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n >= POCKET_SLOTS) throw new GameError("your pockets are full", 409);
  const singer = balladSinger(db);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(SHEET_C);
    db.prepare("INSERT INTO item (kind, job_id, ref) VALUES ('ballad', NULL, ?)").run(day);
    log(db, "bought_ballad", "ballad", `Jef bought a ballad sheet, "${b.text.title}", from the ballad singer for ${SHEET_C} centime.`);
  })();
  return { paid_c: SHEET_C, text: `You give ${singer?.first ?? "the singer"} a centime. He licks his thumb, peels a sheet off the sheaf: "${b.text.title}". (I to read it.)` };
}

/** Reading: only a sheet Jef holds. */
export function sheetView(db: DB, day: number): { day: number; title: string; verses: string[][]; chorus: string[]; weekday: string } {
  if (!db.prepare("SELECT 1 FROM item WHERE kind = 'ballad' AND ref = ?").get(day)) throw new GameError("you have no such sheet", 404);
  const b = balladOf(db, day);
  if (!b) throw new GameError("the print has run: nothing to read", 404);
  const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return { day, title: b.text.title, verses: b.text.verses, chorus: b.text.chorus, weekday: names[(day - 1) % 7] };
}
