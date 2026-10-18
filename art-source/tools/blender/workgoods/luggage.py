"""An emigrant's luggage: a canvas-covered travelling trunk, a big knotted cloth bundle, a rolled featherbed and a
lidded wicker hamper. Written in game axes (y up, front toward +z) and turned into Blender axes by GM; each model's
origin is the middle of its base."""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param, Planar

GM = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game (x, y, z) -> Blender (x, -z, y)
AX = Matrix(((0, 0, 1, 0), (1, 0, 0, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # a lathe's local z along game +x
AY = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # a lathe's local z along game +y
AZ = Matrix.Identity(4)  # local z along game z


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def ribbon(m, path, width, thick, skin, center=None, closed=True, out2d=None, shade=1.0, axis_x=0.0):
    """A strap: a flat band of `width` (along game x, centred on axis_x) and `thick`, its inner face on a path of
    (z, y) points in the plane x = axis_x. Its outward side points away from `center` (z, y)."""
    P2 = np.asarray(path, float)
    n = len(P2)
    c = np.asarray(center if center is not None else P2.mean(0), float)
    rows, ST = [], []
    s = 0.0
    tang = []
    for i in range(n):
        a = P2[(i - 1) % n] if (closed or i > 0) else P2[i]
        b = P2[(i + 1) % n] if (closed or i < n - 1) else P2[i]
        t = b - a
        t /= np.linalg.norm(t)
        nn = np.array((t[1], -t[0]))
        if np.dot(nn, P2[i] - c) < 0:
            nn = -nn
        tang.append(nn)
    for i in range(n):
        if i > 0:
            s += float(np.linalg.norm(P2[i] - P2[i - 1]))
        z, y = P2[i]
        nz, ny = tang[i]
        hw = width / 2
        rows.append([(axis_x - hw, y, z), (axis_x + hw, y, z), (axis_x + hw, y + ny * thick, z + nz * thick),
                     (axis_x - hw, y + ny * thick, z + nz * thick)])
        ST.append([(s, 0.0), (s, width), (s, width), (s, 0.0), (s, 0.0)])
    if closed:
        s += float(np.linalg.norm(P2[0] - P2[-1]))
        ST.append([(s, 0.0), (s, width), (s, width), (s, 0.0), (s, 0.0)])
    P = np.array(rows)

    def outfn(i, j, cc):
        nz, ny = tang[i]
        nrm = np.array((0.0, ny, nz))
        return [-nrm, np.array((1.0, 0, 0)), nrm, np.array((-1.0, 0, 0))][j]

    kit.grid(m, P, np.array(ST), skin, closed=True, closed_rows=closed, outfn=outfn, shade=shade, thr=40.0)


def rrect(cx, cy, w, h, r, k=2):
    """A rounded rectangle (ccw) with k+1 points per corner."""
    pts = []
    for qx, qy, a0 in ((w / 2 - r, -h / 2 + r, -90), (w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180)):
        for j in range(k + 1):
            a = math.radians(a0 + 90 * j / k)
            pts.append((cx + qx + r * math.cos(a), cy + qy + r * math.sin(a)))
    return pts


def buckle(m, M, w, h, r_tube, skin):
    """A rounded buckle frame with its middle bar, lying in the local x-y plane of M."""
    with m.at(M):
        pts = rrect(0.0, 0.0, w, h, min(w, h) * 0.22, 1)
        kit.sweep(m, [(x, y, 0.0) for x, y in pts], r_tube, 6, skin, closed=True, up=(0, 0, 1.0), thr=60.0)
        kit.sweep(m, [(0.0, -h / 2, 0.0), (0.0, h / 2, 0.0)], r_tube * 0.9, 6, skin, thr=60.0)


# ------------------------------------------------------------------ the trunk

TPPM = 560
HX, HZ = 0.430, 0.235  # the canvas body's half length and half depth
YB, YL0, YL1 = 0.372, 0.376, 0.486  # body top, lid bottom, lid top
TB, WB = 0.012, 0.050  # batten thickness and width
STRAP_X = 0.30


def trunk_cells(A):
    green = (0.12, 0.20, 0.14)

    def front_tex(w, h, ppm):
        img = pt.paint_canvas(w, h, ppm, 201, green, wear=0.4)
        cream = (0.80, 0.76, 0.63)
        unit = 0.0060 * ppm
        cx = HX * ppm
        pt.stencil(img, "J. JANSSENS", cx, (YB - 0.240) * ppm, unit, cream, 0.92, 202, 0.12)
        pt.stencil(img, "NEW YORK", cx, (YB - 0.158) * ppm, unit, cream, 0.92, 203, 0.12)
        return img

    def batten_tex(w, h, ppm):
        img = pt.wood(w, h, ppm, (0.46, 0.31, 0.17), 211, oak=True, knots=2, ring_mm=3.0)
        X, Y = pt.coords(w, h, ppm)
        # nail heads every 10 cm along the battens
        for xx in np.arange(0.03, X.max(), 0.10):
            for yy in (0.012, 0.038):
                d = np.hypot(X - xx, Y - yy)
                img[d < 0.0028] = (0.07, 0.065, 0.06)
                img[(d >= 0.0028) & (d < 0.0038)] *= 0.7
        return img

    def lock_tex(w, h, ppm):
        img = pt.iron(w, h, ppm, 221, rgb=(0.06, 0.058, 0.055), rust=0.25)
        X, Y = pt.coords(w, h, ppm)
        cx, cy = X.max() / 2, Y.max() * 0.62
        key = (np.hypot(X - cx, Y - cy) < 0.0045) | ((np.abs(X - cx) < 0.0018) & (Y > cy) & (Y < cy + 0.012))
        img[key] = (0.01, 0.01, 0.01)
        ring = (np.hypot(X - cx, Y - cy) > 0.007) & (np.hypot(X - cx, Y - cy) < 0.010)
        img[ring] *= 1.6
        for sx in (0.008, X.max() - 0.008):
            for sy in (0.008, Y.max() - 0.008):
                d = np.hypot(X - sx, Y - sy)
                img[d < 0.0028] = (0.16, 0.15, 0.14)
                img[(np.abs(Y - sy) < 0.0006) & (d < 0.0028)] = (0.03, 0.03, 0.03)
        return img

    return {
        "front": A.cell("trunk", 2 * HX, YB, TPPM, front_tex, "trunk front"),
        "plain": A.cell("trunk", 2 * HX + 0.01, 2 * HZ + 0.01, TPPM, lambda w, h, p: pt.paint_canvas(w, h, p, 205, green, 0.35),
                        "trunk canvas"),
        "batten": A.cell("trunk", 0.90, 0.10, TPPM, batten_tex, "trunk battens"),
        "leather": A.cell("trunk", 0.86, 0.042, TPPM, lambda w, h, p: pt.leather(w, h, p, 231, (0.30, 0.17, 0.08)),
                          "trunk straps"),
        "iron": A.cell("trunk", 0.22, 0.22, TPPM, lambda w, h, p: pt.iron(w, h, p, 241, rgb=(0.06, 0.058, 0.055), rust=0.3),
                       "trunk iron"),
        "lock": A.cell("trunk", 0.10, 0.075, TPPM, lock_tex, "trunk lock"),
        "brass": A.cell("trunk", 0.08, 0.08, TPPM, lambda w, h, p: pt.brass(w, h, p, 251, (0.55, 0.43, 0.20)), "trunk brass"),
    }


def _nail(m, p, normal, skin, r=0.0042):
    """A domed nail head on a face; normal is one of the game axes (as a tuple)."""
    ax = int(np.argmax(np.abs(normal)))
    sg = 1 if normal[ax] > 0 else -1
    R = {0: AX if sg > 0 else Matrix(((0, 0, -1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1))),
         1: AY if sg > 0 else Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1))),
         2: AZ if sg > 0 else Matrix(((1, 0, 0, 0), (0, -1, 0, 0), (0, 0, -1, 0), (0, 0, 0, 1)))}[ax]
    with m.at(T(*p) @ R):
        kit.lathe(m, [(r, -0.0005), (r * 0.8, 0.0012), (0.0, 0.0022)], 6, skin, thr=70.0)


def trunk(A):
    C = trunk_cells(A)
    m = kit.Mesh("trunk")
    rng = np.random.default_rng(3)
    iron = Box(C["iron"], rng=rng)
    plain = Box(C["plain"])
    with m.at(GM):
        front = Planar(C["front"], 2, (-HX, 0.0, 0.0), flip_v=True, hi=(HX, YB, HZ))
        kit.cbox(m, (-HX, 0.0, -HZ), (HX, YB, HZ), plain, c=0.006, skip=((1, -1),), shades={(1, 1): 0.25},
                 face_skins={(2, 1): front})
        kit.cbox(m, (-HX, YL0, -HZ), (HX, YL1, HZ), plain, c=0.006, shades={(1, -1): 0.25})

        def bat(lo, hi, grain, skip):
            kit.cbox(m, lo, hi, Box(C["batten"], grain=grain, rng=rng), c=0.003, skip=(skip,))

        # bands round the body (bottom, top) and the lid; the front's top and lid bands open for the lock and hasp
        for y0, y1, gaps, ends in ((0.015, 0.065, None, True), (0.31, 0.36, 0.062, False), (0.39, 0.44, 0.030, True)):
            for sz in (-1, 1):
                z0, z1 = (HZ, HZ + TB) if sz > 0 else (-HZ - TB, -HZ)
                if gaps is not None and sz > 0:
                    bat((-0.365, y0, z0), (-gaps, y1, z1), 0, (2, -1))
                    bat((gaps, y0, z0), (0.365, y1, z1), 0, (2, -1))
                else:
                    bat((-0.365, y0, z0), (0.365, y1, z1), 0, (2, -sz))
            if ends:
                for sx in (-1, 1):
                    x0, x1 = (HX, HX + TB) if sx > 0 else (-HX - TB, -HX)
                    bat((x0, y0, -0.165), (x1, y1, 0.165), 2, (0, -sx))
        # upright battens on the front and back, two across the lid
        for sz in (-1, 1):
            z0, z1 = (HZ, HZ + TB) if sz > 0 else (-HZ - TB, -HZ)
            for xc in (-0.22, 0.22):
                bat((xc - WB / 2, 0.065, z0), (xc + WB / 2, 0.31, z1), 1, (2, -sz))
        for xc in (-0.22, 0.22):
            bat((xc - WB / 2, YL1, -0.215), (xc + WB / 2, YL1 + TB, 0.215), 2, (1, -1))
        # iron corner caps, nailed, on the four bottom and four top corners
        S, t = 0.07, 0.003
        for sx in (-1, 1):
            for sz in (-1, 1):
                for top in (False, True):
                    ya, yb = (YL1 - S, YL1) if top else (0.0, S)
                    xs = sorted((sx * (HX - S), sx * HX))
                    zs = sorted((sz * HZ, sz * (HZ + t)))
                    kit.cbox(m, (xs[0], ya, zs[0]), (xs[1], yb, zs[1]), iron, c=0.001)
                    _nail(m, (sx * (HX - 0.03), (ya + yb) / 2, sz * (HZ + t)), (0, 0, sz), iron)
                    xs = sorted((sx * HX, sx * (HX + t)))
                    zs = sorted((sz * (HZ - S), sz * (HZ + t)))
                    kit.cbox(m, (xs[0], ya, zs[0]), (xs[1], yb, zs[1]), iron, c=0.001)
                    _nail(m, (sx * (HX + t), (ya + yb) / 2, sz * (HZ - 0.03)), (sx, 0, 0), iron)
                    if top:
                        xs = sorted((sx * (HX - S), sx * (HX + t)))
                        zs = sorted((sz * (HZ - S), sz * (HZ + t)))
                        kit.cbox(m, (xs[0], YL1, zs[0]), (xs[1], YL1 + t, zs[1]), iron, c=0.001)
                        _nail(m, (sx * (HX - 0.03), YL1 + t, sz * (HZ - 0.03)), (0, 1, 0), iron)
        # the lock plate on the front, the hasp hinged from the lid over it
        kit.cbox(m, (-0.05, 0.288, HZ), (0.05, 0.363, HZ + 0.004), Planar(C["lock"], 2, (-0.05, 0.288, 0), flip_v=True,
                 hi=(0.05, 0.363, 0)), c=0.0015, skip=((2, -1),))
        kit.cbox(m, (-0.022, 0.392, HZ), (0.022, 0.44, HZ + 0.004), iron, c=0.0012, skip=((2, -1),))
        kit.cbox(m, (-0.019, 0.318, HZ + 0.004), (0.019, 0.384, HZ + 0.008), iron, c=0.0012)
        with m.at(T(-0.022, 0.387, HZ + 0.006) @ AX):
            kit.lathe(m, [(0.0, 0.0), (0.0048, 0.0), (0.0055, 0.002), (0.0055, 0.042), (0.0048, 0.044), (0.0, 0.044)], 8, iron, thr=50.0)
        # bail handles at the ends: two eyes on plates, an iron bail hanging between them
        for sx in (-1, 1):
            xp = sx * (HX + 0.003)
            for zc in (-0.075, 0.075):
                xs = sorted((sx * HX, xp))
                kit.cbox(m, (xs[0], 0.300, zc - 0.018), (xs[1], 0.352, zc + 0.018), iron, c=0.001)
                _nail(m, (xp, 0.309, zc), (sx, 0, 0), iron, 0.0035)
                with m.at(T(sx * (HX + 0.003 + 0.0075), 0.332, zc - 0.012)):
                    kit.lathe(m, [(0.0, 0.0), (0.0065, 0.0), (0.0075, 0.002), (0.0075, 0.022), (0.0065, 0.024), (0.0, 0.024)], 8,
                              iron, thr=50.0)
            xb = sx * (HX + 0.003 + 0.0075)
            bail = [(-0.084, 0.332), (-0.066, 0.332), (-0.059, 0.322), (-0.057, 0.296), (-0.047, 0.272), (-0.022, 0.262),
                    (0.022, 0.262), (0.047, 0.272), (0.057, 0.296), (0.059, 0.322), (0.066, 0.332), (0.084, 0.332)]
            kit.sweep(m, [(xb, y, z) for z, y in bail], 0.0055, 6, iron, thr=60.0, caps=(True, True))
        # two leather straps round it, riding on the battens, buckled on the front
        zf = HZ + TB + 0.0006
        path = [(0.0, 0.0040), (HZ - 0.03, 0.0040), (HZ + 0.006, 0.008), (zf, 0.016), (zf, 0.44), (HZ + 0.003, YL1 - 0.004),
                (HZ - 0.014, YL1 + 0.0006), (0.0, YL1 + 0.0006)]
        path = path + [(-z, y) for z, y in path[::-1][1:-1]]
        for xs in (-STRAP_X, STRAP_X):
            ribbon(m, path, 0.040, 0.0035, Param(C["leather"], wrap=0.40), center=(0.0, 0.25), axis_x=xs)
            # the buckle on the front and the strap's end through it
            zb = zf + 0.0035
            buckle(m, T(xs, 0.215, zb + 0.0024), 0.050, 0.040, 0.0022, Box(C["brass"]))
            kit.cbox(m, (xs - 0.019, 0.105, zb), (xs + 0.019, 0.236, zb + 0.0035), Box(C["leather"], grain=1), c=0.0012,
                     skip=((2, -1),))
    return m


# ------------------------------------------------------------------ the bundle

BPPM = 500


def bundle_cells(A):
    def cloth(w, h, ppm):
        img = pt.check_linen(w, h, ppm, 301, bg=(0.80, 0.76, 0.66), ink=(0.17, 0.25, 0.47), size=0.03, line=(0.55, 0.16, 0.12))
        # dirt and handling stains low down (the cell's lower rows are the bundle's bottom)
        X, Y = pt.coords(w, h, ppm)
        img *= (1 - 0.18 * pt.sm(0.25, 0.0, Y))[..., None]
        return img

    return {"cloth": A.cell("bundle", 0.98, 0.92, BPPM, cloth, "bundle cloth")}


def bundle(A):
    C = bundle_cells(A)
    m = kit.Mesh("bundle")
    a, b = 0.386, 0.214
    prof = [(0.0, 0.0), (0.50, 0.0), (0.80, 0.005), (0.93, 0.028), (0.985, 0.065), (1.0, 0.115), (0.99, 0.17), (0.955, 0.225),
            (0.88, 0.285), (0.76, 0.34), (0.60, 0.383), (0.43, 0.414), (0.28, 0.437), (0.17, 0.452), (0.11, 0.462)]
    nu = 48
    nv = len(prof)
    rng = np.random.default_rng(31)
    ph = rng.uniform(0, 2 * math.pi, 6)
    P = np.zeros((nv, nu, 3))
    for i, (s, y) in enumerate(prof):
        vf = i / (nv - 1)
        w = pt.sm(0.5, 0.15, s) if s > 0 else 1.0
        rx = s * (a * (1 - w) + 0.33 * w)
        rz = s * (b * (1 - w) + 0.33 * w)
        A_ = 0.026 * float(pt.sm(0.35, 0.85, vf)) * (1 - 0.5 * float(pt.sm(0.9, 1.0, vf)))
        for j in range(nu):
            u = 2 * math.pi * j / nu
            f = 0.6 * math.sin(9 * u + 0.7 * math.sin(3 * u + ph[0])) + 0.4 * math.sin(14 * u + ph[1])
            # the four corners pulled up to the knot raise ridges on the diagonals
            ridge = sum(math.exp(-((math.atan2(math.sin(u - c), math.cos(u - c))) / 0.18) ** 2) for c in
                        (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4))
            sag = 0.012 * math.sin(2 * u + ph[2]) * math.sin(math.pi * min(1.0, vf * 1.6)) + 0.008 * math.sin(3 * u + ph[3]) * \
                math.sin(math.pi * vf)
            d = A_ * f + 0.018 * ridge * float(pt.sm(0.3, 0.8, vf)) + sag * (1 if 0 < i < nv - 1 else 0)
            if i <= 1:
                d = 0.0
            cu, su = math.cos(u), math.sin(u)
            r0 = math.hypot(rx * cu, rz * su)
            k = (r0 + d) / r0 if r0 > 1e-6 else 1.0
            P[i, j] = (rx * cu * k, y, rz * su * k)
    # surface coordinates: round (the equator's perimeter, mirrored at half) and up the meridians
    per = np.array([np.sum(np.linalg.norm(np.roll(P[i], -1, 0) - P[i], axis=1)) for i in range(nv)])
    ceq = float(per.max())
    tl = [0.0]
    for i in range(1, nv):
        tl.append(tl[-1] + float(np.mean(np.linalg.norm(P[i] - P[i - 1], axis=1))))
    ST = np.zeros((nv, nu + 1, 2))
    for i in range(nv):
        for j in range(nu + 1):
            ST[i, j] = (ceq * j / nu, tl[-1] - tl[i] + 0.02)
    with m.at(GM):
        kit.grid(m, P, ST, Param(C["cloth"], mirror=ceq / 2), closed=True, outfn=lambda i, j, c: np.array((c[0], 0.3 * (c[1] - 0.2), c[2])),
                 thr=60.0)
        top = np.mean(P[-1], axis=0)
        # the knot: a lumpy ball of cloth over the gathered neck
        kc = np.array((0.0, top[1] + 0.022, 0.0))
        nk, mk = 12, 8
        K = np.zeros((mk, nk, 3))
        for i in range(mk):
            th = math.pi * i / (mk - 1)
            for j in range(nk):
                ph_ = 2 * math.pi * j / nk
                bump = 1 + 0.16 * math.sin(3 * ph_ + 2 * th) + 0.1 * math.cos(5 * ph_ - th)
                K[i, j] = kc + np.array((0.058 * math.sin(th) * math.cos(ph_) * bump, -0.040 * math.cos(th) * bump,
                                         0.050 * math.sin(th) * math.sin(ph_) * bump))
        KST = np.array([[(0.36 * j / nk + 0.3, 0.2 + 0.17 * i / (mk - 1)) for j in range(nk + 1)] for i in range(mk)])
        kit.grid(m, K, KST, Param(C["cloth"]), closed=True, outfn=lambda i, j, c: c - kc, thr=70.0)
        # the four corners of the cloth sticking out of the knot, one standing up
        for k, (ang, rise, L) in enumerate(((0.75, 0.060, 0.10), (2.45, 0.025, 0.085), (3.9, 0.045, 0.095), (5.5, 0.015, 0.08))):
            d = np.array((math.cos(ang), 0.0, math.sin(ang)))
            path, rx, ry = [], [], []
            for q in range(6):
                t = q / 5
                p = kc + d * (0.03 + L * t) + np.array((0, rise * math.sin(t * math.pi * 0.8) + 0.01 - 0.02 * t * t, 0))
                path.append(p)
                rx.append(0.040 * (1 - 0.7 * t) + 0.006)
                ry.append(0.006 * (1 - 0.5 * t) + 0.0015)
            side = np.cross(d, (0, 1.0, 0))
            kit.sweep(m, path, rx, 8, Param(C["cloth"], off=(0.1 + 0.15 * k, 0.05)), ry=ry, up=tuple(side), thr=70.0,
                      caps=(False, True))
    return m


# ------------------------------------------------------------------ the featherbed

FPPM = 500
FR = 0.280


def featherbed_cells(A):
    def end_tex(w, h, ppm):
        return pt.ticking_end(w, h, ppm, 402, turns=4.0)

    return {
        "tick": A.cell("featherbed", math.pi * FR + 0.01, 1.08, FPPM, lambda w, h, p: pt.ticking(w, h, p, 401), "featherbed ticking"),
        "end": A.cell("featherbed", 2 * FR + 0.02, 2 * FR + 0.02, FPPM, end_tex, "featherbed ends"),
        "leather": A.cell("featherbed", 0.60, 0.032, FPPM, lambda w, h, p: pt.leather(w, h, p, 411, (0.32, 0.19, 0.09)),
                          "featherbed straps"),
        "brass": A.cell("featherbed", 0.06, 0.06, FPPM, lambda w, h, p: pt.brass(w, h, p, 412, (0.52, 0.42, 0.22)), "featherbed brass"),
    }


def _fb_profile():
    half = [(-0.550, 0.0), (-0.548, 0.10), (-0.541, 0.175), (-0.528, 0.222), (-0.508, 0.252), (-0.48, 0.270), (-0.44, 0.279),
            (-0.39, 0.276), (-0.345, 0.262), (-0.318, 0.246), (-0.305, 0.240), (-0.275, 0.240), (-0.262, 0.246), (-0.235, 0.262),
            (-0.18, 0.276), (-0.10, 0.2795), (0.0, 0.280)]
    return half + [(-x, r) for x, r in half[::-1][1:]]


def _squash(y, z, r):
    """The roll settles on its underside: the bottom flattened, a little wider low down."""
    lim = -0.86 * r
    if y < lim:
        y = lim + (y - lim) * 0.3
    if y < 0:
        z = z * (1 + 0.04 * min(1.0, -y / (0.8 * r)))
    return y, z


def featherbed(A):
    C = featherbed_cells(A)
    m = kit.Mesh("featherbed")
    prof = _fb_profile()
    n = 24
    ay = 0.862 * FR + 0.3 * 0.04 * FR  # the axis height: the bottom at y 0
    ay = -(-0.86 * FR + (-FR + 0.86 * FR) * 0.3)
    rows = []
    for x, r in prof:
        row = []
        for j in range(n):
            a = 2 * math.pi * j / n
            y, z = r * math.cos(a), r * math.sin(a)
            y, z = _squash(y, z, FR)
            row.append((x, ay + y, z))
        rows.append(row)
    P = np.array(rows)
    tl = [0.0]
    for i in range(1, len(prof)):
        tl.append(tl[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    ST = np.array([[(FR * 2 * math.pi * j / n, tl[i]) for j in range(n + 1)] for i in range(len(prof))])
    t0 = tl[4]
    tick = Param(C["tick"], mirror=math.pi * FR, off=(0.0, -t0))
    end = Planar(C["end"], 0, (0.0, ay - FR - 0.01, -FR - 0.01))
    nrow = len(prof) - 1

    def skin(i, j):
        return end if (i < 4 or i >= nrow - 4) else tick

    with m.at(GM):
        xs = np.array([p[0] for p in prof])

        def outfn(i, j, c):
            dr = prof[i + 1][1] - prof[i][1]
            dx = prof[i + 1][0] - prof[i][0]
            rad = np.array((0.0, c[1] - ay, c[2]))
            rad /= (np.linalg.norm(rad) or 1)
            return dx * rad + np.array((-dr, 0, 0))

        kit.grid(m, P, ST, skin, closed=True, outfn=outfn, thr=55.0)
        # two leather straps round the pinches, buckled high on the front
        for xs_ in (-0.29, 0.29):
            ring = []
            for j in range(n):
                a = 2 * math.pi * j / n
                y, z = 0.2402 * math.cos(a), 0.2402 * math.sin(a)
                y, z = _squash(y, z, FR)
                ring.append((z, ay + y))
            ribbon(m, ring, 0.030, 0.0035, Param(C["leather"], wrap=0.45), center=(0.0, ay), axis_x=xs_)
            a = math.radians(58)
            r = 0.2402 + 0.0035 + 0.0024
            p = np.array((xs_, ay + r * math.cos(a), r * math.sin(a)))
            # the buckle's plane: across the strap (x) and along it (round)
            tdir = np.array((0.0, -math.sin(a), math.cos(a)))
            nrm = np.array((0.0, math.cos(a), math.sin(a)))
            M = Matrix(((1.0, tdir[0], nrm[0], p[0]), (0.0, tdir[1], nrm[1], p[1]), (0.0, tdir[2], nrm[2], p[2]), (0, 0, 0, 1)))
            buckle(m, M, 0.040, 0.034, 0.002, Box(C["brass"]))
    return m


# ------------------------------------------------------------------ the hamper

HPPM = 520
HA, HB = 0.245, 0.172  # the body's half length and depth at the rim
SE = 4.0  # the section's superellipse power (a rounded rectangle)
NB = 40


def _se(n, power=SE, phase=0.0):
    out = []
    for j in range(n):
        a = phase + 2 * math.pi * j / n
        c, s = math.cos(a), math.sin(a)
        out.append((math.copysign(abs(c) ** (2 / power), c), math.copysign(abs(s) ** (2 / power), s)))
    return np.array(out)


def basket_cells(A):
    withy = (0.64, 0.52, 0.33)
    return {
        "side": A.cell("basket", 0.82, 0.39, HPPM, lambda w, h, p: pt.wicker(w, h, p, 501, withy), "basket sides"),
        "top": A.cell("basket", 0.52, 0.37, HPPM, lambda w, h, p: pt.wicker(w, h, p, 502, withy, stake_m=0.022, weaver_m=0.0055),
                      "basket lid"),
        "twist": A.cell("basket", 0.46, 0.06, HPPM, lambda w, h, p: pt.withy_twist(w, h, p, 503, withy, pitch=0.08), "basket rims"),
        "leather": A.cell("basket", 0.30, 0.026, HPPM, lambda w, h, p: pt.leather(w, h, p, 504, (0.33, 0.19, 0.09), edge_mm=3.0),
                          "basket strap"),
        "peg": A.cell("basket", 0.09, 0.05, HPPM, lambda w, h, p: pt.wood(w, h, p, (0.55, 0.42, 0.27), 505), "basket peg"),
    }


def basket(A):
    C = basket_cells(A)
    m = kit.Mesh("basket")
    U = _se(NB)
    per = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.roll(U * (HA, HB), -1, 0) - U * (HA, HB), axis=1))])
    half = per[-1] / 2
    # the body: a slightly tapered rounded box, a three-rod wale at the foot and under the rim (real relief)
    body = [(0.925, 0.0), (0.935, 0.006), (0.952, 0.014), (0.945, 0.024), (0.955, 0.034), (0.972, 0.10), (0.988, 0.17),
            (0.998, 0.212), (1.014, 0.222), (1.002, 0.232), (1.0, 0.247)]
    lid = [(1.016, 0.249), (1.016, 0.297), (1.006, 0.312), (0.975, 0.3195), (0.94, 0.320)]

    def loft(rows, t0):
        P = np.array([[(HA * s * u[0], y, HB * s * u[1]) for u in U] for s, y in rows])
        tl = [t0]
        for i in range(1, len(rows)):
            tl.append(tl[-1] + float(np.linalg.norm(P[i, 0] - P[i - 1, 0])))
        ST = np.array([[(per[j], tl[i]) for j in range(NB + 1)] for i in range(len(rows))])
        return P, ST

    with m.at(GM):
        P, ST = loft(body[::-1], 0.0)
        # rows written top down so the texture's top is the rim; outward: away from the axis
        ids = kit.grid(m, P, ST, Param(C["side"], mirror=half), closed=True,
                       outfn=lambda i, j, c: np.array((c[0], 0.0, c[2])), thr=50.0)
        kit.cap(m, ids[-1], P[-1], Planar(C["top"], 1, (-HA, 0, -HB)), out=(0, -1.0, 0), shade=0.7)
        P2, ST2 = loft(lid, 0.28)
        ids2 = kit.grid(m, P2, ST2, Param(C["side"], mirror=half), closed=True,
                        outfn=lambda i, j, c: np.array((c[0], 0.0, c[2])) * 1.0 + np.array((0, 1.0 if i >= 2 else 0.0, 0)), thr=50.0)
        kit.cap(m, ids2[-1], P2[-1], Planar(C["top"], 1, (-HA, 0, -HB)), out=(0, 1.0, 0))
        # the lid's rolled border: three withies twisted round each other (bumps in the silhouette)
        rr = 0.0085
        path = [(HA * 1.016 * u[0] + u[0] * 0.006, 0.256, HB * 1.016 * u[1] + u[1] * 0.006) for u in _se(64)]

        def twist(s, a):
            return 1.0 + 0.16 * math.cos(3 * a - 2 * math.pi * s / 0.08)

        kit.sweep(m, path, rr, 6, Param(C["twist"], wrap=0.36), closed=True, up=(0, 1.0, 0), bumps=twist, thr=70.0)
        # loop handles at both ends: twisted withies standing out from the end walls
        for sx in (-1, 1):
            wall = HA * 0.99
            hp = []
            for k in range(20):
                t = k / 19
                a = math.pi * t
                hp.append((sx * (wall - 0.004 + 0.034 * math.sin(a)), 0.196 + 0.004 * math.sin(a), -0.07 * math.cos(a)))
            kit.sweep(m, hp, 0.0072, 6, Param(C["twist"], wrap=0.36), up=(0, 1.0, 0), bumps=lambda s, a: 1 + 0.18 * math.cos(2 * a - 2 * math.pi * s / 0.04),
                      thr=70.0, caps=(True, True))
        # two withy loops at the back for the lid's hinges
        for xc in (-0.13, 0.13):
            zc = -(HB * 1.0 + 0.004)
            loop = [(xc, 0.247 + 0.017 * math.sin(2 * math.pi * k / 10), zc - 0.006 + 0.012 * math.cos(2 * math.pi * k / 10)) for k in range(10)]
            kit.sweep(m, loop, 0.0032, 5, Param(C["twist"], wrap=0.36), closed=True, up=(1.0, 0, 0), thr=70.0)
        # the closure: a leather strap from the lid over its border down to a wooden peg in a withy loop
        def bz(y):
            s = np.interp(y, [b[1] for b in body], [b[0] for b in body])
            return HB * s
        sp = [(0.10, 0.3206), (0.150, 0.3204), (0.1645, 0.3165), (0.1755, 0.302), (0.1757, 0.272), (0.1757 + 0.016, 0.262),
              (0.1757 + 0.019, 0.252), (0.1757 + 0.012, 0.241), (bz(0.222) + 0.006, 0.226), (bz(0.20) + 0.001, 0.20),
              (bz(0.165) + 0.001, 0.155)]
        ribbon(m, sp, 0.026, 0.003, Param(C["leather"]), center=(0.0, 0.2), closed=False, axis_x=0.0)
        zpeg = bz(0.17) + 0.013
        with m.at(T(-0.036, 0.168, zpeg) @ AX):
            kit.lathe(m, [(0.0, 0.0), (0.0045, 0.0), (0.0068, 0.004), (0.0072, 0.036), (0.0068, 0.068), (0.0045, 0.072), (0.0, 0.072)],
                      8, Box(C["peg"], grain=2), thr=50.0)
        loop = [(0.0 + 0.016 * math.cos(2 * math.pi * k / 8), 0.168 + 0.012 * math.sin(2 * math.pi * k / 8), zpeg - 0.006) for k in range(8)]
        kit.sweep(m, loop, 0.003, 5, Param(C["twist"], wrap=0.36), closed=True, up=(0, 0, 1.0), thr=70.0)
    return m
