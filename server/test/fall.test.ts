import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { fall, fallHarm } from "../src/player/fall.ts";

// Fall damage (Steve 2026-09-29: "if we jump off things higher than 3m, we get fall damage").
describe("falls", () => {
  it("hurts from 3 m, more the higher, never in water", () => {
    expect(fallHarm(2.9)).toBe(0);
    expect(fallHarm(3)).toBe(1);
    expect(fallHarm(6)).toBe(2);
    expect(fallHarm(9)).toBe(3);
    expect(fallHarm(20)).toBe(4);
    const db = openDb(":memory:");
    const health = () => (db.prepare("SELECT health FROM player WHERE id = 1").get() as { health: number }).health;
    db.prepare("UPDATE player SET health = 8 WHERE id = 1").run();
    expect(fall(db, { height: 2.5 }).hurt).toBe(0);
    expect(fall(db, { height: 10, water: true }).hurt).toBe(0);
    expect(health()).toBe(8);
    const r = fall(db, { height: 6 });
    expect(r.hurt).toBe(2);
    expect(r.text).toBeTruthy();
    expect(health()).toBe(6);
  });
  it("clamps what the browser says and never ends the game by itself", () => {
    const db = openDb(":memory:");
    const health = () => (db.prepare("SELECT health FROM player WHERE id = 1").get() as { health: number }).health;
    db.prepare("UPDATE player SET health = 2 WHERE id = 1").run();
    expect(fall(db, { height: 1e9 }).hurt).toBe(1);
    expect(health()).toBe(1);
    expect(fall(db, { height: 40 }).hurt).toBe(0);
    expect(fall(db, { height: "high" }).hurt).toBe(0);
    expect(health()).toBe(1);
  });
});
