"""The horse's head as a distance field, meshed (the animals kit's way: surface nets on a fine grid, decimated where the
surface is plain, pulled back onto the field): the head of build_props (its HEAD table: the same lofted section, so the
bridle's straps lie on it as before) with what shows through the skin laid on: the broad flat forehead and the bony
ridges over the eyes, the round jowls (the cheek over the jaw's branches), the face's straight bone, the nostrils'
flared rims round open commas, the soft upper lip over the lower, the chin, the hollow over each eye."""

import math

import numpy as np

from build_props import HEAD, HEAD0, HEAD1, HP
from people2 import sdf as S

from animals.body import ell, frame, lofted, tube, unit


def axes():
    a, b = np.array(HP(0, *HEAD0)), np.array(HP(0, *HEAD1))
    t = unit(b - a)
    s = np.array((1.0, 0.0, 0.0))
    s = unit(s - t * (s @ t))
    up = np.cross(t, s)  # the face side (forward and up), as head_pt's
    return a, b, t, s, up


def field():
    """The head's signed distance (Blender space) and the shapes' list for the meshing bounds."""
    a, b, t, s, up = axes()
    L = float(np.linalg.norm(b - a))

    def at(tt, x=0.0, y=0.0, z=0.0):
        return a + (b - a) * tt + s * x + up * y + t * z

    R = np.stack([s, up, t], 1)
    st = [(at(tt), W, T, B, 2.2) for tt, W, T, B in HEAD]
    shapes = [(lofted(st, side=s, per=8), 0.0, False)]
    k = 0.02
    for sx in (1, -1):
        # the jowl: the round cheek over the branch of the jaw, low and behind the eye
        shapes.append((ell(at(0.27, sx * 0.085, -0.115), (0.07, 0.085, 0.12), R), 0.045, False))
        # the bony ridge over the eye and the hollow above it
        shapes.append((ell(at(0.21, sx * 0.1, 0.078), (0.045, 0.022, 0.06), R), 0.03, False))
        shapes.append((ell(at(0.12, sx * 0.1, 0.075), (0.03, 0.02, 0.03), R), 0.02, True))
        # the nostril's flared rim, and the opening: a comma open to the front and out
        shapes.append((ell(at(0.875, sx * 0.08, 0.012), (0.024, 0.038, 0.05), R), 0.02, False))
        Rn = frame(unit(t * 0.55 + s * sx * 0.75 + up * 0.1), side=up)
        shapes.append((ell(at(0.885, sx * 0.094, 0.016), (0.01, 0.022, 0.035), Rn), 0.006, True))
        # the corner of the mouth: a shallow groove back from the lips
        shapes.append((ell(at(0.9, sx * 0.07, -0.06), (0.012, 0.008, 0.05), R), 0.008, True))
    # the face's straight bone, a faint ridge down the middle
    shapes.append((tube([at(0.1, 0, 0.085), at(0.45, 0, 0.078), at(0.75, 0, 0.074)], [0.03, 0.025, 0.022]), 0.03, False))
    # the soft upper lip over the lower, the chin under it
    shapes.append((ell(at(0.955, 0, -0.03), (0.07, 0.04, 0.045), R), 0.025, False))
    shapes.append((ell(at(0.9, 0, -0.08), (0.045, 0.03, 0.05), R), 0.025, False))
    shapes.append((ell(at(0.86, 0, -0.095), (0.035, 0.025, 0.035), R), 0.02, False))

    def f(p):
        d = None
        for shp, kk, sub in shapes:
            v = shp(p)
            if d is None:
                d = v
            elif sub:
                d = S.smax(d, -v, kk)
            else:
                d = S.smin(d, v, kk)
        return d
    lo = np.minimum(a, b) - 0.32
    hi = np.maximum(a, b) + 0.32
    return f, lo, hi, (a, b, t, s, up, L)


def mesh(target=2000, h=0.0035):
    """Vertices (Blender space) and triangles of the head, and each vertex's t along the head (0 the poll, 1 the lips)."""
    import bpy
    from animals.mesh import decimate, select_only
    f, lo, hi, (a, b, t, s, up, L) = field()
    d, lo, hh = S.grid_eval(f, lo, hi, h, coarse=3 * h, band=5.0 * h)
    verts, faces = S.surface_nets(d, lo, hh)
    ob = S.to_blender("horse_head_sdf", verts, faces)
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    tt = ((co - a) @ (b - a)) / (L * L)
    keep = np.clip(1.0 - 0.75 * np.clip((tt - 0.6) / 0.25, 0, 1) - 0.5 * np.clip((0.3 - np.abs(tt - 0.25)) / 0.3, 0, 1), 0.2, 1.0)
    decimate(ob, target, keep)
    co = np.array([v.co[:] for v in ob.data.vertices])
    co = S.project(f, co, steps=3, eps=1e-4)
    tris = []
    for p in ob.data.polygons:
        vs = list(p.vertices)
        for k in range(1, len(vs) - 1):
            tris.append((vs[0], vs[k], vs[k + 1]))
    nrm = S.normals(f, co)
    tt = ((co - a) @ (b - a)) / (L * L)
    bpy.data.objects.remove(ob)
    return co, tris, tt, nrm
