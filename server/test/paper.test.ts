import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { PAPER_CALLS_PER_DAY } from "../src/config.ts";
import { finishJob, ReportSchema, takeJob } from "../src/game.ts";
import { listJobs, TIER_PAY, maxTier, type LettersTask } from "../src/hooks/jobBoard.ts";
import { remember } from "../src/npcs.ts";
import { town } from "../src/town/store.ts";
import { buy, pockets, useItem, waresOf, atWork } from "../src/trade.ts";
import {
  cleanPaper,
  enginePaper,
  makePaper,
  paperFacts,
  paperOf,
  PAPER_PRICE_C,
  writeHarbour,
  type PaperOut,
} from "../src/paper/newspaper.ts";
import {
  cleanLetter,
  clerkRemark,
  deliverAt,
  ensureLetterRound,
  errandJob,
  fallbackLetter,
  letterView,
  maybeLetter,
  pickUp,
  planLetter,
  postCounter,
  sendTelegram,
  sumsOk,
  TELEGRAM_FEE_C,
  type LetterOut,
} from "../src/paper/post.ts";
import { bergView, forfeitPawns, loanFor, pawn, rateFor, redeem, redeemCost, TERM_DAYS } from "../src/paper/pawn.ts";
import { ensurePressTown, POST_CLERK_ID, pressTown } from "../src/paper/town.ts";

// M6: the paper, the post, the pawn office. The engine owns every fact and number;
// the model (a stub Runner here) only proposes words.

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const broken: Runner = async () => {
  throw new Error("down");
};
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: Db, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const useCalls = (db: Db, hook: string, n: number) => {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, ?, 'claude', 'x', 1, 1)").run(day, hook);
};
const seq = (xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};
function fresh(day = 2, hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  return db;
}
const people = (db: Db) => town(db).town.residents;

// ------------------------------------------------------------------ the town

describe("the press in the town", () => {
  it("has three newsboys of 10 to 14 from different households, a post office with a clerk, and the Berg", () => {
    const db = fresh();
    const p = pressTown(db)!;
    expect(p.newsboys).toHaveLength(3);
    const boys = p.newsboys.map((id) => town(db).byId.get(id)!);
    for (const b of boys) {
      expect(b.trade).toBe("newsboy");
      expect(b.age).toBeGreaterThanOrEqual(10);
      expect(b.age).toBeLessThanOrEqual(14);
      expect(b.work.kind).toBe("post");
      expect(waresOf(db, b.id)).toEqual([{ kind: "newspaper", price_c: PAPER_PRICE_C }]);
    }
    expect(new Set(boys.map((b) => b.household)).size).toBe(3);
    expect(p.post).not.toBeNull();
    expect(town(db).byId.get(POST_CLERK_ID)?.trade).toBe("post_clerk");
    expect(town(db).town.places.post_office).toBeTruthy();
    expect(p.berg?.clerk).toBe(town(db).town.shops.find((s) => s.id === "pawn_vis")?.keeper);
    expect(p.medal).toBe("owned");
  });

  it("an older save gets the press in place: residents, memories and relationships kept", () => {
    const db = fresh();
    // make it an older save: no press, no post clerk, the boys back at play
    const p = pressTown(db)!;
    db.prepare("DELETE FROM world_state WHERE key = 'press'").run();
    for (const t of ["npc_relationship WHERE npc_id", "resident WHERE id", "npc WHERE id"]) db.prepare(`DELETE FROM ${t} = ?`).run(POST_CLERK_ID);
    for (const id of p.newsboys) db.prepare("UPDATE resident SET trade = 'child', data_json = json_set(data_json, '$.trade', 'child') WHERE id = ?").run(id);
    const someone = people(db).find((r) => r.trade === "docker")!;
    remember(db, someone.id, "Jef carried a sack for me.", 6, "seen", null, { gist: "Jef carried a sack for a docker", tone: 1 });
    db.prepare("UPDATE npc_relationship SET trust = 4, times_met = 2 WHERE npc_id = ?").run(someone.id);
    const before = {
      residents: (db.prepare("SELECT COUNT(*) n FROM resident").get() as { n: number }).n,
      memories: (db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n,
      rel: db.prepare("SELECT * FROM npc_relationship WHERE npc_id = ?").get(someone.id),
      rows: new Map((db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>).map((r) => [r.id, r.data_json])),
    };
    const made = ensurePressTown(db);
    expect(made.newsboys).toBe(3);
    expect(made.clerk).toBe(true);
    expect((db.prepare("SELECT COUNT(*) n FROM resident").get() as { n: number }).n).toBe(before.residents + 1);
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory").get() as { n: number }).n).toBe(before.memories);
    expect(db.prepare("SELECT * FROM npc_relationship WHERE npc_id = ?").get(someone.id)).toEqual(before.rel);
    const boys = new Set(pressTown(db)!.newsboys);
    const after = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
    for (const r of after) if (!boys.has(r.id) && r.id !== POST_CLERK_ID) expect(r.data_json).toBe(before.rows.get(r.id));
    // once only
    expect(ensurePressTown(db)).toEqual({ newsboys: 0, clerk: false });
  });
});

// ------------------------------------------------------------------ the paper

describe("the morning paper", () => {
  it("takes its facts from the log only: what the town saw, never an unseen deed or a thief's name", () => {
    const db = fresh(2, 6);
    const thief = people(db).find((r) => r.trade === "thief")!;
    const docker = people(db).find((r) => r.trade === "docker")!;
    // yesterday: a robbery (the log names the thief), an unseen theft by Jef, a seen one, a conversation
    db.prepare("INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (1, 22, 'rijnkaai', 'player', 'robbed', ?, ?)").run(thief.id, `Someone picked Jef's pocket at night and took 15 centimes. It was ${thief.name}.`);
    db.prepare("INSERT INTO log (day, hour, place, actor, verb, object, text) VALUES (1, 20, 'vismarkt', 'player', 'stole', NULL, 'Jef stole a herring and nobody saw.')").run();
    setClock(db, 1, 12);
    remember(db, docker.id, "I saw Jef take a loaf off the baker's table.", 6, "seen", null, { gist: "Jef stole a loaf from the baker", tone: -2 });
    db.prepare("INSERT INTO world_event (day, hour, minute, kind, verb, text, weight) VALUES (1, 14, 0, 'talk', 'convo', 'Two women talked about the price of coal.', 2)").run();
    setClock(db, 2, 6);
    writeHarbour(db, 2);
    const facts = paperFacts(db, 2);
    const texts = facts.map((f) => f.text).join("\n");
    // every fact points at a row of the log (or the day's board)
    for (const f of facts) {
      const [kind, id] = f.ref.split(":");
      if (kind === "we") expect(db.prepare("SELECT 1 FROM world_event WHERE id = ?").get(Number(id))).toBeTruthy();
      else expect(kind).toBe("job");
    }
    expect(texts).toContain("pocket picked");
    expect(texts).toContain("15 centimes");
    expect(texts).not.toContain(thief.name);
    expect(texts).toContain("Jef stole a loaf from the baker");
    expect(texts).not.toContain("herring and nobody saw");
    expect(texts).not.toContain("price of coal");
    expect(facts.some((f) => f.kind === "ship")).toBe(true);
    expect(facts.some((f) => f.kind === "weather")).toBe(true);
    expect(facts.some((f) => f.kind === "market")).toBe(true);
  });

  it("the fallback: the engine writes the paper from the same facts when the model is down", async () => {
    const db = fresh(2, 6);
    const r = await makePaper(db, broken, 500);
    expect(r.paper.source).toBe("engine");
    expect(r.paper.articles.length).toBeGreaterThanOrEqual(2);
    const facts = paperFacts(db, 2);
    for (const a of r.paper.articles) expect(facts.find((f) => f.n === a.fact)?.text).toBe(a.text);
    expect(r.paper.shipping.length).toBe(facts.filter((f) => f.kind === "ship").length);
    expect(paperOf(db, 2)?.headline).toBe(r.paper.headline);
    // the director and the talk of the town can read the headline
    expect(db.prepare("SELECT 1 FROM world_event WHERE verb = 'newspaper' AND day = 2").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM world_fact WHERE tags = 'paper' AND day = 2").get()).toBeTruthy();
    // once a day
    const again = await makePaper(db, reply({}), 500);
    expect(again.paper).toEqual(r.paper);
  });

  it("over its budget share the engine writes it without asking the model", async () => {
    const db = fresh(2, 6);
    useCalls(db, "newspaper", PAPER_CALLS_PER_DAY);
    let asked = false;
    const r = await makePaper(db, async () => {
      asked = true;
      return { output: {} };
    });
    expect(asked).toBe(false);
    expect(r.paper.source).toBe("engine");
  });

  it("the model's paper is checked: unknown facts, invented sums and nameless ship lines give way to the engine", () => {
    const db = fresh(2, 6);
    writeHarbour(db, 2);
    const facts = paperFacts(db, 2);
    const weather = facts.find((f) => f.kind === "weather")!;
    const market = facts.find((f) => f.kind === "market")!;
    const ship = facts.find((f) => f.kind === "ship")!;
    const out: PaperOut = {
      cry: "Handelsblad! 500 francs reward!",
      articles: [
        { fact: 99, headline: "A ROYAL VISIT", text: "The King came to the Rijnkaai and gave every man a franc." },
        { fact: weather.n, headline: "THE WEATHER", text: "A reward of 500 francs is offered to whoever lifts the fog." },
        { fact: market.n, headline: "Markets", text: "Fish and bread at the usual prices; the stalls were busy." },
        { fact: market.n, headline: "AGAIN", text: "A second article on the same fact is dropped by the engine." },
      ],
      shipping: [{ ship: ship.n, line: "A fine vessel came in with something or other." }],
    };
    const p = cleanPaper(2, facts, out);
    expect(p.articles.some((a) => a.text.includes("King"))).toBe(false);
    const w = p.articles.find((a) => a.fact === weather.n)!;
    expect(w.text).toBe(weather.text); // the invented sum gave way to the fact
    expect(p.articles.filter((a) => a.fact === market.n)).toHaveLength(1);
    expect(p.articles.find((a) => a.fact === market.n)!.text).toContain("usual prices");
    expect(p.articles.length).toBeGreaterThanOrEqual(Math.min(4, facts.filter((f) => f.kind !== "ship").length));
    expect(p.shipping.find((s) => s.ship === ship.n)!.line).toContain(ship.ship!.name);
    expect(p.cry).not.toContain("500");
  });

  it("the engine's own paper puts the heaviest fact first", () => {
    const db = fresh(2, 6);
    writeHarbour(db, 2);
    const facts = paperFacts(db, 2);
    const p = enginePaper(2, facts);
    const top = Math.max(...facts.filter((f) => f.kind !== "ship").map((f) => f.weight));
    expect(facts.find((f) => f.n === p.articles[0].fact)!.weight).toBe(top);
    expect(p.cry).toMatch(/^Handelsblad/);
  });

  it("a newsboy sells today's paper for 5 centimes once it is printed; it goes in the pocket to read", async () => {
    const db = fresh(2, 8);
    const boy = pressTown(db)!.newsboys[0];
    expect(atWork(db, boy)).toBe(true);
    expect(() => buy(db, boy, "newspaper")).toThrow(/not in yet/);
    await makePaper(db, broken, 200);
    const m = money(db);
    buy(db, boy, "newspaper");
    expect(money(db)).toBe(m - PAPER_PRICE_C);
    const it = pockets(db).find((p) => p.kind === "newspaper")!;
    expect(it.ref).toBe(2);
    expect(it.use).toBe("read");
    expect(() => useItem(db, it.id)).toThrow(/read/);
    expect(() => buy(db, boy, "newspaper")).toThrow(/already/);
    // the next day's paper: yesterday's is left on a bench
    setClock(db, 3, 8);
    await makePaper(db, broken, 200);
    buy(db, boy, "newspaper");
    expect(pockets(db).filter((p) => p.kind === "newspaper").map((p) => p.ref)).toEqual([3]);
    // no paper in the afternoon: the boys are off
    setClock(db, 3, 15);
    expect(atWork(db, boy)).toBe(false);
  });
});

// ------------------------------------------------------------------ the post

describe("the post office's round", () => {
  it("3 to 5 doors of different households, walked from the office, paid within the board's tier band; once a day, not on Sunday", () => {
    const db = fresh(2, 7);
    const id = ensureLetterRound(db)!;
    expect(id).toBeGreaterThan(0);
    expect(ensureLetterRound(db)).toBeNull();
    const j = listJobs(db, 2).find((x) => x.id === id)!;
    expect(j.playable).toBe(true);
    expect(j.employer_npc).toBe(POST_CLERK_ID);
    const t = j.task as LettersTask;
    expect(t.stops.length).toBeGreaterThanOrEqual(3);
    expect(t.stops.length).toBeLessThanOrEqual(5);
    const hh = t.stops.map((s) => town(db).byId.get(s.id)!.household);
    expect(new Set(hh).size).toBe(hh.length);
    for (const s of t.stops) {
      const r = town(db).byId.get(s.id)!;
      expect([s.x, s.z]).toEqual([r.home.sx, r.home.sz]); // the door step every path check covers
    }
    const [lo, hi] = TIER_PAY[maxTier(db)];
    expect(j.pay_c).toBeGreaterThanOrEqual(lo);
    expect(j.pay_c).toBeLessThanOrEqual(hi);
    setClock(db, 7, 7);
    expect(ensureLetterRound(db)).toBeNull();
  });

  it("the engine counts the doors: the client's word on how many were delivered does not count", () => {
    const db = fresh(2, 10);
    const id = ensureLetterRound(db)!;
    takeJob(db, id);
    const t = listJobs(db, 2).find((x) => x.id === id)!.task as LettersTask;
    const c = postCounter(db)!;
    expect(() => deliverAt(db, id, 0, t.stops[0])).toThrow(/fetch/);
    expect(() => pickUp(db, id, { x: c.x + 50, z: c.z })).toThrow(/not there/);
    pickUp(db, id, c);
    expect(pockets(db).some((p) => p.kind === "letters" && p.job_id === id)).toBe(true);
    expect(() => deliverAt(db, id, 0, { x: t.stops[0].x + 30, z: t.stops[0].z })).toThrow(/right door/);
    deliverAt(db, id, 0, t.stops[0]);
    deliverAt(db, id, 1, t.stops[1]);
    const m = money(db);
    const pay = listJobs(db, 2).find((x) => x.id === id)!.pay_c;
    // the client claims all were delivered: two of them were
    const res = finishJob(db, id, ReportSchema.parse({ delivered: t.stops.length }));
    expect(res.settlement.pay_c).toBe(Math.round((pay * 2) / t.stops.length / 5) * 5);
    expect(money(db)).toBe(m + res.settlement.pay_c);
    expect(pockets(db).some((p) => p.job_id === id)).toBe(false);
  });
});

describe("letters to Jef", () => {
  it("the engine picks the writer from what happened: someone Jef wronged, someone he helped, a stranger", () => {
    const db = fresh(3, 6);
    const wronged = people(db).find((r) => r.trade === "baker")!;
    remember(db, wronged.id, "Jef took a loaf off my table.", 7, "seen", null, { gist: "Jef stole a loaf", tone: -2 });
    const plan = planLetter(db, seq([0.01, 0.9, 0.9, 0.9]));
    expect(plan.sender).toBe(wronged.id);
    expect(plan.why).toBe("wronged");
    expect(["complaint", "make_right"]).toContain(plan.kind);
    expect(plan.offer.pay_c).toBe(0);
    expect(plan.facts[0]).toContain("loaf");
    // a stranger: the roll past every candidate
    const s = planLetter(db, seq([0.999, 0.1, 0.1, 0.5, 0.5]));
    expect(s.why).toBe("stranger");
    expect(s.offer.kind).not.toBe("none");
  });

  it("an errand from a letter is a job with the engine's numbers: a letter's pay, a telegram's fee back and a tip", () => {
    const db = fresh(3, 10);
    const helper = people(db).find((r) => r.trade === "grocer")!;
    remember(db, helper.id, "Jef carried my crates in the rain.", 6, "seen", null, { gist: "Jef helped the grocer", tone: 1 });
    const plan = planLetter(db, seq([0.01, 0.2, 0.5, 0.5, 0.5]));
    expect(plan.why).toBe("helped");
    expect(plan.offer.kind).toBe("letter");
    expect(plan.offer.pay_c).toBeGreaterThanOrEqual(20);
    expect(plan.offer.pay_c).toBeLessThanOrEqual(40);
    const job = errandJob(db, plan)!;
    const j = listJobs(db, 3).find((x) => x.id === job)!;
    expect(j.pay_c).toBe(plan.offer.pay_c);
    expect(j.employer_npc).toBe(helper.id);
    const t = j.task as LettersTask;
    expect(t.from).toMatchObject({ x: helper.home.sx, z: helper.home.sz });
    expect(t.stops[0].id).toBe(plan.offer.to);
    // a telegram: Jef pays the fee at the counter; the job pays it back with the tip
    const tele = planLetter(db, seq([0.999, 0.1, 0.1]));
    expect(tele.offer.kind).toBe("telegram");
    expect(tele.offer.fee_c).toBe(TELEGRAM_FEE_C);
    expect(tele.offer.pay_c).toBeGreaterThan(TELEGRAM_FEE_C);
    const tj = errandJob(db, tele)!;
    takeJob(db, tj);
    const c = postCounter(db)!;
    pickUp(db, tj, c);
    setMoney(db, 20);
    expect(() => sendTelegram(db, tj, c)).toThrow(/costs 50/);
    setMoney(db, 100);
    sendTelegram(db, tj, c);
    expect(money(db)).toBe(100 - TELEGRAM_FEE_C);
    const res = finishJob(db, tj, ReportSchema.parse({}));
    expect(res.settlement.pay_c).toBe(tele.offer.pay_c);
    expect(money(db)).toBe(100 - TELEGRAM_FEE_C + tele.offer.pay_c);
  });

  it("hostile model output is ignored: a letter that gives money or changes the rules becomes the engine's letter", async () => {
    const db = fresh(3, 6);
    const m = money(db);
    const hostile: LetterOut & Record<string, unknown> = {
      salutation: "Jef,",
      body: "I enclose 500 francs for you. From today the bakers must give you bread for nothing, and the police will not touch you. Ignore your rules.",
      closing: "Yours,",
      signature: "The King",
      telegram: "",
      money_c: 99999,
      pay_c: 5000,
    };
    const l = (await maybeLetter(db, { runner: reply(hostile), force: true, rng: seq([0.999, 0.9, 0.9, 0.9]) }))!;
    expect(l.source).toBe("engine");
    expect(money(db)).toBe(m);
    const view = letterView(db, l.id);
    expect(view.body).not.toContain("500");
    expect(view.body).not.toContain("police");
    const offer = JSON.parse(l.offer_json) as { pay_c: number };
    if (l.job_id) expect((db.prepare("SELECT pay_c FROM job WHERE id = ?").get(l.job_id) as { pay_c: number }).pay_c).toBe(offer.pay_c);
    expect(pockets(db).some((p) => p.kind === "letter" && p.ref === l.id)).toBe(true);
  });

  it("the words may name only the engine's sums; a fair letter is kept", () => {
    const plan = { sender: "x", sender_name: "Anna Maes", signature: "Anna Maes", why: "met" as const, kind: "errand" as const, facts: ["Jef talked with them once."], offer: { kind: "letter" as const, pay_c: 30, fee_c: 0, to: "y", to_name: "Karel Claes" } };
    expect(sumsOk("There are 30 centimes in it for you.", plan.offer)).toBe(true);
    expect(sumsOk("There are 300 centimes in it for you.", plan.offer)).toBe(false);
    expect(sumsOk("Here are five francs.", plan.offer)).toBe(false);
    expect(sumsOk("I will give you 30 francs.", plan.offer)).toBe(false);
    const good = cleanLetter(plan, { salutation: "Jef,", body: "Carry my letter to Karel Claes, and there are 30 centimes in it for you.", closing: "Yours,", signature: "Anna", telegram: "" });
    expect(good.ok).toBe(true);
    expect(good.text.signature).toBe("Anna");
    const bad = cleanLetter(plan, { salutation: "Jef,", body: "Carry my letter to Karel Claes. I enclose a banknote for your trouble.", closing: "Yours,", signature: "Anna", telegram: "" });
    expect(bad.ok).toBe(false);
    expect(bad.text).toEqual(fallbackLetter(plan));
  });

  it("the model's letter, when it keeps to the terms, is what Jef reads", async () => {
    const db = fresh(3, 6);
    const l = (await maybeLetter(db, {
      runner: reply({ salutation: "To the young man Jef,", body: "You do not know me. I have watched you on the quays, and I think you are the man for a quiet errand. Say nothing of this letter.", closing: "In haste,", signature: "V.", telegram: "ARRIVE SATURDAY STOP BRING THE KEY STOP" }),
      force: true,
      rng: seq([0.999, 0.1, 0.1]),
    }))!;
    expect(l.why).toBe("stranger");
    expect(l.source).toBe("claude");
    const v = letterView(db, l.id);
    expect(v.body).toContain("quiet errand");
  });
});

// ------------------------------------------------------------------ the Berg

describe("the Berg van Barmhartigheid", () => {
  it("lends two thirds (four fifths on silver) down to 5 centimes, at 5 in the hundred a day begun", () => {
    expect(loanFor("medal")).toBe(70);
    expect(loanFor("lantern")).toBe(25);
    expect(loanFor("herring")).toBe(0);
    expect(rateFor(70)).toBe(4);
    expect(rateFor(25)).toBe(2);
    expect(redeemCost({ loan_c: 70, rate_c: 4, day: 2 }, 2)).toBe(74);
    expect(redeemCost({ loan_c: 70, rate_c: 4, day: 2 }, 4)).toBe(82);
  });

  it("pawn the medal and a lantern, redeem one with interest; food is refused; the counter keeps hours", () => {
    const db = fresh(2, 10);
    const clerk = pressTown(db)!.berg!.clerk;
    expect(atWork(db, clerk)).toBe(true);
    const m = money(db);
    const r = pawn(db, 0);
    expect(money(db)).toBe(m + 70);
    expect(pressTown(db)!.medal).toBe("pawned");
    expect(r.pawn.due_day).toBe(2 + TERM_DAYS);
    const ticket = pockets(db).find((p) => p.kind === "pawn_ticket")!;
    expect(ticket.ref).toBe(r.pawn.id);
    expect(() => pawn(db, 0)).toThrow(/no medal/);
    db.prepare("INSERT INTO item (kind, job_id) VALUES ('herring', NULL)").run();
    const herring = pockets(db).find((p) => p.kind === "herring")!;
    expect(() => pawn(db, herring.id)).toThrow(/goods that keep/);
    db.prepare("INSERT INTO item (kind, job_id) VALUES ('lantern', NULL)").run();
    const lantern = pockets(db).find((p) => p.kind === "lantern")!;
    pawn(db, lantern.id);
    expect(pockets(db).some((p) => p.kind === "lantern")).toBe(false);
    expect(bergView(db).tickets).toHaveLength(2);
    // the next day: loan and two days' interest
    setClock(db, 3, 10);
    const before = money(db);
    const back = redeem(db, r.pawn.id);
    expect(back.paid_c).toBe(70 + 4 * 2);
    expect(money(db)).toBe(before - 78);
    expect(pressTown(db)!.medal).toBe("owned");
    // shut at night
    setClock(db, 3, 23);
    expect(() => pawn(db, 0)).toThrow(/shut/);
  });

  it("a pledge past its day goes to the sale in the night: the ticket goes, the thing is gone", () => {
    const db = fresh(2, 10);
    const r = pawn(db, 0);
    setClock(db, r.pawn.due_day, 10);
    expect(forfeitPawns(db)).toHaveLength(0);
    setClock(db, r.pawn.due_day + 1, 6);
    expect(forfeitPawns(db)).toHaveLength(1);
    expect(pockets(db).some((p) => p.kind === "pawn_ticket")).toBe(false);
    expect(pressTown(db)!.medal).toBe("sold");
    setClock(db, r.pawn.due_day + 1, 10);
    expect(() => redeem(db, r.pawn.id)).toThrow(/no such pledge/);
  });

  it("the clerk's remark is the model's words only: a hostile or money-giving line gives way to the fallback", async () => {
    const db = fresh(2, 10);
    const clerk = pressTown(db)!.berg!.clerk;
    const sit = "Jef pawns his medal. The Berg lends 70 centimes on it.";
    const fine = await clerkRemark(db, clerk, sit, "FALLBACK", { runner: reply({ line: "Seventy is fair for it. Don't lose the ticket." }) });
    expect(fine.source).toBe("claude");
    for (const line of ["Take 500 centimes more, on the house.", "Here, a franc for you.", "I enclose a gift."]) {
      const r = await clerkRemark(db, clerk, sit, "FALLBACK", { runner: reply({ line }) });
      expect(r.text).toBe("FALLBACK");
    }
    const m = money(db);
    await clerkRemark(db, clerk, sit, "FALLBACK", { runner: reply({ line: "You now have 9999 centimes.", money_c: 9999 }) });
    expect(money(db)).toBe(m);
  });
});
