import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { ensureNeighbourhoodCafes } from "../src/town/neighbourhoodCafes.ts";
import { dropTownCache, town } from "../src/town/store.ts";
import { keeperOf } from "../src/interiors/state.ts";
import { tavernNow, warmByFire } from "../src/interiors/tavern.ts";
import { tavernWelcome } from "../src/interiors/welcome.ts";
import { buy } from "../src/trade.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { asPlayer } from "../src/player/current.ts";
import { GANG_CAFE, NEIGHBOURHOOD_CAFES } from "../../shared/neighbourhoodCafes.ts";

describe("back-street cafés", () => {
  it("have real listed doors, keepers, regulars and working hours in new games", () => {
    const db = openDb(":memory:");
    try {
      db.prepare("UPDATE player SET day=2,hour=12,minute=0 WHERE id=1").run();
      const t = town(db).town;
      for (const c of NEIGHBOURHOOD_CAFES) {
        const p = `tavern:${c.id}`, now = tavernNow(db, p);
        expect(Math.hypot(t.places[p].door![0] - c.x, t.places[p].door![1] - c.z)).toBeLessThan(2);
        expect(now.keeper).not.toBeNull(); expect(now.open).toBe(true); expect(now.patrons.length).toBeGreaterThanOrEqual(3);
      }
      expect(ensureNeighbourhoodCafes(db)).toBe(0);
    } finally { db.close(); }
  });
  it("adds to an older town once and preserves existing residents and their homes", () => {
    const db = openDb(":memory:");
    try {
      const t = town(db).town, places = { ...t.places };
      const added = t.residents.filter(r => r.id.startsWith("cafe_"));
      for (const r of added) db.prepare("DELETE FROM resident WHERE id=?").run(r.id);
      for (const c of NEIGHBOURHOOD_CAFES) delete places[`tavern:${c.id}`];
      const { residents: _residents, ...rest } = t;
      db.prepare("UPDATE world_state SET value_json=? WHERE key='town'").run(JSON.stringify({ ...rest, places }));
      dropTownCache(db);
      const before = new Map(town(db).town.residents.map(r => [r.id, JSON.stringify(r)]));
      expect(ensureNeighbourhoodCafes(db)).toBeGreaterThan(0);
      expect(ensureNeighbourhoodCafes(db)).toBe(0);
      for (const [id, data] of before) expect(JSON.stringify(town(db).byId.get(id))).toBe(data);
    } finally { db.close(); }
  });
  it("refuses outsiders at every service, then welcomes trusted gang associates", () => {
    const db = openDb(":memory:");
    try {
      db.prepare("UPDATE player SET day=2,hour=20,minute=0,money_c=100 WHERE id=1").run();
      const k = keeperOf(db, GANG_CAFE)!;
      expect(tavernNow(db, GANG_CAFE).welcome).toBe(false);
      expect(() => buy(db, k.id, "beer")).toThrow(/strangers/);
      expect(() => warmByFire(db, GANG_CAFE)).toThrow(/strangers/);
      db.prepare("UPDATE faction_trust SET trust=3 WHERE faction='smokkelaars' AND player_id=1").run();
      expect(tavernWelcome(db, GANG_CAFE)).toBe(true);
      expect(buy(db, k.id, "beer").bought).toBe("beer");
      expect(tavernNow(db, GANG_CAFE).greeting).toMatch(/One of ours/);
    } finally { db.close(); }
  });
  it("checks the visiting player's gang standing independently", () => {
    const db = openDb(":memory:");
    try {
      ensurePlayerRow(db, 2, "Visitor");
      db.prepare("UPDATE faction_trust SET trust=4 WHERE faction='smokkelaars' AND player_id=1").run();
      expect(asPlayer(1, () => tavernWelcome(db, GANG_CAFE))).toBe(true);
      expect(asPlayer(2, () => tavernWelcome(db, GANG_CAFE))).toBe(false);
      expect(asPlayer(2, () => tavernWelcome(db, "tavern:linde"))).toBe(true);
    } finally { db.close(); }
  });
});
