import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { CONVO_CALLS_PER_DAY } from "../src/config.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { town } from "../src/town/store.ts";
import { resetThieves } from "../src/town/thieves.ts";
import { actionOf, activeActions, installTalkHooks, reportAction, resetSync, startAction, syncFromClient, validateProposal } from "../src/director/actions.ts";
import { resetConvos, type ConvoOut } from "../src/director/convo.ts";
import { directorPrompt, roomForEvent, think, type DirectorOut } from "../src/director/director.ts";
import { cleanLeads, fillNames, fitsLead, type Lead } from "../src/director/leads.ts";
import { setSceneRoll, streetCrimeOpen } from "../src/director/scenes.ts";
import { cleanStages, eventRow, eventsTick, leadsOf, liveEvents, planEvent, publicEvent, softText, stage, type EventPlan, type EventRow } from "../src/director/scheduler.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";
import { CUE_EVERY_MAX_S, CUE_EVERY_MIN_S, CUE_LEVEL_MAX, CUE_LEVEL_MIN, CUE_PITCH_MAX, CUE_PITCH_MIN, cleanCues, EVENT_PEOPLE_MAX, GATHER_MAX, LEADS_PER_STAGE } from "../src/director/vocab.ts";
import { residentPrompt, talkHooks } from "../src/town/talk.ts";

// M4b: lead roles with looks, the director first, and the two scenes (a scuffle, a robbery
// in the street) the model may ask for and the ENGINE plays and settles. No combat, no money
// to or from Jef. The model is a stub (a Runner) that proposes.

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const clockMin = (db: Db) => {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return (p.day - 1) * 1440 + p.hour * 60 + p.minute;
};
/** Move the game clock on by n minutes. */
const later = (db: Db, n: number) => {
  const m = clockMin(db) + n;
  setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
};
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const trustOf = (db: Db, id: string) => (db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ?").get(id) as { trust: number }).trust;
const noConvoCalls = (db: Db) => {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (let i = 0; i < CONVO_CALLS_PER_DAY; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, 'npc_convo', 'claude', 'x', 1, 1)").run(day);
};
const res = (db: Db, id: string) => town(db).byId.get(id)!;
const eventsOf = (db: Db, verb: string) => db.prepare("SELECT * FROM world_event WHERE verb = ? ORDER BY id").all(verb) as Array<{ id: number; text: string; outcome: string | null; data_json: string }>;

function fresh(hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, 1, hour);
  noConvoCalls(db); // conversations use the engine's lines here: no model is ever called
  return db;
}

/** Plan a template now and run the clock to its start. */
function startTemplate(db: Db, id: string): EventRow {
  const p = planEvent(db, planFromTemplate(templateById(id)!, "engine", { start_in_min: 0 }), { dev: true });
  expect(p.ok, !p.ok ? p.why : id).toBe(true);
  eventsTick(db);
  return eventRow(db, (p as { event: EventRow }).event.id)!;
}

/** Advance the event to the given stage (the clock runs to that stage's start). */
function toStage(db: Db, ev: EventRow, i: number): EventRow {
  const stages = JSON.parse(ev.stages_json) as Array<{ minutes: number }>;
  const at = ev.start_m + stages.slice(0, i).reduce((a, s) => a + s.minutes, 0);
  const m = at;
  setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
  eventsTick(db);
  return eventRow(db, ev.id)!;
}

beforeEach(() => {
  resetTalks();
  resetThieves();
  resetSync();
  resetConvos();
  installTalkHooks();
});
afterEach(() => setSceneRoll(null));

// ------------------------------------------------------------------ leads

describe("M4b leads", () => {
  it("a wedding casts a courting pair and a priest, names them in the notice, and puts them first", () => {
    const db = fresh(10);
    const ev = startTemplate(db, "wedding");
    const leads = leadsOf(ev);
    const bride = leads.find((l) => l.role === "bride")!;
    const groom = leads.find((l) => l.role === "groom")!;
    const priest = leads.find((l) => l.role === "priest")!;
    expect(bride && groom && priest).toBeTruthy();
    const b = res(db, bride.id);
    const g = res(db, groom.id);
    expect(b.sex).toBe("f");
    expect(g.sex).toBe("m");
    expect(b.age).toBeGreaterThanOrEqual(18);
    expect(g.age).toBeGreaterThanOrEqual(20);
    expect(["daughter", "single", "lodger", "widow"]).toContain(b.family_role);
    expect(["son", "single", "lodger", "widower"]).toContain(g.family_role);
    // not brother and sister
    expect(b.surname === g.surname).toBe(false);
    expect(b.household !== g.household || b.family_role === "lodger" || g.family_role === "lodger").toBe(true);
    expect(res(db, priest.id).trade).toBe("priest");
    // first in the event's people, each on an attend action as a lead
    const people = JSON.parse(ev.people_json) as string[];
    expect(people.slice(0, 3).sort()).toEqual([bride.id, groom.id, priest.id].sort());
    const act = actionOf(db, bride.id)!;
    expect(JSON.parse(act.data_json).lead).toBe("bride");
    // the notice names them (the {groom} and {bride} of the template, filled in by the engine)
    const notice = (db.prepare("SELECT text FROM world_fact WHERE tags LIKE ? ORDER BY id DESC").get(`notice,event:${ev.id}`) as { text: string }).text;
    expect(notice).toContain(b.name);
    expect(notice).toContain(g.name);
    expect(notice).not.toMatch(/\{|\}/);
    // the client sees the leads with their parts
    const pub = publicEvent(db, ev);
    expect(pub.leads.map((l) => l.role)).toEqual(expect.arrayContaining(["bride", "groom", "priest"]));
  });

  it("a big wedding pulls in most of what it asks (Steve: 50 to 100), never more than the cap", () => {
    const db = fresh(10);
    let ev = startTemplate(db, "wedding");
    ev = toStage(db, ev, 1);
    const n = (JSON.parse(ev.people_json) as string[]).length;
    expect(n).toBeGreaterThanOrEqual(70);
    expect(n).toBeLessThanOrEqual(EVENT_PEOPLE_MAX);
    // in rows: nobody stands on another's place
    const spots = activeActions(db).filter((a) => a.event_id === ev.id).map((a) => `${a.target_x!.toFixed(1)},${a.target_z!.toFixed(1)}`);
    expect(new Set(spots).size).toBeGreaterThan(spots.length * 0.8);
  });

  it("in the procession the groom and the bride walk first; the priest stays at his church", () => {
    const db = fresh(10);
    let ev = startTemplate(db, "wedding");
    const leads = leadsOf(ev);
    const groom = leads.find((l) => l.role === "groom")!.id;
    const bride = leads.find((l) => l.role === "bride")!.id;
    const priest = leads.find((l) => l.role === "priest")!.id;
    ev = toStage(db, ev, 3);
    expect(ev.stage).toBe(3);
    const people = JSON.parse(ev.people_json) as string[];
    expect(people[0]).toBe(groom);
    expect(people[1]).toBe(bride);
    expect(JSON.parse(actionOf(db, groom)!.data_json).order).toBe(0);
    expect(actionOf(db, groom)!.phase).toBe("procession");
    expect(actionOf(db, priest)).toBeNull();
  });

  it("the musicians are men of the right trades, one per instrument; a funeral has a widow and four bearers", () => {
    const db = fresh(12);
    const ev = startTemplate(db, "musicians");
    const leads = leadsOf(ev);
    expect(leads.map((l) => l.role).sort()).toEqual(["accordionist", "fiddler", "organ_grinder"]);
    for (const l of leads) {
      const r = res(db, l.id);
      expect(r.sex).toBe("m");
      expect(["sailor", "retired", "beggar", "docker", "boatman", "carter"]).toContain(r.trade);
    }
    const notice = (db.prepare("SELECT text FROM world_fact WHERE tags LIKE ?").get(`notice,event:${ev.id}`) as { text: string }).text;
    for (const l of leads) expect(notice).toContain(l.name);

    const db2 = fresh(9);
    const fu = startTemplate(db2, "funeral");
    const fl = leadsOf(fu);
    const bearers = fl.filter((l) => l.role === "bearers");
    expect(bearers.length).toBe(4);
    expect(bearers.map((l) => l.n).sort()).toEqual([0, 1, 2, 3]);
    expect(bearers.every((l) => res(db2, l.id).sex === "m")).toBe(true);
    const widow = fl.find((l) => l.role === "widow")!;
    expect(res(db2, widow.id).sex).toBe("f");
    // the priest waits at the cathedral, not at the house
    const priest = fl.find((l) => l.role === "priest")!;
    const pa = actionOf(db2, priest.id)!;
    expect(Math.hypot(pa.target_x! - -262, pa.target_z! - 149.5)).toBeLessThan(15);
  });

  it("fitsLead keeps children, the police and the guard out of the grown-up parts", () => {
    const db = fresh(10);
    for (const r of town(db).town.residents) {
      if (r.age < 13) expect(fitsLead(r, "bride", false) || fitsLead(r, "groom", false) || fitsLead(r, "victim", false) || fitsLead(r, "quarreller", false)).toBe(false);
      if (r.trade === "police") expect(fitsLead(r, "quarreller", false) || fitsLead(r, "pickpocket", false) || fitsLead(r, "victim", false)).toBe(false);
      if (r.work.kind === "guard") expect(fitsLead(r, "bearers", false)).toBe(false);
    }
  });

  it("names: {role} is filled in; an unknown role is a plain word, never a code", () => {
    const leads: Lead[] = [
      { role: "bride", id: "a", name: "Anna Peeters", stage: 0 },
      { role: "groom", id: "b", name: "Karel Janssens", stage: 0 },
    ];
    expect(fillNames("{groom} and {bride} marry.", leads)).toBe("Karel Janssens and Anna Peeters marry.");
    expect(fillNames("{victim} lost a purse.", leads)).toBe("the one robbed lost a purse.");
  });
});

// ------------------------------------------------------------------ clamps

describe("M4b clamps on a custom event with leads", () => {
  it("at most four leads a stage, known ones only, one bearers team; counts clamped; one event never takes more than 40", () => {
    expect(cleanLeads(["bride", "groom", "priest", "fiddler", "hawker", "showman"]).length).toBe(LEADS_PER_STAGE);
    expect(cleanLeads(["bearers", "bearers", "executioner", "agent"])).toEqual(["bearers"]);
    expect(cleanLeads(["quarreller", "quarreller", "quarreller"])).toEqual(["quarreller", "quarreller"]);
    const st = cleanStages([
      { ...stage({ op: "gather", minutes: 900, count: 500 }), leads: ["bride", "groom", "priest", "fiddler", "hawker"] },
      stage({ op: "scuffle", minutes: 60, leads: ["bride"] }),
      stage({ op: "robbery", minutes: 60, leads: [] }),
    ]);
    expect(st[0].count).toBe(GATHER_MAX);
    expect(st[0].leads.length).toBe(4);
    expect(st[1].leads).toEqual(["quarreller", "quarreller"]);
    // one scene an event
    expect(st.filter((s) => s.op === "robbery").length).toBe(0);

    const db = fresh(11);
    const many: EventPlan = {
      title: "Everyone to the Steenplein",
      template: "crowd",
      place: "steenplein",
      start_in_min: 0,
      stages: Array.from({ length: 6 }, () => stage({ op: "gather", minutes: 30, count: 500, role: "crowd" })),
      source: "claude",
    };
    const p = planEvent(db, many);
    expect(p.ok).toBe(true);
    const id = (p as { event: EventRow }).event.id;
    eventsTick(db);
    for (let i = 1; i < 6; i++) toStage(db, eventRow(db, id)!, i);
    expect((JSON.parse(eventRow(db, id)!.people_json) as string[]).length).toBeLessThanOrEqual(EVENT_PEOPLE_MAX);
  });

  it("a scene first thing gets a walk-on stage so its two are there before it plays", () => {
    const st = cleanStages([stage({ op: "robbery", minutes: 150, place: "grote_markt" })]);
    expect(st[0].op).toBe("gather");
    expect(st[0].leads).toEqual(["pickpocket", "victim"]);
    expect(st[1].op).toBe("robbery");
  });

  it("the director's custom event with leads is planned through the clamps, with the names put in by the engine", async () => {
    const db = fresh(10);
    const out: DirectorOut = {
      decision: "event",
      why: "a Tuesday wedding",
      event: {
        title: "A wedding at Saint Paul's",
        kind: "wedding",
        place: "cathedral_west",
        start_in_min: 0,
        stages: [
          { ...stage({ op: "gather", minutes: 400, role: "guests", count: 90 }), leads: ["groom", "bride", "priest", "fiddler", "hawker", "showman"] },
          { ...stage({ op: "procession", minutes: 150, place: "engel", sound: "music" }), leads: ["groom", "bride"] },
        ],
        notice: "Banns read for {bride} and {groom}.",
        rumour: "{groom} married {bride}.",
      },
    };
    const r = await think(db, reply(out), true);
    expect(r.source).toBe("claude");
    expect(r.planned?.ok).toBe(true);
    const ev = liveEvents(db)[0];
    const st = JSON.parse(ev.stages_json) as Array<{ minutes: number; count: number; leads: string[] }>;
    expect(st[0].minutes).toBe(180);
    expect(st[0].count).toBe(Math.min(90, GATHER_MAX));
    expect(st[0].leads).toEqual(["groom", "bride", "priest", "fiddler"]);
    eventsTick(db);
    const cast = leadsOf(eventRow(db, ev.id)!);
    const notice = (db.prepare("SELECT text FROM world_fact WHERE tags LIKE ?").get(`notice,event:${ev.id}`) as { text: string }).text;
    expect(notice).toContain(cast.find((l) => l.role === "bride")!.name);
  });
});

// ------------------------------------------------------------------ the scenes

describe("M4b scenes: no combat, the engine decides", () => {
  it("a scuffle: the two argue, the engine decides who was in the wrong, the police part them, all on the record", () => {
    const db = fresh(13);
    const before = money(db);
    let ev = startTemplate(db, "scuffle");
    const leads = leadsOf(ev);
    const drunk = leads.find((l) => l.role === "drunkard")!;
    const other = leads.find((l) => l.role === "quarreller")!;
    expect(drunk && other).toBeTruthy();
    ev = toStage(db, ev, 1);
    const sc = (JSON.parse(ev.stages_json) as Array<{ scene?: { kind: string; a: string; b: string; wrong: string; agent: string | null } }>)[1].scene!;
    expect(sc.kind).toBe("scuffle");
    // a drunk is always the one in the wrong
    expect(sc.wrong).toBe(drunk.id);
    expect(eventsOf(db, "scuffle").length).toBe(1);
    // the argument, in the engine's words (no model call)
    expect(eventsOf(db, "convo").length).toBeGreaterThan(0);
    // the client gets the scene
    expect(publicEvent(db, ev).scene?.kind).toBe("scuffle");
    expect(sc.agent, "an agent near the Vismarkt at 13:00").toBeTruthy();
    if (sc.agent) expect(res(db, sc.agent).trade).toBe("police");
    // the stage ends: parted, memories, the rumour, released
    ev = toStage(db, ev, 2);
    const parted = eventsOf(db, "scuffle_parted");
    expect(parted.length).toBe(1);
    expect(parted[0].outcome).toContain(res(db, drunk.id).name);
    const mem = db.prepare("SELECT text FROM npc_memory WHERE npc_id = ? ORDER BY id DESC").get(drunk.id) as { text: string };
    expect(mem.text).toMatch(/in the wrong/);
    expect(db.prepare("SELECT 1 FROM world_fact WHERE tags LIKE ? AND text LIKE '%shoving%'").get(`rumour,event:${ev.id}`)).toBeTruthy();
    expect(actionOf(db, drunk.id)).toBeNull();
    expect(money(db)).toBe(before);
  });

  it("a robbery the police catch: the purse back to the victim on the record, Jef's money untouched", () => {
    const db = fresh(11);
    const before = money(db);
    setSceneRoll((k) => (k.endsWith(":catch") ? 0.1 : 0.5));
    let ev = startTemplate(db, "street_robbery");
    ev = toStage(db, ev, 1);
    const sc = (JSON.parse(ev.stages_json) as Array<{ scene?: { a: string; b: string; agent: string | null; caught: boolean; amount_c: number } }>)[1].scene!;
    expect(res(db, sc.a).trade).toBe("thief");
    expect(sc.amount_c).toBeGreaterThanOrEqual(5);
    expect(sc.amount_c).toBeLessThanOrEqual(90);
    const started = eventsOf(db, "street_robbery");
    expect(started.length).toBe(1);
    expect(JSON.parse(started[0].data_json).thief).toBe(sc.a);
    expect(sc.agent, "an agent on duty near the Grote Markt at 11:00").toBeTruthy();
    toStage(db, ev, 2);
    if (sc.agent) {
      expect(sc.caught).toBe(true);
      const caught = eventsOf(db, "robbery_caught");
      expect(caught.length).toBe(1);
      expect(caught[0].text).toContain(`${sc.amount_c} centimes went back`);
      expect(streetCrimeOpen(db)).toBeNull();
    } else {
      // no agent near: he gets away, whatever the dice say
      expect(sc.caught).toBe(false);
      expect(eventsOf(db, "robbery_escaped").length).toBe(1);
    }
    expect(money(db)).toBe(before);
  });

  it("a robbery Jef saw and the thief got away with: Jef tells the police, the engine's verdict, the purse back to the victim", async () => {
    const db = fresh(11);
    const before = money(db);
    setSceneRoll((k) => (k.endsWith(":catch") ? 0.99 : 0.5));
    let ev = startTemplate(db, "street_robbery");
    // Jef stands on the Grote Markt when it happens
    syncFromClient({ x: ev.x + 5, z: ev.z + 5, people: [] });
    ev = toStage(db, ev, 1);
    const sc = (JSON.parse(ev.stages_json) as Array<{ scene?: { a: string; b: string; amount_c: number; witnessed: boolean } }>)[1].scene!;
    expect(sc.witnessed).toBe(true);
    toStage(db, ev, 2);
    const open = streetCrimeOpen(db)!;
    expect(open.thief).toBe(sc.a);
    expect(open.witnessed).toBe(true);
    // an agent will walk along with Jef on a robbery he saw, even a stranger
    const agent = town(db).town.residents.find((r) => r.trade === "police" && !activeActions(db).some((a) => a.npc_id === r.id))!;
    const v = validateProposal(db, agent, { kind: "follow", target: "", minutes: 30, item: "", amount_c: 0, reason: "I saw a man robbed" });
    expect(v.ok).toBe(true);
    // "that's him": the agent questions the thief; the verdict is the engine's
    const trustBefore = trustOf(db, sc.b);
    const act = startAction(db, { npc_id: agent.id, kind: "talk_to", target: sc.a, target_x: ev.x, target_z: ev.z, source: "talk", minutes: 240, data: { purpose: "question", about: "the purse on the Grote Markt" } });
    const convo: ConvoOut = { lines: [{ speaker: "A", text: "Turn your pockets out." }, { speaker: "B", text: "Here. Take it." }], memory_a: "", memory_b: "", outcome_kind: "none", trust_a: 0, trust_b: 0 };
    await reportAction(db, act.id, { phase: "arrived" }, reply(convo));
    const solved = eventsOf(db, "robbery_solved");
    expect(solved.length).toBe(1);
    expect(solved[0].text).toContain(res(db, sc.b).name);
    expect(streetCrimeOpen(db)).toBeNull();
    expect(trustOf(db, sc.b)).toBe(Math.min(10, trustBefore + 1));
    // the victim got the purse, not Jef
    expect(money(db)).toBe(before);
  });
});

// ------------------------------------------------------------------ the director, AI first, and hostile output

describe("M4b director: AI first, hostile output refused or cleaned", () => {
  const base = (over: Partial<DirectorOut["event"]> = {}): DirectorOut => ({
    decision: "event",
    why: "the town needs something",
    event: {
      title: "A fair on the Steenplein",
      kind: "fair",
      place: "steenplein",
      start_in_min: 10,
      stages: [stage({ op: "gather", minutes: 120, role: "crowd", count: 10, sound: "music" })],
      notice: "",
      rumour: "",
      ...over,
    },
  });

  it("a bad place is refused", async () => {
    const db = fresh(11);
    const r = await think(db, reply(base({ place: "the moon" })), true);
    expect(r.planned?.ok).toBe(false);
    expect(liveEvents(db).length).toBe(0);
  });

  it("a weapon or a killing: the whole event is refused", async () => {
    for (const over of [{ title: "A knife fight at the docks" }, { rumour: "The sailor was murdered in the night." }, { stages: [stage({ op: "scuffle", minutes: 120, text: "he drew a pistol" })] }]) {
      const db = fresh(11);
      const r = await think(db, reply(base(over)), true);
      expect(r.planned?.ok, JSON.stringify(over)).toBe(false);
      expect(r.planned && !r.planned.ok && r.planned.why).toMatch(/no combat/);
    }
  });

  it("money to the player is struck out and never paid; a fight becomes a scuffle", async () => {
    const db = fresh(11);
    const before = money(db);
    const r = await think(db, reply(base({ notice: "Jef is given 500 francs by the mayor. The fair opens at noon.", title: "A fist fight at the fair" })), true);
    expect(r.planned?.ok).toBe(true);
    const ev = liveEvents(db)[0];
    expect(ev.notice).not.toMatch(/500|francs|Jef/);
    expect(ev.notice).toMatch(/fair opens/);
    expect(ev.title).toMatch(/scuffle/i);
    expect(ev.title).not.toMatch(/fight/i);
    later(db, 10);
    eventsTick(db);
    expect(money(db)).toBe(before);
    expect(softText("Jef finds a purse of gold coins. Then rain.")).toBe("Then rain.");
  });

  it("an unknown lead role breaks the schema: the engine falls back, nothing of the model's is played", async () => {
    const db = fresh(11);
    const bad = base();
    (bad.event.stages[0] as unknown as { leads: string[] }).leads = ["executioner"];
    const r = await think(db, reply(bad), true);
    expect(r.source).toBe("engine");
  });

  it("the invent button makes the model invent now, and says so when it will not", async () => {
    const db = fresh(11);
    const r = await think(db, reply(base()), true, true);
    expect(r.source).toBe("claude");
    expect(r.planned?.ok).toBe(true);
    const db2 = fresh(11);
    const none = await think(db2, reply({ ...base(), decision: "nothing" }), true, true);
    expect(none.planned).toBeNull();
    expect(none.error).toMatch(/nothing/);
    expect(liveEvents(db2).length).toBe(0);
    expect(directorPrompt(db2, true)).toMatch(/Invent an event now/);
  });

  it("no call is spent when no event could be planned (night)", async () => {
    const db = fresh(23);
    expect(roomForEvent(db)).toBe(false);
    let called = 0;
    const r = await think(db, async () => (called++, { output: base() }));
    expect(called).toBe(0);
    expect(r.decision).toBe("nothing");
  });
});

// ------------------------------------------------------------------ fixes 2026-09-24: sound cues, and where a lead really stands

describe("fixes 2026-09-24: the director's sound cues", () => {
  it("cleanCues keeps the palette only, holds every number, and takes four at most", () => {
    const out = cleanCues([
      { source: "cheer", every_s: 900, pitch: 9, level: 7 },
      { source: "gunshot", every_s: 5, pitch: 1, level: 1 },
      { source: "glass", every_s: -3, pitch: 0.1, level: 0 },
      { source: "cheer", every_s: 5, pitch: 1, level: 1 },
      { source: "fiddle", every_s: 10, pitch: 1, level: 0.5 },
      { source: "drum", every_s: 10, pitch: 1, level: 0.5 },
      { source: "dog", every_s: 10, pitch: 1, level: 0.5 },
      { source: "horse", every_s: 10, pitch: 1, level: 0.5 },
      "nonsense",
    ]);
    expect(out.map((c) => c.source)).toEqual(["cheer", "glass", "fiddle", "drum"]);
    expect(out[0]).toEqual({ source: "cheer", every_s: CUE_EVERY_MAX_S, pitch: CUE_PITCH_MAX, level: CUE_LEVEL_MAX });
    expect(out[1]).toEqual({ source: "glass", every_s: 0, pitch: CUE_PITCH_MIN, level: CUE_LEVEL_MIN });
    expect(cleanCues(undefined)).toEqual([]);
    expect(cleanCues("bells")).toEqual([]);
  });

  it("a stage's cues go through the clamp and reach the client; a stage without them has []", () => {
    const out = cleanStages([
      { ...stage({ op: "gather", minutes: 120, role: "crowd", count: 10, place: "grote_markt" }), cues: [{ source: "shout", every_s: 1, pitch: 1, level: 2 }, { source: "cannon", every_s: 5, pitch: 1, level: 1 }] },
      stage({ op: "talk", minutes: 60, text: "the weather" }),
    ]);
    expect(out[0].cues).toEqual([{ source: "shout", every_s: CUE_EVERY_MIN_S, pitch: 1, level: 1 }]);
    expect(out[1].cues).toEqual([]);
    const db = fresh(10);
    const ev = startTemplate(db, "fish_auction");
    const pub = publicEvent(db, ev);
    expect(pub.stages[1].cues.map((c) => c.source)).toEqual(["shout", "clatter"]);
    expect(pub.stages[0].cues).toEqual([]);
  });

  it("the director's own event keeps its cues", () => {
    const db = fresh(10);
    const p = planEvent(db, {
      title: "The temperance preacher",
      template: "preacher",
      place: "steenplein",
      start_in_min: 0,
      stages: [{ ...stage({ op: "gather", minutes: 120, role: "crowd", count: 12, place: "steenplein", leads: ["speaker"] }), cues: [{ source: "hymn", every_s: 30, pitch: 1, level: 0.6 }, { source: "laughter", every_s: 20, pitch: 1, level: 0.4 }] }],
      source: "claude",
    });
    expect(p.ok).toBe(true);
    const ev = eventRow(db, p.ok ? p.event.id : 0)!;
    expect(publicEvent(db, ev).stages[0].cues.map((c) => c.source)).toEqual(["hymn", "laughter"]);
  });
});

describe("fixes 2026-09-24: the talk prompt knows where a lead stands", () => {
  it("the auctioneer at the auction is on the Vismarkt, not at his stall; a bystander is in the crowd; nobody else changes", () => {
    const db = fresh(10);
    const ev = startTemplate(db, "fish_auction");
    const auct = leadsOf(ev).find((l) => l.role === "auctioneer")!;
    const r = res(db, auct.id);
    const line = talkHooks.doing(db, r)!;
    expect(line).toMatch(/Vismarkt/);
    expect(line).toMatch(/auctioneer/);
    expect(line).toMatch(/not at your shop/i);
    // while still walking there: on the way
    expect(actionOf(db, auct.id)?.phase).toBe("going");
    expect(talkHooks.doing(db, r)).toMatch(/on your way to/);
    reportAction(db, actionOf(db, auct.id)!.id, { phase: "arrived", x: ev.x, z: ev.z });
    expect(talkHooks.doing(db, r)).toMatch(/^on /);
    expect(residentPrompt(db, r, "scene", [])).toMatch(/You are on .*Vismarkt.*auctioneer/);
    // a person of the crowd
    const people = JSON.parse(eventRow(db, ev.id)!.people_json) as string[];
    const by = people.find((id) => id !== auct.id);
    if (by) expect(talkHooks.doing(db, res(db, by))).toMatch(/in the crowd/);
    // someone not in it: the schedule's own line
    const other = [...town(db).byId.values()].find((x) => !people.includes(x.id) && x.trade === "tobacconist") ?? [...town(db).byId.values()].find((x) => !people.includes(x.id))!;
    expect(talkHooks.doing(db, other)).toBeNull();
  });
});
