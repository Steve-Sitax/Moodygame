import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { Bucket, FLOOD_CODE, FLOOD_S, FLOOD_X, HTTP_LIMIT, HttpLimiter, SeatLimiter, SOCKET_LIMITS } from "../src/mp/limits.ts";
import { decodeBatch, encodeState, FLAG, MP_PROTOCOL, type MpState } from "../../shared/mpProtocol.ts";

// M8e part B (docs/milestones/M8e.md): rate limits per seat on the movement socket and per guest on /api/*; a dead
// line found by the server's pings; a reconnect with the same token keeps his seat.

const state = (o: Partial<MpState>): MpState => ({ seq: 1, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, mode: 0, flags: FLAG.grounded, base: 0, gear: 0, lx: 0, ly: 0, lz: 0, lyaw: 0, ...o });

describe("the limits (pure)", () => {
  it("a bucket lets a burst through, then its rate", () => {
    const b = new Bucket(10, 30, 0);
    let ok = 0;
    for (let i = 0; i < 100; i++) if (b.take(0)) ok++;
    expect(ok).toBe(30);
    expect(b.take(50)).toBe(false); // (half a token)
    expect(b.take(100)).toBe(true);
    ok = 0;
    for (let t = 1000; t < 11_000; t += 10) if (b.take(t)) ok++;
    // (ten seconds at the rate, and what refilled since the last take)
    expect(ok).toBeGreaterThanOrEqual(99);
    expect(ok).toBeLessThanOrEqual(110);
  });

  it("normal play is never cut: 20 states, 10 batches, 10 world states a second, a ping, claims; and a 6 s stall let through at once", () => {
    const l = new SeatLimiter();
    for (let t = 0; t < 60_000; t += 50) {
      expect(l.message("state", t)).toBe("ok");
      if (t % 100 === 0) {
        expect(l.message("puppets", t)).toBe("ok");
        expect(l.message("puppets", t)).toBe("ok"); // (two batches a tick: more than 150 people)
        expect(l.message("world", t)).toBe("ok");
        expect(l.message("figs", t)).toBe("ok");
      }
      if (t % 1000 === 0) expect(l.message("text", t)).toBe("ok");
      // (a burst of claims and releases, every frame for half a second at 144 frames a second)
      if (t % 10_000 === 0) for (let k = 0; k < 72; k++) expect(l.message("text", t + k * 7)).toBe("ok");
    }
    // the line stood still 6 s, then everything held back comes at once
    const t0 = 70_000;
    for (let i = 0; i < 120; i++) expect(l.message("state", t0)).toBe("ok");
    for (let t = t0 + 50; t < t0 + 10_000; t += 50) expect(l.message("state", t)).toBe("ok");
    expect(l.droppedTotal).toBe(0);
  });

  it("a flood is dropped and counted; FLOOD_X times normal for FLOOD_S seconds closes the seat; a short burst does not", () => {
    const l = new SeatLimiter();
    let drop = 0;
    let t = 0;
    // six times the normal rate of states for 3 s: over the limit, dropped, no flood
    for (; t < 3000; t += 1000 / 120) if (l.message("state", t) === "drop") drop++;
    expect(drop).toBeGreaterThan(0);
    expect(l.dropped.state).toBe(drop);
    const x = FLOOD_X * SOCKET_LIMITS.state.normal + 20; // a second's messages, over the flood line
    let flood = -1;
    for (let s = 0; s < FLOOD_S + 2 && flood < 0; s++)
      for (let i = 0; i < x; i++) {
        const now = 10_000 + s * 1000 + (i * 1000) / x;
        if (l.message("state", now) === "flood") {
          flood = now;
          break;
        }
      }
    expect(flood).toBeGreaterThanOrEqual(10_000 + (FLOOD_S - 1) * 1000);
    expect(flood).toBeLessThan(10_000 + FLOOD_S * 1000);
    // four seconds of it, then quiet: no flood
    const q = new SeatLimiter();
    for (let s = 0; s < FLOOD_S - 1; s++) for (let i = 0; i < x; i++) expect(q.message("text", s * 1000 + (i * 1000) / x)).not.toBe("flood");
    for (let i = 0; i < 5; i++) expect(q.message("text", 8000 + i * 100)).not.toBe("flood");
  });

  it("the HTTP limit per guest: a burst, then the sustained rate; one guest's flood does not touch another", () => {
    const h = new HttpLimiter();
    let ok = 0;
    for (let i = 0; i < 200; i++) if (h.take(2, 0)) ok++;
    expect(ok).toBe(HTTP_LIMIT.burst);
    expect(h.take(3, 0)).toBe(true);
    expect(h.refused.get(2)).toBe(200 - HTTP_LIMIT.burst);
    ok = 0;
    for (let t = 1000; t < 11_000; t += 5) if (h.take(2, t)) ok++;
    // (ten seconds at the rate, and the first second's refill)
    expect(ok).toBeGreaterThanOrEqual(HTTP_LIMIT.rate * 10);
    expect(ok).toBeLessThanOrEqual(HTTP_LIMIT.rate * 11 + 2);
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

async function realServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-m8e-"));
  const port = await freePort();
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cfg = path.join(dir, "mp.json");
  fs.writeFileSync(cfg, JSON.stringify({ version: 1, multiplayer: true, lan: false, code: "KADE-47" }));
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
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
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
  const socket = async (token?: string, opts: WebSocket.ClientOptions = {}) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/mp`, { headers: { origin: base }, ...opts });
    const texts: Array<Record<string, unknown>> = [];
    const batches: Array<ReturnType<typeof decodeBatch>> = [];
    let closed: { code: number } | null = null;
    ws.on("message", (d, bin) => {
      if (bin) batches.push(decodeBatch(d as Buffer));
      else texts.push(JSON.parse(String(d)));
    });
    ws.on("close", (code) => (closed = { code }));
    await new Promise<void>((ok, bad) => {
      ws.once("open", () => ok());
      ws.once("error", bad);
    });
    ws.send(JSON.stringify({ type: "hello", token, protocol: MP_PROTOCOL }));
    for (let i = 0; i < 50 && !texts.some((t) => t.type === "welcome"); i++) await new Promise((r) => setTimeout(r, 50));
    return { ws, texts, batches, closed: () => closed };
  };
  const stop = async () => {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { call, socket, stop, log: () => log, base, port };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Stats = { limitDropped: number; floodClosed: number; deadClosed: number; http429: number; players: Array<{ id: number; limited: Record<string, number>; http429: number; online: boolean }> };

/** Walk a player: `n` states at 20 a second from x0 along x at 1.5 m/s (the time on the server's clock). */
async function walk(ws: WebSocket, n: number, x0: number, seq0: number) {
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    ws.send(encodeState(state({ seq: seq0 + i, t: t0 + i * 50, x: x0 + i * 0.075, z: 12 })));
    await wait(50);
  }
  return { x: x0 + (n - 1) * 0.075, seq: seq0 + n };
}

describe("M8e limits on a real server", () => {
  it("normal two-player traffic is untouched; a guest's HTTP flood gets 429s and the host's never does", async () => {
    const s = await realServer();
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).body.token);
      const g = { "x-scheldemist-player": token };
      const host = await s.socket();
      const anna = await s.socket(token);
      // both walk 3 s, ping once a second, as the game does
      const pings = setInterval(() => {
        for (const w of [host.ws, anna.ws]) w.send(JSON.stringify({ type: "ping", c: Date.now() }));
      }, 1000);
      await Promise.all([walk(host.ws, 60, 0, 1), walk(anna.ws, 60, 2, 1)]);
      clearInterval(pings);
      await wait(200);
      const seenAnna = host.batches.flatMap((b) => b!.list).filter((e) => e.id === 2);
      const seenHost = anna.batches.flatMap((b) => b!.list).filter((e) => e.id === 1);
      expect(new Set(seenAnna.map((e) => e.s.seq)).size).toBe(60);
      expect(new Set(seenHost.map((e) => e.s.seq)).size).toBe(60);
      let st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      expect(st.limitDropped).toBe(0);
      expect(st.http429).toBe(0);
      // the guest's calls: a burst of 150 at once; over the burst refused with a plain English 429
      const guestCalls = await Promise.all(Array.from({ length: 150 }, () => s.call("GET", "/api/mp/info", undefined, g)));
      const refused = guestCalls.filter((r) => r.status === 429);
      expect(refused.length).toBeGreaterThanOrEqual(150 - HTTP_LIMIT.burst - 5);
      expect(refused.length).toBeLessThanOrEqual(150 - HTTP_LIMIT.burst + 5);
      expect(String(refused[0].body.error)).toMatch(/Too many requests from this PC/);
      // the host's: never
      const hostCalls = await Promise.all(Array.from({ length: 150 }, () => s.call("GET", "/api/mp/info")));
      expect(hostCalls.every((r) => r.status === 200)).toBe(true);
      // a second later the guest is served again
      await wait(1000);
      expect((await s.call("GET", "/api/mp/info", undefined, g)).status).toBe(200);
      st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      expect(st.http429).toBe(refused.length);
      expect(st.players.find((p) => p.id === 2)!.http429).toBe(refused.length);
      host.ws.close();
      anna.ws.close();
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("a guest flooding the socket: the excess is dropped and counted, the host keeps getting a sane stream; far over for 5 s closes his socket with the reason", async () => {
    const s = await realServer();
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).body.token);
      const host = await s.socket();
      const anna = await s.socket(token);
      // 1000 states in one go (each a step on: a hacked or broken client)
      const t0 = Date.now();
      for (let i = 0; i < 1000; i++) anna.ws.send(encodeState(state({ seq: i + 1, t: t0 + i, x: i * 0.001, z: 12 })));
      await wait(500);
      let st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      const a = st.players.find((p) => p.id === 2)!;
      expect(a.limited.state).toBeGreaterThanOrEqual(1000 - SOCKET_LIMITS.state.burst - 30);
      expect(st.limitDropped).toBe(a.limited.state);
      const got = host.batches.flatMap((b) => b!.list).filter((e) => e.id === 2).length;
      expect(got).toBeLessThanOrEqual(SOCKET_LIMITS.state.burst + 30);
      // the host floods his own socket: never limited
      for (let i = 0; i < 1000; i++) host.ws.send(JSON.stringify({ type: "x" }));
      await wait(300);
      st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      expect(st.players.find((p) => p.id === 1)!.limited.text).toBe(0);
      expect(host.closed()).toBe(null);
      // far over for FLOOD_S seconds: junk text at 30 times the normal rate
      const junk = setInterval(() => {
        for (let i = 0; i < 30; i++) if (anna.ws.readyState === WebSocket.OPEN) anna.ws.send(JSON.stringify({ type: "x" }));
      }, 100);
      for (let i = 0; i < 100 && !anna.closed(); i++) await wait(100);
      clearInterval(junk);
      expect(anna.closed()?.code).toBe(FLOOD_CODE);
      expect(anna.texts.find((m) => m.type === "refused")?.why).toMatch(/far more than the game ever sends/);
      st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      expect(st.floodClosed).toBe(1);
      expect(s.log()).toMatch(/player 2: far too many text messages/);
      expect(host.closed()).toBe(null);
      host.ws.close();
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("a dropped line: he comes back on the same token and the same seat, one figure, seen at his new place at once", async () => {
    const s = await realServer();
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).body.token);
      const host = await s.socket();
      let anna = await s.socket(token);
      const w = await walk(anna.ws, 20, 5, 1);
      await wait(150);
      // the line drops without a word (a VPN): the socket just ends
      anna.ws.terminate();
      await wait(300);
      const roster = () => [...host.texts].reverse().find((m) => m.type === "roster") as { players: Array<{ id: number; online: boolean }> };
      expect(roster().players.filter((p) => p.id === 2)).toEqual([expect.objectContaining({ id: 2, online: true })]); // (the grace: still in)
      // back 2 s later with the same token; his PC walked him on 10 m meanwhile
      await wait(2000);
      host.batches.length = 0;
      anna = await s.socket(token);
      expect(anna.texts.find((m) => m.type === "welcome")).toMatchObject({ id: 2, name: "Anna" });
      await walk(anna.ws, 20, w.x + 10, w.seq);
      await wait(150);
      // (the relay may first say his last place again: he stood there while the line was down)
      const back = host.batches.flatMap((b) => b!.list).filter((e) => e.id === 2 && e.s.x > w.x + 5);
      expect(back.length).toBeGreaterThan(10);
      expect(back[0].s.flags & FLAG.snap).toBe(FLAG.snap); // (at his new place at once, not sliding there)
      expect(back.slice(1).some((e) => e.s.flags & FLAG.snap)).toBe(false);
      expect(Math.max(...back.map((e) => e.s.x))).toBeGreaterThan(w.x + 10);
      // one seat, one entry: no second figure, and nobody was told he went home
      expect(roster().players.filter((p) => p.id === 2).length).toBe(1);
      expect(host.texts.some((m) => m.type === "went")).toBe(false);
      const st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      expect(st.players.filter((p) => p.id === 2)).toEqual([expect.objectContaining({ online: true })]);
      host.ws.close();
      anna.ws.close();
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("a line that died without a word (no answer to the server's pings) is closed within 20 s; the host's own stays", async () => {
    const s = await realServer();
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).body.token);
      const host = await s.socket();
      const anna = await s.socket(token, { autoPong: false });
      await walk(anna.ws, 4, 0, 1);
      // (she keeps quiet from now on and never answers a ping: a dead VPN)
      for (let i = 0; i < 260 && !anna.closed(); i++) await wait(100);
      expect(anna.closed()).not.toBe(null);
      const st = (await s.call("GET", "/api/mp/stats")).body as unknown as Stats;
      expect(st.deadClosed).toBe(1);
      expect(host.closed()).toBe(null);
      expect(s.log()).toMatch(/player 2: no answer to the ping/);
      host.ws.close();
    } finally {
      await s.stop();
    }
  }, 120_000);
});
