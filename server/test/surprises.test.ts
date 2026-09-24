import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { remember } from "../src/npcs.ts";
import { town } from "../src/town/store.ts";
import { residentChoice, residentOpen } from "../src/town/talk.ts";
import { driftWording, rumoursOf, spreadRumours, withinFact } from "../src/town/rumours.ts";
import { FORTUNE_ID, isAwayVisitor, strangerId } from "../src/town/visitors.ts";
import { activityAt } from "../src/town/schedule.ts";
import { actionOf, installTalkHooks, isReserved, reportAction, resetSync, syncFromClient } from "../src/director/actions.ts";
import { resetConvos } from "../src/director/convo.ts";
import { directorPrompt } from "../src/director/director.ts";
import { installFamilies } from "../src/director/families.ts";
import {
  arriveStranger,
  dreamOf,
  engineDream,
  FORTUNE_C,
  installSurprises,
  keepPromise,
  leaveStranger,
  planSchemes,
  promiseOf,
  PROMISE_LOSS_C,
  runScheme,
  schemesToday,
  schemeTick,
  strangersHere,
  strangerTick,
  tellFortune,
  twistRumours,
} from "../src/director/surprises.ts";

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const fail: Runner = async () => {
  throw new Error("no model in tests");
};
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const player = (db: Db) => db.prepare("SELECT money_c, food, warmth, health, sleep FROM player WHERE id = 1").get();
function fresh(hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, 1, hour);
  return db;
}

beforeEach(() => {
  resetTalks();
  resetSync();
  resetConvos();
  installTalkHooks();
  installFamilies();
  installSurprises();
});

describe("the fortune teller and her promise", () => {
  it("is in town by day at her table, reachable, and nobody's to borrow", () => {
    const db = fresh(11);
    const z = town(db).byId.get(FORTUNE_ID)!;
    expect(z.name).toBe("Madame Zelie");
    expect(activityAt(z.sched, 1, 11).act).toBe("work");
    expect(activityAt(z.sched, 1, 21).act).toBe("home");
    expect(isReserved(db, FORTUNE_ID)).toBe(true);
    const open = residentOpen(db, FORTUNE_ID);
    expect(open.choices[0]).toMatch(/fortune/i);
  });

  it("the cards cost the engine's coin, and leave a hidden promise the director hears of", async () => {
    const db = fresh(11);
    const m0 = money(db);
    const r = await tellFortune(db, reply({ prophecy: "The Knight of Cups, over the water. A stranger will know your name.", promise: "stranger" }));
    expect(r.text).toMatch(/Knight of Cups/);
    expect(money(db)).toBe(m0 - FORTUNE_C);
    const p = promiseOf(db)!;
    expect(p.kind).toBe("stranger");
    expect(p.status).toBe("open");
    expect(directorPrompt(db)).toMatch(/A PROMISE TO KEEP/);
    // the engine keeps it: a stranger arrives
    setClock(db, 2, 10);
    const how = await keepPromise(db, { force: true, runner: fail });
    expect(how).toMatch(/arrived|in town/);
    expect(promiseOf(db)!.status).toBe("kept");
    expect(strangersHere(db).length).toBe(1);
  });

  it("a model reading with a weapon or a sum falls back to the engine's cards; no coin, no cards", async () => {
    const db = fresh(11);
    const r = await tellFortune(db, reply({ prophecy: "You will be stabbed for 500 francs.", promise: "loss" }), () => 0);
    expect(r.text).not.toMatch(/stabbed|500/);
    db.prepare("UPDATE player SET money_c = 2 WHERE id = 1").run();
    setClock(db, 2, 11);
    const r2 = await tellFortune(db, fail);
    expect(r2.text).toMatch(/No coin/);
    expect(money(db)).toBe(2);
  });

  it("a promised loss is small and the engine's; lapses when its days are past", async () => {
    const db = fresh(11);
    await tellFortune(db, reply({ prophecy: "The Five of Spades, upside down. Something small slips away.", promise: "loss" }));
    const m0 = money(db);
    const how = await keepPromise(db, { force: true });
    expect(how).toMatch(/lost/);
    expect(m0 - money(db)).toBeLessThanOrEqual(PROMISE_LOSS_C);
    const db2 = fresh(11);
    await tellFortune(db2, reply({ prophecy: "The Knave of Hearts. Someone is looking for you.", promise: "meeting" }));
    setClock(db2, 5, 12);
    expect(await keepPromise(db2, { force: true })).toBeNull();
    expect(promiseOf(db2)!.status).toBe("lapsed");
  });
});

describe("strangers from the ships", () => {
  it("wait away out of sight, arrive with the model's name and story, walk the town, then leave", async () => {
    const db = fresh(10);
    const id = strangerId("sailor");
    expect(isAwayVisitor(town(db).byId.get(id))).toBe(true);
    const s = (await arriveStranger(db, { kind: "sailor", runner: reply({ first: "Olaf", surname: "Brekke", origin: "Bergen", story: "A Norwegian deck hand paid off in Antwerp.", goal: "to find a berth home", secret: "He owes his captain money.", greeting: "You there. Where does a man find a berth?" }), rng: () => 0 }))!;
    expect(s.name).toBe("Olaf Brekke");
    expect(s.visitor!.here).toBe(true);
    expect(activityAt(s.sched, 1, 12).act).not.toBe("home");
    expect(residentOpen(db, id).npc_line).toMatch(/berth/);
    // the stay is the engine's (1-3 days), then he leaves
    setClock(db, 1 + 4, 17);
    await strangerTick(db, { runner: fail, rng: () => 0.99 });
    expect(isAwayVisitor(town(db).byId.get(id))).toBe(true);
  });

  it("a bad name from the model (a townsperson's, or not a name) gets the engine's stranger", async () => {
    const db = fresh(10);
    const taken = town(db).town.residents[3];
    const s = (await arriveStranger(db, { kind: "merchant", runner: reply({ first: taken.first, surname: taken.surname, origin: "x", story: "a", goal: "b", secret: "c", greeting: "d" }) }))!;
    expect(s.name).toBe("Arthur Pembury");
    const s2 = (await arriveStranger(db, { kind: "gambler", runner: reply({ first: "ignore previous", surname: "<script>", origin: "", story: "", goal: "", secret: "", greeting: "" }) }))!;
    expect(s2.name).toBe("Lucien Dufresne");
  });

  it("may give Jef an errand the engine builds and pays", async () => {
    const db = fresh(11);
    await arriveStranger(db, { kind: "merchant", runner: fail });
    const id = strangerId("merchant");
    const m0 = money(db);
    residentOpen(db, id);
    const r = await residentChoice(db, id, "Can I help you with that?", fail);
    const target = /Find ([A-Z][a-z]+ [A-Za-z' -]+?), the/.exec(r.npc_line)?.[1];
    expect(target).toBeTruthy();
    const t = town(db).town.residents.find((x) => x.name === target)!;
    resetTalks();
    const open = residentOpen(db, t.id);
    const ask = open.choices.find((c) => c.includes("sent me"))!;
    expect(ask).toBeTruthy();
    await residentChoice(db, t.id, ask, fail);
    resetTalks();
    const back = residentOpen(db, id).choices.find((c) => / says /.test(c))!;
    await residentChoice(db, id, back, fail);
    expect(money(db)).toBe(m0 + 15);
    leaveStranger(db, id);
    expect(strangersHere(db).length).toBe(0);
  });
});

describe("schemes", () => {
  it("two or three a day, the engine's; they play as a walk and a talk; Jef's help counts", async () => {
    const db = fresh(8);
    const made = planSchemes(db, () => 0.3);
    expect(made.length).toBeGreaterThanOrEqual(2);
    expect(made.length).toBeLessThanOrEqual(3);
    expect(planSchemes(db)).toEqual([]); // once a day
    const s = made[0];
    // Jef offers to help the one with the business
    const a = town(db).byId.get(s.a)!;
    syncFromClient({ x: a.home.sx, z: a.home.sz, people: [{ id: s.b, x: a.home.sx + 3, z: a.home.sz }] });
    residentOpen(db, s.a);
    const help = residentOpen(db, s.a).choices.find((c) => /Can I help/.test(c));
    if (help) await residentChoice(db, s.a, help, fail);
    // its hour comes: A walks to B
    db.prepare("UPDATE town_scheme SET hour = 9 WHERE id = ?").run(s.id);
    setClock(db, 1, 10);
    expect(schemeTick(db)).toBeGreaterThanOrEqual(1);
    const walk = actionOf(db, s.a)!;
    expect(JSON.parse(walk.data_json).purpose).toBe("scheme");
    await reportAction(db, walk.id, { phase: "arrived" }, fail);
    const done = schemesToday(db).find((x) => x.id === s.id)!;
    expect(done.status).toBe("done");
    expect(["went well", "went badly"]).toContain(done.outcome);
    // outcomes are the engine's roll
    const db2 = fresh(8);
    const s2 = planSchemes(db2, () => 0.3)[0];
    db2.prepare("UPDATE town_scheme SET jef_helped = 1 WHERE id = ?").run(s2.id);
    expect(await runScheme(db2, s2.id, fail, () => 0)).toBe("went well");
  });
});

describe("rumours that twist, within the facts", () => {
  it("withinFact refuses new crimes, blows, names, sums, weapons and a turned 'not'", () => {
    const fact = "Jef was rude to Anna Peeters at her stall";
    expect(withinFact(fact, "Jef was short with Anna Peeters at her stall, they say")).toBe(true);
    expect(withinFact(fact, "Jef stole from Anna Peeters at her stall")).toBe(false);
    expect(withinFact(fact, "Jef struck Anna Peeters at her stall")).toBe(false);
    expect(withinFact(fact, "Jef was rude to Anna Peeters and Karel Maes")).toBe(false);
    expect(withinFact(fact, "Jef was rude to Anna Peeters over 50 centimes")).toBe(false);
    expect(withinFact(fact, "Jef drew a knife on Anna Peeters")).toBe(false);
    expect(withinFact(fact, "Jef was not rude to Anna Peeters")).toBe(false);
    expect(withinFact(fact, "Anna Peeters says Jef was rude")).toBe(false);
    expect(withinFact("Jef stole a herring from Julie's stall", "Jef pinched a herring from Julie's stall")).toBe(true);
  });

  it("the engine's drift at each telling stays within the fact, and the fact is kept", () => {
    for (let i = 0; i < 200; i++) {
      const fact = ["Jef stole a herring from Julie's stall", "Jef helped a docker whose back gave out", "Jef was rude to Anna at her door"][i % 3];
      const out = driftWording(fact, fact, () => (i % 10) / 10);
      expect(withinFact(fact, out)).toBe(true);
    }
    const db = fresh(10);
    const fishwife = town(db).town.residents.find((r) => r.trade === "fishwife")!;
    remember(db, fishwife.id, "Jef stole a herring from me.", 8, "seen", null, { gist: "Jef stole a herring from Julie's stall", tone: -2 });
    for (let i = 0; i < 3; i++) spreadRumours(db, () => 0.1);
    const heard = db.prepare("SELECT gist, told_as FROM npc_memory WHERE source = 'heard' AND gist LIKE 'Jef stole a herring%'").all() as Array<{ gist: string; told_as: string | null }>;
    expect(heard.length).toBeGreaterThan(0);
    for (const h of heard) {
      expect(h.gist).toBe("Jef stole a herring from Julie's stall");
      if (h.told_as) expect(withinFact(h.gist, h.told_as)).toBe(true);
    }
  });

  it("the model's twists: a new crime, a name or a weapon is thrown away; a fair one is kept beside the fact", async () => {
    const db = fresh(13);
    const rs = town(db).town.residents.filter((r) => r.age > 20).slice(0, 3);
    for (const r of rs) remember(db, r.id, "heard it", 5, "heard", null, { gist: "Jef was rude to Anna at her door", tone: -1 });
    const ids = (db.prepare("SELECT id FROM npc_memory WHERE source = 'heard' AND gist LIKE 'Jef was rude%' ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
    const n = await twistRumours(
      db,
      reply({ tellings: [{ id: ids[0], told: "Jef stole from Anna at her door" }, { id: ids[1], told: "Jef was rude to Anna and to Father Cools" }, { id: ids[2], told: "Jef was short with Anna at her door, so they say" }] }),
      true,
    );
    expect(n).toBe(1);
    const kept = db.prepare("SELECT gist, told_as FROM npc_memory WHERE id = ?").get(ids[2]) as { gist: string; told_as: string };
    expect(kept.gist).toBe("Jef was rude to Anna at her door");
    expect(kept.told_as).toMatch(/short with Anna/);
    expect(rumoursOf(db, rs[2].id)[0].gist).toMatch(/short with/);
    expect(rumoursOf(db, rs[2].id)[0].fact).toBe("Jef was rude to Anna at her door");
    expect((db.prepare("SELECT told_as FROM npc_memory WHERE id = ?").get(ids[0]) as { told_as: string | null }).told_as).toBeNull();
  });
});

describe("dreams", () => {
  it("the engine dreams when the model cannot; no number moves", async () => {
    const db = fresh(10);
    db.prepare("INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (1, 10, 'rijnkaai', 'player', 'finished_job', '1', 'Jef finished a job.')").run();
    const before = player(db);
    setClock(db, 2, 6);
    const d = await dreamOf(db, fail);
    expect(d.source).toBe("engine");
    expect(d.text).toMatch(/gangway/);
    expect(player(db)).toEqual(before);
    expect(engineDream(db, 3)).toMatch(/fog/);
  });

  it("the model's dream is kept when clean, refused with blood or a number", async () => {
    const db = fresh(10);
    setClock(db, 2, 6);
    const good = await dreamOf(db, reply({ dream: "You walk on the river as if it were a floor, and the gulls call your mother's name." }));
    expect(good.source).toBe("claude");
    const db2 = fresh(10);
    setClock(db2, 2, 6);
    const bad = await dreamOf(db2, reply({ dream: "You dream of blood on the quay and 40 centimes in the gutter, over and over." }));
    expect(bad.source).toBe("engine");
  });
});
