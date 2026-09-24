// Jef's handcart (M6 transport, Steve 2026-09-24): "I should be able to push a handcart and put
// multiple items on it, so I can deliver all crates at once, or other items."
//
// The ENGINE's numbers for pushing a handcart: what it costs at the wheelwright's, how much it
// takes (by size and by weight), how fast a man pushes it, and which jobs let him tip the whole
// load off at the goal with one key. No imports: the server (node, .ts) and the client (vite)
// both read this file; the server has the last word on every load and every sale.
//
// A two-wheeled handcart of the port (a "stootkar", pushed from its shafts) carried two to three
// hundredweight: four crates of coffee, five sacks, three or four casks. Numbers are the game's,
// in proportion to the goods' carrying speeds (client props.ts GOODS: a barrel is the heaviest).

/** Size units and weight (kg) of one thing on a cart. Goods of the jobs, a family's chest, the dealer's furniture. */
export const LOAD: Record<string, { size: number; kg: number; name: string }> = {
  // job goods (client props.ts Goods)
  crates: { size: 1, kg: 45, name: "crate" },
  sacks: { size: 0.8, kg: 50, name: "sack" },
  barrels: { size: 1.4, kg: 70, name: "barrel" },
  hides: { size: 0.9, kg: 30, name: "bundle of hides" },
  rope: { size: 0.6, kg: 25, name: "coil of rope" },
  parcel: { size: 0.3, kg: 6, name: "parcel" },
  chests: { size: 1.2, kg: 40, name: "chest" },
  // the second-hand dealer's big pieces (shared/homes.ts FURNITURE, carried "arms")
  chair: { size: 1, kg: 6, name: "chair" },
  table: { size: 2.2, kg: 28, name: "deal table" },
  stove: { size: 1.6, kg: 90, name: "cast-iron stove" },
  rug: { size: 0.6, kg: 9, name: "rag rug" },
  plant: { size: 0.5, kg: 5, name: "geranium" },
  birdcage: { size: 0.6, kg: 3, name: "finch in a cage" },
};

/** What one handcart takes: size units and kilograms. Four crates fit; a fifth barrel does not. */
export const CART_LIMIT = { size: 6, kg: 260 };
/** A heavy one (the heavy_load twist) weighs this much more. */
export const HEAVY_X = 2;

export interface CartThing {
  kind: string;
  heavy?: boolean;
}

export function loadOf(items: CartThing[]): { size: number; kg: number } {
  let size = 0;
  let kg = 0;
  for (const it of items) {
    const d = LOAD[it.kind];
    if (!d) continue;
    size += d.size;
    kg += d.kg * (it.heavy ? HEAVY_X : 1);
  }
  return { size: Math.round(size * 100) / 100, kg: Math.round(kg) };
}

/** Can this go on top of what is there? null, or why not (plain words for the player). */
export function canLoad(items: CartThing[], next: CartThing): string | null {
  const d = LOAD[next.kind];
  if (!d) return "that does not go on a handcart";
  const now = loadOf(items);
  if (now.size + d.size > CART_LIMIT.size + 1e-9) return "there is no more room on the cart";
  if (now.kg + d.kg * (next.heavy ? HEAVY_X : 1) > CART_LIMIT.kg) return "that would be too heavy for the cart";
  return null;
}

/**
 * Walking pace pushing it, as a share of a man's walk: an empty cart 0.85, a full load 0.55.
 * (player/firstPerson.ts speedFactor; Shift still hurries, at the same share.)
 */
export function pushSpeed(kg: number): number {
  const f = Math.max(0, Math.min(1, kg / CART_LIMIT.kg));
  return Math.round((0.85 - 0.3 * f) * 100) / 100;
}

/**
 * May the whole load of a job's goods come off at the goal with one key? A carry job to a
 * place on the quay: yes. Handed to a person (deliver): one by one into his hands. A foreman
 * sent to watch counts every one set down: one by one.
 */
export function unloadAllAllowed(task: { kind: string; twist?: string } | null | undefined): boolean {
  return !!task && task.kind === "carry" && task.twist !== "foreman_watches";
}

/** How near the goal the load may be tipped off (metres from the spot; the job's drop reach is 2.2). */
export const UNLOAD_NEAR_M = 4.5;

/**
 * Prices at the wheelwright's (centimes), in proportion to the velocipede maker's (transport.ts
 * VELO_PRICE: 600 used, 1200 new, 30 a day): a handcart is planks, two wheels and an axle,
 * a third of a velocipede or less.
 */
export const CART_PRICE = { new_c: 380, used_c: 200, hire_c: 12 };
/** A day's hire runs this many game hours; then his boy fetches it, and this is the fee. */
export const CART_HIRE_HOURS = 14;
export const CART_FETCH_FEE_C = 10;
/** Jef's own cart left alone in a busy place: the chance each game hour that someone wheels it off. */
export const CART_THEFT_PER_HOUR = { day: 0.05, night: 0.1 };
/** Jef this near his cart (metres, seen in the last half minute): it is watched, nobody takes it. */
export const CART_WATCHED_M = 20;
