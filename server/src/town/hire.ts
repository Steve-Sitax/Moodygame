import { z } from "zod";
import type { DB } from "../db.ts";
import { HANDS_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock } from "../day.ts";
import { GameError, log, player } from "../game.ts";
import { SPOTS, SYSTEM, listJobs, type JobRow } from "../hooks/jobBoard.ts";
import { relationship, remember, trustText } from "../npcs.ts";
import { LANGUAGE_RULE } from "../text.ts";
import { resident, TOWN_EMPLOYER_IDS } from "./store.ts";
import type { Resident } from "./population.ts";
import { nowOf, talkExtras, type ExtraTopic } from "./talk.ts";
import { walkMap } from "./walkmap.ts";
import { TRADES } from "./places.ts";
import { actionOf, jefAt, type Accepted, type Refused, type Where } from "../director/actions.ts";
import type { ActionProposal } from "../director/vocab.ts";
import { bus } from "../director/bus.ts";
import { activeRoutines, addSteps, endRoutine, goodsLeft, reportStep, routineFor, saveRoutine, startRoutine, stepHooks, stepPay, type Routine, type Step } from "../director/steps.ts";
import { canCallShare, getState, setState } from "../interiors/state.ts";
import { cleanLine } from "../interiors/tavern.ts";
import { cartGuards, jefCarts, lendCart, returnCart, type JefCart } from "./handcart.ts";
import { canLoad } from "../../../shared/handcart.ts";

// Hired hands (M6, Steve 2026-09-24): "Can we already ask for help and pay NPCs if they accept, and
// will they really do it in game? I could start my own labour camp if I'm rich :)"
//
// The model proposes "work_for_pay" (the work, the wage Jef named) in its talk reply. The ENGINE
// decides: the wage against their usual day's pay by trade, whether they are free (a keeper at her
// stall stays unless the offer beats her takings), trust, honesty and strength (age), the crew's
// size, and Jef's money. Accepted, they REALLY do it: a routine of steps (walk to the goods, pick
// one up, carry it to the goal, again) that the client walks on the walk grid; each delivery counts
// for Jef's job under the board's own rules (the job pays Jef as ever). The wage moves by the
// engine: half up front and half at the end (or all at the end, or all now). A dishonest hand may
// walk off with the goods (a robbery on the record) or stop halfway and ask for more: the engine
// rolls it at the hire, by honesty and greed. Their lines are the model's where the share allows.

/** A usual day's pay by trade (centimes, the game's scale: a carry job pays 50 to 150). */
export const DAY_PAY_C: Record<string, number> = {
  docker: 120,
  natie: 140,
  porter: 110,
  carter: 130,
  boatman: 120,
  sailor: 100,
  cellarman: 110,
  lamplighter: 90,
  laundress: 70,
  maid: 70,
  seamstress: 70,
  housewife: 60,
  fishwife: 90,
  market_woman: 90,
  cobbler: 100,
  retired: 50,
  beggar: 30,
  street_child: 30,
  errand_boy: 40,
  emigrant: 60,
  soldier: 40,
  thief: 80,
  runner: 90,
};
/** Loads a hand carries in a working day: the price of one load is a day's pay over this. */
export const LOADS_PER_DAY = 12;
/** What it costs to call a man off his day at all. */
export const HIRE_CALL_C = 5;
/** No hand takes more than this for a few loads ("that's too much; what's the catch?"). */
export const MAX_WAGE_C = 300;
/** Crew: 3 at first; one more with money (200 c), one more each with trust among the naties or anyone (3, 5); at most 6. */
export const CREW_BASE = 3;
export const CREW_MAX = 6;
/** How long a hand who asked for more waits for Jef's answer (game minutes; M7 clock: 120 -> 20, 40 real seconds), then quits. */
export const ASK_WAIT_MIN = 20;
/** A hand works until 20:00 at the latest, and at least this long. */
export const HIRE_MIN_MIN = 240;
/** Jef's cart must stand this near the goods to be lent to a hand. */
export const CART_NEAR_M = 40;

/** How many of these goods go on one handcart a trip (by size and weight), at most 5. */
export function perTrip(goods: string): number {
  const on: Array<{ kind: string }> = [];
  while (on.length < 5 && !canLoad(on, { kind: goods })) on.push({ kind: goods });
  return Math.max(1, on.length);
}

export type PayPlan = "half" | "end" | "now";

interface HireState {
  task: "carry" | "watch";
  job: number | null;
  wage_c: number;
  paid_c: number;
  plan: PayPlan;
  expected: number;
  loads: number;
  holding: number;
  strong: boolean;
  walk_off_at: number | null;
  ask_more_at: number | null;
  asking: number;
  asked: boolean;
  from: { x: number; z: number; label: string } | null;
  to: { x: number; z: number; label: string } | null;
  /** Jef's handcart, lent to the hand: where it stood, how many go on it a trip, taken yet, the cart itself while lent. */
  cart: { id: string; x: number; z: number; yaw: number; per_trip: number; taken: boolean; data?: JefCart } | null;
  [k: string]: unknown;
}
const st = (r: Routine) => r.state as HireState;

// ------------------------------------------------------------------ words

/** Jef asks for work to be done: the words must show it (no hire out of "give yourself a franc"). */
export const WORK_RE = /\b(carry|carrying|help|work|hire|haul|lift|shift|move|crates?|sacks?|barrels?|hides|rope|loads?|goods|push|cart|handcart|watch|guard|mind|job|hand|labour|labor)\b/i;
const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, "twenty-five": 25, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** The sums in Jef's words, in centimes: with a unit first ("20 centimes", "a franc", "two francs"), then bare numbers. */
export function sumsIn(words: string): { unit: number[]; bare: number[] } {
  const unit: number[] = [];
  const bare: number[] = [];
  const t = words.toLowerCase().replace(/half a franc/g, "50 centimes").replace(/\ba franc\b/g, "1 franc");
  const re = /\b(\d{1,7}|twenty-five|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s*(francs?|fr\b|centimes?|cents?|c\b|sous?)?/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const n = /^\d/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
    if (!Number.isFinite(n)) continue;
    const u = m[2] ?? "";
    if (/^fr/.test(u)) unit.push(n * 100);
    else if (/^sou/.test(u)) unit.push(n * 5);
    else if (u) unit.push(n);
    else bare.push(n);
  }
  return { unit, bare };
}

/** The wage Jef offered: it must be in HIS words (the model's number only picks which). 0: none named. */
export function offerFrom(words: string, modelAmount: number): number {
  const s = sumsIn(words);
  if (s.unit.length) return s.unit.includes(modelAmount) ? modelAmount : s.unit[0];
  if (s.bare.includes(modelAmount) && modelAmount > 0) return modelAmount;
  // a bare number with no unit is only a wage if it is the only number said
  return s.bare.length === 1 && /\b(pay|give|wage|for)\b/i.test(words) ? s.bare[0] : 0;
}

export function planFrom(words: string): PayPlan {
  const t = words.toLowerCase();
  if (/\bhalf\b/.test(t)) return "half";
  if (/\b(at the end|when (it'?s|you'?re|we'?re|they'?re|the job'?s) (done|finished|delivered)|afterwards?|after(wards)? you'?re done|on delivery|when done)\b/.test(t)) return "end";
  if (/\b(all|everything|the lot|in full|whole)\b.*\b(now|up front|upfront|in advance|first)\b|\b(up front|upfront|in advance)\b/.test(t)) return "now";
  return "half";
}

export function taskFrom(words: string): "carry" | "watch" {
  return /\b(watch|guard|mind|keep an eye)\b/i.test(words) && !/\b(carry|crates?|sacks?|barrels?|haul|lift)\b/i.test(words) ? "watch" : "carry";
}

// ------------------------------------------------------------------ the engine's numbers

export function dayPay(r: Resident): number {
  return DAY_PAY_C[r.trade] ?? 80 + 20 * r.stats.wealth;
}
export function perLoad(r: Resident): number {
  return Math.ceil(dayPay(r) / LOADS_PER_DAY);
}
const round5 = (n: number) => Math.ceil(n / 5 - 1e-9) * 5;
/** A keeper's takings in a day (what leaving the stall costs her). */
export function takings(r: Resident): number {
  return 80 + 30 * r.stats.wealth;
}
export function isKeeperAtWork(db: DB, r: Resident): boolean {
  return (r.work.kind === "stall" || r.work.kind === "shop" || r.work.kind === "tavern") && nowOf(db, r).act === "work";
}

/** What they ask for `loads` loads: the call, the loads at their day's rate, their stats and trust. */
export function askFor(db: DB, r: Resident, loads: number): number {
  let ask = HIRE_CALL_C + perLoad(r) * Math.max(1, loads);
  if (isKeeperAtWork(db, r)) ask = Math.max(ask, takings(r) / 2);
  else if (nowOf(db, r).act === "work") ask *= 1.25;
  const trust = relationship(db, r.id)?.trust ?? 0;
  if (trust >= 5) ask *= 0.85;
  if (trust < 0) ask *= 1.3;
  if (r.stats.warmth >= 7) ask *= 0.9;
  if (r.stats.greed >= 7) ask *= 1.2;
  return round5(ask);
}

/** How many hands Jef may have at once. */
export function crewCap(db: DB): number {
  let n = CREW_BASE;
  if (player(db).money_c >= 200) n++;
  const best = (db.prepare("SELECT MAX(trust) AS t FROM faction_trust").get() as { t: number | null }).t ?? 0;
  if (best >= 3) n++;
  if (best >= 5) n++;
  return Math.min(CREW_MAX, n);
}

export function crew(db: DB): Array<{ id: number; npc: string; state: HireState }> {
  return activeRoutines(db, "hire").map(({ row, r }) => ({ id: row.id, npc: row.npc_id, state: st(r) }));
}

/** Strong enough for a heavy load: a grown man or woman in their working years. */
export function strongOf(r: Resident): boolean {
  return r.age >= 18 && r.age <= 55;
}

/** The engine's roll at the hire, by honesty and greed: walks off after this many loads, asks for more after this many. */
export function dishonestPlan(r: Resident, trust: number, plan: PayPlan, expected: number, rng: () => number): { walk_off_at: number | null; ask_more_at: number | null } {
  const calm = trust >= 5 ? 0.5 : 1;
  const walk = Math.max(0, 4 - r.stats.honesty) * 0.12 * (r.trade === "thief" || r.trade === "runner" ? 1.5 : 1) * (plan === "now" ? 1.5 : 1) * calm;
  if (rng() < walk) return { walk_off_at: Math.min(Math.max(0, expected - 1), 1), ask_more_at: null };
  const ask = (r.stats.greed >= 7 ? 0.35 : r.stats.greed >= 5 && r.stats.honesty <= 4 ? 0.15 : 0) * calm;
  if (expected >= 2 && rng() < ask) return { walk_off_at: null, ask_more_at: Math.ceil(expected / 2) };
  return { walk_off_at: null, ask_more_at: null };
}

function jefJob(db: DB): JobRow | null {
  return listJobs(db, player(db).day).find((j) => j.status === "taken") ?? null;
}
function spotOf(id: string): { x: number; z: number; label: string } | null {
  const s = (SPOTS as Record<string, { x: number; z: number; label: string }>)[id];
  if (!s) return null;
  const q = walkMap().nearestOpen(s.x, s.z, 4);
  return q ? { x: q.x, z: q.z, label: s.label } : null;
}
/** Wages already promised on this job (for the note: never more out than the job pays, unless Jef chose it). */
function promised(db: DB, jobId: number): number {
  return crew(db).filter((c) => c.state.job === jobId).reduce((n, c) => n + c.state.wage_c, 0);
}

// ------------------------------------------------------------------ the proposal

const said = (_r: Resident, line: string) => ({ ok: false as const, reason: "hire" as const, line, patch: { trust_delta: 0 } });

/** The talk's proposal "work_for_pay": the engine's yes or no, the wage, the first half, the routine. */
export function proposeHire(db: DB, r: Resident, p: ActionProposal, words: string, _at: { jef: { x: number; z: number } | null; mine: Where }, rng: () => number = Math.random): Accepted | Refused {
  const text = `${words}`;
  if (!WORK_RE.test(text)) return said(r, "Work for you? Doing what?");
  const now = nowOf(db, r);
  const h = clock(db).hour;
  if (r.age < 14) return said(r, "I'm too small for that, mister. Ask a grown man.");
  if (r.age > 62) return said(r, "My back's past carrying, lad. Ask a younger man.");
  if (TOWN_EMPLOYER_IDS.includes(r.id) || r.work.kind === "guard" || ((r.trade === "police" || r.trade === "water_bailiff" || r.trade === "customs" || r.trade === "priest" || r.trade === "sexton") && now.act === "work"))
    return said(r, "I can't leave my post. Ask someone with time on their hands.");
  if (now.act === "home" && (h >= 22 || h < 5)) return said(r, "At this hour? I'm for my bed.");
  if ((h >= 20 || h < 6) && r.stats.courage <= 3) return said(r, "Not in the dark. Not for anyone.");
  const trust = relationship(db, r.id)?.trust ?? 0;
  if (trust <= -2) return said(r, "Work for you? I'd sooner starve.");
  if (actionOf(db, r.id)) return said(r, "I've my hands full already. Ask me when I'm done.");
  const hands = crew(db);
  if (hands.length >= crewCap(db)) return said(r, "You've men enough already. Pay them first.");
  if (TRADES[r.trade] && (r.stats.wealth >= 7 || ["merchant", "alderman", "brewer", "fish_merchant", "pawnbroker"].includes(r.trade))) return said(r, "Do I look like a porter to you?");

  const task = taskFrom(text);
  let from: HireState["from"] = null;
  let to: HireState["to"] = null;
  let expected = 1;
  let cart: HireState["cart"] = null;
  const job = jefJob(db);
  if (task === "carry") {
    if (!job || job.task?.kind !== "carry") return said(r, "Carry what? You've no load I can see.");
    const left = goodsLeft(db, job.id) - hands.reduce((n, c) => n + c.state.holding, 0);
    if (left <= 0) return said(r, "Your goods are all carried. There's nothing left for me.");
    from = spotOf(job.task.from);
    to = spotOf(job.task.to);
    if (!from || !to) return said(r, "There's no way through there on foot.");
    expected = Math.max(1, Math.ceil(left / (hands.filter((c) => c.state.job === job.id).length + 1)));
    // "take my cart": an empty cart of Jef's standing near the goods is lent to him
    if (/\b(cart|handcart|barrow)\b/i.test(text)) {
      const c = jefCarts(db).list.find((q) => !q.held && !q.load.length && Math.hypot(q.x - from!.x, q.z - from!.z) < CART_NEAR_M);
      if (c) cart = { id: c.id, x: c.x, z: c.z, yaw: c.yaw, per_trip: perTrip(job.task.goods), taken: false };
    }
  } else {
    // watch: his handcart standing somewhere, or the place he stands
    const at = jefAt();
    if (!at) return said(r, "Watch what? Show me.");
    from = { ...(walkMap().nearestOpen(at.x, at.z, 4) ?? at), label: "where Jef stood" };
    to = from;
    expected = 2;
  }
  const ask = task === "watch" ? round5(dayPay(r) / 4) : askFor(db, r, expected);
  const offer = offerFrom(text, p.amount_c);
  if (!offer) return said(r, `For ${ask} centimes I'd do it. Half now, half when it's done.`);
  if (offer > MAX_WAGE_C) return said(r, "That much? For a few loads? What's the catch? No. Pay me what it's worth.");
  if (offer < ask) return said(r, offer < ask / 2 ? `For ${offer}? I don't work for nothing. ${ask}, and I'm your man.` : `Make it ${ask} and I'm your man.`);
  const plan = planFrom(text);
  if (plan === "end" && trust < 2) return said(r, "Half now, or find another man. I don't know you.");
  const first = plan === "now" ? offer : plan === "half" ? Math.floor(offer / 2) : 0;
  if (player(db).money_c < first) return said(r, `Show me the coin first: ${first} centimes now.`);

  const roll = task === "carry" ? dishonestPlan(r, trust, plan, expected, rng) : { walk_off_at: null, ask_more_at: null };
  const state: HireState = {
    task,
    job: task === "carry" ? job!.id : null,
    wage_c: offer,
    paid_c: 0,
    plan,
    expected,
    loads: 0,
    holding: 0,
    strong: strongOf(r),
    ...roll,
    asking: 0,
    asked: false,
    from,
    to,
    cart,
  };
  // the first half (or all) up front: the engine's money
  if (first) stepPay(db, r.id, first, plan === "now" ? "a wage, all up front" : "half a wage up front");
  state.paid_c = first;
  const steps: Step[] =
    task === "carry"
      ? [...(cart ? [{ kind: "walk_to" as const, ...besideCart(cart, from!), label: "Jef's handcart" }] : []), ...loadSteps(state)]
      : [
          { kind: "walk_to", x: from!.x, z: from!.z, label: from!.label },
          { kind: "wait", minutes: 240, label: "watching Jef's things" },
        ];
  const minutes = Math.max(HIRE_MIN_MIN, Math.min(720, (20 - h) * 60 - clock(db).minute));
  startRoutine(db, { npc: r.id, purpose: "hire", reason: task === "carry" ? "carrying for Jef" : "watching for Jef", minutes, target: task, target_x: from?.x ?? null, target_z: from?.z ?? null, state, steps });
  log(db, "hired", r.id, `Jef hired ${r.name} to ${task === "carry" ? "carry the goods of his job" : "watch his things"} for ${offer} centimes${first ? `, ${first} paid up front` : ", all at the end"}.`);
  remember(db, r.id, `Jef hired me to ${task === "carry" ? "carry his goods" : "watch his things"} for ${offer} centimes.`, 4);
  void writeHandLines(db, r).catch(() => {});
  const over = task === "carry" && job && promised(db, job.id) > job.pay_c;
  const plainPlan = plan === "now" ? `${offer} centimes, paid now.` : plan === "half" ? `${first} now, the rest when it's done.` : "All of it when it's done, mind.";
  return {
    ok: true,
    action: null,
    instant: true,
    keep: true,
    line: task === "carry" ? `${plainPlan} I'll see to the ${goodsNoun(job)}${cart ? ", with your cart" : ""}.` : `${plainPlan} I'll keep an eye out.`,
    patch: { trust_delta: 0, end_conversation: true },
    extra: { note: `${r.first} works for you now.${over ? " You will pay out more than the job pays you." : ""}` },
  };
}

function goodsNoun(j: JobRow | null): string {
  return j?.task?.kind === "carry" ? j.task.goods : "goods";
}

/** Where a hand stands to take the shafts: two paces from the cart, toward the goods, on open ground. */
function besideCart(c: { x: number; z: number }, toward: { x: number; z: number }): { x: number; z: number } {
  const dx = toward.x - c.x;
  const dz = toward.z - c.z;
  const L = Math.hypot(dx, dz) || 1;
  return walkMap().nearestOpen(c.x + (dx / L) * 2.2, c.z + (dz / L) * 2.2, 3) ?? { x: c.x, z: c.z };
}

/** One load: to the goods, pick one up, carry it to the goal. */
function loadSteps(s: HireState): Step[] {
  return [
    { kind: "walk_to", x: s.from!.x, z: s.from!.z, label: s.from!.label },
    { kind: "pick_up", job: s.job ?? undefined, x: s.from!.x, z: s.from!.z, label: s.from!.label, count: s.cart ? s.cart.per_trip : 1 },
    { kind: "carry", job: s.job ?? undefined, x: s.to!.x, z: s.to!.z, label: s.to!.label },
  ];
}

/** A point about 3.5 m to the side of `at` (across the way from `from`), on open ground. */
function aside(at: { x: number; z: number }, from: { x: number; z: number }): { x: number; z: number } {
  const dx = at.x - from.x;
  const dz = at.z - from.z;
  const L = Math.hypot(dx, dz) || 1;
  for (const k of [1, -1]) {
    const q = walkMap().nearestOpen(at.x - (dz / L) * 3.5 * k - (dx / L) * 1.5, at.z + (dx / L) * 3.5 * k - (dz / L) * 1.5, 2);
    if (q) return q;
  }
  return at;
}

/** Somewhere well away from Jef and the goal, on the walk grid (a hand walking off with the goods). */
function awayPoint(s: HireState): { x: number; z: number } {
  const from = s.from!;
  const to = s.to!;
  const dx = from.x - to.x;
  const dz = from.z - to.z;
  const L = Math.hypot(dx, dz) || 1;
  const wm = walkMap();
  for (const d of [45, 35, 55, 25]) {
    for (const turn of [0, 0.6, -0.6, 1.2, -1.2]) {
      const c = Math.cos(turn);
      const sn = Math.sin(turn);
      const ux = (dx / L) * c - (dz / L) * sn;
      const uz = (dx / L) * sn + (dz / L) * c;
      const q = wm.nearestOpen(from.x + ux * d, from.z + uz * d, 4);
      if (q) return q;
    }
  }
  return { x: from.x + 20, z: from.z };
}

// ------------------------------------------------------------------ as the steps end

function afterStep(db: DB, id: number, npc: string, r: Routine, res: { kind: string; ok: boolean; why: string }): void | "end" {
  const s = st(r);
  const who = resident(db, npc);
  switch (res.kind) {
    case "walk_to":
      if (!res.ok) {
        // no way to Jef's cart: by hand, then
        if (s.cart && !s.cart.taken && r.steps[r.i - 1]?.label === "Jef's handcart") {
          s.cart = null;
          for (const step of r.steps) if (step.kind === "pick_up") step.count = 1;
          saveRoutine(db, id, r);
          return;
        }
        endRoutine(db, id, "failed", "no way", "I can't get through there. You'll have to carry them yourself.");
        return "end";
      }
      // at Jef's cart: it is his to push now (out of Jef's list), or gone (Jef took it): by hand, then
      if (s.cart && !s.cart.taken && r.steps[r.i - 1]?.label === "Jef's handcart") {
        const c = lendCart(db, s.cart.id);
        if (c) Object.assign(s.cart, { taken: true, data: c });
        else s.cart = null;
        for (const step of r.steps) if (step.kind === "pick_up") step.count = s.cart ? s.cart.per_trip : 1;
        saveRoutine(db, id, r);
      }
      return;
    case "pick_up": {
      if (!res.ok) {
        // nothing left to pick up: the job is carried (by him, the crew or Jef); or he cannot get at what is left
        if (res.why === "none_left") endRoutine(db, id, "done", "all carried");
        else endRoutine(db, id, "failed", res.why, "I can't get at that one. It's yours to carry.");
        return "end";
      }
      // how many he took (the client's word, clamped by the route to the step's count): one by hand
      if (!(s.holding > 0)) s.holding = 1;
      // the engine's roll at the hire: this is the load he walks off with
      if (s.walk_off_at !== null && s.loads >= s.walk_off_at) {
        const next = r.steps[r.i];
        if (next?.kind === "carry") Object.assign(next, { off: true, ...awayPoint(s), label: "away" });
      }
      saveRoutine(db, id, r);
      return;
    }
    case "carry": {
      if (!res.ok) {
        s.holding = 0;
        saveRoutine(db, id, r);
        endRoutine(db, id, "failed", res.why, "I can't get it through. Here it lies.");
        return "end";
      }
      const off = r.steps[r.i - 1]?.off;
      const carried = Math.max(1, s.holding);
      s.holding = 0;
      if (off) {
        saveRoutine(db, id, r);
        walkedOff(db, id, r);
        return "end";
      }
      s.loads += carried;
      if (s.ask_more_at !== null && !s.asked && s.loads >= s.ask_more_at && goodsLeft(db, s.job ?? -1) > 0) {
        s.asking = Math.max(5, round5(s.wage_c * 0.5));
        addSteps(r, [{ kind: "wait", minutes: ASK_WAIT_MIN, label: "asking for more", why: "asks for more" }], true);
        saveRoutine(db, id, r);
        if (who) askMore(db, who, s.asking);
        return;
      }
      if (s.job !== null && goodsLeft(db, s.job) > 0) addSteps(r, loadSteps(s), true);
      saveRoutine(db, id, r);
      return;
    }
    case "wait": {
      if (s.task === "watch") return; // the watch is over; the routine ends done
      if (s.asking > 0) {
        // Jef never answered: he quits
        s.asking = 0;
        saveRoutine(db, id, r);
        endRoutine(db, id, "failed", "quit", linesFor(db, who).quit);
        return "end";
      }
      if (s.job !== null && goodsLeft(db, s.job) > 0) addSteps(r, loadSteps(s), true);
      saveRoutine(db, id, r);
      return;
    }
  }
}

/** The engine's roll came up: he walked off with the load. A robbery on the record (the police case), a memory, the town's talk later. */
function walkedOff(db: DB, id: number, r: Routine): void {
  const row = activeRoutines(db, "hire").find((x) => x.row.id === id)?.row;
  const who = row ? resident(db, row.npc_id) : null;
  const s = st(r);
  const j = s.job !== null ? listJobs(db, player(db).day).find((x) => x.id === s.job) : null;
  const share = j?.task?.kind === "carry" ? Math.round(j.pay_c / j.task.count) : 0;
  const withCart = !!s.cart?.taken;
  // the load (with the cart it is the whole cart and what is on it), the wage paid: what it cost Jef
  const worth = s.paid_c + share * Math.max(1, s.cart?.taken ? s.cart.per_trip : 1) + (withCart ? (s.cart!.data?.paid_c ?? 0) : 0);
  if (who) {
    log(db, "robbed", who.id, `${who.name}, hired by Jef, walked off with ${withCart ? "Jef's handcart and its load" : "a load of his job"} and the wage paid, worth ${worth} centimes.`, "world");
    remember(db, who.id, "I walked off with a load of Jef's, and his coin in my pocket. Easy money.", 5);
  }
  s.stole = true;
  saveRoutine(db, id, r);
  bus.broadcast({ type: "hands", npc: who?.id ?? "", name: who?.name ?? "", line: "", say: `${who?.first ?? "Your hand"} is gone, and ${withCart ? "your handcart and its load" : "a load"} with him.` });
  endRoutine(db, id, "failed", "walked off", "");
}

/** He stops and asks for more: a push for the client; the answer is a line Jef says in talk. */
function askMore(db: DB, who: Resident, extra: number): void {
  const line = `${linesFor(db, who).ask_more} ${extra} centimes more, or I put it down here.`;
  remember(db, who.id, `I asked Jef for ${extra} centimes more, halfway through the work.`, 3);
  bus.broadcast({ type: "hands", npc: who.id, name: who.name, line, ask: extra });
}

/** Jef's answer to a hand who asked for more (the talk's engine topics). */
export function answerAsk(db: DB, npc: string, pay: boolean, rng: () => number = Math.random): { text: string; quit: boolean } {
  const g = routineFor(db, npc, "hire");
  const who = resident(db, npc);
  if (!g || !who) throw new GameError("nobody is asking you for anything", 409);
  const s = st(g.r);
  if (!(s.asking > 0) || g.r.steps[g.r.i]?.kind !== "wait") throw new GameError("nobody is asking you for anything", 409);
  const extra = s.asking;
  if (pay) {
    stepPay(db, npc, extra, "more, asked halfway");
    s.wage_c += extra;
    s.paid_c += extra;
    s.asking = 0;
    s.asked = true;
    reportStep(db, g.row.id, g.r.i, true, "paid more", (r) => Object.assign(r.state, s));
    return { text: "That's more like it. Back to it, then.", quit: false };
  }
  s.asking = 0;
  s.asked = true;
  // a bargain is a bargain: the honest grumble and carry on; the rest may down tools
  const carriesOn = who.stats.honesty >= 4 || rng() < 0.5;
  if (carriesOn) {
    reportStep(db, g.row.id, g.r.i, true, "carries on", (r) => Object.assign(r.state, s));
    return { text: linesFor(db, who).carry_on, quit: false };
  }
  saveRoutine(db, g.row.id, { ...g.r, state: s });
  endRoutine(db, g.row.id, "failed", "quit", "");
  return { text: linesFor(db, who).quit, quit: true };
}

/** The talk's engine topics for a hand who stands asking for more. */
function askTopics(db: DB, r: Resident): ExtraTopic[] {
  const g = routineFor(db, r.id, "hire");
  if (!g || !(st(g.r).asking > 0)) return [];
  const extra = st(g.r).asking;
  return [
    { choice: `All right, ${extra} more. Now get on with it.`, answer: (d, who) => answerAsk(d, who.id, true) },
    { choice: "No. A bargain is a bargain.", answer: (d, who) => { const a = answerAsk(d, who.id, false); return { text: a.text, end: a.quit }; } },
  ];
}

/** The rest of the wage, by the engine: at the end in full; stopped early, for what was carried. */
function settleWage(db: DB, npc: string, s: HireState, finished: boolean): { paid: number; owed: number } {
  if (s.stole) return { paid: 0, owed: 0 };
  const due = finished || s.task === "watch" ? s.wage_c : round5((s.wage_c * s.loads) / Math.max(1, s.expected));
  const owed = Math.max(0, Math.min(s.wage_c, due) - s.paid_c);
  if (!owed) return { paid: 0, owed: 0 };
  const have = player(db).money_c;
  const pay = Math.min(have, owed);
  if (pay) stepPay(db, npc, pay, finished ? "the rest of a wage" : "a wage for what was carried");
  s.paid_c += pay;
  if (pay < owed) {
    const who = resident(db, npc);
    db.prepare("UPDATE npc_relationship SET trust = MAX(-5, trust - 2) WHERE npc_id = ?").run(npc);
    remember(db, npc, `Jef owes me ${owed - pay} centimes of my wage. He had not got it.`, 6, "seen", null, { gist: `Jef did not pay ${who?.name ?? "a hand"} all his wage`, tone: -2 });
  }
  return { paid: pay, owed: owed - pay };
}

function ended(db: DB, row: { id: number; npc_id: string }, r: Routine, status: "done" | "failed", outcome: string): string {
  const s = st(r);
  const who = resident(db, row.npc_id);
  const finished = status === "done" && (s.task === "watch" || s.job === null || goodsLeft(db, s.job) === 0 || outcome === "all carried");
  const w = settleWage(db, row.npc_id, s, finished);
  // Jef's cart back in his list, empty, at the goal (a thief keeps it)
  if (s.cart?.taken && s.cart.data && !s.stole) {
    // where he left it (the client's last word: a cart held up in a market is left short of the goal), else beside
    // the goal (never on the chalk ring, where the goods go down), else where it stood
    const last = s.cart_at as { x: number; z: number } | undefined;
    const at = last ?? (finished && s.to && s.from ? aside(s.to, s.from) : { x: s.cart.x, z: s.cart.z });
    const near = s.to && Math.hypot(at.x - s.to.x, at.z - s.to.z) < 2.5 && s.from ? aside(s.to, s.from) : at;
    returnCart(db, s.cart.data, near.x, near.z, s.cart.yaw);
  }
  if (s.stole) return "";
  if (who && s.loads > 0) remember(db, who.id, `I carried ${s.loads} ${s.loads === 1 ? "load" : "loads"} for Jef${w.owed ? ", and he still owes me" : ", and he paid"}.`, 3, "seen", null, w.owed ? null : { gist: `Jef hired ${who.name} and paid a fair wage`, tone: 1 });
  const l = linesFor(db, who);
  if (w.owed) return `${w.paid ? `${w.paid} centimes? ` : ""}You owe me ${w.owed} more, and I'll not forget it.`;
  if (status === "failed") return outcome === "quit" ? l.quit : w.paid ? `${w.paid} centimes for what I carried. I'm off.` : "";
  return w.paid ? `${l.done} ${w.paid} centimes more, and we're square.` : l.done;
}

// ------------------------------------------------------------------ their lines (the model's where the share allows)

export const HandLinesSchema = z.object({
  done: z.string().min(1).max(120),
  ask_more: z.string().min(1).max(120),
  quit: z.string().min(1).max(120),
  carry_on: z.string().min(1).max(120),
});
export type HandLines = z.infer<typeof HandLinesSchema>;

export function engineLines(r: Resident | null): HandLines {
  const hot = (r?.stats.temper ?? 5) >= 6;
  const warm = (r?.stats.warmth ?? 5) >= 6;
  return {
    done: warm ? "That's the lot, and glad to help." : "That's the lot.",
    ask_more: hot ? "This is heavier than you said." : "It's more work than I thought, this.",
    quit: hot ? "Then carry them yourself." : "Then I'm done. Find another man.",
    carry_on: hot ? "Hm. A bargain's a bargain, I suppose." : "All right, all right. I'll finish.",
  };
}

const linesKey = (db: DB, id: string) => `hands:lines:${clock(db).day}:${id}`;
export function linesFor(db: DB, r: Resident | null | undefined): HandLines {
  if (!r) return engineLines(null);
  return getState<HandLines | null>(db, linesKey(db, r.id), null) ?? engineLines(r);
}

const HAND_RULES = `
YOU NOW WRITE FOUR SHORT LINES FOR A HIRED HAND, 1873. Jef, a young man new in town, has hired the person below for a few centimes
to carry the goods of a job he took. Write what they say, in their own voice, by their stats:
- done: when the last load is down. ask_more: halfway, when they want more money (the game adds the sum). quit: when Jef will
  not pay more and they down tools. carry_on: when Jef says no and they grumble and finish anyway.
- Each one short sentence, at most 14 words. No oaths, no threats. Never name a sum, a number or a coin.
- ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

/** One call for a hand's lines (hook hands_lines, its own small share), in the background. */
export async function writeHandLines(db: DB, r: Resident, runner?: Runner): Promise<"claude" | "engine" | "cached"> {
  if (getState(db, linesKey(db, r.id), null)) return "cached";
  if (!canCallShare(db, ["hands_lines"], HANDS_CALLS_PER_DAY)) return "engine";
  const rel = relationship(db, r.id);
  const prompt = `PERSON: ${r.name}, ${r.age}, ${r.sex === "f" ? "woman" : "man"}, ${TRADES[r.trade]?.label ?? r.trade}. Stats 0-10: temper ${r.stats.temper}, warmth ${r.stats.warmth}, greed ${r.stats.greed}, honesty ${r.stats.honesty}. Trust in Jef ${trustText(rel?.trust ?? 0)}.`;
  const res = await callClaude(db, { hook: "hands_lines", system: SYSTEM + "\n" + HAND_RULES, prompt, schema: HandLinesSchema }, runner);
  if (!res.ok || !res.data) return "engine";
  const fb = engineLines(r);
  const clean = (k: keyof HandLines) => cleanLine(res.data![k], 120) ?? fb[k];
  setState(db, linesKey(db, r.id), { done: clean("done"), ask_more: clean("ask_more"), quit: clean("quit"), carry_on: clean("carry_on") });
  return "claude";
}

// ------------------------------------------------------------------ install, tick, what the client sees

let installed = false;
export function installHire(): void {
  stepHooks.after.hire = (db, row, r, res) => afterStep(db, row.id, row.npc_id, r, res);
  stepHooks.ended.hire = (db, row, r, status, outcome) => ended(db, row, r, status, outcome);
  stepHooks.timeUp.hire = (db, row) => {
    endRoutine(db, row.id, "failed", "home", "That's my day done. I'm off home.");
    return true;
  };
  if (installed) return;
  installed = true;
  talkExtras.topics.push((db, r) => askTopics(db, r));
  cartGuards.push((db, x, z) => watchedBy(db, x, z));
  talkExtras.context.push((db, r) => {
    const g = routineFor(db, r.id, "hire");
    if (!g) return "";
    const s = st(g.r);
    return `WORKING FOR JEF: he hired you to ${s.task === "carry" ? "carry the goods of his job" : "watch his things"} for ${s.wage_c} centimes; ${s.paid_c} paid so far. ${s.loads} loads carried.${s.asking ? ` You have stopped and asked him for ${s.asking} more.` : ""}`;
  });
}

/** Every tick: a hand whose working day is over goes home (paid for what was carried). */
export function hireTick(db: DB): number {
  let n = 0;
  for (const { row } of activeRoutines(db, "hire")) {
    const who = resident(db, row.npc_id);
    if (who && nowOf(db, who).act === "home" && clock(db).hour >= 18) {
      endRoutine(db, row.id, "failed", "home", "That's my day done. I'm off home.");
      n++;
    }
  }
  return n;
}

/** A hand watching this spot keeps thieves off Jef's cart (town/handcart.ts asks). */
export function watchedBy(db: DB, x: number, z: number): boolean {
  return crew(db).some((c) => c.state.task === "watch" && c.state.from && Math.hypot(c.state.from.x - x, c.state.from.z - z) < 20);
}
