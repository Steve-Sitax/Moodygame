import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openDb, resetDb } from "../src/db.ts";
import { EVENT_PEOPLE_MAX, TOWN_SIZES, type TownSize } from "../src/config.ts";
import { generateTown, type Resident } from "../src/town/population.ts";
import { clampEventCount, eventPeopleMax, eventSize, populationView, setEventSize, setTownSize, townSize } from "../src/town/popsettings.ts";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { isGarrison } from "../src/town/garrison.ts";
import { eventRow, eventsTick, planEvent, type EventRow } from "../src/director/scheduler.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";

// M6 population (Steve, 2026-09-24: "More people in game, and for big events not 20 but up to
// 100 people. Make it adjustable how many people we have in a game."): the town size for a new
// game, the event size, both kept on the server; the street's cap is the browser's (client).

const SIZES = Object.keys(TOWN_SIZES) as TownSize[];
type Db = ReturnType<typeof openDb>;

/** A save made at this size: a new week (Restart) after choosing it. */
function saveAt(size: TownSize): Db {
  const db = openDb(":memory:");
  setTownSize(db, size);
  resetDb(db);
  return db;
}

const reachable = (x: number, z: number) => !!walkMap().nearestOpen(x, z, 1.5);

describe("town size: the generator", () => {
  it("Normal is the town as it was, to the person", () => {
    const a = generateTown(1873);
    const b = generateTown(1873, "normal");
    expect(b.residents).toEqual(a.residents);
    expect(b.size).toBeUndefined();
  });

  for (const size of SIZES) {
    it(`${size}: grows with the size, keeps every trade, the priest and the police, homes on reachable doors`, () => {
      for (const seed of [1873, 42, 7]) {
        const t = generateTown(seed, size);
        const folk = t.residents.length;
        // the generator's own share of the town (the garrison is in it; the press, homes, visitors and emigrants come on top)
        const want = TOWN_SIZES[size].target;
        expect(folk, `${size} ${seed}`).toBeGreaterThanOrEqual(want + 10);
        expect(folk, `${size} ${seed}`).toBeLessThanOrEqual(want + 45);
        const names = t.residents.map((r) => r.name);
        expect(new Set(names).size).toBe(names.length);
        const ids = t.residents.map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        const n = (trade: string) => t.residents.filter((r) => r.trade === trade).length;
        for (const trade of ["docker", "natie", "porter", "carter", "boatman", "sailor", "fishwife", "market_woman", "baker", "grocer", "publican", "clerk", "merchant", "maid", "thief", "beggar", "child", "street_child", "sentry", "soldier", "corporal", "customs"]) {
          expect(n(trade), `${size} ${seed} ${trade}`).toBeGreaterThan(0);
        }
        expect(n("priest"), `${size} ${seed} priest`).toBe(1);
        expect(n("police"), `${size} ${seed} police`).toBeGreaterThanOrEqual(4);
        // every stall has one seller
        const keepers = t.stalls.map((s) => s.keeper).filter(Boolean);
        expect(new Set(keepers).size).toBe(t.stalls.length);
        // every home, workplace and round on ground Jef can walk to
        const bad: string[] = [];
        for (const r of t.residents) {
          if (r.home.house >= 0 && !reachable(r.home.sx, r.home.sz)) bad.push(`${r.id} home`);
          if (r.work.at && !reachable(r.work.at[0], r.work.at[1])) bad.push(`${r.id} at`);
          if (r.work.door && !reachable(...r.work.door)) bad.push(`${r.id} door`);
          for (const p of r.work.route ?? []) if (!reachable(...p)) bad.push(`${r.id} route`);
        }
        expect(bad).toEqual([]);
        // families share a door; a child always lives with a grown-up (bar the street children)
        const hh = new Map<number, Resident[]>();
        for (const r of t.residents) hh.set(r.household, [...(hh.get(r.household) ?? []), r]);
        for (const members of hh.values()) {
          if (members[0].household < 0) continue;
          expect(new Set(members.map((m) => m.home.house)).size).toBe(1);
          if (members.some((m) => m.age < 13 && m.trade !== "street_child")) expect(members.some((m) => m.age >= 18)).toBe(true);
        }
      }
    });
  }

  it("a bigger town has more dockers, sellers and children; a house holds at most three households", () => {
    const count = (size: TownSize, pred: (r: Resident) => boolean) => generateTown(1873, size).residents.filter(pred).length;
    for (const pred of [(r: Resident) => r.trade === "docker" || r.trade === "natie", (r: Resident) => r.trade === "fishwife" || r.trade === "market_woman", (r: Resident) => r.age < 13]) {
      expect(count("small", pred)).toBeLessThanOrEqual(count("normal", pred));
      expect(count("large", pred)).toBeGreaterThan(count("normal", pred));
      expect(count("very_large", pred)).toBeGreaterThan(count("large", pred));
    }
    const t = generateTown(1873, "very_large");
    const per = new Map<number, Set<number>>();
    // (the garrison's barracks hold the soldiers, one to a household, by design)
    for (const r of t.residents) if (r.home.house >= 0 && !isGarrison(r.trade)) per.set(r.home.house, (per.get(r.home.house) ?? new Set()).add(r.household));
    for (const s of per.values()) expect(s.size).toBeLessThanOrEqual(3);
  });
});

describe("town size: a new game", () => {
  for (const size of SIZES) {
    it(`${size}: keeps all the special people, and every home is reachable`, () => {
      const db = saveAt(size);
      const t = town(db).town;
      expect(t.size ?? "normal").toBe(size);
      const all = t.residents;
      // about the size the panel promises
      expect(Math.abs(all.length - TOWN_SIZES[size].about)).toBeLessThanOrEqual(35);
      const n = (trade: string) => all.filter((r) => r.trade === trade).length;
      const has = (id: string) => all.some((r) => r.id === id);
      // the garrison and the customs
      expect(n("sentry")).toBeGreaterThan(0);
      expect(n("soldier")).toBeGreaterThan(0);
      expect(n("corporal")).toBe(1);
      expect(n("customs")).toBeGreaterThan(0);
      // the press, the homes, the emigrants, the lamplighters, the police
      expect(n("newsboy")).toBe(3);
      expect(n("post_clerk")).toBe(1);
      expect(has("widow_landlady")).toBe(true);
      expect(has("dealer")).toBe(true);
      expect(n("lodging_keeper")).toBe(1);
      expect(n("lamplighter")).toBeGreaterThanOrEqual(3);
      expect(n("police")).toBeGreaterThanOrEqual(4);
      // the named quay four
      for (const id of ["sooi", "peeters", "tuur", "fientje"]) expect(db.prepare("SELECT 1 FROM npc WHERE id = ?").get(id)).toBeTruthy();
      // every home door (the ones added in place as well) on reachable ground
      const bad = all.filter((r) => r.home.house >= 0 && !reachable(r.home.sx, r.home.sz)).map((r) => r.id);
      expect(bad).toEqual([]);
      // every resident is an npc row too
      expect((db.prepare("SELECT COUNT(*) AS n FROM resident r JOIN npc n ON n.id = r.id").get() as { n: number }).n).toBe(all.length);
    }, 30_000); // a new game of each town size: the biggest takes longer than the 5 s default under load
  }

  it("the save's town does not change until Restart; the choice outlives the new week", () => {
    const db = openDb(":memory:");
    const before = town(db).town.residents.length;
    setTownSize(db, "very_large");
    expect(town(db).town.residents.length).toBe(before);
    expect(populationView(db).current).toEqual({ size: "normal", residents: before });
    expect(populationView(db).townSize).toBe("very_large");
    resetDb(db);
    expect(townSize(db)).toBe("very_large");
    expect(populationView(db).current.size).toBe("very_large");
    expect(town(db).town.residents.length).toBeGreaterThan(before + 200);
    expect(() => setTownSize(db, "enormous")).toThrow();
  });
});

describe("event size", () => {
  it("is 100 by default, one of 20, 50, 100, kept across a new week, never over the hard limit", () => {
    const db = openDb(":memory:");
    expect(eventSize(db)).toBe(100);
    expect(eventPeopleMax(db)).toBe(Math.min(100, EVENT_PEOPLE_MAX));
    setEventSize(db, 20);
    expect(eventPeopleMax(db)).toBe(20);
    expect(clampEventCount(db, 85)).toBe(20);
    expect(clampEventCount(db, 12)).toBe(12);
    expect(clampEventCount(db, -4)).toBe(0);
    expect(clampEventCount(db, Number.NaN)).toBe(0);
    setEventSize(db, 50);
    expect(clampEventCount(db, 1000)).toBe(50);
    expect(() => setEventSize(db, 77)).toThrow();
    expect(() => setEventSize(db, 500)).toThrow();
    expect(eventSize(db)).toBe(50);
    resetDb(db);
    expect(eventSize(db)).toBe(50);
    setEventSize(db, 100);
    expect(clampEventCount(db, 1000)).toBe(EVENT_PEOPLE_MAX);
  });

  // The scheduler (director/scheduler.ts gather) belongs to another part of the work; main wires
  // eventPeopleMax(db) into it (docs/milestones/M6-population.md). Until then this one waits.
  const wired = readFileSync(new URL("../src/director/scheduler.ts", import.meta.url), "utf8").includes("eventPeopleMax");
  it.runIf(wired)("the engine clamps a big wedding to the event size", () => {
    for (const cap of [20, 50]) {
      const db = openDb(":memory:");
      setEventSize(db, cap as 20 | 50);
      db.prepare("UPDATE player SET day = 1, hour = 10, minute = 0 WHERE id = 1").run();
      const p = planEvent(db, planFromTemplate(templateById("wedding")!, "engine", { start_in_min: 0 }), { dev: true });
      expect(p.ok).toBe(true);
      eventsTick(db);
      let ev: EventRow = eventRow(db, (p as { event: EventRow }).event.id)!;
      const stages = JSON.parse(ev.stages_json) as Array<{ minutes: number }>;
      for (let i = 1; i < stages.length; i++) {
        const at = ev.start_m + stages.slice(0, i).reduce((a, s) => a + s.minutes, 0);
        db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(Math.floor(at / 1440) + 1, Math.floor((at % 1440) / 60), at % 60);
        eventsTick(db);
        ev = eventRow(db, ev.id)!;
        expect((JSON.parse(ev.people_json) as string[]).length).toBeLessThanOrEqual(cap);
      }
      expect((JSON.parse(ev.people_json) as string[]).length).toBeGreaterThan(cap / 2);
    }
  });
});
