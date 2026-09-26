import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { applyHour, resetTickLimit, swim, tick, WARMTH } from "../src/day.ts";
import { forgetWhere, reportWhere, whereNow, WHERE_TTL_MS } from "../src/warmth.ts";
import { keeperAtWork } from "../src/interiors/state.ts";
import { warmByFire } from "../src/interiors/tavern.ts";
import { town } from "../src/town/store.ts";
import { atWork } from "../src/trade.ts";
import { takeKey } from "../src/homes/homes.ts";
import { shopTrade } from "../../shared/shops.ts";

// M7 warmth (docs/milestones/M7-warmth.md): the client says where Jef is and whether his lantern is lit;
// the engine checks it (a room that exists and is open now, a lantern in his pockets) and applies the
// cold hour by hour (day.ts applyHour). A forged or stale report counts as outside.

type Db = ReturnType<typeof openDb>;
const set = (db: Db, sql: string) => db.prepare(`UPDATE player SET ${sql} WHERE id = 1`).run();
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const warmth = (db: Db) => (db.prepare("SELECT warmth FROM player WHERE id = 1").get() as { warmth: number }).warmth;
const giveLantern = (db: Db) => db.prepare("INSERT INTO item (kind) VALUES ('lantern')").run();
const setWeather = (db: Db, w: string) =>
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('weather', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(w));

/** One game hour at `hour` from `from` warmth, Jef where the report says (the clock set to that hour first). */
function hourAt(db: Db, hour: number, from: number, where?: unknown): number {
  setClock(db, (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day, hour);
  set(db, `warmth = ${from}, food = 8, sleep = 8, health = 8`);
  forgetWhere();
  if (where !== undefined) reportWhere(where);
  applyHour(db, hour);
  return warmth(db);
}

function fresh(): Db {
  const db = openDb(":memory:");
  setClock(db, 2, 10); // a Tuesday
  setWeather(db, "clear");
  set(db, "money_c = 5000");
  return db;
}

/** A tavern and an hour it is open, and an hour it is shut. */
function tavernHours(db: Db): { place: string; open: number; shut: number } {
  const places = Object.keys(town(db).town.places).filter((k) => k.startsWith("tavern:"));
  for (const place of places) {
    let open = -1;
    let shut = -1;
    for (const h of [20, 22, 18, 12, 14, 4, 3, 7, 8, 10]) {
      setClock(db, 2, h);
      if (keeperAtWork(db, place)) {
        if (open < 0 && h % 2 === 0) open = h;
      } else if (shut < 0) shut = h;
    }
    if (open >= 0 && shut >= 0) return { place, open, shut };
  }
  throw new Error("no tavern with open and shut hours in the test town");
}

beforeEach(() => {
  resetTickLimit();
  forgetWhere();
});

describe("M7 warmth: outside", () => {
  it("with no report Jef is outside: -1 every 5 h by day, every 3 h at night, as before", () => {
    const db = fresh();
    expect(hourAt(db, 10, 6)).toBe(5);
    expect(hourAt(db, 12, 6)).toBe(6);
    expect(hourAt(db, 21, 6)).toBe(5);
    expect(hourAt(db, 22, 6)).toBe(6);
    expect(whereNow(db)).toMatchObject({ shelter: "outside", lantern: false });
  });

  it("a lit lantern in hand: -1 every 6 h by day and every 4 h at night", () => {
    const db = fresh();
    giveLantern(db);
    const lit = { at: null, lantern: true };
    expect(hourAt(db, 10, 6, lit)).toBe(6); // on foot this hour costs 1 (10 % 5)
    expect(hourAt(db, 12, 6, lit)).toBe(5); // 12 % 6
    expect(hourAt(db, 21, 6, lit)).toBe(6); // on foot 21 % 3 costs 1
    expect(hourAt(db, 0, 6, lit)).toBe(5); // 0 % 4
    // a night outside, 20:00 to 7:00: 4 points on foot, 3 with the lantern
    const night = (where?: unknown) => {
      let w = 8;
      for (const h of [20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6]) w = hourAt(db, h, w, where);
      return 8 - w;
    };
    expect(night()).toBe(4);
    expect(night(lit)).toBe(3);
  });

  it("a lantern Jef does not have counts for nothing", () => {
    const db = fresh();
    expect(hourAt(db, 21, 6, { at: null, lantern: true })).toBe(5);
    expect(whereNow(db).lantern).toBe(false);
  });

  it("wet, the lantern does not help: rain, a gale, or a swim not two game hours ago", () => {
    const db = fresh();
    giveLantern(db);
    const lit = { at: null, lantern: true };
    setWeather(db, "rain");
    expect(hourAt(db, 21, 6, lit)).toBe(5);
    setWeather(db, "storm");
    expect(hourAt(db, 21, 6, lit)).toBe(5);
    setWeather(db, "clear");
    setClock(db, 2, 20, 30);
    swim(db, 1_000_000);
    expect(hourAt(db, 21, 6, lit)).toBe(5); // 30 minutes after the swim
    expect(hourAt(db, 23, 6, lit)).toBe(6); // two and a half hours after: dry, 23 % 4 costs nothing
  });

  it("a stale report counts as outside", () => {
    const db = fresh();
    giveLantern(db);
    setClock(db, 2, 21);
    reportWhere({ at: null, lantern: true }, Date.now() - WHERE_TTL_MS - 1000);
    expect(whereNow(db).lantern).toBe(false);
    set(db, "warmth = 6");
    applyHour(db, 21);
    expect(warmth(db)).toBe(5);
  });
});

describe("M7 warmth: a heated room", () => {
  it("an open tavern: no loss, +1 every 2 h up to 7; the fire still gives +1 up to 10", () => {
    const db = fresh();
    const { place, open } = tavernHours(db);
    const inn = { at: place, lantern: false };
    expect(hourAt(db, open, 3, inn)).toBe(4); // an even hour: +1
    expect(hourAt(db, open + 1, 3, inn)).toBe(3); // odd: no gain, and no loss (outside 21 would cost 1)
    expect(hourAt(db, open, 6, inn)).toBe(7);
    expect(hourAt(db, open, 7, inn)).toBe(7); // the room alone stops at 7
    expect(hourAt(db, open, 9, inn)).toBe(9); // above the cap: no gain, no loss
    expect(hourAt(db, open, 10, inn)).toBe(10); // clamped at 10
    setClock(db, 2, open);
    set(db, "warmth = 7");
    expect(warmByFire(db, place).warmed).toBe(true);
    expect(warmth(db)).toBe(8);
    expect(whereNow(db)).toMatchObject({ shelter: "heated", place });
  });

  it("four hours in a cafe from cold: warmth 2 comes up to 4", () => {
    const db = fresh();
    const { place, open } = tavernHours(db);
    let w = 2;
    for (let h = open; h < open + 4; h++) {
      setClock(db, 2, h);
      if (!keeperAtWork(db, place)) break;
      w = hourAt(db, h, w, { at: place, lantern: false });
    }
    expect(w).toBeGreaterThanOrEqual(3);
    expect(w).toBeLessThanOrEqual(4);
  });

  it("a shut tavern, a tavern that does not exist, and garbage count as outside", () => {
    const db = fresh();
    const { place, shut } = tavernHours(db);
    setClock(db, 2, shut);
    reportWhere({ at: place, lantern: false });
    expect(whereNow(db).shelter).toBe("outside");
    expect(hourAt(db, 21, 6, { at: "tavern:nowhere", lantern: false })).toBe(5);
    expect(hourAt(db, 21, 6, { at: "the tavern; DROP TABLE player", lantern: true })).toBe(5);
    expect(hourAt(db, 21, 6, { at: 42 })).toBe(5);
    expect(hourAt(db, 21, 6, "inside")).toBe(5);
    expect(hourAt(db, 21, 6, null)).toBe(5);
    expect(hourAt(db, 21, 6, { at: "x".repeat(200) })).toBe(5);
  });

  it("the Poesje while its door is open; shut by day", () => {
    const db = fresh();
    expect(hourAt(db, 20, 3, { at: "poesje", lantern: false })).toBe(4);
    expect(hourAt(db, 12, 3, { at: "poesje", lantern: false })).toBe(3); // shut: outside, 12 % 5 costs nothing
    setClock(db, 2, 12);
    reportWhere({ at: "poesje", lantern: false });
    expect(whereNow(db).shelter).toBe("outside");
  });

  it("a shop with a stove is heated while open; the butcher's and the grocer's are only out of the wind; a shut shop is outside", () => {
    const db = fresh();
    const shops = town(db).town.shops;
    let warm: { id: string; h: number } | null = null;
    let cold: { id: string; h: number } | null = null;
    let shut: { id: string; h: number } | null = null;
    for (const h of [10, 12, 14, 16, 22, 4]) {
      setClock(db, 2, h);
      for (const s of shops) {
        const t = shopTrade(s.id);
        const open = atWork(db, s.keeper);
        if (open && t && !["butcher", "grocer", "chandler"].includes(t)) warm ??= { id: s.id, h };
        if (open && t && ["butcher", "grocer", "chandler"].includes(t)) cold ??= { id: s.id, h };
        if (!open) shut ??= { id: s.id, h };
      }
    }
    expect(warm && cold && shut).toBeTruthy();
    expect(hourAt(db, warm!.h, 3, { at: `shop:${warm!.id}`, lantern: false })).toBe(4);
    setClock(db, 2, cold!.h);
    reportWhere({ at: `shop:${cold!.id}`, lantern: false });
    expect(whereNow(db).shelter).toBe("sheltered");
    setClock(db, 2, shut!.h);
    reportWhere({ at: `shop:${shut!.id}`, lantern: false });
    expect(whereNow(db).shelter).toBe("outside");
    expect(hourAt(db, 12, 3, { at: "shop:nowhere", lantern: false })).toBe(3);
  });

  it("his own room: a hearth or a stove heats it, a bare garret is out of the wind, someone else's room is outside", () => {
    const db = fresh();
    expect(hourAt(db, 22, 3, { at: "home:alley", lantern: false })).toBe(3); // no key: outside (22 % 3 costs nothing)
    takeKey(db, "alley", "week"); // the alley house has its hearth
    expect(hourAt(db, 22, 3, { at: "home:alley", lantern: false })).toBe(4);
    expect(hourAt(db, 21, 6, { at: "home:garret", lantern: false })).toBe(5); // not his: outside

    const db2 = fresh();
    takeKey(db2, "garret", "week");
    expect(hourAt(db2, 21, 6, { at: "home:garret", lantern: false })).toBe(6); // out of the wind: 21 % 6
    expect(hourAt(db2, 0, 6, { at: "home:garret", lantern: false })).toBe(5); // 0 % 6
    db2.prepare("INSERT INTO home_item (kind, state, home, gx, gz, rot, day) VALUES ('stove', 'placed', 'garret', 3, 4, 0, 2)").run();
    expect(hourAt(db2, 0, 6, { at: "home:garret", lantern: false })).toBe(7);
  });
});

describe("M7 warmth: big unheated rooms", () => {
  it("the cathedral while open: -1 every 10 h by day, no gain; shut at night: outside", () => {
    const db = fresh();
    const nave = { at: "landmark:cathedral", lantern: false };
    expect(hourAt(db, 15, 6, nave)).toBe(6); // on foot 15 % 5 costs 1
    expect(hourAt(db, 10, 6, nave)).toBe(5);
    expect(hourAt(db, 12, 3, nave)).toBe(3); // no gain
    expect(hourAt(db, 21, 6, nave)).toBe(5); // shut after seven: outside
    expect(hourAt(db, 15, 6, { at: "landmark:castle", lantern: false })).toBe(5);
  });

  it("the churches and the prison in their hours; outside after", () => {
    const db = fresh();
    expect(hourAt(db, 15, 6, { at: "church:carolus", lantern: false })).toBe(6);
    expect(hourAt(db, 15, 6, { at: "church:gothic", lantern: false })).toBe(6);
    expect(hourAt(db, 15, 6, { at: "prison", lantern: false })).toBe(6); // visiting 14 to 17
    expect(hourAt(db, 20, 6, { at: "prison", lantern: false })).toBe(6); // 20 % 3 costs nothing anyway
    setClock(db, 2, 20);
    reportWhere({ at: "prison", lantern: false });
    expect(whereNow(db).shelter).toBe("outside");
    setClock(db, 2, 21);
    reportWhere({ at: "church:carolus", lantern: false });
    expect(whereNow(db).shelter).toBe("outside");
  });

  it("a lantern inside counts for nothing more", () => {
    const db = fresh();
    giveLantern(db);
    expect(hourAt(db, 10, 6, { at: "landmark:cathedral", lantern: true })).toBe(5);
  });
});

describe("M7 warmth: the tick", () => {
  it("a report with the tick counts for the hour it crosses", () => {
    const db = fresh();
    const { place, open } = tavernHours(db);
    setClock(db, 2, open - 1, 55);
    set(db, "warmth = 3");
    reportWhere({ at: place, lantern: false });
    const r = tick(db, 10_000);
    expect(r.advanced).toBe(true);
    expect(warmth(db)).toBe(4);
  });

  it("the numbers stay as written in the doc", () => {
    expect(WARMTH).toMatchObject({ day: 5, night: 3, lanternDay: 6, lanternNight: 4, shelteredDay: 10, shelteredNight: 6, roomEvery: 2, roomCap: 7 });
  });

  it("warmth stays within 0 and 10 wherever he is", () => {
    const db = fresh();
    const { place, open } = tavernHours(db);
    expect(hourAt(db, 21, 0)).toBe(0);
    expect(hourAt(db, open, 10, { at: place, lantern: false })).toBe(10);
    set(db, "warmth = 12");
    setClock(db, 2, open);
    reportWhere({ at: place, lantern: false });
    applyHour(db, open);
    expect(warmth(db)).toBe(10);
  });
});
