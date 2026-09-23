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
import { eventPlaces, eventsToday, liveEvents, planEvent, type EventPlan, type PlanResult } from "./scheduler.ts";
import { enginePick, planFromTemplate, templateById, templatesForPrompt } from "./templates.ts";
import { LOOK_FOR_MIN, LOOK_FOR_RADIUS_M, PRIMITIVES_FOR_MODEL, StageSchema } from "./vocab.ts";

// The director (M4): once a game hour at most (pulled forward by a notable
// fact: a robbery, an arrest, a job's end, a heavy event, nightfall), it looks
// at the town and decides: nothing, an event (a template or a custom one made
// of the primitives), or a follow-up of an open thread. Async and fire-and-
// forget with a lock; the answer is checked against the state again when it
// arrives, and every number goes through the scheduler's clamps. When the
// budget is gone (its own share of the day's calls, never the reserve) or the
// model is late, the engine picks: an open thread first, else now and then a
// template that fits the hour.

export const DirectorSchema = z.object({
  decision: z.enum(["nothing", "event", "follow_up"]),
  why: z.string().max(200),
  event: z.object({
    title: z.string().max(80),
    /** A template id, or "custom". */
    template: z.string().max(30),
    place: z.string().max(40),
    start_in_min: z.number().int().min(0).max(180),
    stages: z.array(StageSchema).min(1).max(6),
    notice: z.string().max(160),
    rumour: z.string().max(160),
  }),
});
export type DirectorOut = z.infer<typeof DirectorSchema>;

const RULES = `
YOU ARE THE DIRECTOR OF THE TOWN: you decide what happens in the streets next, like a stage manager who never speaks.
- Most hours: decision "nothing" (the town is busy enough). An event when the hour, the day and the log call for one:
  a wedding on a fine morning, musicians on a square, a quarrel at the market, an emigrant ship, a funeral, or something
  surprising and period-true you make from the STAGES (a fire drill, a lost child, a fight over a barrel, a ship's cat).
- decision "follow_up": the open thread should move (the engine plays it). Use it when a robbery is unsolved.
- Never repeat an event held today. Never overlap what runs. Nothing at night after 22:00 or before 6:00.
- template: one of the ids below (then only title, notice and rumour are yours; the stages are the template's), or "custom".
- place: one of the place ids below. notice: a line the townspeople will mention, or "". rumour: what the town will say afterwards, or "".
- Engine facts only: never invent money, names of people, or things Jef did. Plain English; Dutch only in names.
- why: one short line for the log.`;

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
  for (const e of liveEvents(db)) out.push(`${e.status === "running" ? "Running" : "Planned"}: ${e.title} at ${e.place}, ${e.status === "running" ? `stage ${e.stage + 1}` : `in ${Math.max(0, e.start_m - gameMinute(db))} minutes`}.`);
  for (const a of listActions(db)) if (a.source !== "event") out.push(`${a.name} is ${a.kind.replace("_", " ")}${a.target_name ? ` ${a.target_name}` : a.target && a.kind !== "follow" ? ` ${a.target}` : " Jef"} (${a.minutes_left} min left).`);
  return out;
}

export function directorPrompt(db: DB): string {
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

TEMPLATES (ids)
${templatesForPrompt()}
${PRIMITIVES_FOR_MODEL}

Decide.`;
}

// ------------------------------------------------------------------ thinking

export interface ThinkResult {
  source: "claude" | "engine";
  decision: string;
  why: string;
  planned: PlanResult | null;
  error?: string;
}

/** One think: the model if it can, else the engine; the result is checked against the state when it arrives. */
export async function think(db: DB, runner?: Runner, force = false): Promise<ThinkResult> {
  const s = directorState(db);
  const c = clock(db);
  const { newest } = notable(db, s);
  save(db, { ...s, lastThinkMin: gameMinute(db), lastHour: c.hour, lastDay: c.day, lastEventId: newest, thinks: s.thinks + 1 });

  // an open thread the engine can move on its own
  const followed = followUp(db);
  if (followed) return { source: "engine", decision: "follow_up", why: followed, planned: null };

  let out: DirectorOut | null = null;
  let error: string | undefined;
  if (force || canCallDirector(db)) {
    const res = await callClaude(db, { hook: "director_think", system: SYSTEM + "\n" + RULES, prompt: directorPrompt(db), schema: DirectorSchema }, runner);
    if (res.ok && res.data) out = res.data;
    else error = res.error;
  } else error = "no budget";

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
    const planned = planEvent(db, plan);
    writeEvent(db, { kind: "director", verb: planned.ok ? "event" : "rejected", text: planned.ok ? `The director set up "${plan.title}": ${why}` : `The director's "${plan.title}" was refused: ${planned.why}`, weight: planned.ok ? 3 : 2 });
    return { source: "claude", decision: "event", why, planned };
  }

  // the engine's pick: now and then, in daylight
  const planned = enginePickNow(db);
  return { source: "engine", decision: planned ? "event" : "nothing", why: error ?? "", planned, error };
}

function planFromModel(out: DirectorOut): EventPlan {
  const e = out.event;
  const t = templateById(e.template);
  if (t) {
    return planFromTemplate(t, "claude", {
      title: e.title.trim() || t.title,
      start_in_min: e.start_in_min,
      notice: e.notice.trim() || t.notice,
      rumour: e.rumour.trim() || t.rumour,
      place: t.place === "house" || !e.place.trim() ? t.place : e.place,
      why: out.why,
    });
  }
  return { title: e.title.trim() || "Something in the street", template: "custom", place: e.place, start_in_min: e.start_in_min, stages: e.stages, notice: e.notice, rumour: e.rumour, source: "claude", why: out.why };
}

/** Daylight, a roll, a template that fits: the engine's own event. */
export function enginePickNow(db: DB, rng: () => number = Math.random, always = false): PlanResult | null {
  const c = clock(db);
  if (!always && (c.hour < 8 || c.hour >= 21 || rng() >= ENGINE_EVENT_CHANCE)) return null;
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
    minutes: Math.min(120, Math.round((d / 1.2) * 3) + 20),
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
