import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { boardExtras } from "../hooks/jobBoard.ts";
import { talkHooks } from "../town/talk.ts";
import { paperOf } from "../paper/newspaper.ts";
import { flag, now, setFlag } from "./common.ts";
import { newsRow, newsTalkLine, rollNews, NEWS_TABLE } from "./abroad.ts";
import { morningPlans, pickLost, posterView, putUp, returnLost, takeDown, wantedPlans, lostPlan, POSTERS_UP_MAX } from "./posters.ts";
import { answerLetters, meet, meetingsOpen, missMeetings, postLetter, STAMP_C, LETTER_MAX_CHARS, writeTo } from "./letters.ts";
import { chooseTrouble, maybeTrouble, troubleStep, troubleView, TROUBLE_KINDS, type TroubleKind } from "./trouble.ts";
import { diaryWorld, maybeDiary, pickDiary, readDiary, returnDiary, sellDiary, squeeze } from "./diaries.ts";

// The HTTP side of the M6 AI ideas (mounted by index.ts, after the paper): the morning
// (bills up and down, replies to Jef's letters, a lost notebook), the tick (a wanted
// bill after a theft, rewards, missed meetings), trouble on a job when it is taken,
// and the routes for the client. Pushes: "ideas" (the world changed: fetch /api/ideas),
// "press" (a line for the toast), "trouble" (words for the running job are ready).

export interface IdeasDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
type Body = { x?: unknown; z?: unknown; n?: unknown; to?: unknown; text?: unknown };
const body = async (c: { req: { json: () => Promise<unknown> } }) => (await c.req.json().catch(() => ({}))) as Body;
const at = (b: Body) => ({ x: num(b.x), z: num(b.z) });

export function mountIdeas(app: Hono, deps: IdeasDeps): void {
  const { db, payload, broadcast } = deps;
  const pushJobs = () => broadcast({ type: "jobs", ...payload() });
  const pushWorld = () => broadcast({ type: "ideas" });
  const say = (text: string) => broadcast({ type: "press", text });

  // the news from abroad in the talk of the traders and dockers (the director installs the
  // talk hooks first; this adds one line to what it gives, and changes nothing else)
  const ctx = talkHooks.context;
  talkHooks.context = (d, r) => ctx(d, r) + newsTalkLine(d, r.trade);

  // ---- the morning, after the paper is printed (the news from abroad is in it)
  let running: Promise<void> | null = null;
  const boardUp = (day: number) => !!db.prepare("SELECT 1 FROM log WHERE verb = 'job_board' AND day = ?").get(day);
  const check = () => {
    const { day } = now(db);
    if (running || !boardUp(day) || db.prepare("SELECT 1 FROM world_state WHERE key = 'ending'").get()) return;
    if (flag(db, "ideas_morning") === day) {
      running = during().finally(() => (running = null));
      return;
    }
    if (!paperOf(db, day)) return;
    running = morning(day)
      .catch((e) => console.error("[ideas] morning", e))
      .finally(() => (running = null));
  };

  async function morning(day: number): Promise<void> {
    setFlag(db, "ideas_morning", day);
    const down = takeDown(db);
    missMeetings(db);
    for (const r of await answerLetters(db)) {
      console.log(`[letter_reply] ${r.from}: ${r.effect.kind} (${r.source})`);
      say(`A reply to your letter, from ${r.from}. (I to read it.)${r.effect.kind === "invite" ? ` ${r.from.split(" ")[0]} asks you to come by the door today.` : r.effect.kind === "gift" ? ` Something came with it: ${r.effect.name}.` : ""}`);
    }
    const d = await maybeDiary(db);
    if (d) console.log(`[diary] ${d.owner} lost a notebook (${d.source})`);
    const plans = morningPlans(db);
    const ids = await putUp(db, plans);
    if (ids.length) console.log(`[poster] ${ids.length} bills up (${plans.map((p) => p.kind).join(", ")})`);
    if (down.length || ids.length || d) pushWorld();
    pushJobs();
  }

  /** In the day: a wanted bill after a theft, a solved robbery's reward, meetings missed. */
  async function during(): Promise<void> {
    const down = takeDown(db);
    for (const x of down) if (x.paid_c) say(`The police paid you the ${x.paid_c} centimes reward on the bill: the pickpocket you named was found.`);
    missMeetings(db);
    const up = (db.prepare("SELECT COUNT(*) AS n FROM poster WHERE status = 'up'").get() as { n: number }).n;
    const plans = up < POSTERS_UP_MAX ? wantedPlans(db).slice(0, 2) : [];
    const ids = await putUp(db, plans).catch((e) => (console.error("[poster]", e), [] as number[]));
    if (ids.length) console.log(`[poster] wanted bill up (${plans.map((p) => p.ref).join(", ")})`);
    if (down.length || ids.length) {
      pushWorld();
      pushJobs();
    }
  }

  boardExtras.push(() => check());
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      check();
    } catch (e) {
      console.error("[ideas] tick", e);
    }
  });

  // ---- trouble on a job: rolled when it is taken (the words follow; the game never waits)
  app.use("/api/jobs/:id/take", async (c, next) => {
    await next();
    if (c.res.status !== 200) return;
    const id = Number(c.req.param("id"));
    void maybeTrouble(db, id)
      .then((t) => {
        if (t) {
          console.log(`[trouble] job ${id}: ${t.kind} (${t.source})`);
          broadcast({ type: "trouble", job_id: id });
        }
      })
      .catch((e) => console.error("[trouble]", e));
  });

  // ---- what the client needs to place things
  const takenJob = () => (db.prepare("SELECT id FROM job WHERE status = 'taken'").get() as { id: number } | undefined)?.id ?? null;
  app.get("/api/ideas", (c) => {
    const j = takenJob();
    return c.json({ ...posterView(db), diaries: diaryWorld(db), meetings: meetingsOpen(db), trouble: j ? troubleView(db, j) : null, news: newsRow(db, now(db).day) });
  });

  // ---- lost things on the bills
  app.post("/api/posters/:id/pick", async (c) => {
    const r = pickLost(db, Number(c.req.param("id")), at(await body(c)));
    pushWorld();
    return c.json({ ...r, ...payload() });
  });
  app.post("/api/posters/:id/return", async (c) => {
    const r = returnLost(db, Number(c.req.param("id")), at(await body(c)));
    pushWorld();
    pushJobs();
    return c.json({ ...r, ...payload() });
  });

  // ---- Jef's own letters
  app.get("/api/post/write", (c) => c.json({ to: writeTo(db), stamp_c: STAMP_C, max_chars: LETTER_MAX_CHARS }));
  app.post("/api/post/write", async (c) => {
    const b = await body(c);
    const r = postLetter(db, String(b.to ?? ""), b.text, at(b));
    pushJobs();
    return c.json({ text: r.text, letter: { id: r.letter.id, to: r.letter.to_name, reply_day: r.letter.reply_day }, ...payload() });
  });
  app.post("/api/meet/:id", async (c) => {
    const r = meet(db, Number(c.req.param("id")), at(await body(c)));
    pushWorld();
    return c.json({ ...r, ...payload() });
  });

  // ---- trouble on the running job
  app.get("/api/trouble", (c) => {
    const j = takenJob();
    return c.json({ trouble: j ? troubleView(db, j) : null });
  });
  app.post("/api/trouble/:id/choose", async (c) => {
    const r = chooseTrouble(db, Number(c.req.param("id")), num((await body(c)).n));
    pushJobs();
    const j = takenJob();
    return c.json({ ...r, trouble: j ? troubleView(db, j) : null, ...payload() });
  });
  app.post("/api/trouble/:id/step", async (c) => {
    const r = troubleStep(db, Number(c.req.param("id")), at(await body(c)));
    const j = takenJob();
    return c.json({ ...r, trouble: j ? troubleView(db, j) : null });
  });

  // ---- lost notebooks
  app.get("/api/diary/:id", (c) => c.json(readDiary(db, Number(c.req.param("id")))));
  const diaryAct = (path: string, f: (id: number, p: { x: number; z: number }) => { text: string }) =>
    app.post(`/api/diary/:id/${path}`, async (c) => {
      const r = f(Number(c.req.param("id")), at(await body(c)));
      pushWorld();
      pushJobs();
      return c.json({ ...r, ...payload() });
    });
  diaryAct("pick", (id, p) => pickDiary(db, id, p));
  diaryAct("return", (id, p) => returnDiary(db, id, p));
  diaryAct("sell", (id, p) => sellDiary(db, id, p));
  diaryAct("squeeze", (id, p) => squeeze(db, id, p));

  if (DEV) {
    // dev: force a piece of each idea now (on a test save)
    app.post("/api/dev/ideas", async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { posters?: boolean; lost?: boolean; news?: string | boolean; diary?: string | boolean; trouble?: string; replies?: boolean };
      const out: Record<string, unknown> = {};
      const { day } = now(db);
      if (b.news) {
        db.prepare("DELETE FROM news_abroad WHERE day = ?").run(day);
        const key = typeof b.news === "string" ? b.news : NEWS_TABLE[0].key;
        const ship = db.prepare("SELECT data_json FROM world_event WHERE day = ? AND verb = 'ship_in' ORDER BY id LIMIT 1").get(day) as { data_json: string } | undefined;
        out.news = rollNews(db, day, ship ? (JSON.parse(ship.data_json) as { name: string; type: string }) : null, undefined, key);
      }
      if (b.posters) out.posters = await putUp(db, morningPlans(db, Math.random));
      if (b.lost) {
        const l = lostPlan(db, Math.random);
        out.lost = l ? await putUp(db, [l]) : null;
      }
      if (b.diary) {
        const d = await maybeDiary(db, { force: typeof b.diary === "string" ? b.diary : "*", rng: Math.random });
        out.diary = d ? { id: d.id, owner: d.owner, x: d.x, z: d.z, source: d.source } : null;
      }
      if (b.replies) {
        db.prepare("UPDATE jef_letter SET reply_day = ? WHERE status = 'sent'").run(day);
        out.replies = await answerLetters(db);
      }
      if (b.trouble) {
        const j = takenJob();
        if (j) {
          db.prepare("DELETE FROM job_trouble WHERE job_id = ?").run(j);
          const kind = (TROUBLE_KINDS as string[]).includes(b.trouble) ? (b.trouble as TroubleKind) : undefined;
          const t = await maybeTrouble(db, j, { force: kind ?? TROUBLE_KINDS[0], rng: Math.random });
          if (t) db.prepare("UPDATE job_trouble SET after_s = 2 WHERE id = ?").run(t.id);
          out.trouble = t ? troubleView(db, j) : "that trouble does not fit this job";
          broadcast({ type: "trouble", job_id: j });
        } else out.trouble = "take a job first";
      }
      pushWorld();
      pushJobs();
      return c.json(out);
    });
  }

  setTimeout(() => check(), 2500);
}
