import { z } from "zod";
import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { remember } from "../npcs.ts";
import { pid } from "../player/current.ts";
import { pstate, setPstate } from "../player/multi.ts";
import { POCKET_SLOTS } from "../trade.ts";
import { weather } from "../day.ts";
import { activityAt } from "./schedule.ts";
import { resident } from "./store.ts";
import { wantedFactor } from "../ideas/wanted.ts";
import {
  WitnessSchema,
  cleanWitnesses,
  deedRow,
  deedTables,
  gameMinute,
  isOutNow,
  lightAt,
  noteSuspects,
  npcName,
  seeChance,
  seenInfoOf,
  witnessed,
  SUSPECT_SPAN,
  type ReactionOut,
  type SeeCtx,
  type SeenInfo,
  type Witness,
} from "./deeds.ts";

// Picking a pocket (M9 theft, Steve 2026-09-27: "if we walk (not run) to a person there should be a
// button to pickpocket; depending on their stats we get a higher chance of detection; young people are
// harder than old, and onlookers see it and shout, confront or call police; also light dependent;
// pickpocketing under a street light can be seen from quite far when they have line of sight").
//
// The ENGINE decides, from facts the client reports and the server clamps:
// - the mark feels the hand (pickChance): the young feel it more than the old, a face turned to him more
//   than a back, a drinker or a busy shopper less, a crowd hides the hand, practice helps; a thief knows
//   the trick and an agent is always watching. Light does not matter to the mark: he feels it.
// - onlookers see it by the same sight as any theft (light at the spot, distance, a clear line, which
//   way they face), but a hand in a pocket is small: PICK_EYES of the chance, less in a crowd.
// - got away with it: money by the mark's wealth, now and then a watch or a handkerchief; the mark finds
//   his pocket light a while later (the client may see him turn round: discover), and remembers who
//   bumped into him.
// Seen or felt, it is a deed like any theft (thing "purse"): the one who saw has it out with him, runs for
// the police or shouts (deeds.ts witnessed); sorry gives the money back (deeds.ts returnThing).

export const PickRequestSchema = z.object({
  id: z.string().min(1).max(24),
  x: z.number(),
  z: z.number(),
  /** How far the mark stands (m) and which way the mark faces him (-1 his back to Jef .. 1 facing him). */
  d: z.number(),
  facing: z.number().default(0),
  witnesses: z.array(WitnessSchema).max(60).default([]),
  crouch: z.boolean().default(false),
  lantern: z.boolean().default(false),
  /** Jef is running: no pocket is picked at a run. */
  hurry: z.boolean().default(false),
  /** People within 5 m of the mark (the crowd that hides the hand). */
  crowd: z.number().default(0),
  /** The mark is talking with someone, watching a show, at a stall. */
  busy: z.boolean().default(false),
});

/** How close he must be (m). */
export const PICK_REACH_M = 1.8;
/** A hand in a pocket is small: the share of an onlooker's chance to see a theft. */
export const PICK_EYES = 0.6;
/** Most coins a pocket gives. */
export const PICK_MAX_C = 60;

export interface PickFacts {
  age: number;
  /** -1 his back to Jef .. 1 facing him. */
  facing: number;
  act: string;
  busy: boolean;
  crowd: number;
  /** Pockets picked unseen before (practice). */
  skill: number;
  trade?: string;
}

/** Pure: the chance the mark feels the hand. */
export function pickChance(f: PickFacts): number {
  let p = f.age < 12 ? 0.35 : f.age < 25 ? 0.5 : f.age < 40 ? 0.38 : f.age < 55 ? 0.28 : f.age < 65 ? 0.2 : 0.12;
  p *= f.facing > 0.3 ? 1.6 : f.facing < -0.3 ? 0.6 : 1;
  if (f.act === "tavern") p *= 0.6; // a drink in him
  if (f.act === "market") p *= 0.8; // his mind on the stalls
  if (f.busy) p *= 0.7;
  p *= crowdCover(f.crowd);
  p *= 1 - 0.04 * Math.min(5, Math.max(0, f.skill));
  if (f.trade === "thief") p *= 1.5; // knows the trick
  if (f.trade === "police") p *= 1.8;
  return Math.max(0.03, Math.min(0.95, p));
}

/** Pure: how much a crowd round the mark hides the hand (1: nobody near). */
export function crowdCover(crowd: number): number {
  return 1 / (1 + 0.12 * Math.max(0, Math.min(20, crowd) - 2));
}

/** Pure: what comes out of the pocket, by the mark's wealth (0-10). */
export function lootOf(wealth: number, rng: () => number): { coins: number; item: string | null } {
  const coins = Math.max(1, Math.min(PICK_MAX_C, Math.round(2 + wealth * (0.8 + rng() * 2.2))));
  const u = rng();
  const item = wealth >= 7 && u < 0.18 ? "pocket_watch" : u > 0.88 ? "handkerchief" : null;
  return { coins, item };
}

export interface PickResult {
  deed: number;
  /** The mark felt the hand: nothing taken. */
  felt: boolean;
  seen: boolean;
  took_c: number;
  item: string | null;
  reaction: ReactionOut | null;
  reactions: ReactionOut[];
  suspects: Array<{ id: string; name: string }>;
  police: boolean;
  police_in?: number;
  police_agent: string | null;
  /** Unseen: real seconds until the mark finds his pocket light (the client looks then: discover). */
  discover_s: number | null;
  text: string;
}

/** Jef picks a pocket. `rng` is a test seam. */
export function pickPocketOf(db: DB, raw: unknown, rng: () => number = Math.random): PickResult {
  deedTables(db);
  const parsed = PickRequestSchema.safeParse(raw);
  if (!parsed.success) throw new GameError("bad report", 400);
  const req = parsed.data;
  if (![req.x, req.z, req.d].every(Number.isFinite)) throw new GameError("bad place", 400);
  if (req.hurry) throw new GameError("not at a run: walk up to them", 409);
  const r = resident(db, req.id);
  if (!r) throw new GameError("nobody like that here", 404);
  if (!isOutNow(db, r.id)) throw new GameError("they are not in the street", 409);
  if (req.d > PICK_REACH_M) throw new GameError("too far away", 409);
  const p = player(db);
  const done = pstate<{ day: number; ids: string[] }>(db, "picked");
  const today = done?.day === p.day ? done.ids : [];
  if (today.includes(r.id)) throw new GameError("you tried that one today already", 409);
  setPstate(db, "picked", { day: p.day, ids: [...today, r.id].slice(-40) });

  const now = activityAt(r.sched, p.day, p.hour + (db.prepare("SELECT minute FROM player WHERE id = 1").get() as { minute: number }).minute / 60);
  const skill = pstate<number>(db, "pick_skill") ?? 0;
  const facing = Math.max(-1, Math.min(1, req.facing));
  const felt = rng() < pickChance({ age: r.age, facing, act: now.act, busy: req.busy, crowd: req.crowd, skill, trade: r.trade });

  // the onlookers (the mark left out: he feels it or not)
  const ws = cleanWitnesses(db, req.witnesses.filter((w) => w.id !== r.id), r.id).filter((w) => w.id !== r.id);
  const hour = p.hour;
  const ctx: SeeCtx = { weather: weather(db), hour, lantern: req.lantern, crouch: req.crouch, light: lightAt(db, req.x, req.z, hour, req.lantern) };
  const cover = crowdCover(req.crowd) * wantedFactor(db);
  const saw: Witness[] = [];
  const suspects: Witness[] = [];
  for (const w of ws) {
    const o = resident(db, w.id);
    if (o?.trade === "thief") continue; // thieves see, and do not tell
    const chance = Math.min(1, seeChance(w, ctx, o?.trade, o?.age ?? 40) * PICK_EYES * cover);
    const u = rng();
    if (u < chance) saw.push(w);
    else if (chance > 0.02 && u < chance * SUSPECT_SPAN && w.d < 20) suspects.push(w);
  }
  const loot = felt ? { coins: 0, item: null } : lootOf(r.stats.wealth, rng);
  const hasRoom = (db.prepare("SELECT COUNT(*) AS n FROM item WHERE player_id = ?").get(pid()) as { n: number }).n < POCKET_SLOTS;
  const item = loot.item && hasRoom ? loot.item : null;
  const seen = felt || saw.length > 0;
  const tellers: Witness[] = felt ? [{ id: r.id, d: Math.max(0, req.d), los: true, facing: 1, owner: true }, ...saw] : saw;
  const t0 = gameMinute(db);
  // unseen: the mark finds the pocket light later, and remembers who bumped into him (a rumour: deeds.ts deedRumours)
  const rumourAt = !seen && !felt ? t0 + 20 + Math.floor(rng() * 40) : null;
  const pm = db.prepare("SELECT minute FROM player WHERE id = 1").get() as { minute: number };
  let deedId = 0;
  let itemId: number | null = null;
  db.transaction(() => {
    if (item) itemId = Number(db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES (?, NULL, ?)").run(item, pid()).lastInsertRowid);
    if (loot.coins) db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(loot.coins, pid());
    deedId = Number(
      db
        .prepare(
          `INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status, rumour_at, player_id, took_c)
           VALUES (?, ?, ?, 'purse', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        )
        .run(p.day, p.hour, pm.minute, item ?? "coins", `pocket:${r.id}`, r.id, req.x, req.z, seen ? 1 : 0, felt ? 1 : 0, JSON.stringify(saw.map((w) => w.id)), itemId, rumourAt, pid(), loot.coins).lastInsertRowid,
    );
    const name = npcName(db, r.id);
    log(
      db,
      "picked_pocket",
      `pocket:${r.id}`,
      felt ? `Jef tried ${name}'s pocket, and ${name} felt it.` : `Jef picked ${name}'s pocket${loot.coins ? ` of ${loot.coins} centimes` : ""}${saw.length ? `, and ${saw.length === 1 ? npcName(db, saw[0].id) : `${saw.length} people`} saw it` : ". Nobody saw"}.`,
    );
    if (!seen) setPstate(db, "pick_skill", skill + 1);
  })();

  const d = deedRow(db, deedId)!;
  const info: SeenInfo = { ...seenInfoOf(db, d), ownerText: felt ? "Jef tried to put his hand in my pocket, and I caught him at it." : "Jef picked my pocket in the street." };
  const out = seen ? witnessed(db, deedId, tellers, info) : null;
  const sus = seen ? [] : noteSuspects(db, deedId, suspects);
  if (!seen) remember(db, r.id, "My pocket was picked in the street. I never saw who.", 3);
  const first = r.first;
  const what = [loot.coins ? `${loot.coins} centimes` : "", item === "pocket_watch" ? "a silver watch" : item === "handkerchief" ? "a linen handkerchief" : ""].filter(Boolean).join(" and ");
  const reaction = out?.reactions[0] ?? null;
  const text = felt
    ? (reaction?.line ?? `${first} jerks round and slaps your hand away: "Hey!"`)
    : seen
      ? `Your fingers come out with ${what}. ${reaction ? reaction.line : "Somebody saw. You can feel their eyes on your back."}`
      : sus.length
        ? `Your fingers come out with ${what}. ${sus[0].name.split(" ")[0]} looks your way. Walk, don't run.`
        : `Your fingers come out with ${what}. ${first} walks on and never feels a thing.`;
  return {
    deed: deedId,
    felt,
    seen,
    took_c: loot.coins,
    item,
    reaction,
    reactions: out?.reactions ?? [],
    suspects: sus,
    police: out?.police ?? false,
    police_in: out?.police_in,
    police_agent: out?.police_agent ?? null,
    discover_s: seen ? null : 30 + Math.floor(rng() * 60),
    text,
  };
}

/**
 * The mark finds his pocket light (the client asks when discover_s is up, with where the mark is now). If
 * he can make out Jef still near (the sight of a theft: light, distance, a clear line; he looks round, so
 * facing him), he knows: the deed is seen, with all that follows. Once a deed.
 */
export function discover(db: DB, deedId: number, raw: { d?: unknown; los?: unknown; x?: unknown; z?: unknown }, rng: () => number = Math.random): { hit: boolean; text: string; reactions?: ReactionOut[]; police?: boolean; police_in?: number; police_agent?: string | null } {
  const d = deedRow(db, deedId);
  if (!d || d.thing !== "purse" || d.status !== "open" || d.seen || (d.player_id ?? 1) !== pid()) return { hit: false, text: "" };
  const done = pstate<number[]>(db, "pick_discovered") ?? [];
  if (done.includes(deedId)) return { hit: false, text: "" };
  setPstate(db, "pick_discovered", [...done, deedId].slice(-20));
  const r = resident(db, d.owner);
  const first = r?.first ?? npcName(db, d.owner);
  const dist = Number(raw.d);
  const x = Number(raw.x);
  const z = Number(raw.z);
  if (!Number.isFinite(dist) || !Number.isFinite(x) || !Number.isFinite(z) || dist > 15) return { hit: false, text: `Somewhere behind you, ${first} pats a pocket and looks round, puzzled.` };
  const hour = player(db).hour;
  const w: Witness = { id: d.owner, d: dist, los: raw.los === true, facing: 1, owner: true };
  const chance = seeChance(w, { weather: weather(db), hour, lantern: false, crouch: false, light: lightAt(db, x, z, hour) }, r?.trade, r?.age ?? 40);
  if (rng() >= chance) return { hit: false, text: `${first} pats a pocket and looks round, puzzled.` };
  db.prepare("UPDATE deed SET seen = 1, owner_saw = 1, rumour_at = NULL WHERE id = ?").run(deedId);
  const info: SeenInfo = { ...seenInfoOf(db, d), ownerText: "My purse went light, and Jef was right there. It was him." };
  const out = witnessed(db, deedId, [w], info);
  const line = out.reactions[0]?.line ?? "";
  return { hit: true, text: `${first} pats a pocket, and looks round at you. "My money! You! Thief!" ${line}`.trim(), reactions: out.reactions, police: out.police, police_in: out.police_in, police_agent: out.police_agent };
}
