import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { remember } from "../npcs.ts";
import { policeDispatch } from "../town/police.ts";
import { activityAt } from "../town/schedule.ts";
import { resident, town } from "../town/store.ts";
import { walkMap } from "../town/walkmap.ts";
import { actionOf, activeActions, endAction, isReserved, jefAt, posOf } from "./actions.ts";
import { runConvo } from "./convo.ts";
import { writeEvent } from "./eventlog.ts";
import { castAgent, eventRow, leadsOf, type EventRow, type StoredStage } from "./scheduler.ts";
import { CATCH_CHANCE, PURSE_POOR_C, PURSE_RICH_C, RICH_TRADES, SCENE_LINES, SCENE_POLICE_M, WITNESS_M } from "./vocab.ts";

// M4b: the two scenes the director may ask for, played and settled by the ENGINE. The
// project has no combat: nobody is hurt, nobody has a weapon, the player never fights.
//
// A scuffle: two leads argue (a conversation, the model's words or the engine's), then push
// and shove (the client plays it), a crowd forms, and the police agent on duty comes and
// parts them. The engine decides who was in the wrong (a drunk always; else the hotter
// temper), and writes the memories, the rumour and the world_event rows.
//
// A robbery in the street: a pickpocket lead lifts a victim lead's purse. The ENGINE fixes
// the sum (by the victim's trade), whether an agent is near enough to give chase, and whether
// he catches the thief. Money moves between residents on the record only (world_event rows);
// never to or from Jef. Unsolved, it stays open: Jef, if he saw it, can tell the police, and
// the police case (actions.ts, convo.ts) settles it with the engine's verdict.

export interface Scene {
  kind: "scuffle" | "robbery";
  /** Scuffle: the two. Robbery: a is the pickpocket, b the victim. */
  a: string;
  b: string;
  agent: string | null;
  /** Scuffle: who was in the wrong. */
  wrong?: string;
  /** Robbery: the engine's numbers. */
  amount_c?: number;
  caught?: boolean;
  flee?: { x: number; z: number };
  witnessed?: boolean;
  /** The engine's words the client shows at the right moment: the shout, the agent's line, the loser's. */
  lines: { shout?: string; agent?: string; sorry?: string };
  about: string;
  place: string;
  /** world_event id of the start. */
  started: number;
  resolved?: boolean;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
};

/** The engine's dice for the scenes (tests fix it). */
let roll: (key: string) => number = hash;
export function setSceneRoll(f: ((key: string) => number) | null): void {
  roll = f ?? hash;
}

const pick = <T>(list: T[], key: string): T => list[Math.floor(hash(key) * list.length) % list.length];
/** The engine's lines say "him"; a woman thief or quarreller is "her". */
const forSex = (t: string, sex: "m" | "f"): string => (sex === "f" ? t.replace(/\bhim\b/g, "her").replace(/\bhe\b/g, "she").replace(/\bHe\b/g, "She").replace(/\bhis\b/g, "her") : t);

/** The nearest agent on duty, free, within reach of the spot, in daylight hours. */
function agentFor(db: DB, spot: { x: number; z: number }, not: string[]): string | null {
  const c = clock(db);
  const busy = new Set(activeActions(db).map((a) => a.npc_id));
  // every agent on his beat now, nearest first by his beat (as policeDispatch), then free and near enough
  const onDuty = town(db)
    .town.residents.filter((r) => r.trade === "police" && activityAt(r.sched, c.day, c.hour + c.minute / 60).act === "work")
    .map((r) => {
      const route = r.work.route ?? [[r.home.sx, r.home.sz]];
      const at = posOf(db, r.id);
      const d = Math.min(...route.map(([x, z]) => Math.hypot(x - spot.x, z - spot.z)), at ? Math.hypot(at.x - spot.x, at.z - spot.z) : Infinity);
      return { id: r.id, d };
    })
    .sort((a, b) => a.d - b.d);
  const first = policeDispatch(db, spot);
  if (first && !onDuty.some((o) => o.id === first)) onDuty.unshift({ id: first, d: 0 });
  for (const o of onDuty) {
    if (o.d > SCENE_POLICE_M) break;
    if (not.includes(o.id) || busy.has(o.id) || isReserved(db, o.id)) continue;
    return o.id;
  }
  return null;
}

function saveScene(db: DB, ev: EventRow, i: number, scene: Scene): void {
  const stages = JSON.parse(eventRow(db, ev.id)!.stages_json) as StoredStage[];
  if (!stages[i]) return;
  stages[i].scene = scene;
  db.prepare("UPDATE town_event SET stages_json = ? WHERE id = ?").run(JSON.stringify(stages), ev.id);
}

/** A scene's stage begins: the engine sets it up (who, the sum, the chase, the verdict). */
export function applyScene(db: DB, ev: EventRow, s: StoredStage, i: number): Scene | null {
  const leads = leadsOf(ev);
  const at = { x: s.x ?? ev.x, z: s.z ?? ev.z };
  const place = s.label ?? ev.place;
  const about = s.text || (s.op === "scuffle" ? "who owes whom" : "a purse");
  if (s.op === "scuffle") {
    const two = leads.filter((l) => l.role === "quarreller" || l.role === "drunkard");
    if (two.length < 2) {
      writeEvent(db, { kind: "event", verb: "scene_skipped", text: `${ev.title}: nobody to quarrel, so no scuffle.`, ref_type: "town_event", ref_id: ev.id, weight: 1 });
      return null;
    }
    const [la, lb] = two;
    const a = resident(db, la.id)!;
    const b = resident(db, lb.id)!;
    // who was in the wrong: a drunk always; else the hotter temper; a tie by the engine's dice
    const wrong = la.role === "drunkard" ? a.id : lb.role === "drunkard" ? b.id : a.stats.temper !== b.stats.temper ? (a.stats.temper > b.stats.temper ? a.id : b.id) : roll(`${ev.id}:wrong`) < 0.5 ? a.id : b.id;
    const agent = agentFor(db, at, [a.id, b.id]);
    if (agent) castAgent(db, eventRow(db, ev.id)!, agent, { x: at.x, z: at.z + 1.3 });
    const started = writeEvent(db, {
      kind: "event",
      verb: "scuffle",
      actor: a.id,
      target: b.id,
      place: ev.place,
      x: at.x,
      z: at.z,
      text: `${a.name} and ${b.name} fell out at ${place} over ${about}, and came to pushing and shoving. A crowd stood round.${agent ? "" : " No agent was near."}`,
      ref_type: "town_event",
      ref_id: ev.id,
      weight: 6,
      who: [a.id, b.id, ...(agent ? [agent] : [])],
    });
    const scene: Scene = {
      kind: "scuffle",
      a: a.id,
      b: b.id,
      agent,
      wrong,
      lines: { agent: agent ? pick(SCENE_LINES.part, `${ev.id}:part`) : undefined, sorry: forSex(pick(SCENE_LINES.sorry, `${ev.id}:sorry`), (wrong === a.id ? b : a).sex) },
      about,
      place,
      started,
    };
    saveScene(db, ev, i, scene);
    // the words first (the model's or the engine's); the shoving the client plays after them
    void runConvo(db, { a: a.id, b: b.id, purpose: "argue", about, event_id: ev.id }).catch((e) => console.warn("[scenes] argue", e));
    return scene;
  }

  // a robbery
  const lp = leads.find((l) => l.role === "pickpocket");
  const lv = leads.find((l) => l.role === "victim");
  if (!lp || !lv) {
    writeEvent(db, { kind: "event", verb: "scene_skipped", text: `${ev.title}: no pickpocket about, so no robbery.`, ref_type: "town_event", ref_id: ev.id, weight: 1 });
    return null;
  }
  const thief = resident(db, lp.id)!;
  const victim = resident(db, lv.id)!;
  const [lo, hi] = RICH_TRADES.includes(victim.trade) ? PURSE_RICH_C : PURSE_POOR_C;
  const amount_c = Math.round((lo + roll(`${ev.id}:purse`) * (hi - lo)) / 5) * 5 || lo;
  const h = clock(db).hour;
  const agent = h >= 6 && h < 22 ? agentFor(db, at, [thief.id, victim.id]) : null;
  const caught = !!agent && roll(`${ev.id}:catch`) < CATCH_CHANCE;
  // where he runs: a caught thief does not get far
  const ang = roll(`${ev.id}:way`) * Math.PI * 2;
  const far = caught ? 16 : 45;
  const wm = walkMap();
  let flee = { x: at.x, z: at.z };
  for (let k = 0; k < 8; k++) {
    const q = wm.nearestOpen(at.x + Math.cos(ang + k * 0.8) * far, at.z + Math.sin(ang + k * 0.8) * far, 6);
    if (q) {
      flee = q;
      break;
    }
  }
  const jef = jefAt();
  const witnessed = !!jef && Math.hypot(jef.x - at.x, jef.z - at.z) <= WITNESS_M;
  // the agent is about on his beat, ten metres off: close enough to give chase, not at her elbow
  if (agent) castAgent(db, eventRow(db, ev.id)!, agent, walkMap().nearestOpen(at.x + 9, at.z - 6, 4) ?? { x: at.x + 3, z: at.z - 2 });
  const started = writeEvent(db, {
    kind: "theft",
    verb: "street_robbery",
    actor: thief.id,
    target: victim.id,
    place: ev.place,
    x: at.x,
    z: at.z,
    text: `A pickpocket lifted ${victim.name}'s purse (${amount_c} centimes) at ${place} and ran.${witnessed ? " Jef saw it happen." : ""}`,
    ref_type: "town_event",
    ref_id: ev.id,
    weight: 7,
    data: { thief: thief.id, victim: victim.id, amount_c, witnessed, place },
    who: [thief.id, victim.id, ...(agent ? [agent] : [])],
  });
  const scene: Scene = {
    kind: "robbery",
    a: thief.id,
    b: victim.id,
    agent,
    amount_c,
    caught,
    flee,
    witnessed,
    lines: { shout: forSex(pick(SCENE_LINES.shout, `${ev.id}:shout`), thief.sex), agent: agent ? forSex(pick(caught ? SCENE_LINES.caught : SCENE_LINES.escaped, `${ev.id}:agent`), thief.sex) : undefined },
    about,
    place,
    started,
  };
  saveScene(db, ev, i, scene);
  return scene;
}

/** The scene's stage is over: the engine's outcome, memories, the rumour, the record. */
export function resolveScene(db: DB, ev: EventRow, i: number): void {
  const stages = JSON.parse(ev.stages_json) as StoredStage[];
  const sc = stages[i]?.scene;
  if (!sc || sc.resolved) return;
  sc.resolved = true;
  saveScene(db, ev, i, sc);
  const a = resident(db, sc.a);
  const b = resident(db, sc.b);
  const agent = sc.agent ? resident(db, sc.agent) : null;
  if (!a || !b) return;
  // they go their own ways now (parted, or the thief off with or without the purse)
  for (const id of [sc.a, sc.b, sc.agent]) {
    const act = id ? actionOf(db, id) : null;
    if (act && act.event_id === ev.id) endAction(db, act.id, "done", sc.kind === "scuffle" ? "parted" : "scene over");
  }
  const day = clock(db).day;
  const fact = (t: string) => db.prepare("INSERT INTO world_fact (text, weight, day, tags) VALUES (?, 6, ?, ?)").run(t, day, `rumour,event:${ev.id}`);

  if (sc.kind === "scuffle") {
    const wrong = sc.wrong === a.id ? a : b;
    const right = wrong === a ? b : a;
    remember(db, wrong.id, `I lost my temper with ${right.name} at ${sc.place} over ${sc.about}.${agent ? ` ${agent.name} of the police parted us.` : ""} I was in the wrong, they say.`, 5);
    remember(db, right.id, `${wrong.name} went for me at ${sc.place} over ${sc.about}.${agent ? ` The police parted us.` : ""} He was in the wrong.`, 5);
    if (agent) remember(db, agent.id, `I parted ${a.name} and ${b.name} at ${sc.place}. ${wrong.first} started it.`, 3);
    const text = `${a.name} and ${b.name} came to shoving at ${sc.place} over ${sc.about}; ${agent ? "the police parted them" : "the crowd pulled them apart"}. ${wrong.first} was in the wrong, they say.`;
    fact(text);
    writeEvent(db, {
      kind: "event",
      verb: "scuffle_parted",
      actor: agent?.id ?? null,
      target: wrong.id,
      place: ev.place,
      text,
      outcome: `in the wrong: ${wrong.name}`,
      ref_type: "world_event",
      ref_id: sc.started,
      weight: 5,
      data: { wrong: wrong.id, other: right.id, agent: agent?.id ?? null },
      who: [a.id, b.id, ...(agent ? [agent.id] : [])],
    });
    return;
  }

  // the robbery: caught, the purse goes back to the victim (on the record); else it stays open
  const amount = sc.amount_c ?? 0;
  if (sc.caught && agent) {
    remember(db, b.id, `A pickpocket took my purse at ${sc.place}; ${agent.name} of the police caught him and I had my ${amount} centimes back.`, 6);
    remember(db, a.id, `${agent.name} of the police caught me with a purse at ${sc.place}. I had to give the ${amount} centimes back.`, 7);
    remember(db, agent.id, `I caught ${a.name} with ${b.name}'s purse at ${sc.place} and gave it back.`, 5);
    const text = `The police caught ${a.name} with ${b.name}'s purse at ${sc.place}; the ${amount} centimes went back to ${b.first}.`;
    fact(text);
    writeEvent(db, { kind: "theft", verb: "robbery_caught", actor: agent.id, target: a.id, place: ev.place, text, outcome: "caught", ref_type: "world_event", ref_id: sc.started, weight: 7, data: { thief: a.id, victim: b.id, amount_c: amount }, who: [a.id, b.id, agent.id] });
    return;
  }
  remember(db, b.id, `A pickpocket took my purse at ${sc.place}, ${amount} centimes, and got clean away. I only saw his back.`, 6);
  remember(db, a.id, `I had ${b.name}'s purse at ${sc.place}, ${amount} centimes, and nobody laid a hand on me.`, 5);
  if (agent) remember(db, agent.id, `A pickpocket got away from me at ${sc.place} with ${b.name}'s purse.`, 4);
  const text = `A pickpocket took ${b.name}'s purse at ${sc.place} and got clean away.`;
  fact(text);
  writeEvent(db, {
    kind: "theft",
    verb: "robbery_escaped",
    actor: a.id,
    target: b.id,
    place: ev.place,
    text: `${text}${sc.witnessed ? " Jef saw it." : ""}`,
    outcome: "escaped",
    ref_type: "world_event",
    ref_id: sc.started,
    weight: 7,
    data: { thief: a.id, victim: b.id, amount_c: amount, witnessed: !!sc.witnessed, place: sc.place },
    who: [a.id, b.id, ...(agent ? [agent.id] : [])],
  });
}

/** What the client needs to play a scene: who, the chase, and the engine's lines. */
export function sceneForClient(s: StoredStage | undefined) {
  const sc = s?.scene;
  if (!sc) return null;
  return { kind: sc.kind, a: sc.a, b: sc.b, agent: sc.agent, wrong: sc.wrong ?? null, caught: sc.caught ?? null, flee: sc.flee ?? null, lines: sc.lines, resolved: !!sc.resolved };
}

// ------------------------------------------------------------------ the open street robbery (the police case)

export interface StreetCrime {
  /** world_event id of the escape. */
  id: number;
  thief: string;
  victim: string;
  amount_c: number;
  witnessed: boolean;
  place: string;
  day: number;
}

/** The newest robbery in the street the thief got away with, not yet settled, of the last two days. */
export function streetCrimeOpen(db: DB): StreetCrime | null {
  const day = clock(db).day;
  const row = db.prepare("SELECT id, day, data_json FROM world_event WHERE verb = 'robbery_escaped' AND day >= ? ORDER BY id DESC LIMIT 1").get(day - 1) as { id: number; day: number; data_json: string } | undefined;
  if (!row) return null;
  const solved = db.prepare("SELECT 1 FROM world_event WHERE verb = 'robbery_solved' AND ref_type = 'world_event' AND ref_id = ?").get(row.id);
  if (solved) return null;
  const d = JSON.parse(row.data_json) as { thief?: string; victim?: string; amount_c?: number; witnessed?: boolean; place?: string };
  if (!d.thief || !d.victim) return null;
  return { id: row.id, thief: d.thief, victim: d.victim, amount_c: d.amount_c ?? 0, witnessed: !!d.witnessed, place: d.place ?? "the street", day: row.day };
}
