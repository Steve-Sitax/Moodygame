"""Build the people of Scheldemist in Blender and export them for the game.

    blender -b --factory-startup -P tools/blender/build_people.py [-- --preview]

Writes client/public/models/people.glb: one rigged, textured character per
kind (sooi, peeters, tuur, fientje, sailor, stranger, thief, foreman,
recipient). PS1-era people: lofted rings, 600 to 900 triangles each, one
128x128 texture per character painted here in code (our own work, nothing
downloaded).

Two base bodies (male, female) share one skeleton layout and one set of bone
names. Every bone points straight along an axis with roll 0, so the rest
rotations match across characters and one set of clips drives them all. The
clips are keyed on the first character only and hold rotations only; the game
strips the "_1", "_2" suffixes that the glTF loader adds to repeated bone names.

Clips: idle, walk, talk, fold (arms folded), carry (walk holding something),
and idle_f, talk_f, walk_f for the women (hands folded in front).

Coordinates: we build in game space (x = the character's left, y up, z forward,
the character faces +z). B() turns that into Blender space (Z up); the glTF
export turns it back to Y up.

--preview also renders data/shots/people_preview.png and people_faces.png.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Quaternion, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "people.glb")
SHOTS = os.path.join(ROOT, "data", "shots")
PREVIEW = "--preview" in sys.argv

TEX = 128
# Texture atlas cells (x, y, w, h) in pixels, y from the bottom.
CELLS = {
    "head": (0, 96, 64, 32),
    "torso": (64, 96, 64, 32),
    "pelvis": (0, 64, 32, 32),
    "neck": (32, 64, 32, 32),
    "armUp": (64, 64, 32, 32),
    "armLow": (96, 64, 32, 32),
    "hand": (0, 32, 32, 32),
    "legUp": (32, 32, 32, 32),
    "legLow": (64, 32, 32, 32),
    "foot": (96, 32, 32, 32),
    "lower": (0, 0, 64, 32),
    "hat": (64, 0, 32, 32),
    "shawl": (96, 16, 32, 16),
    "prop": (96, 0, 32, 16),
}

BONES = ["hips", "spine", "neck", "head",
         "armUpL", "armLowL", "handL", "armUpR", "armLowR", "handR",
         "legUpL", "legLowL", "footL", "legUpR", "legLowR", "footR"]


def B(x, y, z):
    return Vector((x, -z, y))


def rgb(h):
    return np.array([(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255])


# ---------------------------------------------------------------- characters

MALE = dict(female=False, sh=0.205, belly=0.0, cl=0.008)
FEMALE = dict(female=True, sh=0.178, belly=0.0, cl=0.004)

PEOPLE = [
    dict(MALE, name="sooi", h=1.78, sh=0.215, belly=0.035, cl=0.012,
         skin=0xb07a62, hair=0x5a5048, face="walrus", age=0.6,
         shirt=0xb8b0a0, vest=0x2e2a26, jacket=0x5a4634, jacket_style="open", trousers=0x4a443c, boots=0x2a1e16,
         hat="flatcap", hat_col=0x2e2e2c, lower="jacket", neckerchief=0x5a3a2a),
    dict(FEMALE, name="peeters", h=1.60, skin=0xc09c8a, hair=0x8a8680, face="widow", age=0.8,
         dress=0x1a1a1c, collar=0xb8b4a8, hat="bonnet", hat_col=0x141416, lower="skirt", lower_col=0x1c1c1e,
         shawl=0x222224, shawl_style="plain", boots=0x141210, props=["ledger"]),
    dict(MALE, name="tuur", h=1.74, sh=0.2, skin=0x9a6a50, hair=0x2a2420, face="stubble", age=0.4,
         jersey=0x28323e, trousers=0x3a362e, boots=0x2a2018, hat="knitcap", hat_col=0x5a2e26,
         lower="jersey", props=["pipe"]),
    dict(FEMALE, name="fientje", h=1.63, sh=0.182, skin=0xc08a6e, hair=0x5a3a28, face="woman", age=0.35,
         dress=0x6a3428, collar=0xc8c0b0, hat="whitecap", hat_col=0xd0cabc, lower="skirt", lower_col=0x5a2e26,
         apron=0x7a8a90, shawl=0x6a6a5c, shawl_style="check", boots=0x2a1e16, props=["basket"]),
    dict(MALE, name="sailor", h=1.75, skin=0xa87458, hair=0x7a4a26, face="chops", age=0.45,
         shirt=0xa8a498, jacket=0x1e2634, jacket_style="pea", trousers=0x242a36, boots=0x1a1612,
         hat="knitcap", hat_col=0x262c38, lower="pea"),
    dict(MALE, name="stranger", h=1.80, sh=0.205, skin=0xc4a08a, hair=0x201a16, face="gent", age=0.4,
         shirt=0xd4d0c4, vest=0x4a4a4e, jacket=0x1a1a1e, jacket_style="frock", trousers=0x2a2a2e, boots=0x0e0e10,
         hat="tophat", hat_col=0x121214, lower="coat", gloves=0x3a3a3c, chain=0xb08a3a, cravat=0x121214),
    dict(MALE, name="thief", h=1.70, sh=0.195, skin=0xa47c64, hair=0x3a2e24, face="young_stubble", age=0.2,
         shirt=0x6a6458, jacket=0x26241f, jacket_style="ragged", trousers=0x2e2a24, boots=0x1e1814,
         hat="flatcap", hat_col=0x1a1a18, lower="jacket", neckerchief=0x3a3a36),
    dict(MALE, name="foreman", h=1.77, sh=0.212, belly=0.02, skin=0xb08068, hair=0x3a3028, face="moustache", age=0.55,
         shirt=0xc0baa8, vest=0x3a3026, jacket=0x4e4234, jacket_style="coat", trousers=0x36322c, boots=0x1c1612,
         hat="bowler", hat_col=0x161412, lower="coat", chain=0xa08038),
    dict(MALE, name="recipient", h=1.72, skin=0xb4866a, hair=0x4a3624, face="clean", age=0.25,
         shirt=0xbab4a4, vest=0x3a3e44, jacket=0x343a46, jacket_style="open", trousers=0x3a3a3c, boots=0x221a14,
         hat="flatcap", hat_col=0x3a3a36, lower="jacket"),
]


# ---------------------------------------------------------------- mesh builder

class Body:
    """One character mesh: lofted parts, each rigidly bound to one bone."""

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

    def vert(self, p, bone):
        v = self.bm.verts.new(B(p[0] * self.k, p[1] * self.k, p[2] * self.k))
        v[self.dl][self.gi(bone)] = 1.0
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
    def cuv(cell, u, v, sub=None):
        x0, y0, w, h = CELLS[cell]
        if sub:
            u = sub[0] + (sub[1] - sub[0]) * u
            v = sub[2] + (sub[3] - sub[2]) * v
        return ((x0 + 0.5 + u * (w - 1)) / TEX, (y0 + 0.5 + v * (h - 1)) / TEX)

    def loft(self, rings, bone, cell, n, side=(1, 0, 0), fwd=(0, 0, 1), cap0=None, cap1=None,
             arc=None, p=2.0, phase=0.0, push=None, sub=None):
        """Rings: dicts with c (centre), ra (side radius), rb (front radius),
        rbb (back radius, default rb), y (optional per-theta y offset fn).
        theta = 0 points along fwd, +90 deg along side. u runs with theta from
        the back (-180) round to the back (+180); v runs along the rings.
        cap0/cap1: None (open) or an offset (x, y, z) for the fan centre.
        arc: (a0, a1) in degrees for an open shell instead of a closed ring."""
        A = Vector(side)
        F = Vector(fwd)
        closed = arc is None
        cols = n if closed else n + 1
        thetas = [(-math.pi + 2 * math.pi * i / n + phase) if closed else
                  math.radians(arc[0] + (arc[1] - arc[0]) * i / n) for i in range(cols)]
        us = [i / n for i in range(n + 1)]
        c0 = Vector(rings[0]["c"])
        c1 = Vector(rings[-1]["c"])
        axis = c1 - c0
        L = axis.length or 1.0
        D = axis / L
        vs_ = [max(0.0, min(1.0, (Vector(r["c"]) - c0).dot(D) / L)) for r in rings]
        grid = []
        for ri, r in enumerate(rings):
            c = Vector(r["c"])
            row = []
            for t in thetas:
                s, co = math.sin(t), math.cos(t)
                sx = math.copysign(abs(s) ** (2 / p), s)
                cx = math.copysign(abs(co) ** (2 / p), co)
                rb = r["rb"] if co >= 0 else r.get("rbb", r["rb"])
                pt = c + A * (r["ra"] * sx) + F * (rb * cx)
                if "yoff" in r:
                    pt.y += r["yoff"](t)
                if push:
                    d = push(ri, t)
                    if d:
                        pt += Vector(d)
                row.append(self.vert(pt, bone))
            grid.append(row)
        flip = A.cross(D).dot(F) < 0
        for ri in range(len(rings) - 1):
            for i in range(n):
                j = (i + 1) % cols if closed else i + 1
                q = [grid[ri][i], grid[ri][j], grid[ri + 1][j], grid[ri + 1][i]]
                uv = [self.cuv(cell, us[i], vs_[ri], sub), self.cuv(cell, us[i + 1], vs_[ri], sub),
                      self.cuv(cell, us[i + 1], vs_[ri + 1], sub), self.cuv(cell, us[i], vs_[ri + 1], sub)]
                if flip:
                    q.reverse()
                    uv.reverse()
                self.face(q, uv)
        centre = sum((Vector(r["c"]) for r in rings), Vector()) / len(rings)
        for cap, ri, vv in ((cap0, 0, 0.0), (cap1, len(rings) - 1, 1.0)):
            if cap is None:
                continue
            cc = Vector(rings[ri]["c"]) + Vector(cap)
            mid = self.vert(cc, bone)
            out = B(*(cc - centre))
            for i in range(n):
                j = (i + 1) % cols if closed else i + 1
                tri = [mid, grid[ri][i], grid[ri][j]]
                uv = [self.cuv(cell, (us[i] + us[i + 1]) / 2, vv, sub), self.cuv(cell, us[i], vv, sub),
                      self.cuv(cell, us[i + 1], vv, sub)]
                f = self.face(tri, uv)
                if f is None:
                    continue
                f.normal_update()
                if f.normal.dot(out) < 0:
                    f.normal_flip()

    def strip(self, rows, bone, cell, sub=None):
        """A single-sided patch from a grid of points (rows x cols); the
        material is double-sided in the game."""
        nr, nc = len(rows), len(rows[0])
        grid = [[self.vert(p, bone) for p in row] for row in rows]
        for r in range(nr - 1):
            for c in range(nc - 1):
                q = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]]
                uv = [self.cuv(cell, c / (nc - 1), r / (nr - 1), sub), self.cuv(cell, (c + 1) / (nc - 1), r / (nr - 1), sub),
                      self.cuv(cell, (c + 1) / (nc - 1), (r + 1) / (nr - 1), sub), self.cuv(cell, c / (nc - 1), (r + 1) / (nr - 1), sub)]
                self.face(q, uv)


def ring(x, y, z, ra, rb, rbb=None, **kw):
    r = dict(c=(x, y, z), ra=ra, rb=rb)
    if rbb is not None:
        r["rbb"] = rbb
    r.update(kw)
    return r


def at(deg, t, tol=1.0):
    return abs(abs(math.degrees(t)) - deg) < tol


# ---------------------------------------------------------------- skeleton

def joints(s):
    """Canonical (1.74 m) joint positions for this body."""
    sh = s["sh"]
    fem = s["female"]
    return {
        "hips": ((0, 0.95, 0), (0, 1.02, 0)),
        "spine": ((0, 1.02, 0), (0, 1.45, 0)),
        "neck": ((0, 1.45, 0), (0, 1.53, 0)),
        "head": ((0, 1.53, 0), (0, 1.75, 0)),
        "armUpL": ((sh, 1.42, 0), (sh, 1.13, 0)),
        "armLowL": ((sh, 1.13, 0), (sh, 0.875, 0)),
        "handL": ((sh, 0.875, 0), (sh, 0.70, 0)),
        "armUpR": ((-sh, 1.42, 0), (-sh, 1.13, 0)),
        "armLowR": ((-sh, 1.13, 0), (-sh, 0.875, 0)),
        "handR": ((-sh, 0.875, 0), (-sh, 0.70, 0)),
        "legUpL": ((0.09, 0.90, 0), (0.09, 0.50, 0)),
        "legLowL": ((0.09, 0.50, 0), (0.09, 0.085, 0)),
        "footL": ((0.09, 0.085, 0), (0.09, 0.085, 0.14)),
        "legUpR": ((-0.09, 0.90, 0), (-0.09, 0.50, 0)),
        "legLowR": ((-0.09, 0.50, 0), (-0.09, 0.085, 0)),
        "footR": ((-0.09, 0.085, 0), (-0.09, 0.085, 0.14)),
    } if not fem else {
        "hips": ((0, 0.95, 0), (0, 1.02, 0)),
        "spine": ((0, 1.02, 0), (0, 1.45, 0)),
        "neck": ((0, 1.45, 0), (0, 1.53, 0)),
        "head": ((0, 1.53, 0), (0, 1.75, 0)),
        "armUpL": ((sh, 1.42, 0), (sh, 1.13, 0)),
        "armLowL": ((sh, 1.13, 0), (sh, 0.875, 0)),
        "handL": ((sh, 0.875, 0), (sh, 0.71, 0)),
        "armUpR": ((-sh, 1.42, 0), (-sh, 1.13, 0)),
        "armLowR": ((-sh, 1.13, 0), (-sh, 0.875, 0)),
        "handR": ((-sh, 0.875, 0), (-sh, 0.71, 0)),
        "legUpL": ((0.085, 0.90, 0), (0.085, 0.50, 0)),
        "legLowL": ((0.085, 0.50, 0), (0.085, 0.085, 0)),
        "footL": ((0.085, 0.085, 0), (0.085, 0.085, 0.14)),
        "legUpR": ((-0.085, 0.90, 0), (-0.085, 0.50, 0)),
        "legLowR": ((-0.085, 0.50, 0), (-0.085, 0.085, 0)),
        "footR": ((-0.085, 0.085, 0), (-0.085, 0.085, 0.14)),
    }


PARENT = {"spine": "hips", "neck": "spine", "head": "neck",
          "armUpL": "spine", "armLowL": "armUpL", "handL": "armLowL",
          "armUpR": "spine", "armLowR": "armUpR", "handR": "armLowR",
          "legUpL": "hips", "legLowL": "legUpL", "footL": "legLowL",
          "legUpR": "hips", "legLowR": "legUpR", "footR": "legLowR"}


# ---------------------------------------------------------------- body parts

def build_body(s):
    k = s["h"] / 1.74
    b = Body(k)
    fem = s["female"]
    sh = s["sh"]
    cl = s["cl"]
    belly = s["belly"]
    long_skirt = s.get("lower") == "skirt"
    long_coat = s.get("lower") == "coat"

    # --- head: 12 sides so there is a vertex for the nose (0), eyes (30) and ears (90)
    jaw = 0.9 if fem else 1.0
    hr = [
        ring(0, 1.525, -0.012, 0.047, 0.05, 0.05),
        ring(0, 1.547, 0.002, 0.058 * jaw, 0.07, 0.062),
        ring(0, 1.587, 0.0, 0.071 * jaw, 0.087, 0.078),
        ring(0, 1.625, 0.0, 0.078, 0.092, 0.088),
        ring(0, 1.657, -0.002, 0.08, 0.093, 0.094),
        ring(0, 1.692, -0.006, 0.08, 0.09, 0.098),
        ring(0, 1.724, -0.01, 0.066, 0.075, 0.086),
        ring(0, 1.747, -0.012, 0.034, 0.04, 0.048),
    ]

    def face_push(ri, t):
        if ri == 1 and at(0, t):
            return (0, -0.002, 0.009)
        if ri == 2 and at(0, t):
            return (0, 0, 0.01)
        if ri == 3:
            if at(0, t):
                return (0, -0.004, 0.03 if not fem else 0.024)
            if at(90, t):
                return (math.copysign(0.013, math.sin(t)), 0, -0.006)
        if ri == 4:
            if at(0, t):
                return (0, 0, 0.012)
            if at(30, t):
                return (0, 0.002, -0.007)
            if at(90, t):
                return (math.copysign(0.012, math.sin(t)), 0, -0.008)
        if ri == 5 and at(30, t):
            return (0, 0, 0.004)
        return None

    b.loft(hr, "head", "head", 12, cap1=(0, 0.008, 0), push=face_push)

    # --- neck
    nr = 0.046 if fem else 0.052
    b.loft([ring(0, 1.44, -0.012, nr, nr, nr + 0.004), ring(0, 1.56, -0.01, nr * 0.95, nr * 0.95, nr)], "neck", "neck", 6)

    # --- torso (spine): waist to neck base, squarish shoulders
    if fem:
        tr = [
            ring(0, 1.0, 0.0, 0.13 + cl, 0.092 + cl, 0.09 + cl),
            ring(0, 1.12, 0.0, 0.135 + cl, 0.098 + cl, 0.092 + cl),
            ring(0, 1.25, 0.004, 0.148 + cl, 0.125 + cl, 0.098 + cl),
            ring(0, 1.35, -0.004, sh - 0.022 + cl, 0.105 + cl, 0.095 + cl),
            ring(0, 1.425, -0.01, sh + 0.004 + cl, 0.078 + cl, 0.08 + cl),
            ring(0, 1.47, -0.012, 0.066, 0.055, 0.056),
        ]
    else:
        tr = [
            ring(0, 1.0, 0.0, 0.148 + cl + belly * 0.4, 0.098 + cl + belly, 0.094 + cl),
            ring(0, 1.12, 0.0 + belly * 0.3, 0.154 + cl + belly * 0.5, 0.104 + cl + belly * 1.2, 0.098 + cl),
            ring(0, 1.25, 0.004, 0.162 + cl + belly * 0.3, 0.114 + cl + belly * 0.5, 0.104 + cl),
            ring(0, 1.35, -0.004, sh - 0.02 + cl, 0.108 + cl, 0.1 + cl),
            ring(0, 1.425, -0.01, sh + 0.006 + cl, 0.084 + cl, 0.086 + cl),
            ring(0, 1.475, -0.012, 0.074, 0.06, 0.062),
        ]
    b.loft(tr, "spine", "torso", 10, p=2.6, cap1=(0, 0.01, 0))

    # --- pelvis (under a long skirt or coat nobody sees it)
    if not long_skirt and not long_coat:
        pr = [
            ring(0, 0.8, 0.0, 0.08, 0.07, 0.07),
            ring(0, 0.86, 0.0, 0.168 + cl, 0.104 + cl, 0.114 + cl),
            ring(0, 0.95, 0.0, 0.158 + cl, 0.1 + cl, 0.106 + cl),
            ring(0, 1.03, 0.0, 0.148 + cl, 0.097 + cl, 0.093 + cl),
        ]
        b.loft(pr, "hips", "pelvis", 8, p=2.4, cap0=(0, -0.02, 0))

    # --- arms: straight down in the rest pose, palms facing the thighs
    for sg, S in ((1, "L"), (-1, "R")):
        x = sg * sh
        sl = cl + (0.004 if s.get("jacket") else 0.0)
        b.loft([ring(x, 1.12, 0, 0.042 + sl, 0.045 + sl), ring(x, 1.3, 0, 0.05 + sl, 0.053 + sl),
                ring(x, 1.41, -0.005, 0.055 + sl, 0.058 + sl)],
               "armUp" + S, "armUp", 6, cap0=(0, -0.012, 0), cap1=(0, 0.018, 0))
        cuff = 0.038 if (s.get("jacket") or s.get("dress") or s.get("jersey")) else 0.032
        b.loft([ring(x, 0.868, 0, cuff, cuff + 0.004), ring(x, 1.02, 0, 0.042 + sl, 0.046 + sl),
                ring(x, 1.14, 0, 0.042 + sl, 0.046 + sl)],
               "armLow" + S, "armLow", 6, cap0=(0, 0.02, 0), cap1=(0, 0.01, 0))
        hl = 0.72 if not fem else 0.735
        b.loft([ring(x, hl, 0.006, 0.016, 0.03), ring(x, hl + 0.06, 0.004, 0.022, 0.042),
                ring(x, hl + 0.12, 0.0, 0.024, 0.044), ring(x, 0.885, 0, 0.02, 0.034)],
               "hand" + S, "hand", 4, p=3.0, phase=math.pi / 4, cap0=(0, -0.01, 0.002))
        # thumb: a small wedge on the front of the hand
        b.loft([ring(x - sg * 0.006, hl + 0.07, 0.04, 0.01, 0.011), ring(x - sg * 0.004, hl + 0.13, 0.03, 0.013, 0.014)],
               "hand" + S, "hand", 4, phase=math.pi / 4, cap0=(0, -0.008, 0.003), sub=(0.0, 1.0, 0.4, 0.6))

    # --- legs (the women's thighs stay hidden under the skirt)
    lx = 0.085 if fem else 0.09
    for sg, S in ((1, "L"), (-1, "R")):
        x = sg * lx
        tc = cl + 0.004
        if not long_skirt:
            b.loft([ring(x * 0.97, 0.49, 0.004, 0.052 + tc, 0.056 + tc), ring(x, 0.68, 0.0, 0.066 + tc, 0.07 + tc),
                    ring(x * 1.02, 0.88, 0.0, 0.08 + tc, 0.082 + tc)],
                   "legUp" + S, "legUp", 6, cap0=(0, -0.02, 0))
        lc = tc if not long_skirt else 0.0
        sr = 0.9 if fem else 1.0
        b.loft([ring(x * 0.96, 0.075, -0.004, 0.04 * sr + lc, 0.044 * sr + lc),
                ring(x * 0.97, 0.3, -0.006, 0.048 * sr + lc, 0.05 * sr + lc, 0.064 * sr + lc),
                ring(x * 0.97, 0.515, 0.0, 0.052 * sr + lc, 0.056 * sr + lc)],
               "legLow" + S, "legLow", 6, cap1=(0, 0.02, 0))
        # boot: rings run heel to toe, theta 0 on top of the foot
        fr = 0.92 if fem else 1.0
        b.loft([ring(x * 0.96, 0.046, -0.055, 0.04 * fr, 0.046),
                ring(x * 0.96, 0.056, 0.005, 0.047 * fr, 0.056),
                ring(x * 0.97, 0.038, 0.09 * fr, 0.048 * fr, 0.038),
                ring(x * 0.97, 0.03, 0.15 * fr, 0.036 * fr, 0.028)],
               "foot" + S, "foot", 6, side=(1, 0, 0), fwd=(0, 1, 0), p=3.0, cap0=(0, 0, -0.01), cap1=(0, 0, 0.012))

    clothes(b, s)
    return b


def clothes(b, s):
    fem = s["female"]
    sh = s["sh"]
    low = s.get("lower")
    # --- below the waist, bound to the hips
    if low == "jacket":
        b.loft([ring(0, 0.8, 0.004, 0.18, 0.13, 0.125), ring(0, 0.92, 0.002, 0.172, 0.122, 0.117),
                ring(0, 1.04, 0.0, 0.158 + s["belly"] * 0.4, 0.112 + s["belly"], 0.106)], "hips", "lower", 10, p=2.4)
    elif low == "pea":
        b.loft([ring(0, 0.77, 0.004, 0.185, 0.135, 0.13), ring(0, 0.92, 0.002, 0.175, 0.125, 0.12),
                ring(0, 1.04, 0.0, 0.16, 0.114, 0.108)], "hips", "lower", 10, p=2.4)
    elif low == "coat":
        b.loft([ring(0, 0.45, 0.006, 0.215, 0.19, 0.185), ring(0, 0.72, 0.004, 0.195, 0.152, 0.148),
                ring(0, 0.9, 0.002, 0.178 + s["belly"] * 0.3, 0.13 + s["belly"] * 0.6, 0.124),
                ring(0, 1.04, 0.0, 0.162 + s["belly"] * 0.4, 0.116 + s["belly"], 0.11)], "hips", "lower", 10, p=2.3)
    elif low == "jersey":
        b.loft([ring(0, 0.84, 0.0, 0.166, 0.114, 0.114), ring(0, 1.04, 0.0, 0.156, 0.106, 0.1)], "hips", "lower", 10, p=2.4)
    elif low == "skirt":
        b.loft([ring(0, 0.03, 0.01, 0.29, 0.27, 0.3),
                ring(0, 0.45, 0.005, 0.24, 0.215, 0.24),
                ring(0, 0.84, 0.0, 0.19, 0.155, 0.175),
                ring(0, 1.03, 0.0, 0.134, 0.096, 0.094)], "hips", "lower", 10, p=2.2)

    # --- shawl over the shoulders, pointed at the back
    if s.get("shawl"):
        b.loft([ring(0, 1.22, 0.0, 0.2, 0.14, 0.125, yoff=lambda t: 0.07 * math.cos(t) - 0.02),
                ring(0, 1.39, -0.006, sh + 0.062, 0.135, 0.118),
                ring(0, 1.482, -0.012, 0.085, 0.074, 0.07)], "spine", "shawl", 10, p=2.4)

    # --- hats, bound to the head
    hat = s.get("hat")
    if hat == "flatcap":
        b.loft([ring(0, 1.692, -0.004, 0.085, 0.097, 0.101), ring(0, 1.738, 0.012, 0.096, 0.118, 0.102),
                ring(0, 1.763, 0.01, 0.074, 0.094, 0.084)], "head", "hat", 10, cap1=(0, 0.008, 0),
               sub=(0.0, 1.0, 0.25, 1.0))
        # peak: a curved plate at the front
        rows = []
        for r_, (dz, dy) in enumerate(((0.0, 0.0), (0.058, -0.016))):
            row = []
            for i in range(5):
                a = math.radians(-60 + 30 * i)
                row.append((math.sin(a) * (0.086 + dz * 0.6), 1.696 + dy - 0.004 * abs(math.sin(a)),
                            math.cos(a) * (0.099 + dz) - 0.004))
            rows.append(row)
        b.strip(rows, "head", "hat", sub=(0.0, 1.0, 0.0, 0.2))
    elif hat == "knitcap":
        b.loft([ring(0, 1.685, -0.006, 0.087, 0.099, 0.103), ring(0, 1.71, -0.006, 0.092, 0.104, 0.108),
                ring(0, 1.718, -0.006, 0.087, 0.099, 0.103), ring(0, 1.757, -0.01, 0.073, 0.084, 0.09),
                ring(0, 1.783, -0.012, 0.034, 0.04, 0.045)], "head", "hat", 10, cap1=(0, 0.006, 0))
    elif hat in ("tophat", "bowler"):
        curl = lambda t: 0.012 * math.sin(t) ** 2  # noqa: E731
        if hat == "tophat":
            hr = [ring(0, 1.698, -0.004, 0.086, 0.099, 0.101), ring(0, 1.71, -0.004, 0.148, 0.162, 0.162, yoff=curl),
                  ring(0, 1.717, -0.004, 0.149, 0.163, 0.163, yoff=curl), ring(0, 1.722, -0.004, 0.087, 0.1, 0.102),
                  ring(0, 1.9, -0.004, 0.092, 0.104, 0.106)]
            b.loft(hr, "head", "hat", 10, cap1=(0, 0.0, 0))
        else:
            hr = [ring(0, 1.694, -0.004, 0.086, 0.099, 0.101), ring(0, 1.703, -0.004, 0.126, 0.14, 0.138, yoff=curl),
                  ring(0, 1.709, -0.004, 0.127, 0.141, 0.139, yoff=curl), ring(0, 1.715, -0.004, 0.087, 0.1, 0.102),
                  ring(0, 1.77, -0.006, 0.086, 0.098, 0.1), ring(0, 1.803, -0.008, 0.052, 0.06, 0.062)]
            b.loft(hr, "head", "hat", 10, cap1=(0, 0.012, 0))
    elif hat == "bonnet":
        # a close black bonnet that frames the face and hangs to the neck at the back
        drop = lambda t: -0.06 * max(0.0, -math.cos(t)) ** 1.5  # noqa: E731
        b.loft([ring(0, 1.53, -0.006, 0.084, 0.086, 0.104, yoff=drop), ring(0, 1.62, -0.004, 0.094, 0.1, 0.108),
                ring(0, 1.7, -0.006, 0.094, 0.1, 0.11), ring(0, 1.755, -0.01, 0.07, 0.078, 0.092),
                ring(0, 1.782, -0.014, 0.03, 0.034, 0.042)], "head", "hat", 8, arc=(62, 298))
    elif hat == "whitecap":
        # fishwife's white cap, a little frill round the face
        b.loft([ring(0, 1.6, -0.012, 0.086, 0.09, 0.1), ring(0, 1.67, -0.006, 0.09, 0.098, 0.106),
                ring(0, 1.73, -0.008, 0.078, 0.088, 0.098), ring(0, 1.772, -0.012, 0.036, 0.042, 0.05)],
               "head", "hat", 8, arc=(55, 305), cap1=None)

    # --- props
    props = s.get("props", [])
    if "pipe" in props:
        # a white clay pipe from the corner of the mouth, out and down
        b.loft([ring(0.026, 1.583, 0.082, 0.005, 0.005), ring(0.07, 1.565, 0.135, 0.005, 0.005)], "head", "prop", 4,
               side=(1, 0, 0), fwd=(0, 1, 0), phase=math.pi / 4, cap1=(0, 0, 0), sub=(0.75, 1.0, 0.0, 1.0))
        b.loft([ring(0.074, 1.552, 0.14, 0.012, 0.012), ring(0.076, 1.592, 0.143, 0.015, 0.015)], "head", "prop", 6,
               cap0=(0, 0, 0), sub=(0.75, 1.0, 0.0, 1.0))
    if "ledger" in props:
        x = -sh - 0.03
        b.loft([ring(x, 0.66, 0.02, 0.018, 0.105), ring(x, 0.95, 0.02, 0.018, 0.105)], "handR", "prop", 4,
               p=12, phase=math.pi / 4, cap0=(0, 0, 0), cap1=(0, 0, 0), sub=(0.5, 0.74, 0.0, 1.0))
    if "basket" in props:
        cx, cy, cz = -0.2, 0.82, 0.13
        b.loft([ring(cx, cy - 0.1, cz, 0.13, 0.09), ring(cx, cy + 0.06, cz, 0.16, 0.115)], "hips", "prop", 8,
               cap0=(0, 0, 0), sub=(0.0, 0.5, 0.0, 0.75))
        # the catch, lying in the basket
        b.loft([ring(cx, cy + 0.035, cz, 0.15, 0.105)], "hips", "prop", 8, cap0=(0, 0.012, 0), sub=(0.0, 0.5, 0.8, 1.0))
        rows = []
        for w in (-0.014, 0.014):
            row = []
            for i in range(7):
                a = math.pi * i / 6
                row.append((cx - math.cos(a) * 0.155, cy + 0.06 + math.sin(a) * 0.17, cz + w))
            rows.append(row)
        b.strip(rows, "hips", "prop", sub=(0.0, 0.5, 0.75, 0.8))


# ---------------------------------------------------------------- painting

class Painter:
    def __init__(self, s, seed):
        self.s = s
        self.rng = np.random.default_rng(seed)
        self.img = np.zeros((TEX, TEX, 3))

    def grain(self, h, w, amt=0.06):
        return 1 + self.rng.normal(0, amt, (h, w, 1))

    def blotch(self, h, w, cell=4, amt=0.1):
        lo = self.rng.normal(0, amt, (h // cell + 2, w // cell + 2))
        up = np.kron(lo, np.ones((cell, cell)))[:h, :w]
        return 1 + up[..., None]

    def cell(self, name, fn):
        x0, y0, w, h = CELLS[name]
        C, R = np.meshgrid(np.arange(w, dtype=float), np.arange(h, dtype=float))
        U = C / (w - 1)
        V = R / (h - 1)
        out = fn(U, V, C, R, w, h)
        self.img[y0:y0 + h, x0:x0 + w] = np.clip(out, 0, 1)

    def cloth(self, col, h, w, amt=0.07, bl=0.08):
        return rgb(col)[None, None, :] * self.grain(h, w, amt) * self.blotch(h, w, 4, bl)


def paint(s, seed):
    P = Painter(s, seed)
    fem = s["female"]
    skin = rgb(s["skin"])
    hair = rgb(s["hair"])

    # ----- head: 64 x 32, column 31.5 is the front, rows 0 (under the jaw) to 31 (crown)
    def head(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)
        out = skin[None, None, :] * P.grain(h, w, 0.035)
        # light from above, darker under the jaw and at the back
        out *= (0.86 + 0.16 * V)[..., None] * (1.0 - 0.1 * (ad / 31.5))[..., None]
        m = lambda cond: cond[..., None]  # noqa: E731

        def put(mask, col, a=1.0):
            nonlocal out
            out = np.where(m(mask), out * (1 - a) + np.asarray(col)[None, None, :] * a, out)

        cheek = (np.abs(ad - 7.5) < 2.5) & (R >= 11) & (R <= 15)
        put(cheek, skin * np.array([1.08, 0.9, 0.86]), 0.6 if not fem else 0.8)
        put((ad < 1) & (R >= 14) & (R <= 18), skin * 1.08, 0.7)            # nose ridge
        put((ad > 1) & (ad < 2.2) & (R >= 14) & (R <= 16), skin * 0.8, 0.8)  # nose sides
        put((ad > 0.9) & (ad < 2.1) & (R == 13), skin * 0.45, 1.0)            # nostrils
        put((ad >= 2.5) & (ad <= 6.5) & (R == 17), skin * 0.82, 1.0)          # under the eyes
        put((ad >= 2.5) & (ad <= 6.5) & (R == 19), skin * 0.7, 1.0)           # lids
        eye = (ad >= 3.4) & (ad <= 5.6) & (R == 18)
        put(eye, np.array([0.66, 0.63, 0.58]), 1.0)
        put((np.abs(ad - 4.5) < 0.6) & (R == 18), np.array([0.1, 0.08, 0.07]), 1.0)
        brow_w = 7.5 if not fem else 6.5
        brow = (ad >= 2.5) & (ad <= brow_w) & (R == 20)
        put(brow, hair * 0.6, 0.9 if s["face"] in ("walrus", "moustache") else 0.7)
        if s["face"] == "walrus":
            put((ad >= 2.5) & (ad <= 7.5) & (R == 21), hair * 0.7, 0.5)
        # mouth
        mouth_w = 2.6 if not fem else 2.2
        lip = np.array([0.5, 0.26, 0.22]) if fem else skin * np.array([0.62, 0.45, 0.42])
        put((ad <= mouth_w) & (R == 9), lip, 1.0)
        put((ad <= mouth_w - 1) & (R == 8), skin * (0.92 if not fem else 1.02) * np.array([1.05, 0.9, 0.88]), 0.8)
        put((ad <= 3) & (R >= 3) & (R <= 5), skin * 1.05, 0.5)                # chin
        # ears
        ear = (np.abs(ad - 15.75) < 1.4) & (R >= 13) & (R <= 19)
        put(ear, skin * np.array([1.0, 0.82, 0.78]), 0.7)
        put((np.abs(ad - 15.75) < 0.6) & (R >= 14) & (R <= 17), skin * 0.7, 0.7)
        # age
        age = s.get("age", 0.3)
        if age > 0.5:
            put((ad <= 5) & ((R == 22) | (R == 24)), skin * 0.84, (age - 0.4))
            put((np.abs(ad - 3.5) < 0.6) & (R >= 10) & (R <= 12), skin * 0.8, age - 0.3)
            put((np.abs(ad - 7.5) < 0.6) & (R >= 18) & (R <= 19), skin * 0.8, age - 0.4)
        # facial hair
        f = s["face"]
        stub = hair * 0.55 + skin * 0.45
        jaw = (R <= 11) & (ad <= 15) & ~((ad <= mouth_w + 0.5) & (R >= 7) & (R <= 10))
        if f in ("stubble", "young_stubble"):
            rnd = P.rng.random((h, w)) < (0.55 if f == "stubble" else 0.35)
            put(jaw & rnd, stub, 0.9)
            put(jaw & ~rnd, stub, 0.35)
        if f == "stubble":
            put((ad <= 4.5) & (R == 10), stub, 0.6)
        if f in ("walrus", "moustache", "chops", "gent"):
            mw = {"walrus": 5.5, "moustache": 4.5, "chops": 4.5, "gent": 5.5}[f]
            if f == "gent":
                # a neat short beard joined to a full moustache
                put(jaw & (R <= 9) & (ad >= mouth_w - 0.5) | (R <= 6) & (ad <= 13), hair * 0.8, 1.0)
                put((ad <= mw) & (R == 10), hair * 0.75, 1.0)
            else:
                put((ad <= mw) & (R >= 10) & (R <= 11), hair * 0.75, 1.0)
            if f == "walrus":
                put((ad <= 5.5) & (ad >= 2.5) & (R == 9), hair * 0.7, 1.0)
                put((ad >= 4.5) & (ad <= 5.5) & (R == 8), hair * 0.7, 1.0)
        if f == "chops":
            put((ad >= 9.5) & (ad <= 14.5) & (R >= 5) & (R <= 16), hair * 0.8, 1.0)
            put((ad >= 5.5) & (ad <= 9.5) & (R >= 7) & (R <= 11), hair * 0.8, 0.8)
        if f == "gent":
            put((ad >= 11.5) & (ad <= 14.5) & (R >= 11) & (R <= 18), hair * 0.9, 1.0)
        # hair: front line, higher at the temples, down to the nape at the back
        line = np.where(ad < 9, 25.0, np.where(ad < 13, 23.0, np.where(ad < 18.5, 20.0, 9.0)))
        if fem:
            line = np.where(ad < 3, 24.0, np.where(ad < 13, 23.0, np.where(ad < 18.5, 17.0, 6.0)))
        hm = R >= line
        hcol = hair[None, None, :] * P.grain(h, w, 0.1) * (0.8 + 0.25 * ((C + R) % 3 == 0))[..., None]
        out = np.where(m(hm), hcol, out)
        if fem:
            put((ad < 0.9) & (R >= 24), hair * 0.55, 1.0)  # middle parting
        if f in ("gent", "chops", "moustache", "walrus"):
            put((ad >= 12.5) & (ad <= 14.5) & (R >= 16) & (R < 20), hair * 0.85, 1.0)  # sideburns
        return out

    P.cell("head", head)

    # ----- neck
    def neck(U, V, C, R, w, h):
        out = skin[None, None, :] * P.grain(h, w, 0.03) * (0.82 + 0.1 * V)[..., None]
        ad = np.abs(C - (w - 1) / 2)
        if s.get("neckerchief"):
            out = np.where((V < 0.55)[..., None], P.cloth(s["neckerchief"], h, w, 0.08), out)
            out = np.where(((V < 0.58) & (V > 0.5))[..., None], out * 0.7, out)
        elif s.get("jersey"):
            out = np.where((V < 0.4)[..., None], P.cloth(s["jersey"], h, w) * (0.9 + 0.2 * (C % 2))[..., None], out)
        elif s.get("dress"):
            out = np.where((V < 0.5)[..., None], rgb(s["collar"])[None, None, :] * P.grain(h, w, 0.04), out)
            out = np.where(((V < 0.2))[..., None], P.cloth(s["dress"], h, w), out)
        elif s.get("cravat"):
            out = np.where((V < 0.55)[..., None], rgb(s["shirt"])[None, None, :] * P.grain(h, w, 0.03), out)
            out = np.where(((V < 0.38) & (ad < 9))[..., None], P.cloth(s["cravat"], h, w), out)
        elif s.get("shirt"):
            out = np.where((V < 0.45)[..., None], rgb(s["shirt"])[None, None, :] * P.grain(h, w, 0.04), out)
        return out

    P.cell("neck", neck)

    # ----- torso: 64 x 32, rows 0 (waist) to 31 (neck base)
    def torso(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)
        th = ad / 31.5 * math.pi  # 0 front, pi back
        m = lambda cond: cond[..., None]  # noqa: E731
        style = s.get("jacket_style")
        if s.get("jersey"):
            out = P.cloth(s["jersey"], h, w, 0.05, 0.05) * (0.85 + 0.2 * (C % 2))[..., None]
            out = np.where(m(R >= 29), out * 0.8, out)
            out = np.where(m((R >= 27) & (R <= 28)), out * 1.15, out)
            out = np.where(m(R <= 1), out * 0.8, out)
        elif s.get("dress"):
            out = P.cloth(s["dress"], h, w, 0.05, 0.06)
            # darts and folds
            out = np.where(m((np.abs(ad - 6.5) < 0.6) & (R < 22)), out * 0.75, out)
            out = np.where(m((ad < 0.7) & (R % 3 == 1) & (R < 29)), rgb(0x3a3a3a)[None, None, :], out)
            if s.get("apron"):
                bib = (ad < 7.5) & (R < 17)
                out = np.where(m(bib), P.cloth(s["apron"], h, w, 0.06), out)
                out = np.where(m(bib & (R == 16)), out * 0.8, out)
                out = np.where(m((np.abs(ad - 7.5) < 0.6) & (R < 22)), out * 0.7, out)  # apron straps
        else:
            shirt = P.cloth(s.get("shirt", 0xb0a898), h, w, 0.04, 0.04)
            out = shirt
            if s.get("vest"):
                vest = P.cloth(s["vest"], h, w, 0.06)
                vopen = (ad < (R - 16) * 0.45) & (R > 16)
                out = np.where(m(~vopen & (R < 30)), vest, out)
                out = np.where(m((ad < 0.7) & (R % 4 == 1) & (R < 16) & (R > 1)), rgb(0x8a8070)[None, None, :], out)
                if s.get("chain"):
                    chain = (np.abs(R - (8 - (ad - 1) * 0.3)) < 0.6) & (ad > 1) & (ad < 9)
                    out = np.where(m(chain), rgb(s["chain"])[None, None, :], out)
            if s.get("cravat"):
                out = np.where(m((ad < 1.5) & (R > 24)), rgb(s["cravat"])[None, None, :] * 1.2, out)
            if s.get("jacket"):
                jc = s["jacket"]
                jk = P.cloth(jc, h, w, 0.07, 0.1)
                if style == "ragged":
                    jk *= P.blotch(h, w, 3, 0.18)
                if style == "open":
                    jopen = ad < 5.5 + np.maximum(0, R - 18) * 0.7
                elif style == "frock":
                    jopen = ad < np.where(R > 14, 2.5 + (R - 14) * 0.8, 2.5)
                elif style == "coat":
                    jopen = (ad < (R - 18) * 0.6) & (R > 18)
                elif style == "pea":
                    jopen = (ad < (R - 24) * 1.1) & (R > 24)
                else:  # ragged
                    jopen = ad < 7.5 + np.maximum(0, R - 20) * 0.5
                out = np.where(m(~jopen), jk, out)
                # lapels: a lighter edge along the opening near the top
                edge = ~jopen & (ad < np.where(R > 14, 9.0 + (R - 14) * 0.9, 0)) & (R > 16)
                out = np.where(m(edge), out * 1.18, out)
                border = ~jopen & np.roll(jopen, 1, axis=1) | ~jopen & np.roll(jopen, -1, axis=1)
                out = np.where(m(border), out * 0.65, out)
                if style == "pea":
                    btn = (np.abs(ad - 5.5) < 0.6) & (R % 5 == 2) & (R < 22)
                    out = np.where(m(btn), rgb(0x3a3e46)[None, None, :] * 1.6, out)
                    out = np.where(m(R >= 29), out * 1.12, out)  # big collar
                if style == "coat":
                    btn = (ad < 0.7) & (R % 5 == 2) & (R < 18)
                    out = np.where(m(btn), rgb(0x2a241c)[None, None, :], out)
                    out = np.where(m((ad < 0.6) & (R < 18)), out * 0.7, out)
                # pocket
                pk = (np.abs(ad - 10.5) < 2.2) & (R == 4)
                out = np.where(m(pk), out * 0.65, out)
                # seams at the sides and the back
                out = np.where(m((np.abs(ad - 16) < 0.6) | (ad > 30.5)), out * 0.8, out)
        # fold shading under the arms, darker at the back
        out *= (1.0 - 0.14 * np.clip(1 - np.abs(ad - 16) / 4, 0, 1) * (V < 0.8))[..., None]
        out *= (0.9 + 0.1 * V)[..., None]
        return out

    P.cell("torso", torso)

    # ----- pelvis: trousers, a belt or braces line
    def pelvis(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)
        out = P.cloth(s.get("trousers", 0x3a3630), h, w)
        out = np.where(((R >= 28))[..., None], out * 0.6, out)
        out = np.where(((ad < 0.7) & (R > 10) & (R < 28))[..., None], out * 0.7, out)
        out *= (0.8 + 0.2 * V)[..., None]
        return out

    P.cell("pelvis", pelvis)

    sleeve = s.get("jacket") or s.get("jersey") or s.get("dress") or s.get("shirt") or 0x6a6458

    def arm_up(U, V, C, R, w, h):
        out = P.cloth(sleeve, h, w)
        if s.get("jersey"):
            out *= (0.85 + 0.2 * (C % 2))[..., None]
        out *= (0.8 + 0.22 * V)[..., None]
        if s.get("jacket_style") == "ragged":
            out = np.where(((np.abs(U - 0.3) < 0.12) & (np.abs(V - 0.3) < 0.15))[..., None], rgb(0x3a3428)[None, None, :], out)
        return out

    P.cell("armUp", arm_up)

    def arm_low(U, V, C, R, w, h):
        out = P.cloth(sleeve, h, w)
        if s.get("jersey"):
            out *= (0.85 + 0.2 * (C % 2))[..., None]
            out = np.where((R < 5)[..., None], out * 0.85, out)
        elif s.get("jacket") and s.get("shirt"):
            out = np.where((R < 3)[..., None], rgb(s["shirt"])[None, None, :] * 0.95, out)
            out = np.where(((R >= 3) & (R < 5))[..., None], out * 0.75, out)
        elif s.get("dress"):
            out = np.where((R < 3)[..., None], rgb(s["collar"])[None, None, :] * 0.9, out)
        out *= (0.85 + 0.18 * V)[..., None]
        return out

    P.cell("armLow", arm_low)

    def hand(U, V, C, R, w, h):
        base = rgb(s["gloves"]) if s.get("gloves") else skin
        out = base[None, None, :] * P.grain(h, w, 0.04)
        out *= (0.8 + 0.25 * V)[..., None]
        # fingers: dark lines on the lower half
        fing = (R < 12) & ((C % 6) == 0)
        out = np.where(fing[..., None], out * 0.7, out)
        out = np.where((R == 12)[..., None], out * 0.85, out)
        return out

    P.cell("hand", hand)

    def leg_up(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)
        out = P.cloth(s.get("trousers", 0x3a3630), h, w)
        out = np.where((ad < 0.7)[..., None], out * 1.12, out)  # crease
        out = np.where((np.abs(ad - 15.5) < 0.6)[..., None], out * 0.8, out)  # outer seam
        out *= (0.84 + 0.16 * V)[..., None]
        if s.get("jacket_style") == "ragged":
            out = np.where(((np.abs(U - 0.5) < 0.1) & (np.abs(V - 0.1) < 0.1))[..., None], out * 1.35, out)
        return out

    P.cell("legUp", leg_up)

    boots = rgb(s.get("boots", 0x2a2018))

    def leg_low(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)
        if fem:
            out = rgb(0x2a2624)[None, None, :] * P.grain(h, w, 0.05)  # dark stockings
            top = 0.42
        else:
            out = P.cloth(s.get("trousers", 0x3a3630), h, w)
            out = np.where((ad < 0.7)[..., None], out * 1.1, out)
            top = 0.16
        bt = boots[None, None, :] * P.grain(h, w, 0.05) * (0.9 + 0.3 * (1 - V / top))[..., None]
        out = np.where((V < top)[..., None], bt, out)
        out = np.where((np.abs(V - top) < 0.03)[..., None], out * 0.7, out)
        if fem:
            out = np.where(((ad < 0.7) & (V < top) & (R % 2 == 0))[..., None], rgb(0x5a5048)[None, None, :], out)  # laces
        out *= (0.8 + 0.2 * V)[..., None]
        return out

    P.cell("legLow", leg_low)

    def foot(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)  # 0 on top of the foot, 15.5 at the sole
        out = boots[None, None, :] * P.grain(h, w, 0.05)
        out *= (1.15 - 0.4 * (ad / 15.5))[..., None]
        out = np.where((ad > 11.5)[..., None], out * 0.45, out)  # sole
        out = np.where(((ad < 2) & (V > 0.2) & (V < 0.5) & (R % 3 == 0))[..., None], out * 1.6, out)  # laces
        out = np.where(((V > 0.85) & (ad < 8))[..., None], out * 1.2, out)  # toe cap shine
        return out

    P.cell("foot", foot)

    # ----- lower garment: rows 0 (hem) to 31 (waist)
    def lower(U, V, C, R, w, h):
        ad = np.abs(C - (w - 1) / 2)
        low = s.get("lower")
        m = lambda cond: cond[..., None]  # noqa: E731
        if low == "skirt":
            out = P.cloth(s["lower_col"], h, w, 0.05, 0.07)
            fold = (C % 6 == 0) | (C % 6 == 1)
            out = np.where(m(fold), out * 0.8, out)
            out = np.where(m(R <= 1), out * 0.7, out)
            out = np.where(m(R >= 30), out * 0.75, out)
            if s.get("apron"):
                ap = (ad < 9.5) & (R >= 5) & (R < 30)
                out = np.where(m(ap), P.cloth(s["apron"], h, w, 0.06, 0.1) * (0.9 + 0.1 * (C % 4 == 0))[..., None], out)
                out = np.where(m((np.abs(ad - 9.5) < 0.6) & (R >= 5) & (R < 30)), out * 0.75, out)
                out = np.where(m(ap & (R == 5)), out * 0.8, out)
                out = np.where(m((R == 30) | (R == 31)), rgb(s["apron"])[None, None, :] * 0.9, out)  # ties
        elif low == "jersey":
            out = P.cloth(s["jersey"], h, w, 0.05, 0.05) * (0.85 + 0.2 * (C % 2))[..., None]
            out = np.where(m(R < 6), out * 0.8, out)
        else:
            col = s.get("jacket", 0x303030)
            out = P.cloth(col, h, w, 0.07, 0.1)
            if s.get("jacket_style") == "ragged":
                out *= P.blotch(h, w, 3, 0.18)
            split = ad < 0.8 if low != "jacket" else ad < 1.5 + V * 4
            if low == "jacket" and s.get("vest"):
                inner = P.cloth(s.get("trousers", 0x3a3630), h, w)
                out = np.where(m(split & (V < 0.7)), inner, out)
                out = np.where(m(split & (V >= 0.7)), P.cloth(s["vest"], h, w), out)
            else:
                out = np.where(m(split), out * 0.55, out)
            if low == "coat":
                out = np.where(m((np.abs(ad - 10.5) < 3) & (R == 22)), out * 0.65, out)  # pocket flaps
                out = np.where(m((ad < 0.7) & (R % 5 == 2) & (R > 20)), rgb(0x2a241c)[None, None, :], out)
                out = np.where(m(ad > 30.5), out * 0.6, out)  # back vent
            if low == "pea":
                btn = (np.abs(ad - 5.5) < 0.6) & (R % 5 == 2) & (R > 12)
                out = np.where(m(btn), rgb(0x3a3e46)[None, None, :] * 1.6, out)
            out = np.where(m(R <= 0), out * 0.7, out)
        out *= (0.82 + 0.18 * V)[..., None]
        return out

    if s.get("lower"):
        P.cell("lower", lower)

    # ----- hat: rows 0-7 the peak (flat cap), 8-31 the crown
    def hat(U, V, C, R, w, h):
        hc = s.get("hat_col", 0x202020)
        kind = s.get("hat")
        ad = np.abs(C - (w - 1) / 2)
        out = P.cloth(hc, h, w, 0.06, 0.06)
        if kind == "flatcap":
            tweed = ((C + R) % 3 == 0) * 0.12 + ((C - R) % 4 == 0) * 0.08
            out *= (0.95 + tweed)[..., None]
            out = np.where((R < 7)[..., None], out * 0.8, out)
            out = np.where((R == 8)[..., None], out * 0.7, out)
        elif kind == "knitcap":
            out *= (0.85 + 0.22 * (C % 2))[..., None]
            out = np.where((R < 11)[..., None], out * 1.1, out)
        elif kind == "tophat":
            out *= (0.9 + 0.3 * (np.abs(ad - 8) < 3))[..., None]  # silk sheen
            band = (R >= 11) & (R <= 13)
            out = np.where(band[..., None], rgb(0x0a0a0a)[None, None, :], out)
        elif kind == "bowler":
            out *= (0.9 + 0.25 * (np.abs(ad - 9) < 3))[..., None]
            out = np.where(((R >= 11) & (R <= 12))[..., None], rgb(0x080808)[None, None, :], out)
        elif kind == "bonnet":
            out = np.where(((R >= 6) & (R <= 8))[..., None], out * 1.8, out)  # ribbon band
            out = np.where(((C <= 1) | (C >= w - 2))[..., None], out * 0.6, out)
        elif kind == "whitecap":
            out = np.where(((C <= 2) | (C >= w - 3))[..., None], out * (0.85 + 0.15 * (R % 2))[..., None], out)  # frill
            out = np.where((R <= 2)[..., None], out * 0.85, out)
        out *= (0.85 + 0.15 * V)[..., None]
        return out

    if s.get("hat"):
        P.cell("hat", hat)

    def shawl(U, V, C, R, w, h):
        out = P.cloth(s["shawl"], h, w, 0.07, 0.06)
        if s.get("shawl_style") == "check":
            chk = (C // 4 + R // 4) % 2
            out *= (0.85 + 0.25 * chk)[..., None]
            out = np.where(((C % 8 == 0) | (R % 8 == 0))[..., None], out * 0.75, out)
        else:
            out *= (0.9 + 0.15 * ((C + R) % 2))[..., None]
        out = np.where((R <= 1)[..., None], out * (0.6 + 0.4 * (C % 2))[..., None], out)  # fringe
        return out

    if s.get("shawl"):
        P.cell("shawl", shawl)

    def prop(U, V, C, R, w, h):
        out = np.zeros((h, w, 3)) + 0.3
        # basket (u 0-0.5): wicker; the catch on top (v 0.8-1)
        wick = rgb(0x7a6040)[None, None, :] * (0.8 + 0.3 * (((C + R) % 3) == 0))[..., None]
        out = np.where((U < 0.5)[..., None], wick, out)
        fish = rgb(0x8a9098)[None, None, :] * (0.75 + 0.4 * ((C % 4) == 1))[..., None]
        out = np.where(((U < 0.5) & (V > 0.8))[..., None], fish, out)
        # ledger (u 0.5-0.74): dark leather, page edges
        led = rgb(0x3a2418)[None, None, :] * P.grain(h, w, 0.06)
        led = np.where(((C % 8 == 1) & (R > 1) & (R < h - 2))[..., None], rgb(0xb8b098)[None, None, :], led)
        out = np.where(((U >= 0.5) & (U < 0.75))[..., None], led, out)
        # pipe (u 0.75-1): white clay, darker at the burnt bowl rim
        clay = rgb(0xb0a894)[None, None, :] * P.grain(h, w, 0.05)
        clay = np.where((R >= h - 3)[..., None], clay * 0.45, clay)
        out = np.where((U >= 0.75)[..., None], clay, out)
        return out

    P.cell("prop", prop)
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


def make_character(s, idx):
    k = s["h"] / 1.74
    J = joints(s)
    arm = bpy.data.armatures.new(s["name"] + "_rig")
    ao = bpy.data.objects.new(s["name"], arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode="EDIT")
    for bn in BONES:
        h0, h1 = J[bn]
        eb = arm.edit_bones.new(bn)
        eb.head = B(*(c * k for c in h0))
        eb.tail = B(*(c * k for c in h1))
        eb.roll = 0.0
    for bn, par in PARENT.items():
        arm.edit_bones[bn].parent = arm.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")

    body = build_body(s)
    me = bpy.data.meshes.new(s["name"] + "_body")
    bmesh.ops.triangulate(body.bm, faces=body.bm.faces[:])
    body.bm.to_mesh(me)
    tris = len(body.bm.faces)
    body.bm.free()
    mo = bpy.data.objects.new(s["name"] + "_body", me)
    bpy.context.scene.collection.objects.link(mo)
    for g in body.groups:
        mo.vertex_groups.new(name=g)
    mo.parent = ao
    mod = mo.modifiers.new("rig", "ARMATURE")
    mod.object = ao
    img = make_image(s["name"] + "_tex", paint(s, 1873 + idx * 7))
    me.materials.append(make_material(s["name"], img))
    for poly in me.polygons:
        poly.use_smooth = False
    return ao, mo, tris


# ---------------------------------------------------------------- animation

FPS = 24


def R_(axis, deg):
    return Quaternion(axis, math.radians(deg))


def RX(d):
    return R_((1, 0, 0), d)


def RY(d):
    return R_((0, 1, 0), d)


def RZ(d):
    return R_((0, 0, 1), d)


def limb(side, fwd=0.0, out=0.0, twist=0.0):
    """Arm/leg rotation in armature space: fwd swings the far end forward,
    out swings it away from the body, twist turns it about its own axis
    (positive = inward)."""
    sg = 1 if side == "L" else -1
    return RX(-fwd) @ RY(-sg * out) @ RZ(-sg * twist)


def arms_hang(pose, t_out=5.0, bend=8.0, fwd=0.0):
    for S in "LR":
        pose["armUp" + S] = limb(S, fwd=fwd, out=t_out)
        pose["armLow" + S] = RX(-bend)
        pose["hand" + S] = RX(-3)


def clasped(pose, extra=0.0):
    """Women: hands folded in front at the waist."""
    for S in "LR":
        pose["armUp" + S] = limb(S, fwd=12 + extra, out=4, twist=28)
        pose["armLow" + S] = RX(-78)
        pose["hand" + S] = RX(-8)


def pose_idle(t, fem=False):
    p = 2 * math.pi * t
    pose = {}
    breathe = math.sin(p * 2)
    pose["hips"] = RY(1.0 * math.sin(p))
    pose["spine"] = RX(1.5 + 0.8 * breathe) @ RY(-0.6 * math.sin(p))
    pose["neck"] = RX(-1)
    pose["head"] = RZ(5 * math.sin(p) * (math.sin(p * 0.5) ** 2)) @ RX(1.5 * math.sin(p * 3))
    if fem:
        clasped(pose, 1.0 * breathe)
    else:
        arms_hang(pose, t_out=5 + 0.6 * breathe, bend=8 + 1.5 * breathe)
    for S in "LR":
        pose["legUp" + S] = RY(-1.0 * math.sin(p))
    return pose


def pose_walk(t, fem=False, carry=False):
    p = 2 * math.pi * t
    pose = {}
    sw = 17 if fem else 22
    c = math.cos(p)
    s = math.sin(p)
    pose["hips"] = RZ(-4 * c) @ RY(1.5 * math.sin(2 * p))
    pose["spine"] = RX(3) @ RZ(7 * c)
    pose["neck"] = RZ(-2 * c)
    pose["head"] = RZ(-1 * c) @ RX(-2)
    for S, sg in (("L", 1), ("R", -1)):
        f = sw * c * sg
        ph = s * sg
        bend = 6 + 45 * max(0.0, -ph) ** 1.2 + 8 * max(0.0, ph)
        toe = 12 * max(0.0, c * sg)
        pose["legUp" + S] = RX(-f)
        pose["legLow" + S] = RX(bend)
        pose["foot" + S] = RX(f - bend - toe)
        if carry:
            pose["armUp" + S] = limb(S, fwd=18, out=14, twist=10)
            pose["armLow" + S] = RX(-62)
            pose["hand" + S] = RX(-10)
        elif fem:
            pose["armUp" + S] = limb(S, fwd=-10 * sg * c + 4, out=5)
            pose["armLow" + S] = RX(-(14 + 8 * max(0.0, -c * sg)))
            pose["hand" + S] = RX(-4)
        else:
            pose["armUp" + S] = limb(S, fwd=-18 * sg * c, out=5)
            pose["armLow" + S] = RX(-(12 + 18 * max(0.0, -c * sg)))
            pose["hand" + S] = RX(-4)
    return pose


def pose_talk(t, fem=False):
    p = 2 * math.pi * t
    pose = pose_idle(t, fem)
    g = math.sin(p * 2)
    pose["head"] = RX(3 * math.sin(p * 3)) @ RZ(4 * math.sin(p))
    pose["spine"] = RX(2) @ RZ(3 * math.sin(p))
    pose["armUpR"] = limb("R", fwd=12 + 5 * g, out=9, twist=14)
    pose["armLowR"] = RX(-(58 + 12 * math.sin(p * 2 + 0.6)))
    pose["handR"] = RX(-(6 + 14 * math.sin(p * 4))) @ RZ(-25)
    if not fem:
        pose["armUpL"] = limb("L", fwd=4, out=6)
        pose["armLowL"] = RX(-(14 + 6 * math.sin(p)))
    return pose


def pose_fold(t, fem=False):
    """Arms folded across the chest: a man who watches."""
    p = 2 * math.pi * t
    pose = pose_idle(t, fem)
    b = math.sin(p * 2)
    pose["spine"] = RX(-2 + 0.8 * b)
    pose["head"] = RZ(6 * math.sin(p)) @ RX(3)
    for S, lift in (("L", 0.0), ("R", 4.0)):
        pose["armUp" + S] = limb(S, fwd=24 + lift, out=10, twist=52)
        pose["armLow" + S] = RX(-(100 + lift))
        pose["hand" + S] = RX(-10)
    return pose


CLIPS = [
    ("idle", pose_idle, 4.0, dict()),
    ("walk", pose_walk, 1.0, dict()),
    ("talk", pose_talk, 3.0, dict()),
    ("fold", pose_fold, 4.0, dict()),
    ("carry", pose_walk, 1.0, dict(carry=True)),
    ("idle_f", pose_idle, 4.0, dict(fem=True)),
    ("walk_f", pose_walk, 1.0, dict(fem=True)),
    ("talk_f", pose_talk, 3.0, dict(fem=True)),
]


def make_actions(ao):
    """Key every clip on armature ao and park each in its own NLA track."""
    ad = ao.animation_data_create()
    bones = ao.data.bones
    rest = {bn: bones[bn].matrix_local.to_quaternion() for bn in BONES}
    for pb in ao.pose.bones:
        pb.rotation_mode = "QUATERNION"
    actions = []
    for name, fn, secs, kw in CLIPS:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        frames = int(round(secs * FPS))
        step = 2 if secs <= 1.0 else 4
        for f in list(range(0, frames, step)) + [frames]:
            t = (f % frames) / frames
            pose = fn(t, **kw)
            for bn in BONES:
                q = pose.get(bn, Quaternion())
                local = rest[bn].inverted() @ q @ rest[bn]
                pb = ao.pose.bones[bn]
                pb.rotation_quaternion = local
                pb.keyframe_insert("rotation_quaternion", frame=f + 1)
        actions.append(act)
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        st.name = name
        tr.mute = True
        ad.action = None
    for pb in ao.pose.bones:
        pb.rotation_quaternion = Quaternion()
    return actions


# ---------------------------------------------------------------- preview

def preview(chars, actions):
    scn = bpy.context.scene
    idle = {a.name: a for a in actions}
    for i, (ao, mo, s) in enumerate(chars):
        ao.location = B(i * 0.9 - (len(chars) - 1) * 0.45, 0, 0)
        ad = ao.animation_data_create()
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        want = "idle_f" if s["female"] else "idle"
        if s["name"] == "foreman":
            want = "fold"
        if s["name"] == "thief":
            want = "walk"
        if s["name"] == "tuur":
            want = "talk"
        ad.action = idle[want]
        try:
            if ad.action_slot is None and len(idle[want].slots):
                ad.action_slot = idle[want].slots[0]
        except AttributeError:
            pass
    scn.frame_set(7)
    scn.render.engine = "BLENDER_WORKBENCH"
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "TEXTURE"
    scn.display.shading.show_backface_culling = False
    scn.display.shading.show_specular_highlight = False
    scn.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    scn.world = world
    scn.display.shading.background_type = "VIEWPORT" if hasattr(scn.display.shading, "background_type") else None
    scn.render.film_transparent = False
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    os.makedirs(SHOTS, exist_ok=True)

    def shoot(path, loc, look, lens, w, h):
        cam.location = loc
        d = look - loc
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = lens
        scn.render.resolution_x = w
        scn.render.resolution_y = h
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)

    shoot(os.path.join(SHOTS, "people_preview.png"), B(1.2, 1.25, 6.6), B(0.0, 0.9, 0), 32, 1800, 700)
    shoot(os.path.join(SHOTS, "people_back.png"), B(-1.6, 1.4, -6.4), B(0.0, 0.9, 0), 32, 1800, 700)
    # faces: close to the middle three
    for i, (ao, mo, s) in enumerate(chars):
        ao.location = B(i * 0.3 - (len(chars) - 1) * 0.15, 0, 0)
    shoot(os.path.join(SHOTS, "people_faces.png"), B(0.25, 1.68, 1.9), B(0.0, 1.62, 0), 50, 1800, 500)


# ---------------------------------------------------------------- main

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    chars = []
    report = []
    for i, s in enumerate(PEOPLE):
        ao, mo, tris = make_character(s, i)
        chars.append((ao, mo, s))
        report.append(f"{s['name']} {tris}")
    actions = make_actions(chars[0][0])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_skins=True, export_animations=True,
                              export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="AUTO",
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    print(f"[build_people] {', '.join(report)} triangles; clips {', '.join(a.name for a in actions)} -> {OUT} "
          f"({os.path.getsize(OUT) // 1024} KB)")
    if PREVIEW:
        preview(chars, actions)


if __name__ == "__main__":
    main()
