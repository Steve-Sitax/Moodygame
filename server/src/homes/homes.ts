import type { DB } from "../db.ts";
import { BEDTIME, clock, ending, NIGHT_HOOKS, sleep, WEEK_DAYS, type HomeNight, type SleepResult } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { remember } from "../npcs.ts";
import { resident } from "../town/store.ts";
import { activityAt } from "../town/schedule.ts";
import { ITEM_REF, ITEMS, POCKET_SLOTS } from "../trade.ts";
import { getState, minuteNow, setState } from "../interiors/state.ts";
import {
  CLASSES,
  canPlace,
  comfortOf,
  comfortWords,
  firstFit,
  FURNITURE,
  FURNITURE_KINDS,
  nightAt,
  type HomeClass,
  type Placed,
} from "../../../shared/homes.ts";
import { homeDef, homesTown, type HomeDef } from "./town.ts";

// Homes to rent (M6 homes): the key, the rent, the night at home, the furniture. The
// ENGINE owns every number: the rents (shared/homes.ts CLASSES), the days paid, the
// warning and the key taken back, the prices of the dealer's pieces, where a piece may
// stand, the comfort of the room and what a night there does to Jef's needs. The client
// only shows it and asks.

// ---------------------------------------------------------------- rent

/** Rent by the day: a week's rent over seven days, rounded up (a whole week is the week's price). */
export function dayRate(cls: HomeClass): number {
  return Math.ceil(CLASSES[cls].week_c / 7);
}

/** What `days` of rent cost: whole weeks at the week's price, the rest by the day. */
export function rentFor(cls: HomeClass, days: number): number {
  return Math.floor(days / 7) * CLASSES[cls].week_c + (days % 7) * dayRate(cls);
}

/** The last day of this rent week: the landlords count Monday to Sunday. */
export function weekEnd(day: number): number {
  return Math.ceil(day / WEEK_DAYS) * WEEK_DAYS;
}

export interface Lease {
  id: number;
  home: string;
  since_day: number;
  paid_through: number;
  warned_day: number;
  ended: string | null;
}

export function lease(db: DB): Lease | null {
  return (db.prepare("SELECT * FROM home_lease WHERE ended IS NULL ORDER BY id DESC LIMIT 1").get() as Lease | undefined) ?? null;
}

/** Days of rent owed today (today counts: Jef has the room today). */
export function owedDays(db: DB, l = lease(db)): number {
  if (!l) return 0;
  return Math.max(0, clock(db).day - l.paid_through);
}

function landlordName(db: DB, h: HomeDef): string {
  return resident(db, h.landlord)?.name ?? "the landlord";
}

function needHome(db: DB, id: unknown): HomeDef {
  const h = typeof id === "string" ? homeDef(db, id) : undefined;
  if (!h) throw new GameError("no such home", 404);
  return h;
}

/** What the landlord calls the place he lets. */
const OWNER_NOUN: Record<HomeClass, string> = { cellar: "cellar room", garret: "garret", widow: "spare room", alley: "house in the alley", merchant: "upper floor" };

/**
 * Take the key of a home: pay for tonight, or to the end of the week. A home already held
 * is given up (its paid days are lost); Jef's things go with him on the carter's cart.
 * Not while rent is owed on the old one.
 */
export function takeKey(db: DB, homeId: unknown, plan: unknown): { text: string; paid_c: number } {
  if (ending(db)) throw new GameError("the week is over", 409);
  const h = needHome(db, homeId);
  const c = clock(db);
  const old = lease(db);
  if (old?.home === h.id) throw new GameError("you have the key already", 409);
  if (old && owedDays(db, old) > 0) throw new GameError(`first pay what you owe on ${homeDef(db, old.home)?.label ?? "your room"}`, 409);
  const days = plan === "day" ? 1 : weekEnd(c.day) - c.day + 1;
  const cost = rentFor(h.cls, days);
  if (player(db).money_c < cost) throw new GameError(`not enough money: ${cost} c needed`, 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(cost);
    if (old) {
      db.prepare("UPDATE home_lease SET ended = 'moved' WHERE id = ?").run(old.id);
      moveThings(db, old.home as HomeClass, h.cls);
    }
    db.prepare("INSERT INTO home_lease (home, since_day, paid_through, warned_day, ended) VALUES (?, ?, ?, 0, NULL)").run(h.id, c.day, c.day + days - 1);
    log(db, "took_home", h.id, `Jef took ${h.label} from ${landlordName(db, h)}, ${cost} centimes for ${days === 1 ? "one night" : `${days} days`}.`);
  })();
  remember(db, h.landlord, `Jef took my ${OWNER_NOUN[h.cls]} and paid ${cost} centimes rent in advance.`, 4, "seen", null, { gist: `Jef rents a room from ${landlordName(db, h)}`, tone: 1 });
  return {
    paid_c: cost,
    text: `${landlordName(db, h)} counts the coins and hands you a key on a string. "${days === 1 ? "For tonight." : "Paid to Sunday."} Keep it clean."`,
  };
}

/** Pay the rent: what is owed first, then one day or on to the week's end. */
export function payRent(db: DB, plan: unknown): { text: string; paid_c: number } {
  if (ending(db)) throw new GameError("the week is over", 409);
  const l = lease(db);
  if (!l) throw new GameError("you rent no room", 409);
  const h = homeDef(db, l.home)!;
  const c = clock(db);
  const end = weekEnd(c.day);
  const to = plan === "day" ? Math.max(l.paid_through, c.day - 1) + 1 : end;
  const days = to - l.paid_through;
  if (days <= 0) throw new GameError("paid to Sunday already", 409);
  const cost = rentFor(h.cls, days);
  if (player(db).money_c < cost) throw new GameError(`not enough money: ${cost} c needed`, 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(cost);
    db.prepare("UPDATE home_lease SET paid_through = ?, warned_day = 0 WHERE id = ?").run(to, l.id);
    log(db, "paid_home_rent", h.id, `Jef paid ${landlordName(db, h)} ${cost} centimes rent for ${h.label}.`);
  })();
  remember(db, h.landlord, `Jef paid me ${cost} centimes rent on the day it was due.`, 2);
  return { paid_c: cost, text: `${landlordName(db, h)} writes it in the rent book. "${to >= end ? "Paid to Sunday." : "That covers today."}"` };
}

/**
 * The night's rent work (a day.ts night hook): a day not paid for is owed. The first night
 * something is owed brings a warning; owed at the week's end, after a warning, and the
 * landlord takes the key back and keeps the things in the room for the rent.
 */
export function rentNight(db: DB, day: number): string[] {
  const l = lease(db);
  if (!l || l.paid_through >= day) return [];
  const h = homeDef(db, l.home);
  if (!h) return [];
  const owed = day - l.paid_through;
  const owed_c = rentFor(h.cls, owed);
  const who = landlordName(db, h);
  if (day >= weekEnd(day) && l.warned_day > 0 && l.warned_day < day) {
    db.prepare("UPDATE home_lease SET ended = 'evicted' WHERE id = ?").run(l.id);
    const kept = db.prepare("UPDATE home_item SET state = 'gone' WHERE home = ? AND state IN ('placed', 'stored')").run(h.id).changes;
    log(db, "lost_home", h.id, `${who} took back the key of ${h.label}: Jef owed ${owed_c} centimes rent.`);
    remember(db, h.landlord, `Jef owed me ${owed_c} centimes rent and never paid. I took my key back${kept ? " and kept his things" : ""}.`, 6, "seen", null, { gist: `Jef did not pay his rent to ${who}`, tone: -2 });
    return [`${who} has taken back the key of ${h.label}. You owed ${owed_c} centimes.${kept ? " Your things stay with him for the rent." : ""}`];
  }
  if (l.warned_day === 0) {
    db.prepare("UPDATE home_lease SET warned_day = ? WHERE id = ?").run(day, l.id);
    log(db, "rent_warning", h.id, `${who} warned Jef about the rent for ${h.label}.`);
    return [`A note from ${who} under your door: rent owed, ${owed_c} centimes so far. Pay by Sunday, or the key goes back.`];
  }
  return [];
}
NIGHT_HOOKS.push(rentNight);

// ---------------------------------------------------------------- the night at home

/** Is the landlord turning Jef away tonight? (Owed at the week's end, after a warning.) */
function lockedOut(db: DB, l: Lease): boolean {
  const day = clock(db).day;
  return day >= weekEnd(day) && l.paid_through < day && l.warned_day > 0 && l.warned_day < day;
}

export function homeNight(db: DB, h: HomeDef): HomeNight {
  const n = nightAt(h.cls, placedIn(db, h.id));
  return {
    id: h.id,
    label: h.label,
    warmth: n.warmth,
    healthFed: n.healthFed,
    healthHungry: n.healthHungry,
    food: n.food,
    text: CLASSES[h.cls].night + (n.restful ? " You sleep deep and wake rested." : ""),
  };
}

/** Go to bed at home: after the doss house's bedtime, or earlier when dead tired. */
export function sleepHome(db: DB): SleepResult {
  if (ending(db)) throw new GameError("the week is over", 409);
  const l = lease(db);
  if (!l) throw new GameError("you rent no room", 409);
  const h = homeDef(db, l.home)!;
  const c = clock(db);
  if (c.hour < BEDTIME && player(db).sleep > 2) throw new GameError(`too early for bed; lie down from ${BEDTIME}:00, or when you are dead tired`, 409);
  if (lockedOut(db, l)) {
    const r = sleep(db, "rough");
    return { ...r, turnedAway: true, summary: [`The key does not turn: ${landlordName(db, h)} has changed the lock. You owe him rent.`, ...r.summary] };
  }
  return sleep(db, "home", homeNight(db, h));
}

// ---------------------------------------------------------------- the stove

export const STOVE_WARMTH = 1;
export const STOVE_EVERY_MIN = 60;

/** Warm yourself at your stove or hearth: +1 warmth, once a game hour. */
export function warmAtStove(db: DB): { text: string; warmed: boolean } {
  const l = lease(db);
  if (!l) throw new GameError("you rent no room", 409);
  const h = homeDef(db, l.home)!;
  const has = CLASSES[h.cls].fire || placedIn(db, h.id).some((p) => p.kind === "stove");
  if (!has) throw new GameError("there is no stove here", 409);
  const now = minuteNow(db);
  if (now - getState<number>(db, "home:stove", -1e9) < STOVE_EVERY_MIN)
    return { text: "The iron ticks. You are as warm as it will make you for now.", warmed: false };
  db.transaction(() => {
    db.prepare("UPDATE player SET warmth = MIN(10, warmth + ?) WHERE id = 1").run(STOVE_WARMTH);
    setState(db, "home:stove", now);
    log(db, "warmed", h.id, `Jef warmed himself at his own stove in ${h.label}.`);
  })();
  return { text: "You feed the fire a little and hold your hands to it. The cold goes out of your fingers.", warmed: true };
}

// ---------------------------------------------------------------- furniture

export interface HomeItem {
  id: number;
  kind: string;
  state: "pocket" | "arms" | "stored" | "placed" | "gone";
  home: string | null;
  gx: number | null;
  gz: number | null;
  rot: number;
  day: number;
}

export function items(db: DB): HomeItem[] {
  return db.prepare("SELECT * FROM home_item WHERE state != 'gone' ORDER BY id").all() as HomeItem[];
}

export function placedIn(db: DB, home: string): Placed[] {
  return (db.prepare("SELECT id, kind, gx, gz, rot FROM home_item WHERE home = ? AND state = 'placed'").all(home) as Placed[]).filter((p) => FURNITURE[p.kind]);
}

/** Moving house: the carter takes everything; each piece is set where it fits, or left stacked by the door. */
function moveThings(db: DB, from: HomeClass, to: HomeClass): void {
  const rows = db.prepare("SELECT * FROM home_item WHERE home = ? AND state IN ('placed', 'stored') ORDER BY id").all(from) as HomeItem[];
  const placed: Placed[] = placedIn(db, to);
  for (const r of rows) {
    const at = firstFit(to, placed, r.kind);
    if (at) {
      db.prepare("UPDATE home_item SET home = ?, state = 'placed', gx = ?, gz = ?, rot = ? WHERE id = ?").run(to, at.gx, at.gz, at.rot, r.id);
      placed.push({ id: r.id, kind: r.kind, ...at });
    } else db.prepare("UPDATE home_item SET home = ?, state = 'stored', gx = NULL, gz = NULL WHERE id = ?").run(to, r.id);
  }
}

// The dealer's pieces as trade items: the small ones go in a pocket (their row points at the
// piece), the big ones are carried in both arms like goods (no pocket slot). trade.ts buy()
// calls ITEM_REF before it takes the money: a refusal here is a GameError and nothing moves.
for (const kind of FURNITURE_KINDS) {
  const f = FURNITURE[kind];
  ITEMS[kind] = { name: f.name, note: f.note, carry: f.carry === "arms" ? "arms" : undefined };
  ITEM_REF[kind] = (db) => {
    if (!lease(db)) throw new GameError("\"And where would you put it? Rent a room first, then come back.\"", 409);
    if (f.carry === "arms" && db.prepare("SELECT 1 FROM home_item WHERE state = 'arms'").get())
      throw new GameError("your arms are full: carry the other piece home first", 409);
    if (f.carry === "pocket" && (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n >= POCKET_SLOTS) throw new GameError("your pockets are full", 409);
    const day = clock(db).day;
    return Number(db.prepare("INSERT INTO home_item (kind, state, home, rot, day) VALUES (?, ?, NULL, 0, ?)").run(kind, f.carry, day).lastInsertRowid);
  };
}

/**
 * Put a piece in the room at a grid cell and a turn. From the pocket, the arms, the pile by
 * the door, or from where it stood. The engine checks the place (shared canPlace) and Jef
 * must hold the key of the room.
 */
export function placeItem(db: DB, id: unknown, gx: unknown, gz: unknown, rot: unknown): { placed: Placed; why: null } {
  const l = lease(db);
  if (!l) throw new GameError("you rent no room", 409);
  const it = db.prepare("SELECT * FROM home_item WHERE id = ? AND state != 'gone'").get(Number(id)) as HomeItem | undefined;
  if (!it) throw new GameError("you have no such thing", 404);
  if (it.home && it.home !== l.home) throw new GameError("that is in another house", 409);
  const [x, z, r] = [Number(gx), Number(gz), Number(rot)];
  const why = canPlace(l.home as HomeClass, placedIn(db, l.home), it.kind, x, z, r, it.id);
  if (why) throw new GameError(why, 409);
  db.transaction(() => {
    if (it.state === "pocket") db.prepare("DELETE FROM item WHERE kind = ? AND ref = ?").run(it.kind, it.id);
    db.prepare("UPDATE home_item SET state = 'placed', home = ?, gx = ?, gz = ?, rot = ? WHERE id = ?").run(l.home, x, z, r, it.id);
    if (it.state !== "placed") log(db, "furnished", it.kind, `Jef put ${FURNITURE[it.kind].name} in his room.`);
  })();
  return { placed: { id: it.id, kind: it.kind, gx: x, gz: z, rot: r }, why: null };
}

/** Pick a placed piece up again (to move it): it goes to the pile by the door until put down. */
export function liftItem(db: DB, id: unknown): HomeItem {
  const l = lease(db);
  const it = db.prepare("SELECT * FROM home_item WHERE id = ? AND state = 'placed'").get(Number(id)) as HomeItem | undefined;
  if (!l || !it || it.home !== l.home) throw new GameError("nothing of yours stands there", 404);
  db.prepare("UPDATE home_item SET state = 'stored', gx = NULL, gz = NULL WHERE id = ?").run(it.id);
  return { ...it, state: "stored", gx: null, gz: null };
}

/** Leave the piece in your arms in the street: it is gone. */
export function abandonArms(db: DB): { text: string } {
  const it = db.prepare("SELECT * FROM home_item WHERE state = 'arms'").get() as HomeItem | undefined;
  if (!it) throw new GameError("your arms are empty", 409);
  db.prepare("UPDATE home_item SET state = 'gone' WHERE id = ?").run(it.id);
  log(db, "left_furniture", it.kind, `Jef left ${FURNITURE[it.kind].name} in the street.`);
  return { text: `You set ${FURNITURE[it.kind].name} against a wall and walk away. Someone will have it before dark.` };
}

// ---------------------------------------------------------------- what the client sees

export function homesInfo(db: DB) {
  const ht = homesTown(db);
  const l = lease(db);
  const c = clock(db);
  const homes = (ht?.homes ?? []).map((h) => {
    const cls = CLASSES[h.cls];
    const lord = resident(db, h.landlord);
    return {
      id: h.id,
      cls: h.cls,
      label: h.label,
      step: h.step,
      wall: h.wall,
      out: h.out,
      week_c: cls.week_c,
      day_c: dayRate(h.cls),
      to_sunday_c: rentFor(h.cls, weekEnd(c.day) - c.day + 1),
      notice: cls.notice,
      landlord: lord ? { id: lord.id, name: lord.name, first: lord.first } : null,
    };
  });
  const mine = l ? homeDef(db, l.home) : undefined;
  const placed = mine ? placedIn(db, mine.id) : [];
  const k = mine ? comfortOf(mine.cls, placed) : null;
  const widowHome = ht?.widow ? widowIn(db) : false;
  return {
    homes,
    dealer: ht?.dealer ?? null,
    lease: l && mine
      ? {
          home: l.home,
          since_day: l.since_day,
          paid_through: l.paid_through,
          owed_days: owedDays(db, l),
          owed_c: rentFor(mine.cls, owedDays(db, l)),
          warned: l.warned_day > 0,
          to_sunday_c: rentFor(mine.cls, Math.max(0, weekEnd(c.day) - l.paid_through)),
          day_c: dayRate(mine.cls),
          comfort: k,
          words: k ? comfortWords(k) : [],
          night: nightAt(mine.cls, placed),
          fire: CLASSES[mine.cls].fire || placed.some((p) => p.kind === "stove"),
        }
      : null,
    items: items(db).map((i) => ({ ...i, name: FURNITURE[i.kind]?.name ?? i.kind })),
    /** The widow at home now (she is in the room's doorway when Jef comes in). */
    widow: ht?.widow ? { id: ht.widow, home: widowHome } : null,
  };
}

/** Is the widow in her house now (her schedule says home, and she is up)? */
export function widowIn(db: DB): boolean {
  const ht = homesTown(db);
  const w = ht?.widow ? resident(db, ht.widow) : undefined;
  if (!w) return false;
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  return h >= 6.5 && h < 21.5 && activityAt(w.sched, c.day, h).act === "home";
}
