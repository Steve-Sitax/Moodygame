"""The street furniture of the new places (M7 prison and squares, 2026-09-26, docs/milestones/M7-prison-squares.md),
modelled and painted by this script: the Sint-Jansplein's fountain with St John on it, the newspaper kiosk, the
urinal, a park bench, a tree grille, a flower bed, the churchyard's calvary and old grave slabs.

    blender -b --factory-startup -P tools/blender/build_places.py [-- --nocheck]

Writes client/public/models/places.glb (Draco). Each model is a node with its origin at its foot, its front toward
+z (a game point (x, y, z) sits at Blender (x, -z, y)); client/src/world/townplaces.ts places copies where
shared/townplaces.json (tools/city/places.py) says. The ground, the kerbs, the railings and the lawns are drawn in
the game. Materials: pl_stone (pale weathered bluestone), pl_bronze (the statue, green-brown), pl_iron (cast iron
painted dark green), pl_wood, pl_zinc, pl_atlas (the kiosk's posters and papers, the urinal's plate, the slabs'
inscriptions, flowers), pl_water (the basin, drawn a little bright), pl_earth.
"""

import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "places.glb")

MATS = ["pl_stone", "pl_bronze", "pl_iron", "pl_wood", "pl_zinc", "pl_atlas", "pl_water", "pl_earth"]
STONE, BRONZE, IRON, WOOD, ZINC, ATLAS, WATER, EARTH = range(8)
TILE = {STONE: (1.6, 1.6), BRONZE: (1.0, 1.0), IRON: (1.0, 1.0), WOOD: (1.0, 1.0), ZINC: (0.8, 0.8), ATLAS: (1, 1), WATER: (2.0, 2.0), EARTH: (1.5, 1.5)}


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


def C(*rgb):
    return np.array(rgb, dtype=np.float64)


def noise(rng, h, w, amt):
    return 1.0 + (rng.random((h, w, 1)) - 0.5) * 2 * amt


# ------------------------------------------------------------------ the atlas: 256 x 256, cells (x0, y0, w, h), y from the bottom
AT = 256
CELL = {
    "poster_a": (0, 0, 64, 96),  # a theatre bill
    "poster_b": (64, 0, 64, 96),  # a shipping line's sailing list
    "poster_c": (128, 0, 64, 96),  # a sale by auction
    "papers": (192, 0, 64, 64),  # the kiosk's window with the papers hung in it
    "plate": (192, 64, 64, 32),  # the urinal's enamel plate
    "slab": (0, 96, 64, 128),  # an old grave slab with a cross and letters
    "flowers": (64, 96, 64, 64),  # a card of late flowers (asters, dahlias), alpha-free: dark ground behind
    "box": (128, 96, 32, 32),  # clipped box edging
    "dark": (160, 96, 16, 16),
}


def paint_atlas(rng):
    img = np.zeros((AT, AT, 3))

    def region(name):
        x0, y0, w, h = CELL[name]
        return img[AT - y0 - h:AT - y0, x0:x0 + w]

    def lines(r, rows, col, x0=6, w=None, h=2):
        W_ = r.shape[1]
        for y in rows:
            ww = w or int(rng.integers(W_ // 3, W_ - 2 * x0))
            r[y:y + h, x0:x0 + ww] = col

    for name, paper, ink, big in (("poster_a", C(0.78, 0.72, 0.55), C(0.45, 0.08, 0.06), 8), ("poster_b", C(0.7, 0.72, 0.68), C(0.1, 0.12, 0.25), 6),
                                  ("poster_c", C(0.82, 0.8, 0.7), C(0.08, 0.07, 0.06), 7)):
        r = region(name)
        r[:] = paper * noise(rng, r.shape[0], r.shape[1], 0.06)
        r[6:6 + big, 6:58] = ink
        r[8 + big:12 + big, 12:52] = ink * 1.4
        lines(r, range(26, 86, 6), ink * 1.2, h=2)
        # torn corner, damp stain
        r[88:96, 50:64] = C(0.3, 0.26, 0.22)
        r[60:90, 0:18] *= 0.85
    r = region("papers")
    r[:] = C(0.08, 0.07, 0.06)
    for i in range(3):
        for j in range(2):
            x0, y0 = 4 + i * 20, 4 + j * 30
            r[y0:y0 + 26, x0:x0 + 17] = C(0.8, 0.78, 0.7) * rng.uniform(0.85, 1.0)
            r[y0 + 3:y0 + 6, x0 + 2:x0 + 15] = C(0.1, 0.1, 0.1)
            for yy in range(y0 + 9, y0 + 24, 3):
                r[yy, x0 + 2:x0 + 15] = C(0.35, 0.35, 0.35)
    r = region("plate")
    r[:] = C(0.12, 0.2, 0.35)
    r[3:29, 3:61] = C(0.85, 0.85, 0.8)
    r[10:14, 10:54] = C(0.12, 0.2, 0.35)
    r[18:21, 16:48] = C(0.12, 0.2, 0.35)
    r = region("slab")
    r[:] = C(0.42, 0.43, 0.42) * noise(rng, 128, 64, 0.1)
    r[14:62, 29:35] = C(0.25, 0.25, 0.25)
    r[26:32, 18:46] = C(0.25, 0.25, 0.25)
    for y in range(72, 120, 8):
        r[y:y + 3, 10:54 - int(rng.integers(0, 16))] = C(0.28, 0.28, 0.27)
    yy, xx = np.mgrid[0:128, 0:64]
    moss = (rng.random((128, 64)) < 0.08) & (yy > 90)
    r[moss] = C(0.2, 0.26, 0.12)
    r = region("flowers")
    r[:] = C(0.05, 0.07, 0.03)
    for _ in range(90):
        x, y = int(rng.integers(2, 62)), int(rng.integers(2, 62))
        col = [C(0.62, 0.36, 0.65), C(0.75, 0.25, 0.12), C(0.85, 0.7, 0.25), C(0.8, 0.8, 0.75), C(0.55, 0.1, 0.18)][int(rng.integers(0, 5))]
        r[y - 2:y + 2, x - 2:x + 2] = col * rng.uniform(0.7, 1.0)
        r[y + 2:y + 8, x:x + 1] = C(0.12, 0.22, 0.08)
    r = region("box")
    r[:] = C(0.1, 0.2, 0.08) * noise(rng, 32, 32, 0.3)
    region("dark")[:] = C(0.04, 0.04, 0.04)
    return img


def cell_uv(name, fu, fv):
    x0, y0, w, h = CELL[name]
    e = 0.5 / AT
    return ((x0 + fu * w) / AT * (1 - 2 * e) + e, (y0 + fv * h) / AT * (1 - 2 * e) + e)


def paint_flat(rng, rgb, n=32, amt=0.08):
    return np.ones((n, n, 3)) * C(*rgb) * noise(rng, n, n, amt)


def paint_stone(rng, n=64):
    img = np.ones((n, n, 3)) * C(0.46, 0.47, 0.47) * noise(rng, n, n, 0.07)
    for y in range(0, n, 16):
        img[y, :] = C(0.3, 0.3, 0.3)
    return img


def paint_bronze(rng, n=32):
    img = np.ones((n, n, 3)) * C(0.2, 0.24, 0.18) * noise(rng, n, n, 0.18)
    streak = rng.random((n, n)) < 0.15
    img[streak] = C(0.26, 0.38, 0.3)
    return img


def make_materials():
    rng = np.random.default_rng(1868)
    paint = {
        "pl_stone": lambda: paint_stone(rng),
        "pl_bronze": lambda: paint_bronze(rng),
        "pl_iron": lambda: paint_flat(rng, (0.07, 0.11, 0.08), 16, 0.12),
        "pl_wood": lambda: paint_flat(rng, (0.32, 0.23, 0.15), 32, 0.12),
        "pl_zinc": lambda: paint_flat(rng, (0.36, 0.38, 0.38), 16, 0.06),
        "pl_atlas": lambda: paint_atlas(rng),
        "pl_water": lambda: paint_flat(rng, (0.12, 0.16, 0.17), 32, 0.15),
        "pl_earth": lambda: paint_flat(rng, (0.13, 0.1, 0.07), 32, 0.2),
    }
    for name in MATS:
        arr = np.clip(paint[name](), 0, 1)[::-1]
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
        m.use_backface_culling = name not in ("pl_iron", "pl_atlas")


def planar(pts, n, mat):
    tu, tv = TILE[mat]
    h = math.hypot(n.x, n.z)
    if h < 0.05:
        return [(p.x / tu, p.z / tv) for p in pts]
    hd = Vector((n.z, 0.0, -n.x)) / h
    w = n.cross(hd)
    return [(p.dot(hd) / tu, p.dot(w) / tv) for p in pts]


class Geo:
    def __init__(self):
        self.groups = {}
        self.grp = None

    def face(self, pts, mat, out=None, uvs=None, k=1.0, cell=None):
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
            uvs = [cell_uv(cell or "dark", 0.5, 0.5)] * len(pts) if mat == ATLAS else planar(pts, n, mat)
        # a little darker low down (the splash of the street) and on the undersides
        cols = [(0.8 + 0.2 * min(1.0, max(0.0, p.y / 0.8))) * k * (0.75 if n.y < -0.5 else 1.0) for p in pts]
        self.groups.setdefault(self.grp, []).append((pts, uvs, cols, mat))

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


FACES = {"-x": (-1, 0, 0), "+x": (1, 0, 0), "-y": (0, -1, 0), "+y": (0, 1, 0), "-z": (0, 0, -1), "+z": (0, 0, 1)}


def box(g, x0, x1, y0, y1, z0, z1, mat, skip=(), k=1.0, cells=None):
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
        g.face(pts, mat, out=FACES[name], k=k)


def ngon(c, r, n, rot=0.0):
    return [(c[0] + r * math.cos(rot + 2 * math.pi * i / n), c[1] + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def prism(g, pts, y0, y1, mat, top=True, bottom=False, k=1.0, top_mat=None):
    n = len(pts)
    cx = sum(p[0] for p in pts) / n
    cz = sum(p[1] for p in pts) / n
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        g.face([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], mat, out=((a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz), k=k)
    if top:
        g.face([(p[0], y1, p[1]) for p in pts], top_mat if top_mat is not None else mat, out=(0, 1, 0), k=k)
    if bottom:
        g.face([(p[0], y0, p[1]) for p in pts], mat, out=(0, -1, 0), k=k)


def lathe(g, c, prof, n, mat, k=1.0, y0=0.0):
    """A turned shape round the upright through c=(x, z): prof [(r, y)] from the bottom up."""
    for (r0, ya), (r1, yb) in zip(prof, prof[1:]):
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            am = (a0 + a1) / 2
            q = [(c[0] + r0 * math.cos(a0), y0 + ya, c[1] + r0 * math.sin(a0)), (c[0] + r0 * math.cos(a1), y0 + ya, c[1] + r0 * math.sin(a1)),
                 (c[0] + r1 * math.cos(a1), y0 + yb, c[1] + r1 * math.sin(a1)), (c[0] + r1 * math.cos(a0), y0 + yb, c[1] + r1 * math.sin(a0))]
            if r0 < 1e-6:
                q = [q[0], q[2], q[3]]
            elif r1 < 1e-6:
                q = q[:3]
            dr = r1 - r0
            dy = yb - ya
            ny = -dr / max(1e-6, math.hypot(dr, dy))
            g.face(q, mat, out=(math.cos(am), ny * 2, math.sin(am)), k=k)


def bar(g, a, b, w, mat=IRON, k=1.0):
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
        g.face([P[i], P[j], Q[j], Q[i]], mat, out=tuple((P[i] + P[j]) / 2 - a), k=k)
    g.face(list(reversed(P)), mat, out=tuple(-d), k=k)
    g.face(Q, mat, out=tuple(d), k=k)


def sphere(g, c, r, mat, n=8, m=5, k=1.0):
    prof = [(r * math.sin(math.pi * i / m), -r * math.cos(math.pi * i / m)) for i in range(m + 1)]
    lathe(g, (c[0], c[2]), prof, n, mat, k=k, y0=c[1])


# ------------------------------------------------------------------ the models


def figure(g, x, y, z, h, mat=BRONZE, yaw=0.0, staff=True, lamb=True):
    """St John the Baptist, standing: a camel-hair robe, the right arm raised pointing, a staff with a cross in the
    left hand, the lamb at his feet. Faces +z (turned by yaw)."""
    s = h / 1.9
    cy, sy = math.cos(yaw), math.sin(yaw)
    R = lambda px, pz: (x + px * cy + pz * sy, z - px * sy + pz * cy)  # noqa: E731
    # the robe and body: a turned figure (a little forward at the knee)
    prof = [(0.26, 0.0), (0.27, 0.08), (0.24, 0.5), (0.21, 0.9), (0.2, 1.15), (0.23, 1.3), (0.24, 1.42), (0.16, 1.52), (0.08, 1.56)]
    lathe(g, R(0, 0), [(r * s, yy * s) for r, yy in prof], 10, mat, y0=y)
    # the head and the beard
    sphere(g, (*R(0, 0.02 * s)[:1], y + 1.68 * s, R(0, 0.02 * s)[1]) if False else (R(0, 0.02 * s)[0], y + 1.68 * s, R(0, 0.02 * s)[1]), 0.12 * s, mat)
    bx, bz = R(0, 0.09 * s)
    prism(g, ngon((bx, bz), 0.06 * s, 5), y + 1.52 * s, y + 1.64 * s, mat)
    # the right arm raised, pointing (Ecce Agnus Dei)
    sh = R(-0.22 * s, 0)
    el = R(-0.3 * s, 0.15 * s)
    hd = R(-0.28 * s, 0.38 * s)
    bar(g, (sh[0], y + 1.38 * s, sh[1]), (el[0], y + 1.22 * s, el[1]), 0.1 * s, mat)
    bar(g, (el[0], y + 1.22 * s, el[1]), (hd[0], y + 1.45 * s, hd[1]), 0.08 * s, mat)
    sphere(g, (hd[0], y + 1.47 * s, hd[1]), 0.05 * s, mat, n=6, m=3)
    # the left arm down to the staff
    sl = R(0.22 * s, 0)
    hl = R(0.3 * s, 0.12 * s)
    bar(g, (sl[0], y + 1.38 * s, sl[1]), (hl[0], y + 1.0 * s, hl[1]), 0.09 * s, mat)
    if staff:
        st = R(0.33 * s, 0.14 * s)
        bar(g, (st[0], y + 0.02 * s, st[1]), (st[0], y + 2.05 * s, st[1]), 0.035 * s, mat)
        a, b = R(0.23 * s, 0.14 * s), R(0.43 * s, 0.14 * s)
        bar(g, (a[0], y + 1.86 * s, a[1]), (b[0], y + 1.86 * s, b[1]), 0.03 * s, mat)
    if lamb:
        lc = R(-0.16 * s, 0.28 * s)
        box_rot(g, lc, y + 0.12 * s, 0.13 * s, 0.1 * s, 0.22 * s, yaw + 0.4, mat)
        hc = R(-0.16 * s + 0.0, 0.28 * s + 0.2 * s)
        sphere(g, (hc[0], y + 0.26 * s, hc[1]), 0.06 * s, mat, n=6, m=3)
        for dx, dz in ((-0.07, -0.13), (0.07, -0.13), (-0.07, 0.13), (0.07, 0.13)):
            lp = R(-0.16 * s + dx * s, 0.28 * s + dz * s)
            bar(g, (lp[0], y, lp[1]), (lp[0], y + 0.1 * s, lp[1]), 0.03 * s, mat)


def box_rot(g, c, y, hx, hy, hz, yaw, mat):
    """A box of half sizes hx, hy, hz at (c, y) turned by yaw."""
    cy, sy = math.cos(yaw), math.sin(yaw)
    P = lambda px, py, pz: (c[0] + px * cy + pz * sy, y + py, c[1] - px * sy + pz * cy)  # noqa: E731
    v = [P(a, b, d) for a in (-hx, hx) for b in (-hy, hy) for d in (-hz, hz)]
    # corners: index = ia*4 + ib*2 + id
    F = [((0, 1, 3, 2), (-cy, 0, sy)), ((4, 6, 7, 5), (cy, 0, -sy)), ((0, 4, 5, 1), (0, -1, 0)), ((2, 3, 7, 6), (0, 1, 0)),
         ((0, 2, 6, 4), (-sy, 0, -cy)), ((1, 5, 7, 3), (sy, 0, cy))]
    for idx, o in F:
        g.face([v[i] for i in idx], mat, out=o)


def fountain(g):
    """An octagonal stone basin with a moulded rim, the water in it, a pedestal in the middle with a cup and four
    spouts, and St John on top."""
    g.grp = "fountain"
    c = (0.0, 0.0)
    R = 2.4
    ring_o = ngon(c, R, 8, math.pi / 8)
    ring_i = ngon(c, R - 0.3, 8, math.pi / 8)
    # the basin wall: outer face, a coping over it, the inner face
    prism(g, ngon(c, R + 0.12, 8, math.pi / 8), 0.02, 0.18, STONE, top=False, k=0.85)  # the step
    for i in range(8):
        a, b = ring_o[i], ring_o[(i + 1) % 8]
        p, q = ring_i[i], ring_i[(i + 1) % 8]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        g.face([(a[0], 0.18, a[1]), (b[0], 0.18, b[1]), (b[0], 0.5, b[1]), (a[0], 0.5, a[1])], STONE, out=(mx, 0, mz))
        g.face([(p[0], 0.25, p[1]), (q[0], 0.25, q[1]), (q[0], 0.5, q[1]), (p[0], 0.5, p[1])], STONE, out=(-mx, 0, -mz), k=0.75)
    g.face([(p[0], 0.18, p[1]) for p in ngon(c, R + 0.12, 8, math.pi / 8)], STONE, out=(0, 1, 0), k=0.8)
    # the coping, proud each side
    co = ngon(c, R + 0.08, 8, math.pi / 8)
    ci = ngon(c, R - 0.36, 8, math.pi / 8)
    for i in range(8):
        a, b = co[i], co[(i + 1) % 8]
        p, q = ci[i], ci[(i + 1) % 8]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        g.face([(a[0], 0.62, a[1]), (b[0], 0.62, b[1]), (q[0], 0.62, q[1]), (p[0], 0.62, p[1])], STONE, out=(0, 1, 0))
        g.face([(a[0], 0.5, a[1]), (b[0], 0.5, b[1]), (b[0], 0.62, b[1]), (a[0], 0.62, a[1])], STONE, out=(mx, 0, mz), k=0.9)
        g.face([(p[0], 0.5, p[1]), (q[0], 0.5, q[1]), (q[0], 0.62, q[1]), (p[0], 0.62, p[1])], STONE, out=(-mx, 0, -mz), k=0.7)
        g.face([(a[0], 0.5, a[1]), (b[0], 0.5, b[1]), (ring_o[(i + 1) % 8][0], 0.5, ring_o[(i + 1) % 8][1]), (ring_o[i][0], 0.5, ring_o[i][1])], STONE, out=(0, -1, 0), k=0.5)
        g.face([(p[0], 0.5, p[1]), (q[0], 0.5, q[1]), (ring_i[(i + 1) % 8][0], 0.5, ring_i[(i + 1) % 8][1]), (ring_i[i][0], 0.5, ring_i[i][1])], STONE, out=(0, -1, 0), k=0.5)
    # the water
    g.face([(p[0], 0.4, p[1]) for p in ring_i], WATER, out=(0, 1, 0))
    # the pedestal: an octagonal shaft on a base, a cup, a capital, a plinth for the statue
    lathe(g, c, [(0.55, 0.0), (0.55, 0.62), (0.42, 0.72), (0.34, 0.8), (0.3, 1.5), (0.34, 1.56), (0.7, 1.62), (0.82, 1.72), (0.8, 1.82), (0.3, 1.9),
                 (0.28, 2.6), (0.4, 2.66), (0.42, 2.8), (0.36, 2.86)], 8, STONE, y0=0.3)
    g.face([(p[0], 3.16, p[1]) for p in ngon(c, 0.36, 8)], STONE, out=(0, 1, 0))
    # the water in the cup
    g.face([(p[0], 2.1, p[1]) for p in ngon(c, 0.72, 8)], WATER, out=(0, 1, 0))
    # four spouts: lion masks as bronze discs with a pipe
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        px, pz = 0.34 * math.cos(a), 0.34 * math.sin(a)
        sphere(g, (px, 1.25, pz), 0.12, BRONZE, n=6, m=3)
        bar(g, (px, 1.22, pz), (px + 0.28 * math.cos(a), 1.2, pz + 0.28 * math.sin(a)), 0.04, BRONZE)
        # the water falling from it
        g.face([(px + 0.3 * math.cos(a) - 0.03 * math.sin(a), 1.2, pz + 0.3 * math.sin(a) + 0.03 * math.cos(a)),
                (px + 0.3 * math.cos(a) + 0.03 * math.sin(a), 1.2, pz + 0.3 * math.sin(a) - 0.03 * math.cos(a)),
                (px + 0.62 * math.cos(a) + 0.03 * math.sin(a), 0.41, pz + 0.62 * math.sin(a) - 0.03 * math.cos(a)),
                (px + 0.62 * math.cos(a) - 0.03 * math.sin(a), 0.41, pz + 0.62 * math.sin(a) + 0.03 * math.cos(a))], WATER, out=(math.cos(a), 0.3, math.sin(a)))
    # St John
    figure(g, 0.0, 3.16, 0.0, 1.95, yaw=0.0)


def kiosk(g):
    """A newspaper kiosk: hexagonal, cast-iron posts, the panels pasted with bills, a window with the papers, a
    zinc roof with a finial, a small awning over the window. Its window faces +z."""
    g.grp = "kiosk"
    c = (0.0, 0.0)
    R = 1.1
    ring = ngon(c, R, 6, math.pi / 6 + math.pi / 2)
    prism(g, ngon(c, R + 0.08, 6, math.pi / 6 + math.pi / 2), 0.02, 0.2, STONE, top=True)
    posters = ["poster_a", "poster_b", "poster_c"]
    for i in range(6):
        a, b = ring[i], ring[(i + 1) % 6]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        front = mz > 0.8 and abs(mx) < 0.3
        # the dado: iron panel
        g.face([(a[0], 0.2, a[1]), (b[0], 0.2, b[1]), (b[0], 1.0, b[1]), (a[0], 1.0, a[1])], IRON, out=(mx, 0, mz))
        if front:
            # the window with the papers, the counter under it
            g.face([(a[0], 1.0, a[1]), (b[0], 1.0, b[1]), (b[0], 2.1, b[1]), (a[0], 2.1, a[1])], ATLAS, out=(mx, 0, mz),
                   uvs=[cell_uv("papers", 0, 0), cell_uv("papers", 1, 0), cell_uv("papers", 1, 1), cell_uv("papers", 0, 1)])
            box(g, min(a[0], b[0]), max(a[0], b[0]), 1.0, 1.06, mz - 0.05, mz + 0.25, WOOD)
            # the awning
            g.face([(a[0] * 1.05, 2.35, a[1] * 1.05), (b[0] * 1.05, 2.35, b[1] * 1.05), (b[0] * 1.05 + 0.0, 2.1, b[1] * 1.05 + 0.5), (a[0] * 1.05, 2.1, a[1] * 1.05 + 0.5)], ZINC,
                   out=(0, 1, 1))
            g.face([(a[0] * 1.05, 2.35, a[1] * 1.05), (b[0] * 1.05, 2.35, b[1] * 1.05), (b[0] * 1.05 + 0.0, 2.1, b[1] * 1.05 + 0.5), (a[0] * 1.05, 2.1, a[1] * 1.05 + 0.5)], ZINC,
                   out=(0, -1, -1), k=0.5)
        else:
            cell = posters[i % 3]
            g.face([(a[0], 1.0, a[1]), (b[0], 1.0, b[1]), (b[0], 2.4, b[1]), (a[0], 2.4, a[1])], ATLAS, out=(mx, 0, mz),
                   uvs=[cell_uv(cell, 0, 0), cell_uv(cell, 1, 0), cell_uv(cell, 1, 1), cell_uv(cell, 0, 1)])
        g.face([(a[0], 2.4 if not front else 2.1, a[1]), (b[0], 2.4 if not front else 2.1, b[1]), (b[0], 2.7, b[1]), (a[0], 2.7, a[1])], IRON, out=(mx, 0, mz))
        # the post at the corner
        bar(g, (a[0], 0.2, a[1]), (a[0], 2.75, a[1]), 0.08, IRON)
    # the cornice and the roof: a bell-shaped zinc dome in six faces, a finial
    prism(g, ngon(c, R + 0.12, 6, math.pi / 6 + math.pi / 2), 2.7, 2.82, IRON, top=False, bottom=True)
    lathe(g, c, [(R + 0.18, 0.0), (R + 0.05, 0.12), (0.85, 0.35), (0.45, 0.62), (0.15, 0.75), (0.0, 0.78)], 6, ZINC, y0=2.82)
    bar(g, (0, 3.55, 0), (0, 3.95, 0), 0.04, IRON)
    sphere(g, (0, 3.98, 0), 0.06, IRON, n=6, m=3)


def urinal(g):
    """A cast-iron urinal for two: a curved screen on legs, a stone step, a small roof with a lantern top, the
    enamel plate. The open side faces -z (toward the tree), the screen's back +z."""
    g.grp = "urinal"
    n = 8
    r = 0.85
    # the stone step inside
    pts = [(r * math.cos(math.pi * i / n), -r * math.sin(math.pi * i / n) * 0 + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    pts = [(r * math.cos(math.pi * i / n), r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    g.face([(0.0, 0.1, 0.0)] + [(x, 0.1, z) for x, z in pts], STONE, out=(0, 1, 0))
    # the screen: panels from 0.3 to 1.9 m, each a face both ways (iron is drawn double-sided)
    for i in range(n):
        (x0, z0), (x1, z1) = pts[i], pts[i + 1]
        g.face([(x0, 0.3, z0), (x1, 0.3, z1), (x1, 1.9, z1), (x0, 1.9, z0)], IRON, out=((x0 + x1) / 2, 0, (z0 + z1) / 2))
        # a pierced band at the top (dark)
        g.face([(x0 * 1.01, 1.7, z0 * 1.01), (x1 * 1.01, 1.7, z1 * 1.01), (x1 * 1.01, 1.82, z1 * 1.01), (x0 * 1.01, 1.82, z0 * 1.01)], ATLAS,
               out=((x0 + x1) / 2, 0, (z0 + z1) / 2), cell="dark")
        bar(g, (x0, 0.0, z0), (x0, 2.0, z0), 0.05, IRON)
    bar(g, pts[-1] and (pts[-1][0], 0.0, pts[-1][1]), (pts[-1][0], 2.0, pts[-1][1]), 0.05, IRON)
    # the middle divider, the plate
    g.face([(0.0, 0.3, 0.05), (0.0, 0.3, 0.8), (0.0, 1.7, 0.8), (0.0, 1.7, 0.05)], IRON, out=(1, 0, 0))
    g.face([(-0.25, 1.95, 0.87), (0.25, 1.95, 0.87), (0.25, 2.2, 0.87), (-0.25, 2.2, 0.87)], ATLAS, out=(0, 0, 1),
           uvs=[cell_uv("plate", 1, 0), cell_uv("plate", 0, 0), cell_uv("plate", 0, 1), cell_uv("plate", 1, 1)])
    # the roof: a flat iron canopy over the screen, a little lantern-shaped top
    ro = [(1.05 * x, 1.05 * z) for x, z in pts]
    g.face([(0.0, 2.25, -0.15)] + [(x, 2.25, z) for x, z in ro], IRON, out=(0, 1, 0))
    g.face([(0.0, 2.2, -0.15)] + [(x, 2.2, z) for x, z in ro], IRON, out=(0, -1, 0))
    for i in range(n):
        (x0, z0), (x1, z1) = ro[i], ro[i + 1]
        g.face([(x0, 2.2, z0), (x1, 2.2, z1), (x1, 2.25, z1), (x0, 2.25, z0)], IRON, out=((x0 + x1) / 2, 0, (z0 + z1) / 2))
    lathe(g, (0.0, 0.4), [(0.22, 0.0), (0.2, 0.3), (0.12, 0.38), (0.0, 0.5)], 6, IRON, y0=2.25)


def bench(g):
    """A park bench: two cast-iron ends with scrolls, three seat slats and two back slats. The sitter faces +z."""
    g.grp = "bench"
    for x in (-0.8, 0.8):
        bar(g, (x, 0.0, 0.15), (x, 0.44, 0.15), 0.05)
        bar(g, (x, 0.0, -0.2), (x, 0.44, -0.2), 0.05)
        bar(g, (x, 0.44, 0.22), (x, 0.44, -0.24), 0.05)
        bar(g, (x, 0.44, -0.24), (x, 0.9, -0.34), 0.05)
        bar(g, (x, 0.62, 0.2), (x, 0.62, -0.26), 0.035)
    for z in (0.14, 0.0, -0.14):
        box(g, -0.95, 0.95, 0.44, 0.475, z - 0.055, z + 0.055, WOOD)
    for yy in (0.6, 0.78):
        zz = -0.26 - (yy - 0.44) * 0.2
        box(g, -0.95, 0.95, yy - 0.05, yy + 0.05, zz - 0.02, zz + 0.02, WOOD)


def grille(g):
    """A cast-iron tree grille round a trunk: a square frame of 1.3 m with radial bars, lying 1 cm over the ground."""
    g.grp = "tree_grille"
    h = 0.65
    y = 0.012
    for (a, b) in (((-h, -h), (h, -h)), ((h, -h), (h, h)), ((h, h), (-h, h)), ((-h, h), (-h, -h))):
        bar(g, (a[0], y, a[1]), (b[0], y, b[1]), 0.04)
    for k in range(12):
        ang = 2 * math.pi * k / 12
        r1 = h / max(abs(math.cos(ang)), abs(math.sin(ang)))
        bar(g, (0.25 * math.cos(ang), y, 0.25 * math.sin(ang)), (r1 * math.cos(ang), y, r1 * math.sin(ang)), 0.03)
    for i in range(12):
        a0, a1 = 2 * math.pi * i / 12, 2 * math.pi * (i + 1) / 12
        bar(g, (0.25 * math.cos(a0), y, 0.25 * math.sin(a0)), (0.25 * math.cos(a1), y, 0.25 * math.sin(a1)), 0.03)


def flowerbed(g):
    """A round bed of late flowers, 1 m across (the game scales it): a clipped box edging and clumps of asters and
    dahlias on crossed cards, over a bed of dark earth."""
    g.grp = "flowerbed"
    ring = ngon((0, 0), 1.0, 16)
    inner = ngon((0, 0), 0.9, 16)
    g.face([(p[0], 0.02, p[1]) for p in ring], EARTH, out=(0, 1, 0))
    for i in range(16):
        a, b = ring[i], ring[(i + 1) % 16]
        p, q = inner[i], inner[(i + 1) % 16]
        mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        g.face([(a[0], 0.0, a[1]), (b[0], 0.0, b[1]), (b[0], 0.2, b[1]), (a[0], 0.2, a[1])], ATLAS, out=(mx, 0, mz),
               uvs=[cell_uv("box", 0, 0), cell_uv("box", 1, 0), cell_uv("box", 1, 1), cell_uv("box", 0, 1)])
        g.face([(a[0], 0.2, a[1]), (b[0], 0.2, b[1]), (q[0], 0.2, q[1]), (p[0], 0.2, p[1])], ATLAS, out=(0, 1, 0),
               uvs=[cell_uv("box", 0, 0), cell_uv("box", 1, 0), cell_uv("box", 1, 1), cell_uv("box", 0, 1)])
        g.face([(p[0], 0.02, p[1]), (q[0], 0.02, q[1]), (q[0], 0.2, q[1]), (p[0], 0.2, p[1])], ATLAS, out=(-mx, 0, -mz),
               uvs=[cell_uv("box", 0, 0), cell_uv("box", 1, 0), cell_uv("box", 1, 1), cell_uv("box", 0, 1)])
    rng = np.random.default_rng(7)
    for k in range(9):
        r = 0.62 * math.sqrt(rng.random())
        a = rng.random() * 2 * math.pi
        cx, cz = r * math.cos(a), r * math.sin(a)
        h = 0.35 + 0.25 * rng.random()
        w = 0.22 + 0.1 * rng.random()
        for ang in (0.0, math.pi / 2):
            dx, dz = w * math.cos(ang + a), w * math.sin(ang + a)
            g.face([(cx - dx, 0.02, cz - dz), (cx + dx, 0.02, cz + dz), (cx + dx, h, cz + dz), (cx - dx, h, cz - dz)], ATLAS,
                   out=(-dz, 0, dx), uvs=[cell_uv("flowers", 0, 0), cell_uv("flowers", 1, 0), cell_uv("flowers", 1, 1), cell_uv("flowers", 0, 1)])


def calvary(g):
    """A churchyard calvary: a stepped stone base, a tall wooden cross with a small roof, the corpus in bronze. Faces +z."""
    g.grp = "calvary"
    box(g, -1.0, 1.0, 0.02, 0.3, -0.8, 0.8, STONE)
    box(g, -0.7, 0.7, 0.3, 0.6, -0.55, 0.55, STONE)
    box(g, -0.3, 0.3, 0.6, 1.1, -0.3, 0.3, STONE)
    box(g, -0.08, 0.08, 1.1, 4.3, -0.08, 0.08, WOOD)
    box(g, -0.8, 0.8, 3.35, 3.5, -0.075, 0.075, WOOD)
    # the little roof over the cross
    for s in (-1, 1):
        g.face([(-0.95, 4.2, 0.0), (0.95, 4.2, 0.0), (0.95, 4.05, s * 0.28), (-0.95, 4.05, s * 0.28)], WOOD, out=(0, 1, s))
        g.face([(-0.95, 4.2, 0.0), (0.95, 4.2, 0.0), (0.95, 4.05, s * 0.28), (-0.95, 4.05, s * 0.28)], WOOD, out=(0, -1, -s), k=0.5)
    # the corpus
    lathe(g, (0.0, 0.12), [(0.07, 0.0), (0.09, 0.3), (0.12, 0.55), (0.1, 0.75), (0.0, 0.8)], 6, BRONZE, y0=2.55)
    sphere(g, (0.0, 3.45, 0.14), 0.08, BRONZE, n=6, m=3)
    bar(g, (-0.1, 3.3, 0.12), (-0.62, 3.42, 0.1), 0.05, BRONZE)
    bar(g, (0.1, 3.3, 0.12), (0.62, 3.42, 0.1), 0.05, BRONZE)
    # an iron railing round the base
    for (a, b) in (((-1.1, 0.9), (1.1, 0.9)), ((1.1, 0.9), (1.1, -0.9)), ((-1.1, -0.9), (-1.1, 0.9))):
        bar(g, (a[0], 0.55, a[1]), (b[0], 0.55, b[1]), 0.03)
        for t in np.linspace(0, 1, 7):
            px, pz = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
            bar(g, (px, 0.02, pz), (px, 0.62, pz), 0.025)


def slabs(g):
    """Three old grave slabs set up against a church wall, leaning a little, one broken. Their backs toward -z."""
    g.grp = "slabs"
    for k, (x, h, lean, w) in enumerate(((-0.75, 1.7, 0.08, 0.7), (0.05, 1.45, 0.05, 0.62), (0.8, 1.2, 0.1, 0.66))):
        t = 0.1
        z0 = 0.05 + k * 0.02
        top = h * math.cos(lean)
        dz = h * math.sin(lean)
        pts_f = [(x - w / 2, 0.0, z0 + t + dz * 0 + 0.12), (x + w / 2, 0.0, z0 + t + 0.12), (x + w / 2, top, z0 + t), (x - w / 2, top, z0 + t)]
        g.face(pts_f, ATLAS, out=(0, 0.1, 1), uvs=[cell_uv("slab", 0, 0), cell_uv("slab", 1, 0), cell_uv("slab", 1, 1), cell_uv("slab", 0, 1)])
        pts_b = [(x - w / 2, 0.0, z0 + 0.12), (x + w / 2, 0.0, z0 + 0.12), (x + w / 2, top, z0), (x - w / 2, top, z0)]
        g.face(pts_b, STONE, out=(0, -0.1, -1), k=0.6)
        for (a, b, c_, d, o) in ((pts_f[1], pts_b[1], pts_b[2], pts_f[2], (1, 0, 0)), (pts_f[0], pts_b[0], pts_b[3], pts_f[3], (-1, 0, 0)), (pts_f[3], pts_f[2], pts_b[2], pts_b[3], (0, 1, 0))):
            g.face([a, b, c_, d], STONE, out=o, k=0.85)


# ------------------------------------------------------------------ export


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=16, export_draco_texcoord_quantization=14,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    g = Geo()
    fountain(g)
    kiosk(g)
    urinal(g)
    bench(g)
    grille(g)
    flowerbed(g)
    calvary(g)
    slabs(g)
    objs = g.to_objects()
    export()
    for n, o in sorted(objs.items()):
        print(f"[build_places] {n:12s} {sum(len(p.vertices) - 2 for p in o.data.polygons):6d} tris")
    print(f"[build_places] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
