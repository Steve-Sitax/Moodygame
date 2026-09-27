import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/db.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer, setOnlineIds } from "../src/player/current.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { clock, passTime, resetTickLimit, worldTick } from "../src/day.ts";
import { clearRests, collapseRest, restOf, takeWoke } from "../src/rest.ts";
import { resetMpSettings } from "../src/mp/settings.ts";
import { setWorldClock } from "../src/mp/worldClock.ts";
import { TICK_MINUTES, TICK_EVERY_MS } from "../../shared/clock.ts";

// M8c played together (docs/multiplayer-plan.md 6.1): the world's tick moves the clock once, and every player in
// the game has his own hour; a sleeper sleeps at the world's pace and never moves the clock himself; when everyone
// in the game is asleep, the night passes fast.

let db: DB;
let now = 1_000_000;
const needs = (id: number) => db.prepare("SELECT food, warmth, sleep, health FROM player WHERE id = ?").get(id) as { food: number; warmth: number; sleep: number; health: number };
const minutes = () => {
  const c = clock(db);
  return (c.day - 1) * 1440 + c.hour * 60 + c.minute;
};
/** One world tick of the server's own clock, TICK_EVERY_MS later. */
const tickOnce = (ms = TICK_EVERY_MS) => {
  now += ms;
  return asPlayer(1, () => worldTick(db, now));
};

beforeEach(() => {
  db = blankSave();
  ensurePlayerRow(db, 2, "Anna");
  resetMpSettings({ multiplayer: true });
  setOnlineIds(() => [1, 2]);
  clearRests();
  resetTickLimit();
  setWorldClock(db, { day: 1, hour: 10, minute: 0 });
});

afterEach(() => {
  resetMpSettings();
  setOnlineIds(null);
  clearRests();
});

describe("the world's tick, played together", () => {
  it("moves the world's clock once a tick, and gives every player in the game his hour", () => {
    const m0 = minutes();
    const a0 = needs(1);
    const b0 = needs(2);
    for (let i = 0; i < (3 * 60) / TICK_MINUTES; i++) tickOnce();
    expect(minutes() - m0).toBe(180);
    // both players' needs moved alike (they start alike): three hours awake each
    expect(needs(1)).toEqual(needs(2));
    const moved = (a: typeof a0, b: typeof a0) => a.food !== b.food || a.warmth !== b.warmth || a.sleep !== b.sleep;
    expect(moved(needs(1), a0) && moved(needs(2), b0)).toBe(true);
  });

  it("a player who is gone is frozen till he is back", () => {
    setOnlineIds(() => [1]);
    const b0 = needs(2);
    for (let i = 0; i < (3 * 60) / TICK_MINUTES; i++) tickOnce();
    expect(needs(2)).toEqual(b0);
  });

  it("a sleeper sleeps at the world's pace: the clock moves once, not once more for him", () => {
    asPlayer(2, () => collapseRest(db, 2));
    const m0 = minutes();
    for (let i = 0; i < 60 / TICK_MINUTES; i++) tickOnce();
    expect(minutes() - m0).toBe(60);
    expect(restOf(db, 2)?.slept_min).toBe(60);
    // the other, awake, had his hour as ever; nobody woke
    expect(restOf(db, 1)).toBeNull();
    expect(takeWoke(2)).toBeNull();
  });

  it("everyone in the game asleep: the night passes fast (bigger steps, often)", () => {
    asPlayer(1, () => collapseRest(db, 1));
    asPlayer(2, () => collapseRest(db, 2));
    const m0 = minutes();
    // a step every 300 ms of 30 game minutes
    for (let i = 0; i < 4; i++) tickOnce(300);
    expect(minutes() - m0).toBe(120);
    expect(restOf(db, 1)?.slept_min).toBe(120);
    expect(restOf(db, 2)?.slept_min).toBe(120);
  });

  it("one player's night in a bed or a cell does not carry the world to the morning", () => {
    const m0 = minutes();
    expect(passTime(db, 480)).toEqual({ lines: [], turned: false });
    expect(minutes()).toBe(m0);
  });
});
