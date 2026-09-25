import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { clock, passTime, resetTickLimit, sleep } from "../src/day.ts";
import { finishJob, holdJob, player, ReportSchema, takeJob } from "../src/game.ts";
import { buildPrompt, devJob, listJobs, makeBoard } from "../src/hooks/jobBoard.ts";
import { topMemories } from "../src/npcs.ts";
import { NIGHT_GIVERS } from "../src/town/places.ts";
import { activityAt } from "../src/town/schedule.ts";
import { town } from "../src/town/store.ts";
import { ensureNightTown } from "../src/night/givers.ts";
import { expireNightWork, FALLBACK_NIGHT, insertNightJobs, clampNight, nightBand, nightBoardDue, setNightDice, settleNight, writeNightBoard, NIGHT_PAY_MIN_C } from "../src/night/nightwork.ts";
import { GANG_BASE_PER_HOUR, GANG_MULT, gangChancePerHour, resetGangRoll, resolveGang, robbedAsleep, rollGang, setGangDice, clearGangs } from "../src/night/gangs.ts";
import { resetSync, syncFromClient } from "../src/director/actions.ts";
import { planEvent, NIGHT_GATHER_MAX } from "../src/director/scheduler.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";
import { roomForEvent } from "../src/director/director.ts";
import { cellNight } from "../src/town/police.ts";
import { atPost, NIGHT_GIVER_IDS, sleepMinutes } from "../../shared/night.ts";
import type { Settlement } from "../src/game.ts";

// M7 night (Steve 2026-09-25): no forced night; the employers go home and leave a quest box; the shady
// givers and their night work; the gangs; the director's night. Every number here is the engine's;
// the model is a stub (a Runner) that proposes.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const set = (db: Db, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();
const status = (db: Db, id: number) => (db.prepare("SELECT status FROM job WHERE id = ?").get(id) as { status: string }).status;
const offline: Runner = async () => {
  throw new Error("offline");
};
const reply = (output: unknown): Runner => async () => ({ output });

beforeEach(() => {
  resetTickLimit();
  resetGangRoll();
  resetSync();
});
afterEach(() => {
  setGangDice(null);
  setNightDice(null);
});

describe("M7 night: the hours", () => {
  it("sleep lasts seven hours rested, eight dead tired, in fives", () => {
    expect(sleepMinutes(10)).toBe(420);
    expect(sleepMinutes(0)).toBe(480);
    expect(sleepMinutes(5)).toBe(450);
  });

  it("the Rijnkaai's employers keep their hours; the town's go home after their schedule", () => {
    expect(atPost("sooi", 12)).toBe(true);
    expect(atPost("sooi", 21)).toBe(false);
    expect(atPost("sooi", 5.5)).toBe(true);
    expect(atPost("tuur", 1)).toBe(true); // the night lighter until 2:00
    expect(atPost("tuur", 3)).toBe(false);
    const db = openDb(":memory:");
    const katoen = town(db).byId.get("katoen")!;
    expect(activityAt(katoen.sched, 2, 12).act).toBe("work");
    expect(activityAt(katoen.sched, 2, 23).act).not.toBe("work");
  });
});

describe("M7 night: the givers of night work", () => {
  it("four givers, the shared list and the server's alike, added to the town once, out from 21:00 to 5:00", () => {
    expect(NIGHT_GIVERS.map((g) => g.id)).toEqual([...NIGHT_GIVER_IDS]);
    const db = openDb(":memory:");
    for (const g of NIGHT_GIVERS) {
      const r = town(db).byId.get(g.id)!;
      expect(r, g.id).toBeTruthy();
      expect(r.trade).toBe(g.trade);
      expect(activityAt(r.sched, 2, 23).act).toBe("work");
      expect(activityAt(r.sched, 2, 2).act).toBe("work");
      expect(activityAt(r.sched, 2, 12).act).toBe("home");
      expect(r.work.at).toBeTruthy();
    }
    expect(ensureNightTown(db)).toBe(0); // idempotent
  });

  it("the day board's model never sees them", () => {
    const db = openDb(":memory:");
    const p = buildPrompt(db);
    for (const g of NIGHT_GIVERS) expect(p).not.toContain(`- ${g.id}:`);
  });

  it("the night board: due at 21:00 once a night; the hand-written jobs when the model fails; paid better; kept from the day board; open past midnight; gone at 5:00", async () => {
    const db = openDb(":memory:");
    setClock(db, 1, 20, 55);
    expect(nightBoardDue(db)).toBe(false);
    setClock(db, 1, 21, 0);
    expect(nightBoardDue(db)).toBe(true);
    const r = await writeNightBoard(db, offline);
    expect(r.source).toBe("fallback");
    expect(r.jobs).toBe(4);
    expect(nightBoardDue(db)).toBe(false);
    const night = listJobs(db, 1).filter((j) => j.source === "night");
    expect(night.length).toBe(4);
    const [lo] = nightBand(0);
    for (const j of night) {
      expect(j.pay_c).toBeGreaterThanOrEqual(Math.max(NIGHT_PAY_MIN_C, lo));
      expect(j.risk).toBe("high");
      expect(NIGHT_GIVER_IDS as readonly string[]).toContain(j.employer_npc);
    }
    // a new day board at midnight does not expire the night's work
    passTime(db, 4 * 60);
    expect(clock(db)).toMatchObject({ day: 2, hour: 1 });
    await makeBoard(db, offline);
    expect(listJobs(db, 2).filter((j) => j.source === "night" && j.status === "offered").length).toBe(4);
    // one taken, then 5:00: the rest expire, the taken one fails
    takeJob(db, night[0].id);
    setClock(db, 2, 5, 0);
    expect(expireNightWork(db)).toBe(4);
    expect(status(db, night[0].id)).toBe("failed");
    expect(status(db, night[1].id)).toBe("expired");
    expect(topMemories(db, night[0].employer_npc).some((m) => /did not have it done by five/.test(m.text))).toBe(true);
  });

  it("the model's night work: schema, pay clamped, violent words dropped, each giver kept to his own places", async () => {
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    const job = (over: Record<string, unknown>) => ({ title: "Quiet work", giver: "smuggler", task_type: "carry", goods: "crates", from: "werf_quay", to: "cathedral_door", twist: "none", recipient: "", pay_c: 99999, pitch: "Crates off the lighter, quick and quiet.", ...over });
    const r = await writeNightBoard(db, reply({ jobs: [job({}), job({ giver: "fence", task_type: "deliver", goods: "parcel", to: "vleeshuis_door", recipient: "a friend", pitch: "Take the knife to him." }), job({ giver: "nightcarter", from: "canal_west", to: "brewery_yard", pay_c: 1 })] }));
    expect(r.source).toBe("claude");
    const night = listJobs(db, 1).filter((j) => j.source === "night");
    expect(night.some((j) => /knife/.test(j.pitch))).toBe(false);
    const [lo, hi] = nightBand(0);
    for (const j of night) {
      expect(j.pay_c).toBeGreaterThanOrEqual(lo);
      expect(j.pay_c).toBeLessThanOrEqual(hi);
    }
    const sm = night.find((j) => j.employer_npc === "smuggler")!;
    expect(sm.task && "to" in sm.task ? sm.task.to : "").not.toBe("cathedral_door");
  });

  it("the night's risks at the settling: the watch takes the pay, rivals halve it, else the smugglers take note", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    const ids = insertNightJobs(db, clampNight(FALLBACK_NIGHT, 0), 0, "fallback");
    const j = listJobs(db, 1).find((x) => x.id === ids[1])!;
    const s = (): Settlement => ({ pay_c: 200, extra_c: 0, trust_delta: 0, caught: false, status: "done", facts: [] });
    setNightDice(() => 0);
    const a = s();
    settleNight(db, j, a);
    expect(a.pay_c).toBe(0);
    const rolls = [0.5, 0.05];
    setNightDice(() => rolls.shift() ?? 0.9);
    const b = s();
    settleNight(db, j, b);
    expect(b.pay_c).toBe(100);
    setNightDice(() => 0.9);
    const c = s();
    settleNight(db, j, c);
    expect(c.pay_c).toBe(200);
    expect(c.trust_delta).toBe(1);
  });
});

describe("M7 night: the quest box", () => {
  it("the work done while the employer is abed: the facts held, then paid from the box at once; he remembers it", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 21, 30);
    const { id } = devJob(db, { type: "carry", employer: "sooi" });
    takeJob(db, id);
    const count = (listJobs(db, 1).find((j) => j.id === id)!.task as { count: number }).count;
    const before = player(db).money_c;
    holdJob(db, id, ReportSchema.parse({ delivered: count }), 0);
    expect(status(db, id)).toBe("taken");
    expect(player(db).money_c).toBe(before); // nothing paid yet
    // the date may turn before he gets to the box: the job is his still
    passTime(db, 3 * 60);
    const r = finishJob(db, id, ReportSchema.parse({ box: true }), () => 0.99);
    expect(r.settlement.status).toBe("done");
    expect(r.settlement.pay_c).toBeGreaterThan(0);
    expect(player(db).money_c).toBe(before + r.settlement.pay_c);
    expect(r.settlement.facts.join(" ")).toMatch(/abed.*box/);
    expect(topMemories(db, "sooi").some((m) => /box/.test(m.text))).toBe(true);
  });

  it("by day, into his hand: the held facts, no box", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 21, 30);
    const { id } = devJob(db, { type: "watch", employer: "katoen" });
    takeJob(db, id);
    holdJob(db, id, ReportSchema.parse({ left_post_s: 0 }), 0);
    setClock(db, 2, 9, 0);
    const r = finishJob(db, id, ReportSchema.parse({}), () => 0.99);
    expect(r.settlement.status).toBe("done");
    expect(r.settlement.facts.join(" ")).not.toMatch(/box/);
  });

  it("night work is paid by the man who gave it, never through a box", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 22);
    const ids = insertNightJobs(db, clampNight(FALLBACK_NIGHT, 0), 0, "fallback");
    takeJob(db, ids[0]);
    expect(() => holdJob(db, ids[0], ReportSchema.parse({ delivered: 1 }), 0)).toThrow(/man who gave it/);
  });
});

describe("M7 night: gangs", () => {
  const police = (db: Db) => town(db).town.residents.find((r) => r.trade === "police")!;

  it("the chance: alone in a dark street, less by a lamp, far less with an agent near, more with goods", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 23);
    syncFromClient({ x: 0, z: 20, people: [] }, Date.now(), db);
    const alone = gangChancePerHour(db, { lit: false, quay: false, carrying: false });
    expect(alone).toBeCloseTo(GANG_BASE_PER_HOUR * GANG_MULT.alone, 5);
    expect(gangChancePerHour(db, { lit: true, quay: false, carrying: false })).toBeCloseTo(alone * GANG_MULT.lit, 5);
    expect(gangChancePerHour(db, { lit: false, quay: true, carrying: true })).toBeCloseTo(alone * GANG_MULT.quay * GANG_MULT.carrying, 5);
    const p = police(db);
    syncFromClient({ x: 0, z: 20, people: [{ id: p.id, x: 5, z: 20 }] }, Date.now(), db);
    expect(gangChancePerHour(db, { lit: false, quay: false, carrying: false })).toBeLessThan(alone * 0.2);
  });

  it("only at night, at most two a night an hour apart; the dice decide", () => {
    const db = openDb(":memory:");
    setGangDice(() => 0);
    setClock(db, 1, 12);
    expect(rollGang(db, { x: 0, z: 20 }, 1e6)).toBeNull();
    setClock(db, 1, 23);
    const g = rollGang(db, { x: 0, z: 20 }, 2e6)!;
    expect(g).toBeTruthy();
    expect(g.demand_c).toBeGreaterThanOrEqual(20);
    expect(rollGang(db, { x: 0, z: 20 }, 3e6)?.id).toBe(g.id); // the same gang, still there
    resolveGang(db, g.id, "pay");
    expect(rollGang(db, { x: 0, z: 20 }, 4e6)).toBeNull(); // an hour apart
    setClock(db, 2, 0, 30);
    expect(rollGang(db, { x: 0, z: 20 }, 5e6)).toBeTruthy();
    clearGangs(db);
  });

  it("each answer: pay, run, fight, shout, stand; the engine's numbers, health never below 1", () => {
    const db = openDb(":memory:");
    const fresh = (money: number) => {
      clearGangs(db);
      resetGangRoll();
      set(db, `money_c = ${money}, health = 8, sleep = 8`);
      setClock(db, 1, 23);
      setGangDice(() => 0);
      return rollGang(db, { x: 0, z: 20 }, Date.now(), true)!;
    };
    let g = fresh(200);
    expect(resolveGang(db, g.id, "pay")).toMatchObject({ outcome: "paid", money_c: g.demand_c });
    expect(player(db).money_c).toBe(200 - g.demand_c);
    g = fresh(10);
    const poor = resolveGang(db, g.id, "pay");
    expect(poor.outcome).toBe("robbed");
    expect(player(db).money_c).toBe(0);
    g = fresh(100);
    expect(resolveGang(db, g.id, "run").outcome).toBe("escaped");
    g = fresh(100);
    setGangDice(() => 0.99);
    const caught = resolveGang(db, g.id, "run");
    expect(caught.outcome).toBe("robbed");
    expect(caught.money_c).toBe(70);
    expect(player(db).health).toBe(7);
    g = fresh(100);
    const fought = resolveGang(db, g.id, "fight");
    expect(fought).toMatchObject({ outcome: "fought_off", health_lost: 1, money_c: 0 });
    g = fresh(100);
    setGangDice(() => 0.99);
    expect(resolveGang(db, g.id, "shout").outcome).toBe("robbed");
    g = fresh(100);
    expect(resolveGang(db, g.id, "stand").outcome).toBe("robbed");
    set(db, "health = 1");
    g = fresh(100);
    set(db, "health = 1");
    setGangDice(() => 0.99);
    resolveGang(db, g.id, "fight");
    expect(player(db).health).toBe(1);
    expect(() => resolveGang(db, g.id, "run")).toThrow(/nobody/);
  });

  it("a job's parcel in the pocket goes with a robbery, and the job is lost", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 23);
    const { id } = devJob(db, { type: "deliver", employer: "peeters" });
    takeJob(db, id);
    db.prepare("INSERT INTO item (kind, job_id) VALUES ('parcel', ?)").run(id);
    setGangDice(() => 0);
    const g = rollGang(db, { x: 0, z: 20 }, Date.now(), true)!;
    const r = resolveGang(db, g.id, "stand");
    expect(r.job_failed).toBe(id);
    expect(status(db, id)).toBe("failed");
    expect(db.prepare("SELECT COUNT(*) n FROM item WHERE job_id = ?").get(id)).toEqual({ n: 0 });
  });

  it("asleep rough at night a gang may go through his coat; never in a bed", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 200");
    setGangDice(() => 0);
    expect(robbedAsleep(db, { where: "bed", collapsed: false, hour: 23 })).toBeNull();
    const r = robbedAsleep(db, { where: "rough", collapsed: false, hour: 23 })!;
    expect(r.robbed?.money_c).toBe(120);
    expect(player(db).money_c).toBe(80);
    setGangDice(() => 0.99);
    expect(robbedAsleep(db, { where: "rough", collapsed: true, hour: 23 })).toBeNull();
    // through sleep(): the loss is on the night sheet
    set(db, "money_c = 100, hour = 23, minute = 0");
    setGangDice(() => 0);
    const n = sleep(db, "rough");
    expect(n.robbed?.money_c).toBe(60);
    expect(n.summary.join(" ")).toMatch(/hands go through your coat/);
  });
});

describe("M7 night: the director's night", () => {
  it("room for an event at night, none from 5:00 to 6:00", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 23);
    expect(roomForEvent(db)).toBe(true);
    setClock(db, 1, 5, 30);
    expect(roomForEvent(db)).toBe(false);
  });

  it("at night only night events, small, over by 5:00", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 23);
    const wedding = planEvent(db, { ...planFromTemplate(templateById("wedding")!, "claude"), start_in_min: 5 });
    expect(wedding.ok).toBe(false);
    const burg = planEvent(db, planFromTemplate(templateById("burglary")!, "engine"));
    expect(burg.ok).toBe(true);
    const brawl = planEvent(db, { ...planFromTemplate(templateById("tavern_brawl")!, "claude"), stages: templateById("tavern_brawl")!.stages.map((s) => (s.op === "gather" && s.role === "crowd" ? { ...s, count: 60 } : s)) });
    expect(brawl.ok).toBe(true);
    if (brawl.ok) {
      const stages = JSON.parse((db.prepare("SELECT stages_json FROM town_event WHERE id = ?").get(brawl.event.id) as { stages_json: string }).stages_json) as Array<{ op: string; role: string; count: number }>;
      for (const s of stages) if (s.op === "gather" && s.role !== "police") expect(s.count).toBeLessThanOrEqual(NIGHT_GATHER_MAX);
    }
    setClock(db, 2, 4, 30);
    const late = planEvent(db, planFromTemplate(templateById("night_watch")!, "engine"));
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.why).toMatch(/5:00/);
  });
});

describe("M7 night: the cell", () => {
  it("held until the next dawn, whatever the hour; the date turns on the way", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 14);
    const n = cellNight(db, 0);
    expect(clock(db)).toMatchObject({ day: 2, hour: 6, minute: 0 });
    expect(n.turned).toBe(true);
    setClock(db, 2, 3);
    cellNight(db, 0);
    expect(clock(db)).toMatchObject({ day: 2, hour: 6, minute: 0 });
  });
});
