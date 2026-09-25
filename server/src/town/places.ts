// Places of the town (M3e): where people work, drink, play, shop and pray.
// Anchors in world metres on the compact map (shared/city.json; x along the
// river, z inland, water at z < 0). The generator snaps every point to open,
// reachable ground (walkmap.ts), so a map change moves them, not breaks them.

import type { Faction } from "../db.ts";

/** How a trade is done at the workplace (the client plays each kind). */
export type WorkKind =
  | "haul" // back and forth between a quay point (a) and a door (b), a load each way
  | "stall" // behind a market stall
  | "shop" // at the shop table by the own door
  | "tavern" // the publican at his door
  | "patrol" // walk a round of points (police, the lamplighter)
  | "roam" // walk about the place (carters, sailors, boatmen, errand boys)
  | "inside" // work indoors: go in at the door and vanish (clerks, maids, seamstresses)
  | "beg" // stand or sit by a church door or a bridge
  | "post" // stand at one point (employers, the priest at his door)
  | "guard" // a sentry at his post (at), relieved every two hours from the guard room (garrison.ts)
  | "inspect" // a customs officer: from one landing of goods to the next (route), checking and writing
  | "wait" // M6 emigrants (emigrants.ts): by the family's chests on the quay, sitting on one (seat) or standing (at)
  | "round"; // M6 lively (lively.ts): a round of doors in the back streets (route), a stop at each (faces: toward the door)

export interface Place {
  id: string;
  label: string;
  x: number;
  z: number;
  /** Radius people spread over. */
  r: number;
  district: string;
}

/** Workplaces with a fixed anchor. Shops and taverns are house doors found near an anchor. */
export const PLACES: Place[] = [
  { id: "rijnkaai", label: "the Rijnkaai", x: 0, z: 18, r: 22, district: "rijnkaai" },
  { id: "hessenatie", label: "the Hessenatie", x: 11.2, z: 43.5, r: 8, district: "rijnkaai" },
  { id: "entrepot", label: "the Entrepot", x: 173, z: 83, r: 12, district: "eilandje" },
  { id: "bassin", label: "the Petit Bassin", x: 120, z: 18, r: 20, district: "eilandje" },
  { id: "bassin_south", label: "the south quay of the Petit Bassin", x: 118, z: 117, r: 14, district: "eilandje" },
  { id: "werf", label: "the Werf", x: -275, z: 7, r: 30, district: "werf" },
  { id: "steenplein", label: "the Steenplein", x: -182, z: 22, r: 20, district: "steenplein" },
  { id: "vismarkt", label: "the Vismarkt", x: -116, z: 26, r: 18, district: "vismarkt" },
  { id: "canal", label: "the Canal des Brasseurs", x: -65, z: 110, r: 30, district: "canal" },
  { id: "grote_markt", label: "the Grote Markt", x: -254, z: 94, r: 24, district: "grote-markt" },
  { id: "cathedral", label: "the cathedral door", x: -262, z: 140, r: 8, district: "grote-markt" },
  { id: "handschoenmarkt", label: "the Handschoenmarkt", x: -250, z: 135, r: 14, district: "grote-markt" },
  { id: "vleeshuis", label: "the Vleeshuis", x: -116, z: 88, r: 12, district: "vismarkt" },
  { id: "back_lane", label: "the lane behind the Rijnkaai", x: 0, z: 69, r: 20, district: "rijnkaai" },
  { id: "town_hall", label: "the town hall", x: -282, z: 94, r: 6, district: "grote-markt" },
];

/** Squares and lanes where children play and people stroll. */
export const PLAY = ["steenplein", "vismarkt", "back_lane", "grote_markt", "handschoenmarkt", "bassin_south", "canal"];
/** Where wives and maids do their errands. */
export const MARKETS = ["grote_markt", "vismarkt"];

/** Shops: a house door near the anchor becomes the shop; the family lives above it. */
export interface ShopDef {
  id: string;
  label: string;
  trade: TradeId;
  x: number;
  z: number;
  goods: "bread" | "veg" | "wares" | "fish" | "cloth" | null;
}
export const SHOPS: ShopDef[] = [
  { id: "bakery_rijn", label: "the bakery behind the Rijnkaai", trade: "baker", x: 10, z: 72, goods: "bread" },
  { id: "bakery_steen", label: "the bakery on the Steenplein", trade: "baker", x: -200, z: 40, goods: "bread" },
  { id: "grocer_canal", label: "the grocer by the canal", trade: "grocer", x: -58, z: 70, goods: "veg" },
  { id: "grocer_werf", label: "the grocer on the Werf", trade: "grocer", x: -250, z: 28, goods: "veg" },
  { id: "chandler_werf", label: "the ship's chandler on the Werf", trade: "chandler", x: -290, z: 14, goods: "wares" },
  { id: "tobacco_markt", label: "the tobacconist on the Grote Markt", trade: "tobacconist", x: -230, z: 64, goods: "wares" },
  { id: "pawn_vis", label: "the pawnshop by the Vleeshuis", trade: "pawnbroker", x: -140, z: 82, goods: null },
  { id: "cobbler_lane", label: "the cobbler in the back lane", trade: "cobbler", x: -30, z: 72, goods: "wares" },
  { id: "draper_markt", label: "the draper on the Handschoenmarkt", trade: "draper", x: -230, z: 146, goods: "cloth" },
];

export interface TavernDef {
  id: string;
  label: string;
  x: number;
  z: number;
}
export const TAVERNS: TavernDef[] = [
  { id: "ankere", label: "In de Ankere", x: -52, z: 46 },
  { id: "schipke", label: "Het Schipke", x: -236, z: 14 },
  { id: "vliet", label: "De Vliet", x: -120, z: 50 },
  { id: "engel", label: "Den Engel", x: -240, z: 64 },
  { id: "bassin", label: "Het Bassin", x: 100, z: 124 },
];

/** Market stalls: where they stand and what they sell. Stalls face +face (a unit vector). */
export interface StallDef {
  place: string;
  x: number;
  z: number;
  /** Direction the customers stand, from the stall. */
  face: [number, number];
  goods: "fish" | "bread" | "veg" | "wares" | "cloth";
}
export const STALLS: StallDef[] = [
  // M3i: the fish banks either side of the Vismarkt's middle aisle, a little askew (Steve: "stalls
  // are too ordered"), clear of the cart ruts; the market days put their stalls round these
  // (client game/market.ts). An older save keeps its old places until scripts/relay-stalls.ts.
  { place: "vismarkt", x: -121.4, z: 18.4, face: [0.97, 0.24], goods: "fish" },
  { place: "vismarkt", x: -120.9, z: 28.3, face: [0.99, -0.12], goods: "fish" },
  { place: "vismarkt", x: -121.8, z: 37.2, face: [0.96, 0.28], goods: "fish" },
  { place: "vismarkt", x: -111.2, z: 17.6, face: [-0.95, 0.31], goods: "fish" },
  { place: "vismarkt", x: -111.9, z: 32.4, face: [-1, 0.06], goods: "fish" },
  { place: "vismarkt", x: -110.8, z: 40.6, face: [-0.93, -0.36], goods: "fish" },
  { place: "grote_markt", x: -266.3, z: 84.6, face: [0.14, 0.99], goods: "veg" },
  { place: "grote_markt", x: -258.6, z: 83.4, face: [-0.1, 0.99], goods: "bread" },
  { place: "grote_markt", x: -249.4, z: 84.9, face: [0.21, 0.98], goods: "cloth" },
  { place: "grote_markt", x: -243.6, z: 83.2, face: [-0.17, 0.99], goods: "veg" },
  { place: "grote_markt", x: -266.0, z: 106.8, face: [0.12, -0.99], goods: "wares" },
  { place: "grote_markt", x: -247.6, z: 106.4, face: [-0.16, -0.99], goods: "veg" },
];

/** Haul routes: a quay point (a) and a door or store (b) per workplace. */
export const HAULS: Record<string, Array<{ a: [number, number]; b: [number, number] }>> = {
  rijnkaai: [
    { a: [-12, 4], b: [-10, 40] },
    { a: [26, 5], b: [40, 42] },
    { a: [-40, 5], b: [-44, 40] },
    { a: [45, 5], b: [56, 40] },
  ],
  hessenatie: [
    { a: [12, 5], b: [11.2, 43.5] },
    { a: [2, 5], b: [11.2, 43.5] },
  ],
  entrepot: [
    { a: [173, 55], b: [173, 83] },
    { a: [173, 108], b: [173, 88] },
    { a: [160, 40], b: [173, 78] },
  ],
  bassin: [
    { a: [90, 44], b: [96, 8] },
    { a: [130, 44], b: [150, 10] },
    { a: [66, 60], b: [70, 20] },
  ],
  bassin_south: [
    { a: [90, 113], b: [100, 122] },
    { a: [140, 113], b: [150, 122] },
  ],
  werf: [
    { a: [-300, 3], b: [-306, 12] },
    { a: [-262, 3], b: [-270, 12] },
    { a: [-230, 3], b: [-226, 26] },
  ],
  vismarkt: [
    // from the boats on the vliet to the backs of the fish banks (M3i)
    { a: [-139, 22], b: [-123.2, 22.4] },
    { a: [-139, 34], b: [-123.6, 33.2] },
  ],
  canal: [
    { a: [-65, 90], b: [-65, 108] },
    { a: [-87, 120], b: [-87, 84] },
  ],
};

/** A round for the police agents and the lamplighter (the lamps come from city.json). */
export const PATROLS: Record<string, Array<[number, number]>> = {
  quays: [[0, 20], [50, 20], [110, 16], [60, 69], [-30, 69], [-60, 30], [-118, 26], [-60, 8]],
  town: [[-182, 22], [-254, 80], [-250, 135], [-200, 128], [-150, 150], [-116, 88], [-118, 26], [-182, 5]],
  werf: [[-300, 7], [-230, 7], [-182, 22], [-240, 30], [-306, 20]],
};

/** Night haunts of the thieves: dark corners near taverns and quays. */
export const HAUNTS: Array<[number, number]> = [
  [-60, 30], [-10, 69], [-150, 30], [-200, 6], [-270, 10], [-88, 60], [-65, 70], [110, 20], [60, 69], [-236, 30],
];

// ------------------------------------------------------------------ trades

export type TradeId =
  | "docker" | "natie" | "porter" | "carter" | "boatman" | "sailor" | "fishwife" | "market_woman"
  | "baker" | "grocer" | "chandler" | "tobacconist" | "pawnbroker" | "cobbler" | "draper" | "shopwife"
  | "publican" | "clerk" | "merchant" | "maid" | "laundress" | "seamstress" | "housewife"
  | "police" | "priest" | "sexton" | "lamplighter" | "beggar" | "thief" | "retired"
  | "child" | "street_child" | "errand_boy" | "infant"
  // the employers of the job board (one each)
  | "foreman" | "fish_merchant" | "water_bailiff" | "brewer"
  // the garrison and the customs (garrison.ts): they walk, stand and talk; they never fight or arrest
  | "soldier" | "sentry" | "corporal" | "customs"
  // M6 (paper/town.ts): boys who sell the morning paper at a corner, the clerk of the post office
  | "newsboy" | "post_clerk"
  // M6 homes (homes/town.ts): the second-hand dealer who sells furniture at his door
  | "dealer"
  // M6 transport (bikeshop.ts): the velocipede maker, a smith who builds, sells and hires out "boneshakers"
  | "velo_maker"
  // M6 handcart (handcart.ts): the wheelwright, who builds, sells and hires out handcarts
  | "wheelwright"
  // M6 emigrants (emigrants.ts): families waiting for the liner, the lodging-house keeper, the ticket runner
  | "emigrant" | "lodging_keeper" | "runner"
  // M6 landmark interiors (landmarks/town.ts): who works inside the cathedral, the town hall, the Vleeshuis, the Steen and the Oostershuis
  | "organist" | "beadle" | "chair_woman" | "registrar" | "alderman" | "concierge" | "cellar_master" | "cellarman" | "painter" | "attendant" | "storekeeper"
  // M6 lively (lively.ts): the back streets and the cathedral quarter. Dog carts, street sellers
  // with their cries, the stalls against the cathedral, nuns, beguines, English travellers
  | "milk_woman" | "baker_boy" | "grinder" | "ragman" | "coalman" | "sweep" | "mussel_seller" | "broom_seller"
  | "devotion_seller" | "nun" | "beguine" | "tourist"
  // M7 night (night/givers.ts): the shady givers of night work, out from 21:00 to 5:00
  | "fence" | "smuggler" | "nightcarter" | "cracksman";

export interface TradeDef {
  label: string;
  work: WorkKind;
  faction: Faction | null;
  /** Bias on the 0-10 stats: added to a base roll. */
  bias?: Partial<Record<Stat, number>>;
  /** Wealth range 0-10. */
  wealth: [number, number];
  /** Night people keep other hours (see schedules). */
  night?: boolean;
}

export const STATS = ["honesty", "temper", "piety", "warmth", "greed", "courage", "gossip"] as const;
export type Stat = (typeof STATS)[number];

export const TRADES: Record<TradeId, TradeDef> = {
  docker: { label: "docker", work: "haul", faction: "naties", wealth: [0, 2], bias: { courage: 2, temper: 1 } },
  natie: { label: "natie man", work: "haul", faction: "naties", wealth: [1, 3], bias: { courage: 1 } },
  porter: { label: "porter with a sack truck", work: "roam", faction: "naties", wealth: [0, 2] },
  carter: { label: "carter", work: "roam", faction: null, wealth: [1, 3], bias: { temper: 1 } },
  boatman: { label: "boatman", work: "haul", faction: "smokkelaars", wealth: [1, 3], bias: { honesty: -1, courage: 1 } },
  sailor: { label: "sailor ashore", work: "roam", faction: null, wealth: [0, 2], bias: { temper: 1, piety: -2 } },
  fishwife: { label: "fishwife", work: "stall", faction: null, wealth: [1, 2], bias: { gossip: 3, temper: 1 } },
  market_woman: { label: "market woman", work: "stall", faction: "burgerij", wealth: [1, 3], bias: { gossip: 2, greed: 1 } },
  baker: { label: "baker", work: "shop", faction: "burgerij", wealth: [3, 5], bias: { piety: 1 } },
  grocer: { label: "grocer", work: "shop", faction: "burgerij", wealth: [3, 5], bias: { greed: 1 } },
  chandler: { label: "ship's chandler", work: "shop", faction: "burgerij", wealth: [3, 6], bias: { greed: 2 } },
  tobacconist: { label: "tobacconist", work: "shop", faction: "burgerij", wealth: [3, 5] },
  pawnbroker: { label: "clerk of the Berg van Barmhartigheid", work: "shop", faction: "burgerij", wealth: [4, 7], bias: { greed: 3, warmth: -2 } },
  cobbler: { label: "cobbler", work: "shop", faction: null, wealth: [1, 3], bias: { gossip: 1 } },
  draper: { label: "draper", work: "shop", faction: "burgerij", wealth: [4, 6], bias: { piety: 1 } },
  shopwife: { label: "shopkeeper's wife", work: "shop", faction: "burgerij", wealth: [3, 5], bias: { gossip: 2 } },
  publican: { label: "publican", work: "tavern", faction: null, wealth: [3, 5], bias: { gossip: 3, warmth: 1 }, night: true },
  clerk: { label: "clerk", work: "inside", faction: "burgerij", wealth: [3, 5], bias: { courage: -1, honesty: 1 } },
  merchant: { label: "merchant", work: "inside", faction: "burgerij", wealth: [7, 10], bias: { greed: 2, warmth: -1 } },
  maid: { label: "maid", work: "inside", faction: null, wealth: [0, 1], bias: { gossip: 2 } },
  laundress: { label: "laundress", work: "roam", faction: null, wealth: [0, 1], bias: { gossip: 2 } },
  seamstress: { label: "seamstress", work: "inside", faction: null, wealth: [0, 2], bias: { piety: 1 } },
  housewife: { label: "housewife", work: "inside", faction: null, wealth: [0, 3], bias: { gossip: 1, piety: 1 } },
  police: { label: "police agent", work: "patrol", faction: "politie", wealth: [2, 4], bias: { honesty: 1, courage: 2 } },
  priest: { label: "priest", work: "post", faction: "kerk", wealth: [3, 5], bias: { piety: 5, warmth: 1 } },
  sexton: { label: "sexton of the cathedral", work: "post", faction: "kerk", wealth: [2, 3], bias: { piety: 4 } },
  lamplighter: { label: "lamplighter", work: "patrol", faction: null, wealth: [0, 2] },
  beggar: { label: "beggar", work: "beg", faction: null, wealth: [0, 0], bias: { piety: 1, courage: -1 } },
  thief: { label: "pickpocket", work: "roam", faction: "smokkelaars", wealth: [0, 2], bias: { honesty: -6, courage: 1, greed: 2 }, night: true },
  retired: { label: "old hand, past work", work: "roam", faction: null, wealth: [0, 3], bias: { gossip: 2 } },
  child: { label: "child", work: "roam", faction: null, wealth: [0, 0] },
  street_child: { label: "street child", work: "roam", faction: null, wealth: [0, 0], bias: { honesty: -2, courage: 2 } },
  errand_boy: { label: "errand boy", work: "roam", faction: null, wealth: [0, 1] },
  infant: { label: "small child", work: "inside", faction: null, wealth: [0, 0] },
  foreman: { label: "foreman of the Katoennatie", work: "post", faction: "naties", wealth: [4, 6], bias: { temper: 2, honesty: 1 } },
  fish_merchant: { label: "fish merchant", work: "post", faction: "burgerij", wealth: [5, 7], bias: { greed: 2 } },
  water_bailiff: { label: "sergeant of the water police", work: "post", faction: "politie", wealth: [3, 5], bias: { honesty: 1, temper: 1 } },
  brewer: { label: "brewer", work: "post", faction: "burgerij", wealth: [6, 8], bias: { warmth: 1, greed: 1 } },
  soldier: { label: "soldier of the line", work: "inside", faction: null, wealth: [0, 1], bias: { courage: 2, piety: -1, gossip: 1 } },
  sentry: { label: "soldier of the line, on guard", work: "guard", faction: null, wealth: [0, 1], bias: { courage: 2, honesty: 1, warmth: -1 } },
  corporal: { label: "corporal of the guard", work: "guard", faction: null, wealth: [0, 2], bias: { temper: 1, honesty: 1, courage: 2 } },
  customs: { label: "customs officer", work: "inspect", faction: null, wealth: [2, 4], bias: { honesty: 1, greed: 1, warmth: -1 } },
  newsboy: { label: "newsboy", work: "post", faction: null, wealth: [0, 0], bias: { courage: 2, gossip: 2 } },
  post_clerk: { label: "clerk of the post and telegraph office", work: "post", faction: "burgerij", wealth: [3, 5], bias: { honesty: 2, gossip: 1 } },
  dealer: { label: "second-hand dealer", work: "post", faction: null, wealth: [2, 4], bias: { greed: 2, gossip: 2 } },
  velo_maker: { label: "velocipede maker, a smith who builds and hires out velocipedes", work: "post", faction: "burgerij", wealth: [4, 6], bias: { greed: 1, courage: 1 } },
  wheelwright: { label: "wheelwright, who builds and hires out handcarts", work: "post", faction: null, wealth: [3, 5], bias: { honesty: 1, courage: 1 } },
  emigrant: { label: "emigrant bound for America", work: "wait", faction: null, wealth: [1, 3], bias: { piety: 1, courage: -1, gossip: -1 } },
  lodging_keeper: { label: "keeper of the emigrants' lodging house", work: "post", faction: null, wealth: [3, 5], bias: { greed: 2, gossip: 2 } },
  // he calls himself an agent's man; the talk title shows only that
  runner: { label: "agent's man", work: "roam", faction: "smokkelaars", wealth: [1, 3], bias: { honesty: -6, greed: 3, warmth: 2 } },
  organist: { label: "organist of the cathedral", work: "inside", faction: "kerk", wealth: [2, 4], bias: { piety: 2 } },
  beadle: { label: "beadle of the cathedral (the suisse, who keeps order at mass)", work: "inside", faction: "kerk", wealth: [1, 3], bias: { piety: 2, temper: 1 } },
  chair_woman: { label: "chair woman of the cathedral (she lets the chairs at mass)", work: "inside", faction: "kerk", wealth: [0, 2], bias: { piety: 2, gossip: 2 } },
  registrar: { label: "clerk of the civil registry at the town hall", work: "inside", faction: "burgerij", wealth: [3, 5], bias: { honesty: 2 } },
  alderman: { label: "alderman of the civil registry, who marries couples at the town hall", work: "inside", faction: "burgerij", wealth: [7, 9], bias: { greed: 1 } },
  concierge: { label: "porter of the town hall", work: "inside", faction: "burgerij", wealth: [1, 3], bias: { gossip: 2 } },
  cellar_master: { label: "cellar master of Peyrot's wine warehouse in the Vleeshuis", work: "inside", faction: null, wealth: [3, 5], bias: { greed: 1 } },
  cellarman: { label: "cellarman at Peyrot's wine warehouse in the Vleeshuis", work: "inside", faction: null, wealth: [0, 2], bias: { courage: 1 } },
  painter: { label: "painter with a studio in the Vleeshuis", work: "inside", faction: null, wealth: [1, 4], bias: { piety: -1, warmth: 1 } },
  attendant: { label: "attendant of the Museum of Antiquities in the Steen", work: "inside", faction: "burgerij", wealth: [1, 3], bias: { honesty: 1, gossip: 1 } },
  storekeeper: { label: "storekeeper of the State warehouse in the Oostershuis", work: "inside", faction: null, wealth: [3, 5], bias: { honesty: 1, temper: 1 } },
  // M6 lively (lively.ts)
  milk_woman: { label: "milk woman with a dog cart", work: "round", faction: null, wealth: [1, 2], bias: { gossip: 2, warmth: 1 } },
  baker_boy: { label: "baker's boy with the bread cart", work: "round", faction: null, wealth: [0, 1], bias: { courage: 1, gossip: 1 } },
  grinder: { label: "knife grinder", work: "round", faction: null, wealth: [0, 1], bias: { gossip: 2, piety: -1 } },
  ragman: { label: "rag-and-bone man", work: "round", faction: null, wealth: [0, 1], bias: { greed: 2, honesty: -1 } },
  coalman: { label: "coal man", work: "round", faction: null, wealth: [1, 2], bias: { courage: 1, temper: 1 } },
  sweep: { label: "chimney sweep", work: "round", faction: null, wealth: [0, 1], bias: { courage: 2, gossip: 1 } },
  mussel_seller: { label: "mussel seller", work: "round", faction: null, wealth: [0, 2], bias: { gossip: 2 } },
  broom_seller: { label: "broom seller from the Kempen", work: "round", faction: null, wealth: [0, 1], bias: { piety: 1, gossip: -1 } },
  devotion_seller: { label: "keeper of a stall against the cathedral (rosaries, candles, holy pictures)", work: "post", faction: "kerk", wealth: [1, 3], bias: { piety: 3, gossip: 2, greed: 1 } },
  nun: { label: "Black Sister, who nurses the sick at home", work: "round", faction: "kerk", wealth: [0, 0], bias: { piety: 5, warmth: 2, honesty: 2 } },
  beguine: { label: "beguine", work: "inside", faction: "kerk", wealth: [1, 3], bias: { piety: 5, gossip: 1 } },
  tourist: { label: "English traveller come to see the Rubens paintings", work: "round", faction: null, wealth: [7, 9], bias: { courage: -1, warmth: 1, gossip: 1 } },
  // M7 night (night/givers.ts): they hire by night and are gone by dawn; what they pay is the engine's
  fence: { label: "dealer in odds and ends, after dark", work: "post", faction: "smokkelaars", wealth: [3, 5], bias: { honesty: -4, greed: 3, gossip: 1 }, night: true },
  smuggler: { label: "night lighterman", work: "post", faction: "smokkelaars", wealth: [2, 4], bias: { honesty: -3, courage: 2 }, night: true },
  nightcarter: { label: "carter who works by night and asks no questions", work: "post", faction: "smokkelaars", wealth: [1, 3], bias: { honesty: -2, temper: 1 }, night: true },
  cracksman: { label: "a man in a dark coat who needs a lookout", work: "post", faction: "smokkelaars", wealth: [2, 4], bias: { honesty: -6, courage: 3, warmth: -1 }, night: true },
};

/** The board's employers who live in the town: fixed ids, so the job board can name them. */
export interface TownEmployer {
  id: string;
  trade: TradeId;
  sex: "m" | "f";
  faction: Faction;
  /** Their post: the spot in shared/spots.json they stand at. */
  spot: string;
  /** Spots their work uses (from, to, post). */
  area: string[];
  note: string;
}
export const TOWN_EMPLOYERS: TownEmployer[] = [
  {
    id: "katoen",
    trade: "foreman",
    sex: "m",
    faction: "naties",
    spot: "katoen_door",
    area: ["katoen_door", "entrepot_quay", "bassin_quay"],
    note: "foreman of the Katoennatie at the Entrepot on the Petit Bassin, loud and quick, pays by the load",
  },
  {
    id: "vishandel",
    trade: "fish_merchant",
    sex: "f",
    faction: "burgerij",
    spot: "vismarkt_stalls",
    area: ["vismarkt_stalls", "vliet_steps", "west_sheds", "vleeshuis_door"],
    note: "fish merchant who supplies the stalls of the Vismarkt, sharp and fast, hates waste",
  },
  {
    id: "waterschout",
    trade: "water_bailiff",
    sex: "m",
    faction: "politie",
    spot: "werf_pontoon",
    area: ["werf_pontoon", "werf_quay", "steen_gate"],
    note: "sergeant of the water police at the Werf, watches the ferry and seizes smuggled goods, wants honest eyes",
  },
  {
    id: "brouwer",
    trade: "brewer",
    sex: "m",
    faction: "burgerij",
    spot: "canal_quay",
    area: ["canal_quay", "brewery_yard", "canal_west"],
    note: "brewer on the Canal des Brasseurs, barrels in and out all day, generous when the beer sells",
  },
  {
    id: "koster",
    trade: "sexton",
    sex: "m",
    faction: "kerk",
    spot: "cathedral_door",
    area: ["cathedral_door", "markt_stalls", "handschoen_well"],
    note: "sexton of the cathedral, errands for the chapter and the poor box, trusts the sober and the pious",
  },
];

/**
 * M7 night (Steve 2026-09-25: "Other quest givers come out at night: shady ones with night jobs"):
 * four givers of night work, each at a dark place of their own from 21:00 to 5:00 (shared/night.ts
 * NIGHT_WORK). Not on the day board; their work comes from the night board (night/nightwork.ts), the
 * model proposing and the engine clamping, paid better and riskier. Added in place to every town
 * (night/givers.ts ensureNightTown), so an older save gets them too.
 */
export const NIGHT_GIVERS: TownEmployer[] = [
  {
    id: "fence",
    trade: "fence",
    sex: "m",
    faction: "smokkelaars",
    spot: "vliet_steps",
    area: ["vliet_steps", "west_sheds", "vleeshuis_door"],
    note: "a fence who waits behind De Vliet at the Vliet landing after dark, buys what fell off a cart, pays for quick errands and no questions",
  },
  {
    id: "smuggler",
    trade: "smuggler",
    sex: "m",
    faction: "smokkelaars",
    spot: "werf_quay",
    area: ["werf_quay", "werf_pontoon", "steen_gate"],
    note: "a night lighterman who lands untaxed goods on the Werf when the water police are abed, pays for strong backs and closed mouths",
  },
  {
    id: "nightcarter",
    trade: "nightcarter",
    sex: "m",
    faction: "smokkelaars",
    spot: "canal_west",
    area: ["canal_west", "canal_quay", "brewery_yard"],
    note: "a carter on the west canal quay who moves barrels by night for men who do not give their names, and asks no questions",
  },
  {
    id: "cracksman",
    trade: "cracksman",
    sex: "m",
    faction: "smokkelaars",
    spot: "bassin_south",
    area: ["bassin_south", "bassin_quay", "entrepot_quay"],
    note: "a man in a dark coat by the Petit Bassin who wants a lookout kept while he sees to a warehouse door",
  },
];

/**
 * The trade Jef and the town see (QA 2026-09-24): never a secret or hidden one. A thief goes as
 * the day labourer he passes for; Madame Zelie (a visitor with the cards) as the fortune teller.
 * The engine's own trade id stays for the rules; this is for every label on screen and in letters.
 */
export function shownTrade(r: { trade: string; visitor?: { role?: string } | null }): string {
  if (r.visitor?.role === "fortune") return "fortune teller";
  if (r.trade === "thief") return "day labourer";
  return (TRADES as Record<string, { label: string } | undefined>)[r.trade]?.label ?? r.trade.replace(/_/g, " ");
}
