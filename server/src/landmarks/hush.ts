import { sexed } from "../player/profile.ts"; // M7 character: lines said to the player follow the profile
import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { log } from "../game.ts";
import { getState, setState } from "../interiors/state.ts";
import { landmarkOpen, massAt } from "../../../shared/landmarks.ts";
import { jefInside } from "./life.ts";
import { pid } from "../player/current.ts";

// Running in the cathedral (M7, Steve 2026-09-24: "maybe people shouting where running is
// inappropriate"). The client sees Jef run with people near and says how many are near; the
// ENGINE decides the rest: whether it counts, who hisses which line (a small set of our own),
// the kerk's trust (a small engine amount, capped per day), and when the beadle asks him to
// leave. Nobody fights: the beadle walks him to the door. No model call.

export const HUSH = {
  /** Game minutes between two offences that count (30 real seconds; a game hour is two real minutes since M7). */
  COOLDOWN_MIN: 15,
  /** The kerk's trust lost for one offence, and at most in a day. */
  TRUST_STEP: 1,
  TRUST_CAP_PER_DAY: 2,
  /** Outside mass, a hiss costs trust only with this many looking. */
  WITNESSES_OUTSIDE_MASS: 3,
  /** The offence (in a day) at which the beadle puts him out, and for how long the door is shut to him (game minutes). */
  LEAVE_AT: 3,
  BAR_MIN: 60,
};

export type HushSpeaker = "beadle" | "churchgoer";

export interface HushResult {
  /** Did this run count (people near, the church open, not too soon after the last)? */
  counted: boolean;
  strike: number;
  /** The line hissed, and by whom (the client puts it over the beadle or the nearest churchgoer). */
  line: string;
  speaker: HushSpeaker;
  /** The kerk's trust change (0 or negative). */
  delta: number;
  /** The beadle asks him to leave (he is walked out to the square). */
  leave: boolean;
  /** A line for the toast, or "". */
  text: string;
}

const HISS_MASS: Array<{ who: HushSpeaker; text: string }> = [
  { who: "beadle", text: "No running in the house of God!" },
  { who: "churchgoer", text: "Shh! There is a mass on!" },
  { who: "beadle", text: "Walk, young man. The Lord is not in a hurry." },
  { who: "churchgoer", text: "Have you no shame? During the mass!" },
];
const HISS_QUIET: Array<{ who: HushSpeaker; text: string }> = [
  { who: "churchgoer", text: "Shh! Walk! This is a church, not the quay." },
  { who: "beadle", text: "Slowly in here. This is a church." },
  { who: "churchgoer", text: "Mind your feet. People are praying." },
];
const SECOND: Array<{ who: HushSpeaker; text: string }> = [
  { who: "beadle", text: "I told you once. Walk, or you go out." },
  { who: "beadle", text: "Again? One more time and you are out of here." },
];
const LEAVE_LINE = "That is enough. Out you go, and come back when you can walk like a Christian.";

const absMin = (c: { day: number; hour: number; minute: number }) => c.day * 1440 + c.hour * 60 + c.minute;
const kerkTrust = (db: DB) => (db.prepare("SELECT trust FROM faction_trust WHERE faction = 'kerk' AND player_id = ?").get(pid()) as { trust: number } | undefined)?.trust ?? 0;
/** M8c: each player's own strikes, day's loss and bar (the host keeps the older keys). */
const mine = (key: string) => (pid() === 1 ? key : `${key}:p${pid()}`);

/** Is Jef barred from the cathedral now (put out for running)? Until which game minute. */
export function hushBarred(db: DB): { barred: boolean; until: number } {
  const c = clock(db);
  const until = getState<number>(db, mine("hush:barred"), 0);
  return { barred: until > absMin(c), until };
}

/** Today's strikes and trust lost (for the tests and the dev panel). */
export function hushToday(db: DB): { strikes: number; lost: number } {
  const c = clock(db);
  return { strikes: getState<number>(db, mine(`hush:strikes:${c.day}`), 0), lost: getState<number>(db, mine(`hush:lost:${c.day}`), 0) };
}

/** Jef ran in the cathedral with `witnesses` people near (the client's count, clamped). */
export function ranInChurch(db: DB, witnesses: unknown): HushResult {
  const none: HushResult = { counted: false, strike: 0, line: "", speaker: "churchgoer", delta: 0, leave: false, text: "" };
  const n = typeof witnesses === "number" && Number.isFinite(witnesses) ? Math.max(0, Math.min(60, Math.floor(witnesses))) : 0;
  const c = clock(db);
  const hour = c.hour + c.minute / 60;
  if (n < 1 || jefInside() !== "cathedral" || !landmarkOpen("cathedral", c.day, hour)) return none;
  const now = absMin(c);
  const last = getState<number>(db, mine("hush:last"), -1e9);
  if (now - last < HUSH.COOLDOWN_MIN) return none;
  setState(db, mine("hush:last"), now);
  const strikesKey = mine(`hush:strikes:${c.day}`);
  const lostKey = mine(`hush:lost:${c.day}`);
  const strike = getState<number>(db, strikesKey, 0) + 1;
  setState(db, strikesKey, strike);
  const mass = !!massAt(c.day, hour);
  // the trust: during mass always, outside it only with a few looking; never past the day's cap
  const lost = getState<number>(db, lostKey, 0);
  const wants = mass || n >= HUSH.WITNESSES_OUTSIDE_MASS ? HUSH.TRUST_STEP : 0;
  const step = Math.max(0, Math.min(wants, HUSH.TRUST_CAP_PER_DAY - lost));
  const leave = strike >= HUSH.LEAVE_AT;
  let delta = 0;
  db.transaction(() => {
    if (step) {
      // what it really costs (the trust stops at -5): that is what counts against the day's cap
      const before = kerkTrust(db);
      db.prepare("UPDATE faction_trust SET trust = MAX(-5, MIN(10, trust - ?)) WHERE faction = 'kerk' AND player_id = ?").run(step, pid());
      delta = kerkTrust(db) - before;
      if (delta) setState(db, lostKey, lost - delta);
    }
    if (leave) {
      setState(db, mine("hush:barred"), now + HUSH.BAR_MIN);
      log(db, "put_out", "kerk", "The beadle put Jef out of the cathedral for running in the church.");
    } else if (delta) log(db, "ran_in_church", "kerk", mass ? "Jef ran in the cathedral during mass; the beadle hissed at him." : "Jef ran in the cathedral; people hissed at him.");
  })();
  const pick = <T>(list: T[]) => list[(strike + c.minute) % list.length];
  const hiss = leave ? { who: "beadle" as const, text: LEAVE_LINE } : strike >= 2 ? pick(SECOND) : pick(mass ? HISS_MASS : HISS_QUIET);
  const text = leave
    ? "The beadle takes you by the elbow, his staff in the other hand, and walks you down the nave and out of the west door. Nobody says a word. The door is shut to you for an hour."
    : delta
      ? "Heads turn along the rows. The church will remember that."
      : "Heads turn. You slow down.";
  return { counted: true, strike, line: sexed(db, hiss.text), speaker: hiss.who, delta, leave, text };
}
