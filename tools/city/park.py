"""The Stadspark's paths and planting (the park pass, 2026-09-26: "the part with the ponds have no trees,
bushes.. make it look way better, but keep the grungy feel").

The park as Eduard Keilig laid it out in 1867-69 on the old Spanish ramparts: an English landscape park,
a winding pond from the old moat with a small island and an iron suspension footbridge (1869) on rock
masses of artificial stone, winding gravel paths, lawns, clumps of trees and shrubs (many of them exotic
and new: maples, chestnuts, willows, rhododendrons, azaleas, evergreens), a shrub border inside the
railing, reeds and water lilies at the water. In autumn 1873 most of the planted trees are young (about
four years, on stakes); a few older trees of the ramparts were kept. This script works out:

    --paths    the gravel paths: shared/city.json decor.park.paths (the ground zones' "earth" pieces, one
               simple polygon each: the old loop lost its hole and made the middle of the park one mud
               field) and decor.park.lines (the middle lines, for the planting and the benches).
               Run it under the walk-map lock; then build_churches.py (benches and lanterns by the paths),
               then --plants, then plan.py --ground and walk_only.py (both under the lock).
    --plants   the planting and the park's own ground: client/public/models/park_plants.json (trees,
               shrubs, the hedge, reeds, lilies, beds, stones, the island, the ducks' water; the lawn, the
               gravel and the muddy path edges as triangles; the solids for the walk map: trunks, shrub
               clumps, the hedge, the beds). plan.py paints the solids as wall and leaves the park's ground
               to world/parkNature.ts.

    python tools/city/park.py --paths [--dry]
    python tools/city/park.py --plants [--dry]

After the last step, tools/city/park_check.py must find nothing (nothing on a path, in the water, in another thing,
floating or sunk; every gate and path walkable), and __scheldemist.paths() in the game must list nothing. After a
design.py run (it writes decor.park again, and its paths lose their holes: one mud field round the pond), run this
whole chain again.

Everything is seeded: the same inputs give the same park.
"""
import json
import math
import os
import random
import sys

import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
PARK = os.path.join(ROOT, "client", "public", "models", "park.json")
PLANTS = os.path.join(ROOT, "client", "public", "models", "park_plants.json")

# ---------------------------------------------------------------- the paths
# Middle lines (world x, z) and widths. The gates (park.json openings): G1 (-330.0, 291.5) on the north-west
# side, G2 (-280.9, 282.0) on the north side, G3 (-252.3, 310.1) on the east side. The footbridge runs from
# (-295.9, 303.2) (north end) to (-289.3, 311.4) (south end); the wall's stairs come down to a landing at
# about (-293.5, 329.4). The west half of the pond runs up to the wall's town face: no path there.
# Named points, worked out from park.json in resolve(): G1o/G1/G1i, G2o/G2/G2i, G3o/G3/G3i = each gate from outside
# (1.3 m out in the street), its middle, and 1.6 m in, square to the railing; J0, J1 = where the paths meet before the
# bridge's north and south ends (4 m short of its ramps). The last 4 m to each end is a straight approach as wide as
# the bridge and a little more (APPROACH), with the rocaille on either side of it (build_churches.py): nothing on the
# gravel (the park check, tools/city/park_check.py).
LINES = [
    # the main walk: the north gate down to the bridge
    (["G2o", "G2", "G2i", (-283.2, 287.4), (-286.4, 291.2), (-290.4, 293.8), (-294.4, 295.2), (-297.9, 296.8), "J0"], 3.0),
    # west: from the bridge along the pond's north side to the north-west gate
    (["J0", (-300.4, 299.4), (-306.0, 299.9), (-313.0, 299.4), (-319.5, 297.6), (-325.0, 295.0), "G1i", "G1", "G1o"], 2.6),
    # a walk down the west end of the pond to a bench by the wall
    ([(-319.5, 297.6), (-324.5, 301.5), (-327.6, 306.4), (-328.6, 311.2), (-327.8, 314.2)], 2.2),
    # round the east pond: from the main walk, east and south, to the bridge's south end
    ([(-288.2, 292.6), (-283.4, 290.6), (-278.0, 291.6), (-273.9, 295.6), (-272.2, 301.2), (-272.8, 307.0), (-275.9, 311.4),
      (-280.6, 314.6), (-284.4, 315.3), "J1"], 2.6),
    # out to the east gate
    ([(-272.4, 304.5), (-267.4, 306.9), (-261.6, 308.6), "G3i", "G3", "G3o"], 2.6),
    # from the bridge's south end down to the wall's stairs
    (["J1", (-288.0, 318.4), (-289.6, 322.6), (-291.4, 326.2), (-293.4, 327.9)], 2.4),
    # a small loop over the south lawn
    ([(-289.0, 320.6), (-284.2, 323.6), (-278.8, 322.8), (-275.2, 318.6), (-275.4, 313.4), (-276.6, 311.9)], 2.0),
]
APPROACH = 2.2  # the straight gravel to each end of the bridge (its deck is 1.8)
APPROACH_L = 4.0
# small round places on the paths (a bench looking over the water)
ROUNDS = [((-327.6, 314.4), 2.3)]


def chaikin(pts, n=3):
    """Round the corners, keep the two ends."""
    for _ in range(n):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]))
            out.append((0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]))
        out.append(pts[-1])
        pts = out
    return pts


def load():
    city = json.load(open(CITY))
    park = json.load(open(PARK))
    return city, park


def resolve(park):
    """The named points: the gates square to the railing, the meeting points before the bridge's ends."""
    ring = Polygon(park["outline"]).buffer(0)
    names = {}
    ro = list(ring.exterior.coords)
    for k, (ox, oz, w) in enumerate(park["openings"], 1):
        g = Point(ox, oz)
        # the railing's edge the gate is on, and its outward normal
        best = min(range(len(ro) - 1), key=lambda i: LineString([ro[i], ro[i + 1]]).distance(g))
        (ax, az), (bx, bz) = ro[best], ro[best + 1]
        L = math.hypot(bx - ax, bz - az)
        nx, nz = -(bz - az) / L, (bx - ax) / L
        if ring.contains(Point(ox + nx * 0.5, oz + nz * 0.5)):
            nx, nz = -nx, -nz
        names[f"G{k}"] = (ox, oz)
        names[f"G{k}o"] = (ox + nx * 1.3, oz + nz * 1.3)
        names[f"G{k}i"] = (ox - nx * 1.6, oz - nz * 1.6)
    b = park["bridge"]
    (fx, fz), (tx, tz) = b["from"], b["to"]
    L = math.hypot(tx - fx, tz - fz)
    ux, uz = (tx - fx) / L, (tz - fz) / L
    names["J0"] = (fx - ux * APPROACH_L, fz - uz * APPROACH_L)
    names["J1"] = (tx + ux * APPROACH_L, tz + uz * APPROACH_L)
    approaches = [[names["J0"], (fx + ux * 0.3, fz + uz * 0.3)], [names["J1"], (tx - ux * 0.3, tz - uz * 0.3)]]
    return names, approaches


def path_shapes(park):
    """The paths' middle lines (smoothed), widths and shapes; the pieces clipped to the park and off the pond."""
    ring = Polygon(park["outline"]).buffer(0)
    pond = Polygon(park["pond"]).buffer(0)
    names, approaches = resolve(park)
    out = []
    for pts, w in LINES:
        pts = [names[p] if isinstance(p, str) else p for p in pts]
        ln = LineString(chaikin(pts))
        out.append((ln, w, ln.buffer(w / 2, quad_segs=6)))
    for a, b in approaches:
        ln = LineString([a, b])
        out.append((ln, APPROACH, ln.buffer(APPROACH / 2, cap_style=2)))
    for c, r in ROUNDS:
        out.append((None, r * 2, Point(c).buffer(r, quad_segs=8)))
    # a metre out past the gates into the street (a worn threshold), nothing over the pond
    keep = ring.buffer(1.0, join_style=2)
    polys = [s.intersection(keep).difference(pond.buffer(0.35)) for _, _, s in out]
    return ring, pond, out, polys


def pieces(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


def ring_of(p, nd=2):
    return [[round(x, nd), round(z, nd)] for x, z in list(p.exterior.coords)[:-1]]


def do_paths(dry):
    city, park = load()
    ring, pond, out, polys = path_shapes(park)
    rings = []
    for p in polys:
        for q in pieces(p.simplify(0.05)):
            if q.area > 0.5:
                assert not q.interiors
                rings.append(ring_of(q))
    union = unary_union(polys)
    print(f"[park] paths: {len(rings)} pieces, {union.area:.0f} m2; min clearance to the pond {union.distance(pond):.2f} m")
    lines = [{"pts": [[round(x, 2), round(z, 2)] for x, z in ln.coords], "w": w} for ln, w, _ in out if ln is not None]
    if dry:
        return
    city["decor"]["park"]["paths"] = rings
    city["decor"]["park"]["lines"] = lines
    city["decor"]["park"]["rounds"] = [[c[0], c[1], r] for c, r in ROUNDS]
    json.dump(city, open(CITY, "w"), separators=(",", ":"))
    print("[park] wrote shared/city.json decor.park.paths, lines, rounds")


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    if "--paths" in sys.argv:
        do_paths(dry)
    elif "--plants" in sys.argv:
        import park_plants  # noqa: E402  (the planting: tools/city/park_plants.py)

        park_plants.main(dry)
    else:
        print(__doc__)
