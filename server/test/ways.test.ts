import { describe, expect, it } from "vitest";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { planWays, serverWay, wayBetween } from "../src/town/ways.ts";
import { pointAlong, wayLength } from "../src/town/wayfind.ts";
import { planLegs, UNSEEN_M_PER_MIN, whereAt } from "../src/town/whereabouts.ts";
import { blankSave } from "./blank-save.ts";

// The trade plan, part A (docs/trade-plan.md): ways on foot over the walk map, and the sum that puts a person
// nobody sees on one of them by the clock.

/** Every 0.25 m of a way stands on ground a body can walk to. */
function onFoot(pts: Array<[number, number]>): boolean {
  const w = walkMap();
  const len = wayLength(pts);
  for (let d = 0; d <= len; d += 0.25) {
    const p = pointAlong(pts, d);
    if (!w.reachable(p.x, p.z)) return false;
  }
  return true;
}

describe("ways on foot", () => {
  it("go round the houses, never through them or the water", () => {
    // the Rijnkaai to the Steenplein bakery, the back-lane bakery to the hatter, the start to the Sint-Jorispoort
    for (const [a, b, c, d] of [
      [10, 12, -200, 40],
      [10, 72, -304, 93],
      [10, 12, -355, 247],
    ]) {
      const w = wayBetween(a, b, c, d);
      expect(w).toBeTruthy();
      expect(onFoot(w!)).toBe(true);
      expect(wayLength(w!)).toBeGreaterThanOrEqual(Math.hypot(c - a, d - b) - 2);
    }
  });

  it("every way of the town's day plans is found and walkable", () => {
    const tw = town(blankSave()).town;
    const ways = planWays(tw);
    const legs = tw.residents.reduce((n, r) => n + planLegs(r, tw).length, 0);
    const keys = Object.keys(ways);
    expect(keys.length).toBeGreaterThan(100);
    // (a leg whose two ends round to one key shares a way; a few ends may be off the walkable town)
    expect(keys.length).toBeGreaterThan(legs * 0.5);
    const bad = keys.filter((k) => !onFoot(ways[k]));
    expect(bad).toEqual([]);
  });
});

describe("where a person is (the sum)", () => {
  const tw = town(blankSave()).town;
  const worker = tw.residents.find((q) => q.work.place !== "home" && q.work.kind !== "inside" && q.sched.day.some((s) => s[2] === "work" && s[0] >= 5 && s[0] <= 9))!;

  it("walks from his door to work along the way, then stands at work", () => {
    expect(worker).toBeTruthy();
    const seg = worker.sched.day.find((s) => s[2] === "work")!;
    const start = seg[0];
    const at0 = whereAt(worker, tw, 2, start + 0.001, serverWay);
    expect(at0.act).toBe("work");
    expect(Math.hypot(at0.x - worker.home.sx, at0.z - worker.home.sz)).toBeLessThan(2);
    // a little later: on the way, in the street, on walkable ground
    const t = Math.min(0.3, at0.total / UNSEEN_M_PER_MIN / 60 / 2);
    const mid = whereAt(worker, tw, 2, start + t, serverWay);
    if (mid.total > 5) {
      expect(mid.moving).toBe(true);
      expect(mid.indoor).toBe(false);
      expect(walkMap().reachable(mid.x, mid.z) || Math.hypot(mid.x - mid.from.x, mid.z - mid.from.z) < 3).toBe(true);
      expect(mid.walked).toBeCloseTo(t * 60 * UNSEEN_M_PER_MIN, 3);
    }
    // long after: at work, not moving (a round keeps moving)
    const late = whereAt(worker, tw, 2, start + (seg[1] - seg[0]) * 0.9, serverWay);
    expect(late.walked).toBe(late.total);
    if (!late.to.route) expect([late.x, late.z]).toEqual([late.to.x, late.to.z]);
  });

  it("is the same sum for the same clock (a pure function)", () => {
    for (const r of tw.residents.slice(0, 40)) {
      for (const h of [4, 7.3, 12.9, 18.25, 23.5]) {
        const a = whereAt(r, tw, 3, h, serverWay);
        const b = whereAt(JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify({ places: tw.places, stalls: tw.stalls, shops: tw.shops })), 3, h, serverWay);
        expect([b.x, b.z, b.indoor, b.moving]).toEqual([a.x, a.z, a.indoor, a.moving]);
      }
    }
  });

  it("at home in the night: indoors at the step before his door", () => {
    for (const r of tw.residents.filter((q) => q.sched.day.some((s) => s[2] === "home" && s[0] <= 3 && s[1] > 3)).slice(0, 20)) {
      const w = whereAt(r, tw, 2, 3, serverWay);
      if (w.moving) continue; // (came home late: still on the way)
      expect(w.indoor).toBe(true);
      expect([w.x, w.z]).toEqual([r.home.sx, r.home.sz]);
    }
  });
});
