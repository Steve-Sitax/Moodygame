import { z } from "zod";
import { weather, WEATHER_TEXT } from "../day.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import type { DB, Faction } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { asPlayer, pid } from "../player/current.ts";
import { readText } from "../player/names.ts";
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import { NIGHT_GIVERS, TOWN_EMPLOYERS } from "../town/places.ts";
import { realS } from "../../../shared/clock.ts";
import {
  CART_JOBS_PER_BOARD,
  CART_MAX,
  CART_MAX_MIN,
  CART_MIN,
  carryBand,
  cartCap,
  cartMinutes,
  cartWorkOpen,
  HAND_MAX,
  HAND_MAX_MIN,
  handMinutes,
  NO_CART_FROM,
  NO_CART_SPOTS,
  sayCount,
  walkDist,
} from "./loads.ts";

// job_board hook, docs/03. Claude writes the words and picks from engine
// lists (goods, places, twist). The engine owns pay, counts, time limits,
// and turns every pick into a task the 3D game can play (M2b).

export const TASK_TYPES = ["carry", "watch", "deliver", "row", "find", "talk"] as const;
// M6: "letters" (a round of doors and counters: the post office's letters, a letter's errand) is
// never on the model's list; the engine builds those jobs itself (paper/post.ts)
// M7 mills: "mill" (an hour's help at a mill on the wall) is the engine's own too (town/mills.ts)
export const PLAYABLE = new Set<string>(["carry", "watch", "deliver", "letters", "mill"]);

export const GOODS = ["crates", "sacks", "barrels", "hides", "rope", "parcel"] as const;
// M6 emigrants (town/emigrants.ts): "chests" is never on the model's list; the engine builds those errands itself
export type Goods = (typeof GOODS)[number] | "chests";

type SpotId = Exclude<keyof typeof SPOT_TABLE, "_note">;
export const SPOT_IDS = Object.keys(SPOT_TABLE).filter((k) => !k.startsWith("_")) as SpotId[];
export const SPOTS = SPOT_TABLE as unknown as Record<SpotId, { label: string; desc: string; x: number; z: number }>;

export const TWISTS = [
  "none",
  "broken_goods",
  "stranger_offer",
  "foreman_watches",
  "thick_fog",
  "heavy_load",
  "thief",
  "bribe",
] as const;
export type Twist = (typeof TWISTS)[number];

/** Which twists each task type can play. Anything else becomes "none". */
const TWISTS_FOR: Record<string, readonly Twist[]> = {
  carry: ["none", "broken_goods", "stranger_offer", "foreman_watches", "thick_fog", "heavy_load"],
  watch: ["none", "thief", "bribe", "foreman_watches", "thick_fog"],
  deliver: ["none", "stranger_offer", "thick_fog"],
};

/** Employers that hire on the Rijnkaai. Engine knows their faction and door. */
export const EMPLOYERS = {
  sooi: {
    name: "Sooi",
    faction: "naties",
    door: "hessenatie_door",
    note: "foreman of the Hessenatie, gruff but fair, hires day men at dawn",
  },
  peeters: {
    name: "Widow Peeters",
    faction: "burgerij",
    door: "peeters_dock",
    note: "ship chandler, careful with money, remembers favours",
  },
  tuur: {
    name: "Tuur",
    faction: "smokkelaars",
    door: "pier_head",
    note: "ferryman and night lighter, pays for silence, asks few questions",
  },
} as const satisfies Record<string, { name: string; faction: Faction; door: SpotId; note: string }>;

/** The ground of the first three employers: the eight spots of M2 (unchanged). */
const RIJNKAAI_SPOTS: SpotId[] = ["pier_head", "crane_foot", "hessenatie_door", "katoen_door", "peeters_dock", "ship_gangway", "west_sheds", "east_carts"];

export interface EmployerDef {
  faction: Faction;
  door: SpotId;
  note: string;
  /** The spots their work may use: from, to, post. The engine holds them to it. */
  area: SpotId[];
  /** A townsperson (M3e): the name comes from the town, the id is fixed. */
  town: boolean;
  /** Fixed name (the Rijnkaai three). */
  name?: string;
  /** M7 night: a giver of night work (night/nightwork.ts); never on the day board. */
  night?: boolean;
}

/**
 * Everyone who hires (M3e): the three of the Rijnkaai and the five townspeople
 * at the other quays (town/places.ts TOWN_EMPLOYERS).
 */
export const ALL_EMPLOYERS: Record<string, EmployerDef> = {
  ...Object.fromEntries(Object.entries(EMPLOYERS).map(([id, e]) => [id, { ...e, area: RIJNKAAI_SPOTS, town: false }])),
  ...Object.fromEntries(TOWN_EMPLOYERS.map((e) => [e.id, { faction: e.faction, door: e.spot as SpotId, note: e.note, area: e.area as SpotId[], town: true }])),
  // M7 night: the givers of night work (town/places.ts NIGHT_GIVERS); their work is the night board's
  ...Object.fromEntries(NIGHT_GIVERS.map((e) => [e.id, { faction: e.faction, door: e.spot as SpotId, note: e.note, area: e.area as SpotId[], town: true, night: true }])),
};
/** Who may hire on the day board (the model's list): everyone but the night's givers. */
export const EMPLOYER_IDS = Object.keys(ALL_EMPLOYERS).filter((id) => !ALL_EMPLOYERS[id].night) as [string, ...string[]];
export type EmployerId = string;

/** An employer's name: fixed for the Rijnkaai three, from the town for the others. */
export function employerName(db: DB, id: string): string {
  const e = ALL_EMPLOYERS[id];
  if (e?.name) return e.name;
  return (db.prepare("SELECT name FROM npc WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? id;
}

/** docs/01 tier table. */
export const TIER_PAY: Array<[number, number]> = [
  [50, 150],
  [150, 300],
  [300, 600],
  [600, 1500],
  [1500, 3000],
];
const TIER_TRUST = [0, 3, 5, 7, 9];

const enumOf = <T extends string>(xs: readonly T[]) => z.enum(xs as [T, ...T[]]);

// What the model may return. Anything else is rejected.
export const BoardSchema = z.object({
  jobs: z
    .array(
      z.object({
        title: z.string().min(3).max(70),
        employer: enumOf(EMPLOYER_IDS),
        task_type: z.enum(TASK_TYPES),
        goods: z.enum(GOODS),
        from: enumOf(SPOT_IDS),
        to: enumOf(SPOT_IDS),
        twist: z.enum(TWISTS),
        urgent: z.boolean(),
        recipient: z.string().max(60),
        pay_c: z.number().int(),
        risk: z.enum(["low", "medium", "high"]),
        pitch: z.string().min(10).max(360),
        // M7 short jobs: carry only. How many things (by hand 1 or 2; with a cart 3 to 8), and cart work
        // (the employer lends his handcart). Proposals: the engine clamps both (hooks/loads.ts).
        items: z.number().int().optional(),
        cart: z.boolean().optional(),
      }),
    )
    .min(3)
    .max(7),
});
export type Board = z.infer<typeof BoardSchema>;
type BoardJob = Board["jobs"][number];

export interface Progress {
  delivered: number;
  lost: number;
  sold: number;
}

export interface CarryTask {
  kind: "carry";
  goods: Goods;
  count: number;
  from: SpotId;
  to: SpotId;
  twist: Twist;
  limit_s: number | null;
  progress?: Progress;
  /** M7 short jobs: cart work (3 to 8 things, one load): the employer's handcart is lent at the start (town/handcart.ts). */
  cart?: boolean;
}
export interface WatchTask {
  kind: "watch";
  goods: Goods;
  post: SpotId;
  duration_s: number;
  twist: Twist;
}
export interface DeliverTask {
  kind: "deliver";
  goods: Goods;
  from: SpotId;
  to: SpotId;
  recipient: string;
  twist: Twist;
  limit_s: number | null;
  progress?: Progress;
}
/** M6: one stop of a letters round: a door to put a letter under, or the telegraph counter. */
export interface RoundStop {
  /** The addressee (a resident), or "telegraph". */
  id: string;
  name: string;
  x: number;
  z: number;
  what: "door" | "telegraph";
  /** Set by the engine when the stop is done (paper/post.ts), never by the client. */
  done?: boolean;
}
/** M6: a round of letters (paper/post.ts). Engine-built; the engine counts the stops done. */
export interface LettersTask {
  kind: "letters";
  goods: "letters";
  /** Where the letters are picked up: the post office counter or the sender's door. */
  from: { x: number; z: number; label: string };
  stops: RoundStop[];
  /** Paid at the telegraph counter by Jef, given back in the pay. */
  fee_c: number;
  /** The words of a telegram (at most 20), shown when it is sent. */
  words?: string;
  city?: string;
  picked?: boolean;
  twist: "none";
  limit_s: null;
  progress?: Progress;
}
/**
 * M7 mills (town/mills.ts): an hour's help at a mill on the wall. Stay by the mill; when the miller calls,
 * turn the cap into the wind at the capstan (or up on the gallery). Engine-built; the engine pays by the turns done.
 */
export interface MillTask {
  kind: "mill";
  goods: "sacks";
  mill: string;
  /** The mill's door (the post) and where the cap is turned, on the walk on top of the wall. */
  post: { x: number; z: number; label: string };
  capstan: { x: number; z: number };
  duration_s: number;
  /** How many times the miller will call for the cap to be turned. */
  turns: number;
  twist: "none";
  limit_s: null;
}
export type Task = CarryTask | WatchTask | DeliverTask | LettersTask | MillTask;

export interface JobRow {
  id: number;
  day: number;
  title: string;
  employer_npc: string;
  employer_name: string;
  district: string;
  task_type: string;
  pay_c: number;
  risk: string;
  tier: number;
  pitch: string;
  task: Task | null;
  source: string;
  status: string;
  playable: boolean;
  outcome_text: string | null;
  /** M8c: the player who has it in hand (null or missing: none, or an older save's host). */
  taken_by?: number | null;
}

export const SYSTEM = `You write for Scheldemist, a game set in Antwerp, autumn 1873.
The player is Jef, a farm boy from the Kempen, new in the city with no money and no name.
He finds day work on the docks, eats, keeps warm, and builds a name.

Setting facts you may use: the Scheldt toll was bought out in 1863 and the port is booming.
The Red Star Line starts sailing to America this year. The naties (Hessenatie, Katoennatie)
hire day men at dawn on the quays. Gas lamps, river fog, cholera still remembered from 1866.
The Rijnkaai has warehouses, one crane, a wooden pier, ships moored alongside.

${LANGUAGE_RULE}
Voice: terse. Period flavour.
No modern words, no modern money, no exclamation storms. Money is in centimes; 100 centimes = 1 franc.

You only write text and pick from the lists you are given. The game engine owns every number
and rule. Keep to the JSON schema. Never mention the game, the player's keyboard,
or anything outside 1873 Antwerp.`;

export function buildPrompt(db: DB): string {
  // (M8c: the player's own money and trust, the world's clock; makeBoard writes the board for the host)
  const p = db.prepare("SELECT p.name, p.money_c, w.day, w.hour FROM player p, player w WHERE p.id = ? AND w.id = 1").get(pid()) as {
    name: string;
    money_c: number;
    day: number;
    hour: number;
  };
  const trust = db.prepare("SELECT faction, trust FROM faction_trust WHERE player_id = ? ORDER BY faction").all(pid()) as Array<{
    faction: string;
    trust: number;
  }>;
  const sky = WEATHER_TEXT[weather(db)];
  const log = (db.prepare("SELECT text FROM log ORDER BY id DESC LIMIT 6").all() as Array<{ text: string }>).map((l) => ({ text: readText(db, l.text) }));
  const tier = maxTier(db);
  const [lo, hi] = TIER_PAY[tier];
  const [hlo, hhi] = carryBand([lo, hi], false);
  const [clo, chi] = carryBand([lo, hi], true);
  const carts = cartWorkOpen(db);

  return `Write the job board for the hiring spot on the Rijnkaai. It carries work from all the quays of the town.

WORLD STATE
Day ${p.day} of 7, hour ${p.hour}. Weather: ${sky}.
${p.name} has ${p.money_c} centimes. Trust per faction (-5 to 10; below 0 they dislike Jef): ${trust.map((t) => `${t.faction} ${t.trust}`).join(", ")}.
Only tier ${tier} work is open to him.

EMPLOYERS WHO HIRE (id: name, what they are. Their own places: only these ids for their "from" and "to")
${Object.entries(ALL_EMPLOYERS)
  .filter(([, e]) => !e.night)
  .map(([id, e]) => `- ${id}: ${employerName(db, id)}, ${e.note}. Their door: ${e.door}. Their places: ${e.area.join(", ")}.`)
  .join("\n")}

PLACES (use these ids for "from" and "to")
${SPOT_IDS.map((id) => `- ${id}: ${SPOTS[id].desc}`).join("\n")}

RECENT LOG (newest first)
${log.map((l) => "- " + l.text).join("\n")}

KINDS OF WORK
- carry: move goods from "from" to "to". Twists: none, broken_goods, stranger_offer, foreman_watches, thick_fog, heavy_load.
  By hand it is short work: "items" 1 or 2, never more, and places close together (well under an hour's work). Pay ${hlo} to ${hhi}.
${
  carts
    ? `  Cart work (at most ${CART_JOBS_PER_BOARD} on the board, and not every day): "cart": true, "items" ${CART_MIN} to ${CART_MAX}; the employer lends his handcart at the start and wants it back where it stood. Never from or to ${NO_CART_SPOTS.join(", ")}; never from ${NO_CART_FROM.filter((x) => !NO_CART_SPOTS.includes(x)).join(", ")}. Pay ${clo} to ${chi}.`
    : `  No cart work yet: "cart": false on every job.`
}
- watch: stand guard over goods at "to" until the bell. "from" is ignored. Twists: none, thief, bribe, foreman_watches, thick_fog.
- deliver: take one item from the employer's door to a person at "to". Name that person in "recipient" (short, e.g. "the mate of the Anna Maria"). Twists: none, stranger_offer, thick_fog.
- goods is one of: ${GOODS.join(", ")}. Pick what fits the pitch.
- items and cart matter only for carry; give items 1 and cart false for the other kinds. A carry pitch names exactly "items" things ("two sacks" only with items 2). The engine may make it fewer when the places lie far apart, and rewrites the number.
- twist is a hidden turn in the job. The pitch may hint at it but must not give it away. Use "none" for about a third of the jobs.
- urgent: true if the pitch sets a deadline ("before the bell", "before the tide").
- recipient: empty string unless the job is deliver.

RULES FOR THE BOARD
- 4 to 7 jobs. At least one carry, one watch and one deliver. Vary employers, goods and places.
- At least two jobs from employers away from the Rijnkaai (katoen, vishandel, waterschout, brouwer, koster).
- Each job uses only its employer's own places.
- task_type may also be row, find or talk, but those cannot be played yet; use them at most once.
- pay_c between ${lo} and ${hi}. Heavier, riskier or shadier work pays more.
- pitch: 1 to 3 short sentences, as the employer or the board would say it. Name the goods and the places in words, not ids.
- title: short, like a chalk line on a board.`;
}

export function maxTier(db: DB): number {
  const best = (db.prepare("SELECT MAX(trust) AS t FROM faction_trust WHERE player_id = ?").get(pid()) as { t: number }).t;
  let tier = 0;
  for (let i = 0; i < TIER_TRUST.length; i++) if (best >= TIER_TRUST[i]) tier = i;
  return tier;
}

/** Engine clamp: pay into the tier band, trimmed text; goods work to its load and pay (M7 short jobs: fitCarry). */
export function clampBoard(board: Board, tier: number): Board {
  const [lo, hi] = TIER_PAY[tier];
  return {
    jobs: board.jobs.map((j) =>
      fitCarry(
        {
          ...j,
          title: plainEnglish(j.title),
          pitch: plainEnglish(j.pitch),
          recipient: j.recipient.trim(),
          pay_c: Math.max(lo, Math.min(hi, Math.round(j.pay_c / 5) * 5)),
        },
        [lo, hi],
      ),
    ),
  };
}

/**
 * M7 short jobs, the gate (hooks/loads.ts cartWorkOpen): cart work only when it is open, and at most
 * CART_JOBS_PER_BOARD on a board; every other job is by hand.
 */
export function gateCarts(board: Board, open: boolean): Board {
  let n = 0;
  return {
    jobs: board.jobs.map((j) => {
      const cart = open && j.task_type === "carry" && j.cart === true && n < CART_JOBS_PER_BOARD;
      if (cart) n++;
      return { ...j, cart };
    }),
  };
}

const clampTo = (n: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, Math.round(n / 5) * 5));

/**
 * M7 short jobs: a carry job's load and pay, from the model's proposal (items, cart, pay) and the
 * engine's rules (taskFor: at most 2 by hand, 3 to 8 on a cart, the time the work takes). The pay
 * goes into the load's band inside `band` (the tier's, or the night's): by hand the lower part of
 * it, one thing lower still, cart work the upper half (loads.ts carryBand). Other kinds unchanged.
 */
export function fitCarry(j: BoardJob, band: [number, number]): BoardJob {
  if (j.task_type !== "carry") return j;
  const want = j.cart === true;
  const b = carryBand(band, want);
  const pay = clampTo(j.pay_c, b);
  const pos = (pay - b[0]) / Math.max(1, b[1] - b[0]);
  // the model's number of things, else from where its pay lies in the band
  const items = typeof j.items === "number" && Number.isFinite(j.items) ? Math.round(j.items) : want ? CART_MIN + Math.round(pos * (CART_MAX - CART_MIN)) : pos >= 0.5 ? HAND_MAX : 1;
  const t = taskFor({ ...j, cart: want, items, pay_c: pay });
  if (!t || t.kind !== "carry") return { ...j, cart: false, pay_c: pay };
  const cart = t.cart === true;
  // the words name the engine's count ("Two sacks" for one sack: the model's count, or too far for two)
  return { ...j, title: sayCount(j.title, t.count), pitch: sayCount(j.pitch, t.count), cart, items: t.count, pay_c: clampTo(j.pay_c, carryBand(band, cart, !cart && t.count === 1)) };
}

const dist = (a: SpotId, b: SpotId) => Math.hypot(SPOTS[a].x - SPOTS[b].x, SPOTS[a].z - SPOTS[b].z);

/**
 * Engine turns a board line into a playable task. The model picked goods,
 * places and a twist; the engine fixes what does not fit and sets all numbers.
 */
export function taskFor(j: BoardJob): Exclude<Task, MillTask> | null {
  let twist: Twist = (TWISTS_FOR[j.task_type] ?? ["none"]).includes(j.twist) ? j.twist : "none";
  const employer = ALL_EMPLOYERS[j.employer];
  // M3e: a townsperson's work stays on their own ground (walking range); the engine moves strays back.
  // Every employer's (review 2026-09-24): the board prompt gives the quay's employers the quay's places only.
  const area = employer.area;
  const own = (s: SpotId, other: SpotId): SpotId => (area.includes(s) ? s : (area.find((a) => a !== other && a !== employer.door) ?? employer.door));
  j = { ...j, from: own(j.from, j.to), to: own(j.to, j.from) };
  if (employer.town) {
    if (j.task_type !== "watch" && j.from === j.to) j = { ...j, to: j.from === employer.door ? (area.find((a) => a !== employer.door) ?? employer.door) : employer.door };
    // a carry is short work: at most 70 m a trip; else the nearest of their places
    if (j.task_type === "carry" && dist(j.from, j.to) > 70) {
      const near = area.filter((a) => a !== j.from).sort((a, b) => dist(j.from, a) - dist(j.from, b))[0];
      if (near) j = { ...j, to: near };
    }
  }
  if (j.task_type === "carry") {
    let from = j.from;
    let to = j.to;
    if (from === to) to = from === employer.door ? "hessenatie_door" : employer.door;
    if (from === to) to = "crane_foot";
    const goods: Goods = j.goods === "parcel" ? "crates" : j.goods;
    let heavy = twist === "heavy_load";
    // M7 short jobs (Steve 2026-09-25: "Fetching is boring, so no more than 2 items"). The engine sets
    // the count from the model's proposal (fitCarry), and the time the work takes at a walk decides.
    const nearest = (fits: (s: SpotId) => boolean, ok: (s: SpotId) => boolean = () => true) =>
      area.filter((a) => a !== from && ok(a)).sort((a, b) => Number(fits(b)) - Number(fits(a)) || dist(from, a) - dist(from, b))[0];
    let cart = j.cart === true;
    let count = 0;
    if (cart) {
      // a cart does not go on the pier or up to the gangway: another of the employer's places, else by hand
      const cartOk = (s: SpotId) => !NO_CART_SPOTS.includes(s);
      const startOk = (s: SpotId) => !NO_CART_FROM.includes(s);
      if (!startOk(from)) from = area.find((a) => startOk(a) && a !== to) ?? from;
      if (!cartOk(to) || to === from) to = area.find((a) => cartOk(a) && a !== from) ?? to;
      // the heavy one would leave no room for three: the cart work stands, the twist goes (the pitch asked for a cart)
      if (heavy && cartCap(goods, true) < CART_MIN && cartCap(goods) >= CART_MIN) [twist, heavy] = ["none", false];
      const cap = Math.min(CART_MAX, cartCap(goods, heavy));
      if (!startOk(from) || !cartOk(to) || from === to || cap < CART_MIN) cart = false;
      else {
        count = Math.max(CART_MIN, Math.min(cap, Math.round(j.items ?? CART_MIN + 1)));
        while (count > CART_MIN && cartMinutes(goods, count, walkDist(from, to), heavy) > CART_MAX_MIN) count--;
        if (cartMinutes(goods, count, walkDist(from, to), heavy) > CART_MAX_MIN) to = nearest((s) => cartMinutes(goods, count, walkDist(from, s), heavy) <= CART_MAX_MIN, cartOk) ?? to;
      }
    }
    if (!cart) {
      count = Math.max(1, Math.min(HAND_MAX, Math.round(j.items ?? HAND_MAX)));
      if (handMinutes(goods, count, walkDist(from, to), heavy) > HAND_MAX_MIN) count = 1;
      if (handMinutes(goods, 1, walkDist(from, to), heavy) > HAND_MAX_MIN) to = nearest((s) => handMinutes(goods, 1, walkDist(from, s), heavy) <= HAND_MAX_MIN) ?? to;
    }
    const limit_s = !j.urgent ? null : cart ? Math.round(realS(cartMinutes(goods, count, walkDist(from, to), heavy)) * 1.5 + 20) : carryLimit(from, to, count);
    return { kind: "carry", goods, count, from, to, twist, limit_s, ...(cart ? { cart: true } : {}) };
  }
  if (j.task_type === "watch") {
    const goods: Goods = j.goods === "parcel" ? "barrels" : j.goods;
    const duration_s = j.pay_c >= 110 ? 120 : 90;
    return { kind: "watch", goods, post: j.to, duration_s, twist };
  }
  if (j.task_type === "deliver") {
    const from = employer.door;
    let to = j.to;
    if (to === from) to = employer.town ? (area.find((a) => a !== from) ?? to) : "ship_gangway";
    if (to === from) to = "east_carts";
    const recipient = j.recipient || "the mate on watch";
    const limit_s = j.urgent ? Math.round((dist(from, to) / 0.95) * 1.6 + 20) : null;
    return { kind: "deliver", goods: j.goods, from, to, recipient, twist, limit_s };
  }
  return null;
}

/** Time allowed when urgent: every trip there and back at carrying pace, plus slack. */
export function carryLimit(from: SpotId, to: SpotId, count: number): number {
  const d = dist(from, to);
  const perItem = d / 0.9 + d / 1.4 + 4;
  return Math.round(count * perItem * 1.5 + 20);
}

/** Canned board when the model is late or wrong. Written by hand, in voice. */
export const FALLBACK_BOARD: Board = {
  jobs: [
    {
      title: "Two crates off the pier",
      employer: "sooi",
      task_type: "carry",
      goods: "crates",
      // M7 short jobs: two crates by hand, a short way (to the Hessenatie door, 55 m, two took 86 game minutes)
      from: "pier_head",
      to: "crane_foot",
      twist: "none",
      urgent: false,
      recipient: "",
      pay_c: 90,
      risk: "low",
      pitch: "Two crates of coffee from the lighter at the pier head, to the foot of the crane. Mind the wet planks.",
      items: 2,
      cart: false,
    },
    {
      title: "Stores for the widow",
      employer: "peeters",
      task_type: "carry",
      goods: "rope",
      from: "crane_foot",
      to: "peeters_dock",
      twist: "broken_goods",
      urgent: false,
      recipient: "",
      pay_c: 90,
      risk: "low",
      pitch: "Two coils of tarred rope from under the crane to my loading door. Count them twice.",
      items: 2,
      cart: false,
    },
    {
      title: "Watch the west sheds",
      employer: "sooi",
      task_type: "watch",
      goods: "barrels",
      from: "west_sheds",
      to: "west_sheds",
      twist: "thief",
      urgent: false,
      recipient: "",
      pay_c: 80,
      risk: "medium",
      pitch: "Stand by the barrels at the west sheds till the bell. Keep your eyes open and your mouth shut.",
    },
    {
      title: "A parcel for the Anna Maria",
      employer: "tuur",
      task_type: "deliver",
      goods: "parcel",
      from: "pier_head",
      to: "ship_gangway",
      twist: "stranger_offer",
      urgent: true,
      recipient: "the mate of the Anna Maria",
      pay_c: 100,
      risk: "medium",
      pitch: "Take this to the mate at the gangway before the tide turns. Don't open it. Don't sell it.",
    },
    {
      title: "Cotton bales to the Entrepot",
      employer: "katoen",
      task_type: "carry",
      goods: "sacks",
      from: "entrepot_quay",
      to: "katoen_door",
      twist: "none",
      urgent: false,
      recipient: "",
      pay_c: 80,
      risk: "low",
      pitch: "Two bales off the lighter on the Entrepot quay, in at our door. Quick about it.",
      items: 2,
      cart: false,
    },
    {
      title: "A letter for the pump",
      employer: "koster",
      task_type: "deliver",
      goods: "parcel",
      from: "cathedral_door",
      to: "handschoen_well",
      twist: "none",
      urgent: false,
      recipient: "the chapter's messenger",
      pay_c: 60,
      risk: "low",
      pitch: "The chapter's letter, to the messenger who waits by the pump on the Handschoenmarkt. Straight there.",
    },
  ],
};

/**
 * M7 short jobs: the hand-written cart job, put on a fallback board only when cart work is open
 * (hooks/loads.ts cartWorkOpen). Sooi lends his handcart at the foot of the crane.
 */
export const FALLBACK_CART_JOB: BoardJob = {
  title: "A cartload for the natie",
  employer: "sooi",
  task_type: "carry",
  goods: "crates",
  from: "crane_foot",
  to: "hessenatie_door",
  twist: "none",
  urgent: false,
  recipient: "",
  pay_c: 140,
  risk: "low",
  pitch: "Five crates off the crane, in at the Hessenatie door. Take my handcart, it stands by the crates, and bring it back where it stood.",
  items: 5,
  cart: true,
};

/** M6: run after every new board (paper/routes.ts adds the post round and the morning paper). */
export const boardExtras: Array<(db: DB) => void> = [];

/**
 * Make a board for the player's current day: ask Claude, clamp, fall back
 * if needed, then write rows. Returns where the words came from.
 */
export async function makeBoard(
  db: DB,
  runner?: Runner,
  timeoutMs?: number,
): Promise<{ source: "claude" | "fallback"; error?: string; ms: number }> {
  // M8c: the board is the world's: written for the host (his trust, his tier, his carts) whoever's request
  // turned the day, until M8d gives it everyone
  if (pid() !== 1) return asPlayer(1, () => makeBoard(db, runner, timeoutMs));
  const tier = maxTier(db);
  const res = await callClaude(
    db,
    { hook: "job_board", system: SYSTEM, prompt: buildPrompt(db), schema: BoardSchema, timeoutMs },
    runner,
  );
  // M7 short jobs: cart work only once it is open (the gate), one on a board at most
  const carts = cartWorkOpen(db);
  let board = res.ok && res.data ? res.data : carts ? { jobs: [...FALLBACK_BOARD.jobs, FALLBACK_CART_JOB].slice(0, 7) } : FALLBACK_BOARD;
  const source: "claude" | "fallback" = res.ok ? "claude" : "fallback";
  board = gateCarts(board, carts);
  board = clampBoard(board, tier);
  board = ensurePlayable(board);

  const { day, hour } = db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };
  const ins = db.prepare(
    `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered')`,
  );
  db.transaction(() => {
    // M7 night: the night's work stays open until dawn (night/nightwork.ts expires it at 5:00)
    db.prepare("UPDATE job SET status = 'expired' WHERE status = 'offered' AND source <> 'night'").run();
    for (const j of board.jobs) {
      const task = PLAYABLE.has(j.task_type) ? taskFor(j) : null;
      const e = ALL_EMPLOYERS[j.employer];
      const district = e.town ? ((db.prepare("SELECT district FROM npc WHERE id = ?").get(j.employer) as { district: string } | undefined)?.district ?? "town") : "rijnkaai";
      ins.run(day, j.title, j.employer, district, j.task_type, j.pay_c, j.risk, tier, e.faction, j.pitch, JSON.stringify(task ?? {}), source);
    }
    db.prepare(
      "INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (?, ?, 'rijnkaai', 'world', 'job_board', ?, ?)",
    ).run(day, hour, source, `A new job board went up on the Rijnkaai with ${board.jobs.length} jobs.`);
  })();
  // M6: what comes with a new board (the post office's round, the morning paper); never fatal
  for (const f of boardExtras) {
    try {
      f(db);
    } catch (e) {
      console.error("[job_board] extra", e);
    }
  }
  return { source, error: res.error, ms: res.ms };
}

/**
 * Dev (docs/testing.md): one job of a chosen kind and twist on today's board, offered, for quick
 * tests (the watch with the thief without waiting for a board that happens to have one). It starts
 * from the hand-written job of that kind and goes through the same engine clamps (taskFor).
 */
export function devJob(
  db: DB,
  spec: { type?: string; twist?: string; goods?: string; from?: string; to?: string; employer?: string; urgent?: boolean; items?: number; cart?: boolean; pay?: number },
): { id: number; title: string; task: Task | null } {
  const type = spec.type === "watch" || spec.type === "deliver" ? spec.type : "carry";
  // M7 short jobs: `cart: true` starts from the hand-written cart job (the gate is not asked: a test)
  const base = type === "carry" && spec.cart === true ? FALLBACK_CART_JOB : FALLBACK_BOARD.jobs.find((j) => j.task_type === type)!;
  // own keys only: "toString" or "__proto__" are not employers or spots, nor is "_note" in the spot table
  const pick = <T extends string>(v: string | undefined, ok: readonly T[] | Record<string, unknown>, dflt: T): T =>
    typeof v === "string" && (Array.isArray(ok) ? (ok as readonly string[]).includes(v) : !v.startsWith("_") && Object.hasOwn(ok, v)) ? (v as T) : dflt;
  let j: BoardJob = {
    ...base,
    twist: pick(spec.twist, TWISTS, base.twist),
    employer: pick(spec.employer, ALL_EMPLOYERS, base.employer) as BoardJob["employer"],
    from: pick(spec.from, SPOTS, base.from) as BoardJob["from"],
    to: pick(spec.to, SPOTS, base.to) as BoardJob["to"],
    goods: pick(spec.goods, GOODS, base.goods),
    urgent: spec.urgent ?? base.urgent,
    title: `Test: ${type}${spec.cart ? " by cart" : ""}${spec.twist && spec.twist !== "none" ? `, ${spec.twist}` : ""}`,
    ...(typeof spec.items === "number" && Number.isFinite(spec.items) ? { items: spec.items } : {}),
    ...(typeof spec.pay === "number" && Number.isFinite(spec.pay) ? { pay_c: spec.pay } : {}),
  };
  // the engine's load and pay (M7 short jobs), in the tier 0 band (the hand-written jobs' pay)
  if (j.task_type === "carry") j = fitCarry(j, TIER_PAY[0]);
  const task = taskFor(j);
  const e = ALL_EMPLOYERS[j.employer];
  const { day } = db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number };
  const r = db
    .prepare(
      `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
       VALUES (?, ?, ?, 'rijnkaai', ?, ?, ?, 1, ?, ?, ?, 'dev', 'offered')`,
    )
    .run(day, j.title, j.employer, j.task_type, j.pay_c, j.risk, e.faction, j.pitch, JSON.stringify(task ?? {}));
  return { id: Number(r.lastInsertRowid), title: j.title, task };
}

/**
 * M7 short jobs: an older save's open goods work written before the rule (3 to 5 by hand): each job
 * still offered goes to the new sizes, once, in place: at most two by hand and the hour's work
 * (taskFor), the pay by the share carried (never under the tier's floor of 50), the words to the count.
 */
export function shortenOffered(db: DB): number {
  const rows = db.prepare("SELECT id, title, pitch, pay_c, employer_npc, task_json FROM job WHERE status = 'offered' AND task_type = 'carry'").all() as Array<{ id: number; title: string; pitch: string; pay_c: number; employer_npc: string; task_json: string }>;
  let n = 0;
  for (const r of rows) {
    let t: CarryTask;
    try {
      t = JSON.parse(r.task_json) as CarryTask;
    } catch {
      continue;
    }
    if (t.kind !== "carry" || t.cart || t.count <= HAND_MAX || !ALL_EMPLOYERS[r.employer_npc]) continue;
    const line: BoardJob = { title: r.title, employer: r.employer_npc, task_type: "carry", goods: t.goods === "chests" ? "crates" : t.goods, from: t.from, to: t.to, twist: t.twist, urgent: t.limit_s !== null, recipient: "", pay_c: r.pay_c, risk: "low", pitch: r.pitch, items: HAND_MAX, cart: false };
    const nt = taskFor(line) as CarryTask;
    const task = { ...nt, goods: t.goods };
    const pay = Math.max(50, Math.round((r.pay_c * task.count) / t.count / 5) * 5);
    db.prepare("UPDATE job SET task_json = ?, pay_c = ?, title = ?, pitch = ? WHERE id = ?").run(JSON.stringify(task), pay, sayCount(r.title, task.count), sayCount(r.pitch, task.count), r.id);
    n++;
  }
  return n;
}

/** The game needs at least one playable job; add a hand-written one if not. */
function ensurePlayable(board: Board): Board {
  if (board.jobs.some((j) => PLAYABLE.has(j.task_type))) return board;
  return { jobs: [FALLBACK_BOARD.jobs[0], ...board.jobs.slice(0, 4)] };
}

export function listJobs(db: DB, day: number): JobRow[] {
  const rows = db
    // the day's board, a job still in hand from an earlier day (M7 night: it stays in hand; only its own
    // deadline counts), and the night's work still open after midnight (night/nightwork.ts)
    .prepare("SELECT * FROM job WHERE (day = ? AND status IN ('offered','taken','done','failed')) OR status = 'taken' OR (source = 'night' AND status = 'offered') ORDER BY id")
    .all(day) as Array<Omit<JobRow, "task" | "employer_name" | "playable"> & { task_json: string }>;
  return rows.map((r) => jobRow(db, r));
}

/** One job by its id, whatever its day (a job taken yesterday and settled today). */
export function jobById(db: DB, id: number): JobRow | null {
  const r = db.prepare("SELECT * FROM job WHERE id = ?").get(id) as (Omit<JobRow, "task" | "employer_name" | "playable"> & { task_json: string }) | undefined;
  return r ? jobRow(db, r) : null;
}

function jobRow(db: DB, { task_json, ...r }: Omit<JobRow, "task" | "employer_name" | "playable"> & { task_json: string }): JobRow {
  const parsed = JSON.parse(task_json) as Partial<Task>;
  return {
    ...r,
    employer_name: employerName(db, r.employer_npc),
    task: parsed.kind ? (parsed as Task) : null,
    playable: PLAYABLE.has(r.task_type) && !!parsed.kind,
  };
}
