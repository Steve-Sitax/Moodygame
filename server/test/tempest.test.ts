import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { resetSync } from "../src/director/actions.ts";
import { eventRow, eventsTick, liveEvents, planEvent, publicEvent, type EventRow, type StoredStage } from "../src/director/scheduler.ts";
import { planFromTemplate, scriptFor, templateById } from "../src/director/templates.ts";
import { closedPlaces, tempestPhase } from "../src/director/state.ts";
import { weather } from "../src/day.ts";
import { GameError, takeJob } from "../src/game.ts";
import { keeperAtWork, patronsIn } from "../src/interiors/state.ts";
import { openShops } from "../src/shops/state.ts";
import { town } from "../src/town/store.ts";
import { activityAt } from "../src/town/schedule.ts";
import { shelterFor, tavernIds } from "../../shared/tempest.ts";

// The great storm (director/tempest.ts, shared/tempest.ts): it turns the weather, shuts every shop and stall,
// gives out no work, keeps the taverns open and fills them; at its end the shops open and the rain is left.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const toMin = (db: Db, m: number) => setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
const stagesOf = (ev: EventRow) => JSON.parse(ev.stages_json) as StoredStage[];

function toStage(db: Db, id: number, i: number): EventRow {
  const ev = eventRow(db, id)!;
  toMin(db, ev.start_m + stagesOf(ev).slice(0, i).reduce((a, s) => a + s.minutes, 0));
  eventsTick(db);
  eventsTick(db);
  return eventRow(db, id)!;
}

function planStorm(db: Db): EventRow {
  const p = planEvent(db, planFromTemplate(templateById("tempest")!, "engine", { start_in_min: 0 }), { dev: true });
  expect(p.ok, !p.ok ? p.why : "").toBe(true);
  return (p as { event: EventRow }).event;
}

beforeEach(() => resetSync());

describe("the great storm", () => {
  it("shuts the shops, gives out no work, keeps the taverns open and fills them; all back at its end", () => {
    const db = openDb(":memory:");
    setClock(db, 3, 10);
    db.prepare("UPDATE world_state SET value_json = '\"clear\"' WHERE key = 'weather'").run();
    const shopsBefore = openShops(db).filter((s) => s.open).length;
    expect(shopsBefore).toBeGreaterThan(0);
    const ev = planStorm(db);

    let cur = toStage(db, ev.id, 0);
    expect(cur.status).toBe("running");
    expect(tempestPhase(db)).toBe("coming");
    expect(weather(db)).toBe("storm");
    expect(openShops(db).filter((s) => s.open).length).toBe(0);
    expect(closedPlaces(db).length).toBeGreaterThan(0);
    expect(publicEvent(db, cur).tempest).toEqual({ phase: "coming" });

    cur = toStage(db, ev.id, 1);
    expect(tempestPhase(db)).toBe("peak");
    // no work: a job on the board cannot be taken
    const j = db.prepare("SELECT id FROM job WHERE status = 'offered' LIMIT 1").get() as { id: number } | undefined;
    if (j) expect(() => takeJob(db, j.id)).toThrow(GameError);
    // the taverns open whatever the hour, and those who ran in drink there (at most a room's worth)
    const t = town(db).town;
    const taverns = tavernIds(t.places);
    expect(taverns.length).toBeGreaterThan(0);
    for (const id of taverns) if (t.residents.some((r) => r.trade === "publican" && r.work.place === id)) expect(keeperAtWork(db, id)).toBe(true);
    const inAll = taverns.reduce((a, id) => a + patronsIn(db, id).length, 0);
    expect(inAll).toBeGreaterThan(10);

    cur = toStage(db, ev.id, 2);
    expect(tempestPhase(db)).toBe("easing");
    // over: the rain is left, the shops open again by their own hours, the work comes back
    toMin(db, cur.end_m + 1);
    eventsTick(db);
    expect(eventRow(db, ev.id)!.status).toBe("done");
    expect(tempestPhase(db)).toBe(null);
    expect(weather(db)).toBe("rain");
    expect(closedPlaces(db).length).toBe(0);
    expect(openShops(db).filter((s) => s.open).length).toBeGreaterThan(0);
  });

  it("calls the day's other events off, and nothing else is planned while it blows", () => {
    const db = openDb(":memory:");
    setClock(db, 3, 10);
    const other = planEvent(db, planFromTemplate(templateById("musicians")!, "engine", { start_in_min: 60 }), { dev: true });
    expect(other.ok).toBe(true);
    const ev = planStorm(db);
    toStage(db, ev.id, 0);
    expect(liveEvents(db).map((e) => e.template)).toEqual(["tempest"]);
    const later = planEvent(db, planFromTemplate(templateById("fish_auction")!, "engine", { start_in_min: 30 }));
    expect(later.ok).toBe(false);
  });

  it("sends each person the same way all through one storm: children home, tavern keepers to their tavern", () => {
    const db = openDb(":memory:");
    const t = town(db).town;
    const taverns = tavernIds(t.places);
    const kinds: Record<string, number> = {};
    for (const r of t.residents) {
      const now = activityAt(r.sched, 3, 11);
      const a = shelterFor(r, now, t.places, taverns, 7);
      expect(shelterFor(r, now, t.places, taverns, 7)).toEqual(a);
      if (r.age < 14 && a.kind !== "stay") expect(a.kind).toBe("home");
      if (r.trade === "publican" && r.work.place.startsWith("tavern:")) expect(a.kind === "stay" || (a.kind === "tavern" && a.place === r.work.place)).toBe(true);
      kinds[a.kind] = (kinds[a.kind] ?? 0) + 1;
    }
    expect(kinds.home).toBeGreaterThan(0);
    expect(kinds.tavern).toBeGreaterThan(0);
    expect(kinds.under).toBeGreaterThan(0);
  });

  it("is what the director gets when it asks for a gale in its own words", () => {
    expect(scriptFor({ template: "gale", title: "A gale off the sea" })?.id).toBe("tempest");
    expect(scriptFor({ template: "storm", title: "Storm" })?.id).toBe("tempest");
  });
});
