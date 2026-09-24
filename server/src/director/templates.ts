import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { stage, eventsToday, type EventPlan } from "./scheduler.ts";
import type { Cue, CueSource, Stage } from "./vocab.ts";
import { isShipDay } from "../town/emigrants.ts";

// The event templates (M4): what the engine falls back on when the director
// has no budget or writes something the engine cannot play, and what the dev
// buttons start. Every stage is an engine primitive; the words are engine words.

export interface Template {
  id: string;
  title: string;
  place: string;
  stages: Stage[];
  notice: string;
  rumour: string;
  /** When it fits: day of the week (1 Monday .. 7 Sunday) and the hour. */
  fits(day: number, hour: number): boolean;
  /** How likely, against the others that fit. */
  weight: number;
  /** The player may only see it once a day. */
  oncePerDay: boolean;
  /**
   * M6 town life: scripted stages. The engine's own act for each stage (fire.ts, hiring.ts), in
   * place of the op's plain work; a scripted template keeps its stages whatever the model wrote.
   */
  acts?: Array<string | null>;
  /** The town's own routine (the dawn hiring): never the engine's random pick, not counted as one of the day's events. */
  routine?: boolean;
  /** Rare: not again within this many days (the house fire). */
  gapDays?: number;
}

const weekday = (d: number) => ((d - 1) % 7) + 1;
/** A sound cue of a template's stage (the same palette the director composes from; cleanCues clamps these too). */
const cue = (source: CueSource, every_s: number, pitch: number, level: number): Cue => ({ source, every_s, pitch, level });

export const TEMPLATES: Template[] = [
  {
    id: "wedding",
    title: "A wedding at the cathedral",
    place: "cathedral_west",
    stages: [
      // M4b: the couple and the priest stand in the middle (Steve: "no groom, no bride")
      stage({ op: "gather", minutes: 150, role: "guests", count: 35, place: "cathedral_west", mood: "joy", props: "flowers", leads: ["groom", "bride", "priest"] }),
      // the bells bring the neighbourhood out to look (Steve: a wedding pulls 50 to 100)
      stage({ op: "gather", minutes: 60, role: "crowd", count: 50, place: "cathedral_west", sound: "bells", mood: "joy", cues: [cue("cheer", 9, 1, 0.8), cue("applause", 14, 1, 0.6)] }),
      stage({ op: "talk", minutes: 90, text: "the bride and the groom, and who paid for the dinner", mood: "joy", cues: [cue("laughter", 12, 1, 0.5)] }),
      // the groom and the bride walk first, arm in arm; the priest stays at his church
      stage({ op: "procession", minutes: 150, place: "engel", sound: "music", mood: "joy", leads: ["groom", "bride"], cues: [cue("cheer", 12, 1, 0.7), cue("fiddle", 10, 1, 0.6)] }),
      stage({ op: "sound", minutes: 120, sound: "music", mood: "lively", cues: [cue("laughter", 15, 1, 0.5), cue("glass", 0, 1, 0.5)] }),
    ],
    notice: "Banns read: {groom} and {bride} marry at the cathedral this morning; the wedding party dines at Den Engel.",
    rumour: "{groom} and {bride} were married at the cathedral, and the party drank Den Engel dry.",
    fits: (d, h) => weekday(d) !== 7 && h >= 9 && h < 13,
    weight: 2,
    oncePerDay: true,
  },
  {
    id: "funeral",
    title: "A funeral",
    place: "house",
    stages: [
      stage({ op: "gather", minutes: 150, role: "mourners", count: 30, place: "house", mood: "solemn", props: "black_cloth", leads: ["widow", "bearers"] }),
      // the bearers with the coffin go first, the widow behind them
      stage({ op: "procession", minutes: 180, place: "cathedral_west", sound: "handbell", mood: "solemn", leads: ["bearers", "widow"] }),
      stage({ op: "gather", minutes: 120, role: "mourners", count: 8, place: "cathedral_west", sound: "murmur", mood: "solemn", leads: ["priest"] }),
    ],
    notice: "A death in the parish: the funeral goes to the cathedral this morning; {widow} walks behind the coffin.",
    rumour: "They buried a neighbour from the cathedral; {bearers} carried the coffin, {widow} walked behind it, and half the street after her.",
    fits: (d, h) => weekday(d) !== 7 && h >= 8 && h < 12,
    weight: 1,
    oncePerDay: true,
  },
  {
    id: "musicians",
    title: "Street musicians",
    place: "steenplein",
    stages: [
      stage({ op: "gather", minutes: 60, count: 0, place: "steenplein", mood: "lively", leads: ["organ_grinder", "fiddler", "accordionist"] }),
      stage({ op: "gather", minutes: 180, role: "crowd", count: 30, place: "steenplein", sound: "music", mood: "lively", cues: [cue("fiddle", 9, 1, 0.7), cue("applause", 22, 1, 0.5), cue("laughter", 18, 1, 0.4)] }),
    ],
    notice: "Street music on the Steenplein: {organ_grinder} with his barrel organ, {fiddler} with a fiddle and {accordionist} with his accordion.",
    rumour: "{organ_grinder}, {fiddler} and {accordionist} played on the Steenplein and a crowd stood round them till the police moved them on.",
    fits: (_d, h) => h >= 11 && h < 19,
    weight: 3,
    oncePerDay: false,
  },
  {
    id: "emigrant_ship",
    title: "The emigrant ship",
    place: "rijnkaai",
    stages: [
      stage({ op: "notice", minutes: 5, text: "Red Star Line: passage to America. The Kempenland lies at anchor in the stream; lighters take her emigrants out from the Rijnkaai today." }),
      stage({ op: "gather", minutes: 150, role: "crowd", count: 20, place: "rijnkaai", sound: "murmur", mood: "curious", props: "crates", cues: [cue("clatter", 8, 0.8, 0.6), cue("ship_bell", 30, 1, 0.5)] }),
      stage({ op: "job", minutes: 5, text: "Carry the emigrants' chests down to the lighter" }),
      stage({ op: "gather", minutes: 150, role: "family", count: 6, place: "rijnkaai", sound: "murmur", mood: "solemn", cues: [cue("cry", 20, 1, 0.5), cue("steam_whistle", 40, 1, 0.6)] }),
    ],
    notice: "Red Star Line: passage to America. The Kempenland lies at anchor in the stream; lighters take her emigrants out from the Rijnkaai today.",
    rumour: "The lighters took a shipload of emigrants out to the Kempenland at anchor, bound for America; whole families with their chests.",
    fits: (d, h) => isShipDay(d) && h >= 8 && h < 16, // only on the Red Star Line's ship days (town/emigrants.ts)
    weight: 2,
    oncePerDay: true,
  },
  {
    id: "fish_auction",
    title: "The fish auction",
    place: "vismarkt",
    stages: [
      stage({ op: "price", minutes: 5, item: "herring", factor: 0.8 }),
      // the auctioneer in the middle with his handbell and his board
      stage({ op: "gather", minutes: 120, role: "sellers", count: 4, place: "vismarkt", sound: "handbell", mood: "lively", leads: ["auctioneer"], cues: [cue("shout", 6, 0.9, 0.8), cue("clatter", 14, 1, 0.5)] }),
      stage({ op: "gather", minutes: 150, role: "crowd", count: 16, place: "vismarkt", sound: "murmur", mood: "lively", props: "barrels", cues: [cue("shout", 7, 1, 0.7), cue("laughter", 20, 1, 0.4)] }),
    ],
    notice: "Fish auction at the Vismarkt this morning: {auctioneer} rings the bell.",
    rumour: "The herring went cheap at the auction of {auctioneer} this morning; the boats came in full.",
    fits: (d, h) => weekday(d) !== 7 && h >= 6 && h < 9,
    weight: 2,
    oncePerDay: true,
  },
  {
    id: "quarrel",
    title: "A quarrel at the market",
    place: "grote_markt",
    stages: [
      stage({ op: "gather", minutes: 60, count: 0, place: "grote_markt", mood: "tense", leads: ["quarreller", "quarreller"] }),
      stage({ op: "talk", minutes: 90, text: "whose pitch it is and who owes whom", mood: "tense", leads: ["quarreller", "quarreller"], cues: [cue("shout", 8, 1, 0.7)] }),
      stage({ op: "gather", minutes: 90, role: "crowd", count: 14, place: "grote_markt", sound: "murmur", mood: "tense", cues: [cue("shout", 9, 1.1, 0.6), cue("dog", 25, 1, 0.4)] }),
      stage({ op: "gather", minutes: 90, role: "police", count: 2, place: "grote_markt", mood: "tense" }),
    ],
    notice: "",
    rumour: "{quarreller} came to words on the Grote Markt and the police had to step in.",
    fits: (d, h) => weekday(d) !== 7 && h >= 9 && h < 14,
    weight: 2,
    oncePerDay: false,
  },
  // M4b: the scenes, as the engine's own fallback (the director invents its own)
  {
    id: "scuffle",
    title: "A scuffle on the Vismarkt",
    place: "vismarkt",
    stages: [
      stage({ op: "gather", minutes: 60, count: 0, place: "vismarkt", mood: "tense", leads: ["drunkard", "quarreller"] }),
      stage({ op: "scuffle", minutes: 150, text: "a spilled jug of beer", mood: "tense", sound: "murmur", leads: ["drunkard", "quarreller"], cues: [cue("glass", 0, 1, 0.7), cue("shout", 7, 0.9, 0.8)] }),
      stage({ op: "gather", minutes: 90, role: "crowd", count: 12, place: "vismarkt", sound: "murmur", mood: "tense" }),
    ],
    notice: "",
    rumour: "",
    fits: (_d, h) => h >= 12 && h < 20,
    weight: 1,
    oncePerDay: true,
  },
  {
    id: "street_robbery",
    title: "A purse snatched on the Grote Markt",
    place: "grote_markt",
    stages: [
      stage({ op: "gather", minutes: 60, count: 0, place: "grote_markt", mood: "calm", leads: ["victim", "pickpocket"] }),
      stage({ op: "robbery", minutes: 150, mood: "tense", leads: ["pickpocket", "victim"] }),
      stage({ op: "gather", minutes: 90, role: "crowd", count: 10, place: "grote_markt", sound: "murmur", mood: "tense" }),
    ],
    notice: "",
    rumour: "",
    fits: (d, h) => weekday(d) !== 7 && h >= 10 && h < 18,
    weight: 1,
    oncePerDay: true,
  },
  // M6 town life: a house fire (director/fire.ts). The engine picks the house (never Jef's home),
  // the alarm bell rings, the pump comes with its horses and the firemen, a bucket chain forms
  // from the water, the fire dies down and the front is left black.
  {
    id: "house_fire",
    title: "A house on fire",
    place: "fire_house",
    stages: [
      // the alarm bell: the client rings it from the cathedral tower (game/townlife.ts), heard across the town
      stage({ op: "sound", minutes: 45, sound: "none", mood: "tense" }),
      stage({ op: "gather", minutes: 60, role: "crowd", count: 40, sound: "murmur", mood: "tense", cues: [cue("crackle", 4, 1, 0.8), cue("shout", 9, 1, 0.7)] }),
      stage({ op: "gather", minutes: 150, role: "family", count: 45, sound: "murmur", mood: "tense", cues: [cue("crackle", 4, 1, 0.8), cue("pump", 8, 1, 0.7), cue("horse", 24, 1, 0.5), cue("shout", 10, 1, 0.6)] }),
      stage({ op: "sound", minutes: 120, sound: "murmur", mood: "solemn", cues: [cue("crackle", 8, 0.8, 0.4), cue("cry", 30, 1, 0.4)] }),
    ],
    acts: ["fire_start", "fire_brigade", "fire_chain", "fire_down"],
    notice: "",
    rumour: "",
    fits: (_d, h) => h >= 9 && h < 20,
    weight: 0.4,
    oncePerDay: true,
    gapDays: 3,
  },
  // M6 town life: the naties hire day men at dawn (director/hiring.ts); planned by the engine every
  // working morning, never picked at random, not one of the day's four events
  {
    id: "hiring",
    title: "The naties hire at dawn",
    place: "rijnkaai",
    stages: [
      // fixes 2026-09-24: the men gather from 5:00, the call stays at about 6:20 (80 minutes: a game hour is
      // 20 s of play, and 50 minutes was too short for the men to walk to the gates in time)
      stage({ op: "gather", minutes: 80, role: "family", count: 30, sound: "murmur", mood: "calm", cues: [cue("clatter", 15, 0.9, 0.4)] }),
      stage({ op: "sound", minutes: 60, sound: "murmur", mood: "lively", cues: [cue("shout", 8, 0.9, 0.7)] }),
    ],
    acts: ["hire_gather", "hire_call"],
    notice: "",
    rumour: "",
    fits: (d, h) => weekday(d) !== 7 && h >= 5 && h < 7,
    weight: 0,
    oncePerDay: true,
    routine: true,
  },
  // M6 ballads: the ballad singer at a busy corner, morning and afternoon (ballads/ballad.ts); the
  // engine plans it, casts the singer and gathers a small crowd; the town's routine, not an event
  {
    id: "ballad",
    title: "The ballad singer",
    place: "grote_markt",
    stages: [stage({ op: "gather", minutes: 180, role: "crowd", count: 10, sound: "none", mood: "lively" })],
    acts: ["ballad_sing"],
    notice: "",
    rumour: "",
    fits: (_d, h) => h >= 9 && h < 17,
    weight: 0,
    oncePerDay: false,
    routine: true,
  },
];

/** The town's routine templates (not counted as the day's events). */
export const ROUTINE_TEMPLATES = new Set(TEMPLATES.filter((t) => t.routine).map((t) => t.id));

/**
 * M6: a plan that is really one of the scripted templates (the dev button, the engine, or the
 * director asking for a fire in its own words: kind "house_fire", "fire", "blaze" ...).
 */
export function scriptFor(plan: { template: string; title: string }): Template | null {
  const id = plan.template.trim().toLowerCase();
  const byId = TEMPLATES.find((t) => t.id === id && t.acts);
  if (byId) return byId;
  if (/\b(house fire|fire|blaze|burning|ablaze|on fire)\b/.test(id.replace(/_/g, " ")) || /\b(fire|blaze|ablaze|burning)\b/i.test(plan.title))
    return TEMPLATES.find((t) => t.id === "house_fire") ?? null;
  return null;
}

/** The last day a template was held (planned, running or done), or null. */
export function lastHeldDay(db: DB, id: string): number | null {
  const row = db.prepare("SELECT MAX(day) AS d FROM town_event WHERE template = ? AND status <> 'cancelled'").get(id) as { d: number | null };
  return row.d ?? null;
}

export function templateById(id: string): Template | null {
  return TEMPLATES.find((t) => t.id === id.trim().toLowerCase()) ?? null;
}

/** The plan a template makes. */
export function planFromTemplate(t: Template, source: "claude" | "engine", over: Partial<EventPlan> = {}): EventPlan {
  return { title: t.title, template: t.id, place: t.place, start_in_min: 10, stages: t.stages.map((s) => ({ ...s })), notice: t.notice, rumour: t.rumour, source, ...over };
}

/** The engine's pick for this hour: a template that fits the day and the hour and was not held today. */
export function enginePick(db: DB, rng: () => number = Math.random): Template | null {
  const c = clock(db);
  const held = new Set(eventsToday(db).map((e) => e.template));
  const fit = TEMPLATES.filter((t) => !t.routine && t.fits(c.day, c.hour) && !(t.oncePerDay && held.has(t.id)) && !(t.gapDays && (lastHeldDay(db, t.id) ?? -99) > c.day - t.gapDays));
  if (!fit.length) return null;
  const total = fit.reduce((a, t) => a + t.weight, 0);
  let roll = rng() * total;
  for (const t of fit) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return fit[fit.length - 1];
}

/** The templates as the director's prompt lists them. */
export function templatesForPrompt(): string {
  return TEMPLATES.map((t) => `- ${t.id}: ${t.title}, at ${t.place}, ${t.stages.reduce((a, s) => a + s.minutes, 0)} minutes (${t.stages.map((s) => s.op).join(", ")})`).join("\n");
}
