"""Build the people of Scheldemist in Blender and export them for the game.

    blender -b --factory-startup -P tools/blender/build_people.py [-- --preview] [--cast] [--out PATH]

Writes client/public/models/people.glb: one rigged, textured character per
kind. The named cast (sooi, peeters, tuur, fientje, sailor, stranger, thief,
foreman, recipient) and the townspeople of the crowd (crowd.ts): dockers,
a porter with a sack truck, a carter with a handcart, fishwives, a maid,
street children, a gentleman, a priest, a police agent, a sailor in oilskins.
PS1-era people: lofted rings, 600 to 1000 triangles each, one 128x128 texture per character painted
here in code (our own work, nothing downloaded). Children are the same body
at a smaller scale with a bigger head (hs).

Two base bodies (male, female) share one skeleton layout and one set of bone
names. Every bone points straight along an axis with roll 0, so the rest
rotations match across characters and one set of clips drives them all. The
clips are keyed on the first character only and hold rotations only; the game
strips the "_1", "_2" suffixes that the glTF loader adds to repeated bone names.

Clips: idle, walk, talk, fold (arms folded), carry (walk holding something),
and idle_f, talk_f, walk_f for the women (hands folded in front). For the
crowd: sit (men, on a crate or bench; the game lowers the body), walk_sack and
idle_sack (a sack held on the left shoulder), push and push_idle (the porter
behind his sack truck, the carter behind his handcart), behind (hands behind
the back, looking out over the water) and lean (forearms on a rail).

Coordinates: we build in game space (x = the character's left, y up, z forward,
the character faces +z). B() turns that into Blender space (Z up); the glTF
export turns it back to Y up.

--preview also renders data/shots/people_preview.png and people_faces.png.
--cast renders the crowd: data/shots/crowd_cast.png (front), crowd_cast_back.png,
crowd_cast_faces.png and crowd_poses.png (push, sack, sit, carry, behind, lean, walks).
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
OUT = os.path.join(ROOT, "client", "public", "models", "people.glb")
if "--out" in sys.argv:
    OUT = os.path.abspath(sys.argv[sys.argv.index("--out") + 1])
SHOTS = os.path.join(ROOT, "data", "shots")
PREVIEW = "--preview" in sys.argv
CAST = "--cast" in sys.argv

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

HEAD_PIVOT = 1.525  # the jaw line: a child's bigger head grows up and out from here

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

    # ---- the crowd (crowd.ts): townspeople nobody names
    # dockers: a jacket and a red neckerchief; a blue Flemish smock; shirt sleeves rolled
    dict(MALE, name="docker_a", h=1.76, sh=0.212, skin=0xa8745a, hair=0x3a2e26, face="stubble", age=0.45,
         shirt=0x9a9486, jacket=0x4e4a40, jacket_style="open", trousers=0x4a4032, boots=0x2a2018,
         hat="flatcap", hat_col=0x3a342c, lower="jacket", neckerchief=0x7a2a22),
    dict(MALE, name="docker_b", h=1.72, sh=0.21, cl=0.016, skin=0xb48268, hair=0x6a5a48, face="chops", age=0.55,
         smock=0x3a4a62, trousers=0x3e3a30, boots=0x241a12, hat="flatcap", hat_col=0x222220, lower="smock",
         neckerchief=0x2e2c2a),
    dict(MALE, name="docker_c", h=1.79, sh=0.214, skin=0x9c6850, hair=0x2a221c, face="young_stubble", age=0.3,
         shirt=0xa8a090, vest=0x3a3228, rolled=True, trousers=0x4a4236, boots=0x2a1e14,
         hat="knitcap", hat_col=0x4a4640),
    # a sack on the left shoulder, held with the left hand (clips walk_sack, idle_sack)
    dict(MALE, name="docker_sack", h=1.74, sh=0.212, skin=0xb07a5e, hair=0x4a3a2a, face="moustache", age=0.4,
         jersey=0x4a3e34, rolled=True, trousers=0x3a342c, boots=0x221a12, hat="flatcap", hat_col=0x2e2a26,
         lower="jersey", props=["sack_shoulder"]),
    # a porter with his sack truck and a brass badge on the cap (clips push, push_idle)
    dict(MALE, name="porter", h=1.70, sh=0.208, belly=0.02, skin=0xb8886c, hair=0x7a7470, face="walrus", age=0.7,
         shirt=0xb0a898, vest=0x5a4a3a, jacket=0x3a3a34, jacket_style="open", trousers=0x36322c, boots=0x1e1812,
         hat="flatcap", hat_col=0x2a2a28, badge=True, lower="jacket", props=["sacktruck"]),
    # fishwives: white cap and a striped skirt; a headscarf, older, the basket on the other hip
    dict(FEMALE, name="fishwife_a", h=1.62, sh=0.184, skin=0xc4907a, hair=0x6a4a30, face="woman", age=0.5,
         dress=0x3a4a52, collar=0xc8c0b0, hat="whitecap", hat_col=0xd4cec0, lower="skirt", lower_col=0x6a2a24,
         skirt_stripe=0x9a8a78, apron=0x8a7a60, shawl=0x5a4a3a, shawl_style="check", boots=0x2a1e16,
         props=["basket"]),
    dict(FEMALE, name="fishwife_b", h=1.58, sh=0.186, skin=0xb88a74, hair=0x9a948c, face="widow", age=0.75,
         dress=0x2a2826, collar=0xa8a498, hat="kerchief", hat_col=0x6a2e2a, lower="skirt", lower_col=0x2e3a30,
         apron=0x9aa0a0, shawl=0x3a3a44, shawl_style="plain", boots=0x1e1814, props=["basket"], basket_side=1),
    # a maid on an errand: dark dress, white cap and apron, a basket under a cloth
    dict(FEMALE, name="maid", h=1.60, sh=0.176, skin=0xd0a894, hair=0x3a2a1e, face="woman", age=0.1,
         dress=0x262a36, collar=0xe0dcd0, hat="whitecap", hat_col=0xe4e0d6, lower="skirt", lower_col=0x262a36,
         apron=0xd4d0c4, boots=0x141210, props=["basket"], basket_fill="cloth"),
    # street children: small bodies, big heads; the boy is barefoot
    dict(MALE, name="boy", h=1.30, hs=1.22, sh=0.19, skin=0xc09078, hair=0x6a4a2a, face="clean", age=0.0,
         shirt=0x8a8274, jacket=0x4a4034, jacket_style="ragged", trousers=0x3a3630, barefoot=True,
         boots=0x9a7058, hat="flatcap", hat_col=0x3a3a36, lower="jacket"),
    dict(FEMALE, name="girl", h=1.24, hs=1.22, sh=0.17, skin=0xc89a80, hair=0x8a5a30, face="woman", age=0.0,
         dress=0x6a5a3a, collar=0xb0a890, lower="skirt", lower_col=0x5a4a32, hem=0.2, shawl=0x5a3a3a,
         shawl_style="plain", boots=0x2a1e16),
    # a gentleman: bowler, frock coat, checked trousers, a cane
    dict(MALE, name="gentleman", h=1.78, sh=0.205, belly=0.03, skin=0xc8a48e, hair=0x9a9690, face="chops", age=0.7,
         shirt=0xd8d4c8, vest=0x5a4a34, jacket=0x3a3630, jacket_style="frock", trousers=0x6a665c, trouser_check=True,
         boots=0x100e0c, hat="bowler", hat_col=0x1a1816, lower="coat", gloves=0x5a4a3a, chain=0xb08a3a,
         cravat=0x3a1e1e, props=["cane"]),
    # a priest in a cassock with a wide round hat and a breviary
    dict(MALE, name="priest", h=1.73, sh=0.2, skin=0xc8a08c, hair=0x5a5654, face="clean", age=0.55,
         cassock=0x141416, trousers=0x141416, boots=0x0c0c0c, hat="wide", hat_col=0x121214, lower="cassock",
         roman=True, props=["book"]),
    # a police agent: dark blue tunic buttoned to the neck, belt, kepi, sabre
    dict(MALE, name="police", h=1.81, sh=0.214, skin=0xb8886e, hair=0x2a2420, face="moustache", age=0.45,
         tunic=0x1e2638, trousers=0x1a1e28, boots=0x0e0e10, hat="kepi", hat_col=0x1c2232, lower="tunic",
         stand_collar=0x2e3a56, props=["sabre"]),
    # a carter pushing a two-wheeled handcart with a crate and a keg (clips push, push_idle)
    dict(MALE, name="carter", h=1.75, sh=0.212, skin=0xa87058, hair=0x3a2c22, face="stubble", age=0.5,
         jersey=0x3a3a30, rolled=True, trousers=0x44403a, boots=0x241a12, hat="flatcap", hat_col=0x4a4238,
         lower="jersey", neckerchief=0x6a5a3a, props=["handcart"]),
    # a sailor in oilskins and a sou'wester
    dict(MALE, name="sailor_b", h=1.76, sh=0.21, skin=0xa06a50, hair=0x8a6a40, face="stubble", age=0.5,
         oilskin=0x6a5a2e, trousers=0x2a2e36, boots=0x1a1612, hat="souwester", hat_col=0x6a5a2e, lower="oilskin"),
]


# ---------------------------------------------------------------- mesh builder

class Body:
    """One character mesh: lofted parts, each rigidly bound to one bone."""

    def __init__(self, k, hs=1.0):
        self.k = k
        self.hs = hs  # head scale about the jaw (children)
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.dl = self.bm.verts.layers.deform.verify()
        self.groups = []

    def gi(self, bone):
        if bone not in self.groups:
            self.groups.append(bone)
        return self.groups.index(bone)

    def vert(self, p, bone):
        if bone == "head" and self.hs != 1.0:
            p = (p[0] * self.hs, HEAD_PIVOT + (p[1] - HEAD_PIVOT) * self.hs, p[2] * self.hs)
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

OUTER = ("jacket", "smock", "tunic", "oilskin", "cassock")


def outer(s):
    """The colour of the outer garment over the shirt, or None."""
    for key in OUTER:
        if s.get(key):
            return s[key]
    return None


def build_body(s):
    k = s["h"] / 1.74
    b = Body(k, s.get("hs", 1.0))
    fem = s["female"]
    sh = s["sh"]
    cl = s["cl"]
    belly = s["belly"]
    long_skirt = s.get("lower") in ("skirt", "cassock")
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
        sl = cl + (0.004 if outer(s) else 0.0)
        b.loft([ring(x, 1.12, 0, 0.042 + sl, 0.045 + sl), ring(x, 1.3, 0, 0.05 + sl, 0.053 + sl),
                ring(x, 1.41, -0.005, 0.055 + sl, 0.058 + sl)],
               "armUp" + S, "armUp", 6, cap0=(0, -0.012, 0), cap1=(0, 0.018, 0))
        cuff = 0.038 if (outer(s) or s.get("dress") or s.get("jersey")) else 0.032
        if s.get("rolled"):
            cuff = 0.031  # bare forearm
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
        hem = s.get("hem", 0.03)
        f = (hem - 0.03) / 0.42  # a shorter skirt (a girl's) starts higher up the bell
        b.loft([ring(0, hem, 0.01, 0.29 - 0.05 * f, 0.27 - 0.055 * f, 0.3 - 0.06 * f),
                ring(0, max(0.45, hem + 0.15), 0.005, 0.24, 0.215, 0.24),
                ring(0, 0.84, 0.0, 0.19, 0.155, 0.175),
                ring(0, 1.03, 0.0, 0.134, 0.096, 0.094)], "hips", "lower", 10, p=2.2)
    elif low == "smock":
        # the Flemish blue smock (kiel): loose, to mid-thigh
        b.loft([ring(0, 0.64, 0.006, 0.212, 0.165, 0.16), ring(0, 0.84, 0.004, 0.19, 0.138, 0.132),
                ring(0, 1.04, 0.0, 0.165 + s["belly"] * 0.4, 0.118 + s["belly"], 0.11)], "hips", "lower", 10, p=2.3)
    elif low in ("tunic", "oilskin"):
        y0 = 0.76 if low == "tunic" else 0.68
        b.loft([ring(0, y0, 0.004, 0.182, 0.13, 0.126), ring(0, 0.92, 0.002, 0.172, 0.122, 0.117),
                ring(0, 1.04, 0.0, 0.158, 0.112, 0.106)], "hips", "lower", 10, p=2.4)
    elif low == "cassock":
        # to the ankles; the legs swing inside it like under a skirt
        b.loft([ring(0, 0.07, 0.012, 0.23, 0.215, 0.235), ring(0, 0.45, 0.006, 0.2, 0.172, 0.18),
                ring(0, 0.84, 0.0, 0.178, 0.132, 0.13), ring(0, 1.04, 0.0, 0.16, 0.114, 0.108)], "hips", "lower", 10, p=2.3)

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
    elif hat in ("bonnet", "kerchief"):
        # a close black bonnet that frames the face and hangs to the neck at the back;
        # the headscarf is the same shape in cloth, with a knot at the nape
        drop = lambda t: -0.06 * max(0.0, -math.cos(t)) ** 1.5  # noqa: E731
        b.loft([ring(0, 1.53, -0.006, 0.084, 0.086, 0.104, yoff=drop), ring(0, 1.62, -0.004, 0.094, 0.1, 0.108),
                ring(0, 1.7, -0.006, 0.094, 0.1, 0.11), ring(0, 1.755, -0.01, 0.07, 0.078, 0.092),
                ring(0, 1.782, -0.014, 0.03, 0.034, 0.042)], "head", "hat", 8, arc=(62, 298))
        if hat == "kerchief":
            b.loft([ring(0, 1.55, -0.11, 0.03, 0.02), ring(0, 1.5, -0.125, 0.022, 0.014)], "head", "hat", 4,
                   cap0=(0, 0.01, 0.01), cap1=(0, -0.02, -0.01), sub=(0.0, 1.0, 0.0, 0.2))
    elif hat == "kepi":
        # the police kepi: a stiff drum, the flat top sloping down to the front, a short peak
        slope = lambda t: -0.02 * math.cos(t)  # noqa: E731
        b.loft([ring(0, 1.688, -0.006, 0.088, 0.1, 0.104), ring(0, 1.742, -0.01, 0.086, 0.096, 0.098),
                ring(0, 1.8, -0.014, 0.08, 0.088, 0.09, yoff=slope)], "head", "hat", 10, cap1=(0, -0.003, 0),
               sub=(0.0, 1.0, 0.25, 1.0))
        rows = []
        for dz, dy in ((0.0, 0.0), (0.05, -0.022)):
            row = []
            for i in range(5):
                a = math.radians(-56 + 28 * i)
                row.append((math.sin(a) * (0.088 + dz * 0.5), 1.694 + dy, math.cos(a) * (0.1 + dz) - 0.006))
            rows.append(row)
        b.strip(rows, "head", "hat", sub=(0.0, 1.0, 0.0, 0.2))
    elif hat == "wide":
        # the priest's round hat: a wide flat brim, a low round crown
        hr = [ring(0, 1.692, -0.004, 0.086, 0.099, 0.101), ring(0, 1.7, -0.004, 0.2, 0.21, 0.21),
              ring(0, 1.707, -0.004, 0.2, 0.21, 0.21), ring(0, 1.712, -0.004, 0.087, 0.1, 0.102),
              ring(0, 1.765, -0.006, 0.083, 0.095, 0.098), ring(0, 1.795, -0.008, 0.048, 0.056, 0.058)]
        b.loft(hr, "head", "hat", 10, cap1=(0, 0.008, 0))
    elif hat == "souwester":
        # oilskin sou'wester: a round crown, the brim sloping down and long at the back
        b.loft([ring(0, 1.672, -0.008, 0.09, 0.102, 0.108), ring(0, 1.74, -0.01, 0.088, 0.098, 0.102),
                ring(0, 1.79, -0.012, 0.06, 0.068, 0.072)], "head", "hat", 10, cap1=(0, 0.012, 0),
               sub=(0.0, 1.0, 0.25, 1.0))
        back = lambda t: -0.05 * max(0.0, -math.cos(t)) ** 1.3  # noqa: E731
        b.loft([ring(0, 1.676, -0.008, 0.092, 0.104, 0.11), ring(0, 1.648, -0.03, 0.15, 0.15, 0.21, yoff=back)],
               "head", "hat", 10, sub=(0.0, 1.0, 0.0, 0.2))
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
    if "book" in props:
        # a small black breviary in the right hand
        x = -sh - 0.028
        b.loft([ring(x, 0.72, 0.02, 0.016, 0.062), ring(x, 0.88, 0.02, 0.016, 0.062)], "handR", "prop", 4,
               p=12, phase=math.pi / 4, cap0=(0, 0, 0), cap1=(0, 0, 0), sub=(0.5, 0.74, 0.0, 1.0))
    if "cane" in props:
        x = -sh - 0.004
        b.loft([ring(x, 0.02, 0.06, 0.011, 0.011), ring(x, 0.8, 0.012, 0.011, 0.011)], "handR", "prop", 4,
               phase=math.pi / 4, cap0=(0, -0.005, 0), sub=(0.5, 0.74, 0.0, 1.0))
        b.loft([ring(x, 0.8, 0.012, 0.018, 0.018), ring(x, 0.86, 0.01, 0.02, 0.02)], "handR", "prop", 4,
               phase=math.pi / 4, cap1=(0, 0.012, 0), sub=(0.76, 1.0, 0.0, 1.0))
    if "sabre" in props:
        # a sabre in its scabbard on the left hip, the hilt forward
        b.loft([ring(0.195, 0.93, -0.03, 0.012, 0.022), ring(0.23, 0.3, -0.2, 0.01, 0.018)], "hips", "prop", 4,
               phase=math.pi / 4, cap1=(0, -0.01, -0.004), sub=(0.5, 0.74, 0.0, 1.0))
        b.loft([ring(0.19, 0.93, -0.03, 0.02, 0.024), ring(0.18, 1.0, 0.0, 0.014, 0.03)], "hips", "prop", 4,
               phase=math.pi / 4, cap1=(0, 0.01, 0.01), sub=(0.76, 1.0, 0.0, 1.0))
    if "sack_shoulder" in props:
        # a full grain sack lying front to back over the left shoulder
        x = sh + 0.01
        rs = [ring(x, y, z, r, r * 0.78) for z, y, r in
              ((-0.31, 1.47, 0.05), (-0.25, 1.52, 0.1), (-0.08, 1.575, 0.118), (0.1, 1.565, 0.115),
               (0.22, 1.52, 0.095), (0.28, 1.49, 0.045))]
        b.loft(rs, "spine", "prop", 8, side=(1, 0, 0), fwd=(0, 1, 0), cap0=(0, 0, -0.012), cap1=(0, 0, 0.012),
               sub=(0.0, 0.5, 0.0, 1.0))
    if "sacktruck" in props:
        sack_truck(b, s)
    if "handcart" in props:
        hand_cart(b, s)
    if "basket" in props:
        cx, cy, cz = 0.2 * s.get("basket_side", -1), 0.82, 0.13
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


def fk_point(pose, J, bone, p):
    """Where a point p (game space, rest pose) bound to `bone` ends up in `pose`.
    The clips hold rotations in armature axes, each relative to the parent, so
    the deformation of a bone is its parent's times its own; heads ride along."""
    chain = []
    bn = bone
    while bn:
        chain.append(bn)
        bn = PARENT.get(bn)
    chain.reverse()
    D = Quaternion()
    head = B(*J[chain[0]][0])
    prev = head.copy()
    for i, bn in enumerate(chain):
        rest = B(*J[bn][0])
        if i:
            head = head + D @ (rest - prev)
        D = D @ pose.get(bn, Quaternion())
        prev = rest
    P = head + D @ (B(*p) - prev)
    return Vector((P.x, P.z, -P.y))


def sack_truck(b, s):
    """A two-wheeled sack truck tipped back, its handles where the push clip puts
    the hands, its nose and wheels on the ground in front. Bound to the hips."""
    J = joints(s)
    pose = pose_push(0.25, rest=True)
    sh = s["sh"]
    gL = fk_point(pose, J, "handL", (sh, 0.78, 0.0))
    gR = fk_point(pose, J, "handR", (-sh, 0.78, 0.0))
    w = (gL.x - gR.x) / 2 - 0.01
    gy = (gL.y + gR.y) / 2
    gz = (gL.z + gR.z) / 2
    L = 1.2
    nz = gz + math.sqrt(max(0.1, L * L - (gy - 0.04) ** 2))
    top = Vector((0, gy + 0.04, gz - 0.05))
    nose = Vector((0, 0.04, nz))
    d = (top - nose).normalized()
    n = Vector((0, -d.z, d.y))  # up and forward, off the frame
    WOOD = (0.5, 0.74, 0.0, 1.0)
    IRON = (0.76, 1.0, 0.0, 1.0)
    for x in (-w, w):
        b.loft([ring(x, nose.y, nose.z, 0.018, 0.018), ring(x, top.y, top.z, 0.016, 0.016)], "hips", "prop", 4,
               phase=math.pi / 4, cap1=(0, 0, 0), sub=WOOD)
    for f in (0.45,):
        c = nose + (top - nose) * f - n * 0.01
        b.loft([ring(-w, c.y, c.z, 0.012, 0.012), ring(w, c.y, c.z, 0.012, 0.012)], "hips", "prop", 4,
               side=(0, 0, 1), fwd=(0, 1, 0), phase=math.pi / 4, sub=WOOD)
    # iron nose plate on the ground
    b.strip([[(-w - 0.02, 0.03, nz - 0.02), (w + 0.02, 0.03, nz - 0.02)],
             [(-w - 0.02, 0.03, nz + 0.16), (w + 0.02, 0.03, nz + 0.16)]], "hips", "prop", sub=IRON)
    # wheels, just behind the nose
    az = nz - 0.1
    for sg in (-1, 1):
        x0, x1 = sg * (w + 0.03), sg * (w + 0.075)
        b.loft([ring(x0, 0.15, az, 0.15, 0.15), ring(x1, 0.15, az, 0.15, 0.15)], "hips", "prop", 6,
               side=(0, 0, 1), fwd=(0, 1, 0), cap0=(0, 0, 0), cap1=(0, 0, 0), sub=IRON)
    # the sack, leaning on the frame
    rs = []
    for f, r in ((0.04, 0.09), (0.18, 0.16), (0.5, 0.16), (0.64, 0.08)):
        c = nose + (top - nose) * f + n * (0.11 + 0.04 * min(1.0, r / 0.15))
        rs.append(ring(0, c.y, c.z, r * 1.05, r * 0.72))
    b.loft(rs, "hips", "prop", 6, side=(1, 0, 0), fwd=tuple(n), cap0=(0, 0, 0), cap1=(0, 0, 0),
           sub=(0.0, 0.5, 0.0, 1.0))


def hand_cart(b, s):
    """A carter's two-wheeled handcart pushed from behind: shafts from the hands,
    a flat bed over big spoked wheels, a crate and a keg on it. Bound to the hips."""
    J = joints(s)
    pose = pose_push(0.25, rest=True)
    sh = s["sh"]
    gL = fk_point(pose, J, "handL", (sh, 0.78, 0.0))
    gR = fk_point(pose, J, "handR", (-sh, 0.78, 0.0))
    w = (gL.x - gR.x) / 2 - 0.01
    gy = (gL.y + gR.y) / 2
    gz = (gL.z + gR.z) / 2
    WOOD = (0.5, 0.74, 0.0, 1.0)
    bed_y, z0, z1 = 0.62, gz + 0.4, gz + 1.55
    for x in (-w, w):
        b.loft([ring(x, gy + 0.01, gz - 0.1, 0.017, 0.017), ring(x, bed_y, z0, 0.02, 0.02), ring(x, bed_y, z1, 0.02, 0.02)],
               "hips", "prop", 4, phase=math.pi / 4, cap0=(0, 0, 0), sub=WOOD)
    # the bed: a flat box of planks
    b.loft([ring(0, bed_y + 0.03, z0, 0.4, 0.03), ring(0, bed_y + 0.03, z1, 0.4, 0.03)], "hips", "prop", 4,
           side=(1, 0, 0), fwd=(0, 1, 0), p=12, phase=math.pi / 4, cap0=(0, 0, 0), cap1=(0, 0, 0), sub=WOOD)
    # wheels: rim to hub, painted with spokes (u 0-0.5 of the prop strip)
    az = (z0 + z1) / 2
    for sg in (-1, 1):
        x = sg * 0.46
        b.loft([ring(x, 0.37, az, 0.37, 0.37), ring(x - sg * 0.015, 0.37, az, 0.07, 0.07)], "hips", "prop", 8,
               side=(0, 0, 1), fwd=(0, 1, 0), cap1=(-sg * 0.02, 0, 0), sub=(0.0, 0.5, 0.0, 1.0))
    # the load: a crate at the back, a keg in front
    top = bed_y + 0.06
    b.loft([ring(0.02, top, gz + 0.72, 0.24, 0.22), ring(0.02, top + 0.42, gz + 0.72, 0.24, 0.22)], "hips", "prop", 4,
           p=12, phase=math.pi / 4, cap1=(0, 0, 0), sub=WOOD)
    b.loft([ring(-0.05, top, gz + 1.25, 0.15, 0.15), ring(-0.05, top + 0.2, gz + 1.25, 0.18, 0.18),
            ring(-0.05, top + 0.4, gz + 1.25, 0.15, 0.15)], "hips", "prop", 8, cap1=(0, 0, 0), sub=(0.76, 1.0, 0.0, 1.0))


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

    def sheen(self, h, w):
        """Wet oilskin: light streaks that run down the cloth."""
        cols = self.rng.random(w) < 0.22
        run = (self.rng.random((h, 1)) < 0.8)
        return 1 + 0.35 * (cols[None, :] & run)[..., None]

    def check(self, h, w):
        """A small check for gentlemen's trousers."""
        C, R = np.meshgrid(np.arange(w), np.arange(h))
        return 1 + (0.1 * (((C // 3) + (R // 3)) % 2) - 0.12 * ((C % 6 == 0) | (R % 6 == 0)))[..., None]


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
        if s.get("roman"):
            # black stock up the throat, a white tab at the front
            out = np.where((V < 0.6)[..., None], P.cloth(s["cassock"], h, w, 0.04), out)
            out = np.where(((V > 0.4) & (V < 0.58) & (ad < 3.5))[..., None], rgb(0xe8e6de)[None, None, :], out)
        elif s.get("stand_collar"):
            out = np.where((V < 0.52)[..., None], P.cloth(s["tunic"], h, w, 0.04), out)
            out = np.where(((V > 0.44) & (V < 0.52))[..., None], rgb(s["stand_collar"])[None, None, :], out)
            out = np.where(((V < 0.52) & (ad < 0.8))[..., None], out * 0.6, out)
        elif s.get("oilskin"):
            out = np.where((V < 0.5)[..., None], P.cloth(s["oilskin"], h, w, 0.05), out)
        elif s.get("neckerchief"):
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
        elif s.get("smock"):
            # a yoke across the shoulders, gathers below it, a slit at the throat
            out = P.cloth(s["smock"], h, w, 0.05, 0.08)
            out = np.where(m((R < 23) & (C % 3 == 0)), out * 0.78, out)
            out = np.where(m(R >= 23), out * 1.08, out)
            out = np.where(m((R == 23) | (R == 22)), out * 0.8, out)
            out = np.where(m((R >= 23) & ((C + R) % 4 == 0)), out * 0.9, out)  # stitching on the yoke
            out = np.where(m((ad < 0.8) & (R > 24)), out * 0.55, out)
            out = np.where(m((ad < 2) & (R == 28)), rgb(0x3a3024)[None, None, :], out)  # a button
        elif s.get("cassock"):
            out = P.cloth(s["cassock"], h, w, 0.04, 0.05)
            out = np.where(m((ad < 0.8) & (R % 2 == 0)), rgb(0x2e2e30)[None, None, :], out)  # the row of small buttons
            out = np.where(m((np.abs(ad - 6.5) < 0.6) & (R < 20)), out * 0.7, out)
            out = np.where(m(R <= 2), rgb(0x0a0a0c)[None, None, :], out)  # sash
        elif s.get("tunic"):
            out = P.cloth(s["tunic"], h, w, 0.05, 0.05)
            out = np.where(m((ad < 0.7) & (R % 4 == 2) & (R > 4) & (R < 30)), rgb(0xb89a4a)[None, None, :], out)
            out = np.where(m((np.abs(ad - 7.5) < 3) & (R == 21)), out * 0.6, out)  # breast pocket flaps
            out = np.where(m((np.abs(ad - 7.5) < 0.6) & (R == 19)), rgb(0xb89a4a)[None, None, :], out)
            out = np.where(m(R <= 3), rgb(0x141414)[None, None, :] * P.grain(h, w, 0.05), out)  # belt
            out = np.where(m((R <= 3) & (ad < 1.8)), rgb(0xa08a4a)[None, None, :], out)  # buckle
            out = np.where(m((np.abs(ad - 16) < 0.6) | (ad > 30.5)), out * 0.8, out)
        elif s.get("oilskin"):
            out = P.cloth(s["oilskin"], h, w, 0.05, 0.12) * P.sheen(h, w)
            out = np.where(m((ad < 0.7) & (R < 29)), out * 0.55, out)
            out = np.where(m((np.abs(ad - 2) < 1.1) & (R % 7 == 3)), rgb(0x2a2418)[None, None, :], out)  # toggles
            out = np.where(m(R >= 29), out * 1.15, out)
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
        if s.get("trouser_check"):
            out *= P.check(h, w)
        out = np.where(((R >= 28))[..., None], out * 0.6, out)
        out = np.where(((ad < 0.7) & (R > 10) & (R < 28))[..., None], out * 0.7, out)
        out *= (0.8 + 0.2 * V)[..., None]
        return out

    P.cell("pelvis", pelvis)

    sleeve = outer(s) or s.get("jersey") or s.get("dress") or s.get("shirt") or 0x6a6458

    def arm_up(U, V, C, R, w, h):
        out = P.cloth(sleeve, h, w)
        if s.get("jersey"):
            out *= (0.85 + 0.2 * (C % 2))[..., None]
        if s.get("oilskin"):
            out *= P.sheen(h, w)
        if s.get("smock"):
            out = np.where((C % 4 == 0)[..., None], out * 0.85, out)
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
        elif s.get("smock"):
            out = np.where((R < 4)[..., None], out * (0.7 + 0.2 * (C % 2))[..., None], out)  # gathered cuff
        elif s.get("tunic"):
            out = np.where((R < 3)[..., None], rgb(s["stand_collar"])[None, None, :], out)
        elif s.get("oilskin"):
            out *= P.sheen(h, w)
        if s.get("rolled"):
            # sleeves rolled above the elbow: a bare forearm, a thick roll of cloth
            arm = skin[None, None, :] * P.grain(h, w, 0.04) * (0.85 + 0.15 * V)[..., None]
            arm = np.where(((C % 5 == 0) & (R % 3 == 0))[..., None], arm * 0.85, arm)  # hair
            out = np.where((V < 0.66)[..., None], arm, out)
            roll = (V >= 0.66) & (V < 0.92)
            out = np.where(roll[..., None], out * (1.12 - 0.3 * (np.abs(V - 0.79) > 0.09))[..., None], out)
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
        if s.get("trouser_check"):
            out *= P.check(h, w)
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
            if s.get("trouser_check"):
                out *= P.check(h, w)
            out = np.where((ad < 0.7)[..., None], out * 1.1, out)
            top = 0.16
        if s.get("barefoot"):
            # trousers cut off ragged above the ankle, dirty bare shins
            top = 0.34 + 0.06 * (P.rng.random(w) < 0.4)[None, :]
            bt = boots[None, None, :] * P.grain(h, w, 0.06) * (0.75 + 0.4 * V)[..., None]
        else:
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
        if s.get("barefoot"):
            out = np.where(((V > 0.8) & (C % 5 == 0))[..., None], out * 0.7, out)  # toes
            out = np.where((ad > 11.5)[..., None], out * 0.55, out)  # black soles
            return out
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
            if s.get("skirt_stripe"):
                out = np.where(m((C % 4) == 0), P.cloth(s["skirt_stripe"], h, w, 0.05), out)
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
        elif low == "smock":
            out = P.cloth(s["smock"], h, w, 0.05, 0.08)
            out = np.where(m(C % 3 == 0), out * 0.8, out)  # gathers
            out = np.where(m((np.abs(ad - 16) < 0.8) & (R < 8)), out * 0.5, out)  # side slits
            out = np.where(m(R <= 1), out * 0.7, out)
        elif low == "cassock":
            out = P.cloth(s["cassock"], h, w, 0.04, 0.05)
            out = np.where(m((ad < 0.8) & (R % 2 == 0)), rgb(0x2e2e30)[None, None, :], out)
            out = np.where(m(C % 7 == 3), out * 0.78, out)  # folds
            out = np.where(m(R <= 1), out * 0.6, out)
            out = np.where(m(R >= 30), rgb(0x0a0a0c)[None, None, :], out)  # sash
        elif low == "tunic":
            out = P.cloth(s["tunic"], h, w, 0.05, 0.05)
            out = np.where(m((ad < 0.7) & (R % 6 == 2) & (R > 10)), rgb(0xb89a4a)[None, None, :], out)
            out = np.where(m(ad < 0.6), out * 0.6, out)
            out = np.where(m(R >= 28), rgb(0x141414)[None, None, :], out)  # belt
            out = np.where(m(R <= 1), out * 0.7, out)
        elif low == "oilskin":
            out = P.cloth(s["oilskin"], h, w, 0.05, 0.12) * P.sheen(h, w)
            out = np.where(m(ad < 0.7), out * 0.55, out)
            out = np.where(m((np.abs(ad - 2) < 1.1) & (R % 7 == 3)), rgb(0x2a2418)[None, None, :], out)
            out = np.where(m(R <= 1), out * 0.7, out)
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
            if s.get("badge"):  # a porter's numbered brass badge above the peak
                out = np.where(((ad < 2.2) & (R >= 10) & (R <= 13))[..., None], rgb(0xb89a4a)[None, None, :], out)
        elif kind == "kepi":
            out = np.where(((R >= 8) & (R <= 12))[..., None], out * 1.5, out)  # band
            out = np.where(((ad < 1.6) & (R >= 13) & (R <= 17))[..., None], rgb(0xb89a4a)[None, None, :], out)
            out = np.where((R < 7)[..., None], rgb(0x0c0c0c)[None, None, :] * (1 + 0.4 * (R == 3))[..., None], out)
        elif kind == "wide":
            out *= (0.95 + 0.2 * (np.abs(ad - 8) < 2))[..., None]
        elif kind == "souwester":
            out *= P.sheen(h, w)
            out = np.where((C % 8 == 0)[..., None], out * 0.7, out)  # seams
        elif kind == "kerchief":
            dots = ((C % 4 == 1) & (R % 4 == 1))
            out = np.where(dots[..., None], out * 1.6, out)
            out = np.where(((C <= 1) | (C >= w - 2))[..., None], out * 0.7, out)
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

    props = s.get("props", [])

    def prop(U, V, C, R, w, h):
        # three strips, each painted for what this person carries:
        # u 0-0.5 basket or sack, u 0.5-0.74 ledger, book or wood, u 0.75-1 clay pipe or metal
        out = np.zeros((h, w, 3)) + 0.3
        A = U < 0.5
        Bm = (U >= 0.5) & (U < 0.75)
        Cm = U >= 0.75
        if "handcart" in props:
            # spoked wheels: v 0 the iron tyre, v 1 the hub
            wheel = rgb(0x1c1814)[None, None, :] * P.grain(h, w, 0.06)
            spoke = rgb(0x6a5236)[None, None, :] * P.grain(h, w, 0.08)
            wheel = np.where(((C % 2 == 0) & (V > 0.15))[..., None], spoke, wheel)
            wheel = np.where((V > 0.8)[..., None], spoke * 0.8, wheel)
            wheel = np.where((V <= 0.12)[..., None], rgb(0x2a2a2c)[None, None, :], wheel)
            out = np.where(A[..., None], wheel, out)
        elif "sack_shoulder" in props or "sacktruck" in props:
            # burlap: a coarse weave, a stencilled band, dirt
            sack = rgb(0x9a8660)[None, None, :] * P.grain(h, w, 0.08) * P.blotch(h, w, 3, 0.1)
            sack *= (0.88 + 0.16 * (((C + R) % 2) == 0))[..., None]
            sack = np.where(((np.abs(V - 0.5) < 0.1) & (U > 0.15) & (U < 0.35))[..., None], sack * 0.55, sack)
            out = np.where(A[..., None], sack, out)
        else:
            # basket: wicker; what lies in it on top (v 0.8-1)
            wick = rgb(0x7a6040)[None, None, :] * (0.8 + 0.3 * (((C + R) % 3) == 0))[..., None]
            out = np.where(A[..., None], wick, out)
            fill = s.get("basket_fill", "fish")
            if fill == "cloth":
                top = rgb(0xd8d4c8)[None, None, :] * P.grain(h, w, 0.04) * (0.9 + 0.1 * (C % 3 == 0))[..., None]
            else:
                top = rgb(0x8a9098)[None, None, :] * (0.75 + 0.4 * ((C % 4) == 1))[..., None]
            out = np.where((A & (V > 0.8))[..., None], top, out)
        if "sacktruck" in props or "cane" in props or "handcart" in props:
            wood = rgb(0x2a1c14 if "cane" in props else 0x5a4430)[None, None, :] * P.grain(h, w, 0.08)
            wood = np.where((R % 5 == 0)[..., None], wood * 0.8, wood)
            out = np.where(Bm[..., None], wood, out)
        elif "sabre" in props:
            out = np.where(Bm[..., None], rgb(0x161616)[None, None, :] * P.grain(h, w, 0.05), out)
        else:
            # ledger (or the priest's book): leather, page edges
            led = rgb(0x121214 if "book" in props else 0x3a2418)[None, None, :] * P.grain(h, w, 0.06)
            led = np.where(((C % 8 == 1) & (R > 1) & (R < h - 2))[..., None], rgb(0xb8b098)[None, None, :], led)
            out = np.where(Bm[..., None], led, out)
        if "sacktruck" in props:
            iron = rgb(0x2a2a2c)[None, None, :] * P.grain(h, w, 0.08)
            out = np.where(Cm[..., None], iron, out)
        elif "handcart" in props:
            # the keg: staves and two dark hoops
            keg = rgb(0x6a4a2a)[None, None, :] * P.grain(h, w, 0.08) * (0.85 + 0.2 * (C % 2))[..., None]
            keg = np.where(((np.abs(V - 0.2) < 0.08) | (np.abs(V - 0.8) < 0.08))[..., None], rgb(0x222222)[None, None, :], keg)
            out = np.where(Cm[..., None], keg, out)
        elif "cane" in props or "sabre" in props:
            out = np.where(Cm[..., None], rgb(0xb8a060 if "sabre" in props else 0xb0b0a8)[None, None, :] * P.grain(h, w, 0.06), out)
        else:
            # pipe: white clay, darker at the burnt bowl rim
            clay = rgb(0xb0a894)[None, None, :] * P.grain(h, w, 0.05)
            clay = np.where((R >= h - 3)[..., None], clay * 0.45, clay)
            out = np.where(Cm[..., None], clay, out)
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


def pose_walk(t, fem=False, carry=False, sw=None):
    p = 2 * math.pi * t
    pose = {}
    sw = sw or (17 if fem else 22)
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


def sack_arm(pose):
    """Left hand up on the sack over the left shoulder; the head leans away from it."""
    pose["armUpL"] = limb("L", fwd=78, out=26, twist=-10)
    pose["armLowL"] = RX(-122)
    pose["handL"] = RX(-20)
    pose["neck"] = RY(-7) @ RX(2)
    pose["spine"] = pose.get("spine", Quaternion()) @ RY(-3)


def pose_walk_sack(t):
    pose = pose_walk(t, sw=19)
    sack_arm(pose)
    return pose


def pose_idle_sack(t):
    pose = pose_idle(t)
    sack_arm(pose)
    return pose


def push_arms(pose):
    """Both hands low and forward on the handles of a sack truck."""
    for S in "LR":
        pose["armUp" + S] = limb(S, fwd=34, out=3, twist=6)
        pose["armLow" + S] = RX(-24)
        pose["hand" + S] = RX(-8)


def pose_push(t, rest=False):
    """Walk behind the sack truck: shorter steps, shoulders square to the handles.
    rest=True gives the arms alone (where sack_truck() puts the handles)."""
    if rest:
        pose = {"spine": RX(6)}
    else:
        c = math.cos(2 * math.pi * t)
        pose = pose_walk(t, sw=16)
        pose["hips"] = RZ(-1.5 * c)
        pose["spine"] = RX(6) @ RZ(1.5 * c)
    push_arms(pose)
    return pose


def pose_push_idle(t):
    pose = pose_idle(t)
    pose["spine"] = RX(6 + 0.6 * math.sin(4 * math.pi * t))
    pose["hips"] = Quaternion()
    for S in "LR":
        pose["legUp" + S] = Quaternion()
    push_arms(pose)
    return pose


def pose_behind(t, fem=False):
    """Standing and looking out (over the water), hands behind the back."""
    pose = pose_idle(t, fem)
    p = 2 * math.pi * t
    pose["head"] = RZ(14 * math.sin(p) * math.sin(p * 0.5) ** 2) @ RX(-2 + 1.5 * math.sin(p * 3))
    for S in "LR":
        pose["armUp" + S] = limb(S, fwd=-35, out=25, twist=70)
        pose["armLow" + S] = RX(-80)
        pose["hand" + S] = RX(-5)
    return pose


def pose_lean(t):
    """Forearms on a rail at about 1.05 m and 0.55 m out, bent over it, looking out."""
    p = 2 * math.pi * t
    pose = {}
    pose["hips"] = RY(0.8 * math.sin(p))
    pose["spine"] = RX(30 + 0.8 * math.sin(2 * p))
    pose["neck"] = RX(-16)
    pose["head"] = RZ(12 * math.sin(p) * math.sin(p * 0.5) ** 2) @ RX(-4)
    for S in "LR":
        pose["armUp" + S] = limb(S, fwd=40, out=10, twist=30)
        pose["armLow" + S] = RX(-80)
        pose["hand" + S] = RX(-4)
        pose["legUp" + S] = RY(-0.8 * math.sin(p))
    pose["legUpR"] = pose["legUpR"] @ RX(-4)
    pose["legLowR"] = RX(8)
    return pose


def pose_sit(t):
    """Sitting on a crate or a bench, forearms on the knees, looking about; the
    right hand lifts now and then as if to make a point. The game lowers the
    body so the thighs rest on the seat (humans.ts, sitDrop)."""
    p = 2 * math.pi * t
    pose = {}
    pose["spine"] = RX(7 + 1.2 * math.sin(2 * p))
    pose["neck"] = RX(-5)
    pose["head"] = RZ(12 * math.sin(p) * math.sin(p * 0.5) ** 2) @ RX(2 * math.sin(3 * p))
    lift = max(0.0, math.sin(p * 2 + 1.0)) ** 3
    for S in "LR":
        pose["legUp" + S] = limb(S, fwd=86, out=7)
        pose["legLow" + S] = RX(84)
        pose["foot" + S] = RX(2)
        pose["armUp" + S] = limb(S, fwd=22, out=8, twist=12)
        pose["armLow" + S] = RX(-46)
        pose["hand" + S] = RX(-12)
    pose["armUpR"] = limb("R", fwd=22 + 14 * lift, out=8, twist=12)
    pose["armLowR"] = RX(-(46 + 40 * lift))
    pose["handR"] = RX(-12 - 10 * lift) @ RZ(-20 * lift)
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
    ("sit", pose_sit, 6.0, dict()),
    ("walk_sack", pose_walk_sack, 1.0, dict()),
    ("idle_sack", pose_idle_sack, 4.0, dict()),
    ("push", pose_push, 1.0, dict()),
    ("push_idle", pose_push_idle, 4.0, dict()),
    ("behind", pose_behind, 5.0, dict()),
    ("lean", pose_lean, 6.0, dict()),
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


CAST_CLIP = {"docker_a": "talk", "docker_b": "fold", "docker_c": "idle", "docker_sack": "idle_sack",
             "porter": "push_idle", "carter": "push_idle", "boy": "walk", "police": "fold", "gentleman": "idle", "priest": "idle",
             "sailor_b": "idle"}
POSES = [("porter", "push"), ("carter", "push"), ("docker_sack", "walk_sack"), ("docker_a", "sit"), ("docker_c", "carry"),
         ("gentleman", "behind"), ("sailor_b", "lean"), ("police", "walk"), ("fishwife_a", "walk_f"), ("maid", "walk_f"), ("boy", "walk"),
         ("priest", "walk")]


def sit_drop(s, seat=0.45):
    """How far to lower a sitting body so the thighs rest on a seat this high."""
    k = s["h"] / 1.74
    return seat + 0.07 * k - 0.9 * k


def cast_preview(chars, actions):
    """The crowd, for a look: crowd_cast (front), _back, _faces, and crowd_poses."""
    scn = bpy.context.scene
    acts = {a.name: a for a in actions}
    crowd = [c for c in chars if c[2]["name"] not in {p["name"] for p in PEOPLE[:9]}]
    others = [c for c in chars if c not in crowd]

    def use(ao, name):
        ad = ao.animation_data_create()
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        ad.action = acts[name]
        try:
            if len(acts[name].slots):
                ad.action_slot = acts[name].slots[0]
        except AttributeError:
            pass

    for ao, _, _ in others:
        ao.location = B(0, -50, 0)
    scn.render.engine = "BLENDER_WORKBENCH"
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "TEXTURE"
    scn.display.shading.show_backface_culling = False
    scn.display.shading.show_specular_highlight = False
    scn.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.color = (0.2, 0.22, 0.25)
    scn.world = world
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scn.collection.objects.link(cam)
    scn.camera = cam
    os.makedirs(SHOTS, exist_ok=True)
    # a floor and a crate to sit on
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    floor = bpy.context.object
    fm = bpy.data.materials.new("floor")
    fm.diffuse_color = (0.12, 0.12, 0.12, 1)
    floor.data.materials.append(fm)

    def shoot(path, loc, look, lens, w, h, frame):
        scn.frame_set(frame)
        cam.location = loc
        cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
        cam_data.lens = lens
        scn.render.resolution_x = w
        scn.render.resolution_y = h
        scn.render.filepath = path
        bpy.ops.render.render(write_still=True)

    n = len(crowd)
    gap = 0.95
    for i, (ao, _, s) in enumerate(crowd):
        ao.location = B(i * gap - (n - 1) * gap / 2, 0, 0)
        use(ao, CAST_CLIP.get(s["name"], "idle_f" if s["female"] else "idle"))
    shoot(os.path.join(SHOTS, "crowd_cast.png"), B(0, 1.0, 21.0), B(0, 0.85, 0), 50, 2800, 900, 9)
    shoot(os.path.join(SHOTS, "crowd_cast_back.png"), B(0, 1.2, -21.0), B(0, 0.85, 0), 50, 2800, 900, 9)
    for i, (ao, _, s) in enumerate(crowd):
        ao.location = B(i * 0.34 - (n - 1) * 0.17, 0, 0)
    shoot(os.path.join(SHOTS, "crowd_cast_faces.png"), B(0, 1.45, 5.2), B(0, 1.45, 0), 50, 2800, 700, 9)

    # poses, seen three-quarters on
    byname = {c[2]["name"]: c for c in crowd}
    for ao, _, _ in crowd:
        ao.location = B(0, -50, 0)
    m = len(POSES)
    seat = None
    extra = []
    for i, (name, clip) in enumerate(POSES):
        ao, _, s = byname[name]
        x = i * 1.25 - (m - 1) * 0.625
        y = sit_drop(s) if clip == "sit" else 0.0
        ao.location = B(x, y, 0)
        ao.rotation_euler = (0, 0, math.radians(35))
        use(ao, clip)
        if clip == "lean":
            bpy.ops.mesh.primitive_cube_add(size=1, location=B(x + 0.32, 1.0, 0.45))
            rail = bpy.context.object
            rail.scale = (1.4, 0.05, 0.05)
            rail.rotation_euler = (0, 0, math.radians(35))
            extra.append(rail)
        if clip == "sit":
            bpy.ops.mesh.primitive_cube_add(size=1, location=B(x - 0.03, 0.225, -0.12))
            seat = bpy.context.object
            seat.scale = (0.55, 0.4, 0.45)
            seat.rotation_euler = (0, 0, math.radians(35))
            sm = bpy.data.materials.new("crate")
            sm.diffuse_color = (0.3, 0.22, 0.14, 1)
            seat.data.materials.append(sm)
    shoot(os.path.join(SHOTS, "crowd_poses.png"), B(0.5, 1.6, 15.5), B(0, 0.8, 0), 35, 2800, 900, 7)
    for ao, _, _ in crowd:
        ao.rotation_euler = (0, 0, 0)
    if seat:
        bpy.data.objects.remove(seat)
    for o in extra:
        bpy.data.objects.remove(o)
    bpy.data.objects.remove(floor)


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
        for ao, _, _ in chars[9:]:
            ao.location = B(0, -50, 0)
        preview(chars[:9], actions)
    if CAST:
        cast_preview(chars, actions)


if __name__ == "__main__":
    main()
