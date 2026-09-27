import { z } from "zod";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { DAY_NAMES } from "../day.ts";
import { writeEvent } from "../director/eventlog.ts";
import { GameError, log } from "../game.ts";
import { applyTrust, remember, topMemories } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { atWork, ITEMS, POCKET_SLOTS } from "../trade.ts";
import { TRADES } from "../town/places.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import { family, resident, town } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { visitorOf } from "../town/visitors.ts";
import { noteOnRecord } from "../town/police.ts";
import { pressTown } from "../paper/town.ts";
import { canCallIdeas, clamp, d2, digitsOf, now, numbersOk, OUT_OF_WORLD, round5 } from "./common.ts";
import { dogWords, nearLabel } from "./posters.ts";
import { pid } from "../player/current.ts";

// Lost diaries (M6 AI ideas). Now and then a townsperson drops a small notebook in
// the street by their door. Reading it shows 3 to 5 entries in their hand. The ENGINE
// picks the facts: their trade and hours, their household, their own memories, one
// small private matter; the model writes the entries from those facts only. Private but
// tame; no names but the game's. What Jef does is the engine's: give it back at their
// door (trust +1, a small reward by their means), keep it, sell it to the Berg's clerk
// (a few centimes; the owner may hear of it), or use it to squeeze money out of them
// (trust -2 and a mark on the police record, paid or not).

export const DIARY_SELL_C = 8;
const REACH_M = 3.5;

ITEMS.diary = { name: "a small notebook", use: "read", note: "Oilcloth covers, a pencil in the spine, a name inside the cover." };

export interface DiaryRow {
  id: number;
  owner: string;
  day: number;
  x: number;
  z: number;
  facts_json: string;
  entries_json: string;
  source: string;
  status: "writing" | "lying" | "held" | "returned" | "sold" | "squeezed" | "gone";
  read: number;
  closed_day: number | null;
  /** Game minute the writing began (day * 1440 + minutes), and how many times it was tried. */
  started_min?: number | null;
  tries?: number;
}

export interface Entry {
  date: string;
  text: string;
}

/** Small private matters, by the person's stats (engine). Tame: debts, hopes, worries, a crush, a vow. */
function secretOf(r: Resident, rng: () => number, db: DB): string {
  const s = r.stats;
  const pool: string[] = [];
  if (s.greed >= 6) pool.push("I keep a few francs in a stocking in the chimney and tell nobody, not even at confession.");
  if (s.wealth <= 2) pool.push("I owe the baker for three weeks of bread and walk the long way round his shop.");
  if (s.piety <= 3) pool.push("I have not been to confession since Easter, and I do not miss it.");
  if (s.piety >= 7) pool.push("I have promised Our Lady a candle every Saturday if my wish is granted.");
  if (s.temper >= 7) pool.push("I said hard words to my brother at Easter and we have not spoken since. I would not be the first to give in.");
  if (s.courage <= 3) pool.push("I am afraid of the river at night and take the long way home to keep away from the quay.");
  if (s.gossip >= 7) pool.push("I told the whole street something I promised to keep to myself, and I am sorry for it.");
  pool.push("I am putting a little by for a passage to America, and nobody at home knows.");
  if (r.family_role === "single" || r.family_role === "lodger") {
    const others = town(db).town.residents.filter((o) => o.sex !== r.sex && Math.abs(o.age - r.age) <= 6 && o.age >= 16 && (o.family_role === "single" || o.family_role === "lodger" || o.family_role === "son" || o.family_role === "daughter") && o.household !== r.household);
    const o = others[Math.floor(rng() * others.length)];
    if (o) pool.push(`I think about ${o.name} more than I should, and I have never said a word to ${o.sex === "f" ? "her" : "him"}.`);
  }
  return pool[Math.floor(rng() * pool.length)];
}

const hh = (h: number) => {
  const H = Math.floor(((h % 24) + 24) % 24);
  const m = Math.round((h - Math.floor(h)) * 60);
  return m ? `${H}:${String(m).padStart(2, "0")}` : `${H}`;
};

/** The facts the engine gives the writer: trade and hours, the household, memories, a private matter. */
export function diaryFacts(db: DB, r: Resident, rng: () => number): string[] {
  const facts: string[] = [];
  const work = r.sched.day.find((s) => s[2] === "work");
  const label = TRADES[r.trade]?.label ?? r.trade.replace(/_/g, " ");
  facts.push(`${r.name}, ${r.age}, ${label}, lives near ${nearLabel(r.home.sx, r.home.sz)}.${work ? ` Works from ${hh(work[0])} to ${hh(work[1])} o'clock.` : ""}`);
  const tav = r.sched.day.find((s) => s[2] === "tavern");
  if (tav) facts.push(`Most evenings at the tavern from ${hh(tav[0])} o'clock.`);
  if (r.sched.sunday.some((s) => s[2] === "church")) facts.push("Goes to mass at the cathedral on Sunday.");
  const fam = family(db, r).slice(0, 5);
  if (fam.length) facts.push(`At home: ${fam.map((f) => `${f.name} (${f.family_role}, ${f.age})`).join(", ")}.`);
  else facts.push("Lives alone.");
  if (r.dog) facts.push(`Has a ${dogWords(r.dog.look)} dog called ${r.dog.name}.`);
  for (const m of topMemories(db, r.id, 4)) facts.push(`Remembers: ${m.text}`);
  facts.push(`Private: ${secretOf(r, rng, db)}`);
  return facts;
}

/** The dates of the entries: the last 3 to 5 days up to today (before the week, "last Saturday"). */
export function entryDates(day: number, n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = day - i;
    out.push(d >= 1 ? DAY_NAMES[(d - 1) % 7] : `last ${DAY_NAMES[(((d - 1) % 7) + 7) % 7]}`);
  }
  return out;
}

export const DiarySchema = z.object({
  entries: z.array(z.object({ n: z.number().int(), text: z.string().min(15).max(360) })).min(3).max(5),
});
export type DiaryOut = z.infer<typeof DiarySchema>;

export const DIARY_SYSTEM = `You write the private notebook of one ordinary person of Antwerp, October 1873.
A few plain lines a day, in the first person, in their own voice: what they did, who they worry about, small hopes.
Working people write simply and briefly.

${LANGUAGE_RULE}
No modern words. Private but tame: nothing cruel, nothing indecent, nobody hurt.
Use ONLY the FACTS given. Never add a person's name, a sum, a number or an event that is not in the facts.
Keep to the JSON schema. Never mention a game or anything outside 1873.`;

export function diaryPrompt(r: Resident, facts: string[], dates: string[]): string {
  return `The notebook of ${r.name}.

FACTS (engine; all true, all you may use)
${facts.map((f) => "- " + f).join("\n")}

WRITE ${dates.length} entries, in order, one for each of: ${dates.join(", ")} (the engine puts the dates on them).
- n: 1 to ${dates.length}; text: 1 to 3 short sentences. The private matter may come in once, quietly.`;
}

export function engineEntries(_r: Resident, facts: string[], dates: string[]): Entry[] {
  const mem = facts.filter((f) => f.startsWith("Remembers: ")).map((f) => f.slice(11));
  const priv = facts.find((f) => f.startsWith("Private: "))?.slice(9) ?? "";
  const work = /Works from (\S+) to (\S+) o'clock/.exec(facts[0]);
  const base = [
    work ? `Up early. At work from ${work[1]} to ${work[2]}, as always. Tired feet.` : "Up early. The same as every day. Tired feet.",
    mem[0] ?? "Nothing much. Fog on the river all morning.",
    priv,
    mem[1] ?? "Rain in the afternoon. Mended what needed mending.",
    "Early to bed. God keep us all.",
  ].filter(Boolean);
  return dates.map((date, i) => ({ date, text: base[i % base.length] }));
}

/** Check the model's pages: numbers and names only from the facts; nothing from outside 1873. */
export function cleanEntries(db: DB, facts: string[], dates: string[], out: DiaryOut, fallback: Entry[]): { entries: Entry[]; ok: boolean } {
  const allowedNums = digitsOf(...facts);
  const factText = facts.join(" ").toLowerCase();
  const jef = /\bJef\b/.test(facts.join(" "));
  const names = town(db).town.residents.map((x) => x.name.toLowerCase());
  const good = (t: string) =>
    numbersOk(t, allowedNums) &&
    !OUT_OF_WORLD.test(t) &&
    (jef || !/\bJef\b/.test(t)) &&
    !names.some((n) => t.toLowerCase().includes(n) && !factText.includes(n)) &&
    !/\b(knife|pistol|gun|blood|kill|murder|naked|bed with)\b/i.test(t);
  const entries = dates.map((date, i) => {
    const m = out.entries.find((e) => e.n === i + 1);
    const text = m ? plainEnglish(m.text) : "";
    return { date, text: text && good(text) ? text : fallback[i].text, ok: !!(text && good(text)) };
  });
  return { entries: entries.map(({ date, text }) => ({ date, text })), ok: entries.filter((e) => e.ok).length >= Math.ceil(dates.length / 2) };
}

/** Where it lies: a couple of paces along the street from their door step, on open, reachable ground. */
function dropPoint(r: Resident, rng: () => number): { x: number; z: number } {
  const wm = walkMap();
  const a = rng() * Math.PI * 2;
  const p = wm.nearestOpen(r.home.sx + Math.cos(a) * 2.2, r.home.sz + Math.sin(a) * 2.2, 3);
  return p && wm.reachable(p.x, p.z) ? p : { x: r.home.sx, z: r.home.sz };
}

/** A notebook still being written after this many game minutes is stuck (QA 2026-09-24). */
export const DIARY_STUCK_MIN = 30;
const gameMin = (db: DB) => {
  const t = now(db);
  return t.day * 1440 + t.hour * 60 + (t.minute ?? 0);
};
/** Notebooks being written by this server process now: id -> a token, so a stale write never lands. */
const writingHere = new Map<number, number>();
let writeToken = 0;

/**
 * `force`: a resident id, or "*" for anyone now (dev). Now and then (from day 2, about half the mornings, one lying at a time) a notebook is
 * dropped. The engine picks whose and the facts; the model writes the pages.
 */
export async function maybeDiary(db: DB, opts: { runner?: Runner; timeoutMs?: number; rng?: () => number; force?: string } = {}): Promise<DiaryRow | null> {
  // a notebook stuck in "writing" (a call that never came back, a server restart) first
  await unstickDiaries(db, opts);
  const { day } = now(db);
  const rng = opts.rng ?? rngFrom(((town(db).town.seed || 1873) * 53 + day * 3571) >>> 0);
  if (!opts.force) {
    if (day < 2 || db.prepare("SELECT 1 FROM diary WHERE day = ?").get(day) || db.prepare("SELECT 1 FROM diary WHERE status IN ('writing', 'lying')").get()) return null;
    if (rng() > 0.5) return null;
  }
  const had = new Set((db.prepare("SELECT owner FROM diary").all() as Array<{ owner: string }>).map((x) => x.owner));
  const pool = town(db).town.residents.filter(
    (r) => r.age >= 16 && !had.has(r.id) && !visitorOf(r) && !["soldier", "sentry", "corporal", "emigrant", "runner", "priest", "infant"].includes(r.trade),
  );
  const r = opts.force && opts.force !== "*" ? resident(db, opts.force) : pool[Math.floor(rng() * pool.length)];
  if (!r) return null;
  const facts = diaryFacts(db, r, rng);
  const n = clamp(3 + Math.floor(rng() * 3), 3, 5);
  const dates = entryDates(day, n);
  const p = dropPoint(r, rng);
  const fb = engineEntries(r, facts, dates);
  const id = Number(
    db
      .prepare("INSERT INTO diary (owner, day, x, z, facts_json, entries_json, source, status, started_min, tries) VALUES (?, ?, ?, ?, ?, ?, 'engine', 'writing', ?, 1)")
      .run(r.id, day, +p.x.toFixed(2), +p.z.toFixed(2), JSON.stringify(facts), JSON.stringify(fb), gameMin(db)).lastInsertRowid,
  );
  return writeDiary(db, id, r, facts, dates, fb, true, opts);
}

/** The model writes the pages (or the engine's stand), and the notebook is dropped in the street. */
async function writeDiary(
  db: DB,
  id: number,
  r: Resident,
  facts: string[],
  dates: string[],
  fb: Entry[],
  useModel: boolean,
  opts: { runner?: Runner; timeoutMs?: number },
): Promise<DiaryRow | null> {
  const token = ++writeToken;
  writingHere.set(id, token);
  try {
    let entries = fb;
    let source = "engine";
    if (useModel && canCallIdeas(db)) {
      const res = await callClaude(db, { hook: "diary", system: DIARY_SYSTEM, prompt: diaryPrompt(r, facts, dates), schema: DiarySchema, timeoutMs: opts.timeoutMs }, opts.runner);
      if (res.ok && res.data) {
        const c = cleanEntries(db, facts, dates, res.data, fb);
        entries = c.entries;
        source = c.ok ? "claude" : "engine";
      }
    }
    // a later retry took this notebook over: its write stands, not this one
    if (writingHere.get(id) !== token) return diaryRow(db, id);
    const done = db.prepare("UPDATE diary SET entries_json = ?, source = ?, status = 'lying' WHERE id = ? AND status = 'writing'").run(JSON.stringify(entries), source, id);
    if (!done.changes) return diaryRow(db, id);
    const d = diaryRow(db, id)!;
    remember(db, r.id, "I have lost my notebook somewhere in the street. I hope nobody reads it.", 4);
    writeEvent(db, { kind: "log", verb: "diary_lost", text: `${r.name} lost a small notebook in the street near ${nearLabel(d.x, d.z)}.`, actor: r.id, weight: 2 });
    return d;
  } finally {
    if (writingHere.get(id) === token) writingHere.delete(id);
  }
}

/**
 * A notebook left in "writing" (QA 2026-09-24: one stood so for days, and no new one ever came):
 * one left over from a server restart, or older than DIARY_STUCK_MIN game minutes, is written
 * again by the model once; after that the engine's own pages stand. The owner gone: it is gone.
 */
export async function unstickDiaries(db: DB, opts: { runner?: Runner; timeoutMs?: number } = {}): Promise<number[]> {
  const rows = db.prepare("SELECT * FROM diary WHERE status = 'writing'").all() as Array<DiaryRow & { started_min: number | null; tries: number }>;
  const nowMin = gameMin(db);
  const out: number[] = [];
  for (const d of rows) {
    const leftOver = !writingHere.has(d.id);
    const old = d.started_min === null || nowMin - d.started_min >= DIARY_STUCK_MIN;
    if (!leftOver && !old) continue;
    const r = resident(db, d.owner);
    if (!r) {
      db.prepare("UPDATE diary SET status = 'gone', closed_day = ? WHERE id = ?").run(now(db).day, d.id);
      continue;
    }
    const facts = JSON.parse(d.facts_json) as string[];
    const fb = JSON.parse(d.entries_json) as Entry[];
    const dates = fb.map((e) => e.date);
    const retry = (d.tries ?? 0) < 2;
    db.prepare("UPDATE diary SET tries = ?, started_min = ? WHERE id = ?").run((d.tries ?? 0) + 1, nowMin, d.id);
    console.log(`[diary] notebook ${d.id} (${d.owner}) was stuck writing: ${retry ? "one more try" : "the engine's pages"}`);
    await writeDiary(db, d.id, r, facts, dates, fb, retry, opts);
    out.push(d.id);
  }
  return out;
}

export function diaryRow(db: DB, id: number): DiaryRow | null {
  return (db.prepare("SELECT * FROM diary WHERE id = ?").get(id) as DiaryRow | undefined) ?? null;
}

/** A notebook in this player's pocket (M8c: diary.player_id is who picked it up). */
function held(db: DB, id: number): { d: DiaryRow; r: Resident } {
  const d = diaryRow(db, id);
  const mine = !!db.prepare("SELECT 1 FROM diary WHERE id = ? AND player_id = ?").get(id, pid());
  if (!d || d.status !== "held" || !mine || !db.prepare("SELECT 1 FROM item WHERE kind = 'diary' AND ref = ? AND player_id = ?").get(id, pid())) throw new GameError("you do not have that notebook", 409);
  const r = resident(db, d.owner);
  if (!r) throw new GameError("nobody owns it", 409);
  return { d, r };
}

const atDoor = (r: Resident, at: { x: number; z: number }) => Number.isFinite(at.x) && Number.isFinite(at.z) && d2(at, { x: r.home.sx, z: r.home.sz }) <= REACH_M + 0.5;

/** What the client needs: notebooks lying about, the ones Jef has (with the owner's door). (M8c: another player's are his) */
export function diaryWorld(db: DB) {
  const rows = db.prepare("SELECT * FROM diary WHERE status = 'lying' OR (status = 'held' AND player_id = ?)").all(pid()) as DiaryRow[];
  return rows.map((d) => {
    const r = resident(db, d.owner);
    return { id: d.id, status: d.status, x: d.x, z: d.z, owner: d.owner, owner_name: r?.name ?? "", door: r ? [r.home.sx, r.home.sz] : null };
  });
}

/** E at the notebook: into a pocket. */
export function pickDiary(db: DB, id: number, at: { x: number; z: number }): { text: string } {
  const d = diaryRow(db, id);
  if (!d || d.status !== "lying") throw new GameError("it is not there any more", 409);
  if (!Number.isFinite(at.x) || !Number.isFinite(at.z) || d2(at, d) > REACH_M) throw new GameError("you are not there yet", 409);
  if ((db.prepare("SELECT COUNT(*) AS n FROM item WHERE player_id = ?").get(pid()) as { n: number }).n >= POCKET_SLOTS) throw new GameError("your pockets are full", 409);
  const r = resident(db, d.owner);
  db.transaction(() => {
    db.prepare("UPDATE diary SET status = 'held', player_id = ? WHERE id = ?").run(pid(), id);
    db.prepare("INSERT INTO item (kind, job_id, ref, player_id) VALUES ('diary', NULL, ?, ?)").run(id, pid());
    log(db, "found_diary", d.owner, `Jef picked up a small notebook in the street; the name inside is ${r?.name ?? "somebody's"}.`);
  })();
  return { text: `A small notebook in oilcloth covers. Inside the cover: ${r?.name ?? "a name"}. (I to read it.)` };
}

/** Reading it (only one in his pocket). Reading is remembered by the engine, never by the owner unless Jef tells. */
export function readDiary(db: DB, id: number) {
  const { d, r } = held(db, id);
  db.prepare("UPDATE diary SET read = 1 WHERE id = ?").run(id);
  return {
    id: d.id,
    owner: r.name,
    near: nearLabel(r.home.sx, r.home.sz),
    entries: JSON.parse(d.entries_json) as Entry[],
    source: d.source,
    sell_c: DIARY_SELL_C,
  };
}

/** Give it back at their door: trust +1, a small reward by their means (engine), a memory. */
export function returnDiary(db: DB, id: number, at: { x: number; z: number }): { text: string; paid_c: number } {
  const { d, r } = held(db, id);
  if (!atDoor(r, at)) throw new GameError("this is not their door", 409);
  const reward = r.stats.greed >= 8 ? 0 : round5(clamp(5 + r.stats.wealth * 2 + (r.stats.warmth >= 7 ? 5 : 0), 5, 20));
  db.transaction(() => {
    db.prepare("UPDATE diary SET status = 'returned', closed_day = ? WHERE id = ?").run(now(db).day, id);
    db.prepare("DELETE FROM item WHERE kind = 'diary' AND ref = ? AND player_id = ?").run(id, pid());
    if (reward) db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(reward, pid());
    log(db, "returned_diary", r.id, `Jef brought ${r.name}'s lost notebook back to the door${reward ? ` and was given ${reward} centimes` : ""}.`);
  })();
  applyTrust(db, r.id, 1, 0);
  remember(db, r.id, `Jef, the new day labourer, brought back my lost notebook. ${d.read ? "I hope he did not read it." : "Honest lad."}`, 6, "seen", null, { gist: `Jef brought ${r.first}'s lost notebook back to the door`, tone: 1 });
  return { text: `${r.first} takes it quickly and holds it to ${r.sex === "f" ? "her" : "his"} chest. "Where did you find it?"${reward ? ` ${reward} centimes for your trouble.` : " A nod, and the door closes."}`, paid_c: reward };
}

/** Sell it to the Berg's clerk (a few centimes). The owner may hear of it (engine roll). */
export function sellDiary(db: DB, id: number, at: { x: number; z: number }, rng: () => number = Math.random): { text: string; paid_c: number } {
  const { r } = held(db, id);
  const berg = pressTown(db)?.berg;
  if (!berg) throw new GameError("there is no Berg", 404);
  if (!atWork(db, berg.clerk)) throw new GameError("the Berg's counter is shut", 409);
  if (!Number.isFinite(at.x) || !Number.isFinite(at.z) || d2(at, { x: berg.door[0], z: berg.door[1] }) > 6) throw new GameError("go to the Berg's counter", 409);
  const heard = rng() < 0.4;
  db.transaction(() => {
    db.prepare("UPDATE diary SET status = 'sold', closed_day = ? WHERE id = ?").run(now(db).day, id);
    db.prepare("DELETE FROM item WHERE kind = 'diary' AND ref = ? AND player_id = ?").run(id, pid());
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(DIARY_SELL_C, pid());
    log(db, "sold_diary", r.id, `Jef sold ${r.name}'s lost notebook to the clerk of the Berg for ${DIARY_SELL_C} centimes.`);
  })();
  if (heard) {
    applyTrust(db, r.id, -1, 0);
    remember(db, r.id, "Jef found my notebook and sold it to the Berg's clerk instead of bringing it back.", 7, "seen", null, { gist: `Jef sold ${r.first}'s lost notebook to the Berg`, tone: -2 });
  }
  return { text: `The clerk turns the pages with one finger, sniffs, and pushes ${DIARY_SELL_C} centimes under the grille. "Paper is paper."`, paid_c: DIARY_SELL_C };
}

/**
 * Use it to squeeze money out of them, at their door. The engine decides by their stats:
 * the timid with some money pay (10 to 30 centimes by their means); the rest refuse and go
 * to the police. Either way: trust -2, a hard memory and a rumour, and the police hear of
 * it (always when refused; half the time when paid). The notebook goes back to them.
 */
export function squeeze(db: DB, id: number, at: { x: number; z: number }, rng: () => number = Math.random): { text: string; paid_c: number; police: boolean } {
  const { r } = held(db, id);
  if (!atDoor(r, at)) throw new GameError("this is not their door", 409);
  const pays = r.stats.courage <= 5 && r.stats.wealth >= 2 && rng() < 0.7;
  const amount = pays ? round5(clamp(r.stats.wealth * 5, 10, 30)) : 0;
  const police = !pays || rng() < 0.5;
  db.transaction(() => {
    db.prepare("UPDATE diary SET status = 'squeezed', closed_day = ? WHERE id = ?").run(now(db).day, id);
    db.prepare("DELETE FROM item WHERE kind = 'diary' AND ref = ? AND player_id = ?").run(id, pid());
    if (amount) db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(amount, pid());
    log(db, "squeezed", r.id, pays ? `Jef made ${r.name} pay ${amount} centimes for their lost notebook and his silence.` : `Jef tried to make ${r.name} pay for their lost notebook; they refused and went to the police.`);
  })();
  applyTrust(db, r.id, -2, 0);
  remember(db, r.id, pays ? `Jef read my notebook and made me pay ${amount} centimes to keep quiet. I will not forget it.` : "Jef read my notebook and tried to make me pay for his silence. I went to the police.", 9, "seen", null, { gist: `Jef tried to squeeze money out of ${r.first} over a lost notebook`, tone: -2 });
  if (police) noteOnRecord(db, `${r.name} told the police that Jef tried to squeeze money out of them over a lost notebook.`);
  writeEvent(db, { kind: "police", verb: "squeezed", text: `Jef tried to squeeze money out of ${r.name} over a lost notebook${police ? "; the police were told" : ""}.`, actor: r.id, weight: 7 });
  return {
    text: pays
      ? `${r.first} goes white, fetches ${amount} centimes and snatches the notebook back. "Now get away from my door."`
      : `${r.first} snatches the notebook out of your hand. "You little rat. The police will hear of this."`,
    paid_c: amount,
    police,
  };
}

