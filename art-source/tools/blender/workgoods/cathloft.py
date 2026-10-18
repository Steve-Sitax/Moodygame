"""The cathedral's way up to its organ loft (#192): the loft stood 7.3 m over the nave's floor behind its balustrade, with
the organ on it and the organist's chair, but nothing led up to it. An oak stair in the south aisle and a short gallery
from its head across into the loft, in the oak of the Vleeshuis's stair (hallstair.py).

cathedral_loft_stair: in the cathedral hall plan's own frame (game axes, metres; origin at the nave's floor, yaw 0):
  - a straight flight of 38 steps in the south aisle, between x 9.45 and 10.55, its foot at z 21.0 and its head at z 9.6,
    climbing toward the west (-z) 7.3 m: each step 0.30 m going and 0.192 m rising (the plan's stair, HallPeopleData);
    treads with a rounded nosing and risers between two strings; balusters and a moulded handrail on both sides,
    turned newels at the foot and the head; posts on stone pads under both strings at every fifth of the run;
  - at its head a landing, and a gallery west from it into the loft (x 5.7 to 10.55, z 7.9 to 9.6, its boards' top at
    7.3 m, over the loft's own floor for its last 0.3 m): oak boards on three beams, a fascia, railings on its open sides
    (the stair's opening and the loft end left open), posts with braces at its corners clear of the aisle's way (x 8.5
    to 9.4 stays free).

Blender axes while building (Z up, front toward -Y): kit.G(x, y, z) converts a game point.
"""

import math

import numpy as np
from mathutils import Matrix

from . import hallstair
from . import kit
from .kit import Box, Param, G

X0, X1 = 9.45, 10.55          # the flight's sides (game x)
FOOT, HEAD = 21.0, 9.6        # along game z: the flight climbs toward -z
RISE_TOTAL, STEPS = 7.3, 38
GOING = (FOOT - HEAD) / STEPS
RISE = RISE_TOTAL / STEPS
LAND_Z0 = 7.9                 # the landing and the gallery run from z 7.9 to the stair's head
GAL_X0 = 5.7                  # the gallery reaches into the loft to here
RAIL_H = 0.95
# local (along game z, up, across game x) -> Blender: X = across, Y = -along, Z = up (a mirror: kit.face winds it)
ALONG_Z = Matrix(((0, 0, 1, 0), (-1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))


def stair(A):
    C = hallstair.cells(A)
    m = kit.Mesh("cathedral_loft_stair")
    stone = Box(C["stone"])
    oakx, oakz, treadx, oakv = Box(C["oak"], grain=0), Box(C["oak"], grain=1), Box(C["tread"], grain=0), Box(C["oak"], grain=2)

    def gbox(x0, y0, z0, x1, y1, z1, skin, c=0.003, skip=()):
        a, b = np.array(G(x0, y0, z0)), np.array(G(x1, y1, z1))
        kit.cbox(m, np.minimum(a, b), np.maximum(a, b), skin, c=c, skip=skip, thr=30.0)

    def post(x, z, y_top, h):
        # a square oak post with chamfered arrises, in lengths of at most 1.6 m (each length keeps within its picture)
        n = max(1, int(math.ceil(y_top / 1.6)))
        for j in range(n):
            gbox(x - h, y_top * j / n, z - h, x + h, y_top * (j + 1) / n, z + h, oakv, c=0.012, skip=((2, -1),) if j else ())

    inner0, inner1 = X0 + 0.06, X1 - 0.06  # the strings' inner faces
    for i in range(STEPS):
        z_front = FOOT - GOING * i  # (the flight climbs toward -z: a step's front is toward +z)
        z_back = z_front - GOING
        top = RISE * (i + 1)
        gbox(inner0, top - 0.032, z_back - 0.01, inner1, top, z_front + 0.025, treadx, c=0.004)
        gbox(inner0, top - RISE, z_front - 0.022, inner1, top - 0.032, z_front, oakx, c=0.002)
    slope = RISE_TOTAL / (FOOT - HEAD)
    z_start = FOOT + 0.05

    def top_line(z):
        return 0.06 + slope * (z_start - z)

    # the strings: an oak board along each side, its top edge 6 cm over the nosings, 0.36 m deep, in eight lengths
    edges = np.linspace(z_start, HEAD, 9)
    for xa0, xa1 in ((X0, X0 + 0.06), (X1 - 0.06, X1)):
        for k in range(8):
            za, zb = float(edges[k]), float(edges[k + 1])
            ya_top, yb_top = top_line(za), top_line(zb)
            ya_bot, yb_bot = max(0.0, ya_top - 0.36), max(0.0, yb_top - 0.36)
            poly = [(za, ya_bot), (za, ya_top), (zb, yb_top), (zb, yb_bot)]
            if ya_bot == 0.0 and yb_bot > 0.0:  # the foot's length: cut level on the floor
                zg = z_start - (0.36 - 0.06) / slope
                poly = [(za, 0.0), (za, ya_top), (zb, yb_top), (zb, yb_bot), (zg, 0.0)]
            with m.at(ALONG_Z):
                kit.prism(m, poly[::-1], xa0, xa1, Param(C["string"], wrap=1.6, wrap_t=1.6), c=0.004, thr=30.0)
    # posts under both strings, on stone pads, every fifth of the run, each with a brace up toward the foot
    for k in range(1, 5):
        z = FOOT - (FOOT - HEAD) * k / 5
        y_under = top_line(z) - 0.36
        for x in (X0 + 0.03, X1 - 0.03):
            post(x, z, y_under, 0.085)
            gbox(x - 0.16, 0.0, z - 0.16, x + 0.16, 0.08, z + 0.16, stone, c=0.008, skip=((2, -1),))
            kit.sweep(m, [G(x, y_under - 0.9, z), G(x, top_line(z + 0.9) - 0.40, z + 0.9)], 0.04, 4,
                      Param(C["oak"], wrap=1.6), up=(1, 0, 0), a0=math.pi / 4, caps=(True, True), thr=40.0)
    # the balustrades: square balusters on both strings, a handrail 0.95 m over the nosings, newels foot and head
    for x in (X0 + 0.03, X1 - 0.03):
        for i in range(STEPS):
            z = FOOT - GOING * (i + 0.5)
            base = top_line(z) - 0.01
            gbox(x - 0.018, base, z - 0.018, x + 0.018, base + RAIL_H - 0.06, z + 0.018, oakv, c=0.003)
        path = [G(x, float(top_line(z) + RAIL_H - 0.06), float(z)) for z in np.linspace(FOOT + 0.10, HEAD + 0.05, 12)]
        kit.sweep(m, path, 0.035, 8, Param(C["oak"], wrap=1.6), ry=0.028, up=(1, 0, 0), caps=(True, True), thr=40.0)
        for z, y0, hgt in ((FOOT + 0.05, 0.0, RAIL_H + 0.35), (HEAD + 0.05, RISE_TOTAL, RAIL_H + 0.15)):
            newel(m, C, x, y0, z, hgt)
    # the landing and the gallery: boards on beams, a fascia round its edges (timber in lengths of at most 1.7 m, the
    # boards' joints staggered from row to row, so each length keeps within its picture)
    top = RISE_TOTAL

    def lengths(x0, x1, shift=0.0):
        cuts = [x0] + [c for c in np.arange(x0 + 1.7 - shift, x1 - 0.2, 1.7)] + [x1]
        return list(zip(cuts[:-1], cuts[1:]))

    for k, z0 in enumerate(np.arange(LAND_Z0, HEAD - 1e-6, 0.17)):
        z1 = min(HEAD, z0 + 0.17)
        for xa, xb in lengths(GAL_X0, X1, 0.55 * (k % 3)):
            gbox(float(xa) + 0.002, top - 0.032, float(z0) + 0.002, float(xb) - 0.002, top, float(z1) - 0.002, treadx, c=0.004)
    for z in (LAND_Z0 + 0.08, (LAND_Z0 + HEAD) / 2, HEAD - 0.08):
        for xa, xb in lengths(GAL_X0 + 0.3, X1 - 0.02):
            gbox(float(xa), top - 0.25, z - 0.07, float(xb), top - 0.032, z + 0.07, oakx, c=0.006)
    for xa, xb in lengths(GAL_X0 + 0.3, X1):
        gbox(float(xa), top - 0.29, LAND_Z0 - 0.03, float(xb), top - 0.02, LAND_Z0 + 0.02, oakx, c=0.004)
    for xa, xb in lengths(GAL_X0 + 0.3, X0):
        gbox(float(xa), top - 0.29, HEAD - 0.02, float(xb), top - 0.02, HEAD + 0.03, oakx, c=0.004)
    gbox(X1 - 0.02, top - 0.29, LAND_Z0, X1 + 0.03, top - 0.02, HEAD, oakz, c=0.004)
    # its railings: along the south edge, the landing's east end, and the north edge from the loft to the stair
    def railing(points):
        for a, b in zip(points[:-1], points[1:]):
            n = max(1, int(round(math.hypot(b[0] - a[0], b[1] - a[1]) / 0.12)))
            for j in range(n):
                t = (j + 0.5) / n
                x, z = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
                gbox(x - 0.018, top, z - 0.018, x + 0.018, top + RAIL_H - 0.06, z + 0.018, oakv, c=0.003)
        kit.sweep(m, [G(x, top + RAIL_H - 0.06, z) for x, z in points], 0.035, 8, Param(C["oak"], wrap=1.6), ry=0.028,
                  up=(0, 0, 1), caps=(True, True), thr=40.0)
        for x, z in (points[0], points[-1]):
            newel(m, C, x, top, z, RAIL_H + 0.15)

    railing([(GAL_X0 + 0.35, LAND_Z0 + 0.03), (X1 - 0.03, LAND_Z0 + 0.03), (X1 - 0.03, HEAD - 0.05)])
    railing([(GAL_X0 + 0.35, HEAD - 0.03), (X0 - 0.02, HEAD - 0.03)])
    # the posts under the gallery and the landing, clear of the aisle's way (x 8.5 to 9.4), with braces
    for x, z in ((7.4, LAND_Z0 + 0.10), (7.4, HEAD - 0.10), (X1 - 0.10, LAND_Z0 + 0.10)):
        y_under = top - 0.25
        post(x, z, y_under, 0.095)
        gbox(x - 0.17, 0.0, z - 0.17, x + 0.17, 0.08, z + 0.17, stone, c=0.008, skip=((2, -1),))
        for dx in (-0.9, 0.9):
            if 8.4 < x + dx < 9.5 or x + dx > X1 or x + dx < GAL_X0 + 0.3:
                continue
            kit.sweep(m, [G(x, y_under - 0.9, z), G(x + dx, y_under - 0.02, z)], 0.045, 4, Param(C["oak"], wrap=1.6),
                      up=(0, 0, 1), a0=math.pi / 4, caps=(True, True), thr=40.0)
    return m


def newel(m, C, x, y0, z, hgt):
    """A turned oak newel post standing on y0."""
    with m.at(Matrix.Translation(G(x, y0, z))):
        prof = [(0.07, 0.0), (0.07, 0.15), (0.06, 0.17), (0.05, 0.25), (0.045, hgt * 0.5), (0.055, hgt * 0.75),
                (0.045, hgt * 0.85), (0.065, hgt * 0.9), (0.065, hgt * 0.95), (0.04, hgt), (0.0, hgt + 0.04)]
        kit.lathe(m, prof, 12, Box(C["oak"], grain=2), thr=40.0)
