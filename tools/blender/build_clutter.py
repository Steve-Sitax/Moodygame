"""Clutter for the alleys, the big streets and the street ends at the water (Steve 2026-09-24:
"the city feels empty and some street ends look unfinished").

    blender -b --factory-startup -P tools/blender/build_clutter.py [-- --preview]

Writes client/public/models/clutter.glb (Draco). One node per model, real scale in metres, built
with the helpers and conventions of build_streetlife.py (Blender Z up; the export turns it Y up; a
thing's front looks toward -Y, which is +Z in the game). Placed by client/src/world/clutter.ts,
merged per chunk: two draw calls (solid, decal) per chunk in view.

  alleys      barrel, keg, crates (one, a stack, a broken one), a rain butt under a downpipe with
              its rain head (downpipe: a 1 m length, stretched up the wall), a birch broom leaning
              on the wall, a parked handcart, sacks, a basket stack, a rubbish heap, a cat asleep on
              a folded sack (three coats), garments for the washing lines (the rope is drawn in
              code), low moss and damp, a water streak down the wall, wet stone, fallen leaves
  closures    the timber and stone parts of the back wall that closes a dead-end alley (the brick
              wall and its roof are built in code, to size): a ledged and braced back door (plain
              and in old green paint), a double yard gate, a small barred window, blue-stone coping
  streets     a bench against the wall, a cast-iron pump and a trough (after build_streetlife),
              a blue-stone guard stone for corners, a street bollard, three bills for blank walls,
              market leftovers (crushed crates, a basket, leaves)
  water ends  a stone edge kerb (1 m), an iron chain post and a chain span (1 m, stretched),
              a timber barrier (1 m and its post), a stretch of brick city wall (1 m) and a closed
              gate in a stone frame

Materials, by name: cl_solid (one atlas for everything solid), cl_decal (flat things: moss,
streaks, bills, wet stone, leaves), cl_puddle and cl_glow (unused). Vertex colour "Col" carries
a baked shade. Our own work: nothing downloaded.
"""

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
import build_streetlife as sl  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "clutter.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

sl.SOLID_ATLAS = sl.Atlas(256)
sl.DECAL_ATLAS = sl.Atlas(256)
sl.MAT_NAMES = ["cl_solid", "cl_decal", "cl_puddle", "cl_glow"]
SOLID, DECAL = sl.SOLID, sl.DECAL
Mesh = sl.Mesh
move = sl.move
rot = sl.rot

PLAIN = {k: sl.PLAIN[k] for k in ("iron", "iron_green", "gold", "bluestone", "whitestone", "wood", "wood_dark", "water_dark", "rope",
                                  "linen_white", "linen_cream", "cloth_blue", "cloth_red", "cloth_grey", "cloth_brown", "black")}
PLAIN.update({
    "oak": ((0.34, 0.25, 0.16), 0.3),
    "hoop": ((0.13, 0.12, 0.11), 0.3),
    "planks_grey": ((0.38, 0.35, 0.31), 0.35),
    "tarred": ((0.10, 0.09, 0.08), 0.25),
    "zinc": ((0.36, 0.38, 0.39), 0.2),
    "sack": ((0.58, 0.50, 0.36), 0.25),
    "sack_dark": ((0.40, 0.34, 0.24), 0.3),
    "wicker": ((0.54, 0.42, 0.24), 0.35),
    "birch": ((0.44, 0.34, 0.22), 0.45),
    "twigs": ((0.30, 0.24, 0.14), 0.45),
    "cat_grey": ((0.42, 0.42, 0.41), 0.22),
    "cat_black": ((0.07, 0.07, 0.07), 0.15),
    "cat_ginger": ((0.64, 0.38, 0.17), 0.22),
    "cat_white": ((0.82, 0.80, 0.76), 0.1),
    "ash": ((0.36, 0.35, 0.33), 0.3),
    "muck": ((0.20, 0.17, 0.12), 0.4),
    "cabbage": ((0.34, 0.48, 0.22), 0.25),
    "rag": ((0.42, 0.36, 0.30), 0.3),
    "paint_white": ((0.80, 0.78, 0.72), 0.1),
    "paint_green": ((0.13, 0.25, 0.17), 0.2),
    "rust": ((0.34, 0.18, 0.10), 0.35),
    "mortar": ((0.52, 0.50, 0.46), 0.2),
})

POSTERS = [
    dict(key="auction", paper=(0.86, 0.83, 0.70), ink=(0.10, 0.09, 0.08), lines=["PUBLIC", "AUCTION"], tail=["HOUSE", "AND YARD"]),
    dict(key="theatre", paper=(0.84, 0.66, 0.50), ink=(0.30, 0.08, 0.08), lines=["THEATRE"], ring=True, tail=["TONIGHT"]),
    dict(key="reward", paper=(0.90, 0.88, 0.80), ink=(0.08, 0.08, 0.10), lines=["REWARD"], crest=True, tail=["50 FRANCS"]),
]


# ------------------------------------------------------------------ painting


def paint_brick(seed, base=(0.46, 0.24, 0.17)):
    """Brick courses with mortar joints, 32 x 32 texels for 1 m x 1 m of wall (about 12 courses)."""
    rng = np.random.default_rng(seed)
    w = h = 32
    img = sl.flat(seed, w, h, base, 0.22)
    mortar = np.array(PLAIN["mortar"][0])
    for row in range(0, h, 3):
        img[row, :, :3] = mortar * rng.uniform(0.8, 1.0)
        off = 0 if (row // 3) % 2 == 0 else 4
        for x in range(off, w, 8):
            img[row:row + 3, x, :3] = mortar * 0.9
        for x in range(off, w, 8):  # each brick its own tone
            img[row + 1:row + 3, x + 1:x + 8, :3] *= rng.uniform(0.82, 1.12)
    return img


def paint_planks(seed, rgb, vertical=True, gaps=True):
    rng = np.random.default_rng(seed)
    w = h = 32
    img = sl.wood_board(seed, w, h, rgb)
    if not vertical:
        img = img.transpose(1, 0, 2).copy()
    if gaps:
        for k in range(0, 32, 6):
            if vertical:
                img[:, k, :3] *= 0.35
            else:
                img[k, :, :3] *= 0.35
    # damp creeping up the foot of the boards
    img[-5:, :, :3] *= np.linspace(1.0, 0.6, 5)[:, None, None]
    n = sl.vnoise(rng, w, h, 4, 4)
    img[..., :3] *= (0.9 + 0.2 * n)[..., None]
    return img


def paint_crate(seed):
    """Crate side: three boards with dark gaps, a stencilled mark."""
    rng = np.random.default_rng(seed)
    img = paint_planks(seed, (0.52, 0.42, 0.28), vertical=False)
    for y in range(12, 20):
        for x in range(10, 22):
            if (x + y) % 5 == 0 and rng.random() < 0.8:
                img[y, x, :3] = (0.12, 0.10, 0.08)
    return img


def paint_moss(seed):
    """Low on a wall: a dark damp band with green moss in patches and a ragged top."""
    rng = np.random.default_rng(seed)
    w, h = 64, 32
    img = np.zeros((h, w, 4))
    n = sl.vnoise(rng, w, h, 10, 1) * 0.7 + sl.vnoise(rng, w, h, 28, 2) * 0.3
    top = 3 + n[0] * 18
    vv = np.arange(h)[:, None]
    below = vv >= top[None, :]
    depth = np.clip((vv - top[None, :]) / (h - top[None, :] + 1e-6), 0, 1)
    img[..., :3] = (0.07, 0.08, 0.05)
    img[..., 3] = np.where(below, 0.3 + 0.45 * depth, 0)
    m = (sl.vnoise(rng, w, h, 14, 7) > 0.48) & (vv > top[None, :] + 2)
    img[m, :3] = np.array((0.14, 0.24, 0.08)) * rng.uniform(0.8, 1.2, (m.sum(), 1))
    img[m, 3] = 0.9
    m2 = (sl.vnoise(rng, w, h, 30, 10) > 0.62) & below
    img[m2, :3] = (0.20, 0.30, 0.10)
    img[m2, 3] = 0.85
    return img


def paint_streak(seed):
    """A dark water run down a wall (under a leaking pipe, a sill): narrow, fading down."""
    rng = np.random.default_rng(seed)
    w, h = 16, 64
    img = np.zeros((h, w, 4))
    n = sl.vnoise(rng, w, h, 3, 8)
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    wid = 3 + 3 * (vv / h) + n * 2
    d = np.abs(uu - 8 + (n - 0.5) * 3)
    img[..., :3] = (0.06, 0.07, 0.05)
    img[..., 3] = np.clip((wid - d) / 3, 0, 1) * (0.25 + 0.35 * (vv / h))
    g = (d < wid - 1) & (vv > h * 0.7) & (n > 0.5)
    img[g, :3] = (0.12, 0.20, 0.07)
    img[g, 3] = 0.7
    return img


def paint_wet(seed):
    rng = np.random.default_rng(seed)
    w, h = 32, 32
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    n = sl.vnoise(rng, w, h, 5, 5)
    d = np.hypot((uu - w / 2) / (w / 2), (vv - h / 2) / (h / 2)) + (n - 0.5) * 0.7
    img = np.zeros((h, w, 4))
    img[..., 3] = np.clip((1.0 - d) * 2.2, 0, 1) * 0.5
    return img


def paint_leaves(seed):
    """Fallen leaves blown into a corner: brown, ochre, a few red."""
    rng = np.random.default_rng(seed)
    w = h = 32
    img = np.zeros((h, w, 4))
    cols = [(0.42, 0.26, 0.10), (0.56, 0.40, 0.14), (0.30, 0.20, 0.10), (0.55, 0.20, 0.10), (0.36, 0.30, 0.14)]
    for _ in range(90):
        x, y = rng.normal(16, 6, 2)
        if not (1 < x < 31 and 1 < y < 31):
            continue
        c = np.array(cols[rng.integers(len(cols))]) * rng.uniform(0.7, 1.1)
        r = rng.uniform(0.8, 1.8)
        for yy in range(int(y - 2), int(y + 3)):
            for xx in range(int(x - 2), int(x + 3)):
                if 0 <= xx < w and 0 <= yy < h and math.hypot((xx - x) * 0.8, yy - y) < r:
                    img[yy, xx, :3] = c
                    img[yy, xx, 3] = 1
    return img


def paint_sweepings(seed):
    """Grey dust and grit swept against a wall, straws and scraps in it."""
    rng = np.random.default_rng(seed)
    w, h = 32, 16
    uu, vv = np.meshgrid(np.arange(w), np.arange(h))
    n = sl.vnoise(rng, w, h, 6, 3)
    d = np.hypot((uu - w / 2) / (w / 2), (vv - h) / h) + (n - 0.5) * 0.6
    img = np.zeros((h, w, 4))
    img[..., :3] = (0.22, 0.20, 0.17)
    img[..., 3] = np.clip((1.0 - d) * 1.8, 0, 0.75)
    for _ in range(18):
        x, y = int(rng.uniform(4, 28)), int(rng.uniform(6, 15))
        img[y, x:x + int(rng.integers(1, 4)), :3] = rng.choice([(0.6, 0.5, 0.28), (0.7, 0.68, 0.6), (0.3, 0.36, 0.2)])
        img[y, x:x + 3, 3] = 0.9
    return img


def build_atlases():
    for i, (name, (rgb, amt)) in enumerate(PLAIN.items()):
        size = 32 if name in ("oak", "bluestone", "wood", "wood_dark", "planks_grey", "tarred") else 16
        sl.SOLID_ATLAS.add(name, sl.flat(1300 + i, size, size, rgb, amt))
    sl.SOLID_ATLAS.add("brick", paint_brick(1400))
    sl.SOLID_ATLAS.add("brick_dark", paint_brick(1401, (0.30, 0.17, 0.13)))
    sl.SOLID_ATLAS.add("planks_v", paint_planks(1402, (0.36, 0.30, 0.22)))
    sl.SOLID_ATLAS.add("planks_old", paint_planks(1403, (0.40, 0.37, 0.32)))
    sl.SOLID_ATLAS.add("planks_green", paint_planks(1404, (0.16, 0.28, 0.20), gaps=False))
    sl.SOLID_ATLAS.add("planks_tar", paint_planks(1405, (0.12, 0.11, 0.10)))
    sl.SOLID_ATLAS.add("crate", paint_crate(1406))
    sl.SOLID_ATLAS.add("ticking", sl.paint_cloth(1407, (0.84, 0.82, 0.76), ticking=True))
    for i, p in enumerate(POSTERS):
        sl.DECAL_ATLAS.add(f"poster_{p['key']}", sl.paint_poster(p, 1500 + i))
    sl.DECAL_ATLAS.add("moss_low", paint_moss(1510))
    sl.DECAL_ATLAS.add("moss_low_b", paint_moss(1511))
    sl.DECAL_ATLAS.add("streak", paint_streak(1512))
    sl.DECAL_ATLAS.add("wet", paint_wet(1513))
    sl.DECAL_ATLAS.add("leaves", paint_leaves(1514))
    sl.DECAL_ATLAS.add("sweepings", paint_sweepings(1515))
    sl.SOLID_ATLAS.pack()
    sl.DECAL_ATLAS.pack()


def make_materials():
    solid = sl.bl_image("cl_solid_tex", sl.SOLID_ATLAS.img, False)
    decal = sl.bl_image("cl_decal_tex", sl.DECAL_ATLAS.img, True)
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


# ------------------------------------------------------------------ small helpers


def quad(m, cell, a, b, c, d, mat=SOLID, out=None, shade=1.0):
    m.face([a, b, c, d], cell, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=mat, out=out, shade=shade)


def barrel_at(m, x, y, z0=0.0, r=0.28, h=0.78, cell="oak", water=False, lid=True):
    # no bottom: it stands on the stones (or a kerb, or bricks) and lay in their plane (z-fight check)
    m.lathe([(r * 0.86, z0), (r, z0 + h * 0.25), (r * 1.03, z0 + h * 0.5), (r, z0 + h * 0.75), (r * 0.86, z0 + h)], 8, cell,
            M=move(x, y, 0))
    for zz in (0.12, 0.88):
        rr = r * (0.9 if zz < 0.2 or zz > 0.8 else 1.0) + 0.012
        m.lathe([(rr, z0 + h * zz - 0.025), (rr, z0 + h * zz + 0.025)], 8, "hoop", M=move(x, y, 0))
    top = [(x + r * 0.86 * math.cos(a), y + r * 0.86 * math.sin(a), z0 + h - (0.08 if water else 0.02)) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
    if water:
        m.face(top, "water_dark", out=(0, 0, 1))
    elif lid:
        m.face(top, cell, out=(0, 0, 1), shade=0.85)


def wheel(m, x, y, z, r, axis="y", cell="wood_dark", sides=10):
    R = rot("X", math.pi / 2) if axis == "y" else rot("Y", math.pi / 2)
    m.lathe([(r, -0.03), (r, 0.03)], sides, cell, cap0=True, cap1=True, M=move(x, y, z) @ R)
    m.lathe([(r * 0.95 + 0.012, -0.035), (r * 0.95 + 0.012, 0.035)], sides, "iron", M=move(x, y, z) @ R)


# ------------------------------------------------------------------ alleys


def barrel():
    m = Mesh(ao=0.9)
    barrel_at(m, 0, 0, 0, 0.28, 0.8)
    return m


def keg():
    m = Mesh(ao=0.6)
    barrel_at(m, 0, 0, 0, 0.2, 0.52)
    return m


def crate():
    m = Mesh(ao=0.6)
    m.box((0, 0, 0.22), (0.62, 0.48, 0.44), "crate", skip=("-z",))  # no bottom on the ground (z-fight check)
    return m


def crates():
    """Two crates and one on top, a little askew."""
    m = Mesh(ao=1.2)
    # no bottoms: on the ground or on the crate below they lay in its plane (z-fight check)
    m.box((-0.33, 0, 0.22), (0.62, 0.48, 0.44), "crate", skip=("-z",))
    with m.at(move(0.34, 0.02, 0) @ rot("Z", 0.12)):
        m.box((0, 0, 0.2), (0.56, 0.44, 0.4), "crate", shade=0.92, skip=("-z",))
    with m.at(move(-0.22, 0.02, 0.44) @ rot("Z", -0.2)):
        m.box((0, 0, 0.18), (0.5, 0.4, 0.36), "crate", shade=1.05, skip=("-z",))
    return m


def crate_broken():
    """A crate on its side, open, a board sprung loose beside it."""
    m = Mesh(ao=0.6)
    with m.at(rot("Z", 0.3)):
        m.box((0, 0, 0.21), (0.62, 0.46, 0.42), "crate", skip=("-y", "-z"))
        m.face([(-0.3, -0.22, 0.02), (0.3, -0.22, 0.02), (0.3, -0.22, 0.4), (-0.3, -0.22, 0.4)], "wood_dark", out=(0, 1, 0), shade=0.5)
    m.beam((-0.2, -0.55, 0.02), (0.45, -0.75, 0.02), 0.11, 0.02, "planks_old")
    return m


def rain_butt():
    """The rain butt against the wall: a big oak cask with water in it, on two bricks; the
    downpipe comes down the wall and bends out into it. The pipe stops at 2 m (downpipe goes on)."""
    m = Mesh(ao=1.0)
    y = -0.4
    m.box((-0.18, y, 0.07), (0.22, 0.44, 0.14), "brick_dark", skip=("-z",))
    m.box((0.18, y, 0.07), (0.22, 0.44, 0.14), "brick_dark", skip=("-z",))
    barrel_at(m, 0, y, 0.14, 0.34, 0.92, "oak", water=True)
    # a board half over it
    with m.at(move(0.08, y + 0.02, 1.07) @ rot("Z", 0.4)):
        m.box((0, 0, 0), (0.62, 0.2, 0.025), "planks_old")
    # the pipe: down the wall, a swan neck out, a short spout over the cask
    m.tube([(0, -0.08, 2.0), (0, -0.08, 1.45), (0, -0.2, 1.3), (0, -0.36, 1.22), (0, -0.4, 1.12)], 0.045, 6, "iron")
    m.box((0, -0.04, 1.8), (0.14, 0.06, 0.04), "iron")
    # the tap near the foot, and a dipper hanging on it
    m.beam((0.0, y - 0.33, 0.35), (0.0, y - 0.42, 0.35), 0.04, 0.04, "iron")
    return m


def downpipe():
    """One metre of downpipe up the wall (the game stretches it to the eaves), a bracket at mid height."""
    m = Mesh()
    m.lathe([(0.045, 0.0), (0.045, 1.0)], 6, "iron", M=move(0, -0.08, 0))
    m.box((0, -0.045, 0.5), (0.13, 0.05, 0.035), "iron")
    return m


def rain_head():
    """The rain head at the top of the pipe, under the gutter."""
    m = Mesh()
    m.face([(-0.14, -0.02, 0.3), (0.14, -0.02, 0.3), (0.1, -0.02, 0.0), (-0.1, -0.02, 0.0)], "iron", out=(0, 1, 0))
    m.face([(-0.14, -0.24, 0.3), (0.14, -0.24, 0.3), (0.06, -0.12, 0.0), (-0.06, -0.12, 0.0)], "iron", out=(0, -1, 0))
    m.face([(-0.14, -0.02, 0.3), (-0.14, -0.24, 0.3), (-0.06, -0.12, 0.0), (-0.1, -0.02, 0.0)], "iron", out=(-1, 0, 0))
    m.face([(0.14, -0.02, 0.3), (0.1, -0.02, 0.0), (0.06, -0.12, 0.0), (0.14, -0.24, 0.3)], "iron", out=(1, 0, 0))
    m.box((0, -0.13, 0.31), (0.3, 0.24, 0.03), "iron", shade=0.8)
    return m


def broom():
    """A birch besom leaning on the wall, the head on the stones."""
    m = Mesh()
    lean = math.atan2(0.42, 1.45)
    with m.at(move(0, -0.45, 0.0) @ rot("X", -lean)):
        m.lathe([(0.018, 0.1), (0.018, 1.5)], 5, "birch")
        m.lathe([(0.03, 0.42), (0.1, 0.3), (0.13, 0.12), (0.12, 0.0), (0.0, -0.01)], 6, "twigs")
        m.lathe([(0.035, 0.38), (0.035, 0.42)], 5, "rope")
    return m


def shovel():
    m = Mesh()
    lean = math.atan2(0.36, 1.3)
    with m.at(move(0, -0.38, 0.0) @ rot("X", -lean)):
        m.lathe([(0.017, 0.28), (0.017, 1.35)], 5, "wood")
        m.box((0, -0.02, 0.14), (0.24, 0.02, 0.3), "rust")
        m.box((0, 0, 1.35), (0.14, 0.03, 0.03), "wood")
    return m


def handcart():
    """A two-wheeled handcart parked along the wall, its shafts resting on the stones (length along X)."""
    m = Mesh(ao=0.8)
    y = -0.62
    bed = 0.62
    m.box((0.1, y, bed), (1.3, 0.86, 0.05), "planks_old")
    for sy in (-1, 1):
        m.box((0.1, y + sy * 0.43, bed + 0.14), (1.3, 0.04, 0.26), "planks_old", shade=0.9)
    m.box((0.75, y, bed + 0.14), (0.04, 0.86, 0.26), "planks_old", shade=0.85)
    # shafts: from under the bed down to the ground at -x
    for sy in (-1, 1):
        m.beam((0.7, y + sy * 0.34, bed - 0.04), (-1.45, y + sy * 0.3, 0.06), 0.06, 0.06, "wood")
    m.beam((-1.2, y - 0.3, 0.16), (-1.2, y + 0.3, 0.16), 0.05, 0.05, "wood")
    m.beam((0.2, y - 0.46, 0.45), (0.2, y + 0.46, 0.45), 0.05, 0.05, "iron")
    for sy in (-1, 1):
        wheel(m, 0.2, y + sy * 0.49, 0.45, 0.45)
    return m


def sacks():
    """Three sacks slumped against the wall, one lying."""
    m = Mesh(ao=0.7)
    for x, s in ((-0.28, 1.0), (0.2, 0.9)):
        m.lathe([(0.2 * s, 0), (0.25 * s, 0.1), (0.24 * s, 0.48 * s), (0.15 * s, 0.6 * s), (0.04, 0.68 * s)], 6, "sack",
                M=move(x, -0.28, 0) @ rot("X", 0.12))
        m.lathe([(0.05, 0.6 * s), (0.05, 0.66 * s)], 5, "rope", M=move(x, -0.28, 0) @ rot("X", 0.12))
    with m.at(move(0.0, -0.68, 0.16) @ rot("Z", 0.25) @ rot("Y", math.pi / 2)):
        m.lathe([(0.12, -0.36), (0.18, -0.25), (0.18, 0.25), (0.12, 0.36)], 6, "sack_dark", cap0=True, cap1=True)
    return m


def baskets():
    """A stack of wicker baskets and one on its side."""
    m = Mesh(ao=0.6)
    for k in range(3):
        m.lathe([(0.17, 0.06 * k), (0.22, 0.06 * k + 0.28)], 7, "wicker", M=move(0, -0.26, 0))
    with m.at(move(0.46, -0.3, 0.2) @ rot("Y", math.pi / 2 - 0.2)):
        m.lathe([(0.15, -0.14), (0.2, 0.14)], 7, "wicker", cap0=True)
    return m


def rubbish():
    """A heap in a back corner: ash and sweepings, a broken board, rags, cabbage leaves, a crock."""
    m = Mesh(ao=0.5)
    m.lathe([(0.75, 0.0), (0.55, 0.12), (0.25, 0.26), (0.0, 0.3)], 7, "ash", M=move(0, -0.55, 0) @ Matrix.Diagonal((1.25, 0.8, 1, 1)))
    m.lathe([(0.35, 0.05), (0.2, 0.2), (0.0, 0.26)], 6, "muck", M=move(0.35, -0.5, 0.05))
    m.beam((-0.7, -0.25, 0.05), (0.2, -0.95, 0.2), 0.12, 0.02, "planks_old")
    m.beam((-0.2, -0.2, 0.28), (0.5, -0.3, 0.02), 0.09, 0.02, "planks_old", shade=0.8)
    m.face([(0.1, -0.9, 0.12), (0.5, -0.85, 0.1), (0.55, -1.1, 0.02), (0.05, -1.12, 0.02)], "rag", out=(0, 0, 1))
    for k in range(4):
        a = k * 1.7
        m.box((0.5 * math.cos(a) - 0.1, -0.6 + 0.35 * math.sin(a), 0.05), (0.16, 0.12, 0.03), "cabbage", shade=0.85)
    m.lathe([(0.06, 0), (0.1, 0.1), (0.07, 0.18)], 6, "whitestone", cap0=True, M=move(-0.45, -0.8, 0.02) @ rot("Y", 1.3))
    return m


def cat(coat, patch=None):
    """A cat asleep, curled, on a folded sack against the wall (a warm spot by a door or a vent)."""
    m = Mesh(ao=0.3)
    y = -0.3
    m.box((0, y, 0.035), (0.62, 0.44, 0.07), "sack_dark", skip=("-z",))
    m.box((0.05, y + 0.02, 0.08), (0.5, 0.36, 0.02), "sack", shade=0.9, skip=("-z",))
    with m.at(move(0, y, 0.09) @ Matrix.Diagonal((1.25, 1.0, 0.8, 1))):
        m.lathe([(0.0, 0.0), (0.12, 0.02), (0.15, 0.07), (0.12, 0.12), (0.0, 0.14)], 7, coat)
    # the head tucked against the body, ears up
    hx, hy, hz = 0.12, y - 0.1, 0.17
    with m.at(move(hx, hy, hz)):
        m.lathe([(0.0, -0.05), (0.06, -0.02), (0.06, 0.02), (0.0, 0.05)], 6, patch or coat, M=rot("Y", math.pi / 2))
        for sx in (-1, 1):
            m.face([(sx * 0.02, 0.0, 0.035), (sx * 0.05, 0.02, 0.035), (sx * 0.035, 0.01, 0.08)], coat, out=(0, -1, 0))
    # the tail wrapped round the front
    path = [(-0.17 + 0.3 * math.cos(a) * 0.55, y + 0.13 * math.sin(a), 0.11) for a in np.linspace(math.pi, 2.1 * math.pi, 7)]
    m.tube(path, 0.025, 4, coat)
    return m


def rope_unit():
    """One metre of washing line along +X (the game stretches and tilts it)."""
    m = Mesh()
    m.beam((0, 0, 0), (1, 0, 0), 0.018, 0.018, "rope")
    return m


def garment(kind, cell):
    m = Mesh()
    sl.garment(kind, cell, m=m, sway=0.06)
    return m


# ------------------------------------------------------------------ closures (the dead ends)
# The brick back wall itself is built in code (client/src/world/clutter.ts) to the alley's measured
# width and height, with the houses' own brick scale; these are the timber and stone parts set into
# its openings. Each has its origin at the bottom middle of the opening on the wall's front face
# (y = 0), the wall going back toward +Y, the viewer at -Y.


def ledged_door(m, x0, w, h, cell="planks_v", hinge=-1):
    """A ledged and braced board door filling an opening w wide, h high (x0 its middle): the
    leaf set back 0.1 m in the reveal, three ledges and two braces on its face, strap hinges on
    the hinge side, a thumb latch and a ring."""
    y = 0.1
    L, R = x0 - w / 2, x0 + w / 2
    quad(m, cell, (L, y, 0.0), (R, y, 0.0), (R, y, h), (L, y, h), out=(0, -1, 0))
    for z in (0.28, h * 0.5, h - 0.3):
        m.box((x0, y - 0.018, z), (w - 0.06, 0.035, 0.12), "wood")
    zs = (0.28, h * 0.5, h - 0.3)
    for za, zb in ((zs[0], zs[1]), (zs[1], zs[2])):
        # braces rise from the hinge side's lower ledge toward the latch side
        xa = x0 + hinge * (w / 2 - 0.12)
        xb = x0 - hinge * (w / 2 - 0.12)
        m.beam((xa, y - 0.018, za + 0.06), (xb, y - 0.018, zb - 0.06), 0.1, 0.03, "wood", side=(0, 1, 0))
    for z in (zs[0], zs[2]):
        m.box((x0 + hinge * (w / 2 - 0.25), y - 0.04, z), (0.46, 0.012, 0.045), "iron")
    m.box((x0 - hinge * (w / 2 - 0.12), y - 0.045, 1.02), (0.035, 0.02, 0.14), "iron")
    m.lathe([(0.035, -0.006), (0.035, 0.006)], 6, "iron", M=move(x0 - hinge * (w / 2 - 0.2), y - 0.05, 1.0) @ rot("X", math.pi / 2))


def frame(m, w, h, depth=0.1, t=0.05):
    """A thin timber frame lining the opening: two jambs and a head, flush with the wall face."""
    for sx in (-1, 1):
        m.box((sx * (w / 2 - t / 2), depth / 2, h / 2), (t, depth, h), "wood_dark")
    m.box((0, depth / 2, h - t / 2), (w, depth, t), "wood_dark")


def door_ledged():
    """A plain back door, 0.9 x 1.95 m: thin frame, ledged and braced leaf, a stone step."""
    m = Mesh(ao=0.0)
    w, h = 0.9, 1.95
    frame(m, w, h)
    ledged_door(m, 0.0, w - 0.1, h - 0.05, hinge=-1)
    m.box((0, -0.05, 0.025), (w + 0.06, 0.14, 0.05), "bluestone", shade=0.85, skip=("-z",))
    return m


def door_green():
    """The same door in old green paint, the hinges on the other side."""
    m = Mesh(ao=0.0)
    w, h = 0.9, 1.95
    frame(m, w, h)
    ledged_door(m, 0.0, w - 0.1, h - 0.05, cell="planks_green", hinge=1)
    return m


def gate_double():
    """A yard gate, 2.0 x 2.3 m: two ledged and braced leaves meeting in the middle, a timber
    frame with a heavier lintel beam, a drop bar."""
    m = Mesh(ao=0.0)
    w, h = 2.0, 2.3
    frame(m, w, h, t=0.07)
    m.box((0, 0.02, h + 0.07), (w + 0.3, 0.14, 0.16), "wood_dark")
    lw = (w - 0.14) / 2
    ledged_door(m, -lw / 2 - 0.005, lw, h - 0.07, cell="planks_tar", hinge=-1)
    ledged_door(m, lw / 2 + 0.005, lw, h - 0.07, cell="planks_tar", hinge=1)
    m.box((0, 0.03, 1.1), (0.5, 0.03, 0.05), "iron")
    return m


def window_small():
    """A small window high in a back wall, 0.6 x 0.7 m: a timber frame, dark small panes, two iron
    bars, a thin stone sill."""
    m = Mesh(ao=0.0)
    w, h = 0.6, 0.7
    for sx in (-1, 1):
        m.box((sx * (w / 2 - 0.025), 0.07, h / 2), (0.05, 0.08, h), "wood_dark")
    for z in (0.025, h - 0.025, h / 2):
        m.box((0, 0.07, z), (w, 0.08, 0.05 if z != h / 2 else 0.03), "wood_dark")
    m.box((0, 0.07, h / 2), (0.03, 0.08, h), "wood_dark")
    quad(m, "black", (-w / 2, 0.1, 0), (w / 2, 0.1, 0), (w / 2, 0.1, h), (-w / 2, 0.1, h), out=(0, -1, 0))
    for x in (-0.12, 0.12):
        m.beam((x, 0.02, 0.0), (x, 0.02, h), 0.018, 0.018, "iron")
    m.box((0, -0.03, -0.03), (w + 0.12, 0.12, 0.05), "bluestone", shade=0.9)
    return m


def coping_unit():
    """One metre of blue-stone coping for a back wall 0.3 m thick (x 0..1), a little proud in front."""
    m = Mesh(ao=0.0)
    m.box((0.5, 0.15, 0.05), (1.0, 0.4, 0.1), "bluestone", skip=("-z",))  # no bottom on the wall's top (z-fight check)
    return m


# ------------------------------------------------------------------ streets


def bench():
    """A plank bench against the wall, seat 0.45 m up; 1.5 m long."""
    m = Mesh(ao=0.5)
    m.box((0, -0.2, 0.45), (1.5, 0.32, 0.05), "wood")
    for sx in (-1, 1):
        m.beam((sx * 0.6, -0.08, 0.43), (sx * 0.62, -0.08, 0.0), 0.06, 0.06, "wood_dark")
        m.beam((sx * 0.6, -0.32, 0.43), (sx * 0.64, -0.36, 0.0), 0.06, 0.06, "wood_dark")
        m.beam((sx * 0.6, -0.08, 0.15), (sx * 0.6, -0.34, 0.15), 0.04, 0.04, "wood_dark")
    return m


def guard_stone():
    """A blue-stone guard stone (schampsteen) at a corner or a gateway, against cart wheels."""
    m = Mesh(ao=0.5)
    m.lathe([(0.17, 0.0), (0.17, 0.35), (0.13, 0.55), (0.06, 0.64), (0.0, 0.66)], 6, "bluestone", rot=0.3)
    return m


def street_bollard():
    m = Mesh(ao=0.6)
    m.lathe([(0.13, 0.0), (0.12, 0.6), (0.15, 0.66), (0.15, 0.72), (0.1, 0.78), (0.0, 0.82)], 8, "iron")
    return m


def leftovers():
    """What the market left: crushed crates, a split basket, cabbage leaves and straw."""
    m = Mesh(ao=0.5)
    with m.at(move(-0.3, -0.35, 0) @ rot("Z", 0.5) @ rot("Y", 0.25)):
        m.box((0, 0, 0.12), (0.6, 0.45, 0.24), "crate", skip=("+z",))
    m.beam((0.2, -0.2, 0.02), (0.8, -0.5, 0.03), 0.1, 0.02, "planks_old")
    m.beam((0.1, -0.7, 0.02), (0.5, -0.5, 0.05), 0.1, 0.02, "planks_old", shade=0.8)
    with m.at(move(0.45, -0.25, 0.12) @ rot("Y", 1.2)):
        m.lathe([(0.14, -0.12), (0.19, 0.12)], 7, "wicker", arc=(0, 4.2))
    for k in range(7):
        a = k * 2.1
        m.box((0.1 + 0.55 * math.cos(a), -0.55 + 0.35 * math.sin(a), 0.02), (0.15, 0.12, 0.02), "cabbage", shade=0.7 + 0.05 * k)
    return m


# ------------------------------------------------------------------ the street ends at the water


def kerb_quay():
    """One metre of edge kerb along the quay, 0.26 m high, its water face at y = 0 (+Y is the water)."""
    m = Mesh(ao=0.3)
    # z-fight check: no bottom (it lay in the quay's plane), and the pale top is the kerb's top, not a
    # slab on it (its bottom lay in the kerb's top)
    m.box((0.5, -0.19, 0.13), (1.0, 0.36, 0.26), "bluestone", skip=("-x", "+x", "-z", "+z"))
    m.box((0.5, -0.19, 0.265), (1.0, 0.36, 0.01), "whitestone", shade=0.8, skip=("-x", "+x", "-z"))
    return m


def chain_post():
    """A cast-iron post for a chain railing, a ball on top, an eye for the chain."""
    m = Mesh(ao=0.5)
    m.lathe([(0.1, 0.0), (0.08, 0.12), (0.065, 0.82), (0.09, 0.86), (0.07, 0.92), (0.0, 0.98)], 6, "iron_green")
    m.lathe([(0.0, 0.94), (0.06, 0.98), (0.05, 1.04), (0.0, 1.07)], 6, "iron_green")
    return m


def chain_span():
    """One metre of hanging chain from x = 0 to x = 1 at 0.8 m, sagging to 0.64 m (the game stretches it)."""
    m = Mesh()
    pts = []
    for k in range(9):
        t = k / 8
        pts.append((t, 0.0, 0.8 - 0.16 * math.sin(math.pi * t) ** 1.2))
    m.tube(pts, 0.016, 4, "iron")
    return m


def barrier_unit():
    """One metre of timber barrier: two rails, the top one painted white. The posts are barrier_post
    (clutter.ts puts one at every joint; a post here as well stood in the same place, z-fight check)."""
    m = Mesh(ao=0.8)
    m.box((0.5, -0.07, 1.0), (1.0, 0.05, 0.13), "paint_white")
    m.box((0.5, -0.07, 0.5), (1.0, 0.05, 0.13), "planks_tar")
    return m


def barrier_post():
    m = Mesh(ao=0.8)
    m.box((0.0, 0.0, 0.58), (0.13, 0.13, 1.16), "tarred")
    return m


def citywall_unit():
    """One metre of the old city wall, brick 3.4 m high on a blue-stone plinth, its town face at y = 0."""
    m = Mesh(ao=2.0)
    # z-fight check: no bottoms on the ground or the plinth, no brick top under the coping
    m.box((0.5, 0.4, 0.3), (1.0, 0.9, 0.6), "bluestone", skip=("-x", "+x", "-z"))
    m.box((0.5, 0.45, 2.0), (1.0, 0.8, 2.8), "brick_dark", skip=("-x", "+x", "-z", "+z"))
    m.box((0.5, 0.45, 3.46), (1.0, 0.9, 0.12), "bluestone")  # 1 m: the next unit's coping lay over it (z-fight check)
    return m


def citygate():
    """A closed gate in the wall: a stone frame with a flat arch, two tarred leaves with iron studs."""
    m = Mesh(ao=2.5)
    W, H = 3.2, 3.4
    for sx in (-1, 1):
        # the piers stop under the lintel: running up into it, their faces lay in its faces (z-fight check)
        m.box((sx * (W / 2 + 0.4), 0.45, 1.725), (0.8, 0.9, 3.45), "bluestone", skip=("-z", "+z"))
    m.box((0, 0.45, 3.9), (W + 1.6, 0.9, 0.9), "bluestone")
    m.box((0, 0.45, 4.42), (W + 1.8, 1.0, 0.16), "bluestone", shade=0.9)
    for sx in (-1, 1):
        x0, x1 = (0.0, sx * W / 2)
        quad(m, "planks_tar", (min(x0, x1), 0.15, 0.0), (max(x0, x1), 0.15, 0.0), (max(x0, x1), 0.15, H), (min(x0, x1), 0.15, H), out=(0, -1, 0))
        for z in (0.6, 1.7, 2.8):
            m.box((sx * W / 4, 0.12, z), (W / 2 - 0.2, 0.04, 0.08), "iron")
    m.box((0, 0.1, 1.5), (0.1, 0.06, 0.3), "iron")
    m.box((0, 0.3, 3.55), (W + 0.04, 0.3, 0.3), "bluestone", shade=0.7)  # its ends inside the piers (z-fight check)
    return m


# ------------------------------------------------------------------ decals


def wall_decal(cell, w, h, z0=0.0):
    m = Mesh()
    m.face([(-w / 2, -0.01, z0), (w / 2, -0.01, z0), (w / 2, -0.01, z0 + h), (-w / 2, -0.01, z0 + h)], cell,
           uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL, out=(0, -1, 0))
    return m


def poster(key):
    m = Mesh()
    W, H = 0.9, 1.24
    z0 = 1.05
    m.face([(-W / 2, -0.014, z0), (W / 2, -0.014, z0), (W / 2, -0.014, z0 + H), (-W / 2, -0.014, z0 + H)], f"poster_{key}",
           uvs=[(0, 0), (1, 0), (1, 1), (0, 1)], mat=DECAL, out=(0, -1, 0))
    return m


def build_models():
    B = [("barrel", barrel()), ("keg", keg()), ("crate", crate()), ("crates", crates()), ("crate_broken", crate_broken()),
         ("rain_butt", rain_butt()), ("downpipe", downpipe()), ("rain_head", rain_head()), ("broom", broom()), ("shovel", shovel()),
         ("handcart", handcart()), ("sacks", sacks()), ("baskets", baskets()), ("rubbish", rubbish()), ("rope_unit", rope_unit()),
         ("cat_grey", cat("cat_grey")), ("cat_black", cat("cat_black", "cat_white")), ("cat_ginger", cat("cat_ginger", "cat_white")),
         ("door_ledged", door_ledged()), ("door_green", door_green()), ("gate_double", gate_double()), ("window_small", window_small()),
         ("coping_unit", coping_unit()),
         ("bench", bench()), ("pump", sl.pump_iron()), ("trough", sl.trough()), ("guard_stone", guard_stone()),
         ("street_bollard", street_bollard()), ("leftovers", leftovers()),
         ("kerb_quay", kerb_quay()), ("chain_post", chain_post()), ("chain_span", chain_span()),
         ("barrier_unit", barrier_unit()), ("barrier_post", barrier_post()), ("citywall_unit", citywall_unit()), ("citygate", citygate()),
         ("moss_low", wall_decal("moss_low", 2.0, 0.8)), ("moss_low_b", wall_decal("moss_low_b", 2.0, 0.8)),
         ("streak", wall_decal("streak", 0.4, 1.8)),
         ("wet", sl.ground("wet", 1.3, 1.0)), ("leaves", sl.ground("leaves", 1.1, 1.1)), ("sweepings", sl.ground("sweepings", 1.2, 0.6))]
    for p in POSTERS:
        B.append((f"poster_{p['key']}", poster(p["key"])))
    for kind, cell, k in (("shirt", "linen_white", 0), ("shirt", "cloth_blue", 1), ("sheet", "linen_white", 0), ("sheet", "ticking", 1),
                          ("trousers", "cloth_grey", 0), ("trousers", "cloth_brown", 1), ("stockings", "cloth_red", 0),
                          ("towel", "linen_cream", 0), ("apron", "cloth_blue", 0), ("shift", "linen_cream", 0)):
        B.append((f"cloth_{kind}_{k}", garment(kind, cell)))
    return B


def preview(objs):
    cam = sl.stage()
    names = list(objs)
    per = 11
    rows = [names[i:i + per] for i in range(0, len(names), per)]
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
            o.location = (x - lo, r * 3.4, -zlo if zlo < 0 else 0)
            x += hi - lo + 0.35
        for n in row:
            objs[n].location.x -= x / 2
    bpy.context.view_layer.update()
    for mt in bpy.data.materials:
        if mt.name.startswith("cl_"):
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
            try:
                mt.surface_render_method = "DITHERED"
            except AttributeError:
                pass
    sl.aim(cam, (0, -11, 7), (0, 5, 0.8), lens=20)
    sl.render(os.path.join(SHOTS, "clutter_models.png"), (2200, 1300))


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
    node = bpy.data.objects.new("clutter_meta", None)
    node["meta"] = json.dumps({"solid": {"size": [sl.SOLID_ATLAS.W, sl.SOLID_ATLAS.H]}, "decal": {"size": [sl.DECAL_ATLAS.W, sl.DECAL_ATLAS.H]}},
                              separators=(",", ":"))
    bpy.context.scene.collection.objects.link(node)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_clutter] {n:18s} {c:5d} tris")
    print(f"[build_clutter] {len(objs)} models, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()
