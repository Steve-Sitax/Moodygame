import { describe, expect, it } from "vitest";
import {
  JIB_GAP,
  PORTAL_GAP,
  angDiff,
  awayAngle,
  capGap,
  craneGap,
  craneParts,
  mast,
  car,
  outranks,
  portalGap,
  segDist,
  stepOk,
  thingsGap,
  type CranePose,
} from "../../shared/cranes.ts";

// M6 cranes (Steve 2026-09-24): portal cranes must not run their jibs into each other, into a
// moored ship's mast or the goods train. shared/cranes.ts is the geometry world/railway.ts uses.

const PI = Math.PI;
/** A river crane (yaw pi: its jib at rest points to -z, over the water) at x, jib angle a. */
const river = (x: number, a: number, hy = 4.2, load = 0): CranePose => ({ x, z: 4, yaw: PI, a, hy, load });
/** Jib angle of a river crane that points along the runway to +x / -x. */
const EAST = -PI / 2;
const WEST = PI / 2;
const gap = (a: CranePose, b: CranePose) => craneGap(craneParts(a), craneParts(b)).gap;

describe("segment distance", () => {
  const s = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => ({ ax, ay, az, bx, by, bz, r: 0, kind: "jib" as const });
  it("parallel, crossing, skew and points", () => {
    expect(segDist(s(0, 0, 0, 10, 0, 0), s(0, 3, 0, 10, 3, 0))).toBeCloseTo(3);
    expect(segDist(s(-5, 0, 0, 5, 0, 0), s(0, 0, -5, 0, 0, 5))).toBeCloseTo(0);
    expect(segDist(s(-5, 0, 0, 5, 0, 0), s(0, 2, -5, 0, 2, 5))).toBeCloseTo(2);
    expect(segDist(s(0, 0, 0, 10, 0, 0), s(13, 4, 0, 13, 4, 0))).toBeCloseTo(5);
    expect(segDist(s(1, 1, 1, 1, 1, 1), s(1, 1, 1, 1, 1, 1))).toBeCloseTo(0);
    // past the end of one segment
    expect(segDist(s(0, 0, 0, 1, 0, 0), s(3, -1, 0, 3, 1, 0))).toBeCloseTo(2);
  });
  it("capsules: the radii come off", () => {
    const a = { ...s(0, 0, 0, 10, 0, 0), r: 0.5 };
    const b = { ...s(0, 3, 0, 10, 3, 0), r: 1 };
    expect(capGap(a, b)).toBeCloseTo(1.5);
  });
});

describe("two cranes on one runway", () => {
  it("jibs at rest over the water, 12 m apart: clear", () => {
    expect(gap(river(0, 0), river(12, 0))).toBeGreaterThan(JIB_GAP + 4);
  });
  it("jibs swung toward each other: they meet", () => {
    expect(gap(river(0, EAST), river(24, WEST))).toBeLessThan(0);
    expect(gap(river(0, -1.0), river(14, 1.0))).toBeLessThan(0);
  });
  it("a jib reaching over its neighbour's cabin is high enough, but not its hook", () => {
    // the jib head is 14.8 m up over the neighbour 12 m off; the hook's fall hangs through its cabin
    const a = river(0, EAST, 6.8);
    const parts = craneParts(a).filter((p) => p.kind === "jib");
    expect(thingsGap(parts, craneParts(river(12, 0)), ["jib"])).toBeGreaterThan(JIB_GAP);
    expect(gap(a, river(12, 0))).toBeLessThan(0);
  });
  it("17 m apart: a loaded hook can go down into a wagon under the neighbour's side", () => {
    // M3g put the cranes 12 m apart; 17 m (CRANE_GAP) leaves the wagon rows on both sides free
    expect(gap(river(0, EAST, 1.12 + 0.86 + 0.85, 1.71), river(17, 0))).toBeGreaterThan(JIB_GAP);
    expect(gap(river(0, EAST, 1.12 + 0.86 + 0.85, 1.71), river(12, 0))).toBeLessThan(JIB_GAP);
  });
  it("portals: footprints in plan", () => {
    expect(portalGap(river(0, 0), river(5.9, 0))).toBeCloseTo(0);
    expect(portalGap(river(0, 0), river(5.9 + PORTAL_GAP, 0))).toBeCloseTo(PORTAL_GAP);
    // a dock crane turned a quarter: its footprint turns with it
    expect(portalGap({ x: 0, z: 0, yaw: PI / 2, a: 0, hy: 4, load: 0 }, { x: 0, z: 10, yaw: PI / 2, a: 0, hy: 4, load: 0 })).toBeCloseTo(10 - 5.9);
  });
});

describe("masts and the train", () => {
  it("a mast under the jib stops it; one beside it or a short one does not", () => {
    const a = river(0, 0);
    const parts = craneParts(a);
    // under the jib 8 m out (over the water at z -4), 20 m high: through the jib
    expect(thingsGap(parts, [mast(0, -4, 1, 20, 0.75)])).toBeLessThan(0);
    // 6 m to the side
    expect(thingsGap(parts, [mast(6, -4, 1, 20, 0.75)])).toBeGreaterThan(JIB_GAP);
    // a short mast: the jib passes 3 m over its top
    expect(thingsGap(parts, [mast(0, -4, 1, 7, 0.75)])).toBeGreaterThan(JIB_GAP);
  });
  it("a hook left low over a wagon touches it; the hook up at 5.2 m clears it", () => {
    // the jib along the line, the hook over a covered van 11.5 m off
    const van = car(11.5, 4, PI / 2, 1.1, 1.9, 1.6);
    expect(thingsGap(craneParts(river(0, EAST, 3.6)), [van], ["fall"])).toBeLessThan(JIB_GAP);
    expect(thingsGap(craneParts(river(0, EAST, 5.2)), [van], ["fall"])).toBeGreaterThan(JIB_GAP);
  });
});

describe("the rule and the priority", () => {
  it("a step is taken only if it keeps the margin or does not make things worse", () => {
    expect(stepOk(3, 1.2, JIB_GAP)).toBe(true);
    expect(stepOk(3, 0.8, JIB_GAP)).toBe(false);
    expect(stepOk(0.4, 0.6, JIB_GAP)).toBe(true); // backing away from too close
    expect(stepOk(0.4, 0.3, JIB_GAP)).toBe(false);
  });
  it("the working crane goes first; the travelling one yields; a tie goes to the lower index", () => {
    expect(outranks({ rank: 3, index: 5 }, { rank: 2, index: 0 })).toBe(true);
    expect(outranks({ rank: 2, index: 0 }, { rank: 3, index: 5 })).toBe(false);
    expect(outranks({ rank: 1, index: 2 }, { rank: 1, index: 3 })).toBe(true);
    expect(outranks({ rank: 1, index: 3 }, { rank: 1, index: 2 })).toBe(false);
  });
  it("away: the jib angle that points from the other crane through this one", () => {
    // B at x 14 made way for A at x 0: its jib to +x (along the runway, away)
    expect(angDiff(awayAngle(river(14, 0), 0, 4), EAST)).toBeCloseTo(0);
    expect(angDiff(awayAngle(river(0, 0), 14, 4), WEST)).toBeCloseTo(0);
  });

  /**
   * Two cranes 14 m apart slew into the gap between them at once. Each step is taken only if the
   * rule allows it; a blocked crane that outranks the other asks it to make way (its jib away).
   * Neither ever comes within the margin, and the one that goes first gets where it wanted.
   */
  function run(rankA: number, rankB: number) {
    const A = { pose: river(0, 0, 5.2), to: -1.0, rank: rankA, index: 0, yieldT: 0 };
    const B = { pose: river(14, 0, 5.2), to: 1.0, rank: rankB, index: 1, yieldT: 0 };
    let least = Infinity;
    const dt = 0.05;
    for (let t = 0; t < 120; t += dt) {
      for (const [me, other] of [
        [A, B],
        [B, A],
      ] as const) {
        const want = me.yieldT > 0 ? awayAngle(me.pose, other.pose.x, other.pose.z) : me.to;
        me.yieldT -= dt;
        const d = angDiff(want, me.pose.a);
        if (Math.abs(d) < 1e-3) continue;
        const next = { ...me.pose, a: me.pose.a + Math.sign(d) * Math.min(Math.abs(d), 0.32 * dt) };
        const before = gap(me.pose, other.pose) - JIB_GAP;
        const after = gap(next, other.pose) - JIB_GAP;
        if (stepOk(before, after, 0)) me.pose = next;
        else if (outranks(me, other)) other.yieldT = 1.2;
      }
      least = Math.min(least, gap(A.pose, B.pose));
    }
    return { A: A.pose.a, B: B.pose.a, least };
  }
  it("working (A) against idle (B): B makes way, A gets there, never within 1 m", () => {
    const r = run(3, 1);
    expect(r.least).toBeGreaterThanOrEqual(JIB_GAP - 1e-6);
    expect(r.A).toBeCloseTo(-1.0, 2);
  });
  it("the idle one with the lower index still yields to the working one", () => {
    const r = run(1, 3);
    expect(r.least).toBeGreaterThanOrEqual(JIB_GAP - 1e-6);
    expect(r.B).toBeCloseTo(1.0, 2);
  });
  it("equal ranks: no deadlock, the lower index goes first", () => {
    const r = run(1, 1);
    expect(r.least).toBeGreaterThanOrEqual(JIB_GAP - 1e-6);
    expect(r.A).toBeCloseTo(-1.0, 2);
  });
});
