import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { WebSocketServer, WebSocket } from "ws";
import { allowedHost, allowedOrigin, DB_FILE, DEV, HOST, PORT } from "./config.ts";
import { openDb, resetDb } from "./db.ts";
import { closeStaleCalls } from "./ai/claude.ts";
import { mountAiSetup } from "./ai/routes.ts"; // the AI setup: which AI per kind of work, the test, walk-around mode
import { loadAiSetup } from "./ai/setup.ts";
import { plainEnglish } from "./text.ts";
import { mountPlayer } from "./player/routes.ts"; // M7 character: the player's profile
import { hasProfile } from "./player/profile.ts";
import { shownJson } from "./player/prompt.ts";
import { BEDTIME, clock, ending, fogDay, markDayStart, newDayOf, passTime, payRent, RENT_C, rentPaid, resetTickLimit, setEnding, setWeather, swim, tick, type Ending } from "./day.ts";
import { writeEpilogue } from "./hooks/epilogue.ts";
import { resetTalks } from "./hooks/dialogue.ts";
import { devJob, jobById, listJobs, makeBoard } from "./hooks/jobBoard.ts";
import { writeOutcome } from "./hooks/jobOutcome.ts";
import { finishJob, GameError, holdJob, jobRumour, player, ReportSchema, saveOutcome, saveProgress, takeJob } from "./game.ts";
import { gameMinute } from "./town/deeds.ts";
import { ensurePersonas, PLACED, npcRow } from "./npcs.ts";
import { buy, handOverParcel, ITEMS, pockets, useItem, WARES, waresOf } from "./trade.ts";
import { isResident, town } from "./town/store.ts";
import { residentChoice, residentFree, residentOpen } from "./town/talk.ts";
import { catchThief, pickPocket } from "./town/thieves.ts";
import { NIGHT_GIVERS, shownTrade, TOWN_EMPLOYERS } from "./town/places.ts";
import { alight, board as boardRide, change as rideChange, isLine, isStop, ride, RIDE_FARE_C, seat as rideSeat, timetable as rideTimetable } from "./ride.ts";
import { freeReply, openTalk, pickChoice, prefetchOpening, witness, type Line } from "./hooks/dialogue.ts";
import { mountDeeds } from "./town/deedRoutes.ts";
import { mountRowing } from "./town/rowDeeds.ts";
import { mountDirector } from "./director/routes.ts";
import { mountFamilies } from "./director/familyRoutes.ts";
import { mountInteriors } from "./interiors/routes.ts";
import { mountPress } from "./paper/routes.ts";
// M7 shops: where the shops are, who is inside (shops/)
import { mountShops } from "./shops/routes.ts";
import { mountIdeas } from "./ideas/routes.ts";
import { mountHomes } from "./homes/routes.ts";
import { mountTownLife } from "./director/townlife-routes.ts";
import { mountEmigrants } from "./town/emigrantRoutes.ts";
import { mountPrison, thiefCaught } from "./town/prison.ts"; // M7 prison and squares
import { mountLandmarks } from "./landmarks/routes.ts";
import { mountPopulation } from "./town/popsettings.ts";
import { mountHaggle } from "./town/haggleRoutes.ts";
import { waresFor } from "./town/haggle.ts";
import { mountBallads } from "./ballads/routes.ts";
import { mountTransport } from "./town/transportRoutes.ts";
import { mountHandcart } from "./town/handcartRoutes.ts";
import { mountLively } from "./town/livelyRoutes.ts";
import { mountErrands } from "./town/handsRoutes.ts";
import { mountWalkup } from "./town/walkupRoutes.ts";
import { mountRoutines } from "./director/routineRoutes.ts";
import { mountArrival } from "./arrival.ts";
import { mountNight } from "./night/routes.ts";
import { mountRest } from "./restRoutes.ts";
import { mountSaves } from "./save/routes.ts";
import { setPaused, sweepHolders, withGate } from "./save/gate.ts";
import { dropStealables } from "./town/deeds.ts";
import { dropGameWords } from "./ballads/guard.ts";
import { auditCounts, auditSave } from "./town/audit.ts";
import { reportWhere, whereNow } from "./warmth.ts"; // M7 warmth: where Jef is for the cold

const db = openDb(DB_FILE);
const stale = closeStaleCalls(db);
if (stale > 0) console.log(`closed ${stale} model call(s) cut off by the last restart`);
console.log(`[ai] ${loadAiSetup().note}`); // docs/ai-setup.md: data/ai-config.json, before the first call
const app = new Hono();
// Only the game's own pages talk to the server (config.ts allowedHost/allowedOrigin): another site
// in the browser, or a name that points at this machine (DNS rebinding), gets a 403. A body is
// JSON, sent as JSON (a plain form post from another page cannot fake that), and small.
app.use("/api/*", async (c, next) => {
  const origin = c.req.header("origin");
  if (!allowedHost(c.req.header("host")) || (origin !== undefined && !allowedOrigin(origin))) return c.json({ error: "forbidden" }, 403);
  const hasBody = Number(c.req.header("content-length") ?? 0) > 0 || c.req.header("transfer-encoding") !== undefined;
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && hasBody && !/^application\/json\b/i.test(c.req.header("content-type") ?? "")) return c.json({ error: "send JSON" }, 415);
  return next();
});
const tooLarge = (c: Parameters<MiddlewareHandler>[0]) => c.json({ error: "too large" }, 413);
const apiLimit = bodyLimit({ maxSize: 64 * 1024, onError: tooLarge });
const shotLimit = bodyLimit({ maxSize: 16 * 1024 * 1024, onError: tooLarge }); // a dev picture of the game
app.use("/api/*", (c, next) => (c.req.path === "/api/dev/shot" ? shotLimit : apiLimit)(c, next));
// M7 character: the engine's text says "Jef"; what the browser reads says the player's name, and "the
// farm boy", "a young man on the quays" follow the profile (player/prompt.ts shownJson). No profile: as it was.
app.use("/api/*", async (c, next) => {
  await next();
  if (c.req.path.startsWith("/api/player/") || !/json/i.test(c.res.headers.get("content-type") ?? "") || !hasProfile(db)) return;
  const text = await c.res.text();
  const headers = new Headers(c.res.headers);
  headers.delete("content-length");
  c.res = new Response(shownJson(db, text), { status: c.res.status, headers });
});
// Every paid action refreshes the money on screen (QA 2026-09-24: 5 c behind after the fortune,
// paid in a talk choice): a POST that changed Jef's money pushes the new payload to the client.
app.use("/api/*", async (c, next) => {
  if (c.req.method !== "POST") return next();
  const before = moneyNow();
  await next();
  const after = moneyNow();
  if (before !== null && after !== null && after !== before) broadcast({ type: "jobs", ...jobsPayload() });
});
function moneyNow(): number | null {
  try {
    return (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number } | undefined)?.money_c ?? null;
  } catch {
    return null;
  }
}
// M7 save and pause: saves, loads and the pause; first, so its gate sees every request (save/routes.ts)
mountSaves(app, {
  db,
  payload: () => jobsPayload(),
  broadcast: (m) => broadcast(m),
  afterLoad: () => {
    board = { state: "ready" };
    boardAgain = false;
    if (listJobs(db, player(db).day).length === 0) void writeBoard();
    const e = ending(db);
    if (e && !e.epilogue) void epilogue(e);
  },
});
// M6 population: the event size and the town size for a new game (Settings)
mountPopulation(app, db);
// the AI setup (docs/ai-setup.md): GET/PUT /api/ai/config, POST /api/ai/test
mountAiSetup(app, { db });
// M6: emigrant families come and go with the clock (town/emigrants.ts); first, so its after-tick step wraps every tick route
mountEmigrants(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
mountPrison(app, { db }); // M7 prison and squares: the prison in the Begijnenstraat (town/prison.ts)
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
// M7 shops: the shops' doors, hours and who is inside them (shops/)
mountShops(app, { db });
// M6 AI ideas: wall posters, Jef's own letters, jobs that go wrong, news from abroad, lost diaries (ideas/)
mountIdeas(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: homes to rent, the night at home, furniture from the second-hand dealer (homes/)
mountHomes(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m), afterNight: (e) => afterNight(e) });
// M6 town life: the lamplighters' rounds, the soot of a fire, Jef in a bucket chain or at the natie gate
mountTownLife(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: inside the landmarks (the cathedral, the town hall, the Vleeshuis, the Steen, the Oostershuis) and the confessional (landmarks/)
mountLandmarks(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: the ballad singer at the corners and in a tavern, and the Sunday sermon (ballads/)
mountBallads(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6: haggling in your own words, and talking your way out with the police over a complaint (town/haggle.ts, storyWord.ts)
mountHaggle(app, { db, payload: () => jobsPayload() });
// M6 transport: who owns what, errands with a load, Jef's own velocipede (town/possessions.ts, bikeshop.ts)
mountTransport(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6 handcart: Jef's handcart, bought, hired or taken; loads by size and weight (town/handcart.ts)
mountHandcart(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });
// M6 lively: door life by the clock (who scrubs the step, sits with her lace, leans out of the window), the cathedral quarter (town/lively.ts, doorlife.ts)
mountLively(app, { db });
// M6 gifts and hired hands: giving from the pockets, a drink at the tavern, hands paid to carry (town/gifts.ts, treat.ts, hire.ts; director/steps.ts)
mountErrands(app, { db, payload: () => jobsPayload() });
// M7 walk-up: job and quest people come from the living town (town/walkup.ts)
mountWalkup(app, { db });
// M6 AI-composed routines: errands the model plans from Jef's words and steers in check-ins (director/routines.ts)
mountRoutines(app, { db, payload: () => jobsPayload() });
// M7 ferry arrival: a new week begins with Jef on the ferry's deck at the Werf pontoon (arrival.ts)
mountArrival(app, { db });
// M7 character: the player's profile, by player id (player/routes.ts)
mountPlayer(app, { db });
// M7 night: the night's work from the shady givers, the gangs, the quest boxes' settling (night/)
mountNight(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m), afterNight: (e) => afterNight(e) });
// M7 sleep: a bed or a bench, for as long as he chooses; the time passes on the ticks (rest.ts)
mountRest(app, { db, payload: () => jobsPayload(), broadcast: (m) => broadcast(m) });

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
    // M7 fog lamps: today's fog as the lamplighters see it (town/lampround.ts)
    lamps_fog: fogDay(db),
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

// M7 night: the work is done but the employer is at home asleep; the facts wait for the box at his door
app.post("/api/jobs/:id/hold", async (c) => {
  const parsed = ReportSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw new GameError("bad report", 400);
  const job = holdJob(db, Number(c.req.param("id")), parsed.data, gameMinute(db));
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ job, ...jobsPayload() });
});

async function narrate(id: number, settlement: import("./game.ts").Settlement): Promise<void> {
  // M7 night: by id (a job taken before midnight and settled after it is not on the new day's board)
  const job = jobById(db, id);
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

function publicLine(l: Line & { gated?: string; note?: string; wares?: unknown; handover?: unknown }) {
  return {
    npc_line: l.npc_line ? plainEnglish(l.npc_line) : l.npc_line,
    mood: l.mood,
    choices: l.choices?.map(plainEnglish),
    end: l.end_conversation,
    gated: l.gated ?? null,
    // M6 haggle and police story: how it went down, in words, and the seller's prices after a haggle
    ...(l.note ? { note: l.note } : {}),
    ...(l.wares ? { wares: l.wares } : {}),
    // M6 gifts: the thing handed over (the client shows Jef's hand, their take)
    ...(l.handover ? { handover: l.handover } : {}),
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

app.post("/api/tick", async (c) => {
  // M7 warmth: where Jef is and whether his lantern is lit in his hand; checked in warmth.ts, fresh a short while only
  const body = (await c.req.json().catch(() => null)) as { where?: unknown; asleep?: unknown } | null;
  reportWhere(body && typeof body === "object" ? body.where : undefined);
  // M7 sleep: asleep, the tick is a step of the sleep (rest.ts)
  const r = tick(db, Date.now(), { asleep: body?.asleep === true });
  // M7 night: the date turned at midnight (a new board), or the week ended; a night only if he dropped
  const day = newDayOf(r);
  if (day.due) afterNight(day.ended);
  if (r.advanced) broadcast({ type: "jobs", ...jobsPayload() });
  const w = whereNow(db);
  return c.json({ ...r, ...jobsPayload(), where: { shelter: w.shelter, place: w.place, label: w.label, lantern: w.lantern } });
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
  // M7 save and pause: no model call runs into the new week; the saves stay as they are
  await withGate("loading", () => {
    resetDb(db); // a new week: a new town as well (db.ts)
    dropStealables(db);
    dropGameWords(db);
  });
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
  const npc = placed(String(body.npc));
  const r = buy(db, npc, String(body.kind));
  broadcast({ type: "jobs", ...jobsPayload() });
  // the prices after this purchase: a haggled price still good for more stays on the list (QA 2026-09-24)
  return c.json({ ...r, wares: waresFor(db, npc), ...jobsPayload() });
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
  // M7 omnibus routes: the timetable at a stop (the plate on the post), by the game clock
  if (body.action === "timetable") {
    if (!isStop(body.stop)) throw new GameError("no such stop", 400);
    return c.json(rideTimetable(db, body.stop));
  }
  throw new GameError("action must be board, alight, seat or timetable", 400);
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
    // M7 night: the givers of night work stand at their post like the board's employers (their hours: the schedule)
    employers: [...TOWN_EMPLOYERS, ...NIGHT_GIVERS].map((e) => ({ id: e.id, spot: e.spot })),
    residents: t.residents.map((r) => ({
      id: r.id,
      name: r.name,
      first: r.first,
      age: r.age,
      sex: r.sex,
      kind: r.kind,
      trade: r.trade,
      label: shownTrade(r),
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
  r.text += thiefCaught(db, c.req.param("id")); // M7 prison and squares: the police bring him to the prison
  broadcast({ type: "jobs", ...jobsPayload() });
  return c.json({ ...r, ...jobsPayload() });
});

app.post("/api/npc/:id/near", (c) => {
  const id = placed(c.req.param("id"));
  if (isResident(db, id)) return c.json({ ok: true }); // their opening is the engine's: nothing to fetch
  void personasOrTimeout().then(() => prefetchOpening(db, id));
  return c.json({ ok: true });
});

// the prices a seller asks Jef now, a haggled price included (the shop list opened without a talk)
app.get("/api/npc/:id/wares", (c) => c.json({ wares: waresFor(db, placed(c.req.param("id"))) }));

app.post("/api/npc/:id/talk", async (c) => {
  const id = placed(c.req.param("id"));
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string; text?: unknown };
  // a "choice" that was not on offer is typed text: gated and fenced like one (hooks/dialogue.ts, town/talk.ts)
  if (isResident(db, id)) {
    if ((body.kind === "choice" || body.kind === "free") && typeof body.text === "string") {
      const r = body.kind === "choice" ? await residentChoice(db, id, body.text) : await residentFree(db, id, body.text);
      // M7 quest tests: a gift taken (or an errand's coins) left the pockets on screen until the next tick
      broadcast({ type: "jobs", ...jobsPayload() });
      if ("npc_line" in r) return c.json(publicLine(r));
      return c.json({ gated: r.gated });
    }
    return c.json({ ...publicLine(residentOpen(db, id)), wares: waresFor(db, id) });
  }
  await personasOrTimeout();
  if ((body.kind === "choice" || body.kind === "free") && typeof body.text === "string") {
    const r = body.kind === "choice" ? await pickChoice(db, id, body.text) : await freeReply(db, id, body.text);
    if ("npc_line" in r) return c.json(publicLine(r));
    return c.json({ gated: r.gated });
  }
  return c.json({ ...publicLine(await openTalk(db, id)), wares: waresFor(db, id) });
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
  // dev only (docs/testing.md): one job of a chosen kind and twist on today's board
  app.post("/api/dev/job", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Parameters<typeof devJob>[1];
    const r = devJob(db, b);
    broadcast({ type: "jobs", ...jobsPayload() });
    return c.json(r);
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
    // (weather_turn: the weather turns now, as the director's event does, not for the whole day)
    const turnNow = (b as unknown as { weather_turn?: unknown }).weather_turn === true;
    if (w === "fog" || w === "mist" || w === "clear" || w === "rain" || w === "storm") {
      const c = clock(db);
      setWeather(db, w, turnNow ? c.hour + c.minute / 60 : undefined);
    }
    resetTickLimit();
    broadcast({ type: "jobs", ...jobsPayload() });
    return c.json(jobsPayload());
  });
  // dev only (2026-09-26): the save audit (town/audit.ts): every stored spot that does not fit the current map; [] when clean
  app.get("/api/dev/audit", (c) => {
    const findings = auditSave(db);
    return c.json({ count: findings.length, kinds: Object.fromEntries(auditCounts(findings)), findings });
  });
  // dev only (M7 night): move the clock on by game minutes the way the game does, the date turning
  // at midnight on the way (dev/set only sets the hands). The kit's skip() uses it.
  app.post("/api/dev/advance", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { minutes?: unknown };
    const m = Math.max(0, Math.min(24 * 60, Math.round(Number(b.minutes) || 0)));
    if (ending(db)) throw new GameError("the week is over", 409);
    const r = passTime(db, m);
    if (r.turned || r.ended) afterNight(r.ended);
    resetTickLimit();
    broadcast({ type: "jobs", ...jobsPayload() });
    return c.json({ lines: r.lines, turned: r.turned, ...jobsPayload() });
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
const wss = new WebSocketServer({
  server: server as import("node:http").Server,
  path: "/ws",
  // the same rule as /api: the game's own pages only (a browser always sends an Origin here)
  verifyClient: (info: { origin: string; req: import("node:http").IncomingMessage }) => allowedHost(info.req.headers.host) && (!info.req.headers.origin || allowedOrigin(info.origin)),
});
// M7 save and pause: a tab says who it is (?client=): its pause ends when it goes away
const clientOf = new WeakMap<WebSocket, string>();
wss.on("connection", (ws, req) => {
  const id = new URL(req.url ?? "/ws", "http://x").searchParams.get("client")?.slice(0, 40);
  if (id) clientOf.set(ws, id);
  ws.on("close", () => {
    if (id && ![...wss.clients].some((o) => o !== ws && clientOf.get(o) === id)) setPaused(id, false);
  });
  ws.send(shownJson(db, JSON.stringify({ type: "jobs", ...jobsPayload() })));
});
setInterval(() => sweepHolders(new Set([...wss.clients].map((o) => clientOf.get(o)).filter((x): x is string => !!x))), 30_000).unref();

function broadcast(msg: unknown): void {
  const s = shownJson(db, JSON.stringify(msg)); // M7 character: the player's name in every push
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
