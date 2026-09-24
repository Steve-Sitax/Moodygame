// The interiors' side of the game server (M6: server/src/interiors/routes.ts). The server
// owns every number (prices, dice, caps, warmth, how tipsy); the client shows them.

import type { JobsPayload, Pt } from "./api";

export interface Person {
  id: string;
  name: string;
  first: string;
  kind: string;
  sex: "m" | "f";
  age: number;
  /** M6 ballads: a guest who stands (the ballad singer), and what they do there. */
  stand?: boolean;
  role?: string;
}

export interface TavernDoor {
  place: string;
  label: string;
  door: Pt;
  out: Pt;
  open: boolean;
  keeper: { id: string; name: string; first: string; kind: string } | null;
}

export interface PoesjeInfo {
  label: string;
  /** The step outside the cellar door, and the door in the wall. */
  door: Pt;
  wall: Pt;
  out: Pt;
  open: boolean;
  door_opens: number;
  show_from: number;
  show_to: number;
  price_c: number;
}

export interface InteriorsInfo {
  taverns: TavernDoor[];
  poesje: PoesjeInfo | null;
  tipsy: number;
}

export interface TavernState {
  place: string;
  label: string;
  open: boolean;
  keeper: { id: string; name: string; first: string; kind: string } | null;
  patrons: Person[];
  tipsy: number;
  dice: { stakes: number[]; left: { games: number; loss_c: number } };
}

export interface Throw {
  dice: [number, number, number];
  rank: number;
  points: number;
  name: string;
}

export interface DiceResult extends JobsPayload {
  jef: Throw;
  them: Throw;
  result: 1 | 0 | -1;
  net_c: number;
  line: string;
  left: { games: number; loss_c: number };
}

export interface TalkLines {
  lines: Array<{ who: string; name: string; text: string }>;
  source: "claude" | "engine";
  facts: string[];
}

export interface PlayLine {
  who: "neus" | "schele" | "third";
  text: string;
}
export interface PlayInfo {
  state: "ready" | "writing" | "none";
  title?: string;
  third?: string;
  lines?: PlayLine[];
  source?: string;
}

export class ApiError extends Error {}

async function call<T>(method: string, url: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new ApiError(j.error ?? `server ${r.status}`);
    return j;
  } finally {
    clearTimeout(timer);
  }
}

export const interiorApi = {
  info: () => call<InteriorsInfo>("GET", "/api/interiors"),
  tavern: (place: string) => call<TavernState>("GET", `/api/interior/${encodeURIComponent(place)}`),
  tipsy: () => call<{ tipsy: number }>("GET", "/api/tipsy"),
  fire: (place: string) => call<JobsPayload & { text: string; warmed: boolean }>("POST", "/api/interior/fire", { place }),
  sit: (place: string, patron: string) =>
    call<{ line: string; stakes: number[]; left: { games: number; loss_c: number }; source: string }>("POST", "/api/interior/dice/sit", { place, patron }),
  dice: (place: string, patron: string, stake: number) => call<DiceResult>("POST", "/api/interior/dice/throw", { place, patron, stake }),
  // a model call may be behind these: 20 s on the server, a little more here
  gossip: (place: string, a: string, b: string) => call<TalkLines>("POST", "/api/interior/gossip", { place, a, b }, 25_000),
  chat: (place: string, a: string, b: string) => call<TalkLines>("POST", "/api/interior/chat", { place, a, b }, 25_000),
  poesje: () => call<{ open: boolean; price_c: number; play: PlayInfo; audience: Person[] }>("GET", "/api/poesje"),
  enter: () => call<JobsPayload & { paid_c: number; line: string }>("POST", "/api/poesje/enter"),
  play: () => call<PlayInfo>("POST", "/api/poesje/play", undefined, 25_000),
};
