import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { buy, clearJobItems, handOverParcel, needs, pockets, POCKET_SLOTS, useItem } from "../src/trade.ts";
import { topMemories } from "../src/npcs.ts";

const money = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT money_c FROM player").get() as { money_c: number }).money_c;

describe("buying and pockets", () => {
  it("buying a herring takes the engine price and puts it in your pocket", () => {
    const db = openDb(":memory:");
    const r = buy(db, "fientje", "herring");
    expect(r.price_c).toBe(5);
    expect(money(db)).toBe(45);
    expect(pockets(db).map((p) => p.kind)).toEqual(["herring"]);
    expect(topMemories(db, "fientje")[0].text).toMatch(/bought a salt herring/);
  });

  it("refuses when money is short or the ware is not sold there", () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE player SET money_c = 3").run();
    expect(() => buy(db, "fientje", "herring")).toThrow(/not enough money/);
    expect(() => buy(db, "sooi", "herring")).toThrow(/do not sell/);
    expect(money(db)).toBe(3);
  });

  it("pockets hold six things", () => {
    const db = openDb(":memory:");
    for (let i = 0; i < POCKET_SLOTS; i++) buy(db, "peeters", "biscuit");
    expect(() => buy(db, "peeters", "biscuit")).toThrow(/pockets are full/);
    expect(money(db)).toBe(50 - 6 * 4);
  });

  it("eating fills the belly, clamped at 10; a drink is taken on the spot", () => {
    const db = openDb(":memory:");
    buy(db, "fientje", "eel");
    const before = needs(db);
    useItem(db, pockets(db)[0].id);
    expect(needs(db).food).toBe(Math.min(10, before.food + 4));
    expect(pockets(db)).toHaveLength(0);
    buy(db, "tuur", "jenever");
    expect(pockets(db)).toHaveLength(0);
    expect(needs(db).warmth).toBe(Math.min(10, before.warmth + 2));
    expect(needs(db).health).toBe(before.health - 1);
  });

  it("a job parcel goes in once, cannot be eaten, and leaves when the job ends", () => {
    const db = openDb(":memory:");
    handOverParcel(db, 7);
    handOverParcel(db, 7);
    const p = pockets(db);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: "parcel", job_id: 7, use: null });
    expect(() => useItem(db, p[0].id)).toThrow(/not yours to use/);
    clearJobItems(db, 7);
    expect(pockets(db)).toHaveLength(0);
  });
});
