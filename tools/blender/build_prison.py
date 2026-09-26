"""The prison of 1855 (the Begijnenstraat prison of Antwerp, reference only), modelled and painted by this script.
M7 prison and squares (2026-09-26, docs/milestones/M7-prison-squares.md).

    blender -b --factory-startup -P tools/blender/build_prison.py [-- --nocheck]

Reads shared/townplaces.json (tools/city/places.py: the frame, the compound, the parts). Writes
client/public/models/prison.glb (Draco, 20-bit positions).

What the real one had (reference only, nothing copied): built 1854-59 to the plans of J. J. Dumont for the cellular
system of Ducpetiaux; a neo-Romanesque front building in brick and stone with the gate in the middle, corner stones
and battlements, pairs of round-arched barred windows; behind it cell wings round a central watch pavilion, three and
four storeys, a corridor with iron galleries under a vault in each wing; the whole walled in. Here, on a smaller plot:
the front building with its gate tower on the wall street, the governor's house at its east end, a link to the
octagonal watch pavilion with its lantern, two cell wings off it east and west (three storeys of cells, each with its
small barred window high up), the chapel with its apse and bell-cote in the court west of the link, the exercise yard
with its ring of flags east of it, and the high wall round everything.

The frame is the prison's (shared/prisonPlan.ts): local x along the front (world -z), local z into the compound, the
gate's middle at (0, 0); the game puts the model at the frame's origin, turned by its yaw. A game point (x, y, z) sits
at Blender (x, -z, y); the glTF export turns it back.

Materials (a small painted texture each, nearest filter; vertex colour "Col" the shade: soot under the copings and
cornices, damp at the foot): pr_brick and pr_blue take the town's own pictures in the game (world/prison.ts: the old
brick and the bluestone ashlar of the house walls), pr_slate, pr_lead, pr_atlas (the barred windows, the governor's
door and sashes, the chapel's glass and rose, the plaque, the oculi, louvres), pr_iron, pr_wood, pr_glow (lantern
glass, drawn bright at night by the game).

The gate and the yard door are real openings (reveals, no pane): the hall is drawn behind them in the game
(world/prisonHall.ts). No two faces in one plane; nothing flat at y 0 (the check runs on the exported file).
"""

import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PLACES = os.path.join(ROOT, "shared", "townplaces.json")
OUT = os.path.join(ROOT, "client", "public", "models", "prison.glb")

MATS = ["pr_brick", "pr_blue", "pr_slate", "pr_lead", "pr_atlas", "pr_iron", "pr_wood", "pr_glow", "pr_flags"]
BRICK, BLUE, SLATE, LEAD, ATLAS, IRON, WOOD, GLOW, FLAGS = range(9)
TILE = {BRICK: (1.9, 1.9), BLUE: (3.2, 3.2), SLATE: (1.6, 1.6), LEAD: (0.9, 0.9), ATLAS: (1.0, 1.0), IRON: (1.0, 1.0),
        WOOD: (1.2, 1.2), GLOW: (1.0, 1.0), FLAGS: (2.5, 2.5)}
SEG = 4.0  # longest face edge on walls (textures swim on big faces)
FOOT = -0.3  # walls start under the ground

with open(PLACES) as _f:
    TP = json.load(_f)
PR = TP["prison"]
PARTS = PR["parts"]
COMP = PR["compound"]
WALL_T = PR["wall"]["t"]
WALL_H = PR["wall"]["h"]


def B(p):
    return Vector((p[0], -p[2], p[1]))


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def refine(vals, step):
    out = []
    for a, b in zip(vals, vals[1:]):
        n = max(1, math.ceil((b - a) / step - 1e-9))
        out += [a + (b - a) * i / n for i in range(n)]
    out.append(vals[-1])
    return out


def sm(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ the shade: soot and damp


SOOT_LINES = []  # (y, reach): soot washed down under each coping and cornice
# the main soot lines known before the walls are built (the tops of the wall, the front, the wings, the pavilion)
PRE_SOOT = [(WALL_H, 1.8), (PARTS["front"]["h"] - 0.1, 2.0), (PARTS["wingA"]["h"] - 0.4, 1.8), (PARTS["pavilion"]["h"] - 0.5, 2.0),
            (PARTS["governor"]["h"] - 0.35, 1.8), (PARTS["tower"]["h"] - 0.05, 2.2), (4.3, 1.4), (PARTS["chapel"]["h"] - 0.3, 1.5)]


SOOT_TOP = [None]  # the top of the wall being built: soot washed down under its coping or cornice


def grime(p):
    """Old, sooty, damp: the foot darker and green-black, a wall darker for two metres under its own top."""
    y = p.y
    k = 0.78 + 0.22 * sm(-0.1, 1.1, y)  # damp at the foot
    top = SOOT_TOP[0]
    if top is not None and top - 2.0 < y <= top + 1e-6:
        k *= 1.0 - 0.26 * (1.0 - (top - y) / 2.0) ** 1.6
    # a slow unevenness, never blotches: the wall seen as one weathered surface
    k *= 0.95 + 0.05 * math.sin(p.x * 0.37 + p.z * 0.21) * math.sin(p.x * 0.13 - p.z * 0.29 + 1.7)
    return k


# ------------------------------------------------------------------ textures (painted; the game swaps brick and blue for pictures)


def C(*rgb):
    return np.array(rgb, dtype=np.float64)


def noise(rng, h, w, amt):
    return 1.0 + (rng.random((h, w, 1)) - 0.5) * 2 * amt


def paint_brick(rng, w=128, h=96, px=4, blen=16):
    img = np.ones((h, w, 3)) * C(0.42, 0.22, 0.16)
    mortar = C(0.45, 0.42, 0.38)
    for row in range(0, h, px * 2):
        off = (row // (px * 2)) % 2 * (blen // 2)
        for col in range(-blen, w, blen):
            c0 = max(0, col + off)
            c1 = min(w, col + off + blen - 1)
            if c1 <= c0:
                continue
            tone = C(0.42, 0.22, 0.16) * rng.uniform(0.7, 1.15) + C(0.02, 0.0, 0.0) * rng.uniform(-1, 1)
            img[row:row + px * 2 - 1, c0:c1] = tone
        img[row + px * 2 - 1:row + px * 2, :] = mortar
    for col in range(0, w, 1):
        pass
    return img * noise(rng, h, w, 0.08)


def paint_ashlar(rng, n, base, joint, course, lo, hi):
    img = np.ones((n, n, 3)) * base
    y = 0
    while y < n:
        x = int(rng.integers(0, lo))
        img[y, :] = joint
        while x < n:
            L = int(rng.integers(lo, hi))
            img[y + 1:y + course, x % n] = joint
            img[y + 1:y + course, x % n:min(n, x + L)] *= rng.uniform(0.9, 1.08)
            x += L
        y += course
    return img * noise(rng, n, n, 0.06)


def paint_slate(rng, n=64):
    img = np.ones((n, n, 3)) * C(0.24, 0.26, 0.28)
    for row in range(0, n, 5):
        img[row, :] = C(0.1, 0.1, 0.11)
        off = (row // 5) % 2 * 5
        for col in range(off, n, 10):
            img[row:row + 5, col] = C(0.12, 0.12, 0.13)
            img[row + 1:row + 5, col + 1:col + 9] *= rng.uniform(0.85, 1.1)
    return img * noise(rng, n, n, 0.07)


def paint_flat(rng, rgb, n=32, amt=0.08):
    return np.ones((n, n, 3)) * C(*rgb) * noise(rng, n, n, amt)


def paint_wood(rng, n=64):
    img = np.ones((n, n, 3)) * C(0.26, 0.18, 0.11)
    for col in range(n):
        img[:, col] *= 0.85 + 0.25 * math.sin(col * 0.9 + rng.random())
    for col in range(0, n, 16):
        img[:, col] = C(0.1, 0.07, 0.05)
    return img * noise(rng, n, n, 0.08)


def paint_flags(rng, n=128):
    return paint_ashlar(rng, n, C(0.43, 0.43, 0.41), C(0.2, 0.2, 0.19), 32, 28, 56)


# the atlas: 512 x 512, cells (x0, y0, w, h) in pixels, y from the bottom
AT = 512
CELL = {
    "bars": (0, 0, 64, 128),  # a barred window, round head (cells, the front building, the pavilion)
    "sash": (64, 0, 64, 128),  # the governor's sash window with its curtain
    "door_gov": (128, 0, 64, 128),  # the governor's front door with a fanlight
    "chapel": (192, 0, 64, 128),  # the chapel's leaded glass, round head
    "louvre": (256, 0, 64, 128),  # the bell-cote's and the lantern's louvres
    "door_side": (320, 0, 64, 128),  # a plain iron-bound door (the yard's side doors, painted shut)
    "bars_sq": (384, 0, 64, 64),  # a small square barred window (the link, the corner towers)
    "oculus": (384, 64, 64, 64),  # a round barred window (the wings' gable ends)
    "rose": (448, 0, 64, 64),  # the chapel's rose
    "clock": (448, 64, 64, 64),  # the gate tower's clock
    "plaque": (0, 128, 256, 64),  # the plaque over the gate
    "dark": (256, 128, 16, 16),
    "lamp": (272, 128, 16, 16),
}

FONT5 = {
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    " ": ["00000"] * 7,
    ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
}


def paint_atlas(rng):
    img = np.zeros((AT, AT, 3))

    def region(name):
        x0, y0, w, h = CELL[name]
        return img[AT - y0 - h:AT - y0, x0:x0 + w]

    def arch_mask(w, h, hb):
        """True inside a round-headed opening w wide, h high, its head's radius w/2 from h - w/2."""
        yy, xx = np.mgrid[0:h, 0:w]
        yb = h - 1 - yy  # from the bottom
        r = w / 2
        ys = h - r
        inside = (yb < ys) | (((xx + 0.5 - r) ** 2 + (yb - ys) ** 2) <= r * r)
        return inside

    # the barred window: dark glass (a hint of the cell's gloom), three iron bars and two cross bars, a sill shadow
    r = region("bars")
    r[:] = C(0.07, 0.075, 0.08)
    r[:] *= noise(rng, 128, 64, 0.2)
    for x in (14, 31, 48):
        r[:, x:x + 4] = C(0.05, 0.045, 0.04)
        r[:, x + 1:x + 2] = C(0.16, 0.14, 0.12)
    for y in (40, 88):
        r[y:y + 4, :] = C(0.05, 0.045, 0.04)
    # a faint lighter pane where the sky reflects in the top
    r[4:30, :] += 0.04
    # the sash: panes, glazing bars, a lace curtain half drawn
    r = region("sash")
    r[:] = C(0.1, 0.11, 0.12)
    r[6:62, 8:56] = C(0.62, 0.6, 0.55) * noise(rng, 56, 48, 0.1)
    for x in (4, 31, 58):
        r[:, x:x + 3] = C(0.8, 0.78, 0.72)
    for y in (0, 42, 84, 125):
        r[y:y + 3, :] = C(0.8, 0.78, 0.72)
    # the governor's door: dark green panels, a brass knob, the fanlight
    r = region("door_gov")
    r[:] = C(0.07, 0.13, 0.09)
    for (y0, y1) in ((40, 88), (92, 124)):
        for (x0, x1) in ((8, 29), (35, 56)):
            r[y0:y1, x0:x1] = C(0.05, 0.1, 0.07)
            r[y0:y0 + 2, x0:x1] = C(0.1, 0.18, 0.13)
    r[0:34, :] = C(0.16, 0.16, 0.17)
    for x in range(4, 64, 10):
        r[4:34, x:x + 2] = C(0.3, 0.28, 0.22)
    r[34:37, :] = C(0.3, 0.27, 0.2)
    r[82:86, 48:52] = C(0.7, 0.55, 0.2)
    # the chapel's glass: leaded diamonds, amber and pale green, a dark frame
    r = region("chapel")
    yy, xx = np.mgrid[0:128, 0:64]
    lead_ = ((xx + yy) % 12 < 1) | ((xx - yy) % 12 < 1)
    r[:] = C(0.32, 0.3, 0.2) * noise(rng, 128, 64, 0.25)
    r[(xx // 12 + yy // 12) % 3 == 0] *= C(0.8, 1.1, 0.9)
    r[lead_] = C(0.06, 0.06, 0.06)
    r[:, 0:3] = r[:, 61:64] = C(0.08, 0.07, 0.06)
    # louvres
    r = region("louvre")
    r[:] = C(0.06, 0.06, 0.06)
    for y in range(4, 128, 9):
        r[y:y + 5, 4:60] = C(0.24, 0.2, 0.15) * rng.uniform(0.8, 1.1)
        r[y + 5:y + 6, 4:60] = C(0.12, 0.1, 0.08)
    # a plain door, iron-bound
    r = region("door_side")
    r[:] = C(0.18, 0.13, 0.09) * noise(rng, 128, 64, 0.12)
    for x in range(0, 64, 11):
        r[:, x:x + 1] = C(0.1, 0.07, 0.05)
    for y in (18, 60, 104):
        r[y:y + 5, :] = C(0.08, 0.075, 0.07)
        for x in range(4, 64, 12):
            r[y + 1:y + 4, x:x + 3] = C(0.2, 0.18, 0.16)
    # a small square barred window
    r = region("bars_sq")
    r[:] = C(0.07, 0.075, 0.08) * noise(rng, 64, 64, 0.2)
    for x in (14, 30, 46):
        r[:, x:x + 4] = C(0.05, 0.045, 0.04)
    r[30:34, :] = C(0.05, 0.045, 0.04)
    # the oculus: a round barred window in a stone ring (outside the ring: stone, the cell is laid over a disc)
    r = region("oculus")
    yy, xx = np.mgrid[0:64, 0:64]
    d = np.hypot(xx - 31.5, yy - 31.5)
    r[:] = C(0.07, 0.075, 0.08)
    r[(np.abs(xx - 31.5) < 2) | (np.abs(yy - 31.5) < 2)] = C(0.05, 0.045, 0.04)
    r[d > 28] = C(0.4, 0.41, 0.42)
    # the rose: wheel tracery with coloured glass
    r = region("rose")
    ang = np.arctan2(yy - 31.5, xx - 31.5)
    r[:] = C(0.35, 0.22, 0.14) * noise(rng, 64, 64, 0.25)
    r[(np.cos(ang * 8) > 0.2) & (d > 10)] = C(0.16, 0.22, 0.34)
    r[np.abs(np.sin(ang * 8)) < 0.12] = C(0.08, 0.08, 0.08)
    r[(d > 9) & (d < 11.5)] = C(0.08, 0.08, 0.08)
    r[d < 5] = C(0.5, 0.35, 0.15)
    r[d > 29] = C(0.46, 0.44, 0.4)
    # the clock: a white face, black numerals as ticks (the hands are the game's own, live)
    r = region("clock")
    r[:] = C(0.4, 0.39, 0.37)
    r[d < 28] = C(0.82, 0.8, 0.74)
    for k in range(12):
        a = k * math.pi / 6
        for t in np.linspace(22, 26, 5):
            px_, py_ = int(31.5 + math.cos(a) * t), int(31.5 + math.sin(a) * t)
            r[63 - py_ - 1:63 - py_ + 1, px_ - 1:px_ + 1] = C(0.05, 0.05, 0.05)
    # no hands: the game's live hands show its time (clock_mark, client/src/world/clockHands.ts)
    # the plaque: pale stone, cut letters with a shadow: GEVANGENIS over MAISON D ARRET is not needed; one line and a date
    r = region("plaque")
    r[:] = C(0.52, 0.52, 0.5) * noise(rng, 64, 256, 0.05)
    r[0:3, :] = r[61:64, :] = C(0.3, 0.3, 0.3)
    r[:, 0:3] = r[:, 253:256] = C(0.3, 0.3, 0.3)

    def text(s, x0, y0, sc):
        for i, ch in enumerate(s):
            gl = FONT5.get(ch, FONT5[" "])
            for gy, row in enumerate(gl):
                for gx, bit in enumerate(row):
                    if bit == "1":
                        X = x0 + (i * 6 + gx) * sc
                        Y = y0 + gy * sc
                        r[Y + 1:Y + sc + 1, X + 1:X + sc + 1] = C(0.62, 0.62, 0.6)  # the lit lower edge
                        r[Y:Y + sc, X:X + sc] = C(0.12, 0.12, 0.12)

    text("GEVANGENIS", 128 - 10 * 6 * 4 // 2 + 2, 6, 4)
    text("1855", 128 - 4 * 6 * 3 // 2 + 1, 40, 3)
    region("dark")[:] = C(0.04, 0.04, 0.045)
    region("lamp")[:] = C(1.0, 0.8, 0.5)
    return img


def cell_uv(name, fu, fv):
    x0, y0, w, h = CELL[name]
    e = 0.5 / AT
    return ((x0 + fu * w) / AT * (1 - 2 * e) + e, (y0 + fv * h) / AT * (1 - 2 * e) + e)


def make_materials():
    rng = np.random.default_rng(1855)
    paint = {
        "pr_brick": lambda: paint_brick(rng),
        "pr_blue": lambda: paint_ashlar(rng, 128, C(0.36, 0.38, 0.4), C(0.24, 0.25, 0.27), 20, 30, 60),
        "pr_slate": lambda: paint_slate(rng),
        "pr_lead": lambda: paint_flat(rng, (0.3, 0.31, 0.32)),
        "pr_atlas": lambda: paint_atlas(rng),
        "pr_iron": lambda: paint_flat(rng, (0.08, 0.075, 0.07), 16, 0.15),
        "pr_wood": lambda: paint_wood(rng),
        "pr_glow": lambda: paint_flat(rng, (1.0, 0.82, 0.52), 16, 0.05),
        "pr_flags": lambda: paint_flags(rng),
    }
    for name in MATS:
        arr = np.clip(paint[name](), 0, 1)[::-1]  # rows from the bottom (Blender's pixels)
        h, w, _ = arr.shape
        img = bpy.data.images.new(name + "_tex", w, h, alpha=False)
        rgba = np.ones((h, w, 4), dtype=np.float32)
        rgba[..., :3] = arr
        img.pixels.foreach_set(rgba.ravel())
        img.pack()
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 1.0
        if name.endswith("_glow"):
            nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.0
        m.use_backface_culling = name not in ("pr_iron",)


# ------------------------------------------------------------------ geometry store


def planar(pts, n, mat):
    tu, tv = TILE[mat]
    h = math.hypot(n.x, n.z)
    if h < 0.05:
        return [(p.x / tu, p.z / tv) for p in pts]
    hd = Vector((n.z, 0.0, -n.x)) / h
    w = n.cross(hd)
    return [(p.dot(hd) / tu, p.dot(w) / tv) for p in pts]


class Geo:
    """Faces in the prison's frame (game axes), grouped into objects."""

    def __init__(self):
        self.groups = {}
        self.grp = "prison"

    def face(self, pts, mat, out=None, uvs=None, k=1.0, cell=None, shade=None):
        pts = [Vector(p) for p in pts]
        n = newell(pts)
        if n.length < 1e-8:
            return
        if out is not None and n.dot(Vector(out)) < 0:
            pts.reverse()
            n = -n
            if uvs:
                uvs = list(reversed(uvs))
        n.normalize()
        if uvs is None:
            uvs = [cell_uv(cell or "dark", 0.5, 0.5)] * len(pts) if mat == ATLAS else planar(pts, n, mat)
        if shade is not None:
            cols = [shade * k] * len(pts)
        elif mat in (GLOW,):
            cols = [1.0] * len(pts)
        else:
            cols = [grime(p) * k for p in pts]
        self.groups.setdefault(self.grp, []).append((pts, uvs, cols, mat))

    def quad(self, a, b, c, d, mat, out=None, **kw):
        self.face([a, b, c, d], mat, out=out, **kw)

    def to_objects(self):
        objs = {}
        for name, faces in self.groups.items():
            used = sorted({f[3] for f in faces})
            idx = {m: i for i, m in enumerate(used)}
            bm = bmesh.new()
            uvl = bm.loops.layers.uv.new("UVMap")
            col = bm.loops.layers.float_color.new("Col")
            for pts, uvs, cols, mat in faces:
                vs = [bm.verts.new(B(p)) for p in pts]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = idx[mat]
                f.smooth = False
                for loop, uv, c in zip(f.loops, uvs, cols):
                    loop[uvl].uv = uv
                    c = min(1.0, max(0.0, c))
                    loop[col] = (c, c, c, 1.0)
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            for m in used:
                me.materials.append(bpy.data.materials[MATS[m]])
            try:
                me.color_attributes.active_color = me.color_attributes["Col"]
                me.color_attributes.render_color_index = me.color_attributes.active_color_index
            except (KeyError, AttributeError):
                pass
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            objs[name] = ob
        return objs


# ------------------------------------------------------------------ boxes, prisms, roofs

FACES = {"-x": (-1, 0, 0), "+x": (1, 0, 0), "-y": (0, -1, 0), "+y": (0, 1, 0), "-z": (0, 0, -1), "+z": (0, 0, 1)}


def box(g, x0, x1, y0, y1, z0, z1, mat, skip=(), k=1.0, top=None):
    """An axis-aligned box; `skip` names faces not drawn ('-x', '+y' ...); `top` another material for +y."""
    P = lambda x, y, z: (x, y, z)  # noqa: E731
    F = {
        "-x": [P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)],
        "+x": [P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1)],
        "-z": [P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0)],
        "+z": [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)],
        "+y": [P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0)],
        "-y": [P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)],
    }
    for name, pts in F.items():
        if name in skip:
            continue
        # tall faces cut into SEG pieces (the textures swim on big faces)
        m = top if (name == "+y" and top is not None) else mat
        if name in ("-x", "+x", "-z", "+z") and (y1 - y0 > SEG or max(x1 - x0, z1 - z0) > SEG):
            along = "z" if name in ("-x", "+x") else "x"
            a0, a1 = (z0, z1) if along == "z" else (x0, x1)
            us = refine([a0, a1], SEG)
            ys = refine([y0, y1], SEG)
            for ua, ub in zip(us, us[1:]):
                for va, vb in zip(ys, ys[1:]):
                    if along == "z":
                        xx = x0 if name == "-x" else x1
                        q = [(xx, va, ua), (xx, va, ub), (xx, vb, ub), (xx, vb, ua)]
                    else:
                        zz = z0 if name == "-z" else z1
                        q = [(ua, va, zz), (ub, va, zz), (ub, vb, zz), (ua, vb, zz)]
                    g.face(q, m, out=FACES[name], k=k)
        else:
            g.face(pts, m, out=FACES[name], k=k)


def prism(g, pts, y0, y1, mat, k=1.0, top=True, bottom=False, top_mat=None, skip_sides=()):
    """An upright prism over a convex ring of (x, z) points (any winding)."""
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cz = sum(p[1] for p in pts) / n
    for i in range(n):
        if i in skip_sides:
            continue
        a, b = pts[i], pts[(i + 1) % n]
        mx, mz = (a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cz
        ys = refine([y0, y1], SEG)
        for va, vb in zip(ys, ys[1:]):
            g.face([(a[0], va, a[1]), (b[0], va, b[1]), (b[0], vb, b[1]), (a[0], vb, a[1])], mat, out=(mx, 0, mz), k=k)
    if top:
        g.face([(p[0], y1, p[1]) for p in pts], top_mat if top_mat is not None else mat, out=(0, 1, 0), k=k)
    if bottom:
        g.face([(p[0], y0, p[1]) for p in pts], mat, out=(0, -1, 0), k=k)


def ngon(c, r, n, rot=0.0):
    return [(c[0] + r * math.cos(rot + 2 * math.pi * i / n), c[1] + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def pyramid(g, ring, y0, apex_y, mat, k=1.0, apex=None):
    n = len(ring)
    cx = sum(p[0] for p in ring) / n
    cz = sum(p[1] for p in ring) / n
    if apex is None:
        apex = (cx, cz)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        mx, mz = (a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cz
        g.face([(a[0], y0, a[1]), (b[0], y0, b[1]), (apex[0], apex_y, apex[1])], mat, out=(mx, 0.6, mz), k=k)


def gable_roof(g, x0, x1, z0, z1, ye, along, pitch=35.0, oe=0.45, og=0.35, t=0.2, mat=SLATE, gable_mat=BRICK, caps=(True, True), k=1.0):
    """A pitched roof over the box x0..x1, z0..z1 (eaves at ye), its ridge along `along` ('x' or 'z').
    The gable ends are walls of gable_mat (caps: draw each end's triangle)."""
    if along == "x":
        w = z1 - z0
        rise = math.tan(math.radians(pitch)) * w / 2
        zm = (z0 + z1) / 2
        yr = ye + rise
        # slopes (with eave overhang oe and gable overhang og)
        dz = oe
        dy = dz * math.tan(math.radians(pitch))
        for (za, zb, s) in ((z0 - dz, zm, -1), (z1 + dz, zm, 1)):
            A = (x0 - og, ye - dy, za)
            Bq = (x1 + og, ye - dy, za)
            Cq = (x1 + og, yr, zb)
            D = (x0 - og, yr, zb)
            g.face([A, Bq, Cq, D], mat, out=(0, 1, s), k=k)
            # the slate's thickness at the eave and underside
            g.face([A, Bq, (Bq[0], Bq[1] - t, Bq[2]), (A[0], A[1] - t, A[2])], mat, out=(0, 0, s), k=0.7 * k)
            g.face([(A[0], A[1] - t, A[2]), (Bq[0], Bq[1] - t, Bq[2]), (Cq[0], Cq[1] - t, Cq[2]), (D[0], D[1] - t, D[2])], mat, out=(0, -1, -s * 0.3), k=0.45 * k)
        # verge boards at the gable overhang
        for xg, s in ((x0 - og, -1), (x1 + og, 1)):
            for za in (z0 - dz, z1 + dz):
                g.face([(xg, ye - dy, za), (xg, yr, zm), (xg, yr - t, zm), (xg, ye - dy - t, za)], mat, out=(s, 0, 0), k=0.6 * k)
        for xg, s, cap in ((x0, -1, caps[0]), (x1, 1, caps[1])):
            if cap:
                g.face([(xg, ye, z0), (xg, ye, z1), (xg, yr, zm)], gable_mat, out=(s, 0, 0), k=k)
        # the lead ridge
        box(g, x0 - og, x1 + og, yr - 0.02, yr + 0.1, zm - 0.14, zm + 0.14, LEAD, skip=("-y",), k=k)
        return yr
    w = x1 - x0
    rise = math.tan(math.radians(pitch)) * w / 2
    xm = (x0 + x1) / 2
    yr = ye + rise
    dx = oe
    dy = dx * math.tan(math.radians(pitch))
    for (xa, xb, s) in ((x0 - dx, xm, -1), (x1 + dx, xm, 1)):
        A = (xa, ye - dy, z0 - og)
        Bq = (xa, ye - dy, z1 + og)
        Cq = (xb, yr, z1 + og)
        D = (xb, yr, z0 - og)
        g.face([A, Bq, Cq, D], mat, out=(s, 1, 0), k=k)
        g.face([A, Bq, (Bq[0], Bq[1] - t, Bq[2]), (A[0], A[1] - t, A[2])], mat, out=(s, 0, 0), k=0.7 * k)
        g.face([(A[0], A[1] - t, A[2]), (Bq[0], Bq[1] - t, Bq[2]), (Cq[0], Cq[1] - t, Cq[2]), (D[0], D[1] - t, D[2])], mat, out=(-s * 0.3, -1, 0), k=0.45 * k)
    for zg, s in ((z0 - og, -1), (z1 + og, 1)):
        for xa in (x0 - dx, x1 + dx):
            g.face([(xa, ye - dy, zg), (xm, yr, zg), (xm, yr - t, zg), (xa, ye - dy - t, zg)], mat, out=(0, 0, s), k=0.6 * k)
    for zg, s, cap in ((z0, -1, caps[0]), (z1, 1, caps[1])):
        if cap:
            g.face([(x0, ye, zg), (x1, ye, zg), (xm, yr, zg)], gable_mat, out=(0, 0, s), k=k)
    box(g, xm - 0.14, xm + 0.14, yr - 0.02, yr + 0.1, z0 - og, z1 + og, LEAD, skip=("-y",), k=k)
    return yr


# ------------------------------------------------------------------ walls with openings


class Hole:
    def __init__(self, u0, u1, yb, yt, arch=False, cell="bars", depth=0.3, rmat=BLUE, sill=True, frame=0.0, keystone=False, open_=False):
        self.u0, self.u1, self.yb, self.yt = u0, u1, yb, yt
        self.arch, self.cell, self.depth, self.rmat, self.sill = arch, cell, depth, rmat, sill
        self.frame, self.keystone, self.open = frame, keystone, open_


def Hc(uc, w, yb, yt, **kw):
    return Hole(uc - w / 2, uc + w / 2, yb, yt, **kw)


class Wall:
    """A flat upright wall face from A to B ((x, z) in the frame), facing `n` (a unit (x, z)); u runs from A, y up;
    depth d goes into the wall (negative: proud of it)."""

    def __init__(self, g, A, B_, n, y0, y1, mat=BRICK, k=1.0):
        self.g = g
        self.A = Vector((A[0], A[1]))
        self.B = Vector((B_[0], B_[1]))
        d = self.B - self.A
        self.L = d.length
        self.t = d / self.L
        self.n = Vector((n[0], n[1])).normalized()
        self.y0, self.y1 = y0, y1
        self.mat = mat
        self.k = k
        self.flip = self.t.x * self.n.y - self.t.y * self.n.x < 0

    def pt(self, u, y, d=0.0):
        q = self.A + self.t * u - self.n * d
        return (q.x, y, q.y)

    def out(self):
        return (self.n.x, 0.0, self.n.y)

    def fu(self, u, u0, w):
        f = (u - u0) / w
        return 1.0 - f if self.flip else f

    def build(self, holes=(), bands=()):
        """The face with the openings cut; `bands` (y0, y1, mat) another material in a band (a plinth, a course)."""
        L = self.L
        us = {0.0, L}
        ys = {self.y0, self.y1}
        for h in holes:
            us |= {h.u0, h.u1}
            ys |= {h.yb, h.yt}
        for b in bands:
            ys |= {max(self.y0, b[0]), min(self.y1, b[1])}
        # (the soot under the wall's top needs rows of vertices to fade in)
        ys |= {y for y in (self.y1 - 2.0, self.y1 - 1.0, self.y1 - 0.4) if self.y0 < y < self.y1}
        us = refine(sorted(u for u in us if -1e-9 <= u <= L + 1e-9), SEG)
        ys = refine(sorted(y for y in ys if self.y0 - 1e-9 <= y <= self.y1 + 1e-9), SEG)
        for ua, ub in zip(us, us[1:]):
            if ub - ua < 1e-5:
                continue
            mu = (ua + ub) / 2
            for va, vb in zip(ys, ys[1:]):
                if vb - va < 1e-5:
                    continue
                mv = (va + vb) / 2
                if any(h.u0 <= mu <= h.u1 and h.yb <= mv <= h.yt for h in holes):
                    continue
                m = self.mat
                for b in bands:
                    if b[0] <= mv <= b[1]:
                        m = b[2]
                SOOT_TOP[0] = self.y1
                self.g.face([self.pt(ua, va), self.pt(ub, va), self.pt(ub, vb), self.pt(ua, vb)], m, out=self.out(), k=self.k)
                SOOT_TOP[0] = None
        for h in holes:
            self.opening(h)
        return self

    def opening(self, h):
        g = self.g
        w = h.u1 - h.u0
        um = (h.u0 + h.u1) / 2
        r = w / 2
        ys = h.yt - r if h.arch else h.yt
        if h.arch:
            n_ = 8
            arc = [(um + r * math.cos(math.pi * i / n_), ys + r * math.sin(math.pi * i / n_)) for i in range(n_ + 1)]
            # the spandrels beside the arch (the wall face down to the springing, in the hole's rectangle)
            ap = n_ // 2
            for sp in ([(h.u1, h.yt)] + list(reversed(arc[:ap + 1])), [(h.u0, h.yt)] + arc[ap:]):
                g.face([self.pt(u, y) for u, y in sp], self.mat, out=self.out(), k=self.k)
            outline = [(h.u0, h.yb), (h.u1, h.yb)] + arc
        else:
            arc = None
            outline = [(h.u0, h.yb), (h.u1, h.yb), (h.u1, h.yt), (h.u0, h.yt)]
        # the reveal
        cu = um
        cy = (h.yb + h.yt) / 2
        n = len(outline)
        for i in range(n):
            (pu, py), (qu, qy) = outline[i], outline[(i + 1) % n]
            eu, ey = qu - pu, qy - py
            if math.hypot(eu, ey) < 1e-6:
                continue
            nu, ny = -ey, eu
            if nu * (cu - (pu + qu) / 2) + ny * (cy - (py + qy) / 2) < 0:
                nu, ny = -nu, -ny
            ln = math.hypot(nu, ny)
            nu, ny = nu / ln, ny / ln
            if ny > 0.7 and not h.sill:
                continue
            kk = 0.95 if ny > 0.7 else (0.55 if ny < -0.3 else 0.7)
            pts = [self.pt(pu, py), self.pt(qu, qy), self.pt(qu, qy, h.depth), self.pt(pu, py, h.depth)]
            g.face(pts, h.rmat, out=(self.t.x * nu, ny, self.t.y * nu), k=self.k * kk)
        # a stone frame round it (a flat band 0.05 proud) and an arch ring of voussoirs
        if h.frame > 0:
            f = h.frame
            dd = -0.05
            if h.arch:
                ro = r + f
                for i in range(8):
                    a0, a1 = math.pi * i / 8, math.pi * (i + 1) / 8
                    q = [(um + r * math.cos(a0), ys + r * math.sin(a0)), (um + ro * math.cos(a0), ys + ro * math.sin(a0)),
                         (um + ro * math.cos(a1), ys + ro * math.sin(a1)), (um + r * math.cos(a1), ys + r * math.sin(a1))]
                    kv = 1.0 if i % 2 else 0.9
                    g.face([self.pt(u, y, dd) for u, y in q], BLUE, out=self.out(), k=self.k * kv)
                    # the ring's outer edge
                    g.face([self.pt(q[1][0], q[1][1], dd), self.pt(q[2][0], q[2][1], dd), self.pt(q[2][0], q[2][1], 0.02), self.pt(q[1][0], q[1][1], 0.02)], BLUE,
                           out=(self.t.x * math.cos((a0 + a1) / 2), math.sin((a0 + a1) / 2), self.t.y * math.cos((a0 + a1) / 2)), k=self.k * 0.8)
                    g.face([self.pt(q[0][0], q[0][1], dd), self.pt(q[3][0], q[3][1], dd), self.pt(q[3][0], q[3][1], 0.0), self.pt(q[0][0], q[0][1], 0.0)], BLUE,
                           out=(-self.t.x * math.cos((a0 + a1) / 2), -math.sin((a0 + a1) / 2), -self.t.y * math.cos((a0 + a1) / 2)), k=self.k * 0.6)
                # the jambs below the springing
                for u0_, u1_ in ((h.u0 - f, h.u0), (h.u1, h.u1 + f)):
                    stone_band(g, self, u0_, u1_, h.yb, ys, dd)
                if h.keystone:
                    q = [(um - 0.14, ys + r - 0.05), (um + 0.14, ys + r - 0.05), (um + 0.2, ys + ro + 0.12), (um - 0.2, ys + ro + 0.12)]
                    extrude(g, self, q, -0.1, 0.0, BLUE)
            else:
                for u0_, u1_, y0_, y1_ in ((h.u0 - f, h.u0, h.yb, h.yt), (h.u1, h.u1 + f, h.yb, h.yt), (h.u0 - f, h.u1 + f, h.yt, h.yt + f)):
                    stone_band(g, self, u0_, u1_, y0_, y1_, dd)
        # the sill: a bluestone slab, proud, under every window
        if h.sill and h.cell not in ("door_gov", "door_side") and not h.open:
            extrude(g, self, [(h.u0 - 0.1, h.yb - 0.14), (h.u1 + 0.1, h.yb - 0.14), (h.u1 + 0.1, h.yb), (h.u0 - 0.1, h.yb)], -0.09, 0.0, BLUE)
        if h.open:
            return
        # the pane (atlas), at the reveal's back
        cell = h.cell
        if arc:
            body = [(h.u0, h.yb), (h.u1, h.yb), (h.u1, ys), (h.u0, ys)]
            hh = h.yt - h.yb
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - h.yb) / hh) for u, y in body]
            g.face([self.pt(u, y, h.depth) for u, y in body], ATLAS, out=self.out(), uvs=uvs, k=self.k)
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - h.yb) / hh) for u, y in arc]
            g.face([self.pt(u, y, h.depth) for u, y in arc], ATLAS, out=self.out(), uvs=uvs, k=self.k)
        else:
            body = outline
            uvs = [cell_uv(cell, self.fu(u, h.u0, w), (y - h.yb) / (h.yt - h.yb)) for u, y in body]
            g.face([self.pt(u, y, h.depth) for u, y in body], ATLAS, out=self.out(), uvs=uvs, k=self.k)


def stone_band(g, W, u0, u1, y0, y1, d, mat=BLUE):
    """A flat stone band in the wall's plane, d proud (negative), with its edges."""
    extrude(g, W, [(u0, y0), (u1, y0), (u1, y1), (u0, y1)], d, 0.0, mat)


def extrude(g, W, poly, d_front, d_back, mat, k=1.0, front_uvs=None, cell=None, back=False):
    """A flat shape in a wall's plane (u, y) from depth d_back to d_front (negative = proud)."""
    front = [W.pt(u, y, d_front) for u, y in poly]
    if cell:
        xs = [u for u, _ in poly]
        yv = [y for _, y in poly]
        u0, u1, y0, y1 = min(xs), max(xs), min(yv), max(yv)
        uvs = [cell_uv(cell, W.fu(u, u0, u1 - u0), (y - y0) / (y1 - y0)) for u, y in poly]
        g.face(front, ATLAS, out=W.out(), uvs=uvs, k=k)
    else:
        g.face(front, mat, out=W.out(), uvs=front_uvs, k=k)
    n = len(poly)
    cu = sum(u for u, _ in poly) / n
    cy = sum(y for _, y in poly) / n
    for i in range(n):
        (pu, py), (qu, qy) = poly[i], poly[(i + 1) % n]
        eu, ey = qu - pu, qy - py
        if math.hypot(eu, ey) < 1e-6:
            continue
        nu, ny = -ey, eu
        if nu * (cu - (pu + qu) / 2) + ny * (cy - (py + qy) / 2) > 0:
            nu, ny = -nu, -ny
        kk = 0.95 if ny > 0.7 else (0.55 if ny < -0.3 else 0.75)
        g.face([W.pt(pu, py, d_front), W.pt(qu, qy, d_front), W.pt(qu, qy, d_back), W.pt(pu, py, d_back)], mat if not cell else BLUE,
               out=(W.t.x * nu, ny, W.t.y * nu), k=k * kk)
    if back:
        g.face([W.pt(u, y, d_back) for u, y in poly], mat, out=(-W.n.x, 0, -W.n.y), k=k * 0.5)


def course(g, W, y0, y1, proj, mat=BLUE, u0=None, u1=None, k=1.0):
    """A string course or cornice along a wall: a band proud by `proj`, its top weathered, its ends closed."""
    a = -0.0 if u0 is None else u0
    b = W.L if u1 is None else u1
    extrude(g, W, [(a, y0), (b, y0), (b, y1), (a, y1)], -proj, 0.02, mat, k=k)
    SOOT_LINES.append((y0, 1.6))


def crenellate(g, W, y0, h, merlon=0.9, gap=0.6, d0=-0.05, d1=0.5, mat=BRICK, cap=BLUE, trim=0.0):
    """Battlements along a wall's top: merlons with stone caps, the parapet between them (from y0, h high).
    `trim`: both ends kept this far short (a side meeting another crenellated side at a corner: no overlap)."""
    L = W.L - 2 * trim
    n = max(1, int((L + gap) / (merlon + gap)))
    step = L / n
    for i in range(n):
        ua = trim + i * step + (step - merlon) / 2
        ub = ua + merlon
        extrude(g, W, [(ua, y0 + h * 0.45 + 0.08), (ub, y0 + h * 0.45 + 0.08), (ub, y0 + h), (ua, y0 + h)], d0, d1, mat, back=True)
        extrude(g, W, [(ua - 0.04, y0 + h), (ub + 0.04, y0 + h), (ub + 0.04, y0 + h + 0.12), (ua - 0.04, y0 + h + 0.12)], d0 - 0.04, d1 + 0.04, cap, back=True)
    # the parapet's low part, all along
    ta, tb = trim, trim + L
    extrude(g, W, [(ta, y0), (tb, y0), (tb, y0 + h * 0.45), (ta, y0 + h * 0.45)], d0, d1, mat, back=True)
    ca, cb = (ta - 0.03, tb + 0.03) if trim == 0 else (ta, tb)
    extrude(g, W, [(ca, y0 + h * 0.45), (cb, y0 + h * 0.45), (cb, y0 + h * 0.45 + 0.08), (ca, y0 + h * 0.45 + 0.08)], d0 - 0.03, d1 + 0.03, cap, back=True)
    SOOT_LINES.append((y0, 2.0))


def corbels(g, W, y, n_every=0.7, drop=0.45, proj=0.3):
    """A row of stone corbels under a parapet (the machicolation look of the 1850s' castle fronts)."""
    L = W.L
    n = max(1, int(L / n_every))
    for i in range(n):
        uc = (i + 0.5) * L / n
        extrude(g, W, [(uc - 0.13, y - drop), (uc + 0.13, y - drop), (uc + 0.13, y), (uc - 0.13, y)], -proj, 0.02, BLUE)


# ------------------------------------------------------------------ small furniture of iron


def lantern(g, x, y, z, fx, fz, arm=0.55):
    """A wall lantern on an iron bracket: the arm out of the wall along (fx, fz), a square lantern hanging from it."""
    ex, ez = x + fx * arm, z + fz * arm
    # the bracket: a flat bar out and a stay
    bar(g, (x, y + 0.35, z), (ex, y + 0.35, ez), 0.035)
    bar(g, (x, y - 0.05, z), (ex * 0.6 + x * 0.4, y + 0.35, ez * 0.6 + z * 0.4), 0.025)
    # the lantern: glass sides, an iron frame and a cap
    s = 0.13
    cy = y + 0.05
    for a, b, o in (((ex - s, ez - s), (ex + s, ez - s), (0, 0, -1)), ((ex + s, ez - s), (ex + s, ez + s), (1, 0, 0)),
                    ((ex + s, ez + s), (ex - s, ez + s), (0, 0, 1)), ((ex - s, ez + s), (ex - s, ez - s), (-1, 0, 0))):
        g.face([(a[0], cy - 0.18, a[1]), (b[0], cy - 0.18, b[1]), (b[0], cy + 0.16, b[1]), (a[0], cy + 0.16, a[1])], GLOW, out=o)
    box(g, ex - s - 0.02, ex + s + 0.02, cy + 0.16, cy + 0.22, ez - s - 0.02, ez + s + 0.02, IRON)
    pyramid(g, [(ex - s - 0.03, ez - s - 0.03), (ex + s + 0.03, ez - s - 0.03), (ex + s + 0.03, ez + s + 0.03), (ex - s - 0.03, ez + s + 0.03)], cy + 0.22, cy + 0.36, IRON)
    box(g, ex - s - 0.01, ex + s + 0.01, cy - 0.24, cy - 0.18, ez - s - 0.01, ez + s + 0.01, IRON)
    box(g, ex - 0.012, ex + 0.012, cy + 0.36, y + 0.35, ez - 0.012, ez + 0.012, IRON, skip=("-y", "+y"))


def bar(g, a, b, w, mat=IRON):
    """A square iron bar from a to b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    L = d.length
    if L < 1e-6:
        return
    d /= L
    up = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    s = d.cross(up).normalized() * (w / 2)
    t = d.cross(s).normalized() * (w / 2)
    P = [a + s + t, a - s + t, a - s - t, a + s - t]
    Q = [p + d * L for p in P]
    for i in range(4):
        j = (i + 1) % 4
        mid = (P[i] + P[j]) / 2 - a
        g.face([P[i], P[j], Q[j], Q[i]], mat, out=tuple(mid))


# ================================================================== the parts


def L(name):
    return PARTS[name]


def outer_wall(g):
    """The high wall round the compound: brick on a bluestone plinth, piers on the street side, a rounded bluestone
    coping; where a building stands on the line, the building is the wall."""
    g.grp = "prison_wall"
    c = COMP
    x0, x1, z0, z1 = c["x0"], c["x1"], c["z0"], c["z1"]
    t = WALL_T
    H = WALL_H
    fr = L("front")
    gv = L("governor")
    # runs of the wall: (A, B, outward n), each the outer face; the inner face t inside
    runs = [
        ((fr["x1"], z0), (x1, z0), (0, -1)),  # the front, west of the front building
        ((gv["x1"], z0), (fr["x0"], z0), (0, -1)),  # the front between the governor's house and the front building
        ((x1, z0), (x1, z1), (1, 0)),  # the west side
        ((x1, z1), (x0, z1), (0, 1)),  # the back
        ((x0, z1), (x0, gv["z1"]), (-1, 0)),  # the east side behind the governor's house
    ]
    for A, Bq, n in runs:
        W_out = Wall(g, A, Bq, n, FOOT, H)
        W_out.build(bands=[(FOOT, 0.55, BLUE)])
        # the inner face
        ia = (A[0] - n[0] * t, A[1] - n[1] * t)
        ib = (Bq[0] - n[0] * t, Bq[1] - n[1] * t)
        W_in = Wall(g, ib, ia, (-n[0], -n[1]), FOOT, H, k=0.92)
        W_in.build(bands=[(FOOT, 0.4, BLUE)])
        # the coping: a bluestone cap over both faces, rounded (a ridge)
        Lr = W_out.L
        mid_d = t / 2
        for s_ in (0, 1):
            pass
        cap_y = H
        for (da, db, ya, yb, o) in ((-0.08, mid_d, cap_y, cap_y + 0.26, (n[0], 1.2, n[1])), (mid_d, t + 0.08, cap_y + 0.26, cap_y, (-n[0], 1.2, -n[1]))):
            g.face([W_out.pt(0, ya, da), W_out.pt(Lr, ya, da), W_out.pt(Lr, yb, db), W_out.pt(0, yb, db)], BLUE, out=o)
        # the coping's drips (its edges over each face)
        for (d_, o) in ((-0.08, (n[0], 0, n[1])), (t + 0.08, (-n[0], 0, -n[1]))):
            g.face([W_out.pt(0, cap_y - 0.12, d_), W_out.pt(Lr, cap_y - 0.12, d_), W_out.pt(Lr, cap_y, d_), W_out.pt(0, cap_y, d_)], BLUE, out=o, k=0.8)
            dd = 0.0 if d_ < 0 else t
            g.face([W_out.pt(0, cap_y - 0.12, d_), W_out.pt(Lr, cap_y - 0.12, d_), W_out.pt(Lr, cap_y - 0.12, dd), W_out.pt(0, cap_y - 0.12, dd)], BLUE, out=(0, -1, 0), k=0.5)
        # the coping's ends (triangles)
        for u_, sgn in ((0.0, -1), (Lr, 1)):
            g.face([W_out.pt(u_, cap_y, -0.08), W_out.pt(u_, cap_y + 0.26, mid_d), W_out.pt(u_, cap_y, t + 0.08)], BLUE, out=(W_out.t.x * sgn, 0, W_out.t.y * sgn), k=0.8)
            g.face([W_out.pt(u_, cap_y - 0.12, -0.08), W_out.pt(u_, cap_y, -0.08), W_out.pt(u_, cap_y, t + 0.08), W_out.pt(u_, cap_y - 0.12, t + 0.08)], BLUE,
                   out=(W_out.t.x * sgn, 0, W_out.t.y * sgn), k=0.8)
        # (the run's own ends are not drawn: each meets another run at a corner or a building's wall)
        # piers on the outer face every ~5 m, and a row of iron spikes along the coping (chevaux-de-frise brackets)
        npier = max(1, int(Lr / 5.2))
        for i in range(1, npier):
            u = i * Lr / npier
            ua, ub = max(0.0, u - 0.3), min(Lr, u + 0.3)
            if ub - ua < 0.3:
                continue
            extrude(g, W_out, [(ua, FOOT), (ub, FOOT), (ub, H - 0.3), (ua, H - 0.3)], -0.14, 0.02, BRICK)
            extrude(g, W_out, [(ua - 0.04, -0.1), (ub + 0.04, -0.1), (ub + 0.04, 0.62), (ua - 0.04, 0.62)], -0.19, 0.02, BLUE)
            # the pier's weathered top: a stone slope
            g.face([W_out.pt(ua, H - 0.3, -0.14), W_out.pt(ub, H - 0.3, -0.14), W_out.pt(ub, H - 0.1, 0.0), W_out.pt(ua, H - 0.1, 0.0)], BLUE, out=(n[0], 1, n[1]))
        nsp = int(Lr / 0.9)
        for i in range(nsp):
            u = (i + 0.5) * Lr / nsp
            p = W_out.pt(u, cap_y + 0.26, mid_d)
            bar(g, (p[0], p[1] - 0.05, p[2]), (p[0], p[1] + 0.42, p[2]), 0.03)
        SOOT_LINES.append((H, 1.8))


def front_building(g):
    """The front building on the wall street: two storeys and battlements; corner towers; the gate tower."""
    g.grp = "prison_front"
    fr = L("front")
    tw = L("tower")
    gt = L("gate")
    x0, x1, z0, z1, H = fr["x0"], fr["x1"], fr["z0"], fr["z1"], fr["h"]
    cw = L("corner")["w"]
    ch = L("corner")["h"]
    y_first = 4.3
    # the front (facing -z), between the corner towers and the gate tower, each side: pairs of barred arched windows
    for sgn in (-1, 1):
        a = tw["x1"] if sgn > 0 else x0 + cw
        b = x1 - cw if sgn > 0 else tw["x0"]
        W = Wall(g, (a, z0), (b, z0), (0, -1), FOOT, H) if sgn > 0 else Wall(g, (a, z0), (b, z0), (0, -1), FOOT, H)
        holes = []
        Lw = W.L
        for uc in (Lw * 0.3, Lw * 0.7):
            for du in (-0.6, 0.6):
                holes.append(Hc(uc + du, 0.8, y_first + 0.9, y_first + 2.9, arch=True, cell="bars", depth=0.35, frame=0.16))
            holes.append(Hc(uc, 0.7, 2.0, 3.2, arch=True, cell="bars", depth=0.35, frame=0.14))
        W.build(holes, bands=[(FOOT, 0.6, BLUE), (y_first - 0.15, y_first + 0.1, BLUE)])
        course(g, W, 0.55, 0.62, 0.06)
        course(g, W, y_first - 0.15, y_first + 0.1, 0.1)
        corbels(g, W, H - 0.1)
        crenellate(g, W, H - 0.1, 1.2)
    # the back (facing +z) and the ends, plainer
    for (xa, xb) in ((x1, tw["x1"]), (tw["x0"], x0)):
        Wb = Wall(g, (xa, z1), (xb, z1), (0, 1), FOOT, H)
        holes = [Hc(u, 0.7, y_first + 1.0, y_first + 2.7, arch=True, cell="bars", depth=0.3, frame=0.12) for u in (2.0, 5.0)]
        Wb.build(holes, bands=[(FOOT, 0.5, BLUE)])
        course(g, Wb, H - 0.35, H - 0.1, 0.12)
        crenellate(g, Wb, H - 0.1, 1.0, mat=BRICK)
    # the corner towers: square, a little taller, standing out 0.3 at the front and ends
    for sgn in (-1, 1):
        tx0, tx1 = (x1 - cw, x1 + 0.3) if sgn > 0 else (x0 - 0.3, x0 + cw)
        tz0, tz1 = z0 - 0.3, z0 + cw + 0.3
        box(g, tx0, tx1, FOOT, ch, tz0, tz1, BRICK, skip=("-y", "+y"))
        box(g, tx0 - 0.06, tx1 + 0.06, FOOT, 0.6, tz0 - 0.06, tz1 + 0.06, BLUE, skip=("-y",))
        # quoins at the tower's corners, every other course proud
        for (qx, qz) in ((tx0, tz0), (tx1, tz0), (tx0, tz1), (tx1, tz1)):
            for i in range(int((ch - 0.8) / 0.55)):
                y_ = 0.8 + i * 0.55
                ww = 0.42 if i % 2 == 0 else 0.26
                sx = 1 if qx == tx0 else -1
                sz = 1 if qz == tz0 else -1
                box(g, min(qx, qx + sx * ww) - (0.03 if sx > 0 else -0.0), max(qx, qx + sx * ww) + (0.0 if sx > 0 else 0.03),
                    y_, y_ + 0.26, min(qz, qz + sz * 0.26) - (0.03 if sz > 0 else 0.0), max(qz, qz + sz * 0.26) + (0.0 if sz > 0 else 0.03), BLUE, skip=("-y",))
        # a small barred window each storey on the front and the end
        Wf = Wall(g, (tx0, tz0 - 0.001), (tx1, tz0 - 0.001), (0, -1), 0, 0)
        Wf.L = tx1 - tx0
        for yb in (2.2, 6.0):
            for Wx in (Wf,):
                q = [(Wx.L / 2 - 0.3, yb), (Wx.L / 2 + 0.3, yb), (Wx.L / 2 + 0.3, yb + 0.9), (Wx.L / 2 - 0.3, yb + 0.9)]
                extrude(g, Wx, q, -0.02, 0.0, BLUE, cell="bars_sq")
        # the tower's top: corbels and battlements on its four sides
        for k_, (A, Bq, n) in enumerate((((tx0, tz0), (tx1, tz0), (0, -1)), ((tx1, tz0), (tx1, tz1), (1, 0)), ((tx1, tz1), (tx0, tz1), (0, 1)), ((tx0, tz1), (tx0, tz0), (-1, 0)))):
            W = Wall(g, A, Bq, n, 0, ch)
            corbels(g, W, ch - 0.05, 0.6, 0.4, 0.25)
            crenellate(g, W, ch - 0.05, 1.3, merlon=0.7, gap=0.5, d0=-0.25, d1=0.2, trim=0.0 if k_ % 2 == 0 else 0.25)
        g.face([(tx0 + 0.2, ch + 0.2, tz0 + 0.2), (tx1 - 0.2, ch + 0.2, tz0 + 0.2), (tx1 - 0.2, ch + 0.2, tz1 - 0.2), (tx0 + 0.2, ch + 0.2, tz1 - 0.2)], LEAD, out=(0, 1, 0))
        # the end wall of the front building beyond the tower (facing +-x)
        xe = x1 if sgn > 0 else x0
        We = Wall(g, (xe, tz1), (xe, z1), (sgn, 0), FOOT, H) if sgn > 0 else Wall(g, (xe, z1), (xe, tz1), (sgn, 0), FOOT, H)
        We.build([Hc(We.L / 2, 0.7, y_first + 1.0, y_first + 2.6, arch=True, cell="bars", depth=0.3, frame=0.12)], bands=[(FOOT, 0.55, BLUE)])
        crenellate(g, We, H - 0.1, 1.2, trim=0.56)
    # the flat lead roof behind the battlements
    g.face([(x0 + 0.3, H - 0.25, z0 + 0.3), (x1 - 0.3, H - 0.25, z0 + 0.3), (x1 - 0.3, H - 0.25, z1 - 0.3), (x0 + 0.3, H - 0.25, z1 - 0.3)], LEAD, out=(0, 1, 0))
    # chimneys on the roof
    for cx_ in (-8.5, 8.5):
        box(g, cx_ - 0.4, cx_ + 0.4, H - 0.3, H + 1.9, z1 - 2.2, z1 - 1.4, BRICK, skip=("-y",))
        box(g, cx_ - 0.47, cx_ + 0.47, H + 1.9, H + 2.05, z1 - 2.27, z1 - 1.33, BLUE, skip=("-y",))
        for dx in (-0.18, 0.18):
            prism(g, ngon((cx_ + dx, z1 - 1.8), 0.1, 6), H + 2.05, H + 2.45, BRICK, top=True)
    gate_tower(g)


def gate_tower(g):
    tw = L("tower")
    gt = L("gate")
    x0, x1, z0, z1, H = tw["x0"], tw["x1"], tw["z0"], tw["z1"], tw["h"]
    fr = L("front")
    # the front face with the gate (a real opening), the plaque, the clock and a triple window
    W = Wall(g, (x1, z0), (x0, z0), (0, -1), FOOT, H)
    Lw = W.L
    um = Lw / 2
    gate = Hc(um, 2 * gt["hw"], 0.0, gt["h"], arch=True, depth=1.0, open_=True, sill=False, frame=0.0)
    wins = [Hc(um + du, 0.7, 7.2, 9.4, arch=True, cell="bars", depth=0.35, frame=0.12) for du in (-1.0, 0.0, 1.0)]
    W.build([gate] + wins, bands=[(FOOT, 0.7, BLUE)])
    # the gate's surround: a deep arch of bluestone voussoirs in two orders, with a hood
    r = gt["hw"]
    ys = gt["spring"]
    for (ri, ro, d) in ((r, r + 0.38, -0.1), (r + 0.38, r + 0.62, -0.18)):
        n_ = 11
        for i in range(n_):
            a0, a1 = math.pi * i / n_, math.pi * (i + 1) / n_
            q = [(um + ri * math.cos(a0), ys + ri * math.sin(a0)), (um + ro * math.cos(a0), ys + ro * math.sin(a0)),
                 (um + ro * math.cos(a1), ys + ro * math.sin(a1)), (um + ri * math.cos(a1), ys + ri * math.sin(a1))]
            extrude(g, W, q, d, 0.0, BLUE, k=1.0 if i % 2 else 0.88)
        for (u0, u1) in ((um - ro, um - ri), (um + ri, um + ro)):
            extrude(g, W, [(u0, -0.1), (u1, -0.1), (u1, ys), (u0, ys)], d, 0.0, BLUE)
    # the keystone, big, and the plaque over it
    extrude(g, W, [(um - 0.2, ys + r - 0.05), (um + 0.2, ys + r - 0.05), (um + 0.28, ys + r + 0.75), (um - 0.28, ys + r + 0.75)], -0.3, 0.0, BLUE)
    extrude(g, W, [(um - 1.7, 5.75), (um + 1.7, 5.75), (um + 1.7, 6.6), (um - 1.7, 6.6)], -0.08, 0.0, BLUE, cell="plaque")
    extrude(g, W, [(um - 1.85, 5.62), (um + 1.85, 5.62), (um + 1.85, 5.75), (um - 1.85, 5.75)], -0.14, 0.0, BLUE)
    extrude(g, W, [(um - 1.85, 6.6), (um + 1.85, 6.6), (um + 1.85, 6.74), (um - 1.85, 6.74)], -0.14, 0.0, BLUE)
    # the clock over the window, on a stone disc
    disc_pts = [(um + 0.62 * math.cos(2 * math.pi * i / 16), 11.1 + 0.62 * math.sin(2 * math.pi * i / 16)) for i in range(16)]
    extrude(g, W, [(um + 0.78 * math.cos(2 * math.pi * i / 16), 11.1 + 0.78 * math.sin(2 * math.pi * i / 16)) for i in range(16)], -0.08, 0.0, BLUE)
    front = [W.pt(u, y, -0.1) for u, y in disc_pts]
    uvs = [cell_uv("clock", W.fu(u, um - 0.62, 1.24), (y - 10.48) / 1.24) for u, y in disc_pts]
    g.face(front, ATLAS, out=W.out(), uvs=uvs)
    clock_mark("prison_gate", W.pt(um, 11.1, -0.1), W.out(), 0.62, minute=0.66, hour=0.44)
    course(g, W, 0.62, 0.7, 0.07)
    course(g, W, 4.25, 4.45, 0.12)
    course(g, W, 9.95, 10.15, 0.1)
    # pilaster strips at the tower's front corners (rustication, every other course proud)
    for u0 in (0.0, Lw - 0.55):
        for i in range(int((H - 1.0) / 0.5)):
            y_ = 0.72 + i * 0.5
            dd = -0.1 if i % 2 == 0 else -0.05
            extrude(g, W, [(u0, y_), (u0 + 0.55, y_), (u0 + 0.55, y_ + 0.44), (u0, y_ + 0.44)], dd, 0.0, BLUE)
    # the tower's sides over the front building's roof, and its back
    fr_h = fr["h"]
    for (A, Bq, n) in (((x0, z0), (x0, z1), (-1, 0)), ((x1, z1), (x1, z0), (1, 0))):
        Ws = Wall(g, A, Bq, n, FOOT, H)
        # below the front building's roof the side is inside the building: only the part standing out in front and above
        Ws2 = Wall(g, A, (A[0], fr["z0"]), n, FOOT, fr_h - 0.3) if Bq[1] > A[1] else Wall(g, (Bq[0], fr["z0"]), Bq, n, FOOT, fr_h - 0.3)
        Ws2.build(bands=[(FOOT, 0.7, BLUE)])
        Wu = Wall(g, A, Bq, n, fr_h - 0.3, H)
        Wu.build([Hc(Wu.L / 2, 0.7, fr_h + 1.6, fr_h + 3.2, arch=True, cell="bars", depth=0.3, frame=0.12)])
    Wbk = Wall(g, (x0, z1), (x1, z1), (0, 1), FOOT, H)
    Wbk.build([Hc(Wbk.L / 2, 0.8, fr_h + 1.6, fr_h + 3.3, arch=True, cell="bars", depth=0.3, frame=0.12)])
    # the parapet: corbels, battlements, and a round bartizan on each front corner
    for k_, (A, Bq, n) in enumerate((((x1, z0), (x0, z0), (0, -1)), ((x0, z0), (x0, z1), (-1, 0)), ((x0, z1), (x1, z1), (0, 1)), ((x1, z1), (x1, z0), (1, 0)))):
        Wp = Wall(g, A, Bq, n, 0, H)
        corbels(g, Wp, H - 0.05, 0.62, 0.5, 0.32)
        crenellate(g, Wp, H - 0.05, 1.4, merlon=0.8, gap=0.55, d0=-0.32, d1=0.25, trim=0.0 if k_ % 2 == 0 else 0.29)
    g.face([(x0 + 0.3, H - 0.1, z0 + 0.3), (x1 - 0.3, H - 0.1, z0 + 0.3), (x1 - 0.3, H - 0.1, z1 - 0.3), (x0 + 0.3, H - 0.1, z1 - 0.3)], LEAD, out=(0, 1, 0))
    for sx in (x0, x1):
        c = (sx, z0)
        ring = ngon(c, 0.75, 10)
        # corbelled out: a cone under it
        pyramid(g, ngon(c, 0.75, 10), 9.6, 8.6, BLUE, apex=c)
        prism(g, ring, 9.6, H + 1.0, BRICK, top=False)
        prism(g, ngon(c, 0.8, 10), H + 1.0, H + 1.12, BLUE, top=False, bottom=True)
        pyramid(g, ngon(c, 0.86, 10), H + 1.12, H + 2.6, SLATE)
        # arrow slits on the bartizan
        for a in (math.pi * 1.25, math.pi * 1.5, math.pi * 1.75):
            p = (c[0] + 0.76 * math.cos(a), c[1] + 0.76 * math.sin(a))
            tdir = (-math.sin(a), math.cos(a))
            g.face([(p[0] - tdir[0] * 0.06, 11.2, p[1] - tdir[1] * 0.06), (p[0] + tdir[0] * 0.06, 11.2, p[1] + tdir[1] * 0.06),
                    (p[0] + tdir[0] * 0.06, 12.2, p[1] + tdir[1] * 0.06), (p[0] - tdir[0] * 0.06, 12.2, p[1] - tdir[1] * 0.06)], ATLAS,
                   out=(math.cos(a), 0, math.sin(a)), cell="dark")
    SOOT_LINES.append((H, 2.2))
    # the lanterns either side of the gate
    for du in (-2.45, 2.45):
        p = W.pt(um + du, 3.4, -0.05)
        lantern(g, p[0], p[1], p[2], 0.0, -1.0, 0.5)


def governor_house(g):
    """The governor's house: three storeys of brick with bluestone, a hipped slate roof, a door on the street."""
    g.grp = "prison_governor"
    gv = L("governor")
    x0, x1, z0, z1, H = gv["x0"], gv["x1"], gv["z0"], gv["z1"], gv["h"]
    storeys = [(0.0, 4.0), (4.0, 7.6), (7.6, H)]
    # the street front (facing -z): five bays, the door in the middle up four steps
    W = Wall(g, (x1, z0), (x0, z0), (0, -1), FOOT, H)
    Lw = W.L
    bays = [Lw * (i + 0.5) / 5 for i in range(5)]
    holes = []
    for i, uc in enumerate(bays):
        if i == 2:
            holes.append(Hc(uc, 1.3, 0.62, 3.4, cell="door_gov", depth=0.3, sill=False, frame=0.18))
        else:
            holes.append(Hc(uc, 1.05, 1.1, 3.0, cell="sash", depth=0.22, frame=0.14))
        for (yb, yt) in ((4.9, 6.9), (8.3, 10.0)):
            holes.append(Hc(uc, 1.05, yb, yt, cell="sash", depth=0.22, frame=0.14))
    W.build(holes, bands=[(FOOT, 0.62, BLUE)])
    course(g, W, 0.55, 0.62, 0.08)
    course(g, W, 3.95, 4.15, 0.1)
    course(g, W, 7.55, 7.7, 0.08)
    # a cornice under the eaves
    course(g, W, H - 0.35, H, 0.3)
    # the steps before the door (on the street, three, bluestone)
    dc = W.pt(bays[2], 0, 0)
    for i, (d, y) in enumerate(((0.95, 0.16), (0.65, 0.32), (0.35, 0.48))):
        box(g, dc[0] - 0.95 + i * 0.05, dc[0] + 0.95 - i * 0.05, 0.02, y + 0.14, z0 - d, z0 - d + 0.35 + (0.3 if i == 2 else 0.0), BLUE)
    # a lamp over the door
    p = W.pt(bays[2], 3.95, -0.05)
    lantern(g, p[0], p[1], p[2], 0.0, -1.0, 0.4)
    # the east end (facing -x) and the back (facing +z) with windows; the west side meets the front wall
    We = Wall(g, (x0, z0), (x0, z1), (-1, 0), FOOT, H)
    holes = []
    for uc in (We.L * 0.3, We.L * 0.7):
        for (yb, yt) in ((1.1, 3.0), (4.9, 6.9), (8.3, 10.0)):
            holes.append(Hc(uc, 1.0, yb, yt, cell="sash", depth=0.22, frame=0.12))
    We.build(holes, bands=[(FOOT, 0.62, BLUE)])
    course(g, We, H - 0.35, H, 0.3)
    course(g, We, 3.95, 4.15, 0.1)
    Wb = Wall(g, (x0, z1), (x1, z1), (0, 1), FOOT, H)
    Wb.build([Hc(uc, 1.0, yb, yt, cell="sash", depth=0.22, frame=0.12) for uc in (2.0, 5.2, 8.4) for (yb, yt) in ((4.9, 6.9), (8.3, 10.0))]
             + [Hc(5.2, 1.0, 0.62, 2.9, cell="door_side", depth=0.2, sill=False, frame=0.12)], bands=[(FOOT, 0.62, BLUE)])
    course(g, Wb, H - 0.35, H, 0.3)
    Ww = Wall(g, (x1, z1), (x1, z0), (1, 0), WALL_H + 0.2, H)
    Ww.build([Hc(Ww.L / 2, 1.0, 8.3, 10.0, cell="sash", depth=0.22, frame=0.12)])
    course(g, Ww, H - 0.35, H, 0.3)
    # quoins at the two street corners
    for u0 in (0.0, Lw - 0.5):
        for i in range(int((H - 0.9) / 0.5)):
            y_ = 0.65 + i * 0.5
            extrude(g, W, [(u0 + (0.12 if i % 2 else 0.0), y_), (u0 + 0.5 - (0.0 if i % 2 else 0.12), y_), (u0 + 0.5 - (0.0 if i % 2 else 0.12), y_ + 0.44), (u0 + (0.12 if i % 2 else 0.0), y_ + 0.44)], -0.075, 0.0, BLUE)
    # the hipped roof
    oe = 0.45
    rx0, rx1, rz0, rz1 = x0 - oe, x1 + oe, z0 - oe, z1 + oe
    rise = 3.6
    ridge_z0, ridge_z1 = (z0 + z1) / 2, (z0 + z1) / 2
    ridge_x0, ridge_x1 = x0 + 3.6, x1 - 3.6
    yb_ = H - 0.3
    yr = H + rise
    g.face([(rx0, yb_, rz0), (rx1, yb_, rz0), (ridge_x1, yr, ridge_z0), (ridge_x0, yr, ridge_z0)], SLATE, out=(0, 1, -1))
    g.face([(rx1, yb_, rz1), (rx0, yb_, rz1), (ridge_x0, yr, ridge_z1), (ridge_x1, yr, ridge_z1)], SLATE, out=(0, 1, 1))
    g.face([(rx0, yb_, rz1), (rx0, yb_, rz0), (ridge_x0, yr, ridge_z0)], SLATE, out=(-1, 1, 0))
    g.face([(rx1, yb_, rz0), (rx1, yb_, rz1), (ridge_x1, yr, ridge_z1)], SLATE, out=(1, 1, 0))
    g.face([(rx0, yb_, rz0), (rx1, yb_, rz0), (rx1, yb_, rz1), (rx0, yb_, rz1)], SLATE, out=(0, -1, 0), k=0.4)
    box(g, ridge_x0, ridge_x1, yr - 0.02, yr + 0.1, ridge_z0 - 0.12, ridge_z0 + 0.12, LEAD, skip=("-y",))
    # dormers on the street side, and two chimneys
    for uc in (bays[1], bays[3]):
        p = W.pt(uc, 0, 0)
        dx = p[0]
        dz0 = z0 + 0.4
        box(g, dx - 0.6, dx + 0.6, yb_ + 0.6, yb_ + 2.0, dz0, dz0 + 1.2, WOOD, skip=("-y", "+y"))
        Wd = Wall(g, (dx + 0.6, dz0 - 0.001), (dx - 0.6, dz0 - 0.001), (0, -1), 0, 0)
        extrude(g, Wd, [(0.25, yb_ + 0.75), (0.95, yb_ + 0.75), (0.95, yb_ + 1.8), (0.25, yb_ + 1.8)], -0.01, 0.0, WOOD, cell="sash")
        gable_roof(g, dx - 0.6, dx + 0.6, dz0, dz0 + 1.6, yb_ + 2.0, "z", pitch=45, oe=0.12, og=0.15, t=0.08, caps=(True, False), gable_mat=WOOD)
    for cx_ in (x0 + 1.6, x1 - 1.6):
        box(g, cx_ - 0.45, cx_ + 0.45, H, yr + 1.3, (z0 + z1) / 2 - 0.35, (z0 + z1) / 2 + 0.35, BRICK, skip=("-y",))
        box(g, cx_ - 0.52, cx_ + 0.52, yr + 1.3, yr + 1.45, (z0 + z1) / 2 - 0.42, (z0 + z1) / 2 + 0.42, BLUE, skip=("-y",))
        for dz in (-0.16, 0.16):
            prism(g, ngon((cx_, (z0 + z1) / 2 + dz), 0.1, 6), yr + 1.45, yr + 1.85, BRICK)
    SOOT_LINES.append((H - 0.35, 1.8))


def link_block(g):
    """The low block from the front building to the pavilion: two storeys, a flat roof behind a parapet."""
    g.grp = "prison_pavilion"
    lk = L("link")
    x0, x1, z0, z1, H = lk["x0"], lk["x1"], lk["z0"], lk["z1"], lk["h"]
    for (A, Bq, n) in (((x0, z0), (x0, z1), (-1, 0)), ((x1, z1), (x1, z0), (1, 0))):
        W = Wall(g, A, Bq, n, FOOT, H)
        W.build([Hc(W.L / 2, 0.7, 4.8, 6.4, arch=True, cell="bars", depth=0.3, frame=0.12), Hc(W.L / 2, 0.6, 1.9, 2.9, cell="bars_sq", depth=0.25, frame=0.1)],
                bands=[(FOOT, 0.5, BLUE)])
        course(g, W, H - 0.3, H, 0.14)
        crenellate(g, W, H, 0.9, merlon=0.7, gap=0.5)
    g.face([(x0 + 0.2, H - 0.1, z0), (x1 - 0.2, H - 0.1, z0), (x1 - 0.2, H - 0.1, z1), (x0 + 0.2, H - 0.1, z1)], LEAD, out=(0, 1, 0))


def pavilion(g):
    """The central watch pavilion: an octagon of four storeys over the wings' roofs, round-arched windows high up,
    a slate roof and a glazed lantern."""
    g.grp = "prison_pavilion"
    pv = L("pavilion")
    c = (pv["x"], pv["z"])
    r = pv["r"]
    H = pv["h"]
    ring = ngon(c, r, 8, math.pi / 8)
    wa = L("wingA")
    wing_hw = (wa["z1"] - wa["z0"]) / 2
    lk = L("link")
    for i in range(8):
        a, b = ring[i], ring[(i + 1) % 8]
        mx, mz = (a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]
        n = (mx / math.hypot(mx, mz), mz / math.hypot(mx, mz))
        W = Wall(g, a, b, n, FOOT, H)
        # faces the wings and the link run into: only above them
        # the faces the wings and the link run into: only above them (the wings' roofs reach 15 m at the ridge)
        facing_wing = abs(n[0]) > 0.9
        facing_link = n[1] < -0.9
        y_from = FOOT
        if facing_wing:
            y_from = wa["h"] - 0.5
        elif facing_link:
            y_from = lk["h"] - 0.3
        W = Wall(g, a, b, n, y_from, H)
        holes = [Hc(W.L / 2, 0.9, 15.0, 16.9, arch=True, cell="bars", depth=0.4, frame=0.16)]
        if n[1] > 0.9:  # the back face, the only one free to the ground
            holes += [Hc(W.L / 2, 0.7, 2.2, 3.6, arch=True, cell="bars", depth=0.35, frame=0.12), Hc(W.L / 2, 0.7, 6.4, 7.9, arch=True, cell="bars", depth=0.35, frame=0.12),
                      Hc(W.L / 2, 0.7, 10.2, 11.7, arch=True, cell="bars", depth=0.35, frame=0.12)]
        W.build(holes, bands=[(FOOT, 0.55, BLUE)] if y_from < 0 else [])
        if y_from < 0:
            course(g, W, 0.5, 0.58, 0.06)
        course(g, W, H - 0.5, H, 0.35)
        course(g, W, 14.3, 14.5, 0.1)
        # stone pilasters at the corners
        extrude(g, W, [(0.0, max(0.55, y_from)), (0.4, max(0.55, y_from)), (0.4, H - 0.5), (0.0, H - 0.5)], -0.08, 0.0, BLUE)
    # the roof: an octagonal pyramid, cut off for the lantern
    oe = 0.5
    roof_ring = ngon(c, r + oe, 8, math.pi / 8)
    lr = 1.7
    top_ring = ngon(c, lr, 8, math.pi / 8)
    yr0 = H - 0.1
    yr1 = H + 3.6
    for i in range(8):
        a, b = roof_ring[i], roof_ring[(i + 1) % 8]
        p, q = top_ring[i], top_ring[(i + 1) % 8]
        mx, mz = (a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]
        g.face([(a[0], yr0, a[1]), (b[0], yr0, b[1]), (q[0], yr1, q[1]), (p[0], yr1, p[1])], SLATE, out=(mx, 1.2, mz))
        g.face([(a[0], yr0, a[1]), (b[0], yr0, b[1]), (b[0], yr0 - 0.18, b[1]), (a[0], yr0 - 0.18, a[1])], LEAD, out=(mx, 0, mz), k=0.7)
        # lead hips
        bar(g, (a[0], yr0 + 0.03, a[1]), (p[0], yr1 + 0.03, p[1]), 0.1, LEAD)
    g.face([(p[0], yr0 - 0.18, p[1]) for p in roof_ring], SLATE, out=(0, -1, 0), k=0.4)
    # the lantern: louvred sides, a small lead dome, a finial
    prism(g, top_ring, yr1, yr1 + 0.25, LEAD, top=False)
    ly0, ly1 = yr1 + 0.25, yr1 + 2.3
    for i in range(8):
        a, b = top_ring[i], top_ring[(i + 1) % 8]
        mx, mz = (a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]
        # posts at the corners and louvres between
        g.face([(a[0], ly0, a[1]), (b[0], ly0, b[1]), (b[0], ly1, b[1]), (a[0], ly1, a[1])], ATLAS, out=(mx, 0, mz),
               uvs=[cell_uv("louvre", 0, 0), cell_uv("louvre", 1, 0), cell_uv("louvre", 1, 1), cell_uv("louvre", 0, 1)])
        bar(g, (a[0], ly0, a[1]), (a[0], ly1, a[1]), 0.14, WOOD)
    cap_ring = ngon(c, lr + 0.25, 8, math.pi / 8)
    prism(g, cap_ring, ly1, ly1 + 0.18, LEAD, top=False, bottom=True)
    pyramid(g, cap_ring, ly1 + 0.18, ly1 + 1.3, LEAD)
    bar(g, (c[0], ly1 + 1.2, c[1]), (c[0], ly1 + 2.4, c[1]), 0.06)
    prism(g, ngon(c, 0.12, 6), ly1 + 1.9, ly1 + 2.05, IRON)
    SOOT_LINES.append((H - 0.5, 2.0))


CELL_X0 = 6.0 + 1.4  # the first cell's middle from the pavilion's centre (its apothem is about 5.9)
CELL_PITCH = 2.8


def cell_xs(name):
    """The cells' middles along a wing (local x), from the pavilion out."""
    w = L(name)
    sgn = 1 if name == "wingA" else -1
    far = w["x1"] if sgn > 0 else -w["x0"]
    out = []
    k = 0
    while CELL_X0 + k * CELL_PITCH + 1.4 <= far + 1e-6:
        out.append(sgn * (CELL_X0 + k * CELL_PITCH))
        k += 1
    return out


def wing(g, name):
    """A cell wing: three storeys of cells either side of the galleried corridor, one small barred window high in
    each cell (2.8 m apart), stone pilaster strips, a slate roof with the corridor's roof light along the ridge and
    ventilation stacks, the end gable with a barred oculus. Wing A has the yard door in its south face."""
    g.grp = "prison_wings"
    w = L(name)
    x0, x1, z0, z1, H = w["x0"], w["x1"], w["z0"], w["z1"], w["h"]
    sgn = 1 if name == "wingA" else -1
    outer = x1 if sgn > 0 else x0
    yd = L("yard_door")
    xs = cell_xs(name)
    for (za, n) in ((z0, (0, -1)), (z1, (0, 1))):
        # u runs from A: A at the smaller x on the south face, the larger on the north
        A, Bq = ((x0, za), (x1, za)) if n[1] < 0 else ((x1, za), (x0, za))
        W = Wall(g, A, Bq, n, FOOT, H)
        U = (lambda x: x - x0) if n[1] < 0 else (lambda x: x1 - x)
        holes = []
        door_here = name == "wingA" and n[1] < 0
        for xc in xs:
            for s, yb in enumerate((2.3, 5.9, 9.5)):
                if door_here and s == 0 and abs(xc - yd["x"]) < 1.3:
                    continue
                holes.append(Hc(U(xc), 0.62, yb, yb + 1.05, arch=True, cell="bars", depth=0.28, frame=0.1))
        if door_here:
            holes.append(Hc(U(yd["x"]), 2 * yd["hw"], 0.0, yd["h"], arch=True, depth=0.5, open_=True, sill=False, frame=0.16))
        W.build(holes, bands=[(FOOT, 0.55, BLUE), (3.55, 3.7, BLUE), (7.15, 7.3, BLUE)])
        course(g, W, 0.5, 0.58, 0.06)
        course(g, W, H - 0.4, H, 0.3)
        # pilaster strips every two cells
        for k in range(0, len(xs) + 1, 2):
            xp = sgn * (CELL_X0 - 1.4 + k * CELL_PITCH)
            u = U(xp)
            if 0.3 < u < W.L - 0.3 and not (door_here and abs(xp - yd["x"]) < 1.3):
                extrude(g, W, [(u - 0.22, 0.58), (u + 0.22, 0.58), (u + 0.22, H - 0.4), (u - 0.22, H - 0.4)], -0.07, 0.0, BRICK, k=0.97)
        if door_here:
            p = W.pt(U(yd["x"] + 1.3), 2.6, -0.05)
            lantern(g, p[0], p[1], p[2], 0.0, -1.0, 0.45)
    # the end gable
    Wn = Wall(g, (outer, z1 if sgn > 0 else z0), (outer, z0 if sgn > 0 else z1), (sgn, 0), FOOT, H)
    Wn.build([Hc(Wn.L / 2, 0.62, yb, yb + 1.05, arch=True, cell="bars", depth=0.28, frame=0.1) for yb in (2.3, 5.9)], bands=[(FOOT, 0.55, BLUE)])
    course(g, Wn, H - 0.4, H, 0.3)
    yr = gable_roof(g, x0, x1, z0, z1, H, "x", pitch=33, oe=0.5, og=0.3, caps=(sgn < 0, sgn > 0))
    # the oculus in the gable
    zc = (z0 + z1) / 2
    Wg = Wall(g, (outer, z1 if sgn > 0 else z0), (outer, z0 if sgn > 0 else z1), (sgn, 0), 0, 0)
    ring_o = [(Wg.L / 2 + 0.75 * math.cos(2 * math.pi * i / 16), H + 1.2 + 0.75 * math.sin(2 * math.pi * i / 16)) for i in range(16)]
    ring_i = [(Wg.L / 2 + 0.55 * math.cos(2 * math.pi * i / 16), H + 1.2 + 0.55 * math.sin(2 * math.pi * i / 16)) for i in range(16)]
    extrude(g, Wg, ring_o, -0.08, 0.0, BLUE)
    g.face([Wg.pt(u, y, -0.1) for u, y in ring_i], ATLAS, out=Wg.out(),
           uvs=[cell_uv("oculus", Wg.fu(u, Wg.L / 2 - 0.55, 1.1), (y - (H + 0.65)) / 1.1) for u, y in ring_i])
    # the gable's stone coping (along both rakes)
    for zz in (z0, z1):
        bar(g, (outer + sgn * 0.08, H, zz), (outer + sgn * 0.08, yr, zc), 0.28, BLUE)
    # the roof light over the corridor: a glazed strip each side of the ridge (dark glass, iron glazing bars)
    rl0, rl1 = (6.4, x1 - 1.2) if sgn > 0 else (x0 + 1.2, -6.4)
    slope = math.tan(math.radians(33))
    for s_ in (-1, 1):
        za, zb = zc + s_ * 0.2, zc + s_ * 1.4
        ya = yr - 0.2 * slope + 0.1
        yb = yr - 1.4 * slope + 0.1
        g.face([(rl0, ya, za), (rl1, ya, za), (rl1, yb, zb), (rl0, yb, zb)], ATLAS, out=(0, 1, s_), cell="dark")
        for xg in np.arange(rl0, rl1 + 0.01, 1.4):
            bar(g, (xg, ya + 0.04, za), (xg, yb + 0.04, zb), 0.05)
    # the ventilation stacks on the back slope
    for xs_ in np.arange(8.0, abs(outer) - 2.0, 7.0):
        xc = sgn * xs_
        box(g, xc - 0.35, xc + 0.35, yr - 2.2, yr + 1.3, zc + 1.8, zc + 2.5, BRICK, skip=("-y",))
        box(g, xc - 0.42, xc + 0.42, yr + 1.3, yr + 1.44, zc + 1.73, zc + 2.57, BLUE, skip=("-y",))
    SOOT_LINES.append((H - 0.4, 1.8))


def chapel(g):
    """The chapel in the west court: a small hall with a round apse, round-arched leaded windows, the rose in its
    front gable and a bell-cote with its bell on the apex."""
    g.grp = "prison_chapel"
    cp = L("chapel")
    x0, x1, z0, z1, H = cp["x0"], cp["x1"], cp["z0"], cp["z1"] - 2.4, cp["h"]
    xm = (x0 + x1) / 2
    w = x1 - x0
    # the long sides
    for (xx, n, A, Bq) in ((x0, (-1, 0), (x0, z1), (x0, z0)), (x1, (1, 0), (x1, z0), (x1, z1))):
        W = Wall(g, A, Bq, n, FOOT, H)
        W.build([Hc(u, 1.0, 3.2, 6.8, arch=True, cell="chapel", depth=0.3, frame=0.16) for u in (W.L * 0.22, W.L * 0.5, W.L * 0.78)],
                bands=[(FOOT, 0.6, BLUE)])
        course(g, W, H - 0.3, H, 0.25)
        for u in (0.0, W.L / 3, 2 * W.L / 3, W.L):
            ua, ub = max(0.0, u - 0.3), min(W.L, u + 0.3)
            extrude(g, W, [(ua, FOOT), (ub, FOOT), (ub, 3.0), (ua, 3.0)], -0.35, 0.02, BRICK)
            g.face([W.pt(ua, 3.0, -0.35), W.pt(ub, 3.0, -0.35), W.pt(ub, 3.6, 0.0), W.pt(ua, 3.6, 0.0)], BLUE, out=(n[0], 1, n[1]))
    # the front gable (facing -z): a door, the rose, the bell-cote
    Wf = Wall(g, (x1, z0), (x0, z0), (0, -1), FOOT, H)
    Wf.build([Hc(w / 2, 1.3, 0.2, 3.1, arch=True, cell="door_side", depth=0.3, sill=False, frame=0.18)], bands=[(FOOT, 0.6, BLUE)])
    course(g, Wf, H - 0.3, H, 0.25)
    yr = gable_roof(g, x0, x1, z0, z1, H, "z", pitch=42, oe=0.4, og=0.35, caps=(True, False))
    Wg = Wall(g, (x1, z0), (x0, z0), (0, -1), 0, 0)
    ring_o = [(w / 2 + 1.05 * math.cos(2 * math.pi * i / 20), H + 1.3 + 1.05 * math.sin(2 * math.pi * i / 20)) for i in range(20)]
    ring_i = [(w / 2 + 0.85 * math.cos(2 * math.pi * i / 20), H + 1.3 + 0.85 * math.sin(2 * math.pi * i / 20)) for i in range(20)]
    extrude(g, Wg, ring_o, -0.1, 0.0, BLUE)
    g.face([Wg.pt(u, y, -0.12) for u, y in ring_i], ATLAS, out=Wg.out(),
           uvs=[cell_uv("rose", Wg.fu(u, w / 2 - 0.85, 1.7), (y - (H + 0.45)) / 1.7) for u, y in ring_i])
    for s_ in (-1, 1):
        bar(g, (xm + s_ * (w / 2 + 0.05), H, z0 - 0.08), (xm, yr + 0.05, z0 - 0.08), 0.3, BLUE)
    # the bell-cote on the apex: two piers, an arch, a small gable, the bell
    bx, bz = xm, z0 + 0.25
    by = yr - 0.3
    for s_ in (-1, 1):
        box(g, bx + s_ * 0.55 - 0.18, bx + s_ * 0.55 + 0.18, by, by + 1.9, bz - 0.2, bz + 0.2, BLUE)
    box(g, bx - 0.8, bx + 0.8, by + 1.9, by + 2.2, bz - 0.25, bz + 0.25, BLUE)
    pyramid(g, [(bx - 0.85, bz - 0.28), (bx + 0.85, bz - 0.28), (bx + 0.85, bz + 0.28), (bx - 0.85, bz + 0.28)], by + 2.2, by + 2.8, SLATE, apex=(bx, bz))
    lathe_bell(g, (bx, by + 0.85, bz))
    bar(g, (bx, by + 2.8, bz), (bx, by + 3.5, bz), 0.05)
    bar(g, (bx - 0.2, by + 3.25, bz), (bx + 0.2, by + 3.25, bz), 0.05)
    # the apse: a half-octagon at the back, lower
    ac = (xm, z1)
    ar = w / 2
    pts = [(ac[0] + ar * math.cos(math.pi * i / 4 - math.pi), ac[1] + ar * math.sin(math.pi * i / 4 - math.pi) * -1) for i in range(5)]
    pts = [(ac[0] - ar * math.cos(math.pi * i / 4), ac[1] + ar * math.sin(math.pi * i / 4)) for i in range(5)]
    Ha = H - 0.8
    for i in range(4):
        a, b = pts[i], pts[i + 1]
        mx, mz = (a[0] + b[0]) / 2 - ac[0], (a[1] + b[1]) / 2 - ac[1]
        W = Wall(g, a, b, (mx, mz), FOOT, Ha)
        W.build([Hc(W.L / 2, 0.6, 3.4, 5.6, arch=True, cell="chapel", depth=0.25, frame=0.12)] if i in (1, 2) else [], bands=[(FOOT, 0.6, BLUE)])
        course(g, W, Ha - 0.25, Ha, 0.2)
    rr = [(ac[0] - (ar + 0.35) * math.cos(math.pi * i / 4), ac[1] + (ar + 0.35) * math.sin(math.pi * i / 4)) for i in range(5)]
    for i in range(4):
        a, b = rr[i], rr[i + 1]
        mx, mz = (a[0] + b[0]) / 2 - ac[0], (a[1] + b[1]) / 2 - ac[1]
        g.face([(a[0], Ha - 0.2, a[1]), (b[0], Ha - 0.2, b[1]), (ac[0], Ha + 2.2, ac[1] + 0.001)], SLATE, out=(mx, 1, mz))
    # the gable wall over the apse roof (the hall's back gable)
    Wbk = Wall(g, (x0, z1), (x1, z1), (0, 1), Ha - 0.2, H)
    Wbk.build()
    g.face([(x0, H, z1), (x1, H, z1), (xm, yr, z1)], BRICK, out=(0, 0, 1))
    SOOT_LINES.append((H - 0.3, 1.5))


def lathe_bell(g, c):
    prof = [(0.0, 0.42), (0.1, 0.42), (0.14, 0.3), (0.17, 0.1), (0.26, 0.0)]
    n = 10
    for (r0, y0), (r1, y1) in zip(prof, prof[1:]):
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            q = [(c[0] + r0 * math.cos(a0), c[1] + y0, c[2] + r0 * math.sin(a0)), (c[0] + r0 * math.cos(a1), c[1] + y0, c[2] + r0 * math.sin(a1)),
                 (c[0] + r1 * math.cos(a1), c[1] + y1, c[2] + r1 * math.sin(a1)), (c[0] + r1 * math.cos(a0), c[1] + y1, c[2] + r1 * math.sin(a0))]
            am = (a0 + a1) / 2
            g.face(q, IRON, out=(math.cos(am), 0.4, math.sin(am)), k=1.3)


def yard(g):
    """The exercise yard: the ring of flagstones the prisoners walk, the warder's stand in the middle with its
    wooden shelter, a bench by the wall, the lanterns; the governor's garden wall."""
    g.grp = "prison_yard"
    rg = L("ring")
    c = (rg["x"], rg["z"])
    n = 32
    y = 0.05
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        pts = [(c[0] + rg["r_in"] * math.cos(a0), y, c[1] + rg["r_in"] * math.sin(a0)), (c[0] + rg["r_out"] * math.cos(a0), y, c[1] + rg["r_out"] * math.sin(a0)),
               (c[0] + rg["r_out"] * math.cos(a1), y, c[1] + rg["r_out"] * math.sin(a1)), (c[0] + rg["r_in"] * math.cos(a1), y, c[1] + rg["r_in"] * math.sin(a1))]
        g.face(pts, FLAGS, out=(0, 1, 0), k=0.95 if i % 2 else 1.0)
        # the edges (0.05 high)
        for rr_, s_ in ((rg["r_out"], 1), (rg["r_in"], -1)):
            g.face([(c[0] + rr_ * math.cos(a0), -0.05, c[1] + rr_ * math.sin(a0)), (c[0] + rr_ * math.cos(a1), -0.05, c[1] + rr_ * math.sin(a1)),
                    (c[0] + rr_ * math.cos(a1), y, c[1] + rr_ * math.sin(a1)), (c[0] + rr_ * math.cos(a0), y, c[1] + rr_ * math.sin(a0))], BLUE,
                   out=(s_ * math.cos((a0 + a1) / 2), 0, s_ * math.sin((a0 + a1) / 2)), k=0.7)
    # the warder's stand: a round stone step and a wooden shelter open to the ring
    prism(g, ngon(c, 1.1, 12), -0.05, 0.3, BLUE)
    sx, sz = c
    for (a, b) in (((sx - 0.5, sz - 0.5), (sx + 0.5, sz - 0.5)), ((sx + 0.5, sz - 0.5), (sx + 0.5, sz + 0.2)), ((sx - 0.5, sz + 0.2), (sx - 0.5, sz - 0.5))):
        mx, mz = (a[0] + b[0]) / 2 - sx, (a[1] + b[1]) / 2 - sz + 0.15
        for s_ in (1, -1):
            g.face([(a[0], 0.3, a[1]), (b[0], 0.3, b[1]), (b[0], 2.4, b[1]), (a[0], 2.4, a[1])], WOOD, out=(s_ * mx, 0, s_ * mz), k=1.0 if s_ > 0 else 0.6)
    gable_roof(g, sx - 0.6, sx + 0.6, sz - 0.62, sz + 0.32, 2.4, "z", pitch=40, oe=0.12, og=0.12, t=0.06, caps=(True, True), gable_mat=WOOD)
    # a bench against the front wall, and a water butt by the yard door
    fr = L("front")
    bz = COMP["z0"] + WALL_T + 0.35
    for bx0 in (fr["x1"] + 3.0, fr["x1"] + 9.0):
        box(g, bx0, bx0 + 2.0, 0.42, 0.48, bz - 0.2, bz + 0.2, WOOD)
        for lx in (bx0 + 0.15, bx0 + 1.75):
            box(g, lx, lx + 0.1, 0.02, 0.42, bz - 0.18, bz + 0.18, WOOD)
    yd = L("yard_door")
    wa = L("wingA")
    prism(g, ngon((yd["x"] + 2.3, wa["z0"] - 0.5), 0.4, 10), 0.02, 0.95, WOOD)
    prism(g, ngon((yd["x"] + 2.3, wa["z0"] - 0.5), 0.44, 10), 0.3, 0.36, IRON, top=False, bottom=True)
    prism(g, ngon((yd["x"] + 2.3, wa["z0"] - 0.5), 0.44, 10), 0.75, 0.81, IRON, top=False, bottom=True)
    # the governor's garden wall (from the house's back corner to wing B, low, with a door)
    gv = L("governor")
    wb = L("wingB")
    Wg = Wall(g, (gv["x1"], gv["z1"] + 0.2), (gv["x1"], wb["z0"] - 0.05), (1, 0), FOOT, 2.4)
    Wg.build([Hc(Wg.L / 2, 1.0, 0.0, 2.0, depth=0.3, cell="door_side", sill=False)])
    Wg2 = Wall(g, (gv["x1"] - 0.3, wb["z0"] - 0.05), (gv["x1"] - 0.3, gv["z1"] + 0.2), (-1, 0), FOOT, 2.4)
    Wg2.build([Hc(Wg2.L / 2, 1.0, 0.0, 2.0, depth=0.0, cell="door_side", sill=False)])
    g.face([(gv["x1"] - 0.35, 2.4, gv["z1"] + 0.2), (gv["x1"] + 0.05, 2.4, gv["z1"] + 0.2), (gv["x1"] + 0.05, 2.4, wb["z0"] - 0.05), (gv["x1"] - 0.35, 2.4, wb["z0"] - 0.05)], BLUE, out=(0, 1, 0))


def exterior_lanterns(g):
    """Lanterns on the buildings round the court (lit at night): the pavilion, the chapel door, the link."""
    g.grp = "prison_yard"
    lk = L("link")
    for s_ in (-1, 1):
        lantern(g, s_ * (lk["x1"] + 0.02), 3.2, (lk["z0"] + lk["z1"]) / 2, s_, 0.0, 0.45)
    cp = L("chapel")
    lantern(g, (cp["x0"] + cp["x1"]) / 2 + 1.1, 3.0, cp["z0"] - 0.02, 0.0, -1.0, 0.4)


# ------------------------------------------------------------------ export, check


# ------------------------------------------------------------------ live clock hands

# Every clock in the game shows the game's time (Steve, 2026-09-26): the dials are painted without hands, and
# the game hangs live hands (client/src/world/clockHands.ts) on an empty named clock_face_<name> at the middle
# of each face: `radius` the face's radius, nx/ny/nz out of the face (game axes), minute/hour/width the hands
# as parts of the radius (the painted marks stand at about 0.69 of it).
CLOCK_MARKS = []


def clock_mark(name, p, out, r, minute=0.64, hour=0.43, width=0.14):
    CLOCK_MARKS.append((name, p, out, r, minute, hour, width))


def clock_markers():
    for name, p, out, r, minute, hour, width in CLOCK_MARKS:
        ob = bpy.data.objects.new("clock_face_" + name, None)
        ob.empty_display_size = r
        ob.location = B(p)
        ob["radius"], ob["minute"], ob["hour"], ob["width"] = float(r), float(minute), float(hour), float(width)
        ob["nx"], ob["ny"], ob["nz"] = float(out[0]), float(out[1]), float(out[2])
        bpy.context.scene.collection.objects.link(ob)
    return len(CLOCK_MARKS)


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=20, export_draco_texcoord_quantization=16,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def clip_half(poly, f):
    """The part of a polygon where f(p) >= 0 (f linear along edges)."""
    out = []
    n = len(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        fp, fq = f(p), f(q)
        if fp >= 0:
            out.append(p)
        if (fp >= 0) != (fq >= 0) and abs(fp - fq) > 1e-12:
            t = fp / (fp - fq)
            out.append(tuple(a + (b - a) * t for a, b in zip(p, q)))
    return out


def area2(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


def tri_overlap(A, Bt):
    """Area of the overlap of two triangles in 2D (convex clip)."""
    poly = list(A)
    sgn = 1 if area2(Bt) > 0 else -1
    for i in range(3):
        a, b = Bt[i], Bt[(i + 1) % 3]
        ex, ez = b[0] - a[0], b[1] - a[1]
        poly = clip_half(poly, lambda q, a=a, ex=ex, ez=ez: sgn * (ex * (q[1] - a[1]) - ez * (q[0] - a[0])))
        if len(poly) < 3:
            return 0.0
    return abs(area2(poly))


def plane_check(path):
    """Pairs of triangles of the exported file facing the same way in one plane (or within 2 cm) that overlap by
    more than 20 cm2 (they would flicker), and faces flat at y 0 (the game's ground)."""
    import bisect
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    T = []
    for ob in bpy.context.scene.objects:
        if ob.type != "MESH":
            continue
        me = ob.data
        me.calc_loop_triangles()
        Mw = ob.matrix_world
        vs = [Mw @ v.co for v in me.vertices]
        for lt in me.loop_triangles:
            p = [Vector((vs[i].x, vs[i].z, -vs[i].y)) for i in lt.vertices]
            nrm = (p[1] - p[0]).cross(p[2] - p[0])
            if nrm.length < 1e-9:
                continue
            nrm.normalize()
            T.append((p, nrm, nrm.dot(p[0]), ob.name))
    bins = {}
    for i, (p, nrm, d, _o) in enumerate(T):
        bins.setdefault((round(nrm.x * 30), round(nrm.y * 30), round(nrm.z * 30)), []).append(i)
    fights = []
    for key, idx in bins.items():
        idx = sorted(idx, key=lambda i: T[i][2])
        ds = [T[i][2] for i in idx]
        for a_, i in enumerate(idx):
            p, nrm, d, _o = T[i]
            mn = [min(v[c] for v in p) for c in range(3)]
            mx = [max(v[c] for v in p) for c in range(3)]
            hi = bisect.bisect_right(ds, d + 0.02)
            for j in idx[a_ + 1:hi]:
                q, m, e, _o2 = T[j]
                if nrm.dot(m) < 0.9995:
                    continue
                if any(max(v[c] for v in q) < mn[c] - 0.01 or min(v[c] for v in q) > mx[c] + 0.01 for c in range(3)):
                    continue
                u = nrm.orthogonal().normalized()
                w = nrm.cross(u)
                ov = tri_overlap([(v.dot(u), v.dot(w)) for v in p], [(v.dot(u), v.dot(w)) for v in q])
                if ov > 0.002:
                    fights.append((round(ov, 3), round(abs(e - d), 3), tuple(round(c, 2) for c in (sum(p, Vector()) / 3)), T[i][3], T[j][3]))
    flat0 = [t for t in T if abs(t[1].y) > 0.99 and all(abs(v.y) < 0.005 for v in t[0])]
    print(f"[build_prison] plane check: {len(T)} triangles, {len(fights)} overlapping pairs in one plane or within 2 cm, {len(flat0)} faces flat at y 0")
    from collections import Counter
    print("    by part and plane:", Counter((it[3], it[4], round(it[2][1]), ) for it in fights).most_common(25))
    for it in sorted(fights, key=lambda x: -x[0])[:30]:
        print("   ", it)
    for t in flat0[:8]:
        print("    flat at y 0:", t[3], [tuple(round(c, 2) for c in v) for v in t[0]])


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    random.seed(1855)
    make_materials()
    g = Geo()
    outer_wall(g)
    front_building(g)
    governor_house(g)
    link_block(g)
    pavilion(g)
    wing(g, "wingA")
    wing(g, "wingB")
    chapel(g)
    yard(g)
    exterior_lanterns(g)
    objs = g.to_objects()
    print(f"[build_prison] {clock_markers()} clock faces for live hands")
    export()
    total = 0
    for nme in sorted(objs):
        c = tris(objs[nme])
        total += c
        print(f"[build_prison] {nme:18s} {c:6d} tris  [{', '.join(m.name for m in objs[nme].data.materials)}]")
    print(f"[build_prison] {len(objs)} objects, {total} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--nocheck" not in argv:
        plane_check(OUT)


if __name__ == "__main__":
    main()
