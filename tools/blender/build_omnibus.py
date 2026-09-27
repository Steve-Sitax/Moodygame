"""The horse omnibus of Antwerp, 1873, modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_omnibus.py
    blender -b --factory-startup -P tools/blender/build_omnibus.py -- --closeup side,box out_dir

Writes client/public/models/omnibus.glb (Draco): one node per part the game instances
(world/omnibus.ts), with the same origins and frame as the code-built parts there:

  omnibus_body          the body, box seat, platform, ladder, roof, springs, brake (solid)
  omnibus_paint         the panels that take the line's colour (instance colour times the picture)
  omnibus_interior      the saloon inside (drawn only near)
  omnibus_far_glass     dark glass in the windows and the doorway (drawn only far)
  omnibus_rear_wheels   the rear pair and their axle, origin on the axle
  omnibus_front_wheels  the front pair and their axle, origin on the axle
  omnibus_fore          the front carriage: fifth-wheel ring, springs, futchells, pole, bars, traces;
                        origin at the pivot on the ground

The body frame is the game's: +z forward, y up, origin on the ground under the rear axle. The
script builds everything in that frame and turns it into Blender's (x, -z, y) once, so the glTF
export (Y up) gives it back as it was. A knifeboard omnibus of the early 1870s, pair-horse: lined
panels with raised mouldings, the lower panels curving in toward the sill, a cream window band with
the droplights let down, the letter boards (drawn by the game), the knifeboard seat on the roof with
its foot boards and rail, iron steps to the roof, the conductor's platform, the driver's box,
carriage lamps, elliptic springs, the fifth wheel, spoked wheels with iron tyres and brass caps,
the pole, splinter bar, swingletrees, traces and pole chains.

Everything is our own work: the shapes are built from code, the pictures are painted by the
functions below (64 px cells in one 256 px atlas, nearest filter). No downloaded models or images.
Every face names a cell of the atlas (a second uv set "Cell", as props.glb's goods): one material,
so each part is one draw call for every omnibus. The vertex colour "Col" carries a baked shade.
"""

import math
import os
import random
import sys
from contextlib import contextmanager

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "omnibus.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

# ------------------------------------------------------------------ the game's numbers (world/omnibus.ts)

Z0, Z1, W = -1.05, 3.1, 1.72
HW = W / 2
FLOOR_Y, WIN_LO, WIN_HI, BOARD_Y, ROOF_Y, TOP = 0.83, 1.66, 2.24, 2.61, 2.78, 2.74
DOOR, DOOR_TOP = 0.3, 2.3
WINDOWS = [Z0 + 0.45 + i * 0.8 for i in range(5)]
WIN_W = 0.62
WHEELBASE, HORSES = 2.9, 3.1
R_REAR, R_FRONT = 0.62, 0.46
TRACK_R, TRACK_F = 1.98, 1.62
PLATFORM_Y = 0.74
LAMPS = [(-0.92, 2.0, Z1 + 0.11), (0.92, 2.0, Z1 + 0.11), (0.0, 2.3, Z1 - 0.24)]
# the seats: inside (x +-0.6, top FLOOR_Y + 0.43), the roof's knifeboard (x +-0.32, top ROOF_Y + 0.19)
SEAT_IN_Y = FLOOR_Y + 0.425
SEAT_IN_Z = [Z0 + 0.42 + i * 0.64 for i in range(6)]
SEAT_ROOF_Y = ROOF_Y + 0.19
# the driver stands on his footboard (feet y 1.445, z 3.35..3.6: the carter has no sit clip), his
# hips at the seat's front edge; the conductor stands on the platform at (0.5, 0.74, -1.5)
FOOT_Y = 1.445

# the body's own shape
SILL_Y = 0.78  # bottom of the body
WAIST_Y = 1.58  # the waist rail, under the window sills
BAND_TOP = 2.49  # the cream band, under the letter board
# the lower panels curve in toward the sill (tumblehome): half width at a height
PROFILE = [(0.78, 0.800), (0.90, 0.826), (1.05, 0.845), (1.25, 0.857), (1.45, 0.862), (WAIST_Y, 0.862)]
# over the front wheels the lower panels are cut up in an arch (the wheels turn under the body)
ARCH_C, ARCH_R, ARCH_TOP = WHEELBASE, 0.56, 1.0
WHEELHOUSE_X = 0.44


def side_x(y):
    if y <= PROFILE[0][0]:
        return PROFILE[0][1]
    for (y0, x0), (y1, x1) in zip(PROFILE, PROFILE[1:]):
        if y <= y1:
            return x0 + (x1 - x0) * (y - y0) / (y1 - y0)
    return HW + 0.002


def bottom_y(z):
    d = (z - ARCH_C) / ARCH_R
    if abs(d) >= 1:
        return SILL_Y
    return SILL_Y + (ARCH_TOP - SILL_Y) * math.sqrt(1 - d * d)


# ------------------------------------------------------------------ the atlas

S = 64
N = 4
CELLS = ["paint", "paint_dark", "cream", "varnish", "planks", "iron", "roof", "velvet",
         "leather", "straw", "brass", "wheel", "ceiling", "glass", "black", "strap"]
(PAINT, PAINT_DARK, CREAM, VARNISH, PLANKS, IRON, ROOF, VELVET,
 LEATHER, STRAW, BRASS, WHEEL, CEILING, GLASS, BLACK, STRAP) = range(len(CELLS))


def vnoise(rng, size, cu, cv):
    """Tileable value noise, cu cells across u and cv cells along v. Array [v, u]."""
    g = rng.random((cv, cu))

    def axis(n, c):
        t = np.arange(n) * c / n
        i0 = np.floor(t).astype(int) % c
        f = t - np.floor(t)
        return i0, (i0 + 1) % c, f * f * (3 - 2 * f)

    u0, u1, fu = axis(size, cu)
    v0, v1, fv = axis(size, cv)
    a = g[np.ix_(v0, u0)]
    b = g[np.ix_(v0, u1)]
    c = g[np.ix_(v1, u0)]
    d = g[np.ix_(v1, u1)]
    fu = fu[None, :]
    fv = fv[:, None]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def col(rgb):
    return np.array(rgb, dtype=np.float64)


def speckle(img, rng, amount, lo=0.6, hi=0.9):
    m = rng.random(img.shape[:2]) < amount
    img[m] *= rng.uniform(lo, hi, (int(m.sum()), 1))
    return img


def grain(rng, along_u=True, fine=24):
    g = vnoise(rng, S, 2, fine) * 0.55 + vnoise(rng, S, 4, fine * 2) * 0.45
    return g if along_u else g.T


def paint_panel(seed):
    """A painted panel as the coach painter left it: a smooth field, the lining-out inset from its
    mouldings (a fine light line with a dark one inside it), a little darker toward the sill. Fit to
    each panel; the game multiplies the line's colour into it."""
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.62, 0.60, 0.56))
    img *= (0.96 + 0.07 * (vnoise(rng, S, 4, 4) * 0.5 + vnoise(rng, S, 16, 16) * 0.5))[..., None]
    v = np.arange(S) / (S - 1)
    img *= (0.86 + 0.14 * np.clip(v * 2.2, 0, 1))[:, None, None]
    for inset, tone in ((4, 1.25), (5, 0.55)):
        a, b = inset, S - 1 - inset
        for r in (a, b):
            img[r, a + 1:b] *= tone
        for c in (a, b):
            img[a + 1:b, c] *= tone
    return speckle(img, rng, 0.015, 0.85, 0.95)


def paint_dark(seed):
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.40, 0.39, 0.37))
    img *= (0.94 + 0.1 * vnoise(rng, S, 8, 8))[..., None]
    return speckle(img, rng, 0.02, 0.8, 0.95)


def paint_cream(seed):
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.80, 0.74, 0.57))
    img *= (0.93 + 0.1 * grain(rng, True, 16))[..., None]
    img *= (0.97 + 0.05 * vnoise(rng, S, 6, 6))[..., None]
    return speckle(img, rng, 0.02, 0.8, 0.95)


def paint_varnish(seed):
    """Varnished teak: the frames, pillars, risers and the inside panelling."""
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.34, 0.20, 0.11))
    img *= (0.72 + 0.5 * grain(rng, True, 20))[..., None]
    # the varnish catches the light in long streaks
    img *= (1 + 0.12 * np.clip(vnoise(rng, S, 3, 1) - 0.5, 0, 1))[..., None]
    return speckle(img, rng, 0.03, 0.7, 0.9)


def paint_planks(seed):
    """Worn floor boards: four along u, seams and nails."""
    rng = np.random.default_rng(seed)
    img = np.zeros((S, S, 3))
    bh = S // 4
    for b in range(4):
        r0, r1 = b * bh, (b + 1) * bh
        img[r0:r1] = col((0.46, 0.37, 0.27)) * (1 + rng.uniform(-0.12, 0.12))
        img[r0] *= 0.42
        for rr in (r0 + 3, r1 - 3):
            u = int(rng.integers(0, S))
            img[rr, u] = (0.1, 0.09, 0.08)
    img *= (0.78 + 0.36 * grain(rng, True, 24))[..., None]
    return speckle(img, rng, 0.05)


def paint_iron(seed):
    """Iron painted black, worn to rust at the edges."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 6, 6) * 0.6 + vnoise(rng, S, 16, 16) * 0.4
    rust = np.clip((n - 0.64) * 4, 0, 1)[..., None]
    img = col((0.11, 0.11, 0.12)) * (1 - rust) + col((0.30, 0.18, 0.10)) * rust
    img *= (0.85 + 0.3 * vnoise(rng, S, 32, 32))[..., None]
    return speckle(img, rng, 0.06, 0.5, 0.8)


def paint_roof(seed):
    """The roof: painted canvas over boards, tar at the seams."""
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.31, 0.31, 0.30))
    weave = ((np.arange(S)[:, None] + np.arange(S)[None, :]) % 2) * 0.04
    img *= (0.9 + 0.16 * vnoise(rng, S, 8, 8) + weave)[..., None]
    for u in (0, 21, 42):
        img[:, u] *= 0.6
    return speckle(img, rng, 0.04, 0.6, 0.85)


def paint_velvet(seed):
    """Red plush, buttoned in diamonds: a button sunk at each point, the cloth puffed between."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    best = np.full((S, S), 1e9)
    for j in range(-1, 6):
        for i in range(-1, 6):
            cu = i * 16 + (8 if j % 2 else 0)
            cv = j * 16
            d = np.hypot(uu - cu, (vv - cv) * 1.0)
            best = np.minimum(best, d)
    puff = np.clip(best / 9.0, 0, 1)
    shade = 0.62 + 0.45 * np.sin(puff * math.pi / 2)
    img = col((0.50, 0.14, 0.13)) * shade[..., None]
    img[best < 1.3] = col((0.16, 0.05, 0.05))
    # the pleats run from button to button
    diag = np.minimum(np.abs(((uu - vv) % 16) - 8), np.abs(((uu + vv) % 16) - 8))
    img[(diag > 7.2) & (best > 2)] *= 0.72
    img *= (0.9 + 0.2 * vnoise(rng, S, 32, 32))[..., None]
    return speckle(img, rng, 0.08, 0.75, 0.95)


def paint_leather(seed):
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.10, 0.085, 0.075))
    n = vnoise(rng, S, 10, 10)
    img *= (0.8 + 0.5 * n)[..., None]
    shine = rng.random((S, S)) < 0.03
    img[shine] = col((0.22, 0.20, 0.18))
    return img


def paint_straw(seed):
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.55, 0.45, 0.22))
    img *= (0.8 + 0.3 * vnoise(rng, S, 8, 8))[..., None]
    for _ in range(170):
        u, v = rng.uniform(0, S, 2)
        a = rng.normal(0, 0.5)
        L = rng.uniform(5, 16)
        tone = col((0.84, 0.72, 0.38)) * rng.uniform(0.75, 1.15)
        for t in np.linspace(0, L, int(L * 1.5)):
            img[int(v + math.sin(a) * t) % S, int(u + math.cos(a) * t) % S] = tone
    return speckle(img, rng, 0.05, 0.5, 0.8)


def paint_brass(seed):
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 6, 6)
    img = col((0.70, 0.54, 0.24)) * (0.8 + 0.4 * n)[..., None]
    tarnish = np.clip((vnoise(rng, S, 12, 12) - 0.6) * 3, 0, 1)[..., None]
    img = img * (1 - tarnish) + col((0.40, 0.32, 0.16)) * tarnish
    img[rng.random((S, S)) < 0.05] = col((0.98, 0.86, 0.52))
    return img


def paint_wheel(seed):
    """The carriage part's ochre, with a fine black line down the middle (lined spokes and bars)."""
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.70, 0.52, 0.20))
    img *= (0.8 + 0.3 * grain(rng, True, 20))[..., None]
    img[30:33] = col((0.10, 0.08, 0.07))
    return speckle(img, rng, 0.04, 0.6, 0.85)


def paint_ceiling(seed):
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.82, 0.78, 0.66))
    img *= (0.9 + 0.15 * grain(rng, True, 16))[..., None]
    for r in range(0, S, 16):
        img[r] *= 0.66
    return speckle(img, rng, 0.02, 0.8, 0.95)


def paint_glass(seed):
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    img = np.ones((S, S, 3)) * col((0.05, 0.06, 0.075))
    streak = np.abs(((uu + vv * 0.8) % 64) - 22) < 5
    img[streak] = col((0.13, 0.15, 0.17))
    img *= (0.9 + 0.2 * vnoise(rng, S, 4, 4))[..., None]
    return img


def paint_black(seed):
    """The raised mouldings: black, a fine gold line along the middle (lining-out)."""
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.075, 0.07, 0.07))
    img *= (0.85 + 0.3 * vnoise(rng, S, 16, 16))[..., None]
    img[31:33] = col((0.70, 0.56, 0.24))
    return img


def paint_strap(seed):
    rng = np.random.default_rng(seed)
    img = np.ones((S, S, 3)) * col((0.33, 0.20, 0.11))
    img *= (0.8 + 0.3 * vnoise(rng, S, 12, 4))[..., None]
    for u in range(0, S, 4):
        img[6, u] = img[57, u] = col((0.62, 0.52, 0.34))
    return img


def paint_atlas():
    cells = {"paint": paint_panel(1), "paint_dark": paint_dark(2), "cream": paint_cream(3), "varnish": paint_varnish(4),
             "planks": paint_planks(5), "iron": paint_iron(6), "roof": paint_roof(7), "velvet": paint_velvet(8),
             "leather": paint_leather(9), "straw": paint_straw(10), "brass": paint_brass(11), "wheel": paint_wheel(12),
             "ceiling": paint_ceiling(13), "glass": paint_glass(14), "black": paint_black(15), "strap": paint_strap(16)}
    out = np.zeros((S * N, S * N, 3))
    for k, name in enumerate(CELLS):
        c, r = k % N, k // N
        out[(N - 1 - r) * S:(N - r) * S, c * S:(c + 1) * S] = cells[name]
    return out


def make_material():
    arr = paint_atlas()
    h, w, _ = arr.shape
    img = bpy.data.images.new("omnibus_tex", w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    m = bpy.data.materials.new("omnibus")
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Closest"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry (in the game's frame)

HEX_FACES = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}
UP = Vector((0, 1, 0))
EPS = 0.004
# the game's frame (x, y up, z forward) to Blender's (x, -z, y): the glTF export turns it back
TO_BLENDER = Matrix.Rotation(math.pi / 2, 4, "X")


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def planar_uv(pts, tile=1.0, mode="metric"):
    """metric: u along the longest edge, in metres / tile. fit: 0..1 over the face (v up).
    strip: u in metres / tile along the longest edge, v 0..1 across (a lined bar's line runs down its middle)."""
    n = newell(pts)
    n = n.normalized() if n.length > 1e-9 else Vector((0, 1, 0))
    if mode == "fit" and abs(n.dot(UP)) < 0.7:
        va = (UP - n * UP.dot(n)).normalized()
        ua = va.cross(n)
    else:
        e = max(((pts[(i + 1) % len(pts)] - pts[i]) for i in range(len(pts))), key=lambda v: v.length)
        ua = (e - n * e.dot(n)).normalized()
        va = n.cross(ua)
    c = [(p.dot(ua), p.dot(va)) for p in pts]
    if mode in ("fit", "strip"):
        v0, v1 = min(b for _, b in c), max(b for _, b in c)
        vs = [EPS + (1 - 2 * EPS) * (b - v0) / max(v1 - v0, 1e-6) for _, b in c]
        if mode == "fit":
            u0, u1 = min(a for a, _ in c), max(a for a, _ in c)
            return [(EPS + (1 - 2 * EPS) * (a - u0) / max(u1 - u0, 1e-6), v) for (a, _), v in zip(c, vs)]
        return [(a / tile, v) for (a, _), v in zip(c, vs)]
    return [(a / tile, b / tile) for a, b in c]


class Mesh:
    """A bmesh in the game's frame: every face names a cell of the atlas."""

    def __init__(self, ao=0.45):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.cell = self.bm.loops.layers.uv.new("Cell")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.xf = TO_BLENDER.copy()
        self.ao = ao
        self.shadefn = None

    @contextmanager
    def at(self, M):
        old = self.xf
        self.xf = old @ M
        try:
            yield
        finally:
            self.xf = old

    def vert(self, p):
        return self.bm.verts.new(self.xf @ Vector(p))

    def face(self, vs, uvs, cell, shade=1.0, smooth=False, local=None):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = 0
        f.smooth = smooth
        for k, (loop, uv) in enumerate(zip(f.loops, uvs)):
            loop[self.uv].uv = uv
            loop[self.cell].uv = (cell % N, cell // N)
            s = shade
            if self.ao > 0:
                s *= 0.55 + 0.45 * min(1.0, max(0.0, loop.vert.co.z / self.ao))
            if self.shadefn and local is not None:
                s *= self.shadefn(local[k])
            loop[self.col] = (s, s, s, 1.0)
        return f

    def poly(self, pts, cell, out=None, shade=1.0, tile=1.0, mode="metric", uvs=None):
        """A flat face from local points; turned to look along `out` if given."""
        pts = [Vector(p) for p in pts]
        if out is not None and newell(pts).dot(Vector(out)) < 0:
            pts = pts[::-1]
            if uvs:
                uvs = uvs[::-1]
        uvs = uvs or planar_uv(pts, tile, mode)
        return self.face([self.vert(p) for p in pts], uvs, cell, shade, local=pts)

    def hexa(self, P, cell, shade=1.0, tile=1.0, mode="metric", skip=()):
        """Six faces over 8 corners P[x + 2y + 4z] of a right-handed (maybe skewed) box."""
        P = [Vector(p) for p in P]
        vs = [self.vert(p) for p in P]
        for key, idx in HEX_FACES.items():
            if key in skip:
                continue
            pts = [P[i] for i in idx]
            self.face([vs[i] for i in idx], planar_uv(pts, tile, mode), cell, shade, local=pts)

    def box(self, lo, hi, cell, shade=1.0, tile=1.0, mode="metric", skip=(), seg=1):
        """An axis box from its low corner to its high corner; seg > 1 cuts it along z (long faces
        the camera comes close to: the PS1 snap and warp need small faces)."""
        if seg > 1:
            for k in range(seg):
                za = lo[2] + (hi[2] - lo[2]) * k / seg
                zb = lo[2] + (hi[2] - lo[2]) * (k + 1) / seg
                sk = tuple(skip) + (() if k == 0 else ("-z",)) + (() if k == seg - 1 else ("+z",))
                self.box((lo[0], lo[1], za), (hi[0], hi[1], zb), cell, shade, tile, mode, sk)
            return
        P = [(hi[0] if i & 1 else lo[0], hi[1] if i & 2 else lo[1], hi[2] if i & 4 else lo[2]) for i in range(8)]
        self.hexa(P, cell, shade, tile, mode, skip)

    def quad(self, p00, p10, p11, p01, cell, nu=1, nv=1, out=None, shade=1.0, tile=1.0, mode="metric"):
        """A flat quad cut into nu x nv faces (bilinear between its corners)."""
        P = [Vector(p) for p in (p00, p10, p11, p01)]

        def at(u, v):
            return P[0] * (1 - u) * (1 - v) + P[1] * u * (1 - v) + P[2] * u * v + P[3] * (1 - u) * v

        for i in range(nu):
            for j in range(nv):
                q = [at(i / nu, j / nv), at((i + 1) / nu, j / nv), at((i + 1) / nu, (j + 1) / nv), at(i / nu, (j + 1) / nv)]
                self.poly(q, cell, out=out, shade=shade, tile=tile, mode=mode)

    def beam(self, a, b, w, h, cell, side=None, shade=1.0, tile=1.0, caps=True, w2=None, h2=None, mode="strip"):
        """A square-cut bar from a to b: w across (along `side`), h the other way."""
        a, b = Vector(a), Vector(b)
        t = (b - a).normalized()
        if side is None:
            s = UP.cross(t)
            if s.length < 1e-4:
                s = Vector((1, 0, 0))
        else:
            s = Vector(side)
            s = s - t * s.dot(t)
            if s.length < 1e-4:
                s = t.orthogonal()
        s.normalize()
        k = s.cross(t)
        w2 = w if w2 is None else w2
        h2 = h if h2 is None else h2
        P = []
        for i in range(8):
            base, ww, hh = (b, w2, h2) if i & 2 else (a, w, h)
            P.append(base + s * (ww / 2 if i & 1 else -ww / 2) + k * (hh / 2 if i & 4 else -hh / 2))
        self.hexa(P, cell, shade, tile, mode, () if caps else ("-y", "+y"))

    def grid(self, rings, cell, closed=True, smooth=True, shade=1.0, cap0=False, cap1=False, uvfn=None,
             urep=1.0, vscale=1.0, cells=None, closed_v=False, cap_cell=None):
        """Quads between rings of points (same count). Rings go round counter-clockwise about
        the direction of travel, so faces look outward."""
        rings = [[Vector(p) for p in r] for r in rings]
        n = len(rings[0])
        V = [[self.vert(p) for p in r] for r in rings]
        seq = list(range(len(rings))) + ([0] if closed_v else [])
        vv = [0.0]
        for a, b in zip(seq, seq[1:]):
            vv.append(vv[-1] + sum((rings[b][i] - rings[a][i]).length for i in range(n)) / n)
        for j in range(len(seq) - 1):
            ja, jb = seq[j], seq[j + 1]
            c = cells[j] if cells else cell
            for i in range(n if closed else n - 1):
                i1 = (i + 1) % n
                idx = [(ja, i), (ja, i1), (jb, i1), (jb, i)]
                if uvfn:
                    uvs = [uvfn(rings[a][b]) for a, b in idx]
                else:
                    u0, u1 = i / n * urep, (i + 1) / n * urep
                    uvs = [(u0, vv[j] * vscale), (u1, vv[j] * vscale), (u1, vv[j + 1] * vscale), (u0, vv[j + 1] * vscale)]
                self.face([V[a][b] for a, b in idx], uvs, c, shade, smooth, local=[rings[a][b] for a, b in idx])
        cc = cell if cap_cell is None else cap_cell
        if cap0:
            c0, c1 = sum(rings[0], Vector()) / n, sum(rings[1], Vector()) / n
            self.poly(rings[0], cc, out=c0 - c1, shade=shade)
        if cap1:
            c0, c1 = sum(rings[-1], Vector()) / n, sum(rings[-2], Vector()) / n
            self.poly(rings[-1], cc, out=c0 - c1, shade=shade)

    def lathe(self, prof, sides, cell, rot=0.0, **kw):
        """Turned shape about local +z. Profile (r, z) bottom to top; for a closed section, go up
        the outside and down the inside."""
        rings = [[(r * math.cos(rot + 2 * math.pi * i / sides), r * math.sin(rot + 2 * math.pi * i / sides), z)
                  for i in range(sides)] for r, z in prof]
        self.grid(rings, cell, **kw)

    def tube(self, path, radii, sides, cell, side=(1, 0, 0), rot=0.0, closed_path=False, **kw):
        """A tube along a path; radii are r or (r across `side`, r the other way)."""
        path = [Vector(p) for p in path]
        n = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed_path:
                t = path[(k + 1) % n] - path[(k - 1) % n]
            else:
                t = path[min(k + 1, n - 1)] - path[max(k - 1, 0)]
            t.normalize()
            s = Vector(side)
            s = s - t * s.dot(t)
            if s.length < 1e-4:
                s = t.orthogonal()
            s.normalize()
            b = t.cross(s)
            r = radii[k]
            rx, ry = r if isinstance(r, tuple) else (r, r)
            rings.append([p + s * rx * math.cos(rot + 2 * math.pi * i / sides) + b * ry * math.sin(rot + 2 * math.pi * i / sides)
                          for i in range(sides)])
        self.grid(rings, cell, closed_v=closed_path, **kw)

    def rod(self, a, b, r, cell, sides=6, caps=True, **kw):
        self.tube([a, b], [r, r], sides, cell, side=kw.pop("side", (1, 0, 0) if abs(Vector(b)[0] - Vector(a)[0]) < 1e-6 else (0, 1, 0)),
                  cap0=caps, cap1=caps, smooth=False, **kw)

    def prism(self, poly, extrude, cell, shade=1.0, tile=1.0, side_cell=None, mode="metric"):
        """A flat outline pushed along `extrude`: two caps and the sides."""
        poly = [Vector(p) for p in poly]
        e = Vector(extrude)
        c = sum(poly, Vector()) / len(poly)
        top = [p + e for p in poly]
        self.poly(poly, cell, out=-e, shade=shade, tile=tile, mode=mode)
        self.poly(top, cell, out=e, shade=shade, tile=tile, mode=mode)
        sc = cell if side_cell is None else side_cell
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            self.poly([a, b, b + e, a + e], sc, out=(a + b) / 2 - c, shade=shade, tile=tile)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        me.materials.append(bpy.data.materials["omnibus"])
        try:
            me.color_attributes.active_color = me.color_attributes["Col"]
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (KeyError, AttributeError):
            pass
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def move(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def rot_x(a):
    return Matrix.Rotation(a, 4, "X")


def rot_y(a):
    return Matrix.Rotation(a, 4, "Y")


# local z (a lathe's axis) to the game's up
LATHE_UP = rot_x(-math.pi / 2)


def pline(m, pts, r, cell, sides=4, side=(1, 0, 0), **kw):
    """A bar along a polyline: square (4 sides) or round."""
    m.tube(pts, [r] * len(pts), sides, cell, side=side, rot=math.pi / 4 if sides == 4 else 0.0, smooth=False, cap0=True, cap1=True, **kw)


def spring(m, c, L, half_h, width=0.06, leaves=3, along="z", thick=0.011):
    """An elliptic leaf spring: two packs of leaves bowed apart, joined at the ends by shackles, the
    lower pack's middle clipped down, the upper pack's middle bolted up. c: its middle."""
    ax = Vector((0, 0, 1)) if along == "z" else Vector((1, 0, 0))
    across = Vector((1, 0, 0)) if along == "z" else Vector((0, 0, 1))
    base = Vector(c)
    for up in (1, -1):
        for k in range(leaves):
            Lk = L * (1 - 0.24 * k)
            pts = []
            for i in range(7):
                t = -1 + 2 * i / 6
                # the main leaf's bow; the shorter ones lie on it
                bow = half_h * (1 - (t * Lk / L) ** 2)
                pts.append(base + ax * (t * Lk / 2) + UP * (up * (bow + k * thick)))
            m.tube(pts, [(width / 2 * 1.414, thick / 2 * 1.414)] * len(pts), 4, IRON, side=tuple(across), rot=math.pi / 4,
                   smooth=False, cap0=True, cap1=True, vscale=4)
    # the shackles at the ends, the clip and the block in the middle
    for s in (-1, 1):
        e = base + ax * (s * L / 2)
        m.box(tuple(e - across * (width * 0.7) - UP * 0.022 - ax * 0.02), tuple(e + across * (width * 0.7) + UP * 0.022 + ax * 0.02), IRON)
    for up in (1, -1):
        mid = base + UP * (up * (half_h + leaves * thick))
        m.box(tuple(mid - across * (width * 0.75) - ax * 0.05 - UP * 0.012), tuple(mid + across * (width * 0.75) + ax * 0.05 + UP * 0.012), IRON)


# ------------------------------------------------------------------ the body


def body(m):
    lower_panels_mouldings(m)
    window_band(m)
    ends_and_corners(m)
    floor_and_underframe(m)
    roof(m)
    platform_and_ladder(m)
    drivers_box(m)
    lamps(m)
    brake(m)


PANEL_Z = [Z0, -0.2, 0.6, 1.4, 2.2, Z1]


def lower_panels_mouldings(m):
    """The mouldings over the painted lower panels (the panels are the paint part)."""
    for s in (-1, 1):
        # the vertical mouldings between the panels, curving with the side
        for z in PANEL_Z[1:-1]:
            yb = bottom_y(z)
            pts = [(s * (side_x(y) + 0.012), y, z) for y in np.linspace(yb, WAIST_Y, 6)]
            pline(m, pts, 0.022, BLACK, side=(0, 0, 1))
        # the bottom moulding along the sill, up over the wheel arch
        zs = list(np.linspace(Z0, ARCH_C - ARCH_R - 0.02, 3)) + list(np.linspace(ARCH_C - ARCH_R, Z1, 9))
        pts = [(s * (side_x(bottom_y(z)) + 0.01), bottom_y(z) + 0.012, z) for z in zs]
        pline(m, pts, 0.02, BLACK, side=(0, 1, 0))
        # the waist rail: ochre, lined, the sills of the windows on it
        m.beam((s * 0.862, WAIST_Y + 0.04, Z0 - 0.03), (s * 0.862, WAIST_Y + 0.04, Z1 + 0.03), 0.05, 0.08, WHEEL, side=(1, 0, 0))
    # the wheel houses: under the front seats, open to the arch below
    for s in (-1, 1):
        x0, x1 = sorted((s * WHEELHOUSE_X, s * (side_x(ARCH_TOP) - 0.02)))
        z0, z1 = ARCH_C - ARCH_R + 0.02, Z1 - 0.02
        m.box((x0, ARCH_TOP, z0), (x1, ARCH_TOP + 0.02, z1), VARNISH, shade=0.55)
        xi = s * WHEELHOUSE_X
        m.poly([(xi, SILL_Y, z0), (xi, SILL_Y, z1), (xi, ARCH_TOP, z1), (xi, ARCH_TOP, z0)], VARNISH, out=(s, 0, 0), shade=0.5)
        # its back wall, following the arch
        m.poly([(x0, SILL_Y, z0), (x1, SILL_Y, z0), (x1, ARCH_TOP, z0), (x0, ARCH_TOP, z0)], VARNISH, out=(0, 0, 1), shade=0.5)


def window_band(m):
    """The cream band: pillars between the droplights, the band over them, the frames round each
    opening (varnished, rounded at the top), the droplights let down to their top rails."""
    for s in (-1, 1):
        xo, xi = s * HW, s * (HW - 0.03)
        lo_x, hi_x = min(xo, xi), max(xo, xi)
        edges = [Z0] + [z for w in WINDOWS for z in (w - WIN_W / 2, w + WIN_W / 2)] + [Z1]
        for za, zb in zip(edges[0::2], edges[1::2]):
            m.box((lo_x, WIN_LO, za), (hi_x, WIN_HI, zb), CREAM)
        # over the windows the band is a little thinner inside: the game's advertisements hang there (x +-0.825)
        xa = s * (HW - 0.022)
        m.box((min(xo, xa), WIN_HI, Z0), (max(xo, xa), TOP, Z1), CREAM, seg=6)
        for zc in WINDOWS:
            za, zb = zc - WIN_W / 2, zc + WIN_W / 2
            f = 0.03
            x = s * (HW + 0.008)
            # the frame, standing proud of the band
            m.beam((x, WIN_LO - f / 2 + 0.005, za - f), (x, WIN_LO - f / 2 + 0.005, zb + f), 0.016, f, VARNISH, side=(1, 0, 0))
            m.beam((x, WIN_HI + f / 2, za - f), (x, WIN_HI + f / 2, zb + f), 0.016, f, VARNISH, side=(1, 0, 0))
            for z in (za - f / 2, zb + f / 2):
                m.beam((x, WIN_LO, z), (x, WIN_HI + f, z), 0.016, f, VARNISH, side=(1, 0, 0))
            # rounded top corners inside the opening
            for zc2, sgn in ((za, 1), (zb, -1)):
                # a quarter fillet: the corner square less a quarter circle
                r = 0.06
                poly = [(zc2, WIN_HI)] + [(zc2 + sgn * r * (1 - math.cos(a)), WIN_HI - r * (1 - math.sin(a))) for a in np.linspace(0, math.pi / 2, 5)]
                m.prism([(xi, y, z) for z, y in poly], (xo - xi, 0, 0), VARNISH)
            # the droplight, let down into the door: its top rail at the sill, its strap
            m.box((min(s * 0.805, s * 0.84), WIN_LO, za + 0.01), (max(s * 0.805, s * 0.84), WIN_LO + 0.03, zb - 0.01), VARNISH)
    # the letter board's frame (the board itself is drawn by the game at x +-0.895): mouldings under
    # and over it; the cantrail at the roof's edge
    for s in (-1, 1):
        lo, hi = sorted((s * 0.86, s * 0.905))
        m.box((lo, BAND_TOP - 0.02, Z0 - 0.02), (hi, BAND_TOP + 0.005, Z1 + 0.02), BLACK, mode="strip")
        lo, hi = sorted((s * 0.86, s * 0.945))
        m.box((lo, 2.735, Z0 - 0.17), (hi, 2.805, Z1 + 0.17), BLACK, mode="strip")


def ends_and_corners(m):
    """Front bulkhead and back: the cream band round the front window and beside the doorway, the
    corner pillars, the doorway's posts and header, grab handles."""
    zf0, zf1 = Z1 - 0.03, Z1
    # front: the band beside and over the front window
    for s in (-1, 1):
        lo, hi = sorted((s * 0.45, s * HW))
        m.box((lo, WIN_LO, zf0), (hi, WIN_HI, zf1), CREAM)
    m.box((-HW, WIN_HI, zf0), (HW, BAND_TOP, zf1), CREAM)
    m.box((-HW + 0.03, BAND_TOP, zf0), (HW - 0.03, TOP, zf0 + 0.012), CREAM, skip=("+z",))  # inside, over the band
    # the front window's frame
    f = 0.03
    z = Z1 + 0.008
    for y in (WIN_LO - f / 2 + 0.005, WIN_HI + f / 2):
        m.beam((-0.45 - f, y, z), (0.45 + f, y, z), f, 0.016, VARNISH, side=(0, 1, 0))
    for x in (-0.45 - f / 2, 0.45 + f / 2):
        m.beam((x, WIN_LO, z), (x, WIN_HI + f, z), f, 0.016, VARNISH, side=(1, 0, 0))
    m.box((-0.45, WIN_LO, Z1 - 0.07), (0.45, WIN_LO + 0.03, Z1 - 0.035), VARNISH)
    # back: the band beside the doorway and over it
    zb0, zb1 = Z0, Z0 + 0.03
    for s in (-1, 1):
        lo, hi = sorted((s * DOOR, s * HW))
        m.box((lo, WIN_LO, zb0), (hi, BAND_TOP, zb1), CREAM)
    m.box((-DOOR, DOOR_TOP, zb0), (DOOR, BAND_TOP, zb1), CREAM)
    m.box((-HW + 0.03, BAND_TOP, zb1 - 0.012), (HW - 0.03, TOP, zb1), CREAM, skip=("-z",))  # inside, over the band
    # the waist rail round the ends
    m.beam((-0.87, WAIST_Y + 0.04, Z1 + 0.012), (0.87, WAIST_Y + 0.04, Z1 + 0.012), 0.05, 0.08, WHEEL, side=(0, 0, 1))
    for s in (-1, 1):
        m.beam((s * 0.87, WAIST_Y + 0.04, Z0 - 0.012), (s * (DOOR + 0.03), WAIST_Y + 0.04, Z0 - 0.012), 0.05, 0.08, WHEEL, side=(0, 0, 1))
    # corner pillars (varnished), curving in with the lower panels
    for s in (-1, 1):
        for zc, dz in ((Z0, -0.012), (Z1, 0.012)):
            ys = [0.78, 0.9, 1.05, 1.25, 1.45, WAIST_Y, 2.0, TOP]
            if zc == Z1:
                ys = [bottom_y(Z1)] + [y for y in ys if y > bottom_y(Z1) + 0.05]
            pts = [(s * (side_x(y) + 0.004), y, zc + dz) for y in ys]
            pline(m, pts, 0.03, VARNISH, side=(0, 0, 1))
    # the mouldings round the end panels (ends of the lower panels)
    for zc, dz in ((Z1, 0.01),):
        pts = [(-0.44, SILL_Y + 0.012, zc + dz), (0.44, SILL_Y + 0.012, zc + dz)]
        pline(m, pts, 0.02, BLACK, side=(0, 1, 0))
    for s in (-1, 1):
        pts = [(s * (DOOR + 0.01), SILL_Y + 0.012, Z0 - 0.01), (s * (side_x(SILL_Y) - 0.01), SILL_Y + 0.012, Z0 - 0.01)]
        pline(m, pts, 0.02, BLACK, side=(0, 1, 0))
    # the doorway: posts, header, the threshold with its brass nosing
    for s in (-1, 1):
        lo, hi = sorted((s * (DOOR - 0.03), s * (DOOR + 0.035)))
        m.box((lo, FLOOR_Y - 0.05, Z0 - 0.03), (hi, DOOR_TOP + 0.03, Z0 + 0.06), VARNISH)
    m.box((-DOOR - 0.035, DOOR_TOP, Z0 - 0.03), (DOOR + 0.035, DOOR_TOP + 0.06, Z0 + 0.06), VARNISH)
    m.box((-DOOR, SILL_Y, Z0 - 0.02), (DOOR, FLOOR_Y, Z0 + 0.03), VARNISH)
    m.box((-DOOR, FLOOR_Y - 0.004, Z0 - 0.025), (DOOR, FLOOR_Y + 0.004, Z0 + 0.03), BRASS)
    # grab handles either side of the doorway, on stand-offs
    for s in (-1, 1):
        x = s * (DOOR + 0.1)
        m.rod((x, 1.0, Z0 - 0.07), (x, 1.85, Z0 - 0.07), 0.013, BRASS, sides=6)
        for y in (1.02, 1.83):
            m.rod((x, y, Z0 - 0.075), (x, y, Z0 + 0.0), 0.009, BRASS, sides=4, side=(1, 0, 0))


def floor_and_underframe(m):
    """The floor (planks), the sills, the perch, the rear springs on the axle, the upper ring of the
    fifth wheel and its bed, the king bolt."""
    # the floor: full width behind the wheel houses, only the aisle over the front wheels
    zc = ARCH_C - ARCH_R + 0.02
    m.box((-0.79, SILL_Y, Z0 + 0.03), (0.79, FLOOR_Y, zc), PLANKS, shade=0.8, seg=6, skip=("+z",))
    m.box((-WHEELHOUSE_X, SILL_Y, zc), (WHEELHOUSE_X, FLOOR_Y, Z1 - 0.01), PLANKS, shade=0.8, seg=2)
    # the sills: the body's bottom rails, bearers across
    for s in (-1, 1):
        m.beam((s * 0.74, 0.755, Z0), (s * 0.74, 0.755, zc), 0.07, 0.05, VARNISH, side=(1, 0, 0), mode="metric")
    for z in (-0.9, -0.35, 0.35, 1.2, 2.0):
        m.beam((-0.78, 0.76, z), (0.78, 0.76, z), 0.05, 0.04, VARNISH, side=(0, 0, 1), mode="metric")
    # the perch from the rear axle to the king bolt, and its stays out to the springs
    m.beam((0, 0.715, -0.55), (0, 0.715, WHEELBASE + 0.05), 0.07, 0.07, WHEEL, side=(1, 0, 0))
    for s in (-1, 1):
        m.beam((0, 0.705, 1.1), (s * 0.66, 0.705, 0.1), 0.035, 0.03, IRON, side=(0, 1, 0))
        m.beam((0, 0.705, -0.5), (s * 0.66, 0.705, -0.1), 0.035, 0.03, IRON, side=(0, 1, 0))
    # the rear springs: elliptic, along the body, on the axle at x +-0.7
    for s in (-1, 1):
        spring(m, (s * 0.70, 0.725, 0.0), 1.0, 0.035, width=0.06, leaves=3)
        # the clip round the axle (it turns inside), the block under the sill
        m.box((s * 0.70 - 0.04, R_REAR - 0.055, -0.035), (s * 0.70 + 0.04, R_REAR - 0.045, 0.035), IRON)
        for dz in (-0.03, 0.03):
            m.box((s * 0.70 - 0.04, R_REAR - 0.055, dz - 0.006), (s * 0.70 - 0.032, 0.685, dz + 0.006), IRON)
            m.box((s * 0.70 + 0.032, R_REAR - 0.055, dz - 0.006), (s * 0.70 + 0.04, 0.685, dz + 0.006), IRON)
        m.box((s * 0.70 - 0.05, 0.775, -0.12), (s * 0.70 + 0.05, SILL_Y + 0.004, 0.12), VARNISH)
    # the fifth wheel's upper ring (the lower one turns with the front carriage) and its bed
    with m.at(move(0, 0, WHEELBASE) @ LATHE_UP):
        m.lathe([(0.55, 0.745), (0.55, 0.765), (0.50, 0.765), (0.50, 0.745)], 16, IRON, closed_v=True, smooth=False, urep=4, vscale=4)
    for s in (-1, 1):
        m.beam((s * 0.52, 0.772, WHEELBASE - 0.62), (s * 0.52, 0.772, WHEELBASE + 0.6), 0.06, 0.016, VARNISH, side=(1, 0, 0), mode="metric")
    m.beam((-0.56, 0.772, WHEELBASE), (0.56, 0.772, WHEELBASE), 0.08, 0.016, VARNISH, side=(0, 0, 1), mode="metric")
    # the king bolt
    m.rod((0, 0.70, WHEELBASE), (0, 0.80, WHEELBASE), 0.018, IRON, sides=6, side=(1, 0, 0))


def roof(m):
    """The roof, cambered and painted; the knifeboard seat back to back along it with its foot
    boards; the iron rail round it; the destination boards' frames."""
    L0, L1 = Z0 - 0.15, Z1 + 0.15
    prof = [(-0.92, 2.74), (-0.92, 2.80), (-0.6, 2.815), (-0.2, 2.824), (0.2, 2.824), (0.6, 2.815), (0.92, 2.80), (0.92, 2.74)]
    top = prof[1:-1]
    for (xa, ya), (xb, yb) in zip(top, top[1:]):
        m.poly([(xa, ya, L0), (xb, yb, L0), (xb, yb, L1), (xa, ya, L1)], ROOF, out=(0, 1, 0), tile=1.0)
    m.poly([(-0.92, 2.74, L0), (0.92, 2.74, L0), (0.92, 2.74, L1), (-0.92, 2.74, L1)], VARNISH, out=(0, -1, 0), shade=0.6)
    for z, o in ((L0, -1), (L1, 1)):
        m.poly([(x, y, z) for x, y in prof], BLACK, out=(0, 0, o), mode="metric")
    # the knifeboard: the back board (both sides), its capping, the seat boards, the seat ends
    za, zb = -0.75, 2.80
    m.box((-0.022, 2.815, za), (0.022, 3.30, zb), VARNISH, tile=0.8)
    m.box((-0.04, 3.30, za - 0.02), (0.04, 3.33, zb + 0.02), VARNISH)
    for s in (-1, 1):
        lo, hi = sorted((s * 0.03, s * 0.47))
        m.box((lo, SEAT_ROOF_Y - 0.035, za), (hi, SEAT_ROOF_Y, zb), PLANKS, tile=1.2)
        # the seat's front edge, rounded off
        m.beam((s * 0.482, SEAT_ROOF_Y - 0.02, za), (s * 0.482, SEAT_ROOF_Y - 0.02, zb), 0.024, 0.03, VARNISH, side=(1, 0, 0), mode="metric")
        for z in (za + 0.03, (za + zb) / 2, zb - 0.03):
            m.box((lo + 0.01, 2.815, z - 0.025), (hi - 0.01, SEAT_ROOF_Y - 0.035, z + 0.025), VARNISH)
        # the foot boards along the roof's edge, tilted up to the feet
        fx0, fx1 = s * 0.62, s * 0.84
        m.hexa([(fx0, 2.815, za), (fx1, 2.80, za), (fx0, 2.86, za), (fx1, 2.875, za),
                (fx0, 2.815, zb), (fx1, 2.80, zb), (fx0, 2.86, zb), (fx1, 2.875, zb)] if s > 0 else
               [(fx1, 2.80, za), (fx0, 2.815, za), (fx1, 2.875, za), (fx0, 2.86, za),
                (fx1, 2.80, zb), (fx0, 2.815, zb), (fx1, 2.875, zb), (fx0, 2.86, zb)], PLANKS, tile=1.0)
    # the iron rail round the roof: stanchions, a top rail and a middle one; open at the back left for the ladder
    rz0, rz1 = Z0 - 0.08, Z1 + 0.1
    for s in (-1, 1):
        x = s * 0.895
        stan = [rz0 + i * (rz1 - rz0) / 5 for i in range(6)]
        for z in stan:
            m.rod((x, 2.80, z), (x, 3.17, z), 0.012, IRON, sides=4)
        m.rod((x, 3.17, rz0), (x, 3.17, rz1), 0.014, IRON, sides=6)
        m.rod((x, 3.0, rz0), (x, 3.0, rz1), 0.01, IRON, sides=4)
        # the front ends turn in to the destination board
        m.rod((x, 3.17, rz1), (s * 0.78, 3.12, Z1 + 0.16), 0.012, IRON, sides=6)
        if s > 0:
            m.rod((x, 3.17, rz0), (s * 0.78, 3.12, Z0 - 0.16), 0.012, IRON, sides=6)
    # the destination boards' backs (the boards are drawn by the game at z Z1 + 0.2 and Z0 - 0.2)
    for zb_, o in ((Z1 + 0.2, 1), (Z0 - 0.2, -1)):
        z0, z1 = sorted((zb_ - o * 0.03, zb_ - o * 0.05))
        m.box((-0.78, 2.83, z0), (0.78, 3.105, z1), BLACK, mode="metric")
        for s in (-1, 1):
            m.beam((s * 0.6, 2.82, zb_ - o * 0.3), (s * 0.6, 3.0, zb_ - o * 0.035), 0.02, 0.012, IRON, side=(1, 0, 0), mode="metric")


def platform_and_ladder(m):
    """The conductor's platform at the back: planks on bearers, a brass nosing, the hanging step,
    the corner pole with its hoop, the side rail; the iron ladder to the roof at the left corner."""
    pz0, pz1 = Z0 - 0.78, Z0 + 0.04
    m.box((-0.75, PLATFORM_Y - 0.05, pz0 + 0.03), (0.75, PLATFORM_Y, pz1), PLANKS, tile=1.0)
    m.box((-0.76, PLATFORM_Y - 0.06, pz0 - 0.02), (0.76, PLATFORM_Y + 0.004, pz0 + 0.03), BRASS)
    for x in (-0.6, 0.0, 0.6):
        m.beam((x, PLATFORM_Y - 0.08, -0.3), (x, PLATFORM_Y - 0.08, pz0 + 0.04), 0.06, 0.06, VARNISH, side=(1, 0, 0), mode="metric")
    # the step: a board hung on irons below the platform's edge
    m.box((-0.45, 0.33, Z0 - 1.03), (0.45, 0.37, Z0 - 0.75), PLANKS)
    m.box((-0.46, 0.365, Z0 - 1.04), (0.46, 0.375, Z0 - 1.02), BRASS)
    for s in (-1, 1):
        m.beam((s * 0.44, 0.33, Z0 - 0.9), (s * 0.44, PLATFORM_Y - 0.05, Z0 - 0.74), 0.03, 0.012, IRON, side=(1, 0, 0), mode="metric")
        m.beam((s * 0.44, 0.33, Z0 - 1.0), (s * 0.44, PLATFORM_Y - 0.05, Z0 - 0.62), 0.03, 0.012, IRON, side=(1, 0, 0), mode="metric")
    # the corner pole at the back right, a hoop to the body, the conductor's strap
    px, pz = 0.72, pz0 + 0.04
    m.rod((px, PLATFORM_Y, pz), (px, 2.3, pz), 0.017, BRASS, sides=6)
    m.rod((px, 2.3, pz), (px, 2.3, Z0 - 0.01), 0.014, BRASS, sides=6)
    m.tube([(px - 0.02, 2.28, pz + 0.1), (px - 0.05, 2.0, pz + 0.12), (px - 0.02, 1.9, pz + 0.12)], [0.012] * 3, 4, STRAP, cap0=True, cap1=True)
    # a rail along the platform's right side, at the conductor's hip
    m.rod((px, 1.05, pz), (px, 1.05, Z0 - 0.01), 0.013, BRASS, sides=6)
    m.rod((px, PLATFORM_Y, Z0 - 0.35), (px, 1.05, Z0 - 0.35), 0.01, BRASS, sides=4)
    # the ladder: two iron stringers leaning in toward the roof, flat treads, grips over the top
    lx0, lx1 = -0.87, -0.60
    b_z, t_z, t_y = pz0 + 0.03, Z0 - 0.35, 3.0
    for x in (lx0, lx1):
        m.beam((x, PLATFORM_Y, b_z), (x, t_y, t_z), 0.012, 0.05, IRON, side=(1, 0, 0), mode="metric")
        # the grip curves over at the top
        m.tube([(x, t_y - 0.02, t_z), (x, 3.18, t_z + 0.04), (x, 3.22, t_z + 0.16), (x, 3.17, t_z + 0.26)], [0.013] * 4, 5, IRON,
               cap0=True, cap1=True, smooth=False)
    for k in range(1, 8):
        y = PLATFORM_Y + k * 0.3
        f = (y - PLATFORM_Y) / (t_y - PLATFORM_Y)
        z = b_z + (t_z - b_z) * f
        m.box((lx0 + 0.006, y - 0.012, z - 0.045), (lx1 - 0.006, y + 0.008, z + 0.045), IRON)
    # the landing plate from the ladder's top to the roof's corner (under the board's end)
    m.box((lx0, 2.805, t_z - 0.04), (lx1, 2.822, Z0 - 0.13), IRON)
    # stays from the ladder to the body's back
    for y in (1.5, 2.4):
        f = (y - PLATFORM_Y) / (t_y - PLATFORM_Y)
        z = b_z + (t_z - b_z) * f
        m.beam(((lx0 + lx1) / 2, y, z), ((lx0 + lx1) / 2, y, Z0 - 0.01), 0.02, 0.012, IRON, side=(1, 0, 0), mode="metric")


# the driver's box
BOX_Z0, BOX_Z1 = Z1, Z1 + 0.22  # the seat: shallow, his hips at its front edge (he stands, see FOOT_Y)
SEAT_Y = 2.28


def drivers_box(m):
    """The driver's box on the front: a cushioned seat on irons, the lazy-back, seat rails; the
    footboard under his feet and the toe board; the dash in leather on an iron frame, the rolled
    apron, the whip in its socket; the step and grab handle up to it."""
    x0, x1 = -0.66, 0.66
    # seat board on two iron brackets from the bulkhead, the leather cushion, its rolled front
    m.box((x0, SEAT_Y - 0.055, BOX_Z0), (x1, SEAT_Y - 0.03, BOX_Z1), VARNISH)
    m.box((x0 + 0.02, SEAT_Y - 0.03, BOX_Z0 + 0.005), (x1 - 0.02, SEAT_Y, BOX_Z1 - 0.02), LEATHER)
    m.beam((x0 + 0.02, SEAT_Y - 0.012, BOX_Z1 - 0.02), (x1 - 0.02, SEAT_Y - 0.012, BOX_Z1 - 0.02), 0.03, 0.036, LEATHER, side=(0, 0, 1), mode="metric")
    for s in (-1, 1):
        x = s * 0.55
        m.beam((x, SEAT_Y - 0.055, BOX_Z1 - 0.02), (x, 1.95, Z1 + 0.005), 0.03, 0.012, IRON, side=(1, 0, 0), mode="metric")
    # the lazy-back: an iron frame, a leather pad
    m.box((-0.6, SEAT_Y + 0.04, Z1 + 0.005), (0.6, SEAT_Y + 0.25, Z1 + 0.045), LEATHER)
    for s in (-1, 1):
        m.rod((s * 0.62, SEAT_Y - 0.03, Z1 + 0.03), (s * 0.62, SEAT_Y + 0.28, Z1 + 0.03), 0.01, IRON, sides=4)
    m.rod((-0.62, SEAT_Y + 0.28, Z1 + 0.03), (0.62, SEAT_Y + 0.28, Z1 + 0.03), 0.01, IRON, sides=4)
    # seat rails at the ends
    for s in (-1, 1):
        x = s * 0.68
        m.tube([(x, SEAT_Y - 0.03, Z1 + 0.02), (x, SEAT_Y + 0.14, Z1 + 0.04), (x, SEAT_Y + 0.15, BOX_Z1 - 0.04), (x, SEAT_Y - 0.03, BOX_Z1 - 0.01)],
               [0.011] * 4, 4, IRON, cap0=True, cap1=True, smooth=False)
    # the footboard under his feet, the toe board up to the dash
    f0, f1, f2 = Z1 + 0.02, Z1 + 0.72, Z1 + 1.12
    fx = 0.72
    m.box((-fx, FOOT_Y - 0.04, f0), (fx, FOOT_Y, f1), PLANKS)
    m.hexa([(-fx, FOOT_Y - 0.04, f1), (fx, FOOT_Y - 0.04, f1), (-fx, FOOT_Y, f1), (fx, FOOT_Y, f1),
            (-fx, FOOT_Y + 0.13, f2), (fx, FOOT_Y + 0.13, f2), (-fx, FOOT_Y + 0.17, f2), (fx, FOOT_Y + 0.17, f2)], PLANKS)
    m.box((-fx - 0.01, FOOT_Y - 0.05, f0), (-fx + 0.02, FOOT_Y + 0.03, f1), IRON)
    m.box((fx - 0.02, FOOT_Y - 0.05, f0), (fx + 0.01, FOOT_Y + 0.03, f1), IRON)
    m.box((-0.5, FOOT_Y, f1 - 0.06), (0.5, FOOT_Y + 0.035, f1 - 0.03), VARNISH)  # a stretcher to brace the feet
    # its irons: struts from the bulkhead under it
    for s in (-1, 1):
        m.beam((s * 0.62, 1.0, Z1 + 0.01), (s * 0.62, FOOT_Y - 0.04, Z1 + 0.62), 0.03, 0.014, IRON, side=(1, 0, 0), mode="metric")
        m.beam((s * 0.62, 1.2, Z1 + 0.01), (s * 0.62, FOOT_Y - 0.04, Z1 + 0.25), 0.03, 0.014, IRON, side=(1, 0, 0), mode="metric")
    # the dash: a curved iron frame with the leather stretched in it
    dz = f2 + 0.02
    ys = [FOOT_Y + 0.15, 1.70, 1.81, 1.89]
    zs = [dz, dz + 0.03, dz + 0.07, dz + 0.12]
    dx = 0.6
    for i in range(3):
        m.poly([(-dx, ys[i], zs[i]), (dx, ys[i], zs[i]), (dx, ys[i + 1], zs[i + 1]), (-dx, ys[i + 1], zs[i + 1])], LEATHER, out=(0, 0.3, 1))
        m.poly([(-dx, ys[i], zs[i]), (dx, ys[i], zs[i]), (dx, ys[i + 1], zs[i + 1]), (-dx, ys[i + 1], zs[i + 1])], LEATHER, out=(0, -0.3, -1), shade=0.7)
    for s in (-1, 1):
        m.tube([(s * (dx + 0.01), y, z) for y, z in zip(ys, zs)], [0.012] * 4, 4, IRON, cap0=True, cap1=True, smooth=False)
    m.tube([(-dx - 0.01, ys[-1], zs[-1]), (dx + 0.01, ys[-1], zs[-1])], [0.014, 0.014], 6, IRON, cap0=True, cap1=True, smooth=False)
    for s in (-1, 1):
        m.beam((s * (dx + 0.01), FOOT_Y + 0.15, dz), (s * (dx + 0.01), FOOT_Y - 0.02, f1), 0.02, 0.012, IRON, side=(1, 0, 0), mode="metric")
    # the apron, rolled and strapped on the dash's top
    m.tube([(-0.45, ys[-1] + 0.035, zs[-1] - 0.03), (0.45, ys[-1] + 0.035, zs[-1] - 0.03)], [0.035, 0.035], 7, LEATHER, cap0=True, cap1=True, smooth=False)
    for x in (-0.3, 0.3):
        with m.at(move(x, ys[-1] + 0.035, zs[-1] - 0.03) @ rot_y(math.pi / 2)):
            m.lathe([(0.04, -0.012), (0.04, 0.012)], 7, STRAP, smooth=False)
    # the whip socket at the dash's right and the whip standing in it, its lash hanging
    wx, wz = 0.6, dz
    m.rod((wx, 1.72, wz), (wx, 2.02, wz), 0.018, IRON, sides=6)
    m.rod((wx, 1.8, wz), (wx + 0.02, 3.05, wz + 0.1), 0.008, VARNISH, sides=4)
    m.tube([(wx + 0.02, 3.05, wz + 0.1), (wx + 0.05, 3.1, wz + 0.25), (wx + 0.08, 2.98, wz + 0.4), (wx + 0.1, 2.8, wz + 0.45)],
           [0.004] * 4, 3, STRAP, cap0=True, cap1=True, smooth=False)
    # the step up to the box at the left, over the front wheel, and a handle on the seat's end
    sx = -0.95
    m.box((sx - 0.07, 1.04, Z1 + 0.14), (sx + 0.05, 1.06, Z1 + 0.3), IRON)
    m.beam((sx + 0.0, 1.05, Z1 + 0.22), (-0.72, FOOT_Y - 0.03, Z1 + 0.22), 0.03, 0.02, IRON, side=(0, 0, 1), mode="metric")
    m.tube([(-0.6, SEAT_Y + 0.07, Z1 + 0.03), (-0.72, SEAT_Y + 0.09, Z1 + 0.06), (-0.72, SEAT_Y + 0.22, Z1 + 0.06), (-0.6, SEAT_Y + 0.24, Z1 + 0.03)],
           [0.011] * 4, 4, BRASS, cap0=True, cap1=True, smooth=False)


def lamps(m):
    """The two carriage lamps on brackets at the front corners, round the game's glass (LAMPS)."""
    for lx, ly, lz in LAMPS[:2]:
        s = 1 if lx > 0 else -1
        zf = lz - 0.012  # the case's front, just behind the glass
        m.box((lx - 0.075, ly - 0.11, zf - 0.13), (lx + 0.075, ly + 0.12, zf), IRON)
        # the brass bezel round the glass (the glass: 0.1 x 0.14, drawn by the game)
        for y0, y1 in ((ly - 0.095, ly - 0.07), (ly + 0.07, ly + 0.095)):
            m.box((lx - 0.075, y0, zf - 0.005), (lx + 0.075, y1, zf + 0.018), BRASS)
        for x0, x1 in ((lx - 0.075, lx - 0.05), (lx + 0.05, lx + 0.075)):
            m.box((x0, ly - 0.07, zf - 0.005), (x1, ly + 0.07, zf + 0.018), BRASS)
        # a side glass, dark by day
        xo = lx + s * 0.075
        m.poly([(xo + s * 0.002, ly - 0.06, zf - 0.1), (xo + s * 0.002, ly - 0.06, zf - 0.03), (xo + s * 0.002, ly + 0.07, zf - 0.03),
                (xo + s * 0.002, ly + 0.07, zf - 0.1)], GLASS, out=(s, 0, 0), mode="fit")
        # the top: a hood, the chimney and its cap; the socket under it
        with m.at(move(lx, 0, zf - 0.065) @ LATHE_UP):
            m.lathe([(0.1, ly + 0.12), (0.09, ly + 0.14), (0.035, ly + 0.17)], 8, IRON, cap1=True, smooth=False)
            m.lathe([(0.025, ly + 0.17), (0.025, ly + 0.23), (0.04, ly + 0.235), (0.02, ly + 0.26)], 6, BRASS, cap1=True, smooth=False)
            m.lathe([(0.02, ly - 0.2), (0.045, ly - 0.13), (0.06, ly - 0.11)], 6, IRON, cap0=True, smooth=False)
        # the bracket to the corner pillar
        m.beam((lx - s * 0.075, ly - 0.02, zf - 0.07), (s * (HW - 0.005), ly - 0.02, Z1 - 0.02), 0.03, 0.03, IRON, side=(0, 0, 1), mode="metric")
        m.beam((lx - s * 0.02, ly - 0.2, zf - 0.07), (s * (HW - 0.005), ly - 0.25, Z1 - 0.02), 0.02, 0.02, IRON, side=(0, 0, 1), mode="metric")


def brake(m):
    """The brake: a lever at the driver's right, a rod down the front; the brake beam with a shoe
    at each rear wheel, hung from the sills, its rod forward to a crank on the perch."""
    px, pz = 0.62, Z1 + 0.5
    m.box((px - 0.015, FOOT_Y, pz - 0.1), (px + 0.015, FOOT_Y + 0.14, pz + 0.1), IRON)  # the ratchet quadrant
    m.beam((px, FOOT_Y + 0.02, pz), (px, 2.32, pz - 0.14), 0.03, 0.02, IRON, side=(1, 0, 0), mode="metric")
    m.rod((px - 0.03, 2.32, pz - 0.14), (px + 0.03, 2.32, pz - 0.14), 0.02, WHEEL, sides=6, side=(0, 1, 0))
    m.rod((px, FOOT_Y - 0.03, pz), (px, 0.95, Z1 + 0.02), 0.01, IRON, sides=4, side=(1, 0, 0))
    # the rear: beam across in front of the wheels, a shoe at each tyre
    bz = R_REAR + 0.1
    m.beam((-1.0, 0.56, bz), (1.0, 0.56, bz), 0.04, 0.04, WHEEL, side=(0, 0, 1))
    for s in (-1, 1):
        x = s * TRACK_R / 2
        a0, a1 = math.radians(-13), math.radians(13)
        pts = [(x, R_REAR + (R_REAR + 0.045) * math.sin(a), (R_REAR + 0.045) * math.cos(a)) for a in np.linspace(a0, a1, 4)]
        m.tube(pts, [(0.035 * 1.414, 0.02 * 1.414)] * 4, 4, VARNISH, side=(1, 0, 0), rot=math.pi / 4, cap0=True, cap1=True, smooth=False)
        m.beam((x, 0.56, bz), (x, R_REAR - 0.05, R_REAR + 0.06), 0.03, 0.02, IRON, side=(1, 0, 0), mode="metric")
        m.beam((s * 0.74, 0.56, bz), (s * 0.74, 0.755, bz - 0.05), 0.025, 0.012, IRON, side=(1, 0, 0), mode="metric")
    m.rod((0.3, 0.56, bz), (0.3, 0.70, 1.6), 0.01, IRON, sides=4, side=(1, 0, 0))
    m.box((0.03, 0.66, 1.56), (0.3, 0.70, 1.64), IRON)


# ------------------------------------------------------------------ the paint (the line's colour)


def paint(m):
    """The lower side panels (curved in toward the sill, cut up over the front wheels), the ends'
    lower panels, the letter board's field on the sides and the ends. Each panel is fitted with
    the lined picture, so its lining runs round it inside the mouldings."""
    rows = 6
    for s in (-1, 1):
        for za, zb in zip(PANEL_Z, PANEL_Z[1:]):
            arch = zb > ARCH_C - ARCH_R
            cols = 7 if arch else 3
            zs = [za + (zb - za) * i / cols for i in range(cols + 1)]
            grid = []
            for z in zs:
                yb = bottom_y(z)
                ring = []
                for j in range(rows + 1):
                    y = yb + (WAIST_Y - yb) * j / rows
                    ring.append(((s * side_x(y), y, z), (EPS + (1 - 2 * EPS) * (z - za) / (zb - za), EPS + (1 - 2 * EPS) * j / rows)))
                grid.append(ring)
            for i in range(cols):
                for j in range(rows):
                    q = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]]
                    m.poly([p for p, _ in q], PAINT, out=(s, 0, 0), uvs=[uv for _, uv in q])
        # the letter board's field (dark), behind the board
        lo, hi = sorted((s * (HW - 0.001), s * 0.885))
        m.box((lo, BAND_TOP, Z0), (hi, 2.74, Z1), PAINT_DARK, skip=("-y", "+y"))
    # the front: the lower panel, its outer corners cut up over the wheels
    yb = bottom_y(Z1)
    pts = [(-WHEELHOUSE_X, SILL_Y), (WHEELHOUSE_X, SILL_Y), (WHEELHOUSE_X, yb)]
    pts += [(side_x(y), y) for y in np.linspace(yb, WAIST_Y, 5)]
    pts += [(-side_x(y), y) for y in np.linspace(WAIST_Y, yb, 5)]
    pts += [(-WHEELHOUSE_X, yb)]
    m.poly([(x, y, Z1) for x, y in pts], PAINT, out=(0, 0, 1), mode="fit")
    # the back: the lower panels either side of the doorway
    for s in (-1, 1):
        pts = [(s * DOOR, SILL_Y), (s * side_x(SILL_Y), SILL_Y)] + [(s * side_x(y), y) for y in np.linspace(0.9, WAIST_Y, 5)] + [(s * DOOR, WAIST_Y)]
        m.poly([(x, y, Z0) for x, y in pts], PAINT, out=(0, 0, -1), mode="fit")
    # the ends' letter-board field (the destination boards stand on the roof above)
    m.box((-HW, BAND_TOP, Z1 - 0.03), (HW, 2.74, Z1 + 0.001), PAINT_DARK, skip=("-y", "+y", "-z"))
    m.box((-HW, BAND_TOP, Z0 - 0.001), (HW, 2.74, Z0 + 0.03), PAINT_DARK, skip=("-y", "+y", "+z"))


# ------------------------------------------------------------------ the saloon (drawn near)


def interior(m):
    za, zb = Z0 + 0.06, Z1 - 0.06
    # the inside panelling: under the windows, the front wall, the back wall round the doorway
    for s in (-1, 1):
        x = s * 0.83
        m.quad((x, FLOOR_Y, za - 0.03), (x, FLOOR_Y, zb + 0.03), (x, WIN_LO, zb + 0.03), (x, WIN_LO, za - 0.03), VARNISH, nu=6, out=(-s, 0, 0), tile=0.7)
        # the sill inside, over the seat back
        m.box((min(x, s * 0.78), WIN_LO - 0.02, za - 0.03), (max(x, s * 0.78), WIN_LO + 0.004, zb + 0.03), VARNISH, seg=6)
    zfi = Z1 - 0.035
    m.poly([(-0.83, FLOOR_Y, zfi), (0.83, FLOOR_Y, zfi), (0.83, WIN_LO, zfi), (-0.83, WIN_LO, zfi)], VARNISH, out=(0, 0, -1), tile=0.7)
    zbi = Z0 + 0.035
    for s in (-1, 1):
        m.poly([(s * DOOR, FLOOR_Y, zbi), (s * 0.83, FLOOR_Y, zbi), (s * 0.83, WIN_LO, zbi), (s * DOOR, WIN_LO, zbi)], VARNISH, out=(0, 0, 1), tile=0.7)
    # the benches: a base, a varnished riser, the buttoned velvet cushion (one pad per place, a
    # sunk seam between), the back against the wall under the window, a capping rail
    for s in (-1, 1):
        xin, xout = s * 0.405, s * 0.828
        lo, hi = sorted((xin, xout))
        m.box((lo, FLOOR_Y, za), (hi, SEAT_IN_Y - 0.06, zb), VARNISH, skip=("-y", "-x" if s > 0 else "+x"), seg=6)
        m.box((min(xin, xin - s * 0.012), FLOOR_Y, za), (max(xin, xin - s * 0.012), SEAT_IN_Y - 0.075, zb), VARNISH, seg=6)
        for z in np.linspace(za + 0.3, zb - 0.3, 6):
            m.box((min(xin, xin - s * 0.02), FLOOR_Y + 0.06, z - 0.012), (max(xin, xin - s * 0.02), SEAT_IN_Y - 0.1, z + 0.012), VARNISH)
        # the pads: rolled front edge, flat top at the seat
        edges = [za] + [(a + b) / 2 for a, b in zip(SEAT_IN_Z, SEAT_IN_Z[1:])] + [zb]
        for z0, z1 in zip(edges, edges[1:]):
            z0g, z1g = z0 + 0.008, z1 - 0.008
            prof = [(xout, SEAT_IN_Y - 0.06), (xout, SEAT_IN_Y), (s * 0.47, SEAT_IN_Y), (s * 0.44, SEAT_IN_Y - 0.008),
                    (s * 0.418, SEAT_IN_Y - 0.03), (s * 0.41, SEAT_IN_Y - 0.06)]
            poly = [(x, y, z0g) for x, y in prof]
            m.prism(poly, (0, 0, z1g - z0g), VELVET, tile=0.35)
            # the seam's piping
            m.box((lo + 0.01, SEAT_IN_Y - 0.06, z1 - 0.008), (hi - 0.01, SEAT_IN_Y - 0.01, z1 + 0.008), VELVET, shade=0.5, tile=0.35)
        # the back: fluted velvet, tilted a little
        yb, yt = SEAT_IN_Y + 0.02, WIN_LO - 0.02
        for z0, z1 in zip(edges, edges[1:]):
            # (x low, x high) at the bottom and the top: the face toward the aisle leans back
            bot = sorted((s * 0.775, s * 0.826))
            top = sorted((s * 0.80, s * 0.826))
            P = []
            for z in (z0 + 0.006, z1 - 0.006):
                P += [(bot[0], yb, z), (bot[1], yb, z), (top[0], yt, z), (top[1], yt, z)]
            m.hexa(P, VELVET, tile=0.35)
        # the bench ends, by the door and at the front
        for z, o in ((za, -1), (zb, 1)):
            m.box((lo, FLOOR_Y, z - 0.01 if o < 0 else z - 0.01), (hi, SEAT_IN_Y + 0.06, z + 0.01), VARNISH)
        # the window straps, hanging over the sill from the droplights
        for zc in WINDOWS:
            m.tube([(s * 0.815, WIN_LO + 0.02, zc - 0.03), (s * 0.795, WIN_LO - 0.01, zc - 0.03), (s * 0.79, WIN_LO - 0.14, zc - 0.03)],
                   [(0.02, 0.004)] * 3, 4, STRAP, side=(0, 0, 1), rot=math.pi / 4, cap0=True, cap1=True, smooth=False)
    # straw on the floor, a few loose wisps
    m.quad((-0.40, FLOOR_Y + 0.008, za), (0.40, FLOOR_Y + 0.008, za), (0.40, FLOOR_Y + 0.008, zb), (-0.40, FLOOR_Y + 0.008, zb), STRAW, nu=2, nv=10, out=(0, 1, 0), tile=0.6)
    rng = random.Random(7)
    for _ in range(28):
        x, z = rng.uniform(-0.36, 0.36), rng.uniform(za + 0.05, zb - 0.05)
        a = rng.uniform(0, math.pi)
        L, w = rng.uniform(0.12, 0.26), 0.02
        dx, dz = math.cos(a) * L / 2, math.sin(a) * L / 2
        nx, nz = -math.sin(a) * w / 2, math.cos(a) * w / 2
        y = FLOOR_Y + 0.012 + rng.uniform(0, 0.006)
        m.poly([(x - dx - nx, y, z - dz - nz), (x + dx - nx, y + 0.004, z + dz - nz), (x + dx + nx, y + 0.004, z + dz + nz), (x - dx + nx, y, z - dz + nz)],
               STRAW, out=(0, 1, 0), mode="strip", tile=0.3)
    # the ceiling: boards, the roof's carlines across
    cy = TOP - 0.03
    m.quad((-0.83, cy, Z0 + 0.03), (0.83, cy, Z0 + 0.03), (0.83, cy, Z1 - 0.03), (-0.83, cy, Z1 - 0.03), CEILING, nu=3, nv=10, out=(0, -1, 0), tile=0.5)
    for z in [Z0 + 0.25 + i * 0.8 for i in range(5)] + [Z1 - 0.06]:
        m.box((-0.83, cy - 0.04, z - 0.025), (0.83, cy, z + 0.025), VARNISH)
    # a brass grab rail along each side of the ceiling, on hangers
    for s in (-1, 1):
        x = s * 0.5
        m.rod((x, 2.5, Z0 + 0.2), (x, 2.5, Z1 - 0.2), 0.012, BRASS, sides=6)
        for z in [Z0 + 0.25 + i * 0.8 for i in range(5)]:
            m.rod((x, 2.5, z), (x, cy - 0.04, z), 0.007, BRASS, sides=4, side=(1, 0, 0))
    # the check-string to the driver: eyes on the carlines, its end to pull by the door
    m.rod((0.35, 2.62, Z0 + 0.2), (0.35, 2.62, Z1 - 0.02), 0.005, STRAP, sides=3)
    m.tube([(0.35, 2.62, Z0 + 0.25), (0.352, 2.48, Z0 + 0.26), (0.35, 2.36, Z0 + 0.25)], [0.006, 0.006, 0.014], 4, STRAP, cap0=True, cap1=True, smooth=False)
    for z in [Z0 + 0.25 + i * 0.8 for i in range(5)]:
        m.rod((0.35, 2.62, z), (0.35, cy - 0.04, z), 0.004, BRASS, sides=3, side=(1, 0, 0))
    # the oil lamp on the front bulkhead, its glass toward the saloon (LAMPS[2]), the smoke hood
    lx, ly, lz = LAMPS[2]
    zf = lz + 0.012
    m.box((lx - 0.075, ly - 0.1, zf), (lx + 0.075, ly + 0.1, zf + 0.12), BRASS)
    for y0, y1 in ((ly - 0.095, ly - 0.07), (ly + 0.07, ly + 0.095)):
        m.box((lx - 0.075, y0, zf - 0.015), (lx + 0.075, y1, zf + 0.004), BRASS)
    for x0, x1 in ((lx - 0.075, lx - 0.05), (lx + 0.05, lx + 0.075)):
        m.box((x0, ly - 0.07, zf - 0.015), (x1, ly + 0.07, zf + 0.004), BRASS)
    m.box((lx - 0.03, ly - 0.03, zf + 0.12), (lx + 0.03, ly + 0.03, Z1 - 0.035), IRON)
    with m.at(move(lx, 0, zf + 0.06) @ LATHE_UP):
        m.lathe([(0.09, ly + 0.1), (0.05, ly + 0.18), (0.02, ly + 0.22), (0.02, cy - 0.001)], 8, BRASS, smooth=False)
        m.lathe([(0.015, ly - 0.2), (0.05, ly - 0.14), (0.075, ly - 0.1)], 8, BRASS, cap0=True, smooth=False)


def far_glass(m):
    """Dark glass in the openings, for an omnibus seen from afar (its saloon is not drawn then)."""
    for s in (-1, 1):
        for z in WINDOWS:
            x0, x1 = sorted((s * (HW - 0.025), s * (HW - 0.005)))
            m.box((x0, WIN_LO, z - WIN_W / 2), (x1, WIN_HI, z + WIN_W / 2), GLASS, mode="fit")
    m.box((-0.45, WIN_LO, Z1 - 0.025), (0.45, WIN_HI, Z1 - 0.005), GLASS, mode="fit")
    m.box((-DOOR, FLOOR_Y, Z0 + 0.01), (DOOR, DOOR_TOP, Z0 + 0.03), GLASS, mode="fit")


# ------------------------------------------------------------------ the wheels and the front carriage


def wheel(m, x, r, spokes, segs, tyre_w=0.07):
    """A carriage wheel on the axle at (x, 0, 0): iron tyre, ochre felloes and spokes (lined), a
    wooden nave with iron bands, a brass cap on its outer end."""
    s = 1 if x > 0 else -1
    fel = r * 0.11
    hub_r = r * 0.17
    hub_l = 0.26 if r > 0.5 else 0.22
    with m.at(move(x, 0, 0) @ rot_y(s * math.pi / 2)):
        m.lathe([(r, -tyre_w / 2), (r, tyre_w / 2), (r - 0.016, tyre_w / 2), (r - 0.016, -tyre_w / 2)], segs, IRON, closed_v=True,
                smooth=False, urep=6, vscale=4)
        fw = tyre_w - 0.012
        m.lathe([(r - 0.016, -fw / 2), (r - 0.016, fw / 2), (r - fel, fw / 2), (r - fel, -fw / 2)], segs, WHEEL, closed_v=True,
                smooth=False, cells=[WHEEL, WHEEL, WHEEL, WHEEL], urep=6, vscale=2)
        # the nave, the bands round it, the brass cap outside
        m.lathe([(hub_r * 0.7, -hub_l / 2), (hub_r, -hub_l * 0.2), (hub_r, hub_l * 0.2), (hub_r * 0.8, hub_l / 2)], 10, WHEEL,
                smooth=False, urep=2, vscale=2)
        for zb in (-hub_l * 0.22, hub_l * 0.22):
            m.lathe([(hub_r + 0.006, zb - 0.012), (hub_r + 0.006, zb + 0.012)], 10, IRON, smooth=False, urep=2)
        m.lathe([(hub_r * 0.62, hub_l / 2 - 0.005), (hub_r * 0.62, hub_l / 2 + 0.045), (hub_r * 0.45, hub_l / 2 + 0.06)], 10, BRASS,
                cap1=True, smooth=False, urep=2)
        m.lathe([(hub_r * 0.72, -hub_l / 2 - 0.02), (hub_r * 0.72, -hub_l / 2 + 0.002)], 10, IRON, cap0=True, smooth=False)
        sw = max(0.03, r * 0.06)
        for k in range(spokes):
            a = 2 * math.pi * (k + 0.5) / spokes
            d = Vector((math.cos(a), math.sin(a), 0))
            # a little dish: the spokes lean out toward the rim
            m.beam(d * hub_r * 0.85 + Vector((0, 0, -0.01)), d * (r - fel * 0.5) + Vector((0, 0, 0.008)), sw, sw * 1.25, WHEEL,
                   side=(0, 0, 1), caps=False, w2=sw * 0.8, h2=sw * 1.0, tile=0.6)


def wheels(m, r, track, spokes, segs):
    for x in (-track / 2, track / 2):
        wheel(m, x, r, spokes, segs)
    # the axle turns with the pair (one part): round, so it does not show
    m.rod((-track / 2 - 0.1, 0, 0), (track / 2 + 0.1, 0, 0), 0.04, IRON, sides=8, side=(0, 1, 0))


def fore(m):
    """The front carriage, origin at the pivot on the ground (+z toward the horses): the lower ring
    of the fifth wheel, the bolster on the springs, the springs on the axle (the axle turns with the
    wheels), the futchells, the sway bar, the splinter bar with its swingletrees, the pole, its
    chains to the collars, the traces to the hames."""
    with m.at(LATHE_UP):
        m.lathe([(0.55, 0.718), (0.55, 0.742), (0.50, 0.742), (0.50, 0.718)], 16, IRON, closed_v=True, smooth=False, urep=4, vscale=4)
    # the bolster across, on the springs
    m.box((-0.7, 0.645, -0.07), (0.7, 0.718, 0.07), WHEEL)
    for s in (-1, 1):
        spring(m, (s * 0.60, 0.585, 0.0), 0.8, 0.028, width=0.055, leaves=3)
        m.box((s * 0.60 - 0.035, R_FRONT - 0.052, -0.03), (s * 0.60 + 0.035, R_FRONT - 0.044, 0.03), IRON)
        for dz in (-0.025, 0.025):
            m.box((s * 0.60 - 0.035, R_FRONT - 0.052, dz - 0.005), (s * 0.60 - 0.028, 0.54, dz + 0.005), IRON)
            m.box((s * 0.60 + 0.028, R_FRONT - 0.052, dz - 0.005), (s * 0.60 + 0.035, 0.54, dz + 0.005), IRON)
    # the futchells from behind the bolster to the splinter bar; the sway bar joining their tails
    sb_z = 1.45
    for s in (-1, 1):
        m.beam((s * 0.3, 0.68, -0.52), (s * 0.22, 0.72, sb_z + 0.05), 0.055, 0.065, WHEEL, side=(1, 0, 0))
    arc = [(0.5 * math.sin(a), 0.70, -0.5 * math.cos(a)) for a in np.linspace(-0.75, 0.75, 6)]
    m.tube(arc, [0.02] * 6, 4, IRON, cap0=True, cap1=True, smooth=False, rot=math.pi / 4)
    # the splinter bar, iron-shod at the ends; the swingletrees on it, their hooks
    m.beam((-0.82, 0.75, sb_z), (0.82, 0.75, sb_z), 0.07, 0.06, WHEEL, side=(0, 0, 1))
    for s in (-1, 1):
        m.box((s * 0.82 - 0.03, 0.715, sb_z - 0.04), (s * 0.82 + 0.03, 0.785, sb_z + 0.04), IRON)
        cx = s * 0.55
        m.box((cx - 0.02, 0.73, sb_z + 0.03), (cx + 0.02, 0.77, sb_z + 0.16), IRON)
        m.beam((cx - 0.40, 0.75, sb_z + 0.17), (cx + 0.40, 0.75, sb_z + 0.17), 0.05, 0.05, WHEEL, side=(0, 0, 1), w2=0.05, h2=0.05)
        for e in (-0.40, 0.40):
            m.box((cx + e - 0.025, 0.735, sb_z + 0.15), (cx + e + 0.025, 0.765, sb_z + 0.19), IRON)
    # the pole: its heel between the futchells, rising between the horses to the pole head
    tip = Vector((0, 1.28, HORSES + 1.12))
    heel = Vector((0, 0.66, -0.45))
    m.beam(tuple(heel), tuple(tip), 0.085, 0.09, WHEEL, side=(1, 0, 0), w2=0.055, h2=0.06)
    d = (tip - heel).normalized()
    m.beam(tuple(tip - d * 0.15), tuple(tip + d * 0.05), 0.07, 0.075, IRON, side=(1, 0, 0), w2=0.05, h2=0.05)
    # the pole chains, link by link, to the kidney link under each collar (build_props.py KIDNEY)
    for s in (-1, 1):
        a = tip + Vector((s * 0.03, 0, 0))
        b = Vector((s * 0.55, 1.385, HORSES + 1.2))
        n = 7
        for i in range(n):
            p0 = a + (b - a) * (i / n)
            p1 = a + (b - a) * ((i + 1) / n)
            sag = Vector((0, -0.03 * math.sin(math.pi * (i + 0.5) / n), 0))
            m.beam(tuple(p0 + sag), tuple(p1 + sag), 0.014 if i % 2 else 0.006, 0.006 if i % 2 else 0.014, IRON, side=(0, 1, 0), mode="metric")
    # the traces: from the swingletrees' ends along the horses' flanks to the hames
    for s in (-1, 1):
        cx = s * 0.55
        for e in (-1, 1):
            a = Vector((cx + e * 0.40, 0.75, sb_z + 0.19))
            b = Vector((cx + e * 0.31, 1.52, HORSES + 0.8))
            m.beam(tuple(a), tuple(b), 0.035, 0.01, STRAP, side=(0, 1, 0), mode="strip", tile=0.5)


# ------------------------------------------------------------------ preview


def preview_materials(paint_rgb=(0.4, 0.52, 0.42)):
    mt = bpy.data.materials["omnibus"]
    nt = mt.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    nt.links.new(vc.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    mt.use_backface_culling = True
    uv = nt.nodes.new("ShaderNodeUVMap")
    uv.uv_map = "UVMap"
    cell = nt.nodes.new("ShaderNodeUVMap")
    cell.uv_map = "Cell"
    fr = nt.nodes.new("ShaderNodeVectorMath")
    fr.operation = "FRACTION"
    nt.links.new(uv.outputs["UV"], fr.inputs[0])
    sf = nt.nodes.new("ShaderNodeSeparateXYZ")
    sc = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(fr.outputs["Vector"], sf.inputs[0])
    nt.links.new(cell.outputs["UV"], sc.inputs[0])

    def math_node(op, a, b):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for k, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[k].default_value = v
            else:
                nt.links.new(v, n.inputs[k])
        return n.outputs[0]

    u = math_node("DIVIDE", math_node("ADD", sc.outputs["X"], sf.outputs["X"]), N)
    row = math_node("SUBTRACT", N - 1, sc.outputs["Y"])
    v = math_node("DIVIDE", math_node("ADD", row, sf.outputs["Y"]), N)
    cmb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(u, cmb.inputs["X"])
    nt.links.new(v, cmb.inputs["Y"])
    nt.links.new(cmb.outputs["Vector"], tex.inputs["Vector"])
    # the paint part: the line's colour multiplied in (the game's instance colour)
    pm = mt.copy()
    pm.name = "omnibus_paint_prev"
    pnt = pm.node_tree
    pb = pnt.nodes.get("Principled BSDF")
    src = pb.inputs["Base Color"].links[0].from_socket
    mul = pnt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs[0].default_value = 1.0
    mul.inputs[7].default_value = (*paint_rgb, 1)
    pnt.links.new(src, mul.inputs[6])
    pnt.links.new(mul.outputs[2], pb.inputs["Base Color"])
    return pm


def stage():
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("fog")
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.30, 0.32, 0.35, 1)
        bg.inputs[1].default_value = 1.0
    except AttributeError:
        pass
    sc.world = world
    ground = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    for p in [(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)]:
        bm.verts.new(p)
    bm.faces.new(bm.verts)
    bm.to_mesh(ground)
    gm = bpy.data.materials.new("ground_prev")
    gm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.12, 0.12, 0.11, 1)
    ground.materials.append(gm)
    g = bpy.data.objects.new("ground", ground)
    sc.collection.objects.link(g)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(-40))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_start = 0.02
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def gpos(x, y, z):
    """A point in the game's frame, in Blender's."""
    return Vector((x, -z, y))


def aim(cam, eye, target, lens=30):
    cam.location = gpos(*eye)
    d = gpos(*target) - gpos(*eye)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


VIEWS = {
    "side": ((-7.5, 1.7, 2.0), (0, 1.5, 1.6), 26),
    "front34": ((-4.5, 2.4, 8.5), (0, 1.5, 2.2), 26),
    "rear34": ((3.8, 2.2, -5.0), (0, 1.5, -0.6), 26),
    "box": ((-1.6, 2.7, 5.4), (0, 2.0, 3.7), 30),
    "wheel": ((-2.2, 0.9, -1.4), (-0.95, 0.62, 0.0), 30),
    "fwheel": ((-2.0, 0.9, 4.3), (-0.8, 0.6, 2.9), 30),
    "under": ((-2.4, 0.35, 1.3), (0, 0.72, 1.4), 26),
    "roof": ((-2.2, 4.4, -2.4), (0, 2.9, 1.0), 26),
    "inside": ((0.0, 1.55, -0.95), (0.0, 1.35, 2.6), 22),
    "inside2": ((0.3, 1.5, 2.8), (-0.4, 1.2, -0.6), 22),
    "fore": ((-2.8, 1.6, 6.6), (0, 0.9, 4.6), 26),
    "platform": ((-1.3, 1.9, -4.0), (-0.3, 1.5, -1.5), 28),
    "top": ((0.01, 9.0, 1.5), (0, 0, 1.5), 35),
}


def assemble(objs):
    """Put the parts where the game puts them: body, paint, interior at the rear axle's foot, the
    wheels on their axles, the front carriage at the pivot."""
    place = {"omnibus_rear_wheels": (0, R_REAR, 0), "omnibus_front_wheels": (0, R_FRONT, WHEELBASE), "omnibus_fore": (0, 0, WHEELBASE)}
    for name, o in objs.items():
        o.location = gpos(*place.get(name, (0, 0, 0)))


def render(path, res=(1280, 800)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[build_omnibus] render -> {path}")


def closeups(objs, names, out_dir):
    pm = preview_materials()
    objs["omnibus_paint"].data.materials[0] = pm
    cam = stage()
    assemble(objs)
    objs["omnibus_far_glass"].hide_render = True
    for n in names:
        eye, target, lens = VIEWS[n]
        aim(cam, eye, target, lens)
        render(os.path.join(out_dir, f"omni_bl_{n}.png"))


# ------------------------------------------------------------------ main

PARTS = [
    ("omnibus_body", lambda m: body(m), 0.45),
    ("omnibus_paint", lambda m: paint(m), 0.45),
    ("omnibus_interior", lambda m: interior(m), 0.0),
    ("omnibus_far_glass", lambda m: far_glass(m), 0.0),
    ("omnibus_rear_wheels", lambda m: wheels(m, R_REAR, TRACK_R, 14, 22), 0.0),
    ("omnibus_front_wheels", lambda m: wheels(m, R_FRONT, TRACK_F, 12, 18), 0.0),
    ("omnibus_fore", lambda m: fore(m), 0.45),
]


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------ the flicker check (--zcheck)

# the game's own quads on the body (world/omnibus.ts BOARDS) and the lamp glass (0.1 x 0.14 x 0.03 boxes)
def game_faces():
    out = []
    boards = [((-(HW + 0.035), BOARD_Y, 1.02), (0, 0, 1), (-1, 0, 0), 4.0, 0.22), ((HW + 0.035, BOARD_Y, 1.02), (0, 0, -1), (1, 0, 0), 4.0, 0.22),
              ((0, ROOF_Y + 0.18, Z1 + 0.2), (1, 0, 0), (0, 0, 1), 1.5, 0.26), ((0, ROOF_Y + 0.18, Z0 - 0.2), (-1, 0, 0), (0, 0, -1), 1.5, 0.26)]
    for s in (-1, 1):
        for z in WINDOWS:
            boards.append(((s * (HW - 0.035), 2.37, z), (0, 0, s), (-s, 0, 0), WIN_W, 0.17))
    for c, r, n, w, h in boards:
        c, r, n = Vector(c), Vector(r), Vector(n)
        u = UP
        q = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
        out += [("board", [q[0], q[1], q[2]], n), ("board", [q[0], q[2], q[3]], n)]
    for x, y, z in LAMPS:
        for sz in (-1, 1):
            n = Vector((0, 0, sz))
            zz = z + sz * 0.015
            q = [Vector((x - 0.05, y - 0.07, zz)), Vector((x + 0.05, y - 0.07, zz)), Vector((x + 0.05, y + 0.07, zz)), Vector((x - 0.05, y + 0.07, zz))]
            out += [("lamp glass", [q[0], q[1], q[2]], n), ("lamp glass", [q[0], q[2], q[3]], n)]
    return out


def mesh_faces(ob, label):
    """The object's triangles in the game's frame."""
    back = TO_BLENDER.inverted()
    me = ob.data
    me.calc_loop_triangles()
    out = []
    for t in me.loop_triangles:
        pts = [back @ me.vertices[i].co for i in t.vertices]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n.length < 1e-10:
            continue
        out.append((label, pts, n.normalized()))
    return out


def clip_area(a, b):
    """Area of the overlap of two convex 2D polygons (Sutherland-Hodgman)."""
    def inside(p, e0, e1):
        return (e1[0] - e0[0]) * (p[1] - e0[1]) - (e1[1] - e0[1]) * (p[0] - e0[0]) >= -1e-12

    def inter(p, q, e0, e1):
        dx, dy = q[0] - p[0], q[1] - p[1]
        ex, ey = e1[0] - e0[0], e1[1] - e0[1]
        den = dx * ey - dy * ex
        if abs(den) < 1e-15:
            return q
        t = ((e0[0] - p[0]) * ey - (e0[1] - p[1]) * ex) / den
        return (p[0] + dx * t, p[1] + dy * t)

    def area(poly):
        return 0.5 * sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))

    if area(a) < 0:
        a = a[::-1]
    if area(b) < 0:
        b = b[::-1]
    out = a
    for i in range(len(b)):
        e0, e1 = b[i], b[(i + 1) % len(b)]
        inp, out = out, []
        if not inp:
            break
        for j in range(len(inp)):
            p, q = inp[j], inp[(j + 1) % len(inp)]
            if inside(q, e0, e1):
                if not inside(p, e0, e1):
                    out.append(inter(p, q, e0, e1))
                out.append(q)
            elif inside(p, e0, e1):
                out.append(inter(p, q, e0, e1))
    return abs(area(out)) if len(out) >= 3 else 0.0


def zcheck(objs):
    """Same-facing faces that lie in one plane (within 5 mm: they flicker) or close over it (within
    2 cm: the PS1 wobble makes them fight when seen askew), for the parts drawn together."""
    sets = {
        "near (body, paint, interior, boards, lamps)": ["omnibus_body", "omnibus_paint", "omnibus_interior"],
        "far (body, paint, far glass, boards, lamps)": ["omnibus_body", "omnibus_paint", "omnibus_far_glass"],
        "front carriage": ["omnibus_fore"],
        "rear wheels": ["omnibus_rear_wheels"],
        "front wheels": ["omnibus_front_wheels"],
    }
    for title, names in sets.items():
        faces = [f for n in names for f in mesh_faces(objs[n], n.replace("omnibus_", ""))]
        if "body" in names[0]:
            faces += game_faces()
        buckets = {}
        for i, (_, pts, n) in enumerate(faces):
            key = (round(n.x * 20), round(n.y * 20), round(n.z * 20))
            buckets.setdefault(key, []).append(i)
        found = {"fights": [], "thin": []}
        seen = set()
        for key, idx in buckets.items():
            # neighbours in the normal grid too
            near_keys = [(key[0] + a, key[1] + b, key[2] + c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)]
            pool = [j for k in near_keys for j in buckets.get(k, [])]
            for i in idx:
                li, pi, ni = faces[i]
                d0 = ni.dot(pi[0])
                ua = ni.orthogonal().normalized()
                va = ni.cross(ua)
                a2 = [(p.dot(ua), p.dot(va)) for p in pi]
                for j in pool:
                    if j <= i or (i, j) in seen:
                        continue
                    lj, pj, nj = faces[j]
                    if ni.dot(nj) < 0.9994:
                        continue
                    dist = max(abs(ni.dot(p) - d0) for p in pj)
                    if dist > 0.02:
                        continue
                    seen.add((i, j))
                    b2 = [(p.dot(ua), p.dot(va)) for p in pj]
                    ov = clip_area(a2, b2)
                    if ov < 0.01:
                        continue
                    c = sum(pi, Vector()) / 3
                    found["fights" if dist < 0.005 else "thin"].append((round(ov, 4), round(dist, 4), li, lj, tuple(round(v, 2) for v in c)))
        for k, lst in found.items():
            lst.sort(reverse=True)
            print(f"[zcheck] {title}: {k} {len(lst)}")
            for item in lst[:12]:
                print(f"[zcheck]    {item}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_material()
    objs = {}
    for name, fn, ao in PARTS:
        m = Mesh(ao=ao)
        fn(m)
        objs[name] = m.to_object(name)
    counts = {n: tris(o) for n, o in objs.items()}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_omnibus] {n:22s} {c:5d} tris")
    print(f"[build_omnibus] {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--zcheck" in argv:
        zcheck(objs)
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = list(VIEWS) if argv[i + 1] == "all" else argv[i + 1].split(",")
        out_dir = os.path.abspath(argv[i + 2]) if len(argv) > i + 2 else SHOTS
        closeups(objs, names, out_dir)


if __name__ == "__main__":
    main()
