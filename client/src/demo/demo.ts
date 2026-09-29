// The web demo (docs/web-demo.md; Steve 2026-09-27: "only basics, run around in Antwerp and some NPCs also
// there, no interactions, no AI ... for the click to play"). The same game, built with `vite build --mode demo`
// (tools/demo/build.mjs) for GitHub Pages: no server at all. What the server would say for walking about (the
// town and its people, their ways, the street life) was baked into demo/*.json at build time; this file
// answers the game's /api calls from those files, runs the clock itself, and says "not in the demo" to
// everything else (talk, jobs, shops, saves, the AI), so each part takes its own fallback. The game's own
// paths ("/models/...") get the site's base path ("/Moodygame/") on the way out.

import * as THREE from "three";
import { TICK_MINUTES } from "../../../shared/clock";
import type { JobsPayload } from "../net/api";
import ROUTES from "./routes.json";

export const DEMO = import.meta.env.MODE === "demo";

const BASE = import.meta.env.BASE_URL; // "/Moodygame/" on GitHub Pages, "/" for a local try
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** The demo starts in the late afternoon: the lamps come on after a few minutes of play. */
const START = { day: 1, hour: 16, minute: 30 };
/** The routes baked by tools/demo/build.mjs (GET; the path after /api/, a "/" in it saved as "_"). */
export const BAKED: string[] = ROUTES;
const bakedFile = (route: string) => `${BASE}demo/${route.replace(/\//g, "_")}.json`;

/** A site path with the base in front ("/models/a.glb" -> "/Moodygame/models/a.glb"); other URLs as they are. */
export function withBase(url: string): string {
  if (BASE === "/" || !url.startsWith("/") || url.startsWith("//") || url.startsWith(BASE)) return url;
  return BASE + url.slice(1);
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let orig: typeof fetch = (...a) => fetch(...a);
const cache = new Map<string, Promise<unknown>>();
function baked(route: string): Promise<unknown> {
  let p = cache.get(route);
  if (!p) {
    p = orig(bakedFile(route)).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${route}: ${r.status}`))));
    p.catch(() => cache.delete(route));
    cache.set(route, p);
  }
  return p;
}

// the clock: the server's day in the browser, TICK_MINUTES on at each tick the game sends while it plays
const clock = { ...START, weather: "mist" as JobsPayload["clock"]["weather"] };
let held = false;
function stepClock(): void {
  let m = clock.hour * 60 + clock.minute + TICK_MINUTES;
  if (m >= 24 * 60) {
    m -= 24 * 60;
    clock.day = (clock.day % 7) + 1;
  }
  clock.hour = Math.floor(m / 60);
  clock.minute = m % 60;
  // the sky turns now and then, as the director's weather would: mist, clear, fog, rain (not one picked in the Dev menu)
  if (!held && clock.minute === 0 && clock.hour % 3 === 0) clock.weather = (["mist", "clear", "fog", "mist", "rain", "clear"] as const)[(clock.day + clock.hour / 3) % 6];
}
async function jobsPayload(): Promise<JobsPayload> {
  const p = (await baked("jobs")) as JobsPayload;
  return {
    ...p,
    jobs: [],
    board: { state: "ready" },
    ending: null,
    clock: { day: clock.day, hour: clock.hour, minute: clock.minute, weekday: WEEKDAYS[clock.day - 1], weather: clock.weather },
  };
}

// ---- the director's events, recorded when the demo was built (tools/demo/build.mjs) and played back here: one
// frame (what GET /api/actions said then) per tick of the clock, from the Dev menu's event buttons
interface Recording {
  template: string;
  title: string;
  where: string;
  start: { day: number; hour: number; minute: number };
  weather: JobsPayload["clock"]["weather"];
  at: { x: number; z: number } | null;
  frames: Array<{
    events: unknown[];
    actions: unknown[];
    convos: Array<{ id: number; at: number }>;
    landmark?: unknown;
    /** The great storm: the sky and the shut shops at this tick (it turns the weather itself). */
    weather?: JobsPayload["clock"]["weather"];
    closed?: string[];
  }>;
  /** The great storm: the sky it leaves behind. */
  after?: JobsPayload["clock"]["weather"];
}
let replay: { rec: Recording; i: number } | null = null;
/** A talk line shows once per id and only while fresh: stamped with the time it is first played back. */
const convoAt = new Map<number, number>();
async function actionsNow(): Promise<unknown> {
  const base = (await baked("actions")) as { closed?: unknown[] };
  if (!replay) return { actions: [], convos: [], events: [], closed: base.closed ?? [] };
  const f = replay.rec.frames[Math.min(replay.i, replay.rec.frames.length - 1)];
  const now = Date.now();
  const convos = f.convos.map((c) => {
    if (!convoAt.has(c.id)) convoAt.set(c.id, now);
    return { ...c, at: convoAt.get(c.id)! };
  });
  return { actions: f.actions, convos, events: f.events, closed: f.closed ?? base.closed ?? [] };
}
async function startRecording(template: string): Promise<Response> {
  let rec: Recording;
  try {
    const r = await orig(`${BASE}demo/events/${template}.json`);
    if (!r.ok) throw new Error(String(r.status));
    rec = (await r.json()) as Recording;
  } catch {
    return json({ ok: false, why: "this event is not in the web demo" });
  }
  replay = { rec, i: 0 };
  convoAt.clear();
  // its own hour and sky, so the light and the town fit what was recorded
  clock.day = rec.start.day;
  clock.hour = rec.start.hour;
  clock.minute = rec.start.minute;
  clock.weather = rec.frames[0]?.weather ?? rec.weather;
  held = true;
  demoPush.onJobs?.(await jobsPayload());
  const id = (rec.frames[0]?.events[0] as { id?: number } | undefined)?.id ?? 0;
  return json({ ok: true, id, title: rec.title, where: rec.where, x: rec.at?.x, z: rec.at?.z });
}

/** The game's push listener (net/api.ts connectPush hands it over in the demo): the Dev menu's time and weather show at once. */
export const demoPush: { onJobs: ((p: JobsPayload) => void) | null } = { onJobs: null };
const WEATHERS = ["fog", "mist", "clear", "rain", "storm"];

async function answer(method: string, route: string, body: string | null): Promise<Response> {
  if (route === "jobs" && method === "GET") return json(await jobsPayload());
  if (route === "dev/set" && method === "POST") {
    // the Dev menu (game/devmenu.ts): the demo's own clock and sky; needs and money are not in the demo
    const b = (() => {
      try {
        return JSON.parse(body ?? "{}") as { hour?: number; minute?: number; weather?: string };
      } catch {
        return {};
      }
    })();
    if (typeof b.hour === "number" && b.hour >= 0 && b.hour < 24) {
      clock.hour = Math.floor(b.hour);
      clock.minute = typeof b.minute === "number" ? Math.max(0, Math.min(59, Math.floor(b.minute))) : 0;
    }
    if (typeof b.weather === "string" && WEATHERS.includes(b.weather)) {
      clock.weather = b.weather as JobsPayload["clock"]["weather"];
      held = true; // a sky picked by hand stays until the next pick
    }
    const p = await jobsPayload();
    demoPush.onJobs?.(p);
    return json(p);
  }
  if (route === "dev/director" && method === "POST") {
    const t = (() => {
      try {
        return (JSON.parse(body ?? "{}") as { template?: string }).template;
      } catch {
        return undefined;
      }
    })();
    return t && /^[a-z_]+$/.test(t) ? startRecording(t) : json({ ok: false, why: "the web demo plays the recorded events only" });
  }
  if (route === "actions" && method === "GET") return json(await actionsNow());
  if (route === "landmark/cathedral" && method === "GET") {
    const l = replay?.rec.frames[Math.min(replay.i, replay.rec.frames.length - 1)].landmark;
    return l ? json(l) : json({ error: "not in the demo" }, 404);
  }
  // an event's people report where they are: nothing to keep, but a yes, or they ask again and again
  if (method === "POST" && (route === "actions/sync" || /^actions\/\d+\/report$/.test(route))) return json({});
  if (route === "tick" && method === "POST") {
    stepClock();
    if (replay && ++replay.i >= replay.rec.frames.length) {
      // the event is over
      if (replay.rec.after) clock.weather = replay.rec.after;
      replay = null;
    } else if (replay) clock.weather = replay.rec.frames[replay.i].weather ?? clock.weather;
    return json({ ...(await jobsPayload()), advanced: true });
  }
  if (route === "town/ways" && method === "POST") return json({ ways: {} });
  if (method === "GET" && BAKED.includes(route)) {
    try {
      return json(await baked(route));
    } catch {
      return json({ error: "not in the demo" }, 404);
    }
  }
  return json({ error: "Not in the web demo. Download the game to talk, work and play with an AI." }, 404);
}

/** Before any other code of the game (boot/netboot.ts): fetch, three.js's loaders and images go through here. */
export function installDemo(): void {
  if (!DEMO) return;
  const real = window.fetch.bind(window);
  orig = real;
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const u = new URL(url, location.href);
    if (u.origin === location.origin) {
      if (u.pathname.startsWith("/api/")) {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        return answer(method, u.pathname.slice(5).replace(/\/+$/, ""), typeof init?.body === "string" ? init.body : null);
      }
      const b = withBase(u.pathname);
      if (b !== u.pathname) return real(b + u.search, init);
    }
    return real(input, init);
  };
  navigator.sendBeacon = () => true; // the autosave's beacon: nothing to save to
  THREE.DefaultLoadingManager.setURLModifier(withBase);
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (d?.set && d.get)
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: d.enumerable,
      get() {
        return d.get!.call(this);
      },
      set(v: string) {
        d.set!.call(this, withBase(String(v)));
      },
    });
}
