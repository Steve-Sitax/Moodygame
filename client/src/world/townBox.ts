import CITY from "../../../shared/city.json";

// The town inside its wall (tools/city/rampart.py, 2026-09-25): from the river (z -80) to the wall's inner
// faces. The grids that dress the streets (dirt, ruts, litter, clutter) and the shore texture cover this
// box; the berm, the moat and the far bank outside the wall have none of that.
const R = (CITY as unknown as { decor?: { rampart?: { inner: { west: number; north: number; east: number } } } }).decor?.rampart;

export const TOWN = {
  x0: R?.inner.west ?? -340,
  z0: -80,
  /** Size along x and along z (m). */
  w: (R?.inner.east ?? 200) - (R?.inner.west ?? -340),
  h: (R?.inner.north ?? 300) + 80,
};
