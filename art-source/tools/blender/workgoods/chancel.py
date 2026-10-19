"""The cathedral's furniture, round two (#198): the choir stalls, the high altar's fittings, the organ case, the transept
altars' triptychs and the wall epitaphs were textured boxes (the stalls a long oak box with paper-flat arches and spikes,
the organ five flat boxes of grey bars, the frames flat strips round flat pictures). Rebuilt here at the detail level of
the confessionals and the pulpit (church.py), after the cathedral's interior of the 1870s:

choir_stalls_west, choir_stalls_east_a, choir_stalls_east_b: the neo-Gothic oak stalls of the choir (Geerts' stalls, carved from
    1840): a raised floor, a row of seats with carved elbow divisions, a high back of blind tracery (two lancets and a
    quatrefoil in each bay), a coved canopy with a cusped arch, a crocketed gable and pinnacles over each seat, a
    cresting along the top; a desk before the seats with traceried panels, carved bench ends with poppy heads. 24, 10 and
    9 seats (the three runs of 17.0, 7.5 and 6.5 m). Origin on the choir floor at the run's middle, the seats facing game
    +Z, the back at game z = -0.765.
organ_case: the west gallery's organ case (the Baroque oak case of the cathedral's great organ): five towers of tin
    pipes with their mouths, carved and gilt pipe shades, moulded cornices breaking forward over each tower, an impost on
    carved consoles, panelled sides and back. Origin on the gallery's axis at the case's middle, its pipes facing game +Z.
picture_frame_*: a carved and gilt frame round a picture (the altar_frame of church.py at the picture's own size): the
    high altar's Assumption (3.50 x 5.30 m), the wall epitaphs (1.60 x 2.30 m), the pillars' pictures in their black
    and gilt frames (1.05 x 1.50 m). Origin at the picture's middle on its plane, facing game +Z.
triptych: a transept altar's triptych (Rubens' Raising and Descent of the Cross): a carved and gilt frame round the 3.60 x
    5.20 m middle panel and its two wings standing open at 35 degrees on iron hinges, framed and backed in oak.
    Origin at the middle panel's middle on its plane, facing game +Z.
high_tabernacle: the high altar's dressing: the altar cloth, a gilt tabernacle with columns and a dome under a crucifix, a
    two-stepped gradine with six tall candlesticks. Origin on the mensa's top at its middle, facing game +Z.
gilt_frieze: the high altar's frieze, a carved gilt band of acanthus scrolls (9.30 m). glory: a gilt glory of rays and
    clouds (2.5 m) behind the high altar's Virgin. altar_urn: a gilt flaming urn (1.5 m). altar_crucifix_top: the gilt
    cross on an orb that crowns the high altar. altar_angel: a white marble angel (the carved angel of carving.py in
    marble) for the high and transept altars.

One material and its atlas with church.py (the cells added here after church.py's); tin is new, for the organ's pipes.
Wood edges are chamfered 2-4 mm, gilt carving rounded, the pipes' lips 1 mm.

Blender axes while building (Z up, front toward -Y).
"""

import math

import numpy as np
from mathutils import Matrix, Vector

from . import carving
from . import church as ch
from . import kit
from . import paint as pt
from .church import Along, T, RX, RZ, bx, member, run, leaf, scroll, ball, field_panel, boards, at_z

_CELLS = {}


def cells(A):
    if id(A) in _CELLS:
        return _CELLS[id(A)]
    C = dict(ch.cells(A))

    def tin(w, h, ppm):
        # organ metal, tin and lead burnished long ago: a soft grey sheen in streaks down the pipe, a little dull bloom
        img = np.ones((h, w, 3), np.float32) * np.array((0.62, 0.62, 0.60))
        img *= (0.84 + 0.22 * pt.fbm(h, w, 3.0 * ppm, 0.004 * ppm, 261, 4))[..., None]
        img *= (0.95 + 0.06 * pt.fbm(h, w, 0.8 * ppm, 0.03 * ppm, 262, 3))[..., None]
        return ch._tile(img)

    def ebony(w, h, ppm):
        # ebonised pearwood: black, a close faint grain, a dull polish
        img = pt.wood(w, h, ppm, (0.055, 0.045, 0.038), 263, oak=False, knots=0, ring_mm=1.6, figure=0.3)
        img *= (0.90 + 0.12 * pt.fbm(h, w, 0.2 * ppm, 0.2 * ppm, 264, 3))[..., None]
        return ch._tile(img)

    C["tin"] = A.cell("church", 1.20, 0.60, 300, tin, "tin")
    C["ebony"] = A.cell("church", 0.60, 0.60, 300, ebony, "ebony")
    _CELLS[id(A)] = C
    return C


def skins(A):
    C = cells(A)
    S = ch.skins(A)
    S["long"] = Along(C["oak"])
    S["longd"] = Along(C["oakd"])
    S["longc"] = Along(C["carved"])
    S["longg"] = Along(C["gilt"])
    S["tin"] = ch.Tile(C["tin"], margin=0.2)
    S["tinl"] = Along(C["tin"], margin=0.2)
    return S


FACE = lambda y: ((0, y, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))  # a moulding run on the plane y, standing out toward -y


# ------------------------------------------------------------------ Gothic tracery


def parch(x0, x1, zs, n=8, k=1.0):
    """A pointed (equilateral when k = 1) arch from (x0, zs) over to (x1, zs), clockwise seen from the front."""
    span = x1 - x0
    R = span * k
    cl = x0 + R
    h = math.sqrt(max(1e-9, R * R - (R - span / 2) ** 2))
    a1 = math.atan2(h, (x0 + x1) / 2 - cl)
    left = [(cl + R * math.cos(a), zs + R * math.sin(a)) for a in np.linspace(math.pi, a1, n)]
    right = [(x0 + x1 - x, z) for x, z in reversed(left)]
    return left + right[1:]


ARCH_PROF = [(0.010, 0.0), (0.010, 0.006), (0.006, 0.013), (0.0, 0.016), (-0.006, 0.013), (-0.010, 0.006), (-0.010, 0.0)]


def quatrefoil(m, skin, cx, y, cz, r, tube=0.007, lobes=4, n=32):
    """A foiled ring standing on the plane y (facing -y): `lobes` round lobes, a tube of radius `tube`."""
    pts = []
    for q in range(n):
        a = 2 * math.pi * q / n + (math.pi / lobes if lobes == 4 else math.pi / 2)
        rr = r * (0.70 + 0.30 * abs(math.cos(lobes / 2 * (a - (math.pi / lobes if lobes == 4 else math.pi / 2)))))
        pts.append((cx + rr * math.cos(a), y - tube * 0.8, cz + rr * math.sin(a)))
    kit.sweep(m, pts, tube, 5, skin, closed=True, up=(0, -1, 0), thr=70.0)


def ccw(poly):
    a = sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(poly, poly[1:] + poly[:1]))
    return poly if a > 0 else poly[::-1]


def valance(m, skin, x0, x1, arc, zs, ztop, y0, y1):
    """A board on the plane y0..y1 from x0 to x1 and up to ztop, the pointed arch `arc` (from its left springing over to
    its right) cut out of it; the springings stand on short jambs down to zs - 0.06."""
    mid = len(arc) // 2
    xm = (x0 + x1) / 2
    left = [(x0, zs - 0.06), (arc[0][0], zs - 0.06)] + [tuple(p) for p in arc[:mid + 1]] + [(xm, ztop), (x0, ztop)]
    right = [(x1, zs - 0.06), (x1, ztop), (xm, ztop)] + [tuple(p) for p in arc[mid:]] + [(arc[-1][0], zs - 0.06)]
    for poly in (left, right):
        with m.at(T(0, y1, 0) @ RX(math.radians(90))):
            kit.prism(m, ccw(poly), 0.0, y1 - y0, skin, c=0.0, thr=30.0, caps=(True, True))


def tracery(m, S, x0, x1, z0, z1, y, k=1.0, foil=True, sub=True, scale=1.0):
    """Blind tracery on a panel facing -y: the outer pointed arch on jambs, two lancets under it, a quatrefoil in the
    head, all as mouldings standing out of the plane y; carved oak."""
    sk = S["longc"]
    w = x1 - x0
    zs = z1 - w * 0.866 * k  # the arch's springing, the apex at z1
    prof = [(u * scale, v * scale) for u, v in ARCH_PROF]
    path = [(x0, z0)] + parch(x0, x1, zs, 10, k) + [(x1, z0)]
    run(m, prof, path, sk, frame=FACE(y), tile=0.18, caps=(True, True))
    if sub:
        xm = (x0 + x1) / 2
        g = 0.012 * scale
        zl = zs - w * 0.10
        for a, b in ((x0 + g, xm - g / 2), (xm + g / 2, x1 - g)):
            lz = zl + (b - a) * 0.6 * k
            run(m, [(u * 0.7, v * 0.8) for u, v in prof], [(a, z0)] + parch(a, b, zl - (b - a) * 0.866 * k + (b - a) * 0.6 * k, 8, k) + [(b, z0)],
                sk, frame=FACE(y), tile=0.15, caps=(True, True))
        member(m, (xm - 0.007 * scale, y - 0.012 * scale, z0), (xm + 0.007 * scale, y, zl - (w / 2) * 0.32 * k), 2, sk, c=0.002)
        if foil:
            r = w * 0.20
            quatrefoil(m, sk, xm, y, zs + (z1 - zs) * 0.18 + r * 0.15, r, tube=0.006 * scale)
    elif foil:
        quatrefoil(m, sk, (x0 + x1) / 2, y, zs + w * 0.18, w * 0.26, tube=0.006 * scale)


def crockets(m, skin, a, b, n, y, size, side):
    """Crockets along a sloping edge from a to b (x, z) on the plane y: small curled leaves turned out from the edge."""
    a, b = np.array(a, float), np.array(b, float)
    d = b - a
    ang = math.atan2(d[1], d[0])
    for q in range(n):
        t = (q + 0.6) / (n + 0.2)
        x, z = a + d * t
        M = T(x, y, z) @ Matrix.Rotation(-(ang + side * math.pi / 2) + math.pi / 2, 4, "Y")
        leaf(m, skin, M @ RX(math.radians(-30)), size, size * 0.6, curl=1.1, nl=5, nw=4)


def finial(m, skin, x, y, z, h):
    """A Gothic finial: a knob, a ring of four leaves turned out and up, a bud on top."""
    with m.at(T(x, y, z)):
        kit.lathe(m, [(0.0, 0.0), (h * 0.10, 0.0), (h * 0.12, h * 0.08), (h * 0.08, h * 0.18), (h * 0.05, h * 0.25)], 8, skin, thr=60.0)
        for q in range(4):
            a = q * math.pi / 2 + math.pi / 4
            leaf(m, skin, T(h * 0.05 * math.cos(a), h * 0.05 * math.sin(a), h * 0.20) @ RZ(a + math.pi / 2) @ RX(math.radians(-20)),
                 h * 0.40, h * 0.22, curl=1.0, nl=5, nw=4)
        kit.lathe(m, [(0.0, h * 0.25), (h * 0.06, h * 0.30), (h * 0.09, h * 0.50), (h * 0.06, h * 0.68), (h * 0.02, h * 0.80), (0.0, h * 0.84)], 8, skin, thr=60.0)


def pinnacle(m, S, x, y, z0, z1, w):
    """A square pinnacle from z0 to z1, w across: a shaft with a sunk panel on its faces, little gablets, a crocketed
    spire, a finial."""
    sk, lc = S["carved"], S["longc"]
    zs = z0 + (z1 - z0) * 0.45
    member(m, (x - w / 2, y - w / 2, z0), (x + w / 2, y + w / 2, zs), 2, lc, c=0.003)
    # the gablets as small triangular boards on each face
    for q in range(4):
        a = q * math.pi / 2
        with m.at(T(x, y, zs) @ RZ(a)):
            outline = [(-w / 2 - 0.004, 0.0), (w / 2 + 0.004, 0.0), (0.0, w * 0.8)]
            with m.at(T(0, -w / 2, 0) @ RX(math.radians(90))):
                kit.prism(m, outline, -0.006, 0.010, sk, c=0.002, thr=30.0)
    hs = (z1 - zs)
    with m.at(T(x, y, zs)):
        kit.lathe(m, [(w * 0.50 * 1.414, 0.0), (w * 0.46 * 1.414, 0.02), (0.012, hs * 0.80), (0.0, hs * 0.80)], 4, sk, a0=math.pi / 4, thr=30.0)
    for q in range(4):
        a = q * math.pi / 2
        with m.at(T(x, y, zs) @ RZ(a)):
            for k in range(2):
                t = (k + 0.7) / 2.6
                zz = hs * 0.80 * t
                rr = w * 0.48 * (1 - t)
                leaf(m, sk, T(0, -rr - 0.004, zz) @ RX(math.radians(-35)), w * 0.42 * (1 - 0.3 * t), w * 0.28, curl=1.1, nl=4, nw=4)
    finial(m, sk, x, y, zs + hs * 0.78, hs * 0.30)


def gable(m, S, x0, x1, zb, y, rise, crocket=True):
    """A crocketed gable (wimperg) over a bay, on the plane y: a board, a moulded coping up its two slopes, crockets,
    a trefoil in its field, a finial on its apex."""
    sk = S["carved"]
    xm = (x0 + x1) / 2
    with m.at(T(0, y + 0.02, 0) @ RX(math.radians(90))):
        kit.prism(m, [(x0, zb), (x1, zb), (xm, zb + rise)], 0.0, 0.025, sk, c=0.003, thr=30.0)
    run(m, [(0.012, 0.0), (0.012, 0.012), (0.004, 0.022), (-0.008, 0.024), (-0.016, 0.014), (-0.018, 0.0)],
        [(x0, zb), (xm, zb + rise), (x1, zb)], S["longc"], frame=FACE(y - 0.005), tile=0.15, caps=(True, True))
    quatrefoil(m, sk, xm, y - 0.005, zb + rise * 0.40, rise * 0.22, tube=0.006, lobes=3)
    if crocket:
        n = max(2, int(math.hypot(xm - x0, rise) / 0.13))
        crockets(m, sk, (x0, zb), (xm, zb + rise), n, y - 0.02, 0.07, 1)
        crockets(m, sk, (x1, zb), (xm, zb + rise), n, y - 0.02, 0.07, -1)
    finial(m, sk, xm, y + 0.0, zb + rise - 0.01, 0.16)


# ------------------------------------------------------------------ the choir stalls

ST_D = 0.765  # half the stalls' depth: the back at +ST_D (Blender y), the desk's front at -ST_D
ST_FLOOR = 0.20  # the raised floor under the seats
SEAT_Z = 0.62
BACK_Y = 0.70  # the high back's face
CAN_Z = 3.30  # the canopy's foot
CAN_Y = 0.12  # the canopy's front
TOP_Z = 5.00


def stall_bay(m, S, x0, x1):
    """One seat: the seat on its brackets with a carved misericord ledge, the back's tracery, the canopy's arch and gable."""
    oak, carved, lc, long_ = S["oak"], S["carved"], S["longc"], S["long"]
    xm = (x0 + x1) / 2
    # the seat: a board with a rounded front edge, a misericord ledge carved under it
    member(m, (x0 + 0.03, 0.28, SEAT_Z - 0.035), (x1 - 0.03, BACK_Y - 0.01, SEAT_Z), 0, long_, c=0.004)
    kit.sweep(m, [(x0 + 0.03, 0.285, SEAT_Z - 0.0175), (x1 - 0.03, 0.285, SEAT_Z - 0.0175)], 0.0175, 8, S["oakh"], up=(0, 0, 1), caps=(True, True), thr=50.0)
    # under the seat: the misericord, a carved half-round bracket with a leaf mask
    with m.at(T(xm, 0.33, SEAT_Z - 0.035)):
        kit.lathe(m, [(0.0, -0.11), (0.05, -0.10), (0.085, -0.07), (0.10, -0.03), (0.10, 0.0)], 10, carved, thr=55.0, ellipse=(1.0, 0.5))
    leaf(m, carved, T(xm, 0.29, SEAT_Z - 0.12) @ RX(math.radians(-60)), 0.11, 0.09, curl=0.7, nl=5, nw=4)
    # the front of the seat's box below: a panel between the elbows
    field_panel(m, x0 + 0.03, ST_FLOOR + 0.02, x1 - 0.03, SEAT_Z - 0.06, 0.30, oak, raise_=0.010, bevel=0.035)
    # the high back: a framed panel of blind tracery
    zb0, zb1 = 1.02, CAN_Z - 0.10
    bx(m, x0, BACK_Y, SEAT_Z, x1, ST_D - 0.03, CAN_Z, S["dark"], c=0.0, skip=((1, 1),))
    field_panel(m, x0 + 0.03, SEAT_Z + 0.02, x1 - 0.03, zb0 - 0.04, BACK_Y, oak, raise_=0.010, bevel=0.04)
    member(m, (x0, BACK_Y - 0.02, zb0 - 0.04), (x1, BACK_Y, zb0), 0, long_)
    member(m, (x0 + 0.02, BACK_Y - 0.004, zb0), (x1 - 0.02, BACK_Y, zb1), 2, long_, c=0.0, caps=(False, False))
    tracery(m, S, x0 + 0.05, x1 - 0.05, zb0 + 0.02, zb1 - 0.03, BACK_Y - 0.004, k=1.0)
    # the canopy's front: a valance board pierced by a pointed arch, moulded round the opening, a trefoil in each spandrel
    w = x1 - x0 - 0.08
    za = CAN_Z - 0.04
    zs = za - w * 0.866 - 0.05
    arc = parch(x0 + 0.04, x1 - 0.04, zs, 12, 1.0)
    valance(m, oak, x0, x1, arc, zs, CAN_Z, CAN_Y - 0.02, CAN_Y)
    run(m, [(0.010, 0.0), (0.010, 0.010), (0.004, 0.017), (-0.006, 0.017), (-0.012, 0.010), (-0.012, 0.0)], [(x0 + 0.04, zs - 0.06)] + arc + [(x1 - 0.04, zs - 0.06)],
        lc, frame=FACE(CAN_Y - 0.02), tile=0.12, caps=(True, True))
    for sx in (-1, 1):
        quatrefoil(m, carved, xm + sx * w * 0.37, CAN_Y - 0.02, za - 0.07, 0.04, tube=0.005, lobes=3, n=24)
    # the gable over the bay, standing on the canopy's front
    gable(m, S, x0 + 0.05, x1 - 0.05, CAN_Z + 0.18, CAN_Y + 0.01, 0.66)


def stall_divider(m, S, x):
    """The elbow division between two seats (at x): a board from the floor to the elbow, a moulded elbow rest ending in a
    carved knob, a little buttress up the back."""
    oak, carved, long_ = S["oak"], S["carved"], S["long"]
    t = 0.024
    member(m, (x - t, 0.32, ST_FLOOR), (x + t, BACK_Y, SEAT_Z + 0.32), 1, long_, c=0.003)
    # the elbow: rising from the seat's front edge to the back
    kit.sweep(m, [(x, 0.26, SEAT_Z + 0.30), (x, 0.34, SEAT_Z + 0.33), (x, 0.50, SEAT_Z + 0.35), (x, BACK_Y, SEAT_Z + 0.36)], [0.030, 0.032, 0.030, 0.030], 8,
              S["oakh"], up=(0, 0, 1), caps=(True, True), thr=55.0)
    ball(m, carved, (x, 0.25, SEAT_Z + 0.31), 0.040, sides=10, rings=6, squash=1.1)
    for q in range(4):
        a = q * math.pi / 2 + math.pi / 4
        leaf(m, carved, T(x + 0.03 * math.cos(a), 0.25 + 0.03 * math.sin(a), SEAT_Z + 0.26) @ RZ(a + math.pi / 2) @ RX(math.radians(-15)),
             0.06, 0.04, curl=0.9, nl=4, nw=4)
    # a turned colonnette under the elbow's front
    with m.at(T(x, 0.27, ST_FLOOR)):
        kit.lathe(m, [(0.0, 0.0), (0.03, 0.0), (0.03, 0.03), (0.018, 0.05), (0.016, SEAT_Z - ST_FLOOR + 0.22), (0.024, SEAT_Z - ST_FLOOR + 0.26), (0.0, SEAT_Z - ST_FLOOR + 0.27)], 8, carved, thr=50.0)
    # up the back: an attached shaft with a capital under the canopy, between the tracery panels
    kit.sweep(m, [(x, BACK_Y - 0.015, z) for z in np.linspace(SEAT_Z + 0.36, CAN_Z - 0.06, 7)], 0.018, 8, S["oak"], up=(1, 0, 0), caps=(True, True), thr=50.0)
    with m.at(T(x, BACK_Y - 0.015, CAN_Z - 0.10)):
        kit.lathe(m, [(0.018, 0.0), (0.03, 0.01), (0.04, 0.04), (0.045, 0.06), (0.0, 0.06)], 8, carved, thr=50.0)


def desk_bay(m, S, x0, x1):
    """The desk before one seat: a traceried front panel, the sloping book board on top."""
    oak, long_ = S["oak"], S["long"]
    yf = -ST_D + 0.02
    bx(m, x0, yf, 0.08, x1, yf + 0.004, 0.90, oak, c=0.0)
    tracery(m, S, x0 + 0.05, x1 - 0.05, 0.14, 0.86, yf, k=1.0, sub=False, scale=0.9)


def bench_end(m, S, x, sx, ztop, y0, y1):
    """A carved bench end (the desk's and the seats' ends): a thick board with a moulded edge, a traceried face, a poppy
    head of leaves on top."""
    carved, lc = S["carved"], S["longc"]
    t = 0.035
    x0, x1 = sorted((x, x + sx * 2 * t))
    member(m, (x0, y0, 0.0), (x1, y1, ztop), 1, lc, c=0.004)
    xf = x1 if sx > 0 else x0  # the outer face
    with m.at(T(xf, y0 if sx > 0 else y1, 0) @ RZ(math.radians(90 if sx > 0 else -90))):
        # local x along the end (y0..y1), -y outward
        L = y1 - y0
        tracery(m, S, 0.06, L - 0.06, 0.10, ztop - 0.10, 0.0, k=1.0, sub=False, scale=0.8)
    # the poppy head: three leaves turned out round a bud
    xc, yc = (x0 + x1) / 2, (y0 + y1) / 2
    with m.at(T(xc, yc, ztop)):
        kit.lathe(m, [(0.0, 0.0), (0.03, 0.0), (0.04, 0.03), (0.03, 0.06), (0.0, 0.08)], 8, carved, thr=60.0)
    # a fleur: the middle lobe upright, two curling out to the sides, front and back, round a bud
    for rot in (0.0, math.pi):
        with m.at(T(xc, yc, ztop + 0.03) @ RZ(rot)):
            leaf(m, carved, T(0, -0.012, 0), 0.13, 0.06, curl=0.35, nl=6, nw=4)
            for side in (-1, 1):
                leaf(m, carved, T(side * 0.012, -0.010, 0) @ Matrix.Rotation(side * math.radians(38), 4, "Y"), 0.11, 0.05, curl=0.9, nl=6, nw=4)
    ball(m, carved, (xc, yc, ztop + 0.05), 0.028, sides=8, rings=5, squash=1.4)


# The three runs (pieces 8915-83, 8915-84, 8915-85) along the model's x: the desk's whole length and the seats' runs
# between the choir's piers (the round piers stand into the stalls' back half: the seats, back and canopy stop 5 cm
# short of each, the desk runs on before it).
STALL_RUNS = {
    "choir_stalls_west": ((-8.5, 8.5), [(-8.5, -7.56), (-5.50, 0.80), (2.86, 8.5)]),
    "choir_stalls_east_a": ((-3.75, 3.75), [(-3.75, 1.94)]),
    "choir_stalls_east_b": ((-3.25, 3.25), [(-3.25, 0.20), (2.26, 3.25)]),
}
END_T = 0.07  # a run's carved end


def seat_run(m, S, X0, X1):
    """One run of seats between X0 and X1: its ends, its bays (about 0.70 m), divisions, back, canopy, gables, pinnacles,
    cresting and its panelled back toward the aisle."""
    oak, carved, long_, lc = S["oak"], S["carved"], S["long"], S["longc"]
    a, b = X0 + END_T, X1 - END_T
    n = max(1, int(round((b - a) / 0.70)))
    bay = (b - a) / n
    xs = [a + k * bay for k in range(n + 1)]
    boards(m, X0, -0.04, ST_FLOOR - 0.03, X1, ST_D, ST_FLOOR, S["longd"], along=0, width=0.18)
    run(m, [(0.0, 0.0), (0.018, 0.0), (0.024, 0.01), (0.024, 0.15), (0.012, 0.17), (0.0, 0.17)], [(X0, ST_D), (X0, -0.04), (X1, -0.04), (X1, ST_D)],
        S["longd"], frame=at_z(0.0), caps=(True, True))
    for k in range(n):
        stall_bay(m, S, xs[k], xs[k + 1])
    for x in xs[1:-1]:
        stall_divider(m, S, x)
    member(m, (a, BACK_Y - 0.03, SEAT_Z - 0.02), (b, BACK_Y, SEAT_Z + 0.02), 0, long_)
    # the canopy: a cove from the back's head forward to its front, ribs under it, a moulded front beam
    nC = 7
    P = []
    for i in range(nC + 1):
        t = math.pi / 2 * i / nC
        yy = BACK_Y - (BACK_Y - CAN_Y) * math.sin(t)
        zz = CAN_Z - 0.30 + 0.30 * (1 - math.cos(t)) + 0.12 * math.sin(t)
        P.append([(x, yy, zz) for x in np.linspace(a, b, n * 2 + 1)])
    P = np.array(P)
    ST = np.array([[(P[i, j, 0] - a, i * 0.08) for j in range(P.shape[1])] for i in range(nC + 1)])
    kit.grid(m, P, ST, oak, outfn=lambda i, j, c: np.array((0, -0.6, -1.0)), thr=40.0)
    kit.grid(m, P + np.array((0, 0, 0.02)), ST, oak, outfn=lambda i, j, c: np.array((0, 0.6, 1.0)), shade=0.5, thr=40.0)
    for x in xs:
        kit.sweep(m, [(x, P[i, 0, 1], P[i, 0, 2] - 0.012) for i in range(nC + 1)], 0.016, 6, oak, up=(1, 0, 0), caps=(True, True), thr=50.0)
    member(m, (X0, CAN_Y - 0.03, CAN_Z - 0.04), (X1, CAN_Y + 0.07, CAN_Z + 0.12), 0, long_)
    run(m, [(0.0, 0.0), (0.010, 0.0), (0.016, 0.010), (0.030, 0.020), (0.036, 0.034), (0.036, 0.05), (0.0, 0.06)],
        [(X0, ST_D), (X0, CAN_Y - 0.03), (X1, CAN_Y - 0.03), (X1, ST_D)], long_, frame=at_z(CAN_Z + 0.12))
    # the canopy's roof behind the gables, panels between, the top rail with its cresting
    boards(m, X0, CAN_Y + 0.05, CAN_Z + 0.16, X1, ST_D - 0.02, CAN_Z + 0.18, long_, along=0, width=0.2)
    member(m, (X0, CAN_Y + 0.12, CAN_Z + 0.18), (X1, ST_D - 0.02, CAN_Z + 0.92), 0, long_, c=0.0)
    for k in range(n):
        field_panel(m, xs[k] + 0.03, CAN_Z + 0.22, xs[k + 1] - 0.03, CAN_Z + 0.86, CAN_Y + 0.12, oak, raise_=0.008, bevel=0.03)
    member(m, (X0, CAN_Y + 0.08, CAN_Z + 0.92), (X1, ST_D - 0.02, CAN_Z + 0.98), 0, long_)
    for x in np.arange(X0 + 0.09, X1 - 0.05, 0.175):
        leaf(m, carved, T(x, CAN_Y + 0.11, CAN_Z + 0.97), 0.11, 0.07, curl=0.3, nl=4, nw=4)
    for x in xs:
        pinnacle(m, S, x, CAN_Y + 0.02, CAN_Z + 0.12, TOP_Z - 0.02, 0.07)
    # the ends: a carved end to the seats, the back's buttress up to the canopy's top
    for sx, x in ((-1, a), (1, b)):
        bench_end(m, S, x, sx, SEAT_Z + 0.55, -0.04, BACK_Y)
        x0_, x1_ = sorted((x, x + sx * END_T))
        member(m, (x0_, BACK_Y - 0.05, 0.0), (x1_, ST_D, CAN_Z + 0.98), 2, lc, c=0.004)
    # the back toward the aisle: framed fielded panels in two rows, a plinth, the rails
    member(m, (X0, ST_D - 0.03, 0.0), (X1, ST_D, 0.18), 0, S["longd"], c=0.004)
    zr = list(np.linspace(0.18, CAN_Z + 0.90, 5))
    for k in range(n):
        for z0, z1 in zip(zr[:-1], zr[1:]):
            with m.at(T(xs[k + 1], ST_D, 0) @ RZ(math.pi)):
                field_panel(m, 0.04, z0 + 0.04, bay - 0.04, z1 - 0.04, 0.0, oak, raise_=0.012, bevel=0.05)
        member(m, (xs[k] - 0.04, ST_D - 0.02, 0.18), (xs[k] + 0.04, ST_D + 0.006, CAN_Z + 0.92), 2, long_, c=0.003)
    member(m, (xs[-1] - 0.04, ST_D - 0.02, 0.18), (xs[-1] + 0.04, ST_D + 0.006, CAN_Z + 0.92), 2, long_, c=0.003)
    for z in zr:
        member(m, (a, ST_D - 0.02, z - 0.04), (b, ST_D + 0.006, z + 0.04), 0, long_, c=0.003)


def choir_stalls(A, name):
    S = skins(A)
    long_ = S["long"]
    m = kit.Mesh(name)
    (D0, D1), runs = STALL_RUNS[name]
    for X0, X1 in runs:
        seat_run(m, S, X0, X1)
    # the desk along the whole run: its front of traceried panels, the book board, its carved ends
    n = max(1, int(round((D1 - D0 - 2 * END_T) / 0.70)))
    dx = (D1 - D0 - 2 * END_T) / n
    xs = [D0 + END_T + k * dx for k in range(n + 1)]
    for k in range(n):
        desk_bay(m, S, xs[k], xs[k + 1])
    for x in xs:
        member(m, (x - 0.022, -ST_D + 0.02, 0.0), (x + 0.022, -ST_D + 0.05, 0.92), 2, long_, c=0.003)
    member(m, (xs[0], -ST_D + 0.01, 0.0), (xs[-1], -ST_D + 0.06, 0.08), 0, S["longd"], c=0.004)
    bx(m, xs[0], -ST_D + 0.04, 0.08, xs[-1], -0.30, 0.78, S["dark"], c=0.0, skip=((1, -1),))
    member(m, (xs[0], -0.32, 0.0), (xs[-1], -0.28, 0.80), 0, long_, c=0.003)
    with m.at(T(0, -ST_D, 0.92) @ RX(math.radians(-14))):
        member(m, (xs[0] - 0.02, -0.03, 0.0), (xs[-1] + 0.02, 0.45, 0.03), 0, long_, c=0.004)
        member(m, (xs[0] - 0.02, -0.035, 0.03), (xs[-1] + 0.02, -0.005, 0.06), 0, long_, c=0.004)
    for sx, x in ((-1, xs[0]), (1, xs[-1])):
        bench_end(m, S, x, sx, 1.18, -ST_D + 0.01, -0.28)
    return m


def choir_stalls_hull(A, name):
    S = skins(A)
    d = S["dark"]
    m = kit.Mesh(name + "_hull")
    (D0, D1), runs = STALL_RUNS[name]
    for X0, X1 in runs:
        bx(m, X0, -0.04, 0.0, X1, ST_D, ST_FLOOR, d, c=0.0)  # the raised floor
        bx(m, X0, 0.28, ST_FLOOR, X1, ST_D, SEAT_Z, d, c=0.0)  # the seats' boxes
        bx(m, X0, BACK_Y - 0.03, SEAT_Z, X1, ST_D, CAN_Z + 1.0, d, c=0.0)  # the back and the canopy's roof
        bx(m, X0, CAN_Y - 0.03, CAN_Z - 0.30, X1, ST_D, CAN_Z + 0.2, d, c=0.0)  # the canopy
        for x in (X0, X1 - END_T):
            bx(m, x, -0.04, ST_FLOOR, x + END_T, BACK_Y, SEAT_Z + 0.55, d, c=0.0)
    bx(m, D0, -ST_D, 0.0, D1, -0.28, 1.05, d, c=0.0)  # the desk
    return m


def choir_stalls_west(A):
    return choir_stalls(A, "choir_stalls_west")


def choir_stalls_west_hull(A):
    return choir_stalls_hull(A, "choir_stalls_west")


def choir_stalls_east_a(A):
    return choir_stalls(A, "choir_stalls_east_a")


def choir_stalls_east_a_hull(A):
    return choir_stalls_hull(A, "choir_stalls_east_a")


def choir_stalls_east_b(A):
    return choir_stalls(A, "choir_stalls_east_b")


def choir_stalls_east_b_hull(A):
    return choir_stalls_hull(A, "choir_stalls_east_b")


# ------------------------------------------------------------------ carved and gilt frames


def frame_geo(m, S, w, h, k=1.0, leaves=True, corners=True, crest=True):
    """church.altar_frame at another size: a carved and gilt frame round a w x h picture whose plane is y = 0 (the frame
    stands out toward -y); its moulding k times the side altars'."""
    gilt = S["gilt"]
    hw, hh = w / 2, h / 2
    face = ((0, 0.0, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    prof = [(u * k, v * k) for u, v in [(0.0, -0.008), (0.0, 0.012), (0.010, 0.020), (0.020, 0.040), (0.032, 0.050), (0.040, 0.050), (0.046, 0.046),
                                         (0.052, 0.050), (0.062, 0.062), (0.078, 0.075), (0.098, 0.080), (0.118, 0.074), (0.132, 0.060), (0.140, 0.040),
                                         (0.146, 0.034), (0.156, 0.034), (0.160, 0.024), (0.160, -0.008)]]
    run(m, prof, [(-hw, -hh), (-hw, hh), (hw, hh), (hw, -hh)], S["longg"], frame=face, closed=True, tile=0.3, flip=True)
    o = 0.16 * k
    for x0, z0, x1, z1 in ((-hw - o, -hh - o, hw + o, -hh), (-hw - o, hh, hw + o, hh + o), (-hw - o, -hh, -hw, hh), (hw, -hh, hw + o, hh)):
        member(m, (x0, 0.0, z0), (x1, 0.008 * k, z1), 0 if x1 - x0 > z1 - z0 else 2, S["longg"], c=0.0)
    r = 0.09 * k
    if leaves:
        for (ax, az, bx_, bz) in ((-hw - r, -hh - r, hw + r, -hh - r), (-hw - r, hh + r, hw + r, hh + r), (-hw - r, -hh - r, -hw - r, hh + r), (hw + r, -hh - r, hw + r, hh + r)):
            L = math.hypot(bx_ - ax, bz - az)
            n = max(4, int(round(L / (0.13 * k))))
            ang = math.atan2(bz - az, bx_ - ax)
            for q in range(1, n):
                t = q / n
                leaf(m, gilt, T(ax + (bx_ - ax) * t, -0.081 * k, az + (bz - az) * t) @ Matrix.Rotation(-ang + math.pi / 2, 4, "Y"), 0.085 * k, 0.05 * k, curl=0.25, nl=5, nw=4)
    if corners:
        for sx in (-1, 1):
            for sz in (-1, 1):
                cx, cz = sx * (hw + 0.10 * k), sz * (hh + 0.10 * k)
                out_a = math.atan2(sz, sx)
                for q in range(3):
                    a = out_a + (q - 1) * 0.6
                    leaf(m, gilt, T(cx, -0.082 * k, cz) @ Matrix.Rotation(-a + math.pi / 2, 4, "Y") @ RX(math.radians(-25)), 0.11 * k, 0.06 * k, curl=0.4, nl=6, nw=5)
                M = T(cx, -0.07 * k, cz) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)) @ Matrix.Scale(-1 if sz < 0 else 1, 4, (0, 0, 1))
                scroll(m, gilt, M, 0.05 * k, turns=1.4, r0=0.012 * k, r1=0.004 * k)
    if crest:
        for q in range(9):
            a = math.radians(20 + 140 * q / 8)
            leaf(m, gilt, T(0.0, -0.075 * k, hh + 0.10 * k) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y"), 0.20 * k, 0.07 * k, curl=0.3, nl=6, nw=4)
        for sx in (-1, 1):
            scroll(m, gilt, T(sx * 0.20 * k, -0.07 * k, hh + 0.12 * k) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)), 0.07 * k, turns=1.3, r0=0.016 * k, r1=0.005 * k, tail=0.10 * k)
        for q in range(5):
            a = math.radians(-60 - 60 * q / 4)
            leaf(m, gilt, T(0.0, -0.075 * k, -hh - 0.10 * k) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y"), 0.16 * k, 0.07 * k, curl=0.4, nl=6, nw=4)


def picture_frame_high(A):
    """The high altar's frame round Rubens' Assumption (3.50 x 5.30 m), piece room-cathedral-source-8914-27."""
    S = skins(A)
    m = kit.Mesh("picture_frame_high")
    frame_geo(m, S, 3.50, 5.30, k=1.35)
    return m


def picture_frame_epitaph(A):
    """A wall epitaph's frame (1.60 x 2.30 m), pieces 8914-60 and 8914-61; their marble is the town shell's."""
    S = skins(A)
    m = kit.Mesh("picture_frame_epitaph")
    frame_geo(m, S, 1.60, 2.30, k=0.70)
    return m


def picture_frame_pillar(A):
    """A pillar's picture (1.05 x 1.50 m) in a black frame with a gilt sight moulding and gilt corner leaves, a small
    gilt cartouche at the top (pieces 8914-62 to 8914-67)."""
    S = skins(A)
    gilt = S["gilt"]
    eb = Along(cells(A)["ebony"])
    m = kit.Mesh("picture_frame_pillar")
    w, h = 1.05, 1.50
    hw, hh = w / 2, h / 2
    face = ((0, 0.0, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    rect = [(-hw, -hh), (-hw, hh), (hw, hh), (hw, -hh)]
    # the gilt sight edge: a bead and a leafy ovolo
    run(m, [(0.0, -0.004), (0.0, 0.010), (0.008, 0.018), (0.016, 0.026), (0.026, 0.028), (0.034, 0.022), (0.036, 0.012), (0.036, -0.004)],
        rect, S["longg"], frame=face, closed=True, tile=0.3, flip=True)
    # the black frame: a broad hollow and a rounded outer edge (ebonised pearwood)
    o0 = 0.036
    run(m, [(o0, -0.004), (o0, 0.024), (o0 + 0.02, 0.020), (o0 + 0.05, 0.026), (o0 + 0.075, 0.040), (o0 + 0.085, 0.050), (o0 + 0.095, 0.046),
            (o0 + 0.10, 0.030), (o0 + 0.10, -0.004)], rect, eb, frame=face, closed=True, tile=0.3, flip=True)
    o = o0 + 0.10
    for x0, z0, x1, z1 in ((-hw - o, -hh - o, hw + o, -hh), (-hw - o, hh, hw + o, hh + o), (-hw - o, -hh, -hw, hh), (hw, -hh, hw + o, hh)):
        member(m, (x0, -0.004, z0), (x1, 0.010, z1), 0 if x1 - x0 > z1 - z0 else 2, eb, c=0.0)
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = sx * (hw + 0.075), sz * (hh + 0.075)
            out_a = math.atan2(sz, sx)
            for q in range(3):
                a = out_a + (q - 1) * 0.55
                leaf(m, gilt, T(cx, -0.046, cz) @ Matrix.Rotation(-a + math.pi / 2, 4, "Y") @ RX(math.radians(-20)), 0.075, 0.04, curl=0.4, nl=5, nw=4)
    for (x, z, a) in ((0.0, -hh - 0.075, -90), (-hw - 0.075, 0.0, 180), (hw + 0.075, 0.0, 0)):
        for q in range(3):
            leaf(m, gilt, T(x, -0.046, z) @ Matrix.Rotation(-math.radians(a + (q - 1) * 40) + math.pi / 2, 4, "Y"), 0.07, 0.035, curl=0.4, nl=5, nw=4)
    ch.cartouche_geo(m, gilt, 0.0, -0.04, hh + 0.09, 0.09, 0.07, letters=False, ears=True)
    return m


def triptych(A):
    """A transept altar's triptych: the middle panel's carved and gilt frame (3.60 x 5.20 m) and the two wings standing
    open at 35.5 degrees, each a 1.79 x 5.14 m painting in an oak frame with a gilt sight edge, on iron hinges; the
    wings' backs panelled oak. Origin at the middle panel's middle on its plane, facing game +Z (the wings' hinges stand
    0.138 m before it at x = +-2.013, their outer edges 1.178 m before it at x = +-3.47, as the recovered paintings)."""
    m = kit.Mesh("triptych")
    triptych_geo(m, skins(A), A, 3.60, 5.20, 1.25, (2.013, -0.138), (3.47, -1.178), 5.14, 0.12)
    return m


def triptych_chapel(A):
    """The ambulatory chapel's triptych behind the high altar (in the piece 8902-5): its 1.60 x 2.20 m middle panel in a
    carved gilt frame, its two 0.79 x 2.14 m wings standing open at 51.6 degrees (as their recovered paintings)."""
    m = kit.Mesh("triptych_chapel")
    triptych_geo(m, skins(A), A, 1.60, 2.20, 0.62, (1.0025, -0.141), (1.493, -0.759), 2.14, 0.08)
    return m


def triptych_geo(m, S, A, cw, chh, k, hinge, outer, wing_h, c):
    """A triptych: the middle panel's frame (cw x chh, its moulding k times the side altars') and two wings, each from its
    hinge (x, y) out to its outer edge, wing_h high, framed c wide in oak with a gilt sight edge, panelled on the back, on
    three iron hinges."""
    oak, long_, iron = S["oak"], S["long"], S["iron"]
    frame_geo(m, S, cw, chh, k=k)
    hx, hy = hinge
    ox, oy = outer
    L = math.hypot(ox - hx, oy - hy)
    ang = math.atan2(oy - hy, ox - hx)
    wh = wing_h / 2
    face = ((0, 0.0, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    for sx in (-1, 1):
        M = Matrix.Scale(sx, 4, (1, 0, 0)) @ T(hx, hy, 0) @ RZ(ang)
        with m.at(M):
            # the wing in its own frame: x along it from the hinge (0..L), the painting's plane y = 0 (the frame stands 4 mm
            # behind it at its edges), its face toward -y
            run(m, [(0.0, -0.004), (0.0, 0.012), (0.012, 0.024), (0.028, 0.030), (0.044, 0.026), (0.050, 0.014), (0.050, -0.004)],
                [(0.0, -wh), (0.0, wh), (L, wh), (L, -wh)], S["longg"], frame=face, closed=True, tile=0.3, flip=True)
            for x0, z0, x1, z1 in ((-c, -wh - c, L + c, -wh), (-c, wh, L + c, wh + c), (-c, -wh, 0.0, wh), (L, -wh, L + c, wh)):
                member(m, (x0, -0.050, z0), (x1, 0.040, z1), 0 if x1 - x0 > z1 - z0 else 2, long_, c=0.003)
            # the back: boards behind the painting, three fielded panels on the outside
            boards(m, 0.0, 0.004, -wh, L, 0.040, wh, long_, along=2, width=0.30, c=0.0)
            nz = max(2, int(math.ceil(wing_h / 1.3)))
            zs = np.linspace(-wh, wh, nz + 1)
            us = [(0.05, L / 2 - 0.03), (L / 2 + 0.03, L - 0.05)] if L > 1.2 else [(0.05, L - 0.05)]
            for z0, z1 in zip(zs[:-1] + 0.04, zs[1:] - 0.04):
                with m.at(T(L, 0.040, 0) @ RZ(math.pi)):
                    for u0, u1 in us:
                        field_panel(m, u0, z0, u1, z1, 0.0, oak, raise_=0.010, bevel=0.04)
            # iron hinges: straps over the frame's back and a knuckle at the hinge line
            for z in (-wh + 0.35 * wh / 2.57, 0.0, wh - 0.35 * wh / 2.57):
                member(m, (-0.02, 0.040, z - 0.03), (min(0.55, L * 0.6), 0.050, z + 0.03), 0, Along(cells(A)["iron"], margin=0.1), c=0.002, tile=0.25)
                with m.at(T(-c * 0.66, -0.004, z - 0.08)):
                    kit.lathe(m, [(0.0, 0.0), (0.022, 0.0), (0.022, 0.16), (0.0, 0.16)], 8, iron, thr=40.0)


# ------------------------------------------------------------------ the high altar's fittings


def candlestick(m, S, x, y, z, k=1.0, wax=0.35):
    """A tall Baroque altar candlestick (brass), k times 0.90 m, with its candle."""
    prof = [(0.0, 0.0), (0.13, 0.0), (0.13, 0.02), (0.11, 0.035), (0.075, 0.08), (0.05, 0.12), (0.06, 0.15), (0.035, 0.20), (0.03, 0.30), (0.05, 0.36),
            (0.03, 0.42), (0.026, 0.55), (0.045, 0.60), (0.024, 0.66), (0.022, 0.76), (0.04, 0.80), (0.085, 0.83), (0.09, 0.85), (0.028, 0.86),
            (0.026, 0.90), (0.0, 0.90)]
    with m.at(T(x, y, z) @ Matrix.Scale(k, 4)):
        kit.lathe(m, prof, 12, S["brass"], thr=50.0, radial=lambda a, r, zz: r * (1 + 0.08 * math.cos(3 * a)) if zz < 0.05 else r)
    top = z + 0.90 * k
    with m.at(T(x, y, top)):
        kit.lathe(m, [(0.0, 0.0), (0.022, 0.0), (0.022, wax - 0.02), (0.016, wax - 0.005), (0.0, wax)], 10, S["wax"], thr=50.0)
        kit.lathe(m, [(0.0, wax), (0.0018, wax), (0.0014, wax + 0.016), (0.0, wax + 0.02)], 4, S["dark"], thr=50.0)


def cloth_geo(m, S, hw, y0, y1, drop, nx=30):
    """An altar cloth (church.altar_cloth's sheet): from y1 at the back over the mensa's top (z = 0) to its front edge y0,
    the fall down `drop` with a scalloped lace border; the side falls."""
    linen = S["linen"]
    depth = y1 - y0
    rows = [(y1 - depth * q / 4, 0.003) for q in range(5)]
    for q in range(1, 5):
        a = math.pi / 2 * q / 4
        rows.append((y0 - 0.010 * math.sin(a), 0.003 - 0.012 * (1 - math.cos(a))))
    for q in range(1, 7):
        rows.append((y0 - 0.010 - 0.002 * q, -0.012 - (drop - 0.012) * q / 6))
    P = np.zeros((len(rows), nx + 1, 3))
    ST = np.zeros((len(rows), nx + 1, 2))
    tl = 0.0
    for i, (y, z) in enumerate(rows):
        if i:
            tl += math.hypot(y - rows[i - 1][0], z - rows[i - 1][1])
        for j in range(nx + 1):
            x = -hw + 2 * hw * j / nx
            hang = max(0.0, -z - 0.1) / drop
            P[i, j] = (x, y - 0.004 * math.sin(j * 1.3) * hang, z)
            ST[i, j] = (x + hw, tl)
    kit.grid(m, P, ST, linen, outfn=lambda i, j, c: np.array((0, -1.0, 1.0)), thr=60.0)
    nl = int(2 * hw / 0.06)
    for j in range(nl):
        x = -hw + (j + 0.5) * 2 * hw / nl
        ring = [(x + 0.028 * math.cos(a), y0 - 0.024, -drop + 0.012 + 0.03 * math.sin(a) * (0.5 if math.sin(a) > 0 else 1.0)) for a in np.linspace(math.pi, 2 * math.pi, 9)]
        kit.sweep(m, ring, 0.0035, 5, linen, up=(0, -1, 0), thr=70.0, caps=(True, True))
    kit.sweep(m, [(x, y0 - 0.024, -drop + 0.03) for x in np.linspace(-hw, hw, int(2 * hw / 0.4) + 2)], 0.003, 5, linen, up=(0, -1, 0), thr=70.0, caps=(True, True))
    for sx in (-1, 1):
        x = sx * hw
        P = np.array([[(x + sx * 0.003, y1 - depth * q / 6, 0.0), (x + sx * 0.006, y1 - depth * q / 6, -drop * 0.8)] for q in range(7)])
        ST = np.array([[(depth * (1 - q / 6), 0.0), (depth * (1 - q / 6), drop)] for q in range(7)])
        kit.grid(m, P, ST, linen, outfn=lambda i, j, c, sx=sx: np.array((sx, 0, 0)), thr=60.0)


def high_tabernacle(A):
    """The high altar's dressing on its mensa (piece 8903-8): the cloth, the gradine's two steps of white marble with gilt
    mouldings and six tall candlesticks, a gilt tabernacle (an arched door with the Lamb on the book, twisted corner
    columns, a cornice with urns, a ribbed dome, a lantern and the crucifix). Origin on the mensa's top at its middle,
    facing game +Z; the mensa's front edge 0.64 m before the origin, its back 0.58 m behind."""
    S = skins(A)
    gilt, lg = S["gilt"], S["longg"]
    lm = Along(cells(A)["marble"], margin=0.4)
    m = kit.Mesh("high_tabernacle")
    cloth_geo(m, S, 1.82, -0.64, 0.58, 0.30)
    # the gradine: two steps across the back of the mensa
    for (y0, z1) in ((0.10, 0.14), (0.30, 0.28)):
        member(m, (-1.78, y0, 0.0), (1.78, 0.58, z1), 0, lm, c=0.006)
        run(m, [(0.0, 0.0), (0.010, 0.0), (0.016, 0.008), (0.010, 0.016), (0.0, 0.018)], [(-1.78, 0.58), (-1.78, y0), (1.78, y0), (1.78, 0.58)], lg,
            frame=at_z(z1 - 0.018), caps=(True, True), tile=0.3)
    for x in (-1.55, -1.12, -0.72, 0.72, 1.12, 1.55):
        candlestick(m, S, x, 0.44, 0.28, k=0.95 if abs(x) < 1.0 else 1.0, wax=0.32)
    # the tabernacle on its plinth
    W, D = 0.38, 0.28
    yc = 0.05
    member(m, (-W - 0.06, yc - D - 0.06, 0.0), (W + 0.06, yc + D + 0.06, 0.16), 0, lg, c=0.008)
    run(m, [(0.0, 0.0), (0.012, 0.0), (0.020, 0.012), (0.014, 0.026), (0.0, 0.03)],
        [(-W - 0.06, yc + D + 0.06), (-W - 0.06, yc - D - 0.06), (W + 0.06, yc - D - 0.06), (W + 0.06, yc + D + 0.06)], lg, frame=at_z(0.13), caps=(True, True), tile=0.3)
    z0, z1 = 0.16, 0.96
    member(m, (-W, yc - D, z0), (W, yc + D, z1), 2, lg, c=0.006)
    # the door: an arched panel with the Lamb lying on the book of seven seals
    yd = yc - D
    door = [(-0.20, z0 + 0.10)] + [(0.20 * math.cos(a), z1 - 0.32 + 0.20 * math.sin(a)) for a in np.linspace(math.pi, 0, 11)] + [(0.20, z0 + 0.10)]
    run(m, [(0.0, 0.0), (0.0, 0.010), (-0.012, 0.016), (-0.024, 0.010), (-0.03, 0.0)], door, lg, frame=FACE(yd), tile=0.15, caps=(True, True))
    ch.oval_field(m, gilt, 0.0, yd, z1 - 0.40, 0.13, 0.10, dome=0.012)
    with m.at(T(0, yd - 0.02, z1 - 0.40)):
        kit.sweep(m, [(-0.08, 0.0, -0.02), (0.0, -0.005, -0.03), (0.07, 0.0, -0.015)], [0.035, 0.04, 0.03], 8, gilt, up=(0, -1, 0), thr=70.0, caps=(True, True))
        ball(m, gilt, (0.08, -0.01, 0.02), 0.025, sides=8, rings=5)
        kit.sweep(m, [(0.05, -0.01, 0.0), (0.04, -0.01, 0.10)], 0.004, 5, gilt, up=(0, -1, 0), caps=(True, True))
        bx(m, 0.04, -0.012, 0.07, 0.10, -0.008, 0.10, gilt, c=0.001)
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx, cy = sx * (W + 0.02), yc + sy * (D - 0.02)
            with m.at(T(cx, cy, z0)):
                kit.lathe(m, [(0.0, 0.0), (0.05, 0.0), (0.05, 0.04), (0.04, 0.05), (0.035, 0.06)], 10, gilt, thr=50.0)
                pts = [(0.0, 0.0, 0.06 + (z1 - z0 - 0.18) * t) for t in np.linspace(0, 1, 16)]
                kit.sweep(m, pts, 0.028, 10, gilt, up=(1, 0, 0), caps=(False, False), thr=55.0, bumps=lambda s, a: 1 + 0.18 * math.cos(2 * a + s * 40))
                with m.at(T(0, 0, z1 - z0 - 0.12)):
                    kit.lathe(m, [(0.028, 0.0), (0.035, 0.03), (0.05, 0.08), (0.055, 0.12), (0.0, 0.12)], 10, gilt, thr=50.0)
    rect = [(-W - 0.07, yc + D + 0.07), (-W - 0.07, yc - D - 0.07), (W + 0.07, yc - D - 0.07), (W + 0.07, yc + D + 0.07)]
    run(m, [(0.0, 0.0), (0.012, 0.0), (0.012, 0.03), (0.03, 0.05), (0.05, 0.08), (0.055, 0.10), (0.0, 0.11)], rect, lg, frame=at_z(z1), closed=True, tile=0.3)
    # the dome: a drum, ribs, a lantern, the crucifix
    zd = z1 + 0.11
    with m.at(T(0, yc, zd)):
        kit.lathe(m, [(0.0, 0.0), (0.34, 0.0), (0.34, 0.08), (0.36, 0.10), (0.30, 0.12), (0.30, 0.14)], 16, gilt, thr=50.0)
        dome = [(0.30 * math.cos(a), 0.14 + 0.30 * math.sin(a)) for a in np.linspace(0, math.pi / 2 - 0.25, 8)]
        kit.lathe(m, dome + [(0.07, 0.43), (0.0, 0.43)], 16, gilt, thr=45.0)
        for q in range(8):
            a = 2 * math.pi * q / 8
            pts = [(0.31 * math.cos(b) * math.cos(a), 0.31 * math.cos(b) * math.sin(a), 0.14 + 0.31 * math.sin(b)) for b in np.linspace(0, math.pi / 2 - 0.3, 7)]
            kit.sweep(m, pts, 0.012, 6, gilt, up=(0, 0, 1), caps=(True, True), thr=60.0)
        kit.lathe(m, [(0.0, 0.43), (0.08, 0.43), (0.08, 0.47), (0.06, 0.48), (0.06, 0.60), (0.09, 0.62), (0.05, 0.66), (0.0, 0.70)], 10, gilt, thr=50.0)
        ball(m, gilt, (0.0, 0.0, 0.74), 0.05, sides=10, rings=6)
        bx(m, -0.014, -0.012, 0.78, 0.014, 0.012, 1.30, gilt, c=0.003)
        bx(m, -0.13, -0.012, 1.10, 0.13, 0.012, 1.13, gilt, c=0.003)
        for (x, z) in ((0.0, 1.31), (-0.14, 1.115), (0.14, 1.115)):
            ball(m, gilt, (x, 0.0, z), 0.018, sides=8, rings=4)
        ball(m, gilt, (0.0, -0.024, 1.155), 0.015, sides=8, rings=4)
        kit.sweep(m, [(0.0, -0.024, 1.14), (0.0, -0.026, 1.06), (0.004, -0.024, 0.99), (0.006, -0.022, 0.93)], [0.015, 0.017, 0.011, 0.008], 8, gilt, up=(0, -1, 0), thr=70.0)
        for sx in (-1, 1):
            kit.sweep(m, [(sx * 0.012, -0.024, 1.125), (sx * 0.065, -0.022, 1.11), (sx * 0.115, -0.02, 1.115)], [0.007, 0.006, 0.005], 6, gilt, up=(0, -1, 0), thr=70.0)
    for sx in (-1, 1):
        for sy in (-1, 1):
            ch.urn(m, S, sx * (W + 0.02), yc + sy * (D - 0.02), z1 + 0.11, 0.45, body="gilt")
    return m


def gilt_frieze(A):
    """The high altar's frieze (piece 8914-32): a gilt band 9.30 m long, 0.12 m high, a row of water leaves between two
    bead mouldings. Origin at its foot's middle, its face 0.025 m before the origin, facing game +Z."""
    S = skins(A)
    gilt, lg = S["gilt"], S["longg"]
    m = kit.Mesh("gilt_frieze")
    L = 9.30
    member(m, (-L / 2, -0.025, 0.0), (L / 2, 0.025, 0.12), 0, lg, c=0.004)
    for z in (0.012, 0.108):
        kit.sweep(m, [(x, -0.028, z) for x in np.linspace(-L / 2 + 0.01, L / 2 - 0.01, 25)], 0.010, 6, gilt, up=(0, -1, 0), caps=(True, True), thr=60.0)
    n = int(L / 0.075)
    for q in range(n):
        x = -L / 2 + (q + 0.5) * L / n
        leaf(m, gilt, T(x, -0.027, 0.025), 0.075, 0.055, curl=0.6, nl=5, nw=4)
    return m


def glory(A):
    """The gilt glory behind the high altar's Virgin (piece 8914-33): a ring of clouds round a disc of light, rays long
    and short and flame-waved in turn, 2.5 m across. Origin at its middle on its plane, facing game +Z."""
    S = skins(A)
    gilt = S["gilt"]
    m = kit.Mesh("glory")
    R = 1.25
    with m.at(T(0, 0.02, 0) @ RX(math.radians(90))):
        kit.lathe(m, [(0.0, 0.0), (0.46, 0.0), (0.48, 0.010), (0.48, 0.02), (0.0, 0.02)], 32, gilt, thr=40.0)
    rng = np.random.default_rng(7)
    for q in range(40):
        a = 2 * math.pi * q / 40
        rr = 0.50 + 0.06 * math.sin(q * 2.3)
        ball(m, gilt, (rr * math.cos(a), -0.03 - 0.02 * rng.random(), rr * math.sin(a)), 0.07 + 0.03 * rng.random(), sides=8, rings=5, squash=0.8)
    for q in range(48):
        a = 2 * math.pi * q / 48
        L = R * (1.0 if q % 2 == 0 else 0.78)
        w0 = 0.05 if q % 2 == 0 else 0.035
        M = Matrix.Rotation(-a, 4, "Y") @ RX(math.radians(90))
        if q % 4 == 1:
            # a waved flame ray
            pts = [(0.55 + (L - 0.55) * t, 0.03 * math.sin(t * 9) * (1 - t)) for t in np.linspace(0, 1, 9)]
            outline = [(x, y - w0 * 0.8 * (1 - (x - 0.55) / (L - 0.55)) - 0.002) for x, y in pts] + [(x, y + w0 * 0.8 * (1 - (x - 0.55) / (L - 0.55)) + 0.002) for x, y in pts[::-1]]
            with m.at(M):
                kit.prism(m, ccw(outline), -0.012, 0.004, gilt, c=0.0, thr=40.0)
        else:
            with m.at(M):
                kit.prism(m, [(0.55, -w0), (L, -0.006), (L + 0.01, 0.0), (L, 0.006), (0.55, w0)], -0.012, 0.004, gilt, c=0.003, thr=40.0)
    return m


def altar_urn(A):
    """A gilt flaming urn on the high altar's attic (pieces 8914-34, 8914-35), 1.50 m: a square socle, a gadrooned
    body with handles, garlands, a lid and a flame of four tongues."""
    S = skins(A)
    gilt = S["gilt"]
    m = kit.Mesh("altar_urn")
    bx(m, -0.20, -0.20, 0.0, 0.20, 0.20, 0.10, gilt, c=0.008)
    kit.lathe(m, [(0.0, 0.10), (0.15, 0.10), (0.15, 0.13), (0.09, 0.17), (0.07, 0.22), (0.10, 0.27), (0.20, 0.40), (0.23, 0.52), (0.20, 0.66),
                  (0.12, 0.74), (0.10, 0.78), (0.14, 0.80), (0.14, 0.84), (0.06, 0.88), (0.0, 0.90)], 20, gilt, thr=50.0,
              radial=lambda a, r, z: r * (1 + 0.06 * abs(math.cos(8 * a))) if 0.26 < z < 0.50 else r)
    for sx in (-1, 1):
        kit.sweep(m, [(sx * 0.20, 0.0, 0.66), (sx * 0.30, 0.0, 0.70), (sx * 0.30, 0.0, 0.58), (sx * 0.22, 0.0, 0.50)], 0.016, 6, gilt, up=(0, 1, 0), caps=(True, True), thr=60.0)
    for q in range(4):
        a = q * math.pi / 2
        pts = [(0.235 * math.cos(a + t * math.pi / 2), 0.235 * math.sin(a + t * math.pi / 2), 0.60 - 0.08 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 9)]
        kit.sweep(m, pts, 0.018, 6, gilt, up=(0, 0, 1), caps=(True, True), thr=60.0)
    for q in range(4):
        a = q * math.pi / 2 + 0.3
        with m.at(T(0, 0, 0.88) @ RZ(a)):
            leaf(m, gilt, T(0, 0.02, 0), 0.62 - 0.08 * (q % 2), 0.16, curl=-0.3, nl=8, nw=5)
    return m


def altar_crucifix_top(A):
    """The cross that crowns the high altar (piece 8914-36): an orb on a moulded socle, a gilt cross with trefoil ends and
    a ring of short rays at the crossing; 1.20 m."""
    S = skins(A)
    gilt = S["gilt"]
    m = kit.Mesh("altar_crucifix_top")
    kit.lathe(m, [(0.0, 0.0), (0.14, 0.0), (0.14, 0.04), (0.10, 0.06), (0.06, 0.10), (0.05, 0.12)], 12, gilt, thr=50.0)
    ball(m, gilt, (0.0, 0.0, 0.24), 0.13, sides=14, rings=8)
    kit.sweep(m, [(0.13 * math.cos(a), 0.13 * math.sin(a), 0.24) for a in np.linspace(0, 2 * math.pi, 25)[:-1]], 0.008, 5, gilt, closed=True, up=(0, 0, 1), thr=60.0)
    bx(m, -0.028, -0.022, 0.36, 0.028, 0.022, 1.12, gilt, c=0.005)
    bx(m, -0.26, -0.022, 0.86, 0.26, 0.022, 0.92, gilt, c=0.005)
    for (x, z, a) in ((0.0, 1.15, 90), (-0.29, 0.89, 180), (0.29, 0.89, 0)):
        for d in (-1, 0, 1):
            b = math.radians(a + d * 70)
            ball(m, gilt, (x + 0.035 * math.cos(b), 0.0, z + 0.035 * math.sin(b)), 0.032, sides=8, rings=5)
    for q in range(16):
        a = 2 * math.pi * q / 16
        L = 0.24 if q % 2 == 0 else 0.17
        with m.at(T(0, 0.0, 0.89) @ Matrix.Rotation(-a, 4, "Y") @ RX(math.radians(90))):
            kit.prism(m, [(0.05, -0.012), (L, -0.003), (L, 0.003), (0.05, 0.012)], -0.006, 0.006, gilt, c=0.002, thr=40.0)
    return m


def altar_angel(A):
    """A white marble angel (the carved angel of the confessionals in marble), 1.78 m; each altar draws it at its size."""
    C = cells(A)
    old = carving._CELLS.get(id(A))
    carving._CELLS[id(A)] = {"oak": C["marble"]}
    try:
        m = carving.angel(A)
    finally:
        if old is None:
            carving._CELLS.pop(id(A), None)
        else:
            carving._CELLS[id(A)] = old
    m.name = "altar_angel"
    return m


# ------------------------------------------------------------------ the organ case

# (x0, x1, cornice top, pipes): the five towers across the case, outer to outer, as the recovered case had them
ORGAN_TOWERS = [(-4.60, -3.00, 15.40, 5), (-2.75, -1.15, 17.10, 7), (-1.05, 1.05, 18.95, 9), (1.15, 2.75, 17.10, 7), (3.00, 4.60, 15.40, 5)]
ORGAN_FOOT, ORGAN_IMPOST = 9.07, 9.70
PIPE_Y = -0.66  # the front pipes' axes
TOWER_FRONT = -0.86


def pipe(m, S, x, y, z0, z1, r, foot):
    """A front pipe of tin: a conical foot, the body, the mouth (a dark slot under a pointed upper lip) facing -y."""
    tin = S["tin"]
    zf = z0 + foot
    with m.at(T(x, y, 0)):
        kit.lathe(m, [(0.0, z0), (r * 0.12, z0), (r * 0.18, z0 + 0.02), (r * 0.98, zf - 0.01), (r, zf)], 12, tin, thr=40.0)
        body = [(r, zf + (z1 - 0.004 - zf) * q / max(1, int(math.ceil((z1 - zf) / 0.9)))) for q in range(int(math.ceil((z1 - zf) / 0.9)) + 1)]
        kit.lathe(m, body + [(r - 0.003, z1), (r * 0.80, z1), (r * 0.80, z1 - 0.02), (0.0, z1 - 0.02)], 12, tin, thr=40.0, cref=r)
    w = r * 0.95
    bx(m, x - w / 2, y - r * 0.985, zf + 0.012, x + w / 2, y - r * 0.92, zf + 0.012 + r * 0.42, S["dark"], c=0.0)
    with m.at(T(x, y - r * 0.99, zf + 0.012 + r * 0.42) @ RX(math.radians(90))):
        kit.prism(m, [(-w / 2, 0.0), (w / 2, 0.0), (0.0, r * 0.70)], -0.004, 0.002, tin, c=0.001, thr=40.0)
    # the lower lip: a band across the mouth's foot
    bx(m, x - w / 2 - 0.004, y - r * 1.0, zf - 0.004, x + w / 2 + 0.004, y - r * 0.90, zf + 0.012, tin, c=0.001)


def pipe_shade(m, S, x0, x1, zlo, zhi, y):
    """A tower's pipe shade: a pierced gilt board of acanthus over the pipes' tops (from zlo up to zhi under the
    cornice), carved in the round: scrolls meeting at a shell in the middle, leaves along its foot."""
    gilt = S["gilt"]
    member(m, (x0, y, zlo), (x1, y + 0.02, zhi), 0, S["longg"], c=0.003)
    xm = (x0 + x1) / 2
    w = x1 - x0
    h = zhi - zlo
    for sx in (-1, 1):
        M = T(xm + sx * w * 0.25, y - 0.02, zlo + h * 0.45) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0))
        scroll(m, gilt, M, min(h, w * 0.25) * 0.35, turns=1.3, r0=0.020, r1=0.006, tail=w * 0.12)
        for q in range(3):
            leaf(m, gilt, T(xm + sx * w * (0.10 + 0.13 * q), y - 0.01, zlo + 0.02) @ Matrix.Rotation(sx * math.radians(-20 - 25 * q), 4, "Y"),
                 h * 0.75, w * 0.08, curl=0.7, nl=6, nw=4)
    for q in range(7):
        a = math.radians(20 + 140 * q / 6)
        leaf(m, gilt, T(xm, y - 0.015, zlo + h * 0.25) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y"), h * 0.55, w * 0.05, curl=0.3, nl=6, nw=4)


def deep(m, lo, hi, axis, skin, c=0.003, caps=(True, True), pieces=2):
    """member() for a member deeper (along Blender y) than a texture tile: in `pieces` lengths across y, side by side."""
    ys = np.linspace(lo[1], hi[1], pieces + 1)
    for a, b in zip(ys, ys[1:]):
        member(m, (lo[0], a, lo[2]), (hi[0], b, hi[2]), axis, skin, c=c, caps=caps)


LOFT_FLOOR = 7.55  # the organ loft's floor (the organist's chair stands on it)


def organ_lower(m, S):
    """The organ's lower case from the loft's floor up to the impost, panelled, and the console built out of it toward
    the organist's chair: two manuals of ivory and ebony keys between carved cheeks, drawknobs on the jambs, a music desk,
    the pedal board."""
    oak, carved, long_, wax, dark = S["oak"], S["carved"], S["long"], S["wax"], S["dark"]
    W = 4.75
    yf = -0.70
    member(m, (-W, yf, LOFT_FLOOR), (W, yf + 0.04, LOFT_FLOOR + 0.12), 0, S["longd"], c=0.004)
    segs = [(a_, b_) for lo, hi in ((-W, -0.82), (0.82, W)) for a_, b_ in zip(np.linspace(lo, hi, 6)[:-1], np.linspace(lo, hi, 6)[1:])]
    # Rebated backing closes the panel margins: the earlier open frames showed strips of
    # pale masonry through the lower case. Separate boards retain vertical grain at the back.
    for lo, hi in ((-W, -0.82), (-0.82, 0.82), (0.82, W)):
        boards(m, lo, yf + 0.025, LOFT_FLOOR + 0.10, hi, yf + 0.065, ORGAN_FOOT, long_, along=2, width=0.45, c=0.001)
    for x0, x1 in segs:
        field_panel(m, x0 + 0.04, LOFT_FLOOR + 0.16, x1 - 0.04, ORGAN_FOOT - 0.06, yf, oak, raise_=0.012, bevel=0.05)
        member(m, (x0 - 0.02, yf - 0.012, LOFT_FLOOR + 0.12), (x0 + 0.02, yf, ORGAN_FOOT), 2, long_, c=0.003)
    for sx in (-1, 1):
        with m.at(T(sx * W, 0, 0) @ RZ(math.radians(90 * sx))):
            for k in range(3):
                field_panel(m, -0.65 + k * 0.45, LOFT_FLOOR + 0.16, -0.65 + (k + 1) * 0.45 - 0.05, ORGAN_FOOT - 0.06, 0.0, oak, raise_=0.012, bevel=0.05)
    # the console: its cheeks, the key desk, two manuals, the music desk, drawknobs, the pedals
    yc = -1.62
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.62, sx * 0.82))
        member(m, (x0, yc, LOFT_FLOOR), (x1, yf, 8.95), 1, long_, c=0.004)
        # the cheek's front: a carved scroll
        scroll(m, carved, T(sx * 0.72, yc - 0.01, 8.62) @ RZ(math.pi / 2 * 0) @ Matrix.Scale(sx, 4, (1, 0, 0)), 0.09, turns=1.3, r0=0.02, r1=0.007)
        # drawknobs on the jamb's inner face, three columns of eight
        for c_ in range(3):
            for r_ in range(8):
                y = yc + 0.30 + c_ * 0.12
                z = 8.42 + r_ * 0.065
                with m.at(T(sx * 0.62, y, z) @ Matrix.Rotation(-sx * math.pi / 2, 4, "Y")):
                    kit.lathe(m, [(0.0, 0.0), (0.008, 0.0), (0.008, 0.035), (0.016, 0.04), (0.016, 0.055), (0.0, 0.06)], 8, wax if r_ % 2 else S["brass"], thr=50.0)
    member(m, (-0.62, yc + 0.02, LOFT_FLOOR + 0.12), (0.62, yc + 0.06, 8.20), 0, long_, c=0.003)
    member(m, (-0.62, yc, 8.20), (0.62, yf, 8.26), 0, long_, c=0.003)
    for k, (z, y0) in enumerate(((8.27, yc + 0.04), (8.39, yc + 0.20))):
        member(m, (-0.60, y0 + 0.16, z - 0.01), (0.60, y0 + 0.36, z + 0.10), 0, long_, c=0.003)
        n = 54
        w = 1.16 / n
        for q in range(n):
            x = -0.58 + q * w
            bx(m, x + 0.001, y0, z, x + w - 0.001, y0 + 0.16, z + 0.018, wax, c=0.0015)
        for q in range(n - 1):
            if q % 7 in (2, 6):
                continue
            x = -0.58 + (q + 1) * w
            bx(m, x - w * 0.3, y0 + 0.06, z + 0.018, x + w * 0.3, y0 + 0.16, z + 0.032, dark, c=0.0015)
    with m.at(T(0, yc + 0.46, 8.62) @ RX(math.radians(-12))):
        member(m, (-0.55, -0.02, 0.0), (0.55, 0.0, 0.32), 0, long_, c=0.003)
        member(m, (-0.55, -0.06, 0.0), (0.55, -0.02, 0.025), 0, long_, c=0.003)
    member(m, (-0.62, yc + 0.40, 8.94), (0.62, yf, 8.98), 0, long_, c=0.003)
    for q in range(27):
        x = -0.55 + q * 1.10 / 26
        bx(m, x - 0.012, yc - 0.40, LOFT_FLOOR + 0.02, x + 0.012, yc + 0.02, LOFT_FLOOR + 0.07, oak if q % 7 not in (1, 3, 4) else S["oakd"], c=0.002)
    member(m, (-0.62, yc - 0.42, LOFT_FLOOR), (0.62, yc + 0.04, LOFT_FLOOR + 0.02), 0, S["longd"], c=0.0)


def organ_case(A):
    """The west gallery's organ case (piece 8914-26): an impost on carved consoles across the gallery, five towers of
    tin pipes (5, 7, 9, 7, 5) between panelled oak posts hung with carved gilt drops, gilt pipe shades, moulded cornices
    over each tower, gilt urns on the middle towers' cornices (the figures on the others are the carved angels drawn
    beside it); a panelled oak case behind, dark inside; the panelled lower case down to the loft's floor (7.55 m) with the
    console built out toward the organist's chair. Origin on the nave's floor line under the case's middle, the pipes
    facing game +Z."""
    S = skins(A)
    oak, carved, gilt, long_, lg = S["oak"], S["carved"], S["gilt"], S["long"], S["longg"]
    m = kit.Mesh("organ_case")
    organ_lower(m, S)
    W = 4.85
    # The closed carcase ceiling supports the projecting impost, without an open slot
    # between the lower panels and the tower consoles.
    deep(m, (-W, TOWER_FRONT, ORGAN_FOOT - 0.025), (W, 0.70, ORGAN_FOOT + 0.025), 0, long_, c=0.003, pieces=5)
    # the impost: a moulded base across the case's front and sides, breaking forward under each tower
    deep(m, (-W + 0.15, -0.72, ORGAN_FOOT + 0.12), (W - 0.15, 0.70, ORGAN_IMPOST - 0.06), 0, long_)
    for x0, x1, top, n in ORGAN_TOWERS:
        member(m, (x0 - 0.10, TOWER_FRONT, ORGAN_FOOT + 0.12), (x1 + 0.10, -0.70, ORGAN_IMPOST - 0.06), 0, long_)
        # two carved consoles under the tower: a scroll on each, a leaf down its front
        for xc in (x0 + 0.05, x1 - 0.05):
            bx(m, xc - 0.06, TOWER_FRONT + 0.02, ORGAN_FOOT, xc + 0.06, -0.70, ORGAN_FOOT + 0.12, carved, c=0.004)
            scroll(m, carved, T(xc, TOWER_FRONT - 0.005, ORGAN_FOOT + 0.30) @ RZ(math.pi / 2) @ Matrix.Scale(-1, 4, (1, 0, 0)), 0.12, turns=1.3, r0=0.03, r1=0.01)
            leaf(m, carved, T(xc, TOWER_FRONT, ORGAN_FOOT + 0.04), 0.30, 0.10, curl=0.6, nl=6, nw=4)
    imp = [(0.0, 0.0), (0.02, 0.0), (0.03, 0.02), (0.05, 0.03), (0.08, 0.06), (0.09, 0.08), (0.09, 0.10), (0.0, 0.12)]
    path = [(-W, 0.70), (-W, -0.72)]
    for x0, x1, top, n in ORGAN_TOWERS:
        path += [(x0 - 0.10, -0.72), (x0 - 0.10, TOWER_FRONT), (x1 + 0.10, TOWER_FRONT), (x1 + 0.10, -0.72)]
    path += [(W, -0.72), (W, 0.70)]
    run(m, imp, path, long_, frame=at_z(ORGAN_IMPOST - 0.12), tile=0.4)
    run(m, [(0.0, 0.0), (0.03, 0.02), (0.03, 0.06), (0.0, 0.08)], path, long_, frame=at_z(ORGAN_FOOT), tile=0.4)
    for k, (x0, x1, top, n) in enumerate(ORGAN_TOWERS):
        zt = top - 0.40  # the cornice's foot
        # the case behind the tower: dark inside, panelled sides, the back on the wall
        bx(m, x0, -0.30, ORGAN_IMPOST, x1, -0.26, zt, S["dark"], c=0.0)
        boards(m, x0 - 0.08, 0.66, ORGAN_IMPOST, x1 + 0.08, 0.70, zt, long_, along=2, width=0.4, c=0.0)
        # the posts each side of the pipes, a carved drop on each
        for xp in (x0 - 0.04, x1 + 0.04):
            deep(m, (xp - 0.06, TOWER_FRONT + 0.01, ORGAN_IMPOST), (xp + 0.06, 0.66, zt), 2, long_, c=0.003)
            member(m, (xp - 0.045, TOWER_FRONT - 0.005, ORGAN_IMPOST + 0.06), (xp + 0.045, TOWER_FRONT + 0.01, zt - 0.06), 2, long_, c=0.002)
            with m.at(T(xp, TOWER_FRONT - 0.005, zt - 0.18) @ Matrix.Scale(2.6, 4)):
                ch.garland_drop(m, {"carved": gilt}, 0.0, 0.0, min(1.6, (zt - ORGAN_IMPOST) * 0.40) / 2.6, 0.0)
        # the pipes: tallest in the middle, their feet on the rack at the impost, the shade over their tops
        span = x1 - x0 - 0.10
        r0 = min(0.105, span / n / 2 - 0.012)
        tops = []
        for q in range(n):
            t = abs(q - (n - 1) / 2) / ((n - 1) / 2)
            x = x0 + 0.05 + span * (q + 0.5) / n
            ztop = zt - 0.55 - (zt - ORGAN_IMPOST) * 0.22 * t ** 1.3
            r = r0 * (1 - 0.18 * t)
            pipe(m, S, x, PIPE_Y, ORGAN_IMPOST + 0.02, ztop, r, 0.55 + 0.25 * (1 - t))
            tops.append(ztop)
        # the rack under the pipes' feet, the shade over their tops
        member(m, (x0, PIPE_Y - 0.13, ORGAN_IMPOST), (x1, PIPE_Y + 0.13, ORGAN_IMPOST + 0.04), 0, long_, c=0.003)
        pipe_shade(m, S, x0 + 0.02, x1 - 0.02, max(tops) + 0.03, zt, TOWER_FRONT + 0.05)
        # the cornice: frieze, mouldings, returning to the case behind
        cp = [(x0 - 0.10, 0.66), (x0 - 0.10, TOWER_FRONT - 0.02), (x1 + 0.10, TOWER_FRONT - 0.02), (x1 + 0.10, 0.66)]
        deep(m, (x0 - 0.10, TOWER_FRONT - 0.02, zt), (x1 + 0.10, 0.66, zt + 0.16), 0, long_)
        run(m, [(0.0, 0.0), (0.012, 0.0), (0.018, 0.012), (0.03, 0.02), (0.03, 0.04), (0.0, 0.05)], cp, long_, frame=at_z(zt - 0.05))
        run(m, [(0.0, 0.0), (0.02, 0.0), (0.03, 0.02), (0.06, 0.04), (0.06, 0.08), (0.12, 0.10), (0.14, 0.13), (0.15, 0.17), (0.17, 0.20), (0.17, 0.23), (0.0, 0.24)],
            cp, long_, frame=at_z(zt + 0.16))
        for xd in np.arange(x0 - 0.04, x1 + 0.05, 0.08):
            bx(m, xd - 0.018, TOWER_FRONT - 0.02 - 0.075, zt + 0.19, xd + 0.018, TOWER_FRONT - 0.02 - 0.05, zt + 0.23, oak, c=0.003)
        # a gilt fillet of leaves under the cornice's frieze
        for xl in np.arange(x0 + 0.02, x1, 0.12):
            leaf(m, gilt, T(xl, TOWER_FRONT - 0.025, zt + 0.01), 0.13, 0.08, curl=0.5, nl=5, nw=4)
        if k in (1, 3):
            ch.urn(m, S, (x0 + x1) / 2, (TOWER_FRONT + 0.66) / 2 - 0.3, top, 2.2, body="gilt")
    # the gaps between the towers: the case's dark inside behind a gilt carved board
    for (a0, a1, ta, _), (b0, b1, tb, _) in zip(ORGAN_TOWERS, ORGAN_TOWERS[1:]):
        g0, g1 = a1 + 0.10, b0 - 0.10
        zt = min(ta, tb) - 0.40
        if g1 - g0 < 0.04:
            continue
        bx(m, g0, -0.62, ORGAN_IMPOST, g1, -0.58, zt, S["dark"], c=0.0)
        for z in np.arange(ORGAN_IMPOST + 0.5, zt - 0.3, 0.9):
            leaf(m, gilt, T((g0 + g1) / 2, -0.63, z), 0.30, 0.10, curl=0.6, nl=6, nw=4)
    # the sides of the case: framed fielded panels
    for sx in (-1, 1):
        xs = sx * W
        top = ORGAN_TOWERS[0][2] - 0.40
        zs = np.linspace(ORGAN_IMPOST + 0.05, top - 0.05, 5)
        for z0, z1 in zip(zs[:-1] + 0.05, zs[1:] - 0.05):
            if sx < 0:
                with m.at(T(xs, 0.60, 0) @ RZ(math.radians(-90))):
                    field_panel(m, 0.0, z0, 1.24, z1, 0.0, oak, raise_=0.012, bevel=0.06)
            else:
                with m.at(T(xs, -0.64, 0) @ RZ(math.radians(90))):
                    field_panel(m, 0.0, z0, 1.24, z1, 0.0, oak, raise_=0.012, bevel=0.06)
    # the middle tower's crest: a gilt cartouche between scrolls under the figure
    x0, x1, top, n = ORGAN_TOWERS[2]
    cy = TOWER_FRONT + 0.15
    for sx in (-1, 1):
        with m.at(T(0, cy + 0.06, 0) @ RX(math.radians(90)) @ Matrix.Scale(sx, 4, (1, 0, 0))):
            kit.prism(m, [(0.0, top), (0.55, top), (0.40, top + 0.30), (0.0, top + 0.30)], 0.0, 0.06, gilt, c=0.004, thr=30.0)
    ch.cartouche_geo(m, gilt, 0.0, cy, top + 0.18, 0.22, 0.16, letters=False, ears=True)
    for sx in (-1, 1):
        scroll(m, gilt, T(sx * 0.62, cy, top + 0.10) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)), 0.12, turns=1.25, r0=0.028, r1=0.009, tail=0.12)
    return m


def organ_case_hull(A):
    S = skins(A)
    d = S["dark"]
    m = kit.Mesh("organ_case_hull")
    W = 4.85
    bx(m, -4.75, -0.70, LOFT_FLOOR, 4.75, 0.70, ORGAN_FOOT, d, c=0.0)  # the lower case
    bx(m, -0.82, -1.62, LOFT_FLOOR, 0.82, -0.70, 8.98, d, c=0.0)  # the console
    bx(m, -W, TOWER_FRONT - 0.04, ORGAN_FOOT, W, 0.72, ORGAN_IMPOST, d, c=0.0)
    for x0, x1, top, n in ORGAN_TOWERS:
        bx(m, x0 - 0.12, TOWER_FRONT - 0.04, ORGAN_IMPOST, x1 + 0.12, 0.72, top, d, c=0.0)
    for (a0, a1, ta, _), (b0, b1, tb, _) in zip(ORGAN_TOWERS, ORGAN_TOWERS[1:]):
        if b0 - a1 > 0.24:
            bx(m, a1, -0.62, ORGAN_IMPOST, b0, 0.72, min(ta, tb) - 0.40, d, c=0.0)
    return m


def ihs_medallion(A):
    """The gilt medallion in a transept altar's glory (pieces 8914-39, 8914-42): a domed disc with IHS and the cross cut on
    it, a rolled rim and a ring of small leaves; 0.62 m across. Origin at its middle on its plane, facing game +Z."""
    S = skins(A)
    gilt = S["gilt"]
    m = kit.Mesh("ihs_medallion")
    ch.oval_field(m, gilt, 0.0, 0.0, 0.0, 0.26, 0.26, dome=0.03)
    ch.ihs(m, gilt, 0.0, -0.03, -0.02, 0.22)
    kit.sweep(m, [(0.28 * math.cos(a), -0.012, 0.28 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 37)[:-1]], 0.025, 7, gilt, closed=True, up=(0, -1, 0), thr=70.0)
    for q in range(18):
        a = 2 * math.pi * q / 18
        leaf(m, gilt, T(0.31 * math.cos(a), -0.01, 0.31 * math.sin(a)) @ Matrix.Rotation(-a + math.pi / 2, 4, "Y"), 0.06, 0.04, curl=0.3, nl=4, nw=4)
    return m


# ------------------------------------------------------------------ the transept and crossing altars' dressing


def altar_cross(m, S, x, y, z, k=1.0):
    """church.altar_dressing's gilt altar cross with its corpus, k times 0.63 m, standing on (x, y, z)."""
    gilt = S["gilt"]
    with m.at(T(x, y, z) @ Matrix.Scale(k, 4)):
        kit.lathe(m, [(0.0, 0.0), (0.10, 0.0), (0.10, 0.02), (0.08, 0.03), (0.05, 0.05), (0.05, 0.07), (0.03, 0.09), (0.0, 0.09)], 8, gilt, a0=math.pi / 8, thr=40.0)
        bx(m, -0.012, -0.010, 0.09, 0.012, 0.010, 0.62, gilt, c=0.003)
        bx(m, -0.15, -0.010, 0.48, 0.15, 0.010, 0.505, gilt, c=0.003)
        for (xx, zz) in ((0.0, 0.63), (-0.16, 0.4925), (0.16, 0.4925)):
            ball(m, gilt, (xx, 0.0, zz), 0.018, sides=8, rings=4)
        ball(m, gilt, (0.0, -0.022, 0.535), 0.016, sides=8, rings=4)
        kit.sweep(m, [(0.0, -0.022, 0.52), (0.0, -0.024, 0.44), (0.004, -0.022, 0.36), (0.006, -0.02, 0.29)], [0.016, 0.018, 0.012, 0.008], 8, gilt, up=(0, -1, 0), thr=70.0)
        for sx in (-1, 1):
            kit.sweep(m, [(sx * 0.012, -0.022, 0.505), (sx * 0.07, -0.02, 0.49), (sx * 0.125, -0.018, 0.495)], [0.007, 0.006, 0.005], 6, gilt, up=(0, -1, 0), thr=70.0)


def altar_dressing_six(A):
    """A transept altar's dressing (in the batch room-cathedral-source-8902-4): the cloth over its 3.46 x 0.96 m mensa
    with a lace fall, six brass candlesticks and the gilt cross. Origin on the mensa's top at the middle of its front
    edge, facing game +Z."""
    S = skins(A)
    m = kit.Mesh("altar_dressing_six")
    cloth_geo(m, S, 1.73, 0.0, 0.96, 0.28)
    for x in (-1.51, -0.98, -0.45, 0.45, 0.98, 1.51):
        candlestick(m, S, x, 0.61, 0.0, k=0.61, wax=0.30)
    altar_cross(m, S, 0.0, 0.66, 0.0, k=1.6)
    return m


def votive_stand(A):
    """A wrought-iron stand for votive tapers beside a transept altar: four legs on scrolled feet, three sand trays
    rising toward the back, each with a row of thin tapers of different lengths, a back rail with a cresting of scrolls.
    0.86 x 0.54 m, 1.58 m to the cresting. Origin on the floor under its middle, its front facing game +Z."""
    S = skins(A)
    iron, wax = S["iron"], S["wax"]
    m = kit.Mesh("votive_stand")
    li = Along(cells(A)["iron"], margin=0.1)

    def rod(p, q, r):
        p, q = np.array(p, float), np.array(q, float)
        k = max(1, int(math.ceil(np.linalg.norm(q - p) / 0.2)))
        kit.sweep(m, [tuple(p + (q - p) * t / k) for t in range(k + 1)], r, 6, iron, up=(1, 0, 0) if abs(q[2] - p[2]) > 0.1 else (0, 0, 1), caps=(True, True), thr=50.0)

    W, D = 0.43, 0.27
    rng = np.random.default_rng(31)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (W - 0.03), sy * (D - 0.03)
            top = 1.02 if sy < 0 else 1.40
            rod((x, y, 0.0), (x, y, top), 0.011)
            with m.at(T(x, y, 0.0) @ RZ(math.atan2(sy, sx) + math.pi / 2)):
                scroll(m, iron, T(0, 0, 0.06), 0.035, turns=1.2, r0=0.008, r1=0.004)
    # the stretchers low down
    for sy in (-1, 1):
        rod((-W + 0.03, sy * (D - 0.03), 0.18), (W - 0.03, sy * (D - 0.03), 0.18), 0.008)
    for sx in (-1, 1):
        rod((sx * (W - 0.03), -D + 0.03, 0.18), (sx * (W - 0.03), D - 0.03, 0.18), 0.008)
    # three trays: sheet iron with a turned-up rim, sand in them, tapers standing in the sand
    for k in range(3):
        y0 = -D + 0.02 + k * 0.17
        z = 0.98 + k * 0.13
        member(m, (-W + 0.01, y0, z), (W - 0.01, y0 + 0.16, z + 0.006), 0, li, c=0.001, tile=0.25)
        for yy in (y0, y0 + 0.155):
            member(m, (-W + 0.01, yy, z), (W - 0.01, yy + 0.005, z + 0.035), 0, li, c=0.001, tile=0.25)
        for xx in (-W + 0.01, W - 0.015):
            bx(m, xx, y0, z, xx + 0.005, y0 + 0.16, z + 0.035, iron, c=0.001)
        bx(m, -W + 0.016, y0 + 0.006, z + 0.006, W - 0.016, y0 + 0.154, z + 0.026, S["dark"], c=0.0)
        for q in range(9):
            x = -W + 0.07 + q * (2 * W - 0.14) / 8 + rng.uniform(-0.01, 0.01)
            h = rng.uniform(0.06, 0.24)
            with m.at(T(x, y0 + 0.08 + rng.uniform(-0.03, 0.03), z + 0.02)):
                kit.lathe(m, [(0.0, 0.0), (0.007, 0.0), (0.007, h - 0.006), (0.005, h), (0.0, h + 0.002)], 6, wax, thr=50.0)
                kit.lathe(m, [(0.0, h), (0.0012, h), (0.0008, h + 0.012), (0.0, h + 0.014)], 4, S["dark"], thr=50.0)
    # the back rail and its cresting
    rod((-W + 0.03, D - 0.03, 1.40), (W - 0.03, D - 0.03, 1.40), 0.010)
    for q in range(5):
        x = -0.32 + q * 0.16
        for side in (-1, 1):
            scroll(m, iron, T(x + side * 0.03, D - 0.03, 1.46) @ Matrix.Scale(side, 4, (1, 0, 0)), 0.035, turns=1.3, r0=0.006, r1=0.003)
    kit.sweep(m, [(0.0, D - 0.03, 1.40), (0.0, D - 0.03, 1.58)], 0.008, 6, iron, up=(1, 0, 0), caps=(True, True))
    ball(m, iron, (0.0, D - 0.03, 1.58), 0.018, sides=8, rings=5)
    return m


def offering_box(A):
    """An alms box on a turned oak post (pieces 8916-88, 8916-89, 8916-90): an oak box bound with iron straps, a slot
    in its lid, a hasp and padlock. Origin on the floor under the post; the box at 0.55 to 0.95 m."""
    S = skins(A)
    oak, iron, long_ = S["oak"], S["iron"], S["long"]
    m = kit.Mesh("offering_box")
    kit.lathe(m, [(0.0, 0.0), (0.12, 0.0), (0.12, 0.04), (0.08, 0.07), (0.05, 0.10), (0.045, 0.20), (0.055, 0.30), (0.04, 0.40), (0.045, 0.50),
                  (0.08, 0.53), (0.08, 0.55), (0.0, 0.55)], 12, S["carved"], thr=50.0)
    bx(m, -0.15, -0.10, 0.55, 0.15, 0.10, 0.93, oak, c=0.004)
    bx(m, -0.16, -0.11, 0.93, 0.16, 0.11, 0.95, oak, c=0.004)
    for z in (0.58, 0.88):
        bx(m, -0.155, -0.105, z, 0.155, 0.105, z + 0.025, iron, c=0.002)
    for x in (-0.12, 0.12):
        bx(m, x - 0.0125, -0.105, 0.55, x + 0.0125, -0.10, 0.95, iron, c=0.002)
    bx(m, -0.06, -0.008, 0.948, 0.06, 0.008, 0.952, S["dark"], c=0.0)
    bx(m, -0.02, -0.112, 0.82, 0.02, -0.105, 0.94, iron, c=0.002)
    with m.at(T(0, -0.125, 0.78)):
        kit.lathe(m, [(0.0, -0.03), (0.025, -0.025), (0.03, 0.0), (0.025, 0.02), (0.0, 0.025)], 8, iron, thr=50.0, ellipse=(1.0, 0.5))
    kit.sweep(m, [(-0.015, -0.125, 0.80), (-0.015, -0.125, 0.83), (0.015, -0.125, 0.83), (0.015, -0.125, 0.80)], 0.004, 5, iron, up=(0, -1, 0), caps=(True, True))
    return m


def picture_frame_supper(A):
    """The Last Supper's frame on the crossing's west altar (2.40 x 1.60 m, in the batch 8902-4)."""
    S = skins(A)
    m = kit.Mesh("picture_frame_supper")
    frame_geo(m, S, 2.40, 1.60, k=0.75)
    return m


# ------------------------------------------------------------------ the sanctuary lamp


def sanctuary_lamp(A):
    """The sanctuary lamp before the high altar (piece 8916-87): a brass lamp of embossed bowl and pierced crown hanging
    on three chains from a canopy, its red glass with the oil and the wick, the one chain up to the vault (29.6 m).
    Origin under its lowest point (the finial at 5.15 m above the floor is drawn from 5.15)."""
    S = skins(A)
    brass, iron = S["brass"], S["iron"]
    m = kit.Mesh("sanctuary_lamp")
    z0 = 5.15
    with m.at(T(0, 0, z0)):
        # the finial under the bowl, the bowl with gadroons, its rim
        kit.lathe(m, [(0.0, 0.0), (0.015, 0.01), (0.03, 0.04), (0.02, 0.07), (0.04, 0.09), (0.10, 0.12), (0.17, 0.18), (0.20, 0.24), (0.205, 0.27),
                      (0.19, 0.28), (0.0, 0.28)], 20, brass, thr=50.0, radial=lambda a, r, z: r * (1 + 0.05 * abs(math.cos(6 * a))) if 0.11 < z < 0.24 else r)
        kit.lathe(m, [(0.205, 0.27), (0.215, 0.285), (0.20, 0.30), (0.19, 0.30)], 20, brass, thr=40.0)
        # the red glass and its flame cup
        kit.lathe(m, [(0.0, 0.25), (0.07, 0.26), (0.085, 0.30), (0.08, 0.38), (0.07, 0.39), (0.0, 0.39)], 12, S["velvet"], thr=50.0)
        kit.lathe(m, [(0.0, 0.39), (0.002, 0.39), (0.0015, 0.41), (0.0, 0.415)], 4, S["dark"], thr=50.0)
        # a pierced crown round the rim: small upright leaves
        for q in range(12):
            a = 2 * math.pi * q / 12
            leaf(m, brass, T(0.20 * math.cos(a), 0.20 * math.sin(a), 0.29) @ RZ(a + math.pi / 2) @ RX(math.radians(-10)), 0.08, 0.05, curl=0.6, nl=4, nw=4)
        # three chains to the canopy and the canopy
        top = 1.15
        for q in range(3):
            a = 2 * math.pi * q / 3
            p0 = np.array((0.19 * math.cos(a), 0.19 * math.sin(a), 0.30))
            p1 = np.array((0.06 * math.cos(a), 0.06 * math.sin(a), top))
            pts = [tuple(p0 + (p1 - p0) * t) for t in np.linspace(0, 1, 9)]
            kit.sweep(m, pts, 0.006, 5, brass, up=(0, 0, 1), caps=(True, True), thr=60.0, bumps=lambda s, b: 1 + 0.35 * math.cos(s * 160))
        kit.lathe(m, [(0.0, top - 0.02), (0.08, top), (0.10, top + 0.03), (0.06, top + 0.08), (0.03, top + 0.10), (0.04, top + 0.14), (0.0, top + 0.16)], 12, brass, thr=50.0)
    # the chain up to the vault
    zc = z0 + 1.31
    L = 29.6 - zc
    n = int(L / 0.3)
    kit.sweep(m, [(0.0, 0.0, zc + L * t / n) for t in range(n + 1)], 0.011, 5, iron, up=(1, 0, 0), caps=(True, True), thr=60.0,
              bumps=lambda s, b: 1 + 0.35 * math.cos(s * 110))
    return m


# ------------------------------------------------------------------ the organ loft's carved panels


def loft_panel(A):
    """A carved gilt panel on the organ loft's front (pieces 8914-22 to 8914-25), 1.80 x 0.50 m: a moulded frame, an
    acanthus scroll carved in the round, a rosette at its middle. Origin at its foot's middle, its face 0.025 m before
    the origin, facing game +Z."""
    S = skins(A)
    gilt, lg = S["gilt"], S["longg"]
    m = kit.Mesh("loft_panel")
    W, H = 0.90, 0.50
    member(m, (-W, -0.02, 0.0), (W, 0.025, H), 0, lg, c=0.004)
    run(m, [(0.0, 0.0), (0.0, 0.012), (0.012, 0.022), (0.026, 0.018), (0.034, 0.008), (0.04, 0.0)], [(-W, 0.0), (-W, H), (W, H), (W, 0.0)], lg,
        frame=FACE(-0.02), closed=True, tile=0.3, flip=True)
    vine(m, {"carved": gilt}, -W + 0.06, -0.10, 0.06, H - 0.06, -0.02, period=0.32)
    vine(m, {"carved": gilt}, 0.10, W - 0.06, 0.06, H - 0.06, -0.02, period=0.32)
    ch.rosette(m, gilt, (0.0, -0.03, H / 2), 0.10)
    return m


vine = ch.vine


# ------------------------------------------------------------------ the bishop's throne in the choir


def choir_throne(A):
    """The bishop's throne at the choir's head (piece 8915-86), in the stalls' neo-Gothic oak: a dais, a seat with a red
    velvet cushion between carved arms, a high back of tracery hung with a velvet dorsal, a coved canopy with a cusped
    arch, a crocketed gable, two pinnacles. 1.20 m wide, 1.00 m deep, 4.31 m high; origin on the choir floor at the middle
    of its front, the seat facing game +Z."""
    S = skins(A)
    oak, carved, long_, lc = S["oak"], S["carved"], S["long"], S["longc"]
    m = kit.Mesh("choir_throne")
    W, D = 0.60, 1.00
    # the dais
    member(m, (-W, 0.0, 0.0), (W, D, 0.30), 0, S["longd"], c=0.004)
    run(m, [(0.0, 0.0), (0.018, 0.0), (0.024, 0.01), (0.024, 0.26), (0.012, 0.29), (0.0, 0.30)], [(-W, D), (-W, 0.0), (W, 0.0), (W, D)], S["longd"],
        frame=at_z(0.0), caps=(True, True))
    zs = 0.30
    # the seat box, its front panel, the cushion
    member(m, (-W + 0.08, 0.22, zs), (W - 0.08, D - 0.08, zs + 0.42), 0, long_, c=0.004)
    field_panel(m, -W + 0.12, zs + 0.04, W - 0.12, zs + 0.36, 0.22, oak, raise_=0.010, bevel=0.04)
    with m.at(T(0, 0.55, zs + 0.42)):
        kit.lathe(m, [(0.0, 0.0), (0.40, 0.0), (0.44, 0.03), (0.44, 0.07), (0.40, 0.10), (0.0, 0.11)], 16, S["velvet"], thr=60.0, ellipse=(1.05, 0.80))
    # the arms: carved ends on colonnettes
    for sx in (-1, 1):
        x0, x1 = sorted((sx * (W - 0.08), sx * W))
        member(m, (x0, 0.18, zs), (x1, D - 0.08, zs + 0.70), 1, lc, c=0.004)
        kit.sweep(m, [(sx * (W - 0.04), 0.14, zs + 0.72), (sx * (W - 0.04), 0.5, zs + 0.74), (sx * (W - 0.04), D - 0.08, zs + 0.74)], 0.035, 8, S["oakh"], up=(0, 0, 1), caps=(True, True), thr=55.0)
        ball(m, carved, (sx * (W - 0.04), 0.12, zs + 0.72), 0.05, sides=10, rings=6)
    # the high back: a tracery panel each side of a velvet dorsal
    bx(m, -W, D - 0.08, zs, W, D, 3.0, long_, c=0.004)
    yb = D - 0.08
    with m.at(T(0, yb - 0.012, 0)):
        P = np.array([[(x, 0.004 * math.sin(x * 40), z) for x in np.linspace(-0.40, 0.40, 9)] for z in np.linspace(zs + 0.80, 2.55, 6)])
        ST = np.array([[(x + 0.4, z) for x, _, z in row] for row in P])
        kit.grid(m, P, ST, S["velvet"], outfn=lambda i, j, c: np.array((0, -1.0, 0)), thr=60.0)
    kit.sweep(m, [(x, yb - 0.02, 2.58) for x in np.linspace(-0.42, 0.42, 6)], 0.012, 8, S["brass"], up=(0, 0, 1), caps=(True, True))
    for x in (-0.42, 0.42):
        ball(m, S["brass"], (x, yb - 0.02, 2.58), 0.02, sides=8, rings=5)
    tracery(m, S, -W + 0.04, -0.44, zs + 0.80, 2.70, yb, k=1.0, sub=False)
    tracery(m, S, 0.44, W - 0.04, zs + 0.80, 2.70, yb, k=1.0, sub=False)
    # the canopy: a cove forward from the back to its front beam, the valance's arch, the gable and pinnacles
    nC = 6
    P = []
    for i in range(nC + 1):
        t = math.pi / 2 * i / nC
        P.append([(x, yb - (yb - 0.05) * math.sin(t), 2.75 + 0.30 * (1 - math.cos(t))) for x in np.linspace(-W, W, 5)])
    P = np.array(P)
    ST = np.array([[(P[i, j, 0] + W, i * 0.15) for j in range(5)] for i in range(nC + 1)])
    kit.grid(m, P, ST, oak, outfn=lambda i, j, c: np.array((0, -0.6, -1.0)), thr=40.0)
    kit.grid(m, P + np.array((0, 0, 0.02)), ST, oak, outfn=lambda i, j, c: np.array((0, 0.6, 1.0)), shade=0.5, thr=40.0)
    member(m, (-W - 0.05, 0.0, 2.95), (W + 0.05, 0.10, 3.12), 0, long_)
    arc = parch(-W + 0.06, W - 0.06, 2.95 - (2 * W - 0.12) * 0.866 - 0.02, 14, 1.0)
    valance(m, oak, -W, W, arc, arc[0][1], 2.96, 0.0, 0.02)
    run(m, [(0.010, 0.0), (0.010, 0.010), (0.004, 0.017), (-0.006, 0.017), (-0.012, 0.010), (-0.012, 0.0)], arc, lc, frame=FACE(0.0), tile=0.12, caps=(True, True))
    for sx in (-1, 1):
        member(m, (sx * W - 0.05, 0.0, zs + 0.70), (sx * W + 0.05, 0.10, 2.95), 2, lc, c=0.004)
        pinnacle(m, S, sx * W, 0.05, 3.12, 4.31, 0.10)
    boards(m, -W, 0.10, 3.12, W, D, 3.15, long_, along=0, width=0.2)
    run(m, [(0.0, 0.0), (0.012, 0.0), (0.02, 0.012), (0.03, 0.02), (0.03, 0.05), (0.0, 0.06)], [(-W - 0.05, D), (-W - 0.05, 0.10), (W + 0.05, 0.10), (W + 0.05, D)],
        long_, frame=at_z(3.12))
    for x in np.arange(-W + 0.04, W, 0.14):
        leaf(m, carved, T(x, D - 0.04, 3.17), 0.12, 0.07, curl=0.3, nl=4, nw=4)
    gable(m, S, -W + 0.06, W - 0.06, 3.12, 0.06, 0.95)
    return m


def choir_throne_hull(A):
    S = skins(A)
    d = S["dark"]
    m = kit.Mesh("choir_throne_hull")
    bx(m, -0.60, 0.0, 0.0, 0.60, 1.00, 0.30, d, c=0.0)
    bx(m, -0.60, 0.20, 0.30, 0.60, 1.00, 0.72, d, c=0.0)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.52, sx * 0.60))
        bx(m, x0, 0.12, 0.30, x1, 1.00, 1.05, d, c=0.0)
    bx(m, -0.60, 0.90, 0.30, 0.60, 1.00, 3.60, d, c=0.0)
    bx(m, -0.65, 0.0, 2.75, 0.65, 1.00, 3.60, d, c=0.0)
    return m


# ------------------------------------------------------------------ the font's cover


def font_cover(A):
    """The baptismal font's carved oak cover (piece 8914-73; the font's marble is the town shell's): an octagonal moulded
    rim, eight carved ribs with scrolls rising to a lantern, panels between, a gilt flaming finial. 0.92 m across, 1.20
    m with its finial. Origin at the middle of its rim's foot."""
    S = skins(A)
    oak, carved, gilt = S["oak"], S["carved"], S["gilt"]
    m = kit.Mesh("font_cover")
    R = 0.46
    kit.lathe(m, [(0.0, 0.0), (R * 0.97, 0.0), (R, 0.02), (R, 0.06), (R * 0.96, 0.08), (R * 0.94, 0.12), (R * 0.90, 0.13), (0.0, 0.14)], 8, oak, a0=math.pi / 8, thr=30.0)
    # the dome of eight panels
    dome = [(R * 0.88 * math.cos(a) ** 0.8, 0.13 + 0.55 * math.sin(a)) for a in np.linspace(0, math.pi / 2 * 0.86, 8)]
    kit.lathe(m, dome + [(0.10, 0.69), (0.0, 0.69)], 8, oak, a0=math.pi / 8, thr=30.0)
    for q in range(8):
        a = math.pi / 8 + q * math.pi / 4
        pts = [(r * 1.04 * math.cos(a), r * 1.04 * math.sin(a), z) for r, z in dome]
        kit.sweep(m, pts, 0.022, 6, carved, up=(0, 0, 1), caps=(True, True), thr=60.0)
        with m.at(T(R * 0.86 * math.cos(a), R * 0.86 * math.sin(a), 0.16) @ RZ(a + math.pi / 2)):
            scroll(m, carved, T(0, 0, 0.06), 0.06, turns=1.3, r0=0.016, r1=0.006)
        with m.at(T(0, 0, 0) @ RZ(a + math.pi / 8 + math.pi / 2)):
            leaf(m, carved, T(0, -R * 0.80, 0.16), 0.22, 0.10, curl=0.3, nl=6, nw=4)
    # the lantern and the finial
    with m.at(T(0, 0, 0.69)):
        kit.lathe(m, [(0.0, 0.0), (0.12, 0.0), (0.12, 0.03), (0.08, 0.05), (0.08, 0.16), (0.11, 0.18), (0.11, 0.21), (0.0, 0.22)], 8, carved, a0=math.pi / 8, thr=40.0)
        for q in range(8):
            a = math.pi / 8 + q * math.pi / 4
            kit.sweep(m, [(0.085 * math.cos(a), 0.085 * math.sin(a), 0.05), (0.085 * math.cos(a), 0.085 * math.sin(a), 0.16)], 0.012, 6, carved, up=(1, 0, 0), caps=(True, True))
        ch.urn(m, S, 0.0, 0.0, 0.22, 0.75, body="gilt")
    return m


# ------------------------------------------------------------------ the choir's brass lectern


def choir_lectern(A):
    """The brass lectern in the choir (piece 8921-116): three lion's feet, a turned column with knops, a sloping desk on
    scrolled brackets with a pierced cresting, the red-bound choir book open on it. Origin on the choir floor under the
    column, the reader standing on its game -Z side."""
    S = skins(A)
    brass = S["brass"]
    m = kit.Mesh("choir_lectern")
    for q in range(3):
        a = 2 * math.pi * q / 3 + math.pi / 2
        d = np.array((math.cos(a), math.sin(a)))
        kit.sweep(m, [(d[0] * 0.05, d[1] * 0.05, 0.16), (d[0] * 0.18, d[1] * 0.18, 0.08), (d[0] * 0.26, d[1] * 0.26, 0.05)], [0.03, 0.025, 0.022], 8, brass, up=(0, 0, 1), caps=(True, True))
        ball(m, brass, (d[0] * 0.28, d[1] * 0.28, 0.04), 0.045, sides=8, rings=5, squash=0.8)
        for k in range(3):
            b = a + (k - 1) * 0.5
            ball(m, brass, (d[0] * 0.28 + 0.04 * math.cos(b), d[1] * 0.28 + 0.04 * math.sin(b), 0.02), 0.018, sides=6, rings=4)
    kit.lathe(m, [(0.0, 0.10), (0.10, 0.12), (0.12, 0.16), (0.06, 0.20), (0.05, 0.28), (0.07, 0.32), (0.04, 0.38), (0.035, 0.60), (0.06, 0.64), (0.035, 0.68),
                  (0.032, 0.86), (0.055, 0.90), (0.03, 0.94), (0.03, 0.98)], 14, brass, thr=50.0)
    ball(m, brass, (0.0, 0.0, 1.03), 0.06, sides=12, rings=7)
    # the desk: a sloping brass plate on two scrolled brackets, a ledge for the book, a pierced cresting of quatrefoils
    with m.at(T(0, 0, 1.08)):
        for sx in (-1, 1):
            kit.sweep(m, [(sx * 0.02, 0.0, 0.0), (sx * 0.12, 0.02, 0.06), (sx * 0.20, 0.06, 0.16)], [0.018, 0.015, 0.012], 8, brass, up=(0, 1, 0), caps=(True, True))
            scroll(m, brass, T(sx * 0.13, 0.0, 0.05) @ Matrix.Scale(sx, 4, (1, 0, 0)), 0.04, turns=1.3, r0=0.008, r1=0.004)
    with m.at(T(0, 0.04, 1.26) @ RX(math.radians(-22))):
        lb = Along(cells(A)["brass"], margin=0.1)
        for y0 in (-0.20, -0.06, 0.08):
            member(m, (-0.30, y0, -0.01), (0.30, y0 + 0.14, 0.0), 0, lb, c=0.0, tile=0.2)
        member(m, (-0.30, 0.18, 0.0), (0.30, 0.20, 0.05), 0, lb, c=0.002, tile=0.2)
        for x in np.linspace(-0.24, 0.24, 5):
            with m.at(T(x, -0.20, 0.0) @ RX(math.radians(90))):
                quatrefoil(m, brass, 0.0, 0.0, 0.05, 0.04, tube=0.006, n=24)
    # the book: two boards bound in red velvet, its pages, lying open on the desk, sloping toward the reader (+y)
    with m.at(T(0, 0.04, 1.30) @ RX(math.radians(-22))):
        for sx in (-1, 1):
            x0, x1 = sorted((sx * 0.005, sx * 0.25))
            bx(m, x0, -0.17, 0.0, x1, 0.17, 0.012, S["velvet"], c=0.002)
            bx(m, x0 + (0.01 if sx < 0 else 0.0), -0.16, 0.012, x1 - (0.01 if sx > 0 else 0.0), 0.16, 0.035, S["linen"], c=0.004)
    return m


# ------------------------------------------------------------------ the sanctuary's screens


SCREENS = {"choir_screen_west": 7.26, "choir_screen_east": 6.55}


def choir_screen(A, name):
    """A low oak screen closing the sanctuary from the ambulatory beside the high altar (the stalls' oak and tracery): a
    moulded plinth, framed panels of blind tracery on both faces, a moulded capping with a leaf cresting; 0.30 m thick,
    1.50 m high. Drawn by the stalls' pieces 8915-83 and 8915-85. Origin on the floor at its middle, along x."""
    S = skins(A)
    oak, carved, long_ = S["oak"], S["carved"], S["long"]
    m = kit.Mesh(name)
    L = SCREENS[name]
    X0, X1 = -L / 2, L / 2
    H, Y = 1.50, 0.15
    member(m, (X0, -Y, 0.0), (X1, Y, 0.14), 0, S["longd"], c=0.005)
    for sy in (-1, 1):
        run(m, [(0.0, 0.0), (0.02, 0.0), (0.028, 0.012), (0.028, 0.03), (0.0, 0.04)], [(X0, sy * Y), (X1, sy * Y)] if sy < 0 else [(X1, sy * Y), (X0, sy * Y)],
            S["longd"], frame=at_z(0.14), caps=(True, True))
    n = max(1, int(round(L / 0.72)))
    bay = L / n
    xs = [X0 + k * bay for k in range(n + 1)]
    member(m, (X0, -Y + 0.03, 0.14), (X1, Y - 0.03, H - 0.10), 0, long_, c=0.0, caps=(True, True))
    for sy in (-1, 1):
        for k in range(n):
            with m.at(RZ(0.0 if sy < 0 else math.pi)):
                a, b = (xs[k], xs[k + 1]) if sy < 0 else (-xs[k + 1], -xs[k])
                field_panel(m, a + 0.05, 0.22, b - 0.05, H - 0.16, -Y + 0.03, oak, raise_=0.006, bevel=0.03)
                tracery(m, S, a + 0.09, b - 0.09, 0.26, H - 0.20, -Y + 0.024, k=1.0, sub=True, scale=0.9)
        for x in xs:
            member(m, (x - 0.025, sy * Y - (0.012 if sy > 0 else 0.0), 0.14), (x + 0.025, sy * Y + (0.0 if sy > 0 else 0.012), H - 0.10), 2, long_, c=0.003)
    # the capping and its cresting
    member(m, (X0 - 0.02, -Y - 0.03, H - 0.10), (X1 + 0.02, Y + 0.03, H - 0.04), 0, long_, c=0.004)
    run(m, [(0.0, 0.0), (0.012, 0.0), (0.018, 0.012), (0.012, 0.03), (0.0, 0.04)], [(X0 - 0.02, -Y - 0.03), (X0 - 0.02, Y + 0.03), (X1 + 0.02, Y + 0.03), (X1 + 0.02, -Y - 0.03)],
        long_, frame=at_z(H - 0.04), closed=True, tile=0.4)
    for x in np.arange(X0 + 0.09, X1 - 0.05, 0.18):
        leaf(m, carved, T(x, 0.0, H), 0.12, 0.07, curl=0.3, nl=4, nw=4)
    return m


def choir_screen_hull(A, name):
    S = skins(A)
    m = kit.Mesh(name + "_hull")
    L = SCREENS[name]
    bx(m, -L / 2 - 0.02, -0.18, 0.0, L / 2 + 0.02, 0.18, 1.62, S["dark"], c=0.0)
    return m


def choir_screen_west(A):
    return choir_screen(A, "choir_screen_west")


def choir_screen_west_hull(A):
    return choir_screen_hull(A, "choir_screen_west")


def choir_screen_east(A):
    return choir_screen(A, "choir_screen_east")


def choir_screen_east_hull(A):
    return choir_screen_hull(A, "choir_screen_east")


# ------------------------------------------------------------------ the nave's brass chandeliers


CH_Z = 9.30  # the lower arms' drip pans (the recovered chandeliers hung their brass from 9.30 m)


def chandelier(A):
    """A Flemish brass chandelier of the nave and crossing (in the pieces 8904-9, three, and 8904-19): a turned baluster
    stem, eight S-scrolled lower arms with drip pans and sockets reaching 1.0 m, eight smaller upper arms, a crown of
    leaves, a ring and the chain to the vault (29.5 m). Its great ball under the stem is its own piece (chandelier_ball).
    Origin under its axis on the nave's floor line."""
    S = skins(A)
    brass, wax, iron = S["brass"], S["wax"], S["iron"]
    m = kit.Mesh("chandelier")
    z0 = CH_Z - 0.04
    with m.at(T(0, 0, z0)):
        kit.lathe(m, [(0.0, 0.0), (0.03, 0.0), (0.05, 0.03), (0.04, 0.08), (0.08, 0.14), (0.10, 0.20), (0.08, 0.26), (0.04, 0.30), (0.035, 0.36), (0.07, 0.42),
                      (0.06, 0.48), (0.03, 0.52), (0.028, 0.70), (0.05, 0.74), (0.045, 0.80), (0.025, 0.84), (0.022, 1.02), (0.04, 1.06), (0.03, 1.10),
                      (0.015, 1.14), (0.015, 1.30), (0.0, 1.32)], 14, brass, thr=50.0)
    for tier, (n, R, zt, rise, k) in enumerate(((8, 1.0, CH_Z + 0.14, 0.42, 1.0), (8, 0.62, CH_Z + 0.62, 0.30, 0.75))):
        for q in range(n):
            a = 2 * math.pi * q / n + tier * math.pi / n
            d = np.array((math.cos(a), math.sin(a)))
            # an S-scroll arm: out and down from the stem, curling up to the socket
            pts = []
            for t in np.linspace(0, 1, 9):
                r = 0.06 + (R - 0.06) * t
                z = zt + 0.10 * k * math.sin(math.pi * t) * -1 + (rise * 0.0) + 0.05 * k * t
                pts.append((d[0] * r, d[1] * r, z))
            kit.sweep(m, pts, [0.016 * k] * len(pts), 6, brass, up=(0, 0, 1), caps=(True, True), thr=60.0)
            scroll(m, brass, T(d[0] * (R * 0.55), d[1] * (R * 0.55), zt - 0.10 * k) @ RZ(a + math.pi / 2), 0.05 * k, turns=1.2, r0=0.010 * k, r1=0.005)
            px, py, pz = pts[-1]
            with m.at(T(px, py, pz)):
                kit.lathe(m, [(0.0, 0.0), (0.02, 0.0), (0.03, 0.02), (0.09 * k, 0.03), (0.095 * k, 0.04), (0.03, 0.045), (0.025, 0.09), (0.03, 0.10), (0.0, 0.10)], 12, brass, thr=50.0)
                kit.lathe(m, [(0.0, 0.10), (0.012, 0.10), (0.012, 0.29), (0.009, 0.30), (0.0, 0.302)], 8, wax, thr=50.0)
                kit.lathe(m, [(0.0, 0.30), (0.0015, 0.30), (0.0012, 0.315), (0.0, 0.318)], 4, S["dark"], thr=50.0)
    # the crown of leaves round the stem's top, the ring, the chain
    for q in range(8):
        a = 2 * math.pi * q / 8
        leaf(m, brass, T(0.04 * math.cos(a), 0.04 * math.sin(a), z0 + 1.02) @ RZ(a + math.pi / 2) @ RX(math.radians(-25)), 0.16, 0.07, curl=0.9, nl=5, nw=4)
    kit.sweep(m, [(0.06 * math.cos(a), 0.0, z0 + 1.38 + 0.06 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 13)[:-1]], 0.010, 6, brass, closed=True, up=(0, 1, 0), thr=60.0)
    zc = z0 + 1.44
    L = 29.5 - zc
    n = int(L / 0.3)
    kit.sweep(m, [(0.0, 0.0, zc + L * t / n) for t in range(n + 1)], 0.011, 5, iron, up=(1, 0, 0), caps=(True, True), thr=60.0,
              bumps=lambda s, b: 1 + 0.35 * math.cos(s * 110))
    return m


def chandelier_ball(A):
    """The great brass ball that hangs under each chandelier's stem (pieces 8921-117 to 8921-120): a ball with a moulded
    band, a small drop finial under it. Origin at the ball's middle."""
    S = skins(A)
    brass = S["brass"]
    m = kit.Mesh("chandelier_ball")
    ball(m, brass, (0.0, 0.0, 0.0), 0.19, sides=20, rings=12)
    kit.sweep(m, [(0.192 * math.cos(a), 0.192 * math.sin(a), 0.0) for a in np.linspace(0, 2 * math.pi, 25)[:-1]], 0.012, 6, brass, closed=True, up=(0, 0, 1), thr=60.0)
    kit.lathe(m, [(0.0, -0.32), (0.012, -0.30), (0.03, -0.26), (0.02, -0.22), (0.04, -0.20), (0.03, -0.18), (0.0, -0.17)], 10, brass, thr=60.0)
    kit.lathe(m, [(0.0, 0.17), (0.035, 0.18), (0.03, 0.22), (0.0, 0.23)], 10, brass, thr=60.0)
    return m


# ------------------------------------------------------------------ the doors


DOORS = {"church_door_west": (2.50, 3.18), "church_door_transept": (3.50, 4.48)}


def church_door(A, name):
    """A pair of oak doors in the cathedral's walls (pieces 8915-75, 8915-77 in the west wall, 8915-76, 8915-78 at the
    transepts' ends): a moulded oak frame, two leaves of fielded panels between stiles and rails, iron strap hinges with
    fleur ends, ring handles and a lock plate, nail heads along the rails. Origin on the floor at the doorway's middle,
    the inner face toward game +Z, its back on the wall."""
    S = skins(A)
    oak, long_, iron = S["oak"], S["long"], S["iron"]
    m = kit.Mesh(name)
    W, H = DOORS[name]
    hw = W / 2
    y0 = -0.04  # the leaves' face
    # the frame: jambs and head with a moulded architrave
    run(m, [(0.0, 0.0), (0.0, 0.03), (0.02, 0.05), (0.06, 0.06), (0.09, 0.04), (0.10, 0.0)], [(-hw, 0.0), (-hw, H), (hw, H), (hw, 0.0)], long_,
        frame=FACE(y0 + 0.01), tile=0.4, caps=(True, True), flip=True)
    nr = 4 if H > 4 else 3
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.004, sx * (hw - 0.002)))
        # the leaf: stiles, rails, fielded panels
        member(m, (x0, y0, 0.0), (x0 + 0.10, y0 + 0.05, H - 0.02), 2, long_, c=0.003)
        member(m, (x1 - 0.10, y0, 0.0), (x1, y0 + 0.05, H - 0.02), 2, long_, c=0.003)
        zs = np.linspace(0.0, H - 0.02, nr + 1)
        for k, z in enumerate(zs):
            za, zb = (z, z + 0.14) if k == 0 else ((z - 0.10, z) if k == nr else (z - 0.06, z + 0.06))
            member(m, (x0 + 0.10, y0, za), (x1 - 0.10, y0 + 0.05, zb), 0, long_, c=0.003)
        for za, zb in zip(zs[:-1], zs[1:]):
            lo = za + (0.14 if za == 0 else 0.06)
            hi = zb - (0.10 if zb == zs[-1] else 0.06)
            pieces = max(1, int(math.ceil((hi - lo) / 1.2)))
            cols = 2 if x1 - x0 - 0.20 > 1.2 else 1
            cx = [x0 + 0.10 + (x1 - x0 - 0.20) * q / cols for q in range(cols + 1)]
            for q in range(pieces):
                for ca, cb in zip(cx[:-1], cx[1:]):
                    field_panel(m, ca + (0.03 if ca > x0 + 0.11 else 0.0), lo + (hi - lo) * q / pieces, cb - (0.03 if cb < x1 - 0.11 else 0.0),
                                lo + (hi - lo) * (q + 1) / pieces, y0 + 0.02, oak, raise_=0.014, bevel=0.06)
            for cm in cx[1:-1]:
                member(m, (cm - 0.03, y0, lo), (cm + 0.03, y0 + 0.05, hi), 2, long_, c=0.003)
        # strap hinges across the leaf from its outer edge, a fleur at their end; nail heads along the rails
        xo = sx * (hw - 0.02)
        for z in (zs[1] - 0.25, zs[-2] + 0.25):
            xa, xb = sorted((xo, sx * 0.20))
            member(m, (xa, y0 - 0.012, z - 0.03), (xb, y0, z + 0.03), 0, Along(cells(A)["iron"], margin=0.1), c=0.002, tile=0.25)
            for d in (-1, 0, 1):
                leaf(m, iron, T(sx * 0.18, y0 - 0.012, z) @ Matrix.Rotation(-(math.pi / 2 + sx * math.pi / 2) + d * 0.6 + math.pi / 2, 4, "Y"), 0.08, 0.04, curl=0.1, nl=4, nw=4)
            with m.at(T(xo, y0 + 0.02, z - 0.10)):
                kit.lathe(m, [(0.0, 0.0), (0.025, 0.0), (0.025, 0.20), (0.0, 0.20)], 8, iron, thr=40.0)
        for z in zs[1:-1]:
            for x in np.linspace(sx * 0.12, sx * (hw - 0.12), 6):
                ball(m, iron, (x, y0 - 0.006, z), 0.009, sides=6, rings=3, squash=0.6)
        # the ring handle and its plate
        xr = sx * 0.16
        bx(m, xr - 0.06, y0 - 0.006, 1.02, xr + 0.06, y0, 1.18, iron, c=0.002)
        kit.sweep(m, [(xr + 0.07 * math.sin(a), y0 - 0.03, 1.10 - 0.07 * math.cos(a)) for a in np.linspace(-1.2, 1.2, 9)], 0.008, 6, iron, up=(0, -1, 0), caps=(True, True))
    bx(m, -0.004, y0 - 0.02, 0.0, 0.004, y0 + 0.05, H - 0.02, S["dark"], c=0.0)
    return m


def church_door_west(A):
    return church_door(A, "church_door_west")


def church_door_transept(A):
    return church_door(A, "church_door_transept")


# ------------------------------------------------------------------ the gate in the communion rail


def rail_post(A):
    """The brass gate posts (8921-113/114), with a cast collar meeting the stone cap and a ball finial."""
    S = skins(A)
    m = kit.Mesh("rail_post")
    kit.lathe(m, ch.dense([(0.0, 0.0), (0.045, 0.0), (0.045, 0.03), (0.03, 0.05), (0.025, 0.10), (0.03, 0.14), (0.02, 0.18), (0.018, 0.70), (0.028, 0.74),
                  (0.02, 0.78), (0.0, 0.78)],step=.20), 32, S["brass"], thr=50.0)
    member(m,(-.04,-.04,.78),(.04,.04,.92),2,S["brass"],c=.002,tile=.15)
    ball(m, S["brass"], (0.0, 0.0, 0.95), 0.03, sides=24, rings=12)
    return m


def rail_gate(A):
    """The gate in the communion rail (piece 8921-115): two brass leaves of bars and scrolls between the posts, a
    moulded top rail, a small cross over the middle. 0.90 m wide. Origin on the floor at its middle."""
    S = skins(A)
    brass = S["brass"]
    m = kit.Mesh("rail_gate")

    def rod(p, q, r, sides=12):
        p, q = np.array(p, float), np.array(q, float)
        k = max(1, int(math.ceil(np.linalg.norm(q - p) / 0.15)))
        kit.sweep(m, [tuple(p + (q - p) * t / k) for t in range(k + 1)], r, sides, brass, up=(1, 0, 0) if abs(q[2] - p[2]) > 0.05 else (0, 0, 1), caps=(True, True))

    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.005, sx * 0.43))
        for z in (0.12, 0.62):
            rod((x0, 0.0, z), (x1, 0.0, z), 0.010)
            rod((x0, 0.0, 0.66), (x1, 0.0, 0.66), 0.016, 16)
        for x in np.linspace(x0, x1, 6):
            rod((x, 0.0, 0.12), (x, 0.0, 0.66), 0.008)
        for x in np.linspace(x0 + 0.04, x1 - 0.04, 4):
            for side in (-1, 1):
                scroll(m, brass, T(x + side * 0.03, 0.0, 0.42) @ Matrix.Scale(side, 4, (1, 0, 0)), 0.035, turns=1.3, r0=0.006, r1=0.003)
        # Hinged leaves meet the posts through real barrels; a small latch bridges their centre seam.
        for z in (.15,.60):
            rod((sx*.458,0,z-.025),(sx*.458,0,z+.025),.014,16)
            member(m,(min(sx*.43,sx*.458),-.01,z-.008),(max(sx*.43,sx*.458),.01,z+.008),0,brass,c=.001,tile=.1)
            member(m,(min(sx*.458,sx*.5),-.012,z-.009),(max(sx*.458,sx*.5),.012,z+.009),0,brass,c=.001,tile=.1)
    member(m,(-.045,-.025,.595),(.045,-.012,.625),0,brass,c=.0015,tile=.1)
    rod((0.0, 0.0, 0.66), (0.0, 0.0, 0.84), 0.010)
    kit.sweep(m, [(-0.06, 0.0, 0.78), (0.06, 0.0, 0.78)], 0.010, 6, brass, up=(0, 0, 1), caps=(True, True))
    return m
