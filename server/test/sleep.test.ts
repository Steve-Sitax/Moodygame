import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openDb } from "../src/db.ts";
import { GameError } from "../src/game.ts";
import { clock, resetTickLimit, tick, type TickResult } from "../src/day.ts";
import { forgetWhere, reportWhere } from "../src/warmth.ts";
import { lease, takeKey } from "../src/homes/homes.ts";
import { setGangDice } from "../src/night/gangs.ts";
import { mountNight } from "../src/night/routes.ts";
import { mountRest } from "../src/restRoutes.ts";
import { allAsleep, benchById, benches, clearRests, plannedMinutes, reportPos, restOf, setRestDice, SLEEP, startRest, wakeRest, type RestEnd } from "../src/rest.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M7 sleep (docs/milestones/M7-sleep.md): a bed at any hour for as long as Jef chooses, a bench for less
// sleep and a cold coat, no more lying down on the bare stones. The engine checks the place and clamps the
// hours; the time passes in steps on the ticks; a key wakes him and only the time slept counts.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const needs = (db: Db) => db.prepare("SELECT food, warmth, health, sleep FROM player WHERE id = 1").get() as { food: number; warmth: number; health: number; sleep: number };
const setNeeds = (db: Db, n: Partial<{ food: number; warmth: number; health: number; sleep: number }>) => {
  for (const [k, v] of Object.entries(n)) db.prepare(`UPDATE player SET ${k} = ? WHERE id = 1`).run(v);
};
const setWeather = (db: Db, w: string) =>
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('weather', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(w));

function fresh(): Db {
  const db = openDb(":memory:");
  setClock(db, 2, 12); // a Tuesday noon
  setWeather(db, "clear");
  db.prepare("UPDATE player SET money_c = 5000 WHERE id = 1").run();
  return db;
}

const doss = CITY.doors.doss as { x: number; z: number; out: number[] };
const DOSS = { x: doss.x + doss.out[0] * 1.2, z: doss.z + doss.out[1] * 1.2 };

/** Step the sleep on ticks (asleep) until it ends; the real clock moves a second a step. */
function sleepThrough(db: Db, max = 200): { woke: RestEnd; steps: TickResult[] } {
  const steps: TickResult[] = [];
  let now = 1_000_000;
  for (let i = 0; i < max; i++) {
    now += 1000;
    const r = tick(db, now, { asleep: true });
    steps.push(r);
    if (r.woke) return { woke: r.woke, steps };
  }
  throw new Error("the sleep did not end");
}

beforeEach(() => {
  resetTickLimit();
  forgetWhere();
  clearRests();
  setRestDice(() => 0.99); // no police unless a test wants them
  setGangDice(() => 0.99); // no hands in his coat unless a test wants them
});
afterEach(() => {
  setRestDice(null);
  setGangDice(null);
  clearRests();
});

describe("a bed", () => {
  it("his own bed at noon for 2 h: the clock 2 h on, sleep +1.25 an hour, food slower than awake", () => {
    const db = fresh();
    takeKey(db, "garret", "week");
    reportWhere({ at: `home:${lease(db)!.home}`, lantern: false });
    setNeeds(db, { sleep: 3, food: 8, warmth: 5, health: 8 });
    const view = startRest(db, { place: "home", hours: 2 });
    expect(view).toMatchObject({ place: "home", planned_min: 120, slept_min: 0 });
    const { woke, steps } = sleepThrough(db);
    expect(steps.length).toBe(4); // 30 game minutes a step
    expect(woke).toMatchObject({ place: "home", reason: "rested", slept_min: 120, planned_min: 120 });
    const c = clock(db);
    expect([c.day, c.hour, c.minute]).toEqual([2, 14, 0]);
    const n = needs(db);
    expect(n.sleep).toBe(3 + Math.floor(2 * SLEEP.bed.perHour)); // 5
    expect(n.food).toBe(8); // -1 every 8 h asleep: not yet
    expect(n.warmth).toBeGreaterThanOrEqual(5); // a bed never takes warmth
    expect(restOf(db)).toBeNull();
  });

  it("the doss house bed until morning from 22:00: wakes at 6:00 the next day, full sleep, the date turned", () => {
    const db = fresh();
    setClock(db, 2, 22);
    setNeeds(db, { sleep: 2, food: 6, warmth: 4, health: 6 });
    const view = startRest(db, { place: "doss", hours: "morning", pos: DOSS });
    expect(view.planned_min).toBe(8 * 60);
    const { woke, steps } = sleepThrough(db);
    expect(woke).toMatchObject({ place: "doss", reason: "rested", slept_min: 480, turned: true });
    expect(steps.some((s) => s.turned)).toBe(true); // index.ts writes the new board off this
    const c = clock(db);
    expect([c.day, c.hour, c.minute]).toEqual([3, 6, 0]);
    const n = needs(db);
    expect(n.sleep).toBe(10);
    expect(n.warmth).toBe(4 + SLEEP.doss.warmth);
    expect(n.food).toBe(5); // one loaf in eight hours
    expect(n.health).toBe(7); // fed: +1 a night
    expect(woke.lines.join(" ")).toMatch(/doss house/);
  });

  it("a key wakes him: only the time slept counts", () => {
    const db = fresh();
    setNeeds(db, { sleep: 0 });
    startRest(db, { place: "doss", hours: 8, pos: DOSS });
    let now = 5_000_000;
    for (let i = 0; i < 3; i++) tick(db, (now += 1000), { asleep: true });
    const woke = wakeRest(db)!;
    expect(woke).toMatchObject({ reason: "up", slept_min: 90, planned_min: 480 });
    expect(clock(db).hour * 60 + clock(db).minute).toBe(12 * 60 + 90);
    expect(needs(db).sleep).toBe(1); // 1.875 so far: one whole point
    expect(restOf(db)).toBeNull();
  });

  it("a tick without `asleep` while he sleeps (a reload, another tab): he is up", () => {
    const db = fresh();
    startRest(db, { place: "doss", hours: 4, pos: DOSS });
    const r = tick(db, 9_000_000);
    expect(r.woke?.reason).toBe("up");
    expect(restOf(db)).toBeNull();
  });

  it("Sunday with no rent: the landlady will not open", () => {
    const db = fresh();
    setClock(db, 7, 21);
    expect(() => startRest(db, { place: "doss", hours: "morning", pos: DOSS })).toThrow(/No rent, no bed/);
  });
});

describe("a bench", () => {
  it("warmth falls to 1 at once, less sleep an hour, capped at 6, and the cold costs health", () => {
    const db = fresh();
    setClock(db, 2, 13);
    setNeeds(db, { sleep: 3, food: 8, warmth: 8, health: 8 });
    const b = benchById("rond:0")!;
    expect(b.fine).toBe(true);
    startRest(db, { place: "bench", bench: b.id, hours: 8, pos: { x: b.x + 0.8, z: b.z } });
    expect(needs(db).warmth).toBe(SLEEP.benchWarmth);
    const { woke } = sleepThrough(db);
    expect(woke).toMatchObject({ place: "bench", reason: "rested", slept_min: 480 });
    const n = needs(db);
    expect(n.sleep).toBe(SLEEP.bench.cap); // 3 + 4.8 = 7, capped at 6
    expect(n.warmth).toBe(0); // the outside rule on from 1: gone by 15:00
    expect(n.health).toBeLessThan(8); // at 0 warmth: -1 every 3 hours
    expect(woke.lines.join(" ")).toMatch(/cold gets into your bones/);
  });

  it("a short nap on a bench gains less than a bed: 2 h from 0 is +1", () => {
    const db = fresh();
    setNeeds(db, { sleep: 0, warmth: 6 });
    const b = benchById("steen:0")!;
    startRest(db, { place: "bench", bench: b.id, hours: 2, pos: b });
    sleepThrough(db);
    expect(needs(db).sleep).toBe(Math.floor(2 * SLEEP.bench.perHour)); // 1
  });

  it("the police move a sleeper on in a fine square at night", () => {
    const db = fresh();
    setClock(db, 2, 22);
    setRestDice(() => 0);
    const b = benchById("rond:1")!;
    startRest(db, { place: "bench", bench: b.id, hours: "morning", pos: b });
    const { woke } = sleepThrough(db);
    expect(woke.reason).toBe("police");
    expect(woke.slept_min).toBe(60);
    expect(woke.lines.join(" ")).toMatch(/policeman/);
  });

  it("half way through a night on a bench, hands may go through his coat (night/gangs.ts)", () => {
    const db = fresh();
    setClock(db, 2, 22);
    setGangDice(() => 0);
    const b = benchById("steen:1")!;
    startRest(db, { place: "bench", bench: b.id, hours: 8, pos: b });
    const { woke } = sleepThrough(db);
    expect(woke.reason).toBe("robbed");
    expect(woke.slept_min).toBe(240);
    expect(woke.robbed?.money_c).toBeGreaterThan(0);
  });

  it("every kind of public bench is known: the squares and greens, the stops, the Steen, the park, the wall walk", () => {
    const kinds = new Set(benches().map((b) => b.id.split(":")[0]));
    for (const k of ["rond", "green", "stop", "steen", "park", "wall"]) expect(kinds.has(k)).toBe(true);
    // a bench shared by two lines' bays is one bench
    const stops = benches().filter((b) => b.id.startsWith("stop:"));
    for (const a of stops) for (const o of stops) if (a !== o) expect(Math.hypot(a.x - o.x, a.z - o.z)).toBeGreaterThan(0.3);
    expect(benches().find((b) => b.id.startsWith("wall:"))!.y).toBeGreaterThan(5);
    expect(benchById("door:12.5,-40.0")).toMatchObject({ x: 12.5, z: -40 });
  });
});

describe("forged and odd requests", () => {
  it("a bed Jef does not rent, or not in his room: refused", () => {
    const db = fresh();
    expect(() => startRest(db, { place: "home", hours: 2 })).toThrow(/rent no room/);
    takeKey(db, "garret", "week");
    reportWhere({ at: null, lantern: false });
    expect(() => startRest(db, { place: "home", hours: 2 })).toThrow(/not in your room/);
    reportWhere({ at: "home:merchant", lantern: false });
    expect(() => startRest(db, { place: "home", hours: 2 })).toThrow(/not in your room/);
  });

  it("a bench far away, one that does not exist, one on the wall walk from the street: refused", () => {
    const db = fresh();
    const w0 = needs(db).warmth;
    const b = benchById("rond:0")!;
    expect(() => startRest(db, { place: "bench", bench: b.id, hours: 2, pos: { x: b.x + 30, z: b.z } })).toThrow(/too far/);
    expect(() => startRest(db, { place: "bench", bench: b.id, hours: 2 })).toThrow(/too far/);
    expect(() => startRest(db, { place: "bench", bench: "rond:99", hours: 2, pos: b })).toThrow(/no such bench/);
    expect(() => startRest(db, { place: "bench", bench: "x; drop table", hours: 2, pos: b })).toThrow(/place must be/);
    const w = benches().find((q) => q.id.startsWith("wall:"))!;
    expect(() => startRest(db, { place: "bench", bench: w.id, hours: 2, pos: { x: w.x, z: w.z, y: 0 } })).toThrow(/too far/);
    expect(needs(db).warmth).toBe(w0); // a refusal changes nothing
    expect(restOf(db)).toBeNull();
  });

  it("the doss house from across town, or a position far from his last report: refused", () => {
    const db = fresh();
    expect(() => startRest(db, { place: "doss", hours: 2, pos: { x: DOSS.x + 50, z: DOSS.z } })).toThrow(/not at the doss house/);
    const b = benchById("rond:0")!;
    reportPos({ x: 0, z: 0 }, Date.now());
    expect(() => startRest(db, { place: "bench", bench: b.id, hours: 2, pos: b })).toThrow(/not there/);
  });

  it("hours out of range are clamped to 1..12; garbage is refused", () => {
    const db = fresh();
    expect(plannedMinutes(100, { hour: 12, minute: 0 })).toBe(12 * 60);
    expect(plannedMinutes(-3, { hour: 12, minute: 0 })).toBe(60);
    expect(plannedMinutes(2.4, { hour: 12, minute: 0 })).toBe(120);
    expect(plannedMinutes("morning", { hour: 6, minute: 0 })).toBe(24 * 60);
    expect(plannedMinutes("morning", { hour: 5, minute: 30 })).toBe(30);
    expect(startRest(db, { place: "doss", hours: 1e9, pos: DOSS }).planned_min).toBe(12 * 60);
    wakeRest(db);
    expect(() => startRest(db, { place: "doss", hours: "all week", pos: DOSS })).toThrow(/place must be/);
    expect(() => startRest(db, { place: "street", hours: 2, pos: DOSS })).toThrow(/place must be/);
  });

  it("one bench, one sleeper; not asleep twice (by player id: multiplayer later)", () => {
    const db = fresh();
    const b = benchById("steen:0")!;
    startRest(db, { place: "bench", bench: b.id, hours: 2, pos: b }, Date.now(), 2);
    expect(allAsleep()).toBe(false); // player 1 (online) is up: the night would not pass fast
    expect(() => startRest(db, { place: "bench", bench: b.id, hours: 2, pos: b })).toThrow(/someone is asleep/);
    startRest(db, { place: "doss", hours: 2, pos: DOSS });
    expect(allAsleep()).toBe(true);
    expect(() => startRest(db, { place: "doss", hours: 2, pos: DOSS })).toThrow(/asleep already/);
  });
});

describe("the routes", () => {
  function app(db: Db): Hono {
    const a = new Hono();
    const deps = { db, payload: () => ({}), broadcast: () => {}, afterNight: () => {} };
    mountNight(a, deps);
    mountRest(a, deps);
    a.onError((err, c) => (err instanceof GameError ? c.json({ error: err.message }, err.status) : c.json({ error: "server error" }, 500)));
    return a;
  }

  it("the old sleep-rough route is refused; POST /api/sleep lies down, /api/sleep/wake gets up", async () => {
    const db = fresh();
    setClock(db, 2, 23);
    const a = app(db);
    const rough = await a.request("/api/night/sleep-rough", { method: "POST" });
    expect(rough.status).toBe(409);
    expect(((await rough.json()) as { error: string }).error).toMatch(/bench or a bed/);
    const b = benchById("stop:werf:kaaien")!;
    const lie = await a.request("/api/sleep", { method: "POST", body: JSON.stringify({ place: "bench", bench: b.id, hours: 4, pos: { x: b.x, z: b.z } }), headers: { "content-type": "application/json" } });
    expect(lie.status).toBe(200);
    expect(((await lie.json()) as { rest: { planned_min: number } }).rest.planned_min).toBe(240);
    const up = await a.request("/api/sleep/wake", { method: "POST" });
    expect(((await up.json()) as { woke: RestEnd }).woke.reason).toBe("up");
  });
});
