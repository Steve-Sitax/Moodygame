import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { DB } from "../src/db.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer } from "../src/player/current.ts";
import { ensurePlayerRow, pstate } from "../src/player/multi.ts";
import { player, takeJob } from "../src/game.ts";
import { applyHour, countNight, endGame, ending, markDayStart, nightsSlept, playerDayStart, playerHour, resetTickLimit, setWeather, swim } from "../src/day.ts";
import { buy, needs, pockets, useItem } from "../src/trade.ts";
import { board, riding } from "../src/ride.ts";
import { berthOf, hireBoat, LANDINGS, resetRowClock, rowing, rowState } from "../src/rowing.ts";
import { clearRests, restOf, startRest, wakeRest } from "../src/rest.ts";
import { forgetWhere, reportWhere, whereNow } from "../src/warmth.ts";
import { arrivalStage, setArrivalStage } from "../src/arrival.ts";
import { buildPrompt, gateText, markFreeLine, openTalk, resetTalks, type Line } from "../src/hooks/dialogue.ts";
import { jobsDone } from "../src/hooks/loads.ts";
import { devJob, listJobs, maxTier } from "../src/hooks/jobBoard.ts";
import { relationship } from "../src/npcs.ts";
import type { Runner } from "../src/ai/claude.ts";
import { readClientState, setSaveDir, writeClientState } from "../src/save/saves.ts";
import { mountSaves } from "../src/save/routes.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M8c "each his own man" (docs/milestones/M8c-rules.md), the server's top-level files, hooks and saves: what a
// guest does (asPlayer(2)) is his own: his money, pockets, needs, ride, boat, sleep, end of the week, talk and
// client state; the host's stay as they were.

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);

function fresh(): DB {
  const db = blankSave();
  ensurePlayerRow(db, GUEST, "Anna");
  return db;
}
const row = (db: DB, id: number) =>
  db.prepare("SELECT money_c, food, warmth, health, sleep, rent_paid_until FROM player WHERE id = ?").get(id) as {
    money_c: number;
    food: number;
    warmth: number;
    health: number;
    sleep: number;
    rent_paid_until: number;
  };
const setClock = (db: DB, day: number, hour: number) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = 0 WHERE id = 1").run(day, hour);

beforeEach(() => {
  resetTickLimit();
  resetRowClock();
  resetTalks();
  clearRests();
  forgetWhere();
});

describe("M8c core: a guest's own things", () => {
  it("buying and eating: the guest's money and pockets, the host's untouched", () => {
    const db = fresh();
    const host = row(db, 1);
    const r = as2(() => buy(db, "fientje", "herring"));
    expect(r.price_c).toBe(5);
    expect(row(db, GUEST).money_c).toBe(45);
    expect(row(db, 1).money_c).toBe(host.money_c);
    expect(pockets(db)).toEqual([]);
    const mine = as2(() => pockets(db));
    expect(mine.map((p) => p.kind)).toEqual(["herring"]);
    // the host cannot eat the guest's herring; the guest can
    expect(() => useItem(db, mine[0].id)).toThrow(/not in your pockets/);
    const before = as2(() => needs(db));
    as2(() => useItem(db, mine[0].id));
    expect(as2(() => needs(db)).food).toBeGreaterThan(before.food);
    expect(as2(() => pockets(db))).toEqual([]);
    expect(needs(db)).toMatchObject({ food: host.food, warmth: host.warmth, health: host.health });
    // his lines of the log are his, with his name
    const lines = db.prepare("SELECT player_id, text FROM log WHERE verb IN ('bought', 'ate') ORDER BY id").all() as Array<{ player_id: number; text: string }>;
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.player_id === GUEST && !/^Jef /.test(l.text))).toBe(true);
  });

  it("the hour's needs, a swim, the day's mark and the nights are each player's own", () => {
    const db = fresh();
    const host = row(db, 1);
    as2(() => applyHour(db, 6)); // food -1 and sleep -1 at 6:00
    expect(row(db, GUEST)).toMatchObject({ food: 6, sleep: 6 });
    expect(row(db, 1)).toEqual(host);
    // a swim: his warmth, his wet coat; the host's own dip is not held up by the guest's
    const warm = row(db, GUEST).warmth;
    expect(as2(() => swim(db, 100_000)).cold).toBe(true);
    expect(row(db, GUEST).warmth).toBe(warm - 1);
    expect(as2(() => pstate<number>(db, "swam_at"))).not.toBeNull();
    expect(pstate<number>(db, "swam_at")).toBeNull();
    expect(swim(db, 100_500).cold).toBe(true);
    expect(row(db, 1).warmth).toBe(host.warmth - 1);
    // the day's money mark and the nights slept
    db.prepare("UPDATE player SET money_c = 77 WHERE id = ?").run(GUEST);
    as2(() => markDayStart(db));
    expect(as2(() => pstate<number>(db, "day_start_money"))).toBe(77);
    expect(pstate<number>(db, "day_start_money")).not.toBe(77);
    as2(() => countNight(db));
    expect(as2(() => nightsSlept(db))).toBe(1);
    expect(nightsSlept(db)).toBe(0);
  });

  it("playerHour and playerDayStart: a guest's end is his own", () => {
    const db = fresh();
    db.prepare("UPDATE player SET health = 1, food = 0 WHERE id = ?").run(GUEST);
    const r = as2(() => playerHour(db, 9)); // a need at 0 costs health at every 3rd hour
    expect(r.ended?.kind).toBe("health");
    expect(as2(() => ending(db))?.kind).toBe("health");
    expect(ending(db)).toBeNull();
    // his week is over: nothing more for him that hour; the host plays on
    expect(as2(() => playerHour(db, 12))).toEqual({});
    expect(playerHour(db, 10)).toEqual({});
    // Sunday past: each player's week ends; an ended one keeps his own end
    expect(playerDayStart(db, true)?.kind).toBe("week");
    expect(as2(() => playerDayStart(db, true))?.kind).toBe("health");
    // the host's end came through endGame as before
    expect(ending(db)?.kind).toBe("week");
    as2(() => endGame(db, "week"));
    expect(ending(db)?.kind).toBe("week");
  });

  it("the omnibus: the guest's fare and ticket", () => {
    const db = fresh();
    const host = row(db, 1).money_c;
    as2(() => board(db, "werf", "kaaien"));
    expect(as2(() => riding(db))).toBe(true);
    expect(riding(db)).toBe(false);
    expect(row(db, GUEST).money_c).toBe(45);
    expect(row(db, 1).money_c).toBe(host);
    // the host boards on his own ticket
    board(db, "werf", "kaaien");
    expect(riding(db)).toBe(true);
  });

  it("a rowing boat: the guest's hire and money", () => {
    const db = fresh();
    setClock(db, 1, 10);
    setWeather(db, "fog");
    const host = row(db, 1).money_c;
    const [x, z] = berthOf(LANDINGS.rijnkaai.flight).landing;
    as2(() => hireBoat(db, "rijnkaai", x, z));
    expect(as2(() => rowing(db))).toBe(true);
    expect(as2(() => rowState(db)).hire?.landing).toBe("rijnkaai");
    expect(rowing(db)).toBe(false);
    expect(rowState(db).hire).toBeNull();
    expect(row(db, 1).money_c).toBe(host);
    expect(row(db, GUEST).money_c).toBe(40);
  });

  it("sleep: the guest's rest is his own", () => {
    const db = fresh();
    setClock(db, 2, 12);
    const doss = CITY.doors.doss as { x: number; z: number; out: number[] };
    const pos = { x: doss.x + doss.out[0] * 1.2, z: doss.z + doss.out[1] * 1.2 };
    as2(() => startRest(db, { place: "doss", hours: 2, pos }));
    expect(as2(() => restOf(db))?.place).toBe("doss");
    expect(restOf(db)).toBeNull();
    expect(wakeRest(db)).toBeNull();
    expect(as2(() => wakeRest(db))?.reason).toBe("up");
  });

  it("where he stands (warmth), and the ferry, per player", () => {
    const db = fresh();
    setClock(db, 2, 12);
    const now = 1_000_000;
    as2(() => reportWhere({ at: "church:carolus" }, now));
    expect(as2(() => whereNow(db, now)).shelter).toBe("sheltered");
    expect(whereNow(db, now).shelter).toBe("outside");
    expect(arrivalStage(db)).toBe("ferry");
    expect(as2(() => arrivalStage(db))).toBe("ashore");
    as2(() => setArrivalStage(db, "ferry"));
    setArrivalStage(db, "ashore");
    expect(as2(() => arrivalStage(db))).toBe("ferry");
    expect(arrivalStage(db)).toBe("ashore");
  });

  it("talk: each player's meeting, standing and wait for a typed line", async () => {
    const db = fresh();
    const line: Line = {
      npc_line: "Goed. You look like you can carry.",
      mood: "neutral",
      choices: ["Yes, baas.", "I can carry more than you think.", "Maybe."],
      trust_delta: 2,
      memory_note: "",
      memory_weight: 3,
      view_of_player: "A girl who wants work.",
      end_conversation: false,
    };
    const reply: Runner = async () => ({ output: line });
    const hostRel = relationship(db, "sooi");
    await as2(() => openTalk(db, "sooi", reply));
    const guestRel = as2(() => relationship(db, "sooi"));
    expect(guestRel).toMatchObject({ times_met: hostRel.times_met + 1, trust: hostRel.trust + 2, view_of_player: "A girl who wants work." });
    expect(relationship(db, "sooi")).toEqual(hostRel);
    // the 5 s wait after a typed line is the typer's own
    const now = 5_000_000;
    as2(() => markFreeLine(now));
    expect(as2(() => gateText("Good day to you.", now + 1000))).toMatchObject({ ok: false, reason: "too fast" });
    expect(gateText("Good day to you.", now + 1000)).toMatchObject({ ok: true });
  });

  it("a job in hand: the talk's prompt names only the taker's; done jobs and trust count per player", () => {
    const db = fresh();
    const { id } = devJob(db, { type: "carry", employer: "sooi" });
    const j = listJobs(db, player(db).day).find((q) => q.id === id);
    expect(j).toBeTruthy();
    takeJob(db, j!.id);
    expect(buildPrompt(db, j!.employer_npc, "scene", [])).toMatch(/Jef is doing it now/);
    expect(as2(() => buildPrompt(db, j!.employer_npc, "scene", []))).not.toMatch(/Jef is doing it now/);
    db.prepare("UPDATE job SET status = 'done' WHERE id = ?").run(j!.id);
    expect(jobsDone(db)).toBe(1);
    expect(as2(() => jobsDone(db))).toBe(0);
    db.prepare("UPDATE faction_trust SET trust = 10 WHERE player_id = 1").run();
    expect(maxTier(db)).toBeGreaterThan(0);
    expect(as2(() => maxTier(db))).toBe(0);
  });

  it("client state: each his own row; a guest's save keeps only that, and he cannot load", async () => {
    const db = fresh();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m8c-core-"));
    try {
      setSaveDir(dir);
      const pose = { x: 1, z: 2, y: 0, yaw: 0, pitch: 0 };
      writeClientState(db, { v: 1, pose });
      const app = new Hono();
      app.use("*", (_c, next) => asPlayer(GUEST, () => next()));
      mountSaves(app, { db, payload: () => ({}), broadcast: () => {}, afterLoad: () => {} });
      const r = await app.request("/api/save", { method: "POST", body: JSON.stringify({ slot: "slot1", client: { v: 1, pose: { ...pose, x: 99 } } }), headers: { "content-type": "application/json" } });
      expect(await r.json()).toMatchObject({ ok: true, guest: true, client: true });
      expect(fs.readdirSync(dir)).toEqual([]); // no save file written
      expect(readClientState(db)?.pose.x).toBe(1);
      expect(as2(() => readClientState(db))?.pose.x).toBe(99);
      const l = await app.request("/api/load", { method: "POST", body: JSON.stringify({ slot: "slot1" }), headers: { "content-type": "application/json" } });
      expect(l.status).toBe(403);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
