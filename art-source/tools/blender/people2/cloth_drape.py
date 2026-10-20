"""Shared final topology for an apron laid on a skirt."""

import math
import numpy as np
import bmesh
from . import G, B
from . import weights as wt, clothes_kit as ck
from .rig import NAMES


def skirt_bends(ob, fit):
    """Retain rows at the knee and apron edges before binding the two surfaces.

    A triangle spanning the entire knee interpolates thigh weights into its lower
    edge. Clipping an apron from those triangles otherwise makes a toothed hem.
    """
    raw = wt.parts(ob)
    if "skirt" not in raw or "apron" not in raw:
        return
    apron = [G(v.co)[1] for v in ob.data.vertices if raw[v.index] == "apron"]
    levels = sorted(set((min(apron), max(apron), fit.knee_y, fit.knee_y - 0.06)))
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    faces = {
        f
        for f in bm.faces
        if all(raw[v.index] in ("skirt", "in_skirt") for v in f.verts)
    }
    verts = {v for f in faces for v in f.verts}
    edges = {e for f in faces for e in f.edges}
    for y in levels:
        geom = list(verts | edges | faces)
        bmesh.ops.bisect_plane(
            bm, geom=geom, dist=1e-6, plane_co=B(0, y, 0), plane_no=B(0, 1, 0)
        )
        # The bisection's new faces/edges retain connections to the selected cloth.
        faces = {f for v in verts if v.is_valid for f in v.link_faces}
        verts = {v for f in faces for v in f.verts}
        edges = {e for f in faces for e in f.edges}
    bm.normal_update()
    bm.to_mesh(ob.data)
    bm.free()


def skirt_weights(ob, fit):
    """Re-evaluate the continuous knee bend after decimation moved its vertices."""
    raw, weights = wt.parts(ob), wt.read(ob)
    changed = []
    for v in ob.data.vertices:
        part = (raw[v.index] or "").removeprefix("in_")
        if part not in ("skirt", "overskirt", "habit_skirt", "flounce"):
            continue
        w = ck.hang_weights(
            fit,
            G(v.co),
            front_legs=1,
            back_legs=1,
            spring=0,
            knee_share=1,
            knee_band=(0, 0.06),
        )
        weights[v.index] = [w.get(n, 0) for n in NAMES]
        changed.append(v.index)
    for group in ob.vertex_groups:
        if group.name in NAMES:
            group.remove(changed)
    wt.apply_rows(ob, weights, changed)


def apron_surface(ob):
    """Cut the apron from the reduced skirt so its triangles bend with that skirt.

    Retain the authored apron height and angular coverage. This runs before UVs,
    painting and identity keys, and keeps the shared body/cloth triangle budget.
    """
    raw = wt.parts(ob)
    if "apron" not in raw or "skirt" not in raw:
        return False
    co = np.array([G(v.co) for v in ob.data.vertices])
    normal = np.array([G(v.normal) for v in ob.data.vertices])
    old = co[np.array(raw) == "apron"]
    low, high = old[:, 1].min(), old[:, 1].max()
    angles = np.arctan2(old[:, 0], old[:, 2])
    left, right = angles.min(), angles.max()
    if right - left > math.pi * 1.5:
        return False
    W = wt.read(ob)
    pc = ck.Piece("apron", ck.Cloth((0.7, 0.65, 0.5)))
    weld = {}
    under = {}

    def bounds(p, left, right):
        x, y, z = p
        return np.array(
            (
                y - low,
                high - y,
                x * math.cos(left) - z * math.sin(left),
                z * math.sin(right) - x * math.cos(right),
            )
        )

    def emit_face(face, left, right):
        poly = [
            (co[i], normal[i], W[i], bounds(co[i], left, right)) for i in face.vertices
        ]
        for plane in range(4):
            clipped = []
            for a, b in zip(poly, poly[1:] + poly[:1]):
                da, db = a[3][plane], b[3][plane]
                if da >= 0:
                    clipped.append(a)
                if (da >= 0) != (db >= 0):
                    t = da / (da - db)
                    clipped.append(tuple(a[k] * (1 - t) + b[k] * t for k in range(4)))
            poly = clipped
            if not poly:
                break
        if len(poly) < 3:
            return
        ids = []
        for p, n, w, _ in poly:
            key = tuple(np.round(p, 7))
            if key not in weld:
                n = n / max(np.linalg.norm(n), 1e-9)
                weld[key] = pc.add(
                    p + n * 0.025,
                    {NAMES[j]: float(v) for j, v in enumerate(w) if v > 1e-6},
                    zone="skirt",
                )
                under[weld[key]] = p.copy()
            ids.append(weld[key])
        from .cloth_fit import clipped_face

        clipped_face(pc, ids)

    sectors = [(left, right)] if right - left <= math.pi else [(left, 0), (0, right)]
    for face in ob.data.polygons:
        if not all(raw[i] == "skirt" for i in face.vertices):
            continue
        for lo, hi in sectors:
            emit_face(face, lo, hi)
    if not pc.F:
        raise ValueError("No skirt surface under apron: " + ob.name)
    inside = ck.thicken(pc, 0.003, depth=0.035, crease=0.7)
    for outer, inner in inside.items():
        under[inner] = under[outer]
    apron, _ = ck.build_objects([pc], ob.name + "_apron")
    link = apron.data.attributes.new("_apron_under", "FLOAT_VECTOR", "POINT")
    for i, point in under.items():
        link.data[i].vector = B(*point)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(
        bm,
        geom=[
            f
            for f in bm.faces
            if any(raw[v.index] in ("apron", "in_apron") for v in f.verts)
        ],
        context="FACES_ONLY",
    )
    bmesh.ops.delete(
        bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS"
    )
    bm.to_mesh(ob.data)
    bm.free()
    from .dress import join

    join(ob, apron)
    return True


def carry_apron(ob):
    """Use the authored skirt correspondence, never a different nearby fold."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc

    link = ob.data.attributes.get("_apron_under")
    if link is None:
        return False
    raw, weights = wt.parts(ob), wt.read(ob)
    co = [v.co.copy() for v in ob.data.vertices]
    faces = []
    for f in ob.data.polygons:
        ids = list(f.vertices)
        if all(raw[i] == "skirt" for i in ids):
            faces.extend((ids[0], ids[k], ids[k + 1]) for k in range(1, len(ids) - 1))
    tree = BVHTree.FromPolygons(co, faces, all_triangles=True)
    changed = []
    for i, part in enumerate(raw):
        if part not in ("apron", "in_apron"):
            continue
        loc, _, face, distance = tree.find_nearest(link.data[i].vector)
        if loc is None or distance > 0.001:
            raise ValueError("Lost skirt/apron correspondence: " + ob.name)
        ids = faces[face]
        blend = poly_3d_calc([co[j] for j in ids], loc)
        weights[i] = sum(weights[j] * w for j, w in zip(ids, blend))
        changed.append(i)
        if ob.data.shape_keys:
            for key in ob.data.shape_keys.key_blocks:
                key.data[i].co = co[i] + sum(
                    ((key.data[j].co - co[j]) * w for j, w in zip(ids, blend)), Vector()
                )
    for group in ob.vertex_groups:
        if group.name in NAMES:
            group.remove(changed)
    wt.apply_rows(ob, weights, changed)
    return True
