import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { remember } from "../npcs.ts";
import { resident } from "./store.ts";

// Pickpockets (M3e). Thieves come out at night; the client walks one up
// behind Jef and asks. The ENGINE decides: whether the hand gets in, how much
// it takes (a share of what Jef has, never more than 60 c), and whether Jef
// can get it back (he must lay hands on the thief within CATCH_MS).

export const NIGHT_FROM = 20;
export const NIGHT_TO = 6;
const MAX_PER_NIGHT = 2;
const MAX_TAKE_C = 60;
export const CATCH_MS = 25_000;

interface Pending {
  thief: string;
  amount: number;
  at: number;
  day: number;
}
let pending: Pending | null = null;

function picksToday(db: DB, day: number): Record<string, number> {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(`picks:${day}`) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as Record<string, number>) : {};
}

function savePicks(db: DB, day: number, v: Record<string, number>): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(`picks:${day}`, JSON.stringify(v));
}

export function isNight(hour: number): boolean {
  return hour >= NIGHT_FROM || hour < NIGHT_TO;
}

/** A thief tries Jef's pocket. Engine numbers only. */
export function pickPocket(db: DB, id: string, rng: () => number = Math.random, now = Date.now()): { took_c: number; felt: boolean; text: string } {
  const r = resident(db, id);
  if (!r || r.trade !== "thief") throw new GameError("not a thief", 409);
  const p = player(db);
  const hour = (db.prepare("SELECT hour FROM player WHERE id = 1").get() as { hour: number }).hour;
  if (!isNight(hour)) throw new GameError("too light for that", 409);
  const done = picksToday(db, p.day);
  if (id in done) throw new GameError("this one has tried already tonight", 409);
  if (Object.keys(done).length >= MAX_PER_NIGHT) throw new GameError("enough for one night", 409);
  const success = rng() < 0.55 + (r.stats.courage - 5) * 0.03;
  let took = 0;
  let text: string;
  if (p.money_c < 5) {
    text = "A quick hand goes through your coat and finds nothing. Someone laughs in the dark.";
  } else if (!success) {
    text = "You feel a hand at your pocket and knock it away. Someone slips off into the dark.";
    remember(db, id, "I tried Jef's pocket and he felt it. Quick, that one.", 4);
  } else {
    took = Math.min(MAX_TAKE_C, p.money_c, Math.max(5, Math.round((p.money_c * (0.2 + rng() * 0.25)) / 5) * 5));
    text = "Someone brushes past you in the dark. A moment later your pocket is lighter.";
    db.transaction(() => {
      db.prepare("UPDATE player SET money_c = MAX(0, money_c - ?) WHERE id = 1").run(took);
      log(db, "robbed", id, `Someone picked Jef's pocket at night and took ${took} centimes.`);
    })();
    remember(db, id, `I lifted ${took} centimes from Jef's pocket in the dark. He never saw me.`, 5, "seen", null, {
      gist: "Jef had his pocket picked in the dark, and never saw who",
      tone: -1,
    });
    pending = { thief: id, amount: took, at: now, day: p.day };
  }
  done[id] = took;
  savePicks(db, p.day, done);
  return { took_c: took, felt: !success || took === 0, text };
}

/** Jef lays hands on the thief in time: the money comes back. */
export function catchThief(db: DB, id: string, now = Date.now()): { back_c: number; text: string } {
  const r = resident(db, id);
  if (!r) throw new GameError("nobody by that name", 404);
  if (!pending || pending.thief !== id || now - pending.at > CATCH_MS || pending.day !== player(db).day) {
    throw new GameError("nothing to get back from this one", 409);
  }
  const back = pending.amount;
  pending = null;
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(back);
    log(db, "caught_thief", id, `Jef caught the pickpocket ${r.name} and took back his ${back} centimes.`);
  })();
  remember(db, id, "Jef caught me by the collar and took his money back. I'll remember his face.", 7, "seen", null, {
    gist: "Jef caught a pickpocket by the collar and got his money back",
    tone: 2,
  });
  return { back_c: back, text: `You grab ${r.first} by the collar. Your ${back} centimes come out of a sleeve, and ${r.sex === "f" ? "she" : "he"} twists free and runs.` };
}

/** Test helper. */
export function resetThieves(): void {
  pending = null;
}
