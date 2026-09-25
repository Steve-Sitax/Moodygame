import { beforeEach, describe, expect, it } from "vitest";
import { openDb, resetDb } from "../src/db.ts";
import { applyHour, clock, consolidate, ending, payRent, RENT_C, rentPaid, resetTickLimit, sleep, tick } from "../src/day.ts";
import { player } from "../src/game.ts";
import { listJobs } from "../src/hooks/jobBoard.ts";
import { remember, topMemories } from "../src/npcs.ts";
import { fallbackEpilogue, writeEpilogue } from "../src/hooks/epilogue.ts";

type DB = ReturnType<typeof openDb>;
const set = (db: DB, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();

beforeEach(() => resetTickLimit());

describe("the clock", () => {
  it("a tick moves 5 minutes, and at most one tick per 9 s counts (M7 clock: a game hour is 2 real minutes)", () => {
    const db = openDb(":memory:");
    expect(tick(db, 10_000).advanced).toBe(true);
    expect(clock(db)).toMatchObject({ day: 1, hour: 6, minute: 5, weekday: "Monday" });
    expect(tick(db, 15_000).advanced).toBe(false); // too soon: a fast client gains nothing
    expect(clock(db).minute).toBe(5);
    tick(db, 20_000);
    expect(clock(db).minute).toBe(10);
  });

  it("the hour turns over and needs fall", () => {
    const db = openDb(":memory:");
    set(db, "hour = 11, minute = 55, food = 6, sleep = 7, warmth = 5");
    tick(db, 10_000); // 12:00: food -1 (12 % 6), sleep -1 (12 % 3), warmth stays (day, 12 % 5)
    expect(clock(db)).toMatchObject({ hour: 12, minute: 0 });
    expect(player(db)).toMatchObject({ food: 5, sleep: 6, warmth: 5 });
  });

  it("health falls while a need is at 0, and heals slowly while all are fine", () => {
    const db = openDb(":memory:");
    set(db, "food = 0, warmth = 5, sleep = 5, health = 5");
    applyHour(db, 10);
    expect(player(db).health).toBe(5); // hungry, but health goes only every 3 h
    applyHour(db, 9);
    expect(player(db).health).toBe(4);
    set(db, "food = 8, warmth = 8, sleep = 8, health = 5");
    applyHour(db, 12);
    expect(player(db).health).toBe(6);
  });

  it("health 0 ends the week early", () => {
    const db = openDb(":memory:");
    set(db, "hour = 8, minute = 55, food = 0, health = 1");
    const r = tick(db, 10_000);
    expect(r.ended?.kind).toBe("health");
    expect(ending(db)?.kind).toBe("health");
    expect(tick(db, 20_000).advanced).toBe(false); // the clock stops
  });

  it("M7 night: midnight turns the date while Jef is up; nobody is sent to bed", () => {
    const db = openDb(":memory:");
    set(db, "hour = 23, minute = 55, food = 6, warmth = 6, health = 8, sleep = 3");
    const r = tick(db, 10_000);
    expect(r.night).toBeUndefined();
    expect(r.turned?.day).toBe(2);
    expect(clock(db)).toMatchObject({ day: 2, hour: 0, minute: 0, weekday: "Tuesday" });
    expect(player(db)).toMatchObject({ sleep: 2, health: 8 }); // 0:00: sleep -1 (0 % 3), no night's rest
    // the clock runs on through the night
    tick(db, 20_000);
    expect(clock(db)).toMatchObject({ day: 2, hour: 0, minute: 5 });
  });

  it("M7 night: dead tired (sleep 0), Jef drops where he stands and sleeps 8 hours", () => {
    const db = openDb(":memory:");
    set(db, "hour = 2, minute = 55, food = 6, warmth = 6, health = 8, sleep = 1");
    const r = tick(db, 10_000); // 3:00: sleep -1 (3 % 3) -> 0
    expect(r.night?.where).toBe("rough");
    expect(r.night?.collapsed).toBe(true);
    expect(r.night?.slept_min).toBe(480);
    expect(clock(db)).toMatchObject({ day: 1, hour: 11, minute: 0 });
    expect(player(db).sleep).toBe(6);
  });

  it("M7 night: the week ends when day 8 would begin, at Sunday's midnight", () => {
    const db = openDb(":memory:");
    set(db, "day = 7, hour = 23, minute = 55, sleep = 8");
    const r = tick(db, 10_000);
    expect(r.ended?.kind).toBe("week");
    expect(ending(db)?.kind).toBe("week");
    expect(clock(db).day).toBe(7);
  });
});

describe("the night", () => {
  it("a bed restores sleep and warmth; M7 night: seven to eight hours from when he lies down, the date turning on the way", () => {
    const db = openDb(":memory:");
    set(db, "hour = 20, food = 6, warmth = 4, sleep = 2, health = 7");
    const r = sleep(db, "bed");
    expect(r.where).toBe("bed");
    expect(player(db)).toMatchObject({ sleep: 10, warmth: 7, food: 4, health: 8 });
    expect(r.slept_min).toBe(470); // sleep 2: 7 h 48, in fives
    expect(r.turned).toBe(true);
    expect(r.wake).toMatchObject({ day: 2, hour: 3, minute: 50, weekday: "Tuesday" });
    expect(clock(db)).toMatchObject({ day: 2, hour: 3, minute: 50 });
    expect(r.summary.join(" ")).toMatch(/You lie down at 20:00.*You wake at 3:50, Tuesday/);
  });

  it("M7 night: a sleep by day does not turn the date", () => {
    const db = openDb(":memory:");
    set(db, "hour = 9, sleep = 10");
    const r = sleep(db, "bed");
    expect(r).toMatchObject({ slept_min: 420, turned: false, day: 1 });
    expect(clock(db)).toMatchObject({ day: 1, hour: 16, minute: 0 });
  });

  it("M7 night: a job in hand stays in hand through the nights (only its own deadline counts)", () => {
    const db = openDb(":memory:");
    set(db, "hour = 20");
    db.prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, pitch, task_json, source, status) VALUES (1, 'A parcel', 'peeters', 'rijnkaai', 'deliver', 40, 1, 1, 'x', '{}', 'test', 'taken')").run();
    const id = (db.prepare("SELECT id FROM job").get() as { id: number }).id;
    db.prepare("INSERT INTO item (kind, job_id) VALUES ('parcel', ?)").run(id);
    const first = sleep(db, "bed");
    set(db, "hour = 21, minute = 0");
    sleep(db, "bed");
    expect(clock(db).day).toBe(3);
    expect((db.prepare("SELECT status FROM job WHERE id = ?").get(id) as { status: string }).status).toBe("taken");
    expect(db.prepare("SELECT COUNT(*) n FROM item").get()).toEqual({ n: 1 });
    expect(first.summary.join(" ")).not.toMatch(/undone|waits for you/);
    expect(listJobs(db, player(db).day).some((j) => j.id === id && j.status === "taken")).toBe(true);
  });

  it("Sunday: no rent, no bed", () => {
    const db = openDb(":memory:");
    set(db, "day = 7, hour = 20");
    const r = sleep(db, "bed");
    expect(r.turnedAway).toBe(true);
    expect(r.where).toBe("rough");
    expect(r.ended?.kind).toBe("week");
  });

  it("rent: refused when short, paid once, then the Sunday bed is yours", () => {
    const db = openDb(":memory:");
    expect(payRent(db).paid).toBe(false); // 50 c is not enough
    set(db, `money_c = ${RENT_C + 20}`);
    expect(payRent(db).paid).toBe(true);
    expect(player(db).money_c).toBe(20);
    expect(payRent(db).paid).toBe(false); // not twice
    expect(rentPaid(db)).toBe(true);
    set(db, "day = 7, hour = 20");
    expect(sleep(db, "bed")).toMatchObject({ where: "bed", turnedAway: false });
  });

  it("memories fade at night and old small ones are gone", () => {
    const db = openDb(":memory:");
    remember(db, "sooi", "Jef carried the coffee well.", 5);
    remember(db, "sooi", "Jef nodded once.", 1);
    set(db, "day = 4");
    consolidate(db);
    const m = topMemories(db, "sooi").map((x) => [x.text, x.weight]);
    expect(m).toEqual([["Jef carried the coffee well.", 4]]);
  });

  it("new game wipes the week", () => {
    const db = openDb(":memory:");
    set(db, "day = 5, money_c = 300");
    sleep(db, "rough");
    resetDb(db);
    expect(clock(db)).toMatchObject({ day: 1, hour: 6, minute: 0 });
    expect(player(db).money_c).toBe(50);
    expect(ending(db)).toBeNull();
  });
});

describe("epilogue", () => {
  it("falls back to a fixed text when the model fails", async () => {
    const db = openDb(":memory:");
    const r = await writeEpilogue(db, { kind: "health", day: 3 }, async () => {
      throw new Error("offline");
    });
    expect(r.source).toBe("fallback");
    expect(r.epilogue).toEqual(fallbackEpilogue({ kind: "health", day: 3 }));
  });

  it("takes a schema-valid model answer", async () => {
    const db = openDb(":memory:");
    const good = { title: "Seven days of fog", paragraphs: ["x".repeat(60), "y".repeat(60)] };
    const r = await writeEpilogue(db, { kind: "week", day: 7 }, async () => ({ output: good }));
    expect(r.source).toBe("claude");
    expect(r.epilogue).toEqual(good);
  });
});

describe("weather", () => {
  it("Monday is fog; each new morning rolls fog, mist, clear or rain", async () => {
    const { clock: c, rollWeather, weather } = await import("../src/day.ts");
    const db = openDb(":memory:");
    expect(c(db).weather).toBe("fog");
    expect(rollWeather(db, 0.1)).toBe("fog");
    expect(rollWeather(db, 0.5)).toBe("mist");
    expect(rollWeather(db, 0.75)).toBe("clear");
    expect(rollWeather(db, 0.9)).toBe("rain");
    expect(weather(db)).toBe("rain");
    expect(rollWeather(db, 0.97)).toBe("storm");
    expect(weather(db)).toBe("storm");
    sleep(db, "bed");
    expect(["fog", "mist", "clear", "rain", "storm"]).toContain(weather(db));
  });
});

describe("a dip in the Schelde", () => {
  it("costs 1 warmth once per swim, clamped at 0", async () => {
    const { swim, SWIM_EVERY_MS } = await import("../src/day.ts");
    const db = openDb(":memory:");
    set(db, "warmth = 1");
    expect(swim(db, 100_000).cold).toBe(true);
    expect(player(db).warmth).toBe(0);
    expect(swim(db, 100_000 + 1_000).cold).toBe(false); // the same swim: nothing more
    set(db, "warmth = 0");
    expect(swim(db, 100_000 + SWIM_EVERY_MS).cold).toBe(true);
    expect(player(db).warmth).toBe(0); // never below 0
  });
});
