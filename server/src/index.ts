import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import { DB_FILE, DEV, HOST, PORT } from "./config.ts";
import { openDb, resetDb } from "./db.ts";
import { plainEnglish } from "./text.ts";
import { BEDTIME, clock, ending, markDayStart, payRent, RENT_C, rentPaid, resetTickLimit, setEnding, sleep, tick, type Ending } from "./day.ts";
import { writeEpilogue } from "./hooks/epilogue.ts";
import { resetTalks } from "./hooks/dialogue.ts";
import { listJobs, makeBoard } from "./hooks/jobBoard.ts";
import { writeOutcome } from "./hooks/jobOutcome.ts";
import { finishJob, GameError, player, ReportSchema, saveOutcome, saveProgress, takeJob } from "./game.ts";
import { ensurePersonas, PLACED, npcRow } from "./npcs.ts";
import { buy, handOverParcel, ITEMS, pockets, useItem, WARES } from "./trade.ts";
import { freeReply, openTalk, pickChoice, prefetchOpening, witness, type Line } from "./hooks/dialogue.ts";

const db = openDb(DB_FILE);
const app = new Hono();

// Board status the client can show while Claude writes.
let board: { state: "writing" | "ready"; source?: string; error?: string } = { state: "ready" };

function jobsPayload() {
  const p = player(db);
  return {
    board,
    jobs: listJobs(db, p.day),
    player: p,
    pockets: pockets(db),
    clock: clock(db),
    rent: { paid: rentPaid(db), price_c: RENT_C, bedtime: BEDTIME },
    ending: ending(db),
  };
}

let boardAgain = false;
async function writeBoard(): Promise<void> {
  if (board.state === "writing") {
    boardAgain = true; // a new day began while the old board was still being written
    return;
  }
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
  if (boardAgain) {
    boardAgain = false;
    void writeBoard();
  }
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

// ---- people (M3). Trust stays hidden: the client gets words, never numbers (docs/08).

const personasReady = ensurePersonas(db)
  .then((r) => console.log(`[persona] ${r.join(", ") || "all present"}`))
  .catch((e) => console.error("[persona] failed", e));

/** Wait a little for personas on first start, never long. */
const personasOrTimeout = () => Promise.race([personasReady, new Promise((r) => setTimeout(r, 5000))]);

function placed(id: string): string {
  if (!(id in PLACED) || !npcRow(db, id)) throw new GameError("nobody by that name here", 404);
  return id;
}

function publicLine(l: Line & { gated?: string }) {
  return {
    npc_line: l.npc_line ? plainEnglish(l.npc_line) : l.npc_line,
    mood: l.mood,
    choices: l.choices?.map(plainEnglish),
    end: l.end_conversation,
    gated: l.gated ?? null,
  };
}

app.get("/api/npcs", (c) =>
  c.json(
    Object.keys(PLACED).map((id) => ({
      id,
      name: npcRow(db, id)!.name,
      role: npcRow(db, id)!.role,
      wares: (WARES[id] ?? []).map((w) => ({ ...w, name: ITEMS[w.kind].name })),
    })),
  ),
);

// ---- the day and the week (M5)

/** Called when a night ends: a new board for the new day, or the epilogue. */
function afterNight(ended?: Ending): void {
  if (ended) void epilogue(ended);
  else void writeBoard();
}

async function epilogue(e: Ending): Promise<void> {
  const r = await writeEpilogue(db, e);
  setEnding(db, { ...e, epilogue: r.epilogue });
  console.log(`[epilogue] ${r.source}${r.error ? " (" + r.error + ")" : ""}`);
  broadcast({ type: "jobs", ...jobsPayload() });
}

app.post("/api/tick", (c) => {
  const r = tick(db);
  if (r.night) afterNight(r.night.ended);
  if (r.ended && !r.night) void epilogue(r.ended);
  if (r.advanced) broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/sleep", (c) => {
  if (ending(db)) throw new GameError("the week is over", 409);
  const h = clock(db).hour;
  const tired = player(db).sleep <= 2;
  if (h < BEDTIME && !tired) throw new GameError(`the doss house opens its beds at ${BEDTIME}:00`, 409);
  const night = sleep(db, "bed");
  afterNight(night.ended);
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ night, ...jobsPayload() });
});

app.post("/api/rent", (c) => {
  const r = payRent(db);
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/new-game", (c) => {
  resetDb(db);
  resetTalks();
  markDayStart(db);
  void ensurePersonas(db).then((r) => console.log(`[persona] ${r.join(", ")}`));
  void writeBoard();
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json(jobsPayload());
});

// ---- pockets and paying (M3b)

app.post("/api/buy", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { npc?: string; kind?: string };
  const r = buy(db, placed(String(body.npc)), String(body.kind));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/use", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { id?: number };
  const r = useItem(db, Number(body.id));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/jobs/:id/handover", (c) => {
  const id = Number(c.req.param("id"));
  const j = listJobs(db, player(db).day).find((r) => r.id === id);
  if (!j || j.status !== "taken" || j.task?.kind !== "deliver") throw new GameError("nothing to hand over", 409);
  handOverParcel(db, id);
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json(jobsPayload());
});

app.post("/api/npc/:id/near", (c) => {
  const id = placed(c.req.param("id"));
  void personasOrTimeout().then(() => prefetchOpening(db, id));
  return c.json({ ok: true });
});

app.post("/api/npc/:id/talk", async (c) => {
  const id = placed(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string; text?: unknown };
  await personasOrTimeout();
  if (body.kind === "choice" && typeof body.text === "string") return c.json(publicLine(await pickChoice(db, id, body.text)));
  if (body.kind === "free" && typeof body.text === "string") {
    const r = await freeReply(db, id, body.text);
    if ("npc_line" in r) return c.json(publicLine(r));
    return c.json({ gated: r.gated });
  }
  return c.json(publicLine(await openTalk(db, id)));
});

app.post("/api/npc/:id/witness", async (c) => {
  const id = placed(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { event?: string };
  if (body.event !== "took" && body.event !== "returned") throw new GameError("bad event", 400);
  witness(db, id, body.event);
  return c.json({ ok: true });
});

if (DEV) {
  // dev only: put up a fresh board without waiting for night (M5 adds the day loop)
  app.post("/api/dev/new-board", (c) => {
    void writeBoard();
    return c.json({ started: true });
  });
  // dev only: a picture of the game from the browser, for checks without a screen
  app.post("/api/dev/shot", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { name?: string; url?: string };
    const name = String(b.name ?? "shot").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "shot";
    const m = /^data:image\/jpeg;base64,(.+)$/.exec(b.url ?? "");
    if (!m) throw new GameError("bad picture", 400);
    const dir = join(dirname(DB_FILE), "shots");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.jpg`), Buffer.from(m[1], "base64"));
    return c.json({ ok: true });
  });
  // dev only: jump the clock or set needs, to test the night without waiting
  app.post("/api/dev/set", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, number>;
    for (const k of ["day", "hour", "minute", "food", "warmth", "health", "sleep", "money_c"]) {
      if (typeof b[k] === "number") db.prepare(`UPDATE player SET ${k} = ? WHERE id = 1`).run(Math.round(b[k]));
    }
    resetTickLimit();
    broadcast({ type: "jobs", ...jobsPayload() });
    return c.json(jobsPayload());
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
if (!db.prepare("SELECT 1 FROM world_state WHERE key = 'day_start_money'").get()) markDayStart(db);
// the server stopped while the epilogue was being written: write it again
{
  const e = ending(db);
  if (e && !e.epilogue) void epilogue(e);
}

function shutdown(): void {
  wss.close();
  server.close();
  db.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
