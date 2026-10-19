"""The washing line's wooden pegs and its iron wall ring, the blue-stone horse trough (#160) and the pavement cellar hatch
(#149). Built with the work goods' kit (chamfered boxes, lathes, sweeps, holed plates); Blender axes, Z up, a model's
front toward -Y (the game's +Z). Our own work."""

import math

import numpy as np
from mathutils import Matrix

from workgoods import kit
from workgoods.kit import Box, Flat, Param, T, cbox, holed_plate, lathe, prism, sweep

# ------------------------------------------------------------------ a clothes peg


def peg(A, beech):
    """A turned one-piece beech peg (a 'dolly' peg), 108 mm: a round head, a waist, a shoulder, and two legs split by a
    3 mm slot that straddle the line and the cloth. Origin: the top of the slot, on the line; the legs down -Z, the
    slot across Y (the line runs along X through it)."""
    m = kit.Mesh("peg")
    sk = Param(beech, wrap=beech.wm * 0.9)
    lathe(m, [(0.0048, 0.0), (0.0068, 0.003), (0.0072, 0.012), (0.0056, 0.017), (0.0050, 0.023), (0.0080, 0.029),
              (0.0084, 0.036), (0.0070, 0.042), (0.0040, 0.0455), (0.0, 0.0465)], 10, sk, caps=(True, False))
    gap = 0.0015
    for side in (-1, 1):
        # a half round leg, flat face to the slot, tapering to a rounded foot
        pts = []
        for j in range(7):
            a = math.pi * j / 6
            pts.append((0.0070 * math.cos(a), side * (gap + 0.0068 * math.sin(a))))
        poly = np.array(pts if side > 0 else pts[::-1])
        prism(m, poly, -0.062, 0.0, sk, c=0.0012, caps=(True, False))
    return m


# ------------------------------------------------------------------ a wash pole out of a window


def wash_pole(A, wood):
    """An ash pole pushed out of an upper window to dry the washing on: 1.75 m, a little crooked, thinner at its tip,
    tilted up 9 degrees. Origin: on the window's sill at the pole's foot; out of the window -Y (the old pole's frame)."""
    m = kit.Mesh("wash_pole")
    n = 14
    pts, rad = [], []
    for k in range(n):
        t = k / (n - 1)
        bend = 0.012 * math.sin(t * math.pi) + 0.004 * math.sin(t * 7.0)
        pts.append((bend, 0.05 - 1.75 * t, 0.288 * t + 0.006 * math.sin(t * 5.0)))
        rad.append(0.023 - 0.006 * t)
    sweep(m, pts, rad, 10, Param(wood, wrap=wood.wm * 0.9, k=(1.0, 1.0)), caps=(True, True))
    return m


# ------------------------------------------------------------------ the wall ring the line is tied to


def ring(A, iron, hemp):
    """A forged eye bolt leaded into the wall with a round rose plate, a ring hanging in its eye, and the line's end
    knotted round the ring's foot. Origin: the wall face at the bolt; out of the wall -Y, up +Z. extras: attach, the
    line's start (game axes)."""
    m = kit.Mesh("line_ring")
    ski = Param(iron)
    # the rose plate, a shallow dome against the wall
    with m.at(Matrix.Rotation(math.radians(90), 4, "X")):
        lathe(m, [(0.030, 0.0), (0.030, 0.003), (0.024, 0.006), (0.010, 0.008), (0.0, 0.0085)], 24, ski, caps=(False, False))
    # the shank out to the eye
    sweep(m, [(0, -0.004, 0), (0, -0.040, 0)], 0.0065, 10, ski)
    # the eye: a loop round the wall's normal (one looks through it from the street)
    sweep(m, [(0.012 * math.sin(a), -0.046, 0.012 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 21)[:-1]], 0.004, 9, ski, closed=True)
    # the ring hanging in the eye, in the plane out of the wall (Y, Z)
    rr = 0.032
    cy, cz = -0.046, -0.012 - rr + 0.0045
    pts = [(0.0, cy + rr * math.sin(a), cz + rr * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 33)[:-1]]
    sweep(m, pts, 0.0045, 10, ski, closed=True)
    # the line's end: three turns round the ring's foot and a half hitch
    skh = Param(hemp, wrap=hemp.wm * 0.9)
    foot = np.array((0.0, cy, cz - rr))
    for k in range(3):
        a0 = k * 0.35
        turn = [foot + np.array((0.004 * (k - 1), 0.009 * math.sin(a + a0), 0.009 * math.cos(a + a0))) for a in np.linspace(0, 2 * math.pi, 11)[:-1]]
        sweep(m, turn, 0.0042, 6, skh, closed=True)
    # the standing part leaving the knot outward and a little down
    sweep(m, [foot + np.array((0, -0.006, -0.004)), foot + np.array((0, -0.03, -0.012)), foot + np.array((0, -0.06, -0.016))], 0.0045, 6, skh)
    attach = foot + np.array((0, -0.06, -0.016))
    return m, (float(attach[0]), float(attach[2]), float(-attach[1]))


# ------------------------------------------------------------------ the horse trough


def _rounded_rect(hx, hy, r, n=4):
    """A ccw rectangle (half sizes hx, hy) with corners rounded by r, n points per corner."""
    pts = []
    for cx, cy, a0 in ((hx - r, -hy + r, -90), (hx - r, hy - r, 0), (-hx + r, hy - r, 90), (-hx + r, -hy + r, 180)):
        for j in range(n):
            a = math.radians(a0 + 90 * j / (n - 1))
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return np.array(pts)


def trough(A, stone, water):
    """A horse trough hewn from one block of blue stone, 2.00 x 0.70 m and 0.62 m high (the old trough's size), on a
    low stone footing: its arrises worn round (12 mm, more on the rim where the horses drink), the basin's corners
    rounded, the water 7 cm under the rim. Origin: the ground under its middle; its long side along X."""
    m = kit.Mesh("trough")
    sk = Box(stone, rng=np.random.default_rng(5))
    cbox(m, (-1.02, -0.37, 0.0), (1.02, 0.37, 0.045), sk, c=0.010, skip=((2, -1),))
    outer = _rounded_rect(0.985, 0.335, 0.02, 5)
    rim = _rounded_rect(1.0, 0.35, 0.03, 5)
    inner = _rounded_rect(0.88, 0.25, 0.06, 5)
    # the body, then the rim: a broad band 6 cm deep standing 15 mm proud, its top worn round
    holed_plate(m, outer, inner, 0.045, 0.56, Box(stone, rng=np.random.default_rng(6)), c=0.010)
    holed_plate(m, rim, inner, 0.552, 0.62, Box(stone, rng=np.random.default_rng(8)), c=0.014)
    # the basin's floor (seen only where the water is clear) and the water
    m.face([m.vid((x, y, 0.20)) for x, y in inner], [(x, y, 0.20) for x, y in inner], Flat(water), out=(0, 0, 1))
    m.face([m.vid((x, y, 0.55)) for x, y in inner], [(x, y, 0.55) for x, y in inner], Param(water), st=[((x + 0.9) * 0.3, (y + 0.3) * 0.3) for x, y in inner], out=(0, 0, 1))
    return m


# ------------------------------------------------------------------ the cellar hatch


def hatch(A, oak, iron, dark):
    """A pavement cellar hatch against a house front: a cast-iron angle frame flush with the paving (its top 3 mm
    proud), two oak leaves of four boards each, hinged at their outer ends on strap hinges, each with a drop ring at
    the meeting edge. 1.10 m along the wall, 0.44 m out. Origin: the wall face at the frame's middle, on the paving's
    top; out of the wall -Y."""
    m = kit.Mesh("cellar_hatch")
    rng = np.random.default_rng(7)
    ski = Box(iron)
    W, D = 0.55, 0.44
    outer = np.array(((-W, -D), (W, -D), (W, 0.0), (-W, 0.0)))
    hole = np.array(((-W + 0.035, -D + 0.035), (W - 0.035, -D + 0.035), (W - 0.035, -0.035), (-W + 0.035, -0.035)))
    holed_plate(m, outer, hole, -0.05, 0.003, ski, c=0.002)
    # the meeting rail between the leaves
    cbox(m, (-0.016, -D + 0.03, -0.05), (0.016, -0.03, -0.001), ski, c=0.002)
    # the dark well under the boards' gaps
    m.face([m.vid((x, y, -0.04)) for x, y in hole], [(x, y, -0.04) for x, y in hole], Flat(dark), out=(0, 0, 1))
    for side in (-1, 1):
        x0, x1 = (-W + 0.038, -0.018) if side < 0 else (0.018, W - 0.038)
        bw = (x1 - x0 - 3 * 0.003) / 4
        for b in range(4):
            bx0 = x0 + b * (bw + 0.003)
            dz = rng.uniform(-0.0012, 0.0008)
            skb = Box(oak, grain=1, rng=rng)
            cbox(m, (bx0, -D + 0.038, -0.045), (bx0 + bw, -0.038, -0.004 + dz), skb, c=0.0028, skip=((2, -1),))
        # two strap hinges across the boards, from the outer end toward the meeting edge
        for yc in (-D + 0.10, -0.10):
            xs, xe = (x0 + 0.004, x0 + 0.40) if side < 0 else (x1 - 0.004, x1 - 0.40)
            lo, hi = min(xs, xe), max(xs, xe)
            cbox(m, (lo, yc - 0.021, -0.0045), (hi, yc + 0.021, 0.0005), ski, c=0.0015)
            # the round end of the strap
            tip = xe
            with m.at(T(tip, yc, -0.0045)):
                lathe(m, [(0.021, 0.0), (0.021, 0.0035), (0.019, 0.005), (0.0, 0.005)], 12, Param(iron), caps=(False, False))
            for k in range(3):
                bx = xs + (xe - xs) * (0.25 + 0.3 * k)
                with m.at(T(bx, yc, 0.0005)):
                    lathe(m, [(0.0075, 0.0), (0.0065, 0.0025), (0.0035, 0.0045), (0.0, 0.005)], 8, Param(iron))
            # the hinge's knuckle at the frame
            with m.at(T(xs - side * 0.0, yc, -0.002) @ Matrix.Rotation(math.radians(90), 4, "X")):
                lathe(m, [(0.0075, -0.026), (0.0075, 0.026)], 10, Param(iron), caps=(True, True))
        # the drop ring by the meeting edge, lying in its staple
        cx = side * 0.075
        with m.at(T(cx, -D / 2, -0.004)):
            pts = [(0.032 * math.cos(a), 0.032 * math.sin(a), 0.0055) for a in np.linspace(0, 2 * math.pi, 19)[:-1]]
            sweep(m, pts, 0.0055, 7, Param(iron), closed=True)
            cbox(m, (-0.008, -0.04, -0.001), (0.008, -0.026, 0.009), ski, c=0.0015)
    return m
