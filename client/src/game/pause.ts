// M7 save and pause (Steve 2026-09-25): "a pause ... Nothing progresses on pause, like real games."
//
// The pause clock of the browser side. Imported first by main.ts, so it is in place before any
// other part of the game runs. While the game is paused:
// - performance.now() stands still: every timer of the game that counts real seconds from it (a
//   job's bell, a figure's wait, the clock's run between ticks, THREE.Timer's frame time) loses
//   no time, and on the unpause the next frame's dt is a frame's, not the length of the pause;
// - setTimeout: a timer that comes due is put off, and runs after the unpause with the time it
//   still had; setInterval: its rounds are skipped (the server's tick, the polls);
// - AbortSignal.timeout (every fetch's time limit) counts only playing time: a talk reply the
//   server holds back during the pause does not time out;
// - fetch: a reply to a call made in play is handed over after the unpause (the server holds the
//   model's answers too: save/gate.ts); calls made while paused (the menu, the save) get theirs at once;
// - the server hears it (POST /api/pause, one holder per tab: this tab's id), so its clock, ticks and
//   model calls stop too.
// `real` has the untouched functions, for the pause screen itself.

type Reason = "menu" | "key" | "saving" | "loading" | "boot";

const perf = performance;
const realNowFn = perf.now.bind(perf);
export const real = {
  now: realNowFn,
  setTimeout: window.setTimeout.bind(window),
  clearTimeout: window.clearTimeout.bind(window),
  setInterval: window.setInterval.bind(window),
  fetch: window.fetch.bind(window),
  abortTimeout: AbortSignal.timeout.bind(AbortSignal),
};

/** This tab's name for the server's pause holders (a new one each page load). */
export const clientId = `tab-${Math.random().toString(36).slice(2, 10)}`;

const reasons = new Set<Reason>();
let pausedAt: number | null = null;
let pausedTotal = 0;
const listeners: Array<(paused: boolean) => void> = [];
let waiters: Array<() => void> = [];

/** The game's own clock: real time less the time spent paused. */
function playNow(): number {
  return (pausedAt ?? realNowFn()) - pausedTotal;
}

export const pause = {
  get paused(): boolean {
    return reasons.size > 0;
  },
  has(r: Reason): boolean {
    return reasons.has(r);
  },
  get reasons(): Reason[] {
    return [...reasons];
  },
  /** Add or take away one reason to be paused; the game plays when there is none. */
  set(r: Reason, on: boolean): void {
    const was = reasons.size > 0;
    if (on) reasons.add(r);
    else reasons.delete(r);
    const is = reasons.size > 0;
    if (was === is) return;
    if (is) {
      pausedAt = realNowFn();
      holdTimers();
    } else {
      pausedTotal += realNowFn() - (pausedAt ?? realNowFn());
      pausedAt = null;
      armTimers();
      const w = waiters;
      waiters = [];
      for (const f of w) f();
    }
    tellServer(is);
    for (const l of listeners) {
      try {
        l(is);
      } catch (e) {
        console.warn("[pause] listener", e);
      }
    }
  },
  onChange(f: (paused: boolean) => void): void {
    listeners.push(f);
  },
  /** Resolves at once in play, else at the unpause. */
  whenPlaying(): Promise<void> {
    return reasons.size === 0 ? Promise.resolve() : new Promise((r) => waiters.push(r));
  },
  playNow,
  /** Real ms paused so far (the kit's check that nothing ran). */
  get pausedMs(): number {
    return pausedTotal + (pausedAt !== null ? realNowFn() - pausedAt : 0);
  },
};

// ------------------------------------------------------------------ the server's pause

let told: boolean | null = null;
let telling: Promise<unknown> = Promise.resolve();
function tellServer(on: boolean): void {
  // in order, the last word wins; a server away simply does not hear it
  telling = telling.then(async () => {
    if (told === on) return;
    try {
      await real.fetch("/api/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on, client: clientId }), signal: real.abortTimeout(5000) });
      told = on;
    } catch {
      /* the server is away: its tick waits for this tab anyway */
    }
  });
}
/** The server's pause, in step with this tab's (after a reconnect: the server let go of us). */
export function resendPause(): void {
  told = null;
  tellServer(reasons.size > 0);
}

// ------------------------------------------------------------------ performance.now

Object.defineProperty(perf, "now", { value: playNow, configurable: true, writable: true });

// ------------------------------------------------------------------ setTimeout, setInterval

interface Timer {
  fn: (...a: unknown[]) => void;
  args: unknown[];
  /** When it is due, on the game's clock. */
  due: number;
  realId: number | null;
}
const timers = new Map<number, Timer>();
let nextId = 1_000_000_000;

function arm(id: number, t: Timer): void {
  if (t.realId !== null || reasons.size > 0) return;
  t.realId = real.setTimeout(() => {
    t.realId = null;
    if (reasons.size > 0) return; // armed again at the unpause
    timers.delete(id);
    t.fn(...t.args);
  }, Math.max(0, t.due - playNow()));
}
function holdTimers(): void {
  for (const t of timers.values()) {
    if (t.realId !== null) real.clearTimeout(t.realId);
    t.realId = null;
  }
}
function armTimers(): void {
  for (const [id, t] of timers) arm(id, t);
}

const patchedSetTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]): number => {
  if (typeof handler !== "function") return real.setTimeout(handler, ms, ...args);
  const id = nextId++;
  const t: Timer = { fn: handler as (...a: unknown[]) => void, args, due: playNow() + Math.max(0, Number(ms) || 0), realId: null };
  timers.set(id, t);
  arm(id, t);
  return id;
}) as typeof window.setTimeout;
const patchedClearTimeout = ((id?: number): void => {
  if (id === undefined) return;
  const t = timers.get(id);
  if (t) {
    if (t.realId !== null) real.clearTimeout(t.realId);
    timers.delete(id);
  } else real.clearTimeout(id);
}) as typeof window.clearTimeout;
const patchedSetInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]): number => {
  if (typeof handler !== "function") return real.setInterval(handler, ms, ...args);
  const f = handler as (...a: unknown[]) => void;
  return real.setInterval(() => {
    if (reasons.size === 0) f(...args);
  }, ms);
}) as typeof window.setInterval;
window.setTimeout = patchedSetTimeout;
window.clearTimeout = patchedClearTimeout;
window.setInterval = patchedSetInterval;

// ------------------------------------------------------------------ AbortSignal.timeout

AbortSignal.timeout = (ms: number): AbortSignal => {
  const c = new AbortController();
  patchedSetTimeout(() => c.abort(new DOMException("The operation timed out.", "TimeoutError")), ms);
  return c.signal;
};

// ------------------------------------------------------------------ fetch

/** Calls that are never held: the pause and the saves themselves, and the dev pictures. */
const FREE = /\/api\/(pause|save|saves|load|client-state|dev\/shot)\b/;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const inPlay = reasons.size === 0;
  const res = await real.fetch(input, init);
  if (inPlay && reasons.size > 0) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!FREE.test(url)) await pause.whenPlaying();
  }
  return res;
};

// ------------------------------------------------------------------ the page

// CSS animations (a bubble fading, a flame's flicker) stand still with the rest
{
  const st = document.createElement("style");
  st.textContent =
    "body.paused > :not(.pause-ui), body.paused > :not(.pause-ui) *, body.paused > :not(.pause-ui) *::before, body.paused > :not(.pause-ui) *::after { animation-play-state: paused !important; }";
  document.head.appendChild(st);
  pause.onChange((p) => document.body.classList.toggle("paused", p));
}

// ------------------------------------------------------------------ keys

let keyHandler: ((e: KeyboardEvent, typing: boolean) => boolean | void) | null = null;
/**
 * While paused the keys go only here (main.ts: the menu, the pause card, the save panel); the game's own wait.
 * The handler returns true when it went back into the game and the key is for the game too (a dialog's digit
 * after coming back to the window): then it goes on to the dialogs' own listeners.
 */
export function onPausedKey(f: (e: KeyboardEvent, typing: boolean) => boolean | void): void {
  keyHandler = f;
}
// first of all the key listeners (this file is imported first): nothing in the game hears a key while paused
window.addEventListener(
  "keydown",
  (e) => {
    if (reasons.size === 0) return;
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");
    let goOn = false;
    try {
      goOn = keyHandler?.(e, typing) === true;
    } finally {
      if (!goOn || reasons.size > 0) e.stopImmediatePropagation();
    }
  },
  true,
);
