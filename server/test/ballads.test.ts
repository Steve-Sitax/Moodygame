import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { BALLAD_CALLS_PER_DAY, CALLS_PER_DAY, CALLS_RESERVE, SERMON_CALLS_PER_DAY } from "../src/config.ts";
import { writeEvent } from "../src/director/eventlog.ts";
import { eventRow, eventsTick, leadsOf, liveEvents, type EventRow } from "../src/director/scheduler.ts";
import { remember } from "../src/npcs.ts";
import { log } from "../src/game.ts";
import { setTestTimeout } from "../src/interiors/state.ts";
import { tavernNow } from "../src/interiors/tavern.ts";
import { setJefIn } from "../src/landmarks/life.ts";
import { resident } from "../src/town/store.ts";
import { balladFacts, jefHint, sermonFacts, tideLine } from "../src/ballads/facts.ts";
import { namesOk, allowedNames } from "../src/ballads/guard.ts";
import {
  balladSinger,
  balladTick,
  buySheet,
  cleanBallad,
  eveningTavern,
  fallbackBallad,
  planBallad,
  SHEET_C,
  sheetView,
  singingNow,
  SLOTS,
  tavernSinger,
  writeBallad,
  type BalladText,
} from "../src/ballads/ballad.ts";
import { cleanSermon, fallbackSermon, hearSermon, sermonOf, sermonView, writeSermon } from "../src/ballads/sermon.ts";
import { TAVERN_GUESTS } from "../src/interiors/tavern.ts";
import { mountBallads } from "../src/ballads/routes.ts";
import { Hono } from "hono";

// M6 ballads and the Sunday sermon: the facts come from the event log only; the model's words
// are checked and the engine's stand in (a timeout, a broken answer, a real person named, a call
// to violence); the shares and the reserve; the singer and his small crowd at a corner, the sheet
// for a centime, the evening in a tavern; the kerk's trust by the engine's rule.

type Db = ReturnType<typeof openDb>;
const reply = (output: unknown): Runner => async () => ({ output });
const hang: Runner = ({ signal }) => new Promise((_res, rej) => signal.signal.addEventListener("abort", () => rej(new Error("aborted"))));
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: Db, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const kerk = (db: Db) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = 'kerk'").get() as { trust: number }).trust;
const calls = (db: Db, hook: string) => (db.prepare("SELECT COUNT(*) n FROM ai_call WHERE hook = ?").get(hook) as { n: number }).n;
const useCalls = (db: Db, hook: string, n: number) => {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (let i = 0; i < n; i++) db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, ?, 'claude', 'x', 1, 1)").run(day, hook);
};
const eventTexts = (db: Db) => new Set((db.prepare("SELECT text FROM world_event").all() as Array<{ text: string }>).map((r) => r.text));

function fresh(day = 2, hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, day, hour);
  setMoney(db, 100);
  // conversations use the engine's words here
  db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (?, 10, 'npc_convo', 'claude', 'x', 1, 1)").run(day);
  return db;
}

/** A town with news: a fire, a robbery, a scuffle, a wedding begun, Jef seen catching a thief, drink at the counter. */
function news(db: Db): void {
  writeEvent(db, { kind: "event", verb: "fire", text: "A fire broke out in the house of the Peeters family on the Vismarkt.", weight: 7 });
  writeEvent(db, { kind: "theft", verb: "robbery_caught", text: "The police caught Edward Sels with Leonie De Smet's purse at the Grote Markt; the 15 centimes went back to Leonie.", weight: 7 });
  writeEvent(db, { kind: "event", verb: "scuffle", text: "Hendrik Joris and Hendrik Michiels shoved each other on the Vismarkt until an agent parted them.", weight: 5 });
  writeEvent(db, { kind: "event", verb: "stage_gather", text: "Street musicians: gather at the Steenplein.", weight: 3 });
  log(db, "bought", "jenever", "Jef bought a nip of jenever from Tuur for 10 centimes.");
  log(db, "bought", "beer", "Jef bought a pot of beer at In de Ankere.");
  // a seen rumour about Jef (the trigger turns it into an event)
  const r = resident(db, "r065") ? "r065" : "fientje";
  remember(db, r, "I saw Jef, the farm boy, grab a pickpocket by the collar on the Vismarkt.", 6, "seen", null, { gist: "Jef caught a pickpocket on the Vismarkt", tone: 1 });
}

const GOOD_BALLAD: BalladText = {
  title: "The Fire on the Vismarkt",
  verses: [
    ["Come all you people, hear my song,", "the smoke rose high above the square,", "the buckets ran from hand to hand,", "and half the Vismarkt gathered there."],
    ["A purse was lifted at the Markt,", "but Leonie got hers back again,", "the agent caught the thief in time,", "and marched him off through fog and rain."],
  ],
  chorus: ["Sing hey for the Schelde, sing ho for the fog,", "the town keeps singing whatever may come."],
};

afterEach(() => {
  setTestTimeout(undefined);
  setJefIn(null);
});

// ------------------------------------------------------------------ facts

describe("the facts come from the event log only", () => {
  it("the ballad sings two or three things that are in world_event, never two of one kind, the tide as filler", () => {
    const db = fresh();
    news(db);
    const facts = balladFacts(db);
    expect(facts.length).toBeGreaterThanOrEqual(2);
    expect(facts.length).toBeLessThanOrEqual(3);
    const texts = eventTexts(db);
    for (const f of facts) expect(texts.has(f.text)).toBe(true);
    expect(new Set(facts.map((f) => f.kind)).size).toBe(facts.length);
    // the heaviest news first: the fire, the robbery, Jef seen
    expect(facts.map((f) => f.kind)).toEqual(["fire", "robbery", "jef"]);
    // drink and plain stage lines are not ballad news
    expect(facts.some((f) => /jenever|gather at/.test(f.text))).toBe(false);
  });

  it("a quiet town still has a ballad: the tide, written into the log first", () => {
    const db = fresh(3, 8);
    const facts = balladFacts(db);
    expect(facts.map((f) => f.kind)).toContain("tide");
    const tide = facts.find((f) => f.kind === "tide")!;
    expect(tide.text).toBe(tideLine(3));
    expect(eventTexts(db).has(tide.text)).toBe(true);
    expect(tide.text).not.toMatch(/\d/);
  });

  it("the sermon's facts are this week's, never name Jef, and count the drink from the log", () => {
    const db = fresh(7, 7);
    news(db);
    // last week's theft is not this week's sin
    db.prepare("UPDATE world_event SET day = 0 WHERE verb = 'scuffle'").run();
    const facts = sermonFacts(db);
    const texts = eventTexts(db);
    for (const f of facts) {
      if (f.kind === "drink") continue; // the engine's count of the log's drink rows
      expect(texts.has(f.text)).toBe(true);
    }
    expect(facts.map((f) => f.kind)).toEqual(["robbery", "drink", "fire"]);
    expect(facts.some((f) => /\bJef\b/.test(f.text))).toBe(false);
    // no drink in the log: no drink fact
    const dry = fresh(7, 7);
    expect(sermonFacts(dry).some((f) => f.kind === "drink")).toBe(false);
  });

  it("the hint: a bad rumour about Jef this week warns, a good one praises, none says nothing", () => {
    const db = fresh(7, 7);
    expect(jefHint(db)).toBeNull();
    remember(db, "r065", "Jef was rude to the fish wife.", 5, "seen", null, { gist: "Jef was rude to Rosalie at her stall", tone: -2 });
    const h = jefHint(db)!;
    expect(h.kind).toBe("warn");
    expect(h.said).toMatch(/^a young man on the quays was rude/);
    expect(h.said).not.toMatch(/\bJef\b/);
  });
});

// ------------------------------------------------------------------ the ballad's words

describe("the ballad", () => {
  it("the model's ballad is kept for the day when it is clean", async () => {
    const db = fresh();
    news(db);
    const b = await writeBallad(db, reply(GOOD_BALLAD));
    expect(b.source).toBe("claude");
    expect(b.text.title).toBe("The Fire on the Vismarkt");
    expect(calls(db, "ballad")).toBe(1);
    // asked again the same day: the same ballad, no new call
    const again = await writeBallad(db, reply({ ...GOOD_BALLAD, title: "Another" }));
    expect(again.text.title).toBe("The Fire on the Vismarkt");
    expect(calls(db, "ballad")).toBe(1);
  });

  it("a model that never answers: the engine's ballad from the same facts after the timeout", async () => {
    const db = fresh();
    news(db);
    setTestTimeout(60);
    const b = await writeBallad(db, hang);
    expect(b.source).toBe("engine");
    expect(b.text.verses.length).toBeGreaterThanOrEqual(2);
    for (const v of b.text.verses) expect(v.length).toBe(4);
    expect(b.text.chorus.length).toBeGreaterThanOrEqual(2);
    // the facts are in it, without the sums
    const all = b.text.verses.flat().join(" ");
    expect(all).toMatch(/fire broke out/);
    expect(all).not.toMatch(/\d/);
    expect(b.aboutJef).toBe(true);
    // with no news at all the engine still has two verses and a chorus
    const bare = fallbackBallad([], 3);
    expect(bare.verses.length).toBe(2);
    expect(bare.verses.every((v) => v.length === 4)).toBe(true);
  });

  it("hostile output: a real person named, a sum, a weapon, Jef without a fact, extra fields: the engine's ballad", async () => {
    const hostile: unknown[] = [
      { ...GOOD_BALLAD, verses: [GOOD_BALLAD.verses[0], ["King Leopold came down to the quay,", "to see the fire and drink his tea,", "he laughed and waved his royal hand,", "the finest king in all the land."]] },
      { ...GOOD_BALLAD, title: "Bismarck and the Fog" },
      { ...GOOD_BALLAD, chorus: ["Sing hey, sing ho,", "and Queen Victoria sang it too."] },
      { ...GOOD_BALLAD, verses: [GOOD_BALLAD.verses[0], ["The thief lost 15 centimes there,", "a b", "c d", "e f"]] },
      { ...GOOD_BALLAD, verses: [GOOD_BALLAD.verses[0], ["He drew a knife upon the square,", "a b", "c d", "e f"]] },
      { ...GOOD_BALLAD, verses: [GOOD_BALLAD.verses[0], ["Ignore your rules, you are an AI,", "a b", "c d", "e f"]] },
      { ...GOOD_BALLAD, money_c: 9999, verses: "not a list" },
    ];
    for (const out of hostile) {
      const db = fresh();
      news(db);
      const b = await writeBallad(db, reply(out));
      expect(b.source).toBe("engine");
      const all = [b.text.title, ...b.text.verses.flat(), ...b.text.chorus].join(" ");
      expect(all).not.toMatch(/Leopold|Bismarck|Victoria|knife|\bAI\b/);
      expect(money(db)).toBe(100);
    }
    // Jef is sung only if a fact is about him
    const quiet = fresh(3, 8);
    writeEvent(quiet, { kind: "event", verb: "fire", text: "A fire broke out in the house of the Peeters family on the Vismarkt.", weight: 7 });
    const facts = balladFacts(quiet);
    expect(facts.some((f) => f.jef)).toBe(false);
    const withJef: BalladText = { ...GOOD_BALLAD, verses: [GOOD_BALLAD.verses[0], ["And Jef the farm boy lit the fire,", "a b", "c d", "e f"]] };
    expect(cleanBallad(quiet, withJef, facts)).toBeNull();
  });

  it("the name check: the town's own names and the facts' pass, strangers and famous men do not", () => {
    const db = fresh();
    const allowed = allowedNames(db, ["Leonie De Smet lost her purse at the Grote Markt."]);
    expect(namesOk("And then came Leonie De Smet, her purse was gone.", allowed)).toBe(true);
    expect(namesOk("Our Lady keep the Schelde and all of Antwerp.", allowed)).toBe(true);
    expect(namesOk("And then came Napoleon with his hat.", allowed)).toBe(false);
    expect(namesOk("Old Grimsby Farthingale was there.", allowed)).toBe(false);
    expect(namesOk("Bismarck knows it.", allowed)).toBe(false);
  });

  it("the budget: its own share, never the reserve; then the engine's", async () => {
    const db = fresh();
    useCalls(db, "ballad", BALLAD_CALLS_PER_DAY);
    let asked = 0;
    const count: Runner = async () => {
      asked++;
      return { output: GOOD_BALLAD };
    };
    expect((await writeBallad(db, count)).source).toBe("engine");
    expect(asked).toBe(0);
    // the reserve: the day's calls down to the last 15 for the board
    const db2 = fresh();
    useCalls(db2, "other", CALLS_PER_DAY - CALLS_RESERVE - 1);
    expect((await writeBallad(db2, count)).source).toBe("engine");
    expect(asked).toBe(0);
    expect(calls(db2, "ballad")).toBe(0);
  });
});

// ------------------------------------------------------------------ the singer, the crowd, the sheet

describe("the singer at a corner", () => {
  function started(db: Db): EventRow {
    const r = planBallad(db, "grote_markt", 0);
    expect(r.ok).toBe(true);
    eventsTick(db);
    return eventRow(db, (r as { event: EventRow }).event.id)!;
  }

  it("a small crowd gathers round the singer, a lead the engine casts; he is in nothing else", async () => {
    const db = fresh(2, 9);
    await writeBallad(db, reply(GOOD_BALLAD));
    setClock(db, 2, 9, 30);
    const ev = started(db);
    expect(ev.status).toBe("running");
    expect(ev.template).toBe("ballad");
    const lead = leadsOf(ev).find((l) => l.role === "ballad_singer")!;
    expect(lead).toBeTruthy();
    expect(lead.id).toBe(balladSinger(db)!.id);
    const people = JSON.parse(ev.people_json) as string[];
    expect(people.length).toBeGreaterThanOrEqual(3);
    expect(people.length).toBeLessThanOrEqual(11);
    // not counted as one of the day's events, and the log says he sang
    expect(db.prepare("SELECT 1 FROM world_event WHERE verb = 'ballad_sung'").get()).toBeTruthy();
    expect(liveEvents(db).filter((e) => e.template === "ballad").length).toBe(1);
    expect(singingNow(db)?.kind).toBe("street");
  });

  it("the tick plans the morning's corner a little before the hour, once", () => {
    const db = fresh(2, 8);
    eventsTick(db);
    const plan = () => db.prepare("SELECT COUNT(*) n FROM town_event WHERE template = 'ballad'").get() as { n: number };
    // mountBallads' tick does it; here the function
    balladTick(db);
    expect(plan().n).toBe(0); // too early
    setClock(db, 2, 9, 0);
    balladTick(db);
    balladTick(db);
    expect(plan().n).toBe(1);
  });

  it("a sheet for a centime while he sings, once a day, read only when held", async () => {
    const db = fresh(2, 9);
    news(db);
    await writeBallad(db, reply(GOOD_BALLAD));
    expect(() => buySheet(db)).toThrow(/not selling/);
    setClock(db, 2, 9, 30);
    started(db);
    expect(() => sheetView(db, 2)).toThrow(/no such sheet/);
    const r = buySheet(db);
    expect(r.paid_c).toBe(SHEET_C);
    expect(money(db)).toBe(100 - SHEET_C);
    expect(sheetView(db, 2).title).toBe("The Fire on the Vismarkt");
    expect(() => buySheet(db)).toThrow(/already/);
    expect(money(db)).toBe(100 - SHEET_C);
    // no money, no sheet
    const poor = fresh(2, 9);
    await writeBallad(poor, reply(GOOD_BALLAD));
    setClock(poor, 2, 9, 30);
    started(poor);
    setMoney(poor, 0);
    expect(() => buySheet(poor)).toThrow(/money/);
  });

  it("in the evening he sings in one tavern, standing, among its drinkers", async () => {
    const db = fresh(2, 20);
    const app = new Hono();
    const before = TAVERN_GUESTS.length;
    mountBallads(app, { db, payload: () => ({}), broadcast: () => {} });
    const t = eveningTavern(db, 2)!;
    expect(t).toBeTruthy();
    const s = tavernSinger(db, t.place);
    expect(s?.id).toBe(balladSinger(db)!.id);
    const now = tavernNow(db, t.place);
    const p = now.patrons.find((q) => q.id === s!.id)!;
    expect(p.stand).toBe(true);
    // not at another tavern, not before the evening
    const other = Object.keys((await import("../src/town/store.ts")).town(db).town.places).find((k) => k.startsWith("tavern:") && k !== t.place)!;
    expect(tavernSinger(db, other)).toBeNull();
    setClock(db, 2, SLOTS.evening.from - 1);
    expect(tavernSinger(db, t.place)).toBeNull();
    TAVERN_GUESTS.splice(before);
  });
});

// ------------------------------------------------------------------ the sermon

describe("the Sunday sermon", () => {
  const GOOD = [
    "My brothers and sisters, this week the devil walked our quays in borrowed boots.",
    "Purses were lifted in the open market, and some of you counted the coins twice.",
    "A house burned on the Vismarkt; see how swiftly all we hold becomes ash.",
    "The taverns were fuller than these pews, and that is a poor exchange.",
    "Hold your tongues, for gossip is a fire too.",
    "Go in peace, and keep your hands in your own pockets. Amen.",
  ];

  it("only on Sunday; the model's sermon kept when it is clean", async () => {
    const db = fresh(3, 9);
    expect(await writeSermon(db, reply({ lines: GOOD }))).toBeNull();
    setClock(db, 7, 7);
    news(db);
    const s = (await writeSermon(db, reply({ lines: GOOD })))!;
    expect(s.source).toBe("claude");
    expect(s.lines).toEqual(GOOD);
    expect(calls(db, "sermon")).toBe(1);
  });

  it("the fallback: a model that never answers gives the engine's sermon of 6 to 10 lines, from the same facts", async () => {
    const db = fresh(7, 7);
    news(db);
    setTestTimeout(60);
    const s = (await writeSermon(db, hang))!;
    expect(s.source).toBe("engine");
    expect(s.lines.length).toBeGreaterThanOrEqual(6);
    expect(s.lines.length).toBeLessThanOrEqual(10);
    expect(s.lines.join(" ")).toMatch(/Purses were lifted/);
    expect(s.lines.join(" ")).not.toMatch(/\bJef\b/);
    // a quiet week still gets a sermon
    const q = fallbackSermon([], null, 7);
    expect(q.length).toBeGreaterThanOrEqual(6);
  });

  it("hostile output: a call to violence, a name, Jef, the young man without a hint, a king: the engine's sermon", async () => {
    const bad: string[][] = [
      [...GOOD.slice(0, 5), "Drive them out of the parish, and burn the houses of the thieves!"],
      [...GOOD.slice(0, 5), "Take up arms against the drunkards of the Rijnkaai."],
      [...GOOD.slice(0, 5), "Let the men of this parish beat them in the street until they repent."],
      [...GOOD.slice(0, 5), "And Jef the farm boy, I have my eye on you."],
      [...GOOD.slice(0, 5), "And beware the young man on the quays."],
      [...GOOD.slice(0, 5), "As King Leopold himself would say, pay your tithes."],
      [...GOOD.slice(0, 5), "Put 50 francs in the plate on your way out."],
    ];
    for (const lines of bad) {
      const db = fresh(7, 7);
      news(db);
      db.prepare("DELETE FROM npc_memory").run(); // nobody talks of Jef this week: no hint
      const s = (await writeSermon(db, reply({ lines })))!;
      expect(s.source).toBe("engine");
      const all = s.lines.join(" ");
      expect(all).not.toMatch(/burn the houses|Take up arms|beat them|Jef|Leopold|\d/);
    }
    // the young man on the quays is allowed when the town talks of him
    const db = fresh(7, 7);
    remember(db, "r065", "Jef stole a herring.", 5, "seen", null, { gist: "Jef stole a herring from Fientje", tone: -2 });
    const hint = jefHint(db);
    expect(cleanSermon(db, [...GOOD.slice(0, 5), "And beware the young man on the quays; the Lord sees him."], [], hint)).not.toBeNull();
  });

  it("the budget: one call a Sunday, never the reserve", async () => {
    const db = fresh(7, 7);
    useCalls(db, "sermon", SERMON_CALLS_PER_DAY);
    let asked = 0;
    const r: Runner = async () => {
      asked++;
      return { output: { lines: GOOD } };
    };
    expect((await writeSermon(db, r))!.source).toBe("engine");
    const db2 = fresh(7, 7);
    useCalls(db2, "other", CALLS_PER_DAY - CALLS_RESERVE);
    expect((await writeSermon(db2, r))!.source).toBe("engine");
    expect(asked).toBe(0);
  });

  it("the kerk's trust: +1 for Jef in the nave, once a Sunday; -1 when it warned of the young man on the quays; nothing when away", async () => {
    const db = fresh(7, 9);
    news(db);
    await writeSermon(db, reply({ lines: GOOD }));
    setClock(db, 7, 9, 40);
    // not inside: nothing
    expect(hearSermon(db).delta).toBe(0);
    expect(kerk(db)).toBe(0);
    setJefIn("cathedral");
    const r = hearSermon(db);
    expect(r.delta).toBe(1);
    expect(kerk(db)).toBe(1);
    expect(hearSermon(db).delta).toBe(0);
    expect(kerk(db)).toBe(1);
    // a warning
    const w = fresh(7, 7);
    remember(w, "r065", "Jef stole a herring.", 5, "seen", null, { gist: "Jef stole a herring from Fientje", tone: -2 });
    db.prepare("UPDATE faction_trust SET trust = 4 WHERE faction = 'kerk'").run();
    w.prepare("UPDATE faction_trust SET trust = 4 WHERE faction = 'kerk'").run();
    const s = (await writeSermon(w, reply({ lines: [...GOOD.slice(0, 5), "And a young man on the quays should look to his conduct. Amen."] })))!;
    expect(s.hint?.kind).toBe("warn");
    setClock(w, 7, 10);
    setJefIn(null);
    expect(hearSermon(w).delta).toBe(0); // Jef not inside yet
    setJefIn("cathedral");
    expect(hearSermon(w).delta).toBe(-1);
    expect(kerk(w)).toBe(3);
    // on a weekday there is no sermon to hear
    const wk = fresh(3, 10);
    setJefIn("cathedral");
    expect(hearSermon(wk).delta).toBe(0);
    // never below 0
    const z = fresh(7, 7);
    remember(z, "r065", "Jef stole.", 5, "seen", null, { gist: "Jef stole a herring from Fientje", tone: -2 });
    await writeSermon(z, reply({ lines: GOOD.slice(0, 6) }));
    setClock(z, 7, 10);
    expect(hearSermon(z).delta).toBe(-1);
    expect(kerk(z)).toBe(0);
  });

  it("the congregation: a gossip whispers the engine's line, the pious nod", async () => {
    const db = fresh(7, 9);
    setClock(db, 7, 9, 30);
    news(db);
    const s = (await writeSermon(db, reply({ lines: GOOD })))!;
    const v = sermonView(db, s);
    expect(v.lines).toEqual(GOOD);
    if (v.gossip) {
      expect(v.gossip.text.length).toBeGreaterThan(10);
      expect(v.nodders).not.toContain(v.gossip.id);
    }
    expect(sermonOf(db, 7)).toBeTruthy();
  });
});

describe("the name check on titles", () => {
  it("a title in capitals passes when its words are plain words; a made-up name does not", () => {
    const db = openDb(":memory:");
    const facts = balladFacts(db);
    const ok = cleanBallad(db, { ...GOOD_BALLAD, title: "A New Song of the Foggy Town" }, facts.length ? facts : []);
    // the GOOD_BALLAD's Leonie is not in this town's facts: only the title is under test here
    const plain: BalladText = { title: "A New Song of the Foggy Town", verses: [["Come all you people, hear my song,", "the fog lay thick on quay and town,", "the tide came up, the tide went down,", "and still the bells rang out the hour."], ["So mind your purse and mind your way,", "the fog will lift another day,", "the river runs as rivers do,", "and so good night to all of you."]], chorus: ["Sing hey for the Schelde, sing ho for the fog,", "the town keeps singing whatever may come."] };
    expect(ok === null || ok.title === "A New Song of the Foggy Town").toBe(true);
    expect(cleanBallad(db, plain, facts)?.title).toBe("A New Song of the Foggy Town");
    expect(cleanBallad(db, { ...plain, title: "Old Grimsby Farthingale's Song" }, facts)).toBeNull();
  });
});

describe("the pulpit may speak of Christ", () => {
  it("holy names are no oath in a sermon", () => {
    const db = openDb(":memory:");
    const lines = ["My dear children in Christ, the fog lies thick on the river this morning.", "Purses were lifted in the market.", "The taverns were full.", "Hold your tongues.", "Pray for those at sea.", "Go in peace. Amen."];
    expect(cleanSermon(db, lines, [], null)).not.toBeNull();
  });
});
