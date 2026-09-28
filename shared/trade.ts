// T3, the town's trade (docs/trade-plan.md part B; docs/milestones/T3-trade.md): the posts that keep a stock of food,
// what the town takes from them through the day, what comes in, and what a shortage does to the price. Pure data and
// pure functions: the server steps the ledger (server/src/trade/ledger.ts), the map and the client read it.
//
// The engine owns every number here (CLAUDE.md): no model call sets a stock or a price. Decided (Steve 2026-09-27):
// players move the stock, but food never runs out for a player: the last units are a floor kept for players, and at
// the floor the shop still sells, dear. Townspeople stop buying at the floor.

export type TradeGood = "bread" | "meat" | "fish";

export interface Post {
  id: string;
  /** In plain words (the map's card, the talk). */
  label: string;
  good: TradeGood;
  /** What the shelf holds at most, in units (loaves, portions, fish). */
  room: number;
  /** Below this the post sends for more (a price step up, and work for players). */
  order: number;
  /** The last units, kept for players: the town stops buying here. */
  floor: number;
  /** Open for the town's buying: [from, to) in hours, and on Sundays. */
  open: [number, number];
  sunday: boolean;
  /** Units the town takes an hour while open (the morning busier). */
  perHour: number;
  /** At the start of a week. */
  start: number;
}

export const POSTS: Post[] = [
  { id: "bakery_rijn", label: "the bakery by the Rijnkaai", good: "bread", room: 90, order: 25, floor: 4, open: [5.5, 18.5], sunday: false, perHour: 5, start: 66 },
  { id: "bakery_steen", label: "the bakery on the Steenplein", good: "bread", room: 90, order: 25, floor: 4, open: [5.5, 18.5], sunday: false, perHour: 6, start: 66 },
  { id: "butcher_vlees", label: "the butcher by the Vleeshuis", good: "meat", room: 40, order: 10, floor: 3, open: [6.5, 18.5], sunday: false, perHour: 2.5, start: 20 },
  { id: "vismarkt", label: "the fish stalls of the Vismarkt", good: "fish", room: 80, order: 15, floor: 4, open: [6, 17], sunday: false, perHour: 5, start: 14 },
];

export const POST_BY_ID: Record<string, Post> = Object.fromEntries(POSTS.map((p) => [p.id, p]));

/** Which wares come off which good's shelf. */
export const WARE_GOOD: Record<string, TradeGood> = {
  bread: "bread",
  roll: "bread",
  peperkoek: "bread",
  brawn: "meat",
  sausage: "meat",
  bacon: "meat",
  herring: "fish",
  eel: "fish",
};

/** The bake: loaves from a sack of flour (a 50 kg sack gives about 70 kg of bread; a loaf of a kilo, some lost). */
export const LOAVES_PER_SACK = 24;
/** A box of fish from the Vliet: its height (m; client game/fishBox.ts FISHBOX.h), and the fish in it. */
export const FISH_BOX_H = 0.24;
/** A box of fish from the Vliet: fish in it (herring and eel for the stalls). */
export const FISH_PER_BOX = 6;
/** The butcher's morning kill in his yard (a pig and a calf or two, off screen: a shut door, a sound): portions. */
export const KILL_AT = 7;
export function killPortions(day: number): number {
  // (the same every PC: a little more on Friday and Saturday, for Sunday)
  const dow = ((day - 1) % 7) + 1;
  return dow === 5 || dow === 6 ? 30 : 22;
}

/** The busier hours of the town's buying (bread early, fish at the morning market, meat before dinner). */
export function demandFactor(good: TradeGood, hour: number): number {
  if (good === "bread") return hour < 9 ? 2 : hour < 12 ? 1 : 0.6;
  if (good === "fish") return hour < 10 ? 1.8 : hour < 13 ? 1 : 0.5;
  return hour >= 10 && hour < 13 ? 1.6 : 0.8;
}

/** Is the post open to the town at this hour of this day (day 7, 14 ... Sundays)? */
export function postOpen(p: Post, day: number, hour: number): boolean {
  if (day % 7 === 0 && !p.sunday) return false;
  return hour >= p.open[0] && hour < p.open[1];
}

/**
 * The price by the stock (the plan's clamped band): a cheap good (under 10 c) at most +2 c or -1 c, a dear one at most a
 * fifth either way. At the floor or empty: the top of the band; under the order level: halfway; a full shelf: down.
 * Fish falls through the afternoon (it does not keep).
 */
export function stockPrice(list: number, p: Post, stock: number, hour: number): number {
  const cheap = list < 10;
  const up = (k: number) => (cheap ? list + Math.round(2 * k) : Math.round(list * (1 + 0.2 * k)));
  const down = (k: number) => (cheap ? Math.max(1, list - Math.round(k)) : Math.max(1, Math.round(list * (1 - 0.2 * k))));
  let price = list;
  if (stock <= p.floor) price = up(1);
  else if (stock < p.order) price = up(0.5);
  else if (stock >= p.room * 0.85) price = down(1);
  if (p.good === "fish" && stock > p.floor) {
    if (hour >= 15) price = Math.min(price, down(1));
    else if (hour >= 13) price = Math.min(price, down(0.5));
  }
  return Math.max(1, price);
}

/** What a seller says when the shelf is at the floor (the player still gets his food, dear). */
export const LAST_LINE: Record<TradeGood, string> = {
  bread: "\"The last loaves. The flour did not come; it costs you.\"",
  meat: "\"The last of this morning's. Dearer now.\"",
  fish: "\"That is the last of the boxes. You pay for it.\"",
};
