import { z } from "zod";
import { gameGeneration, type DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { DAY_NAMES } from "../day.ts";
import { writeEvent } from "../director/eventlog.ts";
import { GameError, log } from "../game.ts";
import { applyTrust, remember } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { ITEMS, POCKET_SLOTS } from "../trade.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import { resident, town } from "../town/store.ts";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.ts";
import { houseDoors, walkMap, WALL } from "../town/walkmap.ts";
import { AI_BILL, blankRuns, houseWalls, type BuildData, type PosterWall } from "../../../shared/posterWalls.ts";
import { hasDeeds, THINGS, type DeedRow } from "../town/deeds.ts";
import { policePost } from "../town/police.ts";
import { pressTown } from "../paper/town.ts";
import { canCallIdeas, clamp, d2, digitsOf, GIFTS, namesOk, now, numbersOk, OUT_OF_WORLD, round5, within } from "./common.ts";

// Wall posters (M6 AI ideas). Printed bills pasted on the walls at busy spots.
// The ENGINE picks what goes up, from the log and the calendar, and owns every
// fact and number on them: a wanted bill after a theft (naming Jef only when a
// witness saw him, which makes the next theft riskier: wanted.ts), a lost dog or
// a lost thing (a small errand with a reward the engine pays), the sailings and
// auctions, the town's orders. The model words each bill in 1873 style; a bill
// with a number, a name or a promise the engine did not give gets the engine's
// words. Bills come down after some days, or when the matter is settled.

export type PosterKind = "wanted" | "lost" | "sailing" | "auction" | "order";

export interface PosterText {
  heading: string;
  body: string;
  footer: string;
}

export interface LostThing {
  what: string;
  dog?: { name: string; look: string };
  x: number;
  z: number;
  state: "lying" | "held" | "returned" | "gone";
}

export interface PosterRow {
  id: number;
  kind: PosterKind;
  spot: string;
  day: number;
  hour: number;
  down_day: number;
  status: "up" | "down";
  why_down: string | null;
  ref: string;
  facts_json: string;
  text_json: string;
  source: string;
  names_jef: number;
  reward_c: number;
  owner: string | null;
  thing_json: string;
}

/** At most this many bills on the walls at once, and new ones a morning. */
export const POSTERS_UP_MAX = 9;
export const POSTERS_NEW_A_MORNING = 3;
/** What a wanted bill offers, by the thing taken (engine numbers). */
export const WANTED_REWARD: Record<string, number> = { velocipede: 100, boat: 150, lantern: 40, purse: 50 };
const REACH_M = 3.5;

// ------------------------------------------------------------------ where bills go up

export interface PosterSpot {
  id: string;
  label: string;
  /** The poster's middle on the wall, the way out of the wall, and where Jef stands to read it. */
  x: number;
  z: number;
  out: [number, number];
  at: [number, number];
}

/** Busy places (world metres): the bills go on the nearest house fronts. */
const ANCHORS: Array<{ id: string; label: string; x: number; z: number }> = [
  { id: "rijnkaai", label: "the Rijnkaai", x: 12, z: 44 },
  { id: "vismarkt", label: "the Vismarkt", x: -110, z: 42 },
  { id: "steenplein", label: "the Steenplein", x: -176, z: 34 },
  { id: "werf", label: "the Werf", x: -262, z: 26 },
  { id: "grote_markt", label: "the Grote Markt", x: -246, z: 100 },
  { id: "vleeshuis", label: "the Vleeshuis", x: -122, z: 84 },
  { id: "cathedral", label: "the cathedral square", x: -258, z: 132 },
  { id: "canal", label: "the canal", x: -64, z: 100 },
];

const LABELS: Array<[string, number, number]> = [
  ["the Rijnkaai", 10, 30], ["the Vismarkt", -116, 30], ["the Steenplein", -180, 20], ["the Werf", -270, 9], ["the Grote Markt", -254, 94],
  ["the Vleeshuis", -122, 84], ["the cathedral", -262, 138], ["the canal", -64, 100], ["the Petit Bassin", 120, 117], ["the lock", 96, 26],
];
/** The nearest part of the town, in words ("by the Vismarkt"). */
export function nearLabel(x: number, z: number): string {
  let best = LABELS[0];
  for (const l of LABELS) if (Math.hypot(l[1] - x, l[2] - z) < Math.hypot(best[1] - x, best[2] - z)) best = l;
  return best[0];
}

/** Kept per town (its seed and its post office): a new game may put the post office elsewhere. */
let spotCache: { key: string; spots: PosterSpot[] } | null = null;
let wallCache: { walls: PosterWall[]; lamps: number[][] } | null = null;
function wallsAndLamps(): { walls: PosterWall[]; lamps: number[][] } {
  if (wallCache) return wallCache;
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "city_build.json"), "utf8")) as BuildData;
  const gables = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "city_gable_windows.json"), "utf8")) as { lamps?: number[][] };
  const inWorld = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "inworld_houses.json"), "utf8")) as { houses: Array<{ house: number }> };
  wallCache = { walls: houseWalls(build, inWorld.houses.map((h) => h.house)), lamps: gables.lamps ?? [] };
  return wallCache;
}

/**
 * Two places on a house wall near each busy spot (and by the police post and the post office): plain
 * wall only (M7 posters, Steve 2026-09-26: "posters are also over windows and even ... over a passage"):
 * a blind wall, or the pier between a front's door and its shop window, clear of every window, doorway,
 * passage mouth and door lantern (shared/posterWalls.ts), the house there and the street open before it,
 * and a reachable place to stand and read. The client's poster check (__scheldemist.posters()) tests
 * every one of them against the houses as built.
 */
export function posterSpots(db: DB): PosterSpot[] {
  const post = pressTown(db)?.post;
  const key = `${town(db).town.seed}:${post ? post.step.join(",") : "-"}`;
  if (spotCache?.key === key) return spotCache.spots;
  const wm = walkMap();
  const { walls, lamps } = wallsAndLamps();
  const anchors = ANCHORS.slice();
  const pp = policePost();
  anchors.push({ id: "police", label: pp.label, x: pp.x, z: pp.z });
  if (post) anchors.push({ id: "post", label: "the post office", x: post.step[0], z: post.step[1] });
  const hu = AI_BILL.w / 2;
  const y0 = AI_BILL.y - AI_BILL.h / 2;
  const y1 = AI_BILL.y + AI_BILL.h / 2;
  // every place on a plain stretch of wall, a bill's width apart
  interface Cand { x: number; z: number; out: [number, number]; at: [number, number] }
  const cands: Cand[] = [];
  for (const w of walls) {
    // (a tavern or a home with its inside in the world: its own signs and doors)
    if (w.inWorld) continue;
    for (const [r0, r1] of blankRuns(w, hu, y0, y1, 0.14, 0.6)) {
      const n = Math.max(1, Math.floor((r1 - r0) / 0.9) + 1);
      for (let k = 0; k < n; k++) {
        const s = n === 1 ? (r0 + r1) / 2 : r0 + ((r1 - r0) * k) / (n - 1);
        const x = w.ax + w.tx * s;
        const z = w.az + w.tz * s;
        // the house behind it, and the street before it (at both edges), dry and open
        if (!(wm.flags(x - w.ox * 0.3, z - w.oz * 0.3) & WALL)) continue;
        let open = true;
        for (const e of [-hu, 0, hu]) for (const d of [0.45, 0.9]) if (wm.flags(x + w.tx * e + w.ox * d, z + w.tz * e + w.oz * d) !== 0) open = false;
        if (!open) continue;
        // a door lantern hangs on the wall there
        if (lamps.some(([lx, , lz]) => Math.hypot(lx - x, lz - z) < 0.75)) continue;
        const stand = wm.nearestOpen(x + w.ox * 1.3, z + w.oz * 1.3, 2.5);
        if (!stand || Math.hypot(stand.x - x, stand.z - z) > 3) continue;
        cands.push({ x, z, out: [w.ox, w.oz], at: [+stand.x.toFixed(2), +stand.z.toFixed(2)] });
      }
    }
  }
  const out: PosterSpot[] = [];
  const used: Array<[number, number]> = [];
  for (const a of anchors) {
    const near = cands.filter((c) => Math.hypot(c.x - a.x, c.z - a.z) < 45).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z));
    let n = 0;
    for (const c of near) {
      if (n >= 2) break;
      if (used.some(([ux, uz]) => Math.hypot(ux - c.x, uz - c.z) < 2.5)) continue;
      used.push([c.x, c.z]);
      out.push({ id: `${a.id}:${n}`, label: a.label, x: +c.x.toFixed(3), z: +c.z.toFixed(3), out: [+c.out[0].toFixed(4), +c.out[1].toFixed(4)], at: c.at });
      n++;
    }
  }
  spotCache = { key, spots: out };
  return out;
}

/** A free spot for a bill, the nearest to a point (or the first free of a preferred place). */
function freeSpot(db: DB, near: { x: number; z: number } | null, prefer: string[] = []): PosterSpot | null {
  const taken = new Set((db.prepare("SELECT spot FROM poster WHERE status = 'up'").all() as Array<{ spot: string }>).map((r) => r.spot));
  const free = posterSpots(db).filter((s) => !taken.has(s.id));
  if (!free.length) return null;
  for (const p of prefer) {
    const s = free.find((f) => f.id.startsWith(p + ":"));
    if (s) return s;
  }
  if (near) return free.sort((a, b) => d2(a, near) - d2(b, near))[0];
  return free[0];
}

// ------------------------------------------------------------------ the engine's picks

export interface PosterPlan {
  kind: PosterKind;
  ref: string;
  spot: PosterSpot;
  facts: string[];
  names: string[];
  names_jef: boolean;
  reward_c: number;
  owner: string | null;
  days: number;
  thing?: LostThing;
}

const weekday = (d: number) => DAY_NAMES[(((d - 1) % 7) + 7) % 7];
const hourWords = (h: number) => (h < 12 ? `${h === 0 ? 12 : h} in the morning` : h === 12 ? "noon" : h < 18 ? `${h - 12} in the afternoon` : `${h - 12} at night`);
const hasRef = (db: DB, ref: string) => !!db.prepare("SELECT 1 FROM poster WHERE ref = ?").get(ref);
const upCount = (db: DB) => (db.prepare("SELECT COUNT(*) AS n FROM poster WHERE status = 'up'").get() as { n: number }).n;

/** Wanted bills: Jef's thefts of the last day (named only when someone saw him), and a street robbery that got away. */
export function wantedPlans(db: DB): PosterPlan[] {
  const { day } = now(db);
  const out: PosterPlan[] = [];
  if (hasDeeds(db)) {
    const deeds = db.prepare("SELECT * FROM deed WHERE status = 'open' AND day >= ? ORDER BY id").all(day - 1) as DeedRow[];
    for (const d of deeds) {
      const reward = WANTED_REWARD[d.thing];
      if (!reward || hasRef(db, `deed:${d.id}`)) continue;
      const owner = resident(db, d.owner);
      const ownerName = owner?.name ?? (db.prepare("SELECT name FROM npc WHERE id = ?").get(d.owner) as { name: string } | undefined)?.name ?? "a townsman";
      const noun = THINGS[d.thing]?.noun ?? d.thing;
      const seen = d.seen === 1;
      const facts = [
        `Taken: the ${noun} of ${ownerName}, near ${nearLabel(d.x, d.z)}, on ${weekday(d.day)} at about ${hourWords(d.hour)}.`,
        `Reward: ${reward} centimes, paid by ${ownerName}, for its return or for the thief's name at the police post.`,
        seen
          ? `Seen by ${JSON.parse(d.witnesses).length > 1 ? `${JSON.parse(d.witnesses).length} witnesses` : "a witness"}: the thief is Jef, a young day labourer new to the town, from the Kempen, in a thin coat.`
          : "Nobody saw the thief.",
      ];
      const spot = freeSpot(db, { x: d.x, z: d.z }, seen ? ["police"] : []);
      if (!spot) break;
      out.push({ kind: "wanted", ref: `deed:${d.id}`, spot, facts, names: [ownerName], names_jef: seen, reward_c: reward, owner: d.owner, days: 3 });
    }
  }
  const esc = db.prepare("SELECT id, day, hour, data_json FROM world_event WHERE verb = 'robbery_escaped' AND day >= ? ORDER BY id").all(day - 1) as Array<{ id: number; day: number; hour: number; data_json: string }>;
  for (const e of esc) {
    if (hasRef(db, `we:${e.id}`)) continue;
    if (db.prepare("SELECT 1 FROM world_event WHERE verb = 'robbery_solved' AND ref_id = ?").get(e.id)) continue;
    const data = JSON.parse(e.data_json) as { victim: string; amount_c: number; place?: string };
    const v = resident(db, data.victim);
    if (!v) continue;
    const reward = WANTED_REWARD.purse;
    const facts = [
      `A pickpocket took the purse of ${v.name}, ${data.amount_c} centimes, ${data.place ? `at ${data.place}` : "in the street"}, on ${weekday(e.day)} at about ${hourWords(e.hour)}, and got away.`,
      `Reward: ${reward} centimes from the police for the thief's name, given to an agent of the police.`,
    ];
    const spot = freeSpot(db, null, ["police", "grote_markt", "vismarkt"]);
    if (!spot) break;
    out.push({ kind: "wanted", ref: `we:${e.id}`, spot, facts, names: [v.name], names_jef: false, reward_c: reward, owner: data.victim, days: 3 });
  }
  return out;
}

/** "dog_spotted" -> "spotted": the look in words, never the model's id. */
export const dogWords = (look: string) => look.replace(/^dog_/, "").replace(/_/g, " ");

const LOST_ITEMS = ["a grey wool shawl", "a brass tobacco box", "a string of rosary beads", "a pair of spectacles in a tin case", "a bunch of keys on an iron ring", "a child's rag doll"];

/** A lost dog or a lost thing, now and then: the thing lies at a real, reachable door step elsewhere. */
export function lostPlan(db: DB, rng: () => number): PosterPlan | null {
  const { day } = now(db);
  if ((db.prepare("SELECT COUNT(*) AS n FROM poster WHERE kind = 'lost' AND status = 'up'").get() as { n: number }).n >= 2) return null;
  const pool = town(db).town.residents.filter((r) => r.age >= 18 && r.trade !== "soldier" && r.trade !== "sentry" && r.trade !== "corporal" && r.trade !== "thief" && r.trade !== "emigrant" && r.trade !== "runner");
  if (!pool.length) return null;
  const withDog = pool.filter((r) => r.dog);
  const dog = withDog.length > 0 && rng() < 0.5;
  const owner: Resident = dog ? withDog[Math.floor(rng() * withDog.length)] : pool[Math.floor(rng() * pool.length)];
  if (hasRef(db, `lost:${owner.id}:${day}`)) return null;
  const home = { x: owner.home.sx, z: owner.home.sz };
  const doors = houseDoors().filter((d) => {
    const dd = Math.hypot(d.sx - home.x, d.sz - home.z);
    return dd >= 60 && dd <= 220;
  });
  if (!doors.length) return null;
  const at = doors[Math.floor(rng() * doors.length)];
  const wm = walkMap();
  const p = wm.nearestOpen(at.sx + at.out[0] * 0.8, at.sz + at.out[1] * 0.8, 2) ?? { x: at.sx, z: at.sz };
  const what = dog ? `${owner.first}'s dog ${owner.dog!.name}` : LOST_ITEMS[Math.floor(rng() * LOST_ITEMS.length)];
  const reward = round5(dog ? clamp(20 + owner.stats.wealth * 3, 20, 40) : clamp(10 + owner.stats.wealth * 2, 10, 30));
  const facts = dog
    ? [
        `Lost: a ${dogWords(owner.dog!.look)} dog called ${owner.dog!.name}, since ${weekday(day - 1)} evening. Last seen near ${nearLabel(p.x, p.z)}.`,
        `Reward: ${reward} centimes on bringing him back to the door of ${owner.name}, near ${nearLabel(home.x, home.z)}.`,
      ]
    : [
        `Lost: ${what}, belonging to ${owner.name}, dropped in the street on ${weekday(day - 1)}, somewhere near ${nearLabel(p.x, p.z)}.`,
        `Reward: ${reward} centimes on bringing it back to the door of ${owner.name}, near ${nearLabel(home.x, home.z)}.`,
      ];
  const spot = freeSpot(db, home);
  if (!spot) return null;
  return {
    kind: "lost",
    ref: `lost:${owner.id}:${day}`,
    spot,
    facts,
    names: [owner.name],
    names_jef: false,
    reward_c: reward,
    owner: owner.id,
    days: 3,
    thing: { what, dog: dog ? owner.dog! : undefined, x: +p.x.toFixed(2), z: +p.z.toFixed(2), state: "lying" },
  };
}

/** The steamer days (engine calendar). The Kempenland's days follow town/emigrants.ts (every other day from Tuesday, not Sunday). */
export const SAILINGS: Array<{ key: string; days: number[]; facts: (d: number) => string[] }> = [
  {
    key: "kempenland",
    days: [2, 4, 6],
    facts: (d) => [
      `Red Star Line. The steamer Kempenland, at anchor in the stream, takes passengers for Philadelphia and New York on ${weekday(d)}.`,
      "Lighters from the Rijnkaai from 7 in the morning. Tickets at the Line's office; emigrants lodge at the Logement on the Rijnkaai.",
    ],
  },
  {
    key: "london",
    days: [2, 5],
    facts: (d) => [`The steamer for London sails from the Rijnkaai on ${weekday(d)} at noon, with the tide.`, "Goods and passengers. Cabin and deck. Apply at the quay office."],
  },
  {
    key: "harwich",
    days: [1, 3, 6],
    facts: (d) => [`The mail steamer for Harwich sails from the Werf on ${weekday(d)} at 6 in the evening.`, "Through tickets to London by the Great Eastern railway."],
  },
];

/** Sailings in the next two days not yet on a wall. */
export function sailingPlans(db: DB): PosterPlan[] {
  const { day } = now(db);
  const out: PosterPlan[] = [];
  for (let d = day; d <= day + 1; d++) {
    const wd = ((d - 1) % 7) + 1;
    for (const s of SAILINGS) {
      if (!s.days.includes(wd) || d > 7) continue;
      const ref = `sail:${s.key}:${d}`;
      if (hasRef(db, ref) || (db.prepare("SELECT 1 FROM poster WHERE status = 'up' AND ref LIKE ?").get(`sail:${s.key}:%`))) continue;
      const spot = freeSpot(db, null, s.key === "harwich" ? ["werf", "steenplein"] : ["rijnkaai", "steenplein", "vismarkt"]);
      if (!spot) continue;
      out.push({ kind: "sailing", ref, spot, facts: s.facts(d), names: [], names_jef: false, reward_c: 0, owner: null, days: d - day + 1 });
    }
  }
  return out;
}

/** Auctions: the Berg's sale when a pledge of Jef's runs out, an auction the director planned today, the timber sale. */
export function auctionPlans(db: DB): PosterPlan[] {
  const { day } = now(db);
  const out: PosterPlan[] = [];
  const pawns = db.prepare("SELECT id, item_name, due_day FROM pawn WHERE status = 'held' ORDER BY due_day").all() as Array<{ id: number; item_name: string; due_day: number }>;
  const p = pawns[0];
  if (p && !hasRef(db, `berg:${p.due_day}`)) {
    const spot = freeSpot(db, null, ["vleeshuis", "vismarkt"]);
    if (spot)
      out.push({
        kind: "auction",
        ref: `berg:${p.due_day}`,
        spot,
        facts: [
          `Berg van Barmhartigheid: public sale of pledges not redeemed by the end of ${weekday(p.due_day)}.`,
          "Clothing, linen, tools, clocks, silver and small jewels. Viewing at the Berg by the Vleeshuis.",
        ],
        names: [],
        names_jef: false,
        reward_c: 0,
        owner: null,
        days: Math.max(1, p.due_day - day + 2),
      });
  }
  const evs = db.prepare("SELECT id, title, place, start_m, stages_json FROM town_event WHERE status IN ('planned', 'running') AND (title LIKE '%auction%' OR title LIKE '%sale%')").all() as Array<{ id: number; title: string; place: string; start_m: number; stages_json: string }>;
  for (const e of evs) {
    if (hasRef(db, `ev:${e.id}`)) continue;
    const m = Math.round((e.start_m % 1440) / 15) * 15;
    const label = (JSON.parse(e.stages_json) as Array<{ label?: string }>)[0]?.label ?? e.place;
    const spot = freeSpot(db, null, ["vismarkt", "grote_markt"]);
    if (!spot) continue;
    out.push({ kind: "auction", ref: `ev:${e.id}`, spot, facts: [`${e.title}, at ${label}, today from about ${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}.`], names: [], names_jef: false, reward_c: 0, owner: null, days: 1 });
  }
  const wd = ((day - 1) % 7) + 1;
  if ((wd === 3 || wd === 4) && !hasRef(db, "timber:4")) {
    const spot = freeSpot(db, null, ["werf", "rijnkaai"]);
    if (spot)
      out.push({
        kind: "auction",
        ref: "timber:4",
        spot,
        facts: ["Public sale of Baltic timber, deals and staves, landed from Riga, on Thursday at 10 in the morning on the Werf.", "By order of the owners. Terms at the sale."],
        names: [],
        names_jef: false,
        reward_c: 0,
        owner: null,
        days: 5 - wd,
      });
  }
  return out;
}

/** The town's orders, by the calendar and the log. */
export function orderPlans(db: DB): PosterPlan[] {
  const { day } = now(db);
  const wd = ((day - 1) % 7) + 1;
  const out: PosterPlan[] = [];
  const add = (ref: string, prefer: string[], facts: string[], days: number) => {
    if (hasRef(db, ref)) return;
    const spot = freeSpot(db, null, prefer);
    if (spot) out.push({ kind: "order", ref, spot, facts, names: [], names_jef: false, reward_c: 0, owner: null, days });
  };
  if (wd === 2 || wd === 5) add(`market:${day + 1}`, ["grote_markt", "cathedral"], [`Market on the Grote Markt on ${weekday(day + 1)}, from half past 7 in the morning. Carts and stalls off the square by 2 in the afternoon.`, "By order of the burgomaster and aldermen."], 2);
  if (day >= 1) add("order:quays", ["rijnkaai", "steenplein", "werf"], ["No loitering on the quays after 10 at night. Nobody to cross the quay rails while the wagons move.", "By order of the commissioner of police."], 4);
  if (day >= 2) add("order:dogs", ["vismarkt", "canal", "grote_markt"], ["Dogs in the street to be muzzled or on a lead until the end of October, for fear of madness.", "Dogs found loose will be taken up. By order of the burgomaster."], 4);
  const thefts = (db.prepare("SELECT COUNT(*) AS n FROM world_event WHERE day >= ? AND verb IN ('robbed', 'street_robbery', 'robbery_escaped', 'stole')").get(day - 1) as { n: number }).n;
  if (thefts >= 1) add(`order:pickpockets:${day}`, ["police", "vismarkt", "grote_markt"], ["Beware of pickpockets at the markets, the shows and the quays. Keep your purse inside your coat.", "Report every theft to the police post by the town hall. By order of the commissioner of police."], 2);
  return out;
}

// ------------------------------------------------------------------ words

export const PosterBatchSchema = z.object({
  posters: z
    .array(z.object({ n: z.number().int(), heading: z.string().min(2).max(50), body: z.string().min(10).max(380), footer: z.string().max(100) }))
    .max(8),
});
export type PosterBatch = z.infer<typeof PosterBatchSchema>;

export const POSTER_SYSTEM = `You set the type for printed bills pasted on the walls of Antwerp, October 1873.
Bills of the time are short and plain: a big heading (WANTED, LOST, REWARD, NOTICE, RED STAR LINE, PUBLIC SALE),
two or three short sentences, and a line at the foot saying who orders or pays.

${LANGUAGE_RULE}
No modern words. Write sums as digits with "centimes".

You only word the FACTS given for each bill. Never add a name, a sum, a date, a time, a place or a promise that is
not in its facts. The engine owns every fact and number. Keep to the JSON schema. Never mention a game or anything outside 1873.`;

export function posterPrompt(plans: PosterPlan[]): string {
  return `Word these bills, one each, by number ("n").

${plans.map((p, i) => `BILL ${i + 1} (${p.kind})\n${p.facts.map((f) => "- " + f).join("\n")}`).join("\n\n")}

WRITE for each bill: n; heading (a few words, capitals); body (2 or 3 short sentences, only the facts); footer (who orders or pays, from the facts, or "").`;
}

/** The engine's own words for a bill. */
export function engineText(p: PosterPlan): PosterText {
  const heads: Record<PosterKind, string> = {
    wanted: p.names_jef ? "WANTED: JEF" : "THEFT. REWARD",
    lost: p.thing?.dog ? "LOST DOG. REWARD" : "LOST. REWARD",
    sailing: p.ref.startsWith("sail:kempenland") ? "RED STAR LINE" : "SAILINGS",
    auction: "PUBLIC SALE",
    order: "NOTICE",
  };
  const foot: Record<PosterKind, string> = {
    wanted: "Information to the police post by the town hall.",
    lost: "",
    sailing: "",
    auction: "",
    order: "",
  };
  const [first, ...rest] = p.facts;
  const by = rest.find((f) => /^By order/.test(f));
  return { heading: heads[p.kind], body: [first, ...rest.filter((f) => f !== by)].join(" "), footer: by ?? foot[p.kind] };
}

/** Check the model's words for one bill; anything off gives way to the engine's words. */
export function cleanPoster(db: DB, p: PosterPlan, out: { heading: string; body: string; footer: string }): PosterText | null {
  const heading = plainEnglish(out.heading).toUpperCase().slice(0, 50);
  const body = plainEnglish(out.body);
  const footer = plainEnglish(out.footer).slice(0, 100);
  const all = `${heading} ${body} ${footer}`;
  if (!numbersOk(all, digitsOf(...p.facts))) return null;
  if (!namesOk(db, all, p.names, p.names_jef)) return null;
  if (GIFTS.test(all) || OUT_OF_WORLD.test(all)) return null;
  // the reward, when there is one, must be on the bill as the engine set it
  if (p.reward_c && !all.includes(String(p.reward_c))) return null;
  // a bill that names Jef must be one the engine allowed to (a witness saw him)
  if (body.length < 10) return null;
  return { heading, body, footer };
}

// ------------------------------------------------------------------ putting them up

function insertPoster(db: DB, p: PosterPlan, text: PosterText, source: string): number {
  const { day, hour } = now(db);
  const id = Number(
    db
      .prepare(
        `INSERT INTO poster (kind, spot, day, hour, down_day, status, ref, facts_json, text_json, source, names_jef, reward_c, owner, thing_json)
         VALUES (?, ?, ?, ?, ?, 'up', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(p.kind, p.spot.id, day, hour, day + Math.max(1, p.days) - 1, p.ref, JSON.stringify(p.facts), JSON.stringify(text), source, p.names_jef ? 1 : 0, p.reward_c, p.owner, JSON.stringify(p.thing ?? {})).lastInsertRowid,
  );
  writeEvent(db, {
    kind: "log",
    verb: "poster_up",
    text: `A bill went up at ${p.spot.label}: ${text.heading}. ${p.facts[0]}`.slice(0, 300),
    actor: p.owner,
    weight: p.kind === "wanted" ? (p.names_jef ? 6 : 4) : 2,
    data: { poster: id, kind: p.kind },
  });
  if (p.kind === "wanted" && p.names_jef) {
    db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 6, ?, 'notice,poster')").run(`A bill at ${p.spot.label} says Jef, the new day labourer, is wanted for a theft; ${p.reward_c} centimes reward.`, day);
  }
  return id;
}

/**
 * Put up the bills the engine picked: one call words them all (or the engine does),
 * each checked on its own. Returns the new poster ids.
 */
export async function putUp(db: DB, plans: PosterPlan[], opts: { runner?: Runner; timeoutMs?: number } = {}): Promise<number[]> {
  if (!plans.length) return [];
  let words: Array<PosterText | null> = plans.map(() => null);
  let source = "engine";
  const gen = gameGeneration();
  if (canCallIdeas(db)) {
    const res = await callClaude(db, { hook: "poster", system: POSTER_SYSTEM, prompt: posterPrompt(plans), schema: PosterBatchSchema, timeoutMs: opts.timeoutMs }, opts.runner);
    if (res.ok && res.data) {
      source = "claude";
      const seen = new Set<number>();
      words = plans.map((p, i) => {
        const o = res.data!.posters.find((x) => x.n === i + 1 && !seen.has(x.n));
        if (!o) return null;
        seen.add(o.n);
        return cleanPoster(db, p, o);
      });
    }
  }
  // a new game began while the model wrote: these bills were for the old week
  if (gameGeneration() !== gen) return [];
  // the spots may have been taken while the model wrote
  const ids: number[] = [];
  db.transaction(() => {
    plans.forEach((p, i) => {
      if (hasRef(db, p.ref)) return;
      if (db.prepare("SELECT 1 FROM poster WHERE status = 'up' AND spot = ?").get(p.spot.id)) {
        const s = freeSpot(db, p.thing ? { x: p.thing.x, z: p.thing.z } : null);
        if (!s) return;
        p = { ...p, spot: s };
      }
      const w = words[i];
      ids.push(insertPoster(db, p, w ?? engineText(p), w ? source : "engine"));
    });
  })();
  return ids;
}

/** The morning's bills: wanted, lost, sailings, auctions, orders (at most three new, nine up). */
export function morningPlans(db: DB, rng?: () => number): PosterPlan[] {
  const { day } = now(db);
  const r = rng ?? rngFrom(((town(db).town.seed || 1873) * 17 + day * 7919) >>> 0);
  const room = Math.max(0, Math.min(POSTERS_NEW_A_MORNING, POSTERS_UP_MAX - upCount(db)));
  if (!room) return [];
  const picks: PosterPlan[] = [];
  const spots = new Set<string>();
  const take = (ps: PosterPlan[]) => {
    for (let p of ps) {
      if (picks.length >= room) return;
      if (spots.has(p.spot.id)) {
        const s = posterSpots(db).find((x) => !spots.has(x.id) && !db.prepare("SELECT 1 FROM poster WHERE status = 'up' AND spot = ?").get(x.id));
        if (!s) continue;
        p = { ...p, spot: s };
      }
      spots.add(p.spot.id);
      picks.push(p);
    }
  };
  take(wantedPlans(db));
  if (r() < 0.55) {
    const l = lostPlan(db, r);
    if (l) take([l]);
  }
  take(sailingPlans(db));
  take(auctionPlans(db));
  take(orderPlans(db));
  return picks;
}

/** Bills whose day is over, or whose matter is settled, come down; a reward is paid when a robbery Jef named is solved. */
export function takeDown(db: DB): Array<{ id: number; why: string; paid_c?: number }> {
  const { day } = now(db);
  const out: Array<{ id: number; why: string; paid_c?: number }> = [];
  const down = (id: number, why: string) => db.prepare("UPDATE poster SET status = 'down', why_down = ? WHERE id = ?").run(why, id);
  for (const p of db.prepare("SELECT * FROM poster WHERE status = 'up'").all() as PosterRow[]) {
    if (p.ref.startsWith("deed:") && hasDeeds(db)) {
      const d = db.prepare("SELECT status FROM deed WHERE id = ?").get(Number(p.ref.slice(5))) as { status: string } | undefined;
      if (d && d.status !== "open") {
        down(p.id, `settled: ${d.status}`);
        out.push({ id: p.id, why: "settled" });
        continue;
      }
    }
    if (p.ref.startsWith("we:")) {
      const solved = db.prepare("SELECT id FROM world_event WHERE verb = 'robbery_solved' AND ref_id = ?").get(Number(p.ref.slice(3))) as { id: number } | undefined;
      if (solved) {
        // Jef told the police and the thief was found: the police pay the bill's reward, once
        // (the bill comes down in the same transaction as the pay, and only if it was still up)
        const paid = db.transaction(() => {
          if (db.prepare("UPDATE poster SET status = 'down', why_down = 'solved' WHERE id = ? AND status = 'up'").run(p.id).changes !== 1) return false;
          db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(p.reward_c);
          log(db, "reward_paid", String(p.id), `The police paid Jef the ${p.reward_c} centimes reward on the bill: the pickpocket he named was found.`);
          return true;
        })();
        if (paid) out.push({ id: p.id, why: "solved", paid_c: p.reward_c });
        continue;
      }
    }
    const thing = JSON.parse(p.thing_json) as Partial<LostThing>;
    if (p.kind === "lost" && thing.state === "returned") {
      down(p.id, "found");
      out.push({ id: p.id, why: "found" });
      continue;
    }
    if (day > p.down_day) {
      down(p.id, "old");
      if (p.kind === "lost" && thing.state === "lying") db.prepare("UPDATE poster SET thing_json = ? WHERE id = ?").run(JSON.stringify({ ...thing, state: "gone" }), p.id);
      out.push({ id: p.id, why: "old" });
    }
  }
  return out;
}

// ------------------------------------------------------------------ reading and the lost things

export function posterView(db: DB) {
  const spots = new Map(posterSpots(db).map((s) => [s.id, s]));
  const rows = db.prepare("SELECT * FROM poster WHERE status = 'up' ORDER BY id").all() as PosterRow[];
  const lost = db.prepare("SELECT * FROM poster WHERE kind = 'lost' ORDER BY id").all() as PosterRow[];
  return {
    posters: rows
      .map((p) => ({ id: p.id, kind: p.kind, spot: spots.get(p.spot) ?? null, day: p.day, text: JSON.parse(p.text_json) as PosterText, names_jef: !!p.names_jef, reward_c: p.reward_c, source: p.source }))
      .filter((p) => p.spot),
    /** Lost things lying about, or following Jef (a dog), and where each goes back. */
    lost: lost
      .map((p) => {
        const t = JSON.parse(p.thing_json) as LostThing;
        const o = p.owner ? resident(db, p.owner) : undefined;
        return { poster: p.id, what: t.what, dog: t.dog ?? null, x: t.x, z: t.z, state: t.state, owner: p.owner, owner_name: o?.name ?? null, door: o ? [o.home.sx, o.home.sz] : null, reward_c: p.reward_c };
      })
      .filter((l) => l.state === "lying" || l.state === "held"),
  };
}

function lostRow(db: DB, posterId: number): { p: PosterRow; t: LostThing } {
  const p = db.prepare("SELECT * FROM poster WHERE id = ? AND kind = 'lost'").get(posterId) as PosterRow | undefined;
  if (!p) throw new GameError("no such bill", 404);
  return { p, t: JSON.parse(p.thing_json) as LostThing };
}

/** E at the lost thing: it goes in a pocket (a dog comes along on your belt). */
export function pickLost(db: DB, posterId: number, at: { x: number; z: number }): { text: string } {
  const { p, t } = lostRow(db, posterId);
  if (t.state !== "lying") throw new GameError("it is not there any more", 409);
  if (!within(at, t, REACH_M)) throw new GameError("you are not there yet", 409);
  if (!t.dog && (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n >= POCKET_SLOTS) throw new GameError("your pockets are full", 409);
  db.transaction(() => {
    db.prepare("UPDATE poster SET thing_json = ? WHERE id = ?").run(JSON.stringify({ ...t, state: "held" }), p.id);
    if (!t.dog) db.prepare("INSERT INTO item (kind, job_id, ref) VALUES ('found', NULL, ?)").run(p.id);
    log(db, "found_lost", p.owner, t.dog ? `Jef found ${t.what}, the lost dog on the bill.` : `Jef found ${t.what}, lost by ${resident(db, p.owner ?? "")?.name ?? "someone"}.`);
  })();
  return { text: t.dog ? `${t.dog.name} sniffs your hand and lets you tie your belt to the collar.` : `You pick up ${t.what}. The bill said: back to the door of its owner.` };
}

/** E at the owner's door with the thing: the engine pays the bill's reward, trust +1, a memory. */
export function returnLost(db: DB, posterId: number, at: { x: number; z: number }): { text: string; paid_c: number } {
  const { p, t } = lostRow(db, posterId);
  if (t.state !== "held") throw new GameError("you do not have it", 409);
  const o = p.owner ? resident(db, p.owner) : undefined;
  if (!o) throw new GameError("nobody to give it to", 409);
  if (!within(at, { x: o.home.sx, z: o.home.sz }, REACH_M)) throw new GameError("this is not their door", 409);
  db.transaction(() => {
    db.prepare("UPDATE poster SET thing_json = ?, status = 'down', why_down = 'found' WHERE id = ?").run(JSON.stringify({ ...t, state: "returned" }), p.id);
    db.prepare("DELETE FROM item WHERE kind = 'found' AND ref = ?").run(p.id);
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(p.reward_c);
    log(db, "returned_lost", o.id, `Jef brought ${t.what} back to ${o.name} and had the ${p.reward_c} centimes on the bill.`);
  })();
  applyTrust(db, o.id, 1, 0);
  remember(db, o.id, `Jef, the new day labourer, brought back ${t.dog ? `my dog ${t.dog.name}` : t.what} after I put up a bill. I paid him the reward.`, 6, "seen", null, { gist: `Jef brought ${o.first}'s ${t.dog ? "lost dog" : "lost things"} back for the reward`, tone: 1 });
  return { text: `${o.first} opens the door${t.dog ? ` and ${t.dog.name} bounds in` : ""}. "Well I never." ${p.reward_c} centimes, as the bill said.`, paid_c: p.reward_c };
}

ITEMS.found = { name: "something lost", note: "Somebody put up a bill for this. Bring it back to their door." };
