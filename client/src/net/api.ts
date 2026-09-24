// Client side of the game server. The server owns all numbers;
// the client shows them and reports what happened in 3D.

import type { Goods } from "../game/props";

export type Twist = "none" | "broken_goods" | "stranger_offer" | "foreman_watches" | "thick_fog" | "heavy_load" | "thief" | "bribe";

export interface Progress {
  delivered: number;
  lost: number;
  sold: number;
}

export interface CarryTask {
  kind: "carry";
  goods: Goods;
  count: number;
  from: string;
  to: string;
  twist: Twist;
  limit_s: number | null;
  progress?: Progress;
}
export interface WatchTask {
  kind: "watch";
  goods: Goods;
  post: string;
  duration_s: number;
  twist: Twist;
}
export interface DeliverTask {
  kind: "deliver";
  goods: Goods;
  from: string;
  to: string;
  recipient: string;
  twist: Twist;
  limit_s: number | null;
  progress?: Progress;
}
/** M6 (server paper/post.ts): a round of letters, or a telegram to send; the server marks each stop done. */
export interface RoundStop {
  id: string;
  name: string;
  x: number;
  z: number;
  what: "door" | "telegraph";
  done?: boolean;
}
export interface LettersTask {
  kind: "letters";
  goods: "letters";
  from: { x: number; z: number; label: string };
  stops: RoundStop[];
  fee_c: number;
  words?: string;
  city?: string;
  picked?: boolean;
  twist: "none";
  limit_s: null;
  progress?: Progress;
}
export type Task = CarryTask | WatchTask | DeliverTask | LettersTask;

/** What happened in 3D, sent when a job ends. The server turns it into money. */
export interface Report {
  delivered?: number;
  lost?: number;
  sold?: number;
  pocketed?: boolean;
  late?: boolean;
  left_post_s?: number;
  thief?: "none" | "chased" | "stole";
  bribe_taken?: boolean;
  seen_away?: boolean;
}

export interface Settlement {
  pay_c: number;
  extra_c: number;
  trust_delta: number;
  caught: boolean;
  status: "done" | "failed";
  facts: string[];
}

export interface Job {
  id: number;
  title: string;
  employer_npc: string;
  employer_name: string;
  task_type: string;
  pay_c: number;
  risk: string;
  pitch: string;
  task: Task | null;
  source: string;
  status: "offered" | "taken" | "done" | "failed";
  playable: boolean;
  outcome_text: string | null;
}

export interface Player {
  name: string;
  money_c: number;
  day: number;
  hour: number;
  food: number;
  warmth: number;
  health: number;
  sleep: number;
}

export interface PocketItem {
  id: number;
  kind: string;
  name: string;
  job_id: number | null;
  /** M6: the paper's day, the letter or the pawn ticket this pocket row is. */
  ref?: number | null;
  use: string | null;
  note: string | null;
}

export interface Ware {
  kind: string;
  name: string;
  price_c: number;
}

export interface Clock {
  day: number;
  hour: number;
  minute: number;
  weekday: string;
  weather: "fog" | "mist" | "clear" | "rain" | "storm";
}

export interface Ending {
  kind: "week" | "health";
  day: number;
  epilogue?: { title: string; paragraphs: string[] };
}

export interface Night {
  where: "bed" | "rough" | "home";
  /** M6 homes: the home Jef slept in. */
  place?: string;
  home?: string;
  turnedAway: boolean;
  summary: string[];
  day: number;
  ended?: Ending;
}

export interface JobsPayload {
  board: { state: "writing" | "ready"; source?: string; error?: string };
  jobs: Job[];
  player: Player;
  pockets: PocketItem[];
  clock: Clock;
  rent: { paid: boolean; price_c: number; bedtime: number };
  ending: Ending | null;
  /** The omnibuses (M3g): the ride you are on (null: none, or the ticket ran out), the fare, a free change you could make. */
  ride?: { on: { line: string; from: string; minutes: number; left: number } | null; fare_c: number; change: { from_line: string } | null };
}

/** What an NPC says. Trust stays on the server (docs/08: hidden). */
export interface TalkLine {
  npc_line?: string;
  mood?: string;
  choices?: string[];
  end?: boolean;
  gated?: string | null;
  /** M6: how a haggle or a story to the police went down, in words ("She seems to believe you"). Never a number. */
  note?: string;
  /** M6: the seller's prices after a haggle (a price agreed today shows here). */
  wares?: Ware[];
}

// ---- the town (M3e). The server made it; the client walks it by the game clock.

export type Pt = [number, number];
export type Act = "home" | "work" | "tavern" | "play" | "market" | "church" | "stroll" | "loiter";
export type Seg = [number, number, Act, string?];
export type WorkKind = "haul" | "stall" | "shop" | "tavern" | "patrol" | "roam" | "inside" | "beg" | "post" | "guard" | "inspect" | "wait";

export interface WorkSpec {
  place: string;
  kind: WorkKind;
  at?: [number, number, number];
  a?: Pt;
  b?: Pt;
  route?: Pt[];
  /** Inspect (customs): which way to face at each point of the route. */
  faces?: number[];
  door?: Pt;
  stall?: number;
  shop?: string;
  /** Wait (M6 emigrants): sit at `at` (on the family's chest), else stand there. */
  seat?: boolean;
}

export interface TownResident {
  id: string;
  name: string;
  first: string;
  age: number;
  sex: "m" | "f";
  kind: string;
  trade: string;
  label: string;
  household: number;
  role: string;
  home: { house: number; x: number; z: number; sx: number; sz: number };
  work: WorkSpec;
  sched: { day: Seg[]; sunday: Seg[] };
  dog: { name: string; look: string } | null;
  /** The garrison: the comrade he walks out or stands guard with (server town/garrison.ts). */
  mate?: string | null;
  wares: Ware[];
}

export interface TownPlace {
  label: string;
  x: number;
  z: number;
  r: number;
  district: string;
  door?: Pt;
  out?: Pt;
}

export interface TownStall {
  place: string;
  x: number;
  z: number;
  face: Pt;
  goods: string;
  keeper: string | null;
}

export interface TownShop {
  id: string;
  label: string;
  door: Pt;
  wall: Pt;
  out: Pt;
  goods: string | null;
  keeper: string;
}

export interface TownData {
  seed: number;
  places: Record<string, TownPlace>;
  stalls: TownStall[];
  shops: TownShop[];
  employers: Array<{ id: string; spot: string }>;
  residents: TownResident[];
}

// ---- M4: townspeople who act, conversations in the street, the director's events

export interface PublicAction {
  id: number;
  npc: string;
  name: string;
  kind: "none" | "follow" | "go_to" | "wait" | "talk_to" | "look_for" | "fetch_police" | "give" | "stop" | "attend";
  target: string;
  target_name: string | null;
  target_x: number | null;
  target_z: number | null;
  source: "talk" | "director" | "event" | "engine";
  event_id: number | null;
  phase: string;
  until: number;
  max_m: number;
  order: number;
  /** attend: guests, crowd (onlookers), mourners ... ("lead" for a lead). */
  role: string | null;
  /** M4b attend: the lead's part (bride, groom, fiddler, pickpocket, agent ...), else null. */
  lead: string | null;
  /** M4b bearers: which of the four. */
  n: number;
  minutes_left: number;
}
export interface ConvoLine {
  who: string;
  name: string;
  text: string;
}
export interface Convo {
  id: number;
  a: string;
  b: string;
  a_name: string;
  b_name: string;
  purpose: string;
  lines: ConvoLine[];
  source: string;
  outcome: string;
  at: number;
  event_id: number | null;
}
export interface EventStage {
  op: string;
  minutes: number;
  sound: "none" | "bells" | "music" | "murmur" | "handbell";
  mood: string;
  props: "none" | "crates" | "barrels" | "sacks" | "flowers" | "black_cloth";
  x: number;
  z: number;
  label: string;
  text: string;
  count: number;
  leads: string[];
}
/** M4b: a scuffle or a robbery as the engine set it up (director/scenes.ts). */
export interface EventScene {
  kind: "scuffle" | "robbery";
  a: string;
  b: string;
  agent: string | null;
  wrong: string | null;
  caught: boolean | null;
  flee: { x: number; z: number } | null;
  lines: { shout?: string; agent?: string; sorry?: string };
  resolved: boolean;
}
export interface EventLead {
  role: string;
  id: string;
  name: string;
  n: number;
}
export interface TownEvent {
  id: number;
  title: string;
  template: string;
  place: string;
  x: number;
  z: number;
  r: number;
  status: "planned" | "running" | "done" | "cancelled";
  stage: number;
  stages: EventStage[];
  people: string[];
  /** M4b: the leads with their parts, and the scene now playing. */
  leads: EventLead[];
  scene: EventScene | null;
  /** Game minutes left in the stage now playing. */
  stage_left: number;
  starts_in: number;
  ends_in: number;
  source: string;
  /** M6 town life: the engine's act per stage, and what the fire or the hiring set up (game/townlife.ts). */
  acts?: Array<string | null>;
  fire?: import("../game/townlife").FireView | null;
  hiring?: import("../game/townlife").HiringView | null;
}
export interface ActionsPayload {
  actions: PublicAction[];
  convos: Convo[];
  events: TownEvent[];
  closed: string[];
}
/** Anything else the server pushes (M4: actions, events, convo). */
export type PushMsg = { type: string } & Record<string, unknown>;

async function call<T>(method: string, url: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export const api = {
  jobs: () => call<JobsPayload>("GET", "/api/jobs"),
  take: (id: number) => call<{ job: Job }>("POST", `/api/jobs/${id}/take`),
  npcs: () => call<Array<{ id: string; name: string; role: string; wares: Ware[] }>>("GET", "/api/npcs"),
  buy: (npc: string, kind: string) => call<JobsPayload & { line: string; price_c: number }>("POST", "/api/buy", { npc, kind }),
  /** M6: argue the price of a ware in your own words; the seller's line, a note, and the prices now. */
  haggle: (npc: string, kind: string, text: string) => call<TalkLine>("POST", `/api/npc/${npc}/haggle`, { kind, text }, 30_000),
  use: (id: number) => call<JobsPayload & { text: string }>("POST", "/api/use", { id }),
  handover: (jobId: number) => call<JobsPayload>("POST", `/api/jobs/${jobId}/handover`),
  near: (npc: string) => call<{ ok: boolean }>("POST", `/api/npc/${npc}/near`),
  talk: (npc: string, kind: "open" | "choice" | "free", text?: string) =>
    call<TalkLine>("POST", `/api/npc/${npc}/talk`, { kind, text }, 30_000),
  witness: (npc: string, event: "took" | "returned") => call<{ ok: boolean }>("POST", `/api/npc/${npc}/witness`, { event }),
  progress: (id: number, p: Progress) => call<{ job: Job }>("POST", `/api/jobs/${id}/progress`, p),
  tick: () => call<JobsPayload & { advanced: boolean; night?: Night; ended?: Ending }>("POST", "/api/tick"),
  sleep: () => call<JobsPayload & { night: Night }>("POST", "/api/sleep"),
  rent: () => call<JobsPayload & { paid: boolean; text: string }>("POST", "/api/rent"),
  /** Fell into the Schelde: the server takes the cold off your warmth (once per swim). */
  swim: () => call<JobsPayload & { cold: boolean }>("POST", "/api/swim"),
  /** The horse omnibuses (M3g): get on a line at a stop (the server takes the fare, or a change is free) or get off. */
  ride: (action: "board" | "alight" | "seat", stop: string, line?: string, place?: "inside" | "roof") =>
    call<JobsPayload & { text: string; fare_c?: number; change?: boolean }>("POST", "/api/ride", { action, stop, line, place }),
  newGame: () => call<JobsPayload>("POST", "/api/new-game"),
  devSet: (v: Partial<Record<"day" | "hour" | "minute" | "food" | "warmth" | "health" | "sleep" | "money_c", number>>) =>
    call<JobsPayload>("POST", "/api/dev/set", v),
  town: () => call<TownData>("GET", "/api/town", undefined, 15_000),
  pick: (id: string) => call<JobsPayload & { took_c: number; felt: boolean; text: string }>("POST", `/api/resident/${id}/pick`),
  catchThief: (id: string) => call<JobsPayload & { back_c: number; text: string }>("POST", `/api/resident/${id}/catch`),
  done: (id: number, report: Report) =>
    call<{ job: Job; settlement: Settlement; money_c: number }>("POST", `/api/jobs/${id}/done`, report),
  // M4
  actions: () => call<ActionsPayload>("GET", "/api/actions"),
  actionsSync: (body: { x: number; z: number; people: Array<{ id: string; x: number; z: number }> }) => call<{ ok: boolean }>("POST", "/api/actions/sync", body),
  actionReport: (id: number, body: { phase: "arrived" | "lost" | "blocked" | "done"; x?: number; z?: number; found?: boolean; why?: string }) =>
    call<JobsPayload & { action: PublicAction }>("POST", `/api/actions/${id}/report`, body, 30_000),
  devDirector: (body: { think?: boolean; invent?: boolean; template?: string }) => call<Record<string, unknown>>("POST", "/api/dev/director", body, 40_000),
  /** M6 town life (game/townlife.ts): the lamplighters' rounds, the soot of burned fronts; Jef in a bucket chain or at a natie gate. */
  townlife: () => call<import("../game/townlife").TownLifeData>("GET", "/api/townlife"),
  fireJoin: (x: number, z: number) => call<JobsPayload & { result: TownLifeResult }>("POST", "/api/fire/join", { x, z }),
  fireLeave: () => call<JobsPayload & { result: TownLifeResult }>("POST", "/api/fire/leave"),
  hiringStand: (x: number, z: number) => call<JobsPayload & { result: TownLifeResult }>("POST", "/api/hiring/stand", { x, z }),
};
export type TownLifeResult = { ok: true; text: string } | { ok: false; why: string };

/** Push channel. Reconnects on its own; the game never waits on it. */
export interface OutcomeMsg {
  job_id: number;
  text: string;
  employer: string;
}

export function connectPush(onJobs: (p: JobsPayload) => void, onOutcome: (o: OutcomeMsg) => void = () => {}, onOther: (m: PushMsg) => void = () => {}): void {
  let delay = 1000;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => (delay = 1000);
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string } & JobsPayload & OutcomeMsg;
      if (msg.type === "jobs") onJobs(msg);
      else if (msg.type === "outcome") onOutcome(msg);
      else onOther(msg as unknown as PushMsg);
    };
    ws.onclose = () => {
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  open();
}
