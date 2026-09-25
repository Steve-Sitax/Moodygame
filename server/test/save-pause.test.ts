import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { callClaude, type Runner } from "../src/ai/claude.ts";
import { clock, resetTickLimit, tick, TICK_EVERY_MS } from "../src/day.ts";
import { devJob } from "../src/hooks/jobBoard.ts";
import { player, saveProgress, takeJob } from "../src/game.ts";
import { town } from "../src/town/store.ts";
import { callsInFlight, gateMode, gateState, isPaused, playNow, resetGate, setPaused, sweepHolders } from "../src/save/gate.ts";
import { autoSlot, listSaves, loadGame, readClientState, saveGame, setSaveDir } from "../src/save/saves.ts";
import { mountSaves } from "../src/save/routes.ts";

// M7 save and pause (Steve 2026-09-25): "When saving, wait on the AI session to finish if active,
// and block any new ones from starting, and then save. And also a pause. Same rule: finish the AI
// session in the background while the screen freezes, and use the AI result when unfrozen."
// The model is a stub (a Runner) the test lets answer when it wants.

type Db = ReturnType<typeof openDb>;
const Schema = z.object({ text: z.string() });
const ask = (db: Db, runner: Runner, hook = "test_hook") => callClaude(db, { hook, system: "s", prompt: "p", schema: Schema }, runner);
const probe = (db: Db) => (db.prepare("SELECT value_json FROM world_state WHERE key = 'probe'").get() as { value_json: string } | undefined)?.value_json ?? null;
const setProbe = (db: Db, v: string) =>
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('probe', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(v));
const later = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** A model that answers when the test says so; `asked` counts the calls that reached it. */
function held(text: string) {
  let answer!: () => void;
  const gate = new Promise<void>((r) => (answer = r));
  const s = { asked: 0, answer, runner: (async () => {
    s.asked++;
    await gate;
    return { output: { text } };
  }) as Runner };
  return s;
}

/** Ask, and apply the answer the way a hook does: after the call returns. */
async function askAndApply(db: Db, runner: Runner, hook?: string): Promise<string | null> {
  const r = await ask(db, runner, hook);
  if (r.ok && r.data) setProbe(db, r.data.text);
  return r.ok ? r.data!.text : null;
}

const readSave = (file: string, sql: string) => {
  const d = new Database(file, { readonly: true });
  try {
    return d.prepare(sql).get();
  } finally {
    d.close();
  }
};

let dir = "";
beforeEach(() => {
  resetGate();
  resetTickLimit();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-saves-"));
  setSaveDir(dir);
});
afterEach(() => {
  resetGate();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("M7 save: the gate waits for the model", () => {
  it("a call in flight when saving: the save waits for it, and its answer is in the save", async () => {
    const db = openDb(":memory:");
    const m = held("the answer that was on its way");
    const call = askAndApply(db, m.runner);
    await later();
    expect(m.asked).toBe(1);
    expect(callsInFlight()).toBe(1);
    let saved = false;
    const save = saveGame(db, { slot: "slot1" }).then((r) => {
      saved = true;
      return r;
    });
    await later(80);
    expect(gateMode()).toBe("saving");
    expect(saved).toBe(false); // still waiting on the model
    m.answer();
    const r = await save;
    await call;
    expect(r.ok).toBe(true);
    expect(gateMode()).toBe("open");
    // the answer was applied before the copy: it is in the save file
    const row = readSave(path.join(dir, "slot1.sqlite"), "SELECT value_json FROM world_state WHERE key = 'probe'") as { value_json: string } | undefined;
    expect(row?.value_json).toBe(JSON.stringify("the answer that was on its way"));
  });

  it("a call asked while saving does not start until the save is written, then runs", async () => {
    const db = openDb(":memory:");
    const first = held("first");
    const firstCall = askAndApply(db, first.runner, "hook_a");
    await later();
    const save = saveGame(db, { slot: "slot2" });
    await later();
    const second = held("second");
    const secondCall = askAndApply(db, second.runner, "hook_b");
    await later(60);
    expect(second.asked).toBe(0); // blocked at the gate
    first.answer();
    const r = await save;
    expect(r.ok).toBe(true);
    // the save has the first answer, not the second
    const row = readSave(path.join(dir, "slot2.sqlite"), "SELECT value_json FROM world_state WHERE key = 'probe'") as { value_json: string };
    expect(row.value_json).toBe(JSON.stringify("first"));
    await firstCall;
    await later();
    expect(second.asked).toBe(1); // the gate opened: it started
    second.answer();
    expect(await secondCall).toBe("second");
    expect(probe(db)).toBe(JSON.stringify("second"));
  });

  it("a quiet autosave never holds the game up: with a call in flight it is put off", async () => {
    const db = openDb(":memory:");
    const m = held("busy");
    const call = askAndApply(db, m.runner);
    await later();
    const r = await saveGame(db, { slot: "auto", quiet: true, quietMs: 100 });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.deferred).toBe(true);
    expect(gateMode()).toBe("open");
    m.answer();
    await call;
    const r2 = await saveGame(db, { slot: "auto", quiet: true, quietMs: 100 });
    expect(r2.ok).toBe(true);
  });

  it("autosaves take turns, but one minute is never kept twice", async () => {
    const db = openDb(":memory:");
    expect(autoSlot(db)).toBe("auto1");
    await saveGame(db, { slot: "auto" });
    // the same minute again: the same autosave is written over
    expect(autoSlot(db)).toBe("auto1");
    db.prepare("UPDATE player SET minute = minute + 5 WHERE id = 1").run();
    expect(autoSlot(db)).toBe("auto2");
    await saveGame(db, { slot: "auto" });
    db.prepare("UPDATE player SET minute = minute + 5 WHERE id = 1").run();
    // the older of the two goes
    expect(autoSlot(db)).toBe("auto1");
    expect(listSaves().map((s) => s.slot).sort()).toEqual(["auto1", "auto2"]);
  });
});

describe("M7 pause: nothing moves, the answers wait", () => {
  it("a tick does nothing while paused, and the clock goes on from where it stood after", () => {
    const db = openDb(":memory:");
    const before = clock(db);
    setPaused("tab", true);
    expect(tick(db, 1_000_000).advanced).toBe(false);
    expect(tick(db, 1_000_000 + TICK_EVERY_MS * 5).advanced).toBe(false);
    expect(clock(db)).toEqual(before);
    setPaused("tab", false);
    // no catching up: one tick, five minutes
    expect(tick(db, 1_000_000 + TICK_EVERY_MS * 6).advanced).toBe(true);
    const after = clock(db);
    expect(after.hour * 60 + after.minute - (before.hour * 60 + before.minute)).toBe(5);
  });

  it("an answer that comes back during the pause is applied only after it", async () => {
    const db = openDb(":memory:");
    const m = held("a reply in the street");
    const call = askAndApply(db, m.runner);
    await later();
    setPaused("tab", true);
    m.answer();
    await later(80);
    expect(probe(db)).toBe(null); // queued: nothing reaches the town while paused
    expect(callsInFlight()).toBe(1);
    setPaused("tab", false);
    expect(await call).toBe("a reply in the street");
    expect(probe(db)).toBe(JSON.stringify("a reply in the street"));
  });

  it("no new call starts during the pause; it starts after, with its full time", async () => {
    const db = openDb(":memory:");
    setPaused("tab", true);
    const m = held("after the pause");
    const call = askAndApply(db, m.runner);
    await later(60);
    expect(m.asked).toBe(0);
    setPaused("tab", false);
    await later();
    expect(m.asked).toBe(1);
    m.answer();
    expect(await call).toBe("after the pause");
  });

  it("saving while paused lets a held answer through into the save; the game stays paused", async () => {
    const db = openDb(":memory:");
    const m = held("held, then saved");
    const call = askAndApply(db, m.runner);
    await later();
    setPaused("tab", true);
    m.answer();
    await later(40);
    expect(probe(db)).toBe(null);
    const r = await saveGame(db, { slot: "slot3" });
    await call;
    expect(r.ok).toBe(true);
    expect(isPaused()).toBe(true);
    const row = readSave(path.join(dir, "slot3.sqlite"), "SELECT value_json FROM world_state WHERE key = 'probe'") as { value_json: string };
    expect(row.value_json).toBe(JSON.stringify("held, then saved"));
  });

  it("the pause is held per tab: two holders, both must let go; a tab gone quiet is let go", () => {
    setPaused("a", true, 0);
    setPaused("b", true, 0);
    setPaused("a", false, 10);
    expect(isPaused()).toBe(true);
    expect(sweepHolders(new Set(["a"]), 60_000, 30_000)).toEqual([]);
    expect(sweepHolders(new Set(["a"]), 60_000, 61_000)).toEqual(["b"]);
    expect(isPaused()).toBe(false);
  });

  it("the play clock stands still while paused (real-second timers of the engine)", () => {
    const t0 = playNow(1_000);
    setPaused("tab", true, 1_000);
    expect(playNow(50_000)).toBe(t0);
    setPaused("tab", false, 50_000);
    expect(playNow(51_000)).toBe(t0 + 1_000);
  });

  it("the routes: a tick while paused says so and moves nothing; pause and unpause by a tab", async () => {
    const db = openDb(":memory:");
    const app = new Hono();
    const sent: unknown[] = [];
    mountSaves(app, { db, payload: () => ({ clock: clock(db) }), broadcast: (m) => sent.push(m), afterLoad: () => {} });
    app.post("/api/tick", (c) => c.json({ ...tick(db) }));
    const post = (url: string, body?: unknown) =>
      app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const before = clock(db);
    await post("/api/pause", { on: true, client: "tab1" });
    expect(gateState().paused).toBe(true);
    const r = (await (await post("/api/tick")).json()) as { advanced: boolean; paused?: boolean };
    expect(r).toMatchObject({ advanced: false, paused: true });
    expect(clock(db)).toEqual(before);
    expect(sent).toContainEqual({ type: "gate", paused: true, mode: "open", in_flight: 0 });
    await post("/api/pause", { on: false, client: "tab1" });
    const r2 = (await (await post("/api/tick")).json()) as { advanced: boolean };
    expect(r2.advanced).toBe(true);
  });
});

describe("M7 load: everything back", () => {
  it("save, change things, load: the clock, money, needs, the job's progress, memories and the browser's part are as saved", async () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE player SET day = 3, hour = 13, minute = 35, money_c = 420, food = 6 WHERE id = 1").run();
    const job = devJob(db, { type: "carry", items: 2 }) as { id: number };
    takeJob(db, job.id);
    saveProgress(db, job.id, { delivered: 1, lost: 0, sold: 0 });
    db.prepare("INSERT INTO npc_memory (npc_id, text, source, weight, day) VALUES ('sooi', 'Jef carried one sack well.', 'seen', 5, 3)").run();
    const residents = town(db).town.residents.length;
    const client = {
      v: 1,
      clock: { day: 3, hour: 13, minute: 39 },
      place: "Grote Markt",
      pose: { x: -254.5, z: 90.25, y: 0, yaw: 1.2, pitch: -0.1, swimming: false },
      job: { id: job.id, carried: { kind: "sack", jobId: job.id } },
    };
    const s = await saveGame(db, { slot: "slot1", label: "Before the Vismarkt", client });
    expect(s.ok).toBe(true);
    // the minute on screen (13:39, within the tick) is the save's
    expect(s.ok && s.info).toMatchObject({ day: 3, weekday: "Wednesday", hour: 13, minute: 39, place: "Grote Markt", money_c: 420, label: "Before the Vismarkt", kind: "slot" });

    // play on: time, money, the job, a memory gone, the client somewhere else
    db.prepare("UPDATE player SET day = 4, hour = 9, minute = 10, money_c = 5, food = 1 WHERE id = 1").run();
    saveProgress(db, job.id, { delivered: 1, lost: 1, sold: 0 });
    db.prepare("DELETE FROM npc_memory WHERE text = 'Jef carried one sack well.'").run();
    db.prepare("UPDATE client_state SET state_json = '{}'").run();

    const l = await loadGame(db, "slot1");
    expect(l.ok).toBe(true);
    expect(clock(db)).toMatchObject({ day: 3, hour: 13, minute: 39 });
    expect(player(db)).toMatchObject({ money_c: 420, food: 6 });
    const task = JSON.parse((db.prepare("SELECT task_json FROM job WHERE id = ?").get(job.id) as { task_json: string }).task_json) as { progress?: unknown };
    expect(task.progress).toEqual({ delivered: 1, lost: 0, sold: 0 });
    expect((db.prepare("SELECT status FROM job WHERE id = ?").get(job.id) as { status: string }).status).toBe("taken");
    expect(db.prepare("SELECT 1 FROM npc_memory WHERE text = 'Jef carried one sack well.'").get()).toBeTruthy();
    expect(l.ok && l.client).toMatchObject({ place: "Grote Markt", pose: { x: -254.5, z: 90.25, yaw: 1.2 }, job: { id: job.id, carried: { kind: "sack" } } });
    expect(readClientState(db)).toMatchObject({ clock: { minute: 39 } });
    // the town comes back from the save, not from a cache
    expect(town(db).town.residents.length).toBe((db.prepare("SELECT COUNT(*) n FROM resident").get() as { n: number }).n);
    expect(residents).toBeGreaterThan(100);
    // the list shows it
    expect(listSaves()[0]).toMatchObject({ slot: "slot1", weekday: "Wednesday", hour: 13, minute: 39 });
  });

  it("a load in the middle of a model call: the call is let finish first, and its late words do not land in the loaded game", async () => {
    const db = openDb(":memory:");
    await saveGame(db, { slot: "slot4" });
    const m = held("from the game before the load");
    const call = askAndApply(db, m.runner);
    await later();
    const load = loadGame(db, "slot4");
    await later(40);
    expect(gateMode()).toBe("loading");
    m.answer();
    await call;
    expect((await load).ok).toBe(true);
    // the answer was written before the load, and the load put the save back over it
    expect(probe(db)).toBe(null);
  });

  it("a save of the client state is checked: bad shapes and huge ones are refused, numbers kept in bounds", async () => {
    const db = openDb(":memory:");
    await saveGame(db, { slot: "slot5", client: { v: 1, pose: { x: 99999, z: -5, y: 0, yaw: 0, pitch: 9 } } });
    expect(readClientState(db)?.pose).toMatchObject({ x: 2000, pitch: 1.6 });
    await saveGame(db, { slot: "slot5", client: { v: 2, pose: {} } });
    expect(readClientState(db)?.pose.x).toBe(2000); // the bad one was not written
    await saveGame(db, { slot: "slot5", client: { v: 1, pose: { x: 1, z: 1, y: 0, yaw: 0, pitch: 0 }, junk: "x".repeat(70_000) } });
    expect(readClientState(db)?.pose.x).toBe(2000);
  });

  it("loading a slot with no save says so and changes nothing", async () => {
    const db = openDb(":memory:");
    const before = player(db);
    const r = await loadGame(db, "slot2");
    expect(r).toMatchObject({ ok: false, error: "no such save" });
    expect(player(db)).toEqual(before);
    expect(gateMode()).toBe("open");
  });
});
