import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { finishJob, holdJob, ReportSchema, saveProgress, takeJob } from "../src/game.ts";
import { ALL_EMPLOYERS, boardSchemaFor, boardSize, buildPrompt, devJob, FALLBACK_BOARD, listJobs, makeBoard, type Board } from "../src/hooks/jobBoard.ts";
import { nightPrompt, nightSchemaFor, nightSize } from "../src/night/nightwork.ts";
import { asPlayer, setOnlineIds, setPositionSource } from "../src/player/current.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { resetSync, syncFromClient } from "../src/director/actions.ts";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { activityAt } from "../src/town/schedule.ts";
import { callResponder, comeHolder, comings, endCall, jobPins, mayShadow, shadowFacts } from "../src/town/walkup.ts";
import { Owners } from "../src/mp/street.ts";
import { decodeFigs, encodeFigs, FIG_BYTES, FIG_HEAD, figBatchOk, figSetSender, MSG_FIGS, type FigState } from "../../shared/mpProtocol.ts";
import { FIG_DELAY_MS, FIG_SILENT_MS, JobFigs, sampleFig, type DrawnFigure, type OwnFigure } from "../../client/src/net/mp/jobfigs.ts";

// M8d "shared work" (docs/multiplayer-plan.md 9, the rows "Jobs" and "Twists and job figures"): the board by the
// players in the game, each player's job and pay his own, the twists of two players at once, the townspeople called
// for a job kept to its holder's PC, and the figures of a job streamed to the others.

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output, usage: { in: 10, out: 20, cacheRead: 5 } });
const report = (r: Partial<ReturnType<typeof ReportSchema.parse>> = {}) => ReportSchema.parse(r);
const never = () => 0.99;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const ground = (x: number, z: number) => {
  const q = walkMap().nearestOpen(x, z, 8);
  if (!q) throw new Error(`no ground near ${x}, ${z}`);
  return q;
};

vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => resetSync());
afterEach(() => {
  resetSync();
  setOnlineIds(null);
  setPositionSource(null);
});

/** A board of n good lines (the model's). */
function boardOf(n: number): Board {
  const base = FALLBACK_BOARD.jobs;
  return { jobs: Array.from({ length: n }, (_, i) => ({ ...base[i % base.length], title: `Job number ${i + 1}` })) };
}

describe("M8d: the board by the players in the game", () => {
  it("alone as ever (4 to 7, the schema 3 to 7); two more for each other player; counted up to six players", () => {
    expect(boardSize(1)).toEqual({ min: 4, max: 7, schemaMin: 3 });
    expect(boardSize(2)).toMatchObject({ min: 6, max: 9 });
    expect(boardSize(3)).toMatchObject({ min: 8, max: 11 });
    expect(boardSize(99)).toMatchObject({ min: 14, max: 17 });
    expect(boardSize(0)).toMatchObject({ min: 4, max: 7 });
    expect(boardSize(Number.NaN)).toMatchObject({ min: 4, max: 7 });
    expect(boardSchemaFor(1).safeParse(boardOf(7)).success).toBe(true);
    expect(boardSchemaFor(1).safeParse(boardOf(8)).success).toBe(false);
    expect(boardSchemaFor(1).safeParse(boardOf(2)).success).toBe(false);
    expect(boardSchemaFor(2).safeParse(boardOf(9)).success).toBe(true);
    expect(boardSchemaFor(2).safeParse(boardOf(10)).success).toBe(false);
  });

  it("the model is asked for the players' number; alone the prompt is word for word as before", () => {
    const db = openDb(":memory:");
    expect(buildPrompt(db)).toContain("- 4 to 7 jobs. At least one carry");
    expect(buildPrompt(db, 1)).toBe(buildPrompt(db));
    expect(buildPrompt(db, 3)).toContain("- 8 to 11 jobs.");
  });

  it("two in the game: a board of nine is taken; alone the same nine is refused (the hand-written board)", async () => {
    const db = openDb(":memory:");
    setOnlineIds(() => [1, 2]);
    expect((await makeBoard(db, reply(boardOf(9)))).source).toBe("claude");
    expect(listJobs(db, 1).filter((j) => j.status === "offered").length).toBe(9);
    setOnlineIds(null);
    const alone = openDb(":memory:");
    expect((await makeBoard(alone, reply(boardOf(9)))).source).toBe("fallback");
  });

  it("the night's work: 2 to 4 alone, two more for each other player", () => {
    const db = openDb(":memory:");
    expect(nightSize(1)).toEqual({ min: 2, max: 4 });
    expect(nightSize(2)).toEqual({ min: 4, max: 6 });
    expect(nightSize(50)).toEqual({ min: 12, max: 14 });
    expect(nightPrompt(db)).toContain("- 2 to 4 jobs, from at least two different men.");
    expect(nightPrompt(db, 2)).toContain("- 4 to 6 jobs, from at least two different men.");
    const line = { title: "A quiet word", giver: "fence", task_type: "carry", goods: "sacks", from: "pier_head", to: "pier_head", twist: "none", recipient: "", pay_c: 200, pitch: "Two sacks, no questions." };
    const six = { jobs: Array.from({ length: 6 }, () => line) };
    expect(nightSchemaFor(1).safeParse(six).success).toBe(false);
    expect(nightSchemaFor(2).safeParse(six).success).toBe(true);
  });
});

describe("M8d: each player's job, pay and trust are his", () => {
  it("a guest's finished job pays the guest and moves his trust; the host's purse and trust stay", () => {
    const db = openDb(":memory:");
    ensurePlayerRow(db, 2, "Anna");
    const { id } = devJob(db, { type: "watch" });
    const j = asPlayer(2, () => takeJob(db, id));
    expect(j.taken_by).toBe(2);
    const faction = ALL_EMPLOYERS[j.employer_npc].faction;
    const money = (p: number) => (db.prepare("SELECT money_c FROM player WHERE id = ?").get(p) as { money_c: number }).money_c;
    const trust = (p: number) => (db.prepare("SELECT trust FROM faction_trust WHERE player_id = ? AND faction = ?").get(p, faction) as { trust: number }).trust;
    const [m1, m2, t1, t2] = [money(1), money(2), trust(1), trust(2)];
    // the host cannot report on her job
    expect(() => finishJob(db, id, report(), never)).toThrow(/not in hand/);
    expect(() => holdJob(db, id, report(), 600)).toThrow(/not in hand/);
    const res = asPlayer(2, () => finishJob(db, id, report(), never));
    expect(res.settlement.pay_c).toBeGreaterThan(0);
    expect(money(2)).toBe(m2 + res.settlement.pay_c + res.settlement.extra_c);
    expect(money(1)).toBe(m1);
    expect(trust(2)).toBe(t2 + res.settlement.trust_delta);
    expect(trust(1)).toBe(t1);
    expect(res.money_c).toBe(money(2));
  });

  it("another player's carry: no progress saved for it, and alone the host's job is his as before", () => {
    const db = openDb(":memory:");
    ensurePlayerRow(db, 2, "Anna");
    const a = devJob(db, { type: "carry" });
    asPlayer(2, () => takeJob(db, a.id));
    expect(() => saveProgress(db, a.id, { delivered: 1, lost: 0, sold: 0 })).toThrow(/no progress/);
    expect(asPlayer(2, () => saveProgress(db, a.id, { delivered: 1, lost: 0, sold: 0 })).task).toMatchObject({ progress: { delivered: 1 } });
    // the host his own job at the same time (one each)
    const b = devJob(db, { type: "watch" });
    const before = (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
    takeJob(db, b.id);
    const r = finishJob(db, b.id, report(), never);
    expect(r.money_c).toBe(before + r.settlement.pay_c + r.settlement.extra_c);
  });
});

describe("M8d: two players, two jobs, two twists", () => {
  /** Two thieves out at noon, placed by the clients' sync where we want them. */
  function town2() {
    const db = openDb(":memory:");
    setClock(db, 2, 12);
    const out = town(db).town.residents.filter((r) => r.trade === "thief" && r.age >= 16 && r.age <= 66 && !["home", "church"].includes(activityAt(r.sched, 2, 12).act));
    expect(out.length).toBeGreaterThanOrEqual(2);
    ensurePlayerRow(db, 2, "Anna");
    ensurePlayerRow(db, 3, "Piet");
    return { db, a: out[0], b: out[1] };
  }

  it("each gets his own man; whose each call is; the pins list only players in the game; one's end leaves the other's", () => {
    const { db, a, b } = town2();
    const A = ground(10, 12);
    const B = ground(-60, 12);
    syncFromClient({ people: [{ id: a.id, ...ground(20, 12) }, { id: b.id, ...ground(-70, 12) }] }, Date.now(), db);
    const j2 = devJob(db, { type: "watch" });
    const j3 = devJob(db, { type: "watch" });
    asPlayer(2, () => takeJob(db, j2.id));
    asPlayer(3, () => takeJob(db, j3.id));
    const r2 = asPlayer(2, () => callResponder(db, { role: "thief", why: "twist", ref: `job:${j2.id}:thief`, at: A, maxM: 40 }));
    const r3 = asPlayer(3, () => callResponder(db, { role: "thief", why: "twist", ref: `job:${j3.id}:thief`, at: B, maxM: 40 }));
    expect(r2.ok && r3.ok).toBe(true);
    if (!r2.ok || !r3.ok) return;
    expect(r2.npc).toBe(a.id);
    expect(r3.npc).toBe(b.id);
    const rows = comings(db);
    expect(rows.map((r) => comeHolder(db, r)).sort()).toEqual([2, 3]);
    // a repeat of his own call is his man; the same ref asked by another player is not handed him
    expect(asPlayer(2, () => callResponder(db, { role: "thief", why: "twist", ref: `job:${j2.id}:thief`, at: A }))).toMatchObject({ ok: true, npc: a.id, again: true });
    expect(jobPins(db, [1, 2, 3])).toEqual(new Map([[a.id, 2], [b.id, 3]]));
    expect(jobPins(db, [1, 2])).toEqual(new Map([[a.id, 2]])); // (Piet is gone: nobody's pin)
    // Anna's twist ends: Piet's man walks on
    endCall(db, r2.action);
    expect(comings(db).map((r) => r.npc_id)).toEqual([b.id]);
    // an older row (no player in it) is its job's holder's
    db.prepare("UPDATE npc_action SET data_json = json_remove(data_json, '$.pid') WHERE id = ?").run(r3.action);
    expect(comeHolder(db, comings(db)[0])).toBe(3);
  });

  it("a follower each: one player's follower does not stop another's; each follows his own man's place", () => {
    const { db, a, b } = town2();
    const A = ground(10, 12);
    const B = ground(-60, 12);
    syncFromClient({ people: [{ id: a.id, ...ground(20, 12) }, { id: b.id, ...ground(-70, 12) }] }, Date.now(), db);
    setOnlineIds(() => [1, 2, 3]);
    setPositionSource((id) => (id === 2 ? A : id === 3 ? B : null));
    const f2 = asPlayer(2, () => mayShadow(db, { ref: "job:501", goods: "parcel", shady: false, at: A }, () => 0));
    const f3 = asPlayer(3, () => mayShadow(db, { ref: "job:502", goods: "parcel", shady: false, at: B }, () => 0));
    expect(f2?.ok).toBe(true);
    expect(f3?.ok).toBe(true);
    if (!f2?.ok || !f3?.ok) return;
    expect(f2.npc).not.toBe(f3.npc);
    // still one at a time for each
    expect(asPlayer(2, () => mayShadow(db, { ref: "job:503", goods: "parcel", shady: false, at: A }, () => 0))).toBeNull();
    // each follower's distance is to the man he follows (the host is nowhere: he would have none)
    const s2 = shadowFacts(db, f2.action, { moving: true, carrying: true })!;
    const s3 = shadowFacts(db, f3.action, { moving: true, carrying: true })!;
    expect(s2.d).toBeLessThan(20);
    expect(s3.d).toBeLessThan(20);
  });
});

describe("M8d: the townspeople called for a job are the holder's PC's", () => {
  const host = (p: number) => p === 1;
  it("pinned to a guest: his PC takes him from the host; the host cannot take him back; others as before", () => {
    const o = new Owners();
    const pins = new Map([["r1", 2]]);
    const pinOf = (id: string) => pins.get(id) ?? null;
    o.claim(1, ["r1", "r2"], false, host, pinOf);
    expect(o.claim(2, ["r1"], true, host, pinOf).changes.map((c) => [c[1], c[2]])).toEqual([["r1", 2]]);
    expect(o.claim(1, ["r1"], true, host, pinOf).denied.map((c) => [c[1], c[2]])).toEqual([["r1", 2]]);
    expect(o.claim(3, ["r1"], true, host, pinOf).changes).toEqual([]);
    // not pinned: the host still takes from a guest near him
    o.claim(3, ["r3"], false, host, pinOf);
    expect(o.claim(1, ["r3"], true, host, pinOf).changes.map((c) => c[2])).toEqual([1]);
    // without pins: as M8b
    expect(new Owners().claim(2, ["x"], false, host).changes.length).toBe(1);
  });
});

describe("M8d: the figures of a job over the socket", () => {
  const fig = (o: Partial<FigState> = {}): FigState => ({ id: 1, kind: "thief", motion: "walk", snap: false, carrying: false, x: 1, y: 0, z: 2, yaw: 0.5, speed: 1.35, ...o });

  it("a batch goes through and back (22 bytes a figure); the server writes the sender in; junk is refused", () => {
    const b = encodeFigs(1234.5, [fig(), fig({ id: 7, kind: "recipient", motion: "fold", carrying: true, snap: true, y: 3.25, yaw: -2 })]);
    expect(b.byteLength).toBe(FIG_HEAD + 2 * FIG_BYTES);
    const bytes = new Uint8Array(b);
    expect(bytes[0]).toBe(MSG_FIGS);
    figSetSender(bytes, 513);
    const d = decodeFigs(new DataView(b))!;
    expect(d.sender).toBe(513);
    expect(d.t).toBe(1234.5);
    expect(d.list[1]).toMatchObject({ id: 7, kind: "recipient", motion: "fold", carrying: true, snap: true });
    expect(d.list[1].y).toBeCloseTo(3.25, 5);
    expect(d.list[1].yaw).toBeCloseTo(-2, 3);
    expect(d.list[0].speed).toBeCloseTo(1.35, 2);
    expect(figBatchOk(new DataView(new ArrayBuffer(5)))).toBe(false);
    expect(figBatchOk(new DataView(b.slice(0, b.byteLength - 1)))).toBe(false);
    const nan = new DataView(encodeFigs(1, [fig()]));
    nan.setFloat32(FIG_HEAD + 6, Number.NaN, true);
    expect(decodeFigs(nan)!.list).toEqual([]);
  });

  it("drawn between two states; a jump is not walked", () => {
    const s = (t: number, x: number, snap = false) => ({ ...fig({ x, snap }), t });
    expect(sampleFig([s(0, 0), s(100, 1)], 50)!.x).toBeCloseTo(0.5);
    expect(sampleFig([s(0, 0), s(100, 1)], 150)!.x).toBe(1);
    expect(sampleFig([s(0, 0), s(100, 1)], -10)!.x).toBe(0);
    expect(sampleFig([s(0, 0), s(100, 9)], 50)!.x).toBe(0);
    expect(sampleFig([s(0, 0), s(100, 1, true)], 50)!.x).toBe(0);
    expect(sampleFig([], 0)).toBeNull();
  });

  it("the holder's PC sends its figures (10 a second walking, 2 standing, a few empty ones after); the others draw them and let them go", () => {
    let now = 10_000;
    const wire: ArrayBuffer[] = [];
    const own: Array<OwnFigure & { look: ReturnType<OwnFigure["netLook"]> }> = [];
    const mk = (speed: number) => {
      const f = { look: { kind: "thief" as const, x: 5, y: 0, z: 5, yaw: 0, speed, motion: speed ? ("walk" as const) : ("idle" as const), carrying: false }, netLook() { return this.look; } };
      own.push(f);
      return f;
    };
    const holder = new JobFigs({ own: () => own, make: () => null, serverNow: () => now, player: () => ({ x: 0, z: 0 }), sendBinary: (b) => (wire.push(b), true) });
    const step = (dt: number, n: number, who: JobFigs) => {
      for (let i = 0; i < n; i++) {
        now += dt * 1000;
        who.frame(dt);
      }
    };
    // nothing to send: nothing sent
    step(0.05, 20, holder);
    expect(wire.length).toBe(0);
    const thief = mk(1.35);
    step(0.05, 20, holder); // one second walking
    expect(wire.length).toBeGreaterThanOrEqual(9);
    expect(wire.length).toBeLessThanOrEqual(11);
    thief.look = { ...thief.look, speed: 0, motion: "idle" };
    wire.length = 0;
    step(0.05, 40, holder); // two seconds standing
    expect(wire.length).toBeGreaterThanOrEqual(3);
    expect(wire.length).toBeLessThanOrEqual(5);
    // a receiver draws him
    const drawn: Array<{ placed: number; removed: boolean; x: number }> = [];
    const other = new JobFigs({
      own: () => [],
      make: () => {
        const d = { placed: 0, removed: false, x: 0 };
        drawn.push(d);
        return { netPlace: (x: number) => ((d.placed++), (d.x = x)), update: () => {}, remove: () => (d.removed = true) } satisfies DrawnFigure;
      },
      serverNow: () => now,
      player: () => ({ x: 0, z: 0 }),
      sendBinary: () => true,
    });
    const deliver = () => {
      for (const b of wire.splice(0)) {
        const bytes = new Uint8Array(b.slice(0));
        figSetSender(bytes, 2);
        other.onBatch(new DataView(bytes.buffer), now);
      }
    };
    step(0.05, 10, holder);
    deliver();
    now += FIG_DELAY_MS;
    other.frame(0.05);
    expect(drawn.length).toBe(1);
    expect(drawn[0].placed).toBeGreaterThan(0);
    expect(drawn[0].x).toBeCloseTo(5);
    // he is gone on the holder's PC: gone here once that is drawn
    own.length = 0;
    step(0.05, 40, holder);
    const empties = wire.filter((b) => new Uint8Array(b)[1] === 0).length;
    expect(empties).toBe(3);
    deliver();
    now += FIG_DELAY_MS + 50;
    other.frame(0.05);
    expect(drawn[0].removed).toBe(true);
    expect(other.report().tracks).toEqual([]);
    // the holder falls silent: his figures go
    mk(1.35);
    step(0.05, 4, holder);
    deliver();
    now += FIG_DELAY_MS;
    other.frame(0.05);
    expect(drawn.length).toBe(2);
    now += FIG_SILENT_MS + 10;
    other.frame(0.05);
    expect(drawn[1].removed).toBe(true);
    // one far off is not drawn
    const far = new JobFigs({ own: () => [], make: () => ({ netPlace() {}, update() {}, remove() {} }), serverNow: () => now, player: () => ({ x: 900, z: 900 }), sendBinary: () => true });
    step(0.05, 4, holder);
    for (const b of wire.splice(0)) {
      const bytes = new Uint8Array(b.slice(0));
      figSetSender(bytes, 2);
      far.onBatch(new DataView(bytes.buffer), now);
    }
    now += FIG_DELAY_MS;
    far.frame(0.05);
    expect(far.report().made).toBe(0);
  });
});
