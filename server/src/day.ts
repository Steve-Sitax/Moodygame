import type { DB } from "./db.ts";
import { log, player } from "./game.ts";
import { remember } from "./npcs.ts";
import { spreadRumours } from "./town/rumours.ts";

// The day and the week (M5). The engine owns time and needs (docs/01, docs/03).
// A client says "time passed while I played" with a tick; the server decides how
// much, applies needs hour by hour, and ends the day at midnight at the latest.

/** One tick = 5 real seconds = 15 game minutes. 6:00 to midnight = 6 real minutes. */
export const TICK_MINUTES = 15;
export const TICK_EVERY_MS = 5000;
export const DAWN = 6;
export const BEDTIME = 18; // from this hour on you may go to bed
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
  storm: "a gale off the sea, rain in sheets, the river running high",
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

/** Set the day's weather (the morning roll, or the dev menu). */
export function setWeather(db: DB, w: Weather): Weather {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('weather', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(w),
  );
  return w;
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

/**
 * Needs for one game hour awake (engine numbers; eased 2026-09-23 after Steve
 * starved within minutes): food -1 every 6 h, sleep -1 every 3 h, warmth -1
 * every 5 h by day and every 3 h at night (20:00 to 7:00). Health -1 every 3 h
 * while any need is at 0; +1 every 4 h while all three are at 4 or more.
 */
export function applyHour(db: DB, hour: number): { healthZero: boolean } {
  const p = player(db);
  let { food, warmth, sleep, health } = p;
  if (hour % 6 === 0) food--;
  if (hour % 3 === 0) sleep--;
  const cold = hour >= 20 || hour < 7;
  if (cold ? hour % 3 === 0 : hour % 5 === 0) warmth--;
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
  return { cold: true };
}

export type TickResult = { advanced: boolean; night?: SleepResult; ended?: Ending };

/** Time passes while Jef plays. At most one tick per 4 s, whatever the client sends. */
export function tick(db: DB, now = Date.now()): TickResult {
  if (ending(db)) return { advanced: false };
  if (now - lastTickAt < TICK_EVERY_MS - 1000) return { advanced: false };
  lastTickAt = now;
  const c = clock(db);
  let minute = c.minute + TICK_MINUTES;
  let hour = c.hour;
  if (minute >= 60) {
    minute -= 60;
    hour++;
    db.prepare("UPDATE player SET hour = ?, minute = ? WHERE id = 1").run(hour, minute);
    const { healthZero } = applyHour(db, hour % 24);
    // M3e: an hour of talk in the town; rumours about Jef pass on
    spreadRumours(db);
    if (healthZero) return { advanced: true, ended: endGame(db, "health") };
    if (hour >= 24) return { advanced: true, night: sleep(db, "rough") };
  } else db.prepare("UPDATE player SET minute = ? WHERE id = 1").run(minute);
  return { advanced: true };
}

export interface SleepResult {
  where: "bed" | "rough";
  turnedAway: boolean;
  summary: string[];
  day: number;
  ended?: Ending;
}

function startOfDayMoney(db: DB): number {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'day_start_money'").get() as { value_json: string } | undefined;
  return row ? Number(JSON.parse(row.value_json)) : 50;
}

export function markDayStart(db: DB): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('day_start_money', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(player(db).money_c),
  );
}

/**
 * The night. In the doss house bed (after 18:00, rent paid or not yet due) or
 * rough on the quay. Needs change, memories fade, the day counter moves on.
 */
export function sleep(db: DB, want: "bed" | "rough"): SleepResult {
  const p = player(db);
  const c = clock(db);
  // Sunday night: no rent, no bed (docs/01)
  const turnedAway = want === "bed" && c.day >= WEEK_DAYS && !rentPaid(db);
  const where = turnedAway ? "rough" : want;

  const jobsDone = (db.prepare("SELECT COUNT(*) n FROM log WHERE day = ? AND verb = 'finished_job'").get(c.day) as { n: number }).n;
  const meals = (db.prepare("SELECT COUNT(*) n FROM log WHERE day = ? AND verb = 'ate'").get(c.day) as { n: number }).n;
  const earned = p.money_c - startOfDayMoney(db);
  const summary = [
    `${DAY_NAMES[(c.day - 1) % 7]} ends.`,
    jobsDone ? `You worked ${jobsDone} job${jobsDone > 1 ? "s" : ""}.` : "You found no work today.",
    earned > 0 ? `You are ${earned} centimes richer than this morning.` : earned < 0 ? `You spent ${-earned} centimes more than you earned.` : "You have what you had this morning.",
    meals ? `You ate ${meals} time${meals > 1 ? "s" : ""}.` : "You ate nothing.",
  ];

  db.transaction(() => {
    if (where === "bed") {
      db.prepare("UPDATE player SET sleep = 10, food = MAX(0, food - 2), warmth = MIN(10, warmth + 3), health = MIN(10, health + CASE WHEN food >= 3 THEN 1 ELSE 0 END) WHERE id = 1").run();
      summary.push(turnedAway ? "" : "You sleep in a bed of straw in the doss house, six men to the room. It is warm enough.");
    } else {
      db.prepare("UPDATE player SET sleep = 6, food = MAX(0, food - 2), warmth = MAX(0, warmth - 3), health = MAX(0, health - 2) WHERE id = 1").run();
      summary.push(
        turnedAway
          ? "The landlady will not open the door. No rent, no bed. You sleep on the quay under a tarpaulin, and the fog gets into your bones."
          : "You never made it home. You sleep on the quay under a tarpaulin, and the fog gets into your bones.",
      );
    }
    // a job still in hand at night is a job not done: the employer marks it failed
    const open = db.prepare("SELECT id, title, employer_npc FROM job WHERE status = 'taken'").all() as Array<{ id: number; title: string; employer_npc: string }>;
    for (const j of open) {
      db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(j.id);
      db.prepare("DELETE FROM item WHERE job_id = ?").run(j.id);
      log(db, "abandoned_job", String(j.id), `Jef left the job "${j.title}" undone when night fell.`);
      const boss = (db.prepare("SELECT name FROM npc WHERE id = ?").get(j.employer_npc) as { name: string } | undefined)?.name ?? "his employer";
      remember(db, j.employer_npc, `Jef took my job "${j.title}" and left it undone when night fell.`, 5, "seen", null, { gist: `Jef left a job for ${boss} undone`, tone: -1 });
    }
    if (open.length) summary.push(`You left ${open.length === 1 ? "a job" : open.length + " jobs"} undone. Nobody pays for that.`);
    log(db, where === "bed" ? "slept" : "slept_rough", null, where === "bed" ? "Jef slept in the doss house." : "Jef slept rough on the quay.");
    consolidate(db);
    // a night of talk in the taverns and over the back walls (M3e)
    for (let i = 0; i < 3; i++) spreadRumours(db);
  })();

  const after = player(db);
  if (after.health === 0) return { where, turnedAway, summary: summary.filter(Boolean), day: c.day, ended: endGame(db, "health") };
  if (c.day >= WEEK_DAYS) return { where, turnedAway, summary: summary.filter(Boolean), day: c.day, ended: endGame(db, "week") };

  db.prepare("UPDATE player SET day = day + 1, hour = ?, minute = 0 WHERE id = 1").run(DAWN);
  markDayStart(db);
  rollWeather(db);
  return { where, turnedAway, summary: summary.filter(Boolean), day: c.day + 1 };
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
  if (p.money_c < RENT_C) return { paid: false, text: `"${RENT_C} centimes for the week, lad, and you have ${p.money_c}. Sunday is Sunday."` };
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
