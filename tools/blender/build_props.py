"""Street and quay props of Antwerp, 1873, modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_props.py
    blender -b --factory-startup -P tools/blender/build_props.py -- --preview
    blender -b --factory-startup -P tools/blender/build_props.py -- --closeup dray_hitched,horse out.png [azimuth]
    blender -b --factory-startup -P tools/blender/build_props.py -- --horse out_dir

Writes client/public/models/props.glb (Draco). One node per prop, origin at the
centre of its footprint on the ground, real scale in metres. The front of a
prop (shafts, handles, the crane's jib, the nose of the sack truck) looks
toward -Y in Blender, which is +Z in the game (glTF is Y-up).

Everything here is our own work: the shapes are built from code, the textures
are painted by the functions below (64x64, glass 32x32, nearest filter). No
downloaded models or images. Materials are named for what they are: wood,
wood_dark, iron, rope, sackcloth, crate, barrel, stone, glass, horse, horsehair,
leather. The vertex colour "Col" carries a baked shade (darker near the ground
and underneath), the PS1 way; the game multiplies it into the texture.

An empty node "house_doors" carries the city's house front doors (x, z pairs, in its
extras) so the game keeps props out of doorways.

--preview renders all props in two rows to data/shots/props_preview.png.
--horse renders the draught horse close up (side, front, back, head, harness, legs) and a walk and a trot,
8 frames each, posed as the game poses it (horse_pose), into out_dir.

The draught horse and its harness are on their own atlas, "goods_team" (the team atlas, TEAM_CELLS).
"""

import json
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
OUT = os.path.join(ROOT, "client", "public", "models", "props.glb")
SHOT = os.path.join(ROOT, "data", "shots", "props_preview.png")

MATS = ["wood", "wood_dark", "iron", "rope", "sackcloth", "crate", "barrel", "stone", "glass", "horse", "horsehair", "leather", "goods",
        "goods_team"]
WOOD, DARK, IRON, ROPE, SACK, CRATE, BARREL, STONE, GLASS, HORSE, HAIR, LEATHER, GOODS, TEAM = range(len(MATS))

S = 64

# The goods atlas: one 256x256 texture of 4 x 4 cells (64 px each) for the port goods
# and the traffic, so a whole quay of goods is one material and one draw call per
# chunk. A face of an atlas mesh names a cell; its uv repeats inside that cell (the
# game's psx shader, option atlas: 4). The cell goes out as a second uv set ("Cell",
# TEXCOORD_1): (column, row), row 0 at the top of the picture.
ATLAS_N = 4
CELLS = ["wood", "wood_dark", "iron", "rope", "horse", "horsehair", "leather", "tarp",
         "bale", "coffee", "grain", "hide", "cask", "petrol", "crate_mark", "bluestone"]
(A_WOOD, A_DARK, A_IRON, A_ROPE, A_HORSE, A_HAIR, A_LEATHER, A_TARP,
 A_BALE, A_COFFEE, A_GRAIN, A_HIDE, A_CASK, A_PETROL, A_CRATE, A_STONE) = range(100, 100 + len(CELLS))
# the ordinary materials, as drawn in an atlas mesh
TO_CELL = {WOOD: A_WOOD, DARK: A_DARK, IRON: A_IRON, ROPE: A_ROPE, HORSE: A_HORSE, HAIR: A_HAIR, LEATHER: A_LEATHER,
           SACK: A_GRAIN, BARREL: A_CASK, CRATE: A_CRATE, STONE: A_STONE}

# The team atlas (2026-09-27, the draught horse's detail pass): the horse and its harness have their own 4 x 4 atlas of
# 64 px cells, material "goods_team" (in the game the goods atlas's psx settings: no new shader kind). A face of a
# team mesh names its cell as 200 + k. The mesh is painted bay; the game makes the other coats by pointing the coat
# cells elsewhere (client/src/world/horseGait.ts COATS): chestnut with a flaxen mane, black (the hearse), red roan.
TEAM_CELLS = ["bay", "chestnut", "black", "roan", "hair_black", "hair_flaxen", "hoof", "iron", "brass", "leather",
              "collar", "hame", "eye", "muzzle", "white", "cloth"]
(H_BAY, H_CHESTNUT, H_BLACK, H_ROAN, H_HAIR, H_FLAXEN, H_HOOF, H_IRON, H_BRASS, H_LEATHER, H_COLLAR, H_HAME,
 H_EYE, H_MUZZLE, H_WHITE, H_CLOTH) = range(200, 200 + len(TEAM_CELLS))
# what the coat cells mean: the coat, the mane and tail (and feathers), the points (lower legs), the white markings
H_COAT, H_MANE, H_POINTS, H_MARK = H_BAY, H_HAIR, H_BLACK, H_WHITE

# ------------------------------------------------------------------ textures


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


def paint_planks(seed, base, boards=4, seams=True, joints=True, knots=3):
    """Boards running along u, `boards` of them stacked along v. Weathered, nailed."""
    rng = np.random.default_rng(seed)
    img = np.zeros((S, S, 3))
    bh = S // boards
    for b in range(boards):
        r0, r1 = b * bh, (b + 1) * bh
        tone = 1 + rng.uniform(-0.15, 0.15)
        img[r0:r1] = col(base) * tone * np.array([1, 1 + rng.uniform(-0.04, 0.04), 1 + rng.uniform(-0.07, 0.07)])
        if seams:
            img[r0] *= 0.42
            img[(r0 + 1) % S] *= 1.1
        if joints and rng.random() < 0.35:
            u = int(rng.integers(0, S))
            img[r0 + 1:r1, u] *= 0.45
            for rr in (r0 + 3, r1 - 3):
                img[rr, (u + 2) % S] = (0.08, 0.07, 0.07)
                img[rr, (u - 2) % S] = (0.08, 0.07, 0.07)
    grain = vnoise(rng, S, 2, 24) * 0.55 + vnoise(rng, S, 4, 48) * 0.45
    img *= (0.78 + 0.36 * grain)[..., None]
    img *= (1 + rng.uniform(-0.07, 0.07, S))[:, None, None]
    for _ in range(knots):
        cu, cv = rng.integers(0, S, 2)
        uu, vv = np.meshgrid(np.arange(S), np.arange(S))
        d = ((uu - cu) / 3.0) ** 2 + ((vv - cv) / 1.6) ** 2
        img[d < 1] *= 0.55
        img[(d >= 1) & (d < 2.2)] *= 0.85
    return speckle(img, rng, 0.05)


def paint_iron(seed):
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 6, 6) * 0.6 + vnoise(rng, S, 16, 16) * 0.4
    rust = np.clip((n - 0.56) * 4, 0, 1)[..., None]
    img = col((0.15, 0.15, 0.16)) * (1 - rust) + col((0.33, 0.19, 0.11)) * rust
    img *= (0.85 + 0.3 * vnoise(rng, S, 32, 32))[..., None]
    return speckle(img, rng, 0.08, 0.5, 0.8)


def paint_rope(seed, base=(0.50, 0.42, 0.29)):
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    s = ((uu + vv) % 16) / 16.0
    band = 0.5 + 0.5 * np.sin(np.pi * s) ** 0.7
    fib = vnoise(rng, S, 32, 6)
    img = col(base) * (band * (0.82 + 0.3 * fib))[..., None]
    return speckle(img, rng, 0.06)


def paint_sack(seed):
    """Jute weave with a worn merchant's mark in the middle."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    weave = np.where(((uu // 1) + (vv // 1)) % 2 == 0, 0.07, -0.05)
    rows = rng.uniform(-0.06, 0.06, S)[:, None]
    cols = rng.uniform(-0.06, 0.06, S)[None, :]
    img = col((0.56, 0.46, 0.31)) * (0.92 + weave + rows + cols)[..., None]
    img *= (0.82 + 0.3 * vnoise(rng, S, 4, 4))[..., None]
    # the mark: a ring, a mast with a crossbar and a flag (a merchant's "four")
    cx, cy = 32, 32
    d = np.hypot(uu - cx, vv - cy)
    mark = np.abs(d - 13) < 1.5
    mark |= (np.abs(uu - cx) < 1.3) & (np.abs(vv - cy) < 10)
    mark |= (np.abs(vv - (cy - 3)) < 1.2) & (np.abs(uu - cx) < 7)
    mark |= (np.abs((uu - cx) - (vv - cy - 3)) < 1.3) & (uu >= cx) & (uu <= cx + 6) & (vv > cy)
    mark &= rng.random((S, S)) < 0.8
    img[mark] = img[mark] * 0.35 + col((0.09, 0.07, 0.05)) * 0.35
    return speckle(img, rng, 0.04)


def paint_crate(seed, number="N.127"):
    """The side of a packing crate, fitted to the whole face: four pine boards across (as the
    geometry, seams at the gaps), worn pale at the ends, a stencilled merchant's mark (a
    diamond with a K), ANTWERPEN and a number, nail heads at the battens."""
    rng = np.random.default_rng(seed)
    img = paint_planks(seed, (0.57, 0.46, 0.31), boards=4, seams=True, joints=False, knots=2)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    # worn edges: the board ends and corners handled pale, a few dark chips
    wear = np.clip(1 - np.minimum(uu, S - 1 - uu) / 5.0, 0, 1) * (0.5 + 0.5 * rng.random((S, S)))
    img = img * (1 + 0.35 * wear[..., None])
    chips = (rng.random((S, S)) < 0.03) & (wear > 0.4)
    img[chips] *= 0.45
    # the merchant's mark: a diamond with a K, on the top board
    dia = np.abs(uu - 32) + np.abs(vv - 55) * 1.25
    mark = (dia > 7.5) & (dia < 9.5) & (rng.random((S, S)) < 0.85)
    ink = col((0.07, 0.06, 0.05))
    img[mark] = img[mark] * 0.3 + ink * 0.6
    stencil(img, rng, "K", 31, 52, ink)
    stencil(img, rng, "ANTWERPEN", 14, 34, ink)
    stencil(img, rng, number, 23, 18, ink)
    # nail heads where the battens cross the boards
    for u in (3, 60):
        for v in (4, 20, 36, 52):
            img[v:v + 2, u:u + 2] = col((0.1, 0.09, 0.08))
    return speckle(img, rng, 0.03, 0.7, 0.95)


def paint_staves(seed):
    """Oak staves standing along v, 8 per tile."""
    rng = np.random.default_rng(seed)
    img = np.zeros((S, S, 3))
    for k in range(8):
        tone = 1 + rng.uniform(-0.16, 0.16)
        img[:, k * 8:(k + 1) * 8] = col((0.40, 0.27, 0.16)) * tone
        img[:, k * 8] *= 0.45
    grain = vnoise(rng, S, 32, 3) * 0.6 + vnoise(rng, S, 64, 6) * 0.4
    img *= (0.8 + 0.35 * grain)[..., None]
    return speckle(img, rng, 0.05)


def paint_stone(seed):
    rng = np.random.default_rng(seed)
    img = np.zeros((S, S, 3))
    for r in range(2):
        for c in range(-1, 2):
            u0 = c * 32 + (r % 2) * 16
            tone = 1 + rng.uniform(-0.1, 0.1)
            for u in range(u0, u0 + 32):
                img[r * 32:(r + 1) * 32, u % S] = col((0.46, 0.45, 0.42)) * tone
            img[r * 32:(r + 1) * 32, u0 % S] *= 0.4
        img[r * 32] *= 0.4
    img *= (0.8 + 0.4 * vnoise(rng, S, 16, 16))[..., None]
    return speckle(img, rng, 0.2, 0.7, 1.2)


def paint_glass(seed):
    rng = np.random.default_rng(seed)
    n = 32
    vv = np.arange(n)[:, None, None] / n
    img = np.ones((n, n, 3)) * col((0.78, 0.68, 0.46))
    img *= 1 - 0.45 * vv ** 2  # soot toward the top
    img *= (0.9 + 0.2 * vnoise(rng, n, 4, 4))[..., None]
    img[:2] = img[-2:] = 0.08
    img[:, :2] = img[:, -2:] = 0.08
    return img


def paint_hide(seed, base, stretch=False, specks=0.03):
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 32, 3) if stretch else vnoise(rng, S, 8, 8)
    img = col(base) * (0.82 + 0.36 * n)[..., None]
    img *= (0.9 + 0.2 * vnoise(rng, S, 24, 24))[..., None]
    return speckle(img, rng, specks, 0.7, 0.95)


# A 3x5 stencil font for the merchants' marks on crates, sacks and casks.
GLYPHS = {
    "A": ["010", "101", "111", "101", "101"], "N": ["101", "111", "111", "111", "101"], "V": ["101", "101", "101", "101", "010"],
    "E": ["111", "100", "110", "100", "111"], "R": ["110", "101", "110", "101", "101"], "S": ["011", "100", "010", "001", "110"],
    "I": ["111", "010", "010", "010", "111"], "O": ["010", "101", "101", "101", "010"], "T": ["111", "010", "010", "010", "010"],
    "W": ["101", "101", "111", "111", "101"], "P": ["110", "101", "110", "100", "100"], "H": ["101", "101", "111", "101", "101"],
    "L": ["100", "100", "100", "100", "111"], "C": ["011", "100", "100", "100", "011"], "K": ["101", "110", "100", "110", "101"],
    "0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"], "2": ["110", "001", "010", "100", "111"],
    "3": ["110", "001", "010", "001", "110"], "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "110", "001", "110"],
    "6": ["011", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"], "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "110"], "-": ["000", "000", "111", "000", "000"], ".": ["000", "000", "000", "000", "010"],
}


def stencil(img, rng, text, u0, v0, ink, scale=1, wear=0.8):
    """Letters on a painted array [v, u] (row 0 = v 0, the bottom): the text reads upright, left to right."""
    u = u0
    for ch in text:
        g = GLYPHS.get(ch)
        if g:
            for gy, row in enumerate(g):
                for gx, bit in enumerate(row):
                    if bit != "1":
                        continue
                    for a in range(scale):
                        for b in range(scale):
                            vv = v0 + (4 - gy) * scale + a
                            uu = u + gx * scale + b
                            if 0 <= vv < S and 0 <= uu < S and rng.random() < wear:
                                img[vv, uu] = img[vv, uu] * 0.3 + col(ink) * 0.7
        u += 4 * scale
    return img


def paint_tarp(seed):
    """Tarred canvas: near black with a green-brown cast, folds, seams, worn light patches."""
    rng = np.random.default_rng(seed)
    fold = vnoise(rng, S, 3, 12) * 0.6 + vnoise(rng, S, 8, 24) * 0.4
    img = col((0.17, 0.17, 0.13)) * (0.7 + 0.6 * fold)[..., None]
    worn = np.clip((vnoise(rng, S, 6, 6) - 0.62) * 5, 0, 1)[..., None]
    img = img * (1 - worn * 0.6) + col((0.33, 0.31, 0.25)) * worn * 0.6
    img[::32] *= 0.5  # seams
    img[1::32] *= 1.25
    return speckle(img, rng, 0.05, 0.6, 0.9)


def paint_bale(seed):
    """A cotton bale: grey-brown bagging, white cotton bursting through, iron bands across u."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    weave = np.where((uu + vv) % 2 == 0, 0.06, -0.04)
    img = col((0.47, 0.41, 0.32)) * (0.88 + weave + 0.3 * vnoise(rng, S, 6, 6))[..., None]
    cotton = np.clip((vnoise(rng, S, 10, 7) - 0.66) * 5, 0, 1)[..., None]
    img = img * (1 - cotton) + col((0.74, 0.72, 0.66)) * cotton * (0.9 + 0.1 * rng.random((S, S, 1)))
    img *= (0.85 + 0.3 * vnoise(rng, S, 3, 3))[..., None]  # dirt
    for u0 in (7, 23, 40, 56):
        band = (uu >= u0) & (uu < u0 + 2)
        rust = rng.random((S, S)) < 0.3
        img[band] = col((0.12, 0.11, 0.10))
        img[band & rust] = col((0.32, 0.18, 0.1))
        img[uu == u0 + 2] *= 0.75
    return speckle(img, rng, 0.04)


def paint_coffee(seed):
    """Coffee sack: fine jute, a faded blue stripe at each end, a stencilled port mark and number."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    weave = np.where((uu + vv) % 2 == 0, 0.07, -0.05)
    img = col((0.60, 0.51, 0.36)) * (0.9 + weave + 0.2 * vnoise(rng, S, 4, 4))[..., None]
    for u0 in (5, 56):
        img[:, u0:u0 + 3] = img[:, u0:u0 + 3] * 0.55 + col((0.2, 0.26, 0.36)) * 0.45
    stencil(img, rng, "RIO", 20, 34, (0.1, 0.08, 0.07), scale=2)
    stencil(img, rng, "N.47", 24, 22, (0.1, 0.08, 0.07))
    return speckle(img, rng, 0.05)


def paint_hides(seed):
    """Dried hides. Lower half (v < 0.5): the edge of a folded bundle, thin layers of hair with
    pale flesh-side lines between. Upper half: the hair side of a hide lying on top, brown with
    white patches (pied cattle from the River Plate)."""
    rng = np.random.default_rng(seed)
    img = np.zeros((S, S, 3))
    h = S // 2
    vv = np.arange(h)[:, None] + 1.5 * np.sin(np.arange(S)[None, :] * 0.3 + rng.uniform(0, 6)) + 3 * vnoise(rng, S, 4, 2)[:h]
    hair = col((0.24, 0.15, 0.09)) * (0.75 + 0.45 * vnoise(rng, S, 32, 6)[:h])[..., None]
    img[:h] = hair
    edge = (vv.astype(int) % 5) == 0
    img[:h][edge] = col((0.58, 0.47, 0.34)) * 0.9
    img[:h][(vv.astype(int) % 5) == 1] *= 0.6
    top = col((0.30, 0.19, 0.11)) * (0.8 + 0.35 * vnoise(rng, S, 16, 16)[h:])[..., None]
    white = np.clip((vnoise(rng, S, 5, 5)[h:] - 0.6) * 6, 0, 1)[..., None]
    top = top * (1 - white) + col((0.66, 0.62, 0.55)) * white
    top *= (0.85 + 0.3 * vnoise(rng, S, 64, 8)[h:])[..., None]  # the lie of the hair
    img[h:] = top
    img[h:h + 1] *= 0.5
    return speckle(img, rng, 0.05, 0.6, 0.9)


def paint_cask(seed, base, paint=None):
    """Cask staves along v (the cask's length, 0..1), four iron hoops, maybe a coat of paint."""
    rng = np.random.default_rng(seed)
    img = np.zeros((S, S, 3))
    for k in range(8):
        tone = 1 + rng.uniform(-0.15, 0.15)
        img[:, k * 8:(k + 1) * 8] = col(base) * tone
        img[:, k * 8] *= 0.45
    grain = vnoise(rng, S, 32, 3) * 0.6 + vnoise(rng, S, 64, 6) * 0.4
    img *= (0.8 + 0.35 * grain)[..., None]
    if paint is not None:
        worn = np.clip((vnoise(rng, S, 8, 8) - 0.66) * 5, 0, 1)[..., None]
        img = col(paint) * (0.85 + 0.25 * grain)[..., None] * (1 - worn) + img * worn
        for k in range(8):
            img[:, k * 8] *= 0.55
    for v0, v1 in ((3, 7), (16, 20), (44, 48), (57, 61)):
        img[v0:v1] = col((0.11, 0.10, 0.10)) * (0.8 + 0.4 * rng.random((v1 - v0, S, 1)))
        img[v0:v1][rng.random((v1 - v0, S)) < 0.2] = col((0.30, 0.17, 0.10))
    return speckle(img, rng, 0.05)


def paint_crate_mark(seed):
    """The crate side of the goods atlas (same design, another number)."""
    return paint_crate(seed, "N.12")


def paint_bluestone(seed):
    """Belgian bluestone: blue-grey, fine tooling lines, a darker arris round the face, lime spots."""
    rng = np.random.default_rng(seed)
    img = col((0.34, 0.36, 0.38)) * (0.85 + 0.25 * vnoise(rng, S, 6, 6))[..., None]
    img[::2] *= 0.93  # the claw tool's lines
    img *= (0.95 + 0.1 * vnoise(rng, S, 32, 2))[..., None]
    img[:2] *= 0.65
    img[-2:] *= 0.65
    img[:, :2] *= 0.65
    img[:, -2:] *= 0.65
    lime = rng.random((S, S)) < 0.015
    img[lime] = col((0.62, 0.62, 0.58))
    return speckle(img, rng, 0.08, 0.75, 1.15)


def paint_atlas():
    """The 4 x 4 goods atlas, in Blender's order (row 0 of the array = the bottom of the picture)."""
    cells = {
        "wood": paint_planks(1, (0.43, 0.37, 0.29)),
        "wood_dark": paint_planks(2, (0.25, 0.19, 0.14), boards=2, seams=False, joints=False, knots=1),
        "iron": paint_iron(3),
        "rope": paint_rope(4),
        "horse": paint_hide(10, (0.36, 0.21, 0.12), specks=0.0),
        "horsehair": paint_hide(11, (0.09, 0.07, 0.055), stretch=True),
        "leather": paint_hide(12, (0.21, 0.13, 0.08)),
        "tarp": paint_tarp(21),
        "bale": paint_bale(22),
        "coffee": paint_coffee(23),
        "grain": paint_sack(5),
        "hide": paint_hides(24),
        "cask": paint_cask(25, (0.42, 0.28, 0.17)),
        "petrol": paint_cask(26, (0.40, 0.30, 0.20), paint=(0.24, 0.31, 0.38)),
        "crate_mark": paint_crate_mark(27),
        "bluestone": paint_bluestone(28),
    }
    N = ATLAS_N
    out = np.zeros((S * N, S * N, 3))
    for k, name in enumerate(CELLS):
        c, r = k % N, k // N
        out[(N - 1 - r) * S:(N - r) * S, c * S:(c + 1) * S] = cells[name]
    return out





# ---- the team atlas: coats, hair, hoof and the harness


def paint_coat(seed, base, roan=0.0, sheen=0.0):
    """Short hair lying along v (the length of the body and the legs): fine streaks, soft light and dark patches.
    roan: the share of white hairs mixed in (a red roan); sheen: a pale gloss on the streaks (a black coat)."""
    rng = np.random.default_rng(seed)
    hair = vnoise(rng, S, 32, 8) * 0.5 + vnoise(rng, S, 64, 16) * 0.5
    img = col(base) * (0.93 + 0.13 * hair)[..., None]
    img *= (0.88 + 0.24 * vnoise(rng, S, 3, 3))[..., None]  # soft dapples of light and shade
    if roan:
        # white hairs through the coloured ones: an even grey-pink blend, a little patchy, a few whiter hairs
        k = roan * (0.8 + 0.4 * vnoise(rng, S, 5, 5)) + 0.12 * (hair - 0.5)
        img = img * (1 - k[..., None]) + col((0.74, 0.71, 0.67)) * k[..., None]
        white = rng.random((S, S)) < 0.06
        img[white] = img[white] * 0.6 + col((0.8, 0.78, 0.74)) * 0.4
    if sheen:
        gloss = np.clip((hair - 0.55) * 3, 0, 1)[..., None]
        img = img + col((0.3, 0.32, 0.36)) * sheen * gloss
    return speckle(img, rng, 0.03, 0.8, 0.95)


def paint_long_hair(seed, base):
    """Mane, tail and feathers: long strands along v, dark gaps between them, a few light ones."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 40, 2) * 0.55 + vnoise(rng, S, 20, 3) * 0.45
    img = col(base) * (0.5 + 0.8 * n)[..., None]
    gaps = np.clip((0.42 - vnoise(rng, S, 24, 2)) * 4, 0, 1)[..., None]
    img *= 1 - 0.55 * gaps
    light = vnoise(rng, S, 48, 3) > 0.8
    img[light] = img[light] * 1.35 + 0.03
    return speckle(img, rng, 0.03, 0.7, 0.9)


def paint_hoof(seed):
    """Horn: dark grey-brown with the growth lines running down (along v), a lighter streak or two, worn at the ground."""
    rng = np.random.default_rng(seed)
    lines = vnoise(rng, S, 40, 2) * 0.7 + vnoise(rng, S, 12, 2) * 0.3
    img = col((0.21, 0.18, 0.15)) * (0.7 + 0.5 * lines)[..., None]
    pale = np.clip((vnoise(rng, S, 5, 1) - 0.62) * 4, 0, 1)[..., None]
    img = img * (1 - pale) + col((0.42, 0.37, 0.30)) * pale * (0.8 + 0.3 * lines[..., None])
    img[:4] *= 0.8  # mud at the ground
    return speckle(img, rng, 0.05, 0.6, 0.9)


def paint_team_iron(seed):
    """Harness iron: bits, chains, the shoes. Dark, rubbed bright on the edges, a little rust."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 8, 8) * 0.6 + vnoise(rng, S, 24, 24) * 0.4
    img = col((0.19, 0.19, 0.20)) * (0.8 + 0.4 * n)[..., None]
    rust = np.clip((vnoise(rng, S, 6, 6) - 0.7) * 4, 0, 1)[..., None]
    img = img * (1 - rust) + col((0.32, 0.19, 0.11)) * rust
    bright = rng.random((S, S)) < 0.05
    img[bright] = col((0.46, 0.46, 0.47))
    return img


def paint_brass(seed):
    """Brass fittings: warm yellow, tarnished darker in the hollows, polished spots."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 6, 6) * 0.6 + vnoise(rng, S, 20, 20) * 0.4
    img = col((0.80, 0.62, 0.27)) * (0.78 + 0.35 * n)[..., None]
    tarnish = np.clip((0.4 - vnoise(rng, S, 5, 5)) * 3, 0, 1)[..., None]
    img = img * (1 - 0.55 * tarnish) + col((0.30, 0.25, 0.12)) * 0.55 * tarnish
    shine = vnoise(rng, S, 10, 10) > 0.78
    img[shine] = img[shine] * 0.4 + col((1.0, 0.9, 0.62)) * 0.6
    return img


def paint_harness(seed):
    """Black harness leather along v, stitched a little in from both edges (u 0 and 1 are the strap's edges)."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 8, 16) * 0.6 + vnoise(rng, S, 32, 32) * 0.4
    img = col((0.085, 0.072, 0.063)) * (0.8 + 0.5 * n)[..., None]
    gloss = np.clip((vnoise(rng, S, 3, 12) - 0.6) * 3, 0, 1)[..., None]
    img = img + col((0.12, 0.11, 0.1)) * gloss
    for u in (6, 57):
        img[:, u] *= 0.6
        img[::4, u + (1 if u < 32 else -1)] = col((0.30, 0.27, 0.22))
    img[:, :2] *= 0.7
    img[:, -2:] *= 0.7
    return speckle(img, rng, 0.04, 0.7, 0.95)


def paint_collar(seed):
    """The collar: black leather stuffed hard with straw, the stitching round it in rows (across v)."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 12, 12)
    img = col((0.11, 0.09, 0.075)) * (0.78 + 0.45 * n)[..., None]
    for v in range(0, S, 8):
        img[v] *= 0.55
        img[(v + 1) % S] *= 1.25
        img[v, ::3] = col((0.28, 0.25, 0.2))
    worn = np.clip((vnoise(rng, S, 4, 4) - 0.65) * 4, 0, 1)[..., None]
    img = img * (1 - worn * 0.5) + col((0.27, 0.19, 0.12)) * worn * 0.5
    return speckle(img, rng, 0.04, 0.7, 0.95)


def paint_hame(seed):
    """The hames: oak, varnished dark, the grain along v, rubbed pale at the edges."""
    rng = np.random.default_rng(seed)
    grain = vnoise(rng, S, 24, 2) * 0.6 + vnoise(rng, S, 48, 4) * 0.4
    img = col((0.33, 0.19, 0.09)) * (0.75 + 0.45 * grain)[..., None]
    img[:, :3] = img[:, :3] * 1.3 + 0.03
    img[:, -3:] = img[:, -3:] * 1.3 + 0.03
    return speckle(img, rng, 0.04, 0.7, 0.9)


def paint_eye(seed):
    """An eye fitted to the whole cell: the dark eye with a brown rim, the lids, a light caught in it."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid((np.arange(S) + 0.5) / S, (np.arange(S) + 0.5) / S)
    d = np.hypot((uu - 0.5) / 1.15, vv - 0.5)
    img = np.zeros((S, S, 3))
    img[:] = col((0.11, 0.085, 0.07))
    img[d < 0.40] = col((0.13, 0.075, 0.04))
    img[d < 0.33] = col((0.035, 0.028, 0.025))
    img[(d > 0.40) & (d < 0.46)] = col((0.05, 0.04, 0.035))
    img[np.hypot(uu - 0.6, vv - 0.62) < 0.08] = col((0.75, 0.75, 0.72))
    img[np.hypot(uu - 0.42, vv - 0.38) < 0.04] = col((0.3, 0.3, 0.3))
    return speckle(img, rng, 0.02, 0.8, 0.95)


def paint_muzzle(seed):
    """The muzzle's skin: dark grey, soft pink-grey mottles, the whiskers' dark dots."""
    rng = np.random.default_rng(seed)
    n = vnoise(rng, S, 8, 8)
    img = col((0.16, 0.14, 0.13)) * (0.8 + 0.4 * n)[..., None]
    pink = np.clip((vnoise(rng, S, 5, 5) - 0.6) * 4, 0, 1)[..., None]
    img = img * (1 - 0.6 * pink) + col((0.38, 0.29, 0.27)) * 0.6 * pink
    dots = rng.random((S, S)) < 0.03
    img[dots] = col((0.05, 0.045, 0.04))
    return img


def paint_team_cloth(seed):
    """The wool under the collar and the saddle: red with a dark check, felted."""
    rng = np.random.default_rng(seed)
    img = col((0.42, 0.11, 0.08)) * (0.8 + 0.35 * vnoise(rng, S, 16, 16))[..., None]
    for k in range(0, S, 16):
        img[k:k + 2] = img[k:k + 2] * 0.4 + col((0.12, 0.12, 0.17)) * 0.6
        img[:, k:k + 2] = img[:, k:k + 2] * 0.4 + col((0.12, 0.12, 0.17)) * 0.6
    return speckle(img, rng, 0.08, 0.75, 0.95)


def paint_team_atlas():
    """The team atlas, in Blender's order (row 0 of the array = the bottom of the picture), cells as TEAM_CELLS."""
    cells = {
        "bay": paint_coat(201, (0.40, 0.21, 0.11)),
        "chestnut": paint_coat(202, (0.56, 0.30, 0.13)),
        "black": paint_coat(203, (0.075, 0.068, 0.066), sheen=0.35),
        "roan": paint_coat(204, (0.50, 0.24, 0.14), roan=0.34),
        "hair_black": paint_long_hair(205, (0.075, 0.063, 0.056)),
        "hair_flaxen": paint_long_hair(206, (0.76, 0.64, 0.43)),
        "hoof": paint_hoof(207),
        "iron": paint_team_iron(208),
        "brass": paint_brass(209),
        "leather": paint_harness(210),
        "collar": paint_collar(211),
        "hame": paint_hame(212),
        "eye": paint_eye(213),
        "muzzle": paint_muzzle(214),
        "white": paint_coat(215, (0.78, 0.76, 0.7)),
        "cloth": paint_team_cloth(216),
    }
    N = ATLAS_N
    out = np.zeros((S * N, S * N, 3))
    for k, name in enumerate(TEAM_CELLS):
        c, r = k % N, k // N
        out[(N - 1 - r) * S:(N - r) * S, c * S:(c + 1) * S] = cells[name]
    return out

def image(name, arr):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def make_materials():
    paint = {
        "wood": lambda: paint_planks(1, (0.43, 0.37, 0.29)),
        "wood_dark": lambda: paint_planks(2, (0.25, 0.19, 0.14), boards=2, seams=False, joints=False, knots=1),
        "iron": lambda: paint_iron(3),
        "rope": lambda: paint_rope(4),
        "sackcloth": lambda: paint_sack(5),
        "crate": lambda: paint_crate(6),
        "barrel": lambda: paint_staves(7),
        "stone": lambda: paint_stone(8),
        "glass": lambda: paint_glass(9),
        "horse": lambda: paint_hide(10, (0.36, 0.21, 0.12), specks=0.0),
        "horsehair": lambda: paint_hide(11, (0.09, 0.07, 0.055), stretch=True),
        "leather": lambda: paint_hide(12, (0.21, 0.13, 0.08)),
        "goods": paint_atlas,
        "goods_team": paint_team_atlas,
    }
    for name in MATS:
        img = image(f"{name}_tex", paint[name]())
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry


HEX_FACES = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def planar_uv(pts, tile=1.0, mode="metric"):
    """metric: u along the longest edge, in metres / tile. fit: v up (or along the long edge), 0..1 over the face."""
    n = newell(pts)
    n = n.normalized() if n.length > 1e-9 else Vector((0, 0, 1))
    if mode == "fit" and abs(n.z) < 0.7:
        va = Vector((0, 0, 1))
        va = (va - n * va.dot(n)).normalized()
        ua = va.cross(n)
    else:
        e = max(((pts[(i + 1) % len(pts)] - pts[i]) for i in range(len(pts))), key=lambda v: v.length)
        ua = (e - n * e.dot(n)).normalized()
        va = n.cross(ua)
    c = [(p.dot(ua), p.dot(va)) for p in pts]
    if mode == "fit":
        u0, u1 = min(a for a, _ in c), max(a for a, _ in c)
        v0, v1 = min(b for _, b in c), max(b for _, b in c)
        return [((a - u0) / max(u1 - u0, 1e-6), (b - v0) / max(v1 - v0, 1e-6)) for a, b in c]
    return [(a / tile, b / tile) for a, b in c]


class Mesh:
    def __init__(self, ao=0.45, atlas=False):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.float_color.new("Col")
        # atlas meshes: every face is the "goods" material, the cell in a second uv set
        self.atlas = atlas
        self.cell = self.bm.loops.layers.uv.new("Cell") if atlas else None
        self.xf = Matrix.Identity(4)
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

    def face(self, vs, uvs, mat, shade=1.0, smooth=False, local=None):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        if self.atlas:
            a = TO_CELL.get(mat, mat)
            if a < 100:
                raise ValueError(f"material {MATS[mat]} has no cell in the goods atlas")
            # a team cell (200 + k) is drawn from the team atlas, a goods cell (100 + k) from the goods atlas
            k = a - 200 if a >= 200 else a - 100
            f.material_index = TEAM if a >= 200 else GOODS
            for loop in f.loops:
                loop[self.cell].uv = (k % ATLAS_N, k // ATLAS_N)
        else:
            if mat >= 100:
                raise ValueError("an atlas cell on a mesh without the atlas")
            f.material_index = mat
        f.smooth = smooth
        for k, (loop, uv) in enumerate(zip(f.loops, uvs)):
            loop[self.uv].uv = uv
            s = shade
            if self.ao > 0:
                s *= 0.5 + 0.5 * min(1.0, max(0.0, loop.vert.co.z / self.ao))
            if self.shadefn and local is not None:
                s *= self.shadefn(local[k])
            loop[self.col] = (s, s, s, 1.0)
        return f

    def poly(self, pts, mat, out=None, shade=1.0, tile=1.0, mode="metric", uvs=None):
        """A flat face from local points; flipped to look along `out` if given."""
        pts = [Vector(p) for p in pts]
        if out is not None and newell(pts).dot(Vector(out)) < 0:
            pts = pts[::-1]
            if uvs:
                uvs = uvs[::-1]
        uvs = uvs or planar_uv(pts, tile, mode)
        return self.face([self.vert(p) for p in pts], uvs, mat, shade, local=pts)

    # ---- solids

    def hexa(self, P, mat, shade=1.0, tile=1.0, mode="metric", skip=()):
        """Six faces over 8 corners P[x + 2y + 4z] of a right-handed (maybe skewed) box."""
        P = [Vector(p) for p in P]
        vs = [self.vert(p) for p in P]
        for key, idx in HEX_FACES.items():
            if key in skip:
                continue
            pts = [P[i] for i in idx]
            self.face([vs[i] for i in idx], planar_uv(pts, tile, mode), mat, shade, local=pts)

    def box(self, c, size, mat, shade=1.0, tile=1.0, mode="metric", skip=()):
        cx, cy, cz = c
        sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
        P = [(cx + (sx if i & 1 else -sx), cy + (sy if i & 2 else -sy), cz + (sz if i & 4 else -sz)) for i in range(8)]
        self.hexa(P, mat, shade, tile, mode, skip)

    def beam(self, a, b, w, h, mat, side=None, shade=1.0, tile=1.0, caps=True, w2=None, h2=None):
        """A square-cut timber (or bar) from a to b: w across (along `side`), h the other way."""
        a, b = Vector(a), Vector(b)
        t = (b - a).normalized()
        if side is None:
            s = Vector((0, 0, 1)).cross(t)
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
        self.hexa(P, mat, shade, tile, "metric", () if caps else ("-y", "+y"))

    def slab(self, quad, thick, mat, out, shade=1.0, tile=1.0, mode="metric"):
        """A board: the quad is its outer face (looking along `out`), `thick` goes inward."""
        q = [Vector(p) for p in quad]
        n = (q[1] - q[0]).cross(q[3] - q[0])
        if n.dot(Vector(out)) < 0:
            q = [q[0], q[3], q[2], q[1]]
            n = -n
        n.normalize()
        order = [q[0], q[1], q[3], q[2]]
        P = [p - n * thick for p in order] + order
        self.hexa(P, mat, shade, tile, mode)

    def grid(self, rings, mat, closed=True, smooth=True, shade=1.0, cap0=False, cap1=False, uvfn=None,
             urep=1.0, vscale=1.0, mats=None, closed_v=False, cap_mat=None, cap_tile=1.0):
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
            m = mats[j] if mats else mat
            for i in range(n if closed else n - 1):
                i1 = (i + 1) % n
                idx = [(ja, i), (ja, i1), (jb, i1), (jb, i)]
                if uvfn:
                    uvs = [uvfn(rings[a][b]) for a, b in idx]
                else:
                    u0, u1 = i / n * urep, (i + 1) / n * urep
                    uvs = [(u0, vv[j] * vscale), (u1, vv[j] * vscale), (u1, vv[j + 1] * vscale), (u0, vv[j + 1] * vscale)]
                self.face([V[a][b] for a, b in idx], uvs, m, shade, smooth, local=[rings[a][b] for a, b in idx])
        cm = mat if cap_mat is None else cap_mat
        if cap0:
            c0, c1 = sum(rings[0], Vector()) / n, sum(rings[1], Vector()) / n
            self.poly(rings[0], cm, out=c0 - c1, shade=shade, tile=cap_tile, uvs=[uvfn(p) for p in rings[0]] if uvfn else None)
        if cap1:
            c0, c1 = sum(rings[-1], Vector()) / n, sum(rings[-2], Vector()) / n
            self.poly(rings[-1], cm, out=c0 - c1, shade=shade, tile=cap_tile, uvs=[uvfn(p) for p in rings[-1]] if uvfn else None)

    def lathe(self, prof, sides, mat, rot=0.0, sy=1.0, **kw):
        """Turned shape about +Z. Profile (r, z) bottom to top; for a closed section,
        go up the outside and down the inside (counter-clockwise in r-z)."""
        rings = [[(r * math.cos(rot + 2 * math.pi * i / sides), sy * r * math.sin(rot + 2 * math.pi * i / sides), z)
                  for i in range(sides)] for r, z in prof]
        self.grid(rings, mat, **kw)

    def tube(self, path, radii, sides, mat, side=(1, 0, 0), rot=0.0, closed_path=False, **kw):
        """A tube along a path; radii are r or (r across `side`, r the other way)."""
        path = [Vector(p) for p in path]
        N = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed_path:
                t = path[(k + 1) % N] - path[(k - 1) % N]
            else:
                t = path[min(k + 1, N - 1)] - path[max(k - 1, 0)]
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
        self.grid(rings, mat, closed_v=closed_path, **kw)

    def prism(self, poly, extrude, mat, shade=1.0, tile=1.0, side_mat=None):
        """A flat outline (points) pushed along `extrude`: two caps and the sides."""
        poly = [Vector(p) for p in poly]
        e = Vector(extrude)
        c = sum(poly, Vector()) / len(poly)
        top = [p + e for p in poly]
        self.poly(poly, mat, out=-e, shade=shade, tile=tile)
        self.poly(top, mat, out=e, shade=shade, tile=tile)
        sm = mat if side_mat is None else side_mat
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            self.poly([a, b, b + e, a + e], sm, out=(a + b) / 2 - c, shade=shade, tile=tile)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MATS:
            me.materials.append(bpy.data.materials[m])
        try:
            me.color_attributes.active_color = me.color_attributes["Col"]
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (KeyError, AttributeError):
            pass
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def rot_z(a):
    return Matrix.Rotation(a, 4, "Z")


def move(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


# ------------------------------------------------------------------ parts


def wheel(m, c, r, w, spokes, segs, fel=None, hub=None, spoke=None):
    """A wooden cart wheel with an iron tyre; axle along X through c."""
    fel = fel or max(0.045, r * 0.11)
    hr = hub or max(0.045, r * 0.15)
    sw = spoke or max(0.028, r * 0.055)
    with m.at(move(*c) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(r, -w / 2), (r, w / 2), (r - fel, w / 2), (r - fel, -w / 2)], segs, DARK, closed_v=True,
                smooth=False, mats=[IRON, DARK, DARK, DARK], urep=4, vscale=2)
        hl = w * 2.6
        m.lathe([(hr * 0.65, -hl / 2), (hr, -hl * 0.2), (hr, hl * 0.2), (hr * 0.65, hl / 2)], 8, DARK, smooth=False,
                cap0=True, cap1=True, cap_mat=IRON, urep=1, vscale=2)
        for k in range(spokes):
            a = 2 * math.pi * (k + 0.5) / spokes
            d = Vector((math.cos(a), math.sin(a), 0))
            m.beam(d * hr * 0.8, d * (r - fel * 0.6), sw, sw * 1.3, DARK, side=(0, 0, 1), caps=False, tile=0.8)


def sack(m, seed, L=0.9, W=0.52, H=0.27, nx=7, na=10, mat=SACK):
    """A full jute sack lying down, long along X, tied ends pinched flat."""
    rng = random.Random(seed)
    rings = []
    for k in range(nx):
        t = -1 + 2 * k / (nx - 1)
        f = 1 - abs(t) ** 3
        w = W / 2 * (0.8 + 0.2 * f)
        h = max(0.04, H * f ** 0.5)
        ring = []
        for i in range(na):
            a = 2 * math.pi * i / na
            c, s = math.cos(a), math.sin(a)
            y = w * math.copysign(abs(c) ** 0.55, c)
            z = max(0.0, h * 0.46 + h * 0.54 * math.copysign(abs(s) ** 0.75, s))
            x = t * L / 2
            if abs(t) > 0.99:
                x += math.copysign(0.04, t) * abs(c) ** 3  # the corners stick out
            j = 0.012 if 0 < k < nx - 1 else 0.004
            ring.append((x + rng.uniform(-j, j), y + rng.uniform(-j, j), z + (rng.uniform(-j, j) if z > 0.01 else 0)))
        rings.append(ring)
    m.shadefn = lambda p: 0.7 + 0.3 * min(1.0, p.z / H)
    m.grid(rings, mat, cap0=True, cap1=True, uvfn=lambda p: (p.x / L + 0.5, p.y / L + 0.5))
    m.shadefn = None


def sack_standing(m, seed):
    """A full sack standing up, the neck gathered and tied, a crumpled tuft on top."""
    rng = random.Random(seed)
    prof = [(0.21, 0.0), (0.26, 0.05), (0.28, 0.2), (0.275, 0.42), (0.25, 0.55), (0.18, 0.64), (0.085, 0.69), (0.05, 0.715),
            (0.05, 0.745), (0.1, 0.775), (0.135, 0.815), (0.075, 0.84)]
    sides = 9
    rings = []
    for k, (r, z) in enumerate(prof):
        ring = []
        wob = 0.05 if z < 0.6 else (0.0 if z < 0.75 else 0.3)
        for i in range(sides):
            a = 2 * math.pi * i / sides + (0.25 * k if z > 0.75 else 0)
            rr = r * (1 + (rng.uniform(-wob, wob) if z > 0.02 else 0))
            ring.append((rr * math.cos(a), 0.86 * rr * math.sin(a), z + (rng.uniform(-0.015, 0.015) if z > 0.75 else 0)))
        rings.append(ring)
    m.shadefn = lambda p: 0.72 + 0.28 * min(1.0, p.z / 0.5)
    m.grid(rings, SACK, cap0=True, cap1=True, urep=2, vscale=1 / 0.8)
    m.shadefn = None
    m.lathe([(0.058, 0.705), (0.058, 0.755)], 9, ROPE, sy=0.86, smooth=False, urep=1, vscale=4)


def barrel_body(m):
    body = [(0.265, 0.03), (0.30, 0.18), (0.323, 0.34), (0.33, 0.475), (0.323, 0.61), (0.30, 0.77), (0.265, 0.92)]
    m.lathe(body, 12, BARREL, urep=2, vscale=1.0)
    # chimes: the stave ends stand proud of the heads
    m.lathe([(0.225, 0.025), (0.225, 0.0), (0.265, 0.0), (0.265, 0.03)], 12, BARREL, smooth=False, urep=2)
    m.lathe([(0.265, 0.92), (0.265, 0.95), (0.225, 0.95), (0.225, 0.93)], 12, BARREL, smooth=False, urep=2)
    for z0, out in ((0.025, (0, 0, -1)), (0.93, (0, 0, 1))):
        m.poly([(0.225 * math.cos(2 * math.pi * i / 12), 0.225 * math.sin(2 * math.pi * i / 12), z0) for i in range(12)],
               BARREL, out=out, shade=0.9)

    def r_at(z):
        for (r0, z0), (r1, z1) in zip(body, body[1:]):
            if z0 <= z <= z1:
                return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
        return body[-1][0]

    for z0, z1 in ((0.05, 0.11), (0.25, 0.30), (0.65, 0.70), (0.84, 0.90)):
        m.lathe([(r_at(z0) + 0.009, z0), (r_at(z1) + 0.009, z1)], 12, IRON, urep=3, vscale=1)


def crate_body(m, sx, sy, sz):
    m.box((0, 0, sz / 2), (sx - 0.04, sy - 0.04, sz - 0.04), CRATE, mode="fit")
    b = 0.07
    hx, hy = sx / 2 - b / 2, sy / 2 - b / 2
    for y in (-hy, hy):
        for z in (b / 2, sz - b / 2):
            m.beam((-sx / 2, y, z), (sx / 2, y, z), b, b, WOOD, side=(0, 0, 1), shade=0.85)
    for x in (-hx, hx):
        for z in (b / 2, sz - b / 2):
            m.beam((x, -sy / 2 + b, z), (x, sy / 2 - b, z), b, b, WOOD, side=(0, 0, 1), shade=0.85)
    for x in (-hx, hx):
        for y in (-hy, hy):
            m.beam((x, y, b), (x, y, sz - b), b, b, WOOD, side=(1, 0, 0), shade=0.85)


# ------------------------------------------------------------------ props


HANDCART_R = 0.57  # wheel radius (1.14 m wheels); the axle is at y 0.1
HANDCART_GRIP = (0.34, -2.05, 0.75)  # the grips, level (Blender): x across, y out along the shafts, z height


def handcart(loaded=False, part="all", atlas=False):
    """The dockers' two-wheeled push cart: big wheels, a plank bed, long shafts.
    part: "all", or for the traffic "body" (no wheels), "wheels" (origin on the axle), "load";
    the parts have their origin under (or on) the axle."""
    m = Mesh(atlas=atlas)
    R, zf = HANDCART_R, 0.72
    shift = {"all": (0, 0, 0), "body": (0, -0.1, 0), "wheels": (0, -0.1, -R), "load": (0, -0.1, 0)}[part]
    with m.at(move(*shift)):
        handcart_parts(m, loaded, part, R, zf)
    return m


def handcart_parts(m, loaded, part, R, zf):
    if part in ("all", "wheels"):
        for sx in (-1, 1):
            wheel(m, (sx * 0.64, 0.1, R), R, 0.065, 12, 14)
        # the axle turns with the wheels (so the pair is one part)
        m.beam((-0.72, 0.1, R), (0.72, 0.1, R), 0.045, 0.045, IRON, side=(0, 1, 0))
    top = zf + 0.045 + 0.04
    if part == "load" or (part == "all" and loaded):
        for i, y in enumerate((-0.42, 0.12, 0.66)):
            with m.at(move(0, y, top) @ rot_z(math.pi / 2 + 1.52 + 0.06 * i)):
                sack(m, 20 + i, L=0.88, W=0.5, H=0.26, nx=5 if part == "load" else 7, na=7 if part == "load" else 10)
        for i, y in enumerate((-0.15, 0.42)):
            with m.at(move(0.03 * i, y, top + 0.23) @ rot_z(math.pi / 2 + 1.5 - 0.1 * i) @ Matrix.Rotation(0.05, 4, "X")):
                sack(m, 30 + i, L=0.86, W=0.5, H=0.26, nx=5 if part == "load" else 7, na=7 if part == "load" else 10)
        # a small crate at the back, and the load lashed down with two ropes to the stakes
        with m.at(move(0.0, 0.62, top + 0.26) @ rot_z(0.1)):
            crate_detail(m, 0.55, 0.42, 0.34, 23, handles=False)
        for y in (-0.3, 0.45):
            path = [(-0.545, y, top + 0.28), (-0.46, y, top + 0.44), (-0.2, y + 0.02, top + 0.53), (0.2, y - 0.02, top + 0.53),
                    (0.46, y, top + 0.44), (0.545, y, top + 0.28)]
            m.tube(path, [0.018] * len(path), 3, ROPE, side=(0, 1, 0), vscale=5)
    if part not in ("all", "body"):
        return
    # the bolster between the axle and the bed
    m.beam((-0.5, 0.1, R + 0.06), (0.5, 0.1, R + 0.06), 0.1, 0.12, DARK, side=(0, 1, 0))
    # worn grips at the shaft ends: a darker, greasy band where the hands hold
    gx, gy, gz = HANDCART_GRIP
    for sx in (-1, 1):
        m.beam((sx * gx, gy + 0.33, gz + 0.02), (sx * (gx - 0.004), gy - 0.02, gz + 0.03), 0.058, 0.064, LEATHER, shade=0.8)
    for sx in (-1, 1):
        m.beam((sx * 0.44, 0.95, zf), (sx * 0.44, -0.72, zf), 0.07, 0.09, DARK)
        m.beam((sx * 0.44, -0.72, zf), (sx * 0.34, -2.05, zf + 0.03), 0.07, 0.09, DARK, w2=0.05, h2=0.055)
        m.beam((sx * 0.44, -0.62, zf - 0.04), (sx * 0.47, -0.68, 0.0), 0.055, 0.055, DARK, side=(1, 0, 0))
    m.beam((-0.37, -2.0, zf + 0.03), (0.37, -2.0, zf + 0.03), 0.045, 0.045, DARK, side=(0, 1, 0))
    for y in (0.85, -0.64):
        m.beam((-0.5, y, zf), (0.5, y, zf), 0.06, 0.07, DARK, side=(0, 1, 0))
    top = zf + 0.045 + 0.04
    m.box((0, 0.11, zf + 0.065), (1.0, 1.68, 0.04), WOOD)
    for sx in (-1, 1):
        m.slab([(sx * 0.52, -0.73, top), (sx * 0.52, 0.95, top), (sx * 0.52, 0.95, top + 0.2), (sx * 0.52, -0.73, top + 0.2)],
               0.03, WOOD, out=(sx, 0, 0), shade=0.9)
        for y in (-0.62, 0.1, 0.84):
            m.beam((sx * 0.545, y, zf - 0.05), (sx * 0.545, y, top + 0.3), 0.045, 0.045, DARK, side=(1, 0, 0))
    m.slab([(-0.52, 0.96, top), (0.52, 0.96, top), (0.52, 0.96, top + 0.16), (-0.52, 0.96, top + 0.16)], 0.03, WOOD, out=(0, 1, 0), shade=0.9)
    m.slab([(-0.52, -0.74, top), (0.52, -0.74, top), (0.52, -0.74, top + 0.3), (-0.52, -0.74, top + 0.3)], 0.03, WOOD, out=(0, -1, 0), shade=0.9)


DRAY_HORSE_Y = -3.2  # where the horse stands in front of the hitched dray (Blender y)
DRAY_SHAFT_TIP_Z = 1.26  # the hitched shafts end at the horse's point of shoulder, through the tugs on its back band


DRAY_REAR_Y, DRAY_FRONT_Y = 1.25, -1.15  # the axles (Blender y); wheel radii 0.52 and 0.42


def dray(hitched=False, part="all", atlas=False):
    """Four-wheeled flat dray for one horse: plank bed on sills, fore-carriage on a turntable.
    part: "all", or for the traffic "bed" (origin under the rear axle), "fore" (the fore-carriage
    and shafts, origin under the front axle, it turns with the horse), "wheels_rear" and
    "wheels_front" (a pair of wheels, origin on the axle)."""
    m = Mesh(atlas=atlas)
    shift = {"all": (0, 0, 0), "bed": (0, -DRAY_REAR_Y, 0), "fore": (0, -DRAY_FRONT_Y, 0),
             "wheels_rear": (0, -DRAY_REAR_Y, -0.52), "wheels_front": (0, -DRAY_FRONT_Y, -0.42)}[part]
    with m.at(move(*shift)):
        dray_parts(m, hitched, part)
    return m


def dray_parts(m, hitched, part):
    def want(p):
        return part in ("all", p)

    for sx in (-1, 1):
        if want("wheels_rear"):
            wheel(m, (sx * 0.8, 1.25, 0.52), 0.52, 0.07, 12, 14)
        if want("wheels_front"):
            wheel(m, (sx * 0.76, -1.15, 0.42), 0.42, 0.065, 10, 12)
    if want("bed"):
        # rear axle and bolster
        m.beam((-0.88, 1.25, 0.52), (0.88, 1.25, 0.52), 0.1, 0.1, DARK, side=(0, 1, 0))
        m.box((0, 1.25, 0.71), (1.25, 0.14, 0.28), DARK)
    if want("fore"):
        # fore-carriage: axle, bolster, turntable
        m.beam((-0.84, -1.15, 0.42), (0.84, -1.15, 0.42), 0.1, 0.1, DARK, side=(0, 1, 0))
        m.box((0, -1.15, 0.55), (1.15, 0.14, 0.18), DARK)
        with m.at(move(0, -1.15, 0)):
            m.lathe([(0.38, 0.64), (0.38, 0.70)], 10, IRON, smooth=False, cap1=True)
        # shafts: resting on the ground, or up at a horse's shoulders
        tip_z, tip_y = (DRAY_SHAFT_TIP_Z, -3.95) if hitched else (0.05, -3.85)
        for sx in (-1, 1):
            m.beam((sx * 0.52, -1.2, 0.56), (sx * 0.43, tip_y, tip_z), 0.075, 0.09, DARK, w2=0.05, h2=0.06)
            if hitched:
                m.beam((sx * 0.43, tip_y + 0.12, tip_z), (sx * 0.43, tip_y - 0.02, tip_z + 0.02), 0.06, 0.07, IRON)
        f = (1.75 - 1.2) / (-tip_y - 1.2)
        zc = 0.56 + (tip_z - 0.56) * f
        xc = 0.52 - 0.09 * f
        m.beam((-xc, -1.75, zc), (xc, -1.75, zc), 0.06, 0.06, DARK, side=(0, 1, 0))
    if not want("bed"):
        return
    # the upper bolster on the turntable carries the bed
    m.box((0, -1.15, 0.775), (1.25, 0.14, 0.15), DARK)
    # sills, bearers, bed
    for sx in (-1, 1):
        m.beam((sx * 0.55, 1.97, 0.92), (sx * 0.55, -1.8, 0.92), 0.12, 0.14, DARK)
    for y in (-1.62, -0.3, 0.9, 1.88):
        m.beam((-0.9, y, 0.96), (0.9, y, 0.96), 0.08, 0.06, DARK, side=(0, 1, 0))
    m.box((0, 0.1, 1.02), (1.8, 3.72, 0.06), WOOD)
    # low side boards and stakes
    for sx in (-1, 1):
        m.slab([(sx * 0.9, -1.76, 1.05), (sx * 0.9, 1.96, 1.05), (sx * 0.9, 1.96, 1.24), (sx * 0.9, -1.76, 1.24)], 0.04, WOOD,
               out=(sx, 0, 0), shade=0.85)
        for y in (-1.45, -0.3, 0.85, 1.85):
            m.beam((sx * 0.925, y, 0.9), (sx * 0.925, y, 1.46), 0.05, 0.05, DARK, side=(1, 0, 0))
    # headboard and the driver's seat
    m.slab([(-0.9, -1.78, 1.05), (0.9, -1.78, 1.05), (0.9, -1.78, 1.62), (-0.9, -1.78, 1.62)], 0.05, WOOD, out=(0, -1, 0), shade=0.9)
    for sx in (-1, 1):
        m.box((sx * 0.5, -1.55, 1.3), (0.06, 0.3, 0.5), DARK)
    m.box((0, -1.55, 1.58), (1.3, 0.38, 0.05), WOOD)


# ------------------------------------------------------------------ the draught horse
# (the detail pass of 2026-09-27, docs/milestones/vehicle-detail.md)
# A heavy Brabant (Flemish) draught horse of 1873 at true size, in full harness: the collar with its rim, hames,
# hame tugs, terrets and the kidney link; the bridle with browband, blinkers, noseband, bit and reins; the back pad
# with its terrets, back band, tugs and belly band; the crupper, the hip straps and the breeching. Built in the horse's
# own frame (x across, f forward, h up; HP() puts it into Blender, y = -f), on the team atlas. The game moves the body
# and eight leg parts: each leg is split at the knee (front) or the hock (hind); the upper part hangs from its pivot in
# the shoulder or the hip, the lower part from the joint. client/src/world/horseGait.ts has the same rig and bends
# the legs with two-bone IK, so a hoof on the ground stays where it stands (horse_pose below is the same, for the
# previews).


def HP(x, f, h):
    return Vector((x, -f, h))


# the leg rig, (f, h) in the horse's frame: the pivot (hidden in the shoulder or the hip), the joint (knee or hock),
# the middle of the sole; the leg's x; the sole's toe and heel from its middle. KEEP IN STEP with horseGait.ts RIG.
HORSE_RIG = {
    "front": {"x": 0.19, "pivot": (0.62, 1.40), "joint": (0.645, 0.50), "sole": (0.67, 0.0), "toe": 0.11, "heel": 0.08},
    "hind": {"x": 0.20, "pivot": (-0.62, 1.38), "joint": (-0.76, 0.58), "sole": (-0.67, 0.0), "toe": 0.11, "heel": 0.08},
}
# The collar, where the omnibus's traces and pole chains, the dray's shafts and the train's trace chain meet the horse
# (the same place as the horse of before): its middle and axis (f, h), the half-width and half-height of the roll's
# middle line, the roll's radius; the hames' middle line.
COLLAR_C = (0.84, 1.66)
COLLAR_T = (0.6, 0.8)
COLLAR_A, COLLAR_B, COLLAR_R = 0.25, 0.36, 0.07
HAME_A, HAME_B = 0.31, 0.42
TRACE_END = (0.31, 0.80, 1.52)  # x, f, h: the buckle at the end of each hame tug, where a trace starts
KIDNEY = (0.0, 1.20, 1.385)  # x, f, h: the ring under the collar where the pole chains hook on
SHAFT_TUG = (0.445, 0.30, 1.145)  # x, f, h: the middle of the tug each dray shaft rests in (where dray() hitched runs it)


def _cr(table, f):
    """Catmull-Rom through rows (key, values...) sorted by key: the values at f."""
    keys = [r[0] for r in table]
    if f <= keys[0]:
        return list(table[0][1:])
    if f >= keys[-1]:
        return list(table[-1][1:])
    i = max(k for k in range(len(keys) - 1) if keys[k] <= f)
    t = (f - keys[i]) / (keys[i + 1] - keys[i])
    p0, p1, p2, p3 = table[max(i - 1, 0)], table[i], table[i + 1], table[min(i + 2, len(table) - 1)]
    out = []
    for c in range(1, len(p1)):
        a, b, cc, d = p0[c], p1[c], p2[c], p3[c]
        out.append(0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t * t + (-a + 3 * b - 3 * cc + d) * t ** 3))
    return out


def _se(v, n):
    return math.copysign(abs(v) ** (2.0 / n), v)


# the body: f, top, bottom, half-width, squareness (a Brabant: deep, wide, a round double rump)
BODY = [
    (-1.03, 1.42, 1.19, 0.06, 2.2),
    (-1.00, 1.53, 1.08, 0.19, 2.3),
    (-0.93, 1.63, 1.00, 0.30, 2.4),
    (-0.78, 1.705, 0.975, 0.36, 2.5),
    (-0.58, 1.72, 0.99, 0.375, 2.5),
    (-0.38, 1.695, 0.975, 0.36, 2.4),
    (-0.18, 1.66, 0.915, 0.365, 2.3),
    (0.03, 1.645, 0.885, 0.375, 2.3),
    (0.24, 1.665, 0.895, 0.37, 2.3),
    (0.42, 1.70, 0.93, 0.35, 2.3),
    (0.58, 1.715, 0.98, 0.33, 2.3),
    (0.74, 1.64, 1.03, 0.31, 2.3),
    (0.87, 1.52, 1.03, 0.275, 2.3),
    (0.97, 1.43, 1.10, 0.215, 2.2),
    (1.035, 1.37, 1.18, 0.11, 2.2),
]


def body_sec(f):
    top, bot, W, n = _cr(BODY, f)
    hw = bot + 0.55 * (top - bot)  # the widest a little above the middle (the ribs spring high)
    return hw, top - hw, hw - bot, W, n


def body_pt(f, a, off=0.0):
    hw, T, B, W, n = body_sec(f)
    c, s = math.cos(a), math.sin(a)
    # the croup is split along the spine (a Brabant's double rump)
    groove = 0.018 * max(0.0, 1 - abs(f + 0.62) / 0.36) * max(0.0, 1 - abs(a - math.pi / 2) / 0.35)
    return HP((W + off) * _se(c, n), f, hw + ((T + off - groove) if s > 0 else (B + off)) * _se(s, n))


def body_out(f, a):
    return (body_pt(f, a, 0.02) - body_pt(f, a, 0.0)).normalized()


def body_half_width(f, h):
    hw, T, B, W, n = body_sec(f)
    q = abs(h - hw) / (T if h > hw else B)
    return 0.0 if q >= 1 else W * (1 - q ** n) ** (1 / n)


def body_angle_at(f, h, side=1):
    """The angle round the body's ring at f where its side is at height h."""
    hw, T, B, W, n = body_sec(f)
    q = max(-1.0, min(1.0, (h - hw) / (T if h > hw else B)))
    s = math.copysign(abs(q) ** (n / 2), q)
    a = math.asin(max(-1.0, min(1.0, s)))
    return a if side > 0 else math.pi - a


# the neck by its crest and throat lines: crest (f, h), throat (f, h), half-width
NECK = [
    (0.35, 1.70, 0.80, 1.05, 0.30),
    (0.52, 1.745, 0.93, 1.25, 0.25),
    (0.605, 1.812, 1.065, 1.495, 0.19),  # in the collar's plane: inside its roll
    (0.78, 1.93, 1.09, 1.62, 0.165),
    (0.93, 2.06, 1.10, 1.78, 0.145),
    (1.06, 2.17, 1.11, 1.93, 0.13),
    (1.14, 2.235, 1.13, 2.03, 0.12),
]


def neck_sec(u):
    """u 0 (the withers) .. 1 (the poll): the middle, the ring's axis, half-width and half-height (Blender)."""
    k = u * (len(NECK) - 1)
    cf, ch, tf, th, W = _cr([(i,) + r for i, r in enumerate(NECK)], k)
    crest, throat = HP(0, cf, ch), HP(0, tf, th)
    d = crest - throat
    C = (crest + throat) / 2
    t = Vector((0.0, d.z, -d.y)).normalized()  # square to crest-throat in the f-h plane, toward the head
    if t.y > 0:
        t = -t
    return C, t, W, d.length / 2


def neck_pt(u, a, off=0.0):
    C, t, W, R = neck_sec(u)
    s = Vector((1.0, 0.0, 0.0))
    b = t.cross(s)
    c, sn = math.cos(a), math.sin(a)
    w = (W + off) * (1 - 0.22 * max(0.0, sn))  # the crest narrower than the throat
    return C + s * w * _se(c, 2.2) + b * (R + off) * _se(sn, 2.2)


# the head along its axis from the poll to the lips: t, half-width, face side, jaw side
HEAD0, HEAD1 = (1.155, 2.16), (1.56, 1.61)
HEAD = [
    (0.0, 0.115, 0.075, 0.13),
    (0.10, 0.14, 0.095, 0.18),
    (0.25, 0.15, 0.095, 0.20),
    (0.40, 0.13, 0.085, 0.15),
    (0.55, 0.105, 0.08, 0.105),
    (0.70, 0.093, 0.075, 0.087),
    (0.84, 0.098, 0.074, 0.084),
    (0.94, 0.09, 0.063, 0.074),
    (1.0, 0.055, 0.035, 0.045),
]


def head_sec(t):
    a, b = HP(0, *HEAD0), HP(0, *HEAD1)
    W, T, B = _cr(HEAD, t)
    return a + (b - a) * t, (b - a).normalized(), W, T, B


def head_pt(t, a, off=0.0):
    C, ax, W, T, B = head_sec(t)
    s = Vector((1.0, 0.0, 0.0))
    b = ax.cross(s)  # the face side (forward and up)
    c, sn = math.cos(a), math.sin(a)
    return C + s * (W + off) * _se(c, 2.2) + b * ((T if sn > 0 else B) + off) * _se(sn, 2.2)


def head_out(t, a):
    return (head_pt(t, a, 0.02) - head_pt(t, a, 0.0)).normalized()


def neck_out(u, a):
    return (neck_pt(u, a, 0.02) - neck_pt(u, a, 0.0)).normalized()


def collar_frame():
    C = HP(0, *COLLAR_C)
    t = Vector((0.0, -COLLAR_T[0], COLLAR_T[1])).normalized()
    s = Vector((1.0, 0.0, 0.0))
    return C, t, s, t.cross(s)  # the last one points up and back along the collar


def collar_pt(th, A, B, dt=0.0):
    C, t, s, b = collar_frame()
    return C + t * dt + s * A * math.cos(th) + b * B * math.sin(th)


# ---- building blocks


def band(m, pts, outs, width, thick, cell, vscale=4.0, shade=1.0, closed=False, faces="strap"):
    """A flat strap along pts, its inner face on them and its outer face along outs (a surface's normals):
    `width` across (a number or one per point), `thick` outward. u runs across it (0 and 1 are the edges), v along.
    faces: "full" (a strap in the air: the reins), "strap" (on the body: no face underneath), "decal" (the outer face)."""
    n = len(pts)
    widths = width if isinstance(width, (list, tuple)) else [width] * n
    rings = []
    for i in range(n):
        if closed:
            t = pts[(i + 1) % n] - pts[(i - 1) % n]
        else:
            t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        t.normalize()
        o = Vector(outs[i]) - t * Vector(outs[i]).dot(t)
        o = o.normalized() if o.length > 1e-6 else t.orthogonal().normalized()
        w = o.cross(t).normalized()
        hw = widths[i] / 2
        p = Vector(pts[i])
        rings.append([m.vert(p + w * hw + o * thick), m.vert(p - w * hw + o * thick), m.vert(p - w * hw), m.vert(p + w * hw)])
    vv = [0.0]
    for i in range(1, n + (1 if closed else 0)):
        vv.append(vv[-1] + (Vector(pts[i % n]) - Vector(pts[i - 1])).length * vscale)
    us = [1.0, 0.0, 0.0, 1.0]
    segs = n if closed else n - 1
    ks = {"full": (0, 1, 2, 3), "strap": (0, 1, 3), "decal": (0,)}[faces]
    for j in range(segs):
        ra, rb = rings[j], rings[(j + 1) % n]
        for k in ks:
            k1 = (k + 1) % 4
            m.face([ra[k], ra[k1], rb[k1], rb[k]], [(us[k], vv[j]), (us[k1], vv[j]), (us[k1], vv[j + 1]), (us[k], vv[j + 1])],
                   cell, shade, smooth=False)
    if not closed and faces != "decal":
        m.face(rings[0][::-1], [(1, 0), (0, 0), (0, 0.1), (1, 0.1)], cell, shade, smooth=False)
        m.face(rings[-1], [(1, 0), (0, 0), (0, 0.1), (1, 0.1)], cell, shade, smooth=False)


def torus(m, C, axis, R, r, cell, seg=6, sides=3, shade=1.0):
    axis = Vector(axis).normalized()
    u = axis.orthogonal().normalized()
    v = axis.cross(u)
    path = [Vector(C) + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * R for k in range(seg)]
    m.tube(path, [r] * seg, sides, cell, side=tuple(axis), closed_path=True, smooth=False, shade=shade, urep=1, vscale=4)


def disc(m, C, n, r, h, cell, sides=6, shade=1.0):
    """A boss or rosette: a low round dome on a surface at C, looking along n."""
    q = Vector(n).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    with m.at(Matrix.Translation(Vector(C)) @ q):
        m.lathe([(r, -0.004), (r, h * 0.5), (r * 0.6, h)], sides, cell, smooth=False, cap1=True, shade=shade)


def sagged(pts, sag):
    """The points with each span split in three and its middle let down by `sag` (a hanging rein or chain)."""
    out = [Vector(pts[0])]
    for a, b in zip(pts, pts[1:]):
        a, b = Vector(a), Vector(b)
        for k in (1, 2):
            t = k / 2
            p = a + (b - a) * t
            p.z -= sag * math.sin(math.pi * t) * min(1.0, (b - a).length / 0.4)
            out.append(p)
    return out


def sheet(m, rings, cell, uscale=4.0, shade=1.0, closed_ring=True):
    """Quads between rings with u along the rings' order (in metres x uscale) and v round each ring (0..1): for hair
    that hangs down across the rings (the mane)."""
    V = [[m.vert(p) for p in r] for r in rings]
    uu = [0.0]
    for a, b in zip(rings, rings[1:]):
        uu.append(uu[-1] + (Vector(a[0]) - Vector(b[0])).length * uscale)
    n = len(rings[0])
    for j in range(len(rings) - 1):
        for i in range(n if closed_ring else n - 1):
            i1 = (i + 1) % n
            m.face([V[j][i], V[j][i1], V[j + 1][i1], V[j + 1][i]],
                   [(uu[j], i / n), (uu[j], (i + 1) / n), (uu[j + 1], (i + 1) / n), (uu[j + 1], i / n)], cell, shade, smooth=True)
    for r, out in ((rings[0], 0), (rings[-1], -1)):
        pts = [Vector(p) for p in r]
        c0 = sum(pts, Vector()) / n
        c1 = sum((Vector(p) for p in rings[1 if out == 0 else -2]), Vector()) / n
        m.poly(pts, cell, out=c0 - c1, shade=shade)


# ---- the body, neck and head


def horse_hide(m):
    # the body: rings from the rump to the breast
    fs = [-1.03, -1.0, -0.95, -0.87, -0.75, -0.6, -0.43, -0.25, -0.07, 0.11, 0.29, 0.45, 0.59, 0.72, 0.84, 0.94, 1.0, 1.03]
    sides = 16
    rings = [[body_pt(f, 2 * math.pi * i / sides) for i in range(sides)] for f in fs]
    m.shadefn = lambda p: 0.6 + 0.4 * min(1.0, max(0.0, (p.z - 0.9) / 0.75))
    m.grid(rings, H_COAT, cap0=True, cap1=True, urep=4, vscale=1.6)
    # the neck, from inside the shoulders to the poll
    us = [0.0, 0.17, 0.34, 0.5, 0.66, 0.83, 1.0]
    rings = [[neck_pt(u, 2 * math.pi * i / 12) for i in range(12)] for u in us]
    m.shadefn = lambda p: 0.66 + 0.34 * min(1.0, max(0.0, (p.z - 1.2) / 0.8))
    m.grid(rings, H_COAT, cap1=True, urep=3, vscale=1.6)
    # the head: broad forehead, round jowls, a straight face, the muzzle
    ts = [0.0, 0.1, 0.2, 0.3, 0.42, 0.56, 0.7, 0.82, 0.9, 0.96, 1.0]
    rings = [[head_pt(t, 2 * math.pi * i / 12) for i in range(12)] for t in ts]
    mats = [H_COAT] * 6 + [H_MUZZLE] * 4
    m.shadefn = lambda p: 0.62 + 0.38 * min(1.0, max(0.0, (p.z - 1.55) / 0.55))
    m.grid(rings, H_COAT, mats=mats, cap0=True, cap1=True, cap_mat=H_MUZZLE, urep=3, vscale=1.8)
    m.shadefn = None
    # a blaze down the face (white on the bay, chestnut and roan; the black horse's is black)
    ts = [0.08, 0.2, 0.35, 0.5, 0.65, 0.78, 0.86]
    band(m, [head_pt(t, math.pi / 2, 0.002) for t in ts], [head_out(t, math.pi / 2) for t in ts],
         [0.036, 0.03, 0.022, 0.02, 0.024, 0.034, 0.042], 0.002, H_MARK, vscale=2, faces="decal")
    # nostrils, the lips' line
    for sx in (1, -1):
        a = math.radians(52) if sx > 0 else math.radians(128)
        c = head_pt(0.875, a, 0.003)
        o = head_out(0.875, a)
        ax = head_sec(0.875)[1]
        w = o.cross(ax).normalized()
        pts = [c + ax * 0.024 * math.cos(2 * math.pi * k / 6) + w * 0.013 * math.sin(2 * math.pi * k / 6) for k in range(6)]
        m.poly(pts, H_HAIR, out=o, shade=0.35)
    lip = [head_pt(0.955, math.radians(a), 0.002) for a in range(-15, -170, -22)]
    band(m, lip, [head_out(0.955, math.radians(a)) for a in range(-15, -170, -22)], 0.008, 0.002, H_HAIR, shade=0.4, faces="decal")
    # the eyes
    for sx in (1, -1):
        a = math.radians(28) if sx > 0 else math.radians(152)
        c = head_pt(0.235, a, -0.004)
        q = head_out(0.235, a).to_track_quat("Z", "Y").to_matrix().to_4x4()
        with m.at(Matrix.Translation(c) @ q):
            m.lathe([(0.032, 0.0), (0.028, 0.01), (0.016, 0.018)], 8, H_EYE, smooth=True, cap1=True,
                    uvfn=lambda p: (p.x / 0.066 + 0.5, p.y / 0.066 + 0.5))
    # the ears, pricked, cupped forward
    for sx in (1, -1):
        base = HP(sx * 0.07, 1.175, 2.225)
        tip = HP(sx * 0.105, 1.205, 2.41)
        mid = base * 0.45 + tip * 0.55 + HP(sx * 0.006, 0.02, 0)
        m.tube([base, mid, tip], [(0.042, 0.03), (0.036, 0.024), (0.004, 0.003)], 6, H_COAT, side=(1, 0, 0),
               cap0=True, cap1=True, shade=0.85, vscale=2)
        m.poly([base + HP(sx * 0.0, 0.034, 0.01), mid + HP(0, 0.03, 0), tip + HP(0, 0.006, -0.01)], H_HAIR, out=HP(0, 1, 0.2),
               shade=0.5)


def horse_hair(m):
    # the mane, full, falling to the off side (away from the man at its head)
    us = [0.1 + 0.08 * k for k in range(11)]
    rings = []
    for k, u in enumerate(us):
        jag = (0.0, 0.18, -0.12, 0.1, -0.05, 0.16, -0.1, 0.06, 0.14, -0.08, 0.0)[k]
        end = math.radians(150 + 18 * jag)
        top = [neck_pt(u, math.radians(a), o) for a, o in ((72, 0.02), (90, 0.05), (112, 0.055), (135, 0.045))]
        tip = neck_pt(u, end, 0.035) + Vector((0, 0, -0.05 - 0.05 * max(0.0, jag)))
        inner = [neck_pt(u, math.radians(a), -0.01) for a in (140, 105, 72)]
        rings.append(top + [tip] + inner)
    sheet(m, rings, H_MANE, uscale=3.0, shade=0.9)
    # the forelock between the ears, down the forehead
    ts = [-0.06, 0.02, 0.1, 0.18]
    band(m, [head_pt(t, math.pi / 2 + 0.05, 0.012 if t > 0 else 0.03) for t in ts],
         [head_out(max(t, 0.0), math.pi / 2) for t in ts], [0.1, 0.09, 0.07, 0.03], 0.02, H_MANE, vscale=3, shade=0.9)
    # the tail, thick, to the hocks
    path = [HP(0, -0.95, 1.6), HP(0, -1.035, 1.55), HP(0, -1.09, 1.42), HP(0, -1.115, 1.2), HP(0, -1.115, 0.96),
            HP(0, -1.1, 0.76), HP(0, -1.09, 0.68)]
    radii = [(0.05, 0.055), (0.058, 0.065), (0.075, 0.08), (0.09, 0.09), (0.1, 0.092), (0.09, 0.075), (0.05, 0.04)]
    m.shadefn = lambda p: 0.62 + 0.38 * min(1.0, max(0.0, (p.z - 0.7) / 0.8))
    m.tube(path, radii, 8, H_MANE, side=(1, 0, 0), cap1=True, vscale=1.4, urep=2)
    m.shadefn = None


# ---- the harness


def horse_collar(m):
    C, t, s, b = collar_frame()
    n = 14
    th = [2 * math.pi * k / n for k in range(n)]
    # the collar's body, stuffed, narrower at the top; the rim in front of it
    body = [collar_pt(a, COLLAR_A * (1 - 0.12 * max(0.0, math.sin(a))), COLLAR_B) for a in th]
    m.tube(body, [COLLAR_R] * n, 6, H_COLLAR, side=tuple(t), closed_path=True, vscale=3, urep=1)
    rim = [collar_pt(a, COLLAR_A * (1 - 0.12 * max(0.0, math.sin(a))) + 0.05, COLLAR_B + 0.05, 0.03) for a in th]
    m.tube(rim, [(0.03, 0.036)] * n, 4, H_COLLAR, side=tuple(t), closed_path=True, vscale=3, urep=1, shade=0.8)
    # the wool lining where it lies on the shoulders
    lin = [collar_pt(a, COLLAR_A * (1 - 0.12 * max(0.0, math.sin(a))) - 0.045, COLLAR_B - 0.045, -0.03) for a in th]
    m.tube(lin, [(0.028, 0.02)] * n, 3, H_CLOTH, side=tuple(t), closed_path=True, vscale=3, urep=1, shade=0.7)
    for sx in (1, -1):
        # the hame: oak, in the groove, rising above the collar to a brass knob
        a0, a1 = math.radians(-68), math.radians(70)
        path = []
        for k in range(9):
            a = a0 + (a1 - a0) * k / 8
            p = collar_pt(a, HAME_A, HAME_B, -0.005)
            path.append(Vector((sx * p.x, p.y, p.z)))
        top = path[-1]
        up = (collar_pt(math.radians(78), HAME_A, HAME_B) - collar_pt(math.radians(62), HAME_A, HAME_B)).normalized()
        up = Vector((sx * up.x, up.y, up.z))
        path += [top + up * 0.07 + Vector((sx * 0.004, 0, 0.02)), top + up * 0.12 + Vector((sx * 0.012, 0.015, 0.06))]
        m.tube(path, [(0.02, 0.026)] * (len(path) - 1) + [(0.016, 0.02)], 4, H_HAME, side=tuple(t), rot=math.pi / 4,
               cap0=True, cap1=True, vscale=2.5, urep=1, smooth=False)
        knob = path[-1] + (path[-1] - path[-2]).normalized() * 0.02
        with m.at(Matrix.Translation(knob)):
            m.lathe([(0.012, -0.03), (0.03, -0.005), (0.022, 0.022), (0.008, 0.032)], 6, H_BRASS, smooth=True, cap0=True, cap1=True)
        # brass plates where the tug and the terret are fixed
        for a in (math.radians(-34), math.radians(48)):
            p = collar_pt(a, HAME_A + 0.024, HAME_B + 0.024, -0.005)
            disc(m, Vector((sx * p.x, p.y, p.z)), Vector((sx, 0, 0)) + (b * math.sin(a)) * 0.5, 0.024, 0.008, H_BRASS, sides=4)
        # the terret the rein runs through
        p = collar_pt(math.radians(48), HAME_A + 0.05, HAME_B + 0.05, -0.005)
        torus(m, Vector((sx * p.x, p.y, p.z)), (0, 1, 0), 0.026, 0.006, H_BRASS)
        # the hame tug back to its buckle, where the trace starts
        p = collar_pt(math.radians(-34), HAME_A + 0.01, HAME_B + 0.01, -0.005)
        a = Vector((sx * p.x, p.y, p.z))
        e = HP(sx * TRACE_END[0], TRACE_END[1], TRACE_END[2])
        mid = (a + e) / 2 + Vector((sx * 0.012, 0, 0))
        band(m, [a, mid, e], [Vector((sx, 0, 0))] * 3, 0.05, 0.012, H_LEATHER, vscale=3)
        torus(m, e + Vector((sx * 0.006, 0.02, 0)), (1, 0, 0), 0.03, 0.007, H_BRASS, seg=4)
        # the hame chain from the foot of the hame to the kidney link
        foot = path[0]
        k = HP(*KIDNEY)
        for i in range(2):
            p0 = foot + (k - foot) * (i / 2)
            p1 = foot + (k - foot) * ((i + 1) / 2)
            m.beam(tuple(p0), tuple(p1), 0.016 if i % 2 else 0.006, 0.006 if i % 2 else 0.016, H_IRON, caps=True)
    # the top hame strap across the collar's top
    pa = collar_pt(math.radians(66), HAME_A + 0.01, HAME_B + 0.01, -0.005)
    pb = Vector((-pa.x, pa.y, pa.z))
    top = collar_pt(math.pi / 2, 0, HAME_B + 0.035, -0.005)
    band(m, [pa, top, pb], [b, b, b], 0.035, 0.01, H_LEATHER, vscale=3)
    torus(m, HP(*KIDNEY), (1, 0, 0), 0.04, 0.009, H_IRON, seg=8)


def horse_bridle(m):
    L = H_LEATHER
    # the headpiece behind the ears and the throatlatch under the throat
    angs = [2 * math.pi * k / 10 for k in range(10)]
    band(m, [neck_pt(0.965, a, 0.012) for a in angs], [neck_out(0.965, a) for a in angs], 0.03, 0.008, L, closed=True)
    # the browband across the forehead, a brass rosette at each end
    angs = [math.radians(a) for a in range(18, 163, 24)]
    band(m, [head_pt(0.07, a, 0.012) for a in angs], [head_out(0.07, a) for a in angs], 0.026, 0.008, L)
    for a in (math.radians(14), math.radians(166)):
        disc(m, head_pt(0.07, a, 0.018), head_out(0.07, a), 0.022, 0.012, H_BRASS)
    # a brass face piece hanging on the forehead
    disc(m, head_pt(0.16, math.pi / 2, 0.016), head_out(0.16, math.pi / 2), 0.03, 0.01, H_BRASS, sides=8)
    band(m, [head_pt(0.07, math.pi / 2, 0.02), head_pt(0.13, math.pi / 2, 0.018)], [head_out(0.1, math.pi / 2)] * 2, 0.018,
         0.006, L)
    # the noseband
    angs = [2 * math.pi * k / 10 for k in range(10)]
    band(m, [head_pt(0.69, a, 0.012) for a in angs], [head_out(0.69, a) for a in angs], 0.03, 0.008, L, closed=True)
    for sx in (1, -1):
        def A(deg):
            return math.radians(deg if sx > 0 else 180 - deg)

        # the cheekpiece from the headpiece down past the blinker to the bit
        ts = [0.02, 0.12, 0.3, 0.45, 0.6, 0.69, 0.8, 0.9, 0.93]
        angs = [A(d) for d in (8, 6, 2, -4, -10, -12, -18, -24, -28)]
        band(m, [head_pt(t, a, 0.012) for t, a in zip(ts, angs)], [head_out(t, a) for t, a in zip(ts, angs)], 0.028, 0.008, L)
        # the blinker: a cupped leather square standing off the eye, its back edge further out; a brass boss on it
        c = head_pt(0.235, A(22), 0.0)
        o = head_out(0.235, A(22))
        ax = head_sec(0.235)[1]
        up = o.cross(ax).normalized() * sx
        quad = []
        for da, du in ((-0.07, -0.05), (0.055, -0.05), (0.055, 0.05), (-0.07, 0.05)):
            lift = 0.035 + (0.035 if da < 0 else 0.0)
            quad.append(c + ax * da + up * du + o * lift)
        m.slab(quad, 0.012, L, out=o, mode="fit")
        disc(m, (quad[0] + quad[2]) / 2 + o * 0.0, o, 0.022, 0.01, H_BRASS)
        # the bit's ring at the corner of the mouth
        C, ax, W, T, B = head_sec(0.935)
        mouth = head_pt(0.935, A(-35), 0.0)
        ring = Vector((sx * (W + 0.045), mouth.y, mouth.z))
        torus(m, ring, (1, 0, 0), 0.036, 0.007, H_IRON, seg=7)
    C, ax, W, T, B = head_sec(0.935)
    mouth = head_pt(0.935, math.radians(-35), 0.0)
    m.beam((-(W + 0.045), mouth.y, mouth.z), ((W + 0.045), mouth.y, mouth.z), 0.014, 0.014, H_IRON, side=(0, 1, 0))
    # the reins: from the bit up beside the neck, through the hame's terret and the pad's terret, back to the crupper
    for sx in (1, -1):
        def A(deg):
            return math.radians(deg if sx > 0 else 180 - deg)

        C, ax, W, T, B = head_sec(0.935)
        ring = Vector((sx * (W + 0.045), mouth.y, mouth.z)) + Vector((0, 0.03, -0.02))
        hp = collar_pt(math.radians(48), HAME_A + 0.05, HAME_B + 0.05, -0.005)
        hame = Vector((sx * hp.x, hp.y, hp.z))
        pad = body_pt(0.30, A(72), 0.085)
        way = [ring, neck_pt(0.8, A(35), 0.07), neck_pt(0.55, A(40), 0.07), hame]
        pts = sagged(way, 0.05) + sagged([hame, pad], 0.03)[1:] + sagged([pad, body_pt(0.0, A(55), 0.03),
                                                                           body_pt(-0.45, A(62), 0.02)], 0.04)[1:]
        band(m, pts, [Vector((0, 0, 1))] * len(pts), 0.022, 0.006, L, vscale=3, faces="full")


def horse_pad(m):
    L = H_LEATHER
    # the back pad (the cart saddle): leather over a felted pad, a brass crest and two terrets
    fs = [0.17, 0.22, 0.38, 0.43]
    rings = []
    for f in fs:
        e = 0.55 if f in (0.17, 0.43) else 1.0
        outer = [body_pt(f, math.radians(a), 0.012 + e * 0.042 * math.sin(math.pi * (a - 28) / 124))
                 for a in range(28, 153, 20)]
        inner = [body_pt(f, math.radians(a), -0.02) for a in (148, 90, 32)]
        rings.append(outer + inner)
    m.grid(rings, L, cap0=True, cap1=True, smooth=False, urep=2, vscale=3)
    rings = [[body_pt(f, math.radians(a), o) for a, o in ((24, 0.008), (60, 0.016), (90, 0.018), (120, 0.016), (156, 0.008),
                                                          (150, -0.01), (90, -0.01), (30, -0.01))] for f in (0.15, 0.45)]
    m.grid(rings, H_CLOTH, cap0=True, cap1=True, smooth=False, urep=2, vscale=3)
    band(m, [body_pt(f, math.pi / 2, 0.056) for f in (0.2, 0.3, 0.4)], [Vector((0, 0, 1))] * 3, 0.03, 0.006, H_BRASS)
    for a in (72, 108):
        p = body_pt(0.30, math.radians(a), 0.06)
        disc(m, p, body_out(0.3, math.radians(a)), 0.016, 0.01, H_BRASS, sides=6)
        torus(m, p + body_out(0.3, math.radians(a)) * 0.034, (0, 1, 0), 0.026, 0.006, H_BRASS)
    for sx in (1, -1):
        # the back band down to the tug, the tug the shaft rests in, the belly band under to the other tug
        angs = [math.radians(a if sx > 0 else 180 - a) for a in (30, 15, 0, -12)]
        pts = [body_pt(0.30, a, 0.012) for a in angs]
        tug = HP(sx * SHAFT_TUG[0], SHAFT_TUG[1], SHAFT_TUG[2])
        pts.append(tug + Vector((sx * -0.025, 0, 0.055)))
        band(m, pts, [body_out(0.3, a) for a in angs] + [Vector((sx, 0, 0))], 0.06, 0.01, L, vscale=3)
        torus(m, tug, (0, 1, 0), 0.05, 0.012, L, seg=6, sides=4)
        disc(m, pts[-1] + Vector((sx * 0.012, 0, 0)), Vector((sx, 0, 0)), 0.02, 0.008, H_BRASS, sides=4)
    angs = [math.radians(a) for a in range(-22, -159, -17)]
    under = [body_pt(0.34, a, 0.012) for a in angs]
    band(m, under, [body_out(0.34, a) for a in angs], 0.07, 0.01, L, vscale=3)
    # the crupper down the spine to the dock, a brass ring where the hip straps meet it
    fs = [0.17, 0.0, -0.2, -0.4, -0.6, -0.78, -0.9, -0.97]
    band(m, [body_pt(f, math.pi / 2, 0.01) for f in fs], [body_out(f, math.pi / 2) for f in fs], 0.04, 0.008, L, vscale=3)
    dock = HP(0, -1.035, 1.55)
    ax = (HP(0, -1.09, 1.42) - HP(0, -0.95, 1.6)).normalized()
    torus(m, dock, ax, 0.074, 0.012, L, seg=8)
    band(m, [body_pt(-0.97, math.pi / 2, 0.01), dock + Vector((0, -0.01, 0.075))], [Vector((0, 0.3, 1))] * 2, 0.04, 0.008, L)
    torus(m, body_pt(-0.45, math.pi / 2, 0.02), (0, 0, 1), 0.035, 0.008, H_BRASS)
    # the breeching round the quarters, the hip straps holding it up
    hb = 1.19
    side = [(-0.4, 0), (-0.6, 0), (-0.8, 0), (-0.93, 0), (-0.99, 0)]
    pts = []
    for f, _ in side:
        pts.append(HP(body_half_width(f, hb) + 0.016, f, hb))
    wr = body_half_width(-1.0, hb) + 0.016
    back = [HP(wr * 0.6, -1.02, hb), HP(0.0, -1.035, hb)]
    right = pts + back
    ring = right + [Vector((-p.x, p.y, p.z)) for p in reversed(right[:-1])]
    ctr = HP(0, -0.55, hb)
    outs = [Vector((p.x - ctr.x, p.y - ctr.y, 0)).normalized() for p in ring]
    band(m, ring, outs, 0.085, 0.012, L, vscale=3)
    for f in (-0.5, -0.8):
        for sx in (1, -1):
            a1 = body_angle_at(f, hb + 0.03, sx)
            angs = [math.pi / 2 + (a1 - math.pi / 2) * k / 3 for k in range(4)]
            band(m, [body_pt(f, a, 0.012) for a in angs], [body_out(f, a) for a in angs], 0.035, 0.008, L, vscale=3)
    for sx in (1, -1):
        p = ring[0] if sx > 0 else ring[-1]
        torus(m, p + Vector((sx * 0.015, 0, 0)), (1, 0, 0), 0.03, 0.007, H_BRASS, seg=4)


def horse_body(m):
    horse_hide(m)
    horse_hair(m)
    horse_collar(m)
    horse_bridle(m)
    horse_pad(m)


# ---- the legs (built where they stand; horse() moves each part's origin to its pivot or joint)


def _leg(m, pts, cells, cap0=True, cap1=True):
    m.tube([HP(0, f, h) for f, h, _, _ in pts], [(w, d) for *_, w, d in pts], 8, cells[0], side=(1, 0, 0), mats=cells,
           cap0=cap0, cap1=cap1, vscale=1.6, urep=2)


def _hoof(m, f0):
    """The hoof round the sole's middle f0: horn sloping to the toe, the coronet high in front and low at the heels,
    the sole, the iron shoe open at the heels, and the feather falling over the back of the pastern."""
    sides = 10

    def ring(h_front, h_back, hw, fr, bk, df):
        pts = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            c, s = math.cos(a), math.sin(a)
            y = -(f0 + df) + (bk if s > 0 else fr) * s  # s > 0: back (Blender +y)
            pts.append(Vector((hw * c, y, h_back + (h_front - h_back) * (0.5 - 0.5 * s))))
        return pts

    bottom = ring(0.014, 0.014, 0.1, 0.112, 0.082, 0.004)
    rings = [bottom, ring(0.065, 0.038, 0.093, 0.092, 0.074, -0.002), ring(0.118, 0.058, 0.08, 0.07, 0.066, -0.008)]
    m.shadefn = lambda p: 0.75 + 0.25 * min(1.0, p.z / 0.1)
    m.grid(rings, H_HOOF, urep=2, vscale=5)
    m.shadefn = None
    m.poly([p + Vector((0, 0, -0.002)) for p in bottom], H_HOOF, out=(0, 0, -1), shade=0.35)
    # the shoe
    outer = [p * 1.0 for p in ring(0.0, 0.0, 0.103, 0.116, 0.084, 0.004)]
    inner = [p * 1.0 for p in ring(0.0, 0.0, 0.07, 0.082, 0.054, 0.004)]
    for i in range(sides):
        i1 = (i + 1) % sides
        am = 2 * math.pi * (i + 0.5) / sides
        if math.sin(am) > 0.8:
            continue  # open at the heels
        o0, o1, n0, n1 = outer[i], outer[i1], inner[i], inner[i1]
        up = Vector((0, 0, 0.015))
        m.face([m.vert(o0), m.vert(n0), m.vert(n1), m.vert(o1)], [(0, 0), (0, 1), (1, 1), (1, 0)], H_IRON, 0.7)
        m.face([m.vert(o0), m.vert(o1), m.vert(o1 + up), m.vert(o0 + up)], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], H_IRON, 0.9)
        m.face([m.vert(n1), m.vert(n0), m.vert(n0 + up), m.vert(n1 + up)], [(0, 0), (1, 0), (1, 0.2), (0, 0.2)], H_IRON, 0.6)


def _feather(m, f0, top_h, fa):
    """The feather: long hair from the fetlock falling over the pastern, heaviest behind, ragged at the ends."""
    sides = 12

    def ring(h, hw, fr, bk, df, jag=0.0):
        pts = []
        for i in range(sides):
            a = 2 * math.pi * i / sides
            c, s = math.cos(a), math.sin(a)
            y = -(f0 + df) + (bk if s > 0 else fr) * s
            hh = h + (jag if i % 2 else 0.0) + (0.02 if s < -0.5 else 0.0)
            pts.append(Vector((hw * c, y, hh)))
        return pts

    rings = [ring(0.045, 0.088, 0.074, 0.122, fa - 0.03, 0.03), ring(0.15, 0.08, 0.07, 0.1, fa - 0.02),
             ring(top_h, 0.07, 0.066, 0.08, fa - 0.008)]
    m.shadefn = lambda p: 0.55 + 0.45 * min(1.0, p.z / 0.25)
    m.grid(rings, H_MANE, urep=3, vscale=4)
    m.shadefn = None


def leg_front_upper(m):
    m.shadefn = lambda p: 0.66 + 0.34 * min(1.0, max(0.0, (p.z - 0.4) / 0.8))
    _leg(m, [(0.62, 1.40, 0.05, 0.06), (0.622, 1.2, 0.066, 0.08), (0.612, 1.06, 0.102, 0.126), (0.622, 0.9, 0.098, 0.112),
             (0.632, 0.75, 0.082, 0.09), (0.64, 0.635, 0.071, 0.073), (0.644, 0.57, 0.081, 0.079), (0.645, 0.5, 0.076, 0.075),
             (0.645, 0.455, 0.05, 0.05)], [H_COAT] * 5 + [H_POINTS] * 3)
    m.shadefn = None


def leg_front_lower(m):
    m.shadefn = lambda p: 0.62 + 0.38 * min(1.0, max(0.0, p.z / 0.55))
    _leg(m, [(0.645, 0.55, 0.055, 0.055), (0.645, 0.505, 0.08, 0.077), (0.645, 0.445, 0.075, 0.072), (0.638, 0.4, 0.063, 0.071),
             (0.634, 0.3, 0.061, 0.071), (0.638, 0.235, 0.073, 0.085), (0.652, 0.18, 0.066, 0.071), (0.668, 0.135, 0.064, 0.065),
             (0.674, 0.108, 0.073, 0.07)], [H_POINTS] * 8, cap1=False)
    m.shadefn = None
    _hoof(m, 0.67)
    _feather(m, 0.67, 0.26, -0.02)


def leg_hind_upper(m):
    m.shadefn = lambda p: 0.64 + 0.36 * min(1.0, max(0.0, (p.z - 0.45) / 0.8))
    _leg(m, [(-0.62, 1.38, 0.10, 0.16), (-0.63, 1.2, 0.13, 0.2), (-0.66, 1.03, 0.12, 0.19), (-0.70, 0.88, 0.1, 0.14),
             (-0.725, 0.75, 0.083, 0.106), (-0.745, 0.65, 0.082, 0.09), (-0.76, 0.58, 0.078, 0.082), (-0.765, 0.535, 0.05, 0.05)],
         [H_COAT] * 5 + [H_POINTS] * 2)
    # the point of the hock
    m.tube([HP(0, -0.79, 0.71), HP(0, -0.83, 0.645), HP(0, -0.835, 0.6)], [(0.03, 0.03), (0.034, 0.034), (0.018, 0.018)], 6,
           H_POINTS, side=(1, 0, 0), cap0=True, cap1=True, vscale=2)
    m.shadefn = None


def leg_hind_lower(m):
    m.shadefn = lambda p: 0.62 + 0.38 * min(1.0, max(0.0, p.z / 0.6))
    _leg(m, [(-0.762, 0.625, 0.055, 0.055), (-0.76, 0.58, 0.08, 0.088), (-0.752, 0.51, 0.072, 0.082), (-0.735, 0.44, 0.062, 0.075),
             (-0.715, 0.32, 0.061, 0.073), (-0.703, 0.25, 0.073, 0.085), (-0.69, 0.185, 0.066, 0.071), (-0.678, 0.135, 0.064, 0.065),
             (-0.674, 0.108, 0.073, 0.07)], [H_POINTS] * 8, cap1=False)
    m.shadefn = None
    _hoof(m, -0.67)
    _feather(m, -0.67, 0.27, -0.03)


LEG_PARTS = {"leg_front": ("front", False, leg_front_upper), "leg_front_lo": ("front", True, leg_front_lower),
             "leg_hind": ("hind", False, leg_hind_upper), "leg_hind_lo": ("hind", True, leg_hind_lower)}


def horse(part="all", atlas=True):
    """The draught horse on the team atlas. part: "all" (standing, legs and all: the prop), "body" (no legs), or a
    leg part for the game to move: "leg_front", "leg_hind" (the upper part, origin at its pivot), "leg_front_lo",
    "leg_hind_lo" (the lower part, origin at the knee or hock). Leg parts stand at x 0; the game puts them at +-x."""
    m = Mesh(ao=0.0, atlas=True)
    if part in LEG_PARTS:
        key, lower, fn = LEG_PARTS[part]
        f0, h0 = HORSE_RIG[key]["joint" if lower else "pivot"]
        with m.at(move(0, f0, -h0)):
            fn(m)
        return m
    horse_body(m)
    if part == "all":
        for sx in (1, -1):
            for key, lower, fn in LEG_PARTS.values():
                with m.at(move(sx * HORSE_RIG[key]["x"], 0, 0)):
                    fn(m)
    return m


# ---- the gait (the same as client/src/world/horseGait.ts, for the previews)

HORSE_GAITS = {"walk": (0.62, 0.16, 0.12, 0.0), "trot": (0.38, 0.26, 0.2, 0.03)}  # stance, front lift, hind lift, body lift
HORSE_LEGS = [("front", 1, 0.25, 0.0), ("front", -1, 0.75, 0.5), ("hind", 1, 0.0, 0.5), ("hind", -1, 0.5, 0.0)]


def _rig(key):
    r = dict(HORSE_RIG[key])
    (pf, ph), (jf, jh), (sf, sh) = r["pivot"], r["joint"], r["sole"]
    r["L1"], r["L2"] = math.hypot(jf - pf, jh - ph), math.hypot(sf - jf, sh - jh)
    r["rest1"], r["rest2"] = math.atan2(jf - pf, ph - jh), math.atan2(sf - jf, jh - sh)
    r["bend"] = 1 if key == "front" else -1
    return r


def _ik(pf, ph, tf, th, L1, L2, bend):
    df, dh = tf - pf, th - ph
    D = min(max(math.hypot(df, dh), abs(L1 - L2) + 1e-4), L1 + L2 - 1e-5)
    a = math.acos(max(-1.0, min(1.0, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))))
    a1 = math.atan2(df, -dh) + bend * a
    jf, jh = pf + L1 * math.sin(a1), ph - L1 * math.cos(a1)
    return a1, jf, jh, math.atan2(tf - jf, jh - th)


def horse_pose(gait, amp=1.0, trot=False, stride=None):
    """The body's lift and, per leg, (x, f, h, pitch) of the upper and the lower part (pitch > 0 swings it back)."""
    st, lf, lh, lift = HORSE_GAITS["trot" if trot else "walk"]
    S = (stride or (2.8 if trot else 1.42)) * st * amp
    legs = []
    for key, side, pw, pt in HORSE_LEGS:
        r = _rig(key)
        p = (gait + (pt if trot else pw)) % 1.0
        n = r["sole"][0]
        if p < st:
            ft, ht, w = n + S * (0.5 - p / st), 0.0, 1.0
        else:
            q = (p - st) / (1 - st)
            ft = n - S / 2 + S * q * q * (3 - 2 * q)
            ht = (lf if key == "front" else lh) * amp * math.sin(math.pi * q)
            w = max(0.0, 1 - q / 0.14, (q - 0.86) / 0.14)
        legs.append([key, side, r, ft, ht, w])
    off = lift * amp
    for L in legs:
        key, side, r, ft, ht, w = L
        a1, jf, jh, a2 = _ik(r["pivot"][0], r["pivot"][1] + off, ft, ht, r["L1"], r["L2"], r["bend"])
        d = a2 - r["rest2"]
        L[4] = ht + (r["heel"] if d > 0 else r["toe"]) * math.sin(abs(d)) * w
    for key, side, r, ft, ht, w in legs:
        Lr = (r["L1"] + r["L2"]) * 0.9995
        c = math.sqrt(max(0.0, Lr * Lr - (ft - r["pivot"][0]) ** 2)) - r["pivot"][1] + ht
        off = min(off, c + (1 - w) * 0.5)
    out = []
    for key, side, r, ft, ht, w in legs:
        pf, ph = r["pivot"]
        a1, jf, jh, a2 = _ik(pf, ph + off, ft, ht, r["L1"], r["L2"], r["bend"])
        out.append((key, side, (side * r["x"], pf, ph + off, -(a1 - r["rest1"])), (side * r["x"], jf, jh, -(a2 - r["rest2"]))))
    return off, out


def wheelbarrow():
    m = Mesh()
    wheel(m, (0, -0.62, 0.23), 0.23, 0.05, 8, 12, fel=0.04, hub=0.045, spoke=0.025)
    m.beam((-0.23, -0.62, 0.23), (0.23, -0.62, 0.23), 0.03, 0.03, IRON, side=(0, 1, 0))

    def hz(y):
        return 0.24 + (y + 0.68) / 1.63 * 0.32

    for sx in (-1, 1):
        m.beam((sx * 0.2, -0.7, hz(-0.7)), (sx * 0.29, 0.95, hz(0.95)), 0.045, 0.055, DARK)
        m.beam((sx * 0.25, 0.25, hz(0.25)), (sx * 0.26, 0.3, 0.0), 0.045, 0.045, DARK, side=(1, 0, 0))
    m.beam((-0.26, 0.3, hz(0.3) - 0.02), (0.26, 0.3, hz(0.3) - 0.02), 0.04, 0.04, DARK, side=(0, 1, 0))

    def zb(y):
        return hz(y) + 0.05

    y0, y1, H = -0.42, 0.25, 0.26
    fb, bb = (y0, zb(y0)), (y1, zb(y1))
    ft, bt = (-0.6, zb(y0) + H), (0.31, zb(y1) + H)
    m.slab([(-0.23, y0, fb[1]), (0.23, y0, fb[1]), (0.23, y1, bb[1]), (-0.23, y1, bb[1])], 0.025, WOOD, out=(0, 0, 1))
    for sx in (-1, 1):
        m.slab([(sx * 0.23, y0, fb[1]), (sx * 0.23, y1, bb[1]), (sx * 0.36, bt[0], bt[1]), (sx * 0.36, ft[0], ft[1])], 0.022, WOOD,
               out=(sx, 0, 0.4), shade=0.9)
    m.slab([(-0.23, y0, fb[1]), (0.23, y0, fb[1]), (0.36, ft[0], ft[1]), (-0.36, ft[0], ft[1])], 0.022, WOOD, out=(0, -1, 0.3), shade=0.9)
    m.slab([(-0.23, y1, bb[1]), (0.23, y1, bb[1]), (0.36, bt[0], bt[1]), (-0.36, bt[0], bt[1])], 0.022, WOOD, out=(0, 1, 0.3), shade=0.9)
    return m


def sack_truck(atlas=False):
    """Two-wheeled hand truck for sacks: a ladder frame on an iron nose, standing up."""
    m = Mesh(atlas=atlas)
    for sx in (-1, 1):
        wheel(m, (sx * 0.28, 0.1, 0.15), 0.15, 0.045, 6, 10, fel=0.035, hub=0.035, spoke=0.022)
        m.beam((sx * 0.19, -0.01, 0.02), (sx * 0.19, 0.11, 1.28), 0.045, 0.06, DARK, side=(1, 0, 0))
        m.beam((sx * 0.19, 0.11, 1.28), (sx * 0.23, 0.26, 1.38), 0.04, 0.045, DARK, side=(1, 0, 0))
        m.beam((sx * 0.19, 0.0, 0.24), (sx * 0.24, 0.1, 0.15), 0.025, 0.03, IRON, side=(1, 0, 0))
    m.beam((-0.31, 0.1, 0.15), (0.31, 0.1, 0.15), 0.03, 0.03, IRON, side=(0, 1, 0))
    for k in (0.3, 0.55, 0.8, 0.98):
        y = -0.01 + 0.12 * k
        z = 0.02 + 1.26 * k
        m.beam((-0.19, y, z), (0.19, y, z), 0.03, 0.03, DARK if k < 0.9 else IRON, side=(0, 1, 0))
    m.slab([(-0.21, -0.27, 0.018), (0.21, -0.27, 0.018), (0.21, 0.01, 0.018), (-0.21, 0.01, 0.018)], 0.018, IRON, out=(0, 0, 1))
    for sx in (-1, 1):
        m.beam((sx * 0.19, -0.2, 0.02), (sx * 0.19, 0.0, 0.3), 0.02, 0.02, IRON, side=(1, 0, 0))
    return m


def crate_detail(m, sx, sy, sz, seed=0, lid=True, broken=False, handles=True):
    """A packing crate of the 1870s, long along x: four boards a side with gaps (the dark
    inside shows through), corner battens, battens round the top and foot, a diagonal
    brace on the long sides, iron straps on the top corners, rope handles on the ends.
    lid=False: open, filled with straw; broken=True: boards missing from one side."""
    rng = random.Random(seed)
    hx, hy = sx / 2, sy / 2
    # the dark inside (seen through the gaps)
    m.box((0, 0, sz / 2), (sx - 0.05, sy - 0.05, sz - 0.03), DARK, skip=("-z",) if lid else ("-z", "+z"), shade=0.35)
    gap = 0.018
    nb = 4
    hb = (sz - gap * (nb - 1)) / nb
    lost = rng.randrange(nb) if broken else -1
    # the four sides: (corner a, corner b along the face, outward normal)
    faces = [((-hx, -hy), (hx, -hy), (0, -1)), ((hx, hy), (-hx, hy), (0, 1)), ((hx, -hy), (hx, hy), (1, 0)), ((-hx, hy), (-hx, -hy), (-1, 0))]
    for fi, ((ax, ay), (bx, by), n) in enumerate(faces):
        for k in range(nb):
            if fi == 0 and (k == lost or (broken and k == lost + 1 and lost < nb - 1 and rng.random() < 0.5)):
                continue
            z0 = k * (hb + gap)
            z1 = z0 + hb
            pts = [(ax, ay, z0), (bx, by, z0), (bx, by, z1), (ax, ay, z1)]
            m.poly(pts, CRATE, out=(n[0], n[1], 0), uvs=[(0, z0 / sz), (1, z0 / sz), (1, z1 / sz), (0, z1 / sz)])
    if lid:
        nt = max(3, round(sy / 0.22))
        wt = (sy - gap * (nt - 1)) / nt
        for k in range(nt):
            y0 = -hy + k * (wt + gap)
            y1 = y0 + wt
            m.poly([(-hx, y0, sz), (hx, y0, sz), (hx, y1, sz), (-hx, y1, sz)], CRATE, out=(0, 0, 1),
                   uvs=[(0, (y0 + hy) / sy), (1, (y0 + hy) / sy), (1, (y1 + hy) / sy), (0, (y1 + hy) / sy)])
    else:
        # packing straw, heaped a little
        rows = []
        for j in range(4):
            y = -hy + 0.03 + (sy - 0.06) * j / 3
            rows.append([(-hx + 0.03 + (sx - 0.06) * i / 4, y, sz - 0.08 + (0.07 * rng.random() if 0 < i < 4 and 0 < j < 3 else 0.0))
                         for i in range(5)])
        m.grid(rows, ROPE, closed=False, smooth=False, uvfn=lambda p: (p.x * 3, p.y * 3))
    b, o = 0.055, 0.012  # batten size, stand-off from the boards
    for cx in (-hx, hx):
        for cy in (-hy, hy):
            m.beam((cx + math.copysign(o, cx) * 0.5, cy + math.copysign(o, cy) * 0.5, 0.0),
                   (cx + math.copysign(o, cx) * 0.5, cy + math.copysign(o, cy) * 0.5, sz), b, b, WOOD, side=(1, 0, 0), caps=False, shade=0.9)
    for z in (b / 2, sz - b / 2):
        for cy in (-hy - o, hy + o):
            m.beam((-hx, cy, z), (hx, cy, z), b, 0.022, WOOD, side=(0, 1, 0), caps=False, shade=0.85)
        for cx in (-hx - o, hx + o):
            m.beam((cx, -hy, z), (cx, hy, z), b, 0.022, WOOD, side=(1, 0, 0), caps=False, shade=0.85)
    for cy in (-hy - o, hy + o):
        if broken and cy < 0:
            continue
        m.beam((-hx + b, cy, b), (hx - b, cy, sz - b), b * 0.9, 0.02, WOOD, side=(0, 1, 0), caps=False, shade=0.8)
    # iron straps over the top corners (a plate on each face next to the corner)
    so = o + 0.012
    for cx in (-1, 1):
        for cy in (-1, 1):
            x, y = cx * (hx + so), cy * (hy + so)
            z0, z1 = sz - 0.16, sz + 0.004
            m.poly([(x, y, z0), (x - cx * 0.16, y, z0), (x - cx * 0.16, y, z1), (x, y, z1)], IRON, out=(0, cy, 0), mode="fit", shade=0.9)
            m.poly([(x, y, z0), (x, y - cy * 0.16, z0), (x, y - cy * 0.16, z1), (x, y, z1)], IRON, out=(cx, 0, 0), mode="fit", shade=0.9)
    # rope handles on the ends
    if handles:
        zh = sz * 0.72
        for cx in (-1, 1):
            x = cx * (hx + o + 0.01)
            path = [(x, -0.12, zh), (x + cx * 0.04, -0.09, zh - 0.07), (x + cx * 0.05, 0.0, zh - 0.1), (x + cx * 0.04, 0.09, zh - 0.07), (x, 0.12, zh)]
            m.tube(path, [0.016] * 5, 3, ROPE, side=(0, 0, 1), cap0=False, cap1=False, vscale=5)


def crate(sx=1.0, sy=1.0, sz=1.0, seed=0, atlas=False, **kw):
    m = Mesh(atlas=atlas)
    crate_detail(m, sx, sy, sz, seed, **kw)
    return m


def crate_open(seed=21):
    """An opened crate: the lid off and leaning on its side, straw inside, a plank on the ground."""
    m = Mesh(atlas=True)
    crate_detail(m, 1.0, 0.8, 0.75, seed, lid=False)
    # the lid: boards on two battens, leaning on the long side (-y)
    with m.at(move(0.0, -0.4 - 0.32, 0.0) @ Matrix.Rotation(-0.35, 4, "X")):
        for k in range(4):
            y0 = -0.4 + k * 0.2
            m.box((0, 0.0, y0 + 0.4 + 0.09), (1.0, 0.025, 0.18), CRATE, mode="fit")
        for x in (-0.35, 0.35):
            m.box((x, 0.022, 0.4), (0.06, 0.022, 0.78), WOOD)
    return m


def crate_broken(seed=22):
    """A crate with boards stove in on one side, one of them lying in front of it."""
    m = Mesh(atlas=True)
    crate_detail(m, 1.1, 0.85, 0.8, seed, broken=True)
    with m.at(move(0.15, -0.85, 0.0) @ rot_z(0.4)):
        m.box((0, 0, 0.01), (1.05, 0.19, 0.02), CRATE, mode="fit")
    return m


def barrel(lying=False):
    m = Mesh()
    if lying:
        with m.at(move(0, 0, 0.339) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ move(0, 0, -0.475)):
            barrel_body(m)
        for sx in (-1, 1):
            for sy in (-1, 1):
                m.prism([(sx * 0.3 - 0.05, sy * 0.06, 0.0), (sx * 0.3 - 0.05, sy * 0.25, 0.0), (sx * 0.3 - 0.05, sy * 0.25, 0.12)],
                        (0.1, 0, 0), WOOD, shade=0.8, tile=0.5)
    else:
        barrel_body(m)
    return m


def sack_one():
    m = Mesh()
    sack(m, 1)
    return m


def sack_upright():
    m = Mesh()
    sack_standing(m, 2)
    return m


def sack_pile():
    m = Mesh()
    k = 0
    for i, y in enumerate((-0.5, 0.0, 0.5)):
        with m.at(move(0.02 * i, y, 0) @ rot_z(math.pi / 2 - math.pi / 2 + 0.05 * (i - 1))):
            sack(m, 40 + k)
        k += 1
    for i, y in enumerate((-0.25, 0.25)):
        with m.at(move(-0.03 + 0.05 * i, y, 0.24) @ rot_z(-0.08 + 0.12 * i) @ Matrix.Rotation(0.04 * (1 - 2 * i), 4, "X")):
            sack(m, 40 + k)
        k += 1
    with m.at(move(0.02, 0.0, 0.47) @ rot_z(0.1)):
        sack(m, 40 + k)
    return m


def rope_coil():
    m = Mesh(ao=0.0)
    r = 0.032
    pts = [(1.0, -0.42, r), (0.78, -0.47, r), (0.55, -0.4, r)]
    a0 = math.atan2(-0.36, 0.42)
    n = 31
    for k in range(n + 1):
        t = k / 12
        a = a0 + 2 * math.pi * t
        R = 0.37 - 0.03 * t
        pts.append((R * math.cos(a), R * math.sin(a), r + t * 2 * r * 0.92))
    m.shadefn = lambda p: 0.7 + 0.3 * min(1.0, p.z / 0.18)
    m.tube(pts, [r] * len(pts), 5, ROPE, side=(0, 0, 1), cap0=True, cap1=True, vscale=6)
    m.shadefn = None
    return m


def bollard():
    m = Mesh(ao=0.3)
    prof = [(0.27, 0.0), (0.27, 0.05), (0.215, 0.075), (0.205, 0.42), (0.175, 0.6), (0.15, 0.645), (0.27, 0.70), (0.285, 0.76),
            (0.23, 0.815), (0.11, 0.85)]
    m.lathe(prof, 10, IRON, cap1=True, urep=2, vscale=2)
    return m


def gas_lamp():
    """Cast-iron street lamp: fluted base, column, ladder bar, a four-sided lantern. Glass centre at 3.65 m."""
    m = Mesh(ao=0.5)
    m.lathe([(0.21, 0.0), (0.21, 0.08), (0.17, 0.12), (0.15, 0.38), (0.11, 0.46), (0.078, 0.55)], 8, IRON, smooth=False, urep=2)
    m.lathe([(0.078, 0.55), (0.07, 1.0), (0.088, 1.04), (0.07, 1.08), (0.058, 2.95), (0.08, 3.0), (0.08, 3.05), (0.05, 3.12)], 8, IRON,
            urep=2, vscale=0.5)
    m.beam((-0.33, 0, 3.12), (0.33, 0, 3.12), 0.035, 0.035, IRON, side=(0, 0, 1))
    for sx in (-1, 1):
        m.box((sx * 0.34, 0, 3.12), (0.055, 0.055, 0.055), IRON)
    m.lathe([(0.05, 3.12), (0.09, 3.28), (0.13, 3.34), (0.13, 3.36)], 8, IRON, rot=math.pi / 8, smooth=False, cap1=True)
    z0, z1, b0, b1 = 3.36, 3.94, 0.12, 0.2
    lo = [(-b0, -b0), (b0, -b0), (b0, b0), (-b0, b0)]
    hi = [(-b1, -b1), (b1, -b1), (b1, b1), (-b1, b1)]
    for i in range(4):
        a, b = lo[i], lo[(i + 1) % 4]
        c, d = hi[(i + 1) % 4], hi[i]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0)
        m.poly([(a[0], a[1], z0), (b[0], b[1], z0), (c[0], c[1], z1), (d[0], d[1], z1)], GLASS, out=mid, mode="fit", shade=1.0)
        m.beam((a[0], a[1], z0), (d[0], d[1], z1), 0.022, 0.022, IRON)
        m.beam((d[0], d[1], z1), (c[0], c[1], z1), 0.03, 0.03, IRON)
    m.poly([(x, y, z0) for x, y in lo], IRON, out=(0, 0, -1))
    rb = 0.26
    roof = [(-rb, -rb), (rb, -rb), (rb, rb), (-rb, rb)]
    m.poly([(x, y, z1 + 0.02) for x, y in roof], IRON, out=(0, 0, -1))
    for i in range(4):
        a, b = roof[i], roof[(i + 1) % 4]
        m.poly([(a[0], a[1], z1 + 0.02), (b[0], b[1], z1 + 0.02), (0, 0, z1 + 0.24)], IRON, out=((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.3))
    m.lathe([(0.035, z1 + 0.18), (0.035, z1 + 0.3), (0.065, z1 + 0.32), (0.045, z1 + 0.37), (0.012, z1 + 0.4)], 6, IRON, smooth=False, cap1=True)
    return m


def crane():
    """A hand crane of the 1860s-70s: stone plinth, cast-iron pedestal, side frames with
    winch and gearing, a curved tubular jib (the chain runs inside it), counterweight."""
    m = Mesh(ao=0.6)
    m.box((0, 0, 0.3), (2.2, 2.2, 0.6), STONE, tile=1.0)
    m.lathe([(0.55, 0.6), (0.55, 0.68), (0.42, 0.75), (0.33, 1.2), (0.40, 1.3), (0.40, 1.38)], 10, IRON, smooth=False, cap1=True, urep=2)
    m.lathe([(0.62, 1.38), (0.62, 1.48)], 10, IRON, smooth=False, cap1=True, urep=3)
    for sx in (-1, 1):
        m.slab([(sx * 0.34, 0.95, 1.48), (sx * 0.34, -0.55, 1.48), (sx * 0.34, -0.2, 3.15), (sx * 0.34, 0.38, 3.15)], 0.035, IRON,
               out=(sx, 0, 0))
    for y, z in ((0.3, 3.08), (-0.35, 1.6), (0.8, 1.6)):
        m.beam((-0.31, y, z), (0.31, y, z), 0.06, 0.06, IRON, side=(0, 1, 0))
    with m.at(move(0, 0.2, 2.05) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.2, -0.3), (0.2, 0.3)], 10, DARK, smooth=False, cap0=True, cap1=True, cap_mat=IRON)
    # spur wheel on the drum shaft, pinion and crank on the lower shaft
    teeth = [(0.0, 0.2 + (0.5 if i % 2 == 0 else 0.45) * math.cos(math.pi * i / 14), 2.05 + (0.5 if i % 2 == 0 else 0.45) * math.sin(math.pi * i / 14))
             for i in range(28)]
    m.prism([(0.39, y, z) for _, y, z in teeth], (0.05, 0, 0), IRON)
    with m.at(move(0, 0.62, 1.75) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.03, -0.46), (0.03, 0.46)], 6, IRON, smooth=False, cap0=True, cap1=True)
        m.lathe([(0.1, 0.39), (0.1, 0.45)], 8, IRON, smooth=False, cap0=True, cap1=True)
    for sx in (-1, 1):
        m.beam((sx * 0.46, 0.62, 1.75), (sx * 0.46, 0.62, 1.38), 0.05, 0.03, IRON, side=(0, 1, 0))
        m.beam((sx * 0.46, 0.62, 1.4), (sx * 0.68, 0.62, 1.4), 0.04, 0.04, DARK, side=(0, 1, 0))
    m.box((0, 1.12, 1.78), (0.8, 0.42, 0.56), IRON)
    # the jib: a curved plate tube tapering to the sheave
    P0, P1, P2 = Vector((0, -0.2, 1.62)), Vector((0, -0.7, 5.9)), Vector((0, -5.2, 6.6))
    path, radii = [], []
    for k in range(10):
        t = k / 9
        path.append((1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2)
        radii.append((0.24 - 0.13 * t, 0.28 - 0.15 * t))
    m.tube(path, radii, 8, IRON, cap0=True, cap1=True, urep=2, vscale=0.5)
    with m.at(move(0, -5.3, 6.5) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.2, -0.04), (0.2, 0.04)], 10, IRON, smooth=False, cap0=True, cap1=True)
    m.tube([(0, -5.5, 6.45), (0, -5.5, 2.3)], [0.018, 0.018], 4, IRON, cap0=True, cap1=True, vscale=4)
    m.box((0, -5.5, 2.2), (0.1, 0.14, 0.24), IRON)
    m.tube([(0, -5.5, 2.08), (0, -5.5, 1.93), (0, -5.44, 1.86), (0, -5.37, 1.9), (0, -5.36, 1.98)], [0.022] * 5, 4, IRON,
           cap0=True, cap1=True)
    return m



# ------------------------------------------------------------------ port goods (atlas)
#
# What the naties handled on the quays of the 1870s: cotton (the Katoennatie), coffee,
# hides, grain, wool, wine and petroleum in casks, timber, stone. Low poly: a quay holds
# hundreds of these, so a cask is 8-sided and its hoops are painted, not modelled.

CASK_L, CASK_R = 0.9, 0.3


def cask_lo(m, cell=A_CASK, L=CASK_L, R=CASK_R, sides=8):
    """A cask standing on its head at the origin, 8 staves round, painted hoops."""
    prof = [(R * 0.84, 0.0), (R * 0.96, L * 0.22), (R, L * 0.5), (R * 0.96, L * 0.78), (R * 0.84, L)]
    m.lathe(prof, sides, cell, urep=2, vscale=0.98 / L)
    # the heads: boards across, taken from the middle of the texture (between the hoops)
    for z, out in ((0.0, (0, 0, -1)), (L, (0, 0, 1))):
        r = R * 0.84
        pts = [(r * math.cos(2 * math.pi * i / sides), r * math.sin(2 * math.pi * i / sides), z) for i in range(sides)]
        uvs = [(0.5 + x / (2 * r) * 0.5, 0.35 + (y / (2 * r) + 0.5) * 0.3) for x, y, _ in pts]
        m.poly(pts, cell, out=out, uvs=uvs, shade=0.85)


def cask_lying(m, x, y, z, cell=A_CASK, along="y", spin=0.0):
    """A cask lying down, its middle at (x, y, z), its length along y (or x)."""
    turn = Matrix.Rotation(math.pi / 2, 4, "X") if along == "y" else Matrix.Rotation(math.pi / 2, 4, "Y")
    with m.at(move(x, y, z) @ turn @ rot_z(spin) @ move(0, 0, -CASK_L / 2)):
        cask_lo(m, cell)


def casks_row(cell=A_CASK, n=6, seed=1):
    """Casks lying side by side on two timber chocks, heads to the front and back."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    D = 2 * CASK_R + 0.03
    w = n * D
    for y in (-0.26, 0.26):
        m.beam((-w / 2, y, 0.04), (w / 2, y, 0.04), 0.1, 0.08, A_DARK, side=(0, 0, 1))
    for i in range(n):
        cask_lying(m, (i - (n - 1) / 2) * D, rng.uniform(-0.05, 0.05), CASK_R + 0.05, cell, spin=rng.uniform(0, 1))
    return m


def casks_pyramid(cell=A_CASK, tiers=(4, 3, 2, 1), seed=2):
    """Casks lying in tiers, each in the grooves of the one below (the Quai Godefroid look)."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    D = 2 * CASK_R + 0.03
    w = tiers[0] * D
    for y in (-0.26, 0.26):
        m.beam((-w / 2, y, 0.04), (w / 2, y, 0.04), 0.1, 0.08, A_DARK, side=(0, 0, 1))
    for k, n in enumerate(tiers):
        z = CASK_R + 0.05 + k * D * 0.866
        for i in range(n):
            cask_lying(m, (i - (n - 1) / 2) * D, rng.uniform(-0.04, 0.04), z, cell, spin=rng.uniform(0, 1))
    return m


def casks_standing(cell=A_CASK, seed=3):
    """Six casks on end in two rows, one lying across the top."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    D = 2 * CASK_R + 0.04
    for i in range(3):
        for j in range(2):
            with m.at(move((i - 1) * D + rng.uniform(-0.03, 0.03), (j - 0.5) * D + rng.uniform(-0.03, 0.03), 0) @ rot_z(rng.uniform(0, 1))):
                cask_lo(m, cell)
    cask_lying(m, -D / 2, 0.0, CASK_L + CASK_R, cell, along="x", spin=0.4)
    return m


def bale(m, cell=A_BALE, L=1.3, W=0.72, H=0.74, seed=0):
    """A pressed bale lying down, long along x: bagging, iron bands, the middle bulging."""
    rng = random.Random(seed)
    c = 0.08

    def ring(x, s):
        w, h = W / 2 * s, H * (0.97 + 0.03 * s)
        pts = [(-w + c, 0), (w - c, 0), (w, c), (w, h - c), (w - c, h), (-w + c, h), (-w, h - c), (-w, c)]
        return [(x, y + rng.uniform(-0.01, 0.01), z) for y, z in pts]

    rings = [ring(-L / 2, 0.92), ring(-L / 2 + 0.06, 1.0), ring(L / 2 - 0.06, 1.0), ring(L / 2, 0.92)]
    m.shadefn = lambda p: 0.75 + 0.25 * min(1.0, p.z / H)
    m.grid(rings, cell, smooth=False, uvfn=lambda p: ((p.x + L / 2) / L, (p.y + p.z) / 0.9))
    for r, out in ((rings[0], (-1, 0, 0)), (rings[-1], (1, 0, 0))):
        # the ends: bagging only, from between two bands
        m.poly(r, cell, out=out, shade=0.9, uvs=[(0.42 + 0.18 * (p[1] / W + 0.5), p[2] / H * 0.8) for p in r])
    m.shadefn = None


def bale_at(m, x, y, z, yaw=0.0, standing=False, cell=A_BALE, seed=0, L=1.3, W=0.72, H=0.74):
    if standing:
        # on end: the length goes up
        with m.at(move(x, y, z + L / 2) @ rot_z(yaw) @ Matrix.Rotation(math.pi / 2, 4, "Y") @ move(0, 0, -H / 2)):
            bale(m, cell, L, W, H, seed)
    else:
        with m.at(move(x, y, z) @ rot_z(yaw)):
            bale(m, cell, L, W, H, seed)


def bales_block(seed=4):
    """Cotton bales two high: three below lying across, two on top."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for i in range(3):
        bale_at(m, (i - 1) * 0.76, rng.uniform(-0.05, 0.05), 0, math.pi / 2 + rng.uniform(-0.04, 0.04), seed=seed + i)
    for i in range(2):
        bale_at(m, (i - 0.5) * 0.8, rng.uniform(-0.06, 0.06), 0.74, math.pi / 2 + rng.uniform(-0.08, 0.08), seed=seed + 5 + i)
    return m


def bales_row(seed=5):
    """Bales standing on end in a row, one lying across the top."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for i in range(4):
        bale_at(m, (i - 1.5) * 0.78, rng.uniform(-0.04, 0.04), 0, rng.uniform(-0.06, 0.06), standing=True, seed=seed + i)
    bale_at(m, -0.6, 0.0, 1.3, rng.uniform(-0.05, 0.05), seed=seed + 9)
    return m


def coffee_stack(seed=6, layers=5):
    """Coffee sacks stacked crosswise in a block, as in the storehouse doors."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    L, W, H = 0.72, 0.46, 0.22
    k = 0
    for layer in range(layers):
        z = layer * (H - 0.02)
        spots = [((i - 1.5) * 0.47, 0.0, math.pi / 2) for i in range(4)] if layer % 2 == 0 else \
                [((i - 0.5) * 0.9, (j - 0.5) * 0.4, 0.0) for i in range(2) for j in range(2)]
        if layer == layers - 1:
            spots = spots[:3]
        for x, y, a in spots:
            with m.at(move(x + rng.uniform(-0.02, 0.02), y + rng.uniform(-0.02, 0.02), z) @ rot_z(a + rng.uniform(-0.05, 0.05))):
                sack(m, 60 + k, L=L, W=W, H=H, nx=5, na=6, mat=A_COFFEE)
            k += 1
    return m


def grain_pile(seed=7):
    """Grain sacks lying in a pyramid, four, three, two."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    k = 0
    for tier, n in enumerate((4, 3, 2)):
        for i in range(n):
            x = (i - (n - 1) / 2) * 0.5
            with m.at(move(x + rng.uniform(-0.02, 0.02), rng.uniform(-0.04, 0.04), tier * 0.22) @ rot_z(math.pi / 2 + rng.uniform(-0.06, 0.06))):
                sack(m, 80 + k, L=0.9, W=0.52, H=0.26, nx=5, na=6, mat=A_GRAIN)
            k += 1
    return m


def hides_pile(seed=8):
    """Dried hides, folded into flat bundles and piled in two stacks, one draped over."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for sx in (-0.52, 0.52):
        z = 0.0
        for k in range(rng.choice([4, 5])):
            w, d, h = 0.95 + rng.uniform(-0.05, 0.05), 0.66 + rng.uniform(-0.04, 0.04), 0.15 + rng.uniform(-0.02, 0.03)
            a = rng.uniform(-0.12, 0.12)
            ca, sa = math.cos(a), math.sin(a)
            P = []
            for i in range(8):
                lx = (w / 2 if i & 1 else -w / 2) * (0.96 if i & 4 else 1.0)
                ly = (d / 2 if i & 2 else -d / 2) * (0.96 if i & 4 else 1.0)
                lz = z + (h + rng.uniform(-0.03, 0.03) if i & 4 else 0.0)
                P.append((sx + lx * ca - ly * sa + rng.uniform(-0.03, 0.03), lx * sa + ly * ca, lz))
            hide_bundle(m, P)
            z += h
    # one hide thrown over the left stack, hanging down its side
    top = 0.7
    rows = []
    for j, y in enumerate((-0.4, -0.13, 0.13, 0.4)):
        row = []
        for i, (x, z) in enumerate(((-1.05, 0.25), (-0.95, top), (-0.52, top + 0.06), (-0.1, top), (0.0, top - 0.3))):
            row.append((x, y + rng.uniform(-0.03, 0.03), z + rng.uniform(-0.03, 0.03)))
        rows.append(row)
    m.grid(rows, A_HIDE, closed=False, smooth=False, uvfn=lambda p: ((p.x + 1.1) / 1.2, 0.53 + (p.y + 0.45) / 0.9 * 0.44))
    return m


def hide_bundle(m, P):
    """A folded bundle of hides over 8 corners (like hexa): the layered edge on the sides
    (lower half of the hide cell), the hair side on top (upper half)."""
    P = [Vector(p) for p in P]
    vs = [m.vert(p) for p in P]
    for key, idx in HEX_FACES.items():
        if key == "-z":
            continue
        pts = [P[i] for i in idx]
        uv = planar_uv(pts, 1.0, "fit")
        if key == "+z":
            uv = [(0.05 + 0.9 * u, 0.53 + 0.44 * v) for u, v in uv]
        else:
            uv = [(u * 1.5, 0.03 + 0.44 * v) for u, v in uv]
        m.face([vs[i] for i in idx], uv, A_HIDE, 1.0, local=pts)


def crate_lo(m, sx, sy, sz, seed=0, handles=True):
    """A packing crate in a stack: the detailed crate (boards, battens, straps, rope handles)."""
    crate_detail(m, sx, sy, sz, seed, handles=handles)


def crates_stack(seed=9):
    """Crates in two layers, of three sizes."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    x = -1.45
    tops = []
    for i, (sx, sy, sz) in enumerate(((1.0, 0.85, 0.8), (1.1, 0.8, 0.7), (0.9, 0.85, 0.8))):
        with m.at(move(x + sx / 2, rng.uniform(-0.03, 0.03), 0) @ rot_z(rng.uniform(-0.05, 0.05))):
            crate_lo(m, sx, sy, sz, seed + i, handles=i != 1)
        tops.append((x + sx / 2, sz))
        x += sx + 0.04
    for i, ((cx, z), (sx, sy, sz)) in enumerate(zip(tops[:2], ((0.8, 0.6, 0.55), (0.7, 0.55, 0.5)))):
        with m.at(move(cx + 0.3, rng.uniform(-0.05, 0.05), z) @ rot_z(rng.uniform(-0.2, 0.2))):
            crate_lo(m, sx, sy, sz, seed + 5 + i, handles=False)
    return m


def stones_stack(seed=10):
    """Bluestone kerbs stacked in three layers."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for layer, n in enumerate((4, 4, 3)):
        for i in range(n):
            y = (i - (n - 1) / 2) * 0.33
            with m.at(move(rng.uniform(-0.05, 0.05), y, layer * 0.26) @ rot_z(rng.uniform(-0.03, 0.03))):
                m.box((0, 0, 0.125), (1.1, 0.3, 0.25), A_STONE, mode="fit", skip=("-z",))
    return m


def stone_blocks(seed=11):
    """Dressed quay-wall blocks: two on the ground, one on top."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for x, y, z, a in ((-0.6, 0.0, 0.0, 0.03), (0.62, 0.05, 0.0, -0.06), (0.05, 0.0, 0.55, 0.12)):
        with m.at(move(x, y + rng.uniform(-0.03, 0.03), z) @ rot_z(a)):
            m.box((0, 0, 0.275), (1.15, 0.75, 0.55), A_STONE, mode="fit", skip=("-z",))
    return m


def timber_stack(seed=12):
    """Sawn beams in three layers on bearers, sticks between the layers to let them dry."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    L = 4.2
    z = 0.0
    for layer in range(4):
        # bearers (the first on the ground) or sticks
        hb = 0.12 if layer == 0 else 0.05
        for x in (-1.7, 0.0, 1.7):
            m.box((x + rng.uniform(-0.05, 0.05), 0, z + hb / 2), (0.1, 1.3, hb), A_DARK, skip=("-z",), shade=0.8)
        z += hb
        if layer == 3:
            break
        for i in range(5):
            y = (i - 2) * 0.25
            dx = rng.uniform(-0.12, 0.12)
            m.box((dx, y, z + 0.08), (L, 0.19, 0.16), A_WOOD, skip=("-z",))
        z += 0.16
    return m


def planks_pile(seed=13):
    """Planks on two bearers, the top ones askew."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for x in (-1.2, 1.2):
        m.box((x, 0, 0.05), (0.12, 1.1, 0.1), A_DARK, skip=("-z",), shade=0.8)
    z = 0.1
    for layer in range(3):
        for i in range(3):
            y = (i - 1) * 0.3
            m.box((rng.uniform(-0.1, 0.1), y + rng.uniform(-0.02, 0.02), z + 0.0225), (3.6, 0.27, 0.045), A_WOOD, skip=("-z",))
        z += 0.045
    for a in (0.12, -0.2):
        with m.at(move(rng.uniform(-0.2, 0.2), 0, z) @ rot_z(a)):
            m.box((0, 0, 0.0225), (3.4, 0.26, 0.045), A_WOOD, skip=("-z",))
        z += 0.045
    return m


def tarp_surface(X, Y, H, seed, nu=8, nv=6):
    """Points of a tarpaulin over a heap: half sizes X, Y, height H; the rim on the ground."""
    rng = random.Random(seed)
    pts = []
    for j in range(nv + 1):
        row = []
        v = -1 + 2 * j / nv
        for i in range(nu + 1):
            u = -1 + 2 * i / nu
            e = max(abs(u), abs(v))
            f = max(0.0, 1 - e ** 5) ** 0.45
            bump = 0.0 if e > 0.99 else rng.uniform(-0.06, 0.06) + 0.05 * math.sin(u * 5 + v * 3)
            flare = 1.0 + (0.08 if e > 0.99 else 0.0)
            row.append((u * X * flare, v * Y * flare, max(0.0, H * f + bump * f)))
        pts.append(row)
    return pts


def tarp_heap_at(m, X, Y, H, seed=14, ropes=3, weights=True):
    pts = tarp_surface(X, Y, H, seed)
    nv = len(pts) - 1
    nu = len(pts[0]) - 1
    m.shadefn = lambda p: 0.7 + 0.3 * min(1.0, p.z / max(H, 0.1))
    # rows run along x; the grid wants rings, so give it the rows (open strip) bottom to top
    m.grid(pts, A_TARP, closed=False, smooth=True, uvfn=lambda p: (p.x / 1.6, p.y / 1.6))
    m.shadefn = None
    # ropes over the top, across y, tied to stones at the foot
    for k in range(ropes):
        i = round((k + 1) * nu / (ropes + 1))
        path = [(pts[j][i][0], pts[j][i][1] * 1.02, pts[j][i][2] + 0.035) for j in range(nv + 1)]
        m.tube(path, [0.022] * len(path), 3, A_ROPE, side=(1, 0, 0), vscale=4)
        if weights:
            for j in (0, nv):
                x, y, _ = pts[j][i]
                m.box((x, y * 1.08, 0.09), (0.26, 0.2, 0.18), A_STONE, mode="fit", skip=("-z",), shade=0.85)


def tarp_heap(seed=14):
    """Goods under a tarred tarpaulin, roped down to stones."""
    m = Mesh(atlas=True)
    tarp_heap_at(m, 1.45, 0.95, 1.3, seed)
    return m


def beam_scale():
    """The natie's weighing beam: two timber trestles and a top beam, an iron balance hanging
    from it, a platform on chains at the short arm with a bale on it, the poise and a pile of
    weights by the long arm."""
    m = Mesh(atlas=True, ao=0.3)
    top = 3.0
    for x in (-1.25, 1.25):
        for sy in (-1, 1):
            m.beam((x, sy * 0.85, 0.0), (x, sy * 0.06, top - 0.1), 0.14, 0.14, A_DARK, side=(1, 0, 0))
        m.beam((x, -0.6, 0.9), (x, 0.6, 0.9), 0.08, 0.1, A_DARK, side=(1, 0, 0))
    m.beam((-1.45, 0, top), (1.45, 0, top), 0.2, 0.22, A_DARK, side=(0, 1, 0))
    # the hanger and the balance: short arm to -x (the platform), long arm to +x (the poise)
    m.beam((0, 0, top - 0.11), (0, 0, 2.62), 0.05, 0.05, A_IRON, side=(1, 0, 0))
    m.beam((-0.45, 0, 2.55), (1.05, 0, 2.55), 0.08, 0.14, A_IRON, side=(0, 1, 0), w2=0.05, h2=0.07)
    m.box((0, 0, 2.58), (0.16, 0.12, 0.16), A_IRON)
    # the platform on four chains from the hook
    hook = Vector((-0.45, 0, 2.45))
    m.beam((-0.45, 0, 2.55), tuple(hook), 0.03, 0.03, A_IRON, side=(1, 0, 0))
    pz = 0.16
    for cx in (-0.5, 0.5):
        for cy in (-0.5, 0.5):
            m.beam(tuple(hook), (-0.45 + cx, cy, pz + 0.06), 0.022, 0.022, A_IRON, caps=False)
    m.box((-0.45, 0, pz), (1.1, 1.1, 0.07), A_WOOD, shade=0.9)
    for cy in (-0.4, 0.0, 0.4):
        m.box((-0.45, cy, pz - 0.06), (1.1, 0.08, 0.05), A_DARK, shade=0.7)
    bale_at(m, -0.45, 0.0, pz + 0.035, math.pi / 2 + 0.08, standing=False, seed=31)
    # the poise hanging on the long arm
    with m.at(move(0.85, 0, 0)):
        m.beam((0, 0, 2.48), (0, 0, 2.2), 0.02, 0.02, A_IRON, caps=False, side=(1, 0, 0))
        m.lathe([(0.03, 1.95), (0.11, 2.02), (0.12, 2.12), (0.06, 2.2)], 8, A_IRON, cap0=True, cap1=True, smooth=False)
    # the weights on the ground: stacked discs and two bell weights
    for k, (r, h) in enumerate(((0.16, 0.07), (0.14, 0.07), (0.12, 0.06), (0.1, 0.06))):
        with m.at(move(1.0, 0.55, sum(hh for _, hh in ((0.16, 0.07), (0.14, 0.07), (0.12, 0.06), (0.1, 0.06))[:k]))):
            m.lathe([(r, 0.0), (r, h)], 8, A_IRON, cap1=True, smooth=False)
    for x, y, r in ((0.65, 0.62, 0.1), (0.72, 0.35, 0.08)):
        with m.at(move(x, y, 0)):
            m.lathe([(r, 0.0), (r * 1.05, r * 0.9), (r * 0.6, r * 1.6), (r * 0.25, r * 1.9), (r * 0.25, r * 2.2)], 6, A_IRON,
                    cap1=True, smooth=False)
    return m


def weigh_scale():
    """A decimal platform scale (the bascule of the naties): a low platform, the column with its
    beam and weight pan at the back, a sack being weighed."""
    m = Mesh(atlas=True, ao=0.3)
    m.box((0, 0.0, 0.1), (0.95, 0.75, 0.2), A_DARK, skip=("-z",), shade=0.8)
    m.box((0, -0.03, 0.22), (0.85, 0.62, 0.04), A_WOOD)
    # the column at the back (+y), the beam across on top, the pan hanging at its end
    m.beam((0, 0.33, 0.2), (0, 0.33, 1.15), 0.12, 0.1, A_DARK, side=(1, 0, 0))
    m.beam((-0.3, 0.33, 1.2), (0.42, 0.33, 1.2), 0.05, 0.05, A_IRON, side=(0, 1, 0))
    m.box((0, 0.33, 1.2), (0.08, 0.08, 0.1), A_IRON)
    m.beam((0.4, 0.33, 1.18), (0.4, 0.33, 0.85), 0.015, 0.015, A_IRON, caps=False, side=(1, 0, 0))
    with m.at(move(0.4, 0.33, 0)):
        m.lathe([(0.02, 0.8), (0.12, 0.84), (0.12, 0.86)], 8, A_IRON, cap0=True, smooth=False)
        m.lathe([(0.05, 0.86), (0.05, 0.92)], 6, A_IRON, cap1=True, smooth=False)
    with m.at(move(-0.05, -0.05, 0.24) @ rot_z(0.3)):
        sack_standing(m, 41)
    return m


def sack_truck_sacks():
    """A sack truck standing ready with a sack on its nose, a second sack leaning on it."""
    m = sack_truck(atlas=True)
    with m.at(move(0, -0.13, 0.03) @ Matrix.Rotation(-0.1, 4, "X")):
        sack_standing(m, 42)
    with m.at(move(0.55, -0.1, 0) @ rot_z(0.9)):
        sack_standing(m, 43)
    return m


def ladder_lean():
    """A ladder leaning on a wall behind it (+y); its foot to the front."""
    m = Mesh(atlas=True)
    foot, top_y, top_z = -0.5, 0.42, 3.6
    for sx in (-0.23, 0.23):
        m.beam((sx, foot, 0.0), (sx, top_y, top_z), 0.06, 0.07, A_WOOD)
    for k in range(1, 11):
        t = k / 11
        y = foot + (top_y - foot) * t
        m.beam((-0.23, y, top_z * t), (0.23, y, top_z * t), 0.035, 0.035, A_DARK, side=(0, 1, 0), caps=False)
    return m


def planks_lean(seed=15):
    """Planks and a gangway board stood up against a wall behind them (+y)."""
    m = Mesh(atlas=True)
    rng = random.Random(seed)
    for i, x in enumerate((-0.55, -0.25, 0.05, 0.4)):
        top = 2.6 + rng.uniform(-0.3, 0.5)
        w = 0.28 if i < 3 else 0.45
        foot = -0.45 - rng.uniform(0, 0.15)
        m.beam((x, foot, 0.0), (x + rng.uniform(-0.08, 0.08), 0.35, top), w, 0.045, A_WOOD, side=(1, 0, 0))
    return m


# ------------------------------------------------------------------ traffic parts (atlas)
# The game moves these (client/src/world/traffic.ts): the dray's bed, its fore-carriage that
# turns with the horse, two wheel pairs that roll, a load, the horse's body and its four legs.


def tr_load(kind):
    """A load on the dray's bed (origin under the rear axle, like the bed; bed top at 1.05 m)."""
    m = Mesh(atlas=True)
    rng = random.Random(len(kind))
    z0 = 1.06
    yc = -1.15  # middle of the load area
    if kind == "casks":
        for i, y in enumerate((-2.45, -1.8, -1.15, -0.5, 0.15)):
            cask_lying(m, 0, y, z0 + CASK_R, A_PETROL if i % 2 else A_CASK, along="x", spin=rng.uniform(0, 1))
        for y in (-2.12, -0.82):
            cask_lying(m, 0.05, y, z0 + CASK_R + 0.53, A_CASK, along="x", spin=rng.uniform(0, 1))
    elif kind == "sacks":
        k = 0
        for tier, (n, x0) in enumerate(((6, 0.0), (5, 0.0), (3, 0.0))):
            for i in range(n):
                for sx in ((-0.43, 0.43) if tier < 2 else (0.0,)):
                    y = yc + (i - (n - 1) / 2) * 0.5
                    with m.at(move(sx + rng.uniform(-0.03, 0.03), y, z0 + tier * 0.22) @ rot_z(rng.uniform(-0.08, 0.08))):
                        sack(m, 100 + k, L=0.84, W=0.48, H=0.25, nx=5, na=6, mat=A_GRAIN if tier else A_COFFEE)
                    k += 1
    elif kind == "bales":
        for i, y in enumerate((-2.55, -1.8, -1.05, -0.3)):
            bale_at(m, rng.uniform(-0.04, 0.04), y, z0, rng.uniform(-0.05, 0.05), seed=110 + i)
        for i, y in enumerate((-2.15, -1.4)):
            bale_at(m, 0.0, y, z0 + 0.74, rng.uniform(-0.1, 0.1), seed=120 + i)
    elif kind == "tarp":
        with m.at(move(0, yc, z0)):
            tarp_heap_at(m, 0.88, 1.6, 0.95, seed=130, ropes=3, weights=False)
    return m


BUILDERS = [
    ("handcart", lambda: handcart(False)),
    ("handcart_loaded", lambda: handcart(True)),
    ("dray", lambda: dray(False)),
    ("dray_hitched", lambda: dray(True)),
    ("horse", horse),
    ("wheelbarrow", wheelbarrow),
    ("sack_truck", sack_truck),
    ("crate", lambda: crate(1.0, 1.0, 1.0, 1)),
    ("crate_small", lambda: crate(0.7, 0.5, 0.48, 2)),
    ("barrel", lambda: barrel(False)),
    ("barrel_lying", lambda: barrel(True)),
    ("sack", sack_one),
    ("sack_standing", sack_upright),
    ("sack_pile", sack_pile),
    ("rope_coil", rope_coil),
    ("bollard", bollard),
    ("gas_lamp", gas_lamp),
    ("crane", crane),
    # port goods (one atlas material)
    ("casks_row", lambda: casks_row(A_CASK, 6, 1)),
    ("casks_pyramid", lambda: casks_pyramid(A_CASK, (4, 3, 2, 1), 2)),
    ("casks_standing", lambda: casks_standing(A_CASK, 3)),
    ("petrol_row", lambda: casks_row(A_PETROL, 6, 11)),
    ("petrol_pyramid", lambda: casks_pyramid(A_PETROL, (5, 4, 3), 12)),
    ("bales_block", bales_block),
    ("bales_row", bales_row),
    ("coffee_stack", coffee_stack),
    ("grain_pile", grain_pile),
    ("hides_pile", hides_pile),
    ("crates_stack", crates_stack),
    ("stones_stack", stones_stack),
    ("stone_blocks", stone_blocks),
    ("timber_stack", timber_stack),
    ("planks_pile", planks_pile),
    ("tarp_heap", tarp_heap),
    ("beam_scale", beam_scale),
    ("weigh_scale", weigh_scale),
    ("sack_truck_sacks", sack_truck_sacks),
    ("ladder_lean", ladder_lean),
    ("crate_open", crate_open),
    ("crate_broken", crate_broken),
    ("crate_seat", lambda: crate(0.5, 0.4, 0.45, 24, atlas=True, handles=False)),
    ("crate_big", lambda: crate(1.0, 1.0, 1.0, 25, atlas=True)),
    ("planks_lean", planks_lean),
    # traffic parts (one atlas material; client/src/world/traffic.ts moves them)
    ("tr_dray_bed", lambda: dray(True, "bed", atlas=True)),
    ("tr_dray_fore", lambda: dray(True, "fore", atlas=True)),
    ("tr_wheels_rear", lambda: dray(True, "wheels_rear", atlas=True)),
    ("tr_wheels_front", lambda: dray(True, "wheels_front", atlas=True)),
    ("tr_load_casks", lambda: tr_load("casks")),
    ("tr_load_sacks", lambda: tr_load("sacks")),
    ("tr_load_bales", lambda: tr_load("bales")),
    ("tr_load_tarp", lambda: tr_load("tarp")),
    ("tr_horse_body", lambda: horse("body", atlas=True)),
    ("tr_leg_front", lambda: horse("leg_front", atlas=True)),
    ("tr_leg_hind", lambda: horse("leg_hind", atlas=True)),
    ("tr_leg_front_lo", lambda: horse("leg_front_lo", atlas=True)),
    ("tr_leg_hind_lo", lambda: horse("leg_hind_lo", atlas=True)),
    ("tr_handcart", lambda: handcart(False, "body", atlas=True)),
    ("tr_handcart_wheels", lambda: handcart(False, "wheels", atlas=True)),
    ("tr_handcart_load", lambda: handcart(True, "load", atlas=True)),
]

GOODS_NAMES = ["casks_row", "casks_pyramid", "casks_standing", "petrol_row", "petrol_pyramid", "bales_block", "bales_row",
               "coffee_stack", "grain_pile", "hides_pile", "crates_stack", "stones_stack", "stone_blocks", "timber_stack",
               "planks_pile", "tarp_heap", "beam_scale", "weigh_scale", "sack_truck_sacks", "ladder_lean", "planks_lean",
               "crate_open", "crate_broken", "crate_seat", "crate_big"]


def house_doors():
    """Front doors of the city's houses, as build_city.py puts them (the middle bay of
    the front wall, BAY 3 m), so the game can keep props out of doorways. Read from
    shared/city_build.json (tools/city/plan.py); rebuild the props after the city."""
    src = os.path.join(ROOT, "shared", "city_build.json")
    if not os.path.exists(src):
        return []
    out = []
    for h in json.load(open(src))["houses"]:
        if h.get("gone"):
            continue  # (pulled down: the churches freed, 2026-09-26)
        if h["rect"]:
            if not h["street"][0]:
                continue
            (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
            s0, s1 = h["s"]
            t0 = h["t"][0]
            a = (ox + ux * s0 + nx * t0, oz + uz * s0 + nz * t0)
            b = (ox + ux * s1 + nx * t0, oz + uz * s1 + nz * t0)
        else:
            fp = h["fp"]
            n = len(fp)
            lens = [math.hypot(fp[(i + 1) % n][0] - fp[i][0], fp[(i + 1) % n][1] - fp[i][1]) * h["street"][i] for i in range(n)]
            i = max(range(n), key=lambda k: lens[k])
            if lens[i] <= 2:
                continue
            a, b = fp[i], fp[(i + 1) % n]
        bays = max(1, round(math.hypot(b[0] - a[0], b[1] - a[1]) / 3.0))
        f = (bays // 2 + 0.5) / bays
        out += [round(a[0] + (b[0] - a[0]) * f, 1), round(a[1] + (b[1] - a[1]) * f, 1)]
    return out + poort_points()


def poort_points():
    """The covered passages through the ground storey of some front houses (city_build.json "poort",
    tools/city/alleys.py; build_city.py builds them): a point at each mouth and every 2 m through the
    passage, kept clear like a door, so nothing stands in the way in or in the passage."""
    src = os.path.join(ROOT, "shared", "city_build.json")
    if not os.path.exists(src):
        return []
    out = []
    for h in json.load(open(src))["houses"]:
        pt = h.get("poort")
        if not pt or not h["rect"] or h.get("gone"):
            continue
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        sm = (pt["s"][0] + pt["s"][1]) / 2
        t0, t1 = h["t"]
        n = max(1, round((t1 - t0) / 2.0))
        for k in range(n + 1):
            t = t0 + (t1 - t0) * k / n
            out += [round(ox + ux * sm + nx * t, 1), round(oz + uz * sm + nz * t, 1)]
    return out


def store_fronts():
    """The street fronts of the storehouses (shared/city_build.json, "store"), with their loading
    gates as build_city.py puts them (every 9 m from 4.5 m in, 2.6 m wide), so the game can stack
    goods along the walls between the gates. One entry: [ax, az, bx, bz, outx, outz, g1, g2, ...]
    (gate positions as metres along a->b)."""
    src = os.path.join(ROOT, "shared", "city_build.json")
    if not os.path.exists(src):
        return []
    out = []
    for h in json.load(open(src))["houses"]:
        if not h.get("store") or not h["rect"] or h.get("gone"):
            continue
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s0, s1 = h["s"]
        t0, t1 = h["t"]

        def P(s, t):
            return [round(ox + ux * s + nx * t, 2), round(oz + uz * s + nz * t, 2)]

        # the four walls: front (gates), the far side, the two ends; out = away from the house
        walls = [(P(s0, t0), P(s1, t0), (-nx, -nz), 0), (P(s1, t0), P(s1, t1), (ux, uz), 1),
                 (P(s1, t1), P(s0, t1), (nx, nz), 2), (P(s0, t1), P(s0, t0), (-ux, -uz), 3)]
        for a, b, o, i in walls:
            if not h["street"][i]:
                continue
            gates = []
            if i == 0:
                k = s0 + 4.5
                while k < s1 - 3:
                    gates.append(round(k - s0, 2))
                    k += 9.0
            out.append(a + b + [o[0], o[1]] + gates)
    return out


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------ preview


def preview_materials():
    for mt in bpy.data.materials:
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
        if mt.name in ("goods", "goods_team"):
            # the atlas as the game reads it: (cell + fract(uv)) / N, rows counted from the top
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

            u = math_node("DIVIDE", math_node("ADD", sc.outputs["X"], sf.outputs["X"]), ATLAS_N)
            row = math_node("SUBTRACT", ATLAS_N - 1, sc.outputs["Y"])
            v = math_node("DIVIDE", math_node("ADD", row, sf.outputs["Y"]), ATLAS_N)
            cmb = nt.nodes.new("ShaderNodeCombineXYZ")
            nt.links.new(u, cmb.inputs["X"])
            nt.links.new(v, cmb.inputs["Y"])
            nt.links.new(cmb.outputs["Vector"], tex.inputs["Vector"])


def stage():
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("fog")
    world.color = (0.2, 0.22, 0.24)
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.24, 0.26, 0.29, 1)
        bg.inputs[1].default_value = 0.9
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
    gm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.09, 0.09, 0.085, 1)
    ground.materials.append(gm)
    g = bpy.data.objects.new("ground", ground)
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
    print(f"[build_props] preview -> {path}")


def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def preview_rows(objs):
    cam = stage()
    back = ["crane", "gas_lamp", "dray_hitched", "dray", "handcart_loaded", "handcart"]
    front = ["wheelbarrow", "sack_truck", "crate", "crate_small", "barrel", "barrel_lying", "sack", "sack_standing", "sack_pile",
             "rope_coil", "bollard"]
    turned = {"dray", "dray_hitched", "handcart", "handcart_loaded", "wheelbarrow", "horse"}
    for row, names, gap in ((5.0, back, 1.2), (-1.0, front, 0.5)):
        x = 0.0
        placed = []
        for n in names:
            o = objs[n]
            o.rotation_euler = (0, 0, math.radians(-90 if n in turned else (160 if n == "crane" else -25)))
            bpy.context.view_layer.update()
            lo, hi = bounds([o])
            extra = []
            if n == "dray_hitched":
                h = objs["horse"]
                h.rotation_euler = o.rotation_euler
                h.location = Matrix.Rotation(math.radians(-90), 4, "Z") @ Vector((0, DRAY_HORSE_Y, 0))
                bpy.context.view_layer.update()
                extra = [h]
                lo, hi = bounds([o, h])
            w = hi.x - lo.x
            dx = x - lo.x
            o.location.x += dx
            o.location.y += row
            for e in extra:
                e.location.x += dx
                e.location.y += row
            x += w + gap
            placed.append(n)
        for n in names:
            objs[n].location.x -= x / 2
            if n == "dray_hitched":
                objs["horse"].location.x -= x / 2
    bpy.context.view_layer.update()
    aim(cam, (1.0, -17.0, 7.0), (0.0, 3.0, 1.6), lens=26)
    render(SHOT, (1920, 1080))


def preview_goods(objs):
    """The port goods in rows, and the traffic parts put together as the game does."""
    for o in objs.values():
        o.hide_render = True
    cam = stage()
    rows = [["casks_row", "casks_pyramid", "casks_standing", "petrol_row", "petrol_pyramid", "bales_block", "bales_row"],
            ["coffee_stack", "grain_pile", "hides_pile", "crates_stack", "stones_stack", "stone_blocks", "tarp_heap"],
            ["timber_stack", "planks_pile", "beam_scale", "weigh_scale", "sack_truck_sacks", "ladder_lean", "planks_lean"],
            ["crate", "crate_small", "crate_open", "crate_broken", "crate_seat", "crates_stack"]]
    for r, names in enumerate(rows):
        x = 0.0
        for n in names:
            o = objs[n]
            o.hide_render = False
            o.rotation_euler = (0, 0, math.radians(-20))
            bpy.context.view_layer.update()
            lo, hi = bounds([o])
            o.location.x += x - lo.x
            o.location.y += 7.0 - r * 4.6
            x += hi.x - lo.x + 0.9
        for n in names:
            objs[n].location.x -= x / 2
    bpy.context.view_layer.update()
    aim(cam, (0.5, -17.0, 8.0), (0.0, 1.5, 0.9), lens=24)
    render(os.path.join(ROOT, "data", "shots", "goods_preview.png"), (1920, 1080))
    for n in [k for rr in rows for k in rr]:
        objs[n].hide_render = True
    # the traffic: a dray with each load and its horse, legs in a walk, and a handcart
    cam.location = (0, 0, 0)
    parts = []

    def put(name, x, y, z, rz=0.0, rx=0.0):
        src = objs[name]
        o = src.copy()
        bpy.context.scene.collection.objects.link(o)
        o.hide_render = False
        o.location = (x, y, z)
        o.rotation_euler = (rx, 0, rz)
        parts.append(o)
        return o

    for k, load in enumerate(("casks", "sacks", "bales", "tarp")):
        x0 = (k - 1.5) * 3.2
        rear = 1.2
        front = rear - (DRAY_REAR_Y - DRAY_FRONT_Y)
        put("tr_dray_bed", x0, rear, 0)
        put("tr_load_" + load, x0, rear, 0)
        put("tr_wheels_rear", x0, rear, 0.52, rx=0.3 * k)
        put("tr_dray_fore", x0, front, 0)
        put("tr_wheels_front", x0, front, 0.42, rx=0.5 * k)
        hy = front + (DRAY_HORSE_Y - DRAY_FRONT_Y)
        put_horse(objs, x0, hy, gait=0.13 * k, amp=1.0, parts=parts)
    put("tr_handcart", 8.2, 0.0, 0)
    put("tr_handcart_wheels", 8.2, 0.0, HANDCART_R, rx=0.4)
    put("tr_handcart_load", 8.2, 0.0, 0)
    bpy.context.view_layer.update()
    aim(cam, (9.5, -9.0, 4.2), (1.2, -1.0, 1.0), lens=24)
    render(os.path.join(ROOT, "data", "shots", "goods_traffic.png"), (1920, 1080))
    for o in parts:
        o.hide_render = True
    # one heap of each in close-up, as the game's camera sees them at eye height
    for name, az in (("casks_pyramid", -30.0), ("bales_block", 30.0), ("beam_scale", -40.0), ("tarp_heap", 25.0), ("coffee_stack", -30.0),
                     ("hides_pile", 35.0)):
        closeup(objs, [name], os.path.join(ROOT, "data", "shots", f"goods_{name}.png"), az)


def put_horse(objs, x, y, gait=0.0, amp=0.0, trot=False, rz=0.0, parts=None):
    """Copies of the horse's parts posed as the game poses them (horse_pose), the horse's middle at (x, y) (Blender),
    turned by rz about z. Returns the copies."""
    out = []

    def put(name, loc, rx):
        o = objs[name].copy()
        bpy.context.scene.collection.objects.link(o)
        o.hide_render = False
        R = Matrix.Rotation(rz, 4, "Z")
        o.location = Vector((x, y, 0)) + R @ Vector(loc)
        o.rotation_euler = (0, 0, 0)
        o.matrix_world = Matrix.Translation(o.location) @ R @ Matrix.Rotation(rx, 4, "X")
        out.append(o)

    off, legs = horse_pose(gait, amp, trot)
    put("tr_horse_body", (0, 0, off), 0.0)
    for key, side, up, lo in legs:
        name = "tr_leg_front" if key == "front" else "tr_leg_hind"
        put(name, tuple(HP(up[0], up[1], up[2])), up[3])
        put(name + "_lo", tuple(HP(lo[0], lo[1], lo[2])), lo[3])
    if parts is not None:
        parts.extend(out)
    return out


def horse_sheets(objs, out_dir):
    """The horse close up (side, front, back, head, harness) and a walk and a trot in 8 frames each (one sheet each)."""
    for o in objs.values():
        o.hide_render = True
    cam = stage()
    sc = bpy.context.scene
    os.makedirs(out_dir, exist_ok=True)
    std = objs["horse"]
    std.hide_render = False
    std.location = (0, 0, 0)
    views = {"side": ((-4.6, 0.2, 1.6), (0, 0.1, 1.15), 35), "front": ((-2.2, -3.6, 1.9), (0, -0.4, 1.3), 35),
             "back": ((2.4, 3.8, 2.0), (0, 0.3, 1.1), 35), "head": ((-1.3, -2.3, 2.2), (0, -1.25, 1.85), 50),
             "harness": ((-2.3, -0.6, 2.4), (0, -0.2, 1.45), 40), "legs": ((-2.6, -1.0, 0.6), (0, 0.0, 0.45), 35)}
    for name, (loc, target, lens) in views.items():
        aim(cam, loc, target, lens)
        render(os.path.join(out_dir, f"horse_{name}.png"), (960, 720))
    std.hide_render = True
    for trot in (False, True):
        tiles = []
        for k in range(8):
            parts = []
            put_horse(objs, 0, 0, gait=k / 8, amp=1.0, trot=trot, parts=parts)
            aim(cam, (-5.2, 0.0, 1.0), (0, 0.0, 0.85), 35)
            p = os.path.join(out_dir, f"_frame{k}.png")
            render(p, (480, 360))
            img = bpy.data.images.load(p)
            a = np.array(img.pixels[:], dtype=np.float32).reshape(360, 480, 4)
            bpy.data.images.remove(img)
            os.remove(p)
            tiles.append(a)
            for o in parts:
                bpy.data.objects.remove(o)
        rows = [np.concatenate(tiles[r * 4:(r + 1) * 4], axis=1) for r in (1, 0)]
        sheet = np.concatenate(rows, axis=0)
        im = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
        im.pixels.foreach_set(sheet.ravel())
        im.filepath_raw = os.path.join(out_dir, "horse_trot.png" if trot else "horse_walk.png")
        im.file_format = "PNG"
        im.save()
        print(f"[build_props] sheet -> {im.filepath_raw}")
    del sc

def closeup(objs, names, path, az=-35.0):
    cam = stage()
    sel = [objs[n] for n in names]
    for o in objs.values():
        o.hide_render = o not in sel
    if "dray_hitched" in names and "horse" in names:
        objs["horse"].location = (0, DRAY_HORSE_Y, 0)
    bpy.context.view_layer.update()
    lo, hi = bounds(sel)
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    a = math.radians(az)
    d = r * 2.4
    aim(cam, (c.x + d * math.sin(a), c.y - d * math.cos(a), c.z + d * 0.45), c, lens=35)
    render(path, (1280, 800))


# ------------------------------------------------------------------ main


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    objs = {}
    for name, fn in BUILDERS:
        objs[name] = fn().to_object(name)
    counts = {n: tris(o) for n, o in objs.items()}
    doors = bpy.data.objects.new("house_doors", None)
    doors["doors"] = json.dumps(house_doors(), separators=(",", ":"))
    bpy.context.scene.collection.objects.link(doors)
    stores = bpy.data.objects.new("store_fronts", None)
    stores["fronts"] = json.dumps(store_fronts(), separators=(",", ":"))
    bpy.context.scene.collection.objects.link(stores)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_props] {n:16s} {c:5d} tris")
    print(f"[build_props] {len(json.loads(doors['doors'])) // 2} house doors kept for the game")
    print(f"[build_props] {len(json.loads(stores['fronts']))} storehouse walls for the goods")
    print(f"[build_props] {len(objs)} props, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv or "--closeup" in argv or "--goods" in argv or "--horse" in argv:
        preview_materials()
    if "--goods" in argv:
        preview_goods(objs)
    if "--preview" in argv:
        preview_rows(objs)
    if "--horse" in argv:
        horse_sheets(objs, argv[argv.index("--horse") + 1])
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = argv[i + 1].split(",")
        az = float(argv[i + 3]) if len(argv) > i + 3 else -35.0
        closeup(objs, names, argv[i + 2], az)


if __name__ == "__main__":
    main()
