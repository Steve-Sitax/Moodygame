// M7 shops (docs/milestones/M7-shops.md): what the town's shops sell, at ENGINE prices (docs/03: prices
// are engine code). trade.ts adds these to its items and to the wares of each trade; buying goes through
// the ordinary trade rules (only while the keeper is at work, a pocket slot, the haggling floor, the event
// and news factors). No imports of trade.ts here (it imports this file).
//
// The game's own scale (a job pays 50 to 150 c, rye bread 6 c, a pot of beer 5 c, a lantern 40 c): the
// prices keep in proportion to those, not to the real centimes of 1873. Proportions of the time, for the
// feel: a shave 5 to 10 centimes, a pound of coffee about 1.5 francs, a clay pipe a few centimes, a cheap
// felt hat 2 to 3 francs, a plain silver watch 20 francs and up (docs/milestones/M7-shops.md, sources).

export interface ShopItem {
  name: string;
  food?: number;
  warmth?: number;
  health?: number;
  /** eat, drink, read as before; M7 shops: wear (put it on: warmth now) and smoke. */
  use?: "eat" | "drink" | "wear" | "smoke";
  note?: string;
  /** Had at the counter, never pocketed (a shave, a cup of coffee, boots mended while you wait). */
  atCounter?: boolean;
}

export const SHOP_ITEMS: Record<string, ShopItem> = {
  // the baker
  peperkoek: { name: "a slice of peperkoek", food: 1, use: "eat", note: "Honey cake with anise, dark and sticky." },
  // the butcher
  sausage: { name: "a smoked sausage", food: 3, use: "eat" },
  bacon: { name: "a piece of fat bacon", food: 4, warmth: 1, use: "eat" },
  brawn: { name: "a slice of brawn", food: 2, use: "eat", note: "Head cheese in its jelly, wrapped in a cabbage leaf." },
  // the grocer
  cheese: { name: "a wedge of cheese", food: 2, use: "eat" },
  // colonial goods
  candy: { name: "a twist of sugar candy", food: 1, use: "eat" },
  figs: { name: "a bag of dried figs", food: 2, use: "eat" },
  chocolate: { name: "a bar of chocolate", food: 2, warmth: 1, use: "eat" },
  tea: { name: "a packet of tea", note: "A quarter pound of black tea in a paper with a Chinese stamp. A present, or to sell." },
  // the tobacconist
  pipe: { name: "a clay pipe with shag", warmth: 1, use: "smoke", note: "A short white clay pipe, filled. Lit with a lucifer from the box on the counter." },
  cigar: { name: "a cigar", warmth: 1, use: "smoke", note: "A cheap Dutch cigar in a paper band." },
  matches: { name: "a box of lucifers", note: "Sulphur matches in a card box. They strike on anything." },
  // the apothecary
  syrup: { name: "a bottle of cough syrup", health: 1, use: "drink", note: "Brown, sweet and bitter, with a label in Latin." },
  powder: { name: "a fever powder", health: 2, use: "eat", note: "Quinine and chalk folded in a paper. Swallowed with water." },
  liquorice: { name: "a stick of liquorice", food: 1, use: "eat" },
  // the draper and the hatter: put on at once, the warmth now (the engine's number); the thing is worn from then on
  wool_vest: { name: "a knitted wool vest", warmth: 3, use: "wear", note: "Grey wool, thick as a blanket. It goes under your coat." },
  shawl: { name: "a woollen neckerchief", warmth: 2, use: "wear" },
  flat_cap: { name: "a cloth flat cap", warmth: 1, use: "wear", note: "Tweed, lined. It keeps the drizzle off your head." },
  felt_hat: { name: "a second-hand felt hat", warmth: 1, use: "wear", note: "A brown bowler with a worn band. You look almost like a clerk in it." },
  // the cobbler: mended while you wait, sitting in your stockings on his bench
  boot_mend: { name: "your boots mended", warmth: 1, atCounter: true },
  laces: { name: "a pair of leather laces", note: "Tanned thongs, long enough for any boot." },
  // the barber
  shave: { name: "a shave", atCounter: true },
  haircut: { name: "a haircut", atCounter: true },
  // the coffee roaster
  coffee: { name: "a cup of coffee", warmth: 2, use: "drink" },
  coffee_beans: { name: "a bag of roasted coffee", note: "Half a pound, still warm from the drum. A present fit for anyone." },
  // the printer and the bookseller
  almanac: { name: "a printed almanac", note: "This year's Antwerp almanac: saints' days, tides, the fairs and a few jokes." },
  paper_env: { name: "a sheet of paper and an envelope", note: "Good paper, for a letter of your own." },
  penny_book: { name: "a cheap novel", note: "Thirty pages of murder and a lost heiress, printed in Brussels." },
  prayer_book: { name: "a second-hand prayer book", note: "Leather worn to the board at the corners, somebody's name inside the cover." },
  // the clockmaker
  watch: { name: "a second-hand pocket watch", note: "Nickel case, a white dial, it keeps time if you wind it. The Berg lends on it." },
  watch_key: { name: "a watch key", note: "A small brass key on a ring." },
};

/** Who sells what (by trade), in centimes. The old shops' wares are in trade.ts; these add to them. */
export const SHOP_WARES: Record<string, Array<{ kind: string; price_c: number }>> = {
  butcher: [
    { kind: "brawn", price_c: 4 },
    { kind: "sausage", price_c: 7 },
    { kind: "bacon", price_c: 10 },
  ],
  colonial: [
    { kind: "candy", price_c: 2 },
    { kind: "figs", price_c: 5 },
    { kind: "chocolate", price_c: 6 },
    { kind: "tea", price_c: 18 },
  ],
  tobacconist: [
    { kind: "matches", price_c: 2 },
    { kind: "pipe", price_c: 4 },
    { kind: "cigar", price_c: 8 },
  ],
  apothecary: [
    { kind: "liquorice", price_c: 2 },
    { kind: "syrup", price_c: 15 },
    { kind: "powder", price_c: 30 },
  ],
  draper: [
    { kind: "shawl", price_c: 25 },
    { kind: "wool_vest", price_c: 45 },
  ],
  hatter: [
    { kind: "flat_cap", price_c: 25 },
    { kind: "felt_hat", price_c: 60 },
  ],
  cobbler: [
    { kind: "laces", price_c: 3 },
    { kind: "boot_mend", price_c: 12 },
  ],
  barber: [
    { kind: "shave", price_c: 3 },
    { kind: "haircut", price_c: 6 },
  ],
  roaster: [
    { kind: "coffee", price_c: 4 },
    { kind: "coffee_beans", price_c: 20 },
  ],
  printer: [
    { kind: "paper_env", price_c: 3 },
    { kind: "almanac", price_c: 10 },
  ],
  bookseller: [
    { kind: "penny_book", price_c: 8 },
    { kind: "prayer_book", price_c: 25 },
  ],
  clockmaker: [
    { kind: "watch_key", price_c: 5 },
    { kind: "watch", price_c: 150 },
  ],
};

/** More for the old shops' own lists (trade.ts): the baker's honey cake, the grocer's cheese, the chandler's matches. */
export const SHOP_WARES_MORE: Record<string, Array<{ kind: string; price_c: number }>> = {
  baker: [{ kind: "peperkoek", price_c: 3 }],
  grocer: [{ kind: "cheese", price_c: 6 }],
  chandler: [{ kind: "matches", price_c: 2 }],
};

/** What using one feels like (trade.ts useItem). */
export const SHOP_USE_TEXT: Record<string, string> = {
  peperkoek: "Sticky honey and anise. You lick your fingers after.",
  sausage: "Smoky and salty, the fat running down your chin.",
  bacon: "You cut it with your knife in thin slices. Fat and warm in the belly.",
  brawn: "Cold and trembling in its jelly, but it is meat.",
  cheese: "Hard yellow cheese, a little sweaty. Good with nothing at all.",
  candy: "You suck the brown sugar crystal slowly. Sweet for a long while.",
  figs: "Chewy and sweet, the little seeds crunch between your teeth.",
  chocolate: "Dark and gritty, it melts in your mouth. A rich man's thing.",
  pipe: "You strike a lucifer and draw. Warm smoke, and for a moment the fog is somebody else's.",
  cigar: "It burns hot and bitter. You feel like a merchant for a quarter of an hour.",
  syrup: "Thick and sweet, then bitter at the back of the throat. Your chest eases a little.",
  powder: "Chalky and very bitter. You wash it down and your head clears.",
  liquorice: "Black and salty-sweet. It lasts.",
  wool_vest: "You put it on under your coat. For the first time today the wind does not reach your ribs.",
  shawl: "You knot it round your neck. The draught down your collar stops.",
  flat_cap: "You pull it on. The drizzle runs off the peak instead of down your neck.",
  felt_hat: "You set it on your head and catch yourself in a window: almost a clerk.",
  coffee: "Black, strong and scalding. Warmth spreads from your middle to your fingers.",
};

/** What a counter service says (trade.ts buy's hand-over line), by kind. */
export const SHOP_SERVICE_LINE: Record<string, string> = {
  shave: "Lather, the razor scraping, a hot towel. Your cheeks tingle and the mirror shows a cleaner man.",
  haircut: "Snip, snip. The barber brushes the hair off your collar and holds up the glass.",
  boot_mend: "You sit in your stockings while he stitches the soles and hammers on new heels. Dry feet for a while.",
  coffee: "He pours from the pot on the stove into a thick white cup.",
};

/** What the Berg lends on of these (paper/pawn.ts PAWN_WORTH; the worth to the Berg, centimes). */
export const SHOP_PAWN_WORTH: Record<string, number> = { watch: 110, felt_hat: 30, prayer_book: 15 };

/** A shop item's list price (the lowest seller's), for the gifts' values (town/gifts.ts). */
export function shopPrice(kind: string): number | undefined {
  let best: number | undefined;
  for (const list of [...Object.values(SHOP_WARES), ...Object.values(SHOP_WARES_MORE)])
    for (const w of list) if (w.kind === kind && (best === undefined || w.price_c < best)) best = w.price_c;
  return best;
}
