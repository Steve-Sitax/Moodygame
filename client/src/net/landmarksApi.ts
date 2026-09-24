// The landmark interiors' side of the game server (M6: server/src/landmarks/routes.ts). The
// server says who is inside and what goes on; the client builds the halls and plays the life.

import type { JobsPayload } from "./api";
import type { LandmarkDoor, LandmarkId, Service } from "../../../shared/landmarks";

export interface InPerson {
  id: string;
  name: string;
  first: string;
  kind: string;
  sex: "m" | "f";
  age: number;
  role: string;
  title?: string;
}

export interface LandmarkNow {
  id: LandmarkId;
  label: string;
  open: boolean;
  day: number;
  hour: number;
  people: InPerson[];
  service: Service | null;
  organ: boolean;
  confession: { open: boolean; priest: string | null };
  wedding: { event: number; title: string; groom: string; bride: string; stage: "vows" | "leaving" } | null;
  civil: { groom: string; bride: string } | null;
  register: string[];
  posters: Array<{ kind: string; heading: string; body: string; footer: string }>;
  theatre: { kind: "rehearsal" | "performance" } | null;
  /** M7: the cathedral's door is shut to Jef for a while (the beadle put him out for running). */
  barred?: boolean;
}

/** M7: the engine's answer to Jef running in the cathedral (server/src/landmarks/hush.ts). */
export interface HushResult {
  counted: boolean;
  strike: number;
  line: string;
  speaker: "beadle" | "churchgoer";
  delta: number;
  leave: boolean;
  text: string;
}

export type DoorNow = LandmarkDoor & { open: boolean };

async function call<T>(method: string, url: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const j = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new Error(j.error ?? `server ${r.status}`);
    return j;
  } finally {
    clearTimeout(timer);
  }
}

export const landmarksApi = {
  doors: () => call<{ doors: DoorNow[] }>("GET", "/api/landmarks"),
  now: (id: LandmarkId) => call<LandmarkNow>("GET", `/api/landmark/${id}`),
  here: (id: LandmarkId | null) => call<{ ok: boolean }>("POST", "/api/landmark/here", { id }),
  candle: () => call<JobsPayload & { paid_c: number; text: string }>("POST", "/api/landmark/candle", {}),
  chair: () => call<JobsPayload & { paid_c: number; text: string }>("POST", "/api/landmark/chair", {}),
  begin: () => call<{ line: string; priest: string }>("POST", "/api/landmark/confess/begin", {}),
  // a model call may be behind this: 20 s on the server, a little more here
  confess: (text: string) => call<{ line: string; penance: string | null; source: string; gated?: string }>("POST", "/api/landmark/confess", { text }, 25_000),
  end: () => call<{ line: string }>("POST", "/api/landmark/confess/end", {}),
  // M6 sermon (server/src/ballads/sermon.ts): Sunday's words (a model call may be behind it) and "Jef heard it"
  sermon: () => call<SermonView>("GET", "/api/sermon", undefined, 25_000),
  heard: () => call<JobsPayload & { delta: number; text: string }>("POST", "/api/sermon/heard", {}),
  // M7: Jef ran in the cathedral with this many people near
  ran: (witnesses: number) => call<JobsPayload & HushResult>("POST", "/api/landmark/ran", { witnesses }),
};

export interface SermonView {
  day: number;
  lines: string[];
  source: "claude" | "engine";
  hint: "warn" | "praise" | null;
  gossip: { id: string; name: string; to: string | null; text: string } | null;
  nodders: string[];
  heard: boolean;
}
