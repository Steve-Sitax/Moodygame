import { z } from "zod";

// M6 AI-composed routines (Steve, 2026-09-24): "AI could make them do an unprogrammed routine just
// based upon my questions, is that possible? If that happens, AI should keep checking in and
// steering the NPC if needed until it is done."
//
// What the model may write: a plan (in the talk reply) and a check-in answer (while it runs). Both
// are fixed lists and flat fields; the ENGINE (routines.ts) checks and clamps every one, maps the
// plan onto the step executor (steps.ts), and owns every number. No imports but zod, so vocab.ts
// can take the schema without a cycle.

/** The plan's steps as the model names them; the engine turns each into executor steps. */
export const PLAN_STEP_KINDS = ["walk_to", "buy", "give", "talk_to", "fetch_cart", "come_back", "wait", "follow", "enter", "pay", "take"] as const;
export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];

/** How the engine judges the errand done (a fixed list). */
export const SUCCESS_KINDS = ["delivered", "told", "brought", "cart_back", "watched", "arrived"] as const;
export type SuccessKind = (typeof SUCCESS_KINDS)[number];

/** One step of the plan: flat, every field present; the engine ignores what the kind does not use. */
export const PlanStepSchema = z.object({
  kind: z.enum(PLAN_STEP_KINDS),
  /** A place, a person, or "" (walk_to, buy: the seller, give, talk_to, fetch_cart: where it stands, wait: where, enter). */
  target: z.string().max(80),
  /** buy, give, take: the thing, in words. */
  item: z.string().max(40),
  /** buy: how many (the engine clamps to 1-4). */
  count: z.number().int().min(0).max(100000),
  /** talk_to: what they will say, in their own words (the engine cleans it). */
  message: z.string().max(200),
  /** wait: until this hour (0-23), or -1. */
  until_hour: z.number().int().min(-1).max(24),
  /** wait, follow: story minutes (the engine takes them twelve-fold and clamps). */
  minutes: z.number().int().min(0).max(100000),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

/**
 * The plan in the talk reply (action.kind "routine"). The schema lets a long plan through so the
 * engine can refuse it with a line (a schema failure would only drop the whole reply).
 */
export const RoutinePlanSchema = z.object({
  goal: z.string().max(160),
  success: z.enum(SUCCESS_KINDS),
  steps: z.array(PlanStepSchema).max(40),
});
export type RoutinePlan = z.infer<typeof RoutinePlanSchema>;

export const CHECKIN_DECISIONS = ["continue", "change_next", "skip", "come_back", "give_up"] as const;
export type CheckinDecision = (typeof CHECKIN_DECISIONS)[number];

/** A check-in answer: the decision, a new step for change_next, the person's line, why. */
export const CheckinSchema = z.object({
  decision: z.enum(CHECKIN_DECISIONS),
  step: PlanStepSchema,
  line: z.string().max(200),
  why: z.string().max(200),
});
export type Checkin = z.infer<typeof CheckinSchema>;

export const EMPTY_STEP: PlanStep = { kind: "walk_to", target: "", item: "", count: 0, message: "", until_hour: -1, minutes: 0 };

// ------------------------------------------------------------------ the engine's caps (docs/milestones/M6-routines.md)

/** Steps in one plan, as the model wrote them; more and the plan is refused. */
export const ROUTINE_MAX_STEPS = 8;
/** Model check-ins in one routine; after that the engine steers. */
export const CHECKINS_PER_ROUTINE = 5;
/** Routines one person holds for Jef at once: the one running and one waiting its turn. */
export const ROUTINES_PER_RESIDENT = 2;
/** Routines in the whole town at once (running and waiting). */
export const ROUTINES_IN_TOWN = 4;
/**
 * A routine's time, in GAME minutes: its own estimate by the way it walks, never under the
 * first nor over the second. A game hour is 20 real seconds and a walk of 100 m in Jef's sight
 * takes about four game hours, so "two game hours" would end every errand on its first street;
 * 900 is five real minutes.
 */
export const ROUTINE_MIN_MIN = 240;
export const ROUTINE_MAX_MIN = 900;
/** One leg of the way (the M4 go_to limit) and the whole way. */
export const LEG_MAX_M = 400;
export const ROUTE_MAX_M = 900;
/** A watch or a wait in a routine, game minutes. */
export const WAIT_ROUTINE_MAX_MIN = 480;
/** At most this many of one thing bought on an errand. */
export const BUY_MAX = 4;
/** A shut shop: the engine's retry waits this long first (game minutes). */
export const RETRY_WAIT_MIN = 45;
/** A check-in that got no answer (a restart) is steered by the engine after this long (game minutes). */
export const CHECKIN_STALE_MIN = 90;

// ------------------------------------------------------------------ what the talk model is told

export const ROUTINE_RULES_FOR_MODEL = `
routine: Jef asks you to run an errand of several steps that the kinds above do not cover: buy something somewhere and
take it to someone, carry a message to a person and come back, fetch his handcart, keep watch somewhere until an hour.
Set it only if you would do it. Then fill action.plan: goal (a few plain words), success (delivered: a thing handed to
someone; told: a message given; brought: a thing brought back to Jef; cart_back: his handcart brought to him; watched:
a watch kept; arrived: you got to a place) and 1 to ${ROUTINE_MAX_STEPS} steps in order. Step kinds: walk_to (target: a place or a
person), buy (item; target: the shop or seller, or ""; count), give (item; target: the person), talk_to (target: the
person; message: what you will tell them, in your own words), fetch_cart (target: where his handcart stands, or ""),
come_back (to Jef, to tell him how it went), wait (until_hour 0-23 or minutes; target: where), follow (Jef; minutes),
enter (target: a tavern), take (item: a thing Jef hands you now). Put "" / 0 / -1 in the fields a step does not use.
Jef pays for what you buy: the game hands you his coins and names every price. If he offers you a wage for the errand,
put that sum in amount_c. Never plan stealing, harm, fire, breaking in, going into another person's house or taking
money from anywhere; say no in character instead. The game checks every step and may refuse the whole errand.`;
