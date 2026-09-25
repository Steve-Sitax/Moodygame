import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { openDb, resetDb } from "../src/db.ts";
import { ARRIVAL_KEY, arrivalStage, mountArrival, setArrivalStage } from "../src/arrival.ts";

// M7 ferry arrival: a new week opens with Jef on the ferry's deck; the first log line says so;
// a save made before this (no key) is ashore, so loading a game in progress is unchanged.

describe("ferry arrival", () => {
  it("a new game starts on the ferry, and the first log line says he came off it", () => {
    const db = openDb(":memory:");
    resetDb(db);
    expect(arrivalStage(db)).toBe("ferry");
    const first = db.prepare("SELECT day, hour, verb, text FROM log ORDER BY id LIMIT 1").get() as { day: number; hour: number; verb: string; text: string };
    expect(first).toMatchObject({ day: 1, hour: 6, verb: "arrived" });
    expect(first.text).toMatch(/came off the ferry/);
    expect(first.text).toMatch(/50 centimes/);
  });

  it("a save without the key (made before the ferry) counts as ashore", () => {
    const db = openDb(":memory:");
    resetDb(db);
    db.prepare("DELETE FROM world_state WHERE key = ?").run(ARRIVAL_KEY);
    expect(arrivalStage(db)).toBe("ashore");
    db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, 'not json')").run(ARRIVAL_KEY);
    expect(arrivalStage(db)).toBe("ashore");
  });

  it("the routes: on board, then ashore once (again is harmless); a new week puts him back on board", async () => {
    const db = openDb(":memory:");
    resetDb(db);
    const app = new Hono();
    mountArrival(app, { db });
    const get = async () => ((await (await app.request("/api/arrival")).json()) as { stage: string }).stage;
    expect(await get()).toBe("ferry");
    const r = await app.request("/api/arrival/ashore", { method: "POST" });
    expect(((await r.json()) as { stage: string }).stage).toBe("ashore");
    await app.request("/api/arrival/ashore", { method: "POST" });
    expect(await get()).toBe("ashore");
    // the rest of the save is untouched by stepping off: money, the clock
    const p = db.prepare("SELECT money_c, day FROM player WHERE id = 1").get() as { money_c: number; day: number };
    expect(p).toEqual({ money_c: 50, day: 1 });
    resetDb(db);
    expect(await get()).toBe("ferry");
    setArrivalStage(db, "ashore");
    expect(arrivalStage(db)).toBe("ashore");
  });
});
