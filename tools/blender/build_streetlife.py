"""Street life of Antwerp, 1873: the small things on and in front of the houses.

    blender -b --factory-startup -P tools/blender/build_streetlife.py
    blender -b --factory-startup -P tools/blender/build_streetlife.py -- --preview

Writes client/public/models/streetlife.glb (Draco). One node per model ("prototype"),
real scale in metres; client/src/world/streetlife.ts places copies of them along the
city's house fronts, merged per chunk. What is in it:

  signs      painted signboards with the trade or the owner's name (board_*), painted
             lettering straight on plaster (letters_*, a decal), iron bracket signs with
             a boot, a pretzel, a key, a tankard, a barber's basin, a hat (hang_*)
  awnings    striped canvas over the shop windows (awning_<bays>_<colour>)
  madonna    corner Madonnas (three kinds: a stone niche, a painted statue on a corbel, a glazed
             shrine box), each under a canopy with stars and a fringe, the lantern on an arm beside
  water      a cast-iron pump, a blue-stone pump, the wrought-iron well of the
             Handschoenmarkt (Quinten Matsijs' well on its square stone well of 1873), a stone horse trough
  washing    garments (cloth_*) for lines across narrow lanes, poles out of windows
  walls      posters and bills (poster_*), street name plates (plate_*), house numbers
             (number_*), doorsteps, cellar hatches, boot scrapers
  ground     straw, dung, oily stains, puddles (flat decals)

Frames. Blender is Z-up and the export turns it Y-up: Blender (x, y, z) is game
(x, z, -y). Things on a wall have their origin on the wall at the foot of the wall;
they stick out toward -Y in Blender, which is +Z in the game (the wall's outward
normal), and run along X. Free-standing things (pumps, the well, the trough) stand
on the ground at their origin, their front (the spout) toward -Y. Garments hang
from their origin (a point on the line). Wash poles start at their origin on the wall.

Materials, by name: sl_solid (one 256 px atlas for everything solid), sl_decal (an
RGBA atlas for flat things pasted on walls or the ground), sl_puddle (same atlas,
drawn as water), sl_glow (lantern glass). The vertex colour "Col" carries a baked
shade. All textures are painted by the functions below, nearest filter; the letters
come from a 5x7 pixel font drawn in this file. Our own work: no downloaded models,
images or fonts. Period photos were looked at for what things looked like, reference
only.

An empty node "streetlife_meta" carries, in its extras (JSON): the atlas cells, the
trades (which board, lettering, bracket sign and awning a shop gets), and the city's
house walls and corners from shared/city_build.json (tools/city/plan.py), so the
game needs no extra file. Rebuild this after the city.

--preview renders the models to data/shots/streetlife_preview.png and a made-up
street front to data/shots/streetlife_street.png.
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

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "streetlife.glb")
SRC = os.path.join(ROOT, "shared", "city_build.json")
SHOTS = os.path.join(ROOT, "data", "shots")

SOLID, DECAL, PUDDLE, GLOW = range(4)
MAT_NAMES = ["sl_solid", "sl_decal", "sl_puddle", "sl_glow"]

GROUND_H = 3.8  # height of the ground storey (city_build.json ground_h)
PX = 0.036  # metres per texel of lettering on boards

# ------------------------------------------------------------------ pixel font (5x7, our own)

GLYPHS = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "C": [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "G": [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"],
    "H": ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "I": [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "J": ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "M": ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
    "N": ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "P": ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
    "Q": [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "S": [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
    "U": ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "V": ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
    "W": ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "Y": ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
    "Z": ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
    "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
    "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
    "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
    "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
    "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
    "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
    "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
    "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
    "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
    "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
    ".": [".", ".", ".", ".", ".", ".", "#"],
    ",": ["..", "..", "..", "..", "..", ".#", "#."],
    "'": ["#", "#", ".", ".", ".", ".", "."],
    "-": ["...", "...", "...", "###", "...", "...", "..."],
    "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
    "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
    " ": ["...", "...", "...", "...", "...", "...", "..."],
}


def text_width(s):
    return sum(len(GLYPHS[c][0]) + 1 for c in s) - 1


def draw_text(img, s, x, y, rgba, scale=1):
    """Letters into an image array [row, col, ch] with the top left of the text at (x, y)."""
    for c in s:
        g = GLYPHS[c]
        for r, row in enumerate(g):
            for k, ch in enumerate(row):
                if ch == "#":
                    for dy in range(scale):
                        for dx in range(scale):
                            yy, xx = y + r * scale + dy, x + k * scale + dx
                            if 0 <= yy < img.shape[0] and 0 <= xx < img.shape[1]:
                                img[yy, xx, : len(rgba)] = rgba
        x += (len(g[0]) + 1) * scale


# ------------------------------------------------------------------ painting helpers


def vnoise(rng, w, h, cu, cv):
    """Tileable value noise, [h, w]."""
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


def flat(seed, w, h, rgb, amt=0.18, cells=4):
    rng = np.random.default_rng(seed)
    n = vnoise(rng, w, h, cells, cells) * 0.6 + vnoise(rng, w, h, cells * 4, cells * 4) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (1 - amt + 2 * amt * n)[..., None]
    m = rng.random((h, w)) < 0.06
    img[m, :3] *= 0.8
    return img


def wood_board(seed, w, h, rgb):
    rng = np.random.default_rng(seed)
    grain = vnoise(rng, w, h, 3, max(2, h // 2)) * 0.6 + vnoise(rng, w, h, 8, h) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (0.8 + 0.35 * grain)[..., None]
    # weathering: paint worn toward the edges and a few flakes
    flakes = rng.random((h, w)) < 0.03
    img[flakes, :3] *= 1.5
    return img


# ------------------------------------------------------------------ the atlases


class Atlas:
    """Shelf-packed atlas; cells are (x, y, w, h) in pixels from the top left."""

    def __init__(self, width):
        self.W = width
        self.items = []  # (name, array)
        self.cells = {}

    def add(self, name, arr):
        self.items.append((name, arr))

    def pack(self):
        order = sorted(self.items, key=lambda it: (-it[1].shape[0], -it[1].shape[1]))
        x = y = shelf = 0
        placed = []
        for name, a in order:
            h, w = a.shape[:2]
            if x + w > self.W:
                x, y, shelf = 0, y + shelf, 0
            placed.append((name, a, x, y))
            self.cells[name] = (x, y, w, h)
            x += w
            shelf = max(shelf, h)
        H = 1
        while H < y + shelf:
            H *= 2
        self.H = H
        img = np.zeros((H, self.W, 4))
        for name, a, x0, y0 in placed:
            h, w = a.shape[:2]
            img[y0:y0 + h, x0:x0 + w] = a
        self.img = img
        return self

    def uv(self, name, u, v):
        """Cell-local (u, v), v up, to Blender UV (v up from the image bottom)."""
        x, y, w, h = self.cells[name]
        U = (x + 0.5 + min(max(u, 0.0), 1.0) * (w - 1)) / self.W
        row = y + 0.5 + (1 - min(max(v, 0.0), 1.0)) * (h - 1)
        return (U, 1 - row / self.H)


SOLID_ATLAS = Atlas(256)
DECAL_ATLAS = Atlas(256)

# plain materials, 16 or 32 px (rgb, noise)
PLAIN = {
    "iron": ((0.10, 0.10, 0.11), 0.3),
    "iron_green": ((0.10, 0.16, 0.12), 0.3),
    "gold": ((0.72, 0.54, 0.20), 0.25),
    "brass": ((0.62, 0.48, 0.24), 0.2),
    "pewter": ((0.48, 0.49, 0.50), 0.2),
    "bluestone": ((0.30, 0.32, 0.34), 0.25),
    "whitestone": ((0.70, 0.67, 0.60), 0.2),
    "plaster": ((0.80, 0.78, 0.72), 0.12),
    "wood": ((0.40, 0.31, 0.21), 0.3),
    "wood_dark": ((0.20, 0.14, 0.10), 0.3),
    "robe_blue": ((0.20, 0.30, 0.55), 0.15),
    "robe_white": ((0.85, 0.83, 0.78), 0.1),
    "skin": ((0.80, 0.62, 0.50), 0.08),
    "black": ((0.06, 0.06, 0.06), 0.2),
    "red_paint": ((0.45, 0.10, 0.08), 0.2),
    "green_paint": ((0.14, 0.26, 0.18), 0.2),
    "glass": ((1.0, 0.85, 0.55), 0.1),
    "water_dark": ((0.09, 0.11, 0.11), 0.2),
    "rope": ((0.46, 0.40, 0.30), 0.25),
    "slate": ((0.22, 0.24, 0.26), 0.2),
    "linen_white": ((0.86, 0.85, 0.80), 0.08),
    "linen_cream": ((0.80, 0.74, 0.60), 0.1),
    "cloth_blue": ((0.24, 0.30, 0.44), 0.12),
    "cloth_red": ((0.55, 0.16, 0.12), 0.12),
    "cloth_grey": ((0.42, 0.41, 0.38), 0.12),
    "cloth_brown": ((0.36, 0.26, 0.18), 0.12),
    # M6 lively: the Madonnas' canopies and flowers, the well's bronze
    "canopy_blue": ((0.16, 0.24, 0.42), 0.15),
    "flower_red": ((0.66, 0.12, 0.10), 0.2),
    "flower_white": ((0.86, 0.84, 0.78), 0.12),
    "leaf": ((0.16, 0.30, 0.12), 0.25),
    "bronze": ((0.36, 0.28, 0.16), 0.25),
    "polychrome": ((0.62, 0.20, 0.16), 0.15),
}

# awning stripes: (stripe colour, ground colour)
AWNINGS = [((0.55, 0.14, 0.10), (0.80, 0.74, 0.60)), ((0.16, 0.32, 0.20), (0.80, 0.76, 0.64)),
           ((0.24, 0.30, 0.42), (0.76, 0.75, 0.70)), ((0.42, 0.28, 0.14), (0.72, 0.58, 0.32))]

# Trades. Plain English trade words; Dutch only as proper names (owners, tavern names).
# board: lines on the board; colours: board, letters, trim. hang: bracket sign. awning: chance.
# where: quay, market or any (the game weights them by where the house is).
TRADES = [
    dict(key="bakery", lines=["BAKERY"], bg=(0.10, 0.18, 0.12), fg=(0.85, 0.72, 0.36), hang="pretzel", awning=0.5, where="any"),
    dict(key="grocer", lines=["J. JANSSENS", "GROCER"], bg=(0.08, 0.08, 0.07), fg=(0.84, 0.76, 0.52), hang=None, awning=0.8, where="market"),
    dict(key="tavern_leuven", lines=["IN DE STAD LEUVEN", "BEER - WINE - SPIRITS"], bg=None, fg=(0.10, 0.09, 0.08), hang="tankard", awning=0.0,
         where="quay", painted=True),
    dict(key="tavern_zwaan", lines=["IN DE ZWAAN"], bg=(0.36, 0.08, 0.06), fg=(0.88, 0.80, 0.56), hang="tankard", awning=0.2, where="any"),
    dict(key="tavern_schip", lines=["IN HET SCHIP"], bg=(0.10, 0.14, 0.22), fg=(0.86, 0.80, 0.62), hang="tankard", awning=0.0, where="quay"),
    dict(key="butcher", lines=["BUTCHER"], bg=(0.40, 0.08, 0.06), fg=(0.90, 0.86, 0.74), hang=None, awning=0.7, where="market"),
    dict(key="chandler", lines=["P. DE WIT", "SHIP CHANDLER"], bg=(0.08, 0.09, 0.10), fg=(0.82, 0.78, 0.66), hang=None, awning=0.3, where="quay"),
    dict(key="tobacco", lines=["TOBACCO"], bg=(0.26, 0.16, 0.08), fg=(0.88, 0.76, 0.42), hang=None, awning=0.5, where="any"),
    dict(key="coffee", lines=["COFFEE - TEA"], bg=(0.08, 0.08, 0.07), fg=(0.80, 0.66, 0.34), hang=None, awning=0.6, where="market"),
    dict(key="cooper", lines=["COOPER"], bg=(0.30, 0.22, 0.14), fg=(0.92, 0.88, 0.76), hang=None, awning=0.0, where="quay", painted=True),
    dict(key="sailmaker", lines=["SAILMAKER"], bg=None, fg=(0.12, 0.12, 0.14), hang=None, awning=0.0, where="quay", painted=True),
    dict(key="ropemaker", lines=["H. VERHAEGEN", "ROPE AND TAR"], bg=(0.10, 0.12, 0.10), fg=(0.84, 0.80, 0.64), hang=None, awning=0.0, where="quay"),
    dict(key="chemist", lines=["CHEMIST"], bg=(0.10, 0.16, 0.26), fg=(0.90, 0.86, 0.74), hang=None, awning=0.4, where="market"),
    dict(key="wine", lines=["WINE AND SPIRITS"], bg=(0.24, 0.06, 0.06), fg=(0.86, 0.72, 0.38), hang="tankard", awning=0.3, where="any"),
    dict(key="lodgings", lines=["LODGINGS"], bg=None, fg=(0.14, 0.10, 0.08), hang=None, awning=0.0, where="quay", painted=True),
    dict(key="bootmaker", lines=["BOOTMAKER"], bg=(0.08, 0.08, 0.07), fg=(0.88, 0.84, 0.72), hang="boot", awning=0.3, where="any"),
    dict(key="locksmith", lines=["LOCKSMITH"], bg=(0.14, 0.14, 0.14), fg=(0.80, 0.70, 0.40), hang="key", awning=0.0, where="any"),
    dict(key="barber", lines=["BARBER"], bg=None, fg=(0.30, 0.08, 0.06), hang="basin", awning=0.0, where="any", painted=True),
    dict(key="hatter", lines=["A. MERTENS", "HATTER"], bg=(0.12, 0.10, 0.16), fg=(0.84, 0.78, 0.60), hang="hat", awning=0.4, where="market"),
    dict(key="draper", lines=["LINEN AND CLOTH"], bg=(0.14, 0.20, 0.16), fg=(0.88, 0.84, 0.70), hang=None, awning=0.8, where="market"),
    dict(key="fish", lines=["FISHMONGER"], bg=(0.14, 0.22, 0.28), fg=(0.90, 0.88, 0.80), hang=None, awning=0.6, where="quay"),
    dict(key="coal", lines=["COAL AND PEAT"], bg=None, fg=(0.10, 0.10, 0.10), hang=None, awning=0.0, where="quay", painted=True),
    dict(key="corn", lines=["CORN AND SEED"], bg=(0.30, 0.24, 0.12), fg=(0.90, 0.84, 0.60), hang=None, awning=0.3, where="market"),
    dict(key="clockmaker", lines=["CLOCKMAKER"], bg=(0.08, 0.08, 0.07), fg=(0.84, 0.72, 0.40), hang=None, awning=0.2, where="any"),
]

STREET_NAMES = ["OUDE BEURS", "ZAKSTRAAT", "KAASRUI", "SUIKERRUI", "HOOGSTRAAT", "VLASMARKT", "PELGRIMSTRAAT", "KAASSTRAAT",
                "PALINGBRUG", "BRADERIJSTRAAT", "BURCHTGRACHT", "STOELSTRAAT", "REPENSTRAAT", "KUIPERSSTRAAT", "ZIRKSTRAAT",
                "MATTENSTRAAT", "HAVERMARKT", "MAALDERIJSTRAAT", "WIJNGAARDSTRAAT", "BROUWERSVLIET"]
SQUARE_NAMES = ["GROTE MARKT", "VISMARKT", "STEENPLEIN", "HANDSCHOENMARKT", "RIJNKAAI", "WERF"]
NUMBERS = ["3", "7", "9", "12", "14", "17", "21", "23", "28", "31", "36", "40", "45", "52"]

POSTERS = [
    dict(key="redstar", paper=(0.86, 0.82, 0.72), ink=(0.62, 0.10, 0.08), lines=["RED", "STAR", "LINE"], star=True, tail=["NEW YORK"]),
    dict(key="sale", paper=(0.84, 0.80, 0.62), ink=(0.10, 0.09, 0.08), lines=["PUBLIC", "SALE"], tail=[]),
    dict(key="dockers", paper=(0.80, 0.78, 0.70), ink=(0.12, 0.12, 0.16), lines=["DOCKERS", "WANTED"], tail=[]),
    dict(key="circus", paper=(0.88, 0.70, 0.52), ink=(0.40, 0.10, 0.10), lines=["CIRCUS"], ring=True, tail=[]),
    dict(key="lottery", paper=(0.72, 0.76, 0.80), ink=(0.10, 0.12, 0.30), lines=["LOTTERY"], tail=["1873"]),
    dict(key="notice", paper=(0.90, 0.88, 0.80), ink=(0.08, 0.08, 0.08), lines=["NOTICE"], crest=True, tail=[]),
]


def paint_board(t, seed):
    """A signboard face: wood painted in the board colour, lettering, a thin border."""
    lines = t["lines"]
    tw = max(text_width(s) for s in lines)
    w = max(56, tw + 10)
    h = 11 if len(lines) == 1 else 20
    img = wood_board(seed, w, h, t["bg"])
    img[0, :, :3] *= 0.5
    img[-1, :, :3] *= 0.5
    img[1, 1:-1, :3] = np.array(t["fg"]) * 0.8
    img[-2, 1:-1, :3] = np.array(t["fg"]) * 0.8
    img[1:-1, 1, :3] = np.array(t["fg"]) * 0.8
    img[1:-1, -2, :3] = np.array(t["fg"]) * 0.8
    for i, s in enumerate(lines):
        draw_text(img, s, (w - text_width(s)) // 2, 2 + i * 9, t["fg"])
    rng = np.random.default_rng(seed + 5)
    worn = rng.random((h, w)) < 0.05
    img[worn, :3] = img[worn, :3] * 0.7 + np.array(t["bg"]) * 0.3
    return img


def paint_letters(t, seed):
    """Lettering painted straight onto the plaster: alpha only where the paint is."""
    lines = t["lines"]
    tw = max(text_width(s) for s in lines)
    w = tw + 4
    h = 11 if len(lines) == 1 else 20
    img = np.zeros((h, w, 4))
    for i, s in enumerate(lines):
        draw_text(img, s, (w - text_width(s)) // 2, 2 + i * 9, (*t["fg"], 1.0))
    rng = np.random.default_rng(seed)
    faded = (img[..., 3] > 0) & (rng.random((h, w)) < 0.18)
    img[faded, 3] = 0.45
    return img


def paint_plate(name, seed):
    """Enamel street name plate: white, blue letters, a blue border, chips."""
    w = text_width(name) + 8
    h = 11
    img = flat(seed, w, h, (0.88, 0.88, 0.84), 0.05)
    blue = (0.10, 0.16, 0.38)
    img[0, :, :3] = img[-1, :, :3] = blue
    img[:, 0, :3] = img[:, -1, :3] = blue
    img[1, 1:-1, :3] = img[-2, 1:-1, :3] = (0.7, 0.72, 0.74)
    draw_text(img, name, 4, 2, blue)
    rng = np.random.default_rng(seed)
    for _ in range(3):
        x, y = int(rng.integers(0, w)), int(rng.choice([0, h - 1]))
        img[y, x, :3] = (0.05, 0.05, 0.06)
    return img


def paint_number(n, seed):
    w = text_width(n) + 6
    h = 11
    img = flat(seed, w, h, (0.10, 0.14, 0.30), 0.08)
    draw_text(img, n, 3, 2, (0.9, 0.9, 0.86))
    return img


def paint_stripes(seed, stripe, ground):
    """Awning canvas: 4 stripes across 32 px, running down the slope; faded, stained."""
    rng = np.random.default_rng(seed)
    img = np.ones((32, 32, 4))
    for x in range(32):
        img[:, x, :3] = stripe if (x // 4) % 2 == 0 else ground
    n = vnoise(rng, 32, 32, 4, 4)
    img[..., :3] *= (0.82 + 0.3 * n)[..., None]
    # rain streaks and soot toward the front edge (v down = the bottom rows)
    img[..., :3] *= (1 - 0.25 * (np.arange(32) / 31) ** 2)[:, None, None]
    return img


def paint_valance(seed, stripe, ground):
    """The hanging front flap: stripes and a scalloped hem (dark below the scallops)."""
    img = paint_stripes(seed, stripe, ground)[:10].copy()
    for x in range(32):
        d = int(2 + 2 * abs(math.sin(math.pi * x / 8)))
        img[10 - d:, x, :3] *= 0.35
    img[0, :, :3] *= 0.7
    return img


def paint_cloth(seed, rgb, ticking=False):
    img = flat(seed, 32, 32, rgb, 0.08)
    if ticking:
        for x in range(0, 32, 6):
            img[:, x:x + 2, :3] = np.array((0.24, 0.30, 0.46)) * 0.9
    img[-2:, :, :3] *= 0.8  # a damp hem
    return img


def paint_poster(p, seed):
    """A bill: paper, headline, fine print as grey dashes, torn and weathered edges."""
    rng = np.random.default_rng(seed)
    w, h = 64, 88
    img = flat(seed, w, h, p["paper"], 0.08)
    ink = np.array(p["ink"])
    y = 5
    for s in p["lines"]:
        scale = 2 if text_width(s) * 2 <= w - 6 else 1
        draw_text(img, s, (w - text_width(s) * scale) // 2, y, (*ink, 1), scale)
        y += 8 * scale + 2
    if p.get("star"):
        cx, cy, R = w // 2, y + 7, 7
        for yy in range(h):
            for xx in range(w):
                a = math.atan2(yy - cy, xx - cx)
                r = math.hypot(xx - cx, yy - cy)
                edge = R * (0.55 + 0.45 * abs(math.cos(2.5 * (a + math.pi / 2))))
                if r < edge:
                    img[yy, xx, :3] = (0.70, 0.12, 0.10)
        y += 16
    if p.get("ring"):
        cx, cy = w // 2, y + 10
        for yy in range(h):
            for xx in range(w):
                r = math.hypot(xx - cx, yy - cy)
                if 7 < r < 10:
                    img[yy, xx, :3] = ink
                elif r < 5:
                    img[yy, xx, :3] = (0.75, 0.55, 0.15)
        y += 23
    if p.get("crest"):
        img[y:y + 12, w // 2 - 5:w // 2 + 5, :3] = ink * 0.8 + 0.2 * np.array((0.6, 0.1, 0.1))
        img[y + 12:y + 15, w // 2 - 3:w // 2 + 3, :3] = ink
        y += 18
    for s in p.get("tail", []):
        draw_text(img, s, (w - text_width(s)) // 2, y, (*ink, 1))
        y += 10
    # fine print
    while y < h - 8:
        x = 6
        while x < w - 6:
            L = int(rng.integers(2, 7))
            img[y, x:min(x + L, w - 6), :3] = img[y, x:min(x + L, w - 6), :3] * 0.4 + ink * 0.4
            x += L + 2
        y += 3
    # damp and dirt from the bottom, paper yellowed
    img[..., :3] *= (1 - 0.3 * (np.arange(h) / h) ** 3)[:, None, None]
    # torn edges: ragged alpha on all sides, a big tear at a bottom corner now and then
    n = vnoise(rng, w, h, 8, 10)
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    edge = np.minimum(np.minimum(uu, w - 1 - uu), np.minimum(vv, h - 1 - vv))
    img[..., 3] = np.where(edge + n * 3 < 1.6, 0.0, 1.0)
    if rng.random() < 0.6:
        cx = rng.choice([0, w])
        r = rng.uniform(14, 26)
        tear = np.hypot(uu - cx, vv - h) + n * 8 < r
        img[tear, 3] = 0
    return img


def paint_damp(seed, moss=False, salt=False):
    """The wet band at the foot of a wall: dark, a ragged tide mark, green on some walls.
    salt: for brick, the pale bloom of salts that rising damp leaves on old brick."""
    rng = np.random.default_rng(seed)
    w, h = 64, 32
    img = np.zeros((h, w, 4))
    n = vnoise(rng, w, h, 8, 1) * 0.7 + vnoise(rng, w, h, 24, 2) * 0.3
    top = 4 + n[0] * 14  # tide mark height from the top row, per column
    vv = np.arange(h)[:, None]
    depth = np.clip((vv - top[None, :]) / (h - top[None, :]), 0, 1)
    a = 0.25 + 0.5 * depth ** 0.7
    edge = np.abs(vv - top[None, :]) < 1.2
    img[..., :3] = (0.08, 0.08, 0.06)
    img[..., 3] = np.where(vv >= top[None, :], a, 0)
    img[edge, 3] = 0.4
    img[edge, :3] = (0.14, 0.13, 0.10)
    if salt:
        n2 = vnoise(rng, w, h, 20, 8)
        bloom = (np.abs(vv - top[None, :] - 1.5) < 2.2) & (n2 > 0.5)
        img[bloom, :3] = (0.60, 0.58, 0.53)
        img[bloom, 3] = 0.32
        low = (vv > top[None, :] + 6) & (n2 > 0.72)
        img[low, :3] = (0.5, 0.48, 0.44)
        img[low, 3] = 0.18
    if moss:
        m = (vnoise(rng, w, h, 16, 8) > 0.55) & (vv > top[None, :] + 4)
        img[m, :3] = (0.12, 0.20, 0.07)
        img[m, 3] = 0.85
    return img


def paint_straw(seed):
    rng = np.random.default_rng(seed)
    w = h = 32
    img = np.zeros((h, w, 4))
    for _ in range(70):
        x, y = rng.uniform(4, 28, 2)
        a = rng.uniform(0, math.pi)
        L = rng.uniform(3, 9)
        col = np.array((0.62, 0.52, 0.28)) * rng.uniform(0.6, 1.1)
        for s in np.linspace(0, L, int(L * 2)):
            xx, yy = int(x + math.cos(a) * s), int(y + math.sin(a) * s)
            if 0 <= xx < w and 0 <= yy < h and math.hypot(xx - 16, yy - 16) < 15:
                img[yy, xx, :3] = col
                img[yy, xx, 3] = 1
    return img


def paint_dung(seed):
    rng = np.random.default_rng(seed)
    w = h = 16
    img = np.zeros((h, w, 4))
    for _ in range(3):
        cx, cy, r = rng.uniform(5, 11), rng.uniform(5, 11), rng.uniform(2.5, 4.5)
        uu, vv = np.meshgrid(np.arange(w), np.arange(h))
        d = np.hypot(uu - cx, vv - cy) / r
        m = d < 1
        img[m, :3] = np.array((0.16, 0.12, 0.07))[None, :] * (0.7 + 0.5 * (1 - d[m]))[:, None]
        img[m, 3] = 1
    return img


def paint_puddle(seed):
    """Puddle shape: alpha is the water; colour is a light rim (the game tints it with the sky)."""
    rng = np.random.default_rng(seed)
    w, h = 48, 32
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    n = vnoise(rng, w, h, 5, 4)
    d = np.hypot((uu - w / 2) / (w / 2), (vv - h / 2) / (h / 2)) + (n - 0.5) * 0.6
    img = np.zeros((h, w, 4))
    img[..., :3] = 1.0
    img[..., 3] = np.clip((0.85 - d) * 6, 0, 1) * 0.9
    ring = (d > 0.72) & (d < 0.85)
    img[ring, :3] = 0.6
    return img


def paint_stain(seed):
    rng = np.random.default_rng(seed)
    w = h = 32
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    n = vnoise(rng, w, h, 4, 4)
    d = np.hypot(uu - 16, vv - 16) / 16 + (n - 0.5) * 0.7
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.06, 0.06, 0.05)
    img[..., 3] = np.clip((0.9 - d) * 2.2, 0, 0.55)
    return img


def build_atlases():
    for i, (name, (rgb, amt)) in enumerate(PLAIN.items()):
        size = 32 if name in ("bluestone", "whitestone", "plaster", "wood", "wood_dark", "iron") else 16
        SOLID_ATLAS.add(name, flat(100 + i, size, size, rgb, amt))
    for i, (s, g) in enumerate(AWNINGS):
        SOLID_ATLAS.add(f"stripes_{i}", paint_stripes(200 + i, s, g))
        SOLID_ATLAS.add(f"valance_{i}", paint_valance(200 + i, s, g))
    for i, t in enumerate(TRADES):
        if t.get("bg") is not None:
            SOLID_ATLAS.add(f"board_{t['key']}", paint_board(t, 300 + i))
        else:
            DECAL_ATLAS.add(f"letters_{t['key']}", paint_letters(t, 300 + i))
    for i, n in enumerate(STREET_NAMES + SQUARE_NAMES):
        SOLID_ATLAS.add(f"plate_{i}", paint_plate(n, 400 + i))
    for i, n in enumerate(NUMBERS):
        SOLID_ATLAS.add(f"number_{i}", paint_number(n, 500 + i))
    SOLID_ATLAS.add("ticking", paint_cloth(600, (0.84, 0.82, 0.76), ticking=True))
    for i, p in enumerate(POSTERS):
        DECAL_ATLAS.add(f"poster_{p['key']}", paint_poster(p, 700 + i))
    DECAL_ATLAS.add("damp_0", paint_damp(800))
    DECAL_ATLAS.add("damp_1", paint_damp(801))
    DECAL_ATLAS.add("moss_0", paint_damp(802, moss=True))
    DECAL_ATLAS.add("salt_0", paint_damp(803, salt=True))
    for i in range(3):
        DECAL_ATLAS.add(f"straw_{i}", paint_straw(810 + i))
    for i in range(2):
        DECAL_ATLAS.add(f"dung_{i}", paint_dung(820 + i))
    for i in range(3):
        DECAL_ATLAS.add(f"puddle_{i}", paint_puddle(830 + i))
    DECAL_ATLAS.add("stain_0", paint_stain(840))
    SOLID_ATLAS.pack()
    DECAL_ATLAS.pack()


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
    solid = bl_image("sl_solid_tex", SOLID_ATLAS.img, False)
    decal = bl_image("sl_decal_tex", DECAL_ATLAS.img, True)
    for name, img in zip(MAT_NAMES, [solid, decal, decal, solid]):
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if img is decal:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def fit_uv(pts):
    """0..1 over the face: v up (or along the long edge on flat faces)."""
    n = newell(pts)
    n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
    if abs(n.z) < 0.7:
        va = Vector((0, 0, 1))
        va = (va - n * va.dot(n)).normalized()
        ua = va.cross(n)
    else:
        e = max(((pts[(i + 1) % len(pts)] - pts[i]) for i in range(len(pts))), key=lambda v: v.length)
        ua = (e - n * e.dot(n)).normalized()
        va = n.cross(ua)
    c = [(p.dot(ua), p.dot(va)) for p in pts]
    u0, u1 = min(a for a, _ in c), max(a for a, _ in c)
    v0, v1 = min(b for _, b in c), max(b for _, b in c)
    return [((a - u0) / max(u1 - u0, 1e-6), (b - v0) / max(v1 - v0, 1e-6)) for a, b in c]


class Mesh:
    """bmesh with atlas cells: every face gets a cell name and cell-local uvs (0..1)."""

    def __init__(self, ao=0.0):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.xf = Matrix.Identity(4)
        self.ao = ao

    def at(self, M):
        m = self

        class Ctx:
            def __enter__(self_):
                self_.old = m.xf
                m.xf = m.xf @ M

            def __exit__(self_, *a):
                m.xf = self_.old

        return Ctx()

    def face(self, pts, cell, uvs=None, mat=SOLID, shade=1.0, out=None):
        pts = [Vector(p) for p in pts]
        if out is not None and newell(pts).dot(Vector(out)) < 0:
            pts = pts[::-1]
            if uvs:
                uvs = uvs[::-1]
        uvs = uvs or fit_uv(pts)
        vs = [self.bm.verts.new(self.xf @ p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        atlas = DECAL_ATLAS if mat in (DECAL, PUDDLE) else SOLID_ATLAS
        for loop, (u, v), p in zip(f.loops, uvs, pts):
            loop[self.uv].uv = atlas.uv(cell, u, v)
            s = shade
            if self.ao > 0:
                s *= 0.55 + 0.45 * min(1.0, max(0.0, (self.xf @ p).z / self.ao))
            loop[self.col] = (s, s, s, 1.0)
        return f

    def box(self, c, size, cell, shade=1.0, cells=None, skip=()):
        """Axis box; cells may override per face: keys -x +x -y +y -z +z."""
        cx, cy, cz = c
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        P = [Vector((cx + (sx if i & 1 else -sx), cy + (sy if i & 2 else -sy), cz + (sz if i & 4 else -sz))) for i in range(8)]
        faces = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}
        for k, idx in faces.items():
            if k in skip:
                continue
            ce = (cells or {}).get(k, cell)
            pts = [P[i] for i in idx]
            self.face(pts, ce, shade=shade * (0.8 if k == "-z" else 1.0))

    def beam(self, a, b, w, h, cell, shade=1.0, side=None):
        a, b = Vector(a), Vector(b)
        t = (b - a).normalized()
        s = Vector(side) if side else Vector((0, 0, 1)).cross(t)
        if s.length < 1e-4:
            s = Vector((1, 0, 0))
        s = (s - t * s.dot(t)).normalized()
        k = s.cross(t)
        P = []
        for i in range(8):
            base = b if i & 2 else a
            P.append(base + s * (w / 2 if i & 1 else -w / 2) + k * (h / 2 if i & 4 else -h / 2))
        for idx in ((0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5), (0, 2, 3, 1), (4, 5, 7, 6)):
            pts = [P[i] for i in idx]
            c = sum(pts, Vector()) / 4
            mid = (a + b) / 2
            self.face(pts, cell, shade=shade, out=c - mid if (c - mid).length > 1e-6 else None)

    def lathe(self, prof, sides, cell, rot=0.0, cap0=False, cap1=False, shade=1.0, arc=None, cells=None, M=None):
        """Turned shape about +Z; profile (r, z) bottom to top. arc: (a0, a1) for part of a turn.
        M: a transform for the whole shape (it is turned about its own +Z first)."""
        if M is not None:
            with self.at(M):
                return self.lathe(prof, sides, cell, rot=rot, cap0=cap0, cap1=cap1, shade=shade, arc=arc, cells=cells)
        a0, a1 = arc if arc else (0.0, 2 * math.pi)
        full = arc is None
        n = sides if full else sides + 1
        rings = [[Vector((r * math.cos(rot + a0 + (a1 - a0) * i / sides), r * math.sin(rot + a0 + (a1 - a0) * i / sides), z)) for i in range(n)]
                 for r, z in prof]
        L = [0.0]
        for j in range(1, len(prof)):
            L.append(L[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
        tot = L[-1] or 1
        for j in range(len(rings) - 1):
            ce = cells[j] if cells else cell
            for i in range(sides):
                i1 = (i + 1) % n
                pts = [rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]]
                uvs = [(i / sides, L[j] / tot), ((i + 1) / sides, L[j] / tot), ((i + 1) / sides, L[j + 1] / tot), (i / sides, L[j + 1] / tot)]
                mid = sum(pts, Vector()) / 4
                self.face(pts, ce, uvs=uvs, shade=shade, out=mid - Vector((0, 0, mid.z)))
        if cap0 and full and prof[0][0] > 1e-4:
            self.face(rings[0], cells[0] if cells else cell, shade=shade * 0.8, out=(0, 0, -1))
        if cap1 and full and prof[-1][0] > 1e-4:
            self.face(rings[-1], cells[-1] if cells else cell, shade=shade, out=(0, 0, 1))

    def tube(self, path, r, sides, cell, closed=False, shade=1.0):
        path = [Vector(p) for p in path]
        N = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed:
                t = path[(k + 1) % N] - path[(k - 1) % N]
            else:
                t = path[min(k + 1, N - 1)] - path[max(k - 1, 0)]
            t.normalize()
            s = Vector((1, 0, 0))
            if abs(s.dot(t)) > 0.9:
                s = Vector((0, 1, 0))
            s = (s - t * s.dot(t)).normalized()
            b = t.cross(s)
            rings.append([p + s * r * math.cos(2 * math.pi * i / sides) + b * r * math.sin(2 * math.pi * i / sides) for i in range(sides)])
        seg = range(N) if closed else range(N - 1)
        for j in seg:
            j1 = (j + 1) % N
            for i in range(sides):
                i1 = (i + 1) % sides
                pts = [rings[j][i], rings[j][i1], rings[j1][i1], rings[j1][i]]
                mid = sum(pts, Vector()) / 4
                c = (path[j] + path[j1]) / 2
                self.face(pts, cell, uvs=[(i / sides, 0), ((i + 1) / sides, 0), ((i + 1) / sides, 1), (i / sides, 1)], shade=shade, out=mid - c)

    def prism(self, outline, depth, cell, side_cell=None, shade=1.0):
        """A flat outline (a, b) in the plane out of the wall: Blender (x, -a, b), `depth` thick along X."""
        front = [Vector((-depth / 2, -a, b)) for a, b in outline]
        back = [Vector((depth / 2, -a, b)) for a, b in outline]
        amin = min(a for a, _ in outline)
        amax = max(a for a, _ in outline)
        bmin = min(b for _, b in outline)
        bmax = max(b for _, b in outline)
        uvs = [((a - amin) / (amax - amin), (b - bmin) / (bmax - bmin)) for a, b in outline]
        self.face(front, cell, uvs=uvs, shade=shade, out=(-1, 0, 0))
        self.face(back, cell, uvs=uvs, shade=shade, out=(1, 0, 0))
        n = len(outline)
        c = sum(front, Vector()) / n
        for i in range(n):
            j = (i + 1) % n
            pts = [front[i], front[j], back[j], back[i]]
            mid = (front[i] + front[j]) / 2
            o = mid - c
            o.x = 0
            self.face(pts, side_cell or cell, shade=shade * 0.85, out=o)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MAT_NAMES:
            me.materials.append(bpy.data.materials[m])
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


def rot(axis, a):
    return Matrix.Rotation(a, 4, axis)


# ------------------------------------------------------------------ models: signs


def board(t):
    """Signboard centred on the wall over the shop, 3.1-3.6 m up (ground storey is 3.8 m)."""
    m = Mesh()
    x, y, w, h = SOLID_ATLAS.cells[f"board_{t['key']}"]
    L, H = w * PX, h * PX
    zc = 3.36 if h <= 11 else 3.4
    trim = "gold" if sum(t["fg"]) > 1.9 else "wood_dark"
    m.box((0, -0.045, zc), (L, 0.05, H), "wood_dark", cells={"-y": f"board_{t['key']}"})
    for dz in (-1, 1):
        m.box((0, -0.05, zc + dz * (H / 2 + 0.02)), (L + 0.08, 0.08, 0.04), trim, shade=0.9)
    return m, L


def letters(t):
    """Lettering painted on the plaster: a decal just off the wall."""
    m = Mesh()
    x, y, w, h = DECAL_ATLAS.cells[f"letters_{t['key']}"]
    L, H = w * PX, h * PX
    zc = 3.3
    m.face([(-L / 2, -0.004, zc - H / 2), (L / 2, -0.004, zc - H / 2), (L / 2, -0.004, zc + H / 2), (-L / 2, -0.004, zc + H / 2)],
           f"letters_{t['key']}", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL, out=(0, -1, 0))
    return m, L


def bracket(m):
    """Wrought-iron arm at first-floor height, 1.05 m out, with a brace and a scroll; returns hang point y."""
    z = 4.05
    m.box((0, -0.015, z - 0.15), (0.09, 0.03, 0.45), "iron")
    m.beam((0, 0, z), (0, -1.05, z), 0.035, 0.035, "iron")
    m.beam((0, 0, z - 0.38), (0, -0.62, z - 0.02), 0.025, 0.025, "iron")
    curl = [(0, -0.2 - 0.14 * math.sin(a) - 0.1, z - 0.12 + 0.1 * math.cos(a)) for a in np.linspace(0.3, 2 * math.pi - 0.6, 8)]
    m.tube(curl, 0.012, 4, "iron")
    m.box((0, -1.07, z), (0.05, 0.05, 0.05), "gold")
    return z


def chains(m, z, y0, y1, zb):
    for yy in (y0, y1):
        m.beam((0, yy, z - 0.02), (0, yy, zb), 0.012, 0.012, "iron")


def hang(kind):
    m = Mesh()
    z = bracket(m)
    if kind == "boot":
        s = 0.95
        out = [(-0.14, 0.55), (0.10, 0.55), (0.10, 0.2), (0.28, 0.12), (0.36, 0.04), (0.35, -0.03), (-0.14, -0.03), (-0.16, 0.06)]
        base = z - 0.18 - 0.55 * s
        with m.at(move(0, -0.62, base)):
            m.prism([(a * s, (b + 0.03) * s) for a, b in out], 0.07, "black", side_cell="gold")
        chains(m, z, -0.5, -0.74, base + 0.55 * s)
    elif kind == "pretzel":
        # a cardioid rim (cusp at the bottom) and the two crossed arms: three holes, gilded
        s = 0.17
        cy = -0.62
        zb = z - 0.25 - 2 * s

        def P(th):
            r = 1 + math.sin(th)
            return (0, cy - r * math.cos(th) * s * 1.15, zb + r * math.sin(th) * s)

        rim = [P(-math.pi / 2 + 2 * math.pi * i / 20) for i in range(20)]
        m.tube(rim, 0.03, 5, "gold", closed=True)
        cusp = P(-math.pi / 2)
        for sg in (-1, 1):
            end = P(math.radians(90 + sg * 40))
            mid = (0, (cusp[1] + end[1]) / 2 - sg * 0.04, (cusp[2] + end[2]) / 2)
            m.tube([cusp, mid, end], 0.03, 5, "gold")
        chains(m, z, cy + 0.14, cy - 0.14, zb + 2 * s)
    elif kind == "key":
        top = z - 0.16
        with m.at(move(0, -0.6, 0)):
            ring = [(0, 0.11 * math.cos(a), top - 0.13 + 0.11 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
            m.tube(ring, 0.028, 5, "gold", closed=True)
            m.beam((0, 0, top - 0.24), (0, 0, top - 0.78), 0.05, 0.05, "gold")
            m.box((0, 0.07, top - 0.70), (0.04, 0.14, 0.06), "gold")
            m.box((0, 0.06, top - 0.62), (0.04, 0.12, 0.05), "gold")
            m.lathe([(0.05, top - 0.28), (0.07, top - 0.26), (0.07, top - 0.24), (0.05, top - 0.22)], 6, "gold")
        chains(m, z, -0.6, -0.6, top)
    elif kind == "tankard":
        top = z - 0.3
        with m.at(move(0, -0.62, top - 0.4)):
            m.lathe([(0.13, 0.0), (0.14, 0.02), (0.12, 0.06), (0.12, 0.3), (0.135, 0.33), (0.0, 0.345)], 8, "pewter", cap0=True)
            m.lathe([(0.14, 0.34), (0.14, 0.37), (0.0, 0.39)], 8, "pewter")
            hdl = [(0, -0.13 - 0.1 * math.sin(a), 0.17 + 0.12 * math.cos(a)) for a in np.linspace(0, math.pi, 7)]
            m.tube(hdl, 0.02, 4, "pewter")
            m.lathe([(0.125, 0.12), (0.125, 0.15)], 8, "gold")
        chains(m, z, -0.52, -0.72, top)
    elif kind == "basin":
        # the barber's brass basin, face to the street, a notch for the neck
        top = z - 0.22
        M = move(0, -0.62, top - 0.26) @ rot("Y", math.pi / 2)
        m.lathe([(0.0, -0.01), (0.14, 0.01), (0.2, 0.05), (0.26, 0.06), (0.26, 0.075), (0.2, 0.065), (0.14, 0.025), (0.0, 0.005)], 10,
                "brass", M=M, arc=(0.35, 2 * math.pi - 0.35))
        chains(m, z, -0.47, -0.77, top - 0.05)
    elif kind == "hat":
        top = z - 0.25
        with m.at(move(0, -0.62, top - 0.36)):
            m.lathe([(0.2, 0.0), (0.22, 0.02), (0.2, 0.035), (0.11, 0.04)], 10, "black", cap0=True)
            m.lathe([(0.11, 0.04), (0.105, 0.26), (0.115, 0.3), (0.0, 0.31)], 10, "black")
            m.lathe([(0.108, 0.05), (0.108, 0.09)], 10, "red_paint")
        chains(m, z, -0.62, -0.62, top)
    return m


def awning(bays, colour):
    """Striped canvas over the shop windows: wall top 3.05 m, 1.4 m out, front edge 2.5 m,
    a scalloped valance, side cheeks, two iron arms. Width `bays` x 3 m less a margin."""
    m = Mesh()
    W = bays * 3.0 - 0.4
    zt, zf, d, drop = 3.05, 2.5, 1.4, 0.22
    n = max(3, round(W / 0.65))
    for i in range(n):
        x0 = -W / 2 + W * i / n
        x1 = -W / 2 + W * (i + 1) / n
        m.face([(x0, 0, zt), (x1, 0, zt), (x1, -d, zf), (x0, -d, zf)], f"stripes_{colour}", uvs=[(0, 1), (1, 1), (1, 0), (0, 0)],
               out=(0, -0.4, 1))
        m.face([(x0, -d, zf), (x1, -d, zf), (x1, -d - 0.02, zf - drop), (x0, -d - 0.02, zf - drop)], f"valance_{colour}",
               uvs=[(0, 1), (1, 1), (1, 0), (0, 0)], out=(0, -1, 0))
    for sx in (-1, 1):
        x = sx * W / 2
        m.face([(x, 0, zt), (x, -d, zf), (x, 0, zf)], f"stripes_{colour}", uvs=[(0, 1), (0.5, 0), (0, 0)], out=(sx, 0, 0), shade=0.85)
        m.beam((x * 0.96, 0, zf - 0.35), (x * 0.96, -d + 0.05, zf - 0.02), 0.025, 0.025, "iron")
    m.box((0, -0.03, zt + 0.03), (W + 0.1, 0.07, 0.07), "wood_dark")
    return m


def madonna_mary(m, x, y, z, scale=1.0, robe="robe_blue"):
    """Mary with the child, standing, crowned; her base at (x, y, z), facing -Y."""
    with m.at(move(x, y, z) @ Matrix.Scale(scale, 4)):
        m.lathe([(0.07, 0.0), (0.09, 0.02), (0.07, 0.06)], 6, "whitestone", cap0=True)
        m.lathe([(0.1, 0.06), (0.105, 0.2), (0.09, 0.4), (0.07, 0.52), (0.05, 0.56)], 8, robe)
        m.lathe([(0.105, 0.08), (0.11, 0.3), (0.085, 0.5)], 8, "robe_white", arc=(-2.4, -0.74))
        m.lathe([(0.03, 0.55), (0.05, 0.6), (0.048, 0.66), (0.0, 0.7)], 6, "skin")
        m.lathe([(0.056, 0.58), (0.06, 0.65), (0.042, 0.71), (0.0, 0.72)], 6, "robe_white", arc=(0.4, math.pi * 2 - 0.4 - math.pi))
        m.lathe([(0.035, 0.71), (0.045, 0.76), (0.0, 0.77)], 6, "gold", cap0=True)
        ring_ = [(0.14 * math.cos(a), 0.05, 0.68 + 0.14 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
        m.tube(ring_, 0.011, 3, "gold", closed=True)
        with m.at(move(0.075, -0.08, 0.34)):
            m.lathe([(0.03, 0.0), (0.045, 0.06), (0.03, 0.12), (0.0, 0.13)], 6, "robe_white", cap0=True)
            m.lathe([(0.02, 0.12), (0.03, 0.15), (0.0, 0.18)], 5, "skin")


def madonna_lantern(m, side, z, reach=0.42):
    """The oil lantern on a wrought-iron arm out of one of the two walls beside the corner (side +1 the
    wall toward +X, -1 toward -X); the walls run back at 45 degrees from the corner (y = |x|)."""
    wx, wy = side * 0.55, 0.55
    nx, ny = side * 0.7071, -0.7071
    ex, ey = wx + nx * reach, wy + ny * reach
    m.box((wx + nx * 0.02, wy + ny * 0.02, z), (0.1, 0.1, 0.16), "iron")
    m.beam((wx, wy, z), (ex, ey, z), 0.022, 0.022, "iron")
    curl = [(wx + nx * (0.1 + 0.08 * math.cos(a)), wy + ny * (0.1 + 0.08 * math.cos(a)), z - 0.1 + 0.08 * math.sin(a)) for a in np.linspace(0.3, 2 * math.pi - 0.3, 8)]
    m.tube(curl, 0.01, 4, "iron")
    m.beam((ex, ey, z), (ex, ey, z - 0.16), 0.012, 0.012, "iron")
    with m.at(move(ex, ey, z - 0.36)):
        lo, hi = 0.06, 0.085
        for i in range(4):
            a0 = math.pi / 4 + i * math.pi / 2
            a1 = a0 + math.pi / 2
            q = [(lo * math.cos(a0) * 1.41, lo * math.sin(a0) * 1.41, -0.12), (lo * math.cos(a1) * 1.41, lo * math.sin(a1) * 1.41, -0.12),
                 (hi * math.cos(a1) * 1.41, hi * math.sin(a1) * 1.41, 0.08), (hi * math.cos(a0) * 1.41, hi * math.sin(a0) * 1.41, 0.08)]
            m.face(q, "glass", mat=GLOW, out=(math.cos(a0 + math.pi / 4), math.sin(a0 + math.pi / 4), 0))
        m.lathe([(0.11, 0.08), (0.12, 0.1), (0.0, 0.2)], 4, "iron", rot=math.pi / 4, cap0=True)
        m.lathe([(0.09, -0.12), (0.09, -0.15), (0.0, -0.19)], 4, "iron", rot=math.pi / 4)


def madonna_canopy(m, yc, z, r, sides, cell):
    """The baldachin over her: a half-round (or many-sided) metal hood out of the corner, a ring of
    stars under its rim, a scalloped fringe, a gilt ball on top."""
    with m.at(move(0, yc + 0.12, 0)):
        prof = [(r, z), (r * 0.92, z + 0.12), (r * 0.62, z + 0.28), (r * 0.2, z + 0.4), (0.0, z + 0.42)]
        m.lathe(prof, sides, cell, arc=(math.pi, 2 * math.pi))
        m.face([(r * math.cos(a), r * math.sin(a), z) for a in np.linspace(math.pi, 2 * math.pi, sides + 1)], cell, shade=0.6, out=(0, 0, -1))
        # the fringe: little gilt scallops hanging from the rim
        for k in range(sides * 2):
            a = math.pi + math.pi * (k + 0.5) / (sides * 2)
            cx, cy = r * math.cos(a), r * math.sin(a)
            tx, ty = -math.sin(a) * 0.035, math.cos(a) * 0.035
            m.face([(cx - tx, cy - ty, z), (cx + tx, cy + ty, z), (cx, cy, z - 0.06)], "gold", out=(math.cos(a), math.sin(a), 0))
        # twelve stars on the rim
        for k in range(12):
            a = math.pi + math.pi * (k + 0.5) / 12
            m.box((r * 0.98 * math.cos(a), r * 0.98 * math.sin(a), z + 0.07), (0.03, 0.03, 0.03), "gold")
        m.lathe([(0.0, z + 0.4), (0.045, z + 0.45), (0.04, z + 0.5), (0.0, z + 0.54)], 6, "gold")


def madonna_flowers(m, x, y, z):
    """A small vase of flowers on the console (the neighbours keep them fresh)."""
    m.lathe([(0.03, z), (0.045, z + 0.05), (0.03, z + 0.12), (0.035, z + 0.14)], 6, "whitestone", cap0=True)
    for k, (dx, dy, cell) in enumerate(((0.0, 0.0, "flower_red"), (0.035, -0.02, "flower_white"), (-0.035, -0.015, "flower_red"), (0.01, 0.03, "flower_white"))):
        m.beam((x + dx * 0.3, y + dy * 0.3, z + 0.12), (x + dx, y + dy, z + 0.26), 0.008, 0.008, "leaf")
        m.box((x + dx, y + dy, z + 0.27), (0.045, 0.045, 0.04), cell)


def madonna():
    """Corner Madonna in her stone niche on a console, under a half-round blue canopy with a ring of
    stars, a fringe and a gilt ball; the oil lantern on an iron arm out of the wall beside her; a
    vase of flowers either side. Built facing -Y (out of the corner); the niche sits 4.3-5.5 m up
    (the first floor, as the inventory's entries have it)."""
    m = Mesh()
    z0 = 4.3
    yc = -0.36
    m.box((0, yc, z0 - 0.08), (0.7, 0.56, 0.16), "whitestone")
    m.box((0, yc + 0.06, z0 - 0.24), (0.5, 0.42, 0.16), "whitestone", shade=0.9)
    m.box((0, yc + 0.1, z0 - 0.4), (0.3, 0.3, 0.16), "whitestone", shade=0.8)
    with m.at(move(0, yc, 0)):
        m.lathe([(0.3, z0), (0.3, z0 + 0.85)], 6, "plaster", arc=(0, math.pi))
        dome = [(0.3 * math.cos(a), z0 + 0.85 + 0.3 * math.sin(a)) for a in np.linspace(0, math.pi / 2, 4)]
        m.lathe(dome, 6, "plaster", arc=(0, math.pi))
        m.lathe([(0.35, z0 + 0.8), (0.37, z0 + 0.86), (0.35, z0 + 1.2), (0.0, z0 + 1.3)], 7, "whitestone", arc=(0, math.pi))
        half = [(0.3 * math.cos(a), 0.3 * math.sin(a), z0 + 0.002) for a in np.linspace(0, math.pi, 7)]
        m.face(half, "whitestone", out=(0, 0, 1))
        for sx in (-1, 1):
            m.box((sx * 0.33, 0.0, z0 + 0.4), (0.06, 0.06, 0.8), "whitestone")
    madonna_mary(m, 0, yc + 0.08, z0)
    madonna_canopy(m, yc, z0 + 1.34, 0.48, 8, "canopy_blue")
    for sx in (-1, 1):
        madonna_flowers(m, sx * 0.25, yc - 0.12, z0)
    madonna_lantern(m, 1, z0 + 0.5)
    return m


def madonna_b():
    """A painted wooden Madonna on a carved corbel, no niche, under a many-sided iron canopy hung
    from the corner; the lantern on the other wall."""
    m = Mesh()
    z0 = 4.4
    yc = -0.3
    m.lathe([(0.04, z0 - 0.5), (0.1, z0 - 0.4), (0.16, z0 - 0.2), (0.22, z0 - 0.04), (0.24, z0)], 8, "whitestone", arc=(math.pi, 2 * math.pi), M=move(0, yc + 0.18, 0))
    m.box((0, yc, z0 + 0.02), (0.46, 0.4, 0.05), "whitestone")
    madonna_mary(m, 0, yc, z0 + 0.04, 1.08, "polychrome")
    for sx in (-1, 1):
        m.beam((sx * 0.5, 0.5, z0 + 1.35), (sx * 0.2, yc - 0.1, z0 + 1.28), 0.016, 0.016, "iron")
    madonna_canopy(m, yc - 0.02, z0 + 1.1, 0.4, 6, "iron_green")
    madonna_flowers(m, 0.16, yc - 0.1, z0 + 0.04)
    madonna_lantern(m, -1, z0 + 0.45)
    return m


def madonna_c():
    """A glazed wooden shrine box on the corner (a little chapel): a gabled roof, the statue behind
    the glass with flowers at her feet, the lantern hanging on a curled arm below the box."""
    m = Mesh()
    z0 = 4.2
    yc = -0.3
    W, D, H = 0.52, 0.34, 0.86
    m.box((0, yc, z0 - 0.05), (W + 0.1, D + 0.1, 0.1), "wood_dark")
    for sx in (-1, 1):
        m.box((sx * W / 2, yc, z0 + H / 2), (0.05, D, H), "wood_dark")
    m.box((0, yc + D / 2, z0 + H / 2), (W, 0.03, H), "canopy_blue", shade=0.8)
    for sx in (-1, 1):
        m.face([(0, yc - D / 2 - 0.06, z0 + H + 0.26), (0, yc + D / 2 + 0.03, z0 + H + 0.26),
                (sx * (W / 2 + 0.08), yc + D / 2 + 0.03, z0 + H - 0.02), (sx * (W / 2 + 0.08), yc - D / 2 - 0.06, z0 + H - 0.02)],
               "slate", out=(sx, 0, 1))
    m.face([(-W / 2, yc - D / 2, z0 + H), (W / 2, yc - D / 2, z0 + H), (0, yc - D / 2, z0 + H + 0.24)], "wood_dark", out=(0, -1, 0))
    madonna_mary(m, 0, yc + 0.02, z0, 0.92)
    for sx in (-1, 1):
        madonna_flowers(m, sx * 0.17, yc - 0.06, z0)
    # the glass: dark panes in a thin frame
    m.face([(-W / 2 + 0.03, yc - D / 2 - 0.005, z0 + 0.02), (W / 2 - 0.03, yc - D / 2 - 0.005, z0 + 0.02),
            (W / 2 - 0.03, yc - D / 2 - 0.005, z0 + H - 0.04), (-W / 2 + 0.03, yc - D / 2 - 0.005, z0 + H - 0.04)],
           "water_dark", shade=0.5, out=(0, -1, 0))
    m.beam((0, yc - D / 2 - 0.01, z0 + 0.02), (0, yc - D / 2 - 0.01, z0 + H - 0.04), 0.02, 0.02, "wood_dark")
    madonna_lantern(m, 1, z0 + 0.35, reach=0.38)
    return m


# ------------------------------------------------------------------ models: water


def pump_iron():
    """Cast-iron street pump: stone plinth, a fluted column with a ball on top, a spout to the
    front, a long handle at the side, a drip stone. 1.6 m tall. Front (spout) toward -Y."""
    m = Mesh(ao=0.6)
    m.box((0, 0, 0.08), (0.6, 0.6, 0.16), "bluestone")
    m.lathe([(0.17, 0.16), (0.17, 0.26), (0.13, 0.32), (0.12, 1.2), (0.15, 1.25), (0.15, 1.3), (0.09, 1.36)], 8, "iron_green",
            cap1=False, rot=math.pi / 8)
    m.lathe([(0.09, 1.36), (0.1, 1.42), (0.07, 1.5), (0.0, 1.52)], 8, "iron_green")
    m.lathe([(0.0, 1.5), (0.05, 1.53), (0.06, 1.58), (0.0, 1.64)], 6, "gold")
    spout = [(0, -0.12, 0.92), (0, -0.28, 0.93), (0, -0.36, 0.88), (0, -0.39, 0.8)]
    m.tube(spout, 0.035, 6, "iron_green")
    m.lathe([(0.05, 0.84), (0.05, 1.0)], 6, "iron_green", M=move(0, -0.12, 0))
    # handle: a pivot box on the right, the lever slanting up and back, a knob
    # (the lever swings along the wall, never back into it)
    m.box((0.15, 0, 1.18), (0.08, 0.1, 0.1), "iron_green")
    m.beam((0.18, 0, 1.18), (0.78, -0.08, 1.38), 0.035, 0.035, "iron")
    m.lathe([(0.0, -0.03), (0.04, 0.0), (0.0, 0.05)], 6, "iron", M=move(0.8, -0.08, 1.38))
    # drip stone with a groove, and the bucket hook
    m.box((0, -0.45, 0.04), (0.5, 0.36, 0.08), "bluestone", shade=0.9)
    m.beam((0, -0.12, 0.7), (0, -0.25, 0.7), 0.02, 0.02, "iron")
    return m


def pump_stone():
    """Blue-stone pillar pump: a square pillar on a base, a moulded cap and a small pyramid,
    a lion's head over the iron spout, a handle on the side, a small basin."""
    m = Mesh(ao=0.6)
    m.box((0, 0, 0.12), (0.62, 0.62, 0.24), "bluestone")
    m.box((0, 0, 0.9), (0.44, 0.44, 1.32), "bluestone")
    m.box((0, 0, 1.6), (0.56, 0.56, 0.1), "bluestone")
    m.box((0, 0, 1.68), (0.5, 0.5, 0.06), "bluestone", shade=0.9)
    for i in range(4):
        a0 = math.pi / 4 + i * math.pi / 2
        a1 = a0 + math.pi / 2
        r = 0.25 * 1.414
        m.face([(r * math.cos(a0), r * math.sin(a0), 1.71), (r * math.cos(a1), r * math.sin(a1), 1.71), (0, 0, 2.02)], "bluestone",
               out=(math.cos(a0 + math.pi / 4), math.sin(a0 + math.pi / 4), 0.5))
    m.lathe([(0.0, 2.0), (0.05, 2.04), (0.0, 2.1)], 6, "bluestone")
    # lion's head (a boss) and the spout
    m.box((0, -0.25, 1.08), (0.2, 0.08, 0.22), "whitestone", shade=0.85)
    m.box((0, -0.3, 1.06), (0.1, 0.06, 0.1), "whitestone", shade=0.75)
    m.tube([(0, -0.28, 0.98), (0, -0.44, 0.98), (0, -0.5, 0.92)], 0.03, 6, "iron")
    # handle
    m.box((0.25, 0, 1.25), (0.06, 0.1, 0.1), "iron")
    m.beam((0.27, 0.0, 1.25), (0.85, -0.1, 1.45), 0.035, 0.035, "iron")
    # basin at the front
    basin_box(m, (0, -0.52, 0), 0.62, 0.34, 0.34, 0.05)
    return m


def basin_box(m, c, L, D, H, t):
    """A stone basin, open on top, with dark water in it."""
    cx, cy, cz = c
    m.box((cx, cy, cz + t / 2), (L, D, t), "bluestone")
    m.box((cx, cy - D / 2 + t / 2, cz + H / 2), (L, t, H), "bluestone")
    m.box((cx, cy + D / 2 - t / 2, cz + H / 2), (L, t, H), "bluestone")
    m.box((cx - L / 2 + t / 2, cy, cz + H / 2), (t, D - 2 * t, H), "bluestone")
    m.box((cx + L / 2 - t / 2, cy, cz + H / 2), (t, D - 2 * t, H), "bluestone")
    m.face([(cx - L / 2 + t, cy - D / 2 + t, cz + H - 0.08), (cx + L / 2 - t, cy - D / 2 + t, cz + H - 0.08),
            (cx + L / 2 - t, cy + D / 2 - t, cz + H - 0.08), (cx - L / 2 + t, cy + D / 2 - t, cz + H - 0.08)], "water_dark", out=(0, 0, 1))


def trough():
    """Horse trough of blue stone, 2.0 x 0.7 m, 0.62 m high, water nearly to the brim."""
    m = Mesh(ao=0.5)
    basin_box(m, (0, 0, 0), 2.0, 0.7, 0.62, 0.1)
    for sx in (-1, 1):
        m.box((sx * 0.7, 0, 0.64), (0.12, 0.74, 0.04), "bluestone", shade=0.9)
    return m


def well():
    """The Handschoenmarkt well, as it stood in 1873 (inventaris onroerend erfgoed 83723; Baedeker
    1869): the wrought-iron canopy said to be Quinten Matsijs' work (c. 1490) on a square stone
    well with neo-Gothic tracery (the round bluestone basin of today came only in 1900-01). Four
    iron posts rise to pinnacles, joined by twisting tendrils; a wild man and a wild woman in skins
    stand on the posts; the bronze Brabo on top. Its height is not recorded: about 5 m here."""
    m = Mesh(ao=0.8)
    S = 0.78  # half the width of the stone well
    m.box((0, 0, 0.06), (2 * S + 0.16, 2 * S + 0.16, 0.12), "bluestone", shade=0.9)
    m.box((0, 0, 0.5), (2 * S, 2 * S, 0.76), "bluestone")
    m.box((0, 0, 0.93), (2 * S + 0.08, 2 * S + 0.08, 0.1), "bluestone", shade=1.05)
    m.face([(-S + 0.1, -S + 0.1, 0.99), (S - 0.1, -S + 0.1, 0.99), (S - 0.1, S - 0.1, 0.99), (-S + 0.1, S - 0.1, 0.99)], "water_dark", out=(0, 0, 1))
    # neo-Gothic tracery: two pointed panels on each face, a little proud of the stone
    for k in range(4):
        a = k * math.pi / 2
        c, sn = math.cos(a), math.sin(a)
        with m.at(Matrix.Rotation(a, 4, "Z")):
            for px in (-0.36, 0.36):
                y = -S - 0.012
                lancet = [(px - 0.22, y, 0.22), (px + 0.22, y, 0.22), (px + 0.22, y, 0.58), (px + 0.12, y, 0.72), (px, y, 0.78), (px - 0.12, y, 0.72), (px - 0.22, y, 0.58)]
                m.face(lancet, "whitestone", shade=0.85, out=(0, -1, 0))
                m.beam((px, y - 0.01, 0.24), (px, y - 0.01, 0.7), 0.025, 0.02, "bluestone", shade=0.8)
    R = S - 0.08
    posts = [(R, R), (-R, R), (-R, -R), (R, -R)]
    for i, (x, y) in enumerate(posts):
        m.beam((x, y, 0.98), (x, y, 3.3), 0.06, 0.06, "iron")
        m.lathe([(0.05, 3.3), (0.07, 3.36), (0.0, 3.78)], 4, "iron", M=move(x, y, 0))
        for zz in (1.6, 2.5):
            m.box((x, y, zz), (0.1, 0.1, 0.05), "iron")
    for i in range(4):
        (x0, y0), (x1, y1) = posts[i], posts[(i + 1) % 4]
        arc = [(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 2.55 + 0.5 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 9)]
        m.tube(arc, 0.024, 4, "iron")
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        # twisting tendrils: a spiral climbing between the posts, leaves at its ends
        vine = [(mx + (x1 - x0) * 0.22 * math.cos(a) , my + (y1 - y0) * 0.22 * math.cos(a), 1.1 + 0.18 * a) for a in np.linspace(0, 4 * math.pi, 16)]
        m.tube(vine, 0.014, 4, "iron")
        for t in (0.25, 0.75):
            lx, ly = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            m.box((lx, ly, 2.25), (0.08, 0.08, 0.02), "iron")
        m.beam((x0, y0, 1.6), (x1, y1, 1.6), 0.025, 0.025, "iron")
        # the arches bend up into the spire
        m.tube([(x0, y0, 3.3), (x0 * 0.5, y0 * 0.5, 3.75), (0, 0, 4.1)], 0.022, 4, "iron")
    # the wild man and the wild woman in their skins, on two of the posts
    for (x, y), rot_ in ((posts[0], 0.8), (posts[2], -2.3)):
        with m.at(move(x, y, 2.62) @ Matrix.Rotation(rot_, 4, "Z")):
            m.lathe([(0.05, 0.0), (0.06, 0.14), (0.045, 0.26), (0.03, 0.3), (0.04, 0.34), (0.0, 0.4)], 6, "bronze", cap0=True)
            m.beam((0.04, 0, 0.24), (0.1, -0.02, 0.44), 0.025, 0.025, "bronze")
    m.beam((0, 0, 4.05), (0, 0, 4.45), 0.055, 0.055, "iron")
    # Brabo on top, a bronze figure with the giant's hand held up
    with m.at(move(0, 0, 4.45)):
        m.lathe([(0.08, 0.0), (0.09, 0.2), (0.07, 0.38), (0.035, 0.42), (0.05, 0.47), (0.0, 0.54)], 6, "bronze", cap0=True)
        m.beam((0.05, 0, 0.36), (0.14, 0, 0.64), 0.032, 0.032, "bronze")
        m.box((0.15, 0, 0.66), (0.06, 0.04, 0.06), "bronze")
    # the pulley bar and the rope
    m.beam((-R * 0.8, 0, 2.3), (R * 0.8, 0, 2.3), 0.05, 0.05, "wood_dark")
    m.beam((0, 0, 2.3), (0, 0, 1.0), 0.012, 0.012, "rope")
    return m


# ------------------------------------------------------------------ models: walls and ground


def step(n):
    m = Mesh(ao=0.3)
    if n == 1:
        m.box((0, -0.19, 0.075), (1.5, 0.38, 0.15), "bluestone")
    else:
        m.box((0, -0.34, 0.065), (1.7, 0.68, 0.13), "bluestone")
        m.box((0, -0.18, 0.195), (1.45, 0.36, 0.13), "bluestone", shade=1.05)
    return m


def hatch():
    """Cellar hatch in front of the house: a stone curb, two wooden flaps, iron straps, a ring."""
    m = Mesh()
    m.box((0, -0.42, 0.02), (1.14, 0.8, 0.04), "bluestone", skip=("-z",))
    for sx in (-1, 1):
        m.box((sx * 0.265, -0.42, 0.045), (0.5, 0.68, 0.03), "wood_dark", skip=("-z",))
        for y in (-0.2, -0.64):
            m.box((sx * 0.265, y, 0.064), (0.46, 0.05, 0.01), "iron", skip=("-z",))
    m.tube([(0.05 * math.cos(a) + 0.08, -0.42 + 0.05 * math.sin(a), 0.066) for a in np.linspace(0, 2 * math.pi, 6, endpoint=False)], 0.008, 3, "iron", closed=True)
    return m


def scraper():
    """Boot scraper: two little cast posts with knobs, the blade between, on a stone."""
    m = Mesh(ao=0.3)
    m.box((0, -0.14, 0.02), (0.36, 0.2, 0.04), "bluestone")
    for sx in (-1, 1):
        m.beam((sx * 0.13, -0.14, 0.04), (sx * 0.13, -0.14, 0.28), 0.025, 0.025, "iron")
        m.lathe([(0.0, 0.27), (0.03, 0.3), (0.0, 0.34)], 5, "iron", M=move(sx * 0.13, -0.14, 0))
    m.box((0, -0.14, 0.14), (0.26, 0.012, 0.05), "iron")
    return m


def plate(i):
    m = Mesh()
    x, y, w, h = SOLID_ATLAS.cells[f"plate_{i}"]
    L, H = w * 0.022, h * 0.022
    m.box((0, -0.008, 2.9), (L, 0.016, H), "iron", cells={"-y": f"plate_{i}"})
    return m


def number(i):
    m = Mesh()
    x, y, w, h = SOLID_ATLAS.cells[f"number_{i}"]
    L, H = w * 0.016, h * 0.016
    m.box((0, -0.006, 2.3), (L, 0.012, H), "iron", cells={"-y": f"number_{i}"})
    return m


def poster(p):
    m = Mesh()
    W, H = 0.9, 1.24
    z0 = 1.05
    m.face([(-W / 2, -0.006, z0), (W / 2, -0.006, z0), (W / 2, -0.006, z0 + H), (-W / 2, -0.006, z0 + H)], f"poster_{p['key']}",
           uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL, out=(0, -1, 0))
    return m


def ground(cell, w, d, mat=DECAL, turn=0.0):
    m = Mesh()
    c, s = math.cos(turn), math.sin(turn)
    pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    m.face([(x * c - y * s, x * s + y * c, 0.0) for x, y in pts], cell, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=mat, out=(0, 0, 1))
    return m


# garments: flat outlines hanging from the origin (a point on the line), in the X-Z plane
GARMENTS = {
    "shirt": [(-0.16, 0), (0.16, 0), (0.34, -0.06), (0.36, -0.28), (0.2, -0.26), (0.19, -0.7), (-0.19, -0.7), (-0.2, -0.26), (-0.36, -0.28), (-0.34, -0.06)],
    "sheet": [(-0.6, 0), (0.6, 0), (0.62, -1.05), (0.2, -1.1), (-0.25, -1.06), (-0.6, -1.0)],
    "trousers": [(-0.2, 0), (0.2, 0), (0.24, -0.85), (0.06, -0.85), (0.0, -0.3), (-0.06, -0.85), (-0.24, -0.85)],
    "apron": [(-0.25, 0), (0.25, 0), (0.28, -0.6), (-0.28, -0.6)],
    "shift": [(-0.18, 0), (0.18, 0), (0.3, -0.9), (-0.3, -0.9)],
    "stockings": [(-0.2, 0), (-0.1, 0), (-0.1, -0.55), (-0.16, -0.62), (-0.2, -0.55), (-0.2, 0)],
    "towel": [(-0.22, 0), (0.22, 0), (0.22, -0.4), (-0.22, -0.4)],
}
CLOTH_CELLS = {"shirt": ["linen_white", "cloth_blue", "linen_cream"], "sheet": ["linen_white", "ticking"],
               "trousers": ["cloth_grey", "cloth_brown", "cloth_blue"], "apron": ["cloth_blue", "linen_cream"],
               "shift": ["linen_cream", "cloth_red"], "stockings": ["cloth_grey", "cloth_red"], "towel": ["ticking", "linen_white"]}


def garment(kind, cell, m=None, at=None, sway=0.0):
    own = m is None
    m = m or Mesh()
    pts = GARMENTS[kind]
    xs = [p[0] for p in pts]
    zs = [p[1] for p in pts]
    x0, x1, z0 = min(xs), max(xs), min(zs)
    uvs = [((x - x0) / (x1 - x0), (z - z0) / (0 - z0)) for x, z in pts]
    ox, oy, oz = at or (0, 0, 0)
    w3 = [(ox + x, oy + sway * z * z, oz + z) for x, z in pts]
    if kind == "stockings":
        m.face(w3, cell, uvs=uvs, out=(0, -1, 0))
        m.face([(p[0] + 0.3, p[1], p[2]) for p in w3], cell, uvs=uvs, out=(0, -1, 0))
    else:
        m.face(w3, cell, uvs=uvs, out=(0, -1, 0))
    if own:
        return m


def cloth(kind, cell):
    return garment(kind, cell, sway=0.08)


def washpole(k):
    """A wash pole pushed out of a window, 1.7 m, tilted up a little, with washing on it."""
    m = Mesh()
    L = 1.7
    tip = (0, -L, 0.28)
    m.beam((0, 0.05, 0), tip, 0.045, 0.045, "wood")
    rng = random.Random(40 + k)
    kinds = [["shirt", "towel", "stockings"], ["trousers", "shirt"], ["shift", "apron", "towel"]][k % 3]
    for i, kind in enumerate(kinds):
        t = 0.3 + 0.6 * (i + 0.5) / len(kinds)
        pos = (0, -L * t, 0.28 * t - 0.02)
        # the pole runs along -Y: turn the garment (drawn in X-Z) to hang along it
        with m.at(move(*pos) @ rot("Z", math.pi / 2)):
            garment(kind, rng.choice(CLOTH_CELLS[kind]), m=m, sway=0.05)
    return m


# ------------------------------------------------------------------ the city: walls and corners


def point_in(poly, x, z):
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if (zi > z) != (zj > z) and x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def city_slots():
    """House walls and corners for the game, from shared/city_build.json.

    walls: [ax, az, bx, bz, ox, oz, H, st, kind, style, door, seed, store]
      kind 0 = faces a street (windows), 1 = blind but open to the air (not a party wall);
      door = where the front door is, as a fraction from a to b (-1: none); a to b runs
      so that the outward normal (ox, oz) is on the right... it is simply given.
    corners: [x, z, dx, dz, o1x, o1z, t1x, t1z, o2x, o2z, t2x, t2z, H, st, store]
      an outer house corner where two street walls meet: d is the diagonal out of the
      corner, o the outward normals of the two walls, t the unit along each wall away
      from the corner.
    """
    if not os.path.exists(SRC):
        return {"walls": [], "corners": []}
    data = json.load(open(SRC))
    houses = data["houses"]
    polys = [h["fp"] for h in houses] + [l["fp"] for l in data.get("landmarks", {}).values()]
    grid = {}
    boxes = []
    for i, p in enumerate(polys):
        xs = [q[0] for q in p]
        zs = [q[1] for q in p]
        bb = (min(xs), min(zs), max(xs), max(zs))
        boxes.append(bb)
        for gx in range(int(math.floor(bb[0] / 10)), int(math.floor(bb[2] / 10)) + 1):
            for gz in range(int(math.floor(bb[1] / 10)), int(math.floor(bb[3] / 10)) + 1):
                grid.setdefault((gx, gz), []).append(i)

    def covered(x, z, own):
        for i in grid.get((math.floor(x / 10), math.floor(z / 10)), []):
            if i == own:
                continue
            b = boxes[i]
            if b[0] <= x <= b[2] and b[1] <= z <= b[3] and point_in(polys[i], x, z):
                return True
        return False

    STY = {"brick": 0, "plaster": 1, "plaster_grey": 2, "brick_dark": 3}
    walls, corners = [], []
    r2 = lambda v: round(v, 2)  # noqa: E731
    for hi, h in enumerate(houses):
        H, st = h["h"], h["st"]
        style = STY.get(h["style"], 0)
        store = 1 if h.get("store") else 0
        if h["rect"]:
            (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
            s0, s1 = h["s"]
            t0, t1 = h["t"]

            def P(s, t):
                return (ox + ux * s + nx * t, oz + uz * s + nz * t)

            c = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)]
            outs = [(-nx, -nz), (ux, uz), (nx, nz), (-ux, -uz)]
            street = h["street"]
            door_i = 0 if street[0] else -1
        else:
            c = h["fp"]
            n = len(c)
            area = sum(c[i][0] * c[(i + 1) % n][1] - c[(i + 1) % n][0] * c[i][1] for i in range(n))
            outs = []
            for i in range(n):
                a, b = c[i], c[(i + 1) % n]
                dx, dz = b[0] - a[0], b[1] - a[1]
                L = math.hypot(dx, dz) or 1
                o = (dz / L, -dx / L)
                if area < 0:
                    o = (-o[0], -o[1])
                outs.append(o)
            street = h["street"]
            lens = [math.hypot(c[(i + 1) % n][0] - c[i][0], c[(i + 1) % n][1] - c[i][1]) * street[i] for i in range(n)]
            door_i = max(range(n), key=lambda i: lens[i])
            if lens[door_i] <= 2:
                door_i = -1
        n = len(c)
        for i in range(n):
            a, b = c[i], c[(i + 1) % n]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 1.2:
                continue
            o = outs[i]
            if street[i]:
                kind = 0
            else:
                # a blind wall: open to the air unless another house or a landmark stands against it
                hits = 0
                for f in (0.2, 0.5, 0.8):
                    x = a[0] + (b[0] - a[0]) * f + o[0] * 0.4
                    z = a[1] + (b[1] - a[1]) * f + o[1] * 0.4
                    hits += covered(x, z, hi)
                if hits or L < 2.5:
                    continue
                kind = 1
            door = -1.0
            if i == door_i:
                bays = max(1, round(L / 3.0))
                door = (bays // 2 + 0.5) / bays
            walls.append([r2(a[0]), r2(a[1]), r2(b[0]), r2(b[1]), r2(o[0]), r2(o[1]), r2(H), st, kind, style, round(door, 3),
                          h["seed"] % 100000, store])
        # outer corners between two street walls
        for i in range(n):
            j = (i + 1) % n
            if not (street[i] and street[j]):
                continue
            o1, o2 = outs[i], outs[j]
            if o1[0] * o2[0] + o1[1] * o2[1] > 0.5:
                continue  # nearly straight: not a corner
            a, v, b = c[i], c[j], c[(j + 1) % n]
            # convex (outer) corner: the next edge turns away from the first wall's outside
            e1 = (v[0] - a[0], v[1] - a[1])
            e2 = (b[0] - v[0], b[1] - v[1])
            if e2[0] * o1[0] + e2[1] * o1[1] > 1e-6:
                continue
            L1 = math.hypot(*e1) or 1
            L2 = math.hypot(*e2) or 1
            dx, dz = o1[0] + o2[0], o1[1] + o2[1]
            dl = math.hypot(dx, dz) or 1
            corners.append([r2(v[0]), r2(v[1]), r2(dx / dl), r2(dz / dl), r2(o1[0]), r2(o1[1]), r2(-e1[0] / L1), r2(-e1[1] / L1),
                            r2(o2[0]), r2(o2[1]), r2(e2[0] / L2), r2(e2[1] / L2), r2(H), st, store])
    # the covered passages (city_build.json "poort", build_city.py): each mouth on the street, a to b across it,
    # (ox, oz) out of the house, h its clear height, depth through the house; nothing may stand or hang there
    poorts = []
    for h in houses:
        pt = h.get("poort")
        if not pt or not h["rect"]:
            continue
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        (p0, p1), (t0, t1) = pt["s"], h["t"]
        a = (ox + ux * p0 + nx * t0, oz + uz * p0 + nz * t0)
        b = (ox + ux * p1 + nx * t0, oz + uz * p1 + nz * t0)
        poorts.append([r2(a[0]), r2(a[1]), r2(b[0]), r2(b[1]), r2(-nx), r2(-nz), pt["h"], r2(t1 - t0)])
    return {"walls": walls, "corners": corners, "poorts": poorts, "ground_h": data.get("ground_h", GROUND_H), "storey_h": data.get("storey_h", 3.0)}


# ------------------------------------------------------------------ build


def build_models():
    B = []
    meta_trades = []
    for t in TRADES:
        if t.get("bg") is not None:
            mesh, L = board(t)
            B.append((f"board_{t['key']}", mesh))
        else:
            mesh, L = letters(t)
            B.append((f"letters_{t['key']}", mesh))
        meta_trades.append({"key": t["key"], "sign": B[-1][0], "len": round(L, 2), "hang": t["hang"], "awning": t["awning"], "where": t["where"]})
    for k in ("boot", "pretzel", "key", "tankard", "basin", "hat"):
        B.append((f"hang_{k}", hang(k)))
    for bays in (1, 2):
        for c in range(len(AWNINGS)):
            B.append((f"awning_{bays}_{c}", awning(bays, c)))
    B.append(("madonna", madonna()))
    B.append(("madonna_b", madonna_b()))
    B.append(("madonna_c", madonna_c()))
    B.append(("pump_iron", pump_iron()))
    B.append(("pump_stone", pump_stone()))
    B.append(("well", well()))
    B.append(("trough", trough()))
    B.append(("step_1", step(1)))
    B.append(("step_2", step(2)))
    B.append(("hatch", hatch()))
    B.append(("scraper", scraper()))
    names = STREET_NAMES + SQUARE_NAMES
    for i in range(len(names)):
        B.append((f"plate_{i}", plate(i)))
    for i in range(len(NUMBERS)):
        B.append((f"number_{i}", number(i)))
    for p in POSTERS:
        B.append((f"poster_{p['key']}", poster(p)))
    for i in range(3):
        B.append((f"straw_{i}", ground(f"straw_{i}", 1.1, 1.1, turn=i * 0.7)))
    for i in range(2):
        B.append((f"dung_{i}", ground(f"dung_{i}", 0.42, 0.42, turn=i)))
    for i in range(3):
        B.append((f"puddle_{i}", ground(f"puddle_{i}", 1.8 - i * 0.3, 1.2 - i * 0.2, mat=PUDDLE, turn=i * 0.4)))
    B.append(("stain_0", ground("stain_0", 1.3, 1.3)))
    cloth_names = []
    for kind, cells in CLOTH_CELLS.items():
        for j, ce in enumerate(cells):
            B.append((f"cloth_{kind}_{j}", cloth(kind, ce)))
            cloth_names.append(f"cloth_{kind}_{j}")
    for k in range(3):
        B.append((f"washpole_{k}", washpole(k)))
    meta = {
        "trades": meta_trades,
        "streetNames": names,
        "squareNames": SQUARE_NAMES,
        "plates": len(names),
        "numbers": len(NUMBERS),
        "posters": [f"poster_{p['key']}" for p in POSTERS],
        "cloths": cloth_names,
        "awningColours": len(AWNINGS),
        "solid": {"size": [SOLID_ATLAS.W, SOLID_ATLAS.H], "cells": SOLID_ATLAS.cells},
        "decal": {"size": [DECAL_ATLAS.W, DECAL_ATLAS.H], "cells": DECAL_ATLAS.cells},
    }
    return B, meta


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------ preview


def preview_materials():
    for mt in bpy.data.materials:
        if not mt.name.startswith("sl_"):
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
        if mt.name == "sl_glow":
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 3.0
        try:
            mt.surface_render_method = "DITHERED"
        except AttributeError:
            pass


def stage(ground_col=(0.09, 0.09, 0.085)):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("fog")
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.24, 0.26, 0.29, 1)
        bg.inputs[1].default_value = 0.9
    except AttributeError:
        pass
    sc.world = world
    me = bpy.data.meshes.new("ground")
    bm = bmesh.new()
    for p in [(-80, -80, -0.005), (80, -80, -0.005), (80, 80, -0.005), (-80, 80, -0.005)]:
        bm.verts.new(p)
    bm.faces.new(bm.verts)
    bm.to_mesh(me)
    gm = bpy.data.materials.new("ground_prev")
    gm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*ground_col, 1)
    me.materials.append(gm)
    g = bpy.data.objects.new("ground", me)
    sc.collection.objects.link(g)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def aim(cam, loc, target, lens=35):
    cam.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def render(path, res):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[build_streetlife] preview -> {path}")


def wall_quad(name, x0, x1, h, col, y=0.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for p in [(x0, y, 0), (x1, y, 0), (x1, y, h), (x0, y, h)]:
        bm.verts.new(p)
    bm.faces.new(bm.verts)
    bm.to_mesh(me)
    mt = bpy.data.materials.new(name + "_m")
    mt.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*col, 1)
    me.materials.append(mt)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def preview(objs):
    """Two pictures: every model in rows, and a made-up street front with the things in place."""
    cam = stage()
    rows = [
        [n for n in objs if n.startswith("board_") or n.startswith("letters_")],
        [n for n in objs if n.startswith("hang_") or n.startswith("awning_")] + ["madonna", "madonna_b", "madonna_c"],
        ["pump_iron", "pump_stone", "well", "trough", "step_1", "step_2", "hatch", "scraper"] + [n for n in objs if n.startswith("poster_")],
        [n for n in objs if n.startswith("cloth_") or n.startswith("washpole_") or n.startswith("plate_") or n.startswith("number_")][:40],
        [n for n in objs if n.startswith(("straw_", "dung_", "puddle_", "stain_"))],
    ]
    shown = set()
    for r, names in enumerate(rows):
        x = 0.0
        for n in names:
            o = objs[n]
            o.location = (0, 0, 0)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            zlo = min(p.z for p in pts)
            dz = -zlo if n.startswith(("cloth_", "washpole_")) else (-(zlo - 0.0) if n.startswith(("board_", "letters_", "hang_", "awning_", "madonna", "plate_", "number_", "poster_")) else 0)
            o.location = (x - lo, r * 4.5, dz + (0.02 if n.startswith(("straw_", "dung_", "puddle_", "stain_")) else 0))
            x += hi - lo + 0.3
            shown.add(n)
        for n in names:
            objs[n].location.x -= x / 2
    for n, o in objs.items():
        o.hide_render = n not in shown
    bpy.context.view_layer.update()
    aim(cam, (0, -16, 12), (0, 9, 0.5), lens=18)
    render(os.path.join(SHOTS, "streetlife_preview.png"), (1920, 1080))

    # the street: two house fronts facing each other 6 m apart, things put where the game puts them
    for o in objs.values():
        o.hide_render = True
    wall_quad("front_a", -9, 9, 10, (0.30, 0.13, 0.09))
    wall_quad("front_b", -9, 9, 10, (0.55, 0.52, 0.44), y=-6.5)
    bpy.data.objects["front_b"].rotation_euler = (0, 0, 0)

    def put(name, x, y=0.0, z=0.0, turn=0.0, sx=1.0):
        src = objs[name]
        o = src.copy()
        o.hide_render = False
        o.location = (x, y, z)
        o.rotation_euler = (0, 0, turn)
        o.scale = (sx, 1, 1)
        bpy.context.scene.collection.objects.link(o)
        return o

    put("board_grocer", -4.5)
    put("awning_2_0", -4.5)
    put("step_1", -1.2)
    put("number_3", -0.4)
    put("hang_pretzel", 1.0)
    put("board_bakery", 3.5)
    put("awning_1_1", 5.5)
    put("step_2", 3.0)
    put("scraper", 2.0)
    put("hatch", 6.8)
    put("poster_redstar", -7.5)
    put("poster_dockers", -8.3)
    put("madonna", 8.95, 0, 0, math.radians(-45))
    put("plate_0", 7.9)
    put("pump_iron", -6.5, -1.2)
    put("trough", -4.0, -1.4, 0, 0)
    put("puddle_0", -6.4, -2.2)
    put("straw_1", -2.5, -2.8)
    put("dung_0", -3.1, -3.3)
    put("letters_tavern_leuven", 0, -6.5, 0, math.pi)
    put("hang_tankard", -3, -6.5, 0, math.pi)
    put("washpole_0", 5.0, -6.5, 5.0, math.pi)
    for i, (n, x) in enumerate((("cloth_shirt_0", -2.0), ("cloth_sheet_1", -0.8), ("cloth_trousers_0", 0.6), ("cloth_apron_0", 1.6))):
        put(n, x, -3.25, 6.2 - 0.25 * math.sin(math.pi * (x + 3.25) / 6.5))
    aim(cam, (-12, -3.3, 1.7), (2, -1.5, 3.2), lens=20)
    render(os.path.join(SHOTS, "streetlife_street.png"), (1600, 900))
    aim(cam, (4, -5.5, 1.7), (7, 0, 3.6), lens=22)
    render(os.path.join(SHOTS, "streetlife_corner.png"), (1280, 800))


# ------------------------------------------------------------------ main


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlases()
    make_materials()
    models, meta = build_models()
    objs = {}
    for name, mesh in models:
        objs[name] = mesh.to_object(name)
    counts = {n: tris(o) for n, o in objs.items()}
    slots = city_slots()
    meta.update(slots)
    node = bpy.data.objects.new("streetlife_meta", None)
    node["meta"] = json.dumps(meta, separators=(",", ":"))
    bpy.context.scene.collection.objects.link(node)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_streetlife] {n:24s} {c:5d} tris")
    print(f"[build_streetlife] atlases: solid {SOLID_ATLAS.W}x{SOLID_ATLAS.H}, decal {DECAL_ATLAS.W}x{DECAL_ATLAS.H}")
    print(f"[build_streetlife] {len(slots['walls'])} walls, {len(slots['corners'])} corners from the city")
    print(f"[build_streetlife] {len(objs)} models, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview_materials()
        preview(objs)


if __name__ == "__main__":
    main()
