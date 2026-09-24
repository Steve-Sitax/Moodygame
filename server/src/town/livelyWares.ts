// What the street sellers of the back streets sell (M6 lively, Steve 2026-09-24), at ENGINE
// prices (docs/03: prices are engine code). trade.ts adds these to its items and wares; buying
// goes through the ordinary trade rules (only while the seller is at work, a pocket slot, the
// haggling floor, the event and news factors).
//
// The game's prices are its own scale (a job pays 50 to 150 c, rye bread 6 c, a pot of beer 5 c),
// so these keep in proportion to them rather than to the real centimes of 1873. Real prices of
// the time, for the proportions (docs/milestones/M6-lively.md has the sources): a labourer earned
// about 2 to 3 francs a day; milk, mussels and coal were the poor's everyday goods.

export interface LivelyItem {
  name: string;
  food?: number;
  warmth?: number;
  health?: number;
  use?: "eat" | "drink";
  note?: string;
  atCounter?: boolean;
}

export const LIVELY_ITEMS: Record<string, LivelyItem> = {
  // the milk woman: poured from her copper can into a mug and drunk on the spot
  milk: { name: "a mug of fresh milk", food: 1, use: "drink" },
  // the baker's boy: rolls from the basket on his cart
  roll: { name: "a white roll", food: 1, use: "eat" },
  // the mussel seller: boiled mussels in a paper cone, a pinch of salt
  mussels: { name: "a cone of boiled mussels", food: 2, warmth: 1, use: "eat" },
  // the broom seller from the Kempen
  broom: { name: "a birch broom", note: "Birch twigs bound to a hazel stick. Every house in the lane has one like it." },
  // the rag-and-bone man sells what he bought yesterday
  scarf: { name: "an old woollen scarf", note: "Darned in three colours, but it keeps the wind off your neck." },
  // the knife grinder: a clasp knife, freshly ground
  knife: { name: "a clasp knife", note: "Horn handle, a blade he ground on his wheel while you waited." },
  // the coal man: a small bag of coal, for a stove (or to sell on)
  coal: { name: "a small bag of coal", note: "Heavy for its size, and black on everything it touches." },
  // the stalls against the cathedral
  candle: { name: "a votive candle", note: "Tallow, with a paper collar printed with Our Lady." },
  rosary: { name: "a rosary of wooden beads", note: "Boxwood beads on a cord, a tin cross." },
  holy_picture: { name: "a holy picture", note: "A small print of Our Lady of Antwerp, coloured by hand." },
};

/** Who sells what, by trade (the street sellers, the milk woman, the baker's boy, the stall keepers). */
export const LIVELY_WARES: Record<string, Array<{ kind: string; price_c: number }>> = {
  milk_woman: [{ kind: "milk", price_c: 3 }],
  baker_boy: [
    { kind: "roll", price_c: 2 },
    { kind: "bread", price_c: 6 },
  ],
  mussel_seller: [{ kind: "mussels", price_c: 5 }],
  broom_seller: [{ kind: "broom", price_c: 15 }],
  ragman: [{ kind: "scarf", price_c: 12 }],
  grinder: [{ kind: "knife", price_c: 35 }],
  coalman: [{ kind: "coal", price_c: 10 }],
  devotion_seller: [
    { kind: "candle", price_c: 3 },
    { kind: "holy_picture", price_c: 5 },
    { kind: "rosary", price_c: 20 },
  ],
};

/** What eating one feels like (trade.ts useItem). */
export const LIVELY_USE_TEXT: Record<string, string> = {
  roll: "White bread, soft inside. Gone in four bites.",
  mussels: "Hot, salty, a little sand between your teeth. You drink the juice from the last shells.",
};
