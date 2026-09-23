"""Quay furniture of Antwerp, 1873: the iron, rope, timber and clutter along the water.

    blender -b --factory-startup -P tools/blender/build_quayfurniture.py
    blender -b --factory-startup -P tools/blender/build_quayfurniture.py -- --preview

Writes client/public/models/quayfurniture.glb (Draco). One node per model ("prototype"),
real scale in metres; client/src/world/quayfurniture.ts places copies along the quay
edges of shared/city.json, merged per chunk. After the period photos of the Antwerp
quays (the Werf, the Steenplein, the Vlaamse Kaai, the Bassins), reference only.

  wall face  mooring rings on staples (ring_wall) with a rust run under them, rope
             fenders and timber fenders with a hanging chain, painted quay names
             (wallname_*), berth numbers (berth_*)
  coping     rings let into the edge stones (ring_top), drain gratings, worn stones
  edge       cast-iron bollards of three kinds (bollard_cannon, bollard_mushroom,
             bitt_double), oak mooring posts (post_timber), capstans
  on stones  a chain run, a flaked hawser, a big coil, an anchor, a cable reel
  harbour    a customs booth, the harbour master's hut, a ferry toll shed, a notice board
             of the harbour master, signs on posts (quay names, "NO SMOKING ON THE QUAY"),
             a public weigh house door and painted notices for the storehouse walls
  work       nets and a tan sail drying on poles, oars on a trestle, eel pots and creels,
             fish baskets, a coal heap with a shovel, grain sacks on a pallet, timber
             baulks, a tar barrel with a fire, a ship's boat upturned on trestles
  light      a lantern on an iron post, for the heads of the stone steps

Frames. Blender is Z-up and the export turns it Y-up: Blender (x, y, z) is game
(x, z, -y). Things on the quay wall have their origin on the wall line at quay level;
they hang down the face toward -Y in Blender (the water side, game +Z). Things on the
ground stand on their origin, their front toward -Y.

Materials, by name: qf_solid (one atlas for everything solid), qf_decal (an RGBA atlas
for flat things pasted on walls or the ground, and the nets), qf_glow (lantern glass),
qf_fire (the flames of the tar barrel). The vertex colour "Col" carries a baked shade.
All textures are painted by the functions below, nearest filter; the letters come from
the 5x7 pixel font of build_streetlife.py (our own). Our own work: no downloaded models,
images or fonts.

An empty node "quayfurniture_meta" carries, in its extras (JSON): the atlas cells, the
sign texts and the storehouse fronts from shared/city_build.json, so the game needs no
extra file. Rebuild this after the city.

--preview renders the models to data/shots/quayfurniture_preview.png.
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "quayfurniture.glb")
SRC = os.path.join(ROOT, "shared", "city_build.json")
SHOTS = os.path.join(ROOT, "data", "shots")

SOLID, DECAL, GLOW, FIRE = range(4)
MAT_NAMES = ["qf_solid", "qf_decal", "qf_glow", "qf_fire"]

# ------------------------------------------------------------------ pixel font (5x7, as build_streetlife.py)

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
    "-": ["...", "...", "...", "###", "...", "...", "..."],
    " ": ["...", "...", "...", "...", "...", "...", "..."],
}


def text_width(s, scale=1):
    return (sum(len(GLYPHS[c][0]) + 1 for c in s) - 1) * scale


def draw_text(img, s, x, y, rgba, scale=1, wear=None):
    """Letters into an image array [row, col, ch], top left of the text at (x, y).
    wear: an rng; some pixels are left out (flaked paint)."""
    for c in s:
        g = GLYPHS[c]
        for r, row in enumerate(g):
            for k, ch in enumerate(row):
                if ch != "#":
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        if wear is not None and wear.random() < 0.12:
                            continue
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


def grain(seed, w, h, rgb, streaks=True):
    """Wood: grain along u (the long way of a board)."""
    rng = np.random.default_rng(seed)
    g = vnoise(rng, w, h, 3, max(2, h // 2)) * 0.6 + vnoise(rng, w, h, 8, h) * 0.4
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * (0.78 + 0.4 * g)[..., None]
    if streaks:
        for _ in range(h // 6):
            r = int(rng.integers(0, h))
            img[r, :, :3] *= 0.8
    return img


def rusty(seed, w, h, base, rust=(0.36, 0.18, 0.08), amt=0.35):
    """Painted iron with rust breaking through."""
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, base, 0.25)
    n = vnoise(rng, w, h, 5, 5) * 0.7 + vnoise(rng, w, h, 16, 16) * 0.3
    m = n > 1 - amt
    img[m, :3] = np.array(rust) * (0.8 + 0.4 * rng.random((m.sum(), 1)))
    # rust runs down from the top
    for _ in range(w // 5):
        c = int(rng.integers(0, w))
        L = int(rng.integers(h // 4, h))
        img[:L, c, :3] = img[:L, c, :3] * 0.5 + np.array(rust) * 0.5
    return img


def rope_tex(seed, w, h, rgb, tar=0.0):
    """Laid rope: the strands as diagonal bands."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    band = ((xx + yy * 2) % 6) / 6.0
    shade = 0.7 + 0.45 * np.sin(band * math.pi)
    img[..., :3] = np.array(rgb) * shade[..., None]
    img[..., :3] *= (0.9 + 0.2 * rng.random((h, w)))[..., None]
    if tar:
        img[..., :3] *= 1 - tar
    return img


def wicker(seed, w, h, rgb):
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    over = ((yy // 2) + (xx // 4)) % 2
    img[..., :3] = np.array(rgb) * (0.75 + 0.35 * over)[..., None]
    img[yy % 2 == 1, :3] *= 0.85
    img[xx % 4 == 0, :3] *= 0.7  # the stakes
    img[..., :3] *= (0.9 + 0.2 * rng.random((h, w)))[..., None]
    return img


def weave(seed, w, h, rgb):
    rng = np.random.default_rng(seed)
    img = flat(seed, w, h, rgb, 0.15)
    yy, xx = np.mgrid[0:h, 0:w]
    img[(xx + yy) % 2 == 0, :3] *= 0.88
    return img


def coal_tex(seed, w, h):
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    n = vnoise(rng, w, h, 8, 8)
    img[..., :3] = (0.05 + 0.07 * n)[..., None]
    m = rng.random((h, w)) < 0.08
    img[m, :3] = 0.22  # glints
    return img


def planks(seed, w, h, rgb, rows, tar_lo=0.0, band=None):
    """Planking across v: `rows` strakes with dark seams; tar_lo darkens the lower part."""
    img = grain(seed, w, h, rgb)
    for r in range(rows + 1):
        y = min(h - 1, int(r * h / rows))
        img[y, :, :3] *= 0.45
    if tar_lo:
        img[int(h * (1 - tar_lo)):, :, :3] *= 0.35
    if band is not None:
        y0, y1, col = band
        img[int(h * y0):int(h * y1), :, :3] = np.array(col) * (0.85 + 0.2 * np.random.default_rng(seed).random((int(h * y1) - int(h * y0), w, 1)))
    return img


def brick(seed, w, h):
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = (0.42, 0.20, 0.13)
    for r in range(0, h, 4):
        img[r, :, :3] = (0.55, 0.52, 0.46)
        off = 4 if (r // 4) % 2 else 0
        for c in range(off, w, 8):
            img[r:r + 4, c, :3] = (0.55, 0.52, 0.46)
    img[..., :3] *= (0.85 + 0.3 * rng.random((h, w)))[..., None]
    return img


def window_tex(seed, w, h):
    img = np.ones((h, w, 4))
    img[..., :3] = (0.05, 0.06, 0.07)
    img[..., :3] += np.random.default_rng(seed).random((h, w, 1)) * 0.04
    frame = (0.72, 0.70, 0.64)
    img[:1, :, :3] = frame
    img[-1:, :, :3] = frame
    img[:, :1, :3] = frame
    img[:, -1:, :3] = frame
    img[h // 2, :, :3] = frame
    img[:, w // 2, :3] = frame
    return img


def door_tex(seed, w, h, rgb):
    img = grain(seed, w, h, rgb, streaks=False)
    for c in range(0, w, 4):
        img[:, c, :3] *= 0.6
    img[h // 2:h // 2 + 1, :, :3] *= 0.6
    img[:2, :, :3] *= 0.6
    return img


def fish_tex(seed, w, h):
    """Herring and plaice in a basket: silver bodies on dark."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = (0.10, 0.10, 0.09)
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(26):
        cx, cy = rng.random() * w, rng.random() * h
        a = rng.random() * math.pi
        L, R = 5 + rng.random() * 3, 1.3 + rng.random() * 0.6
        u = (xx - cx) * math.cos(a) + (yy - cy) * math.sin(a)
        v = -(xx - cx) * math.sin(a) + (yy - cy) * math.cos(a)
        m = (u / L) ** 2 + (v / R) ** 2 < 1
        tone = 0.55 + rng.random() * 0.25
        img[m, :3] = (tone, tone * 1.02, tone * 1.05)
        img[m & (v < -R * 0.3), :3] *= 0.6  # dark backs
    return img


def glass_tex(w, h):
    img = np.ones((h, w, 4))
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2))
    img[..., 0] = 1.0
    img[..., 1] = 0.82 - 0.2 * d
    img[..., 2] = 0.5 - 0.3 * d
    img[0, :, :3] = img[-1, :, :3] = 0.1
    return img


def fire_tex(w, h):
    img = np.ones((h, w, 4))
    t = np.linspace(0, 1, h)[:, None] * np.ones((1, w))  # 0 at the top row
    img[..., 0] = 1.0
    img[..., 1] = 0.25 + 0.6 * t
    img[..., 2] = 0.05 + 0.3 * t ** 3
    return img


# ------------------------------------------------------------------ decals


def alpha_blob(rng, w, h, soft=0.35):
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx + 0.5 - w / 2) / (w / 2), (yy + 0.5 - h / 2) / (h / 2))
    n = vnoise(rng, w, h, 4, 4)
    return np.clip((1 - d + (n - 0.5) * 0.5) / soft, 0, 1)


def paint_rust_run(seed):
    """Rust run down the stone under a ring: a streak, darkest at the top."""
    w, h = 8, 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.36, 0.17, 0.07)
    t = np.linspace(1, 0, h)[:, None]
    xx = np.arange(w)[None, :]
    across = np.clip(1 - np.abs(xx + 0.5 - w / 2) / (w / 2), 0, 1)
    img[..., 3] = np.clip(t * 0.9 * across * (0.6 + 0.5 * rng.random((h, w))), 0, 0.85)
    return img


def paint_drain(seed):
    """An iron gully grating in a blue-stone frame, a dark wet ring round it."""
    w, h = 24, 16
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.26, 0.27, 0.28)
    img[..., 3] = 1
    img[2:-2, 2:-2, :3] = (0.05, 0.05, 0.05)
    for c in range(3, w - 2, 2):
        img[2:-2, c, :3] = (0.16, 0.13, 0.11)
    img[2:-2, 2:-2, :3] *= (0.8 + 0.4 * rng.random((h - 4, w - 4, 1)))
    return img


def paint_worn(seed):
    """Stone worn smooth by feet and ropes: lighter, a soft edge."""
    w, h = 32, 16
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.40, 0.39, 0.36)
    img[..., :3] *= (0.85 + 0.25 * vnoise(rng, w, h, 6, 3))[..., None]
    img[..., 3] = alpha_blob(rng, w, h) * 0.38
    return img


def paint_soot(seed):
    """Coal dust and soot on the stones round a heap or a fire."""
    w, h = 32, 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.04, 0.04, 0.04)
    img[..., 3] = alpha_blob(rng, w, h, 0.6) * (0.5 + 0.4 * rng.random((h, w)))
    return img


def paint_net(seed):
    """Knotted net: tarred twine in diamonds, holes clear."""
    w, h = 32, 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.20, 0.15, 0.10)
    yy, xx = np.mgrid[0:h, 0:w]
    m = ((xx + yy) % 5 == 0) | ((xx - yy) % 5 == 0)
    img[m, 3] = 1
    img[..., :3] *= (0.8 + 0.4 * rng.random((h, w, 1)))
    return img


def paint_wall_letters(text, seed, ink=(0.86, 0.84, 0.76), scale=2):
    """Big letters painted on stone or brick, worn."""
    w = text_width(text, scale) + 4
    h = 7 * scale + 4
    img = np.zeros((h, w, 4))
    draw_text(img, text, 2, 2, (*ink, 0.92), scale, wear=np.random.default_rng(seed))
    return img


def paint_berth(n, seed):
    """A berth number: white on a black painted panel."""
    s = str(n)
    w = text_width(s, 2) + 6
    h = 7 * 2 + 6
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.06, 0.06, 0.06)
    img[..., 3] = 0.95
    draw_text(img, s, 3, 3, (0.9, 0.88, 0.8, 1.0), 2, wear=np.random.default_rng(seed))
    return img


def paint_bill(kind, seed):
    """Papers pinned on the harbour master's board."""
    rng = np.random.default_rng(seed)
    w, h = 24, 32
    img = np.zeros((h, w, 4))
    paper = (0.86, 0.83, 0.72) if kind != "tides" else (0.78, 0.80, 0.84)
    img[..., :3] = paper
    img[..., :3] *= (0.9 + 0.12 * rng.random((h, w, 1)))
    img[..., 3] = 1
    ink = (0.1, 0.1, 0.12)
    if kind == "rules":
        draw_text(img, "RULES", 3, 2, (*ink, 1))
    elif kind == "tides":
        draw_text(img, "TIDE", 4, 2, (*ink, 1))
    else:
        img[2:9, 9:15, :3] = (0.3, 0.1, 0.08)  # a seal
    for r in range(12, h - 3, 3):
        L = int(rng.integers(8, w - 4))
        img[r, 3:3 + L, :3] = (0.35, 0.34, 0.33)
    return img


def paint_wall_notice(lines, seed, ink=(0.86, 0.84, 0.76), ground=None):
    """A notice painted on a storehouse wall (white on the brick), optionally on a panel."""
    w = max(text_width(s) for s in lines) + 6
    h = 8 * len(lines) + 5
    img = np.zeros((h, w, 4))
    if ground is not None:
        img[..., :3] = ground
        img[..., 3] = 0.9
    for i, s in enumerate(lines):
        draw_text(img, s, (w - text_width(s)) // 2, 3 + i * 8, (*ink, 0.95), 1, wear=np.random.default_rng(seed + i))
    return img


# ------------------------------------------------------------------ boards (solid)


def paint_board(lines, seed, bg, fg, border=None):
    w = max(text_width(s) for s in lines) + 8
    h = 8 * len(lines) + 6
    img = grain(seed, w, h, bg, streaks=False)
    if border is not None:
        img[:1, :, :3] = border
        img[-1:, :, :3] = border
        img[:, :1, :3] = border
        img[:, -1:, :3] = border
    for i, s in enumerate(lines):
        draw_text(img, s, (w - text_width(s)) // 2, 3 + i * 8, (*fg, 1), 1, wear=np.random.default_rng(seed + 7 + i))
    return img


# ------------------------------------------------------------------ the atlases


class Atlas:
    """Shelf-packed atlas; cells are (x, y, w, h) in pixels from the top left."""

    def __init__(self, width):
        self.W = width
        self.items = []
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
        x, y, w, h = self.cells[name]
        U = (x + 0.5 + min(max(u, 0.0), 1.0) * (w - 1)) / self.W
        row = y + 0.5 + (1 - min(max(v, 0.0), 1.0)) * (h - 1)
        return (U, 1 - row / self.H)


SOLID_ATLAS = Atlas(256)
DECAL_ATLAS = Atlas(256)

# Signs. Plain English; Dutch only in names.
SIGNS = {
    "name_werf": (["WERF"], (0.10, 0.14, 0.24), (0.88, 0.86, 0.78)),
    "name_steenplein": (["STEENPLEIN"], (0.10, 0.14, 0.24), (0.88, 0.86, 0.78)),
    "name_vismarkt": (["VISMARKT"], (0.10, 0.14, 0.24), (0.88, 0.86, 0.78)),
    "name_rijnkaai": (["RIJNKAAI"], (0.10, 0.14, 0.24), (0.88, 0.86, 0.78)),
    "name_bassin": (["PETIT BASSIN"], (0.10, 0.14, 0.24), (0.88, 0.86, 0.78)),
    "nosmoke": (["NO SMOKING", "ON THE QUAY"], (0.84, 0.82, 0.74), (0.45, 0.08, 0.06)),
    "nofire": (["NO FIRES", "ON THE QUAY"], (0.84, 0.82, 0.74), (0.10, 0.10, 0.10)),
    "nomoor": (["NO MOORING", "AT THE STEPS"], (0.84, 0.82, 0.74), (0.10, 0.10, 0.12)),
    "customs": (["CUSTOMS"], (0.08, 0.08, 0.07), (0.86, 0.74, 0.40)),
    "harbour": (["HARBOUR MASTER"], (0.08, 0.10, 0.08), (0.88, 0.84, 0.70)),
    "toll": (["FERRY", "TOLL 5 CENTIMES"], (0.10, 0.08, 0.06), (0.88, 0.84, 0.70)),
    "notices": (["HARBOUR NOTICES"], (0.08, 0.08, 0.07), (0.84, 0.80, 0.66)),
    "weigh": (["PUBLIC WEIGH HOUSE"], (0.08, 0.08, 0.07), (0.86, 0.74, 0.40)),
}
PX = 0.022  # metres per texel of sign lettering

WALL_NAMES = ["WERF", "STEENPLEIN", "VISMARKT", "RIJNKAAI", "PETIT BASSIN"]
WALL_NOTICES = {
    "wn_nosmoke": ["NO SMOKING", "ON THE QUAY"],
    "wn_nofire": ["NO FIRES OR LIGHTS", "NEAR THE STORES"],
    "wn_carts": ["CARTS KEEP", "TO THE RIGHT"],
}
BERTHS = list(range(1, 13))

PLAIN = {
    "iron": ((0.10, 0.10, 0.11), 0.3),
    "iron_light": ((0.22, 0.22, 0.23), 0.25),
    "bluestone": ((0.30, 0.32, 0.34), 0.25),
    "whitestone": ((0.66, 0.63, 0.57), 0.2),
    "zinc": ((0.40, 0.42, 0.43), 0.15),
    "slate": ((0.22, 0.24, 0.26), 0.2),
    "paint_green": ((0.13, 0.25, 0.17), 0.2),
    "paint_red": ((0.46, 0.11, 0.08), 0.2),
    "paint_white": ((0.80, 0.78, 0.72), 0.12),
    "brass": ((0.60, 0.46, 0.22), 0.2),
    "canvas": ((0.52, 0.50, 0.44), 0.15),
    "sail": ((0.46, 0.20, 0.12), 0.18),
    "grain": ((0.70, 0.58, 0.34), 0.25),
    "black": ((0.05, 0.05, 0.05), 0.2),
    "tar": ((0.07, 0.06, 0.05), 0.3),
    "ash": ((0.20, 0.19, 0.18), 0.3),
}


def build_atlases():
    for i, (name, (rgb, amt)) in enumerate(PLAIN.items()):
        size = 32 if name in ("bluestone", "whitestone", "zinc", "slate", "canvas", "sail") else 16
        SOLID_ATLAS.add(name, flat(100 + i, size, size, rgb, amt))
    SOLID_ATLAS.add("iron_rust", rusty(150, 32, 32, (0.09, 0.09, 0.10)))
    SOLID_ATLAS.add("iron_green", rusty(151, 32, 32, (0.10, 0.17, 0.13), amt=0.25))
    SOLID_ATLAS.add("wood", grain(160, 32, 32, (0.40, 0.31, 0.21)))
    SOLID_ATLAS.add("wood_dark", grain(161, 32, 32, (0.20, 0.15, 0.10)))
    SOLID_ATLAS.add("wood_grey", grain(162, 32, 32, (0.42, 0.40, 0.36)))
    SOLID_ATLAS.add("oak", grain(163, 32, 32, (0.30, 0.24, 0.17)))
    SOLID_ATLAS.add("endgrain", flat(164, 16, 16, (0.46, 0.36, 0.24), 0.3))
    SOLID_ATLAS.add("rope", rope_tex(170, 16, 16, (0.50, 0.42, 0.30)))
    SOLID_ATLAS.add("hawser", rope_tex(171, 16, 16, (0.34, 0.28, 0.20), tar=0.35))
    SOLID_ATLAS.add("wicker", wicker(180, 32, 32, (0.55, 0.44, 0.26)))
    SOLID_ATLAS.add("wicker_dark", wicker(181, 32, 32, (0.36, 0.28, 0.17)))
    SOLID_ATLAS.add("jute", weave(190, 32, 32, (0.56, 0.47, 0.32)))
    SOLID_ATLAS.add("coal", coal_tex(200, 32, 32))
    SOLID_ATLAS.add("hull_bottom", planks(210, 32, 64, (0.24, 0.18, 0.12), 8, tar_lo=0.0))
    SOLID_ATLAS.add("hull_side", planks(211, 32, 32, (0.30, 0.24, 0.16), 5, band=(0.0, 0.2, (0.14, 0.26, 0.20))))
    SOLID_ATLAS.add("shed_planks", planks(212, 32, 64, (0.16, 0.24, 0.18), 1))
    SOLID_ATLAS.add("hut_planks", planks(213, 32, 64, (0.30, 0.28, 0.24), 1))
    SOLID_ATLAS.add("brick", brick(220, 32, 32))
    SOLID_ATLAS.add("window", window_tex(230, 16, 16))
    SOLID_ATLAS.add("door_green", door_tex(231, 16, 32, (0.14, 0.22, 0.16)))
    SOLID_ATLAS.add("door_brown", door_tex(232, 32, 32, (0.28, 0.18, 0.10)))
    SOLID_ATLAS.add("fish", fish_tex(240, 32, 32))
    SOLID_ATLAS.add("glass", glass_tex(8, 16))
    SOLID_ATLAS.add("fire", fire_tex(8, 16))
    for i, (key, (lines, bg, fg)) in enumerate(SIGNS.items()):
        SOLID_ATLAS.add(f"sign_{key}", paint_board(lines, 300 + i, bg, fg, border=tuple(np.array(fg) * 0.8)))
    for i, n in enumerate(WALL_NAMES):
        DECAL_ATLAS.add(f"wallname_{i}", paint_wall_letters(n, 400 + i))
    for n in BERTHS:
        DECAL_ATLAS.add(f"berth_{n}", paint_berth(n, 450 + n))
    for i, (k, lines) in enumerate(WALL_NOTICES.items()):
        DECAL_ATLAS.add(k, paint_wall_notice(lines, 480 + i))
    DECAL_ATLAS.add("rust_run", paint_rust_run(500))
    DECAL_ATLAS.add("drain", paint_drain(501))
    DECAL_ATLAS.add("worn", paint_worn(502))
    DECAL_ATLAS.add("soot", paint_soot(503))
    DECAL_ATLAS.add("net", paint_net(504))
    for i, k in enumerate(("rules", "tides", "notice")):
        DECAL_ATLAS.add(f"bill_{k}", paint_bill(k, 510 + i))
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
    solid = bl_image("qf_solid_tex", SOLID_ATLAS.img, False)
    decal = bl_image("qf_decal_tex", DECAL_ATLAS.img, True)
    for name, img in zip(MAT_NAMES, [solid, decal, solid, solid]):
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
        if img is decal:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry (as build_streetlife.py)


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def fit_uv(pts):
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
        atlas = DECAL_ATLAS if mat == DECAL else SOLID_ATLAS
        for loop, (u, v), p in zip(f.loops, uvs, pts):
            loop[self.uv].uv = atlas.uv(cell, u, v)
            s = shade
            if self.ao > 0:
                s *= 0.55 + 0.45 * min(1.0, max(0.0, (self.xf @ p).z / self.ao))
            loop[self.col] = (s, s, s, 1.0)
        return f

    def quad(self, pts, cell, mat=SOLID, shade=1.0, out=None):
        return self.face(pts, cell, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=mat, shade=shade, out=out)

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
            self.face([P[i] for i in idx], ce, shade=shade * (0.8 if k == "-z" else 1.0))

    def beam(self, a, b, w, h, cell, shade=1.0, side=None, ends=True):
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
        idxs = [(0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
        if ends:
            idxs += [(0, 2, 3, 1), (4, 5, 7, 6)]
        mid = (a + b) / 2
        for idx in idxs:
            pts = [P[i] for i in idx]
            c = sum(pts, Vector()) / 4
            self.face(pts, cell, shade=shade, out=c - mid if (c - mid).length > 1e-6 else None)

    def lathe(self, prof, sides, cell, rot=0.0, cap0=False, cap1=False, shade=1.0, arc=None, cells=None, M=None, cap_cell=None):
        """Turned shape about +Z; profile (r, z) bottom to top."""
        if M is not None:
            with self.at(M):
                return self.lathe(prof, sides, cell, rot=rot, cap0=cap0, cap1=cap1, shade=shade, arc=arc, cells=cells, cap_cell=cap_cell)
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
            self.face(rings[0], cap_cell or (cells[0] if cells else cell), shade=shade * 0.8, out=(0, 0, -1))
        if cap1 and full and prof[-1][0] > 1e-4:
            self.face(rings[-1], cap_cell or (cells[-1] if cells else cell), shade=shade, out=(0, 0, 1))

    def tube(self, path, r, sides, cell, closed=False, shade=1.0, up=None):
        path = [Vector(p) for p in path]
        N = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed:
                t = path[(k + 1) % N] - path[(k - 1) % N]
            else:
                t = path[min(k + 1, N - 1)] - path[max(k - 1, 0)]
            t.normalize()
            s = Vector(up) if up else Vector((1, 0, 0))
            if abs(s.dot(t)) > 0.9:
                s = Vector((0, 1, 0)) if not up else Vector((1, 0, 0))
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


def ring_path(r, n, cx=0.0, cy=0.0, cz=0.0, plane="xz", ry=None):
    """A closed loop of n points: in the x-z plane (hanging on a wall) or x-y (lying)."""
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        if plane == "xz":
            out.append((cx + r * math.cos(a), cy, cz + (ry or r) * math.sin(a)))
        else:
            out.append((cx + r * math.cos(a), cy + (ry or r) * math.sin(a), cz))
    return out


# ------------------------------------------------------------------ models: the wall face


def ring_wall():
    """An iron ring on a staple let into the quay wall, 0.5 m under the edge; a rust run below."""
    m = Mesh()
    z0 = -0.5
    m.box((0, -0.015, z0), (0.12, 0.03, 0.1), "iron_rust")
    # the ring hangs from the staple, lying a little off the wall
    pts = ring_path(0.13, 7, 0, -0.045, z0 - 0.13, plane="xz")
    m.tube(pts, 0.022, 3, "iron_rust", closed=True)
    m.quad([(-0.1, -0.003, z0 - 1.4), (0.1, -0.003, z0 - 1.4), (0.1, -0.003, z0 - 0.05), (-0.1, -0.003, z0 - 0.05)], "rust_run", mat=DECAL, out=(0, -1, 0))
    return m


def ring_top():
    """A ring let into the edge stone, lying flat, its eye bolt set in lead."""
    m = Mesh()
    y0 = 0.3  # inland of the edge
    m.box((0, y0, 0.075), (0.12, 0.08, 0.03), "iron")
    m.tube(ring_path(0.12, 7, 0, y0 - 0.14, 0.085, plane="xy"), 0.02, 3, "iron_rust", closed=True, up=(0, 0, 1))
    m.quad([(-0.25, y0 - 0.34, 0.068), (0.25, y0 - 0.34, 0.068), (0.25, y0 + 0.08, 0.068), (-0.25, y0 + 0.08, 0.068)], "worn", mat=DECAL, out=(0, 0, 1))
    return m


def fender_rope():
    """A rope fender: a stuffed bolster on two lines from an eye on the edge stone, down the wall."""
    m = Mesh()
    eye = (0, 0.35, 0.08)
    m.box((0, 0.35, 0.075), (0.1, 0.1, 0.03), "iron")
    zb = -1.05
    for dx in (-0.12, 0.12):
        m.tube([(dx * 0.4, 0.35, 0.09), (dx * 0.8, -0.05, 0.1), (dx, -0.27, 0.07), (dx, -0.27, -0.2), (dx, -0.22, zb)], 0.018, 3, "rope")
    with m.at(move(0, -0.2, 0)):
        m.lathe([(0.02, zb - 0.72), (0.1, zb - 0.68), (0.16, zb - 0.55), (0.17, zb - 0.3), (0.15, zb - 0.1), (0.08, zb + 0.02), (0.02, zb + 0.04)], 6, "hawser")
        for z in (zb - 0.2, zb - 0.45):
            m.lathe([(0.172, z), (0.175, z + 0.04)], 6, "rope")
    return m


def fender_timber():
    """A timber rubbing post down the wall face, strapped with iron, a chain hanging in a loop beside it."""
    m = Mesh()
    m.box((0, -0.12, -1.45), (0.26, 0.2, 2.8), "oak", cells={"+z": "endgrain", "-z": "endgrain"})
    for z in (-0.25, -1.3, -2.4):
        m.box((0, -0.12, z), (0.3, 0.22, 0.06), "iron_rust")
        for sx in (-1, 1):
            m.box((sx * 0.17, -0.01, z), (0.05, 0.02, 0.1), "iron_rust")
    # a chain in a loop down the wall: links as small alternating hoops
    pts = []
    n = 14
    for i in range(n + 1):
        t = i / n
        x = 0.35 + 0.35 * t
        z = -0.35 - 1.2 * math.sin(math.pi * t)
        pts.append((x, -0.05, z))
    for i in range(n):
        a, b = Vector(pts[i]), Vector(pts[i + 1])
        c = (a + b) / 2
        d = (b - a)
        L = d.length
        ang = math.atan2(d.z, d.x)
        if i % 2 == 0:
            loop = [(c.x + math.cos(ang) * L * 0.6 * math.cos(q) - math.sin(ang) * 0.035 * math.sin(q), -0.05,
                     c.z + math.sin(ang) * L * 0.6 * math.cos(q) + math.cos(ang) * 0.035 * math.sin(q)) for q in np.linspace(0, 2 * math.pi, 5, endpoint=False)]
        else:
            loop = [(c.x + math.cos(ang) * L * 0.6 * math.cos(q), -0.05 - 0.035 * math.sin(q), c.z + math.sin(ang) * L * 0.6 * math.cos(q))
                    for q in np.linspace(0, 2 * math.pi, 5, endpoint=False)]
        m.tube(loop, 0.009, 3, "iron_rust", closed=True)
    for x in (0.35, 0.7):
        m.box((x, -0.015, -0.33), (0.07, 0.03, 0.07), "iron_rust")
    return m


def wall_decal(cell, width, z_top, name_px=0.05):
    """Letters or a panel painted on a wall face (origin on the wall line, top at z_top)."""
    m = Mesh()
    x, y, w, h = DECAL_ATLAS.cells[cell]
    W, H = w * name_px, h * name_px
    m.quad([(-W / 2, -0.004, z_top - H), (W / 2, -0.004, z_top - H), (W / 2, -0.004, z_top), (-W / 2, -0.004, z_top)], cell, mat=DECAL, out=(0, -1, 0))
    return m, W


def ground_decal(cell, w, d, y=0.0):
    m = Mesh()
    m.quad([(-w / 2, y - d / 2, 0.0), (w / 2, y - d / 2, 0.0), (w / 2, y + d / 2, 0.0), (-w / 2, y + d / 2, 0.0)], cell, mat=DECAL, out=(0, 0, 1))
    return m


# ------------------------------------------------------------------ models: the edge


def bollard_cannon():
    """An old cannon sunk muzzle-up as a bollard, as on the Werf: a swell at the muzzle, a ball in the bore."""
    m = Mesh()
    m.box((0, 0, 0.02), (0.62, 0.62, 0.04), "bluestone")
    m.lathe([(0.2, 0.0), (0.2, 0.08), (0.185, 0.1), (0.17, 0.55), (0.18, 0.6), (0.2, 0.68), (0.2, 0.74), (0.17, 0.78), (0.12, 0.79)], 9, "iron_rust")
    m.lathe([(0.12, 0.79), (0.12, 0.8), (0.0, 0.84)], 9, "iron")
    m.lathe([(0.187, 0.3), (0.195, 0.33), (0.187, 0.36)], 9, "iron")
    return m


def bollard_mushroom():
    """A cast-iron quay bollard: a flanged foot, a waisted neck, a wide head with a lip to hold the rope."""
    m = Mesh()
    m.box((0, 0, 0.025), (0.7, 0.7, 0.05), "bluestone")
    m.lathe([(0.3, 0.05), (0.3, 0.1), (0.24, 0.13), (0.2, 0.2), (0.17, 0.42), (0.19, 0.52), (0.29, 0.6), (0.3, 0.66), (0.26, 0.7), (0.0, 0.73)], 10,
            "iron_green", cap0=False)
    m.lathe([(0.3, 0.05), (0.0, 0.05)], 10, "iron")
    return m


def bitt_double():
    """A double bitt on a cast base plate: two short posts with caps, a bar between."""
    m = Mesh()
    m.box((0, 0, 0.03), (1.25, 0.5, 0.06), "iron_rust")
    for sx in (-1, 1):
        with m.at(move(sx * 0.38, 0, 0)):
            m.lathe([(0.17, 0.06), (0.15, 0.1), (0.14, 0.5), (0.18, 0.56), (0.18, 0.62), (0.0, 0.64)], 8, "iron_rust")
    m.beam((-0.26, 0, 0.35), (0.26, 0, 0.35), 0.08, 0.08, "iron")
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.box((sx * 0.56, sy * 0.19, 0.07), (0.06, 0.06, 0.03), "iron_light")
    return m


def post_timber():
    """An oak mooring post: squared, chamfered top, an iron band, worn pale where the ropes run."""
    m = Mesh()
    s = 0.15
    m.box((0, 0, 0.5), (0.3, 0.3, 1.0), "oak", skip=("+z", "-z"))
    top = [(-s, -s, 1.0), (s, -s, 1.0), (s, s, 1.0), (-s, s, 1.0)]
    apex = (0, 0, 1.12)
    for i in range(4):
        a, b = top[i], top[(i + 1) % 4]
        mid = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1.05))
        m.face([a, b, apex], "endgrain", out=mid)
    m.box((0, 0, 0.88), (0.32, 0.32, 0.07), "iron_rust", skip=("+z", "-z"))
    m.box((0, 0, 0.65), (0.305, 0.305, 0.12), "wood_grey", skip=("+z", "-z"))
    return m


def capstan():
    """A quay capstan: an octagonal foot with pawls, a waisted barrel with whelps, a drumhead with
    bar holes. Two capstan bars lie beside it."""
    m = Mesh()
    m.lathe([(0.55, 0.0), (0.55, 0.08), (0.42, 0.12), (0.0, 0.12)], 8, "iron", rot=math.pi / 8)
    for i in range(6):
        a = 2 * math.pi * i / 6
        m.beam((0.3 * math.cos(a), 0.3 * math.sin(a), 0.13), (0.42 * math.cos(a + 0.4), 0.42 * math.sin(a + 0.4), 0.13), 0.05, 0.04, "iron_light")
    m.lathe([(0.3, 0.12), (0.26, 0.25), (0.22, 0.45), (0.24, 0.62), (0.3, 0.68)], 8, "iron_rust")
    # whelps: ribs on the barrel
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        c, s = math.cos(a), math.sin(a)
        m.face([(0.27 * c, 0.27 * s, 0.2), (0.31 * c, 0.31 * s, 0.22), (0.27 * c, 0.27 * s, 0.62), (0.23 * c, 0.23 * s, 0.48)], "iron", out=(c, s, 0))
        m.face([(0.27 * c, 0.27 * s, 0.2), (0.23 * c, 0.23 * s, 0.48), (0.27 * c, 0.27 * s, 0.62), (0.31 * c, 0.31 * s, 0.22)], "iron", out=(-s, c, 0))
    # the drumhead: a thick disc with square holes for the bars (painted dark squares)
    m.lathe([(0.36, 0.68), (0.38, 0.72), (0.38, 0.86), (0.34, 0.9), (0.0, 0.92)], 8, "iron_rust")
    for i in range(8):
        a = 2 * math.pi * i / 8 + math.pi / 8
        c, s = math.cos(a), math.sin(a)
        p = Vector((0.385 * c, 0.385 * s, 0.79))
        t = Vector((-s, c, 0))
        m.face([p - t * 0.05 + Vector((0, 0, -0.045)), p + t * 0.05 + Vector((0, 0, -0.045)), p + t * 0.05 + Vector((0, 0, 0.045)), p - t * 0.05 + Vector((0, 0, 0.045))],
               "black", out=(c, s, 0))
    for k, (x, a) in enumerate(((0.9, 0.12), (1.05, -0.08))):
        m.beam((x, -0.9 + k * 0.25, 0.04 + k * 0.05), (x + 0.2, 0.9 + k * 0.25, 0.04), 0.07, 0.07, "wood")
    return m


def mooring_line(along=0.0):
    """A mooring line: a bight round a bollard's neck (0.5 m up), out over the edge stone, down the wall
    to a boat lying off the quay. `along`: how far it runs along the quay on its way (m)."""
    m = Mesh()
    m.tube(ring_path(0.2, 7, 0, 0, 0.5, plane="xy"), 0.03, 3, "hawser", closed=True, up=(0, 0, 1))
    pts = [(0.0, -0.2, 0.5), (along * 0.1, -0.5, 0.35), (along * 0.2, -0.85, 0.12), (along * 0.28, -1.05, 0.02),
           (along * 0.4, -1.3, -0.5), (along * 0.6, -1.7, -1.3), (along * 0.8, -2.2, -1.85), (along, -2.9, -2.1)]
    m.tube(pts, 0.03, 3, "hawser")
    return m


# ------------------------------------------------------------------ models: on the stones


def chain_run():
    """A heavy chain dragged out on the stones: links alternately flat and on edge along a wavy line, a heap at one end."""
    m = Mesh()
    path = []
    for i in range(20):
        t = i / 19
        path.append(Vector((-1.6 + 3.2 * t, 0.25 * math.sin(t * 5.2), 0.0)))
    L = 0.16
    k = 0
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        seg = (b - a).length
        d = (b - a).normalized()
        nlinks = max(1, int(seg / L))
        for j in range(nlinks):
            c = a + d * (L * (j + 0.5))
            ang = math.atan2(d.y, d.x)
            if k % 2 == 0:
                pts = [(c.x + math.cos(ang) * 0.1 * math.cos(q) - math.sin(ang) * 0.05 * math.sin(q),
                        c.y + math.sin(ang) * 0.1 * math.cos(q) + math.cos(ang) * 0.05 * math.sin(q), 0.02) for q in np.linspace(0, 2 * math.pi, 5, endpoint=False)]
            else:
                pts = [(c.x + math.cos(ang) * 0.1 * math.cos(q), c.y + math.sin(ang) * 0.1 * math.cos(q), 0.05 + 0.045 * math.sin(q))
                       for q in np.linspace(0, 2 * math.pi, 5, endpoint=False)]
            m.tube(pts, 0.017, 3, "iron_rust", closed=True)
            k += 1
    # the heap: a low lump of chain at the end
    m.lathe([(0.35, 0.0), (0.3, 0.08), (0.18, 0.14), (0.0, 0.16)], 7, "iron_rust", M=move(1.8, 0.1, 0))
    return m


def hawser_flake():
    """A tarred hawser laid out on the stones in long flakes, the eye at one end."""
    m = Mesh()
    pts = []
    loops = 3
    for i in range(loops * 12 + 1):
        t = i / 12
        k = int(t)
        f = t - k
        side = 1 if k % 2 == 0 else -1
        x = -1.2 + 2.4 * (0.5 - 0.5 * math.cos(math.pi * f)) * 1.0
        x = x if side > 0 else -x
        y = k * 0.14 + 0.07 * (1 - math.cos(math.pi * f)) * 0.5 + 0.07 * (math.sin(math.pi * f) ** 8)
        pts.append((x, y - 0.2, 0.045))
    m.tube(pts, 0.045, 4, "hawser")
    m.tube(ring_path(0.18, 7, 1.45, -0.2, 0.045, plane="xy", ry=0.12), 0.04, 4, "hawser", closed=True, up=(0, 0, 1))
    return m


def hawser_coil():
    """A big hawser coiled down flat, three turns high."""
    m = Mesh()
    pts = []
    for i in range(3 * 10 + 1):
        a = 2 * math.pi * i / 10
        r = 0.5 - 0.02 * (i / 10)
        pts.append((r * math.cos(a), r * math.sin(a), 0.05 + 0.085 * i / 10))
    m.tube(pts, 0.05, 4, "hawser")
    m.lathe([(0.42, 0.01), (0.42, 0.02), (0.0, 0.02)], 8, "tar")
    m.tube([(0.5, 0, 0.05), (0.8, -0.3, 0.05), (1.2, -0.35, 0.05)], 0.05, 4, "hawser")
    return m


def anchor():
    """A stocked anchor lying on the quay: shank, crown, curved arms with flukes, an oak stock, the ring."""
    m = Mesh()
    # lying on one arm: the shank along x, low; the stock stands up at the ring end
    m.beam((-1.0, 0, 0.1), (0.9, 0, 0.1), 0.1, 0.1, "iron_rust")
    for sg in (-1, 1):
        pts = [(-1.0 + 0.3 * (1 - math.cos(a)), sg * 0.62 * math.sin(a), 0.1 + (0.35 * math.sin(a) if sg > 0 else 0.0)) for a in np.linspace(0, 1.3, 5)]
        m.tube(pts, 0.05, 4, "iron_rust")
        tip = Vector(pts[-1])
        back = Vector(pts[-2])
        d = (tip - back).normalized()
        n = Vector((0, 0, 1)) if sg < 0 else Vector((0, -0.7, 0.7))
        s = d.cross(n).normalized()
        base = tip - d * 0.28
        m.face([base - s * 0.14, base + s * 0.14, tip + d * 0.06], "iron", out=n)
        m.face([base - s * 0.14 - n * 0.02, tip + d * 0.06 - n * 0.02, base + s * 0.14 - n * 0.02], "iron", out=-n)
    m.lathe([(0.1, -0.08), (0.12, 0.0), (0.1, 0.08)], 6, "iron", M=move(-1.0, 0, 0.1) @ rot("Y", math.pi / 2))
    # stock: a wooden bar across, standing up from the ground
    m.beam((0.7, 0, 0.02), (0.7, 0, 1.3), 0.14, 0.14, "oak")
    for z in (0.35, 1.0):
        m.box((0.7, 0, z), (0.16, 0.16, 0.05), "iron_rust")
    m.tube(ring_path(0.18, 7, 1.08, 0.0, 0.2, plane="xz"), 0.03, 3, "iron_rust", closed=True)
    return m


def cable_reel():
    """A wooden cable drum on its rim, hawser wound on it, a timber chock under it."""
    m = Mesh()
    R, W = 0.62, 0.8
    M = move(0, 0, R) @ rot("X", math.pi / 2)
    for zz in (-W / 2, W / 2 - 0.06):
        m.lathe([(R, zz), (R, zz + 0.06)], 10, "wood", M=M)
        m.lathe([(R, zz + (0.06 if zz > 0 else 0)), (0.0, zz + (0.06 if zz > 0 else 0))], 10, "wood_grey", M=M)
        if zz < 0:
            m.lathe([(0.0, zz), (R, zz)], 10, "wood_grey", M=M)
    m.lathe([(0.42, -W / 2 + 0.06), (0.44, -0.2), (0.44, 0.2), (0.42, W / 2 - 0.06)], 10, "hawser", M=M)
    m.lathe([(0.07, -W / 2 - 0.08), (0.07, W / 2 + 0.08)], 6, "iron", M=M, cap0=True, cap1=True)
    for sx in (-1, 1):
        m.beam((sx * 0.5, -0.5, 0.06), (sx * 0.5, 0.5, 0.06), 0.14, 0.12, "oak")
    m.tube([(0.44, 0.1, R + 0.3), (0.62, 0.2, 0.3), (0.9, 0.3, 0.05), (1.4, 0.2, 0.05)], 0.045, 4, "hawser")
    return m


# ------------------------------------------------------------------ models: harbour buildings and signs


def sign_board(key):
    """A board with the sign's lettering; returns (width, height)."""
    x, y, w, h = SOLID_ATLAS.cells[f"sign_{key}"]
    return w * PX, h * PX


def post_sign(key, height=2.1, two=False):
    """A painted board on one post (or two), lettered both sides; faces -Y."""
    m = Mesh()
    W, H = sign_board(key)
    posts = [(-W / 2 + 0.08,), (W / 2 - 0.08,)] if two or W > 1.3 else [(0.0,)]
    for (x,) in posts:
        m.box((x, 0.04, (height + H / 2) / 2), (0.08, 0.08, height + H / 2), "wood_dark")
        m.box((x, 0.04, height + H / 2 + 0.03), (0.1, 0.1, 0.04), "wood_dark")
    zc = height
    m.box((0, 0.0, zc), (W, 0.04, H), "wood_dark", cells={"-y": f"sign_{key}", "+y": f"sign_{key}"})
    return m


def customs_booth():
    """A customs officer's booth: planked walls, windows on three sides, a zinc pyramid roof, a stove pipe,
    the board over the open door. 1.4 x 1.4 m, front -Y."""
    m = Mesh(ao=2.2)
    S, H = 1.4, 2.35
    h = S / 2
    m.box((0, 0, 0.06), (S + 0.1, S + 0.1, 0.12), "bluestone")
    # walls: back and sides whole, front with a door opening 0.7 wide
    for sx in (-1, 1):
        m.box((sx * (h - 0.03), 0, 0.12 + H / 2), (0.06, S, H), "shed_planks", cells={"+x" if sx > 0 else "-x": "shed_planks"})
        m.box((sx * (h + 0.005), 0.0, 1.55), (0.02, 0.5, 0.55), "window", skip=("+x",) if sx < 0 else ("-x",))
    m.box((0, h - 0.03, 0.12 + H / 2), (S, 0.06, H), "shed_planks")
    m.box((0, h + 0.005, 1.55), (0.6, 0.02, 0.55), "window")
    for sx in (-1, 1):
        m.box((sx * 0.52, -h + 0.03, 0.12 + H / 2), (0.36, 0.06, H), "shed_planks")
    m.box((0, -h + 0.03, 0.12 + H - 0.25), (0.7, 0.06, 0.5), "shed_planks")
    m.box((0, -h + 0.2, 0.13), (0.68, 0.4, 0.02), "wood_dark")  # the floor boards seen through the door
    m.box((0, 0, 0.12 + 0.02), (S - 0.1, S - 0.1, 0.02), "wood_dark")
    # a shelf-desk inside under the side window
    m.box((0.45, 0.1, 1.05), (0.35, 0.8, 0.04), "wood")
    # the roof: a low pyramid of zinc with an overhang, a knob
    top = 0.12 + H
    o = h + 0.18
    apex = (0, 0, top + 0.55)
    c = [(-o, -o, top), (o, -o, top), (o, o, top), (-o, o, top)]
    for i in range(4):
        a, b = c[i], c[(i + 1) % 4]
        mid = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, top + 0.2))
        m.face([a, b, apex], "zinc", out=mid)
        m.face([a, apex, b], "wood_dark", out=-mid, shade=0.6)
    m.lathe([(0.05, top + 0.52), (0.07, top + 0.6), (0.0, top + 0.66)], 6, "zinc")
    m.lathe([(0.05, top + 0.1), (0.05, top + 0.9), (0.08, top + 0.95), (0.0, top + 0.97)], 5, "iron", M=move(0.35, 0.35, 0))
    # the board over the door
    W, Hb = sign_board("customs")
    m.box((0, -h - 0.02, top - 0.12), (W, 0.03, Hb), "wood_dark", cells={"-y": "sign_customs"})
    return m


def harbour_hut():
    """The harbour master's hut: planked on a brick plinth, a door and two windows at the front, a slate gable
    roof, a chimney pipe, the board under the eaves. 3.2 x 2.4 m, front -Y."""
    m = Mesh(ao=2.6)
    W, D, H = 3.2, 2.4, 2.5
    m.box((0, 0, 0.2), (W + 0.06, D + 0.06, 0.4), "brick")
    m.box((0, 0, 0.4 + H / 2), (W, D, H), "hut_planks", cells={"+z": "wood_dark", "-z": "wood_dark"})
    fy = -D / 2 - 0.01
    m.quad([(-1.2, fy, 0.4), (-0.4, fy, 0.4), (-0.4, fy, 2.3), (-1.2, fy, 2.3)], "door_green", out=(0, -1, 0))
    for x in (0.25, 1.05):
        m.quad([(x - 0.3, fy, 1.2), (x + 0.3, fy, 1.2), (x + 0.3, fy, 2.0), (x - 0.3, fy, 2.0)], "window", out=(0, -1, 0))
        m.box((x, fy - 0.04, 1.17), (0.7, 0.1, 0.05), "paint_white")
    for sx in (-1, 1):
        m.quad([(sx * (W / 2 + 0.01), -0.3, 1.2), (sx * (W / 2 + 0.01), 0.3, 1.2), (sx * (W / 2 + 0.01), 0.3, 2.0), (sx * (W / 2 + 0.01), -0.3, 2.0)],
               "window", out=(sx, 0, 0))
    # step at the door
    m.box((-0.8, fy - 0.2, 0.18), (0.9, 0.4, 0.36), "bluestone")
    # gable roof, ridge along x
    top = 0.4 + H
    o = 0.25
    rz = top + 1.0
    for sy in (-1, 1):
        m.face([(-W / 2 - o, sy * (D / 2 + o), top - 0.12), (W / 2 + o, sy * (D / 2 + o), top - 0.12), (W / 2 + o, 0, rz), (-W / 2 - o, 0, rz)],
               "slate", out=(0, sy, 1))
        m.face([(-W / 2 - o, sy * (D / 2 + o), top - 0.12), (-W / 2 - o, 0, rz), (W / 2 + o, 0, rz), (W / 2 + o, sy * (D / 2 + o), top - 0.12)],
               "wood_dark", out=(0, -sy, -1), shade=0.5)
    for sx in (-1, 1):
        m.face([(sx * W / 2, -D / 2, top), (sx * W / 2, D / 2, top), (sx * W / 2, 0, rz - 0.05)], "hut_planks", out=(sx, 0, 0))
    m.lathe([(0.07, rz - 0.5), (0.07, rz + 0.7), (0.1, rz + 0.75), (0.0, rz + 0.8)], 6, "iron", M=move(1.0, 0.5, 0))
    Wb, Hb = sign_board("harbour")
    m.box((0, fy - 0.03, top - 0.2), (Wb, 0.03, Hb), "wood_dark", cells={"-y": "sign_harbour"})
    # a lamp bracket by the door (unlit iron) and a bench
    m.box((1.2, fy - 0.3, 0.45), (0.9, 0.3, 0.05), "wood")
    for sx in (-1, 1):
        m.box((1.2 + sx * 0.38, fy - 0.3, 0.22), (0.05, 0.28, 0.44), "wood_dark")
    return m


def toll_shed():
    """The ferry toll shed: open at the front over a counter, a lean-to roof of tarred boards, the toll board."""
    m = Mesh(ao=2.2)
    W, D = 2.4, 1.5
    hf, hb = 2.5, 2.1
    m.box((0, 0, 0.05), (W + 0.1, D + 0.1, 0.1), "bluestone")
    m.box((0, D / 2 - 0.03, 0.1 + hb / 2), (W, 0.06, hb), "shed_planks")
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.03)
        m.face([(x, -D / 2, 0.1), (x, D / 2, 0.1), (x, D / 2, 0.1 + hb), (x, -D / 2, 0.1 + hf)], "shed_planks", out=(sx, 0, 0))
        m.face([(x - sx * 0.06, -D / 2, 0.1), (x - sx * 0.06, -D / 2, 0.1 + hf), (x - sx * 0.06, D / 2, 0.1 + hb), (x - sx * 0.06, D / 2, 0.1)],
               "wood_dark", out=(-sx, 0, 0), shade=0.6)
    # counter across the front, the front board under it
    m.box((0, -D / 2 + 0.05, 1.0), (W - 0.12, 0.08, 0.9), "shed_planks")
    m.box((0, -D / 2 + 0.05, 1.47), (W, 0.35, 0.05), "wood")
    m.box((0.5, -D / 2 + 0.05, 1.5), (0.3, 0.2, 0.02), "brass")  # the money tray
    # roof: a lean-to
    o = 0.2
    m.face([(-W / 2 - o, -D / 2 - o, 0.1 + hf + 0.04), (W / 2 + o, -D / 2 - o, 0.1 + hf + 0.04), (W / 2 + o, D / 2 + o, 0.1 + hb - 0.04),
            (-W / 2 - o, D / 2 + o, 0.1 + hb - 0.04)], "tar", out=(0, 0, 1))
    m.face([(-W / 2 - o, -D / 2 - o, 0.1 + hf), (-W / 2 - o, D / 2 + o, 0.1 + hb - 0.08), (W / 2 + o, D / 2 + o, 0.1 + hb - 0.08),
            (W / 2 + o, -D / 2 - o, 0.1 + hf)], "wood_dark", out=(0, 0, -1), shade=0.5)
    Wb, Hb = sign_board("toll")
    m.box((0, -D / 2 - 0.02, 0.1 + hf - 0.25), (Wb, 0.03, Hb), "wood_dark", cells={"-y": "sign_toll"})
    m.box((0, -D / 2 + 0.05, 0.1 + hf - 0.05), (W, 0.1, 0.1), "wood_dark")
    return m


def notice_board():
    """The harbour master's notice board: two posts, a framed board with papers, a little roof."""
    m = Mesh()
    for sx in (-1, 1):
        m.box((sx * 0.75, 0, 1.15), (0.1, 0.1, 2.3), "wood_dark")
    m.box((0, 0, 1.5), (1.6, 0.06, 1.0), "wood_dark", cells={"-y": "wood"})
    m.box((0, -0.03, 2.0), (1.66, 0.08, 0.06), "wood_dark")
    m.box((0, -0.03, 1.0), (1.66, 0.08, 0.06), "wood_dark")
    for sy in (-1, 1):
        m.face([(-0.95, sy * 0.3, 2.3), (0.95, sy * 0.3, 2.3), (0.95, 0, 2.45), (-0.95, 0, 2.45)], "zinc", out=(0, sy, 1))
    W, H = sign_board("notices")
    m.box((0, -0.035, 2.13), (W, 0.03, H), "wood_dark", cells={"-y": "sign_notices"})
    for i, (x, z, k) in enumerate(((-0.45, 1.5, "rules"), (0.05, 1.55, "tides"), (0.5, 1.45, "notice"))):
        m.quad([(x - 0.18, -0.035, z - 0.24), (x + 0.18, -0.035, z - 0.24), (x + 0.18, -0.035, z + 0.24), (x - 0.18, -0.035, z + 0.24)], f"bill_{k}",
               mat=DECAL, out=(0, -1, 0))
    return m


def weigh_door():
    """The door of a public weigh house in a storehouse wall: blue-stone frame, double doors, the board over it,
    a hoist beam with a pulley above. On the wall (origin at its foot), front -Y."""
    m = Mesh()
    W, H = 2.4, 3.0
    m.box((0, -0.06, H / 2), (W, 0.02, H), "door_brown")
    for sx in (-1, 1):
        m.box((sx * (W / 2 + 0.12), -0.07, H / 2 + 0.1), (0.24, 0.14, H + 0.2), "bluestone")
    m.box((0, -0.08, H + 0.25), (W + 0.6, 0.16, 0.3), "bluestone")
    m.box((0, -0.075, H / 2), (0.04, 0.03, H), "iron")
    Wb, Hb = sign_board("weigh")
    m.box((0, -0.18, H + 0.72), (Wb, 0.04, Hb), "wood_dark", cells={"-y": "sign_weigh"})
    m.beam((0, 0, H + 1.6), (0, -0.9, H + 1.6), 0.14, 0.16, "oak")
    m.lathe([(0.1, -0.03), (0.12, 0.0), (0.1, 0.03)], 8, "iron", M=move(0, -0.8, H + 1.4) @ rot("Y", math.pi / 2))
    m.tube([(0, -0.8, H + 1.3), (0, -0.82, 1.9)], 0.015, 3, "rope")
    m.box((0, -0.82, 1.85), (0.06, 0.03, 0.12), "iron")
    return m


def lantern_post():
    """A lantern on an iron post, as at the heads of the quay steps: a fluted shaft, a ladder bar, a square lantern."""
    m = Mesh()
    m.lathe([(0.16, 0.0), (0.16, 0.25), (0.1, 0.35), (0.06, 0.45), (0.05, 2.3), (0.08, 2.36), (0.05, 2.42)], 6, "iron")
    m.beam((-0.25, 0, 2.05), (0.25, 0, 2.05), 0.04, 0.03, "iron")
    with m.at(move(0, 0, 2.42)):
        lo, hi = 0.1, 0.15
        for i in range(4):
            a0 = math.pi / 4 + i * math.pi / 2
            a1 = a0 + math.pi / 2
            p = [(lo * math.cos(a0) * 1.41, lo * math.sin(a0) * 1.41, 0.0), (lo * math.cos(a1) * 1.41, lo * math.sin(a1) * 1.41, 0.0),
                 (hi * math.cos(a1) * 1.41, hi * math.sin(a1) * 1.41, 0.34), (hi * math.cos(a0) * 1.41, hi * math.sin(a0) * 1.41, 0.34)]
            m.face(p, "glass", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=GLOW, out=(math.cos(a0 + math.pi / 4), math.sin(a0 + math.pi / 4), 0))
            m.beam(p[0], p[3], 0.018, 0.018, "iron")
        m.lathe([(0.1, -0.02), (0.1, 0.0), (0.0, 0.0)], 4, "iron", rot=math.pi / 4)
        m.lathe([(0.2, 0.34), (0.22, 0.37), (0.1, 0.48), (0.03, 0.52), (0.05, 0.56), (0.0, 0.6)], 4, "iron", rot=math.pi / 4)
    return m


# ------------------------------------------------------------------ models: work on the quays


def poles(m, xs, h):
    for x in xs:
        m.lathe([(0.05, 0.0), (0.045, h), (0.0, h + 0.03)], 4, "wood_grey", M=move(x, 0, 0))


def nets_drying():
    """Nets hung to dry over a line between three poles: sagging folds of tarred net, the floats on the line."""
    m = Mesh()
    xs = (-1.8, 0.0, 1.8)
    h = 2.3
    poles(m, xs, h)
    m.tube([(xs[0], 0, h - 0.1), (xs[1], 0, h - 0.18), (xs[2], 0, h - 0.1)], 0.012, 3, "rope")
    for b in range(2):
        x0, x1 = xs[b] + 0.08, xs[b + 1] - 0.08
        n = 4
        for side in (-1, 1):
            for i in range(n):
                t0, t1 = i / n, (i + 1) / n
                xa, xb = x0 + (x1 - x0) * t0, x0 + (x1 - x0) * t1
                ya = h - 0.12 - 0.08 * math.sin(math.pi * t0)
                yb = h - 0.12 - 0.08 * math.sin(math.pi * t1)
                la = 1.5 + 0.35 * math.sin(t0 * 7 + b * 2 + side)
                lb = 1.5 + 0.35 * math.sin(t1 * 7 + b * 2 + side)
                m.face([(xa, side * 0.03, ya), (xa, side * (0.12 + 0.12 * math.sin(t0 * 9)), ya - la), (xb, side * (0.12 + 0.12 * math.sin(t1 * 9)), yb - lb),
                        (xb, side * 0.03, yb)], "net", uvs=[(t0 * 2, 1), (t0 * 2, 0), (t1 * 2, 0), (t1 * 2, 1)], mat=DECAL)
        for i in range(4):
            t = (i + 0.5) / 4
            m.box((x0 + (x1 - x0) * t, 0, h - 0.14 - 0.08 * math.sin(math.pi * t)), (0.07, 0.07, 0.05), "wood")
    return m


def sail_drying():
    """A tan-bark sail hung to dry over a spar between two poles, one corner pegged down."""
    m = Mesh()
    xs = (-1.5, 1.5)
    h = 2.6
    poles(m, xs, h)
    m.beam((-1.6, 0, h - 0.05), (1.6, 0, h - 0.05), 0.07, 0.07, "wood")
    n = 5
    for side, drop in ((-1, 2.1), (1, 1.6)):
        for i in range(n):
            t0, t1 = i / n, (i + 1) / n
            xa, xb = -1.45 + 2.9 * t0, -1.45 + 2.9 * t1
            da = drop + 0.25 * math.sin(t0 * 5 + side)
            db = drop + 0.25 * math.sin(t1 * 5 + side)
            wa = side * (0.1 + 0.15 * math.sin(t0 * 7))
            wb = side * (0.1 + 0.15 * math.sin(t1 * 7))
            m.face([(xa, side * 0.04, h - 0.02), (xb, side * 0.04, h - 0.02), (xb, wb, h - db), (xa, wa, h - da)], "sail",
                   uvs=[(t0, 1), (t1, 1), (t1, 0), (t0, 0)], out=(0, side, 0))
    m.tube([(1.45, -0.2, h - 2.05), (1.9, -0.9, 0.05)], 0.01, 3, "rope")
    m.box((1.9, -0.9, 0.08), (0.05, 0.05, 0.16), "wood_dark")
    return m


def oars_rack():
    """Oars laid across a trestle, their blades one way, and two leaning against it."""
    m = Mesh()
    for sx in (-1, 1):
        x = sx * 0.9
        m.beam((x, -0.35, 0.0), (x, 0.0, 0.9), 0.06, 0.06, "wood_grey")
        m.beam((x, 0.35, 0.0), (x, 0.0, 0.9), 0.06, 0.06, "wood_grey")
    m.beam((-1.05, 0, 0.92), (1.05, 0, 0.92), 0.08, 0.08, "wood_grey")
    for i in range(5):
        y = -0.24 + i * 0.12
        a = (-1.9, y + 0.02 * i, 0.97 + 0.01 * (i % 2))
        b = (1.4, y, 0.97)
        m.beam(a, b, 0.045, 0.045, "wood")
        m.box((b[0] + 0.35, y, 0.97), (0.7, 0.13, 0.02), "wood")
        m.box((a[0] + 0.05, y + 0.02 * i, 0.97), (0.12, 0.05, 0.05), "wood_dark")
    for k, sy in enumerate((-0.45, 0.42)):
        m.beam((-0.4 + k * 0.6, sy * 2.2, 0.0), (-0.3 + k * 0.6, sy * 0.6, 0.95), 0.045, 0.045, "wood")
        m.box((-0.42 + k * 0.6, sy * 2.2 - (-0.15 if sy < 0 else 0.15) * 0, 0.3), (0.14, 0.02, 0.6), "wood")
    return m


def eel_pots():
    """Eel traps: long wicker funnels with hoops, three lying and two stood on end; two creels."""
    m = Mesh()
    prof = [(0.02, 0.0), (0.12, 0.08), (0.2, 0.3), (0.22, 0.6), (0.2, 0.85), (0.15, 0.95)]
    placements = [((-0.6, 0.0, 0.21), rot("Y", math.pi / 2) @ rot("Z", 0.3)), ((-0.55, 0.45, 0.21), rot("Y", -math.pi / 2)),
                  ((-0.6, 0.23, 0.6), rot("Y", math.pi / 2 + 0.1))]
    for (x, y, z), R in placements:
        m.lathe(prof, 7, "wicker_dark", M=move(x - 0.45, y, z) @ R, cap1=True)
        for zz in (0.3, 0.6):
            m.lathe([(0.225, zz), (0.23, zz + 0.03)], 7, "wood_dark", M=move(x - 0.45, y, z) @ R)
    for x, y in ((0.45, -0.2), (0.75, 0.2)):
        m.lathe(prof, 7, "wicker", M=move(x, y, 0.0) @ rot("X", 0.05), cap1=True, cap0=False)
    # creels: half-round wicker cages on a flat base
    for i, (x, y, a) in enumerate(((0.2, 0.75, 0.2), (0.7, 0.8, -0.3))):
        M = move(x, y, 0) @ rot("Z", a)
        with m.at(M):
            m.box((0, 0, 0.02), (0.55, 0.38, 0.04), "wood_dark")
            m.lathe([(0.19, -0.26), (0.19, 0.26)], 6, "wicker", M=move(0, 0, 0.04) @ rot("Y", math.pi / 2), arc=(0, math.pi))
    return m


def fish_baskets():
    """Flat fish baskets stacked, one full of herring; two fish boxes; an overturned basket."""
    m = Mesh()
    for k in range(4):
        m.lathe([(0.28, 0.0 + k * 0.19), (0.36, 0.18 + k * 0.19), (0.37, 0.19 + k * 0.19)], 8, "wicker", M=move(-0.5, 0, 0), cap0=(k == 0))
    m.lathe([(0.0, 0.76), (0.36, 0.74)], 8, "fish", M=move(-0.5, 0, 0))
    # a second basket full, on the ground
    m.lathe([(0.26, 0.0), (0.36, 0.2), (0.37, 0.22)], 8, "wicker", M=move(0.25, -0.35, 0), cap0=True)
    m.lathe([(0.0, 0.2), (0.36, 0.19)], 8, "fish", M=move(0.25, -0.35, 0))
    # fish boxes
    for i, (x, y, z, a) in enumerate(((0.35, 0.4, 0.0, 0.1), (0.38, 0.42, 0.28, -0.05))):
        with m.at(move(x, y, z) @ rot("Z", a)):
            m.box((0, 0, 0.13), (0.8, 0.48, 0.26), "wood_grey", cells={"+z": "fish"} if i == 1 else {"+z": "wood_dark"})
    # the overturned one
    m.lathe([(0.37, 0.0), (0.36, 0.02), (0.28, 0.2), (0.0, 0.21)], 8, "wicker_dark", M=move(-0.1, 0.8, 0) @ rot("X", 0.25))
    return m


def coal_heap():
    """A heap of coal dumped on the quay, a shovel stuck in it, a coal basket, soot on the stones."""
    m = Mesh()
    rng = np.random.default_rng(7)
    R, Hh = 1.2, 0.75
    rings = [(1.0, 0.0), (0.8, 0.28), (0.5, 0.55), (0.18, 0.72)]
    sides = 9
    pts = []
    for j, (fr, fz) in enumerate(rings):
        row = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            jit = 1 + (rng.random() - 0.5) * 0.25
            row.append(Vector((R * fr * math.cos(a) * jit * 1.25, R * fr * math.sin(a) * jit * 0.85, fz * Hh / 0.72 * (1 + (rng.random() - 0.5) * 0.15) if j else 0.0)))
        pts.append(row)
    for j in range(len(pts) - 1):
        for i in range(sides):
            i1 = (i + 1) % sides
            q = [pts[j][i], pts[j][i1], pts[j + 1][i1], pts[j + 1][i]]
            mid = sum(q, Vector()) / 4
            m.face(q, "coal", out=mid - Vector((0, 0, 0.3)))
    top = sum(pts[-1], Vector()) / sides
    for i in range(sides):
        a, b = pts[-1][i], pts[-1][(i + 1) % sides]
        m.face([a, b, top + Vector((0, 0, 0.05))], "coal", out=(0, 0, 1))
    # scattered lumps round the foot
    for k in range(7):
        a = rng.random() * 2 * math.pi
        r = R * 1.3 + rng.random() * 0.35
        m.box((r * math.cos(a) * 1.2, r * math.sin(a) * 0.85, 0.03), (0.08, 0.07, 0.06), "coal")
    # the shovel, stuck in at an angle
    m.beam((0.35, -0.2, 0.45), (0.75, -0.55, 1.35), 0.04, 0.04, "wood")
    m.beam((0.72, -0.52, 1.35), (0.8, -0.6, 1.4), 0.12, 0.03, "wood")
    m.face([(0.25, -0.05, 0.35), (0.42, -0.3, 0.35), (0.34, -0.18, 0.05)], "iron", out=(0.7, 0.7, 0))
    m.face([(0.25, -0.05, 0.35), (0.34, -0.18, 0.05), (0.42, -0.3, 0.35)], "iron", out=(-0.7, -0.7, 0))
    # a coal basket
    m.lathe([(0.2, 0.0), (0.27, 0.35), (0.28, 0.37)], 8, "wicker_dark", M=move(-1.55, -0.4, 0), cap0=True)
    m.lathe([(0.0, 0.3), (0.27, 0.33)], 8, "coal", M=move(-1.55, -0.4, 0))
    m.quad([(-1.9, -1.3, 0.004), (1.9, -1.3, 0.004), (1.9, 1.3, 0.004), (-1.9, 1.3, 0.004)], "soot", mat=DECAL, out=(0, 0, 1))
    return m


def sack(m, x, y, z, a, L=0.9, W=0.5, T=0.28, cell="jute"):
    """A filled sack lying flat: a pillow of 3 x 2 panels, tied ear at one end."""
    with m.at(move(x, y, z) @ rot("Z", a)):
        xs = (-L / 2, -L / 6, L / 6, L / 2)
        ys = (-W / 2, 0, W / 2)

        def zt(i, j):
            e = 1.0 if (0 < i < 3 and j == 1) else 0.6 if (0 < i < 3 or j == 1) else 0.25
            return T * e

        for i in range(3):
            for j in range(2):
                q = [(xs[i], ys[j], zt(i, j)), (xs[i + 1], ys[j], zt(i + 1, j)), (xs[i + 1], ys[j + 1], zt(i + 1, j + 1)), (xs[i], ys[j + 1], zt(i, j + 1))]
                m.face(q, cell, out=(0, 0, 1))
        for i in range(3):
            for yy, jj in ((ys[0], 0), (ys[2], 2)):
                q = [(xs[i], yy, 0.0), (xs[i + 1], yy, 0.0), (xs[i + 1], yy, zt(i + 1, jj)), (xs[i], yy, zt(i, jj))]
                m.face(q, cell, out=(0, yy, 0.2), shade=0.85)
        for xx, ii in ((xs[0], 0), (xs[3], 3)):
            q = [(xx, ys[0], 0.0), (xx, ys[2], 0.0), (xx, ys[2], zt(ii, 2)), (xx, ys[1], zt(ii, 1)), (xx, ys[0], zt(ii, 0))]
            m.face(q, cell, out=(xx, 0, 0.1), shade=0.8)
        m.beam((L / 2, 0, T * 0.25), (L / 2 + 0.1, 0, T * 0.3), 0.08, 0.06, cell)


def grain_pallet():
    """Grain sacks two layers deep on a timber skid pallet, a little spilt grain."""
    m = Mesh()
    L, W = 1.9, 1.3
    for y in (-0.5, 0.0, 0.5):
        m.beam((-L / 2, y, 0.05), (L / 2, y, 0.05), 0.1, 0.1, "oak")
    for i in range(7):
        x = -L / 2 + 0.12 + i * (L - 0.24) / 6
        m.box((x, 0, 0.12), (0.2, W, 0.04), "wood_grey")
    for k, (x, y, a) in enumerate(((-0.45, -0.3, 0.03), (0.45, -0.32, -0.04), (-0.47, 0.3, -0.02), (0.44, 0.31, 0.05))):
        sack(m, x, y, 0.14, a + math.pi / 2 * 0, L=0.88, W=0.56, T=0.27)
    for x, y, a in ((-0.2, 0.0, math.pi / 2 + 0.05), (0.45, 0.02, math.pi / 2 - 0.04)):
        sack(m, x, y, 0.36, a, L=0.9, W=0.56, T=0.27)
    m.lathe([(0.3, 0.0), (0.2, 0.03), (0.0, 0.05)], 6, "grain", M=move(1.2, -0.6, 0))
    return m


def timber_baulks():
    """Squared timber baulks, 4 m long, stacked two deep on bearers, the ends marked."""
    m = Mesh()
    L = 4.0
    for x in (-1.5, 0.0, 1.5):
        m.box((x, 0, 0.06), (0.18, 1.6, 0.12), "wood_grey")
    ys = (-0.54, -0.18, 0.18, 0.54)
    for i, y in enumerate(ys):
        m.box((0.05 * (i % 2), y, 0.12 + 0.16), (L, 0.32, 0.32), "oak", cells={"+x": "endgrain", "-x": "endgrain"})
    for i, y in enumerate((-0.36, 0.0, 0.36)):
        m.box((-0.1 + 0.08 * i, y, 0.44 + 0.16), (L - 0.3, 0.32, 0.32), "oak", cells={"+x": "endgrain", "-x": "endgrain"})
    return m


def tar_fire():
    """A tar barrel cut down for a brazier, holes punched in its side, standing on two bricks, the fire in it."""
    m = Mesh()
    for sx in (-1, 1):
        m.box((sx * 0.18, 0, 0.06), (0.12, 0.25, 0.12), "brick")
    with m.at(move(0, 0, 0.12)):
        m.lathe([(0.26, 0.0), (0.29, 0.25), (0.3, 0.45), (0.29, 0.62)], 8, "iron_rust", cap0=True, cap_cell="tar")
        m.lathe([(0.285, 0.62), (0.26, 0.6), (0.0, 0.5)], 8, "ash")
        for zz in (0.08, 0.5):
            m.lathe([(0.3, zz), (0.305, zz + 0.04)], 8, "iron")
        for i in range(8):
            a = 2 * math.pi * (i + 0.5) / 8
            c, s = math.cos(a), math.sin(a)
            for z in (0.2, 0.36):
                p = Vector((0.301 * c, 0.301 * s, z))
                t = Vector((-s, c, 0))
                m.face([p - t * 0.03 - Vector((0, 0, 0.03)), p + t * 0.03 - Vector((0, 0, 0.03)), p + t * 0.03 + Vector((0, 0, 0.03)),
                        p - t * 0.03 + Vector((0, 0, 0.03))], "fire", uvs=[(0, 0.3), (1, 0.3), (1, 0.6), (0, 0.6)], mat=FIRE, out=(c, s, 0))
        # the flames themselves are particles in the game (client/src/world/fire.ts), on the ash at 0.62
    m.quad([(-0.9, -0.9, 0.004), (0.9, -0.9, 0.004), (0.9, 0.9, 0.004), (-0.9, 0.9, 0.004)], "soot", mat=DECAL, out=(0, 0, 1))
    return m


def boat_hull(m, L, B, D):
    """An upturned rowing boat (keel up): stations along x, the gunwale on the trestles."""
    stations = 9
    half = 5
    secs = []
    for i in range(stations):
        t = i / (stations - 1)
        x = -L / 2 + L * t
        w = B / 2 * (math.sin(math.pi * t) ** 0.6)
        d = D * (0.55 + 0.45 * math.sin(math.pi * t) ** 0.4)
        sec = []
        for j in range(half):
            a = j / (half - 1) * math.pi / 2  # 0 at the gunwale, pi/2 at the keel
            sec.append((w * math.cos(a) ** 0.8, d * math.sin(a) ** 1.3))
        secs.append((x, sec))
    for i in range(stations - 1):
        (xa, sa), (xb, sb) = secs[i], secs[i + 1]
        for side in (-1, 1):
            for j in range(half - 1):
                q = [(xa, side * sa[j][0], sa[j][1]), (xb, side * sb[j][0], sb[j][1]), (xb, side * sb[j + 1][0], sb[j + 1][1]),
                     (xa, side * sa[j + 1][0], sa[j + 1][1])]
                cell = "hull_side" if j == 0 else "hull_bottom"
                m.face(q, cell, uvs=[(j / (half - 1), i / stations), (j / (half - 1), (i + 1) / stations), ((j + 1) / (half - 1), (i + 1) / stations),
                                     ((j + 1) / (half - 1), i / stations)], out=(0, side * 0.3, 1))
                m.face(q[::-1], "wood_dark", shade=0.5)
    # keel on top
    m.beam((-L / 2 - 0.05, 0, D + 0.03), (L / 2 + 0.05, 0, D + 0.03), 0.07, 0.08, "wood_dark")


def boat_trestles():
    """A ship's boat, 4.6 m, upturned on two trestles for tarring, a tar pot and brush under it."""
    m = Mesh()
    L, B, D = 4.6, 1.5, 0.62
    h = 0.75
    for x in (-1.2, 1.2):
        m.beam((x, -0.7, h), (x, 0.7, h), 0.1, 0.1, "wood_grey")
        for sy in (-1, 1):
            m.beam((x - 0.25, sy * 0.55, 0.0), (x, sy * 0.55, h), 0.06, 0.06, "wood_grey")
            m.beam((x + 0.25, sy * 0.55, 0.0), (x, sy * 0.55, h), 0.06, 0.06, "wood_grey")
    with m.at(move(0, 0, h + 0.05)):
        boat_hull(m, L, B, D)
    m.lathe([(0.14, 0.0), (0.15, 0.22), (0.0, 0.2)], 7, "iron", M=move(0.3, 0.25, 0), cap0=False)
    m.lathe([(0.15, 0.2), (0.0, 0.19)], 7, "tar", M=move(0.3, 0.25, 0))
    m.beam((0.3, 0.25, 0.15), (0.6, 0.45, 0.45), 0.03, 0.03, "wood")
    return m


# ------------------------------------------------------------------ the city: storehouse fronts


def store_fronts():
    """The storehouse walls (city_build.json houses with a store): [ax, az, bx, bz, ox, oz, h, kind] per wall,
    o the outward normal in the game frame (x, z)."""
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for h in data.get("houses", []):
        if not h.get("store"):
            continue
        fp = h["fp"]
        n = len(fp)
        area = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n)) / 2
        for i in range(n):
            ax, az = fp[i]
            bx, bz = fp[(i + 1) % n]
            L = math.hypot(bx - ax, bz - az)
            if L < 6:
                continue
            tx, tz = (bx - ax) / L, (bz - az) / L
            # outward normal: for a counter-clockwise ring (area > 0) it is (tz, -tx)
            ox, oz = (tz, -tx) if area > 0 else (-tz, tx)
            out.append([ax, az, bx, bz, round(ox, 3), round(oz, 3), h.get("h", 10), h["store"]])
    return out


# ------------------------------------------------------------------ build


def build_models():
    B = []
    B.append(("ring_wall", ring_wall()))
    B.append(("ring_top", ring_top()))
    B.append(("fender_rope", fender_rope()))
    B.append(("fender_timber", fender_timber()))
    wallnames = []
    for i, n in enumerate(WALL_NAMES):
        mesh, W = wall_decal(f"wallname_{i}", 0, -0.3, 0.05)
        B.append((f"wallname_{i}", mesh))
        wallnames.append({"name": n, "model": f"wallname_{i}", "len": round(W, 2)})
    for n in BERTHS:
        mesh, W = wall_decal(f"berth_{n}", 0, -0.35, 0.03)
        B.append((f"berth_{n}", mesh))
    wallnotices = []
    for k in WALL_NOTICES:
        mesh, W = wall_decal(k, 0, 0.0, 0.04)
        B.append((k, mesh))
        wallnotices.append({"model": k, "len": round(W, 2)})
    B.append(("drain", ground_decal("drain", 0.6, 0.4)))
    B.append(("worn", ground_decal("worn", 1.5, 0.7)))
    B.append(("bollard_cannon", bollard_cannon()))
    B.append(("bollard_mushroom", bollard_mushroom()))
    B.append(("bitt_double", bitt_double()))
    B.append(("post_timber", post_timber()))
    B.append(("capstan", capstan()))
    B.append(("line_out", mooring_line(0.0)))
    B.append(("line_along", mooring_line(1.6)))
    B.append(("chain_run", chain_run()))
    B.append(("hawser_flake", hawser_flake()))
    B.append(("hawser_coil", hawser_coil()))
    B.append(("anchor", anchor()))
    B.append(("cable_reel", cable_reel()))
    for key in SIGNS:
        if key in ("customs", "harbour", "toll", "notices", "weigh"):
            continue
        B.append((f"sign_{key}", post_sign(key)))
    B.append(("customs_booth", customs_booth()))
    B.append(("harbour_hut", harbour_hut()))
    B.append(("toll_shed", toll_shed()))
    B.append(("notice_board", notice_board()))
    B.append(("weigh_door", weigh_door()))
    B.append(("lantern_post", lantern_post()))
    B.append(("nets_drying", nets_drying()))
    B.append(("sail_drying", sail_drying()))
    B.append(("oars_rack", oars_rack()))
    B.append(("eel_pots", eel_pots()))
    B.append(("fish_baskets", fish_baskets()))
    B.append(("coal_heap", coal_heap()))
    B.append(("grain_pallet", grain_pallet()))
    B.append(("timber_baulks", timber_baulks()))
    B.append(("tar_fire", tar_fire()))
    B.append(("boat_trestles", boat_trestles()))
    meta = {
        "wallNames": wallnames,
        "wallNotices": wallnotices,
        "berths": BERTHS,
        "stores": store_fronts(),
        "solid": {"size": [SOLID_ATLAS.W, SOLID_ATLAS.H], "cells": SOLID_ATLAS.cells},
        "decal": {"size": [DECAL_ATLAS.W, DECAL_ATLAS.H], "cells": DECAL_ATLAS.cells},
    }
    return B, meta


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------ preview


def preview_materials():
    for mt in bpy.data.materials:
        if not mt.name.startswith("qf_"):
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
        if mt.name in ("qf_glow", "qf_fire"):
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 3.0
        try:
            mt.surface_render_method = "DITHERED"
        except AttributeError:
            pass


def preview(objs):
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
    # a quay: ground, a wall face down to the water at y = 0 (water toward -y)
    def slab(name, pts, col):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        for p in pts:
            bm.verts.new(p)
        bm.faces.new(bm.verts)
        bm.to_mesh(me)
        mt = bpy.data.materials.new(name + "_m")
        mt.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (*col, 1)
        me.materials.append(mt)
        ob = bpy.data.objects.new(name, me)
        sc.collection.objects.link(ob)

    slab("ground", [(-40, 0, 0), (40, 0, 0), (40, 40, 0), (-40, 40, 0)], (0.12, 0.12, 0.11))
    slab("wall", [(-40, 0, -3), (40, 0, -3), (40, 0, 0), (-40, 0, 0)], (0.22, 0.22, 0.2))
    slab("water", [(-40, -30, -2.8), (40, -30, -2.8), (40, 0, -2.8), (-40, 0, -2.8)], (0.05, 0.08, 0.08))
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    wall = [n for n in objs if n.startswith(("ring_wall", "fender_", "wallname_", "berth_1", "berth_2", "berth_12"))]
    edge = ["ring_top", "bollard_cannon", "bollard_mushroom", "bitt_double", "post_timber", "capstan", "lantern_post", "drain", "worn"]
    row1 = ["chain_run", "hawser_flake", "hawser_coil", "anchor", "cable_reel", "coal_heap", "grain_pallet", "tar_fire", "fish_baskets", "eel_pots"]
    row2 = ["customs_booth", "harbour_hut", "toll_shed", "notice_board", "sign_name_werf", "sign_nosmoke", "sign_nomoor"]
    row3 = ["nets_drying", "sail_drying", "oars_rack", "timber_baulks", "boat_trestles", "weigh_door", "wn_nosmoke"]
    shown = set()

    def lay(names, y, gap=0.4):
        x = 0.0
        placed = []
        for n in names:
            o = objs[n]
            o.location = (0, 0, 0)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            o.location = (x - lo, y, 0)
            placed.append(o)
            x += hi - lo + gap
            shown.add(n)
        for o in placed:
            o.location.x -= x / 2

    lay(wall, 0.0, 0.6)
    lay(edge, 0.6, 0.8)
    lay(row1, 4.0)
    lay(row2, 9.0, 0.8)
    lay(row3, 14.0, 0.8)
    for n, o in objs.items():
        o.hide_render = n not in shown
    bpy.context.view_layer.update()

    def aim(loc, target, lens):
        cam.location = Vector(loc)
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = lens

    def render(path, res):
        sc.render.resolution_x, sc.render.resolution_y = res
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        bpy.ops.render.render(write_still=True)
        print(f"[build_quayfurniture] preview -> {path}")

    aim((0, -14, 9), (0, 7, 0.5), 18)
    render(os.path.join(SHOTS, "quayfurniture_preview.png"), (1920, 1080))
    aim((0, -8, -1.2), (0, 0, -1.2), 24)
    render(os.path.join(SHOTS, "quayfurniture_wall.png"), (1600, 700))
    aim((-8, 1.5, 2.5), (0, 9, 1.0), 20)
    render(os.path.join(SHOTS, "quayfurniture_close.png"), (1600, 900))


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
    node = bpy.data.objects.new("quayfurniture_meta", None)
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
        print(f"[build_quayfurniture] {n:24s} {c:5d} tris")
    print(f"[build_quayfurniture] atlases: solid {SOLID_ATLAS.W}x{SOLID_ATLAS.H}, decal {DECAL_ATLAS.W}x{DECAL_ATLAS.H}")
    print(f"[build_quayfurniture] {len(meta['stores'])} storehouse walls from the city")
    print(f"[build_quayfurniture] {len(objs)} models, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview_materials()
        preview(objs)


if __name__ == "__main__":
    main()
