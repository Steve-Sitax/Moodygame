import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { GameError, player } from "../game.ts";
import { relationship, remember } from "../npcs.ts";
import { waresOf } from "../trade.ts";
import { gameMinute } from "./deeds.ts";
import { family, resident, town, TOWN_EMPLOYER_IDS } from "./store.ts";
import type { Resident } from "./population.ts";
import { nowOf, talkExtras, type ExtraTopic } from "./talk.ts";
import { actionOf, posOf, type Accepted, type Refused, type Where } from "../director/actions.ts";
import type { ActionProposal } from "../director/vocab.ts";
import type { WorldEvent } from "../director/eventlog.ts";
import { notify } from "../director/bus.ts";
import { activeRoutines, endRoutine, reportStep, routineFor, saveRoutine, startRoutine, stepBuy, stepHooks, type Routine } from "../director/steps.ts";
import { getState, keeperAtWork, keeperOf, setState, tavernLabel } from "../interiors/state.ts";
import { gossipFacts, TAVERN_GUESTS, TIPSY_MAX, TIPSY_PER_DRINK } from "../interiors/tavern.ts";
import { FELT_PER_POINT, giftTrust } from "./gifts.ts";

// Treating someone at the tavern (M6, Steve 2026-09-24): "Or ask to go to the bar and buy a drink."
// The model proposes "come_for_drink" in its talk reply; the ENGINE decides by the person's stats,
// their day (at work, abed), trust, and whether the tavern is open and near. Accepted, they walk
// with Jef (a routine: follow, go in, sit, stay, leave), go in behind him and sit at a table.
// Jef buys the round at the counter through the trade rules (the keeper's prices, a round for two);
// the first round earns a little trust through the gifts' ledger (the same caps). Their tongue
// loosens: the ENGINE picks one thing they know (a thief in the family, something they were in,
// the tavern's gossip) and the model says it in their words. They may get tipsy. When Jef leaves,
// they go back to their day.

/** Rounds Jef may stand one person in one treat. */
export const TREAT_ROUNDS_MAX = 3;
/** The company counts as well as the drink (centimes of worth, in the gifts' ledger). */
export const TREAT_COMPANY_C = 8;
/** The tavern must be within this of Jef when he asks. */
export const TREAT_MAX_M = 350;
/** The guest must be this near the door when Jef goes in. */
export const TREAT_DOOR_M = 30;
/** The walk to the tavern (game minutes); inside, until Jef leaves (or closing, or this long). M7 clock: 480 -> 90, 720 -> 180. */
export const TREAT_WALK_MIN = 90;
export const TREAT_STAY_MIN = 180;

interface TreatState {
  place: string;
  label: string;
  rounds: number;
  tipsy: number;
  fact: string | null;
  told: boolean;
  inside?: string | null;
  [k: string]: unknown;
}
const st = (r: Routine) => r.state as TreatState;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s']/g, " ").replace(/\s+/g, " ").trim();

/** The taverns of the town: place id, label, door. */
export function taverns(db: DB): Array<{ place: string; label: string; x: number; z: number }> {
  return Object.entries(town(db).town.places)
    .filter(([k, p]) => k.startsWith("tavern:") && p.door)
    .map(([k, p]) => ({ place: k, label: p.label, x: p.door![0], z: p.door![1] }));
}

/** The tavern Jef names (by a bit of its name), else the nearest open one to him. */
export function pickTavern(db: DB, words: string, near: { x: number; z: number } | null): { place: string; label: string; x: number; z: number } | null {
  const all = taverns(db);
  const w = norm(words);
  const named = all.find((t) => {
    const l = norm(t.label).replace(/^(the|in de|in het|den|de|het) /, "");
    return l.length >= 4 && (w.includes(l) || l.split(" ").some((part) => part.length >= 5 && w.includes(part)));
  });
  if (named) return named;
  if (!near) return all.find((t) => keeperAtWork(db, t.place)) ?? null;
  return all.filter((t) => keeperAtWork(db, t.place)).sort((a, b) => Math.hypot(a.x - near.x, a.z - near.z) - Math.hypot(b.x - near.x, b.z - near.z))[0] ?? null;
}

const treatedKey = (db: DB, npc: string) => `treat:${clock(db).day}:${npc}`;

// ------------------------------------------------------------------ the engine's yes or no

/** Would this person come for a drink with Jef now? The engine's check (no side effects). */
export function judgeTreat(db: DB, r: Resident, words: string, at: { jef: { x: number; z: number } | null; mine: Where }): { ok: true; tavern: { place: string; label: string; x: number; z: number } } | { ok: false; line: string } {
  const no = (line: string) => ({ ok: false as const, line });
  const now = nowOf(db, r);
  const h = clock(db).hour;
  if (r.age < 16) return no("A tavern? Mother would have my ears, mister.");
  if (r.stats.piety >= 8) return no("I don't set foot in taverns, thank you. God keep you.");
  if (TOWN_EMPLOYER_IDS.includes(r.id) || r.work.kind === "guard") return no("I can't leave my post. Another time.");
  if (r.trade === "police" || r.trade === "water_bailiff" || r.trade === "customs" || r.trade === "priest") {
    if (now.act === "work") return no("Not on duty. And not with you, besides.");
  }
  if (now.act === "work") {
    const keeper = r.work.kind === "stall" || r.work.kind === "shop" || r.work.kind === "tavern";
    return no(keeper ? "And leave the stall? After hours, maybe." : "I'm at my work. After hours, maybe.");
  }
  if (now.act === "home" && (h >= 22 || h < 6)) return no("At this hour? I'm for my bed.");
  if ((h >= 20 || h < 6) && r.stats.courage <= 3) return no("Not in the dark. Not for anyone.");
  const trust = relationship(db, r.id)?.trust ?? 0;
  if (trust < 0) return no("Drink with you? I'd sooner not.");
  if (trust < 1 && r.stats.warmth < 6 && r.stats.gossip < 7) return no("I don't know you well enough to drink with you.");
  if (getState<boolean>(db, treatedKey(db, r.id), false)) return no("You stood me one already today. Another time.");
  if (activeRoutines(db, "treat").length) return no("You've company for the tavern already.");
  if (actionOf(db, r.id)) return no("I've my hands full already. Ask me when I'm done.");
  const tv = pickTavern(db, words, at.jef ?? at.mine);
  if (!tv) return no("There's nowhere open at this hour.");
  if (!keeperAtWork(db, tv.place)) return no(`${tv.label} is shut at this hour.`);
  const from = at.jef ?? at.mine;
  if (Math.hypot(tv.x - from.x, tv.z - from.z) > TREAT_MAX_M) return no(`${tv.label}? That's the other end of town. Somewhere nearer.`);
  return { ok: true, tavern: tv };
}

/** The talk's proposal "come_for_drink": checked here, then the routine (follow, go in, sit, stay, leave). */
export function proposeTreat(db: DB, r: Resident, p: ActionProposal, words: string, at: { jef: { x: number; z: number } | null; mine: Where }): Accepted | Refused {
  const v = judgeTreat(db, r, `${words} ${p.target}`, at);
  if (!v.ok) return { ok: false, reason: "treat", line: v.line, patch: { trust_delta: 0 } };
  const tv = v.tavern;
  const state: TreatState = { place: tv.place, label: tv.label, rounds: 0, tipsy: 0, fact: null, told: false };
  const row = startRoutine(db, {
    npc: r.id,
    purpose: "treat",
    reason: `a drink at ${tv.label}`,
    minutes: TREAT_WALK_MIN,
    target: tv.place,
    target_x: tv.x,
    target_z: tv.z,
    state,
    steps: [
      { kind: "follow", who: "jef", place: tv.place, label: tv.label, x: tv.x, z: tv.z },
      { kind: "enter", place: tv.place, label: tv.label },
      { kind: "sit", place: tv.place, label: tv.label },
      { kind: "wait", inside: tv.place, place: tv.place, label: tv.label },
      { kind: "leave", place: tv.place, label: tv.label },
    ],
  });
  if (row.status !== "active") return { ok: false, reason: "treat", line: "On second thoughts, not tonight.", patch: { trust_delta: 0 } };
  return {
    ok: true,
    action: null,
    instant: true,
    keep: true,
    // the person's own yes stands (the model's words); the note says where they go
    line: "",
    patch: { trust_delta: 0, end_conversation: true },
    extra: { note: `${r.first} walks with you to ${tv.label}.`, label: tv.label },
  };
}

// ------------------------------------------------------------------ in and out (the client says when Jef goes in or out)

/** Jef went into a tavern: a guest who came along (near the door) goes in behind him and sits down. */
export function jefEnters(db: DB, place: string): Array<{ id: string; name: string }> {
  const out: Array<{ id: string; name: string }> = [];
  const door = taverns(db).find((t) => t.place === place);
  if (!door) return out;
  for (const { row, r } of activeRoutines(db, "treat")) {
    if (r.steps[r.i]?.kind !== "follow") continue;
    const at = posOf(db, row.npc_id);
    if (!at || Math.hypot(at.x - door.x, at.z - door.z) > TREAT_DOOR_M) continue;
    // Jef may have gone into another open tavern than the one named: they go in with him there
    if (st(r).place !== place) {
      for (const s of r.steps) if (s.place) Object.assign(s, { place, label: door.label });
      Object.assign(r.state, { place, label: door.label });
      saveRoutine(db, row.id, r);
    }
    reportStep(db, row.id, r.i, true, "came along");
    db.prepare("UPDATE npc_action SET until = ? WHERE id = ?").run(gameMinute(db) + TREAT_STAY_MIN, row.id);
    const who = resident(db, row.npc_id);
    if (who) out.push({ id: who.id, name: who.name });
  }
  if (out.length) notify("actions");
  return out;
}

/** Jef left the tavern: the treat is over; they go back to their day. */
export function jefLeaves(db: DB): number {
  let n = 0;
  for (const { row, r } of activeRoutines(db, "treat")) {
    if (r.steps[r.i]?.kind === "wait") {
      reportStep(db, row.id, r.i, true, "Jef left");
      n++;
    }
  }
  return n;
}

/** Who sits with Jef in this tavern now (for the room; tavern.ts TAVERN_GUESTS). */
export function guestsIn(db: DB, place: string): Array<{ r: Resident; role: string }> {
  return activeRoutines(db, "treat")
    .filter(({ r }) => st(r).inside === place)
    .map(({ row, r }) => ({ r: resident(db, row.npc_id)!, role: st(r).tipsy >= 2 ? "guest_tipsy" : "guest" }))
    .filter((g) => !!g.r);
}

// ------------------------------------------------------------------ the round

export interface RoundResult {
  line: string;
  note: string;
  paid_c: number;
  rounds: number;
  trust: number;
}

/**
 * Jef stands a round at the counter (beer or jenever): the keeper's prices through the trade
 * rules (a round for two), Jef drinks his (his tipsy count), the guest theirs. The first round
 * earns trust through the gifts' ledger and loosens the guest's tongue (the engine picks what).
 */
export function standRound(db: DB, place: string, kind: string): RoundResult {
  // one transaction: the round paid, the trust and the count kept, or none of it
  return db.transaction(() => standRoundNow(db, place, kind))();
}

function standRoundNow(db: DB, place: string, kind: string): RoundResult {
  if (kind !== "beer" && kind !== "jenever") throw new GameError("a round is beer or jenever", 400);
  const g = activeRoutines(db, "treat").find(({ r }) => st(r).inside === place);
  if (!g) throw new GameError("you have nobody here to stand a drink", 409);
  const keeper = keeperOf(db, place);
  if (!keeper || !keeperAtWork(db, place)) throw new GameError(`${tavernLabel(db, place)} is shut`, 409);
  const guest = resident(db, g.row.npc_id)!;
  const s = st(g.r);
  if (s.rounds >= TREAT_ROUNDS_MAX) return { line: `${guest.first}: "No more for me, or I'll not find my own door."`, note: "", paid_c: 0, rounds: s.rounds, trust: 0 };
  const ware = waresOf(db, keeper.id).find((w) => w.kind === kind);
  if (!ware) throw new GameError("they do not sell that", 404);
  const paid = stepBuy(db, keeper.id, kind, 2, guest.id);
  s.rounds++;
  s.tipsy = Math.min(TIPSY_MAX, s.tipsy + (TIPSY_PER_DRINK[kind] ?? 1));
  let trust = 0;
  if (s.rounds === 1) {
    const worth = (paid.price_c + TREAT_COMPANY_C) / (1 + guest.stats.wealth * 0.35);
    // a treat earns at most one point (the company and the drink), through the gifts' caps
    trust = giftTrust(db, guest, Math.min(worth, FELT_PER_POINT), false, 1);
    s.fact = secretOf(db, guest);
    setState(db, treatedKey(db, guest.id), true);
    remember(db, guest.id, `Jef stood me a ${kind === "beer" ? "beer" : "jenever"} at ${s.label}, and we sat together.`, trust > 0 ? 5 : 3, "seen", null, { gist: `Jef stood ${guest.name} a drink at ${s.label}`, tone: 1 });
  } else giftTrust(db, guest, paid.price_c / (1 + guest.stats.wealth * 0.35), false, 1);
  saveRoutine(db, g.row.id, g.r);
  notify("actions");
  const drink = kind === "beer" ? "beer" : "jenever";
  const toast = s.rounds === 1 ? `${guest.first} raises the ${drink}: "Your health, Jef."` : s.tipsy >= 3 ? `${guest.first} laughs too loud and spills a little.` : `${guest.first}: "You're a good sort, you know that?"`;
  const note = s.rounds === 1 ? (trust > 0 ? `${guest.first} warms to you.` : `${guest.first} is glad of the drink.`) + (s.fact ? ` ${guest.sex === "f" ? "She" : "He"} looks ready to talk.` : "") : s.tipsy >= 3 ? `${guest.first} is getting merry.` : "";
  return { line: toast, note, paid_c: paid.paid_c, rounds: s.rounds, trust };
}

// ------------------------------------------------------------------ the loose tongue: the engine's fact

/** Verbs that are only the frame of a thing (an action's or an event's start and end). */
const BARE = /^action_|_(done|failed|stopped|start|started|end|ended)$|^event_/;
const QUIET = new Set(["bought", "drank", "ate", "talked", "convo", "gossip", "diced", "warmed", "treated", "gave", "paid_wage", "action", "refused", "rumour"]);

/**
 * One thing this person knows that Jef might like to hear, picked by the ENGINE (the model only
 * words it): a thief under their own roof; else something they were in lately; else the talk of
 * the taverns (the weighty things of the last two days); else nothing.
 */
export function secretOf(db: DB, r: Resident): string | null {
  const kin = family(db, r).find((o) => o.id !== r.id && (o.trade === "thief" || o.trade === "runner"));
  if (kin) {
    const where = town(db).town.places[kin.work.place]?.label ?? "the quays";
    return kin.trade === "thief"
      ? `${kin.name}, who lives under your own roof, is the one who lifts purses about ${where} after dark. Nobody outside the family knows.`
      : `${kin.name}, of your own house, takes a cut from the shipping agents for every emigrant he talks into a dear ticket.`;
  }
  const since = clock(db).day - 2;
  // not their own errands for Jef, not his talk with them, not an event's bare start or end
  const telling = (e: WorldEvent) =>
    e.kind !== "action" && e.kind !== "talk" && !QUIET.has(e.verb) && !BARE.test(e.verb) && !/\bJef\b/.test(e.text) && !/\b(ended|began|begins|is over)\.?$/.test(e.text);
  // the town's dark doings of late (a theft, the police, a deed): the taverns know them
  const dark = db
    .prepare(
      "SELECT * FROM world_event WHERE day >= ? AND weight >= 4 AND (kind IN ('theft', 'police', 'deed') OR verb IN ('street_robbery', 'robbery_escaped', 'robbery_caught', 'scuffle', 'scuffle_parted')) ORDER BY weight DESC, id DESC LIMIT 12",
    )
    .all(since) as WorldEvent[];
  const d = dark.find(telling);
  if (d) return d.text;
  // what they were in themselves
  const mine = db
    .prepare(
      `SELECT e.* FROM world_event e JOIN world_event_who w ON w.event_id = e.id
       WHERE w.who = ? AND e.day >= ? AND e.weight >= 3 AND (e.actor IS NULL OR e.actor <> 'player') ORDER BY e.weight DESC, e.id DESC LIMIT 12`,
    )
    .all(r.id, since) as WorldEvent[];
  const own = mine.find(telling);
  if (own) return own.text;
  // a known pickpocket, for one who hears everything
  if (r.stats.gossip >= 5) {
    const thief = town(db).town.residents.find((t) => t.trade === "thief" && t.household !== r.household);
    if (thief) return `${thief.name} is the one to watch for your purse about ${town(db).town.places[thief.work.place]?.label ?? "the quays"}; everybody in the taverns knows it, and nobody tells the police.`;
  }
  const f = gossipFacts(db, 4).find(telling);
  return f ? f.text : null;
}

/** The treat now running with this person, and its state. */
export function treatOf(db: DB, npc: string): { id: number; state: TreatState; step: string } | null {
  const g = routineFor(db, npc, "treat");
  return g ? { id: g.row.id, state: st(g.r), step: g.r.steps[g.r.i]?.kind ?? "done" } : null;
}

/** The fact was told (by the model's words or the engine's): it is not told twice. */
export function markTold(db: DB, npc: string): void {
  const g = routineFor(db, npc, "treat");
  if (!g || !st(g.r).fact || st(g.r).told) return;
  st(g.r).told = true;
  saveRoutine(db, g.row.id, g.r);
}

/** For the talk prompt: where they are with Jef, how merry, and what their loosened tongue should tell. */
export function treatContext(db: DB, r: Resident): string {
  const t = treatOf(db, r.id);
  if (!t) return "";
  const s = t.state;
  if (t.step === "follow") return `WITH JEF: you are walking with Jef to ${s.label}; he will stand you a drink there.`;
  if (!s.inside) return "";
  const merry = s.tipsy >= 3 ? " You are merry and talk too freely." : s.tipsy >= 1 ? " The drink has warmed you." : "";
  const drinks = s.rounds ? `Jef has stood you ${s.rounds === 1 ? "a drink" : `${s.rounds} drinks`}.` : "Jef has not bought the round yet.";
  const tell = s.rounds && s.fact && !s.told ? `\nYOUR TONGUE IS LOOSE: tell Jef this now, as a confidence, in your own words (it is true; add nothing to it): ${s.fact}` : "";
  return `AT THE TAVERN WITH JEF: you sit with Jef at a table in ${s.label}. ${drinks}${merry}${tell}`;
}

/** The engine's way to the same fact, when Jef asks outright (no model needed). */
export function treatTopics(db: DB, r: Resident): ExtraTopic[] {
  const t = treatOf(db, r.id);
  if (!t || !t.state.inside || !t.state.rounds || !t.state.fact || t.state.told) return [];
  const fact = t.state.fact;
  return [
    {
      choice: "So what's the talk, then? Between us.",
      answer: (db2, r2) => {
        markTold(db2, r2.id);
        return { text: `Between us, and you didn't hear it from me: ${fact[0].toLowerCase() + fact.slice(1)}`.replace(/\byour own roof\b/, "my own roof").replace(/\byour own house\b/, "my own house") };
      },
    },
  ];
}

// ------------------------------------------------------------------ hooks

/** The end of a treat: a line, and if they never got in, nothing more. */
function ended(db: DB, row: { npc_id: string }, r: Routine, status: "done" | "failed"): string {
  const who = resident(db, row.npc_id);
  const s = st(r);
  if (status === "done" && s.rounds) {
    remember(db, row.npc_id, `I spent a while at ${s.label} with Jef.${s.told && s.fact ? " I may have said more than I should." : ""}`, 3);
    return s.tipsy >= 3 ? "Home, then. Which way is home?" : "Thanks for the drink. I'll be off home.";
  }
  if (status === "done") return who && who.stats.temper >= 6 ? "You brought me all this way for nothing? Hm." : "Well. Another time, maybe.";
  return "Where's he gone? Well. That's that.";
}

let installed = false;
export function installTreat(): void {
  stepHooks.ended.treat = (db, row, r, status) => ended(db, row, r, status);
  stepHooks.after.treat = (db, row, _r, res) => {
    // lost on the way (the client's follow), or the tavern shut before they got in: over
    if (!res.ok && (res.kind === "follow" || res.kind === "enter" || res.kind === "sit")) {
      endRoutine(db, row.id, "failed", res.why);
      return "end";
    }
  };
  stepHooks.timeUp.treat = (db, row) => {
    endRoutine(db, row.id, "done", "time");
    return true;
  };
  if (installed) return;
  installed = true;
  TAVERN_GUESTS.push((db, place) => guestsIn(db, place));
  talkExtras.context.push((db, r) => treatContext(db, r));
  talkExtras.topics.push((db, r) => treatTopics(db, r));
}

/** Every tick: a tavern that shut with a guest inside sends them home. */
export function treatTick(db: DB): number {
  let n = 0;
  for (const { row, r } of activeRoutines(db, "treat")) {
    const s = st(r);
    if (s.inside && !keeperAtWork(db, s.inside)) {
      endRoutine(db, row.id, "done", "closing time");
      n++;
    }
  }
  return n;
}

export { player };
