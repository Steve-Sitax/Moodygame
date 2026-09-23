// Daily schedules of the residents (M3e). Pure code with no imports: the
// server uses it (is the shop open, where is she now, what is he doing) and
// the client imports the same file to move the town by the game clock.
//
// A schedule is a list of segments for an ordinary day and one for Sunday.
// Each segment says from which hour to which hour the person is doing what,
// and where. The engine owns this; no model ever writes a schedule.

export type Act =
  | "home" // indoors at home: not in the street
  | "work" // at the workplace, doing the trade (see WorkSpec)
  | "tavern" // standing at a tavern door with a drink and talk
  | "play" // children: play in a square or lane
  | "market" // errands: walk among the stalls
  | "church" // Sunday mass: go in at the cathedral door
  | "stroll" // a walk with the family (Sunday afternoon, summer evenings)
  | "loiter"; // hang about a place (thieves by day, beggars, idle sailors)

/** [from hour, to hour, what, where]; hours may pass 24 (a night till 2:00 is 20 to 26). */
export type Seg = [number, number, Act, string?];

export interface Schedule {
  day: Seg[];
  sunday: Seg[];
}

export interface Now {
  act: Act;
  /** Place id for tavern, play, market, church, stroll, loiter; the workplace for work; "home" for home. */
  place: string;
  /** Hours since this segment began. */
  since: number;
  /** Hours until it ends. */
  left: number;
}

export const SUNDAY = 7;

/** What a person does at this hour (fractional) of this day of the week (1 = Monday, 7 = Sunday). */
export function activityAt(s: Schedule, day: number, hour: number): Now {
  const segs = day % 7 === 0 ? s.sunday : s.day;
  const h = ((hour % 24) + 24) % 24;
  for (const [a, b, act, where] of segs) {
    // a segment may run past midnight (b > 24): test both this day's hour and the hour + 24
    for (const t of [h, h + 24]) {
      if (t >= a && t < b) return { act, place: where ?? (act === "work" ? "work" : "home"), since: t - a, left: b - t };
    }
  }
  return { act: "home", place: "home", since: 0, left: 1 };
}

/** Is this person out in the street at this time (not at home, not inside at work)? */
export function isOut(now: Now, indoorWork: boolean): boolean {
  if (now.act === "home") return false;
  if (now.act === "work" && indoorWork) return false;
  return true;
}
