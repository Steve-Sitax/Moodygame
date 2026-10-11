"""The near and the far copy of a body (docs/people.md "Two copies").

LOD0 (near, under 15 m): the cage subdivided once (Catmull-Clark, on the limit surface), UVs and weights carried
by the subdivision. LOD1 (far, from 15 m, and in the mirrors and the lantern shadow): the cage itself with every
vertex moved onto the same limit surface, so the far copy is not fatter than the near one and the switch does not
pop. Same UVs, same material, same skeleton.
"""

import math

import bmesh
import bpy
import numpy as np


def uv_unwrap(ob, scale_parts=None, margin=0.006):
    """Unwrap the cage along its marked seams (angle based), then lay the islands out ourselves: every island at
    the same texel density times its part's factor (the head gets more), turned to its smallest box, packed in
    shelves into the unit square."""
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    me = ob.data
    uvd = me.uv_layers.active.data
    uv = np.array([l.uv[:] for l in uvd])
    vg = {g.index: g.name[5:] for g in ob.vertex_groups if g.name.startswith("part_")}
    vpart = [None] * len(me.vertices)
    for v in me.vertices:
        best = -1
        for g in v.groups:
            if g.group in vg and g.weight > best:
                best, vpart[v.index] = g.weight, vg[g.group]
    # islands: faces joined by edges that are not seams
    seam = {tuple(sorted(e.vertices)) for e in me.edges if e.use_seam}
    edge_faces = {}
    for p in me.polygons:
        vs = list(p.vertices)
        for i in range(len(vs)):
            k = tuple(sorted((vs[i], vs[(i + 1) % len(vs)])))
            if k not in seam:
                edge_faces.setdefault(k, []).append(p.index)
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for fs in edge_faces.values():
        for f in fs[1:]:
            ra, rb = find(fs[0]), find(f)
            if ra != rb:
                parent[rb] = ra
    islands = {}
    for p in me.polygons:
        islands.setdefault(find(p.index), []).append(p)
    boxes = []
    for root, polys in islands.items():
        loops = np.array([li for p in polys for li in p.loop_indices])
        a3 = sum(p.area for p in polys)
        a2 = 0.0
        for p in polys:
            q = uv[list(p.loop_indices)]
            a2 += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
        part = vpart[polys[0].vertices[0]] or ""
        k = 1.0
        for pre, kk in (scale_parts or {}).items():
            if part.startswith(pre):
                k = kk
        s = math.sqrt(a3 / max(a2, 1e-12)) * k
        q = uv[loops] * s
        best = None
        for deg in range(0, 90, 3):
            r = math.radians(deg)
            R = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
            qq = q @ R.T
            ext = qq.max(0) - qq.min(0)
            if best is None or ext[0] * ext[1] < best[0]:
                best = (ext[0] * ext[1], qq)
        qq = best[1]
        qq -= qq.min(0)
        boxes.append((loops, qq))
    # shelves: tallest first, rows as wide as the square root of the total area allows
    pad = 0.0
    total = sum(np.prod(q.max(0)) for _, q in boxes)
    boxes.sort(key=lambda b: -b[1][:, 1].max())
    for trial in range(40):
        width = math.sqrt(total) * (1.05 + trial * 0.03)
        pad = width * margin * 2
        x = y = row_h = 0.0
        placed = []
        for loops, q in boxes:
            w_, h_ = q.max(0)
            if x + w_ > width:
                x, y, row_h = 0.0, y + row_h + pad, 0.0
            placed.append((loops, q + (x, y)))
            x += w_ + pad
            row_h = max(row_h, h_)
        height = y + row_h
        if height <= width:
            break
    side = max(width, height)
    for loops, q in placed:
        uv[loops] = (q + pad / 2) / (side + pad)
    uvd.foreach_set("uv", uv.ravel())
    me.update()


def subdivide(cage, name):
    """LOD0: a copy of the cage with one level of subdivision applied."""
    ob = cage.copy()
    ob.data = cage.data.copy()
    ob.name = name
    ob.data.name = name
    bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new("subd", "SUBSURF")
    m.levels = 1
    m.render_levels = 1
    m.use_limit_surface = True
    m.quality = 3
    m.uv_smooth = "PRESERVE_BOUNDARIES"
    m.boundary_smooth = "ALL"
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def to_limit(ob):
    """Move every vertex of a closed quad mesh onto its Catmull-Clark limit position:
    (n^2 v + 4 sum(edge neighbours) + sum(face corners across)) / (n (n + 5))."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    co = np.array([v.co[:] for v in bm.verts])
    new = co.copy()
    for v in bm.verts:
        n = len(v.link_edges)
        if n < 3 or any(len(e.link_faces) != 2 for e in v.link_edges):
            continue
        es = sum(co[e.other_vert(v).index] for e in v.link_edges)
        fs = np.zeros(3)
        ok = True
        for f in v.link_faces:
            if len(f.verts) != 4:
                ok = False
                break
            vs = [x.index for x in f.verts]
            k = vs.index(v.index)
            fs += co[vs[(k + 2) % 4]]
        if not ok:
            continue
        new[v.index] = (n * n * co[v.index] + 4 * es + fs) / (n * (n + 5))
    for v in bm.verts:
        v.co = new[v.index]
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)
