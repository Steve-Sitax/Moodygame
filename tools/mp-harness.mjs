// M8a multiplayer: the multi-client harness (docs/milestones/M8a.md, docs/testing.md "Together").
// Headless players against a test stack's server, and a delay/jitter proxy between the players and the
// server, to prove the others are drawn smoothly and nobody's own man is ever pulled back.
//
//   node tools/mp-harness.mjs proxy  --listen 8952 --to 8951 [--delay 40] [--jitter 40] [--stall 0.2:300]
//        a TCP proxy: every chunk each way waits delay + 0..jitter ms (in order, as TCP keeps it); now and
//        then (stall P:MS: P stalls a second on average) the line holds for MS ms. Runs until stopped.
//   node tools/mp-harness.mjs vite   --vite 5352 --server 8952 [--name m8a]
//        a second test vite whose /api, /ws and /mp go to that port (the proxy): a tab through the bad line.
//   node tools/mp-harness.mjs smooth --server 8951 [--secs 20] [--name smooth]
//        two headless players: one walks a circle with jumps, the other draws him with the game's own jitter
//        buffer (client/src/net/mp/remotes.ts) at 60 frames a second; prints how far the drawn man is from
//        where he really was, and how much his step from frame to frame wanders (the jitter).
//   node tools/mp-harness.mjs bot    --server 8951 --at x,z [--secs 60] [--radius 5] [--jump 3]
//        one headless player who walks a circle there (for a tab to watch).
//   node tools/mp-harness.mjs crowd  --server 8951 --at x,z --players 5 [--secs 60]
//        several at once (the frame time with 6 players).
//   node tools/mp-harness.mjs stop   [--vite 5352] [--listen 8952]
//
// The players join with the host's code (read from /api/mp/host: this computer is the host), so the stack
// must be played together (POST /api/mp/config {"multiplayer":true}). Never Steve's ports.

import net from "node:net";
import http from "node:http";
import path from "node:path";
import { spawn, execSync } from "node:child_process";
import { existsSync, openSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";
import { createRequire } from "node:module";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const cmd = args[0] ?? "help";
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const num = (k, d) => Number(opt(k, d));
for (const p of [num("server", 8951), num("listen", 8952), num("to", 8951), num("vite", 5352)]) if ([8787, 5173].includes(p)) throw new Error("8787 and 5173 are Steve's own game: pick other ports");

// the game's own TypeScript (the codec, the jitter buffer): node strips the types; extensionless imports get ".ts"
register(
  "data:text/javascript," +
    encodeURIComponent(`export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/.test(s)) return next(s + ".ts", c); throw e; } }`),
);
const shared = await import(pathToFileURL(path.join(root, "shared", "mpProtocol.ts")).href);
const { RemoteTrack } = await import(pathToFileURL(path.join(root, "client", "src", "net", "mp", "remotes.ts")).href);
const require = createRequire(path.join(root, "server", "package.json"));
const WebSocket = require("ws");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ the proxy

function proxy() {
  const listen = num("listen", 8952);
  const to = num("to", 8951);
  const delay = num("delay", 40);
  const jitter = num("jitter", 40);
  const [pStall, msStall] = String(opt("stall", "0:0")).split(":").map(Number);
  let stallUntil = 0;
  setInterval(() => {
    if (pStall > 0 && Math.random() < pStall / 10) stallUntil = Date.now() + msStall;
  }, 100);
  const pipe = (from, toSock) => {
    let lastAt = 0;
    from.on("data", (chunk) => {
      const now = Date.now();
      const at = Math.max(lastAt, now + delay + Math.random() * jitter, stallUntil);
      lastAt = at;
      setTimeout(() => {
        if (!toSock.destroyed) toSock.write(chunk);
      }, at - now);
    });
    from.on("end", () => setTimeout(() => toSock.end(), Math.max(0, lastAt - Date.now()) + 5));
    from.on("error", () => toSock.destroy());
  };
  net
    .createServer((c) => {
      const s = net.connect(to, "127.0.0.1");
      pipe(c, s);
      pipe(s, c);
      s.on("error", () => c.destroy());
    })
    .listen(listen, "127.0.0.1", () => console.log(`[proxy] 127.0.0.1:${listen} -> ${to}: ${delay} ms + 0..${jitter} ms each way${pStall ? `, stalls of ${msStall} ms about ${pStall}/s` : ""}`));
}

// ------------------------------------------------------------------ a headless player

async function json(base, method, p, body, headers = {}) {
  const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json();
}

async function joinBot(base, name) {
  const h = await json(base, "GET", "/api/mp/host");
  if (!h.multiplayer) throw new Error("the stack is not played together: POST /api/mp/config {multiplayer:true}");
  const j = await json(base, "POST", "/api/mp/join", { code: h.code, name });
  if (!j.token) throw new Error(`join: ${JSON.stringify(j)}`);
  return j.token;
}

class Bot {
  /** `wsPort`: the movement socket through this port (the proxy); the server's own Host and Origin are sent. */
  constructor(base, token, wsPort) {
    this.base = base;
    this.wsPort = wsPort;
    this.token = token;
    this.offset = 0;
    this.best = Infinity;
    this.seq = 0;
    this.batches = [];
    this.onBatch = null;
    this.texts = [];
  }
  async open() {
    const port = this.wsPort ?? new URL(this.base).port;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/mp`, { headers: { origin: this.base, host: new URL(this.base).host } });
    this.ws.binaryType = "arraybuffer";
    await new Promise((ok, bad) => (this.ws.once("open", ok), this.ws.once("error", bad)));
    this.ws.on("message", (d, bin) => {
      if (!bin) {
        const m = JSON.parse(String(d));
        if (m.type === "pong") {
          const now = performance.now();
          const rtt = now - m.c;
          if (rtt < this.best + 2) {
            this.best = Math.min(this.best, rtt);
            this.offset = m.s + rtt / 2 - now;
          }
        } else if (m.type === "welcome") {
          this.id = m.id;
          if (this.best === Infinity) this.offset = m.serverNow - performance.now();
        } else this.texts.push(m);
        return;
      }
      const b = shared.decodeBatch(d);
      if (b && this.onBatch) this.onBatch(b, this.serverNow());
    });
    this.ws.send(JSON.stringify({ type: "hello", token: this.token, protocol: shared.MP_PROTOCOL }));
    this.pinger = setInterval(() => this.ws.readyState === 1 && this.ws.send(JSON.stringify({ type: "ping", c: performance.now() })), 500);
    for (let i = 0; i < 100 && !this.id; i++) await sleep(20);
  }
  serverNow() {
    return performance.now() + this.offset;
  }
  send(s) {
    if (this.ws.readyState === 1) this.ws.send(shared.encodeState({ ...s, seq: ++this.seq }));
  }
  close() {
    clearInterval(this.pinger);
    this.ws.close();
  }
}

/** Where the walker really is at server time t (ms): a circle at 1.55 m/s, a jump every `jumpS` s (4.6 m/s up, g 16). */
function truth(t, c) {
  const s = (t - c.t0) / 1000;
  const w = 1.55 / c.r;
  const a = w * s;
  const x = c.x + Math.cos(a) * c.r;
  const z = c.z + Math.sin(a) * c.r;
  const vx = -Math.sin(a) * c.r * w;
  const vz = Math.cos(a) * c.r * w;
  let y = 0;
  let vy = 0;
  let grounded = true;
  if (c.jumpS > 0) {
    const k = s % c.jumpS;
    const air = (2 * 4.6) / 16;
    if (k < air) {
      y = 4.6 * k - 8 * k * k;
      vy = 4.6 - 16 * k;
      grounded = false;
    }
  }
  return { x, y, z, vx, vy, vz, yaw: Math.atan2(-vx, -vz), grounded };
}

/** Walk: 60 frames a second, the state sent 20 times a second as the game sends it (the last frame's pose and time). */
function walker(bot, c, secs) {
  return new Promise((done) => {
    const end = performance.now() + secs * 1000;
    let lastFrame = null;
    const frame = setInterval(() => {
      const t = bot.serverNow();
      lastFrame = { t, ...truth(t, c) };
    }, 1000 / 60);
    let sentAt = 0;
    // (a browser's 50 ms timer keeps time; Windows' timers in node tick in 15.6 ms steps: send once 50 ms have passed)
    const sender = setInterval(() => {
      if (!lastFrame || performance.now() - sentAt < 49) return;
      sentAt = performance.now();
      const f = lastFrame;
      bot.send({ t: f.t, x: f.x, y: f.y, z: f.z, vx: f.vx, vy: f.vy, vz: f.vz, yaw: f.yaw, pitch: 0, mode: 0, flags: f.grounded ? shared.FLAG.grounded : 0, base: 0, lx: 0, ly: 0, lz: 0, lyaw: 0 });
      if (performance.now() > end) {
        clearInterval(frame);
        clearInterval(sender);
        done();
      }
    }, 4);
  });
}

const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};

async function smooth() {
  const base = `http://127.0.0.1:${num("server", 8951)}`;
  const secs = num("secs", 20);
  const via = opt("via", undefined);
  const mover = new Bot(base, await joinBot(base, "Walker"), via);
  const viewer = new Bot(base, await joinBot(base, "Watcher"), via);
  await mover.open();
  await viewer.open();
  await sleep(1500); // the pings settle the clock
  const c = { t0: mover.serverNow(), x: num("x", 0), z: num("z", 0), r: num("radius", 5), jumpS: num("jump", 3) };
  const track = new RemoteTrack();
  const gaps = [];
  let lastArr = 0;
  let lastSentT = 0;
  const sendGaps = [];
  viewer.onBatch = (b, recv) => {
    for (const e of b.list)
      if (e.id === mover.id) {
        if (lastArr) gaps.push(recv - lastArr);
        if (lastSentT) sendGaps.push(e.s.t - lastSentT);
        lastArr = recv;
        lastSentT = e.s.t;
        track.push(e.s, recv);
      }
  };
  const walking = walker(mover, c, secs);
  // the viewer's frames: 60 a second, as a game frame would draw the other man
  const err = [];
  const stepDev = [];
  const yErr = [];
  let last = null;
  let lastTrue = null;
  let frames = 0;
  let prevT = performance.now();
  const drawn = [];
  await new Promise((done) => {
    const iv = setInterval(() => {
      const now = performance.now();
      track.adapt(now - prevT);
      prevT = now;
      const sn = viewer.serverNow();
      const p = track.sample(sn);
      if (!p) return;
      frames++;
      const tt = truth(sn - track.delay, c);
      // (the first 2 s: the delay settles from its start value)
      if (sn - c.t0 > 2000 + track.delay && sn - track.delay < c.t0 + secs * 1000 - 100) {
        err.push(Math.hypot(p.x - tt.x, p.z - tt.z));
        if (process.env.MP_DEBUG && Math.hypot(p.x - tt.x, p.z - tt.z, p.y - tt.y) > 0.1) console.log("big", Math.round(sn - c.t0), p.stale, { dx: +(p.x - tt.x).toFixed(3), dy: +(p.y - tt.y).toFixed(3), dz: +(p.z - tt.z).toFixed(3) }, "buf", track.buf.map((b) => Math.round(b.t - (sn - track.delay))).join(","));
        yErr.push(Math.abs(p.y - tt.y));
        if (last) {
          const step = Math.hypot(p.x - last.x, p.z - last.z, p.y - last.y);
          const trueStep = Math.hypot(tt.x - lastTrue.x, tt.z - lastTrue.z, tt.y - lastTrue.y);
          stepDev.push(Math.abs(step - trueStep));
        }
        drawn.push({ t: sn - track.delay, y: p.y });
      }
      last = p;
      lastTrue = tt;
      if (now - c.t0 + mover.offset > secs * 1000 + 500) {
        clearInterval(iv);
        done();
      }
    }, 1000 / 60);
  });
  await walking;
  mover.close();
  viewer.close();
  const r = {
    secs,
    note: "after the first 2 s; posErr: the drawn man against where he truly was at the drawn time (m); jitter: how much the drawn step from one frame to the next differs from the true step (m)",
    frames,
    delayMs: Math.round(track.delay),
    rttMs: +viewer.best.toFixed(1),
    buffer: track.stats,
    posErr: { p50: +pct(err, 0.5).toFixed(3), p95: +pct(err, 0.95).toFixed(3), max: +Math.max(...err).toFixed(3) },
    jumpHeightErr: { p95: +pct(yErr, 0.95).toFixed(3), max: +Math.max(...yErr).toFixed(3) },
    jitter: { p50: +pct(stepDev, 0.5).toFixed(4), p95: +pct(stepDev, 0.95).toFixed(4), max: +Math.max(...stepDev).toFixed(4) },
    arrivalGapMs: { p95: +pct(gaps, 0.95).toFixed(1), max: +Math.max(...gaps).toFixed(1) },
    stateGapMs: { p95: +pct(sendGaps, 0.95).toFixed(1), max: +Math.max(...sendGaps).toFixed(1) },
    correctionsToMover: mover.texts.filter((m) => m.type !== "roster" && m.type !== "went").length,
  };
  console.log(JSON.stringify(r, null, 1));
  const name = opt("name", "");
  if (name) writeFileSync(path.join(root, "data", `mp-harness-${name}.json`), JSON.stringify(r, null, 1));
}

async function bots(n) {
  const base = `http://127.0.0.1:${num("server", 8951)}`;
  const secs = num("secs", 60);
  const [x, z] = String(opt("at", "0,0")).split(",").map(Number);
  const list = [];
  for (let i = 0; i < n; i++) {
    const b = new Bot(base, await joinBot(base, ["Walker", "Mie", "Tist", "Lien", "Rik", "Wannes"][i % 6]));
    await b.open();
    list.push(b);
  }
  await sleep(1000);
  console.log(`[bots] ${n} walking at ${x},${z} for ${secs} s`);
  await Promise.all(list.map((b, i) => walker(b, { t0: b.serverNow() - i * 1500, x: x + (i % 3) * 2.5, z: z + Math.floor(i / 3) * 2.5, r: num("radius", 4), jumpS: num("jump", 3) }, secs)));
  for (const b of list) b.close();
}

// ------------------------------------------------------------------ a second test vite through the proxy

function listeners(port) {
  try {
    const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8", timeout: 10_000 });
    return [...new Set(out.split(/\r?\n/).filter((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l)).map((l) => l.trim().split(/\s+/).pop()))];
  } catch {
    return [];
  }
}

async function vite() {
  const port = num("vite", 5352);
  const server = num("server", 8952);
  const cfg = path.join(root, "data", `vite-mp-harness-${port}.config.mjs`);
  writeFileSync(
    cfg,
    `// made by tools/mp-harness.mjs (deleted by stop)
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const H = { host: "127.0.0.1:${num("real", 8951)}", origin: "http://127.0.0.1:${num("origin", 5351)}" };
export default { root: path.join(here, "..", "client"), server: { port: ${port}, host: "127.0.0.1", strictPort: true, open: false, hmr: false, fs: { allow: [path.join(here, "..")] },
  // the game server checks Host and Origin (its own ports only): say the stack's own
  proxy: { "/api": { target: "http://127.0.0.1:${server}", headers: H }, "/ws": { target: "ws://127.0.0.1:${server}", ws: true, headers: H }, "/mp": { target: "ws://127.0.0.1:${server}", ws: true, headers: H } } } };
`,
  );
  const log = path.join(root, "data", `mp-harness-vite-${port}.log`);
  const v = spawn(process.execPath, [path.join(root, "client", "node_modules", "vite", "bin", "vite.js"), "--config", cfg], { cwd: path.join(root, "client"), detached: true, windowsHide: true, stdio: ["ignore", openSync(log, "w"), openSync(log, "a")] });
  v.unref();
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`);
      if (r.ok) break;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  console.log(`[vite] http://127.0.0.1:${port}/ -> ${server}`);
}

function stop() {
  for (const p of [num("vite", 5352), num("listen", 8952)])
    for (const pid of listeners(p))
      try {
        execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore", timeout: 10_000 });
      } catch {
        /* gone */
      }
  const port = num("vite", 5352);
  for (const f of [path.join(root, "data", `vite-mp-harness-${port}.config.mjs`), path.join(root, "data", `mp-harness-vite-${port}.log`)]) if (existsSync(f)) rmSync(f, { force: true });
  console.log("[harness] stopped");
}

if (cmd === "proxy") proxy();
else if (cmd === "smooth") await smooth();
else if (cmd === "bot") await bots(1);
else if (cmd === "crowd") await bots(num("players", 5));
else if (cmd === "vite") await vite();
else if (cmd === "stop") stop();
else console.log(String(await import("node:fs").then((f) => f.readFileSync(fileURLToPath(import.meta.url), "utf8"))).split("\n").slice(0, 26).join("\n"));
void http;
