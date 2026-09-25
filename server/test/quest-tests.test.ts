import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { resetTickLimit } from "../src/day.ts";
import { GameError, ReportSchema, settle, takeJob } from "../src/game.ts";
import { devJob, FALLBACK_BOARD, jobById, listJobs, taskFor, type JobRow } from "../src/hooks/jobBoard.ts";
import { buildPrompt as outcomePrompt, workLine } from "../src/hooks/jobOutcome.ts";
import { clampNight, expireNightWork, FALLBACK_NIGHT, insertNightJobs, leastMinutes, setNightDice } from "../src/night/nightwork.ts";
import { fitHour, residentOpen } from "../src/town/talk.ts";
import { town } from "../src/town/store.ts";
import { postJob, type EventRow, type StoredStage } from "../src/director/scheduler.ts";
import { resetSync, validateProposal, whereIs } from "../src/director/actions.ts";

// M7 quest tests (2026-09-25, docs/milestones/M7-quest-tests.md): every job played from the board to the
// pay in the browser on a test save; the server side of each bug found, one block per finding.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const status = (db: Db, id: number) => (db.prepare("SELECT status FROM job WHERE id = ?").get(id) as { status: string }).status;
const jobOf = (db: Db, spec: Parameters<typeof devJob>[1]): JobRow => jobById(db, devJob(db, spec).id)!;

afterEach(() => {
  setNightDice(null);
  resetTickLimit();
});

describe("M7 quest tests: the settling's facts", () => {
  it("a bribe taken on a watch with no thief: the bribe's loss is told once, no thief out of the fog", () => {
    const db = openDb(":memory:");
    const j = jobOf(db, { type: "watch", twist: "bribe", employer: "waterschout", to: "steen_gate" });
    // the client reports "stole" for the briber's take (runs.ts WatchRun)
    const s = settle(j, ReportSchema.parse({ thief: "stole", bribe_taken: true }), () => 0.99);
    expect(s.facts.join(" ")).not.toMatch(/thief came out of the fog/);
    expect(s.facts.join(" ")).toMatch(/paid Jef to look away/);
    expect(s.pay_c).toBe(40); // the loss still halves the pay (80 c)
    expect(s.extra_c).toBe(50);
    // a real thief still is one
    const t = jobOf(db, { type: "watch", twist: "thief", employer: "sooi" });
    expect(settle(t, ReportSchema.parse({ thief: "stole" }), () => 0.99).facts.join(" ")).toMatch(/thief came out of the fog/);
  });

  it("a deliver's facts: one thing, and a sentence starts with a capital", () => {
    const db = openDb(":memory:");
    const sacks = jobOf(db, { type: "deliver", twist: "none", employer: "koster", to: "handschoen_well", goods: "sacks" });
    expect(settle(sacks, ReportSchema.parse({ delivered: 1 })).facts[0]).toBe("Jef handed the sack to the mate of the Anna Maria.");
    const parcel = jobOf(db, { type: "deliver", twist: "stranger_offer", employer: "tuur" });
    const lost = settle(parcel, ReportSchema.parse({ sold: 1 }), () => 0.99).facts[0];
    expect(lost).toBe("The parcel never reached the mate of the Anna Maria.");
  });
});

describe("M7 quest tests: the outcome writer knows the real work", () => {
  it("the goods and places the engine set, not only the pitch (a brewer's barrels were 'counted by the Hessenatie door')", () => {
    const db = openDb(":memory:");
    // the dev job keeps the hand-written pitch (pier head to the Hessenatie door); the work is the brewer's
    const j = jobOf(db, { type: "carry", twist: "none", employer: "brouwer", from: "brewery_yard", to: "canal_quay", goods: "barrels" });
    expect(j.pitch).toMatch(/Hessenatie/);
    expect(workLine(j)).toBe("The work, as it really was (these goods and places, whatever the pitch says): 4 barrels from the brewery door to the canal quay.");
    const p = outcomePrompt(j, { pay_c: 90, extra_c: 0, trust_delta: 1, caught: false, status: "done", facts: ["Jef brought 4 of 4 barrels for Ferdinand Maes."] });
    expect(p).toContain("4 barrels from the brewery door to the canal quay");
    const w = jobOf(db, { type: "watch", twist: "thief", employer: "katoen", to: "entrepot_quay", goods: "sacks" });
    expect(workLine(w)).toMatch(/a watch over the sacks at the Entrepot quay/);
    const d = jobOf(db, { type: "deliver", twist: "none", employer: "vishandel", to: "vleeshuis_door" });
    expect(workLine(d)).toMatch(/a parcel from the fish stalls to the mate of the Anna Maria at the Vleeshuis/);
  });
});

describe("M7 quest tests: night work that cannot be done by five", () => {
  it("the least time: five sacks over 68 m at a run take a little over two game hours (five at a walk); a watch its bell", () => {
    const [carry] = clampNight({ jobs: [{ ...FALLBACK_NIGHT.jobs[1], goods: "sacks", pay_c: 230 }] }, 0);
    const t = taskFor({ title: carry.title, employer: carry.giver, task_type: carry.task_type, goods: carry.goods, from: carry.from, to: carry.to, twist: carry.twist, urgent: false, recipient: carry.recipient, pay_c: carry.pay_c, risk: "high", pitch: carry.pitch })!;
    expect(t).toMatchObject({ kind: "carry", count: 5, from: "werf_pontoon", to: "steen_gate" });
    const m = leastMinutes(t, "werf_quay");
    expect(m).toBeGreaterThan(110);
    expect(m).toBeLessThan(150);
    expect(leastMinutes({ kind: "watch", goods: "crates", post: "bassin_quay", duration_s: 120, twist: "none" })).toBe(60);
  });

  it("at 4:30 the long carry is off the offer and cannot be taken; the short deliver still can", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    const ids = insertNightJobs(db, clampNight(FALLBACK_NIGHT, 0), 0, "fallback");
    const [fence, smuggler] = ids;
    setClock(db, 2, 4, 30);
    // taking it is refused by the engine, in words
    expect(() => takeJob(db, smuggler)).toThrow(GameError);
    expect(() => takeJob(db, smuggler)).toThrow(/gone at five/);
    // the tick takes it off the givers' offer
    expect(expireNightWork(db)).toBeGreaterThan(0);
    expect(status(db, smuggler)).toBe("expired");
    expect(status(db, fence)).toBe("offered");
    expect(takeJob(db, fence).status).toBe("taken");
    // earlier in the night all of it is open
    const db2 = openDb(":memory:");
    setClock(db2, 1, 22);
    const ids2 = insertNightJobs(db2, clampNight(FALLBACK_NIGHT, 0), 0, "fallback");
    setClock(db2, 1, 23, 30);
    expect(expireNightWork(db2)).toBe(0);
    expect(takeJob(db2, ids2[1]).status).toBe("taken");
  });

  it("a day job is never refused for the hour", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 4, 55);
    const { id } = devJob(db, { type: "carry", employer: "sooi" });
    expect(takeJob(db, id).status).toBe("taken");
  });
});

describe("M7 quest tests: an event's work on the board says what it is", () => {
  it("the title is the engine's, the goods follow the words, the words go into the pitch", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 9);
    const ev = { id: 1, title: "The fish auction", x: -116, z: 24 } as unknown as EventRow;
    postJob(db, ev, { op: "job", text: "The buyers want their barrels carried from the Vismarkt to their carts." } as unknown as StoredStage);
    const j = listJobs(db, 1).find((x) => x.source === "event")!;
    expect(j.title).toBe("Hands wanted: the fish auction");
    expect(j.task).toMatchObject({ kind: "carry", goods: "barrels" });
    expect(j.pitch).toMatch(/^The buyers want their barrels carried/);
    // no goods named: sacks, as before
    postJob(db, ev, { op: "job", text: "Hands needed at the stalls" } as unknown as StoredStage);
    expect(listJobs(db, 1).filter((x) => x.source === "event")[1].task).toMatchObject({ goods: "sacks" });
  });
});

describe("M7 quest tests: a look about for someone at home is refused at once", () => {
  it("look_for a person indoors: 'They're indoors now'; one out in the street: yes", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 10);
    resetSync();
    const all = town(db).town.residents;
    const asker = all.find((x) => x.trade === "docker" && !whereIs(db, x).indoors)!;
    const home = all.find((x) => x.id !== asker.id && x.age >= 18 && whereIs(db, x).indoors)!;
    const out = all.find((x) => x.id !== asker.id && x.age >= 18 && !whereIs(db, x).indoors && x.trade !== "police")!;
    const no = validateProposal(db, asker, { kind: "look_for", target: home.name, minutes: 0, item: "", amount_c: 0, reason: "a word" });
    expect(no.ok).toBe(false);
    expect(no.line).toMatch(/indoors/);
    const yes = validateProposal(db, asker, { kind: "look_for", target: out.name, minutes: 0, item: "", amount_c: 0, reason: "a word" });
    expect(yes.ok).toBe(true);
  });
});

describe("M7 quest tests: the engine's greetings fit the hour", () => {
  it("no 'Morning.' at one in the afternoon, no 'Good day' at midnight, 'tonight' only after dark", () => {
    const warm = ["Good day to you.", "Well now, a new face. Good day.", "Morning. You look like you could use a hot meal."];
    expect(fitHour(warm, 13)).toEqual(warm.slice(0, 2));
    expect(fitHour(warm, 8)).toEqual(warm);
    // at midnight none fits: the list as it was (never an empty pick)
    expect(fitHour(warm, 0)).toEqual(warm);
    const amused = ["Ha. And who might you be?", "Evening! Or is it? I've lost count.", "Look at this one."];
    expect(fitHour(amused, 12)).not.toContain("Evening! Or is it? I've lost count.");
    expect(fitHour(amused, 19)).toEqual(amused);
    expect(fitHour(["Move along, unless you've business.", "I've my eye on the quays tonight."], 10)).toEqual(["Move along, unless you've business."]);
    expect(fitHour(["Good day, then.", "Go on, then."], 23)).toEqual(["Go on, then."]);
  });

  it("the talk's goodbye choice at night is 'Good night to you.'", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 23, 0);
    const [a, b] = town(db).town.residents.filter((x) => x.age >= 18 && x.trade === "docker");
    const open = residentOpen(db, a.id);
    expect(open.choices).toContain("Good night to you.");
    expect(open.choices).not.toContain("Good day to you.");
    setClock(db, 1, 10, 0);
    expect(residentOpen(db, b.id).choices).toContain("Good day to you.");
  });
});

describe("M7 quest tests: the hand-written work says the places it is played at", () => {
  it("every fallback job keeps its places through the engine (the smuggler's crates went to the pontoon, the pitch said the Steen gate)", () => {
    for (const j of FALLBACK_NIGHT.jobs) {
      const t = taskFor({ title: j.title, employer: j.giver, task_type: j.task_type, goods: j.goods, from: j.from, to: j.to, twist: j.twist, urgent: false, recipient: j.recipient, pay_c: j.pay_c, risk: "high", pitch: j.pitch })!;
      if (t.kind === "watch") expect(t.post, j.title).toBe(j.to);
      else if (t.kind !== "letters") expect([t.from, t.to], j.title).toEqual([j.from, j.to]);
    }
    for (const j of FALLBACK_BOARD.jobs) {
      const t = taskFor(j)!;
      if (t.kind === "watch") expect(t.post, j.title).toBe(j.to);
      else if (t.kind !== "letters") expect([t.from, t.to], j.title).toEqual([j.from, j.to]);
    }
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    insertNightJobs(db, clampNight(FALLBACK_NIGHT, 0), 0, "fallback");
    const sm = listJobs(db, 1).find((j) => j.employer_npc === "smuggler")!;
    expect(sm.pitch).toMatch(/pontoon/);
  });
});

describe("M7 quest tests: taking work that went off the offer says why", () => {
  it("night work taken off before five: 'too late for that one', not 'no such job'", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    const [, smuggler] = insertNightJobs(db, clampNight(FALLBACK_NIGHT, 0), 0, "fallback");
    setClock(db, 2, 4, 30);
    expireNightWork(db);
    expect(() => takeJob(db, smuggler)).toThrow(/too late for that one/);
  });
});
