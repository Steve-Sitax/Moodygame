import { sexed } from "../player/profile.ts"; // M7 character: lines said to the player follow the profile
import type { DB } from "../db.ts";
import { CALLS_PER_DAY, CALLS_RESERVE, ROUTINE_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { log, player } from "../game.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { gateText } from "../hooks/dialogue.ts";
import { relationship, remember, trustText } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { ITEMS, POCKET_SLOTS, atWork, waresOf } from "../trade.ts";
import { gameMinute } from "../town/deeds.ts";
import { TRADES } from "../town/places.ts";
import type { Resident } from "../town/population.ts";
import { resident, town, TOWN_EMPLOYER_IDS } from "../town/store.ts";
import { jefSaid, nowOf, talkExtras } from "../town/talk.ts";
import { walkMap } from "../town/walkmap.ts";
import { askFor, isKeeperAtWork, MAX_WAGE_C, offerFrom, planFrom, sumsIn, type PayPlan } from "../town/hire.ts";
import { jefCarts, lendCart, returnCart, type JefCart } from "../town/handcart.ts";
import { lease } from "../homes/homes.ts";
import { homeDef } from "../homes/town.ts";
import { getState, keeperAtWork, setState, tavernPlace } from "../interiors/state.ts";
import { cleanLine } from "../interiors/tavern.ts";
import { bus } from "./bus.ts";
import { actionOf, actionRow, findPerson, findPlace, isReserved, jefAt, posOf, proposeHooks, whereIs, type Accepted, type ActionRow, type Refused, type Where } from "./actions.ts";
import { publishConvo } from "./convo.ts";
import { writeEvent } from "./eventlog.ts";
import { activeRoutines, endRoutine, reportStep, routineFor, routineOf, saveRoutine, startRoutine, stepHooks, stepPay, type Routine, type Step, type StepResult } from "./steps.ts";
import { FOLLOW_DEFAULT_MIN, FOLLOW_MAX_MIN, FOLLOW_MIN_MIN, REFUSE_LINE, STORY_MINUTE_FACTOR, VIOLENCE_RE, type ActionProposal } from "./vocab.ts";
import { gameMin } from "../../../shared/clock.ts";
import {
  BUY_MAX,
  CHECKIN_STALE_MIN,
  CHECKINS_PER_ROUTINE,
  CheckinSchema,
  LEG_MAX_M,
  RETRY_WAIT_MIN,
  ROUTE_MAX_M,
  ROUTINE_MAX_MIN,
  ROUTINE_MAX_STEPS,
  ROUTINE_MIN_MIN,
  ROUTINES_IN_TOWN,
  ROUTINES_PER_RESIDENT,
  RoutinePlanSchema,
  WAIT_ROUTINE_MAX_MIN,
  type Checkin,
  type PlanStep,
  type RoutinePlan,
  type SuccessKind,
} from "./routineVocab.ts";

// AI-composed routines (M6, Steve 2026-09-24): "AI could make them do an unprogrammed routine just
// based upon my questions, is that possible? If that happens, AI should keep checking in and
// steering the NPC if needed until it is done."
//
// The talk reply may propose a "routine": a goal, a success condition from a fixed list, and 1 to 8
// steps from a fixed list (routineVocab.ts). The ENGINE checks the person (as for the M4 actions:
// their trade, their post, trust, the hour, the caps), the words (no stealing, no harm, no fire, no
// money fetched, no one else's house), and every step (a real place or person, a way there on foot,
// a shop that sells the thing, Jef's money for it at the engine's price, a thing that exists). A bad
// step is left out; a step that breaks a rule refuses the whole errand. What is left becomes a
// routine of the step executor (steps.ts, purpose "errand"): Jef's coins first (the engine's pay
// steps), then the walks, the buying, the giving, the talking, and the way back to Jef.
//
// Each step is checked again when it comes up. When a step fails, or the rain or the night comes on,
// the model is asked in a check-in (hook routine_checkin, its own share of the day's calls, 20 s):
// continue, a changed next step, skip, come back to Jef, or give up. Its answer is checked like the
// plan. Without a call (the share, the routine's five, a late or broken answer) the engine steers:
// retry once, then come back and report. Money and things move only through engine code here.

export const PURPOSE = "errand";
export const CHECKIN_HOOK = "routine_checkin";

// ------------------------------------------------------------------ the routine's own numbers

interface Carried {
  kind: string;
  /** From Jef's pockets (else bought with his coins). */
  jef: boolean;
}

export interface ErrandState {
  goal: string;
  success: SuccessKind;
  /** The plan steps as the engine kept them (the model's, cleaned; a check-in's new ones added). */
  plan: PlanStep[];
  /** The one it is for (a give or a message), if any. */
  recipient: string | null;
  /** Jef's coins in their hand for buying, and what is spent of them. */
  purse_c: number;
  spent_c: number;
  /** The wage (0: a favour), what is paid of it, and how. */
  wage_c: number;
  paid_c: number;
  pay: PayPlan;
  favour: boolean;
  carried: Carried[];
  /** Jef's handcart, once they have it (the client draws it on them: listRoutines reads `cart.taken`). */
  cart: { id: string; x: number; z: number; yaw: number; taken: boolean; data?: JefCart } | null;
  cart_at?: { x: number; z: number } | null;
  /** Where they last arrived (a walk's end). */
  at: { x: number; z: number } | null;
  checkins: number;
  /** Retries the engine gave a plan step (by its tag). */
  retried: Record<string, number>;
  weather: string;
  night: boolean;
  outcome: Partial<Record<SuccessKind, boolean>>;
  /** What happened, short, newest last (the check-in's prompt, the report). */
  said: string[];
  /** The line they report with, if a check-in gave one. */
  report_line: string | null;
  /** Where Jef was when he asked. */
  jef: { x: number; z: number } | null;
  /** A check-in is out (game minute it began). */
  steering: number | null;
  /** What they said to the message's addressee, and what came back. */
  reply: string | null;
  /** Things of Jef's (or bought with his coins) handed back to him on his return. */
  back?: string[];
  [k: string]: unknown;
}
const st = (r: Routine) => r.state as ErrandState;

// ------------------------------------------------------------------ words the engine reads

/** Asking for a crime or harm: the whole errand is refused (whoever asks, whatever the model planned). */
export const CRIME_RE =
  /\b(steal\w*|stole|stolen|nick (his|her|their|a|the)|pinch (his|her|their|a|the)|filch\w*|pick(ing)? (his|her|their|a|the|somebody's|someone's) pockets?|pickpocket\w*|lift (his|her|their|a|the) (purse|wallet)|rob (him|her|them|the|a|his|her)|robbing|burgl\w*|break (in|into)|broke into|breaking in|smash\w*|burn\w*|set (fire|alight)|on fire|torch (it|the)|arson|kill\w*|hurt (him|her|them)|beat (him|her|them)( up)?|stab\w*|poison\w*|threaten\w*|mug (him|her|them)|knock (him|her|them) down|loot\w*|swindle\w*|cheat (him|her|them))\b/i;
/** Fetching money from anywhere (a bank, a purse, someone's till): refused. Nobody carries money for Jef. */
export const MONEY_FETCH_RE =
  /\b(bring|fetch|get|take|collect|draw|withdraw|carry|grab|lift)\s+(me\s+|us\s+|him\s+|her\s+)?(the\s+|some\s+|a\s+|my\s+|his\s+|her\s+|their\s+|this\s+|that\s+|these\s+|all\s+(the\s+)?)?(\d[\d,.]*\s*|a (few|hundred|thousand)\s+|[\w']+\s+)?(francs?|centimes?|money|cash|coins?|gold|purse|wallet|savings|fortune)\b|\b(from|at|to|in|into|rob) the bank\b(?! of)/i;
const MONEY_ITEM_RE = /\b(francs?|centimes?|money|cash|coins?|gold|purse|wallet|savings|sous?)\b/i;
/** A house or a room: someone's home. */
const HOME_RE = /\b(house|home|room|rooms|lodging|lodgings|garret|cellar|flat|bedroom|kitchen|parlour|attic)\b/i;
/** Jef himself as a target. */
const JEF_RE = /^\s*(me|jef|myself|to me|back to me|back|jef's side|with me|you)\s*$/i;
/** Where Jef stands: "this door", "here", "" . */
const HERE_RE = /^\s*(|here|there|this (door|spot|place|corner|gate|cart)|where (i|you|we) (stand|am|are)|my side)\s*$/i;

/** An item from words: the engine's own kinds only. */
export function itemKind(words: string): string | null {
  const t = words.toLowerCase().trim();
  if (!t) return null;
  const alias: Array<[RegExp, string]> = [
    [/\b(bread|loaf|loaves|rye)\b/, "bread"],
    [/\b(herrings?|fish)\b/, "herring"],
    [/\beels?\b/, "eel"],
    [/\bapples?\b/, "apple"],
    [/\bbiscuits?\b/, "biscuit"],
    [/\blanterns?\b/, "lantern"],
    [/\b(newspaper|paper|handelsblad)\b/, "newspaper"],
    [/\bbeer\b/, "beer"],
    [/\b(jenever|gin)\b/, "jenever"],
    [/\bsoup\b/, "soup"],
  ];
  for (const [re, k] of alias) if (re.test(t)) return k;
  if (ITEMS[t]) return t;
  const hit = Object.entries(ITEMS).find(([, d]) => d.name.toLowerCase().includes(t) && t.length >= 4);
  return hit ? hit[0] : null;
}

/** A thing a runner can carry across town (food in paper, a lantern, the paper). */
function carriable(kind: string): boolean {
  const d = ITEMS[kind];
  if (!d) return false;
  if (d.atCounter || d.use === "drink") return false;
  return d.use === "eat" || kind === "lantern" || kind === "newspaper";
}

const nameOf = (kind: string) => ITEMS[kind]?.name ?? kind;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ the engine's lines

export type ErrandRefusal =
  | "crime"
  | "steal"
  | "harm"
  | "money"
  | "private_home"
  | "too_many_steps"
  | "child"
  | "post"
  | "at_stall"
  | "night"
  | "dark"
  | "no_trust"
  | "proud"
  | "busy"
  | "queue_full"
  | "town_full"
  | "nothing_left"
  | "wage"
  | "no_money";

const LINES: Record<string, string> = {
  steal: "Steal? Find yourself another fool.",
  steal_thief: "Not on your say-so, friend. I pick my own pockets, and I keep what's in them.",
  harm: "Are you mad? I'll have no part in that.",
  money: "Money? Nobody hands me a purse to carry about for you. Fetch your own money.",
  private_home: "I'll not go into another man's house. Not for you, not for anyone.",
  too_many_steps: "One thing at a time. That's a week of errands, that.",
  child: "I'm too small to go all that way, mister.",
  post: REFUSE_LINE.post,
  at_stall: REFUSE_LINE.at_stall,
  night: "At this hour? I'm for my bed.",
  dark: REFUSE_LINE.dark,
  no_trust: "Run your own errands. I don't know you.",
  proud: "Do I look like an errand boy to you?",
  busy: REFUSE_LINE.busy,
  queue_full: "I've two of your errands on my hands already.",
  town_full: REFUSE_LINE.too_many,
  // a step the engine left out
  unknown_place: REFUSE_LINE.unknown_place,
  unknown_person: REFUSE_LINE.unknown_person,
  no_way: REFUSE_LINE.no_way,
  too_far: REFUSE_LINE.too_far,
  indoors: "They're indoors now, and not at home. I can't get at them.",
  closed: "Every place that sells it is shut at this hour.",
  not_sold: "Nobody near here sells that.",
  no_item: "You've no such thing on you.",
  not_yours: "That's not yours to send.",
  no_cart: "You've no handcart standing about that I know of.",
  loaded: "Your cart's loaded. Unload it first, I'm not pushing your goods about.",
  drink_out: "They'll not let a glass out of the door.",
  too_big: "That's not a thing I can carry across town.",
  past: "That hour's gone already.",
  no_indoors: "They'll not let me in there.",
  nothing: "Do what, then? Say it plain.",
};

// ------------------------------------------------------------------ where things are

interface Spot {
  x: number;
  z: number;
  label: string;
  /** A person to walk up to (the client follows them), or "jef". */
  who?: string;
}

/** Jef's landlady or landlord (his rented home, M6 homes). */
function landlord(db: DB): Resident | null {
  const l = lease(db);
  const h = l ? homeDef(db, l.home) : null;
  return h ? (resident(db, h.landlord) ?? null) : null;
}

/** A person from words: "my landlady", a name, "Anna's house" (the person), never an infant. */
export function personFrom(db: DB, words: string, near: { x: number; z: number } | null): Resident | null {
  const t = words.trim();
  if (!t || JEF_RE.test(t)) return null;
  if (/\b(landlady|landlord)\b/i.test(t)) return landlord(db);
  const bare = t
    .replace(/'s?\b.*$/i, "")
    .replace(/\b(the )?(house|home|door|room|place|stall|shop) of\b/gi, "")
    .replace(HOME_RE, "")
    .trim();
  return findPerson(db, bare || t, near) ?? findPerson(db, t, near);
}

/** A person's spot now: in the street, at their home door (they are at home), or null (indoors elsewhere). */
function personSpot(db: DB, who: Resident): (Spot & { home: boolean }) | null {
  const at = posOf(db, who.id) ?? whereIs(db, who);
  if (!at.indoors) {
    const q = walkMap().nearestOpen(at.x, at.z, 4);
    return q ? { ...q, label: who.name, who: who.id, home: false } : null;
  }
  if (nowOf(db, who).act === "home") {
    const q = walkMap().nearestOpen(who.home.sx, who.home.sz, 4);
    return q ? { ...q, label: `${who.name}'s door`, who: who.id, home: true } : null;
  }
  return null;
}

/** Where Jef is now (on the walk grid), else where he asked them, else where he is. */
function jefSpot(state: { jef: { x: number; z: number } | null }): Spot {
  for (const j of [jefAt(), state.jef]) {
    if (!j) continue;
    const q = walkMap().nearestOpen(j.x, j.z, 12);
    if (q) return { x: q.x, z: q.z, label: "Jef", who: "jef" };
  }
  const j = jefAt() ?? state.jef ?? { x: 0, z: 0 };
  return { x: j.x, z: j.z, label: "Jef", who: "jef" };
}

/** A place from words (a shop, a tavern, a square), on the walk grid. */
function placeSpot(db: DB, words: string): (Spot & { id: string }) | null {
  const p = findPlace(db, words);
  if (!p) return null;
  const q = walkMap().nearestOpen(p.x, p.z, 4);
  return q ? { x: q.x, z: q.z, label: p.label, id: p.id } : null;
}

interface Seller {
  id: string;
  name: string;
  label: string;
  x: number;
  z: number;
  price_c: number;
  open: boolean;
  /** The shop or the stall's place. */
  where: string;
}

/** Everyone who sells this kind in the town (one per shop or stall, an open one first), with the engine's price now. */
export function sellersOf(db: DB, kind: string): Seller[] {
  const t = town(db).town;
  const best = new Map<string, Seller>();
  for (const r of t.residents) {
    // only sellers who stand somewhere (a shop, a stall, a counter, a post); never a pedlar on his round
    if (!["shop", "stall", "tavern", "post"].includes(r.work.kind)) continue;
    const ware = waresOf(db, r.id).find((w) => w.kind === kind);
    if (!ware) continue;
    const where = r.work.shop ?? (r.work.stall !== undefined ? `stall:${r.work.stall}` : r.work.place);
    const open = atWork(db, r.id);
    const prev = best.get(where);
    if (prev && (prev.open || !open)) continue;
    const w = r.work.at ? { x: r.work.at[0], z: r.work.at[1] } : whereIs(db, r);
    const q = walkMap().nearestOpen(w.x, w.z, 4);
    if (!q) continue;
    const label = r.work.shop
      ? (t.places[r.work.shop]?.label ?? r.name)
      : r.work.stall !== undefined
        ? `${r.first}'s stall on ${t.places[t.stalls[r.work.stall]?.place ?? ""]?.label ?? "the market"}`
        : (t.places[r.work.place]?.label ?? r.name);
    best.set(where, { id: r.id, name: r.name, label, x: q.x, z: q.z, price_c: ware.price_c, open, where });
  }
  return [...best.values()];
}

/** Jef's things in his pockets he may send (not a job's, not a letter or a ticket). */
function jefHas(db: DB, kind: string): boolean {
  return !!db.prepare("SELECT 1 FROM item WHERE kind = ? AND job_id IS NULL").get(kind) && !["parcel", "letters", "letter", "pawn_ticket", "diary", "found", "medal"].includes(kind);
}

// ------------------------------------------------------------------ one plan step into executor steps

interface Drop {
  reason: string;
  line: string;
}

interface MapCtx {
  db: DB;
  r: Resident;
  /** Where the walk starts from (the last step's end). */
  from: { x: number; z: number };
  /** The plan step's index (its steps are tagged with it). */
  k: number;
  /** Kinds they will hold by then (bought or taken), and how many. */
  holding: Map<string, number>;
  /** People the plan is for: their own door is allowed. */
  addressees: Set<string>;
  jef: { x: number; z: number } | null;
  /** Coins that may be spent (a check-in: what is left in their hand; the plan: unlimited, it is added up). */
  purseLeft: number | null;
  /** At plan time a shut named seller is swapped for an open one; at a check-in the model must name it. */
  swap: boolean;
  /** Jef's words (numbers in a message must be his). */
  words: string;
}

interface Mapped {
  steps: Step[];
  end: { x: number; z: number } | null;
  /** Walked metres (for the limits and the time). */
  metres: number;
  drop?: Drop;
  fatal?: Drop & { kind: ErrandRefusal };
  /** Coins this step spends (buy). */
  cost?: number;
  /** A thing taken from Jef's pockets first. */
  take?: string;
  recipient?: string;
  /** A limit the engine set (said on acceptance). */
  limit?: string;
  cart?: ErrandState["cart"];
  waitMin?: number;
  /** buy: the shut seller the engine sent them past. */
  swappedFrom?: { x: number; z: number };
}

const tag = (k: number | "e", role: string) => `${k}:${role}`;
const tagK = (s: Step | undefined): string => (s?.tag ?? "").split(":")[0];
const tagRole = (s: Step | undefined): string => (s?.tag ?? "").split(":")[1] ?? "";

function walkStep(ctx: MapCtx, to: Spot, role = "walk"): { step: Step; metres: number; drop?: Drop } {
  const q = walkMap().nearestOpen(to.x, to.z, 4);
  if (!q) return { step: { kind: "walk_to", x: to.x, z: to.z }, metres: 0, drop: { reason: "no_way", line: LINES.no_way } };
  const metres = dist(ctx.from, q);
  if (metres > LEG_MAX_M) return { step: { kind: "walk_to", x: q.x, z: q.z }, metres, drop: { reason: "too_far", line: LINES.too_far } };
  return { step: { kind: "walk_to", x: q.x, z: q.z, label: to.label, ...(to.who ? { who: to.who } : {}), tag: tag(ctx.k, role) }, metres };
}

/** Rules every step's words must keep: no crime, no harm, no money fetched. */
function brokenRule(_db: DB, r: Resident, text: string): (Drop & { kind: ErrandRefusal }) | null {
  if (!text.trim()) return null;
  if (VIOLENCE_RE.test(text) || /\b(burn\w*|set (fire|alight)|on fire|arson|torch (it|the))\b/i.test(text)) return { kind: "harm", reason: "harm", line: LINES.harm };
  if (CRIME_RE.test(text)) return { kind: "steal", reason: "steal", line: r.trade === "thief" || r.trade === "runner" ? LINES.steal_thief : LINES.steal };
  if (MONEY_FETCH_RE.test(text)) return { kind: "money", reason: "money", line: LINES.money };
  return null;
}

/** A message they will pass on: cleaned; numbers only if Jef said them; the gate's words never. */
export function cleanMessage(text: string, words: string): string | null {
  const t = cleanLine(String(text ?? "").replace(/^["']|["']$/g, ""), 160, true);
  if (!t) return null;
  if (!gateText(t, Date.now(), 0).ok) return null;
  const said = sumsIn(words);
  const mine = [...said.unit, ...said.bare];
  const nums = sumsIn(t);
  for (const n of [...nums.unit, ...nums.bare]) if (!mine.includes(n)) return null;
  if (/\d/.test(t) && !/\d/.test(words)) return null;
  return t;
}

/** One plan step: checked, and turned into the executor's steps. */
export function mapStep(ctx: MapCtx, ps: PlanStep): Mapped {
  const { db, r } = ctx;
  const none: Mapped = { steps: [], end: ctx.from, metres: 0 };
  const fatal = brokenRule(db, r, `${ps.target} ${ps.item} ${ps.message}`);
  if (fatal) return { ...none, fatal };
  switch (ps.kind) {
    case "pay":
      // the engine hands over Jef's coins itself, at its own prices
      return none;
    case "walk_to": {
      if (JEF_RE.test(ps.target)) return mapStep(ctx, { ...ps, kind: "come_back" });
      let spot: Spot | null = null;
      const who = personFrom(db, ps.target, ctx.jef ?? ctx.from);
      if (who && HOME_RE.test(ps.target)) {
        const q = walkMap().nearestOpen(who.home.sx, who.home.sz, 4);
        spot = q ? { ...q, label: `${who.name}'s door` } : null;
      } else if (who && !placeSpot(db, ps.target)) {
        const s = personSpot(db, who);
        if (!s) return { ...none, drop: { reason: "indoors", line: LINES.indoors } };
        spot = s;
      } else if (HERE_RE.test(ps.target)) spot = { ...(ctx.jef ?? ctx.from), label: "where Jef stood" };
      else spot = placeSpot(db, ps.target);
      if (!spot) return { ...none, drop: { reason: "unknown_place", line: LINES.unknown_place } };
      const w = walkStep(ctx, spot);
      if (w.drop) return { ...none, drop: w.drop };
      return { steps: [w.step], end: { x: w.step.x!, z: w.step.z! }, metres: w.metres };
    }
    case "buy": {
      const kind = itemKind(ps.item);
      if (!kind && MONEY_ITEM_RE.test(ps.item)) return { ...none, fatal: { kind: "money", reason: "money", line: LINES.money } };
      if (!kind) return { ...none, drop: { reason: "not_sold", line: LINES.not_sold } };
      if (ITEMS[kind].use === "drink" || ITEMS[kind].atCounter) return { ...none, drop: { reason: "drink_out", line: LINES.drink_out } };
      if (!carriable(kind)) return { ...none, drop: { reason: "too_big", line: LINES.too_big } };
      const count = Math.max(1, Math.min(BUY_MAX, Math.round(ps.count || 1)));
      const all = sellersOf(db, kind).filter((s) => dist(s, ctx.from) <= LEG_MAX_M);
      if (!all.length) return { ...none, drop: { reason: "not_sold", line: LINES.not_sold } };
      // the seller they named: a shop or stall place, or a person; else the nearest open one
      let named: Seller | undefined;
      if (ps.target.trim()) {
        const p = findPlace(db, ps.target);
        const who = personFrom(db, ps.target, ctx.from);
        named = all.find((s) => (p && (s.where === p.id || dist(s, p) < 18)) || (who && s.id === who.id));
      }
      const open = all.filter((s) => s.open).sort((a, b) => dist(a, ctx.from) - dist(b, ctx.from));
      let seller = named ?? open[0];
      let swapped = false;
      if (seller && !seller.open && ctx.swap && open[0]) {
        seller = open[0];
        swapped = true;
      }
      if (!seller) return { ...none, drop: { reason: "closed", line: LINES.closed } };
      if (!seller.open && !ctx.swap) return { ...none, drop: { reason: "closed", line: `${seller.label[0].toUpperCase()}${seller.label.slice(1)} is shut.` } };
      const cost = seller.price_c * count;
      if (ctx.purseLeft !== null && cost > ctx.purseLeft) return { ...none, drop: { reason: "no_money", line: "Jef's coins won't stretch to that." } };
      const w = walkStep(ctx, { x: seller.x, z: seller.z, label: seller.label });
      if (w.drop) return { ...none, drop: w.drop };
      ctx.holding.set(kind, (ctx.holding.get(kind) ?? 0) + count);
      return {
        steps: [w.step, { kind: "buy", who: seller.id, item: kind, count, label: seller.label, x: seller.x, z: seller.z, tag: tag(ctx.k, "buy") }],
        end: { x: w.step.x!, z: w.step.z! },
        metres: w.metres,
        cost,
        ...(swapped ? { swappedFrom: { x: named!.x, z: named!.z }, limit: `${named!.label[0].toUpperCase()}${named!.label.slice(1)} is shut; I'll try ${seller.label}.` } : {}),
      };
    }
    case "give":
    case "take": {
      const kind = itemKind(ps.item);
      if (!kind && MONEY_ITEM_RE.test(`${ps.item} ${ps.target}`)) return { ...none, fatal: { kind: "money", reason: "money", line: LINES.money } };
      if (!kind) return { ...none, drop: { reason: "no_item", line: LINES.no_item } };
      if (ps.kind === "take") {
        // only from Jef's own hand: taking from anyone else is stealing
        if (ps.target.trim() && !JEF_RE.test(ps.target) && !HERE_RE.test(ps.target)) {
          if (personFrom(db, ps.target, ctx.from)) return { ...none, fatal: { kind: "steal", reason: "steal", line: r.trade === "thief" || r.trade === "runner" ? LINES.steal_thief : LINES.steal } };
          return { ...none, drop: { reason: "no_item", line: LINES.no_item } };
        }
        if (!jefHas(db, kind)) return { ...none, drop: { reason: "no_item", line: LINES.no_item } };
        if (!carriable(kind)) return { ...none, drop: { reason: "too_big", line: LINES.too_big } };
        ctx.holding.set(kind, (ctx.holding.get(kind) ?? 0) + 1);
        return { ...none, take: kind };
      }
      // give to Jef: that is bringing it back
      if (JEF_RE.test(ps.target) || HERE_RE.test(ps.target)) return mapStep(ctx, { ...ps, kind: "come_back" });
      const who = personFrom(db, ps.target, ctx.jef ?? ctx.from);
      if (!who || who.id === r.id) return { ...none, drop: { reason: "unknown_person", line: LINES.unknown_person } };
      let take: string | undefined;
      if (!(ctx.holding.get(kind) ?? 0)) {
        // not bought on the way: from Jef's own pockets, handed over first
        if (!jefHas(db, kind)) return { ...none, drop: { reason: "no_item", line: LINES.no_item } };
        if (!carriable(kind)) return { ...none, drop: { reason: "too_big", line: LINES.too_big } };
        take = kind;
        ctx.holding.set(kind, 1);
      }
      const spot = personSpot(db, who);
      if (!spot) return { ...none, drop: { reason: "indoors", line: LINES.indoors } };
      const w = walkStep(ctx, spot);
      if (w.drop) return { ...none, drop: w.drop };
      ctx.holding.set(kind, (ctx.holding.get(kind) ?? 1) - 1);
      ctx.addressees.add(who.id);
      return { steps: [w.step, { kind: "give", who: who.id, item: kind, label: who.name, tag: tag(ctx.k, "give") }], end: { x: w.step.x!, z: w.step.z! }, metres: w.metres, recipient: who.id, ...(take ? { take } : {}) };
    }
    case "talk_to": {
      const who = personFrom(db, ps.target, ctx.jef ?? ctx.from);
      if (!who || who.id === r.id) return { ...none, drop: { reason: "unknown_person", line: LINES.unknown_person } };
      const spot = personSpot(db, who);
      if (!spot) return { ...none, drop: { reason: "indoors", line: LINES.indoors } };
      const q = walkMap().nearestOpen(spot.x, spot.z, 4);
      if (!q) return { ...none, drop: { reason: "no_way", line: LINES.no_way } };
      const metres = dist(ctx.from, q);
      if (metres > LEG_MAX_M) return { ...none, drop: { reason: "too_far", line: LINES.too_far } };
      ctx.addressees.add(who.id);
      const msg = cleanMessage(ps.message, ctx.words) ?? "Jef sent me with a word for you.";
      return { steps: [{ kind: "talk_to", who: who.id, x: q.x, z: q.z, label: who.name, why: msg.slice(0, 160), tag: tag(ctx.k, "talk") }], end: q, metres, recipient: who.id };
    }
    case "fetch_cart": {
      const carts = jefCarts(db).list.filter((c) => !c.held);
      if (!carts.length) return { ...none, drop: { reason: "no_cart", line: LINES.no_cart } };
      const p = ps.target.trim() && !HERE_RE.test(ps.target) ? findPlace(db, ps.target) : null;
      const pick = carts.sort((a, b) => dist(a, p ?? ctx.from) - dist(b, p ?? ctx.from))[0];
      if (pick.load.length) return { ...none, drop: { reason: "loaded", line: LINES.loaded } };
      const beside = besideCart(pick, ctx.from);
      const w = walkStep(ctx, { ...beside, label: "Jef's handcart" }, "cart");
      if (w.drop) return { ...none, drop: w.drop };
      return { steps: [w.step], end: { x: w.step.x!, z: w.step.z! }, metres: w.metres, cart: { id: pick.id, x: pick.x, z: pick.z, yaw: pick.yaw, taken: false } };
    }
    case "come_back": {
      const j = jefSpot({ jef: ctx.jef });
      // bringing a thing back: the report hands it over
      return { steps: [{ kind: "walk_to", x: j.x, z: j.z, label: "Jef", who: "jef", tag: tag(ctx.k, "report") }], end: { x: j.x, z: j.z }, metres: dist(ctx.from, j) };
    }
    case "wait": {
      const c = clock(db);
      let minutes: number;
      let limit: string | undefined;
      if (ps.until_hour >= 0 && ps.until_hour <= 24) {
        const now = c.hour * 60 + c.minute;
        minutes = ps.until_hour * 60 - now;
        if (minutes <= 0) return { ...none, drop: { reason: "past", line: LINES.past } };
      } else minutes = Math.max(15, (ps.minutes || 30) * STORY_MINUTE_FACTOR);
      if (minutes > WAIT_ROUTINE_MAX_MIN) {
        minutes = WAIT_ROUTINE_MAX_MIN;
        const until = (c.hour * 60 + c.minute + minutes) / 60;
        const h = Math.floor(until) % 24;
        limit = `I'll stay till ${h === 0 ? "midnight" : h === 12 ? "noon" : `${h > 12 ? h - 12 : h} o'clock`}, no longer.`;
      }
      let spot: Spot | null;
      if (HERE_RE.test(ps.target) || JEF_RE.test(ps.target)) spot = { ...(ctx.jef ?? ctx.from), label: "where Jef stood" };
      else spot = placeSpot(db, ps.target);
      if (!spot) return { ...none, drop: { reason: "unknown_place", line: LINES.unknown_place } };
      const steps: Step[] = [];
      let metres = 0;
      let end: { x: number; z: number } = ctx.from;
      if (dist(spot, ctx.from) > 3) {
        const w = walkStep(ctx, spot);
        if (w.drop) return { ...none, drop: w.drop };
        steps.push(w.step);
        metres = w.metres;
        end = { x: w.step.x!, z: w.step.z! };
      }
      steps.push({ kind: "wait", minutes, x: end.x, z: end.z, label: "keeping watch", tag: tag(ctx.k, "wait") });
      return { steps, end, metres, waitMin: minutes, ...(limit ? { limit } : {}) };
    }
    case "follow": {
      const max = FOLLOW_MAX_MIN[r.trade] ?? (r.age < 13 ? FOLLOW_MAX_MIN.child : FOLLOW_DEFAULT_MIN);
      const minutes = ps.minutes > 0 ? Math.max(FOLLOW_MIN_MIN, Math.min(max, ps.minutes * STORY_MINUTE_FACTOR)) : max;
      const h = minutes / STORY_MINUTE_FACTOR / 60;
      const limit = ps.minutes * STORY_MINUTE_FACTOR > max || ps.minutes === 0 ? `I'll walk with you ${h >= 0.9 ? "an hour" : "half an hour"}, no more.` : undefined;
      return { steps: [{ kind: "follow", who: "jef", minutes, label: "Jef", tag: tag(ctx.k, "follow") }], end: ctx.jef ?? ctx.from, metres: 0, waitMin: minutes, ...(limit ? { limit } : {}) };
    }
    case "enter": {
      // the interior system lets people into the taverns only; a house only if it is their own or the addressee's
      const who = personFrom(db, ps.target, ctx.from);
      const own = /^\s*(my|your|his|her)?\s*(own )?(home|house)\s*$/i.test(ps.target);
      if (HOME_RE.test(ps.target) || (who && !placeSpot(db, ps.target))) {
        if (own) return mapStep(ctx, { ...ps, kind: "walk_to", target: `${r.name}'s door` });
        if (who && (who.id === r.id || ctx.addressees.has(who.id) || who.household === r.household)) {
          const q = walkMap().nearestOpen(who.home.sx, who.home.sz, 4);
          if (!q) return { ...none, drop: { reason: "no_way", line: LINES.no_way } };
          const w = walkStep(ctx, { ...q, label: `${who.name}'s door` });
          if (w.drop) return { ...none, drop: w.drop };
          return { steps: [w.step], end: { x: w.step.x!, z: w.step.z! }, metres: w.metres };
        }
        return { ...none, fatal: { kind: "private_home", reason: "private_home", line: LINES.private_home } };
      }
      const place = placeSpot(db, ps.target);
      const tv = place ? tavernPlace(db, place.id) : null;
      if (!place || !tv) return { ...none, drop: { reason: "no_indoors", line: LINES.no_indoors } };
      if (!keeperAtWork(db, tv)) return { ...none, drop: { reason: "closed", line: `${place.label} is shut.` } };
      const w = walkStep(ctx, place);
      if (w.drop) return { ...none, drop: w.drop };
      return { steps: [w.step], end: { x: w.step.x!, z: w.step.z! }, metres: w.metres };
    }
  }
}

/** Where a runner stands to take the shafts of Jef's cart: two paces from it, toward them. */
function besideCart(c: { x: number; z: number }, toward: { x: number; z: number }): { x: number; z: number } {
  const dx = toward.x - c.x;
  const dz = toward.z - c.z;
  const L = Math.hypot(dx, dz) || 1;
  return walkMap().nearestOpen(c.x + (dx / L) * 2.2, c.z + (dz / L) * 2.2, 3) ?? { x: c.x, z: c.z };
}

/**
 * Game minutes a walk of this many straight-line metres takes: streets wind (about half as far
 * again), and in Jef's sight they walk (1.2 real seconds a metre; a game minute is two real
 * seconds since M7, it was a third of one); unseen they go faster, so this is the long case.
 */
export function walkMinutes(metres: number): number {
  return Math.round(gameMin(metres * 1.5 * 1.2));
}

/** A changed way gets its own time, never past the routine's cap from its start. */
function extendTime(db: DB, id: number, minutes: number): void {
  db.prepare("UPDATE npc_action SET until = MIN(started + ?, until + ?) WHERE id = ? AND status = 'active'").run(ROUTINE_MAX_MIN, Math.max(0, Math.round(minutes)), id);
}

// ------------------------------------------------------------------ the whole plan

export interface Checked {
  ok: boolean;
  /** The refusal (the whole errand). */
  refusal?: ErrandRefusal;
  line: string;
  steps: Step[];
  state?: ErrandState;
  minutes?: number;
  /** Steps left out, with the reason. */
  dropped: Drop[];
  limits: string[];
  /** The first wage part now. */
  first_c?: number;
  price_c?: number;
}

function successOf(plan: PlanStep[], asked: SuccessKind, mapped: Mapped[]): SuccessKind {
  const has = (k: string) => plan.some((p, i) => p.kind === k && mapped[i] && mapped[i].steps.length + (mapped[i].take ? 1 : 0) > 0);
  const ok: Record<SuccessKind, boolean> = {
    delivered: has("give"),
    told: has("talk_to"),
    brought: has("buy") || has("take"),
    cart_back: has("fetch_cart"),
    watched: has("wait"),
    arrived: has("walk_to") || has("enter"),
  };
  if (ok[asked]) return asked;
  return (["delivered", "told", "cart_back", "brought", "watched", "arrived"] as SuccessKind[]).find((k) => ok[k]) ?? "arrived";
}

/**
 * The engine's check of a whole plan for one person: the rules, every step, the money. Pure of side
 * effects: nothing moves until startErrand. `words`: Jef's own words in this meeting.
 */
export function checkPlan(db: DB, r: Resident, plan: RoutinePlan, words: string, amount_c: number, asked: { jef: { x: number; z: number } | null; mine: Where }): Checked {
  // face to face: where Jef stands is where they stand, when the client has not said
  const at = { mine: asked.mine, jef: asked.jef ?? { x: asked.mine.x, z: asked.mine.z } };
  const no =(refusal: ErrandRefusal, line: string, dropped: Drop[] = []): Checked => ({ ok: false, refusal, line, steps: [], dropped, limits: [] });
  // the rules first: Jef's words, the goal and every step's words
  const rule = brokenRule(db, r, `${words} ${plan.goal}`) ?? plan.steps.map((s) => brokenRule(db, r, `${s.target} ${s.item} ${s.message}`)).find(Boolean) ?? null;
  if (rule) return no(rule.kind, rule.line);
  if (plan.steps.length > ROUTINE_MAX_STEPS) return no("too_many_steps", LINES.too_many_steps);
  if (!plan.steps.length) return no("nothing_left", LINES.nothing);

  // walk the plan: each step from where the last one ended
  const ctx: MapCtx = {
    db,
    r,
    from: { x: at.mine.x, z: at.mine.z },
    k: 0,
    holding: new Map(),
    addressees: new Set(),
    jef: at.jef,
    purseLeft: null,
    swap: true,
    words,
  };
  // the addressees first (their own door is allowed to an enter step)
  for (const s of plan.steps)
    if (s.kind === "give" || s.kind === "talk_to") {
      const who = personFrom(db, s.target, at.jef ?? ctx.from);
      if (who) ctx.addressees.add(who.id);
    }
  const mapped: Mapped[] = [];
  const dropped: Drop[] = [];
  const limits: string[] = [];
  const steps: Step[] = [];
  const takes: string[] = [];
  let metres = 0;
  let cost = 0;
  let waits = 0;
  let recipient: string | null = null;
  let cart: ErrandState["cart"] = null;
  plan.steps.forEach((ps, k) => {
    ctx.k = k;
    const m = mapStep(ctx, ps);
    mapped.push(m);
    if (m.fatal) return;
    if (m.drop) {
      dropped.push(m.drop);
      return;
    }
    if (m.take) takes.push(m.take);
    if (m.limit) limits.push(m.limit);
    if (m.cart) cart = m.cart;
    if (m.recipient && !recipient) recipient = m.recipient;
    // one way back to Jef, at the end (added below)
    steps.push(...m.steps.filter((s) => tagRole(s) !== "report"));
    metres += m.metres;
    cost += m.cost ?? 0;
    waits += m.waitMin ?? 0;
    if (m.end) ctx.from = m.end;
  });
  const fatal = mapped.find((m) => m.fatal)?.fatal;
  if (fatal) return no(fatal.kind, fatal.line, dropped);
  // a plain walk straight into another walk to the same spot, or to a shut shop the engine sent them past: left out
  const past = mapped.flatMap((m) => (m.swappedFrom ? [m.swappedFrom] : []));
  for (let j = steps.length - 2; j >= 0; j--) {
    const a = steps[j];
    const b = steps[j + 1];
    if (a.kind !== "walk_to" || b.kind !== "walk_to" || tagRole(a) !== "walk" || plan.steps[Number(tagK(a))]?.kind !== "walk_to") continue;
    const sameWho = !!a.who && a.who === b.who;
    if (sameWho || dist(a as { x: number; z: number }, b as { x: number; z: number }) < 25 || past.some((q) => dist(q, a as { x: number; z: number }) < 25)) steps.splice(j, 1);
  }
  // something to do beside walking and coming back
  const doing = steps.some((s) => s.kind !== "walk_to" || tagRole(s) === "cart") || takes.length > 0 || plan.steps.some((p, i) => p.kind === "walk_to" && mapped[i].steps.length > 0);
  if (!doing) return no("nothing_left", dropped[0]?.line ?? LINES.nothing, dropped);
  // a thing to give that nobody has by then: that give was left out (and the plan may be empty)
  // the way back to Jef closes every errand (a follow ends beside him)
  const last = steps[steps.length - 1];
  const back = jefSpot({ jef: at.jef });
  if (!(last?.kind === "follow")) {
    metres += dist(ctx.from, back);
    steps.push({ kind: "walk_to", x: back.x, z: back.z, label: "Jef", who: "jef", tag: tag("e", "report") });
  }
  if (metres > ROUTE_MAX_M) return no("nothing_left", LINES.too_far, dropped);
  const success = successOf(plan.steps, plan.success, mapped);

  // the wage: a favour for a friend, else their price for the errand (hire.ts), Jef's own sum
  const trust = relationship(db, r.id)?.trust ?? 0;
  const units = Math.max(1, Math.round(metres / 150) + Math.round(waits / 120));
  const price = askFor(db, r, units);
  const offer = wageIn(words, cost > 0) ? offerFrom(words, amount_c) : 0;
  const friend = trust >= 2 || (trust >= 0 && r.stats.warmth >= 7);
  const childPay = r.age < 16 || ["street_child", "errand_boy", "beggar"].includes(r.trade);
  let wage = 0;
  let favour = false;
  if (offer) {
    if (offer > MAX_WAGE_C) return no("wage", "That much for an errand? What's the catch? No.", dropped);
    if (offer < price) return no("wage", offer < price / 2 ? `For ${offer}? I don't run about for nothing. ${price}, and I'll go.` : `Make it ${price} and I'll go.`, dropped);
    wage = offer;
  } else if (friend && !childPay && (trust >= 2 || units <= 3)) favour = true;
  else return no("wage", `For ${price} centimes I'll do it. Half now, half when it's done.`, dropped);
  const pay: PayPlan = favour ? "end" : planFrom(words);
  if (!favour && pay === "end" && trust < 2) return no("wage", "Half now, or find someone else. I don't know you.", dropped);
  const first = favour ? 0 : pay === "now" ? wage : pay === "half" ? Math.floor(wage / 2) : 0;
  if (player(db).money_c < cost + first) return no("no_money", `Show me the coin first: ${cost + first} centimes.`, dropped);

  // Jef's coins and things first (the engine's steps), then the plan
  const head: Step[] = [
    ...takes.map((kind): Step => ({ kind: "give", item: kind, who: r.id, label: "from Jef's hand", tag: tag("e", "take") })),
    ...(cost > 0 ? [{ kind: "pay" as const, who: r.id, amount_c: cost, why: "coins for an errand", tag: tag("e", "purse") }] : []),
    ...(first > 0 ? [{ kind: "pay" as const, who: r.id, amount_c: first, why: pay === "now" ? "an errand's wage" : "half an errand's wage", tag: tag("e", "wage") }] : []),
  ];
  const all = [...head, ...steps];
  const minutes = Math.max(ROUTINE_MIN_MIN, Math.min(ROUTINE_MAX_MIN, walkMinutes(metres) + waits + 20));
  const c = clock(db);
  const state: ErrandState = {
    goal: cleanGoal(plan.goal),
    success,
    plan: plan.steps.map((s) => ({ ...s, message: s.kind === "talk_to" ? (cleanMessage(s.message, words) ?? "") : "" })),
    recipient,
    purse_c: 0,
    spent_c: 0,
    wage_c: wage,
    paid_c: 0,
    pay,
    favour,
    carried: [],
    cart,
    at: null,
    checkins: 0,
    retried: {},
    weather: c.weather,
    night: c.hour >= 20 || c.hour < 6,
    outcome: {},
    said: [],
    report_line: null,
    jef: at.jef,
    steering: null,
    reply: null,
  };
  return { ok: true, line: "", steps: all, state, minutes, dropped, limits, first_c: first, price_c: cost };
}

/**
 * Jef's words offer a wage for the errand. With nothing to buy, any sum he names with its coin is
 * the wage ("All right, 35 centimes"); with something to buy, a sum may be its price, so the words
 * must say it is for them ("I'll pay you", "for your trouble").
 */
export function wageIn(words: string, buying = true): boolean {
  if (!buying && sumsIn(words).unit.length > 0) return true;
  return /\b(pay you|i'?ll pay|for your trouble|for you(r time)?|wage|i'?ll give you|and i'?ll give|earn|a tip|reward you)\b/i.test(words) && (sumsIn(words).unit.length > 0 || sumsIn(words).bare.length > 0);
}

function cleanGoal(g: string): string {
  const t = plainEnglish(String(g ?? "").replace(/[\r\n\t<>{}`\\]+/g, " ")).replace(/\s+/g, " ").trim().slice(0, 120);
  return t && gateText(t, Date.now(), 0).ok ? t : "an errand for Jef";
}

// ------------------------------------------------------------------ the person

/** The person's side, before the plan: who would not run an errand at all now. */
export function personRefusal(db: DB, r: Resident): { kind: ErrandRefusal; line: string } | null {
  const now = nowOf(db, r);
  const h = clock(db).hour;
  if (r.age < 8) return { kind: "child", line: sexed(db, LINES.child) };
  if (TOWN_EMPLOYER_IDS.includes(r.id) || r.work.kind === "guard" || ((["police", "water_bailiff", "customs", "priest", "sexton"] as string[]).includes(r.trade) && now.act === "work")) return { kind: "post", line: LINES.post };
  if (isKeeperAtWork(db, r)) return { kind: "at_stall", line: LINES.at_stall };
  if (now.act === "home" && (h >= 22 || h < 5)) return { kind: "night", line: LINES.night };
  if ((h >= 20 || h < 6) && r.stats.courage <= 3 && r.age >= 13) return { kind: "dark", line: LINES.dark };
  const trust = relationship(db, r.id)?.trust ?? 0;
  if (trust <= -2) return { kind: "no_trust", line: LINES.no_trust };
  if (r.stats.wealth >= 7 || ["merchant", "alderman", "brewer", "fish_merchant", "pawnbroker", "tourist"].includes(r.trade)) return { kind: "proud", line: LINES.proud };
  if (isReserved(db, r.id)) return { kind: "busy", line: REFUSE_LINE.reserved };
  return null;
}

// ------------------------------------------------------------------ the queue (a second errand waits its turn)

interface Waiting {
  npc: string;
  plan: RoutinePlan;
  words: string;
  amount_c: number;
  jef: { x: number; z: number } | null;
  at: number;
}
const QUEUE_KEY = "errand_queue";
export function queued(db: DB): Waiting[] {
  return getState<Waiting[]>(db, QUEUE_KEY, []);
}
function setQueue(db: DB, q: Waiting[]): void {
  setState(db, QUEUE_KEY, q);
}

/** Errands running in the town, and waiting. */
export function errandsInTown(db: DB): number {
  return activeRoutines(db, PURPOSE).length + queued(db).length;
}

// ------------------------------------------------------------------ the talk's proposal

const refuse = (line: string): Refused => ({ ok: false, reason: "routine", line, patch: { trust_delta: 0 } });

/** The talk's proposal "routine": the engine's yes or no, and the routine started. */
export function proposeRoutine(db: DB, r: Resident, p: ActionProposal, at: { jef: { x: number; z: number } | null; mine: Where }): Accepted | Refused {
  const parsed = RoutinePlanSchema.safeParse(p.plan);
  if (!parsed.success) return { ok: true, action: null, line: "", instant: false };
  const plan = parsed.data;
  const words = jefSaid(r.id);
  // the model may not invent an errand: Jef's words must ask for something
  if (!/\b(go|fetch|bring|take|tell|buy|get|carry|run|watch|keep|wait|ask|give|deliver|find|walk|come|send|pass|let|say|push|stand|mind|steal|burn|rob|follow|help)\b/i.test(words)) return { ok: true, action: null, line: "", instant: false };
  const rule = brokenRule(db, r, `${words} ${plan.goal} ${plan.steps.map((s) => `${s.target} ${s.item} ${s.message}`).join(" ")}`);
  if (rule) return logRefusal(db, r, rule.kind, rule.line, words);
  if (plan.steps.length > ROUTINE_MAX_STEPS) return logRefusal(db, r, "too_many_steps", LINES.too_many_steps, words);
  const who = personRefusal(db, r);
  if (who) return logRefusal(db, r, who.kind, who.line, words);
  // one thing at a time: a second errand waits its turn (two per person), nothing else is interrupted
  const busy = actionOf(db, r.id);
  const mineRunning = routineFor(db, r.id, PURPOSE);
  const waiting = queued(db).filter((q) => q.npc === r.id).length;
  if (busy && !mineRunning) return logRefusal(db, r, "busy", LINES.busy, words);
  if (errandsInTown(db) >= ROUTINES_IN_TOWN) return logRefusal(db, r, "town_full", LINES.town_full, words);
  if (mineRunning) {
    if (1 + waiting >= ROUTINES_PER_RESIDENT) return logRefusal(db, r, "queue_full", LINES.queue_full, words);
    // checked now (the rules, the person); the steps again when it starts
    const c = checkPlan(db, r, plan, words, p.amount_c, at);
    if (!c.ok) return logRefusal(db, r, c.refusal ?? "nothing_left", c.line, words);
    setQueue(db, [...queued(db), { npc: r.id, plan, words: words.slice(0, 300), amount_c: p.amount_c, jef: at.jef, at: gameMinute(db) }]);
    writeEvent(db, { kind: "action", verb: "errand_queued", actor: r.id, text: `${r.name} said they would see to another errand for Jef afterwards: ${cleanGoal(plan.goal)}.`, weight: 2, who: [r.id] });
    return { ok: true, action: null, instant: true, keep: true, line: "After this one, then. I'll see to it next.", patch: { end_conversation: true }, extra: { note: `${r.first} will run it after the errand now in hand.` } };
  }
  const c = checkPlan(db, r, plan, words, p.amount_c, at);
  if (!c.ok) return logRefusal(db, r, c.refusal ?? "nothing_left", c.line, words);
  startErrand(db, r, c);
  const first = c.first_c ?? 0;
  const s = c.state!;
  const money = [c.price_c ? `Give me the coins for it: ${c.price_c} centimes.` : "", first ? `${first} now for my trouble, the rest when it's done.` : s.favour ? "No need to pay me." : s.wage_c ? "Pay me when it's done." : ""].filter(Boolean).join(" ");
  const line = [money, ...c.limits].filter(Boolean).join(" ") || "I'll be back.";
  // M7 quest tests: the note is to the player ("your errand: bring it to you", not "to Jef"), and a step
  // left out is said as the runner said it ("(Left out: I don't know where that is.)" read as the game's own voice)
  const left = c.dropped.length ? ` ${r.first} left a step out: "${[...new Set(c.dropped.map((d) => d.line))].join(" ")}"` : "";
  const goal = s.goal.replace(/\bJef's\b/g, "your").replace(/\bJef\b/g, "you");
  return { ok: true, action: null, instant: true, keep: true, line, patch: { end_conversation: true }, extra: { note: `${r.first} is off on your errand: ${goal}.${left}` } };
}

function logRefusal(db: DB, r: Resident, kind: ErrandRefusal, line: string, words: string): Refused {
  writeEvent(db, { kind: "action", verb: "errand_refused", actor: r.id, text: `${r.name} would not run an errand for Jef (${kind.replace(/_/g, " ")}).`, outcome: kind, weight: kind === "steal" || kind === "harm" ? 4 : 2, who: [r.id] });
  if (kind === "steal" || kind === "harm") remember(db, r.id, "Jef wanted me to do something wicked for him. I told him where to go.", 6, "seen", null, { gist: "Jef asked someone to do something wicked for him", tone: -2 });
  void words;
  return refuse(line);
}

/** Start a checked errand: the routine row, the event, a memory. Jef's coins move in its first steps. */
export function startErrand(db: DB, r: Resident, c: Checked): ActionRow {
  const s = c.state!;
  const first = c.steps.find((x) => x.kind === "walk_to" || x.kind === "talk_to" || x.kind === "wait" || x.kind === "follow");
  const row = startRoutine(db, { npc: r.id, purpose: PURPOSE, steps: c.steps, minutes: c.minutes!, reason: s.goal, state: s, target: s.recipient ?? PURPOSE, target_x: first?.x ?? null, target_z: first?.z ?? null });
  const to = s.recipient ? resident(db, s.recipient) : null;
  writeEvent(db, {
    kind: "action",
    verb: "errand_planned",
    actor: r.id,
    target: s.recipient,
    text: `${r.name} set off on an errand for Jef: ${s.goal}${to ? ` (for ${to.name})` : ""}.`,
    ref_type: "npc_action",
    ref_id: row.id,
    weight: 3,
    data: { plan: c.steps.map((x) => `${x.kind}${x.label ? ` ${x.label}` : ""}${x.item ? ` ${x.item}` : ""}`), dropped: c.dropped.map((d) => d.reason), success: s.success, wage_c: s.wage_c, price_c: c.price_c ?? 0 },
    who: [r.id, ...(to ? [to.id] : [])],
  });
  remember(db, r.id, `Jef asked me to run an errand for him: ${s.goal}.`, 3);
  return row;
}

/** The queue's next errand for a person who is free now (checked again: the steps, the money). */
export function startQueued(db: DB): number {
  const q = queued(db);
  if (!q.length) return 0;
  let n = 0;
  const keep: Waiting[] = [];
  for (const w of q) {
    const r = resident(db, w.npc);
    if (!r) continue;
    if (actionOf(db, r.id) || n) {
      keep.push(w);
      continue;
    }
    const at: { jef: { x: number; z: number } | null; mine: Where } = { jef: w.jef, mine: posOf(db, r.id) ?? whereIs(db, r) };
    const who = personRefusal(db, r);
    const c = who ? null : checkPlan(db, r, w.plan, w.words, w.amount_c, at);
    if (!c || !c.ok) {
      const line = who?.line ?? c?.line ?? LINES.nothing;
      bus.broadcast({ type: "hands", npc: r.id, name: r.name, line: "", say: `${r.first} could not run your second errand: "${line}"` });
      writeEvent(db, { kind: "action", verb: "errand_refused", actor: r.id, text: `${r.name} could not run the errand Jef had asked for next.`, weight: 2, who: [r.id] });
      continue;
    }
    startErrand(db, r, c);
    n++;
  }
  setQueue(db, keep);
  return n;
}

// ------------------------------------------------------------------ the steps: the purpose's own checks and engine steps

function sayConvo(_db: DB, a: Resident, b: Resident | null, lines: Array<[Resident, string]>): void {
  publishConvo({
    a: a.id,
    b: (b ?? a).id,
    a_name: a.name,
    b_name: (b ?? a).name,
    purpose: "chat",
    lines: lines.map(([w, text]) => ({ who: w.id, name: w.first, text })),
    source: "engine",
    outcome: "none",
    event_id: null,
  });
}

/** The check before a step (the executor's own for the rest). */
function checkErrandStep(db: DB, r: Routine, s: Step, id: number): string | null | undefined {
  const e = st(r);
  const role = tagRole(s);
  switch (s.kind) {
    case "buy": {
      if (!s.who || !s.item) return "no_seller";
      const ware = waresOf(db, s.who).find((w) => w.kind === s.item);
      if (!ware) return "not_sold";
      if (!atWork(db, s.who)) return "closed";
      const seller = sellersOf(db, s.item).find((x) => x.id === s.who);
      if (e.at && seller && dist(e.at, seller) > 18) return "not_there";
      return ware.price_c * Math.max(1, s.count ?? 1) <= e.purse_c - e.spent_c ? null : "no_money";
    }
    case "give":
      if (role === "take") return s.item && jefHas(db, s.item) ? null : "no_item";
      return s.item && e.carried.some((c) => c.kind === s.item) ? null : "no_item";
    case "pay":
      return player(db).money_c >= Math.max(0, s.amount_c ?? 0) ? null : "no_money";
    case "walk_to":
    case "talk_to": {
      // a person they walk up to: where they are now (their own door if at home), or not about
      if (s.who && s.who !== "jef") {
        const who = resident(db, s.who);
        if (!who) return "unknown_person";
        const spot = personSpot(db, who);
        if (!spot) return "not_about";
        s.x = spot.x;
        s.z = spot.z;
      }
      if (s.who === "jef") {
        const j = jefSpot(e);
        s.x = j.x;
        s.z = j.z;
      }
      if (s.who) saveRoutine(db, id, r);
      return undefined;
    }
    default:
      return undefined;
  }
}

/** The engine steps of an errand: Jef's coins and things to them, buying with his coins, handing over. */
function runErrandStep(db: DB, row: ActionRow, r: Routine, s: Step): { ok: boolean; why: string } | undefined {
  const e = st(r);
  const runner = resident(db, row.npc_id);
  const role = tagRole(s);
  if (!runner) return { ok: false, why: "nobody" };
  switch (s.kind) {
    case "pay": {
      const n = stepPay(db, runner.id, s.amount_c ?? 0, s.why ?? "an errand");
      if (role === "purse") e.purse_c += n;
      else e.paid_c += n;
      return { ok: true, why: role === "purse" ? `took ${n} centimes of Jef's for buying` : `took ${n} centimes of wage` };
    }
    case "give": {
      if (role === "take") {
        // from Jef's pockets into their hand: gone from his list, carried for him
        const it = db.prepare("SELECT id FROM item WHERE kind = ? AND job_id IS NULL ORDER BY id LIMIT 1").get(s.item!) as { id: number } | undefined;
        if (!it) return { ok: false, why: "no_item" };
        db.transaction(() => {
          db.prepare("DELETE FROM item WHERE id = ?").run(it.id);
          log(db, "errand_handed", runner.id, `Jef handed ${runner.name} ${nameOf(s.item!)} to take on an errand.`);
        })();
        e.carried.push({ kind: s.item!, jef: true });
        return { ok: true, why: `took ${nameOf(s.item!)} from Jef` };
      }
      const to = resident(db, s.who ?? "");
      const idx = e.carried.findIndex((c) => c.kind === s.item);
      if (!to || idx < 0) return { ok: false, why: "no_item" };
      e.carried.splice(idx, 1);
      if (to.id === e.recipient) e.outcome.delivered = true;
      remember(db, to.id, `${runner.name} brought me ${nameOf(s.item!)} from Jef.`, 4, "seen", null, { gist: `Jef sent ${to.name} ${nameOf(s.item!)}`, tone: 1 });
      writeEvent(db, { kind: "action", verb: "errand_delivered", actor: runner.id, target: to.id, text: `${runner.name} brought ${to.name} ${nameOf(s.item!)} from Jef.`, weight: 3, who: [runner.id, to.id] });
      const thanks = to.stats.warmth >= 6 ? "For me? Tell him thank you, and God bless him." : to.stats.temper >= 7 ? "From Jef? Hm. Put it there, then." : "From Jef? Well. That's kind.";
      sayConvo(db, runner, to, [
        [runner, `Jef sent this for you: ${nameOf(s.item!)}.`],
        [to, thanks],
      ]);
      e.reply = thanks;
      return { ok: true, why: `gave ${to.first} ${nameOf(s.item!)}` };
    }
    case "buy": {
      const seller = resident(db, s.who ?? "");
      const ware = waresOf(db, s.who ?? "").find((w) => w.kind === s.item);
      if (!seller || !ware) return { ok: false, why: "not_sold" };
      const n = Math.max(1, Math.min(BUY_MAX, s.count ?? 1));
      const cost = ware.price_c * n;
      if (cost > e.purse_c - e.spent_c) return { ok: false, why: "no_money" };
      // Jef's coins, in their hand, to the seller: on the record; the engine's price
      e.spent_c += cost;
      for (let i = 0; i < n; i++) e.carried.push({ kind: s.item!, jef: false });
      log(db, "errand_bought", seller.id, `${runner.name} bought ${n > 1 ? `${n} of ` : ""}${nameOf(s.item!)} from ${seller.name} with Jef's coins, ${cost} centimes.`);
      remember(db, seller.id, `${runner.name} bought ${nameOf(s.item!)} from me for Jef.`, 2);
      sayConvo(db, runner, seller, [
        [runner, n > 1 ? `${n} of those, please. It's for a friend.` : `${nameOf(s.item!)[0].toUpperCase()}${nameOf(s.item!).slice(1)}, please. It's for a friend.`],
        [seller, `That's ${cost} centimes.`],
      ]);
      return { ok: true, why: `bought ${nameOf(s.item!)} for ${cost} centimes` };
    }
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ after each step: the check-in

type Trigger = { kind: "failed"; step: Step; why: string } | { kind: "rain" } | { kind: "night" };

const pending = new Map<number, Promise<void>>();
let testRunner: Runner | undefined;
/** Tests: the model for the check-ins (a stub). */
export function setCheckinRunner(r: Runner | undefined): void {
  testRunner = r;
}
/** Tests: wait for the check-ins still out. */
export async function settleCheckins(): Promise<void> {
  while (pending.size) await Promise.all([...pending.values()]);
}

/** A check-in call is allowed: the routine's five, the day's share, never the reserve. */
export function canCheckIn(db: DB, e: ErrandState): boolean {
  if (e.checkins >= CHECKINS_PER_ROUTINE) return false;
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook = ?").get(day, CHECKIN_HOOK) as { n: number }).n;
  return mine < ROUTINE_CALLS_PER_DAY && total < CALLS_PER_DAY - CALLS_RESERVE;
}

function note(e: ErrandState, text: string): void {
  e.said.push(text.slice(0, 120));
  if (e.said.length > 10) e.said.splice(0, e.said.length - 10);
}

function describeStep(db: DB, s: Step): string {
  const who = s.who && s.who !== "jef" ? resident(db, s.who) : null;
  switch (s.kind) {
    case "walk_to":
      return s.who === "jef" ? "go back to Jef" : `walk to ${s.label ?? who?.name ?? "a place"}`;
    case "buy":
      return `buy ${s.count && s.count > 1 ? `${s.count} of ` : ""}${nameOf(s.item ?? "")} at ${s.label ?? who?.name ?? "the counter"}`;
    case "give":
      return tagRole(s) === "take" ? `take ${nameOf(s.item ?? "")} from Jef` : `give ${nameOf(s.item ?? "")} to ${who?.name ?? s.label ?? "them"}`;
    case "talk_to":
      return `tell ${who?.name ?? s.label ?? "them"}: "${s.why ?? ""}"`;
    case "wait":
      return tagRole(s) === "checkin" ? "stop and think" : `keep watch (${s.minutes ?? 0} game minutes)`;
    case "follow":
      return "walk with Jef";
    case "pay":
      return "take Jef's coins";
    default:
      return s.kind;
  }
}

const WHY_TEXT: Record<string, string> = {
  closed: "it is shut",
  not_sold: "they do not sell it",
  no_money: "Jef's coins in hand are not enough",
  no_item: "they have not got the thing to give",
  not_about: "the person is not about (indoors, not at home)",
  unknown_person: "nobody by that name",
  no_way: "no way through on foot",
  blocked: "the way was blocked",
  lost: "lost sight of Jef",
  not_there: "they are not at the seller's",
  empty_hands: "nothing in their hands",
};

/** The world round the errand, in the engine's words (for the check-in). */
function worldFor(db: DB, row: ActionRow, r: Routine, trig: Trigger): string {
  const e = st(r);
  const c = clock(db);
  const runner = resident(db, row.npc_id)!;
  const here = e.at ?? posOf(db, runner.id) ?? whereIs(db, runner);
  const lines: string[] = [];
  lines.push(`${c.weekday}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}${c.hour >= 20 || c.hour < 6 ? ", night" : ""}.`);
  lines.push(`You carry: ${e.carried.length ? e.carried.map((x) => nameOf(x.kind)).join(", ") : "nothing"}${e.cart?.taken ? "; you are pushing Jef's handcart" : ""}.`);
  const left = e.purse_c - e.spent_c;
  if (e.purse_c) lines.push(`Jef's coins in your hand: ${left > 0 ? "enough for what was planned" : "none left"}.`);
  const j = jefAt();
  if (j) lines.push(`Jef is about ${Math.round(dist(j, here))} m from you.`);
  // what could be done instead: open sellers of what was to be bought, where the person is
  const wanted = new Set<string>();
  for (const s of r.steps.slice(r.i)) if (s.kind === "buy" && s.item) wanted.add(s.item);
  if (trig.kind === "failed" && trig.step.kind === "buy" && trig.step.item) wanted.add(trig.step.item);
  for (const kind of wanted) {
    const open = sellersOf(db, kind)
      .filter((s) => s.open && dist(s, here) <= LEG_MAX_M)
      .sort((a, b) => dist(a, here) - dist(b, here))
      .slice(0, 4);
    lines.push(
      open.length
        ? `Open now and selling ${nameOf(kind)}: ${open.map((s) => `${s.label} (${Math.round(dist(s, here))} m${s.price_c * 1 <= left ? "" : ", too dear for the coins in hand"})`).join("; ")}.`
        : `Nobody within reach sells ${nameOf(kind)} now.`,
    );
  }
  const people = new Set<string>([...(e.recipient ? [e.recipient] : []), ...r.steps.slice(r.i).flatMap((s) => (s.who && s.who !== "jef" && s.kind !== "buy" ? [s.who] : []))]);
  if (trig.kind === "failed" && trig.step.who && trig.step.who !== "jef" && trig.step.kind !== "buy") people.add(trig.step.who);
  for (const id of people) {
    const p = resident(db, id);
    if (!p) continue;
    const now = nowOf(db, p);
    const spot = personSpot(db, p);
    const house = town(db).town.residents.filter((x) => x.household === p.household && x.id !== p.id && x.age >= 14 && personSpot(db, x)).map((x) => x.name);
    lines.push(`${p.name}: ${spot ? (spot.home ? "at home (you may knock at the door)" : "out and about") : `not about (${now.act === "work" ? "at work indoors" : now.act})`}, ${Math.round(spot ? dist(spot, here) : 0)} m.${house.length ? ` Of their household, about now: ${house.slice(0, 3).join(", ")}.` : ""}`);
  }
  return lines.join("\n");
}

const CHECKIN_RULES = `
YOU NOW STEER ONE ERRAND IN THE TOWN, 1873. A person of the town is running an errand for Jef, a young man new in town.
Something has happened on the way. Decide what they do next, as that person would, by their stats:
- continue: go on with the plan as it stands.
- change_next: do this step next instead (fill step: kind, target, item, count, message, until_hour, minutes). Use only
  places and people named in THE PLAN or WHAT THE GAME KNOWS. Kinds: walk_to, buy, give, talk_to, come_back, wait.
- skip: leave out the next step of the plan.
- come_back: go back to Jef now and tell him how it went.
- give_up: stop here and go about your own day.
Fill every field of step; put "" / 0 / -1 where it is not used. line: what the person mutters or says now, in their own
voice, one short sentence, no numbers and no sums (the game adds them). why: a few words.
Never plan stealing, harm, fire, breaking in, going into another person's house, or taking money. The game checks the
step and may overrule you.
- ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

function checkinPrompt(db: DB, row: ActionRow, r: Routine, trig: Trigger): string {
  const e = st(r);
  const runner = resident(db, row.npc_id)!;
  const s = runner.stats;
  const rel = relationship(db, runner.id);
  const rest = r.steps.slice(r.i).filter((x) => tagRole(x) !== "checkin");
  const what =
    trig.kind === "failed"
      ? `The step "${describeStep(db, trig.step)}" failed: ${WHY_TEXT[trig.why] ?? trig.why.replace(/_/g, " ")}.`
      : trig.kind === "rain"
        ? "The rain has come on."
        : "Night has fallen.";
  const SUCCESS_TEXT: Record<SuccessKind, string> = {
    delivered: "the thing handed to the one it is for",
    told: "the message given",
    brought: "the thing brought back to Jef",
    cart_back: "Jef's handcart brought to him",
    watched: "the watch kept",
    arrived: "getting there",
  };
  return `PERSON
${runner.name}, ${runner.age}, ${runner.sex === "f" ? "woman" : "man"}, ${TRADES[runner.trade]?.label ?? runner.trade}. Stats 0-10: warmth ${s.warmth}, temper ${s.temper}, honesty ${s.honesty}, courage ${s.courage}, greed ${s.greed}. Trust in Jef ${trustText(rel?.trust ?? 0)}.

THE ERRAND FOR JEF
${e.goal}. Done means: ${SUCCESS_TEXT[e.success]}.

THE PLAN, WHAT IS LEFT (in order)
${rest.length ? rest.map((x, n) => `${n + 1}. ${describeStep(db, x)}`).join("\n") : "- nothing; only going back to Jef"}

SO FAR
${e.said.length ? e.said.map((x) => `- ${x}`).join("\n") : "- just set off"}

WHAT JUST HAPPENED
${what}

WHAT THE GAME KNOWS NOW
${worldFor(db, row, r, trig)}

Check-ins left after this one: ${Math.max(0, CHECKINS_PER_ROUTINE - e.checkins - 1)}.`;
}

/** After each step of an errand: note it, apply it, and check in when something is off. */
function afterErrandStep(db: DB, row: ActionRow, r: Routine, res: StepResult): void | "end" {
  const e = st(r);
  const s = r.steps[res.i];
  const role = tagRole(s);
  if (role === "checkin" || role === "retrywait") {
    saveRoutine(db, row.id, r);
    return;
  }
  const runner = resident(db, row.npc_id);
  note(e, `${describeStep(db, s)}: ${res.ok ? "done" : `failed (${WHY_TEXT[res.why] ?? res.why.replace(/_/g, " ")})`}`);
  if (res.ok) {
    if (s.kind === "walk_to" && typeof s.x === "number" && typeof s.z === "number") {
      e.at = { x: s.x, z: s.z };
      if (role === "walk" && ["walk_to", "enter"].includes(e.plan[Number(tagK(s))]?.kind ?? "")) e.outcome.arrived = true;
    }
    if (s.kind === "walk_to" && role === "cart" && e.cart && !e.cart.taken) {
      const c = lendCart(db, e.cart.id);
      if (c) Object.assign(e.cart, { taken: true, data: c });
      else {
        e.cart = null;
        note(e, "Jef's handcart was not there");
        saveRoutine(db, row.id, r);
        return steer(db, row, r, { kind: "failed", step: s, why: "no_cart" });
      }
    }
    if (s.kind === "talk_to" && runner) tellMessage(db, runner, e, s);
    if (s.kind === "wait" && role === "wait") e.outcome.watched = true;
    if (s.kind === "walk_to" && role === "report") arriveAtJef(db, row, e);
  }
  // the next step: a person walks up to where they are now
  retarget(db, r);
  const c = clock(db);
  const night = c.hour >= 20 || c.hour < 6;
  let trig: Trigger | null = null;
  if (!res.ok) trig = { kind: "failed", step: s, why: res.why };
  else if ((c.weather === "rain" || c.weather === "storm") && e.weather !== "rain" && e.weather !== "storm" && r.i < r.steps.length - 1) trig = { kind: "rain" };
  else if (night && !e.night && r.i < r.steps.length - 1) trig = { kind: "night" };
  e.weather = c.weather;
  e.night = night;
  saveRoutine(db, row.id, r);
  if (!trig) return;
  return steer(db, row, r, trig);
}

/** The message said, in bubbles; the addressee remembers it; the town can hear of it. */
function tellMessage(db: DB, runner: Resident, e: ErrandState, s: Step): void {
  const to = resident(db, s.who ?? "");
  if (!to) return;
  const msg = s.why || "Jef sent me with a word for you.";
  const reply = to.stats.temper >= 7 ? "And he couldn't come and say it himself?" : to.stats.warmth >= 6 ? "Is that so? Thank him for telling me." : "Right. I'll mind that.";
  sayConvo(db, runner, to, [
    [runner, `A word from Jef: ${msg}`],
    [to, reply],
  ]);
  e.reply = reply;
  if (to.id === e.recipient || e.success === "told") e.outcome.told = true;
  remember(db, to.id, `${runner.name} brought me word from Jef: ${msg}`, 4, "seen", null, { gist: `Jef sent word to ${to.name}`, tone: 0 });
  writeEvent(db, { kind: "talk", verb: "errand_message", actor: runner.id, target: to.id, text: `${runner.name} brought ${to.name} a message from Jef.`, weight: 3, data: { message: msg }, who: [runner.id, to.id] });
}

/** Back with Jef: what they carry for him goes into his pockets; his cart stands beside him. */
function arriveAtJef(db: DB, row: ActionRow, e: ErrandState): void {
  const runner = resident(db, row.npc_id);
  const handed = handBack(db, e);
  if (handed.length && e.success === "brought") e.outcome.brought = true;
  if (handed.length) e.back = [...(e.back ?? []), ...handed];
  if (e.cart?.taken && e.cart.data) {
    // where the runner stopped with it (the client says), else beside Jef
    const near = jefAt();
    const j = e.cart_at ?? (near ? { x: near.x + 2, z: near.z + 1 } : null) ?? e.at ?? { x: e.cart.x, z: e.cart.z };
    returnCart(db, e.cart.data, j.x, j.z, e.cart.yaw);
    e.cart = null;
    e.outcome.cart_back = true;
    note(e, "brought Jef's handcart back to him");
    if (runner) log(db, "errand_cart", runner.id, `${runner.name} brought Jef's handcart back to him.`);
  }
}

/** The things they carry for Jef, into his pockets (as many as fit). */
function handBack(db: DB, e: ErrandState): string[] {
  const free = POCKET_SLOTS - (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n;
  const out: string[] = [];
  const keep: Carried[] = [];
  for (const c of e.carried) {
    if (out.length < free) {
      db.prepare("INSERT INTO item (kind, job_id, ref) VALUES (?, NULL, NULL)").run(c.kind);
      out.push(c.kind);
    } else keep.push(c);
  }
  if (out.length) log(db, "errand_brought", null, `Jef got ${out.map(nameOf).join(", ")} back from an errand.`);
  e.carried = keep;
  return out;
}

/** A walk up to a person, or back to Jef: to where they are now. */
function retarget(db: DB, r: Routine): void {
  const s = r.steps[r.i];
  if (!s || (s.kind !== "walk_to" && s.kind !== "talk_to") || !s.who) return;
  if (s.who === "jef") {
    const j = jefSpot(st(r));
    s.x = j.x;
    s.z = j.z;
    return;
  }
  const who = resident(db, s.who);
  const spot = who ? personSpot(db, who) : null;
  if (spot) {
    s.x = spot.x;
    s.z = spot.z;
  }
}

/**
 * Something is off: a check-in with the model (a wait step "stop and think" while it runs), or,
 * with no call left, the engine's own steering at once.
 */
function steer(db: DB, row: ActionRow, r: Routine, trig: Trigger): void | "end" {
  const e = st(r);
  // a failed way back to Jef: they cannot reach him; the errand ends where they stand
  if (trig.kind === "failed" && tagRole(trig.step) === "report") {
    saveRoutine(db, row.id, r);
    endRoutine(db, row.id, e.outcome[e.success] ? "done" : "failed", "no way back");
    return "end";
  }
  if (!canCheckIn(db, e)) {
    engineSteer(db, r, r.i, trig, row.id);
    writeEvent(db, { kind: "action", verb: "errand_steered", actor: row.npc_id, text: `${resident(db, row.npc_id)?.name ?? "Someone"} kept on with Jef's errand by their own lights (${trig.kind}).`, outcome: "engine", weight: 2, who: [row.npc_id] });
    saveRoutine(db, row.id, r);
    return;
  }
  e.checkins++;
  e.steering = gameMinute(db);
  r.steps.splice(r.i, 0, { kind: "wait", minutes: 0, x: e.at?.x, z: e.at?.z, label: "stops to think", tag: tag("e", "checkin") });
  saveRoutine(db, row.id, r);
  const id = row.id;
  const prompt = checkinPrompt(db, row, { ...r, i: r.i + 1 }, trig);
  const p = (async () => {
    let out: Checkin | null = null;
    try {
      const res = await callClaude(db, { hook: CHECKIN_HOOK, system: SYSTEM + "\n" + CHECKIN_RULES, prompt, schema: CheckinSchema }, testRunner);
      if (res.ok && res.data) out = res.data;
    } catch {
      out = null;
    }
    finishCheckin(db, id, trig, out);
  })().finally(() => pending.delete(id));
  pending.set(id, p);
}

/** The model's answer (or none): checked, applied from the step after the pause, and on it goes. */
export function finishCheckin(db: DB, id: number, trig: Trigger, out: Checkin | null): void {
  const row = actionRow(db, id);
  const r = routineOf(row);
  if (!row || !r || row.status !== "active") return;
  const i = r.i;
  if (tagRole(r.steps[i]) !== "checkin") return;
  const runner = resident(db, row.npc_id);
  let source = "engine";
  let decision = "engine";
  reportStep(db, id, i, true, "checked in", (rt) => {
    const e = st(rt);
    e.steering = null;
    const applied = out ? applyDecision(db, row, rt, i + 1, out, trig) : null;
    if (applied) {
      source = "model";
      decision = out!.decision;
      const said = cleanLine(out!.line, 140);
      if (said && runner) {
        sayConvo(db, runner, null, [[runner, said]]);
        if (out!.decision === "come_back" || out!.decision === "give_up") e.report_line = said;
      }
    } else {
      engineSteer(db, rt, i + 1, trig, id);
      decision = out ? `engine (the model's ${out.decision} was refused)` : "engine (no answer)";
    }
    note(e, `stopped to think: ${decision}`);
  });
  writeEvent(db, {
    kind: "action",
    verb: "errand_steered",
    actor: row.npc_id,
    text: `${runner?.name ?? "Someone"} stopped to think on Jef's errand (${trig.kind === "failed" ? trig.why.replace(/_/g, " ") : trig.kind}): ${decision}.`,
    outcome: source,
    weight: 2,
    data: { decision, why: out?.why ?? "", step: out?.decision === "change_next" ? out.step : null },
    who: [row.npc_id],
  });
}

/** Steps of plan step `k` from index `from` on. */
function groupOf(r: Routine, from: number, k: string): number[] {
  const out: number[] = [];
  for (let j = from; j < r.steps.length; j++) if (tagK(r.steps[j]) === k && tagRole(r.steps[j]) !== "report") out.push(j);
  return out;
}

function removeAt(r: Routine, idx: number[]): void {
  for (const j of [...idx].sort((a, b) => b - a)) r.steps.splice(j, 1);
}

/** Everything from `from` on is dropped but the way back to Jef. */
function onlyReport(db: DB, r: Routine, from: number): void {
  const e = st(r);
  const rep = r.steps.slice(from).find((s) => tagRole(s) === "report");
  r.steps.splice(from);
  const j = jefSpot(e);
  r.steps.push(rep ?? { kind: "walk_to", x: j.x, z: j.z, label: "Jef", who: "jef", tag: tag("e", "report") });
  void db;
}

/**
 * The model's decision, checked like the plan. Returns false when the engine will not take it (the
 * engine steers instead). Works on `r` from index `from` (the step after the pause).
 */
export function applyDecision(db: DB, row: ActionRow, r: Routine, from: number, d: Checkin, trig: Trigger): boolean {
  const e = st(r);
  const runner = resident(db, row.npc_id);
  if (!runner) return false;
  const rest = r.steps.slice(from);
  const nextPlan = rest.find((s) => tagK(s) !== "e");
  switch (d.decision) {
    case "continue":
      // a failed step the rest depends on: carrying on would only fail again; the engine judges that
      return true;
    case "skip": {
      if (!nextPlan) return false;
      removeAt(r, groupOf(r, from, tagK(nextPlan)));
      return true;
    }
    case "come_back":
      onlyReport(db, r, from);
      return true;
    case "give_up": {
      // Jef's things and coins go back to him first: that is coming back, not giving up
      if (e.carried.some((c) => c.jef) || e.cart?.taken || e.purse_c - e.spent_c > 0) {
        onlyReport(db, r, from);
        return true;
      }
      r.steps.splice(from);
      e.report_line = cleanLine(d.line, 140) ?? "I've given it up.";
      return true;
    }
    case "change_next": {
      const ps = d.step;
      if (!["walk_to", "buy", "give", "talk_to", "come_back", "wait"].includes(ps.kind)) return false;
      if (brokenRule(db, runner, `${ps.target} ${ps.item} ${ps.message} ${d.line}`)) return false;
      if (e.plan.length >= ROUTINE_MAX_STEPS + CHECKINS_PER_ROUTINE) return false;
      const holding = new Map<string, number>();
      for (const c of e.carried) holding.set(c.kind, (holding.get(c.kind) ?? 0) + 1);
      const k = e.plan.length;
      const ctx: MapCtx = {
        db,
        r: runner,
        from: e.at ?? posOf(db, runner.id) ?? whereIs(db, runner),
        k,
        holding,
        addressees: new Set(e.recipient ? [e.recipient] : []),
        jef: jefAt() ?? e.jef,
        purseLeft: e.purse_c - e.spent_c,
        swap: false,
        words: "",
      };
      const m = mapStep(ctx, ps);
      // the model may not add a thing from Jef's pockets (he is not there to hand it over)
      if (m.fatal || m.drop || !m.steps.length || m.take) return false;
      if (tagRole(m.steps[m.steps.length - 1]) === "report") {
        onlyReport(db, r, from);
        return true;
      }
      e.plan.push({ ...ps, message: ps.kind === "talk_to" ? (m.steps[0].why ?? "") : "" });
      // a new buy or give of the same thing takes the place of the old one still to come
      const sameKind = (s: Step) => (s.kind === "buy" || s.kind === "give") && m.steps.some((n) => n.kind === s.kind && n.item === s.item && (s.kind === "buy" || n.who === s.who));
      const superseded = new Set<string>();
      for (let j = from; j < r.steps.length; j++) if (sameKind(r.steps[j]) && tagK(r.steps[j]) !== "e") superseded.add(tagK(r.steps[j]));
      for (const kk of superseded) removeAt(r, groupOf(r, from, kk));
      r.steps.splice(from, 0, ...m.steps);
      extendTime(db, row.id, walkMinutes(m.metres) + 10);
      void trig;
      return true;
    }
  }
  return false;
}

/** The engine's own steering: retry a failed step once (after a wait if it was shut), then come back and report. */
export function engineSteer(db: DB, r: Routine, from: number, trig: Trigger, id?: number): void {
  const e = st(r);
  if (trig.kind !== "failed") return; // the rain, the night: carry on
  const k = tagK(trig.step) + ":" + tagRole(trig.step);
  const n = e.retried[k] ?? 0;
  if (n < 1 && tagRole(trig.step) !== "take" && !["no_cart", "no_money", "no_item", "not_there", "unknown_person"].includes(trig.why)) {
    e.retried[k] = n + 1;
    const again: Step[] = [];
    if (trig.why === "closed" || trig.why === "not_about") again.push({ kind: "wait", minutes: RETRY_WAIT_MIN, x: e.at?.x, z: e.at?.z, label: "waiting a while", tag: tag("e", "retrywait") });
    again.push({ ...trig.step });
    r.steps.splice(from, 0, ...again);
    if (id !== undefined) extendTime(db, id, again.length > 1 ? RETRY_WAIT_MIN + 10 : 10);
    return;
  }
  onlyReport(db, r, from);
}

// ------------------------------------------------------------------ the end: the report, the money, the record

function reportLine(db: DB, _row: ActionRow, e: ErrandState, done: boolean, outcome: string): string {
  const to = e.recipient ? resident(db, e.recipient) : null;
  const she = to ? (to.sex === "f" ? "She" : "He") : "They";
  if (e.report_line) return e.report_line;
  if (!done) {
    const last = [...e.said].reverse().find((x) => x.includes("failed") && !x.startsWith("go back to Jef"));
    if (outcome === "time") return "That took too long. I've given it up.";
    if (outcome === "stopped") return "All right. As you like.";
    return last ? `No luck: I couldn't ${last.replace(/: failed.*$/, "")}.` : "No luck, I'm afraid.";
  }
  switch (e.success) {
    case "delivered":
      return `It's done. ${to ? `${to.first} has it.` : "They have it."}${e.reply ? ` ${she} said: '${e.reply}'` : ""}`;
    case "told":
      return `I told ${to?.first ?? "them"}.${e.reply ? ` ${she} said: '${e.reply}'` : ""}`;
    case "brought":
      return "Here you are, as you asked.";
    case "cart_back":
      return "Here's your cart, safe and sound.";
    case "watched":
      return "Nobody came by that I saw. That's my watch done.";
    default:
      return "I got there, as you asked.";
  }
}

/** The routine is over: coins and things back to Jef, the rest of the wage, the record, the line. */
function errandEnded(db: DB, row: ActionRow, r: Routine, status: "done" | "failed", outcome: string): string {
  const e = st(r);
  const runner = resident(db, row.npc_id);
  // done means the engine's own success condition, not "all steps run"
  const done = status === "done" && !!e.outcome[e.success];
  const parts: string[] = [];
  // Jef's cart: back where they are (with Jef, beside him)
  if (e.cart?.taken && e.cart.data) {
    const at = e.cart_at ?? (row.x !== null && row.z !== null ? { x: row.x, z: row.z } : null) ?? e.at ?? { x: e.cart.x, z: e.cart.z };
    returnCart(db, e.cart.data, at.x, at.z, e.cart.yaw);
    e.cart = null;
    parts.push("Your cart's where I left it.");
  }
  // what they still carry of Jef's (or bought with his coins): back to him (on the way back, or now)
  const back = [...(e.back ?? []), ...handBack(db, e)];
  if (back.length && !(done && e.success === "brought")) parts.push(`Here's the ${nameOf(back[0]).replace(/^(a|an|the) /, "")} back.`);
  if (e.carried.length && runner) remember(db, runner.id, `I still have ${e.carried.map((c) => nameOf(c.kind)).join(", ")} of Jef's; his pockets were full.`, 3);
  // his change
  const change = Math.max(0, e.purse_c - e.spent_c);
  if (change > 0) {
    db.transaction(() => {
      db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = 1").run(change);
      log(db, "errand_change", runner?.id ?? null, `${runner?.name ?? "Someone"} gave Jef back ${change} centimes of his coins from an errand.`);
    })();
    const spent = e.spent_c;
    e.purse_c = spent;
    parts.push(`Here's your ${spent > 0 ? "change" : "money back"}: ${change} centimes.`);
  }
  // the rest of the wage: when it is done (a failed errand keeps what was paid up front)
  if (done && !e.favour && e.wage_c > e.paid_c) {
    const owed = e.wage_c - e.paid_c;
    const pay = Math.min(owed, player(db).money_c);
    if (pay > 0 && runner) stepPay(db, runner.id, pay, "the rest of an errand's wage");
    e.paid_c += pay;
    if (pay < owed && runner) {
      db.prepare("UPDATE npc_relationship SET trust = MAX(-5, trust - 1) WHERE npc_id = ?").run(runner.id);
      remember(db, runner.id, `Jef still owes me ${owed - pay} centimes for an errand.`, 5, "seen", null, { gist: `Jef did not pay ${runner.name} for an errand`, tone: -1 });
      parts.push(`You owe me ${owed - pay} more, mind.`);
    } else if (pay > 0) parts.push(`And ${pay} for my trouble, as agreed.`);
  }
  const line = [reportLine(db, row, e, done, outcome), ...parts].join(" ").trim();
  if (runner) {
    remember(db, runner.id, done ? `I ran an errand for Jef: ${e.goal}. It went well.` : `I ran an errand for Jef: ${e.goal}. It came to nothing.`, 3, "seen", null, done ? { gist: `Jef sent ${runner.name} on an errand`, tone: 1 } : null);
    writeEvent(db, {
      kind: "action",
      verb: done ? "errand_done" : "errand_failed",
      actor: runner.id,
      target: e.recipient,
      text: `${runner.name}'s errand for Jef (${e.goal}) ${done ? "was done" : `came to nothing (${outcome})`}.`,
      outcome: done ? e.success : outcome,
      ref_type: "npc_action",
      ref_id: row.id,
      weight: 4,
      data: { said: e.said, checkins: e.checkins, spent_c: e.spent_c, wage_paid_c: e.paid_c },
      who: [runner.id, ...(e.recipient ? [e.recipient] : [])],
    });
  }
  saveRoutine(db, row.id, r);
  // a second errand of theirs, waiting: it starts once this row is closed (the tick, or at once)
  setTimeout(() => {
    try {
      startQueued(db);
    } catch {
      // the tick will try again
    }
  }, 0);
  return line;
}

// ------------------------------------------------------------------ the tick, the talk, the install

/** Every tick: a follow's time, a check-in nobody answered (a restart), the queue. */
export function errandTick(db: DB): number {
  let n = 0;
  const now = gameMinute(db);
  for (const { row, r } of activeRoutines(db, PURPOSE)) {
    const s = r.steps[r.i];
    if (!s) continue;
    if (s.kind === "follow" && (s.minutes ?? 0) > 0 && now - r.since >= (s.minutes ?? 0)) {
      reportStep(db, row.id, r.i, true, "walked with Jef");
      n++;
      continue;
    }
    if (tagRole(s) === "checkin" && !pending.has(row.id) && now - (st(r).steering ?? r.since) >= CHECKIN_STALE_MIN) {
      const last = [...r.results].reverse().find((x) => !x.ok);
      const failed = last ? r.steps.find((x, j) => j < r.i && x.kind === last.kind) : undefined;
      finishCheckin(db, row.id, failed && last ? { kind: "failed", step: failed, why: last.why } : { kind: "rain" }, null);
      n++;
    }
  }
  n += startQueued(db);
  return n;
}

/** The talk prompt of someone on an errand for Jef. */
function errandContext(db: DB, r: Resident): string {
  const g = routineFor(db, r.id, PURPOSE);
  const q = queued(db).filter((w) => w.npc === r.id);
  if (!g && !q.length) return "";
  const lines: string[] = [];
  if (g) {
    const e = st(g.r);
    const now = g.r.steps[g.r.i];
    lines.push(`RUNNING AN ERRAND FOR JEF: ${e.goal}. Now: ${now ? describeStep(db, now) : "going back to him"}.${e.said.length ? ` So far: ${e.said.slice(-3).join("; ")}.` : ""} The game keeps the coins; never name a sum.`);
  }
  if (q.length) lines.push(`AFTER THAT, ANOTHER ERRAND FOR JEF: ${cleanGoal(q[0].plan.goal)}.`);
  return lines.join("\n");
}

let installed = false;
/** Wire the errand into the executor and the talk (the routes call it; tests call it after installErrands). */
export function installRoutines(): void {
  stepHooks.after[PURPOSE] = (db, row, r, res) => afterErrandStep(db, row, r, res);
  stepHooks.ended[PURPOSE] = (db, row, r, status, outcome) => errandEnded(db, row, r, status, outcome);
  stepHooks.timeUp[PURPOSE] = (db, row) => {
    endRoutine(db, row.id, "failed", "time");
    return true;
  };
  stepHooks.check[PURPOSE] = (db, r, s, id) => checkErrandStep(db, r, s, id);
  stepHooks.run[PURPOSE] = (db, row, r, s) => {
    try {
      return runErrandStep(db, row, r, s);
    } catch (err) {
      return { ok: false, why: String(err instanceof Error ? err.message : err).slice(0, 60) };
    }
  };
  proposeHooks.routine = (db, r, p, at) => proposeRoutine(db, r, p, at);
  if (installed) return;
  installed = true;
  talkExtras.context.push((db, r) => errandContext(db, r));
}

/** A new game: nothing waiting. */
export function clearErrands(db: DB): void {
  setQueue(db, []);
  pending.clear();
}

/** For the Dev panel and the checks: the errands now, with their plan and state (no secrets: engine numbers are fine here). */
export function errandsInfo(db: DB) {
  return {
    running: activeRoutines(db, PURPOSE).map(({ row, r }) => {
      const e = st(r);
      return {
        id: row.id,
        npc: row.npc_id,
        name: resident(db, row.npc_id)?.name ?? row.npc_id,
        goal: e.goal,
        success: e.success,
        step: `${r.i}/${r.steps.length} ${r.steps[r.i] ? describeStep(db, r.steps[r.i]) : "-"}`,
        steps: r.steps.map((s, j) => `${j === r.i ? ">" : " "} ${describeStep(db, s)}`),
        said: e.said,
        checkins: e.checkins,
        purse_c: e.purse_c,
        spent_c: e.spent_c,
        wage_c: e.wage_c,
        paid_c: e.paid_c,
        carried: e.carried.map((c) => c.kind),
        cart: e.cart ? { id: e.cart.id, taken: e.cart.taken } : null,
        minutes_left: Math.max(0, row.until - gameMinute(db)),
      };
    }),
    queued: queued(db).map((w) => ({ npc: w.npc, goal: cleanGoal(w.plan.goal) })),
    recent: (db.prepare("SELECT day, hour, minute, verb, text, outcome, data_json FROM world_event WHERE verb LIKE 'errand_%' ORDER BY id DESC LIMIT 20").all() as Array<Record<string, unknown>>).map((x) => ({ ...x, data: JSON.parse(String(x.data_json ?? "{}")), data_json: undefined })),
  };
}
