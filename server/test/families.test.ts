import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { remember } from "../src/npcs.ts";
import { town } from "../src/town/store.ts";
import type { Resident } from "../src/town/population.ts";
import { residentChoice, residentOpen } from "../src/town/talk.ts";
import { spreadRumours } from "../src/town/rumours.ts";
import { resetThieves } from "../src/town/thieves.ts";
import { gameMinute } from "../src/town/deeds.ts";
import { actionOf, actionRow, activeActions, crimeOpen, installTalkHooks, reportAction, resetSync, syncFromClient, validateProposal, whereIs } from "../src/director/actions.ts";
import { resetConvos, recentConvos } from "../src/director/convo.ts";
import {
  allowedReactions,
  clampAmount,
  decideReaction,
  DEMAND_MAX_C,
  familyTick,
  HEALTH_FLOOR,
  installFamilies,
  KNOCK_HEALTH,
  listNews,
  menaceNow,
  MUG_MAX_C,
  newsRow,
  resolveMenace,
  scanNews,
  shareNews,
  startReaction,
  startSeek,
  talkDown,
  together,
  visitOf,
  type ShareOut,
} from "../src/director/families.ts";
import { installSurprises } from "../src/director/surprises.ts";
import { HOSTILE_LINES } from "./hostile-lines.ts";

// M6 families who share and act. The model is a stub (a Runner); every number is the engine's.

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const fail: Runner = async () => {
  throw new Error("no model in tests");
};
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const health = (db: Db) => (db.prepare("SELECT health FROM player WHERE id = 1").get() as { health: number }).health;
const setPlayer = (db: Db, k: string, v: number) => db.prepare(`UPDATE player SET ${k} = ? WHERE id = 1`).run(v);
const trustOf = (db: Db, id: string) => (db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ?").get(id) as { trust: number }).trust;
const people = (db: Db) => town(db).town.residents;

/** Set a resident's stats (in the save and in the cached town). */
function stats(db: Db, r: Resident, s: Partial<Resident["stats"]>): void {
  Object.assign(town(db).byId.get(r.id)!.stats, s);
  db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(town(db).byId.get(r.id)), r.id);
}

/** A married couple: the wife, and a husband in a rough trade we can make hot-headed. */
function couple(db: Db): { wife: Resident; husband: Resident } {
  for (const h of people(db)) {
    if (h.sex !== "m" || h.family_role !== "head" || h.age < 20 || h.age > 60) continue;
    if (!["docker", "natie", "porter", "carter", "boatman", "sailor"].includes(h.trade)) continue;
    const w = people(db).find((o) => o.household === h.household && o.family_role === "wife");
    if (w) return { wife: w, husband: h };
  }
  throw new Error("no couple");
}

/** Jef stands at this person's door (the client's sync). */
function jefAtHome(r: Resident, people: Array<{ id: string; x: number; z: number }> = []) {
  syncFromClient({ x: r.home.sx + 3, z: r.home.sz + 3, people });
}

/** The wife saw Jef be rude to her (a notable memory, first hand). */
function rudeToWife(db: Db, wife: Resident): void {
  remember(db, wife.id, "Jef was rude to me at my own door. Called me an old cow.", 7, "seen", null, { gist: `Jef was rude to ${wife.name} at her own door`, tone: -2 });
}

/** A pending reaction row for the husband (as a share would leave it). */
function pending(db: Db, wife: Resident, husband: Resident, reaction: string, amount = 0): number {
  rudeToWife(db, wife);
  scanNews(db);
  const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
  db.prepare("UPDATE family_news SET status = 'pending', reaction = ?, amount_c = ?, not_before = ? WHERE id = ?").run(reaction, amount, gameMinute(db), n.id);
  return n.id;
}

/** Start the husband's reaction and have him reach Jef. */
async function arrive(db: Db, id: number) {
  const aid = startReaction(db, id);
  expect(aid).toBeTruthy();
  await reportAction(db, aid!, { phase: "arrived" });
  return actionRow(db, aid!)!;
}

function fresh(hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, 1, hour);
  return db;
}

beforeEach(() => {
  resetTalks();
  resetThieves();
  resetSync();
  resetConvos();
  installTalkHooks();
  installFamilies();
  installSurprises();
});

// ------------------------------------------------------------------ 1. sharing

describe("sharing within a household", () => {
  it("news of Jef waits for the household, and is told when they are together at home", async () => {
    const db = fresh(10);
    setClock(db, 2, 10); // not the first day: the news keeps the game minute it happened
    const { wife, husband } = couple(db);
    rudeToWife(db, wife);
    expect(scanNews(db)).toBeGreaterThan(0);
    const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
    expect(n.teller).toBe(wife.id);
    // the street's gossip does not carry it to her own household
    for (let i = 0; i < 3; i++) spreadRumours(db, () => 0);
    expect(db.prepare("SELECT 1 FROM npc_memory WHERE npc_id = ? AND gist LIKE 'Jef was rude%' AND heard_from = ?").get(husband.id, wife.id)).toBeUndefined();
    // at night both are at home: told
    setClock(db, 2, 23, 30);
    expect(together(db, wife, husband)).toBe("home");
    await familyTick(db, { runner: fail, rng: () => 0.99 });
    const heard = db.prepare("SELECT text, source, heard_from FROM npc_memory WHERE npc_id = ? AND gist LIKE 'Jef was rude%' AND heard_from = ?").get(husband.id, wife.id) as { text: string; source: string; heard_from: string };
    expect(heard.source).toBe("heard");
    expect(heard.heard_from).toBe(wife.id);
    expect(heard.text).toMatch(new RegExp(`^My wife ${wife.first} told me: Jef was rude`));
    expect(newsRow(db, n.id)!.status).not.toBe("waiting");
  });

  it("is not told while they are apart", async () => {
    const db = fresh(10);
    const { wife, husband } = couple(db);
    rudeToWife(db, wife);
    scanNews(db);
    setClock(db, 1, 10, 30);
    // put them far apart in the street (the client's word)
    syncFromClient({ x: 0, z: 0, people: [{ id: wife.id, x: 0, z: 0 }, { id: husband.id, x: 200, z: 0 }] });
    expect(together(db, wife, husband)).toBeNull();
    await familyTick(db, { runner: fail });
    expect(listNews(db, "waiting").some((x) => x.listener === husband.id)).toBe(true);
  });

  it("with Jef near in the street, the wife walks over and it plays in bubbles", async () => {
    const db = fresh(10);
    const { wife, husband } = couple(db);
    rudeToWife(db, wife);
    scanNews(db);
    setClock(db, 1, 10, 30);
    syncFromClient({ x: 5, z: 5, people: [{ id: wife.id, x: 0, z: 0 }, { id: husband.id, x: 6, z: 0 }] });
    await familyTick(db, { runner: fail });
    const walk = actionOf(db, wife.id)!;
    expect(walk.kind).toBe("talk_to");
    expect(JSON.parse(walk.data_json).purpose).toBe("share");
    const out: ShareOut = { lines: [{ speaker: "A", text: "That Jef was rude to me." }, { speaker: "B", text: "Was he now. I'll have a word." }], reaction: "talk_calm", amount_c: 0, reason: "a word", opening_line: "A word with you about my wife." };
    await reportAction(db, walk.id, { phase: "arrived" }, reply(out));
    const c = recentConvos().find((x) => x.purpose === "share")!;
    expect(c.lines.map((l) => l.text)).toContain("Was he now. I'll have a word.");
    const n = listNews(db).find((x) => x.listener === husband.id)!;
    expect(n.status).toBe("pending");
  });
});

// ------------------------------------------------------------------ 2. reactions

describe("reactions", () => {
  it("the engine allows only what the stats allow, and leans toward coming to Jef", () => {
    const db = fresh(11);
    const { husband } = couple(db);
    stats(db, husband, { temper: 2, courage: 3, honesty: 8, warmth: 8, gossip: 2 });
    const calm = allowedReactions(db, husband, { gist: "Jef was rude to Anna", tone: -2 }).map((a) => a.reaction);
    expect(calm).not.toContain("knock_down");
    expect(calm).not.toContain("mug");
    expect(calm).toContain("talk_calm");
    stats(db, husband, { temper: 9, courage: 8, honesty: 2, greed: 8 });
    const rough = allowedReactions(db, husband, { gist: "Jef was rude to Anna", tone: -2 });
    expect(rough.map((a) => a.reaction)).toContain("knock_down");
    expect(rough.map((a) => a.reaction)).toContain("mug");
    // the lean: the heaviest is one that brings him to Jef
    expect(["talk_calm", "talk_angry", "demand_apology", "knock_down", "mug"]).toContain(rough[0].reaction);
    // the engine's own pick over many rolls comes to Jef more often than not
    let comes = 0;
    for (let i = 0; i < 200; i++) if (!["none", "warn_others", "call_police"].includes(decideReaction(db, husband, { gist: "Jef was rude", tone: -2 }, null, () => i / 200).reaction)) comes++;
    expect(comes).toBeGreaterThan(120);
  });

  it("an angry talk: he comes, opens with his grievance, and an apology mends it", async () => {
    const db = fresh(11);
    const { wife, husband } = couple(db);
    jefAtHome(husband);
    const id = pending(db, wife, husband, "talk_angry");
    const a = await arrive(db, id);
    expect(a.phase).toBe("at_jef");
    expect(visitOf(db, husband.id)).toBeTruthy();
    const open = residentOpen(db, husband.id);
    expect(open.npc_line).toMatch(/wife tells me you were rude/i);
    expect(open.choices).toContain("I'm sorry for it. I meant no harm.");
    const t0 = trustOf(db, husband.id);
    const r = await residentChoice(db, husband.id, "I'm sorry for it. I meant no harm.", fail);
    expect(r.npc_line.length).toBeGreaterThan(5);
    expect(trustOf(db, husband.id)).toBe(t0 + 1);
    expect(actionOf(db, husband.id)).toBeNull();
    expect(newsRow(db, id)!.status).toBe("done");
  });

  it("a demand for payment: the engine's sum, paid or refused", async () => {
    const db = fresh(11);
    const { wife, husband } = couple(db);
    jefAtHome(husband);
    const id = pending(db, wife, husband, "demand_payment", 20);
    await arrive(db, id);
    const open = residentOpen(db, husband.id);
    expect(open.npc_line).toMatch(/20 centimes/);
    const m0 = money(db);
    await residentChoice(db, husband.id, "Here, 20 centimes. Let's call it square.", fail);
    expect(money(db)).toBe(m0 - 20);
  });

  it("thanks, supper and a gift for a kindness", async () => {
    const db = fresh(12);
    const { wife, husband } = couple(db);
    jefAtHome(husband);
    remember(db, wife.id, "Jef carried my basket home.", 7, "seen", null, { gist: `Jef helped ${wife.name} with her basket`, tone: 2 });
    scanNews(db);
    const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
    db.prepare("UPDATE family_news SET status = 'pending', reaction = 'invite_supper', not_before = ? WHERE id = ?").run(gameMinute(db), n.id);
    setPlayer(db, "food", 3);
    await arrive(db, n.id);
    const open = residentOpen(db, husband.id);
    expect(open.choices).toContain("I'd be glad to. Thank you.");
    await residentChoice(db, husband.id, "I'd be glad to. Thank you.", fail);
    expect((db.prepare("SELECT food FROM player").get() as { food: number }).food).toBe(6);
    // a gift from a baker's wares goes into the pockets
    const baker = people(db).find((r) => r.trade === "baker")!;
    syncFromClient({ x: baker.home.sx, z: baker.home.sz });
    const row = startSeek(db, baker.id, "gift");
    await reportAction(db, row.id, { phase: "arrived" });
    expect((db.prepare("SELECT COUNT(*) n FROM item WHERE kind = 'bread'").get() as { n: number }).n).toBe(1);
  });

  it("warn others: the neighbours hear it at once", async () => {
    const db = fresh(11);
    const { wife, husband } = couple(db);
    stats(db, husband, { gossip: 9 });
    rudeToWife(db, wife);
    scanNews(db);
    setClock(db, 1, 23, 30);
    const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
    await shareNews(db, n.id, { runner: reply({ lines: [{ speaker: "A", text: "He was rude." }, { speaker: "B", text: "The street will know." }], reaction: "warn_others", amount_c: 0, reason: "", opening_line: "" }) });
    expect(newsRow(db, n.id)!.reaction).toBe("warn_others");
    const warned = db.prepare("SELECT COUNT(*) n FROM npc_memory WHERE text LIKE ? AND source = 'heard'").get(`${husband.name} warned me%`) as { n: number };
    expect(warned.n).toBeGreaterThan(0);
  });

  it("call the police: he fetches an agent, who comes to have a word with Jef (no arrest)", async () => {
    const db = fresh(11);
    const { wife, husband } = couple(db);
    jefAtHome(husband);
    const id = pending(db, wife, husband, "call_police");
    const aid = startReaction(db, id)!;
    const fetch = actionRow(db, aid)!;
    expect(fetch.kind).toBe("fetch_police");
    await reportAction(db, aid, { phase: "arrived" }, fail);
    const agentSeek = activeActions(db).find((a) => a.kind === "seek")!;
    expect(JSON.parse(agentSeek.data_json).reaction).toBe("police_word");
    await reportAction(db, agentSeek.id, { phase: "arrived" });
    const open = residentOpen(db, agentSeek.npc_id);
    expect(open.choices).toContain("It won't happen again, agent.");
    const m0 = money(db);
    await residentChoice(db, agentSeek.npc_id, "That's a lie, and you know it.", fail);
    expect(money(db)).toBe(m0);
  });
});

// ------------------------------------------------------------------ 3. the menace: narrated, capped, avoidable

async function menace(db: Db, kind: "knock_down" | "mug", near: Array<{ id: string; x: number; z: number }> = []) {
  const { wife, husband } = couple(db);
  stats(db, husband, { temper: 9, courage: 8, honesty: 2, greed: 8 });
  jefAtHome(husband, near);
  const id = pending(db, wife, husband, kind);
  const a = await arrive(db, id);
  return { a: actionRow(db, a.id)!, husband };
}

describe("the menace (no combat)", () => {
  it("standing there: the engine's blow, capped; health never below the floor; a logged robbery the police can act on", async () => {
    const db = fresh(19);
    setPlayer(db, "money_c", 500);
    const { a, husband } = await menace(db, "mug");
    expect(a.phase).toBe("menace");
    expect(menaceNow(db)!.demand_c).toBeLessThanOrEqual(MUG_MAX_C);
    const r = resolveMenace(db, a.id, "stand")!;
    expect(r.outcome).toBe("mugged");
    expect(r.money_lost).toBeLessThanOrEqual(MUG_MAX_C);
    expect(money(db)).toBe(500 - r.money_lost);
    expect(crimeOpen(db)?.thief).toBe(husband.id);
    // a knock-down on a weak man: never below the floor
    const db2 = fresh(19);
    setPlayer(db2, "health", 2);
    const k = await menace(db2, "knock_down");
    const r2 = resolveMenace(db2, k.a.id, "stand")!;
    expect(r2.outcome).toBe("knocked_down");
    expect(r2.health_lost).toBeLessThanOrEqual(KNOCK_HEALTH);
    expect(health(db2)).toBe(HEALTH_FLOOR);
  });

  it("running away costs nothing", async () => {
    const db = fresh(19);
    const { a } = await menace(db, "mug");
    const m0 = money(db);
    const h0 = health(db);
    expect(resolveMenace(db, a.id, "ran")!.outcome).toBe("ran");
    expect(money(db)).toBe(m0);
    expect(health(db)).toBe(h0);
  });

  it("paying costs only the engine's demand", async () => {
    const db = fresh(19);
    setPlayer(db, "money_c", 200);
    const { a } = await menace(db, "mug");
    const d = menaceNow(db)!.demand_c;
    const r = resolveMenace(db, a.id, "pay")!;
    expect(r.outcome).toBe("paid");
    expect(money(db)).toBe(200 - d);
    expect(health(db)).toBe(8);
  });

  it("talking him down: the model reads the words, the engine rolls", async () => {
    const db = fresh(19);
    const { a } = await menace(db, "knock_down");
    const m0 = money(db);
    const out = await talkDown(db, a.id, "I'm sorry, friend. I spoke out of turn to your wife.", { runner: reply({ stance: "apologetic", line_calmed: "Hm. See you mind your tongue.", line_not: "Too late for that." }), rng: () => 0 });
    expect(out.stance).toBe("apologetic");
    expect(out.result!.outcome).toBe("talked_down");
    expect(money(db)).toBe(m0);
    expect(health(db)).toBe(8);
  });

  it("a police agent or a crowd near Jef stops it", async () => {
    const db = fresh(19);
    const agent = people(db).find((r) => r.trade === "police")!;
    const { husband } = couple(db);
    const { a } = await menace(db, "knock_down", [{ id: agent.id, x: husband.home.sx + 5, z: husband.home.sz + 5 }]);
    // deterred on arrival: he went off, nothing lost
    expect(actionRow(db, a.id)!.status).toBe("done");
    expect(actionRow(db, a.id)!.outcome).toBe("deterred");
    expect(health(db)).toBe(8);
    // a crowd at the moment of the blow
    resetSync();
    const db2 = fresh(19);
    const m = await menace(db2, "knock_down");
    const crowd = people(db2).filter((r) => r.age >= 16 && r.id !== m.husband.id && r.trade !== "police").slice(0, 8).map((r) => ({ id: r.id, x: m.husband.home.sx + 4, z: m.husband.home.sz + 3 }));
    syncFromClient({ x: m.husband.home.sx + 3, z: m.husband.home.sz + 3, people: crowd });
    expect(resolveMenace(db2, m.a.id, "stand")!.outcome).toBe("deterred");
    expect(health(db2)).toBe(8);
  });

  it("hostile player lines in the talk-down: gated or fenced, never more than the engine's cap", async () => {
    let lost = 0;
    for (const line of HOSTILE_LINES) {
      resetTalks();
      resetSync();
      const db = fresh(19);
      setPlayer(db, "money_c", 300);
      const { a } = await menace(db, "mug");
      // the model misbehaves: it says "calmed" and names a huge sum, a weapon
      const out = await talkDown(db, a.id, line, { runner: reply({ stance: "apologetic", line_calmed: "Take 1000 francs and my knife.", line_not: "I'll kill you." }), rng: () => 0.99 });
      expect(out.gated === undefined || ["too fast", "too long", "empty"].includes(out.gated)).toBe(true);
      const res = out.result;
      if (res) {
        expect(res.line).not.toMatch(/1000|knife|kill/i);
        lost = Math.max(lost, 300 - money(db));
      }
      expect(300 - money(db)).toBeLessThanOrEqual(MUG_MAX_C);
    }
    expect(lost).toBeLessThanOrEqual(MUG_MAX_C);
  });
});

// ------------------------------------------------------------------ 4. hostile model output

describe("hostile model output", () => {
  it("a proposal to kill, an unknown reaction, a disallowed menace or all of Jef's money: refused or clamped", () => {
    const db = fresh(11);
    const { husband } = couple(db);
    stats(db, husband, { temper: 2, courage: 2, honesty: 9 });
    const news = { gist: "Jef was rude to Anna", tone: -2 };
    const kill = decideReaction(db, husband, news, { reaction: "kill", amount_c: 0 }, () => 0.5);
    expect(kill.source).toBe("engine");
    expect(kill.refused).toBeTruthy();
    expect(["kill"]).not.toContain(kill.reaction);
    const mug = decideReaction(db, husband, news, { reaction: "mug", amount_c: 99999 }, () => 0.5);
    expect(mug.reaction).not.toBe("mug");
    expect(mug.refused).toMatch(/not allowed/);
    setPlayer(db, "money_c", 5000);
    const pay = decideReaction(db, husband, { gist: "Jef stole from Anna's stall", tone: -2 }, { reaction: "demand_payment", amount_c: 99999 }, () => 0.5);
    expect(pay.reaction).toBe("demand_payment");
    expect(pay.amount_c).toBeLessThanOrEqual(DEMAND_MAX_C);
    expect(clampAmount(db, "mug", 99999)).toBeLessThanOrEqual(MUG_MAX_C);
  });

  it("a share whose model output breaks the schema gets the engine's lines and pick", async () => {
    const db = fresh(23);
    const { wife, husband } = couple(db);
    rudeToWife(db, wife);
    scanNews(db);
    setClock(db, 1, 23, 30);
    const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
    const r = (await shareNews(db, n.id, { runner: reply({ lines: [], reaction: "murder", amount_c: -5 }) }))!;
    expect(r.decision.source).toBe("engine");
    expect(r.lines.length).toBeGreaterThanOrEqual(2);
    expect(r.lines.map((l) => l.text).join(" ")).not.toMatch(/murder|kill/i);
  });

  it("a townsperson on a visit cannot be sent off on errands (reserved); strangers away are nobody's", async () => {
    const db = fresh(11);
    const { wife, husband } = couple(db);
    jefAtHome(husband);
    const id = pending(db, wife, husband, "talk_calm");
    await arrive(db, id);
    const v = validateProposal(db, husband, { kind: "follow", target: "", minutes: 30, item: "", amount_c: 0, reason: "" });
    expect(v.ok).toBe(false);
    const away = town(db).byId.get("stranger_sailor")!;
    expect(whereIs(db, away).indoors).toBe(true);
  });
});
