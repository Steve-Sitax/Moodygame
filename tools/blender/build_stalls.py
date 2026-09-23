"""Market stalls and shop-front tables of Antwerp, 1873, modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_stalls.py
    blender -b --factory-startup -P tools/blender/build_stalls.py -- --preview

Writes client/public/models/stalls.glb (Draco). One node per object, real scale in
metres, static meshes. The customer (street) side looks toward -Y in Blender, which
is +Z in the game (glTF is Y-up).

Two frames:
  stall_*  origin on the ground at the centre of the stall. The table top is at
           0.85 m, 2.4 m wide (x) by 1.1 m deep. stall_frame (posts, rails, table,
           sign) always shows; by day add stall_awning and one stall_goods_*; by night
           swap in stall_awning_rolled and stall_tarp.
  shop_*   origin on the house wall line (game z = 0), centred in x; the street is
           +z. The table top is at 0.8 m, 1.6 m wide, from z 0.25 to 0.95. shop_table
           always shows; by day shop_awning and one shop_goods_*; by night
           shop_awning_rolled and shop_tarp.
  crates_goods stands on its own (origin at the centre of its 0.6 m footprint).

Everything here is our own work: the shapes are built from code, the textures are
painted by the functions below (64x64 awnings and tarp, a 128x128 goods atlas of
32 px cells, a 64x32 sign; nearest filter). No downloaded models or images. The
mesh helpers and the twelve street-prop materials (wood, wood_dark, iron, rope,
sackcloth, ...) come from build_props.py, so they match props.glb. Extra materials:
awning_red, awning_blue (same UV layout, so the game may swap one for the other),
tarpaulin, market_goods (the atlas), stall_sign. The vertex colour "Col" carries a baked
shade (darker near the ground and underneath); the game multiplies it into the
texture, as in props.glb. Thin cloth (awnings, valances) is built with both faces,
so single-sided materials are fine.

Each root node carries extras: "footprint" (JSON: minX, maxX, minZ, maxZ, height, in
the node's own game frame; x/z from parts under 1.5 m, or the whole object with
"overhead": true when nothing is that low) and, on the tables, "top" (table height).

--preview renders a contact sheet to data/shots/stalls_preview.png.
"""

import json
import math
import os
import random
import sys
import tempfile

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_props as bp  # noqa: E402  (mesh helpers, painters, the prop materials)
from build_props import Mesh, col, move, rot_z, speckle, vnoise  # noqa: E402
from build_props import DARK, IRON, ROPE, SACK, WOOD  # noqa: E402

ROOT = bp.ROOT
OUT = os.path.join(ROOT, "client", "public", "models", "stalls.glb")
SHOT = os.path.join(ROOT, "data", "shots", "stalls_preview.png")

EXTRA = ["awning_red", "awning_blue", "tarpaulin", "market_goods", "stall_sign"]
MATS = bp.MATS + EXTRA
RED, BLUE, TARP, GOODS, SIGN = range(len(bp.MATS), len(MATS))

# ------------------------------------------------------------------ dimensions (Blender: front = -Y)

STALL_TOP = 0.85
STALL_HX, STALL_HY = 1.2, 0.55  # table half sizes
PX, PY = 1.34, 0.65  # post centres
POST = 0.07
AWN_FRONT_Y, AWN_BACK_Y = -0.92, 0.72  # canvas edges
AWN_FRONT_Z, AWN_BACK_Z = 1.9, 2.2
AWN_HX = 1.42

SHOP_TOP = 0.8
SHOP_CY = -0.6  # table centre (game z 0.6)
SHOP_HX, SHOP_HY = 0.8, 0.35
SHOP_AWN_HX = 1.3
SHOP_WALL_Z, SHOP_FRONT_Z, SHOP_FRONT_Y = 2.5, 2.1, -1.3


def canvas_z(y):
    """Top of the open stall canvas along its slope (no sag)."""
    return AWN_FRONT_Z + (y - AWN_FRONT_Y) * (AWN_BACK_Z - AWN_FRONT_Z) / (AWN_BACK_Y - AWN_FRONT_Y)


def shop_canvas_z(y):
    return SHOP_WALL_Z + (y + 0.02) * (SHOP_WALL_Z - SHOP_FRONT_Z) / (-0.02 - SHOP_FRONT_Y)


# ------------------------------------------------------------------ textures

S = 64


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def paint_awning(seed, stripe):
    """Striped awning canvas: 4 stripes across u (25 cm at 1 m per tile), rain streaks along v."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    cream = col((0.74, 0.69, 0.57))
    img = np.where(((uu // 16) % 2 == 0)[..., None], col(stripe), cream)
    for u in (0, 16, 32, 48):
        img[:, u] *= 0.8  # seams
    img *= np.where((uu + vv) % 2 == 0, 1.04, 0.96)[..., None]
    img *= (0.84 + 0.26 * vnoise(rng, S, 4, 6))[..., None]
    img *= (0.86 + 0.18 * vnoise(rng, S, 24, 2))[..., None]
    return speckle(img, rng, 0.03, 0.75, 0.92)


def paint_tarpaulin(seed):
    """Tarred canvas, brownish grey: tar blotches, creases, one sewn patch."""
    rng = np.random.default_rng(seed)
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    img = np.ones((S, S, 3)) * col((0.25, 0.225, 0.19))
    tar = np.clip((vnoise(rng, S, 5, 5) - 0.52) * 4, 0, 1)[..., None]
    img = img * (1 - 0.45 * tar)
    img *= (0.8 + 0.35 * vnoise(rng, S, 16, 16))[..., None]
    crease = (np.abs(((uu + vv * 0.7) % 23) - 11) < 0.6) | (np.abs(((uu * 0.5 - vv) % 29) - 14) < 0.5)
    img[crease] *= 0.72
    p = (uu >= 36) & (uu < 54) & (vv >= 8) & (vv < 24)
    img[p] = img[p] * 0.7 + col((0.3, 0.27, 0.21)) * 0.3
    edge = p & ((uu == 36) | (uu == 53) | (vv == 8) | (vv == 23)) & ((uu + vv) % 2 == 0)
    img[edge] = col((0.12, 0.11, 0.09))
    return speckle(img, rng, 0.05, 0.65, 0.9)


GLYPHS = {
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
}


def paint_sign(seed):
    """A painted stall board, 64x32: dark green, cream border, the stall number 'N 17'."""
    rng = np.random.default_rng(seed)
    w, h = 64, 32
    img = np.ones((h, w, 3)) * col((0.13, 0.21, 0.15))
    img *= (0.8 + 0.3 * vnoise(rng, 64, 32, 4)[:h])[..., None]
    img[16] *= 0.6  # the joint between the two boards
    cream = col((0.8, 0.74, 0.58))
    img[2, 2:-2] = img[-3, 2:-2] = cream
    img[2:-2, 2] = img[2:-2, -3] = cream

    def glyph(g, x0, top, sc=2):
        for r, row in enumerate(GLYPHS[g]):
            for c, ch in enumerate(row):
                if ch == "1":
                    y = top - r * sc
                    img[y - sc + 1:y + 1, x0 + c * sc:x0 + (c + 1) * sc] = cream

    glyph("N", 8, 22)
    # the small raised "o" of the number sign
    img[18:23, 20:25] = cream
    img[19:22, 21:24] = col((0.13, 0.21, 0.15))
    img[14:16, 20:25] = cream  # the bar under it
    glyph("1", 29, 22)
    glyph("7", 42, 22)
    chip = rng.random((h, w)) < 0.12
    img[chip] = img[chip] * 0.6 + col((0.13, 0.21, 0.15)) * 0.4
    return speckle(img, rng, 0.05, 0.7, 0.9)


# goods atlas: 128x128, cells of 32 px, rows counted from the bottom of the image
AT = 128
CELLS = {}
for _r, _row in enumerate([["herring", "cod", "eel", "ice"], ["crust", "rye", "cabbage", "leek"],
                           ["potato", "apple", "pear", "wicker"], ["tin", None, None, "linen"]]):
    for _c, _n in enumerate(_row):
        if _n:
            CELLS[_n] = (_c * 32, _r * 32, 32, 32)
CELLS["blue"], CELLS["green"] = (32, 96, 16, 32), (48, 96, 16, 32)
CELLS["red"], CELLS["ochre"] = (64, 96, 16, 32), (80, 96, 16, 32)
FRUIT_SUB = (3 / 31, 13 / 31, 3 / 31, 13 / 31)  # the single fruit painted at (8, 8) in apple and pear


def grid32():
    return np.meshgrid(np.arange(32, dtype=float), np.arange(32, dtype=float))


def p_herring(rng):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col((0.1, 0.11, 0.12)) * (0.8 + 0.3 * vnoise(rng, 32, 8, 8))[..., None]
    for row, cv in enumerate((28, 20, 12, 4)):
        flip = -1 if row % 2 else 1
        for k in range(-1, 4):
            cu = k * 11 + (row % 2) * 5 + 3 + rng.uniform(-1, 1)
            du = (uu - cu) * flip
            dv = vv - cv - rng.uniform(-0.4, 0.4)
            e = (du / 7.5) ** 2 + (dv / 3.3) ** 2
            body = e < 1
            t = smooth((dv / 3.3 + 1) / 2)[..., None]
            c = col((0.66, 0.69, 0.72)) * (1 - t) + col((0.2, 0.26, 0.33)) * t
            c = c * (1 + 0.12 * (1 - np.abs(dv) / 3.3))[..., None]
            img[body] = c[body]
            tail = (du > 6.5) & (du < 10) & (np.abs(dv) < (du - 6.2) * 0.9)
            img[tail] = col((0.34, 0.37, 0.4))
            gill = body & (np.abs(du + 3.5) < 0.5) & (np.abs(dv) < 2.4)
            img[gill] *= 0.7
            eye = (np.abs(du + 5.2) < 0.6) & (np.abs(dv - 0.6) < 0.6)
            img[eye] = col((0.03, 0.03, 0.03))
    salt = rng.random((32, 32)) < 0.035
    img[salt] = col((0.86, 0.88, 0.9))
    return img


def p_cod(rng):
    uu, vv = grid32()
    t = smooth((vv - 6) / 22)[..., None]
    img = col((0.8, 0.81, 0.78)) * (1 - t) + col((0.2, 0.23, 0.22)) * t
    n = vnoise(rng, 32, 8, 8)
    img[(n > 0.58) & (vv > 15)] *= 0.62
    img[(vv == 16)] = col((0.85, 0.85, 0.8))
    img[(np.abs(uu - 7) < 0.6) & (vv > 7) & (vv < 27)] *= 0.62
    img[(np.abs(uu - 3) < 1.6) & (np.abs(vv - 18) < 1.6)] = col((0.75, 0.72, 0.6))
    img[(np.abs(uu - 3) < 0.9) & (np.abs(vv - 18) < 0.9)] = col((0.02, 0.02, 0.02))
    img[uu > 27] *= 0.8
    img *= (0.88 + 0.2 * vnoise(rng, 32, 16, 16))[..., None]
    return img


def p_eel(rng):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col((0.17, 0.15, 0.08)) * (0.8 + 0.4 * vnoise(rng, 32, 8, 8))[..., None]
    val = np.sin(uu * 0.55 + 3.5 * np.sin(vv * 0.33) + 1.5 * np.sin(vv * 0.9))
    img[val < -0.55] = col((0.05, 0.045, 0.03))
    img[val > 0.82] = col((0.33, 0.31, 0.22))
    return img


def p_ice(rng):
    img = np.ones((32, 32, 3)) * col((0.66, 0.73, 0.77)) * (0.8 + 0.3 * vnoise(rng, 32, 8, 8))[..., None]
    img[rng.random((32, 32)) < 0.14] = col((0.9, 0.93, 0.95))
    img[rng.random((32, 32)) < 0.05] = col((0.42, 0.5, 0.56))
    return img


def p_crust(rng):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col((0.6, 0.37, 0.16)) * (0.8 + 0.35 * vnoise(rng, 32, 6, 6))[..., None]
    k = (uu + vv * 0.8) % 11
    img[k < 1.5] = col((0.82, 0.65, 0.38))
    img[(k >= 1.5) & (k < 2.5)] *= 0.7
    img[rng.random((32, 32)) < 0.04] = col((0.85, 0.8, 0.7))
    return img


def p_rye(rng):
    img = np.ones((32, 32, 3)) * col((0.3, 0.19, 0.1)) * (0.8 + 0.35 * vnoise(rng, 32, 6, 6))[..., None]
    dust = (vnoise(rng, 32, 4, 4) > 0.55) & (rng.random((32, 32)) < 0.45)
    img[dust] = img[dust] * 0.4 + col((0.72, 0.67, 0.6)) * 0.6
    uu, vv = grid32()
    img[np.abs(np.sin(uu * 0.4 + vv * 0.15) * 6 - vv * 0.3 + 2) < 0.35] *= 0.6
    return img


def p_cabbage(rng):
    uu, vv = grid32()
    r = np.hypot(uu - 15.5, vv - 15.5)
    a = np.arctan2(vv - 15.5, uu - 15.5)
    t = np.clip(r / 17, 0, 1)[..., None]
    img = col((0.62, 0.72, 0.46)) * (1 - t) + col((0.28, 0.43, 0.21)) * t
    vein = np.abs(np.sin(a * 4.5 + r * 0.08)) < 0.13
    img[vein] = img[vein] * 0.4 + col((0.8, 0.85, 0.64)) * 0.6
    for rr in (8.5, 12.5):
        edge = np.abs(r - rr - 0.8 * np.sin(a * 7)) < 0.6
        img[edge] *= 0.75
    img *= (0.88 + 0.22 * vnoise(rng, 32, 8, 8))[..., None]
    return img


def p_leek(rng):
    uu, vv = grid32()
    img = np.zeros((32, 32, 3))
    white, pale, green = col((0.86, 0.85, 0.76)), col((0.56, 0.66, 0.4)), col((0.2, 0.34, 0.17))
    t1 = smooth((vv - 11) / 5)[..., None]
    t2 = smooth((vv - 17) / 4)[..., None]
    img[:] = white * (1 - t1) + pale * t1
    img = img * (1 - t2) + green * t2
    img[:2] = col((0.45, 0.4, 0.32))
    img[(vv > 16) & (uu % 4 == 0)] *= 0.72
    img[(vv < 12) & (vv > 2) & (uu % 5 == 0)] *= 0.9
    img *= (0.9 + 0.18 * vnoise(rng, 32, 8, 16))[..., None]
    return img


def p_blobs(rng, base, bg, first=(8.0, 8.0), r0=5.5, spots=None, cheek=None, grid=5, rr=(3.4, 4.6)):
    """Round fruit or potatoes packed in a heap; the first one sits at `first` (for single fruit)."""
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col(bg) * (0.8 + 0.3 * vnoise(rng, 32, 8, 8))[..., None]
    centres = []
    step = 32 / grid
    for i in range(grid + 1):
        for j in range(grid + 1):
            centres.append((i * step + rng.uniform(-1.3, 1.3), j * step + rng.uniform(-1.3, 1.3), rng.uniform(*rr)))
    rng.shuffle(centres)
    centres.append((first[0], first[1], r0))
    for cu, cv, r in centres:
        d = np.hypot(uu - cu, vv - cv) / r
        m = d < 1
        tone = rng.uniform(0.85, 1.1)
        c = np.ones((32, 32, 3)) * col(base) * tone
        if cheek is not None:
            ang = rng.uniform(0, 2 * math.pi)
            side = ((uu - cu) * math.cos(ang) + (vv - cv) * math.sin(ang)) / r
            k = smooth(side * 1.5)[..., None] * rng.uniform(0.3, 0.9)
            c = c * (1 - k) + col(cheek) * k
        c *= (1 - 0.35 * np.clip(d - 0.6, 0, 1) / 0.4)[..., None]
        img[m] = c[m]
        hl = (np.abs(uu - (cu - r * 0.35)) < 0.8) & (np.abs(vv - (cv + r * 0.35)) < 0.8)
        img[hl & m] = img[hl & m] * 0.4 + 0.6 * np.minimum(col(base) * 1.6 + 0.15, 1)
    if spots is not None:
        sp = rng.random((32, 32)) < 0.06
        img[sp] = img[sp] * 0.5 + col(spots) * 0.5
    return img


def p_wicker(rng):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col((0.5, 0.38, 0.2))
    horiz = ((uu // 4 + vv // 4) % 2 == 0)
    b = np.where(horiz, 0.72 + 0.4 * np.sin(np.pi * ((vv % 4) + 0.5) / 4), 0.72 + 0.4 * np.sin(np.pi * ((uu % 4) + 0.5) / 4))
    img *= b[..., None]
    img *= (0.85 + 0.25 * vnoise(rng, 32, 8, 8))[..., None]
    return speckle(img, rng, 0.05)


def p_tin(rng):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col((0.5, 0.51, 0.53)) * (0.85 + 0.3 * vnoise(rng, 32, 16, 2))[..., None]
    img[(vv == 1) | (vv == 30)] *= 0.55
    lab = (vv >= 8) & (vv < 24)
    img[lab] = col((0.74, 0.68, 0.52))
    img[(vv >= 13) & (vv < 19)] = col((0.52, 0.1, 0.08))
    txt = ((vv == 10) | (vv == 21)) & (rng.random((32, 32)) < 0.6)
    img[txt] = col((0.2, 0.16, 0.12))
    img *= (0.9 + 0.15 * vnoise(rng, 32, 8, 8))[..., None]
    return img


def p_cloth(rng, base, pattern):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col(base)
    img *= np.where((uu + vv) % 2 == 0, 1.05, 0.95)[..., None]
    if pattern == "check":
        img[(uu % 8 < 2)] *= 0.72
        img[(vv % 8 < 2)] *= 0.72
    elif pattern == "plaid":
        img[(uu % 8 == 0) | (vv % 8 == 0)] *= 0.55
        img[(uu % 8 == 4) | (vv % 8 == 4)] = img[(uu % 8 == 4) | (vv % 8 == 4)] * 0.5 + 0.3
    elif pattern == "stripe":
        img[(uu % 16 == 5)] = img[(uu % 16 == 5)] * 0.5 + 0.25
    img *= (0.85 + 0.25 * vnoise(rng, 32, 2, 6))[..., None]
    return speckle(img, rng, 0.03, 0.75, 0.9)


def p_linen(rng):
    uu, vv = grid32()
    img = np.ones((32, 32, 3)) * col((0.78, 0.75, 0.65))
    img *= np.where((uu + vv) % 2 == 0, 1.04, 0.96)[..., None]
    for k in (3, 4, 27, 28):
        img[:, k] = col((0.22, 0.28, 0.45))
        img[k, :] = col((0.22, 0.28, 0.45))
    img *= (0.88 + 0.18 * vnoise(rng, 32, 3, 3))[..., None]
    return img


def paint_goods(seed):
    rng = np.random.default_rng(seed)
    A = np.zeros((AT, AT, 3))
    cells = {
        "herring": p_herring(rng), "cod": p_cod(rng), "eel": p_eel(rng), "ice": p_ice(rng),
        "crust": p_crust(rng), "rye": p_rye(rng), "cabbage": p_cabbage(rng), "leek": p_leek(rng),
        "potato": p_blobs(rng, (0.56, 0.43, 0.26), (0.2, 0.15, 0.09), spots=(0.3, 0.22, 0.12), grid=5, rr=(3.2, 4.3)),
        "apple": p_blobs(rng, (0.6, 0.12, 0.08), (0.18, 0.06, 0.04), cheek=(0.62, 0.52, 0.16)),
        "pear": p_blobs(rng, (0.62, 0.6, 0.24), (0.2, 0.17, 0.07), spots=(0.45, 0.33, 0.15), cheek=(0.66, 0.42, 0.16)),
        "wicker": p_wicker(rng), "tin": p_tin(rng), "linen": p_linen(rng),
        "blue": p_cloth(rng, (0.14, 0.18, 0.34), "stripe"), "green": p_cloth(rng, (0.22, 0.32, 0.2), "plain"),
        "red": p_cloth(rng, (0.5, 0.13, 0.1), "check"), "ochre": p_cloth(rng, (0.62, 0.47, 0.22), "plaid"),
    }
    for n, (x0, y0, w, h) in CELLS.items():
        A[y0:y0 + h, x0:x0 + w] = cells[n][:h, :w]
    return A


def make_materials():
    bp.make_materials()
    paint = {
        "awning_red": lambda: paint_awning(201, (0.55, 0.19, 0.14)),
        "awning_blue": lambda: paint_awning(202, (0.2, 0.28, 0.44)),
        "tarpaulin": lambda: paint_tarpaulin(203),
        "market_goods": lambda: paint_goods(204),
        "stall_sign": lambda: paint_sign(205),
    }
    for name in EXTRA:
        if name in bpy.data.materials:
            raise ValueError(f"material name {name} is taken by build_props.py; rename it here")
        img = bp.image(f"{name}_tex", paint[name]())
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ uv and mesh helpers


def cuv(cell, s, t, sub=None):
    """A point (s, t in 0..1) of an atlas cell, kept half a pixel inside it."""
    x0, y0, w, h = CELLS[cell]
    if sub:
        s = sub[0] + (sub[1] - sub[0]) * s
        t = sub[2] + (sub[3] - sub[2]) * t
    s = min(1.0, max(0.0, s))
    t = min(1.0, max(0.0, t))
    return ((x0 + 0.5 + s * (w - 1)) / AT, (y0 + 0.5 + t * (h - 1)) / AT)


def uv_plan(cell, cx, cy, rx, ry, sub=None):
    """Projected from above onto a cell, the box cx +- rx, cy +- ry filling it."""
    return lambda p: cuv(cell, (p.x - cx) / (2 * rx) + 0.5, (p.y - cy) / (2 * ry) + 0.5, sub)


def uv_round(cell, h, sub=None):
    """Round things: s by the angle about +z (mirrored, so no seam), t by height."""
    return lambda p: cuv(cell, abs(math.atan2(p.y, p.x)) / math.pi, p.z / h, sub)


class shading:
    """Set m.shadefn (a function of the local point) for a block."""

    def __init__(self, m, fn):
        self.m, self.fn = m, fn

    def __enter__(self):
        self.old = self.m.shadefn
        self.m.shadefn = self.fn

    def __exit__(self, *a):
        self.m.shadefn = self.old


def bottom_dark(h, lo=0.72):
    return lambda p: lo + (1 - lo) * min(1.0, max(0.0, p.z / h))


def sheet(m, rows, mat, uvfn, under=0.7, smooth=True):
    """Thin cloth seen from both sides: the rows' faces (normals by the row order), then reversed."""
    m.grid(rows, mat, closed=False, smooth=smooth, uvfn=uvfn)
    m.grid([r[::-1] for r in rows], mat, closed=False, smooth=smooth, uvfn=uvfn, shade=under)


def abox(m, sx, sy, sz, cell, shade=1.0, bottom=False):
    """A box standing on z=0 with every face mapped onto one atlas cell."""
    hx, hy = sx / 2, sy / 2
    faces = [
        ([(-hx, -hy, sz), (hx, -hy, sz), (hx, hy, sz), (-hx, hy, sz)], (0, 0, 1), lambda p: (p.x / sx + 0.5, p.y / sy + 0.5)),
        ([(-hx, -hy, 0), (hx, -hy, 0), (hx, -hy, sz), (-hx, -hy, sz)], (0, -1, 0), lambda p: (p.x / sx + 0.5, p.z / sz)),
        ([(-hx, hy, 0), (hx, hy, 0), (hx, hy, sz), (-hx, hy, sz)], (0, 1, 0), lambda p: (p.x / sx + 0.5, p.z / sz)),
        ([(-hx, -hy, 0), (-hx, hy, 0), (-hx, hy, sz), (-hx, -hy, sz)], (-1, 0, 0), lambda p: (p.y / sy + 0.5, p.z / sz)),
        ([(hx, -hy, 0), (hx, hy, 0), (hx, hy, sz), (hx, -hy, sz)], (1, 0, 0), lambda p: (p.y / sy + 0.5, p.z / sz)),
    ]
    if bottom:
        faces.append(([(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0)], (0, 0, -1), lambda p: (p.x / sx + 0.5, p.y / sy + 0.5)))
    for pts, out, f in faces:
        uvs = [cuv(cell, *f(Vector(p))) for p in pts]
        m.poly(pts, GOODS, out=out, shade=shade, uvs=uvs)


def lathe_x(m, x0, y, z, length):
    """Frame for a lathe lying along +X: local z runs from x0 to x0 + length."""
    return move(x0, y, z) @ Matrix.Rotation(math.pi / 2, 4, "Y")


def lathe_y(m, x, y0, z):
    """Frame for a lathe lying along -Y from y0: local z runs toward -Y, local y is up."""
    return move(x, y0, z) @ Matrix.Rotation(math.pi / 2, 4, "X")


def to_object(m, name):
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
    return ob


# ------------------------------------------------------------------ small goods


def open_crate(m, sx, sy, h, fill, heap=0.02, t=0.018):
    """A low open crate of boards, full: the fill is a heaped 3x3 grid on one atlas cell."""
    with shading(m, bottom_dark(h, 0.75)):
        m.box((0, -(sy / 2 - t / 2), h / 2), (sx, t, h), WOOD, tile=0.6, skip=("-z",))
        m.box((0, sy / 2 - t / 2, h / 2), (sx, t, h), WOOD, tile=0.6, skip=("-z",))
        for s in (-1, 1):
            m.box((s * (sx / 2 - t / 2), 0, h / 2), (t, sy - 2 * t, h), WOOD, tile=0.6, skip=("-z",))
    ix, iy = sx / 2 - t, sy / 2 - t
    z0 = h - 0.028
    rows = []
    for fy in (-1, 0, 1):
        rows.append([(fx * ix, fy * iy, z0 + heap * (1.0 if fx == 0 and fy == 0 else 0.45 if fx * fy == 0 else 0.0)) for fx in (-1, 0, 1)])
    m.grid(rows, GOODS, closed=False, smooth=True, uvfn=uv_plan(fill, 0, 0, ix, iy))


def basket(m, R, H, fill, mound=0.035, sides=7):
    """A round wicker basket heaped with `fill`; returns the heap's top height."""
    with shading(m, bottom_dark(H, 0.7)):
        m.lathe([(0.78 * R, 0.0), (R, H), (0.9 * R, H)], sides, GOODS, smooth=False,
                uvfn=lambda p: cuv("wicker", abs(math.atan2(p.y, p.x)) / math.pi, min(p.z, H) / H * 0.7))
    m.lathe([(0.9 * R, H - 0.01), (0.55 * R, H + 0.7 * mound), (0.2 * R, H + mound)], sides, GOODS, cap1=True,
            uvfn=uv_plan(fill, 0, 0, 0.9 * R, 0.9 * R))
    return H + mound


def ball(m, r, cell, h=None, sides=6, sub=None, top=0.5, shade=None):
    """A round thing on z=0 (fruit, cabbage, round loaf): flat bottom, widest low, domed top."""
    h = h or 2 * r
    with shading(m, shade or bottom_dark(h, 0.7)):
        m.lathe([(0.55 * r, 0.0), (r, 0.42 * h), (top * r, h)], sides, GOODS, cap1=True, uvfn=uv_plan(cell, 0, 0, r, r, sub))


def loaf(m, L, W, H, cell="crust"):
    """A long loaf along x on z=0."""
    a = L / 2
    with shading(m, bottom_dark(H, 0.7)):
        m.lathe([(0.92 * a, 0.0), (a, 0.3 * H), (0.8 * a, 0.78 * H), (0.42 * a, H)], 6, GOODS, sy=W / L, cap1=True,
                uvfn=uv_plan(cell, 0, 0, a, W / 2))


def fish(m, L, D, T, cell="cod"):
    """A fish lying on its side along x, head at -x, back toward +y, on z=0."""
    xs, ry, rz = (-0.5, -0.3, 0.12, 0.36), (0.3, 1.0, 0.8, 0.22), (0.45, 1.0, 0.75, 0.3)
    path = [(x * L, 0.0, 0.866 * k * T) for x, k in zip(xs, rz)]
    radii = [(a * D, b * T) for a, b in zip(ry, rz)]
    uvfn = lambda p: cuv(cell, p.x / L + 0.5, p.y / (2 * D) + 0.5)  # noqa: E731
    m.tube(path, radii, 6, GOODS, side=(0, 1, 0), cap0=True, cap1=True, uvfn=uvfn)
    x0, x1, zt = 0.34 * L, 0.54 * L, 0.3 * T
    fin = [(x0, -0.22 * D, zt), (x1, -0.85 * D, 0.004), (x1, 0.85 * D, 0.004), (x0, 0.22 * D, zt)]
    uvs = [cuv(cell, 0.95, 0.5), cuv(cell, 1.0, 0.1), cuv(cell, 1.0, 0.9), cuv(cell, 0.95, 0.5)]
    m.poly(fin, GOODS, out=(0, 0, 1), uvs=uvs)
    m.poly(fin, GOODS, out=(0, 0, -1), uvs=uvs, shade=0.7)


def eel(m, R, H, ang, reach=0.2, r=0.016, bend=0.5):
    """An eel from the heap in a basket (centre at the origin) over the rim onto the table."""
    d = Vector((math.cos(ang), math.sin(ang), 0))
    s = Vector((-d.y, d.x, 0))
    prof = [(0.04, H + 0.02, 0), (0.12, H + 0.036, 0), (R + 0.012, H + 0.028, 0), (R + 0.045, H - 0.03, 0),
            (R + 0.07, H - 0.1, 0.01), (R + 0.1, 0.7 * r, 0.03 * bend), (R + reach, 0.7 * r, 0.08 * bend)]
    path = [d * a + s * c + Vector((0, 0, z)) for a, z, c in prof]
    m.tube(path, [r] * len(path), 4, GOODS, side=(0, 0, 1), rot=math.pi / 4, cap0=True, cap1=True,
           uvfn=lambda p: cuv("eel", 0.5 + 0.45 * math.sin(9 * (p.x + p.y)), 0.2 + 0.6 * abs(math.sin(5 * (p.x - p.y)))))


def ice_tray(m, sx, sy, fishes, L=0.45):
    """A dark board tray with crushed ice and fish lying across it (heads to the customer)."""
    with shading(m, bottom_dark(0.03, 0.7)):
        m.box((0, 0, 0.015), (sx, sy, 0.03), DARK, tile=0.8, skip=("-z",))
    rows = []
    for fy in (-1, 0, 1):
        rows.append([(fx * (sx / 2 - 0.02), fy * (sy / 2 - 0.02), 0.031 + (0.012 if fy == 0 and abs(fx) < 0.5 else 0.004))
                     for fx in (-1, -0.33, 0.33, 1)])
    m.grid(rows, GOODS, closed=False, uvfn=uv_plan("ice", 0, 0, sx / 2, sy / 2))
    for x, y, yaw, ln in fishes:
        with m.at(move(x, y, 0.036) @ rot_z(math.pi / 2 + yaw)):
            fish(m, ln, 0.06 * ln / 0.5, 0.017)


def rope_ring(m, R, r, z0=0.0, sides=3, pts=7):
    """One flat turn of rope (a torus) lying on z0."""
    path = [(R * math.cos(2 * math.pi * k / pts), R * math.sin(2 * math.pi * k / pts), z0 + r * 0.5) for k in range(pts)]
    m.tube(path, [r] * pts, sides, ROPE, side=(0, 0, 1), rot=2 * math.pi / 3, closed_path=True, vscale=6)


def tin_can(m, R=0.045, H=0.1):
    with shading(m, bottom_dark(H, 0.8)):
        m.lathe([(R, 0.0), (R, H)], 7, GOODS, cap1=True, smooth=True,
                uvfn=lambda p: cuv("tin", abs(math.atan2(p.y, p.x)) / math.pi, p.z / H))


def iron_pot(m, R=0.12, H=0.13):
    with shading(m, bottom_dark(H, 0.75)):
        m.lathe([(0.75 * R, 0.0), (R, 0.25 * H), (R, H), (0.9 * R, H), (0.9 * R, 0.25 * H)], 7, IRON, smooth=False, urep=2)
    m.poly([(0.9 * R * math.cos(2 * math.pi * k / 7), 0.9 * R * math.sin(2 * math.pi * k / 7), 0.25 * H) for k in range(7)],
           IRON, out=(0, 0, 1), shade=0.55)
    for s in (-1, 1):
        m.box((s * (R + 0.012), 0, H * 0.82), (0.03, 0.05, 0.02), IRON)


def lantern(m):
    """A hand lantern for sale: iron base, horn panes, a pyramid roof, a ring handle."""
    m.box((0, 0, 0.0125), (0.13, 0.13, 0.025), IRON, skip=("-z",))
    with m.at(move(0, 0, 0.025)):
        abox(m, 0.105, 0.105, 0.17, "ice", shade=0.9)
    z = 0.195
    base = [(-0.07, -0.07, z), (0.07, -0.07, z), (0.07, 0.07, z), (-0.07, 0.07, z)]
    m.poly(base, IRON, out=(0, 0, -1), shade=0.6)
    for i in range(4):
        a, b = base[i], base[(i + 1) % 4]
        m.poly([a, b, (0, 0, z + 0.07)], IRON, out=((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.3))
    m.box((0, 0, z + 0.075), (0.03, 0.03, 0.04), IRON, skip=("-z",))
    m.tube([(-0.04, 0, z + 0.09), (-0.03, 0, z + 0.14), (0.03, 0, z + 0.14), (0.04, 0, z + 0.09)], [0.006] * 4, 3, IRON,
           side=(0, 1, 0))


def brush(m):
    """A scrubbing brush lying bristles down."""
    with m.at(move(0, 0, 0)):
        m.box((0, 0, 0.0125), (0.16, 0.055, 0.025), ROPE, shade=0.8, skip=("-z",))
        m.box((0, 0, 0.037), (0.18, 0.068, 0.024), DARK, skip=("-z",))


def bolt(m, x, y0, L, R, z, cell, along_y=True):
    """A roll of cloth lying on the table (bottom flat), along -Y from y0 (or along +X from x)."""
    uvfn = lambda p: cuv(cell, p.z / L, abs(math.atan2(p.y, p.x)) / math.pi)  # noqa: E731
    capuv = lambda p: cuv(cell, 0.5 + 0.5 * p.x / R, 0.5 + 0.5 * p.y / R)  # noqa: E731
    frame = lathe_y(m, x, y0, z) if along_y else lathe_x(m, x, y0, z, L)
    with m.at(frame):
        m.grid([[(R * math.cos(math.pi / 8 + 2 * math.pi * i / 8), R * math.sin(math.pi / 8 + 2 * math.pi * i / 8), zz)
                 for i in range(8)] for zz in (0.0, L)], GOODS, uvfn=uvfn)
        ring = [(R * math.cos(math.pi / 8 + 2 * math.pi * i / 8), R * math.sin(math.pi / 8 + 2 * math.pi * i / 8), 0.0) for i in range(8)]
        m.poly(ring, GOODS, out=(0, 0, -1), uvs=[capuv(Vector(p)) for p in ring])
        ring = [(p[0], p[1], L) for p in ring]
        m.poly(ring, GOODS, out=(0, 0, 1), uvs=[capuv(Vector(p)) for p in ring])


def cloth_drape(m, x0, x1, y_in, edge_y, drop, cell, z=0.004, shade=1.0):
    """A cloth lying on the table from y_in to the front edge and hanging `drop` down its front."""
    yf = edge_y - 0.006
    tf = 0.2
    def uv(x, t):
        return cuv(cell, (x - x0) / (x1 - x0), t)
    top = [(x0, yf, z), (x1, yf, z), (x1, y_in, z), (x0, y_in, z)]
    m.poly(top, GOODS, out=(0, 0, 1), shade=shade, uvs=[uv(x0, tf), uv(x1, tf), uv(x1, 1), uv(x0, 1)])
    flap = [(x0, yf - 0.004, -drop), (x1, yf - 0.004, -drop), (x1, yf, z), (x0, yf, z)]
    m.poly(flap, GOODS, out=(0, -1, 0), shade=shade * 0.85, uvs=[uv(x0, 0), uv(x1, 0), uv(x1, tf), uv(x0, tf)])


# ------------------------------------------------------------------ goods sets (table-local, then placed)


def table_frame(big):
    return move(0, 0, STALL_TOP) if big else move(0, SHOP_CY, SHOP_TOP)


def goods_fish(big):
    m = Mesh(ao=0.0)
    with m.at(table_frame(big)):
        if big:
            with m.at(move(-0.72, 0.2, 0) @ rot_z(0.04)):
                open_crate(m, 0.62, 0.4, 0.1, "herring")
            with m.at(move(-0.66, -0.25, 0) @ rot_z(-0.05)):
                open_crate(m, 0.62, 0.4, 0.1, "herring")
            with m.at(move(0.12, -0.04, 0) @ rot_z(0.03)):
                ice_tray(m, 0.72, 0.5, [(-0.21, 0.0, 0.08, 0.44), (0.0, 0.01, -0.05, 0.46), (0.21, -0.01, 0.1, 0.42)])
            with m.at(move(0.84, 0.17, 0)):
                top = basket(m, 0.19, 0.16, "eel", mound=0.03)
                eel(m, 0.19, 0.16, -1.9, reach=0.2)
        else:
            with m.at(move(-0.42, 0.0, 0) @ rot_z(0.03)):
                open_crate(m, 0.5, 0.38, 0.1, "herring")
            with m.at(move(0.14, 0.0, 0) @ rot_z(-0.02)):
                ice_tray(m, 0.46, 0.5, [(-0.1, 0.0, 0.06, 0.42), (0.1, 0.0, -0.07, 0.4)])
            with m.at(move(0.58, 0.06, 0)):
                basket(m, 0.14, 0.13, "eel", mound=0.025)
                eel(m, 0.14, 0.13, -1.75, reach=0.16)
    return m


def goods_bread(big):
    m = Mesh(ao=0.0)
    with m.at(table_frame(big)):
        hy = STALL_HY if big else SHOP_HY
        if big:
            cloth_drape(m, -1.0, 0.42, 0.36, -hy, 0.2, "linen")
            for i, x in enumerate((-0.8, -0.57, -0.34)):
                with m.at(move(x, -0.12, 0.004) @ rot_z(math.pi / 2 - 0.15 + 0.06 * i)):
                    loaf(m, 0.34, 0.14, 0.1)
            for x, y, cell in ((-0.03, -0.3, "rye"), (0.23, -0.3, "rye"), (0.1, 0.02, "crust"), (-0.62, 0.24, "rye")):
                with m.at(move(x, y, 0.004)):
                    ball(m, 0.105, cell, h=0.095, top=0.55)
            with m.at(move(0.8, 0.08, 0)):
                top = basket(m, 0.2, 0.12, "crust", mound=0.03)
                for x, y in ((-0.05, 0.04), (0.07, -0.05)):
                    with m.at(move(x, y, top - 0.018)):
                        ball(m, 0.05, "crust", h=0.045, sides=5, top=0.5)
        else:
            cloth_drape(m, -0.72, 0.72, 0.3, -hy, 0.18, "linen")
            for i, x in enumerate((-0.56, -0.35)):
                with m.at(move(x, 0.0, 0.004) @ rot_z(math.pi / 2 - 0.12 + 0.08 * i)):
                    loaf(m, 0.32, 0.13, 0.095)
            for x, y, cell in ((-0.1, -0.13, "rye"), (-0.07, 0.14, "crust"), (0.16, -0.08, "rye")):
                with m.at(move(x, y, 0.004)):
                    ball(m, 0.1, cell, h=0.09, top=0.55)
            with m.at(move(0.5, 0.04, 0)):
                top = basket(m, 0.16, 0.1, "crust", mound=0.025)
                with m.at(move(0.02, -0.02, top - 0.016)):
                    ball(m, 0.048, "crust", h=0.043, sides=5)
    return m


def leek(m, L=0.5, r=0.021):
    """A leek along +x from the root at x=0, lying on z=0; the leaves fan out flat."""
    path = [(0.0, 0.0, 0.707 * r), (0.26 * L, 0.0, 0.707 * r), (L, 0.0, 0.707 * 0.6 * r)]
    radii = [(r, r), (r * 1.05, r), (r * 2.0, r * 0.6)]
    m.tube(path, radii, 4, GOODS, side=(0, 1, 0), rot=math.pi / 4, cap0=True, cap1=True,
           uvfn=lambda p: cuv("leek", 0.5 + p.y / (5 * r), p.x / L))


def potato_sack(m):
    """An open sack standing on the table, its top rolled down, heaped with potatoes."""
    prof = [(0.16, 0.0), (0.2, 0.07), (0.2, 0.29), (0.172, 0.36), (0.195, 0.395)]
    with shading(m, bottom_dark(0.4, 0.72)):
        m.lathe(prof, 7, SACK, urep=1, vscale=1 / 0.42)
    m.lathe([(0.188, 0.385), (0.1, 0.43), (0.03, 0.44)], 7, GOODS, cap1=True, uvfn=uv_plan("potato", 0, 0, 0.19, 0.19))


def goods_veg(big):
    m = Mesh(ao=0.0)
    with m.at(table_frame(big)):
        if big:
            for x, y in ((-0.95, -0.3), (-0.72, -0.35), (-0.85, -0.1)):
                with m.at(move(x, y, 0) @ rot_z(x * 7)):
                    ball(m, 0.1, "cabbage", h=0.16, top=0.6)
            with m.at(move(-0.86, 0.28, 0) @ rot_z(math.pi / 2)):
                potato_sack(m)
            for i, y in enumerate((-0.42, -0.32, -0.22)):
                with m.at(move(-0.5 + 0.02 * i, y, 0) @ rot_z(0.04 * (i - 1))):
                    leek(m)
            for x, cell in ((0.3, "apple"), (0.78, "pear")):
                with m.at(move(x, 0.18, 0)):
                    basket(m, 0.19, 0.12, cell, mound=0.045)
            with m.at(move(0.56, -0.28, 0) @ rot_z(-0.06)):
                open_crate(m, 0.44, 0.3, 0.12, "potato", heap=0.03)
        else:
            for x, y in ((-0.6, -0.14), (-0.5, 0.12)):
                with m.at(move(x, y, 0) @ rot_z(x * 5)):
                    ball(m, 0.1, "cabbage", h=0.16, top=0.6)
            for i, y in enumerate((-0.24, -0.13)):
                with m.at(move(-0.36, y, 0) @ rot_z(0.05 * i)):
                    leek(m, L=0.46)
            with m.at(move(0.28, 0.12, 0)):
                basket(m, 0.16, 0.11, "apple", mound=0.04)
            with m.at(move(0.6, -0.08, 0)):
                basket(m, 0.15, 0.11, "pear", mound=0.04)
    return m


def goods_wares(big):
    m = Mesh(ao=0.0)
    with m.at(table_frame(big)):
        if big:
            with m.at(move(-0.88, -0.22, 0)):
                rope_ring(m, 0.16, 0.035)
            with m.at(move(-0.88, 0.24, 0) @ rot_z(0.4)):
                rope_ring(m, 0.14, 0.03)
                rope_ring(m, 0.125, 0.03, z0=0.042)
            for x in (-0.45, -0.358, -0.266):
                with m.at(move(x, -0.3, 0)):
                    tin_can(m)
            with m.at(move(-0.404, -0.3, 0.1)):
                tin_can(m)
            with m.at(move(0.02, 0.2, 0) @ rot_z(0.3)):
                iron_pot(m)
            with m.at(move(0.86, 0.12, 0) @ rot_z(0.2)):
                lantern(m)
            for x, y, a in ((0.02, -0.32, 0.25), (0.3, -0.26, -0.3), (0.56, -0.34, 0.1)):
                with m.at(move(x, y, 0) @ rot_z(a)):
                    brush(m)
        else:
            with m.at(move(-0.56, 0.02, 0)):
                rope_ring(m, 0.14, 0.032)
            for x in (-0.24, -0.148):
                with m.at(move(x, -0.16, 0)):
                    tin_can(m)
            with m.at(move(-0.194, -0.16, 0.1)):
                tin_can(m)
            with m.at(move(0.02, 0.12, 0) @ rot_z(0.3)):
                lantern(m)
            for x, y, a in ((0.22, -0.18, 0.3), (0.3, 0.14, -0.4)):
                with m.at(move(x, y, 0) @ rot_z(a)):
                    brush(m)
            with m.at(move(0.56, -0.02, 0)):
                iron_pot(m, R=0.11, H=0.12)
    return m


def goods_cloth(big=True):
    m = Mesh(ao=0.0)
    R = 0.075
    with m.at(table_frame(big)):
        zb = 0.924 * R
        for x in (-0.98, -0.83, -0.68):
            bolt(m, x, 0.38, 0.8, R, zb, {-0.98: "blue", -0.83: "green", -0.68: "red"}[x])
        for x in (-0.905, -0.755):
            bolt(m, x, 0.36, 0.76, R, zb + 1.72 * R, {-0.905: "ochre", -0.755: "linen"}[x])
        for i, (cell, a) in enumerate((("red", -0.08), ("ochre", 0.05), ("green", -0.02))):
            with m.at(move(-0.25, -0.2, 0.03 * i) @ rot_z(a)):
                abox(m, 0.36, 0.28, 0.03, cell)
        for i, (cell, a) in enumerate((("blue", 0.1), ("linen", -0.04))):
            with m.at(move(0.2, 0.2, 0.03 * i) @ rot_z(a)):
                abox(m, 0.36, 0.28, 0.03, cell)
        cloth_drape(m, 0.06, 0.4, -0.2, -STALL_HY, 0.24, "ochre")
        # a bolt of blue half unrolled over the front edge
        cloth_drape(m, 0.54, 1.06, 0.2, -STALL_HY, 0.28, "blue", z=0.004)
        bolt(m, 0.5, 0.2, 0.6, 0.07, 0.924 * 0.07 + 0.006, "blue", along_y=False)
        m.beam((-0.6, -0.46, 0.008), (0.0, -0.47, 0.008), 0.02, 0.016, DARK, side=(0, 1, 0))
    return m


# ------------------------------------------------------------------ the stall


def stall_frame():
    """Four posts with rails under the canvas, a trestle table, a small painted board."""
    m = Mesh(ao=0.5)
    h = POST / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * PX, sy * PY
            ztop = canvas_z(y - h) - 0.008
            m.box((x, y, ztop / 2), (POST, POST, ztop), DARK, tile=1.2)
            m.box((x, y, 0.03), (0.12, 0.12, 0.06), DARK, shade=0.8, skip=("-z",))
    # rails the canvas lies on (their tops 5 mm under it)
    for y in (-PY, PY):
        zr = canvas_z(y - 0.025) - 0.006 - 0.03
        m.beam((-PX - h, y, zr), (PX + h, y, zr), 0.05, 0.06, DARK, side=(0, 1, 0))
    for sx in (-1, 1):
        m.beam((sx * PX, -PY, canvas_z(-PY) - 0.037), (sx * PX, PY, canvas_z(PY) - 0.037), 0.05, 0.06, DARK, side=(1, 0, 0))
        m.beam((sx * PX, -PY + h, 0.25), (sx * PX, PY - h, 0.25), 0.04, 0.05, DARK, side=(1, 0, 0))
    # the table: a plank top on two trestles
    m.box((0, 0, STALL_TOP - 0.02), (2 * STALL_HX, 2 * STALL_HY, 0.04), WOOD, tile=1.2)
    for tx in (-0.8, 0.8):
        m.beam((tx, -0.5, STALL_TOP - 0.07), (tx, 0.5, STALL_TOP - 0.07), 0.06, 0.06, DARK, side=(1, 0, 0))
        for sy in (-1, 1):
            for lx in (-1, 1):
                m.beam((tx + lx * 0.02, sy * 0.44, STALL_TOP - 0.08), (tx + lx * 0.15, sy * 0.47, 0.0), 0.045, 0.045, DARK,
                       side=(0, 1, 0))
    # the board on the front of the left front post
    yb = -(PY + h)
    m.box((-PX - h + 0.18, yb - 0.01, 1.4), (0.36, 0.02, 0.18), DARK)
    x0, x1 = -PX - h + 0.005, -PX - h + 0.355
    m.poly([(x0, yb - 0.0205, 1.315), (x1, yb - 0.0205, 1.315), (x1, yb - 0.0205, 1.485), (x0, yb - 0.0205, 1.485)], SIGN,
           out=(0, -1, 0), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    return m


def stall_awning():
    """The open canvas: striped, sagging a little between the rails, a pinked valance in front."""
    m = Mesh(ao=0.0)

    def sag(x, y):
        fx = max(0.0, 1 - (x / PX) ** 2) if abs(x) < PX else 0.0
        fy = math.sin(math.pi * (y + PY) / (2 * PY)) if abs(y) < PY else 0.0
        return 0.035 * fx * fy

    xs = [-AWN_HX, -PX, -0.67, 0.0, 0.67, PX, AWN_HX]
    ys = [AWN_FRONT_Y, -PY, -0.33, 0.0, 0.33, PY, AWN_BACK_Y]
    rows = [[(x, y, canvas_z(y) + 0.004 - sag(x, y)) for x in xs] for y in ys]
    uvfn = lambda p: (p.x + 0.125, (p.y - AWN_FRONT_Y) * 1.02)  # noqa: E731
    sheet(m, rows, RED, uvfn)
    zf = canvas_z(AWN_FRONT_Y) + 0.004
    n = 13
    top = [(-AWN_HX + 2 * AWN_HX * k / (n - 1), AWN_FRONT_Y, zf) for k in range(n)]
    bot = [(x, y, zf - 0.12 - (0.05 if k % 2 else 0.0)) for k, (x, y, _) in enumerate(top)]
    sheet(m, [bot, top], RED, lambda p: (p.x + 0.125, (p.z - zf) * 1.0), smooth=False)
    return m


def roll(m, x0, x1, y, z, R, mat, ties=(), rot_uv=0.125):
    """Canvas rolled up tight along x, tied with rope."""
    L = x1 - x0
    with m.at(lathe_x(m, x0, y, z, L)):
        with shading(m, lambda p: 0.72 + 0.28 * max(0.0, -p.x / R)):
            m.lathe([(R, 0.0), (R, L)], 8, mat, cap0=True, cap1=True,
                    uvfn=lambda p: (x0 + p.z + rot_uv, abs(math.atan2(p.y, p.x)) / math.pi * 0.3))
        for t in ties:
            m.lathe([(R + 0.007, t - x0), (R + 0.007, t - x0 + 0.03)], 8, ROPE, smooth=False, urep=2)


def stall_awning_rolled():
    m = Mesh(ao=0.0)
    zr = canvas_z(PY - 0.025) - 0.006  # top of the back rail
    R = 0.085
    roll(m, -AWN_HX, AWN_HX, PY, zr + R, R, RED, ties=(-1.05, -0.015, 1.02))
    return m


def tarp(m, a, b, cy, top, hem, lumps, ropes, seed):
    """A tarred tarpaulin thrown over a table (half sizes a, b, centre y cy, top height) hanging
    down to `hem`, lumpy on top, with ropes round it at the given x."""
    rng = random.Random(seed)
    nx, ny = 4, 2

    def outline(A, B, c):
        pts, nrm = [], []
        for k in range(nx + 2):
            pts.append((-A + c + (2 * A - 2 * c) * k / (nx + 1), -B))
            nrm.append((0, -1))
        for k in range(ny + 2):
            pts.append((A, -B + c + (2 * B - 2 * c) * k / (ny + 1)))
            nrm.append((1, 0))
        for k in range(nx + 2):
            pts.append((A - c - (2 * A - 2 * c) * k / (nx + 1), B))
            nrm.append((0, 1))
        for k in range(ny + 2):
            pts.append((-A, B - c - (2 * B - 2 * c) * k / (ny + 1)))
            nrm.append((-1, 0))
        return pts, nrm

    N = 2 * (nx + ny) + 8
    ends = {0, nx + 1, nx + 2, nx + ny + 3, nx + ny + 4, 2 * nx + ny + 5, 2 * nx + ny + 6, N - 1}
    fold = [rng.uniform(-1, 1) for _ in range(N)]
    ph = rng.uniform(0, 6)

    def bump(x, y):
        return sum(h * math.exp(-((x - bx) ** 2 + (y - by) ** 2) / r ** 2) for bx, by, h, r in lumps)

    rings = []
    for A, B, c, zf, amp in ((a + 0.03, b + 0.03, 0.05, None, 1.0), (a + 0.028, b + 0.028, 0.05, hem + 0.5 * (top - hem), 0.6),
                             (a + 0.04, b + 0.04, 0.04, top - 0.02, 0.0), (a + 0.01, b + 0.01, 0.03, top + 0.035, 0.0)):
        pts, nrm = outline(A, B, c)
        ring = []
        for i, ((x, y), (nx_, ny_)) in enumerate(zip(pts, nrm)):
            o = 0.014 * fold[i] * amp + (0.02 * amp if i in ends else 0.0)
            if i in ends and amp > 0:
                x += math.copysign(0.02 * amp, x)
                y += math.copysign(0.02 * amp, y)
            x, y = x + nx_ * o, y + ny_ * o
            if zf is None:
                z = hem + 0.025 * math.sin(1.7 * i + ph) - (0.05 if i in ends else 0.0)
            else:
                z = zf + (0.01 * fold[i] if amp > 0 else 0.0)
            ring.append(Vector((x, y + cy, z)))
        rings.append(ring)
    base, _ = outline(a + 0.01, b + 0.01, 0.03)
    for s in (0.8, 0.52, 0.26):
        rings.append([Vector((x * s, y * s + cy, top + 0.035 + bump(x * s, y * s))) for x, y in base])
    centre = Vector((0, cy, top + 0.035 + bump(0, 0)))

    def tuv(p):
        x, y = p.x, p.y - cy
        d = max(0.0, top + 0.03 - p.z)
        if abs(y) / (b + 0.04) > abs(x) / (a + 0.04):
            return (x / 1.2, (y + math.copysign(d, y)) / 1.2)
        return ((x + math.copysign(d, x)) / 1.2, y / 1.2)

    V = [[m.vert(p) for p in r] for r in rings]
    for k in range(len(rings) - 1):
        for i in range(N):
            i1 = (i + 1) % N
            idx = [(k, i), (k, i1), (k + 1, i1), (k + 1, i)]
            m.face([V[p][q] for p, q in idx], [tuv(rings[p][q]) for p, q in idx], TARP, smooth=True,
                   local=[rings[p][q] for p, q in idx])
    vc = m.vert(centre)
    for i in range(N):
        i1 = (i + 1) % N
        m.face([V[-1][i], V[-1][i1], vc], [tuv(rings[-1][i]), tuv(rings[-1][i1]), tuv(centre)], TARP, smooth=True,
               local=[rings[-1][i], rings[-1][i1], centre])

    # ropes: follow the tarp's outer surface (ray casts on what was just built)
    bvh = BVHTree.FromBMesh(m.bm)
    rr = 0.012
    off = rr + 0.007

    def hit(o, d):
        d = Vector(d).normalized()
        loc, _, _, _ = bvh.ray_cast(Vector(o), d)
        return loc - d * off if loc is not None else None

    for xr in ropes:
        side = []
        for sgn in (-1, 1):
            pts = [hit((xr, cy + sgn * 3, z), (0, -sgn, 0)) for z in (hem + 0.05, 0.5 * (hem + top))]
            pts.append(hit((xr, cy + sgn * (b + 1), top + 1), (0, -sgn, -1)))
            side.append(pts)
        topline = [hit((xr, cy + t * b, top + 2), (0, 0, -1)) for t in np.linspace(-0.85, 0.85, 7)]
        path = side[0] + topline + side[1][::-1]
        path = [p for p in path if p is not None]
        path = [path[0] + Vector((0, 0.1, -0.09))] + path + [path[-1] + Vector((0, -0.1, -0.09))]
        m.tube(path, [rr] * len(path), 3, ROPE, side=(1, 0, 0), cap0=True, cap1=True, vscale=8)


STALL_LUMPS = [(-0.7, 0.05, 0.13, 0.32), (0.1, -0.05, 0.08, 0.35), (0.75, 0.15, 0.16, 0.25), (-0.2, 0.25, 0.06, 0.2)]


def stall_tarp():
    m = Mesh(ao=0.5)
    tarp(m, STALL_HX, STALL_HY, 0.0, STALL_TOP, 0.3, STALL_LUMPS, (-0.62, 0.58), 11)
    return m


# ------------------------------------------------------------------ the shop front


def shop_table():
    m = Mesh(ao=0.5)
    m.box((0, SHOP_CY, SHOP_TOP - 0.02), (2 * SHOP_HX, 2 * SHOP_HY, 0.04), WOOD, tile=1.2)
    for tx in (-0.55, 0.55):
        m.beam((tx, SHOP_CY - 0.3, SHOP_TOP - 0.07), (tx, SHOP_CY + 0.3, SHOP_TOP - 0.07), 0.06, 0.06, DARK, side=(1, 0, 0))
        for sy in (-1, 1):
            for lx in (-1, 1):
                m.beam((tx + lx * 0.02, SHOP_CY + sy * 0.27, SHOP_TOP - 0.08), (tx + lx * 0.13, SHOP_CY + sy * 0.3, 0.0), 0.045,
                       0.045, DARK, side=(0, 1, 0))
    return m


def batten(m):
    """The wooden batten the awning hangs from, on the wall."""
    m.box((0, -0.03, SHOP_WALL_Z - 0.06), (2 * SHOP_AWN_HX + 0.06, 0.06, 0.07), DARK, skip=("+y",))


def shop_awning():
    """A wall awning: canvas from the batten out to an iron front bar, held by two tie rods."""
    m = Mesh(ao=0.0)
    batten(m)
    yf = SHOP_FRONT_Y - 0.015

    def z(x, y):
        t = (-0.02 - y) / (-0.02 - SHOP_FRONT_Y)
        return shop_canvas_z(y) + 0.004 - 0.045 * math.sin(math.pi * min(1.0, max(0.0, t)))

    xs = [SHOP_AWN_HX * k / 3 for k in range(-3, 4)]
    ys = [yf, SHOP_FRONT_Y, -0.98, -0.66, -0.34, -0.02]
    rows = [[(x, y, z(x, y)) for x in xs] for y in ys]
    uvfn = lambda p: (p.x + 0.125, (p.y - yf) * 1.02)  # noqa: E731
    sheet(m, rows, BLUE, uvfn)
    zf = z(0, yf)
    n = 13
    top = [(-SHOP_AWN_HX + 2 * SHOP_AWN_HX * k / (n - 1), yf, zf) for k in range(n)]
    bot = [(x, y, zf - 0.16 - (0.05 if k % 2 else 0.0)) for k, (x, y, _) in enumerate(top)]
    sheet(m, [bot, top], BLUE, lambda p: (p.x + 0.125, (p.z - zf) * 1.0), smooth=False)
    zb = shop_canvas_z(SHOP_FRONT_Y) - 0.018
    m.beam((-SHOP_AWN_HX - 0.05, SHOP_FRONT_Y, zb), (SHOP_AWN_HX + 0.05, SHOP_FRONT_Y, zb), 0.025, 0.025, IRON, side=(0, 1, 0))
    for sx in (-1, 1):
        x = sx * (SHOP_AWN_HX + 0.035)
        m.beam((x, SHOP_FRONT_Y, zb), (x, -0.03, 3.05), 0.016, 0.016, IRON, side=(1, 0, 0))
        m.box((x, -0.02, 3.05), (0.04, 0.04, 0.05), IRON, skip=("+y",))
    return m


def shop_awning_rolled():
    m = Mesh(ao=0.0)
    batten(m)
    R = 0.075
    zc = SHOP_WALL_Z - 0.025 + 0.02 + R
    roll(m, -SHOP_AWN_HX, SHOP_AWN_HX, -0.135, zc, R, BLUE, ties=(-0.9, 0.0, 0.88))
    for x in (-1.0, 1.0):
        m.beam((x, -0.002, zc - R - 0.012), (x, -0.22, zc - R - 0.012), 0.024, 0.024, IRON, side=(1, 0, 0))
        m.beam((x, -0.22, zc - R - 0.024), (x, -0.22, zc - 0.01), 0.022, 0.022, IRON, side=(1, 0, 0))
    return m


SHOP_LUMPS = [(-0.4, 0.0, 0.12, 0.25), (0.15, 0.02, 0.07, 0.25), (0.5, 0.05, 0.13, 0.2)]


def shop_tarp():
    m = Mesh(ao=0.5)
    tarp(m, SHOP_HX, SHOP_HY, SHOP_CY, SHOP_TOP, 0.3, SHOP_LUMPS, (-0.42, 0.42), 12)
    return m


def crates_goods():
    """Two crates of produce stacked by a shop door: potatoes below, apples on top at the back."""
    m = Mesh(ao=0.4)
    open_crate(m, 0.58, 0.5, 0.28, "potato", heap=0.012)
    with m.at(move(0, 0.1, 0.28)):
        open_crate(m, 0.58, 0.3, 0.15, "apple", heap=0.02)
        for x, y in ((-0.1, 0.02), (0.12, -0.03)):
            with m.at(move(x, y, 0.15 - 0.028 + 0.012)):
                ball(m, 0.04, "apple", sides=5, sub=FRUIT_SUB)
    return m


# ------------------------------------------------------------------ build


BUILDERS = [
    ("stall_frame", stall_frame),
    ("stall_awning", stall_awning),
    ("stall_awning_rolled", stall_awning_rolled),
    ("stall_tarp", stall_tarp),
    ("stall_goods_fish", lambda: goods_fish(True)),
    ("stall_goods_bread", lambda: goods_bread(True)),
    ("stall_goods_veg", lambda: goods_veg(True)),
    ("stall_goods_wares", lambda: goods_wares(True)),
    ("stall_goods_cloth", lambda: goods_cloth(True)),
    ("shop_table", shop_table),
    ("shop_awning", shop_awning),
    ("shop_awning_rolled", shop_awning_rolled),
    ("shop_tarp", shop_tarp),
    ("shop_goods_bread", lambda: goods_bread(False)),
    ("shop_goods_veg", lambda: goods_veg(False)),
    ("shop_goods_wares", lambda: goods_wares(False)),
    ("shop_goods_fish", lambda: goods_fish(False)),
    ("crates_goods", crates_goods),
]


def footprint(ob):
    """Footprint in the game frame (x, z = -Blender y), from the parts under 1.5 m, and height."""
    vs = [v.co for v in ob.data.vertices]
    low = [v for v in vs if v.z <= 1.5]
    src = low or vs
    fp = {"minX": min(v.x for v in src), "maxX": max(v.x for v in src), "minZ": -max(v.y for v in src),
          "maxZ": -min(v.y for v in src), "height": max(v.z for v in vs)}
    fp = {k: round(v, 3) for k, v in fp.items()}
    if not low:
        fp["overhead"] = True
    return fp


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    objs = {}
    for name, fn in BUILDERS:
        ob = to_object(fn(), name)
        ob["footprint"] = json.dumps(footprint(ob), separators=(",", ":"))
        if name == "stall_frame":
            ob["top"] = STALL_TOP
        if name == "shop_table":
            ob["top"] = SHOP_TOP
        objs[name] = ob
    counts = {n: bp.tris(o) for n, o in objs.items()}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_stalls] {n:20s} {c:5d} tris  {objs[n]['footprint']}")
    print(f"[build_stalls] {len(objs)} objects, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        bp.preview_materials()
        preview(objs)


# ------------------------------------------------------------------ preview


def inst(objs, name, loc=(0, 0, 0), rz=0.0):
    o = objs[name].copy()
    o.location = loc
    o.rotation_euler = (0, 0, rz)
    bpy.context.scene.collection.objects.link(o)
    return o


def wall(x, w=3.6, h=3.6):
    me = bpy.data.meshes.new("wall")
    me.from_pydata([(x - w / 2, 0.0, 0.0), (x + w / 2, 0.0, 0.0), (x + w / 2, 0.0, h), (x - w / 2, 0.0, h)], [], [(0, 3, 2, 1)])
    mat = bpy.data.materials.get("wall_prev") or bpy.data.materials.new("wall_prev")
    mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.2, 0.075, 0.045, 1)
    me.materials.append(mat)
    o = bpy.data.objects.new("wall", me)
    bpy.context.scene.collection.objects.link(o)
    return o


def preview(objs):
    cam = bp.stage()
    sc = bpy.context.scene
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    for o in objs.values():
        o.hide_render = True
    panels = []
    # 1-2: the stall by day (fish) and by night; 3-4: the shop front by day (bread) and night
    X = [0.0, 20.0, 40.0, 60.0, 80.0, 100.0, 120.0, 140.0]
    p = [inst(objs, n, (X[0], 0, 0)) for n in ("stall_frame", "stall_awning", "stall_goods_fish")]
    panels.append((p, (X[0] + 2.3, -4.3, 1.75), (X[0], 0, 1.1), 26))
    p = [inst(objs, n, (X[1], 0, 0)) for n in ("stall_frame", "stall_awning_rolled", "stall_tarp")]
    panels.append((p, (X[1] + 2.3, -4.3, 1.9), (X[1], 0, 1.0), 26))
    p = [inst(objs, n, (X[2], 0, 0)) for n in ("shop_table", "shop_awning", "shop_goods_bread")] + [wall(X[2])]
    panels.append((p, (X[2] + 1.9, -4.8, 1.7), (X[2], -0.5, 1.45), 26))
    p = [inst(objs, n, (X[3], 0, 0)) for n in ("shop_table", "shop_awning_rolled", "shop_tarp")] + [wall(X[3])]
    panels.append((p, (X[3] + 1.9, -4.8, 1.7), (X[3], -0.5, 1.3), 26))
    # 5-6: the stall goods on bare frames; 7: the shop goods; 8: night stall from behind, high
    p = []
    for k, g in enumerate(("fish", "bread", "veg")):
        x = X[4] + (k - 1) * 2.9
        p += [inst(objs, "stall_frame", (x, 0, 0)), inst(objs, f"stall_goods_{g}", (x, 0, 0))]
    panels.append((p, (X[4], -4.6, 3.3), (X[4], 0, 0.85), 30))
    p = []
    for k, g in enumerate(("wares", "cloth")):
        x = X[5] + (k - 0.75) * 2.9
        p += [inst(objs, "stall_frame", (x, 0, 0)), inst(objs, f"stall_goods_{g}", (x, 0, 0))]
    p.append(inst(objs, "crates_goods", (X[5] + 3.2, -0.2, 0)))
    panels.append((p, (X[5] + 0.3, -4.4, 3.2), (X[5] + 0.3, 0, 0.8), 30))
    p = []
    for k, g in enumerate(("bread", "veg", "wares", "fish")):
        x = X[6] + (k - 1.5) * 1.8
        p += [inst(objs, "shop_table", (x, 0, 0)), inst(objs, f"shop_goods_{g}", (x, 0, 0))]
    p.append(wall(X[6], w=7.6, h=1.6))
    panels.append((p, (X[6], -4.3, 2.8), (X[6], -0.6, 0.75), 32))
    p = [inst(objs, n, (X[7], 0, 0)) for n in ("stall_frame", "stall_awning_rolled", "stall_tarp")]
    panels.append((p, (X[7] - 2.4, 3.4, 3.0), (X[7], 0, 0.9), 30))

    every = [o for ps, *_ in panels for o in ps]
    tmp = os.path.join(tempfile.gettempdir(), "stalls_panels")
    os.makedirs(tmp, exist_ok=True)
    pw, ph = 960, 600
    sheet_px = np.zeros((ph * 4, pw * 2, 4), dtype=np.float32)
    for i, (ps, loc, target, lens) in enumerate(panels):
        for o in every:
            o.hide_render = o not in ps
        bp.aim(cam, loc, target, lens)
        path = os.path.join(tmp, f"panel{i + 1}.png")
        sc.render.resolution_x, sc.render.resolution_y = pw, ph
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        buf = np.empty(pw * ph * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        bpy.data.images.remove(img)
        r, c = divmod(i, 2)
        y0 = ph * (3 - r)
        sheet_px[y0:y0 + ph, c * pw:(c + 1) * pw] = buf.reshape(ph, pw, 4)
    sheet_px[:, pw - 1:pw + 1, :3] = 0.05
    for r in range(1, 4):
        sheet_px[ph * r - 1:ph * r + 1, :, :3] = 0.05
    sheet_px[..., 3] = 1
    out = bpy.data.images.new("stalls_sheet", pw * 2, ph * 4, alpha=False)
    out.pixels.foreach_set(sheet_px.ravel())
    out.filepath_raw = SHOT
    out.file_format = "PNG"
    os.makedirs(os.path.dirname(SHOT), exist_ok=True)
    out.save()
    print(f"[build_stalls] preview -> {SHOT} (panels in {tmp})")


if __name__ == "__main__":
    main()
