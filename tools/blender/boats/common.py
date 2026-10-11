"""The boat builder's common parts (tools/blender/build_boats.py builds every boat from these).

The mesh builder (build_props' Mesh with the rigging as lines, the lamps and the stoves as extras), the
painters of the boat materials and the materials themselves, the hull loft (Hull), the water cap
(cap_object), and the small parts every family uses: spars, rigging, sails, name boards, houses,
barrels, sacks, anchors, lanterns, fenders, the ship's boat on its skids. The boat contract that every
builder keeps is docs/boats.md.

Everything here is our own work: the shapes are built from code, the textures painted by the functions
below. Material constants (WOOD, TAR, ...) are indices into MATS, the material list of every boat mesh.
"""

import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # tools/blender
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
import build_props as bp  # noqa: E402  (mesh helpers, painters, the prop materials)
import lantern_kit  # noqa: E402  (the town's lamps and lanterns, one design)
from build_props import col, move, rot_z, speckle, vnoise  # noqa: E402,F401

ROOT = bp.ROOT


class Mesh(bp.Mesh):
    """build_props' mesh builder, plus the rigging kept as line segments: the game draws them
    as 1-pixel lines (thin tubes break up into dots at 480x270)."""

    def __init__(self, ao=0.45):
        super().__init__(ao)
        self.lines = []
        self.smoke = []
        self.hulls = []
        self.extras = {}
        # M7 boats: a colour cast on the baked shade, by where the vertex is (model frame): the
        # green-brown slime of the waterline, weed below it, soot, rust. None: grey shade only.
        self.tintfn = None

    def face(self, vs, uvs, mat, shade=1.0, smooth=False, local=None):
        f = super().face(vs, uvs, mat, shade, smooth, local)
        if f is not None and self.tintfn is not None:
            for loop in f.loops:
                c = loop[self.col]
                r, g, b = self.tintfn(loop.vert.co)
                loop[self.col] = (c[0] * r, c[1] * g, c[2] * b, 1.0)
        return f

    def line(self, a, b):
        self.lines.append((self.xf @ Vector(a), self.xf @ Vector(b)))

    def lamp(self, p, kind=0):
        """M7 boats: a lantern's flame here (model frame), for the game's lamp APIs: kind 0 a white
        riding or stern light, 1 red (port), 2 green (starboard)."""
        q = self.xf @ Vector(p)
        self.extras.setdefault("lamps", []).append([round(q.x, 3), round(q.y, 3), round(q.z, 3), kind])

    def stove(self, p):
        """M7 boats: the top of a cabin's stovepipe (a thin coal smoke, weaker than a funnel's)."""
        q = self.xf @ Vector(p)
        self.extras.setdefault("stove", []).append([round(q.x, 3), round(q.y, 3), round(q.z, 3)])


def waterline_tint(p):
    """Grime of a hull that lives in the Schelde: green-brown slime round the waterline (the tide
    moves it up and down a hand's breadth), weed and a pale bloom below it."""
    z = p.z
    band = math.exp(-((z - 0.05) / 0.22) ** 2)
    weed = min(1.0, max(0.0, (-0.12 - z) / 0.5))
    return (1 - 0.34 * band - 0.28 * weed, 1 - 0.18 * band - 0.08 * weed, 1 - 0.42 * band - 0.34 * weed)

OUT = os.path.join(ROOT, "client", "public", "models", "boats.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

EXTRA = ["tar", "clinker", "iron_hull", "iron_ports", "band", "copper", "redlead", "deck", "paint_green",
         "paint_white", "canvas", "canvas_tan", "rigging", "shrouds", "lattice", "funnel", "window", "hatch",
         "tarp", "flag", "names", "washing", "names2", "funnel_star", "names3",
         # M7 boats: the detail pass and the small boats
         "tar_weed", "names4", "netting", "coal", "sand", "streaks", "bilge", "varnish", "hood",
         # the portal crane's detail pass (docs/milestones/vehicle-detail.md): riveted plate, chequer plate,
         # the cabin's upright boarding, the cast plate on the portal
         "crane_plate", "chequer", "cabin_planks", "crane_board"]
# the street-prop materials we use, painted with build_props' painters (our own list: props.glb may change)
BASE = ["wood", "wood_dark", "iron", "rope", "sackcloth", "crate", "barrel", "stone", "glass"]
WOOD, DARK, IRON, ROPE, SACK, CRATE, BARREL, STONE, GLASS = range(len(BASE))
MATS = BASE + EXTRA
(TAR, CLINKER, IRONHULL, PORTS, BAND, COPPER, REDLEAD, DECK, GREEN, WHITE, CANVAS, TAN, RIG, SHROUD, LATTICE,
 FUNNEL, WINDOW, HATCH, TARP, FLAG, NAMES, WASH, NAMES2, FUNNEL_STAR, NAMES3,
 TARWEED, NAMES4, NET, COAL, SAND, STREAKS, BILGE, VARNISH, HOOD,
 PLATE, CHEQUER, BOARDS, CBOARD) = range(len(BASE), len(MATS))
# thin parts, seen from both sides (the game makes these double-sided too)
THIN = {"shrouds", "lattice", "flag", "canvas", "canvas_tan", "tarp", "washing", "netting", "streaks"}
# metres per texture tile for faces mapped by position
TILE = {TAR: 2.0, TARWEED: 2.0, VARNISH: 1.2, CLINKER: 1.0, IRONHULL: 4.0, COPPER: 2.0, REDLEAD: 2.0, GREEN: 1.6, WHITE: 1.6, DECK: 1.6,
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


def paint_canvas(seed, base, gaskets=True):
    """Furled sailcloth: creases run along the bundle (constant u). M7 boats: without the gaskets, a canvas hood."""
    rng = np.random.default_rng(seed)
    uu = np.arange(64)[None, :]
    folds = 0.82 + 0.18 * np.sin(uu / 64 * 2 * math.pi * 5 + rng.uniform(0, 6)) + 0.1 * np.sin(uu / 64 * 2 * math.pi * 11)
    img = np.ones((64, 64, 3)) * col(base) * folds[..., None]
    img *= (0.85 + 0.25 * noise(rng, 64, 64, 32, 4))[..., None]
    for _ in range(7):
        u = int(rng.integers(0, 64))
        img[:, u] *= 0.55
    img *= (0.9 + 0.15 * noise(rng, 64, 64, 6, 6))[..., None]
    for r0 in ((14, 46) if gaskets else ()):  # gaskets: the rope bands that hold a furled sail, one a metre
        img[r0:r0 + 3] = img[r0:r0 + 3] * 0.35 + col((0.2, 0.16, 0.11)) * 0.5
        img[r0 + 3] *= 1.15
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


def paint_funnel_star(seed):
    """The ocean liner's funnel, v up: black, a broad white band with a red five-pointed star
    (the Antwerp line of 1873: black funnel, white band, red star), soot at the top, rivet rings."""
    rng = np.random.default_rng(seed)
    n = 64
    img = np.ones((n, n, 3)) * col((0.07, 0.065, 0.06))
    b0, b1 = 30, 48
    img[b0:b1] = col((0.72, 0.7, 0.64))
    uu, vv = np.meshgrid(np.arange(n) + 0.5, np.arange(b1 - b0) + 0.5)
    cu, cv = n / 2, (b1 - b0) / 2
    a = np.arctan2(vv - cv, (uu - cu) * 0.5) - math.pi / 2
    r = np.hypot((uu - cu) * 0.5, vv - cv)
    k = np.cos(math.pi / 5) / np.cos((a % (2 * math.pi / 5)) - math.pi / 5)
    star = r < 7.2 * (0.42 + 0.58 * (k - np.cos(math.pi / 5)) / (1 - np.cos(math.pi / 5)))
    band = img[b0:b1]
    band[star] = col((0.55, 0.06, 0.05))
    img *= (0.85 + 0.3 * noise(rng, n, n, 6, 6))[..., None]
    for r_ in (10, 22, b0 - 1, b1, 56):
        img[r_] *= 0.5
        img[r_ + 1] += 0.03
    soot = np.clip((np.arange(n) - 52) / 12, 0, 1)[:, None, None]
    img *= 1 - 0.55 * soot
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
    """Four flags, v up: top left a white house flag with a red star, top right plain red
    (pennants), bottom left the Dutch tricolour, bottom right the Belgian one. Muted colours."""
    w, h = 64, 32
    img = np.zeros((h, w, 3))
    img[16:, :32] = col((0.78, 0.76, 0.7))
    img[16:, 32:] = col((0.5, 0.07, 0.06))
    img[11:16, :32] = col((0.5, 0.1, 0.08))
    img[5:11, :32] = col((0.76, 0.74, 0.68))
    img[0:5, :32] = col((0.12, 0.18, 0.36))
    img[:16, 32:43] = col((0.05, 0.05, 0.05))
    img[:16, 43:54] = col((0.66, 0.54, 0.16))
    img[:16, 54:] = col((0.5, 0.09, 0.07))
    uu, vv = np.meshgrid(np.arange(32) + 0.5, np.arange(16) + 0.5)
    a = np.arctan2(vv - 8, uu - 16) - math.pi / 2
    r = np.hypot(uu - 16, vv - 8)
    k = np.cos(math.pi / 5) / np.cos((a % (2 * math.pi / 5)) - math.pi / 5)
    star = r < 6.2 * (0.45 + 0.55 * (k - np.cos(math.pi / 5)) / (1 - np.cos(math.pi / 5)))
    top = img[16:, :32]
    top[star] = col((0.55, 0.06, 0.05))
    rng = np.random.default_rng(seed)
    img *= (0.85 + 0.25 * noise(rng, w, h, 8, 4))[..., None]
    return img


FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
    " ": ["00000"] * 7,
    # figures (the crane's cast plate)
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
}
# rows of the name texture (row 0 at the top); name_board() picks one
NAME_ROWS = ["ELISABETH", "ANTWERPEN", "SCHELDE", "HERCULES", "DE HOOP", "NOORDSTER", "ST ANNA", "ZWALUW"]
NAME_ROWS2 = ["ANNA MARIA", "ANTWERPEN", "BRIG", "", "", "", "", ""]
# the ocean steamer at anchor (liner): her name and port (a -land name, as the line of 1873 gave them)
NAME_ROWS3 = ["KEMPENLAND", "ANTWERPEN", "", "", "", "", "", ""]
# M7 boats: home ports on the sterns of the barges and lighters, two barge names, the water police's gig
NAME_ROWS4 = ["ANTWERPEN", "BOOM", "TEMSE", "LILLO", "DOEL", "DRIE GEBR", "JOZEF", "POLITIE"]


def paint_names(seed, rows=None):
    """Ship names in painted letters, 16 px rows (row 0 at the top): cream on black."""
    rng = np.random.default_rng(seed)
    n = 128
    img = np.ones((n, n, 3)) * col((0.05, 0.045, 0.04))
    img *= (0.8 + 0.4 * noise(rng, n, n, 16, 16))[..., None]
    ink = col((0.8, 0.72, 0.52))
    for r, text in enumerate(rows or NAME_ROWS):
        wpx = len(text) * 12 - 2
        x0 = (n - wpx) // 2
        ytop = n - 16 * r - 2  # image rows run bottom-up
        for k, ch in enumerate(text):
            g = FONT.get(ch, FONT[" "])
            for gy, row in enumerate(g):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        x = x0 + k * 12 + gx * 2
                        y = ytop - gy * 2 - 2
                        img[y:y + 2, x:x + 2] = ink * (0.85 + 0.3 * rng.random())
        img[n - 16 * (r + 1)] *= 0.5
    return img


def paint_washing(seed):
    """Washing: four cloths, one per quarter: linen, a blue check shirt, a faded red cloth, a striped sheet."""
    rng = np.random.default_rng(seed)
    img = np.zeros((64, 64, 3))
    uu, vv = np.meshgrid(np.arange(32), np.arange(32))
    q = [col((0.78, 0.76, 0.68)) * np.ones((32, 32, 3)),
         np.where((((uu // 4) + (vv // 4)) % 2 == 0)[..., None], col((0.3, 0.36, 0.48)), col((0.6, 0.62, 0.64))),
         col((0.52, 0.2, 0.16)) * np.ones((32, 32, 3)),
         np.where(((uu // 3) % 3 == 0)[..., None], col((0.35, 0.4, 0.5)), col((0.76, 0.74, 0.66)))]
    img[32:, :32], img[32:, 32:], img[:32, :32], img[:32, 32:] = q
    img *= (0.8 + 0.3 * noise(rng, 64, 64, 8, 8))[..., None]
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


# ------------------------------------------------------------------ M7 boats: the detail pass


def paint_tar_weed(seed, n=128):
    """Tarred planks under the waterline: green weed in tufts and runs, a pale salt-and-barnacle
    bloom in patches, the seams still showing. For the bottoms that show when a boat takes the mud."""
    rng = np.random.default_rng(seed)
    img = paint_tar(seed, n, base=(0.075, 0.07, 0.055))
    weed = np.clip((noise(rng, n, n, 10, 3) - 0.35) * 2.2, 0, 1) * np.clip(noise(rng, n, n, 3, 18) * 1.4, 0, 1)
    img = img * (1 - weed[..., None] * 0.75) + col((0.11, 0.16, 0.07)) * (weed[..., None] * 0.75)
    bloom = (np.clip(noise(rng, n, n, 7, 7) - 0.62, 0, 1) * 3.5)[..., None] * (rng.random((n, n, 1)) < 0.35)
    img = img * (1 - bloom * 0.6) + col((0.32, 0.31, 0.26)) * bloom * 0.6
    return speckle(img, rng, 0.06, 0.6, 1.3)


def paint_netting(seed, n=32):
    """Tanned fishing net, cut out: a diamond mesh of knotted twine (an eel trap's netting, a net hung to dry)."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(n) + 0.5, np.arange(n) + 0.5)
    a = ((np.abs(((uu + vv) % 8) - 4) < 0.8) | (np.abs(((uu - vv) % 8) - 4) < 0.8)).astype(float)
    img = np.ones((n, n, 3)) * col((0.24, 0.16, 0.09)) * (0.8 + 0.4 * rng.random((n, n, 1)))
    return img, a


def paint_heap(seed, base, lump, grain=0.25, n=64):
    """A heap of coal or sand seen from above: lumps and shadows (coal) or ripples and wet dark (sand)."""
    rng = np.random.default_rng(seed)
    img = np.ones((n, n, 3)) * col(base)
    img *= (1 - grain + 2 * grain * noise(rng, n, n, 16, 16))[..., None]
    lumps = rng.random((n, n)) < lump
    img[lumps] *= 1.7
    img[np.roll(lumps, 1, axis=0)] *= 0.55
    return speckle(img, rng, 0.08, 0.6, 1.4)


def paint_streaks(seed, n=64):
    """Rust and soot running down a hull or a wall under a fitting, cut out: dark tapering runs."""
    rng = np.random.default_rng(seed)
    img = np.zeros((n, n, 3))
    a = np.zeros((n, n))
    for _ in range(9):
        u = int(rng.integers(4, n - 4))
        ln = int(rng.integers(n // 3, n - 2))
        w = int(rng.integers(1, 4))
        rust = rng.random() < 0.7
        c = col((0.34, 0.15, 0.07)) if rust else col((0.05, 0.045, 0.04))
        for k in range(ln):
            v = n - 1 - k  # image rows run bottom-up: the run starts at the top
            ww = max(1, int(round(w * (1 - k / ln) + 0.4)))
            a[v, u:u + ww] = 1
            img[v, u:u + ww] = c * (0.8 + 0.4 * rng.random())
            if rng.random() < 0.15:
                u += int(rng.integers(-1, 2))
    return img, a


def paint_bilge(seed, n=32):
    """Dirty bilge water standing in an old boat: dark green-brown with a scum."""
    rng = np.random.default_rng(seed)
    img = np.ones((n, n, 3)) * col((0.07, 0.08, 0.05))
    img *= (0.75 + 0.5 * noise(rng, n, n, 6, 6))[..., None]
    scum = rng.random((n, n)) < 0.05
    img[scum] = col((0.22, 0.22, 0.16))
    return img


def paint_varnish(seed, n=64):
    """Varnished planking of a gig: warm brown carvel strakes, thin seams, the grain along u."""
    rng = np.random.default_rng(seed)
    img = np.zeros((n, n, 3))
    h = n // 8
    for b in range(8):
        img[b * h:(b + 1) * h] = col((0.36, 0.2, 0.1)) * (1 + rng.uniform(-0.12, 0.12))
        img[b * h] *= 0.5
    img *= (0.8 + 0.4 * noise(rng, n, n, 3, 32))[..., None]
    return speckle(img, rng, 0.03)


# ------------------------------------------------------------------ the portal crane's detail pass (2026-09-27)


def paint_crane_plate(seed, w=128, h=32):
    """Riveted plate of the portal crane, painted iron gone rusty at the rivets and the edges. Mapped
    with u along the member and v across one face (0..1): a row of rivets along each edge (the flange
    angles' lines, their toes a dark line), a butt strap with two rows at u = 0. Four face widths to
    one picture along u (128 x 32 px: square pixels)."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 3)) * col((0.15, 0.15, 0.155))
    img *= (0.84 + 0.3 * noise(rng, w, h, 16, 4))[..., None]
    rust = np.clip((noise(rng, w, h, 12, 3) - 0.63) * 2.8, 0, 1)[..., None]
    img = img * (1 - rust) + col((0.27, 0.16, 0.1)) * rust
    for r in (6, h - 7):  # the toes of the flange angles
        img[r] *= 0.55
    img[:2] *= 0.72
    img[-2:] *= 0.72
    img[:, :12] *= 1.1  # the butt strap
    img[:, 12] *= 0.5

    def rivet(u, v):
        img[v, u] = col((0.3, 0.29, 0.28))
        img[v - 1, (u + 1) % w] = col((0.045, 0.045, 0.045))
        if rng.random() < 0.3:
            img[v - 2, u] = img[v - 2, u] * 0.4 + col((0.34, 0.17, 0.08)) * 0.6

    for u in range(4, w, 7):
        rivet(u, 3)
        rivet(u, h - 4)
    for v in range(9, h - 8, 4):
        rivet(3, v)
        rivet(9, v)
    return speckle(img, rng, 0.04, 0.6, 1.2)


def paint_chequer(seed, n=64):
    """Chequer plate for the crane's gallery floor: raised bars, turned a quarter each 8 px cell,
    catching the light; rust in the hollows."""
    rng = np.random.default_rng(seed)
    img = np.ones((n, n, 3)) * col((0.17, 0.17, 0.175))
    img *= (0.85 + 0.3 * noise(rng, n, n, 8, 8))[..., None]
    rust = np.clip((noise(rng, n, n, 5, 5) - 0.64) * 3, 0, 1)[..., None]
    img = img * (1 - rust) + col((0.29, 0.17, 0.1)) * rust
    for cy in range(0, n, 8):
        for cx in range(0, n, 8):
            flip = ((cx + cy) // 8) % 2
            for k in range(-2, 3):
                u, v = cx + 4 + k, cy + 4 + (k if flip else -k)
                img[v % n, u % n] = col((0.31, 0.31, 0.3))
                img[(v - 1) % n, (u + 1) % n] = col((0.06, 0.06, 0.06))
    return speckle(img, rng, 0.04)


def paint_cabin_planks(seed):
    """The crane cabin's boarding, standing upright (boards along v, 20 cm at 0.8 m a picture):
    painted a dull brown, weathered, worn to the wood in places."""
    rng = np.random.default_rng(seed)
    img = bp.paint_planks(seed, (0.31, 0.27, 0.22), boards=4, joints=False, knots=1).transpose(1, 0, 2).copy()
    return chips(img, rng, (0.4, 0.31, 0.21), 0.58)


# the cast plate on the portal: the town (the city's quay cranes) and the load it may lift, in kilos
CRANE_BOARD = ["ANTWERPEN", "3000 KIL."]


def paint_crane_board(seed):
    """The crane's cast plate: raised cream letters and a raised rim on black, 128 x 64 px."""
    rng = np.random.default_rng(seed)
    w, h = 128, 64
    img = np.ones((h, w, 3)) * col((0.06, 0.055, 0.05))
    img *= (0.8 + 0.4 * noise(rng, w, h, 16, 8))[..., None]
    ink = col((0.74, 0.68, 0.52))
    for r, text in enumerate(CRANE_BOARD):
        x0 = (w - (len(text) * 12 - 2)) // 2
        ytop = h - 8 - 26 * r  # image rows run bottom-up
        for k, ch in enumerate(text):
            for gy, row in enumerate(FONT.get(ch, FONT[" "])):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        x, y = x0 + k * 12 + gx * 2, ytop - gy * 2 - 2
                        img[y:y + 2, x:x + 2] = ink * (0.85 + 0.3 * rng.random())
    img[:3] = ink * 0.75
    img[-3:] = ink * 0.75
    img[:, :3] = ink * 0.75
    img[:, -3:] = ink * 0.75
    return img


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
    paint = {
        "wood": lambda: bp.paint_planks(1, (0.43, 0.37, 0.29)),
        "wood_dark": lambda: bp.paint_planks(2, (0.25, 0.19, 0.14), boards=2, seams=False, joints=False, knots=1),
        "iron": lambda: bp.paint_iron(3),
        "rope": lambda: bp.paint_rope(4),
        "sackcloth": lambda: bp.paint_sack(5),
        "crate": lambda: bp.paint_crate(6),
        "barrel": lambda: bp.paint_staves(7),
        "stone": lambda: bp.paint_stone(8),
        "glass": lambda: bp.paint_glass(9),
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
        "names": lambda: paint_names(121),
        "washing": lambda: paint_washing(122),
        "names2": lambda: paint_names(123, NAME_ROWS2),
        "funnel_star": lambda: paint_funnel_star(124),
        "names3": lambda: paint_names(125, NAME_ROWS3),
        "tar_weed": lambda: paint_tar_weed(126),
        "names4": lambda: paint_names(127, NAME_ROWS4),
        "netting": lambda: paint_netting(128),
        "coal": lambda: paint_heap(129, (0.06, 0.06, 0.065), 0.08),
        "sand": lambda: paint_heap(130, (0.42, 0.36, 0.25), 0.02, 0.15),
        "streaks": lambda: paint_streaks(131),
        "bilge": lambda: paint_bilge(132),
        "varnish": lambda: paint_varnish(133),
        "hood": lambda: paint_canvas(134, (0.44, 0.4, 0.33), gaskets=False),
        "crane_plate": lambda: paint_crane_plate(135),
        "chequer": lambda: paint_chequer(136),
        "cabin_planks": lambda: paint_cabin_planks(137),
        "crane_board": lambda: paint_crane_board(138),
    }
    for name in MATS:
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
    cap = bpy.data.materials.new("cap")
    t = cap.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = image_rgba("cap_tex", np.zeros((1, 1, 3)))
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
    if getattr(m, "lines", None):
        flat = [round(c, 3) for a, b in m.lines for c in (a.x, a.y, a.z, b.x, b.y, b.z)]
        ob["rig"] = json.dumps(flat, separators=(",", ":"))
    if getattr(m, "smoke", None):
        ob["smoke"] = json.dumps([round(c, 3) for p in m.smoke for c in (p.x, p.y, p.z)])
    for k, v in (getattr(m, "extras", None) or {}).items():
        ob[k] = json.dumps(v, separators=(",", ":"))
    return ob


def cap_object(hull, name, parent):
    """The water cap: an invisible lid over the hull at its rail. The game draws it before the
    water into the stencil, and the water leaves those pixels alone, so it never shows inside a
    hull (open boats, holds, low decks in a swell). Material "cap", one n-gon."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in hull.rim()]
    try:
        f = bm.faces.new(vs)
        if f.normal.z < 0:
            f.normal_flip()
    except ValueError:
        pass
    bm.to_mesh(me)
    bm.free()
    me.materials.append(bpy.data.materials["cap"])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
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

    def outer(self, m, skip=None):
        """skip(sx, k, ta, tb): leave out that face (a gangway port in the bulwark)."""
        if hasattr(m, "hulls"):
            m.hulls.append(self)
        T = self.ts
        Z = [self.zs(t) for t in T]
        K = len(self.levels)
        m.shadefn = self.shade
        # M7 boats: the waterline's slime and the weed below it, on every hull
        tint_was = getattr(m, "tintfn", None)
        if hasattr(m, "tintfn") and getattr(self, "tint", True):
            m.tintfn = waterline_tint
        for i in range(len(T) - 1):
            ta, tb = T[i], T[i + 1]
            for k in range(K - 1):
                mat, fit = self.mats[k]
                for sx in (1, -1):
                    if skip and skip(sx, k, ta, tb):
                        continue
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
        if hasattr(m, "tintfn"):
            m.tintfn = tint_was

    def wale(self, m, zfn, t0, t1, h=0.12, out=0.06, mat=None, shade=0.8):
        """M7 boats: a wale (a thick rubbing strake) along the side from t0 to t1, its top at zfn(t)."""
        mat = DARK if mat is None else mat
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                a0, b0 = self.P(ta, zfn(ta) - h, sx), self.P(tb, zfn(tb) - h, sx)
                a1, b1 = self.P(ta, zfn(ta), sx), self.P(tb, zfn(tb), sx)
                o = V(sx * out, 0, 0)
                m.poly([a0 + o, b0 + o, b1 + o, a1 + o], mat, out=(sx, 0, 0), shade=shade,
                       uvs=[(-p.y / 1.2, p.z / 1.2) for p in (a0, b0, b1, a1)])
                m.poly([a1, b1, b1 + o, a1 + o], mat, out=(0, 0, 1), shade=shade * 1.1)
                m.poly([a0, b0, b0 + o, a0 + o], mat, out=(0, 0, -1), shade=shade * 0.6)

    def decal(self, m, t, z, w, h, sx, mat=None, u=(0.0, 1.0), off=0.03):
        """M7 boats: a cut-out picture laid on the side (rust and soot runs): centre at (t, z), w along, h down."""
        mat = STREAKS if mat is None else mat
        p = self.P(t, z, sx) + V(sx * off, 0, 0)
        tan = (self.P(min(1.0, t + 0.02), z, sx) - self.P(max(0.0, t - 0.02), z, sx)).normalized()
        r = -tan if sx > 0 else tan
        up = V(0, 0, 1)
        pts = [p - r * w / 2 - up * h, p + r * w / 2 - up * h, p + r * w / 2, p - r * w / 2]
        m.poly(pts, mat, out=(sx, 0, 0), uvs=[(u[0], 0), (u[1], 0), (u[1], 1), (u[0], 1)])

    def rim(self, drop=0.03):
        """The outline of the hull at its rail, starboard stern to bow, port bow to stern."""
        top = self.levels[-1]
        side = [self.P(t, top(t) - drop, 1) for t in self.ts]
        return side + [mirror(p, -1) for p in reversed(side)]

    def span(self, t0, t1):
        return [t0] + [t for t in self.ts if t0 + 1e-6 < t < t1 - 1e-6] + [t1]

    def deck(self, m, zfn, t0, t1, inset, mat, tile=1.6, shade=0.95):
        T = self.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            a, b = self.P(ta, zfn(ta), 1, inset), self.P(tb, zfn(tb), 1, inset)
            pts = [mirror(a, -1), a, b, mirror(b, -1)]
            m.poly(pts, mat, out=(0, 0, 1), shade=shade, uvs=[(-p.y / tile, p.x / tile) for p in pts])

    def rail(self, m, zlo, ztop, t0, t1, thick, mat, cap_mat, end0=True, end1=False, shade=0.85, skip=None):
        """The inside of the bulwark from the deck up, and the rail cap on top."""
        T = self.span(t0, t1)
        tile = TILE.get(mat, 1.6)
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                if skip and skip(sx, -1, ta, tb):
                    continue
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
    """Rope, wire or chain: a line in the game. Bars 4 cm and thicker stay solid."""
    if r >= 0.04:
        m.tube([Vector(a), Vector(b)], [r, r], 4, mat, smooth=False, urep=1, vscale=0.3)
    else:
        m.line(a, b)


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


def sail(m, h0, h1, f0, f1, belly, nu=4, nv=3, mat=CANVAS):
    """A sail set and drawing: a sheet between the head (h0 -> h1) and the foot (f0 -> f1),
    bulging by the vector `belly` in the middle (downwind). A triangle: give h0 == h1."""
    h0, h1, f0, f1, belly = Vector(h0), Vector(h1), Vector(f0), Vector(f1), Vector(belly)
    P = []
    for j in range(nv + 1):
        v = j / nv
        row = []
        for i in range(nu + 1):
            u = i / nu
            p = h0.lerp(h1, u).lerp(f0.lerp(f1, u), v)
            p = p + belly * (math.sin(math.pi * u) * math.sin(math.pi * min(1.0, 0.15 + 0.85 * v)))
            row.append(p)
        P.append(row)
    w = max((h1 - h0).length, (f1 - f0).length, 0.5)
    h = max(((f0 + f1) / 2 - (h0 + h1) / 2).length, 0.5)
    for j in range(nv):
        for i in range(nu):
            pts = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]
            uvs = [(i / nu * w / 2, -j / nv * h / 2), ((i + 1) / nu * w / 2, -j / nv * h / 2),
                   ((i + 1) / nu * w / 2, -(j + 1) / nv * h / 2), (i / nu * w / 2, -(j + 1) / nv * h / 2)]
            m.poly(pts, mat, uvs=uvs)


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


def shroud_quad(m, b0, b1, t1, t0, n=4, ratline=0.5):
    """A set of shrouds from the chains (b0..b1) up to the mast (t0..t1), with ratlines across."""
    b0, b1, t0, t1 = Vector(b0), Vector(b1), Vector(t0), Vector(t1)
    for i in range(n):
        f = i / (n - 1)
        m.line(b0.lerp(b1, f), t0.lerp(t1, f))
    h = ((b0 + b1) / 2 - (t0 + t1) / 2).length
    k = 1
    while k * ratline < h * 0.86:
        f = k * ratline / h
        m.line(b0.lerp(t0, f), b1.lerp(t1, f))
        k += 1


def name_board(m, c, right, up, w, h, row, off=0.03, mat=None):
    """A name painted on a board or straight on the hull: row of NAME_ROWS (0 = top)."""
    c, r, u = Vector(c), Vector(right).normalized(), Vector(up).normalized()
    n = r.cross(u)
    c = c + n * off
    v0, v1 = 1 - (row + 1) / 8, 1 - row / 8
    pts = [c - r * w / 2 - u * h / 2, c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, c - r * w / 2 + u * h / 2]
    m.poly(pts, NAMES if mat is None else mat, out=n, uvs=[(0, v0), (1, v0), (1, v1), (0, v1)])


def hull_name(m, hull, t, z, w, h, row, both=True, mat=None):
    """A name on the bow (or quarter) of a hull, following the planking there."""
    for sx in ((1, -1) if both else (1,)):
        p = hull.P(t, z, sx)
        tan = (hull.P(min(1.0, t + 0.02), z, sx) - hull.P(max(0.0, t - 0.02), z, sx)).normalized()
        right = -tan if sx > 0 else tan
        name_board(m, p, right, (0, 0, 1), w, h, row, off=0.04, mat=mat)


def washing_line(m, a, b, seed=1, n=5):
    """A line with washing hung out to dry: shirts, a sheet, a red cloth."""
    rnd = random.Random(seed)
    a, b = Vector(a), Vector(b)
    m.line(a, b)
    for i in range(n):
        f0 = (i + 0.3) / n
        f1 = f0 + rnd.uniform(0.35, 0.6) / n
        p0, p1 = a.lerp(b, f0) - V(0, 0, 0.03), a.lerp(b, f1) - V(0, 0, 0.03)
        hgt = rnd.uniform(0.45, 0.9)
        qx, qy = rnd.choice([(0, 0.5), (0.5, 0.5), (0, 0), (0.5, 0)])
        side = (p1 - p0).cross(V(0, 0, 1)).normalized() * rnd.uniform(-0.06, 0.06)
        m.poly([p0 - V(0, 0, hgt) + side, p1 - V(0, 0, hgt * 0.92) + side, p1, p0], WASH,
               uvs=[(qx, qy), (qx + 0.5, qy), (qx + 0.5, qy + 0.5), (qx, qy + 0.5)])


def coil(m, c, r=0.32):
    """A flaked coil of rope on deck."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.35, 0.0), (r, 0.0), (r * 1.02, 0.08), (r * 0.8, 0.13), (r * 0.35, 0.1)], 8, ROPE, smooth=False,
                urep=4, vscale=2)


FLAG_UV = {"house": (0.0, 0.5), "dutch": (0.0, 0.0), "belgian": (0.5, 0.0)}


def flag(m, top, w, h, along=(0, 1, 0), wave=0.12, kind="house"):
    """A flag hoisted at `top`, flying along `along`: two quads with a little wave."""
    top = Vector(top)
    d = Vector(along).normalized()
    side = d.cross(V(0, 0, 1)).normalized()
    up = V(0, 0, h)
    mid = top + d * (w / 2) + side * wave
    end = top + d * w - side * wave * 0.5
    u0, v0 = FLAG_UV[kind]
    m.poly([top - up, mid - up, mid, top], FLAG, uvs=[(u0, v0), (u0 + 0.25, v0), (u0 + 0.25, v0 + 0.5), (u0, v0 + 0.5)])
    m.poly([mid - up, end - up, end, mid], FLAG,
           uvs=[(u0 + 0.25, v0), (u0 + 0.5, v0), (u0 + 0.5, v0 + 0.5), (u0 + 0.25, v0 + 0.5)])


def pennant(m, top, length, along=(0, 1, 0), h=0.3):
    top = Vector(top)
    d = Vector(along).normalized()
    side = d.cross(V(0, 0, 1)).normalized()
    mid = top + d * (length * 0.5) + side * 0.08 - V(0, 0, h * 0.35)
    m.poly([top - V(0, 0, h), mid, top], FLAG, uvs=[(0.6, 0.55), (0.9, 0.75), (0.6, 0.95)])
    m.poly([mid, top + d * length - V(0, 0, h * 0.6), mid + V(0, 0, 0.05)], FLAG, uvs=[(0.7, 0.65), (0.95, 0.75), (0.7, 0.85)])


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


# Where each model's sacks are (2026-09-28: one sack model, client game/sackModel.ts): by model name, the sack's
# matrix in the model's glTF frame and its size; written to client/src/world/boats_sack_sockets.json (build_ferry.py
# writes its own). A model with sacks gets a "_bare" copy without them; the game draws the one sack model there.
SACK_SOCKETS = {}
CUR = [None]
NO_SACKS = [False]


def sack_lo(m, c, yaw=0.0, lift=0.0):
    c = Vector(c)
    M = move(c.x, c.y, c.z) @ rot_z(yaw) @ Matrix.Rotation(lift, 4, "X")
    if CUR[0] is not None and not NO_SACKS[0]:
        C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
        g = C @ (m.xf @ M) @ C.inverted()
        SACK_SOCKETS.setdefault(CUR[0], []).append(dict(k="lying", m=[round(g[r][cc], 4) for cc in range(4) for r in range(4)],
                                                       L=0.9, W=0.52, H=0.26))
    if NO_SACKS[0]:
        return
    with m.at(M):
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


# ------------------------------------------------------------------ M7 boats: small parts


def lantern(m, c, kind=0, bail=True):
    """A ship's lantern standing (or hung by its bail) with its flame at c: the town's oil lantern (2026-10-11,
    tools/blender/lantern_kit.py oil_lantern) at a ship's size. Registered for the game's lamp APIs (Mesh.lamp)."""
    c = Vector(c)
    k = lantern_kit.Kit()
    with k.at(lantern_kit.move(c.x, c.y, c.z)):
        lantern_kit.oil_lantern(k, 0.17, 0.21, bail=bail)
    bp.kit_faces(m, k.faces, {"iron": IRON, "glass": GLASS, "brass": IRON})
    m.lamp(c, kind)


def fender(m, p, sx, drop=0.45, r=0.13):
    """A rope fender hung over the side by its lanyard: a fat plaited sausage."""
    p = Vector(p)
    a = p + V(sx * (r + 0.02), 0, -0.05)
    m.line(p + V(0, 0, 0.05), a)
    m.tube([a, a - V(0, 0, drop)], [(r * 0.8, r), (r * 0.8, r)], 5, ROPE, side=(0, 1, 0), smooth=False, cap0=True, cap1=True)


def ribs(m, hull, ts, zlo, ztop, inset, w=0.04, mat=None):
    """The frames inside an open boat, keelson to gunwale, at the stations ts."""
    mat = WOOD if mat is None else mat
    for t in ts:
        z0, z1 = zlo(t), ztop(t) - 0.04
        for sx in (1, -1):
            pts = [hull.P(t, z0 + (z1 - z0) * k / 3, sx, inset + 0.01) for k in range(4)]
            for a, b in zip(pts, pts[1:]):
                m.beam(a, b, w, w * 0.8, mat, side=(0, 1, 0), shade=0.75)


def thole(m, p, gap=0.1):
    """A pair of iron thole pins on the gunwale: the oar works between them."""
    p = Vector(p)
    for dy in (-gap / 2, gap / 2):
        m.box(p + V(0, dy, 0.06), (0.03, 0.03, 0.14), IRON)


def stern_name(m, hull, t, z, w, h, row, both=True):
    """A home port or a name on a stern quarter (NAMES4)."""
    hull_name(m, hull, t, z, w, h, row, both, mat=NAMES4)


def basket(m, c, r=0.22, h=0.28, mat=None):
    """A round wicker basket."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.75, 0.0), (r, h), (r * 0.9, h - 0.02)], 7, ROPE if mat is None else mat, smooth=False, cap0=True,
                urep=2, vscale=2)


def eel_trap(m, a, b, r=0.3):
    """A fyke (eel trap): netting over wooden hoops, from its mouth a to its tail b."""
    a, b = Vector(a), Vector(b)
    n = 4
    path = [a.lerp(b, k / n) for k in range(n + 1)]
    radii = [r * (1 - 0.7 * k / n) for k in range(n + 1)]
    m.tube(path, radii, 7, NET, side=(0, 0, 1), smooth=False, urep=2, vscale=1.5)
    for k in range(n):
        p = path[k]
        d = (b - a).normalized()
        s = d.cross(V(0, 0, 1)).normalized()
        u = d.cross(s)
        ring = [p + (s * math.cos(2 * math.pi * i / 7) + u * math.sin(2 * math.pi * i / 7)) * radii[k] for i in range(7)]
        m.tube(ring, [0.015] * 7, 3, WOOD, side=d, closed_path=True, smooth=False)


def oars_stowed(m, a, b, blade_at_b=True):
    """A pair of oars laid in along the thwarts (a to b), blades aft."""
    a, b = Vector(a), Vector(b)
    for dx in (-0.09, 0.09):
        o = V(dx, 0, 0)
        m.beam(a + o, b + o, 0.045, 0.045, WOOD, side=(0, 0, 1))
        d = (b - a).normalized()
        e = b if blade_at_b else a
        s = -1 if blade_at_b else 1
        m.slab([e + o - V(0.07, 0, 0), e + o + V(0.07, 0, 0), e + o + d * s * 0.55 + V(0.07, 0, 0),
                e + o + d * s * 0.55 - V(0.07, 0, 0)], 0.02, DARK, out=(0, 0, 1))


# ---- the open boat's hull and the ship's boat carried on deck (used by the small boats, barges and ships)


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


def ships_boat(m, c, L, B, D, yaw=0.0, mat=WHITE, cover=CANVAS):
    """A ship's boat under a canvas cover, for davits and deckhouse roofs. c = keel bottom centre."""
    hull, keel, sheer = boat_hull(L, B, D, mat, stern_w=0.35)
    k = -keel(0.5)
    with m.at(move(c[0], c[1], c[2] + k) @ rot_z(yaw)):
        hull.outer(m)
        hull.deck(m, lambda t: sheer(t) - 0.02, 0, 1, 0.0, cover, tile=1.0)
    return hull
