import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer, setOnlineIds } from "../src/player/current.ts";
import { ensurePlayerRow, resetPlayer } from "../src/player/multi.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { setWorldClock } from "../src/mp/worldClock.ts";
import { town } from "../src/town/store.ts";
import { actionRow, installTalkHooks, resetSync, startAction } from "../src/director/actions.ts";
import { devRoutine } from "../src/director/steps.ts";
import { installFamilies, seekPins, startSeek } from "../src/director/families.ts";
import { handPins, installHire } from "../src/town/hire.ts";
import { installTreat } from "../src/town/treat.ts";
import { figHolders, jobPins } from "../src/town/walkup.ts";
import { boardSchemaFor, boardSize, FALLBACK_BOARD, FALLBACK_CART_JOB, FALLBACK_EXTRA_JOBS, fallbackBoard, listJobs, makeBoard } from "../src/hooks/jobBoard.ts";
import { clearLine, gameMinute, stealables, takeThing } from "../src/town/deeds.ts";
import { policeAnswer, policeArrived, policeOpen, policeRespond, policeState, policeTick, policeWitness } from "../src/town/police.ts";
import { JobFigs, type OwnFigure } from "../../client/src/net/mp/jobfigs.ts";
import { decodeFigs } from "../../shared/mpProtocol.ts";

// M8d review round 3: a retired man leaves no business behind; the hand-written board is sized for the players; a
// witness talk runs to its answer; the job figures' sender does no work while nothing is due.

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const always = () => 0;
const fail: Runner = async () => {
  throw new Error("no model in tests");
};

beforeAll(() => void blankSave().close(), 60_000);

beforeEach(() => {
  resetTalks();
  resetSync();
  installTalkHooks();
  installFamilies();
  installHire();
  installTreat();
  setOnlineIds(() => [1, GUEST]);
});

afterEach(() => {
  setOnlineIds(null);
});

function fresh(hour = 11): DB {
  const db = blankSave();
  setWorldClock(db, { day: 1, hour, minute: 0 });
  ensurePlayerRow(db, GUEST, "Anna");
  return db;
}

const active = (db: DB, id: number) => actionRow(db, id)?.status === "active";
const pinsOf = (db: DB) => new Map([...seekPins(db, [1, GUEST]), ...handPins(db, [1, GUEST]), ...jobPins(db, [1, GUEST])]);

describe("M8d review: a new man leaves the old man's business behind", () => {
  it("his errands, visits, family news, hands, treats and walk-up callers end; the host's stay", () => {
    const db = fresh();
    const free = town(db).town.residents.filter((r) => r.age >= 20 && r.age <= 55 && r.trade !== "police" && !db.prepare("SELECT 1 FROM npc_action WHERE status = 'active' AND npc_id = ?").get(r.id));
    const [a, b, c, d, e, f, g, h] = free;
    // the guest's: a follow asked in talk, a visit, a hand, a drink he stood, a thief walking up for his trouble
    const follow = startAction(db, { npc_id: a.id, kind: "follow", target: "Jef", source: "talk", minutes: 30, for_player: GUEST });
    const seek = as2(() => startSeek(db, b.id, "talk_angry", { player: GUEST }));
    const hand = as2(() => devRoutine(db, c.id, [{ kind: "wait", minutes: 60, label: "watching" }], "hire", 120, { task: "watch", player: GUEST, wage_c: 40, paid_c: 20, loads: 0, expected: 1, cart: null }));
    const treat = as2(() => devRoutine(db, d.id, [{ kind: "follow", who: "jef", label: "the tavern" }], "treat", 120, { player: GUEST, place: "x", label: "the tavern", rounds: 0, tipsy: 0 }));
    // (an older "come" row: no for_player, only the call's own word for whose it is)
    const come = startAction(db, { npc_id: e.id, kind: "come" as never, target: "Jef", source: "engine", minutes: 60, data: { role: "thief", why: "trouble", ref: "trouble:9", pid: GUEST } as never, for_player: null });
    // his family news, still to be told and waiting to be acted on
    const news = db.prepare("INSERT INTO family_news (day, minute, teller, listener, memory_id, origin, gist, tone, status, player_id) VALUES (1, ?, ?, ?, 0, 0, 'Jef was rude', -2, ?, ?)");
    const n1 = Number(news.run(gameMinute(db), f.id, g.id, "waiting", GUEST).lastInsertRowid);
    const n2 = Number(news.run(gameMinute(db), g.id, f.id, "pending", GUEST).lastInsertRowid);
    // the host's: a follow and a hand of his own, his news
    const hostFollow = startAction(db, { npc_id: f.id, kind: "follow", target: "Jef", source: "talk", minutes: 30, for_player: 1 });
    const hostHand = devRoutine(db, h.id, [{ kind: "wait", minutes: 60, label: "watching" }], "hire", 120, { task: "watch", player: 1, wage_c: 40, paid_c: 40, loads: 0, expected: 1, cart: null });
    const n3 = Number(news.run(gameMinute(db), f.id, h.id, "waiting", 1).lastInsertRowid);

    const before = pinsOf(db);
    expect([...before.values()].filter((p) => p === GUEST).length).toBe(4); // (the visit, the hand, the treat, the caller)

    resetPlayer(db, GUEST, "Anna");

    for (const x of [follow, seek, hand, treat, come]) expect(active(db, x.id)).toBe(false);
    expect(actionRow(db, follow.id)!.status).toBe("stopped");
    expect(actionRow(db, hand.id)).toMatchObject({ status: "failed", outcome: "he is gone" });
    const st = (id: number) => (db.prepare("SELECT status, outcome FROM family_news WHERE id = ?").get(id) as { status: string; outcome: string });
    expect(st(n1)).toEqual({ status: "lapsed", outcome: "he is gone" });
    expect(st(n2)).toEqual({ status: "lapsed", outcome: "he is gone" });
    // no pin names him any more; the host's are as they were
    const after = pinsOf(db);
    expect([...after.values()].includes(GUEST)).toBe(false);
    expect(after.get(h.id)).toBe(1);
    expect(active(db, hostFollow.id)).toBe(true);
    expect(active(db, hostHand.id)).toBe(true);
    expect(st(n3).status).toBe("waiting");
  });

  it("played alone nothing changes: the host's reset hooks find nothing of a guest's to end", () => {
    const db = fresh();
    const [a] = town(db).town.residents.filter((r) => r.age >= 20 && !db.prepare("SELECT 1 FROM npc_action WHERE status = 'active' AND npc_id = ?").get(r.id));
    const own = startAction(db, { npc_id: a.id, kind: "follow", target: "Jef", source: "talk", minutes: 30, for_player: 1 });
    resetPlayer(db, GUEST, "Anna");
    expect(active(db, own.id)).toBe(true);
  });
});

describe("M8d review: who may send job figures", () => {
  it("a player with a job in hand or a walk-up call; nobody else", () => {
    const db = fresh();
    expect(figHolders(db).size).toBe(0);
    const [a] = town(db).town.residents.filter((r) => r.age >= 20 && !db.prepare("SELECT 1 FROM npc_action WHERE status = 'active' AND npc_id = ?").get(r.id));
    startAction(db, { npc_id: a.id, kind: "come" as never, target: "Jef", source: "engine", minutes: 60, data: { role: "thief", why: "trouble", ref: "trouble:3", pid: GUEST } as never, for_player: null });
    expect([...figHolders(db)]).toEqual([GUEST]);
    db.prepare("INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status, taken_by) VALUES (1, 't', 'sooi', 'rijnkaai', 'watch', 50, 'low', 0, 'naties', 'p', '{}', 'test', 'taken', 3)").run();
    expect([...figHolders(db)].sort()).toEqual([GUEST, 3]);
  });
});

describe("M8d review: the hand-written board is sized for the players", () => {
  it("alone as it always was; two more for each other player, within the model's bounds", () => {
    expect(fallbackBoard(1, false)).toBe(FALLBACK_BOARD);
    expect(fallbackBoard(1, true).jobs).toEqual([...FALLBACK_BOARD.jobs, FALLBACK_CART_JOB].slice(0, 7));
    for (let n = 1; n <= 7; n++) {
      for (const carts of [false, true]) {
        const b = fallbackBoard(n, carts);
        const size = boardSize(n);
        expect(b.jobs.length).toBeGreaterThanOrEqual(size.min);
        expect(b.jobs.length).toBeLessThanOrEqual(size.max);
        expect(new Set(b.jobs.map((j) => j.title)).size).toBe(b.jobs.length);
        expect(boardSchemaFor(n).safeParse(b).success).toBe(true);
      }
    }
    expect(fallbackBoard(2, false).jobs.length).toBe(FALLBACK_BOARD.jobs.length + 2);
    expect(FALLBACK_EXTRA_JOBS.length).toBeGreaterThanOrEqual(2 * (6 - 1));
  });

  it("the model fails with three in the game: the board has two more for each other player", async () => {
    const db = fresh();
    setOnlineIds(() => [1, 2, 3]);
    const r = await makeBoard(db, fail);
    expect(r.source).toBe("fallback");
    const offered = listJobs(db, 1).filter((j) => j.status === "offered" && j.source === "fallback");
    expect(offered.length).toBe(fallbackBoard(3, false).jobs.length);
    expect(offered.length).toBeGreaterThanOrEqual(boardSize(3).min);
    expect(offered.every((j) => j.playable)).toBe(true);
  });
});

describe("M8d review: a witness talk runs to its answer", () => {
  function lampsNear(db: DB) {
    const lamps = stealables(db).lamps;
    const lamp = lamps.find((l) => l.id === "lamp:hessenatie")!;
    for (let k = 0; k < 16; k++) {
      const x = lamp.x + Math.cos((k / 16) * Math.PI * 2) * 8;
      const z = lamp.z + Math.sin((k / 16) * Math.PI * 2) * 8;
      if (clearLine(x, z, lamp.x, lamp.z)) return { lamp, other: lamps.find((l) => l.id !== lamp.id)!, near: { x, z } };
    }
    throw new Error("no clear place near the lantern");
  }
  function arrives(db: DB): string {
    const v0 = policeState(db).visit!;
    const m = gameMinute(db) + Math.max(0, v0.due - gameMinute(db) + 1);
    setWorldClock(db, { day: Math.floor(m / 1440) + 1, hour: Math.floor((m % 1440) / 60), minute: m % 60 });
    const v = policeTick(db)!;
    policeArrived(db, v.agent!);
    return v.agent!;
  }

  it("his own theft while he is being asked: the talk stays, his deed's visit follows it", async () => {
    const db = fresh(10);
    const { lamp, other, near } = lampsNear(db);
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...near }]);
    policeRespond(db, r.deed!);
    expect(as2(() => policeWitness(db, r.deed!, 1))).toBe(true);
    arrives(db);
    const agent = as2(() => arrives(db));
    expect(as2(() => policeState(db)).visit).toMatchObject({ reason: "witness", state: "talking" });
    // the guest takes a lantern himself, and the police are called on him
    const mine = as2(() => takeThing(db, { ref: other.id, x: other.x, z: other.z, witnesses: [{ id: other.owner, d: 3, los: true, facing: 1 }] }, always));
    expect(mine.deed).toBeTruthy();
    as2(() => policeRespond(db, mine.deed!));
    expect(as2(() => policeState(db)).visit).toMatchObject({ reason: "witness", state: "talking", agent });
    // he answers: the question is done, and now the police want him for his own deed
    as2(() => policeOpen(db, agent));
    const out = await as2(() => policeAnswer(db, agent, "choice", "I saw nothing."));
    expect(out.end).toBe(true);
    const v = as2(() => policeState(db)).visit;
    expect(v).toMatchObject({ reason: "deed", deeds: [mine.deed], state: "due" });
    expect(as2(() => policeState(db)).queued).toBeUndefined();
  });

  it("not yet talking: the witness's question still waits for another day (as before)", () => {
    const db = fresh(10);
    const { lamp, near } = lampsNear(db);
    const r = takeThing(db, { ref: lamp.id, x: lamp.x, z: lamp.z, witnesses: [{ id: "sooi", d: 4, los: true, facing: 1 }] }, always, [{ id: GUEST, ...near }]);
    as2(() => policeWitness(db, r.deed!, 1));
    as2(() => policeRespond(db, r.deed!));
    expect(as2(() => policeState(db)).visit?.reason).toBe("deed");
  });
});

describe("M8d review: the job figures' sender", () => {
  it("asks where its figures are only when a batch may be due; what it sends is as before", () => {
    let now = 5_000;
    let looks = 0;
    const look = { kind: "thief" as const, x: 5, y: 0, z: 5, yaw: 0, speed: 0, motion: "idle" as const, carrying: false };
    const outs = new Set<object>();
    const fig: OwnFigure = {
      netLook(out) {
        looks++;
        if (out) outs.add(out);
        return look;
      },
    };
    const wire: ArrayBuffer[] = [];
    const jf = new JobFigs({ own: () => [fig], make: () => null, serverNow: () => now, player: () => ({ x: 0, z: 0 }), sendBinary: (b) => (wire.push(b), true) });
    const frames = 120; // (two seconds at 60 a second, standing)
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      jf.frame(1 / 60);
    }
    expect(wire.length).toBeGreaterThanOrEqual(4);
    expect(wire.length).toBeLessThanOrEqual(6);
    // (not in the tenth of a second after a batch, when nothing can be due; always into the same object)
    expect(looks).toBeLessThanOrEqual(frames - 4 * 5);
    expect(outs.size).toBe(1);
    // the first batch has him new (a jump), the next ones not
    expect(decodeFigs(new DataView(wire[0]))!.list[0]).toMatchObject({ id: 1, snap: true, x: 5 });
    expect(decodeFigs(new DataView(wire[1]))!.list[0]).toMatchObject({ id: 1, snap: false });
  });
});
