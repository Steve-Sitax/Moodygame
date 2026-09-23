import { z } from "zod";
import type { DB, Faction } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";

// job_board hook, docs/03. Claude writes the words. The engine owns pay,
// tier, the task itself, and how many jobs there are.

export const TASK_TYPES = ["carry", "watch", "deliver", "row", "find", "talk"] as const;
/** Task types the 3D game can play right now. */
export const PLAYABLE = new Set<string>(["carry"]);

/** Employers that hire on the Rijnkaai in M2. Engine knows their faction. */
const EMPLOYERS = {
  sooi: { name: "Sooi", faction: "naties", note: "foreman of the Hessenatie, gruff but fair, hires day men at dawn" },
  peeters: { name: "Widow Peeters", faction: "burgerij", note: "ship chandler, careful with money, remembers favours" },
} as const satisfies Record<string, { name: string; faction: Faction; note: string }>;
type EmployerId = keyof typeof EMPLOYERS;

/** docs/01 tier table. */
const TIER_PAY: Array<[number, number]> = [
  [50, 150],
  [150, 300],
  [300, 600],
  [600, 1500],
  [1500, 3000],
];
const TIER_TRUST = [0, 3, 5, 7, 9];

// What the model may return. Anything else is rejected.
export const BoardSchema = z.object({
  jobs: z
    .array(
      z.object({
        title: z.string().min(3).max(70),
        employer: z.enum(Object.keys(EMPLOYERS) as [EmployerId, ...EmployerId[]]),
        task_type: z.enum(TASK_TYPES),
        pay_c: z.number().int(),
        risk: z.enum(["low", "medium", "high"]),
        pitch: z.string().min(10).max(360),
      }),
    )
    .min(3)
    .max(5),
});
export type Board = z.infer<typeof BoardSchema>;

export interface CarryTask {
  kind: "carry";
  crates: number;
  from: string;
  to: string;
}

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
  task: CarryTask | null;
  source: string;
  status: string;
  playable: boolean;
}

export const SYSTEM = `You write for Scheldemist, a game set in Antwerp, autumn 1873.
The player is Jef, a farm boy from the Kempen, new in the city with no money and no name.
He finds day work on the docks, eats, keeps warm, and builds a name.

Setting facts you may use: the Scheldt toll was bought out in 1863 and the port is booming.
The Red Star Line starts sailing to America this year. The naties (Hessenatie, Katoennatie)
hire day men at dawn on the quays. Gas lamps, river fog, cholera still remembered from 1866.
The Rijnkaai has warehouses, one crane, a wooden pier, ships moored alongside.

Voice: English with a few Flemish words where a docker would use them
(baas, kaai, natie, jenever, pastoor, dokwerker, Schelde, mist). Terse. Period flavour.
No modern words, no modern money, no exclamation storms. Money is in centimes; 100 centimes = 1 franc.

You only write text. The game engine owns every number and rule. Keep to the JSON schema.
Never mention the game, the player's keyboard, or anything outside 1873 Antwerp.`;

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
  const weather = JSON.parse(
    (db.prepare("SELECT value_json FROM world_state WHERE key = 'weather'").get() as { value_json: string } | undefined)
      ?.value_json ?? '"fog"',
  ) as string;
  const log = db.prepare("SELECT text FROM log ORDER BY id DESC LIMIT 5").all() as Array<{ text: string }>;
  const tier = maxTier(db);
  const [lo, hi] = TIER_PAY[tier];

  return `Write tomorrow's job board for the hiring spot on the Rijnkaai.

WORLD STATE
Day ${p.day} of 7, hour ${p.hour}. Weather: ${weather}.
${p.name} has ${p.money_c} centimes. Trust per faction (0-10): ${trust.map((t) => `${t.faction} ${t.trust}`).join(", ")}.
He is nobody yet. Only tier ${tier} work is open to him.

EMPLOYERS WHO HIRE HERE
${Object.entries(EMPLOYERS)
  .map(([id, e]) => `- ${id}: ${e.name}, ${e.note}`)
  .join("\n")}

RECENT LOG (newest first)
${log.map((l) => "- " + l.text).join("\n")}

RULES FOR THE BOARD
- 3 to 5 jobs. At least 2 must be task_type "carry" (move crates or sacks from one spot on the quay to another).
- task_type is one of: ${TASK_TYPES.join(", ")}.
- pay_c between ${lo} and ${hi}. Heavier or riskier work pays more.
- pitch: 1 to 3 short sentences, as the employer or the board would say it. Name the goods and the place.
- title: short, like a chalk line on a board.`;
}

export function maxTier(db: DB): number {
  const best = (db.prepare("SELECT MAX(trust) AS t FROM faction_trust").get() as { t: number }).t;
  let tier = 0;
  for (let i = 0; i < TIER_TRUST.length; i++) if (best >= TIER_TRUST[i]) tier = i;
  return tier;
}

/** Engine clamp: pay into the tier band, ids into the known set. */
export function clampBoard(board: Board, tier: number): Board {
  const [lo, hi] = TIER_PAY[tier];
  return {
    jobs: board.jobs.map((j) => ({
      ...j,
      title: j.title.trim(),
      pitch: j.pitch.trim(),
      pay_c: Math.max(lo, Math.min(hi, Math.round(j.pay_c / 5) * 5)),
    })),
  };
}

/** Engine decides the carry task. The model never sets crate counts or spots. */
export function carryTaskFor(employer: string, pay_c: number, index: number): CarryTask {
  const crates = pay_c >= 130 ? 5 : pay_c >= 90 ? 4 : 3;
  if (employer === "peeters") return { kind: "carry", crates, from: "pier_head", to: "peeters_dock" };
  return { kind: "carry", crates, from: index % 2 ? "crane_foot" : "pier_head", to: "hessenatie_door" };
}

/** Canned board when the model is late or wrong. Written by hand, in voice. */
export const FALLBACK_BOARD: Board = {
  jobs: [
    {
      title: "Crates off the pier",
      employer: "sooi",
      task_type: "carry",
      pay_c: 90,
      risk: "low",
      pitch: "Coffee from the lighter at the pier head. Up to the Hessenatie door, and mind the wet planks.",
    },
    {
      title: "Stores for the widow",
      employer: "peeters",
      task_type: "carry",
      pay_c: 110,
      risk: "low",
      pitch: "Tar and rope for the chandlery. Carry them to my loading door. Count them twice, jongen.",
    },
    {
      title: "Lantern watch, west sheds",
      employer: "sooi",
      task_type: "watch",
      pay_c: 70,
      risk: "medium",
      pitch: "Stand by the sheds till the bell. Keep your eyes open and your mouth shut.",
    },
  ],
};

/**
 * Make the board for the player's current day: ask Claude, clamp, fall back
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
  board = ensureCarry(board);

  const { day, hour } = db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };
  const ins = db.prepare(
    `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
     VALUES (?, ?, ?, 'rijnkaai', ?, ?, ?, ?, ?, ?, ?, ?, 'offered')`,
  );
  db.transaction(() => {
    db.prepare("UPDATE job SET status = 'expired' WHERE status = 'offered'").run();
    board.jobs.forEach((j, i) => {
      const task = j.task_type === "carry" ? carryTaskFor(j.employer, j.pay_c, i) : null;
      ins.run(day, j.title, j.employer, j.task_type, j.pay_c, j.risk, tier, EMPLOYERS[j.employer].faction, j.pitch, JSON.stringify(task ?? {}), source);
    });
    db.prepare(
      "INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (?, ?, 'rijnkaai', 'world', 'job_board', ?, ?)",
    ).run(day, hour, source, `A new job board went up on the Rijnkaai with ${board.jobs.length} jobs.`);
  })();
  return { source, error: res.error, ms: res.ms };
}

/** The game needs one playable job at least. */
function ensureCarry(board: Board): Board {
  if (board.jobs.some((j) => j.task_type === "carry")) return board;
  const jobs = board.jobs.slice(0, 4);
  jobs.unshift(FALLBACK_BOARD.jobs[0]);
  return { jobs };
}

export function listJobs(db: DB, day: number): JobRow[] {
  const rows = db
    .prepare("SELECT * FROM job WHERE day = ? AND status IN ('offered','taken','done') ORDER BY id")
    .all(day) as Array<Omit<JobRow, "task" | "employer_name" | "playable"> & { task_json: string }>;
  return rows.map(({ task_json, ...r }) => {
    const parsed = JSON.parse(task_json) as Partial<CarryTask>;
    return {
      ...r,
      employer_name: EMPLOYERS[r.employer_npc as EmployerId]?.name ?? r.employer_npc,
      task: parsed.kind === "carry" ? (parsed as CarryTask) : null,
      playable: PLAYABLE.has(r.task_type),
    };
  });
}
