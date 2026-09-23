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
export type Task = CarryTask | WatchTask | DeliverTask;

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
}

export interface JobsPayload {
  board: { state: "writing" | "ready"; source?: string; error?: string };
  jobs: Job[];
  player: Player;
}

/** What an NPC says. Trust stays on the server (docs/08: hidden). */
export interface TalkLine {
  npc_line?: string;
  mood?: string;
  choices?: string[];
  end?: boolean;
  gated?: string | null;
}

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
  near: (npc: string) => call<{ ok: boolean }>("POST", `/api/npc/${npc}/near`),
  talk: (npc: string, kind: "open" | "choice" | "free", text?: string) =>
    call<TalkLine>("POST", `/api/npc/${npc}/talk`, { kind, text }, 30_000),
  witness: (npc: string, event: "took" | "returned") => call<{ ok: boolean }>("POST", `/api/npc/${npc}/witness`, { event }),
  progress: (id: number, p: Progress) => call<{ job: Job }>("POST", `/api/jobs/${id}/progress`, p),
  done: (id: number, report: Report) =>
    call<{ job: Job; settlement: Settlement; money_c: number }>("POST", `/api/jobs/${id}/done`, report),
};

/** Push channel. Reconnects on its own; the game never waits on it. */
export interface OutcomeMsg {
  job_id: number;
  text: string;
  employer: string;
}

export function connectPush(onJobs: (p: JobsPayload) => void, onOutcome: (o: OutcomeMsg) => void = () => {}): void {
  let delay = 1000;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.onopen = () => (delay = 1000);
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as { type: string } & JobsPayload & OutcomeMsg;
      if (msg.type === "jobs") onJobs(msg);
      if (msg.type === "outcome") onOutcome(msg);
    };
    ws.onclose = () => {
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 15000);
    };
  };
  open();
}
