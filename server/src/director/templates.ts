import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { stage, eventsToday, type EventPlan } from "./scheduler.ts";
import type { Stage } from "./vocab.ts";

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
}

const weekday = (d: number) => ((d - 1) % 7) + 1;

export const TEMPLATES: Template[] = [
  {
    id: "wedding",
    title: "A wedding at the cathedral",
    place: "cathedral_west",
    stages: [
      stage({ op: "gather", minutes: 20, role: "guests", count: 10, place: "cathedral_west", mood: "joy" }),
      stage({ op: "sound", minutes: 15, sound: "bells", mood: "joy" }),
      stage({ op: "talk", minutes: 10, text: "the bride and the groom, and who paid for the dinner", mood: "joy" }),
      stage({ op: "procession", minutes: 30, place: "engel", sound: "music", mood: "joy" }),
      stage({ op: "sound", minutes: 40, sound: "music", mood: "lively" }),
    ],
    notice: "Banns read: a wedding at the cathedral this morning; the wedding party dines at Den Engel.",
    rumour: "There was a wedding at the cathedral, and the party drank Den Engel dry.",
    fits: (d, h) => weekday(d) !== 7 && h >= 9 && h < 13,
    weight: 2,
    oncePerDay: true,
  },
  {
    id: "funeral",
    title: "A funeral",
    place: "house",
    stages: [
      stage({ op: "gather", minutes: 20, role: "mourners", count: 8, place: "house", mood: "solemn", props: "black_cloth" }),
      stage({ op: "procession", minutes: 35, place: "cathedral_west", sound: "handbell", mood: "solemn" }),
      stage({ op: "gather", minutes: 20, role: "mourners", count: 4, place: "cathedral_west", sound: "murmur", mood: "solemn" }),
    ],
    notice: "A death in the parish: the funeral goes to the cathedral this morning.",
    rumour: "They buried an old neighbour from the cathedral; half the street walked behind the coffin.",
    fits: (d, h) => weekday(d) !== 7 && h >= 8 && h < 12,
    weight: 1,
    oncePerDay: true,
  },
  {
    id: "musicians",
    title: "Street musicians",
    place: "steenplein",
    stages: [
      stage({ op: "gather", minutes: 10, role: "musicians", count: 3, place: "steenplein", mood: "lively" }),
      stage({ op: "gather", minutes: 40, role: "crowd", count: 8, place: "steenplein", sound: "music", mood: "lively" }),
    ],
    notice: "",
    rumour: "Musicians played on the Steenplein and a crowd stood round them till the police moved them on.",
    fits: (_d, h) => h >= 11 && h < 19,
    weight: 3,
    oncePerDay: false,
  },
  {
    id: "emigrant_ship",
    title: "The emigrant ship",
    place: "rijnkaai",
    stages: [
      stage({ op: "notice", minutes: 5, text: "Red Star Line: passage to America. The ship boards at the Rijnkaai today." }),
      stage({ op: "gather", minutes: 30, role: "crowd", count: 12, place: "rijnkaai", sound: "murmur", mood: "curious", props: "crates" }),
      stage({ op: "job", minutes: 5, text: "Carry the emigrants' chests aboard" }),
      stage({ op: "gather", minutes: 40, role: "family", count: 5, place: "rijnkaai", sound: "murmur", mood: "solemn" }),
    ],
    notice: "Red Star Line: passage to America. The ship boards at the Rijnkaai today.",
    rumour: "A shipload of emigrants left the Rijnkaai for America; whole families with their chests.",
    fits: (d, h) => weekday(d) !== 7 && h >= 8 && h < 16,
    weight: 2,
    oncePerDay: true,
  },
  {
    id: "fish_auction",
    title: "The fish auction",
    place: "vismarkt",
    stages: [
      stage({ op: "price", minutes: 5, item: "herring", factor: 0.8 }),
      stage({ op: "gather", minutes: 30, role: "sellers", count: 4, place: "vismarkt", sound: "murmur", mood: "lively" }),
      stage({ op: "gather", minutes: 30, role: "crowd", count: 8, place: "vismarkt", sound: "murmur", mood: "lively", props: "barrels" }),
    ],
    notice: "",
    rumour: "The herring went cheap at the auction this morning; the boats came in full.",
    fits: (d, h) => weekday(d) !== 7 && h >= 6 && h < 9,
    weight: 2,
    oncePerDay: true,
  },
  {
    id: "quarrel",
    title: "A quarrel at the market",
    place: "grote_markt",
    stages: [
      stage({ op: "gather", minutes: 5, role: "sellers", count: 2, place: "grote_markt", mood: "tense" }),
      stage({ op: "talk", minutes: 10, text: "whose pitch it is and who owes whom", mood: "tense" }),
      stage({ op: "gather", minutes: 10, role: "crowd", count: 6, place: "grote_markt", sound: "murmur", mood: "tense" }),
      stage({ op: "gather", minutes: 10, role: "police", count: 2, place: "grote_markt", mood: "tense" }),
    ],
    notice: "",
    rumour: "Two sellers came to words on the Grote Markt and the police had to step in.",
    fits: (d, h) => weekday(d) !== 7 && h >= 9 && h < 14,
    weight: 2,
    oncePerDay: false,
  },
];

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
  const fit = TEMPLATES.filter((t) => t.fits(c.day, c.hour) && !(t.oncePerDay && held.has(t.id)));
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
