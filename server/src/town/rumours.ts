import type { DB } from "../db.ts";
import { town } from "./store.ts";
import type { Resident } from "./population.ts";

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
    if (o.id !== id && !out.includes(o.id) && o.trade !== "infant") out.push(o.id);
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
      `SELECT id, npc_id, weight, gist, tone, COALESCE(origin, id) AS origin
       FROM npc_memory WHERE gist IS NOT NULL AND gist <> '' AND town_spread = 0 AND weight >= 3
       ORDER BY weight DESC, id LIMIT ?`,
    )
    .all(maxRows) as Array<{ id: number; npc_id: string; weight: number; gist: string; tone: number; origin: number }>;
  if (!rows.length) return 0;
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  const knows = db.prepare("SELECT 1 FROM npc_memory WHERE npc_id = ? AND (origin = ? OR id = ?) LIMIT 1");
  const ins = db.prepare(
    `INSERT INTO npc_memory (npc_id, text, source, heard_from, weight, day, spread, gist, tone, origin, town_spread)
     VALUES (?, ?, 'heard', ?, ?, ?, 1, ?, ?, ?, 0)`,
  );
  const done = db.prepare("UPDATE npc_memory SET town_spread = 1 WHERE id = ?");
  const exists = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let heard = 0;
  db.transaction(() => {
    for (const r of rows) {
      done.run(r.id);
      const g = gossipOf(db, r.npc_id);
      const k = r.npc_id === "fientje" ? 4 : r.npc_id in NAMED_GOSSIP ? 2 : g <= 1 ? 0 : 1 + Math.floor(g / 4);
      if (!k) continue;
      const circle = circleOf(db, r.npc_id).filter((id) => !knows.get(id, r.origin, r.origin) && exists.get(id));
      // closest ties first, with a little chance in who is around to hear it
      const pickFrom = circle.slice(0, Math.max(k * 3, 6));
      const loss = g >= 7 ? 1 : 2;
      const w = r.weight - loss;
      if (w < 1) continue;
      const teller = nameOf(db, r.npc_id);
      for (let i = 0; i < k && pickFrom.length; i++) {
        const [who] = pickFrom.splice(Math.floor(rng() * pickFrom.length), 1);
        ins.run(who, `${teller} told me: ${r.gist}`, r.npc_id, w, day, r.gist, r.tone, r.origin);
        heard++;
      }
    }
  })();
  return heard;
}

/** What someone has heard or seen of Jef, strongest first (for talk). */
export interface Rumour {
  gist: string;
  tone: number;
  weight: number;
  source: "seen" | "heard";
  from: string | null;
}

export function rumoursOf(db: DB, id: string, n = 5): Rumour[] {
  const rows = db
    .prepare(
      `SELECT gist, tone, weight, source, heard_from FROM npc_memory
       WHERE npc_id = ? AND gist IS NOT NULL AND gist <> '' ORDER BY weight DESC, id DESC LIMIT ?`,
    )
    .all(id, n) as Array<{ gist: string; tone: number; weight: number; source: "seen" | "heard"; heard_from: string | null }>;
  return rows.map((r) => ({ gist: r.gist, tone: r.tone, weight: r.weight, source: r.source, from: r.heard_from ? nameOf(db, r.heard_from) : null }));
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
