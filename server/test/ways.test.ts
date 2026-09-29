import { describe, expect, it } from "vitest";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { planWays, serverWay, wayBetween, wayReachable } from "../src/town/ways.ts";
import { pointAlong, wayLength } from "../src/town/wayfind.ts";
import { paceOf, planLegs, WALK_MAX_M_PER_MIN, whereAt } from "../src/town/whereabouts.ts";
import { blankSave } from "./blank-save.ts";

// The trade plan, part A (docs/trade-plan.md): ways on foot over the walk map, and the sum that puts a person
// nobody sees on one of them by the clock.

/** Every 0.25 m of a way stands on ground a body can walk to (the opening bridges included: ways.ts). */
function onFoot(pts: Array<[number, number]>): boolean {
  const len = wayLength(pts);
  for (let d = 0; d <= len; d += 0.25) {
    const p = pointAlong(pts, d);
    if (!wayReachable(p.x, p.z)) return false;
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
  // one who keeps his work at its hour (a far, slow walker may have to skip a short shift: dayRoute)
  const worker = tw.residents.find((q) => {
    if (q.work.place === "home" || q.work.kind === "inside" || q.work.kind === "haul") return false;
    const seg = q.sched.day.find((s) => s[2] === "work" && s[0] >= 5 && s[0] <= 9 && s[1] - s[0] >= 3);
    if (!seg) return false;
    const w = whereAt(q, tw, 2, seg[0] + 0.001, serverWay);
    return w.act === "work" && w.total > 60;
  })!;

  it("sets off early enough to be at work at its hour, walking the way at his own pace (Steve 2026-09-27)", () => {
    expect(worker).toBeTruthy();
    const seg = worker.sched.day.find((s) => s[2] === "work" && s[0] >= 5 && s[0] <= 9 && s[1] - s[0] >= 3)!;
    const start = seg[0];
    // at the hour he is there (or on his round there)
    const at = whereAt(worker, tw, 2, start + 0.001, serverWay);
    expect(at.act).toBe("work");
    expect(at.walked).toBe(at.total);
    if (at.total > 20) {
      // a little before the hour: on the way, in the street, on walkable ground
      const mid = whereAt(worker, tw, 2, start - 0.05, serverWay);
      expect(mid.act).toBe("work");
      expect(mid.moving).toBe(true);
      expect(mid.indoor).toBe(false);
      expect(mid.walked).toBeLessThan(mid.total);
      expect(walkMap().reachable(mid.x, mid.z)).toBe(true);
      expect(mid.mps).toBeGreaterThan(0.8);
    }
    // long after: at work, not moving (a round keeps moving)
    const late = whereAt(worker, tw, 2, start + (seg[1] - seg[0]) * 0.5, serverWay);
    expect(late.walked).toBe(late.total);
    if (!late.to.route) expect([late.x, late.z]).toEqual([late.to.x, late.to.z]);
  });

  it("paces: a load does not slow them; children and the young sometimes run, the old never; the old walk slower", () => {
    const kid = { id: "k", age: 9, sex: "m" };
    const lad = { id: "l", age: 20, sex: "m" };
    const old = { id: "o", age: 70, sex: "f" };
    const runs = (r: typeof kid) => Array.from({ length: 400 }, (_, i) => paceOf(r, `leg${i}`)).filter((p) => p.run).length;
    expect(runs(kid)).toBeGreaterThan(120);
    expect(runs(lad)).toBeGreaterThan(70);
    expect(runs(old)).toBe(0);
    expect(paceOf(old).mps).toBeLessThan(paceOf(lad).mps);
    expect(paceOf(lad, "x")).toEqual(paceOf(lad, "x"));
  });

  it("is the same sum for the same clock (a pure function)", () => {
    for (const r of tw.residents.slice(0, 40)) {
      for (const h of [4, 7.3, 12.9, 18.25, 23.5]) {
        const a = whereAt(r, tw, 3, h, serverWay);
        // Shared haul spacing also depends on the crew roster; preserve every input when cloning.
        const b = whereAt(JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify({ residents: tw.residents, places: tw.places, stalls: tw.stalls, shops: tw.shops })), 3, h, serverWay);
        expect([b.x, b.z, b.indoor, b.moving]).toEqual([a.x, a.z, a.indoor, a.moving]);
      }
    }
  });

  it("out in the street he is always on walkable ground: rounds follow the streets too, at a walk (Steve 2026-09-27)", () => {
    const off: string[] = [];
    let fast = 0;
    for (const r of tw.residents) {
      for (let h = 0; h < 24; h += 0.25) {
        const w = whereAt(r, tw, 2, h, serverWay);
        if (w.indoor) continue;
        const atEnd = Math.hypot(w.x - w.to.x, w.z - w.to.z) < 1 || Math.hypot(w.x - w.from.x, w.z - w.from.z) < 1;
        if (!wayReachable(w.x, w.z) && !atEnd) off.push(`${r.id} ${r.work.kind} ${h}`);
        // on a round, a game minute later he is a walk further on, never a run
        if (w.leg !== undefined && w.walked >= w.total) {
          const w2 = whereAt(r, tw, 2, h + 1 / 60, serverWay);
          if (w2.leg !== undefined && Math.hypot(w2.x - w.x, w2.z - w.z) > WALK_MAX_M_PER_MIN + 0.5) fast++;
        }
      }
    }
    expect(off).toEqual([]);
    expect(fast).toBe(0);
  });

  it("every walk of every plan has a way on foot (a place in a block is walked to its edge; a tavern's `out` is a direction)", () => {
    const bad: string[] = [];
    for (const r of tw.residents)
      for (const [a, b] of planLegs(r, tw)) if (!wayBetween(a.x, a.z, b.x, b.z)) bad.push(`${r.id} ${r.trade} (${a.x.toFixed(0)},${a.z.toFixed(0)})>(${b.x.toFixed(0)},${b.z.toFixed(0)})`);
    // (known: the back town's children's play places up on the town wall by the Kipdorp mill: the stairs up are not
    // in the walk map (the game walks them up itself: client game/backlife.ts); there he is simply there, no line)
    expect(bad.filter((s) => !/>\(-(9[0-9]|10[0-9]),3[78][0-9]\)$/.test(s))).toEqual([]);
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
