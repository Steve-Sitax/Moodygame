import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer, WebSocket } from "ws";
import { DB_FILE, DEV, HOST, PORT } from "./config.ts";
import { openDb, resetDb } from "./db.ts";
import { plainEnglish } from "./text.ts";
import { BEDTIME, clock, ending, markDayStart, payRent, RENT_C, rentPaid, resetTickLimit, setEnding, setWeather, sleep, swim, tick, type Ending } from "./day.ts";
import { writeEpilogue } from "./hooks/epilogue.ts";
import { resetTalks } from "./hooks/dialogue.ts";
import { listJobs, makeBoard } from "./hooks/jobBoard.ts";
import { writeOutcome } from "./hooks/jobOutcome.ts";
import { finishJob, GameError, jobRumour, player, ReportSchema, saveOutcome, saveProgress, takeJob } from "./game.ts";
import { ensurePersonas, PLACED, npcRow } from "./npcs.ts";
import { buy, handOverParcel, ITEMS, pockets, useItem, WARES, waresOf } from "./trade.ts";
import { isResident, town } from "./town/store.ts";
import { residentChoice, residentFree, residentOpen } from "./town/talk.ts";
import { catchThief, pickPocket } from "./town/thieves.ts";
import { TRADES, TOWN_EMPLOYERS } from "./town/places.ts";
import { alight, board as boardRide, change as rideChange, isLine, isStop, ride, RIDE_FARE_C, seat as rideSeat } from "./ride.ts";
import { freeReply, openTalk, pickChoice, prefetchOpening, witness, type Line } from "./hooks/dialogue.ts";
import { mountDeeds } from "./town/deedRoutes.ts";
import { mountRowing } from "./town/rowDeeds.ts";
import { mountDirector } from "./director/routes.ts";
import { mountFamilies } from "./director/familyRoutes.ts";
import { mountInteriors } from "./interiors/routes.ts";
import { mountPress } from "./paper/routes.ts";
import { mountIdeas } from "./ideas/routes.ts";
import { mountHomes } from "./homes/routes.ts";
import { mountTownLife } from "./director/townlife-routes.ts";
import { mountEmigrants } from "./town/emigrantRoutes.ts";

const db = openDb(DB_FILE);
const app = new Hono();
// M6: emigrant families come and go with the clock (town/emigrants.ts); first, so its after-tick step wraps every tick route
mountEmigrants(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M4: townspeople who act, conversations in the street, the director and its events; first, so its
// talk middleware (the event log) sees every talk before the police take theirs
// M6: families who share and act, the fortune teller, strangers, schemes, dreams; first, so its
// day-change check wraps every route that can end a night
mountFamilies(app, { db, payload: () => jobsPayload() });
mountDirector(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// theft, velocipedes, lanterns and the police (M3h); before the talk route, so the agent answers through it
mountDeeds(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m), afterNight: (e) => afterNight(e) });
// rowing boats for hire, and boats to steal (M3j): the server takes the hire, the fines and the price of a lost boat
mountRowing(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: inside the taverns (drink, dice, gossip) and the Poesje puppet cellar (interiors/)
mountInteriors(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: the morning paper and the newsboys, the post and the telegraph, the Berg van Barmhartigheid (paper/)
mountPress(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6 AI ideas: wall posters, Jef's own letters, jobs that go wrong, news from abroad, lost diaries (ideas/)
mountIdeas(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: homes to rent, the night at home, furniture from the second-hand dealer (homes/)
mountHomes(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m), afterNight: (e) => afterNight(e) });
// M6 town life: the lamplighters' rounds, the soot of a fire, Jef in a bucket chain or at the natie gate
mountTownLife(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });

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
    ride: { on: ride(db), fare_c: RIDE_FARE_C, change: rideChange(db) },
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
  saveOutcome(db, id, r.outcome.narration, r.outcome.memory, r.outcome.weight, jobRumour(job, settlement));
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
  if (isResident(db, id)) return id; // M3e: everyone in town talks
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

app.post("/api/new-game", async (c) => {
  // keep the old week: a copy of the save in data/backups before it is wiped
  if (DB_FILE !== ":memory:") {
    const dir = join(dirname(DB_FILE), "backups");
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    await db.backup(join(dir, `week-${stamp}.sqlite`)).catch((e: unknown) => console.warn("[new-game] backup failed", e));
  }
  resetDb(db); // a new week: a new town as well (db.ts)
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

// ---- a dip in the Schelde: the cold costs warmth (the client never changes needs itself)
app.post("/api/swim", (c) => {
  const r = swim(db);
  if (r.cold) broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

// ---- the horse omnibuses (M3g): the server takes the fare, allows one free change, and knows who rides
app.post("/api/ride", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { action?: unknown; stop?: unknown; line?: unknown; place?: unknown };
  if (ending(db)) throw new GameError("the week is over", 409);
  if (body.action === "board") {
    if (!isStop(body.stop)) throw new GameError("no such stop", 400);
    if (!isLine(body.line)) throw new GameError("no such line", 400);
    const r = boardRide(db, body.stop, body.line);
    broadcast({ type: "jobs", ...jobsPayload() });
    return c.json({ ...r, ...jobsPayload() });
  }
  if (body.action === "alight") {
    const r = alight(db);
    return c.json({ ...r, ...jobsPayload() });
  }
  if (body.action === "seat") {
    if (body.place !== "inside" && body.place !== "roof") throw new GameError("place must be inside or roof", 400);
    const r = rideSeat(db, body.place);
    return c.json({ ...r, ...jobsPayload() });
  }
  throw new GameError("action must be board, alight or seat", 400);
});

app.post("/api/jobs/:id/handover", (c) => {
  const id = Number(c.req.param("id"));
  const j = listJobs(db, player(db).day).find((r) => r.id === id);
  if (!j || j.status !== "taken" || j.task?.kind !== "deliver") throw new GameError("nothing to hand over", 409);
  handOverParcel(db, id);
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json(jobsPayload());
});

// ---- the town (M3e): residents, their homes, work and days; stalls and shop fronts.
// No numbers about Jef here: stats of the townspeople stay on the server too.
app.get("/api/town", (c) => {
  const t = town(db).town;
  return c.json({
    seed: t.seed,
    places: t.places,
    stalls: t.stalls,
    shops: t.shops,
    employers: TOWN_EMPLOYERS.map((e) => ({ id: e.id, spot: e.spot })),
    residents: t.residents.map((r) => ({
      id: r.id,
      name: r.name,
      first: r.first,
      age: r.age,
      sex: r.sex,
      kind: r.kind,
      trade: r.trade,
      label: TRADES[r.trade].label,
      household: r.household,
      role: r.family_role,
      home: r.home,
      work: r.work,
      sched: r.sched,
      dog: r.dog,
      mate: r.mate ?? null,
      wares: waresOf(db, r.id).map((w) => ({ ...w, name: ITEMS[w.kind].name })),
    })),
  });
});

app.post("/api/resident/:id/pick", (c) => {
  const r = pickPocket(db, c.req.param("id"));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/resident/:id/catch", (c) => {
  const r = catchThief(db, c.req.param("id"));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/npc/:id/near", (c) => {
  const id = placed(c.req.param("id"));
  if (isResident(db, id)) return c.json({ ok: true }); // their opening is the engine's: nothing to fetch
  void personasOrTimeout().then(() => prefetchOpening(db, id));
  return c.json({ ok: true });
});

app.post("/api/npc/:id/talk", async (c) => {
  const id = placed(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string; text?: unknown };
  if (isResident(db, id)) {
    if (body.kind === "choice" && typeof body.text === "string") return c.json(publicLine(await residentChoice(db, id, body.text)));
    if (body.kind === "free" && typeof body.text === "string") {
      const r = await residentFree(db, id, body.text);
      if ("npc_line" in r) return c.json(publicLine(r));
      return c.json({ gated: r.gated });
    }
    return c.json(publicLine(residentOpen(db, id)));
  }
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
    // the dev menu may set the weather (only the five known kinds)
    const w = (b as unknown as { weather?: unknown }).weather;
    if (w === "fog" || w === "mist" || w === "clear" || w === "rain" || w === "storm") setWeather(db, w);
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
