"""Street benches (#165): a cast-iron park bench (scrolled iron ends, oak slats) and a plank bench (oak or pine
planks on square legs, iron straps), each in a fine and a worn finish of the one shape. Our own work: every picture
is painted here with workgoods/paint.py, nothing downloaded.

Game axes (y up, the sitter's knees toward +z), real metres, the origin on the ground under the middle of the seat.
Edges: oak and pine 3-4 mm, cast iron 1.5-2 mm (AGENTS.md); bolt heads domed. The worn finish takes the same
geometry with one slat (park) or the lower back plank (plank) gone, weathered and rusted pictures, carved initials.
"""

import math

import numpy as np
from mathutils import Matrix

from workgoods import kit
from workgoods import paint as pt
from workgoods.kit import Box, Param

GM = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))  # game (x, y, z) -> Blender (x, -z, y)
AY = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # a lathe's local z along game +y
# a prism's outline in local (x, y) = game (z, y), extruded along local z = game -x
PX = Matrix(((0, 0, -1, 0), (0, 1, 0, 0), (1, 0, 0, 0), (0, 0, 0, 1)))


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def frame(o, d, n):
    """A local frame at game point o: local x = game x, local y along d (y, z), local z along n (y, z)."""
    return Matrix(((1, 0, 0, o[0]), (0, d[0], n[0], o[1]), (0, d[1], n[1], o[2]), (0, 0, 0, 1)))


# ------------------------------------------------------------------ outlines


def curve(pts, k=4):
    """A Catmull-Rom curve through the points (k steps per span)."""
    P = np.asarray(pts, float)
    if len(P) < 3:
        return P
    Q = np.vstack([2 * P[0] - P[1], P, 2 * P[-1] - P[-2]])
    out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for s in range(k):
            t = s / k
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return np.array(out)


def widths(ws, k=4):
    """Widths at the control points, spread along a curve(..., k) of them."""
    ws = np.atleast_1d(np.asarray(ws, float))
    if len(ws) == 1:
        return ws[0]
    out = []
    for i in range(len(ws) - 1):
        for s in range(k):
            out.append(ws[i] + (ws[i + 1] - ws[i]) * s / k)
    out.append(ws[-1])
    return np.array(out)


def strip(path, w):
    """A band of width w (one number or per point) round a path in the plane: a ccw outline."""
    P = np.asarray(path, float)
    n = len(P)
    W = np.broadcast_to(np.asarray(w, float), (n,))
    L, R = [], []
    for i in range(n):
        d = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        d = d / (np.linalg.norm(d) or 1.0)
        nrm = np.array((-d[1], d[0]))
        L.append(P[i] + nrm * W[i] / 2)
        R.append(P[i] - nrm * W[i] / 2)
    poly = np.array(R + L[::-1])
    area = sum(poly[k][0] * poly[(k + 1) % len(poly)][1] - poly[(k + 1) % len(poly)][0] * poly[k][1] for k in range(len(poly)))
    return poly if area > 0 else poly[::-1]


def spiral(c, r0, r1, a0, turns, k=22):
    a = np.linspace(a0, a0 + turns * 2 * math.pi, k)
    r = np.linspace(r0, r1, k)
    return np.stack([c[0] + r * np.cos(a), c[1] + r * np.sin(a)], 1)


# ------------------------------------------------------------------ pictures

PPM = 470
OAK_FINE = (0.47, 0.31, 0.17)
OAK_PLANK = (0.44, 0.31, 0.19)
PINE_WORN = (0.52, 0.45, 0.36)
GREEN = (0.075, 0.175, 0.115)


def initials(img, ppm, cx, cy, text, seed, depth=0.55):
    """Letters cut with a knife into wood: dark grooves with a pale bruised rim."""
    rng = pt.rng_(seed)
    unit = max(2, int(0.0042 * ppm))
    mask = pt.text_mask(text, unit)
    h, w = mask.shape
    x0, y0 = int(cx * ppm - w / 2), int(cy * ppm - h / 2)
    H, W = img.shape[:2]
    if x0 < 0 or y0 < 0 or x0 + w > W or y0 + h > H:
        return
    m = mask.astype(np.float32)
    rim = np.clip(pt.blur(m, 1) * 1.6 - m, 0, 1)
    sub = img[y0:y0 + h, x0:x0 + w]
    sub *= (1 - depth * m)[..., None]
    sub += (rim * 0.10)[..., None] * (0.8 + 0.4 * rng.random((h, w, 1)))
    img[y0:y0 + h, x0:x0 + w] = sub


def wood_fine(w, h, ppm, seed, rgb=OAK_FINE):
    """Varnished oak slats: warm, even, a soft gloss streak, faint wear on the front."""
    img = pt.wood(w, h, ppm, rgb, seed, oak=True, knots=1, ring_mm=4.0)
    img *= (0.94 + 0.08 * pt.fbm(h, w, 0.25 * ppm, 0.02 * ppm, seed + 7, 3))[..., None]
    return img


def wood_worn(w, h, ppm, seed, rgb=PINE_WORN, paint=None, carve=None):
    """Weathered wood gone silver-grey: open grain, cracks along it, dirt and lichen, flaking old paint."""
    rng = pt.rng_(seed)
    img = pt.wood(w, h, ppm, rgb, seed, oak=False, knots=2, ring_mm=6.0, weather=0.85, dirt=0.15)
    X, Y = pt.coords(w, h, ppm)
    # cracks: thin dark lines along the grain, wandering
    for _ in range(int(w / ppm * 5)):
        y = rng.uniform(0.004, h / ppm - 0.004)
        x0 = rng.uniform(0, w / ppm)
        L = rng.uniform(0.05, 0.35)
        wob = pt.fbm(1, w, 0.08 * ppm, 1, int(rng.integers(1 << 20)), 2)[0] - 0.5
        line = (np.abs(Y - (y + wob[None, :] * 0.004)) < max(0.6 / ppm, 0.0006)) & (X > x0) & (X < x0 + L)
        img[line] *= 0.35
    if paint is not None:
        # old paint left in the grain and the low spots: small flakes, mostly gone
        flake = pt.sm(0.69, 0.725, pt.fbm(h, w, 0.016 * ppm, 0.006 * ppm, seed + 11, 4)) * 0.9
        col = np.asarray(paint, np.float32) * (0.85 + 0.3 * pt.fbm(h, w, 0.02 * ppm, 0.02 * ppm, seed + 12, 2))[..., None]
        img = img * (1 - flake[..., None]) + col * flake[..., None]
    lichen = pt.sm(0.80, 0.86, pt.fbm(h, w, 0.012 * ppm, 0.012 * ppm, seed + 13, 3)) * 0.45
    pt.mix(img, lichen, (0.42, 0.45, 0.36))
    grime = pt.fbm(h, w, 0.15 * ppm, 0.05 * ppm, seed + 14, 3)
    img *= (0.80 + 0.25 * grime)[..., None]
    if carve is not None:
        for cx, cy, text in carve:
            initials(img, ppm, cx, cy, text, seed + 21)
    return img


def iron_paint(w, h, ppm, seed, rgb=GREEN, wear=0.08):
    """Cast iron under oil paint: brush marks, a little sheen; wear: chips and rust coming through."""
    rng = pt.rng_(seed)
    brush = pt.fbm(h, w, 0.05 * ppm, 0.005 * ppm, seed, 3)
    mott = pt.fbm(h, w, 0.05 * ppm, 0.05 * ppm, seed + 1, 3)
    img = np.asarray(rgb, np.float32) * (0.86 + 0.14 * brush + 0.16 * (mott - 0.5))[..., None]
    if wear > 0:
        lo = 0.70 - 0.22 * wear
        bare = pt.sm(lo, lo + 0.07, pt.fbm(h, w, 0.03 * ppm, 0.03 * ppm, seed + 2, 4))
        under = pt.iron(w, h, ppm, seed + 3, rust=0.75)
        img = img * (1 - bare[..., None]) + under * bare[..., None]
        # rust bleeding down from the chips
        bleed = pt.blur(bare, int(0.004 * ppm)) * pt.sm(0.4, 0.9, pt.fbm(h, w, 0.004 * ppm, 0.03 * ppm, seed + 4, 3))
        pt.mix(img, np.clip(bleed * wear * 2.0, 0, 0.6), pt.RUST * 1.1)
    chips = rng.random((h, w)) < 0.0015 * (1 + 8 * wear)
    img[chips] = img[chips] * 0.4 + pt.RUST * 0.5
    return img


def iron_black(w, h, ppm, seed, rust=0.15):
    return pt.iron(w, h, ppm, seed, rgb=(0.055, 0.052, 0.05), rust=rust, pits=0.6)


def cells(A, region, kind, worn):
    """The pictures of one bench: wood (long), its end grain, the iron, the bolt heads; a carved slat when worn."""
    s = 700 + (0 if kind == "park" else 50) + (5 if worn else 0)
    L = 1.95 if kind == "park" else 2.0
    if kind == "park":
        wood = (lambda w, h, p: wood_worn(w, h, p, s, (0.50, 0.44, 0.36), paint=(0.10, 0.20, 0.13))) if worn else (lambda w, h, p: wood_fine(w, h, p, s))
        iron = (lambda w, h, p: iron_paint(w, h, p, s + 1, wear=0.55)) if worn else (lambda w, h, p: iron_paint(w, h, p, s + 1, wear=0.03))
    else:
        wood = (lambda w, h, p: wood_worn(w, h, p, s, PINE_WORN, paint=(0.20, 0.27, 0.20))) if worn else (lambda w, h, p: pt.wood(w, h, p, OAK_PLANK, s, oak=True, knots=2, ring_mm=4.5) * 0.96)
        iron = (lambda w, h, p: iron_black(w, h, p, s + 1, rust=0.75)) if worn else (lambda w, h, p: iron_black(w, h, p, s + 1, rust=0.12))
    out = {
        "wood": A.cell(region, L, 0.30, PPM, wood, kind + ("-worn" if worn else "-fine") + " wood"),
        "end": A.cell(region, 0.20, 0.20, PPM, lambda w, h, p: pt.end_grain(w, h, p, PINE_WORN if worn else OAK_FINE, s + 2) * (0.8 if worn else 1.0), kind + " end grain"),
        "iron": A.cell(region, 1.00, 1.00 if kind == "park" else 0.30, PPM // 2 if kind == "park" else PPM, iron, kind + " iron"),
        "bolt": A.cell(region, 0.06, 0.06, PPM, (lambda w, h, p: pt.iron(w, h, p, s + 3, rust=0.85)) if worn else (lambda w, h, p: iron_black(w, h, p, s + 3, 0.1)), kind + " bolts"),
    }
    if worn:
        mark = ("J.V. 1857", "L-M") if kind == "park" else ("K.W.", "1871")
        out["carved"] = A.cell(region, L, 0.08 if kind == "park" else 0.18, PPM, lambda w, h, p: wood_worn(w, h, p, s + 9, (0.50, 0.44, 0.36) if kind == "park" else PINE_WORN,
                                                                                paint=(0.10, 0.20, 0.13) if kind == "park" else (0.20, 0.27, 0.20),
                                                                                carve=[(0.62, 0.035, mark[0]), (1.35, 0.04, mark[1])] if kind == "park" else [(0.55, 0.06, mark[0]), (1.30, 0.09, mark[1])]), kind + " carved")
    return out


def bolt(m, C, x, y, z, up=(1.0, 0.0), r=0.0085, hgt=0.0045):
    """A domed carriage-bolt head at a game point, its axis along up (y, z) in the y-z plane."""
    d = np.array(up, float) / np.linalg.norm(up)
    n = np.array((d[1], -d[0]))
    M = frame((x, y, z), (n[0], n[1]), (d[0], d[1]))  # local z = the bolt's axis (a right-handed frame)
    prof = [(r, 0.0), (r * 0.9, hgt * 0.55), (r * 0.5, hgt * 0.95), (0.0, hgt)]
    with m.at(M):
        kit.lathe(m, prof, 6, Box(C["bolt"]), thr=60.0)


# ------------------------------------------------------------------ the cast-iron park bench

PARK_L = 1.84  # slats
PARK_ENDS = (-0.79, 0.79)
SEAT_Y = 0.448
SEAT_SLATS = 5
SLAT_W, SLAT_T, SLAT_GAP = 0.064, 0.030, 0.013


def _post_line():
    """The back post's centre line in (z, y): from the seat's back up to the top (reclined about 10 degrees)."""
    return np.array((-0.205, 0.40)), np.array((-0.292, 0.89))


def park_end(m, C, x0, x1, arm=True):
    """One cast-iron end between game x0 and x1: legs, seat rail, back post, scrolled arm, a low stretcher."""
    skin = Box(C["iron"])
    a, b = _post_line()
    parts = [
        (curve([(0.262, 0.0), (0.246, 0.09), (0.222, 0.22), (0.206, 0.33), (0.200, 0.425)]), [0.046, 0.040, 0.034, 0.032, 0.034]),  # front leg
        (curve([(-0.300, 0.0), (-0.268, 0.10), (-0.232, 0.22), (-0.212, 0.33), a, (a + b) / 2, b]), [0.050, 0.042, 0.036, 0.034, 0.034, 0.030, 0.026]),  # rear leg and post
        (curve([(0.225, 0.418), (0.0, 0.410), (-0.215, 0.402)]), 0.030),  # seat rail
        (curve([(0.225, 0.135), (0.0, 0.150), (-0.248, 0.135)]), 0.020),  # stretcher
    ]
    if arm:
        parts += [
            (curve([(-0.228, 0.640), (-0.08, 0.660), (0.10, 0.652), (0.205, 0.628), (0.236, 0.598)]), [0.030, 0.030, 0.030, 0.028, 0.024]),  # arm
            (curve([(0.198, 0.425), (0.215, 0.50), (0.200, 0.575), (0.214, 0.630)]), 0.022),  # arm support
            (spiral((0.214, 0.582), 0.024, 0.006, math.pi * 0.25, 1.15, k=14), np.linspace(0.016, 0.009, 14)),  # the scroll under the arm's end
        ]
    for path, w in parts:
        if np.ndim(w) and len(w) != len(path):
            w = widths(w, (len(path) - 1) // (len(w) - 1))
        with m.at(T(x1, 0, 0) @ PX):
            kit.prism(m, strip(path, w), 0.0, x1 - x0, skin, c=0.0018, thr=40.0)
    # feet: flat pads cast on
    for z in (0.262, -0.300):
        kit.cbox(m, (x0 - 0.006, 0.0, z - 0.034), (x1 + 0.006, 0.012, z + 0.034), skin, c=0.002, skip=((1, -1),))


def park(A, region, worn):
    C = cells(A, region, "park", worn)
    rng = np.random.default_rng(77 + worn)
    m = kit.Mesh("bench_park_" + ("worn" if worn else "fine"))
    wood = Box(C["wood"], grain=0, ends=C["end"], rng=rng)
    t = 0.032
    with m.at(GM):
        for xc in PARK_ENDS:
            park_end(m, C, xc - t / 2, xc + t / 2)
        park_end(m, C, -0.014, 0.014, arm=False)  # the middle bearer
        # seat slats on the rails, front to back
        z = 0.212
        for i in range(SEAT_SLATS):
            z0, z1 = z - SLAT_W, z
            sk = Box(C["carved"], grain=0, ends=C["end"]) if worn and i == 1 else wood
            kit.cbox(m, (-PARK_L / 2, SEAT_Y - SLAT_T, z0), (PARK_L / 2, SEAT_Y, z1), sk, c=0.0035, thr=32.0)
            for xb in (PARK_ENDS[0], 0.0, PARK_ENDS[1]):
                bolt(m, C, xb, SEAT_Y, (z0 + z1) / 2)
            z = z0 - SLAT_GAP
        # back slats on the posts' front faces
        a, b = _post_line()
        d = (b - a) / np.linalg.norm(b - a)  # (z, y)
        n = np.array((d[1], -d[0]))  # toward the sitter
        for k, s in enumerate((0.20, 0.31, 0.42)):
            if worn and k == 1:
                continue  # the worn bench has lost its middle back slat (the bolt holes stay in the iron)
            p = a + d * s + n * (0.017 + 0.012)
            M = frame((0.0, p[1], p[0]), (d[1], d[0]), (n[1], n[0]))
            with m.at(M):
                kit.cbox(m, (-PARK_L / 2, -0.04, -0.012), (PARK_L / 2, 0.04, 0.012), wood, c=0.0035, thr=32.0)
            for xb in (PARK_ENDS[0], 0.0, PARK_ENDS[1]):
                q = p + n * 0.012
                bolt(m, C, xb, q[1], q[0], up=(n[1], n[0]))
    return m


# ------------------------------------------------------------------ the plank bench

PLANK_L = 1.90
LEG_X = 0.70
PLANK_Y = 0.455
PLANK_T = 0.046


def plank(A, region, worn):
    C = cells(A, region, "plank", worn)
    rng = np.random.default_rng(91 + worn)
    m = kit.Mesh("bench_plank_" + ("worn" if worn else "fine"))
    wood = Box(C["wood"], grain=0, ends=C["end"], rng=rng)
    up = Box(C["wood"], grain=1, ends=C["end"], rng=rng)  # legs and posts: grain up
    deep = Box(C["wood"], grain=2, ends=C["end"], rng=rng)  # bearers: grain across
    iron = Box(C["iron"])
    lw = 0.068
    zf, zb = 0.120, -0.128  # leg centres
    tilt = math.radians(9.0)
    with m.at(GM):
        # two seat planks
        for i, (z0, z1) in enumerate(((0.012, 0.172), (-0.160, 0.004))):
            sk = Box(C["carved"], grain=0, ends=C["end"]) if worn and i == 0 else wood
            kit.cbox(m, (-PLANK_L / 2, PLANK_Y - PLANK_T, z0), (PLANK_L / 2, PLANK_Y, z1), sk, c=0.004, thr=32.0)
        for xs in (-LEG_X, LEG_X):
            # front leg, bearer under the seat, the rear leg rising into the back post (reclined)
            kit.cbox(m, (xs - lw / 2, 0.0, zf - lw / 2), (xs + lw / 2, PLANK_Y - PLANK_T - 0.07, zf + lw / 2), up, c=0.004, skip=((1, -1),), thr=32.0)
            kit.cbox(m, (xs - 0.032, PLANK_Y - PLANK_T - 0.07, -0.19), (xs + 0.032, PLANK_Y - PLANK_T, 0.19), deep, c=0.004, thr=32.0)
            kit.cbox(m, (xs - lw / 2, 0.0, zb - lw / 2), (xs + lw / 2, PLANK_Y - PLANK_T - 0.07, zb + lw / 2), up, c=0.004, skip=((1, -1),), thr=32.0)
            base = np.array((zb - 0.012, PLANK_Y - PLANK_T - 0.07))  # (z, y)
            d = np.array((-math.sin(tilt), math.cos(tilt)))
            n = np.array((d[1], -d[0]))
            M = frame((xs, base[1], base[0]), (d[1], d[0]), (n[1], n[0]))
            with m.at(M):
                kit.cbox(m, (-0.030, 0.0, -0.032), (0.030, 0.53, 0.032), up, c=0.004, thr=32.0)
            # low rail between the legs
            kit.cbox(m, (xs - 0.024, 0.085, zb), (xs + 0.024, 0.135, zf), deep, c=0.0035, thr=32.0)
            # iron angle straps where the legs meet the bearer, with bolts
            for z, sgn in ((zf, 1), (zb, -1)):
                zz = z + sgn * (lw / 2 + 0.002)
                kit.cbox(m, (xs - 0.022, PLANK_Y - PLANK_T - 0.15, min(zz, zz + sgn * 0.005)), (xs + 0.022, PLANK_Y - PLANK_T - 0.005, max(zz, zz + sgn * 0.005)),
                         iron, c=0.0012, thr=40.0)
                for yb in (PLANK_Y - PLANK_T - 0.12, PLANK_Y - PLANK_T - 0.035):
                    bolt(m, C, xs, yb, zz + sgn * 0.005, up=(0.0, sgn), r=0.0065, hgt=0.0035)
            # nail heads on the seat
            for zc in (0.092, -0.078):
                for dx in (-0.02, 0.02):
                    bolt(m, C, xs + dx, PLANK_Y, zc, r=0.0045, hgt=0.0018)
        # long stretcher between the ends
        kit.cbox(m, (-LEG_X, 0.098, -0.022), (LEG_X, 0.148, 0.022), wood, c=0.0035, thr=32.0)
        # back planks on the posts' front
        base = np.array((zb - 0.012, PLANK_Y - PLANK_T - 0.07))
        d = np.array((-math.sin(tilt), math.cos(tilt)))
        n = np.array((d[1], -d[0]))
        for k, (s0, s1) in enumerate(((0.21, 0.335), (0.37, 0.50))):
            if worn and k == 0:
                continue  # the lower back plank is gone from the worn bench
            p = base + n * (0.032 + 0.014)
            M = frame((0.0, p[1], p[0]), (d[1], d[0]), (n[1], n[0]))
            with m.at(M):
                kit.cbox(m, (-PLANK_L / 2 + 0.03, s0, -0.014), (PLANK_L / 2 - 0.03, s1, 0.014), wood, c=0.004, thr=32.0)
            for xs in (-LEG_X, LEG_X):
                for s in (s0 + 0.03, s1 - 0.03):
                    q = base + d * s + n * (0.032 + 0.028)
                    bolt(m, C, xs, q[1], q[0], up=(n[1], n[0]), r=0.0045, hgt=0.0018)
    return m


# extras for the game: seat height and the two sitting places (game axes, metres)
EXTRAS = {
    "park": {"seat_y": SEAT_Y, "length": PARK_L, "depth": 0.62, "height": 0.90, "sit": [[-0.45, SEAT_Y, 0.02], [0.45, SEAT_Y, 0.02]]},
    "plank": {"seat_y": PLANK_Y, "length": PLANK_L, "depth": 0.56, "height": 0.95, "sit": [[-0.45, PLANK_Y, 0.02], [0.45, PLANK_Y, 0.02]]},
}
