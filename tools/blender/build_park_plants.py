"""The Stadspark's plants, autumn 1873 (the park pass, 2026-09-26).

    blender -b --factory-startup -P tools/blender/build_park_plants.py
    blender -b --factory-startup -P tools/blender/build_park_plants.py -- --preview

Writes client/public/models/park_plants.glb (Draco): one node per kind, standing on its origin, real
size in metres. client/src/world/parkNature.ts instances them on the places worked out by
tools/city/park.py --plants (client/public/models/park_plants.json).

Keilig planted the park in 1868-70 with many kinds new to Belgium; in the autumn of 1873 most trees
are about four years in the ground, still tied to their stakes, and a few old trees of the ramparts
were kept:

  young_lime, young_maple, young_chestnut, young_elm
                  young trees of 3.5 to 5 m on a stake, thin crowns in autumn colours (the maple red)
  old_elm, old_plane, old_bare
                  old trees kept from the ramparts (as build_trees.py's elm, plane and bare elm, stouter)
  weeping         a young weeping willow: arching limbs and curtains of yellow shoots
  conifer         a young exotic conifer, a dark cone of 3.5 m
  shrub_ever      a rhododendron: a dark glossy dome, 1.6 m
  shrub_holly     a holly, upright, dark with red berries, 2 m
  shrub_hazel     a hazel: a vase of stems, yellow and green leaves, 2.4 m
  shrub_red       a Japanese maple or an azalea in red and orange, 1.4 m
  shrub_bare      a shrub already bare: twigs and a few brown leaves, 1.8 m
  hedge           one metre of clipped privet hedge, 1 m high and 1 m through (scaled by the game)
  reed, cattail, sedge, iris
                  the water's edge: common reed with plumes, bulrushes, sedge and long grass, flag iris
  flowers         a clump of late asters and chrysanthemums in a bed
  lily            a few water lily pads lying on the water

Made the way build_trees.py makes the town's trees (its Tree class, its painting helpers and its bark):
low-poly tapered tubes, crossed leaf cards, a painted atlas (tree_leaves, 256 x 320: 4 x 5 cells) and
the bark image (tree_bark). Our own work, no downloaded models. Where a card drawn with Codex is there
(tools/blender/art/park_foliage.png, park_reeds.png, park_lilies.png: tools/textures/park_sprites.py,
assets/ATTRIBUTION.md) it takes the painted cell's place.

Blender is Z-up; the glTF export turns it Y-up: Blender (x, y, z) is game (x, z, -y).
"""

import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_trees as bt  # noqa: E402

ROOT = bt.ROOT
OUT = os.path.join(ROOT, "client", "public", "models", "park_plants.glb")
bt.AH = 320  # this atlas: 4 x 5 cells (cell_uv and cluster read it)
AW, AH, CELL = bt.AW, bt.AH, bt.CELL
UP = bt.UP
TAU = bt.TAU
BARK, LEAF = bt.BARK, bt.LEAF

DARK = [(0.11, 0.21, 0.10), (0.15, 0.27, 0.12), (0.09, 0.17, 0.08), (0.19, 0.29, 0.13)]
DARK_OLIVE = [(0.20, 0.26, 0.12), (0.24, 0.30, 0.14)]
RED = [(0.70, 0.19, 0.08), (0.80, 0.31, 0.10), (0.60, 0.13, 0.07), (0.86, 0.44, 0.12)]
NEEDLE = [(0.10, 0.18, 0.13), (0.13, 0.22, 0.15), (0.08, 0.15, 0.11)]
STRAW = [(0.56, 0.48, 0.30), (0.48, 0.40, 0.25), (0.42, 0.36, 0.22), (0.62, 0.54, 0.35)]

CELLS = dict(rhodo=0, holly=1, hazel=2, maple=3, chestnut=4, privet_full=5, privet=6, twigs=7, flowers=8, needles=9,
             willow=10, lime=11, reed=12, cattail=13, sedge=14, iris=15, lily=16, elm=17, plane=18, plane_sparse=19)


# ------------------------------------------------------------------ painting


def cell_origin(ci):
    return (ci % 4) * CELL, (ci // 4) * CELL


def chestnut_cell(img, ci, rng):
    """Horse chestnut: fans of five to seven long leaflets from one stalk, brown and yellow."""
    ox, oy = cell_origin(ci)
    for _ in range(2):
        bt.twig_spray(img, ox, oy, rng, (32 + rng.uniform(-3, 3), 62), rng.uniform(-0.5, 0.5), rng.uniform(12, 16), 1, 2)
    for _ in range(6):
        cx, cy = rng.uniform(16, 48), rng.uniform(14, 40)
        pal = [bt.YELLOW, bt.BROWN, bt.RUST][rng.choice(3, p=[0.45, 0.35, 0.2])]
        base = rng.uniform(0, TAU)
        for k in range(int(rng.integers(5, 8))):
            ang = base + (k - 3) * 0.5
            rgb = pal[rng.integers(len(pal))]
            bt.put_leaf(img, ox, oy, cx, cy, ang, rng.uniform(11, 16), "lance", rgb, rng)


def privet_full(img, ci, rng):
    """A clipped hedge's face: small dark leaves all over the cell (no holes)."""
    ox, oy = cell_origin(ci)
    blk = img[oy:oy + CELL, ox:ox + CELL]
    nz = bt.vnoise(rng, CELL, CELL, 6, 6)
    blk[..., :3] = (np.array([0.10, 0.17, 0.08]) * (0.7 + 0.6 * nz)[..., None])
    blk[..., 3] = 1.0
    for _ in range(170):
        x, y = rng.uniform(2, 62), rng.uniform(2, 62)
        rgb = DARK[rng.integers(len(DARK))] if rng.random() < 0.85 else bt.YELLOW[rng.integers(4)]
        bt.put_leaf(img, ox, oy, x, y, rng.uniform(0, TAU), rng.uniform(4, 6.5), "oval", rgb, rng)
    blk[..., 3] = 1.0
    # (the edges of a cell are left out by put_leaf: fill them from the inside)
    blk[0, :, :3], blk[-1, :, :3], blk[:, 0, :3], blk[:, -1, :3] = blk[1, :, :3], blk[-2, :, :3], blk[:, 1, :3], blk[:, -2, :3]


def needles_cell(img, ci, rng):
    """Conifer sprays: flat fans of short dark needles along a few shoots."""
    ox, oy = cell_origin(ci)
    for _ in range(5):
        x0, y0 = rng.uniform(10, 54), rng.uniform(34, 60)
        ang = rng.uniform(-0.7, 0.7)
        L = rng.uniform(22, 34)
        for k in range(int(L)):
            x = x0 + math.sin(ang) * k
            y = y0 - math.cos(ang) * k
            for sg in (-1, 1):
                a2 = ang + sg * 1.1
                ln = 5.5 * (1 - k / L) + 1.5
                col = np.array(NEEDLE[rng.integers(3)]) * rng.uniform(0.8, 1.2)
                bt.put_line(img, ox, oy, (x, y), (x + math.sin(a2) * ln, y - math.cos(a2) * ln), col, 1)
            bt.put_line(img, ox, oy, (x, y), (x + math.sin(ang), y - math.cos(ang)), np.array([0.2, 0.15, 0.1]), 1)


def willow_cell(img, ci, rng):
    """Weeping willow: shoots across the top of the cell with narrow yellow leaves hanging from them."""
    ox, oy = cell_origin(ci)
    for k in range(2):
        y0 = 4 + k * 4
        bt.put_line(img, ox, oy, (4, y0 + rng.uniform(-2, 2)), (60, y0 + rng.uniform(-2, 2)), np.array([0.46, 0.40, 0.18]), 1)
        for i in range(10):
            x = 5 + i * 5.6 + rng.uniform(-1.5, 1.5)
            L = rng.uniform(26, 54)
            rgb = bt.YELLOW[rng.integers(4)] if rng.random() < 0.75 else bt.GREEN[rng.integers(3)]
            bt.put_leaf(img, ox, oy, x, y0 + 1, math.pi + rng.uniform(-0.25, 0.25), L, "lance", rgb, rng)


def reed_cell(img, ci, rng, kind):
    """Water's edge plants seen from the side, standing on the bottom of the cell."""
    ox, oy = cell_origin(ci)
    if kind == "reed":
        for _ in range(9):
            x = rng.uniform(8, 56)
            top = rng.uniform(6, 18)
            lean = rng.uniform(-4, 4)
            col = np.array(STRAW[rng.integers(4)]) * rng.uniform(0.85, 1.1)
            bt.put_line(img, ox, oy, (x, 62), (x + lean, top), col, 1)
            for k in range(3):  # a few leaves off the stem
                yy = rng.uniform(top + 12, 58)
                xx = x + lean * (62 - yy) / (62 - top)
                sg = 1 if rng.random() < 0.5 else -1
                bt.put_line(img, ox, oy, (xx, yy), (xx + sg * rng.uniform(6, 11), yy - rng.uniform(3, 9)), col * 0.9, 1)
            for k in range(26):  # the plume
                px = x + lean + rng.normal(0, 2.2)
                py = top + rng.uniform(-4, 8)
                img[oy + int(np.clip(py, 1, 62)), ox + int(np.clip(px, 1, 62)), :3] = np.array([0.40, 0.33, 0.27]) * rng.uniform(0.8, 1.2)
                img[oy + int(np.clip(py, 1, 62)), ox + int(np.clip(px, 1, 62)), 3] = 1.0
    elif kind == "cattail":
        for _ in range(9):
            x = rng.uniform(8, 56)
            top = rng.uniform(4, 20)
            lean = rng.uniform(-9, 9)
            col = np.array([0.36, 0.40, 0.18]) * rng.uniform(0.8, 1.2) if rng.random() < 0.6 else np.array(STRAW[rng.integers(4)])
            bt.put_line(img, ox, oy, (x, 62), (x + lean, top), col, 2)
        for _ in range(3):
            x = rng.uniform(16, 48)
            top = rng.uniform(8, 16)
            bt.put_line(img, ox, oy, (x, 62), (x, top), np.array([0.30, 0.32, 0.16]), 1)
            for yy in range(int(top) + 3, int(top) + 12):
                for dx in (-1, 0, 1):
                    img[oy + yy, ox + int(x) + dx, :3] = np.array([0.24, 0.14, 0.08]) * rng.uniform(0.85, 1.1)
                    img[oy + yy, ox + int(x) + dx, 3] = 1.0
    elif kind == "sedge":
        for _ in range(34):
            x = rng.uniform(6, 58)
            h = rng.uniform(18, 50)
            lean = rng.uniform(-12, 12)
            col = np.array(bt.GREEN[rng.integers(3)] if rng.random() < 0.5 else STRAW[rng.integers(4)]) * rng.uniform(0.8, 1.1)
            bt.put_line(img, ox, oy, (x, 62), (x + lean * 0.4, 62 - h * 0.55), col, 1)
            bt.put_line(img, ox, oy, (x + lean * 0.4, 62 - h * 0.55), (x + lean, 62 - h), col, 1)
    else:  # iris: broad sword leaves, some bent over and brown
        for _ in range(10):
            x = rng.uniform(12, 52)
            h = rng.uniform(26, 56)
            lean = rng.uniform(-6, 6)
            col = np.array([0.30, 0.40, 0.16]) if rng.random() < 0.6 else np.array([0.50, 0.38, 0.18])
            col = col * rng.uniform(0.8, 1.15)
            if rng.random() < 0.3:  # broken over
                bt.put_line(img, ox, oy, (x, 62), (x + lean, 62 - h * 0.6), col, 2)
                bt.put_line(img, ox, oy, (x + lean, 62 - h * 0.6), (x + lean + 14 * np.sign(lean + 0.01), 62 - h * 0.4), col * 0.85, 2)
            else:
                bt.put_line(img, ox, oy, (x, 62), (x + lean, 62 - h), col, 2)


def flowers_cell(img, ci, rng):
    """A late clump in a bed: green and brown stalks, mauve asters, a few rust chrysanthemums."""
    ox, oy = cell_origin(ci)
    tips = []
    for _ in range(12):
        x = rng.uniform(10, 54)
        top = (x + rng.uniform(-8, 8), rng.uniform(14, 34))
        col = np.array([0.28, 0.34, 0.14]) if rng.random() < 0.7 else np.array([0.42, 0.34, 0.18])
        bt.put_line(img, ox, oy, (x, 62), top, col, 1)
        tips.append(top)
        for _ in range(2):
            yy = rng.uniform(top[1] + 8, 58)
            bt.put_leaf(img, ox, oy, x, yy, rng.uniform(-1.2, 1.2), rng.uniform(5, 8), "lance", bt.GREEN[rng.integers(3)], rng)
    for (x, y) in tips:
        if rng.random() < 0.25:
            continue
        col = np.array([0.58, 0.44, 0.66]) if rng.random() < 0.7 else np.array([0.72, 0.38, 0.14])
        col = col * rng.uniform(0.8, 1.1)
        for k in range(8):
            a = k * TAU / 8
            bt.put_line(img, ox, oy, (x, y), (x + math.cos(a) * 3, y + math.sin(a) * 3), col, 1)
        img[oy + int(y), ox + int(x), :3] = (0.8, 0.66, 0.2)


def lily_cell(img, ci, rng):
    """Lily pads from above: dark green discs with a notch, yellowed and brown at the rims."""
    ox, oy = cell_origin(ci)
    ys, xs = np.mgrid[0:CELL, 0:CELL]
    placed = []
    for _ in range(40):
        if len(placed) >= 4:
            break
        r = rng.uniform(9, 15)
        cx, cy = rng.uniform(r + 2, CELL - r - 2), rng.uniform(r + 2, CELL - r - 2)
        if any(math.hypot(cx - px, cy - py) < r + pr + 1 for px, py, pr in placed):
            continue
        placed.append((cx, cy, r))
        d = np.hypot(xs + 0.5 - cx, ys + 0.5 - cy)
        a = np.arctan2(ys + 0.5 - cy, xs + 0.5 - cx)
        notch = rng.uniform(-math.pi, math.pi)
        m = (d < r) & ~((np.abs(np.angle(np.exp(1j * (a - notch)))) < 0.18) & (d > r * 0.1))
        base = np.array([0.16, 0.26, 0.10]) * rng.uniform(0.8, 1.2)
        col = np.broadcast_to(base, (CELL, CELL, 3)).copy()
        rim = d > r * rng.uniform(0.7, 0.85)
        col[rim] = np.array([0.46, 0.40, 0.14]) * rng.uniform(0.7, 1.0)
        vein = (np.abs(np.angle(np.exp(1j * (a * 7)))) < 0.25) & (d > 1.5)
        col[vein] *= 0.8
        blk = img[oy:oy + CELL, ox:ox + CELL]
        blk[m, :3] = col[m]
        blk[m, 3] = 1.0


def paint_atlas():
    rng = np.random.default_rng(1868)
    img = np.zeros((AH, AW, 4))
    c = CELLS
    bt.cluster(img, c["rhodo"], "oval", [(DARK, 0.85), (DARK_OLIVE, 0.15)], 26, (12, 17), rng)
    bt.cluster(img, c["holly"], "oval", [(DARK, 1.0)], 34, (8, 11), rng)
    ox, oy = cell_origin(c["holly"])
    for _ in range(9):  # red berries
        x, y = int(rng.uniform(14, 50)), int(rng.uniform(12, 40))
        img[oy + y:oy + y + 2, ox + x:ox + x + 2, :3] = (0.62, 0.08, 0.06)
        img[oy + y:oy + y + 2, ox + x:ox + x + 2, 3] = 1.0
    bt.cluster(img, c["hazel"], "heart", [(bt.YELLOW, 0.6), (bt.GREEN, 0.3), (bt.BROWN, 0.1)], 24, (11, 15), rng)
    bt.cluster(img, c["maple"], "palm", [(RED, 0.7), (bt.RUST, 0.2), (bt.YELLOW, 0.1)], 20, (11, 15), rng)
    chestnut_cell(img, c["chestnut"], rng)
    privet_full(img, c["privet_full"], rng)
    bt.cluster(img, c["privet"], "oval", [(DARK, 0.9), (bt.YELLOW, 0.1)], 44, (5, 7), rng)
    ox, oy = cell_origin(c["twigs"])
    for a in (-0.35, 0.0, 0.35):
        bt.twig_spray(img, ox, oy, rng, (32, 62), a + rng.uniform(-0.1, 0.1), rng.uniform(15, 19), 3, 2)
    for _ in range(3):
        bt.put_leaf(img, ox, oy, rng.uniform(16, 48), rng.uniform(16, 30), rng.uniform(2.5, 3.8), 9, "oval", bt.BROWN[rng.integers(3)], rng)
    flowers_cell(img, c["flowers"], rng)
    needles_cell(img, c["needles"], rng)
    willow_cell(img, c["willow"], rng)
    bt.cluster(img, c["lime"], "heart", [(bt.YELLOW, 0.72), (bt.GREEN, 0.18), (bt.BROWN, 0.1)], 28, (10, 14), rng)
    for kind in ("reed", "cattail", "sedge", "iris"):
        reed_cell(img, c[kind], rng, kind)
    lily_cell(img, c["lily"], rng)
    bt.cluster(img, c["elm"], "oval", [(bt.YELLOW, 0.55), (bt.BROWN, 0.3), (bt.RUST, 0.15)], 46, (8, 11), rng)
    bt.cluster(img, c["plane"], "palm", [(bt.RUST, 0.55), (bt.BROWN, 0.3), (bt.YELLOW, 0.15)], 15, (15, 20), rng)
    ox, oy = cell_origin(c["plane_sparse"])
    for _ in range(2):
        bt.twig_spray(img, ox, oy, rng, (32 + rng.uniform(-4, 4), 62), rng.uniform(-0.5, 0.5), rng.uniform(14, 18), 2, 2)
    bt.cluster(img, c["plane_sparse"], "palm", [(bt.BROWN, 0.6), (bt.RUST, 0.4)], 6, (14, 18), rng, spread=20, twigs=False)
    return img


# cards drawn by Codex (assets/ATTRIBUTION.md), keyed and cut to 64 px by tools/textures/park_sprites.py: when a strip
# is there its cards replace the painted cells above (the painted ones stay as the fallback)
ART = os.path.join(os.path.dirname(os.path.abspath(__file__)), "art")
STRIPS = [
    ("park_foliage.png", ["rhodo", "holly", "hazel", "maple", "chestnut", "privet", "twigs", "flowers"]),
    ("park_reeds.png", ["reed", "cattail", "sedge", "iris"]),
    ("park_lilies.png", ["lily"]),
    ("stadspark_foliage.png", ["elm", "plane", "lime", "willow", "rhodo", "holly", "maple", "flowers"]),
]


def load_strip(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1]  # (rows from the top, as painted)
    bpy.data.images.remove(img)
    return arr


def paste_codex(atlas):
    for fname, names in STRIPS:
        path = os.path.join(ART, fname)
        if not os.path.exists(path):
            print(f"[build_park_plants] {fname}: not there, the painted cells stay")
            continue
        strip = load_strip(path)
        for k, nm in enumerate(names):
            if (k + 1) * CELL > strip.shape[1]:
                break
            ox, oy = cell_origin(CELLS[nm])
            atlas[oy:oy + CELL, ox:ox + CELL] = strip[:CELL, k * CELL:(k + 1) * CELL]
        print(f"[build_park_plants] {fname}: {len(names)} cards from Codex")
    return atlas


def make_materials():
    bark = bt.bl_image("tree_bark_tex", bt.paint_bark(), False)
    leaves = bt.bl_image("tree_leaves_tex", paste_codex(paint_atlas()), True)
    for name, img in zip(bt.MAT_NAMES, [bark, leaves]):
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if img is leaves:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry helpers on bt.Tree


def rect_card(t, base, up, width, height, ci, normal, tint, flip=False, crossed=True):
    """A card of `width` x `height` standing on `base`, its painting's foot at the base; crossed = two of them."""
    up = up.normalized()
    s1 = up.cross(UP)
    if s1.length < 1e-3:
        s1 = Vector((1, 0, 0))
    s1 = Quaternion(up, t.rng.uniform(-math.pi, math.pi)) @ s1.normalized()
    sides = [s1, up.cross(s1).normalized()] if crossed else [s1]
    x0, x1 = (1.0, 0.0) if flip else (0.0, 1.0)
    uvs = [bt.cell_uv(ci, x0, 0), bt.cell_uv(ci, x1, 0), bt.cell_uv(ci, x1, 1), bt.cell_uv(ci, x0, 1)]
    foot = tuple(k * 0.72 for k in tint)
    hw = width / 2
    for s in sides:
        ids = (t.vert(base - s * hw), t.vert(base + s * hw), t.vert(base + up * height + s * hw), t.vert(base + up * height - s * hw))
        t.faces.append((ids, uvs, [foot, foot, tint, tint], [normal] * 4, LEAF))


def stake(t, off=(0.11, 0.0), h=1.75):
    """A nursery stake beside a young trunk and its tie."""
    x, y = off
    t.tube([Vector((x, y, -0.2)), Vector((x, y, h))], [0.028, 0.026], 4, 2, False)
    t.tube([Vector((x, y, h * 0.75)), Vector((0.0, 0.0, h * 0.75 + 0.02))], [0.012, 0.012], 3, 3, False)


def dome_cards(t, cells, rx, hy, n, size, tints, z0=0.0, shape="dome", up=0.5):
    """Leaf cards over a dome, a vase or a cone (shrubs, the hedge's fluff, the conifer)."""
    rng = t.rng
    centre = Vector((0, 0, z0 + hy * 0.45))
    for _ in range(n):
        az = rng.uniform(0, TAU)
        if shape == "cone":
            z = rng.uniform(0.1, 0.95) ** 0.8 * hy
            r = rx * (1 - z / hy) ** 0.9 * rng.uniform(0.75, 1.05)
            c = Vector((math.cos(az) * r, math.sin(az) * r, z0 + z))
        else:
            el = rng.uniform(-0.35, 1.0) if shape == "dome" else rng.uniform(-0.15, 1.0)
            el = math.asin(max(-1.0, min(1.0, el)))
            f = rng.uniform(0.6, 1.0)
            wid = rx * (1.25 if shape == "vase" and el > 0.5 else 1.0)
            c = Vector((math.cos(az) * math.cos(el) * wid * f, math.sin(az) * math.cos(el) * wid * f, centre.z + math.sin(el) * hy * 0.55 * f))
        sz = size * rng.uniform(0.8, 1.2)
        if c.z < sz * 0.3:
            c.z = sz * 0.3
        out = c - centre
        outn = out.normalized() if out.length > 1e-3 else UP
        a = (outn * 0.5 + UP * up + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * 0.3).normalized()
        nrm = (outn * 0.75 + UP * 0.6).normalized()
        ao = 0.66 + 0.34 * bt.smooth(0.0, 1.0, (c.z - z0) / max(hy, 0.1))
        tint = tuple(k * ao for k in rng.choice(tints))
        t.card(c, a, sz, rng.choice(cells), nrm, tint, rng.random() < 0.5)


def stems(t, n, spread, h, r0=0.03):
    rng = t.rng
    for k in range(n):
        az = TAU * k / n + rng.uniform(-0.4, 0.4)
        p0 = Vector((math.cos(az) * 0.06, math.sin(az) * 0.06, -0.05))
        p1 = Vector((math.cos(az) * spread * 0.5, math.sin(az) * spread * 0.5, h * 0.5))
        p2 = Vector((math.cos(az) * spread, math.sin(az) * spread, h * rng.uniform(0.8, 1.0)))
        t.tube([p0, p1, p2], [r0, r0 * 0.6, r0 * 0.25], 4, 2, True)


GREENISH = [(1.0, 1.0, 1.0), (0.92, 0.97, 0.9), (0.85, 0.9, 0.85)]


# ------------------------------------------------------------------ the kinds


def young(name, seed, cells, height, tints, lat=(7, 9), leaf_size=0.55, spread=1.0):
    sp = dict(seed=seed, height=height, r0=0.055, clear=1.7, holes=2, bark_tint=(0.9, 0.86, 0.8),
              levels=[
                  dict(segs=4, sides=6, taper=0.2, wobble=0.04, tip=True, lat=lat, lat_t=(0.45, 0.97), lat_ang=(0.55, 0.85),
                       lat_len=0.4 * spread, lat_shrink=0.6, lat_r=0.5),
                  dict(segs=2, sides=4, taper=0.4, up=0.12, wobble=0.12, lat=(1, 2), lat_t=(0.4, 0.9), lat_ang=(0.5, 0.8), lat_len=0.5,
                       lat_r=0.7, fork=2, fork_ang=0.4, fork_len=0.5, fork_r=0.8),
                  dict(segs=1, sides=3, taper=0.3, up=0.08, wobble=0.15),
              ],
              leaf=dict(cells=cells, size=leaf_size * 1.18, p=0.88, at=(0.35, 0.7, 1.0), node_p=0.65, tints=tints))
    t = bt.Tree(name, sp, seed)
    t.grow(Vector((0, 0, 0)), UP.copy(), height, sp["r0"], 0)
    t.leaves()
    dome_cards(t, cells, 1.35 * spread, height * 0.52, 48, 0.92, [(0.95, 0.95, 0.9), (0.86, 0.89, 0.83)], z0=height * 0.51)
    stake(t)
    return t


def old(name, base, cells, seed, r0, twig=None, leaf_p=None):
    sp = dict(bt.KINDS[base])
    sp["seed"] = seed
    sp["r0"] = r0
    sp["clear"] = 2.8
    L = dict(sp["leaf"])
    L["cells"] = cells
    L["tints"] = [(0.95, 0.95, 0.90), (0.87, 0.89, 0.82)]
    L["size"] = L.get("size", 0.8) * 1.18
    if leaf_p is not None:
        L["p"] = leaf_p
    sp["leaf"] = L
    if twig:
        sp["twig_card"] = dict(sp.get("twig_card", {"size": 1.0, "p": 0.8}), cells=twig)
    t = bt.Tree(name, sp, seed)
    t.grow(Vector((0, 0, 0)), UP.copy(), sp["height"] * 1.15, r0, 0)
    t.leaves()
    if name != "old_bare":
        for pts, direction, level in t.twigs:
            top=pts[-1]
            if top.z < 3.4: continue
            for _ in range(5):
                c=top+Vector((t.rng.uniform(-.6,.6),t.rng.uniform(-.6,.6),t.rng.uniform(-.4,.5)))
                axis=Vector((t.rng.uniform(-1,1),t.rng.uniform(-1,1),t.rng.uniform(.1,1))).normalized()
                normal=(Vector((c.x,c.y,.8)).normalized()+UP*.5).normalized()
                t.card(c,axis,t.rng.uniform(.95,1.5),t.rng.choice(cells),normal,t.rng.choice(L["tints"]),t.rng.random()<.5)
    return t


def ancient_oak():
    """One retained veteran: buttress roots, a wide trunk and six spreading scaffold limbs."""
    import json
    anchors = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "shared", "parkTreeLife.json")))["old_oak"]
    t = bt.Tree("old_oak", dict(clear=0.0, bark_tint=(.82,.78,.67)), 1731)
    rng=t.rng
    t.tube([Vector((0,0,-.12)),Vector((.06,-.04,.65)),Vector((-.08,.04,2.0)),Vector((0,0,3.35)),Vector((.15,.08,6.4)),Vector((-.1,0,10.4)),Vector((0,0,13.4))], [1.15,.96,.89,.78,.50,.29,.05], 12, 0, True)
    for i in range(8):
        a=i*TAU/8;rad=Vector((math.cos(a),math.sin(a),0))
        t.tube([rad*.65+UP*.8,rad*1.2+UP*.15,rad*1.55-UP*.02],[.23,.15,.035],5,0,True)
    for i,(x,y,z) in enumerate(anchors["perches"]):
        end=Vector((x,-z,y));start=Vector((0,0,3.35+i*.75))
        knee=start*.4+end*.6-UP*.4
        t.tube([start,knee,end,end*1.19+UP*1.1],[.42-i*.035,.29-i*.025,.14,.035],8,0,True)
        for j in range(6):
            a=j*TAU/6+i*.7
            tip=end+Vector((math.cos(a)*rng.uniform(1.5,2.5),math.sin(a)*rng.uniform(1.5,2.5),rng.uniform(1.4,2.7)))
            t.tube([end,(end+tip)*.5-UP*.12,tip],[.10,.065,.016],5,0,True)
            for k in range(32):
                az=rng.uniform(0,TAU);el=rng.uniform(-.55,1.1);r=rng.uniform(.3,1.7)
                c=tip+Vector((math.cos(az)*r,math.sin(az)*r,el*1.2))
                axis=Vector((rng.uniform(-1,1),rng.uniform(-1,1),rng.uniform(.1,1))).normalized()
                normal=(Vector((c.x,c.y,1)).normalized()+UP*.8).normalized()
                t.card(c,axis,rng.uniform(1.15,1.8),CELLS["elm"],normal,rng.choice([(.89,.86,.70),(.98,.94,.79),(.85,.89,.75)]),rng.random()<.5)
    return t


def weeping():
    """A branching willow with hanging shoots, not vertical bundles of crossed reeds."""
    t = bt.Tree("weeping", dict(clear=0.0, bark_tint=(0.86, 0.82, 0.72)), 91)
    rng, ci = t.rng, CELLS["willow"]
    t.tube([Vector((0, 0, -.08)), Vector((.09, -.06, 1.5)), Vector((-.12, .10, 3.3)), Vector((.12, .02, 4.5))], [.16, .12, .075, .018], 7, 0, True)
    tints = [(1.0, 1.0, .94), (.90, .96, .87), (.94, .93, .79)]
    for k in range(11):
        az = k * TAU / 11 + rng.uniform(-.15, .15)
        reach, high = rng.uniform(1.6, 2.7), rng.uniform(3.7, 5.2)
        radial = Vector((math.cos(az), math.sin(az), 0))
        pts = [Vector((0, 0, 2.0 + .09*k)), radial*reach*.42 + UP*high,
               radial*reach*.8 + UP*(high-.12), radial*reach + UP*(high-.65)]
        t.tube(pts, [.06, .045, .022, .008], 5, 0, True)
        for j in range(7):
            f = .35+j*.10
            top = radial*(reach*f) + Vector((rng.uniform(-.28,.28), rng.uniform(-.28,.28), high - max(0,f-.65)*1.8))
            length = rng.uniform(1.45, 2.55) * (.7 + f*.3)
            end = top + radial*.14 - UP*length
            t.tube([top, (top+end)*.5+radial*.13, end], [.01,.006,.002], 3, 0, False)
            rect_card(t, end, UP, rng.uniform(.62,.91), length, ci, (radial*.6+UP*.7).normalized(),rng.choice(tints),rng.random()<.5)
    dome_cards(t, [ci], 1.5, 1.7, 25, .95, tints, z0=3.5, up=.2)
    return t


def conifer():
    t = bt.Tree("conifer", dict(clear=0.0, bark_tint=(0.7, 0.6, 0.5)), 97)
    t.tube([Vector((0, 0, -0.1)), Vector((0, 0, 3.4))], [0.08, 0.01], 5, 0, True)
    dome_cards(t, [CELLS["needles"]], 1.25, 3.6, 90, 0.75, [(0.95, 1.0, 0.95), (0.85, 0.9, 0.88), (1.0, 1.0, 1.0)], shape="cone", up=0.9)
    return t


def shrub(name, seed, cells, rx, hy, n, size, tints, nstems=5, shape="dome", up=0.5):
    t = bt.Tree(name, dict(clear=0.0, bark_tint=(0.7, 0.62, 0.55)), seed)
    stems(t, nstems, rx * 0.6, hy * 0.75)
    dome_cards(t, cells, rx, hy, n, size, tints, shape=shape, up=up)
    return t


def hedge():
    """One metre of clipped privet: a core box with the full-leaf cell on its faces, fluff on the top and sides."""
    t = bt.Tree("hedge", dict(clear=0.0), 101)
    ci = CELLS["privet_full"]
    x0, x1, y0, y1, z0, z1 = -0.5, 0.5, -0.45, 0.45, -0.05, 0.95
    faces = [
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1), 1.0),
        ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0.35), 0.8),
        ([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], (0, 1, 0.35), 0.8),
        ([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], (-1, 0, 0.35), 0.75),
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0.35), 0.75),
    ]
    for pts, nrm, sh in faces:
        ids = tuple(t.vert(p) for p in pts)
        uvs = [bt.cell_uv(ci, 0, 0), bt.cell_uv(ci, 1, 0), bt.cell_uv(ci, 1, 1), bt.cell_uv(ci, 0, 1)]
        foot = (sh * 0.72,) * 3
        top = (sh,) * 3
        cols = [top] * 4 if nrm[2] == 1 else [foot, foot, top, top]
        t.faces.append((ids, uvs, cols, [Vector(nrm).normalized()] * 4, LEAF))
    rng = t.rng
    for _ in range(9):
        c = Vector((rng.uniform(-0.45, 0.45), rng.choice([-1, 1]) * rng.uniform(0.3, 0.46), rng.uniform(0.45, 0.95)))
        if rng.random() < 0.4:
            c = Vector((rng.uniform(-0.45, 0.45), rng.uniform(-0.35, 0.35), 0.95))
        out = Vector((0, c.y, max(c.z - 0.6, 0))).normalized()
        t.card(c, (out + UP * 0.6).normalized(), rng.uniform(0.35, 0.5), CELLS["privet"], (out * 0.6 + UP * 0.7).normalized(),
               rng.choice(GREENISH), rng.random() < 0.5)
    return t


def water_plant(name, seed, ci, n, w, h, spread, tints, lean=0.12):
    t = bt.Tree(name, dict(clear=0.0), seed)
    rng = t.rng
    for _ in range(n):
        base = Vector((rng.uniform(-spread, spread), rng.uniform(-spread, spread), -0.05))
        up = (UP + Vector((rng.uniform(-lean, lean), rng.uniform(-lean, lean), 0))).normalized()
        nrm = (Vector((base.x, base.y, 0)) * 0.6 + UP * 0.8).normalized() if base.length > 0.05 else UP
        rect_card(t, base, up, w * rng.uniform(0.8, 1.2), h * rng.uniform(0.8, 1.15), ci, nrm, rng.choice(tints), rng.random() < 0.5)
    return t


def lily():
    t = bt.Tree("lily", dict(clear=0.0), 131)
    ci = CELLS["lily"]
    h = 0.45
    ids = (t.vert((-h, -h, 0.0)), t.vert((h, -h, 0.0)), t.vert((h, h, 0.0)), t.vert((-h, h, 0.0)))
    uvs = [bt.cell_uv(ci, 0, 0), bt.cell_uv(ci, 1, 0), bt.cell_uv(ci, 1, 1), bt.cell_uv(ci, 0, 1)]
    # (the Codex pads are a bright green: toned down to the pond's grey light)
    tint = (0.62, 0.68, 0.58) if os.path.exists(os.path.join(ART, "park_lilies.png")) else (0.9, 0.9, 0.9)
    t.faces.append((ids, uvs, [tint] * 4, [UP] * 4, LEAF))
    return t


def build_all():
    C = CELLS
    out = [
        young("young_lime", 211, [C["lime"]], 3.3, bt.YELLOW_TINTS),
        young("young_maple", 223, [C["maple"]], 2.9, [(1.0, 0.95, 0.9), (0.95, 0.85, 0.8), (1.0, 1.0, 1.0)], lat=(8, 10), spread=1.15),
        young("young_chestnut", 227, [C["chestnut"]], 3.0, bt.RUST_TINTS, lat=(6, 8), leaf_size=0.7, spread=1.2),
        young("young_elm", 229, [C["elm"]], 3.4, bt.YELLOW_TINTS + bt.RUST_TINTS[:2], lat=(8, 10)),
        old("old_elm", "tree_elm", [C["elm"]], 311, 0.3),
        old("old_plane", "tree_plane", [C["plane"]], 313, 0.34, twig=[C["plane_sparse"], C["twigs"]]),
        old("old_bare", "tree_bare", [C["elm"]], 317, 0.28, twig=[C["twigs"]]),
        ancient_oak(),
        weeping(),
        conifer(),
        shrub("shrub_ever", 401, [C["rhodo"]], 0.95, 1.6, 46, 0.62, GREENISH),
        shrub("shrub_holly", 403, [C["holly"]], 0.7, 2.1, 44, 0.55, GREENISH, nstems=3, shape="cone", up=0.8),
        shrub("shrub_hazel", 405, [C["hazel"]], 1.1, 2.3, 42, 0.62, bt.YELLOW_TINTS, nstems=7, shape="vase", up=0.7),
        shrub("shrub_red", 407, [C["maple"]], 0.85, 1.3, 36, 0.55, [(1.0, 0.95, 0.9), (0.92, 0.85, 0.8)], nstems=5),
        shrub("shrub_bare", 409, [C["twigs"]], 0.9, 1.8, 30, 0.7, [(0.95, 0.92, 0.9)], nstems=7, shape="vase", up=0.8),
        hedge(),
        # (the Codex cards hold a whole clump on a square: square cards, a few each; the painted ones are single stems)
        # (their straw and plumes are pale: toned down and a little toward green, or they read as pink pampas in the mist)
        *((water_plant("reed", 501, C["reed"], 3, 1.8, 1.95, 0.25, [(0.64, 0.7, 0.55), (0.56, 0.62, 0.48)]),
           water_plant("cattail", 503, C["cattail"], 3, 1.4, 1.5, 0.2, [(0.74, 0.78, 0.66), (0.66, 0.7, 0.58)]),
           water_plant("sedge", 505, C["sedge"], 2, 0.8, 0.75, 0.15, [(0.7, 0.76, 0.62), (0.62, 0.68, 0.55)], lean=0.15),
           water_plant("iris", 507, C["iris"], 2, 0.9, 0.95, 0.12, [(0.8, 0.84, 0.72), (0.72, 0.76, 0.64)]))
          if os.path.exists(os.path.join(ART, "park_reeds.png")) else
          (water_plant("reed", 501, C["reed"], 6, 0.55, 2.0, 0.35, [(1.0, 1.0, 1.0), (0.9, 0.88, 0.82)]),
           water_plant("cattail", 503, C["cattail"], 5, 0.55, 1.5, 0.3, [(1.0, 1.0, 1.0), (0.9, 0.9, 0.85)]),
           water_plant("sedge", 505, C["sedge"], 4, 0.6, 0.65, 0.25, [(1.0, 1.0, 1.0), (0.9, 0.9, 0.85)], lean=0.2),
           water_plant("iris", 507, C["iris"], 4, 0.5, 0.9, 0.2, [(1.0, 1.0, 1.0), (0.9, 0.88, 0.8)]))),
        water_plant("flowers", 509, C["flowers"], 4, 0.45, 0.5, 0.18, [(1.0, 1.0, 1.0), (0.9, 0.9, 0.9)], lean=0.15),
        lily(),
    ]
    return out


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    plants = build_all()
    objs = [t.to_object() for t in plants]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for t in plants:
        top = max(v.z for v in t.v)
        print(f"[build_park_plants] {t.name:15s} {t.tris():5d} tris (bark {t.tris(BARK)}, leaves {t.tris(LEAF)}), {top:.1f} m tall")
    print(f"[build_park_plants] {len(plants)} kinds -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        # build_trees.py's preview puts them in one row: here a grid of 7 by 3, 6 m apart, the camera further off
        n = len(objs)
        rows = [objs[i:i + 7] for i in range(0, n, 7)]
        bt.preview([])  # (sets up the materials, the sky, the sun and the camera; renders an empty row)
        for r, row in enumerate(rows):
            for i, o in enumerate(row):
                o.location = ((i - 3) * 6.0, r * 9.0, 0)
        cam = bpy.context.scene.camera
        cam.location = Vector((0, -30, 9))
        cam.rotation_euler = (Vector((0, 8, 3)) - cam.location).to_track_quat("-Z", "Y").to_euler()
        dst = os.path.join(bt.SHOTS, "park_plants_preview.png")
        bpy.context.scene.render.filepath = dst
        bpy.ops.render.render(write_still=True)
        print(f"[build_park_plants] preview -> {dst}")


if __name__ == "__main__":
    main()
