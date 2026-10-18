"""Crushed ice for the fish market (#190): one bed of ice 50 x 40 cm that the market lays under its fish, on the fish
tables, in the fish crates, baskets and barrows (tiled and fitted to each). Our own work, painted here.

ice_round: the same crushed ice as a round bed 0.40 m across, for a basket or a bucket.
ice:    a low bed of crushed ice, its underside at the origin's height (game y 0), centred on the origin, 0.50 m along
        game x and 0.40 m along game z; 3-6 mm at its edge (so beds laid side by side meet without a step), 1.5-3 cm in
        its middle, with rounded lumps of ice (1-3 cm, their edges melted round) lying half sunk in it. The fish lie on
        it at about 2.5 cm.
"""

import math
import random

import numpy as np

from . import kit
from . import paint as pt
from .kit import Planar

L, W = 0.50, 0.40  # along Blender x and y (game x and z)
PPM = 800


_CELLS = {}


def ice_cells(A):
    if id(A) in _CELLS:
        return _CELLS[id(A)]
    def grains(X, Y, step, seed):
        """A jittered grid of grains `step` apart: per pixel the nearest grain's distance, the gap to the second, its
        own random tone and the offset from its middle."""
        rng = np.random.default_rng(seed)
        gx, gy = int(math.ceil(L / step)) + 3, int(math.ceil(W / step)) + 3
        jit = rng.uniform(0.05, 0.95, (gy, gx, 2))
        size = rng.uniform(0.55, 1.5, (gy, gx))
        tone = rng.uniform(0.0, 1.0, (gy, gx))
        cx, cy = np.floor(X / step).astype(int), np.floor(Y / step).astype(int)
        d1 = np.full(X.shape, 9.0)
        d2 = np.full(X.shape, 9.0)
        t1 = np.zeros(X.shape)
        ox = np.zeros(X.shape)
        oy = np.zeros(X.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ix, iy = np.clip(cx + dx + 1, 0, gx - 1), np.clip(cy + dy + 1, 0, gy - 1)
                px = (ix - 1 + jit[iy, ix, 0]) * step
                py = (iy - 1 + jit[iy, ix, 1]) * step
                d = np.hypot(X - px, Y - py) / size[iy, ix]
                closer = d < d1
                d2 = np.where(closer, d1, np.minimum(d2, d))
                t1 = np.where(closer, tone[iy, ix], t1)
                ox = np.where(closer, (X - px) / (step * size[iy, ix]), ox)
                oy = np.where(closer, (Y - py) / (step * size[iy, ix]), oy)
                d1 = np.where(closer, d, d1)
        return d1, d2 - d1, t1, ox, oy

    def bed(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        # crushed ice: chips of every size from a few millimetres to a centimetre and a half, some clear (the wet board
        # and the melt water showing grey-blue through them), most frosted white; soft pale seams between them
        _, e1, t1, ox, oy = grains(X, Y, 0.011, 1907)
        _, e2, t2, _, _ = grains(X, Y, 0.0045, 1908)
        clear = pt.sm(0.55, 0.85, t1) * (0.6 + 0.4 * t2)
        frost = pt.fbm(h, w, 0.010 * ppm, 0.010 * ppm, 1911, 3)
        white = np.array((0.86, 0.89, 0.90)) * (0.94 + 0.08 * frost)[..., None]
        glass = np.array((0.50, 0.57, 0.61)) * (0.9 + 0.2 * t2)[..., None]
        img = white * (1 - clear[..., None]) + glass * clear[..., None]
        # each chip lit from one side: brighter on its upper left, a little darker on its lower right
        img *= (1.0 + 0.10 * np.clip(-(ox + oy), -1.5, 1.5))[..., None]
        # the seams: soft and pale between the big chips, finer between the small ones
        seam = (1 - pt.sm(0.0, 0.0016, e1)) * 0.6 + (1 - pt.sm(0.0, 0.0008, e2)) * 0.25
        img = img * (1 - 0.35 * seam[..., None]) + np.array((0.55, 0.60, 0.63)) * 0.35 * seam[..., None]
        # small glints where the light catches a wet facet, and here and there a herring scale
        glint = (pt.fbm(h, w, 0.0025 * ppm, 0.0025 * ppm, 1913, 2) > 0.82) * (1 - seam)
        img = img + 0.10 * glint[..., None]
        wet = pt.fbm(h, w, 0.07 * ppm, 0.05 * ppm, 1917, 3)
        img *= (0.92 + 0.10 * wet)[..., None]
        return np.clip(img, 0, 1)

    _CELLS[id(A)] = {"bed": A.cell("catch", L, W, PPM, bed, "crushed ice")}
    return _CELLS[id(A)]


_PHI = (1 + 5 ** 0.5) / 2
_ICO_V = [(-1, _PHI, 0), (1, _PHI, 0), (-1, -_PHI, 0), (1, -_PHI, 0), (0, -1, _PHI), (0, 1, _PHI), (0, -1, -_PHI),
          (0, 1, -_PHI), (_PHI, 0, -1), (_PHI, 0, 1), (-_PHI, 0, -1), (-_PHI, 0, 1)]
_ICO_F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
          (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7),
          (9, 8, 1)]


def _height(x, y, bumps, edge=None):
    """The bed's top over its underside at (x, y): thin at the edge, lumpy in the middle."""
    e = edge if edge is not None else min(x + L / 2, L / 2 - x, y + W / 2, W / 2 - y)
    rise = 0.5 - 0.5 * math.cos(math.pi * min(1.0, e / 0.045))
    z = 0.016 + sum(a * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (r * r)) for bx, by, r, a in bumps)
    return 0.004 + (z - 0.004) * rise


def ice(A):
    C = ice_cells(A)
    m = kit.Mesh("ice")
    skin = Planar(C["bed"], 2, (-L / 2, -W / 2, 0.0))
    rng = random.Random(1873)
    bumps = [(rng.uniform(-0.2, 0.2), rng.uniform(-0.15, 0.15), rng.uniform(0.03, 0.07), rng.uniform(0.003, 0.009)) for _ in range(14)]
    nx, ny = 26, 21
    P = [[(-L / 2 + L * i / (nx - 1), -W / 2 + W * j / (ny - 1)) for i in range(nx)] for j in range(ny)]
    ids, pts = [], []
    for j in range(ny):
        ri, rp = [], []
        for i in range(nx):
            x, y = P[j][i]
            # the inside points stir a little, so the bed is not a regular sheet
            if 0 < i < nx - 1 and 0 < j < ny - 1:
                x += rng.uniform(-0.004, 0.004)
                y += rng.uniform(-0.004, 0.004)
            z = _height(x, y, bumps) + (rng.uniform(-0.0015, 0.0015) if 0 < i < nx - 1 and 0 < j < ny - 1 else 0.0)
            ri.append(m.vid((x, y, z)))
            rp.append((x, y, z))
        ids.append(ri)
        pts.append(rp)
    for j in range(ny - 1):
        for i in range(nx - 1):
            q = [(j, i), (j, i + 1), (j + 1, i + 1), (j + 1, i)]
            m.face([ids[a][b] for a, b in q], [pts[a][b] for a, b in q], skin, out=(0, 0, 1), thr=50.0)
    _lumps(m, skin, rng, lambda x, y: _height(x, y, bumps), lambda x, y: abs(x) < L / 2 - 0.035 and abs(y) < W / 2 - 0.035)
    return m


def _lumps(m, skin, rng, height, inside):
    """Melted grains of ice 0.7-3 cm, half sunk in the bed, their corners worn round (smooth shading over a jittered
    twenty-sided stone: no sharp arris on ice that has lain an hour)."""
    placed = []
    tries = 0
    while len(placed) < 75 and tries < 4000:
        tries += 1
        r = rng.uniform(0.006, 0.014) if len(placed) < 30 else rng.uniform(0.0035, 0.007)
        x = rng.uniform(-L / 2 + 0.035, L / 2 - 0.035)
        y = rng.uniform(-W / 2 + 0.035, W / 2 - 0.035)
        if not inside(x, y) or any(math.hypot(x - px, y - py) < (r + pr) * 1.05 for px, py, pr in placed):
            continue
        placed.append((x, y, r))
        z = height(x, y) - 0.25 * r
        a, b, c = rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi), rng.uniform(0, 2 * math.pi)
        Rz = np.array(((math.cos(a), -math.sin(a), 0), (math.sin(a), math.cos(a), 0), (0, 0, 1)))
        Rx = np.array(((1, 0, 0), (0, math.cos(b), -math.sin(b)), (0, math.sin(b), math.cos(b))))
        Ry = np.array(((math.cos(c), 0, math.sin(c)), (0, 1, 0), (-math.sin(c), 0, math.cos(c))))
        R = Rz @ Rx @ Ry
        sx, sy, sz = rng.uniform(0.8, 1.25), rng.uniform(0.8, 1.25), rng.uniform(0.55, 0.85)
        verts = []
        for v in _ICO_V:
            n = np.array(v, float) / math.sqrt(1 + _PHI * _PHI)
            n = n * rng.uniform(0.82, 1.12)
            p = R @ (n * np.array((sx, sy, 1.0))) * r
            verts.append((x + p[0], y + p[1], z + p[2] * sz))
        vid = [m.vid(p) for p in verts]
        centre = np.array((x, y, z))
        for f in _ICO_F:
            fp = [verts[k] for k in f]
            out = np.mean(np.array(fp), axis=0) - centre
            m.face([vid[k] for k in f], fp, skin, out=tuple(out), thr=60.0)


def ice_round(A):
    C = ice_cells(A)
    m = kit.Mesh("ice_round")
    skin = Planar(C["bed"], 2, (-L / 2, -W / 2, 0.0))
    rng = random.Random(1874)
    R = 0.20
    bumps = [(rng.uniform(-0.13, 0.13), rng.uniform(-0.13, 0.13), rng.uniform(0.03, 0.06), rng.uniform(0.003, 0.008)) for _ in range(8)]
    rings, sides = 12, 36
    ids, pts = [], []
    centre = (0.0, 0.0, _height(0.0, 0.0, bumps, R))
    cid = m.vid(centre)
    for i in range(1, rings + 1):
        ri, rp = [], []
        for j in range(sides):
            a = 2 * math.pi * (j + 0.5 * (i % 2)) / sides
            rr = R * i / rings
            if i < rings:
                rr += rng.uniform(-0.003, 0.003)
            x, y = rr * math.cos(a), rr * math.sin(a)
            z = _height(x, y, bumps, R - rr) + (rng.uniform(-0.0015, 0.0015) if i < rings else 0.0)
            ri.append(m.vid((x, y, z)))
            rp.append((x, y, z))
        ids.append(ri)
        pts.append(rp)
    for j in range(sides):
        k = (j + 1) % sides
        m.face([cid, ids[0][j], ids[0][k]], [centre, pts[0][j], pts[0][k]], skin, out=(0, 0, 1), thr=50.0)
    for i in range(rings - 1):
        for j in range(sides):
            k = (j + 1) % sides
            q = [(i, j), (i, k), (i + 1, k), (i + 1, j)]
            m.face([ids[a][b] for a, b in q], [pts[a][b] for a, b in q], skin, out=(0, 0, 1), thr=50.0)
    _lumps(m, skin, rng, lambda x, y: _height(x, y, bumps, R - math.hypot(x, y)), lambda x, y: math.hypot(x, y) < R - 0.03)
    return m
