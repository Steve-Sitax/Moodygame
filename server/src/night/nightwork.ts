import { z } from "zod";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, NIGHT_BOARD_CALLS_PER_DAY } from "../config.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { GameError, log, settleExtras, takeChecks, type Settlement } from "../game.ts";
import { ALL_EMPLOYERS, GOODS, maxTier, PLAYABLE, SPOT_IDS, SPOTS, SYSTEM, TIER_PAY, TWISTS, employerName, taskFor, type Board, type JobRow, type Task } from "../hooks/jobBoard.ts";
import { gameMin } from "../../../shared/clock.ts";
import { remember } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { NIGHT_GIVERS } from "../town/places.ts";
import { gameMinute } from "../town/deeds.ts";
import { VIOLENCE_RE } from "../director/vocab.ts";
import { inSpan, NIGHT_WORK, NIGHT_WORK_ENDS } from "../../../shared/night.ts";

// M7 night (Steve 2026-09-25: "Other quest givers come out at night: shady ones with night jobs").
// The night board: once a night, when the givers come out (21:00), the model proposes two to four
// jobs for the four givers of night work (town/places.ts NIGHT_GIVERS); the engine checks them against
// the schema, keeps each giver to his own places, clamps the pay into the night's band (better than
// the day's) and makes every task the 3D game can play (taskFor, as the day board). Hand-written
// jobs when the model is late or its share of the day's calls is gone. The givers offer the work in
// talk; it is never chalked on the hiring board. Everything must be done by 5:00, when they go: what
// is still open then is gone, and a job in hand fails. At the settling the engine rolls the night's
// risks: the watch, and rivals.

const NIGHT_IDS = NIGHT_GIVERS.map((g) => g.id) as [string, ...string[]];

/** The night's pay band: the day tier's band raised by these factors (the engine's numbers). */
export const NIGHT_PAY_LOW = 1.5;
export const NIGHT_PAY_HIGH = 2;
/** At least this, whatever the tier. */
export const NIGHT_PAY_MIN_C = 120;
/** The night's risks at the settling (engine rolls, per job). */
export const WATCH_CATCH_CHANCE = 0.15;
export const RIVAL_CHANCE = 0.12;

export const NightBoardSchema = z.object({
  jobs: z
    .array(
      z.object({
        title: z.string().min(3).max(70),
        giver: z.enum(NIGHT_IDS),
        task_type: z.enum(["carry", "watch", "deliver"]),
        goods: z.enum(GOODS),
        from: z.enum(SPOT_IDS as [(typeof SPOT_IDS)[number], ...(typeof SPOT_IDS)[number][]]),
        to: z.enum(SPOT_IDS as [(typeof SPOT_IDS)[number], ...(typeof SPOT_IDS)[number][]]),
        twist: z.enum(TWISTS),
        recipient: z.string().max(60),
        pay_c: z.number().int(),
        pitch: z.string().min(10).max(300),
      }),
    )
    .min(2)
    .max(4),
});
export type NightBoard = z.infer<typeof NightBoardSchema>;
type NightJob = NightBoard["jobs"][number];

/** Hand-written night work, one per giver, for when the model cannot. */
export const FALLBACK_NIGHT: NightBoard = {
  jobs: [
    {
      title: "A bundle under the arch",
      giver: "fence",
      task_type: "deliver",
      goods: "parcel",
      from: "vliet_steps",
      to: "vleeshuis_door",
      twist: "stranger_offer",
      recipient: "a man in a grey muffler under the Vleeshuis arch",
      pay_c: 180,
      pitch: "A bundle for a friend who waits under the Vleeshuis arch. Don't look inside, and don't be seen with it.",
    },
    {
      title: "Crates off the lighter",
      giver: "smuggler",
      task_type: "carry",
      goods: "crates",
      // from the pontoon (M7 quest tests: from the Werf quay the Steen gate is 113 m off, over a night
      // carry's 70 m, so the engine moved the goal to the pontoon and the pitch named the wrong place)
      from: "werf_pontoon",
      to: "steen_gate",
      twist: "none",
      recipient: "",
      pay_c: 200,
      pitch: "Crates off my lighter at the ferry pontoon, up to the Steen gate before the water police wake. Quick and quiet.",
    },
    {
      title: "Barrels, no names",
      giver: "nightcarter",
      task_type: "carry",
      goods: "barrels",
      from: "canal_west",
      to: "brewery_yard",
      twist: "thick_fog",
      recipient: "",
      pay_c: 160,
      pitch: "Barrels from the west canal quay to the brewery door. No names, no questions, and mind the edge.",
    },
    {
      title: "Keep a lookout",
      giver: "cracksman",
      task_type: "watch",
      goods: "crates",
      from: "bassin_quay",
      to: "bassin_quay",
      twist: "thief",
      recipient: "",
      pay_c: 170,
      pitch: "Stand on the Petit Bassin quay till the bell and keep your eyes on the street. Anyone comes, you never saw me.",
    },
  ],
};

/** The night a moment belongs to: the day it began on (after midnight, the day before). */
export function nightOf(day: number, hour: number): number {
  return hour < NIGHT_WORK_ENDS ? day - 1 : day;
}

/** The game minute the night's work must be done by: 5:00 the next morning. */
export function nightEndsMin(day: number, hour: number): number {
  const n = nightOf(day, hour);
  return n * 1440 + NIGHT_WORK_ENDS * 60;
}

export function canCallNightBoard(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook = 'night_board'").get(day) as { n: number }).n;
  return mine < NIGHT_BOARD_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

function state(db: DB): { night: number } {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'night_board'").get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as { night: number }) : { night: 0 };
}
function setState(db: DB, s: { night: number }): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('night_board', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(s));
}

/** Is the night's board due now (the givers are out, and tonight has none yet)? */
export function nightBoardDue(db: DB): boolean {
  const c = clock(db);
  if (!inSpan(c.hour + c.minute / 60, NIGHT_WORK)) return false;
  return state(db).night !== nightOf(c.day, c.hour);
}

export function nightPrompt(db: DB): string {
  const c = clock(db);
  const tier = maxTier(db);
  const [lo, hi] = nightBand(tier);
  const logRows = db.prepare("SELECT text FROM log ORDER BY id DESC LIMIT 6").all() as Array<{ text: string }>;
  return `Write the night's work: what the men who hire after dark offer Jef tonight. It is never chalked on a board; each man offers his own work in a low voice.

NOW
${c.weekday}, day ${c.day}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}. The lamps are lit; the honest town is abed.

THE MEN WHO HIRE BY NIGHT (id: what he is. His places: only these ids for "from" and "to")
${NIGHT_GIVERS.map((g) => `- ${g.id}: ${employerName(db, g.id)}, ${g.note}. His places: ${g.area.join(", ")}.`).join("\n")}

PLACES
${NIGHT_GIVERS.flatMap((g) => g.area)
  .filter((v, i, a) => a.indexOf(v) === i)
  .map((id) => `- ${id}: ${(SPOTS as Record<string, { desc: string }>)[id]?.desc ?? id}`)
  .join("\n")}

RECENT LOG (newest first)
${logRows.map((l) => "- " + l.text).join("\n")}

KINDS OF WORK
- carry: move goods from "from" to "to". Twists: none, broken_goods, stranger_offer, foreman_watches, thick_fog, heavy_load.
- watch: keep a lookout over goods at "to" until the bell. Twists: none, thief, bribe, foreman_watches, thick_fog.
- deliver: take one item from the man's own place to a person at "to"; name that person in "recipient" (short). Twists: none, stranger_offer, thick_fog.
- goods: one of ${GOODS.join(", ")}.

RULES
- 2 to 4 jobs, from at least two different men. Each job uses only its man's own places.
- pay_c between ${lo} and ${hi}: night work pays better than day work, because it is riskier.
- pitch: 1 or 2 short sentences in the man's own voice; shady, never spelled out; hint at the risk (the watch, rivals, the water police).
  No weapons, nobody hurt: the game has no combat.
- title: short, like a word muttered in a doorway.
- Everything is done before five in the morning, when these men are gone.`;
}

/** The night's pay band for the tier (the engine's). */
export function nightBand(tier: number): [number, number] {
  const [lo, hi] = TIER_PAY[tier];
  return [Math.max(NIGHT_PAY_MIN_C, Math.round((lo * NIGHT_PAY_LOW) / 5) * 5), Math.max(NIGHT_PAY_MIN_C + 40, Math.round((hi * NIGHT_PAY_HIGH) / 5) * 5)];
}

/** The engine's checks: plain English, no violent words (such a job is dropped), pay in the band. */
export function clampNight(board: NightBoard, tier: number): NightJob[] {
  const [lo, hi] = nightBand(tier);
  const out: NightJob[] = [];
  for (const j of board.jobs) {
    const title = plainEnglish(j.title).trim();
    const pitch = plainEnglish(j.pitch).trim();
    if (VIOLENCE_RE.test(`${title} ${pitch} ${j.recipient}`)) continue;
    out.push({ ...j, title, pitch, recipient: j.recipient.trim(), pay_c: Math.max(lo, Math.min(hi, Math.round(j.pay_c / 5) * 5)) });
  }
  return out;
}

let writing: Promise<unknown> | null = null;

/** Every tick: the night's board when the givers come out; the night's end at 5:00. */
export function nightWorkTick(db: DB, runner?: Runner): { expired: number } {
  const expired = expireNightWork(db);
  if (!writing && nightBoardDue(db)) {
    writing = writeNightBoard(db, runner)
      .catch((e) => console.error("[night_board]", e))
      .finally(() => (writing = null));
  }
  return { expired };
}

/** Test helper: wait for a night board being written. */
export async function nightIdle(): Promise<void> {
  await writing?.catch(() => {});
}

/** The night's board: the model if it can (20 s, the schema), else the hand-written jobs; then the rows. */
export async function writeNightBoard(db: DB, runner?: Runner, opts: { force?: boolean } = {}): Promise<{ source: "claude" | "fallback"; jobs: number; error?: string }> {
  const c0 = clock(db);
  const night = nightOf(c0.day, c0.hour);
  setState(db, { night });
  const tier = maxTier(db);
  let jobs: NightJob[] = [];
  let source: "claude" | "fallback" = "fallback";
  let error: string | undefined;
  if (opts.force || canCallNightBoard(db)) {
    const res = await callClaude(db, { hook: "night_board", system: `${SYSTEM}\n${LANGUAGE_RULE}`, prompt: nightPrompt(db), schema: NightBoardSchema }, runner);
    if (res.ok && res.data) {
      jobs = clampNight(res.data, tier);
      source = "claude";
    } else error = res.error;
  } else error = "no budget";
  // at least two jobs from two givers: the hand-written ones fill in
  if (jobs.length < 2 || new Set(jobs.map((j) => j.giver)).size < 2) {
    const have = new Set(jobs.map((j) => j.giver));
    for (const f of clampNight(FALLBACK_NIGHT, tier)) if (!have.has(f.giver) && jobs.length < 4) jobs.push(f);
    if (source === "claude") error = "the model's night was too thin; hand-written work filled it";
  }
  // the clock may have moved while the model wrote: the night is still the same one?
  const c = clock(db);
  if (nightOf(c.day, c.hour) !== night || !inSpan(c.hour + c.minute / 60, NIGHT_WORK)) return { source, jobs: 0, error: "the night was over before the work was written" };
  insertNightJobs(db, jobs, tier, source);
  return { source, jobs: jobs.length, error };
}

/** The rows: every task through the day board's engine (taskFor), the deadline on it. */
export function insertNightJobs(db: DB, jobs: NightJob[], tier: number, source: string): number[] {
  const c = clock(db);
  const until = nightEndsMin(c.day, c.hour);
  const ids: number[] = [];
  const ins = db.prepare(
    `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
     VALUES (?, ?, ?, 'night', ?, ?, 'high', ?, ?, ?, ?, 'night', 'offered')`,
  );
  db.transaction(() => {
    for (const j of jobs) {
      const e = ALL_EMPLOYERS[j.giver];
      if (!e?.night || !PLAYABLE.has(j.task_type)) continue;
      const line: Board["jobs"][number] = { title: j.title, employer: j.giver, task_type: j.task_type, goods: j.goods, from: j.from, to: j.to, twist: j.twist, urgent: false, recipient: j.recipient, pay_c: j.pay_c, risk: "high", pitch: j.pitch };
      const task = taskFor(line);
      if (!task) continue;
      const r = ins.run(c.day, j.title, j.giver, j.task_type, j.pay_c, tier, e.faction, j.pitch, JSON.stringify({ ...task, until_min: until }));
      ids.push(Number(r.lastInsertRowid));
    }
    db.prepare("INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (?, ?, 'night', 'world', 'night_board', ?, ?)").run(
      c.day,
      c.hour,
      source,
      `After dark, ${ids.length} men had work for anyone who asked no questions.`,
    );
  })();
  return ids;
}

// ---------------------------------------------------------------- time enough before five

/** Jef's pace when he hurries (client firstPerson.ts HURRY), and with goods in his arms (about 0.6 of it). */
const RUN_MS = 3.4;
const RUN_LADEN_MS = 2;

/**
 * M7 quest tests: the fewest game minutes the work can take on foot, running every step (a game hour
 * is two real minutes, so five sacks over 70 m are two hours at a run and five at a walk). Work that
 * cannot be done by five even so is not offered, and cannot be taken.
 */
export function leastMinutes(task: Task, door?: string): number {
  const at = (id: string) => (SPOTS as Record<string, { x: number; z: number } | undefined>)[id];
  const d = (a?: string, b?: string) => {
    const p = a ? at(a) : undefined;
    const q = b ? at(b) : undefined;
    return p && q ? Math.hypot(p.x - q.x, p.z - q.z) : 0;
  };
  let realS = 0;
  if (task.kind === "carry") realS = d(door, task.from) / RUN_MS + task.count * (d(task.from, task.to) / RUN_LADEN_MS + d(task.to, task.from) / RUN_MS) - d(task.to, task.from) / RUN_MS;
  else if (task.kind === "deliver") realS = d(task.from, task.to) / RUN_LADEN_MS;
  else if (task.kind === "watch") realS = d(door, task.post) / RUN_MS + task.duration_s;
  return Math.ceil(gameMin(realS));
}

/** Can the work still be done by its deadline, starting now? */
function inTime(db: DB, task: Task & { until_min?: number }, giver: string): boolean {
  const until = task.until_min ?? 0;
  return gameMinute(db) + leastMinutes(task, ALL_EMPLOYERS[giver]?.door) <= until;
}

takeChecks.push((db, j) => {
  if (j.source !== "night" || !j.task) return;
  if (!inTime(db, j.task as Task & { until_min?: number }, j.employer_npc)) throw new GameError(`too late for that one: ${employerName(db, j.employer_npc)} is gone at five, and it would not be done by then`, 409);
});

/**
 * 5:00: the givers are gone. Their work still open is gone with them; a job in hand is failed (its
 * goods leave the pocket). Also a night job whose deadline passed while Jef slept.
 */
export function expireNightWork(db: DB): number {
  const now = gameMinute(db);
  const rows = db.prepare("SELECT id, status, title, employer_npc, task_json FROM job WHERE source = 'night' AND status IN ('offered', 'taken')").all() as Array<{ id: number; status: string; title: string; employer_npc: string; task_json: string }>;
  let n = 0;
  for (const r of rows) {
    const task = JSON.parse(r.task_json) as Task & { until_min?: number };
    const until = task.until_min ?? 0;
    // M7 quest tests: work still offered that can no longer be done by five is taken off too
    const late = r.status === "offered" && task.kind && !inTime(db, task, r.employer_npc);
    if (now < until && !late) continue;
    n++;
    if (r.status === "offered") {
      db.prepare("UPDATE job SET status = 'expired' WHERE id = ?").run(r.id);
      continue;
    }
    db.transaction(() => {
      db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(r.id);
      db.prepare("DELETE FROM item WHERE job_id = ?").run(r.id);
      log(db, "failed_job", String(r.id), `Dawn came with the night's job "${r.title}" not done; ${employerName(db, r.employer_npc)} was gone.`);
    })();
    remember(db, r.employer_npc, `Jef took my night's work "${r.title}" and did not have it done by five. I will not ask him twice.`, 5, "seen", null, { gist: `Jef let a man down on night work`, tone: -1 });
  }
  return n;
}

// ---------------------------------------------------------------- the night's risks, at the settling

let risk: () => number = Math.random;
/** Test seam: the dice of the night's risks. */
export function setNightDice(f: (() => number) | null): void {
  risk = f ?? Math.random;
}

/** The watch or rivals, rolled by the engine when night work is settled (settleExtras). */
export function settleNight(_db: DB, j: JobRow, s: Settlement): void {
  if (j.source !== "night" || s.status !== "done" || s.caught) return;
  if (risk() < WATCH_CATCH_CHANCE) {
    s.pay_c = 0;
    s.trust_delta = Math.min(s.trust_delta, 0);
    s.facts.push("A night watchman came round the corner with his lantern. Jef got away, but the goods and the pay were lost with them.");
    return;
  }
  if (risk() < RIVAL_CHANCE) {
    s.pay_c = Math.round(s.pay_c / 2 / 5) * 5;
    s.facts.push("Men from a rival crew were waiting at the corner and took their share; the pay was halved.");
    return;
  }
  // a clean night's work: the smugglers take note
  s.trust_delta = Math.max(s.trust_delta, 1);
}
settleExtras.push(settleNight);
