// Market days (M3i). Pure code with no imports, like schedule.ts: the client imports
// the same file to put the stalls up and take them down by the game clock, and to send
// people browsing. The engine owns the hours; nothing here is ever a model's to change.
//
// After the period sources (layout only): Antwerp's fish was sold every weekday morning on
// the old Vismarkt by the Steen, the fishwives at their stone fish banks and at trestles
// and baskets on the stones round them, the auction early (Farasyn, "The old fish market",
// 1882). The Grote Markt kept a general market of vegetables, cheese, baskets and
// second-hand goods on Wednesdays and Saturdays.

export interface MarketDef {
  /** The town place it is held on (server town/places.ts). */
  place: string;
  label: string;
  /** Days of the week it is held (1 = Monday ... 7 = Sunday). */
  days: number[];
  /** The first stalls go up at `setup`; all are up by `open`; the first come down at `close`; by `gone` only the rest is left. */
  setup: number;
  open: number;
  close: number;
  gone: number;
  /**
   * The afternoon remainder (Steve, 2026-09-23): this share of the stalls stays after `gone`,
   * selling what is left, until `late`; all are packed by `lateGone`. 0 = a strict morning market.
   */
  rest: number;
  late: number;
  lateGone: number;
}

export const MARKET_DAYS: MarketDef[] = [
  { place: "vismarkt", label: "the fish market", days: [1, 2, 3, 4, 5, 6], setup: 5.5, open: 7, close: 12.5, gone: 14, rest: 0.35, late: 16.5, lateGone: 17.5 },
  { place: "grote_markt", label: "the Grote Markt market", days: [3, 6], setup: 6, open: 7.5, close: 13, gone: 14.5, rest: 0.3, late: 16.5, lateGone: 17.5 },
];

export function marketFor(place: string): MarketDef | null {
  return MARKET_DAYS.find((m) => m.place === place) ?? null;
}

/**
 * How much of the market stands at this hour: 0 (none) to 1 (every stall up). It rises
 * from setup to open and falls from close to gone; stall k of n is up while k < share * n.
 */
export function marketShare(place: string, day: number, hour: number): number {
  const m = marketFor(place);
  if (!m) return 0;
  const d = ((((day - 1) % 7) + 7) % 7) + 1;
  if (!m.days.includes(d)) return 0;
  const h = ((hour % 24) + 24) % 24;
  if (h < m.setup || h >= m.lateGone) return 0;
  if (h < m.open) return (h - m.setup) / (m.open - m.setup);
  if (h < m.close) return 1;
  // the morning market packs up down to the afternoon remainder, which packs up in its turn
  if (h < m.gone) return 1 - (1 - m.rest) * ((h - m.close) / (m.gone - m.close));
  if (h < m.late) return m.rest;
  return m.rest * (1 - (h - m.late) / (m.lateGone - m.late));
}

/** Is the market in full swing (people come to buy)? A little before it is fully up, and until it starts to pack. */
export function marketOn(place: string, day: number, hour: number): boolean {
  // the full market from a little before it is up; the afternoon remainder draws buyers too
  return marketShare(place, day, hour) >= 0.25;
}
