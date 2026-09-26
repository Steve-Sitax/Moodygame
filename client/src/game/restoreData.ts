// M7 save and pause: the browser's part of a save that was just loaded (client_state), read once
// when the page starts. A load sets it in sessionStorage and reloads the page; the parts of the
// game that must know it before their first word with the server (a boat Jef sat in) peek at it here;
// game/saves.ts puts the rest back once the town is in.

import type { SmallKind } from "../../../shared/smallBoats";

const KEY = "scheldemist.restore";

export interface RestorePose {
  x: number;
  z: number;
  y: number;
  yaw: number;
  pitch: number;
  swimming?: boolean;
  crouching?: boolean;
}
export interface RestoreRow {
  what: string;
  /** M7 boats: any of the small kinds (shared/smallBoats.ts). */
  kind: SmallKind;
  x: number;
  z: number;
  yaw: number;
}
export interface ClientState {
  v: 1;
  clock?: { day: number; hour: number; minute: number };
  place?: string;
  pose: RestorePose;
  row?: RestoreRow | null;
  jobs?: unknown;
  [k: string]: unknown;
}

let data: ClientState | null = null;
try {
  const raw = sessionStorage.getItem(KEY);
  if (raw) {
    sessionStorage.removeItem(KEY);
    const d = JSON.parse(raw) as ClientState;
    if (d && d.v === 1 && d.pose) data = d;
  }
} catch {
  /* no storage: nothing to put back */
}

/** The loaded save's browser part, if this page was started by a load. */
export function bootRestore(): ClientState | null {
  return data;
}

/** Before the reload: what the new page puts back. */
export function setRestore(c: unknown): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(c ?? null));
  } catch {
    /* private mode: the town comes back, Jef starts at the quay */
  }
}
