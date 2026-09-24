import { z } from "zod";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { GameError, log, player } from "../game.ts";
import { listJobs, maxTier, TIER_PAY, type JobRow, type LettersTask, type RoundStop } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { atWork, POCKET_SLOTS } from "../trade.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import { resident, town } from "../town/store.ts";
import { writeEvent } from "../director/eventlog.ts";
import { canCallPress, dateLine } from "./newspaper.ts";
import { POST_LABEL, pressTown } from "./town.ts";

// The post and the telegraph (M6). The ENGINE decides everything with a number
// or a consequence: the post office's round (which doors, what it pays, within
// the board's tier band), who writes to Jef, why and when, what they ask and what
// it pays, the telegraph fee (50 centimes for 20 words, the Belgian tariff of
// 1865). The model only writes a letter's words. A letter that names a sum the
// engine did not set, or tries to give Jef anything, is replaced by the engine's
// own letter: words never move money.

/** The Belgian inland telegram, 1865-1876: 50 centimes for 20 words. */
export const TELEGRAM_FEE_C = 50;
export const TELEGRAM_WORDS = 20;
/** Letters to Jef in a week, at most. */
export const LETTERS_PER_WEEK = 4;
const REACH_M = 4.5;

const TELEGRAPH_CITIES = ["Brussels", "Ghent", "Liege", "Mechelen", "Rotterdam", "London", "Cologne", "Paris", "Bruges", "Ostend"];
const STRANGER_SIGNS = ["V.", "A friend of your late father", "M. de B.", "One who watches the river", "The lady in grey", "A well-wisher", "L. H., of Brussels"];

// ------------------------------------------------------------------ helpers

function now(db: DB): { day: number; hour: number } {
  return db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };
}
const round5 = (n: number) => Math.round(n / 5) * 5;
const d2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

export function postClerk(db: DB): string | null {
  return pressTown(db)?.post?.clerk ?? null;
}

/** Where the counter is: the clerk's place by the office door. */
export function postCounter(db: DB): { x: number; z: number; label: string } | null {
  const p = pressTown(db)?.post;
  if (!p) return null;
  const c = resident(db, p.clerk);
  const at = c?.work.at;
  return at ? { x: at[0], z: at[1], label: POST_LABEL } : { x: p.step[0], z: p.step[1], label: POST_LABEL };
}

function postOpen(db: DB): boolean {
  const c = postClerk(db);
  return !!c && atWork(db, c);
}

/** Order the stops as a walk: always the nearest next (the post office first). */
function asRound(start: { x: number; z: number }, stops: RoundStop[]): RoundStop[] {
  const left = stops.slice();
  const out: RoundStop[] = [];
  let at = start;
  while (left.length) {
    left.sort((a, b) => d2(at, a) - d2(at, b));
    const s = left.shift()!;
    out.push(s);
    at = s;
  }
  return out;
}

function routeLength(start: { x: number; z: number }, stops: RoundStop[]): number {
  let at = start;
  let len = 0;
  for (const s of stops) {
    len += d2(at, s);
    at = s;
  }
  return len;
}

function insertJob(db: DB, j: { title: string; employer: string; pay_c: number; pitch: string; task: LettersTask; source: string; district?: string }): number {
  const { day } = now(db);
  const tier = maxTier(db);
  return Number(
    db
      .prepare(
        `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
         VALUES (?, ?, ?, ?, 'letters', ?, 'low', ?, NULL, ?, ?, ?, 'offered')`,
      )
      .run(day, j.title.slice(0, 70), j.employer, j.district ?? "grote-markt", j.pay_c, tier, j.pitch.slice(0, 360), JSON.stringify(j.task), j.source).lastInsertRowid,
  );
}

// ------------------------------------------------------------------ the post office's round

/** People who can get a letter: grown, a door of their own, not the clerk. */
function addressees(db: DB): Resident[] {
  const clerk = postClerk(db);
  return town(db).town.residents.filter((r) => r.age >= 16 && r.id !== clerk && r.trade !== "soldier" && r.trade !== "sentry" && r.trade !== "corporal");
}

/**
 * The day's round from the post office (once a day, not on Sunday): 3 to 5 doors of
 * different households in one part of the town (the nearest to a door picked 40 to 220 m
 * from the office), walked nearest-first. The pay is the board's: within the tier band,
 * by doors and distance.
 */
export function ensureLetterRound(db: DB, rng?: () => number): number | null {
  const { day } = now(db);
  if (day % 7 === 0) return null; // Sunday: the post is shut
  const clerk = postClerk(db);
  const counter = postCounter(db);
  if (!clerk || !counter) return null;
  const has = db.prepare("SELECT id FROM job WHERE day = ? AND task_type = 'letters' AND source = 'post' AND status IN ('offered', 'taken', 'done', 'failed')").get(day) as { id: number } | undefined;
  if (has) return null;
  const r = rng ?? rngFrom(((town(db).town.seed || 1873) * 13 + day * 101) >>> 0);
  const near = addressees(db).filter((p) => {
    const d = d2(counter, { x: p.home.sx, z: p.home.sz });
    return d >= 40 && d <= 220;
  });
  if (!near.length) return null;
  // one part of the town: a door picked at random, and the doors nearest to it
  const centre = near[Math.floor(r() * near.length)].home;
  const pool = near.slice().sort((a, b) => d2({ x: a.home.sx, z: a.home.sz }, { x: centre.sx, z: centre.sz }) - d2({ x: b.home.sx, z: b.home.sz }, { x: centre.sx, z: centre.sz }));
  const n = 3 + Math.floor(r() * 3);
  const hh = new Set<number>();
  const chosen: RoundStop[] = [];
  for (const p of pool) {
    if (chosen.length >= n) break;
    if (hh.has(p.household)) continue;
    hh.add(p.household);
    chosen.push({ id: p.id, name: p.name, x: p.home.sx, z: p.home.sz, what: "door" });
  }
  if (chosen.length < 2) return null;
  const stops = asRound(counter, chosen);
  const [lo, hi] = TIER_PAY[maxTier(db)];
  const pay = Math.max(lo, Math.min(hi, round5(30 + 12 * stops.length + routeLength(counter, stops) / 15)));
  const task: LettersTask = { kind: "letters", goods: "letters", from: { x: counter.x, z: counter.z, label: POST_LABEL }, stops, fee_c: 0, twist: "none", limit_s: null };
  return insertJob(db, {
    title: `Letters for ${stops.length} doors`,
    employer: clerk,
    pay_c: pay,
    pitch: `${stops.length} letters from the morning mail, to doors about the town. Under each door, the right name on each. Fetch them at the post office counter.`,
    task,
    source: "post",
  });
}

// ------------------------------------------------------------------ doing the round

function takenLetters(db: DB, jobId: number): { j: JobRow; t: LettersTask } {
  const j = listJobs(db, now(db).day).find((r) => r.id === jobId);
  if (!j || j.status !== "taken" || j.task?.kind !== "letters") throw new GameError("no round of letters in hand", 409);
  return { j, t: j.task };
}

function saveTask(db: DB, id: number, t: LettersTask): void {
  const done = t.stops.filter((s) => s.done).length;
  db.prepare("UPDATE job SET task_json = ? WHERE id = ?").run(JSON.stringify({ ...t, progress: { delivered: done, lost: 0, sold: 0 } }), id);
}

/** Pick up the letters (or the telegram's words) where the job starts. They go in a pocket. */
export function pickUp(db: DB, jobId: number, at: { x: number; z: number }): { text: string } {
  const { j, t } = takenLetters(db, jobId);
  if (t.picked) return { text: "You have them already." };
  if (d2(at, t.from) > REACH_M + 2) throw new GameError("you are not there yet", 409);
  const fromPost = t.from.label === POST_LABEL;
  if (fromPost && !postOpen(db)) throw new GameError("the post office is shut", 409);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n;
  if (n >= POCKET_SLOTS) throw new GameError("your pockets are full; eat something or leave it", 409);
  const tele = t.stops.some((s) => s.what === "telegraph");
  db.transaction(() => {
    db.prepare("INSERT INTO item (kind, job_id) VALUES (?, ?)").run(tele || t.stops.length === 1 ? "letter" : "letters", jobId);
    saveTask(db, jobId, { ...t, picked: true });
  })();
  const who = j.employer_name;
  return {
    text: tele
      ? `${who} gives you a slip with the words for the wire${t.city ? ` to ${t.city}` : ""}. The fee is ${t.fee_c} centimes at the counter.`
      : fromPost
        ? `The clerk counts ${t.stops.length} letters into your hand. "Under the door, the right name on each."`
        : `${who} hands you a folded letter. "For ${t.stops[0]?.name ?? "them"}, and no one else."`,
  };
}

/** A letter under a door: the engine checks the place and marks the stop. */
export function deliverAt(db: DB, jobId: number, index: number, at: { x: number; z: number }): { text: string; left: number } {
  const { j, t } = takenLetters(db, jobId);
  if (!t.picked) throw new GameError("fetch the letters first", 409);
  const s = t.stops[index];
  if (!s || s.what !== "door") throw new GameError("no such door on the round", 404);
  if (s.done) return { text: "That one is delivered.", left: t.stops.filter((x) => !x.done).length };
  if (d2(at, s) > REACH_M) throw new GameError("that is not the right door", 409);
  s.done = true;
  db.transaction(() => {
    saveTask(db, jobId, t);
    log(db, "delivered_letter", s.id, `Jef put a letter under the door of ${s.name}, for ${j.employer_name}.`);
  })();
  remember(db, s.id, "A letter came under my door; the new man, Jef, brought it.", 2);
  const left = t.stops.filter((x) => !x.done).length;
  return { text: left ? `Under the door of ${s.name}. ${left} to go.` : `Under the door of ${s.name}. That was the last one.`, left };
}

/** The telegraph counter: Jef pays the fee (the job pays it back), the clerk sends the words. */
export function sendTelegram(db: DB, jobId: number, at: { x: number; z: number }): { text: string } {
  const { j, t } = takenLetters(db, jobId);
  const i = t.stops.findIndex((s) => s.what === "telegraph" && !s.done);
  if (i < 0) throw new GameError("no telegram to send", 409);
  if (!t.picked) throw new GameError("fetch the words first", 409);
  if (!postOpen(db)) throw new GameError("the telegraph counter is shut", 409);
  const c = postCounter(db)!;
  if (d2(at, c) > REACH_M + 1) throw new GameError("go to the counter", 409);
  if (player(db).money_c < t.fee_c) throw new GameError(`the wire costs ${t.fee_c} centimes and you have ${player(db).money_c}`, 409);
  t.stops[i].done = true;
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(t.fee_c);
    saveTask(db, jobId, t);
    log(db, "sent_telegram", j.employer_npc, `Jef sent a telegram to ${t.city ?? "another town"} for ${j.employer_name}, ${t.fee_c} centimes.`);
  })();
  return { text: `The clerk counts the words, takes your ${t.fee_c} centimes and taps it out: "${t.words ?? "COMING SOON"}"` };
}

// ------------------------------------------------------------------ letters to Jef

export type LetterWhy = "wronged" | "helped" | "met" | "stranger";
export type LetterKind = "complaint" | "make_right" | "thanks" | "errand" | "telegram" | "news" | "strange_errand" | "strange_telegram";

export interface Offer {
  kind: "none" | "letter" | "telegram";
  /** What the job pays in all (the fee back and the rest), set by the engine. */
  pay_c: number;
  fee_c: number;
  to?: string;
  to_name?: string;
  city?: string;
}

export interface LetterPlan {
  sender: string;
  sender_name: string;
  signature: string;
  why: LetterWhy;
  kind: LetterKind;
  /** Engine facts the letter is about (how they know Jef). */
  facts: string[];
  offer: Offer;
}

export interface LetterRow {
  id: number;
  day: number;
  hour: number;
  sender: string;
  sender_name: string;
  why: string;
  kind: string;
  facts_json: string;
  offer_json: string;
  text_json: string;
  source: string;
  status: "writing" | "waiting" | "given" | "read";
  job_id: number | null;
}

export interface LetterText {
  salutation: string;
  body: string;
  closing: string;
  signature: string;
  telegram: string;
}

/** Should a letter come this morning? Not on day 1; one a day at most; at least one by day 3; four a week. */
export function letterDue(db: DB, rng: () => number = Math.random): boolean {
  const { day } = now(db);
  if (day < 2) return false;
  // M6 ideas: replies to Jef's own letters (ideas/letters.ts) do not count against these
  const all = db.prepare("SELECT day FROM letter WHERE kind <> 'reply'").all() as Array<{ day: number }>;
  if (all.some((l) => l.day === day)) return false;
  if (all.length >= LETTERS_PER_WEEK) return false;
  if (!all.length && day >= 3) return true;
  const yesterday = all.some((l) => l.day === day - 1);
  return rng() < (yesterday ? 0.35 : 0.6);
}

interface Cand {
  why: LetterWhy;
  id: string;
  fact: string;
  w: number;
}

/** Who might write: people Jef wronged, helped or talked to (from their memories), or a stranger. */
export function letterCandidates(db: DB): Cand[] {
  const { day } = now(db);
  const wrote = new Set((db.prepare("SELECT sender FROM letter").all() as Array<{ sender: string }>).map((r) => r.sender));
  const ok = (id: string) => {
    const r = resident(db, id);
    return !!r && r.age >= 16 && r.trade !== "thief" && !wrote.has(id);
  };
  const out: Cand[] = [];
  const mem = db
    .prepare("SELECT npc_id, text, tone, weight FROM npc_memory WHERE source = 'seen' AND tone <> 0 AND weight >= 3 AND day >= ? ORDER BY weight DESC, id DESC LIMIT 40")
    .all(day - 3) as Array<{ npc_id: string; text: string; tone: number; weight: number }>;
  const seen = new Set<string>();
  for (const m of mem) {
    if (!ok(m.npc_id) || seen.has(m.npc_id)) continue;
    seen.add(m.npc_id);
    out.push({ why: m.tone < 0 ? "wronged" : "helped", id: m.npc_id, fact: m.text, w: 3 });
  }
  const met = db
    .prepare("SELECT npc_id, times_met, view_of_player, last_seen_day FROM npc_relationship WHERE times_met >= 1 ORDER BY last_seen_day DESC LIMIT 30")
    .all() as Array<{ npc_id: string; times_met: number; view_of_player: string; last_seen_day: number | null }>;
  for (const m of met) {
    if (!ok(m.npc_id) || seen.has(m.npc_id)) continue;
    seen.add(m.npc_id);
    out.push({ why: "met", id: m.npc_id, fact: `Jef talked with them ${m.times_met === 1 ? "once" : `${m.times_met} times`}${m.last_seen_day ? `, last on day ${m.last_seen_day}` : ""}.${m.view_of_player ? ` How they see him: ${m.view_of_player}` : ""}`, w: 2 });
  }
  out.push({ why: "stranger", id: "", fact: "A stranger. Jef has never met them.", w: 1.5 });
  return out;
}

/** The engine's plan for a letter: who writes, why, and any errand with its pay. */
export function planLetter(db: DB, rng: () => number = Math.random): LetterPlan {
  const cands = letterCandidates(db);
  const total = cands.reduce((a, c) => a + c.w, 0);
  let roll = rng() * total;
  let c = cands[cands.length - 1];
  for (const x of cands) {
    roll -= x.w;
    if (roll <= 0) {
      c = x;
      break;
    }
  }
  const clerk = postClerk(db);
  const sender = c.why === "stranger" ? (clerk ?? "") : c.id;
  const r = c.why === "stranger" ? null : resident(db, c.id);
  const signature = c.why === "stranger" ? STRANGER_SIGNS[Math.floor(rng() * STRANGER_SIGNS.length)] : r!.name;
  const sender_name = c.why === "stranger" ? `a stranger who signs "${signature}"` : r!.name;
  const between = (a: number, b: number) => round5(a + rng() * (b - a));

  let kind: LetterKind;
  let offer: Offer = { kind: "none", pay_c: 0, fee_c: 0 };
  const pickTo = (): Resident | null => {
    const home = r ? { x: r.home.sx, z: r.home.sz } : postCounter(db) ?? { x: 0, z: 0 };
    const pool = addressees(db).filter((p) => p.household !== r?.household && d2(home, { x: p.home.sx, z: p.home.sz }) >= 25 && d2(home, { x: p.home.sx, z: p.home.sz }) <= 260);
    return pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  };
  const letterTo = (pay: number): Offer | null => {
    const to = pickTo();
    return to ? { kind: "letter", pay_c: pay, fee_c: 0, to: to.id, to_name: to.name } : null;
  };
  const wire = (tip: number): Offer => ({ kind: "telegram", pay_c: TELEGRAM_FEE_C + tip, fee_c: TELEGRAM_FEE_C, city: TELEGRAPH_CITIES[Math.floor(rng() * TELEGRAPH_CITIES.length)] });
  const hasPost = !!postCounter(db);

  switch (c.why) {
    case "wronged": {
      const o = rng() < 0.5 ? letterTo(0) : null;
      kind = o ? "make_right" : "complaint";
      if (o) offer = o;
      break;
    }
    case "helped": {
      const o = rng() < 0.5 ? letterTo(between(20, 40)) : null;
      kind = o ? "errand" : "thanks";
      if (o) offer = o;
      break;
    }
    case "met": {
      if (rng() < 0.6) {
        if (hasPost && rng() < 0.4) {
          kind = "telegram";
          offer = wire(between(20, 30));
        } else {
          const o = letterTo(between(25, 40));
          kind = o ? "errand" : "news";
          if (o) offer = o;
        }
      } else kind = "news";
      break;
    }
    default: {
      if (hasPost && rng() < 0.5) {
        kind = "strange_telegram";
        offer = wire(between(30, 60));
      } else {
        const o = letterTo(between(40, 70));
        kind = o ? "strange_errand" : "strange_telegram";
        offer = o ?? wire(between(30, 60));
      }
    }
  }
  const facts = [c.fact];
  if (kind === "news") {
    const ev = db.prepare("SELECT text FROM world_event WHERE day >= ? AND weight >= 4 AND kind IN ('event', 'rumour', 'police', 'theft') ORDER BY id DESC LIMIT 1").get(now(db).day - 2) as { text: string } | undefined;
    if (ev) facts.push(`News they could pass on (from the town): ${ev.text}`);
  }
  return { sender, sender_name, signature, why: c.why, kind, facts, offer };
}

/** The errand a letter asks for, as a job on the board (engine-built). */
export function errandJob(db: DB, plan: LetterPlan): number | null {
  const o = plan.offer;
  if (o.kind === "none") return null;
  const r = plan.why === "stranger" ? null : resident(db, plan.sender);
  const counter = postCounter(db);
  const from = r ? { x: r.home.sx, z: r.home.sz, label: `the door of ${r.name}` } : counter ? { ...counter } : null;
  if (!from) return null;
  const who = plan.why === "stranger" ? `"${plan.signature}"` : plan.sender_name;
  if (o.kind === "letter") {
    const to = resident(db, o.to!);
    if (!to) return null;
    const task: LettersTask = { kind: "letters", goods: "letters", from, stops: [{ id: to.id, name: to.name, x: to.home.sx, z: to.home.sz, what: "door" }], fee_c: 0, twist: "none", limit_s: null };
    return insertJob(db, {
      title: `A letter for ${to.name}`,
      employer: plan.sender,
      pay_c: o.pay_c,
      pitch: `${who} asks you to carry a letter to the door of ${to.name}. ${r ? `Fetch it at ${r.first}'s door.` : "It waits at the post office counter."}${o.pay_c ? ` ${o.pay_c} centimes when it is done.` : " No pay."}`,
      task,
      source: "letter",
    });
  }
  if (!counter) return null;
  const task: LettersTask = {
    kind: "letters",
    goods: "letters",
    from,
    stops: [{ id: "telegraph", name: "the telegraph counter", x: counter.x, z: counter.z, what: "telegraph" }],
    fee_c: o.fee_c,
    city: o.city,
    twist: "none",
    limit_s: null,
  };
  return insertJob(db, {
    title: `A telegram to ${o.city}`,
    employer: plan.sender,
    pay_c: o.pay_c,
    pitch: `${who} asks you to send a telegram to ${o.city}. ${r ? `Fetch the words at ${r.first}'s door.` : "The words wait at the post office counter."} You pay the ${o.fee_c} centimes at the counter; ${o.pay_c} centimes back when it is sent.`,
    task,
    source: "letter",
  });
}

export const LetterSchema = z.object({
  salutation: z.string().min(2).max(60),
  body: z.string().min(30).max(800),
  closing: z.string().min(2).max(60),
  signature: z.string().min(1).max(60),
  telegram: z.string().max(200),
});
export type LetterOut = z.infer<typeof LetterSchema>;

export const LETTER_SYSTEM = `You write letters for Scheldemist, a game set in Antwerp, October 1873.
The letters are to Jef, a farm boy from the Kempen, new in the city, a day labourer on the quays.
People of 1873 write short, plain letters: a greeting, what they have to say, a closing.
Working people write simply; a clerk or a merchant a little more formally.

${LANGUAGE_RULE}
No modern words. No exclamation storms.

The engine decides everything that matters: who writes, why, what they ask and what it pays.
You only write the words. Never offer, send, enclose or promise money, goods or favours beyond the
TERMS you are given, and never name a sum that is not in the TERMS. Write sums as digits with
"centimes" (e.g. "40 centimes"). Keep to the JSON schema. Never mention a game or anything outside 1873.`;

export function letterPrompt(db: DB, plan: LetterPlan): string {
  const r = plan.why === "stranger" ? null : resident(db, plan.sender);
  const persona = r
    ? `${r.name}, ${r.age}, ${r.trade.replace("_", " ")}. ${r.stats.warmth >= 7 ? "Warm." : r.stats.warmth <= 3 ? "Cold." : ""} ${r.stats.temper >= 7 ? "Quick temper." : ""} ${r.stats.piety >= 7 ? "Pious." : ""} ${r.stats.greed >= 7 ? "Close with money." : ""}`.replace(/\s+/g, " ").trim()
    : `A stranger who signs "${plan.signature}". Jef has never met them. Mysterious, but polite.`;
  const o = plan.offer;
  const terms =
    o.kind === "letter"
      ? `They ask Jef to carry a letter to the door of ${o.to_name}. ${r ? `He fetches it at ${r.first}'s door.` : "It waits for him at the post office counter."} ${o.pay_c ? `Pay: ${o.pay_c} centimes when it is done.` : "No pay: it is to make things right between them."}`
      : o.kind === "telegram"
        ? `They ask Jef to send a telegram to ${o.city} for them. ${r ? `He fetches the words at ${r.first}'s door.` : "The words wait at the post office counter."} He pays the fee of ${o.fee_c} centimes at the telegraph counter; they give him ${o.pay_c} centimes when it is sent. Write the telegram too: at most ${TELEGRAM_WORDS} words, in capitals, as telegrams were.`
        : "None. They ask nothing and offer nothing.";
  const about: Record<LetterKind, string> = {
    complaint: "They are angry or hurt about what Jef did, and write to tell him so.",
    make_right: "They are angry or hurt about what Jef did, but give him a way to make it right (the TERMS).",
    thanks: "They are grateful for what Jef did, and write to say so.",
    errand: "They think well of Jef and ask a small service (the TERMS).",
    telegram: "They ask a small service (the TERMS).",
    news: "They write with a little news or a warning, as people do.",
    strange_errand: "A strange request from someone who seems to know more about Jef than they should (the TERMS). Hint at a reason; do not explain it.",
    strange_telegram: "A strange request from someone who seems to know more about Jef than they should (the TERMS). The telegram words may be odd. Hint at a reason; do not explain it.",
  };
  return `Write a letter to Jef, ${dateLine(now(db).day)}.

WHO WRITES
${persona}

WHY THEY WRITE
${about[plan.kind]}

WHAT THEY KNOW (engine facts, their point of view)
${plan.facts.map((f) => "- " + f).join("\n")}

TERMS (engine; exactly these, nothing more)
${terms}

WRITE
- salutation: a short greeting ("Jef," or "To the young man Jef,").
- body: 2 to 5 short sentences in their voice.
- closing: a short closing ("Yours," "God keep you,").
- signature: ${r ? `their name, ${r.name}, or just ${r.first}` : `"${plan.signature}"`}.
- telegram: ${o.kind === "telegram" ? `the telegram words, at most ${TELEGRAM_WORDS}, capitals` : "empty string"}.`;
}

const WORD_SUMS = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|a|some)\s+(francs?|centimes?|guilders?|pounds?|napoleons?|louis|sous?)\b/i;

/** Sums the letter may name: only the engine's. */
export function sumsOk(text: string, offer: Offer): boolean {
  if (WORD_SUMS.test(text)) return false;
  const allowed = new Set([offer.pay_c, offer.fee_c, offer.pay_c - offer.fee_c].filter((n) => n > 0).map(String));
  const re = /(\d+)\s*(francs?|centimes?|c\b|fr\b|guilders?|pounds?)/gi;
  for (const m of text.matchAll(re)) if (!allowed.has(m[1]) || /^fr|^franc/i.test(m[2])) return false;
  // any other bare number over a hundred smells of money
  for (const m of text.matchAll(/\b\d{3,}\b/g)) if (!allowed.has(m[0])) return false;
  return true;
}

/** Tells of a gift the engine never made: an enclosure, a banknote, a promise of money. */
const GIFTS = /\b(enclos\w*|banknote|bank note|money order|postal order|gold coin|here is (some|a little) money|i send you (some|a little) money|reward you with)\b/i;

/** Check the model's letter against the plan; anything off gives way to the engine's letter. */
export function cleanLetter(plan: LetterPlan, out: LetterOut): { text: LetterText; ok: boolean } {
  const body = plainEnglish(out.body);
  const all = [out.salutation, body, out.closing, out.signature, out.telegram].join(" ");
  const sig = plainEnglish(out.signature);
  const sigOk = plan.why === "stranger" ? sig.includes(plan.signature.slice(0, 3)) : plan.signature.split(/\s+/).some((w) => w.length > 2 && sig.includes(w));
  if (!sumsOk(all, plan.offer) || GIFTS.test(all) || body.length < 30) return { text: fallbackLetter(plan), ok: false };
  let telegram = "";
  if (plan.offer.kind === "telegram") {
    const words = out.telegram.replace(/[^A-Za-z .,'-]/g, " ").toUpperCase().split(/\s+/).filter(Boolean);
    telegram = words.length && words.length <= TELEGRAM_WORDS ? words.join(" ") : fallbackLetter(plan).telegram;
  }
  return {
    text: {
      salutation: plainEnglish(out.salutation).slice(0, 60),
      body,
      closing: plainEnglish(out.closing).slice(0, 60),
      signature: sigOk ? sig : plan.signature,
      telegram,
    },
    ok: true,
  };
}

/** The engine's own letter. */
export function fallbackLetter(plan: LetterPlan): LetterText {
  const o = plan.offer;
  const first = plan.why === "stranger" ? plan.signature : plan.sender_name.split(" ")[0];
  const ask =
    o.kind === "letter"
      ? ` Carry a letter for me to the door of ${o.to_name}. ${plan.why === "stranger" ? "It waits for you at the post office counter." : "Fetch it at my door."}${o.pay_c ? ` There are ${o.pay_c} centimes in it for you when it is done.` : " Do this and we are square."}`
      : o.kind === "telegram"
        ? ` I need a wire sent to ${o.city}. ${plan.why === "stranger" ? "The words wait at the post office counter." : "Fetch the words at my door."} Pay the ${o.fee_c} centimes at the counter and you shall have ${o.pay_c} back when it is sent.`
        : "";
  const bodies: Record<LetterKind, string> = {
    complaint: "I have not forgotten what you did. Neither has the street. A man new to the town should mind how he goes.",
    make_right: "I have not forgotten what you did. But I will give you a chance to make it right." + ask,
    thanks: "I write to thank you. Not everyone on the quays would have done the same. I will not forget it.",
    errand: "You seem an honest sort, so I will ask you a small service." + ask,
    telegram: "You seem a willing sort, so I will ask you a small service." + ask,
    news: plan.facts[1] ? `A word to the wise. ${plan.facts[1].replace(/^News they could pass on \(from the town\): /, "")} Keep your eyes open.` : "A word to the wise: keep your eyes open on the quays these days, and your purse closer.",
    strange_errand: "You do not know me, but I know a little of you. I have a small service to ask, and I ask it of you for a reason." + ask,
    strange_telegram: "You do not know me, but I know a little of you. I have a small service to ask, and I ask it of you for a reason." + ask,
  };
  return {
    salutation: plan.why === "stranger" ? "To the young man Jef," : "Jef,",
    body: bodies[plan.kind].trim(),
    closing: plan.why === "wronged" ? "That is all." : "Yours,",
    signature: plan.why === "stranger" ? plan.signature : first,
    telegram: o.kind === "telegram" ? `ARRIVE ${o.city?.toUpperCase() ?? "SOON"} THURSDAY STOP SAY NOTHING TO THE FAMILY STOP` : "",
  };
}

/**
 * A letter for Jef this morning, if the engine says so: the plan, the errand job,
 * the model's words (or the engine's), and the letter in his pocket (or waiting at
 * the post office when his pockets are full).
 */
export async function maybeLetter(db: DB, opts: { runner?: Runner; timeoutMs?: number; rng?: () => number; force?: boolean } = {}): Promise<LetterRow | null> {
  const rng = opts.rng ?? Math.random;
  if (!opts.force && !letterDue(db, rng)) return null;
  const plan = planLetter(db, rng);
  if (!plan.sender) return null;
  const { day, hour } = now(db);
  const id = Number(
    db
      .prepare("INSERT INTO letter (day, hour, sender, sender_name, why, kind, facts_json, offer_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'writing')")
      .run(day, hour, plan.sender, plan.sender_name, plan.why, plan.kind, JSON.stringify(plan.facts), JSON.stringify(plan.offer)).lastInsertRowid,
  );
  let text: LetterText = fallbackLetter(plan);
  let source = "engine";
  if (canCallPress(db)) {
    const res = await callClaude(db, { hook: "letter", system: LETTER_SYSTEM, prompt: letterPrompt(db, plan), schema: LetterSchema, timeoutMs: opts.timeoutMs }, opts.runner);
    if (res.ok && res.data) {
      const c = cleanLetter(plan, res.data);
      text = c.text;
      source = c.ok ? "claude" : "engine";
    }
  }
  // the errand, with the telegram's words the letter settled on
  const job = errandJob(db, plan);
  if (job && text.telegram) {
    const row = db.prepare("SELECT task_json FROM job WHERE id = ?").get(job) as { task_json: string };
    db.prepare("UPDATE job SET task_json = ? WHERE id = ?").run(JSON.stringify({ ...(JSON.parse(row.task_json) as LettersTask), words: text.telegram }), job);
  }
  const n = (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n;
  const status = n < POCKET_SLOTS ? "given" : "waiting";
  db.transaction(() => {
    db.prepare("UPDATE letter SET text_json = ?, source = ?, status = ?, job_id = ? WHERE id = ?").run(JSON.stringify(text), source, status, job, id);
    if (status === "given") db.prepare("INSERT INTO item (kind, job_id, ref) VALUES ('letter', NULL, ?)").run(id);
    log(db, "letter_came", plan.why === "stranger" ? null : plan.sender, `A letter came for Jef from ${plan.sender_name}.`, "world");
  })();
  writeEvent(db, { kind: "log", verb: "letter", text: `A letter came for Jef from ${plan.sender_name} (${plan.kind.replace("_", " ")}).`, actor: plan.why === "stranger" ? null : plan.sender, weight: 3 });
  return letterRow(db, id);
}

export function letterRow(db: DB, id: number): LetterRow | null {
  return (db.prepare("SELECT * FROM letter WHERE id = ?").get(id) as LetterRow | undefined) ?? null;
}

/** A letter to read: only one Jef holds (in a pocket) or has read. */
export function letterView(db: DB, id: number) {
  const l = letterRow(db, id);
  const held = db.prepare("SELECT 1 FROM item WHERE kind = 'letter' AND ref = ?").get(id);
  if (!l || (!held && l.status !== "read")) throw new GameError("no such letter in your pockets", 404);
  if (l.status === "given") db.prepare("UPDATE letter SET status = 'read' WHERE id = ?").run(id);
  const text = JSON.parse(l.text_json) as LetterText;
  const offer = JSON.parse(l.offer_json) as Offer;
  const job = l.job_id ? (db.prepare("SELECT id, status, title, pay_c, day FROM job WHERE id = ?").get(l.job_id) as { id: number; status: string; title: string; pay_c: number; day: number } | undefined) : undefined;
  return {
    id: l.id,
    date: dateLine(l.day),
    from: l.sender_name,
    ...text,
    offer,
    job: job ? { id: job.id, status: job.status, title: job.title, pay_c: job.pay_c, today: job.day === now(db).day } : null,
  };
}

/** Letters that wait at the post office (Jef's pockets were full): take them at the counter. */
export function collectWaiting(db: DB): { text: string; n: number } {
  if (!postOpen(db)) throw new GameError("the post office is shut", 409);
  const waiting = db.prepare("SELECT id, sender_name FROM letter WHERE status = 'waiting' ORDER BY id").all() as Array<{ id: number; sender_name: string }>;
  let n = 0;
  for (const w of waiting) {
    const used = (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n;
    if (used >= POCKET_SLOTS) break;
    db.prepare("INSERT INTO item (kind, job_id, ref) VALUES ('letter', NULL, ?)").run(w.id);
    db.prepare("UPDATE letter SET status = 'given' WHERE id = ?").run(w.id);
    n++;
  }
  if (!waiting.length) return { text: `"Nothing for you today."`, n: 0 };
  if (!n) throw new GameError("your pockets are full", 409);
  return { text: `The clerk hands you ${n === 1 ? "a letter" : `${n} letters`} from the pigeonholes.`, n };
}

/** What the post counter shows. */
export function postView(db: DB) {
  const clerk = postClerk(db);
  const c = postCounter(db);
  const jobs = listJobs(db, now(db).day).filter((j) => j.task_type === "letters" && (j.employer_npc === clerk || j.task?.kind === "letters"));
  return {
    label: POST_LABEL,
    clerk,
    clerk_name: clerk ? (resident(db, clerk)?.name ?? null) : null,
    open: postOpen(db),
    at: c,
    waiting: (db.prepare("SELECT COUNT(*) AS n FROM letter WHERE status = 'waiting'").get() as { n: number }).n,
    telegram_fee_c: TELEGRAM_FEE_C,
    telegram_words: TELEGRAM_WORDS,
    round: jobs.find((j) => j.employer_npc === clerk && j.status === "offered") ?? null,
  };
}

/** Throw away a paper or a letter you have read (a pawn ticket or a job's letters: no). */
export function discard(db: DB, itemId: number): void {
  const row = db.prepare("SELECT kind, job_id FROM item WHERE id = ?").get(itemId) as { kind: string; job_id: number | null } | undefined;
  if (!row) throw new GameError("not in your pockets", 404);
  if (row.job_id !== null || (row.kind !== "newspaper" && row.kind !== "letter")) throw new GameError("you had better keep that", 409);
  db.prepare("DELETE FROM item WHERE id = ?").run(itemId);
}

// ------------------------------------------------------------------ the clerks' remarks

export const RemarkSchema = z.object({ line: z.string().min(3).max(200) });

/**
 * A clerk says something as the business is done (the Berg or the post). The situation
 * is the engine's; the words the model's; any number not in the situation, or a hostile
 * reply, gives way to the fallback. Changes nothing.
 */
export async function clerkRemark(db: DB, clerkId: string, situation: string, fallback: string, opts: { runner?: Runner; timeoutMs?: number } = {}): Promise<{ text: string; source: "claude" | "engine" }> {
  const r = resident(db, clerkId);
  if (!r || !canCallPress(db)) return { text: fallback, source: "engine" };
  const system = `You write one line of speech for a clerk in Antwerp, October 1873, in a game called Scheldemist.
${LANGUAGE_RULE}
One or two short sentences, in character, to the young day labourer Jef at the counter. Dry, period flavour.
Never name a sum, a rule or an offer that is not in the SITUATION. Keep to the JSON schema.`;
  const prompt = `THE CLERK
${r.name}, ${r.age}, ${r.trade === "pawnbroker" ? "clerk at the counter of the Berg van Barmhartigheid, the town's pawn office" : "clerk of the post and telegraph office"}. ${r.stats.warmth >= 7 ? "Kindly." : r.stats.warmth <= 3 ? "Cold, not unkind." : "Brisk."}${r.stats.greed >= 7 ? " Counts every centime." : ""}

SITUATION (engine facts)
${situation}

Write "line": what ${r.first} says.`;
  const res = await callClaude(db, { hook: "clerk", system, prompt, schema: RemarkSchema, timeoutMs: opts.timeoutMs }, opts.runner);
  if (!res.ok || !res.data) return { text: fallback, source: "engine" };
  const line = plainEnglish(res.data.line);
  const allowed = new Set(situation.match(/\d+/g) ?? []);
  if ((line.match(/\d+/g) ?? []).some((d) => !allowed.has(d)) || WORD_SUMS.test(line) || GIFTS.test(line)) return { text: fallback, source: "engine" };
  return { text: line, source: "claude" };
}
