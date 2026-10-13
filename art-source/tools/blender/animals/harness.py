"""The cart dog's harness, as geometry on the draught dog (docs/plans/people.md H; StreetTrades.cs puts the dog in the
dog cart's shafts): a breast strap across the forechest with a trace ring at each end, a neck strap over the neck
holding it up, a back strap along the spine, a band round the loin, and from that band a tug each side: a leather loop
round the shaft's end. The straps follow the body's skin (found in its distance field), stand a little proud of it,
have rounded edges (AGENTS.md: leather 1-2 mm) and take the weights of the skin under them, so they move with the
chest and the back. The traces are their own model (dog_trace: a strap a metre long the game stretches from the
trace ring to the hook on the shaft), so the same strap serves every cart.

The dog stands in the shafts with its middle 1.57 m ahead of the cart's axle (StreetTrades.DogAhead): the shafts'
ends (lively.glb dogcart: x +-0.22 m, 0.34 m up, 1.45 m ahead of the axle) lie 0.12 m behind the dog's middle, and
the tugs hang 0.03 m further back so the shafts run through them.
"""

import math

import numpy as np

from people2 import sdf as S

from .mesh import Piece
from .body import unit

SHAFT_X, SHAFT_Y = 0.22, 0.34          # the dog cart's shafts (lively.glb), from the ground
TUG_Z = -0.15                           # the tugs, in the dog's frame (its middle at 1.57 m ahead of the axle)
LEATHER, BRASS = 0.0, 1.0               # UV regions (u) of the harness picture


def hit(Bd, o, d, far=0.6):
    """The skin where a ray from inside the body at o, going d, leaves it for the last time."""
    d = unit(d)
    ts = np.linspace(0.0, far, 400)
    pts = o[None, :] + ts[:, None] * d[None, :]
    v = Bd.base(pts)
    inside = np.nonzero(v <= 0)[0]
    if not len(inside):
        return None
    i = inside[-1]
    a, b = ts[i], ts[min(i + 1, len(ts) - 1)]
    for _ in range(24):
        m = (a + b) / 2
        if Bd.base((o + d * m)[None])[0] <= 0:
            a = m
        else:
            b = m
    return o + d * (a + b) / 2


def normal(Bd, p):
    g = S.gradient(Bd.base, p[None], eps=2e-4)[0]
    return unit(g)


def strap(pc, Bd, path, width, thick, closed=False, gap=0.0015, u0=0.0, u1=0.5):
    """A leather strap along points on the skin: a rounded-rectangle tube standing `gap` off the skin, `width`
    across (lying in the skin), `thick` deep. UVs: along the strap over [u0, u1] of the picture, across over [0, 1]."""
    P = np.asarray(path, float)
    n = len(P)
    W = Bd.weights(P, 0.018 * Bd.H)
    from .anatomy import NAMES
    rings = []
    # the cross-section: a rounded rectangle, 8 points, edges rounded by a third of the thickness
    r = thick * 0.35
    prof = [(-width / 2 + r, 0.0), (width / 2 - r, 0.0), (width / 2, r), (width / 2, thick - r), (width / 2 - r, thick),
            (-width / 2 + r, thick), (-width / 2, thick - r), (-width / 2, r)]
    acc = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))])
    total = acc[-1] if acc[-1] > 0 else 1.0
    for i in range(n):
        Nn = normal(Bd, P[i])
        T = P[(i + 1) % n] - P[i - 1] if closed else P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        T = unit(T - Nn * (T @ Nn))
        A = unit(np.cross(Nn, T))
        w = {NAMES[b]: float(W[i, b]) for b in np.nonzero(W[i] > 0.01)[0]}
        row = []
        for k, (x, y) in enumerate(prof):
            p = P[i] + Nn * (gap + y) + A * x
            row.append(pc.v(p, w, 0.0))
            pc.uv.append((u0 + (u1 - u0) * acc[i] / total, k / (len(prof) - 1)))
        rings.append(row)
    m = len(prof)
    last = n if closed else n - 1
    for i in range(last):
        a, b = rings[i], rings[(i + 1) % n]
        for k in range(m):
            k2 = (k + 1) % m
            pc.f(a[k], b[k], b[k2], a[k2])
    if not closed:
        for row, flip in ((rings[0], True), (rings[-1], False)):
            c = list(range(1, m - 1))
            for k in c:
                if flip:
                    pc.f(row[0], row[k + 1], row[k])
                else:
                    pc.f(row[0], row[k], row[k + 1])
    return rings


def ring(pc, centre, axis, R, r, w, seg=16, sides=6, u=(0.75, 0.95)):
    """A brass ring (a torus) about `axis`."""
    ax = unit(axis)
    e1 = unit(np.cross(ax, (0, 1.0, 0)) if abs(ax[1]) < 0.9 else np.cross(ax, (1.0, 0, 0)))
    e2 = np.cross(ax, e1)
    rows = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        d = e1 * math.cos(a) + e2 * math.sin(a)
        c = centre + d * R
        row = []
        for j in range(sides):
            b = 2 * math.pi * j / sides
            p = c + (d * math.cos(b) + ax * math.sin(b)) * r
            row.append(pc.v(p, w, 0.0))
            pc.uv.append((u[0] + (u[1] - u[0]) * i / seg, 0.1 + 0.8 * j / sides))
        rows.append(row)
    for i in range(seg):
        a, b = rows[i], rows[(i + 1) % seg]
        for j in range(sides):
            j2 = (j + 1) % sides
            pc.f(a[j], a[j2], b[j2], b[j])


def build(Bd):
    """The harness pieces of a draught dog: (straps, tugs, points for the game)."""
    J, H = Bd.J, Bd.H
    pc = Piece("harness")
    pc.uv = []
    tg = Piece("tug")
    tg.uv = []
    pts = {}
    sh = J["shoulderL"]
    # the breast strap: round the front of the chest just over the points of the shoulders, side to side
    ys = sh[1] + 0.035 * H
    zc = sh[2] - 0.16 * H
    o = np.array((0.0, ys, zc))
    path = []
    for a in np.linspace(-108, 108, 41):
        r = math.radians(a)
        p = hit(Bd, o, np.array((math.sin(r), 0.0, math.cos(r))))
        if p is not None:
            path.append(p)
    breast = strap(pc, Bd, path, 0.05 * H / 0.64, 0.006, u0=0.0, u1=0.45)
    ends = (path[-1], path[0])  # +x (left) last, -x (right) first
    for key, p in (("traceL", path[-1]), ("traceR", path[0])):
        Nn = normal(Bd, p)
        c = p + Nn * 0.012 + np.array((0, 0, -0.012))
        ring(pc, c, np.array((0, 1.0, 0)), 0.016, 0.0035, {"chest": 1.0})
        pts[key] = c
    # the neck strap: from the breast strap's sides up over the neck in front of the withers
    nb = J["neck"]
    o2 = np.array((0.0, nb[1] + 0.02 * H, sh[2] - 0.08 * H))
    path = []
    for a in np.linspace(-80, 80, 25):
        r = math.radians(a)
        d = np.array((math.sin(r), math.cos(r), 0.35 * math.cos(r)))
        p = hit(Bd, o2, d)
        if p is not None:
            path.append(p)
    strap(pc, Bd, path, 0.04 * H / 0.64, 0.005, u0=0.45, u1=0.62)
    # the band round the loin, where the tugs hang from
    zl = TUG_Z
    sp = J["spine"]
    o3 = np.array((0.0, sp[1] - 0.12 * H, zl))
    path = []
    for a in np.linspace(0, 360, 49)[:-1]:
        r = math.radians(a)
        p = hit(Bd, o3, np.array((math.sin(r), math.cos(r), 0.0)))
        if p is not None:
            path.append(p)
    strap(pc, Bd, path, 0.045 * H / 0.64, 0.006, closed=True, u0=0.62, u1=0.7)
    # the back strap along the spine from the neck strap to the band
    path = []
    for z in np.linspace(sh[2] - 0.14 * H, zl + 0.02, 18):
        p = hit(Bd, np.array((0.0, sp[1] - 0.1 * H, z)), np.array((0.0, 1.0, 0.0)))
        if p is not None:
            path.append(p)
    strap(pc, Bd, path, 0.035 * H / 0.64, 0.005, u0=0.0, u1=0.45)
    # the tugs: from the band's side down to a loop round the shaft's end
    for key, sg in (("tugL", 1.0), ("tugR", -1.0)):
        centre = np.array((sg * SHAFT_X, SHAFT_Y, zl))
        side = hit(Bd, np.array((0.0, SHAFT_Y + 0.06, zl)), np.array((sg, 0.25, 0.0)))
        top = centre + np.array((0, 0.034, 0))
        w = {"spine": 1.0}
        seg = [side + (top - side) * t for t in np.linspace(0, 1, 6)]
        # a short strap from the band, lying free (not on the skin): straight between the two
        _free_strap(tg, seg, 0.03, 0.005, w)
        ring(tg, centre, np.array((0, 0, 1.0)), 0.032, 0.006, w, seg=18, sides=6, u=(0.62, 0.7))
        pts[key] = centre
    return pc, tg, pts


def _free_strap(pc, path, width, thick, w):
    P = np.asarray(path, float)
    n = len(P)
    up = np.array((0, 0, 1.0))
    rings = []
    for i in range(n):
        T = unit(P[min(i + 1, n - 1)] - P[max(i - 1, 0)])
        A = unit(np.cross(T, up))
        Nn = np.cross(A, T)
        row = []
        for k, (x, y) in enumerate(((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5))):
            row.append(pc.v(P[i] + up * x * width + Nn * y * thick, w, 0.0))
            pc.uv.append((0.62 + 0.08 * i / max(n - 1, 1), k / 3))
        rings.append(row)
    for i in range(n - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(4):
            k2 = (k + 1) % 4
            pc.f(a[k], b[k], b[k2], a[k2])


def trace(length=1.0, width=0.026, thick=0.005, n=24):
    """The trace: a strap a metre long along +z from its ring end (the game stretches it to the hook), its edges
    rounded, a buckle near the ring."""
    pc = Piece("harness")
    pc.uv = []
    r = thick * 0.4
    prof = [(-width / 2 + r, -thick / 2), (width / 2 - r, -thick / 2), (width / 2, -thick / 2 + r), (width / 2, thick / 2 - r),
            (width / 2 - r, thick / 2), (-width / 2 + r, thick / 2), (-width / 2, thick / 2 - r), (-width / 2, -thick / 2 + r)]
    rings = []
    for i in range(n + 1):
        z = length * i / n
        row = []
        for k, (x, y) in enumerate(prof):
            row.append(pc.v(np.array((x, y, z)), {}, 0.0))
            pc.uv.append((0.0 + 0.45 * i / n, k / (len(prof) - 1)))
        rings.append(row)
    m = len(prof)
    for i in range(n):
        a, b = rings[i], rings[i + 1]
        for k in range(m):
            k2 = (k + 1) % m
            pc.f(a[k], a[k2], b[k2], b[k])
    for row, flip in ((rings[0], False), (rings[-1], True)):
        for k in range(1, m - 1):
            if flip:
                pc.f(row[0], row[k], row[k + 1])
            else:
                pc.f(row[0], row[k + 1], row[k])
    return pc


def picture(size=256):
    """The harness's picture (our own, painted here): worn dark leather with a stitch line along each edge in
    u [0, 0.75), brass in [0.75, 1]."""
    from .paint import fbm, hexc
    ys, xs = np.mgrid[0:size, 0:size]
    u = (xs + 0.5) / size
    v = (ys + 0.5) / size
    p3 = np.stack([u * 7.0, v * 1.3, np.zeros_like(u)], -1).reshape(-1, 3)
    n1 = fbm(p3, 6.0, 3, 91).reshape(size, size)
    n2 = fbm(p3, 40.0, 2, 92).reshape(size, size)
    leather = hexc(0x3c2717)[None, None, :] * (0.75 + 0.45 * n1[..., None]) * (0.9 + 0.2 * n2[..., None])
    # worn lighter along the edges, a row of stitches in from each edge
    edge = np.minimum(v, 1 - v)
    leather *= (1.0 + 0.35 * np.exp(-edge / 0.06))[..., None]
    stitch = (np.abs(edge - 0.16) < 0.025) & ((xs // 3) % 2 == 0)
    leather[stitch] = hexc(0x8a7350) * 0.8
    brass = hexc(0xa98a42)[None, None, :] * (0.7 + 0.5 * n1[..., None])
    img = np.where((u > 0.75)[..., None], brass, leather)
    return np.clip(img, 0, 1).astype(np.float32)


def to_object(name, pc, skinned=True):
    """A Blender mesh of a piece with its UVs (game space to Blender's) and, when skinned, its vertex groups."""
    import bmesh
    import bpy
    from .anatomy import NAMES
    P = np.array(pc.P)
    vb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
    me = bpy.data.meshes.new(name)
    me.from_pydata(vb.tolist(), [], [tuple(f) for f in pc.F])
    me.update()
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        poly.use_smooth = True
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = (pc.uv[vi][0], 1.0 - pc.uv[vi][1])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    if skinned:
        groups = {}
        for i, w in enumerate(pc.W):
            for bn, v in w.items():
                if bn not in groups:
                    groups[bn] = ob.vertex_groups.new(name=bn)
                groups[bn].add([i], float(v), "REPLACE")
        for bn in NAMES:
            if bn not in groups:
                groups[bn] = ob.vertex_groups.new(name=bn)
    # no wet sheen: vertex red 0.06 (leather's own dull gloss)
    at = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    c = np.zeros((len(P), 4), np.float32)
    c[:, 0] = 0.06
    c[:, 3] = 1.0
    at.data.foreach_set("color", c.ravel())
    me.color_attributes.active_color = at
    return ob
