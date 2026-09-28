// The goods of the port and what their sacks look like (Steve 2026-09-28: "are there visible differences in coffee
// sacks, grain sacks", "can this also be a good base upon varying crates, baskets", "all must be variable/dynamic").
// Pure data and pure functions, no imports: the server and the client read this one file. The game draws every sack
// with the one sack model (client game/sackModel.ts), shaped and clothed by its goods' look and stencilled with what
// is in it, where from and the merchant's mark; which goods a sack holds is picked here, the same on every PC, by
// where it lies and its lot (one pile, one lot). The trade plan's runs and the cranes can name the goods themselves.
//
// Period (the 1870s): Antwerp took grain from the Baltic and the Black Sea (Riga, Danzig, Odessa) and America (New
// York), coffee from Brazil (Santos, Rio) and Java, rice from Rangoon, sugar from Java, beans from Smyrna, salt from
// Setubal for the fish market, barley and malt for the brewers; the town's own mills ground its flour. Grain sacks
// held about 100 kg in the trade and were weighed out in 50; coffee came in 60 kg jute bags, rice in light gunny,
// sugar often in plaited matting bags (kranjang), salt in stiff sacks that crusted white.

/** How a kind of goods fills and dresses the one sack model. */
export interface SackLook {
  /** How full and round (0.8 slack, 1 full, 1.1 hard and tight). */
  fullness: number;
  /** How lumpy the filling shows through (0 smooth flour or grain, 1 coffee beans). */
  lump: number;
  /** How much the ends sag and fold (0 tight, 1 soft). */
  slump: number;
  /** The cloth: its colour (r, g, b 0-255) and weave. */
  cloth: [number, number, number];
  weave: "jute" | "hessian" | "gunny" | "linen" | "mat";
  /** Dust on it: flour white, a crust of salt, none. */
  dust?: "flour" | "salt";
  /** The weight stencilled on it. */
  kg: number;
}

export interface SackGoods {
  id: string;
  /** Stencilled in big letters. */
  what: string;
  look: SackLook;
  /** Where it comes from, with the merchants' marks there and their ink; weight: how often. */
  origins: Array<{ from: string; marks: string[]; ink?: string; w?: number }>;
}

const INK = "#1e1a18";
const BLUE = "#1c2a4a";
const RED = "#5a1c14";

export const SACK_GOODS: Record<string, SackGoods> = {
  coffee: {
    id: "coffee",
    what: "COFFEE",
    look: { fullness: 1.0, lump: 1.0, slump: 0.4, cloth: [150, 128, 88], weave: "jute", kg: 60 },
    origins: [
      { from: "SANTOS", marks: ["JVR", "SC", "P&C"], ink: BLUE, w: 3 },
      { from: "RIO DE JANEIRO", marks: ["KB", "RJ", "M&S"], ink: INK, w: 2 },
      { from: "JAVA", marks: ["NHM", "JV"], ink: RED, w: 1 },
    ],
  },
  rye: {
    id: "rye",
    what: "RYE",
    look: { fullness: 1.08, lump: 0.15, slump: 0.25, cloth: [158, 132, 92], weave: "hessian", kg: 50 },
    origins: [
      { from: "ODESSA", marks: ["HN", "OD"], w: 3 },
      { from: "RIGA", marks: ["VD", "RG"], w: 2 },
      { from: "DANZIG", marks: ["VL", "DZ"], w: 1 },
    ],
  },
  wheat: {
    id: "wheat",
    what: "WHEAT",
    look: { fullness: 1.1, lump: 0.1, slump: 0.2, cloth: [162, 138, 96], weave: "hessian", kg: 50 },
    origins: [
      { from: "DANZIG", marks: ["VL", "DZ"], w: 2 },
      { from: "ODESSA", marks: ["HN", "OD"], w: 2 },
      { from: "NEW YORK", marks: ["RS", "NY"], ink: BLUE, w: 2 },
    ],
  },
  oats: {
    id: "oats",
    what: "OATS",
    look: { fullness: 0.95, lump: 0.2, slump: 0.45, cloth: [148, 126, 90], weave: "hessian", kg: 40 },
    origins: [{ from: "RIGA", marks: ["VD", "RG"] }, { from: "ZEELAND", marks: ["MV"] }],
  },
  barley: {
    id: "barley",
    what: "BARLEY",
    look: { fullness: 1.05, lump: 0.15, slump: 0.3, cloth: [156, 134, 94], weave: "hessian", kg: 50 },
    origins: [{ from: "ZEELAND", marks: ["MV", "BR"] }, { from: "ODESSA", marks: ["HN"] }],
  },
  malt: {
    id: "malt",
    what: "MALT",
    look: { fullness: 1.0, lump: 0.25, slump: 0.35, cloth: [140, 116, 80], weave: "hessian", kg: 50 },
    origins: [{ from: "ANTWERP", marks: ["BR", "DV"] }],
  },
  beans: {
    id: "beans",
    what: "BEANS",
    look: { fullness: 1.0, lump: 0.8, slump: 0.35, cloth: [146, 124, 86], weave: "jute", kg: 50 },
    origins: [{ from: "SMYRNA", marks: ["AS", "SM"] }],
  },
  rice: {
    id: "rice",
    what: "RICE",
    look: { fullness: 1.05, lump: 0.05, slump: 0.3, cloth: [182, 160, 116], weave: "gunny", kg: 75 },
    origins: [{ from: "RANGOON", marks: ["E&C", "RB"], ink: RED }],
  },
  sugar: {
    id: "sugar",
    what: "SUGAR",
    look: { fullness: 1.0, lump: 0.1, slump: 0.25, cloth: [176, 150, 96], weave: "mat", kg: 60 },
    origins: [{ from: "JAVA", marks: ["NHM", "JS"], ink: RED }],
  },
  salt: {
    id: "salt",
    what: "SALT",
    look: { fullness: 1.1, lump: 0.3, slump: 0.1, cloth: [150, 136, 110], weave: "hessian", dust: "salt", kg: 50 },
    origins: [{ from: "SETUBAL", marks: ["PC", "ST"] }],
  },
  potatoes: {
    id: "potatoes",
    what: "POTATOES",
    look: { fullness: 1.0, lump: 1.0, slump: 0.3, cloth: [140, 118, 82], weave: "jute", kg: 50 },
    origins: [{ from: "ZEELAND", marks: ["MV", "ZL"] }, { from: "KEMPEN", marks: ["KP"] }],
  },
  chestnuts: {
    id: "chestnuts",
    what: "CHESTNUTS",
    look: { fullness: 0.95, lump: 0.9, slump: 0.4, cloth: [146, 122, 86], weave: "jute", kg: 40 },
    origins: [{ from: "LIMOUSIN", marks: ["LM"] }, { from: "ITALY", marks: ["IT"], ink: "#5a1c14" }],
  },
  onions: {
    id: "onions",
    what: "ONIONS",
    look: { fullness: 0.95, lump: 0.8, slump: 0.4, cloth: [168, 146, 104], weave: "gunny", kg: 40 },
    origins: [{ from: "ZEELAND", marks: ["MV", "ZL"] }],
  },
  flour: {
    id: "flour",
    what: "FLOUR",
    look: { fullness: 0.95, lump: 0.0, slump: 0.55, cloth: [206, 196, 172], weave: "linen", dust: "flour", kg: 50 },
    origins: [{ from: "KIPDORP MILL", marks: ["KM"] }, { from: "NORTH MILL", marks: ["NM"], ink: BLUE }],
  },
};

/** What a sack says and is: the goods (for its look), the words stencilled on it, the mark and the ink. */
export interface SackLabel {
  goods: string;
  what: string;
  from: string;
  mark: string;
  ink?: string;
}

/** Which goods lie where (by the town's place ids, the dockers' routes' places): id and how often. */
export const SACK_BY_PLACE: Record<string, Array<[string, number]>> = {
  rijnkaai: [["coffee", 3], ["rye", 1], ["beans", 1]],
  hessenatie: [["rye", 3], ["wheat", 2], ["oats", 1]],
  entrepot: [["rice", 2], ["sugar", 2], ["coffee", 1]],
  bassin_south: [["coffee", 2], ["wheat", 2], ["rice", 1]],
  werf: [["oats", 2], ["barley", 2], ["rye", 1]],
  vismarkt: [["salt", 1]],
  canal: [["malt", 2], ["barley", 2]],
  market: [["potatoes", 3], ["onions", 2], ["chestnuts", 1], ["beans", 1], ["rice", 1], ["flour", 1], ["oats", 1]],
  /** Anywhere else on the quays. */
  quay: [["coffee", 3], ["rye", 2], ["wheat", 2], ["rice", 1], ["sugar", 1], ["beans", 1], ["oats", 1]],
};

/** A small fixed hash of a text (the same on every PC). */
export function goodsHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function weighted<T>(list: Array<[T, number]>, u: number): T {
  let sum = 0;
  for (const [, w] of list) sum += w;
  let x = u * sum;
  for (const [v, w] of list) if ((x -= w) < 0) return v;
  return list[list.length - 1][0];
}

/** A sack of these goods, its origin and mark picked by `seed` (a lot: every sack of one lot says the same). */
export function sackOf(goods: string, seed: string): SackLabel {
  const g = SACK_GOODS[goods] ?? SACK_GOODS.rye;
  const h = goodsHash(seed);
  const o = weighted(g.origins.map((q) => [q, q.w ?? 1] as [SackGoods["origins"][number], number]), ((h >>> 8) & 0xffff) / 0x10000);
  const mark = o.marks[(h >>> 4) % o.marks.length];
  return { goods: g.id, what: g.what, from: o.from, mark, ink: o.ink };
}

/**
 * A sack of the lot `seed` lying at `place` (a place id of SACK_BY_PLACE, or the goods list itself): which goods, from
 * where, whose mark. Variable (every lot its own) and the same on every PC.
 */
export function pickSack(seed: string, place: string | Array<[string, number]> = "quay"): SackLabel {
  const list = Array.isArray(place) ? place : (SACK_BY_PLACE[place] ?? SACK_BY_PLACE.quay);
  const goods = weighted(list, (goodsHash(`${seed}#goods`) & 0xffff) / 0x10000);
  return sackOf(goods, seed);
}
