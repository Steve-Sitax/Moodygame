"""The fish market's big fish (#180): a cod and a plaice, at the herring's detail (small.py held_fish).

cod:    a cod of 52 cm with its tail, its middle at the origin, head toward +X, back (the three dorsal fins) up
        (game +Y = Blender +Z), flanks toward game +-Z (Blender -+Y). Heavy head, chin barbel, two anal fins, a
        square tail; olive back mottled brown, the pale lateral line arching over the pectoral fin, a white belly.
plaice: a plaice of 31 cm lying eyed side up as it lies on a slab: its middle at the origin, head toward +X, the
        eyed (brown, orange-spotted) side up, the blind (white) side down; the fringe of the dorsal and anal fins
        round its edge, a short tail at -X, both eyes on the upper side.

Like the herring, their middle is at the origin; the market lays them on the ice by their own half-depth.
"""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param

# ------------------------------------------------------------------ the cod

C_PPM = 1000
C_X0 = -0.215  # the body texture's s = 0 (just behind the root of the tail)
C_CIRC = 0.262  # the body's texture round (back, both flanks, belly)


def _cod_stations():
    # x, depth, width, centre z (the belly a little lower than the back is high near the head)
    return [(0.252, 0.0, 0.0, -0.004), (0.249, 0.014, 0.012, -0.004), (0.240, 0.032, 0.026, -0.004),
            (0.224, 0.052, 0.040, -0.003), (0.202, 0.071, 0.052, -0.002), (0.176, 0.086, 0.060, -0.002),
            (0.148, 0.097, 0.064, -0.002), (0.112, 0.104, 0.066, -0.002), (0.070, 0.106, 0.065, -0.002),
            (0.026, 0.102, 0.061, -0.001), (-0.020, 0.092, 0.055, 0.0), (-0.064, 0.077, 0.046, 0.0),
            (-0.104, 0.060, 0.036, 0.0), (-0.140, 0.044, 0.026, 0.0), (-0.168, 0.033, 0.018, 0.0),
            (-0.188, 0.028, 0.014, 0.0), (-0.200, 0.027, 0.012, 0.0), (-0.206, 0.0, 0.0, 0.0)]


def _ring(depth, width, cz, n, top_k=0.48, bottom_k=0.52):
    """A cod's section: a full oval, the back a little narrower than the belly. Columns start at the back (+z) and go
    round +y."""
    out = []
    for j in range(n):
        a = 2 * math.pi * j / n
        s, c = math.sin(a), math.cos(a)
        top = c > 0
        rz = depth * (top_k if top else bottom_k)
        pw = 2.2 if top else 2.0
        y = width / 2 * math.copysign(abs(s) ** (2 / 2.3), s)
        z = cz + rz * math.copysign(abs(c) ** (2 / pw), c)
        out.append((y, z))
    return out


def cod_cells(A):
    def body_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        f = Y / C_CIRC  # 0 the back, 0.25 the +y flank, 0.5 the belly, 0.75 the -y flank
        d = np.minimum(f, 1 - f)  # 0 back .. 0.5 belly
        xh = X + C_X0  # the fish's own x
        back = np.array((0.30, 0.28, 0.17))
        flank = np.array((0.52, 0.49, 0.36))
        belly = np.array((0.86, 0.84, 0.78))
        k1 = pt.sm(0.10, 0.30, d)[..., None]
        k2 = pt.sm(0.30, 0.42, d)[..., None]
        img = back * (1 - k1) + flank * k1
        img = img * (1 - k2) + belly * k2
        # the cod's mottle: brown and olive blots over the back and flanks, fading on the belly
        blot = pt.fbm(h, w, 0.016 * ppm, 0.012 * ppm, 71, 3)
        spots = pt.sm(0.56, 0.68, blot) * (1 - pt.sm(0.30, 0.40, d))
        img = img * (1 - 0.45 * spots[..., None]) + np.array((0.24, 0.17, 0.08)) * 0.45 * spots[..., None]
        small = pt.fbm(h, w, 0.004 * ppm, 0.004 * ppm, 72, 2)
        img *= (0.92 + 0.12 * small * (1 - pt.sm(0.3, 0.45, d)))[..., None]
        # scales, very small on a cod: a fine regular grain
        u = X / 0.0022
        v = Y / 0.0019
        row = np.floor(v)
        uu = (u + 0.5 * (row % 2)) % 1.0
        vv = v % 1.0
        r = np.hypot(uu - 0.2, (vv - 0.5) * 1.1)
        img *= (0.96 + 0.05 * pt.sm(0.62, 0.4, r))[..., None]
        # the lateral line: pale, arching up over the pectoral fin, then straight back along the flank
        for side in (0.25, 0.75):
            arch = 0.07 + 0.03 * pt.sm(-0.10, 0.12, xh) * pt.sm(0.21, 0.12, xh)
            centre = side - arch if side < 0.5 else side + arch
            line = pt.sm(0.0020, 0.0007, np.abs(f - centre) * C_CIRC) * pt.sm(-0.205, -0.17, xh) * pt.sm(0.17, 0.14, xh)
            img = img * (1 - 0.38 * line[..., None]) + np.array((0.78, 0.75, 0.60)) * 0.38 * line[..., None]
        # the gill cover: its curved back edge from the back of the head down toward the throat, darker
        gx = 0.168 - 0.016 * (pt.sm(0.10, 0.45, d) - 0.5) ** 2 * 4
        on = pt.sm(0.08, 0.13, d)
        e = xh - gx
        img *= (1 - 0.42 * on * pt.sm(0.0016, 0.0, np.abs(e)))[..., None]
        head = pt.sm(0.0, 0.004, e)  # the head ahead of the gill edge: a little smoother and lighter
        img = img * (1 - 0.08 * head[..., None]) + np.array((0.58, 0.54, 0.40)) * 0.08 * head[..., None]
        # the eyes, high on the head
        for fc in (0.155, 1 - 0.155):
            ex, ey = 0.214, fc * C_CIRC
            r = np.hypot(xh - ex, Y - ey)
            iris = pt.sm(0.0105, 0.0095, r)
            img = img * (1 - iris[..., None]) + np.array((0.55, 0.47, 0.25)) * iris[..., None]
            pupil = pt.sm(0.0058, 0.0050, r)
            img = img * (1 - pupil[..., None]) + np.array((0.02, 0.02, 0.025)) * pupil[..., None]
            img *= (1 - 0.35 * pt.sm(0.0102, 0.011, r) * pt.sm(0.0125, 0.0113, r))[..., None]
            hl = pt.sm(0.0018, 0.0008, np.hypot(xh - ex - 0.0022, Y - ey + 0.002 * (1 if fc < 0.5 else -1)))
            img = img * (1 - 0.7 * hl[..., None]) + 0.9 * 0.7 * hl[..., None]
        # the mouth: the line of the upper jaw back under the eye
        mouth = pt.sm(0.200, 0.214, xh) * pt.sm(0.010, 0.0, np.abs(d - 0.33) - 0.003)
        img *= (1 - 0.5 * mouth)[..., None]
        # wet: a few darker streaks where the ice water runs off
        wet = pt.fbm(h, w, 0.03 * ppm, 0.005 * ppm, 73, 2)
        img *= (0.94 + 0.08 * wet)[..., None]
        return img

    def fin_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.40, 0.38, 0.27))
        rays = 0.5 + 0.5 * np.cos(X / 0.0030 * 2 * math.pi)
        img *= (0.84 + 0.16 * rays)[..., None]
        blot = pt.fbm(h, w, 0.01 * ppm, 0.01 * ppm, 74, 3)
        img = img * (1 - 0.3 * pt.sm(0.55, 0.7, blot)[..., None]) + np.array((0.22, 0.17, 0.09)) * 0.3 * pt.sm(0.55, 0.7, blot)[..., None]
        # a pale margin along one edge (v = 1) of the cell: the fins' edges are drawn there
        img = img * (1 - 0.35 * pt.sm(0.8, 1.0, Y / Y.max())[..., None]) + np.array((0.70, 0.68, 0.56)) * 0.35 * pt.sm(0.8, 1.0, Y / Y.max())[..., None]
        return img

    def barbel_tex(w, h, ppm):
        return pt.solid(w, h, (0.62, 0.58, 0.44)) * (0.9 + 0.1 * pt.fbm(h, w, 2, 2, 75, 2))[..., None]

    return {"body": A.cell("catch", 0.48, C_CIRC, C_PPM, body_tex, "cod body"),
            "fin": A.cell("catch", 0.16, 0.10, 1000, fin_tex, "cod fins"),
            "barbel": A.cell("catch", 0.03, 0.01, 800, barbel_tex, "cod barbel")}


def cod(A):
    C = cod_cells(A)
    m = kit.Mesh("cod")
    n = 22
    st = _cod_stations()
    rows = []
    for x, dpt, wid, cz in st:
        if dpt <= 0:
            rows.append([(x, 0.0, cz)] * n)
        else:
            rows.append([(x, y, z) for y, z in _ring(dpt, wid, cz, n)])
    P = np.array(rows)
    ST = np.zeros((len(rows), n + 1, 2))
    for i in range(len(rows)):
        for j in range(n + 1):
            ST[i, j] = (P[i, 0, 0] - C_X0, C_CIRC * j / n)
    xs = np.array([s[0] for s in st])
    czs = np.array([s[3] for s in st])
    kit.grid(m, P, ST, Param(C["body"]), closed=True,
             outfn=lambda i, j, c: np.array((0.0, c[1], c[2] - np.interp(c[0], xs, czs))), thr=55.0)
    fin = Box(C["fin"])
    XZ = Matrix.Rotation(math.radians(90), 4, "X")  # local y -> z: fins drawn in the fish's x-z plane

    def fin_plate(poly, th, M=Matrix.Identity(4)):
        with m.at(M @ XZ):
            kit.prism(m, poly, -th / 2, th / 2, fin, c=0.0, thr=30.0)

    def top(x):  # the back's height at x
        return float(np.interp(-x, -xs, [s[1] * 0.48 + s[3] for s in st]))

    def bottom(x):
        return float(np.interp(-x, -xs, [-s[1] * 0.52 + s[3] for s in st]))

    def rounded(x0, x1, base, hgt, sign):
        """A soft-rayed fin's outline over a root from x0 (front) to x1: its front ray the longest, the edge rounding
        back down to the rear root; sign +1 above the back, -1 under the belly (written ccw in x, z)."""
        pts = []
        for k in range(9):
            t = k / 8
            x = x0 + (x1 - x0) * t
            hk = hgt * (math.sin(math.pi * min(1.0, 0.18 + 0.9 * t)) ** 0.7) * (1.0 - 0.35 * t)
            pts.append((x, base(x) + sign * hk))
        # the root (sunk into the body) from rear to front, then the edge back over from front to rear
        return [(x1, base(x1) - sign * 0.004), (x0, base(x0) - sign * 0.004)] + pts

    # three dorsal fins, rounded, the first the tallest; their roots sunk a few millimetres into the back
    for x0, x1, hgt in ((0.108, 0.046, 0.044), (0.030, -0.048, 0.036), (-0.064, -0.130, 0.030)):
        fin_plate(rounded(x0, x1, top, hgt, 1), 0.0014)
    # two anal fins under the tail half
    for x0, x1, hgt in ((0.004, -0.060, 0.032), (-0.074, -0.132, 0.027)):
        fin_plate(rounded(x0, x1, bottom, hgt, -1), 0.0014)
    # the tail: broad, its trailing edge nearly square (a little concave), in two convex halves
    fin_plate([(-0.192, 0.0), (-0.192, 0.012), (-0.214, 0.034), (-0.262, 0.056), (-0.270, 0.050), (-0.268, 0.0)][::-1], 0.0016)
    fin_plate([(-0.192, -0.012), (-0.192, 0.0), (-0.268, 0.0), (-0.270, -0.050), (-0.262, -0.056), (-0.214, -0.034)], 0.0016)
    for sy in (-1, 1):
        # the pelvic fins under the throat, ahead of the pectorals
        M = kit.T(0.0, sy * 0.010, 0.0) @ Matrix.Rotation(math.radians(sy * 18), 4, "X")
        fin_plate([(0.176, bottom(0.176) + 0.006), (0.150, bottom(0.150) + 0.004), (0.142, bottom(0.150) - 0.022),
                   (0.160, bottom(0.165) - 0.018)], 0.0012, M)
        # the pectoral fins behind the gill covers, lying back along the flanks
        root = (0.152, sy * 0.030, -0.012)
        M = (kit.T(*root) @ Matrix.Rotation(math.radians(sy * 22), 4, "X") @ Matrix.Rotation(math.radians(-10), 4, "Y") @
             kit.T(-root[0], 0.0, -root[2]))
        fin_plate([(0.156, -0.006), (0.156, -0.020), (0.106, -0.030), (0.098, -0.016), (0.112, -0.004)], 0.0012, M)
    # the chin barbel: a short tapering thread under the lower jaw
    path = [(0.236, 0.0, bottom(0.236) + 0.002), (0.233, 0.0, bottom(0.236) - 0.008), (0.225, 0.0, bottom(0.236) - 0.020)]
    kit.sweep(m, path, [0.0016, 0.0013, 0.0004], 5, Param(C["barbel"]), up=(0, 1, 0), caps=(False, True), thr=60.0)
    return m


# ------------------------------------------------------------------ the plaice

P_PPM = 1400
P_HALF = (0.142, 0.088)  # the body's half length and half breadth (fringe and tail outside it)
P_THICK = 0.0115  # the body's half thickness in the middle (eyed side); the blind side a little flatter
P_PLAN = (-0.215, -0.115)  # the planar texture's origin (x, y) in metres: the tail tip, the fringe's edge


def _fringe(a):
    """How far the fin fringe stands out at angle a round the outline (0 = head, pi = tail): none round the head, its
    widest along the flanks, none at the tail's root."""
    head = pt.sm(0.55, 1.05, abs(math.atan2(math.sin(a), math.cos(a))))
    tail = pt.sm(0.30, 0.55, abs(math.atan2(math.sin(a - math.pi), math.cos(a - math.pi))))
    return float(head * tail)


def _outline(a, r=1.0):
    """The body's outline point at angle a, scaled by r: an oval a little narrower toward the head."""
    ca, sa = math.cos(a), math.sin(a)
    b = P_HALF[1] * (1 - 0.13 * max(0.0, ca) ** 2) * (1 - 0.18 * max(0.0, -ca) ** 3)
    return (P_HALF[0] * ca * r, b * sa * r)


def plaice_cells(A):
    W, H = 0.43, 0.23

    def top_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        x = X + P_PLAN[0]
        y = Y + P_PLAN[1]
        img = np.ones((h, w, 3), np.float32) * np.array((0.36, 0.29, 0.18))
        sand = pt.fbm(h, w, 0.012 * ppm, 0.012 * ppm, 81, 4)
        img *= (0.84 + 0.25 * sand)[..., None]
        # the plaice's orange-red spots, each ringed paler, scattered over the body (not the fringe)
        rng = np.random.default_rng(82)
        spots = np.zeros((h, w), np.float32)
        ring = np.zeros((h, w), np.float32)
        for _ in range(26):
            a = rng.uniform(0, 2 * math.pi)
            rr = math.sqrt(rng.uniform(0.02, 0.8))
            cx, cy = _outline(a, rr)
            rad = rng.uniform(0.0055, 0.0085)
            d = np.hypot(x - cx, y - cy)
            spots = np.maximum(spots, pt.sm(rad, rad * 0.75, d))
            ring = np.maximum(ring, pt.sm(rad * 1.45, rad * 1.15, d) * (1 - pt.sm(rad, rad * 0.85, d)))
        img = img * (1 - 0.25 * ring[..., None]) + np.array((0.62, 0.52, 0.36)) * 0.25 * ring[..., None]
        img = img * (1 - 0.85 * spots[..., None]) + np.array((0.78, 0.33, 0.10)) * 0.85 * spots[..., None]
        # the lateral line, straight along the middle with a gentle arch over the gill
        arch = 0.010 * pt.sm(0.03, 0.09, x) * pt.sm(0.13, 0.09, x)
        line = pt.sm(0.0016, 0.0005, np.abs(y - arch)) * pt.sm(-0.13, -0.10, x) * pt.sm(0.12, 0.10, x)
        img *= (1 - 0.30 * line)[..., None]
        # the gill cover's curved edge and the bony ridge between the eyes
        gill = pt.sm(0.0018, 0.0, np.abs(np.hypot((x - 0.150) * 1.0, y * 1.1) - 0.046)) * pt.sm(0.10, 0.11, x)
        img *= (1 - 0.35 * gill)[..., None]
        # the fin fringe beyond the body: finer, rayed, with a dark spotted margin
        a = np.arctan2(y / P_HALF[1], x / P_HALF[0])
        body_r = np.hypot(x / P_HALF[0], y / P_HALF[1])
        on_fin = pt.sm(0.97, 1.02, body_r)
        rays = 0.5 + 0.5 * np.cos(a * 160)
        fin = np.array((0.30, 0.24, 0.15)) * (0.80 + 0.25 * rays[..., None])
        img = img * (1 - on_fin[..., None]) + fin * on_fin[..., None]
        # the tail (x below -0.15)
        tail = pt.sm(-0.150, -0.158, x)
        trays = 0.5 + 0.5 * np.cos(y / 0.0035 * 2 * math.pi)
        img = img * (1 - tail[..., None]) + (np.array((0.31, 0.25, 0.15)) * (0.82 + 0.22 * trays[..., None])) * tail[..., None]
        # the eyes: raised, side by side near the head, the right one a little ahead
        for ex, ey in ((0.112, 0.019), (0.100, -0.003)):
            r = np.hypot(x - ex, y - ey)
            img = img * (1 - pt.sm(0.0062, 0.0052, r)[..., None]) + np.array((0.30, 0.24, 0.14)) * pt.sm(0.0062, 0.0052, r)[..., None]
            img = img * (1 - pt.sm(0.0046, 0.0040, r)[..., None]) + np.array((0.46, 0.36, 0.17)) * pt.sm(0.0046, 0.0040, r)[..., None]
            img = img * (1 - pt.sm(0.0026, 0.0021, r)[..., None]) + np.array((0.02, 0.02, 0.02)) * pt.sm(0.0026, 0.0021, r)[..., None]
            hl = pt.sm(0.0009, 0.0004, np.hypot(x - ex - 0.0010, y - ey - 0.0010))
            img = img * (1 - 0.5 * hl[..., None]) + 0.85 * 0.5 * hl[..., None]
        # the mouth: small, twisted down toward the blind side at the snout
        mouth = pt.sm(0.0020, 0.0006, np.abs(np.hypot(x - 0.128, y + 0.020) - 0.012)) * pt.sm(0.130, 0.136, x)
        img *= (1 - 0.45 * mouth)[..., None]
        return img

    def blind_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        x = X + P_PLAN[0]
        y = Y + P_PLAN[1]
        img = np.ones((h, w, 3), np.float32) * np.array((0.90, 0.89, 0.85))
        img *= (0.93 + 0.08 * pt.fbm(h, w, 0.02 * ppm, 0.02 * ppm, 83, 3))[..., None]
        # pearly and a little blue toward the edges, the fringe greyer with rays
        body_r = np.hypot(x / P_HALF[0], y / P_HALF[1])
        img = img * (1 - 0.12 * pt.sm(0.6, 1.0, body_r)[..., None]) + np.array((0.70, 0.74, 0.78)) * 0.12 * pt.sm(0.6, 1.0, body_r)[..., None]
        a = np.arctan2(y / P_HALF[1], x / P_HALF[0])
        on_fin = pt.sm(0.97, 1.02, body_r)
        fin = np.array((0.74, 0.72, 0.66)) * (0.86 + 0.14 * (0.5 + 0.5 * np.cos(a * 160)))[..., None]
        img = img * (1 - on_fin[..., None]) + fin * on_fin[..., None]
        tail = pt.sm(-0.150, -0.158, x)
        img = img * (1 - 0.6 * tail[..., None]) + np.array((0.66, 0.64, 0.58)) * 0.6 * tail[..., None]
        return img

    return {"top": A.cell("catch", W, H, P_PPM, top_tex, "plaice eyed side"),
            "blind": A.cell("catch", W, H, 700, blind_tex, "plaice blind side")}


def plaice(A):
    C = plaice_cells(A)
    m = kit.Mesh("plaice")
    n = 40  # columns round the outline
    # the profile from the eyed side's middle out over the edge and back under the blind side: (radius, height)
    # in outline units and metres; past r = 1 the fringe (scaled by _fringe at each angle)
    T = P_THICK
    prof = [(0.0, T), (0.22, 0.985 * T), (0.42, 0.93 * T), (0.60, 0.82 * T), (0.75, 0.64 * T), (0.86, 0.44 * T),
            (0.94, 0.24 * T), (0.985, 0.10 * T), (1.0, 0.035 * T), (1.0, -0.035 * T), (0.985, -0.08 * T),
            (0.94, -0.20 * T), (0.86, -0.36 * T), (0.75, -0.52 * T), (0.60, -0.66 * T), (0.42, -0.75 * T),
            (0.22, -0.79 * T), (0.0, -0.80 * T)]
    fringe_rows = [(1.08, 0.0018), (1.16, 0.0010), (1.18, 0.0004), (1.18, -0.0004), (1.16, -0.0010), (1.08, -0.0018)]
    full = prof[:9] + fringe_rows + prof[9:]
    rows = []
    for r, z in full:
        row = []
        for j in range(n):
            a = 2 * math.pi * j / n
            if r > 1.0:
                rr = 1.0 + (r - 1.0) * _fringe(a) / 0.18 * 0.18
                # the fringe stands out 0.18 of the body's radius where it is widest; its thickness tapers with it
                zz = z * max(0.25, _fringe(a))
            else:
                rr, zz = r, z
            x, y = _outline(a, rr)
            # eyed side up: a slight lift of the head end, as the fish lies
            row.append((x, y, zz + 0.0015 * max(0.0, x / P_HALF[0])))
        rows.append(row)
    P = np.array(rows)
    ST = np.zeros((len(rows), n + 1, 2))
    for i in range(len(rows)):
        for j in range(n + 1):
            x, y, _ = P[i, j % n]
            ST[i, j] = (x - P_PLAN[0], y - P_PLAN[1])
    split = len(prof[:9]) + len(fringe_rows) // 2
    top, blind = Param(C["top"]), Param(C["blind"])

    def skin(i, j):
        return top if i < split else blind

    def outfn(i, j, c):
        # (the profile runs from the eyed side's middle over the edge to the blind side's: its left normal points out)
        p0, p1 = P[i, j], P[i + 1, j]
        rad = np.array((c[0], c[1], 0.0))
        rad = rad / (np.linalg.norm(rad) or 1.0)
        dr = float(np.hypot(p1[0], p1[1]) - np.hypot(p0[0], p0[1]))
        dz = float(p1[2] - p0[2])
        return -dz * rad + np.array((0.0, 0.0, dr))

    kit.grid(m, P, ST, skin, closed=True, outfn=outfn, thr=45.0)
    # the tail: a short broad fan at -X, its root inside the body's end
    poly = [(-0.128, -0.012), (-0.150, -0.030), (-0.198, -0.050), (-0.212, -0.044), (-0.208, 0.0), (-0.212, 0.044),
            (-0.198, 0.050), (-0.150, 0.030), (-0.128, 0.012)]
    kit.prism(m, poly[::-1], -0.0012, 0.0012, PlanSkin(C["top"]), c=0.0, thr=30.0)
    # the eyes stand up out of the eyed side: two low domes
    for ex, ey in ((0.112, 0.019), (0.100, -0.003)):
        with m.at(kit.T(ex, ey, P_THICK * 0.80)):
            kit.lathe(m, [(0.0060, 0.0), (0.0055, 0.0016), (0.0036, 0.0030), (0.0, 0.0035)], 10, PlanSkin(C["top"], ex, ey), thr=60.0)
    return m


class PlanSkin:
    """A skin from the plaice's plan coordinates (x, y), shifted by a part's own place, into its cell."""

    def __init__(self, cell, ox=0.0, oy=0.0):
        self.cell, self.ox, self.oy = cell, ox, oy

    def uv(self, pts, st, n):
        return [self.cell.px(p[0] + self.ox - P_PLAN[0], p[1] + self.oy - P_PLAN[1]) for p in pts]


