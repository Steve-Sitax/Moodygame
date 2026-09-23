import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { applyHour, resetTickLimit, setWeather, sleep } from "../src/day.ts";
import { player } from "../src/game.ts";
import { resident } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { deedRow, returnThing, takeThing, THINGS } from "../src/town/deeds.ts";
import { decide, policeState } from "../src/town/police.ts";
import { loseStolen, rowDebtToPolice } from "../src/town/rowDeeds.ts";
import {
  berthOf,
  boardHired,
  hireBoat,
  isLanding,
  LANDINGS,
  lateFee,
  leaveBoat,
  loseHired,
  lostFee,
  resetRowClock,
  ROW_DEBT_MAX_C,
  ROW_EFFORT_PER_FOOD,
  ROW_FETCH_MIN,
  ROW_HIRE_C,
  ROW_HIRE_HOURS,
  ROW_LATE_C,
  ROW_LATE_MAX_C,
  ROW_LEFT_FINE_C,
  ROW_LOST_MAX_C,
  ROW_LOST_MIN_C,
  rowBoats,
  rowBoatStates,
  rowEffort,
  rowing,
  rowState,
  rowTick,
  rowWorld,
  waterman,
} from "../src/rowing.ts";

type DB = ReturnType<typeof openDb>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const set = (db: DB, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();
const money = (db: DB) => player(db).money_c;
const at = (id: "rijnkaai" | "vismarkt" | "bassin") => berthOf(LANDINGS[id].flight).landing;
const berth = (id: "rijnkaai" | "vismarkt" | "bassin") => berthOf(LANDINGS[id].flight);
const never = () => 0.999;
const always = () => 0;

function fresh(hour = 10, cash = 100): DB {
  const db = openDb(":memory:");
  setClock(db, 1, hour);
  set(db, `money_c = ${cash}, food = 6, warmth = 6, sleep = 6, health = 6`);
  setWeather(db, "fog");
  return db;
}
function hire(db: DB, id: "rijnkaai" | "vismarkt" | "bassin" = "rijnkaai") {
  const [x, z] = at(id);
  return hireBoat(db, id, x, z);
}

beforeEach(() => {
  resetTickLimit();
  resetRowClock();
});

describe("the hire landings and the boats", () => {
  it("three hire landings, each with a waterman; the flights are reachable on foot", () => {
    const db = fresh();
    for (const id of ["rijnkaai", "vismarkt", "bassin"] as const) {
      expect(waterman(db, id)).toBeTruthy();
      expect(resident(db, waterman(db, id)!)!.trade).toBe("boatman");
      const f = LANDINGS[id].flight;
      // open ground on the quay within a few metres of the top of the flight
      expect(walkMap().nearestOpen(f.top[0] - f.n[0] * 1.5, f.top[1] - f.n[1] * 1.5, 4)).not.toBeNull();
    }
    for (const b of rowBoats(db)) {
      expect(["boatman", "sailor", "docker", "natie", "porter"]).toContain(resident(db, b.owner)!.trade);
      expect(["rowboat", "punt"]).toContain(b.kind);
    }
    expect(rowBoats(db).length).toBe(3);
    // owners and watermen are different men
    const all = [...rowBoats(db).map((b) => b.owner), waterman(db, "rijnkaai"), waterman(db, "vismarkt"), waterman(db, "bassin")];
    expect(new Set(all).size).toBe(all.length);
  });

  it("only real landings count (the client's word is data)", () => {
    const db = fresh();
    for (const bad of ["", "Werf", "werf", "werf; DROP TABLE player", 3, null, undefined, { id: "werf" }, "__proto__", "constructor"]) {
      expect(isLanding(bad)).toBe(false);
      expect(() => hireBoat(db, bad, 0, 0)).toThrow(/no such landing/);
    }
    expect(money(db)).toBe(100);
  });
});

describe("hiring and returning", () => {
  it("the hire costs ROW_HIRE_C once; Jef must stand by the boat; one boat at a time", () => {
    const db = fresh();
    expect(() => hireBoat(db, "rijnkaai", 0, 0)).toThrow(/too far/);
    expect(() => hireBoat(db, "rijnkaai", NaN, 0)).toThrow(/too far/);
    const r = hire(db);
    expect(r).toMatchObject({ fee_c: ROW_HIRE_C, kind: "rowboat" });
    expect(money(db)).toBe(100 - ROW_HIRE_C);
    expect(rowing(db)).toBe(true);
    expect(() => hire(db, "vismarkt")).toThrow(/already/);
    expect(money(db)).toBe(100 - ROW_HIRE_C);
  });

  it("no money, no boat; never in a gale (the server decides)", () => {
    const db = fresh(10, ROW_HIRE_C - 1);
    expect(() => hire(db)).toThrow(/not enough money/);
    expect(money(db)).toBe(ROW_HIRE_C - 1);
    set(db, "money_c = 50");
    setWeather(db, "storm");
    expect(() => hire(db)).toThrow(/gale/);
    expect(money(db)).toBe(50);
    expect(rowWorld(db).storm).toBe(true);
    setWeather(db, "rain");
    expect(() => hire(db)).not.toThrow();
  });

  it("back at any hire landing within the hours: nothing more to pay", () => {
    const db = fresh();
    hire(db, "rijnkaai");
    setClock(db, 1, 10 + ROW_HIRE_HOURS);
    const b = berth("bassin");
    const r = leaveBoat(db, b.x + 1, b.z, 0);
    expect(r).toMatchObject({ returned: true, late_c: 0, paid_c: 0, owed_c: 0 });
    expect(money(db)).toBe(100 - ROW_HIRE_C);
    expect(rowState(db).hire).toBeNull();
    expect(rowing(db)).toBe(false);
  });

  it("late: ROW_LATE_C a game hour or part of one, never more than ROW_LATE_MAX_C", () => {
    const h = { landing: "rijnkaai" as const, kind: "rowboat" as const, since: 0, left: null };
    expect(lateFee(h, ROW_HIRE_HOURS * 60)).toBe(0);
    expect(lateFee(h, ROW_HIRE_HOURS * 60 + 1)).toBe(ROW_LATE_C);
    expect(lateFee(h, ROW_HIRE_HOURS * 60 + 61)).toBe(2 * ROW_LATE_C);
    expect(lateFee(h, 100 * 60)).toBe(ROW_LATE_MAX_C);
    const db = fresh();
    hire(db);
    setClock(db, 1, 10 + ROW_HIRE_HOURS + 2, 30);
    const b = berth("rijnkaai");
    const r = leaveBoat(db, b.x, b.z, 0);
    expect(r.late_c).toBe(3 * ROW_LATE_C);
    expect(money(db)).toBe(100 - ROW_HIRE_C - 3 * ROW_LATE_C);
  });

  it("left anywhere else: nothing at once; an hour later the boy fetches it and Jef pays the fine (clamped to his money, the rest owed)", () => {
    const db = fresh(10, 20);
    hire(db); // 10 left
    leaveBoat(db, -200, -30, 1);
    expect(rowing(db)).toBe(false);
    expect(rowState(db).hire?.left).toMatchObject({ x: -200, z: -30 });
    setClock(db, 1, 10, ROW_FETCH_MIN - 15);
    expect(rowTick(db)).toBeNull();
    expect(money(db)).toBe(10);
    setClock(db, 1, 11, 0);
    expect(rowTick(db)).toMatch(/boy found the boat/);
    expect(money(db)).toBe(0);
    expect(rowState(db)).toMatchObject({ hire: null, debt_c: ROW_LEFT_FINE_C - 10 });
    expect(rowState(db).notice?.text).toMatch(/owe him 5 c/);
    // the debt comes first at the next hire
    set(db, `money_c = ${ROW_HIRE_C}`);
    expect(() => hire(db)).toThrow(/owe/);
    set(db, `money_c = ${ROW_HIRE_C + 5}`);
    expect(hire(db).debt_paid_c).toBe(5);
    expect(money(db)).toBe(0);
    expect(rowState(db).debt_c).toBe(0);
  });

  it("back into your own boat before the boy comes: no fine", () => {
    const db = fresh();
    hire(db);
    leaveBoat(db, -200, -30, 0);
    setClock(db, 1, 10, 30);
    boardHired(db, -199, -30);
    expect(rowing(db)).toBe(true);
    setClock(db, 1, 12);
    expect(rowTick(db)).toBeNull();
    expect(money(db)).toBe(100 - ROW_HIRE_C);
    expect(() => boardHired(db, 0, 0)).toThrow(/already/);
  });

  it("the night ends a hire: the waterman takes his boat back at the price of one left out", () => {
    const db = fresh(23, 100);
    hire(db);
    sleep(db, "rough");
    expect(rowState(db)).toMatchObject({ hire: null, on: null });
    expect(money(db)).toBe(100 - ROW_HIRE_C - ROW_LEFT_FINE_C);
  });
});

describe("a lost boat", () => {
  it("the price by kind, always within the clamp", () => {
    expect(lostFee("rowboat")).toBeGreaterThanOrEqual(ROW_LOST_MIN_C);
    expect(lostFee("rowboat")).toBeLessThanOrEqual(ROW_LOST_MAX_C);
    expect(lostFee("punt")).toBeLessThan(lostFee("rowboat"));
    expect(lostFee("barge" as "punt")).toBe(ROW_LOST_MAX_C);
  });

  it("a hired boat run down: Jef pays what he has, owes the rest; still owed after a night, the waterman goes to the police", () => {
    const db = fresh(10, 50);
    hire(db); // 40 left
    const who = waterman(db, "rijnkaai")!;
    const r = loseHired(db, "ship");
    expect(r).toMatchObject({ lost_c: lostFee("rowboat"), paid_c: 40, owed_c: lostFee("rowboat") - 40 });
    expect(money(db)).toBe(0);
    expect(rowState(db)).toMatchObject({ hire: null, on: null, debt_c: lostFee("rowboat") - 40, debt_to: who, debt_day: 1 });
    expect(() => loseHired(db, "ship")).toThrow(/no hired boat/);
    // the same day: no police yet
    expect(rowDebtToPolice(db)).toBeNull();
    sleep(db, "rough");
    const id = rowDebtToPolice(db)!;
    expect(id).toBeGreaterThan(0);
    expect(deedRow(db, id)).toMatchObject({ thing: "boat_debt", owner: who, seen: 1, owner_saw: 1, status: "open" });
    expect(policeState(db).visit?.deeds).toContain(id);
    expect(rowState(db).debt_c).toBe(0); // the police have it now
    expect(rowState(db).notice?.text).toMatch(/police/);
    expect(() => returnThing(db, id, "gave")).toThrow(/nothing to give back/);
  });

  it("paid in full: no debt, no police", () => {
    const db = fresh(10, 200);
    hire(db, "bassin");
    loseHired(db, "bridge");
    expect(money(db)).toBe(200 - ROW_HIRE_C - lostFee("punt"));
    sleep(db, "rough");
    expect(rowDebtToPolice(db)).toBeNull();
  });

  it("debts are clamped", () => {
    const db = fresh(10, ROW_HIRE_C);
    hire(db);
    loseHired(db, "ship");
    set(db, "money_c = 0");
    expect(() => hire(db)).toThrow(/owe|money/);
    expect(rowState(db).debt_c).toBeLessThanOrEqual(ROW_DEBT_MAX_C);
  });
});

describe("taking a boat that is not yours (the M3h deed system)", () => {
  it("taking one is a deed; in it at once; out, it stays where you left it; back in without a new deed", () => {
    const db = fresh(10);
    const b = rowBoats(db)[0];
    const [lx, lz] = b.landing;
    const r = takeThing(db, { ref: b.id, x: lx, z: lz, witnesses: [] }, never);
    expect(r.deed).toBeGreaterThan(0);
    expect(r.item_id).toBeNull(); // no pocket
    expect(r.text).toMatch(/cast off/);
    expect(deedRow(db, r.deed!)).toMatchObject({ thing: "boat", owner: b.owner, item: b.kind });
    expect(rowing(db)).toBe(true);
    expect(rowState(db).on).toBe(b.id);
    expect(() => hire(db)).toThrow(/already/);
    leaveBoat(db, -60, -30, 0.5);
    expect(rowing(db)).toBe(false);
    expect(rowBoatStates(db)[b.id]).toMatchObject({ x: -60, z: -30, ridden: false, deed: r.deed });
    const again = takeThing(db, { ref: b.id, x: -59, z: -29, witnesses: [] }, never);
    expect(again).toMatchObject({ again: true, deed: r.deed });
    expect(rowing(db)).toBe(true);
  });

  it("too far, twice at once, in a boat already: refused", () => {
    const db = fresh(10);
    const [a, c] = rowBoats(db);
    expect(() => takeThing(db, { ref: a.id, x: 0, z: 200, witnesses: [] }, never)).toThrow(/too far/);
    takeThing(db, { ref: a.id, x: a.landing[0], z: a.landing[1], witnesses: [] }, never);
    expect(() => takeThing(db, { ref: c.id, x: c.landing[0], z: c.landing[1], witnesses: [] }, never)).toThrow(/in a boat already/);
    expect(() => takeThing(db, { ref: "boat:nowhere", x: 0, z: 0, witnesses: [] }, never)).toThrow(/no such boat/);
  });

  it("seen by the owner: the police are called; the verdict sends the boat home", () => {
    const db = fresh(10);
    const b = rowBoats(db)[1];
    const r = takeThing(db, { ref: b.id, x: b.landing[0], z: b.landing[1], witnesses: [{ id: b.owner, d: 3, los: true, facing: 1 }] }, always);
    expect(r.seen).toBe(true);
    // given back when asked: home again, the ride over
    returnThing(db, r.deed!, "gave");
    expect(rowBoatStates(db)[b.id]).toMatchObject({ x: b.x, z: b.z, ridden: false, deed: null });
    expect(rowing(db)).toBe(false);
  });

  it("a stolen boat wrecked is a worse deed; the boat is gone till the next morning", () => {
    const db = fresh(10);
    const b = rowBoats(db)[2];
    const r = takeThing(db, { ref: b.id, x: b.landing[0], z: b.landing[1], witnesses: [] }, never);
    const out = loseStolen(db, b.id);
    expect(out.text).toMatch(/gone/);
    expect(deedRow(db, r.deed!)).toMatchObject({ thing: "boat_lost", status: "open" });
    expect(deedRow(db, r.deed!)!.rumour_at).not.toBeNull(); // unseen, but a wreck gets talked about
    expect(rowing(db)).toBe(false);
    expect(() => takeThing(db, { ref: b.id, x: b.landing[0], z: b.landing[1], witnesses: [] }, never)).toThrow(/gone/);
    expect(rowWorld(db).boats.find((q) => q.id === b.id)?.lost).toBe(true);
    expect(() => returnThing(db, r.deed!, "gave")).toThrow(/nothing to give back/);
    expect(THINGS.boat_lost.severity).toBeGreaterThan(THINGS.boat.severity);
    // the next morning a boat lies there again
    setClock(db, 2, 7);
    expect(rowBoatStates(db)[b.id]).toMatchObject({ x: b.x, z: b.z, deed: null, ridden: false });
    expect(rowBoatStates(db)[b.id].lostDay).toBeUndefined();
  });

  it("the police count a wrecked boat worse than a taken one", () => {
    const rec = { warnings: 0, fines: 0, arrests: 0, fled: 0 };
    const facts = (thing: "boat" | "boat_lost") => ({ thing, seen: true, owner_saw: false, witnesses: 1, returned: false });
    const taken = decide({ deeds: [facts("boat")], record: rec, fledNow: 0, stance: "other", money_c: 500, reason: "deed" });
    const wrecked = decide({ deeds: [facts("boat_lost")], record: rec, fledNow: 0, stance: "other", money_c: 500, reason: "deed" });
    expect(wrecked.points).toBeGreaterThan(taken.points);
    expect(wrecked.fine_c).toBeGreaterThan(taken.fine_c);
  });
});

describe("rowing and the needs (engine numbers)", () => {
  it("colder on the water: warmth -1 every 4 h by day (on foot 5)", () => {
    const db = fresh();
    hire(db);
    applyHour(db, 12); // 12 % 4: -1 in the boat; on foot 12 % 5 would be nothing
    expect(player(db).warmth).toBe(5);
    applyHour(db, 15); // on foot this hour costs warmth; in the boat not (15 % 4)
    expect(player(db).warmth).toBe(5);
  });

  it("in rain every 3 h; at night every 2 h", () => {
    const db = fresh();
    setWeather(db, "rain");
    hire(db);
    applyHour(db, 9);
    expect(player(db).warmth).toBe(5);
    setWeather(db, "fog");
    applyHour(db, 22);
    expect(player(db).warmth).toBe(4);
    applyHour(db, 21);
    expect(player(db).warmth).toBe(4);
  });

  it("a long row makes him hungrier: food -1 more every 4th hour after 2 hours in the boat", () => {
    const db = fresh(10);
    hire(db);
    setClock(db, 1, 11);
    applyHour(db, 11);
    expect(player(db).food).toBe(6);
    setClock(db, 1, 16);
    applyHour(db, 16); // 16 % 6 no, 16 % 4 and 2 h in: -1
    expect(player(db).food).toBe(5);
  });

  it("hard strokes cost food, counted by the client but clamped by the clock", () => {
    const db = fresh(10);
    hire(db);
    const t0 = 1_000_000;
    rowEffort(db, 5, t0); // the first call sets the clock
    expect(rowEffort(db, 500, t0 + 10_000)).toBe(10); // 10 s: at most 10 strokes
    expect(rowEffort(db, -3, t0 + 11_000)).toBe(0);
    expect(rowEffort(db, "lots", t0 + 12_000)).toBe(0);
    let t = t0 + 12_000;
    for (let i = 0; i < 10; i++) rowEffort(db, 30, (t += 30_000));
    expect(rowState(db).effort).toBeLessThanOrEqual(2 * ROW_EFFORT_PER_FOOD);
    applyHour(db, 11); // not a 4th hour, not a 6th: only the effort
    expect(player(db).food).toBe(5);
    // on foot it counts nothing
    const b = berth("rijnkaai");
    leaveBoat(db, b.x, b.z, 0);
    expect(rowEffort(db, 30, t + 60_000)).toBe(0);
  });

  it("needs stay clamped at 0 in the boat", () => {
    const db = fresh();
    set(db, "food = 0, warmth = 0");
    hire(db);
    for (const h of [12, 16, 20, 22, 0]) applyHour(db, h);
    expect(player(db)).toMatchObject({ food: 0, warmth: 0 });
  });
});
