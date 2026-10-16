"""The Werf's two bridges, built for build_ferry.py (it passes itself in as `bf`, for its materials and small parts).

Our own work. Blender frame, metres: x across, y toward the far end, z up.

stage_bridge  the tidal bridge between the quay and the landing stage: two riveted plate girders with an oak deck,
              cross cleats for the slope, a rail, a hinge at the quay end and two cast-iron wheels at the toe that run on
              the stage's rails. Origin at the hinge pin. The deck's top is DECK (0.12 m) above the pin, so the game puts the
              pin 0.12 m under the quay's top and the deck meets the pavement. It is rigid: the game only turns it about
              the pin, by the tide (docs/boats.md).
bridge_lip    the toe plate that lies on the stage deck from the toe: hinged on the bridge, laid by the game at whatever
              slope puts its tip on the boards. Origin at its hinge, top face at z = 0.
quay_hinge    the iron bed on the quay that holds the pin: a plate flush with the paving, bearing blocks, the pin.
              Origin at the pin.
gangway       the ferry's brow, 2 m of oak walkway with cleats, a rope rail, iron shoes and hinge eyes. Origin at the pin on
              the ferry's sill; it points along +y and the game lays it to the stage head, or hauls it up on her side.
"""

import math

import numpy as np
from mathutils import Matrix, Vector

import build_boats as bb
import pier_kit as pk

V = bb.V

BR_L = 7.7  # pin to the axle of the toe wheels
BR_W = 1.25  # a girder's centre: the stage's wheel rails stand at x = +-1.25
DECK = 0.12  # deck top over the pin
PLANK = 0.05  # deck board thickness
WHEEL_R = 0.12  # toe wheel radius
WHEEL_Z = -0.17  # its axle under the pin's level
LIP_L = 0.9
LIP_AT = BR_L + 0.28  # the lip's hinge, along the bridge
TRANSOMS = [0.55, 1.35, 2.15, 3.25, 4.05, 4.85, 5.95, 6.75, 7.55]

# the girder's lower edge: (y, z). The web is deepest at midspan and shallow at the ends.
BELLY = [(-0.2, -0.20), (0.9, -0.40), (3.9, -0.46), (6.9, -0.38), (BR_L + 0.15, -0.20)]


def belly(y):
    for (y0, z0), (y1, z1) in zip(BELLY, BELLY[1:]):
        if y0 <= y <= y1:
            return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return BELLY[-1][1]


def rot_y(a):
    return Matrix.Rotation(a, 4, "Y")


def rod(m, a, b, r, mat, sides=6, caps=True):
    m.tube([Vector(a), Vector(b)], [r, r], sides, mat, smooth=True, cap0=caps, cap1=caps)


def knuckle(m, x0, x1, y, z, r, mat=None, sides=12):
    """A hinge barrel along x from x0 to x1, centred at (y, z)."""
    mat = bb.IRON if mat is None else mat
    with m.at(Matrix.Translation((x0, y, z)) @ rot_y(math.pi / 2)):
        m.lathe([(r, 0.0), (r, x1 - x0)], sides, mat, smooth=True, cap0=True, cap1=True)


def wheel(m, x, y, z, r=WHEEL_R, w=0.09):
    """A cast-iron truck wheel on an axle along x: a flanged tyre, a web, a hub."""
    with m.at(Matrix.Translation((x, y, z)) @ rot_y(math.pi / 2)):
        m.lathe([(0.03, -w / 2), (r + 0.025, -w / 2), (r + 0.025, -w / 2 + 0.012), (r, -w / 2 + 0.018), (r, w / 2),
                 (r - 0.02, w / 2), (r - 0.02, 0.012), (0.05, 0.012), (0.05, w / 2 + 0.03), (0.03, w / 2 + 0.03)], 16, bb.IRON,
                smooth=True)
        m.lathe([(0.05, -w / 2 - 0.03), (0.05, w / 2 + 0.03)], 12, bb.IRON, smooth=True, cap0=True, cap1=True)


def girder(m, sx, rivets=True):
    """A plate girder at x = sx * BR_W: web, flanges, vertical stiffeners and rows of rivet heads."""
    x = sx * BR_W
    y0, y1 = -0.2, BR_L + 0.15
    ztop = DECK - PLANK - 0.03  # underside of the top flange: the planks sit on it
    web = [(y0, ztop)] + [(y, z) for y, z in BELLY]
    m.prism([V(x - 0.011, y, z) for y, z in web[::-1]], (0.022, 0, 0), bb.IRONHULL, tile=2.0)
    m.beam(V(x, y0, DECK - PLANK - 0.015), V(x, y1, DECK - PLANK - 0.015), 0.13, 0.03, bb.IRON, side=(1, 0, 0))
    for (ya, za), (yb, zb) in zip(BELLY, BELLY[1:]):
        m.beam(V(x, ya, za - 0.015), V(x, yb, zb - 0.015), 0.12, 0.03, bb.IRON, side=(1, 0, 0), caps=False)
    m.beam(V(x, y0 - 0.01, BELLY[0][1] - 0.015), V(x, y0 + 0.01, BELLY[0][1] - 0.015), 0.12, 0.03, bb.IRON, side=(1, 0, 0))
    for sgn in (1, -1):  # a flange angle's upstand on each face, top and bottom
        xo = x + sgn * 0.065
        m.beam(V(xo, y0, DECK - PLANK - 0.055), V(xo, y1, DECK - PLANK - 0.055), 0.02, 0.05, bb.IRON, side=(1, 0, 0))
    if not rivets:
        return
    xo = x + sx * 0.0112
    for y in np.arange(y0 + 0.1, y1 - 0.05, 0.14):
        y = float(y)
        m.bolt(V(xo, y, DECK - PLANK - 0.07), (sx, 0, 0), 0.0105, 0.0065)
        m.bolt(V(xo, y, belly(y) + 0.045), (sx, 0, 0), 0.0105, 0.0065)
    for y in np.arange(0.5, BR_L, 1.1):  # stiffeners (angles) with three rivets each
        y = float(y)
        zb = belly(y)
        m.box(V(x + sx * 0.04, y, (zb + ztop) / 2), (0.05, 0.07, ztop - zb - 0.07), bb.IRON)
        for k in range(3):
            m.bolt(V(x + sx * 0.0655, y, zb + 0.08 + k * (ztop - zb - 0.16) / 2), (sx, 0, 0), 0.0115, 0.007)


def bridge(bf):
    m = pk.BMesh(ao=0.0)
    for sx in (1, -1):
        girder(m, sx)
    # --- transoms (oak) between the girders, X braces of flat iron under them
    for k, y in enumerate(TRANSOMS):
        m.box(V(0, y, DECK - PLANK - 0.085), (2 * BR_W - 0.12, 0.12, 0.15), bb.DARK, shade=0.92)
        for sx in (1, -1):
            m.box(V(sx * (BR_W - 0.075), y, DECK - PLANK - 0.085), (0.03, 0.11, 0.17), bb.IRON)  # clip angle on the web
            m.bolt(V(sx * (BR_W - 0.0595), y, DECK - PLANK - 0.085), (-sx, 0, 0), 0.0105, 0.006)
    for y0, y1 in ((0.55, 1.35), (2.15, 3.25), (4.05, 4.85), (5.95, 6.75)):
        for s in (1, -1):
            m.beam(V(-s * 1.1, y0, DECK - PLANK - 0.2), V(s * 1.1, y1, DECK - PLANK - 0.2), 0.05, 0.012, bb.IRON, side=(0, 0, 1))
    # --- deck: boards along the slope, each its own band of the picture, butted over a transom
    rng = np.random.default_rng(1873)
    ncol = 14
    wcol = 2.8 / ncol
    for c in range(ncol):
        xa, xb = -1.4 + c * wcol + 0.008, -1.4 + (c + 1) * wcol - 0.008
        cut = 4.05 if c % 2 == 0 else 5.95
        for a0, a1 in ((0.03, cut - 0.015), (cut + 0.015, BR_L + 0.12)):
            band = int(rng.integers(0, pk.DECK_BANDS))
            m.plank(a0, a1, xa, xb, DECK, PLANK, bf.IDX["stage_deck"], shade=float(rng.uniform(0.9, 1.06)),
                    uvf=pk.deck_uvf(xa, xb, band, bool(rng.integers(0, 2))), along="y")
    # --- cleats for the slope, and the kerbs along both edges
    for y in np.arange(0.42, BR_L - 0.1, 0.36):
        y = float(y)
        m.box(V(0, y, DECK + 0.0125), (2.76, 0.055, 0.025), bb.WOOD, shade=float(rng.uniform(0.85, 1.0)))
    for sx in (1, -1):
        m.box(V(sx * 1.435, (0.03 + BR_L + 0.12) / 2, DECK + 0.025), (0.07, BR_L + 0.09, 0.1), bb.DARK, shade=0.9)
        for y in np.arange(0.2, BR_L + 0.05, 0.6):
            m.bolt(V(sx * 1.472, float(y), DECK + 0.03), (sx, 0, 0), 0.011, 0.006)
    # --- rail: iron posts on brackets off the girders, an oak top rail, two rods
    posts = [0.25 + k * 1.05 for k in range(8)]
    posts[-1] = BR_L - 0.15
    for sx in (1, -1):
        xp = sx * 1.52
        for y in posts:
            rod(m, V(xp, y, DECK - 0.07), V(xp, y, DECK + 1.0), 0.03, bb.IRON, 8)
            m.beam(V(xp, y, DECK - 0.05), V(sx * BR_W + sx * 0.07, y, DECK - 0.15), 0.05, 0.012, bb.IRON, side=(0, 1, 0))
            m.box(V(xp, y, DECK - 0.075), (0.09, 0.09, 0.012), bb.IRON)
            m.bolt(V(xp, y, DECK - 0.0685), (0, 0, 1), 0.012, 0.007)
        m.beam(V(xp, posts[0], DECK + 1.0), V(xp, posts[-1], DECK + 1.0), 0.07, 0.05, bb.WOOD, side=(1, 0, 0))
        for z in (0.62, 0.3):
            rod(m, V(xp, posts[0], DECK + z), V(xp, posts[-1], DECK + z), 0.014, bb.IRON, 6)
    # --- the toe: an end beam, the wheels on a through axle, and the lip's hinge barrel
    yt = BR_L
    m.box(V(0, BR_L + 0.17, DECK - PLANK - 0.075), (2 * BR_W + 0.1, 0.11, 0.15), bb.DARK, shade=0.9)
    m.beam(V(-BR_W - 0.1, yt, WHEEL_Z), V(BR_W + 0.1, yt, WHEEL_Z), 0.045, 0.045, bb.IRON, side=(0, 0, 1))
    for sx in (1, -1):
        m.box(V(sx * (BR_W - 0.07), yt, WHEEL_Z + 0.08), (0.025, 0.2, 0.2), bb.IRON)  # the axle boxes: a plate each side
        m.box(V(sx * (BR_W + 0.075), yt, WHEEL_Z + 0.08), (0.025, 0.2, 0.2), bb.IRON)
        wheel(m, sx * BR_W, yt, WHEEL_Z)
        for dz in (0.0, 0.14):
            m.bolt(V(sx * (BR_W + 0.0885), yt - 0.06, WHEEL_Z + 0.02 + dz), (1, 0, 0), 0.01, 0.006)
            m.bolt(V(sx * (BR_W + 0.0885), yt + 0.06, WHEEL_Z + 0.02 + dz), (1, 0, 0), 0.01, 0.006)
    knuckle(m, -1.4, 1.4, LIP_AT, DECK - 0.025, 0.028)
    for sx in (1, -1):
        m.beam(V(sx * 1.0, BR_L + 0.12, DECK - 0.025), V(sx * 1.0, LIP_AT, DECK - 0.025), 0.1, 0.012, bb.IRON, side=(0, 0, 1))
    # --- the heel: an end beam, the hinge barrels about the pin, the pin
    m.box(V(0, -0.2, DECK - PLANK - 0.075), (2 * BR_W + 0.1, 0.11, 0.15), bb.DARK, shade=0.9)
    for sx in (1, -1):
        m.box(V(sx * 0.72, -0.1, -0.06), (0.26, 0.2, 0.2), bb.IRON)  # the bridge's own knuckle blocks, between the quay's
        knuckle(m, min(sx * 0.59, sx * 0.85), max(sx * 0.59, sx * 0.85), 0.0, 0.0, 0.06)
    rod(m, V(-1.4, 0, 0), V(1.4, 0, 0), 0.026, bb.IRON, 8)
    m.extras = {"length": BR_L, "deck": DECK, "half_width": 1.15, "wheel_r": WHEEL_R, "wheel_z": WHEEL_Z, "lip_at": LIP_AT + 0.03,
                "lip_length": LIP_L, "rail": 1.0}
    return m


def lip():
    """The toe plate: chequer iron with edge angles and rib stiffeners under it; its top face is z = 0 at the hinge."""
    m = pk.BMesh(ao=0.0)
    w = 2.76
    m.box(V(0, LIP_L / 2 + 0.02, -0.0175), (w, LIP_L, 0.035), bb.CHEQUER, tile=1.0)
    for sx in (1, -1):
        m.beam(V(sx * (w / 2 - 0.02), 0.04, -0.06), V(sx * (w / 2 - 0.02), LIP_L, -0.06), 0.035, 0.05, bb.IRON, side=(1, 0, 0))
    for x in (-0.9, -0.3, 0.3, 0.9):
        m.beam(V(x, 0.1, -0.06), V(x, LIP_L - 0.04, -0.045), 0.02, 0.05, bb.IRON, side=(1, 0, 0))
    knuckle(m, -1.4, 1.4, -0.03, -0.025, 0.028)
    for x in np.arange(-1.15, 1.16, 0.46):
        m.bolt(V(float(x), 0.1, 0.0), (0, 0, 1), 0.012, 0.007)
        m.bolt(V(float(x), LIP_L - 0.06, 0.0), (0, 0, 1), 0.012, 0.007)
    m.extras = {"length": LIP_L}
    return m


def quay_hinge(bf):
    """The bed the pin is set in, flush with the paving (its top is 0.12 over the pin)."""
    m = pk.BMesh(ao=0.0)
    top = DECK + 0.012
    m.box(V(0, -0.62, top - 0.025), (3.3, 1.05, 0.05), bb.CHEQUER)
    for sx in (1, -1):
        for yy in (-1.0, -0.6, -0.2):
            for xx in (1.45, 0.9):
                m.bolt(V(sx * xx, yy, top), (0, 0, 1), 0.013, 0.008)
        m.box(V(sx * 1.12, -0.1, -0.02), (0.26, 0.22, 0.26), bb.IRON)  # bearing blocks the pin runs through
        m.box(V(sx * 1.12, -0.17, 0.04), (0.2, 0.1, 0.12), bb.IRON)
        m.beam(V(sx * 1.12, -0.5, top - 0.05), V(sx * 1.12, -0.12, -0.03), 0.16, 0.025, bb.IRON, side=(1, 0, 0))
        knuckle(m, min(sx * 0.95, sx * 1.3), max(sx * 0.95, sx * 1.3), 0.0, 0.0, 0.062)
        m.beam(V(sx * 0.3, -0.5, top - 0.05), V(sx * 0.3, -0.12, -0.03), 0.16, 0.025, bb.IRON, side=(1, 0, 0))
        m.box(V(sx * 0.32, -0.1, -0.02), (0.3, 0.2, 0.26), bb.IRON)
        knuckle(m, min(sx * 0.2, sx * 0.45), max(sx * 0.2, sx * 0.45), 0.0, 0.0, 0.062)
    # the pavement's edge: two iron bollard heads for the lifting chain are left to the quay's own furniture
    m.box(V(0, -0.075, top - 0.012), (2.6, 0.12, 0.024), bb.IRON, shade=0.9)  # the cover strip over the gap at the heel
    m.extras = {"top": top}
    return m


def gangway(bf):
    """The ferry's brow: pin at the ferry end (y = 0), walking surface 0.06 over it, 2 m long and 1 m wide."""
    m = pk.BMesh(ao=0.0)
    Lg, hw = 2.0, 0.5
    for sx in (1, -1):  # stringers
        m.beam(V(sx * 0.5, 0.0, -0.03), V(sx * 0.5, Lg, -0.03), 0.075, 0.2, bb.DARK, side=(1, 0, 0), shade=0.92)
    for y in (0.35, 1.0, 1.65):
        m.box(V(0, y, -0.065), (0.95, 0.09, 0.1), bb.DARK, shade=0.88)
    rng = np.random.default_rng(1874)
    for c in range(4):
        xa, xb = -0.46 + c * 0.23 + 0.008, -0.46 + (c + 1) * 0.23 - 0.008
        band = int(rng.integers(0, pk.DECK_BANDS))
        m.plank(0.02, Lg - 0.02, xa, xb, 0.06, 0.04, bf.IDX["stage_deck"], shade=float(rng.uniform(0.9, 1.05)),
                uvf=pk.deck_uvf(xa, xb, band, bool(rng.integers(0, 2))), along="y")
    for y in np.arange(0.12, Lg - 0.1, 0.25):
        m.box(V(0, float(y), 0.0725), (0.92, 0.045, 0.025), bb.WOOD, shade=float(rng.uniform(0.85, 1.0)))
    # iron shoes at both ends: a strap across with bolts, the hinge eyes at the ferry's end, a lifting ring at the far end
    for y in (0.06, Lg - 0.05):
        m.box(V(0, y, 0.062), (1.0, 0.09, 0.012), bb.IRON)
        for x in (-0.4, -0.2, 0.0, 0.2, 0.4):
            m.bolt(V(x, y, 0.068), (0, 0, 1), 0.011, 0.007)
    for sx in (1, -1):
        knuckle(m, sx * 0.34 if sx > 0 else -0.46, sx * 0.46 if sx > 0 else -0.34, -0.02, 0.0, 0.04)
        m.beam(V(sx * 0.4, 0.02, 0.0), V(sx * 0.4, 0.3, 0.05), 0.1, 0.012, bb.IRON, side=(1, 0, 0))
    m.tube([V(-0.12, Lg + 0.02, 0.07), V(-0.12, Lg + 0.1, 0.1), V(0.0, Lg + 0.13, 0.1), V(0.12, Lg + 0.1, 0.1), V(0.12, Lg + 0.02, 0.07)],
           [0.012] * 5, 5, bb.IRON, smooth=True)
    # stanchions and rope rails
    for sx in (1, -1):
        xs = sx * 0.545
        ys = (0.12, 1.0, Lg - 0.12)
        for y in ys:
            m.box(V(xs, y, 0.52), (0.06, 0.06, 1.0), bb.DARK, shade=1.0)
            m.box(V(xs, y, 1.025), (0.075, 0.075, 0.03), bb.DARK, shade=1.15)
            m.bolt(V(xs - sx * 0.032, y, 0.12), (-sx, 0, 0), 0.012, 0.007)
            m.beam(V(xs - sx * 0.03, y, 0.1), V(sx * 0.5, y, 0.06), 0.03, 0.01, bb.IRON, side=(0, 1, 0))
        for z in (0.98, 0.58, 0.24):
            sag = 0.03
            path = [V(xs, ys[0] + (ys[-1] - ys[0]) * k / 8, z - sag * math.sin(math.pi * k / 8)) for k in range(9)]
            m.tube(path, [0.013] * len(path), 5, bb.ROPE, smooth=True, cap0=True, cap1=True, urep=1, vscale=3)
    m.extras = {"length": Lg, "half_width": 0.5, "deck": 0.06}
    return m
