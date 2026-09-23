import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { remember, topMemories } from "../src/npcs.ts";
import { marketOn, marketShare } from "../src/town/market.ts";
import { HAULS, STALLS } from "../src/town/places.ts";
import { relayStalls, resident, town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";

// M3i: market days (engine hours) and moving an older town's stalls to the new layout.

describe("market days", () => {
  it("the fish market every weekday morning, never on Sunday", () => {
    for (const day of [1, 2, 3, 4, 5, 6]) {
      expect(marketShare("vismarkt", day, 5)).toBe(0);
      expect(marketShare("vismarkt", day, 6.25)).toBeGreaterThan(0);
      expect(marketShare("vismarkt", day, 6.25)).toBeLessThan(1);
      expect(marketShare("vismarkt", day, 10)).toBe(1);
      expect(marketOn("vismarkt", day, 10)).toBe(true);
      expect(marketShare("vismarkt", day, 13.25)).toBeGreaterThan(0);
      expect(marketShare("vismarkt", day, 13.25)).toBeLessThan(1);
      // the afternoon remainder: a third of the stalls until 16:30, all gone by 17:30
      expect(marketShare("vismarkt", day, 15)).toBeCloseTo(0.35);
      expect(marketOn("vismarkt", day, 15)).toBe(true);
      expect(marketShare("vismarkt", day, 17)).toBeGreaterThan(0);
      expect(marketShare("vismarkt", day, 17)).toBeLessThan(0.35);
      expect(marketShare("vismarkt", day, 17.5)).toBe(0);
    }
    expect(marketShare("vismarkt", 7, 10)).toBe(0);
    expect(marketShare("vismarkt", 14, 10)).toBe(0); // the second Sunday
  });

  it("the Grote Markt on Wednesdays and Saturdays only", () => {
    expect(marketShare("grote_markt", 3, 10)).toBe(1);
    expect(marketShare("grote_markt", 6, 10)).toBe(1);
    expect(marketShare("grote_markt", 10, 10)).toBe(1); // the next Wednesday
    for (const day of [1, 2, 4, 5, 7]) expect(marketShare("grote_markt", day, 10)).toBe(0);
    expect(marketShare("nowhere", 3, 10)).toBe(0);
  });

  it("stalls go up and come down gradually, never outside 0..1", () => {
    let last = 0;
    for (let h = 5; h <= 7; h += 0.05) {
      const s = marketShare("vismarkt", 2, h);
      expect(s).toBeGreaterThanOrEqual(last - 1e-9);
      last = s;
    }
    for (let h = 0; h < 24; h += 0.1) {
      const s = marketShare("grote_markt", 3, h);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("the stalls re-laid (relayStalls)", () => {
  it("the new stalls and haul ends stand on ground you can walk to", () => {
    const wm = walkMap();
    for (const s of STALLS) {
      expect(wm.reachable(s.x, s.z) || wm.nearestOpen(s.x, s.z, 3) !== null).toBe(true);
      expect(Math.hypot(s.face[0], s.face[1])).toBeGreaterThan(0.98);
      expect(Math.hypot(s.face[0], s.face[1])).toBeLessThan(1.02);
    }
    for (const h of HAULS.vismarkt) expect(wm.reachable(h.b[0], h.b[1])).toBe(true);
  });

  it("moves an older town's stalls in place: same keepers, their memories kept", () => {
    const db = openDb(":memory:");
    const t = town(db).town;
    // make it look like a town from before M3i: the old grid on the Vismarkt
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string };
    const rest = JSON.parse(row.value_json);
    rest.stalls[0].x = -128;
    rest.stalls[0].z = 18;
    rest.stalls[0].face = [1, 0];
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    const keeper = rest.stalls[0].keeper as string;
    remember(db, keeper, "Jef bought two herring and paid in coppers.", 3);
    const before = topMemories(db, keeper).length;
    const moved = relayStalls(db);
    expect(moved.stalls).toBeGreaterThanOrEqual(1);
    const after = town(db).town;
    expect(after.stalls.map((s) => s.keeper)).toEqual(t.stalls.map((s) => s.keeper));
    expect(Math.hypot(after.stalls[0].x - STALLS[0].x, after.stalls[0].z - STALLS[0].z)).toBeLessThan(1);
    const k = resident(db, keeper)!;
    expect(Math.hypot(k.work.at![0] - (after.stalls[0].x - after.stalls[0].face[0]), k.work.at![1] - (after.stalls[0].z - after.stalls[0].face[1]))).toBeLessThan(1.5);
    expect(topMemories(db, keeper).length).toBe(before);
    // twice is the same as once
    expect(relayStalls(db).stalls).toBe(0);
  });
});
