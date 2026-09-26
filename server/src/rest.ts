import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DB } from "./db.ts";
import { ROOT } from "./config.ts";
import { GameError, log } from "./game.ts";
import {
  clock,
  countNight,
  endGame,
  ending,
  passTime,
  RESTING,
  rentPaid,
  SLEEP_HOOKS,
  WARMTH,
  WEEK_DAYS,
  WHERE,
  type DayTurn,
  type Ending,
  type HomeNight,
  type TickResult,
} from "./day.ts";
import { endRide } from "./ride.ts";
import { endRowNight } from "./rowing.ts";
import { spreadRumours } from "./town/rumours.ts";
import { homeBed } from "./homes/homes.ts";
import { TICK_EVERY_MS, TICK_MINUTES } from "../../shared/clock.ts";
import { inSpan, type Span } from "../../shared/night.ts";
import { doorBenchAt, fixedBenches, MORNING_HOUR, type Bench, type RestKind } from "../../shared/sleep.ts";
import { STOPS } from "../../shared/omnibusLines.ts";
import TOWNPLACES from "../../shared/townplaces.json" with { type: "json" };
import CITY from "../../shared/city.json" with { type: "json" };

// M7 sleep (Steve 2026-09-26, docs/milestones/M7-sleep.md): Jef sleeps when he chooses and as long as he
// chooses, in a bed (his own rented room, or the doss house bed he pays by the week) or on a bench, never on
// the bare stones (only a man dead on his feet still drops where he stands: day.ts tick). The client asks to
// lie down with how long; the ENGINE checks the place (his lease, the doss house's rent, a bench that exists,
// near where he stands, nobody else on it) and clamps the hours. The time then passes in steps on the
// client's ticks (the town, the events and the date go on as they always do), the needs by the hours slept.
// Any key wakes him: the server counts only the time slept. Kept by player id (multiplayer later).

/** The engine's numbers for a sleep. */
export const SLEEP = {
  /** In a bed: sleep +1.25 an hour, up to 10 (8 hours from nothing to full). */
  bed: { perHour: 1.25, cap: 10 },
  /** On a bench: sleep +0.6 an hour, up to 6. */
  bench: { perHour: 0.6, cap: 6 },
  /** Asleep, food goes down slower than awake (-1 every 6 h): -1 every 8 h. */
  foodEveryH: 8,
  /** Lying down on a bench: warmth falls to this at once (the cold of the iron and the night air), then the outside rules. */
  benchWarmth: 1,
  /** The doss house bed over a whole night (8 h): warmth +3, health +1 if fed (as the M5 night). A home: its own night (homeNight). */
  doss: { warmth: 3, healthFed: 1, healthHungry: 0 },
  /** A whole night: the bed's warmth and health gains are per this many hours slept. */
  nightH: 8,
  /** A forged or odd length: whole hours, clamped to this. "Until morning" is at most a day. */
  minH: 1,
  maxH: 12,
  /** How far Jef may stand from the bench (m), and from the doss house step. */
  benchReach: 2.0,
  dossReach: 4.0,
  /** His word for where he stands may not be further than this from his last report (m, while it is fresh), and this much
   *  more for each second since (a velocipede, the omnibus: ticks come every 10 s). */
  drift: 40,
  driftPerS: 8,
  posTtlMs: 25_000,
  /** All asleep (single player): each step passes this much game time, at most this often (real ms). */
  stepMin: 30,
  stepEveryMs: 300,
  /** A sleep this long counts as a night (the dream: director/familyRoutes.ts). */
  nightMin: 240,
  /** On a bench in a fine square or the park at night: each game hour the police move him on with this chance. */
  police: 0.3,
  policeHours: [22, 29] as Span,
} as const;

/** One player now; multiplayer later: the players online (docs/multiplayer-plan.md 6.1). */
const PLAYER = 1;
const online = (): number[] => [PLAYER];

type Needs = { sleep: number; food: number; warmth: number; health: number };

interface Rest {
  player: number;
  kind: RestKind;
  label: string;
  home?: string;
  night?: HomeNight;
  bench?: Bench;
  planned: number;
  slept: number;
  acc: Needs;
  lines: string[];
  turned: boolean;
  robRolled: boolean;
  lastStepAt: number;
  from: { hour: number; minute: number };
  robbed?: { money_c: number; things: string[] };
}

/** What the client shows while he sleeps. */
export interface RestView {
  place: RestKind;
  label: string;
  bench?: string;
  home?: string;
  planned_min: number;
  slept_min: number;
  from: { hour: number; minute: number };
  now: { day: number; hour: number; minute: number; weekday: string };
}

/** How a sleep ended. */
export interface RestEnd {
  place: RestKind;
  label: string;
  home?: string;
  bench?: string;
  /** rested: the hours he chose; up: he woke (a key); police: moved on; robbed: hands in his coat; ended: the week or his body. */
  reason: "rested" | "up" | "police" | "robbed" | "ended";
  slept_min: number;
  planned_min: number;
  lines: string[];
  wake: { day: number; hour: number; minute: number; weekday: string };
  turned: boolean;
  ended?: Ending;
  robbed?: { money_c: number; things: string[] };
}

const rests = new Map<number, Rest>();

/** Is this player asleep now (the pause, the kit and the tick ask)? */
export function restOf(db: DB, playerId = PLAYER): RestView | null {
  const r = rests.get(playerId);
  return r ? viewOf(db, r) : null;
}

/** A new week, a loaded save: nobody is asleep. */
export function clearRests(): void {
  rests.clear();
  seen.clear();
}

/**
 * Multiplayer later (docs/multiplayer-plan.md 6.1): the night passes at once only when every player online
 * is asleep; one alone in bed sleeps at the world's pace (the ordinary tick) while the others play. One player
 * now: he is everyone.
 */
export function allAsleep(): boolean {
  return online().every((id) => rests.has(id));
}

// ------------------------------------------------------------------ where he stands

const seen = new Map<number, { x: number; z: number; ms: number }>();
const Pos = z.object({ x: z.number().finite(), z: z.number().finite(), y: z.number().finite().optional() });

/** The client's word for where Jef stands, with each tick (for the plausibility check of a sleep's place). */
export function reportPos(body: unknown, now = Date.now(), playerId = PLAYER): void {
  const r = Pos.safeParse(body);
  if (r.success) seen.set(playerId, { x: r.data.x, z: r.data.z, ms: now });
}

// ------------------------------------------------------------------ the benches

let registry: Bench[] | null = null;

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** The wall walk's benches from wall.glb's dressing (the glTF's JSON chunk; world/rampart.ts reads the same). */
function wallBenches(file: string): Array<{ x: number; z: number; y: number }> {
  try {
    const b = fs.readFileSync(file);
    if (b.readUInt32LE(0) !== 0x46546c67) return [];
    const len = b.readUInt32LE(12);
    const gltf = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as { nodes?: Array<{ name?: string; extras?: { dressing?: string } }> };
    const node = gltf.nodes?.find((n) => n.name === "wall_dressing");
    const d = node?.extras?.dressing ? (JSON.parse(node.extras.dressing) as { benches?: Array<{ x: number; z: number; y: number }> }) : null;
    return (d?.benches ?? []).map((q) => ({ x: q.x, z: q.z, y: q.y }));
  } catch {
    return [];
  }
}

/** Every public bench with a fixed place (shared/sleep.ts fixedBenches), read once. */
export function benches(): Bench[] {
  if (registry) return registry;
  const models = path.join(ROOT, "client", "public", "models");
  const park = readJson<{ benches?: Array<Array<[number, number]>> }>(path.join(models, "park.json"))?.benches ?? [];
  registry = fixedBenches({ townplaces: TOWNPLACES as never, stops: STOPS, park, wall: wallBenches(path.join(models, "wall.glb")) });
  return registry;
}

/** The bench an id names: a fixed one, or a bench by a house door (named by where it stands). */
export function benchById(id: string): Bench | null {
  const fixed = benches().find((b) => b.id === id);
  if (fixed) return fixed;
  const at = doorBenchAt(id);
  return at ? { id, label: "a bench by a house door", x: at.x, z: at.z, y: 0, fine: false } : null;
}

/** The doss house step (the client's DOSS_POS: 1.2 m out of its door). */
function dossStep(): { x: number; z: number } {
  const d = (CITY as unknown as { doors: Record<string, { x: number; z: number; out: [number, number] }> }).doors.doss;
  return { x: d.x + d.out[0] * 1.2, z: d.z + d.out[1] * 1.2 };
}

// ------------------------------------------------------------------ lying down

const Start = z.object({
  place: z.enum(["home", "doss", "bench"]),
  bench: z
    .string()
    .max(60)
    .regex(/^[a-z0-9_:.,-]+$/i)
    .optional(),
  hours: z.union([z.number().finite(), z.literal("morning")]),
  pos: Pos.optional(),
});

/** Minutes from now until the next MORNING_HOUR (never 0: at 6:00 sharp it is the next day's). */
export function toMorning(c: { hour: number; minute: number }): number {
  const m = MORNING_HOUR * 60 - (c.hour * 60 + c.minute);
  return m > 0 ? m : m + 1440;
}

/** The chooser's length in game minutes: whole hours clamped to 1..12, or until morning. */
export function plannedMinutes(hours: number | "morning", c: { hour: number; minute: number }): number {
  if (hours === "morning") return toMorning(c);
  return Math.max(SLEEP.minH, Math.min(SLEEP.maxH, Math.round(hours))) * 60;
}

const near = (a: { x: number; z: number }, b: { x: number; z: number }, r: number) => Math.hypot(a.x - b.x, a.z - b.z) <= r;

/**
 * Jef lies down (POST /api/sleep): the place checked, the hours clamped. A bench takes his warmth down to 1
 * at once. Returns what the client shows while the time passes (rest steps on the ticks).
 */
export function startRest(db: DB, body: unknown, now = Date.now(), playerId = PLAYER): RestView {
  if (ending(db)) throw new GameError("the week is over", 409);
  const b = Start.safeParse(body);
  if (!b.success) throw new GameError("place must be home, doss or bench, with hours 1 to 12 or morning", 400);
  const q = b.data;
  if (rests.has(playerId)) throw new GameError("you are asleep already", 409);
  const pos = q.pos ?? null;
  // his word for where he stands, against his last report with a tick (fresh): no sleeping across town
  const last = seen.get(playerId);
  if (pos && last && now - last.ms < SLEEP.posTtlMs && !near(pos, last, SLEEP.drift + (SLEEP.driftPerS * (now - last.ms)) / 1000)) throw new GameError("you are not there", 409);
  const c = clock(db);
  const planned = plannedMinutes(q.hours, c);
  let rest: Rest;
  const base = { player: playerId, planned, slept: 0, acc: { sleep: 0, food: 0, warmth: 0, health: 0 }, lines: [], turned: false, robRolled: false, lastStepAt: 0, from: { hour: c.hour, minute: c.minute } };
  if (q.place === "home") {
    const { home, night } = homeBed(db);
    // his own room: the server's word for where he is (the tick's report, checked in warmth.ts)
    if (WHERE.now(db).place !== `home:${home.id}`) throw new GameError("you are not in your room", 409);
    rest = { ...base, kind: "home", label: home.label, home: home.id, night };
  } else if (q.place === "doss") {
    // Sunday night: no rent, no bed (docs/01)
    if (c.day >= WEEK_DAYS && !rentPaid(db)) throw new GameError("The landlady will not open the door. \"No rent, no bed. Sunday is Sunday.\"", 409);
    if (!pos || !near(pos, dossStep(), SLEEP.dossReach)) throw new GameError("you are not at the doss house", 409);
    rest = { ...base, kind: "doss", label: "the doss house, Sint-Andries" };
  } else {
    const bench = q.bench ? benchById(q.bench) : null;
    if (!bench) throw new GameError("no such bench", 400);
    // up on the wall walk (6.5 m): his feet must be up there too; the street benches stand on the ground wherever it lies
    const up = bench.y > 1 && (pos?.y === undefined || Math.abs(pos.y - bench.y) > 1.5);
    if (!pos || !near(pos, bench, SLEEP.benchReach) || up) throw new GameError("that bench is too far off", 409);
    for (const o of rests.values()) if (o.bench?.id === bench.id) throw new GameError("someone is asleep on that bench", 409);
    rest = { ...base, kind: "bench", label: bench.label, bench };
  }
  db.transaction(() => {
    endRide(db); // nobody rides the omnibus in his sleep
    endRowNight(db); // nor rows: the waterman takes his boat back (M3j)
    if (rest.kind === "bench") db.prepare("UPDATE player SET warmth = MIN(warmth, ?) WHERE id = ?").run(SLEEP.benchWarmth, playerId);
  })();
  rests.set(playerId, rest);
  return viewOf(db, rest);
}

// ------------------------------------------------------------------ the time passes

let dice: () => number = Math.random;
/** Test seam: the police's dice on a fine bench. */
export function setRestDice(f: (() => number) | null): void {
  dice = f ?? Math.random;
}

function needsOf(db: DB, pid: number): Needs {
  return db.prepare("SELECT sleep, food, warmth, health FROM player WHERE id = ?").get(pid) as Needs;
}

/** The needs for `min` minutes asleep: sleep by the place, food slower than awake, a bed's warmth and health. */
function restNeeds(db: DB, r: Rest, min: number): void {
  const h = min / 60;
  const n = needsOf(db, r.player);
  const rate = r.kind === "bench" ? SLEEP.bench : SLEEP.bed;
  const bed = r.kind !== "bench";
  const night = r.kind === "home" && r.night ? { warmth: r.night.warmth, healthFed: r.night.healthFed, healthHungry: r.night.healthHungry } : SLEEP.doss;
  if (n.sleep < rate.cap) r.acc.sleep += rate.perHour * h;
  r.acc.food += h / SLEEP.foodEveryH;
  if (bed) {
    r.acc.warmth += (night.warmth / SLEEP.nightH) * h;
    r.acc.health += ((n.food >= 3 ? night.healthFed : night.healthHungry) / SLEEP.nightH) * h;
  }
  const take = (k: keyof Needs) => {
    const whole = Math.floor(r.acc[k] + 1e-9);
    r.acc[k] -= whole;
    return whole;
  };
  const sleep = n.sleep >= rate.cap ? n.sleep : Math.min(rate.cap, n.sleep + take("sleep"));
  const food = Math.max(0, n.food - take("food"));
  const warmth = Math.min(10, n.warmth + take("warmth"));
  const health = Math.min(10, n.health + take("health"));
  db.prepare("UPDATE player SET sleep = ?, food = ?, warmth = ?, health = ? WHERE id = ?").run(sleep, food, warmth, health, r.player);
}

/** Once a game hour asleep: the cold on a bench, the cost of a need at 0, the town's talk, the police on a fine square. */
function restHour(db: DB, r: Rest, hour: number): void {
  const n = needsOf(db, r.player);
  let { warmth, health } = n;
  if (r.kind === "bench") {
    // the outside rule on foot (applyHour), no lantern in a sleeping hand
    const cold = hour >= 20 || hour < 7;
    if (hour % (cold ? WARMTH.night : WARMTH.day) === 0) warmth = Math.max(0, warmth - 1);
  }
  if ((n.food === 0 || warmth === 0 || n.sleep === 0) && hour % 3 === 0) health = Math.max(0, health - 1);
  db.prepare("UPDATE player SET warmth = ?, health = ? WHERE id = ?").run(warmth, health, r.player);
  spreadRumours(db);
}

/**
 * One step of a sleep, on a tick (day.ts tick calls it through RESTING). `asleep`: the client is in its sleep
 * (the fade); a tick without it means he is up (a reload, another tab): the sleep ends there.
 */
export function restStep(db: DB, now: number, asleep: boolean, playerId = PLAYER): TickResult | null {
  const r = rests.get(playerId);
  if (!r) return null;
  if (!asleep) return { advanced: false, woke: endRest(db, r, "up") };
  // all asleep: the night passes fast; otherwise (multiplayer later) at the world's pace, as a tick
  const fast = allAsleep();
  if (now - r.lastStepAt < (fast ? SLEEP.stepEveryMs : TICK_EVERY_MS - 1000)) return { advanced: false, rest: viewOf(db, r) };
  r.lastStepAt = now;
  let left = Math.min(fast ? SLEEP.stepMin : TICK_MINUTES, r.planned - r.slept);
  let turned: DayTurn | undefined;
  let ended: Ending | undefined;
  let why: RestEnd["reason"] | null = null;
  db.transaction(() => {
    while (left > 0 && !why) {
      const c = clock(db);
      const toHour = 60 - c.minute;
      const piece = Math.min(left, toHour);
      const passed = passTime(db, piece);
      r.slept += piece;
      left -= piece;
      if (passed.turned) {
        r.turned = true;
        r.lines.push(...passed.lines);
        turned = { day: clock(db).day, lines: passed.lines };
      }
      if (passed.ended) {
        ended = passed.ended;
        why = "ended";
        break;
      }
      restNeeds(db, r, piece);
      if (piece === toHour) {
        const h = clock(db).hour;
        restHour(db, r, h);
        if (r.bench?.fine && inSpan(h, SLEEP.policeHours) && dice() < SLEEP.police) {
          r.lines.push("A policeman taps your boots with his stick. \"Not here, friend. The benches are for the day. Move along.\"");
          why = "police";
        }
      }
      if (needsOf(db, r.player).health === 0) {
        ended = ending(db) ?? endGame(db, "health");
        why = "ended";
      }
    }
    // half way through: the night's other work may find a sleeper (night/gangs.ts: hands in a coat on a bench)
    if (!why && !r.robRolled && r.slept * 2 >= r.planned) {
      r.robRolled = true;
      const where = r.kind === "bench" ? "rough" : r.kind === "home" ? "home" : "bed";
      for (const hook of SLEEP_HOOKS) {
        const got = hook(db, { where, collapsed: false, hour: clock(db).hour });
        if (!got) continue;
        r.lines.push(...got.lines);
        if (got.robbed) {
          r.robbed = got.robbed;
          why = "robbed";
        }
      }
    }
  })();
  if (!why && r.slept >= r.planned) why = "rested";
  const out: TickResult = { advanced: true, ...(turned ? { turned } : {}), ...(ended ? { ended } : {}) };
  if (why) out.woke = endRest(db, r, why, ended);
  else out.rest = viewOf(db, r);
  return out;
}

/** He wakes (a key: POST /api/sleep/wake): only the time slept counts. Null when he was not asleep. */
export function wakeRest(db: DB, playerId = PLAYER): RestEnd | null {
  const r = rests.get(playerId);
  return r ? endRest(db, r, "up") : null;
}

const hhmm = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;
function lasted(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} minutes`;
  return `${h} hour${h > 1 ? "s" : ""}${m ? ` and ${m} minutes` : ""}`;
}

function endRest(db: DB, r: Rest, reason: RestEnd["reason"], ended?: Ending): RestEnd {
  rests.delete(r.player);
  const c = clock(db);
  const long = r.slept >= SLEEP.nightMin;
  const lines: string[] = [];
  if (r.kind === "home") lines.push(long && r.night ? r.night.text : `You doze on your own bed in ${r.label}.`);
  else if (r.kind === "doss") lines.push(long ? "You sleep on the straw in the doss house, six men to the room. It is warm enough." : "You doze on the straw in the doss house among the snorers.");
  else lines.push(`You sleep on ${r.label} in your coat, and the cold gets into your bones.`);
  lines.push(...r.lines);
  if (!ended) lines.push(r.slept ? `You slept ${lasted(r.slept)}. It is ${hhmm(c.hour, c.minute)}, ${c.weekday}.` : "You get up again before you are asleep.");
  if (r.slept > 0) {
    if (r.kind === "home") log(db, "slept_home", r.home ?? null, `Jef slept ${lasted(r.slept)} in his own room, ${r.label}.`);
    else if (r.kind === "doss") log(db, "slept", null, `Jef slept ${lasted(r.slept)} in the doss house.`);
    else log(db, "slept_rough", r.bench?.id ?? null, `Jef slept ${lasted(r.slept)} on ${r.label}.`);
  }
  if (long) countNight(db);
  return {
    place: r.kind,
    label: r.label,
    ...(r.home ? { home: r.home } : {}),
    ...(r.bench ? { bench: r.bench.id } : {}),
    reason,
    slept_min: r.slept,
    planned_min: r.planned,
    lines,
    wake: { day: c.day, hour: c.hour, minute: c.minute, weekday: c.weekday },
    turned: r.turned,
    ...(ended ? { ended } : {}),
    ...(r.robbed ? { robbed: r.robbed } : {}),
  };
}

function viewOf(db: DB, r: Rest): RestView {
  const now = clock(db);
  return {
    place: r.kind,
    label: r.label,
    ...(r.bench ? { bench: r.bench.id } : {}),
    ...(r.home ? { home: r.home } : {}),
    planned_min: r.planned,
    slept_min: r.slept,
    from: r.from,
    now: { day: now.day, hour: now.hour, minute: now.minute, weekday: now.weekday },
  };
}

/** Wire the rest into the tick (day.ts RESTING). */
RESTING.step = (db, now, asleep) => restStep(db, now, asleep);
