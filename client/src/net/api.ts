// Client side of the game server. The server owns all numbers;
// the client shows them and reports what happened in 3D.

import type { Goods } from "../game/props";
import { clientId, pause, real, resendPause } from "../game/pause";
import { identity } from "./mp/identity";
import { CONNECT_MS, Liveness, PUSH_DEAD_MS, PUSH_PING_MS, retryDelay } from "./mp/link";
import { DEMO, demoPush } from "../demo/demo";

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
  /** M7 short jobs: cart work (3 to 8 things): the employer's handcart is lent at the start (server town/handcart.ts). */
  cart?: boolean;
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
/** M7 mills (server town/mills.ts): an hour's help at a mill on the wall; the cap turned into the wind when the miller calls. */
export interface MillTask {
  kind: "mill";
  goods: "sacks";
  mill: string;
  post: { x: number; z: number; label: string };
  capstan: { x: number; z: number };
  duration_s: number;
  turns: number;
  twist: "none";
  limit_s: null;
}
export type Task = CarryTask | WatchTask | DeliverTask | LettersTask | MillTask;

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
  /** M7 mills: times the cap was turned into the wind when the miller called. */
  turns?: number;
  /** M7 night: settled at the employer's quest box (the facts held when the work was done). */
  box?: boolean;
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
  /** M7 night: how long he slept (game minutes), when he woke, whether the date turned meanwhile. */
  slept_min?: number;
  wake?: { day: number; hour: number; minute: number; weekday: string };
  turned?: boolean;
  /** He dropped where he stood (sleep 0). */
  collapsed?: boolean;
  robbed?: { money_c: number; things: string[] };
}

/** M7 sleep (server/src/rest.ts): asleep now, how far. */
export interface RestView {
  /** (M8d: "cell": played together, a night in the police cell sat out at the world's pace) */
  place: "home" | "doss" | "bench" | "cell";
  label: string;
  bench?: string;
  home?: string;
  planned_min: number;
  slept_min: number;
  from: { hour: number; minute: number };
  now: { day: number; hour: number; minute: number; weekday: string };
  /** M8d: the cell: where he is held (put there under the fade). */
  at?: { x: number; z: number; yaw: number };
}
/** M7 sleep: how a sleep ended (rested: the hours chosen; up: a key; police: moved on; robbed; ended: the week or his body). */
export interface RestEnd {
  place: "home" | "doss" | "bench" | "cell";
  label: string;
  home?: string;
  bench?: string;
  reason: "rested" | "up" | "police" | "robbed" | "ended";
  slept_min: number;
  planned_min: number;
  lines: string[];
  wake: { day: number; hour: number; minute: number; weekday: string };
  turned: boolean;
  ended?: Ending;
  robbed?: { money_c: number; things: string[] };
}
/** M7 sleep: what the client asks for: where, how long, and where Jef stands. */
export interface RestAsk {
  place: "home" | "doss" | "bench";
  bench?: string;
  hours: number | "morning";
  pos: { x: number; z: number; y: number };
}

/** M7 night: the date turned at midnight (the night's other work may have a word: a note about the rent). */
export interface DayTurn {
  day: number;
  lines: string[];
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
  /** M7 fog lamps: today's fog as the lamplighters see it (server day.ts fogDay). */
  lamps_fog?: { day?: number; start: boolean; turns: Array<{ h: number; fog: boolean }> };
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
  /** M9 (Steve 2026-09-27: "if no AI, no custom answer possible"): false: the choices only, no typing. */
  free?: boolean;
}

// ---- the town (M3e). The server made it; the client walks it by the game clock.

export type Pt = [number, number];
export type Act = "home" | "work" | "tavern" | "play" | "market" | "church" | "stroll" | "loiter";
export type Seg = [number, number, Act, string?];
export type WorkKind = "haul" | "stall" | "shop" | "tavern" | "patrol" | "roam" | "inside" | "beg" | "post" | "guard" | "inspect" | "wait" | "round";

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
  /** Post (the look pass: the wall's works): how they stand at `at` (a Motion; arms folded if none). */
  motion?: string;
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
  /** M7 back of town (server town/backtown.ts): a way to walk about the place (the park's paths, the walk on the wall). */
  route?: Pt[];
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
  /** M8d: the player it is about (who asked, the one followed or sought); null: the host, or an event's. */
  for_player?: number | null;
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
  /** The sound of the stage as the director composed it from the engine's palette (audio/eventcues.ts). */
  cues?: EventCue[];
  /** M7 funeral, a "depart": the road out of town (the hearse drives it), whether a hearse goes, the groups going home. */
  exit?: { id: string; label: string; x: number; z: number } | null;
  route?: Array<[number, number]>;
  hearse?: boolean;
  groups?: Array<{ ids: string[]; x: number; z: number; gone: boolean }>;
}
export interface EventCue {
  source: string;
  every_s: number;
  pitch: number;
  level: number;
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

/** M7 warmth: where Jef is, as the client says it with each tick: a room ("tavern:ankere", "poesje", "shop:<id>", "home:<id>", "landmark:cathedral", "church:carolus", "church:gothic", "prison") or null outside. */
export interface WhereReport {
  at: string | null;
  lantern: boolean;
}
/** M7 warmth: where the server believes Jef is (a room it could check is open, else outside), for the cold. */
export interface WhereNow {
  shelter: "outside" | "heated" | "sheltered";
  place: string | null;
  label: string;
  lantern: boolean;
}

async function call<T>(method: string, url: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  // M7 quest tests: a reply cut off (the time limit ran out while the body was read) was taken as {}
  // and passed on as a good reply (the events' list became undefined and every E key stopped). A body
  // that cannot be read now throws; an empty body is still {}.
  const text = await res.text();
  let data: T & { error?: string };
  try {
    data = (text ? JSON.parse(text) : {}) as T & { error?: string };
  } catch {
    if (res.ok) throw new Error(`bad reply from ${url}`);
    data = {} as T & { error?: string };
  }
  // (M8e review 4: a 429 was tried again already, by the fetch hook in boot/netboot.ts; the host's words are shown)
  if (!res.ok) throw new Error(data.error ?? (res.status === 429 ? "The host's game is busy: wait a moment and try again." : `HTTP ${res.status}`));
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
  /** M7 warmth: `where` says where Jef is and whether his lantern is lit; the reply says what the server believes (server/src/warmth.ts). */
  tick: (where?: WhereReport, more: { asleep?: boolean; pos?: { x: number; z: number; y: number } } = {}) =>
    call<JobsPayload & { advanced: boolean; night?: Night; ended?: Ending; turned?: DayTurn; where?: WhereNow; rest?: RestView; woke?: RestEnd }>("POST", "/api/tick", { where, ...more }),
  /** M7 night: the work is done, the employer is at home asleep; the facts wait for the box at his door. */
  hold: (id: number, report: Report) => call<JobsPayload & { job: Job }>("POST", `/api/jobs/${id}/hold`, report),
  /** Dev (M7 night): the clock on by game minutes the way the game moves it (the date turns at midnight). */
  devAdvance: (minutes: number) => call<JobsPayload & { lines: string[]; turned: boolean }>("POST", "/api/dev/advance", { minutes }),
  /** M7 sleep: lie down in a bed or on a bench for so long (server/src/rest.ts checks the place and clamps the hours). */
  sleep: (ask: RestAsk) => call<JobsPayload & { rest: RestView }>("POST", "/api/sleep", ask),
  /** M7 sleep: a key wakes him; only the time slept counts. */
  wake: () => call<JobsPayload & { woke: RestEnd | null }>("POST", "/api/sleep/wake"),
  rent: () => call<JobsPayload & { paid: boolean; text: string }>("POST", "/api/rent"),
  /** Fell into the Schelde: the server takes the cold off your warmth (once per swim). */
  swim: () => call<JobsPayload & { cold: boolean }>("POST", "/api/swim"),
  /** The horse omnibuses (M3g): get on a line at a stop (the server takes the fare, or a change is free) or get off. */
  ride: (action: "board" | "alight" | "seat" | "timetable", stop: string, line?: string, place?: "inside" | "roof") =>
    call<JobsPayload & { text: string; fare_c?: number; change?: boolean }>("POST", "/api/ride", { action, stop, line, place }),
  newGame: () => call<JobsPayload>("POST", "/api/new-game"),
  devSet: (v: Partial<Record<"day" | "hour" | "minute" | "food" | "warmth" | "health" | "sleep" | "money_c", number>>) =>
    call<JobsPayload>("POST", "/api/dev/set", v),
  town: () => call<TownData>("GET", "/api/town", undefined, 15_000),
  /** The trade plan (docs/trade-plan.md part A): the ways on foot of the town's day plans, and more by key. */
  ways: () => call<{ ways: Record<string, Pt[]> }>("GET", "/api/town/ways", undefined, 30_000),
  waysByKey: (keys: string[]) => call<{ ways: Record<string, Pt[] | null> }>("POST", "/api/town/ways", { keys }, 15_000),
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

/**
 * M7 save and pause: the pause and save messages ("gate": the server paused, saving or loading;
 * "loaded": a save was loaded) go here at once, never held by the pause (game/saves.ts).
 */
const systemListeners: Array<(m: PushMsg) => void> = [];
export function onSystemPush(f: (m: PushMsg) => void): void {
  systemListeners.push(f);
}

/** Push channel. Reconnects on its own; the game never waits on it. */
export interface OutcomeMsg {
  job_id: number;
  text: string;
  employer: string;
}

/**
 * M8e review 4: the push socket's line, as the movement socket's (net/mp/link.ts): a ping every PUSH_PING_MS
 * (the server answers "pong"); nothing heard for PUSH_DEAD_MS after a ping, or a connect not open after
 * CONNECT_MS, and the socket is given up. A lost socket comes back after 1, 2, 4, 8, then every 15 s (at once when
 * the browser is online again); back, it asks for the state again (the job board, and a "resync" push for the
 * parts that keep their own: main.ts), since what was pushed meanwhile is lost. Alone on this PC the ping is
 * one small message every 10 s and changes nothing.
 */
export function connectPush(onJobs: (p: JobsPayload) => void, onOutcome: (o: OutcomeMsg) => void = () => {}, onOther: (m: PushMsg) => void = () => {}): void {
  if (DEMO) {
    demoPush.onJobs = onJobs; // the web demo has no server: its Dev menu pushes the time and the weather (demo/demo.ts)
    return;
  }
  let attempt = 0;
  let dropped = false;
  let current: WebSocket | null = null;
  let retryTimer = 0;
  let connectTimer = 0;
  const live = new Liveness(PUSH_DEAD_MS);
  // M7 save and pause: what the server says while the game is paused is played after the unpause, in order
  const held: Array<{ type: string } & JobsPayload & OutcomeMsg> = [];
  const deliver = (msg: { type: string } & JobsPayload & OutcomeMsg) => {
    try {
      if (msg.type === "jobs") onJobs(msg);
      else if (msg.type === "outcome") onOutcome(msg);
      else onOther(msg as unknown as PushMsg);
    } catch (err) {
      console.warn(`push "${msg.type}" failed`, err);
    }
  };
  pause.onChange((paused) => {
    if (paused) return;
    for (const m of held.splice(0)) deliver(m);
  });
  /** The line is gone (closed, or given up): the next try after the next wait. */
  const lost = (ws: WebSocket) => {
    if (current !== ws) return; // (an old socket, given up already)
    current = null;
    real.clearTimeout(connectTimer);
    dropped = true;
    real.clearTimeout(retryTimer);
    retryTimer = real.setTimeout(open, retryDelay(attempt++));
  };
  /** A socket that hangs (no answer to the pings, or a connect that does not come): dropped without a word. */
  const giveUp = (ws: WebSocket) => {
    ws.onopen = ws.onmessage = ws.onclose = null;
    try {
      ws.close();
    } catch {
      /* already gone */
    }
    lost(ws);
  };
  const open = () => {
    retryTimer = 0;
    if (current) return;
    // this tab's name: the server lets go of its pause when the channel closes
    // (M8c: a guest's tab says whose it is in its first message; the host's on the host PC needs nothing)
    const guest = identity.token !== null;
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?client=${encodeURIComponent(clientId)}${guest ? "&guest=1" : ""}`);
    current = ws;
    live.reset();
    real.clearTimeout(connectTimer);
    connectTimer = real.setTimeout(() => {
      if (current === ws && ws.readyState !== WebSocket.OPEN) giveUp(ws);
    }, CONNECT_MS);
    ws.onopen = () => {
      real.clearTimeout(connectTimer);
      if (guest) ws.send(JSON.stringify({ type: "hello", token: identity.token }));
      attempt = 0;
      // the server let go of our pause when the channel dropped: say it again
      if (pause.paused) resendPause();
      // back after a drop: what was pushed meanwhile is lost, so the state is asked for again: the job board here,
      // the rest by the parts that keep their own (a "resync" push: main.ts)
      if (dropped) {
        dropped = false;
        api
          .jobs()
          .then((p) => onJobs(p))
          .catch(() => {});
        const resync = { type: "resync" } as { type: string } & JobsPayload & OutcomeMsg;
        if (pause.paused) held.push(resync);
        else deliver(resync);
      }
    };
    ws.onmessage = (e) => {
      live.heard();
      // a bad message or a handler that throws must not take the channel's later messages with it
      let msg: { type: string } & JobsPayload & OutcomeMsg;
      try {
        msg = JSON.parse(String(e.data)) as { type: string } & JobsPayload & OutcomeMsg;
      } catch {
        return;
      }
      if (msg.type === "pong") return; // (M8e review 4: the line's sign of life only)
      if (msg.type === "gate" || msg.type === "loaded") {
        for (const f of systemListeners) {
          try {
            f(msg as unknown as PushMsg);
          } catch (err) {
            console.warn(`push "${msg.type}" failed`, err);
          }
        }
        return;
      }
      if (pause.paused) {
        held.push(msg);
        return;
      }
      deliver(msg);
    };
    ws.onclose = () => lost(ws);
  };
  // the pings (the untouched timers and clock of game/pause.ts: a paused tab's line is watched too)
  real.setInterval(() => {
    const ws = current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const now = real.now();
    if (live.dead(now)) {
      giveUp(ws);
      return;
    }
    try {
      ws.send('{"type":"ping"}');
    } catch {
      return;
    }
    live.pinged(now);
  }, PUSH_PING_MS);
  // the browser is on the network again (a VPN back up): try now rather than at the next wait
  window.addEventListener("online", () => {
    if (current || !retryTimer) return;
    real.clearTimeout(retryTimer);
    open();
  });
  open();
}
