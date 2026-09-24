import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { listJobs } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { ITEMS, atWork, buy, waresOf } from "../trade.ts";
import { gameMinute } from "../town/deeds.ts";
import { resident } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { keeperAtWork, tavernLabel } from "../interiors/state.ts";
import { actionHooks, actionRow, endAction, startAction, type ActionRow } from "./actions.ts";
import { notify } from "./bus.ts";

// A small, general STEP EXECUTOR (M6 gifts and hired hands, 2026-09-24). A routine is a list
// of typed steps one townsperson works through for Jef: walk to, follow, pick up, carry, buy,
// give, pay, talk to, wait, go into a place, sit, leave. Every step has an ENGINE check before
// it starts (reachable, open, has the money, has the item, goods left), a run state, and a
// result (done or failed, with a reason). Steps the engine can do at once (buy, give, pay, go
// in, sit, leave) it does at once; walking steps the client walks and reports; a follow ends
// when the engine says so (Jef went in). After every step the purpose's own hook runs (the
// hire adds the next load, the treat ends when Jef leaves), then every `afterAny` hook (main's
// model check-ins, later). The routine is one npc_action row (kind "routine"): it survives a
// reload and ends like any action (time, stop). The model never touches a step; it may only
// propose the errand in talk, which the purpose's module checks and turns into steps.

export const STEP_KINDS = ["walk_to", "follow", "enter", "sit", "leave", "pick_up", "carry", "buy", "give", "pay", "talk_to", "wait"] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export interface Step {
  kind: StepKind;
  /** walk_to, carry: where (a point on the walk grid). */
  x?: number;
  z?: number;
  /** What the place is called (for the client's words). */
  label?: string;
  /** enter, sit, leave: the place id (a tavern). */
  place?: string;
  /** follow: "jef"; talk_to, give, pay: a resident; buy: the seller. */
  who?: string;
  /** pick_up, carry: the job whose goods these are. */
  job?: number;
  /** pick_up, buy, give: the item kind. */
  item?: string;
  /** buy: how many (a round for two is 2). */
  count?: number;
  /** pay: centimes, Jef to `who`. */
  amount_c?: number;
  /** wait: game minutes (0: until the engine ends it). */
  minutes?: number;
  /** carry: walk off with it (the engine's roll): the goods are lost to the job. */
  off?: boolean;
  /** wait: where they wait (inside a place: nothing to walk). */
  inside?: string;
  /** A short reason for the log. */
  why?: string;
}

export interface StepResult {
  i: number;
  kind: StepKind;
  ok: boolean;
  why: string;
  /** Game minute. */
  at: number;
}

export interface Routine {
  purpose: string;
  steps: Step[];
  i: number;
  results: StepResult[];
  /** The purpose's own numbers (wages, loads, the dishonest plan). Never sent to the client. */
  state: Record<string, unknown>;
  /** When the step now running began (game minute). */
  since: number;
}

/** Who runs a step: the engine at once, the client walking it, or the engine on an event (a follow ends when Jef goes in). */
export const STEP_RUNNER: Record<StepKind, "engine" | "client"> = {
  walk_to: "client",
  follow: "client",
  enter: "engine",
  sit: "engine",
  leave: "engine",
  pick_up: "client",
  carry: "client",
  buy: "engine",
  give: "engine",
  pay: "engine",
  talk_to: "client",
  wait: "client",
};

export type AfterHook = (db: DB, row: ActionRow, r: Routine, res: StepResult) => void | "end";

/**
 * Hooks by purpose ("treat", "hire", ...). `after`: a step ended (the purpose may add steps or end
 * the routine); `ended`: the routine is over (done or failed, the purpose's line); `timeUp`: the
 * action's time ran out (return true when the purpose ended it itself). `afterAny`: every
 * routine, every step (main's model check-ins will sit here).
 */
export const stepHooks = {
  after: {} as Record<string, AfterHook>,
  afterAny: [] as AfterHook[],
  ended: {} as Record<string, (db: DB, row: ActionRow, r: Routine, status: "done" | "failed", outcome: string) => string>,
  timeUp: {} as Record<string, (db: DB, row: ActionRow, r: Routine) => boolean>,
};

// ------------------------------------------------------------------ rows

export function routineOf(row: ActionRow | null): Routine | null {
  if (!row || row.kind !== "routine") return null;
  try {
    const d = JSON.parse(row.data_json) as { routine?: Routine };
    return d.routine ?? null;
  } catch {
    return null;
  }
}

export function saveRoutine(db: DB, id: number, r: Routine): void {
  const row = actionRow(db, id);
  if (!row) return;
  const d = JSON.parse(row.data_json || "{}") as Record<string, unknown>;
  db.prepare("UPDATE npc_action SET data_json = ?, phase = ? WHERE id = ?").run(JSON.stringify({ ...d, routine: r }), r.steps[r.i]?.kind ?? "done", id);
}

export function activeRoutines(db: DB, purpose?: string): Array<{ row: ActionRow; r: Routine }> {
  const rows = db.prepare("SELECT * FROM npc_action WHERE status = 'active' AND kind = 'routine' ORDER BY id").all() as ActionRow[];
  return rows.map((row) => ({ row, r: routineOf(row)! })).filter((x) => x.r && (!purpose || x.r.purpose === purpose));
}

export function routineFor(db: DB, npc: string, purpose?: string): { row: ActionRow; r: Routine } | null {
  return activeRoutines(db, purpose).find((x) => x.row.npc_id === npc) ?? null;
}

// ------------------------------------------------------------------ the engine's checks

/** Goods of a carry job not yet delivered, lost or sold (by the progress the client saved). */
export function goodsLeft(db: DB, jobId: number): number {
  const j = listJobs(db, player(db).day).find((x) => x.id === jobId);
  if (!j || j.status !== "taken" || j.task?.kind !== "carry") return 0;
  const p = j.task.progress ?? { delivered: 0, lost: 0, sold: 0 };
  return Math.max(0, j.task.count - p.delivered - p.lost - p.sold);
}

/** The engine's check before a step starts: null when it may, else the reason. */
export function checkStep(db: DB, r: Routine, s: Step, id = -1): string | null {
  switch (s.kind) {
    case "walk_to":
    case "carry": {
      if (s.kind === "carry" && !((r.state.holding as number) > 0)) return "empty_hands";
      if (typeof s.x !== "number" || typeof s.z !== "number" || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return "no_place";
      return walkMap().nearestOpen(s.x, s.z, 4) ? null : "no_way";
    }
    case "follow":
      // face to face with Jef when it starts; the client says when he is lost
      return null;
    case "enter":
    case "sit":
      return s.place && keeperAtWork(db, s.place) ? null : "closed";
    case "leave":
      return null;
    case "pick_up": {
      if (typeof s.job !== "number") return "no_job";
      const others = activeRoutines(db).reduce((n, x) => n + (x.row.id !== id ? Number(x.r.state.holding ?? 0) : 0), 0);
      return goodsLeft(db, s.job) - others > 0 ? null : "none_left";
    }
    case "buy": {
      if (!s.who || !s.item) return "no_seller";
      const ware = waresOf(db, s.who).find((w) => w.kind === s.item);
      if (!ware) return "not_sold";
      if (!atWork(db, s.who)) return "closed";
      return player(db).money_c >= ware.price_c * Math.max(1, s.count ?? 1) ? null : "no_money";
    }
    case "give":
      return s.item && db.prepare("SELECT 1 FROM item WHERE kind = ? AND job_id IS NULL").get(s.item) ? null : "no_item";
    case "pay":
      return player(db).money_c >= Math.max(0, s.amount_c ?? 0) ? null : "no_money";
    case "talk_to":
      return s.who && resident(db, s.who) ? null : "unknown_person";
    case "wait":
      return null;
  }
}

// ------------------------------------------------------------------ the engine's own steps (reusable)

/** Jef pays a resident (a wage): the engine's money, logged. Throws when he has not got it. */
export function stepPay(db: DB, to: string, amount_c: number, why: string): number {
  const amount = Math.max(0, Math.round(amount_c));
  if (!amount) return 0;
  const p = player(db);
  if (p.money_c < amount) throw new GameError(`not enough money: ${amount} c needed`, 409);
  const r = resident(db, to);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(amount);
    log(db, "paid_wage", to, `Jef paid ${r?.name ?? "someone"} ${amount} centimes (${why}).`);
  })();
  return amount;
}

/** One thing from Jef's pockets to a resident (a gift): gone from the pockets. Returns the item's row id. */
export function stepGive(db: DB, to: string, kind: string, itemId?: number): number {
  const row = (
    itemId !== undefined
      ? db.prepare("SELECT id, kind FROM item WHERE id = ? AND job_id IS NULL").get(itemId)
      : db.prepare("SELECT id, kind FROM item WHERE kind = ? AND job_id IS NULL ORDER BY id LIMIT 1").get(kind)
  ) as { id: number; kind: string } | undefined;
  if (!row) throw new GameError("you have no such thing on you", 409);
  const r = resident(db, to);
  db.transaction(() => {
    db.prepare("DELETE FROM item WHERE id = ?").run(row.id);
    log(db, "gave", to, `Jef gave ${r?.name ?? "someone"} ${ITEMS[row.kind]?.name ?? row.kind}.`);
  })();
  return row.id;
}

/**
 * Jef buys at a counter or stall through the trade rules (engine prices, a haggled price, a shut
 * shop refused): his own share through `buy` (his needs, his tipsy count), the rest paid on the
 * spot at the same price for the one he treats. Returns what it cost.
 */
export function stepBuy(db: DB, seller: string, kind: string, count: number, forWhom?: string): { price_c: number; paid_c: number } {
  const n = Math.max(1, Math.min(4, Math.round(count)));
  const ware = waresOf(db, seller).find((w) => w.kind === kind);
  if (!ware) throw new GameError("they do not sell that", 404);
  if (player(db).money_c < ware.price_c * n) throw new GameError(`not enough money: ${ware.price_c * n} c needed`, 409);
  let price = ware.price_c;
  db.transaction(() => {
    const mine = buy(db, seller, kind);
    price = mine.price_c;
    const rest = price * (n - 1);
    if (rest > 0) {
      if (player(db).money_c < rest) throw new GameError(`not enough money: ${rest} c more needed`, 409);
      db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(rest);
      const who = forWhom ? resident(db, forWhom) : null;
      log(db, "treated", forWhom ?? null, `Jef bought ${who ? `${who.name} ` : ""}${ITEMS[kind]?.name ?? kind} as well, ${rest} centimes.`);
    }
  })();
  return { price_c: price, paid_c: price * n };
}

// ------------------------------------------------------------------ running a routine

export interface NewRoutine {
  npc: string;
  purpose: string;
  steps: Step[];
  /** The action's time (game minutes); the purpose's timeUp hook decides what happens then. */
  minutes: number;
  reason: string;
  state?: Record<string, unknown>;
  target?: string;
  target_x?: number | null;
  target_z?: number | null;
}

/** Start a routine (already checked by its module): the row, then the engine's first steps at once. */
export function startRoutine(db: DB, n: NewRoutine): ActionRow {
  const r: Routine = { purpose: n.purpose, steps: n.steps, i: 0, results: [], state: n.state ?? {}, since: gameMinute(db) };
  const row = startAction(db, {
    npc_id: n.npc,
    kind: "routine",
    target: n.target ?? n.purpose,
    target_x: n.target_x ?? null,
    target_z: n.target_z ?? null,
    reason: n.reason,
    source: "talk",
    minutes: n.minutes,
    phase: n.steps[0]?.kind ?? "done",
  });
  saveRoutine(db, row.id, r);
  advance(db, row.id);
  return actionRow(db, row.id)!;
}

/**
 * End a routine now (done or failed). The purpose's end hook always runs (it settles what is owed)
 * and gives the line, unless `line` is given (then that is said instead). Returns the line said.
 */
export function endRoutine(db: DB, id: number, status: "done" | "failed", outcome: string, line?: string): string {
  const row = actionRow(db, id);
  const r = routineOf(row);
  if (!row || !r || row.status !== "active") return "";
  const own = stepHooks.ended[r.purpose]?.(db, row, r, status, outcome) ?? "";
  const said = line ?? own;
  endAction(db, id, status, outcome, said);
  return said;
}

function runEngineStep(db: DB, row: ActionRow, r: Routine, s: Step): { ok: boolean; why: string } {
  try {
    switch (s.kind) {
      case "buy":
        stepBuy(db, s.who!, s.item!, s.count ?? 1, row.npc_id);
        return { ok: true, why: "bought" };
      case "give":
        stepGive(db, s.who ?? row.npc_id, s.item!);
        return { ok: true, why: "given" };
      case "pay":
        stepPay(db, s.who ?? row.npc_id, s.amount_c ?? 0, s.why ?? "a wage");
        return { ok: true, why: "paid" };
      case "enter":
      case "sit":
        r.state.inside = s.place;
        return { ok: true, why: s.kind === "enter" ? `went into ${tavernLabel(db, s.place!)}` : "sat down" };
      case "leave":
        r.state.inside = null;
        return { ok: true, why: "left" };
      default:
        return { ok: false, why: "not an engine step" };
    }
  } catch (e) {
    return { ok: false, why: e instanceof GameError ? e.message : String(e) };
  }
}

/** Record a result, run the hooks; "end" when a hook ended the routine. */
function settleStep(db: DB, id: number, r: Routine, ok: boolean, why: string): "end" | void {
  const s = r.steps[r.i];
  const res: StepResult = { i: r.i, kind: s.kind, ok, why: why.slice(0, 80), at: gameMinute(db) };
  r.results.push(res);
  if (r.results.length > 40) r.results.splice(0, r.results.length - 40);
  r.i++;
  r.since = gameMinute(db);
  saveRoutine(db, id, r);
  const row = actionRow(db, id)!;
  const hooks = [stepHooks.after[r.purpose], ...stepHooks.afterAny].filter(Boolean) as AfterHook[];
  for (const h of hooks) {
    // a hook works on the saved routine and saves it back
    const cur = routineOf(actionRow(db, id)) ?? r;
    const out = h(db, actionRow(db, id) ?? row, cur, res);
    if (out === "end" || actionRow(db, id)?.status !== "active") return "end";
  }
}

/** Run what the engine can run now: checks, engine steps, until a client step or the end. */
export function advance(db: DB, id: number): void {
  for (let guard = 0; guard < 60; guard++) {
    const row = actionRow(db, id);
    const r = routineOf(row);
    if (!row || !r || row.status !== "active") return;
    const s = r.steps[r.i];
    if (!s) {
      endRoutine(db, id, "done", "all steps done");
      return;
    }
    const bad = checkStep(db, r, s, id);
    if (bad) {
      if (settleStep(db, id, r, false, bad) === "end") return;
      continue;
    }
    if (STEP_RUNNER[s.kind] === "client") {
      notify("actions");
      return;
    }
    const out = runEngineStep(db, row, r, s);
    if (settleStep(db, id, r, out.ok, out.why) === "end") return;
  }
}

/**
 * A step ended outside the engine: the client walked it (arrived, picked up, delivered, lost the
 * way), or the engine's own event finished it (Jef went in: the follow is done). `i` must be the
 * step now running; anything else is stale and ignored.
 */
export function reportStep(db: DB, id: number, i: number, ok: boolean, why: string, patch?: (r: Routine) => void): Routine | null {
  const row = actionRow(db, id);
  const r = routineOf(row);
  if (!row || !r || row.status !== "active" || r.i !== i || !r.steps[i]) return r;
  patch?.(r);
  if (settleStep(db, id, r, ok, why) !== "end") advance(db, id);
  return routineOf(actionRow(db, id));
}

/** Add steps after the one now running (or at the end); the purpose's hooks use this. */
export function addSteps(r: Routine, steps: Step[], next = false): void {
  if (next) r.steps.splice(r.i, 0, ...steps);
  else r.steps.push(...steps);
}

/** A wait with minutes: over when the time is up (the tick). */
export function stepsTick(db: DB): number {
  let n = 0;
  const now = gameMinute(db);
  for (const { row, r } of activeRoutines(db)) {
    const s = r.steps[r.i];
    if (s?.kind === "wait" && (s.minutes ?? 0) > 0 && now - r.since >= (s.minutes ?? 0)) {
      reportStep(db, row.id, r.i, true, "waited");
      n++;
    }
  }
  return n;
}

// ------------------------------------------------------------------ what the client sees

/** The routines for the client: who, and the step to walk now (never the purpose's numbers). */
export function listRoutines(db: DB) {
  return activeRoutines(db).map(({ row, r }) => {
    const s = r.steps[r.i];
    const who = resident(db, row.npc_id);
    return {
      id: row.id,
      npc: row.npc_id,
      name: who?.name ?? row.npc_id,
      purpose: r.purpose,
      i: r.i,
      n: r.steps.length,
      step: s ? { kind: s.kind, x: s.x ?? null, z: s.z ?? null, label: s.label ?? null, place: s.place ?? null, job: s.job ?? null, item: s.item ?? null, count: s.count ?? 1, off: !!s.off, inside: s.inside ?? null, who: s.who ?? null } : null,
      holding: Number(r.state.holding ?? 0),
      strong: r.state.strong !== false,
      // the purpose's cart lent to them, once they have it (town/hire.ts): the client draws it on them
      cart: (r.state.cart as { id?: string; taken?: boolean } | null | undefined)?.taken ? ((r.state.cart as { id: string }).id ?? null) : null,
      minutes_left: Math.max(0, row.until - gameMinute(db)),
    };
  });
}

/** Wire the executor into the actions (their time running out); called once by the routes. */
export function installSteps(): void {
  actionHooks.timeUp.routine = (db, a) => {
    const r = routineOf(a);
    if (!r) return false;
    const own = stepHooks.timeUp[r.purpose];
    if (own && own(db, a, r)) return true;
    endRoutine(db, a.id, "failed", "time");
    return true;
  };
  // a routine's person may be asked to stop in talk: the purpose's end line, not the plain one
  actionHooks.report.routine = async (_db, a) => a;
}

/** A memory for the person of what they did for Jef (the purposes use it). */
export function rememberRoutine(db: DB, npc: string, text: string, weight: number, gist?: { gist: string; tone: number }): void {
  remember(db, npc, text, weight, "seen", null, gist ?? null);
}

/** Test helper: start a bare routine (no purpose checks). */
export function devRoutine(db: DB, npc: string, steps: Step[], purpose = "test", minutes = 480, state: Record<string, unknown> = {}): ActionRow {
  return startRoutine(db, { npc, purpose, steps, minutes, reason: purpose, state });
}
