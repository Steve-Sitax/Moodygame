// M7 shops (docs/milestones/M7-shops.md): the town's shops and what the client and the server share about
// them. Pure data and pure functions, no imports of server or client code (both node and vite read it).
//
// Every shop is a house door the town gave a shopkeeper (server town/population.ts SHOPS for the old ones,
// server shops/town.ts NEW_SHOPS for the ones added in place to every town). Its inside stands in its own
// city house when the house is listed in shared/inworld_houses.json as "shop:<id>" (client world/shopRooms.ts).
// The engine owns the wares and their prices (server shops/wares.ts, trade.ts), the hours (the keeper's
// schedule) and who comes in (shopVisit below); the client only draws them.


/** A shop's trade as the interior and the sign see it (server trade ids). */
export type ShopTrade =
  | "baker"
  | "grocer"
  | "chandler"
  | "tobacconist"
  | "pawnbroker"
  | "cobbler"
  | "draper"
  | "butcher"
  | "colonial"
  | "apothecary"
  | "barber"
  | "hatter"
  | "roaster"
  | "printer"
  | "bookseller"
  | "clockmaker";

export interface ShopLook {
  /** The board over the door (upper case, one or two lines split by "|"). */
  sign: string;
  /** The bracket sign that hangs out over the pavement (client world/shopSigns.ts), if any. */
  hang?: "pretzel" | "hat" | "basin" | "boot" | "key" | "clock" | "book" | "pestle" | "bull" | "cup" | "anchor" | "balls";
  /** Board colour and letters (css). */
  board: [string, string];
  /** What the shop smells of (the line as Jef comes in). */
  smell: string;
  /** How often townspeople on their errands call (weight). */
  weight: number;
  /** Who calls: all, men only, women more. */
  who?: "men" | "women";
}

export const SHOP_LOOK: Record<ShopTrade, ShopLook> = {
  baker: { sign: "BAKERY", hang: "pretzel", board: ["#1a2e1f", "#d8b85c"], smell: "Warm bread and flour dust. The oven ticks behind the back wall.", weight: 5 },
  grocer: { sign: "GROCER|VEGETABLES AND FRUIT", board: ["#15140f", "#d6c285"], smell: "Earth on the potatoes, onions, apples going soft in a crate.", weight: 4 },
  chandler: { sign: "SHIP CHANDLER", hang: "anchor", board: ["#14161a", "#d1c7a8"], smell: "Tar, hemp and lamp oil. Coils of rope hang from the beams.", weight: 1 },
  tobacconist: { sign: "TOBACCO|CIGARS", board: ["#42281a", "#e0c26c"], smell: "Sweet shag and cigar boxes. A blue haze hangs under the ceiling.", weight: 2, who: "men" },
  pawnbroker: { sign: "BERG VAN BARMHARTIGHEID", board: ["#1c1c22", "#c9b27a"], smell: "Dust and camphor. Bundles with numbered tickets fill the shelves.", weight: 1 },
  cobbler: { sign: "COBBLER", hang: "boot", board: ["#15140f", "#e1d6b8"], smell: "Leather, wax and glue. Boots stand in rows waiting for their owners.", weight: 1 },
  draper: { sign: "LINEN AND CLOTH", board: ["#24332a", "#e0d6b3"], smell: "New cloth and starch. Bolts of wool stacked to the ceiling.", weight: 1, who: "women" },
  butcher: { sign: "BUTCHER", hang: "bull", board: ["#661410", "#e6dcbc"], smell: "Blood and sawdust, cold meat, a whiff of the smoke room.", weight: 3 },
  colonial: { sign: "COLONIAL GOODS|COFFEE - TEA - SUGAR", board: ["#141412", "#d2ab58"], smell: "Coffee, cinnamon and pepper. Sugar loaves in blue paper on the shelf.", weight: 3 },
  apothecary: { sign: "APOTHECARY", hang: "pestle", board: ["#1a2942", "#e6dcbc"], smell: "Camphor, vinegar and something bitter. Rows of white jars with Latin names.", weight: 1 },
  barber: { sign: "BARBER|SHAVE 3 C", hang: "basin", board: ["#e6ddc8", "#4d140f"], smell: "Soap, bay rum and wet hair. A razor scrapes a customer's cheek.", weight: 2, who: "men" },
  hatter: { sign: "HATTER", hang: "hat", board: ["#1f1a29", "#d6c79a"], smell: "Felt, steam and brushed beaver. Hats stand on wooden heads.", weight: 1 },
  roaster: { sign: "COFFEE ROASTER", hang: "cup", board: ["#241712", "#d9b06a"], smell: "Roasting coffee, dark and smoky. The drum turns over the fire.", weight: 2 },
  printer: { sign: "PRINTER|BOOKBINDER", board: ["#141412", "#d6ccb0"], smell: "Printer's ink and paper. The press creaks and thumps.", weight: 0.5 },
  bookseller: { sign: "BOOKS|OLD AND NEW", hang: "book", board: ["#2a1e14", "#ddcc9c"], smell: "Old paper, leather bindings and dust.", weight: 0.5 },
  clockmaker: { sign: "CLOCKMAKER", hang: "clock", board: ["#141412", "#d6b766"], smell: "Oil and brass. A dozen clocks tick out of step.", weight: 0.3 },
};

/** The shops added in place to every town (server shops/town.ts): the old ones are server town/places.ts SHOPS. */
export interface NewShopDef {
  id: string;
  label: string;
  trade: ShopTrade;
  /** Anchor (world metres) the door is looked for near, when its listed house is not free. */
  x: number;
  z: number;
  /** Goods on a table by the door (client game/stalls.ts), or none. */
  goods: "bread" | "veg" | "wares" | "fish" | "cloth" | null;
  /** The keeper's look (client humans.ts kind) and sex. */
  kind: string;
  sex: "m" | "f";
  /** Opening hours (the keeper's working day), Monday to Saturday; Sunday's if any. */
  hours: Array<[number, number]>;
  sunday?: Array<[number, number]>;
  /** Older saves keep existing households at their addresses. */
  onlyVacant?: boolean;
}

export const NEW_SHOPS: NewShopDef[] = [
  { id: "butcher_vlees", label: "the butcher by the Vleeshuis", trade: "butcher", x: -92, z: 69, goods: null, kind: "shopkeeper", sex: "m", hours: [[6.5, 12.5], [13.5, 18.5]] },
  { id: "colonial_steen", label: "the colonial goods shop by the Steenplein", trade: "colonial", x: -200, z: 49, goods: "wares", kind: "shopkeeper", sex: "m", hours: [[7.5, 12.5], [13.5, 19.5]] },
  { id: "apothecary_markt", label: "the apothecary by the Handschoenmarkt", trade: "apothecary", x: -213, z: 124, goods: null, kind: "gentleman", sex: "m", hours: [[8, 12.5], [13.5, 20]], sunday: [[9.5, 11]] },
  { id: "barber_lane", label: "the barber in the back lane", trade: "barber", x: -0.3, z: 82.7, goods: null, kind: "shopkeeper", sex: "m", hours: [[7, 12], [13, 20]], sunday: [[7, 10]] },
  { id: "hatter_markt", label: "the hatter behind the Grote Markt", trade: "hatter", x: -304, z: 93, goods: null, kind: "gentleman", sex: "m", hours: [[8.5, 12.5], [13.5, 19]] },
  { id: "roaster_canal", label: "the coffee roaster by the canal", trade: "roaster", x: -32, z: 106, goods: "wares", kind: "shopkeeper", sex: "m", hours: [[7, 12.5], [13.5, 18.5]] },
  { id: "printer_jezuiet", label: "the printer by the Jesuits' church", trade: "printer", x: -112, z: 148, goods: null, kind: "clerk", sex: "m", hours: [[7, 12], [13, 18.5]] },
  { id: "books_kathedraal", label: "the bookseller behind the cathedral", trade: "bookseller", x: -200, z: 164, goods: "wares", kind: "old_man", sex: "m", hours: [[9, 12.5], [14, 19]] },
  { id: "clock_markt", label: "the clockmaker by the Grote Markt", trade: "clockmaker", x: -195, z: 88, goods: null, kind: "old_man", sex: "m", hours: [[8.5, 12.5], [13.5, 18.5]] },
  { id: "bakery_south", label: "the bakery in the southern lanes", trade: "baker", x: -210.56, z: 236.33, goods: "bread", kind: "baker", sex: "m", hours: [[6, 12.5], [14, 18]], sunday: [[7, 11]], onlyVacant: true },
  { id: "grocer_south", label: "the grocer in the southern neighbourhood", trade: "grocer", x: -121.86, z: 260.91, goods: "veg", kind: "shopkeeper", sex: "f", hours: [[7, 12.5], [14, 19]], onlyVacant: true },
  { id: "cobbler_east", label: "the cobbler in the eastern back streets", trade: "cobbler", x: 7.31, z: 213.72, goods: null, kind: "old_man", sex: "m", hours: [[8, 12], [13, 18.5]], onlyVacant: true },
];

/** The trade of a shop by its id (the old ones by their server trade). */
export const OLD_SHOP_TRADE: Record<string, ShopTrade> = {
  bakery_rijn: "baker",
  bakery_steen: "baker",
  grocer_canal: "grocer",
  grocer_werf: "grocer",
  chandler_werf: "chandler",
  tobacco_markt: "tobacconist",
  pawn_vis: "pawnbroker",
  cobbler_lane: "cobbler",
  draper_markt: "draper",
};

export function shopTrade(id: string): ShopTrade | null {
  return OLD_SHOP_TRADE[id] ?? NEW_SHOPS.find((s) => s.id === id)?.trade ?? null;
}

// ------------------------------------------------------------------ who comes in (engine; client and server alike)

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** A townsperson as the callers' roll needs them: what the schedule says now, and where that is. */
export interface Shopper {
  id: string;
  sex: "m" | "f";
  age: number;
  trade: string;
  /** server town/schedule.ts activityAt now: the act and the hours left of it. */
  act: string;
  left: number;
  /** Where they are about now (the act's place, else their home's step). */
  pos: [number, number];
}

/** A shop as the roll needs it. */
export interface OpenShop {
  id: string;
  door: [number, number];
  open: boolean;
}

/** A call starts this many game minutes into the hour (the walk there from the hour's start) and lasts to its end. */
export const VISIT_FROM_MIN = 20;
/** How far away a caller may be about (m): the walk must fit in those minutes. */
export const CALL_NEAR = 140;
/** Men about the town who drop in: idling (the schedule's "loiter"), sailors ashore, old hands. */
const ROAMERS = new Set(["sailor", "retired"]);

/** Callers an open shop has in an hour: by its trade's weight, busier in the morning and before supper (engine). */
function callersWanted(shop: string, t: ShopTrade, day: number, hr: number): number {
  const w = SHOP_LOOK[t].weight;
  const busy = (hr >= 8 && hr < 11) || (hr >= 16 && hr < 18) ? 1.5 : 1;
  const roll = (hash(`${shop}:${day}:${hr}:n`) % 1000) / 1000;
  // expected callers an hour: about 0.5 for the rare trades, 2 for the baker in the morning
  const mean = Math.min(2.6, (0.45 + 0.3 * w) * busy);
  return Math.floor(mean + roll);
}

/** May this person call at a shop of this trade now? */
function eligible(p: Shopper, t: ShopTrade): boolean {
  if (p.age < 12) return false;
  const look = SHOP_LOOK[t];
  if (look.who === "men" && p.sex !== "m") return false;
  if (p.act === "market") return true;
  if (p.act === "stroll") return ["tobacconist", "bookseller", "hatter", "clockmaker", "roaster", "apothecary", "draper", "colonial"].includes(t);
  const idleMan = p.sex === "m" && (p.act === "loiter" || (p.act === "work" && ROAMERS.has(p.trade)));
  if (idleMan) return ["tobacconist", "barber", "roaster", "butcher", "cobbler", "chandler", "pawnbroker", "hatter", "printer", "bookseller"].includes(t);
  return false;
}

/**
 * Who calls at which shop in this game hour (resident id -> shop id), the engine's roll: each open shop wants a
 * few callers (callersWanted) and takes them from the townspeople about near it whose errand or idle hour runs to
 * the hour's end, nearest first with a roll, each person at one shop at most (the shops in id order). The same
 * answer on the server (shops/state.ts: who is inside) and in the client (game/town.ts: who walks to the door).
 */
export function shopCallers(people: Shopper[], day: number, hour: number, shops: OpenShop[]): Map<string, string> {
  const hr = Math.floor(hour);
  const rest = 1 - (hour - hr);
  const out = new Map<string, string>();
  const free = people.filter((p) => p.left >= rest - 1e-6);
  for (const s of [...shops].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!s.open) continue;
    const t = shopTrade(s.id);
    if (!t) continue;
    let want = callersWanted(s.id, t, day, hr);
    if (!want) continue;
    const cands = free
      .filter((p) => !out.has(p.id) && eligible(p, t))
      .map((p) => ({ p, k: Math.hypot(p.pos[0] - s.door[0], p.pos[1] - s.door[1]) }))
      .filter((c) => c.k < CALL_NEAR)
      // nearest first, shaken a little by the hour so the same neighbour does not call every time
      .map((c) => ({ ...c, k: c.k + (hash(`${c.p.id}:${s.id}:${day}:${hr}`) % 60) }))
      .sort((a, b) => a.k - b.k);
    for (const c of cands) {
      if (want-- <= 0) break;
      out.set(c.p.id, s.id);
    }
  }
  return out;
}
