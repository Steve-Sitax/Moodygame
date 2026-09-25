// The night (M7 night, Steve 2026-09-25: "Do not do the wake-at-dawn forcing. We must be able to
// work through the night."). ONE place for the night's hours and rules that the server and the
// client both need: when the day employers stand at their post, when the shady givers are out,
// what counts as dark for a gang, how long a sleep lasts. No imports (read by node and by vite).
// See docs/milestones/M7-night.md.

/** Hours with a fraction; a span may run past midnight (26 is 2:00 the next morning). */
export type Span = [from: number, to: number];

/** Is hour h (0..24, with a fraction) inside the span (which may run past 24)? */
export function inSpan(h: number, s: Span): boolean {
  const x = ((h % 24) + 24) % 24;
  return (x >= s[0] && x < s[1]) || (x + 24 >= s[0] && x + 24 < s[1]);
}

/**
 * The Rijnkaai's own people (people.ts on the client, npcs.ts PLACED on the server) stand at their
 * post in these hours and are at home asleep outside them. Sooi is at the hiring from 5:00 and goes
 * home at 20:00; the widow keeps shop hours; Fientje sells from dawn to the evening; Tuur rows by
 * day and lights goods about the river until 2:00. The town's employers keep their schedule
 * (town/population.ts: 6:00 to 22:00, Sunday from 11:00).
 */
export const POST_HOURS: Record<string, Span> = {
  sooi: [5, 20],
  peeters: [7, 19],
  fientje: [6, 18],
  tuur: [7, 26],
};

/** At the post now? Anyone not in POST_HOURS (the sailor on deck) is always there. */
export function atPost(id: string, h: number): boolean {
  const s = POST_HOURS[id];
  return !s || inSpan(h, s);
}

/** The shady givers' hours (server night/givers.ts): out from 21:00, gone at 5:00. */
export const NIGHT_WORK: Span = [21, 29];
/** A night job must be done by this hour of the next morning (the giver is gone then). */
export const NIGHT_WORK_ENDS = 5;

/** Dark enough for a gang: from 21:00 to 5:00 (the lamps are lit from about 17:30 to 6:30). */
export const GANG_HOURS: Span = [21, 29];

/** The director's night: only night events (a burglary, smugglers, a brawl, the watch, a fire). */
export const NIGHT_EVENTS: Span = [22, 29];

/**
 * How long Jef sleeps, in game minutes, from when he lies down: seven hours rested, eight dead tired
 * (the sleep need 10 .. 0), in whole five minutes. He then wakes on his own.
 */
export function sleepMinutes(sleepNeed: number): number {
  const s = Math.max(0, Math.min(10, sleepNeed));
  return Math.round((420 + (10 - s) * 6) / 5) * 5;
}

/** Sleep need at which Jef is very tired: slower, and the view swims (the client). */
export const TIRED_AT = 2;
/** Sleep need at which he drops where he stands. */
export const COLLAPSE_AT = 0;

/** The givers of night work (server town/places.ts NIGHT_GIVERS has their posts and notes; a test keeps the two lists alike). */
export const NIGHT_GIVER_IDS = ["fence", "smuggler", "nightcarter", "cracksman"] as const;
