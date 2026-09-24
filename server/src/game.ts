import { z } from "zod";
import type { DB } from "./db.ts";
import { ALL_EMPLOYERS, listJobs, type JobRow, type Progress } from "./hooks/jobBoard.ts";
import { remember } from "./npcs.ts";

// Engine rules. Numbers change here and nowhere else (docs/03 rule one).

export interface PlayerState {
  name: string;
  money_c: number;
  day: number;
  hour: number;
  district: string;
  food: number;
  warmth: number;
  health: number;
  sleep: number;
}

export function player(db: DB): PlayerState {
  return db
    .prepare("SELECT name, money_c, day, hour, district, food, warmth, health, sleep FROM player WHERE id = 1")
    .get() as PlayerState;
}

export function log(db: DB, verb: string, object: string | null, text: string, actor = "player"): void {
  const p = player(db);
  db.prepare("INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    p.day,
    p.hour,
    p.district,
    actor,
    verb,
    object,
    text,
  );
}

export class GameError extends Error {
  readonly status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.status = status;
  }
}

export function job(db: DB, id: number): JobRow {
  const j = listJobs(db, player(db).day).find((r) => r.id === id);
  if (!j) throw new GameError("no such job on today's board", 404);
  return j;
}

export function takeJob(db: DB, id: number): JobRow {
  const j = job(db, id);
  if (j.status !== "offered") throw new GameError("that job is not open", 409);
  if (!j.playable) throw new GameError("that kind of work is not in the game yet", 409);
  const busy = db.prepare("SELECT 1 FROM job WHERE status = 'taken'").get();
  if (busy) throw new GameError("finish the job you have first", 409);
  db.prepare("UPDATE job SET status = 'taken' WHERE id = ?").run(id);
  log(db, "took_job", String(id), `Jef took a job from ${j.employer_name}: ${j.title}.`);
  return job(db, id);
}

/** Save carry/deliver progress so a reload does not make Jef carry twice. */
export function saveProgress(db: DB, id: number, p: Progress): JobRow {
  const j = job(db, id);
  if (j.status !== "taken" || !j.task || j.task.kind === "watch") throw new GameError("no progress to save", 409);
  const count = j.task.kind === "carry" ? j.task.count : j.task.kind === "letters" ? j.task.stops.length : 1;
  const clean = (n: unknown) => Math.max(0, Math.min(count, Math.floor(Number(n) || 0)));
  const progress = { delivered: clean(p.delivered), lost: clean(p.lost), sold: clean(p.sold) };
  if (progress.delivered + progress.lost + progress.sold > count) throw new GameError("more goods than the job has", 400);
  db.prepare("UPDATE job SET task_json = ? WHERE id = ?").run(JSON.stringify({ ...j.task, progress }), id);
  return job(db, id);
}

/** What the 3D game reports when a job ends. Engine facts, not claims about money. */
export const ReportSchema = z.object({
  delivered: z.number().int().min(0).max(10).default(0),
  lost: z.number().int().min(0).max(10).default(0),
  sold: z.number().int().min(0).max(10).default(0),
  pocketed: z.boolean().default(false),
  late: z.boolean().default(false),
  left_post_s: z.number().int().min(0).max(3600).default(0),
  thief: z.enum(["none", "chased", "stole"]).default("none"),
  bribe_taken: z.boolean().default(false),
  seen_away: z.boolean().default(false),
});
export type Report = z.infer<typeof ReportSchema>;

export interface Settlement {
  pay_c: number;
  extra_c: number;
  trust_delta: number;
  caught: boolean;
  status: "done" | "failed";
  /** Plain sentences for the log and for the outcome writer. */
  facts: string[];
}

// Coin other people press into Jef's hand. Fixed by the engine.
const SELL_PRICE = { carry: 35, deliver: 60 } as const;
const POCKET_C = 15;
const BRIBE_C = 50;
const CHASE_TIP_C = 15;
/** Chance a misdeed is noticed when nobody is watching on purpose. */
const CAUGHT_CHANCE = 0.35;

/** The rules, as a pure function so tests can pin them down. */
export function settle(j: JobRow, r: Report, rng: () => number = Math.random): Settlement {
  const task = j.task;
  if (!task) throw new GameError("job has no task", 400);
  const who = j.employer_name;
  const watched = task.twist === "foreman_watches";
  const facts: string[] = [];
  const round5 = (n: number) => Math.round(n / 5) * 5;

  // M6: a round of letters (paper/post.ts): the ENGINE counts the stops done, whatever the client says
  if (task.kind === "letters") {
    const count = task.stops.length;
    const done = task.stops.filter((s) => s.done).length;
    const pay = count ? (j.pay_c * done) / count : 0;
    facts.push(
      task.stops.some((s) => s.what === "telegraph")
        ? done === count
          ? `Jef sent the telegram${task.city ? ` to ${task.city}` : ""} for ${who}.`
          : `The telegram for ${who} was never sent.`
        : `Jef put ${done} of ${count} letters under the right doors for ${who}.`,
    );
    return { pay_c: round5(pay), extra_c: 0, trust_delta: done === count ? 1 : 0, caught: false, status: done === 0 ? "failed" : "done", facts };
  }

  if (task.kind === "watch") {
    let pay = j.pay_c;
    let extra = 0;
    const away = r.left_post_s > 15 || r.seen_away;
    if (away) {
      pay *= 0.5;
      facts.push(r.seen_away ? `${who}'s man came by and found Jef away from his post.` : `Jef left his post for ${r.left_post_s} seconds.`);
    }
    if (r.thief === "stole") {
      pay *= 0.5;
      facts.push("A thief came out of the fog and got away with some of the goods.");
    }
    if (r.thief === "chased") {
      extra += CHASE_TIP_C;
      facts.push("A thief came out of the fog. Jef ran him off.");
    }
    if (r.bribe_taken) {
      extra += BRIBE_C;
      facts.push("A man paid Jef to look away, and something went missing.");
    }
    const caught = r.bribe_taken && (watched || rng() < CAUGHT_CHANCE);
    if (caught) {
      pay = 0;
      facts.push(`${who} found out about the bribe.`);
    }
    const trust = caught ? -2 : r.thief === "stole" || away ? -1 : 1;
    if (!facts.length) facts.push("Jef stood his watch in the fog until the bell. Nothing was lost.");
    return { pay_c: round5(pay), extra_c: extra, trust_delta: trust, caught, status: "done", facts };
  }

  const count = task.kind === "carry" ? task.count : 1;
  if (r.delivered + r.lost + r.sold !== count) {
    throw new GameError(`goods not all accounted for: ${r.delivered + r.lost + r.sold} of ${count}`, 409);
  }
  const noun = task.kind === "carry" ? task.goods : task.goods === "parcel" ? "the parcel" : `the ${task.goods}`;
  let pay = (j.pay_c * r.delivered) / count;
  if (r.late) pay *= 0.75;
  const extra = r.sold * SELL_PRICE[task.kind] + (r.pocketed ? POCKET_C : 0);

  if (task.kind === "carry") facts.push(`Jef brought ${r.delivered} of ${count} ${noun} for ${who}.`);
  else facts.push(r.delivered ? `Jef handed ${noun} to ${task.recipient}.` : `${noun} never reached ${task.recipient}.`);
  if (r.late) facts.push("He was late.");
  if (r.lost) facts.push(`${r.lost} went into the Schelde.`);
  if (r.sold) facts.push(`He sold ${r.sold} to a stranger in the fog.`);
  if (r.pocketed) facts.push("He filled his pockets from a broken load.");
  if (task.twist === "heavy_load") facts.push("One load was far too heavy for one man, and he carried it anyway.");

  const misdeed = r.sold > 0 || r.pocketed;
  const caught = misdeed && (watched || rng() < CAUGHT_CHANCE);
  if (caught) {
    pay = 0;
    facts.push(`${who} found out.`);
  }
  const clean = r.delivered === count && !r.late && !misdeed;
  const trust = caught ? -2 : r.lost > 0 ? -1 : clean ? 1 : 0;
  return {
    pay_c: round5(pay),
    extra_c: extra,
    trust_delta: trust,
    caught,
    status: r.delivered === 0 ? "failed" : "done",
    facts,
  };
}

/** Apply a settlement: money, trust, job row, log, and a plain memory for the employer. */
/** M6 ideas: run on every settlement before it is applied; may change pay, trust and facts (within their own caps). */
export const settleExtras: Array<(db: DB, j: JobRow, s: Settlement) => void> = [];

export function finishJob(db: DB, id: number, report: Report, rng?: () => number) {
  const j = job(db, id);
  if (j.status !== "taken") throw new GameError("that job is not in hand", 409);
  const s = settle(j, report, rng);
  // M6 ideas: a job that went wrong (ideas/trouble.ts) adds its engine-set pay change and facts
  for (const f of settleExtras) f(db, j, s);
  const faction = ALL_EMPLOYERS[j.employer_npc]?.faction;
  db.transaction(() => {
    db.prepare("UPDATE job SET status = ? WHERE id = ?").run(s.status, id);
    // time passes while the job is played (M5 clock), so no extra hour here
    db.prepare("UPDATE player SET money_c = MAX(0, money_c + ?) WHERE id = 1").run(s.pay_c + s.extra_c);
    if (faction && s.trust_delta) {
      db.prepare("UPDATE faction_trust SET trust = MAX(-5, MIN(10, trust + ?)) WHERE faction = ?").run(s.trust_delta, faction);
    }
    log(db, s.status === "done" ? "finished_job" : "failed_job", String(id), s.facts.join(" "));
    // a parcel for this job leaves your pocket, whatever happened to it
    db.prepare("DELETE FROM item WHERE job_id = ?").run(id);
  })();
  const p = player(db);
  return { job: job(db, id), settlement: s, money_c: p.money_c };
}

/** What the town will say about a finished job (M3e rumours): engine words from engine facts. */
export function jobRumour(j: JobRow, s: Settlement): { gist: string; tone: number } {
  const who = j.employer_name;
  if (s.caught) return { gist: `Jef was caught cheating ${who}`, tone: -2 };
  if (s.status === "failed") return { gist: `Jef let ${who} down on a job`, tone: -1 };
  if (s.facts.some((f) => f.includes("went into the Schelde"))) return { gist: `Jef dropped ${who}'s goods in the Schelde`, tone: -1 };
  if (s.trust_delta > 0) return { gist: `Jef did honest work for ${who}`, tone: 1 };
  return { gist: `Jef did a job for ${who}`, tone: 0 };
}

export function saveOutcome(db: DB, id: number, narration: string, memory: string, weight: number, rumour?: { gist: string; tone: number }): void {
  const j = job(db, id);
  db.transaction(() => {
    db.prepare("UPDATE job SET outcome_text = ? WHERE id = ?").run(narration, id);
    log(db, "job_outcome", String(id), narration, j.employer_npc);
  })();
  // through remember() so the gossip rule runs (M3)
  remember(db, j.employer_npc, memory, Math.max(3, Math.min(8, Math.round(weight))), "seen", null, rumour ?? null);
}
