"""Signed distance tools for the heads and the hair (docs/people.md "Faces, hands, hair").

Shapes are written as signed distance functions over numpy point arrays (N, 3), negative inside. They are blended
with smooth minimums (soft unions, the way flesh joins), meshed once by surface nets on a fine grid, cut down by
Blender's decimation (which keeps detail where the surface bends: lids, lips, nose, ears) and then pulled exactly
onto the surface again (project()).

Only numpy: Blender's Python has no scipy.
"""

import math

import numpy as np


# ---------------------------------------------------------------- primitives

def ellipsoid(p, c, r):
    """A close bound of the distance to an ellipsoid (exact on the surface)."""
    r = np.asarray(r, np.float64)
    q = (p - np.asarray(c)) / r
    k0 = np.sqrt((q * q).sum(-1))
    q1 = q / r
    k1 = np.sqrt((q1 * q1).sum(-1))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def sphere(p, c, r):
    return np.sqrt(((p - np.asarray(c)) ** 2).sum(-1)) - r


def tube(p, pts, radii, scale=None):
    """A chain of round cones through pts with the given radii (a capsule chain). scale: (sx, sy, sz) squashes
    space first (a flatter tube)."""
    pts = np.asarray(pts, np.float64)
    radii = np.asarray(radii, np.float64)
    if scale is not None:
        s = np.asarray(scale, np.float64)
        p = p / s
        pts = pts / s
        k = float(min(s))
    else:
        k = 1.0
    best = np.full(p.shape[0], 1e9)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        L2 = float(ab @ ab)
        if L2 < 1e-14:
            continue
        h = np.clip(((p - a) @ ab) / L2, 0.0, 1.0)
        d = np.sqrt(((p - a - h[:, None] * ab) ** 2).sum(-1)) - (radii[i] + h * (radii[i + 1] - radii[i]))
        best = np.minimum(best, d)
    return best * k


def box(p, c, half, round_=0.0):
    q = np.abs(p - np.asarray(c)) - (np.asarray(half) - round_)
    out = np.sqrt((np.maximum(q, 0.0) ** 2).sum(-1))
    return out + np.minimum(q.max(-1), 0.0) - round_


# ---------------------------------------------------------------- blends

def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def cut(a, b, k):
    """a with b taken away, softly."""
    return smax(a, -b, k)


# ---------------------------------------------------------------- frames

def rot(axis, deg):
    a = np.asarray(axis, np.float64)
    a = a / np.linalg.norm(a)
    t = math.radians(deg)
    c, s = math.cos(t), math.sin(t)
    x, y, z = a
    return np.array([[c + x * x * (1 - c), x * y * (1 - c) - z * s, x * z * (1 - c) + y * s],
                     [y * x * (1 - c) + z * s, c + y * y * (1 - c), y * z * (1 - c) - x * s],
                     [z * x * (1 - c) - y * s, z * y * (1 - c) + x * s, c + z * z * (1 - c)]])


# ---------------------------------------------------------------- meshing

def grid_eval(f, lo, hi, h, coarse=0.004, band=0.010):
    """Evaluate f on a grid of step h over [lo, hi], exactly only near the surface (where a coarse pass says the
    surface is within `band`); elsewhere the coarse sign is kept with a large magnitude."""
    lo = np.asarray(lo, np.float64)
    hi = np.asarray(hi, np.float64)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    # coarse pass
    nc = np.ceil((hi - lo) / coarse).astype(int) + 2
    gc = [lo[i] + np.arange(nc[i]) * coarse for i in range(3)]
    X, Y, Z = np.meshgrid(*gc, indexing="ij")
    dc = f(np.stack([X.ravel(), Y.ravel(), Z.ravel()], -1)).reshape(nc)
    # fine grid: nearest coarse value first
    fi = [np.clip(np.rint((lo[i] + np.arange(n[i]) * h - lo[i]) / coarse).astype(int), 0, nc[i] - 1) for i in range(3)]
    d = dc[np.ix_(fi[0], fi[1], fi[2])].astype(np.float32)
    near = np.abs(d) < band
    idx = np.nonzero(near)
    pts = np.stack([lo[0] + idx[0] * h, lo[1] + idx[1] * h, lo[2] + idx[2] * h], -1)
    out = np.empty(len(pts), np.float32)
    step = 400000
    for s in range(0, len(pts), step):
        out[s:s + step] = f(pts[s:s + step])
    d[idx] = out
    d[~near] = np.where(d[~near] < 0, -band * 2, band * 2)
    return d, lo, h


def surface_nets(d, lo, h):
    """Quads over the zero level of a grid (surface nets): one vertex per cell the surface passes through (the mean
    of its edge crossings), one quad per grid edge the surface crosses. Faces point outward (to positive d)."""
    s = d < 0
    nx, ny, nz = d.shape
    cdim = np.array((nx - 1, ny - 1, nz - 1))

    def lin(i, j, k):
        return (i * cdim[1] + j) * cdim[2] + k

    quads = []
    for axis in range(3):
        sl0 = [slice(None)] * 3
        sl1 = [slice(None)] * 3
        sl0[axis] = slice(0, -1)
        sl1[axis] = slice(1, None)
        ch = s[tuple(sl0)] != s[tuple(sl1)]
        inside_lo = s[tuple(sl0)]
        I = np.nonzero(ch)
        i, j, k = I
        ins = inside_lo[I]
        # the four cells round an edge along `axis`
        if axis == 0:
            m = (j >= 1) & (k >= 1) & (j < cdim[1]) & (k < cdim[2])
            i, j, k, ins = i[m], j[m], k[m], ins[m]
            c = [lin(i, j - 1, k - 1), lin(i, j, k - 1), lin(i, j, k), lin(i, j - 1, k)]
        elif axis == 1:
            m = (i >= 1) & (k >= 1) & (i < cdim[0]) & (k < cdim[2])
            i, j, k, ins = i[m], j[m], k[m], ins[m]
            c = [lin(i - 1, j, k - 1), lin(i - 1, j, k), lin(i, j, k), lin(i, j, k - 1)]
        else:
            m = (i >= 1) & (j >= 1) & (i < cdim[0]) & (j < cdim[1])
            i, j, k, ins = i[m], j[m], k[m], ins[m]
            c = [lin(i - 1, j - 1, k), lin(i, j - 1, k), lin(i, j, k), lin(i - 1, j, k)]
        q = np.stack(c, -1)
        q[~ins] = q[~ins][:, ::-1]
        quads.append(q)
    quads = np.concatenate(quads)
    cells, inv = np.unique(quads.ravel(), return_inverse=True)
    faces = inv.reshape(-1, 4)
    ci = cells // (cdim[1] * cdim[2])
    cj = (cells // cdim[2]) % cdim[1]
    ck = cells % cdim[2]
    # vertex = mean of the crossings on the cell's 12 edges
    corners = [(a, b, c) for a in (0, 1) for b in (0, 1) for c in (0, 1)]
    cv = np.stack([d[ci + a, cj + b, ck + c] for a, b, c in corners], -1).astype(np.float64)
    edges = [(0, 4), (1, 5), (2, 6), (3, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 1), (2, 3), (4, 5), (6, 7)]
    acc = np.zeros((len(cells), 3))
    cnt = np.zeros(len(cells))
    co = np.array(corners, np.float64)
    for a, b in edges:
        da, db = cv[:, a], cv[:, b]
        m = (da < 0) != (db < 0)
        t = np.where(m, da / np.where(m, da - db, 1.0), 0.0)
        p = co[a][None, :] + t[:, None] * (co[b] - co[a])[None, :]
        acc += p * m[:, None]
        cnt += m
    local = acc / np.maximum(cnt, 1)[:, None]
    verts = np.stack([ci, cj, ck], -1) + local
    verts = lo[None, :] + verts * h
    return verts, faces


def gradient(f, p, eps=1e-4):
    g = np.zeros_like(p)
    for i in range(3):
        e = np.zeros(3)
        e[i] = eps
        g[:, i] = (f(p + e) - f(p - e)) / (2 * eps)
    return g


def project(f, p, steps=4, eps=1e-4):
    """Pull points onto the zero level of f (Newton steps along the gradient)."""
    p = p.copy()
    for _ in range(steps):
        d = f(p)
        g = gradient(f, p, eps)
        gg = np.maximum((g * g).sum(-1), 1e-6)
        p -= (d / gg)[:, None] * g
    return p


def normals(f, p, eps=1e-4):
    g = gradient(f, p, eps)
    return g / np.maximum(np.linalg.norm(g, axis=-1, keepdims=True), 1e-9)


def to_blender(name, verts, faces, link=True):
    """A Blender mesh object from vertices (Blender axes) and faces (quads or triangles)."""
    import bpy

    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.update()
    ob = bpy.data.objects.new(name, me)
    if link:
        bpy.context.scene.collection.objects.link(ob)
    return ob


def decimate(ob, target_tris):
    """Cut a mesh down to about target_tris triangles (quadric collapse: detail stays where the surface bends)."""
    import bpy

    ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = min(1.0, target_tris / max(ntri, 1))
    m.use_collapse_triangulate = True
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=m.name)


def mesh_arrays(ob):
    me = ob.data
    v = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", v)
    tris = []
    for p in me.polygons:
        vs = list(p.vertices)
        for i in range(1, len(vs) - 1):
            tris.append((vs[0], vs[i], vs[i + 1]))
    return v.reshape(-1, 3), np.array(tris, np.int64)
