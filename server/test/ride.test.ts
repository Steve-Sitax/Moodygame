import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { applyHour, resetTickLimit, sleep, tick } from "../src/day.ts";
import { player } from "../src/game.ts";
import { alight, board, isStop, ride, RIDE_FARE_C, RIDE_MAX_HOURS, riding } from "../src/ride.ts";

type DB = ReturnType<typeof openDb>;
const set = (db: DB, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();

beforeEach(() => resetTickLimit());

describe("the omnibus fare", () => {
  it("boarding costs the fare, once; getting off is free", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 20");
    const r = board(db, "werf");
    expect(r.fare_c).toBe(RIDE_FARE_C);
    expect(player(db).money_c).toBe(20 - RIDE_FARE_C);
    expect(riding(db)).toBe(true);
    expect(() => board(db, "vismarkt")).toThrow(/already/); // no second fare, no double ride
    expect(player(db).money_c).toBe(20 - RIDE_FARE_C);
    alight(db);
    expect(riding(db)).toBe(false);
    expect(player(db).money_c).toBe(20 - RIDE_FARE_C); // nothing back
    expect(alight(db).text).toBe(""); // getting off twice does nothing
  });

  it("no money, no ride; money never goes below 0", () => {
    const db = openDb(":memory:");
    set(db, `money_c = ${RIDE_FARE_C - 1}`);
    expect(() => board(db, "werf")).toThrow(/not enough money/);
    expect(player(db).money_c).toBe(RIDE_FARE_C - 1);
    expect(riding(db)).toBe(false);
  });

  it("only real stops count (the client's word is data, not orders)", () => {
    expect(isStop("werf")).toBe(true);
    expect(isStop("bassin")).toBe(true);
    for (const bad of ["", "Werf", "werf; DROP TABLE player", 3, null, undefined, { stop: "werf" }]) expect(isStop(bad)).toBe(false);
  });

  it("a ticket runs out after RIDE_MAX_HOURS game hours", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 6, minute = 0");
    board(db, "werf");
    set(db, `hour = ${6 + RIDE_MAX_HOURS - 1}`);
    expect(riding(db)).toBe(true);
    expect(ride(db)?.left).toBe(60);
    set(db, `hour = ${6 + RIDE_MAX_HOURS}, minute = 15`);
    expect(riding(db)).toBe(false);
    // a spent ticket does not block a new fare
    board(db, "vismarkt");
    expect(player(db).money_c).toBe(50 - 2 * RIDE_FARE_C);
  });

  it("the night ends the ride", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 23, minute = 0");
    board(db, "rijnkaai");
    sleep(db, "rough");
    expect(riding(db)).toBe(false);
  });
});

describe("riding and the needs (engine numbers)", () => {
  it("on board the chill comes at half the rate: every 10 h by day instead of every 5 h", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, warmth = 6, food = 6, sleep = 6");
    board(db, "werf");
    applyHour(db, 15); // on foot: -1 warmth (15 % 5); on board: nothing
    expect(player(db).warmth).toBe(6);
    applyHour(db, 10); // 10 % 10: the chill gets in even on board
    expect(player(db).warmth).toBe(5);
    alight(db);
    applyHour(db, 15);
    expect(player(db).warmth).toBe(4);
  });

  it("at night on board: every 6 h instead of every 3 h", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, warmth = 6");
    board(db, "werf");
    applyHour(db, 21); // 21 % 3 on foot, not 21 % 6
    applyHour(db, 3);
    expect(player(db).warmth).toBe(6);
    applyHour(db, 0);
    expect(player(db).warmth).toBe(5);
  });

  it("food falls the same on board as on foot, and warmth stays clamped at 0", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, food = 1, warmth = 0");
    board(db, "werf");
    applyHour(db, 12);
    expect(player(db)).toMatchObject({ food: 0, warmth: 0 });
    applyHour(db, 20);
    applyHour(db, 0);
    expect(player(db).warmth).toBe(0);
  });

  it("riding does not touch the clock: a tick is 15 minutes, on board or not", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 9, minute = 0");
    board(db, "werf");
    tick(db, 10_000);
    const p = db.prepare("SELECT hour, minute FROM player WHERE id = 1").get() as { hour: number; minute: number };
    expect(p).toEqual({ hour: 9, minute: 15 });
  });
});
