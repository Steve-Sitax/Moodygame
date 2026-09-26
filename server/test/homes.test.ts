import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, HOME_CALLS_PER_DAY } from "../src/config.ts";
import { sleep } from "../src/day.ts";
import { remember } from "../src/npcs.ts";
import { buy, pockets, waresOf } from "../src/trade.ts";
import { resident, town } from "../src/town/store.ts";
import { houseDoors } from "../src/town/walkmap.ts";
import { setTestTimeout } from "../src/interiors/state.ts";
import { dayRate, homesInfo, lease, liftItem, owedDays, payRent, placedIn, placeItem, rentFor, sleepHome, STOVE_WARMTH, takeKey, warmAtStove } from "../src/homes/homes.ts";
import { DEALER_ID, ensureHomesTown, HOMES_SCHEMA, homesTown, WIDOW_ID } from "../src/homes/town.ts";
import { remarkOnRoom, visitor } from "../src/homes/remark.ts";
import { canPlace, CLASSES, comfortOf, FURNITURE, HOME_CLASSES, HOME_WARMTH_BASE, nightAt, type HomeClass, type Placed } from "../../shared/homes.ts";
import { HOSTILE_LINES } from "./hostile-lines.ts";
import { blankSave } from "./blank-save.ts";

// M6 homes: rooms to let (rent, days paid, the key, the warning and the key taken back), a
// night at home against the doss house, the dealer's furniture (buying, carrying, placing on
// the grid, saving), comfort numbers, and the neighbour's remark (the model's words only).

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const hang: Runner = ({ signal }) => new Promise((_res, rej) => signal.signal.addEventListener("abort", () => rej(new Error("aborted"))));
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: Db, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const needs = (db: Db) => db.prepare("SELECT food, warmth, health, sleep FROM player WHERE id = 1").get() as { food: number; warmth: number; health: number; sleep: number };
const setNeeds = (db: Db, n: { food: number; warmth: number; health: number; sleep: number }) =>
  db.prepare("UPDATE player SET food = ?, warmth = ?, health = ?, sleep = ? WHERE id = 1").run(n.food, n.warmth, n.health, n.sleep);
const useCalls = (db: Db, hook: string, n: number) => {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, ?, 'claude', 'x', 1, 1)").run(day, hook);
};
const calls = (db: Db, hook: string) => (db.prepare("SELECT COUNT(*) n FROM ai_call WHERE hook = ?").get(hook) as { n: number }).n;

/** A new game; a loop over many lines passes blankSave() (a copy of one built once, test/blank-save.ts). */
function fresh(db: Db = openDb(":memory:")): Db {
  setClock(db, 1, 10);
  setMoney(db, 5000);
  return db;
}

afterEach(() => setTestTimeout(undefined));

// ------------------------------------------------------------------ the town

describe("homes in the town", () => {
  it("five homes, cheap to dear, each on a real house door; nobody lives behind four of them, the widow behind hers", () => {
    const db = fresh();
    const ht = homesTown(db)!;
    expect(ht.homes.map((h) => h.cls).sort()).toEqual([...HOME_CLASSES].sort());
    expect(CLASSES.cellar.week_c).toBeLessThan(CLASSES.garret.week_c);
    expect(CLASSES.garret.week_c).toBeLessThan(CLASSES.widow.week_c);
    expect(CLASSES.widow.week_c).toBeLessThan(CLASSES.alley.week_c);
    expect(CLASSES.alley.week_c).toBeLessThan(CLASSES.merchant.week_c);
    const doors = houseDoors();
    const t = town(db).town;
    for (const h of ht.homes) {
      const d = doors.find((q) => q.house === h.house)!;
      expect(d).toBeTruthy();
      expect([d.sx, d.sz]).toEqual(h.step);
      const living = t.residents.filter((r) => r.home.house === h.house).map((r) => r.id);
      expect(living).toEqual(h.cls === "widow" ? [WIDOW_ID] : []);
      expect(resident(db, h.landlord)).toBeTruthy();
    }
    // two homes never share a door
    expect(new Set(ht.homes.map((h) => h.house)).size).toBe(5);
    expect(resident(db, WIDOW_ID)!.family_role).toBe("widow");
  });

  it("the dealer sells the ten pieces at engine prices, from his door in working hours", () => {
    const db = fresh();
    const w = waresOf(db, DEALER_ID);
    expect(w.map((x) => x.kind).sort()).toEqual(Object.keys(FURNITURE).sort());
    for (const x of w) expect(x.price_c).toBe(FURNITURE[x.kind].price_c);
    expect(homesTown(db)!.dealer!.id).toBe(DEALER_ID);
  });

  it("an older save gets the homes in place: residents, memories and relationships kept, once only", () => {
    const db = fresh();
    db.prepare("DELETE FROM world_state WHERE key = 'homes'").run();
    for (const id of [WIDOW_ID, DEALER_ID]) for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) db.prepare(`DELETE FROM ${t} = ?`).run(id);
    db.exec("DROP TABLE home_item; DROP TABLE home_lease;");
    const someone = town(db).town.residents.find((r) => r.trade === "docker")!;
    remember(db, someone.id, "Jef carried a sack for me.", 6);
    db.prepare("UPDATE npc_relationship SET trust = 4, times_met = 2 WHERE npc_id = ?").run(someone.id);
    const before = {
      residents: (db.prepare("SELECT COUNT(*) n FROM resident").get() as { n: number }).n,
      memories: (db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n,
      rel: db.prepare("SELECT * FROM npc_relationship WHERE npc_id = ?").get(someone.id),
      rows: new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json])),
      money: money(db),
    };
    // what openDb does for an old file: the tables, then the town
    db.exec(HOMES_SCHEMA);
    const made = ensureHomesTown(db);
    expect(made).toEqual({ homes: 5, widow: true, dealer: true });
    expect((db.prepare("SELECT COUNT(*) n FROM resident").get() as { n: number }).n).toBe(before.residents + 2);
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(before.memories);
    expect(db.prepare("SELECT * FROM npc_relationship WHERE npc_id = ?").get(someone.id)).toEqual(before.rel);
    for (const r of db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>)
      if (r.id !== WIDOW_ID && r.id !== DEALER_ID) expect(r.data_json).toBe(before.rows.get(r.id));
    expect(money(db)).toBe(before.money);
    expect(ensureHomesTown(db)).toEqual({ homes: 0, widow: false, dealer: false });
  });
});

// ------------------------------------------------------------------ rent and the key

describe("rent and the key", () => {
  it("taking the key: tonight at the day rate, or to Sunday; the week at the week's price", () => {
    const db = fresh();
    setClock(db, 1, 10); // Monday
    const m0 = money(db);
    const r = takeKey(db, "garret", "week");
    expect(r.paid_c).toBe(CLASSES.garret.week_c);
    expect(money(db)).toBe(m0 - CLASSES.garret.week_c);
    expect(lease(db)!.paid_through).toBe(7);
    // Thursday: four days to Sunday
    const db2 = fresh();
    setClock(db2, 4, 10);
    const r2 = takeKey(db2, "cellar", "week");
    expect(r2.paid_c).toBe(4 * dayRate("cellar"));
    expect(rentFor("cellar", 4)).toBe(4 * Math.ceil(100 / 7));
    const db3 = fresh();
    takeKey(db3, "alley", "day");
    expect(lease(db3)!.paid_through).toBe(1);
    expect(money(db3)).toBe(5000 - dayRate("alley"));
  });

  it("no money, no key; nothing changes", () => {
    const db = fresh();
    setMoney(db, 30);
    expect(() => takeKey(db, "merchant", "day")).toThrow(/not enough money/);
    expect(money(db)).toBe(30);
    expect(lease(db)).toBeNull();
    expect(() => takeKey(db, "castle", "day")).toThrow(/no such home/);
  });

  it("an unpaid day is owed; the first owed night warns; paying clears what is owed first", () => {
    const db = fresh();
    takeKey(db, "garret", "day"); // paid Monday only
    setClock(db, 1, 23);
    const n1 = sleep(db, "rough");
    expect(n1.summary.join(" ")).not.toMatch(/owed/);
    // Tuesday: owed today
    expect(owedDays(db)).toBe(1);
    setClock(db, 2, 23);
    const n2 = sleep(db, "rough");
    expect(n2.summary.join(" ")).toMatch(/rent owed/);
    expect(lease(db)!.warned_day).toBe(2);
    // Wednesday: two days owed; pay by the day covers both
    setClock(db, 3, 10);
    expect(owedDays(db)).toBe(2);
    const m = money(db);
    const p = payRent(db, "day");
    expect(p.paid_c).toBe(2 * dayRate("garret"));
    expect(money(db)).toBe(m - 2 * dayRate("garret"));
    expect(owedDays(db)).toBe(0);
    expect(lease(db)!.warned_day).toBe(0);
  });

  it("still owed at the week's end after a warning: the key is taken back, the things stay, Jef sleeps rough", () => {
    const db = fresh();
    takeKey(db, "cellar", "day");
    const id = buyAndGet(db, "chair");
    placeItem(db, id, 6, 3, 0);
    // Saturday night: first warning
    setClock(db, 6, 23);
    sleep(db, "rough");
    expect(lease(db)!.warned_day).toBe(6);
    // Sunday evening: the key does not turn
    setClock(db, 7, 20);
    const before = needs(db);
    const n = sleepHome(db);
    expect(n.where).toBe("rough");
    expect(n.turnedAway).toBe(true);
    expect(n.summary.join(" ")).toMatch(/taken back the key/);
    expect(lease(db)).toBeNull();
    expect(placedIn(db, "cellar")).toEqual([]);
    expect(needs(db).warmth).toBe(Math.max(0, before.warmth - 3));
  });

  it("paid to Sunday: no warning, no eviction", () => {
    const db = fresh();
    takeKey(db, "widow", "week");
    for (let d = 1; d <= 6; d++) {
      setClock(db, d, 23);
      const n = sleep(db, "rough");
      expect(n.summary.join(" ")).not.toMatch(/owed|taken back/);
    }
    expect(lease(db)).not.toBeNull();
  });

  it("moving to another home: the old one ends, the things go along; not while rent is owed", () => {
    const db = fresh();
    takeKey(db, "garret", "day");
    const id = buyAndGet(db, "table");
    placeItem(db, id, 3, 4, 0);
    takeKey(db, "alley", "week");
    expect(lease(db)!.home).toBe("alley");
    expect(placedIn(db, "alley").map((p) => p.kind)).toEqual(["table"]);
    // owed on the alley house: no new key
    const db2 = fresh();
    takeKey(db2, "garret", "day");
    setClock(db2, 2, 10);
    expect(() => takeKey(db2, "widow", "day")).toThrow(/first pay/);
  });
});

// ------------------------------------------------------------------ the night at home

describe("a night at home", () => {
  const start = { food: 5, warmth: 4, health: 6, sleep: 3 };
  it("every home beats the doss house bed; dearer homes are warmer; the widow's breakfast", () => {
    const doss = fresh();
    setClock(doss, 2, 20);
    setNeeds(doss, start);
    sleep(doss, "bed");
    const d = needs(doss);
    const gains: Record<string, { warmth: number; health: number; food: number }> = {};
    for (const cls of HOME_CLASSES) {
      const db = fresh();
      setClock(db, 2, 20);
      takeKey(db, cls, "week");
      setNeeds(db, start);
      const n = sleepHome(db);
      expect(n.where).toBe("home");
      expect(n.place).toMatch(new RegExp(CLASSES[cls].label.slice(2, 12)));
      const a = needs(db);
      gains[cls] = { warmth: a.warmth - start.warmth, health: a.health - start.health, food: a.food - start.food };
      expect(a.sleep).toBe(10);
      expect(a.warmth).toBeGreaterThan(d.warmth);
      expect(a.health).toBeGreaterThanOrEqual(d.health);
    }
    expect(gains.cellar.warmth).toBe(HOME_WARMTH_BASE);
    expect(gains.merchant.warmth).toBeGreaterThan(gains.cellar.warmth);
    expect(gains.merchant.health).toBe(2); // fed and restful
    expect(gains.widow.food).toBe(-1);
    expect(gains.garret.food).toBe(-2);
  });

  it("not before bedtime unless dead tired; no key, no bed", () => {
    const db = fresh();
    expect(() => sleepHome(db)).toThrow(/rent no room/);
    takeKey(db, "garret", "week");
    setClock(db, 2, 14);
    expect(() => sleepHome(db)).toThrow(/too early/);
    db.prepare("UPDATE player SET sleep = 2 WHERE id = 1").run();
    expect(sleepHome(db).where).toBe("home");
  });

  it("a stove and a lamp make the garret warmer and restful, by the engine's numbers", () => {
    const bare = nightAt("garret", []);
    const k0 = comfortOf("garret", []);
    const done: Placed[] = [
      { id: 1, kind: "stove", gx: 3, gz: 4, rot: 0 },
      { id: 2, kind: "lamp", gx: 3, gz: 3, rot: 0 },
      { id: 3, kind: "rug", gx: 2, gz: 2, rot: 0 },
    ];
    const k1 = comfortOf("garret", done);
    expect(k1.warmth).toBe(k0.warmth + 3 + 1);
    expect(k1.light).toBe(k0.light + 2);
    const warm = nightAt("garret", done);
    expect(warm.warmth).toBeGreaterThan(bare.warmth);
    expect(bare.restful).toBe(false);
    expect(warm.restful).toBe(true);
    expect(warm.healthFed).toBe(bare.healthFed + 1);
  });
});

// ------------------------------------------------------------------ buying and carrying

function buyAndGet(db: Db, kind: string): number {
  buy(db, DEALER_ID, kind);
  return (db.prepare("SELECT id FROM home_item WHERE kind = ? ORDER BY id DESC LIMIT 1").get(kind) as { id: number }).id;
}

describe("buying at the dealer's", () => {
  it("no room, no sale: nothing moves", () => {
    const db = fresh();
    expect(() => buy(db, DEALER_ID, "chair")).toThrow(/Rent a room first/);
    expect(money(db)).toBe(5000);
    expect((db.prepare("SELECT COUNT(*) n FROM home_item").get() as { n: number }).n).toBe(0);
  });

  it("a big piece goes in both arms (no pocket); a small one takes a pocket, pointing at the piece", () => {
    const db = fresh();
    takeKey(db, "garret", "week");
    const m = money(db);
    buy(db, DEALER_ID, "chair");
    expect(money(db)).toBe(m - FURNITURE.chair.price_c);
    expect(pockets(db)).toHaveLength(0);
    expect(homesInfo(db).items.map((i) => [i.kind, i.state])).toEqual([["chair", "arms"]]);
    // one piece in the arms at a time
    expect(() => buy(db, DEALER_ID, "table")).toThrow(/arms are full/);
    expect(money(db)).toBe(m - FURNITURE.chair.price_c);
    buy(db, DEALER_ID, "picture");
    const pk = pockets(db);
    expect(pk).toHaveLength(1);
    expect(pk[0].kind).toBe("picture");
    const it = homesInfo(db).items.find((i) => i.kind === "picture")!;
    expect(pk[0].ref).toBe(it.id);
    expect(it.state).toBe("pocket");
  });

  it("the shop is shut out of hours", () => {
    const db = fresh();
    takeKey(db, "garret", "week");
    setClock(db, 1, 21);
    expect(() => buy(db, DEALER_ID, "plant")).toThrow(/shut/);
  });
});

// ------------------------------------------------------------------ placing on the grid

describe("placing furniture", () => {
  it("the engine's rules: in the room, not on the room's furniture, not in the doorway, the bed stays reachable", () => {
    expect(canPlace("cellar", [], "chair", 6, 3, 0)).toBeNull();
    expect(canPlace("cellar", [], "chair", 9, 3, 0)).toMatch(/fit/);
    expect(canPlace("cellar", [], "chair", 0, 5, 0)).toMatch(/own furniture/); // the straw bed
    // M7: the cellar's door is in its back wall, onto the landing of the house's stair (shared/homes.ts doorWall)
    expect(canPlace("cellar", [], "chair", 3, 7, 0)).toMatch(/door/);
    expect(canPlace("cellar", [], "chair", 3, 0, 0)).toBeNull();
    expect(canPlace("widow", [], "chair", 3, 0, 0)).toMatch(/door/);
    expect(canPlace("cellar", [{ id: 1, kind: "chair", gx: 6, gz: 3, rot: 0 }], "plant", 6, 3, 0)).toMatch(/already/);
    expect(canPlace("cellar", [], "chair", 2.5, 3, 0)).toMatch(/grid/);
    // a wall of tables across the widow's room shuts off the bed
    const wall: Placed[] = [
      { id: 1, kind: "table", gx: 0, gz: 2, rot: 0 },
      { id: 2, kind: "table", gx: 2, gz: 2, rot: 0 },
      { id: 3, kind: "table", gx: 4, gz: 2, rot: 0 },
    ];
    expect(canPlace("widow", wall, "chair", 6, 2, 0)).toMatch(/shuts off the bed/);
    // a rug may lie under a chair; not two rugs on one spot
    expect(canPlace("cellar", [{ id: 1, kind: "rug", gx: 3, gz: 3, rot: 0 }], "chair", 4, 3, 0)).toBeNull();
    expect(canPlace("cellar", [{ id: 1, kind: "rug", gx: 3, gz: 3, rot: 0 }], "rug", 4, 3, 0)).toMatch(/rug/);
  });

  it("wall pieces hang on a wall; curtains only at a window; nothing over the door; lamps under the ridge", () => {
    const back = CLASSES.garret.D / 0.5 - 1;
    expect(canPlace("garret", [], "picture", 5, back, 0)).toBeNull();
    // M7: the garret's door is in its back wall (up the house's stair)
    expect(canPlace("garret", [], "picture", 3, back, 0)).toMatch(/door/);
    expect(canPlace("garret", [], "picture", 3, 3, 0)).toMatch(/wall/);
    expect(canPlace("garret", [], "picture", 0, 4, 3)).toMatch(/nothing hangs/); // the eaves
    expect(canPlace("garret", [], "curtains", 5, 0, 2)).toMatch(/window/); // the gable window is too small
    expect(canPlace("widow", [], "curtains", 5, 0, 2)).toBeNull();
    expect(canPlace("merchant", [], "curtains", 1, 0, 2)).toMatch(/already/); // the drapes of the dearest room
    expect(canPlace("garret", [], "curtains", 0, back, 0)).toMatch(/window/);
    expect(canPlace("garret", [], "picture", 5, 0, 2)).toMatch(/window/);
    expect(canPlace("garret", [], "clock", 3, 0, 2)).toBeNull();
    expect(canPlace("widow", [], "clock", 3, 0, 2)).toMatch(/door/);
    expect(canPlace("garret", [], "lamp", 3, 4, 0)).toBeNull();
    expect(canPlace("garret", [], "lamp", 0, 4, 0)).toMatch(/too low/);
    expect(canPlace("garret", [{ id: 1, kind: "picture", gx: 5, gz: back, rot: 0 }], "clock", 5, back, 0)).toMatch(/already/);
  });

  it("place, move, turn: saved on the server; a pocket piece leaves the pocket when it is put up", () => {
    const db = fresh();
    takeKey(db, "widow", "week");
    const chair = buyAndGet(db, "chair");
    placeItem(db, chair, 3, 3, 1);
    expect(placedIn(db, "widow")).toEqual([{ id: chair, kind: "chair", gx: 3, gz: 3, rot: 1 }]);
    const pic = buyAndGet(db, "picture");
    expect(pockets(db)).toHaveLength(1);
    placeItem(db, pic, 1, 8, 0);
    expect(pockets(db)).toHaveLength(0);
    // pick the chair up and put it elsewhere, turned
    liftItem(db, chair);
    expect(placedIn(db, "widow").map((p) => p.kind)).toEqual(["picture"]);
    placeItem(db, chair, 4, 6, 2);
    expect(placedIn(db, "widow").find((p) => p.kind === "chair")).toEqual({ id: chair, kind: "chair", gx: 4, gz: 6, rot: 2 });
    // a bad place is refused and nothing moves
    expect(() => placeItem(db, chair, 0, 6, 0)).toThrow(/own furniture/);
    expect(placedIn(db, "widow").find((p) => p.kind === "chair")!.gx).toBe(4);
    // a piece that is not his
    expect(() => placeItem(db, 9999, 3, 3, 0)).toThrow(/no such thing/);
  });

  it("the layout is kept in the save file (reopened)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "homes-")), "save.sqlite");
    let db = openDb(file);
    setClock(db, 1, 10);
    setMoney(db, 2000);
    takeKey(db, "alley", "week");
    const id = buyAndGet(db, "rug");
    placeItem(db, id, 4, 4, 1);
    db.close();
    db = openDb(file);
    expect(placedIn(db, "alley")).toEqual([{ id, kind: "rug", gx: 4, gz: 4, rot: 1 }]);
    expect(lease(db)!.home).toBe("alley");
    db.close();
  });
});

// ------------------------------------------------------------------ comfort

describe("comfort", () => {
  it("each kind counts once; the caps hold; the stove warms once an hour and only where there is one", () => {
    const two: Placed[] = [
      { id: 1, kind: "chair", gx: 1, gz: 1, rot: 0 },
      { id: 2, kind: "chair", gx: 2, gz: 1, rot: 0 },
    ];
    expect(comfortOf("cellar", two).cheer).toBe(1);
    const all: Placed[] = Object.keys(FURNITURE).map((kind, i) => ({ id: i, kind, gx: 0, gz: 0, rot: 0 }));
    const k = comfortOf("merchant", all);
    expect(k.warmth).toBe(6);
    expect(k.light).toBe(4);
    expect(k.cheer).toBe(6);

    const db = fresh();
    takeKey(db, "garret", "week");
    expect(() => warmAtStove(db)).toThrow(/no stove/);
    const id = buyAndGet(db, "stove");
    placeItem(db, id, 3, 4, 0);
    db.prepare("UPDATE player SET warmth = 3 WHERE id = 1").run();
    expect(warmAtStove(db).warmed).toBe(true);
    expect(needs(db).warmth).toBe(3 + STOVE_WARMTH);
    expect(warmAtStove(db).warmed).toBe(false);
    setClock(db, 1, 11, 5);
    expect(warmAtStove(db).warmed).toBe(true);
    // the alley house has its own hearth
    const db2 = fresh();
    takeKey(db2, "alley", "week");
    expect(warmAtStove(db2).warmed).toBe(true);
  });
});

// ------------------------------------------------------------------ the remark

describe("the landlady's or a neighbour's remark", () => {
  it("the widow looks in when she is at home; the model's line is used when it is clean", async () => {
    const db = fresh();
    setClock(db, 1, 11);
    takeKey(db, "widow", "week");
    expect(visitor(db, homesTown(db)!.homes.find((h) => h.cls === "widow")!)!.id).toBe(WIDOW_ID);
    const r = await remarkOnRoom(db, reply({ line: "A bare room still. You might hang something on that wall." }));
    expect(r!.source).toBe("claude");
    expect(r!.who.id).toBe(WIDOW_ID);
    expect(r!.line).toMatch(/bare room/);
    // once a game day
    expect(await remarkOnRoom(db, reply({ line: "Again." }))).toBeNull();
  });

  it("hostile or rough model output is thrown away for the engine's line; money, needs and the room stay as they were", async () => {
    const bad = [
      ...HOSTILE_LINES.slice(0, 12),
      "That will be 500 francs for the linen.",
      "I'll give you a free loaf, take it.",
      "<script>alert(1)</script>",
      "You owe me twenty centimes, pay now.",
      "Damn, what a hole.",
    ];
    for (const line of bad) {
      const db = fresh(blankSave());
      setClock(db, 1, 11);
      takeKey(db, "widow", "week");
      const before = { money: money(db), needs: needs(db), placed: placedIn(db, "widow"), lease: lease(db) };
      const r = await remarkOnRoom(db, reply({ line, money_c: 99999, warmth: 10, trust: 10 }));
      if (r!.source === "claude") {
        // only clean words get through: no numbers, sums, orders about money, markup
        expect(r!.line).not.toMatch(/\d|franc|centime|<|>|give|pay|owe/i);
      }
      expect(money(db)).toBe(before.money);
      expect(needs(db)).toEqual(before.needs);
      expect(placedIn(db, "widow")).toEqual(before.placed);
      expect(lease(db)).toEqual(before.lease);
    }
  });

  it("a model that never answers: the engine's line after the timeout", async () => {
    setTestTimeout(300);
    const db = fresh();
    setClock(db, 1, 11);
    takeKey(db, "widow", "week");
    const r = await remarkOnRoom(db, hang);
    expect(r!.source).toBe("engine");
    expect(r!.line.length).toBeGreaterThan(5);
  });

  it("no call over the share or into the reserve", async () => {
    const db = fresh();
    setClock(db, 1, 11);
    takeKey(db, "widow", "week");
    useCalls(db, "home_remark", HOME_CALLS_PER_DAY);
    let asked = 0;
    const r = await remarkOnRoom(db, async () => {
      asked++;
      return { output: { line: "Nice." } };
    });
    expect(asked).toBe(0);
    expect(r!.source).toBe("engine");
    const db2 = fresh();
    setClock(db2, 1, 11);
    takeKey(db2, "widow", "week");
    useCalls(db2, "board", CALLS_PER_DAY - CALLS_RESERVE);
    const r2 = await remarkOnRoom(db2, async () => {
      asked++;
      return { output: { line: "Nice." } };
    });
    expect(asked).toBe(0);
    expect(r2!.source).toBe("engine");
    expect(calls(db2, "home_remark")).toBe(0);
  });

  it("nobody looks in at night", async () => {
    const db = fresh();
    takeKey(db, "cellar", "week");
    setClock(db, 1, 23);
    expect(await remarkOnRoom(db, reply({ line: "Hm." }))).toBeNull();
  });
});

// keep the class list honest for the client, which draws each class
it("every class's fixed furniture fits its room", () => {
  for (const cls of HOME_CLASSES as HomeClass[]) {
    const c = CLASSES[cls];
    for (const f of c.fixed) {
      expect(f.gx + f.w).toBeLessThanOrEqual(c.W / 0.5);
      expect(f.gz + f.d).toBeLessThanOrEqual(c.D / 0.5);
    }
  }
});
