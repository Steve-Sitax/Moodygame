import { z } from "zod";
import { EVENT_GATHER_MAX, EVENT_PEOPLE_MAX as PEOPLE_MAX } from "../config.ts";
import { ROUTINE_RULES_FOR_MODEL, RoutinePlanSchema } from "./routineVocab.ts";
import { gameMin } from "../../../shared/clock.ts";

// The vocabulary of M4: what a townsperson may be asked to do (an action), what
// the engine says when it refuses or sets a limit, the primitives an event is
// made of, and the words the engine uses when the model is late. The engine
// owns every number here; the model only proposes (docs/03 rule one).

// ------------------------------------------------------------------ actions

/** M6: receive_gift (Jef gives them a thing), come_for_drink (Jef treats them at a tavern), work_for_pay (Jef hires them). */
/** M6 routines: routine (an errand of several steps the model plans; director/routines.ts checks it). */
export const ACTION_KINDS = ["none", "follow", "go_to", "wait", "talk_to", "look_for", "fetch_police", "give", "stop", "receive_gift", "come_for_drink", "work_for_pay", "routine"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** What the talk reply may carry. Optional on the reply: the stub lines of the older tests have none. */
export const ActionProposalSchema = z.object({
  kind: z.enum(ACTION_KINDS),
  /** A person's name, a place name, or "". */
  target: z.string().max(60),
  /** Asked for; the engine clamps it. */
  minutes: z.number().int().min(0).max(1440),
  item: z.string().max(30),
  amount_c: z.number().int().min(0).max(100000),
  reason: z.string().max(120),
  /** M6 routines: the plan, with kind "routine" only (director/routineVocab.ts). */
  plan: RoutinePlanSchema.optional(),
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const NO_ACTION: ActionProposal = { kind: "none", target: "", minutes: 0, item: "", amount_c: 0, reason: "" };

/** Engine-made actions (events and chains) use these kinds too. */
/** M6 families: "seek" (a townsperson comes to find Jef: to talk, to thank, to settle a grievance). */
/** M6 steps (director/steps.ts): "routine", a list of steps one person works through for Jef (a treat, a hired hand). */
export type EngineKind = ActionKind | "attend" | "seek" | "routine";

/**
 * Time limits in GAME minutes (M7 clock, shared/clock.ts: a game hour is two real minutes).
 * The police follow up to two game hours (4 real minutes), others an hour and a half (3 real
 * minutes), children 45 minutes; never under 40 (80 real seconds). Before M7 (a game hour was
 * 20 real seconds) these were 720, 480, 240 and 240: about the same real time.
 * The model's own "minutes" are game minutes now (the story factor is 1), then clamped.
 */
export const FOLLOW_MAX_MIN: Record<string, number> = { police: 120, water_bailiff: 120, child: 45, street_child: 45, errand_boy: 45 };
export const FOLLOW_DEFAULT_MIN = 90;
export const FOLLOW_MIN_MIN = 40;
/** A story minute (what the model asks for) is this many game minutes (M7 clock: 12 -> 1; "half an hour" is half a game hour, one real minute). */
export const STORY_MINUTE_FACTOR = 1;
/** Jef further off than this for this long: the follower gives up. */
export const FOLLOW_LOST_M = 40;
export const FOLLOW_LOST_S = 5;
/** M7 clock (old -> new): wait 180 -> 60 (and at least 60 -> 15), look_for 240 -> 40, talk_to 240 -> 40 game minutes. */
export const WAIT_MAX_MIN = 60;
export const WAIT_MIN_MIN = 15;
export const LOOK_FOR_MIN = 40;
export const LOOK_FOR_RADIUS_M = 40;
export const TALK_TO_MIN = 40;
export const TALK_TO_MAX_LINES = 6;
export const GO_TO_MAX_M = 400;

/**
 * Fixes 2026-09-24 (Steve sent an agent from the Rijnkaai to the cathedral; he turned back
 * half way): the game minutes a walk of `d` m (straight line) may take. Streets wind (about
 * 1.4 times the straight line), a walk in view is 1.5 m/s, and a real second is half a game
 * minute (M7 clock; it was 3), so 300 m is some 140 game minutes. Out of Jef's sight they go
 * quicker; this is the deadline only. Plus `stand` minutes at the end (M7: 30 -> 10).
 */
/**
 * Steve (2026-09-24): "make people complete their task unless they are stuck, or something really
 * bad happens". An errand's time running out while they are still on it is no reason to stop:
 * the clock is a safety net only. Being stuck ends it (the client reports "blocked"); so does
 * this hard cap from the start (M7 clock: 1800 -> 360 game minutes, six game hours, 12 real
 * minutes), for a walker the client lost track of.
 */
export const ERRAND_HARD_MIN = 360;
/** The kinds that are an errand to finish (follow, wait and look_for are time by nature). */
export const ERRAND_KINDS: ReadonlySet<string> = new Set(["go_to", "talk_to", "fetch_police", "seek", "routine"]);

export function walkMinutes(d: number, stand = 10): number {
  return Math.round(gameMin((d * 1.4) / 1.5)) + stand;
}
export const TALK_TO_MAX_M = 150;
/** Actions asked in talk running at once in the whole town. */
export const MAX_TALK_ACTIONS = 3;

export const RULES_FOR_MODEL = `
ACTIONS. Jef may ask you to do something. If you would do it, say so and set action.kind; the game decides
whether it can happen and may cut it short, so never promise more than "I'll try". If you would not, say so
in character and set action.kind "none". Kinds: follow (walk with Jef), go_to (target: a place name), wait
(stay here), talk_to (target: a person's name; you go and speak to them), look_for (target: a person),
fetch_police (go and bring an agent), give (item: what, amount_c: money; you never give money except what
you yourself took from Jef), stop (stop what you were doing for him). minutes: how long you would give it.
reason: why, in a few words (say "robbed" if Jef says he was robbed or saw someone robbed). A stall or shop keeper at work will not
leave the stall; a child does no questioning of grown-ups; at night the timid stay put.
receive_gift: Jef offers you something of his (item: what it is, as he said it); set it only if you would take it.
come_for_drink: Jef asks you to a tavern for a drink he pays for (target: the tavern he names, or ""); set it only if
you would go. work_for_pay: Jef asks you to work for him for a wage (item: the work, e.g. "carry the crates", "watch
my cart"; amount_c: the wage HE named, 0 if he named none); set it only if you would do it for that. For all three the
game checks what Jef really has, what the tavern and the work are, and the money; you never name a price yourself.${ROUTINE_RULES_FOR_MODEL}`;

// ------------------------------------------------------------------ engine lines

/** Why the engine said no, and what the person says instead. */
export type RefuseReason =
  | "busy"
  | "too_many"
  | "reserved"
  | "at_stall"
  | "child"
  | "no_trust"
  | "dark"
  | "unknown_person"
  | "unknown_place"
  | "indoors"
  | "no_way"
  | "too_far"
  | "no_money"
  | "post"
  | "nothing_to_stop"
  // M6 gifts, the treat, hired hands (their lines come from their modules)
  | "gift"
  | "treat"
  | "hire"
  // M6 routines (director/routines.ts gives the line)
  | "routine";

export const REFUSE_LINE: Record<RefuseReason, string> = {
  busy: "I've my hands full already. Ask me when I'm done.",
  too_many: "Half the street's running about for you as it is. Not me, not now.",
  reserved: "I've other business today. Ask someone else.",
  at_stall: "And leave the stall? Not likely. Ask me after hours.",
  child: "Ask them yourself, mister. They won't listen to me.",
  no_trust: "I don't know you well enough for that.",
  dark: "Not in the dark. Not for anyone.",
  unknown_person: "I don't know anyone by that name.",
  unknown_place: "I don't know where that is.",
  indoors: "They're indoors now. Come back when they're about.",
  no_way: "There's no way through there on foot.",
  too_far: "That's the other end of town. Not now.",
  no_money: "My money stays in my pocket.",
  post: "I can't leave my post. Ask someone with time on their hands.",
  nothing_to_stop: "I wasn't doing anything for you.",
  gift: "No, thank you.",
  treat: "Not today, thank you.",
  hire: "Not for that, no.",
  routine: "Not that errand, no.",
};

/** What the person adds when the engine sets a limit (story time is game time since M7). */
export function limitLine(kind: ActionKind, minutes: number, police: boolean): string {
  const h = minutes / STORY_MINUTE_FACTOR / 60;
  const span = h >= 2.5 ? "three hours" : h >= 1.75 ? "two hours" : h >= 0.9 ? "an hour" : "half an hour";
  switch (kind) {
    case "follow":
      return police ? `Lead on. I'll give it ${span}, then I've a beat to walk.` : `I can spare you ${span}, no more.`;
    case "go_to":
      return "I'll go. Don't make me wait there all day.";
    case "wait":
      return `I'll wait ${span}. Then I'm off.`;
    case "talk_to":
      return "I'll go and have a word.";
    case "look_for":
      return `I'll have a look about. ${span[0].toUpperCase() + span.slice(1)}, then I've my own business.`;
    case "fetch_police":
      return "I'll find an agent. Stay where you are.";
    default:
      return "";
  }
}

/** The engine line when an action ends. */
export const END_LINE: Record<string, string> = {
  follow_time: "That's my time. I'm off.",
  follow_lost: "Where's he gone? Well. That's that.",
  follow_water: "I'm not going in there.",
  follow_blocked: "I can't get through there. You go on.",
  go_to_time: "Too far for me today. I've turned back.",
  go_to_arrived: "Here I am, as you asked.",
  wait_time: "That's long enough. I'm off.",
  look_for_time: "Not a sign. I've looked enough.",
  look_for_found: "There! That's the one.",
  talk_to_time: "Couldn't find them. Another time.",
  talk_to_done: "I've had my word with them.",
  fetch_police_time: "No agent to be found. Sorry.",
  stopped: "All right. As you like.",
  attend_done: "",
};

/** The engine's own words for a conversation when the model is late or over budget. */
export const CONVO_FALLBACK: Record<string, Array<(a: string, b: string) => string>> = {
  chat: [
    (a) => `${a}: Cold one today.`,
    (_a, b) => `${b}: It is. The fog gets into everything.`,
    (a) => `${a}: Mind how you go, then.`,
  ],
  question: [
    (a, b) => `${a}: A word, ${b}. Where were you last night?`,
    (_a, b) => `${b}: Minding my own business. Same as always.`,
    (a) => `${a}: We'll see about that.`,
  ],
  question_guilty: [
    (a, b) => `${a}: Empty your sleeves, ${b}. A man says you had his purse in the dark.`,
    (_a, b) => `${b}: I never. All right, all right. Here. It's all there.`,
    (a) => `${a}: It had better be. Next time it's the cell.`,
  ],
  question_innocent: [
    (a, b) => `${a}: A word, ${b}. A man says you robbed him in the dark.`,
    (_a, b) => `${b}: Me? I was nowhere near. Ask anyone. He's a liar, that one.`,
    (a) => `${a}: Then keep your nose clean and we'll say no more.`,
  ],
  street_guilty: [
    (a, b) => `${a}: A word, ${b}. You were seen with a purse that was not yours, in the street.`,
    (_a, b) => `${b}: Seen by who? All right. All right. Here, the lot of it.`,
    (a) => `${a}: It goes back to its owner. Next time it's the cell.`,
  ],
  street_innocent: [
    (a, b) => `${a}: A word, ${b}. A purse went missing in the street.`,
    (_a, b) => `${b}: And you come to me? I was nowhere near it.`,
    (a) => `${a}: Then we'll say no more.`,
  ],
  invite: [
    (a, b) => `${a}: ${b}, you're needed. Come along.`,
    (_a, b) => `${b}: What now? All right. Lead the way.`,
  ],
  argue: [
    (a, b) => `${a}: That's my pitch, ${b}, and you know it.`,
    (_a, b) => `${b}: Your pitch? Your grandmother's pitch, maybe.`,
    (a) => `${a}: Say that again and see what you get.`,
    (_a, b) => `${b}: Go on then. In front of everyone.`,
  ],
  complaint: [
    (a, b) => `${a}: Agent ${b}, a word. There's a man called Jef who wants talking to.`,
    (_a, b) => `${b}: Does he. What's he done?`,
    (a) => `${a}: Ask him yourself. My family won't stand for it.`,
    (_a, b) => `${b}: I'll have a word with him. No more than that, mind.`,
  ],
  report: [
    (a, b) => `${a}: Agent ${b}. There's a man on the quay says he's been robbed.`,
    (_a, b) => `${b}: Is there. Show me where.`,
  ],
};

// ------------------------------------------------------------------ events

/** M7 funeral: "enter" (the gathered go into a hall that stands in the world: the cathedral) and "depart" (the leads leave town, the rest go home). */
export const STAGE_OPS = ["gather", "procession", "sound", "props", "talk", "notice", "rumour", "price", "close", "open", "job", "weather", "scuffle", "robbery", "enter", "depart"] as const;
export type StageOp = (typeof STAGE_OPS)[number];
export const EVENT_SOUNDS = ["none", "bells", "music", "murmur", "handbell"] as const;
export type EventSound = (typeof EVENT_SOUNDS)[number];
/**
 * Sound cues (Steve, 2026-09-24: "let AI create sounds at events"). The model composes the sound of a
 * stage from this palette: what is heard, how often, how high, how loud. The engine makes every sound
 * itself (client/src/audio/eventcues.ts: voices, a fiddle, a drum, glass, wood, fire, made in code; the
 * bells, hooves, a dog and so on from the CC0 recordings already in the game). Nothing is recorded new,
 * and no text is ever sung: the voices sing vowels only.
 */
export const CUE_SOURCES = [
  // people
  "cheer",
  "laughter",
  "applause",
  "shout",
  "cry",
  "hymn",
  "murmur",
  // music
  "fiddle",
  "drum",
  "whistle",
  // things
  "glass",
  "clatter",
  "crackle",
  "handbell",
  "bell",
  "ship_bell",
  "chain",
  "anvil",
  "pump",
  "steam_whistle",
  // animals and carts
  "horse",
  "hooves",
  "wheels",
  "dog",
] as const;
export type CueSource = (typeof CUE_SOURCES)[number];
export const CueSchema = z.object({
  source: z.enum(CUE_SOURCES),
  /** Seconds between repeats; 0: once, at the start of the stage. The engine clamps it. */
  every_s: z.number(),
  /** 1 is the natural pitch; the engine clamps it. */
  pitch: z.number(),
  /** 0 to 1; the engine clamps it. */
  level: z.number(),
});
export type Cue = z.infer<typeof CueSchema>;
export const CUES_PER_STAGE = 4;
export const CUE_EVERY_MIN_S = 2;
export const CUE_EVERY_MAX_S = 45;
export const CUE_PITCH_MIN = 0.6;
export const CUE_PITCH_MAX = 1.5;
export const CUE_LEVEL_MIN = 0.15;
export const CUE_LEVEL_MAX = 1;

/** The engine's clamp of a model's (or a template's) cues: unknown sources dropped, numbers held, at most four. */
export function cleanCues(raw: unknown): Cue[] {
  if (!Array.isArray(raw)) return [];
  const out: Cue[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const p = CueSchema.safeParse(c);
    if (!p.success || seen.has(p.data.source)) continue;
    seen.add(p.data.source);
    const n = (v: number, lo: number, hi: number, dflt: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
    const every = Number.isFinite(p.data.every_s) && p.data.every_s <= 0 ? 0 : n(p.data.every_s, CUE_EVERY_MIN_S, CUE_EVERY_MAX_S, 12);
    out.push({ source: p.data.source, every_s: Math.round(every * 10) / 10, pitch: Math.round(n(p.data.pitch, CUE_PITCH_MIN, CUE_PITCH_MAX, 1) * 100) / 100, level: Math.round(n(p.data.level, CUE_LEVEL_MIN, CUE_LEVEL_MAX, 0.6) * 100) / 100 });
    if (out.length >= CUES_PER_STAGE) break;
  }
  return out;
}
export const EVENT_PROPS = ["none", "crates", "barrels", "sacks", "flowers", "black_cloth"] as const;
export type EventProp = (typeof EVENT_PROPS)[number];
export const GATHER_ROLES = ["guests", "mourners", "crowd", "sellers", "musicians", "police", "children", "family"] as const;
export type GatherRole = (typeof GATHER_ROLES)[number];
export const MOOD_WORDS = ["joy", "solemn", "lively", "tense", "curious", "calm"] as const;

/**
 * M4b: lead roles. A stage may name 1 to 4 leads; the ENGINE picks the resident for each
 * (sex, age, trade; the bride and groom a courting pair) and the client dresses them from a
 * fixed wardrobe (client/src/game/wardrobe.ts). "bearers" is one lead that brings four men
 * and a coffin. The police agent of a scuffle or a robbery is the engine's own ("agent").
 */
export const LEAD_ROLES = [
  "bride",
  "groom",
  "priest",
  "organ_grinder",
  "fiddler",
  "accordionist",
  "auctioneer",
  "speaker",
  "drunkard",
  "pickpocket",
  "victim",
  "widow",
  "bearers",
  "hawker",
  "showman",
  "quarreller",
  // M7 night: a man who lands goods by night (a boatman, a sailor, a docker)
  "smuggler",
] as const;
export type LeadRole = (typeof LEAD_ROLES)[number] | "agent";
export const LEADS_PER_STAGE = 4;
export const BEARERS = 4;
/** What a role is called in a notice or a rumour. */
export const LEAD_LABEL: Record<LeadRole, string> = {
  bride: "the bride",
  groom: "the groom",
  priest: "the priest",
  organ_grinder: "the organ grinder",
  fiddler: "the fiddler",
  accordionist: "the accordion player",
  auctioneer: "the auctioneer",
  speaker: "the speaker",
  drunkard: "a drunk",
  pickpocket: "the pickpocket",
  victim: "the one robbed",
  widow: "the widow",
  bearers: "the bearers",
  hawker: "the hawker",
  showman: "the showman",
  quarreller: "one of the quarrellers",
  smuggler: "a smuggler",
  agent: "the police agent",
};

/** A stage as the model may write it: flat, every field present, the engine ignores what the op does not use. */
export const StageSchema = z.object({
  op: z.enum(STAGE_OPS),
  /** Numbers are clamped by the engine (scheduler.ts cleanStages), never rejected. */
  minutes: z.number(),
  place: z.string().max(40),
  role: z.enum(GATHER_ROLES),
  count: z.number(),
  sound: z.enum(EVENT_SOUNDS),
  mood: z.enum(MOOD_WORDS),
  props: z.enum(EVENT_PROPS),
  text: z.string().max(160),
  item: z.string().max(30),
  factor: z.number(),
  /** M4b: the leads of this stage (1-4, or none). The engine picks who; extra ones are dropped. */
  leads: z.array(z.enum(LEAD_ROLES)).max(8),
  /** The sound of the stage, composed by the model from the palette (cleanCues clamps it). Old stored stages have none. */
  cues: z.array(CueSchema).max(8).optional(),
});
export type Stage = z.infer<typeof StageSchema>;

export const STAGE_MIN_MIN = 5;
/** A stage up to three game hours (the ballad singer's slot); M7 clock: kept at 180. */
export const STAGE_MAX_MIN = 180;
export const EVENT_MAX_STAGES = 6;
/** An event in all (game minutes; M7 clock: 600 -> 240, four game hours, eight real minutes). */
export const EVENT_MAX_MIN = 240;
export const GATHER_MIN = 2;
/** Steve, 2026-09-24: "should there not be hordes of people come for a wedding?" (the number lives in config.ts) */
export const GATHER_MAX = EVENT_GATHER_MAX;
/** M4b: the most one event takes of the town, the leads and every gathering together (config.ts). */
export const EVENT_PEOPLE_MAX = PEOPLE_MAX;
export const PRICE_MIN = 0.5;
export const PRICE_MAX = 3;
/** Events may not share a place, stand within this of each other, or share a person, with a cleanup margin. */
export const EVENT_NEAR_M = 60;
export const EVENT_MARGIN_MIN = 20;
export const EVENTS_AT_ONCE = 2;
export const EVENTS_PER_DAY = 4;
/** The client claims an event's people only while Jef is within this. */
export const EVENT_CLAIM_M = 70;

// ------------------------------------------------------------------ M4b: the scenes (no combat)

/** A scuffle or a robbery: the police agent on duty comes if one is within this. */
export const SCENE_POLICE_M = 260;
/** A robbery: the purse by the victim's trade, in centimes (the engine's numbers). */
export const PURSE_RICH_C: [number, number] = [40, 90];
export const PURSE_POOR_C: [number, number] = [8, 35];
export const RICH_TRADES = ["merchant", "clerk", "fish_merchant", "brewer", "draper", "pawnbroker", "grocer", "tobacconist", "chandler"];
/** Jef within this of a robbery saw it (the police will listen to him). */
export const WITNESS_M = 45;
/** The chance the police catch a street thief when an agent is near (the engine's roll). */
export const CATCH_CHANCE = 0.5;

/** The engine's own words in a scene (the client shows them as bubbles at the right moment). */
export const SCENE_LINES = {
  shout: ["Thief! Stop him, he has my purse!", "My purse! Stop that one!", "Hey! Thief! Somebody stop him!"],
  caught: ["Got you. Hand it over, and walk with me.", "Not so fast. Turn your pockets out."],
  escaped: ["Gone. Into the alleys, like a rat.", "Lost him. I know that face, though."],
  part: ["Enough! Break it up, the pair of you.", "That will do! Step apart, or it's the cell for both."],
  sorry: ["All right, all right. I was in the wrong.", "Fine. I'll go. But he knows what he said."],
};

/**
 * Words the director may not use: no weapons, no killing, nobody hurt (the project has no
 * combat). An event that carries them is refused whole.
 */
export const VIOLENCE_RE =
  /\b(kill(s|ed|er|ing)?|murder\w*|stab\w*|shoot\w*|shot dead|guns?|gunfire|pistols?|revolvers?|rifles?|muskets?|knife|knives|daggers?|swords?|blades?|cudgels?|clubbed|clubbing|bludgeon\w*|strangl\w*|throttl\w*|blood\w*|wound\w*|injur\w*|beat (him|her|them) up|beaten up|beaten to|riot\w*|hanged|corpse|weapons?|dead body|bodies)\b/i;
/** Softer words the engine cleans instead: the scene is a scuffle, a shove, never a fight. */
export const SOFTEN: Array<[RegExp, string]> = [
  [/\bfist ?fights?\b/gi, "scuffle"],
  [/\bfights?\b/gi, "scuffle"],
  [/\bfighting\b/gi, "scuffling"],
  [/\bfought\b/gi, "scuffled"],
  [/\bbrawl(s)?\b/gi, "scuffle$1"],
  [/\bbrawling\b/gi, "scuffling"],
  [/\bpunches\b/gi, "shoves"],
  [/\bpunched\b/gi, "shoved"],
  [/\bpunch\b/gi, "shove"],
  [/\bcame to blows\b/gi, "came to shoving"],
];
/** A sentence that hands Jef money or goods: the engine strips it (only jobs and shops pay). */
export const MONEY_TO_JEF_RE =
  /[^.!?]*\b(jef|the player)\b[^.!?]*\b(gets?|receives?|is given|given|finds?|wins?|earns?|paid|rewarded|rewards?)\b[^.!?]*\b(centimes?|francs?|coins?|money|purse|reward|gold)\b[^.!?]*[.!?]?/gi;

export const PRIMITIVES_FOR_MODEL = `
STAGES. An event is 1-6 stages, played one after the other, each for "minutes" game minutes (5-180, ${EVENT_MAX_MIN} in all).
A game hour is two real minutes; give each stage the time it would really take: a gathering 15-30 minutes so people
can walk there, a talk 15-20, a procession 30-45, a mass or a requiem inside 45-60, a sound 15-30, a scuffle or a
robbery 20-30, street music an hour or two. A whole event is usually one to three game hours.
Every stage has every field; fill the ones the op uses and put "" / 0 / "none" / [] in the rest.
- gather: role (guests, mourners, crowd, sellers, musicians, police, children, family), count 0-${EVENT_GATHER_MAX}, place, leads.
  People walk to a ring round the place; the leads stand in the middle. One event takes ${PEOPLE_MAX} people at most in all.
  A wedding, a big fire or a ship leaving draws 50 to ${PEOPLE_MAX}; a quarrel a dozen or two; street music twenty or thirty.
- procession: everyone walks in a column to "place"; the stage's leads walk first (the groom and the bride arm in arm, the
  bearers with the coffin). Give it a sound if they sing or a bell goes before them.
- sound: bells, music, murmur or handbell at the place, with a mood word.
- props: crates, barrels, sacks, flowers or black_cloth set out at the place.
- talk: two people talk in the street (a few lines the town hears): the stage's two leads if it names two, else two of the
  gathered. text: what about.
- notice: text pinned up in the town (the townspeople will mention it).
- rumour: text the town will repeat afterwards.
- price: item (herring, eel, bread, apple, beer, jenever, biscuit) at factor 0.5-3 until the event ends.
- close / open: a shop, stall or tavern by place id, until the event ends.
- job: a piece of work for Jef goes on the board (the engine writes it and pays it).
- weather: the sky changes (fog, mist, clear, rain, storm) for the rest of the day; at most once a day.
- scuffle: two leads (quarreller and quarreller, or quarreller and drunkard) argue, then push and shove; a crowd forms; the
  police agent on duty comes and parts them. text: what they fell out over. The engine decides who was in the wrong.
  Nobody is hurt, nobody has a weapon.
- robbery: leads pickpocket and victim. The pickpocket lifts the victim's purse in the street, the victim shouts, the thief
  runs, the police may give chase. The engine decides the sum and whether he is caught. Never Jef's purse.
- enter: everyone of the event but the onlookers (role crowd) goes in through the door where the event stands now, the
  stage's leads first, and takes part inside; they come out again at the next stage. Only cathedral_west has a hall to go
  into: a wedding's vows at the altar rail, a funeral's requiem with the coffin before the choir. Give it 150-180 minutes.
- depart: the stage's leads (bearers: the coffin goes on a black hearse; the widow; a groom and bride) and their own family
  leave town along the road to "place": kiel_road (south, to the Kiel cemetery), east_road or north_road. Everyone else
  stands about in small groups for a while, talking low, and goes home. The event ends when the stage does. 150-180 minutes.
A funeral: gather mourners at house with leads [widow, bearers]; procession to cathedral_west with leads [bearers, widow]
and a tolling bell; enter with leads [priest]; depart to kiel_road with leads [bearers, widow].
LEADS (1-4 a stage; the engine picks who): bride, groom, priest (a wedding: all three; the couple walk first), organ_grinder,
fiddler, accordionist (street music), auctioneer (a sale: a handbell and a board), speaker (a preacher or a man with a
paper), drunkard (a bottle), pickpocket, victim, widow (a funeral), bearers (four men with a coffin), hawker (a tray of
wares), showman (a monkey on his shoulder), quarreller, smuggler (a man landing goods by night). Name a lead in the notice or the rumour as {bride}, {groom},
{victim} and so on; the engine puts in the real name. Never write a person's name yourself.
Any stage may also carry a sound and a mood while it runs.
CUES: every stage also has "cues", the sound of it as the town hears it: 0-4 cues from this palette, each
{source, every_s, pitch, level}. source: cheer, laughter, applause, shout, cry (a child), hymn (a few voices singing,
slow), murmur, fiddle, drum, whistle, glass (a bottle breaks), clatter (wood, chests, a stall), crackle (fire), handbell,
bell (the big bell, one stroke), ship_bell, chain, anvil, pump, steam_whistle, horse (a neigh), hooves, wheels, dog.
every_s: seconds between repeats (2-45), or 0 for once at the start of the stage. pitch: 0.6-1.5 (1 is natural).
level: 0.15-1. Compose what the scene would really sound like: a wedding crowd cheers now and then and a fiddle plays;
at an auction a man shouts and a bell rings; at a fire the flames crackle, the pump works and a horse frets; at a
funeral, the handbell and the big bell tolling slowly and low (bell, every_s 8, pitch 0.7), the death knell. Use [] for a
stage that makes no sound of its own.`;
