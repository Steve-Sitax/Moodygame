"""The steps that turn a kind's garments into its near and far meshes (docs/people.md "How a kind is made").

After the garments are made (kinds_*.py with clothes_kit and cloth_detail) and subdivided:
1. relief(): folds, seams and bunching that change the silhouette, as geometry on the near copy;
2. delete_hidden(): faces of a garment that lie under another garment everywhere (a ray out meets the upper one, far
   enough from its open edge, and tilted rays meet it too) are deleted, so a reduced upper layer has nothing to show
   through it and costs nothing (the bodice under the shawl, the trousers' top under the smock);
3. cut_body() (clothes_kit): the skin under the garments, never the hands;
4. reduce(): all the garments together in one collapse, with the rims (hems, cuffs, the edges of brims and
   collars) and the UV seams protected, so a hem keeps its line and every island stays a disk;
5. fix_islands(): every UV island checked; a tube that lost its cut gets one (shortest path between its edges);
6. unwrap(): UVs after the reduction (angle based along the seams), one texel density for every face (insides and
   rims too), islands turned so the cloth's up is the picture's up, packed into the kind's clothes rectangle with
   square texels;
7. paint (dress.paint_clothes) at twice the rectangle's size, filtered down;
8. project_uvs(): the far copy's UVs from the near copy's islands (the two share one picture);
9. under_cloth(): the skin under a garment painted as the garment's shadowed lining, by the same ray test, with a
   soft edge (no cover rule by height: the ink-blot at the nape);
10. bake_occlusion(): ambient occlusion over body and clothes in vertex colour blue.
"""

import heapq
import math
import os

import numpy as np

from . import B, G
from . import weights as wt

# ---------------------------------------------------------------- helpers


def piece_of(raw):
    return [(p or "").removeprefix("in_") for p in raw]


def zones_of(ob):
    zg = {g.index: g.name[5:] for g in ob.vertex_groups if g.name.startswith("zone_")}
    out = []
    for v in ob.data.vertices:
        z, best = "", 0.5
        for g in v.groups:
            if g.group in zg and g.weight > best:
                z, best = zg[g.group], g.weight
        out.append(z)
    return out


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def edge_distance(ob, raw=None):
    """Per vertex, how far (along the cloth) it lies from its piece's visible edge: the boundary of the piece's
    outer faces (a hem, a cuff, a collar's edge; the rim and the inside lie beyond it). Inner vertices take 0."""
    me = ob.data
    raw = raw if raw is not None else wt.parts(ob)
    piece = piece_of(raw)
    co = np.array([v.co[:] for v in me.vertices])
    cnt = {}
    nb = {}
    for p in me.polygons:
        vs = list(p.vertices)
        a = piece[vs[0]]
        if not a or any(raw[v] != a for v in vs):
            continue
        for k in range(len(vs)):
            e = (min(vs[k], vs[(k + 1) % len(vs)]), max(vs[k], vs[(k + 1) % len(vs)]))
            cnt[e] = cnt.get(e, 0) + 1
            nb.setdefault(e[0], set()).add(e[1])
            nb.setdefault(e[1], set()).add(e[0])
    dist = np.full(len(co), np.inf)
    hq = []
    for (a, b), c in cnt.items():
        if c == 1:
            for v in (a, b):
                if dist[v] > 0:
                    dist[v] = 0.0
                    hq.append((0.0, v))
    heapq.heapify(hq)
    while hq:
        d, v = heapq.heappop(hq)
        if d > dist[v] or d > 0.5:
            continue
        for u in nb.get(v, ()):
            nd = d + float(np.linalg.norm(co[u] - co[v]))
            if nd < dist[u]:
                dist[u] = nd
                heapq.heappush(hq, (nd, u))
    for i, r in enumerate(raw):
        if r and r != piece[i]:
            dist[i] = 0.0
    return dist


def limbs(ob):
    """Per vertex the rigid group of its strongest bone (an arm, a leg, the trunk with the head): parts of different
    groups move apart, so one never hides or tucks the other."""
    from .rig import NAMES
    W = wt.read(ob)
    return [_limb(NAMES[int(i)]) for i in np.argmax(W, 1)]


def _outer_trees(ob, raw):
    """BVHs of every piece's outer faces (Blender space) and the faces' vertex lists."""
    from mathutils.bvhtree import BVHTree
    me = ob.data
    piece = piece_of(raw)
    vs = [tuple(v.co) for v in me.vertices]
    faces = {}
    for p in me.polygons:
        a = piece[p.vertices[0]]
        if a and all(raw[v] == a for v in p.vertices):
            faces.setdefault(a, []).append(tuple(p.vertices))
    return {a: (BVHTree.FromPolygons(vs, fs), fs) for a, fs in faces.items()}


def _frame(n):
    t = n.orthogonal().normalized()
    return t, n.cross(t)


# ---------------------------------------------------------------- 1. relief


def relief(ob, pieces, fit):
    """Folds, seams in relief and bunching that change the silhouette, as geometry on the near copy: each piece's
    `relief(ctx)` (cloth_detail) gives an offset in metres along the cloth's outward direction for its points;
    insides move with their outside, so the cloth keeps its thickness."""
    from . import clothes_kit as ck
    me = ob.data
    raw = wt.parts(ob)
    piece = piece_of(raw)
    zone = zones_of(ob)
    co = np.array([G(v.co) for v in me.vertices], np.float64)
    nrm = np.array([G(v.normal) for v in me.vertices], np.float64)
    inner = np.array([bool(r) and r != p for r, p in zip(raw, piece)])
    out = np.where(inner[:, None], -nrm, nrm)
    moved = 0
    for pc in pieces:
        fn = getattr(pc, "relief", None)
        if fn is None:
            continue
        idx = np.nonzero(np.array([p == pc.name for p in piece]))[0]
        if not len(idx):
            continue
        ctx = ck.Ctx(co[idx], out[idx], inner[idx], pc, fit, np.zeros((len(idx), 3), np.float32), np.zeros(len(idx)), 0)
        ctx.zone = np.array([zone[i] for i in idx], dtype=object)
        d = np.asarray(fn(ctx), np.float64)
        if d.ndim == 2:  # a displacement vector per point (hanging folds move across, not along a hem's normal)
            co[idx] += d
            moved += int((np.linalg.norm(d, axis=1) > 1e-5).sum())
        else:
            co[idx] += out[idx] * d[:, None]
            moved += int((np.abs(d) > 1e-5).sum())
    for i, v in enumerate(me.vertices):
        v.co = B(*co[i])
    me.update()
    return moved


# ---------------------------------------------------------------- 2. hidden layers


def delete_hidden(ob, margin=0.025, hang_margin=0.10, reach=0.035, keep=(), tilt=30.0):
    """Delete the faces of a garment that lie under another garment everywhere: from each vertex a ray out (the
    outside's normal; an inside's points out through its own outside) meets another piece's outer surface within
    `reach`, at least `margin` (`hang_margin` on hanging cloth, which swings off the legs) from that piece's visible
    edge, and four rays tilted `tilt` degrees meet some other piece too. A face goes when all its corners are hidden.
    keep: pieces never cut. Returns {piece: faces deleted}."""
    import bmesh
    me = ob.data
    raw = wt.parts(ob)
    piece = piece_of(raw)
    zone = zones_of(ob)
    dist = edge_distance(ob, raw)
    trees = _outer_trees(ob, raw)
    hidden = np.zeros(len(me.vertices), bool)
    limb = limbs(ob)
    ca, sa = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    for v in me.vertices:
        a = piece[v.index]
        if not a or a in keep:
            continue
        n = v.normal.copy()
        if raw[v.index] != a:
            n = -n
        o = v.co + n * 0.0004
        best = None
        for b, (tree, fs) in trees.items():
            if b == a:
                continue
            hit = tree.ray_cast(o, n, reach)
            if hit[0] is not None and (best is None or hit[3] < best[2]):
                best = (b, fs[hit[2]], hit[3])
        if best is None:
            continue
        fvs = best[1]
        # a sleeve beside a skirt is not under it: only cloth moving with the same limb hides
        if limb[fvs[0]] != limb[v.index]:
            continue
        d_edge = float(min(dist[f] for f in fvs))
        m = hang_margin if any(zone[f] == "skirt" for f in fvs) else margin
        if d_edge < m:
            continue
        t, bt = _frame(n)
        ok = True
        for k in range(4):
            ph = k * math.pi / 2
            dv = n * ca + (t * math.cos(ph) + bt * math.sin(ph)) * sa
            if not any(tree.ray_cast(o, dv, reach * 1.6)[0] is not None for b, (tree, _) in trees.items() if b != a):
                ok = False
                break
        hidden[v.index] = ok
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    gone = [f for f in bm.faces if all(hidden[v.index] for v in f.verts)]
    counts = {}
    for f in gone:
        a = piece[f.verts[0].index]
        counts[a] = counts.get(a, 0) + len(f.verts) - 2
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    return counts


# ---------------------------------------------------------------- 4. the reduction


def protect_weights(ob, seam=0.15, rim=0.0, small=None):
    """Per vertex how freely the collapse may take it (1 free, 0 kept): the rims (faces joining a piece's outside
    and its inside: hems, cuffs, the edges of brims and collars) and creased edges kept, the UV seams nearly kept
    (they may shorten along themselves, so every island keeps its cut). small: {piece: weight} for pieces kept
    more (buttons, a buckle)."""
    me = ob.data
    raw = wt.parts(ob)
    piece = piece_of(raw)
    w = np.ones(len(me.vertices))
    for p in me.polygons:
        vs = list(p.vertices)
        kinds = {raw[v] == piece[v] for v in vs}
        if len(kinds) > 1:
            w[vs] = np.minimum(w[vs], rim)
    ca = me.attributes.get("crease_edge")
    for e in me.edges:
        if e.use_seam:
            w[list(e.vertices)] = np.minimum(w[list(e.vertices)], seam)
        if ca is not None and ca.data[e.index].value > 0:
            w[list(e.vertices)] = np.minimum(w[list(e.vertices)], rim)
    if small:
        for i, a in enumerate(piece):
            if a in small:
                w[i] = min(w[i], small[a])
    return w


def reduce(ob, budget, symmetry=True, factor=1.0, weights=None):
    """Collapse the garments of one copy to `budget` triangles in one pass (every piece together: the collapse
    spends the triangles where the cloth curves: folds, collars, caps, clogs), the protected vertices (weights:
    protect_weights) last. UVs are made afterwards (unwrap)."""
    import bpy
    count = tris(ob)
    if count <= budget:
        return count
    if budget <= 0:
        raise ValueError("no clothing budget left: %s" % ob.name)
    w = protect_weights(ob) if weights is None else weights
    vg = ob.vertex_groups.get("_reduce") or ob.vertex_groups.new(name="_reduce")
    for i, x in enumerate(w):
        vg.add([i], float(x), "REPLACE")
    bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new("cloth_budget", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = budget / count
    m.use_collapse_triangulate = True
    m.use_symmetry = symmetry
    m.symmetry_axis = "X"
    m.vertex_group = "_reduce"
    m.vertex_group_factor = factor
    bpy.ops.object.modifier_apply(modifier=m.name)
    ob.vertex_groups.remove(ob.vertex_groups["_reduce"])
    n = tris(ob)
    if n > budget:  # a piece that would not collapse further: one more even pass
        m = ob.modifiers.new("cloth_budget", "DECIMATE")
        m.ratio = budget / n
        m.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=m.name)
        n = tris(ob)
    return n


def tuck(ob, body, order, covers, clearance=0.004, body_clearance=0.005, reach=0.035, agree=0.6):
    """After the reduction, whatever lies under a garment is pulled under it, however far it pokes out: each point of
    the body (the parts its cover rule hides, never the head or the hands) and of a lower layer (layer_order) whose
    nearest point on the upper surface (outer faces only) lies within `reach` and faces the same way (normals agree
    by `agree`) is put `clearance` under that surface, with all its shape keys. The ray test of clear_layers misses
    a point that pokes out further than the ray's start (a shoulder's top through a reduced smock). Returns how many
    points moved."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    raw = wt.parts(ob)
    piece = piece_of(raw)
    me = ob.data
    vs = [v.co.copy() for v in me.vertices]
    outer = {}
    for p in me.polygons:
        a = piece[p.vertices[0]]
        if a and all(raw[v] == a for v in p.vertices):
            outer.setdefault(a, []).append(tuple(p.vertices))
    trees = {a: BVHTree.FromPolygons(vs, fs) for a, fs in outer.items()}
    every = BVHTree.FromPolygons(vs, [f for fs in outer.values() for f in fs])
    moved = 0

    def shift(target, i, d):
        m = target.data
        m.vertices[i].co = m.vertices[i].co + d
        if m.shape_keys:
            for kb in m.shape_keys.key_blocks:
                kb.data[i].co = kb.data[i].co + d

    def pull(target, i, tree, cl):
        v = target.data.vertices[i]
        loc, n, _, dist = tree.find_nearest(v.co, reach)
        if loc is None or n.dot(v.normal) < agree:
            return 0
        h = (v.co - loc).dot(n)  # height over the upper surface (negative: under it)
        if h > -cl:
            shift(target, i, n * (-cl - h))
            return 1
        return 0
    if body is not None:
        bparts = wt.parts(body)
        bme = body.data
        hand = np.zeros(len(bme.vertices), bool)
        isl = bme.attributes.get("mh_island")
        if isl is not None:
            fi = np.zeros(len(bme.polygons), np.int32)
            isl.data.foreach_get("value", fi)
            for p in bme.polygons:
                if fi[p.index] in (1, 2):
                    hand[list(p.vertices)] = True
        for i, v in enumerate(bme.vertices):
            p = bparts[i] or ""
            if hand[i] or p.startswith(("head", "eye", "hair", "finger")):
                continue
            if not covers(np.array(G(v.co)), p):
                continue
            moved += pull(body, i, every, body_clearance)
        bme.update()
    limb = limbs(ob)
    vgrp = np.array(limb)
    for (u, o) in sorted(order):
        if o not in trees:
            continue
        ogrp = {vgrp[f[0]] for f in outer[o]}
        for i in range(len(me.vertices)):
            if piece[i] == u and limb[i] in ogrp:
                moved += pull(ob, i, trees[o], clearance)
    me.update()
    return moved


# ---------------------------------------------------------------- 5. islands


def fix_islands(ob, log=None, passes=12):
    """Every UV island must be a disk (one edge loop round it) for the angle-based unwrap. Edges shared by more than
    two faces are cut first; then, split along the seams, each island's Euler characteristic and edge loops are
    counted: a tube (two loops) is cut along the shortest path between them, a closed shape along a path across
    it, a disk with holes from its rim to each hole. Returns how many cuts were made."""
    import bmesh
    me = ob.data
    cuts = 0
    for e in me.edges:
        pass
    bm = bmesh.new()
    bm.from_mesh(me)
    nm = [e.index for e in bm.edges if len(e.link_faces) > 2]
    bm.free()
    for i in nm:
        me.edges[i].use_seam = True
    cuts += len(nm)
    for _ in range(passes):
        bm = bmesh.new()
        bm.from_mesh(me)
        oe = bm.edges.layers.int.new("_oe")
        for e in bm.edges:
            e[oe] = e.index
        bmesh.ops.split_edges(bm, edges=[e for e in bm.edges if e.seam])
        bm.faces.ensure_lookup_table()
        comp = {}
        groups = []
        for f in bm.faces:
            if f.index in comp:
                continue
            stack = [f]
            comp[f.index] = len(groups)
            members = [f]
            while stack:
                g = stack.pop()
                for e in g.edges:
                    for h in e.link_faces:
                        if h.index not in comp:
                            comp[h.index] = len(groups)
                            stack.append(h)
                            members.append(h)
            groups.append(members)
        new_cuts = []
        for faces in groups:
            verts = {v for f in faces for v in f.verts}
            edges = {e for f in faces for e in f.edges}
            if len(verts) - len(edges) + len(faces) == 1:
                continue
            bnd = [e for e in edges if len(e.link_faces) == 1]
            bv = {}
            for e in bnd:
                for v in e.verts:
                    bv.setdefault(v, []).append(e)
            loops, seen = [], set()
            for v0 in bv:
                if v0 in seen:
                    continue
                stack, lp = [v0], set()
                while stack:
                    v = stack.pop()
                    if v in lp:
                        continue
                    lp.add(v)
                    for e in bv[v]:
                        stack.append(e.other_vert(v))
                seen |= lp
                loops.append(lp)
            nb = {}
            for e in edges:
                if len(e.link_faces) != 2:
                    continue
                a, b = e.verts
                L = (a.co - b.co).length
                nb.setdefault(a, []).append((b, L, e))
                nb.setdefault(b, []).append((a, L, e))
            if len(loops) >= 2:
                src, dst = loops[0], set().union(*loops[1:])
            elif len(loops) == 1:
                src = loops[0]
                far = max(verts, key=lambda v: min((v.co - s_.co).length for s_ in src))
                dst = {far}
            else:
                vs = list(verts)
                far = max(vs, key=lambda v: (v.co - vs[0].co).length)
                src, dst = {vs[0]}, {far}
            dist = {v: 0.0 for v in src}
            prev = {}
            hq = [(0.0, k, v) for k, v in enumerate(src)]
            heapq.heapify(hq)
            cnt = len(hq)
            end = None
            while hq:
                d, _, v = heapq.heappop(hq)
                if d > dist.get(v, 1e18):
                    continue
                if v in dst and v not in src:
                    end = v
                    break
                for u, L, e in nb.get(v, ()):
                    nd = d + L
                    if nd < dist.get(u, 1e18):
                        dist[u] = nd
                        prev[u] = (v, e)
                        cnt += 1
                        heapq.heappush(hq, (nd, cnt, u))
            if end is None:
                continue
            v = end
            while v in prev:
                v, e = prev[v]
                new_cuts.append(e[oe])
        bm.free()
        if not new_cuts:
            break
        for ei in new_cuts:
            me.edges[ei].use_seam = True
        cuts += len(new_cuts)
    return cuts


def island_census(ob):
    """(islands, of which not disks, edges shared by more than two faces): the seams' state, for the build log."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    nm = sum(1 for e in bm.edges if len(e.link_faces) > 2)
    bmesh.ops.split_edges(bm, edges=[e for e in bm.edges if e.seam])
    bm.faces.ensure_lookup_table()
    seen = set()
    n = bad = 0
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, faces = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            faces.append(g)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        verts = {v for g in faces for v in g.verts}
        edges = {e for g in faces for e in g.edges}
        n += 1
        bad += (len(verts) - len(edges) + len(faces)) != 1
    bm.free()
    return n, bad, nm


# ---------------------------------------------------------------- 6. UVs after the reduction


def _island_faces(me):
    seam = {tuple(sorted(e.vertices)) for e in me.edges if e.use_seam}
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    ef = {}
    for p in me.polygons:
        vs = list(p.vertices)
        for i in range(len(vs)):
            k = tuple(sorted((vs[i], vs[(i + 1) % len(vs)])))
            if k not in seam:
                ef.setdefault(k, []).append(p.index)
    for fs in ef.values():
        for f in fs[1:]:
            ra, rb = find(fs[0]), find(f)
            if ra != rb:
                parent[rb] = ra
    islands = {}
    for p in me.polygons:
        islands.setdefault(find(p.index), []).append(p.index)
    return list(islands.values())


def _uv_islands(me, uv, tol=1e-6):
    """Faces joined where they share an edge with the same UVs on both sides (the picture's own islands)."""
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    edge = {}
    for p in me.polygons:
        li = list(p.loop_indices)
        vs = list(p.vertices)
        for k in range(len(vs)):
            a, b = vs[k], vs[(k + 1) % len(vs)]
            ua, ub = uv[li[k]], uv[li[(k + 1) % len(vs)]]
            if a > b:
                a, b, ua, ub = b, a, ub, ua
            edge.setdefault((a, b), []).append((p.index, ua, ub))
    for lst in edge.values():
        if len(lst) != 2:
            continue
        (f1, a1, b1), (f2, a2, b2) = lst
        if np.abs(a1 - a2).max() < tol and np.abs(b1 - b2).max() < tol:
            r1, r2 = find(f1), find(f2)
            if r1 != r2:
                parent[r2] = r1
    out = {}
    for p in me.polygons:
        out.setdefault(find(p.index), []).append(p.index)
    return list(out.values())


def _skyline(boxes, W):
    """Bottom-left skyline packing of boxes (w, h) into a strip W wide (each may turn 90 degrees). Returns
    positions [(x, y, turned)] and the height used, or None where a box is wider than W."""
    sky = [(0.0, W, 0.0)]  # segments (x, width, y)
    out = [None] * len(boxes)
    order = sorted(range(len(boxes)), key=lambda i: -max(boxes[i]))
    top = 0.0
    for i in order:
        w0, h0 = boxes[i]
        best = None
        for turned, (w, h) in ((False, (w0, h0)), (True, (h0, w0))):
            if w > W + 1e-9:
                continue
            for s in range(len(sky)):
                x = sky[s][0]
                if x + w > W + 1e-9:
                    break
                # the height the box would rest at over the segments it spans
                y, span, k = 0.0, 0.0, s
                while span < w - 1e-12 and k < len(sky):
                    y = max(y, sky[k][2])
                    span += sky[k][1]
                    k += 1
                if span < w - 1e-12:
                    continue
                key = (y + h, y, x)
                if best is None or key < best[0]:
                    best = (key, s, x, y, w, h, turned)
        if best is None:
            return None, None
        _, s, x, y, w, h, turned = best
        out[i] = (x, y, turned)
        top = max(top, y + h)
        # raise the skyline under the box
        new = []
        for (sx, sw, sy) in sky:
            a, b = sx, sx + sw
            if b <= x + 1e-12 or a >= x + w - 1e-12:
                new.append((sx, sw, sy))
                continue
            if a < x:
                new.append((a, x - a, sy))
            if b > x + w:
                new.append((x + w, b - (x + w), sy))
        new.append((x, w, y + h))
        new.sort()
        merged = []
        for seg in new:
            if merged and abs(merged[-1][2] - seg[2]) < 1e-12 and abs(merged[-1][0] + merged[-1][1] - seg[0]) < 1e-9:
                merged[-1] = (merged[-1][0], merged[-1][1] + seg[1], merged[-1][2])
            else:
                merged.append(seg)
        sky = merged
    return out, top


def unwrap(ob, rect, scales=None, pad_px=5, log=None):
    """UVs for the reduced garments, straight into the layer's clothes rectangle (rect = x, y, w, h in pixels of the
    1024 px layer): Blender's angle-based unwrap along the seams; every island scaled to one texel density (times
    its piece's factor in scales: part name -> factor; insides and rims at their cloth's own density), turned so the
    cloth's up (game y) is the picture's up where it has one (else its smallest box), packed bottom-left by a skyline
    with `pad_px` pixels between islands, into the rectangle with square texels. Returns the texel density
    (pixels per metre of cloth) and the share of the rectangle covered."""
    import bpy
    from . import pictures as at
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    me = ob.data
    if "UVMap" not in me.uv_layers:
        me.uv_layers.new(name="UVMap")
    me.uv_layers.active = me.uv_layers["UVMap"]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.001, iterations=12)
    bpy.ops.object.mode_set(mode="OBJECT")
    uvd = me.uv_layers["UVMap"].data
    co = np.array([v.co[:] for v in me.vertices])
    raw = [p or "" for p in wt.parts(ob)]
    polys = me.polygons

    def read():
        d = me.uv_layers["UVMap"].data
        u = np.zeros(len(d) * 2)
        d.foreach_get("uv", u)
        return u.reshape(-1, 2)

    def is_bad(fids, uv):
        q = uv[[li for f in fids for li in polys[f].loop_indices]]
        sg = []
        for f in fids:
            t = uv[list(polys[f].loop_indices)]
            sg.append(np.dot(t[:, 0], np.roll(t[:, 1], -1)) - np.dot(t[:, 1], np.roll(t[:, 0], -1)))
        sg = np.array(sg)
        a2 = 0.5 * np.abs(sg).sum()
        if (not np.isfinite(q).all()) or a2 < 1e-12:
            return True
        flipped = min((sg > 0).sum(), (sg < 0).sum())
        ext = q.max(0) - q.min(0)
        # an island that did not lie flat: faces turned over, a far-flung spike, or one much bigger in the picture
        # than on the cloth against the rest (stretched)
        bad = ext.max() > 50 * math.sqrt(a2) or flipped > max(1, 0.02 * len(sg))
        if bad and os.environ.get("PEOPLE2_DEBUG_UV"):
            print("[uv] bad island %s faces %d flipped %d ext %.4f sqrt(a2) %.4f" % (
                raw[polys[fids[0]].vertices[0]], len(fids), flipped, ext.max(), math.sqrt(a2)))
        return bad
    uv = read()
    bad_n = 0
    # an island that will not lie flat is halved across its longest axis and unwrapped again (three times at most)
    for attempt in range(3):
        bad = [fids for fids in _island_faces(me) if is_bad(fids, uv)]
        if not bad:
            break
        sel = set()
        for fids in bad:
            P = np.array([polys[f].center[:] for f in fids])
            c = P.mean(0)
            _, _, vt = np.linalg.svd(P - c, full_matrices=False)
            side = {f: float(np.dot(np.array(polys[f].center[:]) - c, vt[0])) > 0 for f in fids}
            fset = set(fids)
            ek_index = {tuple(sorted(e.vertices)): e.index for e in me.edges}
            ef = {}
            for f in fids:
                for ek in polys[f].edge_keys:
                    ef.setdefault(ek, []).append(f)
            for ek, fs in ef.items():
                if len(fs) == 2 and side[fs[0]] != side[fs[1]]:
                    me.edges[ek_index[ek]].use_seam = True
            sel |= fset
        for p in polys:
            p.select = p.index in sel
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.001, iterations=12)
        bpy.ops.object.mode_set(mode="OBJECT")
        uv = read()
    bad_faces = [f for fids in _island_faces(me) if is_bad(fids, uv) for f in fids]
    if bad_faces:
        # those islands again by Blender's smart projection (planar charts split by angle: never turned over)
        bad_set = set(bad_faces)
        for p in polys:
            p.select = p.index in bad_set
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(50), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=False, scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        bad_n = len(bad_set)
    uv = read()
    # the islands as the picture has them (faces joined where they share an edge with the same UVs), marked as seams
    islands = _uv_islands(me, uv)
    isl_of = {}
    for k, fids in enumerate(islands):
        for f in fids:
            isl_of[f] = k
    ef = {}
    for p in polys:
        for ek in p.edge_keys:
            ef.setdefault(ek, []).append(p.index)
    ek_index = {tuple(sorted(e.vertices)): e.index for e in me.edges}
    for ek, fs in ef.items():
        if len(fs) == 2 and isl_of[fs[0]] != isl_of[fs[1]]:
            me.edges[ek_index[ek]].use_seam = True
    items = []
    for fids in islands:
        loops = np.array([li for f in fids for li in polys[f].loop_indices])
        lv = np.array([me.loops[li].vertex_index for li in loops])
        a3 = sum(polys[f].area for f in fids)
        q = uv[loops].copy()
        a2 = 0.0
        for f in fids:
            t = uv[list(polys[f].loop_indices)]
            a2 += 0.5 * abs(np.dot(t[:, 0], np.roll(t[:, 1], -1)) - np.dot(t[:, 1], np.roll(t[:, 0], -1)))
        if a2 < 1e-14 or a3 < 1e-12:
            P = co[lv]
            c = P.mean(0)
            _, _, vt = np.linalg.svd(P - c, full_matrices=False)
            q = (P - c) @ vt[:2].T
            a2 = max(a3, 1e-9)
        parts = [raw[v] for f in fids for v in polys[f].vertices]
        part = next((x for x in parts if x.startswith("in_")), parts[0])
        k = (scales or {}).get(part, 1.0)
        if scales and "__island__" in scales:  # a kind's own factor per island (kinds_player: the sleeves)
            k *= scales["__island__"](lv)
        q = q * math.sqrt(a3 / max(a2, 1e-12)) * k  # metres (times the piece's factor)
        # turn the island so the cloth's up (Blender z) runs up the picture: the least-squares gradient of height
        # over the island's UVs
        A = np.c_[q - q.mean(0), np.ones(len(q))]
        gz = np.linalg.lstsq(A, co[lv][:, 2], rcond=None)[0][:2]
        if np.linalg.norm(gz) > 0.35:
            ang = math.atan2(gz[0], gz[1])  # turn by +ang: the gradient to +v
            R = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
            q = q @ R.T
        else:
            best = None
            for deg in range(0, 90, 3):
                r = math.radians(deg)
                R = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
                qq = q @ R.T
                e = qq.max(0) - qq.min(0)
                if best is None or e[0] * e[1] < best[0]:
                    best = (e[0] * e[1], qq)
            q = best[1]
        q = q - q.min(0)
        items.append((loops, q))
    x0, y0, W, H = rect
    # the density: as large as packs into the rectangle
    lo, hi = 50.0, 4000.0
    sizes = [q.max(0) for _, q in items]
    best = None
    for _ in range(22):
        s = math.sqrt(lo * hi)
        boxes = [(sz[0] * s + pad_px, sz[1] * s + pad_px) for sz in sizes]
        pos, top = _skyline(boxes, W)
        if pos is not None and top <= H:
            best = (s, pos, top)
            lo = s
        else:
            hi = s
    s, pos, top = best
    covered = 0.0
    for (loops, q), (x, y, turned) in zip(items, pos):
        qq = q * s
        if turned:
            qq = np.stack([qq[:, 1], qq[:, 0]], -1)
            qq[:, 0] = qq[:, 0].max() - qq[:, 0]  # a turn, not a mirror
        qq = qq + (x + pad_px / 2, y + pad_px / 2)
        uv[loops] = (qq + (x0, y0)) / at.SIZE
        covered += float(np.prod(qq.max(0) - qq.min(0)))
    me.uv_layers["UVMap"].data.foreach_set("uv", uv.ravel())
    me.update()
    if log:
        log("[people2]   unwrap: %d islands (%d projected), %.0f px per metre, %.0f%% of the rectangle's boxes" % (
            len(items), bad_n, s, 100 * covered / (W * H)))
    return s, covered / (W * H)


def stretch(ob):
    """Share of triangles whose picture is stretched more than 2:1 one way against the other (the singular values
    of the UV-to-surface map), and the worst ratio."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv["UVMap"]
    bad, n, worst = 0, 0, 1.0
    for f in bm.faces:
        p = [l.vert.co for l in f.loops]
        t = [l[uvl].uv for l in f.loops]
        e1, e2 = p[1] - p[0], p[2] - p[0]
        d1, d2 = t[1] - t[0], t[2] - t[0]
        det = d1.x * d2.y - d2.x * d1.y
        if abs(det) < 1e-14 or e1.cross(e2).length < 1e-12:
            continue
        # the Jacobian columns: dP/du, dP/dv
        Ju = (e1 * d2.y - e2 * d1.y) / det
        Jv = (e2 * d1.x - e1 * d2.x) / det
        M = np.array([[Ju.dot(Ju), Ju.dot(Jv)], [Ju.dot(Jv), Jv.dot(Jv)]])
        ev = np.linalg.eigvalsh(M)
        r = math.sqrt(max(ev[1], 1e-30) / max(ev[0], 1e-30))
        n += 1
        worst = max(worst, r)
        if r > 2.0:
            bad += 1
    bm.free()
    return bad / max(n, 1), worst


# ---------------------------------------------------------------- 7. the picture: a position map at any size


def position_map(ob, W, H, part_of, extra=()):
    """Rasterise the mesh in UV space over a W x H picture (u across W, v up H). Returns pos (H, W, 3) game space,
    nrm, a part index map (-1 where nothing is drawn), the part names and {name: (H, W, 2)} of the `extra` UV
    layers (the cloth's own coordinates, the distance to the edge) interpolated across each triangle."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uvl = bm.loops.layers.uv["UVMap"]
    xl = {n: bm.loops.layers.uv[n] for n in extra if n in bm.loops.layers.uv}
    names = sorted({p for p in part_of if p})
    pid = {n: i for i, n in enumerate(names)}
    pos = np.zeros((H, W, 3), np.float32)
    nrm = np.zeros((H, W, 3), np.float32)
    part = -np.ones((H, W), np.int32)
    xv = {n: np.zeros((H, W, 2), np.float32) for n in xl}
    for f in bm.faces:
        uv = np.array([l[uvl].uv[:] for l in f.loops]) * (W, H) - 0.5
        P = np.array([(v.co.x, v.co.z, -v.co.y) for v in f.verts])
        Nn = np.array([(v.normal.x, v.normal.z, -v.normal.y) for v in f.verts])
        x0, y0 = np.floor(uv.min(axis=0)).astype(int)
        x1, y1 = np.ceil(uv.max(axis=0)).astype(int)
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        xs, ys = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
        a, b, c = uv
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        l0 = ((b[1] - c[1]) * (xs - c[0]) + (c[0] - b[0]) * (ys - c[1])) / den
        l1 = ((c[1] - a[1]) * (xs - c[0]) + (a[0] - c[0]) * (ys - c[1])) / den
        l2 = 1 - l0 - l1
        m = (l0 >= -0.03) & (l1 >= -0.03) & (l2 >= -0.03)
        if not m.any():
            continue
        L = np.stack([l0[m], l1[m], l2[m]], axis=1)
        yy, xx = ys[m], xs[m]
        pos[yy, xx] = L @ P
        nn = L @ Nn
        nrm[yy, xx] = nn / np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
        vp = part_of[f.verts[0].index]
        part[yy, xx] = pid.get(vp, -1) if vp else -1
        for n, lay in xl.items():
            xv[n][yy, xx] = L @ np.array([l[lay].uv[:] for l in f.loops])
    bm.free()
    return pos, nrm, part, names, xv


def edge_layer(ob):
    """The distance of every point from its piece's visible edge (edge_distance), into a UV layer `_edge` (u) for
    the painter (ctx.edge: hems, cuffs, the edges of collars and brims worn and stitched)."""
    me = ob.data
    d = edge_distance(ob)
    d = np.where(np.isfinite(d), d, 1.0).astype(np.float32)
    lay = me.uv_layers.get("_edge") or me.uv_layers.new(name="_edge")
    lv = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    uv = np.zeros((len(lv), 2), np.float32)
    uv[:, 0] = d[lv]
    lay.data.foreach_set("uv", uv.ravel())
    me.uv_layers.active = me.uv_layers["UVMap"]


def drop_layers(ob, names=("fabric", "_edge")):
    me = ob.data
    for n in names:
        if n in me.uv_layers:
            me.uv_layers.remove(me.uv_layers[n])
    me.uv_layers.active = me.uv_layers["UVMap"]


def down2(a):
    """Halve a picture (box filter)."""
    h, w = a.shape[:2]
    a = a[:h // 2 * 2, :w // 2 * 2]
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


# ---------------------------------------------------------------- 8. the far copy's UVs


def project_uvs(far, near):
    """The far copy shares the near copy's picture: each far face takes the island of the near face nearest its
    middle (of the same piece and side), and each of its corners the UV of the nearest point of that island."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    mn, mf = near.data, far.data
    nraw = [p or "" for p in wt.parts(near)]
    fraw = [p or "" for p in wt.parts(far)]
    nuv = mn.uv_layers["UVMap"].data
    islands = _island_faces(mn)
    isl_of = np.zeros(len(mn.polygons), np.int64)
    for k, fs in enumerate(islands):
        isl_of[fs] = k
    nco = [v.co.copy() for v in mn.vertices]
    # faces by part (the piece's outside or inside), and by island
    by_part, by_isl = {}, {}
    for p in mn.polygons:
        by_part.setdefault(nraw[p.vertices[0]], []).append(p.index)
        by_isl.setdefault(int(isl_of[p.index]), []).append(p.index)
    # triangulated faces (loop triples) for barycentric lookups
    def tri_list(fids):
        out = []
        for f in fids:
            li = list(mn.polygons[f].loop_indices)
            for k in range(1, len(li) - 1):
                out.append((li[0], li[k], li[k + 1]))
        return out
    part_tree = {}
    for pn, fids in by_part.items():
        tl = tri_list(fids)
        part_tree[pn] = (BVHTree.FromPolygons(nco, [tuple(mn.loops[l].vertex_index for l in t) for t in tl]), tl)
    isl_tree = {}

    def itree(k):
        if k not in isl_tree:
            tl = tri_list(by_isl[k])
            isl_tree[k] = (BVHTree.FromPolygons(nco, [tuple(mn.loops[l].vertex_index for l in t) for t in tl]), tl)
        return isl_tree[k]

    def uv_at(tree_tl, q):
        tree, tl = tree_tl
        loc, _, fi, _ = tree.find_nearest(q)
        t = tl[fi]
        a, b, c = (nco[mn.loops[l].vertex_index] for l in t)
        # barycentric of loc in (a, b, c)
        v0, v1, v2 = b - a, c - a, loc - a
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        d20, d21 = v2.dot(v0), v2.dot(v1)
        den = d00 * d11 - d01 * d01
        if abs(den) < 1e-18:
            w1 = w2 = 0.0
        else:
            w1 = (d11 * d20 - d01 * d21) / den
            w2 = (d00 * d21 - d01 * d20) / den
        w0 = 1 - w1 - w2
        ua, ub, uc = (np.array(nuv[l].uv[:]) for l in t)
        return ua * w0 + ub * w1 + uc * w2, fi

    loop_face = np.zeros(len(mn.loops), np.int64)
    for p in mn.polygons:
        loop_face[p.loop_start:p.loop_start + p.loop_total] = p.index
    if "UVMap" not in mf.uv_layers:
        mf.uv_layers.new(name="UVMap")
    fuv = mf.uv_layers["UVMap"].data
    out = np.zeros((len(fuv), 2))
    fco = [v.co for v in mf.vertices]
    for p in mf.polygons:
        pn = fraw[p.vertices[0]]
        if pn not in part_tree:
            pn = pn.removeprefix("in_") if pn.removeprefix("in_") in part_tree else next(iter(part_tree))
        c = Vector((0, 0, 0))
        for v in p.vertices:
            c += fco[v]
        c /= len(p.vertices)
        _, fi = uv_at(part_tree[pn], c)
        k = int(isl_of[loop_face[part_tree[pn][1][fi][0]]])
        tr = itree(k)
        for li, v in zip(p.loop_indices, p.vertices):
            out[li], _ = uv_at(tr, fco[v])
    fuv.foreach_set("uv", out.ravel())
    mf.update()


# ---------------------------------------------------------------- 9. the skin under the cloth


def garment_tree(ob):
    """A BVH of the garments in game space, and per face its piece."""
    from mathutils.bvhtree import BVHTree
    raw = wt.parts(ob)
    piece = piece_of(raw)
    vs = [tuple(G(v.co)) for v in ob.data.vertices]
    fs = [tuple(p.vertices) for p in ob.data.polygons]
    return BVHTree.FromPolygons(vs, fs), [piece[f[0]] for f in fs]


def under_cloth(ctx, tree, face_piece, looks, covers=None, reach=None, tilt=28.0,
                skip=("head", "eye", "hair", "finger")):
    """The body's skin under a garment, painted as that garment's lining in its own shadow: from each texel a ray
    out along the skin's normal and four tilted ones; where they meet the garments (within `reach` metres by part)
    the texel takes the colour of the piece the straight ray met, with a soft edge (the share of rays that met
    cloth). So a neckline shows skin wherever the skin is in sight, and the cloth's colour only under the cloth;
    pokes of skin through cloth (a slider's broad shoulders) show cloth. looks: {piece: Cloth}. covers: the kind's
    cover rule, a gate (the hands, which no rule covers, beside a smock are never painted)."""
    from mathutils import Vector
    reach = reach or {"neck": 0.07, "arm": 0.07, "torso": 0.25, "leg": 0.30}
    ca, sa = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
    n_ = len(ctx.pos)
    cov = np.zeros(n_, np.float32)
    col = np.zeros((n_, 3), np.float32)
    parts = np.asarray(ctx.part).astype(str)
    for i in range(n_):
        p = parts[i]
        if p.startswith(skip):
            continue
        r = next((v for k, v in reach.items() if p.startswith(k)), None)
        if r is None or (covers is not None and not covers(ctx.pos[i], p)):
            continue
        n = Vector(ctx.nrm[i])
        if n.length < 0.5:
            continue
        n.normalize()
        o = Vector(ctx.pos[i]) + n * 0.0005
        hit = tree.ray_cast(o, n, r)
        if hit[0] is None:
            continue
        look = looks.get(face_piece[hit[2]])
        c = 0.4
        t = n.orthogonal().normalized()
        bt = n.cross(t)
        for k in range(4):
            ph = k * math.pi / 2
            if tree.ray_cast(o, n * ca + (t * math.cos(ph) + bt * math.sin(ph)) * sa, r * 1.4)[0] is not None:
                c += 0.15
        cov[i] = c
        if look is not None:
            col[i] = look.lining * 0.62
    m = np.clip((cov - 0.5) / 0.25, 0, 1)
    m = m * m * (3 - 2 * m)
    ctx.rgb[:] = ctx.rgb * (1 - m[:, None]) + col * m[:, None]
    ctx.h[:] = ctx.h * (1 - m)
    if hasattr(ctx, "detail_zone"):
        ctx.detail_zone[m > 0.5] = 1
    return m


# ---------------------------------------------------------------- 10. baked occlusion


def _limb(name):
    """The rigid group a bone belongs to for the occlusion: an arm, a leg, or the trunk (with the head)."""
    for S in "LR":
        if name.endswith(S) and name.startswith(("armUp", "armLow", "armTwist", "hand", "thumb", "index", "middle",
                                                 "ring", "little")):
            return "arm" + S
        if name.endswith(S) and name.startswith(("legUp", "legLow", "foot", "toe")):
            return "leg" + S
    return "trunk"


def occlusion(ob, P, reach=0.10, rays=40, through=False):
    """Ambient occlusion per vertex at rest (Blender space; game up is z), by cosine-weighted rays over each
    vertex's hemisphere up to `reach`: the crevices every pose keeps (under a collar, a cap's peak over the brow, a
    shawl's edge, between garments, the armpit). Hits between parts that move on their own are not counted (an arm
    against the trunk below the armpit, a leg against the other below the crotch, a hand against the thigh), so the
    rest pose does not bake its own closeness. Returns occlusion 0 (open) .. 1 (closed)."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    from . import body as bd
    from . import paint
    from .rig import NAMES
    me = ob.data
    W = wt.read(ob)
    grp = [_limb(NAMES[int(i)]) for i in np.argmax(W, 1)]
    co = [v.co.copy() for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    tree = BVHTree.FromPolygons(co, polys)
    pgrp = [grp[p[0]] for p in polys]
    dirs = paint._ao_dirs(rays)
    y_pit = bd.Y(P, 0.735)
    y_crotch = bd.Y(P, 0.44)
    occ = np.zeros(len(co), np.float32)
    wsum = float(np.sum(dirs[:, 2]))
    for i, v in enumerate(me.vertices):
        n = v.normal
        t = n.orthogonal().normalized()
        bt = n.cross(t)
        o = co[i] + n * 0.0012
        a = grp[i]
        acc = 0.0
        for d in dirs:
            dv = t * float(d[0]) + bt * float(d[1]) + n * float(d[2])
            start, travelled = o, 0.0
            for _ in range(4 if through else 1):
                hit, _, fi, dist = tree.ray_cast(start, dv, reach - travelled)
                if hit is None:
                    break
                dist += travelled
                b = pgrp[fi]
                skip = False
                if a != b:
                    if "trunk" in (a, b):
                        limb = a if b == "trunk" else b
                        lo = y_pit if limb.startswith("arm") else y_crotch
                        skip = co[i].z < lo or hit.z < lo
                    else:
                        skip = True
                if not skip:
                    acc += (1.0 - (dist / reach) ** 2) * float(d[2])
                    break
                # through: a limb resting against the cloth at rest does not leave its shape in the bake (the ray
                # goes on past it to what lies behind)
                start, travelled = hit + dv * 0.0005, dist + 0.0005
        occ[i] = acc / wsum
    return np.clip(occ, 0.0, 1.0)


AO_RULE = ("picture_flags blue = ambient light reaching the point at rest, 1 open .. 0.22 closed (the render "
           "lane's rule, export.bake_occlusion): 1 - 0.85 x occlusion (clothes_build.occlusion: 40 cosine-weighted "
           "rays per vertex over 10 cm, parts moving on their own not counted); the shader multiplies the ambient "
           "and indirect light by it, never the lamps or the albedo")


def bake_occlusion(ob, P, strength=0.85, reach=0.10, through=False):
    """Write 1 - strength x occlusion into vertex colour blue (picture_flags, every corner of the vertex)."""
    occ = occlusion(ob, P, reach=reach, through=through)
    vis = np.maximum(0.22, 1.0 - strength * occ)
    me = ob.data
    attr = me.color_attributes.get("picture_flags")
    if attr is None:
        attr = me.color_attributes.new(name="picture_flags", type="FLOAT_COLOR", domain="CORNER")
        rgba = np.zeros((len(me.loops), 4), np.float32)
        rgba[:, 3] = 1
        attr.data.foreach_set("color", rgba.ravel())
    rgba = np.zeros(len(me.loops) * 4, np.float32)
    attr.data.foreach_get("color", rgba)
    rgba = rgba.reshape(-1, 4)
    lv = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    rgba[:, 2] = vis[lv]
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr
    me.update()
    ob["people2_occlusion_baked"] = True  # export's own bake (render lane) leaves it
    return float(occ.mean()), float(occ.max())
