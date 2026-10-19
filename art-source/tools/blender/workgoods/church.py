"""The cathedral's furniture (#198): the five confessionals, the pulpit and the side altars' fittings were textured
boxes with painted panels (the confessional), a tall box on coarse figures with a flat ramp for a stair (the pulpit),
and flat painted mouldings round a flat picture (the side altars). Rebuilt here at our detail level, after the
Baroque oak work of Antwerp's churches (the cathedral's confessionals, Michiel van der Voort's pulpit of 1713):

confessional: oak, three bays (the priest's open arched middle bay with its curtains tied back, a penitents' bay
    each side with a kneeling step and a pierced grille into the middle), panelled pilasters with carved garlands and
    capitals, a carved frieze of acanthus scrolls, a moulded cornice that returns along the sides, a crest of scrolls
    round a carved cartouche with a gilt glory. 2.98 m wide, 1.35 m deep, 4.46 m to the glory's top. Its origin is
    on the floor at the middle of its front (the pilasters' faces), facing game +Z; the back stands at z = -1.35.
pulpit: an oak tub on a carved tree trunk (game origin on the floor under the tub's middle, its preacher facing +Z),
    eight carved medallions round the tub, a back board, an octagonal sounding board with a carved valance and a
    gilt crown, a straight stair up its left side (game -X) with a pierced balustrade of carved scrolls.
altar_frame, altar_capital, altar_crown, altar_dressing, altar_saint: a side altar's fittings (the picture keeps
    its recovered painting): a deep carved and gilt frame round the 1.70 x 2.50 m picture, gilt capitals for its
    marble columns, a carved gilt cartouche on its pediment, the altar's cloth, cross and four candlesticks, and a
    white marble saint on each side. altar_marble: the altar's marble architecture, prepared for the day the town
    shell's coarse boxes (town/ROOM_cathedral Mesh1135, Mesh1136) are cut; five authored furniture parts place it after the guarded shell cut.

One material, one 2048 x 2048 atlas painted here (our own work: workgoods/paint.py and this file, nothing downloaded).
Wood edges are chamfered 2-4 mm (AGENTS.md: wood 1-4 mm), marble arrises 6-10 mm, gilt carving rounded.

Blender axes while building (Z up, front toward -Y); a model's front plane at y = 0 unless said otherwise.
"""

import math

import numpy as np
from mathutils import Matrix, Vector

from . import carving
from . import kit
from . import paint as pt
from .kit import Box, Flat, Param

_CELLS = {}


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def RZ(a):
    return Matrix.Rotation(a, 4, "Z")


def RX(a):
    return Matrix.Rotation(a, 4, "X")


# ------------------------------------------------------------------ the atlas


def _tile(img):
    return carving._tile(img)


def cells(A):
    if id(A) in _CELLS:
        return _CELLS[id(A)]

    def oak(w, h, ppm):
        # quarter-sawn waxed oak, darkened by two centuries of candle smoke and hands: the rays' flecks, a close grain
        img = pt.wood(w, h, ppm, (0.44, 0.29, 0.165), 211, oak=True, knots=0, ring_mm=2.6, figure=0.8)
        img *= (0.90 + 0.14 * pt.fbm(h, w, 0.3 * ppm, 0.3 * ppm, 212, 3))[..., None]
        return _tile(img)

    def oak_dark(w, h, ppm):
        # the plinths, steps and kneelers: worn darker, the wax gone grey in the pores
        img = pt.wood(w, h, ppm, (0.32, 0.21, 0.125), 213, oak=True, knots=0, ring_mm=2.4, figure=0.9)
        scuff = pt.fbm(h, w, 0.05 * ppm, 0.012 * ppm, 214, 3)
        img = img * (0.85 + 0.25 * scuff)[..., None]
        return _tile(img)

    def carved(w, h, ppm):
        img = pt.wood(w, h, ppm, (0.47, 0.32, 0.19), 131, oak=True, knots=0, ring_mm=3.0, figure=0.7)
        img *= (0.93 + 0.12 * pt.fbm(h, w, 0.012 * ppm, 0.02 * ppm, 132, 3))[..., None]
        img *= (0.92 + 0.12 * pt.fbm(h, w, 0.25 * ppm, 0.25 * ppm, 133, 3))[..., None]
        return _tile(img)

    def gilt(w, h, ppm):
        # water gilding on red bole: burnished leaf, the leaf's squares faintly, worn to the bole in a few places
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.80, 0.62, 0.27))
        img *= (0.86 + 0.24 * pt.fbm(h, w, 0.03 * ppm, 0.03 * ppm, 221, 4))[..., None]
        sq = 0.08
        seam = (np.minimum(X % sq, sq - X % sq) < 0.0006) | (np.minimum(Y % sq, sq - Y % sq) < 0.0006)
        img[seam] *= 0.93
        worn = pt.sm(0.80, 0.86, pt.fbm(h, w, 0.008 * ppm, 0.008 * ppm, 222, 4))
        img = img * (1 - 0.45 * worn[..., None]) + np.array((0.50, 0.26, 0.13)) * 0.45 * worn[..., None]
        return _tile(img)

    def velvet(w, h, ppm):
        # a deep red wool velvet, its nap catching the light in streaks down the fall
        img = np.ones((h, w, 3), np.float32) * np.array((0.36, 0.055, 0.06))
        img *= (0.80 + 0.30 * pt.fbm(h, w, 0.004 * ppm, 0.08 * ppm, 231, 4))[..., None]
        img *= (0.90 + 0.14 * pt.fbm(h, w, 0.2 * ppm, 0.2 * ppm, 232, 3))[..., None]
        return _tile(img)

    def iron(w, h, ppm):
        return _tile(pt.iron(w, h, ppm, 241, rust=0.12) * 0.8)

    def brass(w, h, ppm):
        return _tile(pt.brass(w, h, ppm, 242))

    def wax(w, h, ppm):
        img = np.ones((h, w, 3), np.float32) * np.array((0.92, 0.88, 0.76))
        img *= (0.94 + 0.08 * pt.fbm(h, w, 0.02 * ppm, 0.05 * ppm, 243, 3))[..., None]
        return _tile(img)

    def linen(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        weave = ((np.floor(X / 0.0008) + np.floor(Y / 0.0008)) % 2).astype(np.float32)
        img = np.ones((h, w, 3), np.float32) * np.array((0.88, 0.86, 0.80))
        img *= (0.94 + 0.04 * weave + 0.06 * (pt.fbm(h, w, 0.1 * ppm, 0.1 * ppm, 244, 3) - 0.5))[..., None]
        return _tile(img)

    def marble(w, h, ppm):
        # white Carrara with grey veins wandering across it
        img = np.ones((h, w, 3), np.float32) * np.array((0.86, 0.85, 0.82))
        n1 = pt.fbm(h, w, 0.35 * ppm, 0.35 * ppm, 251, 5)
        n2 = pt.fbm(h, w, 0.12 * ppm, 0.12 * ppm, 252, 4)
        vein = pt.sm(0.022, 0.0, np.abs(n1 + 0.35 * n2 - 0.62))
        fine = pt.sm(0.010, 0.0, np.abs(pt.fbm(h, w, 0.08 * ppm, 0.08 * ppm, 253, 4) - 0.5))
        img = img * (1 - 0.35 * vein[..., None] - 0.12 * fine[..., None])
        img *= (0.95 + 0.06 * n2)[..., None]
        return _tile(img)

    def marble_black(w, h, ppm):
        # Belgian black marble, polished, a few white calcite veins
        img = np.ones((h, w, 3), np.float32) * np.array((0.055, 0.055, 0.06))
        img *= (0.85 + 0.3 * pt.fbm(h, w, 0.2 * ppm, 0.2 * ppm, 254, 4))[..., None]
        vein = pt.sm(0.008, 0.0, np.abs(pt.fbm(h, w, 0.4 * ppm, 0.4 * ppm, 255, 5) - 0.55))
        img = img * (1 - 0.6 * vein[..., None]) + np.array((0.62, 0.60, 0.58)) * 0.6 * vein[..., None]
        return _tile(img)

    def dark(w, h, ppm):
        return pt.solid(w, h, (0.035, 0.03, 0.028))

    A.region("church", 0, 0, 2048, 2048)
    _CELLS[id(A)] = {
        "oak": A.cell("church", 1.40, 1.40, 360, oak, "oak"),
        "oakd": A.cell("church", 1.00, 1.00, 360, oak_dark, "oak dark"),
        "carved": A.cell("church", 1.40, 1.40, 300, carved, "carved oak"),
        "gilt": A.cell("church", 0.80, 0.80, 450, gilt, "gilt"),
        "velvet": A.cell("church", 1.30, 1.30, 300, velvet, "velvet"),
        "marble": A.cell("church", 1.60, 1.60, 300, marble, "marble"),
        "marbleb": A.cell("church", 1.00, 1.00, 300, marble_black, "black marble"),
        "linen": A.cell("church", 1.00, 1.00, 380, linen, "linen"),
        "iron": A.cell("church", 0.40, 0.40, 400, iron, "iron"),
        "brass": A.cell("church", 0.40, 0.40, 500, brass, "brass"),
        "wax": A.cell("church", 0.70, 0.30, 400, wax, "wax"),
        "dark": A.cell("church", 0.10, 0.10, 100, dark, "dark"),
    }
    return _CELLS[id(A)]


class Tile:
    """UV by projection along the face's main axis, `grain` (0, 1, 2: the axis the wood's grain runs along) along u when
    it lies in the face, over the seamless cell: the face keeps its place in a repeat of the cell (W x H, the cell less a
    margin) when it fits there, else it starts at the cell's corner. A face larger than the cell runs out of it (counted)."""

    def __init__(self, cell, grain=2, margin=0.30, off=(0.0, 0.0)):
        self.cell, self.grain, self.margin, self.off = cell, grain, margin, off

    def uv(self, pts, st, n):
        a = int(np.argmax(np.abs(n)))
        o = [i for i in (0, 1, 2) if i != a]
        if self.grain in o:
            u = self.grain
            v = o[0] if o[1] == u else o[1]
        else:
            u, v = o
        s = [float(p[u]) + self.off[0] for p in pts]
        t = [float(p[v]) + self.off[1] for p in pts]
        out = [self.cell.px(x, y) for x, y in zip(_fit(s, self.cell.wm, self.margin), _fit(t, self.cell.hm, self.margin))]
        kit._chk(self.cell, out)
        return out


def _fit(vals, size, margin):
    """Shift a face's coordinates into [0, size): by whole repeats of (size - margin) when that fits, else to start at 0."""
    W = size - margin
    lo, hi = min(vals), max(vals)
    k = math.floor(lo / W) * W
    if hi - k > size - 0.002:
        k = lo
    return [v - k for v in vals]


class Along:
    """UV from the surface metres (s along a member or moulding, t round it), each face fitted into the cell as Tile does."""

    def __init__(self, cell, margin=0.30):
        self.cell, self.margin = cell, margin

    def uv(self, pts, st, n):
        s = [a[0] for a in st]
        t = [a[1] for a in st]
        out = [self.cell.px(x, y) for x, y in zip(_fit(s, self.cell.wm, self.margin), _fit(t, self.cell.hm, self.margin))]
        kit._chk(self.cell, out)
        return out


def skins(A):
    C = cells(A)
    return {"oak": Tile(C["oak"]), "oakh": Tile(C["oak"], grain=0), "oakd": Tile(C["oakd"], grain=0), "carved": Tile(C["carved"]),
            "gilt": Tile(C["gilt"], margin=0.3), "velvet": Tile(C["velvet"]), "marble": Tile(C["marble"], margin=0.4),
            "marbleb": Tile(C["marbleb"], margin=0.3), "linen": Tile(C["linen"], grain=0, margin=0.3), "iron": Tile(C["iron"], margin=0.12),
            "brass": Tile(C["brass"], margin=0.12), "wax": Tile(C["wax"], margin=0.1), "dark": Flat(C["dark"])}


# ------------------------------------------------------------------ primitives


def dense(prof, step=0.35):
    """A lathe profile with its long segments cut into pieces of at most `step` (each face fits the texture)."""
    out = [prof[0]]
    for a, b in zip(prof, prof[1:]):
        k = max(1, int(math.ceil(math.hypot(b[0] - a[0], b[1] - a[1]) / step)))
        out += [(a[0] + (b[0] - a[0]) * q / k, a[1] + (b[1] - a[1]) * q / k) for q in range(1, k + 1)]
    return out


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


def run(m, prof, path, skin, frame=None, closed=False, caps=(True, True), tile=0.45, shade=1.0, thr=40.0, flip=False):
    """A moulding: the section `prof` [(u, v)] swept along `path` [(a, b)], mitred at every corner. u is the section's
    reach to the right of the path's travel (its face side), v its height off the plane. frame (O, A, B, N): the plane's
    origin and its a, b and v axes (default the floor plan: a = X, b = Y, v = Z). The section is listed from its foot on
    the plane round its face to its back; the path is cut into pieces of at most `tile` metres (one texture tile)."""
    O, Aa, Bb, N = (np.zeros(3), np.array((1.0, 0, 0)), np.array((0, 1.0, 0)), np.array((0, 0, 1.0))) if frame is None else [np.asarray(f, float) for f in frame]
    pts = [np.asarray(p, float) for p in path]
    # cut long straight pieces
    cut = []
    n0 = len(pts)
    segs = n0 if closed else n0 - 1
    for i in range(segs):
        a, b = pts[i], pts[(i + 1) % n0]
        k = max(1, int(math.ceil(np.linalg.norm(b - a) / tile)))
        for j in range(k):
            cut.append(a + (b - a) * j / k)
    if not closed:
        cut.append(pts[-1])
    P2 = np.array(cut)
    n = len(P2)
    # the mitred right-hand normals
    nm = np.zeros((n, 2))
    for i in range(n):
        if closed or 0 < i < n - 1:
            d0 = unit(P2[i] - P2[i - 1])
            d1 = unit(P2[(i + 1) % n] - P2[i])
        else:
            d0 = d1 = unit(P2[1] - P2[0]) if i == 0 else unit(P2[-1] - P2[-2])
        r0, r1 = np.array((d0[1], -d0[0])), np.array((d1[1], -d1[0]))
        s = unit(r0 + r1)
        c = max(0.25, float(s @ r0))
        nm[i] = s / c
    if flip:
        nm = -nm
    prof = [(float(u), float(v)) for u, v in prof]
    P = np.zeros((n, len(prof), 3))
    for i in range(n):
        for j, (u, v) in enumerate(prof):
            q = P2[i] + nm[i] * u
            P[i, j] = O + Aa * q[0] + Bb * q[1] + N * v
    slen = [0.0]
    for i in range(1, n):
        slen.append(slen[-1] + float(np.linalg.norm(P2[i] - P2[i - 1])))
    total = slen[-1] + (float(np.linalg.norm(P2[0] - P2[-1])) if closed else 0.0)
    tl = [0.0]
    for j in range(1, len(prof)):
        tl.append(tl[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
    nrow = n + 1 if closed else n
    ST = np.zeros((nrow, len(prof), 2))
    for i in range(nrow):
        for j in range(len(prof)):
            ST[i, j] = (slen[i] if i < n else total, tl[j])

    def outfn(i, j, c):
        du, dv = prof[j + 1][0] - prof[j][0], prof[j + 1][1] - prof[j][1]
        i1 = (i + 1) % n
        nn = (nm[i] + nm[i1]) / 2
        horiz = Aa * nn[0] + Bb * nn[1]
        return unit(horiz) * dv - N * du

    # the grid's rows run along the path, its columns across the section (kit.grid: rows x cols)
    ids = kit.grid(m, P, ST, skin, closed=False, closed_rows=closed, outfn=outfn, shade=shade, thr=thr)
    if not closed:
        for end, k in ((0, 0), (1, n - 1)):
            if not caps[end]:
                continue
            d = unit(P2[1] - P2[0]) if end == 0 else unit(P2[-1] - P2[-2])
            o = (Aa * d[0] + Bb * d[1]) * (-1 if end == 0 else 1)
            kit.cap(m, ids[k], P[k], skin, out=o, shade=shade * 0.9)
    return ids, P


def relief(m, M, w, h, hfun, nu, nv, skin, shade=1.0, thr=55.0):
    """A carved surface over a w x h rectangle: local x across (0..w), z up (0..h), raised toward -y by hfun(x, z) metres.
    hfun returns None outside the carving's outline: no face is made where a corner is outside. Placed by M."""
    xs = np.linspace(0, w, nu + 1)
    zs = np.linspace(0, h, nv + 1)
    H = np.array([[hfun(x, z) for x in xs] for z in zs], dtype=object)
    with m.at(M):
        ids = {}

        def vid(i, j):
            if (i, j) not in ids:
                ids[(i, j)] = m.vid((xs[j], -max(0.0, H[i, j] or 0.0), zs[i]))
            return ids[(i, j)]

        for i in range(nv):
            for j in range(nu):
                if any(H[a, b] is None for a, b in ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))):
                    continue
                q = [(i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j)]
                pts = [np.array((xs[b], -max(0.0, H[a, b]), zs[a])) for a, b in q]
                m.face([vid(a, b) for a, b in q], pts, skin, st=[(xs[b], zs[a]) for a, b in q], out=np.array((0.0, -1.0, 0.0)), shade=shade, thr=thr)


def member(m, lo, hi, axis, skin, c=0.003, tile=0.45, caps=(True, True), shade=1.0, thr=30.0):
    """A long chamfered member (a stile, a rail, a board) along `axis`: its section swept along it in pieces of at most
    `tile`, so every face finds its place in the texture (skin: an Along)."""
    lo, hi = np.array(lo, float), np.array(hi, float)
    a, b = [k for k in (0, 1, 2) if k != axis]
    c = min(c, 0.3 * min(hi[a] - lo[a], hi[b] - lo[b]))
    A0, A1, B0, B1 = lo[a], hi[a], lo[b], hi[b]
    sec = [(A0 + c, B0), (A1 - c, B0), (A1, B0 + c), (A1, B1 - c), (A1 - c, B1), (A0 + c, B1), (A0, B1 - c), (A0, B0 + c)]
    if c <= 1e-6:
        sec = [(A0, B0), (A1, B0), (A1, B1), (A0, B1)]
    L = hi[axis] - lo[axis]
    k = max(1, int(math.ceil(L / tile)))
    rows = [lo[axis] + L * i / k for i in range(k + 1)]
    P = np.zeros((k + 1, len(sec), 3))
    for i, r in enumerate(rows):
        for j, (pa, pb) in enumerate(sec):
            P[i, j, axis], P[i, j, a], P[i, j, b] = r, pa, pb
    per = [0.0]
    for j in range(1, len(sec) + 1):
        per.append(per[-1] + math.dist(sec[j % len(sec)], sec[j - 1]))
    ST = np.zeros((k + 1, len(sec) + 1, 2))
    for i, r in enumerate(rows):
        for j in range(len(sec) + 1):
            ST[i, j] = (r - lo[axis], per[j])
    ctr = (lo + hi) / 2

    def outfn(i, j, cc):
        d = np.array(cc) - ctr
        d[axis] = 0
        return d

    ids = kit.grid(m, P, ST, skin, closed=True, outfn=outfn, shade=shade, thr=thr)
    for end, row in ((0, 0), (1, k)):
        if caps[end]:
            o = np.zeros(3)
            o[axis] = -1 if end == 0 else 1
            kit.cap(m, ids[row], P[row], skin, out=o, shade=shade)


def boards(m, x0, y0, z0, x1, y1, z1, skin, along=0, width=0.16, c=0.003):
    """Planks side by side (a floor, a ceiling, a back) along axis `along`, each `width` wide across the other long axis."""
    lo, hi = np.array((x0, y0, z0), float), np.array((x1, y1, z1), float)
    ext = hi - lo
    thin = int(np.argmin(ext))
    across = [k for k in (0, 1, 2) if k not in (along, thin)][0]
    n = max(1, int(round(ext[across] / width)))
    for i in range(n):
        a, b = lo.copy(), hi.copy()
        a[across] = lo[across] + ext[across] * i / n
        b[across] = lo[across] + ext[across] * (i + 1) / n
        member(m, a, b, along, skin, c=c)


def field_panel(m, x0, z0, x1, z1, y, skin, raise_=0.014, bevel=0.055, c=0.003, shade=1.0):
    """A raised and fielded panel in the plane y (its face toward -y): a flat margin, a bevel up to the field, the field's
    arris chamfered. Its back is hidden in the frame."""
    def ring(inset, dy):
        return [(x0 + inset, y - dy, z0 + inset), (x1 - inset, y - dy, z0 + inset), (x1 - inset, y - dy, z1 - inset), (x0 + inset, y - dy, z1 - inset)]
    rings = [ring(0.0, 0.0), ring(0.012, 0.0), ring(bevel, raise_ - c), ring(bevel + c, raise_)]
    P = np.array(rings, float)
    ST = np.zeros((len(rings), 5, 2))
    for i, r in enumerate(rings):
        for j in range(5):
            p = r[j % 4]
            ST[i, j] = (p[0], p[2])
    ctr = np.array(((x0 + x1) / 2, y, (z0 + z1) / 2))
    ids = kit.grid(m, P, ST, skin, closed=True, outfn=lambda i, j, cc: np.array((0, -1.0, 0)) + 0.3 * unit(np.array((cc[0] - ctr[0], 0, cc[2] - ctr[2]))), shade=shade, thr=35.0)
    kit.cap(m, ids[-1], P[-1], skin, out=(0, -1.0, 0), shade=shade)
    # the margin's outer edge down to the frame's plane
    kit.cap(m, ids[0][::-1], P[0][::-1], skin, out=(0, 1.0, 0), shade=0.5)


def bx(m, x0, y0, z0, x1, y1, z1, skin, c=0.003, skip=(), shade=1.0, thr=30.0):
    kit.cbox(m, (min(x0, x1), min(y0, y1), min(z0, z1)), (max(x0, x1), max(y0, y1), max(z0, z1)), skin, c=c, skip=skip, shade=shade, thr=thr)


def scroll(m, skin, M, size, turns=1.6, r0=0.012, r1=0.004, tail=0.0, sides=8, thr=60.0):
    """A carved volute: a flat spiral (in local xz, unwinding outward from its eye, then a tail) swept with a tapering
    round section; local y is its depth."""
    pts, radii = [], []
    nseg = int(20 * turns) + 2
    for k in range(nseg):
        t = k / (nseg - 1)
        a = t * turns * 2 * math.pi
        r = size * (0.18 + 0.82 * t)
        pts.append((r * math.cos(a), 0.0, r * math.sin(a)))
        radii.append(r1 + (r0 - r1) * t)
    if tail > 0:
        a = turns * 2 * math.pi
        px, _, pz = pts[-1]
        for k in range(1, 6):
            pts.append((px + tail * k / 5 * math.sin(a) * 0.4, 0.0, pz - tail * k / 5))
            radii.append(r0)
    with m.at(M):
        kit.sweep(m, pts, radii, sides, skin, up=(0, 1, 0), thr=thr, caps=(True, True))


def leaf(m, skin, M, length, width, curl=0.6, nl=7, nw=5, thr=70.0):
    """An acanthus leaf: a tongue rising up local z, its lobes in waves along the edges, a midrib, bent outward (-y) at the
    tip; a double-faced shell."""
    P = np.zeros((nl, nw, 3))
    ST = np.zeros((nl, nw, 2))
    for i in range(nl):
        t = i / (nl - 1)
        half = width / 2 * (math.sin(math.pi * min(1.0, t * 1.1 + 0.08)) ** 0.7) * (1 - 0.25 * t)
        lob = 1 + 0.18 * math.sin(t * math.pi * 5)
        bend = -curl * length * (t ** 2.2) * 0.45
        for j in range(nw):
            s = -1 + 2 * j / (nw - 1)
            x = s * half * lob
            cup = 0.25 * width * (1 - s * s) * (0.4 + t)  # hollowed along the midrib
            P[i, j] = (x, bend + cup * 0.3 - 0.01 * abs(s), t * length - 0.5 * curl * length * t ** 3 * 0.3)
            ST[i, j] = (x, t * length)
    with m.at(M):
        kit.grid(m, P, ST, skin, outfn=lambda i, j, c: np.array((0, -1.0, 0.2)), thr=thr)
        kit.grid(m, P + np.array((0, 0.004, 0)), ST, skin, outfn=lambda i, j, c: np.array((0, 1.0, -0.2)), shade=0.6, thr=thr)


# ------------------------------------------------------------------ carved patterns (height fields, metres)


def rinceau(w, h, amp=0.016, period=0.42):
    """An acanthus scroll frieze: a stem waving along the band, a curled leaf in each wave, small flowers between."""
    def f(x, z):
        u, v = x / w, z / h
        edge = min(1.0, min(x, w - x, z, h - z) / 0.014)
        if edge <= 0:
            return 0.0
        ph = 2 * math.pi * x / period
        yc = h * (0.5 + 0.22 * math.sin(ph))
        d = abs(z - yc) / (0.010)
        stem = math.exp(-d * d) * 0.65
        # a spiral leaf in each half wave, curling round a centre off the stem
        k = math.floor(x / (period / 2))
        cx = (k + 0.5) * period / 2
        cz = h * (0.5 - 0.22 * (1 if k % 2 == 0 else -1) * 0.2)
        rx, rz = x - cx, z - cz
        r = math.hypot(rx, rz) + 1e-6
        a = math.atan2(rz, rx) * (1 if k % 2 == 0 else -1)
        spiral = 0.5 + 0.5 * math.cos(a * 1.0 - r / (h * 0.09) * 2 * math.pi)
        rim = max(0.0, 1 - r / (h * 0.42))
        leafv = (spiral ** 3) * rim ** 0.6
        # lobes along it
        lobes = 0.15 * math.sin(a * 5) * rim
        flower = math.exp(-((x - (k * period / 2)) ** 2 + (z - h * 0.5) ** 2) / (0.012 ** 2))
        hgt = max(stem, leafv * 0.9 + lobes, flower * 0.8)
        return amp * min(1.0, hgt) * edge
    return f


def garland(w, h, amp=0.022):
    """A hanging garland of fruit and leaves down a pilaster's panel, tied with a ribbon at its top."""
    def f(x, z):
        edge = min(1.0, min(x, w - x, z, h - z) / 0.012)
        if edge <= 0:
            return 0.0
        u = x / w - 0.5
        t = 1 - z / h  # from the top
        width = 0.36 * (1 - 0.55 * t) + 0.05
        body = max(0.0, 1 - (u / width) ** 2)
        # fruit: a chain of bumps, alternating sides
        bumps = 0.0
        for k in range(9):
            zc = h * (0.92 - k * 0.095)
            xc = w * (0.5 + (0.12 if k % 2 else -0.12) * (1 - k / 12))
            rr = 0.024 * (1 - k * 0.05)
            dd = ((x - xc) ** 2 + (z - zc) ** 2) / rr ** 2
            bumps = max(bumps, math.exp(-dd) * (1 - k * 0.04))
        ribbon = math.exp(-((z - h * 0.97) / 0.01) ** 2) * math.exp(-(u / 0.3) ** 2)
        tassel = math.exp(-((x - w / 2) / 0.012) ** 2) * (1.0 if z < h * 0.12 else 0.0) * (z / (h * 0.12))
        leafv = body * (0.5 + 0.5 * math.sin(z * 90 + u * 12)) * 0.5
        return amp * min(1.0, max(bumps, leafv, ribbon * 0.7, tassel * 0.8)) * edge * (1.0 if t < 0.98 else 0.0)
    return f


def cartouche(w, h, amp=0.03, letters=True):
    """An oval cartouche: a raised oval field framed by a rolled border with scrolled ears, IHS carved on the field."""
    def f(x, z):
        u, v = (x - w / 2) / (w / 2), (z - h / 2) / (h / 2)
        r = math.hypot(u / 0.72, v / 0.92)
        border = math.exp(-((r - 0.88) / 0.07) ** 2)
        field = 0.45 if r < 0.82 else 0.0
        ears = 0.0
        for sx in (-1, 1):
            for sz in (-1, 1):
                d = math.hypot(u - sx * 0.80, v - sz * 0.62) / 0.16
                ears = max(ears, math.exp(-d * d) * (0.6 + 0.4 * math.cos(math.atan2(v - sz * 0.62, u - sx * 0.80) * 2 + d * 3)))
        top = math.exp(-((u / 0.18) ** 2) - ((v - 0.95) / 0.08) ** 2)
        ihs = 0.0
        if letters and r < 0.6:
            # three letters as strokes: I, H, S
            def stroke(px, pz, qx, qz, wdt=0.055):
                ax, az = u - px, v - pz
                bx_, bz = qx - px, qz - pz
                t = max(0.0, min(1.0, (ax * bx_ + az * bz) / (bx_ * bx_ + bz * bz)))
                return math.exp(-((ax - t * bx_) ** 2 + (az - t * bz) ** 2) / wdt ** 2)
            ihs = max(stroke(-0.42, -0.30, -0.42, 0.30), stroke(-0.16, -0.30, -0.16, 0.30), stroke(0.10, -0.30, 0.10, 0.30), stroke(-0.16, 0.0, 0.10, 0.0),
                      stroke(0.40, 0.28, 0.24, 0.20), stroke(0.24, 0.20, 0.36, 0.02), stroke(0.36, 0.02, 0.26, -0.24), stroke(0.26, -0.24, 0.40, -0.30),
                      stroke(-0.30, 0.42, -0.30, 0.60, 0.04), stroke(-0.39, 0.52, -0.21, 0.52, 0.04))
        if r > 1.02 and ears < 0.04 and top < 0.04:
            return None
        return amp * max(field + 0.35 * ihs, border, ears * 0.9, top * 0.8)
    return f


def medallion(w, h, amp=0.024, seed=0):
    """An oval medallion in a laurel border with a figure in low relief (a bust in profile), for the pulpit's tub."""
    rng = np.random.default_rng(seed)
    tilt = rng.uniform(-0.2, 0.2)

    def f(x, z):
        u, v = (x - w / 2) / (w / 2), (z - h / 2) / (h / 2)
        r = math.hypot(u, v)
        if r > 1.0:
            return None
        laurel = math.exp(-((r - 0.86) / 0.07) ** 2) * (0.7 + 0.3 * math.cos(math.atan2(v, u) * 22))
        # a head and shoulders in profile
        hd = math.exp(-((u + 0.05 + tilt * v) / 0.26) ** 2 - ((v - 0.18) / 0.32) ** 2)
        nose = math.exp(-((u - 0.24) / 0.06) ** 2 - ((v - 0.18) / 0.06) ** 2)
        sh = math.exp(-(u / 0.55) ** 2 - ((v + 0.55) / 0.22) ** 2)
        return amp * min(1.0, max(laurel, 0.8 * max(hd, nose * 0.8, sh)))
    return f




def oval_field(m, skin, cx, y, cz, rx, rz, dome=0.010, nr=6, na=40, hfun=None):
    """A raised oval field facing -y, its rim on the plane y, domed toward its middle (hfun(u, v) adds carving)."""
    P = np.zeros((nr + 1, na, 3))
    ST = np.zeros((nr + 1, na + 1, 2))
    for i in range(nr + 1):
        f = 1 - i / nr  # 1 at the rim, 0 at the middle
        for j in range(na + 1):
            a = 2 * math.pi * j / na
            u, v = f * math.cos(a), f * math.sin(a)
            hh = dome * math.sqrt(max(0.0, 1 - f * f)) + (hfun(u, v) if hfun else 0.0)
            if j < na:
                P[i, j] = (cx + rx * u, y - hh, cz + rz * v)
            ST[i, j] = (rx * u + rx, rz * v + rz)
    kit.grid(m, P, ST, skin, closed=True, outfn=lambda i, j, c: np.array((0, -1.0, 0)), thr=60.0)


def stroke(m, skin, pts, r=0.007):
    kit.sweep(m, [tuple(p) for p in pts], r, 6, skin, up=(0, -1, 0), thr=70.0, caps=(True, True))


def ihs(m, skin, cx, y, cz, h):
    """The letters IHS, cut in the round on a field facing -y, h high, a cross over the H."""
    w = h * 0.55
    r = h * 0.075
    y -= r * 0.6
    xs = (cx - w * 1.05, cx, cx + w * 1.05)
    stroke(m, skin, [(xs[0], y, cz - h / 2), (xs[0], y, cz + h / 2)], r)
    stroke(m, skin, [(xs[1] - w * 0.4, y, cz - h / 2), (xs[1] - w * 0.4, y, cz + h / 2)], r)
    stroke(m, skin, [(xs[1] + w * 0.4, y, cz - h / 2), (xs[1] + w * 0.4, y, cz + h / 2)], r)
    stroke(m, skin, [(xs[1] - w * 0.4, y, cz), (xs[1] + w * 0.4, y, cz)], r * 0.9)
    S_ = [(xs[2] + w * 0.38 * math.cos(a), y, cz + h * 0.25 + h * 0.24 * math.sin(a)) for a in np.linspace(math.radians(10), math.radians(270), 9)]
    S_ += [(xs[2] + w * 0.38 * math.cos(a), y, cz - h * 0.25 + h * 0.24 * math.sin(a)) for a in np.linspace(math.radians(90), math.radians(-170), 9)][1:]
    stroke(m, skin, S_, r)
    # the cross over the H
    stroke(m, skin, [(xs[1], y, cz + h * 0.56), (xs[1], y, cz + h * 0.92)], r * 0.8)
    stroke(m, skin, [(xs[1] - w * 0.22, y, cz + h * 0.78), (xs[1] + w * 0.22, y, cz + h * 0.78)], r * 0.8)


def cartouche_geo(m, skin, cx, y, cz, rx, rz, letters=True, ears=True):
    """A carved cartouche facing -y on the plane y: a domed oval field, a rolled border, scrolled ears at its four
    corners, a shell over it, IHS on the field."""
    oval_field(m, skin, cx, y, cz, rx * 0.86, rz * 0.86, dome=0.012)
    ring = [(cx + rx * 0.90 * math.cos(a), y - 0.012, cz + rz * 0.90 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 41)[:-1]]
    kit.sweep(m, ring, 0.018 * (rx + rz) / 0.6, 7, skin, closed=True, up=(0, -1, 0), thr=70.0)
    if ears:
        for sx in (-1, 1):
            for sz in (-1, 1):
                M = T(cx + sx * rx * 0.86, y - 0.01, cz + sz * rz * 0.72) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)) @ Matrix.Scale(-1 if sz < 0 else 1, 4, (0, 0, 1))
                scroll(m, skin, M, rx * 0.22, turns=1.3, r0=0.013 * (rx + rz) / 0.6, r1=0.004)
        for k in range(7):
            a = math.radians(30 + 120 * k / 6)
            leaf(m, skin, T(cx, y - 0.006, cz + rz * 0.88) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y"), rz * 0.32, rx * 0.16, curl=0.5, nl=5, nw=4)
    if letters:
        ihs(m, skin, cx, y - 0.012, cz - rz * 0.08, rz * 0.62)


# ------------------------------------------------------------------ carved work in the round


def ball(m, skin, c, r, sides=8, rings=5, squash=1.0):
    prof = [(r * math.sin(math.pi * k / rings), c[2] - r * squash * math.cos(math.pi * k / rings)) for k in range(rings + 1)]
    with m.at(T(c[0], c[1], 0)):
        kit.lathe(m, prof, sides, skin, thr=70.0)


def rosette(m, skin, c, r, petals=6, axis_y=True):
    """A small carved flower facing -y: a domed heart and petals round it."""
    with m.at(T(c[0], c[1], c[2]) @ RX(math.radians(90))):
        kit.lathe(m, [(0.0, 0.0), (r * 0.45, 0.0), (r * 0.42, r * 0.25), (r * 0.25, r * 0.42), (0.0, r * 0.48)], 8, skin, thr=70.0)
    for k in range(petals):
        a = 2 * math.pi * k / petals
        leaf(m, skin, T(c[0] + r * 0.35 * math.cos(a), c[1] + 0.002, c[2] + r * 0.35 * math.sin(a)) @ Matrix.Rotation(a - math.pi / 2, 4, "Y"),
             r * 0.75, r * 0.6, curl=0.3, nl=4, nw=4)


def vine(m, S, x0, x1, z0, z1, y, period=0.40):
    """The frieze's acanthus scroll in the round: a stem waving along the band (half sunk in it), from each wave a spiral
    tendril curling into the hollow with a flower in its eye, leaves where the tendrils branch."""
    carved = S["carved"]
    zc, amp = (z0 + z1) / 2, (z1 - z0) * 0.22
    r = 0.010
    xs = np.arange(x0, x1 + 1e-6, 0.02)
    stem = [(x, y - r * 0.55, zc + amp * math.sin(2 * math.pi * (x - x0) / period)) for x in xs]
    kit.sweep(m, stem, r, 6, carved, up=(0, -1, 0), thr=70.0, caps=(True, True))
    k = 0
    xw = x0 + period / 4
    while xw < x1 - period / 8:
        up = (k % 2 == 0)
        # the tendril leaves the stem at the wave's crest and curls into the hollow beyond it
        zt = zc + amp * (1 if up else -1)
        cx = xw + period * 0.25
        cz = zc - amp * 0.35 * (1 if up else -1)
        R = (z1 - z0) * 0.30
        pts, rad = [], []
        n = 26
        for q in range(n):
            t = q / (n - 1)
            a = (math.pi / 2 if up else -math.pi / 2) + (1 if up else -1) * (-t * 1.75 * 2 * math.pi)
            rr = R * (1 - 0.82 * t)
            pts.append((cx + rr * math.cos(a) * 0.95, y - 0.007, cz + rr * math.sin(a)))
            rad.append(0.0075 * (1 - 0.6 * t) + 0.002)
        pts[0] = (xw, y - 0.008, zt)
        kit.sweep(m, pts, rad, 6, carved, up=(0, -1, 0), thr=70.0, caps=(True, True))
        rosette(m, carved, (pts[-1][0], y - 0.012, pts[-1][2]), 0.024)
        # two acanthus leaves at the branching, one along the stem and one along the tendril
        leaf(m, carved, T(xw, y - 0.004, zt) @ Matrix.Rotation(math.radians(-70 if up else -110), 4, "Y"), 0.075, 0.05, curl=0.4, nl=6, nw=5)
        leaf(m, carved, T(xw, y - 0.004, zt) @ Matrix.Rotation(math.radians(70 if up else 110), 4, "Y"), 0.06, 0.04, curl=0.5, nl=6, nw=5)
        xw += period / 2
        k += 1


def garland_drop(m, S, x, ztop, length, y):
    """A carved drop hanging down a pilaster: a ribbon bow, fruit and leaves getting smaller downward, a tassel."""
    carved = S["carved"]
    # the bow: two loops and two tails
    for sx in (-1, 1):
        loop = [(x + sx * (0.012 + 0.022 * (1 - math.cos(a))), y - 0.012 - 0.006 * math.sin(a), ztop + 0.020 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 13)[:-1]]
        kit.sweep(m, loop, 0.0045, 5, carved, closed=True, up=(0, -1, 0), thr=70.0)
        kit.sweep(m, [(x, y - 0.012, ztop), (x + sx * 0.016, y - 0.012, ztop - 0.05), (x + sx * 0.010, y - 0.010, ztop - 0.09)], [0.005, 0.004, 0.003], 5, carved,
                  up=(0, -1, 0), thr=70.0, caps=(False, True))
    ball(m, carved, (x, y - 0.012, ztop), 0.011, sides=7, rings=4)
    z = ztop - 0.04
    k = 0
    while z > ztop - length + 0.06:
        t = (ztop - z) / length
        rr = 0.030 * (1 - 0.55 * t)
        sx = -1 if k % 2 else 1
        # a pear, a pomegranate, grapes: a ball and a smaller one beside it, a leaf behind them
        ball(m, carved, (x + sx * rr * 0.35, y - rr * 0.9, z), rr, sides=8, rings=5, squash=1.15)
        ball(m, carved, (x - sx * rr * 0.75, y - rr * 0.65, z + rr * 0.6), rr * 0.6, sides=7, rings=4)
        leaf(m, carved, T(x + sx * rr * 0.9, y - 0.004, z + rr * 0.3) @ Matrix.Rotation(sx * math.radians(-120), 4, "Y"), rr * 2.0, rr * 1.2, curl=0.5, nl=5, nw=4)
        z -= rr * 1.7
        k += 1
    with m.at(T(x, y - 0.008, z)):
        kit.lathe(m, [(0.0, 0.03), (0.008, 0.026), (0.010, 0.012), (0.004, -0.04), (0.0, -0.045)], 7, carved, thr=60.0)


# ------------------------------------------------------------------ the confessional

CW = 1.49  # half its width
CD = 1.35  # its depth from the pilasters' faces to the wall
PIL = ((-1.37, 0.10), (-0.58, 0.10), (0.58, 0.10), (1.37, 0.10))  # pilaster centres and half widths
Z_PL, Z_AR, Z_FR, Z_CO, Z_TOP = 0.14, 2.30, 2.42, 2.66, 3.03  # plinth top, architrave, frieze, cornice foot, cornice top
FACE = 0.03  # the bays' frame face stands this far behind the pilasters' faces


def at_z(z):
    return ((0, 0, z), (1, 0, 0), (0, 1, 0), (0, 0, 1))


def arch_pts(x0, x1, zs, rise, n=14):
    """A segmental arch from (x0, zs) to (x1, zs) rising `rise` at its middle."""
    half = (x1 - x0) / 2
    R = (half * half + rise * rise) / (2 * rise)
    cx, cz = (x0 + x1) / 2, zs + rise - R
    a0 = math.atan2(zs - cz, x0 - cx)
    a1 = math.atan2(zs - cz, x1 - cx)
    return [(cx + R * math.cos(a0 + (a1 - a0) * k / n), cz + R * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


def spandrels(m, skin, x0, x1, zs, rise, ztop, y0, y1):
    """The board over an arched opening between x0 and x1 up to ztop, its two halves as prisms (y0..y1 deep)."""
    arc = arch_pts(x0, x1, zs, rise, 16)
    mid = len(arc) // 2
    left = [(x0, zs), (x0, ztop), ((x0 + x1) / 2, ztop)] + [tuple(p) for p in arc[mid:0:-1]]
    right = [((x0 + x1) / 2, ztop), (x1, ztop), (x1, zs)] + [tuple(p) for p in arc[-2:mid - 1:-1]]
    for poly in (left, right):
        with m.at(T(0, y1, 0) @ RX(math.radians(90))):
            kit.prism(m, poly, 0.0, y1 - y0, skin, c=0.0, thr=30.0, caps=(False, True))


def pilaster(m, S, x, hw, z1, face_y):
    """A panelled pilaster: a moulded base, a shaft with a sunk panel and a carved drop of fruit hanging in it, a capital of
    acanthus leaves and small volutes under a moulded abacus."""
    oak, carved, long_ = S["oak"], S["carved"], S["long"]
    d = 0.10  # its depth back from the face to the frame
    bx(m, x - hw - 0.02, face_y - 0.02, 0.0, x + hw + 0.02, face_y + d, 0.08, S["oakd"], c=0.004, skip=((2, -1),))
    base = [(0.0, 0.0), (0.012, 0.004), (0.016, 0.016), (0.012, 0.028), (0.004, 0.034), (0.004, 0.048), (0.0, 0.05)]
    sides = [(x - hw, face_y + d), (x - hw, face_y), (x + hw, face_y), (x + hw, face_y + d)]
    run(m, base, sides, long_, frame=at_z(0.08), caps=(False, False))
    zs0, zs1 = 0.13, z1 - 0.20
    member(m, (x - hw, face_y, zs0 - 0.002), (x - hw + 0.035, face_y + d, zs1 + 0.002), 2, long_)
    member(m, (x + hw - 0.035, face_y, zs0 - 0.002), (x + hw, face_y + d, zs1 + 0.002), 2, long_)
    bx(m, x - hw + 0.035, face_y + 0.012, zs0 - 0.002, x + hw - 0.035, face_y + d, zs0 + 0.03, oak, c=0.003)
    bx(m, x - hw + 0.035, face_y + 0.012, zs1 - 0.03, x + hw - 0.035, face_y + d, zs1 + 0.002, oak, c=0.003)
    member(m, (x - hw + 0.035, face_y + 0.016, zs0 + 0.03), (x + hw - 0.035, face_y + d, zs1 - 0.03), 2, long_, c=0.0, caps=(False, False))
    garland_drop(m, S, x, zs1 - 0.07, (zs1 - zs0) * 0.62, face_y + 0.016)
    # the capital: a necking, a bell with two rows of leaves, corner volutes, the abacus
    zc = zs1
    bx(m, x - hw, face_y, zc, x + hw, face_y + d, zc + 0.018, oak, c=0.003)
    bx(m, x - hw + 0.01, face_y + 0.008, zc + 0.018, x + hw - 0.01, face_y + d, zc + 0.16, carved, c=0.003)
    for lx in np.linspace(x - hw + 0.04, x + hw - 0.04, 3):
        leaf(m, carved, T(lx, face_y + 0.006, zc + 0.02), 0.085, 0.06, curl=0.7)
    for lx in np.linspace(x - hw + 0.065, x + hw - 0.065, 2):
        leaf(m, carved, T(lx, face_y + 0.004, zc + 0.07), 0.09, 0.055, curl=0.9)
    for sx in (-1, 1):
        scroll(m, carved, T(x + sx * (hw - 0.02), face_y - 0.004, zc + 0.145) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)), 0.03,
               turns=1.4, r0=0.007, r1=0.003)
    ab = [(0.0, 0.0), (0.03, 0.0), (0.03, 0.008), (0.038, 0.016), (0.038, 0.034), (0.0, 0.036)]
    run(m, ab, sides, long_, frame=at_z(zc + 0.16), caps=(True, True))


def curtain(m, skin, x_rod0, x_rod1, x_tie, z_rod, z_tie, z_foot, y, nx=14, nz=26):
    """A velvet curtain hanging from a rod in folds, drawn to one side by a tie-back at z_tie; two faced."""
    P = np.zeros((nz + 1, nx + 1, 3))
    ST = np.zeros((nz + 1, nx + 1, 2))
    for i in range(nz + 1):
        z = z_rod - (z_rod - z_foot) * i / nz
        if z >= z_tie:
            k = (z_rod - z) / (z_rod - z_tie)
            k = k * k * (3 - 2 * k)
        else:
            k = 1 - 0.35 * ((z_tie - z) / (z_tie - z_foot)) ** 1.5
        for j in range(nx + 1):
            s = j / nx
            x_free = x_rod0 + (x_rod1 - x_rod0) * s
            x_drawn = x_rod0 + (x_tie - x_rod0) * s
            x = x_free + (x_drawn - x_free) * k
            amp = 0.020 * (1 + 0.9 * k)
            fold = amp * math.sin(s * math.pi * 9)
            P[i, j] = (x, y + fold - 0.02 * k, z)
            ST[i, j] = (s * abs(x_rod1 - x_rod0), (z_rod - z))
    kit.grid(m, P, ST, skin, outfn=lambda i, j, c: np.array((0, -1.0, 0)), thr=70.0)
    kit.grid(m, P + np.array((0, 0.006, 0)), ST, skin, outfn=lambda i, j, c: np.array((0, 1.0, 0)), shade=0.55, thr=70.0)
    cx = (x_rod0 + x_tie) / 2
    rx = abs(x_tie - x_rod0) / 2 + 0.012
    ring = [(cx + rx * math.cos(a), y - 0.01 + 0.045 * math.sin(a), z_tie) for a in np.linspace(0, 2 * math.pi, 15)[:-1]]
    kit.sweep(m, ring, 0.007, 6, skin, closed=True, up=(0, 0, 1), thr=70.0)


def grille(m, S, y0, y1, z0, z1, xw):
    """A pierced grille in a partition at x = xw (y0..y1 along it, z0..z1 high): an oak frame and turned spindles."""
    oak = S["oak"]
    t = 0.025
    for a0, a1 in ((z0 - 0.04, z0), (z1, z1 + 0.04)):
        bx(m, xw - t, y0 - 0.04, a0, xw + t, y1 + 0.04, a1, oak, c=0.003)
    for b in (y0 - 0.04, y1):
        bx(m, xw - t, b, z0, xw + t, b + 0.04, z1, oak, c=0.003)
    h = z1 - z0
    prof = [(0.0, 0.0), (0.007, 0.0), (0.007, 0.02)] + [(0.007 + 0.004 * math.sin(math.pi * q / 6) ** 2, 0.02 + (h - 0.04) * q / 6) for q in range(1, 6)] + \
           [(0.007, h - 0.02), (0.007, h), (0.0, h)]
    for k in range(1, 8):
        yb = y0 + (y1 - y0) * k / 8
        with m.at(T(xw, yb, z0)):
            kit.lathe(m, prof, 6, S["carved"], thr=55.0)
    bx(m, xw - 0.009, y0, (z0 + z1) / 2 - 0.009, xw + 0.009, y1, (z0 + z1) / 2 + 0.009, oak, c=0.002)


def glory(m, S, cx, cy, cz, r=0.31, rays=32):
    """A gilt glory: a moulded disc with IHS cut on it, rays round it, long and short in turn, a cross on top."""
    gilt = S["gilt"]
    with m.at(T(cx, cy + 0.03, cz) @ RX(math.radians(90))):
        kit.lathe(m, [(0.0, 0.0), (r * 0.50, 0.0), (r * 0.53, 0.010), (r * 0.53, 0.022), (r * 0.50, 0.030), (0.0, 0.030)], 28, gilt, thr=40.0)
    oval_field(m, gilt, cx, cy, cz, r * 0.47, r * 0.47, dome=0.010)
    ihs(m, gilt, cx, cy - 0.010, cz - r * 0.05, r * 0.40)
    for k in range(rays):
        a = 2 * math.pi * k / rays + math.pi / rays
        L = r * (1.0 if k % 2 == 0 else 0.78)
        w0 = 0.016 if k % 2 == 0 else 0.011
        outline = [(r * 0.52, -w0), (L, -0.0025), (L + 0.004, 0.0), (L, 0.0025), (r * 0.52, w0)]
        with m.at(T(cx, cy + 0.020, cz) @ Matrix.Rotation(-a, 4, "Y") @ RX(math.radians(90))):
            kit.prism(m, outline, 0.0, 0.008, gilt, c=0.0015, thr=40.0)
    bx(m, cx - 0.009, cy + 0.01, cz + r * 1.0, cx + 0.009, cy + 0.028, cz + r * 1.32, gilt, c=0.002)
    bx(m, cx - 0.045, cy + 0.01, cz + r * 1.17, cx + 0.045, cy + 0.028, cz + r * 1.20, gilt, c=0.002)


def confessional(A):
    C = cells(A)
    S = skins(A)
    S["long"] = Along(C["oak"])
    S["longd"] = Along(C["oakd"])
    oak, oakh, oakd, carved, long_ = S["oak"], S["oakh"], S["oakd"], S["carved"], S["long"]
    m = kit.Mesh("confessional")
    W, D = CW, CD
    fy = FACE
    # --- the plinth: a moulded base along the front of the side bays and round the ends (open at the middle bay);
    # the side bays' floors are oak boards on it
    plinth = [(0.0, 0.0), (0.035, 0.0), (0.035, 0.07), (0.045, 0.08), (0.045, 0.10), (0.03, 0.12), (0.012, 0.13), (0.012, 0.14), (0.0, 0.14)]
    for sx in (-1, 1):
        path = [(sx * W, D - 0.01), (sx * W, -0.03), (sx * 0.48, -0.03)]
        if sx > 0:
            path = path[::-1]
        run(m, plinth, path, S["longd"], caps=(True, True))
        x0, x1 = sorted((sx * 0.48, sx * W))
        boards(m, x0, -0.03, Z_PL - 0.025, x1, D - 0.03, Z_PL - 0.002, S["longd"], along=0, width=0.17)
    # --- the carcass: the back against the wall and the ceilings, oak boards
    bx(m, -W, D - 0.03, 0.0, W, D, Z_AR, S["dark"], c=0.0, skip=((1, 1),))
    for x0, x1 in ((-W + 0.05, -0.60), (-0.56, 0.56), (0.60, W - 0.05)):
        boards(m, x0, fy, Z_AR - 0.03, x1, D - 0.03, Z_AR, long_, along=1, width=0.16)
    # the bays' back walls panelled: rails at the foot, at 0.9 m and at the top, stiles, fielded panels between
    for x0, x1, zf in ((-1.27, -0.68, Z_PL), (-0.48, 0.48, 0.0), (0.68, 1.27, Z_PL)):
        for z0, z1 in ((zf + 0.06, 0.90), (0.98, Z_AR - 0.08)):
            field_panel(m, x0 + 0.05, z0, x1 - 0.05, z1, D - 0.03, oak, raise_=0.012, bevel=0.045)
        member(m, (x0, D - 0.06, 0.90), (x1, D - 0.03, 0.98), 0, long_)
        member(m, (x0, D - 0.06, zf), (x1, D - 0.03, zf + 0.06), 0, long_)
        member(m, (x0, D - 0.06, Z_AR - 0.08), (x1, D - 0.03, Z_AR - 0.03), 0, long_)
        member(m, (x0, D - 0.06, zf), (x0 + 0.05, D - 0.03, Z_AR - 0.03), 2, long_)
        member(m, (x1 - 0.05, D - 0.06, zf), (x1, D - 0.03, Z_AR - 0.03), 2, long_)
    # --- the ends: framed and panelled sides, their outside faces at x = +-W
    L = D - 0.11 - fy - 0.08
    for sx in (-1, 1):
        x0, x1 = sorted((sx * W, sx * (W - 0.05)))
        member(m, (x0, fy, Z_PL), (x1, fy + 0.08, Z_AR), 2, long_)
        member(m, (x0, D - 0.11, Z_PL), (x1, D - 0.03, Z_AR), 2, long_)
        for z0, z1 in ((Z_PL, Z_PL + 0.08), (1.02, 1.10), (Z_AR - 0.09, Z_AR)):
            member(m, (x0, fy + 0.08, z0), (x1, D - 0.11, z1), 1, long_)
        bx(m, x0 + (0.014 if sx < 0 else 0.0), fy + 0.08, Z_PL + 0.08, x1 - (0.0 if sx < 0 else 0.014), D - 0.11, Z_AR - 0.09, S["dark"], c=0.0)
        for z0, z1 in ((Z_PL + 0.08, 1.02), (1.10, Z_AR - 0.09)):
            if sx < 0:
                with m.at(T(-W + 0.014, fy + 0.08 + L, 0) @ RZ(math.radians(-90))):
                    field_panel(m, 0.0, z0, L, z1, 0.0, oak, raise_=0.014, bevel=0.06)
            else:
                with m.at(T(W - 0.014, fy + 0.08, 0) @ RZ(math.radians(90))):
                    field_panel(m, 0.0, z0, L, z1, 0.0, oak, raise_=0.014, bevel=0.06)
    # --- the partitions between the bays (x = +-0.58), with a grille into the middle bay
    gy0, gy1, gz0, gz1 = 0.30, 0.70, 0.98, 1.48
    for sx in (-1, 1):
        xw = sx * 0.58
        member(m, (xw - 0.02, fy + 0.08, 0.0), (xw + 0.02, gy0 - 0.04, Z_AR - 0.03), 2, long_)
        member(m, (xw - 0.02, gy1 + 0.04, 0.0), (xw + 0.02, D - 0.06, Z_AR - 0.03), 2, long_)
        bx(m, xw - 0.02, gy0 - 0.04, 0.0, xw + 0.02, gy1 + 0.04, gz0 - 0.04, oak, c=0.002)
        bx(m, xw - 0.02, gy0 - 0.04, gz1 + 0.04, xw + 0.02, gy1 + 0.04, Z_AR - 0.03, oak, c=0.002)
        grille(m, S, gy0, gy1, gz0, gz1, xw)
        # the penitent's elbow rest under the grille, on two carved brackets
        ex0, ex1 = sorted((xw + sx * 0.02, xw + sx * 0.16))
        bx(m, ex0, gy0 - 0.06, gz0 - 0.09, ex1, gy1 + 0.06, gz0 - 0.055, oakh, c=0.003)
        for gy in (gy0, gy1 - 0.03):
            b0, b1 = sorted((xw + sx * 0.02, xw + sx * 0.06))
            bx(m, b0, gy, gz0 - 0.22, b1, gy + 0.03, gz0 - 0.09, carved, c=0.005)
    # --- the front: pilasters, the arched openings, the spandrels
    for x, hw in PIL:
        pilaster(m, S, x, hw, Z_AR, 0.0)
    bays = [(-1.27, -0.68, 1.72, 0.20, Z_PL), (-0.48, 0.48, 1.92, 0.26, 0.0), (0.68, 1.27, 1.72, 0.20, Z_PL)]
    face = ((0, fy, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    for x0, x1, zs, rise, zf in bays:
        spandrels(m, oak, x0, x1, zs, rise, Z_AR - 0.12, fy, fy + 0.03)
        member(m, (x0, fy, Z_AR - 0.12), (x1, fy + 0.03, Z_AR), 0, long_, c=0.0)
        arc = arch_pts(x0, x1, zs, rise, 16)
        path = [(x0, zf + 0.02)] + arc + [(x1, zf + 0.02)]
        prof = [(0.0, 0.0), (0.0, 0.016), (-0.010, 0.024), (-0.030, 0.026), (-0.044, 0.018), (-0.050, 0.008), (-0.058, 0.0)]
        run(m, prof, path, long_, frame=face, tile=0.2)
        xm = (x0 + x1) / 2
        ztop = zs + rise
        bx(m, xm - 0.045, fy - 0.035, ztop - 0.01, xm + 0.045, fy, Z_AR - 0.005, carved, c=0.005)
        leaf(m, carved, T(xm, fy - 0.037, ztop - 0.005), Z_AR - ztop - 0.02, 0.07, curl=0.4)
        member(m, (x0 - 0.012, fy, zf), (x0, fy + 0.08, zs), 2, long_, c=0.002)
        member(m, (x1, fy, zf), (x1 + 0.012, fy + 0.08, zs), 2, long_, c=0.002)
    for x0, x1 in ((-W, -1.47), (1.47, W)):
        member(m, (x0, fy, Z_PL), (x1, fy + 0.03, Z_AR), 2, long_, c=0.002)
    # --- the kneeling steps before the side bays, the middle bay's threshold
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.70, sx * 1.25))
        bx(m, x0, -0.34, 0.0, x1, fy + 0.30, 0.15, oakd, c=0.004, skip=((2, -1),))
        run(m, [(0.0, 0.0), (0.012, 0.0), (0.016, 0.008), (0.012, 0.018), (0.0, 0.02)], [(x0, fy + 0.30), (x0, -0.34), (x1, -0.34), (x1, fy + 0.30)],
            S["longd"], frame=at_z(0.14), caps=(True, True))
    bx(m, -0.48, -0.02, 0.0, 0.48, fy + 0.10, 0.025, oakd, c=0.003, skip=((2, -1),))
    # --- the middle bay's curtains, tied back to its jambs
    rod_z = 2.12
    for sx in (-1, 1):
        curtain(m, S["velvet"], sx * 0.47, sx * 0.03, sx * 0.40, rod_z, 1.10, 0.03, fy + 0.13)
    kit.sweep(m, [(-0.50 + q / 8, fy + 0.13, rod_z + 0.02) for q in range(9)], 0.009, 8, S["brass"], up=(0, 0, 1), caps=(True, True), thr=50.0)
    # --- the entablature: the architrave and the cornice run along the front and return along both sides
    ent_path = [(-W, D - 0.005), (-W, -0.03), (W, -0.03), (W, D - 0.005)]
    arch_prof = [(0.0, 0.0), (0.012, 0.0), (0.012, 0.045), (0.022, 0.055), (0.022, 0.095), (0.036, 0.105), (0.036, 0.12), (0.0, 0.12)]
    run(m, arch_prof, ent_path, long_, frame=at_z(Z_AR))
    # the frieze: an acanthus scroll carved in the round across the front, panels along the sides
    member(m, (-W, -0.03, Z_FR), (W, D - 0.005, Z_CO), 0, long_)
    vine(m, S, -W + 0.06, W - 0.06, Z_FR + 0.02, Z_CO - 0.02, -0.03)
    for sx in (-1, 1):
        for y0, y1 in ((0.08, 0.62), (0.70, 1.24)):
            if sx < 0:
                with m.at(T(-W, y1, 0) @ RZ(math.radians(-90))):
                    field_panel(m, 0.0, Z_FR + 0.04, y1 - y0, Z_CO - 0.04, 0.0, oak, raise_=0.008, bevel=0.03)
            else:
                with m.at(T(W, y0, 0) @ RZ(math.radians(90))):
                    field_panel(m, 0.0, Z_FR + 0.04, y1 - y0, Z_CO - 0.04, 0.0, oak, raise_=0.008, bevel=0.03)
    # the cornice: bed mould, dentil band, corona, cyma recta, top fillet
    co = [(0.0, 0.0), (0.012, 0.0), (0.018, 0.012), (0.030, 0.026), (0.046, 0.032), (0.048, 0.040), (0.050, 0.042), (0.050, 0.046),
          (0.075, 0.046), (0.075, 0.098), (0.080, 0.100), (0.150, 0.110), (0.165, 0.118), (0.168, 0.124), (0.168, 0.196),
          (0.172, 0.200), (0.182, 0.214), (0.198, 0.248), (0.212, 0.282), (0.222, 0.300), (0.230, 0.312), (0.236, 0.318),
          (0.236, 0.355), (0.0, 0.37)]
    run(m, co, ent_path, long_, frame=at_z(Z_CO))
    zd0, zd1 = Z_CO + 0.050, Z_CO + 0.094
    for x in np.arange(-W + 0.06, W - 0.04, 0.05):
        bx(m, x - 0.014, -0.03 - 0.073, zd0, x + 0.014, -0.03 - 0.049, zd1, oak, c=0.0025)
    for sx in (-1, 1):
        for y in np.arange(0.03, D - 0.05, 0.05):
            x0, x1 = sorted((sx * (W + 0.049), sx * (W + 0.073)))
            bx(m, x0, y - 0.014, zd0, x1, y + 0.014, zd1, oak, c=0.0025)
    boards(m, -W - 0.2, -0.25, Z_TOP - 0.02, W + 0.2, D - 0.005, Z_TOP - 0.004, long_, along=0, width=0.18, c=0.002)
    # --- the crest: a carved board round a cartouche, two great scrolls falling to the cornice, the gilt glory on top
    cy = 0.12
    zb = Z_TOP - 0.004
    crest = [(-0.42, zb), (0.42, zb), (0.42, zb + 0.40)] + [(0.42 * math.cos(a), zb + 0.40 + 0.34 * math.sin(a)) for a in np.linspace(0, math.pi, 15)[1:-1]] + [(-0.42, zb + 0.40)]
    with m.at(T(0, cy + 0.07, 0) @ RX(math.radians(90))):
        kit.prism(m, crest, 0.0, 0.07, carved, c=0.004, thr=30.0)
    rim = crest[1:] + crest[:1]
    run(m, [(0.0, 0.0), (0.0, 0.012), (-0.010, 0.022), (-0.026, 0.024), (-0.036, 0.014), (-0.04, 0.0)], rim[::-1],
        Along(C["carved"]), frame=((0, cy, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0)), closed=True, tile=0.12)
    cartouche_geo(m, carved, 0.0, cy, zb + 0.40, 0.27, 0.30)
    for sx in (-1, 1):
        Ms = T(sx * 0.53, cy + 0.03, zb + 0.14) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0))
        scroll(m, carved, Ms, 0.11, turns=1.25, r0=0.030, r1=0.010, tail=0.20)
        leaf(m, carved, T(sx * 0.47, cy - 0.01, zb + 0.02), 0.26, 0.10, curl=0.8)
        with m.at(T(sx * 0.72, cy + 0.04, zb)):
            kit.lathe(m, [(0.0, 0.0), (0.06, 0.0), (0.06, 0.02), (0.035, 0.035), (0.03, 0.05), (0.07, 0.10), (0.075, 0.14), (0.05, 0.19),
                          (0.032, 0.20), (0.036, 0.215), (0.0, 0.22)], 14, carved, thr=50.0)
            kit.lathe(m, [(0.0, 0.215), (0.028, 0.22), (0.02, 0.27), (0.008, 0.33), (0.0, 0.35)], 10, S["gilt"], thr=60.0)
    glory(m, S, 0.0, cy - 0.03, zb + 1.06, r=0.31)
    return m


# ------------------------------------------------------------------ the pulpit

TUB_R = 0.98  # the tub's octagon, corner radius
TUB_FLOOR, TUB_TOP = 2.80, 3.80
# The tub stands against a nave pillar (round, 2 m across, its middle 1.4 m behind the tub's): the stair runs along the
# pillar's side (Blender y, from its foot out in the arcade to its head at the landing), the landing beside the tub's
# doorway on its +x side.
STAIR_X0, STAIR_X1 = 1.28, 2.03  # the stair's width (Blender x)
STAIR_TOP_Y, STAIR_FOOT_Y = 0.85, 3.65
PILLAR_FACE_Y = 0.40  # the pillar's face behind the tub
BOARD_Z = 6.00  # the sounding board's soffit


def octagon(r, z=None, a0=math.pi / 8):
    return [(r * math.cos(a0 + k * math.pi / 4), r * math.sin(a0 + k * math.pi / 4)) for k in range(8)]


def side_frame(phi, ap):
    """A frame on the octagon's side whose outward normal is at angle phi: local x along the side, z up, -y outward."""
    return T(ap * math.cos(phi), ap * math.sin(phi), 0) @ RZ(phi + math.pi / 2)


def bust(u, v):
    """A bust in profile for a medallion (u, v in -1..1 over the oval)."""
    hd = math.exp(-((u + 0.05) / 0.30) ** 2 - ((v - 0.22) / 0.34) ** 2)
    nose = math.exp(-((u - 0.27) / 0.06) ** 2 - ((v - 0.22) / 0.07) ** 2)
    sh = math.exp(-(u / 0.62) ** 2 - ((v + 0.62) / 0.26) ** 2)
    return 0.018 * max(hd, 0.8 * nose, 0.9 * sh)


def medallion_geo(m, skin, cx, y, cz, rx, rz):
    """A tub medallion: a domed oval with a bust in profile, a laurel ring round it."""
    oval_field(m, skin, cx, y, cz, rx * 0.84, rz * 0.84, dome=0.006, nr=9, na=36, hfun=lambda u, v: bust(u, v) * (1 if u * u + v * v < 0.9 else 0))
    ring = [(cx + rx * 0.90 * math.cos(a), y - 0.010, cz + rz * 0.90 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 33)[:-1]]
    kit.sweep(m, ring, 0.013, 6, skin, closed=True, up=(0, -1, 0), thr=70.0)
    for k in range(16):
        a = 2 * math.pi * k / 16
        for side in (-1, 1):
            leaf(m, skin, T(cx + rx * 0.90 * math.cos(a), y - 0.016, cz + rz * 0.90 * math.sin(a)) @ Matrix.Rotation(-a + side * 0.55, 4, "Y"),
                 0.05, 0.022, curl=0.15, nl=4, nw=4)


def dove(m, gilt, cx, cy, cz, k=1.0):
    """The Holy Ghost under the sounding board: a gilt dove, wings spread, in a glory of rays (seen from below)."""
    with m.at(T(cx, cy, cz) @ RX(math.radians(90))):
        kit.lathe(m, [(0.0, -0.11 * k), (0.03 * k, -0.08 * k), (0.045 * k, -0.02 * k), (0.04 * k, 0.04 * k), (0.025 * k, 0.08 * k), (0.0, 0.10 * k)], 10, gilt, thr=70.0)
    for sx in (-1, 1):
        wing = [(0.0, -0.04 * k), (0.22 * k, -0.05 * k), (0.30 * k, 0.0), (0.24 * k, 0.04 * k), (0.0, 0.035 * k)]
        if sx < 0:
            wing = [(-x, y) for x, y in wing][::-1]
        with m.at(T(cx, cy, cz - 0.012)):
            kit.prism(m, wing, 0.0, 0.012, gilt, c=0.002, thr=40.0)
    for q in range(24):
        a = 2 * math.pi * q / 24
        L = (0.55 if q % 2 == 0 else 0.42) * k
        outline = [(0.16 * k, -0.012), (L, -0.002), (L, 0.002), (0.16 * k, 0.012)]
        with m.at(T(cx, cy, cz + 0.004) @ RZ(a)):
            kit.prism(m, outline, 0.0, 0.006, gilt, c=0.001, thr=40.0)


def disc8(m, skin, r, z, up=True, rings=5):
    prof = [(r * k / rings, z) for k in range(rings + 1)]
    if not up:
        prof = prof[::-1]
    kit.lathe(m, prof, 8, skin, a0=math.pi / 8, thr=20.0)


def pulpit(A):
    C = cells(A)
    S = skins(A)
    S["long"] = Along(C["oak"])
    S["longd"] = Along(C["oakd"])
    oak, oakh, oakd, carved, gilt, long_ = S["oak"], S["oakh"], S["oakd"], S["carved"], S["gilt"], S["long"]
    lc = Along(C["carved"])
    m = kit.Mesh("pulpit")
    # --- the base: a moulded octagonal plinth
    base_prof = [(0.0, 0.0), (0.06, 0.0), (0.06, 0.05), (0.07, 0.06), (0.07, 0.08), (0.05, 0.10), (0.03, 0.12), (0.0, 0.12)]
    oc = octagon(0.56)
    run(m, base_prof, oc[::-1], S["longd"], closed=True, tile=0.5)
    disc8(m, oakd, 0.57, 0.118, up=False)
    # --- the trunk: an oak tree carved in the round, its bark in ridges, four boughs spreading under the tub
    def bark(a, r, z):
        return r * (1 + 0.06 * math.sin(a * 9 + z * 3) + 0.03 * math.sin(a * 23 - z * 7))
    prof = [(0.27, 0.12), (0.24, 0.20), (0.21, 0.40), (0.19, 0.80), (0.18, 1.30), (0.18, 1.70), (0.20, 1.95), (0.24, 2.10), (0.28, 2.20)]
    kit.lathe(m, dense(prof, 0.3), 18, carved, radial=bark, thr=60.0)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        d = np.array((math.cos(a), math.sin(a), 0.0))
        path = [tuple(d * 0.15 + (0, 0, 1.70)), tuple(d * 0.34 + (0, 0, 1.98)), tuple(d * 0.52 + (0, 0, 2.16)), tuple(d * 0.66 + (0, 0, 2.30))]
        kit.sweep(m, path, [0.075, 0.06, 0.045, 0.03], 8, carved, up=(0, 0, 1), thr=60.0, caps=(False, True))
        for q in range(5):
            b = a + (q - 2) * 0.35
            leaf(m, carved, T(0.58 * math.cos(b), 0.58 * math.sin(b), 2.18) @ RZ(b + math.pi / 2) @ RX(math.radians(-60)), 0.20, 0.10, curl=0.7)
    # --- the tub's foot (cul-de-lampe): an octagonal bowl of mouldings, eight acanthus leaves hanging from it, a pendant
    bowl = [(0.0, 2.00), (0.08, 2.02), (0.12, 2.08), (0.22, 2.16), (0.40, 2.30), (0.62, 2.46), (0.82, 2.60), (0.93, 2.68), (0.97, 2.72),
            (1.00, 2.74), (1.00, 2.80)]
    kit.lathe(m, bowl, 8, carved, a0=math.pi / 8, thr=35.0, caps=(False, True))
    for k in range(8):
        phi = k * math.pi / 4
        M = T(1.01 * math.cos(phi), 1.01 * math.sin(phi), 2.70) @ RZ(phi + math.pi / 2) @ RX(math.radians(-118))
        leaf(m, carved, M, 0.50, 0.30, curl=1.1, nl=9, nw=7)
    with m.at(T(0, 0, 1.70)):
        kit.lathe(m, [(0.0, 0.0), (0.05, 0.03), (0.08, 0.10), (0.07, 0.18), (0.10, 0.26), (0.12, 0.30), (0.0, 0.32)], 12, gilt, thr=60.0)
    # --- the tub: eight corner posts with drops, seven carved panels and the doorway at the back, mouldings round it
    ap = TUB_R * math.cos(math.pi / 8)
    side = 2 * TUB_R * math.sin(math.pi / 8)
    run(m, [(0.0, 0.0), (0.03, 0.0), (0.04, 0.012), (0.04, 0.05), (0.025, 0.07), (0.0, 0.08)], octagon(TUB_R)[::-1], Along(C["carved"]),
        frame=at_z(TUB_FLOOR - 0.02), closed=True, tile=0.4)
    for k in range(8):
        phi = k * math.pi / 4 - math.pi / 2
        if abs(math.cos(phi) - 1.0) < 1e-6:
            continue  # the +x side is the doorway, at the landing
        with m.at(side_frame(phi, ap)):
            w = side - 0.12
            bx(m, -w / 2, 0.0, TUB_FLOOR + 0.06, w / 2, 0.035, TUB_TOP - 0.20, oak, c=0.003)
            medallion_geo(m, carved, 0.0, 0.0, (TUB_FLOOR + TUB_TOP) / 2 - 0.05, 0.20, 0.26)
            # festoons over the medallion and a cherub's head would be the next step; a pair of small scrolls stand for them
            for sx in (-1, 1):
                scroll(m, carved, T(sx * 0.20, -0.006, TUB_TOP - 0.30) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)), 0.04, turns=1.3, r0=0.008, r1=0.003)
    for k in range(8):
        a = math.pi / 8 + k * math.pi / 4
        c = np.array((TUB_R * 0.97 * math.cos(a), TUB_R * 0.97 * math.sin(a)))
        with m.at(T(c[0], c[1], 0) @ RZ(a)):
            member(m, (-0.05, -0.045, TUB_FLOOR), (0.05, 0.045, TUB_TOP - 0.16), 2, lc, c=0.004)
    # the top: a moulded cornice round the tub, a gilt bead, the rail's top board (the preacher's hands)
    co = [(0.0, 0.0), (0.02, 0.0), (0.03, 0.015), (0.045, 0.03), (0.06, 0.04), (0.07, 0.06), (0.07, 0.10), (0.06, 0.12), (0.06, 0.14), (0.0, 0.16)]
    tub_top = octagon(TUB_R)
    run(m, co, tub_top[::-1], lc, frame=at_z(TUB_TOP - 0.16), closed=True, tile=0.4)
    run(m, [(0.0, 0.0), (0.012, 0.004), (0.014, 0.012), (0.0, 0.016)], octagon(TUB_R + 0.055)[::-1], Along(C["gilt"]), frame=at_z(TUB_TOP - 0.10), closed=True, tile=0.4)
    with m.at(T(0, 0, 0)):
        kit.holed_plate(m, octagon(TUB_R + 0.03), octagon(TUB_R - 0.10), TUB_TOP - 0.004, TUB_TOP + 0.03, oakh, c=0.004)
    # the tub's floor
    disc8(m, oakh, TUB_R - 0.02, TUB_FLOOR, up=False)
    # the doorway's jambs on the +x side and a small half door standing open inward
    for sy in (-1, 1):
        vx, vy = TUB_R * math.cos(sy * math.pi / 8), TUB_R * math.sin(sy * math.pi / 8)
        member(m, (vx - 0.03, vy - 0.03, TUB_FLOOR), (vx + 0.03, vy + 0.03, TUB_TOP), 2, long_)
    door_w = side - 0.10
    with m.at(T(ap - 0.02, -side / 2 + 0.03, 0) @ RZ(math.radians(80))):
        bx(m, -0.025, 0.0, TUB_FLOOR + 0.04, 0.0, door_w, TUB_TOP - 0.12, oak, c=0.003)
        with m.at(RZ(math.radians(90))):
            field_panel(m, 0.05, TUB_FLOOR + 0.12, door_w - 0.05, TUB_TOP - 0.20, 0.0, oak, raise_=0.010, bevel=0.04)
    # the book desk on the front side: a sloped board on two carved brackets, a velvet cushion on it
    with m.at(side_frame(-math.pi / 2, ap)):
        # (over the rail, sloping down toward the preacher, a lip at its low inner edge holding the book)
        with m.at(T(0, -0.06, TUB_TOP + 0.05) @ RX(math.radians(-15))):
            bx(m, -0.28, 0.0, 0.0, 0.28, 0.36, 0.025, oakh, c=0.003)
            bx(m, -0.28, 0.33, 0.025, 0.28, 0.36, 0.06, oak, c=0.003)
            kit.cbox(m, (-0.24, 0.03, 0.025), (0.24, 0.31, 0.07), S["velvet"], c=0.02)
        for sx in (-1, 1):
            scroll(m, carved, T(sx * 0.22, -0.08, TUB_TOP - 0.12) @ RZ(math.radians(90)), 0.07, turns=1.1, r0=0.014, r1=0.006, tail=0.06)
    # --- the back board on the pillar's face: a carved panel from the tub's rail to the sounding board, a scrolled
    # cresting under the board, carrying it
    yb = PILLAR_FACE_Y + 0.02
    with m.at(T(0, yb, 0)):
        member(m, (-0.42, -0.06, TUB_TOP), (-0.36, 0.0, BOARD_Z), 2, lc)
        member(m, (0.36, -0.06, TUB_TOP), (0.42, 0.0, BOARD_Z), 2, lc)
        member(m, (-0.36, -0.02, TUB_TOP), (0.36, 0.0, BOARD_Z), 2, long_, c=0.0)
        cartouche_geo(m, carved, 0.0, -0.02, (TUB_TOP + BOARD_Z) / 2, 0.26, 0.42, letters=False)
        for sx in (-1, 1):
            scroll(m, carved, T(sx * 0.30, -0.04, BOARD_Z - 0.30) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)), 0.11, turns=1.2, r0=0.022, r1=0.008, tail=0.12)
    # --- the sounding board: an octagonal soffit with the dove, a cornice, a carved valance hanging round it, scrolls rising
    # to a drum on top (the trumpeting angel stands there, drawn by the piece)
    SB = 1.40
    disc8(m, oakh, SB - 0.05, BOARD_Z, up=True)
    sb_co = [(0.0, 0.0), (0.02, 0.0), (0.03, 0.02), (0.06, 0.04), (0.08, 0.05), (0.08, 0.13), (0.10, 0.15), (0.12, 0.19), (0.14, 0.24), (0.15, 0.27),
             (0.15, 0.30), (0.0, 0.32)]
    run(m, sb_co, octagon(SB - 0.10)[::-1], lc, frame=at_z(BOARD_Z), closed=True, tile=0.4)
    run(m, [(0.0, 0.0), (0.012, 0.004), (0.014, 0.012), (0.0, 0.016)], octagon(SB + 0.06)[::-1], Along(C["gilt"]), frame=at_z(BOARD_Z + 0.27), closed=True, tile=0.4)
    disc8(m, oakh, SB + 0.02, BOARD_Z + 0.32, up=False)
    # the valance: on each side a carved lambrequin, three scallops with a tassel at each point
    for k in range(8):
        phi = k * math.pi / 4 + math.pi / 8 * 0 - math.pi / 2
        apb = (SB - 0.02) * math.cos(math.pi / 8)
        sw = 2 * (SB - 0.02) * math.sin(math.pi / 8)
        nx, nz = 18, 6
        P = np.zeros((nz + 1, nx + 1, 3))
        ST = np.zeros((nz + 1, nx + 1, 2))
        for i in range(nz + 1):
            for j in range(nx + 1):
                s = j / nx
                x = -sw / 2 + sw * s
                depth = 0.20 + 0.09 * abs(math.cos(s * 3 * math.pi))
                z = BOARD_Z + 0.02 - depth * i / nz
                fold = 0.012 * math.sin(s * 6 * math.pi) * (i / nz)
                P[i, j] = (x, -fold, z)
                ST[i, j] = (x + sw / 2, BOARD_Z - z)
        with m.at(side_frame(phi, apb)):
            kit.grid(m, P, ST, carved, outfn=lambda i, j, c: np.array((0, -1.0, 0)), thr=60.0)
            kit.grid(m, P + np.array((0, 0.02, 0)), ST, carved, outfn=lambda i, j, c: np.array((0, 1.0, 0)), shade=0.6, thr=60.0)
            for j in range(4):
                tx = -sw / 2 + sw * j / 3
                with m.at(T(tx, 0.01, BOARD_Z - 0.20)):
                    kit.lathe(m, [(0.0, 0.0), (0.018, -0.02), (0.022, -0.06), (0.012, -0.10), (0.0, -0.11)], 8, gilt, thr=60.0)
    for k in range(1, 8):
        phi = k * math.pi / 4  # (the eighth urn, at phi 0, is drawn by its own piece: pulpit_urn)
        urn(m, S, 1.22 * math.cos(phi), 1.22 * math.sin(phi), BOARD_Z + 0.32, 1.2)
    for k in range(8):
        phi = math.pi / 8 + k * math.pi / 4
        d = np.array((math.cos(phi), math.sin(phi)))
        M = T(d[0] * (SB - 0.35), d[1] * (SB - 0.35), BOARD_Z + 0.32) @ RZ(phi + math.pi / 2)
        scroll(m, carved, M @ Matrix.Scale(-1, 4, (1, 0, 0)) @ RX(math.radians(0)), 0.16, turns=1.1, r0=0.035, r1=0.010, tail=0.25)
    with m.at(T(0, 0, BOARD_Z + 0.32)):
        kit.lathe(m, [(0.0, 0.0), (0.36, 0.0), (0.36, 0.06), (0.30, 0.10), (0.27, 0.40), (0.33, 0.46), (0.34, 0.52), (0.0, 0.54)], 16, carved, thr=45.0)
    # --- the stair: fourteen treads up along the pillar from the arcade to the landing, open strings with turned
    # balusters, a moulded handrail, newels with carved cones at the foot
    n = 14
    rise = TUB_FLOOR / n
    runl = (STAIR_FOOT_Y - STAIR_TOP_Y) / n
    slope = TUB_FLOOR / (STAIR_FOOT_Y - STAIR_TOP_Y)
    for k in range(n):
        z1 = rise * (k + 1)
        y_hi = STAIR_FOOT_Y - runl * k
        y_lo = y_hi - runl
        bx(m, STAIR_X0 + 0.04, y_lo - 0.025, z1 - 0.032, STAIR_X1 - 0.04, y_hi, z1, oakd, c=0.003)
        bx(m, STAIR_X0 + 0.04, y_hi - 0.018, z1 - rise, STAIR_X1 - 0.04, y_hi, z1 - 0.032, oak, c=0.002)
    lift = 0.30 / math.cos(math.atan(slope))
    for xx in (STAIR_X0, STAIR_X1 - 0.04):
        frame = ((xx, 0, 0), (0, 1, 0), (0, 0, 1), (1, 0, 0))
        sec = [(0.0, 0.0), (0.0, 0.04), (0.30, 0.04), (0.30, 0.0), (0.0, 0.0)]
        run(m, sec, [(STAIR_FOOT_Y, 0.0), (STAIR_TOP_Y - 0.02, TUB_FLOOR + 0.02 * slope)], lc, frame=frame, tile=0.4)
        for k in range(n):
            ym = STAIR_FOOT_Y - runl * (k + 0.5)
            zb = (STAIR_FOOT_Y - ym) * slope + lift
            with m.at(T(xx + 0.02, ym, zb)):
                h = 0.74
                kit.lathe(m, [(0.0, 0.0), (0.024, 0.0), (0.024, 0.05), (0.018, 0.08), (0.028, 0.22), (0.034, 0.34), (0.022, 0.48), (0.016, 0.60),
                              (0.020, h - 0.06), (0.024, h - 0.03), (0.024, h), (0.0, h)], 8, carved, thr=50.0)
        z0r = lift + 0.74 + 0.02
        a0 = (STAIR_FOOT_Y + 0.02, z0r - 0.02 * slope)
        a1 = (STAIR_TOP_Y - 0.05, (STAIR_FOOT_Y - STAIR_TOP_Y + 0.05) * slope + z0r)
        rail = [(xx + 0.02, a0[0] + (a1[0] - a0[0]) * q / 12, a0[1] + (a1[1] - a0[1]) * q / 12) for q in range(13)]
        kit.sweep(m, rail, 0.03, 8, Along(C["carved"]), ry=0.024, up=(1, 0, 0), caps=(True, True), thr=50.0)
        with m.at(T(xx + 0.02, STAIR_FOOT_Y + 0.06, 0)):
            kit.lathe(m, dense([(0.0, 0.0), (0.07, 0.0), (0.07, 0.10), (0.055, 0.14), (0.05, 0.70), (0.065, 0.76), (0.065, 0.92), (0.045, 0.96), (0.0, 0.98)]), 8, carved, a0=math.pi / 8, thr=40.0)
            kit.lathe(m, [(0.0, 0.96), (0.045, 0.99), (0.05, 1.05), (0.035, 1.12), (0.0, 1.16)], 10, carved, thr=60.0)
    # the landing beside the doorway (it reaches the tub's +x side), on two carved posts, a balustrade round its open sides
    land = [(ap - 0.02, -0.02), (STAIR_X1, -0.02), (STAIR_X1, STAIR_TOP_Y), (STAIR_X0, STAIR_TOP_Y), (STAIR_X0, PILLAR_FACE_Y - 0.02), (ap - 0.02, PILLAR_FACE_Y - 0.02)]
    kit.prism(m, land, TUB_FLOOR - 0.05, TUB_FLOOR, oakh, c=0.003)
    for px, py in ((STAIR_X1 - 0.07, 0.05), (STAIR_X1 - 0.07, STAIR_TOP_Y - 0.07)):
        with m.at(T(px, py, 0)):
            kit.lathe(m, dense([(0.0, 0.0), (0.08, 0.0), (0.08, 0.10), (0.06, 0.14), (0.05, TUB_FLOOR - 0.30), (0.08, TUB_FLOOR - 0.15), (0.10, TUB_FLOOR - 0.05), (0.0, TUB_FLOOR - 0.05)]), 8, carved, a0=math.pi / 8, thr=40.0)
    for (x0, y0, x1, y1) in ((STAIR_X1 - 0.04, -0.02, STAIR_X1, STAIR_TOP_Y), (ap + 0.06, -0.02, STAIR_X1, 0.02)):
        along = 0 if x1 - x0 > y1 - y0 else 1
        member(m, (x0, y0, TUB_FLOOR), (x1, y1, TUB_FLOOR + 0.08), along, long_, c=0.003)
        member(m, (x0, y0, TUB_FLOOR + 0.86), (x1, y1, TUB_FLOOR + 0.92), along, long_, c=0.003)
        L = max(x1 - x0, y1 - y0)
        nb = max(1, int(L / 0.14))
        for q in range(nb):
            t = (q + 0.5) / nb
            bxp = x0 + (x1 - x0) * t if along == 0 else (x0 + x1) / 2
            byp = y0 + (y1 - y0) * t if along == 1 else (y0 + y1) / 2
            with m.at(T(bxp, byp, TUB_FLOOR + 0.08)):
                kit.lathe(m, [(0.0, 0.0), (0.022, 0.0), (0.03, 0.18), (0.02, 0.36), (0.016, 0.62), (0.022, 0.72), (0.022, 0.78), (0.0, 0.78)], 8, carved, thr=50.0)
    return m


# ------------------------------------------------------------------ collision hulls
# Plain boxes and prisms round each model's solid parts, drawn by nothing: FurnitureVisual takes a ModelPart's collision
# from its "<name>_hull" child instead of every carved triangle (#198). Open bays, the stair's treads and the tub stay open
# or stepped as drawn.


def confessional_hull(A):
    S = skins(A)
    d = S["dark"]
    m = kit.Mesh("confessional_hull")
    W, D = CW, CD
    for sx in (-1, 1):
        x0, x1 = sorted((sx * W, sx * (W - 0.06)))
        bx(m, x0, -0.03, 0.0, x1, D, Z_AR, d, c=0.0)  # the ends
        x0, x1 = sorted((sx * 0.48, sx * 0.68))
        bx(m, x0, -0.04, 0.0, x1, D, Z_AR, d, c=0.0)  # the inner pilasters and partitions
        x0, x1 = sorted((sx * 1.27, sx * (W - 0.06)))
        bx(m, x0, -0.04, 0.0, x1, 0.12, Z_AR, d, c=0.0)  # the end pilasters
        x0, x1 = sorted((sx * 0.68, sx * 1.27))
        bx(m, x0, -0.34, 0.0, x1, D, 0.15, d, c=0.0)  # the kneeling step and the side bay's floor
        bx(m, x0, -0.03, 1.72, x1, D, Z_AR, d, c=0.0)  # over the side bay's opening
    bx(m, -0.48, -0.03, 1.92, 0.48, D, Z_AR, d, c=0.0)  # over the middle bay's opening
    bx(m, -W, D - 0.06, 0.0, W, D, Z_AR, d, c=0.0)  # the back
    bx(m, -W - 0.24, -0.27, Z_AR, W + 0.24, D, Z_TOP, d, c=0.0)  # the entablature
    bx(m, -0.80, 0.04, Z_TOP, 0.80, 0.22, Z_TOP + 0.75, d, c=0.0)  # the crest
    return m


def pulpit_hull(A):
    S = skins(A)
    d = S["dark"]
    m = kit.Mesh("pulpit_hull")
    kit.prism(m, octagon(0.62), 0.0, 0.12, d)
    kit.prism(m, octagon(0.26), 0.12, 2.0, d)
    kit.lathe(m, [(0.0, 2.0), (0.62, 2.46), (1.0, 2.74), (1.0, TUB_FLOOR), (0.0, TUB_FLOOR)], 8, d, a0=math.pi / 8, thr=20.0)
    # the tub's walls as boards (open at the +x doorway), the back board on the pillar
    ap = TUB_R * math.cos(math.pi / 8)
    side = 2 * TUB_R * math.sin(math.pi / 8)
    for k in range(8):
        phi = k * math.pi / 4 - math.pi / 2
        if abs(math.cos(phi) - 1.0) < 1e-6:
            continue
        with m.at(side_frame(phi, ap)):
            bx(m, -side / 2 - 0.02, -0.08, TUB_FLOOR, side / 2 + 0.02, 0.06, TUB_TOP + 0.03, d, c=0.0)
    bx(m, -0.42, PILLAR_FACE_Y - 0.06, TUB_TOP, 0.42, PILLAR_FACE_Y + 0.02, BOARD_Z, d, c=0.0)
    # the stair: a step under each tread (climbable), its strings, the landing and its balustrade, its posts
    n = 14
    rise = TUB_FLOOR / n
    runl = (STAIR_FOOT_Y - STAIR_TOP_Y) / n
    for k in range(n):
        y_hi = STAIR_FOOT_Y - runl * k
        bx(m, STAIR_X0, y_hi - runl - 0.02, rise * k, STAIR_X1, y_hi, rise * (k + 1), d, c=0.0)
    for xx in (STAIR_X0, STAIR_X1 - 0.04):
        for k in range(n):
            y_hi = STAIR_FOOT_Y - runl * k
            bx(m, xx, y_hi - runl, rise * (k + 1), xx + 0.04, y_hi, rise * (k + 1) + 0.95, d, c=0.0)
    bx(m, ap - 0.02, -0.02, TUB_FLOOR - 0.05, STAIR_X1, STAIR_TOP_Y, TUB_FLOOR, d, c=0.0)
    bx(m, STAIR_X1 - 0.04, -0.02, TUB_FLOOR, STAIR_X1, STAIR_TOP_Y, TUB_FLOOR + 0.92, d, c=0.0)
    bx(m, ap + 0.06, -0.02, TUB_FLOOR, STAIR_X1, 0.02, TUB_FLOOR + 0.92, d, c=0.0)
    for px, py in ((STAIR_X1 - 0.07, 0.05), (STAIR_X1 - 0.07, STAIR_TOP_Y - 0.07)):
        bx(m, px - 0.09, py - 0.09, 0.0, px + 0.09, py + 0.09, TUB_FLOOR - 0.05, d, c=0.0)
    # the sounding board
    kit.prism(m, octagon(1.46), BOARD_Z - 0.22, BOARD_Z + 0.86, d)
    return m


# ------------------------------------------------------------------ the pulpit's own small pieces


def pulpit_dove(A):
    """The dove under the sounding board (drawn by its own piece, room-cathedral-source-8914-43): origin at its middle."""
    S = skins(A)
    m = kit.Mesh("pulpit_dove")
    dove(m, S["gilt"], 0.0, 0.0, 0.0, k=1.1)
    return m


def urn(m, S, x, y, z, k=1.0, body="carved"):
    """A carved urn (oak, or gilt) with a gilt flame, standing on (x, y, z)."""
    with m.at(T(x, y, z) @ Matrix.Scale(k, 4)):
        kit.lathe(m, [(0.0, 0.0), (0.075, 0.0), (0.075, 0.025), (0.045, 0.04), (0.038, 0.06), (0.09, 0.12), (0.095, 0.17), (0.065, 0.23),
                      (0.04, 0.245), (0.046, 0.262), (0.0, 0.27)], 14, S[body], thr=50.0)
        kit.lathe(m, [(0.0, 0.262), (0.036, 0.27), (0.026, 0.33), (0.010, 0.41), (0.0, 0.44)], 10, S["gilt"], thr=60.0)


def pulpit_urn(A):
    """One of the eight urns on the sounding board (this one drawn by its own piece, room-cathedral-source-8931-121)."""
    S = skins(A)
    m = kit.Mesh("pulpit_urn")
    urn(m, S, 0.0, 0.0, 0.0, 1.2)
    return m


# ------------------------------------------------------------------ a side altar's fittings
# Each side altar's architecture is marble in the town shell (its mensa, columns, entablature, pediment); the picture
# keeps its recovered painting. These are the fittings round them, each at its own piece's place.

PIC_W, PIC_H = 1.70, 2.50


def altar_frame(A):
    """A carved and gilt frame round the 1.70 x 2.50 m picture: origin at the picture's middle on its plane (the black
    marble 9 mm behind it), facing game +Z. Sight edge, cove, bead, a leafy ovolo, a fillet; acanthus at the corners, a
    shell with scrolls at the top's middle, a pendant at the foot's middle."""
    C = cells(A)
    S = skins(A)
    gilt = S["gilt"]
    m = kit.Mesh("altar_frame")
    hw, hh = PIC_W / 2, PIC_H / 2
    face = ((0, 0.0, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0))
    # the moulding, travelling round the sight edge (its section reaches outward over the marble)
    prof = [(0.0, -0.008), (0.0, 0.012), (0.010, 0.020), (0.020, 0.040), (0.032, 0.050), (0.040, 0.050), (0.046, 0.046), (0.052, 0.050),
            (0.062, 0.062), (0.078, 0.075), (0.098, 0.080), (0.118, 0.074), (0.132, 0.060), (0.140, 0.040), (0.146, 0.034), (0.156, 0.034),
            (0.160, 0.024), (0.160, -0.008)]
    rect = [(-hw, -hh), (-hw, hh), (hw, hh), (hw, -hh)]
    run(m, prof, rect, Along(C["gilt"]), frame=face, closed=True, tile=0.3, flip=True)
    # the back board behind the moulding (against the marble)
    for x0, z0, x1, z1 in ((-hw - 0.16, -hh - 0.16, hw + 0.16, -hh), (-hw - 0.16, hh, hw + 0.16, hh + 0.16), (-hw - 0.16, -hh, -hw, hh), (hw, -hh, hw + 0.16, hh)):
        member(m, (x0, -0.0, z0), (x1, 0.008, z1), 0 if x1 - x0 > z1 - z0 else 2, Along(C["gilt"]), c=0.0)
    # the leaves on the ovolo: small acanthus along all four sides
    for (ax, az, bx_, bz, n) in ((-hw - 0.09, -hh - 0.09, hw + 0.09, -hh - 0.09, 14), (-hw - 0.09, hh + 0.09, hw + 0.09, hh + 0.09, 14),
                                 (-hw - 0.09, -hh - 0.09, -hw - 0.09, hh + 0.09, 20), (hw + 0.09, -hh - 0.09, hw + 0.09, hh + 0.09, 20)):
        for q in range(1, n):
            t = q / n
            x, z = ax + (bx_ - ax) * t, az + (bz - az) * t
            ang = math.atan2(bz - az, bx_ - ax)
            leaf(m, gilt, T(x, -0.081, z) @ Matrix.Rotation(-ang + math.pi / 2, 4, "Y"), 0.085, 0.05, curl=0.25, nl=5, nw=4)
    # corner pieces: an acanthus spray and a scroll at each corner
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = sx * (hw + 0.10), sz * (hh + 0.10)
            out_a = math.atan2(sz, sx)
            for q in range(3):
                a = out_a + (q - 1) * 0.6
                leaf(m, gilt, T(cx, -0.082, cz) @ Matrix.Rotation(-a + math.pi / 2, 4, "Y") @ RX(math.radians(-25)), 0.11, 0.06, curl=0.4, nl=6, nw=5)
            M = T(cx, -0.07, cz) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)) @ Matrix.Scale(-1 if sz < 0 else 1, 4, (0, 0, 1))
            scroll(m, gilt, M, 0.05, turns=1.4, r0=0.012, r1=0.004)
    # the top's middle: a shell between two C-scrolls; the foot's middle: a pendant of leaves
    for k in range(9):
        a = math.radians(20 + 140 * k / 8)
        leaf(m, gilt, T(0.0, -0.075, hh + 0.10) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y"), 0.20, 0.07, curl=0.3, nl=6, nw=4)
    for sx in (-1, 1):
        scroll(m, gilt, T(sx * 0.20, -0.07, hh + 0.12) @ Matrix.Scale(-1 if sx < 0 else 1, 4, (1, 0, 0)), 0.07, turns=1.3, r0=0.016, r1=0.005, tail=0.10)
    for k in range(5):
        a = math.radians(-60 - 60 * k / 4)
        leaf(m, gilt, T(0.0, -0.075, -hh - 0.10) @ Matrix.Rotation(-(a - math.pi / 2), 4, "Y"), 0.16, 0.07, curl=0.4, nl=6, nw=4)
    return m


def capital(m, S, gilt, r=0.15):
    """A gilt Corinthian capital for a column of radius r, on its axis, 0.30 m high: an astragal, a bell with two rows of
    eight acanthus leaves, corner volutes, the abacus with hollow sides and a flower on each."""
    kit.lathe(m, [(r * 0.98, 0.0), (r + 0.012, 0.008), (r + 0.014, 0.020), (r + 0.010, 0.030), (r * 0.98, 0.036)], 20, gilt, thr=60.0)
    kit.lathe(m, [(r * 0.98, 0.036), (r * 1.00, 0.10), (r * 1.06, 0.18), (r * 1.15, 0.245), (0.0, 0.245)], 20, gilt, thr=50.0)
    for row, (z, L, w) in enumerate(((0.04, 0.12, 0.075), (0.10, 0.13, 0.07))):
        for k in range(8):
            a = 2 * math.pi * k / 8 + (math.pi / 8 if row else 0.0)
            rr = r * (1.0 + 0.06 * row)
            leaf(m, gilt, T(rr * math.cos(a), rr * math.sin(a), z) @ RZ(a + math.pi / 2), L, w, curl=0.9, nl=6, nw=5)
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        M = T(r * 1.25 * math.cos(a), r * 1.25 * math.sin(a), 0.205) @ RZ(a + math.pi / 2)
        scroll(m, gilt, M, 0.035, turns=1.4, r0=0.010, r1=0.004)
    s = r * 1.40
    abacus = []
    for k in range(4):
        a0 = math.pi / 4 + k * math.pi / 2
        c0 = np.array((s * math.cos(a0), s * math.sin(a0)))
        a1 = a0 + math.pi / 2
        c1 = np.array((s * math.cos(a1), s * math.sin(a1)))
        for t in np.linspace(0, 1, 6)[:-1]:
            # a hollow side: a curve from corner to corner bowed toward the axis
            p = c0 * (1 - t) + c1 * t
            bow = 4 * t * (1 - t)
            abacus.append(tuple(p * (1 - 0.14 * bow)))
    with m.at(T(0, 0, 0.245)):
        kit.prism(m, abacus, 0.0, 0.055, gilt, c=0.004, thr=40.0)
    for k in range(4):
        a = k * math.pi / 2
        d = s * 0.86 * 0.75
        with m.at(T(d * 1.05 * math.cos(a), d * 1.05 * math.sin(a), 0.272) @ RZ(a + math.pi / 2)):
            kit.lathe(m, [(0.0, -0.02), (0.022, -0.018), (0.028, 0.0), (0.02, 0.016), (0.0, 0.02)], 8, gilt, thr=60.0)


def altar_capital(A):
    """A gilt Corinthian capital on a side altar's marble column (origin on the column's axis at its foot)."""
    S = skins(A)
    m = kit.Mesh("altar_capital")
    capital(m, S, S["gilt"], r=0.15)
    return m


def altar_crown(A):
    """The gilt crown of a side altar's pediment: a cartouche with scrolled ears and a shell, palm fronds at its sides, a
    flaming urn on top. Origin at its foot's middle, facing game +Z; its face 0.10 m in front of the origin."""
    S = skins(A)
    gilt = S["gilt"]
    m = kit.Mesh("altar_crown")
    with m.at(T(0, -0.10, 0.0)):
        bx(m, -0.30, 0.0, 0.0, 0.30, 0.10, 0.06, gilt, c=0.006)
        cartouche_geo(m, gilt, 0.0, 0.0, 0.46, 0.24, 0.32, letters=True)
        with m.at(T(0, 0.012, 0) @ RX(math.radians(90))):
            kit.prism(m, [(0.24 * 0.9 * math.cos(a), 0.46 + 0.32 * 0.9 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 29)[:-1]], 0.0, 0.012, gilt, c=0.0)
        for sx in (-1, 1):
            for q in range(4):
                leaf(m, gilt, T(sx * 0.20, -0.004, 0.10 + q * 0.12) @ Matrix.Rotation(sx * math.radians(25 + 10 * q), 4, "Y"), 0.30 - 0.04 * q, 0.07, curl=0.6, nl=7, nw=4)
        urn(m, S, 0.0, 0.03, 0.80, 0.8, body="gilt")
    return m


def altar_dressing(A):
    """A side altar's cross and four candlesticks: origin on the mensa's top at the picture's plane, facing game +Z."""
    S = skins(A)
    gilt, brass, wax = S["gilt"], S["brass"], S["wax"]
    m = kit.Mesh("altar_dressing")
    stick = [(0.0, 0.0), (0.075, 0.0), (0.075, 0.012), (0.06, 0.02), (0.04, 0.05), (0.032, 0.07), (0.045, 0.09), (0.02, 0.11), (0.016, 0.16),
             (0.03, 0.19), (0.014, 0.22), (0.012, 0.28), (0.026, 0.30), (0.05, 0.315), (0.052, 0.325), (0.016, 0.33), (0.0, 0.33)]
    for x in (-0.71, -0.24, 0.24, 0.71):
        k = 1.0 if abs(x) > 0.5 else 1.15
        with m.at(T(x, -0.15, 0.0) @ Matrix.Scale(k, 4)):
            kit.lathe(m, stick, 12, brass, thr=50.0)
        top = 0.33 * k
        with m.at(T(x, -0.15, top)):
            kit.lathe(m, [(0.0, 0.0), (0.014, 0.0), (0.014, 0.72 - top - 0.02), (0.010, 0.72 - top - 0.005), (0.0, 0.72 - top)], 10, wax, thr=50.0)
            kit.lathe(m, [(0.0, 0.72 - top), (0.0015, 0.72 - top), (0.0012, 0.735 - top), (0.0, 0.738 - top)], 4, S["dark"], thr=50.0)
    # the cross: a stepped foot, the shaft and arms with trefoil ends, the corpus
    with m.at(T(0, -0.10, 0.0)):
        kit.lathe(m, [(0.0, 0.0), (0.10, 0.0), (0.10, 0.02), (0.08, 0.03), (0.05, 0.05), (0.05, 0.07), (0.03, 0.09), (0.0, 0.09)], 8, gilt, a0=math.pi / 8, thr=40.0)
        bx(m, -0.012, -0.010, 0.09, 0.012, 0.010, 0.62, gilt, c=0.003)
        bx(m, -0.15, -0.010, 0.48, 0.15, 0.010, 0.505, gilt, c=0.003)
        for (x, z) in ((0.0, 0.63), (-0.16, 0.4925), (0.16, 0.4925)):
            ball(m, gilt, (x, 0.0, z), 0.018, sides=8, rings=4)
        # the corpus: head, body, arms along the cross bar, legs
        ball(m, gilt, (0.0, -0.022, 0.535), 0.016, sides=8, rings=4)
        kit.sweep(m, [(0.0, -0.022, 0.52), (0.0, -0.024, 0.44), (0.004, -0.022, 0.36), (0.006, -0.02, 0.29)], [0.016, 0.018, 0.012, 0.008], 8, gilt, up=(0, -1, 0), thr=70.0)
        for sx in (-1, 1):
            kit.sweep(m, [(sx * 0.012, -0.022, 0.505), (sx * 0.07, -0.02, 0.49), (sx * 0.125, -0.018, 0.495)], [0.007, 0.006, 0.005], 6, gilt, up=(0, -1, 0), thr=70.0)
    return m


def altar_cloth(A):
    """A side altar's linen cloth over its mensa, with a fall at the front and the sides edged by a scalloped lace border:
    origin at the top of the front fall, at its middle, facing game +Z; the cloth runs 0.97 m back over the mensa."""
    S = skins(A)
    linen = S["linen"]
    m = kit.Mesh("altar_cloth")
    hw, depth, drop = 1.08, 0.80, 0.26
    nx = 24
    # the top sheet and the front fall in one sheet, a soft roll over the mensa's front edge
    rows = []
    for q in range(5):
        rows.append((0.0, depth * (1 - q / 4), 0.003))
    for q in range(1, 5):
        a = math.pi / 2 * q / 4
        rows.append((0.0, -0.010 * math.sin(a), 0.003 - 0.012 * (1 - math.cos(a))))
    for q in range(1, 7):
        rows.append((0.0, -0.010 - 0.002 * q, -0.012 - (drop - 0.012) * q / 6))
    P = np.zeros((len(rows), nx + 1, 3))
    ST = np.zeros((len(rows), nx + 1, 2))
    tl = 0.0
    for i, (_, y, z) in enumerate(rows):
        if i:
            tl += math.hypot(y - rows[i - 1][1], z - rows[i - 1][2])
        for j in range(nx + 1):
            x = -hw + 2 * hw * j / nx
            hang = max(0.0, -z - 0.1) / drop
            P[i, j] = (x, y - 0.004 * math.sin(j * 1.3) * hang, z)
            ST[i, j] = (x + hw, tl)
    # (one sheet: the material is drawn on both sides; a second sheet lay in the same plane on the mensa and flickered)
    kit.grid(m, P, ST, linen, outfn=lambda i, j, c: np.array((0, -1.0, 1.0)), thr=60.0)
    # the lace: a scalloped band along the fall's foot, pierced in a row of small holes (dark beads behind a light rim)
    for j in range(36):
        x = -hw + (j + 0.5) * 2 * hw / 36
        ring = [(x + 0.028 * math.cos(a), -0.024, -drop + 0.012 + 0.03 * math.sin(a) * (0.5 if math.sin(a) > 0 else 1.0)) for a in np.linspace(math.pi, 2 * math.pi, 9)]
        kit.sweep(m, ring, 0.0035, 5, linen, up=(0, -1, 0), thr=70.0, caps=(True, True))
    kit.sweep(m, [(-hw, -0.024, -drop + 0.03), (hw, -0.024, -drop + 0.03)], 0.003, 5, linen, up=(0, -1, 0), thr=70.0, caps=(True, True))
    # the side falls
    for sx in (-1, 1):
        x = sx * hw
        P = np.array([[(x + sx * 0.003, depth * (1 - k / 6), 0.0), (x + sx * 0.006, depth * (1 - k / 6), -drop * 0.8)] for k in range(7)])
        ST = np.array([[(depth * (1 - k / 6), 0.0), (depth * (1 - k / 6), drop)] for k in range(7)])
        kit.grid(m, P, ST, linen, outfn=lambda i, j, c, sx=sx: np.array((sx, 0, 0)), thr=60.0)
    return m


def altar_saint(A):
    """A white marble saint beside a side altar, 1.49 m high (the carved saint's figure in marble)."""
    C = cells(A)
    old = carving._CELLS.get(id(A))
    carving._CELLS[id(A)] = {"oak": C["marble"]}
    try:
        m = carving.saint(A)
    finally:
        if old is None:
            carving._CELLS.pop(id(A), None)
        else:
            carving._CELLS[id(A)] = old
    m.name = "altar_saint"
    # scale to 1.49 m: the saint is 1.565 high
    k = 1.49 / 1.565
    m.V = [Vector((v.x * k, v.y * k, v.z * k)) for v in m.V]
    return m


# ------------------------------------------------------------------ the aisles' night lamps

LAMP_FLAME = (0.0, 0.0, 1.97)  # the flame in the lamp stand's frame (Blender axes): the room lamp's light stands there


def lamp_stand(A):
    """A standing oil lamp for the aisles before the confessionals (#198: the church had no light there at night): a
    wrought-iron stand on three scrolled feet, a turned brass shaft, a drip pan, a brass lamp with a dark glass chimney and
    its flame at LAMP_FLAME, where the room's lamp light is. Origin on the floor under it."""
    S = skins(A)
    iron, brass = S["iron"], S["brass"]
    m = kit.Mesh("lamp_stand")
    for k in range(3):
        a = 2 * math.pi * k / 3
        d = np.array((math.cos(a), math.sin(a)))
        foot = [(d[0] * 0.03, d[1] * 0.03, 0.30), (d[0] * 0.12, d[1] * 0.12, 0.16), (d[0] * 0.20, d[1] * 0.20, 0.05), (d[0] * 0.26, d[1] * 0.26, 0.015)]
        kit.sweep(m, foot, [0.012, 0.011, 0.010, 0.010], 6, iron, up=(0, 0, 1), thr=50.0, caps=(True, True))
        with m.at(T(d[0] * 0.27, d[1] * 0.27, 0.0) @ RZ(a + math.pi / 2)):
            scroll(m, iron, T(0, 0, 0.035), 0.03, turns=1.2, r0=0.008, r1=0.004)
    kit.sweep(m, [(0.0, 0.0, 0.28 + q * 0.05) for q in range(30)], 0.013, 8, iron, up=(1, 0, 0), thr=50.0, caps=(True, True))
    for z in (0.30, 0.95, 1.55):
        with m.at(T(0, 0, z)):
            kit.lathe(m, [(0.0, -0.03), (0.022, -0.025), (0.03, 0.0), (0.022, 0.025), (0.0, 0.03)], 10, brass, thr=60.0)
    with m.at(T(0, 0, 1.76)):
        kit.lathe(m, [(0.0, 0.0), (0.016, 0.0), (0.12, 0.012), (0.13, 0.03), (0.12, 0.035), (0.016, 0.02), (0.0, 0.02)], 16, brass, thr=40.0)  # the drip pan
        kit.lathe(m, [(0.0, 0.02), (0.03, 0.03), (0.06, 0.06), (0.07, 0.10), (0.05, 0.14), (0.03, 0.15), (0.032, 0.165), (0.0, 0.165)], 14, brass, thr=50.0)  # the font
        kit.lathe(m, [(0.026, 0.165), (0.024, 0.18), (0.032, 0.22), (0.022, 0.25), (0.020, 0.27)], 12, S["dark"], thr=40.0)  # the chimney
    with m.at(T(0, 0, LAMP_FLAME[2] - 0.035)):
        kit.lathe(m, [(0.0, 0.0), (0.007, 0.006), (0.009, 0.018), (0.005, 0.032), (0.0, 0.042)], 8, S["wax"], thr=70.0)
    return m


# ------------------------------------------------------------------ a side altar's marble (prepared)
# Measured on the town shell's coarse boxes (town/ROOM_cathedral Mesh1135 white, Mesh1136 black, at the east altar of
# z 177.16): origin on the floor at the picture's plane and middle, facing game +Z (Blender -y). The fittings (frame,
# capitals, crown, cloth, cross and candlesticks, saints) sit on it where they sit on the shell's boxes now.


def altar_marble(A):
    C = cells(A)
    S = skins(A)
    wm, bm_ = S["marble"], S["marbleb"]
    lw, lb = Along(C["marble"], margin=0.4), Along(C["marbleb"], margin=0.3)
    m = kit.Mesh("altar_marble")
    c = 0.008  # marble arrises
    # the step: a white platform with a moulded nosing on its three open sides
    member(m, (-1.45, -1.37, 0.0), (1.45, 0.38, 0.12), 0, lw, c=c)
    run(m, [(0.0, 0.0), (0.02, 0.0), (0.03, 0.01), (0.03, 0.03), (0.02, 0.04), (0.0, 0.04)], [(-1.45, 0.38), (-1.45, -1.37), (1.45, -1.37), (1.45, 0.38)],
        lw, frame=at_z(0.12), caps=(True, True), tile=0.4)
    # the altar's table: a black front between white framing pilasters, the white mensa with a moulded edge
    member(m, (-0.86, -0.72, 0.16), (0.86, 0.17, 1.06), 0, lb, c=c)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.74, sx * 0.86))
        member(m, (x0, -0.74, 0.16), (x1, 0.17, 1.06), 2, lw, c=c)
        x0, x1 = sorted((sx * 0.86, sx * 1.10))
        member(m, (x0, -0.70, 0.16), (x1, 0.17, 1.06), 2, lw, c=c)
    # a white panel moulding inlaid on the black front, an oval medallion in it
    run(m, [(0.0, 0.0), (0.0, 0.006), (0.010, 0.012), (0.022, 0.008), (0.03, 0.0)], [(-0.64, 0.26), (-0.64, 0.96), (0.64, 0.96), (0.64, 0.26)],
        lw, frame=((0, -0.72, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0)), closed=True, tile=0.4, flip=True)
    oval_field(m, wm, 0.0, -0.72, 0.61, 0.20, 0.24, dome=0.010)
    member(m, (-1.12, -0.78, 1.06), (1.12, 0.19, 1.14), 0, lw, c=c)
    run(m, [(0.0, 0.0), (0.012, 0.004), (0.016, 0.016), (0.012, 0.03), (0.0, 0.034)], [(-1.12, 0.19), (-1.12, -0.78), (1.12, -0.78), (1.12, 0.19)],
        lw, frame=at_z(1.08), caps=(True, True), tile=0.4)
    # the black back panel framed in a white bolection moulding
    boards(m, -1.80, 0.009, 1.00, 1.80, 0.30, 5.30, lb, along=2, width=0.6, c=0.0)
    run(m, [(0.0, 0.0), (0.0, 0.02), (0.02, 0.04), (0.05, 0.05), (0.07, 0.03), (0.08, 0.0)], [(-1.20, 1.90), (-1.20, 4.70), (1.20, 4.70), (1.20, 1.90)],
        lw, frame=((0, 0.009, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0)), closed=True, tile=0.4)
    # the columns: moulded pedestals with black panels, Attic bases, white shafts with entasis (the gilt capitals are pieces of
    # their own)
    for sx in (-1, 1):
        cx, cy = sx * 1.40, -0.12
        member(m, (cx - 0.25, cy - 0.25, 1.20), (cx + 0.25, cy + 0.25, 1.90), 2, lw, c=c)
        for z, flip in ((1.20, False), (1.84, True)):
            run(m, [(0.0, 0.0), (0.02, 0.0), (0.03, 0.012), (0.02, 0.03), (0.0, 0.03)] if not flip else [(0.0, 0.0), (0.02, 0.0), (0.03, 0.018), (0.03, 0.03), (0.0, 0.06)],
                [(cx - 0.25, cy + 0.25), (cx - 0.25, cy - 0.25), (cx + 0.25, cy - 0.25), (cx + 0.25, cy + 0.25)], lw, frame=at_z(z), caps=(True, True), tile=0.3)
        member(m, (cx - 0.16, cy - 0.252, 1.32), (cx + 0.16, cy - 0.248, 1.80), 2, lb, c=0.0)
        with m.at(T(cx, cy, 1.90)):
            kit.lathe(m, [(0.0, 0.0), (0.21, 0.0), (0.21, 0.03), (0.20, 0.04), (0.19, 0.07), (0.17, 0.08), (0.165, 0.10), (0.18, 0.115), (0.175, 0.135), (0.155, 0.15)], 24, wm, thr=55.0)
            shaft = [(0.152 * (1 - 0.12 * max(0.0, (t - 0.33) / 0.67) ** 1.6), 0.15 + (4.54 - 2.05) * t) for t in np.linspace(0, 1, 9)]
            kit.lathe(m, shaft + [(0.150 * 0.88 + 0.012, 4.54 - 1.90 - 0.03), (0.150 * 0.88 + 0.012, 4.54 - 1.90)], 24, wm, thr=40.0)
    # the entablature: a white architrave, a black frieze, a white cornice, breaking forward over the columns
    ent = [(-1.80, 0.30), (-1.80, -0.20), (-1.65, -0.20), (-1.65, -0.36), (-1.15, -0.36), (-1.15, -0.20), (1.15, -0.20), (1.15, -0.36), (1.65, -0.36),
           (1.65, -0.20), (1.80, -0.20), (1.80, 0.30)]
    run(m, [(0.0, 0.0), (0.01, 0.0), (0.01, 0.05), (0.02, 0.06), (0.02, 0.11), (0.03, 0.12), (0.0, 0.12)], ent, lw, frame=at_z(4.84), tile=0.4, closed=True)
    # One stepped frieze skin, including its back: the former straight backing
    # overlapped this face between the columns and produced crossed coplanar slivers.
    run(m, [(0.0, 0.0), (0.0, 0.24)], ent, lb, frame=at_z(4.96), tile=0.4, closed=True)
    run(m, [(0.0, 0.0), (0.02, 0.0), (0.04, 0.02), (0.06, 0.03), (0.06, 0.06), (0.12, 0.08), (0.13, 0.10), (0.13, 0.14), (0.15, 0.15), (0.15, 0.17), (0.0, 0.17)],
        ent, lw, frame=at_z(5.20), tile=0.4, closed=True)
    # Close the stepped volume's full soffit and top. The swept section closes only
    # its narrow perimeter lip; without this cap an underside view sees interior edges.
    # Disjoint rectangles match the stepped outline exactly, with metric-sized UV tiles.
    for x0, x1, y0, y1 in ((-1.80, 1.80, -0.20, 0.30), (-1.65, -1.15, -0.36, -0.20), (1.15, 1.65, -0.36, -0.20)):
        xs = np.linspace(x0, x1, max(1, math.ceil((x1 - x0) / 0.4)) + 1)
        ys = np.linspace(y0, y1, max(1, math.ceil((y1 - y0) / 0.4)) + 1)
        for xa, xb in zip(xs[:-1], xs[1:]):
            for ya, yb in zip(ys[:-1], ys[1:]):
                for z, nz in ((4.84, -1), (5.37, 1)):
                    points = [(xa, ya, z), (xb, ya, z), (xb, yb, z), (xa, yb, z)]
                    m.face([m.vid(p) for p in points], points, wm, out=(0, 0, nz))
    # the broken segmental pediment: two curved halves of the cornice's moulding rising toward the middle, where the crown stands
    for sx in (-1, 1):
        arc = [(sx * (1.72 - 1.24 * t), 5.37 + 0.55 * math.sin(math.pi / 2 * t)) for t in np.linspace(0, 1, 9)]
        if sx > 0:
            arc = arc[::-1]
        run(m, [(0.0, 0.0), (0.0, 0.06), (0.04, 0.08), (0.08, 0.06), (0.10, 0.02), (0.12, 0.0)], arc, lw,
            frame=((0, -0.36, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0)), tile=0.25, flip=sx > 0)
    # the statues' pedestals either side of the retable (the marble saints stand on them at 0.95 m)
    for sx in (-1, 1):
        cx, cy = sx * 2.10, -0.19
        member(m, (cx - 0.25, cy - 0.25, 0.0), (cx + 0.25, cy + 0.25, 0.95), 2, lw, c=c)
        run(m, [(0.0, 0.0), (0.03, 0.0), (0.03, 0.03), (0.0, 0.06)], [(cx - 0.25, cy + 0.25), (cx - 0.25, cy - 0.25), (cx + 0.25, cy - 0.25), (cx + 0.25, cy + 0.25)],
            lw, frame=at_z(0.0), caps=(True, True), tile=0.3)
        run(m, [(0.0, 0.0), (0.02, 0.0), (0.03, 0.02), (0.03, 0.05), (0.0, 0.05)], [(cx - 0.25, cy + 0.25), (cx - 0.25, cy - 0.25), (cx + 0.25, cy - 0.25), (cx + 0.25, cy + 0.25)],
            lw, frame=at_z(0.90), caps=(True, True), tile=0.3)
        member(m, (cx - 0.16, cy - 0.252, 0.18), (cx + 0.16, cy - 0.248, 0.78), 2, lb, c=0.0)
    return m
