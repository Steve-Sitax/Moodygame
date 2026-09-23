import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { GameError } from "../game.ts";
import { boardExtras } from "../hooks/jobBoard.ts";
import { resident } from "../town/store.ts";
import { factsOf, makePaper, paperOf, PAPER_NAME, PAPER_PRICE_C } from "./newspaper.ts";
import { bergClerk, bergView, forfeitPawns, pawn, redeem, ticketView } from "./pawn.ts";
import { clerkRemark, collectWaiting, deliverAt, discard, ensureLetterRound, letterView, maybeLetter, pickUp, postClerk, postCounter, postView, sendTelegram } from "./post.ts";
import { pressTown } from "./town.ts";

// The HTTP side of M6 (mounted by index.ts): the morning (the post round, an
// announced event, the paper, a letter), the paper and letters to read, the
// Berg's counter, the post counter and the telegraph. Pushes: "paper" (printed),
// "press" (a line for the toast), "clerk" (a clerk's remark, shown as a bubble).

export interface PressDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);

export function mountPress(app: Hono, deps: PressDeps): void {
  const { db, payload, broadcast } = deps;
  const pushJobs = () => broadcast({ type: "jobs", ...payload() });
  const flag = (key: string): number => {
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
    return row ? Number(JSON.parse(row.value_json)) : 0;
  };
  const setFlag = (key: string, day: number) =>
    db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(day));
  const today = () => (db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number });

  // ---- the morning: after the board is up (its jobs are not expired under us any more)
  let running: Promise<void> | null = null;
  const boardUp = (day: number) => !!db.prepare("SELECT 1 FROM log WHERE verb = 'job_board' AND day = ?").get(day);
  const morningCheck = () => {
    const { day } = today();
    if (running || !boardUp(day)) return;
    // the post office's round goes up with the board (once a day; again if a new board expired it)
    if (flag("press_morning") === day) {
      if (ensureLetterRound(db)) pushJobs();
      return;
    }
    if (db.prepare("SELECT 1 FROM world_state WHERE key = 'ending'").get()) return;
    running = morning(day)
      .catch((e) => console.error("[press] morning", e))
      .finally(() => (running = null));
  };

  async function morning(day: number): Promise<void> {
    // pledges past their day went to the Berg's sale in the night
    const sold = forfeitPawns(db);
    for (const p of sold) broadcast({ type: "press", text: `The ticket ran out: the Berg van Barmhartigheid sold ${p.item_name} at its sale.` });
    if (sold.length) pushJobs();
    // the post office's round goes up with the board
    if (ensureLetterRound(db)) pushJobs();
    // now and then the paper announces something for later today (the director's scheduler plans it)
    if (flag("press_coming") !== day) {
      setFlag("press_coming", day);
      await planComing(db).catch((e) => console.warn("[press] coming", e));
    }
    const t0 = Date.now();
    const { paper, error } = await makePaper(db);
    console.log(`[newspaper] day ${day}: ${paper.source} in ${Date.now() - t0} ms${error ? ` (${error})` : ""}`);
    broadcast({ type: "paper", day, cry: paper.cry, headline: paper.headline });
    if (flag("press_letter") !== day) {
      setFlag("press_letter", day);
      const l = await maybeLetter(db);
      if (l) {
        console.log(`[letter] ${l.kind} from ${l.sender_name}: ${l.source}`);
        broadcast({ type: "press", text: l.status === "given" ? `A boy brings you a letter from ${l.sender_name}. (I to read it.)` : `A letter for you waits at the post office.` });
        pushJobs();
      }
    }
    setFlag("press_morning", day);
  }
  boardExtras.push(() => morningCheck());

  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      morningCheck();
    } catch (e) {
      console.error("[press] tick", e);
    }
  });

  /** A clerk's remark, later, as a bubble (never blocks the counter). */
  const remark = (who: string | null, situation: string, fallback: string) => {
    if (!who) return;
    void clerkRemark(db, who, situation, fallback).then((r) => {
      console.log(`[clerk] ${r.source}: ${r.text}`);
      broadcast({ type: "clerk", who, name: resident(db, who)?.name ?? "The clerk", text: r.text, source: r.source });
    });
  };

  // ---- what the client needs to place things: corners, the post office, the Berg
  app.get("/api/press", (c) => {
    const p = pressTown(db);
    const { day } = today();
    const paper = paperOf(db, day);
    return c.json({
      paper: { day, name: PAPER_NAME, price_c: PAPER_PRICE_C, printed: !!paper, cry: paper?.cry ?? null, headline: paper?.headline ?? null },
      corners: p?.corners ?? [],
      post: p?.post ? { ...p.post, at: postCounter(db) } : null,
      berg: p?.berg ?? null,
      medal: p?.medal ?? "owned",
    });
  });

  // ---- reading: only what Jef holds
  app.get("/api/paper/:day", (c) => {
    const day = Number(c.req.param("day"));
    if (!db.prepare("SELECT 1 FROM item WHERE kind = 'newspaper' AND ref = ?").get(day)) throw new GameError("you have no such paper", 404);
    const p = paperOf(db, day);
    if (!p) throw new GameError("no such paper", 404);
    // the small notices: the day's work, in the engine's words, always in the paper
    const notices = factsOf(db, day).filter((f) => f.kind === "work").map((f) => f.text.replace(/^Wanted today: /, ""));
    return c.json({ ...p, notices });
  });
  app.get("/api/letter/:id", (c) => c.json(letterView(db, Number(c.req.param("id")))));
  app.get("/api/ticket/:id", (c) => c.json(ticketView(db, Number(c.req.param("id")))));
  app.post("/api/pockets/discard", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    discard(db, num(b.id));
    pushJobs();
    return c.json(payload());
  });

  // ---- the Berg van Barmhartigheid
  app.get("/api/berg", (c) => c.json(bergView(db)));
  app.post("/api/berg/pawn", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { item?: unknown };
    const r = pawn(db, num(b.item));
    pushJobs();
    remark(bergClerk(db), `Jef pawns ${r.pawn.item_name.replace(/^your /, "his ")}. The Berg lends ${r.pawn.loan_c} centimes on it. Interest ${r.pawn.rate_c} centimes a day. The ticket runs out on day ${r.pawn.due_day}.`, `"Ticket ${1000 + r.pawn.id}. Lose it and you lose the ${r.pawn.item_kind === "medal" ? "medal" : "pledge"}."`);
    return c.json({ ...r, ...payload(), berg: bergView(db) });
  });
  app.post("/api/berg/redeem", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { pawn?: unknown };
    const r = redeem(db, num(b.pawn));
    pushJobs();
    remark(bergClerk(db), `Jef redeems his pledge and pays ${r.paid_c} centimes, the loan and the interest.`, `"Paid and done. Mind you keep it this time."`);
    return c.json({ ...r, ...payload(), berg: bergView(db) });
  });

  // ---- the post office and the telegraph
  app.get("/api/post", (c) => c.json(postView(db)));
  app.post("/api/post/collect", (c) => {
    const r = collectWaiting(db);
    pushJobs();
    return c.json({ ...r, ...payload() });
  });
  const body = async (c: { req: { json: () => Promise<unknown> } }) => (await c.req.json().catch(() => ({}))) as { job?: unknown; index?: unknown; x?: unknown; z?: unknown };
  app.post("/api/post/pickup", async (c) => {
    const b = await body(c);
    const r = pickUp(db, num(b.job), { x: num(b.x), z: num(b.z) });
    pushJobs();
    return c.json({ ...r, ...payload() });
  });
  app.post("/api/post/deliver", async (c) => {
    const b = await body(c);
    const r = deliverAt(db, num(b.job), num(b.index), { x: num(b.x), z: num(b.z) });
    return c.json({ ...r, ...payload() });
  });
  app.post("/api/post/telegram", async (c) => {
    const b = await body(c);
    const r = sendTelegram(db, num(b.job), { x: num(b.x), z: num(b.z) });
    pushJobs();
    remark(postClerk(db), "Jef hands in a telegram and pays the fee at the counter. The clerk sends it down the wire.", `"Sent. It will be there before you are home."`);
    return c.json({ ...r, ...payload() });
  });

  if (DEV) {
    // dev: print today's paper again (the model or the engine), or bring a letter now
    app.post("/api/dev/press", async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { paper?: boolean; letter?: boolean };
      const { day } = today();
      const out: Record<string, unknown> = {};
      if (b.paper) {
        db.prepare("DELETE FROM newspaper WHERE day = ?").run(day);
        const r = await makePaper(db);
        out.paper = { source: r.paper.source, headline: r.paper.headline, error: r.error ?? null };
        broadcast({ type: "paper", day, cry: r.paper.cry, headline: r.paper.headline });
      }
      if (b.letter) {
        const l = await maybeLetter(db, { force: true });
        out.letter = l ? { id: l.id, kind: l.kind, from: l.sender_name, source: l.source, status: l.status } : null;
        if (l) broadcast({ type: "press", text: `A boy brings you a letter from ${l.sender_name}. (I to read it.)` });
      }
      pushJobs();
      return c.json(out);
    });
  }

  // a server started in the middle of a day: the morning may not have happened yet
  setTimeout(() => morningCheck(), 2000);
}

/** Now and then the morning paper announces an event later today (the scheduler's rules). */
async function planComing(db: DB, rng: () => number = Math.random): Promise<void> {
  if (rng() > 0.55) return;
  const { planEvent } = await import("../director/scheduler.ts");
  const { planFromTemplate, templateById } = await import("../director/templates.ts");
  const { day, hour } = db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };
  const start = 150 + Math.floor(rng() * 30);
  const at = hour + start / 60;
  const ids = ["fish_auction", "musicians", "emigrant_ship", "wedding", "funeral"].sort(() => rng() - 0.5);
  for (const id of ids) {
    const t = templateById(id) as (ReturnType<typeof templateById> & { fits?: (d: number, h: number) => boolean }) | null;
    if (!t || (t.fits && !t.fits(day, at))) continue;
    const r = planEvent(db, planFromTemplate(t, "engine", { start_in_min: start, why: "announced in the morning paper" }));
    if (r.ok) return;
  }
}
