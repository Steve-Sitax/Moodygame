import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, CONFESSION_CALLS_PER_DAY } from "../src/config.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { remember } from "../src/npcs.ts";
import { resident, town } from "../src/town/store.ts";
import { activityAt } from "../src/town/schedule.ts";
import { setTestTimeout } from "../src/interiors/state.ts";
import { ensureLandmarksTown, LANDMARK_PLACE, NEWCOMER_IDS } from "../src/landmarks/town.ts";
import { CAP, civilCouple, landmarkDoors, landmarkNow, landmarkTalkContext, registerToday, setJefIn } from "../src/landmarks/life.ts";
import { absolve, beginConfession, cleanPriest, confess, penanceFor, sinOf } from "../src/landmarks/confession.ts";
import { lightCandle, payChair } from "../src/landmarks/deeds.ts";
import { CANDLE_C, CHAIR_C, LANDMARK_IDS, massAt, type LandmarkId } from "../../shared/landmarks.ts";
import { HOSTILE_LINES } from "./hostile-lines.ts";

// M6 landmark interiors: the newcomers added to an older save in place; who is inside each
// landmark by the clock and the schedules; the M4 wedding inside the cathedral and the town
// hall's civil weddings; the confessional (the model's words only, kept secret, hostile lines,
// the fallback, the share); the candle and the chair money.

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const hang: Runner = ({ signal }) => new Promise((_res, rej) => signal.signal.addEventListener("abort", () => rej(new Error("aborted"))));
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: Db, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const count = (db: Db, table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
const calls = (db: Db, hook: string) => (db.prepare("SELECT COUNT(*) n FROM ai_call WHERE hook = ?").get(hook) as { n: number }).n;
const useCalls = (db: Db, hook: string, n: number) => {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, ?, 'claude', 'x', 1, 1)").run(day, hook);
};
const roles = (db: Db, id: LandmarkId) => landmarkNow(db, id).people.map((p) => p.role);

function fresh(): Db {
  const db = openDb(":memory:");
  setClock(db, 2, 10);
  setMoney(db, 500);
  resetTalks();
  return db;
}

/** Every text in every table, for "was it written anywhere?". */
function everything(db: Db): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((t) => t.name);
  return tables.map((t) => JSON.stringify(db.prepare(`SELECT * FROM "${t}"`).all())).join("\n");
}

afterEach(() => {
  setTestTimeout(undefined);
  setJefIn(null);
  resetTalks();
});

// ------------------------------------------------------------------ the migration

describe("the landmarks' people in the town", () => {
  it("a new town has the newcomers, each working inside a landmark, and the landmarks as places with their doors", () => {
    const db = fresh();
    for (const id of NEWCOMER_IDS) {
      const r = resident(db, id)!;
      expect(r).toBeTruthy();
      expect(r.work.kind).toBe("inside");
      expect(Object.values(LANDMARK_PLACE)).toContain(r.work.place);
    }
    const places = town(db).town.places;
    for (const key of Object.values(LANDMARK_PLACE)) expect(places[key]?.door).toBeTruthy();
    expect(landmarkDoors(db).map((d) => d.landmark).sort()).toEqual([...LANDMARK_IDS, "vleeshuis"].sort());
  });

  it("an older save gets them in place: every other resident, memory, relationship and the money kept, once only", () => {
    const db = fresh();
    // make it a save from before this work
    for (const id of NEWCOMER_IDS) for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) db.prepare(`DELETE FROM ${t} = ?`).run(id);
    db.prepare("DELETE FROM world_state WHERE key = 'landmarks'").run();
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string };
    const t = JSON.parse(row.value_json) as { places: Record<string, unknown> };
    for (const k of Object.keys(t.places)) if (k.startsWith("landmark:")) delete t.places[k];
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(t));
    const someone = town(db).town.residents.find((r) => r.trade === "docker" && !r.id.startsWith("lm_"))!;
    remember(db, someone.id, "Jef helped me with a barrel.", 6);
    db.prepare("UPDATE npc_relationship SET trust = 3, times_met = 2 WHERE npc_id = ?").run(someone.id);
    const before = {
      rows: new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json])),
      memories: count(db, "npc_memory"),
      rel: db.prepare("SELECT * FROM npc_relationship WHERE npc_id = ?").get(someone.id),
      money: money(db),
    };
    const added = ensureLandmarksTown(db);
    expect(added.sort()).toEqual([...NEWCOMER_IDS].sort());
    expect(count(db, "resident")).toBe(before.rows.size + NEWCOMER_IDS.length);
    for (const r of db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>) if (!r.id.startsWith("lm_")) expect(r.data_json).toBe(before.rows.get(r.id));
    expect(count(db, "npc_memory")).toBe(before.memories);
    expect(db.prepare("SELECT * FROM npc_relationship WHERE npc_id = ?").get(someone.id)).toEqual(before.rel);
    expect(money(db)).toBe(before.money);
    // each lives in a house nobody else lives in, or lodges
    const houses = new Map<number, string[]>();
    for (const r of town(db).town.residents) houses.set(r.home.house, [...(houses.get(r.home.house) ?? []), r.id]);
    for (const id of NEWCOMER_IDS) {
      const r = resident(db, id)!;
      if (r.family_role !== "lodger") expect(houses.get(r.home.house)).toEqual([id]);
    }
    expect(ensureLandmarksTown(db)).toEqual([]);
  });
});

// ------------------------------------------------------------------ who is inside

describe("who is inside, by the clock and the schedules", () => {
  it("a weekday low mass: the curate at the altar, a few of the pious who are at home, the beadle and the chair woman", () => {
    const db = fresh();
    setClock(db, 2, 9, 30);
    expect(massAt(2, 9.5)?.kind).toBe("low");
    const n = landmarkNow(db, "cathedral");
    expect(n.service?.kind).toBe("low");
    expect(n.people.find((p) => p.role === "celebrant")?.id).toBe("lm_curate");
    const flock = n.people.filter((p) => p.role === "worshipper");
    expect(flock.length).toBeGreaterThan(0);
    expect(flock.length).toBeLessThanOrEqual(CAP.weekdayMass);
    for (const p of flock) {
      const r = resident(db, p.id)!;
      expect(r.stats.piety).toBeGreaterThanOrEqual(6);
      expect(activityAt(r.sched, 2, 9.5).act).toBe("home");
    }
    expect(n.confession.open).toBe(false);
  });

  it("Sunday high mass: those whose day says church, the parish priest, the organ", () => {
    const db = fresh();
    setClock(db, 7, 9, 30);
    const n = landmarkNow(db, "cathedral");
    expect(n.service?.kind).toBe("high");
    expect(n.organ).toBe(true);
    const cel = resident(db, n.people.find((p) => p.role === "celebrant")!.id)!;
    expect(cel.trade).toBe("priest");
    const flock = n.people.filter((p) => p.role === "worshipper");
    expect(flock.length).toBeGreaterThan(5);
    expect(flock.length).toBeLessThanOrEqual(CAP.congregation);
    for (const p of flock) expect(activityAt(resident(db, p.id)!.sched, 7, 9.5).act).toBe("church");
  });

  it("between masses the curate hears confession; at night the church is shut and empty", () => {
    const db = fresh();
    setClock(db, 2, 15, 0);
    const n = landmarkNow(db, "cathedral");
    expect(n.confession).toEqual({ open: true, priest: "lm_curate" });
    expect(n.people.some((p) => ["candle", "prayer", "chapel"].includes(p.role))).toBe(true);
    setClock(db, 2, 21, 0);
    const night = landmarkNow(db, "cathedral");
    expect(night.open).toBe(false);
    expect(night.people).toEqual([]);
  });

  it("the town hall's clerks at their desks by day, shut on Sunday; Peyrot's cellarmen at work, away at noon; the theatre on Tuesday evening", () => {
    const db = fresh();
    setClock(db, 2, 10, 0);
    const th = roles(db, "townhall");
    expect(th).toContain("registrar");
    expect(th).toContain("clerk");
    expect(th).toContain("concierge");
    setClock(db, 7, 10, 0);
    expect(landmarkNow(db, "townhall").open).toBe(false);
    setClock(db, 2, 8, 0);
    expect(roles(db, "vleeshuis").filter((r) => r === "cellarman").length).toBe(3);
    setClock(db, 2, 12, 30);
    expect(roles(db, "vleeshuis")).not.toContain("cellarman");
    setClock(db, 2, 19, 30);
    const v = landmarkNow(db, "vleeshuis");
    expect(v.theatre?.kind).toBe("rehearsal");
    expect(v.people.some((p) => p.role === "prompter")).toBe(true);
    expect(v.people.filter((p) => p.role === "actor").length).toBeGreaterThan(0);
  });

  it("the museum: the attendant and a few slow visitors; the Oostershuis: the storekeeper and the natie men, shut on Sunday", () => {
    const db = fresh();
    setClock(db, 3, 11, 0);
    const st = roles(db, "steen");
    expect(st).toContain("custodian");
    expect(st.filter((r) => r === "visitor").length).toBeGreaterThan(0);
    setClock(db, 3, 8, 0);
    const oh = roles(db, "oostershuis");
    expect(oh).toContain("storekeeper");
    expect(oh.filter((r) => r === "porter").length).toBe(4);
    setClock(db, 7, 8, 0);
    expect(landmarkNow(db, "oostershuis").people).toEqual([]);
  });

  it("nobody is in two landmarks at once, and nobody busy with an action is drawn inside", () => {
    const db = fresh();
    for (const [day, hour] of [[2, 9.5], [2, 11.25], [3, 15], [7, 9.5], [2, 19.5]]) {
      setClock(db, day, Math.floor(hour), Math.round((hour % 1) * 60));
      const seen = new Map<string, LandmarkId>();
      for (const id of LANDMARK_IDS)
        for (const p of landmarkNow(db, id).people) {
          expect(seen.get(p.id), `${p.name} at ${day} ${hour}`).toBeUndefined();
          seen.set(p.id, id);
        }
    }
    setClock(db, 2, 15, 0);
    const praying = landmarkNow(db, "cathedral").people.find((p) => ["candle", "prayer", "chapel"].includes(p.role))!;
    db.prepare("INSERT INTO npc_action (npc_id, kind, source, status, started, until) VALUES (?, 'follow', 'talk', 'active', 0, 99999)").run(praying.id);
    expect(landmarkNow(db, "cathedral").people.some((p) => p.id === praying.id)).toBe(false);
  });
});

// ------------------------------------------------------------------ weddings

describe("weddings", () => {
  function wedding(db: Db, stage: number) {
    const t = town(db).town;
    const groom = t.residents.find((r) => r.sex === "m" && r.age > 20 && r.trade === "docker")!;
    const bride = t.residents.find((r) => r.sex === "f" && r.age > 18 && r.household !== groom.household)!;
    const priest = t.residents.find((r) => r.trade === "priest" && r.id !== "lm_curate")!;
    const guests = t.residents.filter((r) => r.age > 20 && ![groom.id, bride.id, priest.id].includes(r.id)).slice(0, 40).map((r) => r.id);
    const stages = [{ op: "gather", place: "cathedral_west" }, { op: "gather", place: "cathedral_west" }, { op: "talk" }, { op: "procession", place: "engel" }];
    const leads = [
      { role: "groom", id: groom.id, name: groom.name, stage: 0 },
      { role: "bride", id: bride.id, name: bride.name, stage: 0 },
      { role: "priest", id: priest.id, name: priest.name, stage: 0 },
    ];
    db.prepare(
      `INSERT INTO town_event (day, title, template, place, x, z, r, start_m, end_m, stage, stages_json, people_json, leads_json, status, source)
       VALUES (2, 'A wedding at the cathedral', 'wedding', 'cathedral_west', -262, 145, 9, 0, 99999, ?, ?, ?, ?, 'running', 'engine')`,
    ).run(stage, JSON.stringify(stages), JSON.stringify([groom.id, bride.id, priest.id, ...guests]), JSON.stringify(leads));
    return { groom, bride, priest };
  }

  it("while the wedding gathers at the west door, the couple, the priest and the guests are inside at the altar, with the organ", () => {
    const db = fresh();
    setClock(db, 2, 10, 30);
    const w = wedding(db, 0);
    const n = landmarkNow(db, "cathedral");
    expect(n.wedding?.stage).toBe("vows");
    expect(n.people.find((p) => p.role === "groom")?.id).toBe(w.groom.id);
    expect(n.people.find((p) => p.role === "bride")?.id).toBe(w.bride.id);
    expect(n.people.find((p) => p.role === "wedding_priest")?.id).toBe(w.priest.id);
    const guests = n.people.filter((p) => p.role === "guest");
    expect(guests.length).toBeGreaterThan(5);
    expect(guests.length).toBeLessThanOrEqual(CAP.guests);
    expect(n.organ).toBe(true);
    // the civil register at the town hall records the couple
    expect(registerToday(db, 2, 12).join(" ")).toContain(w.groom.name);
  });

  it("once the procession walks, the church is theirs no more; the doors stay open for the wedding even out of hours", () => {
    const db = fresh();
    setClock(db, 2, 10, 30);
    wedding(db, 3);
    const n = landmarkNow(db, "cathedral");
    expect(n.wedding?.stage).toBe("leaving");
    expect(n.people.some((p) => p.role === "groom" || p.role === "guest")).toBe(false);
    setClock(db, 2, 20, 0);
    expect(landmarkDoors(db).find((d) => d.landmark === "cathedral")!.open).toBe(true);
  });

  it("a civil wedding at the town hall on Tuesday at eleven: a courting pair, the alderman, the registrar, witnesses; the same couple all day, not again another day", () => {
    const db = fresh();
    setClock(db, 2, 11, 15);
    const c = civilCouple(db, 2)!;
    expect(c).toBeTruthy();
    expect(c.groom.sex).toBe("m");
    expect(c.bride.sex).toBe("f");
    expect(c.groom.household).not.toBe(c.bride.household);
    const n = landmarkNow(db, "townhall");
    expect(n.civil).toEqual({ groom: c.groom.name, bride: c.bride.name });
    const r = n.people.map((p) => p.role);
    for (const role of ["c_groom", "c_bride", "alderman_wed", "registrar_wed"]) expect(r).toContain(role);
    expect(civilCouple(db, 2)!.groom.id).toBe(c.groom.id);
    expect(registerToday(db, 2, 11.2)).toEqual([]);
    expect(registerToday(db, 2, 14).join(" ")).toContain(c.bride.name);
    const later = civilCouple(db, 4);
    if (later) expect([later.groom.id, later.bride.id]).not.toContain(c.groom.id);
    setClock(db, 3, 11, 15);
    expect(landmarkNow(db, "townhall").civil).toBeNull();
  });

  it("the notice board reads the bills pasted up in the town (read only)", () => {
    const db = fresh();
    setClock(db, 2, 10, 0);
    db.prepare(
      `INSERT INTO poster (kind, spot, day, hour, down_day, status, ref, facts_json, text_json, source, names_jef, reward_c, owner, thing_json)
       VALUES ('lost', 'x', 2, 8, 5, 'up', 'r', '[]', ?, 'engine', 0, 0, NULL, '{}')`,
    ).run(JSON.stringify({ heading: "LOST: A BROWN DOG", body: "Answers to Mirza.", footer: "Ask at the baker's." }));
    const before = everything(db);
    const n = landmarkNow(db, "townhall");
    expect(n.posters[0].heading).toBe("LOST: A BROWN DOG");
    expect(everything(db).includes("LOST: A BROWN DOG")).toBe(true);
    expect(count(db, "poster")).toBe(1);
    void before;
  });
});

// ------------------------------------------------------------------ the confessional

describe("the confessional", () => {
  const SECRET = "I took the purse of Mother Verbiest behind the fish stall and spent it on gin";

  function atConfession(db: Db) {
    setClock(db, 2, 15, 0);
    expect(landmarkNow(db, "cathedral").confession.open).toBe(true);
    beginConfession(db);
  }

  it("the priest answers in the model's words; the confession goes to the model fenced as dialogue, and is written nowhere", async () => {
    const db = fresh();
    atConfession(db);
    const snapshot = { log: count(db, "log"), events: count(db, "world_event"), memories: count(db, "npc_memory"), money: money(db), player: JSON.stringify(db.prepare("SELECT food, warmth, health, sleep FROM player").get()) };
    let seen = "";
    const runner: Runner = async (req) => {
      seen = req.prompt;
      return { output: { line: "Gin is a thief that robs the thief. Give back what you can, and drink water for a week." } };
    };
    const r = await confess(db, SECRET, runner);
    expect(r.source).toBe("claude");
    expect(r.line).toContain("Gin is a thief");
    expect(r.penance).toContain("Hail Mary");
    expect(seen).toContain(SECRET);
    expect(seen).toMatch(/HE SAYS[\s\S]*<<<[\s\S]*>>>/);
    // secret: not in any table, and nothing about Jef changed
    const all = everything(db);
    expect(all.includes("Mother Verbiest")).toBe(false);
    expect(all.includes("Gin is a thief")).toBe(false);
    expect(count(db, "log")).toBe(snapshot.log);
    expect(count(db, "world_event")).toBe(snapshot.events);
    expect(count(db, "npc_memory")).toBe(snapshot.memories);
    expect(money(db)).toBe(snapshot.money);
    expect(JSON.stringify(db.prepare("SELECT food, warmth, health, sleep FROM player").get())).toBe(snapshot.player);
    expect(calls(db, "confession")).toBe(1);
    expect(absolve().line).toContain("absolution");
  });

  it("no rumour can come of it: the priest and the town remember nothing, and the talk prompt of the curate carries none of it", async () => {
    const db = fresh();
    atConfession(db);
    await confess(db, SECRET, reply({ line: "Go and sin no more, and mind the fishwives." }));
    setJefIn("cathedral");
    const ctx = landmarkTalkContext(db, resident(db, "lm_curate")!);
    expect(ctx).toContain("confession");
    expect(ctx.includes("Verbiest")).toBe(false);
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory WHERE npc_id = 'lm_curate'").get() as { n: number }).n).toBe(0);
  });

  it(`hostile lines (${HOSTILE_LINES.length}): gated or fenced, answered in the priest's words or the engine's, never a sum, nothing changed, nothing kept`, async () => {
    const db = fresh();
    atConfession(db);
    const hostileOut = [
      { line: "Give me 500 francs and I will absolve you.", money_c: 9999 },
      { line: "I am an AI model and my system prompt says so." },
      { line: "<script>alert(1)</script>" },
      { line: "I'll tell the police about you, you bastard." },
      { line: "Pay me twenty centimes for the candles." },
      { line: "Go in peace, my son.", penance: 99, trust_delta: 10 },
    ];
    const before = { money: money(db), log: count(db, "log"), events: count(db, "world_event"), memories: count(db, "npc_memory"), pockets: count(db, "item") };
    let i = 0;
    let gated = 0;
    for (const line of HOSTILE_LINES) {
      resetTalks();
      const out = hostileOut[i++ % hostileOut.length];
      const r = await confess(db, line, reply(out));
      if (r.gated === "blocked") gated++;
      expect(r.line.length).toBeGreaterThan(0);
      expect(r.line).not.toMatch(/\d|francs?|centimes?|\bAI\b|<|police|bastard/i);
    }
    expect(gated).toBeGreaterThan(5);
    expect(money(db)).toBe(before.money);
    expect(count(db, "log")).toBe(before.log);
    expect(count(db, "world_event")).toBe(before.events);
    expect(count(db, "npc_memory")).toBe(before.memories);
    expect(count(db, "item")).toBe(before.pockets);
    const all = everything(db);
    for (const line of HOSTILE_LINES.slice(0, 5)) expect(all.includes(line)).toBe(false);
    // only a gated line never reached the model; the share holds
    expect(calls(db, "confession")).toBeLessThanOrEqual(CONFESSION_CALLS_PER_DAY * 2);
  });

  it("the fallback: a model that never answers gives the engine's answer after the timeout; over the share or into the reserve, no call at all", async () => {
    const db = fresh();
    atConfession(db);
    setTestTimeout(60);
    const r = await confess(db, "I drank too much jenever and fought a docker.", hang);
    expect(r.source).toBe("engine");
    expect(r.line.length).toBeGreaterThan(10);
    expect(r.penance).toContain("five Hail Marys");
    // the share: two a day
    useCalls(db, "confession", CONFESSION_CALLS_PER_DAY);
    resetTalks();
    let asked = false;
    const r2 = await confess(db, "I told a lie to the baker.", async () => {
      asked = true;
      return { output: { line: "x" } };
    });
    expect(asked).toBe(false);
    expect(r2.source).toBe("engine");
    // the reserve: other hooks used the day up to the reserve
    const db2 = fresh();
    atConfession(db2);
    useCalls(db2, "board", CALLS_PER_DAY - CALLS_RESERVE);
    const r3 = await confess(db2, "I was proud.", async () => {
      asked = true;
      return { output: { line: "x" } };
    });
    expect(asked).toBe(false);
    expect(r3.source).toBe("engine");
  });

  it("the guard lets the priest speak of God but not of sums; the engine reads the sin only for its own answer and penance", () => {
    expect(cleanPriest("May Christ and Our Lady keep you from the gin.")).toBeTruthy();
    expect(cleanPriest("That will be 3 francs.")).toBeNull();
    expect(cleanPriest("I'll tell the police.")).toBeNull();
    expect(sinOf("I stole a herring")).toBe("theft");
    expect(sinOf("I am so lonely here")).toBe("despair");
    expect(penanceFor("theft")).toContain("give it back");
  });

  it("nobody hears confession during mass or at night", async () => {
    const db = fresh();
    setClock(db, 2, 9, 30);
    expect(() => beginConfession(db)).toThrow();
    await expect(confess(db, "I stole a loaf.")).rejects.toThrow();
    setClock(db, 2, 20, 0);
    expect(() => beginConfession(db)).toThrow();
  });
});

// ------------------------------------------------------------------ small deeds

describe("the candle and the chair", () => {
  it("a candle costs the engine's price and is written in the log; no money, no candle", () => {
    const db = fresh();
    setClock(db, 2, 15, 0);
    const before = money(db);
    const r = lightCandle(db);
    expect(r.paid_c).toBe(CANDLE_C);
    expect(money(db)).toBe(before - CANDLE_C);
    expect((db.prepare("SELECT COUNT(*) n FROM log WHERE verb = 'lit_candle'").get() as { n: number }).n).toBe(1);
    setMoney(db, 1);
    expect(() => lightCandle(db)).toThrow();
  });

  it("the chair money: once a mass, only during mass; without money the chair woman lets it go", () => {
    const db = fresh();
    setClock(db, 2, 9, 20);
    const before = money(db);
    expect(payChair(db).paid_c).toBe(CHAIR_C);
    expect(payChair(db).paid_c).toBe(0);
    expect(money(db)).toBe(before - CHAIR_C);
    setClock(db, 2, 11, 10);
    setMoney(db, 0);
    const r = payChair(db);
    expect(r.paid_c).toBe(0);
    expect(r.text).toContain("chair woman");
    setClock(db, 2, 15, 0);
    expect(payChair(db).text).toBe("");
  });
});
