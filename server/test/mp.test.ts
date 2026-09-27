import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { clock, tick, resetTickLimit } from "../src/day.ts";
import { setWorldClock, worldClock } from "../src/mp/worldClock.ts";
import { loopback, whoFrom } from "../src/mp/auth.ts";
import { Plausible } from "../src/mp/plausible.ts";
import { addGuest, codeKey, newJoinCode, playerOfToken, sameCode } from "../src/mp/players.ts";
import { decodeBatch, decodeState, encodeBatch, encodeState, FLAG, MODES, MP_PROTOCOL, type MpState } from "../../shared/mpProtocol.ts";
import { blankSave } from "./blank-save.ts";

// M8a multiplayer (docs/milestones/M8a.md): join tokens, the join code, the plausibility checks (a
// teleport and a speed hack refused, never a correction), the world's clock owned by the server, and the
// server's settings refused from anyone but the host.

const state = (o: Partial<MpState>): MpState => ({ seq: 0, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, mode: 0, flags: FLAG.grounded, base: 0, lx: 0, ly: 0, lz: 0, lyaw: 0, ...o });

describe("the join code and the tokens", () => {
  it("a code is four letters and two digits with no look-alikes; typed in any case, with or without the dash", () => {
    for (let i = 0; i < 200; i++) expect(newJoinCode()).toMatch(/^[A-HJKMNP-Z]{4}-[2-9]{2}$/);
    expect(sameCode("KADE-47", "kade47")).toBe(true);
    expect(sameCode("KADE-47", " Kade - 47 ")).toBe(true);
    expect(sameCode("KADE-47", "KADE-48")).toBe(false);
    expect(sameCode("KADE-47", "")).toBe(false);
    expect(codeKey({ evil: 1 })).toBe("");
  });

  it("a guest's token is 128 random bits; the save keeps only its hash; a wrong token is nobody", () => {
    const db = blankSave();
    const a = addGuest(db, "Anna")!;
    const b = addGuest(db, "Piet")!;
    expect(a.token).toMatch(/^[0-9a-f]{32}$/);
    expect(a.token).not.toBe(b.token);
    expect([a.id, b.id]).toEqual([2, 3]);
    expect(playerOfToken(db, a.token)).toMatchObject({ id: 2, name: "Anna" });
    expect(playerOfToken(db, b.token)).toMatchObject({ id: 3, name: "Piet" });
    expect(playerOfToken(db, "0".repeat(32))).toBeNull();
    expect(playerOfToken(db, "' OR 1=1 --")).toBeNull();
    const rows = db.prepare("SELECT * FROM mp_player").all() as Array<Record<string, unknown>>;
    expect(JSON.stringify(rows)).not.toContain(a.token);
  });

  it("the host is this computer without a token; another address needs a token; a forwarded request is not the host", () => {
    const db = blankSave();
    const g = addGuest(db, "Anna")!;
    expect(whoFrom(db, null, "127.0.0.1", undefined)).toMatchObject({ id: 1, host: true, guest: false });
    expect(whoFrom(db, null, "::1", undefined)).toMatchObject({ id: 1, host: true });
    expect(whoFrom(db, null, "192.168.1.23", undefined)).toBeNull();
    expect(whoFrom(db, null, "127.0.0.1", "192.168.1.23")).toBeNull();
    expect(whoFrom(db, g.token, "192.168.1.23", undefined)).toMatchObject({ id: 2, host: false, guest: true, admin: false });
    // a guest's token on this computer (a second tab, ?seat=2) is that guest, not the host
    expect(whoFrom(db, g.token, "127.0.0.1", undefined)).toMatchObject({ id: 2, guest: true });
    expect(whoFrom(db, "f".repeat(32), "127.0.0.1", undefined)).toBeNull();
    expect(loopback("::ffff:127.0.0.1", "for=127.0.0.1")).toBe(true);
  });
});

describe("the movement frames", () => {
  it("a state goes through the 68-byte frame and back; a batch too; junk is refused", () => {
    const s = state({ seq: 7, t: 1_758_900_000_123.5, x: 12.5, y: 1.25, z: -40.75, vx: 1.5, vz: -0.5, yaw: 2.1, pitch: -0.2, mode: MODES.indexOf("swim"), flags: FLAG.jumped | FLAG.hurry, base: 0x0103, lx: 0.5, lz: -1 });
    const b = encodeState(s);
    expect(b.byteLength).toBe(68);
    const back = decodeState(b)!;
    expect(back.seq).toBe(7);
    expect(back.t).toBe(s.t);
    expect(back.mode).toBe(s.mode);
    expect(back.flags).toBe(s.flags);
    expect(back.base).toBe(0x0103);
    expect(back.x).toBeCloseTo(12.5, 5);
    expect(back.z).toBeCloseTo(-40.75, 5);
    expect(back.yaw).toBeCloseTo(2.1, 5);
    const batch = decodeBatch(encodeBatch(99, [{ id: 2, s }, { id: 5, s: { ...s, x: 3 } }]))!;
    expect(batch.serverNow).toBe(99);
    expect(batch.list.map((e) => e.id)).toEqual([2, 5]);
    expect(batch.list[1].s.x).toBeCloseTo(3, 5);
    expect(decodeState(new ArrayBuffer(10))).toBeNull();
    const nan = new DataView(encodeState(s));
    nan.setFloat32(20, NaN, true);
    expect(decodeState(nan.buffer)).toBeNull();
  });
});

describe("the plausibility check (the server never pulls a man back)", () => {
  /** A walk at `speed` m/s along x, 20 frames a second, from t0. */
  function walk(p: Plausible, from: { x: number; t: number; seq: number }, speed: number, frames: number, mode = 0) {
    const out = [];
    for (let i = 0; i < frames; i++) {
      from.t += 50;
      from.x += speed * 0.05;
      from.seq++;
      out.push(p.check(state({ seq: from.seq, t: from.t, x: from.x, mode }), from.t));
    }
    return out;
  }

  it("walking and hurrying pass; so does a swim at a crawl and the omnibus at a trot", () => {
    const p = new Plausible(false);
    const at = { x: 0, t: 1000, seq: 0 };
    expect(walk(p, at, 1.55, 40).every((v) => v.ok)).toBe(true);
    expect(walk(p, at, 3.4, 40).every((v) => v.ok)).toBe(true);
    expect(walk(p, at, 1.6, 40, MODES.indexOf("swim")).every((v) => v.ok)).toBe(true);
    expect(walk(p, at, 7, 40, MODES.indexOf("ride")).every((v) => v.ok)).toBe(true);
    expect(p.stats.refused).toBe(0);
  });

  it("a frame that came late with the next one right after it is not a speed hack", () => {
    const p = new Plausible(false);
    p.check(state({ seq: 1, t: 1000 }), 1000);
    // sampled 50 ms apart as always; the second arrives with the third (Wi-Fi bunching): judged on the sender's times
    expect(p.check(state({ seq: 2, t: 1050, x: 0.17 }), 1180).ok).toBe(true);
    expect(p.check(state({ seq: 3, t: 1100, x: 0.34 }), 1181).ok).toBe(true);
  });

  it("a teleport is refused (not passed on); standing there for 2 s it becomes his new place", () => {
    const p = new Plausible(false);
    const at = { x: 0, t: 1000, seq: 0 };
    walk(p, at, 1.5, 10);
    at.x += 40; // 40 m in one frame
    const v = walk(p, at, 0, 1)[0];
    expect(v).toMatchObject({ ok: false, why: "speed" });
    expect(p.good!.x).toBeLessThan(1);
    // he stays there: refused for 2 s, then taken as a new place (the relay marks it: no in-between)
    const later = walk(p, at, 0, 45);
    const first = later.findIndex((x) => x.ok);
    expect(first).toBeGreaterThan(35);
    expect(later[first].anchored).toBe(true);
    expect(p.good!.x).toBeCloseTo(at.x, 3);
  });

  it("a speed hack is refused frame after frame and never taken", () => {
    const p = new Plausible(false);
    const at = { x: 0, t: 1000, seq: 0 };
    walk(p, at, 1.5, 5);
    const v = walk(p, at, 12, 200); // 12 m/s on foot for 10 s
    expect(v.every((x) => !x.ok)).toBe(true);
    expect(p.stats.speed).toBe(200);
    expect(p.good!.x).toBeLessThan(0.5);
  });

  it("up: a jump and a step pass, a leap onto a roof does not", () => {
    const p = new Plausible(false);
    p.check(state({ seq: 1, t: 1000, y: 0 }), 1000);
    expect(p.check(state({ seq: 2, t: 1050, y: 0.6 }), 1050).ok).toBe(true);
    expect(p.check(state({ seq: 3, t: 1100, y: 7 }), 1100)).toMatchObject({ ok: false, why: "climb" });
  });

  it("a clock that runs ahead of the server's is refused; a guest's snap only once in 30 s; the host's always", () => {
    const g = new Plausible(false);
    g.check(state({ seq: 1, t: 1000 }), 1000);
    expect(g.check(state({ seq: 2, t: 9000 }), 1050)).toMatchObject({ ok: false, why: "time" });
    expect(g.check(state({ seq: 3, t: 1100, x: 30, flags: FLAG.snap }), 40_000).ok).toBe(true);
    expect(g.check(state({ seq: 4, t: 1150, x: 60, flags: FLAG.snap }), 41_000).ok).toBe(false);
    const h = new Plausible(true);
    h.check(state({ seq: 1, t: 1000 }), 1000);
    expect(h.check(state({ seq: 2, t: 1050, x: 30, flags: FLAG.snap }), 1050).ok).toBe(true);
    expect(h.check(state({ seq: 3, t: 1100, x: 60, flags: FLAG.snap }), 1100).ok).toBe(true);
  });
});

describe("the world's clock", () => {
  it("lives in world_state; player 1's row keeps a copy until M8c; a write of the row is followed", () => {
    const db = blankSave();
    expect(worldClock(db)).toEqual({ day: 1, hour: 6, minute: 0 });
    resetTickLimit();
    tick(db, 1_000_000);
    const w = JSON.parse((db.prepare("SELECT value_json FROM world_state WHERE key = 'clock'").get() as { value_json: string }).value_json);
    expect(w).toEqual({ day: 1, hour: 6, minute: 5 });
    expect(db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get()).toEqual({ day: 1, hour: 6, minute: 5 });
    // an older writer of the row (a dev route, a test): the trigger keeps the world's clock with it
    db.prepare("UPDATE player SET hour = 21, minute = 40 WHERE id = 1").run();
    expect(clock(db)).toMatchObject({ day: 1, hour: 21, minute: 40 });
    setWorldClock(db, { day: 3, hour: 9, minute: 15 });
    expect(clock(db)).toMatchObject({ day: 3, hour: 9, minute: 15, weekday: "Wednesday" });
    // a save from before M8a: no clock in world_state, taken from the row once
    db.prepare("DELETE FROM world_state WHERE key = 'clock'").run();
    expect(worldClock(db)).toEqual({ day: 3, hour: 9, minute: 15 });
  });
});

// ------------------------------------------------------------------ a real server

async function freePort(): Promise<number> {
  const s = net.createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  const p = (s.address() as net.AddressInfo).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return p;
}

const kids: ChildProcess[] = [];
afterAll(() => {
  for (const k of kids) k.kill();
});

async function realServer(together: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-mp-"));
  const port = await freePort();
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cfg = path.join(dir, "mp.json");
  fs.writeFileSync(cfg, JSON.stringify({ version: 1, multiplayer: together, lan: false, code: "KADE-47" }));
  let log = "";
  const child = spawn(process.execPath, ["src/index.ts"], {
    cwd: serverDir,
    env: { ...process.env, VITEST: "true", SCHELDEMIST_DB: path.join(dir, "mp.sqlite"), SCHELDEMIST_PORT: String(port), SCHELDEMIST_MP_CONFIG: cfg, SCHELDEMIST_AI_CONFIG: path.join(dir, "ai.json"), SCHELDEMIST_SAVES: path.join(dir, "saves"), NODE_ENV: "development", SCHELDEMIST_LAN: "", SCHELDEMIST_MP: "" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  kids.push(child);
  child.stdout?.on("data", (d) => (log += d));
  child.stderr?.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  for (let i = 0; i < 450; i++) {
    try {
      await call("GET", "/api/mp/info");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const row = () => {
    const db = new Database(path.join(dir, "mp.sqlite"), { readonly: true, fileMustExist: true });
    try {
      return {
        clock: JSON.parse((db.prepare("SELECT value_json FROM world_state WHERE key = 'clock'").get() as { value_json: string }).value_json) as { day: number; hour: number; minute: number },
      };
    } finally {
      db.close();
    }
  };
  /** A movement socket: hello with a token (or none: the host), then frames. */
  const socket = async (token?: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/mp`, { headers: { origin: base } });
    const texts: Array<Record<string, unknown>> = [];
    const batches: Array<ReturnType<typeof decodeBatch>> = [];
    ws.on("message", (d, bin) => {
      if (bin) batches.push(decodeBatch(d as Buffer));
      else texts.push(JSON.parse(String(d)));
    });
    await new Promise<void>((ok, bad) => {
      ws.once("open", () => ok());
      ws.once("error", bad);
    });
    ws.send(JSON.stringify({ type: "hello", token, protocol: MP_PROTOCOL }));
    for (let i = 0; i < 50 && !texts.some((t) => t.type === "welcome"); i++) await new Promise((r) => setTimeout(r, 50));
    return { ws, texts, batches };
  };
  const stop = async () => {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { call, row, socket, stop, log: () => log, base, port };
}

describe("played together on a real server", () => {
  it("join: the right code gives a token; a wrong one does not; 5 tries a minute; the token speaks for him", async () => {
    const s = await realServer(true);
    try {
      expect((await s.call("POST", "/api/mp/join", { code: "WRONG-11", name: "Anna" })).status).toBe(403);
      const ok = await s.call("POST", "/api/mp/join", { code: "kade47", name: "Anna <script>" });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ id: 2, name: "Anna script" });
      const token = String(ok.body.token);
      const me = await s.call("GET", "/api/mp/info", undefined, { "x-scheldemist-player": token });
      expect(me.body.you).toMatchObject({ id: 2, guest: true, host: false, name: "Anna script" });
      // his own profile (the character sheet saves his, not the host's)
      const prof = await s.call("GET", "/api/player/profile", undefined, { "x-scheldemist-player": token });
      expect(prof.body).toMatchObject({ id: 2 });
      expect((await s.call("GET", "/api/player/profile")).body).toMatchObject({ id: 1 });
      // a token nobody has: nobody
      expect((await s.call("GET", "/api/state", undefined, { "x-scheldemist-player": "a".repeat(32) })).status).toBe(401);
      // four more wrong tries and the next ones wait a minute (5 wrong a minute; the right one did not count)
      for (let i = 0; i < 4; i++) await s.call("POST", "/api/mp/join", { code: "NOPE-22" });
      expect((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Piet" })).status).toBe(429);
      // a new code from the host: the old one no longer lets anyone in (checked once the minute is over in real play)
      const nc = await s.call("POST", "/api/mp/code");
      expect(String(nc.body.code)).toMatch(/^[A-Z]{4}-[0-9]{2}$/);
      expect(nc.body.code).not.toBe("KADE-47");
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("the server's settings, saves and dev routes are the host's: a guest, an unknown PC and a forwarded request are refused", async () => {
    const s = await realServer(true);
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Piet" })).body.token);
      const guest = { "x-scheldemist-player": token };
      expect((await s.call("PUT", "/api/ai/config", { mode: "walk" }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/ai/test", { all: true }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/mp/config", { lan: true }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/mp/code", {}, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/mp/pause-all", { on: true }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/settings/population", { eventSize: 20 }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/save", { slot: "slot1" }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/load", { slot: "slot1" }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/new-game", {}, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/dev/set", { hour: 3 }, guest)).status).toBe(403);
      // he may walk and look: the town, the state, the heartbeat
      expect((await s.call("GET", "/api/town", undefined, guest)).status).toBe(200);
      expect((await s.call("POST", "/api/tick", {}, guest)).body).toMatchObject({ advanced: false, together: true });
      // but not buy, take work or talk yet (M8c)
      expect((await s.call("POST", "/api/buy", { npc: "fientje", kind: "herring" }, guest)).status).toBe(403);
      expect((await s.call("POST", "/api/rent", {}, guest)).status).toBe(403);
      // a PC in the house without a token, and a request that says it was forwarded for one
      expect((await s.call("GET", "/api/state", undefined, { "x-forwarded-for": "192.168.1.23" })).status).toBe(401);
      expect((await s.call("PUT", "/api/ai/config", { mode: "walk" }, { "x-forwarded-for": "192.168.1.23" })).status).toBe(401);
      // the host may; a guest he marks admin may change the settings too, but never save or load
      expect((await s.call("POST", "/api/mp/admin", { id: 2, on: true })).status).toBe(200);
      expect((await s.call("PUT", "/api/ai/config", { callsPerDay: 100 }, guest)).status).toBe(200);
      expect((await s.call("POST", "/api/save", { slot: "slot1" }, guest)).status).toBe(403);
      expect((await s.call("PUT", "/api/ai/config", { callsPerDay: 120 })).status).toBe(200);
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("the clock: played together the server moves it itself; a tab's tick does not; alone it is the tab's tick as before", async () => {
    const alone = await realServer(false);
    try {
      const a0 = alone.row().clock;
      const t = await alone.call("POST", "/api/tick", {});
      expect(t.body.advanced).toBe(true);
      expect(alone.row().clock.minute).toBe((a0.minute + 5) % 60);
      // alone, a tab's pause still stops the town (single player as today)
      await alone.call("POST", "/api/pause", { on: true, client: "tab-a" });
      expect((await alone.call("GET", "/api/pause")).body.paused).toBe(true);
    } finally {
      await alone.stop();
    }
    const s = await realServer(true);
    try {
      const c0 = s.row().clock;
      // the tabs' ticks and pauses do nothing to the town
      for (let i = 0; i < 3; i++) expect((await s.call("POST", "/api/tick", {})).body.advanced).toBe(false);
      await s.call("POST", "/api/pause", { on: true, client: "tab-a" });
      expect((await s.call("GET", "/api/pause")).body.paused).toBe(false);
      expect(s.row().clock).toEqual(c0);
      // nobody in the game: the clock stands; a player comes in (his socket sends a frame): the server ticks
      const host = await s.socket();
      expect(host.texts.find((m) => m.type === "welcome")).toMatchObject({ id: 1, host: true });
      host.ws.send(encodeState(state({ seq: 1, t: Date.now(), x: 10, z: 12 })));
      let c1 = s.row().clock;
      for (let i = 0; i < 60 && c1.minute === c0.minute; i++) {
        await new Promise((r) => setTimeout(r, 100));
        c1 = s.row().clock;
      }
      expect(c1.minute).toBe((c0.minute + 5) % 60);
      // every tab hears the new time from the server (the push), and the host's pause-all stops it
      expect((await s.call("POST", "/api/mp/pause-all", { on: true })).body).toEqual({ pausedAll: true });
      for (let i = 0; i < 20 && !host.texts.some((m) => m.type === "pause_all"); i++) await new Promise((r) => setTimeout(r, 50));
      expect(host.texts.find((m) => m.type === "pause_all")).toEqual({ type: "pause_all", on: true });
      expect((await s.call("GET", "/api/pause")).body.paused).toBe(true);
      await s.call("POST", "/api/mp/pause-all", { on: false });
      host.ws.close();
    } finally {
      await s.stop();
    }
  }, 180_000);

  it("the movement socket: a guest's walk reaches the host; a teleport and a speed hack do not; no correction is ever sent", async () => {
    const s = await realServer(true);
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).body.token);
      const host = await s.socket();
      const anna = await s.socket(token);
      expect(anna.texts.find((m) => m.type === "welcome")).toMatchObject({ id: 2, host: false, name: "Anna" });
      // an old build is sent away to download the new version
      const old = new WebSocket(`ws://127.0.0.1:${s.port}/mp`, { headers: { origin: s.base } });
      const oldMsg = await new Promise<Record<string, unknown>>((ok) => {
        old.on("open", () => old.send(JSON.stringify({ type: "hello", protocol: MP_PROTOCOL + 99 })));
        old.on("message", (d) => ok(JSON.parse(String(d))));
      });
      expect(oldMsg).toEqual({ type: "old", protocol: MP_PROTOCOL });
      let t = Date.now();
      let x = 10;
      let seq = 0;
      const frame = async (dx: number) => {
        t += 50;
        x += dx;
        anna.ws.send(encodeState(state({ seq: ++seq, t, x, z: 12 })));
        await new Promise((r) => setTimeout(r, 50));
      };
      for (let i = 0; i < 20; i++) await frame(0.08); // 1.6 m/s
      const seen = () => host.batches.flatMap((b) => b!.list).filter((e) => e.id === 2);
      await new Promise((r) => setTimeout(r, 150));
      expect(seen().length).toBeGreaterThan(10);
      const walked = Math.max(...seen().map((e) => e.s.x));
      expect(walked).toBeCloseTo(x, 3);
      // a teleport: 50 m in one frame, then a speed hack at 15 m/s
      await frame(50);
      for (let i = 0; i < 10; i++) await frame(0.75);
      await new Promise((r) => setTimeout(r, 150));
      expect(Math.max(...seen().map((e) => e.s.x))).toBeCloseTo(walked, 3);
      const st = (await s.call("GET", "/api/mp/stats")).body as { corrections: number; players: Array<{ id: number; refused: number; speed: number }> };
      expect(st.corrections).toBe(0);
      expect(st.players.find((p) => p.id === 2)!.refused).toBe(11);
      // the mover heard nothing back about it: no correction, no pull
      // (M8b: who walks the townspeople and who runs the world are news for everyone, not corrections)
      expect(anna.texts.map((m) => m.type).filter((k) => k !== "roster" && k !== "welcome" && k !== "owners" && k !== "worldpc")).toEqual([]);
      expect(s.log()).toMatch(/player 2: move refused \(speed/);
      host.ws.close();
      anna.ws.close();
      old.close();
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("alone (not together) nobody can join", async () => {
    const s = await realServer(false);
    try {
      expect((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).status).toBe(409);
    } finally {
      await s.stop();
    }
  }, 120_000);
});
