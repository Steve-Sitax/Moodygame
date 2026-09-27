import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Runner } from "../src/ai/claude.ts";
import { openDb } from "../src/db.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { remember } from "../src/npcs.ts";
import { asPlayer, setOnlineIds } from "../src/player/current.ts";
import { ensurePlayerRow, pstate } from "../src/player/multi.ts";
import { town, dropTownCache } from "../src/town/store.ts";
import type { Resident } from "../src/town/population.ts";
import { residentChoice, residentOpen } from "../src/town/talk.ts";
import { resetThieves } from "../src/town/thieves.ts";
import { gameMinute } from "../src/town/deeds.ts";
import { strangerId } from "../src/town/visitors.ts";
import { actionRow, installTalkHooks, reportAction, resetSync, syncFromClient, whereIs } from "../src/director/actions.ts";
import { resetConvos } from "../src/director/convo.ts";
import { familyTick, installFamilies, listNews, menaceMine, menaceNow, resolveMenace, scanNews, SEEK_MAX_M, seekPins, startReaction, visitNow, visitOf } from "../src/director/families.ts";
import { arriveStranger, installSurprises, planSchemes, runScheme } from "../src/director/surprises.ts";
import { chainPlayers, fireForClient, joinChain, partOf, settledOf } from "../src/director/fire.ts";
import { hiringForClient, hiringIdle, setHiringRoll, setHiringRunner, standForHire } from "../src/director/hiring.ts";
import { eventRow, eventsTick, planEvent, type EventRow, type StoredStage } from "../src/director/scheduler.ts";
import { devRoutine } from "../src/director/steps.ts";
import { handPins } from "../src/town/hire.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";

// M8d "shared work", H2: the town's events reach each player. A guest's family news, visits and menaces are his, at
// his place; the errand of a stranger, the help in a scheme, a place in the bucket chain and at the hiring gate are
// each player's own; the host's go on as before.

type Db = ReturnType<typeof openDb>;
const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const fail: Runner = async () => {
  throw new Error("no model in tests");
};
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const toMin = (db: Db, m: number) => setClock(db, Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);
const money = (db: Db, id: number) => (db.prepare("SELECT money_c FROM player WHERE id = ?").get(id) as { money_c: number }).money_c;
const health = (db: Db, id: number) => (db.prepare("SELECT health FROM player WHERE id = ?").get(id) as { health: number }).health;
const stagesOf = (ev: EventRow) => JSON.parse(ev.stages_json) as StoredStage[];

function fresh(day = 1, hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  ensurePlayerRow(db, GUEST, "Wout");
  // street talk in the engine's words: no model is ever called here
  db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, 'npc_convo', 'claude', 'x', 1, 1)").run(day);
  return db;
}

function stats(db: Db, r: Resident, s: Partial<Resident["stats"]>): void {
  Object.assign(town(db).byId.get(r.id)!.stats, s);
  db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(town(db).byId.get(r.id)), r.id);
}

/** A married couple with a husband in a rough trade, near his own door at the test's hour (as families.test.ts). */
function couple(db: Db): { wife: Resident; husband: Resident } {
  for (const h of town(db).town.residents) {
    if (h.sex !== "m" || h.family_role !== "head" || h.age < 20 || h.age > 60) continue;
    if (!["docker", "natie", "porter", "carter", "boatman", "sailor"].includes(h.trade)) continue;
    const at = whereIs(db, h);
    if (Math.hypot(at.x - h.home.sx, at.z - h.home.sz) > SEEK_MAX_M - 60) continue;
    const w = town(db).town.residents.find((o) => o.household === h.household && o.family_role === "wife");
    if (w) return { wife: w, husband: h };
  }
  throw new Error("no couple");
}

/** The guest was rude to the wife: her memory is of him (kept with his name). */
const guestRude = (db: Db, wife: Resident) =>
  as2(() => remember(db, wife.id, "Jef was rude to me at my own door.", 7, "seen", null, { gist: `Jef was rude to ${wife.name} at her own door`, tone: -2 }));

/** The guest by the husband's door, the host far across the town (each his own place). */
function places(husband: Resident): void {
  as2(() => syncFromClient({ x: husband.home.sx + 3, z: husband.home.sz + 3 }));
  asPlayer(1, () => syncFromClient({ x: husband.home.sx > 0 ? husband.home.sx - 900 : husband.home.sx + 900, z: husband.home.sz }));
}

function pendingFor(db: Db, husband: Resident, reaction: string): number {
  const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
  db.prepare("UPDATE family_news SET status = 'pending', reaction = ?, not_before = ? WHERE id = ?").run(reaction, gameMinute(db), n.id);
  return n.id;
}

beforeEach(() => {
  resetTalks();
  resetThieves();
  resetSync();
  resetConvos();
  installTalkHooks();
  installFamilies();
  installSurprises();
  setOnlineIds(() => [1, GUEST]);
  setHiringRunner(fail);
});
afterEach(() => {
  setOnlineIds(null);
  setHiringRoll(null);
  setHiringRunner(undefined);
});

// ------------------------------------------------------------------ 1. family news, visits, menaces

describe("M8d family news of a guest", () => {
  it("is his: the news row names him, the gist is the engine's, the household hears it with his name", async () => {
    const db = fresh(2, 10);
    const { wife, husband } = couple(db);
    guestRude(db, wife);
    const mem = db.prepare("SELECT gist, about_player FROM npc_memory WHERE npc_id = ? ORDER BY id DESC LIMIT 1").get(wife.id) as { gist: string; about_player: number };
    expect(mem.gist).toMatch(/^Wout was rude/);
    expect(mem.about_player).toBe(GUEST);
    expect(scanNews(db)).toBeGreaterThan(0);
    const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
    expect(n.player_id).toBe(GUEST);
    expect(n.gist).toMatch(/^Jef was rude/);
    // told at home at night: the husband's memory names the guest, and is about him
    setClock(db, 2, 23, 30);
    await familyTick(db, { runner: fail, rng: () => 0.99 });
    const heard = db.prepare("SELECT text, gist, about_player FROM npc_memory WHERE npc_id = ? AND heard_from = ? ORDER BY id DESC LIMIT 1").get(husband.id, wife.id) as { text: string; gist: string; about_player: number };
    expect(heard.text).toMatch(/told me: Wout was rude/);
    expect(heard.text).not.toMatch(/\bJef\b/);
    expect(heard.gist).toMatch(/^Wout was rude/);
    expect(heard.about_player).toBe(GUEST);
  });

  it("the host's own news stays the host's (Jef, player 1)", () => {
    const db = fresh(2, 10);
    const { wife, husband } = couple(db);
    remember(db, wife.id, "Jef was rude to me.", 7, "seen", null, { gist: `Jef was rude to ${wife.name} at her own door`, tone: -2 });
    scanNews(db);
    const n = listNews(db, "waiting").find((x) => x.listener === husband.id)!;
    expect(n.player_id).toBe(1);
    expect(n.gist).toMatch(/^Jef was rude/);
  });

  it("a visit goes to the guest, at his place, and only he talks it through", async () => {
    const db = fresh(1, 11);
    const { wife, husband } = couple(db);
    places(husband);
    guestRude(db, wife);
    scanNews(db);
    const id = pendingFor(db, husband, "talk_angry");
    // started from the host's tick: it is the guest's (the host is far off and would never be sought)
    const aid = asPlayer(1, () => startReaction(db, id))!;
    expect(aid).toBeTruthy();
    const row = actionRow(db, aid)!;
    expect(row.for_player).toBe(GUEST);
    expect(JSON.parse(row.data_json).player).toBe(GUEST);
    // only the guest's PC walks him up (the pins)
    expect(seekPins(db, [1, GUEST]).get(husband.id)).toBe(GUEST);
    expect(seekPins(db, [1]).has(husband.id)).toBe(false);
    // the host's PC reports him there (the M8b owner of the street)
    await reportAction(db, aid, { phase: "arrived" });
    expect(actionRow(db, aid)!.phase).toBe("at_jef");
    expect(as2(() => visitNow(db))?.npc).toBe(husband.id);
    expect(visitNow(db)).toBeNull();
    expect(as2(() => visitOf(db, husband.id))).toBeTruthy();
    expect(visitOf(db, husband.id)).toBeNull();
    const open = as2(() => residentOpen(db, husband.id));
    expect(open.npc_line).toMatch(/rude/i);
    expect(open.choices).toContain("I'm sorry for it. I meant no harm.");
  });

  it("the news of the host far away waits: the guest near does not bring the host's visitor", () => {
    const db = fresh(1, 11);
    const { wife, husband } = couple(db);
    places(husband);
    remember(db, wife.id, "Jef was rude to me.", 7, "seen", null, { gist: `Jef was rude to ${wife.name} at her own door`, tone: -2 });
    scanNews(db);
    const id = pendingFor(db, husband, "talk_angry");
    expect(as2(() => startReaction(db, id))).toBeNull(); // the host is 900 m off
  });

  it("a menace stands before the guest: his health moves, the host's does not; only he may answer it", async () => {
    const db = fresh(1, 11);
    const { wife, husband } = couple(db);
    stats(db, husband, { temper: 9, courage: 8, honesty: 2, greed: 8 });
    places(husband);
    guestRude(db, wife);
    scanNews(db);
    const id = pendingFor(db, husband, "knock_down");
    const aid = startReaction(db, id)!;
    expect(aid).toBeTruthy();
    await reportAction(db, aid, { phase: "arrived" });
    expect(as2(() => menaceNow(db))?.npc).toBe(husband.id);
    expect(menaceNow(db)).toBeNull();
    expect(as2(() => menaceMine(db, aid))).toBe(true);
    expect(menaceMine(db, aid)).toBe(false);
    // the guest's menaces today are counted as his (player_state), not the host's
    expect(pstate<{ n: number }>(db, "menaces", GUEST)?.n).toBe(1);
    expect(pstate(db, "menaces", 1)).toBeNull();
    const h1 = health(db, 1);
    const h2 = health(db, GUEST);
    // the time runs out in the host's tick: resolved as the guest, who stood there
    const r = resolveMenace(db, aid, "stand")!;
    expect(r.outcome).toBe("knocked_down");
    expect(health(db, GUEST)).toBe(h2 - r.health_lost);
    expect(r.health_lost).toBeGreaterThan(0);
    expect(health(db, 1)).toBe(h1);
    const logged = db.prepare("SELECT text, player_id FROM log WHERE verb = 'assaulted' ORDER BY id DESC LIMIT 1").get() as { text: string; player_id: number };
    expect(logged.player_id).toBe(GUEST);
    expect(logged.text).toMatch(/knocked Wout down/);
  });
});

// ------------------------------------------------------------------ 2. the stranger's errand, the schemes

describe("M8d a stranger's errand and a scheme's help, each player's own", () => {
  it("two players may each run an errand for the same stranger", async () => {
    const db = fresh(1, 11);
    await arriveStranger(db, { kind: "merchant", runner: fail });
    const id = strangerId("merchant");
    as2(() => residentOpen(db, id));
    const g = await as2(() => residentChoice(db, id, "Can I help you with that?", fail));
    expect(g.npc_line).toMatch(/Find /);
    resetTalks();
    // the host still has the offer: the guest's errand is not his
    const open = residentOpen(db, id);
    expect(open.choices).toContain("Can I help you with that?");
    await residentChoice(db, id, "Can I help you with that?", fail);
    const e1 = pstate<{ stage: string }>(db, `errand:${id}`, 1);
    const e2 = pstate<{ stage: string }>(db, `errand:${id}`, GUEST);
    expect(e1?.stage).toBe("asked");
    expect(e2?.stage).toBe("asked");
  });

  it("the help in a scheme is the helper's: his trust and the memory of him", async () => {
    const db = fresh(1, 8);
    const s = planSchemes(db, () => 0.3)[0];
    db.prepare("UPDATE town_scheme SET jef_helped = ? WHERE id = ?").run(GUEST, s.id);
    const t = (id: number) => (db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ? AND player_id = ?").get(s.a, id) as { trust: number } | undefined)?.trust ?? 0;
    const t1 = t(1);
    const t2 = t(GUEST);
    expect(await runScheme(db, s.id, fail, () => 0)).toBe("went well");
    expect(t(GUEST)).toBe(t2 + 1);
    expect(t(1)).toBe(t1);
    const m = db.prepare("SELECT gist, about_player FROM npc_memory WHERE npc_id = ? ORDER BY id DESC LIMIT 1").get(s.a) as { gist: string; about_player: number };
    expect(m.about_player).toBe(GUEST);
    expect(m.gist).toMatch(/^Wout helped/);
  });
});

describe("M8d a hand and a guest go with the one who hired them", () => {
  it("each is pinned to his employer's PC; a player who is gone pins nobody", () => {
    const db = fresh(1, 11);
    const [a, b, c] = town(db).town.residents.filter((r) => r.age >= 20 && r.age <= 50 && !actionOfNpc(db, r.id)).slice(0, 3);
    as2(() => devRoutine(db, a.id, [{ kind: "wait", minutes: 60, label: "watching" }], "hire", 120, { task: "watch", player: GUEST }));
    devRoutine(db, b.id, [{ kind: "follow", who: "jef", label: "the tavern" }], "treat", 120, { player: 1 });
    as2(() => devRoutine(db, c.id, [{ kind: "wait", minutes: 60, label: "an errand" }], "test", 120));
    const pins = handPins(db, [1, GUEST]);
    expect(pins.get(a.id)).toBe(GUEST);
    expect(pins.get(b.id)).toBe(1);
    expect(pins.has(c.id)).toBe(false); // (not a hand nor a guest)
    expect(handPins(db, [1]).has(a.id)).toBe(false);
  });
});

const actionOfNpc = (db: Db, id: string) => db.prepare("SELECT 1 FROM npc_action WHERE status = 'active' AND npc_id = ?").get(id);

// ------------------------------------------------------------------ 3. the bucket chain, the hiring gate

function toStage(db: Db, id: number, i: number): EventRow {
  const ev = eventRow(db, id)!;
  const at = ev.start_m + stagesOf(ev).slice(0, i).reduce((a, s) => a + s.minutes, 0);
  toMin(db, at);
  eventsTick(db);
  eventsTick(db);
  return eventRow(db, id)!;
}

describe("M8d the bucket chain: each player's own place, time and pay", () => {
  it("two players in one chain are each paid as themselves", () => {
    const db = fresh(1, 10);
    const p = planEvent(db, planFromTemplate(templateById("house_fire")!, "engine", { start_in_min: 0 }), { dev: true });
    expect(p.ok).toBe(true);
    const id = (p as { event: EventRow }).event.id;
    let ev = toStage(db, id, 0);
    const f0 = stagesOf(ev)[0].fire!;
    for (const rid of f0.family) {
      const row = db.prepare("SELECT data_json FROM resident WHERE id = ?").get(rid) as { data_json: string };
      const r = JSON.parse(row.data_json);
      r.stats.wealth = 8;
      db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), rid);
    }
    dropTownCache(db);
    ev = toStage(db, id, 2);
    const f = stagesOf(ev)[0].fire!;
    const m1 = money(db, 1);
    const m2 = money(db, GUEST);
    expect(joinChain(db, f.chain[3][0], f.chain[3][1]).ok).toBe(true);
    // the guest at the same place: the host holds it; the next one is his
    const g = as2(() => joinChain(db, f.chain[3][0], f.chain[3][1]));
    expect(g.ok).toBe(true);
    expect(g.ok && g.slot).not.toBe(3);
    expect(as2(() => joinChain(db, f.chain[4][0], f.chain[4][1])).ok).toBe(false); // in already
    const mid = stagesOf(eventRow(db, id)!)[0].fire!;
    expect(chainPlayers(mid).sort()).toEqual([1, GUEST]);
    expect(as2(() => fireForClient(stagesOf(eventRow(db, id)!)))!.jef?.slot).toBe(partOf(mid, GUEST)!.slot);
    expect(fireForClient(stagesOf(eventRow(db, id)!))!.jef?.slot).toBe(3);
    ev = toStage(db, id, 3);
    const fe = stagesOf(ev)[0].fire!;
    const s1 = settledOf(fe, 1)!;
    const s2 = settledOf(fe, GUEST)!;
    expect(s1.paid_c).toBeGreaterThan(0);
    expect(s2.paid_c).toBeGreaterThan(0);
    expect(money(db, 1)).toBe(m1 + s1.paid_c);
    expect(money(db, GUEST)).toBe(m2 + s2.paid_c);
    const paid = db.prepare("SELECT player_id, text FROM log WHERE verb = 'fire_chain_paid' ORDER BY id").all() as Array<{ player_id: number; text: string }>;
    expect(paid.map((x) => x.player_id).sort()).toEqual([1, GUEST]);
    expect(paid.find((x) => x.player_id === GUEST)!.text).toMatch(/^Wout stood/);
    // settled once: the end pays nothing more
    toStage(db, id, 4);
    expect(money(db, GUEST)).toBe(m2 + s2.paid_c);
  });
});

describe("M8d the hiring gate: each player stands for himself", () => {
  it("two players at one gate each get the foreman's answer and their own day's job", async () => {
    const db = fresh(1, 4);
    setClock(db, 1, 5, 0);
    eventsTick(db);
    const ev0 = db.prepare("SELECT * FROM town_event WHERE template = 'hiring'").get() as EventRow;
    let ev = toStage(db, ev0.id, 0);
    const sp = stagesOf(ev)[0].hiring!.spots[0];
    expect(standForHire(db, sp.x + 2, sp.z + 1).ok).toBe(true);
    expect(standForHire(db, sp.x + 2, sp.z + 1).ok).toBe(false); // the host stands already
    expect(as2(() => standForHire(db, sp.x + 1, sp.z + 2)).ok).toBe(true); // the guest beside him
    expect(as2(() => standForHire(db, sp.x + 1, sp.z + 2)).ok).toBe(false);
    const jobs0 = (db.prepare("SELECT COUNT(*) AS n FROM job").get() as { n: number }).n;
    setHiringRoll((k) => (k.includes(":jef") ? 0 : 0.5));
    ev = toStage(db, ev.id, 1);
    await hiringIdle();
    const s0 = stagesOf(eventRow(db, ev.id)!)[0].hiring!.spots[0];
    expect(s0.jef_result?.picked).toBe(true);
    expect(s0.more?.[0].player).toBe(GUEST);
    expect(s0.more?.[0].result?.picked).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS n FROM job").get() as { n: number }).n).toBe(jobs0 + 2);
    // each sees his own answer
    const view2 = as2(() => hiringForClient(stagesOf(eventRow(db, ev.id)!)))!.spots[0];
    const view1 = hiringForClient(stagesOf(eventRow(db, ev.id)!))!.spots[0];
    expect(view2.jef).toBe(true);
    expect(view2.jef_result?.picked).toBe(true);
    expect(view2.to_jef).toBeTruthy();
    expect(view1.jef_result?.text).toBe(s0.jef_result?.text);
  });
});
