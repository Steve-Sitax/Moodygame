import type { DB } from "./db.ts";
import { listJobs, type CarryTask, type JobRow } from "./hooks/jobBoard.ts";

// Engine rules. Numbers change here and nowhere else (docs/03 rule one).

export interface PlayerState {
  name: string;
  money_c: number;
  day: number;
  hour: number;
  district: string;
}

export function player(db: DB): PlayerState {
  return db.prepare("SELECT name, money_c, day, hour, district FROM player WHERE id = 1").get() as PlayerState;
}

function log(db: DB, verb: string, object: string | null, text: string, actor = "player"): void {
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

function job(db: DB, id: number): JobRow {
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

/**
 * The client reports what happened in 3D (engine facts). The server checks it
 * against the task and pays. Pay comes from the job row, never from the client.
 */
export function finishJob(db: DB, id: number, delivered: number): { job: JobRow; paid_c: number; money_c: number } {
  const j = job(db, id);
  if (j.status !== "taken") throw new GameError("that job is not in hand", 409);
  const task = j.task as CarryTask | null;
  if (!task) throw new GameError("job has no task", 400);
  if (!Number.isInteger(delivered) || delivered < task.crates) {
    throw new GameError(`only ${delivered} of ${task.crates} delivered`, 409);
  }
  const paid = j.pay_c;
  db.transaction(() => {
    db.prepare("UPDATE job SET status = 'done', outcome_text = ? WHERE id = ?").run(
      `${task.crates} crates delivered. Paid ${paid} centimes.`,
      id,
    );
    db.prepare("UPDATE player SET money_c = money_c + ?, hour = MIN(hour + 1, 23) WHERE id = 1").run(paid);
    log(db, "finished_job", String(id), `Jef carried ${task.crates} crates for ${j.employer_name} and was paid ${paid} centimes.`);
  })();
  return { job: job(db, id), paid_c: paid, money_c: player(db).money_c };
}
