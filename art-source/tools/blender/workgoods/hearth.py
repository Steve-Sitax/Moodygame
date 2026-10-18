"""A tavern's open fireplace (#187: the Ankere's, the Schipke's and the Zwarte Kat's hearth were a few flat boxes).

fireplace_tavern: in the room's own frame of the recovered piece (game axes: +Y up, the hearth's front toward +Z, the
wall behind it at z = 0.09): a whitewashed chimney breast 2.1 m wide, 0.7 m deep and 2.9 m high to the ceiling, its
whitewash browned with smoke above the opening; a Belgian bluestone surround round a 1.1 x 0.95 m opening (jambs on
plinths, a lintel with a moulded edge, a mantel shelf 2.4 m long with a rounded nosing); inside, splayed brick cheeks
blackened with soot, a cast-iron fireback with a raised border and arched panel, a brick hearth with two andirons, logs
and embers; a bluestone hearth slab before it; an iron crane with a kettle on the left cheek; on the shelf two brass
candlesticks and a stoneware jug.

Blender axes while building (Z up, front toward -Y): kit.G(x, y, z) converts a game point.
"""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param, G

FRONT = 0.79  # game z of the breast's front face
BACK = 0.09
HALF_W = 1.05
TOP = 2.90
OPEN_HW, OPEN_H, OPEN_D = 0.55, 0.95, 0.46  # the opening's half width, height and depth into the breast


def B(x0, y0, z0, x1, y1, z1):
    """A box given in game axes as Blender lo, hi."""
    a, b = np.array(G(x0, y0, z0)), np.array(G(x1, y1, z1))
    return np.minimum(a, b), np.maximum(a, b)


def cells(A):
    def plaster(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.86, 0.84, 0.78))
        img *= (0.93 + 0.08 * pt.fbm(h, w, 0.08 * ppm, 0.08 * ppm, 101, 4))[..., None]
        img *= (0.97 + 0.04 * pt.fbm(h, w, 0.006 * ppm, 0.006 * ppm, 102, 2))[..., None]
        # smoke: browning that rises from the opening's top (cell row 0 = the top of the breast, 2.9 m)
        hgt = TOP - Y  # metres above the floor
        cx = np.abs(X - HALF_W)
        smoke = pt.sm(0.9, 1.15, hgt) * pt.sm(2.9, 1.3, hgt) * pt.sm(1.0, 0.25, cx)
        smoke *= 0.6 + 0.5 * pt.fbm(h, w, 0.15 * ppm, 0.4 * ppm, 103, 3)
        img = img * (1 - 0.55 * smoke[..., None]) + np.array((0.36, 0.30, 0.22)) * 0.55 * smoke[..., None]
        return img

    def bluestone(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.29, 0.31, 0.33))
        img *= (0.88 + 0.18 * pt.fbm(h, w, 0.04 * ppm, 0.04 * ppm, 104, 4))[..., None]
        # the tooled face: fine parallel chisel lines, and the crinoid specks of the blue stone
        lines = 0.5 + 0.5 * np.sin(Y / 0.0022 * 2 * math.pi + 2 * pt.fbm(h, w, 0.05 * ppm, 0.05 * ppm, 105, 2))
        img *= (0.95 + 0.06 * lines)[..., None]
        rng = np.random.default_rng(106)
        specks = (rng.random((h, w)) < 0.0012).astype(np.float32)
        specks = pt.blur(specks, 1) * 3
        img = img * (1 - np.clip(specks, 0, 0.25)[..., None]) + np.array((0.50, 0.52, 0.52)) * np.clip(specks, 0, 0.25)[..., None]
        return img

    def brick(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        bw, bh, joint = 0.22, 0.065, 0.010
        row = np.floor(Y / (bh + joint))
        u = (X + (row % 2) * bw / 2) % (bw + joint)
        v = Y % (bh + joint)
        mortar = (u > bw) | (v > bh)
        rng = np.random.default_rng(107)
        tone = rng.uniform(0.75, 1.1, (int(h / ppm / (bh + joint)) + 2, int(w / ppm / (bw + joint)) + 3))
        ti = tone[row.astype(int), np.floor((X + (row % 2) * bw / 2) / (bw + joint)).astype(int)]
        img = np.ones((h, w, 3), np.float32) * np.array((0.45, 0.22, 0.14)) * ti[..., None]
        img *= (0.85 + 0.25 * pt.fbm(h, w, 0.02 * ppm, 0.02 * ppm, 108, 3))[..., None]
        img[mortar] = np.array((0.42, 0.40, 0.36))
        # soot: blackened toward the top of the cell (the firebox's upper part) and in patches
        soot = pt.sm(1.0, 0.15, Y / Y.max()) * (0.75 + 0.5 * pt.fbm(h, w, 0.08 * ppm, 0.08 * ppm, 109, 3))
        img = img * (1 - np.clip(soot, 0, 0.92)[..., None]) + np.array((0.05, 0.045, 0.04)) * np.clip(soot, 0, 0.92)[..., None]
        return img

    def iron(w, h, ppm):
        return pt.iron(w, h, ppm, 110, rust=0.25) * 0.75

    def logs(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.24, 0.18, 0.12))
        bark = 0.5 + 0.5 * np.sin(Y / 0.010 * 2 * math.pi + 4 * pt.fbm(h, w, 0.012 * ppm, 0.05 * ppm, 111, 3))
        img *= (0.7 + 0.45 * bark)[..., None]
        # charred toward one end, glowing cracks where it burns
        char = pt.sm(0.35, 0.75, X / X.max()) * (0.7 + 0.4 * pt.fbm(h, w, 0.03 * ppm, 0.03 * ppm, 116, 2))
        img = img * (1 - 0.8 * char[..., None]) + np.array((0.04, 0.035, 0.03)) * 0.8 * char[..., None]
        cracks = pt.sm(0.62, 0.7, pt.fbm(h, w, 0.01 * ppm, 0.004 * ppm, 112, 3)) * char
        img = img * (1 - cracks[..., None]) + np.array((0.95, 0.42, 0.10)) * cracks[..., None]
        return img

    def embers(w, h, ppm):
        img = np.ones((h, w, 3), np.float32) * np.array((0.12, 0.10, 0.09))
        n = pt.fbm(h, w, 0.03 * ppm, 0.03 * ppm, 113, 4)
        glow = pt.sm(0.60, 0.78, n) * 0.85
        img = img * (1 - glow[..., None]) + np.array((0.80, 0.30, 0.07)) * glow[..., None]
        ash = pt.sm(0.35, 0.2, n)
        img = img * (1 - 0.6 * ash[..., None]) + np.array((0.55, 0.53, 0.50)) * 0.6 * ash[..., None]
        return img

    def brass(w, h, ppm):
        return pt.brass(w, h, ppm, 114)

    def stoneware(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.62, 0.55, 0.42))
        img *= (0.9 + 0.12 * pt.fbm(h, w, 0.01 * ppm, 0.01 * ppm, 115, 3))[..., None]
        # the cobalt band of a Westerwald jug
        band = pt.sm(0.012, 0.004, np.abs(Y - Y.max() * 0.45))
        img = img * (1 - 0.7 * band[..., None]) + np.array((0.18, 0.24, 0.52)) * 0.7 * band[..., None]
        return img

    return {"plaster": A.cell("hearth", 2.1, 2.9, 220, plaster, "breast whitewash"),
            "stone": A.cell("hearth", 2.45, 0.42, 400, bluestone, "bluestone"),
            "stone2": A.cell("hearth", 0.42, 1.35, 400, bluestone, "bluestone jambs"),
            "brick": A.cell("hearth", 1.2, 1.0, 360, brick, "firebox brick"),
            "iron": A.cell("hearth", 1.0, 0.9, 300, iron, "fireback iron"),
            "logs": A.cell("hearth", 0.7, 0.3, 500, logs, "logs"),
            "embers": A.cell("hearth", 1.1, 0.5, 300, embers, "embers"),
            "brass": A.cell("hearth", 0.25, 0.25, 600, brass, "brass"),
            "jug": A.cell("hearth", 0.30, 0.30, 600, stoneware, "stoneware")}


def fireplace(A):
    C = cells(A)
    m = kit.Mesh("fireplace_tavern")
    plaster = Box(C["plaster"])
    # the chimney breast round the opening: two cheeks and the part above; its back against the wall is left out
    oz = FRONT - OPEN_D
    # (the cheeks reach up to the shelf, which hides their joint with the breast above)
    for lo, hi in (B(-HALF_W, 0, BACK, -OPEN_HW - 0.20, 1.27, FRONT), B(OPEN_HW + 0.20, 0, BACK, HALF_W, 1.27, FRONT),
                   B(-HALF_W, 1.27, BACK, HALF_W, TOP, FRONT)):
        kit.cbox(m, lo, hi, plaster.bind(*B(-HALF_W, 0, BACK, HALF_W, TOP, FRONT)), c=0.008, skip=((1, 1),), thr=30.0)
    # behind the stone surround the breast's mass is the firebox's own brick
    brick = Box(C["brick"])
    # the firebox: splayed cheeks (narrower at the back), its back with the fireback, its floor
    back_hw = OPEN_HW - 0.12
    for sx in (-1, 1):
        poly = [(sx * OPEN_HW, -FRONT), (sx * (OPEN_HW + 0.12), -FRONT), (sx * (back_hw + 0.12), -oz), (sx * back_hw, -oz)]
        if sx < 0:
            poly = poly[::-1]
        kit.prism(m, poly, 0.0, OPEN_H + 0.30, brick, c=0.0, thr=30.0, caps=(False, True))
    lo, hi = B(-back_hw - 0.02, 0, oz - 0.10, back_hw + 0.02, OPEN_H + 0.30, oz)
    kit.cbox(m, lo, hi, brick, c=0.0, skip=((1, 1),), thr=30.0)
    # the firebox's throat: a sloping smoke shelf closing the top of the opening behind the lintel
    lo, hi = B(-OPEN_HW - 0.02, OPEN_H, oz - 0.05, OPEN_HW + 0.02, OPEN_H + 0.30, FRONT - 0.06)
    kit.cbox(m, lo, hi, brick, c=0.0, thr=30.0)
    # the brick hearth inside, a step up from the floor
    lo, hi = B(-OPEN_HW, 0, oz, OPEN_HW, 0.06, FRONT)
    kit.cbox(m, lo, hi, brick, c=0.004, thr=30.0)
    # the cast-iron fireback: a plate with a raised border and an arched middle panel
    iron = Box(C["iron"])
    fz = oz + 0.03
    lo, hi = B(-0.42, 0.06, fz - 0.03, 0.42, 0.80, fz)
    kit.cbox(m, lo, hi, iron, c=0.003, thr=30.0)
    for x0, x1, y0, y1 in ((-0.42, 0.42, 0.06, 0.10), (-0.42, 0.42, 0.76, 0.80), (-0.42, -0.38, 0.06, 0.80), (0.38, 0.42, 0.06, 0.80)):
        lo, hi = B(x0, y0, fz, x1, y1, fz + 0.012)
        kit.cbox(m, lo, hi, iron, c=0.002, thr=30.0)
    arch = [(-0.24, 0.16), (0.24, 0.16)] + [(0.24 * math.cos(a), 0.52 + 0.24 * math.sin(a)) for a in np.linspace(0.0, math.pi, 13)]
    with m.at(Matrix.Translation(G(0, 0, fz)) @ Matrix.Rotation(math.radians(90), 4, "X")):
        kit.prism(m, [(x, y) for x, y in arch], 0.0, 0.008, iron, c=0.0015, thr=30.0)
    # the bluestone surround: plinths, jambs, a lintel, the mantel shelf with its rounded nosing
    stone2 = Box(C["stone2"])
    stone = Box(C["stone"])
    for sx in (-1, 1):
        x0, x1 = sorted((sx * OPEN_HW, sx * (OPEN_HW + 0.20)))
        kit.cbox(m, *B(x0 - 0.01, 0, FRONT - 0.02, x1 + 0.01, 0.14, FRONT + 0.10), stone2, c=0.010, skip=((2, -1),), thr=30.0)
        kit.cbox(m, *B(x0, 0.14, FRONT - 0.02, x1, OPEN_H, FRONT + 0.08), stone2, c=0.008, thr=30.0)
        # a sunk panel down each jamb's face
        kit.cbox(m, *B(x0 + 0.04, 0.24, FRONT + 0.08, x1 - 0.04, OPEN_H - 0.08, FRONT + 0.083), stone2, c=0.002, thr=30.0)
    kit.cbox(m, *B(-OPEN_HW - 0.20, OPEN_H, FRONT - 0.02, OPEN_HW + 0.20, OPEN_H + 0.30, FRONT + 0.08), stone, c=0.008, thr=30.0)
    # the lintel's moulding: a projecting fillet under the shelf
    kit.cbox(m, *B(-OPEN_HW - 0.24, OPEN_H + 0.24, FRONT - 0.02, OPEN_HW + 0.24, OPEN_H + 0.30, FRONT + 0.12), stone, c=0.006, thr=30.0)
    # the shelf: 2.4 m, 5 cm thick, standing out 22 cm, its front edge rounded (a lathe-like nosing along x)
    shelf_y, shelf_t, shelf_d = 1.25, 0.05, 0.22
    kit.cbox(m, *B(-1.20, shelf_y, FRONT - 0.04, 1.20, shelf_y + shelf_t, FRONT + shelf_d - 0.02), stone, c=0.004, thr=30.0)
    # the nosing: a half round along the shelf's front edge, in six strips
    angles = np.linspace(-math.pi / 2, math.pi / 2, 7)
    zc, yc = FRONT + shelf_d - 0.02, shelf_y + shelf_t / 2

    def nose(a):
        return G(0.0, yc + math.sin(a) * shelf_t / 2, zc + math.cos(a) * 0.022)

    for k in range(len(angles) - 1):
        p0, p1 = np.array(nose(angles[k])), np.array(nose(angles[k + 1]))
        P = np.array([[(-1.20, p0[1], p0[2]), (1.20, p0[1], p0[2])], [(-1.20, p1[1], p1[2]), (1.20, p1[1], p1[2])]])
        ST = np.array([[(0.0, 0.30), (2.4, 0.30)], [(0.0, 0.32), (2.4, 0.32)]])
        am = (angles[k] + angles[k + 1]) / 2
        out = np.array(G(0.0, math.sin(am), math.cos(am)))
        kit.grid(m, P, ST, Param(C["stone"]), outfn=lambda i, j, c, out=out: out, thr=60.0)
    # the hearth slab before the opening
    kit.cbox(m, *B(-0.80, 0, FRONT + 0.08, 0.80, 0.035, FRONT + 0.55), stone, c=0.008, skip=((2, -1),), thr=30.0)
    # inside: two andirons, three logs on them, a bed of embers and ash
    for sx in (-1, 1):
        x = sx * 0.24
        kit.cbox(m, *B(x - 0.015, 0.06, oz + 0.06, x + 0.015, 0.09, FRONT - 0.08), iron, c=0.003, thr=30.0)
        kit.cbox(m, *B(x - 0.012, 0.06, FRONT - 0.10, x + 0.012, 0.32, FRONT - 0.07), iron, c=0.003, thr=30.0)
        with m.at(Matrix.Translation(G(x, 0.34, FRONT - 0.085))):
            kit.lathe(m, [(0.0, -0.02), (0.022, -0.012), (0.026, 0.004), (0.016, 0.020), (0.0, 0.026)], 10, Box(C["brass"]), thr=50.0)
    for k, (x0, x1, y, z) in enumerate(((-0.34, 0.30, 0.11, oz + 0.16), (-0.30, 0.34, 0.12, oz + 0.30), (-0.18, 0.22, 0.20, oz + 0.23))):
        path = [G(x0, y, z), G(x1, y + 0.01 * (k - 1), z + 0.02)]
        kit.sweep(m, path, 0.042 - 0.006 * k, 9, Param(C["logs"], wrap=0.6), up=(0, 0, 1), caps=(True, True), thr=45.0)
    lo, hi = B(-OPEN_HW + 0.06, 0.06, oz + 0.04, OPEN_HW - 0.06, 0.09, FRONT - 0.04)
    kit.cbox(m, lo, hi, Box(C["embers"]), c=0.01, thr=60.0)
    # the iron crane on the left cheek, swung in, with an S-hook and a kettle
    cx, cz = -OPEN_HW + 0.06, oz + 0.10
    kit.sweep(m, [G(cx, 0.15, cz), G(cx, 0.85, cz)], 0.012, 6, Box(C["iron"]), up=(1, 0, 0), thr=40.0)
    kit.sweep(m, [G(cx, 0.80, cz), G(cx + 0.40, 0.80, cz + 0.12)], 0.010, 6, Box(C["iron"]), up=(0, 0, 1), thr=40.0)
    kit.sweep(m, [G(cx, 0.35, cz), G(cx + 0.36, 0.78, cz + 0.11)], 0.007, 6, Box(C["iron"]), up=(0, 0, 1), thr=40.0)
    hx, hz = cx + 0.30, cz + 0.09
    kit.sweep(m, [G(hx, 0.80, hz), G(hx, 0.62, hz), G(hx + 0.02, 0.58, hz)], 0.004, 5, Box(C["iron"]), up=(1, 0, 0), thr=60.0)
    with m.at(Matrix.Translation(G(hx, 0.38, hz))):
        kit.lathe(m, [(0.0, 0.0), (0.10, 0.004), (0.12, 0.05), (0.115, 0.11), (0.07, 0.15), (0.05, 0.17), (0.0, 0.175)], 16, Box(C["iron"]), caps=(False, False), thr=40.0)
        kit.sweep(m, [(-0.07, 0.0, 0.15), (0.0, 0.0, 0.24), (0.07, 0.0, 0.15)], 0.005, 5, Box(C["iron"]), up=(0, 1, 0), thr=60.0)
        kit.sweep(m, [(0.10, 0.0, 0.08), (0.19, 0.0, 0.14), (0.22, 0.0, 0.17)], [0.016, 0.010, 0.007], 7, Box(C["iron"]), up=(0, 1, 0), caps=(False, True), thr=50.0)
    # on the shelf: two brass candlesticks with candles, and a stoneware jug
    top_y = shelf_y + shelf_t
    for x in (-0.85, 0.85):
        with m.at(Matrix.Translation(G(x, top_y, FRONT + 0.06))):
            kit.lathe(m, [(0.0, 0.0), (0.055, 0.0), (0.055, 0.010), (0.030, 0.020), (0.012, 0.040), (0.010, 0.17), (0.020, 0.19), (0.024, 0.205), (0.014, 0.21), (0.0, 0.21)], 14, Box(C["brass"]), thr=50.0)
            kit.lathe(m, [(0.0, 0.205), (0.011, 0.205), (0.011, 0.33), (0.0, 0.335)], 10, Flat(C["plaster"], 0.5, 0.97), thr=50.0)
    with m.at(Matrix.Translation(G(0.45, top_y, FRONT + 0.05))):
        kit.lathe(m, [(0.0, 0.0), (0.055, 0.0), (0.075, 0.06), (0.078, 0.10), (0.060, 0.16), (0.040, 0.20), (0.045, 0.23), (0.0, 0.23)], 16, Box(C["jug"]), thr=50.0)
        kit.sweep(m, [(0.065, 0.0, 0.18), (0.11, 0.0, 0.16), (0.10, 0.0, 0.08), (0.07, 0.0, 0.06)], 0.009, 6, Box(C["jug"]), up=(0, 1, 0), thr=60.0)
    return m
