import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { resetTickLimit } from "../src/day.ts";
import { player } from "../src/game.ts";
import { board, calls, RIDE_LINES, timetable } from "../src/ride.ts";
import { offLanes } from "../src/town/possessions.ts";
import {
  absMinute,
  departures,
  inService,
  LINES,
  lineTiming,
  loopPath,
  nextSlot,
  passes,
  SERVICE_FIRST,
  SERVICE_LAST,
  STOPS,
} from "../../shared/omnibusLines.ts";

// M7 omnibus routes (docs/milestones/M7-omnibus-routes.md): three lines, the timetable the engine owns.

type DB = ReturnType<typeof openDb>;
const set = (db: DB, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();

beforeEach(() => resetTickLimit());

describe("the omnibus network", () => {
  it("every stop lies on its line's round, once or more; every line has its terminus", () => {
    for (const l of LINES) {
      const p = loopPath(l.route, 5);
      const mine = STOPS.filter((s) => s.line === l.id);
      expect(mine.some((s) => s.id === l.terminus)).toBe(true);
      for (const s of mine) expect(passes(p, s.x, s.z, 1.5).length, `${l.id} ${s.id}`).toBeGreaterThan(0);
      // the post stands off the lane (the body is 1.72 m wide), never on it
      for (const s of mine) expect(Math.hypot(s.post[0] - s.x, s.post[1] - s.z), `${s.id} post`).toBeGreaterThan(2);
    }
  });

  it("the new lines reach the back of town: the gates, the churches, the park", () => {
    expect(RIDE_LINES.keizer).toEqual(["keizerspoort", "sint_paulus", "keizerstraat", "conscienceplein", "meir", "sint_jacob", "kipdorppoort", "ramparts"]);
    for (const s of ["sint_jorispoort", "stadspark", "cathedral", "grote_markt"]) expect(calls("markt", s)).toBe(true);
    // changes: the Vismarkt (quays and town) and the road to the Meir (both town lines)
    expect(RIDE_LINES.markt.filter((s) => RIDE_LINES.keizer.includes(s))).toEqual(["meir"]);
    expect(RIDE_LINES.kaaien.filter((s) => RIDE_LINES.markt.includes(s))).toEqual(["vismarkt"]);
  });

  it("props and parked carts keep off the new lanes too (possessions LANES read the same rounds)", () => {
    expect(offLanes(-145, 300)).toBe(false); // the Meir by Sint-Jacob
    expect(offLanes(-60, 349)).toBe(false); // the wall street by the Ramparts
    expect(offLanes(10, 221)).toBe(false); // the Keizerstraat
    expect(offLanes(-330, 150)).toBe(false); // the gate road to the Sint-Jorispoort
    expect(offLanes(-304.5, 200)).toBe(false); // the cathedral's south side
  });
});

describe("the timetable (the engine's numbers)", () => {
  it("a line's omnibuses share the round: headway x omnibuses covers the planned round", () => {
    for (const l of LINES) {
      const t = lineTiming(l.id);
      expect(t.headwayMin * l.buses).toBeGreaterThanOrEqual(t.roundMin);
      expect(t.headwayMin % 5).toBe(0);
      expect(t.offsetMin[l.terminus]).toBe(0);
      for (const v of Object.values(t.offsetMin)) expect(v).toBeLessThan(t.roundMin);
    }
  });

  it("departures run from 6:00 to 22:00 at the terminus; after the last, the first of the next morning", () => {
    const h = lineTiming("keizer").headwayMin;
    expect(nextSlot("keizer", absMinute(2, 3))).toBe(absMinute(2, 6));
    expect(nextSlot("keizer", absMinute(2, 6, 1))).toBe(absMinute(2, 6) + h);
    const late = nextSlot("keizer", absMinute(2, 22, 1));
    expect(late).toBe(absMinute(3, 6));
    // every departure of a day lies in the service hours
    for (let m = absMinute(4, 0); m < absMinute(5, 0); m += 7) {
      const s = nextSlot("markt", m);
      const mod = s % 1440;
      expect(mod >= SERVICE_FIRST && mod <= SERVICE_LAST).toBe(true);
    }
  });

  it("at a stop the next omnibuses are due in order, the stop's offset after the terminus", () => {
    const now = absMinute(3, 13, 10);
    const d = departures("markt", "stadspark", now, 4);
    expect(d.length).toBe(4);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d[0]).toBeGreaterThanOrEqual(now);
    const off = lineTiming("markt").offsetMin.stadspark;
    expect((d[0] - off) % 1440 >= SERVICE_FIRST).toBe(true);
    expect(departures("markt", "werf", now)).toEqual([]); // the Grote Markt line does not call at the Werf
  });

  it("no ride at 3 in the night: the conductor is not there; by day the fare as ever", () => {
    const db = openDb(":memory:");
    set(db, "money_c = 50, day = 2, hour = 3, minute = 0");
    expect(inService("keizer", "sint_jacob", absMinute(2, 3))).toBe(false);
    expect(() => board(db, "sint_jacob", "keizer")).toThrow(/do not run now: the first is due here at 7:52/);
    expect(player(db).money_c).toBe(50);
    set(db, "hour = 13");
    expect(board(db, "sint_jacob", "keizer").fare_c).toBe(5);
    expect(player(db).money_c).toBe(45);
  });

  it("the timetable at a stop, by the game clock (E at the post)", () => {
    const db = openDb(":memory:");
    set(db, "day = 2, hour = 13, minute = 0");
    const t = timetable(db, "meir");
    expect(t.lines.map((l) => l.line)).toEqual(["markt", "keizer"]);
    for (const l of t.lines) expect(l.next).toHaveLength(3);
    expect(t.text).toMatch(/^The road to the Meir\. The Grote Markt line: every \d+ minutes, next at \d+:\d\d/);
  });
});
