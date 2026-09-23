import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { FALLBACK_BOARD, listJobs, makeBoard, type Board } from "../src/hooks/jobBoard.ts";
import { finishJob, ReportSchema, saveOutcome, saveProgress, settle, takeJob } from "../src/game.ts";
import { fallbackOutcome, writeOutcome } from "../src/hooks/jobOutcome.ts";

const reply = (output: unknown): Runner => async () => ({ output, usage: { in: 10, out: 20, cacheRead: 5 } });
const report = (r: Partial<ReturnType<typeof ReportSchema.parse>> = {}) => ReportSchema.parse(r);
const never = () => 0.99; // misdeeds never noticed by chance
const always = () => 0.0; // misdeeds always noticed

const good: Board = {
  jobs: [
    { title: "Hides to the natie", employer: "sooi", task_type: "carry", goods: "hides", from: "pier_head", to: "hessenatie_door", twist: "none", urgent: false, recipient: "", pay_c: 120, risk: "low", pitch: "Wet hides off the pier. Up to our door, baas says." },
    { title: "Watch the tar", employer: "peeters", task_type: "watch", goods: "barrels", from: "west_sheds", to: "west_sheds", twist: "thief", urgent: false, recipient: "", pay_c: 80, risk: "medium", pitch: "Stand by my tar till the bell." },
    { title: "A letter for the mate", employer: "tuur", task_type: "deliver", goods: "parcel", from: "pier_head", to: "ship_gangway", twist: "stranger_offer", urgent: true, recipient: "the mate", pay_c: 100, risk: "medium", pitch: "Don't open it." },
    { title: "Row the pastoor across", employer: "tuur", task_type: "row", goods: "parcel", from: "pier_head", to: "pier_head", twist: "none", urgent: false, recipient: "", pay_c: 90, risk: "low", pitch: "Row the pastoor to Sint-Anna." },
  ],
};

async function boardDb(board: unknown = good) {
  const db = openDb(":memory:");
  await makeBoard(db, reply(board));
  return db;
}

describe("job_board hook", () => {
  it("turns model picks into playable tasks", async () => {
    const db = await boardDb();
    const [carry, watch, deliver, row] = listJobs(db, 1);
    expect(carry.task).toEqual({ kind: "carry", goods: "hides", count: 4, from: "pier_head", to: "hessenatie_door", twist: "none", limit_s: null });
    expect(watch.task).toEqual({ kind: "watch", goods: "barrels", post: "west_sheds", duration_s: 90, twist: "thief" });
    expect(deliver.task).toMatchObject({ kind: "deliver", from: "pier_head", to: "ship_gangway", recipient: "the mate", twist: "stranger_offer" });
    expect((deliver.task as { limit_s: number }).limit_s).toBeGreaterThan(20);
    expect(row.playable).toBe(false);
    const call = db.prepare("SELECT ok, in_tokens, cache_read FROM ai_call").get();
    expect(call).toEqual({ ok: 1, in_tokens: 10, cache_read: 5 });
  });

  it("fixes picks that do not fit: bad twist, same place twice, parcel as carry goods", async () => {
    const odd = structuredClone(good);
    odd.jobs[0] = { ...odd.jobs[0], twist: "thief", to: "pier_head", goods: "parcel" };
    const db = await boardDb(odd);
    expect(listJobs(db, 1)[0].task).toMatchObject({ twist: "none", from: "pier_head", to: "hessenatie_door", goods: "crates" });
  });

  it("clamps pay into the tier 0 band", async () => {
    const greedy = structuredClone(good);
    greedy.jobs[0].pay_c = 99999;
    greedy.jobs[1].pay_c = -40;
    const pays = listJobs(await boardDb(greedy), 1).map((j) => j.pay_c);
    expect(pays[0]).toBe(150);
    expect(pays[1]).toBe(50);
  });

  it("rejects an unknown place and falls back", async () => {
    const bad = structuredClone(good) as { jobs: Array<Record<string, unknown>> };
    bad.jobs[0].to = "the moon";
    const db = openDb(":memory:");
    const r = await makeBoard(db, reply(bad));
    expect(r.source).toBe("fallback");
    expect(r.error).toMatch(/schema/);
    expect(listJobs(db, 1).map((j) => j.title)).toEqual(FALLBACK_BOARD.jobs.map((j) => j.title));
    expect((db.prepare("SELECT COUNT(*) n FROM ai_call WHERE ok = 0").get() as { n: number }).n).toBe(2);
  });

  it("falls back on timeout", async () => {
    const db = openDb(":memory:");
    const hang: Runner = ({ signal }) =>
      new Promise((_, reject) => signal.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const r = await makeBoard(db, hang, 300);
    expect(r.source).toBe("fallback");
    expect(r.error).toMatch(/timeout/);
  });

  it("adds a playable job when the model gives none", async () => {
    const none = structuredClone(good);
    for (const j of none.jobs) j.task_type = "talk";
    expect(listJobs(await boardDb(none), 1).some((j) => j.playable)).toBe(true);
  });
});

describe("engine rules: carry", () => {
  const carryJob = async () => {
    const db = await boardDb();
    const j = listJobs(db, 1)[0];
    takeJob(db, j.id);
    return { db, j: listJobs(db, 1)[0] };
  };

  it("pays the job's pay for a clean job and adds trust", async () => {
    const { db, j } = await carryJob();
    const res = finishJob(db, j.id, report({ delivered: 4 }), never);
    expect(res.settlement).toMatchObject({ pay_c: 120, extra_c: 0, trust_delta: 1, caught: false, status: "done" });
    expect(res.money_c).toBe(170);
    expect((db.prepare("SELECT trust FROM faction_trust WHERE faction = 'naties'").get() as { trust: number }).trust).toBe(1);
    expect(() => finishJob(db, j.id, report({ delivered: 4 }))).toThrow(/not in hand/);
  });

  it("needs every item accounted for", async () => {
    const { db, j } = await carryJob();
    expect(() => finishJob(db, j.id, report({ delivered: 2 }))).toThrow(/accounted/);
    expect(() => finishJob(db, j.id, report({ delivered: 4, lost: 1 }))).toThrow(/accounted/);
  });

  it("pays a share, and a crate in the Schelde costs trust", async () => {
    const { j } = await carryJob();
    const s = settle(j, report({ delivered: 3, lost: 1 }), never);
    expect(s).toMatchObject({ pay_c: 90, trust_delta: -1, caught: false });
    expect(s.facts.join(" ")).toMatch(/Schelde/);
  });

  it("late costs a quarter", async () => {
    const { j } = await carryJob();
    expect(settle(j, report({ delivered: 4, late: true }), never).pay_c).toBe(90);
  });

  it("selling to the stranger pays coin; if caught, the employer pays nothing", async () => {
    const { j } = await carryJob();
    expect(settle(j, report({ delivered: 3, sold: 1 }), never)).toMatchObject({ pay_c: 90, extra_c: 35, trust_delta: 0, caught: false });
    expect(settle(j, report({ delivered: 3, sold: 1 }), always)).toMatchObject({ pay_c: 0, extra_c: 35, trust_delta: -2, caught: true });
  });

  it("the watching foreman always sees", async () => {
    const { j } = await carryJob();
    j.task = { ...j.task!, twist: "foreman_watches" } as typeof j.task;
    expect(settle(j, report({ delivered: 4, pocketed: true }), never)).toMatchObject({ caught: true, pay_c: 0 });
  });

  it("saves progress and refuses more goods than the job has", async () => {
    const { db, j } = await carryJob();
    saveProgress(db, j.id, { delivered: 2, lost: 1, sold: 0 });
    expect((listJobs(db, 1)[0].task as { progress: unknown }).progress).toEqual({ delivered: 2, lost: 1, sold: 0 });
    expect(() => saveProgress(db, j.id, { delivered: 4, lost: 1, sold: 0 })).toThrow(/more goods/);
  });
});

describe("engine rules: watch and deliver", () => {
  it("watch: thief chased earns a tip, stolen goods and leaving the post halve pay", async () => {
    const db = await boardDb();
    const w = listJobs(db, 1)[1];
    expect(settle(w, report({ thief: "chased" }), never)).toMatchObject({ pay_c: 80, extra_c: 15, trust_delta: 1 });
    expect(settle(w, report({ thief: "stole" }), never)).toMatchObject({ pay_c: 40, trust_delta: -1 });
    expect(settle(w, report({ thief: "stole", left_post_s: 40 }), never)).toMatchObject({ pay_c: 20, trust_delta: -1 });
    expect(settle(w, report({ bribe_taken: true, thief: "stole" }), always)).toMatchObject({ pay_c: 0, extra_c: 50, caught: true });
  });

  it("deliver: selling the parcel fails the job", async () => {
    const db = await boardDb();
    const d = listJobs(db, 1)[2];
    expect(settle(d, report({ delivered: 1 }), never)).toMatchObject({ pay_c: 100, status: "done", trust_delta: 1 });
    expect(settle(d, report({ sold: 1 }), never)).toMatchObject({ pay_c: 0, extra_c: 60, status: "failed" });
  });

  it("will not take a task type the game cannot play", async () => {
    const db = await boardDb();
    expect(() => takeJob(db, listJobs(db, 1)[3].id)).toThrow(/not in the game/);
  });
});

describe("job_outcome hook", () => {
  it("stores the narration and an employer memory, weight clamped", async () => {
    const db = await boardDb();
    const j = listJobs(db, 1)[0];
    takeJob(db, j.id);
    const res = finishJob(db, j.id, report({ delivered: 4 }), never);
    const out = await writeOutcome(db, res.job, res.settlement, reply({ narration: "Sooi grunts and pays. \"Again tomorrow.\"", memory: "The Kempen boy carries without talk.", weight: 10 }));
    expect(out.source).toBe("claude");
    saveOutcome(db, j.id, out.outcome.narration, out.outcome.memory, out.outcome.weight);
    expect(listJobs(db, 1)[0].outcome_text).toMatch(/Sooi grunts/);
    expect(db.prepare("SELECT npc_id, source, weight FROM npc_memory").get()).toEqual({ npc_id: "sooi", source: "seen", weight: 8 });
  });

  it("falls back to a plain line", async () => {
    const db = await boardDb();
    const j = listJobs(db, 1)[0];
    const s = settle(j, report({ delivered: 3, sold: 1 }), always);
    expect(fallbackOutcome(j, s).narration).toMatch(/Not a centime/);
  });
});
