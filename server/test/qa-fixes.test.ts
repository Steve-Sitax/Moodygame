import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { sleep } from "../src/day.ts";
import { resetSync } from "../src/director/actions.ts";
import { eventRow, eventsTick, fitTitle, freeResidents, funeralWidow, gather, keptAtWork, leadsOf, planEvent, stage } from "../src/director/scheduler.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";
import { takeKey } from "../src/homes/homes.ts";
import { writeTo } from "../src/ideas/letters.ts";
import { applyTrust, relationship, remember, trustText, TRUST_MIN } from "../src/npcs.ts";
import { buy, pockets } from "../src/trade.ts";
import { deedTables } from "../src/town/deeds.ts";
import { shownTrade } from "../src/town/places.ts";
import { cellNight, policeState, policeTick, RUMOUR_HOLDERS } from "../src/town/police.ts";
import { rumoursOf, stillTrue, toYou, whoYou } from "../src/town/rumours.ts";
import { activityAt } from "../src/town/schedule.ts";
import { resident, town } from "../src/town/store.ts";
import { residentOpen } from "../src/town/talk.ts";
import { strangerId, visitorOf } from "../src/town/visitors.ts";

// Fixes after the QA play of 2026-09-24 (data/test-qa.sqlite): the server side of each, one block per finding.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);

function fresh(day = 2, hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, 'npc_convo', 'claude', 'x', 1, 1)").run(day);
  return db;
}

beforeEach(() => resetSync());

describe("a counter, a post or a landmark's staff at work is never taken for an event", () => {
  const COUNTERS = ["dealer", "pawnbroker", "post_clerk", "lodging_keeper", "publican", "baker", "grocer", "chandler", "tobacconist", "cobbler", "market_woman", "fishwife", "sexton"];
  const LANDMARK = ["registrar", "alderman", "concierge", "cellar_master", "attendant", "storekeeper", "organist", "beadle", "chair_woman"];

  it("every counter trade and landmark post counts as kept while its hours say work", () => {
    const db = fresh(2, 10.5);
    const t = town(db).town;
    for (const trade of [...COUNTERS, ...LANDMARK]) {
      const rs = t.residents.filter((r) => r.trade === trade);
      expect(rs.length, trade).toBeGreaterThan(0);
      for (const r of rs) {
        const working = activityAt(r.sched, 2, 10.5).act === "work";
        expect(keptAtWork(db, r), `${r.name} (${trade})`).toBe(working);
      }
    }
    // the second-hand dealer of the QA play: at his shop at half past ten on a weekday
    const dolf = t.residents.find((r) => r.trade === "dealer")!;
    expect(keptAtWork(db, dolf)).toBe(true);
  });

  it("a wedding's guests and the ballad singer's crowd leave every kept one at work", () => {
    const db = fresh(2, 10.5);
    const t = town(db).town;
    const dolf = t.residents.find((r) => r.trade === "dealer")!;
    const at = { x: dolf.home.sx, z: dolf.home.sz };
    const places = ["grote_markt", "vismarkt", "werf", "rijnkaai", "bassin"];
    for (const [k, role] of (["guests", "crowd", "mourners", "musicians"] as const).entries()) {
      const p = planEvent(db, { title: `test ${role}`, template: "quarrel", place: places[k], start_in_min: 0, stages: [stage({ op: "gather", minutes: 20, role, count: 60 })], source: "engine" });
      expect(p.ok, !p.ok ? p.why : "").toBe(true);
      const ev = p.ok ? p.event : null;
      const picked = gather(db, ev!, role, 60, at, "the dealer's corner");
      for (const id of picked) {
        const r = town(db).byId.get(id)!;
        expect(keptAtWork(db, r), `${r.name} (${r.trade}) taken as ${role}`).toBe(false);
      }
      expect(picked).not.toContain(dolf.id);
      db.prepare("UPDATE town_event SET status = 'done' WHERE id = ?").run(ev!.id);
    }
    // and the engine's own casting (the fire chain, the firemen) the same
    const last = db.prepare("SELECT * FROM town_event ORDER BY id DESC LIMIT 1").get() as Parameters<typeof freeResidents>[1];
    const free = freeResidents(db, last, () => true);
    expect(free.length).toBeGreaterThan(20);
    expect(free.some((r) => keptAtWork(db, r))).toBe(false);
  });

  it("after work the same people may come", () => {
    const db = fresh(2, 20);
    const dolf = town(db).town.residents.find((r) => r.trade === "dealer")!;
    expect(keptAtWork(db, dolf)).toBe(false);
  });
});

describe("engine text: grammar, and facts still true", () => {
  it("'you rents' becomes 'you rent'; 'the one who' keeps the verb and never says 'who you'", () => {
    expect(toYou("Jef rents a room from Adriaan Verhoeven")).toBe("you rent a room from Adriaan Verhoeven");
    expect(toYou("Jef carries sacks for the Hessenatie")).toBe("you carry sacks for the Hessenatie");
    expect(toYou("Jef was fined by the police")).toBe("you were fined by the police");
    expect(whoYou("Jef rents a room from me")).toBe("rents a room from me");
    expect(whoYou("Jef lied to me to get smoked eel cheaper")).toBe("lied to me to get smoked eel cheaper");
  });

  it("an old save's 'told X a lie to get her eel cheaper' is said as 'lied to X to get eel cheaper'", () => {
    const db = fresh(3, 10);
    const r = town(db).town.residents.find((x) => x.age > 20 && x.stats.gossip >= 5 && x.trade !== "thief")!;
    remember(db, r.id, "Jef lied to me.", 7, "seen", null, { gist: `Jef told ${r.name} a lie to get her smoked eel cheaper`, tone: -1 });
    expect(rumoursOf(db, r.id)[0].gist).toBe(`Jef lied to ${r.name} to get smoked eel cheaper`);
    const line = residentOpen(db, r.id).npc_line;
    expect(line).not.toMatch(/who you|a lie to get her/);
  });

  it("'Jef rents a room from X' is only said while the lease runs", () => {
    const db = fresh(3, 19);
    db.prepare("UPDATE player SET money_c = 2000 WHERE id = 1").run();
    takeKey(db, "cellar", "day");
    const gist = (db.prepare("SELECT gist FROM npc_memory WHERE gist LIKE 'Jef rents a room from %'").get() as { gist: string }).gist;
    expect(stillTrue(db, gist)).toBe(true);
    db.prepare("UPDATE home_lease SET ended = 'moved'").run();
    expect(stillTrue(db, gist)).toBe(false);
  });
});

describe("the night sheet", () => {
  it("pea soup eaten at the tavern counter counts as a meal", () => {
    const db = fresh(3, 13);
    const pub = town(db).town.residents.find((r) => r.trade === "publican" && activityAt(r.sched, 3, 13).act === "work")!;
    buy(db, pub.id, "soup");
    expect(pockets(db).some((i) => i.kind === "soup")).toBe(false);
    setClock(db, 3, 22);
    const night = sleep(db, "bed");
    expect(night.summary.join(" ")).toMatch(/You ate 1 time\./);
  });

  it("a night in the cell does the night's other work: rent owed brings its note", () => {
    const db = fresh(3, 19);
    db.prepare("UPDATE player SET money_c = 2000 WHERE id = 1").run();
    takeKey(db, "cellar", "day"); // paid for day 3 only
    setClock(db, 4, 20);
    const n = cellNight(db, 0);
    expect(n.summary.join(" ")).toMatch(/A note from .* rent owed/);
  });

  it("the dawn hiring is planned even when the first tick after the night comes late", () => {
    const db = fresh(2, 22);
    sleep(db, "bed");
    setClock(db, 3, 6, 40); // the night sheet stood open past the old 6:15 limit
    eventsTick(db);
    const h = db.prepare("SELECT day FROM town_event WHERE template = 'hiring'").get() as { day: number } | undefined;
    expect(h?.day).toBe(3);
  });
});

describe("labels: never a secret trade", () => {
  it("a thief shows as a day labourer, the fortune teller as a fortune teller, in the letter list too", () => {
    const db = fresh();
    const t = town(db).town;
    const thief = t.residents.find((r) => r.trade === "thief")!;
    expect(shownTrade(thief)).toBe("day labourer");
    const zelie = t.residents.find((r) => visitorOf(r)?.role === "fortune")!;
    expect(shownTrade(zelie)).toBe("fortune teller");
    for (const r of [thief, zelie]) db.prepare("UPDATE npc_relationship SET times_met = 2, last_seen_day = 2 WHERE npc_id = ?").run(r.id);
    const list = writeTo(db);
    expect(list.map((p) => p.trade).join(" ")).not.toMatch(/thief|pickpocket|retired|old hand/);
    expect(list.find((p) => p.id === zelie.id)?.trade).toBe("fortune teller");
  });
});

describe("the police", () => {
  it("a verdict closes the matter: the town's talk brings no agent over what was done before it", () => {
    const db = fresh(5, 12);
    deedTables(db);
    db.prepare(
      "INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status) VALUES (1, 7, 30, 'boat', 'punt', 'boat:canal', 'r123', -73, 43.41, 0, 0, '[]', NULL, 'open')",
    ).run();
    const talkers = town(db).town.residents.filter((r) => r.age > 16).slice(0, RUMOUR_HOLDERS + 2);
    for (const r of talkers) remember(db, r.id, "Jef stole a boat.", 5, "heard", null, { gist: "Jef stole a boat from the canal steps", tone: -2 });
    const s = policeState(db);
    const put = (v: object) =>
      db.prepare("INSERT INTO world_state (key, value_json) VALUES ('police', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(v));
    put({ ...s, settledAt: (5 - 1) * 1440 + 11 * 60 });
    policeTick(db);
    expect(policeState(db).visit).toBeNull();
    // without a verdict since, the town's talk does bring one
    put({ ...s, settledAt: undefined, talkDay: 0 });
    policeTick(db);
    expect(policeState(db).visit?.reason).toBe("talk");
  });
});

describe("events cast from the real town", () => {
  it("a funeral: the widow is a real widow, it goes from her house, and a priest leads the procession", () => {
    const db = fresh(2, 8);
    const w = funeralWidow(db);
    expect(w).not.toBeNull();
    expect(w!.family_role).toBe("widow");
    const p = planEvent(db, planFromTemplate(templateById("funeral")!, "engine", { start_in_min: 0 }), { dev: true });
    expect(p.ok, !p.ok ? p.why : "").toBe(true);
    const ev = (p as { event: NonNullable<ReturnType<typeof eventRow>> }).event;
    expect(ev.place).toBe(`house:${w!.id}`);
    const stages = JSON.parse(ev.stages_json) as Array<{ op: string; leads: string[] }>;
    expect(stages.find((s) => s.op === "procession")!.leads[0]).toBe("priest");
    eventsTick(db);
    const leads = leadsOf(eventRow(db, ev.id)!);
    expect(leads.find((l) => l.role === "widow")?.id).toBe(w!.id);
    expect(leads.some((l) => l.role === "priest")).toBe(true);
    expect(resident(db, w!.id)!.trade).not.toBe("lodging_keeper");
  });

  it("a title fits its real leads: a clerk's wedding is not a docker's", () => {
    const db = fresh(2, 9);
    const clerk = town(db).town.residents.find((r) => r.trade === "clerk")!;
    expect(fitTitle(db, "A docker's wedding at the cathedral", [{ role: "groom", id: clerk.id }])).toBe("A clerk's wedding at the cathedral");
    const w = town(db).town.residents.find((r) => r.family_role === "widow")!;
    expect(fitTitle(db, "A docker's funeral", [{ role: "widow", id: w.id }])).toBe(`The funeral of ${w.name}'s husband`);
    expect(fitTitle(db, "A wedding at the cathedral", [])).toBe("A wedding at the cathedral");
  });

  it("a stranger (and one who has left) is never taken for a part", () => {
    const db = fresh(5, 10);
    const p = planEvent(db, { title: "test", template: "quarrel", place: "rijnkaai", start_in_min: 0, stages: [stage({ op: "gather", minutes: 20, role: "crowd", count: 60 })], source: "engine" });
    expect(p.ok, !p.ok ? p.why : "").toBe(true);
    const free = freeResidents(db, (p as { event: Parameters<typeof freeResidents>[1] }).event, () => true);
    expect(free.some((r) => r.id === strangerId("gambler") || !!visitorOf(r))).toBe(false);
  });
});

describe("the bucket chain", () => {
  it("lines up while the pump comes, one person to a place, all in the line from the water to the door", () => {
    const db = fresh(2, 10);
    const p = planEvent(db, planFromTemplate(templateById("house_fire")!, "engine", { start_in_min: 0 }), { dev: true });
    expect(p.ok, !p.ok ? p.why : "").toBe(true);
    const id = (p as { event: { id: number } }).event.id;
    const at = (m: number) => setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
    const ev0 = eventRow(db, id)!;
    at(ev0.start_m);
    eventsTick(db);
    eventsTick(db);
    at(ev0.start_m + 45); // the brigade stage
    eventsTick(db);
    const ev = eventRow(db, id)!;
    const fire = (JSON.parse(ev.stages_json) as Array<{ fire?: { chain: Array<[number, number]>; chainIds: string[] } }>)[0].fire!;
    expect(fire.chainIds.length).toBeGreaterThanOrEqual(20);
    const acts = db.prepare("SELECT npc_id, target_x, target_z, data_json FROM npc_action WHERE status = 'active' AND event_id = ?").all(id) as Array<{ npc_id: string; target_x: number; target_z: number; data_json: string }>;
    const chain = acts.filter((a) => JSON.parse(a.data_json).role === "chain");
    expect(chain.length).toBe(fire.chainIds.length);
    const slots = chain.map((a) => fire.chain.findIndex(([x, z]) => Math.abs(x - a.target_x) < 0.05 && Math.abs(z - a.target_z) < 0.05));
    expect(slots.every((k) => k >= 0)).toBe(true);
    expect(new Set(slots).size).toBe(slots.length); // one to a place
    // the chain stage fills gaps and moves nobody already in place
    const before = new Map(chain.map((a) => [a.npc_id, `${a.target_x},${a.target_z}`]));
    at(ev0.start_m + 105);
    eventsTick(db);
    const after = db.prepare("SELECT npc_id, target_x, target_z FROM npc_action WHERE status = 'active' AND event_id = ?").all(id) as Array<{ npc_id: string; target_x: number; target_z: number }>;
    for (const a of after) if (before.has(a.npc_id)) expect(`${a.target_x},${a.target_z}`).toBe(before.get(a.npc_id));
  });
});

describe("trust below 0 (Steve 2026-09-24)", () => {
  it("personal trust goes down to -5 and no further; a stranger lied to thinks less of Jef", () => {
    const db = fresh();
    const r = town(db).town.residents.find((x) => x.age > 20)!;
    expect(relationship(db, r.id).trust).toBe(0);
    applyTrust(db, r.id, -2, 0);
    expect(relationship(db, r.id).trust).toBe(-2);
    for (let i = 0; i < 5; i++) applyTrust(db, r.id, -2, 0);
    expect(relationship(db, r.id).trust).toBe(TRUST_MIN);
    expect(trustText(-1)).toMatch(/dislikes Jef/);
    expect(trustText(-4)).toMatch(/can't stand Jef/);
    expect(trustText(3)).toBe("3 of 10");
  });

  it("an old save's faction trust keeps its values, and may now go below 0 (never under -5)", () => {
    const file = path.join(os.tmpdir(), `scheldemist-trust-${process.pid}.sqlite`);
    fs.rmSync(file, { force: true });
    // a whole save, then its faction table put back as older builds made it (CHECK 0 to 10)
    openDb(file).close();
    const old = new Database(file);
    old.exec("DROP TABLE faction_trust");
    old.exec("CREATE TABLE faction_trust (faction TEXT PRIMARY KEY, trust INTEGER NOT NULL CHECK (trust BETWEEN 0 AND 10))");
    old.exec("INSERT INTO faction_trust VALUES ('politie', 3), ('kerk', 0), ('naties', 7)");
    old.close();
    const db = openDb(file);
    const rows = db.prepare("SELECT faction, trust FROM faction_trust WHERE faction IN ('politie', 'kerk', 'naties') ORDER BY faction").all();
    expect(rows).toEqual([
      { faction: "kerk", trust: 0 },
      { faction: "naties", trust: 7 },
      { faction: "politie", trust: 3 },
    ]);
    db.prepare("UPDATE faction_trust SET trust = MAX(-5, trust - 8) WHERE faction = 'politie'").run();
    expect((db.prepare("SELECT trust FROM faction_trust WHERE faction = 'politie'").get() as { trust: number }).trust).toBe(-5);
    expect(() => db.prepare("UPDATE faction_trust SET trust = -6 WHERE faction = 'kerk'").run()).toThrow();
    db.close();
    fs.rmSync(file, { force: true });
  });
});
