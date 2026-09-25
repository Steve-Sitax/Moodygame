"""The town wall of Antwerp, 1873, modelled and painted by this script: the curtain walls, the
bastions, the small guard towers with their guard houses, the four gates with their stone bridges
over the moat, and the stairs up to the walk.

    blender -b --factory-startup -P tools/blender/build_wall.py
    blender -b --factory-startup -P tools/blender/build_wall.py -- --preview

Reads decor.rampart and decor.rampart_solids of shared/city.json (tools/city/rampart.py makes them;
its docstring says what each field means) and writes client/public/models/wall.glb (Draco). No
layout number lives here: the rings, bands, towers, huts, gates, bridges and stairs all come from
the JSON. The numbers below are the look (heights of parapets, the plinth, the gate towers).

Frame: a game point (x, y, z) sits at Blender (x, -z, y). The glTF export turns Blender Z-up into
Y-up, so the glb loads in game coordinates; every object has its origin at the world origin and
the game adds the scene as it is.

Objects:
  wall_chunk_<n>   the static wall cut into 100 m cells (walls, walk, parapets, towers, huts,
                   bastions, turrets, stairs), so the game can cull them
  gate_<id>        one gate house with its bridge over the moat
Materials (a small texture each, painted below, nearest filter; vertex colour "Col" carries the
shade, darker at the foot, under water and inside the arch):
  wall_brick, wall_quoin (brick with the pale corner stones), wall_plinth (grey stone), wall_stone
  (pale dressed stone: coping, voussoirs, treads), wall_cobble (the walk), wall_slate, wall_wood,
  wall_iron, wall_window, wall_grass, wall_arms (the lion shield), wall_lamp_glow (lantern glass:
  the game draws it bright).

What the game walks on and bumps into: the walk top is at h, the stair treads follow the line from
a (y 0) to b (y h), the landings are at h, the gate passage floor and the bridge decks are 2 cm over
the street (y 0.02), so they never fight the game's own ground. Every parapet, railing, guard house
and gate tower stands inside decor.rampart_solids.

--preview renders data/shots/wall_preview_*.png (a gate from the field, the walk, a stair, a
bastion from above, the whole ring) and close-ups of the joins (wall_close_*.png).
"""

import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boats as bb  # noqa: E402  (preview: aim, render)
import build_props as bp  # noqa: E402  (ROOT, speckle)

ROOT = bp.ROOT
CITY = os.path.join(ROOT, "shared", "city.json")
OUT = os.path.join(ROOT, "client", "public", "models", "wall.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

MATS = ["wall_brick", "wall_quoin", "wall_plinth", "wall_stone", "wall_cobble", "wall_slate", "wall_wood",
        "wall_iron", "wall_window", "wall_grass", "wall_arms", "wall_lamp_glow"]
BRICK, QUOIN, PLINTH, STONE, COBBLE, SLATE, WOOD, IRON, WINDOW, GRASS, ARMS, GLOW = range(len(MATS))
# metres per texture repeat (u, v). Brick and quoin share one pixel size (53 px to the metre), so
# the courses run on from the brick into the corner stones
TILE = {BRICK: (2.4, 1.8), QUOIN: (1.2, 1.8), PLINTH: (2.4, 2.4), STONE: (1.2, 1.2), COBBLE: (1.6, 1.6),
        SLATE: (1.2, 1.2), WOOD: (1.2, 1.2), IRON: (1.0, 1.0), WINDOW: (1.0, 1.0), GRASS: (3.0, 3.0),
        ARMS: (1.0, 1.0), GLOW: (1.0, 1.0)}
QW = 1.2  # the quoin strip at a corner (the width of its texture)

# ---- the look (not the layout)
BATTER = 0.15  # the field face leans back this much from the foot to the walk
PL = 1.8  # the grey stone plinth
FOOT_LAND, FOOT_RIVER = -0.6, -4.0  # the foot of the wall under the ground, under the river bed
SEG = 4.0  # longest face along the wall (the game's textures swim on big faces)
GRID = 4.0  # the walk is cut on this grid
LIFT = 0.02  # passage floor and bridge deck over the game's ground
CHUNK = 100.0
TOWN_H, TOWN_T = 1.0, 0.42  # the parapet on the town side (height, thickness)
BW_O, BW_T = BATTER, 0.5  # the breastwork on the field side: its outer face, thickness
BW_H, EMB_Y0, EMB_Y1 = 1.3, 0.72, 1.12  # its height, the embrasures' sill and head
EMB_W, EMB_STEP = 0.5, 4.0
HIN = 0.12  # a guard house stands this far inside its rect
HUT_WALL, HUT_RISE, HUT_WT = 2.7, 2.1, 0.28
SPR = 3.3  # the gate arch springs here
TOWER_UP, ROOF_RISE = 6.0, 4.6  # gate towers rise this far over the walk; their roofs
MID_UP, FR_UP = 1.0, 1.9  # the middle over the passage (town side); the frontispiece's cornice
STEP_RISE = 0.18  # about: the stairs have round(h / 0.18) steps (36)


# ------------------------------------------------------------------ small helpers


def sm(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def B(p):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return Vector((p[0], -p[2], p[1]))


def tint(x, z):
    return 0.94 + 0.06 * math.sin(x * 0.11 + 1.3 * math.cos(z * 0.07)) * math.cos(z * 0.13 - x * 0.03)


def amb(p, floor):
    """Darker at the foot of a thing (its floor), dark and wet under the ground or the water."""
    dy = p[1] - floor
    s = 0.52 if dy < 0 else 0.62 + 0.38 * sm(dy / 1.8)
    return s * tint(p[0], p[2])


def newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def complement(cuts, L):
    cuts = sorted((max(0.0, a), min(L, b)) for a, b in cuts if b > 0 and a < L)
    out, cur = [], 0.0
    for a, b in cuts:
        if a > cur + 1e-6:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < L - 1e-6:
        out.append((cur, L))
    return out


def inside(p, ring):
    x, z = p
    c = False
    n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < x1 + (z - z1) * (x2 - x1) / (z2 - z1):
            c = not c
    return c


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-12)))
    return (a + ab * t - p).length


def splits(a, b, step):
    n = max(1, math.ceil((b - a) / step - 1e-9))
    return [a + (b - a) * k / n for k in range(n + 1)]


# ------------------------------------------------------------------ textures


def noise2(rng, h, w, cv, cu):
    """Tileable value noise, h x w, cv x cu cells."""
    g = rng.random((cv, cu))

    def axis(n, c):
        t = np.arange(n) * c / n
        i0 = np.floor(t).astype(int) % c
        f = t - np.floor(t)
        return i0, (i0 + 1) % c, f * f * (3 - 2 * f)

    v0, v1, fv = axis(h, cv)
    u0, u1, fu = axis(w, cu)
    fu, fv = fu[None, :], fv[:, None]
    return ((g[np.ix_(v0, u0)] * (1 - fu) + g[np.ix_(v0, u1)] * fu) * (1 - fv)
            + (g[np.ix_(v1, u0)] * (1 - fu) + g[np.ix_(v1, u1)] * fu) * fv)


def C(*rgb):
    return np.array(rgb, dtype=np.float64)


# rows of the arrays run from the bottom of the picture (v = 0) up


def paint_brick(rng, w=128, h=96, px=4, blen=16):
    """Red brick in stretcher bond: 4 px courses (7.5 cm), 16 px bricks, grey lime mortar."""
    img = np.empty((h, w, 3))
    img[:] = C(0.50, 0.47, 0.42)
    for c in range(h // px):
        off = (c % 2) * (blen // 2)
        for b in range(w // blen + 1):
            u0 = b * blen + off
            r = rng.random()
            if r < 0.09:
                col = C(0.33, 0.16, 0.14) * rng.uniform(0.9, 1.1)  # an over-burnt brick
            elif r < 0.15:
                col = C(0.62, 0.35, 0.23)  # a pale one
            else:
                col = C(0.53, 0.25, 0.18) * rng.uniform(0.84, 1.1)
            for u in range(u0 + 1, u0 + blen):
                img[c * px + 1:(c + 1) * px, u % w] = col
    img *= (0.91 + 0.14 * noise2(rng, h, w, 6, 8))[..., None]
    return bp.speckle(img, rng, 0.06, 0.85, 0.95)


def paint_quoin(rng):
    """The brick at a corner with its quoins: a long stone (0.8 m) over a short one (0.45 m), each
    six courses high; u = 0 is the corner."""
    img = paint_brick(rng, 64, 96)
    stone = C(0.71, 0.67, 0.58)
    for k in range(4):
        v0 = k * 24
        wl = 43 if k % 2 == 0 else 24
        tone = rng.uniform(0.92, 1.05)
        blk = np.broadcast_to(stone * tone, (24, wl, 3)).copy()
        blk *= (0.9 + 0.16 * rng.random((24, wl, 1)))
        blk[0, :] = stone * 0.6
        blk[:, wl - 1] = stone * 0.6
        blk[1, :wl - 1] *= 0.9
        img[v0:v0 + 24, 0:wl] = blk
    return img


def paint_ashlar(rng, n, base, joint, course, lo=18, hi=34):
    """Stone blocks in courses; each course cut at random lengths, all wrapping round."""
    img = np.empty((n, n, 3))
    for r in range(n // course):
        cuts, u = [], int(rng.integers(0, n))
        start = u
        while True:
            cuts.append(u)
            u += int(rng.integers(lo, hi))
            if u >= start + n - lo // 2:
                break
        for i, c0 in enumerate(cuts):
            c1 = cuts[i + 1] if i + 1 < len(cuts) else start + n
            col = base * rng.uniform(0.86, 1.1)
            for uu in range(c0, c1):
                img[r * course:(r + 1) * course, uu % n] = col
            img[r * course:(r + 1) * course, c0 % n] = joint
        img[r * course] = joint
    img *= (0.92 + 0.12 * noise2(rng, n, n, 8, 8))[..., None]
    return bp.speckle(img, rng, 0.08, 0.85, 1.08)


def paint_cobble(rng, n=64):
    """Grey and brown setts in rows, dark gaps (the walk and the decks)."""
    img = np.empty((n, n, 3))
    img[:] = C(0.24, 0.23, 0.21)
    pal = [C(0.42, 0.40, 0.37), C(0.37, 0.36, 0.35), C(0.44, 0.40, 0.34), C(0.36, 0.37, 0.39), C(0.46, 0.44, 0.40)]
    for r in range(n // 8):
        u = int(rng.integers(0, 8))
        start = u
        while u < start + n:
            wd = int(rng.integers(6, 10))
            col = pal[int(rng.integers(0, len(pal)))] * rng.uniform(0.85, 1.1)
            for uu in range(u + 1, u + wd):
                for vv in range(r * 8 + 1, r * 8 + 7):
                    corner = (uu == u + 1 or uu == u + wd - 1) and (vv == r * 8 + 1 or vv == r * 8 + 6)
                    if not corner:
                        img[vv % n, uu % n] = col * (1.08 if vv > r * 8 + 4 else 1.0)
            u += wd
    img *= (0.88 + 0.2 * noise2(rng, n, n, 4, 4))[..., None]
    return img


def paint_slate(rng, n=64):
    img = np.empty((n, n, 3))
    for r in range(n // 8):
        off = (r % 2) * 4
        for c in range(n // 8 + 1):
            col = C(0.20, 0.22, 0.27) * rng.uniform(0.82, 1.15)
            if rng.random() < 0.1:
                col = C(0.29, 0.31, 0.35)
            for u in range(c * 8 + off, c * 8 + off + 8):
                img[r * 8:(r + 1) * 8, u % n] = col
            img[r * 8:(r + 1) * 8, (c * 8 + off) % n] = col * 0.6
        img[r * 8] *= 0.5  # the shadow of the course above
    img *= (0.9 + 0.16 * noise2(rng, n, n, 8, 8))[..., None]
    return img


def paint_wood(rng, n=64):
    """Upright planks with two iron straps and nails (doors, benches, the sentry box)."""
    img = np.empty((n, n, 3))
    grain = noise2(rng, n, n, 16, 3)
    for p in range(n // 8):
        col = C(0.30, 0.20, 0.12) * rng.uniform(0.8, 1.12)
        img[:, p * 8:(p + 1) * 8] = col
        img[:, p * 8] = col * 0.45
    img *= (0.8 + 0.35 * grain)[..., None]
    for v0 in (10, 50):
        img[v0:v0 + 4] = C(0.10, 0.10, 0.11)
        img[v0 + 1:v0 + 3, 4::8] = C(0.3, 0.29, 0.27)
    return img


def paint_iron(rng, n=16):
    img = np.ones((n, n, 3)) * C(0.10, 0.10, 0.11)
    return img * (0.85 + 0.3 * rng.random((n, n, 1)))


def paint_window(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.68, 0.64, 0.55)
    img *= (0.9 + 0.15 * rng.random((n, n, 1)))
    g = np.ones((n - 8, n - 8, 3)) * C(0.06, 0.07, 0.09)
    g[rng.random((n - 8, n - 8)) < 0.05] = C(0.2, 0.22, 0.25)
    img[4:n - 4, 4:n - 4] = g
    img[4:n - 4, n // 2] = C(0.12, 0.11, 0.1)
    img[n // 2, 4:n - 4] = C(0.12, 0.11, 0.1)
    img[1:4, 2:n - 2] = C(0.75, 0.71, 0.62)  # the sill
    return img


def paint_grass(rng, n=64):
    img = np.ones((n, n, 3)) * C(0.25, 0.29, 0.13)
    img *= (0.75 + 0.45 * noise2(rng, n, n, 4, 4))[..., None]
    img *= (0.85 + 0.25 * noise2(rng, n, n, 16, 16))[..., None]
    m = rng.random((n, n))
    img[m < 0.03] = C(0.55, 0.50, 0.22)
    img[(m > 0.03) & (m < 0.08)] *= 0.6
    return img


LION = [  # a lion rampant, facing left, drawn top down (the arms of Brabant)
    "......XX........",
    ".....XXXX.......",
    "....XXXXXX.X....",
    "...X.XXXXXXX....",
    ".....XXXXXX.....",
    "......XXXX......",
    ".....XXXXXX..X..",
    "....XX.XXXXX.X..",
    "...XX..XXXXXXX..",
    ".......XXXXXX...",
    "......XXXXXX....",
    ".....XXX..XX....",
    "....XX.....XX...",
    "...XX.......XX..",
]


def paint_arms(rng, n=64):
    """The frontispiece's panel: a stone frame round a shield with the lion."""
    img = np.ones((n, n, 3)) * C(0.66, 0.62, 0.54)
    img *= (0.9 + 0.14 * rng.random((n, n, 1)))
    img[2:4, 2:n - 2] = img[n - 4:n - 2, 2:n - 2] = C(0.45, 0.42, 0.37)
    img[2:n - 2, 2:4] = img[2:n - 2, n - 4:n - 2] = C(0.45, 0.42, 0.37)
    top = np.zeros((n, n), bool)  # drawn top down, flipped at the end
    yy, xx = np.mgrid[0:n, 0:n]
    shield = ((np.abs(xx - 31.5) < 17) & (yy > 9) & (yy < 38)) | ((yy >= 38) & (np.abs(xx - 31.5) < 17 - (yy - 38) * 0.85))
    top |= shield
    pic = np.zeros((n, n, 3))
    pic[shield] = C(0.58, 0.55, 0.48)
    edge = shield & ~(np.roll(shield, 2, 0) & np.roll(shield, -2, 0) & np.roll(shield, 2, 1) & np.roll(shield, -2, 1))
    pic[edge] = C(0.78, 0.74, 0.65)
    for r, row in enumerate(LION):
        for c, ch in enumerate(row):
            if ch == "X":
                pic[14 + 2 * r:16 + 2 * r, 16 + 2 * c:18 + 2 * c] = C(0.36, 0.34, 0.30)
    pic = np.flipud(pic)
    top = np.flipud(top)
    img[top] = pic[top]
    return img


def paint_glow(rng, n=16):
    img = np.ones((n, n, 3)) * C(1.0, 0.84, 0.5)
    yy, xx = np.mgrid[0:n, 0:n]
    img *= (1.0 - 0.25 * (np.hypot(xx - 7.5, yy - 7.5) / 8))[..., None]
    img[0, :] = img[-1, :] = img[:, 0] = img[:, -1] = C(0.12, 0.11, 0.1)
    img[:, n // 2] = C(0.2, 0.18, 0.14)
    return img


def make_materials():
    rng = np.random.default_rng(1873)
    paint = {
        "wall_brick": lambda: paint_brick(rng),
        "wall_quoin": lambda: paint_quoin(rng),
        "wall_plinth": lambda: paint_ashlar(rng, 64, C(0.40, 0.41, 0.43), C(0.22, 0.22, 0.23), 16, 18, 34),
        "wall_stone": lambda: paint_ashlar(rng, 64, C(0.70, 0.66, 0.57), C(0.50, 0.47, 0.41), 16, 24, 40),
        "wall_cobble": lambda: paint_cobble(rng),
        "wall_slate": lambda: paint_slate(rng),
        "wall_wood": lambda: paint_wood(rng),
        "wall_iron": lambda: paint_iron(rng),
        "wall_window": lambda: paint_window(rng),
        "wall_grass": lambda: paint_grass(rng),
        "wall_arms": lambda: paint_arms(rng),
        "wall_lamp_glow": lambda: paint_glow(rng),
    }
    for name in MATS:
        arr = np.clip(paint[name](), 0, 1)
        h, w, _ = arr.shape
        img = bpy.data.images.new(name + "_tex", w, h, alpha=False)
        rgba = np.ones((h, w, 4), dtype=np.float32)
        rgba[..., :3] = arr
        img.pixels.foreach_set(rgba.ravel())
        img.pack()
        m = bpy.data.materials.new(name)
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
        m.use_backface_culling = True


# ------------------------------------------------------------------ geometry store


class Geo:
    """Faces in game coordinates, grouped into objects (100 m cells, or a gate)."""

    def __init__(self):
        self.groups = {}
        self.grp = None

    def face(self, pts, mat, out=None, uvs=None, shade=None, floor=0.0, k=1.0):
        pts = [Vector(p) for p in pts]
        n = newell(pts)
        if n.length < 1e-9:
            return
        if out is not None and n.dot(Vector(out)) < 0:
            pts.reverse()
            n = -n
            if uvs:
                uvs = list(reversed(uvs))
        n.normalize()
        if uvs is None:
            uvs = planar(pts, n, mat)
        if shade is None:
            cols = [amb(p, floor) * k for p in pts]
        elif callable(shade):
            cols = [shade(p) * k for p in pts]
        else:
            cols = [shade * k * tint(p.x, p.z) for p in pts]
        grp = self.grp
        if grp is None:
            c = sum(pts, Vector()) / len(pts)
            grp = ("chunk", math.floor(c.x / CHUNK), math.floor(c.z / CHUNK))
        self.groups.setdefault(grp, []).append((pts, uvs, cols, mat))

    def to_objects(self, gate_ids):
        objs = {}
        chunks = sorted(k for k in self.groups if k[0] == "chunk")
        names = {k: f"wall_chunk_{i}" for i, k in enumerate(chunks)}
        for k in self.groups:
            if k[0] == "gate":
                names[k] = f"gate_{k[1]}"
        for k, faces in self.groups.items():
            name = names[k]
            bm = bmesh.new()
            uvl = bm.loops.layers.uv.new("UVMap")
            col = bm.loops.layers.float_color.new("Col")
            for pts, uvs, cols, mat in faces:
                vs = [bm.verts.new(B(p)) for p in pts]
                try:
                    f = bm.faces.new(vs)
                except ValueError:
                    continue
                f.material_index = mat
                f.smooth = False
                for loop, uv, c in zip(f.loops, uvs, cols):
                    loop[uvl].uv = uv
                    c = min(1.0, max(0.0, c))
                    loop[col] = (c, c, c, 1.0)
            me = bpy.data.meshes.new(name)
            bm.to_mesh(me)
            bm.free()
            for mt in MATS:
                me.materials.append(bpy.data.materials[mt])
            try:
                me.color_attributes.active_color = me.color_attributes["Col"]
                me.color_attributes.render_color_index = me.color_attributes.active_color_index
            except (KeyError, AttributeError):
                pass
            ob = bpy.data.objects.new(name, me)
            bpy.context.scene.collection.objects.link(ob)
            objs[name] = ob
        return objs


def planar(pts, n, mat):
    tu, tv = TILE[mat]
    if abs(n.y) > 0.75:
        return [(p.x / tu, p.z / tv) for p in pts]
    hd = Vector((n.z, 0.0, -n.x)).normalized()
    w = n.cross(hd)
    return [(p.dot(hd) / tu, p.dot(w) / tv) for p in pts]


def fit_uvs(n):
    return [(0, 0), (1, 0), (1, 1), (0, 1)][:n]


# ------------------------------------------------------------------ solids in world space

HEX_FACES = {"-z": (0, 2, 3, 1), "+z": (4, 5, 7, 6), "-y": (0, 1, 5, 4), "+y": (2, 6, 7, 3), "-x": (0, 4, 6, 2), "+x": (1, 3, 7, 5)}


def solid8(g, P, mat, skip=(), **kw):
    """Six faces over 8 corners P[i] (bit 0, 1, 2 = the three axes), each looking away from the middle."""
    P = [Vector(p) for p in P]
    c = sum(P, Vector()) / 8
    for key, idx in HEX_FACES.items():
        if key in skip:
            continue
        pts = [P[i] for i in idx]
        fc = sum(pts, Vector()) / 4
        g.face(pts, mat, out=fc - c, **kw)


def bar(g, a, b, w, mat, h=None, **kw):
    """A square bar (iron, a beam) from a to b."""
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    s = t.cross(Vector((0, 1, 0)))
    if s.length < 1e-4:
        s = Vector((1, 0, 0))
    s.normalize()
    k = s.cross(t)
    h = w if h is None else h
    P = []
    for i in range(8):
        base = b if i & 2 else a
        P.append(base + s * (w / 2 if i & 1 else -w / 2) + k * (h / 2 if i & 4 else -h / 2))
    solid8(g, P, mat, **kw)


def lathe(g, c, prof, sides, mat, rot=0.0, **kw):
    """A turned shape about the vertical through c; prof = (r, dy) from the bottom up."""
    cx, cy, cz = c
    for j in range(len(prof) - 1):
        (r0, y0), (r1, y1) = prof[j], prof[j + 1]
        if r0 < 1e-6 and r1 < 1e-6:
            continue
        nr, ny = (y1 - y0), -(r1 - r0)
        ln = math.hypot(nr, ny) or 1.0
        nr, ny = nr / ln, ny / ln
        for i in range(sides):
            a0 = rot + 2 * math.pi * i / sides
            a1 = rot + 2 * math.pi * (i + 1) / sides
            am = (a0 + a1) / 2
            p = [(cx + r0 * math.cos(a0), cy + y0, cz + r0 * math.sin(a0)), (cx + r0 * math.cos(a1), cy + y0, cz + r0 * math.sin(a1)),
                 (cx + r1 * math.cos(a1), cy + y1, cz + r1 * math.sin(a1)), (cx + r1 * math.cos(a0), cy + y1, cz + r1 * math.sin(a0))]
            if r0 < 1e-6:
                p = [p[0], p[2], p[3]]
            elif r1 < 1e-6:
                p = [p[0], p[1], p[2]]
            out = (math.cos(am) * nr, ny, math.sin(am) * nr)
            g.face(p, mat, out=out, **kw)


def pyramid(g, base, apex, mat, bottom=True, **kw):
    """A roof: triangles from each edge of the base (world points at one height) to the apex."""
    base = [Vector(p) for p in base]
    apex = Vector(apex)
    c = sum(base, Vector()) / len(base)
    inner = c + (apex - c) * 0.25
    for i in range(len(base)):
        tri = [base[i], base[(i + 1) % len(base)], apex]
        fc = sum(tri, Vector()) / 3
        g.face(tri, mat, out=fc - inner, **kw)
    if bottom:
        g.face(base, mat, out=(0, -1, 0), **kw)


def finial(g, x, y, z, s=1.0, mat=IRON):
    prof = [(0.10, 0), (0.10, 0.06), (0.04, 0.10), (0.04, 0.22), (0.11, 0.30), (0.11, 0.42), (0.03, 0.50), (0.0, 0.85)]
    lathe(g, (x, y, z), [(r * s, dy * s) for r, dy in prof], 6, mat, shade=0.9)


def lantern(g, x, ytop, z, w=0.24, hh=0.36):
    """A square lantern hanging from (x, ytop, z): iron cap, glowing glass, iron base."""
    y1 = ytop - 0.1
    y0 = y1 - hh
    q = w / 2 + 0.04
    pyramid(g, [(x - q, y1, z - q), (x + q, y1, z - q), (x + q, y1, z + q), (x - q, y1, z + q)], (x, ytop + 0.06, z), IRON,
            shade=0.8)
    q = w / 2
    solid8(g, [(x + (q if i & 1 else -q), y0 if not i & 4 else y1, z + (q if i & 2 else -q)) for i in range(8)], GLOW,
           skip=("+z",), shade=1.0, uvs=None)
    q = w / 2 + 0.03
    solid8(g, [(x + (q if i & 1 else -q), y0 - 0.06 if not i & 4 else y0, z + (q if i & 2 else -q)) for i in range(8)], IRON,
           shade=0.8)


def wall_lantern(g, p, out, arm=0.5):
    """A lantern on an iron bracket from a wall point p (world), `out` the wall's normal (x, z)."""
    p = Vector(p)
    o = Vector((out[0], 0.0, out[1]))
    tip = p + o * arm
    bar(g, p, tip, 0.05, IRON, shade=0.8)
    bar(g, p - Vector((0, 0.35, 0)), p + o * (arm * 0.6), 0.04, IRON, shade=0.8)
    bar(g, tip, tip - Vector((0, 0.1, 0)), 0.03, IRON, shade=0.8)
    lantern(g, tip.x, p.y - 0.1, tip.z)


# ------------------------------------------------------------------ local frames


class Frame:
    """Local (a along, o out, y up) -> world; origin (x, z), ua and uo unit vectors in (x, z)."""

    def __init__(self, ox, oz, ua, uo):
        self.ox, self.oz = ox, oz
        self.ua, self.uo = ua, uo

    def p(self, a, o, y):
        return (self.ox + self.ua[0] * a + self.uo[0] * o, y, self.oz + self.ua[1] * a + self.uo[1] * o)

    def v(self, da, do, dy=0.0):
        return (self.ua[0] * da + self.uo[0] * do, dy, self.ua[1] * da + self.uo[1] * do)

    def loc(self, x, z):
        dx, dz = x - self.ox, z - self.oz
        return dx * self.ua[0] + dz * self.ua[1], dx * self.uo[0] + dz * self.uo[1]

    def box(self, g, a0, a1, o0, o1, y0, y1, mat, skip=(), **kw):
        a0, a1 = sorted((a0, a1))
        o0, o1 = sorted((o0, o1))
        P = [self.p(a1 if i & 1 else a0, o1 if i & 2 else o0, y1 if i & 4 else y0) for i in range(8)]
        # skip keys in local terms: -a +a -o +o -y +y
        m = {"-a": "-x", "+a": "+x", "-o": "-y", "+o": "+y", "-y": "-z", "+y": "+z"}
        solid8(g, P, mat, skip=tuple(m[s] for s in skip), **kw)

    def quad(self, g, pts, mat, out, **kw):
        g.face([self.p(*q) for q in pts], mat, out=self.v(*out), **kw)


class Panel:
    """A flat upright wall in a frame, from local (a, o) point A to B, looking along local `out`."""

    def __init__(self, g, F, A, B, out, uoff=0.0):
        self.g, self.F = g, F
        self.A, self.B = Vector(A), Vector(B)
        d = self.B - self.A
        self.L = d.length
        self.t = d / self.L
        self.n = Vector(out)
        self.uoff = uoff

    def pt(self, u, y, dep=0.0):
        q = self.A + self.t * u - self.n * dep
        return self.F.p(q.x, q.y, y)

    def outv(self, sgn=1.0):
        return self.F.v(self.n.x * sgn, self.n.y * sgn)

    def along(self, sgn=1.0):
        return self.F.v(self.t.x * sgn, self.t.y * sgn)

    def wall(self, y0, y1, mat, holes=(), quoin=(False, False), plinth=None, bands=(), floor=0.0, k=1.0, shade=None,
             seg=SEG, dep=0.0):
        L = self.L
        us, ys = {0.0, L}, {y0, y1}
        qz = []
        if quoin[0]:
            qz.append((0.0, min(QW, L / 2), 0))
        if quoin[1]:
            qz.append((max(L - QW, L / 2), L, 1))
        for a, b, _ in qz:
            us |= {a, b}
        for u0, u1, v0, v1 in holes:
            us |= {u0, u1}
            ys |= {v0, v1}
        if plinth is not None:
            ys.add(plinth)
        for b0, b1 in bands:
            ys |= {b0, b1}
        us = sorted(u for u in us if -1e-9 <= u <= L + 1e-9)
        ys = sorted(y for y in ys if y0 - 1e-9 <= y <= y1 + 1e-9)
        uu = []
        for a, b in zip(us, us[1:]):
            uu += splits(a, b, seg)[:-1]
        uu.append(us[-1])
        for ua, ub in zip(uu, uu[1:]):
            if ub - ua < 1e-5:
                continue
            mu = (ua + ub) / 2
            for va, vb in zip(ys, ys[1:]):
                if vb - va < 1e-5:
                    continue
                mv = (va + vb) / 2
                if any(h[0] <= mu <= h[1] and h[2] <= mv <= h[3] for h in holes):
                    continue
                m = mat
                if plinth is not None and mv < plinth:
                    m = PLINTH
                elif any(b0 <= mv <= b1 for b0, b1 in bands):
                    m = STONE
                zone = next((z for z in qz if z[0] - 1e-6 <= mu <= z[1] + 1e-6), None)
                if zone is not None and m == BRICK:
                    m = QUOIN
                    sh = 0.0 if zone[2] == 0 else 0.25
                    du = (lambda u: u / QW) if zone[2] == 0 else (lambda u: (L - u) / QW)
                    uvs = [(du(ua), va / 1.8 + sh), (du(ub), va / 1.8 + sh), (du(ub), vb / 1.8 + sh), (du(ua), vb / 1.8 + sh)]
                else:
                    tu, tv = TILE[m]
                    uvs = [((self.uoff + ua) / tu, va / tv), ((self.uoff + ub) / tu, va / tv),
                           ((self.uoff + ub) / tu, vb / tv), ((self.uoff + ua) / tu, vb / tv)]
                pts = [self.pt(ua, va, dep), self.pt(ub, va, dep), self.pt(ub, vb, dep), self.pt(ua, vb, dep)]
                self.g.face(pts, m, out=self.outv(), uvs=uvs, floor=floor, k=k, shade=shade)

    def reveal(self, u0, u1, y0, y1, depth, mat, back=None, sill=True, head=True, floor=0.0, k=1.0, shade=None, back_k=1.0):
        """The sides of a hole cut into the wall `depth` deep, and its back (a door, the dark) if given."""
        g, P = self.g, self.pt
        g.face([P(u0, y0), P(u0, y0, depth), P(u0, y1, depth), P(u0, y1)], mat, out=self.along(1), floor=floor, k=k, shade=shade)
        g.face([P(u1, y0), P(u1, y0, depth), P(u1, y1, depth), P(u1, y1)], mat, out=self.along(-1), floor=floor, k=k, shade=shade)
        if head:
            g.face([P(u0, y1), P(u1, y1), P(u1, y1, depth), P(u0, y1, depth)], mat, out=(0, -1, 0), floor=floor, k=k * 0.8,
                   shade=shade)
        if sill:
            g.face([P(u0, y0), P(u1, y0), P(u1, y0, depth), P(u0, y0, depth)], mat, out=(0, 1, 0), floor=floor, k=k, shade=shade)
        if back is not None:
            uvs = fit_uvs(4) if back in (WOOD, WINDOW, ARMS) else None
            g.face([P(u0, y0, depth), P(u1, y0, depth), P(u1, y1, depth), P(u0, y1, depth)], back, out=self.outv(), uvs=uvs,
                   floor=floor, k=back_k, shade=shade)

    def sheet(self, u0, u1, y0, y1, mat, dep=-0.03, **kw):
        """A picture on the wall (a window, a panel), `dep` in front of it (negative = proud)."""
        P = self.pt
        self.g.face([P(u0, y0, dep), P(u1, y0, dep), P(u1, y1, dep), P(u0, y1, dep)], mat, out=self.outv(), uvs=fit_uvs(4), **kw)


# ------------------------------------------------------------------ the layout


class Ctx:
    def __init__(self, D, solids):
        self.D = D
        self.h = D["h"]
        self.t = D["t"]
        self.band = D["parapet"]
        self.rail = D.get("rail", D["parapet"])
        self.solids = [[(float(x), float(z)) for x, z in s] for s in solids]
        self.sides = {}
        for side, (x0, z0, x1, z1) in D["bands"].items():
            along_z = (z1 - z0) > (x1 - x0)
            face = D["inner"][side]
            sgn = 1.0 if D["outer"][side] > face else -1.0
            self.sides[side] = (along_z, face, sgn)
        self.gate_rects = [g["house"] for g in D["gates"]]
        self.huts = [tuple(h) for h in D["huts"]]
        self.tower_huts = {tuple(t["hut"]): t for t in D["towers"]}
        self.land_bastions = []
        self.river_bastions = []
        for k, poly in D["bastions"].items():
            P = [Vector((x, z)) for x, z in poly]
            (self.land_bastions if min(p.y for p in P) >= -1e-6 else self.river_bastions).append((k, P))
        xs = [D["inner"][s] for s in D["inner"] if self.sides[s][0]]
        self.centre = Vector(((min(xs) + max(xs)) / 2, max(D["inner"][s] for s in D["inner"] if not self.sides[s][0]) / 2))

    def frame(self, side, at):
        along_z, face, sgn = self.sides[side]
        if along_z:
            return Frame(face, at, (0.0, 1.0), (sgn, 0.0))
        return Frame(at, face, (1.0, 0.0), (0.0, sgn))

    def kind(self, A, B):
        e = 1e-3
        for x0, z0, x1, z1 in self.gate_rects:
            for xl in (x0, x1):
                if abs(A.x - xl) < e and abs(B.x - xl) < e and z0 - e <= A.y <= z1 + e and z0 - e <= B.y <= z1 + e:
                    return "gate"
            for zl in (z0, z1):
                if abs(A.y - zl) < e and abs(B.y - zl) < e and x0 - e <= A.x <= x1 + e and x0 - e <= B.x <= x1 + e:
                    return "gate"
        for along_z, face, sgn in self.sides.values():
            if along_z and abs(A.x - face) < e and abs(B.x - face) < e:
                return "town"
            if not along_z and abs(A.y - face) < e and abs(B.y - face) < e:
                return "town"
        return "field"

    def in_solid(self, p):
        return any(inside(p, s) for s in self.solids)


class Edge:
    pass


def line_x(A1, t1, A2, t2):
    den = t1.x * t2.y - t1.y * t2.x
    if abs(den) < 1e-9:
        return None
    w = A2 - A1
    s = (w.x * t2.y - w.y * t2.x) / den
    return A1 + t1 * s


class Ring:
    """One outline of the walk (decor.rampart.tops): its edges, which side they face, their corners.
    Offsets d are measured inward from an edge (into the wall), so the field face is d = 0 at the
    foot and d = BATTER at the walk."""

    def __init__(self, ring, ctx):
        Q = []
        for x, z in ring:
            p = Vector((float(x), float(z)))
            if not Q or (p - Q[-1]).length > 1e-6:
                Q.append(p)
        if (Q[0] - Q[-1]).length < 1e-6:
            Q.pop()
        n = len(Q)
        area = sum(Q[i].x * Q[(i + 1) % n].y - Q[(i + 1) % n].x * Q[i].y for i in range(n)) / 2
        self.ccw = area > 0
        self.P = Q
        self.E = []
        u = 0.0
        for i in range(n):
            A, Bp = Q[i], Q[(i + 1) % n]
            e = Edge()
            e.A, e.B = A, Bp
            d = Bp - A
            e.L = d.length
            e.t = d / e.L
            e.n = Vector((-e.t.y, e.t.x)) if self.ccw else Vector((e.t.y, -e.t.x))
            e.kind = ctx.kind(A, Bp)
            e.river = max(A.y, Bp.y) <= 0.01
            e.u0 = u
            u += e.L
            self.E.append(e)
        for i in range(n):
            e0, e1 = self.E[i - 1], self.E[i]
            cr = e0.t.x * e1.t.y - e0.t.y * e1.t.x
            cvx = cr > 1e-6 if self.ccw else cr < -1e-6
            cvx = cvx and e0.kind == "field" and e1.kind == "field"  # no quoins where the wall meets a gate tower
            e1.cvx_a = cvx
            e0.cvx_b = cvx
        self.cache = {}

    def nd(self, f, d):
        return -0.05 if f.kind == "gate" else d

    def meet(self, i, j, di, dj):
        e, f = self.E[i % len(self.E)], self.E[j % len(self.E)]
        p = line_x(e.A + e.n * di, e.t, f.A + f.n * dj, f.t)
        return p if p is not None else e.B + e.n * di

    def ends(self, i, d):
        key = (i, round(d, 5))
        if key not in self.cache:
            n = len(self.E)
            e, pe, ne = self.E[i], self.E[i - 1], self.E[(i + 1) % n]
            self.cache[key] = (self.meet(i - 1, i, self.nd(pe, d), d), self.meet(i, i + 1, d, self.nd(ne, d)))
        return self.cache[key]

    def P3(self, i, s, d, y):
        """The point at s along edge i, d inside it, at height y: on the offset line, and at the
        mitred corner at either end (s = 0 or L)."""
        e = self.E[i]
        S, T = self.ends(i, d)
        if s <= 1e-6:
            q = S
        elif s >= e.L - 1e-6:
            q = T
        else:
            ss = min(max(s, (S - e.A).dot(e.t)), (T - e.A).dot(e.t))
            q = e.A + e.n * d + e.t * ss
        return (q.x, y, q.y)

    def sweep(self, g, i, prof, mats, ranges=None, floor=0.0, k=1.0, quoin=False):
        """Faces along edge i between profile points (d, y); mats per profile segment (None = none)."""
        e = self.E[i]
        L = e.L
        ranges = ranges if ranges is not None else [(0.0, L)]
        if not ranges:
            return
        br = {0.0, L}
        zs = []
        if quoin and e.kind == "field":
            if e.cvx_a:
                zs.append((0.0, min(QW, L / 2), 0))
            if e.cvx_b:
                zs.append((max(L - QW, L / 2), L, 1))
        for z0, z1, _ in zs:
            br |= {z0, z1}
        for r0, r1 in ranges:
            br |= {max(0.0, r0), min(L, r1)}
        br = sorted(b for b in br if -1e-9 <= b <= L + 1e-9)
        ss = []
        for a, b in zip(br, br[1:]):
            ss += splits(a, b, SEG)[:-1]
        ss.append(br[-1])
        for sa, sb in zip(ss, ss[1:]):
            if sb - sa < 1e-4:
                continue
            m = (sa + sb) / 2
            if not any(r0 - 1e-6 <= m <= r1 + 1e-6 for r0, r1 in ranges):
                continue
            zone = next((z for z in zs if z[0] - 1e-6 <= m <= z[1] + 1e-6), None)
            for kk in range(len(prof) - 1):
                mat = mats[kk]
                if mat is None:
                    continue
                (d0, y0), (d1, y1) = prof[kk], prof[kk + 1]
                q = [self.P3(i, sa, d0, y0), self.P3(i, sb, d0, y0), self.P3(i, sb, d1, y1), self.P3(i, sa, d1, y1)]
                nx, ny = (y1 - y0), (d1 - d0)
                ln = math.hypot(nx, ny)
                nx, ny = nx / ln, ny / ln
                out = (-e.n.x * nx, ny, -e.n.y * nx)
                mm = mat
                if zone is not None and mat == BRICK and nx > 0.5:
                    mm = QUOIN
                    sh = 0.0 if zone[2] == 0 else 0.25
                    du = (lambda s: s / QW) if zone[2] == 0 else (lambda s: (L - s) / QW)
                    uvs = [(du(sa), y0 / 1.8 + sh), (du(sb), y0 / 1.8 + sh), (du(sb), y1 / 1.8 + sh), (du(sa), y1 / 1.8 + sh)]
                else:
                    tu, tv = TILE[mat]
                    if abs(ny) > 0.7:
                        v0, v1 = d0 / tv, d1 / tv
                    else:
                        v0, v1 = y0 / tv, y1 / tv
                    uvs = [((e.u0 + sa) / tu, v0), ((e.u0 + sb) / tu, v0), ((e.u0 + sb) / tu, v1), ((e.u0 + sa) / tu, v1)]
                g.face(q, mm, out=out, uvs=uvs, floor=floor, k=k)

    def cap(self, g, i, s, poly, sgn, mat, floor=0.0):
        """The cut end of a sweep at s: its cross-section, looking along the edge (sgn +1) or back."""
        e = self.E[i]
        g.face([self.P3(i, s, d, y) for d, y in poly], mat, out=(e.t.x * sgn, 0, e.t.y * sgn), floor=floor)

    def solid_runs(self, i, d, ctx, pad=0.3):
        """Where along edge i the line d inside it lies in decor.rampart_solids."""
        e = self.E[i]
        A = e.A + e.n * d
        s_lo, s_hi = -pad, e.L + pad
        cuts = {s_lo, s_hi}
        for ring in ctx.solids:
            m = len(ring)
            for j in range(m):
                p1, p2 = Vector(ring[j]), Vector(ring[(j + 1) % m])
                w = p2 - p1
                den = e.t.x * w.y - e.t.y * w.x
                if abs(den) < 1e-12:
                    continue
                r = p1 - A
                s = (r.x * w.y - r.y * w.x) / den
                u = (r.x * e.t.y - r.y * e.t.x) / den
                if -1e-9 <= u <= 1 + 1e-9 and s_lo < s < s_hi:
                    cuts.add(s)
        cuts = sorted(cuts)
        runs = []
        for a, b in zip(cuts, cuts[1:]):
            if b - a < 1e-4:
                continue
            m = A + e.t * ((a + b) / 2)
            if ctx.in_solid((m.x, m.y)):
                if runs and abs(runs[-1][1] - a) < 1e-4:
                    runs[-1] = (runs[-1][0], b)
                else:
                    runs.append((a, b))
        return [(max(0.0, a), min(e.L, b)) for a, b in runs if b > 0 and a < e.L]


def bat(y, h):
    return BATTER * min(1.0, max(0.0, y / h))


# ------------------------------------------------------------------ the wall: body, walk, parapets


def build_ring(g, R, ctx):
    h = ctx.h
    n = len(R.E)
    for i, e in enumerate(R.E):
        if e.kind == "gate":
            continue
        foot = FOOT_RIVER if e.river else FOOT_LAND
        if e.kind == "field":
            yc = h - 0.3
            prof = [(0.0, foot), (0.0, 0.0), (bat(PL, h), PL), (bat(PL, h) + 0.05, PL + 0.06), (bat(yc, h) + 0.05, yc),
                    (bat(yc, h) - 0.08, yc), (bat(yc, h) - 0.08, h), (BATTER, h)]
        else:
            prof = [(0.0, foot), (0.0, 0.0), (0.0, PL), (0.04, PL + 0.05), (0.04, h - 0.25), (-0.05, h - 0.25), (-0.05, h),
                    (0.0, h)]
        R.sweep(g, i, prof, [PLINTH, PLINTH, STONE, BRICK, STONE, STONE, STONE], floor=0.0, quoin=True)

    # the walk: the outline, pulled in by the batter on the field side, cut on a grid
    def dw(e):
        return BATTER if e.kind == "field" else 0.0

    ring = [R.meet(i - 1, i, dw(R.E[i - 1]), dw(R.E[i])) for i in range(n)]
    for tri in fill_poly(ring, ctx.grass_cuts):
        c = sum(tri, Vector((0.0, 0.0))) / len(tri)
        mat = GRASS if grass_at(c, ctx) else COBBLE
        g.face([(p.x, h, p.y) for p in tri], mat, out=(0, 1, 0), floor=h - 1.0, k=0.95 if mat == COBBLE else 1.0)

    # the parapets: low on the town side, the breastwork with embrasures on the field side
    for i, e in enumerate(R.E):
        if e.kind == "gate":
            continue
        prv, nxt = R.E[i - 1], R.E[(i + 1) % n]
        if e.kind == "town":
            runs = R.solid_runs(i, TOWN_T / 2, ctx)
            keep = []
            for s0, s1 in runs:
                # a stone post where the parapet stops at a stair's head (not at a corner)
                a0 = s0 + (0.4 if s0 > 1e-3 else 0.0)
                b0 = s1 - (0.4 if s1 < e.L - 1e-3 else 0.0)
                for pa, pb in ((s0, a0), (b0, s1)):
                    if pb - pa > 0.1:
                        post(g, R, i, pa, pb, h)
                if b0 - a0 > 0.05:
                    keep.append((a0, b0))
            pb_ = h + TOWN_H - 0.15
            R.sweep(g, i, [(0.0, h), (0.0, pb_), (TOWN_T, pb_), (TOWN_T, h)], [BRICK, None, BRICK], keep, floor=h)
            cop = [(0.0, pb_), (-0.04, pb_), (-0.04, h + TOWN_H), (TOWN_T + 0.04, h + TOWN_H), (TOWN_T + 0.04, pb_), (TOWN_T, pb_)]
            R.sweep(g, i, cop, [STONE] * 5, keep, floor=h - 1.0)
            sec = [(0.0, h), (0.0, pb_), (-0.04, pb_), (-0.04, h + TOWN_H), (TOWN_T + 0.04, h + TOWN_H), (TOWN_T + 0.04, pb_),
                   (TOWN_T, pb_), (TOWN_T, h)]
            for a0, b0 in keep:
                if a0 > 1e-3:
                    R.cap(g, i, a0, sec, -1, STONE, floor=h)
                if b0 < e.L - 1e-3:
                    R.cap(g, i, b0, sec, 1, STONE, floor=h)
            if keep and keep[0][0] < 1e-3 and prv.kind == "field":
                R.cap(g, i, 0.0, sec, -1, BRICK, floor=h)
            if keep and keep[-1][1] > e.L - 1e-3 and nxt.kind == "field":
                R.cap(g, i, e.L, sec, 1, BRICK, floor=h)
        else:
            d_in = BW_O + BW_T
            runs = R.solid_runs(i, (BW_O + d_in) / 2, ctx)
            huts = hut_spans(R, i, ctx)
            keep = intersect(complement(huts, e.L), runs)
            embs = []
            if e.L >= 7.0:
                nemb = int((e.L - 3.0) / EMB_STEP)
                for kk in range(nemb):
                    s = e.L * (kk + 1) / (nemb + 1)
                    sp = (s - EMB_W / 2, s + EMB_W / 2)
                    if any(sp[0] < b + 0.6 and sp[1] > a - 0.6 for a, b in huts):
                        continue
                    if any(r0 + 0.8 <= sp[0] and sp[1] <= r1 - 0.8 for r0, r1 in keep):
                        embs.append(sp)
            y0, y1, yt = h + EMB_Y0, h + EMB_Y1, h + BW_H
            keep_up = intersect(keep, complement(embs, e.L))
            R.sweep(g, i, [(BW_O, h), (BW_O, y0), (d_in, y0), (d_in, h)], [BRICK, None, BRICK], keep, floor=h, quoin=True)
            R.sweep(g, i, [(BW_O, y0), (d_in, y0)], [STONE], embs, floor=h)
            R.sweep(g, i, [(BW_O, y0), (BW_O, y1), (d_in, y1), (d_in, y0)], [BRICK, None, BRICK], keep_up, floor=h, quoin=True)
            cop = [(BW_O, y1), (BW_O - 0.05, y1), (BW_O - 0.05, yt), (d_in, yt), (d_in, y1)]
            R.sweep(g, i, cop, [STONE] * 4, keep, floor=h - 1.0)
            R.sweep(g, i, [(d_in, y1), (BW_O, y1)], [STONE], embs, floor=h, k=0.7)
            jamb = [(BW_O, y0), (BW_O, y1), (d_in, y1), (d_in, y0)]
            for a, b in embs:
                R.cap(g, i, a, jamb, 1, STONE, floor=h)
                R.cap(g, i, b, jamb, -1, STONE, floor=h)
            sec = [(BW_O, h), (BW_O, y1), (BW_O - 0.05, y1), (BW_O - 0.05, yt), (d_in, yt), (d_in, h)]
            if keep and keep[0][0] < 1e-3 and prv.kind == "town":
                R.cap(g, i, 0.0, sec, -1, BRICK, floor=h)
            if keep and keep[-1][1] > e.L - 1e-3 and nxt.kind == "town":
                R.cap(g, i, e.L, sec, 1, BRICK, floor=h)


def intersect(A, Bs):
    out = []
    for a0, a1 in A:
        for b0, b1 in Bs:
            lo, hi = max(a0, b0), min(a1, b1)
            if hi - lo > 1e-4:
                out.append((lo, hi))
    return sorted(out)


def hut_spans(R, i, ctx):
    """Where a guard house stands on the breastwork's line along edge i: the breastwork stops 2 cm
    inside the house's walls."""
    e = R.E[i]
    out = []
    for x0, z0, x1, z1 in ctx.huts:
        x0, z0, x1, z1 = x0 + HIN, z0 + HIN, x1 - HIN, z1 - HIN
        ss, dd = [], []
        for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1)):
            r = Vector((x, z)) - e.A
            ss.append(r.dot(e.t))
            dd.append(r.dot(e.n))
        if min(dd) < ctx.band + 0.05 and max(dd) > 0.0 and min(ss) < e.L and max(ss) > 0:
            out.append((min(ss) + 0.02, max(ss) - 0.02))
    return out


def post(g, R, i, s0, s1, h):
    """A stone post on the town parapet's line where it stops for a stair."""
    e = R.E[i]
    F = Frame(e.A.x, e.A.y, (e.t.x, e.t.y), (-e.n.x, -e.n.y))
    F.box(g, s0, s1, -0.5, 0.0, h, h + 1.2, STONE, skip=("-y",), floor=h)
    c = (s0 + s1) / 2
    pyramid(g, [F.p(s0 - 0.03, 0.03, h + 1.2), F.p(s1 + 0.03, 0.03, h + 1.2), F.p(s1 + 0.03, -0.53, h + 1.2),
                F.p(s0 - 0.03, -0.53, h + 1.2)], F.p(c, -0.25, h + 1.42), STONE, floor=h)


def fill_poly(ring, cuts=()):
    """Triangles over a (concave) outline, cut on the GRID so no triangle is large, and along the
    given segments (a, b) near them (the edges of the grass)."""
    bm = bmesh.new()
    vs = [bm.verts.new((p.x, p.y, 0.0)) for p in ring]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    xs = [p.x for p in ring]
    zs = [p.y for p in ring]
    for axis, lo, hi in ((0, min(xs), max(xs)), (1, min(zs), max(zs))):
        for k in range(math.ceil(lo / GRID), math.floor(hi / GRID) + 1):
            co = [0.0, 0.0, 0.0]
            no = [0.0, 0.0, 0.0]
            co[axis] = k * GRID
            no[axis] = 1.0
            geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
            bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
    for a, b in cuts:
        lo_x, hi_x = min(a.x, b.x) - 6, max(a.x, b.x) + 6
        lo_z, hi_z = min(a.y, b.y) - 6, max(a.y, b.y) + 6
        fs = [f for f in bm.faces if lo_x <= f.calc_center_median().x <= hi_x and lo_z <= f.calc_center_median().y <= hi_z]
        if not fs:
            continue
        es = list({e for f in fs for e in f.edges})
        vs_ = list({v for f in fs for v in f.verts})
        d = b - a
        bmesh.ops.bisect_plane(bm, geom=vs_ + es + fs, dist=1e-5, plane_co=(a.x, a.y, 0.0), plane_no=(-d.y, d.x, 0.0))
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    tris = [[Vector((v.co.x, v.co.y)) for v in f.verts] for f in bm.faces]
    bm.free()
    return tris


GRASS_IN = 3.2  # the paved walk round a land bastion's top, inside its edges


def inset(P, d):
    """A polygon pulled in by d (mitred corners)."""
    n = len(P)
    area = sum(P[i].x * P[(i + 1) % n].y - P[(i + 1) % n].x * P[i].y for i in range(n))
    E = []
    for i in range(n):
        t = (P[(i + 1) % n] - P[i]).normalized()
        nn = Vector((-t.y, t.x)) if area > 0 else Vector((t.y, -t.x))
        E.append((P[i] + nn * d, t))
    return [line_x(E[i - 1][0], E[i - 1][1], E[i][0], E[i][1]) or E[i][0] for i in range(n)]


def grass_areas(ctx):
    """The grass on each land bastion's top (an inset outline) and the paved squares round its
    guard house (with a path toward its door); the cut lines that make their edges clean."""
    areas, cuts = [], []
    for _, P in ctx.land_bastions:
        Pi = inset(P, GRASS_IN)
        paved = []
        ring = [(p.x, p.y) for p in P]
        for x0, z0, x1, z1 in ctx.huts:
            c = Vector(((x0 + x1) / 2, (z0 + z1) / 2))
            if not inside((c.x, c.y), ring):
                continue
            q = [x0 - 1.5, z0 - 1.5, x1 + 1.5, z1 + 1.5]
            d = ctx.centre - c
            if abs(d.x) > abs(d.y):
                q[0 if d.x < 0 else 2] += -3.0 if d.x < 0 else 3.0
            else:
                q[1 if d.y < 0 else 3] += -3.0 if d.y < 0 else 3.0
            paved.append(q)
            R4 = [Vector((q[0], q[1])), Vector((q[2], q[1])), Vector((q[2], q[3])), Vector((q[0], q[3]))]
            cuts += [(R4[j], R4[(j + 1) % 4]) for j in range(4)]
        cuts += [(Pi[j], Pi[(j + 1) % len(Pi)]) for j in range(len(Pi))]
        areas.append(([(p.x, p.y) for p in Pi], paved))
    return areas, cuts


def grass_at(c, ctx):
    for ring, paved in ctx.grass:
        if inside((c.x, c.y), ring) and not any(q[0] <= c.x <= q[2] and q[1] <= c.y <= q[3] for q in paved):
            return True
    return False


# ------------------------------------------------------------------ guard houses and turrets


def build_hut(g, rect, uo, dc, h):
    """A 4 x 4 m guard house on the walk: brick on a stone base, quoins, a slate pyramid roof, an
    open door (a room inside, the leaf swung in, a bench), a window, a lantern by the door."""
    x0, z0, x1, z1 = rect
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    ua = (-uo[1], uo[0])
    W2 = abs(ua[0]) * (x1 - x0) / 2 + abs(ua[1]) * (z1 - z0) / 2 - HIN
    D2 = abs(uo[0]) * (x1 - x0) / 2 + abs(uo[1]) * (z1 - z0) / 2 - HIN
    F = Frame(cx, cz, ua, uo)
    yw = h + HUT_WALL
    dc = max(-W2 + 0.9, min(W2 - 0.9, dc))
    y_d = h + 2.1
    base, band = (h, h + 0.3), (yw - 0.2, yw)
    c = [(-W2, D2), (W2, D2), (W2, -D2), (-W2, -D2)]
    outs = [(0, 1), (1, 0), (0, -1), (-1, 0)]
    for k in range(4):
        pn = Panel(g, F, c[k], c[(k + 1) % 4], outs[k])
        holes = [(dc + W2 - 0.5, dc + W2 + 0.5, h, y_d)] if k == 0 else []
        pn.wall(h, yw, BRICK, holes, (True, True), bands=(band,), floor=h)
        if k == 0:
            u0, u1 = dc + W2 - 0.5, dc + W2 + 0.5
            pn.reveal(u0, u1, h, y_d, HUT_WT, STONE, sill=False, floor=h)
            # the stone surround, a hand proud of the wall
            F.box(g, dc - 0.72, dc - 0.5, D2, D2 + 0.05, h, y_d, STONE, skip=("-o", "-y"), floor=h)
            F.box(g, dc + 0.5, dc + 0.72, D2, D2 + 0.05, h, y_d, STONE, skip=("-o", "-y"), floor=h)
            F.box(g, dc - 0.72, dc + 0.72, D2, D2 + 0.05, y_d, y_d + 0.3, STONE, skip=("-o",), floor=h)
            # the threshold, above the walk (the room's floor)
            F.box(g, dc - 0.5, dc + 0.5, D2 - HUT_WT, D2 + 0.04, h, h + 0.12, STONE, skip=("-y", "-a", "+a", "-o"), floor=h)
        if k == 1:
            pn.sheet(D2 - 0.3, D2 + 0.3, h + 1.1, h + 1.75, WINDOW, floor=h)
    # a stone base course, proud of the brick
    for k in range(4):
        pn = Panel(g, F, c[k], c[(k + 1) % 4], outs[k])
        if k == 0:
            u0, u1 = dc + W2 - 0.5 - 0.22, dc + W2 + 0.5 + 0.22
            for a, b in ((-0.04, u0), (u1, pn.L)):
                seg_base(g, pn, a, b, h)
        else:
            seg_base(g, pn, -0.04, pn.L, h)
    # the room inside
    iw, idp, yf, yc = W2 - HUT_WT, D2 - HUT_WT, h + 0.12, h + 2.45
    dk = 0.55
    F.quad(g, [(-iw, -idp, yf), (iw, -idp, yf), (iw, idp, yf), (-iw, idp, yf)], WOOD, (0, 0, 1), floor=h, k=0.7)
    F.quad(g, [(-iw, -idp, yc), (iw, -idp, yc), (iw, idp, yc), (-iw, idp, yc)], WOOD, (0, 0, -1), floor=h, k=0.45)
    for pa, pb, o in (((iw, idp), (iw, -idp), (-1, 0)), ((iw, -idp), (-iw, -idp), (0, 1)), ((-iw, -idp), (-iw, idp), (1, 0))):
        Panel(g, F, pa, pb, o).wall(yf, yc, STONE, floor=yf, k=dk)
    fr = Panel(g, F, (iw, idp), (-iw, idp), (0, -1))
    fr.wall(yf, yc, STONE, [(iw - dc - 0.5, iw - dc + 0.5, yf, y_d)], floor=yf, k=dk)
    # the leaf, swung in against its jamb; a bench along the far wall
    F.box(g, dc + 0.44, dc + 0.5, idp - 1.0, idp - 0.02, yf + 0.02, y_d - 0.04, WOOD, floor=yf, k=0.8)
    F.box(g, -iw, -iw + 0.38, -idp + 0.15, idp - 1.1, yf, yf + 0.42, WOOD, skip=("-y", "-a"), floor=yf, k=0.8)
    # the lantern by the door, the roof and its finial
    la = dc + 0.95 if dc + 1.25 < W2 else dc - 0.95
    wall_lantern(g, F.p(la, D2, h + 2.35), F.v(0, 1)[::2], 0.35)
    ov = 0.25
    roof = [F.p(-W2 - ov, D2 + ov, yw), F.p(W2 + ov, D2 + ov, yw), F.p(W2 + ov, -D2 - ov, yw), F.p(-W2 - ov, -D2 - ov, yw)]
    pyramid(g, roof, F.p(0, 0, yw + HUT_RISE), SLATE, floor=h)
    finial(g, cx, yw + HUT_RISE - 0.05, cz, 0.9)


def seg_base(g, pn, u0, u1, h):
    """A stone base course along a panel's foot, 4 cm proud."""
    P = pn.pt
    ht = h + 0.3
    g.face([P(u0, h, -0.04), P(u1, h, -0.04), P(u1, ht, -0.04), P(u0, ht, -0.04)], PLINTH, out=pn.outv(), floor=h)
    g.face([P(u0, ht, -0.04), P(u1, ht, -0.04), P(u1, ht, 0.0), P(u0, ht, 0.0)], PLINTH, out=(0, 1, 0), floor=h)


def build_turret(g, S, u, h):
    """The sentry box hung out at a land bastion's salient: a hexagonal pepper pot on a corbel."""
    Cc = S + u * 0.25
    x, z = Cc.x, Cc.y
    R = 0.85
    rot = math.atan2(u.y, u.x) - math.pi / 6  # a face looks along u
    lathe(g, (x, h - 2.4, z), [(0.0, 0.0), (0.35, 0.5), (R, 1.35), (R + 0.06, 1.35), (R + 0.06, 1.55)], 6, STONE, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, -0.85), (R, 1.3)], 6, BRICK, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, 1.3), (R + 0.05, 1.3), (R + 0.05, 1.42), (R, 1.42)], 6, STONE, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, 1.42), (R, 2.15)], 6, BRICK, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R, 2.15), (R + 0.16, 2.15), (R + 0.16, 2.3)], 6, STONE, rot=rot, floor=h - 3)
    lathe(g, (x, h, z), [(R + 0.16, 2.3), (0.0, 3.75)], 6, SLATE, rot=rot, floor=h - 3)
    finial(g, x, h + 3.7, z, 0.8)
    # a slit toward the field and one to each side
    for ang in (0.0, math.pi / 3, -math.pi / 3):
        a = math.atan2(u.y, u.x) + ang
        nx, nz = math.cos(a), math.sin(a)
        rr = R * math.cos(math.pi / 6) + 0.035
        cxs, czs = x + nx * rr, z + nz * rr
        tx, tz = -nz, nx
        q = [(cxs - tx * 0.08, h + 0.3, czs - tz * 0.08), (cxs + tx * 0.08, h + 0.3, czs + tz * 0.08),
             (cxs + tx * 0.08, h + 1.05, czs + tz * 0.08), (cxs - tx * 0.08, h + 1.05, czs - tz * 0.08)]
        g.face(q, IRON, out=(nx, 0, nz), shade=0.35)


# ------------------------------------------------------------------ gates and bridges


def build_gate(g, gt, ctx):
    h, T = ctx.h, ctx.t
    F = ctx.frame(gt["side"], gt["at"])

    def rect_loc(r):
        pts = [F.loc(r[0], r[1]), F.loc(r[2], r[3])]
        a = sorted(p[0] for p in pts)
        o = sorted(p[1] for p in pts)
        return a, o

    (ha0, ha1), (o_in, o_out) = rect_loc(gt["house"])
    HA = max(-ha0, ha1)
    (pa0, pa1), _ = rect_loc(gt["passage"])
    PW = max(-pa0, pa1)
    posts = [F.loc(x, z) for x, z in gt["posts"]]
    post_a = max(abs(p[0]) for p in posts)
    TOP = h + TOWER_UP
    MID = h + MID_UP
    FR = h + FR_UP  # the frontispiece's cornice
    FRW = PW + 1.2  # the frontispiece's half width
    o_f = o_out - 0.25  # the towers' field faces
    o_fr = o_out - 0.1  # the frontispiece's face (its cornice reaches o_out)
    crown = SPR + PW
    oc = (o_in + o_fr) / 2

    def dark(p):
        a, o = F.loc(p[0], p[2])
        e = min(o - o_in, o_fr - o)
        return (0.82 - 0.4 * sm(e / 4.5)) * (0.8 + 0.2 * sm(p[1] / 2.0)) * tint(p[0], p[2])

    for s in (-1, 1):
        ai, ao = s * PW, s * HA
        # the town face: the arch's ring takes the strip by the passage; the sentry box's recess
        town = Panel(g, F, (ao, o_in), (ai, o_in), (0, -1))
        holes = [(HA - PW - 0.7, HA - PW, SPR, MID)]
        rec = None
        if s == 1:
            ra0, ra1 = post_a + 0.8, post_a + 2.3
            rec = (HA - ra1, HA - ra0, 0.0, 2.9)
            holes.append(rec)
        town.wall(FOOT_LAND, TOP - 0.35, BRICK, holes, (True, False), plinth=PL, bands=((h - 0.3, h),))
        if rec:
            sentry_box(g, F, town, rec, o_in)
        # the field face, behind the frontispiece by the arch
        field = Panel(g, F, (ai, o_f), (ao, o_f), (0, 1))
        field.wall(FOOT_LAND, TOP - 0.35, BRICK, [(0.0, FRW - PW, FOOT_LAND, FR), (0.0, FRW - PW + 0.2, FR, FR + 0.35)],
                   (False, True), plinth=PL, bands=((h - 0.3, h),))
        # the outer side: in the wall body up to the walk, then a door onto the walk
        side = Panel(g, F, (ao, o_f), (ao, o_in), (s, 0))
        uc = o_f - T / 2
        side.wall(FOOT_LAND, TOP - 0.35, BRICK, [(o_f - (T - 0.3), o_f - 0.1, FOOT_LAND, h - 0.02), (uc - 0.5, uc + 0.5, h, h + 2.1)],
                  (True, True), plinth=PL, bands=((h - 0.3, h),))
        side.reveal(uc - 0.5, uc + 0.5, h, h + 2.1, 0.18, STONE, back=WOOD, sill=False, floor=h, back_k=0.8)
        side.sheet(uc - 0.3, uc + 0.3, h + 3.0, h + 3.8, WINDOW, floor=h)
        # the passage wall, with the niche the open leaf folds into
        hinge = o_fr - 0.8
        pw = Panel(g, F, (ai, o_in), (ai, o_f), (-s, 0))
        n0, n1 = hinge - o_in - 2.55, hinge - o_in + 0.05
        pw.wall(0.0, SPR, BRICK, [(n0, n1, 0.0, SPR - 0.05)], plinth=1.0, shade=dark)
        pw.reveal(n0, n1, 0.0, SPR - 0.05, 0.16, BRICK, back=BRICK, sill=False, shade=dark, back_k=0.8)
        F.box(g, s * (PW + 0.02), s * (PW + 0.14), hinge - 2.5, hinge, 0.04, SPR - 0.12, WOOD, skip=("-y",), shade=dark)
        # above the middle: the tower's face toward the other tower
        up = Panel(g, F, (ai, o_in), (ai, o_f), (-s, 0))
        up.wall(MID, TOP - 0.35, BRICK, quoin=(True, False), floor=MID)
        # windows and slits
        wa = (FRW + HA) / 2
        field.sheet(wa - PW - 0.4, wa - PW + 0.4, h + 2.3, h + 3.5, WINDOW)
        field.sheet(wa - PW - 0.11, wa - PW + 0.11, 3.0, 4.2, WINDOW)
        town.sheet(HA - wa - 0.4, HA - wa + 0.4, h + 2.3, h + 3.5, WINDOW)
        # the cornice, the roof, the finial
        a0, a1 = sorted((ai, ao))
        F.box(g, a0 - 0.15, a1 + 0.15, o_in - 0.15, o_f + 0.15, TOP - 0.35, TOP, STONE, skip=("+y",), floor=TOP - 2)
        rc = [F.p(a0 - 0.25, o_in - 0.25, TOP), F.p(a1 + 0.25, o_in - 0.25, TOP), F.p(a1 + 0.25, o_f + 0.25, TOP),
              F.p(a0 - 0.25, o_f + 0.25, TOP)]
        am, om = (a0 + a1) / 2, (o_in + o_f) / 2
        pyramid(g, rc, F.p(am, om, TOP + ROOF_RISE), SLATE, floor=TOP - 2)
        fx, _, fz = F.p(am, om, 0)
        finial(g, fx, TOP + ROOF_RISE - 0.08, fz, 1.3)
        # lanterns either side of the arch, on the frontispiece
        wall_lantern(g, F.p(s * (PW + 0.6), o_fr, 4.4), F.v(0, 1)[::2], 0.5)

    # the vault and the floor of the passage
    angs = [math.pi * k / 9 for k in range(10)]
    os_ = splits(o_in, o_fr, 3.2)
    for t0, t1 in zip(angs, angs[1:]):
        tm = (t0 + t1) / 2
        for oa, ob in zip(os_, os_[1:]):
            q = [F.p(PW * math.cos(t0), oa, SPR + PW * math.sin(t0)), F.p(PW * math.cos(t1), oa, SPR + PW * math.sin(t1)),
                 F.p(PW * math.cos(t1), ob, SPR + PW * math.sin(t1)), F.p(PW * math.cos(t0), ob, SPR + PW * math.sin(t0))]
            g.face(q, BRICK, out=F.v(-math.cos(tm), 0, -math.sin(tm)), shade=dark, k=0.9)
    for oa, ob in zip(splits(o_in, o_out, 2.5), splits(o_in, o_out, 2.5)[1:]):
        for aa, ab in ((-PW, 0.0), (0.0, PW)):
            F.quad(g, [(aa, oa, LIFT), (ab, oa, LIFT), (ab, ob, LIFT), (aa, ob, LIFT)], COBBLE, (0, 0, 1), shade=dark)
    # the lantern hanging in the passage
    lx, _, lz = F.p(0, oc, 0)
    bar(g, (lx, crown, lz), (lx, crown - 0.7, lz), 0.03, IRON, shade=0.5)
    lantern(g, lx, crown - 0.7, lz, 0.26, 0.4)

    # the middle over the passage, town side: the arch in brick with a stone ring, a coping
    arch_face(g, F, o_in, -1, PW + 0.7, PW, PW + 0.55, SPR, MID, BRICK, STONE)
    F.quad(g, [(-PW, o_in, MID), (PW, o_in, MID), (PW, o_f, MID), (-PW, o_f, MID)], STONE, (0, 0, 1), floor=MID - 1)
    # a parapet over the arch between the towers, as on the walk
    F.box(g, -PW, PW, o_in, o_in + TOWN_T, MID, MID + TOWN_H - 0.15, BRICK, skip=("-a", "+a", "-y", "+y"), floor=MID)
    F.box(g, -PW, PW, o_in - 0.04, o_in + TOWN_T + 0.04, MID + TOWN_H - 0.15, MID + TOWN_H, STONE, skip=("-a", "+a"), floor=MID)
    kb = SPR + PW * math.sin(math.pi * 4 / 9) - 0.05  # under the soffit's top chord
    F.box(g, -0.28, 0.28, o_in - 0.06, o_in, kb, crown + 0.6, STONE, skip=("+o",), k=1.08)  # keystone

    # the frontispiece on the field side: pilasters, the arch with its voussoirs, a cornice, the
    # attic with the lion shield, a small pediment with a ball, two obelisks
    for s in (-1, 1):
        a0, a1 = sorted((s * PW, s * FRW))
        F.quad(g, [(a0, o_fr, FOOT_LAND), (a1, o_fr, FOOT_LAND), (a1, o_fr, SPR), (a0, o_fr, SPR)], STONE, (0, 1, 0))
        F.quad(g, [(s * FRW, o_f, FOOT_LAND), (s * FRW, o_fr, FOOT_LAND), (s * FRW, o_fr, FR), (s * FRW, o_f, FR)], STONE, (s, 0, 0))
        F.box(g, a0 - (0.05 if s < 0 else 0), a1 + (0.05 if s > 0 else 0), o_fr, o_fr + 0.05, SPR - 0.25, SPR, STONE,
              skip=("-o",))  # the impost
        F.quad(g, [(s * PW, o_f, 0.0), (s * PW, o_fr, 0.0), (s * PW, o_fr, SPR), (s * PW, o_f, SPR)], STONE, (-s, 0, 0), shade=dark)
    arch_face(g, F, o_fr, 1, FRW, PW, PW + 0.65, SPR, FR, STONE, STONE, ring_k=(1.1, 0.8), proud=0.06)
    F.box(g, -0.3, 0.3, o_fr, o_out, kb, crown + 0.75, STONE, skip=("-o",), k=1.1)  # keystone
    F.box(g, -FRW - 0.2, FRW + 0.2, o_f, o_out, FR, FR + 0.35, STONE, floor=FR - 2)
    back = Panel(g, F, (PW, o_f), (-PW, o_f), (0, -1))
    back.wall(MID, FR, STONE, floor=MID)
    F.box(g, -2.1, 2.1, o_f, o_fr, FR + 0.35, FR + 2.2, STONE, skip=("-y", "+o"), floor=FR)
    F.quad(g, [(-2.1, o_fr, FR + 0.35), (2.1, o_fr, FR + 0.35), (2.1, o_fr, FR + 2.2), (-2.1, o_fr, FR + 2.2)], ARMS, (0, 1, 0),
           uvs=fit_uvs(4), floor=FR)
    pe = [(-2.35, FR + 2.28), (2.35, FR + 2.28), (0.0, FR + 2.95)]
    for oo, sg in ((o_f, -1), (o_fr + 0.05, 1)):
        F.quad(g, [(a, oo, y) for a, y in pe], STONE, (0, sg, 0), floor=FR)
    for s in (-1, 1):
        F.quad(g, [(s * 2.35, o_f, FR + 2.28), (s * 2.35, o_fr + 0.05, FR + 2.28), (0.0, o_fr + 0.05, FR + 2.95), (0.0, o_f, FR + 2.95)],
               STONE, (s * 0.3, 0, 1), floor=FR)
    F.box(g, -2.35, 2.35, o_f, o_fr + 0.05, FR + 2.2, FR + 2.28, STONE, skip=("+y", "-y"), floor=FR)
    bx, _, bz = F.p(0, (o_f + o_fr) / 2, 0)
    lathe(g, (bx, FR + 2.9, bz), [(0.1, 0), (0.1, 0.1), (0.22, 0.2), (0.25, 0.35), (0.2, 0.5), (0.0, 0.62)], 6, STONE,
          rot=math.pi / 12, floor=FR)
    for s in (-1, 1):
        oa = s * (FRW - 0.35)
        om = (o_f + o_out) / 2
        F.box(g, oa - 0.22, oa + 0.22, om - 0.1, om + 0.1, FR + 0.35, FR + 0.7, STONE, skip=("-y",), floor=FR)
        pyramid(g, [F.p(oa - 0.16, om - 0.08, FR + 0.7), F.p(oa + 0.16, om - 0.08, FR + 0.7), F.p(oa + 0.16, om + 0.08, FR + 0.7),
                    F.p(oa - 0.16, om + 0.08, FR + 0.7)], F.p(oa, om, FR + 1.7), STONE, bottom=False, floor=FR)
    return F


def sentry_box(g, F, town, rec, o_in):
    """The sentry box built into the tower's town face beside the arch: planked inside, posts and a
    little gabled roof in front."""
    u0, u1, y0, y1 = rec
    town.reveal(u0, u1, y0, y1, 1.25, WOOD, back=WOOD, sill=False, k=0.7, back_k=0.6)
    a_of = lambda u: town.A.x + town.t.x * u  # noqa: E731
    a0, a1 = sorted((a_of(u0), a_of(u1)))
    F.box(g, a0, a1, o_in + 0.1, o_in + 1.25, 0.0, 0.12, WOOD, skip=("-y", "-a", "+a", "+o"), k=0.7)
    for aa in (a0, a1 - 0.12):
        F.box(g, aa, aa + 0.12, o_in - 0.02, o_in + 0.1, 0.0, 2.45, WOOD, skip=("-y", "+y"))
    F.box(g, a0, a1, o_in - 0.02, o_in + 0.1, 2.45, 2.75, WOOD, skip=("-y",))
    ac = (a0 + a1) / 2
    ye, yr = 2.78, 3.45
    of, ob = o_in - 0.3, o_in + 0.35
    ea, eb = a0 - 0.22, a1 + 0.22
    for sa in (ea, eb):
        F.quad(g, [(sa, of, ye), (ac, of, yr), (ac, ob, yr), (sa, ob, ye)], SLATE, (sa - ac, 0, 0.6))
    F.quad(g, [(ea, of, ye), (eb, of, ye), (ac, of, yr)], WOOD, (0, -1, 0), k=0.8)
    F.quad(g, [(ea, of, ye), (eb, of, ye), (eb, ob, ye), (ea, ob, ye)], WOOD, (0, 0, -1), k=0.5)
    x, _, z = F.p(ac, of + 0.08, 0)
    finial(g, x, yr - 0.03, z, 0.45)


def arch_face(g, F, o, osgn, A, r, r2, ys, yt, fill, ring, nseg=9, ring_k=(1.05, 0.9), proud=0.0):
    """A wall face at o with a round arch (radius r, springing at ys) cut in it: the ring of
    voussoirs out to r2 (`proud` in front of the face), and the fill out to the rectangle |a| <= A,
    ys <= y <= yt. The ring's inner edge runs on the same chords as the vault behind it."""
    out = F.v(0, osgn)
    ca = math.atan2(yt - ys, A)
    base = [math.pi * k / nseg for k in range(nseg + 1)]
    angs = sorted(set(base + [ca, math.pi - ca]))

    def arc(rad, t):
        return rad * math.cos(t), ys + rad * math.sin(t)

    def chord(t):
        k = min(nseg - 1, int(t / (math.pi / nseg)))
        t0, t1 = base[k], base[k + 1]
        f = (t - t0) / (t1 - t0)
        a0, a1 = arc(r, t0), arc(r, t1)
        return a0[0] + (a1[0] - a0[0]) * f, a0[1] + (a1[1] - a0[1]) * f

    def bound(t):
        c, s = math.cos(t), math.sin(t)
        cand = []
        if abs(c) > 1e-9:
            cand.append(A / abs(c))
        if s > 1e-9:
            cand.append((yt - ys) / s)
        tt = min(cand)
        return tt * c, ys + tt * s

    o2 = o + osgn * proud
    for t0, t1 in zip(angs, angs[1:]):
        if t1 - t0 < 1e-6:
            continue
        v = int(((t0 + t1) / 2) / (math.pi / nseg))
        p0, p1, q0, q1 = chord(t0), chord(t1), arc(r2, t0), arc(r2, t1)
        w0 = (t0 - base[v]) / (math.pi / nseg) * 0.25 + 0.25 * (v % 4)
        w1 = (t1 - base[v]) / (math.pi / nseg) * 0.25 + 0.25 * (v % 4)
        ru = (r2 - r) / TILE[ring][0]
        g.face([F.p(p0[0], o2, p0[1]), F.p(p1[0], o2, p1[1]), F.p(q1[0], o2, q1[1]), F.p(q0[0], o2, q0[1])], ring, out=out,
               uvs=[(0.0, w0), (0.0, w1), (ru, w1), (ru, w0)], k=ring_k[v % 2])
        if proud > 0:
            tm = (t0 + t1) / 2
            g.face([F.p(q0[0], o, q0[1]), F.p(q1[0], o, q1[1]), F.p(q1[0], o2, q1[1]), F.p(q0[0], o2, q0[1])], ring,
                   out=F.v(math.cos(tm), 0, math.sin(tm)), k=0.9)
            g.face([F.p(p0[0], o, p0[1]), F.p(p1[0], o, p1[1]), F.p(p1[0], o2, p1[1]), F.p(p0[0], o2, p0[1])], ring,
                   out=F.v(-math.cos(tm), 0, -math.sin(tm)), k=0.75)
        b0, b1 = bound(t0), bound(t1)
        g.face([F.p(q0[0], o, q0[1]), F.p(q1[0], o, q1[1]), F.p(b1[0], o, b1[1]), F.p(b0[0], o, b0[1])], fill, out=out)
    if proud > 0:
        for t in (0.0, math.pi):
            p, q = arc(r, t), arc(r2, t)
            g.face([F.p(p[0], o, p[1]), F.p(q[0], o, q[1]), F.p(q[0], o2, q[1]), F.p(p[0], o2, p[1])], ring, out=(0, -1, 0))


def build_bridge(g, gt, F, ctx):
    """The stone bridge over the moat: a cobbled deck at LIFT on three brick arches, brick parapets
    with a stone coping, stone posts at the ends, a lamp post at the field end."""
    pts = [F.loc(gt["bridge"][0], gt["bridge"][1]), F.loc(gt["bridge"][2], gt["bridge"][3])]
    a0, a1 = sorted(p[0] for p in pts)
    o0, o1 = sorted(p[1] for p in pts)
    rp = [F.loc(gt["road"][0], gt["road"][1]), F.loc(gt["road"][2], gt["road"][3])]
    road_end = max(p[1] for p in rp)
    bank0 = (road_end + o0) / 2  # the road and the bridge overlap on the berm's edge
    bank1 = o1 - (bank0 - o0)
    BA = (a1 - a0) / 2
    PT = 0.5  # the parapets fill the solids' strips along the deck
    TOPP = 1.0
    BOT = -6.0
    f0, f1 = bank0 + 1.0, bank1 - 1.0  # the abutments' faces in the water
    pier = 1.2
    span = (f1 - f0 - 2 * pier) / 3
    r = span / 2
    cs = [f0 + r + k * (span + pier) for k in range(3)]
    sp = -0.55 - r
    rr = r + 0.45
    post_l = 0.6
    for s in (-1, 1):
        # the solid parts: abutments, piers (below the springing), the fill between the arches
        cols = [(o0, cs[0] - r)] + [(cs[k] + r, cs[k + 1] - r) for k in range(2)] + [(cs[2] + r, o1)]
        for c0, c1 in cols:
            Panel(g, F, (s * BA, c0), (s * BA, c1), (s, 0), uoff=c0 - o0).wall(BOT, sp, PLINTH, floor=0.0)
        spans = [(o0, cs[0] - rr)] + [(cs[k] + rr, cs[k + 1] - rr) for k in range(2)] + [(cs[2] + rr, o1)]
        for c0, c1 in spans:
            pn = Panel(g, F, (s * BA, c0), (s * BA, c1), (s, 0), uoff=c0 - o0)
            holes = []
            if c0 <= o0 + 1e-6:
                holes.append((0.0, post_l, -0.3, TOPP + 1))
            if c1 >= o1 - 1e-6:
                holes.append((c1 - c0 - post_l, c1 - c0, -0.3, TOPP + 1))
            pn.wall(sp, TOPP, BRICK, holes)
        for c in cs:
            arch_side(g, F, s, BA, c, r, rr, sp, TOPP)
        # cutwaters on the piers
        for k in range(2):
            p0, p1 = cs[k] + r, cs[k + 1] - r
            pm = (p0 + p1) / 2
            tri = [(s * BA, p0), (s * (BA + 0.7), pm), (s * BA, p1)]
            for (aa, oa), (ab, ob) in zip(tri, tri[1:]):
                ca = s * (BA + 0.7 / 3)
                F.quad(g, [(aa, oa, BOT), (ab, ob, BOT), (ab, ob, sp - 0.2), (aa, oa, sp - 0.2)], PLINTH,
                       ((aa + ab) / 2 - ca, (oa + ob) / 2 - pm, 0), floor=-2.0)
            F.quad(g, [(a, o, sp - 0.2) for a, o in tri[:2]] + [(s * BA, pm, sp + 0.35)], STONE, (s * 0.3, -0.3, 1), floor=-2.0)
            F.quad(g, [(a, o, sp - 0.2) for a, o in tri[1:]] + [(s * BA, pm, sp + 0.35)], STONE, (s * 0.3, 0.3, 1), floor=-2.0)
        # the parapet's inner face and coping, the string course at the deck, the posts
        ai = s * (BA - PT)
        inner = Panel(g, F, (ai, o0 + post_l), (ai, o1 - post_l), (-s, 0))
        inner.wall(LIFT, TOPP, BRICK, floor=LIFT)
        amin, amax = sorted((ai, s * BA))
        F.box(g, amin, amax, o0 + post_l, o1 - post_l, TOPP, TOPP + 0.15, STONE, skip=("-y", "-o", "+o"), floor=LIFT)
        F.box(g, s * BA, s * (BA + 0.08), o0 + post_l, o1 - post_l, -0.3, -0.06, STONE, skip=("-a" if s > 0 else "+a",), floor=-1)
        for oa, ob, lamp in ((o0, o0 + post_l, False), (o1 - post_l, o1, s > 0)):
            ph = 1.35
            F.box(g, amin, amax, oa, ob, -0.3, ph, STONE, skip=("-y",), floor=LIFT)
            am, om = (amin + amax) / 2, (oa + ob) / 2
            if lamp:
                x, _, z = F.p(am, om, 0)
                lathe(g, (x, ph, z), [(0.13, 0.0), (0.13, 0.18), (0.07, 0.28), (0.05, 2.35), (0.1, 2.45), (0.03, 2.5)], 6, IRON, shade=0.8)
                lantern(g, x, ph + 3.0, z, 0.3, 0.44)
            else:
                pyramid(g, [F.p(amin - 0.02, oa - 0.02, ph), F.p(amax + 0.02, oa - 0.02, ph), F.p(amax + 0.02, ob + 0.02, ph),
                            F.p(amin - 0.02, ob + 0.02, ph)], F.p(am, om, ph + 0.28), STONE, floor=LIFT)
    # the arches' undersides and the piers' faces in the openings
    for c in cs:
        angs = [math.pi * k / 8 for k in range(9)]
        for t0, t1 in zip(angs, angs[1:]):
            tm = (t0 + t1) / 2
            q = [F.p(-BA, c + r * math.cos(t0), sp + r * math.sin(t0)), F.p(BA, c + r * math.cos(t0), sp + r * math.sin(t0)),
                 F.p(BA, c + r * math.cos(t1), sp + r * math.sin(t1)), F.p(-BA, c + r * math.cos(t1), sp + r * math.sin(t1))]
            g.face(q, BRICK, out=F.v(0, -math.cos(tm), -math.sin(tm)), k=0.6, floor=-2.0)
        F.quad(g, [(-BA, c - r, BOT), (BA, c - r, BOT), (BA, c - r, sp), (-BA, c - r, sp)], PLINTH, (0, 1, 0), floor=-2.0, k=0.8)
        F.quad(g, [(-BA, c + r, BOT), (BA, c + r, BOT), (BA, c + r, sp), (-BA, c + r, sp)], PLINTH, (0, -1, 0), floor=-2.0, k=0.8)
    # the deck and its ends
    ds = splits(o0, o1, 3.0)
    for oa, ob in zip(ds, ds[1:]):
        for aa, ab in ((-(BA - PT), 0.0), (0.0, BA - PT)):
            F.quad(g, [(aa, oa, LIFT), (ab, oa, LIFT), (ab, ob, LIFT), (aa, ob, LIFT)], COBBLE, (0, 0, 1), floor=-1.0)
    for oo, sg in ((o0, -1), (o1, 1)):
        F.quad(g, [(-BA, oo, BOT), (BA, oo, BOT), (BA, oo, -0.3), (-BA, oo, -0.3)], PLINTH, (0, sg, 0), floor=0.0)
        F.quad(g, [(-BA + PT, oo, -0.3), (BA - PT, oo, -0.3), (BA - PT, oo, LIFT), (-BA + PT, oo, LIFT)], PLINTH, (0, sg, 0), floor=0.0)


def arch_side(g, F, s, BA, c, r, rr, sp, top):
    """One arch on the bridge's side face: the stone ring and the brick above it."""
    angs = [math.pi * k / 8 for k in range(9)]
    out = F.v(s, 0)
    for k, (t0, t1) in enumerate(zip(angs, angs[1:])):
        p0 = (c + r * math.cos(t0), sp + r * math.sin(t0))
        p1 = (c + r * math.cos(t1), sp + r * math.sin(t1))
        q0 = (c + rr * math.cos(t0), sp + rr * math.sin(t0))
        q1 = (c + rr * math.cos(t1), sp + rr * math.sin(t1))
        w0, w1 = 0.25 * (k % 4), 0.25 * (k % 4) + 0.25
        g.face([F.p(s * BA, *p0), F.p(s * BA, *p1), F.p(s * BA, *q1), F.p(s * BA, *q0)], STONE, out=out, k=1.05 if k % 2 else 0.88,
               uvs=[(0.0, w0), (0.0, w1), (0.4, w1), (0.4, w0)], floor=-2.0)
        g.face([F.p(s * BA, q0[0], q0[1]), F.p(s * BA, q1[0], q1[1]), F.p(s * BA, q1[0], top), F.p(s * BA, q0[0], top)], BRICK,
               out=out, floor=-2.0)


# ------------------------------------------------------------------ stairs


def stair_frame(st, ctx):
    """A stair's frame: a = up the flight from its foot, o = outward from the inner face (the flight
    is at o < 0, in the street). Returns the frame, the run, the landing's length, the width."""
    along_z, face, sgn = ctx.sides[st["side"]]
    ax = 1 if along_z else 0
    foot, head = st["a"][ax], st["b"][ax]
    dirn = 1.0 if head > foot else -1.0
    fl, ld = st["flight"], st["landing"]
    W = abs(fl[2 + (1 - ax)] - fl[1 - ax])
    LAND = abs(ld[2 + ax] - ld[ax])
    if along_z:
        F = Frame(face, foot, (0.0, dirn), (sgn, 0.0))
    else:
        F = Frame(foot, face, (dirn, 0.0), (0.0, sgn))
    return F, abs(head - foot), LAND, W


def build_stair(g, st, ctx):
    """A flight of stone steps up the inner face, solid brick under it, a string wall with a stone
    coping and an iron railing on the street side, a landing at the walk's height, a small door."""
    h = ctx.h
    F, RUN, LAND, W = stair_frame(st, ctx)
    RW = ctx.rail
    N = max(1, round(h / STEP_RISE))
    rise, run = h / N, RUN / N
    END = RUN + LAND
    for i in range(N):
        y = (i + 0.5) * rise
        yb = 0.0 if i == 0 else (i - 0.5) * rise
        F.quad(g, [(i * run, -W, y), ((i + 1) * run, -W, y), ((i + 1) * run, 0.06, y), (i * run, 0.06, y)], STONE, (0, 0, 1), floor=y - 1)
        F.quad(g, [(i * run, -W, yb), (i * run, 0.06, yb), (i * run, 0.06, y), (i * run, -W, y)], STONE, (-1, 0, 0), floor=0.0, k=0.8)
    F.quad(g, [(RUN, -W, (N - 0.5) * rise), (RUN, 0.06, (N - 0.5) * rise), (RUN, 0.06, h), (RUN, -W, h)], STONE, (-1, 0, 0), k=0.8)
    for aa, ab in zip(splits(RUN, END, 2.0), splits(RUN, END, 2.0)[1:]):
        F.quad(g, [(aa, -W, h), (ab, -W, h), (ab, -0.05, h), (aa, -0.05, h)], STONE, (0, 0, 1), floor=h - 1)
    UP = 0.3  # the string wall's top over the step line

    def yt(a):
        return (min(a, RUN) / RUN) * h + UP if a < RUN else h + UP

    o_out, o_in = -W - RW, -W
    brk = sorted(set(splits(0.0, RUN, 2.5) + splits(RUN, END + RW, 2.0)))
    # where the coping's foot passes the plinth
    a_pl = (PL + 0.15 - UP) / h * RUN
    if 0 < a_pl < RUN:
        brk = sorted(set(brk + [a_pl]))
    brk = sorted(set(brk + [0.45]))
    for aa, ab in zip(brk, brk[1:]):
        ta, tb = yt(aa), yt(ab)
        for o, sg in ((o_out, -1), (o_in, 1)):
            if ab <= 0.45 + 1e-6:
                continue  # inside the newel
            lo_a = -0.3 if sg < 0 else max(0.0, ta - 0.9)
            lo_b = -0.3 if sg < 0 else max(0.0, tb - 0.9)
            if sg < 0 and ta - 0.15 >= PL - 1e-6 and tb - 0.15 >= PL - 1e-6:
                F.quad(g, [(aa, o, lo_a), (ab, o, lo_b), (ab, o, PL), (aa, o, PL)], PLINTH, (0, sg, 0))
                F.quad(g, [(aa, o, PL), (ab, o, PL), (ab, o, tb - 0.15), (aa, o, ta - 0.15)], BRICK, (0, sg, 0))
            else:
                F.quad(g, [(aa, o, lo_a), (ab, o, lo_b), (ab, o, tb - 0.15), (aa, o, ta - 0.15)], PLINTH if sg < 0 else BRICK,
                       (0, sg, 0))
            F.quad(g, [(aa, o, ta - 0.15), (ab, o, tb - 0.15), (ab, o, tb), (aa, o, ta)], STONE, (0, sg, 0))
        if ab > 0.45 + 1e-6:
            F.quad(g, [(aa, o_out, ta), (ab, o_out, tb), (ab, o_in, tb), (aa, o_in, ta)], STONE, (0, 0, 1), floor=h)
    # the end: a strip under the railing across the landing's end, the landing block's end face
    # with a small door
    F.box(g, END, END + RW, o_in, 0.0, h - 0.3, h + UP, STONE, skip=("+o", "-o", "-y", "+a"), floor=h)
    end = Panel(g, F, (END + RW, o_out), (END + RW, 0.0), (1, 0))
    dc = (o_out) / 2
    u0, u1 = dc - o_out - 0.45, dc - o_out + 0.45
    end.wall(-0.3, h + UP - 0.15, BRICK, [(u0, u1, 0.0, 1.95)], (True, False), plinth=PL)
    end.wall(h + UP - 0.15, h + UP, STONE)
    end.reveal(u0, u1, 0.0, 1.95, 0.2, STONE, back=WOOD, sill=False, back_k=0.85)
    # the newel at the foot
    F.box(g, -0.05, 0.45, o_out, o_in, -0.1, yt(0.45) + 0.4, STONE, skip=("-y",))
    # the railing
    om = (o_out + o_in) / 2
    ps = splits(0.25, RUN, 1.3) + splits(RUN, END + RW / 2, 1.2)[1:]
    for a in ps:
        y = yt(a)
        bar(g, F.p(a, om, y), F.p(a, om, y + 1.0), 0.055, IRON, shade=0.7)
    for dy in (0.95, 0.45):
        bar(g, F.p(0.25, om, yt(0.25) + dy), F.p(RUN, om, yt(RUN) + dy), 0.035, IRON, shade=0.7)
        bar(g, F.p(RUN, om, h + UP + dy), F.p(END + RW / 2, om, h + UP + dy), 0.035, IRON, shade=0.7)
        bar(g, F.p(END + RW / 2, om, h + UP + dy - 0.012), F.p(END + RW / 2, -0.15, h + UP + dy - 0.012), 0.035, IRON, shade=0.7)
    for o in (-W / 2, -0.15):
        bar(g, F.p(END + RW / 2, o, h + UP), F.p(END + RW / 2, o, h + UP + 1.0), 0.055, IRON, shade=0.7)


# ------------------------------------------------------------------ build


def build(ctx):
    D = ctx.D
    g = Geo()
    h = ctx.h
    rings = [Ring(r, ctx) for r in D["tops"]]
    for R in rings:
        build_ring(g, R, ctx)
    # guard houses: on the towers (door toward the walk), on the bastions (door toward the town)
    for hut in ctx.huts:
        x0, z0, x1, z1 = hut
        c = Vector(((x0 + x1) / 2, (z0 + z1) / 2))
        t = ctx.tower_huts.get(tuple(hut))
        d = (Vector(t["door"]) - c) if t else (ctx.centre - c)
        uo = (1.0 if d.x > 0 else -1.0, 0.0) if abs(d.x) > abs(d.y) else (0.0, 1.0 if d.y > 0 else -1.0)
        dc = 0.0
        if t:
            ua = (-uo[1], uo[0])
            dc = (Vector(t["door"]) - c).dot(Vector(ua))
        build_hut(g, hut, uo, dc, h)
    # the sentry turrets at the land bastions' salients
    for _, P in ctx.land_bastions:
        k = max(range(len(P)), key=lambda j: (P[j] - ctx.centre).length)
        a, b, c = P[k - 1], P[k], P[(k + 1) % len(P)]
        u = ((b - a).normalized() - (c - b).normalized()).normalized()
        build_turret(g, b, u, h)
    for st in D["stairs"]:
        build_stair(g, st, ctx)
    for gt in D["gates"]:
        g.grp = ("gate", gt["id"])
        F = build_gate(g, gt, ctx)
        build_bridge(g, gt, F, ctx)
        g.grp = None
    return g


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=20, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------ preview


def preview_materials():
    for mt in bpy.data.materials:
        nt = mt.node_tree
        if nt is None:
            continue
        bsdf = nt.nodes.get("Principled BSDF")
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if bsdf is None or tex is None:
            continue
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        if mt.name.endswith("_glow"):
            bsdf.inputs["Emission Strength"].default_value = 3.0


def flat_mat(name, rgb):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = 0.9
    return m


def preview_ground(ctx):
    """Preview only: the town's ground, the berm, the moat, the far bank, the river."""
    D = ctx.D
    polys = [[(x, z) for x, z in r] for r in D["tops"]]
    polys += [[(x0, z0), (x1, z0), (x1, z1), (x0, z1)] for x0, z0, x1, z1 in D["bands"].values()]
    ins = D["inner"]
    town = [(ins["west"], 0.0), (ins["east"], 0.0), (ins["east"], ins["north"]), (ins["west"], ins["north"])]
    polys.append(town)
    segs = []
    for p in polys:
        for j in range(len(p)):
            segs.append((p[j], p[(j + 1) % len(p)]))
    S = np.array([[a[0], a[1], b[0], b[1]] for a, b in segs])
    cell = 3.0
    xs = np.arange(-460, 320, cell)
    zs = np.arange(-60, 430, cell)
    X, Z = np.meshgrid(xs + cell / 2, zs + cell / 2)
    P = np.stack([X.ravel(), Z.ravel()], 1)
    ax, az, bx, bz = S[:, 0], S[:, 1], S[:, 2], S[:, 3]
    dx, dz = bx - ax, bz - az
    L2 = np.maximum(dx * dx + dz * dz, 1e-9)
    t = np.clip(((P[:, 0:1] - ax) * dx + (P[:, 1:2] - az) * dz) / L2, 0, 1)
    dist = np.hypot(ax + t * dx - P[:, 0:1], az + t * dz - P[:, 1:2]).min(1)
    inn = np.zeros(len(P), bool)
    for p in polys:
        q = np.array(p)
        c = np.zeros(len(P), bool)
        for j in range(len(q)):
            x1, z1 = q[j]
            x2, z2 = q[(j + 1) % len(q)]
            m = ((z1 > P[:, 1]) != (z2 > P[:, 1])) & (P[:, 0] < x1 + (P[:, 1] - z1) * (x2 - x1) / ((z2 - z1) if z2 != z1 else 1e-9))
            c ^= m
        inn |= c
    intown = (P[:, 0] > ins["west"]) & (P[:, 0] < ins["east"]) & (P[:, 1] > 0) & (P[:, 1] < ins["north"])
    kinds = np.full(len(P), -1)
    land = P[:, 1] > 0
    kinds[land & intown] = 0
    kinds[land & ~intown & (inn | (dist < 14))] = 1
    kinds[land & ~inn & ~intown & (dist >= 14) & (dist < 34)] = -1
    kinds[land & ~inn & ~intown & (dist >= 34)] = 2
    mats = [flat_mat("prev_street", (0.30, 0.29, 0.27)), flat_mat("prev_grass", (0.20, 0.25, 0.10)),
            flat_mat("prev_field", (0.24, 0.27, 0.12))]
    bm = bmesh.new()
    for (px, pz), kd in zip(P, kinds):
        if kd < 0:
            continue
        x0, x1, z0, z1 = px - cell / 2, px + cell / 2, pz - cell / 2, pz + cell / 2
        vs = [bm.verts.new(B((x, 0.0, z))) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        f.material_index = int(kd)
    me = bpy.data.meshes.new("prev_ground")
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    ob = bpy.data.objects.new("prev_ground", me)
    bpy.context.scene.collection.objects.link(ob)
    for name, y, rgb in (("prev_water", -2.2, (0.10, 0.14, 0.15)), ("prev_bed", -4.5, (0.12, 0.11, 0.09))):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        vs = [bm.verts.new(B((x, y, z))) for x, z in ((-700, -600), (600, -600), (600, 800), (-700, 800))]
        f = bm.faces.new(vs)
        f.normal_update()
        if f.normal.z < 0:
            f.normal_flip()
        bm.to_mesh(me)
        bm.free()
        me.materials.append(flat_mat(name + "_m", rgb))
        o = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(o)


def stage():
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    try:
        sc.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    world = bpy.data.worlds.new("sky")
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (0.55, 0.6, 0.66, 1)
    bg.inputs[1].default_value = 0.9
    sc.world = world
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(3)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_start = 0.1
    cam.data.clip_end = 3000
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shot(cam, name, eye, look, lens=30, res=(1280, 800)):
    bb.aim(cam, B(eye), B(look), lens=lens)
    bb.render(os.path.join(SHOTS, name), res)


def preview(ctx, only=None):
    preview_materials()
    preview_ground(ctx)
    cam = stage()
    D = ctx.D
    h = ctx.h
    views = []
    gates = {g["id"]: g for g in D["gates"]}
    # 1. a gate from the field, like the reference picture of the gate
    gt = gates["rode_poort"]
    F = ctx.frame(gt["side"], gt["at"])
    views.append(("wall_preview_gate.png", F.p(-9.0, 50.0, 5.0), F.p(0.0, 12.0, 5.5), 30))
    # 2. along the walk, a guard house on the side
    t = D["towers"][3]
    Ft = ctx.frame(t["side"], t["at"])
    views.append(("wall_preview_walk.png", Ft.p(-16.0, 2.5, h + 1.7), Ft.p(10.0, 4.5, h + 1.2), 28))
    # 3. a stair from the street
    st = D["stairs"][1]
    Fs, RUN, LAND, W = stair_frame(st, ctx)
    views.append(("wall_preview_stair.png", Fs.p(-7.0, -16.0, 9.0), Fs.p(RUN * 0.55, -1.0, 3.0), 30))
    # 4. a land bastion from above
    _, P = ctx.land_bastions[0]
    cx = sum(p.x for p in P) / len(P)
    cz = sum(p.y for p in P) / len(P)
    views.append(("wall_preview_bastion.png", (cx - 55, 55, cz - 70), (cx, 3, cz), 32))
    # 5. the whole ring from high up
    xs = list(D["inner"].values())
    views.append(("wall_preview_ring.png", (-70, 560, -320), (-70, 0, 170), 32))
    # 6. a gate from the town (the sentry box, the arch, a stair)
    views.append(("wall_preview_gate_town.png", F.p(14.0, -24.0, 8.0), F.p(0.0, 2.0, 4.0), 30))
    # close-ups of joins and corners
    views.append(("wall_close_gatejoin.png", F.p(-16.0, 16.0, 7.0), F.p(-9.0, 7.0, 5.0), 35))
    views.append(("wall_close_gatewalk.png", F.p(-22.0, 3.5, h + 1.7), F.p(-9.0, 3.5, h + 1.5), 35))
    views.append(("wall_close_tower.png", Ft.p(-9.0, 13.0, 4.0), Ft.p(0.0, 8.0, h), 32))
    b = max(P, key=lambda p: (p - ctx.centre).length)
    u = (b - Vector((cx, cz))).normalized()
    views.append(("wall_close_salient.png", (b.x + u.x * 14 + u.y * 5, 5.0, b.y + u.y * 14 - u.x * 5), (b.x, 4.0, b.y), 35))
    views.append(("wall_close_turret.png", (b.x - u.x * 9 + u.y * 2.0, h + 1.8, b.y - u.y * 9 - u.x * 2.0), (b.x, h + 1.4, b.y), 35))
    views.append(("wall_close_stairhead.png", Fs.p(RUN + LAND + 5.0, 2.2, h + 1.7), Fs.p(RUN - 3.0, -0.9, h - 1.2), 32))
    views.append(("wall_close_stairfoot.png", Fs.p(-4.0, -6.0, 2.2), Fs.p(2.0, -1.2, 1.0), 32))
    views.append(("wall_close_hutdoor.png", Ft.p(2.5, 2.2, h + 1.6), Ft.p(0.0, ctx.t + 1.0, h + 1.2), 32))
    views.append(("wall_close_bridgeend.png", F.p(7.0, 47.0, 2.2), F.p(2.0, 40.0, 1.2), 32))
    Rb = [bb_ for bb_ in ctx.river_bastions][0][1]
    rc = Vector((sum(p.x for p in Rb) / len(Rb), sum(p.y for p in Rb) / len(Rb)))
    views.append(("wall_close_river.png", (rc.x - 30, 9.0, rc.y - 40), (rc.x, 0.0, rc.y), 32))
    views.append(("wall_close_arch.png", F.p(3.0, 20.0, 2.5), F.p(0.0, 10.0, 4.2), 30))
    # where a land bastion's flank meets the curtain (a concave corner), from the berm
    sh = P[0]  # the flank's root on the curtain (rampart.py lists it first)
    views.append(("wall_close_flank.png", (sh.x + 16.0 * (1 if sh.x > 0 else -1), 3.0, sh.y - 16.0), (sh.x, 3.5, sh.y + 2.0), 35))
    # the river half-bastion's corner where the low town parapet meets the breastwork, from the walk
    q = min(Rb, key=lambda p: abs(p.y + 10.0) + abs(p.x - (ctx.D["inner"]["east"] if p.x > 0 else ctx.D["inner"]["west"])))
    views.append(("wall_close_parapetjoin.png", (q.x + (3.5 if q.x > 0 else -3.5), h + 1.7, q.y + 6.0), (q.x, h + 0.7, q.y), 35))
    for gid, gg in gates.items():
        Fg = ctx.frame(gg["side"], gg["at"])
        views.append((f"wall_check_{gid}_field.png", Fg.p(-14.0, 48.0, 16.0), Fg.p(0.0, 8.0, 4.0), 30))
        views.append((f"wall_check_{gid}_town.png", Fg.p(12.0, -30.0, 14.0), Fg.p(0.0, 0.0, 4.0), 30))
    for name, eye, look, lens in views:
        if only and not any(o in name for o in only):
            continue
        shot(cam, name, eye, look, lens)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with open(CITY) as f:
        city = json.load(f)
    D = city["decor"]["rampart"]
    ctx = Ctx(D, city["decor"].get("rampart_solids", []))
    ctx.grass, ctx.grass_cuts = grass_areas(ctx)
    make_materials()
    g = build(ctx)
    objs = g.to_objects([gt["id"] for gt in D["gates"]])
    export()
    total = 0
    for n in sorted(objs):
        c = tris(objs[n])
        total += c
        print(f"[build_wall] {n:22s} {c:6d} tris")
    print(f"[build_wall] {len(objs)} objects, {total} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        i = argv.index("--preview")
        only = argv[i + 1].split(",") if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None
        preview(ctx, only)


if __name__ == "__main__":
    main()
