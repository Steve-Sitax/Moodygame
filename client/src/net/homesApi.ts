// The homes' side of the game server (M6 homes: server/src/homes/routes.ts). The server owns
// every number: the rents, the days paid, the key, where a piece may stand, the comfort and
// what a night at home does. The client shows it and asks.

import type { JobsPayload, Night, Pt } from "./api";
import type { Comfort, HomeClass, Placed } from "../../../shared/homes";

export interface HomeDoor {
  id: HomeClass;
  cls: HomeClass;
  label: string;
  step: Pt;
  wall: Pt;
  out: Pt;
  week_c: number;
  day_c: number;
  to_sunday_c: number;
  notice: string;
  landlord: { id: string; name: string; first: string } | null;
}

export interface HomeItem {
  id: number;
  kind: string;
  name: string;
  state: "pocket" | "arms" | "stored" | "placed";
  home: string | null;
  gx: number | null;
  gz: number | null;
  rot: number;
}

export interface HomesInfo {
  homes: HomeDoor[];
  dealer: { id: string; label: string; step: Pt; wall: Pt; out: Pt; at: [number, number, number] } | null;
  lease: {
    home: HomeClass;
    since_day: number;
    paid_through: number;
    owed_days: number;
    owed_c: number;
    warned: boolean;
    to_sunday_c: number;
    day_c: number;
    comfort: (Comfort & { rest: number; restful: boolean }) | null;
    words: string[];
    night: { warmth: number; healthFed: number; healthHungry: number; food: number; restful: boolean };
    fire: boolean;
  } | null;
  items: HomeItem[];
  widow: { id: string; home: boolean } | null;
}

export interface Remark {
  who: { id: string; name: string; first: string; kind: string; sex: "m" | "f"; age: number };
  line: string;
  source: "claude" | "engine";
}

type WithHomes<T> = T & JobsPayload & { homes: HomesInfo };

class ApiError extends Error {}

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

export const homesApi = {
  info: () => call<HomesInfo>("GET", "/api/homes"),
  take: (home: string, plan: "day" | "week") => call<WithHomes<{ text: string; paid_c: number }>>("POST", "/api/homes/take", { home, plan }),
  rent: (plan: "day" | "week") => call<WithHomes<{ text: string; paid_c: number }>>("POST", "/api/homes/rent", { plan }),
  sleep: () => call<WithHomes<{ night: Night }>>("POST", "/api/homes/sleep"),
  stove: () => call<WithHomes<{ text: string; warmed: boolean }>>("POST", "/api/homes/stove"),
  place: (id: number, gx: number, gz: number, rot: number) => call<WithHomes<{ placed: Placed }>>("POST", "/api/homes/place", { id, gx, gz, rot }),
  lift: (id: number) => call<WithHomes<{ item: HomeItem }>>("POST", "/api/homes/lift", { id }),
  abandon: () => call<WithHomes<{ text: string }>>("POST", "/api/homes/abandon"),
  // a model call may be behind it: 20 s on the server, a little more here
  remark: () => call<{ remark: Remark | null }>("POST", "/api/homes/remark", undefined, 25_000),
};
