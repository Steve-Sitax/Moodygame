import { describe, expect, it } from "vitest";
import { LOCK_CHAMBER, MAX_BEAM, TOW_LINE, chamberSpan, lockFit, type LockPart } from "../../shared/lockfit.ts";
import { tideAt, water } from "../../client/src/world/tide.ts";

// world/lock.ts pulls in three.js and the client's other modules, which the server's typecheck does
// not compile: load it at run time (vitest resolves it) and describe here only what the test uses.
interface LockTrip {
  names: string[];
  dir: "in" | "out";
  mode: string;
  waitOutside: number;
  waitInside: number;
  turnedAway: boolean;
  why: string;
}
interface TestLock {
  update(t: number, dt: number): void;
  passNow(dir?: "in" | "out", names?: string[]): void;
  traffic?(): { state: string; log: LockTrip[] };
}
interface LockModule {
  createLock(scene: unknown, boats: unknown, opts: { seed?: number; models?: boolean; interval?: [number, number]; occupied?: () => boolean }): TestLock;
  LOCK_CANDIDATES: string[][];
}
const LOCK_TS = new URL("../../client/src/world/lock.ts", import.meta.url).href;
const { createLock, LOCK_CANDIDATES } = (await import(/* @vite-ignore */ LOCK_TS)) as LockModule;

// The lock of the Petit Bassin (Steve 2026-09-24: a tug towing a barge waited at the lock for ever;
// "Do not send bigger boats or combinations through a lock, so they never need to wait until high
// tide"). shared/lockfit.ts says what fits the chamber; world/lock.ts sends only those, at any tide.

/**
 * Hull sizes from boats.glb (Boats.dims: length bow to stern below 2.4 m, beam), measured in the
 * browser on 2026-09-24. The game reads them live; `__scheldemist.world.lock().fitTable()` prints the
 * same table from the loaded models, so a changed model shows there.
 */
const DIMS: Record<string, [number, number]> = {
  barque: [51.43, 9.72],
  steamer: [58.49, 8.38],
  rhine_barge: [36.2, 6.64],
  hengst: [23.35, 5.89],
  lighter: [18.4, 4.74],
  lighter_loaded: [18.4, 4.74],
  tug: [21.06, 5.06],
  paddle_tug: [21.06, 6.51],
  sloop: [15.35, 4.24],
  barque_sail: [51.43, 9.72],
  brig: [39.91, 8.99],
  schooner: [28.6, 6.53],
  sloop_sail: [15.35, 4.24],
  hengst_sail: [23.35, 5.89],
  rowboat: [6.35, 1.55],
  punt: [7, 1.35],
  liner: [102.37, 11.73],
};
const part = (n: string): LockPart => ({ name: n, length: DIMS[n][0], beam: DIMS[n][1] });
/** What lock.ts sent before (a tug or paddle tug with one of these on a 9 m line), and the river's tug trains. */
const OLD_TOWS = ["lighter_loaded", "rhine_barge", "lighter", "hengst"].flatMap((t) => [["tug", t], ["paddle_tug", t]]);
const RIVER_TRAINS = [["tug", "barque"], ["tug", "lighter_loaded", "lighter"]];

/** A stand-in for a boat model: lock.ts only sets its place, turn and visibility. */
function fakeBoats() {
  const placed: Array<{ name: string; o: { position: { x: number; y: number; z: number; set(x: number, y: number, z: number): void }; rotation: { y: number }; visible: boolean } }> = [];
  return {
    placed,
    boats: {
      place(name: string) {
        const o = {
          position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; } },
          rotation: { y: 0 },
          visible: true,
        };
        placed.push({ name, o });
        return o;
      },
      dims: (n: string) => ({ length: DIMS[n][0], beam: DIMS[n][1], height: 5 }),
    },
  };
}

interface Run {
  trips: LockTrip[];
  /** Seconds a visible hull stood still off the lock or in it, all told, and the longest single stop. */
  stillAtLock: number;
  longestStill: number;
  /** Seconds a hull stood still before the gates it came to (off the lock, not in the chamber). */
  stillOutside: number;
}

/** Run the lock's traffic for `seconds` of play (a game hour is 20 s), the river on the clock. */
async function runTraffic(seconds: number, seed: number, startHour = 0): Promise<Run> {
  const { boats, placed } = fakeBoats();
  const lock = createLock({ add() {} } as never, boats, { seed, models: false });
  await new Promise((r) => setTimeout(r, 0));
  const dt = 0.05;
  const last = new Map<object, [number, number]>();
  let still = 0;
  let longest = 0;
  let stillAtLock = 0;
  let stillOutside = 0;
  for (let t = 0; t < seconds; t += dt) {
    const h = startHour + t / 20;
    water.river = tideAt(1 + Math.floor(h / 24), h % 24);
    lock.update(t, dt);
    // the visible hulls near the lock (x 95..125, z -30..60): standing still?
    let stopped = false;
    let outside = false;
    for (const p of placed) {
      if (!p.o.visible) continue;
      const { x, z } = p.o.position;
      const prev = last.get(p.o);
      last.set(p.o, [x, z]);
      if (!prev || x < 95 || x > 125 || z < -30 || z > 60) continue;
      if (Math.hypot(x - prev[0], z - prev[1]) / dt < 0.05) {
        stopped = true;
        if (z < LOCK_CHAMBER.gateRiver - 1 || z > LOCK_CHAMBER.gateDock + 1) outside = true;
      }
    }
    if (stopped) {
      still += dt;
      stillAtLock += dt;
      longest = Math.max(longest, still);
      if (outside) stillOutside += dt;
    } else still = 0;
  }
  return { trips: lock.traffic?.().log ?? [], stillAtLock, longestStill: longest, stillOutside };
}

describe("lock: what fits the chamber", () => {
  it("lists every vessel and tow against the chamber", () => {
    const rows = [
      ...Object.keys(DIMS).map((n) => [n]),
      ...OLD_TOWS,
      ...RIVER_TRAINS,
    ].map((names) => {
      const f = lockFit(names.map(part));
      const trip = LOCK_CANDIDATES.some((c) => c.join("+") === names.join("+"));
      return `${f.name.padEnd(28)} ${f.length.toFixed(1).padStart(6)} m x ${f.beam.toFixed(1).padStart(4)} m  room ${f.room.toFixed(1)} m  ${f.fits ? "fits" : "too big"}${trip && f.fits ? ", lock trips" : ""}${f.why ? `  (${f.why})` : ""}`;
    });
    console.log(`Chamber: z ${LOCK_CHAMBER.gateRiver}..${LOCK_CHAMBER.gateDock}, widest hull ${MAX_BEAM.toFixed(1)} m, tow line ${TOW_LINE} m\n${rows.join("\n")}`);
    // the old tows (tug + lighter or barge) never fit; nor do the sea-going ships
    for (const t of OLD_TOWS) expect(lockFit(t.map(part)).fits, t.join("+")).toBe(false);
    for (const n of ["brig", "barque", "steamer", "liner", "rhine_barge"]) expect(lockFit([part(n)]).fits, n).toBe(false);
    // a tug alone, a sailing hengst or sloop do
    for (const n of ["tug", "paddle_tug", "hengst_sail", "sloop_sail", "rowboat"]) expect(lockFit([part(n)]).fits, n).toBe(true);
    // the chamber for a tug's beam is about 28 m
    expect(chamberSpan(DIMS.tug[1]).length).toBeGreaterThan(27);
  });

  it("the lock's own traffic: some vessels fit, none of its tows", () => {
    const fit = LOCK_CANDIDATES.filter((names) => lockFit(names.map(part)).fits);
    expect(fit.length).toBeGreaterThanOrEqual(3);
    expect(fit.every((names) => names.length === 1)).toBe(true);
  });
});

describe("lock: an hour of traffic", () => {
  it("nothing waits at the gates beyond the lock's own cycle", async () => {
    // an hour of play each (180 game hours: every state of the tide, springs to neaps), three starts
    const runs: Run[] = [];
    for (const [seed, hour] of [[1811, 0], [7, 3], [42, 7.5]] as const) runs.push(await runTraffic(3600, seed, hour));
    for (const r of runs) {
      const passes = r.trips.filter((t) => !t.turnedAway);
      console.log(
        `trips ${r.trips.length} (${passes.map((t) => `${t.names.join("+")} ${t.dir} ${t.mode}: off the gates ${t.waitOutside.toFixed(0)} s, in the chamber ${t.waitInside.toFixed(0)} s`).join("; ")}); ` +
          `hulls standing still at the lock ${r.stillAtLock.toFixed(0)} s, longest ${r.longestStill.toFixed(0)} s, off the gates ${r.stillOutside.toFixed(0)} s`,
      );
    }
    for (const r of runs) {
      expect(r.trips.length).toBeGreaterThan(5);
      for (const t of r.trips) {
        expect(lockFit(t.names.map(part)).fits).toBe(true);
        expect(t.turnedAway).toBe(false);
        // at the gates: at most a few seconds while the last gate swings; in the chamber: one levelling
        expect(t.waitOutside).toBeLessThan(10);
        expect(t.waitInside).toBeLessThan(60);
      }
      expect(r.stillOutside).toBeLessThan(10 * r.trips.length);
      expect(r.longestStill).toBeLessThan(60);
    }
  });
});

describe("lock: a boat that no longer qualifies turns away", () => {
  async function drive(opts: { occupied?: () => boolean }, names: string[] | undefined, seconds: number) {
    const { boats, placed } = fakeBoats();
    const lock = createLock({ add() {} } as never, boats, { seed: 5, models: false, interval: [9999, 9999], ...opts });
    await new Promise((r) => setTimeout(r, 0));
    water.river = -4; // low water: no straight run on the level
    lock.passNow("in", names);
    let deepest = -Infinity; // how far into the lock any hull of the trip got (z)
    const trip = names ? names.join("+") : null;
    for (let t = 0; t < seconds; t += 0.05) {
      lock.update(t, 0.05);
      for (const p of placed) if (p.o.visible && (!trip || names!.includes(p.name))) deepest = Math.max(deepest, p.o.position.z);
    }
    return { lock, deepest };
  }

  it("a tow too big for the chamber (forced from the dev menu) turns away before the gates", async () => {
    const { lock, deepest } = await drive({}, ["tug", "rhine_barge"], 400);
    const log = lock.traffic!().log;
    expect(log[0].turnedAway).toBe(true);
    expect(log[0].why).toMatch(/does not fit/);
    expect(deepest).toBeLessThan(LOCK_CHAMBER.gateRiver - 3);
    expect(lock.traffic!().state).toBe("river");
  });

  it("a boat kept waiting off the gates (the bridge held down) turns away instead of waiting for ever", async () => {
    const { lock, deepest } = await drive({ occupied: () => true }, undefined, 400);
    const log = lock.traffic!().log;
    expect(log[0].turnedAway).toBe(true);
    expect(log[0].why).toMatch(/kept waiting/);
    expect(log[0].waitOutside).toBeLessThan(50);
    expect(deepest).toBeLessThan(LOCK_CHAMBER.gateRiver);
  });
});
