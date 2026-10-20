"""Fit cloth to skin and rebuild edge facings after reducing the visible surface.

Reducing an outer shell and its inset facing independently lets their triangles cross.
The facing is therefore made from the final outer triangles, with identical skin weights.
"""

import heapq
import bmesh
import numpy as np
from . import weights as wt
from . import clothes_build as cb


def strip(ob, weights=None):
    raw = wt.parts(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    original = bm.verts.layers.int.new("_lining_source")
    for v in bm.verts:
        v[original] = v.index
    shell = bm.faces.layers.int.get("cloth_outer")
    gone = (
        [f for f in bm.faces if not f[shell]]
        if shell
        else [
            f
            for f in bm.faces
            if any((raw[v.index] or "").startswith("in_") for v in f.verts)
        ]
    )
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    bmesh.ops.delete(
        bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS"
    )
    kept = [v[original] for v in bm.verts]
    bm.verts.layers.int.remove(original)
    if shell:
        bm.faces.layers.int.remove(shell)
    # Subdivision blends the outer and inner part groups at the original rim.
    # Those residual inner weights must not win after collapsing the outer shell.
    deform = bm.verts.layers.deform.active
    groups = {
        g.index: g.name[5:] for g in ob.vertex_groups if g.name.startswith("part_")
    }
    for v, index in zip(bm.verts, kept):
        part = (raw[index] or "").removeprefix("in_")
        for gi, name in groups.items():
            if gi in v[deform]:
                del v[deform][gi]
            if name == part:
                v[deform][gi] = 1.0
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return None if weights is None else np.asarray(weights)[kept]


def plans(ob, bm):
    raw = wt.parts(ob)
    bm.verts.ensure_lookup_table()
    bm.verts.index_update()
    names = sorted(
        {g.name[8:] for g in ob.vertex_groups if g.name.startswith("part_in_")}
    )
    for name in names:
        fs = {f for f in bm.faces if all((raw[v.index] == name for v in f.verts))}
        if not fs:
            continue
        esf = {e: sum((f in fs for f in e.link_faces)) for f in fs for e in f.edges}
        edges = [e for e, c in esf.items() if c == 1]
        depth = (
            100.0 if name == "apron" or name in ob.get("cloth_full_facings", ()) else
            0.12
            if name
            in (
                "bodice",
                "shawl",
                "coat",
                "jacket",
                "smock",
                "shirt",
                "waistcoat",
                "tunic",
                "chemise",
            )
            else 0.035
        )
        bvs = {v for e in edges for v in e.verts}
        dist = {v: 0.0 for v in bvs}
        q = [(0.0, v.index, v) for v in bvs]
        heapq.heapify(q)
        while q:
            d, _, v = heapq.heappop(q)
            if d > dist[v] or d > depth + 0.05:
                continue
            for e in v.link_edges:
                if e not in esf:
                    continue
                u = e.other_vert(v)
                nd = d + e.calc_length()
                if nd < dist.get(u, 1000000000.0):
                    dist[u] = nd
                    heapq.heappush(q, (nd, u.index, u))
        sel = [
            f
            for f in fs
            if any((v in bvs for v in f.verts))
            or max((dist.get(v, 1000000000.0) for v in f.verts)) < depth
        ]
        yield (name, fs, edges, sel)


def total(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    n = cb.tris(ob) + sum(
        (
            sum((len(f.verts) - 2 for f in sel)) + 2 * len(edges)
            for _, _, edges, sel in plans(ob, bm)
        )
    )
    bm.free()
    return n


def line(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    jobs = list(plans(ob, bm))
    # Keep the exact outer vertex, including at folds whose nearest face changes.
    linked = bm.verts.layers.int.get("_facing_pair") or bm.verts.layers.int.new("_facing_pair")
    bm.verts.ensure_lookup_table()
    for i, v in enumerate(bm.verts):
        v[linked] = i + 1
    deform = bm.verts.layers.deform.active

    def copyloop(dst, src):
        for lay in bm.loops.layers.uv.values():
            dst[lay].uv = src[lay].uv

    for name, fs, edges, sel in jobs:
        vm = {}
        inner = ob.vertex_groups["part_in_" + name]
        outer = ob.vertex_groups["part_" + name]
        for v in {v for f in sel for v in f.verts}:
            pos = v.co.copy()
            normal = v.normal.copy()
            weights = dict(v[deform])
            nv = bm.verts.new(pos - normal * 0.003)
            nv[linked] = v[linked]
            for gi, w in weights.items():
                nv[deform][gi] = w
            nv[deform][outer.index] = 0
            nv[deform][inner.index] = 1
            vm[v] = nv
        for f in sel:
            nf = bm.faces.new([vm[v] for v in reversed(f.verts)])
            nf.smooth = True
            for l in nf.loops:
                copyloop(l, next((l0 for l0 in f.loops if vm[l0.vert] == l.vert)))
        for e in edges:
            e.seam = True  # the facing and its rolled edge need separate UV charts
            f = next((f for f in e.link_faces if f in fs))
            vs = list(f.verts)
            a, b = e.verts
            if vs[(vs.index(a) + 1) % len(vs)] != b:
                a, b = (b, a)
            if a in vm and b in vm:
                nf = bm.faces.new([b, a, vm[a], vm[b]])
                nf.smooth = True
                for l in nf.loops:
                    copyloop(
                        l,
                        next(
                            (
                                l0
                                for l0 in f.loops
                                if l0.vert == (a if l.vert in (a, vm[a]) else b)
                            )
                        ),
                    )
        for e in {edge for face in fs for edge in face.edges}:
            a, b = e.verts
            if e.seam and a in vm and b in vm:
                inner_edge = bm.edges.get((vm[a], vm[b]))
                if inner_edge:
                    inner_edge.seam = True
        # Open each closed rim strip once, so it unfolds without a planar projection
        # that overlays the front and back of the cloth.
        remaining = set(edges)
        while remaining:
            first = min(remaining, key=lambda e: min(v.index for v in e.verts))
            vertex = min(first.verts, key=lambda v: v.index)
            seam = bm.edges.get((vertex, vm[vertex]))
            if seam:
                seam.seam = True
            stack = [first]
            while stack:
                edge = stack.pop()
                if edge not in remaining:
                    continue
                remaining.remove(edge)
                stack.extend(
                    e for v in edge.verts for e in v.link_edges if e in remaining
                )
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def reduce_lined(ob, budget, surface_reduce, **kwargs):
    """Reserve room for 3 mm edge facings inside the caller's triangle budget."""
    kwargs = dict(kwargs)
    kwargs["weights"] = strip(ob, kwargs.get("weights"))
    surface_reduce(ob, int(budget * 0.60), **kwargs)
    kwargs.pop("weights", None)
    for _ in range(12):
        count = total(ob)
        if count <= budget:
            break
        surface_reduce(
            ob,
            max(12, int(cb.tris(ob) * (budget - max(100, budget * 0.02)) / count)),
            **kwargs,
        )
    if total(ob) > budget:
        raise ValueError("Clothing edge facings exceed budget: " + ob.name)
    line(ob)
    return cb.tris(ob)


def tuck_skin(ob, over):
    """Inset skin under its own limb's cloth, without pulling hands into a nearby coat or trousers."""
    from mathutils.bvhtree import BVHTree

    me = ob.data
    raw, upper_parts = (wt.parts(ob), wt.parts(over))
    limb, upper_limb = (cb.limbs(ob), cb.limbs(over))
    faces = {}
    for f in over.data.polygons:
        ids = tuple(f.vertices)
        if any(((upper_parts[i] or "").startswith("in_") for i in ids)):
            continue
        group = max(
            set((upper_limb[i] for i in ids)),
            key=lambda g: sum((upper_limb[i] == g for i in ids)),
        )
        faces.setdefault(group, []).append(ids)
    vertices = [tuple(v.co) for v in over.data.vertices]
    trees = {group: BVHTree.FromPolygons(vertices, fs) for group, fs in faces.items()}
    for v in me.vertices:
        if not (raw[v.index] or "").startswith(("torso", "neck", "arm", "leg")):
            continue
        tree = trees.get(limb[v.index])
        if tree is None:
            continue
        loc, normal, _, distance = tree.find_nearest(v.co, 0.05)
        if loc is None or normal.dot(v.normal) < 0.25:
            continue
        height = (v.co - loc).dot(normal)
        tangent = v.co - loc - normal * height
        if height < -0.008 or tangent.length > 0.002:
            continue
        delta = normal * (-0.008 - height)
        v.co += delta
        if me.shape_keys:
            for key in me.shape_keys.key_blocks:
                key.data[v.index].co += delta
    me.update()


def protect_openings(ob, over, covered):
    """Keep skin behind open sleeve edges when bending exposes the inside."""
    from mathutils.kdtree import KDTree

    raw = wt.parts(over)
    limb = cb.limbs(over)
    zones = cb.zones_of(over)
    from .clothes_kit import _outer_bvh

    outer = {
        name: _outer_bvh(over, raw, name)
        for name in set(raw)
        if name and not name.startswith("in_")
    }
    edges = {}
    for face in over.data.polygons:
        ids = list(face.vertices)
        if any((raw[i] or "").startswith("in_") for i in ids):
            continue
        for a, b in zip(ids, ids[1:] + ids[:1]):
            key = tuple(sorted((a, b)))
            edges[key] = edges.get(key, 0) + 1
    samples = {}
    for (a, b), count in edges.items():
        if count != 1:
            continue
        # Only the sleeve's opening protects arm skin. A coat's open front or
        # an armhole near the shoulder can be arm-weighted too.
        if not all(
            zones[i] == "arm" or (raw[i] or "").startswith(("cuff", "sleeve"))
            for i in (a, b)
        ):
            continue
        va, vb = over.data.vertices[a].co, over.data.vertices[b].co
        # A cuff's upper edge is inside the coat. It must not retain a long skin
        # triangle up the forearm merely because it is an edge of the inner layer.
        normal = (
            over.data.vertices[a].normal + over.data.vertices[b].normal
        ).normalized()
        midpoint = (va + vb) * 0.5
        if any(
            tree
            and name != raw[a]
            and tree.ray_cast(midpoint + normal * 0.0002, normal, 0.04)[0] is not None
            for name, tree in outer.items()
        ):
            continue
        steps = max(1, int((vb - va).length / 0.005))
        for group in {limb[a], limb[b]}:
            samples.setdefault(group, []).extend(
                va.lerp(vb, k / steps) for k in range(steps + 1)
            )
    trees = {}
    for group, points in samples.items():
        tree = KDTree(len(points))
        for i, point in enumerate(points):
            tree.insert(point, i)
        tree.balance()
        trees[group] = tree
    body_limb, body_part = cb.limbs(ob), wt.parts(ob)
    for vertex in ob.data.vertices:
        i = vertex.index
        if not covered[i] or not (body_part[i] or "").startswith("arm"):
            continue
        tree = trees.get(body_limb[i])
        if tree is not None and tree.find(vertex.co)[2] < 0.065:
            covered[i] = False


def finish_ease(ob):
    """Leave room for a seated apron; keep each facing with its outer shell."""
    from .clothes_kit import bind_linings

    carry = bind_linings(ob)
    raw = wt.parts(ob)
    for v in ob.data.vertices:
        part = raw[v.index] or ""
        distance = 0.015 if part == "apron" else 0
        if distance:
            v.co += v.normal * distance
    ob.data.update()
    carry()


def sleeve_binding(skin):
    """Capture uncut arms, then bind blouse sleeves to their actual skin and identity shapes."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc
    from .rig import NAMES

    parts = wt.parts(skin)
    sw = wt.read(skin)
    arms = {}
    for side in "LR":
        ids = [v.index for v in skin.data.vertices if parts[v.index] == "arm" + side]
        lookup = {v: i for i, v in enumerate(ids)}
        co = [skin.data.vertices[i].co.copy() for i in ids]
        faces = []
        for face in skin.data.polygons:
            if all(i in lookup for i in face.vertices):
                vs = [lookup[i] for i in face.vertices]
                faces.extend((vs[0], vs[k], vs[k + 1]) for k in range(1, len(vs) - 1))
        if not faces:
            continue
        keys = (
            {
                key.name: [key.data[i].co - skin.data.vertices[i].co for i in ids]
                for key in skin.data.shape_keys.key_blocks
                if key != skin.data.shape_keys.reference_key
            }
            if skin.data.shape_keys
            else {}
        )
        arms["arm" + side] = (
            BVHTree.FromPolygons(co, faces, all_triangles=True),
            co,
            faces,
            sw[ids],
            keys,
        )

    def apply(ob):
        raw, limb, weights = wt.parts(ob), cb.limbs(ob), wt.read(ob)
        changed = []
        for v in ob.data.vertices:
            i = v.index
            if raw[i] not in ("bodice", "in_bodice") or limb[i] not in arms:
                continue
            tree, co, faces, source_weights, keys = arms[limb[i]]
            loc, normal, face, _ = tree.find_nearest(v.co, 0.08)
            if loc is None:
                continue
            ids = faces[face]
            blend = poly_3d_calc([co[j] for j in ids], loc)
            height = (v.co - loc).dot(normal)
            clearance = 0.011 if raw[i].startswith("in_") else 0.014
            v.co += normal * max(0, clearance - height)
            weights[i] = sum(source_weights[j] * w for j, w in zip(ids, blend))
            changed.append(i)
            if ob.data.shape_keys:
                for key in ob.data.shape_keys.key_blocks:
                    if key == ob.data.shape_keys.reference_key:
                        key.data[i].co = v.co
                    elif key.name in keys:
                        key.data[i].co = v.co + sum(
                            (keys[key.name][j] * w for j, w in zip(ids, blend)),
                            Vector(),
                        )
        for group in ob.vertex_groups:
            if group.name in NAMES:
                group.remove(changed)
        wt.apply_rows(ob, weights, changed)
        ob.data.update()

    return apply


def wrap_shawl(ob):
    """Keep a shoulder wrap outside the blouse's horizontal silhouette.

    Nearest-face normals can point into the armpit on a folded ribbon. A shawl
    bridges that hollow; its radial support is the convex blouse section.
    """
    from mathutils import Vector
    from mathutils.geometry import convex_hull_2d
    from .clothes_kit import bind_linings

    raw = wt.parts(ob)
    if "shawl" not in raw or "bodice" not in raw:
        return
    carry = bind_linings(ob)
    co = [v.co.copy() for v in ob.data.vertices]
    edges = {
        tuple(sorted((a, b)))
        for face in ob.data.polygons
        if all(raw[i] == "bodice" for i in face.vertices)
        for a, b in zip(face.vertices, list(face.vertices)[1:] + [face.vertices[0]])
    }
    for vertex in ob.data.vertices:
        if raw[vertex.index] != "shawl":
            continue
        y = vertex.co.z
        points = []
        for a, b in edges:
            va, vb = co[a], co[b]
            if (va.z <= y < vb.z) or (vb.z <= y < va.z):
                q = va.lerp(vb, (y - va.z) / (vb.z - va.z))
                points.append(Vector((q.x, q.y)))
        if len(points) < 3:
            continue
        hull = [points[i] for i in convex_hull_2d(points)]
        centre = np.array(
            (0.0, (min(p.y for p in hull) + max(p.y for p in hull)) * 0.5)
        )
        offset = np.array(vertex.co[:2]) - centre
        radius = np.linalg.norm(offset)
        if radius < 1e-6:
            continue
        direction = offset / radius
        support = 0.0
        for a, b in zip(hull, hull[1:] + hull[:1]):
            a, b = np.array(a), np.array(b)
            try:
                distance, t = np.linalg.solve(
                    np.column_stack((direction, a - b)), a - centre
                )
            except np.linalg.LinAlgError:
                continue
            if distance >= 0 and -1e-5 <= t <= 1 + 1e-5:
                support = max(support, distance)
        delta = Vector((*(direction * max(0.0, support + 0.040 - radius)), 0.0))
        vertex.co += delta
        if ob.data.shape_keys:
            for key in ob.data.shape_keys.key_blocks:
                key.data[vertex.index].co += delta
    ob.data.update()
    carry()


def soften_wrap(ob):
    """Relax sharp fold reversals in a knitted shoulder wrap before fitting it."""
    from mathutils import Vector
    raw = wt.parts(ob)
    if "shawl" not in raw:
        return
    edges = {}
    for face in ob.data.polygons:
        ids = list(face.vertices)
        if not all(raw[i] == "shawl" for i in ids):
            continue
        for a, b in zip(ids, ids[1:] + ids[:1]):
            edge = tuple(sorted((a, b)))
            edges[edge] = edges.get(edge, 0) + 1
    adjacent, boundary = {}, set()
    for (a, b), count in edges.items():
        adjacent.setdefault(a, []).append(b)
        adjacent.setdefault(b, []).append(a)
        if count == 1:
            boundary.update((a, b))
    co = [v.co.copy() for v in ob.data.vertices]
    # A coarse far ribbon may have only one interior row. Repeating the near
    # relaxation collapses its whole width into a cord across the blouse.
    for _ in range(1 if ob.name.endswith("_lod1") else 16):
        before = [p.copy() for p in co]
        for i, neighbours in adjacent.items():
            mean = sum((before[j] for j in neighbours), Vector()) / len(neighbours)
            co[i] = before[i].lerp(mean, .18 if i in boundary else .5)
    for i in adjacent:
        delta = co[i] - ob.data.vertices[i].co
        ob.data.vertices[i].co = co[i]
        if ob.data.shape_keys:
            for key in ob.data.shape_keys.key_blocks:
                key.data[i].co += delta
    ob.data.update()


def finish_wrap(ob):
    """Remove small fold reversals after fitting without shrinking the shawl.

    Alternating smoothing and inflation retains an open wrap's panel width.
    Closed capes smooth only their neckline; coarse open wraps retain their width.
    """
    from collections import Counter
    from mathutils import Vector
    raw, me = wt.parts(ob), ob.data
    if "shawl" not in raw:
        return
    edges = Counter()
    for face in me.polygons:
        ids = list(face.vertices)
        if all(raw[i] == "shawl" for i in ids):
            edges.update(tuple(sorted((a,b))) for a,b in zip(ids, ids[1:]+ids[:1]))
    adjacent, rim = {}, {}
    for (a,b), count in edges.items():
        adjacent.setdefault(a, []).append(b); adjacent.setdefault(b, []).append(a)
        if count == 1:
            rim.setdefault(a, []).append(b); rim.setdefault(b, []).append(a)
    left, loops = set(rim), []
    while left:
        found = {left.pop()}; stack = list(found)
        while stack:
            for j in rim[stack.pop()]:
                if j in left:
                    left.remove(j); found.add(j); stack.append(j)
        loops.append(found)
    if len(loops) == 2:
        finish_cape_rim(ob)
        return
    if len(loops) != 1 or ob.name.endswith("_lod1"):
        return
    fringe = fringe_binding(ob)
    co = [v.co.copy() for v in me.vertices]
    for _ in range(24):
        for factor in (.5, -.53):
            before = [v.copy() for v in co]
            for i, neighbours in adjacent.items():
                mean = sum((before[j] for j in neighbours), Vector()) / len(neighbours)
                co[i] = before[i].lerp(mean, factor)
    for i in adjacent:
        delta = co[i] - me.vertices[i].co
        me.vertices[i].co = co[i]
        if me.shape_keys:
            for key in me.shape_keys.key_blocks:
                key.data[i].co += delta
    me.update()
    wrap_shawl(ob)
    for _ in range(4):
        cb.tuck(ob, None, {("bodice", "shawl")}, lambda p,n: False,
                clearance=.03, reach=.15, agree=.2)
    fit_linings(ob)
    fringe()


def finish_cape_rim(ob):
    """Smooth only a closed cape's neckline, retaining its draped lower edge."""
    from collections import Counter
    from mathutils import Vector
    raw, me = wt.parts(ob), ob.data
    edges = Counter()
    for face in me.polygons:
        ids = list(face.vertices)
        if all(raw[i] == "shawl" for i in ids):
            edges.update(tuple(sorted((a,b))) for a,b in zip(ids, ids[1:]+ids[:1]))
    rim = {}
    for (a,b), count in edges.items():
        if count == 1:
            rim.setdefault(a, []).append(b); rim.setdefault(b, []).append(a)
    left, loops = set(rim), []
    while left:
        found = {left.pop()}; stack = list(found)
        while stack:
            for j in rim[stack.pop()]:
                if j in left:
                    left.remove(j); found.add(j); stack.append(j)
        loops.append(found)
    if len(loops) != 2:
        return
    co = [v.co.copy() for v in me.vertices]
    top = max(loops, key=lambda loop: sum(co[i].z for i in loop)/len(loop))
    for _ in range(24):
        before = [v.copy() for v in co]
        for i in top:
            mean = sum((before[j] for j in rim[i]), Vector())/len(rim[i])
            co[i] = before[i].lerp(mean, .5)
    def shift(i, at):
        delta = at - me.vertices[i].co
        me.vertices[i].co = at
        if me.shape_keys:
            for key in me.shape_keys.key_blocks:
                key.data[i].co += delta
    for i in top:
        shift(i, co[i])
    me.update()
    pair = me.attributes.get("_facing_pair")
    if pair:
        exact = {pair.data[i].value:i for i in top if pair.data[i].value > 0}
        for i, name in enumerate(raw):
            source = exact.get(pair.data[i].value) if name == "in_shawl" else None
            if source is not None:
                shift(i, me.vertices[source].co-me.vertices[source].normal*.003)
    me.update()


def fringe_binding(ob):
    """Keep a fringe sewn to its original shawl edge through fitting and posing."""
    from mathutils import Vector
    from .rig import NAMES

    raw = wt.parts(ob)
    if not {"shawl", "shawl_fringe"} <= set(raw):
        return lambda: None
    co = [v.co.copy() for v in ob.data.vertices]
    counts = {}
    for face in ob.data.polygons:
        ids = list(face.vertices)
        if not all(raw[i] == "shawl" for i in ids):
            continue
        for a, b in zip(ids, ids[1:] + ids[:1]):
            edge = tuple(sorted((a, b)))
            counts[edge] = counts.get(edge, 0) + 1
    edges = [edge for edge, count in counts.items() if count == 1]
    if not edges:
        raise ValueError("Fringed shawl has no edge: " + ob.name)
    links = []
    for i, part in enumerate(raw):
        if part not in ("shawl_fringe", "in_shawl_fringe"):
            continue
        nearest = []
        for a, b in edges:
            edge = co[b] - co[a]
            t = max(0, min(1, (co[i] - co[a]).dot(edge) / max(edge.length_squared, 1e-12)))
            at = co[a].lerp(co[b], t)
            nearest.append(((co[i] - at).length_squared, a, b, t, at))
        _, a, b, t, at = min(nearest, key=lambda item: item[0])
        links.append((i, a, b, t, max(0, at.z - co[i].z), part.startswith("in_")))

    def apply():
        weights = wt.read(ob)
        changed = []
        co = [v.co.copy() for v in ob.data.vertices]
        for i, a, b, t, drop, inner in links:
            va, vb = ob.data.vertices[a], ob.data.vertices[b]
            normal = va.normal.lerp(vb.normal, t).normalized()
            # Sew the top 8 mm beneath the hem; the hanging tassels clear its face.
            at = va.co.lerp(vb.co, t) + Vector((0, 0, .008 - drop))
            at += normal * (-.008 + min(.012, drop * .3) - (.003 if inner else 0))
            ob.data.vertices[i].co = at
            weights[i] = weights[a] * (1 - t) + weights[b] * t
            changed.append(i)
            if ob.data.shape_keys:
                for key in ob.data.shape_keys.key_blocks:
                    key.data[i].co = (at if key == ob.data.shape_keys.reference_key else at
                                     + (key.data[a].co - co[a]) * (1 - t)
                                     + (key.data[b].co - co[b]) * t)
        for group in ob.vertex_groups:
            if group.name in NAMES:
                group.remove(changed)
        wt.apply_rows(ob, weights, changed)
        ob.data.update()
    return apply


def bind_apron(ob):
    """Carry sewn outer layers with their backing through seated and identity shapes."""
    from .cloth_drape import carry_apron

    if not carry_apron(ob):
        bind_layer(ob, "apron", "skirt")
    bind_layer(ob, "veil", "guimpe", margin=0.025, interior_only=True)
    bind_layer(ob, "veil", "coif", margin=0.025, interior_only=True)
    fringe = fringe_binding(ob)
    soften_wrap(ob)
    wrap_shawl(ob)
    bind_layer(ob, "shawl", "bodice", margin=0.035)
    fringe()
    bind_layer(ob, "apron_bib", "bodice", trunk_only=True)
    bind_layer(ob, "pinafore_bib", "bodice", trunk_only=True)
    bind_layer(ob, "pinafore_straps", "bodice", trunk_only=True, margin=0.018)
    if not carry_apron(ob, "pad", "shirt"):
        for under in ("shirt", "smock"):
            bind_layer(ob, "pad", under, margin=0.035, interior_only=True)
    bind_layer(ob, "overskirt", "bodice", margin=0.025, reach=0.06, trunk_only=True)
    for side in "LR":
        bind_layer(ob, "cuff" + side, "coat", inset=True)
    if "shawl" in wt.parts(ob):
        for _ in range(4):
            cb.tuck(ob, None, {("bodice", "shawl")}, lambda p, n: False,
                    clearance=.03, reach=.15, agree=.2)
    fit_linings(ob)
    covered_blouse_sleeves(ob)
    from .cloth_masks import bib_under_veil
    bib_under_veil(ob)


def covered_blouse_sleeves(ob):
    """A closed coat sleeve replaces the blouse sleeve underneath it.

    This is an authored garment mask, independent of pose occlusion. The blouse
    front remains complete behind the open coat; closed arm, side and back panels are hidden.
    """
    raw, zones = wt.parts(ob), cb.zones_of(ob)
    under = {"bodice", "shirt", "waistcoat"}.intersection(raw)
    if not under or not any(p in ("coat", "smock") and z == "arm" for p, z in zip(raw, zones)):
        return
    under |= {"in_" + name for name in under}
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    gone = [f for f in bm.faces
            if all(raw[v.index] in under for v in f.verts)
            and (sum(zones[v.index] == "arm" for v in f.verts) >= len(f.verts) / 2
                 or abs(sum(v.co.x for v in f.verts) / len(f.verts)) > 0.13
                 or sum(v.co.y for v in f.verts) / len(f.verts) > 0.0)]
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def apron_edges(ob):
    """Keep a work apron's cut edge smooth after cloth reduction and clearance.

    Pleats remain in the panel. Their rim must form one sewn edge rather than
    alternating spikes from independently displaced boundary vertices.
    Skirt aprons already obtain continuous edges from their clipping planes.
    """
    raw = wt.parts(ob)
    if "apron" not in raw or "skirt" in raw:
        return
    strip(ob)
    raw = wt.parts(ob)
    counts = {}
    for face in ob.data.polygons:
        ids = list(face.vertices)
        if not all(raw[i] == "apron" for i in ids):
            continue
        for a, b in zip(ids, ids[1:] + ids[:1]):
            edge = tuple(sorted((a, b)))
            counts[edge] = counts.get(edge, 0) + 1
    adjacent = {}
    for (a, b), count in counts.items():
        if count == 1:
            adjacent.setdefault(a, []).append(b)
            adjacent.setdefault(b, []).append(a)
    if not adjacent:
        line(ob)
        return
    co = [v.co.copy() for v in ob.data.vertices]
    bottom = min(co[i].z for i in adjacent)
    top = max(co[i].z for i in adjacent)
    ends = {i: top if co[i].z > top - .025 else bottom
            for i in adjacent if co[i].z > top - .025 or co[i].z < bottom + .025}
    for _ in range(8):
        before = [p.copy() for p in co]
        for i, neighbours in adjacent.items():
            if len(neighbours) != 2:
                continue
            a, b = neighbours
            co[i] = before[i] * .5 + (before[a] + before[b]) * .25
            if i in ends:
                co[i].z = ends[i]
    for i in adjacent:
        ob.data.vertices[i].co = co[i]
    ob.data.update()
    line(ob)


def coat_apron_ease(ob, forward=0.04):
    """Lay an apron outside the coat's front, excluding the arms beside it."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    raw, zones = wt.parts(ob), cb.zones_of(ob)
    layers = {"coat", "waistcoat", "frock_coat"}.intersection(raw)
    if "apron" not in raw or not layers:
        return
    co = [v.co.copy() for v in ob.data.vertices]
    faces = [tuple(f.vertices) for f in ob.data.polygons
             if all(raw[i] in layers and zones[i] != "arm" for i in f.vertices)]
    tree = BVHTree.FromPolygons(co, faces) if faces else None
    top = max(v.co.z for v in ob.data.vertices if raw[v.index] == "apron")
    for v in ob.data.vertices:
        if raw[v.index] not in ("apron", "in_apron"):
            continue
        fall = min(1.0, max(0.0, (top - v.co.z) / 0.06))
        target = v.co.y - forward * fall
        if tree:
            start = v.co + Vector((0, -2, 0))
            hit, _, _, _ = tree.ray_cast(start, Vector((0, 1, 0)), 3)
            if hit is not None:
                target = min(target, hit.y - (0.008 + 0.027 * fall))
        delta = Vector((0, target - v.co.y, 0))
        v.co += delta
        if ob.data.shape_keys:
            for key in ob.data.shape_keys.key_blocks:
                key.data[v.index].co += delta
    ob.data.update()


def fit_linings(ob):
    """Facings inherit the final outer cloth's position, weights and shape offsets."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc
    from .rig import NAMES

    me, raw, weights = ob.data, wt.parts(ob), wt.read(ob)
    co = [v.co.copy() for v in me.vertices]
    pair = me.attributes.get("_facing_pair")
    exact = {(raw[i], pair.data[i].value): i for i in range(len(co))
             if pair and pair.data[i].value > 0 and raw[i] and not raw[i].startswith("in_")}
    changed = []
    for part in sorted({p[3:] for p in raw if p and p.startswith("in_")}):
        if part in ("apron", "pad") and me.attributes.get("_" + part + "_under") is not None:
            continue
        faces = []
        for face in me.polygons:
            ids = list(face.vertices)
            if all(raw[i] == part for i in ids):
                faces.extend(
                    (ids[0], ids[k], ids[k + 1]) for k in range(1, len(ids) - 1)
                )
        if not faces:
            continue
        tree = BVHTree.FromPolygons(co, faces, all_triangles=True)
        for i, name in enumerate(raw):
            if name != "in_" + part:
                continue
            linked = exact.get((part, pair.data[i].value)) if pair else None
            if linked is not None:
                loc, normal = co[linked], me.vertices[linked].normal
                ids, blend = [linked], [1.0]
            else:
                loc, normal, face, _ = tree.find_nearest(co[i])
                if loc is None:
                    continue
                ids = faces[face]
                blend = poly_3d_calc([co[j] for j in ids], loc)
            at = loc - normal * 0.003
            me.vertices[i].co = at
            weights[i] = sum(weights[j] * w for j, w in zip(ids, blend))
            changed.append(i)
            if me.shape_keys:
                for key in me.shape_keys.key_blocks:
                    key.data[i].co = (
                        at
                        if key == me.shape_keys.reference_key
                        else at
                        + sum(
                            ((key.data[j].co - co[j]) * w for j, w in zip(ids, blend)),
                            Vector(),
                        )
                    )
    for group in ob.vertex_groups:
        if group.name in NAMES:
            group.remove(changed)
    wt.apply_rows(ob, weights, changed)
    me.update()


def bind_layer(
    ob,
    outer,
    under,
    trunk_only=False,
    inset=False,
    region=None,
    margin=None,
    reach=0.15,
    interior_only=False,
):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    from mathutils.interpolate import poly_3d_calc
    from .rig import NAMES

    me = ob.data
    raw = wt.parts(ob)
    limb = cb.limbs(ob)
    co = [v.co.copy() for v in me.vertices]
    faces = []
    for face in me.polygons:
        ids = list(face.vertices)
        if (
            all(raw[i] == under for i in ids)
            and (region is None or all(limb[i] == region for i in ids))
            and (not trunk_only or all(limb[i] == "trunk" for i in ids))
            and (not inset or all(limb[i] == "arm" + outer[-1] for i in ids))
        ):
            faces.extend((ids[0], ids[k], ids[k + 1]) for k in range(1, len(ids) - 1))
    if not faces:
        return
    tree = BVHTree.FromPolygons(co, faces, all_triangles=True)
    weights = wt.read(ob)
    changed = []
    for vertex in me.vertices:
        i = vertex.index
        if raw[i] not in (outer, "in_" + outer):
            continue
        if region is not None and limb[i] != region:
            continue
        loc, normal, face, _ = tree.find_nearest(vertex.co, 0.035 if inset else reach)
        if loc is None:
            continue
        ids = faces[face]
        blend = poly_3d_calc([co[j] for j in ids], loc)
        height = (co[i] - loc).dot(normal)
        clearance = (
            margin if margin is not None else 0.020 if outer == "shawl" else 0.012
        ) - (0.003 if raw[i].startswith("in_") else 0)
        tangent = (co[i] - loc - normal * height).length
        if interior_only and tangent >= 0.002:
            continue
        if tangent < (0.002 if inset else 0.02):
            # A shirt cuff follows its sleeve but stays inside it. Beyond the
            # sleeve's open rim, preserve the exposed cuff's length and profile.
            inner_depth = 0.003 if raw[i].startswith("in_") else 0
            offset = (
                min(0, -0.012 - inner_depth - height)
                if inset
                else max(0, clearance - height)
            )
            delta = normal * offset
            co[i] += delta
            vertex.co += delta
        weights[i] = sum(weights[j] * w for j, w in zip(ids, blend))
        changed.append(i)
        if me.shape_keys:
            for key in me.shape_keys.key_blocks:
                key.data[i].co = (
                    co[i]
                    if key == me.shape_keys.reference_key
                    else co[i]
                    + sum(
                        ((key.data[j].co - co[j]) * w for j, w in zip(ids, blend)),
                        Vector(),
                    )
                )
    for group in ob.vertex_groups:
        if group.name in NAMES:
            group.remove(changed)
    wt.apply_rows(ob, weights, changed)
    me.update()


def clipped_face(pc, ids):
    clean = []
    for i in ids:
        if not clean or i != clean[-1]:
            clean.append(i)
    if len(clean) > 1 and clean[0] == clean[-1]:
        clean.pop()
    if len(set(clean)) < 3:
        return
    points = np.asarray([pc.V[i] for i in clean])
    normal = sum(
        (np.cross(a, b) for a, b in zip(points, np.roll(points, -1, axis=0))),
        np.zeros(3),
    )
    if np.linalg.norm(normal) > 1e-10:
        pc.face(clean)


def skin_upper(fit, pc, rows):
    """Cut a closed blouse from the measured skin, preserving the body's limb topology."""
    from .rig import NAMES
    from mathutils.kdtree import KDTree
    from mathutils import Vector

    waist = min(fit.rest[i][1] for i in fit.row(rows[0]) if i >= 0)
    neck = float(fit.S[fit.Spart == "torso", 1].max()) + 0.012
    cuff = {side: float(fit.J["hand" + side][0][1]) + 0.025 for side in "LR"}
    # Signed boundary distances interpolate on triangles; the resulting neck and cuffs
    # have continuous edges instead of a staircase of deleted skin faces.
    co = fit.S
    distances = []
    for i, point in enumerate(co):
        part = fit.Spart[i]
        low = cuff[part[-1]] if part.startswith("arm") else waist
        distances.append((float(point[1] - low), float(neck - point[1])))
    weld = {}
    for tri in fit.tris:
        poly = [
            (
                co[i].copy(),
                fit.SN[i].copy(),
                fit.SW[i].copy(),
                np.array(distances[i]),
                "arm" if fit.Spart[i].startswith("arm") else "torso",
            )
            for i in tri
        ]
        for plane in range(2):
            clipped = []
            for a, b in zip(poly, poly[1:] + poly[:1]):
                da, db = a[3][plane], b[3][plane]
                if da >= 0:
                    clipped.append(a)
                if (da >= 0) != (db >= 0):
                    t = da / (da - db)
                    clipped.append(
                        tuple(a[k] * (1 - t) + b[k] * t for k in range(4))
                        + (a[4] if t < 0.5 else b[4],)
                    )
            poly = clipped
            if not poly:
                break
        if len(poly) < 3:
            continue
        ids = []
        for point, normal, weights, boundary, zone in poly:
            key = tuple(np.round(point, 7))
            if key not in weld:
                normal /= max(np.linalg.norm(normal), 1e-9)
                ease = 0.018 if zone == "arm" else 0.022
                position = point + normal * ease
                # Fade the vertical ease into the level neckline. Otherwise vertices
                # just inside the cut rise above its rim and make a jagged collar.
                position[1] = point[1] + normal[1] * ease * min(
                    1.0, max(0.0, boundary[1] / 0.035)
                )
                weld[key] = pc.add(
                    position,
                    {NAMES[j]: float(w) for j, w in enumerate(weights) if w > 1e-5},
                    zone=zone,
                )
            ids.append(weld[key])
        clipped_face(pc, ids)
    edge_count = {}
    for face in pc.F:
        for a, b in zip(face, face[1:] + face[:1]):
            e = tuple(sorted((a, b)))
            edge_count[e] = edge_count.get(e, 0) + 1
    for (a, b), count in edge_count.items():
        if count == 1:
            pc.set_crease(a, b, 1.0)
    tree = KDTree(len(pc.V))
    for i, point in enumerate(pc.V):
        tree.insert(Vector(point), i)
    tree.balance()
    return {i: tree.find(Vector(point))[1] for i, point in enumerate(fit.rest)}, {}


def fit_old_shawl(fit, pieces):
    """Drape a closed shoulder wrap on horizontal sections of the actual blouse.

    The old upright ribbon pattern snapped onto the wrong side of the stooped
    shoulders. Convex sections bridge the armpits without folding into the skin.
    """
    from mathutils import Vector
    from mathutils.geometry import convex_hull_2d
    from . import clothes_kit as ck, garments_women as gw

    bodice = next((p for p in pieces if p.name == "bodice"), None)
    old = next((p for p in pieces if p.name == "shawl"), None)
    if bodice is None or old is None:
        return pieces
    chemise = next((p for p in pieces if p.name == "chemise"), None)
    if chemise is not None:
        # Only the standing cream collar is exposed. Cut it from the same blouse
        # surface; the upright cage's buried chemise crossed the stooped back.
        collar = ck.Piece("chemise", chemise.cloth, scale=chemise.scale)
        normals = bodice.normals()
        low = float(fit.S[fit.Spart == "torso", 1].max()) - 0.013
        weld = {}
        for face in bodice.F:
            if any(bodice.inner[i] for i in face):
                continue
            poly = [(bodice.V[i], normals[i], bodice.W[i]) for i in face]
            cut = []
            for a, b in zip(poly, poly[1:] + poly[:1]):
                da, db = a[0][1] - low, b[0][1] - low
                if da >= 0:
                    cut.append(a)
                if (da >= 0) != (db >= 0):
                    t = da / (da - db)
                    weights = {
                        k: a[2].get(k, 0) * (1 - t) + b[2].get(k, 0) * t
                        for k in a[2].keys() | b[2].keys()
                    }
                    cut.append(
                        (a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, weights)
                    )
            if len(cut) < 3:
                continue
            ids = []
            for point, normal, weights in cut:
                key = tuple(np.round(point, 7))
                if key not in weld:
                    weld[key] = collar.add(point + normal * 0.004, weights, zone="neck")
                ids.append(weld[key])
            clipped_face(collar, ids)
        ck.thicken(collar, 0.0015, depth=None)
        pieces = [collar if p is chemise else p for p in pieces]
    onto = ck.Onto([bodice])
    shawl = ck.Piece("shawl", old.cloth, scale=old.scale)
    verts = np.asarray(bodice.V)
    edges = {
        tuple(sorted((a, b)))
        for f in bodice.F
        if not any(bodice.inner[v] for v in f)
        for a, b in zip(f, f[1:] + f[:1])
    }

    def section(y, direction):
        pts = []
        for a, b in edges:
            va, vb = verts[a], verts[b]
            if (va[1] <= y < vb[1]) or (vb[1] <= y < va[1]):
                q = va + (vb - va) * ((y - va[1]) / (vb[1] - va[1]))
                pts.append(Vector((q[0], q[2])))
        if len(pts) < 3:
            raise ValueError("No blouse section for shawl")
        hull = [pts[i] for i in convex_hull_2d(pts)]
        centre = np.array(
            (0.0, (min(p.y for p in hull) + max(p.y for p in hull)) * 0.5)
        )
        best = None
        for a, b in zip(hull, hull[1:] + hull[:1]):
            a, b = np.array(a), np.array(b)
            try:
                distance, t = np.linalg.solve(
                    np.column_stack((direction, a - b)), a - centre
                )
            except np.linalg.LinAlgError:
                continue
            if (
                distance >= 0
                and -0.00001 <= t <= 1.00001
                and (best is None or distance < best)
            ):
                best = distance
        if best is None:
            raise ValueError("No shawl section intersection")
        p = centre + direction * (best + 0.028)
        return np.array((p[0], y + 0.004, p[1]))

    rings = []
    for k in range(8):
        t = k / 7
        ring = []
        for j in range(48):
            angle = 2 * np.pi * j / 48
            cosine = np.cos(angle)
            top = float(fit.S[fit.Spart == "torso", 1].max()) + 0.004
            bottom = fit.Y(0.76) - (0.20 if cosine >= 0 else 0.25) * abs(cosine) ** 1.2
            y = top + (bottom - top) * t
            ring.append(section(y, np.array((np.sin(angle), cosine))))
        rings.append(ring)
    ids = shawl.grid(np.asarray(rings), onto.weights, closed=True, seam_col=24)
    shawl.orient(lambda p: p - np.array((0, p[1], fit.J["neck"][0][2])))
    ck.thicken(shawl, 0.0028, depth=0.035)
    result = [p for p in pieces if p.name not in ("shawl", "shawl_fringe")] + [shawl]
    fringe_old = next((p for p in pieces if p.name == "shawl_fringe"), None)
    if fringe_old:
        fringe = ck.Piece("shawl_fringe", fringe_old.cloth, scale=fringe_old.scale)
        bottom = np.asarray(rings[-1])
        bottom = np.vstack((bottom, bottom[0]))
        gw.fringe(fit, fringe, bottom, onto, length=0.035, lift=0.030, wfn=onto.weights)
        ck.thicken(fringe, 0.0012, depth=None, crease=0.9)
        result.append(fringe)
    return result
