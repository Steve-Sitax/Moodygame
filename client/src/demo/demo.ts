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
function stepClock(): void {
  let m = clock.hour * 60 + clock.minute + TICK_MINUTES;
  if (m >= 24 * 60) {
    m -= 24 * 60;
    clock.day = (clock.day % 7) + 1;
  }
  clock.hour = Math.floor(m / 60);
  clock.minute = m % 60;
  // the sky turns now and then, as the director's weather would: mist, clear, fog, rain
  if (clock.minute === 0 && clock.hour % 3 === 0) clock.weather = (["mist", "clear", "fog", "mist", "rain", "clear"] as const)[(clock.day + clock.hour / 3) % 6];
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

async function answer(method: string, route: string): Promise<Response> {
  if (route === "jobs" && method === "GET") return json(await jobsPayload());
  if (route === "tick" && method === "POST") {
    stepClock();
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
        return answer(method, u.pathname.slice(5).replace(/\/+$/, ""));
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
