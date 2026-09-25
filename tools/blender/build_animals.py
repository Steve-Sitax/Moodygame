"""Build the dogs and cats of Scheldemist in Blender and export them for the game.

    blender -b --factory-startup -P tools/blender/build_animals.py [-- --preview] [--out PATH]

Writes client/public/models/animals.glb: one rigged, textured, animated animal
per variant. Dogs (street mongrels): dog_brown, dog_black, dog_spotted, dog_grey
(a lean lurcher, the same skeleton at 1.1 scale with a thinner body). Cats:
cat_tabby, cat_black, cat_ginger, cat_white. PS1-era animals: lofted rings,
350 to 600 triangles for a dog, 200 to 400 for a cat, one 128x128 texture per
animal painted here in code (our own work, nothing downloaded).

Each species has one skeleton layout and one set of bone names (the same names
for dogs and cats; the clips are per species). Every bone points straight along
an axis with roll 0 (body, head, feet forward; legs down; tail back; neck and
ears up), so the rest rotations match across variants and one set of clips
drives them all. The clips are keyed on the first animal of each species
(dog_brown, cat_tabby) and hold rotations only; the game strips the "_1", "_2"
suffixes that the glTF loader adds to repeated bone names (see humans.ts).

The legs are placed by planar IK in the clips: walk and run feet stay planted
on the ground while in stance (no sliding at the stride below), and sit and lie
put paws, rump and belly on the ground once the game lowers the root by the
clip's drop (DROP below; printed by the build).

Coordinates: we build in game space (x = the animal's left, y up, z forward,
the animal faces +z). B() turns that into Blender space (Z up); the glTF
export turns it back to Y up.

--preview also renders data/shots/animals_preview.png (all eight, idle) and
animals_poses.png (a dog and a cat in every clip).
--out writes the .glb somewhere else (for trials; the game reads the default).
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "animals.glb")
if "--out" in sys.argv:
    OUT = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])
SHOTS = os.path.join(ROOT, "data", "shots")
PREVIEW = "--preview" in sys.argv

TEX = 128
# Texture atlas cells (x, y, w, h) in pixels, y from the bottom.
CELLS = {
    "body": (0, 64, 128, 64),
    "head": (0, 32, 64, 32),
    "neck": (64, 32, 32, 32),
    "tail": (96, 32, 32, 32),
    "legF": (0, 0, 32, 32),
    "legH": (32, 0, 32, 32),
    "ear": (64, 0, 32, 32),
    "spare": (96, 0, 32, 32),
}

FPS = 24


def B(x, y, z):
    return Vector((x, -z, y))


def rgb(h):
    return np.array([(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255])


# ---------------------------------------------------------------- skeletons

# Bone: (parent, axis the bone points along in game space, length)
UP, DOWN, FWD, BACK = (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)


def bone_table(tail_bones):
    t = {"hips": (None, FWD), "spine": ("hips", FWD), "chest": ("spine", FWD),
         "neck": ("chest", UP), "head": ("neck", FWD), "earL": ("head", UP), "earR": ("head", UP)}
    par = "hips"
    for tb in tail_bones:
        t[tb] = (par, BACK)
        par = tb
    for S in "LR":
        t["frontUp" + S] = ("chest", DOWN)
        t["frontLow" + S] = ("frontUp" + S, DOWN)
        t["frontFoot" + S] = ("frontLow" + S, DOWN)
        t["hindUp" + S] = ("hips", DOWN)
        t["hindLow" + S] = ("hindUp" + S, DOWN)
        t["hindFoot" + S] = ("hindLow" + S, DOWN)
    return t


def along(p, d, dist):
    return tuple(p[i] + d[i] * dist for i in range(3))


def unit(*v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def mirror(j):
    out = dict(j)
    for n, p in j.items():
        if n.endswith("L"):
            out[n[:-1] + "R"] = (-p[0], p[1], p[2])
    return out


# Dog: shoulder (withers) about 0.5 m, rump to nose about 0.85 m.
DOG_TAIL_DIR = unit(0, -0.72, -0.69)  # hanging back and down
DOG_J = mirror({
    "hips": (0, 0.40, -0.22),
    "spine": (0, 0.405, -0.04),
    "chest": (0, 0.415, 0.12),
    "neck": (0, 0.45, 0.225),
    "head": (0, 0.53, 0.31),
    "earL": (0.048, 0.605, 0.305),
    "tail1": (0, 0.44, -0.345),
    "tail2": along((0, 0.44, -0.345), DOG_TAIL_DIR, 0.13),
    "frontUpL": (0.075, 0.43, 0.14),
    "frontLowL": (0.075, 0.23, 0.07),
    "frontFootL": (0.075, 0.075, 0.14),
    "hindUpL": (0.075, 0.37, -0.27),
    "hindLowL": (0.075, 0.23, -0.20),
    "hindFootL": (0.075, 0.11, -0.30),
})
DOG_TOE = {"front": (0.165, 0.0), "hind": (-0.27, 0.0)}  # (z, y) ground contact of the paw

# Cat: shoulder about 0.24 m, body 0.36 m, tail 0.27 m.
CAT_TAIL_DIR = unit(0, -0.6, -0.8)
CAT_J = mirror({
    "hips": (0, 0.20, -0.11),
    "spine": (0, 0.20, -0.02),
    "chest": (0, 0.205, 0.06),
    "neck": (0, 0.215, 0.11),
    "head": (0, 0.265, 0.15),
    "earL": (0.024, 0.305, 0.152),
    "tail1": (0, 0.215, -0.175),
    "tail2": along((0, 0.215, -0.175), CAT_TAIL_DIR, 0.09),
    "tail3": along((0, 0.215, -0.175), CAT_TAIL_DIR, 0.18),
    "frontUpL": (0.038, 0.215, 0.07),
    "frontLowL": (0.038, 0.115, 0.035),
    "frontFootL": (0.038, 0.035, 0.065),
    "hindUpL": (0.04, 0.19, -0.13),
    "hindLowL": (0.04, 0.12, -0.085),
    "hindFootL": (0.04, 0.055, -0.14),
})
CAT_TOE = {"front": (0.075, 0.0), "hind": (-0.125, 0.0)}

SPECIES = {
    "dog": dict(J=DOG_J, toe=DOG_TOE, tail=["tail1", "tail2"], tail_dir=DOG_TAIL_DIR, tail_len=0.27),
    "cat": dict(J=CAT_J, toe=CAT_TOE, tail=["tail1", "tail2", "tail3"], tail_dir=CAT_TAIL_DIR, tail_len=0.27),
}
for _sp in SPECIES.values():
    _sp["bones"] = bone_table(_sp["tail"])


# ---------------------------------------------------------------- variants

VARIANTS = [
    # a farm mongrel (2026-09-24: it read as an otter): a white chest and toes, a shorter
    # muzzle and a lighter tan over the plain brown (with all dogs: a bigger head, broad drop
    # ears, a fuller tail carried up, a shorter rump)
    dict(name="dog_brown", sp="dog", k=1.0, girth=1.0, legw=1.0, snout=0.88, ears="flop",
         base=0x8a5c34, back=0x4e321c, belly=0xc8a476, muzzle=0x3a2818, ear_col=0x3e2818,
         blaze=0xdcd2bc, eye=0x24160c, nose=0x141010),
    dict(name="dog_black", sp="dog", k=1.0, girth=0.97, legw=1.0, snout=0.95, ears="prick",
         base=0x201e1c, back=0x141312, belly=0x34302c, muzzle=0x4a4640, blaze=0xb4ac9e,
         eye=0x5a3a18, nose=0x0c0c0c),
    dict(name="dog_spotted", sp="dog", k=1.0, girth=0.98, legw=1.0, snout=1.0, ears="flop",
         base=0xd4ccba, back=0xc8bea8, belly=0xe2dccc, patch=0x6a4226, ear_col=0x6a4226, eye_patch=True,
         eye=0x24160c, nose=0x1a1412, tail_tip=0xe8e2d4),
    dict(name="dog_grey", sp="dog", k=1.1, girth=0.8, legw=0.85, snout=1.25, ears="rose",
         base=0x7e7e7a, back=0x5a5a58, belly=0xaaa8a0, muzzle=0x6a6a66, eye=0x2a1e14, nose=0x121212),
    dict(name="cat_tabby", sp="cat", k=1.0, girth=1.0, legw=1.0, snout=1.0, ears="cat",
         base=0x7c6e5a, back=0x5e5242, belly=0xb4a68e, stripes=0x2e261c, eye=0x9aa232, nose=0xa46a60,
         ear_in=0xb48478),
    dict(name="cat_black", sp="cat", k=1.0, girth=1.0, legw=1.0, snout=1.0, ears="cat",
         base=0x1c1c1c, back=0x141414, belly=0x262626, eye=0xc8b42a, nose=0x2a2020, ear_in=0x4a3434),
    dict(name="cat_ginger", sp="cat", k=1.0, girth=1.0, legw=1.0, snout=1.0, ears="cat",
         base=0xc4722e, back=0xa4581e, belly=0xe8c89a, stripes=0x8a4416, stripe_amt=0.55, eye=0xb0a030,
         nose=0xc07a70, ear_in=0xd09a88),
    dict(name="cat_white", sp="cat", k=1.0, girth=1.0, legw=1.0, snout=1.0, ears="cat",
         base=0xe2e0d8, back=0xd8d6ce, belly=0xecebe4, patch=0x626262, grey_tail=True, eye=0x7a9a3a,
         nose=0xd08a88, ear_in=0xe0a8a4),
]


# ---------------------------------------------------------------- mesh builder

class Body:
    """One animal mesh: lofted parts; each ring is bound to one bone or blended between two."""

    def __init__(self, k):
        self.k = k
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.dl = self.bm.verts.layers.deform.verify()
        self.groups = []

    def gi(self, bone):
        if bone not in self.groups:
            self.groups.append(bone)
        return self.groups.index(bone)

    def vert(self, p, w):
        v = self.bm.verts.new(B(p[0] * self.k, p[1] * self.k, p[2] * self.k))
        if isinstance(w, str):
            w = {w: 1.0}
        for bn, wt in w.items():
            if wt > 1e-4:
                v[self.dl][self.gi(bn)] = wt
        return v

    def face(self, verts, uvs):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        return f

    @staticmethod
    def cuv(cell, u, v):
        x0, y0, w, h = CELLS[cell]
        return ((x0 + 0.5 + u * (w - 1)) / TEX, (y0 + 0.5 + v * (h - 1)) / TEX)

    def loft(self, rings, cell, n, side=(1, 0, 0), fwd=(0, 1, 0), cap0=None, cap1=None, phase=0.0):
        """Rings: dicts with c (centre), ra (side radius), rb (radius towards fwd),
        rbb (radius away from fwd, default rb), w (bone or {bone: weight}).
        theta = 0 points along fwd (for a body: the back), +90 deg along side.
        u runs with theta from -180 to +180; v runs along the rings.
        cap0/cap1: None (open) or an offset (x, y, z) for the fan centre."""
        A = Vector(side)
        F = Vector(fwd)
        thetas = [(-math.pi + 2 * math.pi * i / n + phase) for i in range(n)]
        us = [i / n for i in range(n + 1)]
        vs_ = ring_vs(rings)
        grid = []
        for r in rings:
            c = Vector(r["c"])
            row = []
            for t in thetas:
                s, co = math.sin(t), math.cos(t)
                rb = r["rb"] if co >= 0 else r.get("rbb", r["rb"])
                pt = c + A * (r["ra"] * s) + F * (rb * co)
                row.append(self.vert(pt, r["w"]))
            grid.append(row)
        c0 = Vector(rings[0]["c"])
        D = (Vector(rings[-1]["c"]) - c0).normalized()
        flip = A.cross(D).dot(F) < 0
        for ri in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % n
                q = [grid[ri][i], grid[ri][j], grid[ri + 1][j], grid[ri + 1][i]]
                uv = [self.cuv(cell, us[i], vs_[ri]), self.cuv(cell, us[i + 1], vs_[ri]),
                      self.cuv(cell, us[i + 1], vs_[ri + 1]), self.cuv(cell, us[i], vs_[ri + 1])]
                if flip:
                    q.reverse()
                    uv.reverse()
                self.face(q, uv)
        centre = sum((Vector(r["c"]) for r in rings), Vector()) / len(rings)
        for cap, ri, vv in ((cap0, 0, 0.0), (cap1, len(rings) - 1, 1.0)):
            if cap is None:
                continue
            cc = Vector(rings[ri]["c"]) + Vector(cap)
            mid = self.vert(cc, rings[ri]["w"])
            out = B(*(cc - centre))
            for i in range(n):
                j = (i + 1) % n
                tri = [mid, grid[ri][i], grid[ri][j]]
                uv = [self.cuv(cell, (us[i] + us[i + 1]) / 2, vv), self.cuv(cell, us[i], vv),
                      self.cuv(cell, us[i + 1], vv)]
                f = self.face(tri, uv)
                if f is None:
                    continue
                f.normal_update()
                if f.normal.dot(out) < 0:
                    f.normal_flip()

    def pyramid(self, base, tip, bone, cell):
        """An ear: base triangle (front-left, front-right, back) and a tip; 3 faces.
        The front face takes the inner half of the cell, the others the outer."""
        fl, fr, bk = (self.vert(p, bone) for p in base)
        t = self.vert(tip, bone)
        inner = [self.cuv(cell, 0.6, 0.0), self.cuv(cell, 0.95, 0.0), self.cuv(cell, 0.78, 1.0)]
        outer = [self.cuv(cell, 0.05, 0.0), self.cuv(cell, 0.4, 0.0), self.cuv(cell, 0.22, 1.0)]
        for tri, uv in (([fl, fr, t], inner), ([bk, fl, t], outer), ([fr, bk, t], outer)):
            f = self.face(tri, uv)
            if f is None:
                continue
            f.normal_update()
            cen = (fl.co + fr.co + bk.co) / 3
            fc = sum((v.co for v in tri), Vector()) / 3
            if f.normal.dot(fc - cen) < 0:
                f.normal_flip()


def ring_vs(rings):
    c0 = Vector(rings[0]["c"])
    axis = Vector(rings[-1]["c"]) - c0
    L = axis.length or 1.0
    D = axis / L
    return [max(0.0, min(1.0, (Vector(r["c"]) - c0).dot(D) / L)) for r in rings]


def ring(x, y, z, ra, rb, rbb=None, w="hips"):
    r = dict(c=(x, y, z), ra=ra, rb=rb, w=w)
    if rbb is not None:
        r["rbb"] = rbb
    return r


def blend(a, b, f):
    f = max(0.0, min(1.0, f))
    if f <= 0.0:
        return {a: 1.0}
    if f >= 1.0:
        return {b: 1.0}
    return {a: 1 - f, b: f}


def trunk_w(J, z):
    zh, zs, zc = J["hips"][2], J["spine"][2], J["chest"][2]
    if z <= zs:
        return blend("hips", "spine", (z - zh) / (zs - zh))
    return blend("spine", "chest", (z - zs) / (zc - zs))


def trunk_rings(v):
    """The body tube, rump to chest, with fwd = up (theta 0 is the back)."""
    sp = v["sp"]
    J = SPECIES[sp]["J"]
    g = v["girth"]
    if sp == "dog":
        rows = [  # z, y, ra, rb (back), rbb (belly)
            (-0.35, 0.412, 0.04, 0.035, 0.04),
            (-0.325, 0.41, 0.088, 0.064, 0.092),
            (-0.24, 0.40, 0.098, 0.075, 0.10),
            (-0.09, 0.39, 0.092, 0.08, 0.085),
            (0.05, 0.395, 0.112, 0.095, 0.155),
            (0.17, 0.405, 0.112, 0.098, 0.175),
            (0.265, 0.42, 0.078, 0.075, 0.12),
        ]
        cap = (0, 0, 0.03)
    else:
        rows = [
            (-0.19, 0.205, 0.018, 0.016, 0.02),
            (-0.165, 0.205, 0.046, 0.032, 0.05),
            (-0.09, 0.198, 0.052, 0.036, 0.056),
            (0.0, 0.198, 0.05, 0.037, 0.054),
            (0.07, 0.205, 0.05, 0.040, 0.066),
            (0.118, 0.21, 0.038, 0.035, 0.052),
        ]
        cap = (0, 0, 0.014)
    rs = []
    for z, y, ra, rb, rbb in rows:
        rs.append(ring(0, y + (1 - g) * rbb * 0.5, z, ra * g, rb, rbb * g, w=trunk_w(J, z)))
    return rs, cap


def neck_rings(v):
    sp = v["sp"]
    g = v["girth"]
    if sp == "dog":
        return [ring(0, 0.425, 0.195, 0.08 * g, 0.08, 0.095 * g, w=blend("chest", "neck", 0.5)),
                ring(0, 0.49, 0.26, 0.066 * g, 0.065, 0.07 * g, w="neck"),
                ring(0, 0.545, 0.305, 0.058 * g, 0.058, 0.058 * g, w=blend("neck", "head", 0.7))], unit(0, 0.67, -0.74)
    return [ring(0, 0.212, 0.1, 0.034 * g, 0.036, 0.04 * g, w=blend("chest", "neck", 0.5)),
            ring(0, 0.268, 0.148, 0.03 * g, 0.03, 0.032 * g, w=blend("neck", "head", 0.6))], unit(0, 0.62, -0.78)


def head_rings(v):
    sp = v["sp"]
    s = v["snout"]
    if sp == "dog":
        stop = 0.385
        rows = [  # z, y, ra, rb (top), rbb (under)
            (0.27, 0.555, 0.045, 0.04, 0.045),
            (0.305, 0.565, 0.075, 0.062, 0.062),
            (0.35, 0.56, 0.072, 0.056, 0.06),
            (0.385, 0.545, 0.05, 0.038, 0.05),
            (0.44, 0.53, 0.045, 0.032, 0.046),
            (0.475, 0.527, 0.036, 0.027, 0.036),
        ]
        cap = (0, 0.002, 0.012)
    else:
        stop = 0.19
        rows = [
            (0.128, 0.285, 0.03, 0.026, 0.028),
            (0.15, 0.29, 0.044, 0.038, 0.035),
            (0.182, 0.284, 0.039, 0.031, 0.031),
            (0.203, 0.272, 0.022, 0.016, 0.02),
        ]
        cap = (0, 0.0, 0.008)
    rs = []
    # dogs: a broader, higher skull than the muzzle (a dog's head reads by its stop)
    skull = 1.12 if sp == "dog" else 1.0
    for z, y, ra, rb, rbb in rows:
        big = skull if z <= stop else 1.0
        if z > stop:
            z = stop + (z - stop) * s
        rs.append(ring(0, y, z, ra * big * (0.94 if s > 1.1 else 1.0), rb * big, rbb, w="head"))
    return rs, (cap[0], cap[1], cap[2] * s)


def tail_rings(v):
    spd = SPECIES[v["sp"]]
    J = spd["J"]
    d = spd["tail_dir"]
    L = spd["tail_len"]
    t0 = J["tail1"]
    names = spd["tail"]
    seg = [J[n] for n in names]
    if v["sp"] == "dog":
        # a brush, not a thin whip
        pts = [(0.0, 0.04, "tail1"), (0.065, 0.04, "tail1"), (0.13, 0.036, blend("tail1", "tail2", 0.5)),
               (0.21, 0.028, "tail2"), (L, 0.012, "tail2")]
    else:
        pts = [(0.0, 0.017, "tail1"), (0.09, 0.0155, blend("tail1", "tail2", 0.5)),
               (0.18, 0.0145, blend("tail2", "tail3", 0.5)), (0.235, 0.0135, "tail3"), (L, 0.009, "tail3")]
    del seg
    rs = []
    for dist, r, w in pts:
        p = along(t0, d, dist)
        rs.append(ring(*p, r, r * 1.05, r * 0.95, w=w))
    return rs, (d[0] * 0.012, d[1] * 0.012, d[2] * 0.012)


def leg_rings(v, which, S):
    spd = SPECIES[v["sp"]]
    J = spd["J"]
    lw = v["legw"]
    x = J[which + "UpL"][0] * (1 if S == "L" else -1)
    up, low, foot = (J[f"{which}{p}{S}"] for p in ("Up", "Low", "Foot"))
    tz, _ = spd["toe"][which]
    Bu, Bl, Bf = (f"{which}{p}{S}" for p in ("Up", "Low", "Foot"))
    dog = v["sp"] == "dog"
    # the top ring sits inside the body, part way down the upper bone
    top_y = (0.33 if which == "front" else 0.36) if dog else (0.17 if which == "front" else 0.185)
    f = (up[1] - top_y) / (up[1] - low[1])
    top = (x, top_y, up[2] + (low[2] - up[2]) * f)
    if dog:
        rad = {"front": [(0.048, 0.06), (0.036, 0.04), (0.026, 0.028), (0.028, 0.034, 0.024), (0.031, 0.046, 0.026)],
               "hind": [(0.055, 0.085), (0.042, 0.05), (0.025, 0.03), (0.028, 0.034, 0.024), (0.031, 0.046, 0.026)]}[which]
        ph, pb = 0.034, 0.004
    else:
        rad = {"front": [(0.025, 0.03), (0.02, 0.022), (0.015, 0.016), (0.016, 0.019, 0.014), (0.018, 0.026, 0.014)],
               "hind": [(0.03, 0.045), (0.022, 0.028), (0.014, 0.017), (0.015, 0.019, 0.014), (0.017, 0.026, 0.014)]}[which]
        ph, pb = 0.018, 0.003
    cen = [top, low, foot, (x, ph, tz - 0.004), (x, pb, tz + 0.002)]
    ws = [Bu, blend(Bu, Bl, 0.5), blend(Bl, Bf, 0.5), Bf, Bf]
    rs = []
    for c, r, w in zip(cen, rad, ws):
        ra, rb = r[0] * lw, r[1] * lw
        rbb = r[2] * lw if len(r) > 2 else None
        rs.append(ring(*c, ra, rb, rbb, w=w))
    return rs


def ear_parts(v, S):
    J = SPECIES[v["sp"]]["J"]
    sg = 1 if S == "L" else -1
    bx, by, bz = J["ear" + S]
    kind = v["ears"]
    if kind == "cat":
        wdt, dep = 0.016, 0.012
        tip = (bx + sg * 0.01, by + 0.034, bz - 0.004)
    elif kind == "flop":
        # broad drop ears that frame the head (thin ones vanished into it)
        wdt, dep = 0.05, 0.034
        tip = (bx + sg * 0.078, by - 0.085, bz + 0.024)
    else:
        wdt, dep = 0.036, 0.024
        tip = {"prick": (bx + sg * 0.018, by + 0.085, bz - 0.006),
               "semi": (bx + sg * 0.045, by + 0.05, bz + 0.04),
               "flop": (bx + sg * 0.072, by - 0.07, bz + 0.02),
               "rose": (bx + sg * 0.04, by + 0.012, bz - 0.06)}[kind]
    base = [(bx - sg * 0.004 + sg * wdt * 0.2, by - 0.004, bz + dep * 0.6),
            (bx + sg * wdt, by - 0.01, bz + dep * 0.2),
            (bx + sg * wdt * 0.4, by - 0.004, bz - dep)]
    if sg < 0:
        base = [base[1], base[0], base[2]]
    return base, tip


def build_body(v):
    b = Body(v["k"])
    sp = v["sp"]
    dog = sp == "dog"
    rs, cap = trunk_rings(v)
    b.loft(rs, "body", 8, fwd=(0, 1, 0), cap0=(0, 0, -0.02 if dog else -0.01), cap1=cap)
    nr, nf = neck_rings(v)
    b.loft(nr, "neck", 6, fwd=nf)
    hr, hc = head_rings(v)
    b.loft(hr, "head", 8 if dog else 6, fwd=(0, 1, 0), cap0=(0, 0, -0.012 if dog else -0.008), cap1=hc)
    tr, tc = tail_rings(v)
    d = SPECIES[sp]["tail_dir"]
    b.loft(tr, "tail", 4, fwd=unit(0, -d[2], d[1]) if d[1] < 0 else (0, 1, 0), cap1=tc, phase=math.pi / 4)
    for S in "LR":
        for which in ("front", "hind"):
            b.loft(leg_rings(v, which, S), "legF" if which == "front" else "legH", 5 if dog else 4,
                   fwd=(0, 0, 1), cap1=(0, -0.002, 0.004))
        base, tip = ear_parts(v, S)
        b.pyramid(base, tip, "ear" + S, "ear")
    return b


# ---------------------------------------------------------------- painting

class Painter:
    def __init__(self, v, seed):
        self.v = v
        self.rng = np.random.default_rng(seed)
        self.img = np.zeros((TEX, TEX, 3))

    def grain(self, h, w, amt=0.05):
        return 1 + self.rng.normal(0, amt, (h, w, 1))

    def streak(self, h, w, amt=0.08, run=3):
        """Fur: short streaks along v (the rows)."""
        lo = self.rng.normal(0, amt, (h // run + 2, w))
        up = np.repeat(lo, run, axis=0)[:h]
        return 1 + up[..., None]

    def blobs(self, h, w, cell=6, frac=0.4):
        lo = self.rng.random((h // cell + 3, w // cell + 3))
        up = np.kron(lo, np.ones((cell, cell)))[:h, :w]
        for _ in range(3):
            up = (up + np.roll(up, 1, 0) + np.roll(up, -1, 0) + np.roll(up, 1, 1) + np.roll(up, -1, 1)) / 5
        return up > np.quantile(up, 1 - frac)

    def cell(self, name, fn):
        x0, y0, w, h = CELLS[name]
        C, R = np.meshgrid(np.arange(w, dtype=float), np.arange(h, dtype=float))
        U = C / (w - 1)
        V = R / (h - 1)
        out = fn(U, V, C, R, w, h)
        self.img[y0:y0 + h, x0:x0 + w] = np.clip(out, 0, 1)


def paint(v, seed):
    P = Painter(v, seed)
    sp = v["sp"]
    dog = sp == "dog"
    base, back, belly = rgb(v["base"]), rgb(v["back"]), rgb(v["belly"])

    def fur(U, h, w, bk=1.0, bl=1.0):
        d = np.cos(2 * np.pi * (U - 0.5))
        tb = (np.clip(d, 0, 1) ** 1.3)[..., None] * bk
        tl = np.clip(-d, 0, 1)[..., None] * bl
        col = base * (1 - tb - tl) + back * tb + belly * tl
        return col * P.streak(h, w) * P.grain(h, w, 0.035)

    def put(out, mask, col, a=1.0):
        m = mask[..., None]
        col = np.asarray(col, dtype=float)
        if col.ndim == 1:
            col = col[None, None, :]
        return np.where(m, out * (1 - a) + col * a, out)

    def stripes(out, U, V, n, amt, wob=0.1, dors_only=True):
        if "stripes" not in v:
            return out
        d = np.cos(2 * np.pi * (U - 0.5))
        s = np.sin(2 * np.pi * (V * n + wob * np.sin(2 * np.pi * U * 3) + 0.05 * P.rng.normal(0, 1, U.shape)))
        m = s > 0.35
        k = np.clip(d + 0.55, 0, 1) if dors_only else np.ones_like(d)
        a = (v.get("stripe_amt", 0.8) * amt * k)[..., None]
        return np.where(m[..., None], out * (1 - a) + rgb(v["stripes"])[None, None, :] * a, out)

    def patches(out, h, w, frac, cell=6):
        if "patch" not in v:
            return out
        m = P.blobs(h, w, cell, frac)
        return put(out, m, rgb(v["patch"]) * P.grain(h, w, 0.03)[..., 0:1].mean(), 1.0)

    # ----- body: u around (the back at u = 0.5), v rump (0) to chest (1)
    def body(U, V, C, R, w, h):
        out = fur(U, h, w)
        out = stripes(out, U, V, 7, 1.0)
        if "stripes" in v:  # a dark line down the back
            out = put(out, np.abs(U - 0.5) < 0.025, rgb(v["stripes"]), 0.6)
        if "patch" in v:
            out = patches(out, h, w, 0.3, 6 if dog else 8)
            if not dog:  # the white cat: grey on the back only
                out = np.where((np.cos(2 * np.pi * (U - 0.5)) < 0.2)[..., None], fur(U, h, w), out)
        if "blaze" in v:  # a white chest spot
            out = put(out, ((U < 0.07) | (U > 0.93)) & (V > 0.8), rgb(v["blaze"]), 0.9)
        return out

    # ----- head: u around (the top at u = 0.5), v back of the skull (0) to the nose (1)
    hr, _ = head_rings(v)
    hv = ring_vs(hr)
    eye_v = hv[2] + (hv[3] - hv[2]) * (0.25 if dog else 0.1)

    def head(U, V, C, R, w, h):
        out = fur(U, h, w, bk=0.8, bl=0.9)
        ad = np.abs(C - (w - 1) / 2)
        if "muzzle" in v:
            out = put(out, V > hv[3] + 0.04, rgb(v["muzzle"]) * P.grain(h, w, 0.04)[..., 0:1].mean(), 0.65)
        if "stripes" in v:  # the tabby M on the brow and cheek lines
            out = stripes(out, U, V * 0.5, 4, 0.9)
            brow = (np.abs(U - 0.5) < 0.09) & (V > eye_v - 0.36) & (V < eye_v - 0.05) & (((C.astype(int)) % 3) == 0)
            out = put(out, brow, rgb(v["stripes"]), 0.8)
        if v.get("eye_patch"):
            out = put(out, (U > 0.56) & (U < 0.78) & (V > eye_v - 0.3) & (V < eye_v + 0.2), rgb(v["patch"]), 1.0)
        if v.get("patch") and not dog:  # grey cap on the white cat
            out = put(out, (np.abs(U - 0.5) < 0.16) & (V < eye_v - 0.05), rgb(v["patch"]), 0.9)
        # eyes: either side of the top, at the brow ring
        e_off = (10.0 if dog else 9.0)
        er = int(round(eye_v * (h - 1)))
        for sgn in (-1, 1):
            ec = int(round((w - 1) / 2 + sgn * e_off))
            if dog:
                out[er - 1:er + 1, ec - 1:ec + 1] = rgb(v["eye"])
                out[er, ec + (0 if sgn > 0 else -1)] = rgb(v["eye"]) * 0.4 + 0.25
            else:
                out[er - 1:er + 2, ec - 1:ec + 2] = rgb(v["eye"])
                out[er - 1:er + 2, ec] = rgb(0x0a0a08)
                out[er + 1, ec - 1:ec + 2] = rgb(v["eye"]) * 0.7
        # nose at the tip (the top half of the last ring), mouth line along the lower sides
        if dog:
            nose_v = hv[-2] + (1 - hv[-2]) * 0.3
            out = put(out, (V >= nose_v) & (ad < w * 0.28), rgb(v["nose"]), 1.0)
            out = put(out, (V >= 0.985), rgb(v["nose"]), 0.8)
        else:
            # a pale muzzle and chin, a small nose on the top of the tip
            if v["name"] != "cat_black":
                out = put(out, (V > hv[-2] + 0.05) & (ad > w * 0.12), rgb(v["belly"]), 0.7)
            out = put(out, (V >= 0.97) & (ad < w * 0.05), rgb(v["nose"]), 1.0)
        mouth = (np.abs(ad - w * 0.36) < 1.0) & (V > hv[-3] + 0.05)
        out = put(out, mouth, rgb(0x1a1210), 0.7)
        return out

    def neck(U, V, C, R, w, h):
        out = fur(U, h, w, bk=0.9, bl=0.8)
        out = stripes(out, U, V, 2, 0.8)
        if "patch" in v and dog:
            out = patches(out, h, w, 0.3)
        if "blaze" in v:
            out = put(out, (np.abs(U - 0.5) > 0.43) & (V < 0.5), rgb(v["blaze"]), 0.85)
        return out

    def tail(U, V, C, R, w, h):
        out = fur(U, h, w, bk=0.7, bl=0.6)
        if "stripes" in v:
            ring_ = np.sin(2 * np.pi * V * 5.5) > 0.3
            out = put(out, ring_, rgb(v["stripes"]), 0.75 * v.get("stripe_amt", 0.8))
            out = put(out, V > 0.9, rgb(v["stripes"]), 0.8)
        if v.get("grey_tail"):
            out = put(out, V >= 0.0, rgb(v["patch"]) * P.grain(h, w, 0.04), 1.0)
        if "tail_tip" in v:
            out = put(out, V > 0.72, rgb(v["tail_tip"]), 1.0)
        return out

    def leg(front):
        def fn(U, V, C, R, w, h):
            out = fur(U, h, w, bk=0.4, bl=0.3)
            if "stripes" in v:
                ring_ = (np.sin(2 * np.pi * V * 4 + (0.0 if front else 1.0)) > 0.4) & (V < 0.7)
                out = put(out, ring_, rgb(v["stripes"]), 0.55 * v.get("stripe_amt", 0.8))
            if "patch" in v and dog:
                out = put(out, (V < 0.35) & P.blobs(h, w, 5, 0.35), rgb(v["patch"]), 1.0)
            if "blaze" in v and front:
                out = put(out, V > 0.86, rgb(v["blaze"]) * 0.8, 0.7)  # white toes
            if not dog and sp == "cat" and v["name"] in ("cat_tabby", "cat_ginger"):
                out = put(out, V > 0.8, rgb(v["belly"]), 0.8)  # pale paws
            return out
        return fn

    def ear(U, V, C, R, w, h):
        out_col = rgb(v.get("ear_col", v["back"]))
        if v.get("patch") and not dog:
            out_col = rgb(v["patch"])
        inner = rgb(v.get("ear_in", v.get("ear_col", v["back"]))) * (0.8 if dog else 1.0)
        out = np.where((U < 0.5)[..., None], out_col[None, None, :], inner[None, None, :])
        if not dog:  # the rim of the inner ear is fur
            rim = (U >= 0.5) & ((np.abs(U - 0.78) > 0.12 + 0.12 * (1 - V)) | (V < 0.1))
            out = put(out, rim, out_col, 1.0)
        return out * P.grain(h, w, 0.04)

    def spare(U, V, C, R, w, h):
        return base[None, None, :] * np.ones((h, w, 1))

    P.cell("body", body)
    P.cell("head", head)
    P.cell("neck", neck)
    P.cell("tail", tail)
    P.cell("legF", leg(True))
    P.cell("legH", leg(False))
    P.cell("ear", ear)
    P.cell("spare", spare)
    return P.img


# ---------------------------------------------------------------- blender objects

def make_image(name, px):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    rgba = np.ones((TEX, TEX, 4), dtype=np.float32)
    rgba[..., :3] = px
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def make_material(name, img):
    mt = bpy.data.materials.new(name)
    if mt.node_tree is None:
        mt.use_nodes = True
    mt.use_backface_culling = False
    nt = mt.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Closest"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    return mt


def make_animal(v, idx):
    spd = SPECIES[v["sp"]]
    J = spd["J"]
    k = v["k"]
    arm = bpy.data.armatures.new(v["name"] + "_rig")
    ao = bpy.data.objects.new(v["name"], arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode="EDIT")
    blen = 0.06 if v["sp"] == "dog" else 0.03
    for bn, (par, d) in spd["bones"].items():
        eb = arm.edit_bones.new(bn)
        h0 = J[bn]
        eb.head = B(*(c * k for c in h0))
        eb.tail = B(*(c * k for c in along(h0, d, blen)))
        eb.roll = 0.0
    for bn, (par, d) in spd["bones"].items():
        if par:
            arm.edit_bones[bn].parent = arm.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")

    body = build_body(v)
    me = bpy.data.meshes.new(v["name"] + "_body")
    bmesh.ops.triangulate(body.bm, faces=body.bm.faces[:])
    body.bm.to_mesh(me)
    tris = len(body.bm.faces)
    body.bm.free()
    mo = bpy.data.objects.new(v["name"] + "_body", me)
    bpy.context.scene.collection.objects.link(mo)
    for g in body.groups:
        mo.vertex_groups.new(name=g)
    mo.parent = ao
    mod = mo.modifiers.new("rig", "ARMATURE")
    mod.object = ao
    img = make_image(v["name"] + "_tex", paint(v, 1873 + idx * 11))
    me.materials.append(make_material(v["name"], img))
    for poly in me.polygons:
        poly.use_smooth = False
    return ao, mo, tris


# ---------------------------------------------------------------- posing

def R_(axis, deg):
    return Quaternion(axis, math.radians(deg))


def RX(d):
    return R_((1, 0, 0), d)


def RY(d):
    return R_((0, 1, 0), d)


def RZ(d):
    return R_((0, 0, 1), d)


def rot2(v, a):
    """Rotate a (z, y) vector by a degrees; positive = RX(+a): up turns forward, forward turns down."""
    r = math.radians(a)
    c, s = math.cos(r), math.sin(r)
    return np.array((v[0] * c + v[1] * s, -v[0] * s + v[1] * c))


def ang(v):
    return math.degrees(math.atan2(v[1], v[0]))


def wrap(a):
    return (a + 180.0) % 360.0 - 180.0


def smooth(u):
    return u * u * (3 - 2 * u)


class Rig:
    """The sagittal (z, y) view of a species skeleton, for FK and leg IK."""

    def __init__(self, sp):
        spd = SPECIES[sp]
        self.sp = sp
        self.J = {n: np.array((p[2], p[1])) for n, p in spd["J"].items()}
        self.toe = {w: np.array(p) for w, p in spd["toe"].items()}
        self.parent = {n: p for n, (p, _) in spd["bones"].items()}
        self.tail = spd["tail"]
        self.dir = {n: d for n, (_, d) in spd["bones"].items()}
        v0 = next(v for v in VARIANTS if v["sp"] == sp)
        # points of the body tube and the neck (for the ground under sit and lie)
        pts = []
        for rs in (trunk_rings(v0)[0], neck_rings(v0)[0]):
            for r in rs:
                for t in np.linspace(-math.pi, math.pi, 17):
                    co = math.cos(t)
                    rb = r["rb"] if co >= 0 else r.get("rbb", r["rb"])
                    w = r["w"] if isinstance(r["w"], dict) else {r["w"]: 1.0}
                    pts.append((np.array((r["c"][2], r["c"][1] + rb * co)), w))
        self.trunk = pts
        # (z, y) of the nose tip and the chin, on the head bone
        hr, hc = head_rings(v0)
        self.nose = np.array((hr[-1]["c"][2] + hc[2], hr[-1]["c"][1]))
        self.chin = np.array((hr[-2]["c"][2], hr[-2]["c"][1] - hr[-2]["rbb"]))
        self.tail_r = tail_rings(v0)[0][0]["ra"]
        self.tail_seg = [math.dist(spd["J"][a], spd["J"][b]) for a, b in zip(self.tail, self.tail[1:])]


class Pose:
    """One frame: planar pitch for the body chain and the legs (IK), extra
    yaw and roll where it does not move the feet. q holds armature-space
    rotations relative to the parent, like build_people.py."""

    def __init__(self, rig, ground=0.0):
        self.r = rig
        self.g = ground  # the ground in the un-lowered frame: the root drops by this much
        self.q = {}
        self.A = {}
        self.P = {}
        self.err = 0.0

    def body(self, hips=0.0, spine=0.0, chest=0.0, neck=0.0, head=0.0):
        J = self.r.J
        self.A["hips"] = hips
        self.P["hips"] = J["hips"].copy()
        chain = [("spine", "hips", spine), ("chest", "spine", chest), ("neck", "chest", neck), ("head", "neck", head)]
        for b, p, a in chain:
            self.P[b] = self.P[p] + rot2(J[b] - J[p], self.A[p])
            self.A[b] = self.A[p] + a
        for b, a in [("hips", hips)] + [(b, a) for b, _, a in chain]:
            self.q[b] = RX(a)

    def point(self, bone, p):
        """Where rest point p (z, y) on this bone is now."""
        J = self.r.J
        return self.P[bone] + rot2(np.asarray(p) - J[bone], self.A[bone])

    def trunk_low(self):
        low = 9.0
        for p, w in self.r.trunk:
            y = sum(wt * self.point(b, p)[1] for b, wt in w.items())
            low = min(low, y)
        return low

    def pivot(self, which):
        par = "chest" if which == "front" else "hips"
        return self.point(par, self.r.J[which + "UpL"]), self.A[par]

    def leg(self, which, S, toe, w3=None, follow=0.6, extra=0.0, out=0.0):
        """Two-bone IK from the hip (shoulder) to the ankle (wrist) so that the
        paw's ground point lands on toe; w3 = world angle of the foot bone
        (None: follow the line from the hip to the toe)."""
        J = self.r.J
        up, low, foot = (f"{which}{p}L" for p in ("Up", "Low", "Foot"))
        piv, pa = self.pivot(which)
        r1 = J[low] - J[up]
        r2 = J[foot] - J[low]
        r3 = self.r.toe[which] - J[foot]
        toe = np.asarray(toe, dtype=float)
        if w3 is None:
            rest_line = self.r.toe[which] - J[up]
            w3 = follow * wrap(ang(rest_line) - ang(toe - piv))
        w3 += extra
        ankle = toe - rot2(r3, w3)
        L1, L2 = np.linalg.norm(r1), np.linalg.norm(r2)
        dv = ankle - piv
        d = float(np.linalg.norm(dv))
        dc = min(max(d, abs(L1 - L2) + 1e-4), L1 + L2 - 1e-4)
        self.err = max(self.err, d - dc)
        base = math.atan2(dv[1], dv[0])
        al = math.acos(max(-1.0, min(1.0, (L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc))))
        ph1 = base + al if which == "hind" else base - al
        knee = piv + L1 * np.array((math.cos(ph1), math.sin(ph1)))
        ank = piv + dv / d * dc if d > 1e-9 else ankle
        ph2 = math.atan2(ank[1] - knee[1], ank[0] - knee[0])
        W1 = wrap(ang(r1) - math.degrees(ph1))
        W2 = wrap(ang(r2) - math.degrees(ph2))
        self.set_leg(which, S, W1 - pa, W2 - W1, wrap(w3 - W2), out)

    def set_leg(self, which, S, qu, ql, qf, out=0.0):
        sg = 1 if S == "L" else -1
        self.q[f"{which}Up{S}"] = RY(-sg * out) @ RX(qu)
        self.q[f"{which}Low{S}"] = RX(ql)
        self.q[f"{which}Foot{S}"] = RX(qf)

    def rest_toe(self, which, dz=0.0, dy=0.0):
        return self.r.toe[which] + np.array((dz, self.g + dy))

    def stand(self):
        for S in "LR":
            for which in ("front", "hind"):
                self.leg(which, S, self.rest_toe(which), w3=0.0)

    def tail(self, pitch, yaw=None):
        yaw = yaw or [0.0] * len(pitch)
        for tb, p, y in zip(self.r.tail, pitch, yaw):
            self.q[tb] = RZ(y) @ RX(p)

    def tail_world(self, segs):
        """segs: per tail bone (math angle of the segment in the side view, world yaw):
        lay the tail out in the world regardless of how the hips are pitched."""
        rest = ang(np.array((SPECIES[self.r.sp]["tail_dir"][2], SPECIES[self.r.sp]["tail_dir"][1])))
        parent = self.q.get("hips", Quaternion())
        for tb, (a, yaw) in zip(self.r.tail, segs):
            D = RZ(yaw) @ RX(rest - a)
            self.q[tb] = parent.inverted() @ D
            parent = D

    def tail_ground(self, yaws, rise=2.0):
        """Tail down from the rump to the ground, then flat along it, turned by yaws (world)."""
        base = self.point("hips", self.r.J["tail1"])
        h = base[1] - self.g - self.r.tail_r
        e = math.degrees(math.asin(max(-1.0, min(1.0, h / self.r.tail_seg[0]))))
        segs = [(180.0 + e, yaws[0])] + [(180.0 - rise, y) for y in yaws[1:]]
        self.tail_world(segs)

    def neck_to(self, chest_a, head_world, target_y, key="chin", lo=-40.0, hi=135.0):
        """Pick the neck pitch so the chin (or nose) is at target_y, with the head held at head_world."""
        for _ in range(40):
            mid = (lo + hi) / 2
            y = self._probe(mid, head_world, key)
            if y > target_y:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    def _probe(self, neck_a, head_world, key):
        J = self.r.J
        An = self.A["chest"] + neck_a
        Ph = self.P["neck"] + rot2(J["head"] - J["neck"], An)
        p = self.r.chin if key == "chin" else self.r.nose
        return (Ph + rot2(p - J["head"], head_world))[1]


# ---------------------------------------------------------------- clips

def gait_foot(t, phase, duty, S, lift, z0, g):
    """Toe position for one foot: stance sweeps back at constant speed, swing comes forward lifted.
    Returns (toe (z, y), swing fraction 0..1 or None in stance)."""
    s = (t - phase) % 1.0
    if s < duty:
        u = s / duty
        return np.array((z0 + S / 2 - S * u, g)), None
    u = (s - duty) / (1 - duty)
    return np.array((z0 - S / 2 + S * smooth(u), g + lift * math.sin(math.pi * u))), u


GAITS = {
    # species, clip: duty, sweep (m), lift (m), phases per foot (LH, LF, RH, RF), front paw flick
    ("dog", "walk"): dict(duty=0.62, S=0.28, lift=0.06, ph=dict(hindL=0.0, frontL=0.25, hindR=0.5, frontR=0.75), secs=0.75),
    ("dog", "run"): dict(duty=0.32, S=0.36, lift=0.10, ph=dict(hindL=0.0, hindR=0.1, frontR=0.42, frontL=0.52), secs=10 / 24),
    ("cat", "walk"): dict(duty=0.62, S=0.13, lift=0.03, ph=dict(hindL=0.0, frontL=0.25, hindR=0.5, frontR=0.75), secs=14 / 24),
    ("cat", "run"): dict(duty=0.32, S=0.17, lift=0.05, ph=dict(hindL=0.0, hindR=0.08, frontR=0.42, frontL=0.5), secs=9 / 24),
}


def stride(sp, clip):
    G = GAITS[(sp, clip)]
    return G["S"] / G["duty"]


def legs_gait(ps, t, G, flick=65.0, zshift=None):
    zshift = zshift or {}
    for key, phase in G["ph"].items():
        which, S = key[:-1], key[-1]
        z0 = ps.r.toe[which][0] + zshift.get(which, 0.0)
        toe, sw = gait_foot(t, phase, G["duty"], G["S"], G["lift"], z0, ps.g)
        extra = 0.0
        if sw is not None:
            extra = (flick if which == "front" else 25.0) * math.sin(math.pi * sw)
        ps.leg(which, S, toe, extra=extra)


def dog_idle(ps, t):
    p = 2 * math.pi * t
    br = math.sin(4 * p)
    ps.body(hips=0.6 * math.sin(p), spine=0.3 * br, chest=0.5 * br, neck=-2 + 2 * math.sin(p + 1),
            head=2 * math.sin(3 * p))
    ps.stand()
    look = 16 * math.sin(p) * math.sin(0.5 * p) ** 2 - 6 * math.sin(2 * p) * math.cos(p) ** 2
    ps.q["head"] = RZ(look) @ ps.q["head"]
    wag = 26 * math.sin(6 * p)
    ps.tail([50, 22], [wag * 0.6, wag])
    flick = max(0.0, math.sin(2 * p + 2.0)) ** 8
    ps.q["earL"] = RX(-14 * flick)
    ps.q["earR"] = RY(10 * flick)


def dog_walk(ps, t):
    G = GAITS[("dog", "walk")]
    p = 2 * math.pi * t
    ps.body(hips=1.0 * math.sin(2 * p), spine=-0.5 * math.sin(2 * p), chest=0.0, neck=-4 + 3 * math.sin(2 * p + 1.2),
            head=3 - 3 * math.sin(2 * p + 1.2))
    legs_gait(ps, t, G)
    ps.q["hips"] = RY(2.5 * math.sin(p)) @ ps.q["hips"]
    ps.q["head"] = RZ(3 * math.sin(p)) @ ps.q["head"]
    wag = 20 * math.sin(2 * p)
    ps.tail([62, 28], [wag * 0.6, wag])


def dog_run(ps, t):
    G = GAITS[("dog", "run")]
    f = math.cos(2 * math.pi * (t - 0.08))  # +1 gathered (spine arched), -1 stretched
    ps.body(hips=-7 * f, spine=6 * f, chest=5 * f, neck=-12 - 5 * f, head=10)
    legs_gait(ps, t, G, flick=90.0, zshift=dict(front=0.04, hind=0.02))
    ps.tail([58 + 8 * f, 12 - 10 * f])


def dog_sniff(ps, t):
    p = 2 * math.pi * t
    ps.body(hips=4, spine=4, chest=4)
    head_w = 68 + 3 * math.sin(2 * p)
    na = ps.neck_to(ps.A["chest"], head_w, 0.055, key="nose", lo=-20, hi=135)
    jit = 3 * math.sin(2 * math.pi * 9 * t) * (0.5 + 0.5 * math.sin(p * 2))
    ps.body(hips=4, spine=4, chest=4, neck=na, head=head_w - ps.A["chest"] - na + jit)
    ps.stand()
    ps.q["neck"] = RZ(14 * math.sin(p)) @ ps.q["neck"]
    ps.q["head"] = RZ(-6 * math.sin(p)) @ ps.q["head"]
    ps.tail([55, 25], [12 * math.sin(p + 0.7), 18 * math.sin(p)])


DROP = {}  # (species, clip) -> how far the game lowers the root (m, for k = 1)


def settle(ps, key):
    """Sit and lie: the ground is the lowest point of the body at t = 0."""
    if key not in DROP:
        DROP[key] = ps.trunk_low()
    # in the un-lowered frame the ground is DROP above y = 0; the game lowers the root by DROP
    ps.g = DROP[key]


def dog_sit(ps, t):
    p = 2 * math.pi * t
    br = math.sin(4 * p)
    ps.body(hips=-30, spine=-6 + 0.4 * br, chest=-4 + 0.6 * br)
    settle(ps, ("dog", "sit"))
    head_w = 4 + 2 * math.sin(3 * p)
    ps.body(hips=-30, spine=-6 + 0.4 * br, chest=-4 + 0.6 * br, neck=30, head=head_w - ps.A["chest"] - 30)
    # front legs straight down to the ground under the shoulders
    for S in "LR":
        piv, _ = ps.pivot("front")
        ps.leg("front", S, np.array((piv[0] + 0.035, ps.g)), w3=0.0)
        hp, _ = ps.pivot("hind")
        ps.leg("hind", S, np.array((hp[0] + 0.24, ps.g + 0.022)), w3=-84.0, out=12.0)
    look = 20 * math.sin(p) * math.sin(0.5 * p) ** 2
    ps.q["head"] = RZ(look) @ ps.q["head"]
    ps.tail_ground([-30 + 6 * math.sin(2 * p), -55 + 8 * math.sin(2 * p)])


def dog_lie(ps, t):
    p = 2 * math.pi * t
    br = math.sin(2 * p)
    ps.body(hips=0, spine=0.5 * br, chest=1.0 * br)
    settle(ps, ("dog", "lie"))
    head_w = 10 + 1.0 * br
    na = ps.neck_to(ps.A["chest"], head_w, ps.g + 0.052, key="chin")
    ps.body(hips=0, spine=0.5 * br, chest=1.0 * br, neck=na, head=head_w - ps.A["chest"] - na)
    J = ps.r.J
    for S in "LR":
        # front legs stretched out ahead along the ground
        piv, _ = ps.pivot("front")
        L = np.linalg.norm(J["frontLowL"] - J["frontUpL"]) + np.linalg.norm(J["frontFootL"] - J["frontLowL"])
        wy = ps.g + 0.03
        dz = math.sqrt(max(0.0, (0.86 * L) ** 2 - (piv[1] - wy) ** 2))
        w3 = -70.0
        r3 = ps.r.toe["front"] - J["frontFootL"]
        wrist = np.array((piv[0] + dz, wy))
        ps.leg("front", S, wrist + rot2(r3, w3), w3=w3)
        # hind legs folded under, feet flat and forward, knees out
        hp, _ = ps.pivot("hind")
        ps.leg("hind", S, np.array((hp[0] + 0.2, ps.g + 0.022)), w3=-84.0, out=22.0)
    ps.q["head"] = RZ(4 * math.sin(p)) @ ps.q["head"]
    ps.tail_ground([-25, -50 + 4 * math.sin(p)])
    ps.q["earL"] = RX(-6)
    ps.q["earR"] = RX(-6)


def cat_idle(ps, t):
    p = 2 * math.pi * t
    br = math.sin(4 * p)
    ps.body(hips=0.4 * math.sin(p), spine=0.3 * br, chest=0.4 * br, neck=-3 + 2 * math.sin(p), head=3)
    ps.stand()
    look = 22 * math.sin(p) * math.sin(0.5 * p) ** 2
    ps.q["head"] = RZ(look) @ ps.q["head"]
    sw = math.sin(2 * p)
    ps.tail([48, 38, 30], [10 * sw, 18 * math.sin(2 * p - 0.8), 26 * math.sin(2 * p - 1.6)])
    flick = max(0.0, math.sin(3 * p + 1.0)) ** 10
    ps.q["earL"] = RY(-18 * flick)


def cat_walk(ps, t):
    G = GAITS[("cat", "walk")]
    p = 2 * math.pi * t
    ps.body(hips=0.8 * math.sin(2 * p), spine=0, chest=0, neck=-4 + 2 * math.sin(2 * p + 1), head=4)
    legs_gait(ps, t, G, flick=55.0)
    ps.q["hips"] = RY(2.5 * math.sin(p)) @ ps.q["hips"]
    ps.tail([80, 40, -20], [4 * math.sin(p), 6 * math.sin(p - 0.8), 10 * math.sin(p - 1.6)])


def cat_run(ps, t):
    G = GAITS[("cat", "run")]
    f = math.cos(2 * math.pi * (t - 0.06))
    ps.body(hips=-9 * f, spine=8 * f, chest=6 * f, neck=-10 - 6 * f, head=8)
    legs_gait(ps, t, G, flick=90.0, zshift=dict(front=0.015, hind=0.01))
    ps.tail([45 + 8 * f, 5 - 6 * f, 5 - 6 * f])


def cat_sit(ps, t):
    p = 2 * math.pi * t
    br = math.sin(4 * p)
    ps.body(hips=-38, spine=-8 + 0.3 * br, chest=-6 + 0.4 * br)
    settle(ps, ("cat", "sit"))
    head_w = 2 + 2 * math.sin(3 * p)
    ps.body(hips=-38, spine=-8 + 0.3 * br, chest=-6 + 0.4 * br, neck=44, head=head_w - ps.A["chest"] - 44)
    for S in "LR":
        piv, _ = ps.pivot("front")
        ps.leg("front", S, np.array((piv[0] + 0.012, ps.g)), w3=0.0)
        hp, _ = ps.pivot("hind")
        ps.leg("hind", S, np.array((hp[0] + 0.10, ps.g + 0.012)), w3=-84.0, out=10.0)
    look = 24 * math.sin(p) * math.sin(0.5 * p) ** 2
    ps.q["head"] = RZ(look) @ ps.q["head"]
    tip = 12 * max(0.0, math.sin(2 * p)) ** 2
    ps.tail_ground([70, 125, 165 + tip])
    flick = max(0.0, math.sin(2 * p + 2.4)) ** 10
    ps.q["earR"] = RY(18 * flick)


def cat_lie(ps, t):
    p = 2 * math.pi * t
    br = math.sin(2 * p)
    ps.body(hips=0, spine=0.4 * br, chest=0.6 * br)
    settle(ps, ("cat", "lie"))
    head_w = 6 + 1.5 * math.sin(p)
    na = ps.neck_to(ps.A["chest"], head_w, ps.g + 0.065, key="chin")
    ps.body(hips=0, spine=0.4 * br, chest=0.6 * br, neck=na, head=head_w - ps.A["chest"] - na)
    for S in "LR":
        piv, _ = ps.pivot("front")
        # forepaws tucked under the chest, the tips just showing
        ps.leg("front", S, np.array((piv[0] + 0.05, ps.g + 0.012)), w3=-80.0)
        hp, _ = ps.pivot("hind")
        ps.leg("hind", S, np.array((hp[0] + 0.1, ps.g + 0.012)), w3=-84.0, out=14.0)
    ps.q["head"] = RZ(6 * math.sin(p) * math.sin(0.5 * p) ** 2) @ ps.q["head"]
    ps.tail_ground([40, 95, 140 + 6 * math.sin(p)])


CLIPS = {
    "dog": [("dog_idle", dog_idle, 4.0), ("dog_walk", dog_walk, GAITS[("dog", "walk")]["secs"]),
            ("dog_run", dog_run, GAITS[("dog", "run")]["secs"]), ("dog_sit", dog_sit, 4.0),
            ("dog_lie", dog_lie, 5.0), ("dog_sniff", dog_sniff, 3.0)],
    "cat": [("cat_idle", cat_idle, 4.0), ("cat_walk", cat_walk, GAITS[("cat", "walk")]["secs"]),
            ("cat_run", cat_run, GAITS[("cat", "run")]["secs"]), ("cat_sit", cat_sit, 4.0),
            ("cat_lie", cat_lie, 5.0)],
}


def bake(ao, rig, names, rest, name, fn, secs):
    ad = ao.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    frames = int(round(secs * FPS))
    step = 1 if secs <= 1.0 else 2
    err = 0.0
    for f in list(range(0, frames, step)) + [frames]:
        t = (f % frames) / frames
        ps = Pose(rig)
        fn(ps, t)
        err = max(err, ps.err)
        for bn in names:
            q = ps.q.get(bn, Quaternion())
            local = rest[bn].inverted() @ q @ rest[bn]
            pb = ao.pose.bones[bn]
            pb.rotation_quaternion = local
            pb.keyframe_insert("rotation_quaternion", frame=f + 1)
    return act, frames, err


def body_mask(mo, legs=False):
    """The trunk (hips, spine, chest, neck), which rests on the ground in sit and lie;
    legs=True: the legs above the paws instead."""
    names = [g.name for g in mo.vertex_groups]
    mask = []
    for v in mo.data.vertices:
        g = max(v.groups, key=lambda e: e.weight).group if len(v.groups) else 0
        n = names[g]
        if legs:
            mask.append(n.startswith(("front", "hind")) and "Foot" not in n)
        else:
            mask.append(n in ("hips", "spine", "chest", "neck"))
    return mask


def make_actions(ao, mo, sp):
    """Key every clip of this species on armature ao and park each in its own NLA track.
    Sit and lie: the drop is re-measured on the skinned mesh until the lowest
    point of the body (haunches, belly, elbows) is the ground the paws stand on."""
    rig = Rig(sp)
    ad = ao.animation_data_create()
    bones = ao.data.bones
    names = list(SPECIES[sp]["bones"])
    rest = {bn: bones[bn].matrix_local.to_quaternion() for bn in names}
    for pb in ao.pose.bones:
        pb.rotation_mode = "QUATERNION"
    mask = body_mask(mo)
    actions = []
    info = {}
    for name, fn, secs in CLIPS[sp]:
        key = (sp, name.split("_", 1)[1])
        for _ in range(10):
            act, frames, err = bake(ao, rig, names, rest, name, fn, secs)
            if key[1] not in ("sit", "lie"):
                break
            low = lowest(mo, 1, mask)
            if abs(low - DROP[key]) < 0.0005:
                break
            DROP[key] = low
            print(f"[build_animals] {name}: drop {low:.4f}")
            ad.action = None
            bpy.data.actions.remove(act)
        actions.append(act)
        info[name] = dict(frames=frames, secs=frames / FPS, ik_err=err,
                          legs_low=lowest(mo, 1, body_mask(mo, True)) - DROP.get(key, 0.0))
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        st.name = name
        tr.mute = True
        ad.action = None
    for pb in ao.pose.bones:
        pb.rotation_quaternion = Quaternion()
    return actions, info


# ---------------------------------------------------------------- checks and preview

def use(ao, act):
    ad = ao.animation_data_create()
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    ad.action = act
    try:
        if len(act.slots):
            ad.action_slot = act.slots[0]
    except AttributeError:
        pass


def lowest(mo, frame, mask=None):
    scn = bpy.context.scene
    scn.frame_set(frame)
    dg = bpy.context.evaluated_depsgraph_get()
    eo = mo.evaluated_get(dg)
    me = eo.to_mesh()
    mw = mo.matrix_world
    zs = [(mw @ v.co).z for i, v in enumerate(me.vertices) if mask is None or mask[i]]
    eo.to_mesh_clear()
    return min(zs)


def dup(ao, mo):
    a2 = ao.copy()
    a2.animation_data_clear()
    bpy.context.scene.collection.objects.link(a2)
    m2 = mo.copy()
    m2.parent = a2
    m2.modifiers["rig"].object = a2
    bpy.context.scene.collection.objects.link(m2)
    return a2, m2


def setup_render():
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    sh = scn.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_backface_culling = False
    sh.show_specular_highlight = False
    try:
        sh.studiolight_rotate_z = math.radians(80)
    except AttributeError:
        pass
    scn.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.color = (0.32, 0.32, 0.32)
    scn.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    os.makedirs(SHOTS, exist_ok=True)

    def shoot(path, loc, look, lens, w, h, frame, ortho=None):
        scn.frame_set(frame)
        cam.location = loc
        cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
        if ortho:
            cam_data.type = "ORTHO"
            cam_data.ortho_scale = ortho
        else:
            cam_data.type = "PERSP"
            cam_data.lens = lens
        scn.render.resolution_x = w
        scn.render.resolution_y = h
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)

    return shoot


def preview(animals, acts):
    shoot = setup_render()
    # all eight in a row, idle, three-quarters on
    x = 0.0
    xs = []
    for ao, mo, v in animals:
        wdt = 1.0 if v["sp"] == "dog" else 0.55
        xs.append(x + wdt / 2)
        x += wdt
    for (ao, mo, v), cx in zip(animals, xs):
        ao.location = B(cx - x / 2, 0, 0)
        ao.rotation_euler = (0, 0, math.radians(62))
        use(ao, acts[v["sp"] + "_idle"])
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.new("floor")
    fm.diffuse_color = (0.2, 0.2, 0.2, 1)
    floor.data.materials.append(fm)
    shoot(os.path.join(SHOTS, "animals_preview.png"), B(0, 1.0, 7.0), B(0, 0.25, 0), 42, 2400, 700, 13)
    # the same from 10 m at a PS1-ish resolution: do they still read as dogs and cats?
    shoot(os.path.join(SHOTS, "animals_far.png"), B(0, 1.6, 10.0), B(0, 0.25, 0), 30, 480, 160, 13)

    # every clip: dogs behind, cats in front, a mid frame
    for ao, _, _ in animals:
        ao.location = B(0, -50, 0)
    placed = []
    for sp, row_z, gap in (("dog", -0.6, 1.15), ("cat", 0.7, 0.62)):
        src = next(a for a in animals if a[2]["sp"] == sp)
        clips = CLIPS[sp]
        n = len(clips)
        for i, (name, _, secs) in enumerate(clips):
            a2, m2 = dup(src[0], src[1])
            placed.append((a2, m2, sp))
            clip = name.split("_", 1)[1]
            drop = DROP.get((sp, clip), 0.0) * src[2]["k"]
            a2.location = B(i * gap - (n - 1) * gap / 2, -drop, row_z)
            a2.rotation_euler = (0, 0, math.radians(58))
            use(a2, acts[name])
    shoot(os.path.join(SHOTS, "animals_poses.png"), B(0.4, 1.6, 7.6), B(0, 0.2, 0), 30, 2400, 1000, 7)
    # a flat side view of the same, for checking the ground contact
    for a2, _, _ in placed:
        a2.rotation_euler = (0, 0, math.radians(90))
    shoot(os.path.join(SHOTS, "animals_side.png"), B(0, 0.3, 20), B(0, 0.3, 0), 0, 2400, 700, 7, ortho=7.2)
    # close-ups per species, three-quarters on, the other species out of the way
    for sp, gap in (("dog", 1.05), ("cat", 0.52)):
        mine = [pl for pl in placed if pl[2] == sp]
        for a2, m2, s2 in placed:
            m2.hide_render = s2 != sp
        n = len(mine)
        for i, (a2, m2, _) in enumerate(mine):
            loc = a2.location.copy()
            a2.location = B((i - (n - 1) / 2) * gap, loc.z, 0)
            a2.rotation_euler = (0, 0, math.radians(38))
        d = (n * gap + 0.3) / 1.2
        shoot(os.path.join(SHOTS, f"animals_close_{sp}.png"), B(0, 0.28 * d, d),
              B(0, 0.2 * gap, 0), 30, 2400, 800, 7)
    for _, m2, _ in placed:
        m2.hide_render = False


# ---------------------------------------------------------------- main

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    animals = []
    report = []
    for i, v in enumerate(VARIANTS):
        ao, mo, tris = make_animal(v, i)
        animals.append((ao, mo, v))
        report.append(f"{v['name']} {tris}")
    acts = {}
    infos = {}
    for sp in ("dog", "cat"):
        first = next(a for a in animals if a[2]["sp"] == sp)
        al, info = make_actions(first[0], first[1], sp)
        acts.update({a.name: a for a in al})
        infos.update(info)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_skins=True, export_animations=True,
                              export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="AUTO",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print(f"[build_animals] triangles: {', '.join(report)} -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    for name, inf in infos.items():
        print(f"[build_animals] clip {name}: {inf['frames']} frames, {inf['secs']:.4f} s, IK miss {inf['ik_err'] * 1000:.1f} mm, "
              f"legs above ground {inf['legs_low'] * 1000:+.0f} mm")
    for key, g in GAITS.items():
        print(f"[build_animals] stride {key[0]}_{key[1]}: {stride(*key):.3f} m per loop (k = 1)")
    # the drop, checked on the real skinned meshes
    for ao, mo, v in animals:
        sp = v["sp"]
        parts = []
        for name, _, secs in CLIPS[sp]:
            use(ao, acts[name])
            frames = int(round(secs * FPS))
            lows = [lowest(mo, f) for f in (1, frames // 4 + 1, frames // 2 + 1, 3 * frames // 4 + 1)]
            clip = name.split("_", 1)[1]
            want = DROP.get((sp, clip), 0.0) * v["k"]
            parts.append(f"{clip} low {min(lows):+.3f}..{max(lows):+.3f} drop {want:.3f}")
        print(f"[build_animals] {v['name']} (k {v['k']}): " + "; ".join(parts))
        ad = ao.animation_data
        if ad:
            ad.action = None
    if PREVIEW:
        preview(animals, acts)


if __name__ == "__main__":
    main()
