# Ruien kit: hall generator from a room rectangle (ruien-routes.json "rooms": rect [x0, z0, x1, z1]).
# Uses the O2 hall code (rlib/hall.py, rlib/wax.py) with the rectangle, a pier grid and mouths derived from data.
import importlib
import numpy as np
import spec
from rlib import util as U

def pier_lines(a, b, bay=6.5):
    n = max(1, int(round((b - a) / bay)))
    return [a + (b - a) * k / n for k in range(1, n)]

def build_hall(room, mats, coll, rng, mouths=(), stair_corner='x0z1', air=True, walkway=1.5):
    """room: dict with 'id' and 'rect' [x0, z0, x1, z1]. mouths: list of (wall, bay index) with wall in
    'z0', 'z1', 'x0', 'x1'. Returns the hall objects. Bays come out 6 to 7 m; springing and crown as O2."""
    x0, z0, x1, z1 = room['rect']
    spec.HALL_X0, spec.HALL_X1, spec.HALL_Z0, spec.HALL_Z1 = x0, x1, z0, z1
    spec.HALL_XL, spec.HALL_ZL = pier_lines(x0, x1), pier_lines(z0, z1)
    from rlib import hall as H
    importlib.reload(H)
    H.MOUTHS = {('m%d' % i): dict(wall=w, bay=b) for i, (w, b) in enumerate(mouths)}
    H.WALL_DRAIN_HOLES = []
    sx = (x0, x0 + 1.2) if 'x0' in stair_corner else (x1 - 1.2, x1)
    H.STAIR = dict(x0=sx[0], x1=sx[1], z_open=z1 - 4.45, hatch_z0=z1 - 3.15, hatch_z1=z1 - 0.1)
    xe, ze = [x0] + spec.HALL_XL + [x1], [z0] + spec.HALL_ZL + [z1]
    H.AIR = ((xe[len(xe) // 2 - 1] + xe[len(xe) // 2]) / 2, (ze[len(ze) // 2 - 1] + ze[len(ze) // 2]) / 2, 0.3) if air else (1e6, 1e6, 0.0)
    # walkways along the four walls, broken where a mouth opens
    def gaps(wall):
        out = []
        for m in H.MOUTHS.values():
            if m['wall'] == wall:
                tc, hm, a, b = H.mouth_geom([k for k, v in H.MOUTHS.items() if v is m][0])
                out.append((tc - hm - 0.2, tc + hm + 0.2))
        return out
    def strips(t0, t1, wall):
        cuts = sorted(gaps(wall)); segs = []; a = t0
        for (g0, g1) in cuts:
            if g0 > a:
                segs.append((a, g0))
            a = max(a, g1)
        if a < t1:
            segs.append((a, t1))
        return segs
    W = walkway
    walks = []
    for (a, b) in strips(x0, x1, 'z0'):
        walks.append((a, b, z0, z0 + W, ['z1']))
    for (a, b) in strips(x0, x1, 'z1'):
        walks.append((a, b, z1 - W, z1, ['z0']))
    for (a, b) in strips(z0 + W, z1 - W, 'x0'):
        walks.append((x0, x0 + W, a, b, ['x1']))
    for (a, b) in strips(z0 + W, z1 - W, 'x1'):
        walks.append((x1 - W, x1, a, b, ['x0']))
    H.WALKS = walks
    obs = [H.vault(mats, coll)]
    obs += H.ribs(mats, coll)
    obs += H.walls(mats, coll)
    obs += H.piers(mats, coll, rng)
    obs += H.walkways(mats, coll, rng)
    fl, groundfn = H.floor(mats, coll, rng)
    obs += fl
    obs += H.stair(mats, coll, rng)
    if air:
        obs += H.air_shaft(mats, coll)
    from rlib import wax as WX
    obs += WX.hall_wax(mats, coll, rng)
    return obs, H, groundfn
