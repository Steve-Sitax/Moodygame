"""The cathedral confessional's carved figures (#196): the confessional (room-cathedral-source-8902-4, in the south aisle)
had four coarse figures before it, boxes and cones that read as brown people. Carved oak statues in their place, as the
Baroque confessionals of Antwerp's churches have them, life size on low moulded socles: an angel at each end of the
confessional (its wings raised behind it, curly hair, one hand on its breast and the other turned out toward the
penitents' places) and between the booths a veiled penitent saint, head bowed and hands crossed on her breast.

confessional_angel: 1.78 m to the crown, the socle's foot centred on the origin, facing game +Z (Blender -Y).
confessional_saint: 1.56 m, the same.
The furniture piece draws them (FurnitureVisual.ModelParts) where its old figures stood, the angel mirrored at the far end.

One carved oak (the cell is in the stair region of the fittings atlas, after the stairs' cells, so their pictures stay
where they were), grain up the figure, the carving's hollows darkened by the baked occlusion. Organic surfaces are
smooth; the socles' arrises are chamfered 3 mm (AGENTS.md: wood 1 to 4 mm).

Blender axes while building (Z up, front toward -Y).
"""

import math

import numpy as np
from mathutils import Matrix, Vector

from . import hallstair
from . import kit
from . import paint as pt

PPM = 300
_CELLS = {}


def _tile(img):
    """Seamless both ways: the picture blended with itself moved by half, the seams taken from the moved one's middle."""
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    k = (1 - np.abs(2 * (xx + 0.5) / w - 1)) * (1 - np.abs(2 * (yy + 0.5) / h - 1))
    k = np.clip(k * 3.0, 0, 1)[..., None]
    rolled = np.roll(np.roll(img, h // 2, axis=0), w // 2, axis=1)
    return img * k + rolled * (1 - k)


def cells(A):
    if id(A) in _CELLS:
        return _CELLS[id(A)]
    hallstair.cells(A)  # (the stairs' cells first: theirs keep their places whether or not the stairs are built)

    def carved_oak(w, h, ppm):
        # dark waxed oak: a close grain up the figure, the rays' pale flecks, the gouge's facets as a faint mottle
        img = pt.wood(w, h, ppm, (0.40, 0.27, 0.16), 131, oak=True, knots=0, ring_mm=3.0, figure=0.7)
        gouge = pt.fbm(h, w, 0.012 * ppm, 0.02 * ppm, 132, 3)
        img *= (0.93 + 0.12 * gouge)[..., None]
        patina = pt.fbm(h, w, 0.25 * ppm, 0.25 * ppm, 133, 3)
        img *= (0.92 + 0.12 * patina)[..., None]
        return _tile(img)

    _CELLS[id(A)] = {"oak": A.cell("stair", 1.46, 1.64, PPM, carved_oak, "carved oak")}
    return _CELLS[id(A)]


class Carve:
    """UV by projection along the face's main axis, the grain (Blender Z, up the figure) along u, repeated per face
    (the picture is seamless) a little inside the cell's size, so no face runs out of its cell."""

    MARGIN = 0.55  # metres: longer than any face (the socle's and the hem's caps)

    def __init__(self, cell, off=(0.0, 0.0)):
        self.cell, self.off = cell, off

    def uv(self, pts, st, n):
        a = int(np.argmax(np.abs(n)))
        if a == 2:
            u, v = 0, 1
        else:
            u, v = 2, (1 if a == 0 else 0)
        s = [float(p[u]) + self.off[0] for p in pts]
        t = [float(p[v]) + self.off[1] for p in pts]
        W, H = self.cell.wm - self.MARGIN, self.cell.hm - self.MARGIN
        k0 = math.floor(min(s) / W)
        k1 = math.floor(min(t) / H)
        out = [self.cell.px(x - k0 * W, y - k1 * H) for x, y in zip(s, t)]
        kit._chk(self.cell, out)
        return out


def spline(ctrl, n):
    """n points along a Catmull-Rom curve through the control points (ends held)."""
    P = [np.asarray(c, float) for c in ctrl]
    P = [P[0]] + P + [P[-1]]
    segs = len(P) - 3
    out = []
    for i in range(n):
        u = i / (n - 1) * segs
        k = min(int(u), segs - 1)
        t = u - k
        p0, p1, p2, p3 = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    return np.array(out)


def gauss(x):
    return math.exp(-x * x)


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


# ------------------------------------------------------------------ the parts


def socle(m, skin, r=0.21, h=0.055):
    """A low octagonal oak socle, moulded: a plinth, a cove, a small fillet under the figure; chamfered arrises."""
    c = 0.003
    prof = [(r - c, 0.0), (r, c), (r, h * 0.45 - c), (r - c, h * 0.45), (r - 0.012, h * 0.55), (r - 0.022, h * 0.78),
            (r - 0.026, h - c), (r - 0.026 - c, h)]
    kit.lathe(m, prof, 8, skin, a0=math.pi / 8, thr=20.0, caps=(True, True))


class Robe:
    """The long robe from the hem on the socle up round the shoulders to the neck: superelliptic sections (z, half width,
    half depth, centre y, squareness), deep folds falling from the girdle and fanning out to the hem."""

    def __init__(self, m, skin, z0, sections, folds, rows=36, cols=56):
        self.sections = sections
        zs = np.array([s[0] for s in sections])
        u = np.linspace(0, 1, rows)
        zr = zs[0] + (zs[-1] - zs[0]) * (u - 0.035 * np.sin(2 * math.pi * u))
        zr[0], zr[-1] = zs[0], zs[-1]
        self.zr = zr
        th = np.array([-math.pi / 2 + 2 * math.pi * j / cols for j in range(cols)])  # column 0 at the front (-Y)
        self.th = th
        P = np.zeros((rows, cols, 3))
        self.ctr = []
        for i in range(rows):
            a, b, cy, p = (self.at(k, zr[i]) for k in (1, 2, 3, 4))
            self.ctr.append(np.array((0.0, cy, zr[i])))
            for j, t in enumerate(th):
                c, s = math.cos(t), math.sin(t)
                x = a * math.copysign(abs(c) ** (2 / p), c)
                y = b * math.copysign(abs(s) ** (2 / p), s)
                rr = math.hypot(x, y) or 1.0
                d = folds(zr[i] - z0, t)
                P[i, j] = (x + x / rr * d, cy + y + y / rr * d, zr[i])
        self.P = P
        ST = np.zeros((rows, cols + 1, 2))
        ctr = self.ctr

        def outfn(i, j, c):
            o = c - (ctr[i] + ctr[i + 1]) / 2
            o[2] = 0.0
            return o

        ids = kit.grid(m, P, ST, skin, closed=True, outfn=outfn, thr=75.0)
        kit.cap(m, ids[0], P[0], skin, out=(0, 0, -1.0), thr=30.0)
        kit.cap(m, ids[-1], P[-1], skin, out=(0, 0, 1.0), thr=30.0)

    def at(self, k, z):
        return float(np.interp(z, [s[0] for s in self.sections], [s[k] for s in self.sections]))

    def surface(self, z, t, lift=0.0):
        """The robe's surface at height z and angle t (from its rows and columns), lifted off it by `lift`."""
        i = int(np.clip(np.searchsorted(self.zr, z) - 1, 0, len(self.zr) - 2))
        w = (z - self.zr[i]) / (self.zr[i + 1] - self.zr[i])
        jf = ((t + math.pi / 2) % (2 * math.pi)) / (2 * math.pi) * len(self.th)
        j0 = int(jf) % len(self.th)
        j1 = (j0 + 1) % len(self.th)
        f = jf - int(jf)
        p = (self.P[i, j0] * (1 - f) + self.P[i, j1] * f) * (1 - w) + (self.P[i + 1, j0] * (1 - f) + self.P[i + 1, j1] * f) * w
        o = p - np.array((0.0, self.at(3, z), z))
        o[2] = 0
        return p + unit(o) * lift


def girdle(m, skin, robe, z, t_knot, hang=0.42):
    """A cord round the waist lying across the folds' ridges, knotted at one side of the front, its two ends hanging
    down the robe to knotted tassels."""
    n = 64
    ring = []
    for q in range(n + 1):
        t = -math.pi / 2 + 2 * math.pi * q / n
        ring.append(robe.surface(z, t, 0.008))
    R = np.array(ring)
    # across the ridges: each point at least as far out as its neighbours' mean
    c = np.array((0.0, robe.at(3, z)))
    for q in range(1, n):
        mean = (R[q - 1] + 2 * R[q] + R[q + 1]) / 4
        if np.linalg.norm(mean[:2] - c) > np.linalg.norm(R[q][:2] - c):
            R[q] = mean
    R[-1] = R[0]
    kit.sweep(m, [tuple(p) for p in R], 0.0115, 6, skin, up=(0, 0, 1), thr=75.0,
              bumps=lambda s, a: 1.0 + 0.16 * math.cos(3 * a - s / 0.02 * 2 * math.pi))
    k0 = robe.surface(z, t_knot, 0.020)
    with m.at(kit.T(*k0)):
        kit.lathe(m, [(0.0, -0.022), (0.016, -0.017), (0.023, 0.0), (0.016, 0.017), (0.0, 0.022)], 10, skin, thr=75.0)
    for dt, extra in ((-0.07, 0.0), (0.06, 0.06)):
        L = hang + extra
        zs = np.linspace(z - 0.02, z - L, 10)
        path = [robe.surface(zz, t_knot + dt * (1 + 0.6 * (z - zz) / L) + 0.04 * math.sin((z - zz) * 9), 0.010) for zz in zs]
        kit.sweep(m, [tuple(p) for p in path], 0.0095, 5, skin, up=(0, 0, 1), thr=75.0,
                  bumps=lambda s, a: 1.0 + 0.14 * math.cos(3 * a - s / 0.02 * 2 * math.pi))
        with m.at(kit.T(*path[-1])):
            kit.lathe(m, [(0.0, -0.075), (0.026, -0.073), (0.022, -0.05), (0.016, -0.014), (0.019, -0.006), (0.012, 0.004), (0.0, 0.006)],
                      10, skin, thr=60.0, radial=lambda a, r, zz: r * (1.0 + 0.16 * smooth(-0.02, -0.07, zz) * abs(math.cos(4 * a))))


def feet(m, skin, y0, z0, spread=0.085, k=1.0):
    """The toes of the two sandalled feet showing under the hem at the front."""
    for sx, fwd in ((-1, 0.0), (1, 0.025)):
        with m.at(kit.T(sx * spread * k, y0 - fwd * k, z0)):
            prof = [(0.0, 0.0), (0.030 * k, 0.003 * k), (0.038 * k, 0.014 * k), (0.032 * k, 0.026 * k), (0.018 * k, 0.034 * k), (0.0, 0.036 * k)]
            kit.lathe(m, prof, 12, skin, thr=60.0, ellipse=(0.9, 1.5))


def head(m, skin, c, ax, ay, az, bow=0.0, turn=0.0, rows=34, cols=40):
    """A carved head: the skull, the jaw narrowing to the chin, the face's planes carved into its front (brow, deep
    sockets with the eyes under their lids, the nose's bridge, tip and wings, cheekbones, the lips, the chin), the ears.
    Bowed forward by `bow` radians, turned by `turn`. Returns its frame."""
    M = kit.T(*c) @ Matrix.Rotation(turn, 4, "Z") @ Matrix.Rotation(bow, 4, "X")
    # rows: up from under the chin to the crown, denser across the face
    vz = np.concatenate([np.linspace(-1.0, -0.78, 4, endpoint=False), np.linspace(-0.78, 0.45, 22, endpoint=False), np.linspace(0.45, 1.0, rows - 26)])
    phis = np.arccos(np.clip(vz, -1, 1))
    # columns: denser over the face (the front is -Y, theta = -pi/2)
    q = np.linspace(0, 1, cols, endpoint=False)
    thetas = -math.pi / 2 + 2 * math.pi * (q - 0.10 * np.sin(2 * math.pi * q))
    P = np.zeros((rows, cols, 3))
    for i, f in enumerate(phis):
        for j, t in enumerate(thetas):
            nx, ny, nz = math.sin(f) * math.cos(t), math.sin(f) * math.sin(t), math.cos(f)
            x, y, z = ax * nx, ay * ny, az * nz
            F = max(0.0, -ny) ** 1.2  # how much a point faces forward
            jaw = smooth(-0.015, -0.105, z)
            x *= 1 - 0.22 * jaw
            if y > 0:
                y *= 1.0 + 0.07 * smooth(-0.02, 0.06, z)
            else:
                y *= 1 - 0.06 * jaw
            u, v = x, z
            au = abs(u)
            d = 0.0
            d += 0.009 * gauss(u / 0.055) * gauss((v - 0.040) / 0.011) * F                  # brow ridge
            d -= 0.020 * gauss((au - 0.030) / 0.015) * gauss((v - 0.017) / 0.013) * F       # eye sockets
            d += 0.010 * gauss((au - 0.030) / 0.0090) * gauss((v - 0.013) / 0.0062) * F     # the eyes under their lids
            d -= 0.004 * gauss((au - 0.030) / 0.011) * gauss((v - 0.022) / 0.0025) * F      # the upper lids' crease
            d -= 0.003 * gauss((au - 0.030) / 0.010) * gauss((v - 0.006) / 0.0022) * F      # the lower lids' line
            d += 0.006 * gauss((au - 0.046) / 0.017) * gauss((v + 0.012) / 0.017) * F       # cheekbones
            d -= 0.004 * gauss((au - 0.034) / 0.012) * gauss((v + 0.040) / 0.015) * F       # under the cheekbones
            # the nose: bridge, a straight back to its tip, the wings and the cleft under it
            ridge = 0.005 + 0.019 * smooth(0.024, -0.026, v) * (1 - smooth(-0.028, -0.038, v))
            d += ridge * gauss(u / (0.0075 + 0.004 * smooth(0.0, -0.03, v))) * F
            d += 0.008 * gauss((au - 0.0125) / 0.0055) * gauss((v + 0.031) / 0.0055) * F    # the nostrils' wings
            d -= 0.003 * gauss(u / 0.004) * gauss((v + 0.042) / 0.005) * F                  # the groove over the lip
            d += 0.006 * gauss(u / 0.019) * gauss((v + 0.050) / 0.0055) * F                 # upper lip
            d += 0.0075 * gauss(u / 0.016) * gauss((v + 0.062) / 0.0055) * F                # lower lip
            d -= 0.0045 * gauss(u / 0.021) * gauss((v + 0.0565) / 0.0022) * F               # between the lips
            d -= 0.004 * gauss(u / 0.03) * gauss((v + 0.074) / 0.005) * F                   # under the lower lip
            d += 0.011 * gauss(u / 0.026) * gauss((v + 0.092) / 0.016) * F                  # chin
            S = abs(nx) ** 5 * max(0.0, 1 - abs(ny + 0.1) * 3)
            d += 0.013 * gauss((v - 0.004) / 0.028) * S                                     # the ears
            P[i, j] = (x + nx * d, y + ny * d, z + nz * d)
    ST = np.zeros((rows, cols + 1, 2))
    with m.at(M):
        kit.grid(m, P, ST, skin, closed=True, outfn=lambda i, j, cc: np.array(cc), thr=80.0)
    return M


def curls(m, skin, M, ax, ay, az, rows=16, cols=40, thick=0.034):
    """Curly hair over the crown, the back and the sides, from a hairline over the forehead to the nape: a shell over
    the head, lumpy with locks, thinning to the head at its edge."""
    P = np.zeros((rows, cols, 3))
    ts = np.linspace(0, 1, rows)
    thetas = [-math.pi / 2 + 2 * math.pi * j / cols for j in range(cols)]
    for j, t in enumerate(thetas):
        fwd = max(0.0, -math.sin(t))
        side = abs(math.cos(t))
        fmax = math.radians(40 + 72 * (1 - fwd) ** 1.3 + 10 * side * (1 - fwd))
        for i, u in enumerate(ts):
            f = fmax * u
            nx, ny, nz = math.sin(f) * math.cos(t), math.sin(f) * math.sin(t), math.cos(f)
            locks = (0.5 + 0.5 * math.sin(9 * t + 4 * f)) * (0.5 + 0.5 * math.sin(10 * f - 3 * t + 1.0))
            lump = (0.35 + 0.65 * locks ** 0.7) * min(1.0, f / 0.6 + 0.15)
            T = thick * lump * (1 - u ** 4) + 0.003 - 0.006 * u ** 8
            z = az * nz
            jaw = smooth(-0.015, -0.105, z)
            x = (ax * (1 - 0.22 * jaw) + T) * nx
            y = (ay * (1.0 + (0.07 * smooth(-0.02, 0.06, z) if ny > 0 else 0.0)) + T) * ny
            P[i, j] = (x, y, (az + T) * nz)
    ST = np.zeros((rows, cols + 1, 2))
    with m.at(M):
        kit.grid(m, P, ST, skin, closed=True, outfn=lambda i, j, c: np.array(c), thr=80.0)


def veil(m, skin, M, ax, ay, az, robe, z_sh, rows=16, cols=30):
    """A veil over the head and down onto the shoulders and the back, open round the face; its edges rolled."""
    open_half = math.radians(64)
    thetas = np.linspace(-math.pi / 2 + open_half, 3 * math.pi / 2 - open_half, cols)
    Mi = M.inverted()
    P = np.zeros((rows, cols, 3))
    split = 7
    for j, t in enumerate(thetas):
        edge = 1 - min(abs(t + math.pi / 2), abs(t - 3 * math.pi / 2)) / (math.pi - open_half)  # 1 at the opening
        for i in range(rows):
            if i < split:
                # over the head from the crown to the level of the ears, standing off it
                f = math.radians(92 * i / (split - 1))
                gap = 0.016
                P[i, j] = ((ax + gap) * 1.05 * math.sin(f) * math.cos(t), (ay + gap) * 1.04 * math.sin(f) * math.sin(t), (az + gap) * math.cos(f))
            else:
                # down onto the shoulders: from round the head to the robe's surface, a little off it, in soft folds
                w = (i - split + 1) / (rows - split)
                top = M @ Vector(((ax + 0.018) * 1.06 * math.cos(t), (ay + 0.018) * 1.05 * math.sin(t), -0.02))
                zz = z_sh - 0.24 * w * (1 - 0.6 * edge) - 0.04
                bot = Vector(robe.surface(zz, t, 0.012 + 0.010 * math.sin(7 * t) ** 2))
                g = top.lerp(bot, smooth(0.0, 1.0, w) ** 0.8)
                P[i, j] = Mi @ g
    ST = np.zeros((rows, cols, 2))

    def away(c):
        # out from the head's middle
        return np.array(c) - np.array((0, 0, -0.03))

    with m.at(M):
        kit.grid(m, P, ST, skin, outfn=lambda i, j, c: away(c), thr=75.0)
        kit.grid(m, P * np.array((0.985, 0.985, 0.995)), ST, skin, outfn=lambda i, j, c: -away(c), shade=0.55, thr=75.0)
        for col in (0, cols - 1):
            kit.sweep(m, [tuple(p) for p in P[:, col]], 0.0065, 6, skin, up=(0, 0, 1), thr=75.0)
        kit.sweep(m, [tuple(p) for p in P[-1]], 0.0065, 6, skin, up=(0, 0, 1), thr=75.0)


def arm(m, skin, ctrl, radii, sides=12):
    """A sleeved arm along control points from the shoulder to the wrist: the sleeve flares toward the cuff, which is
    turned back in a thick rim, its opening dark inside."""
    path = spline(ctrl, 14)
    r = np.interp(np.linspace(0, 1, 14), np.linspace(0, 1, len(radii)), radii)
    kit.sweep(m, path, r, sides, skin, thr=75.0, caps=(True, False),
              bumps=lambda s, a: 1.0 + 0.07 * math.sin(4 * a + s * 16) * min(1.0, s / 0.15))
    d = unit(path[-1] - path[-2])
    Tn, N, B = kit.frames(path)
    ring = [tuple(path[-1] - d * 0.006 + (math.cos(a) * N[-1] + math.sin(a) * B[-1]) * r[-1] * 1.03) for a in np.linspace(0, 2 * math.pi, 17)]
    kit.sweep(m, ring, 0.011, 6, skin, up=tuple(d), thr=75.0)
    inner = [path[-1] + (math.cos(a) * N[-1] + math.sin(a) * B[-1]) * r[-1] * 0.97 for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    kit.cap(m, [m.vid(p) for p in inner], inner, skin, out=tuple(d), shade=0.30)
    return path


def hand(m, skin, wrist, fwd, back, thumb_side, curl=0.35, k=1.0):
    """A hand from the wrist: the palm a rounded block, four fingers close together and a thumb, curled `curl`."""
    f = unit(fwd)
    b = np.asarray(back, float)
    b = unit(b - f * (b @ f))
    s = np.cross(f, b) * thumb_side
    W = np.asarray(wrist, float)
    kit.sweep(m, [tuple(W - f * 0.05 * k), tuple(W + f * 0.015 * k)], [0.024 * k, 0.027 * k], 10, skin, thr=75.0)
    R = Matrix(((f[0], s[0], b[0], 0), (f[1], s[1], b[1], 0), (f[2], s[2], b[2], 0), (0, 0, 0, 1)))
    with m.at(kit.T(*W) @ R):
        # palm: along local x, across local y (thumb side +y), its back +z
        kit.cbox(m, np.array((0.0, -0.037 * k, -0.012 * k)), np.array((0.082 * k, 0.037 * k, 0.012 * k)), skin, c=0.010 * k, thr=65.0)
        for n, (yy, L) in enumerate(((-0.027, 0.060), (-0.009, 0.074), (0.009, 0.070), (0.027, 0.056))):
            pts = [np.array((0.076 * k, yy * k, 0.0))]
            seg = L * k / 3
            bend = 0.0
            for _ in range(3):
                bend += curl * 0.6
                pts.append(pts[-1] + np.array((math.cos(bend), 0.0, -math.sin(bend))) * seg)
            kit.sweep(m, [tuple(p) for p in pts], [0.0102 * k, 0.0095 * k, 0.0086 * k, 0.0078 * k], 6, skin, up=(0, 0, 1), thr=75.0,
                      caps=(False, True))
        th = [np.array((0.018 * k, 0.030 * k, -0.004 * k)), np.array((0.042 * k, 0.050 * k, -0.010 * k)), np.array((0.066 * k, 0.057 * k, -0.016 * k - curl * 0.01))]
        kit.sweep(m, [tuple(p) for p in th], [0.0125 * k, 0.011 * k, 0.0092 * k], 6, skin, up=(0, 0, 1), thr=75.0, caps=(False, True))


def wing(m, skin, root, side, k=1.0, na=30, nb=14):
    """A wing raised behind the shoulder and folded: its leading edge rises from the shoulder blade over the shoulder
    to the wrist and sweeps down behind to the long flight feathers' tips; the inner edge runs from the shoulder blade
    down to the same tips. A solid carved slab, thick at its leading edge, its outer face stepped in three rows of
    feathers (the small coverts at the edge, the coverts, the long flight feathers), each feather's tip rounded and the
    trailing edge scalloped by them."""
    R = np.asarray(root, float)
    s = side
    lead = spline([R, R + np.array((s * 0.11, 0.07, 0.17)) * k, R + np.array((s * 0.20, 0.15, 0.33)) * k,
                   R + np.array((s * 0.25, 0.26, 0.36)) * k, R + np.array((s * 0.27, 0.36, 0.18)) * k,
                   R + np.array((s * 0.25, 0.45, -0.18)) * k, R + np.array((s * 0.21, 0.52, -0.52)) * k], na)
    trail = spline([R + np.array((0.0, 0.03, -0.02)) * k, R + np.array((s * 0.04, 0.12, -0.12)) * k, R + np.array((s * 0.09, 0.24, -0.26)) * k,
                    R + np.array((s * 0.14, 0.36, -0.40)) * k, R + np.array((s * 0.18, 0.46, -0.50)) * k, R + np.array((s * 0.21, 0.52, -0.52)) * k], na)
    out = unit((s * 0.92, -0.20, 0.12))  # the outer face's side
    feathers = 9  # flight feathers along the span
    P = np.zeros((na, 2 * nb, 3))
    for i in range(na):
        a = i / (na - 1)
        L, T = lead[i], trail[i]
        chord = T - L
        # the flight feathers' tips scallop the trailing edge
        tipf = (a * feathers) % 1.0
        T = T + chord * 0.06 * (math.sin(math.pi * tipf) - 0.5) * smooth(0.15, 0.3, a)
        for j in range(nb):
            bq = j / (nb - 1)
            base = L + (T - L) * bq
            th = (0.040 * (1 - bq) ** 1.5 + 0.008) * k * (1 - 0.6 * a ** 3)
            # the rows of feathers: each overlaps the next, its edge a step down
            band = 0.0
            for b0, b1, step in ((0.0, 0.22, 0.010), (0.22, 0.50, 0.012), (0.50, 1.0, 0.010)):
                if b0 <= bq <= b1:
                    band = step * (1 - (bq - b0) / (b1 - b0)) ** 0.7
            # between the flight feathers a groove along them
            groove = 0.005 * abs(math.sin(math.pi * a * feathers)) ** 0.3 * smooth(0.45, 0.6, bq)
            sh = band - groove
            P[i, j] = base + out * (th * 0.5 + sh * k)
            P[i, 2 * nb - 1 - j] = base - out * th * 0.5
    ST = np.zeros((na, 2 * nb + 1, 2))
    mid = (lead + trail) / 2

    def outfn(i, j, c):
        # the outer face's columns out to the side, the inner face's in; round the edges by the centre line
        return (out if j < nb - 1 else -out if nb - 1 < j < 2 * nb - 1 else 0.0) + 2.0 * (c - (mid[i] + mid[min(i + 1, na - 1)]) / 2)

    ids = kit.grid(m, P, ST, skin, closed=True, outfn=outfn, thr=70.0)
    kit.cap(m, ids[0], P[0], skin, out=tuple(-unit(lead[1] - lead[0])), shade=0.8)


# ------------------------------------------------------------------ the two figures


def angel(A):
    C = cells(A)
    skin = Carve(C["oak"])
    m = kit.Mesh("confessional_angel")
    socle(m, skin)
    z0 = 0.055

    def folds(z, t):
        A_ = 0.040 * (1 - smooth(0.0, 0.85, z)) + 0.016 * smooth(0.40, 0.70, z) * (1 - smooth(0.88, 0.97, z)) \
            + 0.007 * smooth(0.98, 1.08, z) * (1 - smooth(1.22, 1.32, z))
        g = 0.5 * math.sin(8 * t + 0.7 * z + 0.3) + 0.3 * math.sin(13 * t - 1.4 * z + 1.1) + 0.2 * math.sin(5 * t + 2.2 * z)
        d = A_ * math.copysign(abs(g) ** 0.5, g)
        # the right knee forward under the robe (the weight on the left leg)
        d += 0.032 * gauss((z - 0.50) / 0.11) * gauss((t + math.pi / 2 - 0.42) / 0.42)
        return d

    S = [(z0 + 0.00, 0.258, 0.198, -0.012, 2.0), (z0 + 0.06, 0.246, 0.182, -0.010, 2.0), (z0 + 0.25, 0.216, 0.152, 0.0, 2.1),
         (z0 + 0.48, 0.192, 0.132, 0.0, 2.2), (z0 + 0.72, 0.174, 0.120, 0.0, 2.2), (z0 + 0.95, 0.152, 0.106, 0.0, 2.3),
         (z0 + 1.08, 0.162, 0.112, -0.006, 2.4), (z0 + 1.20, 0.180, 0.118, -0.010, 2.5), (z0 + 1.30, 0.196, 0.112, -0.004, 2.7),
         (z0 + 1.36, 0.200, 0.104, 0.004, 2.9), (z0 + 1.40, 0.188, 0.096, 0.006, 2.8), (z0 + 1.43, 0.128, 0.076, 0.006, 2.4),
         (z0 + 1.45, 0.062, 0.054, 0.004, 2.1), (z0 + 1.455, 0.050, 0.046, 0.004, 2.0)]
    robe = Robe(m, skin, z0, S, folds)
    girdle(m, skin, robe, z0 + 0.95, -math.pi / 2 + 0.55)
    feet(m, skin, -0.205, z0)
    kit.lathe(m, [(0.050, z0 + 1.44), (0.047, z0 + 1.47), (0.048, z0 + 1.50)], 14, skin, thr=60.0)
    hc = (0.0, -0.012, z0 + 1.585)
    ax, ay, az = 0.082, 0.100, 0.115
    M = head(m, skin, hc, ax, ay, az, bow=math.radians(7), turn=math.radians(-10))
    curls(m, skin, M, ax, ay, az)
    # the right hand on its breast; the left arm turned out, palm up, toward the penitents' places
    arm(m, skin, [(0.170, 0.008, z0 + 1.36), (0.212, -0.008, z0 + 1.18), (0.205, -0.045, z0 + 1.05), (0.11, -0.13, z0 + 1.12), (0.040, -0.150, z0 + 1.19)],
        [0.056, 0.050, 0.052, 0.064, 0.072])
    hand(m, skin, (0.026, -0.157, z0 + 1.205), fwd=(-0.78, 0.05, 0.60), back=(0.0, -1.0, 0.1), thumb_side=-1.0, curl=0.12)
    arm(m, skin, [(-0.170, 0.008, z0 + 1.36), (-0.222, -0.005, z0 + 1.17), (-0.238, -0.045, z0 + 1.03), (-0.272, -0.150, z0 + 0.96), (-0.292, -0.215, z0 + 0.93)],
        [0.056, 0.050, 0.052, 0.062, 0.070])
    hand(m, skin, (-0.298, -0.236, z0 + 0.925), fwd=(-0.30, -0.80, -0.22), back=(0.10, 0.10, -1.0), thumb_side=-1.0, curl=0.28)
    for side in (1.0, -1.0):
        wing(m, skin, (side * 0.080, 0.075, z0 + 1.28), side)
    return m


def saint(A):
    C = cells(A)
    skin = Carve(C["oak"])
    m = kit.Mesh("confessional_saint")
    k = 0.885  # her size against the angel's
    socle(m, skin, r=0.19)
    z0 = 0.055

    def folds(z, t):
        z = z / k
        A_ = 0.034 * (1 - smooth(0.0, 0.85, z)) + 0.013 * smooth(0.45, 0.75, z) * (1 - smooth(0.90, 0.98, z))
        g = 0.55 * math.sin(9 * t - 0.6 * z + 1.7) + 0.30 * math.sin(14 * t + 1.3 * z + 0.4) + 0.15 * math.sin(4 * t - 2 * z)
        d = A_ * k * math.copysign(abs(g) ** 0.5, g)
        d += 0.026 * k * gauss((z - 0.50) / 0.11) * gauss((t + math.pi / 2 + 0.42) / 0.42)
        return d

    S0 = [(0.00, 0.244, 0.188, -0.012, 2.0), (0.06, 0.234, 0.174, -0.012, 2.0), (0.25, 0.206, 0.146, 0.0, 2.1),
          (0.48, 0.183, 0.127, 0.0, 2.2), (0.72, 0.166, 0.116, 0.0, 2.2), (0.95, 0.150, 0.105, 0.0, 2.3),
          (1.08, 0.158, 0.113, -0.010, 2.4), (1.20, 0.172, 0.118, -0.012, 2.5), (1.30, 0.186, 0.110, -0.004, 2.7),
          (1.36, 0.190, 0.102, 0.004, 2.9), (1.40, 0.178, 0.094, 0.006, 2.8), (1.43, 0.122, 0.074, 0.006, 2.4),
          (1.45, 0.058, 0.052, 0.004, 2.1), (1.455, 0.047, 0.044, 0.004, 2.0)]
    S = [(z0 + z * k, a * k, b * k, cy * k, p) for z, a, b, cy, p in S0]
    robe = Robe(m, skin, z0, S, folds)
    girdle(m, skin, robe, z0 + 0.95 * k, -math.pi / 2 - 0.55, hang=0.38)
    feet(m, skin, -0.198 * k, z0, k=k)
    kit.lathe(m, [(0.045, z0 + 1.44 * k), (0.042, z0 + 1.47 * k), (0.043, z0 + 1.50 * k)], 14, skin, thr=60.0)
    hc = (0.0, -0.030 * k, z0 + 1.575 * k)
    ax, ay, az = 0.076, 0.093, 0.108
    M = head(m, skin, hc, ax, ay, az, bow=math.radians(22), turn=math.radians(8))
    veil(m, skin, M, ax, ay, az, robe, z0 + 1.38 * k)
    # both hands crossed on her breast, the right over the left
    zc = z0 + 1.17 * k
    arm(m, skin, [(0.150 * k, 0.008, z0 + 1.35 * k), (0.192 * k, -0.010, z0 + 1.16 * k), (0.172 * k, -0.06 * k, z0 + 1.04 * k),
                  (0.08 * k, -0.125 * k, zc - 0.02), (0.028 * k, -0.140 * k, zc + 0.01)], np.array([0.050, 0.046, 0.048, 0.058, 0.064]) * k)
    hand(m, skin, (0.014 * k, -0.147 * k, zc + 0.02), fwd=(-0.70, -0.05, 0.70), back=(0.0, -1.0, 0.0), thumb_side=-1.0, curl=0.36, k=k)
    arm(m, skin, [(-0.150 * k, 0.008, z0 + 1.35 * k), (-0.192 * k, -0.010, z0 + 1.16 * k), (-0.172 * k, -0.05 * k, z0 + 1.04 * k),
                  (-0.08 * k, -0.110 * k, zc - 0.04), (-0.028 * k, -0.125 * k, zc - 0.015)], np.array([0.050, 0.046, 0.048, 0.058, 0.064]) * k)
    hand(m, skin, (-0.014 * k, -0.131 * k, zc - 0.005), fwd=(0.70, -0.05, 0.70), back=(0.0, -1.0, 0.0), thumb_side=1.0, curl=0.36, k=k)
    return m
