import type { DB } from "../db.ts";
import { clock, setWeather, type Weather } from "../day.ts";
import { ALL_EMPLOYERS, SPOTS, clampBoard, maxTier, taskFor, type Board } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { plainEnglish } from "../text.ts";
import { ITEMS } from "../trade.ts";
import { gameMinute } from "../town/deeds.ts";
import { PLACES, TOWN_EMPLOYERS } from "../town/places.ts";
import type { Resident } from "../town/population.ts";
import { activityAt } from "../town/schedule.ts";
import { resident, town, TOWN_EMPLOYER_IDS } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { setState, state } from "./state.ts";
import { actionOf, activeActions, endEventActions, isReserved, startAction } from "./actions.ts";
import { notify } from "./bus.ts";
import { runConvo } from "./convo.ts";
import { writeEvent } from "./eventlog.ts";
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
  StageSchema,
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
export type StoredStage = Stage & { x?: number; z?: number; label?: string };

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

const stagesOf = (ev: EventRow): StoredStage[] => JSON.parse(ev.stages_json) as StoredStage[];
const peopleOf = (ev: EventRow): string[] => JSON.parse(ev.people_json) as string[];

/** A stage with every field, from a partial one (the templates). */
export function stage(s: Partial<Stage> & { op: Stage["op"]; minutes: number }): Stage {
  return { place: "", role: "crowd", count: 0, sound: "none", mood: "calm", props: "none", text: "", item: "", factor: 1, ...s };
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
  for (const s of raw.slice(0, EVENT_MAX_STAGES)) {
    const p = StageSchema.safeParse(s);
    if (!p.success) continue;
    const st = { ...p.data };
    const num = (n: number, lo: number, hi: number, dflt: number) => (Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt);
    st.minutes = Math.round(num(st.minutes, STAGE_MIN_MIN, STAGE_MAX_MIN, STAGE_MIN_MIN));
    st.count = st.op === "gather" ? Math.round(num(st.count, GATHER_MIN, GATHER_MAX, 6)) : Math.round(num(st.count, 0, GATHER_MAX, 0));
    st.factor = st.op === "price" ? num(st.factor, PRICE_MIN, PRICE_MAX, 1) : 1;
    st.text = plainEnglish(st.text).slice(0, 160);
    st.item = st.item.trim().toLowerCase();
    if (st.op === "price" && !(st.item in ITEMS)) continue;
    out.push(st);
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

// ------------------------------------------------------------------ rows

export function eventRow(db: DB, id: number): EventRow | null {
  return (db.prepare("SELECT * FROM town_event WHERE id = ?").get(id) as EventRow | undefined) ?? null;
}

export function liveEvents(db: DB): EventRow[] {
  return db.prepare("SELECT * FROM town_event WHERE status IN ('planned', 'running') ORDER BY start_m").all() as EventRow[];
}

export function eventsToday(db: DB): EventRow[] {
  return db.prepare("SELECT * FROM town_event WHERE day = ? AND status <> 'cancelled' ORDER BY id").all(clock(db).day) as EventRow[];
}

// ------------------------------------------------------------------ planning

export type PlanResult = { ok: true; event: EventRow } | { ok: false; why: string };

/** Plan an event: the checks, then the row. Nothing happens until its start. */
export function planEvent(db: DB, plan: EventPlan): PlanResult {
  const place = resolvePlace(db, plan.place);
  if (!place) return { ok: false, why: `no such place: ${plan.place}` };
  const stages = cleanStages(plan.stages);
  if (!stages.length) return { ok: false, why: "no stages the engine can play" };
  const now = gameMinute(db);
  const start = now + Math.max(0, Math.min(180, Math.round(plan.start_in_min)));
  const end = start + stages.reduce((a, s) => a + s.minutes, 0);
  if (eventsToday(db).length >= EVENTS_PER_DAY) return { ok: false, why: `${EVENTS_PER_DAY} events today already` };
  const live = liveEvents(db);
  const overlapping = live.filter((o) => o.start_m - EVENT_MARGIN_MIN < end && o.end_m + EVENT_MARGIN_MIN > start);
  for (const o of overlapping) {
    if (o.place === place.id) return { ok: false, why: `"${o.title}" is at ${place.label} then` };
    if (Math.hypot(o.x - place.x, o.z - place.z) < EVENT_NEAR_M) return { ok: false, why: `"${o.title}" is too near, at ${o.place}` };
  }
  if (overlapping.length >= EVENTS_AT_ONCE) return { ok: false, why: `${EVENTS_AT_ONCE} events run at once already` };
  // the engine puts every stage's place on the map now
  const stored: StoredStage[] = stages.map((s) => {
    const p = s.place ? resolvePlace(db, s.place) : null;
    return p ? { ...s, x: p.x, z: p.z, label: p.label } : { ...s, x: place.x, z: place.z, label: place.label };
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
  const now = gameMinute(db);
  let changed = 0;
  for (const ev of liveEvents(db)) {
    const stages = stagesOf(ev);
    if (ev.status === "planned") {
      if (now < ev.start_m) continue;
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
  const cur = eventRow(db, ev.id)!;
  writeEvent(db, { kind: "event", verb: "started", text: `${cur.title} began at ${stagesOf(cur)[0]?.label ?? cur.place}.`, place: cur.place, x: cur.x, z: cur.z, ref_type: "town_event", ref_id: cur.id, weight: 6 });
  if (cur.notice) postNotice(db, cur, cur.notice);
  applyStage(db, cur, stagesOf(cur)[0], 0);
}

function finishEvent(db: DB, ev: EventRow, status: "done" | "cancelled"): void {
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
  } else writeEvent(db, { kind: "event", verb: "cancelled", text: `${ev.title} was called off.`, place: ev.place, ref_type: "town_event", ref_id: ev.id, weight: 2 });
  notify("events");
}

// ------------------------------------------------------------------ the primitives

function applyStage(db: DB, ev: EventRow, s: StoredStage, i: number): void {
  const at = { x: s.x ?? ev.x, z: s.z ?? ev.z };
  switch (s.op) {
    case "gather":
      gather(db, ev, s.role, s.count, at, s.label ?? ev.place);
      break;
    case "procession":
      procession(db, ev, at);
      break;
    case "talk": {
      const people = peopleOf(ev).filter((id) => (resident(db, id)?.age ?? 0) >= 14);
      if (people.length >= 2) {
        const purpose = s.mood === "tense" ? "argue" : "chat";
        void runConvo(db, { a: people[0], b: people[1], purpose, about: s.text || ev.title, event_id: ev.id }).catch((e) => console.warn("[events] talk", e));
      }
      break;
    }
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

function postNotice(db: DB, ev: EventRow, text: string): void {
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 5, ?, ?)").run(plainEnglish(text).slice(0, 160), clock(db).day, `notice,event:${ev.id}`);
  writeEvent(db, { kind: "event", verb: "notice", text: `A notice went up: ${text}`, place: ev.place, ref_type: "town_event", ref_id: ev.id, weight: 3 });
}

function postRumour(db: DB, ev: EventRow, text: string): void {
  const t = plainEnglish(text).slice(0, 160);
  db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 6, ?, ?)").run(t, clock(db).day, `rumour,event:${ev.id}`);
  for (const id of peopleOf(ev).slice(0, 12)) remember(db, id, t, 4);
  writeEvent(db, { kind: "rumour", verb: "town_rumour", text: t, place: ev.place, ref_type: "town_event", ref_id: ev.id, weight: 4 });
}

function fits(r: Resident, role: GatherRole, db: DB): boolean {
  if (r.trade === "infant") return false;
  const c = clock(db);
  const now = activityAt(r.sched, c.day, c.hour + c.minute / 60);
  const keeperAtWork = (r.work.kind === "stall" || r.work.kind === "shop" || r.work.kind === "tavern") && now.act === "work";
  switch (role) {
    case "police":
      return r.trade === "police";
    case "sellers":
      return r.work.kind === "stall" || r.work.kind === "shop";
    case "children":
      return r.age < 13;
    case "musicians":
      return r.sex === "m" && r.age >= 16 && ["sailor", "retired", "beggar", "docker", "boatman", "carter"].includes(r.trade) && !keeperAtWork;
    case "mourners":
      return r.age >= 14 && r.trade !== "thief" && !keeperAtWork && r.trade !== "police";
    case "guests":
      return r.age >= 8 && r.trade !== "thief" && r.trade !== "beggar" && !keeperAtWork && r.trade !== "police";
    case "family":
      return r.age >= 6 && !keeperAtWork;
    default:
      return r.age >= 8 && !keeperAtWork && r.trade !== "police";
  }
}

/** The people of a gathering: free, fitting, near, not in anything else; each gets an attend action to a ring round the spot. */
export function gather(db: DB, ev: EventRow, role: GatherRole, count: number, at: { x: number; z: number }, label: string): string[] {
  const have = peopleOf(ev);
  const inOthers = new Set(liveEvents(db).filter((o) => o.id !== ev.id).flatMap(peopleOf));
  const busy = new Set(activeActions(db).map((a) => a.npc_id));
  const wm = walkMap();
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0) / 4294967296;
  };
  let pool = town(db)
    .town.residents.filter((r) => !have.includes(r.id) && !inOthers.has(r.id) && !busy.has(r.id) && !TOWN_EMPLOYER_IDS.includes(r.id) && !isReserved(db, r.id) && fits(r, role, db))
    .map((r) => ({ r, d: Math.hypot(r.home.sx - at.x, r.home.sz - at.z) + hash(r.id + ev.id) * 60 }))
    .sort((a, b) => a.d - b.d)
    .map((x) => x.r);
  if (role === "family" && pool.length) {
    const hh = pool[0].household;
    pool = pool.filter((r) => r.household === hh);
  }
  const picked = pool.slice(0, Math.max(GATHER_MIN, Math.min(GATHER_MAX, count)));
  const n = picked.length;
  const ring = Math.min(Math.max(2.5, ev.r * 0.6), 6) + n / 5;
  const now = gameMinute(db);
  picked.forEach((r, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + hash(ev.id + ":" + i) * 0.4;
    const q = wm.nearestOpen(at.x + Math.cos(a) * ring, at.z + Math.sin(a) * ring, 6) ?? at;
    startAction(db, { npc_id: r.id, kind: "attend", target: ev.title, target_x: q.x, target_z: q.z, source: "event", event_id: ev.id, minutes: Math.max(5, ev.end_m - now), data: { order: have.length + i, about: label } });
  });
  const all = [...have, ...picked.map((r) => r.id)];
  db.prepare("UPDATE town_event SET people_json = ? WHERE id = ?").run(JSON.stringify(all), ev.id);
  return picked.map((r) => r.id);
}

/** The gathered walk in a column to the stage's place; the event moves there. */
function procession(db: DB, ev: EventRow, to: { x: number; z: number }): void {
  const wm = walkMap();
  const people = peopleOf(ev);
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
    stages: stages.map((s) => ({ op: s.op, minutes: s.minutes, sound: s.sound, mood: s.mood, props: s.props, x: s.x ?? ev.x, z: s.z ?? ev.z, label: s.label ?? ev.place, text: s.text, count: s.count })),
    people: peopleOf(ev),
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
