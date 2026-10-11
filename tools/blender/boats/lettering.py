"""The lettering kit and the names atlas of the boats (plan docs/plans/next-update.md W3; contract docs/boats.md).

Our own capitals, drawn here as vector shapes (no font file): a Roman serif of the 1870s (high contrast,
hairline bracketed serifs, ball and beak terminals), a Clarendon slab (the ship letter of the time: heavy
bracketed slabs, low contrast, ball terminals), a block sans for the lighters' names and a condensed sans for
their numbers, and a light brush letter for the small boats. A-Z, 0-9, ". & -", A E O U with umlauts, O with a
slash, A with a ring, and the raised "o" of "No".

Every glyph is a set of shapes in cap-height units (baseline 0, cap 1): straight strokes and serifs as
polygons, curves as centre lines drawn with an oval nib (wide across, thin up and down, so curves are thick at
the sides and thin at the top and bottom like a pointed-pen Roman). Shapes are filled at a high master size
(MASTER px to the cap), set into lines with optical spacing (row profiles), then brought down to the cell with
an area filter, coloured in linear light and written as sRGB.

Writes, from shared/fleet.json:
  client/public/models/boat_names.png, boat_names_1.png, ...  the pages (opaque RGB, linear filter + mipmaps
                                                              in the game; no bump: flat lettering)
  client/public/models/boat_names.json                        the index (pages, cells, vessels, names)

Run (plain Python with numpy, or inside Blender):
    python tools/blender/boats/lettering.py [--scale 0.5] [--preview DIR]
    blender -b --factory-startup -P tools/blender/boats/lettering.py -- --closeups DIR

--preview writes a labelled sheet of every page; --closeups (Blender only) renders boards at real size from
10 m and 25 m with the game's field of view, one sample a pixel, so mipmaps alone must keep them calm.
Name zones: when client/public/models/boats.glb has a root extra "name_zones" ({"bow_p": [w, h], ...}) the
cells are laid out for that board shape; without it every board is taken as 4:1 (the cell's own shape).
"""
import json
import math
import os
import struct
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FLEET = os.path.join(ROOT, "shared", "fleet.json")
OUT_DIR = os.path.join(ROOT, "client", "public", "models")
GLB = os.path.join(OUT_DIR, "boats.glb")

MASTER = 420          # px per cap height when a glyph is filled
YB, YT = -0.32, 1.42  # the glyph canvas, in cap units (room for umlauts and the Q's tail)
COLS, ROWS = 4, 16    # cells a page: 4 across, 16 down (64), each 4:1


# --------------------------------------------------------------------------------------------- the fonts

class Font:
    def __init__(self, name, T, t, curve=1.06, serif=None, s_th=0.0, s_ext=0.0, s_br=0.0, wf=1.0,
                 term=None, ball=0.0, track=0.0, space=0.3, o=0.014):
        self.name, self.T, self.t, self.serif = name, T, t, serif
        self.a = T * curve / 2.0           # nib half-width (across): curves at their sides
        self.b = t / 2.0                   # nib half-height: curves at top and bottom
        self.s_th, self.s_ext, self.s_br = s_th, s_ext, s_br
        self.wf, self.term, self.ball, self.track, self.space, self.o = wf, term, ball, track, space, o


FONTS = {
    # Scotch Roman of the sign-writers: contrast about 3:1, hairline serifs with a bracket
    "roman": Font("roman", T=0.165, t=0.055, serif="hair", s_th=0.042, s_ext=0.085, s_br=0.06,
                  term="barb", ball=0.085, track=0.05, space=0.34),
    # Clarendon: heavy, low contrast, slab serifs with a small bracket, ball terminals
    "slab": Font("slab", T=0.2, t=0.105, curve=1.04, serif="slab", s_th=0.085, s_ext=0.07, s_br=0.04,
                 wf=1.04, term="ball", ball=0.105, track=0.05, space=0.34),
    # block letters: an even, heavy sans
    "sans": Font("sans", T=0.18, t=0.155, curve=1.02, wf=0.94, track=0.07, space=0.34),
    # the condensed sans of the lighters' numbers
    "cond": Font("cond", T=0.15, t=0.125, curve=1.02, wf=0.7, track=0.05, space=0.26),
    # a light brush letter for the small boats (set with a wobble by the hand look)
    "hand": Font("hand", T=0.15, t=0.1, curve=1.0, wf=0.92, track=0.08, space=0.36),
}


# --------------------------------------------------------------------------------------------- filling

class Canvas:
    """A glyph's mask at MASTER px a cap unit; x from -pad to w + pad, y from YB to YT."""

    def __init__(self, width, pad=0.3, S=MASTER):
        self.S, self.pad, self.width = S, pad, width
        self.w = int(math.ceil((width + 2 * pad) * S))
        self.h = int(math.ceil((YT - YB) * S))
        self.m = np.zeros((self.h, self.w), dtype=bool)

    def _box(self, x0, y0, x1, y1):
        S = self.S
        j0 = max(0, int(math.floor((x0 + self.pad) * S)) - 1)
        j1 = min(self.w, int(math.ceil((x1 + self.pad) * S)) + 2)
        i0 = max(0, int(math.floor((YT - y1) * S)) - 1)
        i1 = min(self.h, int(math.ceil((YT - y0) * S)) + 2)
        if j1 <= j0 or i1 <= i0:
            return None
        X = (np.arange(j0, j1) + 0.5) / S - self.pad
        Y = YT - (np.arange(i0, i1) + 0.5) / S
        XX, YY = np.meshgrid(X, Y)
        return (i0, i1, j0, j1), XX, YY

    def poly(self, pts):
        P = np.asarray(pts, dtype=float)
        bx = self._box(P[:, 0].min(), P[:, 1].min(), P[:, 0].max(), P[:, 1].max())
        if bx is None:
            return
        (i0, i1, j0, j1), XX, YY = bx
        wind = np.zeros(XX.shape, dtype=np.int16)
        n = len(P)
        for k in range(n):
            ax, ay = P[k]
            bx_, by = P[(k + 1) % n]
            cross = (bx_ - ax) * (YY - ay) - (XX - ax) * (by - ay)
            up = (ay <= YY) & (by > YY)
            dn = (by <= YY) & (ay > YY)
            wind += (up & (cross > 0)).astype(np.int16)
            wind -= (dn & (cross < 0)).astype(np.int16)
        self.m[i0:i1, j0:j1] |= wind != 0

    def stroke(self, pts, a, b):
        """A centre line drawn with an oval nib of half-axes a (across) and b (up and down)."""
        P = np.asarray(pts, dtype=float)
        for k in range(len(P) - 1):
            (x0, y0), (x1, y1) = P[k], P[k + 1]
            bx = self._box(min(x0, x1) - a, min(y0, y1) - b, max(x0, x1) + a, max(y0, y1) + b)
            if bx is None:
                continue
            (i0, i1, j0, j1), XX, YY = bx
            u, v = (XX - x0) / a, (YY - y0) / b
            du, dv = (x1 - x0) / a, (y1 - y0) / b
            L2 = du * du + dv * dv
            s = np.clip((u * du + v * dv) / L2, 0, 1) if L2 > 0 else 0.0
            d2 = (u - s * du) ** 2 + (v - s * dv) ** 2
            self.m[i0:i1, j0:j1] |= d2 <= 1.0

    def disc(self, cx, cy, rx, ry=None):
        ry = rx if ry is None else ry
        bx = self._box(cx - rx, cy - ry, cx + rx, cy + ry)
        if bx is None:
            return
        (i0, i1, j0, j1), XX, YY = bx
        self.m[i0:i1, j0:j1] |= ((XX - cx) / rx) ** 2 + ((YY - cy) / ry) ** 2 <= 1.0


def arc_pts(cx, cy, rx, ry, a0, a1, n=None):
    n = n or max(16, int(abs(a1 - a0) / 2.0))
    th = np.radians(np.linspace(a0, a1, n))
    return np.stack([cx + rx * np.cos(th), cy + ry * np.sin(th)], 1)


def spline_pts(pts, n=36):
    """Catmull-Rom through the points (centripetal), n samples a span."""
    P = [np.asarray(p, dtype=float) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        t0 = 0.0
        t1 = t0 + max(np.linalg.norm(p1 - p0), 1e-6) ** 0.5
        t2 = t1 + max(np.linalg.norm(p2 - p1), 1e-6) ** 0.5
        t3 = t2 + max(np.linalg.norm(p3 - p2), 1e-6) ** 0.5
        for tt in np.linspace(t1, t2, n, endpoint=(i == len(P) - 3)):
            a1 = (t1 - tt) / (t1 - t0) * p0 + (tt - t0) / (t1 - t0) * p1
            a2 = (t2 - tt) / (t2 - t1) * p1 + (tt - t1) / (t2 - t1) * p2
            a3 = (t3 - tt) / (t3 - t2) * p2 + (tt - t2) / (t3 - t2) * p3
            b1 = (t2 - tt) / (t2 - t0) * a1 + (tt - t0) / (t2 - t0) * a2
            b2 = (t3 - tt) / (t3 - t1) * a2 + (tt - t1) / (t3 - t1) * a3
            out.append((t2 - tt) / (t2 - t1) * b1 + (tt - t1) / (t2 - t1) * b2)
    return np.array(out)


# --------------------------------------------------------------------------------------------- glyph parts

class G:
    """Builds one glyph on a canvas with the font's strokes, serifs and terminals."""

    def __init__(self, F, W):
        self.F, self.W = F, W
        self.c = Canvas(W)

    # straight strokes
    def rect(self, x0, y0, x1, y1):
        self.c.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])

    def leg(self, xb, xt, hw, yb=0.0, yt=1.0):
        """A slanted stroke: its foot spans [xb, xb + hw] at yb, its head [xt, xt + hw] at yt (cut level)."""
        self.c.poly([(xb, yb), (xb + hw, yb), (xt + hw, yt), (xt, yt)])

    def hw(self, th, dx, dy=1.0):
        """Across-the-row width of a slanted stroke of thickness th running dx across per dy up."""
        return th * math.hypot(dx, dy) / abs(dy)

    # curves
    def arc(self, cx, cy, rx, ry, a0, a1, a=None, b=None):
        self.c.stroke(arc_pts(cx, cy, rx, ry, a0, a1), a or self.F.a, b or self.F.b)

    def curve(self, pts, a=None, b=None):
        self.c.stroke(spline_pts(pts), a or self.F.a, b or self.F.b)

    def bowl(self, xs, xr, y0, y1, xc=None):
        """A stem's bowl (B D P R): flat bars out of the stem at y0 and y1, a half oval to xr."""
        F = self.F
        ry = (y1 - y0) / 2.0
        if xc is None:
            xc = xr - ry * 1.0
        xc = max(xc, xs + 0.01)
        rx = max(0.02, xr - xc - F.a)
        self.rect(xs, y1 - 2 * F.b, xc + 0.002, y1)
        self.rect(xs, y0, xc + 0.002, y0 + 2 * F.b)
        self.arc(xc, (y0 + y1) / 2.0, rx, ry - F.b, 90, -90)

    # serifs
    def serif(self, xc, hw, at="b", side="lr"):
        """Foot (at='b') or head (at='t') serif on a stroke centred at xc, hw across."""
        F = self.F
        if not F.serif:
            return
        x0 = xc - hw / 2.0 - (F.s_ext if "l" in side else 0.0)
        x1 = xc + hw / 2.0 + (F.s_ext if "r" in side else 0.0)
        th, br = F.s_th, F.s_br
        if at == "b":
            self.rect(x0, 0.0, x1, th)
            y, sg = th, 1.0
        else:
            self.rect(x0, 1.0 - th, x1, 1.0)
            y, sg = 1.0 - th, -1.0
        ext = F.s_ext
        r = min(br, ext * 0.92)
        for s, xe in (("l", xc - hw / 2.0), ("r", xc + hw / 2.0)):
            if s not in side:
                continue
            d = -1.0 if s == "l" else 1.0
            cx, cy = xe + d * r, y + sg * r
            a_s = math.atan2(-sg, 0.0)
            a_e = math.atan2(0.0, -d)
            da = (a_e - a_s + math.pi) % (2 * math.pi) - math.pi
            pts = [(xe, y)] + [(cx + r * math.cos(a_s + da * k / 12), cy + r * math.sin(a_s + da * k / 12))
                               for k in range(13)]
            self.c.poly(pts)

    def arm(self, xe, y_edge, length, down=True):
        """The serif at the end of a bar (E F L T Z): a beak hanging from it (down) or rising (up)."""
        F = self.F
        if not F.serif:
            return
        if F.serif == "hair":
            w = F.t * 1.25
            y1 = y_edge - length if down else y_edge + length
            self.c.poly([(xe, y_edge), (xe, y1), (xe - w * 0.8, y1), (xe - w * 1.9, y_edge)])
        else:
            w = F.s_th * 1.15
            y1 = y_edge - length if down else y_edge + length
            self.rect(xe - w, min(y_edge, y1), xe, max(y_edge, y1))

    def term(self, x, y, up=True, inside=-1.0):
        """A curve's end: a ball (slab) or a beak (Roman). x, y: the end of the centre line; inside: -1 when the
        curve's body lies to the left (C's top end), +1 to the right."""
        F = self.F
        if F.term == "ball":
            r = F.ball
            self.c.disc(x + inside * r * 0.25, y + (-r * 0.45 if up else r * 0.45), r)
        elif F.term == "barb":
            w = F.T * 0.58
            xo = x - inside * F.a * 0.45   # the beak's outer (vertical) edge
            x0, x1 = (xo - w, xo) if inside < 0 else (xo, xo + w)
            self.beak(x0, x1, 0.71 if up else 0.27, up)

    def beak(self, x0, x1, y_end, up=True):
        """A vertical beak under (up) or over a curve's end: each column from the curve's edge to y_end."""
        c = self.c
        j0 = max(0, int((x0 + c.pad) * c.S))
        j1 = min(c.w, int((x1 + c.pad) * c.S) + 1)
        ie = int((YT - y_end) * c.S)
        imid = int((YT - 0.5) * c.S)
        for j in range(j0, j1):
            col = c.m[:, j]
            if up:
                idx = np.where(col[:imid])[0]
                if len(idx):
                    c.m[idx[0]:ie, j] = True
            else:
                idx = np.where(col[imid:])[0]
                if len(idx):
                    c.m[ie:imid + idx[-1] + 1, j] = True

    def roundball(self, x, y, r=None):
        """A ball terminal for digits and J, in every serif font (the Didone and Clarendon figure)."""
        F = self.F
        if F.serif:
            self.c.disc(x, y, r or F.ball)


# --------------------------------------------------------------------------------------------- the glyphs

def glyph(ch, F):
    """Fill one character in font F; returns (canvas, width)."""
    T, t, a, b, o, wf = F.T, F.t, F.a, F.b, F.o, F.wf
    sans = F.serif is None
    tk = t if not sans else F.t      # the thin stroke (sans: nearly as heavy)
    thick_d = T * 0.98               # slanted thick strokes
    thin_d = max(tk * 1.1, 0.06 if not sans else tk)

    def make(Wb):
        return G(F, Wb * wf)

    if ch == " ":
        g = make(F.space / wf)
        return g.c, g.W

    if ch in "AÄÅ":
        g = make(0.78)
        W = g.W
        ap = 0.02 if F.serif == "hair" else (T * 0.45 if sans else 0.05)
        xa = W / 2.0
        hl = g.hw(thin_d, xa - W * 0.1)
        hr = g.hw(thick_d, W / 2.0 - W * 0.1)
        g.leg(0.0, xa - ap / 2.0 - hl * 0.5, hl)
        g.leg(W - hr, xa + ap / 2.0 - hr * 0.5, hr)
        yc = 0.26
        fx = lambda xb, xt, h, y: xb + (xt - xb) * y + h / 2.0  # noqa: E731
        xl = fx(0.0, xa - ap / 2.0 - hl * 0.5, hl, yc)
        xr = fx(W - hr, xa + ap / 2.0 - hr * 0.5, hr, yc)
        g.rect(xl, yc, xr, yc + (tk if not sans else T * 0.82))
        g.serif(hl / 2.0, hl, "b")
        g.serif(W - hr / 2.0, hr, "b")
        if ch == "Ä":
            umlaut(g, W / 2.0)
        if ch == "Å":
            rr = min(max(t * 0.7, 0.032), 0.04)
            g.arc(W / 2.0, 1.2, 0.09, 0.09, 0, 360, a=rr, b=rr)
        return g.c, g.W

    if ch == "B":
        g = make(0.66)
        W = g.W
        g.rect(0, 0, T, 1)
        m = 0.535
        g.bowl(T * 0.5, W - 0.055 * wf, m - b, 1.0)
        g.bowl(T * 0.5, W, 0.0, m + b)
        g.serif(T / 2, T, "t", "l")
        g.serif(T / 2, T, "b", "l")
        return g.c, g.W

    if ch in "CG":
        g = make(0.72 if ch == "C" else 0.78)
        W = g.W
        cx, rx, ry = W / 2.0 + 0.005, W / 2.0 - a, 0.5 + o - b
        a0 = 40 if sans else 50
        a1 = (320 if sans else 312) if ch == "C" else 352
        g.arc(cx, 0.5, rx, ry, a0, a1)
        ex, ey = cx + rx * math.cos(math.radians(a0)), 0.5 + ry * math.sin(math.radians(a0))
        g.term(ex, ey, up=True)
        if ch == "C" and F.term == "barb":
            g.term(cx + rx * math.cos(math.radians(a1)), 0.5 + ry * math.sin(math.radians(a1)), up=False)
        elif ch == "C" and F.term == "ball":
            g.c.disc(cx + rx * math.cos(math.radians(a1)) - 0.01, 0.5 + ry * math.sin(math.radians(a1)) + 0.02,
                     F.ball * 0.8)
        if ch == "G":
            g.rect(W - T, 0.02, W, 0.47)
            if F.serif:
                g.rect(W - T - 0.1 * wf, 0.47 - (F.s_th if F.serif == "slab" else tk), W + 0.025, 0.47)
        return g.c, g.W

    if ch == "D":
        g = make(0.76)
        W = g.W
        g.rect(0, 0, T, 1)
        g.bowl(T * 0.5, W, 0.0, 1.0, xc=W - 0.43 * wf)
        g.serif(T / 2, T, "t", "l")
        g.serif(T / 2, T, "b", "l")
        return g.c, g.W

    if ch in "EË":
        g = make(0.6)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(0, 0, T, 1)
        g.rect(T * 0.5, 1 - bt, W - 0.01, 1)
        g.rect(T * 0.5, 0.5 - bt / 2 + 0.01, W - 0.09 * wf, 0.5 + bt / 2 + 0.01)
        g.rect(T * 0.5, 0, W + 0.015, bt)
        g.arm(W - 0.01, 1 - bt, 0.2)
        g.arm(W + 0.015, bt, 0.21, down=False)
        if F.serif:
            g.arm(W - 0.09 * wf, 0.51 + bt / 2, 0.09, down=False)
            g.arm(W - 0.09 * wf, 0.51 - bt / 2, 0.09, down=True)
        g.serif(T / 2, T, "t", "l")
        g.serif(T / 2, T, "b", "l")
        if ch == "Ë":
            umlaut(g, W / 2.0)
        return g.c, g.W

    if ch == "F":
        g = make(0.58)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(0, 0, T, 1)
        g.rect(T * 0.5, 1 - bt, W, 1)
        g.rect(T * 0.5, 0.48 - bt / 2, W - 0.1 * wf, 0.48 + bt / 2)
        g.arm(W, 1 - bt, 0.2)
        if F.serif:
            g.arm(W - 0.1 * wf, 0.48 + bt / 2, 0.09, down=False)
            g.arm(W - 0.1 * wf, 0.48 - bt / 2, 0.09, down=True)
        g.serif(T / 2, T, "t", "l")
        g.serif(T / 2, T, "b")
        return g.c, g.W

    if ch == "H":
        g = make(0.8)
        W = g.W
        g.rect(0, 0, T, 1)
        g.rect(W - T, 0, W, 1)
        g.rect(T / 2, 0.5 - (tk if not sans else T * 0.86) / 2, W - T / 2, 0.5 + (tk if not sans else T * 0.86) / 2)
        for x in (T / 2, W - T / 2):
            g.serif(x, T, "t")
            g.serif(x, T, "b")
        return g.c, g.W

    if ch == "I":
        g = G(F, T)
        g.rect(0, 0, T, 1)
        g.serif(T / 2, T, "t")
        g.serif(T / 2, T, "b")
        return g.c, g.W

    if ch == "J":
        g = make(0.46)
        W = g.W
        xs = W - T / 2
        rx = (W - T / 2 - 0.08) / 2.0 if not sans else (W - T / 2 - a) / 2.0
        cy = 0.3
        g.rect(W - T, cy, W, 1)
        g.arc(xs - rx, cy, rx, cy + o - b, 0, -175 if F.serif else -180)
        if F.serif:
            g.roundball(xs - 2 * rx + 0.01, cy + 0.03, F.ball * 0.95)
        g.serif(xs, T, "t")
        return g.c, g.W

    if ch == "K":
        g = make(0.76)
        W = g.W
        g.rect(0, 0, T, 1)
        ha = g.hw(thin_d, W * 0.66)
        xa_t = W - 0.04 * wf - ha
        ya = 0.36
        g.leg(T * 0.75, xa_t, ha, ya, 1.0)
        yj = 0.6
        xj = T * 0.75 + (xa_t - T * 0.75) * (yj - ya) / (1 - ya) + ha / 2
        hl = g.hw(thick_d, W - xj)
        g.leg(W - hl, xj - hl / 2, hl, 0.0, yj)
        g.serif(T / 2, T, "t")
        g.serif(T / 2, T, "b")
        g.serif(xa_t + ha / 2, ha, "t")
        g.serif(W - hl / 2, hl, "b")
        return g.c, g.W

    if ch == "L":
        g = make(0.6)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(0, 0, T, 1)
        g.rect(T * 0.5, 0, W, bt)
        g.arm(W, bt, 0.23, down=False)
        g.serif(T / 2, T, "t")
        g.serif(T / 2, T, "b", "l")
        return g.c, g.W

    if ch == "M":
        g = make(0.94)
        W = g.W
        sl = tk * 1.15 if not sans else T * 0.92
        sr = T if not sans else T * 0.92
        g.rect(0, 0, sl, 1)
        g.rect(W - sr, 0, W, 1)
        xm = W / 2.0 + 0.01
        h1 = g.hw(thick_d if not sans else T * 0.9, xm)
        h2 = g.hw(thin_d if not sans else T * 0.9, W - xm)
        g.leg(xm - h1 * 0.55, 0.0, h1)
        g.leg(xm - h2 * 0.45, W - sr * 0.4 - h2 + sr * 0.35, h2)
        g.serif(sl / 2, sl, "b")
        g.serif(W - sr / 2, sr, "b")
        g.serif(sl / 2, sl, "t", "l")
        g.serif(W - sr / 2, sr, "t", "r")
        return g.c, g.W

    if ch == "N":
        g = make(0.8)
        W = g.W
        s = tk * 1.15 if not sans else T * 0.92
        g.rect(0, 0, s, 1)
        g.rect(W - s, 0, W, 1)
        hd = g.hw(thick_d, W)
        g.leg(W - hd, 0.0, hd)
        g.serif(s / 2, s, "b")
        g.serif(s / 2, s, "t", "l")
        g.serif(W - s / 2, s, "t")
        return g.c, g.W

    if ch in "OÖØ":
        g = make(0.8)
        W = g.W
        g.arc(W / 2.0, 0.5, W / 2.0 - a, 0.5 + o - b, 0, 360)
        if ch == "Ö":
            umlaut(g, W / 2.0)
        if ch == "Ø":
            h = g.hw(thin_d * 1.1, W * 0.9, 1.14)
            g.leg(W * 0.06, W * 0.94 - h, h, -0.07, 1.07)
        return g.c, g.W

    if ch == "P":
        g = make(0.64)
        W = g.W
        g.rect(0, 0, T, 1)
        g.bowl(T * 0.5, W, 0.44, 1.0)
        g.serif(T / 2, T, "t", "l")
        g.serif(T / 2, T, "b")
        return g.c, g.W

    if ch == "Q":
        g = make(0.8)
        W = g.W
        g.arc(W / 2.0, 0.5, W / 2.0 - a, 0.5 + o - b, 0, 360)
        g.c.poly([(W * 0.42, 0.1), (W * 0.58, 0.16), (W * 1.02, -0.17), (W * 0.86, -0.19)])
        return g.c, g.W

    if ch == "R":
        g = make(0.72)
        W = g.W
        g.rect(0, 0, T, 1)
        g.bowl(T * 0.5, W - 0.065 * wf, 0.46, 1.0)
        yj = 0.48
        xj = W * 0.4
        hl = g.hw(thick_d, W - xj)
        g.leg(W - hl, xj - hl / 2, hl, 0.0, yj)
        g.serif(T / 2, T, "t", "l")
        g.serif(T / 2, T, "b")
        g.serif(W - hl / 2, hl, "b", "r" if F.serif == "hair" else "lr")
        return g.c, g.W

    if ch == "S":
        g = make(0.58)
        W = g.W
        top, bot = 1 + o - b, -o + b
        pts = [(W * 0.86, 0.83), (W * 0.52, top), (a + 0.012, 0.75), (W * 0.5, 0.515),
               (W - a - 0.012, 0.255), (W * 0.48, bot), (W * 0.1, 0.17)]
        if sans:
            pts[0], pts[-1] = (W * 0.9, 0.86), (W * 0.06, 0.15)
        g.curve(pts)
        if F.term == "ball":
            g.c.disc(W * 0.86 - 0.005, 0.81, F.ball * 0.9)
            g.c.disc(W * 0.1 + 0.01, 0.19, F.ball * 0.9)
        elif F.term == "barb":
            g.c.disc(W * 0.86 - 0.004, 0.815, F.ball * 0.72)
            g.c.disc(W * 0.1 + 0.006, 0.185, F.ball * 0.72)
        return g.c, g.W

    if ch == "T":
        g = make(0.68)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(0, 1 - bt, W, 1)
        g.rect(W / 2 - T / 2, 0, W / 2 + T / 2, 1)
        g.arm(W, 1 - bt, 0.21)
        if F.serif == "hair":
            w = F.t * 1.25
            g.c.poly([(0, 1 - bt), (0, 1 - bt - 0.21), (w * 0.8, 1 - bt - 0.21), (w * 1.9, 1 - bt)])
        elif F.serif == "slab":
            g.rect(0, 1 - bt - 0.21, F.s_th * 1.15, 1 - bt)
        g.serif(W / 2, T, "b")
        return g.c, g.W

    if ch in "UÜ":
        g = make(0.78)
        W = g.W
        cy = 0.34
        if sans:
            g.rect(0, cy, T, 1)
            g.rect(W - T, cy, W, 1)
            g.arc(W / 2, cy, W / 2 - a, cy + o - b, 180, 360)
        else:
            s = tk * 1.15
            g.rect(0, cy, T, 1)
            g.rect(W - s, 0, W, 1)
            xc = (T / 2 + W - s / 2) / 2
            g.arc(xc, cy, xc - T / 2, cy + o - b, 180, 335)
            g.serif(T / 2, T, "t")
            g.serif(W - s / 2, s, "t")
            g.serif(W - s / 2, s, "b", "r")
        if ch == "Ü":
            umlaut(g, W / 2.0)
        return g.c, g.W

    if ch in "VW":
        g = make(0.78 if ch == "V" else 1.1)
        W = g.W
        spans = [(0.0, W)] if ch == "V" else [(0.0, W * 0.57), (W * 0.43, W)]
        for x0, x1 in spans:
            Wv = x1 - x0
            xm = x0 + Wv / 2.0
            hl = g.hw(thick_d, Wv / 2)
            hr = g.hw(thin_d, Wv / 2)
            g.leg(xm - hl * 0.5, x0, hl)
            g.leg(xm - hr * 0.5, x1 - hr, hr)
            g.serif(x0 + hl / 2, hl, "t")
            g.serif(x1 - hr / 2, hr, "t")
        return g.c, g.W

    if ch == "X":
        g = make(0.76)
        W = g.W
        h1 = g.hw(thick_d, W)
        h2 = g.hw(thin_d, W)
        g.leg(W - h1, 0.0, h1)
        g.leg(0.02 * wf, W - h2 - 0.02 * wf, h2)
        for x, h, at in ((h1 / 2, h1, "t"), (W - h1 / 2, h1, "b"), (0.02 * wf + h2 / 2, h2, "b"),
                         (W - 0.02 * wf - h2 / 2, h2, "t")):
            g.serif(x, h, at)
        return g.c, g.W

    if ch == "Y":
        g = make(0.76)
        W = g.W
        yj = 0.46
        h1 = g.hw(thick_d, W / 2, 1 - yj)
        h2 = g.hw(thin_d, W / 2, 1 - yj)
        g.leg(W / 2 - h1 / 2, 0.0, h1, yj, 1.0)
        g.leg(W / 2 - h2 / 2, W - h2, h2, yj, 1.0)
        g.rect(W / 2 - T / 2, 0, W / 2 + T / 2, yj + 0.03)
        g.serif(h1 / 2, h1, "t")
        g.serif(W - h2 / 2, h2, "t")
        g.serif(W / 2, T, "b")
        return g.c, g.W

    if ch == "Z":
        g = make(0.64)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(0.03 * wf, 1 - bt, W, 1)
        g.rect(0, 0, W + 0.01, bt)
        hd = g.hw(thick_d, W)
        g.leg(0.0, W - hd, hd, bt * 0.5, 1 - bt * 0.5)
        g.arm(0.03 * wf + F.t * 1.9 if F.serif == "hair" else 0.03 * wf + F.s_th * 1.15, 1 - bt, 0.2)
        g.arm(W + 0.01, bt, 0.21, down=False)
        return g.c, g.W

    # ---- figures
    if ch == "0":
        g = make(0.6)
        W = g.W
        g.arc(W / 2, 0.5, W / 2 - a, 0.5 + o - b, 0, 360)
        return g.c, g.W

    if ch == "1":
        g = make(0.5)
        W = g.W
        x = W / 2 + 0.03
        g.rect(x - T / 2, 0, x + T / 2, 1 + o)
        hf = g.hw(thin_d, 0.22, 0.2)
        g.leg(x - T / 2 - 0.22 - hf * 0.3, x - T / 2 - hf * 0.6, hf, 0.8, 1.0 + o)
        if F.serif:
            g.rect(x - T / 2 - 0.13, 0, x + T / 2 + 0.13, F.s_th)
        return g.c, g.W

    if ch == "2":
        g = make(0.6)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.curve([(W * 0.13, 0.74), (W * 0.48, 1 + o - b), (W - a - 0.01, 0.72), (W * 0.62, 0.38),
                 (W * 0.08 + a * 0.5, bt * 0.6)])
        g.rect(0, 0, W, bt)
        if F.serif:
            g.roundball(W * 0.13 + 0.01, 0.73)
            g.arm(W, bt, 0.16, down=False)
        return g.c, g.W

    if ch == "3":
        g = make(0.58)
        W = g.W
        g.curve([(W * 0.12, 0.8), (W * 0.48, 1 + o - b), (W - a - 0.02, 0.77), (W * 0.42, 0.53)])
        g.curve([(W * 0.42, 0.53), (W - a, 0.27), (W * 0.48, -o + b), (W * 0.09, 0.19)])
        if F.serif:
            g.roundball(W * 0.12 + 0.01, 0.79, F.ball * 0.9)
            g.roundball(W * 0.09 + 0.01, 0.2, F.ball * 0.95)
        return g.c, g.W

    if ch == "4":
        g = make(0.62)
        W = g.W
        xs = W * 0.7
        g.rect(xs - T / 2, 0, xs + T / 2, 1 + o)
        h = g.hw(thin_d, xs - 0.02, 1 - 0.3)
        g.leg(0.0, xs - h, h, 0.3, 1 + o)
        g.rect(0, 0.28, W, 0.28 + (tk if not sans else T * 0.86))
        if F.serif:
            g.rect(xs - T / 2 - 0.09, 0, xs + T / 2 + 0.09, F.s_th)
        return g.c, g.W

    if ch == "5":
        g = make(0.58)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(W * 0.22, 1 - bt, W * 0.92, 1)
        h = g.hw(thin_d * 1.1, 0.04, 0.44)
        g.leg(W * 0.16, W * 0.22, h, 0.54, 1.0)
        g.curve([(W * 0.18, 0.56), (W * 0.52, 0.66), (W - a, 0.34), (W * 0.48, -o + b), (W * 0.09, 0.18)])
        if F.serif:
            g.roundball(W * 0.09 + 0.01, 0.19, F.ball * 0.95)
        return g.c, g.W

    if ch in "69":
        g = make(0.6)
        W = g.W
        cy, ry = 0.33, 0.33 + o - b
        g.arc(W / 2, cy, W / 2 - a, ry, 0, 360)
        g.curve([(a, cy), (W * 0.2, 0.78), (W * 0.52, 1 + o - b), (W * 0.84, 0.88)])
        if F.serif:
            g.roundball(W * 0.82, 0.86, F.ball * 0.9)
        if ch == "9":
            g.c.m = g.c.m[::-1, ::-1].copy()
            # turned about the glyph's centre: the canvas is not symmetric in y, so shift it back
            shift = int(round(((YT - 1.0) - (0.0 - YB)) * g.c.S))
            g.c.m = np.roll(g.c.m, shift, axis=0)
        return g.c, g.W

    if ch == "7":
        g = make(0.58)
        W = g.W
        bt = tk if not sans else T * 0.86
        g.rect(0.02, 1 - bt, W, 1)
        h = g.hw(thick_d, W * 0.6)
        g.leg(W * 0.3, W - h, h, 0.0, 1 - bt * 0.5)
        if F.serif:
            g.arm(0.02 + F.t * 1.9 if F.serif == "hair" else 0.02 + F.s_th * 1.15, 1 - bt, 0.18)
        return g.c, g.W

    if ch == "8":
        g = make(0.6)
        W = g.W
        g.arc(W / 2, 0.755, W * 0.42 - a * 0.92, 0.245 + o - b * 0.9, 0, 360, a=a * 0.92)
        g.arc(W / 2, 0.27, W / 2 - a, 0.27 + o - b, 0, 360)
        return g.c, g.W

    # ---- marks
    if ch == ".":
        r = max(T * 0.62, 0.08)
        g = G(F, 2 * r)
        g.c.disc(r, r, r)
        return g.c, g.W

    if ch == "-":
        g = G(F, 0.34)
        g.rect(0, 0.36, 0.34, 0.36 + max(T * 0.62, 0.08))
        return g.c, g.W

    if ch == "&":
        g = make(0.82)
        W = g.W
        g.curve([(W * 0.98, 0.0), (W * 0.62, 0.28), (W * 0.3, 0.64), (W * 0.27, 0.86), (W * 0.45, 1 + o - b),
                 (W * 0.63, 0.86), (W * 0.52, 0.66), (W * 0.18, 0.42), (a, 0.2), (W * 0.36, -o + b),
                 (W * 0.66, 0.14), (W * 0.84, 0.44)], b=F.b * 1.15)
        g.rect(W * 0.7, 0.44, W * 1.0, 0.44 + (tk if not sans else T * 0.8))
        return g.c, g.W

    if ch == "o":  # the raised o of "No", with its bar
        g = G(F, 0.36 * max(wf, 0.8))
        W = g.W
        aa, bb = (max(T * 0.33, 0.045), max(t * 0.6, 0.03)) if F.serif else (0.042, 0.036)
        g.arc(W / 2, 0.74, W / 2 - aa, 0.2 - bb, 0, 360, a=aa, b=bb)
        g.rect(0.02, 0.43, W - 0.02, 0.43 + max(t * 0.9, 0.055))
        return g.c, g.W

    raise KeyError("no glyph for %r" % ch)


def umlaut(g, x):
    r = max(g.F.T * 0.47, 0.065)
    for d in (-0.15, 0.15):
        g.c.disc(x + d * max(g.F.wf, 0.8), 1.19, r)


# --------------------------------------------------------------------------------------------- glyph cache, spacing

_CACHE = {}
NB = 48  # rows of the spacing profiles over the cap height


class Glyph:
    def __init__(self, ch, F):
        c, W = glyph(ch, F)
        self.ch, self.F, self.S, self.pad = ch, F, c.S, c.pad
        m = c.m
        cols = np.where(m.any(0))[0]
        self.blank = ch == " " or len(cols) == 0
        if self.blank:
            self.mask = np.zeros((m.shape[0], 1), dtype=bool)
            self.x0, self.x1 = 0.0, W
            self.L = self.R = np.full(NB, np.nan)
            self.W = W
            return
        j0, j1 = cols[0], cols[-1] + 1
        self.mask = m[:, j0:j1]
        self.x0 = j0 / c.S - c.pad          # ink left, cap units
        self.x1 = j1 / c.S - c.pad
        self.W = W
        # profiles over cap rows: left- and right-most ink per band (cap units, from the ink's left edge)
        L, R = np.full(NB, np.nan), np.full(NB, np.nan)
        for k in range(NB):
            y_hi, y_lo = 1.0 - k / NB, 1.0 - (k + 1) / NB
            i0, i1 = int((YT - y_hi) * c.S), int((YT - y_lo) * c.S)
            band = self.mask[i0:i1].any(0)
            idx = np.where(band)[0]
            if len(idx):
                L[k], R[k] = idx[0] / c.S, (idx[-1] + 1) / c.S
        self.L, self.R = L, R


def get_glyph(ch, F):
    key = (ch, F.name)
    if key not in _CACHE:
        _CACHE[key] = Glyph(ch, F)
    return _CACHE[key]


def pair_gap(a, b, target, gmin, gmax):
    """Distance from a's ink left to b's ink left so the optical gap between them is about `target`."""
    if a.blank or b.blank:
        return None
    wa = a.mask.shape[1] / a.S
    both = ~np.isnan(a.R) & ~np.isnan(b.L)

    def mean_gap(off):
        g = np.full(NB, gmax)
        g[both] = np.clip(off + b.L[both] - a.R[both], -1, gmax)
        return g.mean(), (g[both].min() if both.any() else gmax)

    lo, hi = 0.0, wa + 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        mg, mn = mean_gap(mid)
        if mg >= target and mn >= gmin:
            hi = mid
        else:
            lo = mid
    return hi


SPACING = {"target": 0.13, "gmin": 0.065, "gmax": 0.36}


def set_line(runs, track_extra=0.0, jitter=None):
    """Set a line of runs [(text, font_name), ...] at MASTER size. Returns (mask, width in cap units) with
    the mask's rows spanning YB..YT. jitter: a random generator for the hand look (each letter turned,
    lifted and sized a little)."""
    items = []
    for text, fname in runs:
        F = FONTS[fname]
        for ch in text:
            items.append(get_glyph(ch, F))
    S = MASTER
    xs = []
    x = 0.0
    prev = None
    pending_space = 0.0
    for gph in items:
        if gph.blank:
            pending_space += gph.W + gph.F.track
            continue
        if prev is None:
            x = pending_space
        elif pending_space:
            # a word space: the full space after the last letter's ink, whatever the shapes
            x = x + prev.mask.shape[1] / S + pending_space + SPACING["target"]
        else:
            off = pair_gap(prev, gph, SPACING["target"] + gph.F.track + track_extra, SPACING["gmin"], SPACING["gmax"])
            x = x + off
        pending_space = 0.0
        xs.append((x, gph))
        prev = gph
    if not xs:
        return np.zeros((int((YT - YB) * S), 1)), 0.0
    width = xs[-1][0] + xs[-1][1].mask.shape[1] / S
    H = xs[0][1].mask.shape[0]
    out = np.zeros((H, int(math.ceil(width * S)) + 4), dtype=np.float32)
    for x, gph in xs:
        m = gph.mask.astype(np.float32)
        if jitter is not None:
            m = wobble(m, jitter)
        j = int(round(x * S))
        out[:, j:j + m.shape[1]] = np.maximum(out[:, j:j + m.shape[1]], m[:, :out.shape[1] - j])
    return out, width


def wobble(m, rng):
    """A hand-painted letter: turned up to 3 degrees, lifted and sized a little (bilinear, about its middle)."""
    ang = math.radians(rng.uniform(-3.0, 3.0))
    sc = rng.uniform(0.96, 1.04)
    dy = rng.uniform(-0.025, 0.025) * MASTER
    h, w = m.shape
    cy, cx = (YT - 0.5) * MASTER, w / 2.0
    rows, cols = np.mgrid[0:h, 0:w].astype(np.float32)
    ca, sa = math.cos(ang), math.sin(ang)
    y, x = (rows - cy + dy) / sc, (cols - cx) / sc
    src_y = ca * y - sa * x + cy
    src_x = sa * y + ca * x + cx
    y0, x0 = np.floor(src_y).astype(int), np.floor(src_x).astype(int)
    fy, fx = src_y - y0, src_x - x0
    out = np.zeros_like(m)
    for dy_, dx_, wgt in ((0, 0, (1 - fy) * (1 - fx)), (1, 0, fy * (1 - fx)), (0, 1, (1 - fy) * fx), (1, 1, fy * fx)):
        yy, xx = y0 + dy_, x0 + dx_
        ok = (yy >= 0) & (yy < h) & (xx >= 0) & (xx < w)
        out[ok] += m[yy[ok], xx[ok]] * wgt[ok]
    return out


# --------------------------------------------------------------------------------------------- image tools

def resample(arr, axis, scale, off, n_out):
    """Area filter along one axis: input pixel i covers output [i*scale + off, (i+1)*scale + off)."""
    arr = np.moveaxis(arr, axis, 0)
    n_in = arr.shape[0]
    C = np.concatenate([np.zeros((1,) + arr.shape[1:], dtype=np.float64), np.cumsum(arr, axis=0, dtype=np.float64)], 0)
    u = (np.arange(n_out + 1) - off) / scale
    u = np.clip(u, 0, n_in)
    i0 = np.clip(np.floor(u).astype(int), 0, n_in - 1)
    f = (u - i0)
    shape = (-1,) + (1,) * (arr.ndim - 1)
    Cu = C[i0] + (C[i0 + 1] - C[i0]) * f.reshape(shape)
    out = (Cu[1:] - Cu[:-1]) * scale
    return np.moveaxis(out.astype(np.float32), 0, axis)


def box_blur(img, r):
    if r < 1:
        return img
    out = img.astype(np.float32)
    for ax in (0, 1):
        for _ in range(3):
            pad = [(0, 0)] * out.ndim
            pad[ax] = (r, r)
            p = np.pad(out, pad, mode="edge")
            c = np.cumsum(p, axis=ax, dtype=np.float64)
            c = np.concatenate([np.zeros_like(np.take(c, [0], axis=ax)), c], axis=ax)
            n = out.shape[ax]
            out = ((np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=ax) - np.take(c, np.arange(0, n), axis=ax))
                   / (2 * r + 1)).astype(np.float32)
    return out


def dilate(m, r):
    out = m.copy()
    ri = int(math.ceil(r))
    for dy in range(-ri, ri + 1):
        for dx in range(-ri, ri + 1):
            if dx * dx + dy * dy > r * r + 0.25:
                continue
            s = shift(m, dx, dy)
            np.maximum(out, s, out=out)
    return out


def shift(m, dx, dy):
    """Move a picture dx right and dy down (whole pixels), filling with 0."""
    out = np.zeros_like(m)
    h, w = m.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = m[ys, xs]
    return out


def vnoise(rng, h, w, cy, cx):
    """Value noise 0..1 over h x w with cy x cx cells, smooth (bilinear on a smoothstep)."""
    g = rng.random((cy + 2, cx + 2)).astype(np.float32)
    y = np.linspace(0, cy, h, endpoint=False)
    x = np.linspace(0, cx, w, endpoint=False)
    y0, x0 = y.astype(int), x.astype(int)
    fy, fx = y - y0, x - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]
    b = g[y0][:, x0 + 1]
    c = g[y0 + 1][:, x0]
    d = g[y0 + 1][:, x0 + 1]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(rng, h, w, cy, cx, octaves=3):
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for k in range(octaves):
        out += amp * vnoise(rng, h, w, cy * 2 ** k, cx * 2 ** k)
        tot += amp
        amp *= 0.5
    return out / tot


def lin(c):
    c = np.asarray(c, dtype=np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def srgb8(x):
    x = np.clip(x, 0, 1)
    s = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    return np.clip(np.round(s * 255), 0, 255).astype(np.uint8)


def write_png(path, rgb8):
    h, w = rgb8.shape[:2]
    ch = rgb8.shape[2] if rgb8.ndim == 3 else 1
    ctype = {1: 0, 3: 2, 4: 6}[ch]
    raw = b"".join(b"\x00" + rgb8[i].tobytes() for i in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ctype, 0, 0, 0)))
        f.write(chunk(b"sRGB", b"\x00"))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


# --------------------------------------------------------------------------------------------- the looks

LOOKS = {
    # look: its ground
    "gilt": "black",
    "white": "black",
    "cream": "black",
    "plank": "plank",
    "hand": "tar",
    "scraped": "weathered",
}
GOLD = (lin((248, 218, 138)), lin((208, 160, 68)), lin((118, 78, 28)))
INK = {
    "white": lin((236, 232, 220)),
    "cream": lin((232, 212, 160)),
    "plank": lin((232, 230, 218)),
    "scraped": lin((196, 188, 168)),
}
SHADE = {"gilt": lin((52, 30, 16)), "cream": lin((124, 34, 22))}
HAND_PAINTS = [lin((236, 231, 216)), lin((228, 208, 154)), lin((216, 174, 78)), lin((170, 192, 204)),
               lin((200, 74, 52))]
GROUND_SRGB = {"black": (17, 17, 16), "plank": (26, 22, 18), "tar": (34, 27, 21), "weathered": (98, 90, 78)}
STYLE_LOOK = {"gilt_roman": ("roman", "gilt"), "white_roman": ("roman", "white"), "white_slab": ("slab", "white"),
              "cream_shaded": ("slab", "cream"), "block_plank": ("sans", "plank"), "small_hand": ("hand", "hand"),
              "scraped": ("roman", "scraped")}


def ground(kind, rng, h, w):
    base = lin(GROUND_SRGB[kind])
    if kind == "black":
        n = 0.92 + 0.16 * fbm(rng, h, w, 3, 10)
        g = base[None, None, :] * n[..., None]
    elif kind == "plank":
        grain = fbm(rng, h, w, 26, 2, 4)
        n = 0.8 + 0.42 * grain
        y = np.linspace(0, 1, h)[:, None]
        edge = 1.0 - 0.45 * np.clip(1 - y / 0.05, 0, 1) - 0.55 * np.clip(1 - (1 - y) / 0.06, 0, 1)
        edge = edge + 0.35 * np.exp(-((y - 0.075) / 0.018) ** 2)   # the rounded top edge catching the light
        g = base[None, None, :] * (n * edge)[..., None]
    elif kind == "tar":
        n = 0.85 + 0.3 * fbm(rng, h, w, 14, 4)
        g = base[None, None, :] * n[..., None]
    else:  # weathered grey wood: grain and cracks
        grain = fbm(rng, h, w, 36, 3, 4)
        crack = vnoise(rng, h, w, 60, 2)
        n = 0.72 + 0.5 * grain - 0.45 * (np.abs(crack - 0.5) < 0.012)
        g = base[None, None, :] * n[..., None]
    return g.astype(np.float32)


def over(img, mask, colour):
    m = np.clip(mask, 0, 1)[..., None]
    c = colour if np.ndim(colour) == 3 else np.asarray(colour)[None, None, :]
    return img * (1 - m) + c * m


def paint_look(look, L, cap, rng, paint=0):
    """Colour a cell. L: the letter mask (0..1) at the working size; cap: the main line's cap height in px."""
    h, w = L.shape
    img = ground(LOOKS[look], rng, h, w)

    def px(f):
        return max(1, int(round(f * cap)))

    if look == "gilt":
        sh = box_blur(shift(dilate(L, px(0.018)), px(0.05), px(0.065)), px(0.012))
        img = over(img, sh * 0.92, SHADE["gilt"])
        img = over(img, dilate(L, px(0.022)), lin((22, 12, 5)))
        H = box_blur(L, px(0.035))
        gy, gx = np.gradient(H)
        s = np.clip((0.6 * gx + 0.8 * gy) * (cap * 0.09), -1, 1)
        light, mid, dark = GOLD
        tone = 0.5 + 0.5 * fbm(rng, h, w, 6, 30)
        col = mid[None, None, :] * (0.9 + 0.2 * tone[..., None])
        col = np.where(s[..., None] > 0, col + s[..., None] * (light - mid)[None, None, :],
                       col + (-s[..., None]) * (dark - mid)[None, None, :])
        img = over(img, L, col)
    elif look == "white":
        tone = 0.93 + 0.09 * fbm(rng, h, w, 8, 40)
        img = over(img, L, INK["white"][None, None, :] * tone[..., None])
    elif look == "cream":
        d = px(0.1)
        shade = np.zeros_like(L)
        for k in range(1, d + 1):
            np.maximum(shade, shift(L, k, k), out=shade)
        img = over(img, shade, SHADE["cream"])
        img = over(img, dilate(L, px(0.025)), lin((28, 12, 8)))
        tone = 0.94 + 0.08 * fbm(rng, h, w, 8, 40)
        img = over(img, L, INK["cream"][None, None, :] * tone[..., None])
    elif look == "plank":
        tone = 0.9 + 0.12 * fbm(rng, h, w, 10, 50)
        wear = np.clip((fbm(rng, h, w, 18, 60) - 0.72) * 8, 0, 1)
        img = over(img, L * (1 - 0.6 * wear), INK["plank"][None, None, :] * tone[..., None])
    elif look == "hand":
        streak = 0.82 + 0.25 * fbm(rng, h, w, 40, 4)          # brush marks along the stroke rows
        wear = np.clip((fbm(rng, h, w, 14, 50) - 0.68) * 7, 0, 1)
        ink = HAND_PAINTS[paint % len(HAND_PAINTS)]
        img = over(img, L * (1 - 0.8 * wear) * np.clip(streak, 0, 1), ink[None, None, :] * streak[..., None])
    elif look == "scraped":
        ghost = box_blur(L, px(0.02))
        img = img * (1 + 0.18 * ghost[..., None])               # the wood kept lighter under the old paint
        patch = np.clip((fbm(rng, h, w, 4, 14, 4) - 0.47) * 7, 0, 1)    # whole parts of letters gone
        scrape = np.clip((fbm(rng, h, w, 50, 4, 3) - 0.3) * 3, 0, 1)    # scrape marks along the board
        flake = np.clip((fbm(rng, h, w, 20, 70) - 0.62) * 6, 0, 1)
        keep = patch * (0.55 + 0.45 * scrape) * (1 - flake)
        img = over(img, L * keep * 0.8, INK["scraped"][None, None, :])
    return img


# --------------------------------------------------------------------------------------------- a cell

def render_cell(spec, cw, ch):
    """One cell: spec {"lines": [{"runs": [[text, font]], "cap": f}], "look", "aspect", "paint", "seed"}.
    Returns the linear RGB picture (ch, cw, 3)."""
    A = float(spec.get("aspect", 4.0))
    Hv = 2 * ch
    Wv = int(round(Hv * A))
    rng = np.random.default_rng(spec["seed"])
    hand = spec["look"] == "hand"
    margin_x = 0.07 * Hv + 0.025 * Wv
    lines = []
    for ln in spec["lines"]:
        M, wl = set_line([tuple(r) for r in ln["runs"]], ln.get("track", 0.0), rng if hand else None)
        c = ln["cap"] * Hv
        avail = Wv - 2 * margin_x
        sx = 1.0
        if c * wl > avail:
            sx = max(0.84, avail / (c * wl))
            if c * wl * sx > avail:
                c = avail / (wl * sx)
        accent = any(ch_ in "ÄÅËÖÜ" for r in ln["runs"] for ch_ in r[0])
        lines.append((M, wl, c, sx, accent))
    gap = [0.42 * min(lines[k][2], lines[k + 1][2]) for k in range(len(lines) - 1)]
    tops = [0.28 * ln[2] if ln[4] else 0.0 for ln in lines]
    total = sum(ln[2] for ln in lines) + sum(gap) + sum(tops)
    y = (Hv - total) / 2.0 + (0.02 * Hv if len(lines) == 1 else 0.0)
    L = np.zeros((Hv, Wv), np.float32)
    jit = np.random.default_rng(spec["seed"] + 7)
    for k, (M, wl, c, sx, accent) in enumerate(lines):
        y += tops[k]
        base = y + c                                           # the baseline, px from the top
        s = c / MASTER
        x0 = (Wv - wl * c * sx) / 2.0
        if hand:
            x0 += jit.uniform(-0.04, 0.04) * Wv * (1 - wl * c * sx / Wv)
            base += jit.uniform(-0.03, 0.03) * c
        top = base - YT * c
        m = resample(M, 0, s, top, Hv)
        m = resample(m, 1, s * sx, x0, Wv)
        np.maximum(L, m, out=L)
        y = base + (gap[k] if k < len(gap) else 0.0)
    cap = lines[0][2]
    img = paint_look(spec["look"], L, cap, rng, spec.get("paint", 0))
    img = resample(img, 0, ch / Hv, 0, ch)
    img = resample(img, 1, cw / Wv, 0, cw)
    return img


# --------------------------------------------------------------------------------------------- the plan of cells

def number_runs(num):
    """'No 12' as N + raised o + figures, in the condensed sans."""
    return [[num.replace("No", "N" + "o"), "cond"]]


def zone_aspects():
    """name_zones of each kind from boats.glb (node extras), as aspect ratios; {} when none yet."""
    out = {}
    try:
        with open(GLB, "rb") as f:
            data = f.read()
        n = struct.unpack("<I", data[12:16])[0]
        gl = json.loads(data[20:20 + n])
        for node in gl.get("nodes", []):
            z = (node.get("extras") or {}).get("name_zones")
            if z:
                out[node["name"]] = {k: float(v[0]) / float(v[1]) for k, v in z.items() if v[1]}
    except (OSError, ValueError, KeyError, struct.error):
        pass
    return out


def aspect_of(zones, kind, zone):
    z = zones.get(kind) or {}
    if zone == "bow":
        v = z.get("bow_p") or z.get("bow_s")
    elif zone == "box":
        v = z.get("box_p") or z.get("box_s")
    else:
        v = z.get("stern")
    return round(v, 2) if v else 4.0


def crc(s):
    return zlib.crc32(s.encode("utf-8")) & 0x7FFFFFFF


def plan_cells(fleet):
    zones = zone_aspects()
    family = fleet.get("family", {})
    cells, keyed = [], {}
    vessels, names = {}, {}

    def cell(lines, look, aspect, paint=0, style=None):
        key = json.dumps([lines, look, aspect, paint], ensure_ascii=False)
        if key not in keyed:
            keyed[key] = len(cells)
            cells.append({"lines": lines, "look": look, "aspect": aspect, "paint": paint, "seed": crc(key),
                          "style": style, "group": "small" if look in ("hand", "scraped") else "big"})
        return keyed[key]

    def one(v, kind):
        style = v.get("style")
        if not style:
            return None
        font, look = STYLE_LOOK[style]
        name, port, owner, num = v.get("name"), v.get("port"), v.get("owner"), v.get("number")
        kindf = family.get(kind, kind)
        paint = 0
        if look == "hand":
            paint = crc(name) % len(HAND_PAINTS) if name else crc(v.get("id", "")) % 2
        out = {}
        if name:
            runs = [[name, font]]
            if style == "block_plank" and num:
                runs = [[name + "  ", font]] + number_runs(num)
            out["bow"] = cell([{"runs": runs, "cap": 0.56 if look != "hand" else 0.52}], look,
                              aspect_of(zones, kindf, "bow"), paint, style)
        stern_look = "gilt" if (kindf == "steamer" and look == "white") else look
        sub = 0.25
        if owner:
            lines = [{"runs": [[owner, font]], "cap": 0.34}, {"runs": [[port, font]], "cap": sub, "track": 0.08}]
        elif num and name and style != "block_plank":
            lines = [{"runs": [[name, font]], "cap": 0.38}, {"runs": number_runs(num), "cap": 0.3}]
        elif name and port:
            lines = [{"runs": [[name, font]], "cap": 0.38}, {"runs": [[port, font]], "cap": sub, "track": 0.1}]
        elif port:
            lines = [{"runs": [[port, font]], "cap": 0.4, "track": 0.06}]
        else:
            lines = None   # no port (the old boats): the stern carries the bow's cell
        out["stern"] = out["bow"] if lines is None else cell(lines, stern_look, aspect_of(zones, kindf, "stern"), paint, style)
        if kindf in ("paddle_tug", "ferry") and name:
            out["box"] = cell([{"runs": [[name, font]], "cap": 0.56}], look, aspect_of(zones, kindf, "box"), paint,
                              style)
        if name:
            names.setdefault(name, {})[style] = {k: out[k] for k in ("bow", "stern") if k in out}
        return out

    for v in fleet["vessels"]:
        r = one(v, v["kind"])
        if r:
            vessels[v["id"]] = r
    spare = {}
    details = fleet.get("spare_details", {})
    for kind, lst in fleet.get("spare", {}).items():
        for nm in lst:
            d = dict(details.get(nm, {}))
            d["name"] = nm
            r = one(d, "rowboat" if kind == "small" else kind)
            if r:
                spare.setdefault(kind, []).append(dict(name=nm, **r))
    return cells, vessels, spare, names


def build(scale=1.0, out_dir=OUT_DIR):
    with open(FLEET, encoding="utf-8") as f:
        fleet = json.load(f)
    cells, vessels, spare, names = plan_cells(fleet)
    order = {"gilt": 0, "white": 1, "cream": 2, "plank": 3, "hand": 4, "scraped": 5}
    pages = []
    placed = [None] * len(cells)
    per = COLS * ROWS
    for group, cell_px in (("big", (512, 128)), ("small", (256, 64))):
        ids = sorted([i for i, c in enumerate(cells) if c["group"] == group],
                     key=lambda i: (order[cells[i]["look"]], i))
        cw, chh = int(cell_px[0] * scale), int(cell_px[1] * scale)
        for p0 in range(0, len(ids), per):
            pid = len(pages)
            pages.append({"file": "boat_names.png" if pid == 0 else "boat_names_%d.png" % pid,
                          "size": [cw * COLS, chh * ROWS], "cell": [cw, chh], "group": group,
                          "ids": ids[p0:p0 + per]})
            for k, i in enumerate(ids[p0:p0 + per]):
                placed[i] = (pid, k)
    for pg in pages:
        cw, chh = pg["cell"]
        img = np.zeros((chh * ROWS, cw * COLS, 3), np.float32)
        img[:] = lin(GROUND_SRGB["black"])[None, None, :]
        for k, i in enumerate(pg["ids"]):
            r, c = divmod(k, COLS)
            img[r * chh:(r + 1) * chh, c * cw:(c + 1) * cw] = render_cell(cells[i], cw, chh)
        write_png(os.path.join(out_dir, pg["file"]), srgb8(img))
        print("wrote %s (%d cells)" % (pg["file"], len(pg["ids"])))
    index_cells = []
    for i, c in enumerate(cells):
        pid, k = placed[i]
        cw, chh = pages[pid]["cell"]
        W, H = pages[pid]["size"]
        r, col = divmod(k, COLS)
        index_cells.append({
            "id": i, "page": pid, "cell": k, "px": [col * cw, r * chh, cw, chh],
            "rect": [col * cw / W, r * chh / H, cw / W, chh / H],
            "text": ["".join(run[0] for run in ln["runs"]).strip() for ln in c["lines"]],
            "style": c["style"], "look": c["look"], "aspect": c["aspect"]})
    index = {
        "about": ("The names atlas of the boats (tools/blender/boats/lettering.py; docs/boats.md). Each page is "
                  "4 x 16 cells (64), each 4:1; cell k sits at column k % 4 and row k // 4 from the top left. A "
                  "cell is laid out for a board of shape `aspect` (width / height) and squeezed into the 4:1 "
                  "cell, so it reads right on that board. `rect`: x, y, w, h as fractions of the page from its "
                  "top left; `px` the same in pixels. Opaque RGB, sRGB: draw with linear filtering and mipmaps, "
                  "no bump. `vessels`: each fleet.json id to its cells by zone (bow: both bow boards; stern: the "
                  "name and port, or the owner and port; box: the paddle boxes). `spare`: cells for the "
                  "registry's spare names, by kind. `names`: name, then style, then its cells. `ground`: the "
                  "board colour round the letters (sRGB) by look, to paint the hull round a zone."),
        "pages": [{k: pg[k] for k in ("file", "size", "cell", "group")} for pg in pages],
        "grid": [COLS, ROWS],
        "ground": {look: list(GROUND_SRGB[g]) for look, g in LOOKS.items()},
        "cells": index_cells,
        "vessels": vessels,
        "spare": spare,
        "names": names,
    }
    with open(os.path.join(out_dir, "boat_names.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("%d cells on %d pages" % (len(cells), len(pages)))
    return index, pages


# --------------------------------------------------------------------------------------------- the preview sheet

def label(img8, x, y, text, cap=14):
    """A small white label on a darkened patch of an 8-bit picture (the preview sheets)."""
    M, wl = set_line([(text, "sans")])
    s = cap / MASTER
    hh = int((YT - YB) * cap)
    m = resample(resample(M, 0, s, 0, hh), 1, s, 0, int(wl * cap) + 4)
    h = min(m.shape[0], img8.shape[0] - y)
    w = min(m.shape[1], img8.shape[1] - x)
    box = img8[y:y + h, x:x + w].astype(np.float32) * 0.35
    box = box * (1 - m[:h, :w, None]) + 255 * m[:h, :w, None]
    img8[y:y + h, x:x + w] = box.astype(np.uint8)


def read_png(path):
    """Read back one of our own PNGs (8-bit RGB, filter 0 on every row)."""
    with open(path, "rb") as f:
        data = f.read()
    pos, idat, w, h = 8, b"", 0, 0
    while pos < len(data):
        n = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + n]
        if tag == b"IHDR":
            w, h = struct.unpack(">II", body[:8])
        elif tag == b"IDAT":
            idat += body
        pos += 12 + n
    raw = np.frombuffer(zlib.decompress(idat), np.uint8).reshape(h, 1 + w * 3)
    return raw[:, 1:].reshape(h, w, 3).copy()


def preview(index, pages, out_dir):
    """Every page with its cell numbers and grid, and one sheet of all pages (big pages at half size)."""
    os.makedirs(out_dir, exist_ok=True)
    tiles = []
    for pid, pg in enumerate(pages):
        img = read_png(os.path.join(OUT_DIR, pg["file"]))
        cw, chh = pg["cell"]
        for r in range(1, ROWS):
            img[r * chh, :, :] = (img[r * chh, :, :] * 0.5 + 60).astype(np.uint8)
        for c in range(1, COLS):
            img[:, c * cw, :] = (img[:, c * cw, :] * 0.5 + 60).astype(np.uint8)
        page_ids = [c["id"] for c in index["cells"] if c["page"] == pid]
        for cid in page_ids:
            k = index["cells"][cid]["cell"]
            r, c = divmod(k, COLS)
            label(img, c * cw + 2, r * chh + 1, "%d" % cid, cap=max(8, chh // 10))
        write_png(os.path.join(out_dir, "preview_page%d.png" % pid), img)
        if pg["group"] == "big":
            f = img.astype(np.float32)
            f = resample(resample(f, 0, 0.5, 0, f.shape[0] // 2), 1, 0.5, 0, f.shape[1] // 2)
            img = np.clip(f, 0, 255).astype(np.uint8)
        tiles.append(img)
    H = max(t.shape[0] for t in tiles)
    sheet = np.concatenate([np.pad(t, ((0, H - t.shape[0]), (0, 8), (0, 0))) for t in tiles], 1)
    write_png(os.path.join(out_dir, "preview_sheet.png"), sheet)
    print("preview in", out_dir)


# --------------------------------------------------------------------------------------------- the run

def main(argv):
    scale = float(argv[argv.index("--scale") + 1]) if "--scale" in argv else 1.0
    if "--no-build" in argv:
        with open(os.path.join(OUT_DIR, "boat_names.json"), encoding="utf-8") as f:
            index = json.load(f)
        pages = index["pages"]
    else:
        index, pages = build(scale)
    if "--preview" in argv:
        preview(index, pages, os.path.abspath(argv[argv.index("--preview") + 1]))
    if "--closeups" in argv:
        closeups(index, os.path.abspath(argv[argv.index("--closeups") + 1]))


# --------------------------------------------------------------------------------------------- Blender close-ups

# boards to look at: the cell's lines ("|" between), its look, the board's width and height in metres
CLOSEUPS = [
    ("KEMPENLAND|ANTWERPEN", "gilt", 6.0, 1.5, "liner stern"),
    ("STAD ANTWERPEN", "white", 5.2, 1.3, "steamer bow"),
    ("HERCULES", "white", 3.2, 0.8, "tug bow"),
    ("SCHELDE", "gilt", 2.6, 0.65, "paddle box"),
    ("FORTUNA", "cream", 4.4, 1.1, "Rhine barge bow"),
    ("J. W. HAAS|RUHRORT", "cream", 3.2, 0.8, "Rhine barge stern"),
    ("DE TOEKOMST No 3", "plank", 3.2, 0.8, "lighter plank"),
    ("ROSALIE|ANTWERPEN", "hand", 1.1, 0.275, "rowboat transom"),
    ("KLEIN JAN", "hand", 1.0, 0.25, "dinghy bow"),
    ("ELISA", "scraped", 1.0, 0.25, "old boat"),
]


def closeups(index, out_dir):
    """Each board of CLOSEUPS on a black hull side, seen from 10 m and 25 m at the game's 75 degree field of
    view, 1920 x 1080, one sample a pixel; and a shimmer test: three frames a third of a pixel apart at 25 m,
    with mipmaps (linear) and without (closest), the mean change per pixel over the board."""
    import bpy
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector

    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    sc.eevee.taa_render_samples = 1
    sc.render.filter_size = 0.0
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.view_settings.view_transform = "Standard"
    sc.render.image_settings.file_format = "PNG"
    sysp = bpy.context.preferences.system
    if hasattr(sysp, "anisotropic_filter"):
        sysp.anisotropic_filter = "FILTER_16"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.6, 0.66, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(75)
    sc.collection.objects.link(cam)
    sc.camera = cam
    pages = {}

    def page_image(pid):
        if pid not in pages:
            img = bpy.data.images.load(os.path.join(OUT_DIR, index["pages"][pid]["file"]))
            img.colorspace_settings.name = "sRGB"
            pages[pid] = img
        return pages[pid]

    hull_mat = bpy.data.materials.new("hull")
    hull_mat.use_nodes = True
    hull_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.006, 0.006, 0.006, 1)
    hull_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    hull = bpy.data.objects.new("hull", bpy.data.meshes.new("hull"))
    hull.data.from_pydata([(-12, 0.02, -3), (12, 0.02, -3), (12, 0.02, 3), (-12, 0.02, 3)], [], [(0, 1, 2, 3)])
    hull.data.materials.append(hull_mat)
    sc.collection.objects.link(hull)

    def board(cell, w, h, interp):
        x, y, cw, chh = cell["rect"]
        mat = bpy.data.materials.new("board")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        bsdf.inputs["Roughness"].default_value = 0.55
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = page_image(cell["page"])
        tex.interpolation = interp
        tex.extension = "EXTEND"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        me = bpy.data.meshes.new("board")
        me.from_pydata([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)], [],
                       [(0, 1, 2, 3)])
        uv = me.uv_layers.new()
        u0, u1 = x, x + cw
        v0, v1 = 1 - (y + chh), 1 - y          # Blender's image v runs up from the bottom
        for li, (u, v) in enumerate([(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
            uv.data[li].uv = (u, v)
        me.materials.append(mat)
        ob = bpy.data.objects.new("board", me)
        sc.collection.objects.link(ob)
        return ob

    def find(text, look):
        want = [t.replace(" ", "") for t in text.split("|")]
        for c in index["cells"]:
            if c["look"] == look and [t.replace(" ", "") for t in c["text"]] == want:
                return c
        raise KeyError(text)

    def shoot(path, dist, w, h, yaw=18.0, nudge=0.0):
        yaw_r = math.radians(yaw)
        cam.location = Vector((math.sin(yaw_r) * dist + nudge, -math.cos(yaw_r) * dist, 0.6))
        d = Vector((nudge, 0, 0)) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        pts = [world_to_camera_view(sc, cam, Vector(p)) for p in
               ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
        xs, ys = [p.x for p in pts], [p.y for p in pts]
        m = 0.012
        sc.render.use_border = True
        sc.render.use_crop_to_border = True
        sc.render.border_min_x, sc.render.border_max_x = max(0, min(xs) - m), min(1, max(xs) + m)
        sc.render.border_min_y, sc.render.border_max_y = max(0, min(ys) - m * 1.7), min(1, max(ys) + m * 1.7)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[::-1, :, :3]
        bpy.data.images.remove(img)
        return a

    report = []
    sheet_rows = []
    for text, look, w, h, what in CLOSEUPS:
        cell = find(text, look)
        row = []
        for interp in ("Linear", "Closest"):
            ob = board(cell, w, h, interp)
            for dist in (10, 25):
                if interp == "Closest" and dist == 10:
                    continue
                tag = "%s_%dm%s" % (what.replace(" ", "_"), dist, "" if interp == "Linear" else "_nomip")
                a = shoot(os.path.join(out_dir, tag + ".png"), dist, w, h)
                if interp == "Linear":
                    row.append(a)
                if dist == 25:
                    # a third of a pixel sideways each frame (75 degrees over 1080 rows at 25 m)
                    step = 2 * dist * math.tan(math.radians(37.5)) / 1080 / 3
                    frames = [a] + [shoot(os.path.join(out_dir, "_n.png"), dist, w, h, nudge=k * step)
                                    for k in (1, 2)]
                    hh = min(f.shape[0] for f in frames)
                    ww = min(f.shape[1] for f in frames)
                    fr = np.stack([f[:hh, :ww] for f in frames])
                    change = float(np.abs(np.diff(fr, axis=0)).mean())
                    report.append([what, interp, round(change, 4)])
            bpy.data.objects.remove(ob)
        sheet_rows.append(row)
        print("closeup", what, "cell", cell["id"], "board px at 10 m:", row[0].shape[1], "x", row[0].shape[0],
              "at 25 m:", row[1].shape[1], "x", row[1].shape[0])
    try:
        os.remove(os.path.join(out_dir, "_n.png"))
    except OSError:
        pass
    with open(os.path.join(out_dir, "shimmer.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    for r in report:
        print("shimmer", r)
    # one sheet: each board at 10 m, then at 25 m shown twice as large with its pixels kept
    tiles = []
    for near, far in sheet_rows:
        far2 = far.repeat(2, 0).repeat(2, 1)
        hh = max(near.shape[0], far2.shape[0])
        tiles.append(np.concatenate([np.pad(t, ((0, hh - t.shape[0]), (0, 12), (0, 0)), constant_values=0.2)
                                     for t in (near, far2)], 1))
    W = max(t.shape[1] for t in tiles)
    sheet = np.concatenate([np.pad(t, ((0, 10), (0, W - t.shape[1]), (0, 0)), constant_values=0.2)
                            for t in tiles], 0)
    write_png(os.path.join(out_dir, "closeups_sheet.png"), np.round(np.clip(sheet, 0, 1) * 255).astype(np.uint8))
    print("close-ups in", out_dir)


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
