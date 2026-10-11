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
             bitt_double), oak mooring posts (post_timber), capstans; the eye of a ship's
             mooring line over each kind (line_eye_c, _m, _b, _p: the game draws the line on
             from meta.lineEyes, client/src/world/shipLines.ts)
  wall       oak rubbing fenders down the working quays' wall faces (fender_timber)
  work spots a gangplank laid by, the tally clerk's desk and stool, a weighbridge plate and
             its weigh house, a two-man hand barrow (client/src/world/workspots.ts)
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
All textures are painted by the functions below, for smooth (linear, mipmapped) filtering:
the edge's iron, stone, oak and rope at 128-512 px a cell (D4, 2026-10-11), the rest scaled
up from their older paintings; the letters come from the 5x7 pixel font of
build_streetlife.py (our own), scaled up crisp. Round things (bollards, rings, ropes) are
smooth-shaded turned shapes and tubes (Mesh.rev, Mesh.rope). Our own work: no downloaded models,
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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lantern_kit  # noqa: E402  (the town's lamps and lanterns, one design)

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


def peel(img, seed, wood=(0.30, 0.28, 0.24), amt=0.35):
    """Paint peeling off in flakes to the grey wood, soot and damp streaked down it (pass 3, Steve
    2026-09-26: "misty, darker, grimy")."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    out = img.copy()
    n = vnoise(rng, w, h, 6, 6) * 0.6 + vnoise(rng, w, h, 18, 18) * 0.4
    bare = n > 1 - amt
    out[bare, :3] = np.array(wood) * (0.8 + 0.4 * rng.random((bare.sum(), 1)))
    edge = (n > 1 - amt - 0.05) & ~bare
    out[edge, :3] *= 1.15
    return grime_qf(out, seed + 1)


def grime_qf(img, seed, dark=0.78, wet=0.45):
    """Darker, dirt and damp from the foot up, streaks down from the top."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    out = img.copy()
    out[..., :3] *= dark
    k = max(2, h // 4)
    t = np.linspace(0, 1, k)[:, None, None]
    out[h - k:, :, :3] = out[h - k:, :, :3] * (1 - wet * t) + np.array((0.05, 0.06, 0.04)) * wet * t
    for _ in range(max(1, w // 6)):
        c = int(rng.integers(0, w))
        L = int(rng.integers(h // 4, h))
        out[:L, c, :3] *= 0.7
    return out


def paint_rust_stain(seed):
    """Rust bled into the stone round an iron foot: a brown blotch, strongest at the middle."""
    w = h = 32
    rng = np.random.default_rng(seed)
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.28, 0.13, 0.06)
    a = alpha_blob(rng, w, h, soft=0.6)
    img[..., 3] = np.clip(a * 0.7 * (0.7 + 0.5 * rng.random((h, w))), 0, 0.7)
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


# ------------------------------------------------------------------ high detail painters (D4, 2026-10-11)
# The edge's iron, rope and timber at 128 to 512 px a cell (about 2 to 5 mm a pixel on the things they cover), painted
# smooth for linear filtering: no single-pixel speckle, every pattern several pixels wide.


def up(img, k, nearest=False):
    """An older small cell scaled up k times: bilinear for the painted noise, nearest (and a soft edge) for lettering."""
    if k == 1:
        return img
    if nearest:
        big = np.repeat(np.repeat(img, k, axis=0), k, axis=1)
        # a pixel's blur so the letters' steps read as brush edges, not blocks
        pad = np.pad(big, ((1, 1), (1, 1), (0, 0)), mode="edge")
        return (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:] + 4 * big) / 8
    h, w = img.shape[:2]
    ys = (np.arange(h * k) + 0.5) / k - 0.5
    xs = (np.arange(w * k) + 0.5) / k - 0.5
    y0 = np.clip(np.floor(ys).astype(int), 0, h - 1)
    x0 = np.clip(np.floor(xs).astype(int), 0, w - 1)
    y1 = np.clip(y0 + 1, 0, h - 1)
    x1 = np.clip(x0 + 1, 0, w - 1)
    fy = np.clip(ys - np.floor(ys), 0, 1)[:, None, None]
    fx = np.clip(xs - np.floor(xs), 0, 1)[None, :, None]
    a = img[y0][:, x0]
    b = img[y0][:, x1]
    c = img[y1][:, x0]
    d = img[y1][:, x1]
    out = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy
    # a fine grain over the smooth upscale, so it does not read as a blur up close
    rng = np.random.default_rng(h * 131 + w)
    out[..., :3] *= (0.94 + 0.12 * vnoise(rng, w * k, h * k, w * k // 4, h * k // 4))[..., None]
    return out


def fbm(rng, w, h, base=4, octaves=5, gain=0.55):
    """Tileable fractal noise in 0..1."""
    out = np.zeros((h, w))
    amp, tot, c = 1.0, 0.0, base
    for _ in range(octaves):
        out += amp * vnoise(rng, w, h, min(c, w), min(c, h))
        tot += amp
        amp *= gain
        c *= 2
    return out / tot


def cast_iron(seed, s, paint, rust=(0.24, 0.12, 0.055), amt=0.32, wet=0.0):
    """Cast iron in old paint: a sandy cast skin, the paint worn through to rust where hands and ropes go,
    rust runs down from the top, damp darker at the foot (v down the cell: row 0 is the top)."""
    rng = np.random.default_rng(seed)
    n = fbm(rng, s, s, 4, 6)
    sand = vnoise(rng, s, s, s // 3, s // 3)
    img = np.ones((s, s, 4))
    img[..., :3] = np.array(paint) * (0.72 + 0.5 * n + 0.12 * (sand - 0.5))[..., None]
    r = fbm(rng, s, s, 6, 5)
    m = np.clip((r - (1 - amt)) / 0.08, 0, 1)
    rc = np.array(rust) * (0.65 + 0.6 * fbm(rng, s, s, 16, 3))[..., None]
    img[..., :3] = img[..., :3] * (1 - m[..., None]) + rc * m[..., None]
    # rust runs: soft streaks a few pixels wide, fading down
    yy, xx = np.mgrid[0:s, 0:s]
    for _ in range(s // 24):
        c = rng.random() * s
        wd = 1.5 + rng.random() * 3
        L = s * (0.3 + 0.7 * rng.random())
        k = np.exp(-((xx - c) / wd) ** 2) * np.clip(1 - yy / L, 0, 1) * 0.5
        img[..., :3] = img[..., :3] * (1 - k[..., None]) + np.array(rust) * 0.9 * k[..., None]
    if wet:
        t = np.clip((yy / s - 0.6) / 0.4, 0, 1) * wet
        img[..., :3] *= (1 - 0.45 * t)[..., None]
    return img


def oak_hi(seed, w, h, rgb, grey=0.0, dirt=0.3):
    """Weathered oak, the grain along u: long fibres, a few checks (cracks) and knots, grey where the sun bleached it."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    warp = vnoise(rng, w, h, 3, 6) * 6
    rings = np.sin((yy + warp * 3) * (2 * math.pi / 7.0)) * 0.5 + 0.5
    fib = vnoise(rng, w, h, max(2, w // 64), h // 2)
    tone = 0.7 + 0.22 * rings + 0.22 * fib + 0.15 * (fbm(rng, w, h, 3, 4) - 0.5)
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * tone[..., None]
    if grey:
        g = np.array((0.42, 0.40, 0.37))
        k = grey * (0.6 + 0.4 * fbm(rng, w, h, 4, 3))
        img[..., :3] = img[..., :3] * (1 - k[..., None]) + g * tone[..., None] * k[..., None]
    for _ in range(max(1, h // 40)):
        r0 = rng.random() * h
        x0, L = rng.random() * w, w * (0.15 + 0.5 * rng.random())
        k = np.exp(-((yy - r0) / 0.9) ** 2) * ((xx > x0) & (xx < x0 + L))
        img[..., :3] *= (1 - 0.55 * k)[..., None]
    for _ in range(max(1, (w * h) // 60000)):
        cx, cy = rng.random() * w, rng.random() * h
        d = np.hypot((xx - cx) / 5, (yy - cy) / 3)
        img[..., :3] *= (1 - 0.45 * np.exp(-d * d))[..., None]
    img[..., :3] *= (1 - dirt * 0.5 * fbm(rng, w, h, 5, 3))[..., None]
    return img


def rope_hi(seed, w, h, rgb, tar=0.0, strands=3, twist=1):
    """Laid rope, u round it and v along it: `strands` strands twisting along v (one turn of each strand repeats
    exactly over the cell, so a tube's segments join), the yarns' fine lay inside each, fuzz, tar."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = xx / w
    v = yy / h
    ph = (u * strands + v * strands * twist) % 1.0
    strand = np.sin(ph * math.pi) ** 0.6
    yarn = 0.5 + 0.5 * np.sin((u * strands * 6 - v * strands * 10) * 2 * math.pi)
    tone = 0.45 + 0.5 * strand + 0.1 * yarn
    img = np.ones((h, w, 4))
    img[..., :3] = np.array(rgb) * tone[..., None]
    img[..., :3] *= (0.88 + 0.24 * vnoise(rng, w, h, w // 8, h // 8))[..., None]
    if tar:
        img[..., :3] *= (1 - tar * (0.7 + 0.3 * vnoise(rng, w, h, 4, 4)))[..., None]
    return img


def stone_hi(seed, s, rgb):
    """Bluestone (Belgian petit granit): blue-grey with pale fossil flecks, tooled."""
    rng = np.random.default_rng(seed)
    n = fbm(rng, s, s, 4, 6)
    img = np.ones((s, s, 4))
    img[..., :3] = np.array(rgb) * (0.78 + 0.4 * n)[..., None]
    fl = vnoise(rng, s, s, s // 6, s // 6) > 0.82
    img[fl, :3] = img[fl, :3] * 0.6 + np.array((0.55, 0.56, 0.56)) * 0.4
    yy, xx = np.mgrid[0:s, 0:s]
    img[..., :3] *= (0.95 + 0.05 * np.sin((xx + yy) * 0.9))[..., None]
    return img


def fender_oak(seed, w, h):
    """A rubbing fender's oak, the whole height of the wall (v down: row 0 at the top): worn pale and grey up where
    the hulls rub, then the tide's band, green slime, black weed and barnacles at the foot."""
    img = oak_hi(seed, h, w, (0.40, 0.31, 0.21), grey=0.55, dirt=0.4)
    img = np.ascontiguousarray(np.transpose(img, (1, 0, 2)))  # grain down the post
    rng = np.random.default_rng(seed + 1)
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    t = yy / h  # 0 top .. 1 foot (the fender runs 0.3 m to 5.0 m down)
    wet = np.clip((t - 0.12) / 0.1, 0, 1)
    img[..., :3] *= (1 - 0.45 * wet)[..., None]
    slime = np.clip((t - 0.45) / 0.15, 0, 1) * (0.6 + 0.4 * vnoise(rng, w, h, 3, 24))
    img[..., :3] = img[..., :3] * (1 - slime[..., None]) + np.array((0.10, 0.13, 0.07)) * slime[..., None]
    weed = np.clip((t - 0.78) / 0.1, 0, 1) * (vnoise(rng, w, h, 6, 40) > 0.45)
    img[weed > 0, :3] = img[weed > 0, :3] * 0.4 + np.array((0.04, 0.05, 0.03)) * 0.6
    bar = (vnoise(rng, w, h, w // 3, h // 3) > 0.8) & (t > 0.7)
    img[bar, :3] = np.array((0.48, 0.47, 0.42)) * (0.8 + 0.3 * rng.random((bar.sum(), 1)))
    # rope wear: pale scuffs across the post in the band the hulls ride in
    for _ in range(12):
        y0 = h * (0.08 + 0.4 * rng.random())
        k = np.exp(-((yy - y0) / (2 + 3 * rng.random())) ** 2) * 0.25
        img[..., :3] = img[..., :3] * (1 - k[..., None]) + np.array((0.55, 0.50, 0.42)) * k[..., None]
    return img


def checker_plate(seed, s):
    """A weighbridge's cast plate: raised diamonds on black iron, worn bright on their tops, rust in the grooves."""
    img = cast_iron(seed, s, (0.09, 0.09, 0.09), amt=0.15)
    yy, xx = np.mgrid[0:s, 0:s].astype(float)
    p = 16.0
    a = ((xx + yy) % p) / p
    b = ((xx - yy) % p) / p
    d1 = np.abs(a - 0.5) < 0.12
    d2 = np.abs(b - 0.5) < 0.12
    lug = (d1 & (((xx // p) + (yy // p)) % 2 == 0)) | (d2 & (((xx // p) + (yy // p)) % 2 == 1))
    img[lug, :3] = img[lug, :3] * 0.6 + np.array((0.30, 0.30, 0.29)) * 0.4
    return img


def paper_ledger(seed, w, h):
    """An open ledger: two pages, ruled, columns of figures in ink."""
    rng = np.random.default_rng(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = np.array((0.80, 0.76, 0.64)) * (0.92 + 0.1 * vnoise(rng, w, h, 4, 4))[..., None]
    for y in range(8, h - 4, 6):
        img[y, 4:w - 4, :3] *= 0.82
    for x in (w // 2 - 1, w // 2):
        img[:, x, :3] *= 0.55
    for y in range(9, h - 6, 6):
        for page in (0, 1):
            x0 = 6 + page * (w // 2)
            n = int(rng.integers(3, 9))
            for k in range(n):
                xx = x0 + k * 3 + (8 if k > 3 else 0)
                if xx < w - 3 and rng.random() < 0.85:
                    img[y - 3:y - 1, xx:xx + 2, :3] = (0.10, 0.09, 0.12)
    img[:, :2, :3] = img[:, -2:, :3] = (0.24, 0.12, 0.08)
    return img


# ------------------------------------------------------------------ the atlases


class Atlas:
    """Shelf-packed atlas; cells are (x, y, w, h) in pixels from the top left.

    (2026-10-11, D4: smooth filtering with mipmaps, docs/05-art-direction.md) every cell has a gutter of GUTTER
    pixels round it that repeats its edge, so a far mip level does not bleed the next cell's colour into it."""

    GUTTER = 8

    def __init__(self, width):
        self.W = width
        self.items = []
        self.cells = {}

    def add(self, name, arr):
        self.items.append((name, arr))

    def pack(self):
        G = self.GUTTER
        order = sorted(self.items, key=lambda it: (-it[1].shape[0], -it[1].shape[1]))
        x = y = shelf = 0
        placed = []
        for name, a in order:
            h, w = a.shape[:2]
            if x + w + 2 * G > self.W:
                x, y, shelf = 0, y + shelf, 0
            placed.append((name, a, x + G, y + G))
            self.cells[name] = (x + G, y + G, w, h)
            x += w + 2 * G
            shelf = max(shelf, h + 2 * G)
        H = 1
        while H < y + shelf:
            H *= 2
        self.H = H
        img = np.zeros((H, self.W, 4))
        for name, a, x0, y0 in placed:
            h, w = a.shape[:2]
            img[y0 - G:y0 + h + G, x0 - G:x0 + w + G] = np.pad(a, ((G, G), (G, G), (0, 0)), mode="edge")
        self.img = img
        return self

    def uv(self, name, u, v):
        x, y, w, h = self.cells[name]
        U = (x + 0.5 + min(max(u, 0.0), 1.0) * (w - 1)) / self.W
        row = y + 0.5 + (1 - min(max(v, 0.0), 1.0)) * (h - 1)
        return (U, 1 - row / self.H)


SOLID_ATLAS = Atlas(2048)
DECAL_ATLAS = Atlas(1024)
# the old paintings (and every sign and letter) are scaled up this many times; their models keep their old sizes
TEXT_K = 4

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
    # pass 3: the iron is rusty and dark, the paint peels (Steve 2026-09-26: "rust, soot, dirt")
    # D4 (2026-10-11): high detail. The edge's iron, stone, oak and rope painted afresh at 128-512 px a cell; the
    # rest (huts, nets, coal, signs) scaled up K times from their old paintings, the lettering kept crisp.
    K = TEXT_K
    PAINTED = ("paint_green", "paint_red", "paint_white")
    for i, (name, (rgb, amt)) in enumerate(PLAIN.items()):
        size = 32 if name in ("bluestone", "whitestone", "zinc", "slate", "canvas", "sail") else 16
        if name == "iron":
            SOLID_ATLAS.add(name, cast_iron(100 + i, 256, (0.075, 0.075, 0.08), rust=(0.20, 0.10, 0.05), amt=0.3))
        elif name == "iron_light":
            SOLID_ATLAS.add(name, cast_iron(100 + i, 128, (0.16, 0.15, 0.14), rust=(0.22, 0.12, 0.06), amt=0.3))
        elif name == "bluestone":
            SOLID_ATLAS.add(name, stone_hi(100 + i, 256, rgb))
        elif name == "whitestone":
            SOLID_ATLAS.add(name, stone_hi(100 + i, 128, rgb))
        elif name in PAINTED:
            SOLID_ATLAS.add(name, up(peel(flat(100 + i, 32, 32, rgb, amt), 700 + i), K))
        else:
            SOLID_ATLAS.add(name, up(flat(100 + i, size, size, rgb, amt), K))
    SOLID_ATLAS.add("iron_rust", cast_iron(150, 256, (0.07, 0.065, 0.06), rust=(0.22, 0.11, 0.05), amt=0.55))
    SOLID_ATLAS.add("iron_green", cast_iron(151, 256, (0.07, 0.12, 0.09), rust=(0.21, 0.11, 0.055), amt=0.33, wet=0.6))
    SOLID_ATLAS.add("iron_black", cast_iron(152, 256, (0.05, 0.05, 0.055), rust=(0.20, 0.10, 0.05), amt=0.22, wet=0.7))
    SOLID_ATLAS.add("wood", oak_hi(160, 256, 128, (0.34, 0.28, 0.20), grey=0.2))
    SOLID_ATLAS.add("wood_dark", oak_hi(161, 256, 128, (0.18, 0.14, 0.10)))
    SOLID_ATLAS.add("wood_grey", oak_hi(162, 256, 128, (0.38, 0.35, 0.31), grey=0.6))
    SOLID_ATLAS.add("oak", oak_hi(163, 256, 128, (0.27, 0.21, 0.15), grey=0.15))
    SOLID_ATLAS.add("plank", oak_hi(165, 512, 64, (0.36, 0.30, 0.22), grey=0.35, dirt=0.5))
    SOLID_ATLAS.add("desk", oak_hi(166, 256, 128, (0.22, 0.13, 0.08), dirt=0.2))
    SOLID_ATLAS.add("endgrain", up(flat(164, 16, 16, (0.46, 0.36, 0.24), 0.3), 8))
    SOLID_ATLAS.add("rope", rope_hi(170, 128, 128, (0.56, 0.47, 0.33)))
    SOLID_ATLAS.add("hawser", rope_hi(171, 128, 128, (0.36, 0.29, 0.20), tar=0.3))
    SOLID_ATLAS.add("fender_oak", fender_oak(172, 96, 1024))
    SOLID_ATLAS.add("checker", checker_plate(173, 256))
    SOLID_ATLAS.add("ledger", paper_ledger(174, 128, 96))
    SOLID_ATLAS.add("wicker", up(wicker(180, 32, 32, (0.55, 0.44, 0.26)), K))
    SOLID_ATLAS.add("wicker_dark", up(wicker(181, 32, 32, (0.36, 0.28, 0.17)), K))
    SOLID_ATLAS.add("jute", up(weave(190, 32, 32, (0.56, 0.47, 0.32)), K))
    SOLID_ATLAS.add("coal", up(coal_tex(200, 32, 32), K))
    SOLID_ATLAS.add("hull_bottom", up(planks(210, 32, 64, (0.24, 0.18, 0.12), 8, tar_lo=0.0), K))
    SOLID_ATLAS.add("hull_side", up(planks(211, 32, 32, (0.30, 0.24, 0.16), 5, band=(0.0, 0.2, (0.14, 0.26, 0.20))), K))
    SOLID_ATLAS.add("shed_planks", up(peel(planks(212, 32, 64, (0.16, 0.24, 0.18), 1), 764), K))
    SOLID_ATLAS.add("hut_planks", up(peel(planks(213, 32, 64, (0.30, 0.28, 0.24), 1), 765, wood=(0.26, 0.24, 0.21), amt=0.25), K))
    SOLID_ATLAS.add("brick", up(brick(220, 32, 32), K))
    SOLID_ATLAS.add("window", up(grime_qf(window_tex(230, 16, 16), 768, dark=0.7), K, nearest=True))
    SOLID_ATLAS.add("door_green", up(peel(door_tex(231, 16, 32, (0.14, 0.22, 0.16)), 766), K))
    SOLID_ATLAS.add("door_brown", up(peel(door_tex(232, 32, 32, (0.28, 0.18, 0.10)), 767), K))
    SOLID_ATLAS.add("fish", up(fish_tex(240, 32, 32), K))
    # (2026-10-11) the lanterns' panes: the burner and its flame painted on (lantern_kit.py paint_pane), 32 x 64 (the atlas counts rows from the top)
    SOLID_ATLAS.add("glass", up(np.concatenate([lantern_kit.paint_pane(64, kind="gas", seed=9, w=32)[::-1], np.ones((64, 32, 1))], axis=2), 2))
    SOLID_ATLAS.add("fire", up(fire_tex(8, 16), K))
    for i, (key, (lines, bg, fg)) in enumerate(SIGNS.items()):
        SOLID_ATLAS.add(f"sign_{key}", up(paint_board(lines, 300 + i, bg, fg, border=tuple(np.array(fg) * 0.8)), K, nearest=True))
    for i, n in enumerate(WALL_NAMES):
        DECAL_ATLAS.add(f"wallname_{i}", up(paint_wall_letters(n, 400 + i), K, nearest=True))
    for n in BERTHS:
        DECAL_ATLAS.add(f"berth_{n}", up(paint_berth(n, 450 + n), K, nearest=True))
    for i, (k, lines) in enumerate(WALL_NOTICES.items()):
        DECAL_ATLAS.add(k, up(paint_wall_notice(lines, 480 + i), K, nearest=True))
    DECAL_ATLAS.add("rust_run", up(paint_rust_run(500), K))
    DECAL_ATLAS.add("rust_stain", up(paint_rust_stain(505), K))
    DECAL_ATLAS.add("drain", up(paint_drain(501), K, nearest=True))
    DECAL_ATLAS.add("worn", up(paint_worn(502), K))
    DECAL_ATLAS.add("soot", up(paint_soot(503), K))
    DECAL_ATLAS.add("net", up(paint_net(504), K, nearest=True))
    for i, k in enumerate(("rules", "tides", "notice")):
        DECAL_ATLAS.add(f"bill_{k}", up(paint_bill(k, 510 + i), K, nearest=True))
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
        t.interpolation = "Linear"
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

    # --- D4 (2026-10-11): smooth shapes. Faces share their vertices and are shaded smooth, so a turned bollard or a
    # rope reads round, not as facets; a profile that turns sharply (a flange's edge) starts a new ring there.

    def _vert(self, p):
        return self.bm.verts.new(self.xf @ Vector(p))

    def _quad_smooth(self, vs, uvs, cell, mat=SOLID, shade=1.0, pts=None):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.smooth = True
        f.material_index = mat
        atlas = DECAL_ATLAS if mat == DECAL else SOLID_ATLAS
        for loop, (u, v), v3 in zip(f.loops, uvs, vs):
            loop[self.uv].uv = atlas.uv(cell, u, v)
            s = shade
            if self.ao > 0:
                s *= 0.55 + 0.45 * min(1.0, max(0.0, v3.co.z / self.ao))
            loop[self.col] = (s, s, s, 1.0)
        return f

    def rev(self, prof, sides, cell, rot=0.0, cap0=False, cap1=False, shade=1.0, cells=None, M=None, cap_cell=None, sharp=40.0, vrep=None):
        """A smooth turned shape about +Z, the profile (r, z) bottom to top. `cells`: one cell per profile span.
        `vrep`: metres of profile a cell covers (v keeps on counting, each span maps its own share) or None (whole)."""
        if M is not None:
            with self.at(M):
                return self.rev(prof, sides, cell, rot=rot, cap0=cap0, cap1=cap1, shade=shade, cells=cells, cap_cell=cap_cell, sharp=sharp, vrep=vrep)
        L = [0.0]
        for j in range(1, len(prof)):
            L.append(L[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
        tot = L[-1] or 1
        ang = [(rot + 2 * math.pi * i / sides) for i in range(sides)]
        ring_of = lambda r, z: [self._vert((r * math.cos(a), r * math.sin(a), z)) for a in ang]
        # a fresh ring of vertices where the profile bends sharply
        def bend(j):
            if j <= 0 or j >= len(prof) - 1:
                return False
            a = Vector((prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
            b = Vector((prof[j + 1][0] - prof[j][0], prof[j + 1][1] - prof[j][1]))
            if a.length < 1e-6 or b.length < 1e-6:
                return True
            return math.degrees(a.angle(b)) > sharp
        rings_lo = [None] * len(prof)
        rings_hi = [None] * len(prof)
        for j, (r, z) in enumerate(prof):
            rings_hi[j] = ring_of(r, z)
            rings_lo[j] = ring_of(r, z) if bend(j) else rings_hi[j]
        for j in range(len(prof) - 1):
            ce = cells[j] if cells else cell
            v0, v1 = (L[j] / tot, L[j + 1] / tot) if vrep is None else ((L[j] / vrep) % 1.0, (L[j] / vrep) % 1.0 + (L[j + 1] - L[j]) / vrep)
            if vrep is not None and v1 > 1.0:
                v0, v1 = 0.0, min(1.0, (L[j + 1] - L[j]) / vrep)
            A = rings_hi[j]
            B = rings_lo[j + 1]
            for i in range(sides):
                i1 = (i + 1) % sides
                self._quad_smooth([A[i], A[i1], B[i1], B[i]], [(i / sides, v0), ((i + 1) / sides, v0), ((i + 1) / sides, v1), (i / sides, v1)], ce, shade=shade)
        if cap0 and prof[0][0] > 1e-4:
            self.face([(prof[0][0] * math.cos(a), prof[0][0] * math.sin(a), prof[0][1]) for a in ang], cap_cell or (cells[0] if cells else cell), shade=shade * 0.8, out=(0, 0, -1))
        if cap1 and prof[-1][0] > 1e-4:
            self.face([(prof[-1][0] * math.cos(a), prof[-1][0] * math.sin(a), prof[-1][1]) for a in ang], cap_cell or (cells[-1] if cells else cell), shade=shade, out=(0, 0, 1))

    def rope(self, path, r, sides, cell, closed=False, shade=1.0, up=None, seg_len=None):
        """A smooth tube along a path (a rope, a hawser, a ring). Its cell repeats every `seg_len` metres along it
        (the rope cells repeat exactly in v), else once a segment."""
        path = [Vector(p) for p in path]
        N = len(path)
        if N < 2:
            return
        frames = []
        prev_s = None
        for k, p in enumerate(path):
            if closed:
                t = path[(k + 1) % N] - path[(k - 1) % N]
            else:
                t = path[min(k + 1, N - 1)] - path[max(k - 1, 0)]
            t.normalize()
            if prev_s is None:
                s = Vector(up) if up else Vector((0, 0, 1))
                if abs(s.dot(t)) > 0.9:
                    s = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            else:
                s = prev_s  # parallel transport: no twist from frame to frame
            s = (s - t * s.dot(t)).normalized()
            prev_s = s
            b = t.cross(s)
            frames.append((p, s, b))
        rings = [[self._vert(p + s * r * math.cos(2 * math.pi * i / sides) + b * r * math.sin(2 * math.pi * i / sides)) for i in range(sides)] for p, s, b in frames]
        dist = [0.0]
        for k in range(1, N):
            dist.append(dist[-1] + (path[k] - path[k - 1]).length)
        seg = range(N) if closed else range(N - 1)
        for j in seg:
            j1 = (j + 1) % N
            if seg_len:
                v0 = (dist[j] / seg_len) % 1.0
                v1 = v0 + ((path[j1] - path[j]).length / seg_len)
                if v1 > 1.0 + 1e-6:
                    # this span crosses the cell's end: start it at 0 (a seam no wider than one span's share)
                    v1 = v1 - v0
                    v0 = 0.0
                    v1 = min(v1, 1.0)
            else:
                v0, v1 = 0.0, 1.0
            for i in range(sides):
                i1 = (i + 1) % sides
                self._quad_smooth([rings[j][i], rings[j][i1], rings[j1][i1], rings[j1][i]], [(i / sides, v0), ((i + 1) / sides, v0), ((i + 1) / sides, v1), (i / sides, v1)], cell, shade=shade)

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
    """An iron mooring ring on a staple let into the quay wall under the coping (its foot at -0.28), a rust run below."""
    m = Mesh()
    z0 = -0.55
    # the staple's plate, leaded into a joint, two bolt heads
    m.box((0, -0.012, z0), (0.16, 0.024, 0.13), "iron_rust")
    for sx in (-1, 1):
        m.rev([(0.022, 0.0), (0.022, 0.012), (0.012, 0.02), (0.0, 0.022)], 8, "iron_black", M=move(sx * 0.055, -0.024, z0) @ rot("X", math.pi / 2))
    # the eye standing out of the plate, the ring through it, hanging a little off the wall
    m.rope([(-0.035, -0.024, z0 - 0.01), (-0.03, -0.07, z0 - 0.02), (0.0, -0.085, z0 - 0.025), (0.03, -0.07, z0 - 0.02), (0.035, -0.024, z0 - 0.01)], 0.014, 8, "iron_rust")
    R = 0.13
    pts = [(R * math.sin(a), -0.085 - 0.015 * (1 - math.cos(a)), z0 - 0.04 - R + R * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
    m.rope(pts, 0.021, 6, "iron_rust", closed=True)
    m.quad([(-0.1, -0.003, z0 - 1.5), (0.1, -0.003, z0 - 1.5), (0.1, -0.003, z0 - 0.05), (-0.1, -0.003, z0 - 0.05)], "rust_run", mat=DECAL, out=(0, -1, 0))
    return m


def ring_top():
    """A ring let into the coping stone, lying flat, its eye bolt set in lead (the coping's top is 0.06 up)."""
    m = Mesh()
    y0 = 0.06  # a hand inland of the wall line: on the coping
    m.rev([(0.05, 0.059), (0.05, 0.063), (0.0, 0.064)], 16, "iron_black", M=move(0, y0, 0))  # the lead
    m.rope([(-0.03, y0, 0.06), (-0.025, y0 - 0.035, 0.085), (0.0, y0 - 0.05, 0.09), (0.025, y0 - 0.035, 0.085), (0.03, y0, 0.06)], 0.013, 8, "iron_rust")
    R = 0.12
    pts = [(R * math.sin(a), y0 - 0.05 - R + R * math.cos(a), 0.083 + 0.01 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
    m.rope(pts, 0.019, 6, "iron_rust", closed=True, up=(0, 0, 1))
    m.quad([(-0.22, y0 - 0.35, 0.062), (0.22, y0 - 0.35, 0.062), (0.22, y0 + 0.08, 0.062), (-0.22, y0 + 0.08, 0.062)], "rust_stain", mat=DECAL, out=(0, 0, 1))
    return m


def fender_rope():
    """A rope fender: a stuffed bolster of tarred rope on two lines from an eye bolt on the coping, down the wall."""
    m = Mesh()
    m.rev([(0.04, 0.059), (0.04, 0.064), (0.0, 0.066)], 12, "iron_black", M=move(0, 0.12, 0))
    zb = -0.95
    for dx in (-0.11, 0.11):
        m.rope([(dx * 0.3, 0.12, 0.075), (dx * 0.7, -0.05, 0.095), (dx * 0.95, -0.24, 0.075), (dx, -0.285, 0.0), (dx, -0.29, -0.3), (dx, -0.26, zb + 0.05)], 0.016, 6, "rope", seg_len=0.12)
    with m.at(move(0, -0.24, 0)):
        prof = [(0.02, zb - 0.78), (0.09, zb - 0.74), (0.145, zb - 0.62), (0.165, zb - 0.45), (0.17, zb - 0.3), (0.16, zb - 0.12), (0.12, zb - 0.02), (0.05, zb + 0.04), (0.015, zb + 0.06)]
        m.rev(prof, 18, "hawser", vrep=0.12)
        for z in (zb - 0.2, zb - 0.42, zb - 0.62):
            m.rev([(0.168, z - 0.02), (0.18, z), (0.168, z + 0.02)], 18, "rope")
    return m


def fender_timber():
    """A rubbing fender of oak bolted to the wall face of a working quay: it stands proud of the coping's nose, so the
    hulls rub on it and not on the stone, from under the coping (-0.30) down into the mud at the wall's foot (-4.9).
    Three iron straps with their bolts; worn pale where the hulls ride, slime and weed below the tide's band."""
    m = Mesh()
    W, D, top, foot = 0.28, 0.32, -0.30, -4.9
    c = 0.035  # the chamfer on its outer edges
    x0, x1 = -W / 2, W / 2
    y0, y1 = 0.0, -D
    # the post's outline seen from above (the wall at y 0, the water toward -y), chamfered on the water side
    outline = [(x0, y0), (x0, y1 + c), (x0 + c, y1), (x1 - c, y1), (x1, y1 + c), (x1, y0)]
    U = [0.0, 0.3, 0.38, 0.62, 0.7, 1.0]
    for k in range(len(outline) - 1):
        (ax, ay), (bx, by) = outline[k], outline[k + 1]
        n = Vector((by - ay, -(bx - ax), 0))
        if n.dot(Vector(((ax + bx) / 2, (ay + by) / 2 + D / 2, 0))) < 0:
            n = -n
        m.face([(ax, ay, foot), (bx, by, foot), (bx, by, top), (ax, ay, top)], "fender_oak", uvs=[(U[k], 0), (U[k + 1], 0), (U[k + 1], 1), (U[k], 1)], out=tuple(n))
    m.face([(p[0], p[1], top) for p in outline], "endgrain", out=(0, 0, 1))
    for z in (-0.55, -1.9, -3.4):
        # the strap round the post's face, into the wall either side, its bolts
        for (ax, ay), (bx, by) in zip(outline[:-1], outline[1:]):
            n = Vector((by - ay, -(bx - ax), 0))
            if n.dot(Vector(((ax + bx) / 2, (ay + by) / 2 + D / 2, 0))) < 0:
                n = -n
            n = n.normalized() * 0.012
            m.face([(ax + n.x, ay + n.y, z - 0.04), (bx + n.x, by + n.y, z - 0.04), (bx + n.x, by + n.y, z + 0.04), (ax + n.x, ay + n.y, z + 0.04)], "iron_rust", out=(n.x, n.y, 0))
        for sx in (-1, 1):
            m.box((sx * (W / 2 + 0.05), -0.006, z), (0.1, 0.012, 0.08), "iron_rust")
            m.rev([(0.02, 0.0), (0.02, 0.012), (0.0, 0.016)], 6, "iron_black", M=move(sx * (W / 2 + 0.06), -0.012, z) @ rot("X", math.pi / 2))
        m.rev([(0.025, 0.0), (0.025, 0.014), (0.0, 0.02)], 6, "iron_black", M=move(0, y1 - 0.012, z) @ rot("X", math.pi / 2))
    return m


def wall_decal(cell, width, z_top, name_px=0.05):
    """Letters or a panel painted on a wall face (origin on the wall line, top at z_top)."""
    m = Mesh()
    x, y, w, h = DECAL_ATLAS.cells[cell]
    W, H = w / TEXT_K * name_px, h / TEXT_K * name_px
    m.quad([(-W / 2, -0.004, z_top - H), (W / 2, -0.004, z_top - H), (W / 2, -0.004, z_top), (-W / 2, -0.004, z_top)], cell, mat=DECAL, out=(0, -1, 0))
    return m, W


def ground_decal(cell, w, d, y=0.0):
    m = Mesh()
    m.quad([(-w / 2, y - d / 2, 0.0), (w / 2, y - d / 2, 0.0), (w / 2, y + d / 2, 0.0), (-w / 2, y + d / 2, 0.0)], cell, mat=DECAL, out=(0, 0, 1))
    return m


# ------------------------------------------------------------------ models: the edge


def bollard_cannon():
    """An old iron cannon sunk muzzle-up as a bollard, as on the Werf and the Rijnkaai: the chase tapering up to the
    muzzle swell with its astragal and lip, a ball leaded into the bore; set in a chamfered bluestone seat."""
    m = Mesh()
    m.lathe([(0.44, 0.0), (0.44, 0.035), (0.40, 0.06), (0.0, 0.06)], 4, "bluestone", rot=math.pi / 4)
    prof = [(0.222, 0.055), (0.214, 0.09), (0.196, 0.46), (0.204, 0.48), (0.204, 0.52), (0.192, 0.54), (0.184, 0.63),
            (0.19, 0.67), (0.204, 0.71), (0.214, 0.74), (0.214, 0.775), (0.206, 0.79), (0.2, 0.81), (0.196, 0.825), (0.09, 0.83), (0.085, 0.805)]
    m.rev(prof, 28, "iron_rust", sharp=50)
    # the ball in the bore
    ball = [(0.083 * math.sin(a), 0.792 - 0.083 * math.cos(a)) for a in np.linspace(0.6, math.pi, 7)]
    m.rev(ball, 20, "iron_black")
    m.quad([(-0.55, -0.55, 0.061), (0.55, -0.55, 0.061), (0.55, 0.55, 0.061), (-0.55, 0.55, 0.061)], "rust_stain", mat=DECAL, out=(0, 0, 1))
    return m


def bollard_mushroom():
    """A cast-iron quay bollard of the 1860s: a flanged foot bolted down through a bluestone seat, a waisted barrel
    with a bead, a wide head with a lip to hold the rope; painted green, the paint gone where the ropes run."""
    m = Mesh()
    m.lathe([(0.47, 0.0), (0.47, 0.03), (0.44, 0.05), (0.0, 0.05)], 4, "bluestone", rot=math.pi / 4)
    prof = [(0.30, 0.05), (0.30, 0.085), (0.275, 0.1), (0.225, 0.13), (0.192, 0.2), (0.172, 0.3), (0.165, 0.4), (0.172, 0.47),
            (0.186, 0.49), (0.186, 0.51), (0.18, 0.53), (0.22, 0.58), (0.282, 0.62), (0.298, 0.66), (0.292, 0.69), (0.255, 0.715), (0.17, 0.738), (0.0, 0.748)]
    m.rev(prof, 28, "iron_green", sharp=55)
    for i in range(6):
        a = 2 * math.pi * (i + 0.5) / 6
        m.lathe([(0.026, 0.085), (0.026, 0.1), (0.016, 0.108), (0.0, 0.11)], 6, "iron_black", M=move(0.255 * math.cos(a), 0.255 * math.sin(a), 0.0))
    m.quad([(-0.6, -0.6, 0.051), (0.6, -0.6, 0.051), (0.6, 0.6, 0.051), (-0.6, 0.6, 0.051)], "rust_stain", mat=DECAL, out=(0, 0, 1))
    return m


def bitt_double():
    """A double bitt on a cast base plate: two short posts with caps and a bar between, eight bolts."""
    m = Mesh()
    m.box((0, 0, 0.03), (1.25, 0.5, 0.06), "iron_rust")
    for sx in (-1, 1):
        with m.at(move(sx * 0.38, 0, 0)):
            m.rev([(0.175, 0.06), (0.16, 0.12), (0.145, 0.44), (0.152, 0.5), (0.18, 0.55), (0.186, 0.6), (0.168, 0.625), (0.08, 0.64), (0.0, 0.642)], 24, "iron_rust", sharp=55)
    m.rope([(-0.24, 0, 0.34), (0.0, 0, 0.34), (0.24, 0, 0.34)], 0.045, 12, "iron_black")
    for sx in (-1, 1):
        for sy in (-1, 1):
            m.lathe([(0.024, 0.06), (0.024, 0.075), (0.0, 0.08)], 6, "iron_light", M=move(sx * 0.56, sy * 0.19, 0))
    m.quad([(-0.85, -0.45, 0.001), (0.85, -0.45, 0.001), (0.85, 0.45, 0.001), (-0.85, 0.45, 0.001)], "rust_stain", mat=DECAL, out=(0, 0, 1))
    return m


def post_timber():
    """An oak mooring post: squared, chamfered top, an iron band, worn pale where the ropes run."""
    m = Mesh()
    s = 0.15
    # the post in lengths, the worn band flush with the oak and the iron band standing proud with its
    # own top and bottom: a band laid over the whole post put two faces in one plane (z-fight check)
    for z0, z1, cell in ((0.0, 0.59, "oak"), (0.59, 0.71, "wood_grey"), (0.71, 0.845, "oak"), (0.915, 1.0, "oak")):
        m.box((0, 0, (z0 + z1) / 2), (0.3, 0.3, z1 - z0), cell, skip=("+z", "-z"))
    m.box((0, 0, 0.88), (0.32, 0.32, 0.07), "iron_rust")
    top = [(-s, -s, 1.0), (s, -s, 1.0), (s, s, 1.0), (-s, s, 1.0)]
    apex = (0, 0, 1.12)
    for i in range(4):
        a, b = top[i], top[(i + 1) % 4]
        mid = Vector(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 1.05))
        m.face([a, b, apex], "endgrain", out=mid)
    return m


def capstan():
    """A quay capstan: a cast foot with its pawl ring, a waisted barrel with eight whelps, a drumhead with square
    holes for the bars. Two capstan bars lie beside it."""
    m = Mesh()
    m.lathe([(0.56, 0.0), (0.56, 0.06), (0.5, 0.09), (0.0, 0.09)], 8, "iron_black", rot=math.pi / 8)
    m.rev([(0.44, 0.09), (0.44, 0.13), (0.4, 0.15), (0.31, 0.15)], 28, "iron_rust", sharp=50)
    for i in range(8):
        a = 2 * math.pi * i / 8
        with m.at(move(0.37 * math.cos(a), 0.37 * math.sin(a), 0.15) @ rot("Z", a + 0.5)):
            m.box((0, 0, 0.02), (0.1, 0.035, 0.04), "iron_light")
    m.rev([(0.31, 0.15), (0.27, 0.25), (0.235, 0.42), (0.245, 0.56), (0.29, 0.64), (0.31, 0.68)], 28, "iron_rust")
    for i in range(8):
        a = 2 * math.pi * (i + 0.5) / 8
        c, s = math.cos(a), math.sin(a)
        t = Vector((-s, c, 0)) * 0.022
        pts = [(0.3, 0.18), (0.335, 0.24), (0.31, 0.45), (0.33, 0.6), (0.3, 0.66)]
        outer = [Vector((r * c, r * s, z)) for r, z in pts]
        inner = [Vector(((r - 0.07) * c, (r - 0.07) * s, z)) for r, z in pts]
        for k in range(len(pts) - 1):
            m.face([outer[k] - t, outer[k] + t, outer[k + 1] + t, outer[k + 1] - t], "iron_rust", out=(c, s, 0))
            m.face([inner[k] - t, outer[k] - t, outer[k + 1] - t, inner[k + 1] - t], "iron_rust", out=(s, -c, 0))
            m.face([outer[k] + t, inner[k] + t, inner[k + 1] + t, outer[k + 1] + t], "iron_rust", out=(-s, c, 0))
    m.rev([(0.31, 0.68), (0.37, 0.7), (0.39, 0.73), (0.39, 0.87), (0.37, 0.9), (0.32, 0.92), (0.0, 0.935)], 28, "iron_rust", sharp=50)
    for i in range(6):
        a = 2 * math.pi * i / 6 + math.pi / 6
        c, s = math.cos(a), math.sin(a)
        p = Vector((0.392 * c, 0.392 * s, 0.8))
        t = Vector((-s, c, 0))
        m.face([p - t * 0.055 + Vector((0, 0, -0.045)), p + t * 0.055 + Vector((0, 0, -0.045)), p + t * 0.055 + Vector((0, 0, 0.045)), p - t * 0.055 + Vector((0, 0, 0.045))],
               "black", out=(c, s, 0))
    for k, (x, a) in enumerate(((0.95, 0.12), (1.1, -0.08))):
        m.rope([(x, -0.95 + k * 0.25, 0.045 + k * 0.05), (x + 0.1, 0.0 + k * 0.25, 0.045 + k * 0.03), (x + 0.2, 0.95 + k * 0.25, 0.045)], 0.04, 8, "wood")
    m.quad([(-0.75, -0.75, 0.001), (0.75, -0.75, 0.001), (0.75, 0.75, 0.001), (-0.75, 0.75, 0.001)], "rust_stain", mat=DECAL, out=(0, 0, 1))
    return m


# Where each bollard kind takes a line (the eye dropped over it): its neck's height and radius (game metres).
EYE_AT = {"bollard_cannon": (0.47, 0.205), "bollard_mushroom": (0.43, 0.17), "bitt_double": (0.36, 0.15), "post_timber": (0.66, 0.16)}
LINE_R = 0.028





# ------------------------------------------------------------------ models: on the stones


def chain_run():
    """A heavy stud-less chain dragged out on the stones: oval links, each turned a quarter to the last, along a lazy
    curve, a low heap of it at one end."""
    m = Mesh()
    path = []
    for i in range(40):
        t = i / 39
        path.append(Vector((-1.6 + 3.2 * t, 0.25 * math.sin(t * 5.2), 0.0)))
    pitch = 0.135
    Lk, Wk, rw = 0.085, 0.05, 0.016
    k = 0
    s = 0.0
    total = sum((path[i + 1] - path[i]).length for i in range(len(path) - 1))
    while s < total - 0.05:
        # the point and direction at s along the path
        acc = 0.0
        for i in range(len(path) - 1):
            seg = (path[i + 1] - path[i]).length
            if acc + seg >= s:
                f = (s - acc) / seg
                c = path[i].lerp(path[i + 1], f)
                d = (path[i + 1] - path[i]).normalized()
                break
            acc += seg
        side = Vector((0, 0, 1)).cross(d).normalized()
        up_ = Vector((0, 0, 1))
        a_ax = side if k % 2 == 0 else up_
        lift = rw if k % 2 == 0 else Wk
        pts = [c + d * (Lk * math.cos(q)) + a_ax * (Wk * math.sin(q)) + Vector((0, 0, lift)) for q in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
        m.rope(pts, rw, 5, "iron_rust", closed=True)
        k += 1
        s += pitch
    m.rev([(0.36, 0.0), (0.33, 0.06), (0.24, 0.12), (0.12, 0.155), (0.0, 0.165)], 14, "iron_rust", M=move(1.85, 0.1, 0))
    return m


def hawser_flake():
    """A tarred hawser flaked down on the stones in long bights, ready to run, the eye at one end."""
    m = Mesh()
    pts = []
    loops = 4
    for i in range(loops * 16 + 1):
        t = i / 16
        k = int(min(t, loops - 1e-6))
        f = t - k
        x = -1.2 + 2.4 * (0.5 - 0.5 * math.cos(math.pi * f))
        x = x if k % 2 == 0 else -x
        y = k * 0.12 + 0.12 * (math.sin(math.pi * f) ** 6) * (1 if k % 2 == 0 else 1)
        pts.append((x, y - 0.24, 0.042 + 0.004 * math.sin(i * 0.7)))
    m.rope(pts, 0.04, 8, "hawser", seg_len=0.14)
    eye = [(1.42 + 0.17 * math.cos(a), -0.24 + 0.11 * math.sin(a), 0.04) for a in np.linspace(0, 2 * math.pi, 20, endpoint=False)]
    m.rope(eye, 0.036, 8, "hawser", closed=True, up=(0, 0, 1), seg_len=0.14)
    return m


def hawser_coil():
    """A big hawser coiled down flat, the way the crews leave a mooring line: three layers of turns, the end led out."""
    m = Mesh()
    r0, r1, rw = 0.2, 0.5, 0.042
    pts = []
    layers, turns, per = 3, 4, 18
    for L in range(layers):
        for i in range(turns * per + 1):
            f = i / (turns * per)
            # out on one layer, in on the next
            r = r0 + (r1 - r0) * (f if L % 2 == 0 else 1 - f)
            a = 2 * math.pi * i / per
            pts.append((r * math.cos(a), r * math.sin(a), rw + L * rw * 1.85 + 0.01 * math.sin(a * 2)))
        if L < layers - 1:
            pts.pop()
    m.rope(pts, rw, 6, "hawser", seg_len=0.15)
    end = Vector(pts[-1])
    m.rope([end, end + Vector((0.25, -0.15, -0.05)), Vector((r1 + 0.55, -0.45, rw)), Vector((r1 + 0.95, -0.5, rw))], rw, 7, "hawser", seg_len=0.15)
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
    m.quad([(-0.1 - 1.2, 0.0 - 0.6, 0.0), (-0.1 + 1.2, 0.0 - 0.6, 0.0), (-0.1 + 1.2, 0.0 + 0.6, 0.0), (-0.1 - 1.2, 0.0 + 0.6, 0.0)], "rust_stain", mat=DECAL, out=(0, 0, 1))  # pass 3: rust bled into the stone
    return m


def cable_reel():
    """A wooden cable drum on its rim, hawser wound on it, a timber chock under it."""
    m = Mesh()
    R, W = 0.62, 0.8
    M = move(0, 0, R) @ rot("X", math.pi / 2)
    for zz in (-W / 2, W / 2 - 0.06):
        m.lathe([(R, zz), (R, zz + 0.06)], 10, "wood", M=M)
        # each flange a disc on both faces, 6 cm apart (the inner one lay on the outer one: z-fight check)
        m.lathe([(R, zz), (0.0, zz)], 10, "wood_grey", M=M)
        m.lathe([(0.0, zz + 0.06), (R, zz + 0.06)], 10, "wood_grey", M=M)
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
    return w / TEXT_K * PX, h / TEXT_K * PX


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
    # the back and front walls run between the side walls, not over their ends (z-fight check)
    m.box((0, h - 0.03, 0.12 + H / 2), (S - 0.12, 0.06, H), "shed_planks")
    m.box((0, h + 0.005, 1.55), (0.6, 0.02, 0.55), "window")
    for sx in (-1, 1):
        m.box((sx * 0.495, -h + 0.03, 0.12 + H / 2), (0.31, 0.06, H), "shed_planks")
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
        # the boards under the zinc 3 cm down: in one plane with it they fought (z-fight check)
        m.face([(a[0], a[1], a[2] - 0.03), (0, 0, apex[2] - 0.03), (b[0], b[1], b[2] - 0.03)], "wood_dark", out=-mid, shade=0.6)
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
    m.box((0, 0, 0.4 + H / 2), (W, D, H), "hut_planks", cells={"+z": "wood_dark"}, skip=("-z",))  # on the plinth's top (z-fight check)
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
        m.face([(-W / 2 - o, sy * (D / 2 + o), top - 0.15), (-W / 2 - o, 0, rz - 0.03), (W / 2 + o, 0, rz - 0.03), (W / 2 + o, sy * (D / 2 + o), top - 0.15)],
               "wood_dark", out=(0, -sy, -1), shade=0.5)  # 3 cm under the slates (z-fight check)
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
    # the board and its rails between the posts, not through them: their ends and fronts lay in the
    # posts' faces (z-fight check)
    m.box((0, 0, 1.5), (1.4, 0.06, 1.0), "wood_dark", cells={"-y": "wood"})
    m.box((0, -0.03, 2.0), (1.4, 0.08, 0.06), "wood_dark")
    m.box((0, -0.03, 1.0), (1.4, 0.08, 0.06), "wood_dark")
    for sy in (-1, 1):
        m.face([(-0.95, sy * 0.3, 2.3), (0.95, sy * 0.3, 2.3), (0.95, 0, 2.45), (-0.95, 0, 2.45)], "zinc", out=(0, sy, 1))
    W, H = sign_board("notices")
    m.box((0, -0.1, 2.13), (W, 0.03, H), "wood_dark", cells={"-y": "sign_notices"})  # clear of the posts' fronts
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


def kit_faces(m, faces, iron="iron"):
    """Copy a lantern_kit model into a Mesh: iron in an iron cell, the glass in the "glass" cell (the pane: its burner
    and flame) drawn with the glow material."""
    for pts, uvs, role, shade, smooth in faces:
        if role == "glass":
            m.face(pts, "glass", uvs=uvs, mat=GLOW, shade=1.0)
        else:
            m.face(pts, iron, shade=shade)


def lantern_post():
    """A lantern on an iron post, as at the heads of the quay steps (2026-10-11): the town's gas lamp post
    (tools/blender/lantern_kit.py post) at three fifths of its size, its glass's centre at 2.59 m as before."""
    m = Mesh()
    faces, _ = lantern_kit.build(lantern_kit.post, 0.6, 1.43)
    kit_faces(m, faces)
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
            # (the half over the base: turned about Y the lathe's a = 0 points down, so the dome runs from a = pi/2
            # over the top to 3 pi/2; (0, pi) stood half of it in the ground, the prop check)
            m.lathe([(0.19, -0.26), (0.19, 0.26)], 6, "wicker", M=move(0, 0, 0.04) @ rot("Y", math.pi / 2), arc=(math.pi / 2, 3 * math.pi / 2))
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


# Where the sacks are (2026-09-28: one sack model, client game/sackModel.ts): written to
# client/src/world/quayfurniture_sack_sockets.json; "grain_pallet_bare" is the pallet without them.
SACK_SOCKETS = {}
SACK_CUR = [None]
SACK_NO = [False]
_C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender (x, y, z) -> glTF (x, z, -y)


def sack(m, x, y, z, a, L=0.9, W=0.5, T=0.28, cell="jute"):
    """A filled sack lying flat: a pillow of 3 x 2 panels, tied ear at one end."""
    if SACK_CUR[0] is not None:
        g = _C @ (m.xf @ move(x, y, z) @ rot("Z", a)) @ _C.inverted()
        SACK_SOCKETS.setdefault(SACK_CUR[0], []).append(dict(k="lying", m=[round(g[r][c], 4) for c in range(4) for r in range(4)], L=L, W=W, H=T))
    if SACK_NO[0]:
        return
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
                # the inside 2.5 cm in (the planking): in one plane the two faces fought (z-fight check)
                qn = newell([Vector(p) for p in q]).normalized()
                if qn.dot(Vector((0, side * 0.3, 1))) < 0:
                    qn = -qn
                m.face([Vector(p) - qn * 0.025 for p in q[::-1]], "wood_dark", shade=0.5)
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


# ------------------------------------------------------------------ D4: the work spots' gear (2026-10-11)


def line_eye(kind):
    """The eye of a mooring line dropped over a bollard's neck, its two legs seized together toward the water and the
    line going on from there (the game draws the rest: client/src/world/shipLines.ts, from the point in meta.lineEyes)."""
    z, r = EYE_AT[kind]
    m = Mesh()
    cx = 0.38 if kind == "bitt_double" else 0.0
    R = r + LINE_R + 0.004
    throat = -(r + 0.32)
    pts = []
    # round the back of the neck, then both legs come forward and meet at the seizing
    n = 22
    for i in range(n + 1):
        a = -math.pi / 2 + (2 * math.pi) * (0.08 + 0.84 * i / n)
        pts.append((cx + R * math.cos(a), R * math.sin(a), z + 0.012 * math.sin(3 * a)))
    legs_a = [(cx - 0.05, throat * 0.55, z - 0.01), (cx - 0.012, throat, z - 0.03)]
    legs_b = [(cx + 0.012, throat, z - 0.03), (cx + 0.05, throat * 0.55, z - 0.01)]
    path = [legs_b[0], legs_b[1]] + pts + legs_a  # from the seizing round the neck and back
    m.rope(path, LINE_R * 0.92, 8, "hawser", seg_len=0.1)
    # the seizing: a few turns of small line binding the legs
    m.rev([(0.04, -0.03), (0.045, -0.015), (0.045, 0.015), (0.04, 0.03)], 10, "rope", M=move(cx, throat, z - 0.03) @ rot("X", math.pi / 2))
    # and the line on toward the boat, a short way (the game's line starts at its end)
    out = (cx, throat - 0.22, z - 0.06)
    m.rope([(cx, throat + 0.02, z - 0.03), (cx, throat - 0.1, z - 0.045), out], LINE_R, 8, "hawser", seg_len=0.1)
    # game frame: x, z (up), -y
    return m, [round(out[0], 3), round(out[2], 3), round(-out[1], 3)]


def gangplank():
    """A gangplank laid by on the quay: a long heavy deal with battens for the feet, its ends shod with iron, on two
    chocks, a hand line coiled on it."""
    m = Mesh()
    L, W, T = 4.6, 0.6, 0.07
    z0 = 0.09
    m.box((0, 0, z0 + T / 2), (W, L, T), "plank", cells={"+z": "plank", "-z": "plank", "+y": "endgrain", "-y": "endgrain"})
    for i in range(10):
        y = -L / 2 + 0.35 + i * (L - 0.7) / 9
        m.box((0, y, z0 + T + 0.015), (W - 0.06, 0.05, 0.03), "wood_grey")
    for sy in (-1, 1):
        m.box((0, sy * (L / 2 - 0.04), z0 + T / 2), (W + 0.01, 0.1, T + 0.012), "iron_black")
        m.box((0, sy * (L / 2 - 0.6), 0.045), (W + 0.25, 0.14, 0.09), "wood_dark")
    coil = []
    for i in range(3 * 16 + 1):
        a = 2 * math.pi * i / 16
        r = 0.16 + 0.01 * i / 16
        coil.append((0.05 + r * math.cos(a), 0.6 + r * math.sin(a), z0 + T + 0.03 + 0.03 * i / 48))
    m.rope(coil, 0.014, 6, "rope", seg_len=0.08)
    return m


def tally_desk():
    """The tally clerk's standing desk on the quay: a sloped lid on four legs with stretchers, the ledger open on it, an
    inkwell and a pen, a slate on a nail at the side for the count; a three-legged stool beside it."""
    m = Mesh(ao=1.1)
    W, D = 0.86, 0.58
    yf, yb = -D / 2, D / 2
    zf, zb = 1.0, 1.14
    # legs and stretchers (the front to the clerk: -y)
    for sx in (-1, 1):
        for sy in (-1, 1):
            h = zf if sy < 0 else zb
            m.box((sx * (W / 2 - 0.04), sy * (D / 2 - 0.04), (h - 0.06) / 2), (0.05, 0.05, h - 0.06), "desk")
        m.box((sx * (W / 2 - 0.04), 0, 0.18), (0.04, D - 0.08, 0.04), "desk")
    m.box((0, D / 2 - 0.04, 0.18), (W - 0.08, 0.04, 0.04), "desk")
    # the carcase under the lid and the lid itself
    m.face([(-W / 2, yf, zf - 0.16), (W / 2, yf, zf - 0.16), (W / 2, yf, zf - 0.02), (-W / 2, yf, zf - 0.02)], "desk", out=(0, -1, 0))
    m.face([(-W / 2, yb, zf - 0.16), (W / 2, yb, zf - 0.16), (W / 2, yb, zb - 0.02), (-W / 2, yb, zb - 0.02)], "desk", out=(0, 1, 0))
    for sx in (-1, 1):
        m.face([(sx * W / 2, yf, zf - 0.16), (sx * W / 2, yb, zf - 0.16), (sx * W / 2, yb, zb - 0.02), (sx * W / 2, yf, zf - 0.02)], "desk", out=(sx, 0, 0))
    m.face([(-W / 2, yf, zf - 0.16), (W / 2, yf, zf - 0.16), (W / 2, yb, zf - 0.16), (-W / 2, yb, zf - 0.16)], "desk", out=(0, 0, -1))
    lid = [(-W / 2 - 0.02, yf - 0.03, zf), (W / 2 + 0.02, yf - 0.03, zf), (W / 2 + 0.02, yb, zb), (-W / 2 - 0.02, yb, zb)]
    m.face(lid, "desk", out=(0, -0.24, 1))
    m.face([(p[0], p[1], p[2] - 0.025) for p in lid][::-1], "desk", out=(0, 0.24, -1))
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        pa, pb = lid[a], lid[b]
        m.face([pa, pb, (pb[0], pb[1], pb[2] - 0.025), (pa[0], pa[1], pa[2] - 0.025)], "desk", out=((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, 0))
    # the flat shelf at the back of the lid: the inkwell and the pen
    m.box((0, yb + 0.05, zb - 0.01), (W + 0.04, 0.1, 0.02), "desk")
    m.rev([(0.03, 0.0), (0.032, 0.035), (0.018, 0.05), (0.012, 0.06), (0.0, 0.06)], 10, "black", M=move(0.28, yb + 0.05, zb))
    m.rope([(0.18, yb + 0.03, zb + 0.004), (0.02, yb + 0.07, zb + 0.004)], 0.004, 4, "wood_dark")
    # the ledger open on the slope
    sl = math.atan2(zb - zf, D)
    with m.at(move(-0.06, -0.02, (zf + zb) / 2 + 0.006) @ rot("X", sl)):
        m.box((0, 0, 0.012), (0.56, 0.4, 0.024), "paint_red")
        m.quad([(-0.27, -0.19, 0.025), (0.27, -0.19, 0.025), (0.27, 0.19, 0.025), (-0.27, 0.19, 0.025)], "ledger", out=(0, 0, 1))
    # the slate on a nail
    with m.at(move(W / 2 + 0.012, 0.05, 0.86)):
        m.box((0, 0, 0), (0.016, 0.26, 0.2), "slate")
        m.box((0.002, 0, 0), (0.018, 0.29, 0.23), "wood", cells={"+x": "slate", "-x": "slate"})
    # the stool
    with m.at(move(-0.15, -0.55, 0)):
        m.rev([(0.17, 0.66), (0.175, 0.68), (0.17, 0.7), (0.0, 0.705)], 16, "wood_dark")
        m.rev([(0.17, 0.66), (0.0, 0.655)], 16, "wood_dark")
        for i in range(3):
            a = 2 * math.pi * i / 3
            m.rope([(0.1 * math.cos(a), 0.1 * math.sin(a), 0.66), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.0)], 0.018, 6, "wood_dark")
    return m


def weighbridge_plate():
    """The public weighbridge's plate, let into the setts flush with them: a cast checker plate in an iron frame,
    for a cart and its load (2.7 by 4.2 m). Walked and driven over; the weigh house stands at its side."""
    m = Mesh()
    W, L = 2.7, 4.2
    y = 0.012
    m.quad([(-W / 2 + 0.1, -L / 2 + 0.1, y), (W / 2 - 0.1, -L / 2 + 0.1, y), (W / 2 - 0.1, L / 2 - 0.1, y), (-W / 2 + 0.1, L / 2 - 0.1, y)], "checker", out=(0, 0, 1))
    for x0, y0, x1, y1 in ((-W / 2, -L / 2, W / 2, -L / 2 + 0.1), (-W / 2, L / 2 - 0.1, W / 2, L / 2), (-W / 2, -L / 2 + 0.1, -W / 2 + 0.1, L / 2 - 0.1), (W / 2 - 0.1, -L / 2 + 0.1, W / 2, L / 2 - 0.1)):
        m.quad([(x0, y0, y + 0.004), (x1, y0, y + 0.004), (x1, y1, y + 0.004), (x0, y1, y + 0.004)], "iron_rust", out=(0, 0, 1))
    return m


def weigh_house():
    """The weighbridge's little house: a timber box with a pent roof of zinc, a window over the plate (the steelyard's
    beam and its weights behind it), a door, a stove pipe, the town's notice of the tolls."""
    m = Mesh(ao=2.4)
    W, D, H0, H1 = 1.7, 1.5, 2.35, 2.6
    x0, x1, y0, y1 = -W / 2, W / 2, -D / 2, D / 2
    m.box((0, 0, 0.06), (W + 0.06, D + 0.06, 0.12), "bluestone")
    # walls (the front to the plate: -y), clad in boards
    m.face([(x0, y0, 0.12), (x1, y0, 0.12), (x1, y0, H0), (x0, y0, H0)], "hut_planks", out=(0, -1, 0))
    m.face([(x0, y1, 0.12), (x1, y1, 0.12), (x1, y1, H1), (x0, y1, H1)], "hut_planks", out=(0, 1, 0))
    for sx, xx in ((-1, x0), (1, x1)):
        m.face([(xx, y0, 0.12), (xx, y1, 0.12), (xx, y1, H1), (xx, y0, H0)], "hut_planks", out=(sx, 0, 0))
    # corner posts and a sill
    for xx in (x0, x1):
        for yy in (y0, y1):
            m.box((xx, yy, 1.3), (0.08, 0.08, 2.4), "wood_dark")
    # the window over the plate, the steelyard behind it
    m.box((0, y0 - 0.02, 1.35), (0.9, 0.04, 0.7), "wood_dark", cells={"-y": "window"})
    m.box((0, y0 - 0.06, 0.98), (1.0, 0.1, 0.05), "wood_dark")
    # the door on the side
    m.box((x1 + 0.015, 0.05, 1.0), (0.03, 0.8, 1.9), "door_green", cells={"+x": "door_green"})
    m.rev([(0.018, 0.0), (0.018, 0.02), (0.0, 0.025)], 8, "brass", M=move(x1 + 0.03, 0.35, 1.0) @ rot("Y", math.pi / 2))
    # the pent roof, overhanging
    r = [(x0 - 0.18, y0 - 0.25, H0 + 0.05), (x1 + 0.18, y0 - 0.25, H0 + 0.05), (x1 + 0.18, y1 + 0.18, H1 + 0.08), (x0 - 0.18, y1 + 0.18, H1 + 0.08)]
    m.face(r, "zinc", out=(0, -0.2, 1))
    m.face([(p[0], p[1], p[2] - 0.04) for p in r][::-1], "wood_dark", out=(0, 0.2, -1))
    m.face([r[0], r[1], (r[1][0], r[1][1], r[1][2] - 0.04), (r[0][0], r[0][1], r[0][2] - 0.04)], "zinc", out=(0, -1, 0))
    # the stove pipe with its hat
    m.rev([(0.06, H1 - 0.3), (0.06, H1 + 0.55), (0.12, H1 + 0.6), (0.0, H1 + 0.68)], 12, "iron_black", M=move(x0 + 0.35, y1 - 0.3, 0))
    # the tolls, a board under the window
    m.box((0.0, y0 - 0.025, 0.62), (0.6, 0.02, 0.42), "wood_grey", cells={"-y": "sign_weigh"})
    return m


def hand_barrow():
    """A two-man hand barrow (a berrie) put down on the stones: two ash poles, a slatted bed between them on short legs."""
    m = Mesh()
    L, Wd = 2.3, 0.62
    for sx in (-1, 1):
        x = sx * Wd / 2
        m.rope([(x, -L / 2, 0.22), (x, -L / 2 + 0.5, 0.25), (x, L / 2 - 0.5, 0.25), (x, L / 2, 0.22)], 0.028, 8, "wood")
        for sy in (-1, 1):
            m.box((x, sy * 0.38, 0.12), (0.04, 0.04, 0.24), "wood_grey")
    for i in range(6):
        y = -0.4 + i * 0.16
        m.box((0, y, 0.275), (Wd + 0.05, 0.1, 0.022), "wood_grey")
    for sy in (-1, 1):
        m.box((0, sy * 0.46, 0.25), (Wd + 0.02, 0.04, 0.04), "wood_dark")
    return m


# ------------------------------------------------------------------ the city: storehouse fronts


def store_fronts():
    """The storehouse walls (city_build.json houses with a store): [ax, az, bx, bz, ox, oz, h, kind] per wall,
    o the outward normal in the game frame (x, z)."""
    with open(SRC, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for h in data.get("houses", []):
        if not h.get("store") or h.get("gone"):
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
    # D4: the eyes of the ships' mooring lines over each kind of bollard, and where the line goes on from
    line_eyes = {}
    for kind, short in (("bollard_cannon", "c"), ("bollard_mushroom", "m"), ("bitt_double", "b"), ("post_timber", "p")):
        mesh, out = line_eye(kind)
        B.append((f"line_eye_{short}", mesh))
        line_eyes[kind] = {"model": f"line_eye_{short}", "out": out}
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
    SACK_CUR[0] = "grain_pallet"
    B.append(("grain_pallet", grain_pallet()))
    SACK_CUR[0] = None
    SACK_NO[0] = True
    B.append(("grain_pallet_bare", grain_pallet()))
    SACK_NO[0] = False
    B.append(("timber_baulks", timber_baulks()))
    B.append(("tar_fire", tar_fire()))
    B.append(("boat_trestles", boat_trestles()))
    # D4: the work spots' gear
    B.append(("gangplank", gangplank()))
    B.append(("tally_desk", tally_desk()))
    B.append(("weighbridge_plate", weighbridge_plate()))
    B.append(("weigh_house", weigh_house()))
    B.append(("hand_barrow", hand_barrow()))
    meta = {
        "lineEyes": line_eyes,
        "lineRadius": LINE_R,
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
    edge = ["ring_top", "bollard_cannon", "line_eye_c", "bollard_mushroom", "line_eye_m", "bitt_double", "post_timber", "capstan", "lantern_post", "drain", "worn"]
    row1 = ["chain_run", "hawser_flake", "hawser_coil", "gangplank", "hand_barrow", "anchor", "cable_reel", "coal_heap", "grain_pallet", "tar_fire"]
    row2 = ["customs_booth", "harbour_hut", "tally_desk", "weigh_house", "weighbridge_plate", "notice_board", "sign_name_werf", "sign_nomoor"]
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
    # D4: the edge's iron and rope up close, both halves of the row
    if "--close" in sys.argv:
        for i, x in enumerate((-4.2, 0.6, 5.0)):
            aim((x, -2.6, 1.5), (x, 0.6, 0.45), 32)
            render(os.path.join(SHOTS, f"quayfurniture_edge{i}.png"), (1600, 800))
        aim((-1.0, -3.2, -0.6), (-1.0, 0, -1.6), 22)
        render(os.path.join(SHOTS, "quayfurniture_wallclose.png"), (1600, 800))


# ------------------------------------------------------------------ main


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlases()
    make_materials()
    models, meta = build_models()
    with open(os.path.join(ROOT, "client", "src", "world", "quayfurniture_sack_sockets.json"), "w", encoding="utf-8") as f:
        json.dump(SACK_SOCKETS, f, separators=(",", ":"))
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
