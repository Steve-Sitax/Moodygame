"""Reduce finished clothing with its UV charts, then rebuild matching facings."""

import bpy
import bmesh
from . import clothes_build as cb, cloth_fit as cf
from .clothes_build import tuck
from . import weights as wt


def clip_cuffs(body, cloth):
    """Clip coarse arm triangles at sleeve openings instead of retaining long spikes.

    The body's far topology can span the wrist and much of the forearm in one
    triangle. Protecting its hand corner retained skin all the way up the sleeve.
    Keep two centimetres behind the shortest edge of the authored cuff; bisecting
    the triangle interpolates its UVs, weights and identity shapes at that edge.
    """
    armature = body.parent
    if armature is None or armature.type != "ARMATURE":
        return
    parts, regions = wt.parts(cloth), cb.limbs(cloth)
    zones = cb.zones_of(cloth)
    skin = wt.parts(body)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.verts.ensure_lookup_table()
    arm_faces = {side: {f for f in bm.faces if all(skin[v.index] == "arm" + side for v in f.verts)}
                 for side in "LR"}
    for side in "LR":
        bone = armature.data.bones.get("armLow" + side)
        if bone is None:
            continue
        axis = (bone.tail_local - bone.head_local).normalized()
        length = (bone.tail_local - bone.head_local).length
        opening = []
        for garment in ("coat", "smock", "bodice", "tunic", "shirt"):
            counts = {}
            for face in cloth.data.polygons:
                ids = list(face.vertices)
                if not all(parts[i] == garment for i in ids):
                    continue
                for a, b in zip(ids, ids[1:] + ids[:1]):
                    edge = tuple(sorted((a, b)))
                    counts[edge] = counts.get(edge, 0) + 1
            for (a, b), count in counts.items():
                if count != 1 or not all(regions[i] == "arm" + side and zones[i] == "arm" for i in (a, b)):
                    continue
                values = [(cloth.data.vertices[i].co - bone.head_local).dot(axis) for i in (a, b)]
                if min(values) > length * 0.4:
                    opening.extend(values)
            if opening:
                break
        if not opening:
            continue
        depth = min(opening) - 0.02
        faces = {f for f in arm_faces[side] if f.is_valid}
        if not faces:
            continue
        geom = list(faces | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts})
        bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6,
            plane_co=bone.head_local + axis * depth, plane_no=axis, clear_inner=True)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()


def from_near(far, near, budget, body=None):
    """Keep each garment's painted surface inside the existing far mesh budget.

    Projecting a separately reduced cage across packed near charts sampled other
    garments. Reducing the near surface carries its chart boundaries and weights
    along with it; its inset facings are made only after that reduction.
    """
    from .garments_cast import reduce_cast

    clone = near.copy()
    clone.data = near.data.copy()
    clone.name = "_cloth_far"
    bpy.context.scene.collection.objects.link(clone)
    try:
        if body is not None:
            before = cb.tris(body)
            clip_cuffs(body, near)
            from .cloth_masks import skin_below_neckline
            skin_below_neckline(body, near)
            # Allocate clothes after all skin splits, including neckline cuts
            # that replace one coarse triangle with two exposed triangles.
            budget -= cb.tris(body) - before
        # The finished near mesh has new facings and may contain a joined apron.
        # Its original cage mask and apron correspondence are no longer valid.
        for name in ("cloth_outer", "_apron_under", "_pad_under"):
            attribute = clone.data.attributes.get(name)
            if attribute:
                clone.data.attributes.remove(attribute)
        reserve = 96 if {"veil", "guimpe"} <= set(wt.parts(clone)) else 0
        cf.reduce_lined(clone, budget - reserve, lambda ob, n, **kw: reduce_cast(ob, n))
        order = {("shirt", "coat"), ("shirt", "waistcoat"),
                 ("waistcoat", "coat"), ("trousers", "coat"),
                 ("bodice", "shawl"),
                 ("shirt", "pad"), ("waistcoat", "pad"),
                 ("skirt", "coat"),
                 ("coif", "veil"), ("guimpe", "veil"),
                 ("habit", "guimpe"), ("habit_skirt", "habit"),
                 ("shirt", "frock_coat"), ("waistcoat", "frock_coat")}
        for _ in range(3):
            tuck(clone, None, order, lambda p, part: False,
                 clearance=0.025, reach=0.15, agree=0.3)
        cf.coat_apron_ease(clone, forward=0)
        if body is not None:
            cf.tuck_skin(body, clone)
        names = [g.name for g in clone.vertex_groups]
        far.vertex_groups.clear()
        far.data = clone.data
        # Blender shares the deform-group names with this assigned mesh.
        # Appending while iterating the clone groups would grow that same list.
        if [g.name for g in far.vertex_groups] != names:
            raise ValueError("Far clothing lost its vertex group names")
        if cb.tris(far) > budget:
            raise ValueError("Far clothing exceeds budget: " + far.name)
    finally:
        bpy.data.objects.remove(clone, do_unlink=True)
