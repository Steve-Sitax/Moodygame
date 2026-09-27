import { CALL_QUEUE_WAIT_MS, CALLS_AT_ONCE, CALLS_PER_DAY, PLAYER_HOOKS, PLAYER_TEXT_HOOKS, callPlayers, playerCallShare, setCallPlayers } from "../config.ts";
import type { DB } from "../db.ts";
import { onlineIds, pid } from "../player/current.ts";

// M8d multiplayer: the AI budget per player and the call queue (docs/multiplayer-plan.md 8; Steve 2026-09-26: the
// host pays; no daily limit by default, a limit in the settings).
//
// - The day's calls (config.ts CALLS_PER_DAY, the host's setting) grow by one player's share for every player past
//   the first. Every budget check in the game reads that live number, so the world's shares hold once and the
//   reserve stays a reserve.
// - A player's own hooks (config.ts PLAYER_HOOKS: talk, typed lines, outcomes, letters, diary, dream, epilogue, the
//   room at night) may use at most one share a day each, counted by ai_call.player_id: a player out of his share gets
//   the hand-written lines; the others are not touched. With no limit set nothing is counted.
// - At most CALLS_AT_ONCE model calls run together; the rest wait in a queue, talk first, the world's hooks last.
// Played alone (one player in the game) none of this moves: the day is the setting, no share, no queue.

/** More than one player in the game now? (Keeps the day's size in step with the players.) */
export function together(): boolean {
  const n = onlineIds().length;
  if (n !== callPlayers()) setCallPlayers(n);
  return n > 1;
}

export const isPlayerHook = (hook: string): boolean => PLAYER_HOOKS.has(hook) || hook.startsWith("resident_");

/**
 * A hook's (or a LIKE pattern's) calls today, for a module's own share: a player's hooks count his own calls when
 * several play (each has his own share of talk), everything else the whole town's, as alone.
 */
export function callsToday(db: DB, day: number, hookLike: string, who = pid()): number {
  const own = together() && (isPlayerHook(hookLike) || hookLike === "resident%");
  if (own) return (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook LIKE ? AND player_id = ?").get(day, hookLike, who) as { n: number }).n;
  return (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook LIKE ?").get(day, hookLike) as { n: number }).n;
}

/** A player's calls of his own hooks today. */
export function playerCallsToday(db: DB, day: number, who = pid()): number {
  const rows = db.prepare("SELECT hook, COUNT(*) AS n FROM ai_call WHERE day = ? AND player_id = ? GROUP BY hook").all(day, who) as Array<{ hook: string; n: number }>;
  return rows.reduce((a, r) => a + (isPlayerHook(r.hook) ? r.n : 0), 0);
}

/**
 * May this call be booked? "day": the day's calls are used up; "share": the player's own share is (only played
 * together, with a limit set, for his own hooks). null: yes.
 */
export function budgetStop(db: DB, day: number, hook: string, who = pid()): "day" | "share" | null {
  const many = together();
  const used = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  if (used >= CALLS_PER_DAY) return "day";
  if (!many || !isPlayerHook(hook)) return null;
  const share = playerCallShare();
  if (share > 0 && playerCallsToday(db, day, who) >= share) return "share";
  return null;
}

/** What each player has left of his share today (the Together panel, the tests); null with no limit. */
export function sharesLeft(db: DB, day: number): Array<{ id: number; used: number; left: number | null }> {
  const share = playerCallShare();
  return onlineIds().map((id) => {
    const used = playerCallsToday(db, day, id);
    return { id, used, left: share > 0 ? Math.max(0, share - used) : null };
  });
}

// ------------------------------------------------------------------ the queue

/** Talk first (the player waits for the answer), then a player's other hooks, the world's hooks last. */
export function callRank(hook: string): number {
  if (PLAYER_TEXT_HOOKS.has(hook) || hook.startsWith("resident_") || hook === "dialogue" || hook === "free_reply") return 0;
  if (isPlayerHook(hook)) return 1;
  return 2;
}

interface Waiter {
  rank: number;
  seq: number;
  go: () => void;
}
let running = 0;
let seq = 0;
const waiting: Waiter[] = [];
/** Test seam: how many may run at once (CALLS_AT_ONCE). */
let atOnce = CALLS_AT_ONCE;
export function setCallsAtOnce(n: number | null): void {
  atOnce = n ?? CALLS_AT_ONCE;
}

/** The queue now (the tests, the dev panel). */
export function queueState(): { running: number; waiting: number } {
  return { running, waiting: waiting.length };
}

function next(): void {
  while (running < atOnce && waiting.length) {
    waiting.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
    const w = waiting.shift()!;
    running++;
    w.go();
  }
}

/**
 * A place among the calls that run: at once when played alone or when a place is free; else in the queue, by rank,
 * for at most `maxWaitMs`. Resolves to a release function, or null when the wait ran out (the caller takes its
 * fallback). Always call the release when the call is over.
 */
export function callSlot(hook: string, maxWaitMs = CALL_QUEUE_WAIT_MS): Promise<(() => void) | null> {
  const release = (() => {
    let done = false;
    return () => {
      if (done) return;
      done = true;
      running = Math.max(0, running - 1);
      next();
    };
  })();
  if (!together() || running < atOnce) {
    running++;
    return Promise.resolve(release);
  }
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const w: Waiter = {
      rank: callRank(hook),
      seq: seq++,
      go: () => {
        clearTimeout(timer);
        resolve(release);
      },
    };
    waiting.push(w);
    timer = setTimeout(() => {
      const i = waiting.indexOf(w);
      if (i < 0) return;
      waiting.splice(i, 1);
      resolve(null);
    }, Math.max(0, maxWaitMs));
  });
}

/** Test helper: an empty queue. */
export function resetCallQueue(): void {
  running = 0;
  waiting.length = 0;
  atOnce = CALLS_AT_ONCE;
}
