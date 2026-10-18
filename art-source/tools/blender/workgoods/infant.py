"""An emigrant mother's baby (#180): a swaddled infant of a few months, carried across her arms.

baby: the bundle's middle at the origin, lying along game +Z with the head at +Z (Blender -Y), face up (game +Y =
Blender +Z): the way the camp's mothers carry it (Emigrants.cs turns it across her front). 50 cm long, 19 cm across,
17 cm deep: a grey-brown woollen shawl wrapped round a linen swaddle, two swaddling bands across it, the shawl's
fringed end folded back over the feet; the head in a white linen bonnet with a pleated frill round the face.
"""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param

B_PPM = 1000


def cells(A):
    def shawl_tex(w, h, ppm):
        # a fulled woollen shawl, a small twill check in grey-brown and oatmeal
        X, Y = pt.coords(w, h, ppm)
        base = np.array((0.42, 0.37, 0.30))
        check = (np.floor(X / 0.012) + np.floor(Y / 0.012)) % 2
        img = np.ones((h, w, 3), np.float32) * base
        img = img * (1 - 0.10 * check[..., None]) + np.array((0.56, 0.51, 0.42)) * 0.10 * check[..., None]
        twill = 0.5 + 0.5 * np.sin((X + Y) / 0.0016 * 2 * math.pi)
        img *= (0.93 + 0.07 * twill)[..., None]
        fuzz = pt.fbm(h, w, 0.002 * ppm, 0.002 * ppm, 91, 3)
        img *= (0.90 + 0.16 * fuzz)[..., None]
        wear = pt.fbm(h, w, 0.05 * ppm, 0.05 * ppm, 92, 3)
        img *= (0.94 + 0.10 * wear)[..., None]
        return img

    def band_tex(w, h, ppm):
        # the swaddling band: a narrow linen tape, its woven edges a little darker
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.80, 0.76, 0.66))
        weave = 0.5 + 0.5 * np.sin(X / 0.0009 * 2 * math.pi) * np.sin(Y / 0.0009 * 2 * math.pi)
        img *= (0.94 + 0.06 * weave)[..., None]
        edge = pt.sm(0.003, 0.0, np.minimum(Y, Y.max() - Y))
        img *= (1 - 0.12 * edge)[..., None]
        img *= (0.92 + 0.10 * pt.fbm(h, w, 0.03 * ppm, 0.01 * ppm, 93, 2))[..., None]
        return img

    def linen_tex(w, h, ppm):
        # the bonnet's and swaddle's bleached linen, fine plain weave, a faint yellowing in the folds
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.88, 0.86, 0.80))
        weave = 0.5 + 0.5 * np.sin(X / 0.0007 * 2 * math.pi) * np.sin(Y / 0.0007 * 2 * math.pi)
        img *= (0.95 + 0.05 * weave)[..., None]
        fold = pt.fbm(h, w, 0.02 * ppm, 0.008 * ppm, 94, 3)
        img = img * (1 - 0.10 * fold[..., None]) + np.array((0.78, 0.72, 0.58)) * 0.10 * fold[..., None]
        return img

    def face_tex(w, h, ppm):
        # the face, as seen from above: forehead at v = 0, chin at v = 1; asleep, the eyes closed
        X, Y = pt.coords(w, h, ppm)
        cx, cy = X.max() / 2, Y.max() / 2
        img = np.ones((h, w, 3), np.float32) * np.array((0.86, 0.66, 0.55))
        img *= (0.96 + 0.06 * pt.fbm(h, w, 0.004 * ppm, 0.004 * ppm, 95, 2))[..., None]
        # rosy cheeks
        for sx in (-1, 1):
            r = np.hypot(X - (cx + sx * 0.022), Y - (cy + 0.010))
            k = pt.sm(0.016, 0.0, r) * 0.35
            img = img * (1 - k[..., None]) + np.array((0.85, 0.48, 0.42)) * k[..., None]
        # the closed eyes: two short curved lashes, a soft shadow of the lid above each
        for sx in (-1, 1):
            ex, ey = cx + sx * 0.015, cy - 0.006
            u = (X - ex) / 0.0085
            curve = ey + 0.0026 * (u ** 2) - 0.0010
            lash = pt.sm(0.0011, 0.0003, np.abs(Y - curve)) * pt.sm(1.05, 0.85, np.abs(u))
            lid = pt.sm(0.004, 0.0, np.abs(Y - (curve - 0.0025))) * pt.sm(1.1, 0.7, np.abs(u))
            img *= (1 - 0.18 * lid)[..., None]
            img = img * (1 - 0.75 * lash[..., None]) + np.array((0.30, 0.18, 0.13)) * 0.75 * lash[..., None]
            brow = pt.sm(0.0016, 0.0004, np.abs(Y - (ey - 0.010 + 0.0012 * u ** 2))) * pt.sm(1.2, 0.8, np.abs(u))
            img *= (1 - 0.10 * brow)[..., None]
        # the nose: a small soft shadow and highlight
        r = np.hypot(X - cx, Y - (cy + 0.006))
        img *= (1 - 0.12 * pt.sm(0.006, 0.002, r) * pt.sm(-0.001, 0.003, Y - (cy + 0.006)))[..., None]
        img = img * (1 - 0.15 * pt.sm(0.003, 0.0, r)[..., None]) + 0.95 * 0.15 * pt.sm(0.003, 0.0, r)[..., None]
        # the mouth: a small closed pink line, the lower lip a touch fuller
        mx, my = cx, cy + 0.017
        m1 = pt.sm(0.0012, 0.0004, np.abs(Y - (my + 0.0008 * ((X - mx) / 0.006) ** 2))) * pt.sm(0.0075, 0.005, np.abs(X - mx))
        img = img * (1 - 0.6 * m1[..., None]) + np.array((0.62, 0.32, 0.30)) * 0.6 * m1[..., None]
        lip = pt.sm(0.0025, 0.0, np.hypot((X - mx) / 1.8, Y - (my + 0.0022)))
        img = img * (1 - 0.3 * lip[..., None]) + np.array((0.82, 0.50, 0.46)) * 0.3 * lip[..., None]
        # a little darker toward the edge of the face (inside the bonnet)
        rr = np.hypot((X - cx) / cx, (Y - cy) / cy)
        img *= (1 - 0.18 * pt.sm(0.7, 1.0, rr))[..., None]
        return img

    def fringe_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.45, 0.40, 0.32))
        strand = 0.5 + 0.5 * np.cos(X / 0.003 * 2 * math.pi)
        img *= (0.75 + 0.3 * strand)[..., None]
        return img

    return {"shawl": A.cell("infant", 0.62, 0.62, B_PPM, shawl_tex, "baby shawl"),
            "band": A.cell("infant", 0.62, 0.04, B_PPM, band_tex, "baby band"),
            "linen": A.cell("infant", 0.30, 0.22, B_PPM, linen_tex, "baby linen"),
            "face": A.cell("infant", 0.075, 0.075, 3000, face_tex, "baby face"),
            "fringe": A.cell("infant", 0.20, 0.03, B_PPM, fringe_tex, "baby fringe")}


# the bundle along Blender -Y (game +Z): stations from the feet (y = +0.25) to the crown (y = -0.25):
# y, half width, half height, centre z
BODY = [(0.250, 0.0, 0.0, -0.010), (0.246, 0.035, 0.028, -0.010), (0.236, 0.060, 0.050, -0.008), (0.215, 0.078, 0.064, -0.006),
        (0.180, 0.088, 0.072, -0.004), (0.130, 0.092, 0.076, -0.002), (0.070, 0.094, 0.080, 0.0), (0.010, 0.095, 0.083, 0.002),
        (-0.040, 0.094, 0.084, 0.002), (-0.080, 0.090, 0.082, 0.002), (-0.110, 0.086, 0.080, 0.002)]
HEAD_Y, HEAD_R = -0.142, 0.064  # the head's centre along the bundle and its radius (the bonnet over it)


def _section(hw, hh, cz, n, flat=0.85):
    """A soft bundle's section: an oval a little flattened underneath where it rests on the arms. Columns start on
    top (+z) and go round +x."""
    out = []
    for j in range(n):
        a = 2 * math.pi * j / n
        s, c = math.sin(a), math.cos(a)
        z = cz + hh * c * (1.0 if c > 0 else flat)
        x = hw * math.copysign(abs(s) ** (2 / 2.4), s)
        out.append((x, z))
    return out


def baby(A):
    C = cells(A)
    m = kit.Mesh("baby")
    n = 24
    # the wrapped body: a soft oval tube from the folded-up foot end to the shoulders, open at the head end where the
    # shawl turns back round the bonnet (its edge is a rolled hem)
    rows = []
    for y, hw, hh, cz in BODY:
        if hw <= 0:
            rows.append([(0.0, y, cz)] * n)
        else:
            rows.append([(x, y, z) for x, z in _section(hw, hh, cz, n)])
    P = np.array(rows)
    circ = 2 * math.pi * 0.08
    ST = np.zeros((len(rows), n + 1, 2))
    for i in range(len(rows)):
        for j in range(n + 1):
            ST[i, j] = (0.25 - P[i, 0, 1] + 0.05, circ * j / n)
    outward = np.array([[0.0, 0.0, 0.0]])
    ys = np.array([r[0][1] for r in rows])

    def outfn(i, j, c):
        cz = np.interp(-c[1], -ys, [np.mean(P[k, :, 2]) for k in range(len(rows))])
        return np.array((c[0], 0.0, c[2] - cz))

    ids = kit.grid(m, P, ST, Param(C["shawl"], wrap=0.60, wrap_t=0.60), closed=True, outfn=outfn, thr=50.0)
    # the neck end: the shawl turned in round the baby's shoulders (closed, so the bundle is never seen hollow)
    kit.cap(m, ids[-1], P[-1], Param(C["shawl"], wrap=0.60, wrap_t=0.60), out=(0.0, -1.0, 0.0), shade=0.7)
    # the shawl's edge turned back round the neck: a soft roll round the last ring, the head resting in it
    hem = [tuple(p + (p - np.array((0.0, p[1], np.mean(P[-1, :, 2])))) * 0.06) for p in P[-1]]
    kit.sweep(m, hem, 0.0085, 8, Param(C["shawl"], wrap=0.6), closed=True, up=(0, -1, 0), thr=60.0)
    # the swaddling bands: two linen tapes round the body, raised a few millimetres, crossing it at a slant
    for yb, slant in ((0.085, 0.02), (-0.020, -0.015)):
        ring = []
        k = int(np.searchsorted(-ys, -yb))
        k = min(max(k, 1), len(BODY) - 1)
        t = (yb - ys[k - 1]) / (ys[k] - ys[k - 1])
        for j in range(n):
            p = P[k - 1, j] * (1 - t) + P[k, j] * t
            ctr = np.array((0.0, yb, np.mean(P[k, :, 2])))
            d = p - ctr
            d = d / (np.linalg.norm(d) or 1.0)
            q = p + d * 0.0012
            q[1] += slant * (q[0] / 0.095)
            ring.append(tuple(q))
        ring.append(ring[0])
        kit.sweep(m, ring, 0.0018, 6, Param(C["band"], wrap=0.6), ry=0.012, up=(0, 1, 0), thr=40.0)
    # the shawl's end folded back over the feet: a flap with a knotted fringe
    flap = [(-0.070, 0.230, 0.050), (0.070, 0.230, 0.050), (0.085, 0.150, 0.080), (-0.085, 0.150, 0.080)]
    with m.at(Matrix.Identity(4)):
        lo, hi = np.array((-0.09, 0.14, 0.04)), np.array((0.09, 0.24, 0.09))
        pts = [np.array(p) for p in flap]
        ids = [m.vid(p) for p in pts]
        m.face(ids, pts, Box(C["shawl"]).bind(lo, hi), out=(0, 0.3, 1), thr=40.0)
        ids2 = [m.vid(p + np.array((0, 0, -0.004))) for p in pts]
        m.face(ids2[::-1], [p + np.array((0, 0, -0.004)) for p in pts][::-1], Box(C["shawl"]).bind(lo, hi), out=(0, -0.3, -1), thr=40.0)
    for k in range(9):
        x = -0.064 + 0.016 * k
        path = [(x, 0.228, 0.046), (x + 0.001, 0.234, 0.040), (x + 0.002, 0.238, 0.033), (x + 0.002, 0.240, 0.027)]
        kit.sweep(m, path, [0.0015, 0.0013, 0.0011, 0.0006], 4, Param(C["fringe"]), up=(0, 0, 1), caps=(False, True), thr=60.0)
    # the head: the face inside the bonnet, turned up
    hz = np.mean(P[len(BODY) - 1, :, 2]) + 0.012
    with m.at(kit.T(0.0, HEAD_Y, hz)):
        # the face: the front of the head, a cap of its sphere within 52 degrees of straight up, its picture
        # projected from above (forehead toward the crown)
        R = HEAD_R
        prof = [(R * math.sin(math.radians(f)), R * math.cos(math.radians(f)) - 0.004) for f in (52, 44, 34, 24, 14, 6, 0)]
        kit.lathe(m, prof, 18, FaceSkin(C["face"]), ellipse=(0.94, 1.06), thr=70.0)
        # the bonnet: a linen shell over the crown and round the sides of the face, open over the face and toward
        # the chin; polar angle from straight up (the face's edge at 50 degrees) round to under the head
        RB = R * 1.07
        phis = np.radians(np.linspace(50.0, 128.0, 7))
        psis = np.radians(np.linspace(-112.0, 112.0, 17))
        PB = np.array([[(RB * math.sin(f) * math.sin(q) * 0.94, -RB * math.sin(f) * math.cos(q) * 1.02, (RB * math.cos(f) - 0.004) * (1.0 if f < math.pi / 2 else 0.8))
                        for q in psis] for f in phis])
        STB = np.zeros((PB.shape[0], PB.shape[1], 2))
        for i in range(PB.shape[0]):
            for j in range(PB.shape[1]):
                STB[i, j] = (RB * (psis[j] - psis[0]), RB * (phis[i] - phis[0]))
        kit.grid(m, PB, STB, Param(C["linen"]), outfn=lambda i, j, c: np.array(c), thr=50.0)
        # the pleated frill round the face: a gathered linen ruffle along the bonnet's front edge
        edge = [tuple(p * 1.015) for p in PB[0]]
        kit.sweep(m, edge, 0.0050, 6, Param(C["linen"], wrap=0.25), ry=0.010, up=(0, 0, 1), thr=70.0,
                  bumps=lambda s, a: 1.0 + 0.35 * math.sin(s / 0.0045 * 2 * math.pi) * max(0.0, math.cos(a)))
    return m


class FaceSkin:
    """The face dome's picture projected from above: x across the face, -y (the bundle's head end) up the picture."""

    def __init__(self, cell):
        self.cell = cell

    def uv(self, pts, st, n):
        out = []
        for p in pts:
            s = 0.0375 + p[0]
            t = 0.0375 + p[1]  # forehead toward the crown (Blender -Y) at the picture's top
            out.append(self.cell.px(min(max(s, 0.0), 0.075), min(max(t, 0.0), 0.075)))
        return out
