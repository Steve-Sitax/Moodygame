import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { dropTownCache, town } from "../src/town/store.ts";
import { houseDoors } from "../src/town/walkmap.ts";
import { inworldHouse } from "../src/town/kept.ts";
import { activityAt } from "../src/town/schedule.ts";
import { atWork, buy, ITEMS, pockets, priceFloor, useItem, waresOf } from "../src/trade.ts";
import { ensureShopsTown, keeperId, shopsRecord, SHOPS_KEY } from "../src/shops/town.ts";
import { callersNow, shopNow } from "../src/shops/state.ts";
import { SHOP_ITEMS, SHOP_PAWN_WORTH, SHOP_WARES, shopPrice } from "../src/shops/wares.ts";
import { PAWN_WORTH, loanFor } from "../src/paper/pawn.ts";
import { giftValue } from "../src/town/gifts.ts";
import { NEW_SHOPS, OLD_SHOP_TRADE, SHOP_LOOK, shopCallers, VISIT_FROM_MIN, type Shopper } from "../../shared/shops.ts";
import INWORLD from "../../shared/inworld_houses.json" with { type: "json" };

// M7 shops (docs/milestones/M7-shops.md): more shops in the town, each in its own house, keepers who sell at
// engine prices in the shop's hours, and customers the engine's roll sends in.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const setMoney = (db: Db, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const warmth = (db: Db) => (db.prepare("SELECT warmth FROM player WHERE id = 1").get() as { warmth: number }).warmth;
function fresh(day = 2, hour = 10, minute = 30): Db {
  const db = openDb(":memory:");
  setClock(db, day, hour, minute);
  return db;
}

describe("the shops in the town", () => {
  it("adds the new shops with their keepers, each living above his shop in its listed house, once", () => {
    const db = fresh();
    const t = town(db).town;
    const rec = shopsRecord(db)!;
    expect(rec.skipped).toEqual([]);
    for (const def of NEW_SHOPS) {
      const s = t.shops.find((q) => q.id === def.id)!;
      expect(s, def.id).toBeTruthy();
      const k = town(db).byId.get(keeperId(def.id))!;
      expect(k.trade).toBe(def.trade);
      expect(k.work).toMatchObject({ kind: "shop", shop: def.id, place: def.id });
      expect(k.home.house).toBe(inworldHouse(`shop:${def.id}`));
      expect(s.keeper).toBe(k.id);
      // his working day is the shop's hours
      for (const [a, b] of def.hours) expect(activityAt(k.sched, 2, (a + b) / 2).act).toBe("work");
      expect(t.places[def.id].door).toEqual(s.door);
    }
    // nobody else lives in a shop's house
    for (const s of t.shops) {
      const own = inworldHouse(`shop:${s.id}`);
      if (own === undefined) continue;
      const hh = new Set(t.residents.filter((r) => r.home.house === own).map((r) => r.household));
      expect(hh.size, s.id).toBeLessThanOrEqual(1);
    }
    const before = t.residents.length;
    expect(ensureShopsTown(db)).toEqual({ added: 0, moved: 0 });
    dropTownCache(db);
    expect(town(db).town.residents.length).toBe(before);
  });

  it("every shop listed in the world stands at its house's door (the client draws its inside there)", () => {
    const db = fresh();
    const t = town(db).town;
    const doors = houseDoors();
    const shops = (INWORLD as { houses: Array<{ id: string; kind: string; house: number }> }).houses.filter((e) => e.kind === "shop");
    expect(shops.length).toBeGreaterThanOrEqual(17);
    for (const e of shops) {
      const d = doors.find((q) => q.house === e.house)!;
      expect(d, e.id).toBeTruthy();
      const s = t.shops.find((q) => `shop:${q.id}` === e.id)!;
      expect(s, e.id).toBeTruthy();
      expect(Math.hypot(s.wall[0] - d.x, s.wall[1] - d.z), e.id).toBeLessThan(0.6);
    }
  });

  it("an older save's shop in a house that holds no inside moves its front to its own house; the family stays", () => {
    const db = fresh();
    const t = town(db).town;
    const doors = houseDoors();
    // put the bakery behind the Rijnkaai back where Steve's save had it (house 781) and forget the migration
    const old = doors.find((q) => q.house === 781)!;
    const shops = t.shops.map((s) => (s.id === "bakery_rijn" ? { ...s, door: [old.sx, old.sz] as [number, number], wall: [old.x, old.z] as [number, number], out: old.out } : s));
    const { residents: _r, ...rest } = t;
    const places = { ...rest.places, bakery_rijn: { ...rest.places.bakery_rijn, x: old.sx, z: old.sz, door: [old.sx, old.sz], out: old.out } };
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places, shops }));
    db.prepare("DELETE FROM world_state WHERE key = ?").run(SHOPS_KEY);
    dropTownCache(db);
    const keeper = town(db).town.shops.find((s) => s.id === "bakery_rijn")!.keeper;
    const home = JSON.stringify(town(db).byId.get(keeper)!.home);
    const r = ensureShopsTown(db);
    expect(r.moved).toBe(1);
    const s = town(db).town.shops.find((q) => q.id === "bakery_rijn")!;
    const own = doors.find((q) => q.house === inworldHouse("shop:bakery_rijn"))!;
    expect(s.wall).toEqual([own.x, own.z]);
    expect(town(db).town.places.bakery_rijn.door).toEqual([own.sx, own.sz]);
    const k = town(db).byId.get(keeper)!;
    expect(JSON.stringify(k.home)).toBe(home);
    expect(Math.hypot(k.work.at![0] - own.sx, k.work.at![1] - own.sz)).toBeLessThan(4);
  });
});

describe("the wares, at engine prices", () => {
  it("every trade sells what it should, every item is known, and prices are the engine's", () => {
    const db = fresh();
    for (const [trade, list] of Object.entries(SHOP_WARES)) {
      for (const w of list) {
        expect(ITEMS[w.kind], `${trade}: ${w.kind}`).toBeTruthy();
        expect(w.price_c).toBeGreaterThan(0);
        expect(w.price_c).toBeLessThanOrEqual(150);
      }
    }
    for (const s of town(db).town.shops) {
      const trade = OLD_SHOP_TRADE[s.id] ?? NEW_SHOPS.find((q) => q.id === s.id)!.trade;
      // the Berg lends; every other shop sells at its counter
      if (trade === "pawnbroker") continue;
      expect(waresOf(db, s.keeper).length, s.id).toBeGreaterThan(0);
      expect(SHOP_LOOK[trade].smell.length).toBeGreaterThan(10);
    }
    // a draper's shop kept by a widow sells cloth (its own trade), not a shopwife's nothing
    const draper = town(db).town.shops.find((s) => s.id === "draper_markt")!;
    expect(waresOf(db, draper.keeper).map((w) => w.kind)).toContain("wool_vest");
  });

  it("buys at the counter only in the shop's hours, with money, and never below the floor", () => {
    const db = fresh(2, 10, 30);
    const k = keeperId("butcher_vlees");
    setMoney(db, 100);
    expect(atWork(db, k)).toBe(true);
    const r = buy(db, k, "sausage");
    expect(r.price_c).toBe(7);
    expect(money(db)).toBe(93);
    expect(pockets(db).some((p) => p.kind === "sausage")).toBe(true);
    expect(r.price_c).toBeGreaterThanOrEqual(priceFloor(7));
    // shut at night and on Sunday morning
    setClock(db, 2, 22, 0);
    expect(() => buy(db, k, "sausage")).toThrow(/shut/);
    setClock(db, 7, 9, 30);
    expect(() => buy(db, k, "sausage")).toThrow(/shut/);
    // the barber shaves on Sunday before mass
    expect(atWork(db, keeperId("barber_lane"))).toBe(true);
    setClock(db, 2, 10, 30);
    setMoney(db, 2);
    expect(() => buy(db, k, "bacon")).toThrow(/money/);
    expect(() => buy(db, k, "bread")).toThrow(/do not sell/);
  });

  it("a shave is had at the counter, never pocketed; a vest is worn and a pipe smoked from the pockets", () => {
    const db = fresh(2, 10, 30);
    setMoney(db, 200);
    const before = pockets(db).length;
    const shave = buy(db, keeperId("barber_lane"), "shave");
    expect(shave.line).toMatch(/razor/);
    expect(pockets(db).length).toBe(before);
    db.prepare("UPDATE player SET warmth = 3 WHERE id = 1").run();
    const draper = town(db).town.shops.find((s) => s.id === "draper_markt")!;
    buy(db, draper.keeper, "wool_vest");
    const vest = pockets(db).find((p) => p.kind === "wool_vest")!;
    expect(vest.use).toBe("wear");
    const used = useItem(db, vest.id);
    expect(used.text).toMatch(/coat/);
    expect(warmth(db)).toBe(6);
    expect(pockets(db).some((p) => p.kind === "wool_vest")).toBe(false);
    buy(db, town(db).town.shops.find((s) => s.id === "tobacco_markt")!.keeper, "pipe");
    const pipe = pockets(db).find((p) => p.kind === "pipe")!;
    useItem(db, pipe.id);
    expect(warmth(db)).toBe(7);
    const logged = db.prepare("SELECT verb FROM log WHERE object IN ('wool_vest', 'pipe') AND verb IN ('wore', 'smoked')").all();
    expect(logged).toHaveLength(2);
  });

  it("the Berg lends on a watch; what the shops sell is worth its price as a gift", () => {
    for (const [kind, worth] of Object.entries(SHOP_PAWN_WORTH)) {
      expect(PAWN_WORTH[kind]).toBe(worth);
      expect(loanFor(kind)).toBeGreaterThan(0);
      expect(loanFor(kind)).toBeLessThan(worth);
    }
    for (const kind of Object.keys(SHOP_ITEMS)) if (shopPrice(kind) !== undefined) expect(giftValue(kind), kind).toBe(shopPrice(kind));
  });
});

describe("who comes in (the engine's roll)", () => {
  const shopper = (id: string, over: Partial<Shopper> = {}): Shopper => ({ id, sex: "f", age: 40, trade: "housewife", act: "market", left: 2, pos: [0, 0], ...over });

  it("is the same answer every time, one shop a person, only open shops, and the men's shops men only", () => {
    const shops = [
      { id: "bakery_rijn", door: [0, 5] as [number, number], open: true },
      { id: "barber_lane", door: [5, 0] as [number, number], open: true },
      { id: "tobacco_markt", door: [-5, 0] as [number, number], open: false },
    ];
    const people = Array.from({ length: 60 }, (_, i) => shopper(`p${i}`, { sex: i % 2 ? "m" : "f", act: i % 3 ? "market" : "loiter", pos: [(i % 7) - 3, (i % 5) - 2] }));
    for (let hr = 7; hr < 19; hr++) {
      const a = shopCallers(people, 3, hr, shops);
      const b = shopCallers([...people].reverse(), 3, hr + 0.7, [...shops].reverse());
      expect([...a].sort()).toEqual([...b].sort());
      for (const [id, shop] of a) {
        const p = people.find((q) => q.id === id)!;
        expect(shop).not.toBe("tobacco_markt");
        if (shop === "barber_lane") expect(p.sex).toBe("m");
      }
    }
    // an errand that ends before the hour does not go in; children never
    const short = shopCallers([shopper("x", { left: 0.4 }), shopper("c", { age: 9 })], 3, 9, shops);
    expect(short.size).toBe(0);
  });

  it("in a town: the customers inside from 20 minutes past the hour, each out on an errand, the keeper and his wife serving", () => {
    const db = fresh(2, 9, 10);
    const early = shopNow(db, "bakery_steen")!;
    expect(early.open).toBe(true);
    expect(early.customers).toEqual([]);
    expect(early.keeper).toBeTruthy();
    setClock(db, 2, 9, VISIT_FROM_MIN + 5);
    let total = 0;
    const seen = new Set<string>();
    for (const s of town(db).town.shops) {
      const now = shopNow(db, s.id)!;
      for (const c of now.customers) {
        expect(seen.has(c.id)).toBe(false);
        seen.add(c.id);
        const r = town(db).byId.get(c.id)!;
        expect(["market", "stroll", "loiter", "work"]).toContain(activityAt(r.sched, 2, 9).act);
        expect(c.age).toBeGreaterThanOrEqual(12);
      }
      total += now.customers.length;
    }
    expect(total).toBeGreaterThan(5);
    expect(callersNow(db).size).toBe(total);
    // shut: nobody inside
    setClock(db, 2, 23, 30);
    expect(shopNow(db, "bakery_steen")!.customers).toEqual([]);
    expect(shopNow(db, "bakery_steen")!.open).toBe(false);
  });
});
