import { z } from "zod";

// The vocabulary of M4: what a townsperson may be asked to do (an action), what
// the engine says when it refuses or sets a limit, the primitives an event is
// made of, and the words the engine uses when the model is late. The engine
// owns every number here; the model only proposes (docs/03 rule one).

// ------------------------------------------------------------------ actions

export const ACTION_KINDS = ["none", "follow", "go_to", "wait", "talk_to", "look_for", "fetch_police", "give", "stop"] as const;
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
});
export type ActionProposal = z.infer<typeof ActionProposalSchema>;

export const NO_ACTION: ActionProposal = { kind: "none", target: "", minutes: 0, item: "", amount_c: 0, reason: "" };

/** Engine-made actions (events and chains) use these kinds too. */
export type EngineKind = ActionKind | "attend";

/**
 * Time limits in GAME minutes. The clock runs fast (a game hour is 20 real seconds; a walk
 * across town is several game hours), so these are large: the police follow up to 720 game
 * minutes (4 real minutes), others 480 (160 s), children 240 (80 s); never under 240 (80 s).
 * The model's own "minutes" are story minutes: the engine takes them times twelve, then clamps.
 */
export const FOLLOW_MAX_MIN: Record<string, number> = { police: 720, water_bailiff: 720, child: 240, street_child: 240, errand_boy: 240 };
export const FOLLOW_DEFAULT_MIN = 480;
export const FOLLOW_MIN_MIN = 240;
/** A story minute (what the model asks for) is this many game minutes: "half an hour" walks two real minutes. */
export const STORY_MINUTE_FACTOR = 12;
/** Jef further off than this for this long: the follower gives up. */
export const FOLLOW_LOST_M = 40;
export const FOLLOW_LOST_S = 5;
export const WAIT_MAX_MIN = 180;
export const LOOK_FOR_MIN = 240;
export const LOOK_FOR_RADIUS_M = 40;
export const TALK_TO_MIN = 240;
export const TALK_TO_MAX_LINES = 6;
export const GO_TO_MAX_M = 400;
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
reason: why, in a few words (say "robbed" if Jef says he was robbed). A stall or shop keeper at work will not
leave the stall; a child does no questioning of grown-ups; at night the timid stay put.`;

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
  | "nothing_to_stop";

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
};

/** What the person adds when the engine sets a limit (in story time: four game minutes to one). */
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
  go_to_time: "I've stood here long enough.",
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
  report: [
    (a, b) => `${a}: Agent ${b}. There's a man on the quay says he's been robbed.`,
    (_a, b) => `${b}: Is there. Show me where.`,
  ],
};

// ------------------------------------------------------------------ events

export const STAGE_OPS = ["gather", "procession", "sound", "props", "talk", "notice", "rumour", "price", "close", "open", "job", "weather"] as const;
export type StageOp = (typeof STAGE_OPS)[number];
export const EVENT_SOUNDS = ["none", "bells", "music", "murmur", "handbell"] as const;
export type EventSound = (typeof EVENT_SOUNDS)[number];
export const EVENT_PROPS = ["none", "crates", "barrels", "sacks", "flowers", "black_cloth"] as const;
export type EventProp = (typeof EVENT_PROPS)[number];
export const GATHER_ROLES = ["guests", "mourners", "crowd", "sellers", "musicians", "police", "children", "family"] as const;
export type GatherRole = (typeof GATHER_ROLES)[number];
export const MOOD_WORDS = ["joy", "solemn", "lively", "tense", "curious", "calm"] as const;

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
});
export type Stage = z.infer<typeof StageSchema>;

export const STAGE_MIN_MIN = 5;
export const STAGE_MAX_MIN = 120;
export const EVENT_MAX_STAGES = 6;
export const EVENT_MAX_MIN = 240;
export const GATHER_MIN = 2;
export const GATHER_MAX = 16;
export const PRICE_MIN = 0.5;
export const PRICE_MAX = 3;
/** Events may not share a place, stand within this of each other, or share a person, with a cleanup margin. */
export const EVENT_NEAR_M = 60;
export const EVENT_MARGIN_MIN = 20;
export const EVENTS_AT_ONCE = 2;
export const EVENTS_PER_DAY = 4;
/** The client claims an event's people only while Jef is within this. */
export const EVENT_CLAIM_M = 70;

export const PRIMITIVES_FOR_MODEL = `
STAGES. An event is 1-6 stages, played one after the other, each for "minutes" game minutes (5-120, 240 in all).
The clock runs fast: a stage under 30 minutes is over in a blink; give a gathering 60-120 minutes so people can arrive.
Every stage has every field; fill the ones the op uses and put "" / 0 / "none" in the rest.
- gather: role (guests, mourners, crowd, sellers, musicians, police, children, family), count 2-16, place. People walk to a ring round the place.
- procession: the gathered people walk in a column to "place". Give the stage a sound if they sing or a bell goes before them.
- sound: bells, music, murmur or handbell at the place, with a mood word.
- props: crates, barrels, sacks, flowers or black_cloth set out at the place.
- talk: two of the gathered people talk in the street (a few lines the town can hear). text: what about.
- notice: text pinned up in the town (the townspeople will mention it).
- rumour: text the town will repeat afterwards.
- price: item (herring, eel, bread, apple, beer, jenever, biscuit) at factor 0.5-3 until the event ends.
- close / open: a shop, stall or tavern by place id, until the event ends.
- job: a piece of work for Jef goes on the board (the engine writes it).
- weather: the sky changes (fog, mist, clear, rain, storm) for the rest of the day; at most once a day.
Any stage may also carry a sound and a mood while it runs.`;
