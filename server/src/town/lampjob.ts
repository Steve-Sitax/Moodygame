import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { clock, fogDay } from "../day.ts";
import { DEV } from "../config.ts";
import { finishJob, GameError, log, takeChecks, takeHooks } from "../game.ts";
import { boardExtras, listJobs, maxTier, TIER_PAY, type JobRow, type LampsTask } from "../hooks/jobBoard.ts";
import { within } from "../ideas/common.ts";
import { remember } from "../npcs.ts";
import { asPlayer, pid } from "../player/current.ts";
import { lampHelp, lampRounds, saveHelp } from "./lamplighters.ts";
import { fogAt, hhmm, lampTimes, SEEN_PACE, type LampRound } from "./lampround.ts";
import { resident } from "./store.ts";

// The lamplighter's help (Steve 2026-09-28: "add a job as lamp lighter for the player and get paid. But you
// can only start lighting when needed and need to be done in a manageable amount of time"). Once a day one of
// the town's lamplighters puts the last lamps of his round on the board: a stretch of 5 to 10 lamps that Jef
// can walk and light in about two and a half real minutes. The ENGINE owns it all: which lamps, the pay, the
// hours. Jef takes the spare pole where it leans against the first lamp; he may light from the round's dusk
// (a lamp lit by daylight wastes the town's gas) until two and a quarter game hours later. The engine checks
// each lamp (the hour, the place, the pole) and counts them; the pay goes by the lamps lit. While the job
// holds, the stretch waits for Jef (lampround.ts helpHolds): the lamplighter ends his round before it, and a
// lamp burns once Jef has lit it. At the deadline the hold ends and the lamplighter lights what is left.

/** A stretch is 5 to 10 lamps, and never more than half the round (the lamplighter keeps a round of his own). */
export const LAMP_JOB_MIN = 5;
export const LAMP_JOB_MAX = 10;
/** The stretch at Jef's walk with a few seconds a lamp: at most this long (real seconds; a game hour and a quarter). */
export const STRETCH_MAX_S = 150;
/** Real seconds a lamp takes him (the pole up into the lantern, the flame, the pole down: game/lampjob.ts). */
export const LIGHT_S = 3;
/** The job can be taken until this long after the round's dusk; every lamp must be lit by DONE_BY_H after it. */
export const TAKE_BY_H = 0.75;
export const DONE_BY_H = 2.25;
/** The pay: a base and so much a lamp, within the board's tier band. */
export const LAMP_BASE_C = 20;
export const LAMP_EACH_C = 10;
/** How near the lamp's foot (metres) the server takes him to be (the client offers E within 2.2 m). */
const REACH_M = 3.2;

const round5 = (n: number) => Math.round(n / 5) * 5;
const hourNow = (db: DB) => {
  const c = clock(db);
  return c.hour + c.minute / 60;
};

// ------------------------------------------------------------------ the stretch and the job

/**
 * Where the stretch begins on the round: the most lamps from the round's end (at most LAMP_JOB_MAX, half the
 * round) that Jef walks and lights within STRETCH_MAX_S. -1 when even LAMP_JOB_MIN do not fit (the north round
 * ends on the Sint-Jansplein, 228 m from the lamp before): that round is not offered.
 */
export function stretchOf(r: LampRound): number {
  const n = r.lamps.length;
  const most = Math.min(LAMP_JOB_MAX, Math.floor(n / 2));
  let k = 0;
  for (let t = LAMP_JOB_MIN; t <= most; t++) {
    // the round's own path, from the stretch's first lamp to the last, a little longer through the streets
    const walk = ((r.at[n - 1] - r.at[n - t]) * 1.1) / SEEN_PACE + t * LIGHT_S;
    if (walk > STRETCH_MAX_S) break;
    k = t;
  }
  return k ? n - k : -1;
}

const WORDS: Array<{ title: string; pitch: (n: number, open: string, until: string) => string }> = [
  {
    title: "Lamps at dusk",
    pitch: (n, open, until) =>
      `My knee is bad tonight. Take the last ${n} lamps of my round: the spare pole leans on the first. Not one before ${open}; a lamp lit in daylight wastes the town's gas. All of them burning by ${until}.`,
  },
  {
    title: "Light my last lamps",
    pitch: (n, open, until) => `I have more lamps than legs this evening. The last ${n} of my round are yours, the pole waits at the first one. Start at ${open}, when the light goes, and have them lit by ${until}.`,
  },
];

/** The engine's lamps job on this round today (or the day's round), or null when there is no round or no man. */
export function buildLampJob(db: DB, roundId?: string): { title: string; employer: string; pay_c: number; pitch: string; task: LampsTask; district: string; faction: string | null } | null {
  const rounds = lampRounds(db)?.rounds ?? [];
  if (!rounds.length) return null;
  const c = clock(db);
  // the day's round: one after another of the rounds with a stretch that fits
  const fit = rounds.filter((x) => stretchOf(x) >= 0);
  const r = roundId ? fit.find((x) => x.id === roundId) : fit[c.day % Math.max(1, fit.length)];
  if (!r) return null;
  const npc = db.prepare("SELECT district, faction FROM npc WHERE id = ?").get(r.lamplighter) as { district: string; faction: string | null } | undefined;
  if (!npc) return null;
  const from = stretchOf(r);
  const lamps = r.lamps.slice(from).map((l) => ({ id: l.id, x: l.x, z: l.z, sx: l.sx, sz: l.sz }));
  // (on whole minutes, as the clock shows them: "from 16:48" is from 16:48, not a few seconds after it)
  const open = Math.ceil(r.dusk * 60 - 1e-6) / 60;
  const until = Math.floor((open + DONE_BY_H) * 60 + 1e-6) / 60;
  const [lo, hi] = TIER_PAY[maxTier(db)];
  const pay_c = Math.max(lo, Math.min(hi, round5(LAMP_BASE_C + LAMP_EACH_C * lamps.length)));
  const w = WORDS[c.day % WORDS.length];
  const task: LampsTask = { kind: "lamps", goods: "lamps", round: r.id, from, lamps, pole: { x: lamps[0].sx, z: lamps[0].sz }, open, until, take_by: Math.floor((open + TAKE_BY_H) * 60 + 1e-6) / 60, twist: "none", limit_s: null };
  return { title: w.title, employer: r.lamplighter, pay_c, pitch: w.pitch(lamps.length, hhmm(open), hhmm(until)), task, district: npc.district, faction: npc.faction };
}

function insertJob(db: DB, j: NonNullable<ReturnType<typeof buildLampJob>>): number {
  const { day } = clock(db);
  const r = db
    .prepare(
      `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
       VALUES (?, ?, ?, ?, 'lamps', ?, 'low', ?, NULL, ?, ?, 'lamps', 'offered')`,
    )
    .run(day, j.title, j.employer, j.district, j.pay_c, maxTier(db), j.pitch, JSON.stringify(j.task));
  return Number(r.lastInsertRowid);
}

/**
 * Put the day's lamps job up (once a day): from 5:00 until a quarter of an hour before it can no longer be
 * taken, not on a day that began in fog (the lamps burn all day then). Returns the id put up, or null.
 */
export function offerLampJob(db: DB): number | null {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  if (h < 5) return null;
  if (db.prepare("SELECT 1 FROM job WHERE day = ? AND source = 'lamps'").get(c.day)) return null;
  if (fogAt(fogDay(db), 5)) return null;
  const j = buildLampJob(db);
  if (!j || h >= j.task.take_by - 0.25) return null;
  return insertJob(db, j);
}

// ------------------------------------------------------------------ taking it

takeChecks.push((db, j) => {
  if (j.source !== "lamps" || j.task?.kind !== "lamps") return;
  if (hourNow(db) >= j.task.take_by) throw new GameError(`too late for that one: ${j.employer_name} is out on his round and has lit them himself`, 409);
});

// taken: the stretch waits for Jef tonight (and the lamplighter ends his round before it)
takeHooks.push((db, j) => {
  if (j.source !== "lamps" || j.task?.kind !== "lamps") return;
  const t = j.task;
  saveHelp(db, { day: j.day, round: t.round, from: t.from, lit: [], open: t.open, until: t.until, job: j.id });
});

// ------------------------------------------------------------------ doing it

function takenLamps(db: DB, jobId: number): { j: JobRow; t: LampsTask } {
  const j = listJobs(db, clock(db).day).find((r) => r.id === jobId);
  const mine = !!db.prepare("SELECT 1 FROM job WHERE id = ? AND taken_by = ?").get(jobId, pid());
  if (!j || j.status !== "taken" || !mine || j.task?.kind !== "lamps") throw new GameError("no lamps in hand", 409);
  return { j, t: j.task };
}

function saveTask(db: DB, id: number, t: LampsTask): void {
  const done = t.lamps.filter((l) => l.done).length;
  db.prepare("UPDATE job SET task_json = ? WHERE id = ?").run(JSON.stringify({ ...t, progress: { delivered: done, lost: 0, sold: 0 } }), id);
}

/** The spare pole, where it leans against the first lamp. */
export function takePole(db: DB, jobId: number, at: { x: number; z: number }): { text: string } {
  const { j, t } = takenLamps(db, jobId);
  if (t.picked) return { text: "You have the pole already." };
  if (!within(at, t.pole, REACH_M)) throw new GameError("the pole is not here", 409);
  saveTask(db, jobId, { ...t, picked: true });
  const first = resident(db, j.employer_npc)?.name.split(" ")[0] ?? j.employer_name;
  const h = hourNow(db);
  return {
    text:
      h < t.open
        ? `You take ${first}'s spare pole. The lamps are lit from ${hhmm(t.open)}, when the light goes.`
        : `You take ${first}'s spare pole. ${t.lamps.length} lamps, all by ${hhmm(t.until)}.`,
  };
}

/** A lamp lit: the engine checks the hour, the pole and the place, and marks it. */
export function lightLamp(db: DB, jobId: number, lampId: string, at: { x: number; z: number }): { text: string; left: number } {
  const { j, t } = takenLamps(db, jobId);
  const k = t.lamps.findIndex((l) => l.id === lampId);
  const l = t.lamps[k];
  if (!l) throw new GameError("that lamp is not one of yours", 404);
  const left = () => t.lamps.filter((x) => !x.done).length;
  if (l.done) return { text: "That one burns already.", left: left() };
  if (!t.picked) throw new GameError("fetch the pole first", 409);
  if (!within(at, { x: l.sx, z: l.sz }, REACH_M)) throw new GameError("you cannot reach that lamp from here", 409);
  const h = hourNow(db);
  if (h < t.open) throw new GameError(`too early: the lamps are lit from ${hhmm(t.open)}`, 409);
  if (h >= t.until) throw new GameError(`too late: the lamps were to burn by ${hhmm(t.until)}`, 409);
  l.done = true;
  db.transaction(() => {
    saveTask(db, jobId, t);
    const help = lampHelp(db);
    if (help && help.job === jobId && !help.lit.includes(l.id)) saveHelp(db, { ...help, lit: [...help.lit, l.id] });
    log(db, "lit_lamp", l.id, `Jef lit a street lamp (${l.id}) on the round of ${j.employer_name}.`);
  })();
  const n = left();
  return { text: n ? `The gas catches. ${n} to go.` : `The gas catches. That was the last one.`, left: n };
}

// ------------------------------------------------------------------ the deadline

/**
 * The deadline passed (or the day turned) with the job still in hand: it is settled by the lamps lit (none lit
 * is a failed job, and the lamplighter remembers). Work still offered past its take-by hour is taken off.
 */
export function expireLampJobs(db: DB): number {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  const rows = db.prepare("SELECT id, day, status, title, employer_npc, task_json, taken_by FROM job WHERE source = 'lamps' AND status IN ('offered', 'taken')").all() as Array<{
    id: number;
    day: number;
    status: string;
    title: string;
    employer_npc: string;
    task_json: string;
    taken_by: number | null;
  }>;
  let n = 0;
  for (const r of rows) {
    const t = JSON.parse(r.task_json) as LampsTask;
    // (a job in hand a quarter of an hour after its deadline: the game settles it at the deadline itself, with its words)
    const past = r.day < c.day || (r.status === "offered" ? h >= t.take_by : h >= t.until + 0.25);
    if (!past) continue;
    n++;
    if (r.status === "offered") {
      db.prepare("UPDATE job SET status = 'expired' WHERE id = ?").run(r.id);
      continue;
    }
    asPlayer(r.taken_by ?? 1, () => {
      const lit = t.lamps.filter((l) => l.done).length;
      if (lit) {
        finishJob(db, r.id, { delivered: lit, lost: 0, sold: 0, pocketed: false, late: false, left_post_s: 0, thief: "none", bribe_taken: false, seen_away: false });
        return;
      }
      db.transaction(() => {
        db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(r.id);
        log(db, "failed_job", String(r.id), `The lamps of "${r.title}" were not lit by ${hhmm(t.until)}; the lamplighter lit them himself, late.`);
      })();
      remember(db, r.employer_npc, `Jef took the last lamps of my round and never lit one. I lit them myself, late, in the dark.`, 4, "seen", null, { gist: "Jef left a lamplighter's lamps dark", tone: -1 });
    });
  }
  return n;
}

// ------------------------------------------------------------------ the routes

const num = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new GameError("bad position", 400);
  return v;
};

export function mountLampJob(app: Hono, deps: { db: DB; payload: () => Record<string, unknown>; broadcast: (m: unknown) => void }): void {
  const { db, payload, broadcast } = deps;
  let lastHour = -1;
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      const c = clock(db);
      let changed = expireLampJobs(db) > 0;
      if (c.hour !== lastHour) {
        lastHour = c.hour;
        if (offerLampJob(db) !== null) changed = true;
      }
      if (changed) broadcast({ type: "jobs", ...payload() });
    } catch (e) {
      console.error("[lampjob] tick", e);
    }
  });
  app.post("/api/lamps/pole", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { job?: unknown; x?: unknown; z?: unknown };
    const r = takePole(db, Number(b.job), { x: num(b.x), z: num(b.z) });
    return c.json({ ...r, ...payload() });
  });
  app.post("/api/lamps/light", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { job?: unknown; lamp?: unknown; x?: unknown; z?: unknown };
    const r = lightLamp(db, Number(b.job), String(b.lamp ?? ""), { x: num(b.x), z: num(b.z) });
    // (every player sees the lamp burn: the help record rides on the payload)
    broadcast({ type: "jobs", ...payload() });
    return c.json({ ...r, ...payload() });
  });
  if (DEV) {
    /** Dev: the lamps job now ({ round? }: west, market, east, north; else the day's), offered on today's board. */
    app.post("/api/dev/lamps/job", async (c) => {
      const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { round?: string };
      const j = buildLampJob(db, typeof b.round === "string" ? b.round : undefined);
      if (!j) throw new GameError("no lamplighter's round for that", 409);
      const id = insertJob(db, j);
      broadcast({ type: "jobs", ...payload() });
      return c.json({ id, title: j.title, pay_c: j.pay_c, task: j.task, employer: j.employer, plan: lampTimes(lampRounds(db)!.rounds.find((r) => r.id === j.task.round)!, j.task.from) });
    });
  }
}

// after a new board (the day's first), the lamplighter's help goes up with it
boardExtras.push((db) => void offerLampJob(db));
