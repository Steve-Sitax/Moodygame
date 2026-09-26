import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, RESIDENT_CALLS_PER_MEETING } from "../src/config.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { ALL_EMPLOYERS, listJobs, makeBoard, SPOTS, taskFor, type Board } from "../src/hooks/jobBoard.ts";
import { remember, topMemories } from "../src/npcs.ts";
import { generateTown, type Resident } from "../src/town/population.ts";
import { STALLS, TOWN_EMPLOYERS } from "../src/town/places.ts";
import { isGarrison } from "../src/town/garrison.ts";
import { activityAt } from "../src/town/schedule.ts";
import { ensureTown, personaLine, repairTown, resident, town } from "../src/town/store.ts";
import { circleOf, rumoursOf, spreadRumours, toYou } from "../src/town/rumours.ts";
import { canCall, residentChoice, residentFree, residentOpen, residentPrompt, type ResidentLine } from "../src/town/talk.ts";
import { catchThief, pickPocket, resetThieves } from "../src/town/thieves.ts";
import { walkMap } from "../src/town/walkmap.ts";
import { buy, waresOf } from "../src/trade.ts";
import { HOSTILE_LINES } from "./hostile-lines.ts";

const T = generateTown(1873);
const reply = (output: unknown): Runner => async () => ({ output });
const line = (over: Partial<ResidentLine> = {}): ResidentLine => ({
  npc_line: "Work? The Katoennatie was shouting for men.",
  mood: "neutral",
  choices: ["Where exactly?", "Thank you kindly.", "I'll think on it."],
  trust_delta: 0,
  memory_note: "The new man asked me about work.",
  memory_weight: 3,
  rumour: "Jef asked after work on the quays",
  rumour_tone: 1,
  persona_line: "A tired docker's wife who speaks her mind and sighs a lot.",
  end_conversation: false,
  ...over,
});
const setClock = (db: ReturnType<typeof openDb>, day: number, hour: number, minute = 0) =>
  db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const byTrade = (t: string) => T.residents.filter((r) => r.trade === t);
const money = (db: ReturnType<typeof openDb>) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;

beforeEach(() => {
  resetTalks();
  resetThieves();
});

// ------------------------------------------------------------------ the population

describe("population generator", () => {
  it("is made by the engine from a seed: same seed, same town", () => {
    const again = generateTown(1873);
    expect(again.residents.map((r) => r.name)).toEqual(T.residents.map((r) => r.name));
    expect(generateTown(42).residents.map((r) => r.name)).not.toEqual(T.residents.map((r) => r.name));
  });

  it("has 150-210 people in families, with unique names", () => {
    // the garrison and the customs come on top (garrison.ts; test/garrison.test.ts). (210: the angled streets and
    // the alleys of 2026-09-25 give more houses, so a few more households)
    const folk = T.residents.filter((r) => !isGarrison(r.trade));
    expect(folk.length).toBeGreaterThanOrEqual(150);
    expect(folk.length).toBeLessThanOrEqual(210);
    const names = T.residents.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    const hh = new Map<number, Resident[]>();
    for (const r of T.residents) hh.set(r.household, [...(hh.get(r.household) ?? []), r]);
    expect(hh.size).toBeGreaterThan(40);
    // every child lives with a grown-up, except the street children
    for (const r of T.residents.filter((r) => r.age < 13 && r.trade !== "street_child")) {
      expect(hh.get(r.household)!.some((o) => o.age >= 18)).toBe(true);
    }
    // couples share a surname and a door
    const wives = T.residents.filter((r) => r.family_role === "wife");
    expect(wives.length).toBeGreaterThan(15);
    for (const w of wives) {
      const head = hh.get(w.household)!.find((o) => o.family_role === "head")!;
      expect(w.surname).toBe(head.surname);
      expect(w.home).toEqual(head.home);
    }
  });

  it("gives every trade the town needs, and night people", () => {
    for (const t of ["docker", "natie", "fishwife", "market_woman", "baker", "grocer", "publican", "police", "priest", "thief", "beggar", "clerk", "sailor", "carter", "maid", "child"]) {
      expect(byTrade(t).length, t).toBeGreaterThan(0);
    }
    for (const e of TOWN_EMPLOYERS) expect(T.residents.find((r) => r.id === e.id)?.trade).toBe(e.trade);
    // every stall has a seller, no stall has two
    const keepers = T.stalls.map((s) => s.keeper).filter(Boolean);
    expect(keepers.length).toBe(STALLS.length);
    expect(new Set(keepers).size).toBe(keepers.length);
  });

  it("puts every home, workplace and round on ground you can walk to from the start", () => {
    const wm = walkMap();
    const bad: string[] = [];
    const ok = (x: number, z: number) => !!wm.nearestOpen(x, z, 1.5);
    for (const r of T.residents) {
      if (r.home.house >= 0 && !ok(r.home.sx, r.home.sz)) bad.push(`${r.id} home`);
      const w = r.work;
      if (w.at && !ok(w.at[0], w.at[1])) bad.push(`${r.id} at`);
      if (w.a && !ok(...w.a)) bad.push(`${r.id} a`);
      if (w.b && !ok(...w.b)) bad.push(`${r.id} b`);
      if (w.door && !ok(...w.door)) bad.push(`${r.id} door`);
      for (const p of w.route ?? []) if (!ok(...p)) bad.push(`${r.id} route`);
    }
    for (const [id, p] of Object.entries(T.places)) if (!ok(p.x, p.z)) bad.push(`place ${id}`);
    for (const [id, s] of Object.entries(SPOTS)) if (id !== "pier_head" && !id.startsWith("_") && !ok(s.x, s.z)) bad.push(`spot ${id}`);
    expect(bad).toEqual([]);
  });

  it("stats are 0-10 and follow the trade", () => {
    for (const r of T.residents) for (const v of Object.values(r.stats)) expect(v >= 0 && v <= 10).toBe(true);
    const avg = (xs: Resident[], k: keyof Resident["stats"]) => xs.reduce((a, r) => a + r.stats[k], 0) / xs.length;
    expect(avg(byTrade("thief"), "honesty")).toBeLessThan(3);
    expect(byTrade("priest")[0].stats.piety).toBeGreaterThanOrEqual(7);
    expect(avg(byTrade("fishwife"), "gossip")).toBeGreaterThan(avg(byTrade("docker"), "gossip"));
  });

  it("a town from an older build is mended in place: schedules in order, rounds on open ground, memories kept", () => {
    const db = openDb(":memory:");
    const r = byTrade("docker")[0];
    const bad = { ...r, sched: { day: [[6, 12, "work"], [11, 13, "tavern", "tavern:ankere"]], sunday: [] }, work: { ...r.work, kind: "roam", route: [[-100, -60], [0, 20]] } };
    db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(bad), r.id);
    remember(db, r.id, "Jef asked me the way.", 3);
    expect(repairTown(db)).toBeGreaterThan(0);
    const fixed = resident(db, r.id)!;
    expect(fixed.sched.day[1][0]).toBeGreaterThanOrEqual(fixed.sched.day[0][1]);
    for (const [x, z] of fixed.work.route!) expect(walkMap().reachable(x, z)).toBe(true);
    expect(topMemories(db, r.id).length).toBe(1);
    expect(repairTown(db)).toBe(0);
  });

  it("a save from before the town gets one, without touching Jef", () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE player SET money_c = 77 WHERE id = 1").run();
    db.prepare("DELETE FROM npc_relationship WHERE npc_id IN (SELECT id FROM resident)").run();
    db.prepare("DELETE FROM resident").run();
    expect(ensureTown(db).made).toBe(true);
    expect(money(db)).toBe(77);
    expect(ensureTown(db).made).toBe(false);
    expect(resident(db, "katoen")?.trade).toBe("foreman");
  });
});

// ------------------------------------------------------------------ schedules

describe("schedules", () => {
  it("a docker works by day, eats at noon, sleeps at night", () => {
    const d = byTrade("docker")[0];
    expect(activityAt(d.sched, 2, 9).act).toBe("work");
    expect(["tavern", "home"]).toContain(activityAt(d.sched, 2, 12.5).act);
    expect(activityAt(d.sched, 2, 23.5).act).toBe("home");
    expect(activityAt(d.sched, 2, 3).act).toBe("home");
  });

  it("thieves come out at night; half the police walk the night", () => {
    for (const t of byTrade("thief")) {
      expect(activityAt(t.sched, 3, 22).act).toBe("work");
      expect(activityAt(t.sched, 3, 8).act).toBe("home");
    }
    const police = byTrade("police");
    expect(police.some((p) => activityAt(p.sched, 3, 23).act === "work")).toBe(true);
    expect(police.some((p) => activityAt(p.sched, 3, 9).act === "work")).toBe(true);
  });

  it("children play by day in a square near home; shopkeepers close at night", () => {
    const kid = byTrade("child")[0];
    expect(activityAt(kid.sched, 2, 10).act).toBe("play");
    expect(activityAt(kid.sched, 2, 22).act).toBe("home");
    const baker = byTrade("baker")[0];
    expect(activityAt(baker.sched, 2, 8).act).toBe("work");
    expect(activityAt(baker.sched, 2, 22).act).toBe("home");
  });

  it("Sunday: the pious go to mass, the stalls stay shut", () => {
    const pious = T.residents.filter((r) => r.sched.sunday.some((s) => s[2] === "church"));
    expect(pious.length).toBeGreaterThan(20);
    const fw = byTrade("fishwife")[0];
    expect(activityAt(fw.sched, 7, 10).act).not.toBe("work");
  });

  it("segments never overlap", () => {
    for (const r of T.residents) {
      for (const segs of [r.sched.day, r.sched.sunday]) {
        for (let i = 1; i < segs.length; i++) expect(segs[i][0] >= segs[i - 1][1], `${r.id} ${JSON.stringify(segs)}`).toBe(true);
      }
    }
  });
});

// ------------------------------------------------------------------ rumours

describe("rumours", () => {
  it("spread from Sooi to the dockers, never twice, weaker with each telling", () => {
    const db = openDb(":memory:");
    remember(db, "sooi", "Jef lifted my crates without asking.", 7, "seen", null, { gist: "Jef lifted Sooi's crates without asking", tone: -2 });
    let heard = 0;
    for (let i = 0; i < 8; i++) heard += spreadRumours(db, () => 0.3);
    expect(heard).toBeGreaterThan(3);
    const rows = db.prepare("SELECT npc_id, weight, tone, source FROM npc_memory WHERE gist LIKE 'Jef lifted Sooi%'").all() as Array<{ npc_id: string; weight: number; tone: number; source: string }>;
    const holders = rows.map((r) => r.npc_id);
    expect(new Set(holders).size).toBe(holders.length); // nobody twice
    expect(rows.every((r) => r.tone === -2)).toBe(true);
    expect(rows.filter((r) => r.source === "heard").every((r) => r.weight < 7)).toBe(true);
    // the first to hear are Sooi's own people (and Fientje, who hears everything)
    const circle = new Set(circleOf(db, "sooi"));
    const residentsWhoHeard = holders.filter((h) => resident(db, h));
    expect(residentsWhoHeard.length).toBeGreaterThan(0);
    expect(holders).toContain("fientje");
    expect(residentsWhoHeard.some((h) => circle.has(h))).toBe(true);
    // it dies out: another round tells nobody new
    expect(spreadRumours(db, () => 0.3)).toBe(0);
  });

  it("run within a household and among workmates", () => {
    const db = openDb(":memory:");
    const d = byTrade("docker").find((r) => T.residents.some((o) => o.household === r.household && o.id !== r.id))!;
    remember(db, d.id, "Jef carried for me when my back gave out.", 8, "seen", null, { gist: "Jef carried a sack for a docker whose back gave out", tone: 2 });
    for (let i = 0; i < 4; i++) spreadRumours(db, () => 0);
    const knowers = (db.prepare("SELECT npc_id FROM npc_memory WHERE gist LIKE 'Jef carried%'").all() as Array<{ npc_id: string }>).map((r) => r.npc_id);
    // his household and his workmates in the town as the save has it (M7 back of town: the back's own dockers
    // work the same quays and are his workmates too, whatever the number of households)
    const mine = new Set(town(db).town.residents.filter((o) => o.household === d.household || o.work.place === d.work.place).map((o) => o.id));
    expect(knowers.filter((k) => k !== d.id).some((k) => mine.has(k))).toBe(true);
  });

  it("a tight-lipped teller keeps it to himself", () => {
    const db = openDb(":memory:");
    const quiet = T.residents.find((r) => r.stats.gossip <= 1 && r.age > 16);
    if (!quiet) return;
    remember(db, quiet.id, "Jef was rude.", 5, "seen", null, { gist: "Jef was rude to a man in the street", tone: -1 });
    spreadRumours(db, () => 0);
    expect((db.prepare("SELECT COUNT(*) n FROM npc_memory WHERE gist LIKE 'Jef was rude%' AND npc_id <> 'fientje'").get() as { n: number }).n).toBe(1);
  });

  it("turn into the people's own words", () => {
    expect(toYou("Jef lifted Sooi's goods off the quay without asking")).toBe("you lifted Sooi's goods off the quay without asking");
    expect(toYou("Jef was caught cheating Sooi")).toBe("you were caught cheating Sooi");
    expect(toYou("Jef had his pocket picked in the dark")).toBe("you had your pocket picked in the dark");
  });
});

// ------------------------------------------------------------------ talk

describe("talk with anyone", () => {
  const someone = () => byTrade("fishwife")[0];

  it("opens with an engine line at once: no model call, three choices", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 9);
    const l = residentOpen(db, someone().id);
    expect(l.npc_line.length).toBeGreaterThan(3);
    expect(l.choices).toHaveLength(3);
    expect((db.prepare("SELECT COUNT(*) n FROM ai_call").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT times_met FROM npc_relationship WHERE npc_id = ?").get(someone().id) as { times_met: number }).times_met).toBe(1);
  });

  it("the first reply goes to Claude: persona cached, memory and rumour kept, prompt holds only this person", async () => {
    const db = openDb(":memory:");
    setClock(db, 1, 9);
    const r = someone();
    const open = residentOpen(db, r.id);
    let prompt = "";
    const runner: Runner = async (req) => {
      prompt = req.prompt;
      return { output: line() };
    };
    const l = await residentChoice(db, r.id, open.choices[0], runner);
    expect(l.npc_line).toMatch(/Katoennatie/);
    expect(prompt).toContain(r.name);
    expect(prompt).toContain(`gossip ${r.stats.gossip}`);
    expect(prompt).toContain("PERSONA: none yet");
    expect(prompt).not.toContain(byTrade("thief")[0].name);
    expect(personaLine(db, r.id)).toMatch(/docker's wife/);
    const mem = topMemories(db, r.id).find((m) => /asked me about work/.test(m.text));
    expect(mem).toBeTruthy();
    expect(rumoursOf(db, r.id)[0]?.gist).toMatch(/^Jef asked after work/);
    // the last choice is always a way to take leave
    expect(l.choices[2]).toBe("Good day to you.");
  });

  it("answers by rumour: what they heard of Jef comes back in their words", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 10);
    const r = T.residents.find((o) => o.stats.gossip >= 6 && o.age > 16)!;
    remember(db, r.id, "Heard it from Sooi.", 6, "heard", "sooi", { gist: "Jef lifted Sooi's goods off the quay without asking", tone: -2 });
    const l = residentOpen(db, r.id);
    expect(l.npc_line).toMatch(/You're the one who lifted Sooi's goods/);
  });

  it("falls back to engine lines when the model is late or wrong, and on the topic asked", async () => {
    const db = openDb(":memory:");
    setClock(db, 1, 10);
    await makeBoard(db, async () => ({ output: { junk: true } }));
    const r = byTrade("docker")[0];
    residentOpen(db, r.id);
    const l = await residentChoice(db, r.id, "Is there any work going?", reply({ npc_line: 42 }));
    expect(l.npc_line).toMatch(/Try|Go and see|Not today|Nothing/);
    const board = listJobs(db, 1).filter((j) => j.status === "offered");
    if (/Try|Go and see/.test(l.npc_line)) expect(board.some((j) => l.npc_line.includes(j.employer_name))).toBe(true);
  });

  it("keeps to the budget: a cap per meeting, and never into the board's reserve", async () => {
    const db = openDb(":memory:");
    setClock(db, 1, 10);
    const r = someone();
    let calls = 0;
    const runner: Runner = async () => {
      calls++;
      return { output: line({ memory_note: "", rumour: "" }) };
    };
    let l = residentOpen(db, r.id);
    for (let i = 0; i < 6; i++) l = await residentChoice(db, r.id, l.choices[0], runner);
    expect(calls).toBe(RESIDENT_CALLS_PER_MEETING);
    // fill the day's calls up to the reserve: no more resident calls
    const ins = db.prepare("INSERT INTO ai_call (day, hour, hook, provider, model, ms, ok) VALUES (1, 10, 'job_board', 'claude', 'x', 1, 1)");
    for (let i = 0; i < CALLS_PER_DAY - CALLS_RESERVE; i++) ins.run();
    expect(canCall(db, { calls: 0 })).toBe(false);
    resetTalks();
    calls = 0;
    const other = byTrade("baker")[0];
    const o = residentOpen(db, other.id);
    const l2 = await residentChoice(db, other.id, o.choices[1], runner);
    expect(calls).toBe(0);
    expect(l2.npc_line.length).toBeGreaterThan(3);
  });

  it("trust moves at most 2 per meeting", async () => {
    const db = openDb(":memory:");
    const r = someone();
    const o = residentOpen(db, r.id);
    await residentChoice(db, r.id, o.choices[0], reply(line({ trust_delta: 5 })));
    await residentChoice(db, r.id, "Where exactly?", reply(line({ trust_delta: 2 })));
    expect((db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ?").get(r.id) as { trust: number }).trust).toBe(2);
  });

  it("hostile lines: gated or fenced, schema-valid, nothing but a clamped trust changes", async () => {
    const db = openDb(":memory:");
    setClock(db, 1, 10);
    const r = someone();
    residentOpen(db, r.id);
    const before = money(db);
    let t = 0;
    let fenced = 0;
    let gated = 0;
    for (const hostile of HOSTILE_LINES) {
      resetTalks();
      residentOpen(db, r.id);
      let sawPrompt = "";
      const runner: Runner = async (req) => {
        sawPrompt = req.prompt;
        return { output: line({ npc_line: "What are you on about? Talk sense.", trust_delta: -1, rumour: "", memory_note: "" }) };
      };
      // the 5 s gate between typed lines is real: step past it
      const { markFreeLine } = await import("../src/hooks/dialogue.ts");
      markFreeLine(Date.now() - 10_000 - t++);
      const out = await residentFree(db, r.id, hostile, runner);
      expect("npc_line" in out || "gated" in out).toBe(true);
      if ("gated" in out && out.gated === "blocked") gated++;
      if (sawPrompt) {
        fenced++;
        // the typed words appear once, inside the fence, after the label
        const i = sawPrompt.indexOf("JEF SAYS");
        expect(i).toBeGreaterThan(0);
        expect(sawPrompt.indexOf(hostile.slice(0, 20))).toBeGreaterThan(i);
      }
    }
    expect(gated + fenced).toBe(HOSTILE_LINES.length);
    expect(gated).toBeGreaterThan(5);
    expect(money(db)).toBe(before);
    expect((db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ?").get(r.id) as { trust: number }).trust).toBeGreaterThanOrEqual(-5);
    expect((db.prepare("SELECT COUNT(*) n FROM item").get() as { n: number }).n).toBe(0);
  });

  it("the prompt never carries a machine name or path", () => {
    const db = openDb(":memory:");
    const p = residentPrompt(db, someone(), "Jef walks up.", []);
    expect(p).not.toMatch(/[A-Z]:\\|\/Users\/|steve|MoodyGame/i);
  });
});

// ------------------------------------------------------------------ shops

describe("shops and stalls", () => {
  it("a fishwife sells herring at her stall in working hours; the shop is shut at night", () => {
    const db = openDb(":memory:");
    const fw = byTrade("fishwife").find((r) => r.work.stall !== undefined)!;
    expect(waresOf(db, fw.id).map((w) => w.kind)).toContain("herring");
    setClock(db, 1, 9);
    const before = money(db);
    buy(db, fw.id, "herring");
    expect(money(db)).toBe(before - 5);
    setClock(db, 1, 22);
    expect(() => buy(db, fw.id, "herring")).toThrow(/shut/);
  });

  it("the baker sells bread; the publican pours beer on the spot", () => {
    const db = openDb(":memory:");
    setClock(db, 1, 11);
    const baker = byTrade("baker")[0];
    buy(db, baker.id, "bread");
    expect((db.prepare("SELECT kind FROM item").get() as { kind: string }).kind).toBe("bread");
    const pub = byTrade("publican")[0];
    const warmth = (db.prepare("SELECT warmth FROM player").get() as { warmth: number }).warmth;
    buy(db, pub.id, "beer");
    expect((db.prepare("SELECT warmth FROM player").get() as { warmth: number }).warmth).toBe(Math.min(10, warmth + 1));
  });
});

// ------------------------------------------------------------------ thieves

describe("pickpockets", () => {
  it("only thieves, only at night, never more than 60 c, once each", () => {
    const db = openDb(":memory:");
    const thief = byTrade("thief")[0];
    db.prepare("UPDATE player SET money_c = 400 WHERE id = 1").run();
    setClock(db, 1, 14);
    expect(() => pickPocket(db, thief.id, () => 0)).toThrow(/light/);
    setClock(db, 1, 22);
    expect(() => pickPocket(db, byTrade("baker")[0].id, () => 0)).toThrow(/thief/);
    const r = pickPocket(db, thief.id, () => 0);
    expect(r.took_c).toBeGreaterThan(0);
    expect(r.took_c).toBeLessThanOrEqual(60);
    expect(money(db)).toBe(400 - r.took_c);
    expect(() => pickPocket(db, thief.id, () => 0)).toThrow(/already/);
  });

  it("catch the thief in time and the money comes back; too late and it is gone", () => {
    const db = openDb(":memory:");
    const [a, b] = byTrade("thief");
    db.prepare("UPDATE player SET money_c = 100 WHERE id = 1").run();
    setClock(db, 1, 22);
    const t0 = Date.now();
    const r = pickPocket(db, a.id, () => 0, t0);
    const back = catchThief(db, a.id, t0 + 5_000);
    expect(back.back_c).toBe(r.took_c);
    expect(money(db)).toBe(100);
    expect(rumoursOf(db, a.id)[0].gist).toMatch(/caught a pickpocket/);
    if (b) {
      pickPocket(db, b.id, () => 0, t0);
      expect(() => catchThief(db, b.id, t0 + 60_000)).toThrow(/nothing/);
    }
  });

  it("an empty pocket loses nothing", () => {
    const db = openDb(":memory:");
    db.prepare("UPDATE player SET money_c = 2 WHERE id = 1").run();
    setClock(db, 1, 23);
    expect(pickPocket(db, byTrade("thief")[0].id, () => 0).took_c).toBe(0);
    expect(money(db)).toBe(2);
  });
});

// ------------------------------------------------------------------ jobs at all the quays

describe("work at every quay", () => {
  const job = (over: Partial<Board["jobs"][number]>): Board["jobs"][number] => ({
    title: "Bales",
    employer: "katoen",
    task_type: "carry",
    goods: "sacks",
    from: "entrepot_quay",
    to: "katoen_door",
    twist: "none",
    urgent: false,
    recipient: "",
    pay_c: 100,
    risk: "low",
    pitch: "Bales to our door.",
    ...over,
  });

  it("town employers keep their work on their own ground", () => {
    const t = taskFor(job({ from: "pier_head", to: "ship_gangway" }));
    expect(ALL_EMPLOYERS.katoen.area).toContain((t as { from: string }).from);
    expect(ALL_EMPLOYERS.katoen.area).toContain((t as { to: string }).to);
    const d = taskFor(job({ employer: "koster", task_type: "deliver", goods: "parcel", to: "werf_quay", recipient: "a canon" }));
    expect(d).toMatchObject({ kind: "deliver", from: "cathedral_door" });
    expect(ALL_EMPLOYERS.koster.area).toContain((d as { to: string }).to);
    const w = taskFor(job({ employer: "waterschout", task_type: "watch", to: "canal_quay" }));
    expect(ALL_EMPLOYERS.waterschout.area).toContain((w as { post: string }).post);
  });

  it("the board carries their work under the townsperson's own name", async () => {
    const db = openDb(":memory:");
    const board: Board = {
      jobs: [
        job({}),
        job({ employer: "vishandel", task_type: "watch", goods: "barrels", to: "vismarkt_stalls", twist: "thief", title: "Mind the stalls" }),
        job({ employer: "sooi", from: "pier_head", to: "hessenatie_door", goods: "crates", title: "Crates" }),
      ],
    };
    await makeBoard(db, reply(board));
    const jobs = listJobs(db, 1);
    expect(jobs[0].employer_name).toBe(resident(db, "katoen")!.name);
    expect(jobs[1].employer_name).toBe(resident(db, "vishandel")!.name);
    expect(jobs[2].employer_name).toBe("Sooi");
    expect(jobs.every((j) => j.playable)).toBe(true);
    expect(town(db).town.residents.find((r) => r.id === "katoen")?.work.kind).toBe("post");
  });
});
