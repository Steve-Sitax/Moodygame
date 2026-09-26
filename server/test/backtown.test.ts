import { describe, expect, it } from "vitest";
import { openDb, resetDb } from "../src/db.ts";
import type { Resident } from "../src/town/population.ts";
import { activityAt } from "../src/town/schedule.ts";
import { dropTownCache, town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { backDoing, backKind, BACK_TRADES, ensureBackTown, generateBackTown, inBack, isBackId, wallWalk } from "../src/town/backtown.ts";
import { exchange, hourWords, line, type TalkKind } from "../src/town/backtalk.ts";
import { doing } from "../src/town/talk.ts";

// M7 back of town (Steve 2026-09-26: "There are no people in the back of town: make sure appropriate
// people, groups and gangs are there"). The engine's households of the back: the poor quarter round the
// court pumps and the corners, the better streets, the parish priests, a doctor, beggars at the church
// doors, the night watch, drunks, the estaminets, lovers, the Sunday strollers. What they do at each
// place is the place's kind; the lines they say are the engine's.

type DB = ReturnType<typeof openDb>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);

const db0 = openDb(":memory:");
const all0 = town(db0).town.residents;
const B = all0.filter((r) => isBackId(r.id));
// (M7 walk-up: the standing roles, ids "wu..", come after the back of town: not in what it was made from)
const rest0 = all0.filter((r) => !isBackId(r.id) && !/^wu\d+$/.test(r.id));
const places0 = town(db0).town.places;
const of = (t: string) => B.filter((r) => r.trade === t);

/** Where a person is out in the street now (null: indoors), roughly: the place of their hour. */
function outAt(r: Resident, places: Record<string, { x: number; z: number }>, day: number, hour: number): [number, number] | null {
  const now = activityAt(r.sched, day, hour);
  if (now.act === "home" || now.act === "church") return null;
  if (now.act === "work") {
    const w = r.work;
    if (w.kind === "inside") return null;
    if (w.at) return [w.at[0], w.at[1]];
    if (w.route?.length) return w.route[0];
    if (w.a) return w.a;
    const p = places[w.place];
    return p ? [p.x, p.z] : null;
  }
  const p = places[now.place];
  return p ? [p.x, p.z] : null;
}

describe("the back of town's people", () => {
  it("are made by the engine from the town's seed, after the rest of the town, without changing it", () => {
    const seed = town(db0).town.seed;
    const again = generateBackTown(seed, Object.fromEntries(Object.entries(places0).filter(([k]) => !backKind(k))), rest0);
    expect(again.residents.map((r) => r.id)).toEqual(B.map((r) => r.id));
    for (const r of B) expect(r.id).toMatch(/^bk\d{3}$/);
    expect(new Set(all0.map((r) => r.id)).size).toBe(all0.length);
    expect(new Set(all0.map((r) => r.name)).size).toBe(all0.length);
    // a real part of the town: about as many again as the town had (a Normal town)
    expect(B.length).toBeGreaterThan(150);
    expect(B.length).toBeLessThan(650);
  });

  it("has the people of the back: washerwomen, corner lads, old men, children, clerks and maids, priests, a doctor, beggars, the watch, drunks, publicans", () => {
    for (const t of BACK_TRADES) expect(of(t).length, t).toBeGreaterThan(0);
    expect(of("washerwoman").length).toBeGreaterThan(10);
    expect(of("loafer").length).toBeGreaterThanOrEqual(9);
    expect(of("watchman").length).toBeGreaterThanOrEqual(2);
    expect(of("parish_priest").length).toBe(2);
    expect(of("doctor").length).toBe(1);
    expect(of("beggar").length).toBe(3);
    expect(of("publican").length).toBeGreaterThanOrEqual(2);
    expect(of("child").length).toBeGreaterThan(30);
    expect(of("retired").length).toBeGreaterThan(10);
    expect(of("clerk").length).toBeGreaterThan(4);
    expect(of("maid").length).toBeGreaterThan(4);
    // they live in the back
    const home = B.filter((r) => inBack(r.home.sx, r.home.sz)).length;
    expect(home / B.length).toBeGreaterThan(0.9);
  });

  it("every home, workplace, place and route point is on open ground you can walk to", () => {
    const wm = walkMap();
    const bad: string[] = [];
    const check = (label: string, x: number, z: number) => {
      if (!wm.reachable(x, z)) bad.push(`${label} (${x}, ${z})`);
    };
    for (const r of B) {
      check(`${r.id} home`, r.home.sx, r.home.sz);
      if (r.work.at) check(`${r.id} at`, r.work.at[0], r.work.at[1]);
      if (r.work.door) check(`${r.id} door`, r.work.door[0], r.work.door[1]);
      for (const q of r.work.route ?? []) check(`${r.id} route`, q[0], q[1]);
      if (r.work.a) check(`${r.id} a`, r.work.a[0], r.work.a[1]);
    }
    for (const [id, p] of Object.entries(places0)) {
      if (!backKind(id)) continue;
      check(id, p.x, p.z);
      for (const q of p.route ?? []) check(`${id} route`, q[0], q[1]);
    }
    expect(bad).toEqual([]);
    // the walk on the wall has its points, and the park its paths
    expect(wallWalk().length).toBeGreaterThan(20);
    expect(places0.walk?.route?.length ?? 0).toBeGreaterThan(20);
    expect(places0.park?.route?.length ?? 0).toBeGreaterThan(8);
  });

  it("groups: gangs of two to five lads at a few corners, card games of up to five, neighbours in knots of up to four, five women at a pump at most", () => {
    const by = (pred: (r: Resident) => boolean, key: (r: Resident) => string[]) => {
      const m = new Map<string, number>();
      for (const r of B.filter(pred)) for (const k of new Set(key(r))) m.set(k, (m.get(k) ?? 0) + 1);
      return m;
    };
    const segPlaces = (prefix: string) => (r: Resident) => [...r.sched.day, ...r.sched.sunday].map((s) => s[3] ?? "").filter((p) => p.startsWith(prefix));
    const gangs = by((r) => r.trade === "loafer", segPlaces("corner:"));
    expect(gangs.size).toBeGreaterThanOrEqual(3);
    for (const [k, n] of gangs) expect(n, k).toBeLessThanOrEqual(5);
    expect([...gangs.values()].filter((n) => n >= 3).length).toBeGreaterThanOrEqual(3);
    const cards = by((r) => r.trade === "retired" && r.sex === "m", segPlaces("cards:"));
    for (const [k, n] of cards) expect(n, k).toBeLessThanOrEqual(5);
    const gossip = by((r) => r.sex === "f" && r.trade !== "washerwoman", segPlaces("gossip:"));
    expect(gossip.size).toBeGreaterThan(5);
    const pumps = by((r) => r.trade === "washerwoman", (r) => [r.work.place]);
    for (const [k, n] of pumps) expect(n, k).toBeLessThanOrEqual(5);
    // lovers: a lad and a girl of two households, the same evening and the same spot
    const lovers = B.filter((r) => r.sched.day.some((s) => s[3]?.startsWith("lovers:")));
    expect(lovers.length).toBeGreaterThanOrEqual(2);
    for (const r of lovers) {
      const mate = B.find((o) => o.id === r.mate)!;
      expect(mate, r.id).toBeTruthy();
      expect(mate.household).not.toBe(r.household);
      expect(mate.sex).not.toBe(r.sex);
    }
  });

  it("the back is out at every hour: by day the pumps, corners, doorsteps and courts; at night the watch, the lads and the drunks", () => {
    const places = places0 as Record<string, { x: number; z: number }>;
    const count = (day: number, hour: number) => B.filter((r) => {
      const p = outAt(r, places, day, hour);
      return p && inBack(p[0], p[1]);
    }).length;
    const before = (day: number, hour: number) => rest0.filter((r) => {
      const p = outAt(r, places, day, hour);
      return p && inBack(p[0], p[1]);
    }).length;
    // a weekday (Wednesday) and a Sunday
    expect(count(3, 8)).toBeGreaterThan(40);
    expect(count(3, 13)).toBeGreaterThan(70);
    expect(count(3, 18)).toBeGreaterThan(60);
    expect(count(3, 22)).toBeGreaterThan(20);
    expect(count(7, 13)).toBeGreaterThan(60);
    expect(count(7, 18)).toBeGreaterThan(50);
    // (the town as it was had next to nobody there: the measurement that started this)
    expect(before(3, 13)).toBeLessThan(15);
    // the watch only by night, with a round of the back's corners
    for (const w of of("watchman")) {
      expect(activityAt(w.sched, 3, 14).act).toBe("home");
      expect(activityAt(w.sched, 3, 23).act).toBe("work");
      expect(activityAt(w.sched, 4, 3).act).toBe("work"); // (the night of Wednesday into Thursday)
      expect(w.work.route!.length).toBeGreaterThanOrEqual(2);
    }
    // the lads are at their corner late, the washerwomen at the pump in working hours
    expect(of("loafer").filter((r) => activityAt(r.sched, 3, 22).place.startsWith("corner:")).length).toBeGreaterThan(5);
    for (const w of of("washerwoman")) expect(activityAt(w.sched, 3, 9).act).toBe("work");
    // schedules in order, no overlaps
    for (const r of B)
      for (const segs of [r.sched.day, r.sched.sunday])
        for (let i = 1; i < segs.length; i++) expect(segs[i][0], `${r.id} ${JSON.stringify(segs)}`).toBeGreaterThanOrEqual(segs[i - 1][1]);
  });

  it("the talk says what they are about", () => {
    const db = db0;
    const wash = of("washerwoman")[0];
    setClock(db, 3, 9);
    expect(doing(db, wash)).toMatch(/pump/);
    const lad = of("loafer").find((r) => activityAt(r.sched, 3, 16).place.startsWith("corner:"))!;
    setClock(db, 3, 16);
    expect(doing(db, lad)).toMatch(/corner/);
    const w = of("watchman")[0];
    setClock(db, 3, 23);
    expect(doing(db, w)).toMatch(/night round/);
    expect(backDoing(lad, "park")).toMatch(/Stadspark/);
  });
});

describe("the save: in place, once", () => {
  it("an older save gets the same people in place, and nothing else changes", () => {
    const db = openDb(":memory:");
    const bk = town(db).town.residents.filter((r) => isBackId(r.id));
    expect(bk.length).toBe(B.length);
    // make it an older save: take them out, and their places
    // (M7 walk-up: an older save has not the standing roles either, ids "wu..": they come after the back of town)
    const wu = town(db).town.residents.filter((r) => /^wu\d+$/.test(r.id));
    for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) for (const r of [...bk, ...wu]) db.prepare(`DELETE FROM ${t} = ?`).run(r.id);
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string };
    const tw = JSON.parse(row.value_json);
    for (const k of Object.keys(tw.places)) if (backKind(k)) delete tw.places[k];
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(tw));
    dropTownCache(db);
    const before = new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json]));
    const mem = (db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n;
    const jef = db.prepare("SELECT * FROM player WHERE id = 1").get();
    const added = ensureBackTown(db);
    expect(added).toBe(bk.length);
    const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
    expect(after.length).toBe(before.size + added);
    for (const r of after) if (before.has(r.id)) expect(r.data_json, r.id).toBe(before.get(r.id));
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(mem);
    expect(db.prepare("SELECT * FROM player WHERE id = 1").get()).toEqual(jef);
    for (const r of after.filter((r) => !before.has(r.id))) expect(db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id), r.id).toBeTruthy();
    expect(Object.keys(town(db).town.places).filter((k) => k.startsWith("pump:")).length).toBeGreaterThan(8);
    // once
    expect(ensureBackTown(db)).toBe(0);
    // a new week: a new town with its back
    resetDb(db);
    expect(town(db).town.residents.filter((r) => isBackId(r.id)).length).toBeGreaterThan(150);
  });
});

describe("what they say (the engine's lines)", () => {
  const v = { names: ["Trien", "Mie", "Stans"], neighbour: "Gust", hour: 22.5, weather: "fog" };
  it("every kind has lines; the names go in; plain English, short", () => {
    const kinds: TalkKind[] = ["pump", "corner", "menace", "menace_night", "move_along", "cards", "gossip", "step", "drunk", "watch", "lovers", "stroll"];
    for (const k of kinds) {
      for (let i = 0; i < 40; i++) {
        const ex = exchange(k, `${k}:${i}`, v);
        expect(ex.length, k).toBeGreaterThan(0);
        for (const e of ex) {
          expect(e.text.length).toBeLessThan(140);
          expect(e.text).not.toMatch(/[{}]/);
          expect(e.text).not.toMatch(/\b(jongen|maat|allee|ja|nee)\b/i);
          expect(e.slot).toBeLessThan(v.names.length);
        }
      }
    }
    // a pair only gets exchanges for two
    for (let i = 0; i < 30; i++) for (const e of exchange("pump", `p${i}`, { ...v, names: ["Trien", "Mie"] })) expect(e.slot).toBeLessThan(2);
  });
  it("the watch calls the hour, and the weather as it is", () => {
    expect(hourWords(22.5)).toBe("Ten o'clock");
    expect(hourWords(0.2)).toBe("Midnight");
    expect(hourWords(3)).toBe("Three o'clock");
    for (let i = 0; i < 30; i++) {
      const clear = line("watch", `w${i}`, { ...v, weather: "clear" })!;
      expect(clear).not.toMatch(/foggy/);
      expect(clear).toMatch(/^Ten o'clock/);
    }
  });
});
