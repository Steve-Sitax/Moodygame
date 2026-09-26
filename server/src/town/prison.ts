import { sexed } from "../player/profile.ts"; // M7 character: lines said to the player follow the profile
import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { log } from "../game.ts";
import { remember } from "../npcs.ts";
import { dropTownCache, resident, town } from "./store.ts";
import { talkExtras } from "./talk.ts";
import { INWORLD_HOUSES } from "./kept.ts";
import { rngFrom, type Resident } from "./population.ts";
import type { Schedule } from "./schedule.ts";
import { GATE_STEP, prisonDayShift, prisonExercise, prisonVisiting, toWorld } from "../../../shared/prisonPlan.ts";

// The prison in the Begijnenstraat (M7 prison and squares, docs/milestones/M7-prison-squares.md). The ENGINE's:
// who is held, from when to when and for what; its hours (shared/prisonPlan.ts: visiting, the exercise, the
// warders' shifts); the warders' names. The client draws the building, the rooms, the warders and the men in the
// yard from this, and asks here whom Jef may see through the grille.
//
// - A man held is a resident of the town: his home becomes the prison (house -1, the step before the gate) and his
//   day "home" around the clock, so the town draws him nowhere; on his day out the engine gives him back his home
//   and his day as they were.
// - The standing inmate: the town's first docker, porter, carter, boatman or sailor without a family of his own
//   (the town's seed picks him), held for a knife drawn in a tavern: in when the prison is first asked about,
//   out after sixteen days. So there is always someone to visit.
// - The police bring thieves here: when Jef catches a pickpocket by the collar (thieves.ts), the police pick the
//   thief up that night and he is held three days (index.ts, the catch route).
// - A visit: in visiting hours, at the grille in the visitors' room, with one of the men held; the talk is the
//   town's own talk with that resident, told where he is (talkExtras.context, talkHooks.doing).

const KEY = "prison";
/** Days the standing inmate is held, and a caught thief. */
export const STANDING_DAYS = 16;
export const THIEF_DAYS = 3;

export interface Inmate {
  id: string;
  crime: string;
  /** Game day he came in, and the day he goes out (in the morning, at 7:00). */
  since: number;
  until: number;
  /** His home and day before, given back on the day out. */
  before: { home: Resident["home"]; sched: Schedule };
}
interface State {
  v: 1;
  standing: boolean;
  inmates: Inmate[];
  /** The men released, with the day (for the talk: "out since"). */
  out: Array<{ id: string; day: number }>;
}

function stateOf(db: DB): State {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(KEY) as { value_json: string } | undefined;
  if (!row) return { v: 1, standing: false, inmates: [], out: [] };
  try {
    return JSON.parse(row.value_json) as State;
  } catch {
    return { v: 1, standing: false, inmates: [], out: [] };
  }
}
function save(db: DB, s: State): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(KEY, JSON.stringify(s));
}

const clock = (db: DB) => db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };

/** The step before the gate (world), where a man held "lives". */
export function gateStep(): [number, number] {
  const [x, z] = toWorld(GATE_STEP.x, GATE_STEP.z);
  return [Math.round(x * 100) / 100, Math.round(z * 100) / 100];
}

/** Is this resident held now? */
export function heldNow(db: DB, id: string): Inmate | null {
  return stateOf(db).inmates.find((m) => m.id === id) ?? null;
}

/** Put a resident in the prison: his home the prison, his day indoors. Engine only; returns false if he cannot be. */
export function jail(db: DB, id: string, days: number, crime: string): boolean {
  const r = resident(db, id);
  if (!r) return false;
  const s = stateOf(db);
  if (s.inmates.some((m) => m.id === id)) return false;
  const c = clock(db);
  const [sx, sz] = gateStep();
  const rec = JSON.parse(JSON.stringify(r)) as Resident;
  const before = { home: r.home, sched: r.sched };
  rec.home = { house: -1, x: sx, z: sz, sx, sz };
  rec.sched = { day: [[0, 24, "home"]], sunday: [[0, 24, "home"]] };
  db.transaction(() => {
    db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(rec), id);
    s.inmates.push({ id, crime, since: c.day, until: c.day + Math.max(1, Math.round(days)), before });
    s.out = s.out.filter((o) => o.id !== id);
    save(db, s);
    log(db, "jailed", id, `${r.name} was taken to the prison in the Begijnenstraat for ${crime}.`, "police");
  })();
  dropTownCache(db);
  return true;
}

/** Let out everyone whose time is served (from 7:00 on his last day). Returns the ids let out. */
export function releaseDue(db: DB): string[] {
  const s = stateOf(db);
  const c = clock(db);
  const due = s.inmates.filter((m) => c.day > m.until || (c.day === m.until && c.hour >= 7));
  if (!due.length) return [];
  db.transaction(() => {
    for (const m of due) {
      const r = resident(db, m.id);
      if (r) {
        const rec = JSON.parse(JSON.stringify(r)) as Resident;
        rec.home = m.before.home;
        rec.sched = m.before.sched;
        db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(rec), m.id);
        log(db, "released", m.id, `${r.name} came out of the prison in the Begijnenstraat.`, "prison");
      }
      s.out.push({ id: m.id, day: c.day });
    }
    s.inmates = s.inmates.filter((m) => !due.includes(m));
    s.out = s.out.slice(-12);
    save(db, s);
  })();
  dropTownCache(db);
  return due.map((m) => m.id);
}

const STANDING_TRADES = new Set(["docker", "porter", "carter", "boatman", "sailor"]);

/** The standing inmate, once per save: the seed's pick of the single working men (never a special person). */
export function ensurePrison(db: DB): void {
  releaseDue(db);
  const s = stateOf(db);
  if (s.standing) return;
  const t = town(db).town;
  const lighters = new Set(t.residents.filter((r) => r.trade === "lamplighter").map((r) => r.id));
  const pool = t.residents
    .filter(
      (r) =>
        /^r[0-9]+$/.test(r.id) &&
        r.sex === "m" &&
        r.age >= 20 &&
        r.age <= 50 &&
        STANDING_TRADES.has(r.trade) &&
        ["single", "lodger"].includes(r.family_role) &&
        r.home.house >= 0 &&
        !INWORLD_HOUSES.has(r.home.house) &&
        !lighters.has(r.id) &&
        !r.work.door,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  s.standing = true;
  save(db, s);
  if (!pool.length) return;
  const rng = rngFrom(((t.seed ?? 1873) ^ 0x1855) >>> 0);
  const man = pool[Math.floor(rng() * pool.length)];
  jail(db, man.id, STANDING_DAYS, "a knife drawn in a tavern brawl on the Rijnkaai");
}

/** The warders (engine names, not residents): who stands where by the clock. */
const WARDERS = [
  { role: "chief", name: "Chief warder Verstraeten", day: true, night: true },
  { role: "gate", name: "Warder Maes", day: true, night: false },
  { role: "gate_night", name: "Warder De Wolf", day: false, night: true },
  { role: "yard", name: "Warder Peeters", day: true, night: false },
  { role: "visits", name: "Warder Janssens", day: true, night: false },
  { role: "guard", name: "Warder Claes", day: true, night: true },
] as const;

export interface PrisonView {
  visiting: boolean;
  exercise: boolean;
  dayShift: boolean;
  warders: Array<{ role: string; name: string }>;
  /** The men held: residents, for the talk at the grille. */
  inmates: Array<{ id: string; name: string; crime: string; since: number; until: number }>;
  /** How many walk the ring in the yard now (the residents held and the prison's own men). */
  ring: number;
}

export function prisonView(db: DB): PrisonView {
  ensurePrison(db);
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  const day = prisonDayShift(h);
  const s = stateOf(db);
  const inmates = s.inmates.map((m) => ({ id: m.id, name: resident(db, m.id)?.name ?? m.id, crime: m.crime, since: m.since, until: m.until }));
  return {
    visiting: prisonVisiting(c.day, h),
    exercise: prisonExercise(c.day, h),
    dayShift: day,
    warders: WARDERS.filter((w) => (day ? w.day : w.night)).map((w) => ({ role: w.role, name: w.name })),
    inmates,
    ring: prisonExercise(c.day, h) ? 7 + Math.min(3, inmates.length) : 0,
  };
}

/** Jef asks at the grille to see a man held. Engine only: the hours, who is there. */
export function visitAt(db: DB, want?: string): { ok: boolean; id?: string; name?: string; text: string } {
  const v = prisonView(db);
  if (!v.visiting) return { ok: false, text: "The warder shakes his head: visiting hours are nine to twelve and two to five, Sundays two to four." };
  if (!v.inmates.length) return { ok: false, text: "The warder looks in his book: nobody here for you today." };
  // the one asked for, or the one Jef knows best, or the first in the book
  const known = (id: string) => (db.prepare("SELECT times_met FROM npc_relationship WHERE npc_id = ?").get(id) as { times_met: number } | undefined)?.times_met ?? 0;
  const pick = v.inmates.find((m) => m.id === want) ?? [...v.inmates].sort((a, b) => known(b.id) - known(a.id))[0];
  return { ok: true, id: pick.id, name: pick.name, text: `The warder unlocks the far door. ${pick.name} is brought to the grille.` };
}

/** A warder's word to Jef (engine lines, by the hour). */
export function warderLine(db: DB, role: string): string {
  const v = prisonView(db);
  if (role === "gate" || role === "gate_night") {
    if (!v.dayShift) return "The night warder raises his lantern. \"Nobody goes in at night. Come back in visiting hours.\"";
    return v.visiting
      ? "\"Visitors to the right, the grille room. Hats off inside, and nothing passed through the bars.\""
      : "\"Visiting hours are nine to twelve and two to five, Sundays two to four. Come back then.\"";
  }
  if (role === "yard") return v.exercise ? "\"Keep walking, you lot. No talking in the ring.\" He does not look at you." : "\"The yard is empty till the next hour of exercise.\"";
  if (role === "visits") return "\"One visitor at a time, and a quarter of an hour. I hear every word.\"";
  if (role === "chief") return sexed(db, "\"The cellular system, sir: every man alone with his conscience. It works, most of the time.\"");
  return "The warder looks up from his book and says nothing.";
}

/** The talk: a man held knows where he is (the model's prompt), and says so. */
function installPrisonTalk(): void {
  talkExtras.context.push((db, r) => {
    const m = heldNow(db, r.id);
    if (!m) return "";
    const c = clock(db);
    const left = Math.max(0, m.until - c.day);
    return `WHERE YOU REALLY ARE (this, not NOW's words, is where you are): held in the prison in the Begijnenstraat since day ${m.since} for ${m.crime}; you are let out ${left <= 0 ? "tomorrow morning" : `in ${left} day(s)`}. Jef visits you in the visitors' room: you speak through a double iron grille, a warder sits between you and hears every word. Nothing can pass between you. You eat what the prison gives, work in your cell (picking oakum, sewing sacks), walk the ring in the yard twice a day in silence. Speak as a man in a cell would.`;
  });
  // his first words at the grille: the engine's, as every greeting
  talkExtras.greet.push((db, r) => {
    const m = heldNow(db, r.id);
    if (!m) return null;
    const lines = [
      "You came. Nobody else does, in here.",
      "Keep your voice down. The warder writes down every word.",
      "Did you bring word from outside? They tell us nothing.",
      `${Math.max(0, m.until - clock(db).day)} more days of oakum and silence. Then I'm out.`,
    ];
    return lines[(clock(db).day + r.id.length) % lines.length];
  });
}
let talkInstalled = false;
/** Installed once, when this module loads (index.ts imports it; the tests too). */
function installOnce(): void {
  if (talkInstalled) return;
  talkInstalled = true;
  installPrisonTalk();
}
installOnce();

/** The police bring a thief Jef caught: he is held from that night (the catch route in index.ts). */
export function thiefCaught(db: DB, id: string): string {
  const r = resident(db, id);
  if (!r || heldNow(db, id)) return "";
  if (!jail(db, id, THIEF_DAYS, "picking pockets at night")) return "";
  remember(db, id, "The police came for me after Jef caught me. Three days in the Begijnenstraat.", 6);
  return ` Later that night the police pick ${r.first} up: ${r.sex === "f" ? "she" : "he"} is held three days in the prison in the Begijnenstraat.`;
}

/** The routes: the prison now, a visit at the grille, a warder's word. */
export function mountPrison(app: Hono, deps: { db: DB }): void {
  const { db } = deps;
  app.get("/api/prison", (c) => c.json(prisonView(db)));
  app.post("/api/prison/visit", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    return c.json(visitAt(db, typeof body.id === "string" ? body.id : undefined));
  });
  app.post("/api/prison/ask", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { role?: unknown };
    const role = typeof body.role === "string" ? body.role : "gate";
    return c.json({ text: warderLine(db, role) });
  });
}
