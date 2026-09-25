"""The back streets and the cathedral quarter of Antwerp, 1873 (M6 lively): the things people use.

    blender -b --factory-startup -P tools/blender/build_lively.py [-- --preview]

Writes client/public/models/lively.glb (Draco). One node per model, real scale in metres, built
with the same helpers and conventions as build_streetlife.py (Blender Z up; the export turns it Y
up; a thing's front looks toward -Y, which is +Z in the game). Placed by client/src/game/lively.ts:
the static things merged per chunk (the stalls, the goods outside the shops, flower pots, chalk on
the stones), the moving things as objects (the dog carts, the grinder's barrow, what people carry).

  stalls     the lean-to stalls against the cathedral: candles, rosaries, holy pictures
             (stall_*: the origin is where the keeper stands; the counter before her)
  spill      goods set out before the shops (spill_*: the origin on the wall at its foot):
             baskets of vegetables, crockery on a trestle, clogs on a bench, brooms, sacks of
             grain, the butcher's rail with hams and a side of beef, loaves on the sill, coal
             sacks, bolts of cloth, wine casks
  windows    flower pots on a sill board (pots_sill), pots by a door (pots_door)
  chalk      hopscotch squares and a marbles ring on the stones (decals)
  dog carts  the cart (dogcart_milk with copper cans, dogcart_bread with loaves), its wheel,
             a harness band for a dog
  grinder    the knife grinder's barrow: frame and treadle, the wheel it runs on, the stone,
             the flywheel
  in hand    a bucket and a scrubbing brush, a rush chair, the lace pillow on its stand, a hoop
             and stick, a spinning top, marbles, a milk can, a bread basket, a bundle of brooms
             on the shoulder, a bunch of flowers
  animals    a hen (body, head, leg) and a goat (body, head, leg), moved in code
  wet        the wet stone left behind a scrubbed step (decal)

Materials, by name: lv_solid (one atlas for everything solid), lv_decal (flat things on the
ground), lv_puddle (unused), lv_glow (unused). Vertex colour "Col" carries a baked shade.
Our own work: nothing downloaded. Sources for the look are in docs/milestones/M6-lively.md.
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import build_streetlife as sl  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "lively.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

# our own atlases and material names (the streetlife Mesh class reads these module globals)
sl.SOLID_ATLAS = sl.Atlas(256)
sl.DECAL_ATLAS = sl.Atlas(256)
sl.MAT_NAMES = ["lv_solid", "lv_decal", "lv_puddle", "lv_glow"]
SOLID, DECAL = sl.SOLID, sl.DECAL
Mesh = sl.Mesh
move = sl.move

PLAIN = {
    "wood": ((0.40, 0.31, 0.21), 0.3),
    "wood_dark": ((0.20, 0.14, 0.10), 0.3),
    "wood_light": ((0.58, 0.46, 0.30), 0.25),
    "planks": ((0.30, 0.24, 0.17), 0.35),
    "slate": ((0.22, 0.24, 0.26), 0.2),
    "tarred": ((0.10, 0.09, 0.08), 0.25),
    "iron": ((0.10, 0.10, 0.11), 0.3),
    "copper": ((0.62, 0.36, 0.20), 0.2),
    "brass": ((0.66, 0.52, 0.26), 0.2),
    "green_paint": ((0.14, 0.30, 0.18), 0.2),
    "red_paint": ((0.45, 0.10, 0.08), 0.2),
    "blue_paint": ((0.18, 0.26, 0.42), 0.2),
    "wicker": ((0.54, 0.42, 0.24), 0.35),
    "bread": ((0.62, 0.42, 0.20), 0.2),
    "crust": ((0.44, 0.26, 0.12), 0.2),
    "meat": ((0.52, 0.16, 0.14), 0.2),
    "fat": ((0.82, 0.74, 0.62), 0.12),
    "ham": ((0.50, 0.28, 0.18), 0.2),
    "delft": ((0.80, 0.82, 0.86), 0.08),
    "delft_blue": ((0.20, 0.28, 0.56), 0.15),
    "clay": ((0.62, 0.38, 0.24), 0.2),
    "stoneware": ((0.56, 0.52, 0.46), 0.15),
    "sack": ((0.58, 0.50, 0.36), 0.25),
    "grain": ((0.74, 0.62, 0.34), 0.25),
    "coal": ((0.06, 0.06, 0.06), 0.4),
    "coal_sack": ((0.16, 0.15, 0.14), 0.3),
    "candle": ((0.90, 0.86, 0.72), 0.06),
    "wax": ((0.84, 0.72, 0.42), 0.1),
    "flame": ((1.0, 0.8, 0.4), 0.05),
    "flower_red": ((0.70, 0.12, 0.10), 0.2),
    "flower_white": ((0.86, 0.84, 0.78), 0.1),
    "flower_yellow": ((0.80, 0.66, 0.18), 0.2),
    "leaf": ((0.16, 0.30, 0.12), 0.25),
    "terracotta": ((0.58, 0.28, 0.16), 0.2),
    "apple": ((0.60, 0.16, 0.10), 0.25),
    "cabbage": ((0.34, 0.48, 0.22), 0.25),
    "carrot": ((0.72, 0.36, 0.12), 0.2),
    "onion": ((0.66, 0.50, 0.30), 0.2),
    "cloth_blue": ((0.24, 0.30, 0.44), 0.12),
    "cloth_red": ((0.55, 0.16, 0.12), 0.12),
    "cloth_grey": ((0.42, 0.41, 0.38), 0.12),
    "cloth_brown": ((0.36, 0.26, 0.18), 0.12),
    "linen": ((0.84, 0.80, 0.70), 0.1),
    "bristle": ((0.30, 0.24, 0.14), 0.4),
    "birch": ((0.40, 0.30, 0.20), 0.45),
    "straw": ((0.66, 0.56, 0.30), 0.3),
    "rope": ((0.46, 0.40, 0.30), 0.25),
    "stone": ((0.44, 0.44, 0.42), 0.3),
    "beads": ((0.18, 0.12, 0.08), 0.3),
    "gilt": ((0.72, 0.56, 0.22), 0.25),
    "hen": ((0.72, 0.60, 0.42), 0.3),
    "hen_red": ((0.60, 0.14, 0.10), 0.15),
    "beak": ((0.78, 0.60, 0.24), 0.1),
    "goat": ((0.78, 0.74, 0.66), 0.25),
    "goat_dark": ((0.30, 0.26, 0.22), 0.3),
    "horn": ((0.42, 0.38, 0.30), 0.2),
    "leather": ((0.30, 0.18, 0.10), 0.25),
}

STALL_SIGNS = {"candles": "CANDLES", "rosaries": "ROSARIES", "prints": "HOLY PICTURES"}


def paint_sign(text, seed):
    """A little painted board over a stall: dark green, cream letters."""
    w = sl.text_width(text) + 8
    img = sl.wood_board(seed, w, 11, (0.12, 0.2, 0.14))
    img[0, :, :3] *= 0.5
    img[-1, :, :3] *= 0.5
    sl.draw_text(img, text, 4, 2, (0.86, 0.8, 0.6))
    return img


# Holy pictures, 7 x 10 px inside a 1 px frame: our own pixel paintings after the coloured devotional
# prints sold at the cathedral (Our Lady of Antwerp in her blue mantle and crown, the Sacred Heart,
# the crucifix, Saint Anthony with the Child, Saint Joseph with his lily staff).
HOLY_PAINT = {
    "g": (0.72, 0.56, 0.22), "y": (0.92, 0.78, 0.30), "s": (0.86, 0.68, 0.54), "w": (0.92, 0.90, 0.84),
    "b": (0.16, 0.26, 0.58), "r": (0.62, 0.14, 0.12), "p": (0.88, 0.84, 0.72), "h": (0.74, 0.10, 0.10),
    "f": (0.95, 0.60, 0.15), "d": (0.22, 0.10, 0.08), "l": (0.62, 0.72, 0.84), "k": (0.28, 0.17, 0.10),
    "n": (0.42, 0.32, 0.18), "o": (0.44, 0.29, 0.16), "e": (0.22, 0.42, 0.26), "c": (0.92, 0.76, 0.62),
}
HOLY = {
    "madonna": ["ggyyygg", "gwsssw" + "g", "gwsssw" + "g", "gbwwwbg", "gbscrbg", "gbbrrbg", "bbrrrbb", "bbbrbbb", "bbbbbbb", "gbbbbbg"],
    "madonna_red": ["llyyyll", "lwsssw" + "l", "lwsssw" + "l", "lrwwwrl", "lrscbrl", "lrbbbrl", "rrbbbrr", "rrrbrrr", "rrrrrrr", "lrrrrrl"],
    "heart": ["pppfppp", "ppfyfpp", "pphdhpp", "phhhhhp", "hhhhhhh", "hhhhhhh", "phhhhhp", "pphhhpp", "ppphppp", "ppppppp"],
    "cross": ["lllklll", "lllslll", "kkssskk", "lllslll", "lllslll", "lllklll", "lllklll", "lllklll", "lnnknnl", "nnnnnnn"],
    "anthony": ["llyyyll", "lysssyl", "llsssll", "loooool", "oooowwl", "oooowsl", "ooooowl", "looooll", "loooool", "lnoooll"],
    "joseph": ["llyyyll", "lysssyl", "llsssll", "leeeenw", "eeeeenw", "eeeeenl", "leeeenl", "leeeenl", "leeeenl", "lnnnnnl"],
}


def paint_prints(seed):
    """Holy pictures pinned in rows on the stall's boards: 8 across, 4 rows, each a little painted
    saint or Madonna in a gilt or black frame (the counter shows the lower two rows)."""
    rng = np.random.default_rng(seed)
    w, h = 96, 52
    img = np.ones((h, w, 4))
    img[..., :3] = (0.30, 0.24, 0.17)
    img[..., :3] *= (0.85 + 0.3 * rng.random((h, w)))[..., None] * 0.9 + 0.1
    kinds = list(HOLY)
    weights = np.array([0.34, 0.12, 0.16, 0.14, 0.12, 0.12])
    for row in range(4):
        for col in range(8):
            x0 = col * 12 + 1 + int(rng.integers(0, 2))
            y0 = row * 13 + 1
            k = kinds[int(rng.choice(len(kinds), p=weights / weights.sum()))]
            frame = (0.70, 0.55, 0.22) if rng.random() < 0.6 else (0.12, 0.10, 0.08)
            img[y0:y0 + 12, x0:x0 + 9, :3] = frame
            for r, line in enumerate(HOLY[k]):
                for c, ch in enumerate(line):
                    img[y0 + 1 + r, x0 + 1 + c, :3] = HOLY_PAINT[ch]
            # the paper is old: a little faded, now and then a speck
            img[y0 + 1:y0 + 11, x0 + 1:x0 + 8, :3] = img[y0 + 1:y0 + 11, x0 + 1:x0 + 8, :3] * 0.92 + 0.04
    return img


def paint_chalk_hop(seed):
    """Hopscotch drawn in chalk: squares 1 to 8 up the stones and the half-round at the top."""
    rng = np.random.default_rng(seed)
    w, h = 32, 80
    img = np.zeros((h, w, 4))
    chalk = np.array((0.92, 0.92, 0.88))

    def line(x0, y0, x1, y1):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for t in np.linspace(0, 1, n):
            x, y = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
            if 0 <= x < w and 0 <= y < h and rng.random() < 0.85:
                img[y, x, :3] = chalk
                img[y, x, 3] = 0.8
    rows = [(0, [(6, 26)]), (10, [(6, 26)]), (20, [(2, 16), (16, 30)]), (30, [(6, 26)]), (40, [(2, 16), (16, 30)]), (50, [(6, 26)]), (60, [(6, 26)])]
    for y, spans in rows:
        for a, b in spans:
            line(a, y + 2, b, y + 2)
            line(a, y + 12, b, y + 12)
            line(a, y + 2, a, y + 12)
            line(b, y + 2, b, y + 12)
    for k in range(13):
        a0, a1 = math.pi * k / 13, math.pi * (k + 1) / 13
        line(16 + 10 * math.cos(a0), 72 + 7 * math.sin(a0), 16 + 10 * math.cos(a1), 72 + 7 * math.sin(a1))
    for i, (x, y) in enumerate(((16, 7), (16, 17), (9, 27), (23, 27), (16, 37), (9, 47), (23, 47), (16, 57))):
        sl.draw_text(img, str(i + 1), x - 2, y - 3, (0.9, 0.9, 0.86, 0.85))
    return img


def paint_chalk_ring(seed):
    rng = np.random.default_rng(seed)
    w = h = 32
    img = np.zeros((h, w, 4))
    for a in np.linspace(0, 2 * math.pi, 160):
        x, y = int(16 + 14 * math.cos(a)), int(16 + 14 * math.sin(a))
        if rng.random() < 0.9:
            img[y, x, :3] = (0.92, 0.92, 0.88)
            img[y, x, 3] = 0.8
    return img


def paint_wet(seed):
    """Wet stone: a dark patch, ragged at the edge (alpha); the game fades it as it dries."""
    rng = np.random.default_rng(seed)
    w, h = 32, 32
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    n = sl.vnoise(rng, w, h, 5, 5)
    d = np.hypot((uu - w / 2) / (w / 2), (vv - h / 2) / (h / 2)) + (n - 0.5) * 0.7
    img = np.zeros((h, w, 4))
    img[..., :3] = 0.0
    img[..., 3] = np.clip((1.0 - d) * 2.2, 0, 1) * 0.55
    return img


def build_atlases():
    for i, (name, (rgb, amt)) in enumerate(PLAIN.items()):
        size = 32 if name in ("wood", "planks", "wicker", "slate") else 16
        sl.SOLID_ATLAS.add(name, sl.flat(900 + i, size, size, rgb, amt))
    for i, (k, text) in enumerate(STALL_SIGNS.items()):
        sl.SOLID_ATLAS.add(f"sign_{k}", paint_sign(text, 1000 + i))
    sl.SOLID_ATLAS.add("prints", paint_prints(1010))
    sl.DECAL_ATLAS.add("chalk_hop", paint_chalk_hop(1020))
    sl.DECAL_ATLAS.add("chalk_ring", paint_chalk_ring(1021))
    sl.DECAL_ATLAS.add("wet_0", paint_wet(1022))
    sl.SOLID_ATLAS.pack()
    sl.DECAL_ATLAS.pack()


def make_materials():
    solid = sl.bl_image("lv_solid_tex", sl.SOLID_ATLAS.img, False)
    decal = sl.bl_image("lv_decal_tex", sl.DECAL_ATLAS.img, True)
    for name, img in zip(sl.MAT_NAMES, [solid, decal, decal, solid]):
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


# ------------------------------------------------------------------ the stalls against the cathedral


def stall(goods):
    """A lean-to stall: the counter before the keeper, two posts at its corners, the tarred roof
    sloping up behind her to a plank back wall (the church side), a painted board on the counter.
    The origin is where the keeper stands; the customers come from -Y."""
    m = Mesh(ao=2.0)
    W = 2.5
    yf, yb = -0.95, 0.9
    # the counter: a plank box and a top board
    m.box((0, yf + 0.2, 0.44), (W - 0.1, 0.4, 0.88), "planks")
    m.box((0, yf + 0.18, 0.9), (W + 0.05, 0.56, 0.05), "wood")
    # the posts and the header beam
    for sx in (-1, 1):
        m.beam((sx * W / 2, yf - 0.08, 0), (sx * W / 2, yf - 0.08, 2.2), 0.09, 0.09, "wood_dark")
        m.beam((sx * W / 2, yb, 0), (sx * W / 2, yb, 2.75), 0.09, 0.09, "wood_dark")
        # the side boards, half way up
        m.face([(sx * W / 2, yf, 0.9), (sx * W / 2, yb, 0.9), (sx * W / 2, yb, 2.7), (sx * W / 2, yf, 2.12)], "planks", shade=0.8, out=(sx, 0, 0))
    m.beam((-W / 2 - 0.1, yf - 0.08, 2.2), (W / 2 + 0.1, yf - 0.08, 2.2), 0.1, 0.12, "wood_dark")
    # the roof, tarred boards, a little over the counter
    m.face([(-W / 2 - 0.15, yf - 0.4, 2.12), (W / 2 + 0.15, yf - 0.4, 2.12), (W / 2 + 0.15, yb + 0.1, 2.8), (-W / 2 - 0.15, yb + 0.1, 2.8)], "tarred", out=(0, -0.6, 1))
    m.face([(-W / 2 - 0.15, yf - 0.4, 2.1), (W / 2 + 0.15, yf - 0.4, 2.1), (W / 2 + 0.15, yb + 0.1, 2.78), (-W / 2 - 0.15, yb + 0.1, 2.78)], "planks", shade=0.5, out=(0, 0.6, -1))
    # the back wall of planks
    m.face([(-W / 2, yb, 0), (W / 2, yb, 0), (W / 2, yb, 2.75), (-W / 2, yb, 2.75)], "planks", shade=0.75, out=(0, -1, 0))
    # the name board on the front of the counter: never wider than the counter between the posts
    x, y, w, h = sl.SOLID_ATLAS.cells[f"sign_{goods}"]
    px = min(0.036, (W - 0.3) / w)
    L, Hb = w * px, h * px
    zb = 0.56 - Hb / 2
    m.face([(-L / 2, yf - 0.025, zb), (L / 2, yf - 0.025, zb), (L / 2, yf - 0.025, zb + Hb), (-L / 2, yf - 0.025, zb + Hb)],
           f"sign_{goods}", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -1, 0))
    print(f"[build_lively] stall_{goods}: name board {L:.2f} m wide on a counter of {W - 0.1:.2f} m between posts {W:.2f} m apart")
    assert L <= W - 0.3 + 1e-6, f"stall_{goods}: the name board is wider than the stall"
    top = 0.925
    if goods == "candles":
        # bundles of tallow candles on the counter, tall votive candles, bundles hanging from the beam
        for i, x0 in enumerate(np.linspace(-1.0, 1.0, 7)):
            for k in range(5):
                m.box((x0 + (k % 3 - 1) * 0.03, yf + 0.1 + (k // 3) * 0.04, top + 0.1), (0.02, 0.02, 0.2), "candle")
        for x0 in (-0.6, 0.0, 0.6):
            m.lathe([(0.03, top), (0.03, top + 0.36)], 6, "wax", cap1=True, M=move(x0, yf + 0.35, 0))
        for x0 in np.linspace(-1.05, 1.05, 8):
            m.beam((x0, yf - 0.1, 2.14), (x0, yf - 0.1, 1.9), 0.006, 0.006, "rope")
            for k in range(4):
                m.box((x0 + (k - 1.5) * 0.02, yf - 0.1, 1.72), (0.018, 0.018, 0.32), "candle")
    elif goods == "rosaries":
        # rosaries hanging in loops from the beam, crosses and medals in a tray
        for x0 in np.linspace(-1.1, 1.1, 12):
            loop = [(x0 + 0.06 * math.sin(a), yf - 0.1, 2.12 - 0.35 * (1 - math.cos(a)) / 2 - 0.1) for a in np.linspace(0, 2 * math.pi, 9)]
            m.tube(loop, 0.008, 3, "beads", closed=True)
            m.box((x0, yf - 0.1, 1.62), (0.012, 0.012, 0.07), "gilt")
        m.box((0, yf + 0.2, top + 0.02), (1.6, 0.4, 0.04), "cloth_red")
        for x0 in np.linspace(-0.7, 0.7, 9):
            for y0 in (yf + 0.1, yf + 0.3):
                m.box((x0, y0, top + 0.05), (0.03, 0.05, 0.012), "gilt")
    else:
        # holy pictures pinned on the back wall and on a board over the counter, a stack of them
        m.face([(-1.1, yb - 0.01, 1.0), (1.1, yb - 0.01, 1.0), (1.1, yb - 0.01, 2.2), (-1.1, yb - 0.01, 2.2)], "prints", uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], out=(0, -1, 0))
        m.face([(-0.9, yf + 0.02, top + 0.02), (0.9, yf + 0.02, top + 0.02), (0.9, yf + 0.22, top + 0.5), (-0.9, yf + 0.22, top + 0.5)], "prints", uvs=[(0, 0), (1, 0), (1, 0.5), (0, 0.5)], out=(0, -1, 0.3))
        for x0 in (-0.9, 0.9):
            m.box((x0, yf + 0.3, top + 0.04), (0.3, 0.22, 0.06), "linen")
    return m


# ------------------------------------------------------------------ goods set out before the shops


def basket(m, x, y, z, r, h, fill):
    m.lathe([(r * 0.8, z), (r, z + h * 0.8), (r * 1.02, z + h)], 8, "wicker", cap0=True, M=move(x, y, 0))
    if fill:
        for k in range(7):
            a = k * 2.3
            rr = r * 0.55 * (k % 3) / 2
            m.box((x + rr * math.cos(a), y + rr * math.sin(a), z + h + 0.02), (0.07, 0.07, 0.07), fill)


def spill(kind):
    m = Mesh(ao=1.2)
    if kind == "baskets":
        basket(m, -0.45, -0.3, 0.0, 0.22, 0.3, "apple")
        basket(m, 0.05, -0.32, 0.0, 0.24, 0.28, "cabbage")
        m.box((0.55, -0.28, 0.2), (0.45, 0.38, 0.4), "wood")
        basket(m, 0.55, -0.28, 0.4, 0.16, 0.2, "carrot")
        basket(m, 0.95, -0.25, 0.0, 0.18, 0.26, "onion")
    elif kind == "crockery":
        m.box((0, -0.28, 0.66), (1.1, 0.46, 0.04), "wood_light")
        for sx in (-1, 1):
            m.beam((sx * 0.48, -0.08, 0), (sx * 0.48, -0.08, 0.64), 0.05, 0.05, "wood")
            m.beam((sx * 0.48, -0.48, 0), (sx * 0.48, -0.48, 0.64), 0.05, 0.05, "wood")
        for i, x in enumerate(np.linspace(-0.4, 0.4, 4)):
            cell = "delft" if i % 2 == 0 else "stoneware"
            m.lathe([(0.12, 0.68), (0.13, 0.7 + 0.02 * (i + 2))], 8, cell, cap1=True, M=move(x, -0.36, 0))
            m.lathe([(0.05, 0.68), (0.07, 0.74), (0.06, 0.86), (0.035, 0.9), (0.045, 0.94)], 6, "clay" if i % 2 else "delft_blue", cap0=True, M=move(x + 0.08, -0.14, 0))
        for x in (-0.35, 0.3):
            m.lathe([(0.12, 0.0), (0.16, 0.12), (0.12, 0.3), (0.08, 0.34)], 8, "stoneware", cap0=True, M=move(x, -0.62, 0))
    elif kind == "clogs":
        m.box((0, -0.22, 0.2), (1.1, 0.36, 0.04), "wood")
        for sx in (-1, 1):
            m.box((sx * 0.5, -0.22, 0.1), (0.05, 0.3, 0.2), "wood")
        for i, x in enumerate(np.linspace(-0.42, 0.42, 5)):
            for dx in (-0.05, 0.05):
                m.box((x + dx, -0.24, 0.27), (0.08, 0.26, 0.09), "wood_light")
                m.box((x + dx, -0.32, 0.33), (0.07, 0.1, 0.04), "wood_light", shade=0.85)
        for i, x in enumerate(np.linspace(-0.3, 0.3, 4)):
            m.box((x, -0.06, 1.25 - 0.05 * (i % 2)), (0.08, 0.1, 0.24), "wood_light")
        m.beam((-0.45, -0.02, 1.4), (0.45, -0.02, 1.4), 0.01, 0.01, "rope")
    elif kind == "brooms":
        for i, x in enumerate(np.linspace(-0.4, 0.4, 5)):
            top = (x, -0.05, 1.45)
            foot = (x + 0.04, -0.42, 0.28)
            m.beam(top, foot, 0.03, 0.03, "wood_light")
            m.lathe([(0.03, 0.0), (0.09, 0.14), (0.1, 0.3), (0.035, 0.34)], 6, "birch", cap0=True, M=move(foot[0], foot[1] - 0.02, 0))
        m.lathe([(0.12, 0.0), (0.14, 0.4), (0.1, 0.9)], 6, "birch", cap0=True, M=move(0.75, -0.25, 0))
    elif kind == "sacks":
        for i, x in enumerate((-0.5, 0.0, 0.5)):
            m.lathe([(0.2, 0.0), (0.25, 0.2), (0.24, 0.45), (0.23, 0.52), (0.27, 0.58), (0.24, 0.6)], 8, "sack", cap0=True, M=move(x, -0.32, 0))
            m.face([(x + 0.23 * math.cos(a), -0.32 + 0.23 * math.sin(a), 0.55) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)], "grain", out=(0, 0, 1))
        m.box((0.1, -0.5, 0.58), (0.08, 0.18, 0.05), "wood_light")
    elif kind == "meat":
        # the butcher's rail on two brackets, hooks with hams and a side of beef; a block below
        for sx in (-1, 1):
            m.beam((sx * 0.7, 0.0, 2.4), (sx * 0.7, -0.45, 2.4), 0.04, 0.04, "iron")
            m.beam((sx * 0.7, 0.0, 2.1), (sx * 0.7, -0.4, 2.38), 0.02, 0.02, "iron")
        m.beam((-0.75, -0.45, 2.4), (0.75, -0.45, 2.4), 0.03, 0.03, "iron")
        for i, x in enumerate(np.linspace(-0.55, 0.55, 5)):
            m.beam((x, -0.45, 2.4), (x, -0.45, 2.22), 0.01, 0.01, "iron")
            if i == 2:
                m.lathe([(0.02, 1.2), (0.16, 1.45), (0.2, 1.8), (0.14, 2.1), (0.04, 2.22)], 6, "meat", M=move(x, -0.45, 0))
            else:
                m.lathe([(0.03, 1.72), (0.11, 1.84), (0.1, 2.05), (0.03, 2.22)], 6, "ham" if i % 2 else "fat", M=move(x, -0.45, 0))
        m.lathe([(0.26, 0.0), (0.26, 0.78)], 8, "wood_light", cap1=True, M=move(0.95, -0.4, 0))
    elif kind == "bread":
        # loaves on the window sill and on a board on a trestle below it
        m.box((0, -0.14, 0.92), (1.3, 0.28, 0.04), "wood")
        for i, x in enumerate(np.linspace(-0.52, 0.52, 7)):
            if i % 2:
                m.lathe([(0.08, 0.94), (0.09, 0.99), (0.0, 1.04)], 6, "bread", M=move(x, -0.14, 0))
            else:
                with m.at(move(x, -0.14, 0.99) @ sl.rot("Y", math.pi / 2)):
                    m.lathe([(0.0, -0.13), (0.05, -0.1), (0.055, 0.1), (0.0, 0.13)], 6, "crust")
        basket(m, 0.8, -0.35, 0.0, 0.22, 0.34, "bread")
    elif kind == "coal":
        for i, x in enumerate((-0.45, 0.05)):
            m.lathe([(0.2, 0.0), (0.24, 0.3), (0.22, 0.6), (0.14, 0.72)], 8, "coal_sack", cap0=True, M=move(x, -0.3, 0))
        m.lathe([(0.45, 0.0), (0.3, 0.12), (0.0, 0.2)], 7, "coal", M=move(0.6, -0.5, 0))
    elif kind == "cloth":
        m.box((0, -0.3, 0.72), (1.2, 0.5, 0.04), "wood_light")
        for sx in (-1, 1):
            m.box((sx * 0.5, -0.3, 0.36), (0.05, 0.44, 0.72), "wood")
        for i, (x, cell) in enumerate(zip(np.linspace(-0.45, 0.45, 5), ("cloth_blue", "cloth_red", "linen", "cloth_grey", "cloth_brown"))):
            with m.at(move(x, -0.3, 0.82) @ sl.rot("X", math.pi / 2)):
                m.lathe([(0.07, -0.22), (0.07, 0.22)], 6, cell, cap0=True, cap1=True)
    elif kind == "casks":
        m.beam((-0.6, -0.45, 0.12), (0.6, -0.45, 0.12), 0.08, 0.08, "wood_dark")
        m.beam((-0.6, -0.1, 0.12), (0.6, -0.1, 0.12), 0.08, 0.08, "wood_dark")
        for x in (-0.35, 0.35):
            with m.at(move(x, -0.28, 0.42) @ sl.rot("X", math.pi / 2)):
                m.lathe([(0.24, -0.3), (0.3, -0.1), (0.3, 0.1), (0.24, 0.3)], 8, "wood", cap0=True, cap1=True)
    return m


def pots(kind):
    """Flower pots: three on a sill board (the game sets it on a window sill), or two by a door."""
    m = Mesh()
    xs = (-0.3, 0.0, 0.3) if kind == "sill" else (0.0,)
    if kind == "sill":
        m.box((0, -0.09, -0.02), (1.0, 0.2, 0.04), "wood")
    for x in xs:
        m.lathe([(0.06, 0.0), (0.08, 0.14), (0.085, 0.15)], 6, "terracotta", cap0=True, M=move(x, -0.09 if kind == "sill" else -0.25, 0))
        cy = -0.09 if kind == "sill" else -0.25
        for k in range(5):
            a = k * 1.3
            m.beam((x, cy, 0.14), (x + 0.07 * math.cos(a), cy + 0.07 * math.sin(a), 0.26 + 0.04 * (k % 2)), 0.012, 0.012, "leaf")
            m.box((x + 0.07 * math.cos(a), cy + 0.07 * math.sin(a), 0.28 + 0.04 * (k % 2)), (0.05, 0.05, 0.04), "flower_red" if k % 2 else "flower_white")
    return m


def chalk(cell, w, d):
    m = Mesh()
    m.face([(-w / 2, -d / 2, 0), (w / 2, -d / 2, 0), (w / 2, d / 2, 0), (-w / 2, d / 2, 0)], cell, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL, out=(0, 0, 1))
    return m


# ------------------------------------------------------------------ dog carts


def dogcart(load):
    """The dog cart ("the poor man's horse"): a two-wheeled cart with a painted box on one axle, the
    shafts going forward (-Y) for the dogs between them. The axle is the origin, 0.3 m up at the
    wheel's centre (the wheels are separate: dogcart_wheel). The milk cart: green, copper cans."""
    m = Mesh(ao=0.9)
    body = "green_paint" if load == "milk" else "blue_paint"
    m.box((0, 0.05, 0.45), (0.62, 0.9, 0.04), "planks")
    for sx in (-1, 1):
        m.box((sx * 0.31, 0.05, 0.58), (0.03, 0.9, 0.26), body)
    m.box((0, 0.5, 0.58), (0.62, 0.03, 0.26), body)
    m.box((0, -0.4, 0.58), (0.62, 0.03, 0.26), body)
    m.beam((-0.36, 0.0, 0.3), (0.36, 0.0, 0.3), 0.04, 0.04, "iron")
    for sx in (-1, 1):
        m.beam((sx * 0.22, -0.4, 0.44), (sx * 0.22, -1.45, 0.34), 0.035, 0.035, "wood")
        m.beam((sx * 0.22, 0.5, 0.5), (sx * 0.22, 0.85, 0.72), 0.03, 0.03, "wood")
    m.beam((-0.22, 0.85, 0.72), (0.22, 0.85, 0.72), 0.03, 0.03, "wood")  # the handle at the back
    m.beam((-0.22, -1.2, 0.36), (0.22, -1.2, 0.36), 0.025, 0.025, "wood")
    # a prop leg under the front, and a little bell on the shaft (A Dog of Flanders: "belled harness")
    m.beam((0, -0.3, 0.44), (0, -0.3, 0.02), 0.03, 0.03, "wood_dark")
    if load == "milk":
        for x, y, h in ((-0.15, -0.2, 0.5), (0.15, -0.2, 0.5), (-0.15, 0.2, 0.46), (0.15, 0.22, 0.52)):
            m.lathe([(0.1, 0.47), (0.11, 0.47 + h * 0.7), (0.07, 0.47 + h * 0.85), (0.05, 0.47 + h), (0.065, 0.47 + h + 0.02)], 8, "copper", cap0=True, M=move(x, y, 0))
            m.lathe([(0.066, 0.0), (0.066, 0.03), (0.0, 0.05)], 6, "brass", M=move(x, y, 0.47 + h + 0.02))
    else:
        m.box((0, 0.05, 0.72), (0.56, 0.84, 0.04), "linen")
        for x in (-0.14, 0.14):
            for y in (-0.22, 0.05, 0.3):
                m.lathe([(0.08, 0.72), (0.09, 0.77), (0.0, 0.83)], 6, "bread", M=move(x, y, 0))
    return m


def wheel(r, cell="wood_dark", spokes=8, width=0.05):
    """A spoked wheel about the X axis at the origin (the game turns it)."""
    m = Mesh()
    rim = [(0.0, r * math.cos(a), r * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 12, endpoint=False)]
    m.tube(rim, width * 0.5, 4, "iron", closed=True)
    for k in range(spokes):
        a = k * 2 * math.pi / spokes
        m.beam((0, 0, 0), (0, r * math.cos(a) * 0.95, r * math.sin(a) * 0.95), 0.02, 0.02, cell)
    with m.at(sl.rot("Y", math.pi / 2)):
        m.lathe([(0.04, -0.06), (0.04, 0.06)], 6, cell, cap0=True, cap1=True)
    return m


def harness():
    """A dog's harness: a breast band round the chest and a band over the back (fitted at 0.36 m up
    and 0.2 m ahead of the dog's middle; the game hangs it on the dog)."""
    m = Mesh()
    band = [(0.13 * math.cos(a), 0.0, 0.36 + 0.13 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
    m.tube(band, 0.018, 3, "leather", closed=True)
    m.box((0, -0.14, 0.33), (0.2, 0.03, 0.05), "leather")
    m.lathe([(0.0, 0.2), (0.018, 0.22), (0.0, 0.25)], 5, "brass", M=move(0, -0.15, 0.08))
    return m


# ------------------------------------------------------------------ the knife grinder's barrow


def barrow():
    """The knife grinder's barrow: one wheel in front (the origin, at its axle), a frame running back
    to two handles and two legs, the grindstone on its trough, the treadle and a crank to a flywheel,
    a drip can over the stone. The wheel, the stone and the flywheel are separate (they turn)."""
    m = Mesh(ao=1.2)
    for sx in (-1, 1):
        m.beam((sx * 0.2, 0.0, 0.32), (sx * 0.24, 1.25, 0.62), 0.05, 0.05, "wood")
        m.beam((sx * 0.24, 1.25, 0.62), (sx * 0.25, 1.6, 0.66), 0.04, 0.04, "wood")
        m.beam((sx * 0.23, 1.05, 0.58), (sx * 0.23, 1.05, 0.0), 0.05, 0.05, "wood")
        m.beam((sx * 0.2, 0.5, 0.45), (sx * 0.2, 0.55, 1.02), 0.04, 0.04, "wood")
    m.beam((-0.25, 0.5, 0.45), (0.25, 0.5, 0.45), 0.04, 0.04, "wood")
    m.box((0, 0.55, 0.95), (0.3, 0.3, 0.12), "wood_dark")  # the trough under the stone
    m.beam((-0.26, 0.55, 1.02), (0.26, 0.55, 1.02), 0.03, 0.03, "iron")
    m.beam((0.22, 0.9, 0.08), (0.22, 0.4, 0.14), 0.12, 0.03, "wood")  # the treadle
    m.beam((0.22, 0.55, 0.12), (0.3, 0.8, 0.85), 0.02, 0.02, "iron")  # the rod to the crank
    m.beam((0.0, 0.62, 1.02), (0.0, 0.62, 1.45), 0.02, 0.02, "iron")
    m.lathe([(0.05, 1.45), (0.07, 1.52), (0.05, 1.6), (0.0, 1.62)], 6, "copper", cap0=True, M=move(0, 0.62, 0))  # the drip can
    m.box((-0.12, 1.1, 0.72), (0.2, 0.3, 0.12), "leather")  # his tool box
    return m


# ------------------------------------------------------------------ things in hand, at the door, at play


def bucket():
    m = Mesh()
    m.lathe([(0.13, 0.0), (0.15, 0.28)], 8, "wood", cap0=True)
    for z in (0.05, 0.22):
        m.lathe([(0.143, z), (0.148, z + 0.03)], 8, "iron")
    m.face([(0.14 * math.cos(a), 0.14 * math.sin(a), 0.24) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)], "cloth_grey", shade=0.5, out=(0, 0, 1))
    m.tube([(0.15 * math.cos(a), 0.0, 0.28 + 0.14 * math.sin(a)) for a in np.linspace(0, math.pi, 7)], 0.008, 3, "iron")
    return m


def brush():
    m = Mesh()
    m.box((0, 0, 0.03), (0.2, 0.08, 0.04), "wood_light")
    m.box((0, 0, 0.005), (0.19, 0.07, 0.02), "bristle")
    return m


def chair():
    """A rush-seated chair (the seat 0.45 m up), its back toward +Y."""
    m = Mesh()
    for sx in (-1, 1):
        for sy in (-1, 1):
            h = 0.95 if sy > 0 else 0.45
            m.beam((sx * 0.2, sy * 0.19, 0), (sx * 0.2, sy * 0.19, h), 0.035, 0.035, "wood")
    m.box((0, 0, 0.44), (0.42, 0.4, 0.03), "straw")
    for z in (0.62, 0.78, 0.92):
        m.beam((-0.2, 0.19, z), (0.2, 0.19, z), 0.05, 0.02, "wood")
    return m


def lace_stand():
    """The lace pillow (a round bolster) on its sloping stand, pins and bobbins hanging over the front.
    It stands before the lace maker's knees; she faces -Y... the pillow faces her (+Y)."""
    m = Mesh()
    for sx in (-1, 1):
        m.beam((sx * 0.17, -0.12, 0), (sx * 0.17, 0.0, 0.62), 0.03, 0.03, "wood")
        m.beam((sx * 0.17, 0.14, 0), (sx * 0.17, 0.0, 0.62), 0.03, 0.03, "wood")
    with m.at(move(0, 0.0, 0.68) @ sl.rot("Y", math.pi / 2)):
        m.lathe([(0.1, -0.22), (0.13, -0.18), (0.13, 0.18), (0.1, 0.22)], 8, "linen", cap0=True, cap1=True)
    for k in range(14):
        x = -0.15 + 0.3 * k / 13
        m.beam((x, 0.12, 0.7), (x + 0.01, 0.2, 0.52), 0.006, 0.006, "wood_light")
        m.box((x + 0.01, 0.2, 0.5), (0.012, 0.012, 0.05), "wood_dark")
    m.face([(-0.15, 0.1, 0.78), (0.15, 0.1, 0.78), (0.15, 0.13, 0.7), (-0.15, 0.13, 0.7)], "flower_white", out=(0, 1, 1))
    return m


def hoop():
    m = Mesh()
    ring = [(0.0, 0.3 * math.cos(a), 0.3 + 0.3 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 14, endpoint=False)]
    m.tube(ring, 0.012, 3, "wood_light", closed=True)
    return m


def stick():
    m = Mesh()
    m.beam((0, 0, 0), (0, 0, 0.55), 0.018, 0.018, "wood")
    return m


def top():
    m = Mesh()
    m.lathe([(0.0, 0.0), (0.045, 0.05), (0.05, 0.08), (0.02, 0.1), (0.008, 0.13)], 6, "red_paint")
    return m


def marbles():
    m = Mesh()
    rng = np.random.default_rng(7)
    for k in range(9):
        x, y = rng.uniform(-0.35, 0.35, 2)
        m.box((x, y, 0.012), (0.024, 0.024, 0.024), ["delft_blue", "clay", "flower_red", "stone"][k % 4])
    return m


def milkcan():
    m = Mesh()
    m.lathe([(0.08, 0.0), (0.09, 0.22), (0.06, 0.3), (0.045, 0.34), (0.055, 0.36)], 8, "copper", cap0=True)
    m.tube([(0.06 * math.cos(a), 0.0, 0.34 + 0.08 * math.sin(a)) for a in np.linspace(0, math.pi, 6)], 0.007, 3, "iron")
    return m


def bread_basket():
    m = Mesh()
    m.lathe([(0.13, 0.0), (0.18, 0.16)], 8, "wicker", cap0=True)
    for k in range(5):
        a = k * 1.25
        m.lathe([(0.05, 0.14), (0.06, 0.18), (0.0, 0.22)], 5, "bread", M=move(0.08 * math.cos(a), 0.08 * math.sin(a), 0))
    m.tube([(0.16 * math.cos(a), 0.0, 0.16 + 0.14 * math.sin(a)) for a in np.linspace(0, math.pi, 7)], 0.012, 3, "wicker")
    return m


def broom_bundle():
    """Brooms tied in a bundle, carried over the shoulder: along +Y, the middle at the origin."""
    m = Mesh()
    for k, (dx, dz) in enumerate(((0.0, 0.0), (0.05, 0.03), (-0.05, 0.03), (0.0, 0.07), (0.04, -0.03))):
        m.beam((dx, -0.9, dz), (dx, 0.6, dz), 0.025, 0.025, "wood_light")
        with m.at(move(dx, 0.6, dz) @ sl.rot("X", -math.pi / 2)):
            m.lathe([(0.025, 0.0), (0.07, 0.12), (0.08, 0.3), (0.03, 0.34)], 5, "birch", cap1=True)
    m.beam((-0.08, -0.3, 0.02), (0.08, -0.3, 0.02), 0.02, 0.1, "rope")
    return m


def flowers():
    m = Mesh()
    for k in range(7):
        a = k * 0.9
        tip = (0.05 * math.cos(a), 0.05 * math.sin(a), 0.28 + 0.03 * (k % 3))
        m.beam((0, 0, 0), tip, 0.01, 0.01, "leaf")
        m.box(tip, (0.05, 0.05, 0.04), ["flower_red", "flower_white", "flower_yellow"][k % 3])
    m.box((0, 0, 0.06), (0.05, 0.05, 0.08), "linen")
    return m


# ------------------------------------------------------------------ animals of the courts


def hen_body():
    m = Mesh()
    with m.at(sl.rot("X", math.pi / 2)):
        m.lathe([(0.0, -0.16), (0.08, -0.1), (0.1, 0.02), (0.07, 0.12), (0.0, 0.16)], 6, "hen", M=move(0, 0.26, 0))
    m.face([(0.0, 0.12, 0.3), (0.0, 0.2, 0.44), (0.0, 0.24, 0.3)], "hen", out=(1, 0, 0))  # the tail
    m.face([(0.0, 0.12, 0.3), (0.0, 0.2, 0.44), (0.0, 0.24, 0.3)], "hen", out=(-1, 0, 0))
    return m


def hen_head():
    """The head and neck, pivoting at the origin (the base of the neck): pecks by turning about X."""
    m = Mesh()
    m.beam((0, 0, 0), (0, -0.04, 0.1), 0.05, 0.05, "hen")
    m.box((0, -0.05, 0.12), (0.05, 0.07, 0.05), "hen")
    m.box((0, -0.1, 0.12), (0.02, 0.04, 0.02), "beak")
    m.box((0, -0.04, 0.16), (0.012, 0.05, 0.03), "hen_red")
    return m


def hen_leg():
    m = Mesh()
    m.beam((0, 0, 0), (0, 0, -0.16), 0.012, 0.012, "beak")
    m.box((0, -0.02, -0.165), (0.04, 0.06, 0.008), "beak")
    return m


def goat_body():
    m = Mesh()
    with m.at(move(0, 0, 0.62) @ sl.rot("X", math.pi / 2)):
        m.lathe([(0.0, -0.42), (0.13, -0.36), (0.17, -0.1), (0.16, 0.2), (0.12, 0.36), (0.0, 0.42)], 8, "goat")
    m.beam((0, 0.4, 0.7), (0, 0.5, 0.82), 0.04, 0.02, "goat_dark")  # the tail
    return m


def goat_head():
    """The goat's neck and head, pivoting at the origin (the top of the chest)."""
    m = Mesh()
    m.beam((0, 0, 0), (0, -0.12, 0.26), 0.12, 0.1, "goat")
    m.box((0, -0.2, 0.3), (0.12, 0.24, 0.12), "goat")
    m.box((0, -0.32, 0.26), (0.08, 0.06, 0.08), "goat_dark")
    for sx in (-1, 1):
        m.beam((sx * 0.04, -0.14, 0.36), (sx * 0.07, -0.02, 0.5), 0.02, 0.02, "horn")
        m.beam((sx * 0.06, -0.14, 0.32), (sx * 0.14, -0.1, 0.3), 0.06, 0.02, "goat")
    m.beam((0, -0.3, 0.2), (0, -0.28, 0.12), 0.03, 0.02, "goat_dark")  # the beard
    return m


def goat_leg():
    """A leg hanging from the origin (the hip or the shoulder), 0.5 m to the hoof."""
    m = Mesh()
    m.beam((0, 0, 0), (0, 0, -0.44), 0.05, 0.05, "goat")
    m.box((0, 0, -0.47), (0.05, 0.06, 0.06), "goat_dark")
    return m


def build_models():
    B = []
    for g in ("candles", "rosaries", "prints"):
        B.append((f"stall_{g}", stall(g)))
    for k in ("baskets", "crockery", "clogs", "brooms", "sacks", "meat", "bread", "coal", "cloth", "casks"):
        B.append((f"spill_{k}", spill(k)))
    B.append(("pots_sill", pots("sill")))
    B.append(("pots_door", pots("door")))
    B.append(("chalk_hop", chalk("chalk_hop", 1.2, 3.0)))
    B.append(("chalk_ring", chalk("chalk_ring", 1.2, 1.2)))
    B.append(("wet_0", chalk("wet_0", 1.8, 1.4)))
    B.append(("dogcart_milk", dogcart("milk")))
    B.append(("dogcart_bread", dogcart("bread")))
    B.append(("dogcart_wheel", wheel(0.3)))
    B.append(("harness", harness()))
    B.append(("barrow", barrow()))
    B.append(("barrow_wheel", wheel(0.3, spokes=6)))
    with_stone = Mesh()
    with with_stone.at(sl.rot("Y", math.pi / 2)):
        with_stone.lathe([(0.18, -0.04), (0.18, 0.04)], 10, "stone", cap0=True, cap1=True)
    B.append(("barrow_stone", with_stone))
    B.append(("barrow_fly", wheel(0.26, cell="iron", spokes=4, width=0.04)))
    for name, fn in (("bucket", bucket), ("brush", brush), ("chair", chair), ("lace_stand", lace_stand), ("hoop", hoop), ("stick", stick),
                     ("top", top), ("marbles", marbles), ("milkcan", milkcan), ("bread_basket", bread_basket), ("broom_bundle", broom_bundle),
                     ("flowers", flowers), ("hen_body", hen_body), ("hen_head", hen_head), ("hen_leg", hen_leg),
                     ("goat_body", goat_body), ("goat_head", goat_head), ("goat_leg", goat_leg)):
        B.append((name, fn()))
    return B


def preview(objs):
    cam = sl.stage()
    names = list(objs)
    rows = [[n for n in names if n.startswith("stall_")], [n for n in names if n.startswith("spill_")],
            [n for n in names if n.startswith(("pots", "dogcart", "harness", "barrow", "chalk", "wet"))],
            [n for n in names if not n.startswith(("stall_", "spill_", "pots", "dogcart", "harness", "barrow", "chalk", "wet"))]]
    for r, row in enumerate(rows):
        x = 0.0
        for n in row:
            o = objs[n]
            o.location = (0, 0, 0)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            zlo = min(p.z for p in pts)
            o.location = (x - lo, r * 3.2, -zlo if zlo < 0 else 0)
            x += hi - lo + 0.3
        for n in row:
            objs[n].location.x -= x / 2
    bpy.context.view_layer.update()
    sl.preview_materials()
    for mt in bpy.data.materials:
        if mt.name.startswith("lv_"):
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
    sl.aim(cam, (0, -9, 6), (0, 4, 0.6), lens=22)
    sl.render(os.path.join(SHOTS, "lively_models.png"), (2200, 1200))
    sl.aim(cam, (-4, -4.5, 2.2), (-4, 0, 1.2), lens=30)
    sl.render(os.path.join(SHOTS, "lively_stalls_model.png"), (1400, 800))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlases()
    make_materials()
    objs = {}
    counts = {}
    for name, mesh in build_models():
        objs[name] = mesh.to_object(name)
        counts[name] = sl.tris(objs[name])
    node = bpy.data.objects.new("lively_meta", None)
    import json
    node["meta"] = json.dumps({"solid": {"size": [sl.SOLID_ATLAS.W, sl.SOLID_ATLAS.H]}, "decal": {"size": [sl.DECAL_ATLAS.W, sl.DECAL_ATLAS.H]}}, separators=(",", ":"))
    bpy.context.scene.collection.objects.link(node)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_lively] {n:18s} {c:5d} tris")
    print(f"[build_lively] {len(objs)} models, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()
