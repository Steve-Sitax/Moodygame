import { eventPeopleMax } from "../town/popsettings.ts";
import type { DB } from "../db.ts";
import { clock, setWeather, type Weather } from "../day.ts";
import { ALL_EMPLOYERS, SPOTS, clampBoard, maxTier, taskFor, type Board } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { plainEnglish } from "../text.ts";
import { ITEMS } from "../trade.ts";
import { gameMinute } from "../town/deeds.ts";
import { PLACES, shownTrade, TOWN_EMPLOYERS } from "../town/places.ts";
import type { Resident } from "../town/population.ts";
import { activityAt } from "../town/schedule.ts";
import { resident, town, TOWN_EMPLOYER_IDS } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { setState, state } from "./state.ts";
import { actionOf, activeActions, endAction, endEventActions, isReserved, startAction } from "./actions.ts";
import { notify } from "./bus.ts";
import { runConvo } from "./convo.ts";
import { writeEvent } from "./eventlog.ts";
import { cleanLeads, fillNames, keptAtWork, leadLine, leadSpot, namesIn, pickLeads, type Lead, type LeadAsk } from "./leads.ts";
export { keptAtWork };
import { applyScene, resolveScene, sceneForClient, type Scene } from "./scenes.ts";
import { fireEnd, fireForClient, fireGapWhy, pickFireHouse, runFireAct, type FireScene } from "./fire.ts";
import { hiringEnd, hiringForClient, hiringTick, runHiringAct, type HiringScene } from "./hiring.ts";
import { runBalladAct } from "../ballads/ballad.ts";
import { ROUTINE_TEMPLATES, scriptFor } from "./templates.ts";
import { emigrantShip, isEmigrant } from "../town/emigrants.ts";
import { visitorOf } from "../town/visitors.ts";
import { errandsFor } from "../town/possessions.ts";
import type { AnyLeadRole } from "./leads.ts";
import {
  EVENT_MARGIN_MIN,
  EVENT_MAX_MIN,
  EVENT_MAX_STAGES,
  EVENT_NEAR_M,
  EVENTS_AT_ONCE,
  EVENTS_PER_DAY,
  GATHER_MAX,
  GATHER_MIN,
  PRICE_MAX,
  PRICE_MIN,
  STAGE_MAX_MIN,
  STAGE_MIN_MIN,
  MONEY_TO_JEF_RE,
  SOFTEN,
  StageSchema,
  VIOLENCE_RE,
  cleanCues,
  type LeadRole,
  type GatherRole,
  type Stage,
} from "./vocab.ts";

// The scheduler (M4): town events as rows in town_event, made of stages the
// engine plays by game time (eventsTick). A new event is refused when it
// would overlap another (same place, within 60 m, or the same people, with a
// cleanup margin), when two already run, or when four were held today. Every
// stage op is an engine primitive: people gather (attend actions on the
// residents, so nobody is in two things at once), a procession, a sound, props,
// a talk, a notice, a rumour, a price, a closed shop, a job, the weather. The
// end cleans up: people released, prices back, places reopened.


/** A stage as stored: the model's flat object, plus where the engine put it. */
/** `pre`: an onlookers' gathering already called at the start of the event (Steve: they come before it starts). */
/** `scene`: a scuffle or a robbery as the engine set it up at the stage's start (scenes.ts). */
/** M6 town life: `act`, the engine's scripted act for a stage (fire.ts, hiring.ts); `fire` and `hiring`, what it set up. */
export type StoredStage = Stage & {
  x?: number;
  z?: number;
  label?: string;
  pre?: boolean;
  scene?: Scene;
  act?: string;
  fire?: FireScene;
  hiring?: HiringScene;
  /** A funeral (on the first stage): the widow the engine chose, the real widow of the one buried (null: none). */
  widow?: string | null;
};

export interface EventRow {
  id: number;
  day: number;
  title: string;
  template: string;
  place: string;
  x: number;
  z: number;
  r: number;
  start_m: number;
  end_m: number;
  stage: number;
  stages_json: string;
  people_json: string;
  /** M4b: the leads, picked at the start (leads.ts). */
  leads_json: string;
  status: "planned" | "running" | "done" | "cancelled";
  source: string;
  notice: string;
  rumour: string;
  why: string;
}

export interface EventPlan {
  title: string;
  template: string;
  place: string;
  start_in_min: number;
  stages: Stage[];
  notice?: string;
  rumour?: string;
  source: "claude" | "engine";
  why?: string;
}

export interface PlaceSpot {
  id: string;
  label: string;
  x: number;
  z: number;
  r: number;
}

/** A routine event may start this many game minutes before its hour (half a 15-minute tick). */
export const ROUTINE_EARLY_MIN = 7;

const stagesOf = (ev: EventRow): StoredStage[] => JSON.parse(ev.stages_json) as StoredStage[];
const peopleOf = (ev: EventRow): string[] => JSON.parse(ev.people_json) as string[];
export const leadsOf = (ev: EventRow): Lead[] => JSON.parse(ev.leads_json || "[]") as Lead[];

/** A stage with every field, from a partial one (the templates). */
export function stage(s: Partial<Stage> & { op: Stage["op"]; minutes: number }): Stage {
  return { place: "", role: "crowd", count: 0, sound: "none", mood: "calm", props: "none", text: "", item: "", factor: 1, leads: [], ...s };
}

// ------------------------------------------------------------------ places

/** Where an event can be held: the town's places, the fixed places, the cathedral's west door, a house door ("house"). */
export function eventPlaces(db: DB): PlaceSpot[] {
  const t = town(db).town;
  const out: PlaceSpot[] = [{ id: "cathedral_west", label: "the west door of the cathedral", x: -262, z: 149.5, r: 9 }];
  for (const p of PLACES) out.push({ id: p.id, label: p.label, x: p.x, z: p.z, r: Math.min(p.r, 14) });
  for (const [id, p] of Object.entries(t.places)) {
    if (out.some((o) => o.id === id)) continue;
    out.push({ id, label: p.label, x: p.door?.[0] ?? p.x, z: p.door?.[1] ?? p.z, r: Math.min(p.r || 6, 8) });
  }
  return out;
}

/** "house": the door of an old resident's house, picked by the day (a funeral). */
function houseOfTheDay(db: DB): PlaceSpot | null {
  const day = clock(db).day;
  const old = town(db)
    .town.residents.filter((r) => r.age >= 58 && r.trade !== "priest")
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!old.length) return null;
  const r = old[(day * 7 + 3) % old.length];
  return { id: `house:${r.id}`, label: `the house of ${r.name}`, x: r.home.sx, z: r.home.sz, r: 5 };
}

export function resolvePlace(db: DB, name: string): PlaceSpot | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  if (n === "house" || n.startsWith("house:")) {
    const id = n.slice(6);
    const r = id ? resident(db, id) : null;
    return r ? { id: `house:${r.id}`, label: `the house of ${r.name}`, x: r.home.sx, z: r.home.sz, r: 5 } : houseOfTheDay(db);
  }
  const all = eventPlaces(db);
  const hit = all.find((p) => p.id === n) ?? all.find((p) => p.label.toLowerCase() === n) ?? all.find((p) => p.label.toLowerCase().includes(n) && n.length >= 4);
  if (!hit) return null;
  const open = walkMap().nearestOpen(hit.x, hit.z, 8);
  return open ? { ...hit, x: open.x, z: open.z } : null;
}

// ------------------------------------------------------------------ clamps

/** The engine's clamp of a stage list: known ops only, minutes and counts in range, at most six, four hours in all. */
export function cleanStages(raw: unknown[]): Stage[] {
  const out: Stage[] = [];
  let scenes = 0;
  for (const s of raw.slice(0, EVENT_MAX_STAGES)) {
    // stages stored before M4b have no leads
    const withLeads = s && typeof s === "object" && !Array.isArray((s as { leads?: unknown }).leads) ? { ...(s as object), leads: [] } : s;
    // the cues are cleaned first: one unknown sound drops that cue, never the stage
    const withCues = withLeads && typeof withLeads === "object" ? { ...(withLeads as object), cues: cleanCues((withLeads as { cues?: unknown }).cues) } : withLeads;
    const p = StageSchema.safeParse(withCues);
    if (!p.success) continue;
    const st = { ...p.data };
    const num = (n: number, lo: number, hi: number, dflt: number) => (Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt);
    st.minutes = Math.round(num(st.minutes, STAGE_MIN_MIN, STAGE_MAX_MIN, STAGE_MIN_MIN));
    st.leads = cleanLeads(st.leads) as Stage["leads"];
    // the sound cues the model composed: the engine's palette only, numbers held, at most four
    st.cues = cleanCues(st.cues);
    // the scenes: fixed leads, one scene an event
    if (st.op === "scuffle") {
      if (scenes++) continue;
      const two = st.leads.filter((l) => l === "quarreller" || l === "drunkard").slice(0, 2);
      while (two.length < 2) two.push("quarreller");
      st.leads = two;
    }
    if (st.op === "robbery") {
      if (scenes++) continue;
      st.leads = ["pickpocket", "victim"];
    }
    if (st.op === "gather") {
      const c = Number.isFinite(st.count) ? st.count : 6;
      st.count = Math.round(c <= 0 ? (st.leads.length ? 0 : 6) : Math.max(st.leads.length ? 1 : GATHER_MIN, Math.min(GATHER_MAX, c)));
    } else st.count = Math.round(num(st.count, 0, GATHER_MAX, 0));
    st.factor = st.op === "price" ? num(st.factor, PRICE_MIN, PRICE_MAX, 1) : 1;
    st.text = softText(st.text).slice(0, 160);
    st.item = st.item.trim().toLowerCase();
    if (st.op === "price" && !(st.item in ITEMS)) continue;
    out.push(st);
  }
  // a scene first thing: its two walk there before it plays
  if (out[0] && (out[0].op === "scuffle" || out[0].op === "robbery")) {
    out.unshift(stage({ op: "gather", minutes: 60, count: 0, place: out[0].place, leads: [...out[0].leads], mood: out[0].op === "robbery" ? "calm" : "tense" }));
    if (out.length > EVENT_MAX_STAGES) out.pop();
  }
  let total = 0;
  const kept: Stage[] = [];
  for (const s of out) {
    if (total + s.minutes > EVENT_MAX_MIN) break;
    total += s.minutes;
    kept.push(s);
  }
  return kept;
}

/**
 * M4b: the engine's words check on everything the director writes. Money handed to Jef is
 * struck out (only jobs and shops pay); a fight is a scuffle; plain English.
 */
export function softText(t: string): string {
  let out = plainEnglish(t ?? "");
  out = out.replace(MONEY_TO_JEF_RE, " ");
  for (const [re, to] of SOFTEN) out = out.replace(re, to);
  return out.replace(/\s{2,}/g, " ").trim();
}

/** A weapon, a killing, someone hurt: the event is refused whole (no combat in this game). */
export function violent(plan: Pick<EventPlan, "title" | "notice" | "rumour" | "stages">): string | null {
  const texts = [plan.title, plan.notice ?? "", plan.rumour ?? "", ...plan.stages.map((s) => (s as { text?: string }).text ?? "")];
  for (const t of texts) {
    const m = VIOLENCE_RE.exec(t ?? "");
    if (m) return m[0];
  }
  return null;
}

// ------------------------------------------------------------------ rows

export function eventRow(db: DB, id: number): EventRow | null {
  return (db.prepare("SELECT * FROM town_event WHERE id = ?").get(id) as EventRow | undefined) ?? null;
}

export function liveEvents(db: DB): EventRow[] {
  return db.prepare("SELECT * FROM town_event WHERE status IN ('planned', 'running') ORDER BY start_m").all() as EventRow[];
}

/** The day's events (M6: not the town's routine, the dawn hiring). */
export function eventsToday(db: DB): EventRow[] {
  return (db.prepare("SELECT * FROM town_event WHERE day = ? AND status <> 'cancelled' ORDER BY id").all(clock(db).day) as EventRow[]).filter((e) => !ROUTINE_TEMPLATES.has(e.template));
}

// ------------------------------------------------------------------ planning

export type PlanResult = { ok: true; event: EventRow } | { ok: false; why: string };

/** Leads an event is refused without: a wedding needs its couple, a scene its two. */
const MUST_LEADS: LeadRole[] = ["bride", "groom", "pickpocket", "victim", "quarreller"];

/** A funeral, by its template or its words. */
export function isFuneral(plan: { template?: string; title?: string }): boolean {
  return plan.template === "funeral" || /\b(funeral|burial|buried|coffin|mourn\w*)\b/i.test(plan.title ?? "");
}

/**
 * The widow of a funeral (QA 2026-09-24: the Logement's keeper walked as the widow of a docker who
 * was nobody's husband): the one buried is the late husband of a real widow of the town, and she
 * walks behind him. Free, not at a counter or a post, not already in an event; by the day.
 */
export function funeralWidow(db: DB, salt = ""): Resident | null {
  const taken = new Set(liveEvents(db).flatMap((o) => [...peopleOf(o), ...leadsOf(o).map((l) => l.id)]));
  const busy = new Set(activeActions(db).map((a) => a.npc_id));
  const day = clock(db).day;
  const hash = (x: string) => {
    let h = 2166136261;
    for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
  };
  const pool = town(db).town.residents.filter(
    (r) => r.sex === "f" && r.family_role === "widow" && r.age >= 38 && !taken.has(r.id) && !busy.has(r.id) && !isReserved(db, r.id) && !isEmigrant(r) && !visitorOf(r) && !keptAtWork(db, r),
  );
  return pool.sort((a, b) => hash(`${a.id}:${day}${salt}`) - hash(`${b.id}:${day}${salt}`))[0] ?? null;
}

/**
 * The title said with the real leads (QA 2026-09-24: "A docker's wedding" for a town-hall clerk,
 * and the paper printed it): "a docker's wedding" takes the groom's trade; "a docker's funeral"
 * becomes the funeral from the widow's house; any other trade word in it that no lead has goes.
 */
export function fitTitle(db: DB, title: string, leads: Array<{ role: string; id: string }>): string {
  const m = /\b(an?|the)\s+([a-z][a-z -]*?)'s\s+(wedding|marriage|funeral|burial)\b/i.exec(title);
  if (!m) return title;
  const kind = m[3].toLowerCase();
  const lead = (role: string) => resident(db, leads.find((l) => l.role === role)?.id ?? "");
  let who: string | null = null;
  if (kind === "wedding" || kind === "marriage") {
    const g = lead("groom");
    who = g ? shownTrade(g) : null;
  }
  if (who) {
    const art = /^[aeiou]/i.test(who) ? "an" : "a";
    const a = m[1][0] === m[1][0].toUpperCase() ? art[0].toUpperCase() + art.slice(1) : art;
    return title.replace(m[0], `${m[1].toLowerCase() === "the" ? m[1] : a} ${who}'s ${m[3]}`);
  }
  // a funeral: the widow's late husband, not a trade the town cannot show
  const w = lead("widow");
  if (kind === "funeral" || kind === "burial") return w ? `The funeral of ${w.name}'s husband` : title.replace(m[0], `${m[1]} ${m[3]}`).replace(/^a /, "A ");
  return title.replace(m[0], `${m[1]} ${m[3]}`);
}

/** Every lead the stages name, with where they first stand. */
function leadAsks(db: DB, stages: Stage[], place: PlaceSpot): LeadAsk[] {
  const out: LeadAsk[] = [];
  stages.forEach((s, i) => {
    if (s.op === "procession" || !s.leads.length) return;
    const p = s.place ? resolvePlace(db, s.place) : null;
    const at = p ?? place;
    for (const role of s.leads) out.push({ role, stage: i, at: { x: at.x, z: at.z } });
  });
  // leads named only in a procession start at the event's place
  stages.forEach((s) => {
    if (s.op !== "procession") return;
    for (const role of s.leads) if (!out.some((a) => a.role === role)) out.push({ role, stage: 0, at: { x: place.x, z: place.z } });
  });
  return out;
}

/** Plan an event: the checks, then the row. Nothing happens until its start. */
/** `dev`: the dev buttons skip the day's count and the two-at-once cap; the place, 60 m and people rules still hold. */
export function planEvent(db: DB, plan: EventPlan, opts: { dev?: boolean } = {}): PlanResult {
  const bad = violent(plan);
  if (bad) return { ok: false, why: `no combat in this town: "${bad}"` };
  // M6 town life: a scripted template (the house fire, the dawn hiring) keeps its own stages and
  // acts whatever the model wrote; the fire's house is the engine's choice, never Jef's home
  const script = scriptFor(plan);
  let acts: Array<string | null> = [];
  if (script?.acts) {
    acts = script.acts;
    const modelWords = plan.source === "claude" && plan.template !== script.id;
    plan = { ...plan, template: script.id, stages: script.stages.map((s) => ({ ...s })), title: modelWords ? plan.title : plan.title || script.title };
    if (script.id === "house_fire") {
      const gap = opts.dev ? null : fireGapWhy(db, script.gapDays ?? 3);
      if (gap) return { ok: false, why: gap };
      const house = pickFireHouse(db);
      if (!house) return { ok: false, why: "no house near enough to water for a bucket chain" };
      plan = { ...plan, place: `house:${house}` };
    }
  }
  // a funeral: the engine picks the widow (a real widow; the one buried is her late husband) and
  // the house it goes from (hers, when the plan says "house"); a priest leads the procession
  let widowId: string | null | undefined;
  if (isFuneral(plan)) {
    const w = funeralWidow(db);
    widowId = w?.id ?? null;
    if (w && /^house(:|$)/i.test(plan.place.trim())) plan = { ...plan, place: `house:${w.id}` };
    let led = false;
    const st2 = (plan.stages as Stage[]).map((s) => {
      let leads = [...(s.leads ?? [])] as Stage["leads"];
      if (!w) leads = leads.filter((l) => l !== "widow");
      if (s.op === "procession" && !led) {
        led = true;
        leads = ["priest", ...leads.filter((l) => l !== "priest")] as Stage["leads"];
      }
      return { ...s, leads };
    });
    if (!led && st2.length) st2[0] = { ...st2[0], leads: [...new Set(["priest", ...(st2[0].leads ?? [])])] as Stage["leads"] };
    plan = { ...plan, stages: st2 };
  }
  const place = resolvePlace(db, plan.place);
  if (!place) return { ok: false, why: `no such place: ${plan.place}` };
  const stages = cleanStages(plan.stages);
  if (!stages.length) return { ok: false, why: "no stages the engine can play" };
  // the leads a scene or a wedding cannot do without: is there anyone free to play them now?
  const asks = leadAsks(db, stages, place);
  if (asks.length) {
    const taken = new Set(liveEvents(db).flatMap((o) => [...peopleOf(o), ...leadsOf(o).map((l) => l.id)]));
    const { leads: dry, missing } = pickLeads(db, asks.filter((a) => !(widowId && a.role === "widow")), taken, "dry");
    const must = missing.filter((m) => MUST_LEADS.includes(m) || (widowId !== undefined && m === "priest"));
    if (must.length) return { ok: false, why: `nobody free to be ${[...new Set(must)].join(", ")}` };
    // the title with the leads it will have (fixed again at the start with the ones it gets)
    plan = { ...plan, title: fitTitle(db, plan.title, [...dry, ...(widowId ? [{ role: "widow", id: widowId }] : [])]) };
  }
  plan = { ...plan, title: softText(plan.title), notice: softText(plan.notice ?? ""), rumour: softText(plan.rumour ?? "") };
  const now = gameMinute(db);
  const start = now + Math.max(0, Math.min(180, Math.round(plan.start_in_min)));
  const end = start + stages.reduce((a, s) => a + s.minutes, 0);
  // M6: the town's routine (the dawn hiring) is not one of the day's events and does not take a slot
  const routine = ROUTINE_TEMPLATES.has(plan.template);
  if (!opts.dev && !routine && eventsToday(db).length >= EVENTS_PER_DAY) return { ok: false, why: `${EVENTS_PER_DAY} events today already` };
  const live = liveEvents(db);
  const overlapping = live.filter((o) => o.start_m - EVENT_MARGIN_MIN < end && o.end_m + EVENT_MARGIN_MIN > start);
  for (const o of overlapping) {
    if (o.place === place.id) return { ok: false, why: `"${o.title}" is at ${place.label} then` };
    if (Math.hypot(o.x - place.x, o.z - place.z) < EVENT_NEAR_M) return { ok: false, why: `"${o.title}" is too near, at ${o.place}` };
  }
  if (!opts.dev && !routine && overlapping.filter((o) => !ROUTINE_TEMPLATES.has(o.template)).length >= EVENTS_AT_ONCE) return { ok: false, why: `${EVENTS_AT_ONCE} events run at once already` };
  // the engine puts every stage's place on the map now
  const stored: StoredStage[] = stages.map((s, i) => {
    const p = s.place ? resolvePlace(db, s.place) : null;
    const act = acts[i] ? { act: acts[i]! } : {};
    const widow = i === 0 && widowId !== undefined ? { widow: widowId } : {};
    return p ? { ...s, x: p.x, z: p.z, label: p.label, ...act, ...widow } : { ...s, x: place.x, z: place.z, label: place.label, ...act, ...widow };
  });
  const res = db
    .prepare(
      `INSERT INTO town_event (day, title, template, place, x, z, r, start_m, end_m, stage, stages_json, people_json, status, source, notice, rumour, why)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, -1, ?, '[]', 'planned', ?, ?, ?, ?)`,
    )
    .run(clock(db).day, plainEnglish(plan.title).slice(0, 80), plan.template.slice(0, 30), place.id, place.x, place.z, place.r, start, end, JSON.stringify(stored), plan.source, plainEnglish(plan.notice ?? "").slice(0, 160), plainEnglish(plan.rumour ?? "").slice(0, 160), (plan.why ?? "").slice(0, 200));
  const ev = eventRow(db, Number(res.lastInsertRowid))!;
  writeEvent(db, { kind: "event", verb: "planned", text: `Planned: ${ev.title} at ${place.label}, in ${start - now} minutes (${plan.source}).`, place: place.id, x: place.x, z: place.z, ref_type: "town_event", ref_id: ev.id, weight: 3 });
  notify("events");
  return { ok: true, event: ev };
}

export function cancelEvent(db: DB, id: number): void {
  const ev = eventRow(db, id);
  if (!ev || ev.status === "done" || ev.status === "cancelled") return;
  finishEvent(db, ev, "cancelled");
}

// ------------------------------------------------------------------ the clock

const stageEnd = (ev: EventRow, stages: StoredStage[], i: number) => ev.start_m + stages.slice(0, i + 1).reduce((a, s) => a + s.minutes, 0);

/** Every tick: start what is due, advance stages, end what is over. Returns how many changed. */
export function eventsTick(db: DB): number {
  // M6 town life: the naties' hiring is planned before dawn every working day
  hiringTick(db);
  const now = gameMinute(db);
  let changed = 0;
  for (const ev of liveEvents(db)) {
    const stages = stagesOf(ev);
    if (ev.status === "planned") {
      // the town's routine (the ballad singer, the dawn hiring) starts at the tick nearest its
      // hour, not up to a tick late (fixes 2026-09-24: the clock moves 15 minutes a tick)
      if (now < ev.start_m - (ROUTINE_TEMPLATES.has(ev.template) ? ROUTINE_EARLY_MIN : 0)) continue;
      if (now > ev.end_m) {
        // the clock jumped past it (a night, a dev jump): it never happened
        finishEvent(db, ev, "cancelled");
        changed++;
        continue;
      }
      startEvent(db, ev);
      changed++;
      continue;
    }
    let cur = eventRow(db, ev.id)!;
    let guard = 0;
    while (cur.status === "running" && now >= stageEnd(cur, stages, cur.stage) && guard++ < 10) {
      const next = cur.stage + 1;
      // a scene that just played is settled by the engine
      if (stagesOf(cur)[cur.stage]?.scene && !stagesOf(cur)[cur.stage].scene!.resolved) {
        resolveScene(db, cur, cur.stage);
        cur = eventRow(db, cur.id)!;
      }
      if (next >= stages.length) {
        finishEvent(db, cur, "done");
        changed++;
        break;
      }
      db.prepare("UPDATE town_event SET stage = ? WHERE id = ?").run(next, cur.id);
      cur = eventRow(db, cur.id)!;
      applyStage(db, cur, stages[next], next);
      changed++;
    }
  }
  if (changed) notify("events");
  return changed;
}

function startEvent(db: DB, ev: EventRow): void {
  db.prepare("UPDATE town_event SET status = 'running', stage = 0 WHERE id = ?").run(ev.id);
  let cur = eventRow(db, ev.id)!;
  const stages = stagesOf(cur);
  // M4b: the leads first (the bride and groom, the musicians ...), so the notice can name them
  const leads = castLeads(db, cur, stages);
  if (leads === null) {
    finishEvent(db, cur, "cancelled", "nobody free to play the leading parts");
    return;
  }
  cur = eventRow(db, ev.id)!;
  const who = leadLine(leads);
  writeEvent(db, { kind: "event", verb: "started", text: `${cur.title} began at ${stages[0]?.label ?? cur.place}${who ? `, with ${who}` : ""}.`, place: cur.place, x: cur.x, z: cur.z, ref_type: "town_event", ref_id: cur.id, weight: 6, who: leads.map((l) => l.id) });
  if (cur.notice) postNotice(db, cur, cur.notice);
  applyStage(db, cur, stages[0], 0);
  // Steve, 2026-09-24: "onlookers should already come running, walking, biking or take the tram to the
  // event". Every later gathering of onlookers (role crowd) is called now, so the crowd is already
  // there when the event visibly starts; at its own turn the stage keeps only its sound and mood.
  // Not for a robbery: nobody knows it is coming.
  const secret = stages.some((s) => s.op === "robbery");
  let pre = false;
  // M6: the first stage's act may have stored its own set-up (a fire's house and chain): read them again
  const now = stagesOf(eventRow(db, cur.id)!);
  now.forEach((s, i) => {
    if (i === 0 || s.op !== "gather" || s.role !== "crowd" || secret || !s.count) return;
    gather(db, eventRow(db, cur.id)!, s.role, s.count, { x: s.x ?? cur.x, z: s.z ?? cur.z }, s.label ?? cur.place);
    s.pre = true;
    pre = true;
  });
  if (pre) db.prepare("UPDATE town_event SET stages_json = ? WHERE id = ?").run(JSON.stringify(now), cur.id);
}

/**
 * M4b: pick the leads (leads.ts), give each an attend action to their spot at the place of
 * the stage that first names them, and put them first in the event's people. null: a lead
 * the event cannot do without was nobody free.
 */
function castLeads(db: DB, ev: EventRow, stages: StoredStage[]): Lead[] | null {
  const asks: LeadAsk[] = [];
  stages.forEach((s, i) => {
    if (s.op === "procession") return;
    for (const role of cleanLeads(s.leads)) asks.push({ role, stage: i, at: { x: s.x ?? ev.x, z: s.z ?? ev.z } });
  });
  stages.forEach((s) => {
    if (s.op !== "procession") return;
    for (const role of cleanLeads(s.leads)) if (!asks.some((a) => a.role === role)) asks.push({ role, stage: 0, at: { x: stages[0]?.x ?? ev.x, z: stages[0]?.z ?? ev.z } });
  });
  if (!asks.length) return [];
  const taken = new Set(liveEvents(db).filter((o) => o.id !== ev.id).flatMap((o) => [...peopleOf(o), ...leadsOf(o).map((l) => l.id)]));
  // a funeral's widow is the engine's (planEvent): the real widow, or nobody
  const funeral = stages[0]?.widow !== undefined;
  const widowAsk = asks.find((a) => a.role === "widow");
  const { leads, missing } = pickLeads(db, funeral ? asks.filter((a) => a.role !== "widow") : asks, taken, String(ev.id));
  if (funeral && widowAsk && stages[0].widow) {
    const w = resident(db, stages[0].widow);
    if (w && !taken.has(w.id)) leads.push({ role: "widow", id: w.id, name: w.name, stage: widowAsk.stage });
  }
  if (missing.some((m) => MUST_LEADS.includes(m) || (funeral && m === "priest"))) return null;
  // the title with the leads it really has
  const fitted = fitTitle(db, ev.title, leads);
  if (fitted !== ev.title) db.prepare("UPDATE town_event SET title = ? WHERE id = ?").run(fitted.slice(0, 80), ev.id);
  if (missing.length) writeEvent(db, { kind: "event", verb: "no_lead", text: `${ev.title}: nobody free to be ${[...new Set(missing)].join(", ")}; it goes on without.`, ref_type: "town_event", ref_id: ev.id, weight: 1 });
  const now = gameMinute(db);
  const wm = walkMap();
  leads.forEach((l, i) => {
    const s = stages[l.stage];
    const at = { x: s?.x ?? ev.x, z: s?.z ?? ev.z };
    const spot = leadSpot(l, leads, at);
    const q = wm.nearestOpen(spot.x, spot.z, 4) ?? at;
    startAction(db, { npc_id: l.id, kind: "attend", target: ev.title, target_x: q.x, target_z: q.z, source: "event", event_id: ev.id, minutes: Math.max(5, ev.end_m - now), data: { order: i, about: s?.label ?? ev.place, role: "lead", lead: l.role, n: l.n } });
  });
  const people = [...leads.map((l) => l.id), ...peopleOf(ev).filter((id) => !leads.some((l) => l.id === id))];
  db.prepare("UPDATE town_event SET leads_json = ?, people_json = ? WHERE id = ?").run(JSON.stringify(leads), JSON.stringify(people), ev.id);
  return leads;
}

/** The police agent on duty for a scene: a lead of the engine's own, sent to the spot. */
export function castAgent(db: DB, ev: EventRow, agentId: string, spot: { x: number; z: number }): void {
  castEngineLead(db, ev, agentId, "agent", spot);
}

/**
 * A lead the ENGINE casts itself (the police agent of a scene; M6: a fireman, the natie
 * foreman): an attend action to the spot, and first-class in the event's leads and people.
 */
export function castEngineLead(db: DB, ev: EventRow, id: string, role: AnyLeadRole, spot: { x: number; z: number }, n?: number): boolean {
  const r = resident(db, id);
  if (!r) return false;
  ev = eventRow(db, ev.id) ?? ev;
  const leads = leadsOf(ev);
  if (leads.some((l) => l.id === id)) return false;
  const lead: Lead = { role, id, name: r.name, stage: Math.max(0, ev.stage), ...(n !== undefined ? { n } : {}) };
  const q = walkMap().nearestOpen(spot.x, spot.z, 4) ?? spot;
  const old = actionOf(db, id);
  if (old && old.event_id === ev.id) endAction(db, old.id, "done", "a part in it");
  startAction(db, { npc_id: id, kind: "attend", target: ev.title, target_x: q.x, target_z: q.z, source: "event", event_id: ev.id, minutes: Math.max(5, ev.end_m - gameMinute(db)), data: { order: peopleOf(ev).length, about: ev.place, role: "lead", lead: role, ...(n !== undefined ? { n } : {}) } });
  const people = peopleOf(ev).includes(id) ? peopleOf(ev) : [...peopleOf(ev), id];
  db.prepare("UPDATE town_event SET leads_json = ?, people_json = ? WHERE id = ?").run(JSON.stringify([...leads, lead]), JSON.stringify(people), ev.id);
  return true;
}

/**
 * M6: people to fixed places of an event (a bucket chain in a line, dockers before the
 * foreman): each gets an attend action to their slot. `ids` in the order of the slots; those
 * already in this event are moved, others join it. Returns who was placed.
 */
export function placeAt(db: DB, ev: EventRow, ids: string[], slots: Array<{ x: number; z: number }>, role: string, extra: (i: number) => Record<string, unknown> = () => ({})): string[] {
  ev = eventRow(db, ev.id) ?? ev;
  const have = peopleOf(ev);
  const now = gameMinute(db);
  const placed: string[] = [];
  ids.slice(0, slots.length).forEach((id, i) => {
    const q = slots[i];
    const a = actionOf(db, id);
    if (a && a.event_id === ev.id) {
      db.prepare("UPDATE npc_action SET target_x = ?, target_z = ?, phase = 'going', data_json = json_set(json_set(data_json, '$.role', ?), '$.slot', ?) WHERE id = ?").run(q.x, q.z, role, i, a.id);
      for (const [k, v] of Object.entries(extra(i))) db.prepare("UPDATE npc_action SET data_json = json_set(data_json, ?, ?) WHERE id = ?").run(`$.${k}`, typeof v === "object" ? JSON.stringify(v) : v, a.id);
    } else {
      if (a) return; // busy with something else
      startAction(db, { npc_id: id, kind: "attend", target: ev.title, target_x: q.x, target_z: q.z, source: "event", event_id: ev.id, minutes: Math.max(5, ev.end_m - now), data: { order: have.length + i, about: ev.place, role, ...({ slot: i, ...extra(i) } as object) } as NonNullable<Parameters<typeof startAction>[1]["data"]> });
    }
    placed.push(id);
  });
  const all = [...have, ...placed.filter((id) => !have.includes(id))];
  db.prepare("UPDATE town_event SET people_json = ? WHERE id = ?").run(JSON.stringify(all), ev.id);
  notify("actions");
  return placed;
}

/** M6: free residents for an event's own use (not in another event, not busy, not reserved, not an employer at a post). */
export function freeResidents(db: DB, ev: EventRow, ok: (r: Resident) => boolean, o: { evenAtWork?: boolean } = {}): Resident[] {
  const inOthers = new Set(liveEvents(db).filter((o) => o.id !== ev.id).flatMap((o) => [...peopleOf(o), ...leadsOf(o).map((l) => l.id)]));
  const busy = new Set(activeActions(db).filter((a) => a.event_id !== ev.id).map((a) => a.npc_id));
  for (const id of onErrand(db)) busy.add(id);
  // a counter, a post or a landmark's staff at work stays there (keptAtWork); a household whose own house burns runs home
  return town(db).town.residents.filter((r) => !inOthers.has(r.id) && !busy.has(r.id) && !TOWN_EMPLOYER_IDS.includes(r.id) && r.trade !== "infant" && r.work.kind !== "guard" && !isEmigrant(r) && !visitorOf(r) && !isReserved(db, r.id) && (o.evenAtWork || !keptAtWork(db, r)) && ok(r));
}

/** M6: take someone out of an event (the man the foreman picked goes to his ship). */
export function releaseFromEvent(db: DB, ev: EventRow, id: string, why: string): void {
  const a = actionOf(db, id);
  if (a && a.event_id === ev.id) endAction(db, a.id, "done", why);
}

function finishEvent(db: DB, ev: EventRow, status: "done" | "cancelled", why = ""): void {
  // a scene that was playing is settled by the engine first
  if (status === "done" && ev.stage >= 0) {
    const st = stagesOf(ev)[ev.stage];
    if (st?.scene && !st.scene.resolved) resolveScene(db, ev, ev.stage);
    ev = eventRow(db, ev.id) ?? ev;
  }
  // M6 town life: a fire leaves its soot and settles Jef's place in the chain; the hiring its record
  if (ev.template === "house_fire") fireEnd(db, ev, status);
  if (ev.template === "hiring") hiringEnd(db, ev, status);
  db.prepare("UPDATE town_event SET status = ? WHERE id = ?").run(status, ev.id);
  endEventActions(db, ev.id);
  // prices back, places open again
  const prices = state<Record<string, { factor: number; event: number }>>(db, "m4_prices", {});
  for (const k of Object.keys(prices)) if (prices[k].event === ev.id) delete prices[k];
  setState(db, "m4_prices", prices);
  const closed = state<Record<string, number>>(db, "m4_closed", {});
  for (const k of Object.keys(closed)) if (closed[k] === ev.id) delete closed[k];
  setState(db, "m4_closed", closed);
  if (status === "done") {
    if (ev.rumour) postRumour(db, ev, ev.rumour);
    writeEvent(db, { kind: "event", verb: "ended", text: `${ev.title} ended.`, place: ev.place, x: ev.x, z: ev.z, ref_type: "town_event", ref_id: ev.id, weight: 4, who: peopleOf(ev) });
  } else writeEvent(db, { kind: "event", verb: "cancelled", text: `${ev.title} was called off${why ? ` (${why})` : ""}.`, place: ev.place, ref_type: "town_event", ref_id: ev.id, weight: 2 });
  notify("events");
}

// ------------------------------------------------------------------ the primitives

function applyStage(db: DB, ev: EventRow, s: StoredStage, i: number): void {
  const at = { x: s.x ?? ev.x, z: s.z ?? ev.z };
  // M6 town life: a scripted act does the stage's work itself (fire.ts, hiring.ts)
  if (s.act) {
    if (s.act.startsWith("fire_")) runFireAct(db, ev, s, i);
    else if (s.act.startsWith("hire_")) runHiringAct(db, ev, s, i);
    else if (s.act.startsWith("ballad_")) runBalladAct(db, ev, s, i); // M6 ballads: the singer and his crowd
    writeEvent(db, { kind: "event", verb: `stage_${s.act}`, text: `${ev.title}: ${s.act.replace(/_/g, " ")}${s.label ? ` at ${s.label}` : ""}.`, place: ev.place, x: at.x, z: at.z, ref_type: "town_event", ref_id: ev.id, weight: i === 0 ? 3 : 2 });
    return;
  }
  switch (s.op) {
    case "gather":
      if (!s.pre && s.count > 0) gather(db, ev, s.role, s.count, at, s.label ?? ev.place);
      break;
    case "procession":
      procession(db, ev, at, cleanLeads(s.leads));
      break;
    case "talk": {
      // the stage's two leads if it names two (the quarrellers), else two of the gathered who are not leads
      const leads = leadsOf(ev);
      const named = cleanLeads(s.leads).flatMap((role) => leads.filter((l) => l.role === role).map((l) => l.id));
      const others = peopleOf(ev).filter((id) => !leads.some((l) => l.id === id) && (resident(db, id)?.age ?? 0) >= 14);
      const all = peopleOf(ev).filter((id) => (resident(db, id)?.age ?? 0) >= 14);
      const people = [...new Set(named)].length >= 2 ? [...new Set(named)] : others.length >= 2 ? others : all;
      if (people.length >= 2) {
        const purpose = s.mood === "tense" ? "argue" : "chat";
        const who = leadLine(leads);
        // the talkers' parts go with it, so the model knows who is the preacher and who the drunk
        const parts = leadLine(leads.filter((l) => l.id === people[0] || l.id === people[1]));
        const tell = parts ? `; ${parts}` : who ? ` (${who})` : "";
        void runConvo(db, { a: people[0], b: people[1], purpose, about: `${s.text || ev.title}${tell}`, event_id: ev.id }).catch((e) => console.warn("[events] talk", e));
      }
      break;
    }
    case "scuffle":
    case "robbery":
      applyScene(db, ev, s, i);
      break;
    case "notice":
      if (s.text) postNotice(db, ev, s.text);
      break;
    case "rumour":
      if (s.text) postRumour(db, ev, s.text);
      break;
    case "price": {
      const prices = state<Record<string, { factor: number; event: number }>>(db, "m4_prices", {});
      prices[s.item] = { factor: s.factor, event: ev.id };
      setState(db, "m4_prices", prices);
      writeEvent(db, { kind: "event", verb: "price", text: `${ITEMS[s.item]?.name ?? s.item} at ${s.factor} times the price, for ${ev.title}.`, ref_type: "town_event", ref_id: ev.id, weight: 3 });
      break;
    }
    case "close":
    case "open": {
      const closed = state<Record<string, number>>(db, "m4_closed", {});
      const pid = s.place || ev.place;
      if (s.op === "close") closed[pid] = ev.id;
      else delete closed[pid];
      setState(db, "m4_closed", closed);
      break;
    }
    case "job":
      postJob(db, ev, s);
      break;
    case "weather":
      changeWeather(db, ev, s.text);
      break;
    default:
      break; // sound and props: the client plays them by the stage
  }
  writeEvent(db, { kind: "event", verb: `stage_${s.op}`, text: `${ev.title}: ${s.op}${s.label ? ` at ${s.label}` : ""}${s.text ? ` (${s.text})` : ""}.`, place: ev.place, x: at.x, z: at.z, ref_type: "town_event", ref_id: ev.id, weight: i === 0 ? 3 : 2 });
}

/** M4b: the leads' names in a notice or a rumour: "{bride}" filled in, or the names added. */
export function withNames(ev: EventRow, text: string): string {
  const leads = leadsOf(ev).filter((l) => l.role !== "agent");
  let t = fillNames(plainEnglish(text), leads);
  if (leads.length && !namesIn(t, leads)) t = `${t.replace(/[.\s]*$/, ".")} With ${leadLine(leads)}.`;
  return t;
}

function postNotice(db: DB, ev: EventRow, text: string): void {
  const t = withNames(ev, text).slice(0, 240);
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 5, ?, ?)").run(t, clock(db).day, `notice,event:${ev.id}`);
  writeEvent(db, { kind: "event", verb: "notice", text: `A notice went up: ${t}`, place: ev.place, ref_type: "town_event", ref_id: ev.id, weight: 3, who: leadsOf(ev).map((l) => l.id) });
}

function postRumour(db: DB, ev: EventRow, text: string): void {
  const t = withNames(ev, text).slice(0, 240);
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 6, ?, ?)").run(t, clock(db).day, `rumour,event:${ev.id}`);
  for (const id of peopleOf(ev).slice(0, 12)) remember(db, id, t, 4);
  writeEvent(db, { kind: "rumour", verb: "town_rumour", text: t, place: ev.place, ref_type: "town_event", ref_id: ev.id, weight: 4 });
}

function fits(r: Resident, role: GatherRole, db: DB, place = ""): boolean {
  if (r.trade === "infant") return false;
  // the guard (town/garrison.ts) never leaves the post for an event, on a tour or in the guard room
  if (r.work.kind === "guard") return false;
  const c = clock(db);
  const now = activityAt(r.sched, c.day, c.hour + c.minute / 60);
  // M6: the lamplighter on his round does not stop for an event
  if (r.trade === "lamplighter" && now.act === "work") return false;
  // M6 emigrants: a family gathering takes only the households boarding today; nobody else takes an emigrant from the chests
  if (role === "family") return isEmigrant(r) && emigrantShip(db).households.includes(r.household) && r.age >= 6;
  if (isEmigrant(r)) return false;
  const keeperAtWork = keptAtWork(db, r);
  switch (role) {
    case "police":
      return r.trade === "police";
    case "sellers":
      // sellers at their own market may stand for it; nobody leaves a counter elsewhere
      return (r.work.kind === "stall" || r.work.kind === "shop") && (!keeperAtWork || (!!place && r.work.place === place));
    case "children":
      return r.age < 13;
    case "musicians":
      return r.sex === "m" && r.age >= 16 && ["sailor", "retired", "beggar", "docker", "boatman", "carter"].includes(r.trade) && !keeperAtWork;
    case "mourners":
      return r.age >= 14 && r.trade !== "thief" && !keeperAtWork && r.trade !== "police";
    case "guests":
      return r.age >= 8 && r.trade !== "thief" && r.trade !== "beggar" && !keeperAtWork && r.trade !== "police";
    default:
      return r.age >= 8 && !keeperAtWork && r.trade !== "police";
  }
}

/**
 * Fixes 2026-09-24: who is out on the day's errand with the family boat or a dray now (half an
 * hour either side): not taken for an event (the ballad's crowd took Karel Van Loock from his
 * boat errand, and the boat never came).
 */
export function onErrand(db: DB): Set<string> {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  return new Set(errandsFor(db, c.day).filter((e) => h >= e.hour - 0.5 && h < e.back + 0.5).flatMap((e) => e.who));
}

/** The people of a gathering: free, fitting, near, not in anything else; each gets an attend action to a ring round the spot. */
export function gather(db: DB, ev: EventRow, role: GatherRole, count: number, at: { x: number; z: number }, label: string): string[] {
  const have = peopleOf(ev);
  const inOthers = new Set(liveEvents(db).filter((o) => o.id !== ev.id).flatMap((o) => [...peopleOf(o), ...leadsOf(o).map((l) => l.id)]));
  const busy = new Set(activeActions(db).map((a) => a.npc_id));
  for (const id of onErrand(db)) busy.add(id);
  const wm = walkMap();
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
  };
  let pool = town(db)
    .town.residents.filter((r) => !have.includes(r.id) && !inOthers.has(r.id) && !busy.has(r.id) && !TOWN_EMPLOYER_IDS.includes(r.id) && !isReserved(db, r.id) && fits(r, role, db, ev.place))
    .map((r) => ({ r, d: Math.hypot(r.home.sx - at.x, r.home.sz - at.z) + hash(r.id + ev.id) * 60 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.r);
  if (role === "family" && pool.length) {
    const hh = pool[0].household;
    pool = pool.filter((r) => r.household === hh);
  }
  // M4b: one event never takes more than EVENT_PEOPLE_MAX of the town, leads included
  const cap = eventPeopleMax(db); // Settings: the biggest event (20, 50 or 100), never over EVENT_PEOPLE_MAX
  const room = Math.max(0, cap - have.length);
  const picked = pool.slice(0, Math.min(room, Math.max(GATHER_MIN, Math.min(GATHER_MAX, cap, count))));
  const n = picked.length;
  const now = gameMinute(db);
  // M4b: up to a hundred round the leads, in rows: the first ring a few metres out, then ring
  // after ring a metre further, a place every 0.9 m; a later gathering fills the rows behind
  const inRing = have.length - leadsOf(ev).length;
  const r0 = Math.min(Math.max(2.5, ev.r * 0.35), 4);
  const slot = (k: number): { d: number; a: number } => {
    let j = 0;
    let left = k;
    for (;;) {
      const cap = Math.max(6, Math.floor((2 * Math.PI * (r0 + j)) / 0.9));
      if (left < cap) return { d: r0 + j, a: (left / cap) * Math.PI * 2 + j * 0.37 };
      left -= cap;
      j++;
    }
  };
  picked.forEach((r, i) => {
    // the old musicians' role plays in the middle, close together; everyone else stands in the rows
    const { d, a } = role === "musicians" ? { d: 0.9, a: (i / Math.max(1, n)) * Math.PI * 2 } : slot(Math.max(0, inRing) + i);
    const q = wm.nearestOpen(at.x + Math.cos(a) * d, at.z + Math.sin(a) * d, 6) ?? at;
    startAction(db, { npc_id: r.id, kind: "attend", target: ev.title, target_x: q.x, target_z: q.z, source: "event", event_id: ev.id, minutes: Math.max(5, ev.end_m - now), data: { order: have.length + i, about: label, role } });
  });
  const all = [...have, ...picked.map((r) => r.id)];
  db.prepare("UPDATE town_event SET people_json = ? WHERE id = ?").run(JSON.stringify(all), ev.id);
  return picked.map((r) => r.id);
}

/**
 * The gathered walk in a column to the stage's place; the event moves there. M4b: the
 * stage's leads walk first, in their order (the groom, then the bride on his arm; the
 * bearers two by two); a priest who is not named stays at his church.
 */
function procession(db: DB, ev: EventRow, to: { x: number; z: number }, first: LeadRole[] = []): void {
  const wm = walkMap();
  const leads = leadsOf(ev);
  const front: string[] = [];
  for (const role of first) for (const l of leads.filter((x) => x.role === role).sort((a, b) => (a.n ?? 0) - (b.n ?? 0))) if (!front.includes(l.id)) front.push(l.id);
  const stays = leads.filter((l) => l.role === "priest" && !first.includes("priest")).map((l) => l.id);
  for (const id of stays) {
    const a = actionOf(db, id);
    if (a && a.event_id === ev.id) endAction(db, a.id, "done", "stays at the church");
  }
  const people = [...front, ...peopleOf(ev).filter((id) => !front.includes(id) && !stays.includes(id))];
  db.prepare("UPDATE town_event SET people_json = ? WHERE id = ?").run(JSON.stringify([...people, ...stays]), ev.id);
  people.forEach((id, i) => {
    const a = actionOf(db, id);
    if (!a || a.event_id !== ev.id) return;
    const q = wm.nearestOpen(to.x + ((i % 4) - 1.5) * 1.1, to.z - Math.floor(i / 4) * 1.2 - 1, 6) ?? to;
    db.prepare("UPDATE npc_action SET phase = 'procession', target_x = ?, target_z = ?, data_json = json_set(data_json, '$.order', ?) WHERE id = ?").run(q.x, q.z, i, a.id);
  });
  db.prepare("UPDATE town_event SET x = ?, z = ? WHERE id = ?").run(to.x, to.z, ev.id);
}

/** A piece of work for Jef on the board, through the board's own rules (engine pay). */
function postJob(db: DB, ev: EventRow, s: StoredStage): void {
  const at = { x: s.x ?? ev.x, z: s.z ?? ev.z };
  const doorOf = (id: string) => SPOTS[ALL_EMPLOYERS[id].door];
  const emp = TOWN_EMPLOYERS.map((e) => ({ e, d: Math.hypot(doorOf(e.id).x - at.x, doorOf(e.id).z - at.z) })).sort((a, b) => a.d - b.d)[0]?.e;
  const employer = emp && Math.hypot(doorOf(emp.id).x - at.x, doorOf(emp.id).z - at.z) < 160 ? emp.id : "sooi";
  const def = ALL_EMPLOYERS[employer];
  const from = def.area.find((a) => a !== def.door) ?? def.door;
  const board: Board = {
    jobs: [
      {
        title: s.text ? plainEnglish(s.text).slice(0, 70) : `Hands wanted: ${ev.title.toLowerCase()}`,
        employer,
        task_type: "carry",
        goods: "sacks",
        from,
        to: def.door,
        twist: "none",
        urgent: false,
        recipient: "",
        pay_c: 70,
        risk: "low",
        pitch: `Extra hands wanted for ${ev.title.toLowerCase()}. Paid by the load, today only.`,
      },
    ],
  };
  const clamped = clampBoard(board, maxTier(db)).jobs[0];
  const task = taskFor(clamped);
  if (!task) return;
  const c = clock(db);
  const district = def.town ? ((db.prepare("SELECT district FROM npc WHERE id = ?").get(employer) as { district: string } | undefined)?.district ?? "town") : "rijnkaai";
  db.prepare(
    `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
     VALUES (?, ?, ?, ?, 'carry', ?, 'low', ?, ?, ?, ?, 'event', 'offered')`,
  ).run(c.day, clamped.title, employer, district, clamped.pay_c, maxTier(db), def.faction, clamped.pitch, JSON.stringify(task));
  writeEvent(db, { kind: "job", verb: "event_job", text: `Work went up on the board for ${ev.title}: "${clamped.title}", ${clamped.pay_c} centimes.`, ref_type: "town_event", ref_id: ev.id, weight: 4 });
  notify("events", { jobs: true });
}

/** The sky changes once a day at most, and only to a known kind. */
function changeWeather(db: DB, ev: EventRow, kind: string): void {
  const c = clock(db);
  if (state<number>(db, "m4_weather_day", 0) === c.day) return;
  const w = kind.trim().toLowerCase() as Weather;
  if (!["fog", "mist", "clear", "rain", "storm"].includes(w)) return;
  setWeather(db, w);
  setState(db, "m4_weather_day", c.day);
  writeEvent(db, { kind: "event", verb: "weather", text: `The weather turned to ${w} (${ev.title}).`, ref_type: "town_event", ref_id: ev.id, weight: 4 });
  notify("events", { jobs: true });
}

// ------------------------------------------------------------------ for the client and the prompts

export function publicEvent(db: DB, ev: EventRow) {
  const stages = stagesOf(ev);
  const now = gameMinute(db);
  return {
    id: ev.id,
    title: ev.title,
    template: ev.template,
    place: ev.place,
    x: ev.x,
    z: ev.z,
    r: ev.r,
    status: ev.status,
    stage: ev.stage,
    stages: stages.map((s) => ({ op: s.op, minutes: s.minutes, sound: s.sound, mood: s.mood, props: s.props, x: s.x ?? ev.x, z: s.z ?? ev.z, label: s.label ?? ev.place, text: s.text, count: s.count, leads: s.leads ?? [], cues: s.cues ?? [] })),
    people: peopleOf(ev),
    /** M4b: the leads with their parts, and the scene now playing (a scuffle, a robbery). */
    leads: leadsOf(ev).map((l) => ({ role: l.role, id: l.id, name: l.name, n: l.n ?? 0 })),
    scene: ev.status === "running" && ev.stage >= 0 ? sceneForClient(stages[ev.stage]) : null,
    /** M6 town life: the house fire (the house, the water, the chain, the pump's way) and the dawn hiring (the spots, the call). */
    acts: stages.map((s) => s.act ?? null),
    fire: ev.template === "house_fire" ? fireForClient(stages) : null,
    hiring: ev.template === "hiring" ? hiringForClient(stages) : null,
    /** Game minutes left in the stage now playing (the client starts a late sound for the rest of it). */
    stage_left: ev.status === "running" && ev.stage >= 0 ? Math.max(0, stageEnd(ev, stages, ev.stage) - now) : 0,
    starts_in: Math.max(0, ev.start_m - now),
    ends_in: Math.max(0, ev.end_m - now),
    source: ev.source,
  };
}

export function listEvents(db: DB) {
  return liveEvents(db).map((ev) => publicEvent(db, ev));
}

export function clearEvents(db: DB): void {
  db.prepare("DELETE FROM town_event").run();
  setState(db, "m4_prices", {});
  setState(db, "m4_closed", {});
}
