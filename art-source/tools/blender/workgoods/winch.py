"""A hand crab winch of the 1870s for a building site: two oak cheeks on oak sole beams, braced by sloping struts
behind, held together by an oak stay and iron tie rods; an oak drum with iron-tyred flanges and iron bands, a few
turns of hemp rope; a cast-iron spur wheel on the drum axle driven by a pinion on the crank axle; a ratchet wheel
and its pawl; an iron crank with a turned wooden handle.

Everything here is written in GAME axes (x right, y up, z toward the front the rope leaves to; the worker stands at
z = -0.42 facing +z) and turned into Blender axes by GM.

Nodes: crab_winch (an empty on the ground) with winch_frame (static), winch_drum (origin on the drum axle, turns
about its local x) and winch_crank (origin on the crank axle at (0, 1.02, 0), turns about its local x).
Turning the crank by an angle a turns the drum by -a / GEAR_RATIO (the gears turn opposite ways).
"""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param

GM = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game (x, y, z) -> Blender (x, -z, y)
AX = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # local z along game +x (local x -> y, y -> z)
AXN = Matrix(((0, 0, -1, 0), (1, 0, 0, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # local z along game -x
SIDE = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))  # outlines in (-z, y), thickness along x

CRANK = (0.0, 1.02, 0.0)
DRUM = (0.0, 0.78, 0.08)
CRANK_R = 0.24
TEETH_P, TEETH_W = 10, 40
GEAR_RATIO = TEETH_W / TEETH_P
_D = math.hypot(CRANK[1] - DRUM[1], CRANK[2] - DRUM[2])
R_PINION = _D / (1 + GEAR_RATIO)
R_WHEEL = _D - R_PINION
MODULE = 2 * R_PINION / TEETH_P
GEAR_X = (0.175, 0.205)
DRUM_X = (0.225, 0.725)
R_DRUM = 0.090
R_FLANGE = 0.140
ROPE_R = 0.011
ROPE_TURNS = 6
ROPE_X0 = 0.262
RATCHET_X = (0.740, 0.765)
CHEEK_X = ((0.05, 0.11), (0.83, 0.89))
STRUT_X = ((0.11, 0.16), (0.78, 0.83))
SOLE_X = ((0.02, 0.17), (0.77, 0.92))
SOLE_Z = (-0.14, 0.86)
SOLE_H = 0.10
PPM = 500


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def ccw(poly):
    poly = np.asarray(poly, float)
    a = 0.0
    for i in range(len(poly)):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % len(poly)]
        a += x0 * y1 - x1 * y0
    return poly if a > 0 else poly[::-1].copy()


def zy(points):
    """Outline points written as game (z, y) into the SIDE frame's local (x, y) = (-z, y)."""
    return ccw([(-z, y) for z, y in points])


def rope_leaves():
    xc = ROPE_X0 + ROPE_R + 2 * ROPE_R * (ROPE_TURNS - 1)
    return [round(xc, 4), DRUM[1], round(DRUM[2] + R_DRUM + ROPE_R, 4)]


def cells(A):
    oak = (0.47, 0.36, 0.24)

    def cheek_tex(w, h, ppm):
        # u runs up the cheek (the grain), v across it
        img = pt.wood(w, h, ppm, oak, 101, oak=True, knots=2, weather=0.35, ring_mm=4.0)
        X, Y = pt.coords(w, h, ppm)
        # mud splashed up from the site at the foot (u near 0)
        mud = pt.sm(0.16, 0.0, X) * (0.6 + 0.4 * pt.fbm(h, w, 0.03 * ppm, 0.03 * ppm, 102, 3))
        pt.mix(img, mud * 0.6, (0.24, 0.20, 0.15))
        return img

    def beam_tex(w, h, ppm):
        img = pt.wood(w, h, ppm, oak, 111, oak=True, knots=3, weather=0.45, ring_mm=4.5)
        pt.mix(img, pt.sm(0.55, 0.8, pt.fbm(h, w, 0.06 * ppm, 0.02 * ppm, 112, 3)) * 0.35, (0.25, 0.21, 0.16))
        return img

    def drum_tex(w, h, ppm):
        # u: round the barrel (16 staves); v: along it
        img = pt.wood(w, h, ppm, (0.44, 0.33, 0.22), 121, oak=True, knots=1, along="v", weather=0.2, ring_mm=3.0)
        X, Y = pt.coords(w, h, ppm)
        f = (X / (2 * math.pi * R_DRUM / 16)) % 1.0
        joints = (f < 0.025) | (f > 0.975)
        img[joints] *= 0.45
        # rope-worn bright patches
        pt.mix(img, pt.sm(0.65, 0.85, pt.fbm(h, w, 0.04 * ppm, 0.1 * ppm, 122, 3)) * 0.3, (0.55, 0.45, 0.32))
        return img

    def flange_tex(w, h, ppm):
        # the flange faces: two oak boards side by side
        img = pt.wood(w, h, ppm, (0.45, 0.34, 0.23), 125, oak=True, knots=0, weather=0.3, ring_mm=3.5)
        X, Y = pt.coords(w, h, ppm)
        img[np.abs(Y - Y.max() / 2) < 0.0012] *= 0.4
        return img

    def handle_tex(w, h, ppm):
        img = pt.wood(w, h, ppm, (0.50, 0.37, 0.23), 141, along="v", knots=0, ring_mm=2.0)
        X, Y = pt.coords(w, h, ppm)
        # polished dark by hands in the middle
        mid = pt.sm(0.05, 0.12, Y) * pt.sm(Y.max() - 0.03, Y.max() - 0.09, Y)
        img *= (1 - 0.3 * mid)[..., None]
        return img

    C = {}
    C["cheek"] = A.cell("winch", 1.08, 0.47, PPM, cheek_tex, "winch cheek")
    C["drum"] = A.cell("winch", 2 * math.pi * R_DRUM + 0.012, 0.50, PPM, drum_tex, "winch drum")
    C["end"] = A.cell("winch", 0.17, 0.17, PPM, lambda w, h, p: pt.end_grain(w, h, p, oak, 151), "winch end grain")
    C["beam"] = A.cell("winch", 1.20, 0.22, PPM, beam_tex, "winch beams")
    C["rope"] = A.cell("winch", 0.66, 0.26, PPM, lambda w, h, p: pt.hemp(w, h, p, 161, lay=0.03), "winch rope")
    C["iron"] = A.cell("winch", 0.46, 0.46, PPM, lambda w, h, p: pt.iron(w, h, p, 131, rust=0.32), "winch iron")
    C["long"] = A.cell("winch", 0.99, 0.06, PPM, lambda w, h, p: pt.iron(w, h, p, 132, rust=0.25), "winch axles")
    C["handle"] = A.cell("winch", 0.115, 0.37, PPM, handle_tex, "winch handle")
    C["flange"] = A.cell("winch", 0.29, 0.29, PPM, flange_tex, "winch flanges")
    return C


STRUT_TOP = np.array((0.10, 1.00))  # game (z, y) of the strut's centre line at its top
STRUT_BOT = np.array((0.78, SOLE_H))


def _strut_frame():
    """The strut's frame in the SIDE plane: local x along it (down toward the back), at its centre; and its length
    (the foot sunk 5 cm into the beam)."""
    top = np.array((-STRUT_TOP[0], STRUT_TOP[1]))
    bot = np.array((-STRUT_BOT[0], STRUT_BOT[1]))
    d = (bot - top) / np.linalg.norm(bot - top)
    L = float(np.linalg.norm(bot - top)) + 0.05
    c = top + d * L / 2
    a = math.atan2(d[1], d[0])
    return T(c[0], c[1], 0.0) @ Matrix.Rotation(a, 4, "Z"), L


def _strut_z(y):
    t = (y - STRUT_TOP[1]) / (STRUT_BOT[1] - STRUT_TOP[1])
    return float(STRUT_TOP[0] + t * (STRUT_BOT[0] - STRUT_TOP[0]))


def _bolt(m, x, y, z, sx, skin, r=0.011):
    """A domed bolt head on a face looking toward sx (+-1 along game x)."""
    M = T(x, y, z) @ (AX if sx > 0 else AXN)
    with m.at(M):
        kit.lathe(m, [(r, -0.002), (r * 0.9, 0.003), (r * 0.55, 0.0065), (0.0, 0.008)], 8, skin, thr=50.0)


def _nut(m, x, y, z, sx, skin, s=0.032, t=0.016):
    """A square nut (and the rod's end) on a face looking toward sx."""
    x0, x1 = (x, x + t) if sx > 0 else (x - t, x)
    kit.cbox(m, (x0, y - s / 2, z - s / 2), (x1, y + s / 2, z + s / 2), skin, c=0.002)


def _plate(m, cz, cy, w, h, x0, x1, skin, r=0.012):
    """A bearing plate on a cheek's face: a rounded rectangle w (along z) by h (along y), from x0 to x1."""
    pts = []
    for qx, qy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(3):
            a = math.radians(a0 + 45 * k)
            pts.append((cz + qx + r * math.cos(a), cy + qy + r * math.sin(a)))
    with m.at(SIDE):
        kit.prism(m, zy(pts), x0, x1, skin, c=0.0025)


def frame(A, C):
    m = kit.Mesh("winch_frame")
    iron = Box(C["iron"], rng=np.random.default_rng(5))
    long_ = Box(C["long"], grain=2)
    rng = np.random.default_rng(7)
    beam = Box(C["beam"], grain=2, ends=C["end"], rng=rng)
    with m.at(GM):
        # the sole beams on the ground, along z
        for x0, x1 in SOLE_X:
            kit.cbox(m, (x0, 0.0, SOLE_Z[0]), (x1, SOLE_H, SOLE_Z[1]), beam, c=0.006, skip=((1, -1),))
        # the cheeks: oak planks standing on the beams, their tops rounded over the crank bearing
        cheek = [(-0.13, SOLE_H), (0.32, SOLE_H), (0.135, 1.10), (0.09, 1.135), (0.03, 1.152), (-0.03, 1.150),
                 (-0.075, 1.132), (-0.095, 1.10)]
        for x0, x1 in CHEEK_X:
            with m.at(SIDE):
                kit.prism(m, zy(cheek), x0, x1, Box(C["cheek"], grain=1), c=0.004, caps=(True, True))
        # the struts behind, inside the cheeks, from high on the cheek down into the beams' back ends (their foot
        # sunk in the beam, a sawn end at the top)
        for x0, x1 in STRUT_X:
            M, L = _strut_frame()
            with m.at(SIDE @ M):
                kit.cbox(m, (-L / 2, -0.04, x0), (L / 2, 0.04, x1), Box(C["beam"], grain=0, ends=C["end"], rng=rng), c=0.004)
        # the oak stay across the front, low, bolted through both cheeks
        kit.cbox(m, (CHEEK_X[0][1], 0.20, -0.105), (CHEEK_X[1][0], 0.29, -0.035), Box(C["beam"], grain=0, ends=C["end"], rng=rng),
                 c=0.004, skip=((0, -1), (0, 1)))
        # the ground sill between the beams at the back
        kit.cbox(m, (SOLE_X[0][1], 0.0, 0.60), (SOLE_X[1][0], 0.085, 0.70), Box(C["beam"], grain=0, ends=C["end"], rng=rng),
                 c=0.004, skip=((1, -1), (0, -1), (0, 1)))
        # iron tie rods: one through the cheeks, one through the struts, square nuts outside
        rods = [((CHEEK_X[0][0] - 0.02, CHEEK_X[1][1] + 0.02), 0.45, 0.22, (CHEEK_X[0][0], CHEEK_X[1][1])),
                ((STRUT_X[0][0] - 0.02, STRUT_X[1][1] + 0.02), 0.40, _strut_z(0.40), (STRUT_X[0][0], STRUT_X[1][1]))]
        for (xa, xb), y, z, (fa, fb) in rods:
            with m.at(T(0, y, z) @ AX):
                kit.lathe(m, [(0.0, xa), (0.009, xa), (0.011, xa + 0.003), (0.011, xb - 0.003), (0.009, xb), (0.0, xb)], 8, long_,
                          thr=50.0)
            _nut(m, fa, y, z, -1, iron)
            _nut(m, fb, y, z, 1, iron)
        # the front stay's bolt ends
        _nut(m, CHEEK_X[0][0], 0.245, -0.07, -1, iron, s=0.03, t=0.014)
        _nut(m, CHEEK_X[1][1], 0.245, -0.07, 1, iron, s=0.03, t=0.014)
        # bearings: iron plates on both cheeks' outer faces with a boss round the axle and two bolts
        for (cy, cz) in ((CRANK[1], CRANK[2]), (DRUM[1], DRUM[2])):
            for side, (x0, x1) in ((-1, CHEEK_X[0]), (1, CHEEK_X[1])):
                face = x0 if side < 0 else x1
                pa, pb = (face - 0.012, face) if side < 0 else (face, face + 0.012)
                _plate(m, cz, cy, 0.13, 0.072, pa, pb, iron)
                bx0, bx1 = (pa - 0.010, pa) if side < 0 else (pb, pb + 0.010)
                ri = 0.0175 if cy == CRANK[1] else 0.0205
                prof = ([(ri, bx0), (0.027, bx0), (0.030, bx0 + 0.003), (0.030, bx1)] if side < 0 else
                        [(0.030, bx0), (0.030, bx1 - 0.003), (0.027, bx1), (ri, bx1)])
                with m.at(T(0, cy, cz) @ AX):
                    kit.lathe(m, prof, 12, iron, thr=40.0)
                for dz in (-0.045, 0.045):
                    _bolt(m, pa if side < 0 else pb, cy, cz + dz, side, iron)
        # the pawl, pivoted on a pin from the right cheek, its tip in the ratchet's teeth
        piv = np.array((0.985, 0.135))  # (y, z)
        cen = np.array((DRUM[1], DRUM[2]))
        rt = 0.104
        best = None
        for k in range(720):
            a = 2 * math.pi * k / 720
            p = cen + rt * np.array((math.cos(a), math.sin(a)))
            e = abs(np.linalg.norm(p - piv) - 0.112)
            if p[1] > cen[1] + 0.06 and (best is None or e < best[0]):
                best = (e, p)
        tip = best[1]
        dv = (tip - piv) / np.linalg.norm(tip - piv)
        nv = np.array((-dv[1], dv[0]))
        outline = []
        for k in range(7):
            a = math.pi / 2 + math.pi * k / 6
            q = piv + 0.018 * (math.cos(a) * dv + math.sin(a) * nv)
            outline.append(q)
        outline += [tip - nv * 0.004 + dv * 0.002, tip + nv * 0.007 - dv * 0.006]
        poly = [(p[1], p[0]) for p in outline]  # (z, y)
        with m.at(SIDE):
            kit.prism(m, zy(poly), RATCHET_X[0] + 0.002, RATCHET_X[1] - 0.002, iron, c=0.0015)
        with m.at(T(0, piv[0], piv[1]) @ AX):
            kit.lathe(m, [(0.0, RATCHET_X[0] - 0.009), (0.010, RATCHET_X[0] - 0.009), (0.012, RATCHET_X[0] - 0.005),
                          (0.008, RATCHET_X[0] - 0.0015), (0.008, STRUT_X[1][0] + 0.004)], 8, iron, thr=50.0)
    return m


def drum(A, C):
    m = kit.Mesh("winch_drum")
    iron = Box(C["iron"], rng=np.random.default_rng(9))
    long_ = Box(C["long"], grain=2)
    with m.at(GM @ T(-DRUM[0], -DRUM[1], -DRUM[2])):
        with m.at(T(0, DRUM[1], DRUM[2]) @ AX):
            # the axle
            kit.lathe(m, [(0.0, 0.025), (0.016, 0.025), (0.020, 0.029), (0.020, 0.921), (0.016, 0.925), (0.0, 0.925)], 10, long_,
                      thr=50.0)
            # the oak drum: two flanges and the barrel of 16 staves between them (faceted, its joints in the picture)
            x0, x1 = DRUM_X
            f = 0.030
            prof = [(0.0195, x0), (R_FLANGE - 0.004, x0), (R_FLANGE, x0 + 0.004), (R_FLANGE, x0 + f - 0.004), (R_FLANGE - 0.004, x0 + f),
                    (R_DRUM, x0 + f), (R_DRUM, x1 - f), (R_FLANGE - 0.004, x1 - f), (R_FLANGE, x1 - f + 0.004),
                    (R_FLANGE, x1 - 0.004), (R_FLANGE - 0.004, x1), (0.0195, x1)]
            flange = kit.Planar(C["flange"], 2, (-R_FLANGE - 0.004, -R_FLANGE - 0.004, 0.0))
            t5 = sum(math.hypot(prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1]) for k in range(5))
            body = Param(C["drum"], off=(0.0, -t5))

            def drum_skin(i, j):
                # row 5 is the barrel; the other rows are the flanges' faces and rims
                return body if i == 5 else flange

            kit.lathe(m, prof, 16, drum_skin, cref=R_DRUM, thr=20.0)
            # iron tyres on the flanges and two bands round the barrel
            for xa in (x0, x1 - f):
                kit.lathe(m, [(R_FLANGE - 0.0006, xa + 0.003), (R_FLANGE + 0.0035, xa + 0.0045), (R_FLANGE + 0.0035, xa + f - 0.0045),
                              (R_FLANGE - 0.0006, xa + f - 0.003)], 16, iron, thr=50.0)
            for xb in (0.470, 0.668):
                kit.lathe(m, [(R_DRUM - 0.0008, xb), (R_DRUM + 0.0032, xb + 0.0015), (R_DRUM + 0.0032, xb + 0.026),
                              (R_DRUM - 0.0008, xb + 0.0275)], 16, iron, thr=20.0)
            # the rope: turns lying side by side on the barrel, real bumps in the silhouette
            prof = [(R_DRUM - 0.001, ROPE_X0)]
            for k in range(ROPE_TURNS):
                xc = ROPE_X0 + ROPE_R + 2 * ROPE_R * k
                for deg in (60, 120, 180):
                    a = math.radians(deg)
                    prof.append((R_DRUM + ROPE_R + ROPE_R * math.sin(a), xc - ROPE_R * math.cos(a)))
            prof[-1] = (R_DRUM - 0.001, prof[-1][1])
            kit.lathe(m, prof, 16, Param(C["rope"]), cref=R_DRUM + ROPE_R, thr=70.0)
            # the spur wheel: a cast rim with 40 teeth, six arms, a hub keyed on the axle
            ga, gb = GEAR_X
            phase = math.atan2(CRANK[2] - DRUM[2], CRANK[1] - DRUM[1]) + math.pi / TEETH_W
            r_in = R_WHEEL - 1.25 * MODULE - 0.017
            kit.gear(m, TEETH_W, R_WHEEL, MODULE, ga, gb, iron, r_in, phase=phase, c=0.0018)
            for k in range(6):
                a = 2 * math.pi * k / 6 + 0.26
                ca, sa = math.cos(a), math.sin(a)
                pr = np.array((-sa, ca))
                da = np.array((ca, sa))
                poly = [da * 0.036 - pr * 0.016, da * (r_in + 0.004) - pr * 0.011, da * (r_in + 0.004) + pr * 0.011, da * 0.036 + pr * 0.016]
                kit.prism(m, [tuple(p) for p in poly], ga + 0.006, gb - 0.006, iron, c=0.002, center=(0, 0))
            kit.lathe(m, [(0.0195, ga - 0.012), (0.040, ga - 0.012), (0.044, ga - 0.008), (0.044, gb + 0.008), (0.040, gb + 0.012),
                          (0.0195, gb + 0.012)], 12, iron, thr=40.0)
            # the ratchet wheel by the right cheek: 18 teeth, cut one way, on its own hub
            ra, rb = RATCHET_X
            n = 18
            rf, rt = 0.098, 0.116
            out = []
            for k in range(n):
                a = 2 * math.pi * k / n
                a2 = a + 2 * math.pi / n * 0.92
                out += [(rf * math.cos(a), rf * math.sin(a)), (rt * math.cos(a2), rt * math.sin(a2))]
            kit.prism(m, out, ra, rb, iron, c=0.0015, mode="radial", center=(0, 0))
            kit.lathe(m, [(0.0195, ra - 0.008), (0.034, ra - 0.008), (0.036, ra - 0.006), (0.036, rb + 0.006), (0.034, rb + 0.008),
                          (0.0195, rb + 0.008)], 12, iron, thr=40.0)
    return m


def crank(A, C):
    m = kit.Mesh("winch_crank")
    iron = Box(C["iron"], rng=np.random.default_rng(11))
    long_ = Box(C["long"], grain=2)
    with m.at(GM @ T(-CRANK[0], -CRANK[1], -CRANK[2])):
        with m.at(T(0, CRANK[1], CRANK[2]) @ AX):
            # the crank axle with its collar beyond the right bearing
            kit.lathe(m, [(0.0, -0.034), (0.013, -0.034), (0.017, -0.030), (0.017, 0.936), (0.013, 0.940), (0.0, 0.940)], 12, long_,
                      thr=50.0)
            kit.lathe(m, [(0.0165, 0.916), (0.024, 0.916), (0.026, 0.918), (0.026, 0.928), (0.024, 0.930), (0.0165, 0.930)], 12, iron,
                      thr=40.0)
            # the pinion
            ga, gb = GEAR_X
            phase = math.atan2(DRUM[2] - CRANK[2], DRUM[1] - CRANK[1])
            kit.gear(m, TEETH_P, R_PINION, MODULE, ga, gb, iron, 0.0165, phase=phase, c=0.0015, wall=False)
            kit.lathe(m, [(0.0165, ga - 0.012), (0.028, ga - 0.012), (0.031, ga - 0.009), (0.031, ga), ], 12, iron, thr=40.0)
            kit.lathe(m, [(0.031, gb), (0.031, gb + 0.009), (0.028, gb + 0.012), (0.0165, gb + 0.012)], 12, iron, thr=40.0)
            # the crank arm at x = 0, pointing up at rest: a tapered bar between two bosses
            arm = []
            for k in range(7):
                a = math.radians(90 + 180 * k / 6)
                arm.append((0.030 * math.cos(a), 0.030 * math.sin(a)))
            for k in range(7):
                a = math.radians(270 + 180 * k / 6)
                arm.append((CRANK_R + 0.022 * math.cos(a), 0.022 * math.sin(a)))
            kit.prism(m, ccw(arm), -0.010, 0.010, iron, c=0.002)
            kit.lathe(m, [(0.0165, -0.020), (0.034, -0.020), (0.037, -0.017), (0.037, 0.017), (0.034, 0.020), (0.0165, 0.020)], 12,
                      iron, thr=40.0)
        with m.at(T(0, CRANK[1] + CRANK_R, CRANK[2]) @ AX):
            kit.lathe(m, [(0.0, -0.018), (0.022, -0.018), (0.025, -0.015), (0.025, 0.013), (0.022, 0.016), (0.0, 0.016)], 12, iron,
                      thr=40.0)
        with m.at(T(0, CRANK[1] + CRANK_R, CRANK[2]) @ AXN):
            # the handle: turned wood on an iron pin, a washer at the arm, the pin's head at the far end
            kit.lathe(m, [(0.009, 0.018), (0.021, 0.018), (0.021, 0.024), (0.009, 0.024)], 12, iron, thr=40.0)
            hp = [(0.0088, 0.024), (0.0135, 0.0245), (0.0162, 0.029), (0.0158, 0.036), (0.0170, 0.045), (0.0176, 0.20),
                  (0.0170, 0.355), (0.0160, 0.370), (0.0135, 0.3825), (0.0088, 0.384)]
            kit.lathe(m, hp, 12, Param(C["handle"]), cref=0.0176, thr=45.0)
            kit.lathe(m, [(0.0088, 0.383), (0.0125, 0.384), (0.0118, 0.389), (0.0075, 0.3925), (0.0, 0.394)], 10, iron, thr=50.0)
    return m


def build(A):
    C = cells(A)
    return frame(A, C), drum(A, C), crank(A, C)


def extras():
    return {
        "crank_axle": [CRANK[0], CRANK[1], CRANK[2]],
        "crank_radius": CRANK_R,
        "drum_axle": [0.475, DRUM[1], DRUM[2]],
        "gear_ratio": GEAR_RATIO,
        "rope_leaves": rope_leaves(),
        "rope_leaves_dir": [0.0, 1.0, 0.0],
        "crank_handle_rest": [-0.2, round(CRANK[1] + CRANK_R, 4), 0.0],
        "turning": "winch_crank and winch_drum turn about their local x; the drum turns by -crank_angle / gear_ratio; "
                   "at rest the crank arm points up (+y)",
    }
