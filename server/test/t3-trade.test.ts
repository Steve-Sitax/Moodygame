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
