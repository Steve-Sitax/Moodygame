import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { CONVO_CALLS_PER_DAY } from "../src/config.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { actionOf, activeActions, installTalkHooks, reportAction, resetSync } from "../src/director/actions.ts";
import { recentConvos, resetConvos } from "../src/director/convo.ts";
import { ENTER_ALL_IN_MIN, eventRow, eventsTick, exitFor, HALL_DOORS, leadsOf, planEvent, publicEvent, stage, TOWN_EXITS, type EventRow, type StoredStage } from "../src/director/scheduler.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";
import { StageSchema } from "../src/director/vocab.ts";
import { CAP, DEPART_SEATED_MIN, landmarkDoors, landmarkNow } from "../src/landmarks/life.ts";

// M7 funeral (Steve, 2026-09-24: "funeral is outside the church but nothing really happens further, it
// just stays there"): the funeral plays out. The procession arrives with the knell, the priest meets the
// coffin at the west door and leads it in ("enter"), the requiem inside, then the coffin on the hearse to
// the Kiel cemetery with the widow and the family, the rest in small groups going home ("depart"), and a
// clean end. The wedding goes in for its vows the same way. The engine owns every place and time.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const setMin = (db: Db, m: number) => setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
const clockMin = (db: Db) => {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return (p.day - 1) * 1440 + p.hour * 60 + p.minute;
};
const noConvoCalls = (db: Db) => {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (let i = 0; i < CONVO_CALLS_PER_DAY; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, 'npc_convo', 'claude', 'x', 1, 1)").run(day);
};
function fresh(hour = 9): Db {
  const db = openDb(":memory:");
  setClock(db, 2, hour);
  noConvoCalls(db); // the mourners' talk uses the engine's words: no model is called
  return db;
}
function startTemplate(db: Db, id: string): EventRow {
  const p = planEvent(db, planFromTemplate(templateById(id)!, "engine", { start_in_min: 0 }), { dev: true });
  expect(p.ok, !p.ok ? p.why : id).toBe(true);
  eventsTick(db);
  return eventRow(db, (p as { event: EventRow }).event.id)!;
}
const stagesOf = (ev: EventRow) => JSON.parse(ev.stages_json) as StoredStage[];
const opIndex = (ev: EventRow, op: string) => stagesOf(ev).findIndex((s) => s.op === op);
const stageStart = (ev: EventRow, i: number) => ev.start_m + stagesOf(ev).slice(0, i).reduce((a, s) => a + s.minutes, 0);
function toMinute(db: Db, ev: EventRow, m: number): EventRow {
  setMin(db, m);
  eventsTick(db);
  return eventRow(db, ev.id)!;
}
const mine = (db: Db, ev: EventRow) => activeActions(db).filter((a) => a.event_id === ev.id);

beforeEach(() => {
  resetTalks();
  resetSync();
  resetConvos();
  installTalkHooks();
});

describe("the funeral plays out", () => {
  it("house, procession with the knell, in through the west door, the requiem, the hearse out of town, home in groups, a clean end", async () => {
    const db = fresh(9);
    let ev = startTemplate(db, "funeral");
    const leads = leadsOf(ev);
    const priest = leads.find((l) => l.role === "priest")!;
    const widow = leads.find((l) => l.role === "widow")!;
    const bearers = leads.filter((l) => l.role === "bearers").sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
    expect(priest && widow && bearers.length === 4).toBe(true);
    // the stages: gather at the house, the procession (the knell), enter, depart to the Kiel road
    expect(stagesOf(ev).map((s) => s.op)).toEqual(["gather", "procession", "enter", "depart"]);
    expect(stagesOf(ev)[1].cues?.some((c) => c.source === "bell" && c.pitch < 1)).toBe(true);
    expect(stagesOf(ev).reduce((a, s) => a + s.minutes, 0)).toBeLessThanOrEqual(600);
    // the priest waits at the west door from the start: he meets the coffin there
    const pa = actionOf(db, priest.id)!;
    expect(Math.hypot(pa.target_x! + 262, pa.target_z! - 149.5)).toBeLessThan(15);

    // the procession: the priest at the head, the bearers two by two, the widow behind
    ev = toMinute(db, ev, stageStart(ev, 1));
    const col = JSON.parse(ev.people_json) as string[];
    expect(col[0]).toBe(priest.id);
    expect(col.slice(1, 5)).toEqual(bearers.map((b) => b.id));
    expect(col[5]).toBe(widow.id);

    // enter: everyone but the onlookers walks to the door's step, in the column's order
    const enterAt = opIndex(ev, "enter");
    ev = toMinute(db, ev, stageStart(ev, enterAt));
    expect(ev.stage).toBe(enterAt);
    const going = mine(db, ev);
    expect(going.length).toBeGreaterThan(10);
    const step = HALL_DOORS.cathedral_west.step;
    for (const a of going) {
      expect(a.phase).toBe("inside");
      expect(Math.hypot(a.target_x! - step.x, a.target_z! - step.z)).toBeLessThan(1.5);
      // where they stood is kept for the way out
      expect(typeof JSON.parse(a.data_json).ring_x).toBe("number");
    }
    expect(JSON.parse(actionOf(db, priest.id)!.data_json).order).toBe(0);
    // nobody is inside until the client says they stepped in
    expect(landmarkNow(db, "cathedral").people.some((p) => p.role === "requiem_priest" || p.role === "mourner")).toBe(false);
    for (const id of [priest.id, ...bearers.map((b) => b.id), widow.id]) await reportAction(db, actionOf(db, id)!.id, { phase: "arrived" });
    expect(actionOf(db, priest.id)!.phase).toBe("in");
    let n = landmarkNow(db, "cathedral");
    expect(n.people.find((p) => p.role === "requiem_priest")?.id).toBe(priest.id);
    expect(n.people.filter((p) => p.role.startsWith("bearer")).map((p) => p.role).sort()).toEqual(["bearer0", "bearer1", "bearer2", "bearer3"]);
    expect(n.people.find((p) => p.role === "widow")?.id).toBe(widow.id);
    expect(n.funeral?.part).toBe("in");
    expect(n.funeral?.widow).toBe(widow.name);
    expect(n.service?.kind).toBe("funeral");
    expect(n.people.some((p) => p.role === "celebrant" || p.role === "worshipper")).toBe(false);
    // the engine counts the stragglers in after a while (an unseen walker)
    ev = toMinute(db, ev, stageStart(ev, enterAt) + ENTER_ALL_IN_MIN);
    expect(mine(db, ev).every((a) => a.phase === "in")).toBe(true);
    n = landmarkNow(db, "cathedral");
    const mourners = n.people.filter((p) => p.role === "mourner");
    expect(mourners.length).toBeGreaterThan(5);
    expect(mourners.length).toBeLessThanOrEqual(CAP.guests);
    expect(n.organ).toBe(true);
    // the talk prompt knows where they are
    // (the door stays open for it)
    expect(landmarkDoors(db).find((d) => d.landmark === "cathedral")!.open).toBe(true);

    // depart: the priest stays at his church; the bearers, the widow and her family go out along the Kiel road
    const departAt = opIndex(ev, "depart");
    ev = toMinute(db, ev, stageStart(ev, departAt));
    expect(ev.stage).toBe(departAt);
    expect(actionOf(db, priest.id)).toBeNull();
    const st = stagesOf(ev)[departAt];
    expect(st.exit?.id).toBe("kiel_road");
    expect(st.hearse).toBe(true);
    const route = st.route!;
    expect(route.length).toBeGreaterThanOrEqual(3);
    // from the door, to the edge of the drawn town, and on out of it
    expect(Math.hypot(route[0][0] + 262, route[0][1] - 144.5)).toBeLessThan(6);
    const wm = walkMap();
    for (const p of route.slice(0, -1)) expect(wm.reachable(p[0], p[1])).toBe(true);
    const last = route[route.length - 1];
    expect(last[1]).toBeGreaterThan(296);
    const leaving = mine(db, ev).filter((a) => a.phase === "leave");
    const ids = leaving.map((a) => a.npc_id);
    expect(ids.slice(0, 4)).toEqual(bearers.map((b) => b.id));
    expect(ids[4]).toBe(widow.id);
    const wr = town(db).byId.get(widow.id)!;
    for (const id of ids.slice(5)) expect(town(db).byId.get(id)!.household).toBe(wr.household);
    for (const a of leaving) expect(Math.hypot(a.target_x! - route[route.length - 2][0], a.target_z! - route[route.length - 2][1])).toBeLessThan(1);
    // the rest in small groups near the door, clear of the hearse's way
    const groups = st.groups!;
    expect(groups.length).toBeGreaterThan(2);
    for (const g of groups) {
      expect(g.ids.length).toBeGreaterThanOrEqual(2);
      expect(g.ids.length).toBeLessThanOrEqual(5);
      expect(Math.hypot(g.x - st.x!, g.z - st.z!)).toBeLessThan(25);
      expect(wm.reachable(g.x, g.z)).toBe(true);
      for (const id of g.ids) expect(actionOf(db, id)?.phase).toBe("going");
    }
    // inside: the coffin and the family go out first, the others keep their chairs a while
    n = landmarkNow(db, "cathedral");
    expect(n.funeral?.part).toBe("out");
    expect(n.people.some((p) => p.role.startsWith("bearer") || p.role === "widow")).toBe(false);
    expect(n.people.some((p) => p.role === "mourner")).toBe(true);
    ev = toMinute(db, ev, stageStart(ev, departAt) + DEPART_SEATED_MIN);
    expect(landmarkNow(db, "cathedral").people.some((p) => p.role === "mourner")).toBe(false);
    expect(landmarkNow(db, "cathedral").funeral).toBeNull();
    // the client sees the road and the hearse
    const pub = publicEvent(db, ev).stages[departAt] as { route?: unknown[]; hearse?: boolean; groups?: unknown[] };
    expect(pub.hearse).toBe(true);
    expect(pub.route?.length).toBe(route.length);
    expect(pub.groups?.length).toBe(groups.length);

    // through the stage: the groups go home one after another; two of them talk low first (the engine's words here)
    const startDep = stageStart(ev, departAt);
    const mins = st.minutes;
    let released = 0;
    for (let m = startDep + 5; m < startDep + mins; m += 5) { // M7 clock: a 40-minute stage, looked at every 5 minutes
      ev = toMinute(db, ev, m);
      const gs = stagesOf(ev)[departAt].groups!;
      const gone = gs.filter((g) => g.gone).length;
      expect(gone).toBeGreaterThanOrEqual(released);
      released = gone;
      for (const g of gs.filter((x) => x.gone)) for (const id of g.ids) expect(actionOf(db, id)).toBeNull();
    }
    expect(released).toBe(groups.length);
    const talk = recentConvos().filter((c) => c.event_id === ev.id);
    expect(talk.length).toBeGreaterThanOrEqual(1);
    expect(talk[0].lines.length).toBeGreaterThanOrEqual(2);
    for (const c of talk) for (const l of c.lines) expect(l.text).not.toMatch(/\{|\}/);

    // the end: every action of it over, the rumour and the memories written
    ev = toMinute(db, ev, ev.end_m + 1);
    expect(ev.status).toBe("done");
    expect(mine(db, ev).length).toBe(0);
    const rumour = (db.prepare("SELECT text FROM world_fact WHERE tags LIKE ?").get(`rumour,event:${ev.id}`) as { text: string }).text;
    expect(rumour).toContain(widow.name);
    expect(rumour).toContain("Kiel cemetery");
    const mem = db.prepare("SELECT COUNT(*) AS n FROM npc_memory WHERE npc_id = ? AND text LIKE '%Kiel cemetery%'").get(widow.id) as { n: number };
    expect(mem.n).toBeGreaterThan(0);
    const verbs = (db.prepare("SELECT verb FROM world_event WHERE ref_type = 'town_event' AND ref_id = ?").all(ev.id) as Array<{ verb: string }>).map((r) => r.verb);
    expect(verbs).toEqual(expect.arrayContaining(["started", "went_in", "departed", "ended"]));
    expect(clockMin(db)).toBeGreaterThan(ev.end_m);
  });
});

describe("the wedding goes in for its vows", () => {
  it("they gather on the square, go in (the vows at the rail), come out to their places, then walk to Den Engel", async () => {
    const db = fresh(10);
    let ev = startTemplate(db, "wedding");
    const leads = leadsOf(ev);
    const groom = leads.find((l) => l.role === "groom")!;
    const bride = leads.find((l) => l.role === "bride")!;
    // gathering on the square: nobody of it inside yet
    let n = landmarkNow(db, "cathedral");
    expect(n.wedding?.stage).toBe("coming");
    expect(n.people.some((p) => p.role === "groom" || p.role === "guest")).toBe(false);
    const ringBefore = { x: actionOf(db, groom.id)!.target_x!, z: actionOf(db, groom.id)!.target_z! };
    const enterAt = opIndex(ev, "enter");
    ev = toMinute(db, ev, stageStart(ev, enterAt));
    // the onlookers stay outside; the rest go in, the priest first, then the couple
    const acts = mine(db, ev);
    const crowd = acts.filter((a) => JSON.parse(a.data_json).role === "crowd");
    expect(crowd.length).toBeGreaterThan(5);
    for (const a of crowd) expect(a.phase).not.toBe("inside");
    const people = JSON.parse(ev.people_json) as string[];
    expect(people.slice(0, 3)).toEqual([leads.find((l) => l.role === "priest")!.id, groom.id, bride.id]);
    for (const id of [groom.id, bride.id]) await reportAction(db, actionOf(db, id)!.id, { phase: "arrived" });
    n = landmarkNow(db, "cathedral");
    expect(n.wedding?.stage).toBe("vows");
    expect(n.people.find((p) => p.role === "groom")?.id).toBe(groom.id);
    expect(n.people.find((p) => p.role === "bride")?.id).toBe(bride.id);
    expect(n.service?.kind).toBe("wedding");
    // out again: back to where they stood, and nobody of it left inside
    ev = toMinute(db, ev, stageStart(ev, enterAt + 1));
    const ga = actionOf(db, groom.id)!;
    expect(ga.phase).toBe("going");
    expect(Math.hypot(ga.target_x! - ringBefore.x, ga.target_z! - ringBefore.z)).toBeLessThan(0.01);
    n = landmarkNow(db, "cathedral");
    expect(n.wedding?.stage).toBe("leaving");
    expect(n.people.some((p) => p.role === "groom" || p.role === "guest")).toBe(false);
    // the walk to Den Engel, the music played there (a stage without a place is where the event stands)
    const walk = opIndex(ev, "procession");
    ev = toMinute(db, ev, stageStart(ev, walk));
    expect(actionOf(db, groom.id)!.phase).toBe("procession");
    const music = stagesOf(ev)[walk + 1];
    expect(Math.hypot(music.x! - stagesOf(ev)[walk].x!, music.z! - stagesOf(ev)[walk].z!)).toBeLessThan(0.01);
    ev = toMinute(db, ev, ev.end_m + 1);
    expect(ev.status).toBe("done");
    expect(mine(db, ev).length).toBe(0);
  });
});

describe("the director's own: the new ops are clamped", () => {
  it("enter only at a hall's door; depart to a known road; a priest never leaves town", () => {
    const db = fresh(10);
    for (const op of ["enter", "depart"]) expect(StageSchema.safeParse({ ...stage({ op: op as "enter", minutes: 120 }) }).success).toBe(true);
    // "enter" on the Vismarkt: nothing to go into there, a plain stage (they stay)
    const p = planEvent(db, { title: "A sermon in the open", template: "custom", place: "vismarkt", start_in_min: 0, source: "claude", stages: [stage({ op: "gather", minutes: 60, count: 6, place: "vismarkt" }), stage({ op: "enter", minutes: 120 })] }, { dev: true });
    expect(p.ok).toBe(true);
    const ev = (p as { event: EventRow }).event;
    expect(stagesOf(ev).map((s) => s.op)).toEqual(["gather", "sound"]);
    // a road out: a cemetery word is the Kiel road; a funeral goes there; otherwise the nearest
    expect(exitFor("the graveyard", { x: 0, z: 0 }, false).id).toBe("kiel_road");
    expect(exitFor("", { x: 0, z: 0 }, true).id).toBe("kiel_road");
    expect(exitFor("nowhere", { x: 190, z: 120 }, false).id).toBe("north_road");
    for (const e of TOWN_EXITS) expect(walkMap().nearestOpen(e.x, e.z, 8)).not.toBeNull();
    // a model's funeral that names the priest in its departure: he stays at his church
    const q = planEvent(
      db,
      {
        title: "A funeral from the Vismarkt",
        template: "custom",
        place: "house",
        start_in_min: 0,
        source: "claude",
        stages: [
          // M7 clock: game-realistic lengths, inside the 240 minutes an event may take
          stage({ op: "gather", minutes: 30, role: "mourners", count: 8, place: "house", leads: ["widow", "bearers"] }),
          stage({ op: "procession", minutes: 40, place: "cathedral_west", leads: ["bearers", "widow"] }),
          stage({ op: "enter", minutes: 60, leads: ["priest"] }),
          stage({ op: "depart", minutes: 40, place: "somewhere", leads: ["priest", "bearers", "widow"] }),
        ],
      },
      { dev: true },
    );
    expect(q.ok, !q.ok ? q.why : "").toBe(true);
    let fe = (q as { event: EventRow }).event;
    expect(stagesOf(fe)[3].exit?.id).toBe("kiel_road");
    eventsTick(db);
    fe = eventRow(db, fe.id)!;
    const priest = leadsOf(fe).find((l) => l.role === "priest")!;
    fe = toMinute(db, fe, stageStart(fe, 3));
    expect(actionOf(db, priest.id)).toBeNull();
    expect(mine(db, fe).some((a) => a.npc_id === priest.id)).toBe(false);
  });
});
