"""Street and quay props of Antwerp, 1873, modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_props.py
    blender -b --factory-startup -P tools/blender/build_props.py -- --preview
    blender -b --factory-startup -P tools/blender/build_props.py -- --closeup dray_hitched,horse out.png [azimuth]

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

MATS = ["wood", "wood_dark", "iron", "rope", "sackcloth", "crate", "barrel", "stone", "glass", "horse", "horsehair", "leather"]
WOOD, DARK, IRON, ROPE, SACK, CRATE, BARREL, STONE, GLASS, HORSE, HAIR, LEATHER = range(len(MATS))

S = 64

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


def paint_crate(seed):
    """Pine boards (vertical) with a stencilled shipping mark."""
    rng = np.random.default_rng(seed)
    img = paint_planks(seed, (0.56, 0.45, 0.30), boards=4, joints=False, knots=2).transpose(1, 0, 2).copy()
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    dia = np.abs(uu - 32) + np.abs(vv - 32)
    mark = (dia > 13) & (dia < 15.5)
    mark |= (np.abs(vv - 32) < 2) & (np.abs(uu - 32) < 7)
    mark |= (np.abs(vv - 12) < 2) & (np.abs(uu - 32) < 12) & ((uu // 4) % 2 == 0)
    mark &= rng.random((S, S)) < 0.75
    img[mark] = img[mark] * 0.3 + col((0.08, 0.07, 0.06)) * 0.4
    return img


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
    def __init__(self, ao=0.45):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.float_color.new("Col")
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


def sack(m, seed, L=0.9, W=0.52, H=0.27):
    """A full jute sack lying down, long along X, tied ends pinched flat."""
    rng = random.Random(seed)
    nx, na = 7, 10
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
    m.grid(rings, SACK, cap0=True, cap1=True, uvfn=lambda p: (p.x / L + 0.5, p.y / L + 0.5))
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


def handcart(loaded=False):
    """The dockers' two-wheeled push cart: big wheels, a plank bed, long shafts."""
    m = Mesh()
    R, zf = 0.62, 0.72
    for sx in (-1, 1):
        wheel(m, (sx * 0.64, 0.1, R), R, 0.065, 12, 14)
    m.beam((-0.72, 0.1, R), (0.72, 0.1, R), 0.045, 0.045, IRON, side=(0, 1, 0))
    m.beam((-0.5, 0.1, R + 0.03), (0.5, 0.1, R + 0.03), 0.1, 0.07, DARK, side=(0, 1, 0))
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
    if loaded:
        for i, y in enumerate((-0.42, 0.12, 0.66)):
            with m.at(move(0, y, top) @ rot_z(math.pi / 2 + 1.52 + 0.06 * i)):
                sack(m, 20 + i, L=0.88, W=0.5, H=0.26)
        for i, y in enumerate((-0.15, 0.42)):
            with m.at(move(0.03 * i, y, top + 0.23) @ rot_z(math.pi / 2 + 1.5 - 0.1 * i) @ Matrix.Rotation(0.05, 4, "X")):
                sack(m, 30 + i, L=0.86, W=0.5, H=0.26)
    return m


DRAY_HORSE_Y = -3.2  # where the horse stands in front of the hitched dray (Blender y)


def dray(hitched=False):
    """Four-wheeled flat dray for one horse: plank bed on sills, fore-carriage on a turntable."""
    m = Mesh()
    for sx in (-1, 1):
        wheel(m, (sx * 0.8, 1.25, 0.52), 0.52, 0.07, 12, 14)
        wheel(m, (sx * 0.76, -1.15, 0.42), 0.42, 0.065, 10, 12)
    # rear axle and bolster
    m.beam((-0.88, 1.25, 0.52), (0.88, 1.25, 0.52), 0.1, 0.1, DARK, side=(0, 1, 0))
    m.box((0, 1.25, 0.71), (1.25, 0.14, 0.28), DARK)
    # fore-carriage: axle, bolster, turntable, upper bolster
    m.beam((-0.84, -1.15, 0.42), (0.84, -1.15, 0.42), 0.1, 0.1, DARK, side=(0, 1, 0))
    m.box((0, -1.15, 0.55), (1.15, 0.14, 0.18), DARK)
    with m.at(move(0, -1.15, 0)):
        m.lathe([(0.38, 0.64), (0.38, 0.70)], 10, IRON, smooth=False, cap1=True)
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
    # shafts: resting on the ground, or up at a horse's shoulders
    tip_z, tip_y = (1.12, -3.95) if hitched else (0.05, -3.85)
    for sx in (-1, 1):
        m.beam((sx * 0.52, -1.2, 0.56), (sx * 0.43, tip_y, tip_z), 0.075, 0.09, DARK, w2=0.05, h2=0.06)
        if hitched:
            m.beam((sx * 0.43, tip_y + 0.12, tip_z), (sx * 0.43, tip_y - 0.02, tip_z + 0.02), 0.06, 0.07, IRON)
    f = (1.75 - 1.2) / (-tip_y - 1.2)
    zc = 0.56 + (tip_z - 0.56) * f
    xc = 0.52 - 0.09 * f
    m.beam((-xc, -1.75, zc), (xc, -1.75, zc), 0.06, 0.06, DARK, side=(0, 1, 0))
    return m


def horse():
    """A heavy draught horse (Brabant type), standing, in a leather collar."""
    m = Mesh(ao=0.0)
    body = [(0.98, 1.30, 0.10, 0.14), (0.90, 1.32, 0.26, 0.30), (0.65, 1.34, 0.34, 0.37), (0.25, 1.28, 0.36, 0.40),
            (-0.15, 1.26, 0.36, 0.42), (-0.50, 1.30, 0.33, 0.42), (-0.78, 1.34, 0.26, 0.38), (-0.93, 1.30, 0.14, 0.24)]
    m.shadefn = lambda p: 0.72 + 0.28 * min(1.0, max(0.0, (p.z - 0.85) / 0.6))
    m.tube([(0, y, z) for y, z, _, _ in body], [(w, h) for _, _, w, h in body], 8, HORSE, cap0=True, cap1=True, vscale=0.7)
    m.shadefn = lambda p: 0.85 + 0.15 * min(1.0, max(0.0, (p.z - 1.4) / 0.5))
    neck = [(-0.60, 1.48, 0.20, 0.30), (-0.88, 1.70, 0.17, 0.26), (-1.08, 1.92, 0.14, 0.20), (-1.20, 2.08, 0.12, 0.15)]
    m.tube([(0, y, z) for y, z, _, _ in neck], [(w, h) for _, _, w, h in neck], 8, HORSE, cap1=True, vscale=0.7)
    head = [(-1.14, 2.14, 0.10, 0.12), (-1.27, 2.02, 0.125, 0.17), (-1.40, 1.84, 0.10, 0.12), (-1.51, 1.66, 0.085, 0.10), (-1.54, 1.59, 0.065, 0.07)]
    m.shadefn = lambda p: 0.55 + 0.45 * min(1.0, max(0.0, (p.z - 1.5) / 0.35))
    m.tube([(0, y, z) for y, z, _, _ in head], [(w, h) for _, _, w, h in head], 8, HORSE, cap0=True, cap1=True, vscale=0.7)
    m.shadefn = None
    for sx in (-1, 1):
        m.tube([(sx * 0.06, -1.13, 2.14), (sx * 0.075, -1.11, 2.25), (sx * 0.085, -1.10, 2.33)], [0.035, 0.025, 0.006], 3, HORSE,
               cap0=True, cap1=True, shade=0.8)
    # legs: hide above, black points and feathered fetlocks below
    legs = []
    for sx in (-1, 1):
        legs.append([(sx * 0.19, -0.62, 1.05, 0.12), (sx * 0.19, -0.64, 0.72, 0.09), (sx * 0.19, -0.64, 0.52, 0.075),
                     (sx * 0.19, -0.64, 0.22, 0.055), (sx * 0.19, -0.65, 0.10, 0.085), (sx * 0.19, -0.66, 0.0, 0.09)])
        legs.append([(sx * 0.2, 0.62, 1.10, 0.15), (sx * 0.2, 0.74, 0.78, 0.10), (sx * 0.2, 0.80, 0.55, 0.075),
                     (sx * 0.2, 0.74, 0.22, 0.055), (sx * 0.2, 0.72, 0.10, 0.085), (sx * 0.2, 0.70, 0.0, 0.09)])
    for leg in legs:
        m.tube([(x, y, z) for x, y, z, _ in leg], [r for *_, r in leg], 6, HORSE, side=(0, 1, 0),
               mats=[HORSE, HORSE, HAIR, HAIR, HAIR], cap0=True, cap1=True, cap_mat=HAIR, vscale=0.7)
    m.tube([(0, 0.99, 1.47), (0, 1.09, 1.33), (0, 1.13, 1.0), (0, 1.11, 0.66)], [0.06, 0.085, 0.10, 0.05], 5, HAIR,
           cap0=True, cap1=True, vscale=1)
    m.tube([(0, -0.58, 1.84), (0, -0.84, 2.0), (0, -1.04, 2.15), (0, -1.14, 2.24)], [(0.03, 0.07)] * 4, 4, HAIR,
           cap0=True, cap1=True, vscale=1)
    # the collar round the base of the neck
    c = Vector((0, -0.84, 1.66))
    t = Vector((0, -0.6, 0.8)).normalized()
    s = Vector((1, 0, 0))
    b = t.cross(s)
    ring = [c + s * 0.25 * math.cos(2 * math.pi * i / 10) + b * 0.36 * math.sin(2 * math.pi * i / 10) for i in range(10)]
    m.tube(ring, [0.07] * 10, 5, LEATHER, side=tuple(t), closed_path=True, vscale=2)
    for sx in (-1, 1):
        m.beam(c + s * sx * 0.3 + b * -0.3, c + s * sx * 0.3 + b * 0.3, 0.035, 0.035, IRON)
    return m


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


def sack_truck():
    """Two-wheeled hand truck for sacks: a ladder frame on an iron nose, standing up."""
    m = Mesh()
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


def crate(sx=1.0, sy=1.0, sz=1.0):
    m = Mesh()
    crate_body(m, sx, sy, sz)
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


BUILDERS = [
    ("handcart", lambda: handcart(False)),
    ("handcart_loaded", lambda: handcart(True)),
    ("dray", lambda: dray(False)),
    ("dray_hitched", lambda: dray(True)),
    ("horse", horse),
    ("wheelbarrow", wheelbarrow),
    ("sack_truck", sack_truck),
    ("crate", lambda: crate(1.0, 1.0, 1.0)),
    ("crate_small", lambda: crate(0.7, 0.5, 0.48)),
    ("barrel", lambda: barrel(False)),
    ("barrel_lying", lambda: barrel(True)),
    ("sack", sack_one),
    ("sack_standing", sack_upright),
    ("sack_pile", sack_pile),
    ("rope_coil", rope_coil),
    ("bollard", bollard),
    ("gas_lamp", gas_lamp),
    ("crane", crane),
]


def house_doors():
    """Front doors of the city's houses, as build_city.py puts them (the middle bay of
    the front wall, BAY 3 m), so the game can keep props out of doorways. Read from
    shared/city_build.json (tools/city/plan.py); rebuild the props after the city."""
    src = os.path.join(ROOT, "shared", "city_build.json")
    if not os.path.exists(src):
        return []
    out = []
    for h in json.load(open(src))["houses"]:
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
    print(f"[build_props] {len(objs)} props, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv or "--closeup" in argv:
        preview_materials()
    if "--preview" in argv:
        preview_rows(objs)
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = argv[i + 1].split(",")
        az = float(argv[i + 3]) if len(argv) > i + 3 else -35.0
        closeup(objs, names, argv[i + 2], az)


if __name__ == "__main__":
    main()
