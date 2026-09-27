// M8e part B (docs/milestones/M8e.md): the movement socket's line over a VPN.
// - A dropped socket comes back by itself: 1, 2, 4, 8, then every 15 s (a tenth either way, so two PCs that
//   lost the host together do not knock at once); at once when the browser says it is online again.
// - A line that died without a word (a VPN that dropped, no close) is found by the pings: session.ts pings every
//   second; no answer to a ping for DEAD_MS and the socket is given up and opened again. (A hidden tab's timers
//   may run once a minute: what counts is the time since the first unanswered ping, not since the last message.)
// - The player sees a small note, never a dialog: "Connection lost, trying again..."; after 2 minutes a clear one.
// The pure parts (the waits, the liveness, the words) have no DOM: client/test/link.test.mjs runs them in node.

export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 15_000;
/** No answer to a ping this long: the line is dead. Round trips over a VPN are 60-120 ms; a VPN's own reconnect a few seconds. */
export const DEAD_MS = 8_000;
/** A socket that is not open this long after asking (a dead VPN holds a connect for 20 s and more): asked again. */
export const CONNECT_MS = 10_000;
/** Lost this long: the note says so plainly. */
export const LONG_MS = 120_000;

/** The wait before the next try, after `attempt` tries that failed (0: the first wait). */
export function retryDelay(attempt: number, rand: () => number = Math.random): number {
  const base = Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.max(0, Math.min(10, attempt)));
  return Math.round(base * (0.9 + 0.2 * rand()));
}

/**
 * M8e review 4: the push socket (/ws, net/api.ts connectPush) pings every PUSH_PING_MS; no answer (nothing at all
 * came) for PUSH_DEAD_MS after a ping and the socket is given up and opened again. Its server pings every 10 s and
 * closes one that missed the last pong.
 */
export const PUSH_PING_MS = 10_000;
export const PUSH_DEAD_MS = 25_000;

/** The first unanswered ping: set when one goes out and none is waiting, cleared by anything that comes in. */
export class Liveness {
  private since: number | null = null;
  private readonly deadMs: number;
  constructor(deadMs: number = DEAD_MS) {
    this.deadMs = deadMs;
  }
  heard(): void {
    this.since = null;
  }
  /** A ping goes out now. */
  pinged(now: number): void {
    if (this.since === null) this.since = now;
  }
  /** Before the next ping: has the line been silent too long? */
  dead(now: number): boolean {
    return this.since !== null && now - this.since > this.deadMs;
  }
  reset(): void {
    this.since = null;
  }
}

/** The note's words: lost `ms` ago (null: the line is up). `ever`: this tab was in the game before. */
export function noteText(ms: number | null, ever: boolean): string | null {
  if (ms === null) return null;
  if (ms >= LONG_MS) return "The host's game has not answered for 2 minutes. Is it still running there, and is the VPN on? Still trying every 15 s.";
  return ever ? "Connection lost, trying again..." : "The host's game does not answer yet, trying again...";
}

// ------------------------------------------------------------------ the note (DOM, only when called)

let el: HTMLDivElement | null = null;
let hideTimer = 0;

/** Show the note (null: hide it). `brief`: gone again after a few seconds. */
export function showNote(text: string | null, brief = false): void {
  if (typeof document === "undefined") return;
  clearTimeout(hideTimer);
  if (!text) {
    if (el) el.style.opacity = "0";
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.className = "mp-link-note";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText =
      "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:1900;max-width:min(560px,86vw);padding:6px 14px;" +
      "font:italic 15px var(--f-print, Georgia, serif);color:var(--ink, #221b15);background:var(--paper, #ddd3b9);" +
      "box-shadow:0 4px 14px rgba(0,0,0,0.45);pointer-events:none;opacity:0;transition:opacity 0.4s;text-align:center";
    document.body.appendChild(el);
  }
  if (el.textContent !== text) el.textContent = text;
  el.style.opacity = "0.94";
  if (brief) hideTimer = window.setTimeout(() => el && (el.style.opacity = "0"), 3000);
}

// ------------------------------------------------------------------ M8e review 4: a 429 from the host

/** Retries of a call the host answered 429 ("too many requests"): at most this many. */
export const RETRY_429 = 2;
/** The longest Retry-After waited for; a longer one (the join tries' minute) is not retried: the error is shown. */
export const RETRY_AFTER_MAX_S = 5;

/**
 * How long to wait before trying a 429'd call again (ms), or null: not again (tried `tries` times already, or the
 * host asks for a wait longer than RETRY_AFTER_MAX_S). `header`: the Retry-After in seconds (missing: 1 s).
 */
export function retryAfterMs(header: string | null, tries: number): number | null {
  if (tries >= RETRY_429) return null;
  const s = header === null || header.trim() === "" ? 1 : Number(header);
  if (!Number.isFinite(s) || s < 0 || s > RETRY_AFTER_MAX_S) return null;
  return Math.max(200, Math.round(s * 1000));
}
