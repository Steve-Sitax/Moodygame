import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { finishJob, takeJob } from "../src/game.ts";
import { tradeLedger, writeLedger } from "../src/trade/ledger.ts";
import { offerRushJobs, RUSH_LOAVES } from "../src/trade/rush.ts";

// T3 trade (docs/milestones/T3-trade.md): a rush job from a shortage: a bakery sold out in the morning, the other with
// bread to spare: a crate of loaves fetched by hand; the loaves leave the one shelf when taken, reach the other when
// brought.

vi.setConfig({ testTimeout: 60_000 });
type Db = ReturnType<typeof blankSave>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const stock = (db: Db, post: string) => tradeLedger(db).stock[post] ?? 0;
const setStock = (db: Db, post: string, n: number) => {
  const l = tradeLedger(db);
  l.stock[post] = n;
  writeLedger(db, l);
};

describe("T3: a rush from a shortage", () => {
  it("a bakery sold out at 8: a rush job for a crate from the other; taken, brought, on its shelf", () => {
    const db = blankSave();
    setClock(db, 2, 8, 5);
    tradeLedger(db);
    setStock(db, "bakery_steen", 3);
    setStock(db, "bakery_rijn", 60);
    const ids = offerRushJobs(db);
    expect(ids.length).toBe(1);
    const row = db.prepare("SELECT employer_npc, task_json, pay_c, title FROM job WHERE id = ?").get(ids[0]) as { employer_npc: string; task_json: string; pay_c: number; title: string };
    const task = JSON.parse(row.task_json) as { from: string; to: string; count: number; limit_s: number | null };
    expect(task.from).toBe("bakery_rijn_door");
    expect(task.to).toBe("bakery_steen_door");
    expect(task.count).toBe(1);
    expect(task.limit_s).toBeGreaterThan(0);
    expect(row.pay_c).toBeGreaterThan(0);
    // one a bakery a day
    expect(offerRushJobs(db).length).toBe(0);
    takeJob(db, ids[0]);
    expect(stock(db, "bakery_rijn")).toBe(60 - RUSH_LOAVES);
    const before = stock(db, "bakery_steen");
    const r = finishJob(db, ids[0], { delivered: 1, lost: 0, sold: 0, pocketed: false, late: false, left_post_s: 0, thief: "none", bribe_taken: false, seen_away: false });
    expect(r.settlement.pay_c).toBe(row.pay_c);
    expect(stock(db, "bakery_steen")).toBe(before + RUSH_LOAVES);
  });

  it("not in the afternoon, not when the other has none to spare, not when the shelf is fine", () => {
    const db = blankSave();
    setClock(db, 2, 14);
    tradeLedger(db);
    setStock(db, "bakery_steen", 2);
    setStock(db, "bakery_rijn", 60);
    expect(offerRushJobs(db).length).toBe(0);
    setClock(db, 2, 8);
    setStock(db, "bakery_rijn", 10);
    expect(offerRushJobs(db).length).toBe(0);
    setStock(db, "bakery_steen", 50);
    setStock(db, "bakery_rijn", 60);
    expect(offerRushJobs(db).length).toBe(0);
  });
});
