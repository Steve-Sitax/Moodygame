import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { reportAction, resetSync } from "../src/director/actions.ts";
import { setHiringRoll, setHiringRunner } from "../src/director/hiring.ts";
import { eventRow, eventsTick, gather, leadsOf, onErrand, planEvent, ROUTINE_EARLY_MIN, type EventRow, type StoredStage } from "../src/director/scheduler.ts";
import { errandsFor } from "../src/town/possessions.ts";
import { resident } from "../src/town/store.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";
import { balladTick, CROWD, planBallad, writeBallad } from "../src/ballads/ballad.ts";
import { walkMap } from "../src/town/walkmap.ts";

// Fixes 2026-09-24 (afternoon), from a photographer's long sessions on a big-town save: the ballad
// singer's crowd is called when the singing is planned (a game hour is 20 s of play: gathered at
// the start, they came in late), a routine event starts at the tick nearest its hour, a crowd
// member at their place is "there", not "going" all through; the dawn hiring's men gather from
// 5:00 with the call still about 6:20; the fire pump stands where the lane has room, clear of the
// bucket chain.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const stagesOf = (ev: EventRow) => JSON.parse(ev.stages_json) as StoredStage[];
const activeFor = (db: Db, ev: number) => db.prepare("SELECT id, npc_id, phase, data_json FROM npc_action WHERE status = 'active' AND event_id = ?").all(ev) as Array<{ id: number; npc_id: string; phase: string; data_json: string }>;
const noModel: Runner = async () => {
  throw new Error("no model in tests");
};
const GOOD_BALLAD = {
  title: "A Song of the Quays",
  verses: [
    ["Come all you good people, and hark to my song,", "The fog on the Schelde lay heavy and long,", "The dockers went down to the gates in the grey,", "And sang as they waited the length of the day."],
    ["The Schelde came up and the Schelde went down,", "The barges came in to the heart of the town,", "The bells of the tower rang over the square,", "And every good woman was glad to be there."],
  ],
  chorus: ["Sing fog on the river, sing rain on the quay,", "There's news in the town for a centime from me."],
};

function fresh(day = 2, hour = 8): Db {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, 'npc_convo', 'claude', 'x', 1, 1)").run(day);
  return db;
}

beforeEach(() => {
  resetSync();
  setHiringRunner(noModel);
});
afterEach(() => {
  setHiringRoll(null);
  setHiringRunner(undefined);
});

describe("fixes 2026-09-24: the ballad singer's crowd", () => {
  it("is called when the singing is planned, an hour before; the singer is cast then too", async () => {
    const db = fresh(2, 8);
    await writeBallad(db, async () => ({ output: GOOD_BALLAD }));
    setClock(db, 2, 8, 20);
    balladTick(db);
    expect(db.prepare("SELECT COUNT(*) n FROM town_event WHERE template = 'ballad'").get()).toEqual({ n: 0 }); // too early
    setClock(db, 2, 8, 30);
    balladTick(db);
    const ev = db.prepare("SELECT * FROM town_event WHERE template = 'ballad'").get() as EventRow;
    expect(ev.status).toBe("planned");
    // the singer and his listeners are already on their way, long before 9:30
    expect(leadsOf(ev).some((l) => l.role === "ballad_singer")).toBe(true);
    const going = activeFor(db, ev.id);
    expect(going.length).toBeGreaterThanOrEqual(4);
    expect(going.length).toBeLessThanOrEqual(CROWD + 1);
    // every action lasts to the end of the singing
    const until = db.prepare("SELECT MIN(until) m FROM npc_action WHERE status = 'active' AND event_id = ?").get(ev.id) as { m: number };
    expect(until.m).toBeGreaterThanOrEqual(ev.end_m);
  });

  it("at its start the crowd is topped up, not doubled, and the singer is not cast twice", async () => {
    const db = fresh(2, 9);
    await writeBallad(db, async () => ({ output: GOOD_BALLAD }));
    const r = planBallad(db, "grote_markt", 30);
    expect(r.ok).toBe(true);
    const id = (r as { event: EventRow }).event.id;
    const before = activeFor(db, id).length;
    setClock(db, 2, 9, 30);
    eventsTick(db);
    const ev = eventRow(db, id)!;
    expect(ev.status).toBe("running");
    expect(leadsOf(ev).filter((l) => l.role === "ballad_singer").length).toBe(1);
    const after = activeFor(db, id).length;
    expect(after).toBeGreaterThanOrEqual(before);
    expect(after).toBeLessThanOrEqual(CROWD + 1);
    expect((JSON.parse(ev.people_json) as string[]).length).toBe(new Set(JSON.parse(ev.people_json) as string[]).size);
  });

  it("a routine event starts at the tick nearest its hour; any other one never early", async () => {
    const db = fresh(2, 9);
    await writeBallad(db, async () => ({ output: GOOD_BALLAD }));
    const r = planBallad(db, "vismarkt", 30); // 9:30
    const id = (r as { event: EventRow }).event.id;
    setClock(db, 2, 9, 30 - ROUTINE_EARLY_MIN - 1);
    eventsTick(db);
    expect(eventRow(db, id)!.status).toBe("planned");
    setClock(db, 2, 9, 30 - ROUTINE_EARLY_MIN);
    eventsTick(db);
    expect(eventRow(db, id)!.status).toBe("running");
    // a street event (not the routine) waits for its minute
    const db2 = fresh(2, 13);
    const p = planEvent(db2, planFromTemplate(templateById("scuffle")!, "engine", { start_in_min: 10 }), { dev: true });
    expect(p.ok).toBe(true);
    const sid = (p as { event: EventRow }).event.id;
    setClock(db2, 2, 13, 5);
    eventsTick(db2);
    expect(eventRow(db2, sid)!.status).toBe("planned");
  });

  it("someone who reached their place in the ring is 'there' (a report the client sends), once", async () => {
    const db = fresh(2, 9);
    await writeBallad(db, async () => ({ output: GOOD_BALLAD }));
    const r = planBallad(db, "grote_markt", 0);
    const id = (r as { event: EventRow }).event.id;
    const a = activeFor(db, id).find((x) => (JSON.parse(x.data_json) as { role?: string }).role === "crowd")!;
    expect(a.phase).toBe("going");
    const row = await reportAction(db, a.id, { phase: "arrived", x: 1, z: 2 });
    expect(row?.phase).toBe("there");
    expect(row?.status).toBe("active");
    // lost or blocked says nothing new
    const again = await reportAction(db, a.id, { phase: "lost" });
    expect(again?.phase).toBe("there");
  });
});

describe("fixes 2026-09-24: the dawn hiring", () => {
  it("the men are called from 5:00 and the names at about 6:20, both gates", () => {
    const db = fresh(1, 4);
    setClock(db, 1, 4, 45);
    eventsTick(db);
    const ev0 = db.prepare("SELECT * FROM town_event WHERE template = 'hiring'").get() as EventRow;
    expect(ev0).toBeTruthy();
    expect(ev0.start_m % 1440).toBe(5 * 60);
    const st = stagesOf(ev0);
    expect(st[0].act).toBe("hire_gather");
    // the call's stage begins at 6:20
    expect((ev0.start_m + st[0].minutes) % 1440).toBe(6 * 60 + 20);
    setClock(db, 1, 5, 0);
    eventsTick(db);
    const ev = eventRow(db, ev0.id)!;
    expect(ev.status).toBe("running");
    const h = stagesOf(ev)[0].hiring!;
    expect(h.spots.length).toBe(2);
    for (const sp of h.spots) expect(sp.men.length).toBeGreaterThan(3);
    // each man has his place before his gate (an attend action with a slot near the foreman)
    const acts = activeFor(db, ev.id);
    for (const sp of h.spots)
      for (const id of sp.men) {
        const a = acts.find((x) => x.npc_id === id);
        expect(a, id).toBeTruthy();
      }
  });
});

describe("fixes 2026-09-24: the fire pump", () => {
  it("stands where the lane has room round it, clear of the bucket chain", () => {
    const db = fresh(3, 18);
    const p = planEvent(db, planFromTemplate(templateById("house_fire")!, "engine", { start_in_min: 0 }), { dev: true });
    expect(p.ok, !p.ok ? p.why : "").toBe(true);
    const id = (p as { event: EventRow }).event.id;
    eventsTick(db);
    const f = stagesOf(eventRow(db, id)!)[0].fire!;
    const [x, z] = f.pumpAt;
    const wm = walkMap();
    expect(wm.reachable(x, z)).toBe(true);
    expect(wm.open(x, z, 1.1)).toBe(true);
    for (const [cx, cz] of f.chain) expect(Math.hypot(cx - x, cz - z)).toBeGreaterThanOrEqual(2.2 - 1e-6);
  });
});

describe("fixes 2026-09-24: the boat errand", () => {
  it("someone out on the family boat's errand is not taken for an event's crowd", async () => {
    const db = fresh(2, 7);
    const boat = errandsFor(db, 2).find((e) => e.kind === "boat");
    expect(boat).toBeTruthy();
    const h = Math.floor(boat!.hour + 0.5);
    setClock(db, 2, h, Math.round((boat!.hour + 0.5 - h) * 60));
    const busy = onErrand(db);
    for (const id of boat!.who) expect(busy.has(id)).toBe(true);
    // a crowd called right at the owner's door leaves him and his crew at their errand
    await writeBallad(db, async () => ({ output: GOOD_BALLAD }));
    const r = planBallad(db, "grote_markt", 0);
    const ev = (r as { event: EventRow }).event;
    const owner = resident(db, boat!.who[0])!;
    const got = gather(db, eventRow(db, ev.id)!, "crowd", 40, { x: owner.home.sx, z: owner.home.sz }, "his door");
    for (const id of boat!.who) expect(got).not.toContain(id);
    // after the errand's hours he is free again
    setClock(db, 2, Math.min(23, Math.ceil(boat!.back + 0.6)), 0);
    expect(onErrand(db).has(boat!.who[0])).toBe(false);
  });
});
