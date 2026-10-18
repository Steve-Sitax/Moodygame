"""The held things: a fishwife's gutting knife and a herring.

held_knife: game frame of people2's held things: the grip (the middle of the handle) at the origin, the handle along
+Y with the blade beyond it, the edge toward -Z. In Blender (Z up, game -Z = Blender +Y): the handle runs along +Z
and the edge points along +Y.

held_fish: the middle of the fish at the origin, head toward +X, back (dorsal fin) up (game +Y = Blender +Z),
flanks toward game +-Z (Blender -+Y).
"""

import math

import numpy as np
from mathutils import Matrix

from . import kit
from . import paint as pt
from .kit import Box, Flat, Param

# ------------------------------------------------------------------ the knife

K_PPM = 1000
HANDLE_Z = (-0.052, 0.040)
FERRULE_Z = (0.040, 0.052)
BLADE_Z = (0.050, 0.162)
RIVETS_Z = (-0.033, -0.006, 0.022)


def _blade_shape(t):
    """Edge and spine (Blender y) and thickness at a fraction t of the blade's length."""
    ye = 0.0118 - 0.0178 * t ** 2.3  # the edge curving up into the point
    ys = -0.0085 + 0.0026 * t ** 2.0  # the spine dropping a little to the point
    ts = 0.0024 * (1 - 0.6 * t)
    return ye, ys, ts


def knife_cells(A):
    def blade_tex(w, h, ppm):
        img = np.ascontiguousarray(pt.steel(h, w, ppm, 11).transpose(1, 0, 2))
        X, Y = pt.coords(w, h, ppm)
        S = X / X.max()
        # the honed edge: bright, fine scratches across it (columns 0..1 and 6..7 of 7 are the edge bevels)
        hone = (S < 1.0 / 7.0) | (S > 6.0 / 7.0)
        sc = pt.fbm(h, w, 1.0, 0.002 * ppm, 3, 2)
        img[hone] = (np.array((0.66, 0.67, 0.68)) * (0.9 + 0.2 * sc[hone, None]))
        # a dull stain of fish and use toward the heel, darker spine
        spine = (S > 2.5 / 7.0) & (S < 4.5 / 7.0)
        img[spine] *= 0.72
        heel = pt.sm(0.02, 0.0, Y)
        img *= (1 - 0.15 * pt.sm(0.03, 0.0, Y))[..., None]
        return img

    def handle_tex(w, h, ppm):
        img = pt.wood(w, h, ppm, (0.60, 0.45, 0.30), 21, along="v", knots=0, ring_mm=1.6)
        X, Y = pt.coords(w, h, ppm)
        S = X / (X.max() + 0.5 / ppm)
        # the tang between the scales, at a quarter and three quarters round
        for f in (0.25, 0.75):
            line = np.abs(S - f) < 0.0011 / (X.max() + 0.5 / ppm) * 1.0 + 0.012
            img[line] = pt.steel(w, h, ppm, 22)[line] * 0.8
        # dark grime where the hand holds it
        img *= (0.78 + 0.22 * pt.fbm(h, w, 0.01 * ppm, 0.02 * ppm, 23, 3))[..., None]
        return img

    return {
        "blade": A.cell("small", 0.050, 0.115, K_PPM, blade_tex, "knife blade"),
        "handle": A.cell("small", 0.062, 0.095, K_PPM, handle_tex, "knife handle"),
        "brass": A.cell("small", 0.064, 0.016, K_PPM, lambda w, h, p: pt.brass(w, h, p, 31, (0.52, 0.42, 0.22)), "knife brass"),
    }


def _section(rx, ry, n, power=2.6, cy=0.0):
    pts = []
    for j in range(n):
        a = 2 * math.pi * j / n
        c, s = math.cos(a), math.sin(a)
        pts.append((rx * math.copysign(abs(c) ** (2 / power), c), cy + ry * math.copysign(abs(s) ** (2 / power), s)))
    return pts


def _loft_z(m, stations, n, skin, power=2.6, circ=None, thr=45.0, shade=1.0, pole_end=None):
    """Rings of a rounded rectangle along local Z: stations (z, rx, ry); pole_end ('lo'/'hi'): close that end in a
    point."""
    rows = []
    for z, rx, ry in stations:
        rows.append([(x, y, z) for x, y in _section(rx, ry, n, power)])
    if pole_end == "lo":
        z0 = stations[0][0] - 0.0015
        rows.insert(0, [(0.0, 0.0, z0)] * n)
    P = np.array(rows)
    circ = circ or 0.06
    ST = np.zeros((len(rows), n + 1, 2))
    for i in range(len(rows)):
        for j in range(n + 1):
            ST[i, j] = (circ * j / n, P[i, 0, 2] - P[0, 0, 2])
    return kit.grid(m, P, ST, skin, closed=True, outfn=lambda i, j, c: np.array((c[0], c[1], 0.0)) +
                    np.array((0, 0, -1.0 if (pole_end == "lo" and i == 0) else 0.0)), thr=thr, shade=shade)


def knife(A):
    C = knife_cells(A)
    m = kit.Mesh("held_knife")
    # the handle: two beech scales on the tang, swelling a little in the palm, the butt rounded
    hs = [(-0.052, 0.0050, 0.0075), (-0.0505, 0.0071, 0.0101), (-0.047, 0.0079, 0.0111), (-0.030, 0.0081, 0.0113),
          (-0.005, 0.0080, 0.0112), (0.020, 0.0077, 0.0108), (0.040, 0.0074, 0.0104)]
    _loft_z(m, hs, 12, Param(C["handle"], off=(0.0, 0.0)), circ=0.060, pole_end="lo", thr=50.0)
    # the ferrule (bolster) round the handle's end, a front face where the blade comes out
    fs = [(0.0395, 0.0078, 0.0108), (0.0405, 0.0084, 0.0114), (0.0510, 0.0084, 0.0114), (0.0520, 0.0076, 0.0105)]
    ids = _loft_z(m, fs, 12, Param(C["brass"]), circ=0.062, thr=40.0)
    ring = [m.V[i] for i in ids[-1]]
    pts = [tuple(np.array(p)) for p in ring]
    kit.cap(m, ids[-1], [np.array(p) for p in pts], Flat(C["brass"]), out=(0, 0, 1.0))
    # three brass rivets through the scales, domed heads both sides
    for z in RIVETS_Z:
        rx = 0.0081 if z < 0.0 else 0.0079
        for sx in (-1, 1):
            M = kit.T(sx * (rx - 0.0004), 0.0, z) @ Matrix.Rotation(math.radians(90 * sx), 4, "Y")
            with m.at(M):
                kit.lathe(m, [(0.0030, -0.0004), (0.0026, 0.0005), (0.0014, 0.0010), (0.0, 0.0011)], 8, Flat(C["brass"], 0.4, 0.5),
                          thr=60.0)
    # the blade: a short stiff carbon-steel blade, a wedge from the spine to a honed edge
    nst = 10
    rows, ST = [], []
    n = 7
    for k in range(nst):
        t = k / (nst - 1) * 0.985
        z = BLADE_Z[0] + t * (BLADE_Z[1] - BLADE_Z[0])
        ye, ys, ts = _blade_shape(t)
        wd = ye - ys
        bw = min(0.0018, 0.35 * wd)  # the honed bevel, narrowing into the point
        sh = min(0.0022, 0.30 * wd)  # the rounded shoulder below the spine
        te = 0.0005
        sec = [(0.0, ye), (te / 2 + 0.0002, ye - bw), (ts * 0.5, ys + sh), (ts * 0.32, ys), (-ts * 0.32, ys),
               (-ts * 0.5, ys + sh), (-te / 2 - 0.0002, ye - bw)]
        rows.append([(x, y, z) for x, y in sec])
    tip_t = 1.0
    ye, ys, _ = _blade_shape(tip_t)
    rows.append([(0.0, (ye + ys) / 2, BLADE_Z[1])] * n)
    P = np.array(rows)
    W = 0.050
    for i in range(len(rows)):
        ST.append([(W * j / n, P[i, 0, 2] - BLADE_Z[0]) for j in range(n + 1)])
    ST = np.array(ST)

    def bout(i, j, c):
        t = min(1.0, (c[2] - BLADE_Z[0]) / (BLADE_Z[1] - BLADE_Z[0]))
        ye, ys, _ = _blade_shape(t)
        return np.array((c[0], c[1] - (ye + ys) / 2, 0.0))

    kit.grid(m, P, ST, Param(C["blade"]), closed=True, outfn=bout, thr=28.0)
    return m


# ------------------------------------------------------------------ the herring

F_PPM = 1000
F_CIRC = 0.13  # the length of the body's texture round (both flanks, back and belly)
F_X0 = -0.096


def _fish_stations():
    # x, depth, width, centre z: a herring of 25 cm (with its tail); the lower jaw juts at the snout
    return [(-0.094, 0.0105, 0.0028, 0.0), (-0.088, 0.0112, 0.0040, 0.0), (-0.078, 0.0165, 0.0064, 0.0),
            (-0.062, 0.0265, 0.0105, 0.0), (-0.042, 0.0385, 0.0160, -0.0003), (-0.018, 0.0470, 0.0200, -0.0006),
            (0.006, 0.0500, 0.0215, -0.0006), (0.032, 0.0478, 0.0210, -0.0003), (0.056, 0.0425, 0.0195, 0.0),
            (0.0665, 0.0397, 0.0186, 0.0004), (0.0685, 0.0387, 0.0179, 0.0004), (0.084, 0.0335, 0.0160, 0.0008),
            (0.098, 0.0262, 0.0130, 0.0012), (0.110, 0.0180, 0.0094, 0.0010), (0.119, 0.0105, 0.0060, 0.0002),
            (0.1245, 0.0040, 0.0030, -0.0012), (0.1255, 0.0, 0.0, -0.0014)]


def _fish_ring(depth, width, cz, n):
    """A herring's section: an egg, the belly a little keeled. Columns start at the back (+z) and go round +y."""
    out = []
    for j in range(n):
        a = 2 * math.pi * j / n
        s, c = math.sin(a), math.cos(a)
        top = c > 0
        rz = depth * (0.46 if top else 0.54)
        pw = 2.1 if top else 1.75
        y = width / 2 * math.copysign(abs(s) ** (2 / 2.2), s)
        z = cz + rz * math.copysign(abs(c) ** (2 / pw), c)
        out.append((y, z))
    return out


def fish_cells(A):
    def body_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        f = Y / F_CIRC  # 0 the back, 0.25 the +y flank, 0.5 the belly, 0.75 the -y flank
        d = np.minimum(f, 1 - f)  # 0 back .. 0.5 belly
        back = np.array((0.09, 0.18, 0.22))
        flank = np.array((0.64, 0.67, 0.70))
        belly = np.array((0.82, 0.83, 0.84))
        k1 = pt.sm(0.08, 0.20, d)[..., None]
        k2 = pt.sm(0.30, 0.46, d)[..., None]
        img = back * (1 - k1) + flank * k1
        img = img * (1 - k2) + belly * k2
        # a blue-green sheen in the band below the back, a faint golden line along the flank
        sheen = (pt.sm(0.07, 0.13, d) * pt.sm(0.24, 0.14, d))[..., None]
        img = img * (1 - 0.45 * sheen) + np.array((0.26, 0.42, 0.46)) * 0.45 * sheen
        gold = (pt.sm(0.17, 0.2, d) * pt.sm(0.23, 0.2, d))[..., None]
        img = img * (1 - 0.15 * gold) + np.array((0.70, 0.62, 0.42)) * 0.15 * gold
        # scales: soft rows of overlapping rounded scales, each a little brighter at its exposed middle
        sz = 0.0048
        u = X / sz
        v = Y / (sz * 0.85)
        row = np.floor(v)
        uu = (u + 0.5 * (row % 2)) % 1.0
        vv = v % 1.0
        r = np.hypot(uu - 0.15, (vv - 0.5) * 1.1)
        scale = pt.sm(0.62, 0.42, r) * 0.5 + 0.5
        img *= (0.93 + 0.09 * scale * pt.sm(0.06, 0.2, d))[..., None]
        img *= (0.95 + 0.08 * pt.fbm(h, w, 0.012 * ppm, 0.008 * ppm, 42, 3))[..., None]
        # a little darker toward the tail
        img *= (0.9 + 0.1 * pt.sm(0.0, 0.07, X))[..., None]
        xh = X + F_X0  # the fish's own x
        # the gill cover: a curved dark edge sweeping back toward the belly, a faint red glint behind it
        gx = 0.0672 - 0.010 * (pt.sm(0.10, 0.45, d) - 0.5) ** 2 * 4 + 0.004 * pt.sm(0.3, 0.46, d)
        on = pt.sm(0.10, 0.14, d)
        e = xh - gx
        img *= (1 - 0.45 * on * pt.sm(0.0011, 0.0, np.abs(e)))[..., None]
        glint = on * pt.sm(0.2, 0.26, d) * pt.sm(0.45, 0.38, d) * pt.sm(-0.004, -0.0005, e) * pt.sm(0.0, -0.0006, e)
        img = img * (1 - 0.35 * glint[..., None]) + np.array((0.55, 0.16, 0.13)) * 0.35 * glint[..., None]
        cover = on * pt.sm(0.0, 0.002, e) * pt.sm(0.106, 0.098, xh)
        img = img * (1 - 0.12 * cover[..., None]) + np.array((0.78, 0.72, 0.56)) * 0.12 * cover[..., None]
        # the eyes, both sides: a silver-gold iris, the black pupil, a darker rim, a glint
        for fc in (0.17, 1 - 0.17):
            ex, ey = 0.1005, fc * F_CIRC
            r = np.hypot(xh - ex, Y - ey)
            iris = pt.sm(0.0062, 0.0054, r)
            img = img * (1 - iris[..., None]) + np.array((0.66, 0.65, 0.58)) * iris[..., None]
            pupil = pt.sm(0.0033, 0.0027, r)
            img = img * (1 - pupil[..., None]) + np.array((0.02, 0.02, 0.025)) * pupil[..., None]
            img *= (1 - 0.35 * pt.sm(0.0062, 0.0066, r) * pt.sm(0.0075, 0.0068, r))[..., None]
            hl = pt.sm(0.0012, 0.0006, np.hypot(xh - ex - 0.0012, Y - ey + 0.0012 * (1 if fc < 0.5 else -1)))
            img = img * (1 - 0.7 * hl[..., None]) + 0.9 * 0.7 * hl[..., None]
        # the line of the mouth toward the snout
        mouth = pt.sm(0.106, 0.112, xh) * pt.sm(0.012, 0.0, np.abs(d - 0.335) - 0.002)
        img *= (1 - 0.45 * mouth)[..., None]
        return img

    def fin_tex(w, h, ppm):
        X, Y = pt.coords(w, h, ppm)
        img = np.ones((h, w, 3), np.float32) * np.array((0.52, 0.55, 0.56))
        rays = 0.5 + 0.5 * np.cos(X / 0.0018 * 2 * math.pi)
        img *= (0.88 + 0.12 * rays)[..., None]
        img *= (0.85 + 0.2 * pt.fbm(h, w, 0.006 * ppm, 0.006 * ppm, 51, 2))[..., None]
        return img

    return {"body": A.cell("small", 0.224, F_CIRC, F_PPM, body_tex, "herring body"),
            "fin": A.cell("small", 0.066, 0.08, F_PPM, fin_tex, "herring fins")}


def fish(A):
    C = fish_cells(A)
    m = kit.Mesh("held_fish")
    n = 20
    st = _fish_stations()
    rows = []
    for x, dpt, wid, cz in st:
        if dpt <= 0:
            rows.append([(x, 0.0, cz)] * n)
        else:
            rows.append([(x, y, z) for y, z in _fish_ring(dpt, wid, cz, n)])
    P = np.array(rows)
    ST = np.zeros((len(rows), n + 1, 2))
    for i in range(len(rows)):
        for j in range(n + 1):
            ST[i, j] = (P[i, 0, 0] - F_X0, F_CIRC * j / n)
    xs = np.array([s[0] for s in st])
    czs = np.array([s[3] for s in st])
    ids = kit.grid(m, P, ST, Param(C["body"]), closed=True,
                   outfn=lambda i, j, c: np.array((0.0, c[1], c[2] - np.interp(c[0], xs, czs))), thr=55.0)
    # the root of the tail: closed in a flat cap (inside the tail fin)
    kit.cap(m, ids[0], P[0], Flat(C["fin"]), out=(-1.0, 0, 0))
    fin = Box(C["fin"])
    XZ = Matrix.Rotation(math.radians(90), 4, "X")  # local y -> z: fins drawn in the fish's x-z plane

    def fin_plate(poly, th, M=Matrix.Identity(4)):
        with m.at(M @ XZ):
            kit.prism(m, poly, -th / 2, th / 2, fin, c=0.0, thr=30.0)

    top = 0.0228
    fin_plate([(-0.014, top - 0.005), (0.026, top - 0.005), (0.012, top + 0.018), (0.003, top + 0.017), (-0.004, top + 0.006)], 0.0009)
    # the forked tail: one plate, its fork cut deep
    fin_plate([(-0.086, -0.0045), (-0.086, 0.0045), (-0.104, 0.016), (-0.121, 0.031), (-0.1295, 0.0345), (-0.1265, 0.025),
               (-0.1135, 0.0015), (-0.1265, -0.025), (-0.1295, -0.0345), (-0.121, -0.031), (-0.104, -0.016)], 0.0008)
    # the anal fin under the tail half, the pelvic fins under the middle
    fin_plate([(-0.060, -0.0125), (-0.036, -0.0170), (-0.040, -0.0245), (-0.060, -0.017)], 0.0008)
    for sy in (-1, 1):
        M = kit.T(0.0, sy * 0.0035, 0.0) @ Matrix.Rotation(math.radians(sy * 14), 4, "X")
        fin_plate([(-0.004, -0.0215), (0.012, -0.0225), (0.002, -0.031), (-0.006, -0.027)], 0.0007, M)
        # the pectoral fins: low behind the gill covers, lying back against the flanks
        root = (0.064, sy * 0.0095, -0.0115)
        M = (kit.T(*root) @ Matrix.Rotation(math.radians(sy * 10), 4, "X") @ Matrix.Rotation(math.radians(-14), 4, "Y") @
             kit.T(-0.064, 0.0, 0.0115))
        fin_plate([(0.066, -0.0105), (0.066, -0.0135), (0.040, -0.0160), (0.042, -0.0120)], 0.0007, M)
    return m
