import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { resetTalks } from "../src/hooks/dialogue.ts";
import { relationship } from "../src/npcs.ts";
import { town } from "../src/town/store.ts";
import { pickPocket, resetThieves } from "../src/town/thieves.ts";
import { returnThing, stealables, takeThing } from "../src/town/deeds.ts";
import { lease, payRent, takeKey } from "../src/homes/homes.ts";
import { within } from "../src/ideas/common.ts";
import { meet } from "../src/ideas/letters.ts";
import { pickLost, returnLost } from "../src/ideas/posters.ts";
import { actionRow, crimeOpen, installTalkHooks, reportAction, resetSync, startAction, validateProposal } from "../src/director/actions.ts";
import { resetConvos, type ConvoOut } from "../src/director/convo.ts";
import { installSurprises, promiseOf, tellFortune, FORTUNE_C } from "../src/director/surprises.ts";
import type { ActionProposal } from "../src/director/vocab.ts";

// Review fixes (2026-09-24), the town's side: money paid back once while a model call runs, one
// report per talk, the fortune's coin taken once, reach checks that a missing x/z cannot pass,
// no rent past Sunday, and giving a stolen thing back is no trust farm. Every model is a stub.

type Db = ReturnType<typeof openDb>;
const setClock = (db: Db, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const money = (db: Db) => (db.prepare("SELECT money_c FROM player WHERE id = 1").get() as { money_c: number }).money_c;
const setMoney = (db: Db, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = 1").run(c);
const setTrust = (db: Db, id: string, t: number) => db.prepare("UPDATE npc_relationship SET trust = ? WHERE npc_id = ?").run(t, id);
const restitutions = (db: Db) => (db.prepare("SELECT COUNT(*) n FROM log WHERE verb = 'restitution'").get() as { n: number }).n;
const prop = (over: Partial<ActionProposal>): ActionProposal => ({ kind: "none", target: "", minutes: 0, item: "", amount_c: 0, reason: "", ...over });
const convoOut: ConvoOut = {
  lines: [
    { speaker: "A", text: "Empty your sleeves." },
    { speaker: "B", text: "All right. Here." },
  ],
  memory_a: "",
  memory_b: "",
  outcome_kind: "none",
  trust_a: 0,
  trust_b: 0,
};

/** A runner that waits until the test opens the gate, and counts its calls. */
function gated(output: unknown): { runner: Runner; open: () => void; calls: () => number } {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let n = 0;
  return {
    runner: async () => {
      n++;
      await gate;
      return { output };
    },
    open: () => open(),
    calls: () => n,
  };
}

function fresh(hour = 10): Db {
  const db = openDb(":memory:");
  setClock(db, 1, hour);
  return db;
}
const byTrade = (db: Db, t: string) => town(db).town.residents.filter((r) => r.trade === t);

/** Jef is robbed at night; the clock goes back to the morning. */
function robbed(db: Db) {
  setClock(db, 1, 22);
  const thief = byTrade(db, "thief")[0];
  const r = pickPocket(db, thief.id, () => 0.1);
  expect(r.took_c).toBeGreaterThan(0);
  setClock(db, 1, 10);
  return { thief, took: r.took_c };
}

/** An agent already walking to the thief to question him (the talk_to the chain starts). */
function questioning(db: Db, thiefId: string): number {
  const agent = byTrade(db, "police")[0];
  return startAction(db, { npc_id: agent.id, kind: "talk_to", target: thiefId, target_x: 0, target_z: 0, source: "engine", minutes: 60, data: { purpose: "question" } }).id;
}

beforeEach(() => {
  resetTalks();
  resetThieves();
  resetSync();
  resetConvos();
  installTalkHooks();
  installSurprises();
});

describe("the purse comes back once", () => {
  it("the thief hands it back while the agent's words are written: the agent's verdict pays nothing more", async () => {
    const db = fresh();
    const { thief, took } = robbed(db);
    const before = money(db);
    const g = gated(convoOut);
    const id = questioning(db, thief.id);
    const first = reportAction(db, id, { phase: "arrived" }, g.runner);
    expect(actionRow(db, id)!.phase).toBe("talking");
    // meanwhile Jef asks the thief straight, and he gives it back
    const v = validateProposal(db, thief, prop({ kind: "give" }));
    expect(v.ok && v.instant).toBe(true);
    expect(money(db)).toBe(before + took);
    g.open();
    const done = await first;
    expect(done?.status).toBe("done");
    expect(done?.outcome).toBe("settled");
    expect(money(db)).toBe(before + took);
    expect(crimeOpen(db)).toBeNull();
    expect(restitutions(db)).toBe(1);
  });

  it("a second report while the talk runs is ignored: one model call, one payment", async () => {
    const db = fresh();
    const { thief, took } = robbed(db);
    const before = money(db);
    const g = gated(convoOut);
    const id = questioning(db, thief.id);
    const first = reportAction(db, id, { phase: "arrived" }, g.runner);
    const second = await reportAction(db, id, { phase: "done" }, g.runner);
    expect(second?.status).toBe("active");
    expect(second?.phase).toBe("talking");
    g.open();
    const done = await first;
    expect(done?.outcome).toBe("guilty");
    expect(g.calls()).toBe(1);
    expect(money(db)).toBe(before + took);
    expect(restitutions(db)).toBe(1);
  });

  it("a report's x/z is kept only when finite, and clamped to the map", async () => {
    const db = fresh();
    const r = byTrade(db, "docker")[0];
    const id = startAction(db, { npc_id: r.id, kind: "wait", target: "here", source: "talk", minutes: 60 }).id;
    await reportAction(db, id, { phase: "arrived", x: 1e9, z: -1e9 });
    expect(actionRow(db, id)).toMatchObject({ x: 2000, z: -2000 });
    await reportAction(db, id, { phase: "arrived", x: Number.NaN, z: 5 });
    expect(actionRow(db, id)).toMatchObject({ x: 2000, z: -2000 });
  });
});

describe("the fortune's coin", () => {
  it("two clicks while the cards are read: one coin, one promise", async () => {
    const db = fresh(11);
    const m0 = money(db);
    const g = gated({ prophecy: "The Knight of Cups, over the water. A stranger will know your name.", promise: "stranger" });
    const first = tellFortune(db, g.runner);
    expect(money(db)).toBe(m0 - FORTUNE_C);
    expect(promiseOf(db)?.status).toBe("pending");
    const second = await tellFortune(db, g.runner);
    expect(second.text).toMatch(/spoken for today/);
    expect(money(db)).toBe(m0 - FORTUNE_C);
    g.open();
    const r = await first;
    expect(r.text).toMatch(/Knight of Cups/);
    expect(promiseOf(db)).toMatchObject({ status: "open", kind: "stranger" });
    expect(money(db)).toBe(m0 - FORTUNE_C);
    expect(g.calls()).toBe(1);
  });
});

describe("reach checks: a missing x/z is never near", () => {
  it("within() refuses NaN, Infinity and a missing field", () => {
    const door = { x: 10, z: 10 };
    expect(within({ x: 10, z: 11 }, door, 2)).toBe(true);
    expect(within({ x: Number.NaN, z: 10 }, door, 2)).toBe(false);
    expect(within({ x: 10, z: Number.POSITIVE_INFINITY }, door, 2)).toBe(false);
    expect(within({} as { x: number; z: number }, door, 2)).toBe(false);
  });

  it("a letter's meeting, a lost thing and its owner's door refuse a body with no x/z", () => {
    const db = fresh(11);
    const who = byTrade(db, "docker")[0];
    const m = Number(db.prepare("INSERT INTO meeting (who, day, from_h, to_h, x, z, label, status) VALUES (?, 1, 9, 13, 5, 5, 'the door', 'open')").run(who.id).lastInsertRowid);
    expect(() => meet(db, m, {} as { x: number; z: number })).toThrow(/not their door/);
    expect(() => meet(db, m, { x: Number.NaN, z: Number.NaN })).toThrow(/not their door/);
    expect(meet(db, m, { x: 5, z: 6 }).text).toMatch(/step/);

    const owner = byTrade(db, "grocer")[0] ?? who;
    const thing = { what: "a brass key", x: 30, z: 40, state: "lying" };
    const p = Number(
      db
        .prepare("INSERT INTO poster (kind, spot, day, hour, down_day, status, ref, reward_c, owner, thing_json) VALUES ('lost', 'test:0', 1, 9, 3, 'up', 'lost:test', 10, ?, ?)")
        .run(owner.id, JSON.stringify(thing)).lastInsertRowid,
    );
    expect(() => pickLost(db, p, {} as { x: number; z: number })).toThrow(/not there yet/);
    pickLost(db, p, { x: 30, z: 40 });
    const m0 = money(db);
    expect(() => returnLost(db, p, { x: Number.NaN, z: 0 })).toThrow(/not their door/);
    expect(money(db)).toBe(m0);
    expect(returnLost(db, p, { x: owner.home.sx, z: owner.home.sz }).paid_c).toBe(10);
  });
});

describe("rent by the day stops at Sunday", () => {
  it("paid to Sunday: another day is refused, no coin taken, the lease unchanged", () => {
    const db = fresh();
    setMoney(db, 5000);
    takeKey(db, "garret", "week");
    expect(lease(db)!.paid_through).toBe(7);
    const m0 = money(db);
    expect(() => payRent(db, "day")).toThrow(/paid to Sunday/);
    expect(() => payRent(db, "week")).toThrow(/paid to Sunday/);
    expect(money(db)).toBe(m0);
    expect(lease(db)!.paid_through).toBe(7);
  });
});

describe("giving a stolen thing back is no trust farm", () => {
  function takeHerring(db: Db, seen: boolean) {
    const f = stealables(db).food.find((x) => x.item === "herring")!;
    const witnesses = seen ? [{ id: f.keeper, d: 2.5, los: true, facing: 1 }] : [];
    const r = takeThing(db, { ref: f.id, x: f.x, z: f.z + 1.3, witnesses }, seen ? () => 0 : () => 0.999);
    expect(r.deed).toBeTruthy();
    return { deed: r.deed!, keeper: f.keeper };
  }

  it("+1 at most once per owner per day; the next day again", () => {
    const db = fresh(10);
    const a = takeHerring(db, true);
    setTrust(db, a.keeper, 3);
    returnThing(db, a.deed, "gave");
    expect(relationship(db, a.keeper).trust).toBe(4);
    // take and give back again the same day: no more (the theft itself costs trust; reset it to see the give-back alone)
    const b = takeHerring(db, true);
    setTrust(db, a.keeper, 3);
    returnThing(db, b.deed, "gave");
    expect(relationship(db, a.keeper).trust).toBe(3);
    // the next day it counts once more
    setClock(db, 2, 10);
    const c = takeHerring(db, true);
    setTrust(db, a.keeper, 3);
    returnThing(db, c.deed, "gave");
    expect(relationship(db, a.keeper).trust).toBe(4);
  });

  it("nobody saw it: giving it back moves no trust", () => {
    const db = fresh(10);
    const a = takeHerring(db, false);
    setTrust(db, a.keeper, 3);
    returnThing(db, a.deed, "gave");
    expect(relationship(db, a.keeper).trust).toBe(3);
  });
});
