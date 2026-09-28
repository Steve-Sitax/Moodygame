"""The arrival ferry and the Werf landing stage, Antwerp 1873, modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_ferry.py
    blender -b --factory-startup -P tools/blender/build_ferry.py -- --closeup ferry out.png [azimuth] [elevation]

Writes client/public/models/ferry.glb (Draco), two nodes:

  ferry          the paddle ferry "St. Anna" of the left-bank crossing (game/ferryArrival.ts): an iron
                 paddle steamer of about 24 m, as the Scheldt ferries to the Vlaamsch Hoofd were in the
                 1860s and 70s: black iron hull with a cream sheer line and red lead below, paddle boxes
                 with fan vents and her name, a bridge across the boxes with the helm and the telegraph,
                 one tall funnel, an engine-room skylight and cowl vents, a panelled deck saloon aft, an
                 open fore deck with benches along the rails for the foot passengers, a signal mast with
                 the steaming light, the side lights on the boxes (1863 rules), lifebuoys, fenders,
                 rubbing strakes, the anchor at the bow, and luggage and goods on deck. A gangway port
                 in the port rail (the pontoon side, +x) at y -4.5.
  landing_stage  the floating landing stage at the Werf (world/landingStage.ts): 60 m of deck on tarred
                 floats that ride the tide, weed and a tide line on the floats, a railed deck of loose
                 planks, a head with fenders and a rail with the gangway gap, iron bollards, cleats,
                 collars round the guide piles, a ladder, a waiting shelter with a ticket hatch and
                 notice boards, oil lamps on posts, crates, luggage, ropes and puddles.

Both follow build_boats.py: origin at the waterline, bow toward -Y (+Z in the game), metres, and the
same painted materials (our own work, see assets/ATTRIBUTION.md) plus a few painted here. The ferry's
extras say where her lamps, windows, gangway port, helm and bitts are; the stage's where its lamps,
bollards and the things on its deck that you walk into are (Blender x, y, z; the game reads x, z, -y).

The old arrival boat was boats.glb "paddle_tug" (build_boats.py tug(paddle=True)); the arrival no
longer uses it, and the old pontoon deck (boats.glb "pontoon_section") is hidden under this stage.
"""

import json
import math
import os
import random
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boats as bb  # noqa: E402  (mesh helpers, hull loft, painters, the boat materials)
import build_props as bp  # noqa: E402
from build_props import col, move, rot_z, speckle  # noqa: E402

V = bb.V
sm, cl, table = bb.sm, bb.cl, bb.table
OUT = os.path.join(bb.ROOT, "client", "public", "models", "ferry.glb")

# ------------------------------------------------------------------ our own paints

PARTS = []  # the loose things on deck and stage, for check_parts(): (name, where, lo, hi, on)

NEW = ["fan", "ferry_band", "float_slime", "notice", "wet", "lifebuoy", "stage_deck", "lamp_glass"]
IDX = {}


def paint_fan(seed):
    """A paddle box's face: black, a fan of cream vent slots rising from the shaft, a gilt rim."""
    rng = np.random.default_rng(seed)
    n = 128
    img = np.ones((n, n, 3)) * col((0.055, 0.052, 0.05))
    img *= (0.85 + 0.3 * bb.noise(rng, n, n, 8, 8))[..., None]
    vv, uu = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    cx, cy = n / 2, 10.0  # the shaft, low in the picture (row 0 is the bottom)
    dx, dy = uu - cx, vv - cy
    r = np.hypot(dx, dy)
    a = np.arctan2(dy, dx)
    up = dy > 0
    # vent slots between r 26 and 56, 11 of them
    k = (a / math.pi) * 11
    slot = up & (r > 26) & (r < 56) & (np.abs(k - np.round(k)) < 0.18)
    img[slot] = col((0.64, 0.6, 0.5))
    img[slot] *= (0.8 + 0.3 * rng.random(slot.sum()))[..., None]
    hub = up & (r < 20)
    img[hub] = col((0.62, 0.58, 0.48))
    gilt = up & (np.abs(r - 60) < 1.6)
    img[gilt] = col((0.55, 0.42, 0.18))
    gilt2 = up & (np.abs(r - 22.5) < 1.2)
    img[gilt2] = col((0.55, 0.42, 0.18))
    # rust weeping from the slots, soot high up
    for _ in range(40):
        u = int(rng.integers(8, n - 8))
        v0 = int(rng.integers(20, 90))
        img[max(0, v0 - int(rng.integers(6, 22))):v0, u] *= col((1.5, 0.9, 0.6))
    img *= (1 - 0.35 * np.clip((vv - 90) / 38, 0, 1))[..., None]
    return speckle(img, rng, 0.05)


def paint_ferry_band(seed):
    """The sheer strake: black plate with a cream line along it (v across the strake)."""
    rng = np.random.default_rng(seed)
    w, h = 128, 16
    img = np.ones((h, w, 3)) * col((0.06, 0.058, 0.056))
    img *= (0.85 + 0.3 * bb.noise(rng, w, h, 8, 2))[..., None]
    img[7:10] = col((0.66, 0.62, 0.5))
    img[7:10] *= (0.8 + 0.3 * bb.noise(rng, w, 3, 16, 1))[..., None]
    runs = rng.random((h, w)) < 0.06
    img[runs] *= col((1.4, 0.8, 0.5))
    img[-1] = col((0.03, 0.03, 0.03))
    return img


def paint_float_slime(seed):
    """A tarred float, v up its side: weed and green slime below the waterline (v 0.57), a pale tide line,
    tar with salt bloom above."""
    rng = np.random.default_rng(seed)
    n = 128
    img = np.ones((n, n, 3)) * col((0.08, 0.07, 0.06))
    grain = bb.noise(rng, n, n, 4, 32)
    img *= (0.75 + 0.5 * grain)[..., None]
    wl = int(0.571 * n)
    slime = col((0.12, 0.14, 0.07))
    weed = bb.noise(rng, n, n, 24, 5)
    for v in range(wl + 3):
        f = 1.0 if v < wl - 4 else (wl + 3 - v) / 7
        img[v] = img[v] * (1 - f) + slime * (0.7 + 0.6 * weed[v])[:, None] * f
    # weed strands hanging below the line
    for _ in range(70):
        u = int(rng.integers(0, n))
        ln = int(rng.integers(4, 26))
        img[max(0, wl - ln):wl, u] = col((0.09, 0.13, 0.05)) * rng.uniform(0.7, 1.3)
    img[wl + 3:wl + 6] = col((0.36, 0.35, 0.3)) * (0.8 + 0.4 * bb.noise(rng, n, 3, 12, 1))[..., None]
    salt = np.clip(bb.noise(rng, n, n, 5, 3) - 0.55, 0, 1) * 1.6
    img[wl + 6:] += (salt[wl + 6:] * 0.18)[..., None]
    for k in range(4):
        img[wl + 6 + k * 13] *= 0.45
    return speckle(img, rng, 0.05)


def paint_notice(seed):
    """Notice boards: a dark board, bills pasted on it (the ferry's times, the tariff), a heading in paint."""
    rng = np.random.default_rng(seed)
    n = 128
    img = np.ones((n, n, 3)) * col((0.16, 0.12, 0.09))
    img *= (0.8 + 0.4 * bb.noise(rng, n, n, 3, 24))[..., None]
    # heading "ST ANNA" in cream across the top
    ink = col((0.78, 0.72, 0.55))
    text = "ST ANNA"
    x0 = (n - (len(text) * 12 - 2)) // 2
    ytop = n - 6
    for k, ch in enumerate(text):
        g = bb.FONT.get(ch, bb.FONT[" "])
        for gy, row in enumerate(g):
            for gx, bit in enumerate(row):
                if bit == "1":
                    x = x0 + k * 12 + gx * 2
                    y = ytop - gy * 2 - 2
                    img[y:y + 2, x:x + 2] = ink
    # three bills: yellowed paper, rows of small print, a bold line
    for (u0, v0, w, h) in ((6, 8, 54, 88), (66, 40, 56, 56), (66, 6, 40, 30)):
        paper = col((0.66, 0.62, 0.5)) * rng.uniform(0.8, 1.0)
        img[v0:v0 + h, u0:u0 + w] = paper * (0.85 + 0.25 * bb.noise(rng, w, h, 6, 6))[..., None]
        img[v0 + h - 8:v0 + h - 4, u0 + 4:u0 + w - 4] = col((0.1, 0.09, 0.08))
        for v in range(v0 + 4, v0 + h - 12, 4):
            u = u0 + 4
            while u < u0 + w - 6:
                ln = int(rng.integers(2, 7))
                img[v, u:min(u + ln, u0 + w - 4)] = col((0.2, 0.18, 0.16))
                u += ln + int(rng.integers(1, 3))
        # damp at the foot, a torn corner
        img[v0:v0 + 6, u0:u0 + w] *= 0.8
        img[v0 + h - 5:v0 + h, u0 + w - 6:u0 + w] = col((0.16, 0.12, 0.09))
    return speckle(img, rng, 0.04)


def paint_wet(seed):
    """A puddle on the boards: the wet grey of the boards, the sky in pale streaks, a darker rim."""
    rng = np.random.default_rng(seed)
    n = 64
    img = np.ones((n, n, 3)) * col((0.27, 0.27, 0.27))
    img *= (0.85 + 0.25 * bb.noise(rng, n, n, 4, 4))[..., None]
    img += (np.clip(bb.noise(rng, n, n, 3, 12) - 0.5, 0, 1) * 0.9)[..., None] * col((0.55, 0.57, 0.6))
    vv, uu = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
    r = np.hypot(uu - n / 2, vv - n / 2) / (n / 2)
    img *= (1 - 0.3 * np.clip((r - 0.7) / 0.3, 0, 1))[..., None]
    return img


def paint_lifebuoy(seed):
    """A cork lifebuoy in painted canvas, v round the ring: four red and four white quarters."""
    rng = np.random.default_rng(seed)
    n = 64
    img = np.zeros((n, n, 3))
    for q in range(8):
        img[q * 8:(q + 1) * 8] = col((0.52, 0.1, 0.07)) if q % 2 else col((0.72, 0.7, 0.62))
    img *= (0.8 + 0.3 * bb.noise(rng, n, n, 6, 6))[..., None]
    img[:, ::16] *= 0.7  # the lashing line
    return speckle(img, rng, 0.06)


def paint_stage_deck(seed):
    """The stage's boards: weathered grey oak, grain along u, one board to a band, nail heads."""
    img = bp.paint_planks(seed, (0.4, 0.38, 0.34), boards=4, seams=False, joints=False, knots=3)
    rng = np.random.default_rng(seed + 1)
    S = img.shape[0]
    for b in range(4):
        for u in (6, S - 7):
            v = b * (S // 4) + S // 8
            img[v - 5, u] = img[v + 4, u] = (0.06, 0.055, 0.05)
    wear = np.clip(bb.noise(rng, S, S, 4, 4) - 0.5, 0, 1)[..., None] * 0.6
    return img * (1 - wear) + col((0.46, 0.45, 0.42)) * wear


def paint_lamp_glass(seed):
    """Lamp glass by day: a sooty pane in its frame (the game lights it at night)."""
    rng = np.random.default_rng(seed)
    n = 32
    img = np.ones((n, n, 3)) * col((0.28, 0.27, 0.22))
    img[3:-3, 3:-3] = col((0.42, 0.4, 0.3))
    img[20:, 3:-3] *= 0.6  # soot at the top
    return speckle(img, rng, 0.05)


PAINT = {"fan": paint_fan, "ferry_band": paint_ferry_band, "float_slime": paint_float_slime, "notice": paint_notice,
         "wet": paint_wet, "lifebuoy": paint_lifebuoy, "stage_deck": paint_stage_deck, "lamp_glass": paint_lamp_glass}


def boat_paints():
    """The painters of build_boats' materials we know by name (its own table sits inside its make_materials;
    a material added there later that we do not use gets a plain grey picture here)."""
    return {
        "wood": lambda: bp.paint_planks(1, (0.43, 0.37, 0.29)),
        "wood_dark": lambda: bp.paint_planks(2, (0.25, 0.19, 0.14), boards=2, seams=False, joints=False, knots=1),
        "iron": lambda: bp.paint_iron(3),
        "rope": lambda: bp.paint_rope(4),
        "sackcloth": lambda: bp.paint_sack(5),
        "crate": lambda: bp.paint_crate(6),
        "barrel": lambda: bp.paint_staves(7),
        "stone": lambda: bp.paint_stone(8),
        "glass": lambda: bp.paint_glass(9),
        "tar": lambda: bb.paint_tar(101),
        "iron_hull": lambda: bb.paint_iron_hull(103),
        "copper": lambda: bb.paint_metal(106, (0.36, 0.23, 0.13), (0.2, 0.3, 0.24)),
        "redlead": lambda: bb.paint_metal(107, (0.33, 0.1, 0.07), (0.16, 0.12, 0.08)),
        "deck": lambda: bp.paint_planks(108, (0.45, 0.42, 0.37), boards=8, knots=2),
        "paint_white": lambda: bb.paint_white(110),
        "canvas": lambda: bb.paint_canvas(111, (0.66, 0.63, 0.55)),
        "rigging": lambda: bb.paint_rigging(113),
        "funnel": lambda: bb.paint_funnel(116),
        "window": lambda: bb.paint_window(117),
        "flag": lambda: bb.paint_flag(120),
        "names": lambda: bb.paint_names(121),
    }


def material(name, arr, alpha=None):
    img = bb.image_rgba(f"{name}_tex", arr, alpha)
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Closest"
    bsdf = nt.nodes.get("Principled BSDF")
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if alpha is not None:
        nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 1.0
    m.use_backface_culling = name not in bb.THIN
    return m


def make_materials():
    known = boat_paints()
    for name in bb.MATS:
        res = known[name]() if name in known else np.ones((8, 8, 3)) * 0.3
        arr, alpha = res if isinstance(res, tuple) else (res, None)
        material(name, arr, alpha)
    cap = bpy.data.materials.new("cap")
    t = cap.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = bb.image_rgba("cap_tex", np.zeros((1, 1, 3)))
    for k, name in enumerate(NEW):
        material(name, PAINT[name](701 + k))
        IDX[name] = len(bb.MATS)
        bb.MATS.append(name)


# ------------------------------------------------------------------ small parts


def track(m, name, where, fn, on=()):
    """Build a loose thing with fn() and note its box (check_parts): `where` "ferry" or "stage", `on` what it stands on."""
    m.bm.verts.ensure_lookup_table()
    n0 = len(m.bm.verts)
    fn()
    m.bm.verts.ensure_lookup_table()
    vs = [m.bm.verts[i].co for i in range(n0, len(m.bm.verts))]
    if not vs:
        return  # (a sack left out of a "_bare" copy: the game draws the one sack model there)
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    PARTS.append((name, where, lo, hi, tuple(on)))


def lifebuoy(m, c, normal, r=0.32):
    """A lifebuoy hung flat against a rail or a wall, facing `normal`."""
    c, n = Vector(c), Vector(normal).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    pts = [c + a * r * math.cos(2 * math.pi * i / 10) + b * r * math.sin(2 * math.pi * i / 10) for i in range(10)]
    circ = 2 * math.pi * r
    m.tube(pts, [0.065] * 10, 5, IDX["lifebuoy"], side=tuple(n), closed_path=True, smooth=False, urep=1, vscale=1 / circ)


def fender(m, top, length=0.55, r=0.12):
    """A rope fender hanging from `top` on its lanyard."""
    top = Vector(top)
    m.line(top, top - V(0, 0, 0.35))
    a, b = top - V(0, 0, 0.35), top - V(0, 0, 0.35 + length)
    m.tube([a, a.lerp(b, 0.2), a.lerp(b, 0.8), b], [r * 0.6, r, r, r * 0.6], 6, bb.ROPE, smooth=False, cap0=True, cap1=True,
           urep=2, vscale=2)


def lantern(m, c, glass=None, h=0.42, w=0.26, roof=True):
    """An oil lantern: an iron frame round four panes, a little roof and a ring on top. c = the middle of the glass."""
    c = Vector(c)
    g = IDX["lamp_glass"] if glass is None else glass
    m.box(c - V(0, 0, h / 2 + 0.03), (w + 0.06, w + 0.06, 0.06), bb.IRON)
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        n = V(dx, dy, 0)
        r = V(-dy, dx, 0)
        p = c + n * (w / 2)
        pts = [p - r * w / 2 - V(0, 0, h / 2), p + r * w / 2 - V(0, 0, h / 2), p + r * w / 2 + V(0, 0, h / 2),
               p - r * w / 2 + V(0, 0, h / 2)]
        m.poly(pts, g, out=n, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    for sx in (1, -1):
        for sy in (1, -1):
            m.box(c + V(sx * w / 2, sy * w / 2, 0), (0.035, 0.035, h + 0.02), bb.IRON)
    if roof:
        top = c + V(0, 0, h / 2)
        with m.at(move(*top)):
            m.lathe([(w * 0.78, 0.0), (w * 0.78, 0.03), (0.05, 0.16), (0.04, 0.22)], 4, bb.IRON, rot=math.pi / 4,
                    smooth=False, cap1=True)
        with m.at(move(*(top + V(0, 0, 0.3)))):
            pts = [V(0.06 * math.cos(2 * math.pi * i / 6), 0, 0.06 * math.sin(2 * math.pi * i / 6)) for i in range(6)]
            m.tube(pts, [0.012] * 6, 3, bb.IRON, side=(0, 1, 0), closed_path=True, smooth=False)


def bollard(m, c, r=0.16, h=0.5):
    """A cast-iron bollard: a waisted post with a cap."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 1.35, 0.0), (r * 1.35, 0.05), (r, 0.1), (r * 0.9, h * 0.6), (r * 1.25, h * 0.85), (r * 1.25, h),
                 (0.02, h + 0.02)], 8, bb.IRON, smooth=False, cap1=True)


def cleat(m, c, along=(0, 1, 0)):
    c, a = Vector(c), Vector(along).normalized()
    m.beam(c - a * 0.18 + V(0, 0, 0.07), c + a * 0.18 + V(0, 0, 0.07), 0.06, 0.05, bb.IRON)
    for s in (-0.07, 0.07):
        m.box(c + a * s + V(0, 0, 0.035), (0.05, 0.05, 0.07), bb.IRON)


def trunk(m, c, yaw=0.0, size=(0.8, 0.46, 0.44)):
    """A travelling trunk: dark wood, iron corners and two straps."""
    c = Vector(c)
    L, W, H = size
    with m.at(move(*c) @ rot_z(yaw)):
        m.box((0, 0, H / 2), (L, W, H), bb.DARK, shade=0.9)
        m.box((0, 0, H + 0.02), (L - 0.02, W - 0.02, 0.05), bb.DARK, shade=1.05)
        for sx in (-0.25, 0.25):
            m.box((sx * L, 0, H / 2 + 0.01), (0.05, W + 0.02, H + 0.04), bb.IRON)
        m.box((0, W / 2 + 0.01, H * 0.7), (0.1, 0.02, 0.08), bb.IRON)


def basket(m, c, r=0.24, h=0.34):
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.8, 0.0), (r, h), (r * 0.9, h), (r * 0.7, 0.04)], 8, bb.SACK, smooth=False, cap0=True, urep=3)
        m.tube([V(-r, 0, h), V(-r * 0.6, 0, h + 0.2), V(r * 0.6, 0, h + 0.2), V(r, 0, h)], [0.02] * 4, 3, bb.WOOD, smooth=False)


def puddle(m, c, rx, ry, seed, z):
    rnd = random.Random(seed)
    pts = []
    for i in range(9):
        a = 2 * math.pi * i / 9
        k = rnd.uniform(0.7, 1.15)
        pts.append(V(c[0] + rx * k * math.cos(a), c[1] + ry * k * math.sin(a), z))
    m.poly(pts, IDX["wet"], out=(0, 0, 1), uvs=[((p.x - c[0]) / 1.2 + 0.5, (p.y - c[1]) / 1.2 + 0.5) for p in pts])


def ladder(m, top, bottom_z, along=(1, 0, 0), half=0.22, step=0.3, mat=None):
    """An iron ladder standing up from bottom_z to top (x, y, z), its rungs along `along`."""
    top, a = Vector(top), Vector(along).normalized()
    mt = bb.IRON if mat is None else mat
    for s in (-half, half):
        m.beam(V(top.x, top.y, bottom_z) + a * s, top + a * s + V(0, 0, 0.35), 0.05, 0.05, mt)
    z = bottom_z + step / 2
    while z < top.z:
        m.beam(V(top.x, top.y, z) - a * half, V(top.x, top.y, z) + a * half, 0.03, 0.03, mt, caps=False)
        z += step


# ------------------------------------------------------------------ the ferry

L, B, KZ = 24.0, 4.8, -1.35
TP = 0.44  # the paddle shaft's station
PORT = (0.6625, 0.7125)  # the gangway port, stations (y -3.9 .. -5.1)
ZA, RB = 1.1, 2.05  # paddle shaft height over the waterline, the box's radius


def yat(t):
    return L / 2 - t * L


def tat(y):
    return (L / 2 - y) / L


def deckz(t):
    return 1.35 + 0.3 * max(0.0, (t - 0.72) / 0.28) ** 2 + 0.12 * max(0.0, (0.12 - t) / 0.12) ** 2


def sheer(t):
    return deckz(t) + 0.24


def keel(t):
    return KZ + 0.4 * sm((t - 0.93) / 0.07) + 0.3 * sm((0.07 - t) / 0.07)


SEC = [(0, 0.5), (0.15, 0.86), (0.35, 0.98), (1, 1.0)]


def uz(z):
    return cl((z - KZ) / (1.6 - KZ))


def hbf(t, z):
    u = uz(z)
    sec = table(SEC, u)
    if t > 0.62:
        f = (t - 0.62) / 0.38
        p = (1 - min(f, 1.0) ** 1.8) ** (0.8 + 0.5 * (1 - u))
    elif t < 0.3:
        f = (0.3 - t) / 0.3
        p = (1 - 0.62 * min(f, 1.0) ** 2) ** (0.5 + 1.2 * (1 - u))
    else:
        p = 1.0
    return max(0.03, B / 2 * sec * p)


def yfn(t, z):
    u = uz(z)
    return -0.5 * u * sm((t - 0.9) / 0.1) + 0.7 * u ** 2 * sm((0.1 - t) / 0.1)


def in_port(sx, ta, tb):
    return sx == 1 and ta >= PORT[0] - 1e-6 and tb <= PORT[1] + 1e-6


def ferry():
    m = bb.Mesh(ao=0.0)
    ts = [0, 0.03, 0.07, 0.12, 0.2, 0.3, 0.38, 0.44, 0.5, 0.58, PORT[0], PORT[1], 0.78, 0.85, 0.9, 0.94, 0.97, 0.99, 1.0]
    levels = [keel, lambda t: keel(t) + 0.5, lambda t: -0.05, lambda t: 0.95, lambda t: sheer(t) - 0.12, sheer]
    mats = [(bb.REDLEAD, 0), (bb.REDLEAD, 0), (bb.IRONHULL, 0), (bb.IRONHULL, 0), (IDX["ferry_band"], 3.0)]
    hull = bb.Hull(L, ts, levels, hbf, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 1.6) / 3.0))
    # the gangway port: no bulwark and no sheer strake over it, the side runs up to the deck there
    hull.outer(m, skip=lambda sx, k, ta, tb: k >= 3 and in_port(sx, ta, tb))
    for ta, tb in ((PORT[0], PORT[1]),):
        pts = [hull.P(ta, 0.95, 1), hull.P(tb, 0.95, 1), hull.P(tb, deckz(tb) + 0.04, 1), hull.P(ta, deckz(ta) + 0.04, 1)]
        m.poly(pts, bb.IRONHULL, out=(1, 0, 0), uvs=[(-p.y / 4, p.z / 4) for p in pts])
    hull.deck(m, deckz, 0, 1, 0.1, bb.DECK)
    hull.rail(m, deckz, sheer, 0, 1, 0.1, bb.DARK, bb.WOOD, skip=lambda sx, k, ta, tb: in_port(sx, ta, tb))
    # the sill of the port: a worn oak board flush with the deck, and the gate posts at its ends
    pa, pb = hull.P(PORT[0], deckz(PORT[0]), 1, 0.05), hull.P(PORT[1], deckz(PORT[1]), 1, 0.05)
    m.box(((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, deckz(0.6875) + 0.015), (0.16, abs(pb.y - pa.y), 0.03), bb.WOOD, shade=1.1)
    for t in PORT:
        p = hull.P(t, deckz(t), 1, 0.07)
        m.box((p.x, p.y, deckz(t) + 0.55), (0.14, 0.14, 1.1), bb.DARK)
        m.box((p.x, p.y, deckz(t) + 1.12), (0.18, 0.18, 0.05), bb.DARK, shade=1.1)

    # --- rubbing strakes (wales), bow to stern, and a rope fender round the stem
    for z, h in ((0.95, 0.16), (0.45, 0.12)):
        T = [t for t in ts if 0.05 <= t <= 0.95]
        for ta, tb in zip(T, T[1:]):
            for sx in (1, -1):
                a = hull.P(ta, z, sx) + V(sx * 0.05, 0, 0)
                b = hull.P(tb, z, sx) + V(sx * 0.05, 0, 0)
                m.beam(a, b, 0.1, h, bb.DARK, side=(0, 0, 1), shade=0.9, caps=False)
    stem = V(0, hull.y(1.0, sheer(1.0) - 0.4), sheer(1.0) - 0.4)
    m.tube([stem + V(-0.45, 0.35, 0), stem + V(0, -0.12, 0), stem + V(0.45, 0.35, 0)], [0.16, 0.2, 0.16], 5, bb.ROPE,
           side=(0, 0, 1), smooth=False, cap0=True, cap1=True)

    # --- the open rail on the bulwark: iron stanchions, a wooden top rail, two rods (lines)
    rail_ts = [t for t in np.linspace(0.04, 0.975, 22)]
    for sx in (1, -1):
        prev = None
        for t in rail_ts:
            t = float(t)
            if sx == 1 and PORT[0] - 0.005 < t < PORT[1] + 0.005:
                prev = None
                continue
            p = hull.P(t, sheer(t), sx, 0.05)
            m.box((p.x, p.y, sheer(t) + 0.42), (0.04, 0.04, 0.84), bb.IRON)
            top = V(p.x, p.y, sheer(t) + 0.84)
            if prev is not None:
                m.beam(prev, top, 0.08, 0.06, bb.WOOD, side=(0, 0, 1), caps=False)
                for f in (0.35, 0.65):
                    m.line(prev - V(0, 0, 0.84 * f), top - V(0, 0, 0.84 * f))
            prev = top
        # the port's own ends: a top rail stub to the gate post
    # --- paddle boxes, sponsons, the wheels
    yc = yat(TP)
    xin = hbf(TP, 1.2)
    xout = xin + 1.15
    lights = {"side": [], "mast": None, "lanterns": [], "windows": [], "smoke": []}
    for sx in (1, -1):
        arc = [(yc + RB * math.cos(math.pi * j / 10), ZA + RB * math.sin(math.pi * j / 10)) for j in range(11)]
        prof = [(yc + RB, 0.85)] + arc + [(yc - RB, 0.85)]
        # the outer face with the fan, the inner face plain, the arched top
        for x, n, mat in ((sx * xout, sx, IDX["fan"]), (sx * xin, -sx, bb.DARK)):
            pts = [V(x, y, z) for y, z in prof]
            uvs = [((yc - y) / (2 * RB) * (1 if sx > 0 else -1) + 0.5, (z - 0.85) / (ZA + RB - 0.85) * 0.92 + 0.02) for y, z in prof]
            m.poly(pts, mat, out=(n, 0, 0), uvs=uvs)
        for (ya, za), (yb, zb) in zip(prof, prof[1:]):
            pts = [V(sx * xin, ya, za), V(sx * xout, ya, za), V(sx * xout, yb, zb), V(sx * xin, yb, zb)]
            mid = V(0, (ya + yb) / 2 - yc, (za + zb) / 2 - ZA)
            m.poly(pts, bb.IRONHULL, out=(0, mid.y, mid.z), uvs=[(p.x / 1.2, (p.y + p.z) / 1.2) for p in pts])
        # a moulding round the face, the name on a board below the fan
        for (ya, za), (yb, zb) in zip(arc, arc[1:]):
            m.beam(V(sx * (xout + 0.03), ya, za), V(sx * (xout + 0.03), yb, zb), 0.06, 0.08, bb.WOOD, side=(1, 0, 0), caps=False)
        bb.name_board(m, (sx * (xout + 0.02), yc, ZA + 0.02), (0, sx, 0), (0, 0, 1), 2.4, 0.3, 6, off=0.02)
        # the wheel under the box: two iron rims, spokes, ten floats
        wx = sx * (xin + xout) / 2
        for dx in (-0.42, 0.42):
            ring = [V(wx + dx, yc + 1.8 * math.cos(2 * math.pi * i / 14), ZA + 1.8 * math.sin(2 * math.pi * i / 14)) for i in range(14)]
            m.tube(ring, [0.035] * 14, 4, bb.IRON, side=(1, 0, 0), closed_path=True, smooth=False)
            for i in range(10):
                a = 2 * math.pi * (i + 0.5) / 10
                m.beam(V(wx + dx, yc, ZA), V(wx + dx, yc + 1.78 * math.cos(a), ZA + 1.78 * math.sin(a)), 0.04, 0.04, bb.IRON)
        for i in range(10):
            a = 2 * math.pi * (i + 0.5) / 10
            c = V(wx, yc + 1.62 * math.cos(a), ZA + 1.62 * math.sin(a))
            d = V(0, math.cos(a), math.sin(a))
            m.beam(c - d * 0.17, c + d * 0.17, 1.0, 0.05, bb.DARK, side=(1, 0, 0))
        m.beam(V(sx * (xin - 0.3), yc, ZA), V(sx * (xout - 0.06), yc, ZA), 0.22, 0.22, bb.IRON)
        # sponsons fore and aft of the box, at the deck, with a short rail
        for dy in (-1, 1):
            y0 = yc + dy * RB
            y1 = yc + dy * (RB + 2.2)
            z = deckz(tat(y0)) - 0.05
            tri = [V(sx * xin, y0, z), V(sx * xout, y0, z), V(sx * xin, y1, z)]
            m.prism([p - V(0, 0, 0.14) for p in tri], (0, 0, 0.14), bb.DECK, side_mat=bb.DARK)
            m.beam(V(sx * xout, y0, z - 0.1), V(sx * (xin + 0.05), y1, z - 0.1), 0.12, 0.2, bb.DARK, side=(0, 0, 1))
            for f in (0.0, 0.5, 1.0):
                p = V(sx * xout, y0, z).lerp(V(sx * (xin + 0.05), y1, z), f)
                m.box((p.x, p.y, z + 0.45), (0.04, 0.04, 0.9), bb.IRON)
            m.beam(V(sx * xout, y0, z + 0.9), V(sx * (xin + 0.05), y1, z + 0.9), 0.07, 0.06, bb.WOOD, side=(0, 0, 1))
        # the side light: a lantern on the fore end of the box top, screened inboard (port red on +x)
        lp = V(sx * (xout - 0.3), yc - RB * 0.55, ZA + RB * 0.84 + 0.3)
        m.box(lp - V(sx * 0.22, 0, 0), (0.04, 0.9, 0.55), bb.DARK)  # the screen board
        m.box(lp - V(0, 0, 0.3), (0.5, 0.9, 0.06), bb.DARK)  # its shelf
        lantern(m, lp, h=0.36, w=0.24)
        lights["side"].append([round(lp.x, 3), round(lp.y, 3), round(lp.z, 3), sx])
        # fenders hanging over the side on the pontoon side, and a lifebuoy on each box
        lifebuoy(m, (sx * (xout + 0.1), yc + RB * 0.62, ZA + 0.9), (sx, 0, 0), r=0.3)
    for sx in (1, -1):
        for t in (0.2, 0.3, 0.58, 0.63, 0.76, 0.84):
            p = hull.P(t, sheer(t), sx)
            fender(m, p + V(sx * 0.12, 0, 0.1))

    # --- the bridge across the boxes: deck, rails, the helm and the telegraph, ladders up from the deck
    zb = ZA + RB + 0.05
    m.box((0, yc, zb - 0.04), (2 * xout + 0.2, 1.1, 0.08), bb.DECK, shade=1.0)
    m.beam(V(-xout, yc - 0.5, zb - 0.14), V(xout, yc - 0.5, zb - 0.14), 0.12, 0.16, bb.DARK, side=(0, 1, 0))
    m.beam(V(-xout, yc + 0.5, zb - 0.14), V(xout, yc + 0.5, zb - 0.14), 0.12, 0.16, bb.DARK, side=(0, 1, 0))
    for dy in (-0.52, 0.52):
        xs = np.linspace(-xout, xout, 9)
        for x in xs:
            m.box((float(x), yc + dy, zb + 0.5), (0.04, 0.04, 1.0), bb.IRON)
        m.beam(V(-xout, yc + dy, zb + 1.0), V(xout, yc + dy, zb + 1.0), 0.08, 0.06, bb.WOOD, side=(0, 1, 0))
        m.line(V(-xout, yc + dy, zb + 0.5), V(xout, yc + dy, zb + 0.5))
    # a canvas dodger on the fore rail of the bridge
    m.poly([V(-1.6, yc - 0.55, zb + 0.1), V(1.6, yc - 0.55, zb + 0.1), V(1.6, yc - 0.55, zb + 0.95), V(-1.6, yc - 0.55, zb + 0.95)],
           bb.CANVAS, out=(0, -1, 0))
    m.box((0, yc + 0.1, zb + 0.35), (0.3, 0.3, 0.7), bb.DARK)
    bb.wheel_helm(m, (0, yc - 0.08, zb + 1.0), r=0.45)
    with m.at(move(0.9, yc - 0.2, zb)):
        m.lathe([(0.1, 0.0), (0.07, 0.9), (0.16, 0.95), (0.16, 1.15), (0.02, 1.2)], 8, bb.COPPER, smooth=False, cap1=True)
    for sx in (1, -1):
        x = sx * 1.25
        a, b = V(x, yc - 0.55, zb), V(x, yc - 0.55 - 1.25, deckz(tat(yc - 1.8)))
        for s in (-0.25, 0.25):
            m.beam(a + V(s, 0, 0.9), b + V(s, 0, 0), 0.05, 0.12, bb.DARK, side=(1, 0, 0))
        for k in range(1, 8):
            p = b.lerp(a, k / 8)
            m.box((p.x, p.y, p.z), (0.5, 0.18, 0.04), bb.WOOD)
    lights["lanterns"].append([0.0, round(yc - 0.72, 3), round(zb - 0.35, 3)])
    m.beam(V(0, yc - 0.55, zb - 0.1), V(0, yc - 0.72, zb - 0.1), 0.03, 0.03, bb.IRON)
    lantern(m, V(0, yc - 0.72, zb - 0.35), h=0.3, w=0.2)
    helm = [0.0, round(yc + 0.3, 3), round(zb, 3)]

    # --- the funnel with its steam pipe and whistle, the stays; cowl vents; the engine-room skylight
    fy = yc + 1.25
    fz = deckz(tat(fy))
    FH = 7.4
    with m.at(move(0, fy, fz) @ Matrix.Rotation(-0.05, 4, "X")):
        m.lathe([(0.55, -0.1), (0.5, 0.4), (0.5, FH), (0.55, FH + 0.05), (0.55, FH + 0.2)], 10, bb.FUNNEL, urep=2,
                vscale=1 / FH, smooth=False)
        m.tube([V(0, 0.6, 0.3), V(0, 0.6, FH + 0.3)], [0.06, 0.06], 5, bb.COPPER, smooth=False, cap1=True)
        m.lathe([(0.07, FH + 0.3), (0.09, FH + 0.4), (0.09, FH + 0.62), (0.03, FH + 0.66)], 6, bb.COPPER, rot=0,
                smooth=False, cap1=True)
        m.lathe([(0.66, 1.4), (0.66, 1.52)], 10, bb.IRON, smooth=False)
    top = V(0, fy + math.sin(0.05) * FH, fz + FH * math.cos(0.05))
    lights["smoke"] = [round(top.x, 3), round(top.y, 3), round(top.z + 0.2, 3)]
    for dx, dy in ((1.7, 1.6), (-1.7, 1.6), (1.6, -0.6), (-1.6, -0.6)):
        bb.rig(m, V(0, fy + 0.3, fz + FH * 0.72), (dx, fy + dy, sheer(tat(fy + dy)) + 0.05), 0.018)
    for sx in (1, -1):
        vx, vy = sx * 1.25, fy + 1.1
        vz = deckz(tat(vy))
        with m.at(move(vx, vy, vz)):
            m.lathe([(0.15, 0.0), (0.13, 0.12), (0.13, 1.35)], 8, bb.WHITE, smooth=False)
        with m.at(move(vx, vy, vz + 1.35) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            # the cowl turned to the bow: a bell mouth, red inside
            m.lathe([(0.13, -0.05), (0.2, 0.1), (0.3, 0.3), (0.33, 0.42)], 8, bb.WHITE, smooth=False)
            m.lathe([(0.31, 0.41), (0.28, 0.3), (0.18, 0.12), (0.11, -0.03)], 8, bb.REDLEAD, smooth=False)
    sy0, sy1 = fy + 1.9, fy + 3.6
    sz = deckz(tat((sy0 + sy1) / 2))
    m.box((0, (sy0 + sy1) / 2, sz + 0.25), (1.5, sy1 - sy0, 0.5), bb.DARK)
    for sx in (1, -1):
        pts = [V(sx * 0.75, sy0, sz + 0.5), V(sx * 0.75, sy1, sz + 0.5), V(0, sy1, sz + 0.85), V(0, sy0, sz + 0.85)]
        m.poly(pts, bb.WINDOW, out=(sx, 0, 1), uvs=[(0, 0), (2, 0), (2, 1), (0, 1)])
        for k in range(5):
            y = sy0 + (sy1 - sy0) * (k + 0.5) / 5
            m.beam(V(sx * 0.72, y, sz + 0.53), V(0, y, sz + 0.87), 0.025, 0.025, bb.COPPER)
    m.beam(V(0, sy0, sz + 0.87), V(0, sy1, sz + 0.87), 0.06, 0.05, bb.DARK)

    # --- the deck saloon aft: panelled, windows both sides and aft, a door forward, a skylight and a stove pipe
    s0, s1 = 5.8, 9.9
    hz = deckz(tat(7.5))
    wins = [6.4, 7.2, 8.0, 8.8, 9.5]
    bb.house(m, -1.5, 1.5, s0, s1, hz - 0.03, hz + 2.05, wall=bb.WOOD, roof=bb.DARK, over=0.12,
             windows=[("+x", y, hz + 1.35) for y in wins] + [("-x", y, hz + 1.35) for y in wins] + [("+y", -0.7, hz + 1.35), ("+y", 0.7, hz + 1.35)],
             door=("-y", 0.0, 0.8, 1.8), roof_rise=0.14)
    for y in wins:
        for sx in (1, -1):
            lights["windows"].append([round(sx * 1.53, 3), y, round(hz + 1.35, 3), sx, 0, 0.5, 0.44])
    for x in (-0.7, 0.7):
        lights["windows"].append([x, round(s1 + 0.03, 3), round(hz + 1.35, 3), 0, 1, 0.5, 0.44])
    lights["windows"].append([0.0, round(s0 - 0.03, 3), round(hz + 1.55, 3), 0, -1, 0.3, 0.3])  # the door's light
    # a plinth and a moulding round the saloon, handrails on its roof
    m.box((0, (s0 + s1) / 2, hz + 0.08), (3.06, s1 - s0 + 0.06, 0.16), bb.DARK, skip=("+z", "-z"))
    m.box((0, (s0 + s1) / 2, hz + 1.72), (3.04, s1 - s0 + 0.04, 0.06), bb.DARK, skip=("+z", "-z"))
    m.box((0, 7.9, hz + 2.3), (0.9, 1.1, 0.3), bb.DARK)
    m.box((0, 7.9, hz + 2.46), (0.8, 1.0, 0.04), bb.WINDOW)
    bb.chimney(m, 0.9, 9.2, hz + 2.1, h=0.7, r=0.08)
    lifebuoy(m, (0.0, s1 + 0.05, hz + 0.75), (0, 1, 0), r=0.3)
    # the ensign on its staff at the stern
    fs = V(0, hull.y(0.01, sheer(0.01)) - 0.3, sheer(0.01))
    bb.spar(m, fs, fs + V(0, 0.25, 3.0), 0.045, 0.03, cap=True)
    bb.flag(m, fs + V(0, 0.28, 2.9), 1.3, 0.85, along=(0, 1, -0.1), kind="belgian")
    bb.name_board(m, (0, hull.y(0.0, sheer(0.0) - 0.35) + 0.05, sheer(0.0) - 0.4), (1, 0, 0), (0, 0, 1), 1.9, 0.26, 1, off=0.03)
    bb.hull_name(m, hull, 0.9, sheer(0.9) - 0.4, 1.9, 0.26, 6)
    for sx in (1, -1):
        track(m, f"stern bitts {sx}", "ferry", lambda: bb.bitts(m, sx * 0.9, yat(0.05), deckz(0.05), 0.45, 0.18))
        track(m, f"stern coil {sx}", "ferry", lambda: bb.coil(m, (sx * 0.9, yat(0.08), deckz(0.08)), 0.24))

    # --- the fore deck: benches along the rails, the mast with the steaming light, the bow's gear, goods
    def bench(t0, t1, sx, label):
        # short lengths where the bows draw in, each set to the narrower end (the bulwark's inside)
        n = max(1, round((yat(t0) - yat(t1)) / (0.65 if t1 > 0.66 else 1.3)))
        for k in range(n):
            ta = t0 + (t1 - t0) * k / n
            tb = t0 + (t1 - t0) * (k + 1) / n
            track(m, f"{label} {k}", "ferry", lambda: bench_part(ta, tb, sx, k))

    def bench_part(ta, tb, sx, k):
        if True:
            tm = (ta + tb) / 2
            xr = min(hbf(ta, deckz(ta)), hbf(tb, deckz(tb))) - 0.1
            x = sx * (xr - 0.26)
            ya, yb = yat(ta) - 0.03, yat(tb) + 0.03
            z = deckz(tm)
            for i, dx in enumerate((-0.13, 0.0, 0.13)):
                m.beam(V(x + sx * dx, ya, z + 0.44), V(x + sx * dx, yb, z + 0.44), 0.1, 0.035, bb.WOOD, side=(1, 0, 0))
            for dz in (0.66, 0.84):
                m.beam(V(sx * (xr - 0.06), ya, z + dz), V(sx * (xr - 0.06), yb, z + dz), 0.035, 0.09, bb.WOOD, side=(1, 0, 0))
            for y in (ya - 0.08 if k else ya - 0.1, yb + 0.1):
                m.box((x, y, z + 0.21), (0.36, 0.04, 0.42), bb.IRON)

    bench(0.555, PORT[0] - 0.012, 1, "bench port aft")
    bench(PORT[1] + 0.012, 0.8, 1, "bench port fore")
    bench(0.555, 0.8, -1, "bench starboard")
    tm = 0.842
    my = yat(tm)
    mz = deckz(tm)
    bb.spar(m, (0, my, mz), (0, my + 0.15, mz + 10.2), 0.13, 0.07, bb.DARK, cap=True)
    bb.spar(m, (-1.1, my + 0.1, mz + 8.9), (1.1, my + 0.1, mz + 8.9), 0.04, 0.035, bb.DARK)
    m.box((0, my + 0.03, mz + 0.35), (0.34, 0.34, 0.7), bb.DARK)  # the mast's partner and fife rail
    for sx in (1, -1):
        m.beam(V(sx * 0.6, my - 0.3, mz + 0.62), V(sx * 0.6, my + 0.35, mz + 0.62), 0.08, 0.06, bb.WOOD, side=(0, 0, 1))
        for y in (my - 0.3, my + 0.35):
            m.box((sx * 0.6, y, mz + 0.31), (0.07, 0.07, 0.62), bb.DARK)
        for k in range(2):
            t = 0.8 + k * 0.03
            bb.rig(m, hull.P(t, sheer(t), sx, 0.02), (0, my + 0.1, mz + 8.4), 0.02)
        bb.rig(m, (sx * 1.05, my + 0.1, mz + 8.9), (sx * 0.4, my + 0.3, mz + 1.2), 0.012)
    bb.rig(m, (0, my + 0.1, mz + 9.6), stem + V(0, 0.1, 0.45), 0.02)
    bb.rig(m, (0, my + 0.15, mz + 10.1), (0, hull.y(0.02, sheer(0.02)), sheer(0.02) + 0.8), 0.018)
    bb.pennant(m, (0, my + 0.15, mz + 10.3), 1.2, h=0.2)
    mh = V(0, my - 0.3, mz + 7.6)
    m.box(mh + V(0, 0.15, -0.3), (0.08, 0.3, 0.06), bb.IRON)
    lantern(m, mh, h=0.4, w=0.26)
    lights["mast"] = [round(mh.x, 3), round(mh.y, 3), round(mh.z, 3)]
    # the bow: windlass, bitts, the anchor on the starboard bow, coils
    track(m, "windlass", "ferry", lambda: bb.windlass(m, 0, yat(0.925), deckz(0.925) + 0.35, w=1.1, r=0.16))
    for sx in (1, -1):
        track(m, f"bow bitts {sx}", "ferry", lambda: bb.bitts(m, sx * 0.55, yat(0.895), deckz(0.895), 0.5, 0.18))
    ta = 0.93
    ap = hull.P(ta, sheer(ta) - 0.15, -1) + V(-0.2, 0, 0)
    m.beam(hull.P(ta, sheer(ta), -1, 0.1), ap + V(0, 0, 0.1), 0.14, 0.14, bb.DARK)
    bb.anchor(m, ap, side=(1, 0, 0), size=0.5)
    track(m, "bow coil", "ferry", lambda: bb.coil(m, (0.0, yat(0.95), deckz(0.95)), 0.22))
    track(m, "mast coil", "ferry", lambda: bb.coil(m, (-0.35, yat(0.87), deckz(0.87)), 0.26))
    # goods forward of the benches, each side of the mast: crates, a barrel, a sack; a trunk and a basket by the benches
    track(m, "crate", "ferry", lambda: bb.crate_lo(m, (-1.17, yat(0.82), deckz(0.82)), (0.62, 0.5, 0.5), 0.04))
    track(m, "crate on top", "ferry", lambda: bb.crate_lo(m, (-1.15, yat(0.82), deckz(0.82) + 0.5), (0.5, 0.42, 0.4), -0.15), on=["crate"])
    track(m, "barrel", "ferry", lambda: bb.barrel_lo(m, (1.2, yat(0.82), deckz(0.82))))
    track(m, "sack", "ferry", lambda: bb.sack_lo(m, (1.0, yat(0.855), deckz(0.855)), yaw=math.pi / 2))
    track(m, "trunk", "ferry", lambda: trunk(m, (-1.2, yat(0.745), deckz(0.745)), yaw=math.pi / 2 + 0.05, size=(0.7, 0.42, 0.4)))
    track(m, "basket", "ferry", lambda: basket(m, (-1.35, yat(0.575), deckz(0.575))))
    for sx in (1, -1):
        t = 0.62 if sx < 0 else 0.6
        p = hull.P(t, sheer(t), sx, 0.05)
        lifebuoy(m, (p.x + sx * 0.08, p.y, sheer(t) + 0.45), (sx, 0, 0), r=0.3)
    # the gangway lantern on the aft gate post
    gp = hull.P(PORT[0], deckz(PORT[0]), 1, 0.07)
    lp = V(gp.x - 0.12, gp.y + 0.05, deckz(PORT[0]) + 1.55)
    m.beam(V(gp.x, gp.y, deckz(PORT[0]) + 1.1), lp + V(0, 0, 0.3), 0.04, 0.04, bb.IRON)
    lantern(m, lp, h=0.3, w=0.2)
    lights["lanterns"].append([round(lp.x, 3), round(lp.y, 3), round(lp.z, 3)])

    m.extras = {
        "lights": lights,
        "gangway": {"y": -4.5, "x": round(hbf(0.6875, deckz(0.6875)), 3), "deck": round(deckz(0.6875), 3), "half": 0.6},
        "helm": helm,
        "bitts": [[0.55, round(yat(0.895), 3), round(deckz(0.895) + 0.4, 3)], [0.9, round(yat(0.05), 3), round(deckz(0.05) + 0.35, 3)]],
    }
    m.smoke.append(top + V(0, 0, 0.2))
    return m, hull


# ------------------------------------------------------------------ the landing stage

SL, SW, DT = 60.0, 2.25, 1.8  # its head's distance from the quay, half width of the deck, deck top over the waterline
GAP = 5.9  # it floats this far off the quay wall; the quay's gangway spans the water (rijnkaai.ts PONTOON_GAP)


def stage():
    m = bb.Mesh(ao=0.0)
    rnd = random.Random(1873)
    slime = IDX["float_slime"]
    # --- floats: a pair per 10 m, tarred, rounded ends, weed below the waterline; posts and bracing
    seg = (SL - GAP) / 6
    for i in range(6):
        y0 = GAP + i * seg + 0.4
        y1 = y0 + seg - 0.8
        for sx in (1, -1):
            cx = sx * 1.35
            out = []
            for j in range(5):
                a = math.pi * j / 4
                out.append(V(cx + 0.75 * math.cos(a), y1 - 0.5 + 0.5 * math.sin(a), 0))
            for j in range(5):
                a = math.pi + math.pi * j / 4
                out.append(V(cx + 0.75 * math.cos(a), y0 + 0.5 + 0.5 * math.sin(a), 0))
            acc = 0.0
            for k in range(len(out)):
                a, b = out[k], out[(k + 1) % len(out)]
                ln = (b - a).length
                pts = [a + V(0, 0, -0.8), b + V(0, 0, -0.8), b + V(0, 0, 0.6), a + V(0, 0, 0.6)]
                c = (a + b) / 2 - V(cx, (y0 + y1) / 2, 0)
                m.poly(pts, slime, out=(c.x, c.y, 0), uvs=[(acc / 2, 0), ((acc + ln) / 2, 0), ((acc + ln) / 2, 1), (acc / 2, 1)])
                acc += ln
            m.poly([p + V(0, 0, 0.6) for p in out], bb.TAR, out=(0, 0, 1))
            m.box((cx, (y0 + y1) / 2, 0.63), (1.2, y1 - y0 - 1.2, 0.05), bb.DARK)
            for y in (y0 + 1.2, (y0 + y1) / 2, y1 - 1.2):
                m.beam((cx, y, 0.6), (cx, y, 1.5), 0.2, 0.2, bb.DARK, side=(1, 0, 0))
        for y in (y0 + 1.2, y1 - 1.2):
            m.beam((-1.35, y, 0.7), (1.35, y, 1.42), 0.12, 0.12, bb.DARK, side=(0, 1, 0))
            m.beam((1.35, y, 0.7), (-1.35, y, 1.42), 0.12, 0.12, bb.DARK, side=(0, 1, 0))
    # --- frame: stringers along, joists across
    for x in (-2.15, -1.35, 1.35, 2.15):
        m.beam((x, GAP, 1.52), (x, SL, 1.52), 0.2, 0.2, bb.DARK, shade=0.75)
    for y in np.arange(GAP + 0.75, SL, 1.5):
        m.beam((-SW - 0.05, float(y), 1.665), (SW + 0.05, float(y), 1.665), 0.14, 0.13, bb.DARK, side=(0, 1, 0), shade=0.7)
    # --- deck: loose boards across with gaps, each its own shade; worn and patched ones
    y = GAP + 0.02
    k = 0
    while y < SL - 0.05:
        w = 0.22
        y1 = min(y + w, SL - 0.01)
        worn = rnd.random()
        shade = 0.72 if worn < 0.1 else (1.12 if worn > 0.93 else rnd.uniform(0.86, 1.04))
        a = -SW - 0.04 + rnd.uniform(0, 0.05)
        b = SW + 0.04 - rnd.uniform(0, 0.05)
        m.box(((a + b) / 2, (y + y1) / 2, DT - 0.035), (b - a, y1 - y, 0.07), IDX["stage_deck"], shade=shade, tile=0.9, skip=("-z",))
        y = y1 + 0.022
        k += 1
    # --- rails both sides: posts with iron knees, a top and a middle rail, a kick board
    posts = list(np.arange(GAP + 0.1, SL - 0.2, 1.5)) + [SL - 0.12]
    for sx in (1, -1):
        x = sx * 2.17
        for yy in posts:
            yy = float(yy)
            m.box((x, yy, DT + 0.55), (0.1, 0.1, 1.1), bb.DARK)
            m.beam(V(x, yy, DT + 0.45), V(sx * 2.42, yy, DT - 0.15), 0.04, 0.04, bb.IRON)
        for z, w, h in ((1.08, 0.09, 0.08), (0.55, 0.06, 0.06)):
            m.beam((x, GAP + 0.05, DT + z), (x, SL - 0.08, DT + z), w, h, bb.DARK)
        m.box((x, (SL + GAP) / 2, DT + 0.08), (0.04, SL - GAP, 0.16), bb.WOOD, shade=0.85)
        # fender posts on the outside, where the barges lie
        for yy in np.arange(GAP + 1.2, SL, 5.0):
            m.box((sx * 2.36, float(yy), 0.9), (0.14, 0.2, 1.8), bb.DARK, shade=0.8)
        for yy in (GAP + 2.0, 12.5, 22.5, 32.5, 42.5, 52.5):
            cleat(m, (sx * 1.98, yy, DT))
    # --- the head: a head beam, fender timbers and rope fenders, the head rail with the gangway gap
    m.beam(V(-SW - 0.1, SL + 0.1, DT - 0.2), V(SW + 0.1, SL + 0.1, DT - 0.2), 0.25, 0.3, bb.DARK, side=(0, 1, 0))
    for x in np.arange(-2.1, 2.2, 0.7):
        if abs(x) < 0.75:
            continue  # the ferry's gangway lands there
        m.box((float(x), SL + 0.28, 0.9), (0.16, 0.14, 1.76), bb.DARK, shade=0.85)
    for x in (-1.75, -0.9, 0.9, 1.75):
        fender(m, V(x, SL + 0.38, DT + 0.05), 0.5, 0.13)
    for a, b in ((-2.17, -0.78), (0.78, 2.17)):
        for yy_z, w, h in ((1.08, 0.09, 0.08), (0.55, 0.06, 0.06)):
            m.beam((a, SL - 0.12, DT + yy_z), (b, SL - 0.12, DT + yy_z), w, h, bb.DARK)
        m.box(((a + b) / 2, SL - 0.12, DT + 0.08), (b - a, 0.04, 0.16), bb.WOOD, shade=0.85)
    for x in (-0.78, 0.78):
        m.box((x, SL - 0.12, DT + 0.6), (0.14, 0.14, 1.2), bb.DARK)
        m.box((x, SL - 0.12, DT + 1.22), (0.18, 0.18, 0.05), bb.DARK, shade=1.1)
    # the quay end: an end beam under the deck's edge, fender timbers against the wall side, and the plate the
    # quay's gangway rolls on (its foot lands 0.2 to 1 m onto the stage, as the tide stands)
    m.beam(V(-SW - 0.1, GAP - 0.1, DT - 0.2), V(SW + 0.1, GAP - 0.1, DT - 0.2), 0.25, 0.3, bb.DARK, side=(0, 1, 0))
    m.box((0, GAP + 0.75, DT + 0.004), (3.5, 1.3, 0.012), bb.IRON, shade=0.8)
    # the bollards at the head corners (the ferry's gangway lies on the boards between them)
    bolls = []
    for sx in (1, -1):
        c = V(sx * 1.55, SL - 0.55, DT)
        track(m, f"bollard {sx}", "stage", lambda: bollard(m, c))
        bolls.append([round(c.x, 3), round(c.y, 3), round(c.z + 0.4, 3)])
        track(m, f"head coil {sx}", "stage", lambda: bb.coil(m, (sx * 1.55, SL - 1.25, DT), 0.22))
    # the ladder down the head into the river, on the -x side of the gap
    ladder(m, V(-1.45, SL + 0.4, DT), -1.2, along=(1, 0, 0), half=0.2)
    # --- collars round the guide piles (the piles stand in the river bed: world/landingStage.ts)
    collars = []
    for sx in (1, -1):
        for yy in (GAP + 1.5, SL - 8.0):  # (not at the head: the ferry's gangway and its view are there)
            px = sx * (SW + 0.45)
            collars.append([round(px, 3), yy])
            m.beam(V(sx * (SW + 0.05), yy - 0.35, DT - 0.25), V(px, yy - 0.3, DT - 0.25), 0.08, 0.1, bb.IRON)
            m.beam(V(sx * (SW + 0.05), yy + 0.35, DT - 0.25), V(px, yy + 0.3, DT - 0.25), 0.08, 0.1, bb.IRON)
            with m.at(move(px, yy, DT - 0.34)):
                m.lathe([(0.3, 0.0), (0.3, 0.2), (0.26, 0.2), (0.26, 0.0)], 10, bb.IRON, smooth=False)
    # --- the waiting shelter with the ticket hatch, on the -x side at y 40..44.5
    X0, X1, Y0, Y1, YB = -2.1, -1.0, 40.0, 44.5, 41.5  # its back wall stands inside the rail
    zr0, zr1 = DT + 2.45, DT + 2.2
    # back wall along the rail, end walls, the booth's front with its hatch
    m.box((X0 + 0.04, (Y0 + Y1) / 2, DT + 1.1), (0.08, Y1 - Y0, 2.2), bb.WOOD, tile=1.6, shade=0.85)
    for yy in (Y0, Y1):
        m.box(((X0 + X1) / 2, yy, DT + 1.12), (X1 - X0, 0.08, 2.24), bb.WOOD, tile=1.6)
    m.box((X1 - 0.04, (Y0 + YB) / 2, DT + 1.12), (0.08, YB - Y0, 2.24), bb.WOOD, tile=1.6, shade=0.95)
    m.box((X1 - 0.09, (Y0 + YB) / 2, DT + 1.35), (0.02, 0.75, 0.55), bb.WINDOW)
    m.box((X1 + 0.08, (Y0 + YB) / 2, DT + 1.03), (0.2, 0.9, 0.04), bb.DARK)  # the counter
    m.box(((X0 + X1) / 2, YB, DT + 1.12), (X1 - X0, 0.06, 2.24), bb.WOOD, tile=1.6, shade=0.8)
    for yy in (YB + 1.4, Y1 - 0.06):
        m.box((X1 - 0.05, yy, DT + 1.12), (0.1, 0.1, 2.24), bb.DARK)
    # the roof: boards sloping to the rail, a fascia along the front
    rpts = [V(X0 - 0.15, Y0 - 0.2, zr1), V(X1 + 0.28, Y0 - 0.2, zr0), V(X1 + 0.28, Y1 + 0.2, zr0), V(X0 - 0.15, Y1 + 0.2, zr1)]
    m.slab(rpts, 0.06, bb.DARK, out=(0.2, 0, 1))
    m.beam(V(X1 + 0.28, Y0 - 0.2, zr0 - 0.08), V(X1 + 0.28, Y1 + 0.2, zr0 - 0.08), 0.04, 0.2, bb.WOOD, side=(1, 0, 0))
    # the bench inside, a notice board on each end wall, a lamp at the front corner
    for dx in (0.0, 0.12, 0.24):
        m.beam(V(X0 + 0.2 + dx, YB + 0.15, DT + 0.45), V(X0 + 0.2 + dx, Y1 - 0.15, DT + 0.45), 0.1, 0.035, bb.WOOD, side=(1, 0, 0))
    for yy in (YB + 0.4, Y1 - 0.4):
        m.box((X0 + 0.32, yy, DT + 0.22), (0.36, 0.04, 0.43), bb.IRON)
    for yy, n in ((Y0 - 0.05, -1), (Y1 + 0.05, 1)):
        m.box(((X0 + X1) / 2, yy, DT + 1.5), (0.95, 0.04, 0.8), bb.DARK)
        bb.panel(m, ((X0 + X1) / 2, yy + n * 0.02, DT + 1.5), (-n, 0, 0), (0, 0, 1), 0.86, 0.72, mat=IDX["notice"])
    lamps = []
    sp = V(X1 + 0.12, Y1 + 0.12, DT + 2.0)
    m.beam(V(X1 - 0.05, Y1 - 0.06, DT + 2.1), sp + V(0, 0, 0.32), 0.04, 0.04, bb.IRON)
    lantern(m, sp, h=0.34, w=0.22)
    lamps.append([round(sp.x, 3), round(sp.y, 3), round(sp.z, 3)])
    # --- lamp posts: at the head by the gangway, halfway, near the quay end
    for (x, yy) in ((1.95, SL - 1.1), (2.0, 30.0), (-2.0, GAP + 2.6)):
        sx = 1 if x > 0 else -1
        m.box((x, yy, DT + 1.45), (0.14, 0.14, 2.9), bb.DARK)
        m.box((x, yy, DT + 0.15), (0.2, 0.2, 0.3), bb.DARK, shade=0.9)
        lp = V(x - sx * 0.45, yy, DT + 2.95)
        m.beam(V(x, yy, DT + 2.7), lp + V(sx * 0.1, 0, 0.3), 0.045, 0.045, bb.IRON)
        m.beam(V(x, yy, DT + 2.3), V(x - sx * 0.25, yy, DT + 2.72), 0.03, 0.03, bb.IRON)
        lantern(m, lp, h=0.4, w=0.26)
        lamps.append([round(lp.x, 3), round(lp.y, 3), round(lp.z, 3)])
    # --- goods waiting for the ferry, against the +x rail; a barrow's worth by the shelter; ropes
    solids = []
    track(m, "crate a", "stage", lambda: bb.crate_lo(m, (1.62, 52.6, DT), (0.8, 0.62, 0.6), 0.05))
    track(m, "crate b", "stage", lambda: bb.crate_lo(m, (1.62, 53.45, DT), (0.75, 0.6, 0.55), -0.04))
    track(m, "crate on top", "stage", lambda: bb.crate_lo(m, (1.64, 53.0, DT + 0.6), (0.65, 0.5, 0.45), 0.2), on=["crate a", "crate b"])
    track(m, "trunk", "stage", lambda: trunk(m, (1.6, 54.4, DT), yaw=math.pi / 2))
    track(m, "basket", "stage", lambda: basket(m, (1.72, 55.2, DT)))
    track(m, "sack", "stage", lambda: bb.sack_lo(m, (1.6, 51.7, DT), yaw=1.4))
    solids.append([1.15, 2.12, 51.2, 55.5])
    track(m, "barrel", "stage", lambda: bb.barrel_lo(m, (1.7, 20.3, DT)))
    track(m, "barrel lying", "stage", lambda: bb.barrel_lo(m, (1.58, 21.05, DT), lying=True, yaw=0.1))
    track(m, "coil", "stage", lambda: bb.coil(m, (1.7, 22.0, DT), 0.26))
    solids.append([1.3, 2.12, 19.9, 22.35])
    track(m, "trunk by the shelter", "stage", lambda: trunk(m, (-1.72, 46.0, DT), yaw=math.pi / 2 + 0.1, size=(0.75, 0.44, 0.42)))
    track(m, "basket by the shelter", "stage", lambda: basket(m, (-1.75, 46.9, DT)))
    solids.append([-2.12, -1.45, 45.55, 47.2])
    solids.append([X0 - 0.05, X1 + 0.1, Y0 - 0.08, Y1 + 0.08])
    for yy, sx in ((12.0, 1), (35.0, -1)):
        track(m, f"coil at {yy}", "stage", lambda: bb.coil(m, (sx * 1.85, yy, DT), 0.2))
    # --- puddles on the boards
    for (x, yy, rx, ry, s) in ((0.4, 11.8, 0.7, 0.45, 1), (-0.8, 26.5, 0.5, 0.8, 2), (0.9, 38.2, 0.6, 0.35, 3),
                               (-0.3, 48.7, 1.0, 0.5, 4), (0.5, 57.2, 0.45, 0.3, 5), (-1.2, 18.0, 0.35, 0.5, 6)):
        puddle(m, (x, yy), rx, ry, s, DT + 0.008)
    m.extras = {"deck_top": DT, "length": SL, "half_width": SW, "lamps": lamps, "bollards": bolls, "collars": collars,
                "solids": [[round(v, 3) for v in r] for r in solids],
                "head_rail": [[-2.22, -0.71], [0.71, 2.22]]}
    return m


# ------------------------------------------------------------------ the parts check


def check_parts():
    """Nothing loose sticks into anything: each thing stands on the deck (or on what it is said to stand on),
    inside the bulwark or the stage's rails, and clear of the others (1 cm of grace)."""
    out = []
    for name, where, lo, hi, on in PARTS:
        cy = (lo.y + hi.y) / 2
        if where == "ferry":
            floor = deckz(tat(cy))
            for y in (lo.y, hi.y):
                lim = hbf(tat(y), deckz(tat(y))) - 0.1 + 0.005
                if max(abs(lo.x), abs(hi.x)) > lim:
                    out.append(f"ferry {name}: {max(abs(lo.x), abs(hi.x)):.2f} m out, the bulwark at {lim:.2f}")
        else:
            floor = DT
            if max(abs(lo.x), abs(hi.x)) > 2.12:
                out.append(f"stage {name}: {max(abs(lo.x), abs(hi.x)):.2f} m out, the rail inside at 2.12")
            if lo.y < GAP + 0.1 or hi.y > SL - 0.15:
                out.append(f"stage {name}: off the deck's ends")
        if on:
            tops = [h2.z for n2, w2, l2, h2, o2 in PARTS if w2 == where and n2 in on]
            floor = max(tops) if tops else floor
        if lo.z < floor - 0.03 or lo.z > floor + 0.03:
            out.append(f"{where} {name}: its foot {lo.z - floor:+.3f} m off what it stands on")
    for i, (a, wa, la, ha, oa) in enumerate(PARTS):
        for b, wb, lb, hb2, ob in PARTS[i + 1:]:
            if wa != wb or b in oa or a in ob:
                continue
            d = [min(ha[k], hb2[k]) - max(la[k], lb[k]) for k in range(3)]
            if min(d) > 0.01:
                out.append(f"{wa}: {a} and {b} overlap by {min(d) * 100:.0f} cm")
    return out


# ------------------------------------------------------------------ main


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    # (2026-09-28: the sacks' places recorded, and the ferry and the stage built again without them: the game draws the
    # one sack model there, client game/sackModel.ts; client/src/game/ferry_sack_sockets.json)
    bb.CUR[0] = "ferry"
    fm, hull = ferry()
    fo = bb.to_object(fm, "ferry")
    bb.cap_object(hull, "ferry_cap", fo)
    bb.CUR[0] = "landing_stage"
    so = bb.to_object(stage(), "landing_stage")
    bb.CUR[0] = None
    n_parts = len(PARTS)
    bb.NO_SACKS[0] = True
    try:
        fb, _ = ferry()
        bb.to_object(fb, "ferry_bare")
        bb.to_object(stage(), "landing_stage_bare")
    finally:
        bb.NO_SACKS[0] = False
    del PARTS[n_parts:]
    with open(os.path.join(bb.ROOT, "client", "src", "game", "ferry_sack_sockets.json"), "w", encoding="utf-8") as f:
        json.dump(bb.SACK_SOCKETS, f, separators=(",", ":"))
    bb.OUT = OUT
    bb.export()
    for ob in (fo, so):
        print(f"[build_ferry] {ob.name:14s} {bb.tris(ob):6d} tris")
    print(f"[build_ferry] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    probs = check_parts()
    print(f"[build_ferry] parts check: {len(PARTS)} things, {len(probs)} problems")
    for p in probs:
        print(f"[build_ferry]   {p}")
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = argv[i + 1].split(",")
        az = float(argv[i + 3]) if len(argv) > i + 3 else -35.0
        el = float(argv[i + 4]) if len(argv) > i + 4 else 0.35
        bb.preview_materials()
        bb.preview_lines({"ferry": fo, "landing_stage": so})
        bb.closeup({"ferry": fo, "landing_stage": so}, names, os.path.abspath(os.path.join(bb.ROOT, argv[i + 2])), az, el)


if __name__ == "__main__":
    main()
