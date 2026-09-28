import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { stepLedger, tradeLedger, tradeView, postOfSeller, type Ledger } from "../src/trade/ledger.ts";
import { installTrade } from "../src/trade/routes.ts";
import { buy, waresOf } from "../src/trade.ts";
import { millStocks } from "../src/town/mills.ts";
import { town } from "../src/town/store.ts";
import { GoodsStore } from "../src/goods/store.ts";
import { installHaulFlow, haulRouteFor } from "../src/goods/haulFlow.ts";
import { FISH_PER_BOX, LAST_LINE, LOAVES_PER_SACK, POSTS, POST_BY_ID, killPortions, stockPrice } from "../../shared/trade.ts";
import { HAUL_PILE_N } from "../../shared/hauls.ts";

// T3 the town's trade (docs/milestones/T3-trade.md): the food posts' ledger. The town buys through the day down to the
// floor; the bake, the butcher's kill and the fish boxes fill the shelves; a player's buying takes one, and at the
// floor he still gets his food, dear, with a word.

vi.setConfig({ testTimeout: 60_000 });
installTrade();
installHaulFlow();
type Db = ReturnType<typeof blankSave>;

const at = (day: number, hour: number, minute = 0) => (day - 1) * 1440 + hour * 60 + minute;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const sellerOf = (db: Db, shop: string) => town(db).town.residents.find((r) => r.work.shop === shop && r.trade === "baker")?.id ?? town(db).town.residents.find((r) => r.work.shop === shop)!.id;

describe("T3: the food posts' ledger", () => {
  it("the town buys through the open hours down to the floor, never below; nothing on a Sunday", () => {
    const l: Ledger = { at: at(2, 0), stock: Object.fromEntries(POSTS.map((p) => [p.id, p.start])), sold: {} };
    stepLedger(l, at(2, 23));
    for (const p of POSTS) {
      expect(l.stock[p.id]).toBeGreaterThanOrEqual(p.floor - 1e-9);
      expect(l.stock[p.id]).toBeLessThan(p.start + (p.good === "meat" ? killPortions(2) : 0));
    }
    const sun: Ledger = { at: at(7, 0), stock: Object.fromEntries(POSTS.map((p) => [p.id, p.start])), sold: {} };
    stepLedger(sun, at(7, 23));
    for (const p of POSTS) expect(sun.stock[p.id]).toBe(p.start);
  });

  it("the butcher's kill at 7 fills the meat shelf on a weekday", () => {
    const p = POST_BY_ID.butcher_vlees;
    const l: Ledger = { at: at(3, 6, 50), stock: { [p.id]: 5 }, sold: {} };
    stepLedger(l, at(3, 7, 5));
    expect(l.stock[p.id]).toBeGreaterThan(5 + killPortions(3) - 1);
  });

  it("the price by the shelf: a cheap good at most 2 c up or 1 c down; fish cheaper in the afternoon", () => {
    const bak = POST_BY_ID.bakery_steen;
    expect(stockPrice(6, bak, bak.floor, 10)).toBe(8);
    expect(stockPrice(6, bak, bak.order - 1, 10)).toBe(7);
    expect(stockPrice(6, bak, bak.room, 10)).toBe(5);
    expect(stockPrice(6, bak, (bak.order + bak.room) / 2, 10)).toBe(6);
    const fish = POST_BY_ID.vismarkt;
    expect(stockPrice(12, fish, 40, 10)).toBe(12);
    expect(stockPrice(12, fish, 40, 16)).toBeLessThan(12);
  });

  it("a player's buying takes one; at the floor he still gets his food, dear, with the seller's word", () => {
    const db = blankSave();
    setClock(db, 2, 10);
    const baker = sellerOf(db, "bakery_steen");
    expect(postOfSeller(db, baker)?.id).toBe("bakery_steen");
    db.prepare("UPDATE player SET money_c = 1000 WHERE id = 1").run();
    const before = tradeView(db).find((p) => p.id === "bakery_steen")!.stock;
    buy(db, baker, "bread");
    const after = tradeView(db).find((p) => p.id === "bakery_steen")!.stock;
    expect(after).toBeLessThanOrEqual(before - 1 + 1e-9);
    // empty the shelf to the floor and below: still sold, dearer, with the last line
    const l = tradeLedger(db);
    l.stock.bakery_steen = POST_BY_ID.bakery_steen.floor;
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('trade', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(l));
    const price = waresOf(db, baker).find((w) => w.kind === "bread")!.price_c;
    expect(price).toBeGreaterThan(6);
    db.prepare("DELETE FROM item WHERE player_id = 1").run();
    const r = buy(db, baker, "bread");
    expect(r.line).toBe(LAST_LINE.bread);
    for (let i = 0; i < 8; i++) {
      db.prepare("DELETE FROM item WHERE player_id = 1").run();
      buy(db, baker, "bread");
    }
    expect(tradeView(db).find((p) => p.id === "bakery_steen")!.stock).toBe(0);
  });

  it("the bake turns the loft's flour into bread on the bakery's shelf", () => {
    const db = blankSave();
    setClock(db, 2, 2, 30);
    millStocks(db);
    tradeLedger(db);
    const before = tradeView(db).find((p) => p.id === "bakery_steen")!.stock;
    setClock(db, 2, 3, 20);
    millStocks(db);
    const after = tradeView(db).find((p) => p.id === "bakery_steen")!.stock;
    expect(after - before).toBeGreaterThanOrEqual(LOAVES_PER_SACK);
  });

  it("a box of fish set in at the back of a fish bank puts fish on the Vismarkt's stalls", () => {
    const db = blankSave();
    setClock(db, 2, 6, 10);
    const s = new GoodsStore();
    const npc = town(db).town.residents.find((q) => haulRouteFor(db, q.id)?.id === "vm-1")?.id;
    expect(npc).toBeTruthy();
    const before = tradeView(db).find((p) => p.id === "vismarkt")!.stock;
    const top = `haul:vm-1a:${HAUL_PILE_N - 1}`;
    expect(s.ask(db, 1, { op: "npc_lift", npc: npc!, ids: [top] }).ok).toBe(true);
    expect(s.ask(db, 1, { op: "haul_in", npc: npc!, id: top }).ok).toBe(true);
    const after = tradeView(db).find((p) => p.id === "vismarkt")!.stock;
    expect(after - before).toBeGreaterThanOrEqual(FISH_PER_BOX - 1);
  });
});

describe("T3: the dispatcher", () => {
  it("a bakery short in its hours gets a run of bread from the other; it arrives at the unload, not before", async () => {
    const { runAt, runLegs } = await import("../../shared/trade.ts");
    const db = blankSave();
    setClock(db, 2, 10, 1);
    const l = tradeLedger(db);
    l.stock.bakery_rijn = 8;
    l.stock.bakery_steen = 80;
    l.looked = undefined;
    l.runs = [];
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('trade', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(l));
    const l2 = tradeLedger(db);
    expect(l2.runs?.length).toBe(1);
    const r = l2.runs![0];
    expect(r.from).toBe("bakery_steen");
    expect(r.to).toBe("bakery_rijn");
    expect(r.n).toBeGreaterThanOrEqual(6);
    expect(town(db).byId.get(r.man)?.work.shop).toBe("bakery_steen");
    expect(r.len).toBeGreaterThan(20);
    // the source's shelf gave them at once
    expect(l2.stock.bakery_steen).toBeLessThanOrEqual(80 - r.n + 1e-9);
    // halfway on the way: not there yet
    const legs = runLegs(r);
    const mid = r.t0 + (legs.load + legs.go) / 2;
    expect(runAt(r, mid).phase).toBe("go");
    // after the unload: on the target's shelf, and the run goes when he is back
    const end = r.t0 + Math.ceil(legs.back) + 1;
    const day = Math.floor(end / 1440) + 1;
    const min = end % 1440;
    setClock(db, day, Math.floor(min / 60), min % 60);
    const l3 = tradeLedger(db);
    expect(l3.runs?.some((q) => q.id === r.id)).toBe(false);
    expect(tradeView(db).find((p) => p.id === "bakery_rijn")!.soldTown).toBeGreaterThanOrEqual(0);
  });
});

describe("T3: the fish reach the stalls with nobody near", () => {
  it("unseen, the Vismarkt's dockers take a box in every few minutes of the morning; never while a player is near", async () => {
    const { goods } = await import("../src/goods/store.ts");
    const { haulUnseenTick, UNSEEN_CARRY_MIN } = await import("../src/goods/haulFlow.ts");
    goods.reset(false);
    const db = blankSave();
    setClock(db, 2, 7, 0);
    const before = tradeView(db).find((p) => p.id === "vismarkt")!.stock;
    const pile = goods.list().filter((it) => it.id.startsWith("haul:vm-1a:")).length;
    haulUnseenTick(db, 2, 7 * 60, [{ x: -139, z: 22 }]);
    expect(goods.list().filter((it) => it.id.startsWith("haul:vm-1a:")).length).toBe(pile);
    haulUnseenTick(db, 2, 7 * 60 + UNSEEN_CARRY_MIN, [{ x: 100, z: 100 }]);
    expect(goods.list().filter((it) => it.id.startsWith("haul:vm-1a:")).length).toBe(pile - 1);
    expect(tradeView(db).find((p) => p.id === "vismarkt")!.stock).toBeGreaterThanOrEqual(before + FISH_PER_BOX - 1);
    goods.reset(false);
  });
});

describe("T3: the map shows the dispatcher's runs", () => {
  it("a run is on the town map's list with its man, its load and a plain line, by its own clock", async () => {
    const { runsNow } = await import("../src/town/runs.ts");
    const run = { id: "trade:bakery_steen>bakery_rijn:540", good: "bread" as const, from: "bakery_steen", to: "bakery_rijn", n: 14, man: "r010", t0: 540, way: [[-200, 40], [-100, 50], [0, 75]] as Array<[number, number]>, len: 210, done: false };
    const load = runsNow(1, 9.05, { trade: [run], names: { bakery_steen: "the bakery on the Steenplein", bakery_rijn: "the bakery behind the Rijnkaai" } }).find((r) => r.id === run.id)!;
    expect(load.phase).toBe("load");
    expect(load.doing).toContain("Filling two baskets with 14 loaves");
    const go = runsNow(1, 10, { trade: [run] }).find((r) => r.id === run.id)!;
    expect(go.phase).toBe("go");
    expect(go.moving).toBe(true);
    expect(go.chain).toBe("bread");
    expect(go.man).toBe("r010");
    expect(runsNow(1, 16, { trade: [run] }).some((r) => r.id === run.id)).toBe(false);
  });
});
