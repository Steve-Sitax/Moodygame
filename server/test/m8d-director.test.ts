import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/db.ts";
import { callClaude, type Runner } from "../src/ai/claude.ts";
import { callsToday, queueState, resetCallQueue, setCallsAtOnce } from "../src/ai/budget.ts";
import { CALLS_PER_DAY, RESIDENT_CALLS_PER_DAY, setCallPlayers, setCallsPerDay, playerCallShare } from "../src/config.ts";
import { z } from "zod";
import { blankSave } from "./blank-save.ts";
import { asPlayer, setOnlineIds, setPositionSource } from "../src/player/current.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { town } from "../src/town/store.ts";
import { pickPocket, resetThieves } from "../src/town/thieves.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { resetConvos, type ConvoOut } from "../src/director/convo.ts";
import {
  actionOf,
  activeActions,
  applyProposal,
  installTalkHooks,
  listActions,
  reportAction,
  resetSync,
  startAction,
  syncFromClient,
  validateProposal,
  whereIs,
} from "../src/director/actions.ts";
import { assignLead, directorPrompt, directorState, followUp, leadCandidates, nextLeadFor, openThreads, think, type DirectorOut } from "../src/director/director.ts";
import { eventRow, eventsTick, planEvent, stage, type EventRow } from "../src/director/scheduler.ts";
import { planFromTemplate, templateById } from "../src/director/templates.ts";
import { setSceneRoll, streetCrimeOpen } from "../src/director/scenes.ts";
import { canCall } from "../src/town/talk.ts";
import type { ResidentLine } from "../src/town/talk.ts";
import type { ActionProposal } from "../src/director/vocab.ts";

// M8d "shared work", the director is fair to every player, and the AI budget per player
// (docs/multiplayer-plan.md 8 and 10; Steve 2026-09-26: the host pays, a limit only when set).

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const reply = (output: unknown): Runner => async () => ({ output });
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const prop = (over: Partial<ActionProposal>): ActionProposal => ({ kind: "none", target: "", minutes: 0, item: "", amount_c: 0, reason: "", ...over });
const line = (over: Partial<ResidentLine> = {}): ResidentLine => ({
  npc_line: "Aye.",
  mood: "neutral",
  choices: ["Thank you.", "This way.", "Never mind."],
  trust_delta: 0,
  memory_note: "",
  memory_weight: 1,
  rumour: "",
  rumour_tone: 0,
  persona_line: "",
  end_conversation: false,
  ...over,
});
const noConvoCalls = (db: DB) => {
  for (let i = 0; i < 10; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (1, 10, 'npc_convo', 'claude', 'x', 1, 1)").run();
};

function fresh(hour = 10): DB {
  const db = blankSave();
  setClock(db, 1, hour);
  ensurePlayerRow(db, GUEST, "Anna");
  return db;
}
const people = (db: DB) => town(db).town.residents;
/** A grown man out in the street, warm enough to follow anyone. */
function docker(db: DB, not: string[] = []) {
  const r = people(db).find((x) => x.trade === "docker" && !whereIs(db, x).indoors && !not.includes(x.id))!;
  town(db).byId.get(r.id)!.stats.warmth = 7;
  town(db).byId.get(r.id)!.stats.courage = 6;
  return r;
}
/** Two in the game: the host at `a`, Anna at `b` (their tabs' word). */
function two(a: { x: number; z: number }, b: { x: number; z: number }) {
  setOnlineIds(() => [1, GUEST]);
  asPlayer(1, () => syncFromClient({ x: a.x, z: a.z }));
  as2(() => syncFromClient({ x: b.x, z: b.z }));
}

beforeEach(() => {
  resetSync();
  resetTalks();
  resetThieves();
  resetConvos();
  installTalkHooks();
  resetCallQueue();
});
afterEach(() => {
  setOnlineIds(null);
  setPositionSource(null);
  setSceneRoll(null);
  setCallPlayers(1);
  setCallsPerDay(120);
  resetCallQueue();
});

// ------------------------------------------------------------------ the prompt's PLAYERS block

describe("M8d the director's prompt: a line per player", () => {
  it("played alone the prompt has no PLAYERS block", () => {
    const db = fresh();
    syncFromClient({ x: 0, z: 0 });
    expect(directorPrompt(db)).not.toMatch(/PLAYERS/);
  });

  it("played together: one line each, where, a job or not, a lead or not, and whom the next event is for", () => {
    const db = fresh();
    const gm = eventRowPlace(db, "grote_markt");
    two({ x: gm.x + 400, z: gm.z }, gm);
    db.prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, pitch, status, taken_by) VALUES (1, 'Carry sacks', 'baas', 'rijnkaai', 'carry', 30, 'low', 1, 'x', 'taken', 1)").run();
    const p = directorPrompt(db);
    expect(p).toMatch(/PLAYERS/);
    expect(p).toMatch(/- Jef: near .*; on a job/);
    expect(p).toMatch(/- Anna: near .*; no job in hand; no lead yet/);
    expect(p).toMatch(/THE NEXT EVENT IS FOR (Jef|Anna)/);
  });
});

/** The spot of an event place by id (planned once to read where the engine puts it). */
function eventRowPlace(db: DB, id: string): { x: number; z: number } {
  const p = planEvent(db, { title: "Probe", template: "probe", place: id, start_in_min: 0, stages: [stage({ op: "sound", minutes: 10, sound: "bells" })], source: "engine" }, { dev: true });
  if (!p.ok) throw new Error(p.why);
  const at = { x: p.event.x, z: p.event.z };
  db.prepare("DELETE FROM town_event WHERE id = ?").run(p.event.id);
  return at;
}

// ------------------------------------------------------------------ fair leads

describe("M8d leads: no player gets two before each has one", () => {
  const plan = (db: DB, place: string, title: string): EventRow => {
    const p = planEvent(db, { title, template: title.toLowerCase().replace(/\s+/g, "_"), place, start_in_min: 0, stages: [stage({ op: "sound", minutes: 10, sound: "bells" })], source: "engine" }, { dev: true });
    if (!p.ok) throw new Error(p.why);
    return p.event;
  };

  it("the round goes host, guest, then again; an event far from everyone is nobody's lead", () => {
    const db = fresh();
    const one = plan(db, "grote_markt", "One");
    const twoEv = plan(db, "steenplein", "Two");
    two(one, one);
    expect(leadCandidates(db)).toEqual([1, GUEST]);
    expect(assignLead(db, one)).toBe(1);
    expect(leadCandidates(db)).toEqual([GUEST]);
    expect(nextLeadFor(db)).toBe(GUEST);
    // the host stands right at it, the guest 100 m off: he had his, so the guest gets this one
    two(twoEv, { x: twoEv.x + 100, z: twoEv.z });
    expect(assignLead(db, twoEv)).toBe(GUEST);
    expect(eventRow(db, twoEv.id)!.for_player).toBe(GUEST);
    expect(leadCandidates(db)).toEqual([1, GUEST]);
    // far from both: nobody's, and the round is as it was
    const three = plan(db, "vismarkt", "Three");
    two({ x: three.x + 900, z: three.z }, { x: three.x + 900, z: three.z });
    expect(assignLead(db, three)).toBeNull();
    expect(eventRow(db, three.id)!.for_player ?? null).toBeNull();
    expect(leadCandidates(db)).toEqual([1, GUEST]);
  });

  it("alone nothing is a lead (no change to the rows)", () => {
    const db = fresh();
    syncFromClient({ x: 0, z: 0 });
    const ev = plan(db, "grote_markt", "Alone");
    expect(assignLead(db, ev)).toBeNull();
    expect(eventRow(db, ev.id)!.for_player ?? null).toBeNull();
  });

  it("think(): the model's event becomes the lead of the player the prompt named", async () => {
    const db = fresh();
    const gm = eventRowPlace(db, "grote_markt");
    two({ x: gm.x + 600, z: gm.z }, gm);
    // the host has had his lead: the next is Anna's
    const s = directorState(db);
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('director', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify({ ...s, leadRound: [1] }));
    let prompt = "";
    const out: DirectorOut = { decision: "event", why: "for Anna", event: { title: "A fiddler plays", kind: "music", place: "grote_markt", start_in_min: 5, stages: [stage({ op: "sound", minutes: 10, sound: "music" })], notice: "", rumour: "" } };
    const r = await think(db, async (req) => ((prompt = req.prompt), { output: out }), true);
    expect(prompt).toMatch(/THE NEXT EVENT IS FOR Anna/);
    expect(r.planned?.ok).toBe(true);
    const ev = (r.planned as { event: EventRow }).event;
    expect(eventRow(db, ev.id)!.for_player).toBe(GUEST);
  });
});

// ------------------------------------------------------------------ the police follow-up, per player

describe("M8d followUp: each player's robbery, searched once each", () => {
  it("the guest's robbery sends an agent for him; the host's is his own", () => {
    const db = fresh(22);
    setOnlineIds(() => [1, GUEST]);
    const thief = people(db).find((r) => r.trade === "thief")!;
    const took = as2(() => pickPocket(db, thief.id, () => 0.1));
    expect(took.took_c).toBeGreaterThan(0);
    setClock(db, 1, 10);
    expect(openThreads(db).some((t) => t.startsWith("Anna was robbed"))).toBe(true);
    expect(openThreads(db).some((t) => t.startsWith("Jef was robbed"))).toBe(false);
    expect(followUp(db)).toMatch(/police search/);
    const go = activeActions(db).find((a) => a.source === "director")!;
    expect(go.for_player).toBe(GUEST);
    expect(directorState(db).searchedBy?.[String(GUEST)]).toBeGreaterThan(0);
    expect(directorState(db).searched).toBe(0);
    expect(followUp(db)).toBeNull();
    const ev = db.prepare("SELECT text FROM world_event WHERE verb = 'police_search'").get() as { text: string };
    expect(ev.text).toContain("Anna's robbery");
  });
});

// ------------------------------------------------------------------ actions about one player

describe("M8d npc_action.for_player", () => {
  it("a follow asked by the guest is his; three asked in talk per player; the host cannot stop the guest's", () => {
    const db = fresh();
    two({ x: 0, z: 0 }, { x: 5, z: 5 });
    const d = docker(db);
    const l = as2(() => applyProposal(db, d, line({ action: prop({ kind: "follow", reason: "walk with me" }) } as Partial<ResidentLine>)));
    expect(l.action_id).toBeGreaterThan(0);
    const a = actionOf(db, d.id)!;
    expect(a.for_player).toBe(GUEST);
    expect(listActions(db).find((x) => x.id === a.id)!.for_player).toBe(GUEST);
    // the host asks him to stop: not his to stop
    const stop = validateProposal(db, d, prop({ kind: "stop" }));
    expect(stop.ok).toBe(false);
    expect(actionOf(db, d.id)?.id).toBe(a.id);
    // the guest may
    expect(as2(() => validateProposal(db, d, prop({ kind: "stop" }))).ok).toBe(true);
    expect(actionOf(db, d.id)).toBeNull();
  });

  it("the guest's fetch_police, reported by the host's PC: the agent comes to where the guest was", async () => {
    const db = fresh();
    noConvoCalls(db);
    two({ x: 300, z: 300 }, { x: 0, z: 20 });
    const d = docker(db);
    const l = as2(() => applyProposal(db, d, line({ action: prop({ kind: "fetch_police", reason: "I was robbed" }) } as Partial<ResidentLine>)));
    expect(l.refused).toBeNull();
    const a = actionOf(db, d.id)!;
    expect(a.for_player).toBe(GUEST);
    // the host's PC walks him and reports (outside the guest's context)
    await asPlayer(1, () => reportAction(db, a.id, { phase: "arrived" }, reply({ lines: [{ speaker: "A", text: "Come quick." }, { speaker: "B", text: "Aye." }], memory_a: "", memory_b: "", outcome_kind: "none", trust_a: 0, trust_b: 0 } satisfies ConvoOut)));
    const agentGo = activeActions(db).find((x) => x.kind === "go_to" && x.source === "engine")!;
    expect(agentGo.for_player).toBe(GUEST);
    // where the guest was when he asked, not the host
    expect(Math.hypot(agentGo.target_x! - 0, agentGo.target_z! - 20)).toBeLessThan(20);
  });

  it("an action started in the world's own work is nobody's; in a player's context his", () => {
    const db = fresh();
    const d = docker(db);
    const w = startAction(db, { npc_id: d.id, kind: "wait", source: "engine", minutes: 10 });
    expect(w.for_player ?? null).toBeNull();
    const d2 = docker(db, [d.id]);
    const g = as2(() => startAction(db, { npc_id: d2.id, kind: "wait", source: "engine", minutes: 10 }));
    expect(g.for_player).toBe(GUEST);
  });
});

// ------------------------------------------------------------------ scenes: who saw it

describe("M8d scenes: witnessedBy, per player", () => {
  it("the guest saw the robbery, the host did not: only the guest may tell the police", () => {
    const db = fresh(11);
    noConvoCalls(db);
    setSceneRoll((k) => (k.endsWith(":catch") ? 0.99 : 0.5));
    const p = planEvent(db, planFromTemplate(templateById("street_robbery")!, "engine", { start_in_min: 0 }), { dev: true });
    expect(p.ok).toBe(true);
    eventsTick(db);
    let ev = eventRow(db, (p as { event: EventRow }).event.id)!;
    two({ x: ev.x + 500, z: ev.z }, { x: ev.x + 4, z: ev.z + 4 });
    const stages = JSON.parse(ev.stages_json) as Array<{ minutes: number }>;
    const at = ev.start_m + stages[0].minutes;
    setClock(db, Math.floor(at / 1440) + 1, Math.floor((at % 1440) / 60), at % 60);
    eventsTick(db);
    ev = eventRow(db, ev.id)!;
    const sc = (JSON.parse(ev.stages_json) as Array<{ scene?: { witnessedBy?: number[]; witnessed?: boolean } }>)[1].scene!;
    expect(sc.witnessedBy).toEqual([GUEST]);
    const start = db.prepare("SELECT text FROM world_event WHERE verb = 'street_robbery'").get() as { text: string };
    expect(start.text).toContain("Anna saw it happen.");
    // run it out
    const end = at + stages[1].minutes;
    setClock(db, Math.floor(end / 1440) + 1, Math.floor((end % 1440) / 60), end % 60);
    eventsTick(db);
    expect(as2(() => streetCrimeOpen(db))!.witnessed).toBe(true);
    expect(streetCrimeOpen(db)!.witnessed).toBe(false);
    expect(streetCrimeOpen(db)!.witnessedBy).toEqual([GUEST]);
  });

  it("alone: the host sees it as before", () => {
    const db = fresh(11);
    noConvoCalls(db);
    setSceneRoll((k) => (k.endsWith(":catch") ? 0.99 : 0.5));
    const p = planEvent(db, planFromTemplate(templateById("street_robbery")!, "engine", { start_in_min: 0 }), { dev: true });
    eventsTick(db);
    let ev = eventRow(db, (p as { event: EventRow }).event.id)!;
    syncFromClient({ x: ev.x + 5, z: ev.z + 5 });
    const stages = JSON.parse(ev.stages_json) as Array<{ minutes: number }>;
    const at = ev.start_m + stages[0].minutes;
    setClock(db, Math.floor(at / 1440) + 1, Math.floor((at % 1440) / 60), at % 60);
    eventsTick(db);
    ev = eventRow(db, ev.id)!;
    const start = db.prepare("SELECT text FROM world_event WHERE verb = 'street_robbery'").get() as { text: string };
    expect(start.text).toMatch(/ Jef saw it happen\.$/);
  });
});

// ------------------------------------------------------------------ the AI budget per player

const Out = z.object({ say: z.string() });
const ok: Runner = async () => ({ output: { say: "hello" } });

describe("M8d the AI budget: a share per player when a limit is set", () => {
  const fill = (db: DB, who: number, hook: string, n: number) => {
    for (let i = 0; i < n; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok, player_id) VALUES (1, 10, ?, 'claude', 'x', 1, 1, ?)").run(hook, who);
  };

  it("the day grows by one share per extra player; alone it is the setting", () => {
    const db = fresh();
    setCallsPerDay(120);
    callsToday(db, 1, "resident%");
    expect(CALLS_PER_DAY).toBe(120);
    setOnlineIds(() => [1, GUEST]);
    callsToday(db, 1, "resident%");
    expect(playerCallShare()).toBe(60);
    expect(CALLS_PER_DAY).toBe(180);
    setCallsPerDay(0);
    expect(CALLS_PER_DAY).toBe(Infinity);
  });

  it("the guest's share runs out: he gets the fallback, the host still gets the model", async () => {
    const db = fresh();
    setOnlineIds(() => [1, GUEST]);
    fill(db, GUEST, "resident_talk", 30);
    fill(db, GUEST, "letter_reply", 30);
    const g = await as2(() => callClaude(db, { hook: "resident_talk", system: "s", prompt: "p", schema: Out }, ok));
    expect(g.ok).toBe(false);
    expect(g.error).toMatch(/share/);
    const h = await asPlayer(1, () => callClaude(db, { hook: "resident_talk", system: "s", prompt: "p", schema: Out }, ok));
    expect(h.ok).toBe(true);
    // a world hook is nobody's share
    const w = await as2(() => callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Out }, ok));
    expect(w.ok).toBe(true);
    expect((db.prepare("SELECT player_id FROM ai_call WHERE hook = 'resident_talk' ORDER BY id DESC LIMIT 1").get() as { player_id: number }).player_id).toBe(1);
  });

  it("the talk share of the townspeople is each player's own when together; the town's when alone", () => {
    const db = fresh();
    fill(db, GUEST, "resident_talk", RESIDENT_CALLS_PER_DAY);
    // alone (only the host in the game): the guest's old calls count against the town's share, as before
    expect(canCall(db, { calls: 0 })).toBe(false);
    setOnlineIds(() => [1, GUEST]);
    expect(asPlayer(1, () => canCall(db, { calls: 0 }))).toBe(true);
    expect(as2(() => canCall(db, { calls: 0 }))).toBe(false);
  });

  it("no limit set: nobody's share runs out", async () => {
    const db = fresh();
    setCallsPerDay(0);
    setOnlineIds(() => [1, GUEST]);
    fill(db, GUEST, "letter_reply", 500);
    const g = await as2(() => callClaude(db, { hook: "letter_reply", system: "s", prompt: "p", schema: Out }, ok));
    expect(g.ok).toBe(true);
  });

  it("alone the host has no share: only the day's limit", async () => {
    const db = fresh();
    fill(db, 1, "letter_reply", 100);
    const h = await callClaude(db, { hook: "letter_reply", system: "s", prompt: "p", schema: Out }, ok);
    expect(h.ok).toBe(true);
  });
});

// ------------------------------------------------------------------ the queue

describe("M8d the call queue: three at once, talk first, the 20 s from the start of the call", () => {
  it("a fourth call waits; when a place frees the talk goes before the world's hook", async () => {
    const db = fresh();
    setOnlineIds(() => [1, GUEST]);
    const gates: Array<() => void> = [];
    const slow: Runner = () => new Promise((res) => gates.push(() => res({ output: { say: "x" } })));
    const order: string[] = [];
    const tag =
      (name: string): Runner =>
      async () => {
        order.push(name);
        return { output: { say: name } };
      };
    const first = [0, 1, 2].map((i) => callClaude(db, { hook: `world_${i}`, system: "s", prompt: "p", schema: Out }, slow));
    await new Promise((r) => setTimeout(r, 20));
    expect(queueState().running).toBe(3);
    const world = callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Out }, tag("world"));
    const talk = as2(() => callClaude(db, { hook: "resident_talk", system: "s", prompt: "p", schema: Out }, tag("talk")));
    await new Promise((r) => setTimeout(r, 20));
    expect(queueState().waiting).toBe(2);
    gates.shift()!();
    await Promise.all([world, talk]);
    expect(order).toEqual(["talk", "world"]);
    for (const g of gates) g();
    await Promise.all(first);
  });

  it("the wait in the queue does not eat the call's own limit", async () => {
    const db = fresh();
    setOnlineIds(() => [1, GUEST]);
    setCallsAtOnce(1);
    let open!: () => void;
    const blocker = callClaude(db, { hook: "newspaper", system: "s", prompt: "p", schema: Out }, () => new Promise((res) => (open = () => res({ output: { say: "x" } }))));
    await new Promise((r) => setTimeout(r, 10));
    const quick: Runner = async () => {
      await new Promise((r) => setTimeout(r, 150));
      return { output: { say: "late but in time" } };
    };
    const waiting = as2(() => callClaude(db, { hook: "resident_talk", system: "s", prompt: "p", schema: Out, timeoutMs: 400 }, quick));
    await new Promise((r) => setTimeout(r, 350));
    open();
    await blocker;
    const r = await waiting;
    // waited 350 ms, then ran 150 ms: 500 ms in all, over its 400 ms limit, and still in time
    expect(r.ok).toBe(true);
  });

  it("alone there is no queue", async () => {
    const db = fresh();
    setCallsAtOnce(1);
    const gates: Array<() => void> = [];
    const slow: Runner = () => new Promise((res) => gates.push(() => res({ output: { say: "x" } })));
    const calls = [0, 1, 2, 3].map((i) => callClaude(db, { hook: `world_${i}`, system: "s", prompt: "p", schema: Out }, slow));
    await new Promise((r) => setTimeout(r, 20));
    expect(gates.length).toBe(4);
    for (const g of gates) g();
    await Promise.all(calls);
  });
});
