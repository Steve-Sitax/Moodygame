import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { buy } from "../src/trade.ts";
import { finishJob, settle } from "../src/game.ts";
import { crimeOpen } from "../src/director/actions.ts";
import { listJobs } from "../src/hooks/jobBoard.ts";
import { resident, town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { cartHooks, returnThing, takeThing, deedRow } from "../src/town/deeds.ts";
import { policeRespond } from "../src/town/police.ts";
import { transportRecord, transportView, vehicleNow } from "../src/town/possessions.ts";
import { busyAt } from "../src/town/bikeshop.ts";
import { veloStates } from "../src/town/deeds.ts";
import { VELO_PRICE } from "../src/town/transport.ts";
import {
  ackDropped,
  cartAt,
  cartHour,
  cartSeen,
  cartShop,
  cartView,
  ensureCartwright,
  holdCart,
  jefCarts,
  loadCart,
  unloadJob,
  unloadOne,
  WHEELWRIGHT_ID,
} from "../src/town/handcart.ts";
import { CART_FETCH_FEE_C, CART_HIRE_HOURS, CART_LIMIT, CART_PRICE, canLoad, loadOf, pushSpeed, unloadAllAllowed } from "../../shared/handcart.ts";
import { cartFits, footprint, goRound, misfit, stepCart, GO_ROUND_AFTER_S, type CartWorld } from "../../client/src/game/cartPhysics.ts";
import SPOTS from "../../shared/spots.json" with { type: "json" };

type DB = ReturnType<typeof openDb>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: DB, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const never = () => 0.999;
const always = () => 0;
const spot = (id: string) => (SPOTS as unknown as Record<string, { x: number; z: number }>)[id];

function fresh(hour = 10, day = 2): DB {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  return db;
}

/** A job in hand: carry `count` goods from one spot to another. */
function carryJob(db: DB, opts: { count?: number; goods?: string; twist?: string; kind?: "carry" | "deliver"; pay?: number } = {}): number {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  const task =
    opts.kind === "deliver"
      ? { kind: "deliver", goods: opts.goods ?? "sacks", from: "peeters_dock", to: "ship_gangway", recipient: "the mate", twist: opts.twist ?? "none", limit_s: null }
      : { kind: "carry", goods: opts.goods ?? "crates", count: opts.count ?? 4, from: "hessenatie_door", to: "crane_foot", twist: opts.twist ?? "none", limit_s: null };
  const r = db
    .prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, pitch, task_json, source, status) VALUES (?, 'Carry crates', 'sooi', 'rijnkaai', ?, ?, 'low', 1, 'x', ?, 'test', 'taken')")
    .run(day, task.kind, opts.pay ?? 80, JSON.stringify(task));
  return Number(r.lastInsertRowid);
}

/** Buy a second-hand cart and hold it; returns its id and where it stands. */
function ownCart(db: DB): { id: string; x: number; z: number } {
  setMoney(db, 1000);
  buy(db, WHEELWRIGHT_ID, "handcart_used");
  const c = jefCarts(db).list[0];
  return { id: c.id, x: c.x, z: c.z };
}

/** Push it (held) to (x, z) and let go there. */
function parkAt(db: DB, id: string, x: number, z: number): void {
  const c = jefCarts(db).list.find((q) => q.id === id)!;
  if (!c.held) holdCart(db, id, c.x, c.z);
  // walk it over in short pushes, as the client reports it
  let cx = c.x;
  let cz = c.z;
  while (Math.hypot(x - cx, z - cz) > 40) {
    const k = 40 / Math.hypot(x - cx, z - cz);
    cx += (x - cx) * k;
    cz += (z - cz) * k;
    cartAt(db, id, cx, cz, 0, true);
  }
  cartAt(db, id, x, z, 0, false);
}

// ------------------------------------------------------------------ the engine's numbers

describe("the handcart's numbers (shared/handcart.ts)", () => {
  it("four crates go on; a sixth crate is too heavy; a fourth barrel too; the size limit holds", () => {
    const crates = (n: number) => Array.from({ length: n }, () => ({ kind: "crates" }));
    expect(canLoad(crates(3), { kind: "crates" })).toBeNull();
    expect(canLoad(crates(5), { kind: "crates" })).toMatch(/too heavy/);
    const barrels = (n: number) => Array.from({ length: n }, () => ({ kind: "barrels" }));
    expect(canLoad(barrels(3), { kind: "barrels" })).toMatch(/too heavy|no more room/);
    // light things fill it by size
    const rope = Array.from({ length: 10 }, () => ({ kind: "rope" }));
    expect(canLoad(rope, { kind: "rope" })).toMatch(/no more room/);
    expect(canLoad([], { kind: "velocipede" })).toMatch(/does not go/);
    // a heavy one (the heavy_load twist) weighs double
    expect(loadOf([{ kind: "crates", heavy: true }]).kg).toBe(2 * loadOf([{ kind: "crates" }]).kg);
    expect(CART_LIMIT.size).toBeGreaterThan(0);
  });

  it("pushing is slower than walking, and slower still loaded", () => {
    expect(pushSpeed(0)).toBeLessThan(1);
    expect(pushSpeed(CART_LIMIT.kg)).toBeLessThan(pushSpeed(0));
    expect(pushSpeed(CART_LIMIT.kg * 3)).toBe(pushSpeed(CART_LIMIT.kg));
  });

  it("a whole load off at once: a carry job yes; handed to a person or counted by a foreman, one by one", () => {
    expect(unloadAllAllowed({ kind: "carry", twist: "none" })).toBe(true);
    expect(unloadAllAllowed({ kind: "carry", twist: "foreman_watches" })).toBe(false);
    expect(unloadAllAllowed({ kind: "deliver", twist: "none" })).toBe(false);
    expect(unloadAllAllowed(null)).toBe(false);
  });

  it("prices in proportion to the velocipede maker's: a used cart is cheaper than a used velocipede", () => {
    expect(CART_PRICE.used_c).toBeLessThan(VELO_PRICE.used_c);
    expect(CART_PRICE.new_c).toBeLessThan(VELO_PRICE.new_c);
    expect(CART_PRICE.new_c).toBeGreaterThan(CART_PRICE.used_c);
    expect(CART_PRICE.hire_c).toBeLessThan(VELO_PRICE.hire_c);
  });
});

// ------------------------------------------------------------------ the wheelwright

describe("the wheelwright: his door, buying, hiring", () => {
  it("a new game has him at a real, reachable door with room for two carts in front", () => {
    const db = fresh();
    const shop = cartShop(db)!;
    expect(shop).toBeTruthy();
    const wm = walkMap();
    expect(wm.reachable(shop.step[0], shop.step[1])).toBe(true);
    expect(shop.show.length).toBe(2);
    for (const s of shop.show) expect(wm.open(s[0], s[1], 1.0)).toBe(true);
    expect(resident(db, WHEELWRIGHT_ID)!.trade).toBe("wheelwright");
    expect(town(db).town.places.cart_shop).toBeTruthy();
  });

  it("an older save gets him once, in place; nothing else changes", () => {
    const db = fresh();
    db.prepare("DELETE FROM world_state WHERE key = 'cartshop'").run();
    for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) db.prepare(`DELETE FROM ${t} = ?`).run(WHEELWRIGHT_ID);
    const rows = new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
    const jef = db.prepare("SELECT * FROM player WHERE id = 1").get();
    const transport = db.prepare("SELECT value_json FROM world_state WHERE key = 'transport'").get();
    expect(ensureCartwright(db)).toBe(true);
    const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
    expect(after.length).toBe(rows.size + 1);
    for (const r of after) if (r.id !== WHEELWRIGHT_ID) expect(r.data_json).toBe(rows.get(r.id));
    expect(db.prepare("SELECT * FROM player WHERE id = 1").get()).toEqual(jef);
    expect(db.prepare("SELECT value_json FROM world_state WHERE key = 'transport'").get()).toEqual(transport);
    expect(ensureCartwright(db)).toBe(false);
  });

  it("buying: the money goes, the cart stands at his door, no pocket slot, no second one of his own; shut after hours", () => {
    const db = fresh(10);
    setMoney(db, 300);
    expect(() => buy(db, WHEELWRIGHT_ID, "handcart_new")).toThrow(/not enough money/);
    const r = buy(db, WHEELWRIGHT_ID, "handcart_used");
    expect(r.price_c).toBe(CART_PRICE.used_c);
    expect(money(db)).toBe(300 - CART_PRICE.used_c);
    expect((db.prepare("SELECT COUNT(*) n FROM item").get() as { n: number }).n).toBe(0);
    const c = jefCarts(db).list[0];
    const shop = cartShop(db)!;
    expect(c).toMatchObject({ kind: "used", held: false, load: [] });
    expect(Math.hypot(c.x - shop.show[0][0], c.z - shop.show[0][1])).toBeLessThan(0.1);
    setMoney(db, 2000);
    expect(() => buy(db, WHEELWRIGHT_ID, "handcart_new")).toThrow(/of your own already/);
    setClock(db, 2, 21);
    expect(() => buy(db, WHEELWRIGHT_ID, "handcart_hire")).toThrow(/shut/);
  });

  it("hire by the day: left elsewhere, his boy fetches it for a fee and leaves the load on the stones", () => {
    const db = fresh(10);
    setMoney(db, 100);
    buy(db, WHEELWRIGHT_ID, "handcart_hire");
    expect(money(db)).toBe(100 - CART_PRICE.hire_c);
    expect(() => buy(db, WHEELWRIGHT_ID, "handcart_hire")).toThrow(/hire cart already/);
    const c = jefCarts(db).list[0];
    const shop = cartShop(db)!;
    const wm = walkMap();
    const quiet = [...Array(400).keys()]
      .map((i) => wm.nearestOpen(-300 + (i % 20) * 25, -10 + Math.floor(i / 20) * 16, 4))
      .find((q) => q && wm.open(q.x, q.z, 1) && !busyAt(db, q.x, q.z) && Math.hypot(q.x - shop.step[0], q.z - shop.step[1]) > 20)!;
    parkAt(db, c.id, quiet.x, quiet.z);
    loadCart(db, c.id, { kind: "sacks" }, quiet.x, quiet.z);
    setClock(db, 2, 10 + CART_HIRE_HOURS, 5);
    const before = money(db);
    expect(cartHour(db, never)).toEqual(["fetched"]);
    expect(money(db)).toBe(before - CART_FETCH_FEE_C);
    expect(jefCarts(db).list).toEqual([]);
    const v = cartView(db);
    expect(v.notice?.text).toMatch(/boy fetched/);
    expect(v.dropped.length).toBe(1);
    expect(v.dropped[0].items.map((i) => i.kind)).toEqual(["sacks"]);
    ackDropped(db, [v.dropped[0].id]);
    expect(cartView(db).dropped).toEqual([]);
  });
});

// ------------------------------------------------------------------ taking hold, loading, parking, saving

describe("taking hold, loading, the limits, parking and saving", () => {
  it("take hold near it, not from afar; one at a time; let go on open ground", () => {
    const db = fresh();
    const c = ownCart(db);
    expect(() => holdCart(db, c.id, c.x + 30, c.z)).toThrow(/too far/);
    holdCart(db, c.id, c.x + 2, c.z);
    expect(jefCarts(db).list[0].held).toBe(true);
    // loading while he has the shafts in his hands: no
    expect(() => loadCart(db, c.id, { kind: "crates" }, c.x, c.z)).toThrow(/let go/);
    cartAt(db, c.id, c.x + 1, c.z + 1, 1.2, false);
    const after = jefCarts(db).list[0];
    expect(after).toMatchObject({ held: false, yaw: 1.2 });
    expect(walkMap().open(after.x, after.z, 0.3)).toBe(true);
    // not somebody else's cart by its id
    expect(() => holdCart(db, "cart:jef99", c.x, c.z)).toThrow(/not your cart/);
  });

  it("loads up to the limit by size and weight; takes things off again, the top one first", () => {
    const db = fresh();
    const c = ownCart(db);
    for (let i = 0; i < 5; i++) loadCart(db, c.id, { kind: "crates" }, c.x, c.z);
    expect(() => loadCart(db, c.id, { kind: "crates" }, c.x, c.z)).toThrow(/too heavy/);
    expect(cartView(db).list[0].kg).toBe(5 * 45);
    loadCart(db, c.id, { kind: "rope" }, c.x, c.z);
    expect(() => loadCart(db, c.id, { kind: "rope" }, c.x, c.z)).toThrow(/no more room|too heavy/);
    const off = unloadOne(db, c.id, c.x, c.z);
    expect(off.item.kind).toBe("rope");
    expect(jefCarts(db).list[0].load.length).toBe(5);
    expect(() => loadCart(db, c.id, { kind: "velocipede" }, c.x, c.z)).toThrow(/does not go/);
    expect(() => loadCart(db, c.id, { kind: "crates" }, c.x + 20, c.z)).toThrow(/too far/);
  });

  it("a job's goods: only the job's kind, never more than the job has", () => {
    const db = fresh();
    const c = ownCart(db);
    const job = carryJob(db, { count: 4 });
    expect(() => loadCart(db, c.id, { kind: "sacks", job }, c.x, c.z)).toThrow(/not the job's goods/);
    for (let i = 0; i < 4; i++) loadCart(db, c.id, { kind: "crates", job, owner: "sooi" }, c.x, c.z);
    expect(() => loadCart(db, c.id, { kind: "crates", job }, c.x, c.z)).toThrow(/more goods than the job has/);
    expect(() => loadCart(db, c.id, { kind: "crates", job: 99999 }, c.x, c.z)).toThrow(/no such job/);
  });

  it("parked with its load, it is still there after a reload", () => {
    const dir = mkdtempSync(join(tmpdir(), "cart-"));
    const file = join(dir, "save.sqlite");
    try {
      let db = openDb(file);
      setClock(db, 2, 10);
      const c = ownCart(db);
      const job = carryJob(db, { count: 4 });
      for (let i = 0; i < 3; i++) loadCart(db, c.id, { kind: "crates", job, owner: "sooi" }, c.x, c.z);
      parkAt(db, c.id, c.x + 3, c.z + 2);
      const before = jefCarts(db).list[0];
      db.close();
      db = openDb(file);
      const after = jefCarts(db).list[0];
      expect(after).toMatchObject({ id: c.id, x: before.x, z: before.z, yaw: before.yaw, held: false });
      expect(after.load.map((i) => [i.kind, i.job])).toEqual([["crates", job], ["crates", job], ["crates", job]]);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a job that ends takes its goods off the cart with it", () => {
    const db = fresh();
    const c = ownCart(db);
    const job = carryJob(db, { count: 2 });
    loadCart(db, c.id, { kind: "crates", job }, c.x, c.z);
    loadCart(db, c.id, { kind: "sacks" }, c.x, c.z);
    db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(job);
    expect(cartView(db).list[0].load.map((i) => i.kind)).toEqual(["sacks"]);
  });

  it("furniture from the arms goes on and comes off into the arms again; not with full arms", () => {
    const db = fresh();
    const c = ownCart(db);
    const day = (db.prepare("SELECT day FROM player").get() as { day: number }).day;
    const chair = Number(db.prepare("INSERT INTO home_item (kind, state, home, rot, day) VALUES ('chair', 'arms', NULL, 0, ?)").run(day).lastInsertRowid);
    loadCart(db, c.id, { kind: "chair", piece: chair }, c.x, c.z);
    expect((db.prepare("SELECT state FROM home_item WHERE id = ?").get(chair) as { state: string }).state).toBe("gone");
    // a chair not in his arms cannot go on
    expect(() => loadCart(db, c.id, { kind: "chair", piece: chair }, c.x, c.z)).toThrow(/not carrying/);
    // a second piece bought meanwhile, in his arms: the first cannot come off
    const table = Number(db.prepare("INSERT INTO home_item (kind, state, home, rot, day) VALUES ('table', 'arms', NULL, 0, ?)").run(day).lastInsertRowid);
    expect(() => unloadOne(db, c.id, c.x, c.z)).toThrow(/arms are full/);
    loadCart(db, c.id, { kind: "table", piece: table }, c.x, c.z);
    const off = unloadOne(db, c.id, c.x, c.z);
    expect(off.item.piece).toBe(table);
    expect((db.prepare("SELECT state FROM home_item WHERE id = ?").get(table) as { state: string }).state).toBe("arms");
  });
});

// ------------------------------------------------------------------ one trip, the board's pay

describe("a multi-item delivery in one trip, paid by the board's rules", () => {
  it("four crates tipped off at the goal: the job pays for its goods, exactly as four trips would", () => {
    const db = fresh();
    const c = ownCart(db);
    const job = carryJob(db, { count: 4, pay: 80 });
    for (let i = 0; i < 4; i++) loadCart(db, c.id, { kind: "crates", job, owner: "sooi" }, c.x, c.z);
    const to = spot("crane_foot");
    // far from the goal: no
    expect(() => unloadJob(db, c.id, job, c.x, c.z)).toThrow(/not where the goods go/);
    parkAt(db, c.id, to.x + 1.5, to.z + 1.5);
    const r = unloadJob(db, c.id, job, to.x + 1, to.z);
    expect(r.items.length).toBe(4);
    expect(jefCarts(db).list[0].load).toEqual([]);
    const before = money(db);
    const j = listJobs(db, 2).find((q) => q.id === job)!;
    const report = { delivered: 4, lost: 0, sold: 0, pocketed: false, late: false, left_post_s: 0, thief: "none" as const, bribe_taken: false, seen_away: false };
    const one = settle(j, report, never);
    const done = finishJob(db, job, report, never);
    expect(done.settlement.pay_c).toBe(80);
    expect(done.settlement.pay_c).toBe(one.pay_c);
    expect(money(db)).toBe(before + 80);
    // three of four by cart and one lost: the share the board pays, not more for fewer trips
    const part = settle(j, { ...report, delivered: 3, lost: 1 }, never);
    expect(part.pay_c).toBe(60);
  });

  it("a deliver job or a foreman's count: one by one, never all at once", () => {
    const db = fresh();
    const c = ownCart(db);
    const deliver = carryJob(db, { kind: "deliver", goods: "sacks" });
    loadCart(db, c.id, { kind: "sacks", job: deliver }, c.x, c.z);
    expect(() => unloadJob(db, c.id, deliver, spot("ship_gangway").x, spot("ship_gangway").z)).toThrow(/one by one/);
    db.prepare("UPDATE job SET status = 'done' WHERE id = ?").run(deliver);
    const counted = carryJob(db, { count: 2, twist: "foreman_watches" });
    loadCart(db, c.id, { kind: "crates", job: counted }, c.x, c.z);
    expect(() => unloadJob(db, c.id, counted, spot("crane_foot").x, spot("crane_foot").z)).toThrow(/one by one/);
    // one by one is always open
    expect(unloadOne(db, c.id, c.x, c.z).item.job).toBe(counted);
  });
});

// ------------------------------------------------------------------ theft

/** A household's cart standing at home now, with its owner. */
function aCart(db: DB) {
  const rec = transportRecord(db)!;
  setClock(db, 2, 22); // night: every cart at home
  const v = rec.vehicles.find((q) => q.kind === "handcart")!;
  const now = vehicleNow(db, v, 2, 22);
  return { v, x: now.spot[0], z: now.spot[1] };
}

describe("taking a household's handcart (the M3h rules), and Jef's own taken from him", () => {
  it("under the owner's eyes: a deed, his memory, trust lost, the police; the family cannot use it; give it back", () => {
    const db = fresh();
    const { v, x, z } = aCart(db);
    setClock(db, 2, 12);
    const now = vehicleNow(db, v, 2, 12);
    const r = takeThing(db, { ref: v.id, x: now.spot[0] + 1, z: now.spot[1], witnesses: [{ id: v.owner, d: 2, los: true, facing: 1 }] }, always);
    expect(r.deed).toBeGreaterThan(0);
    expect(r.seen).toBe(true);
    expect(r.owner_saw).toBe(true);
    expect(r.police).toBe(true);
    expect(deedRow(db, r.deed!)!.thing).toBe("handcart");
    const mem = db.prepare("SELECT text FROM npc_memory WHERE npc_id = ? ORDER BY id DESC").all(v.owner) as Array<{ text: string }>;
    expect(mem.some((m) => /handcart/.test(m.text))).toBe(true);
    // Jef has it, in his hands; the family finds it gone
    const mine = jefCarts(db).list.find((c) => c.id === v.id)!;
    expect(mine).toMatchObject({ kind: "taken", held: true, owner: v.owner, deed: r.deed });
    expect(transportView(db, veloStates(db)).vehicles.find((q) => q.id === v.id)!.gone).toBe(true);
    // taking hold again after letting go: no new deed
    cartAt(db, v.id, mine.x + 1, mine.z, 0, false);
    const again = takeThing(db, { ref: v.id, x: mine.x + 1, z: mine.z }, always);
    expect(again.again).toBe(true);
    expect(again.deed).toBe(r.deed);
    // given back when asked: back to the family
    cartAt(db, v.id, mine.x + 1, mine.z, 0, false);
    loadCart(db, v.id, { kind: "sacks" }, mine.x + 1, mine.z);
    returnThing(db, r.deed!, "gave");
    expect(jefCarts(db).list.some((c) => c.id === v.id)).toBe(false);
    expect(transportView(db, veloStates(db)).vehicles.find((q) => q.id === v.id)!.gone).toBe(false);
    // what he had put on it is left on the ground
    expect(cartView(db).dropped[0].items.map((i) => i.kind)).toEqual(["sacks"]);
    void x;
    void z;
  });

  it("unseen at night: his, the owner finds it gone; the police take it back to the family", () => {
    const db = fresh();
    const { v, x, z } = aCart(db);
    const r = takeThing(db, { ref: v.id, x, z, witnesses: [] }, never);
    expect(r.seen).toBe(false);
    expect(r.text).toMatch(/handcart is yours now/);
    const mem = db.prepare("SELECT text FROM npc_memory WHERE npc_id = ? ORDER BY id DESC LIMIT 1").get(v.owner) as { text: string };
    expect(mem.text).toMatch(/Somebody took my handcart/);
    // too far to take
    expect(() => takeThing(db, { ref: "cart:99999", x, z }, never)).toThrow(/no such handcart/);
    // the police are told; when they settle it, it goes back to the family
    policeRespond(db, r.deed!);
    expect(cartHooks.held(db, deedRow(db, r.deed!)!)).toBe(true);
    cartHooks.home(db, v.id);
    expect(cartHooks.held(db, deedRow(db, r.deed!)!)).toBe(false);
    expect(jefCarts(db).list.some((c) => c.id === v.id)).toBe(false);
  });

  it("Jef's own cart left alone in a busy place is wheeled off, load and all: a robbery on the record; watched or at the wheelwright's it is safe", () => {
    const db = fresh(10);
    const c = ownCart(db);
    setClock(db, 2, 11);
    expect(cartHour(db, always)).toEqual([]); // at the wheelwright's door
    const vis = town(db).town.places.vismarkt;
    const wm = walkMap();
    const q = wm.nearestOpen(vis.x, vis.z, 6)!;
    parkAt(db, c.id, q.x, q.z);
    const job = carryJob(db, { count: 2 });
    loadCart(db, c.id, { kind: "crates", job }, q.x, q.z);
    expect(busyAt(db, q.x, q.z)).toBe(true);
    cartSeen(db, q.x + 2, q.z);
    setClock(db, 2, 12);
    expect(cartHour(db, always)).toEqual([]);
    cartSeen(db, q.x + 200, q.z, Date.now() - 60_000);
    setClock(db, 2, 13);
    expect(cartHour(db, always)).toEqual(["stolen"]);
    expect(jefCarts(db).list).toEqual([]);
    const v = cartView(db);
    expect(v.notice?.text).toMatch(/wheeled it off/);
    expect(v.notice?.text).toMatch(/went with it/);
    const crime = crimeOpen(db);
    expect(crime!.amount_c).toBe(CART_PRICE.used_c);
    expect(resident(db, crime!.thief)!.trade).toBe("thief");
    // no damage: nothing to mend, nothing sold for it
    expect(() => buy(db, WHEELWRIGHT_ID, "handcart_repair" as string)).toThrow(/do not sell/);
  });
});

// ------------------------------------------------------------------ the cart in the street (client rules, with stubs)

/** A stub street: open ground for x in [0, 20], z in [0, 10]; a wall beyond; steps (a step up) at x > 15, z < 3. */
function street(extra: Partial<CartWorld> = {}): CartWorld {
  return {
    free: (x, z, r) => x - r > 0 && x + r < 20 && z - r > 0 && z + r < 10,
    base: (x, z) => (x > 15 && z < 3 ? 0.2 : 0),
    people: () => [],
    ...extra,
  };
}

describe("the cart in the street (cartPhysics.ts, stubs)", () => {
  it("fits on open flat ground; not into a wall, not onto steps, not into a person", () => {
    const w = street();
    expect(cartFits({ px: 5, pz: 5, dir: Math.PI / 2 }, w)).toBe(true);
    // pointing into the wall at x = 20
    expect(cartFits({ px: 17.5, pz: 5, dir: Math.PI / 2 }, w)).toBe(false);
    // the bed over the steps
    expect(cartFits({ px: 13, pz: 1.5, dir: Math.PI / 2 }, street({ free: () => true }))).toBe(false);
    // a person standing where the bed would go
    expect(cartFits({ px: 5, pz: 5, dir: Math.PI / 2 }, street({ people: () => [{ x: 8, z: 5 }] }))).toBe(false);
    // the whole cart is covered: bed and shafts
    expect(footprint({ px: 5, pz: 5, dir: 0 }).length).toBe(11);
  });

  it("never rolls into the water, not even when it was wedged; a wedged cart may be worked free", () => {
    // the quay edge at z = 2: water below it
    const quay = street({ free: (x, z, r) => x - r > 0 && x + r < 20 && z - r > 2 && z + r < 10, water: (_x, z) => z < 2 });
    const from = { px: 8, pz: 5.2, dir: Math.PI };
    expect(cartFits(from, quay)).toBe(false); // the bed hangs over the edge already
    // pushing on toward the water: refused, however wedged it is
    const on = stepCart(from, 8, 4.9, Math.PI, 1 / 60, quay);
    expect(on.moved).toBe(false);
    // backing away from the edge is allowed
    const back = stepCart(from, 8, 5.5, Math.PI, 1 / 60, quay);
    expect(back.moved).toBe(true);
    // wedged against a wall (not water): moves that are no worse are allowed, so he can work it free
    const wall = street();
    const wedged = { px: 17.3, pz: 5, dir: Math.PI / 2 - 0.3 };
    expect(cartFits(wedged, wall)).toBe(false);
    expect(stepCart(wedged, 17.0, 5, Math.PI / 2 - 0.3, 1 / 60, wall).moved).toBe(true);
    // ... but never deeper into the wall, not even sideways along it
    expect(stepCart(wedged, 17.5, 5, Math.PI / 2 - 0.3, 1 / 60, wall).moved).toBe(false);
    const along = stepCart(wedged, 17.3, 5.3, Math.PI / 2 - 0.3, 1 / 60, wall);
    expect(!along.moved || misfit(along, wall) < misfit(wedged, wall)).toBe(true);
  });

  it("a step that does not fit is refused; turning into a wall keeps the old heading", () => {
    const w = street();
    const from = { px: 14.2, pz: 5, dir: Math.PI / 2 };
    expect(cartFits(from, w)).toBe(true);
    // pushing on toward the wall: he stays
    const s = stepCart(from, 17, 5, Math.PI / 2, 1 / 60, w);
    expect(s.moved).toBe(false);
    expect(s.blocked).toBe(true);
    // backing away is fine
    expect(stepCart(from, 13.9, 5, Math.PI / 2, 1 / 60, w).moved).toBe(true);
    // the cart swings round after him, a little each frame
    const t = stepCart({ px: 8, pz: 5, dir: Math.PI / 2 }, 8, 5, 0, 1 / 60, w);
    expect(t.dir).toBeLessThan(Math.PI / 2);
    expect(t.dir).toBeGreaterThan(Math.PI / 2 - 0.1);
  });

  it("vehicles on a round wait for Jef, then go round him on a clear side, and come back to their lane", () => {
    const g = { wait: 0, off: 0, want: 0, gone: 0 };
    // held up, but not yet long: they wait
    for (let t = 0; t < GO_ROUND_AFTER_S - 1; t += 0.1) goRound(g, 0.1, true, () => true, 0);
    expect(g.want).toBe(0);
    for (let t = 0; t < 2; t += 0.1) goRound(g, 0.1, true, (o) => o > 0, 0);
    expect(g.want).toBeGreaterThan(0); // the right side was blocked: the left
    for (let t = 0; t < 5; t += 0.1) goRound(g, 0.1, false, () => true, 0);
    expect(g.off).toBe(g.want);
    // past him and on: back into the lane
    for (let t = 0; t < 20; t += 0.1) goRound(g, 0.1, false, () => true, 0.12);
    expect(g.want).toBe(0);
    expect(g.off).toBe(0);
    // no side clear: it keeps waiting
    const h = { wait: 0, off: 0, want: 0, gone: 0 };
    for (let t = 0; t < 20; t += 0.1) goRound(h, 0.1, true, () => false, 0);
    expect(h.off).toBe(0);
  });
});
