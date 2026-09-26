import { sexed } from "../player/profile.ts"; // M7 character: lines said to the player follow the profile
import { z } from "zod";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, HIRING_CALLS_PER_DAY } from "../config.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { ALL_EMPLOYERS, SYSTEM, clampBoard, maxTier, taskFor, type Board } from "../hooks/jobBoard.ts";
import { cartWorkOpen } from "../hooks/loads.ts";
import { remember } from "../npcs.ts";
import { plainEnglish } from "../text.ts";
import { gameMinute } from "../town/deeds.ts";
import type { Resident } from "../town/population.ts";
import { resident } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { jefAt } from "./actions.ts";
import { notify } from "./bus.ts";
import { writeEvent } from "./eventlog.ts";
import { castEngineLead, eventRow, freeResidents, placeAt, planEvent, releaseFromEvent, softText, violent, type EventRow, type StoredStage } from "./scheduler.ts";
import { planFromTemplate, templateById } from "./templates.ts";

// M6 town life: the naties hire day men at dawn (Steve, 2026-09-24). In the Antwerp of 1873
// the naties (cooperatives of natiebazen who owned shares) did the quay work. Their foremen
// (forelieden) took on casual men (natiegasten) each morning, in the street at the natie's
// warehouse gate, or in a tavern the foreman often kept himself; there was no hiring hall
// (those came in the 1930s). A casual man found work two or three days a week; a foreman's
// favour, his tavern and a strong back counted. (Sources in docs/milestones/M6-townlife.md:
// Vanfraechem, "The Antwerp docker: militant by nature?", BTNG 2001; Martens, "Personeelsbeleid
// in de haven van Antwerpen", UGent 2013; Flanders Today, "The United Nations of Antwerp".)
//
// Every working morning the ENGINE plans the hiring (an event of the town's routine, not one of
// the day's four): from about 5:30 the dockers, natie men and porters gather before two gates,
// the Hessenatie's on the Rijnkaai and the Entrepot's where the Katoennatie works; a foreman
// (a lead the engine casts) calls names at about 6:20. The engine picks the men (a strong age,
// the foreman's tavern, his kin, a roll) and whether Jef is taken (his trust with the naties and
// his strength, from his needs); a man taken goes to his day's work, the others drift off to
// the tavern. A hire gives Jef a day's job on the board, through the board's rules and pay.
// The model only words the foreman's call and his remarks (hook hiring_call, 20 s, one call a
// morning; the engine's lines when it is late, wrong or out of budget).

export interface HiringSpot {
  id: string;
  label: string;
  /** Where the foreman stands, facing the men (yaw), and the gate behind him. */
  x: number;
  z: number;
  yaw: number;
  employer: string;
  tavern: { id: string; x: number; z: number };
  ship: string;
  foreman: string | null;
  men: string[];
  want: number;
  picked: string[];
  jef: { stood: number } | null;
  jef_result: { picked: boolean; text: string; job: number | null } | null;
  call: string | null;
  remarks: string[];
  to_jef: string | null;
  source: "engine" | "claude" | null;
}

export interface HiringScene {
  day: number;
  spots: HiringSpot[];
  called: boolean;
}

/** The gates (spots.json: hessenatie_door, katoen_door): the foreman a few steps out from the door. */
const SPOTS: Array<{ id: string; label: string; door: [number, number]; dir: [number, number]; employer: string; tavern: string; ships: string[] }> = [
  { id: "hessenatie", label: "the Hessenatie gate on the Rijnkaai", door: [11.2, 43.5], dir: [1, 0], employer: "sooi", tavern: "ankere", ships: ["the Anna Maria", "a Rhine barge", "the Kempenland's lighters"] },
  { id: "katoen", label: "the Entrepot gate by the Petit Bassin", door: [173, 83], dir: [0, -1], employer: "katoen", tavern: "bassin", ships: ["a cotton ship from New Orleans", "a Baltic timber ship", "a coaster with coffee"] },
];
const TAVERN_AT: Record<string, [number, number]> = { ankere: [-52, 46], bassin: [100, 124], schipke: [-236, 14], vliet: [-120, 50] };

/** Engine numbers. */
export const HIRING_PLAN_FROM = 4.5;
/**
 * The last hour the morning's hiring is still planned (QA 2026-09-24: a night at home ended at
 * 6:00 and the first tick after the night sheet came past 6:15, so the day had no hiring). Up to
 * the template's own limit: a late plan starts at once.
 */
export const HIRING_PLAN_UNTIL = 7;
/** The men gather from 5:00 (fixes 2026-09-24; was 5:30), the call about 6:20 (the template's 80 minutes). */
export const HIRING_START = 5;
export const HIRE_MEN_PER_SPOT = 16;
export { HIRING_CALLS_PER_DAY } from "../config.ts";
/** Jef must stand this near the foreman to be seen at the call. */
export const HIRE_STAND_M = 12;
export const HIRE_PAY_C = 150;
const HIRE_TRADES = new Set(["docker", "natie", "porter"]);

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};
/** The engine's dice for the hiring (tests fix it). */
let roll: (key: string) => number = hash;
export function setHiringRoll(f: ((key: string) => number) | null): void {
  roll = f ?? hash;
}
/** The model for the call (tests put a stub here). */
let runner: Runner | undefined;
export function setHiringRunner(r: Runner | undefined): void {
  runner = r;
}
let pending: Promise<unknown> | null = null;
/** Test helper: wait for the call's words. */
export async function hiringIdle(): Promise<void> {
  await pending?.catch(() => {});
}

const weekday = (d: number) => ((d - 1) % 7) + 1;

// ------------------------------------------------------------------ planning

/** Every tick: before dawn on a working day, plan the morning's hiring once. */
export function hiringTick(db: DB): void {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  if (weekday(c.day) === 7 || h < HIRING_PLAN_FROM || h >= HIRING_PLAN_UNTIL) return;
  const had = db.prepare("SELECT 1 FROM town_event WHERE template = 'hiring' AND day = ?").get(c.day);
  if (had) return;
  planHiring(db);
}

export function planHiring(db: DB, opts: { dev?: boolean } = {}) {
  const c = clock(db);
  const t = templateById("hiring")!;
  const startIn = Math.max(opts.dev ? 1 : 0, Math.round(HIRING_START * 60 - (c.hour * 60 + c.minute)));
  return planEvent(db, planFromTemplate(t, "engine", { place: "hessenatie", start_in_min: startIn, why: "the naties hire every working morning" }), { dev: opts.dev });
}

// ------------------------------------------------------------------ the acts

function sceneOf(ev: EventRow): HiringScene | null {
  return (JSON.parse(ev.stages_json) as StoredStage[])[0]?.hiring ?? null;
}
function save(db: DB, ev: EventRow, h: HiringScene): void {
  const cur = eventRow(db, ev.id) ?? ev;
  const stages = JSON.parse(cur.stages_json) as StoredStage[];
  if (!stages[0]) return;
  stages[0].hiring = h;
  db.prepare("UPDATE town_event SET stages_json = ? WHERE id = ?").run(JSON.stringify(stages), ev.id);
}

/** How fit a man looks to a foreman: a strong age, his kin, his tavern; a roll. */
function hireScore(r: Resident, foreman: Resident | null, key: string): number {
  const age = r.age >= 22 && r.age <= 42 ? 1 : r.age < 22 ? 0.6 : Math.max(0.1, 1 - (r.age - 42) * 0.05);
  const kin = foreman && r.surname === foreman.surname ? 0.8 : 0;
  const tav = (x: Resident) => new Set(x.sched.day.filter((s) => s[2] === "tavern").map((s) => s[3]));
  const drinks = foreman ? [...tav(r)].some((t) => tav(foreman).has(t)) : false;
  return age + kin + (drinks ? 0.6 : 0) + r.stats.courage * 0.03 + roll(key) * 0.7;
}

export function runHiringAct(db: DB, ev: EventRow, s: StoredStage, _i: number): void {
  if (s.act === "hire_gather") return gatherMen(db, ev);
  if (s.act === "hire_call") return callNames(db, ev);
}

function gatherMen(db: DB, ev: EventRow): void {
  const wm = walkMap();
  const c = clock(db);
  const spots: HiringSpot[] = [];
  const taken = new Set<string>();
  const pool = freeResidents(db, ev, (r) => r.sex === "m" && r.age >= 16 && r.age <= 62 && HIRE_TRADES.has(r.trade));
  for (const [k, sp] of SPOTS.entries()) {
    const fx = sp.door[0] + sp.dir[0] * 2.4;
    const fz = sp.door[1] + sp.dir[1] * 2.4;
    const f = wm.nearestOpen(fx, fz, 4) ?? { x: fx, z: fz };
    const yaw = Math.atan2(sp.dir[0], sp.dir[1]);
    const near = (r: Resident) => Math.hypot(r.home.sx - f.x, r.home.sz - f.z);
    // the foreman: a natie man of years, else the oldest docker near
    const foreman =
      pool.filter((r) => !taken.has(r.id) && r.trade === "natie" && r.age >= 34).sort((a, b) => near(a) - near(b))[0] ??
      pool.filter((r) => !taken.has(r.id) && r.age >= 38).sort((a, b) => near(a) - near(b))[0] ??
      null;
    if (foreman) taken.add(foreman.id);
    // the men: those who live nearer this gate than the other
    const other = SPOTS[1 - k];
    const mine = pool
      .filter((r) => !taken.has(r.id) && Math.hypot(r.home.sx - sp.door[0], r.home.sz - sp.door[1]) <= Math.hypot(r.home.sx - other.door[0], r.home.sz - other.door[1]) + 40)
      .sort((a, b) => near(a) - near(b))
      .slice(0, HIRE_MEN_PER_SPOT);
    for (const r of mine) taken.add(r.id);
    const ships = sp.ships;
    const ship = ships[Math.floor(roll(`${c.day}:${sp.id}:ship`) * ships.length) % ships.length];
    const want = Math.max(1, Math.round(mine.length * (0.35 + roll(`${c.day}:${sp.id}:want`) * 0.3)));
    const tv = TAVERN_AT[sp.tavern] ?? [f.x, f.z];
    spots.push({ id: sp.id, label: sp.label, x: f.x, z: f.z, yaw, employer: sp.employer, tavern: { id: sp.tavern, x: tv[0], z: tv[1] }, ship, foreman: foreman?.id ?? null, men: mine.map((r) => r.id), want, picked: [], jef: null, jef_result: null, call: null, remarks: [], to_jef: null, source: null });
    if (foreman) castEngineLead(db, ev, foreman.id, "natie_foreman", { x: f.x, z: f.z });
    // a loose crowd in front of him, facing the gate: rows 3 to 7 m out
    const slots = mine.map((_r, i) => {
      const row = Math.floor(i / 6);
      const col = (i % 6) - 2.5 + (row % 2) * 0.4;
      const ax = f.x + sp.dir[0] * (3 + row * 1.3) - sp.dir[1] * col * 1.05;
      const az = f.z + sp.dir[1] * (3 + row * 1.3) + sp.dir[0] * col * 1.05;
      return wm.nearestOpen(ax, az, 3) ?? { x: ax, z: az };
    });
    placeAt(db, ev, mine.map((r) => r.id), slots, "dockers");
  }
  const h: HiringScene = { day: c.day, spots, called: false };
  save(db, ev, h);
  writeEvent(db, {
    kind: "event",
    verb: "hiring_gather",
    text: `Before dawn the day men gathered at ${spots.map((s) => `${s.label} (${s.men.length})`).join(" and ")} to be hired.`,
    place: ev.place,
    ref_type: "town_event",
    ref_id: ev.id,
    weight: 2,
  });
}

/** Jef's chance to be taken on: his trust with the naties and the foreman, and how strong he looks (his needs). */
export function jefHireChance(db: DB, foreman: string | null): number {
  const trust = (db.prepare("SELECT trust FROM faction_trust WHERE faction = 'naties'").get() as { trust: number } | undefined)?.trust ?? 0;
  const p = db.prepare("SELECT food, health, sleep FROM player WHERE id = 1").get() as { food: number; health: number; sleep: number };
  const strength = (p.food + p.health + p.sleep) / 3;
  const own = foreman ? ((db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ?").get(foreman) as { trust: number } | undefined)?.trust ?? 0) : 0;
  return Math.max(0.05, Math.min(0.9, 0.2 + trust * 0.08 + own * 0.05 + (strength - 5) * 0.05));
}

function callNames(db: DB, ev: EventRow): void {
  const h = sceneOf(eventRow(db, ev.id) ?? ev);
  if (!h || h.called) return;
  h.called = true;
  const jef = jefAt();
  for (const sp of h.spots) {
    const foreman = sp.foreman ? resident(db, sp.foreman) ?? null : null;
    const men = sp.men.map((id) => resident(db, id)).filter((r): r is Resident => !!r);
    const ranked = men.map((r) => ({ r, s: hireScore(r, foreman, `${ev.id}:${r.id}`) })).sort((a, b) => b.s - a.s);
    sp.picked = ranked.slice(0, sp.want).map((x) => x.r.id);
    // the men taken go to their day's work; the rest drift off to the tavern
    for (const id of sp.picked) {
      releaseFromEvent(db, ev, id, "taken on for the day");
      remember(db, id, `${foreman?.name ?? "The foreman"} took me on at ${sp.label} for ${sp.ship}.`, 3);
    }
    const left = sp.men.filter((id) => !sp.picked.includes(id));
    const wm = walkMap();
    placeAt(
      db,
      ev,
      left,
      left.map((_id, i) => {
        const a = (i / Math.max(1, left.length)) * Math.PI * 2;
        return wm.nearestOpen(sp.tavern.x + Math.cos(a) * 3, sp.tavern.z + Math.sin(a) * 3, 5) ?? sp.tavern;
      }),
      "drift",
    );
    // Jef: only if he stood there and is still about when the names are called
    if (sp.jef) {
      const there = !jef || Math.hypot(jef.x - sp.x, jef.z - sp.z) <= HIRE_STAND_M * 1.8;
      if (!there) sp.jef_result = { picked: false, text: "The names were called while you were away.", job: null };
      else {
        const p = jefHireChance(db, sp.foreman);
        const picked = roll(`${ev.id}:jef:${sp.id}`) < p;
        if (picked) {
          const job = postHireJob(db, ev, sp);
          sp.jef_result = { picked: true, text: `${foreman?.first ?? "The foreman"} points at you: taken on for ${sp.ship}.${job ? ` The day's work is on the board: "${job.title}", ${job.pay_c} centimes.` : ""}`, job: job?.id ?? null };
        } else sp.jef_result = { picked: false, text: `${foreman?.first ?? "The foreman"}'s eye passes over you. Not today.`, job: null };
        writeEvent(db, { kind: "job", verb: picked ? "hired_jef" : "not_hired_jef", actor: sp.foreman, target: "player", text: `At ${sp.label} ${foreman?.name ?? "the foreman"} ${picked ? "took Jef on for the day" : "passed Jef over"}.`, ref_type: "town_event", ref_id: ev.id, weight: 4, data: { chance: +p.toFixed(2) } });
      }
    }
    // the engine's words now; the model's replace them if they come in time
    const fb = fallbackLines(db, sp);
    sp.call = fb.call;
    sp.remarks = fb.remarks;
    sp.to_jef = sp.jef_result ? fb.to_jef : null;
    sp.source = "engine";
    writeEvent(db, {
      kind: "event",
      verb: "hiring_call",
      actor: sp.foreman,
      text: `At ${sp.label} ${foreman?.name ?? "the foreman"} took on ${sp.picked.length} of ${sp.men.length} men for ${sp.ship}: ${sp.picked.map((id) => resident(db, id)?.name ?? id).join(", ")}.`,
      ref_type: "town_event",
      ref_id: ev.id,
      weight: 3,
      who: [...(sp.foreman ? [sp.foreman] : []), ...sp.picked],
    });
  }
  save(db, ev, h);
  notify("events", { jobs: h.spots.some((s) => s.jef_result?.job) });
  pending = wordCall(db, ev.id).catch((e) => console.warn("[hiring] call", e));
}

/** A day's work for Jef on the board, through the board's own rules (engine pay, the employer's own ground). */
function postHireJob(db: DB, ev: EventRow, sp: HiringSpot): { id: number; title: string; pay_c: number } | null {
  const def = ALL_EMPLOYERS[sp.employer];
  if (!def) return null;
  const from = def.area.find((a) => a !== def.door) ?? def.door;
  // M7 short jobs: by hand at most two sacks; a cartload with the natie's handcart once cart work is open
  const cart = cartWorkOpen(db);
  const board: Board = {
    jobs: [
      {
        title: `Taken on at the gate: a day on ${sp.ship}`,
        employer: sp.employer,
        task_type: "carry",
        goods: "sacks",
        from,
        to: def.door,
        twist: "none",
        urgent: false,
        recipient: "",
        pay_c: HIRE_PAY_C,
        risk: "low",
        pitch: cart
          ? `The foreman took you on at the gate this morning. A cartload off ${sp.ship} into the natie's store, with the natie's handcart; bring it back where it stood.`
          : `The foreman took you on at the gate this morning. Sacks off ${sp.ship} into the natie's store; the natie's own men do the rest.`,
        items: cart ? 5 : 2,
        cart,
      },
    ],
  };
  const clamped = clampBoard(board, maxTier(db)).jobs[0];
  const task = taskFor(clamped);
  if (!task) return null;
  // the pitch names the engine's count (M7 short jobs)
  if (task.kind === "carry" && !task.cart) clamped.pitch = clamped.pitch.replace("Sacks off", task.count === 1 ? "A sack off" : "Two sacks off");
  const c = clock(db);
  const district = def.town ? ((db.prepare("SELECT district FROM npc WHERE id = ?").get(sp.employer) as { district: string } | undefined)?.district ?? "town") : "rijnkaai";
  const res = db
    .prepare(
      `INSERT INTO job (day, title, employer_npc, district, task_type, pay_c, risk, tier, required_faction, pitch, task_json, source, status)
       VALUES (?, ?, ?, ?, 'carry', ?, 'low', ?, ?, ?, ?, 'event', 'offered')`,
    )
    .run(c.day, clamped.title, sp.employer, district, clamped.pay_c, maxTier(db), def.faction, clamped.pitch, JSON.stringify(task));
  writeEvent(db, { kind: "job", verb: "event_job", text: `Work went up on the board after the hiring: "${clamped.title}", ${clamped.pay_c} centimes.`, ref_type: "town_event", ref_id: ev.id, weight: 4 });
  return { id: Number(res.lastInsertRowid), title: clamped.title, pay_c: clamped.pay_c };
}

// ------------------------------------------------------------------ the words

const CALLS = [
  (ship: string) => `Right, you lot. ${ship[0].toUpperCase() + ship.slice(1)} wants hands. {names}. The rest of you, try again tomorrow.`,
  (ship: string) => `Quiet! For ${ship}: {names}. That's the lot. Off you go.`,
  (ship: string) => `I want strong backs for ${ship}. {names}. Nobody else today.`,
];
const REMARKS = ["Not you, you were drunk on Monday.", "Come back when you've had some bread in you.", "Tomorrow, maybe. If the wind holds.", "Don't look at me like that. There's no more work."];
const TO_JEF = { yes: ["You. The new one. Don't make me sorry.", "You'll do. Mind the sacks, they bite."], no: ["Not today, lad.", "I don't know your face. Not today."] };

function fallbackLines(db: DB, sp: HiringSpot): { call: string; remarks: string[]; to_jef: string } {
  const k = (s: string) => Math.floor(roll(`${sp.id}:${s}:${clock(db).day}`) * 1000);
  const call = CALLS[k("c") % CALLS.length](sp.ship);
  const remarks = [REMARKS[k("r") % REMARKS.length]];
  const to = sp.jef_result?.picked ? TO_JEF.yes : TO_JEF.no;
  return { call: fillNames(db, call, sp), remarks, to_jef: sexed(db, to[k("j") % to.length]) };
}

/** "{names}" becomes the men taken; a call without the placeholder gets the names added. */
function fillNames(db: DB, text: string, sp: HiringSpot): string {
  const names = sp.picked.map((id) => resident(db, id)?.name ?? "").filter(Boolean);
  const jefIn = sp.jef_result?.picked ? ["the new one there"] : [];
  const list = [...names, ...jefIn];
  const said = list.length ? (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0]) : "nobody";
  return text.includes("{names}") ? text.replace(/\{names\}/g, said) : `${text.replace(/[.\s]*$/, ".")} ${said}.`;
}

export const HiringSchema = z.object({
  calls: z
    .array(
      z.object({
        spot: z.string().max(20),
        call: z.string().max(220),
        remarks: z.array(z.string().max(120)).max(3),
        to_jef: z.string().max(120),
      }),
    )
    .max(3),
});
export type HiringOut = z.infer<typeof HiringSchema>;

const RULES = `
YOU WRITE WHAT A NATIE FOREMAN SAYS AT THE GATE AT DAWN, when he calls the names of the day men he takes on.
- call: one or two short sentences, gruff, period-true (Antwerp, 1873). Write {names} where the names of the men he takes go.
  Never write a person's name yourself; the game puts them in.
- remarks: 1-3 short lines he throws at the men he does not take.
- to_jef: one short line to Jef, who stood among them. The game has already decided whether Jef was taken (see JEF);
  your line must fit that decision. Never promise money, never name a sum.
- Plain English; Dutch only in names. No weapons, nobody hurt.`;

export function canCallHiring(db: DB): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook = 'hiring_call'").get(day) as { n: number }).n;
  return mine < HIRING_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

export function hiringPrompt(db: DB, h: HiringScene): string {
  const c = clock(db);
  const lines = h.spots.map((sp) => {
    const f = sp.foreman ? resident(db, sp.foreman) : null;
    const jef = sp.jef_result ? (sp.jef_result.picked ? "Jef stood there and WAS taken on." : "Jef stood there and was NOT taken on.") : "Jef was not there.";
    return `- spot "${sp.id}" (${sp.label}): foreman ${f ? `${f.first} (temper ${f.stats.temper}, warmth ${f.stats.warmth})` : "a foreman"}; he wants men for ${sp.ship}; he takes ${sp.picked.length} of ${sp.men.length}. JEF: ${jef}`;
  });
  return `NOW
${c.weekday}, day ${c.day}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}.

THE GATES
${lines.join("\n")}

Write one entry per spot.`;
}

/** Hostile or careless words are the engine's problem: struck, cleaned, or the engine's lines kept. */
export function cleanCall(db: DB, sp: HiringSpot, out: HiringOut["calls"][number] | undefined): boolean {
  if (!out) return false;
  const texts = [out.call, ...out.remarks, out.to_jef];
  if (violent({ title: "", notice: "", rumour: "", stages: texts.map((t) => ({ text: t })) as never })) return false;
  const clean = (t: string) =>
    softText(t)
      .replace(/\b\d+\s*(centimes?|francs?|fr)\b/gi, "a day's pay")
      .replace(/[<>{}]/g, "")
      .trim();
  let call = clean(out.call.replace(/\{names\}/g, "NAMESLIST")).replace(/NAMESLIST/g, "{names}");
  // no name of the model's own: a capitalised word pair that is not a place or the ship goes
  call = call.replace(/\bJef\b/g, "you");
  if (!call || call.length < 8) return false;
  const remarks = out.remarks.map(clean).filter((r) => r.length >= 3 && !/\bJef\b/.test(r)).slice(0, 3);
  let toJef = clean(out.to_jef);
  const saysYes = /\b(you('| a)re (hired|taken|in)|you'll do|come with me|you're with us|taken on)\b/i.test(toJef);
  const saysNo = /\b(not (today|you)|no work for you|go home|next time)\b/i.test(toJef);
  if (sp.jef_result && ((sp.jef_result.picked && saysNo) || (!sp.jef_result.picked && saysYes))) toJef = "";
  sp.call = fillNames(db, call, sp).slice(0, 260);
  sp.remarks = remarks.length ? remarks : sp.remarks;
  if (sp.jef_result && toJef) sp.to_jef = plainEnglish(toJef).slice(0, 120);
  sp.source = "claude";
  return true;
}

/** The model words the call (one call for both gates); the engine keeps its own lines otherwise. */
async function wordCall(db: DB, id: number): Promise<void> {
  if (!canCallHiring(db)) return;
  const ev = eventRow(db, id);
  const h = ev ? sceneOf(ev) : null;
  if (!ev || !h) return;
  const res = await callClaude(db, { hook: "hiring_call", system: SYSTEM + "\n" + RULES, prompt: hiringPrompt(db, h), schema: HiringSchema, timeoutMs: 20_000 }, runner);
  const cur = eventRow(db, id);
  const h2 = cur ? sceneOf(cur) : null;
  if (!cur || !h2 || !res.ok || !res.data) return;
  let any = false;
  for (const sp of h2.spots) any = cleanCall(db, sp, res.data.calls.find((c) => c.spot.trim().toLowerCase() === sp.id)) || any;
  if (!any) return;
  save(db, cur, h2);
  notify("events");
}

// ------------------------------------------------------------------ Jef, the end, the client

export type StandResult = { ok: true; text: string; spot: string } | { ok: false; why: string };

/** Jef stands among the men at a gate before the call (x, z: where he is). */
export function standForHire(db: DB, x: number, z: number): StandResult {
  const ev = (db.prepare("SELECT * FROM town_event WHERE template = 'hiring' AND status = 'running' ORDER BY id DESC LIMIT 1").get() as EventRow | undefined) ?? null;
  const h = ev ? sceneOf(ev) : null;
  if (!ev || !h) return { ok: false, why: "Nobody is hiring now. The naties hire at dawn." };
  if (h.called) return { ok: false, why: "The names have been called. Try again tomorrow." };
  const sp = h.spots.find((s) => Math.hypot(s.x - x, s.z - z) <= HIRE_STAND_M);
  if (!sp) return { ok: false, why: "Stand with the men at the gate." };
  if (h.spots.some((s) => s.jef)) return { ok: false, why: "You are standing for hire already." };
  sp.jef = { stood: gameMinute(db) };
  save(db, ev, h);
  writeEvent(db, { kind: "job", verb: "stood_for_hire", actor: "player", text: `Jef stood with the day men at ${sp.label}.`, ref_type: "town_event", ref_id: ev.id, weight: 2 });
  notify("events");
  return { ok: true, text: "You stand with the men and wait for the foreman to call the names.", spot: sp.id };
}

export function hiringEnd(db: DB, ev: EventRow, status: "done" | "cancelled"): void {
  const h = sceneOf(ev);
  if (!h || status !== "done") return;
  const taken = h.spots.reduce((a, s) => a + s.picked.length, 0);
  const all = h.spots.reduce((a, s) => a + s.men.length, 0);
  writeEvent(db, { kind: "event", verb: "hiring_done", text: `The naties took on ${taken} of ${all} day men at the gates this morning; the rest went to the taverns.`, ref_type: "town_event", ref_id: ev.id, weight: 2 });
}

export function hiringForClient(stages: StoredStage[]) {
  const h = stages[0]?.hiring;
  if (!h) return null;
  return {
    called: h.called,
    spots: h.spots.map((s) => ({
      id: s.id,
      label: s.label,
      x: s.x,
      z: s.z,
      yaw: s.yaw,
      foreman: s.foreman,
      ship: s.ship,
      men: s.men.length,
      picked: s.picked,
      jef: !!s.jef,
      jef_result: s.jef_result ? { picked: s.jef_result.picked, text: s.jef_result.text } : null,
      call: s.call,
      remarks: s.remarks,
      to_jef: s.to_jef,
      source: s.source,
    })),
  };
}
