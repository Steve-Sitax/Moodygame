import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import { DB_FILE, DEV, HOST, PORT } from "./config.ts";
import { openDb } from "./db.ts";
import { listJobs, makeBoard } from "./hooks/jobBoard.ts";
import { finishJob, GameError, player, takeJob } from "./game.ts";

const db = openDb(DB_FILE);
const app = new Hono();

// Board status the client can show while Claude writes.
let board: { state: "writing" | "ready"; source?: string; error?: string } = { state: "ready" };

function jobsPayload() {
  const p = player(db);
  return { board, jobs: listJobs(db, p.day), player: p };
}

async function writeBoard(): Promise<void> {
  if (board.state === "writing") return;
  board = { state: "writing" };
  broadcast({ type: "jobs", ...jobsPayload() });
  try {
    const r = await makeBoard(db);
    board = { state: "ready", source: r.source, error: r.error };
    console.log(`[job_board] ${r.source} in ${r.ms} ms${r.error ? " (" + r.error + ")" : ""}`);
  } catch (e) {
    board = { state: "ready", source: "error", error: String(e) };
    console.error("[job_board] failed", e);
  }
  broadcast({ type: "jobs", ...jobsPayload() });
}

app.get("/api/state", (c) => c.json(jobsPayload()));
app.get("/api/jobs", (c) => c.json(jobsPayload()));

app.post("/api/jobs/:id/take", (c) => {
  const job = takeJob(db, Number(c.req.param("id")));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ job });
});

app.post("/api/jobs/:id/done", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { delivered?: unknown };
  const res = finishJob(db, Number(c.req.param("id")), Number(body.delivered));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json(res);
});

if (DEV) {
  // dev only: put up a fresh board without waiting for night (M5 adds the day loop)
  app.post("/api/dev/new-board", (c) => {
    void writeBoard();
    return c.json({ started: true });
  });
}

app.onError((err, c) => {
  if (err instanceof GameError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "server error" }, 500);
});

const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
  console.log(`[server] http://${HOST}:${info.port}  db: ${DB_FILE}`);
});

// push channel: the game never waits on a call, results arrive here
const wss = new WebSocketServer({ server: server as import("node:http").Server, path: "/ws" });
wss.on("connection", (ws) => ws.send(JSON.stringify({ type: "jobs", ...jobsPayload() })));

function broadcast(msg: unknown): void {
  const s = JSON.stringify(msg);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(s);
}

// first run of the day: no board yet, so write one now in the background
if (listJobs(db, player(db).day).length === 0) void writeBoard();

function shutdown(): void {
  wss.close();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
