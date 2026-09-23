import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import { DB_FILE, DEV, HOST, PORT } from "./config.ts";
import { openDb } from "./db.ts";
import { listJobs, makeBoard } from "./hooks/jobBoard.ts";
import { writeOutcome } from "./hooks/jobOutcome.ts";
import { finishJob, GameError, player, ReportSchema, saveOutcome, saveProgress, takeJob } from "./game.ts";

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

app.post("/api/jobs/:id/progress", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const job = saveProgress(db, Number(c.req.param("id")), {
    delivered: Number(body.delivered),
    lost: Number(body.lost),
    sold: Number(body.sold),
  });
  return c.json({ job });
});

app.post("/api/jobs/:id/done", async (c) => {
  const parsed = ReportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new GameError("bad report", 400);
  const res = finishJob(db, Number(c.req.param("id")), parsed.data);
  broadcast({ type: "jobs", ...jobsPayload() });
  // the words come later; the game never waits for them
  void narrate(res.job.id, res.settlement);
  // no work left on the board: put up a fresh one (stand-in until the M5 day loop)
  if (!listJobs(db, player(db).day).some((j) => j.status === "offered" && j.playable)) void writeBoard();
  return c.json(res);
});

async function narrate(id: number, settlement: import("./game.ts").Settlement): Promise<void> {
  const job = listJobs(db, player(db).day).find((j) => j.id === id);
  if (!job) return;
  const r = await writeOutcome(db, job, settlement);
  saveOutcome(db, id, r.outcome.narration, r.outcome.memory, r.outcome.weight);
  console.log(`[job_outcome] ${r.source}${r.error ? " (" + r.error + ")" : ""}`);
  broadcast({ type: "outcome", job_id: id, text: r.outcome.narration, employer: job.employer_name });
}

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
