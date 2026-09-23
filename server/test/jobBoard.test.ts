import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { FALLBACK_BOARD, listJobs, makeBoard } from "../src/hooks/jobBoard.ts";
import { finishJob, takeJob } from "../src/game.ts";

const reply = (output: unknown): Runner => async () => ({ output, usage: { in: 10, out: 20, cacheRead: 5 } });

const good = {
  jobs: [
    { title: "Hides to the natie", employer: "sooi", task_type: "carry", pay_c: 120, risk: "low", pitch: "Wet hides off the pier. Up to our door, baas says." },
    { title: "Rope for the widow", employer: "peeters", task_type: "carry", pay_c: 95, risk: "low", pitch: "Coils of tarred rope to my loading door." },
    { title: "Watch the sheds", employer: "sooi", task_type: "watch", pay_c: 70, risk: "medium", pitch: "Stand by the sheds till the bell." },
  ],
};

describe("job_board hook", () => {
  it("stores a valid board from the model", async () => {
    const db = openDb(":memory:");
    const r = await makeBoard(db, reply(good));
    expect(r.source).toBe("claude");
    const jobs = listJobs(db, 1);
    expect(jobs).toHaveLength(3);
    expect(jobs[0].task).toEqual({ kind: "carry", crates: 4, from: "pier_head", to: "hessenatie_door" });
    expect(jobs[2].playable).toBe(false);
    const call = db.prepare("SELECT ok, in_tokens, cache_read FROM ai_call").get();
    expect(call).toEqual({ ok: 1, in_tokens: 10, cache_read: 5 });
  });

  it("clamps pay into the tier 0 band", async () => {
    const db = openDb(":memory:");
    const greedy = structuredClone(good);
    greedy.jobs[0].pay_c = 99999;
    greedy.jobs[1].pay_c = -40;
    await makeBoard(db, reply(greedy));
    const pays = listJobs(db, 1).map((j) => j.pay_c);
    expect(pays[0]).toBe(150);
    expect(pays[1]).toBe(50);
  });

  it("rejects an unknown employer and falls back", async () => {
    const db = openDb(":memory:");
    const bad = structuredClone(good) as { jobs: Array<Record<string, unknown>> };
    bad.jobs[0].employer = "napoleon";
    const r = await makeBoard(db, reply(bad));
    expect(r.source).toBe("fallback");
    expect(r.error).toMatch(/schema/);
    expect(listJobs(db, 1).map((j) => j.title)).toEqual(FALLBACK_BOARD.jobs.map((j) => j.title));
    // schema failure is retried once, both attempts logged
    expect((db.prepare("SELECT COUNT(*) n FROM ai_call WHERE ok = 0").get() as { n: number }).n).toBe(2);
  });

  it("falls back on timeout", async () => {
    const db = openDb(":memory:");
    const hang: Runner = ({ signal }) =>
      new Promise((_, reject) => signal.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const r = await makeBoard(db, hang, 300);
    expect(r.source).toBe("fallback");
    expect(r.error).toMatch(/timeout/);
    expect(listJobs(db, 1).length).toBeGreaterThanOrEqual(3);
  });

  it("adds a carry job when the model gives none", async () => {
    const db = openDb(":memory:");
    const noCarry = structuredClone(good);
    for (const j of noCarry.jobs) j.task_type = "watch";
    await makeBoard(db, reply(noCarry));
    expect(listJobs(db, 1).some((j) => j.task_type === "carry" && j.task)).toBe(true);
  });
});

describe("carry job rules", () => {
  it("pays the job's own pay once, only when all crates are in", async () => {
    const db = openDb(":memory:");
    await makeBoard(db, reply(good));
    const job = listJobs(db, 1)[0];
    takeJob(db, job.id);
    expect(() => takeJob(db, listJobs(db, 1)[1].id)).toThrow(/finish the job/);
    expect(() => finishJob(db, job.id, 2)).toThrow(/of 4/);
    const res = finishJob(db, job.id, 4);
    expect(res.paid_c).toBe(120);
    expect(res.money_c).toBe(50 + 120);
    expect(() => finishJob(db, job.id, 4)).toThrow(/not in hand/);
  });

  it("will not take a task type the game cannot play", async () => {
    const db = openDb(":memory:");
    await makeBoard(db, reply(good));
    expect(() => takeJob(db, listJobs(db, 1)[2].id)).toThrow(/not in the game/);
  });
});
