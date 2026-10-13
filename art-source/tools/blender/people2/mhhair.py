"""Hair, beards and moustaches on the MakeHuman head (docs/people.md "Hair").

The same two kinds of piece as hair.py, made on MakeHuman's head instead of the old one:
- shells: the head's own skin under the hair (the scalp for a hair style, the beard's zone for a beard), pushed out
  along the skin's normals by a thickness that grows from the hairline (0 at the line, sunk a millimetre there so the
  rim meets the skin without a seam), reduced to the piece's triangle budget;
- tubes: buns, plaits, a coronet, moustaches, an imperial tuft, swept along paths on the head (hair._tube).
Every piece is bound to the base mesh (mh.Binding), so it carries the face and body sliders like the skin under it,
and weighted like that skin (head; the jaw for what grows on the jaw). Its UVs run over the face picture's hair
swatches (mhface.HAIR_RECT strands, BRAID_RECT a plait), so a piece has the hair colour of the face it goes with.
The hairline and the beard's zone are the face painter's own (mhface.hairline, beard_zone): paint and piece agree.
"""

import math

import numpy as np

from . import B
from . import hair as hr
from . import mh
from . import mhface
from . import rig

MEN = ["crop", "side", "long", "bald"]
WOMEN = ["bun", "plaits", "coronet", "undercap"]
BEARDS = ["full", "short", "chops", "sideburns", "chin", "imperial"]
MOUSTACHES = ["walrus", "handlebar", "chevron"]
BUDGET = {"crop": 380, "side": 460, "long": 520, "bald": 220, "cap": 420, "undercap": 320, "full": 520,
          "short": 380, "chops": 360, "sideburns": 180, "chin": 320}


def styles_for(base):
    """The pieces a base body gets: hair styles, beards, moustaches."""
    if base in ("woman", "old_woman"):
        return (["bun", "plaits", "coronet", "undercap"] if base == "woman" else ["bun", "undercap"]), [], []
    if base == "child":
        return ["crop", "plaits"], [], []
    if base == "old_man":
        return ["crop", "side", "bald"], BEARDS, MOUSTACHES
    return MEN, BEARDS, MOUSTACHES


class Head:
    """One body's head: the base mesh's head triangles in the body's rest space, normals, the head frame (the eyes'
    midpoint) and the painter's landmarks of the body's own head."""

    def __init__(self, body, lod=0):
        from . import mhbody
        self.body = body
        b = body.b
        T = mhbody.topology(lod)
        P = T.binding.eval(body.Pf)  # the copy's own skin: a shell made on it never lets that skin through
        self.P = P
        self.eyes = (body.Pf[b.vsets["joint-l-eye"]].mean(0) + body.Pf[b.vsets["joint-r-eye"]].mean(0)) / 2
        tris = []
        for f in T.faces:
            for k in range(1, len(f) - 1):
                tris.append((f[0], f[k], f[k + 1]))
        tris = np.array(tris, np.int64)
        head = np.array([p == "head" for p in T.part])
        self.head_tris = tris[head[tris].all(1)]
        self.N = mhface.vertex_normals(P, tris)
        self.Q = P - self.eyes
        G = mhface.geometry({"man": "m", "woman": "f", "child": "c", "old_man": "om",
                             "old_woman": "of"}[body.base])
        self.G = dict(G)
        from mathutils.bvhtree import BVHTree
        self.bvh = BVHTree.FromPolygons([tuple(p) for p in self.Q], [tuple(t) for t in self.head_tris],
                                        all_triangles=True)

    def onto(self, pts, out=0.0):
        """Points (head frame) put on the head's skin, `out` metres along its normal."""
        from mathutils import Vector
        res = []
        for p in pts:
            loc, nrm, fi, d = self.bvh.find_nearest(Vector(p))
            res.append(np.array(loc) + np.array(nrm) * out)
        return np.array(res)

    def at(self, el, az, out=0.0, side=1.0):
        """The skin seen from the head's middle (mhface.HEAD_C) at elevation el and azimuth az (degrees; side +1
        the person's left), `out` metres along its normal."""
        from mathutils import Vector
        e, a = math.radians(el), math.radians(az)
        d = np.array((side * math.cos(e) * math.sin(a), math.sin(e), math.cos(e) * math.cos(a)))
        o = mhface.HEAD_C + d * 0.3
        hit = self.bvh.ray_cast(Vector(o), Vector(-d))
        if hit[0] is None:
            loc, nrm, fi, dd = self.bvh.find_nearest(Vector(mhface.HEAD_C + d * 0.1))
        else:
            loc, nrm = hit[0], hit[1]
        return np.array(loc) + np.array(nrm) * out

    def front(self, pts, out=0.0):
        """Points brought straight back (along -z) onto the face, `out` along the normal."""
        from mathutils import Vector
        res = []
        for p in pts:
            hit = self.bvh.ray_cast(Vector((p[0], p[1], 0.3)), Vector((0, 0, -1.0)))
            if hit[0] is None:
                loc, nrm, fi, d = self.bvh.find_nearest(Vector(p))
            else:
                loc, nrm = hit[0], hit[1]
            res.append(np.array(loc) + np.array(nrm) * out)
        return np.array(res)


# ---------------------------------------------------------------- shells

def scalp_cover(Q, style, sex):
    """0..1 how much of a hair style grows at head points Q (head frame) and its thickness (metres)."""
    el, az = mhface.head_angles(Q)
    line = mhface.hairline(az, "f" if style in WOMEN or style in ("cap",) else sex,
                           0.6 if style == "bald" else 0.0)
    if style == "long":
        line = np.where(az > 100, line - 18.0 * mhface._sm(100, 150, az), line)
    grow = mhface.above(el, line - 1.0, line + 10.0)  # 0 at the line, full about 1.4 cm in
    cover = mhface.above(el, line - 0.5, line + 0.5)
    top = mhface.above(el, 35, 65)
    x = Q[..., 0]
    if style == "crop":
        th = 0.0030 + 0.0030 * top
    elif style == "side":
        th = 0.0045 + 0.0075 * top + 0.003 * top * mhface.below(x, -0.04, 0.02)
        th = th * (1 - 0.6 * np.exp(-((x - 0.026) / 0.005) ** 2) * mhface.above(el, 30, 45) * (Q[..., 2] > -0.06))
    elif style == "long":
        th = 0.005 + 0.005 * top + 0.010 * mhface.above(az, 100, 150) * mhface.below(el, -10, 20)
    elif style == "bald":
        bl = mhface.bald_line(az)
        cover = cover * mhface.below(el, bl - 4, bl + 2)
        grow = grow * mhface.below(el, bl - 6, bl)
        th = 0.0030 + 0.0 * x
    elif style in ("cap", "bun", "plaits", "coronet"):  # a woman's hair drawn back from a middle parting
        # smoothed over the temples and full at the sides above the ears (the 1870s), flatter on the crown
        temples = np.exp(-((az - 72) / 26.0) ** 2) * mhface.above(el, -2, 10) * mhface.below(el, 38, 55)
        th = 0.0045 + 0.0035 * top + 0.0085 * temples
        th = th * (1 - 0.55 * np.exp(-(x / 0.0045) ** 2) * mhface.above(el, 22, 34) * (Q[..., 2] > -0.06))
    elif style == "undercap":
        th = 0.0028 + 0.0012 * top
    else:
        raise KeyError(style)
    return cover, grow * th


def beard_cover(Q, G, style):
    """0..1 where a beard style grows and its thickness."""
    x, y, z = Q[..., 0], Q[..., 1], Q[..., 2]
    zone = mhface.beard_zone(Q, G, soft=3.0)
    chin, mouth = G["chin"], G["mouth"]
    ax = np.abs(x)
    if style == "full":
        th = 0.007 + 0.009 * mhface.below(y, chin[1] + 0.01, chin[1] + 0.035) * mhface.below(ax, 0.02, 0.05)
    elif style == "short":
        th = 0.0035 + 0.002 * mhface.below(y, chin[1] + 0.01, chin[1] + 0.03)
    elif style == "chops":  # whiskers down the cheeks, the chin shaved (they join a moustache)
        zone = zone * mhface.above(ax, 0.026, 0.036)
        th = 0.006 + 0.004 * mhface.above(ax, 0.04, 0.055)
    elif style == "sideburns":
        zone = zone * mhface.above(ax, 0.050, 0.056) * mhface.above(y, mouth[1] - 0.005, mouth[1] + 0.012)
        th = 0.003 + 0.0 * x
    elif style == "chin":  # a chin curtain: along the jaw and under the chin, the lips and cheeks bare
        jaw = np.maximum(mhface.below(y, mouth[1] - 0.022, mouth[1] - 0.012), mhface.above(ax, 0.04, 0.05))
        zone = zone * jaw
        th = 0.006 + 0.004 * mhface.below(y, chin[1] + 0.005, chin[1] + 0.025)
    else:
        raise KeyError(style)
    zone = zone * mhface.above(z, G["earL"][2] + 0.02, G["earL"][2] + 0.035)  # never behind the ear (no fins)
    grow = np.clip(zone * 1.8 - 0.2, 0, 1)
    grow = grow * grow * (3 - 2 * grow)
    return zone, grow * th


T0 = 0.0009  # where a shell meets the skin: the thickness field's contour at 0.9 mm
SINK = 0.0014  # and the shell's edge lies this far under the skin (no line where hair meets skin)


def clip(P, N, t, tris, t0=T0):
    """The part of the triangles where t > t0, cut along the contour t = t0 (new points on the edges, shared by the
    triangles on both sides): positions, normals, thickness, triangles, and which points lie on the contour."""
    out_p, out_n, out_t, edge = [], [], [], []
    vid = {}
    eid = {}

    def vert(i):
        if i not in vid:
            vid[i] = len(out_p)
            out_p.append(P[i])
            out_n.append(N[i])
            out_t.append(t[i])
            edge.append(False)
        return vid[i]

    def cut(i, j):
        k = (min(i, j), max(i, j))
        if k not in eid:
            a = (t0 - t[i]) / (t[j] - t[i])
            eid[k] = len(out_p)
            out_p.append(P[i] + (P[j] - P[i]) * a)
            n = N[i] + (N[j] - N[i]) * a
            out_n.append(n / max(np.linalg.norm(n), 1e-12))
            out_t.append(t0)
            edge.append(True)
        return eid[k]
    F = []
    for tri in tris:
        ins = [t[v] > t0 for v in tri]
        n_in = sum(ins)
        if n_in == 0:
            continue
        if n_in == 3:
            F.append(tuple(vert(v) for v in tri))
            continue
        poly = []
        for k in range(3):
            a, b = tri[k], tri[(k + 1) % 3]
            if ins[k]:
                poly.append(vert(a))
            if ins[k] != ins[(k + 1) % 3]:
                poly.append(cut(a, b))
        for k in range(1, len(poly) - 1):
            F.append((poly[0], poly[k], poly[k + 1]))
    return np.array(out_p), np.array(out_n), np.array(out_t), F, np.array(edge)


def shell(head, cover, thick, budget, name):
    """The shell over the head's skin where hair grows: the skin's triangles cut along the contour where the hair's
    thickness reaches T0 (a smooth hairline, not a row of triangles), every point pushed out by its thickness (the
    contour itself SINK under the skin, so hair grows out of the skin), with lumps of locks; the inside reduced to
    `budget` triangles while the edge keeps its points. Returns (positions in the body's rest space, faces)."""
    import bpy
    T = head.head_tris
    Q = head.Q
    el, az = mhface.head_angles(Q)
    sx = np.sign(Q[:, 0])
    lock = 0.5 + 0.5 * np.sin(np.radians(az * sx) * 26.0 + 0.6 * np.sin(np.radians(el) * 9.0)) * \
        (0.6 + 0.4 * np.sin(np.radians(az * sx) * 61.0))
    t = np.where(cover > 0.02, thick, 0.0) * (0.82 + 0.36 * lock)
    P, N, tt, F, edge = clip(head.P, head.N, t, T)
    if not F:
        return np.zeros((0, 3)), []
    out = P + N * np.where(edge, -SINK + T0, tt - SINK + 0.0004)[:, None]
    me = bpy.data.meshes.new("_shell_" + name)
    me.from_pydata([tuple(B(*p)) for p in out], [], F)
    me.update()
    ob = bpy.data.objects.new("_shell_" + name, me)
    bpy.context.scene.collection.objects.link(ob)
    inner = (tt > 0.0025) & ~edge
    print("[people2]   shell %s: %d triangles cut from the skin (budget %d)" % (name, len(F), budget))
    vg = ob.vertex_groups.new(name="inner")
    vg.add([int(i) for i in np.nonzero(inner)[0]], 1.0, "REPLACE")
    n = sum(len(p.vertices) - 2 for p in me.polygons)
    if n > budget:
        m = ob.modifiers.new("dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = max(0.02, budget / n)
        m.use_symmetry = True
        m.symmetry_axis = "X"
        m.vertex_group = "inner"
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=m.name)
    from . import G as toG
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    P = np.array([toG(v.co) for v in ob.data.vertices])
    F = [tuple(p.vertices) for p in ob.data.polygons]
    bpy.data.objects.remove(ob)
    # the reduction lays its triangles flat over the round skin: every point is put back out from the skin by the
    # thickness the field has there (the contour's points stay where the cut put them)
    bvh = BVHTree.FromPolygons([tuple(p) for p in head.P], [tuple(x) for x in T], all_triangles=True)
    from . import mh as mh_
    for i, p in enumerate(P):
        loc, nrm, fi, d = bvh.find_nearest(Vector(p))
        if loc is None:
            continue
        tri = T[fi]
        w = mh_.barycentric(np.array(loc), head.P[tri[0]], head.P[tri[1]], head.P[tri[2]])
        ti = float(w @ t[tri])
        if ti <= T0 * 1.05:
            continue
        n = w @ head.N[tri]
        n = n / max(np.linalg.norm(n), 1e-9)
        P[i] = np.array(loc) + n * (ti - SINK + 0.0004)
    return P, F


def strand_uv(head, P, braid=False):
    """UVs over the hair swatch: across by the azimuth, down the strands by the elevation."""
    el, az = mhface.head_angles(P - head.eyes)
    sx = np.sign(P[:, 0] - head.eyes[0])
    u = 0.5 + sx * az / 360.0
    v = np.clip((el + 80.0) / 170.0, 0, 1)
    a0, b0, a1, b1 = mhface.BRAID_RECT if braid else mhface.HAIR_RECT
    return np.stack((a0 + (a1 - a0) * u, b0 + (b1 - b0) * v), 1)


# ---------------------------------------------------------------- tubes

def tube_uv(UV, Lm, braid=False, rep=0.03):
    a0, b0, a1, b1 = mhface.BRAID_RECT if braid else mhface.HAIR_RECT
    u = UV[:, 0] * Lm / rep
    tri = np.abs((u % 2.0) - 1.0)
    return np.stack([a0 + (a1 - a0) * np.abs((UV[:, 1] * 2) % 2 - 1), b0 + (b1 - b0) * tri], -1)


def tubes(head, style, lod):
    """Swept pieces (head frame): list of (V, T, UV)."""
    out = []
    segs = 8 if lod == 0 else 5
    G = head.G
    crown = G["crown"]
    if style == "bun":
        o = head.at(18, 180, 0.010)
        n = o - mhface.HEAD_C
        n[1] *= 0.3
        n /= np.linalg.norm(n)
        e1 = np.cross(n, (1.0, 0.0, 0.0))
        e1 /= np.linalg.norm(e1)
        e2 = np.cross(n, e1)
        steps = 20 if lod == 0 else 9
        path, rad = [], []
        for i in range(steps):
            tt = i / (steps - 1)
            ang = 2 * math.pi * 1.6 * tt
            rr = 0.021 * (1 - 0.62 * tt)
            path.append(o + rr * (math.cos(ang) * e1 + math.sin(ang) * e2) + n * 0.005 * tt)
            rad.append(0.0105 * (1 - 0.35 * tt))
        V, T, UV, Lm = hr._tube(path, rad, 7 if lod == 0 else 5)
        out.append((V, T, tube_uv(UV, Lm)))
    if style == "plaits":
        for s in (1, -1):
            pts = [head.at(el, az, 0.0085, s) for el, az in
                   ((30, 105), (12, 120), (-2, 140), (-6, 162), (4, 176), (20, 172), (32, 150))]
            path = hr._resample(np.array(pts), 22 if lod == 0 else 8)
            V, T, UV, Lm = hr._tube(path, [0.0075] * len(path), segs, lobes=3 if lod == 0 else 0, lobe_k=420.0)
            out.append((V, T, tube_uv(UV, Lm, braid=True)))
    if style == "coronet":
        n_ = 34 if lod == 0 else 12
        pts = [head.at(46 + 5 * math.cos(math.radians(a)), abs(((a + 180) % 360) - 180), 0.0115,
                       1.0 if ((a + 180) % 360) - 180 >= 0 else -1.0) for a in np.linspace(0, 360, n_ + 1)]
        base = np.array(pts)
        V, T, UV, Lm = hr._tube(base, [0.0072] * len(base), segs, lobes=3 if lod == 0 else 0, lobe_k=420.0)
        out.append((V, T, tube_uv(UV, Lm, braid=True)))
    mouth, nose = G["mouth"], G["nose"]
    mw = 0.024
    mt = (mouth[1] + nose[1] - 0.012) / 2 + 0.001  # the upper lip, between the nose's base and the lips
    if style == "chevron":
        xs = np.linspace(-1.05, 1.05, 11)
        pts = [(x * mw, mt + 0.002 - 0.003 * x * x, 0) for x in xs]
        rad = [0.0060 * (1 - 0.35 * x * x) for x in xs]
    elif style == "walrus":
        xs = np.linspace(-1.25, 1.25, 13)
        pts = [(x * mw, mt + 0.001 - 0.010 * max(0.0, abs(x) - 0.6) ** 1.2, 0) for x in xs]
        rad = [0.0085 * (1 - 0.30 * x * x / 1.56) for x in xs]
    elif style == "handlebar":
        xs = np.linspace(-1.55, 1.55, 15)
        pts = [(x * mw, mt + 0.002 + 0.010 * max(0.0, abs(x) - 1.05) ** 1.5 * 3, 0) for x in xs]
        rad = [0.0046 * (1 - 0.70 * (abs(x) / 1.55) ** 2) + 0.0008 for x in xs]
    elif style == "imperial":
        pts = [(0.0, mouth[1] - 0.012, 0), (0.0, mouth[1] - 0.022, 0), (0.0, mouth[1] - 0.032, 0)]
        rad = [0.0045, 0.0032, 0.0015]
    else:
        pts = None
    if pts is not None:
        surf = head.front(pts)
        path = surf + np.array((0, 0, 1.0)) * np.array(rad)[:, None] * 0.65
        if style == "imperial":
            path = path + np.array((0, -0.006, 0.002)) * np.array([[0], [0.5], [1]])
            path = hr._resample(path, 8)
            rad = list(np.linspace(0.0045, 0.0015, len(path)))
        V, T, UV, Lm = hr._tube(path, rad, segs)
        if style != "imperial":  # a moustache lies on the lip: flattened toward the face
            c = np.repeat(path, segs, axis=0)
            c = np.concatenate((c, V[len(c):]))
            V = c + (V - c) * np.array((1.0, 1.0, 0.55))
        out.append((V, T, tube_uv(UV, Lm, rep=0.02)))
    return out


# ---------------------------------------------------------------- one piece, bound and weighted

def piece(head, kind, style, lod, sex):
    """A piece's geometry in the body's rest space: (positions, faces, uvs per face corner)."""
    Q = head.Q
    parts = []
    if kind == "hair":
        base_style = "cap" if style in ("bun", "plaits", "coronet") else style
        cover, th = scalp_cover(Q, base_style, sex)
        P, F = shell(head, cover, th, BUDGET[base_style] if lod == 0 else BUDGET[base_style] // 4, style)
        parts.append((P, F, strand_uv(head, P)))
        for V, T, UV in tubes(head, style, lod):
            parts.append((V + head.eyes, [tuple(t) for t in T], UV))
    elif kind == "beard":
        if style == "imperial":
            for V, T, UV in tubes(head, "imperial", lod):
                parts.append((V + head.eyes, [tuple(t) for t in T], UV))
        else:
            cover, th = beard_cover(Q, head.G, style)
            P, F = shell(head, cover, th, BUDGET[style] if lod == 0 else BUDGET[style] // 4, style)
            parts.append((P, F, strand_uv(head, P)))
    else:
        for V, T, UV in tubes(head, style, lod):
            parts.append((V + head.eyes, [tuple(t) for t in T], UV))
    co, faces, uvs = [], [], []
    for P, F, UV in parts:
        n0 = len(co)
        co += list(P)
        for f in F:
            faces.append(tuple(v + n0 for v in f))
            uvs.append([UV[v] for v in f])
    return np.array(co), faces, uvs
