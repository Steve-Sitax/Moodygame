// The game clock's rate (M7 clock, Steve 2026-09-24: "in-game time goes way too fast").
// ONE place for it: the server's tick, the client's clock display, the event stage clocks,
// the hearse, the tower bell, the walk deadlines and the test kit all read these numbers.
// No imports: the server (node, .ts) and the client (vite) both read this file.
//
// One game hour is two real minutes: a game minute is two real seconds, the day from 6:00
// to midnight is 36 real minutes, the week about four hours of play. (Before M7 a game hour
// was 20 real seconds, six times faster.) See docs/milestones/M7-clock.md.

/** Real seconds one game minute takes. */
export const REAL_S_PER_GAME_MIN = 2;
/** Game minutes one real second takes. */
export const GAME_MIN_PER_REAL_S = 1 / REAL_S_PER_GAME_MIN;
/** Real seconds one game hour takes (120). */
export const REAL_S_PER_GAME_HOUR = 60 * REAL_S_PER_GAME_MIN;

/**
 * The server's tick: the client asks every TICK_EVERY_MS while Jef plays; the server moves the
 * clock TICK_MINUTES on (never more often than that, whatever the client sends). 5 game minutes
 * every 10 real seconds: whole minutes, twelve ticks an hour.
 */
export const TICK_MINUTES = 5;
export const TICK_EVERY_MS = TICK_MINUTES * REAL_S_PER_GAME_MIN * 1000;

/** Real seconds for this many game minutes. */
export const realS = (gameMin: number): number => gameMin * REAL_S_PER_GAME_MIN;
/** Game minutes for this many real seconds. */
export const gameMin = (realSeconds: number): number => realSeconds * GAME_MIN_PER_REAL_S;
