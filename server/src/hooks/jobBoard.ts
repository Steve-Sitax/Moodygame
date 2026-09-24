import { z } from "zod";
import { weather, WEATHER_TEXT } from "../day.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import type { DB, Faction } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import { TOWN_EMPLOYERS } from "../town/places.ts";

// job_board hook, docs/03. Claude writes the words and picks from engine
// lists (goods, places, twist). The engine owns pay, counts, time limits,
// and turns every pick into a task the 3D game can play (M2b).

export const TASK_TYPES = ["carry", "watch", "deliver", "row", "find", "talk"] as const;
// M6: "letters" (a round of doors and counters: the post office's letters, a letter's errand) is
// never on the model's list; the engine builds those jobs itself (paper/post.ts)
export const PLAYABLE = new Set<string>(["carry", "watch", "deliver", "letters"]);

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
}

/**
 * Everyone who hires (M3e): the three of the Rijnkaai and the five townspeople
 * at the other quays (town/places.ts TOWN_EMPLOYERS).
 */
export const ALL_EMPLOYERS: Record<string, EmployerDef> = {
  ...Object.fromEntries(Object.entries(EMPLOYERS).map(([id, e]) => [id, { ...e, area: RIJNKAAI_SPOTS, town: false }])),
  ...Object.fromEntries(TOWN_EMPLOYERS.map((e) => [e.id, { faction: e.faction, door: e.spot as SpotId, note: e.note, area: e.area as SpotId[], town: true }])),
};
export const EMPLOYER_IDS = Object.keys(ALL_EMPLOYERS) as [string, ...string[]];
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
export type Task = CarryTask | WatchTask | DeliverTask | LettersTask;

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
  const p = db.prepare("SELECT name, money_c, day, hour FROM player WHERE id = 1").get() as {
    name: string;
    money_c: number;
    day: number;
    hour: number;
  };
  const trust = db.prepare("SELECT faction, trust FROM faction_trust ORDER BY faction").all() as Array<{
    faction: string;
    trust: number;
  }>;
  const sky = WEATHER_TEXT[weather(db)];
  const log = db.prepare("SELECT text FROM log ORDER BY id DESC LIMIT 6").all() as Array<{ text: string }>;
  const tier = maxTier(db);
  const [lo, hi] = TIER_PAY[tier];

  return `Write the job board for the hiring spot on the Rijnkaai. It carries work from all the quays of the town.

WORLD STATE
Day ${p.day} of 7, hour ${p.hour}. Weather: ${sky}.
${p.name} has ${p.money_c} centimes. Trust per faction (-5 to 10; below 0 they dislike Jef): ${trust.map((t) => `${t.faction} ${t.trust}`).join(", ")}.
Only tier ${tier} work is open to him.

EMPLOYERS WHO HIRE (id: name, what they are. Their own places: only these ids for their "from" and "to")
${Object.entries(ALL_EMPLOYERS)
  .map(([id, e]) => `- ${id}: ${employerName(db, id)}, ${e.note}. Their door: ${e.door}. Their places: ${e.area.join(", ")}.`)
  .join("\n")}

PLACES (use these ids for "from" and "to")
${SPOT_IDS.map((id) => `- ${id}: ${SPOTS[id].desc}`).join("\n")}

RECENT LOG (newest first)
${log.map((l) => "- " + l.text).join("\n")}

KINDS OF WORK
- carry: move goods from "from" to "to". Twists: none, broken_goods, stranger_offer, foreman_watches, thick_fog, heavy_load.
- watch: stand guard over goods at "to" until the bell. "from" is ignored. Twists: none, thief, bribe, foreman_watches, thick_fog.
- deliver: take one item from the employer's door to a person at "to". Name that person in "recipient" (short, e.g. "the mate of the Anna Maria"). Twists: none, stranger_offer, thick_fog.
- goods is one of: ${GOODS.join(", ")}. Pick what fits the pitch.
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
  const best = (db.prepare("SELECT MAX(trust) AS t FROM faction_trust").get() as { t: number }).t;
  let tier = 0;
  for (let i = 0; i < TIER_TRUST.length; i++) if (best >= TIER_TRUST[i]) tier = i;
  return tier;
}

/** Engine clamp: pay into the tier band, trimmed text. */
export function clampBoard(board: Board, tier: number): Board {
  const [lo, hi] = TIER_PAY[tier];
  return {
    jobs: board.jobs.map((j) => ({
      ...j,
      title: plainEnglish(j.title),
      pitch: plainEnglish(j.pitch),
      recipient: j.recipient.trim(),
      pay_c: Math.max(lo, Math.min(hi, Math.round(j.pay_c / 5) * 5)),
    })),
  };
}

const dist = (a: SpotId, b: SpotId) => Math.hypot(SPOTS[a].x - SPOTS[b].x, SPOTS[a].z - SPOTS[b].z);

/**
 * Engine turns a board line into a playable task. The model picked goods,
 * places and a twist; the engine fixes what does not fit and sets all numbers.
 */
export function taskFor(j: BoardJob): Task | null {
  const twist: Twist = (TWISTS_FOR[j.task_type] ?? ["none"]).includes(j.twist) ? j.twist : "none";
  const employer = ALL_EMPLOYERS[j.employer];
  // M3e: a townsperson's work stays on their own ground (walking range); the engine moves strays back
  const area = employer.area;
  if (employer.town) {
    const own = (s: SpotId, other: SpotId): SpotId => (area.includes(s) ? s : (area.find((a) => a !== other && a !== employer.door) ?? employer.door));
    j = { ...j, from: own(j.from, j.to), to: own(j.to, j.from) };
    if (j.task_type !== "watch" && j.from === j.to) j = { ...j, to: j.from === employer.door ? (area.find((a) => a !== employer.door) ?? employer.door) : employer.door };
    // a carry is short work: at most 70 m a trip; else the nearest of their places
    if (j.task_type === "carry" && dist(j.from, j.to) > 70) {
      const near = area.filter((a) => a !== j.from).sort((a, b) => dist(j.from, a) - dist(j.from, b))[0];
      if (near) j = { ...j, to: near };
    }
  }
  if (j.task_type === "carry") {
    const from = j.from;
    let to = j.to;
    if (from === to) to = from === employer.door ? "hessenatie_door" : employer.door;
    if (from === to) to = "crane_foot";
    const count = j.pay_c >= 130 ? 5 : j.pay_c >= 90 ? 4 : 3;
    const goods: Goods = j.goods === "parcel" ? "crates" : j.goods;
    return { kind: "carry", goods, count, from, to, twist, limit_s: j.urgent ? carryLimit(from, to, count) : null };
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
      title: "Crates off the pier",
      employer: "sooi",
      task_type: "carry",
      goods: "crates",
      from: "pier_head",
      to: "hessenatie_door",
      twist: "none",
      urgent: false,
      recipient: "",
      pay_c: 90,
      risk: "low",
      pitch: "Coffee from the lighter at the pier head. Up to the Hessenatie door, and mind the wet planks.",
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
      pay_c: 110,
      risk: "low",
      pitch: "Tarred rope from under the crane to my loading door. Count them twice.",
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
      pay_c: 100,
      risk: "low",
      pitch: "Bales off the lighter on the Entrepot quay, in at our door. Quick about it.",
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
  const tier = maxTier(db);
  const res = await callClaude(
    db,
    { hook: "job_board", system: SYSTEM, prompt: buildPrompt(db), schema: BoardSchema, timeoutMs },
    runner,
  );
  let board = res.ok && res.data ? res.data : FALLBACK_BOARD;
  const source: "claude" | "fallback" = res.ok ? "claude" : "fallback";
  board = clampBoard(board, tier);
  board = ensurePlayable(board);

  const { day, hour } = db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };
  const ins = db.prepare(
    `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'offered')`,
  );
  db.transaction(() => {
    db.prepare("UPDATE job SET status = 'expired' WHERE status = 'offered'").run();
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
  spec: { type?: string; twist?: string; goods?: string; from?: string; to?: string; employer?: string; urgent?: boolean },
): { id: number; title: string; task: Task | null } {
  const type = spec.type === "watch" || spec.type === "deliver" ? spec.type : "carry";
  const base = FALLBACK_BOARD.jobs.find((j) => j.task_type === type)!;
  const pick = <T extends string>(v: string | undefined, ok: readonly T[] | Record<string, unknown>, dflt: T): T =>
    v && (Array.isArray(ok) ? (ok as readonly string[]).includes(v) : v in ok) ? (v as T) : dflt;
  const j: BoardJob = {
    ...base,
    twist: pick(spec.twist, TWISTS, base.twist),
    employer: pick(spec.employer, ALL_EMPLOYERS, base.employer) as BoardJob["employer"],
    from: pick(spec.from, SPOTS, base.from) as BoardJob["from"],
    to: pick(spec.to, SPOTS, base.to) as BoardJob["to"],
    goods: (spec.goods ?? base.goods) as BoardJob["goods"],
    urgent: spec.urgent ?? base.urgent,
    title: `Test: ${type}${spec.twist && spec.twist !== "none" ? `, ${spec.twist}` : ""}`,
  };
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

/** The game needs at least one playable job; add a hand-written one if not. */
function ensurePlayable(board: Board): Board {
  if (board.jobs.some((j) => PLAYABLE.has(j.task_type))) return board;
  return { jobs: [FALLBACK_BOARD.jobs[0], ...board.jobs.slice(0, 4)] };
}

export function listJobs(db: DB, day: number): JobRow[] {
  const rows = db
    .prepare("SELECT * FROM job WHERE day = ? AND status IN ('offered','taken','done','failed') ORDER BY id")
    .all(day) as Array<Omit<JobRow, "task" | "employer_name" | "playable"> & { task_json: string }>;
  return rows.map(({ task_json, ...r }) => {
    const parsed = JSON.parse(task_json) as Partial<Task>;
    return {
      ...r,
      employer_name: employerName(db, r.employer_npc),
      task: parsed.kind ? (parsed as Task) : null,
      playable: PLAYABLE.has(r.task_type) && !!parsed.kind,
    };
  });
}
