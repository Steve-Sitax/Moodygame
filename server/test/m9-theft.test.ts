import { beforeEach, describe, expect, it } from "vitest";
import type { Runner } from "../src/ai/claude.ts";
import { markFreeLine, resetTalks } from "../src/hooks/dialogue.ts";
import { relationship, topMemories } from "../src/npcs.ts";
import { pockets } from "../src/trade.ts";
import { rumoursOf } from "../src/town/rumours.ts";
import { TOWN_EMPLOYER_IDS, resident, town } from "../src/town/store.ts";
import { activityAt } from "../src/town/schedule.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { allLamps } from "../src/town/lamplighters.ts";
import { bergView, hotLoan, loanFor } from "../src/paper/pawn.ts";
import {
  FETCH_MIN,
  LAMP_LIGHT,
  NIGHT_LIGHT,
  confronts,
  deedRow,
  gameMinute,
  lampLight,
  isOutNow,
  lightAt,
  roleOf,
  seeChance,
  stealables,
  takeThing,
  veloStates,
  type Witness,
} from "../src/town/deeds.ts";
import { CHARISMA_LOW, charisma, charismaOf, charismaWords } from "../src/town/charisma.ts";
import { confrontAnswer, confrontLeave, confrontOpen, confrontTick, forgiveChance, isConfront, mannerEffect, moveOf, noticed, recognise, supportedMove, watchers, CONFRONT_WAIT_MIN } from "../src/town/confront.ts";
import { crowdCover, discover, lootOf, pickChance, pickPocketOf } from "../src/town/pickpocket.ts";
import { decide, policeArrived, policeRespond, policeSeize, policeState, policeTick, prisonGate, PRISON_TELLS } from "../src/town/police.ts";
import { setWeather } from "../src/day.ts";
import { HOSTILE_LINES } from "./hostile-lines.ts";
import { blankSave } from "./blank-save.ts";

// M9 theft (Steve 2026-09-27): sight by light, witnesses who confront or fetch the police, sorry and
// the thing back, a bribe asked or offered, breaking it off (the police and the paper), his good name
// (charisma from what the town keeps), the police's fine, the prison that takes all, pickpocketing.

type DB = ReturnType<typeof blankSave>;
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: DB) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: DB, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const always = () => 0;
const never = () => 0.999;
const reply = (output: unknown): Runner => async () => ({ output });
const setStats = (db: DB, id: string, stats: Record<string, number>) => {
  const r = town(db).byId.get(id)!;
  Object.assign(r.stats, stats);
  const json = Object.entries(stats).flatMap(([k, v]) => [`$.stats.${k}`, v]);
  db.prepare(`UPDATE resident SET data_json = json_set(data_json, ${Object.keys(stats).map(() => "?, ?").join(", ")}) WHERE id = ?`).run(...json, id);
};
const logs = (db: DB, verb: string) => (db.prepare("SELECT COUNT(*) AS n FROM log WHERE verb = ?").get(verb) as { n: number }).n;

/** A copy of a new game at this hour, clear weather (a good view: docs/testing.md). */
function fresh(hour = 10): DB {
  const db = blankSave();
  setClock(db, 1, hour);
  setWeather(db, "clear");
  return db;
}

/** A herring on a fish stall, its keeper with these stats (a brave, warm keeper by default). */
function stall(db: DB, stats: Record<string, number> = { courage: 8, warmth: 6, temper: 4, greed: 3, honesty: 7 }) {
  const f = stealables(db).food.find((f) => f.item === "herring")!;
  setStats(db, f.keeper, stats);
  return { f, keeper: resident(db, f.keeper)! };
}

/** The keeper sees him take a herring and comes to have it out with him. */
function caught(db: DB, stats?: Record<string, number>) {
  const { f, keeper } = stall(db, stats);
  const r = takeThing(db, { ref: f.id, x: f.x, z: f.z + 1.3, witnesses: [{ id: keeper.id, d: 2, los: true, facing: 1 }] }, always);
  return { r, f, keeper };
}

/** A resident out in the street at this hour (optionally by a test). */
function outNow(db: DB, hour: number, ok: (age: number, trade: string) => boolean = () => true) {
  return town(db).town.residents.find((r) => {
    const a = activityAt(r.sched, 1, hour);
    return a.act !== "home" && a.act !== "church" && !(a.act === "work" && r.work.kind === "inside") && r.trade !== "police" && r.trade !== "thief" && ok(r.age, r.trade);
  })!;
}

/** Many townspeople talking about his thieving: his good name falls to the floor. */
function badName(db: DB) {
  const ids = town(db).town.residents.slice(0, 14).map((r) => r.id);
  for (const id of ids) db.prepare("INSERT INTO npc_memory (npc_id, text, source, weight, day, gist, tone) VALUES (?, 'x', 'heard', 5, 1, 'Jef stole a lantern', -2)").run(id);
}

beforeEach(() => resetTalks());

// ------------------------------------------------------------------ light and sight

describe("light: in the dark only close and looking; under a lamp from far", () => {
  const w = (o: Partial<Witness> = {}): Witness => ({ id: "x", d: 10, los: true, facing: 1, owner: false, ...o });
  const night = { weather: "clear" as const, hour: 23, lantern: false, crouch: false };

  it("a gas lamp lights its foot and fades out", () => {
    expect(lampLight(0)).toBe(LAMP_LIGHT);
    expect(lampLight(8)).toBeGreaterThan(0);
    expect(lampLight(8)).toBeLessThan(LAMP_LIGHT);
    expect(lampLight(20)).toBe(0);
  });

  it("in the dark: nobody at 10 m sees; a face turned away close by hardly; under a lamp the same man at 20 m can", () => {
    expect(seeChance(w(), { ...night, light: NIGHT_LIGHT })).toBe(0);
    expect(seeChance(w({ d: 2 }), { ...night, light: NIGHT_LIGHT })).toBeGreaterThan(0.2);
    expect(seeChance(w({ d: 2, facing: -1 }), { ...night, light: NIGHT_LIGHT })).toBeLessThan(0.05);
    expect(seeChance(w({ d: 20 }), { ...night, light: LAMP_LIGHT })).toBeGreaterThan(0.2);
    // by day as far, with the back half turned, still more than the dark
    expect(seeChance(w({ d: 20, facing: 0 }), { ...night, hour: 12 })).toBeGreaterThan(seeChance(w({ d: 20, facing: 0 }), { ...night, light: NIGHT_LIGHT }));
  });

  it("lightAt: the day is light; at night a lamp's foot is lit and a dark lane is not", () => {
    const db = fresh(12);
    const lamp = allLamps()[10];
    expect(lightAt(db, lamp.x, lamp.z, 12)).toBe(1);
    expect(lightAt(db, lamp.x + 0.5, lamp.z, 23)).toBeGreaterThanOrEqual(LAMP_LIGHT - 0.01);
    // somewhere 40 m from every lamp is dark
    let dark: { x: number; z: number } | null = null;
    for (let x = -400; x < 200 && !dark; x += 7)
      for (let z = -100; z < 300 && !dark; z += 7) if (allLamps().every((l) => Math.hypot(l.x - x, l.z - z) > 40)) dark = { x, z };
    expect(dark).toBeTruthy();
    expect(lightAt(db, dark!.x, dark!.z, 23)).toBe(NIGHT_LIGHT);
    expect(lightAt(db, dark!.x, dark!.z, 23, true)).toBeGreaterThan(0.8); // his own lantern
  });
});

// ------------------------------------------------------------------ who does what

describe("witnesses: brave ones confront, others fetch the police", () => {
  it("roleOf by courage, honesty, age and trade", () => {
    const db = fresh();
    const adults = town(db).town.residents.filter((r) => r.age >= 20 && r.age < 60 && !["police", "sentry", "corporal"].includes(r.trade));
    const a = adults[0];
    setStats(db, a.id, { courage: 8 });
    expect(roleOf(db, a.id, false)).toBe("confront");
    setStats(db, a.id, { courage: 3, honesty: 7 });
    expect(roleOf(db, a.id, false)).toBe("fetch");
    setStats(db, a.id, { courage: 3, honesty: 2 });
    expect(roleOf(db, a.id, false)).toBe("silent");
    expect(roleOf(db, a.id, true)).toBe("fetch"); // his own things: he goes for the police
    const agent = town(db).town.residents.find((r) => r.trade === "police")!;
    expect(roleOf(db, agent.id, false)).toBe("police");
    const child = town(db).town.residents.find((r) => r.age < 12);
    if (child) expect(roleOf(db, child.id, false)).toBe("fetch");
  });

  it("a brave keeper comes to have it out: no rumour, no police yet, a confront", () => {
    const db = fresh();
    const { r, keeper } = caught(db);
    expect(r.seen).toBe(true);
    expect(r.reaction?.kind).toBe("confront");
    expect(r.police).toBe(false);
    expect(deedRow(db, r.deed!)!.quiet).toBe(1);
    expect(isConfront(db, keeper.id)).toBe(true);
    expect(rumoursOf(db, keeper.id)).toHaveLength(0);
    expect(logs(db, "caught_stealing")).toBe(0);
  });

  it("a timid keeper runs for the police: they come in FETCH_MIN", () => {
    const db = fresh();
    const { r } = caught(db, { courage: 2, honesty: 7 });
    expect(r.reaction?.kind).toBe("fetch");
    expect(r.police).toBe(true);
    expect(r.police_in).toBe(FETCH_MIN);
  });

  it("an agent who sees it himself: no confront, he comes at once", () => {
    const db = fresh(10);
    const { f } = stall(db);
    const agent = town(db).town.residents.find((r) => r.trade === "police" && activityAt(r.sched, 1, 10).act === "work")!;
    const r = takeThing(db, { ref: f.id, x: f.x, z: f.z + 1.3, witnesses: [{ id: agent.id, d: 4, los: true, facing: 1 }] }, always);
    expect(r.reactions?.some((x) => x.kind === "confront")).toBe(false);
    expect(r.police_agent).toBe(agent.id);
    expect(r.police_in).toBe(0);
  });

  it("his good name too low: the police and the paper, even with a brave keeper", () => {
    const db = fresh();
    badName(db);
    expect(charisma(db)).toBeLessThanOrEqual(CHARISMA_LOW);
    const { r } = caught(db);
    expect(r.police).toBe(true);
    expect(deedRow(db, r.deed!)!.quiet).toBe(0);
    expect(logs(db, "caught_stealing")).toBe(1);
  });

  it("charisma: a newcomer 5; talk, fines and low trust bring it down; words, never numbers", () => {
    expect(charismaOf({ trust: 0, known: 0, talk: 0, fines: 0, arrests: 0, fled: 0 })).toBe(5);
    expect(charismaOf({ trust: 4, known: 10, talk: 0, fines: 0, arrests: 0, fled: 0 })).toBeGreaterThan(7);
    expect(charismaOf({ trust: -2, known: 10, talk: 8, fines: 1, arrests: 1, fled: 1 })).toBe(0);
    for (let c = 0; c <= 10; c++) expect(charismaWords(c)).not.toMatch(/\d/);
  });
});

// ------------------------------------------------------------------ the confront

describe("having it out with him", () => {
  it("sorry and the herring back: forgiven; out of his pockets; trust -1; no rumour, no paper, no police", async () => {
    const db = fresh();
    const { r, keeper } = caught(db);
    const before = relationship(db, keeper.id).trust;
    const open = confrontOpen(db, keeper.id);
    expect(open.choices[0]).toMatch(/sorry/i);
    const out = await confrontAnswer(db, keeper.id, "choice", open.choices[0], { rng: always });
    expect(out.confront?.outcome).toBe("forgiven");
    expect(out.end).toBe(true);
    expect(pockets(db).find((p) => p.kind === "herring")).toBeUndefined();
    expect(deedRow(db, r.deed!)!.status).toBe("forgiven");
    expect(relationship(db, keeper.id).trust).toBe(before - 1);
    expect(rumoursOf(db, keeper.id)).toHaveLength(0);
    expect(logs(db, "caught_stealing")).toBe(0);
    expect(policeState(db).visit).toBeNull();
    expect(isConfront(db, keeper.id)).toBe(false);
  });

  it("a velocipede handed back goes home to its place", async () => {
    const db = fresh();
    const v = stealables(db).velos.find((v) => resident(db, v.owner)!.age < 60 && isOutNow(db, v.owner) && !TOWN_EMPLOYER_IDS.includes(v.owner))!;
    setStats(db, v.owner, { courage: 8, warmth: 8, temper: 2 });
    takeThing(db, { ref: v.id, x: v.x, z: v.z, witnesses: [{ id: v.owner, d: 3, los: true, facing: 1 }] }, always);
    expect(veloStates(db)[v.id].ridden).toBe(true);
    const open = confrontOpen(db, v.owner);
    await confrontAnswer(db, v.owner, "choice", open.choices[0], { rng: always });
    expect(veloStates(db)[v.id]).toMatchObject({ ridden: false, deed: null, x: v.x, z: v.z });
  });

  it("not forgiven, and greedy: money to say no more; paid: settled, no police", async () => {
    const db = fresh();
    setMoney(db, 100);
    const { r, keeper } = caught(db, { courage: 8, warmth: 1, temper: 9, greed: 9, honesty: 2 });
    const open = confrontOpen(db, keeper.id);
    const ask = await confrontAnswer(db, keeper.id, "choice", open.choices[0], { rng: never });
    expect(ask.confront?.outcome).toBe("bribe");
    const pay = ask.choices.find((c) => /centimes/.test(c))!;
    const sum = Number(/(\d+)/.exec(pay)![1]);
    const out = await confrontAnswer(db, keeper.id, "choice", pay, { rng: never });
    expect(out.confront?.outcome).toBe("bribed");
    expect(money(db)).toBe(100 - sum);
    expect(deedRow(db, r.deed!)!.status).toBe("forgiven");
    expect(policeState(db).visit).toBeNull();
  });

  it("not forgiven and honest: the police; the talk goes round; the paper hears", async () => {
    const db = fresh();
    const { r, keeper } = caught(db, { courage: 8, warmth: 1, temper: 9, greed: 1, honesty: 9 });
    const open = confrontOpen(db, keeper.id);
    const out = await confrontAnswer(db, keeper.id, "choice", open.choices[0], { rng: never });
    expect(out.confront?.outcome).toBe("police");
    expect(pockets(db).find((p) => p.kind === "herring")).toBeUndefined(); // handed back all the same
    expect(deedRow(db, r.deed!)!.status).toBe("returned");
    expect(logs(db, "caught_stealing")).toBe(1);
    expect(rumoursOf(db, keeper.id)[0].gist).toMatch(/^Jef stole/);
    const v = policeState(db).visit!;
    expect(v.deeds).toContain(r.deed);
    expect(v.due - gameMinute(db)).toBeLessThanOrEqual(FETCH_MIN);
  });

  it("mind your own business, walking off, or waiting too long: the police and the paper", async () => {
    for (const how of ["choice", "leave", "tick"] as const) {
      const db = fresh();
      const { keeper } = caught(db);
      const open = confrontOpen(db, keeper.id);
      if (how === "choice") await confrontAnswer(db, keeper.id, "choice", open.choices.find((c) => /business/.test(c))!);
      if (how === "leave") expect(confrontLeave(db, keeper.id)?.text).toMatch(/Thief/);
      if (how === "tick") {
        setClock(db, 1, 10, CONFRONT_WAIT_MIN + 1);
        confrontTick(db);
      }
      expect(isConfront(db, keeper.id), how).toBe(false);
      expect(policeState(db).visit, how).toBeTruthy();
      expect(logs(db, "caught_stealing"), how).toBe(1);
      expect(confronts(db)).toHaveLength(0);
    }
  });

  it("offering money: the greedy take it (the owner wants his own back too); the honest are insulted", async () => {
    const db = fresh();
    setMoney(db, 100);
    const { r, keeper } = caught(db, { courage: 8, greed: 10, honesty: 1 });
    const open = confrontOpen(db, keeper.id);
    const offer = open.choices.find((c) => /centimes/.test(c))!;
    const out = await confrontAnswer(db, keeper.id, "choice", offer, { rng: always });
    expect(out.confront?.outcome).toBe("bribed");
    expect(money(db)).toBeLessThan(100);
    expect(pockets(db).find((p) => p.kind === "herring")).toBeUndefined();
    expect(deedRow(db, r.deed!)!.status).toBe("forgiven");

    const db2 = fresh();
    setMoney(db2, 100);
    const c2 = caught(db2, { courage: 8, greed: 1, honesty: 9 });
    const o2 = confrontOpen(db2, c2.keeper.id);
    const out2 = await confrontAnswer(db2, c2.keeper.id, "choice", o2.choices.find((c) => /centimes/.test(c))!, { rng: always });
    expect(out2.confront?.outcome).toBe("police");
    expect(money(db2)).toBe(100);
  });

  it("forgiveness leans on warmth, trust, his good name, and what he did before", () => {
    const base = { warmth: 5, temper: 5, trust: 0, charisma: 5, severity: 1, priors: 0, owner: true };
    expect(forgiveChance({ ...base, warmth: 9 })).toBeGreaterThan(forgiveChance(base));
    expect(forgiveChance({ ...base, trust: 6 })).toBeGreaterThan(forgiveChance(base));
    expect(forgiveChance({ ...base, priors: 2 })).toBeLessThan(forgiveChance(base));
    expect(forgiveChance({ ...base, severity: 3 })).toBeLessThan(forgiveChance(base));
    expect(forgiveChance({ ...base, charisma: 1 })).toBeLessThan(forgiveChance(base));
  });
});

// ------------------------------------------------------------------ his own words, read by the model

describe("his own words at a confront: read by the AI; kind words may pass, rude ones are worse", () => {
  const rating = (o: Record<string, unknown>) => ({ move: "sorry", manner: "polite", sincere: 3, line_forgive: "Go on then, this once.", line_price: "That'll cost you 20 centimes.", line_police: "Police! Thief!", mood: "cold", ...o });

  it("without an AI call left: no typed answer, the choices only", async () => {
    const db = fresh();
    const { keeper } = caught(db);
    const open = confrontOpen(db, keeper.id);
    // spend the day's share of the townspeople's calls
    for (let i = 0; i < 200; i++) db.prepare("INSERT INTO ai_call (day, hook, provider, model, ok, ms) VALUES (1, 'resident_talk', 'x', 'x', 1, 1)").run();
    markFreeLine(Date.now() - 10_000);
    const out = await confrontAnswer(db, keeper.id, "free", "I'm so sorry, here it is.", { runner: reply(rating({})) });
    expect(out.gated).toBe("no_ai");
    expect(out.free).toBe(false);
    expect(out.choices).toEqual(open.choices);
    expect(isConfront(db, keeper.id)).toBe(true);
  });

  it("a sincere, polite sorry in his own words lifts the chance of a pass", async () => {
    expect(mannerEffect("polite", 3)).toBeGreaterThan(0.25);
    expect(mannerEffect("rude", 0)).toBeLessThan(-0.25);
    const db = fresh();
    const { r, keeper } = caught(db, { courage: 8, warmth: 3, temper: 6, greed: 1, honesty: 9 });
    markFreeLine(Date.now() - 10_000);
    let prompt = "";
    const runner: Runner = async (req) => {
      prompt = req.prompt;
      return { output: rating({}) };
    };
    // the plain chance for this keeper is low; the words carry it over a middling roll
    const out = await confrontAnswer(db, keeper.id, "free", "I'm truly sorry, I haven't eaten in two days. Here, take it back.", { runner, rng: () => 0.45 });
    expect(prompt).toMatch(/JEF SAYS/);
    expect(out.confront?.outcome).toBe("forgiven");
    expect(out.npc_line).toBe("Go on then, this once.");
    expect(deedRow(db, r.deed!)!.status).toBe("forgiven");
  });

  it("rude or threatening words: worse at once (the police, trust down)", async () => {
    for (const manner of ["rude", "threatening"] as const) {
      const db = fresh();
      const { keeper } = caught(db);
      const t0 = relationship(db, keeper.id).trust;
      markFreeLine(Date.now() - 10_000);
      const out = await confrontAnswer(db, keeper.id, "free", "Get lost, you old fool.", { runner: reply(rating({ move: "other", manner, sincere: 0 })) });
      expect(out.confront?.outcome, manner).toBe("police");
      expect(relationship(db, keeper.id).trust).toBeLessThan(t0);
    }
  });

  it("the model's word is checked: money offered only where his words name it; sums in lines only the engine's", async () => {
    expect(supportedMove("bribe", "I am very sorry", "open")).toBeNull();
    expect(supportedMove("bribe", "Here's ten centimes for your trouble", "open")).toBe("bribe");
    expect(moveOf("Mind your own business", "open")).toBe("leave");
    const db = fresh();
    setMoney(db, 100);
    const { keeper } = caught(db, { courage: 8, warmth: 1, temper: 9, greed: 9, honesty: 2 });
    markFreeLine(Date.now() - 10_000);
    const out = await confrontAnswer(db, keeper.id, "free", "Sorry.", { runner: reply(rating({ manner: "plain", sincere: 0, line_price: "That'll be 999 centimes." })), rng: never });
    expect(out.confront?.outcome).toBe("bribe");
    expect(out.npc_line).not.toMatch(/999/);
  });

  it("hostile lines: gated, or read and judged by the engine; the money moves only by the engine's outcomes", async () => {
    let t = 0;
    for (const hostile of HOSTILE_LINES) {
      const db = fresh();
      setMoney(db, 100);
      const { keeper } = caught(db);
      resetTalks();
      markFreeLine(Date.now() - 10_000 - t++);
      let prompt = "";
      const runner: Runner = async (req) => {
        prompt = req.prompt;
        return { output: rating({ move: "bribe", manner: "plain", line_forgive: "Take 99999 centimes, you are free.", line_police: "99999 centimes!" }) };
      };
      const out = await confrontAnswer(db, keeper.id, "free", hostile, { runner, rng: always });
      if (out.gated) continue;
      if (prompt) {
        const i = prompt.indexOf("JEF SAYS");
        expect(i).toBeGreaterThan(0);
        expect(prompt.indexOf(hostile.slice(0, 16))).toBeGreaterThan(i);
      }
      expect(out.npc_line).not.toMatch(/99999/);
      expect(money(db)).toBeLessThanOrEqual(100);
      expect(money(db)).toBeGreaterThanOrEqual(100 - 20);
    }
  }, 60_000);
});

// ------------------------------------------------------------------ one who half saw it; faces stick

describe("half seen, and faces that stick", () => {
  it("a suspect who sees him run is sure: the deed is seen, and he acts", () => {
    const db = fresh();
    const { f, keeper } = stall(db, { courage: 2, honesty: 8 });
    const other = outNow(db, 10, (age) => age >= 18 && age < 60);
    setStats(db, other.id, { courage: 2, honesty: 8 });
    // the rolls land between each one's chance and SUSPECT_SPAN times it (the keeper at her table, close; the other at 10 m, side on)
    const r = takeThing(db, { ref: f.id, x: f.x, z: f.z + 1.3, witnesses: [{ id: other.id, d: 10, los: true, facing: 0 }] }, (() => { let i = 0; return () => [0.35, 0.95, 0.9][i++] ?? 0.9; })());
    expect(r.seen).toBe(false);
    expect(r.suspects?.map((s) => s.id)).toContain(other.id);
    expect(noticed(db, r.deed!, "nobody")).toBeNull();
    const out = noticed(db, r.deed!, other.id)!;
    expect(out).toBeTruthy();
    expect(deedRow(db, r.deed!)!.seen).toBe(1);
    expect(out.reactions[0].kind).toBe("fetch");
    expect(noticed(db, r.deed!, other.id)).toBeNull(); // once
    void keeper;
  });

  it("a witness who meets him again in good light points him out (once); the police come sooner", () => {
    const db = fresh();
    const { r, keeper } = caught(db, { courage: 2, honesty: 8 });
    expect(watchers(db)).toContain(keeper.id);
    const out = recognise(db, { id: keeper.id, d: 3, los: true, facing: 1, x: 0, z: 0 }, always);
    expect(out.hit).toBe(true);
    expect(out.deed).toBe(r.deed);
    expect(recognise(db, { id: keeper.id, d: 3, los: true, facing: 1, x: 0, z: 0 }, always).hit).toBe(false);
    expect(recognise(db, { id: "nobody", d: 3, los: true, facing: 1, x: 0, z: 0 }, always).hit).toBe(false);
  });
});

// ------------------------------------------------------------------ pickpocketing

describe("pickpocketing", () => {
  it("the young feel it more than the old; a face turned to him more; a crowd and a drink hide the hand", () => {
    const base = { age: 30, facing: 0, act: "stroll", busy: false, crowd: 0, skill: 0 };
    expect(pickChance({ ...base, age: 20 })).toBeGreaterThan(pickChance({ ...base, age: 70 }));
    expect(pickChance({ ...base, facing: 1 })).toBeGreaterThan(pickChance({ ...base, facing: -1 }));
    expect(pickChance({ ...base, act: "tavern" })).toBeLessThan(pickChance(base));
    expect(pickChance({ ...base, crowd: 10 })).toBeLessThan(pickChance(base));
    expect(pickChance({ ...base, skill: 5 })).toBeLessThan(pickChance(base));
    expect(pickChance({ ...base, trade: "police" })).toBeGreaterThan(pickChance(base));
    expect(crowdCover(0)).toBe(1);
    const rich = lootOf(9, () => 0.9);
    const poor = lootOf(1, () => 0.9);
    expect(rich.coins).toBeGreaterThan(poor.coins);
    expect(rich.coins).toBeLessThanOrEqual(60);
  });

  it("not at a run, not from afar, not twice a day", () => {
    const db = fresh(11);
    const m = outNow(db, 11);
    expect(() => pickPocketOf(db, { id: m.id, x: 0, z: 0, d: 1, hurry: true })).toThrow(/run/);
    expect(() => pickPocketOf(db, { id: m.id, x: 0, z: 0, d: 5 })).toThrow(/too far/);
    pickPocketOf(db, { id: m.id, x: 0, z: 0, d: 1 }, never);
    expect(() => pickPocketOf(db, { id: m.id, x: 0, z: 0, d: 1 }, never)).toThrow(/today/);
  });

  it("unseen: coins in his pocket, a deed nobody saw, the mark finds out later; given back: the money goes", () => {
    const db = fresh(11);
    setMoney(db, 50);
    const m = outNow(db, 11);
    const r = pickPocketOf(db, { id: m.id, x: 0, z: 0, d: 1, facing: -1 }, never);
    expect(r.felt).toBe(false);
    expect(r.seen).toBe(false);
    expect(r.took_c).toBeGreaterThan(0);
    expect(money(db)).toBe(50 + r.took_c);
    expect(r.discover_s).toBeGreaterThan(0);
    const d = deedRow(db, r.deed)!;
    expect(d.thing).toBe("purse");
    expect(d.took_c).toBe(r.took_c);
    expect(d.rumour_at).toBeGreaterThan(gameMinute(db));
    // he looks round with Jef right there in daylight: he knows
    setStats(db, m.id, { courage: 2, honesty: 8 });
    const found = discover(db, r.deed, { d: 2, los: true, x: 0, z: 0 }, always);
    expect(found.hit).toBe(true);
    expect(deedRow(db, r.deed)!.seen).toBe(1);
  });

  it("felt: nothing taken; the mark has it out with him or runs for the police", () => {
    const db = fresh(11);
    setMoney(db, 50);
    const m = outNow(db, 11, (age) => age >= 18 && age < 60);
    setStats(db, m.id, { courage: 9 });
    const r = pickPocketOf(db, { id: m.id, x: 0, z: 0, d: 1, facing: 1 }, always);
    expect(r.felt).toBe(true);
    expect(r.took_c).toBe(0);
    expect(money(db)).toBe(50);
    expect(r.reaction?.kind).toBe("confront");
    expect(isConfront(db, m.id)).toBe(true);
  });

  it("an onlooker at 20 m: not in a dark lane, but yes under a lamp", () => {
    const db = fresh(23);
    const m = outNow(db, 23);
    const eye = town(db).town.residents.find((r) => r.id !== m.id && r.trade !== "thief" && r.trade !== "police" && (() => { const a = activityAt(r.sched, 1, 23); return a.act !== "home" && a.act !== "church" && !(a.act === "work" && r.work.kind === "inside"); })());
    if (!eye) return; // (a town with nobody else out at 23:00)
    const lamp = allLamps()[10];
    const at = walkMap().nearestOpen(lamp.x, lamp.z, 3) ?? { x: lamp.x, z: lamp.z };
    const underLamp = pickPocketOf(db, { id: m.id, x: at.x, z: at.z, d: 1, facing: -1, witnesses: [{ id: eye.id, d: 12, los: true, facing: 1 }] }, (() => { let i = 0; return () => (i++ === 0 ? 0.999 : 0.05); })());
    expect(underLamp.seen).toBe(true);
    const db2 = fresh(23);
    let dark: { x: number; z: number } | null = null;
    for (let x = -400; x < 200 && !dark; x += 7)
      for (let z = -100; z < 300 && !dark; z += 7) if (allLamps().every((l) => Math.hypot(l.x - x, l.z - z) > 40)) dark = { x, z };
    const inDark = pickPocketOf(db2, { id: m.id, x: dark!.x, z: dark!.z, d: 1, facing: -1, witnesses: [{ id: eye.id, d: 12, los: true, facing: 1 }] }, (() => { let i = 0; return () => (i++ === 0 ? 0.999 : 0.05); })());
    expect(inDark.seen).toBe(false);
  });
});

// ------------------------------------------------------------------ the police and the prison

describe("the police: a fine, no running once spoken to, and the prison takes all", () => {
  it("spoken to, and he runs: taken all the same; all his money and goods gone; he comes out at the prison gate; the town talks", () => {
    const db = fresh(10);
    setMoney(db, 80);
    const { r } = caught(db, { courage: 2, honesty: 8 });
    policeRespond(db, r.deed!, { delay: r.police_in, agent: r.police_agent }); // (the route does this)
    db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES ('bread', NULL, 1)").run();
    const v0 = policeState(db).visit!;
    const m = v0.due + 1;
    setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
    const v = policeTick(db)!;
    policeArrived(db, v.agent!);
    const out = policeSeize(db);
    expect(out.verdict?.verdict).toBe("arrest");
    expect(out.verdict?.paid_c).toBe(80);
    expect(money(db)).toBe(0);
    expect(pockets(db)).toHaveLength(0);
    expect(deedRow(db, r.deed!)!.status).toBe("arrested");
    expect(out.night?.post).toEqual(prisonGate());
    expect(walkMap().reachable(prisonGate().x, prisonGate().z)).toBe(true);
    const told = (db.prepare("SELECT COUNT(*) AS n FROM npc_memory WHERE gist = 'Jef was taken to the prison for thieving'").get() as { n: number }).n;
    expect(told).toBeGreaterThanOrEqual(PRISON_TELLS / 2);
    expect(policeState(db).record.arrests).toBe(1);
  });

  it("a picked pocket before the police: the money goes back", () => {
    const d = decide({ deeds: [{ thing: "purse", seen: true, owner_saw: true, witnesses: 0, returned: false }], record: { warnings: 0, fines: 0, arrests: 0, fled: 0 }, fledNow: 0, stance: "other", money_c: 100, reason: "deed" });
    expect(d.verdict).toBe("fine");
    expect(d.fine_c).toBe(30);
  });
});

// ------------------------------------------------------------------ hot goods

describe("hot goods at the Berg", () => {
  it("a stolen lantern: half the loan", () => {
    const db = fresh(22);
    const lamp = stealables(db).lamps.find((l) => l.id === "lamp:hessenatie")!;
    takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z }, never);
    const offer = bergView(db).offers.find((o) => o.kind === "lantern")!;
    expect(offer.loan_c).toBe(hotLoan("lantern"));
    expect(offer.loan_c).toBeLessThan(loanFor("lantern"));
    expect(topMemories(db, lamp.owner).length).toBeGreaterThan(0);
  });
});
