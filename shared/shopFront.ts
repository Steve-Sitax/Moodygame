// Where a town shop's table and awning stand beside its door (client game/stalls.ts draws them, the
// server's deeds put the food there and the keeper stands at its end). Pure numbers, no value imports:
// the caller hands in the houses of shared/city_build.json.
//
// The table stands with its back to the shop's own house front, beside the door: on the side with
// room, never past the end of the front (Steve 2026-09-26: "some shops are weirdly going over a
// corner"), the door left free. A short front gets a shorter table and awning, a very short one the
// table alone, and a front with no room none at all (the keeper then stands at the door).

export type Pt = [number, number];

export interface FrontHouse {
  fp: number[][];
  gone?: boolean;
}

export interface ShopTableSpot {
  /** On the wall line, the middle of the table's length (the model's origin: shop_* of stalls.glb). */
  x: number;
  z: number;
  /** three.js yaw: the model's +z (the street) looks along `out`. */
  yaw: number;
  /** Unit vector along the wall, from the door toward the table. */
  side: Pt;
  /** Length scale of the table and awning (1: the model's 1.6 m table under a 2.6 m awning). */
  sx: number;
  /** The awning goes up (else the table alone). */
  awning: boolean;
  /** Where the keeper stands: between the door and the table, facing the street. */
  seller: Pt;
  /** The middle of the table top, on the ground plan (food lifted off it). */
  food: Pt;
  /** Room along the front on the door's other side (m from the door's middle), for goods set out there. */
  other: number;
  /** Room on the table's side (m from the door's middle). */
  room: number;
}

/** From the door's middle: kept free each side of it. */
export const SHOP_DOOR_CLEAR = 0.7;
/** Kept from the end of the front (a corner, the next house). */
export const SHOP_END_CLEAR = 0.2;
const AWN_HALF = 1.3;
const TABLE_HALF = 0.8;

/** The house front a door sits in: how far it runs each way along `sd` from the door. */
export function frontRoom(houses: FrontHouse[], wall: Pt, out: Pt): { plus: number; minus: number } | null {
  const sd: Pt = [-out[1], out[0]];
  let best: { plus: number; minus: number; d: number } | null = null;
  for (const h of houses) {
    if (h.gone) continue;
    const fp = h.fp;
    const n = fp.length;
    for (let k = 0; k < n; k++) {
      const a = fp[k];
      const b = fp[(k + 1) % n];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      const L = Math.hypot(ex, ez);
      if (L < 1) continue;
      // along the wall (square to `out`), the door on it
      if (Math.abs((ex * out[0] + ez * out[1]) / L) > 0.1) continue;
      const t = Math.max(0, Math.min(1, ((wall[0] - a[0]) * ex + (wall[1] - a[1]) * ez) / (L * L)));
      const d = Math.hypot(wall[0] - (a[0] + ex * t), wall[1] - (a[1] + ez * t));
      if (d > 0.25 || t <= 0 || t >= 1) continue;
      const pa = (a[0] - wall[0]) * sd[0] + (a[1] - wall[1]) * sd[1];
      const pb = (b[0] - wall[0]) * sd[0] + (b[1] - wall[1]) * sd[1];
      if (!best || d < best.d) best = { plus: Math.max(pa, pb), minus: -Math.min(pa, pb), d };
    }
  }
  return best ? { plus: best.plus, minus: best.minus } : null;
}

function layout(room: number): { sx: number; awning: boolean; centre: number } | null {
  const span = room - SHOP_DOOR_CLEAR - SHOP_END_CLEAR;
  if (span >= 2 * AWN_HALF) return { sx: 1, awning: true, centre: SHOP_DOOR_CLEAR + AWN_HALF };
  if (span >= 1.8) return { sx: span / (2 * AWN_HALF), awning: true, centre: SHOP_DOOR_CLEAR + span / 2 };
  if (span >= 1.2) return { sx: Math.min(1, span / (2 * TABLE_HALF)), awning: false, centre: SHOP_DOOR_CLEAR + span / 2 };
  return null;
}

/** The table's place for a shop (its door on the wall `wall`, `out` into the street), or null: no room. */
export function shopTableSpot(houses: FrontHouse[], shop: { wall: Pt; out: Pt }): ShopTableSpot | null {
  const [ox, oz] = shop.out;
  const sd: Pt = [-oz, ox];
  const fr = frontRoom(houses, shop.wall, shop.out) ?? { plus: 4.5, minus: 4.5 };
  const a = layout(fr.plus);
  const b = layout(fr.minus);
  // the old side (+) when it takes the whole table and awning; else the side with more
  let sign = 1;
  if (!(a && a.sx === 1 && a.awning)) {
    const score = (l: typeof a) => (l ? l.sx + (l.awning ? 1 : 0) : -1);
    sign = score(b) > score(a) ? -1 : 1;
  }
  const l = sign > 0 ? a : b;
  if (!l) return null;
  const side: Pt = [sd[0] * sign, sd[1] * sign];
  const at = (s: number, o: number): Pt => [shop.wall[0] + side[0] * s + ox * o, shop.wall[1] + side[1] * s + oz * o];
  const [x, z] = at(l.centre, 0);
  return {
    x, z,
    yaw: Math.atan2(ox, oz),
    side,
    sx: l.sx,
    awning: l.awning,
    seller: at(Math.max(0.6, l.centre - TABLE_HALF * l.sx - 0.25), 0.9),
    food: at(l.centre, 0.6),
    other: sign > 0 ? fr.minus : fr.plus,
    room: sign > 0 ? fr.plus : fr.minus,
  };
}
