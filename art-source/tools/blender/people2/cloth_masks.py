"""Authored coverage masks for closed garment panels, independent of view or pose."""

import bmesh
from mathutils import Vector
from mathutils.geometry import convex_hull_2d
from . import weights as wt


def covered_hat_scalp(ob, hats):
    """Omit hidden scalp above a complete brim; a short peak cannot hide it.

    Head sliders can push the scalp through a stiff crown even when its basis
    fits. The cut lies inside the crown, below the brim, preserving the visible
    forehead and interpolating its UVs, weights and identity shapes.
    """
    import math
    from mathutils.geometry import convex_hull_2d
    raw = wt.parts(ob)
    names = set(hats).intersection({"cap_peak", "cap_brim", "hat_brim"})
    for name in names:
        points = [v.co for v in ob.data.vertices if raw[v.index] == name]
        if len(points) < 8:
            continue
        centre = sum(points, Vector()) / len(points)
        angles = sorted(math.atan2(p.y-centre.y, p.x-centre.x) for p in points)
        if max(b-a for a,b in zip(angles, angles[1:]+[angles[0]+2*math.pi])) > .6:
            continue
        # A peak's own centroid is not the head centre: require the actual head
        # axis inside its radial outline as well.
        head = ob.parent.data.bones.get("head") if ob.parent else None
        if head is None or abs(centre.x-head.head_local.x) > .03 or abs(centre.y-head.head_local.y) > .06:
            continue
        # Follow the inner brim boundary where it meets the crown. A rain
        # hat's outer edge can drop below the eyes, while a raised outer lip
        # on a flat brim must not leave scalp exposed through the crown seam.
        counts = {}
        for face in ob.data.polygons:
            ids = list(face.vertices)
            if all(raw[i] == name for i in ids):
                for a,b in zip(ids, ids[1:]+ids[:1]):
                    edge = tuple(sorted((a,b)))
                    counts[edge] = counts.get(edge, 0) + 1
        neighbours = {}
        for (a,b),count in counts.items():
            if count == 1:
                neighbours.setdefault(a,set()).add(b)
                neighbours.setdefault(b,set()).add(a)
        loops = []
        remaining = set(neighbours)
        while remaining:
            pending = [remaining.pop()]; loop = set(pending)
            while pending:
                for i in neighbours[pending.pop()]:
                    if i in remaining:
                        remaining.remove(i); loop.add(i); pending.append(i)
            if len(loop) >= 8 and all(len(neighbours[i]) == 2 for i in loop):
                loops.append(loop)
        if len(loops) != 2:
            continue
        inner = min(loops, key=lambda loop: sum((ob.data.vertices[i].co.x-head.head_local.x)**2
                    +(ob.data.vertices[i].co.y-head.head_local.y)**2 for i in loop)/len(loop))
        height = min(ob.data.vertices[i].co.z for i in inner) - .006
        eyes = [bone.head_local.z for bone in ob.parent.data.bones if bone.name in ("eyeL", "eyeR")]
        if eyes:
            height = max(height, max(eyes) + .005)
        hull_points = [Vector((p.x, p.y)) for p in points]
        hull = [hull_points[i] for i in convex_hull_2d(hull_points)]
        cross_section = []
        for edge in ob.data.edges:
            a, b = edge.vertices
            if raw[a] != "head" or raw[b] != "head":
                continue
            va, vb = ob.data.vertices[a].co, ob.data.vertices[b].co
            if min(va.z, vb.z) <= height < max(va.z, vb.z):
                q = va.lerp(vb, (height-va.z)/(vb.z-va.z))
                cross_section.append(Vector((q.x, q.y)))
        centre2 = sum(hull, Vector((0,0))) / len(hull)
        def inside(point):
            for a,b in zip(hull, hull[1:]+hull[:1]):
                edge = b-a
                inward = Vector((-edge.y, edge.x)).normalized()
                if inward.dot(centre2-a) < 0:
                    inward = -inward
                if inward.dot(point-a) < .002:
                    return False
            return True
        # A tilted pillbox may surround its own axis yet leave the back of the
        # head exposed. Only cut when the whole scalp section is under the brim.
        if not cross_section or not all(inside(p) for p in cross_section):
            continue
        bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
        faces = {f for f in bm.faces if all(raw[v.index] == "head" for v in f.verts)}
        geometry = faces | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts}
        bmesh.ops.bisect_plane(bm, geom=list(geometry), plane_co=(0,0,height), plane_no=(0,0,1),
                              dist=1e-6, clear_outer=True)
        bm.to_mesh(ob.data); bm.free(); ob.data.update()
        return


def skin_below_neckline(ob, cloth=None):
    """Clip coarse neck triangles under a closed bodice's authored neckline.

    Keeping a triangle because its top corner is exposed can leave its centre
    crossing the chest panel. Bisecting preserves the visible neck and its
    interpolated UVs, weights and identity shapes.
    """
    if not ob.name.endswith("_lod1") or ob.parent is None or ob.parent.type != "ARMATURE":
        return
    cloth = cloth if cloth is not None else ob
    raw, cloth_parts = wt.parts(ob), wt.parts(cloth)
    neck = ob.parent.data.bones.get("neck")
    if "bodice" not in cloth_parts or neck is None:
        return
    counts = {}
    for f in cloth.data.polygons:
        ids = list(f.vertices)
        if not all(cloth_parts[i] == "bodice" for i in ids):
            continue
        for a, b in zip(ids, ids[1:] + ids[:1]):
            edge = tuple(sorted((a, b)))
            counts[edge] = counts.get(edge, 0) + 1
    rim = [cloth.data.vertices[i].co for edge, count in counts.items() if count == 1 for i in edge
           if abs(cloth.data.vertices[i].co.x - neck.head_local.x) < .10
           and abs(cloth.data.vertices[i].co.y - neck.head_local.y) < .12
           and cloth.data.vertices[i].co.z > neck.head_local.z - .08]
    if not rim:
        return
    height = min(v.z for v in rim) - .020
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.verts.ensure_lookup_table()
    faces = {f for f in bm.faces if all(raw[v.index] in ("neck", "torso", "head") for v in f.verts)
             and any(raw[v.index] in ("neck", "torso") for v in f.verts)}
    geometry = faces | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts}
    bmesh.ops.bisect_plane(bm, geom=list(geometry), plane_co=(0,0,height), plane_no=(0,0,1),
                          dist=1e-6, clear_inner=True)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()


def bib_under_veil(ob):
    """Keep the chest bib, omitting its covered back beneath the closed veil.

    At distance, split the coarse habit at the bib outline before omitting its
    covered centre. Vertex-only clearance misses a large habit triangle that
    crosses the bib even though all of its corners lie outside that bib.
    """
    raw = wt.parts(ob)
    if not {"veil", "guimpe", "habit"} <= set(raw):
        return
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    deform = bm.verts.layers.deform.active
    if ob.name.endswith("_lod1"):
        points = [Vector((v.co.x, v.co.z)) for v in ob.data.vertices
                  if raw[v.index] == "guimpe" and v.co.y < 0]
        centre = sum(points, Vector((0, 0))) / len(points)
        hull = [points[i] for i in convex_hull_2d(points)]
        hull = [v + (centre - v).normalized() * .010 for v in hull]
        xlo, xhi = min(p.x for p in hull), max(p.x for p in hull)
        zlo, zhi = min(p.y for p in hull), max(p.y for p in hull)
        groups = {g.index for g in ob.vertex_groups if g.name in ("part_habit", "part_in_habit")}

        def panel(face):
            if (max(v.co.x for v in face.verts) < xlo or min(v.co.x for v in face.verts) > xhi
                    or max(v.co.z for v in face.verts) < zlo or min(v.co.z for v in face.verts) > zhi):
                return False
            return face.calc_center_median().y < 0 and all(
                any(v[deform].get(g, 0) > .5 for g in groups) for v in face.verts)

        planes = []
        for a, b in zip(hull, hull[1:] + hull[:1]):
            edge = b - a
            normal = Vector((-edge.y, 0, edge.x)).normalized()
            point = Vector((a.x, 0, a.y))
            if normal.dot(Vector((centre.x, 0, centre.y)) - point) < 0:
                normal = -normal
            planes.append((point, normal))
            faces = [f for f in bm.faces if panel(f)]
            geometry = set(faces) | {e for f in faces for e in f.edges} | {v for f in faces for v in f.verts}
            bmesh.ops.bisect_plane(bm, geom=list(geometry), plane_co=point, plane_no=normal, dist=1e-6)
        gone = [f for f in bm.faces if panel(f) and all(
            (f.calc_center_median() - p).dot(n) > -1e-5 for p, n in planes)]
        bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    covered = {g.index for g in ob.vertex_groups if g.name in (
        "part_guimpe", "part_in_guimpe", "part_wimple", "part_in_wimple")}
    gone = [f for f in bm.faces if f.calc_center_median().y > 0 and all(
        any(v[deform].get(g, 0) > .5 for g in covered) for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
