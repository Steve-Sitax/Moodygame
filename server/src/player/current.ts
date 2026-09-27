import { AsyncLocalStorage } from "node:async_hooks";

// M8c multiplayer: "each his own man" (docs/multiplayer-plan.md 9, first row; docs/milestones/M8c.md).
//
// Which player a piece of work is for. Every request runs inside its player's context (mp/index.ts sets it from
// the token: the host is 1, a guest his own id), and so does the work the server does for one player on its own
// (the hour's needs, a push). The engine's queries of the player's own things (money, needs, pockets, the job in
// hand, trust, what the townspeople think of him, his room) ask `pid()` instead of a fixed 1; they need no new
// parameter, and played alone everything is player 1 as before.
//
// Outside any context (the server's own work for the world: the director, the clock, the tests' plain calls)
// pid() is 1, the host: the world's work that names "the player" names the host until M8d gives it everyone.

const ctx = new AsyncLocalStorage<number>();

/** The player this work is for (1: the host, and anything outside a player's context). */
export function pid(): number {
  return ctx.getStore() ?? 1;
}

/** Run `fn` as player `id` (everything it calls, and everything it awaits, asks pid() and gets id). */
export function asPlayer<T>(id: number, fn: () => T): T {
  return ctx.run(id, fn);
}
