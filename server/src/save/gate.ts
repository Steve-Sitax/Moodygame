// M7 save and pause (Steve 2026-09-25): "When saving, wait on the AI session to finish if active, and
// block any new ones from starting, and then save. And also a pause. Same rule: finish the AI session
// in the background while the screen freezes, and use the AI result when unfrozen. Nothing progresses
// on pause, like real games."
//
// The gate every model call passes (ai/claude.ts callClaude):
// - open: calls start and their answers are applied at once, as before.
// - paused (any holder): no new call starts (it waits, and its 20 s limit only begins when it may
//   start); a call already running finishes in the background and its answer waits here until the
//   pause ends, so nothing it would say or do reaches the town while the game is frozen.
// - saving / loading: no new call starts; the calls in flight finish and their answers are applied
//   at once (a held answer too), then the save is written or the save is loaded; then open again.
//
// Pause holders are named (a client id: the browser tab; later a player). The game is paused while
// any holder holds it: multiplayer can keep this or turn it into a vote (docs/milestones/M7-save-pause.md).
// No imports: the gate knows nothing of the database.

export type GateMode = "open" | "saving" | "loading";

let mode: GateMode = "open";
/** Who holds the pause, and since when (real ms). */
const holders = new Map<string, number>();
/** Real ms when the present pause began (null: not paused). */
let pausedAt: number | null = null;
/** Real ms spent paused so far. */
let pausedTotal = 0;
/** Model calls past the gate and not yet back to their caller. */
let inFlight = 0;
let wake: Array<() => void> = [];
const listeners: Array<(s: GateState) => void> = [];

export interface GateState {
  paused: boolean;
  mode: GateMode;
  in_flight: number;
  holders: string[];
}

function changed(): void {
  const w = wake;
  wake = [];
  for (const f of w) f();
  const s = gateState();
  for (const l of listeners) {
    try {
      l(s);
    } catch {
      /* a listener's trouble is its own */
    }
  }
}

/** Wait for the next change of the gate (pause, mode, a call ending). */
function nextChange(): Promise<void> {
  return new Promise((r) => wake.push(r));
}

export function gateState(): GateState {
  return { paused: holders.size > 0, mode, in_flight: inFlight, holders: [...holders.keys()] };
}

export function onGateChange(f: (s: GateState) => void): void {
  listeners.push(f);
}

export function isPaused(): boolean {
  return holders.size > 0;
}

export function gateMode(): GateMode {
  return mode;
}

export function callsInFlight(): number {
  return inFlight;
}

/**
 * Pause or unpause for one holder. The game is paused while anyone holds it. Returns whether the
 * game is paused now. `now` is real time (tests pass their own).
 */
export function setPaused(holder: string, on: boolean, now = Date.now()): boolean {
  const was = holders.size > 0;
  const key = String(holder).slice(0, 40) || "anon";
  if (on) {
    if (!holders.has(key)) holders.set(key, now);
  } else holders.delete(key);
  const is = holders.size > 0;
  if (!was && is) pausedAt = now;
  if (was && !is && pausedAt !== null) {
    pausedTotal += Math.max(0, now - pausedAt);
    pausedAt = null;
  }
  if (was !== is || on) changed();
  return is;
}

/** Holders not in `alive` that have held the pause longer than `graceMs` let go (a tab that went away without a word). */
export function sweepHolders(alive: ReadonlySet<string>, graceMs = 60_000, now = Date.now()): string[] {
  const gone: string[] = [];
  for (const [h, since] of holders) if (!alive.has(h) && now - since > graceMs) gone.push(h);
  for (const h of gone) setPaused(h, false, now);
  return gone;
}

/**
 * Real time less the time spent paused: the clock for the engine's real-second timers (a talk that
 * goes stale, a freshness window). It stands still while the game is paused.
 */
export function playNow(now = Date.now()): number {
  return (pausedAt ?? now) - pausedTotal;
}

/** Before a model call starts: wait while the game is paused, saving or loading. */
export async function waitToStart(): Promise<void> {
  while (holders.size > 0 || mode !== "open") await nextChange();
}

/** A call's answer is back: while paused it waits for the unpause (a save or a load lets it through at once). */
export async function holdResult(): Promise<void> {
  while (holders.size > 0 && mode === "open") await nextChange();
}

export function callBegan(): void {
  inFlight++;
}

export function callEnded(): void {
  inFlight = Math.max(0, inFlight - 1);
  changed();
}

/** Wait until no model call is in flight and their callers have applied the answers (at most maxMs). */
export async function drain(maxMs = 30_000): Promise<boolean> {
  const end = Date.now() + maxMs;
  for (;;) {
    while (inFlight > 0) {
      const left = end - Date.now();
      if (left <= 0) return false;
      await Promise.race([nextChange(), new Promise((r) => setTimeout(r, Math.min(left, 1000)))]);
    }
    // the callers apply the answers after callClaude returns: let their code run (awaits included)
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 10));
    if (inFlight === 0) return true;
  }
}

let turn: Promise<unknown> = Promise.resolve();

/**
 * Close the gate for a save or a load: no new model call starts, the ones in flight finish and are
 * applied, then `fn` runs, then the gate opens again. One at a time (a second save waits its turn).
 */
export function withGate<T>(m: Exclude<GateMode, "open">, fn: (drained: boolean) => Promise<T> | T, maxDrainMs = 30_000): Promise<T> {
  const run = async () => {
    mode = m;
    changed();
    try {
      const drained = await drain(maxDrainMs);
      return await fn(drained);
    } finally {
      mode = "open";
      changed();
    }
  };
  const p = turn.then(run, run);
  turn = p.catch(() => {});
  return p;
}

/** Wait until the gate is open (not saving or loading; a pause does not count). */
export async function waitOpen(): Promise<void> {
  while (mode !== "open") await nextChange();
}

/** Tests only: back to open, not paused, nothing in flight. */
export function resetGate(): void {
  mode = "open";
  holders.clear();
  pausedAt = null;
  pausedTotal = 0;
  inFlight = 0;
  changed();
}
