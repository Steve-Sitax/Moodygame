import { z } from "zod";
import { gameGeneration, type DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, PAPER_CALLS_PER_DAY } from "../config.ts";
import { DAY_NAMES, WEATHER_TEXT, weather } from "../day.ts";
import { writeEvent } from "../director/eventlog.ts";
import { GameError } from "../game.ts";
import { listJobs } from "../hooks/jobBoard.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { ITEM_REF, ITEMS, marketOf, waresOf } from "../trade.ts";
import { rngFrom } from "../town/population.ts";
import { resident, town } from "../town/store.ts";
import { rollNews } from "../ideas/abroad.ts";
import { pid } from "../player/current.ts";

// The morning paper (M6). Every game morning the ENGINE picks the day's facts
// from the world_event log (yesterday's events, thefts, arrests, what people saw
// Jef do, the ships in and out, the weather, the prices) and from the day's board;
// the model only writes them up: 4 to 6 short articles, a shipping list and the
// newsboys' cry, in period tone and plain English. Every article must name the
// fact it is about; a line about a fact that is not on the list, or a sum that
// is not in its fact, is dropped for the engine's own words. Late, wrong or over
// budget: the engine writes the whole paper from the same facts.
//
// The paper: Het Handelsblad (van Antwerpen), a real Antwerp daily since 1844; the
// name for the period feel, the articles are ours. 5 centimes from the newsboys.

export const PAPER_NAME = "Het Handelsblad";
export const PAPER_PRICE_C = 5;
/** The game week: Monday 13 to Sunday 19 October 1873 (docs/01: October 1873). */
export const FIRST_DATE = 13;

export const PRESS_HOOKS = ["newspaper", "letter", "clerk"] as const;

/** The press's share of the day's calls (config.ts), never the reserve. */
export function canCallPress(db: DB): boolean {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare(`SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook IN (${PRESS_HOOKS.map(() => "?").join(", ")})`).get(day, ...PRESS_HOOKS) as { n: number }).n;
  return mine < PAPER_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

export function dateLine(day: number): string {
  return `${DAY_NAMES[(day - 1) % 7]} ${FIRST_DATE + day - 1} October 1873`;
}

// ------------------------------------------------------------------ the harbour (engine)

export interface ShipFact {
  name: string;
  type: string;
  master: string;
  port: string;
  cargo: string;
  berth: string;
  dir: "in" | "out";
}

const SHIPS: Array<[string, string]> = [
  ["Vaderland", "steamer"], ["Nederland", "steamer"], ["Stad Antwerpen", "steamer"], ["Leopold", "steamer"], ["Flandre", "steamer"],
  ["Jonge Jan", "schooner"], ["Elise", "schooner"], ["Concordia", "barque"], ["Hoop op Zegen", "barque"], ["Twee Gebroeders", "galliot"],
  ["Maria Theresia", "brig"], ["Johanna", "brig"], ["Fortuna", "barque"], ["Schelde", "steamer"], ["Caroline", "schooner"],
];
const MASTERS = ["Maes", "Verbeke", "Jansen", "Smit", "Olsen", "De Vries", "Petersen", "Brown", "Hansen", "Claessens", "Roberts", "Lindqvist"];
const PORTS: Array<[string, string]> = [
  ["London", "general goods"], ["Hull", "coal"], ["Riga", "timber"], ["Odessa", "grain"], ["Rio de Janeiro", "coffee"],
  ["Buenos Aires", "hides"], ["Bordeaux", "wine"], ["Liverpool", "cotton"], ["New York", "petroleum"], ["Rotterdam", "sugar"],
  ["Hamburg", "general goods"], ["Swansea", "coal"], ["Santos", "coffee"], ["Philadelphia", "petroleum"], ["Archangel", "tar and timber"],
];
const OUT_PORTS = ["New York", "Philadelphia", "London", "Hull", "Leith", "Bordeaux", "Lisbon", "Riga", "Buenos Aires"];
const BERTHS = ["the Rijnkaai", "the Petit Bassin", "the Werf"];
/** Cargo for a job's goods, so the ship in the paper carries what the board wants carried. */
const CARGO_FOR: Record<string, string> = { crates: "coffee", sacks: "grain", barrels: "wine", hides: "hides", rope: "hemp", parcel: "general goods" };
const RIJNKAAI_BOSSES = new Set(["sooi", "peeters", "tuur"]);

const dayFlag = (db: DB, key: string): number => {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  return row ? Number(JSON.parse(row.value_json)) : 0;
};
const setDayFlag = (db: DB, key: string, day: number) =>
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(day));

/** The day's ships, the weather and the prices, written into the log once a morning (the harbour master's list). */
export function writeHarbour(db: DB, day: number): ShipFact[] {
  if (dayFlag(db, "press_harbour") === day) return [];
  setDayFlag(db, "press_harbour", day);
  const seed = town(db).town.seed || 1873;
  const rng = rngFrom((seed * 31 + day * 977) >>> 0);
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  // not a ship that was in yesterday's list: she cannot sail for Philadelphia and come in from it overnight
  const lately = new Set(
    (db.prepare("SELECT data_json FROM world_event WHERE day = ? AND verb IN ('ship_in', 'ship_out')").all(day - 1) as Array<{ data_json: string }>).map((r) => (JSON.parse(r.data_json) as ShipFact).name),
  );
  const names = SHIPS.filter(([n]) => !lately.has(n)).sort(() => rng() - 0.5);
  const jobs = listJobs(db, day).filter((j) => j.status === "offered" && j.task?.kind === "carry");
  const quayJob = jobs.find((j) => RIJNKAAI_BOSSES.has(j.employer_npc)) ?? null;
  const bassinJob = jobs.find((j) => j.employer_npc === "katoen") ?? null;
  const ships: ShipFact[] = [];
  const nIn = 2 + Math.floor(rng() * 2);
  const nOut = 1 + Math.floor(rng() * 2);
  for (let i = 0; i < nIn + nOut; i++) {
    const [name, type] = names[i % names.length];
    const dir = i < nIn ? "in" : "out";
    let [port, cargo] = pick(PORTS);
    let berth = pick(BERTHS);
    // the first two arrivals are what the board's carry work unloads
    const job = i === 0 ? quayJob : i === 1 ? bassinJob : null;
    if (job && job.task?.kind === "carry") {
      cargo = CARGO_FOR[job.task.goods] ?? cargo;
      berth = i === 0 ? "the Rijnkaai" : "the Petit Bassin";
    }
    if (dir === "out") port = pick(OUT_PORTS);
    ships.push({ name, type, master: `Captain ${pick(MASTERS)}`, port, cargo, berth, dir });
  }
  for (const s of ships) {
    const text =
      s.dir === "in"
        ? `The ${s.type} ${s.name} (${s.master}) came in from ${s.port} with ${s.cargo}; she lies at ${s.berth}.`
        : `The ${s.type} ${s.name} (${s.master}) sailed from ${s.berth} for ${s.port}.`;
    writeEvent(db, { kind: "log", verb: s.dir === "in" ? "ship_in" : "ship_out", text, place: s.berth, weight: 3, data: s });
  }
  // M6 ideas: now and then a ship brings news from abroad that moves prices (before the prices line)
  const firstIn = ships.find((s) => s.dir === "in");
  rollNews(db, day, firstIn ? { name: firstIn.name, type: firstIn.type } : null);
  writeEvent(db, { kind: "log", verb: "weather_day", text: `The day came up with ${WEATHER_TEXT[weather(db)]}.`, weight: 2 });
  writeEvent(db, { kind: "log", verb: "prices", text: `Prices at the stalls and counters this morning: ${pricesNow(db).map((p) => `${p.name} ${p.price_c} c`).join(", ")}.`, weight: 2 });
  return ships;
}

/** The lowest price of each food and drink in town now (engine prices, with any event's factor). */
export function pricesNow(db: DB): Array<{ kind: string; name: string; price_c: number }> {
  const best = new Map<string, number>();
  const market = marketOf(db);
  for (const r of town(db).town.residents) {
    if (r.work.stall === undefined && !r.work.shop && r.trade !== "publican") continue;
    for (const w of waresOf(db, r.id, market)) if (ITEMS[w.kind]?.use === "eat" || ITEMS[w.kind]?.use === "drink") best.set(w.kind, Math.min(best.get(w.kind) ?? Infinity, w.price_c));
  }
  const order = ["herring", "eel", "bread", "apple", "beer", "jenever"];
  return order.filter((k) => best.has(k)).map((k) => ({ kind: k, name: ITEMS[k].name.replace(/^(a|an) (pot of |loaf of |nip of )?/, ""), price_c: best.get(k)! }));
}

// ------------------------------------------------------------------ the facts (engine)

export type FactKind = "ship" | "weather" | "market" | "coming" | "work" | "police" | "theft" | "talk" | "event" | "abroad";

export interface Fact {
  n: number;
  kind: FactKind;
  text: string;
  weight: number;
  /** Where it came from: "we:<world_event id>", "job:<id>". */
  ref: string;
  ship?: ShipFact;
}

interface EvRow {
  id: number;
  day: number;
  hour: number;
  minute: number;
  kind: string;
  verb: string;
  actor: string | null;
  target: string | null;
  place: string | null;
  text: string;
  weight: number;
  ref_type: string | null;
  ref_id: number | null;
  data_json: string;
}

/** "Petrus Van den Bergh" -> "one P. V." (the papers of the time printed initials). */
function initials(name: string): string {
  const [first, ...rest] = name.split(/\s+/);
  return `one ${first[0]}. ${rest[0]?.[0] ?? ""}.`.replace(" .", "");
}

const PLACE_WORDS: Record<string, string> = { rijnkaai: "on the Rijnkaai", vismarkt: "by the Vismarkt", "grote-markt": "on the Grote Markt", werf: "on the Werf", steenplein: "on the Steenplein" };
const where = (p: string | null) => (p && PLACE_WORDS[p]) || "on the quays";

/**
 * One event of the log as a fact in engine words, or null when it is not for the paper:
 * only what the town could know. Jef's own deeds reach the paper only through what
 * someone saw (a rumour with a witness) or what the police did in the open.
 */
function factOf(db: DB, e: EvRow): Omit<Fact, "n"> | null {
  const ref = `we:${e.id}`;
  const nameOf = (id: string | null) => (id ? (resident(db, id)?.name ?? null) : null);
  switch (e.verb) {
    case "started": {
      if (e.kind !== "event") return null;
      return { kind: "event", text: `Yesterday: ${e.text.replace(/\.$/, "")}.`, weight: Math.max(5, e.weight), ref };
    }
    case "cancelled":
      return e.kind === "event" ? { kind: "event", text: e.text, weight: 3, ref } : null;
    case "robbed": {
      const c = /(\d+) centimes/.exec(e.text)?.[1];
      return { kind: "theft", text: `A day labourer had his pocket picked in the dark ${where(e.place)}${c ? `; ${c} centimes gone` : ""}. Nobody saw the thief.`, weight: 7, ref };
    }
    case "caught_thief": {
      const thief = nameOf(e.target) ?? nameOf(e.actor);
      return { kind: "theft", text: `A day labourer caught a pickpocket${thief ? `, ${initials(thief)},` : ""} by the collar and took his money back.`, weight: 7, ref };
    }
    case "restitution": {
      const thief = nameOf(e.target) ?? nameOf(e.actor);
      const c = /(\d+) centimes/.exec(e.text)?.[1];
      return { kind: "police", text: `A pickpocket${thief ? `, ${initials(thief)},` : ""} gave back ${c ? `the ${c} centimes` : "the money"} he had taken from a day labourer.`, weight: 6, ref };
    }
    case "police_warning":
      return { kind: "police", text: "The police gave Jef, a day labourer new to the town, a warning over a theft.", weight: 6, ref };
    case "police_fine":
      return { kind: "police", text: "The police fined Jef, a day labourer new to the town, over a theft.", weight: 7, ref };
    case "arrested":
      return { kind: "police", text: "The police took Jef, a day labourer new to the town, to the prison in the Begijnenstraat for theft.", weight: 9, ref };
    case "cell":
      return { kind: "police", text: "Jef, a day labourer, spent the night in the prison in the Begijnenstraat; all he had went for the fine.", weight: 8, ref };
    // M9 theft: caught at it, and would not settle it with the one who caught him (town/confront.ts), or a bad name
    case "caught_stealing":
      return { kind: "theft", text: `${e.text.replace(/^Jef\b/,"Jef, a day labourer new to the town,").replace(/\.$/, "")}.`, weight: 7, ref };
    case "police_search":
      return { kind: "police", text: "An agent of the police is looking into a robbery on the quays.", weight: 4, ref };
    case "rumour":
    case "town_rumour": {
      if (e.weight < 4) return null;
      return { kind: "talk", text: `Talk in the town: ${e.text.replace(/\.$/, "")}.`, weight: e.weight, ref };
    }
    default:
      return null;
  }
}

/**
 * The day's facts, from the world_event log (yesterday, and this morning's harbour,
 * weather, prices and planned events) and today's board. Nothing else goes in.
 */
export function paperFacts(db: DB, day: number): Fact[] {
  const out: Array<Omit<Fact, "n">> = [];
  const seen = new Set<string>();
  const add = (f: Omit<Fact, "n"> | null) => {
    if (!f || seen.has(f.text)) return;
    seen.add(f.text);
    out.push(f);
  };
  // this morning: the harbour, the weather, the prices, what is planned for today
  const today = db
    .prepare("SELECT * FROM world_event WHERE day = ? AND verb IN ('ship_in', 'ship_out', 'weather_day', 'prices', 'planned', 'news_abroad') ORDER BY id")
    .all(day) as EvRow[];
  for (const e of today) {
    const ref = `we:${e.id}`;
    if (e.verb === "ship_in" || e.verb === "ship_out") add({ kind: "ship", text: e.text, weight: 3, ref, ship: JSON.parse(e.data_json) as ShipFact });
    else if (e.verb === "weather_day") add({ kind: "weather", text: e.text, weight: 3, ref });
    else if (e.verb === "news_abroad") add({ kind: "abroad", text: e.text, weight: 6, ref });
    else if (e.verb === "prices") add({ kind: "market", text: e.text, weight: 3, ref });
    else if (e.verb === "planned" && e.ref_type === "town_event" && e.ref_id) {
      const ev = db.prepare("SELECT title, place, start_m, notice, status, stages_json FROM town_event WHERE id = ?").get(e.ref_id) as
        | { title: string; place: string; start_m: number; notice: string; status: string; stages_json: string }
        | undefined;
      if (!ev || ev.status === "cancelled") continue;
      const m = Math.round((ev.start_m % 1440) / 15) * 15; // "from about": a quarter hour
      const label = (JSON.parse(ev.stages_json) as Array<{ label?: string }>)[0]?.label ?? ev.place;
      const at = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
      add({ kind: "coming", text: `Today, from about ${at}: ${ev.title} at ${label}.${ev.notice ? ` ${ev.notice}` : ""}`, weight: 6, ref });
    }
  }
  // yesterday in the town: the heaviest first, at most seven
  const past = db.prepare("SELECT * FROM world_event WHERE day = ? ORDER BY weight DESC, id").all(day - 1) as EvRow[];
  const yesterday: Array<Omit<Fact, "n">> = [];
  const seenY = new Set<string>();
  for (const e of past) {
    const f = factOf(db, e);
    if (f && !seenY.has(f.text)) {
      seenY.add(f.text);
      yesterday.push(f);
    }
  }
  for (const f of yesterday.slice(0, 7)) add(f);
  // the day's work: the best-paid open jobs on the board, at most three
  const jobs = listJobs(db, day)
    .filter((j) => j.status === "offered" && j.playable)
    .sort((a, b) => b.pay_c - a.pay_c)
    .slice(0, 3);
  for (const j of jobs) add({ kind: "work", text: `Wanted today: ${j.title} for ${j.employer_name}, ${j.pay_c} centimes.`, weight: 4, ref: `job:${j.id}` });
  return out.map((f, i) => ({ ...f, n: i + 1 }));
}

// ------------------------------------------------------------------ the model's part

export const PaperSchema = z.object({
  cry: z.string().min(3).max(80),
  articles: z
    .array(z.object({ fact: z.number().int(), headline: z.string().min(3).max(70), text: z.string().min(15).max(450) }))
    .min(3)
    .max(6),
  shipping: z.array(z.object({ ship: z.number().int(), line: z.string().min(5).max(160) })).max(8),
});
export type PaperOut = z.infer<typeof PaperSchema>;

export interface Article {
  fact: number;
  kind: FactKind;
  headline: string;
  text: string;
}

export interface Paper {
  day: number;
  name: string;
  date: string;
  price_c: number;
  cry: string;
  headline: string;
  articles: Article[];
  shipping: Array<{ ship: number; dir: "in" | "out"; line: string }>;
  source: "claude" | "engine";
}

export const PAPER_SYSTEM = `You set the type for ${PAPER_NAME}, a daily paper in Antwerp, October 1873.
You write short newspaper items in the plain, dry style of a Belgian paper of the time: who, what, where,
without opinion or flourish. Brief shipping notes like a port list.

${LANGUAGE_RULE}
No modern words. No exclamation storms. Money is in centimes and francs; 100 centimes = 1 franc.

You only write up the FACTS you are given, one article per fact, and you say which fact by its number.
You never add a fact, a name, a sum, a date or a place that is not in that fact. You invent nothing.
The engine owns every fact and number. Keep to the JSON schema. Never mention a game or anything outside 1873 Antwerp.`;

export function paperPrompt(day: number, facts: Fact[]): string {
  const ships = facts.filter((f) => f.kind === "ship");
  const rest = facts.filter((f) => f.kind !== "ship");
  return `Write the paper for ${dateLine(day)}.

FACTS (number, kind, the fact in the engine's words; all true)
${rest.map((f) => `${f.n}. [${f.kind}] ${f.text}`).join("\n") || "- a quiet day"}

SHIPS (number, the harbour master's line)
${ships.map((f) => `${f.n}. ${f.text}`).join("\n") || "- none"}

WRITE
- articles: 4 to 6 items, each about ONE fact above by its number ("fact"), the most striking first.
  headline: a few words in small capitals style, like "THEFT ON THE QUAYS" or "THE WEATHER".
  text: 1 to 3 short sentences. Only what the fact says. Any number or sum must be the fact's own.
  Use the weather and the market facts if there is little else. A "work" fact is a small notice of work wanted.
  An "abroad" fact (news the ships brought) must be one of the articles, with its prices as given.
- shipping: one line per ship above ("ship" = its number), like "Vaderland, steamer, Capt. Randle, from New York, petroleum; at the Rijnkaai."
- cry: what a newsboy shouts on the corner, a few words from the first headline, e.g. "Handelsblad! Theft on the quays!"`;
}

const digits = (s: string) => s.match(/\d+/g) ?? [];

/** The engine's own item for a fact (the fallback, and for any line the model got wrong). */
export function engineArticle(f: Fact): Article {
  const head: Record<FactKind, string> = {
    ship: "SHIPPING",
    weather: "THE WEATHER",
    market: "THE MARKETS",
    coming: "TODAY IN THE TOWN",
    work: "WORK WANTED",
    police: "POLICE",
    theft: "THEFT ON THE QUAYS",
    talk: "SAID ON THE QUAYS",
    event: "YESTERDAY",
    abroad: "NEWS FROM ABROAD",
  };
  return { fact: f.n, kind: f.kind, headline: head[f.kind], text: f.text };
}

export function engineShipLine(f: Fact): string {
  const s = f.ship!;
  return s.dir === "in" ? `${s.name}, ${s.type}, ${s.master.replace("Captain", "Capt.")}, from ${s.port}, ${s.cargo}; at ${s.berth.replace(/^the /, "")}.` : `${s.name}, ${s.type}, ${s.master.replace("Captain", "Capt.")}, sailed for ${s.port}.`;
}

/** The engine's whole paper, from the same facts: the heaviest first. */
export function enginePaper(day: number, facts: Fact[]): Paper {
  const order = facts.filter((f) => f.kind !== "ship").sort((a, b) => b.weight - a.weight || a.n - b.n);
  const articles = order.slice(0, 6).map(engineArticle);
  const headline = articles[0] ? headlineOf(articles[0]) : "THE MORNING PAPER";
  return {
    day,
    name: PAPER_NAME,
    date: dateLine(day),
    price_c: PAPER_PRICE_C,
    cry: `Handelsblad, five centimes! ${cap(headline.toLowerCase())}!`,
    headline,
    articles,
    shipping: facts.filter((f) => f.kind === "ship").map((f) => ({ ship: f.n, dir: f.ship!.dir, line: engineShipLine(f) })),
    source: "engine",
  };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function headlineOf(a: Article): string {
  return a.headline;
}

/**
 * Check the model's paper against the facts: an article must name a fact on the list
 * (once), keep to the fact's own numbers, and be plain English; a shipping line must name
 * its ship. Anything else gives way to the engine's words. At least four articles.
 */
export function cleanPaper(day: number, facts: Fact[], out: PaperOut): Paper {
  const byN = new Map(facts.map((f) => [f.n, f]));
  const used = new Set<number>();
  const articles: Article[] = [];
  for (const a of out.articles) {
    const f = byN.get(a.fact);
    if (!f || f.kind === "ship" || used.has(f.n)) continue;
    used.add(f.n);
    const text = plainEnglish(a.text);
    const headline = plainEnglish(a.headline).toUpperCase().slice(0, 60);
    const allowed = new Set(digits(f.text));
    const okNumbers = digits(text + " " + headline).every((d) => allowed.has(d));
    articles.push(okNumbers && text.length >= 15 ? { fact: f.n, kind: f.kind, headline, text } : engineArticle(f));
  }
  // M6 ideas: the news from abroad is always in the paper (the model's words, or the engine's)
  const abroad = facts.find((x) => x.kind === "abroad" && !used.has(x.n));
  if (abroad) {
    used.add(abroad.n);
    articles.splice(Math.min(1, articles.length), 0, engineArticle(abroad));
  }
  // at least four: the heaviest facts not yet written, in the engine's words
  for (const f of facts.filter((x) => x.kind !== "ship" && !used.has(x.n)).sort((a, b) => b.weight - a.weight)) {
    if (articles.length >= 4) break;
    used.add(f.n);
    articles.push(engineArticle(f));
  }
  const shipFacts = facts.filter((f) => f.kind === "ship");
  const shipping = shipFacts.map((f) => {
    const mine = out.shipping.find((s) => s.ship === f.n);
    const line = mine ? plainEnglish(mine.line) : "";
    const ok = line && line.toLowerCase().includes(f.ship!.name.toLowerCase()) && digits(line).length === 0;
    return { ship: f.n, dir: f.ship!.dir, line: ok ? line : engineShipLine(f) };
  });
  const headline = articles[0]?.headline ?? "THE MORNING PAPER";
  let cry = plainEnglish(out.cry).replace(/\s+/g, " ").trim();
  if (!cry || digits(cry).length || cry.length > 80) cry = `Handelsblad, five centimes! ${cap(headline.toLowerCase())}!`;
  return { day, name: PAPER_NAME, date: dateLine(day), price_c: PAPER_PRICE_C, cry, headline, articles: articles.slice(0, 6), shipping, source: "claude" };
}

// ------------------------------------------------------------------ making and reading

export function paperOf(db: DB, day: number): Paper | null {
  const row = db.prepare("SELECT paper_json FROM newspaper WHERE day = ?").get(day) as { paper_json: string } | undefined;
  return row ? (JSON.parse(row.paper_json) as Paper) : null;
}

export function factsOf(db: DB, day: number): Fact[] {
  const row = db.prepare("SELECT facts_json FROM newspaper WHERE day = ?").get(day) as { facts_json: string } | undefined;
  return row ? (JSON.parse(row.facts_json) as Fact[]) : [];
}

/**
 * Print the day's paper (once): the harbour list into the log, the facts, the model's
 * words or the engine's. The headline goes into the log (the director reads it there)
 * and into the talk of the town (world_fact).
 */
export async function makePaper(db: DB, runner?: Runner, timeoutMs?: number): Promise<{ paper: Paper; error?: string }> {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  const have = paperOf(db, day);
  if (have) return { paper: have };
  writeHarbour(db, day);
  const facts = paperFacts(db, day);
  let paper: Paper | null = null;
  let error: string | undefined;
  const gen = gameGeneration();
  if (canCallPress(db)) {
    const res = await callClaude(db, { hook: "newspaper", system: PAPER_SYSTEM, prompt: paperPrompt(day, facts), schema: PaperSchema, timeoutMs }, runner);
    if (res.ok && res.data) paper = cleanPaper(day, facts, res.data);
    else error = res.error;
  } else error = "no budget";
  if (!paper) paper = enginePaper(day, facts);
  // a new game began while the model wrote: this paper was for the old week
  if (gameGeneration() !== gen) return { paper, error: "new game" };
  // printed while we waited? keep the first
  const again = paperOf(db, day);
  if (again) return { paper: again };
  db.prepare("INSERT INTO newspaper (day, name, price_c, facts_json, paper_json, source, error) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    day,
    PAPER_NAME,
    PAPER_PRICE_C,
    JSON.stringify(facts),
    JSON.stringify(paper),
    paper.source,
    error ?? null,
  );
  const second = paper.articles[1]?.headline;
  writeEvent(db, { kind: "log", verb: "newspaper", text: `${PAPER_NAME} this morning leads with "${paper.headline}"${second ? `; also "${second}"` : ""}.`, weight: 4 });
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 4, ?, 'paper')").run(
    `This morning's ${PAPER_NAME} leads with ${paper.headline.toLowerCase()}: ${paper.articles[0]?.text ?? ""}`.slice(0, 300),
    day,
  );
  return { paper, error };
}

/** Buying a paper (trade.ts ITEM_REF): today's, once; yesterday's is left on a bench. (M8c: the player's own pockets) */
export function paperRef(db: DB): number {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  if (!paperOf(db, day)) throw new GameError("the papers are not in yet; wait a little", 409);
  const mine = db.prepare("SELECT id, ref FROM item WHERE kind = 'newspaper' AND player_id = ?").all(pid()) as Array<{ id: number; ref: number | null }>;
  if (mine.some((m) => m.ref === day)) throw new GameError("you have today's paper already", 409);
  for (const m of mine) db.prepare("DELETE FROM item WHERE id = ?").run(m.id);
  return day;
}
ITEM_REF.newspaper = paperRef;
