import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";
import { forgetMoveCodes, MOVE_MS, newMoveCode, takeMoveCode } from "../src/mp/players.ts";
import { MP_PROTOCOL } from "../../shared/mpProtocol.ts";

// M8e review round 4 (docs/milestones/M8e.md): moving from the http page to the secure one (or between two
// addresses of the host) keeps a guest's man: a one-time move code (random, 60 s, single use, hashed in memory)
// redeemed on the new address for a new token of the same player; the old token ends there.

describe("move codes (pure)", () => {
  it("a code works once, for its player", () => {
    forgetMoveCodes();
    const c = newMoveCode(3, 0);
    expect(c).toMatch(/^[0-9a-f]{32}$/);
    expect(takeMoveCode(c, 1000)).toBe(3);
    expect(takeMoveCode(c, 1000)).toBe(null);
  });

  it("a code ends after 60 s, and a failed try with an old code does not bring it back", () => {
    forgetMoveCodes();
    const c = newMoveCode(4, 0);
    expect(takeMoveCode(c, MOVE_MS)).toBe(null);
    expect(takeMoveCode(c, 10)).toBe(null); // (taken out at the first try)
    const d = newMoveCode(4, 0);
    expect(takeMoveCode(d, MOVE_MS - 1)).toBe(4);
  });

  it("a new code for the same player ends his older one; other players' codes stay; junk is refused", () => {
    forgetMoveCodes();
    const a = newMoveCode(2, 0);
    const other = newMoveCode(5, 0);
    const b = newMoveCode(2, 100);
    expect(takeMoveCode(a, 200)).toBe(null);
    expect(takeMoveCode(b, 200)).toBe(2);
    expect(takeMoveCode(other, 200)).toBe(5);
    for (const junk of [undefined, 42, "", "x".repeat(32), a.toUpperCase(), `${b}0`]) expect(takeMoveCode(junk, 200)).toBe(null);
    // (two codes are never alike: 128 random bits)
    expect(new Set(Array.from({ length: 200 }, (_, i) => newMoveCode(100 + i, 0))).size).toBe(200);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-m8e-move-"));
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
    return { status: r.status, headers: r.headers, body: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  for (let i = 0; i < 450; i++) {
    try {
      await call("GET", "/api/mp/info");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  /** A socket (/mp or /ws) with its messages and how it closed. */
  const socket = async (p: "/mp" | "/ws", hello: Record<string, unknown> | null) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${p}${p === "/ws" ? "?client=t1&guest=1" : ""}`, { headers: { origin: base } });
    const texts: Array<Record<string, unknown>> = [];
    let closed: { code: number } | null = null;
    ws.on("message", (d, bin) => {
      if (!bin) texts.push(JSON.parse(String(d)));
    });
    ws.on("close", (code) => (closed = { code }));
    await new Promise<void>((ok, bad) => {
      ws.once("open", () => ok());
      ws.once("error", bad);
    });
    if (hello) ws.send(JSON.stringify(hello));
    for (let i = 0; i < 50 && !texts.some((t) => t.type === "welcome" || t.type === "jobs"); i++) await new Promise((r) => setTimeout(r, 50));
    return { ws, texts, closed: () => closed };
  };
  const stop = async () => {
    child.kill();
    await new Promise((r) => child.once("exit", r));
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { call, socket, stop, log: () => log };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const T = "x-scheldemist-player";

describe("M8e moving to the secure address on a real server", () => {
  it("the same man after the move: a new token for the same id, the old one ends with its sockets, the code works once", async () => {
    const s = await realServer();
    try {
      const joined = (await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Anna" })).body;
      const old = String(joined.token);
      expect(joined.id).toBe(2);
      // her sockets on the old token: the movement socket and the push
      const mp = await s.socket("/mp", { type: "hello", token: old, protocol: MP_PROTOCOL });
      const push = await s.socket("/ws", { type: "hello", token: old });
      expect(mp.texts.some((t) => t.type === "welcome")).toBe(true);
      expect(push.texts.some((t) => t.type === "jobs")).toBe(true);
      // a code only for a guest: none for the host, none without a token
      expect((await s.call("POST", "/api/mp/transfer")).status).toBe(403);
      const tr = await s.call("POST", "/api/mp/transfer", undefined, { [T]: old });
      expect(tr.status).toBe(200);
      const code = String(tr.body.code);
      expect(code).toMatch(/^[0-9a-f]{32}$/);
      expect(tr.body.ttl_s).toBe(60);
      expect(s.log()).not.toContain(code); // (never in a log)
      // the new page redeems it: the same player, a new token
      const mv = await s.call("POST", "/api/mp/move", { code });
      expect(mv.status).toBe(200);
      expect(mv.body).toMatchObject({ id: 2, name: "Anna" });
      const fresh = String(mv.body.token);
      expect(fresh).toMatch(/^[0-9a-f]{32}$/);
      expect(fresh).not.toBe(old);
      const me = await s.call("GET", "/api/mp/info", undefined, { [T]: fresh });
      expect(me.body.you).toMatchObject({ id: 2, guest: true, name: "Anna" });
      // the old token ends (it went over plain http): its calls and its sockets
      expect((await s.call("GET", "/api/mp/info", undefined, { [T]: old })).body.you).toBe(null);
      expect((await s.call("GET", "/api/jobs", undefined, { [T]: old })).status).toBe(401);
      for (let i = 0; i < 40 && (!mp.closed() || !push.closed()); i++) await wait(50);
      expect(mp.closed()?.code).toBe(4005);
      expect(push.closed()?.code).toBe(4001);
      // her new socket takes the same seat; one Anna in the roster
      const again = await s.socket("/mp", { type: "hello", token: fresh, protocol: MP_PROTOCOL });
      expect(again.texts.find((t) => t.type === "welcome")).toMatchObject({ id: 2, name: "Anna" });
      const roster = [...again.texts].reverse().find((t) => t.type === "roster") as { players: Array<{ id: number }> };
      expect(roster.players.filter((p) => p.id === 2).length).toBe(1);
      // the code works once
      const twice = await s.call("POST", "/api/mp/move", { code });
      expect(twice.status).toBe(403);
      expect(String(twice.body.error)).toMatch(/used already or is too old/);
      // the new token makes codes too; the player's newest code ends the one before
      const c1 = String((await s.call("POST", "/api/mp/transfer", undefined, { [T]: fresh })).body.code);
      const c2 = String((await s.call("POST", "/api/mp/transfer", undefined, { [T]: fresh })).body.code);
      expect((await s.call("POST", "/api/mp/move", { code: c1 })).status).toBe(403);
      expect((await s.call("POST", "/api/mp/move", { code: c2 })).body).toMatchObject({ id: 2 });
      again.ws.close();
    } finally {
      await s.stop();
    }
  }, 120_000);

  it("wrong codes count like wrong join codes: 5 a minute per address, then 429 with Retry-After, even for a good code", async () => {
    const s = await realServer();
    try {
      const token = String((await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Piet" })).body.token);
      const good = String((await s.call("POST", "/api/mp/transfer", undefined, { [T]: token })).body.code);
      for (let i = 0; i < 5; i++) {
        const r = await s.call("POST", "/api/mp/move", { code: "0".repeat(31) + String(i) });
        expect(r.status).toBe(403);
      }
      const r = await s.call("POST", "/api/mp/move", { code: good });
      expect(r.status).toBe(429);
      expect(r.headers.get("retry-after")).toBe("60");
      expect(String(r.body.error)).toMatch(/Too many tries/);
      // the same count as the join's
      const j = await s.call("POST", "/api/mp/join", { code: "KADE-47", name: "Mie" });
      expect(j.status).toBe(429);
      expect(j.headers.get("retry-after")).toBe("60");
      // (the good code was not spent by the refused try: Piet is still Piet with his token)
      expect((await s.call("GET", "/api/mp/info", undefined, { [T]: token })).body.you).toMatchObject({ name: "Piet" });
    } finally {
      await s.stop();
    }
  }, 120_000);
});
