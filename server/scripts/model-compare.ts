// M6 models: which model should write which hook? (docs/milestones/M6-models.md)
//
// 1. Capture: the real hook functions run on a TEST SAVE (a .backup() copy of data/game.sqlite in
//    data/test-models.sqlite; the real save is only read) with a capturing runner, so the prompt,
//    the system text and the schema are exactly what the game sends. The runner records the call
//    and fails it; the hook then falls back to the engine, as it would in play.
// 2. Run every captured prompt on every model, through the same runners the game uses (the Agent
//    SDK for Claude, the locked-down Codex CLI for GPT Sol): latency, schema-valid on the first try
//    and after one retry, the game's own checks and clamps on the answer.
// 3. Judge: Opus 5.5 scores the answers blind (shuffled labels) on a fixed rubric, and the variety
//    of each model's answers per hook.
// Results: data/model-compare/results.json (resumable: a finished call is not made again) and
// data/model-compare/tables.md. Nothing here writes to data/game.sqlite.
//
// Run: node scripts/model-compare.ts [--models opus,sonnet,haiku,sol] [--no-judge] [--capture-only]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { z } from "zod";
import { MODELS, ROOT, type ModelKey } from "../src/config.ts";

// every model call bounded: a hung call is cut at this, far past the game's 20 s
const HARD_CAP_MS = 60_000;
const GAME_TIMEOUT_MS = 20_000;
const OUT_DIR = path.join(ROOT, "data", "model-compare");
const TEST_SAVE = path.join(ROOT, "data", "test-models.sqlite");
const REAL_SAVE = path.join(ROOT, "data", "game.sqlite");

// ------------------------------------------------------------------ the test save, before any game module opens a db
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const f of [TEST_SAVE, TEST_SAVE + "-wal", TEST_SAVE + "-shm"]) fs.rmSync(f, { force: true });
{
  const src = new Database(REAL_SAVE, { readonly: true, fileMustExist: true });
  await src.backup(TEST_SAVE);
  src.close();
}
// deterministic prompts: the engine's rolls repeat run to run
let seed = 1873;
Math.random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const { openDb } = await import("../src/db.ts");
const { sdkRunner } = await import("../src/ai/claude.ts");
const { codexRunner } = await import("../src/ai/codex.ts");
const { plainEnglish } = await import("../src/text.ts");
const { log } = await import("../src/game.ts");
const { remember } = await import("../src/npcs.ts");
const { writeEvent } = await import("../src/director/eventlog.ts");
const { VIOLENCE_RE } = await import("../src/director/vocab.ts");
const { town, resident } = await import("../src/town/store.ts");
const { resetTalks } = await import("../src/hooks/dialogue.ts");
const { residentOpen, residentFree, talkHooks, ResidentLineSchema } = await import("../src/town/talk.ts");
const { installTalkHooks, syncFromClient } = await import("../src/director/actions.ts");
const { think, planFromModel, DirectorSchema } = await import("../src/director/director.ts");
const { planEvent } = await import("../src/director/scheduler.ts");
const { runConvo, ConvoSchema } = await import("../src/director/convo.ts");
const { makePaper, cleanPaper, factsOf, PaperSchema } = await import("../src/paper/newspaper.ts");
const { writeShow, cleanPlay, PlaySchema } = await import("../src/interiors/poesje.ts");
const { putUp, cleanPoster, morningPlans, sailingPlans, auctionPlans, orderPlans, lostPlan, PosterBatchSchema } = await import("../src/ideas/posters.ts");
const { twistRumours, dreamOf, TwistSchema, DreamSchema } = await import("../src/director/surprises.ts");
const { withinFact } = await import("../src/town/rumours.ts");
const { scanNews, shareNews, decideReaction, newsRow, ShareSchema } = await import("../src/director/families.ts");
const { answerLetters, cleanReply, jefLetter, ReplySchema } = await import("../src/ideas/letters.ts");
const { makeBoard, clampBoard, maxTier, BoardSchema } = await import("../src/hooks/jobBoard.ts");
const { rngFrom } = await import("../src/town/population.ts");
type Runner = import("../src/ai/claude.ts").Runner;

const args = process.argv.slice(2);
const argOf = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const WANT = (argOf("--models") ?? "opus,sonnet,haiku,sol").split(",") as ModelKey[];

const db = openDb(TEST_SAVE);
installTalkHooks();

// ------------------------------------------------------------------ helpers

interface Clock {
  day: number;
  hour: number;
  minute: number;
}
interface Sample {
  id: string;
  hook: string;
  label: string;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  schema: z.ZodType;
  at: Clock;
  /** The game's own checks on an answer: each broken rule, in words. */
  check: (out: any) => string[];
  /** Hooks where every number is the engine's: a digit in the words that is not in the prompt breaks it. */
  enginNumbers: boolean;
}
const samples: Sample[] = [];

const clockNow = (): Clock => db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as Clock;
const setClock = (c: Partial<Clock>) => {
  const n = { ...clockNow(), ...c };
  db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(n.day, n.hour, n.minute);
};
/** Run f and undo every row it wrote. */
function dry<T>(f: () => T): T {
  let out: T | undefined;
  try {
    db.transaction(() => {
      out = f();
      throw new Error("__rollback__");
    })();
  } catch (e) {
    if (!(e instanceof Error) || e.message !== "__rollback__") throw e;
  }
  return out as T;
}

/**
 * Run a real hook with a capturing runner: the first call is recorded, then aborted (so the
 * hook does not retry it and falls back to the engine). Budgets are cleared first.
 */
async function capture(label: string, schema: z.ZodType, run: (runner: Runner) => Promise<unknown>, check: (out: any) => string[], enginNumbers = true, wantHook?: string): Promise<Sample | null> {
  db.prepare("DELETE FROM ai_call").run();
  let got: { system: string; prompt: string; jsonSchema: Record<string, unknown> } | null = null;
  const runner: Runner = async (req) => {
    if (!got) got = { system: req.system, prompt: req.prompt, jsonSchema: req.jsonSchema };
    req.signal.abort();
    throw new Error("captured");
  };
  const at = clockNow();
  try {
    await run(runner);
  } catch (e) {
    console.error(`[capture] ${label}: hook threw ${String(e).slice(0, 200)}`);
  }
  const row = db.prepare("SELECT hook FROM ai_call ORDER BY id LIMIT 1").get() as { hook: string } | undefined;
  db.prepare("DELETE FROM ai_call").run();
  if (!got || !row || (wantHook && row.hook !== wantHook)) {
    console.error(`[capture] ${label}: no ${wantHook ?? ""} call made (${row?.hook ?? "none"})`);
    return null;
  }
  const g = got as { system: string; prompt: string; jsonSchema: Record<string, unknown> };
  const s: Sample = { id: `${row.hook}#${samples.filter((x) => x.hook === row.hook).length + 1}`, hook: row.hook, label, ...g, schema, at, check, enginNumbers };
  samples.push(s);
  console.error(`[capture] ${s.id} ${label}: ${s.system.length + s.prompt.length} chars`);
  return s;
}

/** Every string in an answer (keys that are ids or enums are left out by the checks that care). */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => strings(x, out));
  return out;
}
const LEAK = /\b(AI|A\.I\.|language model|Claude|Anthropic|OpenAI|GPT|assistant|prompt|JSON|instruction|developer|debug|2022|2024|2025|2026|smartphone|airport|laptop|Python|as an AI|okay|OK|guys|awesome|telephone|phone|radio|computer|internet|e-?mail|weekend|teenager)\b/;
const WRONG_MONEY = /\b(pence|penny|pennies|shillings?|quid|dollars?|cents|guilders?|stuivers?|centen)\b/i;
/** The checks every hook gets: Dutch that plainEnglish strips, a word from outside 1873, foreign money, digits the engine did not give. */
function generic(s: Sample, out: unknown): string[] {
  const breaks: string[] = [];
  const strs = strings(out).filter((x) => x.length > 12 || /\s/.test(x));
  for (const x of strs) {
    const norm = x.replace(/\s{2,}/g, " ").trim();
    if (plainEnglish(x) !== norm) breaks.push(`Dutch: "${norm.slice(0, 60)}"`);
    const leak = norm.match(LEAK);
    if (leak) breaks.push(`not 1873: "${leak[0]}"`);
    const money = norm.match(WRONG_MONEY);
    if (money) breaks.push(`wrong money: "${money[0]}"`);
  }
  if (s.enginNumbers) {
    const have = new Set(s.prompt.match(/\d+/g) ?? []);
    const extra = [...new Set(strs.join(" ").match(/\d+/g) ?? [])].filter((d) => !have.has(d));
    if (extra.length) breaks.push(`invented number: ${extra.slice(0, 3).join(", ")}`);
  }
  return breaks;
}

// ------------------------------------------------------------------ seed the test save (fictional town facts, written by this script)

const R = town(db).town.residents;
const adults = R.filter((r) => r.age >= 18 && r.age < 70 && !(r as any).visitor);
const byTrade = (t: string, n = 0) => R.filter((r) => r.trade === t)[n];
const ev = (kind: string, verb: string, text: string, weight: number, actor?: string) => writeEvent(db, { kind: kind as any, verb, text, weight, actor: actor ?? null, who: actor ? [actor] : [] });
const docker = byTrade("docker") ?? adults[0];
const docker2 = byTrade("docker", 1) ?? adults[1];
const fishwife = byTrade("fishwife") ?? adults[2];
const police = byTrade("police") ?? adults[3];
const baker = byTrade("baker") ?? adults[4];
const priest = byTrade("priest") ?? adults[5];

function seedDay(day: number) {
  setClock({ day, hour: 9, minute: 0 });
  if (day === 1) {
    ev("action", "finished_job", `Jef carried twelve sacks of coffee from the Rijnkaai to the Hessenatie shed and was paid 90 centimes.`, 4, "player");
    log(db, "finished_job", null, "Jef carried twelve sacks of coffee to the Hessenatie shed.");
    ev("event", "wedding", `A wedding at the cathedral: ${docker.name} stood witness, and the bells rang for half an hour.`, 5, docker.id);
  }
  if (day === 2) {
    ev("theft", "robbed", `A pickpocket took 35 centimes from Jef at the Vismarkt in the morning crowd.`, 6, "player");
    log(db, "robbed", null, "A pickpocket took 35 centimes from Jef at the Vismarkt.");
    ev("action", "returned_purse", `Jef found a purse by the Steen and gave it back to ${fishwife.name}.`, 6, "player");
    log(db, "returned", fishwife.id, `Jef gave ${fishwife.name} back her purse.`);
    ev("event", "street_music", `A barrel organ played on the Grote Markt; a monkey in a red coat took the pennies.`, 4);
    ev("police", "scuffle", `${docker.name} and ${docker2.name} shoved each other outside the Engel over a debt; ${police.name} parted them.`, 5, docker.id);
    setClock({ hour: 13 });
    remember(db, docker.id, "Jef gave back a purse he found by the Steen. Honest lad.", 6, "heard", fishwife.id, { gist: "Jef gave back a purse he found by the Steen", tone: 1 });
    remember(db, baker.id, "They say Jef had his pocket picked at the Vismarkt and cried like a child.", 5, "heard", fishwife.id, { gist: "Jef had his pocket picked at the Vismarkt", tone: -1 });
    remember(db, police.id, "Jef was seen at the Engel late, arguing about money.", 4, "heard", docker2.id, { gist: "Jef argued about money at the Engel late at night", tone: -1 });
    remember(db, priest.id, "Jef carried coffee sacks all morning without a word of complaint.", 4, "heard", docker.id, { gist: "Jef carried coffee sacks all morning without complaint", tone: 1 });
  }
  if (day === 3) {
    ev("event", "funeral", `A funeral went up the Hoogstraat: ${baker.name}'s old father, carried by four dockers.`, 5, baker.id);
    ev("action", "finished_job", `Jef watched the chandler's oil barrels at the Kraanhoofd until the bell and was paid 60 centimes.`, 4, "player");
    log(db, "finished_job", null, "Jef watched the oil barrels at the Kraanhoofd.");
    ev("action", "stole", `Jef took an apple from a stall on the Vrijdagmarkt; nobody saw.`, 4, "player");
    log(db, "stole", null, "Jef took an apple from a stall on the Vrijdagmarkt.");
    setClock({ hour: 14 });
    remember(db, fishwife.id, "Jef took an apple from a stall, bold as brass.", 5, "heard", baker.id, { gist: "Jef took an apple from a stall on the Vrijdagmarkt", tone: -1 });
    remember(db, docker2.id, "Jef stood watch at the Kraanhoofd all night and not one barrel went.", 5, "heard", docker.id, { gist: "Jef kept watch at the Kraanhoofd and not one barrel went missing", tone: 1 });
    remember(db, baker.id, "Jef was at the funeral, cap in hand, at the back.", 4, "heard", priest.id, { gist: "Jef stood at the back of the funeral with his cap in hand", tone: 1 });
  }
  if (day === 4) {
    ev("event", "fire", `A chimney fire in the Schipperskwartier; the horse pump came and the bucket chain put it out. Nobody hurt.`, 6);
    ev("action", "supper", `Jef ate supper with ${docker.name}'s family.`, 4, "player");
    log(db, "supper", docker.id, `Jef ate supper with ${docker.name}'s family.`);
    setClock({ hour: 15 });
    remember(db, police.id, "Jef helped at the bucket chain at the chimney fire.", 6, "heard", docker.id, { gist: "Jef helped at the bucket chain at the chimney fire", tone: 2 });
    remember(db, fishwife.id, "Jef eats at other people's tables now, they say.", 4, "heard", baker.id, { gist: "Jef ate supper at a docker's table", tone: 0 });
    remember(db, priest.id, "Jef was seen near the Schipperskwartier at night.", 4, "heard", police.id, { gist: "Jef was seen in the Schipperskwartier at night", tone: -1 });
  }
}
for (const d of [1, 2, 3, 4]) seedDay(d);

// ------------------------------------------------------------------ 1. capture

const at = (day: number, hour: number) => setClock({ day, hour, minute: 10 });

// resident talk: four people, four lines of Jef's (written for this test)
const TALK: Array<[typeof docker, string, number, number]> = [
  [docker, "Is there any work left on the quays today, or has the natie taken on all it needs?", 2, 10],
  [fishwife, "Thank you again for yesterday. Is your purse still where it should be?", 3, 11],
  [police, "Someone took my money at the Vismarkt. What can a man do about it?", 3, 16],
  [baker, "My mother writes from the Kempen that the potatoes failed. Is bread going to be dear this winter?", 4, 8],
];
for (const [r, line, day, hour] of TALK) {
  at(day, hour);
  resetTalks();
  syncFromClient({ x: r.home.sx, z: r.home.sz, people: [{ id: r.id, x: r.home.sx + 1, z: r.home.sz }] });
  residentOpen(db, r.id);
  await capture(`${r.name} (${r.trade}, ${r.age}): "${line}"`, ResidentLineSchema, (run) => residentFree(db, r.id, line, run), (out) => {
    const shown = dry(() => talkHooks.proposal(db, resident(db, r.id)!, out));
    return shown.npc_line !== out.npc_line ? [`action refused by the engine (${out.action?.kind ?? "?"})`] : [];
  }, false, "resident_talk");
}

// the director: four hours on three days
for (const [day, hour] of [[4, 11], [4, 16], [4, 19], [4, 21]]) {
  at(day, hour);
  let s = await capture(`day ${day}, ${hour}:10, "Decide."`, DirectorSchema, (run) => think(db, run, true, false), directorCheck, true, "director_think");
  if (!s) s = await capture(`day ${day}, ${hour}:10, invent`, DirectorSchema, (run) => think(db, run, true, true), directorCheck, true, "director_think");
}
function directorCheck(out: any): string[] {
  const b: string[] = [];
  if (out.decision === "event") {
    const res = dry(() => planEvent(db, planFromModel(out), {}));
    if (!res.ok) b.push(`event refused by the scheduler: ${String(res.why).slice(0, 80)}`);
    if (VIOLENCE_RE.test(strings(out.event).join(" "))) b.push("violence words");
  }
  return b;
}

// street conversations
const CONVOS: Array<[any, number, number, string]> = [
  [{ a: docker.id, b: docker2.id, purpose: "argue", about: "a debt of drink money" }, 2, 18, "argue"],
  [{ a: fishwife.id, b: baker.id, purpose: "chat" }, 3, 10, "chat, gossip"],
  [{ a: police.id, b: docker2.id, purpose: "question", fixed: { guilty: true, amount_c: 35 } }, 2, 14, "question, guilty, 35 c"],
  [{ a: baker.id, b: priest.id, purpose: "invite", about: "the funeral mass tomorrow" }, 3, 9, "invite"],
];
for (const [o, day, hour, label] of CONVOS) {
  at(day, hour);
  await capture(`${label}: ${resident(db, o.a)!.name} and ${resident(db, o.b)!.name}`, ConvoSchema, (run) => runConvo(db, o, run), (out) => {
    const b: string[] = [];
    if (out.lines[0]?.speaker !== "A") b.push("B spoke first");
    if (out.lines.some((l: any, i: number) => i > 0 && l.speaker === out.lines[i - 1].speaker)) b.push("no turn-taking");
    if (VIOLENCE_RE.test(out.lines.map((l: any) => l.text).join(" "))) b.push("violence words");
    return b;
  }, true, "npc_convo");
}

// the morning paper, four mornings
for (const day of [1, 2, 3, 4]) {
  at(day, 6);
  db.prepare("DELETE FROM newspaper WHERE day = ?").run(day);
  const s = await capture(`paper of day ${day}`, PaperSchema, (run) => makePaper(db, run), () => [], true, "newspaper");
  if (s) {
    const facts = factsOf(db, day);
    s.check = (out) => {
      const p = cleanPaper(day, facts, out);
      const b: string[] = [];
      for (const a of out.articles) {
        const c = p.articles.find((x) => x.fact === a.fact);
        if (!c || c.text !== plainEnglish(a.text)) b.push(`article on fact ${a.fact} replaced by the engine`);
      }
      for (const sh of out.shipping) {
        const c = p.shipping.find((x) => x.ship === sh.ship);
        if (!c || c.line !== plainEnglish(sh.line)) b.push(`ship line ${sh.ship} replaced`);
      }
      if (p.cry !== plainEnglish(out.cry).replace(/\s+/g, " ").trim()) b.push("cry replaced");
      return b;
    };
  }
}

// the Poesje's play, four evenings
for (const day of [1, 2, 3, 4]) {
  at(day, 17);
  db.prepare("DELETE FROM world_state WHERE key LIKE 'poesje:show:%'").run();
  await capture(`play of day ${day}`, PlaySchema, (run) => writeShow(db, run), (out) => (cleanPlay(out) ? [] : ["play thrown out by cleanPlay"]), true, "poesje_show");
}

// wall posters: four batches
{
  const batches: Array<[number, () => any[]]> = [
    [2, () => morningPlans(db, rngFrom(11))],
    [3, () => [...sailingPlans(db), ...auctionPlans(db)].slice(0, 3)],
    [4, () => [...orderPlans(db), ...[lostPlan(db, rngFrom(7))].filter(Boolean)].slice(0, 3)],
    [3, () => [lostPlan(db, rngFrom(99)), ...morningPlans(db, rngFrom(5))].filter(Boolean).slice(0, 3)],
  ];
  for (const [day, plansOf] of batches) {
    at(day, 7);
    db.prepare("UPDATE poster SET status = 'down'").run();
    const plans = plansOf();
    if (!plans.length) {
      console.error(`[capture] poster day ${day}: no plans`);
      continue;
    }
    await capture(`bills day ${day}: ${plans.map((p) => p.kind).join(", ")}`, PosterBatchSchema, (run) => putUp(db, plans, { runner: run }), (out) => {
      const b: string[] = [];
      plans.forEach((p, i) => {
        const o = out.posters.find((x: any) => x.n === i + 1);
        if (!o) b.push(`bill ${i + 1} missing`);
        else if (!cleanPoster(db, p, o)) b.push(`bill ${i + 1} (${p.kind}) refused by cleanPoster`);
      });
      return b;
    }, true, "poster");
  }
}

// rumour twists: the heard rumours of four days
for (const day of [1, 2, 3, 4]) {
  at(day, 16);
  db.prepare("DELETE FROM world_state WHERE key = 'twist'").run();
  const s = await capture(`rumours of day ${day}`, TwistSchema, (run) => twistRumours(db, run, true), () => [], true, "rumour_twist");
  if (s) {
    const ids = [...s.prompt.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]));
    const gist = new Map(ids.map((id) => [id, (db.prepare("SELECT gist FROM npc_memory WHERE id = ?").get(id) as { gist: string }).gist]));
    s.check = (out) => {
      const b: string[] = [];
      for (const t of out.tellings) {
        const g = gist.get(t.id);
        if (!g) b.push(`unknown id ${t.id}`);
        else if (!withinFact(g, plainEnglish(t.told).trim().replace(/\s+/g, " "))) b.push(`telling ${t.id} drifted off the fact`);
      }
      const missing = ids.filter((id) => !out.tellings.some((t: any) => t.id === id));
      if (missing.length) b.push(`${missing.length} rumour(s) left out`);
      return b;
    };
  }
}

// dreams: the nights after four days
for (const day of [1, 2, 3, 4]) {
  at(day, 23);
  db.prepare("DELETE FROM world_state WHERE key = 'dream'").run();
  await capture(`night after day ${day}`, DreamSchema, (run) => dreamOf(db, run), (out) => {
    const b: string[] = [];
    if (/\d/.test(out.dream)) b.push("a number in the dream");
    if (VIOLENCE_RE.test(out.dream)) b.push("violence words");
    return b;
  }, true, "dream");
}

// family share: four tellers with news of Jef, told at home
{
  const withKin = adults.filter((r) => R.some((o) => o.household === r.household && o.id !== r.id && o.age >= 16) && !(r as any).visitor);
  const tellers = [withKin[3], withKin[17], withKin[40], withKin[63]].filter(Boolean);
  const NEWS: Array<[string, number]> = [
    ["Jef gave back a purse he found by the Steen", 2],
    ["Jef took an apple from a stall on the Vrijdagmarkt", -1],
    ["Jef shoved my cart out of the way on the Kaai and laughed", -2],
    ["Jef helped at the bucket chain at the chimney fire", 2],
  ];
  let i = 0;
  for (const t of tellers) {
    at(2 + (i % 3), 19);
    const [gist, tone] = NEWS[i++];
    remember(db, t.id, `${gist}. I saw it myself.`, 7, "seen", null, { gist, tone });
    scanNews(db);
    const n = db.prepare("SELECT id FROM family_news WHERE teller = ? AND status = 'waiting' ORDER BY id LIMIT 1").get(t.id) as { id: number } | undefined;
    if (!n) continue;
    const news = newsRow(db, n.id)!;
    const b = resident(db, news.listener)!;
    await capture(`${t.name} tells ${b.name}: ${gist}`, ShareSchema, (run) => shareNews(db, n.id, { runner: run }), (out) => {
      const br: string[] = [];
      const d = dry(() => decideReaction(db, b, news, { reaction: out.reaction, amount_c: out.amount_c }, rngFrom(1)));
      if (d.refused) br.push(`reaction refused: ${d.refused}`);
      for (const l of [...out.lines.map((x: any) => x.text), out.opening_line]) {
        if (VIOLENCE_RE.test(l)) br.push("violence words");
        if (/\b\d+\s*(centimes?|francs?|c)\b/i.test(l) || /\b(hundred|thousand)\b/i.test(l)) br.push("a sum in a line");
      }
      return br;
    }, true, "family_share");
  }
}

// letter replies: four letters of Jef's (written for this test)
{
  const LETTERS: Array<[typeof docker, string]> = [
    [docker, "Dear friend, thank you for the work on the quay. I am learning the knots. Is there more work next week? Your friend Jef."],
    [fishwife, "I hope the purse is safe. I did not take anything from it, I swear on my mother. Could you use a boy to carry the baskets?"],
    [baker, "Your bread is the best in the town but you give short weight, everyone says so. Fix it or I will tell the police."],
    [priest, "Father, I took an apple that was not mine. I am sorry. Will God forgive a hungry man? Jef from the Kempen."],
  ];
  for (const [r, text] of LETTERS) {
    at(3, 8);
    db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id, trust, times_met) VALUES (?, 3, 1)").run(r.id);
    db.prepare("UPDATE npc_relationship SET times_met = MAX(times_met, 1) WHERE npc_id = ?").run(r.id);
    db.prepare("UPDATE jef_letter SET status = 'answered'").run();
    const id = Number(db.prepare("INSERT INTO jef_letter (day, hour, to_id, to_name, text, gated, stamp_c, reply_day, status) VALUES (2, 15, ?, ?, ?, NULL, 10, 3, 'sent')").run(r.id, r.name, text).lastInsertRowid);
    const s = await capture(`to ${r.name} (${r.trade}): "${text.slice(0, 50)}..."`, ReplySchema, (run) => answerLetters(db, { runner: run }), () => [], true, "letter_reply");
    if (s) {
      const l = jefLetter(db, id)!;
      const e = JSON.parse(l.effect_json || '{"kind":"none"}');
      s.check = (out) => (cleanReply(db, l, e, out) ? [] : ["reply refused by cleanReply"]);
    }
  }
}

// the job board, three mornings
for (const day of [2, 3, 4]) {
  at(day, 6);
  const tier = maxTier(db);
  await capture(`board of day ${day}`, BoardSchema, (run) => makeBoard(db, run), (out) => {
    const c = clampBoard(out, tier);
    const b: string[] = [];
    out.jobs.forEach((j: any, i: number) => {
      if (JSON.stringify(c.jobs[i]) !== JSON.stringify(j)) b.push(`job ${i + 1} clamped`);
    });
    return b;
  }, false, "job_board");
}

console.error(`[capture] ${samples.length} prompts`);
fs.writeFileSync(path.join(OUT_DIR, "samples.json"), JSON.stringify(samples.map(({ schema: _s, check: _c, ...x }) => x), null, 1));
if (args.includes("--capture-only")) process.exit(0);

// ------------------------------------------------------------------ 2. run the models

interface Attempt {
  ms: number;
  valid: boolean;
  error?: string;
  output?: unknown;
  usage?: { in?: number; out?: number; cacheRead?: number };
}
interface RunRow {
  key: string;
  sample: string;
  model: ModelKey;
  attempts: Attempt[];
}
const RESULTS = path.join(OUT_DIR, "results.json");
const done: Record<string, RunRow> = fs.existsSync(RESULTS) ? JSON.parse(fs.readFileSync(RESULTS, "utf8")) : {};
const save = () => fs.writeFileSync(RESULTS, JSON.stringify(done, null, 1));
const keyOf = (s: Sample, m: ModelKey) => crypto.createHash("sha1").update(`${m}\n${s.system}\n${s.prompt}`).digest("hex").slice(0, 16);

async function once(s: Sample, m: ModelKey): Promise<Attempt> {
  const choice = MODELS[m];
  const run: Runner = choice.provider === "codex" ? codexRunner : sdkRunner;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), HARD_CAP_MS);
  const t0 = Date.now();
  try {
    const res = await run({ system: s.system, prompt: s.prompt, jsonSchema: s.jsonSchema, signal: abort, model: choice.model, effort: "effort" in choice ? choice.effort : undefined });
    const p = s.schema.safeParse(res.output);
    return { ms: Date.now() - t0, valid: p.success, output: p.success ? p.data : res.output, usage: res.usage, error: p.success ? undefined : "schema: " + p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ") };
  } catch (e) {
    return { ms: Date.now() - t0, valid: false, error: abort.signal.aborted ? `cut at ${HARD_CAP_MS} ms` : String(e instanceof Error ? e.message : e).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

async function pool<T>(items: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let x = q.shift(); x !== undefined; x = q.shift()) await f(x);
  }));
}

await Promise.all(
  WANT.map((m) =>
    pool(samples, 2, async (s) => {
      const key = keyOf(s, m);
      if (done[key]) return;
      const a1 = await once(s, m);
      const attempts = [a1];
      if (!a1.valid) attempts.push(await once(s, m));
      done[key] = { key, sample: s.id, model: m, attempts };
      save();
      console.error(`[run] ${m} ${s.id}: ${attempts.map((a) => `${a.ms} ms ${a.valid ? "ok" : a.error}`).join(" / ")}`);
    }),
  ),
);

// ------------------------------------------------------------------ 3. judge (Opus 5.5, blind)

const JUDGE_SYSTEM = `You judge short pieces of game writing for Scheldemist, a game set in Antwerp in the autumn of 1873.
Each piece answers the same game prompt; the pieces come from different writers, labelled with letters. You do not know who wrote which.
Score each piece from 1 (bad) to 5 (excellent) on:
- in_character: the speakers sound like these people (their trade, age, stats, mood); a newspaper sounds like a dry 1873 paper, a bill like a bill.
- period_feel: it feels like 1873 Antwerp; no modern words, ideas or money; small period detail is good.
- plain_english: plain, clear English; Dutch only in names of people, places, firms, ships, and jenever.
- fits_facts: it uses the facts given and invents nothing the prompt forbids (sums, names, deeds of Jef, events).
- lively: it is lively, and funny where the piece is meant to be (the puppet play, gossip, a quarrel); not flat or stock.
A piece marked "(no valid answer)" gets 1 on everything. Be strict and consistent; 3 is fair, 5 is rare.`;
const JudgeSchema = z.object({
  scores: z.array(z.object({ label: z.string(), in_character: z.number().int().min(1).max(5), period_feel: z.number().int().min(1).max(5), plain_english: z.number().int().min(1).max(5), fits_facts: z.number().int().min(1).max(5), lively: z.number().int().min(1).max(5), note: z.string().max(200) })),
});
const VarietySchema = z.object({ groups: z.array(z.object({ label: z.string(), variety: z.number().int().min(1).max(5), note: z.string().max(200) })) });
const JUDGED = path.join(OUT_DIR, "judge.json");
const judged: Record<string, unknown> = fs.existsSync(JUDGED) ? JSON.parse(fs.readFileSync(JUDGED, "utf8")) : {};
const saveJ = () => fs.writeFileSync(JUDGED, JSON.stringify(judged, null, 1));
const LETTERS = ["P", "Q", "R", "S", "T"];
const finalOut = (s: Sample, m: ModelKey) => {
  const r = done[keyOf(s, m)];
  const a = r?.attempts.find((x) => x.valid);
  return a ? a.output : null;
};
function shuffled<T>(xs: T[], salt: string): T[] {
  const h = (x: string) => crypto.createHash("sha1").update(salt + x).digest("hex");
  return [...xs].sort((a, b) => (h(String(a)) < h(String(b)) ? -1 : 1));
}
async function judgeCall<S extends z.ZodType>(system: string, prompt: string, schema: S): Promise<z.infer<S> | null> {
  const { $schema: _d, ...js } = z.toJSONSchema(schema) as Record<string, unknown>;
  for (let i = 0; i < 2; i++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 180_000);
    try {
      const r = await sdkRunner({ system, prompt, jsonSchema: js, signal: abort, model: MODELS.opus.model, effort: MODELS.opus.effort });
      const p = schema.safeParse(r.output);
      if (p.success) return p.data;
    } catch (e) {
      console.error("[judge]", String(e).slice(0, 200));
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}
if (!args.includes("--no-judge")) {
  await pool(samples, 3, async (s) => {
    const jk = "s:" + keyOf(s, "opus") + WANT.join(",");
    if (judged[jk]) return;
    const order = shuffled(WANT, s.id);
    const pieces = order.map((m, i) => `PIECE ${LETTERS[i]}\n${finalOut(s, m) ? JSON.stringify(finalOut(s, m), null, 1) : "(no valid answer)"}`).join("\n\n");
    const prompt = `THE GAME'S INSTRUCTIONS TO THE WRITERS\n"""\n${s.system}\n"""\n\nTHE PROMPT\n"""\n${s.prompt}\n"""\n\n${pieces}\n\nScore every piece (labels ${order.map((_, i) => LETTERS[i]).join(", ")}).`;
    const out = await judgeCall(JUDGE_SYSTEM, prompt, JudgeSchema);
    if (!out) return;
    judged[jk] = { sample: s.id, scores: out.scores.map((x) => ({ ...x, model: order[LETTERS.indexOf(x.label)] })) };
    saveJ();
    console.error(`[judge] ${s.id}`);
  });
  const hooks = [...new Set(samples.map((s) => s.hook))];
  await pool(hooks, 3, async (h) => {
    const jk = "v:" + h + ":" + samples.filter((s) => s.hook === h).map((s) => keyOf(s, "opus")).join("") + WANT.join(",");
    if (judged[jk]) return;
    const order = shuffled(WANT, h);
    const groups = order
      .map((m, i) => `GROUP ${LETTERS[i]}\n${samples.filter((s) => s.hook === h).map((s, k) => `(${k + 1}) ${finalOut(s, m) ? JSON.stringify(finalOut(s, m)) : "(no valid answer)"}`).join("\n")}`)
      .join("\n\n");
    const out = await judgeCall(
      JUDGE_SYSTEM.split("\n")[0] + "\nEach GROUP below holds one writer's answers to several different prompts of the same kind. Score each group's VARIETY from 1 to 5: do the answers differ in shape, openings, jokes, words and ideas, or do they repeat one pattern? Judge variety only.",
      groups,
      VarietySchema,
    );
    if (!out) return;
    judged[jk] = { hook: h, groups: out.groups.map((g) => ({ ...g, model: order[LETTERS.indexOf(g.label)] })) };
    saveJ();
    console.error(`[judge] variety ${h}`);
  });
}

// ------------------------------------------------------------------ 4. tables

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
const quant = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
};
const secs = (ms: number) => (Number.isFinite(ms) ? (ms / 1000).toFixed(1) : "-");
const lines: string[] = [];
const summary: Record<string, Record<string, unknown>> = {};
const vsOpus = (h: string) => (summary[`${h}/opus`] ?? {}) as any;
const speed = (ms: number, base: number) => (Number.isFinite(ms) ? `${secs(ms)}${Number.isFinite(base) && base > 0 ? ` (${(ms / base).toFixed(1)}x)` : ""}` : "-");
const judgeCell = (j: number, base: number, isBase: boolean) => (Number.isFinite(j) ? `${j.toFixed(2)}${isBase || !Number.isFinite(base) ? "" : ` (${j - base >= 0 ? "+" : ""}${(j - base).toFixed(2)})`}` : "-");
const hooksAll = [...new Set(samples.map((s) => s.hook))];
for (const h of hooksAll) {
  const ss = samples.filter((s) => s.hook === h);
  const jEntries = ss.map((s) => judged["s:" + keyOf(s, "opus") + WANT.join(",")] as any).filter(Boolean);
  const vEntry = judged["v:" + h + ":" + ss.map((s) => keyOf(s, "opus")).join("") + WANT.join(",")] as any;
  for (const m of WANT) {
    const rows = ss.map((s) => ({ s, r: done[keyOf(s, m)] })).filter((x) => x.r);
    const first = rows.map((x) => x.r.attempts[0]);
    const lat = first.filter((a) => !a.error || a.error.startsWith("schema")).map((a) => a.ms);
    const v1 = first.filter((a) => a.valid).length;
    const v2 = rows.filter((x) => x.r.attempts.some((a) => a.valid)).length;
    const inTime = rows.filter((x) => {
      const ok = x.r.attempts.findIndex((a) => a.valid);
      if (ok < 0) return false;
      return x.r.attempts.slice(0, ok + 1).reduce((n, a) => n + a.ms, 0) <= GAME_TIMEOUT_MS;
    }).length;
    let breaks = 0;
    const kinds: string[] = [];
    for (const x of rows) {
      const out = x.r.attempts.find((a) => a.valid)?.output;
      if (!out) continue;
      setClock(x.s.at);
      const b = [...generic(x.s, out), ...x.s.check(out)];
      if (b.length) breaks++;
      kinds.push(...b);
    }
    const js = jEntries.flatMap((j) => j.scores.filter((x: any) => x.model === m));
    const judge = js.length ? js.reduce((n: number, x: any) => n + (x.in_character + x.period_feel + x.plain_english + x.fits_facts + x.lively) / 5, 0) / js.length : NaN;
    const variety = vEntry?.groups.find((g: any) => g.model === m)?.variety;
    summary[`${h}/${m}`] = { median: quant(lat, 0.5), p90: quant(lat, 0.9), v1, v2, inTime, n: rows.length, breaks, kinds, judge, variety, lat };
  }
  lines.push(`\n### ${h} (${ss.length} prompts)\n`, "| Model | Median s (vs Opus) | p90 s | Valid 1st | Valid after retry | Done in 20 s | Rule breaks | Judge, 5 best (vs Opus) | Variety |", "|---|---|---|---|---|---|---|---|---|");
  for (const m of WANT) {
    const v = summary[`${h}/${m}`] as any;
    const top = Object.entries((v.kinds as string[]).reduce<Record<string, number>>((o, k) => ((o[k.replace(/:.*/, "")] = (o[k.replace(/:.*/, "")] ?? 0) + 1), o), {}))
      .map(([k, n]) => `${k} x${n}`)
      .join("; ");
    lines.push(`| ${m} | ${speed(v.median, m === "opus" ? NaN : vsOpus(h).median)} | ${secs(v.p90)} | ${pct(v.v1, v.n)} | ${pct(v.v2, v.n)} | ${pct(v.inTime, v.n)} | ${v.breaks}/${v.n}${top ? ` (${top})` : ""} | ${judgeCell(v.judge, vsOpus(h).judge, m === "opus")} | ${v.variety ?? "-"} |`);
  }
}
// all hooks together, Opus 5.5 as the baseline
lines.push("\n### All hooks\n", "| Model | Median s (vs Opus) | p90 s | Valid 1st | Valid after retry | Done in 20 s | Answers with a rule break | Judge (vs Opus) |", "|---|---|---|---|---|---|---|---|");
const allOf = (m: string) => {
  const sm = hooksAll.map((h) => summary[`${h}/${m}`] as any).filter(Boolean);
  const lat = sm.flatMap((v) => v.lat as number[]);
  const n = sm.reduce((a, v) => a + v.n, 0);
  const js = sm.filter((v) => Number.isFinite(v.judge));
  return { sm, lat, n, judge: js.length ? js.reduce((a, v) => a + v.judge, 0) / js.length : NaN };
};
const baseAll = allOf("opus");
for (const m of WANT) {
  const a = allOf(m);
  lines.push(`| ${m} | ${speed(quant(a.lat, 0.5), m === "opus" ? NaN : quant(baseAll.lat, 0.5))} | ${secs(quant(a.lat, 0.9))} | ${pct(a.sm.reduce((x, v) => x + v.v1, 0), a.n)} | ${pct(a.sm.reduce((x, v) => x + v.v2, 0), a.n)} | ${pct(a.sm.reduce((x, v) => x + v.inTime, 0), a.n)} | ${a.sm.reduce((x, v) => x + v.breaks, 0)}/${a.n} | ${judgeCell(a.judge, baseAll.judge, m === "opus")} |`);
}
fs.writeFileSync(path.join(OUT_DIR, "tables.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 1));
console.log(lines.join("\n"));
db.close();
