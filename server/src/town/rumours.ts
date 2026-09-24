import type { DB } from "../db.ts";
import { town } from "./store.ts";
import type { Resident } from "./population.ts";
import { isAwayVisitor } from "./visitors.ts";
import { VIOLENCE_RE } from "../director/vocab.ts";

// Rumours (M3e): what the town has heard about Jef. A rumour is an npc_memory
// row with a gist (one line others may repeat, "Jef ..."), a tone (-2 bad to
// +2 good) and an origin (the memory it started as). Each game hour, everyone
// who holds a fresh rumour may tell it to a few people of their circle: their
// household, the people they work with, their neighbours. How many depends on
// their gossip stat. Each telling loses weight; below 3 it stops. Nobody hears
// the same rumour twice. The engine owns all of it; no model call.

/** Gossip of the named people (their personas have no gossip stat). */
const NAMED_GOSSIP: Record<string, number> = { fientje: 10, peeters: 6, sooi: 4, tuur: 3 };
/** Whom the named people talk to: residents working at these places. */
const NAMED_CIRCLE: Record<string, string[]> = {
  sooi: ["hessenatie", "rijnkaai"],
  peeters: ["rijnkaai", "back_lane", "bakery_rijn", "cobbler_lane", "tavern:ankere"],
  tuur: ["werf", "rijnkaai", "night", "vismarkt"],
  fientje: ["vismarkt", "rijnkaai", "market:vismarkt", "play:vismarkt", "tavern:vliet", "vleeshuis"],
};

const NEIGHBOUR_M = 30;

export function gossipOf(db: DB, id: string): number {
  if (id in NAMED_GOSSIP) return NAMED_GOSSIP[id];
  return town(db).byId.get(id)?.stats.gossip ?? 5;
}

/** Everyone this person talks to often enough to pass on a rumour, closest ties first. */
export function circleOf(db: DB, id: string): string[] {
  const { town: t, byId } = town(db);
  const me = byId.get(id);
  const out: string[] = [];
  const add = (o: Resident) => {
    if (o.id !== id && !out.includes(o.id) && o.trade !== "infant" && !isAwayVisitor(o)) out.push(o.id);
  };
  if (!me) {
    const where = NAMED_CIRCLE[id] ?? [];
    for (const o of t.residents) if (where.includes(o.work.place) || (id === "fientje" && o.stats.gossip >= 8)) add(o);
    return out;
  }
  for (const o of t.residents) if (o.household === me.household) add(o);
  for (const o of t.residents) if (o.work.place === me.work.place && me.work.place !== "home") add(o);
  for (const o of t.residents) if (Math.hypot(o.home.sx - me.home.sx, o.home.sz - me.home.sz) < NEIGHBOUR_M) add(o);
  // the named people of the quay hear from the people who work there
  for (const [named, where] of Object.entries(NAMED_CIRCLE)) if (where.includes(me.work.place) && !out.includes(named)) out.push(named);
  return out;
}

function nameOf(db: DB, id: string): string {
  return (db.prepare("SELECT name FROM npc WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "someone";
}

/**
 * One round of talk in the town. Returns how many people heard something new.
 * `rng` is a test seam; `maxRows` bounds the work per round.
 */
export function spreadRumours(db: DB, rng: () => number = Math.random, maxRows = 60): number {
  const rows = db
    .prepare(
      `SELECT id, npc_id, weight, gist, tone, COALESCE(origin, id) AS origin, source, told_as
       FROM npc_memory WHERE gist IS NOT NULL AND gist <> '' AND town_spread = 0 AND weight >= 3
       ORDER BY weight DESC, id LIMIT ?`,
    )
    .all(maxRows) as Array<{ id: number; npc_id: string; weight: number; gist: string; tone: number; origin: number; source: string; told_as: string | null }>;
  if (!rows.length) return 0;
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  const knows = db.prepare("SELECT 1 FROM npc_memory WHERE npc_id = ? AND (origin = ? OR id = ?) LIMIT 1");
  const ins = db.prepare(
    `INSERT INTO npc_memory (npc_id, text, source, heard_from, weight, day, spread, gist, tone, origin, town_spread, told_as)
     VALUES (?, ?, 'heard', ?, ?, ?, 1, ?, ?, ?, 0, ?)`,
  );
  const done = db.prepare("UPDATE npc_memory SET town_spread = 1 WHERE id = ?");
  const hh = (id: string) => town(db).byId.get(id)?.household ?? null;
  const exists = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let heard = 0;
  db.transaction(() => {
    for (const r of rows) {
      done.run(r.id);
      const g = gossipOf(db, r.npc_id);
      const k = r.npc_id === "fientje" ? 4 : r.npc_id in NAMED_GOSSIP ? 2 : g <= 1 ? 0 : 1 + Math.floor(g / 4);
      if (!k) continue;
      // M6 families: what someone saw of Jef themselves reaches their own household at home, when they
      // are together (director/families.ts), not through the street's gossip
      const firstHand = r.source === "seen" && r.tone !== 0 && /^Jef\b/.test(r.gist);
      const mine = firstHand ? hh(r.npc_id) : null;
      const circle = circleOf(db, r.npc_id).filter((id) => !knows.get(id, r.origin, r.origin) && exists.get(id) && (mine === null || hh(id) !== mine));
      // closest ties first, with a little chance in who is around to hear it
      const pickFrom = circle.slice(0, Math.max(k * 3, 6));
      const loss = g >= 7 ? 1 : 2;
      const w = r.weight - loss;
      if (w < 1) continue;
      const teller = nameOf(db, r.npc_id);
      for (let i = 0; i < k && pickFrom.length; i++) {
        const [who] = pickFrom.splice(Math.floor(rng() * pickFrom.length), 1);
        // M6: the wording may drift a little at each telling; the fact (gist) stays the engine's
        const told = driftWording(r.told_as ?? r.gist, r.gist, rng);
        ins.run(who, `${teller} told me: ${told}`, r.npc_id, w, day, r.gist, r.tone, r.origin, told === r.gist ? null : told);
        heard++;
      }
    }
  })();
  return heard;
}

/** What someone has heard or seen of Jef, strongest first (for talk). */
export interface Rumour {
  /** As this person says it (it may have drifted in the telling, M6). */
  gist: string;
  /** The engine's fact it started as. */
  fact: string;
  tone: number;
  weight: number;
  source: "seen" | "heard";
  from: string | null;
}

export function rumoursOf(db: DB, id: string, n = 5): Rumour[] {
  const rows = db
    .prepare(
      `SELECT gist, told_as, tone, weight, source, heard_from FROM npc_memory
       WHERE npc_id = ? AND gist IS NOT NULL AND gist <> '' ORDER BY weight DESC, id DESC LIMIT ?`,
    )
    .all(id, n) as Array<{ gist: string; told_as: string | null; tone: number; weight: number; source: "seen" | "heard"; heard_from: string | null }>;
  // M6: they say it as they heard it (the told wording); the engine's fact stays in `fact`
  return rows.map((r) => ({ gist: r.told_as ?? r.gist, fact: r.gist, tone: r.tone, weight: r.weight, source: r.source, from: r.heard_from ? nameOf(db, r.heard_from) : null }));
}

/** The town's feeling about Jef as this person has it: the weighted tone of what they know. */
export function reputationWith(db: DB, id: string): number {
  const rs = rumoursOf(db, id, 8);
  if (!rs.length) return 0;
  const sum = rs.reduce((a, r) => a + r.tone * r.weight, 0);
  const w = rs.reduce((a, r) => a + r.weight, 0);
  return Math.max(-2, Math.min(2, sum / w));
}

/**
 * A line in the speaker's own voice (Steve: Rosalie said Jef stole "from Rosalie's stall"):
 * her own name becomes I, me, my. "Rosalie's stall" -> "my stall", "Rosalie saw it" -> "I saw
 * it", "from Rosalie" -> "from me". Full name first, then the first name.
 */
export function ownVoice(text: string, names: string[]): string {
  let s = text;
  for (const n of names.filter(Boolean).sort((a, b) => b.length - a.length)) {
    const e = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s
      .replace(new RegExp(`\\b${e}'s\\b`, "g"), "my")
      .replace(new RegExp(`\\b${e} (saw|was|is|has|had|said|says|thinks|knows)\\b`, "g"), "I $1")
      .replace(new RegExp(`(^|[.!?]\\s+)${e}\\b`, "g"), "$1I")
      .replace(new RegExp(`\\b(from|to|at|with|of|by|for|off|on|behind|near|past) ${e}\\b`, "g"), "$1 me")
      .replace(new RegExp(`\\b${e}\\b`, "g"), "me");
  }
  // the verb after "I"
  return s
    .replace(/\bI is\b/g, "I am")
    .replace(/\bI has\b/g, "I have")
    .replace(/\bI says\b/g, "I say")
    .replace(/\bI thinks\b/g, "I think")
    .replace(/\bI knows\b/g, "I know");
}

/** "Jef lifted Sooi's goods" -> "you lifted Sooi's goods": for the people's own lines. */
export function toYou(gist: string): string {
  let s = gist.trim().replace(/\.$/, "");
  if (!/^Jef\b/.test(s)) return s;
  s = s
    .replace(/^Jef's\b/, "your")
    .replace(/^Jef\b/, "you")
    .replace(/\bJef's\b/g, "your")
    .replace(/\bJef\b/g, "you")
    .replace(/^you was\b/, "you were")
    .replace(/^you is\b/, "you are")
    .replace(/^you has\b/, "you have")
    .replace(/^you does\b/, "you do")
    .replace(/\bhimself\b/g, "yourself")
    .replace(/\bhis\b/g, "your")
    .replace(/\bhim\b/g, "you");
  return s;
}

// ------------------------------------------------------------------ M6: rumours that twist (within the fact)

/** Groups of words a telling may use only if the fact does: no new theft, blow, police, drink or lie. */
const FACT_GROUPS: RegExp[] = [
  /\b(stole|steal\w*|thie[fv]\w*|robb?\w*|pinch\w*|lifted|made off|pickpocket\w*|pocket)\b/i,
  /\b(beat\w*|knock\w*|hit|struck|strike|punch\w*|shov\w*|fight\w*|fought|brawl\w*|scuffl\w*|kick\w*|blows?)\b/i,
  /\b(police|agent|arrest\w*|cell|fined?|jail|gaol|prison|constable|law)\b/i,
  /\b(drunk\w*|jenever|gin|beer|drink\w*|tipsy|sot)\b/i,
  /\b(lie|lied|lies|liar|cheat\w*|swindl\w*|trick\w*|fraud|crook\w*)\b/i,
];
const NUMBER_WORDS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|hundred|thousand)\b/gi;
const NEGATION = /\b(not|never|no)\b|n't\b/i;
const OK_CAPS = new Set(["Jef", "I", "God"]);

/**
 * Is this telling still the fact? It starts with "Jef" and adds no theft, blow, police, drink or lie
 * the fact lacks, no weapon or killing, no name, number or sum the fact lacks, and turns no "not" round.
 */
export function withinFact(fact: string, told: string): boolean {
  const t = told.trim();
  if (t.length < 8 || t.length > 160 || !/^Jef\b/.test(t)) return false;
  if (VIOLENCE_RE.test(t) && !VIOLENCE_RE.test(fact)) return false;
  for (const g of FACT_GROUPS) if (g.test(t) && !g.test(fact)) return false;
  if (NEGATION.test(t) !== NEGATION.test(fact)) return false;
  const factWords = new Set(fact.toLowerCase().match(/[a-z']+/g) ?? []);
  for (const m of t.match(/\b[A-Z][a-z'-]+/g) ?? []) if (!OK_CAPS.has(m) && !factWords.has(m.toLowerCase())) return false;
  for (const m of t.match(/\d+/g) ?? []) if (!fact.includes(m)) return false;
  for (const m of t.match(NUMBER_WORDS) ?? []) if (!factWords.has(m.toLowerCase())) return false;
  return true;
}

/** The engine's small drifts: another word of the same meaning, or a hedge at the end. */
const SWAPS: Array<[RegExp, string[]]> = [
  [/\bstole\b/, ["pinched", "lifted", "made off with"]],
  [/\bwas rude to\b/, ["was short with", "spoke rough to", "had sharp words for"]],
  [/\bhelped\b/, ["lent a hand to", "gave a hand to"]],
  [/\bcarried\b/, ["hauled", "lugged"]],
  [/\bgave\b/, ["handed", "passed"]],
  [/\btalked strange\b/, ["talked queer", "talked nonsense"]],
  [/\basked after\b/, ["asked about", "was asking after"]],
];
const HEDGES = [", or so they say", ", they say", ", if you believe it", ", so I heard"];

/** A telling: now and then (a third of the time) the words drift a little, always within the fact. */
export function driftWording(told: string, fact: string, rng: () => number = Math.random): string {
  if (rng() >= 0.35) return told;
  const base = told.replace(/\.$/, "");
  const swap = SWAPS.find(([re]) => re.test(base));
  let out = base;
  if (swap && rng() < 0.6) out = base.replace(swap[0], swap[1][Math.floor(rng() * swap[1].length)]);
  else if (!HEDGES.some((h) => base.endsWith(h))) out = base + HEDGES[Math.floor(rng() * HEDGES.length)];
  return withinFact(fact, out) ? out : told;
}
