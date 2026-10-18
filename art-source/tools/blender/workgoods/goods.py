"""Goods: a cooper's wash tub, a stack of dried cattle hides, a brown-paper parcel. Game axes (y up, front +z),
turned into Blender axes by GM; each origin at the middle of the base."""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param, Planar
from .luggage import AX, AY, GM, T

# ------------------------------------------------------------------ the wash tub

UPPM = 480
R_BOT, R_TOP, H_TUB = 0.258, 0.307, 0.340  # outer radii at the foot and the rim
WALL = 0.018
NSTAVE = 16
FLOOR_Y = 0.048


def r_out(y):
    return R_BOT + (R_TOP - R_BOT) * y / H_TUB


def tub_cells(A):
    oak = (0.50, 0.38, 0.25)
    sw = 2 * math.pi * R_TOP / NSTAVE

    def stave_tex(w, h, ppm):
        # u: round the tub, four staves (repeated); v: down the outside from the foot... the profile's length
        rng = pt.rng_(601)
        img = pt.wood(w, h, ppm, oak, 602, oak=True, knots=1, along="v", ring_mm=3.5, weather=0.3)
        X, Y = pt.coords(w, h, ppm)
        k = np.floor(X / sw).astype(int)
        tone = rng.uniform(0.82, 1.12, 8)[np.clip(k, 0, 7)]
        img *= tone[..., None]
        f = (X / sw) % 1.0
        img[(f < 0.018) | (f > 0.982)] *= 0.35
        # the inside (past the rim): soaked grey-brown, darker toward the floor; a tide line
        t_rim = H_TUB + 0.02
        inside = pt.sm(t_rim - 0.005, t_rim + 0.01, Y)
        wet = np.array((0.30, 0.26, 0.21))
        img = img * (1 - 0.45 * inside[..., None]) + wet * 0.45 * inside[..., None]
        img *= (1 - 0.25 * pt.sm(t_rim + 0.05, Y.max(), Y) * inside)[..., None]
        tide = np.abs(Y - (t_rim + 0.09)) < 0.004
        img[tide] *= 0.8
        # grime low on the outside, splashes
        img *= (1 - 0.2 * pt.sm(0.08, 0.0, Y))[..., None]
        return img

    def floor_tex(w, h, ppm):
        img = pt.wood(w, h, ppm, (0.40, 0.32, 0.23), 611, oak=True, knots=1, ring_mm=3.0)
        X, Y = pt.coords(w, h, ppm)
        for k in range(1, 4):
            img[np.abs(Y - Y.max() * k / 4) < 0.0015] *= 0.35
        img *= (0.75 + 0.15 * pt.fbm(h, w, 0.08 * ppm, 0.08 * ppm, 612, 3))[..., None]
        return img

    return {
        "stave": A.cell("tub", 4 * sw + 0.004, 0.72, UPPM, stave_tex, "tub staves"),
        "floor": A.cell("tub", 0.53, 0.53, UPPM, floor_tex, "tub floor"),
        "iron": A.cell("tub", 4 * sw + 0.004, 0.06, UPPM, lambda w, h, p: pt.iron(w, h, p, 621, rust=0.4), "tub hoops"),
    }


def tub(A):
    C = tub_cells(A)
    m = kit.Mesh("tub")
    sw = 2 * math.pi * R_TOP / NSTAVE
    sides = NSTAVE * 4
    step = 2 * math.pi / sides
    a0 = -math.pi / NSTAVE  # a joint half a stave from the lugs at 0 and pi

    def staves(a, r, z):
        j = int(round((a - a0) / step)) % 4
        return r + (-0.0022, 0.0, 0.0007, 0.0)[j]

    c = 0.004
    prof = [(R_BOT - c, 0.0), (R_BOT, c), (r_out(H_TUB - c), H_TUB - c), (r_out(H_TUB) - c, H_TUB),
            (r_out(H_TUB) - WALL + c, H_TUB), (r_out(H_TUB - c) - WALL, H_TUB - c), (r_out(FLOOR_Y) - WALL, FLOOR_Y)]
    with m.at(GM @ AY):
        kit.lathe(m, prof, sides, Param(C["stave"], wrap=4 * sw), cref=R_TOP, a0=a0, radial=staves, thr=30.0)
        # the floor boards, sunk in the croze, and the underside between the chime
        kit.lathe(m, [(r_out(FLOOR_Y) - WALL + 0.004, FLOOR_Y), (0.0, FLOOR_Y)], 32, Planar(C["floor"], 2, (-0.265, -0.265, 0)), thr=30.0)
        kit.lathe(m, [(0.0, 0.0015), (R_BOT - c - 0.002, 0.0015)], 32, Flat(C["floor"], 0.5, 0.5), shade=0.35, thr=30.0)
        # two iron hoops driven on the taper
        for y0, y1 in ((0.058, 0.098), (0.242, 0.282)):
            hp = [(r_out(y0) - 0.001, y0), (r_out(y0 + 0.002) + 0.0032, y0 + 0.002), (r_out(y1 - 0.002) + 0.0032, y1 - 0.002),
                  (r_out(y1) - 0.001, y1)]
            kit.lathe(m, hp, 48, Param(C["iron"], wrap=4 * sw), cref=R_TOP, thr=50.0)
    # the two lugs: longer staves standing above the rim, each with a hand hole
    with m.at(GM):
        slope = (R_TOP - R_BOT) / H_TUB
        for phi in (0.0, math.pi):
            d = np.array((math.cos(phi), 0.0, math.sin(phi)))
            up = np.array((0.0, 1.0, 0.0)) + d * slope
            up /= np.linalg.norm(up)
            tx = -np.array((-math.sin(phi), 0.0, math.cos(phi)))
            nz = np.cross(tx, up)
            y0 = H_TUB - 0.006
            o = d * (r_out(y0) - 0.0027) + np.array((0, y0, 0))
            M = Matrix(((tx[0], up[0], nz[0], o[0]), (tx[1], up[1], nz[1], o[1]), (tx[2], up[2], nz[2], o[2]), (0, 0, 0, 1)))
            hw0, hw1, hh = sw / 2 - 0.003, sw / 2 - 0.010, 0.088
            outer = [(-hw0, 0.0), (hw0, 0.0), (hw0 - 0.002, 0.050), (hw1, 0.074), (hw1 - 0.016, hh), (-hw1 + 0.016, hh), (-hw1, 0.074),
                     (-hw0 + 0.002, 0.050)]
            hc = np.array((0.0, 0.052))
            hole = []
            for p in outer:
                th = math.atan2(p[1] - hc[1], p[0])
                hole.append((0.034 * math.cos(th), hc[1] + 0.014 * math.sin(th)))
            with m.at(M):
                kit.holed_plate(m, outer, hole, -WALL, 0.0, Box(C["stave"], grain=1), c=0.003, skip_edges=(0,))
    return m


# ------------------------------------------------------------------ the hides

DPPM = 520
NL = 5  # hides in the stack
LT = 0.0525  # each folded hide's thickness
NP = 36


def hides_cells(A):
    return {
        "hair": A.cell("hides", 0.93, 0.73, DPPM, lambda w, h, p: pt.hide_hair(w, h, p, 701), "hides top"),
        "edge": A.cell("hides", 0.86, 0.36, DPPM, lambda w, h, p: pt.hide_edge(w, h, p, 702), "hides edges"),
        "cord": A.cell("hides", 0.50, 0.04, DPPM, lambda w, h, p: pt.hemp(w, h, p, 703, (0.50, 0.42, 0.30), lay=0.012), "hides cords"),
    }


def _outline(k, rng):
    """A folded hide's outline: an oblong with the shanks and neck folded in unevenly, ragged with hair at the edge
    (ccw in x, z)."""
    hx, hz = 0.42 - rng.uniform(0, 0.03), 0.31 - rng.uniform(0, 0.025)
    ph = rng.uniform(0, 2 * math.pi, 4)
    lobes = rng.uniform(0, 2 * math.pi, 2)
    pts = []
    for j in range(NP):
        a = 2 * math.pi * j / NP
        c, s = math.cos(a), math.sin(a)
        x = hx * math.copysign(abs(c) ** (2 / 3.6), c)
        z = hz * math.copysign(abs(s) ** (2 / 3.6), s)
        lob = sum(0.07 * math.exp(-((math.atan2(math.sin(a - L), math.cos(a - L))) / 0.22) ** 2) for L in lobes)
        k1 = 1 + 0.03 * math.sin(3 * a + ph[0]) + 0.02 * math.sin(5 * a + ph[1]) + lob + rng.uniform(-0.022, 0.022)
        pts.append((x * k1, z * k1))
    return pts


def hides(A):
    C = hides_cells(A)
    m = kit.Mesh("hides")
    rng = np.random.default_rng(71)
    tops = []
    outs = []
    for k in range(NL):
        ol = np.array(_outline(k, rng))
        ang = rng.uniform(-0.06, 0.06)
        dx, dz = rng.uniform(-0.02, 0.02), rng.uniform(-0.015, 0.015)
        ca, sa = math.cos(ang), math.sin(ang)
        outs.append(np.array([(x * ca - z * sa + dx, x * sa + z * ca + dz) for x, z in ol]))
    allp = np.concatenate(outs)
    lo, hi = allp.min(0), allp.max(0)
    sx, sz = 0.90 / (hi[0] - lo[0]), 0.672 / (hi[1] - lo[1])
    cx, cz = (lo + hi) / 2
    outs = [np.array([((x - cx) * sx, (z - cz) * sz) for x, z in ol]) for ol in outs]
    ths = [LT + rng.uniform(-0.007, 0.005) for _ in range(NL)]
    scale_y = (0.262 - 0.001 * NL) / sum(ths)
    ths = [t * scale_y for t in ths]
    with m.at(GM):
        y1 = 0.0
        for k in range(NL):
            ol = outs[k]
            y0 = y1 + (0.001 if k else 0.0)
            y1 = y0 + ths[k]
            ym = (y0 + y1) / 2
            ctr = ol.mean(0)
            rings = [(0.010, y0 + 0.001), (0.0025, y0 + 0.009), (0.0, ym), (0.0025, y1 - 0.009), (0.010, y1 - 0.001)]
            # the folded hide sags a little at the ends, lifts where the fold is (one long side)
            P = []
            for inset, y in rings:
                rr = kit.offset_radial(ol, inset, ctr)
                row = []
                for (x, z) in rr:
                    w = 0.005 * math.sin(x * 5.0 + k) + 0.004 * math.cos(z * 7.0 + 2 * k)
                    row.append((x, y + w * (0.4 if y < ym else 1.0) * (1 if k else 0.2), z))
                P.append(row)
            P = np.array(P)
            per = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.roll(ol, -1, 0) - ol, axis=1))])
            tl = [0.0]
            for i in range(1, len(rings)):
                tl.append(tl[-1] + float(np.mean(np.linalg.norm(P[i] - P[i - 1], axis=1))))
            ST = np.array([[(per[j], tl[i] + k * 0.066 + 0.002) for j in range(NP + 1)] for i in range(len(rings))])
            ids = kit.grid(m, P, ST, Param(C["edge"], wrap=0.80), closed=True,
                           outfn=lambda i, j, cc, ctr=ctr, ym=ym: np.array((cc[0] - ctr[0], (cc[1] - ym) * 2.0, cc[2] - ctr[1])), thr=60.0)
            kit.cap(m, ids[-1], P[-1], Planar(C["hair"], 1, (-0.465, 0.0, -0.365)), out=(0, 1.0, 0), shade=1.0 if k == NL - 1 else 0.5)
            tops.append(float(P[-1][:, 1].max()))
        # two cords round the stack, knotted on top
        ytop = tops[-1] + 0.0005
        r = 0.0045
        allo = np.concatenate(outs)
        for xc in (-0.215, 0.215):
            near = allo[np.abs(allo[:, 0] - xc) < 0.06]
            zmax = float(np.abs(near[:, 1]).max()) + 0.002
            path = [(0.0, 0.004), (zmax - 0.03, 0.004), (zmax + 0.002, 0.016), (zmax + 0.006, 0.05), (zmax + 0.007, ytop - 0.05),
                    (zmax + 0.002, ytop - 0.012), (zmax - 0.03, ytop + r), (0.0, ytop + r)]
            path = path + [(-z, y) for z, y in path[::-1][1:-1]]
            pts = [(xc + 0.004 * math.sin(7 * z), y, z) for z, y in path]
            kit.sweep(m, pts, r, 6, Param(C["cord"], wrap=0.15), closed=True, up=(1.0, 0, 0), thr=60.0)
            kc = np.array((xc, ytop + 0.010, 0.05))
            K = []
            for i in range(5):
                th = math.pi * i / 4
                K.append([kc + np.array((0.016 * math.sin(th) * math.cos(2 * math.pi * j / 8), -0.008 * math.cos(th),
                                         0.020 * math.sin(th) * math.sin(2 * math.pi * j / 8))) for j in range(8)])
            KST = np.array([[(0.06 * j / 8, 0.02 * i / 4) for j in range(9)] for i in range(5)])
            kit.grid(m, np.array(K), KST, Param(C["cord"]), closed=True, outfn=lambda i, j, cc, kc=kc: cc - kc, thr=70.0)
            # the loose ends
            for sgn in (-1, 1):
                end = [kc + np.array((sgn * 0.01, 0.002, 0.012)), kc + np.array((sgn * 0.035, -0.004, 0.04)),
                       kc + np.array((sgn * 0.05, -0.008, 0.07))]
                end = [(p[0], max(p[1], ytop + r), p[2]) for p in end]
                kit.sweep(m, end, [r * 0.9, r * 0.85, r * 0.6], 5, Param(C["cord"], off=(0.3, 0.0)), up=(0, 1.0, 0), thr=70.0,
                          caps=(False, True))
    return m


# ------------------------------------------------------------------ the parcel

PPPM = 560
PX, PY, PZ = 0.225, 0.150, 0.175  # half sizes
PR = 0.014  # the paper's rounded corners


def parcel_cells(A):
    def end_tex(w, h, ppm):
        # the folded end, seen from outside: u is the parcel's height (0 at the bottom), v its depth. The side flaps
        # folded in leave creases from the corners; the bottom flap folded up, the top flap down over it.
        img = pt.kraft(w, h, ppm, 802)
        X, Y = pt.coords(w, h, ppm)
        H, D = 2 * PY, 2 * PZ
        mid = np.array((H * 0.52, D / 2))

        def seg(p, q):
            p, q = np.asarray(p), np.asarray(q)
            d = q - p
            t = np.clip(((X - p[0]) * d[0] + (Y - p[1]) * d[1]) / (d @ d), 0, 1)
            return np.hypot(X - p[0] - t * d[0], Y - p[1] - t * d[1])

        a, b = np.array((H * 0.52, D * 0.18)), np.array((H * 0.52, D * 0.82))
        for p, q, k in (((0, 0), a, 0.72), ((0, D), b, 0.72), ((H, 0), a, 0.78), ((H, D), b, 0.78), (a, b, 0.6)):
            dd = seg(p, q)
            img[dd < 0.0011] *= k
            img[(dd >= 0.0011) & (dd < 0.0024)] *= 1.08
        # the top flap's shadowed lip above its edge
        img[(X > H * 0.52) & (X < H * 0.52 + 0.006) & (Y > D * 0.18) & (Y < D * 0.82)] *= 0.9
        return img

    def label_tex(w, h, ppm):
        img = np.ones((h, w, 3), np.float32) * np.array((0.86, 0.82, 0.70))
        img *= (0.92 + 0.08 * pt.fbm(h, w, 0.01 * ppm, 0.01 * ppm, 811, 3))[..., None]
        X, Y = pt.coords(w, h, ppm)
        b = (np.minimum(np.minimum(X, X.max() - X), np.minimum(Y, Y.max() - Y)) < 0.004) & \
            (np.minimum(np.minimum(X, X.max() - X), np.minimum(Y, Y.max() - Y)) > 0.0025)
        img[b] = (0.55, 0.14, 0.10)
        pt.scribble(img, 0.008 * ppm, 0.010 * ppm, X.max() * ppm - 0.008 * ppm, Y.max() * ppm - 0.008 * ppm, 3, seed=812,
                    px=ppm / 600)
        return img

    return {
        "paper": A.cell("parcel", 2 * PX + 0.01, 2 * PZ + 0.01, PPPM, lambda w, h, p: pt.kraft(w, h, p, 801), "parcel paper"),
        "end": A.cell("parcel", 2 * PY + 0.01, 2 * PZ + 0.01, PPPM, end_tex, "parcel ends"),
        "string": A.cell("parcel", 0.42, 0.02, PPPM, lambda w, h, p: pt.string(w, h, p, 821), "parcel string"),
        "label": A.cell("parcel", 0.09, 0.06, PPPM, label_tex, "parcel label"),
    }


def _surface(q):
    """A point of the parcel's box (on its faces) onto the rounded, slightly swollen paper, and its normal."""
    h = np.array((PX, PY, PZ))
    inner = h - PR
    c = np.clip(q, -inner, inner)
    d = q - c
    n = d / (np.linalg.norm(d) or 1.0)
    p = c + n * PR
    # the paper bulges over the goods in the middle of each face (not underneath)
    f = np.clip(1 - (np.abs(q) / h) ** 2, 0, 1)
    for ax in range(3):
        if abs(abs(q[ax]) - h[ax]) < 1e-9 and not (ax == 1 and q[1] < 0):
            o = [k for k in range(3) if k != ax]
            p[ax] += math.copysign(0.004 * f[o[0]] * f[o[1]], q[ax])
    p[1] += PY
    return p, n


def parcel(A):
    C = parcel_cells(A)
    m = kit.Mesh("parcel")
    h = np.array((PX, PY, PZ))
    lists = [np.array([-PX, -PX + 0.4 * PR, -PX + PR, 0.0, PX - PR, PX - 0.4 * PR, PX]),
             np.array([-PY, -PY + 0.4 * PR, -PY + PR, PY - PR, PY - 0.4 * PR, PY]),
             np.array([-PZ, -PZ + 0.4 * PR, -PZ + PR, 0.0, PZ - PR, PZ - 0.4 * PR, PZ])]
    vid = {}
    paper = Box(C["paper"], cells={0: C["end"]})
    with m.at(GM):
        sk = paper.bind((-PX, 0.0, -PZ), (PX, 2 * PY, PZ))
        for ax in range(3):
            o = [k for k in range(3) if k != ax]
            for sg in (-1, 1):
                L0, L1 = lists[o[0]], lists[o[1]]
                for i in range(len(L0) - 1):
                    for j in range(len(L1) - 1):
                        quad = []
                        for a, b in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                            q = np.zeros(3)
                            q[ax] = sg * h[ax]
                            q[o[0]] = L0[a]
                            q[o[1]] = L1[b]
                            key = tuple(np.round(q, 6))
                            if key not in vid:
                                p, _ = _surface(q)
                                vid[key] = (m.vid(p), p)
                            quad.append(vid[key])
                        out = np.zeros(3)
                        out[ax] = sg
                        m.face([v[0] for v in quad], [v[1] for v in quad], sk, out=out, thr=50.0)
        # the string, twice round crosswise, sitting on the paper
        r = 0.0016

        def loop(axis_free, n=14):
            pts = []
            # a loop in the plane where coordinate axis_free is 0, round the box's section in the other two axes
            o = [k for k in range(3) if k != axis_free]
            a, b = h[o[0]], h[o[1]]
            for k in range(n):
                t = 2 * math.pi * (k + 0.5) / n
                ca, sa = math.cos(t), math.sin(t)
                q = np.zeros(3)
                s = max(abs(ca) / a, abs(sa) / b)
                q[o[0]], q[o[1]] = ca / s, sa / s
                p, nrm = _surface(q)
                p = p + nrm * (r * 0.6)
                p[1] = max(p[1], r + 0.0002)
                pts.append(p)
            return pts

        for ax in (0, 2):
            kit.sweep(m, loop(ax), r, 4, Param(C["string"], wrap=0.28), closed=True, thr=70.0, a0=math.pi / 4)
        top = _surface(np.array((0.0, PY, 0.0)))[0]
        kc = top + np.array((0.0, 0.005, 0.0))
        K = []
        for i in range(4):
            th = math.pi * i / 3
            K.append([kc + np.array((0.008 * math.sin(th) * math.cos(2 * math.pi * j / 6), -0.004 * math.cos(th),
                                     0.007 * math.sin(th) * math.sin(2 * math.pi * j / 6))) for j in range(6)])
        KST = np.array([[(0.03 * j / 6, 0.01 * i / 3) for j in range(7)] for i in range(4)])
        kit.grid(m, np.array(K), KST, Param(C["string"]), closed=True, outfn=lambda i, j, cc: cc - kc, thr=70.0)
        for sgn in (-1, 1):
            end = [kc + np.array((sgn * 0.004, 0.0, 0.003)), kc + np.array((sgn * 0.02, -0.003, 0.02)),
                   kc + np.array((sgn * 0.03, -0.004, 0.045))]
            kit.sweep(m, end, r, 4, Param(C["string"], off=(0.2, 0.0)), up=(0, 1.0, 0), thr=70.0, caps=(False, True))
        # the paper label on the top, near a corner, lying on the swollen paper
        lx, lz, lw, ld = 0.11, 0.085, 0.09, 0.06
        Lp, Lst = [], []
        for i in range(3):
            row, srow = [], []
            for j in range(3):
                x = lx - lw / 2 + lw * j / 2
                z = lz - ld / 2 + ld * i / 2
                p = _surface(np.array((x, PY, z)))[0] + np.array((0, 0.0006, 0))
                row.append(p)
                srow.append((lw * j / 2, ld * i / 2))
            Lp.append(row)
            Lst.append(srow)
        kit.grid(m, np.array(Lp), np.array(Lst), Param(C["label"]), outfn=lambda i, j, cc: np.array((0, 1.0, 0)), thr=40.0)
    return m


# ------------------------------------------------------------------ the open ledger

LPPM = 800
PW, PL = 0.22, 0.30  # a page's width (x) and length (z)
SPINE_X = 0.115
BOARD_T = 0.004
BLOCK_H = 0.029  # the page block's top at the fore-edge (board and pages: about 3 cm a half)
GUTTER_H = 0.011


def _page_h(x):
    """The open page's height above the table across the right page (x from -0.11 to the spine): flat at the
    fore-edge, swelling a little, then curving down into the gutter."""
    t = (x + PW / 2) / (SPINE_X - 0.003 + PW / 2)  # 0 at the fore-edge, 1 at the gutter
    t = min(max(t, 0.0), 1.0)
    swell = 0.0025 * math.sin(math.pi * min(1.0, t / 0.8))
    drop = (BLOCK_H - GUTTER_H) * pt.sm(0.55, 1.0, t) ** 1.6
    return float(BLOCK_H + swell - drop)


def _hand(img, x0, x1, yb, ppm, rng, ink, height=0.0018):
    """A line of handwriting from x0 to x1 (pixels) on the baseline yb: joined loops in words, a few tall letters."""
    H, W = img.shape[:2]
    x = x0
    xh = height * ppm
    while x < x1:
        wl = rng.uniform(0.008, 0.026) * ppm
        xe = min(x1, x + wl)
        ph = rng.uniform(0, 6.3)
        tall = 0.0
        for xx in np.arange(x, xe, 0.3):
            k = (xx - x) / (0.0026 * ppm)
            if rng.random() < 0.012:
                tall = 1.0
            tall *= 0.93
            yy = yb - xh * (0.5 + 0.5 * math.sin(k * 2 * math.pi + ph)) * (1 + 1.3 * tall)
            xi, yi = int(xx + 0.4 * (yb - yy) / max(1.0, xh)), int(round(yy))
            if 0 <= xi < W and 0 <= yi < H:
                a = 0.62 * rng.uniform(0.6, 1.0)
                img[yi, xi] = img[yi, xi] * (1 - a) + np.asarray(ink) * a
        x = xe + rng.uniform(0.003, 0.006) * ppm


def ledger_cells(A):
    def pages_tex(w, h, ppm):
        # painted the right way up (left page on the left, tops at row 0), then turned half round: on the model the
        # tops lie toward +z and the lines read toward -x
        rng = pt.rng_(901)
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.86, 0.81, 0.67))
        img *= (0.93 + 0.08 * pt.fbm(h, w, 0.04 * ppm, 0.04 * ppm, 902, 4))[..., None]
        fox = pt.sm(0.78, 0.9, pt.fbm(h, w, 0.012 * ppm, 0.012 * ppm, 903, 3))
        pt.mix(img, fox * 0.35, (0.62, 0.48, 0.30))
        gut = w / 2
        # darker toward the gutter and the thumbed lower corners
        img *= (1 - 0.18 * pt.sm(0.03, 0.0, np.abs(X - gut / ppm)))[..., None]
        ruling = 0.0072
        blue = np.array((0.50, 0.58, 0.68))
        red = np.array((0.62, 0.16, 0.12))
        for page in (0, 1):
            px0 = page * gut
            # ruled lines from below the head down to the foot
            for yy in np.arange(0.040, PL - 0.012, ruling):
                r = int(yy * ppm)
                img[r, int(px0 + 0.006 * ppm):int(px0 + gut - 0.006 * ppm)] = \
                    img[r, int(px0 + 0.006 * ppm):int(px0 + gut - 0.006 * ppm)] * 0.55 + blue * 0.45
            # red margins: a double line at the left, money columns at the right (pounds, shillings, pence)
            cols = [0.022, 0.025, 0.150, 0.175, 0.193, 0.212]
            for cx in cols:
                c = int(px0 + cx * ppm)
                img[int(0.030 * ppm):int((PL - 0.012) * ppm), c] = red
            img[int(0.034 * ppm), int(px0 + 0.006 * ppm):int(px0 + gut - 0.006 * ppm)] = red
            # the head: a date and a name written large
            ink = np.array((0.30, 0.17, 0.07)) if page == 0 else np.array((0.14, 0.10, 0.08))
            _hand(img, px0 + 0.035 * ppm, px0 + 0.12 * ppm, 0.024 * ppm, ppm, rng, ink, 0.0028)
            # entries: most lines written, figures in the money columns, a total ruled off near the foot
            n = int((PL - 0.052) / ruling)
            for k in range(n):
                yb = (0.040 + ruling * (k + 1) - 0.0012) * ppm
                if rng.random() < 0.88:
                    _hand(img, px0 + 0.029 * ppm, px0 + rng.uniform(0.07, 0.145) * ppm, yb, ppm, rng, ink)
                    for a, b in ((0.152, 0.172), (0.177, 0.19), (0.195, 0.209)):
                        if rng.random() < 0.85:
                            _hand(img, px0 + (a + 0.002) * ppm, px0 + (b - rng.uniform(0.0, 0.006)) * ppm, yb, ppm, rng, ink)
            yt = int((0.040 + ruling * (n - 2)) * ppm)
            img[yt - 1:yt + 1, int(px0 + 0.150 * ppm):int(px0 + 0.212 * ppm)] = ink
        return np.ascontiguousarray(img[::-1, ::-1])

    def edge_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        leaves = 0.5 + 0.5 * np.sin(Y / 0.00045 * math.pi)
        img = np.ones((h, w, 3), np.float32) * np.array((0.80, 0.74, 0.60))
        img *= (0.82 + 0.12 * leaves + 0.1 * pt.fbm(h, w, 0.05 * ppm, 0.002 * ppm, 911, 3))[..., None]
        # the edges sprinkled red, as account books were
        pt.mix(img, pt.sm(0.5, 0.75, pt.fbm(h, w, 2.0, 2.0, 912, 2)) * 0.35, (0.58, 0.24, 0.16))
        return img

    def cover_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        # marbled paper: swirled bands of blue, red-brown and cream
        warp = pt.fbm(h, w, 0.04 * ppm, 0.04 * ppm, 921, 4)
        band = np.sin((X * 40 + Y * 25 + warp * 9.0))
        img = np.where((band > 0.4)[..., None], np.array((0.20, 0.26, 0.42)), np.where((band < -0.5)[..., None],
                       np.array((0.48, 0.22, 0.14)), np.array((0.72, 0.66, 0.52)))).astype(np.float32)
        img *= (0.85 + 0.2 * pt.fbm(h, w, 0.005 * ppm, 0.005 * ppm, 922, 2))[..., None]
        # brown leather corners and the leather along both long sides (the spine side and the binding)
        lea = np.array((0.30, 0.17, 0.08)) * (0.85 + 0.25 * pt.fbm(h, w, 0.004 * ppm, 0.004 * ppm, 923, 2))[..., None]
        W, H = X.max(), Y.max()
        u, v = np.minimum(X, W - X), np.minimum(Y, H - Y)
        corner = (u + v) < 0.055
        side = u < 0.035
        m = corner | side
        img[m] = lea[m]
        return img

    return {
        "pages": A.cell("ledger", 2 * SPINE_X + PW, PL, LPPM, pages_tex, "ledger pages"),
        "cover": A.cell("ledger", 0.24, 0.32, 480, cover_tex, "ledger boards"),
        "edge": A.cell("ledger", 0.47, 0.035, LPPM, edge_tex, "ledger page edges"),
        "ribbon": A.cell("ledger", 0.30, 0.008, LPPM, lambda w, h, p: (np.ones((h, w, 3)) * np.array((0.50, 0.10, 0.09)) *
                         (0.8 + 0.3 * np.sin(np.arange(h)[:, None, None] / max(1, h - 1) * math.pi))).astype(np.float32),
                         "ledger ribbon"),
    }


def ledger(A):
    C = ledger_cells(A)
    m = kit.Mesh("ledger_open")
    nx, nz = 16, 8
    x0 = -PW / 2
    xs_r = np.linspace(x0, SPINE_X - 0.003, nx + 1)
    zs = np.linspace(-PL / 2, PL / 2, nz + 1)
    pages = Planar(C["pages"], 1, (x0, 0.0, -PL / 2))
    edge = Box(C["edge"], grain=2)
    with m.at(GM):
        for side in (0, 1):
            # the right page (side 0) and its mirror, the left page, round the spine
            xs = xs_r if side == 0 else (2 * SPINE_X - xs_r)[::-1]
            hx = [_page_h(x if side == 0 else 2 * SPINE_X - x) for x in xs]
            P = np.array([[(x, hx[j] + 0.0006 * math.sin(z * 21 + j * 0.3 + side), z) for j, x in enumerate(xs)] for z in zs])
            ST = np.zeros((nz + 1, nx + 1, 2))
            kit.grid(m, P, ST, pages, outfn=lambda i, j, c: np.array((0, 1.0, 0)), thr=40.0)
            # the page block's edges: the fore-edge and the head and foot following the curve
            fx = xs[0] if side == 0 else xs[-1]
            fj = 0 if side == 0 else nx
            for i in range(nz):
                a, b = P[i, fj], P[i + 1, fj]
                q = [(fx, BOARD_T, a[2]), (fx, BOARD_T, b[2]), tuple(b), tuple(a)]
                ids = [m.vid(p) for p in q]
                m.face(ids, [np.array(p) for p in q], edge.bind((fx - 0.01, 0, -PL / 2), (fx + 0.01, BLOCK_H + 0.003, PL / 2)),
                       out=np.array((-1.0 if side == 0 else 1.0, 0, 0)), thr=30.0)
            for i, sg in ((0, -1.0), (nz, 1.0)):
                for j in range(nx):
                    a, b = P[i, j], P[i, j + 1]
                    q = [(a[0], BOARD_T, a[2]), (b[0], BOARD_T, b[2]), tuple(b), tuple(a)]
                    ids = [m.vid(p) for p in q]
                    m.face(ids, [np.array(p) for p in q], edge.bind((x0, 0, -PL / 2), (x0 + 0.47, BLOCK_H + 0.003, PL / 2)),
                           out=np.array((0, 0, sg)), thr=30.0)
            # the board under each half: marbled paper, leather corners, 4 mm proud of the pages
            bx = (x0 - 0.004, SPINE_X - 0.002) if side == 0 else (SPINE_X + 0.002, 2 * SPINE_X - x0 + 0.004)
            kit.cbox(m, (bx[0], 0.0, -PL / 2 - 0.004), (bx[1], BOARD_T, PL / 2 + 0.004), Box(C["cover"]), c=0.0012,
                     skip=((1, -1),))
        # the gutter: the two pages meeting, in shadow
        gx0, gx1 = SPINE_X - 0.003, SPINE_X + 0.003
        q = [(gx0, _page_h(gx0), -PL / 2), (gx0, _page_h(gx0), PL / 2), (SPINE_X, GUTTER_H - 0.004, PL / 2), (SPINE_X, GUTTER_H - 0.004, -PL / 2)]
        for qq, o in ((q, (1.0, 1.0, 0)), ([(2 * SPINE_X - p[0], p[1], p[2]) for p in q], (-1.0, 1.0, 0))):
            ids = [m.vid(p) for p in qq]
            m.face(ids, [np.array(p) for p in qq], Flat(C["cover"], 0.03, 0.03), out=np.array(o), shade=0.3, thr=30.0)
        # the leather back of the spine between the boards
        kit.cbox(m, (SPINE_X - 0.006, 0.0, -PL / 2 - 0.004), (SPINE_X + 0.006, 0.006, PL / 2 + 0.004),
                 Box(C["cover"], off=(0.0, 0.0)), c=0.002, skip=((1, -1),), shade=0.8)
        # the ribbon marker: out of the gutter at the head, down the right page, over the foot and onto the table
        rx = SPINE_X - 0.012
        hy = _page_h(rx)
        path = [(PL / 2 - 0.002, hy + 0.0004), (0.05, hy + 0.0004), (-0.08, hy + 0.0005), (-PL / 2 + 0.003, hy + 0.0003),
                (-PL / 2 - 0.006, hy - 0.006), (-PL / 2 - 0.012, BOARD_T - 0.001), (-PL / 2 - 0.016, 0.0006),
                (-PL / 2 - 0.045, 0.0006)]
        from .luggage import ribbon
        ribbon(m, path, 0.0065, 0.0004, Param(C["ribbon"], wrap=0.14), center=(0.0, -0.2), closed=False, axis_x=rx)
    return m
