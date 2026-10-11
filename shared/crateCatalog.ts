// The one packing crate of the town (Steve 2026-10-11: "wooden boxes have a bunch of textures, I think we only need
// one, and make it high detail"; CLAUDE.md: one model per thing, changed everywhere). Pure data and pure functions,
// no imports: the client, the server, the texture painter (tools/textures/crate_sheet.mjs) and the Godot port
// (godot/src/Play/CrateModel.cs) read the same numbers.
//
// One model (tools/blender/build_crate.py -> client/public/models/crate.glb), one picture with every stencil on it,
// one material. Sizes come as a few classes of the same model, scaled as a whole (a small case to sit on, the
// standard case, a large one, the big packing case only a dray moves): never stretched, so the boards and the
// letters keep their shape. What a crate says (what is in it, where from, whose mark) is picked here by its lot, the
// same on every PC; a goods item keeps it wherever it goes (pile, hands, cart, wagon, ground).
//
// Period (the 1870s): Antwerp shipped and landed glass from the Liege works, machinery from Seraing and Liverpool,
// Sheffield tools, Staffordshire earthenware, tea from Canton, cigars from Havana, Bordeaux wine in cases, Marseille
// soap, Gouda candles, Charleroi nails, indigo from Calcutta, Verviers cloth, Bruges lace, Batavia spices, Welsh tin
// plate, Leipzig books.

/** The model at class 1 (m): length along x, depth along z, height (on its skids). */
export const CRATE_L = 0.8;
export const CRATE_D = 0.56;
export const CRATE_H = 0.5;

/** The size classes: the one model scaled as a whole. */
export const CRATE_CLASS = { small: 0.88, standard: 1, large: 1.25, big: 1.5 } as const;
export type CrateClass = keyof typeof CRATE_CLASS;

/** A crate's height at a class (m). */
export const crateHeight = (c: CrateClass = "standard"): number => CRATE_H * CRATE_CLASS[c];

export interface CrateGoods {
  /** Stencilled big across the front. */
  what: string;
  /** Where from, under it. */
  from: string;
  /** The merchant's mark (in a diamond on the front, big on the back). */
  mark: string;
  /** The case number. */
  no: string;
  /** What the back says under the mark ("VIA ANTWERPEN", the consignee's town). */
  to: string;
  /** A warning painted on the back ("FRAGILE", "KEEP DRY"), or none. */
  care?: string;
  /** The ink. */
  ink: string;
}

const INK = "#1d1a17";
const BLUE = "#1b2948";
const RED = "#5c1d14";

/**
 * Every stencil there is, in a fixed order: entry k is cell k of the crate picture (the painter lays them out in this
 * order; the model's front and back boards are mapped onto cell 0 and moved to cell k for a crate of these goods).
 */
export const CRATE_GOODS: readonly CrateGoods[] = [
  { what: "GLASS", from: "LIEGE", mark: "VSL", no: "No 17", to: "VIA ANTWERPEN", care: "FRAGILE", ink: INK },
  { what: "MACHINERY", from: "SERAING", mark: "JC", no: "No 4", to: "NEW YORK", care: "THIS SIDE UP", ink: INK },
  { what: "TOOLS", from: "SHEFFIELD", mark: "K&CO", no: "No 23", to: "ANTWERPEN", ink: BLUE },
  { what: "EARTHENWARE", from: "STOKE", mark: "W&S", no: "No 112", to: "ANTWERPEN", care: "FRAGILE", ink: RED },
  { what: "TEA", from: "CANTON", mark: "JM", no: "No 58", to: "ANTWERPEN", care: "KEEP DRY", ink: RED },
  { what: "CIGARS", from: "HAVANA", mark: "HU", no: "No 9", to: "ANTWERPEN", care: "KEEP DRY", ink: INK },
  { what: "WINE", from: "BORDEAUX", mark: "B&G", no: "No 36", to: "VIA ANTWERPEN", care: "FRAGILE", ink: RED },
  { what: "SOAP", from: "MARSEILLE", mark: "SF", no: "No 71", to: "ANTWERPEN", ink: BLUE },
  { what: "CANDLES", from: "GOUDA", mark: "KG", no: "No 15", to: "ANTWERPEN", care: "KEEP COOL", ink: INK },
  { what: "NAILS", from: "CHARLEROI", mark: "DB", no: "No 240", to: "VIA ANTWERPEN", ink: INK },
  { what: "INDIGO", from: "CALCUTTA", mark: "EIC", no: "No 31", to: "ANTWERPEN", care: "KEEP DRY", ink: BLUE },
  { what: "CLOTH", from: "VERVIERS", mark: "IS", no: "No 66", to: "VIA ANTWERPEN", care: "KEEP DRY", ink: INK },
  { what: "LACE", from: "BRUGES", mark: "VdB", no: "No 8", to: "LONDON", care: "KEEP DRY", ink: RED },
  { what: "SPICES", from: "BATAVIA", mark: "NHM", no: "No 19", to: "ANTWERPEN", care: "KEEP DRY", ink: INK },
  { what: "TIN PLATE", from: "SWANSEA", mark: "V&S", no: "No 140", to: "ANTWERPEN", ink: INK },
  { what: "BOOKS", from: "LEIPZIG", mark: "FAB", no: "No 27", to: "ANTWERPEN", care: "KEEP DRY", ink: BLUE },
  { what: "MACHINES", from: "LIVERPOOL", mark: "H&V", no: "No 3", to: "ANTWERPEN", care: "THIS SIDE UP", ink: BLUE },
  { what: "HARDWARE", from: "BIRMINGHAM", mark: "R&C", no: "No 52", to: "VIA ANTWERPEN", ink: INK },
];

/** A small fixed hash of a text (the same on every PC; shared/goodsCatalog.ts goodsHash, FNV-1a). */
export function crateHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The goods of a lot (`seed`): every crate of one lot says the same. Returns the cell (index in CRATE_GOODS). */
export function pickCrate(seed: string): number {
  return (crateHash(`${seed}#crate`) >>> 3) % CRATE_GOODS.length;
}

/**
 * What a crate is and says, by its goods item id (haul:rk-w:a:2, crate:0:1, job:12:0, q:crates_block.3 ...): a pile, a
 * heap, a stack or a job's goods is one lot (the last number is the crate in it). A crate keeps it wherever it goes.
 */
export function crateLabelFor(id: string | null | undefined): number {
  const s = id ?? "";
  const lot = /^(haul:|crate:|qg:|job:|pile:|own:|spawn:)/.test(s) ? s.replace(/:\d+$/, "") : s;
  return pickCrate(lot);
}
