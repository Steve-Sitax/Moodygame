"""The Vleeshuis's stair up to its theatre floor (#186): the hall plan's flight (HallPeopleData, vleeshuis stair 0) made
visible. Its treads were collision only, so the theatre's 209 seats were reached by no way anyone could see.

vleeshuis_stair: in the hall's own frame (game axes, metres; the hall's origin at the floor, its yaw 0): a straight oak
flight of 50 steps along the north wall, from its foot at x = 26 up to its head at x = 11, z 12.3 to 14.1, rising 9.84 m:
each step 0.30 m going and 0.1968 m rising, exactly over the plan's treads (HallFloors). Treads with a rounded nosing and
risers between a wall string and an outer string; on the open side square balusters, a moulded handrail and turned
newels at the foot and the head; under the outer string a post at every fifth of its run on a stone pad.

Blender axes while building (Z up, front toward -Y): kit.G(x, y, z) converts a game point.
"""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Param, G

FOOT, HEAD, Z0, Z1, RISE_TOTAL, STEPS = 26.0, 11.0, 12.3, 14.1, 9.84, 50
GOING = (FOOT - HEAD) / STEPS
RISE = RISE_TOTAL / STEPS


_CELLS = {}


def cells(A):
    # (once an atlas: the cathedral's loft stair, cathloft.py, shares the same oak)
    if id(A) in _CELLS:
        return _CELLS[id(A)]
    def oak(w, h, ppm):
        return pt.wood(w, h, ppm, (0.42, 0.30, 0.18), 121, oak=True, knots=2, ring_mm=4.0, dirt=0.15)

    def worn(w, h, ppm):
        img = pt.wood(w, h, ppm, (0.40, 0.29, 0.18), 122, oak=True, knots=1, ring_mm=4.0)
        # the treads' middles worn paler and smoother by the feet
        X, Y = pt.coords(w, h, ppm)
        mid = pt.sm(0.55, 0.0, np.abs(X - X.max() / 2) / (X.max() / 2)) * pt.sm(0.0, 0.10, Y) * pt.sm(Y.max(), Y.max() - 0.08, Y)
        img = img * (1 - 0.18 * mid[..., None]) + np.array((0.55, 0.43, 0.30)) * 0.18 * mid[..., None]
        return img

    def stone(w, h, ppm):
        img = np.ones((h, w, 3), np.float32) * np.array((0.30, 0.31, 0.33))
        img *= (0.85 + 0.2 * pt.fbm(h, w, 0.04 * ppm, 0.04 * ppm, 123, 4))[..., None]
        return img

    _CELLS[id(A)] = {"oak": A.cell("stair", 1.85, 0.36, 300, oak, "stair oak"),
                     "tread": A.cell("stair", 1.85, 0.36, 300, worn, "stair treads"),
                     "string": A.cell("stair", 1.6, 1.6, 200, oak, "stair strings"),
                     "stone": A.cell("stair", 0.5, 0.5, 200, stone, "stair pads")}
    return _CELLS[id(A)]


def stair(A):
    C = cells(A)
    m = kit.Mesh("vleeshuis_stair")
    oak, tread, stone = Box(C["oak"], grain=1), Box(C["tread"], grain=1), Box(C["stone"])

    def gbox(x0, y0, z0, x1, y1, z1, skin, c=0.003, skip=()):
        a, b = np.array(G(x0, y0, z0)), np.array(G(x1, y1, z1))
        kit.cbox(m, np.minimum(a, b), np.maximum(a, b), skin, c=c, skip=skip, thr=30.0)

    inner, outer = Z1 - 0.04, Z0 + 0.06  # the strings' inner faces
    for i in range(STEPS):
        x_front = FOOT - GOING * i  # (the flight climbs toward -x: a step's front is toward +x)
        x_back = x_front - GOING
        top = RISE * (i + 1)
        # the tread, 32 mm oak, its nosing standing 25 mm over the riser below
        gbox(x_back - 0.01, top - 0.032, outer, x_front + 0.025, top, inner, tread, c=0.004)
        # the riser under its front
        gbox(x_front - 0.022, top - RISE, outer, x_front, top - 0.032, inner, oak, c=0.002)
    # the strings: an oak board along each side, its top edge 6 cm over the nosings, 0.36 m deep, in ten lengths
    slope = RISE_TOTAL / (FOOT - HEAD)
    x_start = FOOT + 0.05

    def top_line(x):
        return 0.06 + slope * (x_start - x)

    edges = np.linspace(x_start, HEAD, 11)
    for z0s, z1s in ((Z0, Z0 + 0.06), (Z1 - 0.04, Z1)):
        for k in range(10):
            xa, xb = float(edges[k]), float(edges[k + 1])
            ya_top, yb_top = top_line(xa), top_line(xb)
            ya_bot, yb_bot = max(0.0, ya_top - 0.36), max(0.0, yb_top - 0.36)
            poly = [(xa, ya_bot), (xa, ya_top), (xb, yb_top), (xb, yb_bot)]
            if ya_bot == 0.0 and yb_bot > 0.0:  # the foot's length: cut level on the floor
                xg = x_start - (0.36 - 0.06) / slope
                poly = [(xa, 0.0), (xa, ya_top), (xb, yb_top), (xb, yb_bot), (xg, 0.0)]
            # (local x along the flight, local y up, extruded across it: turned so local y is up and local z is game z)
            with m.at(Matrix.Rotation(math.radians(90), 4, "X")):
                kit.prism(m, poly[::-1], z0s, z1s, Param(C["string"], wrap=1.6, wrap_t=1.6), c=0.004, thr=30.0)
    # the posts under the outer string, on stone pads, every fifth of its run (a 15 m flight is not self-supporting)
    for k in range(1, 5):
        x = FOOT - (FOOT - HEAD) * k / 5
        y_under = top_line(x) - 0.36
        kit.sweep(m, [G(x, 0.0, Z0 + 0.03), G(x, y_under, Z0 + 0.03)], 0.12, 4, Param(C["oak"], wrap=1.6, wrap_t=0.34), up=(1, 0, 0),
                  a0=math.pi / 4, caps=(False, True), thr=40.0)
        gbox(x - 0.16, 0.0, Z0 + 0.03 - 0.16, x + 0.16, 0.08, Z0 + 0.03 + 0.16, stone, c=0.008, skip=((2, -1),))
        # a brace from the post up to the string, toward the foot
        kit.sweep(m, [G(x, y_under - 0.9, Z0 + 0.03), G(x + 0.9, top_line(x + 0.9) - 0.40, Z0 + 0.03)], 0.04, 4,
                  Param(C["oak"], wrap=1.6), up=(0, 0, 1), a0=math.pi / 4, caps=(True, True), thr=40.0)
    # the balustrade on the open side: square balusters on the outer string, a handrail 0.9 m over the nosings
    rail_h = 0.90
    oakv = Box(C["oak"], grain=2)
    for i in range(0, STEPS):
        x = FOOT - GOING * (i + 0.5)
        base = top_line(x) - 0.01
        gbox(x - 0.018, base, Z0 + 0.012, x + 0.018, base + rail_h - 0.06, Z0 + 0.048, oakv, c=0.003)
    path = []
    for x in np.linspace(FOOT + 0.10, HEAD - 0.05, 12):
        path.append(G(float(x), float(top_line(x) + rail_h - 0.06), Z0 + 0.03))
    kit.sweep(m, path, 0.035, 8, Param(C["oak"], wrap=1.6), ry=0.028, up=(0, 0, 1), caps=(True, True), thr=40.0)
    # turned newels at the foot and at the head
    for x, y0, hgt in ((FOOT + 0.05, 0.0, rail_h + 0.35), (HEAD - 0.05, RISE_TOTAL - 0.30, rail_h + 0.45)):
        with m.at(Matrix.Translation(G(x, y0, Z0 + 0.03))):
            prof = [(0.07, 0.0), (0.07, 0.15), (0.06, 0.17), (0.05, 0.25), (0.045, hgt * 0.5), (0.055, hgt * 0.75),
                    (0.045, hgt * 0.85), (0.065, hgt * 0.9), (0.065, hgt * 0.95), (0.04, hgt), (0.0, hgt + 0.04)]
            kit.lathe(m, prof, 12, Box(C["oak"], grain=2), thr=40.0)
    return m
