import { afterEach, describe, expect, it } from "vitest";
import type { DB } from "../src/db.ts";
import type { Runner } from "../src/ai/claude.ts";
import { blankSave } from "./blank-save.ts";
import { asPlayer } from "../src/player/current.ts";
import { ensurePlayerRow } from "../src/player/multi.ts";
import { buy, pockets } from "../src/trade.ts";
import { homesInfo, items, lease, payRent, placeItem, rentNight, takeKey, warmAtStove } from "../src/homes/homes.ts";
import { DEALER_ID } from "../src/homes/town.ts";
import { bergView, forfeitPawns, pawn, redeem, ticketView } from "../src/paper/pawn.ts";
import { collectWaiting, letterView, maybeLetter, postCounter, postView } from "../src/paper/post.ts";
import { pressTown } from "../src/paper/town.ts";
import { answerLetters, meetingsOpen, postLetter } from "../src/ideas/letters.ts";
import { wantedFactor } from "../src/ideas/wanted.ts";
import { lightCandle } from "../src/landmarks/deeds.ts";
import { jefInside, setJefIn } from "../src/landmarks/life.ts";
import { hushToday, ranInChurch } from "../src/landmarks/hush.ts";
import { town } from "../src/town/store.ts";

// M8c "each his own man" (docs/milestones/M8c-rules.md), homes, the paper, the ideas and the landmarks: a guest
// (asPlayer(2)) rents his own room, pays his own rent, and his furniture, letters and pawn tickets are his; the
// host's stay as they were.

const GUEST = 2;
const as2 = <T>(fn: () => T): T => asPlayer(GUEST, fn);
const broken: Runner = async () => {
  throw new Error("down");
};

const setClock = (db: DB, day: number, hour: number) => db.prepare("UPDATE player SET day = ?, hour = ?, minute = 0 WHERE id = 1").run(day, hour);
const money = (db: DB, id: number) => (db.prepare("SELECT money_c FROM player WHERE id = ?").get(id) as { money_c: number }).money_c;
const setMoney = (db: DB, id: number, c: number) => db.prepare("UPDATE player SET money_c = ? WHERE id = ?").run(c, id);
const warmth = (db: DB, id: number) => (db.prepare("SELECT warmth FROM player WHERE id = ?").get(id) as { warmth: number }).warmth;

function fresh(day = 1, hour = 10): DB {
  const db = blankSave();
  ensurePlayerRow(db, GUEST, "Anna");
  setClock(db, day, hour);
  setMoney(db, 1, 5000);
  setMoney(db, GUEST, 5000);
  return db;
}

afterEach(() => {
  setJefIn(null);
  as2(() => setJefIn(null));
});

describe("M8c homes: a guest's own room", () => {
  it("each rents his own room; the same room is let to one player at a time", () => {
    const db = fresh();
    takeKey(db, "garret", "week");
    const host = money(db, 1);
    expect(() => as2(() => takeKey(db, "garret", "week"))).toThrow(/the room is let/);
    expect(money(db, GUEST)).toBe(5000);
    expect(as2(() => homesInfo(db)).homes.find((h) => h.id === "garret")!.let).toBe(true);
    expect(homesInfo(db).homes.find((h) => h.id === "garret")!.let).toBe(false);
    const r = as2(() => takeKey(db, "alley", "week"));
    expect(money(db, GUEST)).toBe(5000 - r.paid_c);
    expect(money(db, 1)).toBe(host);
    expect(lease(db)!.home).toBe("garret");
    expect(as2(() => lease(db))!.home).toBe("alley");
    expect(as2(() => homesInfo(db)).lease!.home).toBe("alley");
    // his log line has his name
    const line = db.prepare("SELECT player_id, text FROM log WHERE verb = 'took_home' ORDER BY id DESC LIMIT 1").get() as { player_id: number; text: string };
    expect(line.player_id).toBe(GUEST);
    expect(line.text).not.toMatch(/\bJef\b/);
  });

  it("the guest pays his own rent, and the night's note is his alone", () => {
    const db = fresh();
    takeKey(db, "garret", "day");
    as2(() => takeKey(db, "cellar", "day"));
    setClock(db, 2, 10);
    const host = money(db, 1);
    const r = as2(() => payRent(db, "day"));
    expect(money(db, GUEST)).toBe(5000 - 2 * r.paid_c);
    expect(money(db, 1)).toBe(host);
    expect(as2(() => lease(db))!.paid_through).toBe(2);
    expect(lease(db)!.paid_through).toBe(1);
    // the night: the host owes, the guest does not
    expect(rentNight(db, 2)).toHaveLength(1);
    expect(as2(() => rentNight(db, 2))).toHaveLength(0);
    expect(lease(db)!.warned_day).toBe(2);
    expect(as2(() => lease(db))!.warned_day).toBe(0);
  });

  it("his furniture is his: bought, carried and placed in his room; the host's list is untouched", () => {
    const db = fresh();
    takeKey(db, "garret", "week");
    as2(() => takeKey(db, "alley", "week"));
    as2(() => buy(db, DEALER_ID, "chair"));
    const mine = as2(() => items(db));
    expect(mine.map((i) => [i.kind, i.state])).toEqual([["chair", "arms"]]);
    expect(items(db)).toEqual([]);
    // the host cannot place it
    expect(() => placeItem(db, mine[0].id, 3, 3, 0)).toThrow(/no such thing/);
    as2(() => placeItem(db, mine[0].id, 3, 3, 0));
    expect(as2(() => homesInfo(db)).items.map((i) => [i.kind, i.state, i.home])).toEqual([["chair", "placed", "alley"]]);
    expect(homesInfo(db).items).toEqual([]);
    // a small piece goes in his own pocket
    as2(() => buy(db, DEALER_ID, "picture"));
    expect(as2(() => pockets(db)).map((p) => p.kind)).toEqual(["picture"]);
    expect(pockets(db)).toEqual([]);
  });

  it("his stove warms him, once an hour, his own hour", () => {
    const db = fresh();
    takeKey(db, "alley", "week");
    as2(() => takeKey(db, "merchant", "week"));
    db.prepare("UPDATE player SET warmth = 3 WHERE id IN (1, ?)").run(GUEST);
    expect(warmAtStove(db).warmed).toBe(true);
    expect(warmth(db, 1)).toBe(4);
    expect(warmth(db, GUEST)).toBe(3);
    // the host's hour is spent; the guest's is not
    expect(warmAtStove(db).warmed).toBe(false);
    expect(as2(() => warmAtStove(db)).warmed).toBe(true);
    expect(warmth(db, GUEST)).toBe(4);
  });
});

describe("M8c paper: a guest's own pawn tickets and letters", () => {
  it("he pawns his own lantern: his money, his ticket; the host sees none and cannot redeem it; no medal of Jef's", () => {
    const db = fresh(2, 10);
    db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES ('lantern', NULL, ?)").run(GUEST);
    const lantern = as2(() => pockets(db)).find((p) => p.kind === "lantern")!;
    const host = money(db, 1);
    expect(() => pawn(db, lantern.id)).toThrow(/not in your pockets/);
    const r = as2(() => pawn(db, lantern.id));
    expect(money(db, GUEST)).toBe(5000 + r.pawn.loan_c);
    expect(money(db, 1)).toBe(host);
    expect(as2(() => pockets(db)).map((p) => p.kind)).toEqual(["pawn_ticket"]);
    expect(pockets(db)).toEqual([]);
    expect(as2(() => bergView(db)).tickets).toHaveLength(1);
    expect(bergView(db).tickets).toHaveLength(0);
    expect(() => ticketView(db, r.pawn.id)).toThrow(/not in your pockets/);
    expect(() => redeem(db, r.pawn.id)).toThrow(/no such pledge/);
    // the medal sewn in the coat is Jef's, the host's
    expect(() => as2(() => pawn(db, 0))).toThrow(/no medal/);
    expect(as2(() => bergView(db)).offers.some((o) => o.kind === "medal")).toBe(false);
    expect(bergView(db).offers.some((o) => o.kind === "medal")).toBe(true);
    expect(pressTown(db)!.medal).toBe("owned");
    // he redeems it himself
    const back = as2(() => redeem(db, r.pawn.id));
    expect(money(db, GUEST)).toBe(5000 + r.pawn.loan_c - back.paid_c);
    expect(as2(() => pockets(db)).map((p) => p.kind)).toEqual(["lantern"]);
  });

  it("a pledge past its day: the Berg's sale takes the guest's ticket from his pockets, his line with his name", () => {
    const db = fresh(2, 10);
    db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES ('lantern', NULL, ?)").run(GUEST);
    const lantern = as2(() => pockets(db)).find((p) => p.kind === "lantern")!;
    as2(() => pawn(db, lantern.id));
    setClock(db, 6, 7);
    const sold = forfeitPawns(db);
    expect(sold.map((p) => p.player_id)).toEqual([GUEST]);
    expect(as2(() => pockets(db))).toEqual([]);
    expect(pressTown(db)!.medal).toBe("owned");
    const line = db.prepare("SELECT player_id, text FROM log WHERE verb = 'pawn_sold'").get() as { player_id: number; text: string };
    expect(line.player_id).toBe(GUEST);
    expect(line.text).not.toMatch(/\bJef\b/);
  });

  it("a letter for the guest is his: in his pockets, his to read; the host's post is untouched", async () => {
    const db = fresh(3, 10);
    const l = (await as2(() => maybeLetter(db, { force: true, runner: broken })))!;
    expect(l).not.toBeNull();
    expect((db.prepare("SELECT player_id FROM letter WHERE id = ?").get(l.id) as { player_id: number }).player_id).toBe(GUEST);
    expect(as2(() => pockets(db)).some((p) => p.kind === "letter" && p.ref === l.id)).toBe(true);
    expect(pockets(db).some((p) => p.kind === "letter")).toBe(false);
    expect(as2(() => letterView(db, l.id)).from).toBe(l.sender_name);
    expect(() => letterView(db, l.id)).toThrow(/no such letter/);
    // a letter that waits at the post office (his pockets full) is his to collect
    db.prepare("UPDATE letter SET status = 'waiting' WHERE id = ?").run(l.id);
    db.prepare("DELETE FROM item WHERE kind = 'letter' AND player_id = ?").run(GUEST);
    expect(as2(() => postView(db)).waiting).toBe(1);
    expect(postView(db).waiting).toBe(0);
    if (postView(db).open) {
      expect(collectWaiting(db).n).toBe(0);
      expect(as2(() => collectWaiting(db)).n).toBe(1);
    }
  });
});

describe("M8c ideas: a guest's own letters, replies and wanted bills", () => {
  it("he writes to someone he met; the reply comes to his pockets in the morning, the host's are untouched", async () => {
    const db = fresh(2, 10);
    const clerk = pressTown(db)!.post!.clerk;
    const to = town(db).town.residents.find((r) => r.age >= 25 && r.id !== clerk && !["thief", "soldier", "sentry", "emigrant"].includes(r.trade))!;
    db.prepare("UPDATE npc_relationship SET times_met = 1, last_seen_day = 2 WHERE npc_id = ? AND player_id = ?").run(to.id, GUEST);
    const c = postCounter(db)!;
    // the host has not met him
    expect(() => postLetter(db, to.id, "Good day to you.", c)).toThrow(/met/);
    const host = money(db, 1);
    as2(() => postLetter(db, to.id, "Good day to you. I hope you are well.", c));
    expect(money(db, 1)).toBe(host);
    expect(money(db, GUEST)).toBeLessThan(5000);
    setClock(db, 3, 7);
    const hostPockets = pockets(db).length;
    // the morning is the world's work (the host's context), each letter answered as its writer
    const r = await answerLetters(db, { runner: broken, rng: () => 0.99 });
    expect(r).toHaveLength(1);
    expect(r[0].player).toBe(GUEST);
    expect(as2(() => pockets(db)).some((p) => p.kind === "letter" && p.ref === r[0].reply)).toBe(true);
    expect(pockets(db)).toHaveLength(hostPockets);
    expect(as2(() => letterView(db, r[0].reply)).from).toBe(to.name);
    expect(meetingsOpen(db)).toEqual([]);
  });

  it("a wanted bill naming the guest makes his thefts riskier, not the host's", () => {
    const db = fresh(2, 10);
    db.prepare("INSERT INTO poster (kind, spot, day, hour, down_day, status, ref, names_jef) VALUES ('wanted', 'x', 2, 10, 4, 'up', 'deed:999', ?)").run(GUEST);
    expect(wantedFactor(db)).toBe(1);
    expect(as2(() => wantedFactor(db))).toBeGreaterThan(1);
  });
});

describe("M8c landmarks: a guest's own candle, place and church trust", () => {
  it("his candle is his money; where he is inside is his; running in church costs his kerk trust", () => {
    const db = fresh(1, 10);
    const host = money(db, 1);
    as2(() => lightCandle(db));
    expect(money(db, 1)).toBe(host);
    expect(money(db, GUEST)).toBeLessThan(5000);
    as2(() => setJefIn("cathedral"));
    expect(jefInside()).toBeNull();
    expect(as2(() => jefInside())).toBe("cathedral");
    const kerk = (id: number) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = 'kerk' AND player_id = ?").get(id) as { trust: number }).trust;
    const k1 = kerk(1);
    const k2 = kerk(GUEST);
    const hr = as2(() => ranInChurch(db, 5));
    expect(hr.counted).toBe(true);
    expect(as2(() => hushToday(db)).strikes).toBe(1);
    expect(hushToday(db).strikes).toBe(0);
    expect(kerk(1)).toBe(k1);
    expect(kerk(GUEST)).toBe(k2 + hr.delta);
    // the host is in the street: nothing counts for him
    expect(ranInChurch(db, 5).counted).toBe(false);
  });
});
