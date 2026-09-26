import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { settleExtras } from "../game.ts";
import { actionHooks, actionOf, activeActions, endAction, isReserved, jefAt, peopleNear, posOf, startAction, type ActionRow } from "../director/actions.ts";
import type { Resident } from "./population.ts";
import type { TradeId } from "./places.ts";
import { resident, town } from "./store.ts";
import { nowOf } from "./talk.ts";
import { walkMap } from "./walkmap.ts";

// M7 walk-up (Steve, 2026-09-26: "when doing fetching jobs, a person always pops out of nowhere. Now it
// is customs. Those people should always be around and walk up, or run if they think it is urgent ...
// customs, police or even thieves linger around and come up or follow when they know you do a quest").
//
// The people a job or a quest needs come from the living town: a customs officer on his beat, an agent
// on his round, a thief loitering at the market or in his haunt, a natie man at the quay. When a job
// needs one, the ENGINE picks the nearest fitting person who is plausible (on duty or out in the street,
// not in an event, an errand or a talk of their own, reachable on foot from where Jef needs them) and
// reserves them with an action row (kind "come"); the client walks them up from where they are, at a
// run when the engine says it is urgent. Nobody near enough: the answer is "wait" (the scene starts
// when someone comes), and the client asks again within its time cap. The model never picks a person
// or a moment: it only words the scene (ideas/trouble.ts), as before.
//
// Followers ("shadow"): a thief who sees Jef take a valuable load, or a customs officer who sees a load
// no honest man carries at that hour, may follow him at a distance; the engine's rules (shadowStep)
// say when he keeps his distance, lingers at a corner, closes in (dark or quiet), or breaks off
// (no load any more, or an agent of the police in sight).

export type CallRole = "customs" | "police" | "thief" | "gang" | "hand" | "rival";
export const CALL_ROLES: readonly CallRole[] = ["customs", "police", "thief", "gang", "hand", "rival"];
/** Why they come: the engine's urgency follows from it (never the client's word alone). */
export type CallWhy = "trouble" | "twist" | "crime" | "contraband" | "gang" | "shadow";
export const CALL_WHYS: readonly CallWhy[] = ["trouble", "twist", "crime", "contraband", "gang", "shadow"];

/** Who fits a role (trades). */
export const ROLE_TRADES: Record<CallRole, readonly TradeId[]> = {
  customs: ["customs"],
  police: ["police"],
  thief: ["thief"],
  gang: ["thief"],
  // the employer's man, the tally man, an old hand
  hand: ["natie", "docker", "porter"],
  rival: ["docker", "natie"],
};

/** Called from at most this far (straight line, metres): further off, the job waits or goes on without them. */
export const CALL_MAX_M = 320;
/** A gang is made of the lads within this of Jef (the night roll). */
export const GANG_CALL_M = 220;
/** The "come" row lives this long at most (game minutes; the client ends it long before). */
export const COME_MIN = 120;
/** How long a job waits for someone to come (real seconds, the client's cap), then it goes on without. */
export const WAIT_CAP_S = 90;

/** Followers: the gap they keep (metres), how close "close in" gets, the sight of an agent. */
export const SHADOW_GAP: readonly [number, number] = [12, 25];
export const SHADOW_SEE_M = 40;
export const POLICE_SIGHT_M = 35;
/** "Quiet": at most this many other people within QUIET_M of Jef. */
export const QUIET_M = 15;
export const QUIET_MAX = 1;
/** At most one follower at a time; a job is rolled once. */
export const SHADOW_AT_ONCE = 1;
/** Goods a thief would follow a man for (a parcel is always worth a look), and his chance by day and by night. */
export const VALUABLE: ReadonlySet<string> = new Set(["parcel", "chests", "tobacco", "coffee", "hides", "barrels"]);
export const SHADOW_CHANCE = { day: 0.35, night: 0.6 } as const;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ who may come

/** Is this person plausible for the role now: on duty, or out in the street for the loose roles. */
export function onDutyFor(db: DB, r: Resident, role: CallRole): boolean {
  if (!ROLE_TRADES[role].includes(r.trade)) return false;
  if (r.age < 16 || r.age > 66) return false;
  const now = nowOf(db, r);
  switch (role) {
    case "customs":
    case "police":
      return now.act === "work";
    case "thief":
      return now.act !== "home" && now.act !== "church";
    case "gang":
      // (the three who step out of the dark are men)
      return r.sex === "m" && now.act !== "home" && now.act !== "church";
    case "hand":
    case "rival":
      return r.age >= 18 && (now.act === "work" || now.act === "loiter" || now.act === "tavern");
  }
}

/** Not busy: no action of their own, not reserved (an event, the police visit, a post, a talk hook). */
export function isFree(db: DB, id: string): boolean {
  return !actionOf(db, id) && !isReserved(db, id);
}

/**
 * Both ends on ground you can walk to from the start (so there is a way between them: always a path).
 * The person must stand on the walk map (4 m); where they are needed may be a little off it (a pier's
 * head, a deck, a step: they come to the nearest open ground within 12 m).
 */
export function reachableBetween(person: { x: number; z: number }, need: { x: number; z: number }): boolean {
  const wm = walkMap();
  return !!wm.nearestOpen(person.x, person.z, 4) && !!wm.nearestOpen(need.x, need.z, 12);
}

export interface Candidate {
  r: Resident;
  x: number;
  z: number;
  d: number;
}

/**
 * The fitting people for a role, nearest to `at` first: plausible now, free, out of doors (or on
 * duty), within `maxM`, and reachable on foot. The engine's only picker for job and quest people.
 */
export function candidates(db: DB, role: CallRole, at: { x: number; z: number }, opts: { maxM?: number; exclude?: readonly string[] } = {}): Candidate[] {
  const maxM = opts.maxM ?? CALL_MAX_M;
  const ex = new Set(opts.exclude ?? []);
  const out: Candidate[] = [];
  for (const r of town(db).town.residents) {
    if (ex.has(r.id) || !ROLE_TRADES[role].includes(r.trade)) continue;
    if (!onDutyFor(db, r, role)) continue;
    const p = posOf(db, r.id);
    if (!p) continue;
    // indoors at the door of a tavern is "in the street" for a thief; indoors at home never
    if (p.indoors && role !== "thief" && role !== "gang") continue;
    const d = dist(p, at);
    if (d > maxM) continue;
    if (!isFree(db, r.id)) continue;
    if (!reachableBetween(p, at)) continue;
    out.push({ r, x: p.x, z: p.z, d });
  }
  return out.sort((a, b) => a.d - b.d);
}

export function pickResponder(db: DB, role: CallRole, at: { x: number; z: number }, opts: { maxM?: number; exclude?: readonly string[] } = {}): Candidate | null {
  return candidates(db, role, at, opts)[0] ?? null;
}

/** Urgent (they run): the police to a crime, customs catching contraband, a gang closing in, a thief on the bolt. */
export function urgentFor(role: CallRole, why: CallWhy): boolean {
  if (why === "gang") return true;
  if (role === "police" && why === "crime") return true;
  if (role === "customs" && why === "contraband") return true;
  return false;
}

// ------------------------------------------------------------------ the call

export interface CallReq {
  role: CallRole;
  why: CallWhy;
  /** What it is for (one call per ref: "trouble:12", "job:7:thief"); a repeat returns the same person. */
  ref: string;
  /** Where they are needed (Jef, the post, the drop). */
  at: { x: number; z: number };
  exclude?: readonly string[];
  maxM?: number;
}

export type CallResult =
  | { ok: true; npc: string; name: string; action: number; urgent: boolean; d: number; again?: boolean }
  | { ok: false; wait: true; why: string };

interface ComeData {
  role?: CallRole;
  why?: CallWhy;
  ref?: string;
  urgent?: boolean;
}
const comeData = (a: ActionRow): ComeData => {
  try {
    return JSON.parse(a.data_json) as ComeData;
  } catch {
    return {};
  }
};

/** The active "come" rows (the people walking up for a job now). */
export function comings(db: DB): ActionRow[] {
  return activeActions(db).filter((a) => a.kind === ("come" as ActionRow["kind"]));
}

export function comingFor(db: DB, ref: string): ActionRow[] {
  return comings(db).filter((a) => comeData(a).ref === ref);
}

/** Pick the nearest fitting person and send them (a "come" row); or say wait. */
export function callResponder(db: DB, req: CallReq): CallResult {
  if (!CALL_ROLES.includes(req.role) || !CALL_WHYS.includes(req.why)) return { ok: false, wait: true, why: "no such role" };
  const ref = String(req.ref).slice(0, 60);
  const had = comingFor(db, ref)[0];
  if (had) {
    const r = resident(db, had.npc_id);
    return { ok: true, npc: had.npc_id, name: r?.name ?? had.npc_id, action: had.id, urgent: !!comeData(had).urgent, d: 0, again: true };
  }
  const c = pickResponder(db, req.role, req.at, { maxM: req.maxM, exclude: req.exclude });
  if (!c) return { ok: false, wait: true, why: `no ${req.role} near enough` };
  const urgent = urgentFor(req.role, req.why);
  const row = startAction(db, {
    npc_id: c.r.id,
    kind: "come" as ActionRow["kind"],
    target: "Jef",
    target_x: Math.round(req.at.x * 10) / 10,
    target_z: Math.round(req.at.z * 10) / 10,
    source: "engine",
    minutes: COME_MIN,
    reason: reasonFor(req.role, req.why),
    data: { role: req.role, why: req.why, ref, urgent } as never,
  });
  return { ok: true, npc: c.r.id, name: c.r.name, action: row.id, urgent, d: Math.round(c.d) };
}

function reasonFor(role: CallRole, why: CallWhy): string {
  if (why === "shadow") return role === "customs" ? "an eye on Jef's load" : "a look at what Jef carries";
  if (why === "gang") return "a purse in a dark street";
  if (why === "crime") return "trouble reported";
  if (why === "contraband") return "a load to check";
  return role === "customs" ? "a load to check" : role === "thief" ? "goods left alone" : "Jef's job";
}

/** A gang of up to `n` lads from the town's thieves round Jef (the night roll): their ids, nearest first. */
export function callGang(db: DB, ref: string, at: { x: number; z: number }, n = 3): string[] {
  const had = comings(db).filter((a) => (comeData(a).ref ?? "").startsWith(`${ref}:`));
  if (had.length) return had.map((a) => a.npc_id);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const res = callResponder(db, { role: "gang", why: "gang", ref: `${ref}:${i}`, at, exclude: out, maxM: GANG_CALL_M });
    if (!res.ok) break;
    out.push(res.npc);
  }
  return out;
}

/** The job is done with them: they go back to their day. */
export function endCall(db: DB, actionId: number, outcome = "done"): boolean {
  const a = activeActions(db).find((x) => x.id === actionId && x.kind === ("come" as ActionRow["kind"]));
  if (!a) return false;
  endAction(db, a.id, "done", String(outcome).slice(0, 40), "");
  return true;
}

/** Everything a ref called ends (the job is over). */
export function endCallsFor(db: DB, refPrefix: string): number {
  let n = 0;
  for (const a of comings(db)) if ((comeData(a).ref ?? "").startsWith(refPrefix)) n += endCall(db, a.id, "job over") ? 1 : 0;
  return n;
}

// a job's calls end with it (the thief, the customs man, the tally man go back to their day)
settleExtras.push((db, j) => void endCallsFor(db, `job:${j.id}:`));

// a "come" row that outlives the client's run (a reload): it ends quietly when its time is up
actionHooks.timeUp.come = (db, a) => {
  endAction(db, a.id, "done", "time", "");
  return true;
};

// ------------------------------------------------------------------ followers

export interface ShadowFacts {
  /** The game's hour (fractional). */
  hour: number;
  /** The follower's distance to Jef. */
  d: number;
  /** Jef walking (not standing). */
  jefMoving: boolean;
  /** Other people within QUIET_M of Jef (the follower not counted). */
  peopleNear: number;
  /** An agent of the police within POLICE_SIGHT_M of Jef (or of the follower). */
  policeNear: boolean;
  /** Jef still has the load (goods in his hands, the parcel in his pocket, goods on his cart). */
  carrying: boolean;
  role: "thief" | "customs";
}

export type ShadowMove =
  | { kind: "keep"; gap: number }
  | { kind: "linger" }
  | { kind: "close_in" }
  | { kind: "break_off"; why: "no load" | "police" | "lost him" };

export const isDark = (hour: number) => {
  const h = ((hour % 24) + 24) % 24;
  return h >= 20 || h < 6;
};

/**
 * The engine's rule for a follower, each step: no load, break off; a thief with an agent in sight
 * breaks off; lost Jef (too far), break off; dark or quiet, close in; Jef standing still, linger
 * where he is (at a corner, out of the way); else keep his distance (12 to 25 m).
 */
export function shadowStep(f: ShadowFacts): ShadowMove {
  if (!f.carrying) return { kind: "break_off", why: "no load" };
  if (f.role === "thief" && f.policeNear) return { kind: "break_off", why: "police" };
  if (f.d > 90) return { kind: "break_off", why: "lost him" };
  if (isDark(f.hour) || f.peopleNear <= QUIET_MAX) return { kind: "close_in" };
  if (!f.jefMoving) return { kind: "linger" };
  const [lo, hi] = SHADOW_GAP;
  return { kind: "keep", gap: Math.max(lo, Math.min(hi, (lo + hi) / 2)) };
}

/**
 * An agent of the police (or the night watch) in the street within `r` of a point: only who the client
 * saw there (the actions' sync), never the schedule's guess (that puts a patrol at the first point of
 * its round all day long).
 */
export function policeWithin(db: DB, at: { x: number; z: number }, r = POLICE_SIGHT_M): string | null {
  for (const p of peopleNear(at.x, at.z, r)) {
    const t = resident(db, p.id)?.trade;
    if (t === "police" || t === "water_bailiff" || t === "watchman") return p.id;
  }
  return null;
}

/**
 * Does someone start following Jef for this load? The ENGINE decides: a thief (or, for a load no
 * honest man carries at that hour, a customs officer) who stands within SHADOW_SEE_M of where Jef
 * took it, free, and the roll. At most one follower at a time; one roll per job (`ref`).
 */
export function mayShadow(
  db: DB,
  req: { ref: string; goods: string; shady: boolean; at: { x: number; z: number }; seeM?: number },
  rng: () => number = Math.random,
): CallResult | null {
  const ref = `${String(req.ref).slice(0, 50)}:shadow`;
  if (comingFor(db, ref).length) return callResponder(db, { role: "thief", why: "shadow", ref, at: req.at });
  const st = rolledState(db);
  if (st.includes(ref)) return null;
  saveRolled(db, [...st, ref].slice(-40));
  if (comings(db).filter((a) => comeData(a).why === "shadow").length >= SHADOW_AT_ONCE) return null;
  const night = isDark(clock(db).hour);
  const role: CallRole = req.shady && night ? "customs" : "thief";
  const worth = req.shady || VALUABLE.has(req.goods);
  if (!worth) return null;
  if (rng() > (night ? SHADOW_CHANCE.night : SHADOW_CHANCE.day)) return null;
  const see = req.seeM ?? SHADOW_SEE_M;
  const who = pickResponder(db, role, req.at, { maxM: see }) ?? (role === "customs" ? pickResponder(db, "thief", req.at, { maxM: see }) : null);
  if (!who) return null;
  return callResponder(db, { role: ROLE_TRADES.customs.includes(who.r.trade) ? "customs" : "thief", why: "shadow", ref, at: req.at, maxM: see });
}

/** The jobs whose follower was rolled already (world_state 'walkup'; the last 40). */
function rolledState(db: DB): string[] {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'walkup'").get() as { value_json: string } | undefined;
  try {
    const v = row ? (JSON.parse(row.value_json) as { rolled?: unknown }) : {};
    return Array.isArray(v.rolled) ? v.rolled.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function saveRolled(db: DB, rolled: string[]): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('walkup', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify({ rolled }));
}

/** The server's facts for a follower's step (Jef's place and the people near come from the client's sync). */
export function shadowFacts(db: DB, actionId: number, jef: { moving: boolean; carrying: boolean }): ShadowFacts | null {
  const a = comings(db).find((x) => x.id === actionId);
  if (!a) return null;
  const at = jefAt();
  const me = posOf(db, a.npc_id);
  if (!at || !me) return null;
  const others = peopleNear(at.x, at.z, QUIET_M).filter((p) => p.id !== a.npc_id).length;
  const r = resident(db, a.npc_id);
  const c = clock(db);
  return {
    hour: c.hour + c.minute / 60,
    d: dist(me, at),
    jefMoving: jef.moving,
    peopleNear: others,
    policeNear: !!policeWithin(db, at),
    carrying: jef.carrying,
    role: r?.trade === "customs" ? "customs" : "thief",
  };
}
