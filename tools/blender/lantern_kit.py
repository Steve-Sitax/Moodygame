"""The town's lamps and lanterns, one design for all of them (2026-10-11, Steve: "make sure other lamp designs are
all up to snuff and the light they give is all in a similar way").

Every model script that draws a lamp or a lantern builds it here and copies the faces into its own mesh with an
adapter of its own (its materials, its up axis, its shading): the street gas lamp (build_props.py gas_lamp), the
park's lamp posts (build_churches.py), the lantern posts at the quay steps (build_quayfurniture.py), the bracket
lanterns on the walls (build_wall.py, build_prison.py, build_streetlife.py), the oil lanterns of the landing stage
(build_ferry.py). One design, so a lantern looks the same wherever it hangs, and a change here changes them all.

No Blender in here: plain Python and numpy, so any script can import it. A model is a list of faces in its own frame,
metres, Z up: (points, uvs, role, shade, smooth). Role "iron" is the ironwork, "glass" a pane (its uv 0..1 over the
pane, v up, so the pane picture's burner stands at its foot), "brass" the burner seen through an open lantern (drawn
as iron where a script has no brass). Faces look outward (counter-clockwise seen from outside).

The kinds (each keeps its own character, all with the same ironwork, glass and burner):
- post(): the street gas lamp post (fluted column, ladder bar, a tapered lantern with frieze, roof, crown, finial).
  Smaller copies (`s`) are the park's posts and the quay steps' lantern posts.
- bracket(): a gas lantern hanging from a scrolled wall arm, by doors, gates and the wall's guard houses.
- hanging(): the same lantern on a hook alone (from a passage's vault, an arm a script draws itself).
- oil_lantern(): a square oil lantern with wire guards, a chimney and a bail ring (the landing stage, the boats, the
  doss house; carried in the hand at a smaller size).
paint_pane() paints the glass with the burner and its flame: the gas one a flat "batwing" flame over a burner pipe,
the oil one a taller flame over a wick and its font.
"""

import math

import numpy as np

# ------------------------------------------------------------------ a little geometry, no Blender


def _mul(A, B):
    """3x4 affine matrices (rows), A after B."""
    out = []
    for i in range(3):
        row = []
        for j in range(4):
            v = sum(A[i][k] * B[k][j] for k in range(3))
            if j == 3:
                v += A[i][3]
            row.append(v)
        out.append(tuple(row))
    return tuple(out)


IDENT = ((1.0, 0.0, 0.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0))


def move(x, y, z):
    return ((1.0, 0.0, 0.0, x), (0.0, 1.0, 0.0, y), (0.0, 0.0, 1.0, z))


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return ((c, -s, 0.0, 0.0), (s, c, 0.0, 0.0), (0.0, 0.0, 1.0, 0.0))


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return ((1.0, 0.0, 0.0, 0.0), (0.0, c, -s, 0.0), (0.0, s, c, 0.0))


def scale(k):
    return ((k, 0.0, 0.0, 0.0), (0.0, k, 0.0, 0.0), (0.0, 0.0, k, 0.0))


def apply(M, p):
    x, y, z = p
    return (M[0][0] * x + M[0][1] * y + M[0][2] * z + M[0][3], M[1][0] * x + M[1][1] * y + M[1][2] * z + M[1][3],
            M[2][0] * x + M[2][1] * y + M[2][2] * z + M[2][3])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mulk(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _len(a):
    return math.sqrt(_dot(a, a))


def _norm(a):
    n = _len(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 1.0)


def _newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n[0] += (a[1] - b[1]) * (a[2] + b[2])
        n[1] += (a[2] - b[2]) * (a[0] + b[0])
        n[2] += (a[0] - b[0]) * (a[1] + b[1])
    return tuple(n)


class Kit:
    """Faces in a model's own frame (metres, Z up)."""

    def __init__(self):
        self.faces = []
        self.xf = IDENT
        self.band = 0  # (smooth faces of one band of a turned shape share their normals: a number per band)

    def at(self, M):
        kit = self

        class _At:
            def __enter__(self):
                self.old = kit.xf
                kit.xf = _mul(kit.xf, M)

            def __exit__(self, *a):
                kit.xf = self.old

        return _At()

    def face(self, pts, uvs, role, shade=1.0, smooth=False):
        pts = [apply(self.xf, p) for p in pts]
        self.faces.append((pts, list(uvs), role, shade, smooth))

    def poly(self, pts, role, out=None, shade=1.0, fit=False):
        """A flat face from local points, turned to look along `out` (local) if given. fit: uv 0..1 over it, v up."""
        pts = [tuple(p) for p in pts]
        n = _newell(pts)
        if out is not None and _dot(n, out) < 0:
            pts = pts[::-1]
            n = _mulk(n, -1)
        n = _norm(n)
        if abs(n[2]) < 0.7:
            va = _norm(_sub((0, 0, 1), _mulk(n, n[2])))
        else:
            e = max((_sub(pts[(i + 1) % len(pts)], pts[i]) for i in range(len(pts))), key=_len)
            va = _norm(_cross(n, _norm(_sub(e, _mulk(n, _dot(e, n))))))
        ua = _cross(va, n)
        c = [(_dot(p, ua), _dot(p, va)) for p in pts]
        if fit:
            u0, u1 = min(a for a, _ in c), max(a for a, _ in c)
            v0, v1 = min(b for _, b in c), max(b for _, b in c)
            uvs = [((a - u0) / max(u1 - u0, 1e-6), (b - v0) / max(v1 - v0, 1e-6)) for a, b in c]
        else:
            uvs = c
        self.face(pts, uvs, role, shade)

    def grid(self, rings, role, closed=True, smooth=True, shade=1.0, cap0=False, cap1=False, urep=1.0, vscale=1.0):
        """Quads between rings (the same count), each ring counter-clockwise about the way up: faces look out."""
        n = len(rings[0])
        vv = [0.0]
        for a, b in zip(rings, rings[1:]):
            vv.append(vv[-1] + sum(_len(_sub(b[i], a[i])) for i in range(n)) / n)
        for j in range(len(rings) - 1):
            # each band round the shape smooth on its own: round, its edges (a moulding's) sharp
            self.band += 1
            sm = self.band if smooth else False
            for i in range(n if closed else n - 1):
                i1 = (i + 1) % n
                pts = [rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]
                u0, u1 = i / n * urep, (i + 1) / n * urep
                self.face(pts, [(u0, vv[j] * vscale), (u1, vv[j] * vscale), (u1, vv[j + 1] * vscale), (u0, vv[j + 1] * vscale)], role,
                          shade, sm)
        if cap0:
            c0 = _mulk(tuple(map(sum, zip(*rings[0]))), 1 / n)
            c1 = _mulk(tuple(map(sum, zip(*rings[1]))), 1 / n)
            self.poly(rings[0], role, out=_sub(c0, c1), shade=shade)
        if cap1:
            c0 = _mulk(tuple(map(sum, zip(*rings[-1]))), 1 / n)
            c1 = _mulk(tuple(map(sum, zip(*rings[-2]))), 1 / n)
            self.poly(rings[-1], role, out=_sub(c0, c1), shade=shade)

    def lathe(self, prof, sides, role, rot=0.0, **kw):
        """Turned about +Z: the profile (r, z) bottom to top."""
        rings = [[(r * math.cos(rot + 2 * math.pi * i / sides), r * math.sin(rot + 2 * math.pi * i / sides), z) for i in range(sides)]
                 for r, z in prof]
        self.grid(rings, role, **kw)

    def square(self, prof, role, **kw):
        """A square turned shape: the profile (half-width, z), its sides facing x and y."""
        self.lathe([(h * math.sqrt(2), z) for h, z in prof], 4, role, rot=math.pi / 4, smooth=False, **kw)

    def tube(self, path, r, sides, role, side=(1, 0, 0), rot=0.0, closed_path=False, cap0=False, cap1=False, shade=1.0):
        """A bar along a path, round (sides 6) or square (sides 4)."""
        N = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed_path:
                t = _sub(path[(k + 1) % N], path[(k - 1) % N])
            else:
                t = _sub(path[min(k + 1, N - 1)], path[max(k - 1, 0)])
            t = _norm(t)
            s = _sub(side, _mulk(t, _dot(side, t)))
            if _len(s) < 1e-4:
                s = (0.0, 0.0, 1.0) if abs(t[2]) < 0.9 else (1.0, 0.0, 0.0)
                s = _sub(s, _mulk(t, _dot(s, t)))
            s = _norm(s)
            b = _cross(t, s)
            rr = r[k] if isinstance(r, (list, tuple)) else r
            rings.append([_add(p, _add(_mulk(s, rr * math.cos(rot + 2 * math.pi * i / sides)), _mulk(b, rr * math.sin(rot + 2 * math.pi * i / sides))))
                          for i in range(sides)])
        if closed_path:
            rings.append(rings[0])
        self.grid(rings, role, smooth=sides >= 6, shade=shade, cap0=cap0 and not closed_path, cap1=cap1 and not closed_path)

    def beam(self, a, b, w, h, role, side=None, shade=1.0):
        """A square-cut bar from a to b: w across (along `side`, else level), h the other way."""
        t = _norm(_sub(b, a))
        s = side if side is not None else _cross((0, 0, 1), t)
        if _len(s) < 1e-4:
            s = (1.0, 0.0, 0.0)
        s = _norm(_sub(s, _mulk(t, _dot(s, t))))
        k = _cross(s, t)
        P = []
        for i in range(8):
            base = b if i & 2 else a
            P.append(_add(base, _add(_mulk(s, w / 2 if i & 1 else -w / 2), _mulk(k, h / 2 if i & 4 else -h / 2))))
        c = _mulk(_add(a, b), 0.5)
        for idx in ((0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5), (0, 2, 3, 1), (4, 5, 7, 6)):
            pts = [P[i] for i in idx]
            fc = _mulk(tuple(map(sum, zip(*pts))), 0.25)
            self.poly(pts, role, out=_sub(fc, c), shade=shade)

    def box(self, c, size, role, shade=1.0):
        cx, cy, cz = c
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        self.beam((cx, cy, cz - sz), (cx, cy, cz + sz), 2 * sx, 2 * sy, role, side=(1, 0, 0), shade=shade)


# ------------------------------------------------------------------ the parts

# How round (2026-10-11, Steve: "always make things high detail and good looking"): sides of the turned parts, the
# column and its mouldings, the middling ones (knobs, the neck), the small ones (balls, finials), the bars (round iron);
# the foot stays eight-sided, as cast.
ROUND, MID, SMALL, TUBE, FOOT = 32, 16, 12, 8, 8


def head(k, s=1.0, top="finial", foot="cup", glass_w=(0.12, 0.2), glass_h=0.58, inside=False):
    """The lantern of the gas lamps: four tapered panes in an iron frame (corner posts, a sill), a frieze band, an
    overhanging pyramid roof with corner knobs, a vented crown, and on top a finial ("finial") or a ring to hang it by
    ("ring"). Under it a cup ("cup", standing on a post), a drop knob ("drop", hanging) or nothing. From the foot of the
    glass at z 0. Hollow (2026-10-11, Steve: "hollow and 1 light in 3d"): a floor and a sooty ceiling close it inside,
    and inside=True puts the burner in (gas_burner: a brass pipe, its tip and one flame), for a lantern drawn with clear
    glass; a script that draws the glass solid (frosted) leaves it out. Returns (the glass's centre z, the top z, the
    foot z)."""
    b0, b1 = glass_w[0] * s, glass_w[1] * s
    z0, z1 = 0.0, glass_h * s
    for i, (a, b) in enumerate((((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1)))):
        pa, pb = (a[0] * b0, a[1] * b0, z0), (b[0] * b0, b[1] * b0, z0)
        pc, pd = (b[0] * b1, b[1] * b1, z1), (a[0] * b1, a[1] * b1, z1)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)
        k.poly([pa, pb, pc, pd], "glass", out=mid, fit=True)
        k.beam((pa[0], pa[1], z0 - 0.01 * s), (pd[0], pd[1], z1 + 0.01 * s), 0.026 * s, 0.026 * s, "iron")
        # (the sill a little inside the corner posts' faces, so no two faces share a plane)
        ins = (-mid[0] * 0.006 * s, -mid[1] * 0.006 * s, 0)
        k.beam(_add((pa[0], pa[1], z0 + 0.008 * s), ins), _add((pb[0], pb[1], z0 + 0.008 * s), ins), 0.02 * s, 0.03 * s, "iron")
    # the ceiling inside, under the frieze (seen through the glass), sooty
    k.poly([(-b1, -b1, z1 - 0.012 * s), (b1, -b1, z1 - 0.012 * s), (b1, b1, z1 - 0.012 * s), (-b1, b1, z1 - 0.012 * s)], "iron",
           out=(0, 0, -1), shade=0.3)
    if inside:
        gas_burner(k, s)
    # the frieze over the panes, the eave and the roof in one square profile
    k.square([(b1, z1 - 0.012 * s), (0.218 * s, z1 - 0.012 * s), (0.218 * s, z1 + 0.055 * s), (0.272 * s, z1 + 0.075 * s),
              (0.272 * s, z1 + 0.1 * s), (0.2 * s, z1 + 0.16 * s), (0.07 * s, z1 + 0.29 * s)], "iron", urep=1, vscale=0.6)
    for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        with k.at(move(cx * 0.262 * s, cy * 0.262 * s, z1 + 0.1 * s)):
            k.lathe([(0.018 * s, 0.0), (0.018 * s, 0.014 * s), (0.01 * s, 0.035 * s), (0.004 * s, 0.06 * s)], MID, "iron",
                    cap1=True)
    zc = z1 + 0.29 * s
    k.square([(0.07 * s, zc - 0.02 * s), (0.07 * s, zc + 0.02 * s), (0.058 * s, zc + 0.03 * s), (0.058 * s, zc + 0.08 * s),
              (0.095 * s, zc + 0.09 * s), (0.095 * s, zc + 0.11 * s), (0.03 * s, zc + 0.15 * s)], "iron", urep=1)
    for i in range(4):
        a = i * math.pi / 2
        ox, oy = math.cos(a), math.sin(a)
        k.box((ox * 0.059 * s, oy * 0.059 * s, zc + 0.055 * s), ((0.012 + 0.03 * abs(oy)) * s, (0.012 + 0.03 * abs(ox)) * s, 0.035 * s),
              "iron", shade=0.35)
    if top == "finial":
        k.lathe([(0.022 * s, zc + 0.15 * s), (0.034 * s, zc + 0.17 * s), (0.036 * s, zc + 0.19 * s), (0.022 * s, zc + 0.215 * s),
                 (0.012 * s, zc + 0.24 * s), (0.018 * s, zc + 0.255 * s), (0.004 * s, zc + 0.33 * s)], SMALL, "iron", cap1=True)
        ztop = zc + 0.33 * s
    else:
        k.lathe([(0.022 * s, zc + 0.15 * s), (0.03 * s, zc + 0.17 * s), (0.012 * s, zc + 0.19 * s)], SMALL, "iron", cap1=True)
        r = 0.04 * s
        ring = [(r * math.cos(2 * math.pi * i / 8), 0.0, zc + 0.19 * s + r + r * math.sin(2 * math.pi * i / 8)) for i in range(8)]
        k.tube(ring, 0.008 * s, TUBE, "iron", side=(0, 1, 0), closed_path=True)
        ztop = zc + 0.19 * s + 2 * r
    if foot == "cup":
        k.square([(0.045 * s, -0.17 * s), (0.064 * s, -0.14 * s), (0.1 * s, -0.08 * s), (0.125 * s, -0.03 * s), (0.135 * s, -0.015 * s),
                  (b0, 0.0)], "iron", cap1=True)
        zfoot = -0.17 * s
    elif foot == "drop":
        k.square([(b0 * 0.6, -0.04 * s), (b0 + 0.01 * s, -0.012 * s), (b0, 0.0)], "iron", cap0=True, cap1=True)
        k.lathe([(0.03 * s, -0.04 * s), (0.034 * s, -0.06 * s), (0.02 * s, -0.085 * s), (0.004 * s, -0.11 * s)], SMALL, "iron",
                cap1=True)
        zfoot = -0.11 * s
    else:
        k.square([(b0, 0.0), (b0 + 0.008 * s, -0.012 * s), (b0 + 0.008 * s, -0.02 * s)], "iron", cap1=True)
        zfoot = -0.02 * s
    return z1 / 2, ztop, zfoot


def gas_burner(k, s=1.0):
    """The burner inside a gas lantern, standing on its floor at z 0: a brass pipe, the burner's tip and one flame (a
    soft round flame that looks the same from every side: "flame", drawn bright and lit with the lamp)."""
    k.lathe([(0.013 * s, 0.0), (0.013 * s, 0.15 * s), (0.02 * s, 0.17 * s), (0.02 * s, 0.185 * s), (0.011 * s, 0.2 * s)], SMALL, "brass",
            cap1=True)
    k.lathe([(0.003 * s, 0.198 * s), (0.026 * s, 0.222 * s), (0.034 * s, 0.25 * s), (0.028 * s, 0.28 * s), (0.012 * s, 0.305 * s),
             (0.002 * s, 0.318 * s)], SMALL, "flame", cap0=True, cap1=True)


def oil_burner(k, q, h, z0):
    """The lamp inside an oil lantern on its floor at z0: a brass font, the wick's holder and one flame."""
    hk = h / 0.4
    k.lathe([(0.5 * q, z0), (0.58 * q, z0 + 0.025 * hk), (0.5 * q, z0 + 0.05 * hk), (0.2 * q, z0 + 0.065 * hk)], SMALL, "brass", cap1=True)
    k.lathe([(0.1 * q, z0 + 0.065 * hk), (0.1 * q, z0 + 0.09 * hk)], SMALL, "brass", cap1=True)
    k.lathe([(0.004 * q, z0 + 0.088 * hk), (0.09 * q, z0 + 0.11 * hk), (0.11 * q, z0 + 0.14 * hk), (0.07 * q, z0 + 0.175 * hk),
             (0.006 * q, z0 + 0.2 * hk)], SMALL, "flame", cap0=True, cap1=True)


def post(k, s=1.0, column=1.72, flutes=20, inside=False):
    """The street gas lamp post: foot, pedestal, fluted column, capital, the ladder bar on its braces, the neck, the cup
    and the lantern. s scales the whole; `column` the fluted length (at s 1: 1.72 m, the lantern's glass from 3.36 m).
    Returns the glass's centre (0, 0, z)."""
    S = s
    with k.at(scale(S)):
        k.lathe([(0.25, 0.0), (0.25, 0.06), (0.225, 0.07)], FOOT, "iron", rot=math.pi / 8, smooth=False, urep=2, vscale=0.5)
        k.lathe([(0.225, 0.07), (0.225, 0.125), (0.195, 0.14)], FOOT, "iron", rot=math.pi / 8, smooth=False, urep=2, vscale=0.5)
        k.lathe([(0.195, 0.14), (0.185, 0.17), (0.185, 0.21), (0.16, 0.25)], ROUND, "iron", urep=3, vscale=0.5)
        k.lathe([(0.16, 0.25), (0.14, 0.3), (0.132, 0.36), (0.13, 0.7), (0.135, 0.72)], ROUND, "iron", urep=3, vscale=0.5)
        k.lathe([(0.135, 0.72), (0.155, 0.74), (0.155, 0.79), (0.13, 0.81)], ROUND, "iron", urep=3, vscale=0.5)
        k.lathe([(0.13, 0.81), (0.105, 0.86), (0.092, 0.93), (0.092, 0.97), (0.082, 1.0)], ROUND, "iron", urep=3, vscale=0.5)
        k.lathe([(0.082, 1.0), (0.092, 1.02), (0.092, 1.06), (0.076, 1.08)], ROUND, "iron", urep=3, vscale=0.5)
        z_lo = 1.08
        z_hi = z_lo + column / S
        # (each flute a round groove between two fillets: four points a flute, smooth)
        n = 4 * flutes
        dip = (1.0, 0.93, 0.88, 0.93)
        rings = []
        for z, r in ((z_lo, 0.074), ((z_lo + z_hi) / 2, 0.067), (z_hi, 0.06)):
            rings.append([(r * dip[i % 4] * math.cos(2 * math.pi * i / n), r * dip[i % 4] * math.sin(2 * math.pi * i / n), z) for i in range(n)])
        k.grid(rings, "iron", smooth=True, urep=4, vscale=0.5)
        with k.at(move(0, 0, z_hi - 2.8)):
            k.lathe([(0.06, 2.8), (0.078, 2.82), (0.078, 2.86), (0.062, 2.88)], ROUND, "iron", urep=3, vscale=0.5)
            k.lathe([(0.062, 2.88), (0.07, 2.92), (0.098, 2.97), (0.105, 2.99), (0.105, 3.02), (0.07, 3.04)], ROUND, "iron", urep=3,
                    vscale=0.5)
            zb = 3.06
            k.lathe([(0.07, 3.04), (0.06, 3.06), (0.058, 3.17), (0.075, 3.19)], MID, "iron", rot=math.pi / 8, urep=2)
            k.beam((-0.36, 0, zb), (0.36, 0, zb), 0.032, 0.032, "iron", side=(0, 0, 1))
            for sx in (-1, 1):
                with k.at(move(sx * 0.385, 0, zb)):
                    k.lathe([(0.012, -0.032), (0.026, -0.022), (0.034, 0.0), (0.026, 0.022), (0.012, 0.032)], SMALL, "iron", cap0=True,
                            cap1=True)
                k.tube([(sx * 0.055, 0, 2.9), (sx * 0.12, 0, 2.93), (sx * 0.19, 0, 2.99), (sx * 0.24, 0, zb - 0.015)], 0.011, TUBE, "iron",
                       side=(0, 1, 0), rot=math.pi / 4, cap0=True, cap1=True)
            # four scroll brackets from the neck to the lantern's corners
            for cx, cy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                d = _norm((cx, cy, 0))
                pts = [_add(_mulk(d, r), (0, 0, z)) for r, z in ((0.058, 3.12), (0.11, 3.13), (0.16, 3.2), (0.175, 3.29), (0.158, 3.345))]
                k.tube(pts, 0.01, TUBE, "iron", side=(0, 0, 1), rot=math.pi / 4, cap0=True, cap1=True)
            with k.at(move(0, 0, 3.36)):
                zg, _, _ = head(k, 1.0, top="finial", foot="cup", inside=inside)
            zglass = z_hi - 2.8 + 3.36 + zg
    return (0.0, 0.0, zglass * S)


def bracket(k, arm=0.5, s=0.62, drop=0.0, oil=None, plate=1.0, glass=(0.16, 0.16), inside=False):
    """A gas lantern on a wall arm: a backplate with a boss, the arm with a curl at its end and a knob, a scrolled
    stay under it, a hook, and the lantern (head at size s, a ring on top, a drop knob under) hanging from the hook.
    The wall lantern's panes stand straight (glass: its half-widths at the foot and the top at s 1; the post's taper).
    oil=(w, h): an oil lantern of that glass hangs there by its bail instead (a Madonna's, a pier's). plate scales the
    backplate (a lighter arm has a smaller one). Its frame: the wall's face at y 0 (out +y), the arm at z 0. Returns the
    glass's centre."""
    # the backplate and its boss
    # (its back 5 mm into the wall, the raised panel's back inside the plate: no face in another's plane)
    k.box((0, 0.01, -0.12 * plate), (0.14 * plate, 0.03, 0.36 * plate), "iron", shade=0.85)
    k.box((0, 0.033, -0.12 * plate), (0.09 * plate, 0.026, 0.28 * plate), "iron", shade=0.9)
    with k.at(_mul(move(0, 0.044, 0), rot_x(-math.pi / 2))):
        k.lathe([(0.045, 0.0), (0.045, 0.012), (0.03, 0.03), (0.022, 0.04)], MID, "iron", cap1=True)
    # the arm, its curl and knob
    tip = arm
    k.beam((0, 0.03, 0), (0, tip, 0), 0.032, 0.036, "iron", side=(1, 0, 0))
    curl = [(0, tip + 0.035 * math.sin(a), 0.035 - 0.035 * math.cos(a) + 0.0) for a in [i * math.pi / 5 for i in range(0, 9)]]
    k.tube(curl, 0.012, TUBE, "iron", side=(1, 0, 0), rot=math.pi / 4, cap1=True)
    with k.at(move(0, tip - 0.02, 0.018)):
        k.lathe([(0.012, 0.0), (0.02, 0.012), (0.012, 0.03), (0.004, 0.045)], SMALL, "iron", cap1=True)
    # the stay: a scroll from the plate's foot up under the arm, and a small curl inside
    st = []
    for i in range(9):
        t = i / 8
        st.append((0, 0.02 + (arm * 0.4) * math.sin(t * math.pi / 2), -0.3 + 0.28 * (1 - math.cos(t * math.pi / 2))))
    k.tube(st, 0.011, TUBE, "iron", side=(1, 0, 0), rot=math.pi / 4, cap0=True, cap1=True)
    c = (0, 0.02 + arm * 0.2, -0.13)
    sp = [(0, c[1] + 0.05 * math.cos(a) * (1 - a / 7), c[2] + 0.05 * math.sin(a) * (1 - a / 7)) for a in [i * 0.7 for i in range(9)]]
    k.tube(sp, 0.008, TUBE, "iron", side=(1, 0, 0), rot=math.pi / 4, cap0=True, cap1=True)
    # the hook, and the lantern on it
    hx = tip - 0.08
    k.tube([(0, hx, -0.018), (0, hx, -0.06)], 0.007, TUBE, "iron", cap0=True, cap1=True)
    if oil:
        top = oil_lantern(Kit(), *oil)
        z0 = -0.05 - drop - top
        with k.at(move(0, hx, z0)):
            oil_lantern(k, *oil, inside=inside)
        return (0.0, hx, z0)
    # (the head's ring top stands 0.19 s + 0.08 s over its crown; hang it so the ring meets the hook)
    zg = 0.58 * s / 2
    ztop = 0.58 * s + 0.29 * s + 0.19 * s + 0.08 * s
    z0 = -0.05 - drop - ztop
    with k.at(move(0, hx, z0)):
        head(k, s, top="ring", foot="drop", glass_w=glass, inside=inside)
    return (0.0, hx, z0 + zg)


def hanging(k, s=0.62, glass=(0.16, 0.16), inside=False):
    """The bracket's lantern alone, hanging from a hook at the origin (a passage's vault, an arm drawn elsewhere).
    Returns the glass's centre."""
    k.tube([(0, 0, 0.0), (0, 0, -0.05)], 0.007, TUBE, "iron", cap0=True, cap1=True)
    ztop = 0.58 * s + 0.29 * s + 0.19 * s + 0.08 * s
    z0 = -0.05 + 0.02 - ztop
    with k.at(move(0, 0, z0)):
        head(k, s, top="ring", foot="drop", glass_w=glass, inside=inside)
    return (0.0, 0.0, z0 + 0.58 * s / 2)


def oil_lantern(k, w=0.26, h=0.4, bail=True, inside=False):
    """A square oil lantern (a ship's or a pier's, at a smaller size the one carried in the hand): a base pan with a
    foot ring, four straight panes in corner posts, two wire guards across each pane, a sloped hood, a chimney with a
    cap and a bail ring. Its glass's centre at the origin; returns the top z."""
    q = w / 2
    z0, z1 = -h / 2, h / 2
    # the base: a pan and a foot ring
    # (hollow: its floor and its ceiling close it inside; inside=True its lamp stands on the floor)
    k.square([(q * 0.8, z0 - 0.07 * h / 0.4), (q + 0.02, z0 - 0.04 * h / 0.4), (q + 0.02, z0 - 0.005), (q, z0)], "iron", cap0=True, cap1=True)
    k.poly([(-q, -q, z1 - 0.004), (q, -q, z1 - 0.004), (q, q, z1 - 0.004), (-q, q, z1 - 0.004)], "iron", out=(0, 0, -1), shade=0.3)
    if inside:
        oil_burner(k, q, h, z0)
    for i, (a, b) in enumerate((((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1)))):
        pa, pb = (a[0] * q, a[1] * q, z0), (b[0] * q, b[1] * q, z0)
        pc, pd = (b[0] * q, b[1] * q, z1), (a[0] * q, a[1] * q, z1)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)
        k.poly([pa, pb, pc, pd], "glass", out=mid, fit=True)
        k.beam((pa[0], pa[1], z0 - 0.005), (pa[0], pa[1], z1 + 0.005), 0.022 * w / 0.26, 0.022 * w / 0.26, "iron")
        # two wire guards, a little off the glass
        o = (mid[0] * 0.012, mid[1] * 0.012, 0)
        for t in (0.33, 0.66):
            z = z0 + (z1 - z0) * t
            k.beam(_add((pa[0], pa[1], z), o), _add((pb[0], pb[1], z), o), 0.008, 0.008, "iron", side=(0, 0, 1))
    # the hood, the chimney and its cap
    k.square([(q, z1), (q + 0.025, z1 + 0.005), (q + 0.025, z1 + 0.025), (q * 0.45, z1 + 0.11 * h / 0.4), (q * 0.32, z1 + 0.12 * h / 0.4)],
             "iron")
    zc = z1 + 0.12 * h / 0.4
    k.lathe([(q * 0.32, zc), (q * 0.3, zc + 0.08 * h / 0.4), (q * 0.5, zc + 0.095 * h / 0.4), (q * 0.42, zc + 0.12 * h / 0.4),
             (q * 0.12, zc + 0.14 * h / 0.4)], SMALL, "iron", cap1=True)
    ztop = zc + 0.14 * h / 0.4
    if bail:
        # the bail: from two ears on the hood up over the chimney
        r = q * 0.78
        zh = z1 + 0.055 * h / 0.4
        ry = ztop - zh + 0.05
        for sx in (-1, 1):
            k.box((sx * r, 0, zh), (0.012, 0.02, 0.03), "iron")
        ring = [(r * math.cos(math.pi * i / 8), 0.0, zh + ry * math.sin(math.pi * i / 8)) for i in range(9)]
        k.tube(ring, 0.006, TUBE, "iron", side=(0, 1, 0), cap0=True, cap1=True)
        ztop = zh + ry
    return ztop


# ------------------------------------------------------------------ the glass


def _smooth_noise(rng, h, w, cells):
    """Soft value noise (bilinear between a coarse grid), 0..1."""
    g = rng.random((cells + 1, cells + 1))
    yy = np.linspace(0, cells, h)[:, None]
    xx = np.linspace(0, cells, w)[None, :]
    y0, x0 = np.floor(yy).astype(int).clip(0, cells - 1), np.floor(xx).astype(int).clip(0, cells - 1)
    fy, fx = yy - y0, xx - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a, b, c, d = g[y0, x0], g[y0, x0 + 1], g[y0 + 1, x0], g[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def paint_pane(n=128, base=(0.78, 0.68, 0.46), kind="gas", seed=9, frame=0.08, w=None, flame=1.0, burner=False):
    """A pane of lamp glass, n rows from its foot up (Blender's image order) by w columns (n if not given), clean and
    soft-edged (2026-10-11, Steve: "high detail and good looking", no pixel art): sooty toward the top in soft clouds, a
    thin frame, the burner dark at the foot and its flame brighter over it. The game tints the glass (the air's colour
    unlit, the flame's lit), so by day the burner shows through and at night the flame burns brightest in the middle.
    flame: how much brighter the flame is painted (a glass lit by the sun, not tinted by the game, wants little: it is
    no flame by day).
    burner=False (2026-10-11, Steve: "the lights themselves are 2d textures on every side ... or just blurred glass is
    also ok"): no burner and no flame painted at all, the glass frosted, a soft glow in its middle where the flame
    behind it would light it (flame: how much); a lantern drawn with clear glass has its one burner inside (gas_burner)
    and wants flame=0."""
    w = w or n
    rng = np.random.default_rng(seed)
    v = (np.arange(n)[:, None] + 0.5) / n  # 0 at the foot, 1 at the top
    u = (np.arange(w)[None, :] + 0.5) / w
    img = np.ones((n, w, 3)) * np.array(base, dtype=np.float64)
    soot = np.clip(v - 0.55, 0, 1) / 0.45
    img *= (1 - 0.42 * soot * (0.7 + 0.6 * _smooth_noise(rng, n, w, 5)))[..., None]
    img *= (0.94 + 0.12 * _smooth_noise(rng, n, w, 3))[..., None]
    # (shapes in pane units, edges softened over about a texel)
    px = 1.0 / min(n, w)
    soft = lambda d: np.clip(0.5 - d / (1.5 * px), 0, 1)  # noqa: E731  d < 0 inside
    du = np.abs(u - 0.5) * (w / n)  # across, in rows' units (a narrow pane keeps its shapes round)
    if not burner:
        g = np.exp(-(du / 0.26) ** 2 - ((v - 0.42) / 0.3) ** 2)
        img += g[..., None] * np.array((0.22, 0.19, 0.13)) * flame
        dark = np.zeros_like(g)
        shape = np.full_like(g, 9.0)
    elif kind == "gas":
        pipe = soft(np.maximum(du - 0.03, np.maximum(0.03 - v, v - 0.23)))
        tip = soft(np.maximum(du - 0.075, np.abs(v - 0.245) - 0.018))
        dark = np.maximum(pipe, tip)
        shape = (du / 0.17) ** 2 + ((v - 0.41) / 0.12) ** 2
    else:
        font = soft(np.maximum(du - 0.18, np.maximum(0.03 - v, v - 0.16)))
        holder = soft(np.maximum(du - 0.06, np.maximum(0.15 - v, v - 0.25)))
        dark = np.maximum(font, holder)
        shape = (du / 0.08) ** 2 + ((v - 0.39) / 0.14) ** 2
    img *= (1 - 0.7 * dark)[..., None]
    img += (np.clip(1.0 - shape, 0, 1) ** 0.8)[..., None] * np.array((0.3, 0.26, 0.18)) * flame
    # the frame: a thin dark border, soft inside
    edge = np.minimum(np.minimum(u, 1 - u) * (w / n), np.minimum(v, 1 - v))
    fr = np.clip(1 - (edge - 0.035) / (1.5 * px), 0, 1)
    img = img * (1 - fr[..., None]) + frame * fr[..., None]
    return np.clip(img, 0, 1)


def placed(faces, origin, out=(0.0, 1.0), yup=True):
    """A model's faces moved into a script's world: its origin at `origin`, its +y (out from a wall) along the
    horizontal `out` (x, z in a Y-up world; x, y in a Z-up one). A turn, never a mirror: the faces still look out."""
    ox, oz = out
    L = math.hypot(ox, oz) or 1.0
    ox, oz = ox / L, oz / L
    res = []
    for pts, uvs, role, shade, smooth in faces:
        q = []
        for x, y, z in pts:
            if yup:
                # kit z up -> world y; kit y -> (ox, 0, oz); kit x -> (-oz, 0, ox)
                q.append((origin[0] - x * oz + y * ox, origin[1] + z, origin[2] + x * ox + y * oz))
            else:
                # Z-up world: kit y -> (ox, oz, 0); kit x -> (oz, -ox, 0)
                q.append((origin[0] + x * oz + y * ox, origin[1] - x * ox + y * oz, origin[2] + z))
        res.append((q, uvs, role, shade, smooth))
    return res


def place_point(p, origin, out=(0.0, 1.0), yup=True):
    """Where a point of a model (a glass's centre) lands with placed()."""
    return placed([([p], [], "iron", 1.0, False)], origin, out, yup)[0][0][0]


def tris(model):
    """Triangles in a model (a quad counts two)."""
    return sum(len(p) - 2 for p, *_ in model)


def build(fn, *a, **kw):
    """Run a part into a new kit: (faces, its return value)."""
    k = Kit()
    r = fn(k, *a, **kw)
    return k.faces, r
