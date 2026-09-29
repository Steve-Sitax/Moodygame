import { describe, expect, it, vi } from "vitest";
import { blankSave } from "./blank-save.ts";
import { droveOf } from "../src/trade/drove.ts";
import { postDoor } from "../src/trade/ledger.ts";
import { runsNow } from "../src/town/runs.ts";
import { wayReachable } from "../src/town/ways.ts";
import { DROVE_GATE, DROVE_IN_MIN, droveAt, droveLine } from "../../shared/drove.ts";
import { KILL_AT } from "../../shared/trade.ts";

// T3 chain 3 in the open (shared/drove.ts): a farmer drives his pigs in from the Kipdorp gate to the butcher's door
// at dawn on weekdays, in before the kill at 7, and walks back out.

vi.setConfig({ testTimeout: 60_000 });

describe("T3 chain 3: the drove of pigs", () => {
  const db = blankSave();

  it("on a weekday: two to four pigs, a way on foot from the gate to the butcher's door", () => {
    const d = droveOf(db, 2)!;
    expect(d).toBeTruthy();
    expect(d.pigs.length).toBeGreaterThanOrEqual(2);
    expect(d.pigs.length).toBeLessThanOrEqual(4);
    const [ax, az] = d.way[0];
    expect(Math.hypot(ax - DROVE_GATE[0], az - DROVE_GATE[1])).toBeLessThan(3);
    const door = postDoor(db, "butcher_vlees")!;
    const [bx, bz] = d.way[d.way.length - 1];
    expect(Math.hypot(bx - door[0], bz - door[1])).toBeLessThan(3);
    expect(d.len).toBeGreaterThan(100);
    expect(wayReachable(ax, az) && wayReachable(bx, bz)).toBe(true);
  });

  it("none on Sunday", () => {
    expect(droveOf(db, 7)).toBeNull();
    expect(droveOf(db, 14)).toBeNull();
  });

  it("the pigs are in before the kill at 7, and the farmer back out by the morning", () => {
    const d = droveOf(db, 3)!;
    const at = (h: number) => droveAt(d, (d.day - 1) * 1440 + h * 60);
    expect(at(3.5).phase).toBe("before");
    expect(at(5).phase).toBe("go");
    // in at the door before the kill
    let inAt = -1;
    for (let m = 4 * 60; m < 9 * 60; m++) {
      if (droveAt(d, (d.day - 1) * 1440 + m).phase === "in") {
        inAt = m;
        break;
      }
    }
    expect(inAt).toBeGreaterThan(0);
    expect(inAt + DROVE_IN_MIN).toBeLessThanOrEqual(KILL_AT * 60);
    expect(at(10).phase).toBe("over");
  });

  it("the line: the first pig at the door when they get there, the farmer behind the last", () => {
    const d = droveOf(db, 2)!;
    const end = droveLine(d, 1);
    expect(end.pigs[0]).toBeCloseTo(d.len, 5);
    for (let i = 1; i < d.pigs.length; i++) expect(end.pigs[i]).toBeLessThan(end.pigs[i - 1]);
    expect(end.man).toBeLessThan(end.pigs[d.pigs.length - 1]);
    const start = droveLine(d, 0);
    expect(start.man).toBeGreaterThanOrEqual(0);
  });

  it("on the town map's runs list while out", () => {
    const d = droveOf(db, 2)!;
    const runs = runsNow(2, 5.2, { drove: d });
    const r = runs.find((q) => q.chain === "animals");
    expect(r).toBeTruthy();
    expect(r!.doing).toMatch(/pigs/);
    expect(runsNow(2, 12, { drove: d }).find((q) => q.chain === "animals")).toBeUndefined();
  });
});
