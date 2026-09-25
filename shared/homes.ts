// Homes to rent (M6 homes): the rooms, their furniture, and the rules for placing things
// and for comfort. The SERVER is the engine: it checks every placement and computes every
// number with these functions; the client imports the same file only to draw the rooms and
// to tint the ghost of a piece while Jef moves it (the server has the last word).
// No imports: both the server (node, .ts) and the client (vite) read this file.

/** One grid cell of a room, in metres. */
export const CELL = 0.5;

export type HomeClass = "cellar" | "garret" | "widow" | "alley" | "merchant";
export const HOME_CLASSES: HomeClass[] = ["cellar", "garret", "widow", "alley", "merchant"];

export type Wall = 0 | 1 | 2 | 3; // 0 back (+z), 1 right (+x), 2 front (door wall, -z), 3 left (-x)

export interface Fixed {
  kind: string;
  gx: number;
  gz: number;
  w: number;
  d: number;
  /** Which way it faces (0: +z into the room's back, 1: +x, 2: -z toward the door, 3: -x). */
  rot: number;
}

export interface Comfort {
  warmth: number;
  light: number;
  cheer: number;
}

export interface ClassDef {
  label: string;
  /** Rent for a week, centimes. */
  week_c: number;
  /** Room size (m): across (x), deep (z), high. */
  W: number;
  D: number;
  H: number;
  /** The door's cells in the front row (the room's own frame has the door at x = 0). */
  door: [number, number];
  /**
   * M7 homes in the world: which wall the door is in. 2 (the default): the front, on the street, with
   * the windows. 0: the back, onto the landing of the house's stair (a room up or down a flight: the
   * garret, the merchant's floor, the cellar); its windows stay in the front wall, on the street.
   */
  doorWall?: 0 | 2;
  /** Fixed furniture that comes with the room. */
  fixed: Fixed[];
  /** Window spans on the front wall (cells along x, inclusive). */
  windows: Array<[number, number]>;
  /** Wall spans nothing may hang on: [wall, from, to] cells (a hearth, the eaves). */
  noHang: Array<[Wall, number, number]>;
  /** Heavy curtains already hang at the windows (the merchant's floor): no room for more. */
  drapes?: boolean;
  /** Where a hanging lamp may go (x cells, inclusive), for the garret's low eaves. */
  lampCols?: [number, number];
  /** What the room itself gives: its window, its hearth or stove, its furnishing. */
  base: Comfort;
  /** A fire in the room you may warm yourself at (the alley house's hearth, the merchant's stove). */
  fire: boolean;
  /** Food the night costs (the widow gives coffee and a heel of bread in the morning). */
  nightFood: number;
  /** How it reads on the door and in the night sheet. */
  notice: string;
  night: string;
}

/**
 * The five kinds of home, cheap to dear (docs/milestones/M6-homes.md has the research).
 * Weekly rents in centimes against the game's wages: a tier-0 job pays 50 to 150 c, the
 * doss house bed is 150 c a week.
 */
export const CLASSES: Record<HomeClass, ClassDef> = {
  cellar: {
    label: "a cellar room",
    week_c: 100,
    W: 3.5,
    D: 4,
    H: 2.1,
    door: [2, 4],
    doorWall: 0,
    fixed: [
      { kind: "bed_straw", gx: 0, gz: 4, w: 2, d: 4, rot: 2 },
      { kind: "crate", gx: 6, gz: 7, w: 1, d: 1, rot: 2 },
    ],
    windows: [[5, 6]],
    noHang: [],
    base: { warmth: 0, light: 0, cheer: 0 },
    fire: false,
    nightFood: 2,
    notice: "CELLAR ROOM TO LET. Dry enough. A straw bed and a crate.",
    night: "You sleep on the straw in your cellar, your own door bolted. Damp, but nobody snores but you.",
  },
  garret: {
    label: "a garret room",
    week_c: 140,
    W: 3.5,
    D: 4.5,
    H: 2.4,
    door: [2, 4],
    doorWall: 0,
    fixed: [
      { kind: "bed_plank", gx: 0, gz: 5, w: 2, d: 4, rot: 2 },
      { kind: "crate", gx: 6, gz: 8, w: 1, d: 1, rot: 2 },
    ],
    // a small gable window under the slope: too small for curtains
    windows: [[5, 5]],
    noHang: [
      [1, 0, 8],
      [3, 0, 8],
    ],
    lampCols: [2, 4],
    base: { warmth: 0, light: 1, cheer: 0 },
    fire: false,
    nightFood: 2,
    notice: "GARRET TO LET under the roof. A plank bed. Light from the gable window.",
    night: "You sleep in your garret under the tiles. The wind walks on the roof, but the door is yours.",
  },
  widow: {
    label: "a room at a widow's",
    week_c: 220,
    W: 3.5,
    D: 4.5,
    H: 2.7,
    door: [2, 4],
    fixed: [
      { kind: "bed", gx: 0, gz: 5, w: 2, d: 4, rot: 2 },
      { kind: "washstand", gx: 6, gz: 8, w: 1, d: 1, rot: 3 },
      { kind: "chair_plain", gx: 6, gz: 5, w: 1, d: 1, rot: 3 },
    ],
    windows: [[5, 6]],
    noHang: [[0, 3, 3]],
    base: { warmth: 2, light: 1, cheer: 2 },
    fire: false,
    nightFood: 1,
    notice: "A CLEAN ROOM TO LET to a quiet single man. Bed and linen. Coffee in the morning. Ask the widow.",
    night: "You sleep between the widow's linen sheets. In the morning there is coffee and a heel of bread.",
  },
  alley: {
    label: "a small house in an alley",
    week_c: 320,
    W: 4.5,
    D: 5,
    H: 2.5,
    door: [3, 5],
    fixed: [
      { kind: "bedstee", gx: 0, gz: 8, w: 4, d: 2, rot: 2 },
      { kind: "hearth", gx: 0, gz: 3, w: 1, d: 2, rot: 1 },
      { kind: "chest", gx: 8, gz: 9, w: 1, d: 1, rot: 2 },
    ],
    windows: [[6, 7]],
    noHang: [
      [3, 2, 5],
      [0, 0, 3],
    ],
    base: { warmth: 2, light: 1, cheer: 1 },
    fire: true,
    nightFood: 2,
    notice: "HOUSE TO LET in the alley. One room down, a box bed, its own hearth.",
    night: "You sleep in the box bed of your own house, the hearth's last embers ticking. The alley is quiet.",
  },
  merchant: {
    label: "a merchant's upper floor",
    week_c: 900,
    W: 6,
    D: 6,
    H: 3.1,
    door: [4, 7],
    // M7: up the house's stair, the door in the back wall onto the landing; the desk under the
    // windows between them, the bookcase beside the wardrobe
    doorWall: 0,
    fixed: [
      // the bed in an alcove behind a panelled partition
      { kind: "bed_fine", gx: 0, gz: 8, w: 3, d: 4, rot: 2 },
      { kind: "alcove", gx: 0, gz: 7, w: 4, d: 1, rot: 2 },
      { kind: "wardrobe", gx: 10, gz: 11, w: 2, d: 1, rot: 2 },
      { kind: "bookcase", gx: 8, gz: 11, w: 2, d: 1, rot: 2 },
      { kind: "desk", gx: 5, gz: 0, w: 2, d: 2, rot: 0 },
      // a marble mantel with its fire, the mirror and the clock over it; two armchairs at the fire
      { kind: "mantel", gx: 11, gz: 5, w: 1, d: 3, rot: 3 },
      { kind: "armchair", gx: 9, gz: 4, w: 1, d: 1, rot: 1 },
      { kind: "armchair", gx: 9, gz: 8, w: 1, d: 1, rot: 1 },
      { kind: "table_fine", gx: 5, gz: 5, w: 2, d: 2, rot: 0 },
    ],
    windows: [
      [1, 3],
      [8, 10],
    ],
    drapes: true,
    noHang: [
      [0, 8, 11],
      [1, 5, 7],
      [3, 2, 5],
    ],
    base: { warmth: 4, light: 3, cheer: 4 },
    fire: true,
    nightFood: 2,
    notice: "FIRST FLOOR TO LET over the counting house. Two tall windows on the river, a marble fireplace, a bed in an alcove, furnished.",
    night: "You sleep in the alcove bed on the first floor, the fire ticking as it dies. Ships' lights move on the ceiling.",
  },
};

export type Layer = "floor" | "rug" | "wall" | "ceiling";
export type Carry = "arms" | "pocket";

export interface FurnitureDef {
  name: string;
  price_c: number;
  /** In a pocket slot, or in both arms like goods. */
  carry: Carry;
  layer: Layer;
  /** Footprint in cells at rot 0 (wall items: width along the wall). */
  w: number;
  d: number;
  comfort: Partial<Comfort>;
  note: string;
}

/**
 * What the second-hand dealer sells. Engine prices (centimes) and comfort. Each kind counts
 * once toward comfort, however many you place.
 */
export const FURNITURE: Record<string, FurnitureDef> = {
  chair: { name: "a rush-seated chair", price_c: 60, carry: "arms", layer: "floor", w: 1, d: 1, comfort: { cheer: 1 }, note: "Rush seat, one leg mended." },
  table: { name: "a deal table", price_c: 150, carry: "arms", layer: "floor", w: 2, d: 2, comfort: { cheer: 1 }, note: "Scrubbed pine, rings from other men's pots." },
  rug: { name: "a rag rug", price_c: 80, carry: "arms", layer: "rug", w: 3, d: 2, comfort: { warmth: 1, cheer: 1 }, note: "Woven from old coats. Keeps the cold off the floor." },
  stove: { name: "a cast-iron stove", price_c: 400, carry: "arms", layer: "floor", w: 2, d: 2, comfort: { warmth: 3 }, note: "A little pot-bellied stove, pipe included. Heavy." },
  plant: { name: "a geranium in a pot", price_c: 15, carry: "arms", layer: "floor", w: 1, d: 1, comfort: { cheer: 1 }, note: "Red, a bit leggy. Wants the light." },
  birdcage: { name: "a finch in a cage", price_c: 70, carry: "arms", layer: "floor", w: 1, d: 1, comfort: { cheer: 1 }, note: "A chaffinch in a wicker cage on a stand. It sings at dawn." },
  picture: { name: "a framed print", price_c: 40, carry: "pocket", layer: "wall", w: 1, d: 1, comfort: { cheer: 1 }, note: "The cathedral spire in a black frame. Hang it on a wall." },
  lamp: { name: "a hanging oil lamp", price_c: 90, carry: "pocket", layer: "ceiling", w: 1, d: 1, comfort: { light: 2 }, note: "Brass font, glass chimney. Hang it from a beam." },
  clock: { name: "a wall clock", price_c: 250, carry: "pocket", layer: "wall", w: 1, d: 1, comfort: { cheer: 1 }, note: "A Black Forest clock. It ticks; the hour is the town's." },
  curtains: { name: "a pair of curtains", price_c: 50, carry: "pocket", layer: "wall", w: 2, d: 1, comfort: { warmth: 1 }, note: "Faded red wool. For a window." },
};
export const FURNITURE_KINDS = Object.keys(FURNITURE);

export const COMFORT_CAP: Comfort = { warmth: 6, light: 4, cheer: 6 };
/** A room this comfortable (warmth + light + cheer) gives a better night: one more health. */
export const RESTFUL_AT = 6;
/** Every home beats the doss house bed (warmth +3): at least this much, more when warm. */
export const HOME_WARMTH_BASE = 4;

export interface Placed {
  id: number;
  kind: string;
  gx: number;
  gz: number;
  rot: number;
}

export function grid(cls: HomeClass): { nx: number; nz: number } {
  const c = CLASSES[cls];
  return { nx: Math.round(c.W / CELL), nz: Math.round(c.D / CELL) };
}

/** Cell centre in the room frame (x across, z in from the door wall). */
export function cellCentre(cls: HomeClass, gx: number, gz: number): { x: number; z: number } {
  const c = CLASSES[cls];
  return { x: -c.W / 2 + (gx + 0.5) * CELL, z: (gz + 0.5) * CELL };
}

/** A footprint's size at a turn (a quarter turn swaps width and depth). */
export function footprint(w: number, d: number, rot: number): { w: number; d: number } {
  return rot % 2 === 0 ? { w, d } : { w: d, d: w };
}

/** Which wall an edge cell of a wall item is on, by its turn. */
export function wallOf(rot: number): Wall {
  return (((rot % 4) + 4) % 4) as Wall;
}

function cellsOf(gx: number, gz: number, w: number, d: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([gx + i, gz + j]);
  return out;
}

const key = (x: number, z: number) => `${x},${z}`;

/** Wall span of a wall item: [wall, from, to] along that wall (x cells on 0 and 2, z cells on 1 and 3). */
function wallSpan(gx: number, gz: number, w: number, rot: number): [Wall, number, number] {
  const wall = wallOf(rot);
  const along = wall === 0 || wall === 2 ? gx : gz;
  return [wall, along, along + w - 1];
}

export type Why = null | string;

/**
 * May a piece go here? The engine's rule, used by the server for every placement:
 * inside the room; floor pieces not on the fixed furniture, other floor pieces or the
 * doorway, and the way from the door to the bed stays open; rugs not on the fixed furniture
 * or another rug; wall pieces on a wall (by their turn), curtains only at a window, nothing
 * over the door, a window or a hearth; lamps one to a cell, under the ridge in a garret.
 */
export function canPlace(cls: HomeClass, placed: Placed[], kind: string, gx: number, gz: number, rot: number, ignoreId = -1): Why {
  const def = FURNITURE[kind];
  if (!def) return "no such piece";
  if (![gx, gz, rot].every((n) => Number.isInteger(n))) return "off the grid";
  if (rot < 0 || rot > 3) return "bad turn";
  const c = CLASSES[cls];
  const { nx, nz } = grid(cls);
  const others = placed.filter((p) => p.id !== ignoreId && FURNITURE[p.kind]);
  if (def.layer === "wall") {
    const wall = wallOf(rot);
    // the item's anchor cell must be on its wall's edge row
    if (wall === 0 && gz !== nz - 1) return "not against a wall";
    if (wall === 2 && gz !== 0) return "not against a wall";
    if (wall === 1 && gx !== nx - 1) return "not against a wall";
    if (wall === 3 && gx !== 0) return "not against a wall";
    const [, a, b] = wallSpan(gx, gz, def.w, rot);
    const len = wall === 0 || wall === 2 ? nx : nz;
    if (a < 0 || b >= len) return "off the wall";
    const overWindow = wall === 2 && c.windows.some(([w0, w1]) => a <= w1 && b >= w0);
    if (kind === "curtains") {
      if (!(wall === 2 && c.windows.some(([w0, w1]) => a >= w0 && b <= w1))) return "curtains go at a window";
      if (c.drapes) return "heavy curtains hang there already";
    } else if (overWindow) return "that is the window";
    if (wall === (c.doorWall ?? 2) && a <= c.door[1] && b >= c.door[0]) return "that is the door";
    if (c.noHang.some(([w, f, t]) => w === wall && a <= t && b >= f)) return "nothing hangs there";
    for (const p of others) {
      const pd = FURNITURE[p.kind];
      if (pd.layer !== "wall") continue;
      const [pw, pa, pb] = wallSpan(p.gx, p.gz, pd.w, p.rot);
      if (pw === wall && a <= pb && b >= pa) return "something hangs there already";
    }
    return null;
  }
  const fp = def.layer === "ceiling" ? { w: 1, d: 1 } : footprint(def.w, def.d, rot);
  const cells = cellsOf(gx, gz, fp.w, fp.d);
  if (cells.some(([x, z]) => x < 0 || z < 0 || x >= nx || z >= nz)) return "it does not fit there";
  if (def.layer === "ceiling") {
    if (c.lampCols && (gx < c.lampCols[0] || gx > c.lampCols[1])) return "the roof is too low there";
    if (others.some((p) => FURNITURE[p.kind].layer === "ceiling" && p.gx === gx && p.gz === gz)) return "a lamp hangs there already";
    return null;
  }
  const fixedCells = new Set<string>();
  for (const f of c.fixed) for (const [x, z] of cellsOf(f.gx, f.gz, f.w, f.d)) fixedCells.add(key(x, z));
  if (cells.some(([x, z]) => fixedCells.has(key(x, z)))) return "the room's own furniture is there";
  const layerCells = (layer: Layer) => {
    const s = new Set<string>();
    for (const p of others) {
      const pd = FURNITURE[p.kind];
      if (pd.layer !== layer) continue;
      const f = footprint(pd.w, pd.d, p.rot);
      for (const [x, z] of cellsOf(p.gx, p.gz, f.w, f.d)) s.add(key(x, z));
    }
    return s;
  };
  if (def.layer === "rug") {
    const rugs = layerCells("rug");
    if (cells.some(([x, z]) => rugs.has(key(x, z)))) return "a rug lies there already";
    return null;
  }
  // floor
  const floor = layerCells("floor");
  if (cells.some(([x, z]) => floor.has(key(x, z)))) return "something stands there already";
  if (cells.some(([x, z]) => doorRow(cls, z) && x >= c.door[0] && x <= c.door[1])) return "that blocks the door";
  for (const [x, z] of cells) floor.add(key(x, z));
  if (!bedReachable(cls, (x, z) => fixedCells.has(key(x, z)) || floor.has(key(x, z)))) return "that shuts off the bed";
  return null;
}

/** The two rows inside the door, which floor pieces keep clear (the front two, or the back two when the door is in the back wall). */
function doorRow(cls: HomeClass, z: number): boolean {
  const c = CLASSES[cls];
  return (c.doorWall ?? 2) === 0 ? z >= grid(cls).nz - 2 : z <= 1;
}

/** From the doorway, over free floor cells, can Jef still reach a cell beside the bed? */
function bedReachable(cls: HomeClass, blocked: (x: number, z: number) => boolean): boolean {
  const c = CLASSES[cls];
  const { nx, nz } = grid(cls);
  const bed = c.fixed.find((f) => f.kind.startsWith("bed"));
  if (!bed) return true;
  const beside = new Set<string>();
  for (const [x, z] of cellsOf(bed.gx, bed.gz, bed.w, bed.d))
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) beside.add(key(x + dx, z + dz));
  const seen = new Set<string>();
  const q: Array<[number, number]> = [];
  const z0 = (c.doorWall ?? 2) === 0 ? nz - 1 : 0;
  for (let x = c.door[0]; x <= c.door[1]; x++) if (!blocked(x, z0)) q.push([x, z0]);
  while (q.length) {
    const [x, z] = q.shift()!;
    const k = key(x, z);
    if (seen.has(k)) continue;
    seen.add(k);
    if (beside.has(k)) return true;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const X = x + dx;
      const Z = z + dz;
      if (X < 0 || Z < 0 || X >= nx || Z >= nz || blocked(X, Z) || seen.has(key(X, Z))) continue;
      q.push([X, Z]);
    }
  }
  return false;
}

/** The first place a piece fits (scanning the room from the back), for the carter's move. */
export function firstFit(cls: HomeClass, placed: Placed[], kind: string): { gx: number; gz: number; rot: number } | null {
  const { nx, nz } = grid(cls);
  for (let gz = nz - 1; gz >= 0; gz--)
    for (let gx = nx - 1; gx >= 0; gx--)
      for (let rot = 0; rot < 4; rot++) if (!canPlace(cls, placed, kind, gx, gz, rot)) return { gx, gz, rot };
  return null;
}

/**
 * The room's comfort now: its own, plus each kind of piece once, capped. The engine's
 * numbers; the night and the stove read them.
 */
export function comfortOf(cls: HomeClass, placed: Placed[]): Comfort & { rest: number; restful: boolean } {
  const c = CLASSES[cls];
  const out: Comfort = { ...c.base };
  const kinds = new Set(placed.map((p) => p.kind).filter((k) => FURNITURE[k]));
  for (const k of kinds) {
    const f = FURNITURE[k].comfort;
    out.warmth += f.warmth ?? 0;
    out.light += f.light ?? 0;
    out.cheer += f.cheer ?? 0;
  }
  out.warmth = Math.min(COMFORT_CAP.warmth, out.warmth);
  out.light = Math.min(COMFORT_CAP.light, out.light);
  out.cheer = Math.min(COMFORT_CAP.cheer, out.cheer);
  const rest = out.warmth + out.light + out.cheer;
  return { ...out, rest, restful: rest >= RESTFUL_AT };
}

/** A night at home, by the engine: what it does to warmth, health and food. */
export function nightAt(cls: HomeClass, placed: Placed[]): { warmth: number; healthFed: number; healthHungry: number; food: number; restful: boolean } {
  const k = comfortOf(cls, placed);
  const restful = k.restful ? 1 : 0;
  return {
    warmth: HOME_WARMTH_BASE + Math.floor(k.warmth / 2),
    healthFed: 1 + restful,
    healthHungry: restful,
    food: CLASSES[cls].nightFood,
    restful: k.restful,
  };
}

/** Plain words for the comfort (for the prompt and the room card), never the numbers. */
export function comfortWords(k: Comfort): string[] {
  return [
    k.warmth >= 5 ? "warm" : k.warmth >= 3 ? "snug enough" : k.warmth >= 1 ? "chilly" : "cold",
    k.light >= 3 ? "bright" : k.light >= 1 ? "a little light" : "dark",
    k.cheer >= 5 ? "homely" : k.cheer >= 2 ? "lived in" : "bare",
  ];
}
