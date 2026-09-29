import { describe, expect, it } from "vitest";
import { MILLS, runsOf } from "../../shared/mills.ts";
import { CART_RUNS } from "../../shared/goods.ts";
import { Lags } from "../src/town/lags.ts";
import { runsNow } from "../src/town/runs.ts";
import { town } from "../src/town/store.ts";
import { serverWay, wayReachable } from "../src/town/ways.ts";
import { pointAlong, wayLength } from "../src/town/wayfind.ts";
import { LAG_MAX_H, projectOn, reportLag, settleLag, whereAt, whereLate } from "../src/town/whereabouts.ts";
import { MILL_PEOPLE } from "../src/town/mills.ts";
import { doingLine } from "../src/mapview/doing.ts";
import { blankSave } from "./blank-save.ts";

// The trade plan's T1 and T2 (docs/trade-plan.md part A, 2026-09-28): the runs of the town's trade by the clock, the
// progress reports (a man held up in view is late from then on, not ahead), and the town map's line of what each
// townsperson is doing.

const men = Object.fromEntries(Object.entries(MILL_PEOPLE).map(([m, [, man]]) => [m, man]));

describe("the runs of the town's trade", () => {
  it("the mills' carts are out at their hours, on their way, with their load", () => {
    for (const m of MILLS) {
      const [flour, grain] = runsOf(m, 2);
      const go = flour.phases.find((p) => p.phase === "go")!;
      const mid = (go.from + go.to) / 2;
      const r = runsNow(2, mid, { men }).find((q) => q.id === `${m.id}:flour`)!;
      expect(r).toBeTruthy();
      expect(r.moving).toBe(true);
      expect(r.load).toBe(3);
      expect(r.man).toBe(men[m.id]);
      expect(r.doing).toMatch(/^Taking 3 sacks of flour from .+ to the bakery .+\(\d+ m to go\)$/);
      // half way along its way, give or take a step
      const route = m.routes.bakery as Array<[number, number]>;
      expect(Math.abs(r.left - wayLength(route) / 2)).toBeLessThan(3);
      // the rest of the way starts where the cart is
      expect(r.way![0]).toEqual([r.x, r.z]);
      // the grain run: out empty, back loaded
      const gb = grain.phases.find((p) => p.phase === "back")!;
      const back = runsNow(2, (gb.from + gb.to) / 2, { men }).find((q) => q.id === `${m.id}:grain`)!;
      expect(back.load).toBe(3);
      expect(back.doing).toMatch(/^Taking 3 sacks of grain from /);
    }
  });

  it("the engine's count of the sacks is the load when given", () => {
    const m = MILLS[0];
    const go = runsOf(m, 3)[0].phases.find((p) => p.phase === "go")!;
    const r = runsNow(3, go.from + 0.01, { men, sacks: { [m.id]: 1 } }).find((q) => q.id === `${m.id}:flour`)!;
    expect(r.load).toBe(1);
    expect(r.doing).toMatch(/Taking 1 sack of flour/);
  });

  it("no cart is out on Sunday or at night", () => {
    expect(runsNow(7, 10, { men })).toEqual([]);
    expect(runsNow(2, 2, { men })).toEqual([]);
  });

  it("the quay's carts go their round on weekdays, loaded on the way out and back", () => {
    for (const c of CART_RUNS) {
      const deliver = runsNow(2, (c.out + 9) / 60).find((q) => q.id === `cart:${c.id}`)!;
      expect(deliver).toBeTruthy();
      expect(deliver.load).toBe(c.items.length);
      // (between the loaded legs it waits at the berth with nothing on)
      const waiting = runsNow(2, (c.down + c.back) / 2 / 60).find((q) => q.id === `cart:${c.id}`)!;
      expect(waiting.moving).toBe(false);
      expect(waiting.load).toBe(0);
    }
  });

  it("every run's point stands on ground a body reaches", () => {
    const bad: string[] = [];
    for (let h = 4; h < 19; h += 0.05) {
      for (const r of runsNow(2, h, { men })) if (!wayReachable(r.x, r.z)) bad.push(`${r.id} ${h.toFixed(2)} ${r.x.toFixed(1)},${r.z.toFixed(1)}`);
    }
    expect(bad).toEqual([]);
  });

  it("the mill's man is where his cart is (the sum of whereabouts.ts and the run agree)", () => {
    const tw = town(blankSave()).town;
    for (const m of MILLS) {
      const man = tw.residents.find((q) => q.id === men[m.id])!;
      const go = runsOf(m, 2)[0].phases.find((p) => p.phase === "go")!;
      const h = go.from + (go.to - go.from) * 0.3;
      const w = whereAt(man, tw, 2, h, serverWay);
      const r = runsNow(2, h, { men }).find((q) => q.man === man.id)!;
      expect(w.cart?.mill).toBe(m.id);
      expect(Math.hypot(w.x - r.x, w.z - r.z)).toBeLessThan(0.01);
    }
  });
});

describe("progress reports (late, never ahead)", () => {
  const tw = town(blankSave()).town;
  // a walker on a long way to work on Tuesday
  const pick = () => {
    for (const q of tw.residents) {
      if (q.trade === "miller_man" || q.trade === "miller") continue;
      for (let h = 5; h < 10; h += 0.05) {
        const w = whereAt(q, tw, 2, h, serverWay);
        if (w.moving && w.leg === undefined && w.way && w.total > 150 && w.walked > 60 && w.walked < w.total - 60) return { r: q, h, w };
      }
    }
    return null;
  };
  const got = pick()!;

  it("a man held up behind the sum is late by the time the missing metres take", () => {
    expect(got).toBeTruthy();
    const { r, h, w } = got;
    // he is 20 m back along his way
    const at = pointAlong(w.way!, w.walked - 20);
    const lag = reportLag(r, tw, 2, h, serverWay, 0, at.x, at.z);
    expect(lag).toBeGreaterThan(0);
    const late = whereLate(r, tw, 2, h, serverWay, lag);
    expect(Math.abs(late.walked - (w.walked - 20))).toBeLessThan(0.5);
  });

  it("never ahead of the plain sum, never past the most", () => {
    const { r, h, w } = got;
    const ahead = pointAlong(w.way!, Math.min(w.total, w.walked + 30));
    expect(reportLag(r, tw, 2, h, serverWay, 0, ahead.x, ahead.z)).toBe(0);
    const far = pointAlong(w.way!, 0);
    expect(reportLag(r, tw, 2, h, serverWay, LAG_MAX_H, far.x, far.z)).toBeLessThanOrEqual(LAG_MAX_H);
  });

  it("off the way (a detour of the crowd's own) the lag stays as it was", () => {
    const { r, h, w } = got;
    const p = pointAlong(w.way!, w.walked);
    expect(reportLag(r, tw, 2, h, serverWay, 0.05, p.x + 40, p.z + 40)).toBe(0.05);
  });

  it("the lag goes once he is at a place of his day on time again", () => {
    const { r, h } = got;
    // hours later, at work, the plain sum and the late one agree: let go
    expect(settleLag(r, tw, 2, h + 3, serverWay, 0.1)).toBe(0);
    // still on his way late: kept
    expect(settleLag(r, tw, 2, h, serverWay, 0.1)).toBe(0.1);
  });

  it("an hour behind (after a jump of the clock) he goes by the plain sum again, not late all day", () => {
    const { r, h } = got;
    // M7 sweep 2026-09-29: a lag clamped at the most was never "past" it and stayed for good
    expect(settleLag(r, tw, 2, h, serverWay, LAG_MAX_H)).toBe(0);
  });

  it("the server forgets every lag after a jump of the clock (sleep, a skip)", () => {
    const L = new Lags();
    const { r, h } = got;
    L.sweep(tw as never, 2, h, serverWay);
    L.report(r.id, 0.2, 24 + h);
    expect(L.get(r.id)).toBeGreaterThan(0);
    L.sweep(tw as never, 2, h + 8, serverWay);
    expect(L.get(r.id)).toBe(0);
  });

  it("the server clamps what a PC reports", () => {
    const L = new Lags();
    // a first report: a quarter of the most at once
    expect(L.report("r001", 5, 10)).toBeCloseTo(LAG_MAX_H / 4);
    // no faster than the clock ran since (plus a little)
    expect(L.report("r001", 0.9, 10.1)).toBeCloseTo(LAG_MAX_H / 4 + 0.1 + 0.05);
    // shrinking is always fine; 0 lets go
    expect(L.report("r001", 0.1, 10.2)).toBeCloseTo(0.1);
    expect(L.report("r001", 0, 10.3)).toBe(0);
    expect(L.size).toBe(0);
    // junk is refused
    expect(L.report("../x", 0.5, 10)).toBe(0);
    expect(L.report("r002", Number.NaN, 10)).toBe(0);
  });

  it("projectOn finds the metres along a way", () => {
    const p = projectOn([[0, 0], [10, 0], [10, 10]], 10.5, 4);
    expect(p.s).toBeCloseTo(14);
    expect(p.off).toBeCloseTo(0.5);
  });
});

describe("what a townsperson is doing (the town map's line)", () => {
  const tw = town(blankSave()).town;
  it("everyone has a plain line at any hour, with no pronouns guessed wrong and no ids", () => {
    const bad: string[] = [];
    for (const h of [3, 7.5, 12, 18.25, 23]) {
      const runs = runsNow(2, h, { men });
      for (const r of tw.residents) {
        const w = whereAt(r, tw, 2, h, serverWay);
        const run = w.cart ? (runs.find((q) => q.man === r.id) ?? null) : null;
        const d = doingLine(r, tw, w, h, run);
        if (!d || d.length < 5 || /undefined|NaN|\br\d{3}\b|_/.test(d)) bad.push(`${r.id} ${h}: ${d}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("says asleep at home at night, walking with metres to go on the way", () => {
    const r = tw.residents.find((q) => whereAt(q, tw, 2, 3, serverWay).act === "home")!;
    expect(doingLine(r, tw, whereAt(r, tw, 2, 3, serverWay), 3, null)).toBe("Asleep at home");
    const g = (() => {
      for (const q of tw.residents) for (let h = 6; h < 9; h += 0.1) {
        const w = whereAt(q, tw, 2, h, serverWay);
        if (w.moving && w.leg === undefined && w.total - w.walked > 20 && !w.cart) return { q, w, h };
      }
      return null;
    })()!;
    expect(doingLine(g.q, tw, g.w, g.h, null)).toMatch(/^(Walking|Running) to .+ \(\d+ m to go\)$/);
  });
});

describe("no crowd on one pile (Steve 2026-09-28: \"not bunching like 100 people in one job spot/pile\")", () => {
  it("the men of a round spread along it: never more than three within 1.5 m of each other (a short route of seven men)", () => {
    const tw = town(blankSave()).town;
    const bad: string[] = [];
    for (const h of [8, 10.5, 13, 15.75]) {
      const routes = new Map<string, Array<[number, number]>>();
      for (const r of tw.residents) {
        if (r.work.kind !== "haul" || !r.work.a) continue;
        const w = whereAt(r, tw, 2, h, serverWay);
        if (w.act !== "work" || w.leg === undefined) continue;
        const k = r.work.a.map(Math.round).join(",");
        if (!routes.has(k)) routes.set(k, []);
        routes.get(k)!.push([w.x, w.z]);
      }
      for (const [k, pts] of routes) {
        const worst = Math.max(...pts.map((p) => pts.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1.5).length));
        if (worst > 3) bad.push(`${h} ${k}: ${worst} of ${pts.length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("the carts pass the drawbridges' posts (Steve 2026-09-28: the Kipdorp dray went through one)", () => {
  // the gallows posts of the city's drawbridges (client world/bridges.ts DEFS and createDrawBridge: at the hinge, 1.2 m
  // back, the deck's half and 0.45 m out on either side; a 0.5 m collider each)
  const leaves: Array<[number, number, number, number]> = [
    [-82, 6, 0, 4], [-70, 6, Math.PI, 4], [-142, 5.5, Math.PI, 3.5], [-82, 69.5, 0, 3.5], [-70, 69.5, Math.PI, 3.5],
    [-82, 153.5, 0, 3.5], [-70, 153.5, Math.PI, 3.5], [-142, 43.5, Math.PI, 3.5],
  ];
  const posts: Array<[number, number]> = [];
  for (const [hx, hz, yaw, half] of leaves)
    for (const side of [-1, 1]) {
      const lz = side * (half + 0.45);
      posts.push([hx - 1.2 * Math.cos(yaw) + lz * Math.sin(yaw), hz + 1.2 * Math.sin(yaw) + lz * Math.cos(yaw)]);
    }
  it("every mill cart's way, the man and the rig on his trail, keeps a metre from every post", () => {
    const bad: string[] = [];
    for (const m of MILLS)
      for (const k of ["bakery", "dock"] as const)
        for (const pts of [m.routes[k], m.routes[k].slice().reverse()] as Array<Array<[number, number]>>) {
          const samples: Array<[number, number, number]> = [];
          let s = 0;
          for (let i = 1; i < pts.length; i++) {
            const [ax, az] = pts[i - 1];
            const [bx, bz] = pts[i];
            const L = Math.hypot(bx - ax, bz - az);
            for (let d = 0; d < L; d += 0.25) samples.push([ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L, s + d]);
            s += L;
          }
          const at = (ss: number) => samples.reduce((b, q) => (q[2] <= ss ? q : b), samples[0]);
          for (const c of samples) {
            // (a dray: the horse and the bed behind the carter, 0.85 m to his right, 0.8 m either side of it; a handcart ahead of its man)
            for (const back of m.cart === "dray" ? [0, 1, 2.4, 3.05, 4.3, 5.45, 6.17] : [0, -2.6]) {
              const q = at(Math.max(0, c[2] - back));
              const q2 = at(Math.max(0, c[2] - back - 0.5));
              const yaw = Math.atan2(q[0] - q2[0], q[1] - q2[1]);
              const side = m.cart === "dray" && back ? 0.85 : 0;
              const half = m.cart === "dray" ? (back ? 0.8 : 0.3) : 0.5;
              const px = q[0] - Math.cos(yaw) * side;
              const pz = q[1] + Math.sin(yaw) * side;
              for (const [ox, oz] of posts) if (Math.hypot(px - ox, pz - oz) - 0.25 - half < 1) bad.push(`${m.id} ${k}: ${px.toFixed(1)},${pz.toFixed(1)} by the post ${ox.toFixed(1)},${oz.toFixed(1)}`);
            }
          }
        }
    expect([...new Set(bad)].slice(0, 5)).toEqual([]);
  });
});
