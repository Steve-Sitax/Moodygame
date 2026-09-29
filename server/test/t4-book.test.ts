import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { devJob } from "../src/hooks/jobBoard.ts";
import { MAX_JOBS_IN_HAND, giveUpJob, takeJob } from "../src/game.ts";

// T4 the quest book (docs/trade-plan.md): a player may hold up to three jobs at once; a fourth is refused with a plain
// word. Each job keeps its own time, twist and pay (the rows are the jobs' own).

vi.setConfig({ testTimeout: 60_000 });

describe("T4: several jobs in hand", () => {
  it("up to three jobs in hand; a fourth is refused", () => {
    const db = blankSave();
    const ids = [0, 1, 2, 3].map(() => devJob(db, { type: "carry" }).id);
    for (let i = 0; i < MAX_JOBS_IN_HAND; i++) expect(() => takeJob(db, ids[i])).not.toThrow();
    expect(() => takeJob(db, ids[3])).toThrow(/hands full/);
    const taken = db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'taken'").get() as { n: number };
    expect(taken.n).toBe(MAX_JOBS_IN_HAND);
  });

  it("a carry job given up: no pay, the employer's trust one down, the job no longer in hand", () => {
    const db = blankSave();
    const id = devJob(db, { type: "carry" }).id;
    takeJob(db, id);
    const money = () => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
    const before = money();
    const r = giveUpJob(db, id);
    expect(r.settlement.pay_c).toBe(0);
    expect(r.settlement.trust_delta).toBe(-1);
    expect(r.job.status).toBe("failed");
    expect(money()).toBe(before);
    expect(() => giveUpJob(db, id)).toThrow(/not in hand/);
  });
});
