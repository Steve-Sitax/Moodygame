import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { resident, town } from "../src/town/store.ts";
import { goneHouses, houseDoors, walkMap } from "../src/town/walkmap.ts";
import { ensurePrison, gateStep, heldNow, jail, prisonView, releaseDue, STANDING_DAYS, thiefCaught, visitAt, warderLine } from "../src/town/prison.ts";
import { residentPrompt, talkExtras } from "../src/town/talk.ts";
import { allLamps, ensureLamplighters, lampRounds, roundOf } from "../src/town/lamplighters.ts";
import { INWORLD_HOUSES } from "../src/town/kept.ts";
import * as HP from "../../shared/hallPlan.ts";
import * as PP from "../../shared/prisonPlan.ts";

// M7 prison and squares (docs/milestones/M7-prison-squares.md): the prison in the Begijnenstraat on the block south
// of the cathedral (houses marked gone), its hall walked in by its plan, its people the server's; the round square
// and the greens (shared/townplaces.json, tools/city/places.py).

type Db = ReturnType<typeof openDb>;
const TP = JSON.parse(readFileSync(new URL("../../shared/townplaces.json", import.meta.url), "utf8"));
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);

describe("the prison: its place", () => {
  it("the plan's frame and parts are places.py's", () => {
    expect(PP.ORIGIN.x).toBeCloseTo(TP.prison.origin[0], 2);
    expect(PP.ORIGIN.z).toBeCloseTo(TP.prison.origin[1], 2);
    expect(PP.YAW).toBeCloseTo(TP.prison.yaw, 5);
    expect(PP.COMPOUND).toEqual(TP.prison.compound);
    for (const [k, v] of Object.entries(PP.PARTS)) expect(v, k).toEqual(TP.prison.parts[k]);
  });

  it("stands on houses pulled down: none has a door, no home in the town is there, no in-world house either", () => {
    const gone = goneHouses();
    for (const i of TP.prison.gone as number[]) {
      expect(gone.has(i), `house ${i}`).toBe(true);
      expect(INWORLD_HOUSES.has(i), `in-world house ${i}`).toBe(false);
    }
    expect(houseDoors().some((d) => gone.has(d.house))).toBe(false);
    const db = openDb(":memory:");
    for (const r of town(db).town.residents) expect(gone.has(r.home.house), `${r.name}'s home`).toBe(false);
  });

  it("the compound is wall on the walk map; the step before the gate is reachable, and the wall street past it", () => {
    const wm = walkMap();
    const [sx, sz] = gateStep();
    expect(wm.reachable(sx, sz)).toBe(true);
    for (const [x, z] of [[0, 5], [10, 20], [-20, 20], [21.6, 7.4]] as Array<[number, number]>) {
      const [wx, wz] = PP.toWorld(x, z);
      expect(wm.reachable(wx, wz), `${x}, ${z}`).toBe(false);
    }
    for (const x of [-25, -15, 15, 25]) {
      const [wx, wz] = PP.toWorld(x, -3.5);
      expect(wm.reachable(wx, wz) || !!wm.nearestOpen(wx, wz, 1.2), `the wall street at ${x}`).toBe(true);
    }
  });

  it("inside: from the gate's step, on foot, to the visitors' grille, the guard room, the pavilion, the cells' doors and the yard door", () => {
    const P = PP.PLAN;
    const reach = HP.flood(P, [0, -1.4], 0.25, 0.3);
    for (const [x, z] of [[0, 1.6], [6.8, 3.0], [-5, 6.4], [3.2, 19], [16.5, 19.5], [10.2, 20.6], [18.6, 18.4], [13, 16], [13, 13.6]] as Array<[number, number]>)
      expect(reach(x, z, 0, 0.8), `${x}, ${z}`).toBe(true);
    // not past the grille, not into the shut wing, not into a cell
    for (const [x, z] of [[6.8, 5.5], [-10, 19.5], [10.2, 22.8], [18.6, 16.2]] as Array<[number, number]>) expect(reach(x, z, 0, 0.4), `${x}, ${z}`).toBe(false);
    // the walls of the rooms stand inside the compound
    for (const r of P.area) {
      expect(r.minX).toBeGreaterThanOrEqual(PP.COMPOUND.x0);
      expect(r.maxX).toBeLessThanOrEqual(PP.COMPOUND.x1);
      expect(r.maxZ).toBeLessThanOrEqual(PP.COMPOUND.z1);
    }
    // the yard: inside the compound's wall, off the wings
    for (const q of PP.YARD) {
      expect(q.maxX).toBeLessThanOrEqual(PP.COMPOUND.x1 - PP.WALL.t + 1e-9);
      expect(q.maxZ).toBeLessThanOrEqual(PP.PARTS.wingA.z0 + 1e-9);
    }
  });
});

describe("the prison: its hours and its people", () => {
  it("visiting hours, the exercise, the shifts", () => {
    expect(PP.prisonVisiting(1, 10)).toBe(true);
    expect(PP.prisonVisiting(1, 13)).toBe(false);
    expect(PP.prisonVisiting(7, 10)).toBe(false);
    expect(PP.prisonVisiting(7, 15)).toBe(true);
    expect(PP.prisonExercise(2, 10.5)).toBe(true);
    expect(PP.prisonExercise(2, 12)).toBe(false);
    expect(PP.prisonDayShift(19)).toBe(false);
  });

  it("the standing inmate: one single working man, held in the prison, his home and day given back when he is out", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 9);
    ensurePrison(db);
    const v = prisonView(db);
    expect(v.inmates.length).toBe(1);
    const id = v.inmates[0].id;
    const r = resident(db, id)!;
    expect(r.sex).toBe("m");
    expect(["single", "lodger"]).toContain(r.family_role);
    expect(r.home.house).toBe(-1);
    expect(r.sched.day).toEqual([[0, 24, "home"]]);
    const held = heldNow(db, id)!;
    // the same man for the same town, and only once
    ensurePrison(db);
    expect(prisonView(db).inmates.map((m) => m.id)).toEqual([id]);
    // out on his last morning at seven, his home and day as before
    setClock(db, 1 + STANDING_DAYS, 6);
    expect(releaseDue(db)).toEqual([]);
    setClock(db, 1 + STANDING_DAYS, 7);
    expect(releaseDue(db)).toEqual([id]);
    const back = resident(db, id)!;
    expect(back.home).toEqual(held.before.home);
    expect(back.sched).toEqual(held.before.sched);
    expect(heldNow(db, id)).toBeNull();
  });

  it("a visit only in visiting hours, with a man held; the warders' words by the hour", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 13);
    expect(visitAt(db).ok).toBe(false);
    setClock(db, 1, 10);
    const v = visitAt(db);
    expect(v.ok).toBe(true);
    expect(v.id).toBe(prisonView(db).inmates[0].id);
    expect(warderLine(db, "gate")).toMatch(/Visitors/);
    setClock(db, 1, 22);
    expect(warderLine(db, "gate")).toMatch(/night/);
  });

  it("a thief Jef caught is held three days; the talk knows where he is", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 23);
    const thief = town(db).town.residents.find((r) => r.trade === "thief")!;
    const text = thiefCaught(db, thief.id);
    expect(text).toMatch(/Begijnenstraat/);
    expect(heldNow(db, thief.id)?.until).toBe(5);
    const ctx = talkExtras.context.map((f) => f(db, resident(db, thief.id)!)).join("\n");
    expect(ctx).toMatch(/held in the prison/);
    expect(residentPrompt(db, resident(db, thief.id)!, "", [])).toMatch(/grille/);
    // held once only
    expect(thiefCaught(db, thief.id)).toBe("");
    expect(jail(db, thief.id, 3, "again")).toBe(false);
  });
});

describe("the round square and the greens", () => {
  it("the Sint-Jansplein's lamps are gas lamps on the north round, and every lamp is on a round", () => {
    const db = openDb(":memory:");
    ensureLamplighters(db);
    const lamps = allLamps();
    for (const [x, z] of TP.rond.lamps as Array<[number, number]>) {
      const l = lamps.find((q) => Math.hypot(q.x - x, q.z - z) < 0.05)!;
      expect(l, `${x}, ${z}`).toBeTruthy();
      expect(roundOf(l)).toBe("north");
    }
    const ids = lampRounds(db)!.rounds.flatMap((r) => r.lamps.map((l) => l.id));
    expect(ids.length).toBe(lamps.length);
  });

  it("the square's island, the benches' fronts and the greens' walks are reachable; their solids are wall", () => {
    const wm = walkMap();
    const front = (x: number, z: number, yaw: number, d: number): [number, number] => [x + Math.sin(yaw) * d, z + Math.cos(yaw) * d];
    for (const [x, z, y] of TP.rond.benches) expect(!!wm.nearestOpen(...front(x, z, y, 0.75), 0.8), `bench ${x}, ${z}`).toBe(true);
    expect(wm.reachable(TP.rond.c[0] + TP.rond.r_basin + 0.9, TP.rond.c[1])).toBe(true);
    expect(wm.reachable(TP.rond.c[0], TP.rond.c[1])).toBe(false); // the fountain
    for (const g of TP.greens) {
      for (const [x, z] of g.points) expect(!!wm.nearestOpen(x, z, 1.0), `${g.id} ${x}, ${z}`).toBe(true);
      for (const [x, z, y] of g.benches) expect(!!wm.nearestOpen(...front(x, z, y, 0.75), 0.8), `${g.id} bench ${x}, ${z}`).toBe(true);
    }
  });
});
