import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db.ts";
import { finishJob, takeJob } from "../src/game.ts";
import { devJob } from "../src/hooks/jobBoard.ts";
import { actionOf, activeActions, resetSync, startAction, syncFromClient } from "../src/director/actions.ts";
import { town } from "../src/town/store.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { ensureStanding, policeShift } from "../src/town/standing.ts";
import {
  callGang,
  callResponder,
  candidates,
  comings,
  endCall,
  mayShadow,
  pickResponder,
  policeWithin,
  shadowFacts,
  shadowStep,
  SHADOW_GAP,
  urgentFor,
  type ShadowFacts,
} from "../src/town/walkup.ts";
import { callTrouble, maybeTrouble, troubleOf } from "../src/ideas/trouble.ts";
import { resetGangRoll, rollGang, setGangDice, clearGangs } from "../src/night/gangs.ts";
import { activityAt } from "../src/town/schedule.ts";

// M7 walk-up (Steve 2026-09-26: "those people should always be around and walk up, or run if they think it
// is urgent"). The ENGINE picks who comes (nearest fitting, on duty, free, reachable), says wait when nobody
// is near, and rules the followers. No model is called here.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const JEF = { x: 10, z: 12 };
/** Open ground at about this point (the walk map's). */
const ground = (x: number, z: number) => {
  const q = walkMap().nearestOpen(x, z, 8);
  if (!q) throw new Error(`no ground near ${x}, ${z}`);
  return q;
};
/** The client's word on where people stand (fresh for 15 s). */
const place = (db: Db, jef: { x: number; z: number }, people: Array<{ id: string; x: number; z: number }>) => syncFromClient({ x: jef.x, z: jef.z, people }, Date.now(), db);
const byTrade = (db: Db, trade: string) => town(db).town.residents.filter((r) => r.trade === trade);
const onDuty = (db: Db, trade: string) => {
  const c = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return byTrade(db, trade).filter((r) => activityAt(r.sched, c.day, c.hour + c.minute / 60).act === "work");
};

// every test opens a whole town (a new game): slow when the machine is busy
vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  resetSync();
  resetGangRoll();
});
afterEach(() => setGangDice(null));

describe("M7 walk-up: the standing roles", () => {
  it("customs at the Entrepot, the lock and by night; a day and a night agent on every beat; thieves on the quays", () => {
    const db = openDb(":memory:");
    const t = town(db).town;
    const wu = t.residents.filter((r) => /^wu\d+$/.test(r.id));
    expect(wu.length).toBeGreaterThan(0);
    const customs = t.residents.filter((r) => r.trade === "customs");
    expect(customs.some((r) => r.work.place === "entrepot")).toBe(true);
    expect(customs.some((r) => r.work.place === "lock")).toBe(true);
    expect(customs.some((r) => policeShift(r) === "night")).toBe(true);
    const police = t.residents.filter((r) => r.trade === "police");
    for (const beat of ["quays", "town", "werf", "bassin"])
      for (const shift of ["day", "night"]) expect(police.some((p) => p.work.place === beat && policeShift(p) === shift), `${beat} ${shift}`).toBe(true);
    const thieves = t.residents.filter((r) => r.trade === "thief");
    for (const quay of ["rijnkaai", "werf"]) expect(thieves.some((r) => r.sched.day.some((s) => s[2] === "loiter" && s[3] === quay)), quay).toBe(true);
    // always a path: every point of their rounds is ground you can walk to
    const wm = walkMap();
    for (const r of wu) for (const [x, z] of r.work.route ?? []) expect(wm.reachable(x, z), `${r.name} ${x},${z}`).toBe(true);
    // once: a second run adds nobody
    expect(ensureStanding(db)).toBe(0);
  });

  it("at every hour of a weekday a customs man and an agent are at work somewhere", () => {
    const db = openDb(":memory:");
    for (let h = 0; h < 24; h++) {
      setClock(db, 2, h, 30);
      expect(onDuty(db, "customs").length, `customs at ${h}:30`).toBeGreaterThan(0);
      expect(onDuty(db, "police").length, `police at ${h}:30`).toBeGreaterThan(0);
    }
  });
});

describe("M7 walk-up: picking who comes", () => {
  it("the nearest fitting, on duty, free and reachable", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const [a, b] = onDuty(db, "customs");
    const near = ground(18, 14);
    const far = ground(-28, 14);
    place(db, JEF, [
      { id: a.id, ...far },
      { id: b.id, ...near },
    ]);
    expect(pickResponder(db, "customs", JEF)?.r.id).toBe(b.id);
    // busy (an errand of his own): the next one
    startAction(db, { npc_id: b.id, kind: "go_to", target: "x", source: "talk", minutes: 30 });
    const next = pickResponder(db, "customs", JEF);
    expect(next?.r.id).not.toBe(b.id);
    expect(next).not.toBeNull();
    // never a thief for the customs, never the off-duty
    expect(candidates(db, "customs", JEF).every((c) => c.r.trade === "customs")).toBe(true);
    setClock(db, 2, 3);
    expect(candidates(db, "customs", JEF, { maxM: 5000 }).every((c) => policeShift(c.r) === "night")).toBe(true);
  });

  it("someone standing where no one can walk to is never sent (always a path)", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const [a] = onDuty(db, "customs");
    // out on the open river
    place(db, JEF, [{ id: a.id, x: 0, z: -60 }]);
    expect(walkMap().nearestOpen(0, -60, 4)).toBeNull();
    expect(candidates(db, "customs", JEF, { maxM: 5000 }).some((c) => c.r.id === a.id)).toBe(false);
  });

  it("the call sends one (a 'come' row), the same one again for the same need, and runs only when urgent", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const res = callResponder(db, { role: "police", why: "crime", ref: "quest:test:1", at: JEF, maxM: 5000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.urgent).toBe(true);
    expect(town(db).byId.get(res.npc)?.trade).toBe("police");
    expect(actionOf(db, res.npc)?.kind).toBe("come");
    const again = callResponder(db, { role: "police", why: "crime", ref: "quest:test:1", at: JEF, maxM: 5000 });
    expect(again.ok && again.npc).toBe(res.npc);
    expect(comings(db)).toHaveLength(1);
    expect(urgentFor("hand", "trouble")).toBe(false);
    expect(urgentFor("customs", "contraband")).toBe(true);
    expect(urgentFor("customs", "trouble")).toBe(false);
    expect(endCall(db, res.action)).toBe(true);
    expect(actionOf(db, res.npc)).toBeNull();
  });

  it("no one near enough: wait, never someone made up", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const n = activeActions(db).length;
    const res = callResponder(db, { role: "customs", why: "trouble", ref: "job:1:trouble", at: JEF, maxM: 1 });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.wait).toBe(true);
    expect(activeActions(db).length).toBe(n);
  });

  it("a job's calls end when the job is settled", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const j = devJob(db, { type: "watch", twist: "thief" });
    takeJob(db, j.id);
    const res = callResponder(db, { role: "thief", why: "twist", ref: `job:${j.id}:thief`, at: JEF, maxM: 5000 });
    expect(res.ok).toBe(true);
    finishJob(db, j.id, { delivered: 0, lost: 0, sold: 0, pocketed: false, late: false, left_post_s: 0, thief: "chased", bribe_taken: false, seen_away: false });
    expect(comings(db)).toHaveLength(0);
  });
});

describe("M7 walk-up: the trouble's person comes", () => {
  it("customs: the nearest officer on duty is sent and named in the scene; the stowaway needs nobody", async () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const j = devJob(db, { type: "carry", goods: "crates" });
    takeJob(db, j.id);
    const t = await maybeTrouble(db, j.id, { force: "customs", rng: () => 0.5 });
    expect(t).not.toBeNull();
    const officers = onDuty(db, "customs");
    const near = officers[officers.length - 1];
    place(db, JEF, [{ id: near.id, ...ground(18, 14) }]);
    const res = callTrouble(db, t!.id, JEF);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.npc).toBe(near.id);
    const cast = JSON.parse(troubleOf(db, j.id)!.cast_json) as Array<{ id: string; name: string }>;
    expect(cast[0].id).toBe(near.id);
    expect(cast[0].name).toBe(near.name);
    // the stowaway is in the crate already
    const db2 = openDb(":memory:");
    setClock(db2, 2, 10);
    const j2 = devJob(db2, { type: "carry", goods: "crates" });
    takeJob(db2, j2.id);
    const t2 = await maybeTrouble(db2, j2.id, { force: "stowaway", rng: () => 0.5 });
    expect(callTrouble(db2, t2!.id, JEF)).toEqual({ ok: false, none: true });
  });
});

describe("M7 walk-up: another officer comes: his name goes into the model's words", () => {
  it("the planned officer is busy; the nearest free one is sent and named in the scene and lines", async () => {
    const db = openDb(":memory:");
    setClock(db, 2, 10);
    const j = devJob(db, { type: "carry", goods: "crates" });
    takeJob(db, j.id);
    const officers = onDuty(db, "customs");
    // the plan picks the nearest to where Jef is: put one there, and another a little further
    const [planned, other] = officers;
    place(db, JEF, [
      { id: planned.id, ...ground(18, 14) },
      { id: other.id, ...ground(-6, 15) },
    ]);
    const words = {
      scene: `${planned.name} steps into your way and holds up a gloved hand. ${planned.first} reads the marks.`,
      lines: [{ who: 0, text: "Papers for this, if you please." }],
      options: [
        { n: 1, label: "Wait while he checks", after: "He takes his time.", after_bad: "" },
        { n: 2, label: "Fetch the papers", after: "All in order.", after_bad: "" },
        { n: 3, label: "Slip him 10 centimes", after: "The coins vanish.", after_bad: "He told his sergeant." },
      ],
    };
    const t = await maybeTrouble(db, j.id, { force: "customs", rng: () => 0.5, runner: async () => ({ output: words }) });
    expect(JSON.parse(t!.cast_json)[0].id).toBe(planned.id);
    expect(t!.words_json).toContain(planned.name);
    // by the time it is due he is off on an errand of his own
    startAction(db, { npc_id: planned.id, kind: "go_to", target: "x", source: "talk", minutes: 30 });
    const res = callTrouble(db, t!.id, JEF);
    expect(res.ok && res.npc).toBe(other.id);
    const after = troubleOf(db, j.id)!;
    expect(JSON.parse(after.cast_json)[0].name).toBe(other.name);
    expect(after.words_json).toContain(other.name);
    expect(after.words_json).not.toContain(planned.name);
    if (planned.first !== other.first) expect(after.words_json).not.toMatch(new RegExp(`\\b${planned.first}\\b`));
  });
});

describe("M7 walk-up: followers", () => {
  const f = (over: Partial<ShadowFacts> = {}): ShadowFacts => ({ hour: 11, d: 18, jefMoving: true, peopleNear: 6, policeNear: false, carrying: true, role: "thief", ...over });

  it("the engine's steps: keep his distance, linger, close in when dark or quiet, break off", () => {
    const keep = shadowStep(f());
    expect(keep.kind).toBe("keep");
    if (keep.kind === "keep") {
      expect(keep.gap).toBeGreaterThanOrEqual(SHADOW_GAP[0]);
      expect(keep.gap).toBeLessThanOrEqual(SHADOW_GAP[1]);
    }
    expect(shadowStep(f({ jefMoving: false })).kind).toBe("linger");
    expect(shadowStep(f({ hour: 22 })).kind).toBe("close_in");
    expect(shadowStep(f({ hour: 4.5 })).kind).toBe("close_in");
    expect(shadowStep(f({ peopleNear: 1 })).kind).toBe("close_in");
    expect(shadowStep(f({ carrying: false }))).toEqual({ kind: "break_off", why: "no load" });
    // an agent in sight: the thief breaks off, even in the dark; the customs man does not care
    expect(shadowStep(f({ policeNear: true, hour: 22 }))).toEqual({ kind: "break_off", why: "police" });
    expect(shadowStep(f({ policeNear: true, hour: 22, role: "customs" })).kind).toBe("close_in");
    expect(shadowStep(f({ d: 120 }))).toEqual({ kind: "break_off", why: "lost him" });
  });

  it("a thief who sees a valuable load may follow; once a job; not for sacks; not when none is near", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 12);
    const thief = byTrade(db, "thief").find((r) => activityAt(r.sched, 2, 12).act !== "home")!;
    expect(thief).toBeTruthy();
    const at = ground(18, 14);
    place(db, JEF, [{ id: thief.id, ...ground(30, 14) }]);
    const r = mayShadow(db, { ref: "job:77", goods: "parcel", shady: false, at }, () => 0);
    expect(r?.ok).toBe(true);
    expect(r && r.ok && r.npc).toBe(thief.id);
    if (r && r.ok) endCall(db, r.action);
    // rolled once per job
    expect(mayShadow(db, { ref: "job:77", goods: "parcel", shady: false, at }, () => 0)).toBeNull();
    // sacks are not worth it
    expect(mayShadow(db, { ref: "job:78", goods: "sacks", shady: false, at }, () => 0)).toBeNull();
    // nobody within sight of the load
    resetSync();
    const far = openDb(":memory:");
    setClock(far, 2, 12);
    for (const t of byTrade(far, "thief")) place(far, JEF, [{ id: t.id, ...ground(-250, 12) }]);
    expect(mayShadow(far, { ref: "job:79", goods: "parcel", shady: false, at }, () => 0)).toBeNull();
  });
});

describe("M7 walk-up: police patrols notice (only who is really there)", () => {
  it("an agent the client saw near Jef counts; the schedule's guess of a round does not; the follower's facts carry it", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 21, 30);
    const agent = onDuty(db, "police")[0];
    place(db, JEF, []);
    expect(policeWithin(db, JEF)).toBeNull();
    const thief = byTrade(db, "thief").find((r) => activityAt(r.sched, 2, 21.5).act !== "home")!;
    place(db, JEF, [{ id: thief.id, ...ground(30, 14) }]);
    const r = mayShadow(db, { ref: "job:90", goods: "parcel", shady: false, at: JEF }, () => 0);
    expect(r?.ok).toBe(true);
    const id = r && r.ok ? r.action : -1;
    // dark and nobody about: he closes in
    expect(shadowStep(shadowFacts(db, id, { moving: true, carrying: true })!).kind).toBe("close_in");
    // an agent comes round the corner: he breaks off
    place(db, JEF, [{ id: agent.id, ...ground(20, 14) }]);
    expect(policeWithin(db, JEF)).toBe(agent.id);
    expect(shadowStep(shadowFacts(db, id, { moving: true, carrying: true })!)).toEqual({ kind: "break_off", why: "police" });
  });
});

describe("M7 walk-up: the gang are the town's thieves", () => {
  it("the lads who come are thieves out near Jef, nearest first, reserved while it lasts", () => {
    const db = openDb(":memory:");
    setClock(db, 2, 23);
    clearGangs(db);
    const out = byTrade(db, "thief").filter((r) => activityAt(r.sched, 2, 23).act !== "home");
    expect(out.length).toBeGreaterThanOrEqual(2);
    const spots = [ground(30, 14), ground(-10, 14), ground(40, 14)];
    place(db, JEF, out.slice(0, 3).map((r, i) => ({ id: r.id, ...spots[i] })));
    const g = rollGang(db, { x: JEF.x, z: JEF.z }, Date.now(), true);
    expect(g).not.toBeNull();
    expect(g!.lads!.length).toBeGreaterThanOrEqual(2);
    for (const id of g!.lads!) expect(town(db).byId.get(id)?.trade).toBe("thief");
    expect(callGang(db, `gang:${g!.id}`, JEF)).toEqual(g!.lads);
    for (const id of g!.lads!) expect(actionOf(db, id)?.kind).toBe("come");
  });
});
