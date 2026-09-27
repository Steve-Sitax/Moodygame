import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { MOODS } from "../hooks/dialogue.ts";
import { resident } from "./store.ts";
import type { Resident } from "./population.ts";
import { jefSaid, talkExtras, talkHooks, type FreeAnswer, type ResidentLine } from "./talk.ts";
import { jefAt, posOf, proposeHooks, type Accepted, type Refused, type Where } from "../director/actions.ts";
import { END_LINE, type ActionProposal } from "../director/vocab.ts";
import { endRoutine, goodsLeft, installSteps, listRoutines, reportStep, routineFor, routineOf, stepsTick } from "../director/steps.ts";
import { actionRow } from "../director/actions.ts";
import { giveInTalk, offersGift, type GiftVerdict } from "./gifts.ts";
import { installTreat, jefEnters, jefLeaves, markTold, proposeTreat, standRound, treatOf, treatTick } from "./treat.ts";
import { hireTick, installHire, proposeHire, WORK_RE } from "./hire.ts";

// The talk's three new proposals (M6 gifts and hired hands, 2026-09-24) wired into the M4 actions,
// the step executor's report route, the treat's in-and-out, and the ticks. Mounted by index.ts.

// ------------------------------------------------------------------ gifts through the proposal

function giftAnswer(v: GiftVerdict): Accepted | Refused {
  const handover = v.ok && v.held ? { item: v.held.kind, name: v.held.name, eaten: v.eaten, warmed: v.trust > 0 } : null;
  if (v.ok) return { ok: true, action: null, instant: true, keep: true, line: "", patch: { trust_delta: 0 }, extra: { note: v.note, ...(handover ? { handover } : {}) } };
  // the owner's own thing back: a hand-over too (the M3h give-back)
  const back = v.reason === "own_back" && v.held ? { handover: { item: v.held.kind, name: v.held.name, eaten: false, warmed: false } } : {};
  return { ok: false, reason: "gift", line: v.line, patch: { trust_delta: 0 }, extra: { ...(v.note ? { note: v.note } : {}), ...back } };
}

export function proposeGift(db: DB, r: Resident, p: ActionProposal): Accepted | Refused {
  const words = jefSaid(r.id);
  // the model may not invent a gift: Jef's own words must offer one
  if (!offersGift(words)) return { ok: true, action: null, line: "", instant: false, patch: { trust_delta: 0 } };
  return giftAnswer(giveInTalk(db, r, words, p.item));
}

const place = (at: { jef: { x: number; z: number } | null; mine: Where }) => at;

/** The engine's reply line (the model late or over budget): the talk's own shape. */
function engineLine(text: string, mood: (typeof MOODS)[number] = "neutral", end = false): ResidentLine {
  return { npc_line: text, mood, choices: [], trust_delta: 0, memory_note: "", memory_weight: 1, rumour: "", rumour_tone: 0, persona_line: "", end_conversation: end };
}

const TREAT_RE = /\b(drink|beer|jenever|gin|pint|tavern|inn|a glass|stand you|buy you)\b/i;

/**
 * Jef's own words when no model call is left for this meeting (budget, the meeting's cap): a gift,
 * a drink or a hire the engine can answer by itself, in its own words. With a call left: null (the
 * model reads the words and proposes).
 */
async function freeByEngine(db: DB, r: Resident, text: string, meeting: { canCall: () => boolean }): Promise<FreeAnswer | null> {
  if (meeting.canCall()) return null;
  const at = { jef: jefAt(), mine: (posOf(db, r.id) ?? { x: 0, z: 0, indoors: false }) as Where };
  if (offersGift(text)) {
    const v = giveInTalk(db, r, text, "");
    const handover = v.ok && v.held ? { item: v.held.kind, name: v.held.name, eaten: v.eaten, warmed: v.trust > 0 } : null;
    return { line: engineLine(v.line, v.ok ? "warm" : "neutral"), note: v.note || undefined, extra: handover ? { handover } : undefined };
  }
  const p: ActionProposal = { kind: "none", target: "", minutes: 0, item: "", amount_c: 0, reason: "" };
  if (TREAT_RE.test(text) && /\b(come|join|let me|let's|buy|stand|treat|have a)\b/i.test(text)) {
    const v = proposeTreat(db, r, { ...p, kind: "come_for_drink", target: text.slice(0, 60) }, text, place(at));
    return { line: engineLine(v.ok ? `Why not. ${String(v.extra?.label ?? "The tavern")}, then. Lead the way.` : v.line, v.ok ? "warm" : "neutral", v.ok), note: (v.extra?.note as string | undefined) ?? undefined };
  }
  if (WORK_RE.test(text) && /\b(pay|hire|wage|centimes?|francs?|help me)\b/i.test(text)) {
    const v = proposeHire(db, r, { ...p, kind: "work_for_pay", item: text.slice(0, 30) }, text, place(at));
    return { line: engineLine(v.ok ? `Done. ${v.line}` : v.line, "neutral", v.ok), note: (v.extra?.note as string | undefined) ?? undefined };
  }
  return null;
}

let freeInstalled = false;

/** Wire the proposals, the steps and the talk's guards (the routes call it; tests call it after installTalkHooks). */
export function installErrands(): void {
  installSteps();
  installTreat();
  installHire();
  proposeHooks.receive_gift = (db, r, p) => proposeGift(db, r, p);
  proposeHooks.come_for_drink = (db, r, p, at) => proposeTreat(db, r, p, jefSaid(r.id), at);
  proposeHooks.work_for_pay = (db, r, p, at) => {
    const words = jefSaid(r.id);
    // the wage must be in Jef's words; the model's number only picks which of them
    return proposeHire(db, r, p, `${words}`, at);
  };
  // "stop" to someone on a routine: its own end (a hand is paid for what he carried)
  proposeHooks.stop = (db, r) => {
    const g = routineFor(db, r.id);
    if (!g) return null;
    const line = endRoutine(db, g.row.id, "failed", "stopped");
    return { ok: true, action: null, instant: true, line: line || END_LINE.stopped, patch: { trust_delta: 0 } };
  };
  // the trust from a gift or a treat is the engine's alone: the model's own trust delta is held at 0
  // while Jef's words offer a gift, or while they drink on him (M3e's delta, clamped to +-2, stays for the rest)
  const prev = talkHooks.proposal as typeof talkHooks.proposal & { errands?: boolean };
  if (!prev.errands) {
    const wrapped = ((db: DB, r: Resident, line: ResidentLine) => {
      const words = jefSaid(r.id);
      const t = treatOf(db, r.id);
      let l = line;
      if ((offersGift(words) || (t && t.step !== "follow")) && l.trust_delta > 0) l = { ...l, trust_delta: 0 };
      // the loosened tongue: once the model had the fact in its prompt and answered, it was told
      if (t?.state.inside && t.state.rounds && t.state.fact) markTold(db, r.id);
      return prev(db, r, l);
    }) as typeof talkHooks.proposal & { errands?: boolean };
    wrapped.errands = true;
    talkHooks.proposal = wrapped;
  }
  if (!freeInstalled) {
    freeInstalled = true;
    talkExtras.free.push((db, r, text, meeting) => freeByEngine(db, r, text, meeting));
  }
}

// ------------------------------------------------------------------ routes

export interface ErrandDeps {
  db: DB;
  payload: () => Record<string, unknown>;
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export function mountErrands(app: Hono, deps: ErrandDeps): void {
  const { db, payload } = deps;
  installErrands();

  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      stepsTick(db);
      treatTick(db);
      hireTick(db);
    } catch (e) {
      console.error("[errands] tick", e);
    }
  });

  // the routines the client walks: who, and the step now
  app.get("/api/routines", (c) => c.json({ routines: listRoutines(db) }));

  // a walking step ended in the street (arrived, picked up, delivered, lost the way)
  app.post("/api/routine/:id/step", async (c) => {
    const id = Number(c.req.param("id"));
    const b = await body(c);
    const row = actionRow(db, id);
    const r = routineOf(row);
    if (!row || !r) throw new GameError("no such errand", 404);
    const i = Number(b.i);
    const step = r.steps[i];
    // only the client's own steps, the one now running; the engine's steps are the engine's
    if (!step || i !== r.i || !["walk_to", "follow", "pick_up", "carry", "talk_to", "wait"].includes(step.kind)) return c.json({ ok: false, routine: listRoutines(db).find((x) => x.id === id) ?? null });
    // a follow and a wait end by the engine (Jef goes in, the time is up): the client may only report them failed
    const ok = b.ok === true && step.kind !== "follow" && step.kind !== "wait";
    const why = typeof b.why === "string" ? b.why.replace(/[^a-z _-]/gi, "").slice(0, 30) : ok ? "done" : "failed";
    // a pick-up with a cart takes several: the client's count, never more than the step allows or the job has left
    const n = step.kind === "pick_up" && ok ? Math.max(1, Math.min(step.count ?? 1, Math.floor(Number(b.n) || 1), step.job !== undefined ? goodsLeft(db, step.job) : 1)) : 0;
    // where they stood (the client's word, clamped to the town): a lent cart is left there if the work stops
    if (typeof b.x === "number" && typeof b.z === "number" && Number.isFinite(b.x) && Number.isFinite(b.z))
      db.prepare("UPDATE npc_action SET x = ?, z = ? WHERE id = ?").run(Math.max(-2000, Math.min(2000, b.x)), Math.max(-2000, Math.min(2000, b.z)), id);
    const at = typeof b.x === "number" && typeof b.z === "number" && Number.isFinite(b.x) && Number.isFinite(b.z) ? { x: Number(b.x), z: Number(b.z) } : null;
    reportStep(db, id, i, ok, why || (ok ? "done" : "failed"), (rt) => {
      if (n) rt.state.holding = n;
      // a hand pushing Jef's cart: where he has it now (it is left there if the work stops)
      if (at && (rt.state.cart as { taken?: boolean } | null)?.taken) rt.state.cart_at = at;
    });
    return c.json({ ok: true, routine: listRoutines(db).find((x) => x.id === id) ?? null, ...payload() });
  });

  // the treat: Jef went into a tavern, came out, stood a round
  app.post("/api/treat/enter", async (c) => {
    const b = await body(c);
    if (typeof b.place !== "string") throw new GameError("which tavern?", 400);
    return c.json({ guests: jefEnters(db, b.place) });
  });
  app.post("/api/treat/leave", (c) => c.json({ ended: jefLeaves(db) }));
  app.get("/api/treat", (c) => {
    // (M8c: the treats the player who asks is standing)
    const list = listRoutines(db).filter((x) => x.purpose === "treat" && !!treatOf(db, x.npc));
    return c.json({
      treats: list.map((x) => {
        const t = treatOf(db, x.npc);
        const who = resident(db, x.npc);
        return { id: x.id, npc: x.npc, name: x.name, first: who?.first ?? x.name, step: x.step?.kind ?? null, place: t?.state.place ?? null, label: t?.state.label ?? null, inside: t?.state.inside ?? null, rounds: t?.state.rounds ?? 0, tipsy: t?.state.tipsy ?? 0 };
      }),
    });
  });
  app.post("/api/treat/round", async (c) => {
    const b = await body(c);
    if (typeof b.place !== "string") throw new GameError("which tavern?", 400);
    const r = standRound(db, b.place, String(b.kind ?? "beer"));
    return c.json({ ...r, ...payload() });
  });
}
