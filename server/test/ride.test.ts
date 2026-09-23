import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { applyHour, resetTickLimit, sleep, tick } from "../src/day.ts";
import { player } from "../src/game.ts";
import { alight, board, calls, change, isLine, isStop, ride, RIDE_FARE_C, RIDE_LINES, RIDE_MAX_HOURS, ridePlace, riding, seat } from "../src/ride.ts";

type DB = ReturnType<typeof openDb>;
const set = (db: DB, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();
const money = (db: DB) => player(db).money_c;

beforeEach(() => resetTickLimit());

describe("the omnibus fare", () => {
  it("boarding costs the fare, once; getting off is free", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 20");
    const r = board(db, "werf", "kaaien");
    expect(r).toMatchObject({ fare_c: RIDE_FARE_C, change: false });
    expect(money(db)).toBe(20 - RIDE_FARE_C);
    expect(riding(db)).toBe(true);
    expect(ride(db)).toMatchObject({ line: "kaaien", from: "werf" });
    expect(() => board(db, "vismarkt", "kaaien")).toThrow(/already/); // no second fare, no double ride
    expect(money(db)).toBe(20 - RIDE_FARE_C);
    alight(db);
    expect(riding(db)).toBe(false);
    expect(money(db)).toBe(20 - RIDE_FARE_C); // nothing back
    expect(alight(db).text).toBe(""); // getting off twice does nothing
  });

  it("no money, no ride; money never goes below 0", () => {
    const db = openDb(":memory:");
    set(db, `money_c = ${RIDE_FARE_C - 1}`);
    expect(() => board(db, "werf", "kaaien")).toThrow(/not enough money/);
    expect(money(db)).toBe(RIDE_FARE_C - 1);
    expect(riding(db)).toBe(false);
  });

  it("only real stops and lines count, and the line must call there (the client's word is data)", () => {
    expect(isStop("werf")).toBe(true);
    expect(isStop("cathedral")).toBe(true);
    for (const bad of ["", "Werf", "werf; DROP TABLE player", 3, null, undefined, { stop: "werf" }, "__proto__", "constructor"]) {
      expect(isStop(bad)).toBe(false);
      expect(isLine(bad)).toBe(false);
    }
    expect(isLine("kaaien")).toBe(true);
    expect(isLine("markt")).toBe(true);
    expect(calls("markt", "vismarkt")).toBe(true);
    expect(calls("kaaien", "vismarkt")).toBe(true);
    expect(calls("kaaien", "cathedral")).toBe(false);
    const db = openDb(":memory:");
    set(db, "money_c = 50");
    expect(() => board(db, "cathedral", "kaaien")).toThrow(/does not call/);
    expect(money(db)).toBe(50);
  });

  it("the lines meet at the Vismarkt", () => {
    const shared = RIDE_LINES.kaaien.filter((s) => (RIDE_LINES.markt as readonly string[]).includes(s));
    expect(shared).toEqual(["vismarkt"]);
  });

  it("one free change onto the other line; the same line again, or a second change, is a new fare", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 8, minute = 0");
    board(db, "werf", "kaaien");
    set(db, "hour = 11");
    alight(db);
    expect(change(db)).toEqual({ from_line: "kaaien" });
    const c = board(db, "vismarkt", "markt");
    expect(c).toMatchObject({ fare_c: 0, change: true });
    expect(money(db)).toBe(50 - RIDE_FARE_C);
    expect(ride(db)).toMatchObject({ line: "markt", from: "vismarkt" });
    // the ticket's clock runs from the fare, not from the change
    expect(ride(db)?.minutes).toBe(3 * 60);
    alight(db);
    expect(change(db)).toBeNull(); // the one change is used
    board(db, "vismarkt", "kaaien");
    expect(money(db)).toBe(50 - 2 * RIDE_FARE_C);
    alight(db);
    // getting back on the same line is not a change
    board(db, "rijnkaai", "kaaien");
    expect(money(db)).toBe(50 - 3 * RIDE_FARE_C);
  });

  it("a ticket runs out after RIDE_MAX_HOURS game hours: no more riding, no more free change", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 6, minute = 0");
    board(db, "werf", "kaaien");
    set(db, `hour = ${6 + RIDE_MAX_HOURS - 1}`);
    expect(riding(db)).toBe(true);
    expect(ride(db)?.left).toBe(60);
    set(db, `hour = ${6 + RIDE_MAX_HOURS}, minute = 15`);
    expect(riding(db)).toBe(false);
    alight(db);
    expect(change(db)).toBeNull();
    // a spent ticket does not block a new fare, and a change after it costs
    board(db, "vismarkt", "markt");
    expect(money(db)).toBe(50 - 2 * RIDE_FARE_C);
  });

  it("the night ends the ride and the ticket", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 23, minute = 0");
    board(db, "rijnkaai", "kaaien");
    sleep(db, "rough");
    expect(riding(db)).toBe(false);
    expect(change(db)).toBeNull();
  });
});

describe("riding and the needs (engine numbers)", () => {
  it("on board the chill comes at half the rate: every 10 h by day instead of every 5 h", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, warmth = 6, food = 6, sleep = 6");
    board(db, "werf", "kaaien");
    applyHour(db, 15); // on foot: -1 warmth (15 % 5); on board: nothing
    expect(player(db).warmth).toBe(6);
    applyHour(db, 10); // 10 % 10: the chill gets in even on board
    expect(player(db).warmth).toBe(5);
    alight(db);
    applyHour(db, 15);
    expect(player(db).warmth).toBe(4);
  });

  it("the town line keeps you warm the same way, a change included", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, warmth = 6");
    board(db, "werf", "kaaien");
    alight(db);
    board(db, "vismarkt", "markt");
    applyHour(db, 15);
    expect(player(db).warmth).toBe(6);
  });

  it("on the roof seat: every 7 h by day and every 4 h at night, between inside and on foot", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, warmth = 8");
    board(db, "werf", "kaaien");
    expect(ridePlace(db)).toBe("inside");
    seat(db, "roof");
    expect(ridePlace(db)).toBe("roof");
    applyHour(db, 10); // inside nothing would happen at 10 % 10... on the roof: 10 % 7, nothing either
    expect(player(db).warmth).toBe(8);
    applyHour(db, 14); // 14 % 7: the wind gets in
    expect(player(db).warmth).toBe(7);
    applyHour(db, 21); // night: 21 % 4 no (on foot 21 % 3 yes)
    expect(player(db).warmth).toBe(7);
    applyHour(db, 0);
    expect(player(db).warmth).toBe(6);
    seat(db, "inside");
    applyHour(db, 14); // back inside: 14 % 10 no
    expect(player(db).warmth).toBe(6);
  });

  it("the roof needs a ride; getting off brings you down; the fare is the same", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50");
    expect(() => seat(db, "roof")).toThrow(/not on an omnibus/);
    board(db, "werf", "kaaien");
    seat(db, "roof");
    expect(player(db).money_c).toBe(50 - RIDE_FARE_C);
    alight(db);
    expect(ridePlace(db)).toBeNull();
    board(db, "vismarkt", "markt"); // the change
    expect(ridePlace(db)).toBe("inside");
  });

  it("at night on board: every 6 h instead of every 3 h", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, warmth = 6");
    board(db, "werf", "kaaien");
    applyHour(db, 21); // 21 % 3 on foot, not 21 % 6
    applyHour(db, 3);
    expect(player(db).warmth).toBe(6);
    applyHour(db, 0);
    expect(player(db).warmth).toBe(5);
  });

  it("food falls the same on board as on foot, and warmth stays clamped at 0", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, food = 1, warmth = 0");
    board(db, "werf", "kaaien");
    applyHour(db, 12);
    expect(player(db)).toMatchObject({ food: 0, warmth: 0 });
    applyHour(db, 20);
    applyHour(db, 0);
    expect(player(db).warmth).toBe(0);
  });

  it("riding does not touch the clock: a tick is 15 minutes, on board or not", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, hour = 9, minute = 0");
    board(db, "werf", "kaaien");
    tick(db, 10_000);
    const p = db.prepare("SELECT hour, minute FROM player WHERE id = 1").get() as { hour: number; minute: number };
    expect(p).toEqual({ hour: 9, minute: 15 });
  });
});
