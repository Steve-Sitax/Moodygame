import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { tradeLedger, tradeView, onMillEvents } from "../src/trade/ledger.ts";
import { installTrade } from "../src/trade/routes.ts";
import { town } from "../src/town/store.ts";
import { MILLS } from "../../shared/mills.ts";
import { LOAVES_PER_SACK, POST_BY_ID } from "../../shared/trade.ts";

// T5 beer and coal (docs/trade-plan.md chains 5 and 6; docs/milestones/T5-beer-coal.md): the taverns pour pints and a
// tavern short of beer gets kegs from the brewery; the bakeries' ovens burn coal at the bake, a cold oven bakes short,
// and the coal comes from the barge's yard with the coalman.

vi.setConfig({ testTimeout: 60_000 });
installTrade();
type Db = ReturnType<typeof blankSave>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const save = (db: Db, l: ReturnType<typeof tradeLedger>) =>
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('trade', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(l));

describe("T5: beer", () => {
  it("a tavern short of beer gets kegs from the brewery, carried by a working man of the canal", () => {
    const db = blankSave();
    setClock(db, 2, 11, 1);
    const l = tradeLedger(db);
    l.stock["tavern:ankere"] = 30;
    l.runs = [];
    l.looked = undefined;
    save(db, l);
    const l2 = tradeLedger(db);
    const run = l2.runs?.find((r) => r.to === "tavern:ankere");
    expect(run?.from).toBe("brewery");
    expect(run?.good).toBe("beer");
    expect(run!.n).toBeGreaterThanOrEqual(60);
    expect(town(db).byId.get(run!.man)?.work.place).toBe("canal");
  });

  it("the taverns pour into the night: open after midnight, shut at two", async () => {
    const { postOpen } = await import("../../shared/trade.ts");
    const t = POST_BY_ID["tavern:vliet"];
    expect(postOpen(t, 2, 23)).toBe(true);
    expect(postOpen(t, 2, 1)).toBe(true);
    expect(postOpen(t, 2, 3)).toBe(false);
    expect(postOpen(t, 2, 8)).toBe(false);
  });
});

describe("T5: coal", () => {
  it("a cold oven bakes short: half the coal, half the bread; none, no bread", () => {
    const db = blankSave();
    setClock(db, 2, 3, 5);
    const m = MILLS[0];
    const oven = `${m.bakery}:coal`;
    const l = tradeLedger(db);
    l.stock[oven] = 1;
    l.stock[m.bakery] = 10;
    save(db, l);
    const before = tradeView(db).find((p) => p.id === m.bakery)!.stock;
    onMillEvents(db, [{ at: 1440 + 3 * 60, mill: m.id, what: "bake", n: 3 }]);
    const after = tradeView(db).find((p) => p.id === m.bakery)!.stock;
    expect(after - before).toBe(Math.round(3 * LOAVES_PER_SACK * 0.5));
    onMillEvents(db, [{ at: 2 * 1440 + 3 * 60, mill: m.id, what: "bake", n: 3 }]);
    expect(tradeView(db).find((p) => p.id === m.bakery)!.stock).toBe(after);
  });

  it("an oven short of coal gets baskets from the coal yard with the coalman or a man of the canal", () => {
    const db = blankSave();
    setClock(db, 2, 9, 1);
    const l = tradeLedger(db);
    l.stock["bakery_steen:coal"] = 1;
    l.runs = [];
    l.looked = undefined;
    save(db, l);
    const run = tradeLedger(db).runs?.find((r) => r.to === "bakery_steen:coal");
    expect(run?.from).toBe("coalyard");
    expect(run?.good).toBe("coal");
    const man = town(db).byId.get(run!.man)!;
    expect(man.trade === "coalman" || man.work.place === "canal").toBe(true);
  });
});
