import BUILD from "../../../../shared/city_build.json";

// M7 alive: the houses' roofs as places to put things (pigeon lofts) and to sit on (jackdaws): the
// ridge and the slopes of the plan's houses, worked out as tools/blender/build_city.py builds them
// (house_ring, the roofs of kind "side", "front" and "flat").

export interface House {
  b: number;
  rect: boolean;
  alley?: boolean;
  gone?: boolean;
  o: [number, number];
  u: [number, number];
  n: [number, number];
  s: [number, number];
  t: [number, number];
  h: number;
  st: number;
  roof: "side" | "front" | "flat";
  pitch: number;
  seed: number;
  street: number[];
}

export const HOUSES = (BUILD as unknown as { houses: House[] }).houses;

export interface Roof {
  i: number;
  h: House;
  /** Eaves height (the walls' top) and the ridge's rise over it. */
  H: number;
  rise: number;
  /** The ridge in the world: from a to b (at H + rise); none for a flat roof. */
  a: [number, number];
  b: [number, number];
}

/** The house frame to the world. */
export function P(h: House, s: number, t: number): [number, number] {
  return [h.o[0] + h.u[0] * s + h.n[0] * t, h.o[1] + h.u[1] * s + h.n[1] * t];
}

export function roofOf(i: number): Roof | null {
  const h = HOUSES[i];
  if (!h || !h.rect || h.gone) return null;
  const [s0, s1] = h.s;
  const [t0, t1] = h.t;
  const W = s1 - s0;
  const D = t1 - t0;
  const cottage = !!h.alley && h.roof === "side";
  const pitch = ((cottage ? 45 : h.pitch) * Math.PI) / 180;
  if (h.roof === "front") {
    const rise = Math.min((W / 2) * Math.tan(pitch), 9);
    const sm = (s0 + s1) / 2;
    return { i, h, H: h.h, rise, a: P(h, sm, t0), b: P(h, sm, t1) };
  }
  if (h.roof === "side") {
    const rise = Math.min((D / 2) * Math.tan(pitch), 6.5);
    const tm = (t0 + t1) / 2;
    return { i, h, H: h.h, rise, a: P(h, s0, tm), b: P(h, s1, tm) };
  }
  const c = P(h, (s0 + s1) / 2, (t0 + t1) / 2);
  return { i, h, H: h.h, rise: 0, a: c, b: c };
}

/** The roof's height at (s, t) in its house's frame. */
export function roofY(r: Roof, s: number, t: number): number {
  const h = r.h;
  if (h.roof === "flat") return r.H;
  if (h.roof === "front") {
    const W = h.s[1] - h.s[0];
    const sm = (h.s[0] + h.s[1]) / 2;
    return r.H + r.rise * (1 - Math.abs(s - sm) / (W / 2));
  }
  const D = h.t[1] - h.t[0];
  const tm = (h.t[0] + h.t[1]) / 2;
  return r.H + r.rise * (1 - Math.abs(t - tm) / (D / 2));
}
