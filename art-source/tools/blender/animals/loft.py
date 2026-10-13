"""Lofts: a body part as a run of cross-sections along a curved spine, as a signed distance.

A station is (centre, half-width, half-height above, half-height below, squareness): the cross-section is a
superellipse of exponent `sq` (2 an ellipse, 3-4 boxier: the muzzle, the pig's barrel) with its widest line through
the centre, so the outline seen from the side (the top line and the under line) and from above (the width) are given
directly, the way an animal's anatomy is drawn: withers, back, loin, croup; brisket, tuck-up; the skull's breadth at
the cheeks. The spine is a smooth curve through the stations (Catmull-Rom), the values between stations smooth too;
every short span of it is a capped slice of the loft and the loft is their union, so it bends with the spine.
"Above" is across the spine away from the side axis: up for a body or a head, forward for a leg that hangs down, the
crest for the neck.
"""

import numpy as np


def _catmull(P, n):
    """Points along a Catmull-Rom curve through P (k, d), n per span, ends included; and each point's station index."""
    P = np.asarray(P, np.float64)
    k = len(P)
    if k == 2:
        t = np.linspace(0, 1, n + 1)
        return P[0] * (1 - t[:, None]) + P[1] * t[:, None], t
    ext = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out, par = [], []
    for i in range(k - 1):
        p0, p1, p2, p3 = ext[i], ext[i + 1], ext[i + 2], ext[i + 3]
        ts = np.linspace(0, 1, n + 1)[:-1] if i < k - 2 else np.linspace(0, 1, n + 1)
        for t in ts:
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
            par.append(i + t)
    return np.array(out), np.array(par)


def _along(vals, idx):
    """Station values at fractional station indices, smoothly (a Catmull-Rom curve through them)."""
    vals = np.asarray(vals, np.float64)
    if len(vals) == 1:
        return np.full(len(idx), vals[0])
    pts, _ = _catmull(np.stack([np.arange(len(vals), dtype=float), vals], 1), 24)
    return np.interp(idx, pts[:, 0], pts[:, 1])


class Loft:
    """stations: list of (centre (3,), w, up, down[, sq]); side: the side axis (the animal's left)."""

    def __init__(self, stations, side=(1.0, 0.0, 0.0), per=8):
        st = list(stations)
        C = np.array([np.asarray(s[0], np.float64) for s in st])
        self.side = np.asarray(side, np.float64)
        self.P, idx = _catmull(C, per)
        self.W = np.maximum(_along([s[1] for s in st], idx), 1e-4)
        self.A = np.maximum(_along([s[2] for s in st], idx), 1e-4)
        self.D = np.maximum(_along([s[3] for s in st], idx), 1e-4)
        self.E = np.clip(_along([s[4] if len(s) > 4 else 2.0 for s in st], idx), 1.6, 6.0)

    def frames(self):
        """Per span: start, axis, length, side, above."""
        out = []
        for j in range(len(self.P) - 1):
            a, b = self.P[j], self.P[j + 1]
            ab = b - a
            L = float(np.linalg.norm(ab))
            if L < 1e-9:
                continue
            t = ab / L
            s = self.side - t * (t @ self.side)
            sn = float(np.linalg.norm(s))
            s = s / sn if sn > 1e-9 else np.array((0.0, 1.0, 0.0))
            out.append((j, a, t, L, s, np.cross(t, s)))
        return out

    def _vframes(self):
        """Side and above axes at every curve point (the average of the spans either side), and per span its axis."""
        if getattr(self, "_vf", None) is not None:
            return self._vf
        P = self.P
        T = np.diff(P, axis=0)
        Ls = np.linalg.norm(T, axis=1)
        T = T / np.maximum(Ls[:, None], 1e-12)
        tv = np.vstack([T[:1], (T[:-1] + T[1:]) / 2, T[-1:]])
        tv /= np.maximum(np.linalg.norm(tv, axis=1, keepdims=True), 1e-12)
        sv = self.side[None, :] - tv * (tv @ self.side)[:, None]
        bad = np.linalg.norm(sv, axis=1) < 1e-9
        sv[bad] = (0.0, 1.0, 0.0)
        sv /= np.linalg.norm(sv, axis=1, keepdims=True)
        nv = np.cross(tv, sv)
        self._vf = (T, Ls, sv, nv)
        slope = np.max(np.abs(np.stack([np.diff(self.W), np.diff(self.A), np.diff(self.D)], 1)), axis=1) / np.maximum(Ls, 1e-9)
        self._lean = np.sqrt(1.0 + slope * slope)
        return self._vf

    def __call__(self, p):
        """Each point is measured in the cross-section through its nearest point on the spine (the frames turned
        smoothly along it), so the surface runs on unbroken round bends; past the two ends it is capped."""
        p = np.asarray(p, np.float64)
        n = len(p)
        P = self.P
        T, Ls, sv, nv = self._vframes()
        m = len(T)
        best = np.full(n, np.inf)
        seg = np.zeros(n, np.int64)
        hh = np.zeros(n)
        hraw = np.zeros(n)
        for j in range(m):
            q0 = p - P[j]
            hr = (q0 @ T[j]) / max(Ls[j], 1e-12)
            h = np.clip(hr, 0.0, 1.0)
            d = np.linalg.norm(q0 - (h * Ls[j])[:, None] * T[j], axis=1)
            take = d < best
            best[take] = d[take]
            seg[take] = j
            hh[take] = h[take]
            hraw[take] = hr[take]
        j0, j1 = seg, seg + 1
        h = hh
        c = P[j0] + (h * Ls[seg])[:, None] * T[seg]
        s = sv[j0] * (1 - h)[:, None] + sv[j1] * h[:, None]
        s /= np.maximum(np.linalg.norm(s, axis=1, keepdims=True), 1e-12)
        nn = nv[j0] * (1 - h)[:, None] + nv[j1] * h[:, None]
        nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-12)
        q = p - c
        u = (q * s).sum(1)
        v = (q * nn).sum(1)
        w = self.W[j0] + h * (self.W[j1] - self.W[j0])
        up = self.A[j0] + h * (self.A[j1] - self.A[j0])
        dn = self.D[j0] + h * (self.D[j1] - self.D[j0])
        e = self.E[j0] + h * (self.E[j1] - self.E[j0])
        hv = np.where(v > 0, up, dn)
        qx = np.abs(u) / w
        qy = np.abs(v) / hv
        f = (qx ** e + qy ** e) ** (1.0 / e)
        fe = np.maximum(f, 1e-6) ** (1.0 - e)
        gx = fe * np.maximum(qx, 1e-9) ** (e - 1.0) / w
        gy = fe * np.maximum(qy, 1e-9) ** (e - 1.0) / hv
        g = np.sqrt(gx * gx + gy * gy)
        d2 = (f - 1.0) / np.maximum(g, 1e-6)
        d2 = np.maximum(d2, -np.minimum(np.minimum(w, up), dn))
        # where the cross-section swells or shrinks fast along the spine, the surface leans and the true distance is
        # shorter than across the section: scaled down by the lean (keeps the field a distance, so meshing stays even)
        d2 = d2 / self._lean[seg]
        # past the loft's two ends: capped
        ax = np.where(seg == 0, np.maximum(-hraw, 0.0) * Ls[0], 0.0) + np.where(seg == m - 1, np.maximum(hraw - 1.0, 0.0) * Ls[-1], 0.0)
        return np.where(ax > 0, np.where(d2 > 0, np.sqrt(d2 * d2 + ax * ax), ax), d2)

    def section(self, z_or_index):
        return self.P[z_or_index]


def loft(stations, side=(1.0, 0.0, 0.0), per=8):
    return Loft(stations, side, per)
