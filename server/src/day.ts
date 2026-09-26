import { sexed } from "./player/profile.ts"; // M7 character: lines said to the player follow the profile
import type { DB } from "./db.ts";
import { log, player } from "./game.ts";
import { spreadRumours } from "./town/rumours.ts";
import { endRide, ridePlace } from "./ride.ts";
import { endRowNight, rowChillEvery, rowFood } from "./rowing.ts";
import { TICK_MINUTES, TICK_EVERY_MS } from "../../shared/clock.ts";
import { COLLAPSE_AT, sleepMinutes } from "../../shared/night.ts";
import { fogAt, type FogDay } from "./town/lampround.ts";
import { gateMode, isPaused } from "./save/gate.ts";

// The day and the week (M5). The engine owns time and needs (docs/01, docs/03).
// A client says "time passed while I played" with a tick; the server decides how
// much and applies needs hour by hour. M7 night (Steve 2026-09-25): the clock runs on
// through the night; the date turns at midnight (turnDay); sleep is Jef's own choice and
// lasts seven to eight game hours (sleep); dead tired, he drops where he stands.

/**
 * The tick (M7 clock, shared/clock.ts): 5 game minutes every 10 real seconds; a game hour is two
 * real minutes, 6:00 to midnight 36 real minutes. (Before M7: 15 game minutes every 5 s.)
 */
export { TICK_MINUTES, TICK_EVERY_MS } from "../../shared/clock.ts";
export const DAWN = 6;
export const BEDTIME = 18; // the doss house lets its beds from this hour until dawn (DAWN)
export const WEEK_DAYS = 7;
export const RENT_C = 150; // a week's bed in the doss house, due by Sunday (day 7)

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Weather for the day (Steve, 2026-09-23: "we do not always need fog"). Monday is always fog. */
export type Weather = "fog" | "mist" | "clear" | "rain" | "storm";
export const WEATHER_TEXT: Record<Weather, string> = {
  fog: "thick river fog",
  mist: "a thin mist that lifts by noon",
  clear: "clear and cold, the far bank in sight",
  rain: "cold rain off the sea, the cobbles running wet",
  storm: "a gale off the sea, rain in sheets, the river rough and grey", // not "running high": the tide decides that (QA 2026-09-24)
};

export function weather(db: DB): Weather {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'weather'").get() as { value_json: string } | undefined;
  const w = row ? (JSON.parse(row.value_json) as string) : "fog";
  return w === "mist" || w === "clear" || w === "rain" || w === "storm" ? w : "fog";
}

/** A new morning, a new sky: fog 35 %, mist 30 %, clear 18 %, rain 12 %, storm 5 %. */
export function rollWeather(db: DB, roll = Math.random()): Weather {
  const w: Weather = roll < 0.35 ? "fog" : roll < 0.65 ? "mist" : roll < 0.83 ? "clear" : roll < 0.95 ? "rain" : "storm";
  return setWeather(db, w);
}

/**
 * Set the day's weather (the morning roll, or the dev menu): the weather of the whole day, from
 * midnight. `at` (an hour, 0-24): the weather turns at that hour of the day instead (the director's
 * event); the lamps see the fog come or lift then (M7 fog lamps, fogDay).
 */
export function setWeather(db: DB, w: Weather, at?: number): Weather {
  const fog = fogDay(db);
  const day = fog.day ?? 1;
  let next: FogDay;
  if (at === undefined) next = { day, start: w === "fog", turns: [] };
  else {
    next = fog;
    if (fogAt(fog, 24) !== (w === "fog")) next.turns.push({ h: Math.max(0, Math.min(24, at)), fog: w === "fog" });
  }
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('fog_day', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(next));
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('weather', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(w),
  );
  return w;
}

/**
 * M7 fog lamps: today's fog as the lamplighters see it (town/lampround.ts FogDay): whether the day
 * began in fog, and the hours it came or lifted since. A record of an older day (or none: an older
 * save) means the weather has not turned since: the day began in today's weather.
 */
export function fogDay(db: DB): FogDay {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number } | undefined)?.day ?? 1;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'fog_day'").get() as { value_json: string } | undefined;
  try {
    const f = row ? (JSON.parse(row.value_json) as FogDay) : null;
    if (f && f.day === day && typeof f.start === "boolean" && Array.isArray(f.turns))
      return { day, start: f.start, turns: f.turns.filter((t) => typeof t?.h === "number" && typeof t?.fog === "boolean").slice(-8) };
  } catch {
    /* a broken record: start again from the weather */
  }
  return { day, start: weather(db) === "fog", turns: [] };
}

export type Ending = { kind: "week" | "health"; day: number; epilogue?: { title: string; paragraphs: string[] } };

export interface Clock {
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  weather: Weather;
}

export function clock(db: DB): Clock {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return { ...p, weekday: DAY_NAMES[(p.day - 1) % 7], weather: weather(db) };
}

export function ending(db: DB): Ending | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'ending'").get() as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as Ending) : null;
}

export function setEnding(db: DB, e: Ending): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('ending', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(e),
  );
}

export function rentPaid(db: DB): boolean {
  return (db.prepare("SELECT rent_paid_until FROM player WHERE id = 1").get() as { rent_paid_until: number }).rent_paid_until >= WEEK_DAYS;
}

const clamp = (n: number) => Math.max(0, Math.min(10, n));

/** M7 warmth: hours between two points of warmth lost on foot, with a lantern, out of the wind; the heated room's gain (applyHour). */
export const WARMTH = {
  day: 5,
  night: 3,
  lanternDay: 6,
  lanternNight: 4,
  shelteredDay: 10,
  shelteredNight: 6,
  /** In a heated room: +1 at every 2nd hour while warmth is below the cap. */
  roomEvery: 2,
  roomCap: 7,
} as const;

/**
 * M7 warmth: where Jef is for the cold, as the engine believes it (warmth.ts sets `now`: the client's
 * report, checked; with no report he is outside). `lantern`: lit in his hand, owned, outside and dry.
 */
export type Shelter = "outside" | "heated" | "sheltered";
export interface JefWhere {
  shelter: Shelter;
  lantern: boolean;
  place: string | null;
  label: string;
}
export const WHERE: { now: (db: DB) => JefWhere } = {
  now: () => ({ shelter: "outside", lantern: false, place: null, label: "outside" }),
};

/** How warmth goes this hour for Jef where he is: -1 every `chill` hours (null: no loss), +1 every `gain` hours up to `cap`. */
export function warmthRule(db: DB, cold: boolean): { chill: number | null; gain: number | null; cap: number; where: JefWhere | null } {
  const row = rowChillEvery(db, cold);
  if (row !== null) return { chill: row, gain: null, cap: 10, where: null };
  // on the omnibus: inside out of the wind; on its roof seat a little better off than on foot
  const on = ridePlace(db);
  if (on) return { chill: cold ? (on === "inside" ? WARMTH.shelteredNight : 4) : on === "inside" ? WARMTH.shelteredDay : 7, gain: null, cap: 10, where: null };
  const at = WHERE.now(db);
  if (at.shelter === "heated") return { chill: null, gain: WARMTH.roomEvery, cap: WARMTH.roomCap, where: at };
  if (at.shelter === "sheltered") return { chill: cold ? WARMTH.shelteredNight : WARMTH.shelteredDay, gain: null, cap: 10, where: at };
  if (at.lantern) return { chill: cold ? WARMTH.lanternNight : WARMTH.lanternDay, gain: null, cap: 10, where: at };
  return { chill: cold ? WARMTH.night : WARMTH.day, gain: null, cap: 10, where: at };
}

/**
 * Needs for one game hour awake (engine numbers; eased 2026-09-23 after Steve
 * starved within minutes): food -1 every 6 h, sleep -1 every 3 h, warmth -1
 * every 5 h by day and every 3 h at night (20:00 to 7:00). Health -1 every 3 h
 * while any need is at 0; +1 every 4 h while all three are at 4 or more.
 * On the omnibus (M3g, ride.ts), out of the wind: warmth -1 only every 10 h by day
 * and every 6 h at night; up on its roof seat every 7 h by day and every 4 h at night.
 * Food is the same on board as on foot.
 * In a rowing boat (M3j, rowing.ts), in the wind: warmth -1 every 4 h by day (3 in rain or a
 * gale) and every 2 h at night; a long row and hard strokes cost food (rowFood).
 * M7 warmth (Steve 2026-09-26, docs/milestones/M7-warmth.md; where Jef is: warmth.ts, checked there):
 * - outside with a lit lantern in his hand, and dry: warmth -1 every 6 h by day and every 4 h at
 *   night. In rain or a gale, or within two game hours of a swim, the lantern does not help.
 * - in a heated room (an open tavern or the Poesje, a shop with a stove, his own room with a stove
 *   or hearth): no loss, and +1 every 2 h by itself up to 7 (WARMTH.roomCap). The fire (E in a
 *   tavern, the stove at home) still gives its +1 once an hour, up to 10.
 * - in a big unheated room (the cathedral and the churches, a landmark hall, the prison, a shop
 *   or a room without a stove): out of the wind, as inside the omnibus: -1 every 10 h by day and
 *   every 6 h at night; no gain.
 * The boat and the omnibus are the server's own record and come first; a swim still costs 1 at once.
 */
export function applyHour(db: DB, hour: number): { healthZero: boolean } {
  const p = player(db);
  let { food, warmth, sleep, health } = p;
  if (hour % 6 === 0) food--;
  if (hour % 3 === 0) sleep--;
  const cold = hour >= 20 || hour < 7;
  const rule = warmthRule(db, cold);
  food -= rowFood(db, hour);
  if (rule.chill !== null && hour % rule.chill === 0) warmth--;
  if (rule.gain !== null && hour % rule.gain === 0 && warmth < rule.cap) warmth++;
  food = clamp(food);
  warmth = clamp(warmth);
  sleep = clamp(sleep);
  if (food === 0 || warmth === 0 || sleep === 0) {
    if (hour % 3 === 0) health--;
  } else if (food >= 4 && warmth >= 4 && sleep >= 4 && hour % 4 === 0) health++;
  health = clamp(health);
  db.prepare("UPDATE player SET food = ?, warmth = ?, sleep = ?, health = ? WHERE id = 1").run(food, warmth, sleep, health);
  return { healthZero: health === 0 };
}

let lastTickAt = 0;
let lastSwimAt = -Infinity;

/** Test helper. */
export function resetTickLimit(): void {
  lastTickAt = 0;
  lastSwimAt = -Infinity;
}

/** A dip counts once however long you are in: a new one only after this long. */
export const SWIM_EVERY_MS = 60_000;

/**
 * Jef fell into the Schelde (the client says so once per fall): the cold takes 1 warmth,
 * clamped at 0. At most once a minute, whatever the client sends.
 */
export function swim(db: DB, now = Date.now()): { cold: boolean } {
  if (ending(db)) return { cold: false };
  if (now - lastSwimAt < SWIM_EVERY_MS) return { cold: false };
  lastSwimAt = now;
  db.prepare("UPDATE player SET warmth = MAX(0, warmth - 1) WHERE id = 1").run();
  // M7 warmth: his coat is wet for a while (warmth.ts wetNow: the lantern does not help then)
  const c = clock(db);
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('swam_at', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(c.day * 1440 + c.hour * 60 + c.minute),
  );
  return { cold: true };
}

/**
 * M7 night (Steve 2026-09-25): the date turns at midnight while Jef is up; nobody is sent to bed.
 * `lines`: what the night's other work says (a note under the door about the rent of a room).
 */
export interface DayTurn {
  /** The new day (or the last one, when the week ended). */
  day: number;
  lines: string[];
  ended?: Ending;
}

export type TickResult = {
  advanced: boolean;
  /** Jef dropped where he stood (sleep 0): the night he slept there. */
  night?: SleepResult;
  ended?: Ending;
  /** The date turned at midnight on this tick. */
  turned?: DayTurn;
};

/**
 * Midnight: the date turns. The week's end, the rent of a room, the memories fading, a night of
 * talk in the taverns, the day's money mark and the weather; the new board is the caller's
 * (index.ts afterNight). After Sunday (day 7) there is no day 8: the week is over.
 */
export function turnDay(db: DB): DayTurn {
  const c = clock(db);
  const lines: string[] = [];
  db.transaction(() => {
    for (const h of NIGHT_HOOKS) lines.push(...h(db, c.day));
    consolidate(db);
    // a night of talk in the taverns and over the back walls (M3e)
    for (let i = 0; i < 3; i++) spreadRumours(db);
  })();
  if (c.day >= WEEK_DAYS) return { day: c.day, lines, ended: endGame(db, "week") };
  db.prepare("UPDATE player SET day = day + 1, hour = 0, minute = 0 WHERE id = 1").run();
  markDayStart(db);
  rollWeather(db);
  return { day: c.day + 1, lines };
}

/**
 * Let game time pass without the hourly needs (asleep, in the cell): the clock moves on by whole
 * minutes, the date turns at each midnight on the way. Stops when the week ends.
 */
export function passTime(db: DB, minutes: number): { lines: string[]; turned: boolean; ended?: Ending } {
  let left = Math.max(0, Math.round(minutes));
  const lines: string[] = [];
  let turned = false;
  while (left > 0) {
    const c = clock(db);
    const toMidnight = (24 - c.hour) * 60 - c.minute;
    if (left < toMidnight) {
      const t = c.hour * 60 + c.minute + left;
      db.prepare("UPDATE player SET hour = ?, minute = ? WHERE id = 1").run(Math.floor(t / 60), t % 60);
      left = 0;
    } else {
      left -= toMidnight;
      const t = turnDay(db);
      turned = true;
      lines.push(...t.lines);
      if (t.ended) return { lines, turned, ended: t.ended };
    }
  }
  return { lines, turned };
}

/** Time passes while Jef plays. At most one tick per TICK_EVERY_MS less a second (9 s), whatever the client sends. */
export function tick(db: DB, now = Date.now()): TickResult {
  if (ending(db)) return { advanced: false };
  // M7 save and pause: nothing moves while the game is paused, saving or loading (save/gate.ts)
  if (isPaused() || gateMode() !== "open") return { advanced: false };
  if (now - lastTickAt < TICK_EVERY_MS - 1000) return { advanced: false };
  lastTickAt = now;
  const c = clock(db);
  let minute = c.minute + TICK_MINUTES;
  let hour = c.hour;
  if (minute < 60) {
    db.prepare("UPDATE player SET minute = ? WHERE id = 1").run(minute);
    return { advanced: true };
  }
  minute -= 60;
  hour++;
  let turned: DayTurn | undefined;
  if (hour >= 24) {
    // M7 night: midnight turns the date; the clock runs on through the night
    turned = turnDay(db);
    if (turned.ended) return { advanced: true, ended: turned.ended, turned };
    hour -= 24;
  }
  db.prepare("UPDATE player SET hour = ?, minute = ? WHERE id = 1").run(hour, minute);
  const { healthZero } = applyHour(db, hour);
  // M3e: an hour of talk in the town; rumours about Jef pass on
  spreadRumours(db);
  if (healthZero) return { advanced: true, ended: endGame(db, "health"), ...(turned ? { turned } : {}) };
  // M7 night: dead on his feet, Jef drops where he stands and sleeps there (a gang may find him)
  if (player(db).sleep <= COLLAPSE_AT) return { advanced: true, night: sleep(db, "rough", undefined, { collapsed: true }), ...(turned ? { turned } : {}) };
  return { advanced: true, ...(turned ? { turned } : {}) };
}

/** Did this tick or night turn the date (a new board is due), or end the week? */
export function newDayOf(r: { turned?: DayTurn | boolean; ended?: Ending; night?: SleepResult }): { due: boolean; ended?: Ending } {
  const ended = r.ended ?? r.night?.ended ?? (typeof r.turned === "object" ? r.turned.ended : undefined);
  const due = !!r.turned || !!r.night?.turned || !!ended;
  return { due, ...(ended ? { ended } : {}) };
}

export interface SleepResult {
  where: "bed" | "rough" | "home";
  turnedAway: boolean;
  summary: string[];
  /** The day he wakes on (or the last day, when the week ended in his sleep). */
  day: number;
  ended?: Ending;
  /** M6 homes: which home Jef slept in ("the garret in the Schipperskwartier"). */
  place?: string;
  home?: string;
  /** M7 night: how long he slept (game minutes), when he woke, and whether the date turned meanwhile. */
  slept_min: number;
  wake: { day: number; hour: number; minute: number; weekday: string };
  turned: boolean;
  /** He dropped where he stood (sleep 0). */
  collapsed?: boolean;
  /** A gang went through his coat while he slept (night/gangs.ts): what it cost. */
  robbed?: { money_c: number; things: string[] };
}

/**
 * M6 homes: a night in a rented home, by the engine's numbers (homes/homes.ts works them
 * out from the room's comfort; every home beats the doss house bed).
 */
export interface HomeNight {
  id: string;
  label: string;
  warmth: number;
  healthFed: number;
  healthHungry: number;
  food: number;
  text: string;
}

/**
 * M6: other modules' work at midnight (the rent of a home), run inside the date's turn before
 * the memories fade. Each may add lines (shown at midnight, or on the night sheet if he sleeps).
 */
export const NIGHT_HOOKS: Array<(db: DB, day: number) => string[]> = [];

/**
 * M7 night: other modules' say while Jef lies down (night/gangs.ts: a gang may go through the coat
 * of a man asleep in the street). Run before the time passes; may add lines and a loss.
 */
export interface SleepInfo {
  where: "bed" | "rough" | "home";
  collapsed: boolean;
  hour: number;
}
export const SLEEP_HOOKS: Array<(db: DB, s: SleepInfo) => { lines: string[]; robbed?: { money_c: number; things: string[] } } | null> = [];

function startOfDayMoney(db: DB): number {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'day_start_money'").get() as { value_json: string } | undefined;
  return row ? Number(JSON.parse(row.value_json)) : 50;
}

export function markDayStart(db: DB): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('day_start_money', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(player(db).money_c),
  );
}

/** M7 night: how many times Jef has slept (the dream comes after a sleep, not at midnight). */
export function nightsSlept(db: DB): number {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'nights_slept'").get() as { value_json: string } | undefined;
  return row ? Number(JSON.parse(row.value_json)) || 0 : 0;
}

export function countNight(db: DB): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('nights_slept', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(nightsSlept(db) + 1));
}

const hhmm = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;

/**
 * Jef lies down: in the doss house bed (from 18:00, rent paid or not yet due), in his own room, or
 * rough wherever he is. He sleeps seven to eight game hours (shared/night.ts sleepMinutes: longer the
 * more tired) and wakes on his own; the date turns at midnight on the way (turnDay). The needs are
 * the night's, as before (M5). A job in hand stays in hand (M7 night: no job is lost to the night;
 * only its own deadline counts).
 */
export function sleep(db: DB, want: "bed" | "rough" | "home", home?: HomeNight, opts: { collapsed?: boolean } = {}): SleepResult {
  const p = player(db);
  const c = clock(db);
  // Sunday night: no rent, no bed (docs/01)
  const turnedAway = want === "bed" && c.day >= WEEK_DAYS && !rentPaid(db);
  const where = turnedAway ? "rough" : want === "home" && !home ? "rough" : want;
  const collapsed = !!opts.collapsed;
  const minutes = sleepMinutes(p.sleep);

  const summary: string[] = [];
  if (collapsed) summary.push(`At ${hhmm(c.hour, c.minute)} your legs give way. You sleep where you drop.`);
  else summary.push(`You lie down at ${hhmm(c.hour, c.minute)}.`);
  // the day behind him, when he lies down in the evening (after midnight the new date has barely begun)
  if (c.hour >= 12) {
    const jobsDone = (db.prepare("SELECT COUNT(*) n FROM log WHERE day = ? AND verb = 'finished_job'").get(c.day) as { n: number }).n;
    // every meal: from the pocket, at a counter (ate), at a family's table (supper)
    const meals = (db.prepare("SELECT COUNT(*) n FROM log WHERE day = ? AND verb IN ('ate', 'supper')").get(c.day) as { n: number }).n;
    const earned = p.money_c - startOfDayMoney(db);
    summary.push(
      jobsDone ? `You worked ${jobsDone} job${jobsDone > 1 ? "s" : ""} today.` : "You found no work today.",
      earned > 0 ? `You are ${earned} centimes richer than this morning.` : earned < 0 ? `You spent ${-earned} centimes more than you earned.` : "You have what you had this morning.",
      meals ? `You ate ${meals} time${meals > 1 ? "s" : ""}.` : "You ate nothing.",
    );
  }

  let robbed: SleepResult["robbed"];
  db.transaction(() => {
    endRide(db); // nobody rides the omnibus in his sleep
    endRowNight(db); // nor rows: the waterman takes his boat back (M3j)
    if (where === "home" && home) {
      // M6 homes: your own room; the old food value decides the health, as in the doss house
      db.prepare(
        "UPDATE player SET sleep = 10, food = MAX(0, food - ?), warmth = MIN(10, warmth + ?), health = MIN(10, health + CASE WHEN food >= 3 THEN ? ELSE ? END) WHERE id = 1",
      ).run(home.food, home.warmth, home.healthFed, home.healthHungry);
      summary.push(home.text);
    } else if (where === "bed") {
      db.prepare("UPDATE player SET sleep = 10, food = MAX(0, food - 2), warmth = MIN(10, warmth + 3), health = MIN(10, health + CASE WHEN food >= 3 THEN 1 ELSE 0 END) WHERE id = 1").run();
      summary.push("You sleep in a bed of straw in the doss house, six men to the room. It is warm enough.");
    } else {
      db.prepare("UPDATE player SET sleep = 6, food = MAX(0, food - 2), warmth = MAX(0, warmth - 3), health = MAX(0, health - 2) WHERE id = 1").run();
      summary.push(
        turnedAway
          ? "The landlady will not open the door. No rent, no bed. You sleep on the quay under a tarpaulin, and the fog gets into your bones."
          : collapsed
            ? "You sleep on the cold stones in your coat, and the damp gets into your bones."
            : "You sleep rough under a tarpaulin, and the fog gets into your bones.",
      );
    }
    for (const h of SLEEP_HOOKS) {
      const r = h(db, { where, collapsed, hour: c.hour });
      if (!r) continue;
      summary.push(...r.lines);
      if (r.robbed) robbed = r.robbed;
    }
    if (where === "home" && home) log(db, "slept_home", home.id, `Jef slept in his own room, ${home.label}.`);
    else if (collapsed) log(db, "collapsed_asleep", null, "Jef dropped from tiredness in the street and slept where he fell.");
    else log(db, where === "bed" ? "slept" : "slept_rough", null, where === "bed" ? "Jef slept in the doss house." : "Jef slept rough.");
    countNight(db);
  })();

  // the time passes; the date turns at midnight on the way
  const passed = passTime(db, minutes);
  summary.push(...passed.lines);
  const w = clock(db);
  const wake = { day: w.day, hour: w.hour, minute: w.minute, weekday: w.weekday };
  const at = where === "home" && home ? { place: home.label, home: home.id } : {};
  const base = { where, turnedAway, day: w.day, slept_min: minutes, wake, turned: passed.turned, ...(collapsed ? { collapsed } : {}), ...(robbed ? { robbed } : {}), ...at } as const;
  const after = player(db);
  if (after.health === 0) return { ...base, summary: summary.filter(Boolean), ended: ending(db) ?? endGame(db, "health") };
  if (passed.ended) return { ...base, summary: summary.filter(Boolean), ended: passed.ended };
  summary.push(`You wake at ${hhmm(w.hour, w.minute)}, ${w.weekday}, after ${Math.floor(minutes / 60)} hours${minutes % 60 ? ` and ${minutes % 60} minutes` : ""}.`);
  return { ...base, summary: summary.filter(Boolean) };
}

/**
 * Memory fades at night (docs/04): every NPC memory and world fact loses one
 * point of weight (floor 1). Memories at weight 1 for three days are gone.
 */
export function consolidate(db: DB): void {
  const day = player(db).day;
  db.prepare("UPDATE npc_memory SET weight = MAX(1, weight - 1)").run();
  db.prepare("UPDATE world_fact SET weight = MAX(1, weight - 1)").run();
  db.prepare("DELETE FROM npc_memory WHERE weight = 1 AND day <= ?").run(day - 3);
  db.prepare("DELETE FROM world_fact WHERE weight = 1 AND day <= ?").run(day - 3);
}

export function payRent(db: DB): { paid: boolean; text: string } {
  if (rentPaid(db)) return { paid: false, text: "The landlady waves you off. \"Paid till Sunday. Go and work.\"" };
  const p = player(db);
  if (p.money_c < RENT_C) return { paid: false, text: sexed(db, `"${RENT_C} centimes for the week, lad, and you have ${p.money_c}. Sunday is Sunday."`) };
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ?, rent_paid_until = ? WHERE id = 1").run(RENT_C, WEEK_DAYS);
    log(db, "paid_rent", null, `Jef paid the week's rent at the doss house, ${RENT_C} centimes.`);
  })();
  return { paid: true, text: "The landlady counts it twice and bites one coin. \"Your bed till Sunday.\"" };
}

export function endGame(db: DB, kind: "week" | "health"): Ending {
  const e: Ending = { kind, day: clock(db).day };
  setEnding(db, e);
  log(db, kind === "health" ? "collapsed" : "week_over", null, kind === "health" ? "Jef's body gave out." : "The week is over.");
  return e;
}
