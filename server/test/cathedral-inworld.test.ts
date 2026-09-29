import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { setJefIn } from "../src/landmarks/life.ts";
import { HUSH, hushBarred, hushToday, ranInChurch } from "../src/landmarks/hush.ts";
import * as P from "../../shared/cathedralPlan.ts";
import { LANDMARK_DOORS } from "../../shared/landmarks.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M7, the cathedral in the world (docs/milestones/M7-cathedral-inworld.md):
//  - the hall's plan (shared/cathedralPlan.ts) fits inside the Blender shell and lines up with its doors;
//  - the walk in: from the square through the west door to every place Jef and the townspeople use,
//    and nothing when the door is shut;
//  - running in the nave: the engine's hiss, the kerk's trust (small, capped per day), put out on the third.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const kerk = (db: Db) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = 'kerk'").get() as { trust: number }).trust;
const setKerk = (db: Db, t: number) => db.prepare("UPDATE faction_trust SET trust = ? WHERE faction = 'kerk'").run(t);
const logs = (db: Db, verb: string) => (db.prepare("SELECT COUNT(*) n FROM log WHERE verb = ?").get(verb) as { n: number }).n;

function fresh(): Db {
  const db = openDb(":memory:");
  setClock(db, 3, 9, 10); // a Wednesday, the low mass of nine
  setKerk(db, 0);
  setJefIn("cathedral");
  return db;
}

afterEach(() => setJefIn(null));

// ------------------------------------------------------------------ the plan in the shell

const FP = (CITY as unknown as { landmarks: { cathedral: { fp: number[][] } } }).landmarks.cathedral.fp;
function inFootprint(x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = FP.length - 1; i < FP.length; j = i++) {
    const [xi, zi] = FP[i];
    const [xj, zj] = FP[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

describe("the cathedral's hall fits its shell", () => {
  it("every outer corner of its walls lies inside the cathedral's footprint", () => {
    const outside = P.wallCorners().filter(([x, z]) => !inFootprint(...P.toWorld(x, z)));
    expect(outside).toEqual([]);
  });

  it("never bigger than the outside: under the roofs, inside the walls, behind the doors", () => {
    const S = P.SHELL;
    expect(P.H).toBeLessThan(S.naveEaves);
    expect(P.AH).toBeLessThan(S.aisleEaves);
    expect(P.NAVE + 0.45).toBeLessThan(S.halfNave);
    expect(P.OUT + 0.8).toBeLessThan(S.aisleWall);
    expect(P.CROSS0 - 0.6).toBeGreaterThan(S.transept[0]);
    expect(P.CROSS1 + 0.6).toBeLessThan(S.transept[1]);
    expect(P.TR + 0.35).toBeLessThan(S.transeptPortals.doorV);
    expect(P.W0 - 0.8).toBeGreaterThan(S.sidePortals.doorU); // the west wall stands behind the side portals' doors
    expect(P.WO - 0.8).toBeGreaterThan(S.outerGable);
    expect(P.A3).toBeLessThanOrEqual(S.towerSide);
    expect(P.APSE_OUT).toBeLessThan(S.apseR * Math.cos(Math.PI / 10));
    expect(P.AMB_OUT).toBeLessThan(S.ambulatoryR * Math.cos(Math.PI / 20));
    // the aisles' vaults spring above the nave arcades' arches (no looking over them)
    expect(P.ASPRING).toBeGreaterThan(12.2);
  });

  it("the doorway is the shell's west door: its middle, its width, the leaves' height", () => {
    const step = LANDMARK_DOORS.find((d) => d.id === "cathedral_west")!.step;
    const [x, z] = P.toWorld(0, P.DOORWAY.z0);
    expect(x).toBe(step[0]);
    // build_landmarks.py reports the central west portal's door at z 149.5
    expect(Math.abs(z - 149.5)).toBeLessThan(0.1);
    expect(P.DOORWAY.hw).toBe(P.SHELL.door.hw);
    expect(P.DOORWAY.h + P.FLOOR_Y).toBeCloseTo(P.SHELL.door.top, 5);
    // the side portals and the transept portals are inside the hall's walls where the shell has them
    expect(P.SHELL.sidePortals.v + P.SHELL.sidePortals.hw).toBeLessThan(P.A3 - 0.4);
    expect(P.SHELL.transeptPortals.u).toBeGreaterThan(P.CROSS0);
    expect(P.SHELL.transeptPortals.u).toBeLessThan(P.CROSS1);
    // the doorway's reveal stands behind the door plane, within the portal's mouth
    expect(P.DOORWAY.z0).toBe(P.SHELL.door.z);
    expect(P.SHELL.door.hw + 0.65).toBeLessThan(P.SHELL.portal.hw0);
  });
});

// ------------------------------------------------------------------ the walk in

/** Flood the plan's floor on a fine grid from a start point. */
function flood(start: [number, number], free: (x: number, z: number) => boolean) {
  const C = 0.25;
  const X0 = -P.TR - 1;
  const Z0 = P.PORCH_Z0 - 0.5;
  const W = Math.ceil((2 * P.TR + 2) / C);
  // (to the chapels round the ambulatory: issue #26)
  const H = Math.ceil((P.AC + 18.5 - Z0) / C);
  const seen = new Uint8Array(W * H);
  const at = (i: number, j: number): [number, number] => [X0 + i * C, Z0 + j * C];
  const si = Math.round((start[0] - X0) / C);
  const sj = Math.round((start[1] - Z0) / C);
  const q = [sj * W + si];
  seen[q[0]] = 1;
  while (q.length) {
    const k = q.pop()!;
    const i = k % W;
    const j = (k - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni;
      if (seen[n] || !free(...at(ni, nj))) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return (x: number, z: number, reach = 0.8) => {
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        if (!seen[j * W + i]) continue;
        const [px, pz] = at(i, j);
        if (Math.hypot(px - x, pz - z) <= reach) return true;
      }
    return false;
  };
}

describe("the walk in through the west door", () => {
  const STEP: [number, number] = [-1.4, P.PORCH_Z0 + 0.2];
  const jef = flood(STEP, (x, z) => P.freeAt(x, z, 0.3, true, true));

  it("the porch joins the square: its floor starts at the square's edge, the whole width of the portal", () => {
    for (const x of [-4.5, -1.4, 0, 1.4, 4.5]) expect(P.inArea(x, P.PORCH_Z0 + 0.05) && P.hasFloor(x, P.PORCH_Z0 + 0.05)).toBe(true);
    // the square's step (the walk map's) is just before it
    const step = LANDMARK_DOORS.find((d) => d.id === "cathedral_west")!.step;
    const [, lz] = P.toLocal(step[0], step[1]);
    expect(lz).toBeLessThan(P.PORCH_Z0);
    expect(P.PORCH_Z0 - lz).toBeLessThan(0.6);
  });

  it("Jef reaches every place he uses in the hall, through either half of the door", () => {
    const m = P.MARKS;
    const places: Array<[string, number, number, number?]> = [
      ["the nave", 0, P.ROW0 - 1.5],
      ["the left door", -1.4, P.DOORWAY.z0 + 0.8, 0.3],
      ["the right door", 1.4, P.DOORWAY.z0 + 0.8, 0.3],
      ["the confessional's kneeler", m.penitent.x, m.penitent.z, 0.4],
      ["the candle stand", P.SETS.standAt[2].x, P.SETS.standAt[2].z],
      ["the communion rail", m.railN.x, m.railN.z],
      ["the pulpit", P.PULPIT.x + 1.6, P.PULPIT.z],
      ["the Elevation", P.NORTH * P.TRIPTYCH_X, P.CROSS1 - 3.2],
      ["the Descent", -P.NORTH * P.TRIPTYCH_X, P.CROSS1 - 3.2],
      ["the font", P.FONT.x, P.FONT.z + 1.4],
      ["the ambulatory", 0, P.AC + 9],
      ["the outer aisles", P.NORTH * 21.5, 30],
      ["the south outer aisle", -P.NORTH * 21.5, 30],
      ["the transept's north end", P.TR - 1.5, (P.CROSS0 + P.CROSS1) / 2],
      // issue #26: the choir's third aisles and the five chapels round the ambulatory
      ["the choir's north outer aisle", P.NORTH * 21.5, 94.4],
      ["the choir's south outer aisle", -P.NORTH * 21.5, 94.4],
      ...P.CHAPEL_ANGLES.map((a, i): [string, number, number] => [`chapel ${i + 1}, before its altar`, ...P.chapelXZ(a, 13.3, 0)]),
    ];
    const lost = places.filter(([, x, z, r]) => !jef(x, z, r ?? 0.8)).map(([n]) => n);
    expect(lost).toEqual([]);
    // every chair at a row's end, where Jef may sit, from the middle walk
    for (let r = 0; r < P.ROWS; r++) for (const s of [-1, 1]) expect(jef(s * 0.6, P.ROW0 + r * P.ROWD, 0.5)).toBe(true);
  });

  it("but not into the choir: the rail and the screens stop him (the clergy's gate is theirs)", () => {
    expect(jef(0, P.AZ - 2, 0.5)).toBe(false);
    expect(jef(P.MARKS.choirFront.x, P.MARKS.choirFront.z, 0.5)).toBe(false);
  });

  it("the townspeople walk from the square to every place their parts take them, the clergy into the choir by the gate", () => {
    const people = flood(STEP, (x, z) => P.freeAt(x, z, 0.25, false, true));
    const spots: Array<[string, number, number]> = [];
    for (const k of ["railN", "railS", "beadleMass", "chairsPost", "preacherWait", "pulpitFoot", "sacristy", "door", "choirFront", "gate"]) spots.push([k, P.MARKS[k].x, P.MARKS[k].z]);
    for (const set of ["standAt", "chapels", "beadleRound", "chairsWalk", "curateWalk"]) P.SETS[set].forEach((q, i) => spots.push([`${set} ${i}`, q.x, q.z]));
    for (const q of P.STEP_IN) spots.push(["the step", q.x, q.z]);
    const lost = spots.filter(([, x, z]) => !people(x, z, 0.7)).map(([n]) => n);
    expect(lost).toEqual([]);
    // their walking graph's points stand on free floor
    const bad = P.nodes().filter(([x, z]) => !P.freeAt(x, z, 0.25, false));
    expect(bad).toEqual([]);
  });

  it("at night the west door is shut: nobody gets past the leaves", () => {
    const shut = flood(STEP, (x, z) => P.freeAt(x, z, 0.3, true, false));
    expect(shut(0, P.ROW0 - 1.5)).toBe(false);
    expect(shut(-1.4, 0.5)).toBe(true); // the porch outside stays open ground
  });

  it("the threshold blend runs from 0 on the square to 1 a few metres into the nave", () => {
    expect(P.insideness(0, -5)).toBe(0);
    expect(P.insideness(0, 0)).toBe(0);
    const mid = P.insideness(0, P.DOORWAY.z0 + 1);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    expect(P.insideness(0, P.W0 + 3)).toBe(1);
    expect(P.insideness(P.NORTH * 21.5, 40)).toBe(1);
  });
});

// ------------------------------------------------------------------ running in the nave

describe("running in the cathedral (the engine's hiss, the kerk's trust)", () => {
  it("nobody near, or Jef not inside, or the church shut: nothing happens", () => {
    const db = fresh();
    expect(ranInChurch(db, 0).counted).toBe(false);
    setJefIn(null);
    expect(ranInChurch(db, 5).counted).toBe(false);
    setJefIn("cathedral");
    setClock(db, 3, 21);
    expect(ranInChurch(db, 5).counted).toBe(false);
    expect(kerk(db)).toBe(0);
    expect(hushToday(db).strikes).toBe(0);
  });

  it("during mass: a hiss and 1 trust off; again too soon counts nothing", () => {
    const db = fresh();
    const r = ranInChurch(db, 4);
    expect(r.counted).toBe(true);
    expect(r.strike).toBe(1);
    expect(r.delta).toBe(-HUSH.TRUST_STEP);
    expect(r.leave).toBe(false);
    expect(r.line.length).toBeGreaterThan(5);
    expect(kerk(db)).toBe(-1);
    expect(logs(db, "ran_in_church")).toBe(1);
    // the same minute again: not counted
    expect(ranInChurch(db, 4).counted).toBe(false);
    expect(kerk(db)).toBe(-1);
  });

  it("the trust lost for running is capped per day; the third time the beadle puts him out and the door is shut to him for an hour", () => {
    const db = fresh();
    const a = ranInChurch(db, 6);
    setClock(db, 3, 9, 40);
    const b = ranInChurch(db, 6);
    expect(b.speaker).toBe("beadle");
    expect(kerk(db)).toBe(-HUSH.TRUST_CAP_PER_DAY);
    setClock(db, 11, 0);
    setClock(db, 3, 11, 20); // the low mass of eleven
    const c = ranInChurch(db, 6);
    expect([a.strike, b.strike, c.strike]).toEqual([1, 2, 3]);
    expect(c.delta).toBe(0); // the cap: no more than 2 a day
    expect(c.leave).toBe(true);
    expect(c.speaker).toBe("beadle");
    expect(kerk(db)).toBe(-HUSH.TRUST_CAP_PER_DAY);
    expect(logs(db, "put_out")).toBe(1);
    expect(hushBarred(db).barred).toBe(true);
    setClock(db, 3, 12, 25);
    expect(hushBarred(db).barred).toBe(false);
    // a fourth run the same day costs no more trust
    setClock(db, 3, 14, 0);
    ranInChurch(db, 6);
    expect(kerk(db)).toBe(-HUSH.TRUST_CAP_PER_DAY);
  });

  it("a new day starts afresh; the trust never goes below -5", () => {
    const db = fresh();
    setKerk(db, -4);
    ranInChurch(db, 3);
    setClock(db, 3, 9, 40);
    ranInChurch(db, 3);
    expect(kerk(db)).toBe(-5);
    setClock(db, 4, 9, 10);
    const r = ranInChurch(db, 3);
    expect(r.strike).toBe(1);
    expect(r.leave).toBe(false);
    expect(kerk(db)).toBe(-5);
    expect(hushToday(db)).toEqual({ strikes: 1, lost: 0 });
  });

  it("outside mass one onlooker only turns his head; with a few looking it costs trust", () => {
    const db = fresh();
    setClock(db, 3, 10, 0); // between masses
    const r = ranInChurch(db, 1);
    expect(r.counted).toBe(true);
    expect(r.delta).toBe(0);
    setClock(db, 3, 10, 30);
    const r2 = ranInChurch(db, HUSH.WITNESSES_OUTSIDE_MASS);
    expect(r2.delta).toBe(-1);
  });

  it("the client's count is data, not orders: nonsense and huge numbers change nothing more", () => {
    const db = fresh();
    for (const w of ["lots", null, -3, Number.NaN, { n: 9 }]) expect(ranInChurch(db, w).counted).toBe(false);
    expect(kerk(db)).toBe(0);
    const r = ranInChurch(db, 1e9);
    expect(r.counted).toBe(true);
    expect(r.delta).toBe(-1);
    expect(kerk(db)).toBe(-1);
  });
});

// Issue #28 (interiors are real): the openings of the parts over no hall (the towers, the crossing tower's tiers, the
// great roof's dormers) and the numbers of the spaces behind them come from one build (build_landmarks.py).
describe("the cathedral's upper openings (issue #28)", () => {
  it("every tower lancet, tier window and dormer window is written for the room behind it, apart from the hall's", async () => {
    const { SHELL_OPENINGS, UPPER_OPENINGS, UPPER_SHELL } = await import("../../shared/cathedralShell.ts");
    const count = (re: RegExp) => UPPER_OPENINGS.filter((o) => re.test(o.label)).length;
    expect(UPPER_OPENINGS.every((o) => /^cu_\d{3}$/.test(o.id) && o.kind === "window")).toBe(true);
    expect(SHELL_OPENINGS.every((o) => /^ct_\d{3}$/.test(o.id))).toBe(true);
    // the dormers: one window each, on the front the build noted
    expect(count(/dormer/)).toBe(UPPER_SHELL.dormers.length);
    // the crossing tower: eight windows a tier
    expect(count(/lead tier/)).toBe(8 * UPPER_SHELL.crossing.tiers.length);
    // the octagon's eight open lancets, the south lantern's four
    expect(count(/octagon/)).toBe(8);
    expect(count(/south tower's lantern/)).toBe(4);
    // the square stages: two lancets a face; each tower's first stage's face toward the nave is inside the west bay
    const stages = UPPER_SHELL.towers.reduce((s, t) => s + t.stages.length, 0);
    expect(count(/stage/)).toBe(8 * stages - 2 * 2);
    // every one inside the landmark's rectangle, up over the hall's vaults
    for (const o of UPPER_OPENINGS) {
      expect(o.yb).toBeGreaterThan(18);
      expect(Math.abs(o.x - P.ORIGIN.x)).toBeLessThan(40);
    }
  });
});
