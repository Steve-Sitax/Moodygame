import { z } from "zod";
import type { DB } from "../db.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, DIRECTOR_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { plainEnglish } from "../text.ts";
import { gameMinute } from "../town/deeds.ts";
import { policeDispatch } from "../town/police.ts";
import { resident } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { activeActions, crimeOpen, posOf, startAction, listActions } from "./actions.ts";
import { eventSlice, writeEvent } from "./eventlog.ts";
import { streetCrimeOpen } from "./scenes.ts";
import { eventPlaces, eventsToday, liveEvents, planEvent, type EventPlan, type PlanResult } from "./scheduler.ts";
import { enginePick, planFromTemplate, ROUTINE_TEMPLATES } from "./templates.ts";
import { EVENTS_AT_ONCE, EVENTS_PER_DAY, LOOK_FOR_MIN, LOOK_FOR_RADIUS_M, PRIMITIVES_FOR_MODEL, StageSchema, walkMinutes } from "./vocab.ts";
import { keepPromise, promiseThread, strangersHere } from "./surprises.ts";
import { inSpan, NIGHT_EVENTS } from "../../../shared/night.ts";

// The director (M4): once a game hour at most (pulled forward by a notable
// fact: a robbery, an arrest, a job's end, a heavy event, nightfall), it looks
// at the town and decides: nothing, an event (a template or a custom one made
// of the primitives), or a follow-up of an open thread. Async and fire-and-
// forget with a lock; the answer is checked against the state again when it
// arrives, and every number goes through the scheduler's clamps. When the
// budget is gone (its own share of the day's calls, never the reserve) or the
// model is late, the engine picks: an open thread first, else now and then a
// template that fits the hour.
//
// M4b (Steve: "the events were meant to be created on the fly by AI"): AI first. The
// model invents every event itself from the stages, the lead roles and the scenes
// (a scuffle, a robbery); the templates are only the engine's fallback. The model is
// not asked when no event could be planned anyway (night, the day's four held, two
// running), so its share of the calls goes to the hours that can use it.

export const DirectorSchema = z.object({
  decision: z.enum(["nothing", "event", "follow_up"]),
  why: z.string().max(200),
  event: z.object({
    title: z.string().max(80),
    /** M4b: a short word for what it is (wedding, sermon, scuffle, robbery ...); the engine keeps it to spot repeats. */
    kind: z.string().max(30),
    place: z.string().max(40),
    start_in_min: z.number().int().min(0).max(180),
    stages: z.array(StageSchema).min(1).max(6),
    notice: z.string().max(160),
    rumour: z.string().max(160),
  }),
});
export type DirectorOut = z.infer<typeof DirectorSchema>;

const RULES = `
YOU ARE THE DIRECTOR OF THE TOWN: you invent what happens in the streets next, like a stage manager who never speaks.
- You make the events yourself, fresh each time, from the STAGES and the LEADS below. Something period-true for Antwerp in
  the autumn of 1873 that fits the hour, the day, the weather and what the town lately lived through: a working-class
  wedding (the bride in her dark best dress with a white veil and a wreath of orange blossom), a funeral, street music, a
  fish auction, a hawker or a showman with his monkey, a temperance preacher, a drunk who picks a quarrel, a scuffle over a
  debt, a pickpocket at the market, sailors ashore, a lost child, a runaway horse, a ship's cat.
- A house fire (rare, at most one in three days): kind "house_fire" with one gather stage; the engine picks the house and
  plays the alarm bell, the horse pump, the firemen and the bucket chain.
- When nothing runs and the day has room: decision "event". "nothing" only when the town already has enough going on.
- decision "follow_up": the open thread should move (the engine plays it). Use it when Jef's robbery is unsolved.
- Never repeat what was held today. Never overlap what runs.
- At night (22:00 to 5:00) the honest town is abed: only a night event, and small (a handful of people, never a
  crowd of more than eight): a burglary (lead pickpocket, then the police), smugglers landing goods on a quay (leads
  smuggler, props crates), a scuffle outside a tavern at closing time (leads drunkard and quarreller), the night watch
  going its round (gather police, a procession), or a house fire. It must be over by 5:00. Nothing from 5:00 to 6:00.
- kind: one short word for what it is. place: one of the place ids below. notice: a line the townspeople will mention,
  or "". rumour: what the town will say afterwards, or "". Name the leads only as {bride}, {groom}, {victim} and so on.
- The game has NO COMBAT. Nobody is hurt or killed, nobody has a weapon; a scuffle is pushing and shoving and the police
  part them. Jef never fights. Never give Jef money or goods: only jobs and shops pay.
- Engine facts only: never invent money sums, names of people, or things Jef did. Plain English; Dutch only in names.
- why: one short line for the log.
EXAMPLE of a stage list (a wedding): gather guests 20 at cathedral_west with leads [groom, bride, priest]; enter with leads
[priest, groom, bride] (the vows inside); gather crowd 14 with bells (they come out); talk about the couple; procession to
engel with leads [groom, bride] and music; sound music.`;

interface DirectorState {
  lastThinkMin: number;
  lastHour: number;
  lastDay: number;
  lastEventId: number;
  thinks: number;
  /** The robbery (log id) the engine already searched for. */
  searched: number;
}
const EMPTY: DirectorState = { lastThinkMin: -1e9, lastHour: -1, lastDay: 0, lastEventId: 0, thinks: 0, searched: 0 };

export function directorState(db: DB): DirectorState {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'director'").get() as { value_json: string } | undefined;
  return row ? { ...EMPTY, ...(JSON.parse(row.value_json) as DirectorState) } : { ...EMPTY };
}
function save(db: DB, s: DirectorState): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('director', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(s));
}

export const THINK_GAP_MIN = 30;
export const NIGHTFALL = 19;
/** The chance per game hour (8:00 to 21:00) that the engine starts a template when the model cannot. */
export const ENGINE_EVENT_CHANCE = 0.35;

/**
 * Could an event be planned now at all (daylight, room today, not two running)? The model is not asked otherwise.
 * The town's routine (the ballad singer, the dawn hiring) takes no slot, as in planEvent.
 */
export function roomForEvent(db: DB): boolean {
  const h = clock(db).hour;
  // M7 night: the night's events from 22:00 to 5:00 (scheduler.ts keeps them to night kinds); none from 5 to 6
  if (!inSpan(h, NIGHT_EVENTS) && (h < 6 || h >= 22)) return false;
  if (eventsToday(db).length >= EVENTS_PER_DAY) return false;
  return liveEvents(db).filter((e) => !ROUTINE_TEMPLATES.has(e.template)).length < EVENTS_AT_ONCE;
}

export function canCallDirector(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook = 'director_think'").get(day) as { n: number }).n;
  return mine < DIRECTOR_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

/** Something happened that should pull the director forward. */
function notable(db: DB, s: DirectorState): { pull: boolean; newest: number } {
  const row = db.prepare("SELECT MAX(id) AS id, MAX(CASE WHEN weight >= 6 AND kind IN ('theft', 'police', 'job', 'event', 'deed') THEN id ELSE 0 END) AS heavy FROM world_event WHERE id > ?").get(s.lastEventId) as { id: number | null; heavy: number | null };
  return { pull: (row.heavy ?? 0) > 0, newest: row.id ?? s.lastEventId };
}

/** Should the director think now? A new game hour, or a notable fact after a gap of 30 game minutes. */
export function dueNow(db: DB, s = directorState(db)): boolean {
  const c = clock(db);
  const now = gameMinute(db);
  if (now - s.lastThinkMin < THINK_GAP_MIN) return false;
  if (c.hour !== s.lastHour || c.day !== s.lastDay) return true;
  if (c.hour === NIGHTFALL && s.lastHour !== NIGHTFALL) return true;
  return notable(db, s).pull;
}

let thinking: Promise<unknown> | null = null;

/** Every tick: think if due (fire and forget, one at a time). */
export function directorTick(db: DB, runner?: Runner): void {
  if (thinking) return;
  if (!dueNow(db)) return;
  thinking = think(db, runner)
    .catch((e) => console.error("[director] think", e))
    .finally(() => (thinking = null));
}

/** Test helper: wait for a running think. */
export async function directorIdle(): Promise<void> {
  await thinking?.catch(() => {});
}

// ------------------------------------------------------------------ the prompt

export function openThreads(db: DB): string[] {
  const out: string[] = [];
  const crime = crimeOpen(db);
  if (crime) {
    const thief = resident(db, crime.thief);
    out.push(`Jef was robbed of ${crime.amount_c} centimes in the dark (day ${crime.day}); the money is not back. The engine knows who did it (${thief?.name ?? "a pickpocket"}); the town does not.`);
  }
  const street = streetCrimeOpen(db);
  if (street) {
    const v = resident(db, street.victim);
    out.push(`A pickpocket took ${v?.name ?? "someone"}'s purse at ${street.place} and got away${street.witnessed ? "; Jef saw it" : ""}. Unsolved.`);
  }
  for (const e of liveEvents(db)) out.push(`${e.status === "running" ? "Running" : "Planned"}: ${e.title} at ${e.place}, ${e.status === "running" ? `stage ${e.stage + 1}` : `in ${Math.max(0, e.start_m - gameMinute(db))} minutes`}.`);
  // M6 surprises: the cards' promise to bring about, and a stranger in town the director may use
  const promise = promiseThread(db);
  if (promise) out.push(promise);
  for (const v of strangersHere(db)) out.push(`A stranger is in town: ${v.name} from ${v.visitor?.origin ?? "abroad"}, ${v.visitor?.label ?? ""}. Wants ${v.visitor?.goal ?? "something"}.`);
  for (const a of listActions(db)) if (a.source !== "event") out.push(`${a.name} is ${a.kind.replace("_", " ")}${a.target_name ? ` ${a.target_name}` : a.target && a.kind !== "follow" ? ` ${a.target}` : " Jef"} (${a.minutes_left} min left).`);
  return out;
}

export function directorPrompt(db: DB, invent = false): string {
  const c = clock(db);
  const today = eventsToday(db);
  const threads = openThreads(db);
  const places = eventPlaces(db)
    .map((p) => `${p.id} (${p.label})`)
    .join(", ");
  return `NOW
${c.weekday}, day ${c.day} of 7, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}.

OPEN THREADS
${threads.length ? threads.map((t) => "- " + t).join("\n") : "- none"}

EVENTS ALREADY HELD TODAY (no repeats)
${today.length ? today.map((e) => `- ${e.title} (${e.template}) at ${e.place}, ${e.status}`).join("\n") : "- none"}

LATELY IN THE TOWN (oldest first)
${eventSlice(db, { limit: 20, maxChars: 1500 }).join("\n") || "- quiet"}

PLACES (ids)
${places}
${PRIMITIVES_FOR_MODEL}

${invent ? "Invent an event now: decision \"event\", made by you from the stages and the leads." : "Decide."}`;
}

// ------------------------------------------------------------------ thinking

export interface ThinkResult {
  source: "claude" | "engine";
  decision: string;
  why: string;
  planned: PlanResult | null;
  error?: string;
}

/**
 * One think: the model if it can, else the engine; the result is checked against the state when it arrives.
 * `invent` (the dev button "Director: invent an event now"): the model must make a custom event now; the
 * day's count and the two-at-once cap are skipped (as for the dev template buttons), every other check holds.
 */
export async function think(db: DB, runner?: Runner, force = false, invent = false): Promise<ThinkResult> {
  const s = directorState(db);
  const c = clock(db);
  const { newest } = notable(db, s);
  save(db, { ...s, lastThinkMin: gameMinute(db), lastHour: c.hour, lastDay: c.day, lastEventId: newest, thinks: s.thinks + 1 });

  // an open thread the engine can move on its own
  if (!invent) {
    const followed = followUp(db);
    if (followed) return { source: "engine", decision: "follow_up", why: followed, planned: null };
  }

  let out: DirectorOut | null = null;
  let error: string | undefined;
  if (!force && !roomForEvent(db)) {
    // no event could be planned now: no call spent
    return { source: "engine", decision: "nothing", why: "no room for an event now", planned: null };
  }
  if (force || canCallDirector(db)) {
    const res = await callClaude(db, { hook: "director_think", system: SYSTEM + "\n" + RULES, prompt: directorPrompt(db, invent), schema: DirectorSchema }, runner);
    if (res.ok && res.data) out = res.data;
    else error = res.error;
  } else error = "no budget";
  if (invent && out && out.decision !== "event") {
    error = `the model chose "${out.decision}"`;
    out = null;
  }

  if (out) {
    const why = plainEnglish(out.why);
    if (out.decision === "nothing") {
      writeEvent(db, { kind: "director", verb: "nothing", text: `The director let the hour pass: ${why}`, weight: 1 });
      return { source: "claude", decision: "nothing", why, planned: null };
    }
    if (out.decision === "follow_up") {
      writeEvent(db, { kind: "director", verb: "follow_up", text: `The director asked for a follow-up: ${why} (nothing open).`, weight: 1 });
      return { source: "claude", decision: "follow_up", why, planned: null };
    }
    const plan = planFromModel(out);
    const planned = planEvent(db, plan, { dev: invent });
    writeEvent(db, { kind: "director", verb: planned.ok ? "event" : "rejected", text: planned.ok ? `The director set up "${plan.title}": ${why}` : `The director's "${plan.title}" was refused: ${planned.why}`, weight: planned.ok ? 3 : 2 });
    return { source: "claude", decision: "event", why, planned };
  }

  // the engine's pick: now and then, in daylight (never for the invent button: that shows the model's miss)
  if (invent) return { source: "engine", decision: "nothing", why: error ?? "", planned: null, error };
  // M6: the engine keeps the fortune teller's promise itself when the model did not (now and then; surely on its last day)
  const kept = await keepPromise(db, { runner });
  if (kept) return { source: "engine", decision: "follow_up", why: `the cards' promise: ${kept}`, planned: null, error };
  const planned = enginePickNow(db);
  return { source: "engine", decision: planned ? "event" : "nothing", why: error ?? "", planned, error };
}

/** The model's event as a plan: always its own stages (M4b: AI first); the engine's checks follow in planEvent. */
export function planFromModel(out: DirectorOut): EventPlan {
  const e = out.event;
  const kind = e.kind.trim().toLowerCase().replace(/[^a-z_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "custom";
  return { title: e.title.trim() || "Something in the street", template: kind, place: e.place, start_in_min: e.start_in_min, stages: e.stages, notice: e.notice, rumour: e.rumour, source: "claude", why: out.why };
}

/** Daylight, a roll, a template that fits: the engine's own event. */
export function enginePickNow(db: DB, rng: () => number = Math.random, always = false): PlanResult | null {
  const c = clock(db);
  // daylight, or (M7 night) the night from 22:00 to 4:00, when only the night's templates fit
  const hours = (c.hour >= 8 && c.hour < 21) || inSpan(c.hour, [22, 28]);
  if (!always && (!hours || rng() >= ENGINE_EVENT_CHANCE)) return null;
  const t = enginePick(db, rng);
  if (!t) return null;
  const planned = planEvent(db, planFromTemplate(t, "engine", { why: "the engine's pick" }));
  writeEvent(db, { kind: "director", verb: planned.ok ? "engine_event" : "engine_rejected", text: planned.ok ? `The engine set up "${t.title}".` : `The engine's "${t.title}" was refused: ${planned.why}`, weight: 2 });
  return planned;
}

/**
 * The open thread the engine moves on its own: a robbery nobody searched for
 * yet sends the nearest agent on duty to where it happened, then looking for
 * the thief (the police search). Once per robbery.
 */
export function followUp(db: DB): string | null {
  const crime = crimeOpen(db);
  if (!crime) return null;
  const s = directorState(db);
  if (s.searched === crime.logId) return null;
  const c = clock(db);
  if (c.hour < 6 || c.hour >= 22) return null;
  const where = (db.prepare("SELECT x, z FROM world_event WHERE ref_type = 'log' AND ref_id = ? AND x IS NOT NULL").get(crime.logId) as { x: number; z: number } | undefined) ?? null;
  const thief = resident(db, crime.thief);
  const spot0 = where ?? (thief ? posOf(db, thief.id) : null) ?? { x: 0, z: 20 };
  const agent = policeDispatch(db, spot0);
  if (!agent) return null;
  if (activeActions(db).some((a) => a.npc_id === agent)) return null;
  const spot = walkMap().nearestOpen(spot0.x, spot0.z, 8) ?? spot0;
  const from = posOf(db, agent) ?? spot;
  const d = Math.hypot(from.x - spot.x, from.z - spot.z);
  startAction(db, {
    npc_id: agent,
    kind: "go_to",
    target: "where Jef was robbed",
    target_x: spot.x,
    target_z: spot.z,
    source: "director",
    minutes: walkMinutes(d, 5),
    reason: "a robbery reported",
    data: { then: { kind: "look_for", target: crime.thief, minutes: LOOK_FOR_MIN, data: { purpose: "question", about: "the robbery" } } },
  });
  save(db, { ...directorState(db), searched: crime.logId });
  const name = resident(db, agent)?.name ?? "an agent";
  writeEvent(db, { kind: "director", verb: "police_search", text: `${name} of the police went to look into Jef's robbery.`, actor: agent, weight: 4, who: [agent] });
  return `police search by ${name}`;
}

export function clearDirector(db: DB): void {
  db.prepare("DELETE FROM world_state WHERE key = 'director'").run();
}

export { LOOK_FOR_RADIUS_M };
