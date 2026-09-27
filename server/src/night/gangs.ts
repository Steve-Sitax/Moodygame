import { sexed } from "../player/profile.ts"; // M7 character: lines said to the player follow the profile
import type { DB } from "../db.ts";
import { clock, SLEEP_HOOKS, type SleepInfo } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { ITEMS } from "../trade.ts";
import { remember } from "../npcs.ts";
import { pid } from "../player/current.ts";
import { pstate, setPstate } from "../player/multi.ts";
import { resident } from "../town/store.ts";
import { gameMinute } from "../town/deeds.ts";
import { tipsy } from "../interiors/tavern.ts";
import { jefAt, peopleNear, syncFromClient } from "../director/actions.ts";
import { writeEvent } from "../director/eventlog.ts";
import { GANG_HOURS, inSpan } from "../../../shared/night.ts";
import { callGang, endCallsFor } from "../town/walkup.ts";

// M7 night (Steve 2026-09-25: "Nights are good for robbers and other shady events" ... "a risk of gangs
// that steal"). A small gang of three may step out of the dark and rob Jef: his purse, a thing from his
// pockets, the job's goods. The ENGINE rolls everything; no model number (docs/03 rule one) and no
// combat system (docs/08 #10: danger is narrated, chased off, or costs money). The chance, per tick
// at night, from what the client says it sees (a lit lamp near, on a quay, goods in his hands; the
// people and the police near come through the actions' sync) and what the server knows (the purse,
// how tipsy, a job parcel in the pocket). Jef answers: run, fight them off, shout for the watch, or
// pay; each an engine roll. Asleep rough in the street, a gang may go through his coat (SLEEP_HOOKS).

/** The chance a gang tries, per game hour, alone in a dark street at night (the engine's base). */
export const GANG_BASE_PER_HOUR = 0.12;
/** The most per game hour, whatever adds up. */
export const GANG_MAX_PER_HOUR = 0.55;
export const GANG_MULT = {
  /** within about 8 m of a lit gas lamp */
  lit: 0.35,
  /** on a quay, by the water */
  quay: 1.3,
  /** goods in his hands, or a job's parcel in his pocket */
  carrying: 1.8,
  /** tipsy 2 or 3; 4 (drunk) */
  tipsy: 1.5,
  drunk: 2,
  /** an agent of the police (or the water police) within POLICE_M */
  police: 0.1,
  /** nobody within CROWD_M; one or two; three or more */
  alone: 1.3,
  few: 0.8,
  crowd: 0.3,
  /** 150 centimes or more in his purse */
  purse: 1.2,
} as const;
export const POLICE_M = 35;
export const CROWD_M = 15;
/** At most this many tries a night, this far apart (game minutes). */
export const GANG_PER_NIGHT = 2;
export const GANG_GAP_MIN = 60;
/** A gang not answered within this (game minutes) goes off into the dark. */
export const GANG_WAIT_MIN = 20;
/** What they ask to leave him be: half his purse, in fives, 20 to 200 centimes. */
export const DEMAND_SHARE = 0.5;
export const DEMAND_MIN_C = 20;
export const DEMAND_MAX_C = 200;
/** What they take when they rob him: this share of the purse, at least their demand, at most ROB_MAX_C (what a man carries in his coat; the rest is sewn in or in his boot). */
export const ROB_SHARE = 0.7;
export const ROB_MAX_C = 500;
/** Health never falls below this from a gang (as the menace, families.ts). */
export const HEALTH_FLOOR = 1;
/** The engine's odds of each answer (added to by what is round him). */
export const ODDS = {
  run: 0.6,
  runCarrying: -0.25,
  runTipsy: -0.07,
  runTired: -0.2,
  runWeak: -0.15,
  fight: 0.3,
  fightStrong: 0.1,
  fightTipsy: -0.05,
  fightTired: -0.1,
  shout: 0.2,
  shoutLit: 0.15,
  shoutFew: 0.3,
  shoutPolice: 0.85,
} as const;
/** Asleep rough: the chance a gang finds him in the night; dropped where he stood by day; more if he dropped. */
export const ROUGH_NIGHT_CHANCE = 0.35;
export const ROUGH_DAY_CHANCE = 0.12;
export const ROUGH_COLLAPSED = 0.1;

/** Things a gang will not bother with, or cannot find (sewn in, a paper of no use to them). */
const NOT_TAKEN = new Set(["letter", "letters", "pawn_ticket", "medal", "newspaper", "velocipede_new", "velocipede_used", "velocipede_hire"]);

export interface GangFacts {
  x?: number;
  z?: number;
  lit?: boolean;
  quay?: boolean;
  indoors?: boolean;
  carrying?: boolean;
  people?: unknown;
}

export interface Gang {
  id: number;
  night: number;
  at_min: number;
  x: number;
  z: number;
  demand_c: number;
  members: number;
  status: "menace" | "over";
  /** What the client said when it came (for the odds of the answers). */
  lit: boolean;
  carrying: boolean;
  outcome?: GangOutcome;
  text?: string;
  /** M7 walk-up: the town's thieves who make up the gang (they come from their haunts); the rest walk in from out of sight. */
  lads?: string[];
}
export type GangHow = "run" | "fight" | "shout" | "pay" | "stand";
export type GangOutcome = "escaped" | "fought_off" | "scattered" | "paid" | "robbed";
export interface GangResult {
  outcome: GangOutcome;
  text: string;
  money_c: number;
  health_lost: number;
  things: string[];
  /** The client drops what Jef holds (he ran), or the gang takes it. */
  hands: "keep" | "drop" | "taken";
  /** A job failed: its goods went with the gang. */
  job_failed?: number;
}

interface GangState {
  gang: Gang | null;
  night: number;
  tries: number;
  last_min: number;
  next_id: number;
}
const EMPTY: GangState = { gang: null, night: 0, tries: 0, last_min: -1e9, next_id: 1 };

// (M8c: each player's own gang, tries and night: player_state 'gang'; the host's older world_state key until written)
function load(db: DB): GangState {
  const v = pstate<GangState>(db, "gang");
  return v ? { ...EMPTY, ...v } : { ...EMPTY };
}
function save(db: DB, s: GangState): void {
  setPstate(db, "gang", s);
}
export function clearGangs(db: DB): void {
  db.prepare("DELETE FROM world_state WHERE key = 'gang'").run();
  db.prepare("DELETE FROM player_state WHERE key = 'gang'").run();
}

/** The walk-up calls of a gang (the host's as before; a guest's apart, so two players' gang 1 are not one). */
const gangRef = (id: number) => (pid() === 1 ? `gang:${id}` : `gang:p${pid()}-${id}`);

/** Where the player stands: his own place (M8d: per player), else what his client says with the call. */
function standing(facts: GangFacts = {}): { x: number; z: number } | null {
  const at = jefAt();
  if (at) return at;
  const x = Number(facts.x);
  const z = Number(facts.z);
  return facts.x !== undefined && facts.z !== undefined && Number.isFinite(x) && Number.isFinite(z) ? { x, z } : null;
}

let dice: () => number = Math.random;
/** Test seam: the engine's dice for the gangs. */
export function setGangDice(f: (() => number) | null): void {
  dice = f ?? Math.random;
}

/** The night a moment belongs to (after midnight, the day before). */
const nightOf = (day: number, hour: number) => (hour < 5 ? day - 1 : day);

/** Who is round Jef now: an agent near, and how many grown people (the client's last sync). `at`: where he stands (a guest's). */
export function around(db: DB, at?: { x: number; z: number } | null): { police: boolean; people: number } {
  const jef = at === undefined ? standing() : at;
  if (!jef) return { police: false, people: 0 };
  let police = false;
  let people = 0;
  for (const p of peopleNear(jef.x, jef.z, Math.max(POLICE_M, CROWD_M))) {
    const r = resident(db, p.id);
    if (!r) continue;
    if ((r.trade === "police" || r.trade === "water_bailiff") && p.d <= POLICE_M) police = true;
    if (p.d <= CROWD_M && r.age >= 13) people++;
  }
  return { police, people };
}

function jobParcels(db: DB): Array<{ id: number; job_id: number; kind: string }> {
  return db.prepare("SELECT id, job_id, kind FROM item WHERE job_id IS NOT NULL AND player_id = ?").all(pid()) as Array<{ id: number; job_id: number; kind: string }>;
}

/** The chance per game hour now (the engine's formula; exported for the tests and the kit). */
export function gangChancePerHour(db: DB, f: { lit: boolean; quay: boolean; carrying: boolean }, at?: { x: number; z: number } | null): number {
  const p = player(db);
  const near = around(db, at);
  const t = tipsy(db);
  let c = GANG_BASE_PER_HOUR;
  if (f.lit) c *= GANG_MULT.lit;
  if (f.quay) c *= GANG_MULT.quay;
  if (f.carrying || jobParcels(db).length) c *= GANG_MULT.carrying;
  if (t >= 4) c *= GANG_MULT.drunk;
  else if (t >= 2) c *= GANG_MULT.tipsy;
  if (near.police) c *= GANG_MULT.police;
  c *= near.people === 0 ? GANG_MULT.alone : near.people <= 2 ? GANG_MULT.few : GANG_MULT.crowd;
  if (p.money_c >= 150) c *= GANG_MULT.purse;
  return Math.min(GANG_MAX_PER_HOUR, c);
}

/** The gang in the street now, if any. */
export function gangNow(db: DB): Gang | null {
  const s = load(db);
  const g = s.gang;
  if (!g || g.status !== "menace") return null;
  if (gameMinute(db) - g.at_min > GANG_WAIT_MIN) {
    s.gang = { ...g, status: "over" };
    save(db, s);
    endCallsFor(db, gangRef(g.id));
    return null;
  }
  return g;
}

/** When each player's client last rolled (real ms). */
const lastRollAt = new Map<number, number>();
/** Test helper. */
export function resetGangRoll(): void {
  lastRollAt.clear();
}

/**
 * The client, once a tick at night: where Jef is and what he sees. The engine rolls; a gang comes or
 * not. At most once per 9 real seconds (a tick), whatever the client sends.
 */
export function rollGang(db: DB, facts: GangFacts, now = Date.now(), force = false): Gang | null {
  // (M8d: each player's own place in the sync, the people he sees for all)
  syncFromClient({ x: facts.x, z: facts.z, people: facts.people }, now, db);
  const open = gangNow(db);
  if (open) return open;
  if (!force && now - (lastRollAt.get(pid()) ?? 0) < 9000) return null;
  lastRollAt.set(pid(), now);
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  if (!force && (!inSpan(h, GANG_HOURS) || facts.indoors)) return null;
  const s = load(db);
  const night = nightOf(c.day, c.hour);
  if (s.night !== night) {
    s.night = night;
    s.tries = 0;
  }
  const min = gameMinute(db);
  if (!force && (s.tries >= GANG_PER_NIGHT || min - s.last_min < GANG_GAP_MIN)) {
    save(db, s);
    return null;
  }
  const perHour = gangChancePerHour(db, { lit: !!facts.lit, quay: !!facts.quay, carrying: !!facts.carrying }, standing(facts));
  const perTick = 1 - Math.pow(1 - perHour, 5 / 60);
  if (!force && dice() >= perTick) return null;
  const money = player(db).money_c;
  const demand = Math.max(DEMAND_MIN_C, Math.min(DEMAND_MAX_C, Math.round((money * DEMAND_SHARE) / 5) * 5));
  const jef = standing(facts) ?? { x: Number(facts.x) || 0, z: Number(facts.z) || 0 };
  const g: Gang = { id: s.next_id, night, at_min: min, x: jef.x, z: jef.z, demand_c: demand, members: 3, status: "menace", lit: !!facts.lit, carrying: !!facts.carrying };
  // M7 walk-up: the lads are the town's thieves out in the dark near him (the engine picks, nearest first)
  g.lads = callGang(db, gangRef(g.id), jef, g.members);
  s.gang = g;
  s.next_id++;
  s.tries++;
  s.last_min = min;
  save(db, s);
  writeEvent(db, { kind: "theft", verb: "gang_menace", target: "player", x: g.x, z: g.z, text: `Three men stepped out of the dark and stopped Jef in the street, asking for ${demand} centimes.`, weight: 5 });
  return g;
}

/** Jef answers the gang: the engine rolls, the purse and the health move, the town will talk. */
export function resolveGang(db: DB, id: number, how: GangHow, facts: GangFacts = {}): GangResult {
  if (facts.x !== undefined) syncFromClient({ x: facts.x, z: facts.z, people: facts.people }, Date.now(), db); // (M8d: every player's)
  const s = load(db);
  const g = s.gang;
  if (!g || g.id !== id || g.status !== "menace") throw new GameError("nobody is stopping you now", 409);
  const p = player(db);
  const t = tipsy(db);
  const near = around(db, standing(facts) ?? (pid() === 1 ? undefined : { x: g.x, z: g.z }));
  const carrying = facts.carrying ?? g.carrying;
  const lit = facts.lit ?? g.lit;
  const tired = p.sleep <= 2;
  let res: GangResult;
  const roll = dice();
  if (how === "pay") {
    if (p.money_c >= g.demand_c) {
      db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(g.demand_c, pid());
      log(db, "paid_off", null, `Jef paid a gang ${g.demand_c} centimes in the street at night to leave him be.`);
      res = { outcome: "paid", text: sexed(db, `You count ${g.demand_c} centimes into a dirty palm. "Sensible lad." They melt back into the dark.`), money_c: g.demand_c, health_lost: 0, things: [], hands: "keep" };
    } else res = rob(db, g, 0, "Not enough in your purse. They go through your coat for the rest.");
  } else if (how === "run") {
    const odds = ODDS.run + (carrying ? ODDS.runCarrying : 0) + t * ODDS.runTipsy + (tired ? ODDS.runTired : 0) + (p.health <= 3 ? ODDS.runWeak : 0);
    if (roll < odds) {
      log(db, "escaped_gang", null, "Jef ran from a gang in the street at night and got away.");
      res = { outcome: "escaped", text: carrying ? "You drop what you carry and run. Boots behind you, then only your own breath. You got away." : "You run. Boots behind you, then only your own breath. You got away.", money_c: 0, health_lost: 0, things: [], hands: carrying ? "drop" : "keep" };
    } else res = rob(db, g, 1, "You run, but not fast enough. A foot hooks yours and you go down on the cobbles.");
  } else if (how === "fight") {
    const odds = ODDS.fight + (p.health >= 7 ? ODDS.fightStrong : 0) + t * ODDS.fightTipsy + (tired ? ODDS.fightTired : 0);
    if (roll < odds) {
      const hl = Math.max(0, Math.min(1, p.health - HEALTH_FLOOR));
      db.prepare("UPDATE player SET health = MAX(?, health - ?) WHERE id = ?").run(HEALTH_FLOOR, hl, pid());
      log(db, "fought_off_gang", null, "Jef stood his ground against a gang in the street at night; they thought better of it.");
      res = { outcome: "fought_off", text: "You square up and shove the first one back hard. They did not come for a man who pushes back: a curse, and they are gone. Your knuckles smart.", money_c: 0, health_lost: hl, things: [], hands: "keep" };
    } else res = rob(db, g, 2, "You shove the first one, but there are three. They put you down on the wet stones.");
  } else if (how === "shout") {
    const odds = near.police ? ODDS.shoutPolice : ODDS.shout + (lit ? ODDS.shoutLit : 0) + (near.people >= 1 ? ODDS.shoutFew : 0);
    if (roll < odds) {
      log(db, "shouted_off_gang", null, "Jef shouted for the watch and a gang in the street at night scattered.");
      res = { outcome: "scattered", text: near.police ? `"Watch! Watch!" A whistle answers at once, close by. The three are gone before the agent's lantern comes round the corner.` : `"Watch! Thieves!" A window goes up, a dog barks, someone shouts back. The three scatter into the alleys.`, money_c: 0, health_lost: 0, things: [], hands: "keep" };
    } else res = rob(db, g, 1, `"Watch!" Nobody comes. A hand over your mouth, and you are down.`);
  } else res = rob(db, g, 1, "You stand there too long. They do not ask twice.");

  s.gang = { ...g, status: "over", outcome: res.outcome, text: res.text };
  // M7 walk-up: the lads are free again (the client walks them off into the dark and lets them go)
  endCallsFor(db, gangRef(g.id));
  save(db, s);
  writeEvent(db, {
    kind: "theft",
    verb: `gang_${res.outcome}`,
    target: "player",
    x: g.x,
    z: g.z,
    text:
      res.outcome === "robbed"
        ? `A gang of three robbed Jef in the street at night${res.money_c ? ` of ${res.money_c} centimes` : ""}${res.things.length ? ` and ${res.things.join(", ")}` : ""}.`
        : res.outcome === "paid"
          ? `Jef paid a gang ${res.money_c} centimes to let him pass in the night.`
          : res.outcome === "escaped"
            ? "Jef outran a gang in the night streets."
            : res.outcome === "fought_off"
              ? "Jef shoved a gang off in the night streets; they went off."
              : "Jef shouted for the watch and a gang in the night streets scattered.",
    outcome: res.outcome,
    weight: res.outcome === "robbed" ? 7 : 5,
    data: { money_c: res.money_c, health_lost: res.health_lost, things: res.things },
  });
  return res;
}

/** They go through his coat: the purse, a thing or two, the job's goods. The engine's shares. */
function rob(db: DB, g: Gang, blow: number, lead: string): GangResult {
  const p = player(db);
  const taken = Math.min(p.money_c, ROB_MAX_C, Math.max(Math.min(g.demand_c, p.money_c), Math.round((p.money_c * ROB_SHARE) / 5) * 5));
  const hl = Math.max(0, Math.min(blow, p.health - HEALTH_FLOOR));
  const things: string[] = [];
  let failed: number | undefined;
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = MAX(0, money_c - ?), health = MAX(?, health - ?) WHERE id = ?").run(taken, HEALTH_FLOOR, hl, pid());
    // one thing of his own from the pockets (the engine's pick: the first they find)
    const mine = db.prepare("SELECT id, kind FROM item WHERE job_id IS NULL AND player_id = ? ORDER BY id").all(pid()) as Array<{ id: number; kind: string }>;
    const thing = mine.find((i) => !NOT_TAKEN.has(i.kind));
    if (thing) {
      db.prepare("DELETE FROM item WHERE id = ?").run(thing.id);
      things.push(ITEMS[thing.kind]?.name ?? thing.kind);
    }
    // a job's parcel in the pocket goes too: that job is lost
    const parcel = jobParcels(db)[0];
    if (parcel) failed = loseJob(db, parcel.job_id, "a gang took its goods from Jef in the night");
    log(db, "robbed", null, `A gang robbed Jef in the street at night${taken ? ` of ${taken} centimes` : ""}${things.length ? ` and ${things.join(", ")}` : ""}.`);
  })();
  const bits = [lead];
  bits.push(taken ? `When you get up, your purse is lighter by ${taken} centimes.` : "Your purse was empty; they spit and go.");
  if (things.length) bits.push(`${cap(things[0])} is gone too.`);
  if (failed !== undefined) bits.push("And the job's parcel with it.");
  return { outcome: "robbed", text: bits.join(" "), money_c: taken, health_lost: hl, things, hands: "taken", ...(failed !== undefined ? { job_failed: failed } : {}) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A job whose goods are gone: failed, its goods out of the pocket, the employer told. */
function loseJob(db: DB, jobId: number, why: string): number {
  const j = db.prepare("SELECT id, title, employer_npc, status FROM job WHERE id = ?").get(jobId) as { id: number; title: string; employer_npc: string; status: string } | undefined;
  db.prepare("DELETE FROM item WHERE job_id = ?").run(jobId);
  if (!j || j.status !== "taken") return jobId;
  db.prepare("UPDATE job SET status = 'failed' WHERE id = ?").run(jobId);
  log(db, "failed_job", String(jobId), `The job "${j.title}" was lost: ${why}.`);
  remember(db, j.employer_npc, `Jef lost my goods for "${j.title}" to thieves in the night.`, 5, "seen", null, { gist: "Jef was robbed of goods in his care", tone: -1 });
  return jobId;
}

/** Asleep rough in the street: a gang may go through his coat (a SLEEP_HOOKS entry for day.ts). */
export function robbedAsleep(db: DB, s: SleepInfo): { lines: string[]; robbed?: { money_c: number; things: string[] } } | null {
  if (s.where !== "rough") return null;
  const night = inSpan(s.hour, GANG_HOURS) || s.hour >= 18;
  let c = night ? ROUGH_NIGHT_CHANCE : ROUGH_DAY_CHANCE;
  if (s.collapsed) c += ROUGH_COLLAPSED;
  const near = around(db);
  if (near.police) c *= 0.2;
  else if (near.people >= 3) c *= 0.5;
  if (tipsy(db) >= 2) c *= 1.4;
  if (dice() >= Math.min(0.7, c)) return null;
  const p = player(db);
  const taken = Math.min(ROB_MAX_C, Math.round((p.money_c * 0.6) / 5) * 5);
  const things: string[] = [];
  const mine = db.prepare("SELECT id, kind FROM item WHERE job_id IS NULL AND player_id = ? ORDER BY id").all(pid()) as Array<{ id: number; kind: string }>;
  const thing = mine.find((i) => !NOT_TAKEN.has(i.kind));
  db.prepare("UPDATE player SET money_c = MAX(0, money_c - ?) WHERE id = ?").run(taken, pid());
  if (thing) {
    db.prepare("DELETE FROM item WHERE id = ?").run(thing.id);
    things.push(ITEMS[thing.kind]?.name ?? thing.kind);
  }
  const parcel = jobParcels(db)[0];
  if (parcel) loseJob(db, parcel.job_id, "it was taken from Jef's coat while he slept in the street");
  log(db, "robbed", null, `While Jef slept rough, someone went through his coat${taken ? ` and took ${taken} centimes` : ""}${things.length ? ` and ${things.join(", ")}` : ""}.`);
  writeEvent(db, { kind: "theft", verb: "robbed_asleep", target: "player", text: `Jef was robbed in his sleep in the street${taken ? ` of ${taken} centimes` : ""}.`, weight: 6 });
  const lines = [`In the night hands go through your coat. By the time you are awake enough to shout, they are gone${taken ? `, and ${taken} centimes with them` : ""}.`];
  if (things.length) lines.push(`${cap(things[0])} is gone too.`);
  if (parcel) lines.push("The job's parcel is gone.");
  return { lines, robbed: { money_c: taken, things } };
}
SLEEP_HOOKS.push(robbedAsleep);
