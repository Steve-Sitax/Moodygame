import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DB } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer } from "../src/player/current.ts";
import { ensurePlayerRow, pstate } from "../src/player/multi.ts";
import { buy } from "../src/trade.ts";
import { town } from "../src/town/store.ts";
import { resetSync } from "../src/director/actions.ts";
import { actionRow } from "../src/director/actions.ts";
import { devRoutine, reportStep, routineOf } from "../src/director/steps.ts";
import { jefHireChance } from "../src/director/hiring.ts";
import { dreamOf, FORTUNE_C, promiseOf, surprisesState, tellFortune } from "../src/director/surprises.ts";
import { clearGangs, gangNow, resetGangRoll, resolveGang, rollGang, setGangDice } from "../src/night/gangs.ts";
import { keeperAtWork, keeperOf, patronsIn } from "../src/interiors/state.ts";
import { diceLeft, throwDice, tipsy, warmByFire } from "../src/interiors/tavern.ts";
import { admit, doorOpen } from "../src/interiors/poesje.ts";

// M8c "each his own man" (docs/milestones/M8c-rules.md), the director, the night, the ballads, the shops and the
// interiors: the world's work stays the world's, but what touches a guest (asPlayer(2)) is his own: his money at the
// fortune teller, the gang that stops him and what it takes, his drink, his fire, his dice, his seat at the Poesje,
// the errand he pays for; the host's stay as they were.

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const fail: Runner = async () => {
  throw new Error("offline");
};

function fresh(hour = 12): DB {
  const db = blankSave();
  setClock(db, 1, hour);
  ensurePlayerRow(db, GUEST, "Anna");
  return db;
}
const setClock = (db: DB, day: number, hour: number, minute = 0) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = ? WHERE id = 1").run(day, hour, minute);
const row = (db: DB, id: number) => db.prepare("SELECT money_c, warmth, health FROM player WHERE id = ?").get(id) as { money_c: number; warmth: number; health: number };
const setMoney = (db: DB, id: number, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = ?").run(c, id);
const pocket = (db: DB, id: number, kind: string) => db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES (?, NULL, ?)").run(kind, id);
const items = (db: DB, id: number) => (db.prepare("SELECT kind FROM item WHERE player_id = ? ORDER BY id").all(id) as Array<{ kind: string }>).map((r) => r.kind);

/** A save at an hour where a tavern has drinkers and an open counter. */
function evening(): { db: DB; place: string } {
  for (const hour of [20, 21, 19, 13, 12]) {
    const db = fresh(hour);
    const places = Object.keys(town(db).town.places).filter((k) => k.startsWith("tavern:"));
    const place = places.sort((a, b) => patronsIn(db, b).length - patronsIn(db, a).length)[0];
    if (place && keeperAtWork(db, place) && patronsIn(db, place).length >= 1) return { db, place };
  }
  throw new Error("no open tavern with a drinker in the test town");
}

beforeEach(() => {
  resetGangRoll();
  resetSync();
});
afterEach(() => setGangDice(null));

describe("M8c the night: a guest's gang is his own", () => {
  it("the gang stops the guest, he pays from his own purse; the host has no gang and keeps his money", () => {
    const db = fresh(23);
    setGangDice(() => 0);
    setMoney(db, 1, 300);
    setMoney(db, GUEST, 100);
    const g = as2(() => rollGang(db, { x: 0, z: 20 }, 2e6, true))!;
    expect(g).toBeTruthy();
    expect(as2(() => gangNow(db))?.id).toBe(g.id);
    expect(gangNow(db)).toBeNull();
    expect(pstate<{ gang: unknown }>(db, "gang", GUEST)?.gang).toBeTruthy();
    expect(pstate(db, "gang", 1)).toBeNull();
    const res = as2(() => resolveGang(db, g.id, "pay"));
    expect(res.outcome).toBe("paid");
    expect(row(db, GUEST).money_c).toBe(100 - g.demand_c);
    expect(row(db, 1).money_c).toBe(300);
    // the host's own roll is his (a gang of his own, from his own purse)
    const h = rollGang(db, { x: 0, z: 20 }, 3e6, true)!;
    expect(h).toBeTruthy();
    expect(h.demand_c).toBeGreaterThan(g.demand_c);
    clearGangs(db);
    expect(as2(() => gangNow(db))).toBeNull();
  });

  it("robbed: his purse and his pockets, never the host's", () => {
    const db = fresh(23);
    setGangDice(() => 0.99);
    setMoney(db, 1, 200);
    setMoney(db, GUEST, 80);
    pocket(db, 1, "bread");
    pocket(db, GUEST, "apple");
    const g = as2(() => rollGang(db, { x: 0, z: 20 }, 2e6, true))!;
    const res = as2(() => resolveGang(db, g.id, "stand"));
    expect(res.outcome).toBe("robbed");
    expect(row(db, GUEST).money_c).toBe(80 - res.money_c);
    expect(items(db, GUEST)).toEqual([]);
    expect(row(db, 1).money_c).toBe(200);
    expect(items(db, 1)).toEqual(["bread"]);
  });
});

describe("M8c the interiors: his drink, his fire, his dice, his seat", () => {
  it("the fire warms the guest, on his own time; the host still may", () => {
    const { db, place } = evening();
    db.prepare("UPDATE player SET warmth = 3").run();
    expect(as2(() => warmByFire(db, place)).warmed).toBe(true);
    expect(row(db, GUEST).warmth).toBeGreaterThan(3);
    expect(row(db, 1).warmth).toBe(3);
    expect(as2(() => warmByFire(db, place)).warmed).toBe(false);
    expect(warmByFire(db, place).warmed).toBe(true);
    expect(row(db, 1).warmth).toBeGreaterThan(3);
  });

  it("a beer makes the guest tipsy, not the host", () => {
    const { db, place } = evening();
    setMoney(db, GUEST, 50);
    as2(() => buy(db, keeperOf(db, place)!.id, "beer"));
    expect(as2(() => tipsy(db))).toBeGreaterThan(0);
    expect(tipsy(db)).toBe(0);
  });

  it("dice: the stake moves the guest's money; the day's count is his", () => {
    const { db, place } = evening();
    const p = patronsIn(db, place)[0];
    setMoney(db, 1, 50);
    setMoney(db, GUEST, 50);
    const faces = [1, 1, 1, 2, 3, 5]; // the player three aces
    let i = 0;
    const rng = () => (faces[i++ % faces.length] - 1) / 6 + 0.01;
    const r = as2(() => throwDice(db, place, p.id, 5, rng));
    expect(r.result).toBe(1);
    expect(row(db, GUEST).money_c).toBe(55);
    expect(row(db, 1).money_c).toBe(50);
    expect(as2(() => diceLeft(db)).games).toBe(diceLeft(db).games - 1);
  });

  it("the Poesje: the guest pays at the door once; the host pays his own way in", () => {
    const db = fresh(20);
    expect(doorOpen(db)).toBe(true);
    setMoney(db, 1, 40);
    setMoney(db, GUEST, 40);
    expect(as2(() => admit(db)).paid_c).toBeGreaterThan(0);
    expect(as2(() => admit(db)).paid_c).toBe(0);
    expect(row(db, 1).money_c).toBe(40);
    const h = admit(db);
    expect(h.paid_c).toBeGreaterThan(0);
    expect(row(db, 1).money_c).toBe(40 - h.paid_c);
  });
});

describe("M8c the surprises: the cards and the dream are his", () => {
  it("the fortune: the guest pays, the promise is his; the host has none", async () => {
    const db = fresh(11);
    setMoney(db, 1, 30);
    setMoney(db, GUEST, 30);
    await as2(() => tellFortune(db, fail, () => 0));
    expect(row(db, GUEST).money_c).toBe(30 - FORTUNE_C);
    expect(row(db, 1).money_c).toBe(30);
    expect(as2(() => promiseOf(db))?.kind).toBeTruthy();
    expect(promiseOf(db)).toBeNull();
  });

  it("the dream is the guest's own, from his own day", async () => {
    const db = fresh(22);
    const d = await as2(() => dreamOf(db, fail));
    expect(d.text.length).toBeGreaterThan(10);
    expect(as2(() => surprisesState(db)).dream?.text).toBe(d.text);
    expect(surprisesState(db).dream).toBeNull();
  });
});

describe("M8c the director's executor and the hiring: his coins, his standing", () => {
  it("a routine the guest started pays from his purse, even when the host's tick moves it on", () => {
    const db = fresh(12);
    const r = town(db).town.residents.find((x) => x.age >= 20 && x.trade !== "police")!;
    setMoney(db, 1, 50);
    setMoney(db, GUEST, 50);
    const started = as2(() =>
      devRoutine(db, r.id, [
        { kind: "walk_to", x: 20, z: 20 },
        { kind: "pay", who: r.id, amount_c: 7, why: "test" },
      ]),
    );
    expect(routineOf(actionRow(db, started.id))!.player).toBe(GUEST);
    // the client's report (or the tick) outside any player's context
    reportStep(db, started.id, 0, true, "arrived");
    expect(row(db, GUEST).money_c).toBe(43);
    expect(row(db, 1).money_c).toBe(50);
  });

  it("the chance to be taken on at the gate is by his own trust with the naties", () => {
    const db = fresh(5);
    db.prepare("UPDATE faction_trust SET trust = 10 WHERE player_id = ? AND faction = 'naties'").run(GUEST);
    db.prepare("UPDATE faction_trust SET trust = 0 WHERE player_id = 1 AND faction = 'naties'").run();
    expect(as2(() => jefHireChance(db, null))).toBeGreaterThan(jefHireChance(db, null));
  });
});
