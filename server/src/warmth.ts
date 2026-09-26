import { z } from "zod";
import type { DB } from "./db.ts";
import { clock, weather, WHERE, type JefWhere } from "./day.ts";
import { keeperAtWork, tavernLabel, tavernPlace } from "./interiors/state.ts";
import { POESJE, doorOpen as poesjeOpen } from "./interiors/poesje.ts";
import { town } from "./town/store.ts";
import { atWork } from "./trade.ts";
import { lease, placedIn } from "./homes/homes.ts";
import { homeDef } from "./homes/town.ts";
import { CLASSES } from "../../shared/homes.ts";
import { shopTrade, type ShopTrade } from "../../shared/shops.ts";
import { LANDMARK_IDS, LANDMARK_LABEL, landmarkOpen, type LandmarkId } from "../../shared/landmarks.ts";
import { prisonVisiting } from "../../shared/prisonPlan.ts";

// M7 warmth (docs/milestones/M7-warmth.md): where Jef is, for the cold. With each /api/tick the client
// says where Jef stands (outside, or inside a named room) and whether his lantern is lit in his hand.
// The ENGINE believes only what it can check: a room that exists and is open now (a tavern whose keeper
// is at work, a shop whose keeper is at work, his own rented room, a church or hall in its hours, the
// prison in visiting hours), and a lantern he has in his pockets. Anything else counts as outside, and so
// does a report older than WHERE_TTL_MS. The rules themselves are day.ts applyHour's.
// Multiplayer later: the report is kept by player id (one player now, id 1).

/** A report counts this long (real ms): two and a half ticks. Older, Jef is outside. */
export const WHERE_TTL_MS = 25_000;
/** After a swim his coat is wet this long (game minutes): the lantern does not help. */
export const WET_AFTER_SWIM_MIN = 120;
/** Shops without a stove for the customers: the butcher keeps his meat cold, the grocer's front stands open, no fire among the chandler's tar and lamp oil. */
export const COLD_SHOPS: ReadonlySet<ShopTrade> = new Set<ShopTrade>(["butcher", "grocer", "chandler"]);

/** What the client may say. Ids are short plain words; anything else is thrown away. */
export const WhereReport = z.object({
  at: z
    .string()
    .max(80)
    .regex(/^[a-z0-9_:-]+$/i)
    .nullable()
    .optional(),
  lantern: z.boolean().optional(),
});
export type WhereReport = z.infer<typeof WhereReport>;

interface Kept {
  at: string | null;
  lantern: boolean;
  ms: number;
}
const kept = new Map<number, Kept>();

/** The client's word with a tick (or none). A report that does not parse is kept as "outside, no lantern". */
export function reportWhere(body: unknown, now = Date.now(), playerId = 1): void {
  const r = WhereReport.safeParse(body);
  kept.set(playerId, r.success ? { at: r.data.at ?? null, lantern: r.data.lantern === true, ms: now } : { at: null, lantern: false, ms: now });
}

/** Test helper: forget every report. */
export function forgetWhere(): void {
  kept.clear();
}

const OUTSIDE = (lantern: boolean): JefWhere => ({ shelter: "outside", lantern, place: null, label: "outside" });

function minuteNow(db: DB): number {
  const c = clock(db);
  return c.day * 1440 + c.hour * 60 + c.minute;
}

/** Jef's coat is wet: rain or a gale now (he is outside), or a swim not two game hours ago. */
export function wetNow(db: DB): boolean {
  const w = weather(db);
  if (w === "rain" || w === "storm") return true;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'swam_at'").get() as { value_json: string } | undefined;
  const at = row ? Number(JSON.parse(row.value_json)) : NaN;
  return Number.isFinite(at) && minuteNow(db) - at < WET_AFTER_SWIM_MIN;
}

function hasLantern(db: DB): boolean {
  return !!db.prepare("SELECT 1 FROM item WHERE kind = 'lantern' LIMIT 1").get();
}

/** The room the client names, checked against the town now; null: no such room, or shut. */
export function roomNow(db: DB, at: string): Omit<JefWhere, "lantern"> | null {
  const c = clock(db);
  const h = c.hour + c.minute / 60;
  if (at.startsWith("tavern:")) {
    // a tavern or cafe: open while its keeper is at work, and then its fire burns
    const place = tavernPlace(db, at);
    if (!place || !keeperAtWork(db, place)) return null;
    return { shelter: "heated", place, label: tavernLabel(db, place) };
  }
  if (at === "poesje") {
    // the puppet cellar: a stove and a packed bench of dockers
    if (!poesjeOpen(db)) return null;
    return { shelter: "heated", place: "poesje", label: POESJE.label };
  }
  if (at.startsWith("shop:")) {
    const id = at.slice(5);
    const s = town(db).town.shops.find((q) => q.id === id);
    if (!s || !atWork(db, s.keeper)) return null;
    const trade = shopTrade(id);
    return { shelter: trade && COLD_SHOPS.has(trade) ? "sheltered" : "heated", place: at, label: s.label };
  }
  if (at.startsWith("home:")) {
    // only the room he rents; a stove or a hearth heats it, else it is only out of the wind
    const id = at.slice(5);
    const l = lease(db);
    const home = homeDef(db, id);
    if (!l || !home || l.home !== id) return null;
    const fire = CLASSES[home.cls].fire || placedIn(db, home.id).some((p) => p.kind === "stove");
    return { shelter: fire ? "heated" : "sheltered", place: at, label: home.label };
  }
  if (at.startsWith("landmark:")) {
    const id = at.slice(9) as LandmarkId;
    if (!LANDMARK_IDS.includes(id) || !landmarkOpen(id, c.day, h)) return null;
    return { shelter: "sheltered", place: at, label: LANDMARK_LABEL[id] };
  }
  if (at === "church:carolus" || at === "church:gothic") {
    // the Carolus, St Paul's and St James's: open from six in the morning to seven at night (their sextons)
    if (h < 6 || h >= 19) return null;
    return { shelter: "sheltered", place: at, label: at === "church:carolus" ? "the Carolus church" : "the church" };
  }
  if (at === "prison") {
    // its gate stands open in visiting hours only
    if (!prisonVisiting(c.day, h)) return null;
    return { shelter: "sheltered", place: at, label: "the prison" };
  }
  return null;
}

/**
 * Where Jef is now, as far as the engine believes it: the last report if it is fresh and checks out,
 * else outside. The lantern counts only if he has one, and only outside and dry.
 */
export function whereNow(db: DB, now = Date.now(), playerId = 1): JefWhere {
  const k = kept.get(playerId);
  if (!k || now - k.ms > WHERE_TTL_MS || now < k.ms - 1000) return OUTSIDE(false);
  const room = k.at ? roomNow(db, k.at) : null;
  if (room) return { ...room, lantern: false };
  return OUTSIDE(k.lantern && hasLantern(db) && !wetNow(db));
}

// day.ts applyHour asks here (registered, not imported there: homes.ts pushes into day.ts's hooks at load)
WHERE.now = (db) => whereNow(db);
