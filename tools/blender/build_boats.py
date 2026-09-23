"""Boats, ships and quay cranes of Antwerp, 1873, modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_boats.py
    blender -b --factory-startup -P tools/blender/build_boats.py -- --preview
    blender -b --factory-startup -P tools/blender/build_boats.py -- --closeup barque,steamer out.png [azimuth] [elevation]

Writes client/public/models/boats.glb (Draco). One node per object. A vessel's
origin is the centre of its waterline, bow toward -Y in Blender (+Z in the game),
real scale in metres. A crane's origin is the centre of its foot on the quay;
its jib looks toward -Y at rest. The part of a crane that turns (cabin, jib,
hook) is a child node named "jib" (portal crane) or "hand_crane_jib", with its
origin on the axis it turns about.

Everything here is our own work: the shapes are built from code, the textures
are painted by the functions below (32x32 to 128x128, nearest filter). Period
photographs and engravings of the Antwerp quays were looked at for proportions
only; nothing was copied (see assets/ATTRIBUTION.md). The mesh helpers and the
twelve street-prop materials come from build_props.py.

The vertex colour "Col" carries a baked shade (darker toward the keel and under
things); the game multiplies it into the texture, as in props.glb.

--preview renders a line-up of all objects (data/shots/boats_preview.png) and a
quay scene (data/shots/boats_harbour.png).
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_props as bp  # noqa: E402  (mesh helpers, painters, the prop materials)
from build_props import Mesh, col, move, rot_z, speckle, vnoise  # noqa: E402
from build_props import BARREL, CRATE, DARK, IRON, ROPE, SACK, STONE, WOOD  # noqa: E402

ROOT = bp.ROOT
OUT = os.path.join(ROOT, "client", "public", "models", "boats.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

EXTRA = ["tar", "clinker", "iron_hull", "iron_ports", "band", "copper", "redlead", "deck", "paint_green",
         "paint_white", "canvas", "canvas_tan", "rigging", "shrouds", "lattice", "funnel", "window", "hatch",
         "tarp", "flag"]
MATS = bp.MATS + EXTRA
(TAR, CLINKER, IRONHULL, PORTS, BAND, COPPER, REDLEAD, DECK, GREEN, WHITE, CANVAS, TAN, RIG, SHROUD, LATTICE,
 FUNNEL, WINDOW, HATCH, TARP, FLAG) = range(len(bp.MATS), len(MATS))
# thin parts, seen from both sides (the game makes these double-sided too)
THIN = {"shrouds", "lattice", "flag", "canvas", "canvas_tan", "tarp"}
# metres per texture tile for faces mapped by position
TILE = {TAR: 2.0, CLINKER: 1.0, IRONHULL: 4.0, COPPER: 2.0, REDLEAD: 2.0, GREEN: 1.6, WHITE: 1.6, DECK: 1.6,
        WOOD: 1.6, DARK: 1.2}

# ------------------------------------------------------------------ textures


def noise(rng, w, h, cu, cv):
    """Tileable value noise of any size (cropped from a square field)."""
    n = max(w, h)
    return vnoise(rng, n, cu, cv)[:h, :w]


def paint_tar(seed, n=128, strakes=8, base=(0.085, 0.072, 0.06)):
    """Tarred hull planks: strakes along u, 8 per tile, caulked seams, salt bloom."""
    rng = np.random.default_rng(seed)
    img = np.zeros((n, n, 3))
    h = n // strakes
    for b in range(strakes):
        r0 = b * h
        img[r0:r0 + h] = col(base) * (1 + rng.uniform(-0.22, 0.22))
        img[r0] *= 0.35
        img[(r0 + 1) % n] *= 1.5
        for _ in range(int(rng.integers(1, 3))):
            u = int(rng.integers(0, n))
            img[r0 + 1:r0 + h, u] *= 0.4
    grain = noise(rng, n, n, 4, 48) * 0.6 + noise(rng, n, n, 12, 96) * 0.4
    img *= (0.72 + 0.56 * grain)[..., None]
    salt = np.clip(noise(rng, n, n, 5, 3) - 0.55, 0, 1) * 1.8
    img += (salt * noise(rng, n, n, 40, 8))[..., None] * col((0.2, 0.19, 0.16))
    return speckle(img, rng, 0.05, 0.6, 1.4)


def paint_clinker(seed, n=64, strakes=8, base=(0.23, 0.18, 0.13)):
    """Lapped strakes of a small boat: a bright lap edge at the foot of each, shade above."""
    rng = np.random.default_rng(seed)
    img = np.zeros((n, n, 3))
    h = n // strakes
    for b in range(strakes):
        r0 = b * h
        tone = 1 + rng.uniform(-0.15, 0.15)
        for r in range(h):
            img[r0 + r] = col(base) * tone * (1.25 - 0.45 * r / (h - 1))
        img[r0] = col(base) * 0.3
        img[r0 + 1] *= 1.3
    grain = noise(rng, n, n, 3, 24)
    img *= (0.8 + 0.4 * grain)[..., None]
    wear = np.clip(noise(rng, n, n, 6, 6) - 0.6, 0, 1)[..., None] * 1.5
    img = img * (1 - wear) + col((0.36, 0.34, 0.3)) * wear
    return speckle(img, rng, 0.05)


def paint_iron_hull(seed, n=128, base=(0.07, 0.07, 0.075)):
    """Black-painted iron plates (1 m strakes, 2 m plates at 4 m a tile), rivets, rust runs."""
    rng = np.random.default_rng(seed)
    img = np.ones((n, n, 3)) * col(base)
    img *= (0.82 + 0.36 * noise(rng, n, n, 8, 8))[..., None]
    for s in range(4):
        r0 = s * 32
        img[r0] *= 0.35
        img[(r0 + 1) % n] *= 1.6
        off = (s % 2) * 32
        for u in (off, off + 64):
            img[r0:r0 + 32, u % n] *= 0.4
            img[r0 + 2:r0 + 32:4, (u + 2) % n] += 0.06
        img[(r0 + 3) % n, ::4] += 0.06
    for _ in range(30):
        u = int(rng.integers(0, n))
        v0 = int(rng.integers(6, n))
        ln = int(rng.integers(8, 44))
        w = int(rng.integers(1, 3))
        for k in range(ln):
            v = v0 - k
            if v < 0:
                break
            a = 0.6 * (1 - k / ln)
            img[v, u:u + w] = img[v, u:u + w] * (1 - a) + col((0.33, 0.15, 0.07)) * a
    return speckle(img, rng, 0.06, 0.6, 1.5)


def paint_ports(seed, w=128, h=32, tile_u=8.0, height=0.55):
    """The strip of hull with round brass-rimmed portholes, one every 2 m."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 3)) * col((0.07, 0.07, 0.075))
    img *= (0.82 + 0.36 * noise(rng, w, h, 8, 2))[..., None]
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    mu, mv = tile_u / w, height / h
    for cu in (16, 48, 80, 112):
        d = np.hypot((uu - cu) * mu, (vv - h / 2) * mv)
        img[d < 0.19] = col((0.36, 0.28, 0.14))
        img[d < 0.14] = col((0.04, 0.05, 0.06))
        img[(d < 0.1) & (uu > cu) & (vv > h / 2 + 2)] = col((0.2, 0.22, 0.24))
        run = (np.abs(uu - cu) < 1.5) & (vv < h / 2 - 7) & (rng.random((h, w)) < 0.7)
        img[run] = img[run] * 0.5 + col((0.3, 0.14, 0.07)) * 0.5
    img[0] *= 0.4
    img[-1] *= 0.4
    return img


def paint_band(seed, w=128, h=16):
    """A sailing ship's painted port band: cream, with black painted ports every 2.5 m."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 3)) * col((0.7, 0.68, 0.6))
    img *= (0.8 + 0.3 * noise(rng, w, h, 8, 2))[..., None]
    for cu in (32, 96):
        img[4:12, cu - 7:cu + 7] = col((0.05, 0.05, 0.05))
        img[3, cu - 7:cu + 7] *= 0.6
    runs = rng.random((h, w)) < 0.05
    img[runs] *= 0.7
    img[0] = img[-1] = col((0.06, 0.06, 0.06))
    return img


def paint_metal(seed, base, blot, n=64):
    """Copper sheathing or red-lead bottom: small plates, blotches."""
    rng = np.random.default_rng(seed)
    img = np.ones((n, n, 3)) * col(base)
    img *= (0.8 + 0.35 * noise(rng, n, n, 16, 16))[..., None]
    m = np.clip((noise(rng, n, n, 8, 8) - 0.5) * 3, 0, 1)[..., None]
    img = img * (1 - m) + col(blot) * m
    img[::8] *= 0.6
    for r in range(0, n, 8):
        off = 8 if (r // 8) % 2 else 0
        img[r:r + 8, off::16] *= 0.65
    return speckle(img, rng, 0.05)


def chips(img, rng, under, amount=0.55):
    """Paint worn through to the wood here and there."""
    n = img.shape[0]
    m = (noise(rng, n, n, 10, 10) > amount + 0.25) | (rng.random((n, n)) < 0.02)
    img[m] = img[m] * 0.2 + col(under) * 0.8
    return img


def paint_green(seed):
    rng = np.random.default_rng(seed)
    img = bp.paint_planks(seed, (0.11, 0.22, 0.16), boards=2, joints=False, knots=0)
    return chips(img, rng, (0.3, 0.25, 0.18))


def paint_white(seed):
    rng = np.random.default_rng(seed)
    img = bp.paint_planks(seed, (0.66, 0.64, 0.57), boards=4, joints=False, knots=0)
    img = chips(img, rng, (0.36, 0.34, 0.3), 0.6)
    streak = noise(rng, 64, 64, 32, 2)
    img *= (0.85 + 0.2 * streak)[..., None]
    return img


def paint_canvas(seed, base):
    """Furled sailcloth: creases run along the bundle (constant u)."""
    rng = np.random.default_rng(seed)
    uu = np.arange(64)[None, :]
    folds = 0.82 + 0.18 * np.sin(uu / 64 * 2 * math.pi * 5 + rng.uniform(0, 6)) + 0.1 * np.sin(uu / 64 * 2 * math.pi * 11)
    img = np.ones((64, 64, 3)) * col(base) * folds[..., None]
    img *= (0.85 + 0.25 * noise(rng, 64, 64, 32, 4))[..., None]
    for _ in range(7):
        u = int(rng.integers(0, 64))
        img[:, u] *= 0.55
    img *= (0.9 + 0.15 * noise(rng, 64, 64, 6, 6))[..., None]
    return speckle(img, rng, 0.04)


def paint_tarp(seed):
    """Tarred tarpaulin over hatches, lashed with ropes every 0.8 m (columns)."""
    rng = np.random.default_rng(seed)
    img = np.ones((64, 64, 3)) * col((0.14, 0.16, 0.13))
    img *= (0.75 + 0.45 * noise(rng, 64, 64, 6, 10))[..., None]
    uu, vv = np.meshgrid(np.arange(64), np.arange(64))
    crease = np.abs(((uu + vv * 0.6) % 21) - 10) < 0.7
    img[crease] *= 0.7
    for u in (15, 47):
        img[:, u - 1:u + 2] = col((0.33, 0.28, 0.19)) * (0.85 + 0.3 * rng.random((64, 3, 1)))
    return speckle(img, rng, 0.05)


def paint_funnel(seed):
    """Funnel, v up: black with a red band, soot at the top, rings of rivets."""
    rng = np.random.default_rng(seed)
    img = np.ones((64, 64, 3)) * col((0.07, 0.065, 0.06))
    img[36:46] = col((0.42, 0.08, 0.06))
    img *= (0.85 + 0.3 * noise(rng, 64, 64, 6, 6))[..., None]
    for r in (10, 22, 34, 48):
        img[r] *= 0.5
        img[r + 1] += 0.04
    soot = np.clip((np.arange(64) - 50) / 14, 0, 1)[:, None, None]
    img *= 1 - 0.5 * soot
    return speckle(img, rng, 0.05)


def paint_window(seed):
    rng = np.random.default_rng(seed)
    n = 32
    img = np.ones((n, n, 3)) * col((0.56, 0.53, 0.46))
    img *= (0.85 + 0.3 * noise(rng, n, n, 4, 4))[..., None]
    pane = np.ones((n, n), bool)
    pane[:3] = pane[-3:] = False
    pane[:, :3] = pane[:, -3:] = False
    pane[15:17] = False
    pane[:, 15:17] = False
    img[pane] = col((0.04, 0.05, 0.06))
    uu, vv = np.meshgrid(np.arange(n), np.arange(n))
    shine = pane & (np.abs((uu - vv) - 6) < 2)
    img[shine] = col((0.17, 0.19, 0.21))
    return img


def paint_flag(seed):
    """Left half: a white house flag with a red star. Right half: red, for pennants."""
    w, h = 32, 16
    img = np.ones((h, w, 3)) * col((0.78, 0.76, 0.7))
    img[:, 16:] = col((0.5, 0.07, 0.06))
    uu, vv = np.meshgrid(np.arange(w) + 0.5, np.arange(h) + 0.5)
    a = np.arctan2(vv - 8, uu - 8) - math.pi / 2
    r = np.hypot(uu - 8, vv - 8)
    k = np.cos(math.pi / 5) / np.cos((a % (2 * math.pi / 5)) - math.pi / 5)
    star = (r < 5.6 * (0.45 + 0.55 * (k - np.cos(math.pi / 5)) / (1 - np.cos(math.pi / 5)))) & (uu < 16)
    img[star] = col((0.55, 0.06, 0.05))
    return img


def paint_shrouds(seed):
    """Shrouds with ratlines, cut out: 4 dark lines across u, a ratline every 8 px of v."""
    n = 64
    img = np.ones((n, n, 3)) * col((0.08, 0.065, 0.05))
    a = np.zeros((n, n))
    for u in (1, 21, 42, 62):
        a[:, u - 1:u + 1] = 1
    a[::8, :] = 1
    img[::8, :] = col((0.16, 0.13, 0.1))
    return img, a


def paint_lattice(seed):
    """A lattice girder side: flanges top and bottom, posts and diagonals, cut out."""
    rng = np.random.default_rng(seed)
    n = 64
    img = np.ones((n, n, 3)) * col((0.1, 0.1, 0.105))
    img *= (0.8 + 0.4 * noise(rng, n, n, 8, 8))[..., None]
    rust = np.clip((noise(rng, n, n, 6, 6) - 0.6) * 3, 0, 1)[..., None]
    img = img * (1 - rust) + col((0.3, 0.15, 0.08)) * rust
    uu, vv = np.meshgrid(np.arange(n), np.arange(n))
    a = np.zeros((n, n))
    a[:5] = a[-5:] = 1
    for u in (0, 32):
        a[:, max(0, u - 2):u + 2] = 1
    a[:, 62:] = 1
    for u0 in (0, 32):
        d1 = np.abs((uu - u0) - (vv - 4) * 32 / 55)
        d2 = np.abs((uu - u0 - 32) + (vv - 4) * 32 / 55)
        a[((d1 < 1.6) | (d2 < 1.6)) & (uu >= u0) & (uu < u0 + 32)] = 1
    return img, a


def paint_rigging(seed):
    return bp.paint_rope(seed, base=(0.14, 0.11, 0.08))


def paint_hatch(seed):
    """Hatch boards across the ship: columns, tarred, weathered at the joints."""
    return bp.paint_planks(seed, (0.2, 0.16, 0.12), boards=2, joints=False, knots=1).transpose(1, 0, 2).copy()


def image_rgba(name, arr, alpha=None):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    if alpha is not None:
        rgba[..., 3] = alpha
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def make_materials():
    bp.make_materials()
    paint = {
        "tar": lambda: paint_tar(101),
        "clinker": lambda: paint_clinker(102),
        "iron_hull": lambda: paint_iron_hull(103),
        "iron_ports": lambda: paint_ports(104),
        "band": lambda: paint_band(105),
        "copper": lambda: paint_metal(106, (0.36, 0.23, 0.13), (0.2, 0.3, 0.24)),
        "redlead": lambda: paint_metal(107, (0.33, 0.1, 0.07), (0.16, 0.12, 0.08)),
        "deck": lambda: bp.paint_planks(108, (0.45, 0.42, 0.37), boards=8, knots=2),
        "paint_green": lambda: paint_green(109),
        "paint_white": lambda: paint_white(110),
        "canvas": lambda: paint_canvas(111, (0.66, 0.63, 0.55)),
        "canvas_tan": lambda: paint_canvas(112, (0.42, 0.26, 0.15)),
        "rigging": lambda: paint_rigging(113),
        "shrouds": lambda: paint_shrouds(114),
        "lattice": lambda: paint_lattice(115),
        "funnel": lambda: paint_funnel(116),
        "window": lambda: paint_window(117),
        "hatch": lambda: paint_hatch(118),
        "tarp": lambda: paint_tarp(119),
        "flag": lambda: paint_flag(120),
    }
    for name in EXTRA:
        res = paint[name]()
        arr, alpha = res if isinstance(res, tuple) else (res, None)
        img = image_rgba(f"{name}_tex", arr, alpha)
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha is not None:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0
    for m in bpy.data.materials:
        m.use_backface_culling = m.name not in THIN


# ------------------------------------------------------------------ helpers


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def cl(x, a=0.0, b=1.0):
    return min(b, max(a, x))


def table(tab, u):
    for (u0, v0), (u1, v1) in zip(tab, tab[1:]):
        if u <= u1:
            return v0 + (v1 - v0) * cl((u - u0) / max(u1 - u0, 1e-9))
    return tab[-1][1]


def V(x, y, z):
    return Vector((x, y, z))


def mirror(p, sx):
    return Vector((p.x * sx, p.y, p.z))


def to_object(m, name, parent=None, loc=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    m.bm.to_mesh(me)
    m.bm.free()
    for mt in MATS:
        me.materials.append(bpy.data.materials[mt])
    try:
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except (KeyError, AttributeError):
        pass
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    ob.location = loc
    return ob


class Hull:
    """A lofted hull. Stations t run 0 (stern) to 1 (bow); the bow is at -Y.
    `levels` are functions t -> z from keel to sheer; `hb(t, z)` the half-breadth;
    `mats[k]` = (material, fit) for the strip between level k and k+1: fit 0 maps the
    texture by position, fit > 0 stretches v over the strip and repeats u every `fit` m."""

    def __init__(self, L, ts, levels, hb, mats, yfn=None, shade=None):
        self.L, self.ts, self.levels, self.hbf, self.mats, self.yfn = L, ts, levels, hb, mats, yfn
        self.shade = shade

    def zs(self, t, levels=None):
        out = []
        for f in levels or self.levels:
            z = f(t)
            if out:
                z = max(z, out[-1] + 0.004)
            out.append(z)
        return out

    def y(self, t, z):
        return self.L / 2 - t * self.L + (self.yfn(t, z) if self.yfn else 0.0)

    def hb(self, t, z):
        return self.hbf(t, z)

    def P(self, t, z, sx=1, inset=0.0):
        return V(sx * max(0.0, self.hb(t, z) - inset), self.y(t, z), z)

    def _uv(self, pts, mat, fit, lo_hi, along="y"):
        if fit:
            if along == "y":
                return [(-p.y / fit, f) for p, f in zip(pts, lo_hi)]
            return [(p.x / fit, f) for p, f in zip(pts, lo_hi)]
        tile = TILE.get(mat, 2.0)
        if along == "y":
            return [(-p.y / tile, p.z / tile) for p in pts]
        return [(p.x / tile, p.z / tile) for p in pts]

    def outer(self, m):
        T = self.ts
        Z = [self.zs(t) for t in T]
        K = len(self.levels)
        m.shadefn = self.shade
        for i in range(len(T) - 1):
            ta, tb = T[i], T[i + 1]
            for k in range(K - 1):
                mat, fit = self.mats[k]
                for sx in (1, -1):
                    pts = [self.P(ta, Z[i][k], sx), self.P(tb, Z[i + 1][k], sx), self.P(tb, Z[i + 1][k + 1], sx),
                           self.P(ta, Z[i][k + 1], sx)]
                    m.poly(pts, mat, out=(sx, 0, 0), uvs=self._uv(pts, mat, fit, (0, 0, 1, 1)))
            pts = [self.P(ta, Z[i][0], 1), self.P(tb, Z[i + 1][0], 1), self.P(tb, Z[i + 1][0], -1), self.P(ta, Z[i][0], -1)]
            mat = self.mats[0][0]
            tile = TILE.get(mat, 2.0)
            m.poly(pts, mat, out=(0, 0, -1), uvs=[(-p.y / tile, p.x / tile) for p in pts])
        for i, ty in ((0, 1), (len(T) - 1, -1)):
            t = T[i]
            for k in range(K - 1):
                mat, fit = self.mats[k]
                pts = [self.P(t, Z[i][k], 1), self.P(t, Z[i][k + 1], 1), self.P(t, Z[i][k + 1], -1), self.P(t, Z[i][k], -1)]
                m.poly(pts, mat, out=(0, ty, 0), uvs=self._uv(pts, mat, fit, (0, 1, 1, 0), along="x"))
        m.shadefn = None

    def span(self, t0, t1):
        return [t0] + [t for t in self.ts if t0 + 1e-6 < t < t1 - 1e-6] + [t1]

    def deck(self, m, zfn, t0, t1, inset, mat, tile=1.6, shade=0.95):
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            a, b = self.P(ta, zfn(ta), 1, inset), self.P(tb, zfn(tb), 1, inset)
            pts = [mirror(a, -1), a, b, mirror(b, -1)]
            m.poly(pts, mat, out=(0, 0, 1), shade=shade, uvs=[(-p.y / tile, p.x / tile) for p in pts])

    def rail(self, m, zlo, ztop, t0, t1, thick, mat, cap_mat, end0=True, end1=False, shade=0.85):
        """The inside of the bulwark from the deck up, and the rail cap on top."""
        T = self.span(t0, t1)
        tile = TILE.get(mat, 1.6)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                pts = [self.P(ta, zlo(ta), sx, thick), self.P(tb, zlo(tb), sx, thick), self.P(tb, ztop(tb), sx, thick),
                       self.P(ta, ztop(ta), sx, thick)]
                m.poly(pts, mat, out=(-sx, 0, 0), shade=shade, uvs=[(-p.y / tile, p.z / tile) for p in pts])
                pts = [self.P(ta, ztop(ta), sx), self.P(tb, ztop(tb), sx), self.P(tb, ztop(tb), sx, thick),
                       self.P(ta, ztop(ta), sx, thick)]
                m.poly(pts, cap_mat, out=(0, 0, 1), uvs=[(-p.y / 1.2, p.x / 1.2) for p in pts])
        for t, on, dy in ((t0, end0, -1), (t1, end1, 1)):
            if not on:
                continue
            zl, zt = zlo(t), ztop(t)
            w0, w1 = self.hb(t, zl) - thick, self.hb(t, zt) - thick
            if w1 < 0.15:
                continue
            y = self.y(t, zt) + dy * thick
            pts = [V(-w0, y, zl), V(w0, y, zl), V(w1, y, zt), V(-w1, y, zt)]
            m.poly(pts, mat, out=(0, dy, 0), shade=shade, uvs=[(p.x / tile, p.z / tile) for p in pts])
            y0 = self.y(t, zt)
            pts = [V(-w1, y0, zt), V(w1, y0, zt), V(w1, y, zt), V(-w1, y, zt)]
            m.poly(pts, cap_mat, out=(0, 0, 1), uvs=[(p.x / 1.2, p.y / 1.2) for p in pts])

    def inner(self, m, levels, t0, t1, inset, mat, floor_mat, end0=True, end1=True, shade=0.8):
        """The inside skin of an open hull (or hold) with a floor, facing inward."""
        T = self.span(t0, t1)
        Z = [self.zs(t, levels) for t in T]
        K = len(levels)
        tile = TILE.get(mat, 1.2)
        for i in range(len(T) - 1):
            ta, tb = T[i], T[i + 1]
            for k in range(K - 1):
                for sx in (1, -1):
                    pts = [self.P(ta, Z[i][k], sx, inset), self.P(tb, Z[i + 1][k], sx, inset),
                           self.P(tb, Z[i + 1][k + 1], sx, inset), self.P(ta, Z[i][k + 1], sx, inset)]
                    s = shade * (0.8 if k == 0 else 1.0)
                    m.poly(pts, mat, out=(-sx, 0, 0), shade=s, uvs=[(-p.y / tile, p.z / tile) for p in pts])
            pts = [self.P(ta, Z[i][0], 1, inset), self.P(tb, Z[i + 1][0], 1, inset), self.P(tb, Z[i + 1][0], -1, inset),
                   self.P(ta, Z[i][0], -1, inset)]
            ft = TILE.get(floor_mat, 1.2)
            m.poly(pts, floor_mat, out=(0, 0, 1), shade=shade * 0.75, uvs=[(-p.y / ft, p.x / ft) for p in pts])
        for i, on, dy in ((0, end0, -1), (len(T) - 1, end1, 1)):
            if not on:
                continue
            t = T[i]
            for k in range(K - 1):
                pts = [self.P(t, Z[i][k], 1, inset), self.P(t, Z[i][k + 1], 1, inset), self.P(t, Z[i][k + 1], -1, inset),
                       self.P(t, Z[i][k], -1, inset)]
                m.poly(pts, mat, out=(0, dy, 0), shade=shade * 0.9, uvs=[(p.x / tile, p.z / tile) for p in pts])

    def cap(self, m, zfn, t0, t1, inset, mat):
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                pts = [self.P(ta, zfn(ta), sx), self.P(tb, zfn(tb), sx), self.P(tb, zfn(tb), sx, inset),
                       self.P(ta, zfn(ta), sx, inset)]
                m.poly(pts, mat, out=(0, 0, 1), uvs=[(-p.y / 1.2, p.x / 1.2) for p in pts])


# ---- spars, rigging and small parts


def spar(m, a, b, r0, r1, mat=DARK, sides=6, cap=False):
    m.tube([Vector(a), Vector(b)], [r0, r1], sides, mat, smooth=False, urep=1, vscale=0.5, cap1=cap)


def rig(m, a, b, r=0.022, mat=RIG):
    m.tube([Vector(a), Vector(b)], [r, r], 3, mat, smooth=False, urep=1, vscale=0.3)


def rope_path(m, pts, r=0.022, mat=RIG):
    m.tube([Vector(p) for p in pts], [r] * len(pts), 3, mat, smooth=False, urep=1, vscale=0.3)


def bundle(m, a, b, r, mat=CANVAS, n=4, sides=5, droop=0.0):
    """A furled sail: a sausage of canvas from a to b, thickest in the middle."""
    a, b = Vector(a), Vector(b)
    path, radii = [], []
    for i in range(n + 1):
        f = i / n
        p = a.lerp(b, f)
        p.z -= droop * math.sin(math.pi * f)
        path.append(p)
        w = 0.4 + 0.6 * math.sin(math.pi * f) ** 0.6
        radii.append((r * w, r * w * 0.85))
    m.tube(path, radii, sides, mat, side=(0, 0, 1), smooth=False, cap0=True, cap1=True, urep=2, vscale=0.5)


def yard(m, c, length, r, sail_r, mat=DARK, sail=CANVAS, lifts_to=None):
    c = Vector(c)
    for sx in (1, -1):
        spar(m, c, c + V(sx * length / 2, 0, 0), r, r * 0.45, mat, sides=5)
    if sail_r > 0:
        bundle(m, c + V(-length / 2 * 0.86, -0.05, r + sail_r * 0.5), c + V(length / 2 * 0.86, -0.05, r + sail_r * 0.5),
               sail_r, sail)
    if lifts_to is not None:
        for sx in (1, -1):
            rig(m, c + V(sx * length / 2 * 0.95, 0, 0), Vector(lifts_to), 0.018)


def shroud_quad(m, b0, b1, t1, t0, spacing=3.2):
    b0, b1, t0, t1 = Vector(b0), Vector(b1), Vector(t0), Vector(t1)
    h = ((b0 + b1) / 2 - (t0 + t1) / 2).length
    m.poly([b0, b1, t1, t0], SHROUD, uvs=[(0, 0), (1, 0), (1, h / spacing), (0, h / spacing)])


def flag(m, top, w, h, along=(0, 1, 0), wave=0.12):
    """A house flag hoisted at `top`, flying along `along`: two quads with a little wave."""
    top = Vector(top)
    d = Vector(along).normalized()
    side = d.cross(V(0, 0, 1)).normalized()
    up = V(0, 0, h)
    mid = top + d * (w / 2) + side * wave
    end = top + d * w
    m.poly([top - up, mid - up, mid, top], FLAG, uvs=[(0, 0), (0.25, 0), (0.25, 1), (0, 1)])
    m.poly([mid - up, end - up, end, mid], FLAG, uvs=[(0.25, 0), (0.5, 0), (0.5, 1), (0.25, 1)])


def pennant(m, top, length, along=(0, 1, 0), h=0.3):
    top = Vector(top)
    d = Vector(along).normalized()
    side = d.cross(V(0, 0, 1)).normalized()
    mid = top + d * (length * 0.5) + side * 0.08 - V(0, 0, h * 0.35)
    m.poly([top - V(0, 0, h), mid, top], FLAG, uvs=[(0.6, 0.1), (0.9, 0.5), (0.6, 0.9)])
    m.poly([mid, top + d * length - V(0, 0, h * 0.6), mid + V(0, 0, 0.05)], FLAG, uvs=[(0.7, 0.3), (0.95, 0.5), (0.7, 0.7)])


def panel(m, c, right, up, w, h, mat=WINDOW, off=0.02):
    """A flat picture (window, door) on a wall: centre c, the wall's right and up directions."""
    c, r, u = Vector(c), Vector(right).normalized(), Vector(up).normalized()
    n = r.cross(u)
    c = c + n * off
    pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    m.poly(pts, mat, out=n, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])


def house(m, x0, x1, y0, y1, z0, z1, wall=WHITE, roof=DARK, over=0.12, windows=(), door=None, roof_rise=0.0):
    """A deckhouse box: walls, a roof slab (slightly arched if roof_rise), windows as
    (side, position along, z centre) with side in '+x', '-x', '+y', '-y'."""
    m.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), wall, tile=1.6, skip=("+z", "-z"))
    xa, xb, ya, yb = x0 - over, x1 + over, y0 - over, y1 + over
    if roof_rise > 0:
        xs = [xa, xa + (xb - xa) * 0.25, (xa + xb) / 2, xa + (xb - xa) * 0.75, xb]
        zs = [z1, z1 + roof_rise * 0.75, z1 + roof_rise, z1 + roof_rise * 0.75, z1]
        for i in range(4):
            pts = [V(xs[i], ya, zs[i]), V(xs[i + 1], ya, zs[i + 1]), V(xs[i + 1], yb, zs[i + 1]), V(xs[i], yb, zs[i])]
            m.poly(pts, roof, out=(xs[i] + xs[i + 1] - xa - xb, 0, 1), uvs=[(p.y / 1.2, p.x / 1.2) for p in pts])
        for yy, dy in ((ya, -1), (yb, 1)):
            m.poly([V(x, yy, z) for x, z in zip(xs, zs)], roof, out=(0, dy, 0), shade=0.8)
        m.poly([V(xa, ya, z1 - 0.01), V(xb, ya, z1 - 0.01), V(xb, yb, z1 - 0.01), V(xa, yb, z1 - 0.01)], roof,
               out=(0, 0, -1), shade=0.6)
    else:
        m.box(((x0 + x1) / 2, (y0 + y1) / 2, z1 + 0.05), (xb - xa, yb - ya, 0.1), roof, tile=1.2, shade=0.9)
    for side, a, zc in windows:
        if side == "+x":
            panel(m, (x1, a, zc), (0, -1, 0), (0, 0, 1), 0.55, 0.5)
        elif side == "-x":
            panel(m, (x0, a, zc), (0, 1, 0), (0, 0, 1), 0.55, 0.5)
        elif side == "-y":
            panel(m, (a, y0, zc), (1, 0, 0), (0, 0, 1), 0.55, 0.5)
        else:
            panel(m, (a, y1, zc), (-1, 0, 0), (0, 0, 1), 0.55, 0.5)
    if door:
        side, a, w, h = door
        zc = z0 + h / 2 + 0.05
        if side == "-y":
            panel(m, (a, y0, zc), (1, 0, 0), (0, 0, 1), w, h, DARK)
        elif side == "+y":
            panel(m, (a, y1, zc), (-1, 0, 0), (0, 0, 1), w, h, DARK)
        elif side == "+x":
            panel(m, (x1, a, zc), (0, -1, 0), (0, 0, 1), w, h, DARK)
        else:
            panel(m, (x0, a, zc), (0, 1, 0), (0, 0, 1), w, h, DARK)


def chimney(m, x, y, z, h=0.9, r=0.1):
    with m.at(move(x, y, z)):
        m.lathe([(r, 0), (r, h), (r * 1.6, h + 0.05), (r * 1.6, h + 0.14), (r * 0.5, h + 0.2)], 6, IRON, smooth=False,
                cap1=True)


def bitts(m, x, y, z, h=0.55, w=0.2):
    m.box((x, y, z + h / 2), (w, w, h), DARK, shade=0.85)


def barrel_lo(m, c, lying=False, yaw=0.0):
    c = Vector(c)
    prof = [(0.27, 0.0), (0.32, 0.2), (0.335, 0.475), (0.32, 0.75), (0.27, 0.95)]
    if lying:
        M = move(c.x, c.y, c.z + 0.335) @ rot_z(yaw) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ move(0, 0, -0.475)
    else:
        M = move(*c) @ rot_z(yaw)
    with m.at(M):
        m.lathe(prof, 8, BARREL, cap0=True, cap1=True, urep=2, smooth=False)
        for z in (0.12, 0.83):
            m.lathe([(0.312, z), (0.312, z + 0.05)], 8, IRON, smooth=False, urep=2)


def sack_lo(m, c, yaw=0.0, lift=0.0):
    c = Vector(c)
    with m.at(move(c.x, c.y, c.z) @ rot_z(yaw) @ Matrix.Rotation(lift, 4, "X")):
        path = [V(-0.45, 0, 0.12), V(-0.3, 0, 0.13), V(0.3, 0, 0.13), V(0.45, 0, 0.12)]
        radii = [(0.06, 0.17), (0.13, 0.26), (0.13, 0.26), (0.06, 0.17)]
        m.tube(path, radii, 6, SACK, side=(0, 0, 1), smooth=False, cap0=True, cap1=True, urep=1, vscale=1.0)


def crate_lo(m, c, size=(0.9, 0.7, 0.65), yaw=0.0):
    c = Vector(c)
    with m.at(move(*c) @ rot_z(yaw)):
        m.box((0, 0, size[2] / 2), size, CRATE, mode="fit", shade=0.9)


def anchor(m, top, side=(1, 0, 0), size=1.0):
    """A stocked anchor hanging from `top`: shank down, arms up at the crown, stock across."""
    top = Vector(top)
    s = size
    crown = top - V(0, 0, 2.0 * s)
    m.beam(top, crown, 0.12 * s, 0.12 * s, IRON, side=side)
    for d in (1, -1):
        tip = crown + V(0, d * 0.75 * s, 0.55 * s)
        m.beam(crown, tip, 0.11 * s, 0.11 * s, IRON, side=(1, 0, 0))
        m.beam(tip, tip + V(0, d * 0.12 * s, 0.25 * s), 0.2 * s, 0.05 * s, IRON, side=(1, 0, 0))
    m.beam(top - V(0.9 * s, 0, 0.15 * s), top + V(0.9 * s, 0, -0.15 * s), 0.08 * s, 0.08 * s, IRON, side=(0, 1, 0))


def wheel_helm(m, c, r=0.6, axis="y"):
    """A ship's wheel standing across the deck (its axle along y)."""
    c = Vector(c)
    pts = []
    for i in range(9):
        a = 2 * math.pi * i / 8
        pts.append(c + V(r * math.cos(a), 0, r * math.sin(a)))
    m.tube(pts[:-1], [0.035] * 8, 3, DARK, side=(0, 1, 0), closed_path=True, smooth=False)
    for i in range(4):
        a = math.pi * i / 4
        d = V(math.cos(a), 0, math.sin(a))
        m.beam(c - d * (r + 0.12), c + d * (r + 0.12), 0.03, 0.03, DARK, side=(0, 1, 0), caps=False)


def windlass(m, x, y, z, w=1.6, r=0.2):
    with m.at(move(x, y, z) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(r, -w / 2), (r * 1.2, -w / 2 + 0.1), (r * 1.2, w / 2 - 0.1), (r, w / 2)], 8, DARK, smooth=False,
                cap0=True, cap1=True, cap_mat=IRON)
    for sx in (1, -1):
        m.box((x + sx * (w / 2 + 0.1), y, z - 0.15 + (r + 0.35) / 2 - 0.1), (0.18, 0.4, r + 0.55), DARK)


# ------------------------------------------------------------------ barges


def leeboard(m, pivot, length, width, sx, angle=0.52):
    """A pear-shaped leeboard hung on the gunwale, swung up aft. angle: below horizontal."""
    pivot = Vector(pivot)
    d = V(0, math.cos(angle), -math.sin(angle))
    e = V(0, math.sin(angle), math.cos(angle))
    outline = [(0.0, -0.2), (0.35, -0.32), (length * 0.55, -width * 0.42), (length * 0.9, -width * 0.5),
               (length, -width * 0.2), (length, width * 0.2), (length * 0.9, width * 0.5), (length * 0.55, width * 0.42),
               (0.35, 0.32), (0.0, 0.2)]
    pts = [pivot + d * a + e * b for a, b in outline]
    m.prism(pts, (sx * 0.09, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.box(pivot + V(sx * 0.12, 0, 0), (0.1, 0.16, 0.16), IRON)


def barge(kind):
    """kind 'rhine': a big Rhine barge (Rijnaak), towed, short mast, hatch boards.
    kind 'hengst': a Flemish sailing barge, bluff and high-ended, tall mast, tarpaulins."""
    m = Mesh(ao=0.0)
    rh = kind == "rhine"
    L, B = (34.0, 6.2) if rh else (21.0, 5.3)
    D = 1.55 if rh else 1.35
    F, E, Eb = (0.85, 0.75, 0.25) if rh else (0.8, 0.95, 0.5)
    tb0, ts0 = (0.86, 0.12) if rh else (0.78, 0.16)

    def keel(t):
        return -D + 0.6 * D * sm((t - 0.9) / 0.1) + 0.35 * D * sm((0.07 - t) / 0.07)

    def sheer(t):
        return F + E * abs(2 * t - 1) ** 3 + Eb * max(0.0, (t - 0.8) / 0.2) ** 2

    def hb(t, z):
        u = cl((z + D) / (D + F))
        sec = 0.84 + 0.16 * sm(u / 0.3) + (0.0 if rh else 0.03 * u)
        if t > tb0:
            f = (t - tb0) / (1 - tb0)
            p = (1 - min(f, 1.0) ** 2.2) ** 0.5
        elif t < ts0:
            f = (ts0 - t) / ts0
            p = (1 - min(f, 1.0) ** 2.4) ** 0.5
        else:
            p = 1.0
        p = p ** (1 + 0.8 * (1 - u))
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z + D) / (D + F + E))
        return -(0.5 if rh else 0.9) * u * sm((t - 0.88) / 0.12) + 0.3 * u * sm((0.08 - t) / 0.08)

    ts = [0, 0.015, 0.04, 0.075, 0.12, 0.16, 0.25, 0.4, 0.55, 0.7, 0.78, 0.86, 0.9, 0.935, 0.965, 0.985, 1.0]
    levels = [keel, lambda t: keel(t) + 0.3, lambda t: -0.05, lambda t: sheer(t) - 0.24, sheer]
    mats = [(TAR, 0), (TAR, 0), (TAR, 0), (GREEN, 3.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 0.28

    hull.deck(m, zd, 0, 1, 0.07, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, GREEN, DARK)

    # the hold: coaming and hatch covers (boards on the Rhine barge, tarpaulins on the hengst)
    h0, h1 = (0.2, 0.75) if rh else (0.26, 0.7)
    cw = 2.3 if rh else 1.95
    ztop = max(zd(h0), zd(h1)) + 0.4
    Th = hull.span(h0, h1)
    for ta, tb in zip(Th, Th[1:]):
        ya, yb = hull.y(ta, zd(ta)), hull.y(tb, zd(tb))
        for sx in (1, -1):
            pts = [V(sx * cw, ya, zd(ta) - 0.05), V(sx * cw, yb, zd(tb) - 0.05), V(sx * cw, yb, ztop), V(sx * cw, ya, ztop)]
            m.poly(pts, GREEN if rh else DARK, out=(sx, 0, 0), uvs=[(-p.y / 1.6, p.z / 1.6) for p in pts])
    ya, yb = hull.y(h0, zd(h0)), hull.y(h1, zd(h1))
    for t, y, dy in ((h0, ya, 1), (h1, yb, -1)):
        pts = [V(-cw, y, zd(t) - 0.05), V(cw, y, zd(t) - 0.05), V(cw, y, ztop), V(-cw, y, ztop)]
        m.poly(pts, GREEN if rh else DARK, out=(0, dy, 0), uvs=[(p.x / 1.6, p.z / 1.6) for p in pts])
    rise = 0.55 if rh else 0.7
    arch = [(cw * math.cos(math.pi * j / 6), ztop + rise * math.sin(math.pi * j / 6)) for j in range(7)]
    cover = HATCH if rh else TARP
    acc = [0.0]
    for j in range(6):
        acc.append(acc[-1] + math.hypot(arch[j + 1][0] - arch[j][0], arch[j + 1][1] - arch[j][1]))
    for j in range(6):
        (xa, za), (xb, zb) = arch[j], arch[j + 1]
        pts = [V(xa, ya + 0.05, za), V(xb, ya + 0.05, zb), V(xb, yb - 0.05, zb), V(xa, yb - 0.05, za)]
        uvs = [(-p.y / 1.6, a / 1.6) for p, a in zip(pts, (acc[j], acc[j + 1], acc[j + 1], acc[j]))]
        m.poly(pts, cover, out=((xa + xb) / 2, 0, (za + zb) / 2 - ztop + 0.3), uvs=uvs, shade=0.95)
    for y, dy in ((ya + 0.05, 1), (yb - 0.05, -1)):
        m.poly([V(x, y, z) for x, z in arch], cover, out=(0, dy, 0), shade=0.75)
    if not rh:
        # the tarpaulin's lashings, and the battens along its foot
        for f in (0.12, 0.3, 0.5, 0.7, 0.88):
            y = ya + (yb - ya) * f
            rope_path(m, [V(x * 1.01, y, z + 0.02) for x, z in arch], 0.025, ROPE)
        for sx in (1, -1):
            m.beam((sx * (cw + 0.03), ya, ztop - 0.08), (sx * (cw + 0.03), yb, ztop - 0.08), 0.06, 0.1, DARK)
    else:
        # a ridge plank along the hatch boards, a gangplank to walk on
        m.beam((0, ya - 0.1, ztop + rise + 0.03), (0, yb + 0.1, ztop + rise + 0.03), 0.3, 0.05, DARK)
        m.box((-0.8, (ya + yb) / 2 + 3, ztop + rise * 0.93 + 0.06), (0.5, 7.5, 0.05), WOOD, shade=0.9)
        # the barge's dinghy, carried on the hatches aft
        ships_boat(m, (0.7, ya - 3.4, ztop + rise * 0.8), 4.0, 1.35, 0.55, yaw=0.05, mat=CLINKER, cover=WOOD)

    # the roef: the skipper's cabin aft
    c0, c1 = (0.045, 0.14) if rh else (0.055, 0.17)
    cabw = 1.9 if rh else 1.55
    y0, y1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    zb = min(zd(c0), zd(c1)) - 0.1
    zt = max(zd(c0), zd(c1)) + (1.25 if rh else 1.1)
    house(m, -cabw, cabw, y0, y1, zb, zt, wall=GREEN, roof=TAR, over=0.1, roof_rise=0.18,
          windows=[("+x", y0 + (y1 - y0) * 0.3, zt - 0.5), ("+x", y0 + (y1 - y0) * 0.7, zt - 0.5),
                   ("-x", y0 + (y1 - y0) * 0.3, zt - 0.5), ("-x", y0 + (y1 - y0) * 0.7, zt - 0.5),
                   ("-y", -0.6, zt - 0.5)],
          door=("-y", 0.55, 0.7, zt - zb - 0.35))
    chimney(m, cabw * 0.5, (y0 + y1) / 2 + 0.4, zt + 0.15, 0.8, 0.09)
    # rudder and tiller
    ys = L / 2
    zr = sheer(0)
    k0 = keel(0.0)
    rud = [V(0, ys, k0 + 0.15), V(0, ys + (1.5 if rh else 1.3), k0 + 0.15), V(0, ys + (1.7 if rh else 1.45), 0.1),
           V(0, ys + 1.0, zr - 0.35), V(0, ys + 0.3, zr + 0.25), V(0, ys, zr + 0.25)]
    m.prism([p + V(-0.07, 0, 0) for p in rud], (0.14, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.beam((0, ys + 0.15, zr + 0.18), (0, ys - 1.6, zr + 0.45), 0.1, 0.12, DARK)
    m.beam((0, ys - 1.6, zr + 0.45), (0, ys - 3.0, zr + 0.5), 0.1, 0.1, DARK, w2=0.07, h2=0.07)
    # flagstaff at the stern
    spar(m, (0.4, ys - 0.2, zr - 0.1), (0.4, ys + 0.1, zr + 2.2), 0.04, 0.03)
    # mast in its tabernacle, boom, gaff and the furled sail
    tm = 0.8 if rh else 0.755
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    H = 11.0 if rh else 16.5
    for sx in (1, -1):
        m.box((sx * 0.22, ym, zm + 0.8), (0.14, 0.34, 1.6), DARK)
    spar(m, (0, ym, zm), (0, ym + 0.3, zm + H), 0.17 if rh else 0.2, 0.08, DARK, cap=True)
    top = V(0, ym + 0.3, zm + H)
    m.box(top + V(0, 0, 0.08), (0.2, 0.2, 0.16), DARK)
    pennant(m, top + V(0, 0, 0.3), 1.6 if rh else 2.4, h=0.28)
    zbm = ztop + rise + (0.55 if rh else 0.7)
    blen = 9.0 if rh else 10.5
    boom_a, boom_b = V(0, ym + 0.25, zbm), V(0, ym + blen, zbm + 0.35)
    spar(m, boom_a, boom_b, 0.11, 0.08)
    gaff_a, gaff_b = V(0, ym + 0.35, zbm + 0.5), V(0, ym + blen * 0.72, zbm + 0.72)
    spar(m, gaff_a, gaff_b, 0.09, 0.06)
    bundle(m, boom_a.lerp(gaff_a, 0.5) + V(0, 0.4, 0.05), boom_b.lerp(gaff_b, 0.4) + V(0, -0.8, 0.12),
           0.32 if rh else 0.4, CANVAS if rh else TAN, n=5)
    # the peak halyard and topping lift from the masthead
    rig(m, top - V(0, 0, 0.5), gaff_b)
    rig(m, top - V(0, 0, 0.3), boom_b)
    # forestay with the foresail bundled at its foot, shrouds, running backstays
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.25, sheer(1.0) + 0.1)
    rig(m, top - V(0, 0, 0.4), stem, 0.028)
    bundle(m, stem + V(0, 0.3, 0.25), stem.lerp(top, 0.2) + V(0, 0.4, -0.3), 0.22, CANVAS if rh else TAN, n=3)
    for sx in (1, -1):
        for dt in ((0.01, -0.02) if rh else (0.012, -0.012, -0.035)):
            t = tm + dt
            rig(m, top - V(0, 0, 0.9), hull.P(t, sheer(t), sx) + V(0, 0, 0.05), 0.022)
        t = tm - (0.12 if rh else 0.2)
        rig(m, top - V(0, 0, 0.6), hull.P(t, sheer(t), sx, 0.05) + V(0, 0, 0.05), 0.018)
    # leeboards, swung up
    tl = 0.63 if rh else 0.6
    for sx in (1, -1):
        piv = hull.P(tl, sheer(tl) - 0.12, sx) + V(sx * 0.05, 0, 0)
        ang = 0.5 if rh else 0.62
        ln = 4.6 if rh else 4.3
        leeboard(m, piv, ln, 1.8 if rh else 1.7, sx, angle=ang)
        foot = piv + V(sx * 0.1, math.cos(ang) * ln * 0.9, -math.sin(ang) * ln * 0.9)
        rig(m, foot, hull.P(tl - 0.08, sheer(tl - 0.08), sx) + V(0, 0, 0.2), 0.02)
    # foredeck: windlass, bitts, an anchor stowed; aft: bitts and a water cask
    tw = 0.93 if rh else 0.905
    windlass(m, 0, hull.y(tw, zd(tw)), zd(tw) + 0.35, w=1.3 if rh else 1.1, r=0.17)
    for t in (0.975, 0.02):
        for sx in (1, -1):
            bitts(m, sx * 0.5, hull.y(t, zd(t)), zd(t))
    ta = 0.885 if rh else 0.85
    with m.at(move(1.0, hull.y(ta, zd(ta)), zd(ta) + 0.12) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        anchor(m, V(0, 0, 0), side=(0, 1, 0), size=0.6)
    barrel_lo(m, (-cabw * 0.6, y0 - 0.6, zd(c1 + 0.01)), yaw=0.4)
    if not rh:
        # the hengst's sweep lying on the tarpaulin
        m.beam((cw * 0.4, ya - 1.5, ztop + rise * 0.9 + 0.08), (cw * 0.2, ya - 7.5, ztop + rise * 0.95 + 0.08), 0.08, 0.08,
               WOOD)
    return m


# ------------------------------------------------------------------ open boats


def lighter(loaded):
    """A Scheldt lighter: an open cargo boat, towed or poled, bluff ends, small decks."""
    m = Mesh(ao=0.0)
    L, B, D = 17.0, 4.4, 0.8

    def keel(t):
        return -D + 0.4 * sm((t - 0.88) / 0.12) + 0.22 * sm((0.08 - t) / 0.08)

    def sheer(t):
        return 1.0 + 0.35 * abs(2 * t - 1) ** 3 + 0.12 * max(0.0, (t - 0.8) / 0.2) ** 2

    def hb(t, z):
        u = cl((z + D) / (D + 1.0))
        sec = 0.86 + 0.14 * sm(u / 0.3)
        if t > 0.84:
            p = (1 - min(1.0, (t - 0.84) / 0.16) ** 2.2) ** 0.5
        elif t < 0.1:
            p = (1 - min(1.0, (0.1 - t) / 0.1) ** 2.4) ** 0.5
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p ** (1 + 0.7 * (1 - u)))

    ts = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.84, 0.88, 0.92, 0.96, 0.985, 1.0]
    levels = [keel, lambda t: keel(t) + 0.2, lambda t: -0.05, lambda t: sheer(t) - 0.2, sheer]
    hull = Hull(L, ts, levels, hb, [(TAR, 0), (TAR, 0), (TAR, 0), (DARK, 2.0)],
                yfn=lambda t, z: -0.35 * cl((z + D) / 1.8) * sm((t - 0.9) / 0.1),
                shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    hull.outer(m)
    zf = 0.24  # the hold floor sits above the game's water sheet (waves reach about 0.2 m)
    tf0, tf1 = 0.1, 0.86
    hull.inner(m, [lambda t: zf, lambda t: zf + 0.35, sheer], tf0, tf1, 0.08, WOOD, DECK)
    hull.cap(m, sheer, tf0, tf1, 0.08, DARK)

    def zd(t):
        return sheer(t) - 0.2

    hull.deck(m, zd, tf1, 1.0, 0.07, DECK)
    hull.deck(m, zd, 0.0, tf0, 0.07, DECK)
    hull.rail(m, zd, sheer, tf1, 1.0, 0.08, DARK, DARK, end0=False)
    hull.rail(m, zd, sheer, 0.0, tf0, 0.08, DARK, DARK, end0=True)
    # cross beams over the hold, a mast stump, the forepeak with its chimney
    for t in (0.36, 0.62):
        y = hull.y(t, 0)
        w = hb(t, sheer(t) - 0.12) - 0.08
        m.beam((-w, y, sheer(t) - 0.12), (w, y, sheer(t) - 0.12), 0.16, 0.14, DARK, side=(0, 1, 0))
    ym = hull.y(0.8, 0)
    spar(m, (0, ym, zf), (0, ym, 4.6), 0.12, 0.09, DARK, cap=True)
    pennant(m, (0, ym, 4.75), 0.9, h=0.2)
    rig(m, (0, ym, 4.4), (0, hull.y(1, sheer(1)) + 0.2, sheer(1) + 0.05))
    chimney(m, 0.7, hull.y(0.94, zd(0.94)), zd(0.94), 0.55, 0.07)
    m.box((-0.3, hull.y(0.92, zd(0.92)), zd(0.92) + 0.12), (0.7, 0.6, 0.25), DARK)
    # rudder and tiller
    ys = L / 2
    k0, zr = keel(0), sheer(0)
    rud = [V(0, ys, k0 + 0.1), V(0, ys + 0.95, k0 + 0.1), V(0, ys + 1.05, 0.1), V(0, ys + 0.35, zr + 0.2), V(0, ys, zr + 0.2)]
    m.prism([p + V(-0.06, 0, 0) for p in rud], (0.12, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.beam((0, ys + 0.1, zr + 0.12), (0.3, ys - 2.1, zr + 0.35), 0.08, 0.1, DARK)
    for t in (0.975, 0.03):
        for sx in (1, -1):
            bitts(m, sx * 0.45, hull.y(t, zd(t)), zd(t), 0.45, 0.16)
    # a long sweep lying along the gunwale
    m.beam((1.6, hull.y(0.2, 0), sheer(0.2) + 0.06), (1.7, hull.y(0.7, 0), sheer(0.7) + 0.06), 0.07, 0.07, WOOD)
    if loaded:
        k = 0
        for t in (0.58, 0.64, 0.7, 0.76):
            y = hull.y(t, 0)
            for x in (-1.0, -0.35, 0.3, 0.95):
                sack_lo(m, (x + 0.04 * ((k * 7) % 3 - 1), y, zf), yaw=math.pi / 2 + 0.08 * ((k * 5) % 3 - 1))
                k += 1
            for x in (-0.65, 0.0, 0.65):
                sack_lo(m, (x, y + 0.1, zf + 0.25), yaw=math.pi / 2 + 0.1 * ((k * 3) % 3 - 1), lift=0.04)
                k += 1
        for i, (x, t) in enumerate([(-0.9, 0.24), (-0.2, 0.25), (0.5, 0.24), (1.15, 0.26), (-0.55, 0.31), (0.15, 0.31),
                                    (0.85, 0.3)]):
            barrel_lo(m, (x, hull.y(t, 0), zf), yaw=i * 0.7)
        barrel_lo(m, (-0.2, hull.y(0.42, 0), zf), lying=True, yaw=0.1)
        barrel_lo(m, (0.6, hull.y(0.45, 0), zf), lying=True, yaw=-0.2)
        crate_lo(m, (-0.8, hull.y(0.46, 0), zf), yaw=0.2)
        crate_lo(m, (-0.75, hull.y(0.46, 0), zf + 0.65), size=(0.7, 0.55, 0.5), yaw=-0.3)
    else:
        # dunnage boards in the empty hold
        for x in (-1.2, -0.4, 0.4, 1.2):
            m.box((x, hull.y(0.48, 0), zf + 0.03), (0.22, 7.5, 0.05), WOOD, shade=0.8)
    return m


def boat_hull(L, B, D, mats, stern_w=0.55):
    kz, sz = -0.3 * D, 0.7 * D

    def keel(t):
        return kz + 0.3 * D * sm((t - 0.78) / 0.22) ** 1.3 + 0.08 * D * sm((0.12 - t) / 0.12)

    def sheer(t):
        return sz + 0.22 * D * sm((t - 0.55) / 0.45) ** 2 + 0.12 * D * sm((0.45 - t) / 0.45) ** 2

    SEC = [(0, 0.15), (0.15, 0.55), (0.5, 0.9), (1, 1.0)]

    def hb(t, z):
        u = cl((z - kz) / (sz - kz))
        sec = table(SEC, u)
        if t > 0.5:
            f = (t - 0.5) / 0.5
            p = (1 - min(f, 1.0) ** 2) ** (0.7 + 0.8 * (1 - u))
        else:
            base = stern_w * u ** 0.8
            p = base + (1 - base) * sm(t / 0.42) ** 0.6
        return max(0.015, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z - kz) / (sz - kz))
        return -0.06 * L * u * sm((t - 0.85) / 0.15) + 0.03 * L * u * sm((0.1 - t) / 0.1)

    levels = [keel, lambda t: keel(t) + 0.12 * D, lambda t: 0.5 * (keel(t) + sheer(t)) + 0.05 * D, sheer]
    ts = [0, 0.07, 0.18, 0.32, 0.48, 0.62, 0.74, 0.84, 0.92, 0.97, 1.0]
    mats = [(mats, 0)] * 3 if isinstance(mats, int) else mats
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.6 + 0.4 * sm((p.z - kz) / (sz - kz)))
    return hull, keel, sheer


def rowboat():
    m = Mesh(ao=0.0)
    hull, keel, sheer = boat_hull(5.4, 1.55, 0.8, CLINKER)
    hull.outer(m)
    hull.inner(m, [lambda t: max(keel(t) + 0.1, 0.16), lambda t: 0.5 * (keel(t) + sheer(t)) + 0.1, sheer], 0.0, 1.0, 0.035, WOOD, DECK,
               end1=False)
    hull.cap(m, sheer, 0.0, 1.0, 0.035, DARK)
    m.beam((0, hull.y(0.02, keel(0.02)), keel(0.02) - 0.03), (0, hull.y(0.9, keel(0.9)), keel(0.9) - 0.03), 0.06, 0.06, DARK)
    for t in (0.42, 0.66):
        z = sheer(t) - 0.2
        w = hull.hb(t, z) - 0.03
        m.box((0, hull.y(t, z), z), (2 * w, 0.24, 0.04), WOOD, shade=0.9)
    z = sheer(0.1) - 0.22
    w = hull.hb(0.1, z) - 0.03
    m.box((0, hull.y(0.1, z), z), (2 * w, 0.5, 0.04), WOOD, shade=0.9)
    for sx in (1, -1):
        a = V(sx * 0.28, hull.y(0.12, 0), sheer(0.42) - 0.12)
        b = V(sx * 0.18, hull.y(0.95, 0), sheer(0.66) - 0.1)
        m.beam(a, b, 0.05, 0.05, WOOD, side=(0, 0, 1))
        d = (b - a).normalized()
        m.slab([a - V(0.07, 0, 0), a + V(0.07, 0, 0), a + d * 1.0 + V(0.07, 0, 0), a + d * 1.0 - V(0.07, 0, 0)], 0.02,
               WOOD, out=(0, 0, 1))
        m.box(hull.P(0.55, sheer(0.55) + 0.05, sx, 0.02), (0.04, 0.04, 0.1), IRON)
    stem = V(0, hull.y(1, sheer(1)), sheer(1) - 0.05)
    rope_path(m, [stem, stem + V(0, -0.3, -0.2), stem + V(0, -0.45, -0.55)], 0.018, ROPE)
    return m


def ships_boat(m, c, L, B, D, yaw=0.0, mat=WHITE, cover=CANVAS):
    """A ship's boat under a canvas cover, for davits and deckhouse roofs. c = keel bottom centre."""
    hull, keel, sheer = boat_hull(L, B, D, mat, stern_w=0.35)
    k = -keel(0.5)
    with m.at(move(c[0], c[1], c[2] + k) @ rot_z(yaw)):
        hull.outer(m)
        hull.deck(m, lambda t: sheer(t) - 0.02, 0, 1, 0.0, cover, tile=1.0)
    return hull


def punt():
    """A flat-bottomed rowing punt with raked flat ends, as in the canals."""
    m = Mesh(ao=0.0)
    L, B = 5.2, 1.35

    def sheer(t):
        return 0.52 + 0.06 * abs(2 * t - 1) ** 2

    def hb(t, z):
        u = cl((z + 0.12) / 0.64)
        p = 1 - 0.3 * abs(2 * t - 1) ** 3
        return B / 2 * (0.88 + 0.12 * u) * p

    def yfn(t, z):
        u = cl((z + 0.14) / 0.5)
        return -0.55 * u * sm((t - 0.9) / 0.1) + 0.45 * u * sm((0.1 - t) / 0.1)

    hull = Hull(L, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0], [lambda t: -0.12, lambda t: 0.0, sheer], hb, [(TAR, 0), (TAR, 0)],
                yfn=yfn, shade=lambda p: 0.65 + 0.35 * sm((p.z + 0.14) / 0.5))
    hull.outer(m)
    hull.inner(m, [lambda t: 0.14, sheer], 0.0, 1.0, 0.04, WOOD, DECK)
    hull.cap(m, sheer, 0, 1, 0.04, DARK)
    for t in (0.3, 0.72):
        m.box((0, hull.y(t, 0), 0.36), (B * 0.86, 0.26, 0.04), WOOD, shade=0.9)
    m.beam((0.25, hull.y(0.05, 0), 0.45), (0.35, hull.y(1.0, 0) - 1.2, 0.58), 0.05, 0.05, WOOD)  # the quant pole
    return m


def sloop():
    """A hoogaars-type Scheldt fishing sloop: flat bottom, hard chine, raked straight stem,
    leeboards, one mast with the gaff sail furled on the boom (tanned sails)."""
    m = Mesh(ao=0.0)
    L, B = 12.5, 3.9

    def keel(t):
        return -0.75 + 0.62 * sm((t - 0.62) / 0.38) ** 1.4 + 0.1 * sm((0.08 - t) / 0.08)

    def sheer(t):
        return 0.78 + 0.95 * max(0.0, (t - 0.55) / 0.45) ** 2 + 0.25 * max(0.0, (0.3 - t) / 0.3) ** 2

    def hb(t, z):
        u = cl((z + 0.75) / 1.55)
        sec = 0.7 + 0.1 * sm(u / 0.06) + 0.2 * u
        if t > 0.5:
            f = (t - 0.5) / 0.5
            p = (1 - min(f, 1.0) ** 1.8) ** (0.65 + 0.4 * (1 - u))
        elif t < 0.12:
            p = 0.62 + 0.38 * sm(t / 0.12)
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z - keel(t)) / max(0.2, sheer(t) - keel(t)))
        return -1.7 * u * sm((t - 0.8) / 0.2) + 0.4 * u * sm((0.1 - t) / 0.1)

    ts = [0, 0.05, 0.12, 0.25, 0.4, 0.55, 0.68, 0.78, 0.86, 0.92, 0.96, 1.0]
    levels = [keel, lambda t: keel(t) + 0.05, lambda t: 0.0, lambda t: sheer(t) - 0.2, sheer]
    hull = Hull(L, ts, levels, hb, [(TAR, 0), (TAR, 0), (TAR, 0), (GREEN, 2.0)], yfn=yfn,
                shade=lambda p: 0.55 + 0.45 * sm((p.z + 0.75) / 1.6))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 0.14

    tw = 0.45
    hull.deck(m, zd, tw, 1.0, 0.06, DECK)
    hull.rail(m, zd, sheer, tw, 1.0, 0.07, GREEN, DARK, end0=False)
    hull.inner(m, [lambda t: 0.2, lambda t: 0.45, sheer], 0.0, tw, 0.06, WOOD, DECK, end1=True)
    hull.cap(m, sheer, 0.0, tw, 0.06, DARK)
    th = 0.62
    m.box((0, hull.y(th, zd(th)), zd(th) + 0.12), (1.1, 0.9, 0.26), DARK)
    m.box((0, hull.y(0.3, 0), 0.62), (2 * hb(0.3, 0.62) - 0.14, 0.3, 0.05), WOOD, shade=0.9)
    tm = 0.58
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    top = V(0, ym + 0.4, zm + 10.0)
    spar(m, (0, ym, zm), top, 0.14, 0.07, DARK, cap=True)
    pennant(m, top + V(0, 0, 0.2), 1.4, h=0.22)
    boom_a, boom_b = V(0, ym + 0.2, zm + 1.1), V(0, ym + 7.2, zm + 1.25)
    spar(m, boom_a, boom_b, 0.09, 0.07)
    gaff_a, gaff_b = V(0, ym + 0.3, zm + 1.55), V(0, ym + 3.6, zm + 1.9)
    spar(m, gaff_a, gaff_b, 0.07, 0.05)
    bundle(m, boom_a + V(0, 0.4, 0.3), boom_b + V(0, -0.5, 0.25), 0.3, TAN, n=5)
    rig(m, top - V(0, 0, 0.3), boom_b)
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.15, sheer(1.0) + 0.05)
    rig(m, top - V(0, 0, 0.3), stem, 0.024)
    bundle(m, stem + V(0, 0.25, -0.05), stem + V(0, 2.0, -0.35), 0.18, TAN, n=3)
    for sx in (1, -1):
        rig(m, top - V(0, 0, 0.8), hull.P(tm - 0.02, sheer(tm - 0.02), sx) + V(0, 0, 0.05), 0.02)
        piv = hull.P(0.55, sheer(0.55) - 0.1, sx) + V(sx * 0.05, 0, 0)
        leeboard(m, piv, 2.9, 1.25, sx, angle=0.75)
    ys = hull.y(0, 0)
    k0, zr = keel(0), sheer(0)
    rud = [V(0, ys, k0 + 0.05), V(0, ys + 0.9, k0 + 0.05), V(0, ys + 1.0, 0.3), V(0, ys + 0.7, zr + 0.25),
           V(0, ys + 0.3, zr + 0.3)]
    m.prism([p + V(-0.05, 0, 0) for p in rud], (0.1, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.beam((0, ys + 0.35, zr + 0.2), (0, ys - 1.8, zr + 0.4), 0.07, 0.08, DARK)
    with m.at(move(0.6, hull.y(0.2, 0), 0.2)):
        m.lathe([(0.2, 0), (0.28, 0.35), (0.3, 0.4)], 7, ROPE, smooth=False, cap0=True, urep=2)
    barrel_lo(m, (-0.7, hull.y(0.18, 0), 0.2), yaw=0.3)
    return m


# ------------------------------------------------------------------ ships


class MastPlan:
    """A raked mast: lower mast, topmast, topgallant pole; axis point at any height."""

    def __init__(self, y, zd, h1, h2, h3, rake, r=0.34):
        self.y, self.zd, self.h1, self.h2, self.h3, self.rake, self.r = y, zd, h1, h2, h3, rake, r

    def at(self, z):
        return V(0, self.y + self.rake * (z - self.zd), z)

    def build(self, m, top_w=2.8, top_d=2.0):
        r = self.r
        spar(m, self.at(self.zd - 0.3), self.at(self.h1 + 0.4), r, r * 0.82)
        spar(m, self.at(self.h1 - 2.2) + V(0, -0.5, 0), self.at(self.h2 + 0.3) + V(0, -0.5, 0), r * 0.62, r * 0.46)
        if self.h3 > self.h2:
            spar(m, self.at(self.h2 - 1.8) + V(0, -0.8, 0), self.at(self.h3) + V(0, -0.8, 0), r * 0.36, r * 0.16, cap=True)
        # the top (a platform), the cap, crosstrees
        m.box(self.at(self.h1) + V(0, 0.1, 0), (top_w, top_d, 0.14), DARK, shade=0.8)
        m.box(self.at(self.h1 + 0.45) + V(0, -0.25, 0), (0.5, 1.0, 0.25), DARK)
        c = self.at(self.h2) + V(0, -0.5, 0)
        m.beam(c + V(-1.1, 0, 0), c + V(1.1, 0, 0), 0.1, 0.1, DARK, side=(0, 1, 0))
        m.beam(c + V(0, -0.5, 0), c + V(0, 0.5, 0), 0.1, 0.1, DARK)

    def top(self, level):
        """Axis point of the lower mast (1), topmast (2) or topgallant (3) head."""
        z = (self.h1, self.h2, self.h3)[level - 1]
        return self.at(z) + V(0, (0, -0.5, -0.8)[level - 1], 0)


def barque():
    """A three-masted barque of the 1870s, ~48 m: black hull with a painted port band,
    copper below the waterline, square yards on fore and main with the sails furled,
    fore-and-aft mizzen, bowsprit and jibboom, deckhouse with a boat on it."""
    m = Mesh(ao=0.0)
    L, B, KZ, SZ = 48.0, 9.2, -4.2, 2.9

    def keel(t):
        return KZ + 1.3 * sm((t - 0.93) / 0.07) ** 1.5 + 0.3 * sm((0.04 - t) / 0.04)

    def sheer(t):
        return SZ + 1.0 * max(0.0, (t - 0.55) / 0.45) ** 2 + 0.7 * max(0.0, (0.35 - t) / 0.35) ** 2

    SEC = [(0, 0.22), (0.12, 0.7), (0.3, 0.9), (0.55, 0.99), (0.8, 1.0), (1.0, 0.95)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.6:
            f = (t - 0.6) / 0.4
            p = (1 - min(f, 1.0) ** 2) ** (0.7 + 1.0 * (1 - u))
        elif t < 0.32:
            f = (0.32 - t) / 0.32
            p = (1 - min(f, 1.0) ** 2.2) ** (0.5 + 1.4 * (1 - u))
            p = max(p, 0.55 * sm((u - 0.5) / 0.5) * (1 - t / 0.32) + p * 0)
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -3.0 * u ** 1.3 * sm((t - 0.9) / 0.1) + 2.2 * u ** 2 * sm((0.06 - t) / 0.06)

    ts = [0, 0.02, 0.05, 0.1, 0.18, 0.3, 0.45, 0.6, 0.7, 0.8, 0.88, 0.93, 0.97, 1.0]
    levels = [keel, lambda t: keel(t) + 0.9, lambda t: -1.8, lambda t: 0.15, lambda t: sheer(t) - 1.6,
              lambda t: sheer(t) - 0.8, sheer]
    mats = [(COPPER, 0), (COPPER, 0), (COPPER, 0), (TAR, 0), (BAND, 5.0), (TAR, 0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 3.5) / 6.5))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 1.1

    hull.deck(m, zd, 0, 1, 0.12, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.15, WHITE, DARK)

    # masts
    def plan(t, h1, h2, h3, rake, r):
        return MastPlan(hull.y(t, zd(t)), zd(t), zd(t) + h1, zd(t) + h2, zd(t) + h3, rake, r)

    fore = plan(0.77, 14.5, 25.0, 33.0, 0.02, 0.34)
    main = plan(0.52, 15.5, 27.0, 36.0, 0.035, 0.36)
    mizz = plan(0.27, 12.5, 21.5, 21.5, 0.05, 0.28)
    for mp in (fore, main, mizz):
        mp.build(m, top_w=2.8 if mp is not mizz else 2.2)
    # yards with furled sails, fore and main
    for mp, s in ((fore, 0.93), (main, 1.0)):
        h1, h2, h3 = mp.h1, mp.h2, mp.h3
        spec = [(h1 - 1.6, 18.5, 0.24, 0.42), (h1 + 0.7, 16.0, 0.2, 0.34), (h1 + (h2 - h1) * 0.55, 14.0, 0.17, 0.3),
                (h2 + 1.0, 10.5, 0.13, 0.22), (h2 + (h3 - h2) * 0.62, 7.5, 0.1, 0.16)]
        for i, (z, ln, r, sr) in enumerate(spec):
            c = mp.at(z) + V(0, -0.55 - (0.5 if i >= 2 else 0) - (0.3 if i >= 3 else 0), 0)
            lift = mp.at(z + (1.8 if i < 3 else 1.2)) + V(0, -0.5, 0)
            yard(m, c, ln * s, r, sr, lifts_to=lift if i < 4 else None)
            if i < 2:
                # braces: from the yardarms aft to the rail
                for sx in (1, -1):
                    t_to = 0.36 if mp is main else 0.6
                    rig(m, c + V(sx * ln * s / 2 * 0.95, 0, 0), hull.P(t_to, sheer(t_to), sx) + V(0, 0, 0.1), 0.016)
    # mizzen: gaff and boom with the spanker brailed up
    g0 = mizz.at(mizz.h1 - 1.3)
    g1 = g0 + V(0, 9.0 * math.cos(0.45), 9.0 * math.sin(0.45))
    spar(m, g0, g1, 0.16, 0.1)
    b0 = mizz.at(mizz.zd + 2.3)
    b1 = b0 + V(0, 13.0, 0.4)
    spar(m, b0, b1, 0.18, 0.12)
    bundle(m, g0 + V(0, 0.6, -0.35), g1 + V(0, -0.8, -0.3), 0.3, CANVAS, n=5)
    bundle(m, mizz.at(mizz.zd + 3.2) + V(0, 0.4, 0), g0 + V(0, 0.4, -0.6), 0.28, CANVAS, n=3)
    rig(m, g1, b1, 0.018)
    rig(m, mizz.top(2) - V(0, 0, 0.5), g1)
    rig(m, mizz.top(2) - V(0, 0, 0.3), b1)
    flag(m, g1 + V(0, 0.05, -0.1), 2.0, 1.3, along=(0, 0.2, -1))
    # bowsprit, jibboom, headsails furled on the boom
    tb = 1.0
    stem_top = V(0, hull.y(tb, sheer(tb)), sheer(tb))
    a = math.radians(13)
    dv = V(0, -math.cos(a), math.sin(a))
    heel = stem_top + V(0, 3.0, -0.3)
    bs_end = heel + dv * 11.0
    spar(m, heel, bs_end, 0.36, 0.26)
    jb0, jb1 = heel + dv * 7.5, heel + dv * 19.0
    spar(m, jb0, jb1, 0.2, 0.09)
    m.box(bs_end + V(0, 0.15, 0.05), (0.6, 0.35, 0.6), DARK)
    bundle(m, heel + dv * 11.8 + V(0, 0, 0.22), heel + dv * 18.3 + V(0, 0, 0.14), 0.22, CANVAS, n=4)
    striker = bs_end + V(0, 0.2, -2.2)
    spar(m, bs_end + V(0, 0.2, -0.2), striker, 0.07, 0.06)
    rig(m, bs_end, V(0, hull.y(1.0, 0.4) + 0.4, 0.4), 0.035)
    rig(m, jb1, striker, 0.022)
    rig(m, striker, V(0, hull.y(1.0, 1.3) + 0.3, 1.3), 0.022)
    for sx in (1, -1):
        rig(m, bs_end + V(sx * 0.25, 0, 0), hull.P(0.95, sheer(0.95) - 0.9, sx), 0.022)
    # figurehead under the bowsprit
    fh = [V(0, hull.y(1.0, sheer(1.0) - 1.6) + 0.35, sheer(1.0) - 1.6), V(0, hull.y(1.0, sheer(1.0) - 1.0) - 0.2, sheer(1.0) - 1.0),
          V(0, hull.y(1.0, sheer(1.0) - 0.4) - 0.55, sheer(1.0) - 0.45)]
    m.tube(fh, [0.18, 0.26, 0.15], 5, WHITE, smooth=False, cap0=True, cap1=True, side=(1, 0, 0))
    # stays
    fs = [(fore.top(1), heel + dv * 6.0), (fore.top(2), jb0 + dv * 5.0), (fore.top(3) - V(0, 0, 1.2), jb1)]
    ms = [(main.top(1), fore.at(fore.zd + 1.2) + V(0, 0.6, 0)), (main.top(2), fore.top(1)), (main.top(3) - V(0, 0, 1.2), fore.top(2))]
    zs = [(mizz.top(1), main.at(main.h1 - 3.5)), (mizz.top(2), main.top(1) + V(0, 0, 0.4))]
    for a_, b_ in fs + ms + zs:
        rig(m, a_, b_, 0.03)
    # shrouds (with ratlines), channels, backstays
    for mp, tm in ((fore, 0.77), (main, 0.52), (mizz, 0.27)):
        ym = mp.y
        wch = hull.hb(tm, mp.zd + 0.4)
        for sx in (1, -1):
            m.box((sx * (wch + 0.18), ym + 0.2, mp.zd + 0.35), (0.4, 3.6, 0.12), DARK)
            shroud_quad(m, (sx * (wch + 0.34), ym - 1.5, mp.zd + 0.4), (sx * (wch + 0.34), ym + 1.8, mp.zd + 0.4),
                        mp.at(mp.h1 - 0.7) + V(sx * 0.34, 0.35, 0), mp.at(mp.h1 - 0.7) + V(sx * 0.34, -0.35, 0))
            tw = 1.3 if mp is not mizz else 1.0
            shroud_quad(m, mp.at(mp.h1 + 0.1) + V(sx * tw, -0.7, 0), mp.at(mp.h1 + 0.1) + V(sx * tw, 0.9, 0),
                        mp.top(2) + V(sx * 0.2, 0.15, -0.6), mp.top(2) + V(sx * 0.2, -0.15, -0.6))
            if mp.h3 > mp.h2:
                shroud_quad(m, mp.top(2) + V(sx * 1.0, -0.2, 0.05), mp.top(2) + V(sx * 1.0, 0.4, 0.05),
                            mp.top(3) + V(sx * 0.1, 0.05, -3.0), mp.top(3) + V(sx * 0.1, -0.05, -3.0))
            for lvl, dy in ((2, 3.4), (3, 4.4)):
                if lvl == 3 and mp.h3 <= mp.h2:
                    continue
                rig(m, mp.top(lvl) - V(0, 0, 0.4), V(sx * (wch + 0.3), ym + dy, mp.zd + 0.4), 0.02)
    # deckhouse with the ship's boat on it, galley chimney
    y0, y1 = hull.y(0.68, zd(0.68)), hull.y(0.585, zd(0.585))
    z0 = zd(0.63) - 0.05
    house(m, -2.1, 2.1, y0, y1, z0, z0 + 2.2, wall=WHITE, roof=DARK, over=0.12,
          windows=[("+x", y0 + 1.3, z0 + 1.4), ("+x", y1 - 1.3, z0 + 1.4), ("-x", y0 + 1.3, z0 + 1.4), ("-x", y1 - 1.3, z0 + 1.4),
                   ("-y", 1.0, z0 + 1.4)], door=("-y", -0.8, 0.8, 1.8))
    chimney(m, 1.3, y1 - 0.8, z0 + 2.3, 0.8, 0.12)
    for dy in (-1.6, 1.6):
        m.box((0, (y0 + y1) / 2 + dy, z0 + 2.38), (1.2, 0.2, 0.2), DARK)
    ships_boat(m, (0, (y0 + y1) / 2, z0 + 2.48), 5.6, 1.7, 0.75, yaw=0.0, mat=WHITE, cover=CANVAS)
    # hatches with tarpaulins, casks, pumps, windlass, anchors, wheel and skylight
    for t0_, t1_ in ((0.405, 0.455), (0.705, 0.74)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        zc = zd((t0_ + t1_) / 2)
        m.box((0, (ya + yb) / 2, zc + 0.3), (2.8, yb - ya, 0.6), DARK, shade=0.9)
        m.box((0, (ya + yb) / 2, zc + 0.64), (2.95, yb - ya + 0.15, 0.08), TARP, shade=0.95)
    for i, dx in enumerate((-1.3, -0.6)):
        barrel_lo(m, (dx, main.y + 1.6, zd(0.5)), yaw=i * 1.3)
    for sx in (1, -1):
        m.box((sx * 0.6, main.y + 1.0, zd(0.52) + 0.55), (0.25, 0.25, 1.1), DARK)
    windlass(m, 0, hull.y(0.925, zd(0.925)), zd(0.925) + 0.4, w=2.2, r=0.25)
    for sx in (1, -1):
        cat = hull.P(0.95, sheer(0.95) + 0.2, sx) + V(sx * 0.6, 0, 0)
        m.beam(hull.P(0.95, sheer(0.95) + 0.1, sx, 0.4), cat, 0.3, 0.3, DARK, side=(0, 1, 0))
        with m.at(move(cat.x + sx * 0.1, cat.y, cat.z - 0.3)):
            anchor(m, V(0, 0, 0), side=(1, 0, 0), size=0.9)
    zq = zd(0.05)
    m.box((0, hull.y(0.06, zq), zq + 0.4), (1.0, 0.7, 0.8), DARK)
    wheel_helm(m, V(0, hull.y(0.06, zq) - 0.55, zq + 1.1), 0.55)
    m.box((0, hull.y(0.13, zd(0.13)), zd(0.13) + 0.35), (1.6, 1.3, 0.7), DARK)
    m.box((0, hull.y(0.13, zd(0.13)), zd(0.13) + 0.74), (1.5, 1.2, 0.08), WINDOW)
    m.box((1.4, hull.y(0.2, zd(0.2)), zd(0.2) + 0.5), (1.0, 1.2, 1.0), DARK)
    # house flag at the main truck
    flag(m, main.top(3) + V(0, -0.8, 0.9), 1.3, 0.9, along=(0, 1, 0))
    spar(m, main.top(3) + V(0, -0.8, 0), main.top(3) + V(0, -0.8, 1.0), 0.04, 0.03)
    return m


def steamer():
    """An iron screw steamer of the 1870s, ~56 m: plumb stem, counter stern, black hull with
    portholes, red below the waterline, one funnel, two masts with yards and cargo derricks,
    a midship house with an open bridge, boats in davits, cowl ventilators."""
    m = Mesh(ao=0.0)
    L, B, KZ, SZ = 56.0, 8.4, -3.8, 3.4

    def keel(t):
        return KZ + 0.5 * sm((t - 0.96) / 0.04) + 0.9 * sm((0.05 - t) / 0.05)

    def sheer(t):
        return SZ + 1.3 * max(0.0, (t - 0.62) / 0.38) ** 2 + 0.6 * max(0.0, (0.3 - t) / 0.3) ** 2

    SEC = [(0, 0.6), (0.08, 0.9), (0.2, 0.99), (1, 1.0)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.68:
            f = (t - 0.68) / 0.32
            p = (1 - min(f, 1.0) ** 1.9) ** (0.8 * (1 + 0.6 * (1 - u)))
        elif t < 0.3:
            f = (0.3 - t) / 0.3
            p = (1 - min(f, 1.0) ** 2) ** (0.45 + 1.6 * (1 - u))
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -0.9 * u * sm((t - 0.94) / 0.06) + 3.0 * u ** 2.2 * sm((0.06 - t) / 0.06)

    ts = [0, 0.015, 0.035, 0.07, 0.12, 0.2, 0.3, 0.45, 0.6, 0.7, 0.8, 0.88, 0.94, 0.975, 1.0]
    levels = [keel, lambda t: keel(t) + 0.8, lambda t: -1.4, lambda t: -0.02, lambda t: 1.2, lambda t: sheer(t) - 2.0,
              lambda t: sheer(t) - 1.45, sheer]
    mats = [(REDLEAD, 0), (REDLEAD, 0), (REDLEAD, 0), (IRONHULL, 0), (IRONHULL, 0), (PORTS, 8.0), (IRONHULL, 0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 3.0) / 6.0))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 1.0

    hull.deck(m, zd, 0, 1, 0.1, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.1, WHITE, DARK, shade=0.9)
    # midship house, its roof deck with rails, the bridge across the ship
    zh = zd(0.5)
    hy0, hy1 = hull.y(0.61, zh), hull.y(0.4, zh)
    HH = 2.4
    wins = []
    for f in (0.12, 0.3, 0.5, 0.7, 0.88):
        a = hy0 + (hy1 - hy0) * f
        wins += [("+x", a, zh + 1.5), ("-x", a, zh + 1.5)]
    house(m, -2.6, 2.6, hy0, hy1, zh - 0.05, zh + HH, wall=WOOD, roof=DECK, over=0.25, windows=wins,
          door=("-y", 0.0, 0.8, 1.9))
    zr = zh + HH + 0.1
    for sx in (1, -1):
        rig(m, (sx * 2.8, hy0 + 1.5, zr + 0.9), (sx * 2.8, hy1 + 0.2, zr + 0.9), 0.03, IRON)
        for y in np.linspace(hy0 + 1.5, hy1 + 0.2, 7):
            rig(m, (sx * 2.8, y, zr), (sx * 2.8, y, zr + 0.95), 0.025, IRON)
    rig(m, (-2.8, hy1 + 0.2, zr + 0.9), (2.8, hy1 + 0.2, zr + 0.9), 0.03, IRON)
    # bridge: platform across the whole beam, rails, canvas dodger, wheelhouse, binnacle
    by0, by1 = hy0 - 0.25, hy0 + 1.4
    zb = zr + 0.9
    m.box((0, (by0 + by1) / 2, zb), (B + 0.6, by1 - by0, 0.12), DECK, tile=1.6)
    for sx in (1, -1):
        for y in (by0 + 0.1, by1 - 0.1):
            m.beam((sx * 3.1, y, zd(0.61)), (sx * 3.1, y, zb - 0.06), 0.1, 0.1, IRON, side=(1, 0, 0))
    for y in (by0, by1):
        rig(m, (-(B / 2 + 0.25), y, zb + 1.0), ((B / 2 + 0.25), y, zb + 1.0), 0.03, IRON)
        for x in np.linspace(-(B / 2 + 0.25), B / 2 + 0.25, 9):
            rig(m, (x, y, zb + 0.06), (x, y, zb + 1.0), 0.025, IRON)
    m.poly([V(-(B / 2 + 0.25), by0 - 0.02, zb + 0.08), V(B / 2 + 0.25, by0 - 0.02, zb + 0.08),
            V(B / 2 + 0.25, by0 - 0.02, zb + 0.95), V(-(B / 2 + 0.25), by0 - 0.02, zb + 0.95)], CANVAS,
           uvs=[(0, 0), (6, 0), (6, 0.6), (0, 0.6)])
    house(m, -1.0, 1.0, by0 + 0.15, by1 - 0.1, zb + 0.06, zb + 2.0, wall=WHITE, roof=DARK, over=0.1,
          windows=[("-y", -0.45, zb + 1.35), ("-y", 0.45, zb + 1.35), ("+x", (by0 + by1) / 2, zb + 1.35),
                   ("-x", (by0 + by1) / 2, zb + 1.35)])
    # funnel, raked aft, with its steam pipe and guys
    fy = hull.y(0.505, zr)
    FH = 8.5
    rake = 0.11
    with m.at(move(0, fy, zr) @ Matrix.Rotation(-rake, 4, "X")):
        m.lathe([(0.98, -0.3), (0.98, FH), (1.04, FH + 0.05), (1.04, FH + 0.2)], 10, FUNNEL, urep=2, vscale=1 / FH,
                smooth=False)
        spar(m, V(0, -1.12, 0), V(0, -1.12, FH + 0.7), 0.1, 0.1, IRON, sides=5, cap=True)
    top_ring = FH * 0.72
    ftop = V(0, fy + math.sin(rake) * top_ring, zr + math.cos(rake) * top_ring)
    for dx, dy in ((2.6, 2.5), (-2.6, 2.5), (2.6, -1.0), (-2.6, -1.0)):
        rig(m, ftop, (dx, fy + dy, zr + 0.05), 0.02)
    # cowl ventilators
    def cowl(x, y, z, h, r, face):
        path = [V(x, y, z), V(x, y, z + h * 0.75), V(x, y + face * r * 0.4, z + h * 0.95),
                V(x, y + face * r * 1.1, z + h + r * 0.4)]
        m.tube(path, [r * 0.7, r * 0.7, r * 0.85, (r * 1.3, r * 1.3)], 6, WHITE, smooth=False, urep=2, vscale=0.5)
        m.tube([path[-1], path[-1] + V(0, face * 0.02, 0.01)], [r * 1.3, r * 0.5], 6, DARK, smooth=False, cap1=True)
    for sx in (1, -1):
        cowl(sx * 1.6, fy - 1.9, zr, 2.0, 0.42, -1)
        cowl(sx * 1.7, hull.y(0.72, zd(0.72)), zd(0.72), 1.6, 0.35, -1)
    # boats in davits along the house
    for sx in (1, -1):
        for bc in (hy0 + 2.9, hy1 - 2.6):
            ships_boat(m, (sx * 3.55, bc, zd(0.5) + 1.7), 5.2, 1.6, 0.72, mat=WHITE, cover=CANVAS)
            for dy in (-2.0, 2.0):
                base = V(sx * 4.0, bc + dy, zd(0.5))
                path = [base, base + V(0, 0, 3.0), base + V(-sx * 0.15, 0, 3.8), base + V(-sx * 0.55, 0, 4.1)]
                m.tube(path, [0.08, 0.075, 0.065, 0.06], 4, WHITE, smooth=False, side=(0, 1, 0), urep=1)
                rig(m, path[-1], V(sx * 3.55, bc + dy * 0.85, zd(0.5) + 1.7 + 0.8), 0.02)
    # masts, yards, gaff, derricks
    fore = MastPlan(hull.y(0.8, zd(0.8)), zd(0.8), zd(0.8) + 14.0, zd(0.8) + 24.0, zd(0.8) + 24.0, 0.07, 0.3)
    main = MastPlan(hull.y(0.27, zd(0.27)), zd(0.27), zd(0.27) + 13.0, zd(0.27) + 21.0, zd(0.27) + 21.0, 0.07, 0.28)
    for mp in (fore, main):
        mp.build(m, top_w=2.0, top_d=1.4)
    yard(m, fore.at(fore.h1 - 1.2) + V(0, -0.5, 0), 13.0, 0.2, 0.34, lifts_to=fore.at(fore.h1 + 0.5))
    yard(m, fore.at(fore.h1 + 3.6) + V(0, -1.0, 0), 10.5, 0.16, 0.27, lifts_to=fore.top(2) + V(0, 0, -1.0))
    yard(m, fore.at(fore.h1 + 7.4) + V(0, -1.0, 0), 7.5, 0.12, 0.18)
    g0 = main.at(main.h1 - 1.0)
    g1 = g0 + V(0, 7.0 * math.cos(0.5), 7.0 * math.sin(0.5))
    spar(m, g0, g1, 0.14, 0.09)
    b0, b1 = main.at(main.zd + 2.4), main.at(main.zd + 2.4) + V(0, 9.0, 0.3)
    spar(m, b0, b1, 0.15, 0.1)
    bundle(m, b0 + V(0, 0.5, 0.3), b1 + V(0, -0.6, 0.28), 0.3, CANVAS, n=4)
    rig(m, g1, b1, 0.018)
    rig(m, main.top(2) - V(0, 0, 0.4), g1)
    flag(m, g1 + V(0, 0.05, -0.05), 1.6, 1.05, along=(0, 0.25, -1))
    for mp, face, t_h in ((fore, 1, 0.69), (main, -1, 0.35)):
        for sx in (1, -1):
            heel = mp.at(mp.zd + 1.4) + V(sx * 0.35, face * 0.35, 0)
            head = heel + V(sx * 1.4, face * 7.0, 6.2)
            spar(m, heel, head, 0.14, 0.08)
            rig(m, head, mp.at(mp.h1 - 0.4), 0.025)
            rig(m, head, head - V(0, 0, 3.0 + 0.8 * sx), 0.02, IRON)
            m.box(head - V(0, 0, 3.1 + 0.8 * sx), (0.14, 0.16, 0.22), IRON)
        rig(m, mp.at(mp.zd + 1.4) + V(0, face * 0.5, 0), hull.P(t_h, zd(t_h), 1, 1.5) + V(0, 0, 0.3), 0.03, ROPE)
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.3, sheer(1.0))
    rig(m, fore.top(1), stem, 0.03)
    rig(m, fore.top(2), stem + V(0, 0.2, 0.2), 0.025)
    rig(m, main.top(1), ftop + V(0, 0.6, 0.6), 0.025)
    rig(m, main.top(2), fore.top(2) - V(0, 0, 1.0), 0.022)
    for mp, tm in ((fore, 0.8), (main, 0.27)):
        w = hull.hb(tm, sheer(tm))
        for sx in (1, -1):
            shroud_quad(m, (sx * (w - 0.05), mp.y - 0.9, sheer(tm)), (sx * (w - 0.05), mp.y + 1.6, sheer(tm)),
                        mp.at(mp.h1 - 0.6) + V(sx * 0.3, 0.3, 0), mp.at(mp.h1 - 0.6) + V(sx * 0.3, -0.3, 0))
            shroud_quad(m, mp.at(mp.h1 + 0.1) + V(sx * 1.0, -0.5, 0), mp.at(mp.h1 + 0.1) + V(sx * 1.0, 0.7, 0),
                        mp.top(2) + V(sx * 0.15, 0.1, -0.6), mp.top(2) + V(sx * 0.15, -0.1, -0.6))
            rig(m, mp.top(2) - V(0, 0, 0.4), V(sx * (w - 0.05), mp.y + 3.2, sheer(tm)), 0.02)
    # hatches, windlass, anchors, skylight, wheel aft, flagstaff
    for t0_, t1_ in ((0.66, 0.72), (0.32, 0.37)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        zc = zd((t0_ + t1_) / 2)
        m.box((0, (ya + yb) / 2, zc + 0.3), (3.4, yb - ya, 0.6), DARK, shade=0.9)
        m.box((0, (ya + yb) / 2, zc + 0.64), (3.55, yb - ya + 0.15, 0.08), TARP, shade=0.95)
    windlass(m, 0, hull.y(0.93, zd(0.93)), zd(0.93) + 0.4, w=2.0, r=0.22)
    for sx in (1, -1):
        cat = hull.P(0.93, sheer(0.93) + 0.15, sx) + V(sx * 0.5, 0, 0)
        m.beam(hull.P(0.93, sheer(0.93) + 0.05, sx, 0.4), cat, 0.25, 0.25, IRON, side=(0, 1, 0))
        with m.at(move(cat.x + sx * 0.1, cat.y, cat.z - 0.3)):
            anchor(m, V(0, 0, 0), side=(1, 0, 0), size=0.8)
    m.box((0, hull.y(0.2, zd(0.2)), zd(0.2) + 0.4), (1.8, 1.4, 0.8), DARK)
    m.box((0, hull.y(0.2, zd(0.2)), zd(0.2) + 0.84), (1.7, 1.3, 0.08), WINDOW)
    zq = zd(0.1)
    m.box((0, hull.y(0.1, zq), zq + 0.4), (1.0, 0.7, 0.8), DARK)
    wheel_helm(m, V(0, hull.y(0.1, zq) - 0.55, zq + 1.1), 0.6)
    fs0 = V(0, hull.y(0.0, sheer(0.0)) - 0.4, zd(0.0))
    spar(m, fs0, fs0 + V(0, 0.4, 4.5), 0.06, 0.04, cap=True)
    flag(m, fs0 + V(0, 0.45, 4.4), 1.7, 1.1, along=(0, 1, -0.15))
    # propeller and rudder under the counter
    py = L / 2 - 0.9
    with m.at(move(0, py, -2.3) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.25, -0.4), (0.3, 0.0), (0.2, 0.4)], 6, IRON, smooth=False, cap0=True, cap1=True)
    for k in range(4):
        a = math.pi / 2 * k + 0.4
        d = V(math.cos(a), 0, math.sin(a))
        s = V(-math.sin(a), 0.35, math.cos(a)).normalized()
        c = V(0, py, -2.3)
        m.slab([c + d * 0.25 - s * 0.35, c + d * 0.25 + s * 0.35, c + d * 1.5 + s * 0.3, c + d * 1.5 - s * 0.25], 0.05, IRON,
               out=(0, -1, 0))
    rud = [V(0, L / 2 + 0.15, KZ + 0.9), V(0, L / 2 + 1.6, KZ + 0.9), V(0, L / 2 + 1.6, 0.4), V(0, L / 2 + 0.15, 0.9)]
    m.prism([p + V(-0.08, 0, 0) for p in rud], (0.16, 0, 0), IRON, tile=2.0)
    return m


def tug(paddle=False):
    """A harbour tug, ~19 m: iron hull, a tall thin funnel, engine casing with a small
    wheelhouse, towing arch aft, fenders. paddle=True: a paddle tug with paddle boxes."""
    m = Mesh(ao=0.0)
    L, B, KZ, SZ = 19.0, 4.6 if not paddle else 4.3, -2.1, 1.25

    def keel(t):
        return KZ + 0.4 * sm((t - 0.93) / 0.07) + (0.0 if paddle else 0.7) * sm((0.08 - t) / 0.08)

    def sheer(t):
        return SZ + 0.8 * max(0.0, (t - 0.6) / 0.4) ** 2 + 0.2 * max(0.0, (0.3 - t) / 0.3) ** 2

    SEC = [(0, 0.45), (0.15, 0.85), (0.35, 0.98), (1, 1.0)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.6:
            f = (t - 0.6) / 0.4
            p = (1 - min(f, 1.0) ** 1.8) ** (0.8 + 0.5 * (1 - u))
        elif t < 0.35:
            f = (0.35 - t) / 0.35
            p = (1 - min(f, 1.0) ** 2) ** (0.4 + 1.5 * (1 - u))
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -0.3 * u * sm((t - 0.9) / 0.1) + 1.4 * u ** 2 * sm((0.08 - t) / 0.08)

    ts = [0, 0.03, 0.08, 0.15, 0.25, 0.4, 0.55, 0.68, 0.8, 0.88, 0.94, 0.98, 1.0]
    levels = [keel, lambda t: keel(t) + 0.6, lambda t: -0.8, lambda t: 0.0, lambda t: sheer(t) - 0.35, sheer]
    mats = [(REDLEAD, 0), (REDLEAD, 0), (REDLEAD, 0), (IRONHULL, 0), (WHITE, 3.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 1.8) / 3.2))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 0.75

    hull.deck(m, zd, 0, 1, 0.08, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, DARK, DARK)
    # engine casing and wheelhouse
    z0 = zd(0.45)
    cy0, cy1 = hull.y(0.64, z0), hull.y(0.3, z0)
    house(m, -1.45, 1.45, cy0, cy1, z0 - 0.05, z0 + 1.7, wall=WHITE, roof=DARK, over=0.1,
          windows=[("+x", cy0 + 1.2, z0 + 1.2), ("+x", cy1 - 1.2, z0 + 1.2), ("-x", cy0 + 1.2, z0 + 1.2),
                   ("-x", cy1 - 1.2, z0 + 1.2)], door=("+y", 0.0, 0.7, 1.5))
    zw = z0 + 1.8
    house(m, -1.15, 1.15, cy0 + 0.15, cy0 + 1.6, zw, zw + 1.75, wall=WOOD, roof=DARK, over=0.12,
          windows=[("-y", -0.55, zw + 1.2), ("-y", 0.0, zw + 1.2), ("-y", 0.55, zw + 1.2), ("+x", cy0 + 0.9, zw + 1.2),
                   ("-x", cy0 + 0.9, zw + 1.2)])
    # skylight on the casing, lifebuoys
    m.box((0, cy1 - 1.4, zw + 0.2), (1.2, 1.6, 0.4), DARK)
    m.box((0, cy1 - 1.4, zw + 0.42), (1.1, 1.5, 0.06), WINDOW)
    for sx in (1, -1):
        with m.at(move(sx * 1.47, cy0 + 2.6, z0 + 1.0) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
            pts = [V(0.3 * math.cos(2 * math.pi * i / 8), 0.3 * math.sin(2 * math.pi * i / 8), 0) for i in range(8)]
            m.tube(pts, [0.07] * 8, 4, WHITE, side=(0, 0, 1), closed_path=True, smooth=False)
    # the tall funnel
    fy = hull.y(0.5, zw)
    FH = 6.4
    with m.at(move(0, fy, zw) @ Matrix.Rotation(-0.06, 4, "X")):
        m.lathe([(0.52, -0.2), (0.52, FH), (0.56, FH + 0.05), (0.56, FH + 0.18)], 8, FUNNEL, urep=2, vscale=1 / FH,
                smooth=False)
        spar(m, V(0, -0.62, 0), V(0, -0.62, FH + 0.5), 0.06, 0.06, IRON, sides=4, cap=True)
    ft = V(0, fy + 0.25, zw + FH * 0.75)
    for dx, dy in ((1.5, 1.5), (-1.5, 1.5), (1.5, -1.8), (-1.5, -1.8)):
        rig(m, ft, (dx, fy + dy, zw - 0.05), 0.018)
    # mast forward, towing arch aft, towing hook, bitts
    tm = 0.84
    ym = hull.y(tm, zd(tm))
    spar(m, (0, ym, zd(tm)), (0, ym + 0.2, zd(tm) + 7.5), 0.1, 0.06, DARK, cap=True)
    m.box((0, ym + 0.05, zd(tm) + 5.0), (0.25, 0.25, 0.35), IRON)
    rig(m, (0, ym + 0.2, zd(tm) + 7.2), (0, hull.y(1, sheer(1)) + 0.2, sheer(1) + 0.05))
    pennant(m, (0, ym + 0.2, zd(tm) + 7.7), 1.2, h=0.2)
    ta = 0.2
    wa = hull.hb(ta, sheer(ta)) - 0.1
    ya = hull.y(ta, zd(ta))
    arch = [V(wa * math.cos(math.pi * j / 6), ya, sheer(ta) + 1.0 * math.sin(math.pi * j / 6)) for j in range(7)]
    m.tube(arch, [0.07] * 7, 4, IRON, side=(0, 1, 0), smooth=False)
    m.box((0, hull.y(0.3, zd(0.3)) + 0.9, zd(0.3) + 0.5), (0.3, 0.3, 1.0), IRON)
    for t in (0.06, 0.95):
        for sx in (1, -1):
            bitts(m, sx * 0.55, hull.y(t, zd(t)), zd(t), 0.5, 0.18)
    with m.at(move(0.6, hull.y(0.1, zd(0.1)), zd(0.1))):
        m.lathe([(0.35, 0), (0.4, 0.12), (0.3, 0.2)], 8, ROPE, smooth=False, cap1=True, urep=3)
    # fenders: a fat rope pad at the stem, a few hanging over the side
    stem = V(0, hull.y(1.0, sheer(1.0) - 0.3), sheer(1.0) - 0.3)
    m.tube([stem + V(-0.5, 0.25, 0), stem + V(0, -0.15, 0), stem + V(0.5, 0.25, 0)], [0.18, 0.22, 0.18], 5, ROPE,
           side=(0, 0, 1), smooth=False, cap0=True, cap1=True)
    for sx in (1, -1):
        for t in (0.35, 0.55, 0.72):
            p = hull.P(t, 0.55, sx) + V(sx * 0.12, 0, 0)
            m.tube([p + V(0, 0, 0.25), p - V(0, 0, 0.3)], [0.14, 0.14], 5, ROPE, smooth=False, cap0=True, cap1=True)
    if paddle:
        yc = hull.y(0.47, 0)
        for sx in (1, -1):
            x0 = sx * hull.hb(0.47, 0.5)
            prof = [V(x0, yc + 2.0 * math.cos(math.pi * j / 8), 0.3 + 1.9 * math.sin(math.pi * j / 8)) for j in range(9)]
            m.prism(prof, (sx * 1.1, 0, 0), DARK, tile=1.2, side_mat=WHITE)
            m.box((sx * (abs(x0) + 0.55), yc, zd(0.47) + 0.05), (1.1, 5.2, 0.1), DECK)
    else:
        py = L / 2 - 0.55
        with m.at(move(0, py, -1.3) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            m.lathe([(0.15, -0.25), (0.18, 0.0), (0.12, 0.25)], 6, IRON, smooth=False, cap0=True, cap1=True)
        for k in range(4):
            a = math.pi / 2 * k + 0.3
            d = V(math.cos(a), 0, math.sin(a))
            s = V(-math.sin(a), 0.35, math.cos(a)).normalized()
            c = V(0, py, -1.3)
            m.slab([c + d * 0.15 - s * 0.22, c + d * 0.15 + s * 0.22, c + d * 0.85 + s * 0.2, c + d * 0.85 - s * 0.15], 0.04,
                   IRON, out=(0, -1, 0))
        rud = [V(0, L / 2 - 0.1, KZ + 0.8), V(0, L / 2 + 0.9, KZ + 0.8), V(0, L / 2 + 0.9, 0.2), V(0, L / 2 - 0.1, 0.5)]
        m.prism([p + V(-0.06, 0, 0) for p in rud], (0.12, 0, 0), IRON, tile=2.0)
    return m


# ------------------------------------------------------------------ pontoon and cranes

PONTOON_DECK = 1.8  # deck top above the waterline: level with the quay (quay 1.8 m above the water)
PONTOON_LEN = 10.0
PONTOON_HALF = 2.05  # walkable half width between the railings


def pontoon_section():
    """10 m of floating walkway: a plank deck on stringers and trestles, two tarred floats
    with rounded ends under it, railings both sides. Open at both ends so sections chain."""
    m = Mesh(ao=0.0)
    m.shadefn = lambda p: 0.55 + 0.45 * sm((p.z + 0.8) / 2.6)
    for sx in (1, -1):
        cx = sx * 1.35
        out = []
        for j in range(5):
            a = math.pi * j / 4
            out.append(V(cx + 0.75 * math.cos(a), 4.3 + 0.5 * math.sin(a), -0.8))
        for j in range(5):
            a = math.pi + math.pi * j / 4
            out.append(V(cx + 0.75 * math.cos(a), -4.3 + 0.5 * math.sin(a), -0.8))
        m.prism(out, (0, 0, 1.4), TAR, tile=2.0)
        m.box((cx, 0, 0.62), (1.3, 7.6, 0.05), DARK)  # a walking board on the float
        for y in (-3.6, 0.0, 3.6):
            m.beam((cx, y, 0.6), (cx, y, 1.5), 0.2, 0.2, DARK, side=(1, 0, 0))
    m.shadefn = None
    for y in (-3.0, 3.0):
        m.beam((-1.35, y, 0.65), (1.35, y, 1.45), 0.12, 0.12, DARK, side=(0, 1, 0))
        m.beam((1.35, y, 0.65), (-1.35, y, 1.45), 0.12, 0.12, DARK, side=(0, 1, 0))
    for x in (-2.15, -1.35, 1.35, 2.15):
        m.beam((x, -5.0, 1.52), (x, 5.0, 1.52), 0.2, 0.2, DARK, shade=0.75)
    for y in np.linspace(-4.5, 4.5, 7):
        m.beam((-2.3, y, 1.66), (2.3, y, 1.66), 0.14, 0.12, DARK, side=(0, 1, 0), shade=0.7)
    m.box((0, 0, PONTOON_DECK - 0.04), (4.5, PONTOON_LEN, 0.08), DECK, tile=1.6, shade=0.95)
    # railings: posts every 2.5 m, top and middle rails, a kick board
    for sx in (1, -1):
        x = sx * 2.17
        for y in (-3.75, -1.25, 1.25, 3.75):
            m.box((x, y, PONTOON_DECK + 0.55), (0.1, 0.1, 1.1), DARK)
        for z, w, h in ((1.08, 0.08, 0.09), (0.55, 0.06, 0.06)):
            m.beam((x, -5.0, PONTOON_DECK + z), (x, 5.0, PONTOON_DECK + z), w, h, DARK)
        m.box((x, 0, PONTOON_DECK + 0.08), (0.04, PONTOON_LEN, 0.16), WOOD, shade=0.85)
        # fender posts and mooring cleats on the outside
        for y in (-4.6, 0.0, 4.6):
            m.box((sx * 2.33, y, 0.9), (0.14, 0.2, 1.8), DARK, shade=0.8)
        m.box((sx * 2.0, 2.5, PONTOON_DECK + 0.08), (0.14, 0.4, 0.14), IRON)
    return m


def portal_crane():
    """The fixed part of a quay crane: an iron portal on four legs standing on bogies on
    two crane rails, straddling a railway track, with a ladder. The turning part is portal_jib()."""
    m = Mesh(ao=0.0)
    TOP = PORTAL_TOP
    for y in (-2.6, 2.6, -0.72, 0.72):
        m.box((0, y, 0.03), (10.0, 0.09, 0.06), IRON, tile=2.0)
    for sx in (1, -1):
        for sy in (1, -1):
            x, y = sx * 2.2, sy * 2.6
            m.box((x, y, 0.55), (1.4, 0.44, 0.5), IRON)
            for dx in (-0.42, 0.42):
                with m.at(move(x + dx, y, 0.32) @ Matrix.Rotation(math.pi / 2, 4, "X")):
                    m.lathe([(0.3, -0.1), (0.3, 0.1)], 8, IRON, cap0=True, cap1=True, smooth=False)
            m.beam((x, y, 0.8), (sx * 1.15, sy * 2.35, TOP - 0.9), 0.44, 0.34, IRON, side=(1, 0, 0), w2=0.34, h2=0.3)

    def lx(z):
        return 2.2 - 1.05 * (z - 0.8) / (TOP - 1.7)

    for sy in (1, -1):
        y = sy * 2.5
        m.beam((-lx(2.4), y, 2.4), (lx(2.4), y, 2.4), 0.22, 0.22, IRON, side=(0, 1, 0))
        m.slab([(-lx(TOP - 2.0), y, TOP - 2.0), (lx(TOP - 2.0), y, TOP - 2.0), (1.15, y, TOP - 0.9), (-1.15, y, TOP - 0.9)],
               0.06, IRON, out=(0, sy, 0))
        m.beam((-lx(2.4), y, 2.4), (0, y, TOP - 2.0), 0.16, 0.16, IRON, side=(0, 1, 0))
        m.beam((lx(2.4), y, 2.4), (0, y, TOP - 2.0), 0.16, 0.16, IRON, side=(0, 1, 0))
        # a painted number board
        panel(m, (0, y, TOP - 1.35), (sy, 0, 0), (0, 0, 1), 0.7, 0.35, WHITE, off=0.05)
    for sx in (1, -1):
        m.box((sx * 1.15, 0, TOP - 0.45), (0.36, 5.3, 0.9), IRON)
        for sy in (1, -1):
            m.slab([(sx * 1.15, sy * 2.35, TOP - 2.3), (sx * 1.15, sy * 2.35, TOP - 0.9), (sx * 1.15, sy * 1.1, TOP - 0.9),
                    (sx * 1.15, sy * 1.9, TOP - 1.4)], 0.05, IRON, out=(sx, 0, 0))
    m.box((0, 0, TOP - 0.06), (3.0, 5.3, 0.12), IRON)
    with m.at(move(0, 0, TOP)):
        m.lathe([(1.4, 0.0), (1.4, 0.15)], 12, IRON, smooth=False, cap1=True, urep=3)
    # ladder up the +y side of the portal
    for x in (1.35, 1.75):
        m.beam((x, 2.95, 0.0), (x, 2.95, TOP), 0.06, 0.08, IRON, side=(1, 0, 0))
    for z in np.arange(0.35, TOP - 0.1, 0.35):
        rig(m, (1.35, 2.95, z), (1.75, 2.95, z), 0.02, IRON)
    m.box((1.55, 2.78, TOP - 0.06), (0.6, 0.5, 0.08), IRON)
    return m


PORTAL_TOP = 5.8
JIB_ANGLE, JIB_LEN = math.radians(40), 12.5


def portal_jib():
    """The turning part of the portal crane, origin on the slewing axis at the portal top:
    slewing ring, machinery deck, wooden cabin, water-tank counterweight, A-frame, lattice jib,
    ties, hoist rope and hook."""
    m = Mesh(ao=0.0)
    m.lathe([(1.35, 0.15), (1.35, 0.32)], 12, IRON, smooth=False, cap1=True, urep=3)
    m.box((0, 0.55, 0.47), (3.2, 4.3, 0.3), IRON)
    cy0, cy1, cz0, cz1 = -1.4, 1.4, 0.62, 3.0
    house(m, -1.3, 1.3, cy0, cy1, cz0, cz1, wall=WOOD, roof=IRON, over=0.14, roof_rise=0.5,
          windows=[("-y", -0.5, 2.1), ("-y", 0.5, 2.1), ("+x", -0.6, 2.1), ("+x", 0.5, 2.1), ("-x", -0.6, 2.1),
                   ("-x", 0.5, 2.1)], door=("+y", 0.4, 0.75, 1.9))
    chimney(m, -0.7, 0.8, cz1 + 0.35, 0.6, 0.07)
    with m.at(move(0, 2.3, 0.62)):
        m.lathe([(0.85, 0.0), (0.85, 1.9), (0.72, 2.02)], 10, IRON, smooth=False, cap1=True, urep=3)
    apex = V(0, 1.0, 5.6)
    for sx in (1, -1):
        m.beam((sx * 1.05, 1.5, cz1 - 0.2), apex, 0.18, 0.18, IRON, side=(1, 0, 0))
    m.beam((0, 2.3, 2.6), apex, 0.16, 0.16, IRON)
    foot = V(0, -1.65, 0.7)
    d = V(0, -math.cos(JIB_ANGLE), math.sin(JIB_ANGLE))
    n = V(0, math.sin(JIB_ANGLE), math.cos(JIB_ANGLE))
    tip = foot + d * JIB_LEN

    def w(s):
        return 0.45 - 0.27 * s

    def h(s):
        return 0.5 + 0.5 * math.sin(math.pi * s) - 0.2 * s

    ss = [0.0, 0.2, 0.45, 0.72, 1.0]
    for sx in (1, -1):
        lo = [foot + d * JIB_LEN * s + V(sx * w(s), 0, 0) - n * h(s) / 2 for s in ss]
        hi = [foot + d * JIB_LEN * s + V(sx * w(s), 0, 0) + n * h(s) / 2 for s in ss]
        acc = 0.0
        for i in range(len(ss) - 1):
            ln = (lo[i + 1] - lo[i]).length
            m.poly([lo[i], lo[i + 1], hi[i + 1], hi[i]], LATTICE,
                   uvs=[(acc / 1.4, 0), ((acc + ln) / 1.4, 0), ((acc + ln) / 1.4, 1), (acc / 1.4, 1)])
            acc += ln
            m.beam(lo[i], lo[i + 1], 0.09, 0.09, IRON, side=(1, 0, 0))
            m.beam(hi[i], hi[i + 1], 0.09, 0.09, IRON, side=(1, 0, 0))
    for s in ss:
        c = foot + d * JIB_LEN * s
        for k in (-1, 1):
            m.beam(c + n * k * h(s) / 2 - V(w(s), 0, 0), c + n * k * h(s) / 2 + V(w(s), 0, 0), 0.07, 0.07, IRON,
                   side=(0, 1, 0))
    for sx in (1, -1):
        m.box(foot + V(sx * 0.5, 0.1, -0.1), (0.14, 0.5, 0.5), IRON)
    head = tip + n * 0.1
    with m.at(move(*head) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.3, -0.06), (0.3, 0.06)], 8, IRON, smooth=False, cap0=True, cap1=True)
    for sx in (1, -1):
        rig(m, apex + V(sx * 0.1, 0, 0), tip + n * 0.3 + V(sx * 0.2, 0, 0), 0.045, IRON)
    rig(m, apex, (0, 2.3, 2.6), 0.03, IRON)
    rig(m, (0, -0.9, 1.5), foot + d * JIB_LEN * 0.98 + n * 0.1, 0.025, IRON)
    hang = tip + V(0, -0.28, -0.1)
    HOOK_Z = -3.4
    for dx in (-0.08, 0.08):
        rig(m, hang + V(dx, 0, 0), V(hang.x + dx, hang.y, HOOK_Z + 0.55), 0.022, IRON)
    m.box((0, hang.y, HOOK_Z + 0.35), (0.26, 0.34, 0.48), IRON)
    hook = [V(0, hang.y, HOOK_Z + 0.1), V(0, hang.y, HOOK_Z - 0.25), V(0, hang.y + 0.12, HOOK_Z - 0.4),
            V(0, hang.y + 0.24, HOOK_Z - 0.28), V(0, hang.y + 0.24, HOOK_Z - 0.12)]
    m.tube(hook, [0.05, 0.05, 0.045, 0.04, 0.03], 4, IRON, side=(1, 0, 0), smooth=False, cap0=True, cap1=True)
    # a sling of rope under the hook
    rope_path(m, [V(-0.3, hang.y + 0.12, HOOK_Z - 1.0), V(0, hang.y + 0.12, HOOK_Z - 0.38),
                  V(0.3, hang.y + 0.12, HOOK_Z - 1.0)], 0.03, ROPE)
    # hand rail round the machinery deck (back half)
    for sx in (1, -1):
        rig(m, (sx * 1.55, 1.4, 1.55), (sx * 1.55, 2.65, 1.55), 0.025, IRON)
        for y in (1.4, 2.65):
            rig(m, (sx * 1.55, y, 0.62), (sx * 1.55, y, 1.55), 0.025, IRON)
    rig(m, (-1.55, 2.65, 1.55), (1.55, 2.65, 1.55), 0.025, IRON)
    return m


HAND_PIVOT = 0.55


def hand_crane():
    """The fixed part of an older cast-iron hand crane: a stone block and the iron post."""
    m = Mesh(ao=0.0)
    m.box((0, 0, 0.275), (1.8, 1.8, 0.55), STONE, tile=1.0)
    m.lathe([(0.42, 0.55), (0.42, 0.62), (0.3, 0.7), (0.24, 1.3), (0.27, 1.35)], 10, IRON, smooth=False, cap1=True, urep=2)
    for a in range(4):
        c = V(0.62 * math.cos(math.pi / 4 + a * math.pi / 2), 0.62 * math.sin(math.pi / 4 + a * math.pi / 2), 0.59)
        m.box(c, (0.1, 0.1, 0.08), IRON)
    return m


def hand_jib():
    """The turning part of the hand crane (origin on the post axis, 0.55 m up): side cheeks,
    winch drum, spur gear, cranks, counterweight, a swan-neck jib of two curved iron ribs."""
    m = Mesh(ao=0.0)
    m.lathe([(0.5, 0.75), (0.5, 0.86)], 10, IRON, smooth=False, cap0=True, cap1=True, urep=2)
    for sx in (1, -1):
        m.slab([(sx * 0.36, 0.95, 0.3), (sx * 0.36, -0.55, 0.3), (sx * 0.36, -0.25, 1.95), (sx * 0.36, 0.5, 1.95)], 0.04,
               IRON, out=(sx, 0, 0))
    for y, z in ((0.45, 1.9), (-0.4, 0.4), (0.85, 0.4), (-0.25, 1.9)):
        m.beam((-0.34, y, z), (0.34, y, z), 0.06, 0.06, IRON, side=(0, 1, 0))
    m.box((0, 0.2, 0.36), (0.72, 1.4, 0.1), IRON)
    with m.at(move(0, 0.15, 1.3) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.2, -0.32), (0.2, 0.32)], 10, DARK, smooth=False, cap0=True, cap1=True, cap_mat=IRON)
    teeth = [(0.42, 0.15 + (0.48 if i % 2 == 0 else 0.43) * math.cos(math.pi * i / 12),
              1.3 + (0.48 if i % 2 == 0 else 0.43) * math.sin(math.pi * i / 12)) for i in range(24)]
    m.prism([V(*p) for p in teeth], (0.05, 0, 0), IRON)
    with m.at(move(0, 0.65, 0.95) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.03, -0.55), (0.03, 0.55)], 5, IRON, smooth=False, cap0=True, cap1=True)
        m.lathe([(0.11, 0.42), (0.11, 0.48)], 8, IRON, smooth=False, cap0=True, cap1=True)
    for sx in (1, -1):
        m.beam((sx * 0.54, 0.65, 0.95), (sx * 0.54, 0.65, 0.55), 0.05, 0.03, IRON, side=(0, 1, 0))
        m.beam((sx * 0.54, 0.65, 0.57), (sx * 0.8, 0.65, 0.57), 0.045, 0.045, DARK, side=(0, 1, 0))
    m.box((0, 1.15, 0.75), (0.8, 0.45, 0.9), IRON)
    P0, P1, P2 = V(0, -0.35, 0.45), V(0, -0.5, 4.3), V(0, -3.8, 5.25)
    path = []
    for k in range(9):
        t = k / 8
        path.append((1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2)
    for sx in (1, -1):
        radii = [(0.035, 0.24 - 0.12 * k / 8) for k in range(9)]
        m.tube([p + V(sx * 0.17, 0, 0) for p in path], radii, 4, IRON, side=(1, 0, 0), smooth=False, cap0=True, cap1=True,
               urep=1, vscale=0.5)
    for k in (1, 3, 5, 7):
        m.beam(path[k] - V(0.2, 0, 0), path[k] + V(0.2, 0, 0), 0.06, 0.06, IRON, side=(0, 1, 0))
    m.beam((0, 0.45, 1.9), path[3], 0.08, 0.08, IRON)
    head = P2 + V(0, -0.12, 0.05)
    with m.at(move(*head) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.22, -0.05), (0.22, 0.05)], 8, IRON, smooth=False, cap0=True, cap1=True)
    rig(m, (0, 0.0, 1.45), path[4] + V(0, 0.1, 0), 0.02, IRON)
    hang = head + V(0, -0.2, -0.05)
    hz = 1.2
    rig(m, hang, V(0, hang.y, hz + 0.4), 0.022, IRON)
    m.box((0, hang.y, hz + 0.25), (0.14, 0.2, 0.3), IRON)
    hook = [V(0, hang.y, hz + 0.1), V(0, hang.y, hz - 0.15), V(0, hang.y + 0.1, hz - 0.27), V(0, hang.y + 0.19, hz - 0.15)]
    m.tube(hook, [0.04, 0.04, 0.035, 0.03], 4, IRON, side=(1, 0, 0), smooth=False, cap0=True, cap1=True)
    return m


# ------------------------------------------------------------------ build


BUILDERS = [
    ("barque", barque),
    ("steamer", steamer),
    ("rhine_barge", lambda: barge("rhine")),
    ("hengst", lambda: barge("hengst")),
    ("lighter", lambda: lighter(False)),
    ("lighter_loaded", lambda: lighter(True)),
    ("tug", lambda: tug(False)),
    ("paddle_tug", lambda: tug(True)),
    ("sloop", sloop),
    ("rowboat", rowboat),
    ("punt", punt),
    ("pontoon_section", pontoon_section),
    ("portal_crane", portal_crane),
    ("hand_crane", hand_crane),
]
CHILDREN = {"portal_crane": ("jib", portal_jib, (0, 0, PORTAL_TOP)), "hand_crane": ("hand_crane_jib", hand_jib, (0, 0, HAND_PIVOT))}


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def build_all():
    objs, counts = {}, {}
    for name, fn in BUILDERS:
        ob = to_object(fn(), name)
        objs[name] = ob
        counts[name] = tris(ob)
        if name in CHILDREN:
            cname, cfn, loc = CHILDREN[name]
            ch = to_object(cfn(), cname, parent=ob, loc=loc)
            objs[cname] = ch
            counts[name] += tris(ch)
    p = objs["pontoon_section"]
    p["deck_top"] = PONTOON_DECK
    p["half_width"] = PONTOON_HALF
    p["length"] = PONTOON_LEN
    return objs, counts


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


# ------------------------------------------------------------------ preview


def stage(water=True):
    sc = bpy.context.scene
    for o in list(sc.collection.objects):
        if o.name.split(".")[0] in ("water", "sun", "cam", "quay"):
            bpy.data.objects.remove(o)
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("fog")
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.42, 0.45, 0.47, 1)
        bg.inputs[1].default_value = 0.8
    except AttributeError:
        world.color = (0.42, 0.45, 0.47)
    sc.world = world
    if water:
        me = bpy.data.meshes.new("water")
        bm = bmesh.new()
        for p in [(-400, -400, 0), (400, -400, 0), (400, 400, 0), (-400, 400, 0)]:
            bm.verts.new(p)
        bm.faces.new(bm.verts)
        bm.to_mesh(me)
        wm = bpy.data.materials.new("water_prev")
        b = wm.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (0.12, 0.14, 0.12, 1)
        b.inputs["Roughness"].default_value = 0.35
        me.materials.append(wm)
        w = bpy.data.objects.new("water", me)
        sc.collection.objects.link(w)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(52), math.radians(8), math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_end = 2000
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def quay(x0, x1, y0, y1, top=1.8):
    me = bpy.data.meshes.new("quay")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    q = bpy.data.objects.new("quay", me)
    q.scale = (x1 - x0, y1 - y0, top + 3)
    q.location = ((x0 + x1) / 2, (y0 + y1) / 2, (top - 3) / 2)
    qm = bpy.data.materials.new("quay_prev")
    qm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.3, 0.29, 0.27, 1)
    me.materials.append(qm)
    bpy.context.scene.collection.objects.link(q)
    return q


def preview_materials():
    bp.preview_materials()
    for mt in bpy.data.materials:
        if mt.name in THIN:
            mt.use_backface_culling = False


def aim(cam, loc, target, lens=35):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def render(path, res):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[build_boats] preview -> {path}")


def dup(ob, loc, rz):
    """A linked copy of an object and its children, for the harbour scene."""
    c = ob.copy()
    bpy.context.scene.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (0, 0, rz)
    c.hide_render = False
    for ch in ob.children:
        cc = ch.copy()
        bpy.context.scene.collection.objects.link(cc)
        cc.parent = c
        cc.hide_render = False
    return c


def preview_lineup(objs):
    """All objects side by side, broadside to the camera, bows to the left."""
    cam = stage()
    for o in objs.values():
        o.hide_render = False
    rows = [(0.0, ["barque", "steamer"]), (-45.0, ["rhine_barge", "hengst", "tug", "paddle_tug"]),
            (-80.0, ["lighter", "lighter_loaded", "sloop", "rowboat", "punt", "pontoon_section", "portal_crane", "hand_crane"])]
    for y, names in rows:
        x = 0.0
        for n in names:
            o = objs[n]
            rz = math.pi / 2 if n not in ("portal_crane", "hand_crane") else math.radians(-60)
            o.rotation_euler = (0, 0, rz)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            for ch in o.children:
                pts += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            o.location = (x - lo, y, 0)
            x += hi - lo + 4.0
        for n in names:
            objs[n].location.x -= x / 2
    bpy.context.view_layer.update()
    aim(cam, (0, -175, 62), (0, -35, 6), lens=30)
    render(os.path.join(SHOTS, "boats_preview.png"), (1920, 1080))


def preview_harbour(objs):
    """A stretch of quay (top 1.8 m above the water) with ships moored along it, cranes on it,
    a pontoon walkway going out with barges alongside, small boats about."""
    cam = stage()
    for o in objs.values():
        o.hide_render = True
    quay(-120, 120, 0, 40)
    R = math.pi / 2
    pl = [("steamer", (-55, -4.6, 0), -R), ("barque", (18, -5.0, 0), R), ("barque", (18, -15.0, 0), R),
          ("rhine_barge", (-62, -14.0, 0), R), ("lighter_loaded", (-40, -13.0, 0), -R), ("tug", (-20, -12.0, 0), R + 0.3),
          ("hengst", (62, -3.0, 0), -R), ("lighter", (62, -8.8, 0), -R), ("sloop", (84, -2.4, 0), R),
          ("rowboat", (46, -2.0, 0), R + 0.2), ("punt", (40, -1.4, 0), R - 0.1), ("paddle_tug", (-5, -30, 0), R - 0.4),
          ("portal_crane", (-50, 6.0, 1.8), 0.4), ("portal_crane", (10, 6.0, 1.8), -0.2), ("hand_crane", (36, 2.2, 1.8), 0.6)]
    for n, loc, rz in pl:
        dup(objs[n], loc, rz)
    for i in range(3):
        dup(objs["pontoon_section"], (-8, -5 - 10 * i, 0), 0)
    dup(objs["rhine_barge"], (-8 - 2.35 - 0.3 - 3.1, -19, 0), 0.0)
    dup(objs["lighter"], (-8 + 2.35 + 0.3 + 2.2, -16, 0), math.pi)
    bpy.context.view_layer.update()
    aim(cam, (-10, -95, 22), (0, -5, 5), lens=26)
    render(os.path.join(SHOTS, "boats_harbour.png"), (1920, 1080))


def closeup(objs, names, path, az=-35.0, el=0.35):
    cam = stage()
    sel = [objs[n] for n in names]
    for o in objs.values():
        o.hide_render = o not in sel and (o.parent not in sel)
    x = 0.0
    for o in sel:
        o.location = (x, 0, 0)
        bpy.context.view_layer.update()
        x += max(o.dimensions) * 0.6 + 4
    bpy.context.view_layer.update()
    pts = []
    for o in sel:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
        for ch in o.children:
            pts += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    a = math.radians(az)
    d = r * 2.1
    aim(cam, (c.x + d * math.sin(a), c.y - d * math.cos(a), c.z + d * el), c, lens=35)
    render(path, (1600, 1000))


# ------------------------------------------------------------------ main


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    objs, counts = build_all()
    export()
    for n, c in counts.items():
        print(f"[build_boats] {n:16s} {c:5d} tris")
    print(f"[build_boats] {len(counts)} objects, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv or "--closeup" in argv or "--harbour" in argv:
        preview_materials()
    if "--preview" in argv:
        preview_lineup(objs)
    if "--harbour" in argv or "--preview" in argv:
        preview_harbour(objs)
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = argv[i + 1].split(",")
        az = float(argv[i + 3]) if len(argv) > i + 3 else -35.0
        el = float(argv[i + 4]) if len(argv) > i + 4 else 0.35
        closeup(objs, names, os.path.abspath(os.path.join(ROOT, argv[i + 2])), az, el)


if __name__ == "__main__":
    main()
