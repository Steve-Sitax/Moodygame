"""Street and quay trees of Antwerp, autumn 1873.

    blender -b --factory-startup -P tools/blender/build_trees.py
    blender -b --factory-startup -P tools/blender/build_trees.py -- --preview

Writes client/public/models/trees.glb (Draco): one node per tree kind, standing on its
origin, real size in metres. client/src/world/trees3d.ts instances them on the DECOR
"trees" positions of tools/city/design.py (the Steenplein rows and the Werf).

  tree_lime     a young lime, about 8.5 m: a straight leader, an egg-shaped crown, leaves gone
                yellow with a little green left
  tree_elm      an elm, about 10 m: the trunk splits into a vase of steep limbs with arching
                ends; yellow and brown leaves, some green
  tree_plane    a plane, about 10 m: mottled bark, three scaffold limbs, half bare (October):
                rust and brown leaves, seed balls on the bare twigs
  tree_bare     an elm already bare, about 10 m: the branch structure and sprays of fine twigs, a few
                dry leaves left
  tree_willow   a pollarded willow for a canal bank, about 5.5 m: a thick trunk, a knobbly head
                and a crown of straight yellow shoots (not placed on the current map)

Branches are low-poly tapered tubes (7 sides on the trunk, then 5, 4, 3) that fork. The
crowns are crossed leaf cards (two quads) clustered at the twig ends, with thin places where
the sky shows through. Leaf-card normals point out of the crown and up, so the sky lights the
leaves on every side (the game draws them double sided and does not flip the back).

Materials, by name: tree_bark (a 128x128 bark image: fissured bark on the left half, mottled
plane bark on the right; tiles along the branch) and tree_leaves (a 256x128 RGBA atlas, 4 x 2
cells of leaf clusters and twig sprays; alpha tested). Vertex colour "Col" = tint and a baked
shade. Everything is painted and built by this script: our own work, no reference images,
no downloaded models or textures.

Blender is Z-up; the glTF export turns it Y-up: Blender (x, y, z) is game (x, z, -y).

--preview renders the trees to data/shots/trees_preview.png.
"""

import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "trees.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

BARK, LEAF = 0, 1
MAT_NAMES = ["tree_bark", "tree_leaves"]
UP = Vector((0.0, 0.0, 1.0))
TAU = 2.0 * math.pi

# ------------------------------------------------------------------ painting

CELL = 64
AW, AH = 256, 128  # leaf atlas: 4 x 2 cells
BW = 128  # bark: two 64 x 128 halves


def vnoise(rng, w, h, cu, cv):
    """Tileable value noise, [h, w], 0..1."""
    g = rng.random((cv, cu))

    def axis(n, c):
        t = np.arange(n) * c / n
        i0 = np.floor(t).astype(int) % c
        f = t - np.floor(t)
        return i0, (i0 + 1) % c, f * f * (3 - 2 * f)

    u0, u1, fu = axis(w, cu)
    v0, v1, fv = axis(h, cv)
    a = g[np.ix_(v0, u0)]
    b = g[np.ix_(v0, u1)]
    c = g[np.ix_(v1, u0)]
    d = g[np.ix_(v1, u1)]
    fu = fu[None, :]
    fv = fv[:, None]
    return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv


def paint_bark(surface=False):
    rng = np.random.default_rng(31)
    img = np.ones((BW, BW, 4))
    # left: fissured bark of lime and elm, furrows running up the trunk
    w, h = 64, 128
    ridge = vnoise(rng, w, h, 9, 5) * 0.7 + vnoise(rng, w, h, 18, 11) * 0.3
    fine = vnoise(rng, w, h, 32, 64)
    lichen = vnoise(rng, w, h, 4, 6)
    col = np.array([0.40, 0.37, 0.33]) * (0.85 + 0.3 * fine)[..., None]
    fur = ridge < 0.42
    col[fur] = np.array([0.16, 0.14, 0.12]) * (0.9 + 0.2 * fine[fur])[..., None]
    edge = (ridge >= 0.42) & (ridge < 0.47)
    col[edge] *= 0.72
    lm = lichen > 0.7
    col[lm] = col[lm] * 0.5 + np.array([0.44, 0.5, 0.38]) * 0.5
    img[:, :64, :3] = col
    height = np.ones((BW, BW)) * 0.5
    # The same fissures as the colour; lichen and colour variation are pigment, not pits.
    height[:, :64] = np.clip((ridge - 0.35) * 1.7, 0.15, 0.75) + (fine - 0.5) * 0.035
    # right: plane bark, flaking in patches of cream, olive grey and brown grey
    n = vnoise(rng, w, h, 5, 9) * 0.75 + vnoise(rng, w, h, 13, 21) * 0.25
    fine = vnoise(rng, w, h, 32, 64)
    col = np.zeros((h, w, 3))
    col[:] = np.array([0.38, 0.34, 0.27])
    col[n < 0.6] = np.array([0.48, 0.47, 0.37])
    col[n < 0.36] = np.array([0.68, 0.64, 0.50])
    for lo in (0.36, 0.6):
        b = np.abs(n - lo) < 0.018
        col[b] *= 0.7
    col *= (0.9 + 0.2 * fine)[..., None]
    img[:, 64:, :3] = col
    # Plane bark flakes are shallow shelves, not the brightness of the cream patches.
    height[:, 64:] = np.where(n < 0.36, 0.49, np.where(n < 0.6, 0.53, 0.57)) + (fine - 0.5) * 0.025
    if surface:
        img[..., 0] = height
        img[..., 1] = 0.9
        img[..., 2] = 0.035
    return img


# autumn palettes (painted colours; the vertex tint shifts them further)
YELLOW = [(0.72, 0.62, 0.25), (0.66, 0.53, 0.20), (0.80, 0.70, 0.36), (0.59, 0.46, 0.20)]
RUST = [(0.64, 0.31, 0.12), (0.74, 0.42, 0.14), (0.52, 0.25, 0.10), (0.80, 0.53, 0.20)]
BROWN = [(0.46, 0.31, 0.15), (0.56, 0.39, 0.18), (0.38, 0.25, 0.12)]
GREEN = [(0.42, 0.50, 0.18), (0.55, 0.58, 0.20), (0.34, 0.42, 0.16)]
TWIG = (0.20, 0.16, 0.13)


def shape_in(shape, u, v):
    """Is (u along the leaf from its base, v across; in leaf lengths) inside the leaf?"""
    su = np.clip(u, 0.0, 1.0)
    s = np.sin(math.pi * su)
    if shape == "heart":  # lime: broad, pointed, a little heart at the base
        w = 0.44 * s ** 0.5 * (1.15 - 0.55 * su)
    elif shape == "oval":  # elm: small, oval, toothed
        w = 0.30 * s ** 0.7 * (1.0 + 0.12 * np.sin(su * 30.0))
    elif shape == "lance":  # willow: long and narrow
        w = 0.10 * s ** 0.6
    else:  # "palm": plane, five lobes round the middle of the blade
        du = u - 0.5
        r = np.hypot(du, v)
        th = np.arctan2(v, du)
        return r < 0.5 * (0.5 + 0.5 * np.abs(np.cos(2.5 * th)) ** 1.6)
    return (u >= 0.0) & (u <= 1.0) & (np.abs(v) < w)


def put_leaf(img, ox, oy, bx, by, ang, length, shape, rgb, rng):
    """One leaf into the atlas cell at (ox, oy): base at (bx, by) in cell pixels (y down),
    pointing at angle `ang` (0 = up)."""
    ax = np.array([math.sin(ang), -math.cos(ang)])
    px = np.array([math.cos(ang), math.sin(ang)])
    R = int(length) + 2
    x0, x1 = max(1, int(bx) - R), min(CELL - 1, int(bx) + R + 1)
    y0, y1 = max(1, int(by) - R), min(CELL - 1, int(by) + R + 1)
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dx = xs + 0.5 - bx
    dy = ys + 0.5 - by
    u = (dx * ax[0] + dy * ax[1]) / length
    v = (dx * px[0] + dy * px[1]) / length
    inside = shape_in(shape, u, v)
    if not inside.any():
        return
    pad = np.pad(inside, 1)
    rim = inside & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    base = np.array(rgb) * rng.uniform(0.88, 1.1)
    col = np.broadcast_to(base, inside.shape + (3,)).copy()
    col[v > 0] *= 1.1  # one half catches the light
    vein = inside & (np.abs(v) < 0.04) & (u > 0.05) & (u < 0.85)
    col[vein] *= 0.76
    col[rim] *= 0.62
    blk = img[oy + y0:oy + y1, ox + x0:ox + x1]
    blk[inside, :3] = np.clip(col[inside], 0, 1)
    blk[inside, 3] = 1.0


def put_line(img, ox, oy, a, b, rgb, width=1):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * 2) + 2
    for i in range(n + 1):
        t = i / n
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        for dx in range(width):
            xx, yy = int(x) + dx, int(y)
            if 1 <= xx < CELL - 1 and 1 <= yy < CELL - 1:
                img[oy + yy, ox + xx, :3] = rgb
                img[oy + yy, ox + xx, 3] = 1.0


def twig_spray(img, ox, oy, rng, a, ang, length, depth, width):
    """Fine twigs forking from a (cell pixels), drawn as lines."""
    b = (a[0] + math.sin(ang) * length, a[1] - math.cos(ang) * length)
    put_line(img, ox, oy, a, b, np.array(TWIG) * rng.uniform(0.8, 1.2), width)
    if depth == 0:
        return [b]
    tips = []
    for s in (-1, 1):
        tips += twig_spray(img, ox, oy, rng, b, ang + s * rng.uniform(0.3, 0.6), length * rng.uniform(0.6, 0.78), depth - 1, 1)
    return tips


def cluster(img, ci, shape, palette, n, size, rng, spread=24.0, twigs=True, cy=28.0):
    """A cluster of leaves on a few twigs coming up from the bottom middle of cell ci."""
    ox, oy = (ci % 4) * CELL, (ci // 4) * CELL
    cols, weights = zip(*palette)
    weights = np.array(weights) / sum(weights)
    if twigs:
        for _ in range(3):
            twig_spray(img, ox, oy, rng, (32 + rng.uniform(-3, 3), 62), rng.uniform(-0.6, 0.6), rng.uniform(12, 18), 1, 2)
    for _ in range(n):
        r = spread * math.sqrt(rng.random())
        a = rng.random() * TAU
        x = 32 + r * math.cos(a)
        y = cy + r * math.sin(a) * 0.9
        ang = math.atan2(x - 32, 54 - y) + rng.uniform(-0.6, 0.6)  # leaves point out from the twigs
        L = rng.uniform(*size)
        bx = x - math.sin(ang) * L * 0.4
        by = y + math.cos(ang) * L * 0.4
        group = cols[rng.choice(len(cols), p=weights)]
        rgb = group[rng.integers(len(group))]
        put_leaf(img, ox, oy, bx, by, ang, L, shape, rgb, rng)


def paint_leaves():
    rng = np.random.default_rng(73)
    img = np.zeros((AH, AW, 4))
    # 0, 1: lime, yellow; yellow with green left
    cluster(img, 0, "heart", [(YELLOW, 0.75), (BROWN, 0.12), (GREEN, 0.13)], 30, (10, 14), rng)
    cluster(img, 1, "heart", [(YELLOW, 0.5), (GREEN, 0.38), (RUST, 0.12)], 30, (10, 14), rng)
    # 2: plane, rust and brown, big lobed leaves
    cluster(img, 2, "palm", [(RUST, 0.55), (BROWN, 0.3), (YELLOW, 0.15)], 15, (15, 20), rng)
    # 3: plane, half bare: few leaves, bare twigs, seed balls on long stalks
    ox, oy = 3 * CELL, 0
    for _ in range(2):
        twig_spray(img, ox, oy, rng, (32 + rng.uniform(-4, 4), 62), rng.uniform(-0.5, 0.5), rng.uniform(14, 18), 2, 2)
    for _ in range(3):
        sx, sy = rng.uniform(14, 50), rng.uniform(14, 34)
        put_line(img, ox, oy, (sx, sy - 7), (sx, sy), np.array(TWIG), 1)
        yy, xx = np.mgrid[-3:4, -3:4]
        m = xx * xx + yy * yy <= 9
        for (dy, dx) in zip(*np.nonzero(m)):
            X, Y = int(sx) + dx - 3, int(sy) + dy - 3
            img[oy + Y, ox + X, :3] = np.array([0.42, 0.30, 0.16]) * (0.75 if (dx + dy) % 3 == 0 else 1.0)
            img[oy + Y, ox + X, 3] = 1
    cluster(img, 3, "palm", [(BROWN, 0.6), (RUST, 0.4)], 6, (14, 18), rng, spread=20, twigs=False)
    # 4, 5: elm, small oval leaves: yellow and brown; green and yellow
    cluster(img, 4, "oval", [(YELLOW, 0.55), (BROWN, 0.3), (RUST, 0.15)], 46, (8, 11), rng)
    cluster(img, 5, "oval", [(YELLOW, 0.45), (GREEN, 0.45), (BROWN, 0.1)], 46, (8, 11), rng)
    # 6: willow, narrow yellow leaves hanging from a shoot across the top of the cell
    ox, oy = 2 * CELL, CELL
    for k in range(3):
        y0 = 6 + k * 3
        put_line(img, ox, oy, (4, y0 + rng.uniform(-2, 2)), (60, y0 + rng.uniform(-2, 2)), np.array([0.46, 0.40, 0.18]), 1)
        for i in range(12):
            x = 6 + i * 4.6 + rng.uniform(-1.5, 1.5)
            ang = math.pi + rng.uniform(-0.5, 0.5)  # hanging down
            L = rng.uniform(22, 34)
            put_leaf(img, ox, oy, x, y0 + 1, ang, L, "lance", YELLOW[rng.integers(4)] if rng.random() < 0.8 else GREEN[rng.integers(3)], rng)
    # 7: a spray of bare twigs, and two dry leaves
    ox, oy = 3 * CELL, CELL
    for a in (-0.35, 0.0, 0.35):
        twig_spray(img, ox, oy, rng, (32, 62), a + rng.uniform(-0.1, 0.1), rng.uniform(15, 19), 3, 2)
    for _ in range(2):
        put_leaf(img, ox, oy, rng.uniform(16, 48), rng.uniform(16, 30), rng.uniform(2.5, 3.8), 9, "oval", BROWN[rng.integers(3)], rng)
    return img


LEAF_CELLS = {"lime": [0, 1], "elm": [4, 5], "plane": [2], "plane_sparse": [3], "willow": [6], "twigs": [7]}


def cell_uv(ci, x, y):
    """UV in the leaf atlas: (x, y) 0..1 in the cell, y = 0 at the bottom of the painting."""
    col, row = ci % 4, ci // 4
    inset = 0.5 / CELL
    x = inset + x * (1 - 2 * inset)
    y = inset + y * (1 - 2 * inset)
    return ((col + x) * CELL / AW, 1 - (row * CELL + (1 - y) * CELL) / AH)


def bl_image(name, arr, alpha):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=alpha)
    rgba = np.clip(arr[::-1], 0, 1).astype(np.float32).copy()
    if not alpha:
        rgba[..., 3] = 1
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def make_materials():
    bark = bl_image("tree_bark_tex", paint_bark(), False)
    surface = bl_image("tree_bark_surface", paint_bark(surface=True), False)
    surface.colorspace_settings.name = "Non-Color"
    surface.filepath_raw = os.path.join(ROOT, "client", "public", "models", "trees_bark_surface.png")
    surface.file_format = "PNG"
    os.makedirs(os.path.dirname(surface.filepath_raw), exist_ok=True)
    surface.save()
    leaves = bl_image("tree_leaves_tex", paint_leaves(), True)
    for name, img in zip(MAT_NAMES, [bark, leaves]):
        m = bpy.data.materials.new(name)
        try:
            m.use_nodes = True
        except AttributeError:
            pass
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if img is leaves:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry


def perp(d):
    a = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    return (a - d * a.dot(d)).normalized()


def turn(d, angle, azimuth):
    """A direction `angle` away from d, round it by `azimuth`."""
    p = Quaternion(d, azimuth) @ perp(d)
    return (d * math.cos(angle) + p * math.sin(angle)).normalized()


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


class Tree:
    def __init__(self, name, sp, seed):
        self.name = name
        self.sp = sp
        self.rng = random.Random(seed)
        self.v = []
        self.faces = []  # (vertex ids, uvs, colours, normals, material)
        self.twigs = []  # (points, direction, length)
        self.nodes = []  # ends of inner branches that also carry leaves

    def vert(self, co):
        self.v.append(Vector(co))
        return len(self.v) - 1

    def tris(self, mat=None):
        return sum(len(f[0]) - 2 for f in self.faces if mat is None or f[4] == mat)

    # -------------------------------------------------------------- bark

    def tube(self, pts, radii, sides, lvl, tip):
        sp = self.sp
        cu0 = 0.5 if sp.get("plane_bark") else 0.0
        tint = sp.get("bark_tint", (1, 1, 1))
        n = len(pts)
        T = []
        for i in range(n):
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            T.append(t.normalized())
        N = perp(T[0])
        circ = TAU * max(radii[0], 0.02)
        vlen = max(circ * 2.0, 0.3)  # metres per bark tile (the half image is 1:2)
        voff = self.rng.random()
        rot = self.rng.random()
        rings = []
        s = 0.0
        for i in range(n):
            if i:
                s += (pts[i] - pts[i - 1]).length
                N = (N - T[i] * N.dot(T[i])).normalized()
            B = T[i].cross(N)
            z = pts[i].z
            shade = (0.62 + 0.38 * smooth(0.0, 1.6, z)) * (0.88 if lvl >= 2 else 1.0)
            c = tuple(k * shade for k in tint)
            if tip and i == n - 1:
                rings.append(("tip", self.vert(pts[i]), s / vlen + voff, c, T[i]))
                continue
            ring = []
            for k in range(sides + 1):
                a = TAU * (k / sides + rot)
                d = N * math.cos(a) + B * math.sin(a)
                # Low buttresses make a grounded, uneven root flare without adding polygons.
                flare = 1.0 + 0.20 * (0.5 + 0.5 * math.sin(a * 3 + 0.7)) * max(0, 1 - z / 0.45) if lvl == 0 else 1.0
                ring.append((self.vert(pts[i] + d * radii[i] * flare), d))
            rings.append(("ring", ring, s / vlen + voff, c, T[i]))

        def u(k):
            return cu0 + 0.004 + (k / sides) * 0.492

        for i in range(n - 1):
            _, ra, va, ca, _ = rings[i]
            kind, rb, vb, cb, tb = rings[i + 1]
            for k in range(sides):
                a, da = ra[k]
                b, db = ra[k + 1]
                if kind == "tip":
                    um = (u(k) + u(k + 1)) / 2
                    self.faces.append(((a, b, rb), [(u(k), va), (u(k + 1), va), (um, vb)], [ca, ca, cb],
                                       [da, db, (da + db + tb * 0.5).normalized()], BARK))
                else:
                    c, dc = rb[k + 1]
                    d, dd = rb[k]
                    self.faces.append(((a, b, c, d), [(u(k), va), (u(k + 1), va), (u(k + 1), vb), (u(k), vb)],
                                       [ca, ca, cb, cb], [da, db, dc, dd], BARK))

    # -------------------------------------------------------------- branches

    def grow(self, p0, d, L, r0, lvl):
        sp, rng = self.sp, self.rng
        P = sp["levels"][lvl]
        last = lvl == len(sp["levels"]) - 1
        nseg = P["segs"]
        pts = [p0.copy()]
        cur = d.copy()
        w = P.get("wobble", 0.05)
        for i in range(nseg):
            cur = (cur + Vector((rng.uniform(-w, w), rng.uniform(-w, w), rng.uniform(-w, w)))
                   + UP * P.get("up", 0.0) - UP * P.get("droop", 0.0) * (i + 1) / nseg).normalized()
            if lvl and pts[-1].z < sp["clear"] + 0.3:
                cur.z = max(cur.z, 0.35)  # nothing hangs down into the walking space
                cur.normalize()
            pts.append(pts[-1] + cur * (L / nseg))
        r1 = r0 * P["taper"]
        radii = [r0 + (r1 - r0) * i / nseg for i in range(nseg + 1)]
        if lvl == 0:  # the root flare
            pts.insert(1, pts[0] + (pts[1] - pts[0]).normalized() * 0.3)
            radii.insert(1, r0 * 0.97)
            radii[0] = r0 * 1.3
        tip = last or P.get("tip", False)
        self.tube(pts, radii, P["sides"], lvl, tip)
        if last:
            self.twigs.append((pts, cur, L))
            return
        if lvl == len(sp["levels"]) - 2:
            self.nodes.append((pts[-1], cur))

        def at(t):
            x = t * (len(pts) - 1)
            i = min(int(x), len(pts) - 2)
            f = x - i
            q = pts[i].lerp(pts[i + 1], f)
            return q, (pts[i + 1] - pts[i]).normalized(), radii[i] + (radii[i + 1] - radii[i]) * f

        nlat = rng.randint(*P.get("lat", (0, 0)))
        az0 = rng.uniform(0, TAU)
        lo, hi = P.get("lat_t", (0.3, 0.9))
        for j in range(nlat):
            t = lo + (hi - lo) * (j + rng.uniform(0.25, 0.75)) / nlat
            q, dd, rr = at(t)
            cd = turn(dd, rng.uniform(*P["lat_ang"]), az0 + j * 2.4 + rng.uniform(-0.4, 0.4))
            cl = L * P["lat_len"] * (1 - P.get("lat_shrink", 0.0) * t) * rng.uniform(0.82, 1.12)
            self.grow(q, cd, cl, rr * P.get("lat_r", 0.6), lvl + 1)
        nf = P.get("fork", 0)
        for k in range(nf):
            az = az0 + 1.2 + k * TAU / nf + rng.uniform(-0.35, 0.35)
            ang = P["fork_ang"] * rng.uniform(0.75, 1.2)
            self.grow(pts[-1], turn(cur, ang, az), L * P["fork_len"] * rng.uniform(0.85, 1.1), r1 * P.get("fork_r", 0.8), lvl + 1)

    # -------------------------------------------------------------- leaves

    def card(self, c, a, size, ci, normal, tint, flip):
        """Crossed quads: two cards through the axis a, the painting's foot toward -a."""
        p1 = a.cross(UP)
        if p1.length < 1e-3:
            p1 = Vector((1, 0, 0))
        p1 = Quaternion(a, self.rng.uniform(-0.6, 0.6)) @ p1.normalized()
        p2 = a.cross(p1).normalized()
        h = size / 2
        x0, x1 = (1.0, 0.0) if flip else (0.0, 1.0)
        uvs = [cell_uv(ci, x0, 0), cell_uv(ci, x1, 0), cell_uv(ci, x1, 1), cell_uv(ci, x0, 1)]
        foot = tuple(k * 0.86 for k in tint)
        for p in (p1, p2):
            ids = (self.vert(c - a * h - p * h), self.vert(c - a * h + p * h), self.vert(c + a * h + p * h), self.vert(c + a * h - p * h))
            self.faces.append((ids, uvs, [foot, foot, tint, tint], [normal] * 4, LEAF))

    def leaves(self):
        sp, rng = self.sp, self.rng
        L = sp.get("leaf")
        tips = [pts[-1] for pts, _, _ in self.twigs] or [Vector((0, 0, sp["clear"] + 2))]
        centre = sum(tips, Vector()) / len(tips)
        rc = max(sum((t - centre).length for t in tips) / len(tips), 0.8)
        holes = [turn(UP, rng.uniform(0.5, 2.0), rng.uniform(0, TAU)) for _ in range(sp.get("holes", 0))]
        spots = []
        for pts, d, _ in self.twigs:
            for t in (L or {}).get("at", (1.0,)):
                x = t * (len(pts) - 1)
                i = min(int(x), len(pts) - 2)
                spots.append((pts[i].lerp(pts[i + 1], x - i), d, True))
        for q, d in self.nodes:
            spots.append((q, d, False))
        for q, d, twig in spots:
            out = q - centre
            outn = out.normalized() if out.length > 1e-3 else UP
            leafy = L is not None and rng.random() < L["p"] * (1.0 if twig else L.get("node_p", 0.6))
            if leafy and any(outn.dot(hd) > 0.86 for hd in holes) and rng.random() < 0.85:
                leafy = False  # a thin place in the crown
            if leafy:
                ci = rng.choice(L["cells"])
                size = L["size"] * rng.uniform(0.68, 1.12)
                jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
                a = (d * 0.5 + outn * 0.35 + UP * L.get("up", 0.5) + jitter * 0.35).normalized()
                tint = rng.choice(L["tints"])
            elif sp.get("twig_card") and twig and rng.random() < sp["twig_card"]["p"]:
                tc = sp["twig_card"]
                ci = rng.choice(tc["cells"])
                size = tc["size"] * rng.uniform(0.8, 1.2)
                a = (d * 0.8 + UP * 0.3 + outn * 0.2).normalized()
                tint = (0.95, 0.92, 0.9)
            else:
                continue
            # A ragged windward side, with open gaps that reveal the branch forks.
            size *= 0.87 if q.x > centre.x + rc * 0.3 else 1.0
            c = q + a * size * 0.38
            if c.z - size * 0.5 < sp["clear"]:
                continue  # keep the leaves above the heads of the people under the tree
            nz = (c.z - centre.z) / rc
            ao = 0.72 + 0.28 * smooth(0.0, 1.0, (c - centre).length / rc)
            ao *= 0.86 + 0.14 * smooth(-1.0, 0.8, nz)
            n = (outn * 0.75 + UP * 0.65 + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.12).normalized()
            self.card(c, a, size, ci, n, tuple(k * ao for k in tint), rng.random() < 0.5)

    # -------------------------------------------------------------- mesh

    def to_object(self):
        me = bpy.data.meshes.new(self.name)
        me.from_pydata([tuple(v) for v in self.v], [], [f[0] for f in self.faces])
        for m in MAT_NAMES:
            me.materials.append(bpy.data.materials[m])
        me.polygons.foreach_set("material_index", [f[4] for f in self.faces])
        me.polygons.foreach_set("use_smooth", [True] * len(self.faces))
        uv = me.uv_layers.new(name="UVMap")
        col = me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
        normals = [(0.0, 0.0, 1.0)] * len(me.loops)
        for p, f in zip(me.polygons, self.faces):
            for k, li in enumerate(p.loop_indices):
                uv.data[li].uv = f[1][k]
                col.data[li].color = (*f[2][k], 1.0)
                normals[li] = tuple(f[3][k])
        me.update()
        me.normals_split_custom_set(normals)
        try:
            me.color_attributes.active_color = col
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (AttributeError, TypeError):
            pass
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ------------------------------------------------------------------ the kinds

YELLOW_TINTS = [(1.0, 0.97, 0.85), (1.0, 0.9, 0.72), (0.95, 0.98, 0.88), (1.0, 0.84, 0.7)]
RUST_TINTS = [(1.0, 0.9, 0.8), (0.95, 0.8, 0.7), (1.0, 0.95, 0.85), (0.88, 0.78, 0.7)]

KINDS = {
    "tree_lime": dict(
        seed=11, height=7.6, r0=0.13, clear=2.4, holes=3, bark_tint=(0.95, 0.92, 0.88),
        levels=[
            dict(segs=4, sides=7, taper=0.18, wobble=0.03, tip=True, lat=(11, 13), lat_t=(0.33, 0.95), lat_ang=(0.8, 1.1),
                 lat_len=0.37, lat_shrink=0.72, lat_r=0.55),
            dict(segs=2, sides=5, taper=0.45, up=0.12, droop=0.1, wobble=0.1, lat=(2, 3), lat_t=(0.35, 0.9), lat_ang=(0.5, 0.8),
                 lat_len=0.45, lat_shrink=0.3, lat_r=0.7, fork=2, fork_ang=0.45, fork_len=0.5, fork_r=0.85),
            dict(segs=1, sides=3, taper=0.3, up=0.1, droop=0.05, wobble=0.15),
        ],
        leaf=dict(cells=LEAF_CELLS["lime"], size=0.9, p=0.92, at=(0.25, 0.5, 0.75, 1.0), tints=YELLOW_TINTS),
    ),
    "tree_elm": dict(
        seed=23, height=3.0, r0=0.16, clear=2.5, holes=3, bark_tint=(0.84, 0.8, 0.76),
        levels=[
            dict(segs=2, sides=7, taper=0.8, wobble=0.03, fork=3, fork_ang=0.38, fork_len=1.35, fork_r=0.72),
            dict(segs=3, sides=5, taper=0.55, up=0.04, wobble=0.08, lat=(2, 3), lat_t=(0.35, 0.85), lat_ang=(0.5, 0.8),
                 lat_len=0.45, lat_shrink=0.2, lat_r=0.6, fork=2, fork_ang=0.4, fork_len=0.5, fork_r=0.75),
            dict(segs=2, sides=4, taper=0.5, droop=0.25, wobble=0.12, lat=(2, 3), lat_t=(0.3, 0.85), lat_ang=(0.6, 0.9),
                 lat_len=0.5, lat_shrink=0.2, lat_r=0.7, fork=2, fork_ang=0.45, fork_len=0.55, fork_r=0.8),
            dict(segs=1, sides=3, taper=0.3, droop=0.2, wobble=0.15),
        ],
        leaf=dict(cells=LEAF_CELLS["elm"], size=0.8, p=0.92, at=(0.35, 0.7, 1.0), node_p=0.9, tints=YELLOW_TINTS + RUST_TINTS[:2]),
    ),
    "tree_plane": dict(
        seed=37, height=3.2, r0=0.18, clear=2.6, holes=4, plane_bark=True,
        levels=[
            dict(segs=2, sides=7, taper=0.8, wobble=0.03, fork=3, fork_ang=0.55, fork_len=1.05, fork_r=0.7),
            dict(segs=3, sides=5, taper=0.5, up=0.06, wobble=0.12, lat=(2, 3), lat_t=(0.3, 0.85), lat_ang=(0.6, 0.95),
                 lat_len=0.45, lat_shrink=0.3, lat_r=0.6, fork=2, fork_ang=0.5, fork_len=0.5, fork_r=0.75),
            dict(segs=2, sides=4, taper=0.5, droop=0.12, wobble=0.15, lat=(1, 2), lat_t=(0.3, 0.8), lat_ang=(0.6, 0.9),
                 lat_len=0.5, lat_shrink=0.2, lat_r=0.7, fork=2, fork_ang=0.45, fork_len=0.55, fork_r=0.8),
            dict(segs=1, sides=3, taper=0.3, droop=0.1, wobble=0.15),
        ],
        leaf=dict(cells=LEAF_CELLS["plane"], size=1.0, p=0.55, at=(0.35, 0.7, 1.0), node_p=0.8, tints=RUST_TINTS),
        twig_card=dict(cells=LEAF_CELLS["plane_sparse"] + LEAF_CELLS["twigs"], size=1.0, p=0.75),
    ),
    "tree_bare": dict(
        seed=53, height=2.9, r0=0.15, clear=2.5, bark_tint=(0.8, 0.77, 0.74),
        levels=[
            dict(segs=2, sides=7, taper=0.8, wobble=0.03, fork=3, fork_ang=0.42, fork_len=1.3, fork_r=0.72),
            dict(segs=3, sides=5, taper=0.55, up=0.04, wobble=0.1, lat=(1, 2), lat_t=(0.4, 0.8), lat_ang=(0.5, 0.8),
                 lat_len=0.45, lat_shrink=0.2, lat_r=0.6, fork=2, fork_ang=0.42, fork_len=0.5, fork_r=0.75),
            dict(segs=2, sides=4, taper=0.5, droop=0.2, wobble=0.14, lat=(1, 2), lat_t=(0.3, 0.8), lat_ang=(0.6, 0.9),
                 lat_len=0.5, lat_shrink=0.2, lat_r=0.7, fork=2, fork_ang=0.5, fork_len=0.55, fork_r=0.8),
            dict(segs=1, sides=3, taper=0.3, droop=0.15, wobble=0.18),
        ],
        leaf=dict(cells=LEAF_CELLS["elm"][:1], size=0.6, p=0.07, at=(1.0,), node_p=0.0, tints=RUST_TINTS),
        twig_card=dict(cells=LEAF_CELLS["twigs"], size=1.05, p=0.95),
    ),
}


def build_kind(name, sp):
    t = Tree(name, sp, sp["seed"])
    t.grow(Vector((0, 0, 0)), UP.copy(), sp["height"], sp["r0"], 0)
    t.leaves()
    return t


def build_willow():
    """A pollarded willow: a thick leaning trunk, a knobbly head, straight shoots."""
    sp = dict(clear=2.0, bark_tint=(0.86, 0.84, 0.76),
              levels=[dict(segs=1, sides=7, taper=1.0), dict(segs=2, sides=3, taper=0.3, droop=0.12, wobble=0.06)],
              leaf=dict(cells=LEAF_CELLS["willow"], size=0.8, p=0.85, at=(0.35, 0.6, 0.85, 1.0), tints=YELLOW_TINTS, up=0.1))
    t = Tree("tree_willow", sp, 71)
    rng = t.rng
    pts = [Vector((0, 0, 0)), Vector((0, 0, 0.3)), Vector((0.06, 0.02, 1.2)), Vector((0.12, 0.05, 2.0)),
           Vector((0.14, 0.06, 2.3)), Vector((0.15, 0.06, 2.55))]
    t.tube(pts, [0.32, 0.25, 0.22, 0.25, 0.34, 0.26], 7, 0, False)
    t.tube([pts[-1], pts[-1] + Vector((0, 0, 0.12))], [0.26, 0.0], 7, 0, True)  # the cut top of the head
    head = pts[-2]
    for k in range(4):  # knobs where the old shoots were cut
        a = k * TAU / 4 + rng.uniform(-0.4, 0.4)
        d = Vector((math.cos(a), math.sin(a), 0.5)).normalized()
        t.tube([head + d * 0.2, head + d * 0.42], [0.1, 0.0], 5, 1, True)
    for k in range(16):
        a = rng.uniform(0, TAU)
        base = head + Vector((math.cos(a) * 0.2, math.sin(a) * 0.2, rng.uniform(0.05, 0.25)))
        d = turn(UP, rng.uniform(0.12, 0.62), a)
        t.grow(base, d, rng.uniform(1.6, 2.8), 0.035, 1)
    t.leaves()
    return t


# ------------------------------------------------------------------ preview


def preview(objs):
    for mt in bpy.data.materials:
        if mt.name not in MAT_NAMES:
            continue
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
        try:
            mt.surface_render_method = "DITHERED"
        except AttributeError:
            pass
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("sky")
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.45, 0.5, 0.58, 1)
        bg.inputs[1].default_value = 1.0
    except AttributeError:
        pass
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.5
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    for i, o in enumerate(objs):
        o.location = ((i - (len(objs) - 1) / 2) * 7.0, 0, 0)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.location = Vector((0, -32, 5))
    cam.rotation_euler = (Vector((0, 0, 5)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = 30
    sc.render.resolution_x, sc.render.resolution_y = 1600, 700
    sc.render.image_settings.file_format = "PNG"
    path = os.path.join(SHOTS, "trees_preview.png")
    os.makedirs(SHOTS, exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[build_trees] preview -> {path}")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    trees = [build_kind(n, sp) for n, sp in KINDS.items()] + [build_willow()]
    objs = [t.to_object() for t in trees]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for t in trees:
        top = max(v.z for v in t.v)
        print(f"[build_trees] {t.name:12s} {t.tris():5d} tris (bark {t.tris(BARK)}, leaves {t.tris(LEAF)}), {top:.1f} m tall")
    print(f"[build_trees] {len(trees)} trees -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()
