import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { writeEvent, type WorldEvent } from "../director/eventlog.ts";
import { weekday } from "../../../shared/landmarks.ts";

// What the ballad singer sings about and what the priest preaches against (M6 ballads and
// sermon): the ENGINE picks the facts, always from the event log (world_event), never from
// anything the player typed. The model only words them. A fact is one line of engine words
// with its kind; Jef is in a fact only when someone saw it (a seen rumour, or the police).

export type FactKind = "fire" | "robbery" | "jef" | "wedding" | "funeral" | "scuffle" | "liner" | "emigrants" | "ship" | "event" | "police" | "rumour" | "drink" | "tide";

export interface Fact {
  id: number;
  day: number;
  kind: FactKind;
  text: string;
  /** Jef is in it (the ballad may sing of him; the sermon only hints). */
  jef: boolean;
  weight: number;
}

/** The town's own routine events and our own lines are not news. */
const QUIET_TEMPLATES = new Set(["hiring", "ballad"]);
const OWN_VERBS = new Set(["ballad_sung", "sermon", "heard_sermon", "bought_ballad"]);

interface Row extends WorldEvent {
  template: string | null;
}

function rows(db: DB, fromDay: number): Row[] {
  return db
    .prepare(
      `SELECT e.*, t.template AS template FROM world_event e
       LEFT JOIN town_event t ON e.ref_type = 'town_event' AND t.id = e.ref_id
       WHERE e.day >= ? ORDER BY e.id DESC LIMIT 400`,
    )
    .all(fromDay) as Row[];
}

/** What kind of news a log line is, or null when it is not news at all. */
export function kindOf(e: Row): FactKind | null {
  if (OWN_VERBS.has(e.verb)) return null;
  if (e.template && QUIET_TEMPLATES.has(e.template)) return null;
  const jef = e.actor === "player" || /^Jef\b/.test(e.text);
  switch (e.verb) {
    case "fire":
    case "fire_out":
      return "fire";
    case "street_robbery":
    case "robbery_caught":
    case "robbery_escaped":
    case "robbery_solved":
      return "robbery";
    case "robbed":
    case "caught_thief":
      return jef ? "jef" : "robbery";
    case "scuffle":
    case "scuffle_parted":
      return "scuffle";
    case "emigrants_boarded":
      return "liner";
    case "emigrants_arrived":
      return "emigrants";
    case "ship_in":
    case "ship_out":
      return "ship";
    case "tide_day":
      return "tide";
    case "rumour":
      // a rumour someone SAW start: Jef's deeds, seen
      return /^Jef\b/.test(e.text) ? "jef" : null;
    case "town_rumour":
      return "rumour";
    case "started":
      switch (e.template) {
        case "wedding":
          return "wedding";
        case "funeral":
          return "funeral";
        case "house_fire":
          return "fire";
        case "emigrant_ship":
          return "liner";
        case "quarrel":
          return "scuffle";
        default:
          return "event";
      }
  }
  if (e.kind === "police" && jef) return "jef";
  if ((e.verb === "bought" || e.verb === "drank") && (e.target === "beer" || e.target === "jenever")) return "drink";
  return null;
}

const toFact = (e: Row, kind: FactKind): Fact => ({ id: e.id, day: e.day, kind, text: e.text.trim(), jef: kind === "jef" || /\bJef\b/.test(e.text), weight: e.weight });

// ------------------------------------------------------------------ the tide (a line of the log, once a day)

/** The tide's numbers, as client/src/world/tide.ts has them (high water on Monday at 9.6 h, a tide of 12 h 25 min). */
const HW0 = 9.6;
const PERIOD = 12 + 25 / 60;
const SPRING_DAYS = 14.765;
const SPRING_AT = 30;
const HOUR_WORDS = ["midnight", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "noon"];

function hourWords(h: number): string {
  const H = Math.round(h) % 24;
  if (H === 0) return "midnight";
  if (H === 12) return "noon";
  return H < 12 ? `${HOUR_WORDS[H]} in the morning` : `${HOUR_WORDS[H - 12]} ${H >= 18 ? "at night" : "in the afternoon"}`;
}

/** The day's high waters and whether it is a spring or a neap tide (engine words). */
export function tideLine(day: number): string {
  const start = (day - 1) * 24;
  const highs: number[] = [];
  for (let k = Math.floor((start - HW0) / PERIOD); k <= Math.ceil((start + 24 - HW0) / PERIOD); k++) {
    const t = HW0 + k * PERIOD;
    if (t >= start && t < start + 24) highs.push(t - start);
  }
  const mid = start + 12;
  const c = Math.cos((2 * Math.PI * (mid - SPRING_AT)) / (SPRING_DAYS * 24));
  const kind = c > 0.5 ? "a spring tide, the river up near the edge stones of the quays" : c < -0.5 ? "a neap tide, the river lazy and low" : "an ordinary tide";
  return `High water at the quays came at ${highs.map(hourWords).join(" and at ")}; ${kind}.`;
}

/** Put the day's tide in the log once (so every fact still comes from the log). */
export function ensureTideRow(db: DB): void {
  const day = clock(db).day;
  if (db.prepare("SELECT 1 FROM world_event WHERE verb = 'tide_day' AND day = ?").get(day)) return;
  writeEvent(db, { kind: "log", verb: "tide_day", text: tideLine(day), weight: 2 });
}

// ------------------------------------------------------------------ the ballad's facts

const BALLAD_ORDER: FactKind[] = ["fire", "robbery", "jef", "wedding", "funeral", "scuffle", "liner", "emigrants", "police", "event", "ship", "tide"];
const BALLAD_BONUS: Partial<Record<FactKind, number>> = { fire: 5, robbery: 4, jef: 4, wedding: 3, funeral: 2, scuffle: 2, liner: 2, emigrants: 1 };

/**
 * The ballad of the day: two or three things that really happened in town in the last three
 * days, the heaviest first (a fire, a robbery, Jef's deeds if seen, a wedding, the liner), never
 * two of one kind. The tide is the filler, so there are always at least two.
 */
export function balladFacts(db: DB, max = 3): Fact[] {
  const c = clock(db);
  ensureTideRow(db);
  const all: Fact[] = [];
  for (const e of rows(db, c.day - 2)) {
    const k = kindOf(e);
    if (!k || k === "drink" || k === "rumour") continue;
    if (k !== "tide" && e.weight < 3) continue;
    all.push(toFact(e, k));
  }
  const score = (f: Fact) => f.weight + (BALLAD_BONUS[f.kind] ?? 0) + (f.day === c.day ? 1 : 0) - (f.kind === "tide" ? 20 : 0);
  const out: Fact[] = [];
  const kinds = new Set<FactKind>();
  for (const f of all.sort((a, b) => score(b) - score(a) || b.id - a.id)) {
    if (out.length >= max) break;
    if (kinds.has(f.kind)) continue;
    if (f.kind === "tide" && out.length >= 2) continue;
    kinds.add(f.kind);
    out.push(f);
  }
  // the order they are sung in: the ballad's own order of weight
  return out.sort((a, b) => BALLAD_ORDER.indexOf(a.kind) - BALLAD_ORDER.indexOf(b.kind));
}

// ------------------------------------------------------------------ the sermon's facts

/** The first day (Monday) of this week. */
export function weekStart(day: number): number {
  return day - (weekday(day) - 1);
}

export interface Hint {
  kind: "warn" | "praise";
  /** What the town says, with Jef made "a young man on the quays". */
  said: string;
}

/**
 * Is Jef named by a rumour this week? The weightiest rumour about him that people hold: bad
 * talk makes a warning, good talk a word of praise; the sermon never names him.
 */
export function jefHint(db: DB): Hint | null {
  const from = weekStart(clock(db).day);
  const r = db
    .prepare(
      `SELECT gist, tone, weight FROM npc_memory
       WHERE gist LIKE 'Jef%' AND day >= ? AND weight >= 3 AND tone <> 0
       ORDER BY weight * ABS(tone) DESC, id DESC LIMIT 1`,
    )
    .get(from) as { gist: string; tone: number; weight: number } | undefined;
  if (!r) return null;
  const said = r.gist
    .replace(/^Jef's\b/, "the young man's")
    .replace(/^Jef\b/, "a young man on the quays")
    .replace(/\bJef's\b/g, "his")
    .replace(/\bJef\b/g, "he")
    .replace(/\.$/, "");
  return { kind: r.tone < 0 ? "warn" : "praise", said };
}

const SERMON_ORDER: FactKind[] = ["robbery", "scuffle", "drink", "fire", "liner", "emigrants", "funeral", "wedding", "rumour", "event"];

/**
 * The week's sins and scandals for the Sunday sermon, from the log since Monday: the thefts,
 * the quarrels, the drinking (how often drink went over the counters), a fire as a warning, the
 * emigrants leaving, a rumour of the town. Never a line that names Jef (he is only hinted at).
 */
export function sermonFacts(db: DB, max = 5): Fact[] {
  const c = clock(db);
  const from = weekStart(c.day);
  const byKind = new Map<FactKind, Fact>();
  let drinks = 0;
  for (const e of rows(db, from)) {
    const k = kindOf(e);
    if (!k || k === "tide" || k === "ship" || k === "jef" || k === "police") continue;
    if (k === "drink") {
      drinks++;
      continue;
    }
    if (/\bJef\b/.test(e.text)) continue;
    if (e.weight < 3 && k !== "rumour") continue;
    const f = toFact(e, k);
    const had = byKind.get(k);
    if (!had || f.weight > had.weight) byKind.set(k, f);
  }
  // drunkards in the street's events count as drink too
  const drunk = db
    .prepare("SELECT COUNT(*) AS n FROM town_event WHERE day >= ? AND status IN ('running', 'done') AND leads_json LIKE '%\"drunkard\"%'")
    .get(from) as { n: number };
  if (drinks + drunk.n > 0) {
    const n = drinks + drunk.n;
    byKind.set("drink", {
      id: 0,
      day: c.day,
      kind: "drink",
      text: n >= 3 ? "The taverns did a roaring trade this week: jenever and beer went over the counters again and again, and men were seen unsteady in the street." : "Drink went over the tavern counters this week, as it does every week.",
      jef: false,
      weight: 3,
    });
  }
  return SERMON_ORDER.filter((k) => byKind.has(k))
    .map((k) => byKind.get(k)!)
    .slice(0, max);
}
