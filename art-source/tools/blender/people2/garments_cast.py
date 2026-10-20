"""Cast clothing cuts. Geometry is fitted before painting; all cut edges have cloth facings.

Reuse the first-pass tailored blocks, without modifying their shared Cloth instances.
The local additions are knitted caps, felt hats, the oilskin brim and child breeches.
"""
import copy
import math

import numpy as np

from . import body as bd, clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from .kinds_cast import sooi_dress
from .kinds_women import fishwife_a_dress


def cloth(colour, material="wool", **kw):
    return Cloth(hexrgb(colour), material, **kw)


def recolour(pc, colour, **kw):
    pc.cloth = copy.copy(pc.cloth)
    pc.cloth.rgb = np.array(hexrgb(colour), np.float32)
    pc.cloth.lining = pc.cloth.rgb * 0.75
    for key, value in kw.items():
        setattr(pc.cloth, key, value)


def seams(ctx):
    """Panel seams, neck placket, cuffs, and worn elbows on a closed working top."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    arm = ctx.zone == "arm"
    ck.seam_line(ctx, np.where(~arm & (ctx.z > 0), np.abs(ctx.x) - 0.014, 1.0), stitches=False)
    for k in range(3):
        ck.button(ctx, ctx.fit.snap((0, Y(0.79) - k * 0.032, 0.12), 0.02), r=0.0055)
    ck.seam_line(ctx, np.where(arm, ctx.y - Y(0.54), 1.0))
    elbow = arm * np.exp(-((ctx.y - Y(0.63)) / 0.04) ** 2) * (ctx.z < 0)
    ctx.mix(elbow * 0.22, ctx.piece.cloth.rgb * 1.2)


def coat_seams(ctx):
    """Tailored fronts, welt pockets and cuffs; wear stays in this coat's own colour."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    arm = ctx.zone == "arm"
    front = (ctx.z > 0) & ~arm & ~ctx.inner
    edge = np.abs(ctx.x) - ctx.piece.meta.get("edge_x", 0.055)
    ck.seam_line(ctx, np.where(front, edge - 0.008, 1.0))
    ck.seam_line(ctx, np.where((ctx.z < 0) & ~arm, np.abs(ctx.x), 1.0))
    for sign in (-1, 1):
        pocket = front & (np.abs(ctx.x - sign * 0.11) < 0.065)
        ck.seam_line(ctx, np.where(pocket, ctx.y - Y(0.575), 1.0), stitches=False)
    for k in range(3):
        ck.button(ctx, ctx.fit.snap((ctx.piece.meta.get("edge_x", 0.055)-0.022, Y(0.72)-k*0.075,0.16),0.034),
                  r=0.008, rgb=tuple(ctx.piece.cloth.rgb*0.45))
    ck.seam_line(ctx, np.where(arm,ctx.y-Y(0.535),1.0))
    elbow=arm*np.exp(-((ctx.y-Y(0.63))/0.045)**2)*(ctx.z<0)
    ctx.mix(elbow*ctx.piece.cloth.wear*0.25,ctx.piece.cloth.rgb*1.15)


def knitted(ctx):
    # Broad rib at the doubled lower band, finer stocking stitch on the crown.
    a = np.arctan2(ctx.x, ctx.z - ctx.piece.meta["centre_z"])
    rib = np.cos(a * 90)
    band = sm(ctx.piece.meta["band_y"] + 0.036, ctx.piece.meta["band_y"] + 0.028, ctx.y)
    ctx.bump(rib * band, 0.00035)
    ctx.mul((0.5 - 0.5 * rib) * band, 0.87)
    ck.seam_line(ctx, ctx.y - ctx.piece.meta["band_y"] - 0.03, stitches=False)


def round_hat(fit, colour, style):
    """Closed rounded crown with a doubled band; felt brims are separate hemmed shells."""
    c, top = ck.head_axis(fit)
    chin = bd.Y(fit.P, 0.870)
    band_y = chin + fit.P["hs"] * 0.132
    n = 24
    a = np.arange(n) * 2 * math.pi / n
    # Fitted over the band by 11 mm (the capped crop under it); 14 mm and a 4 % flare made the crowns broad (#82).
    radius = ck.head_support(fit, band_y, a) + 0.011
    knit = style == "knitcap"
    pc = ck.Piece("cap", cloth(colour, "wool" if knit else "felt", folds=0.25,
                              extra=knitted if knit else None), hat=True, scale=1.2)
    pc.meta.update(band_y=band_y, centre_z=c[2])
    scalp = ck.scalp_top(fit)
    if style == "tophat":
        # about 17 cm of crown over the band (was 21 cm)
        stations = [(band_y, 1), (band_y + 0.018, 1.01), (scalp + 0.072, 0.94),
                    (scalp + 0.087, 0.97), (scalp + 0.090, 0.5)]
    elif style == "souwester":
        # oilskin over a low round crown, about 2.5 cm over the head's crown
        stations = [(band_y, 1), (band_y + 0.014, 1.01), (band_y + 0.032, 1.0),
                    (scalp - 0.018, 0.93), (scalp + 0.013, 0.73), (scalp + 0.025, 0.36)]
    elif knit:
        # a knitted cap lies on the head: its top about 2 cm over the crown (it stood 4.6 cm, a bowler's height)
        stations = [(band_y, 1), (band_y + 0.014, 1.02), (band_y + 0.038, 1.0),
                    (scalp - 0.022, 0.93), (scalp + 0.010, 0.74), (scalp + 0.021, 0.36)]
    else:
        stations = [(band_y, 1), (band_y + 0.014, 1.02), (band_y + 0.038, 1.02),
                    (top - 0.020, 1.0), (top + 0.015, 0.83), (top + 0.031, 0.45)]
    points = np.array([np.stack((c[0] + radius * r * np.sin(a), np.full(n, y),
                                c[2] + radius * r * np.cos(a)), -1) for y, r in stations])
    ids = pc.grid(points, ck.hat_weights, closed=True, seam_col=n // 2)
    tip = pc.add((c[0], stations[-1][0] + 0.003, c[2]), {"head": 1})
    for j in range(n):
        pc.face((ids[-1, j], ids[-1, (j + 1) % n], tip))
    pc.seam(ids[-1, n // 2], tip)
    pc.orient(lambda q: q - np.array((c[0], q[1] - 0.06, c[2])))
    ck.thicken(pc, 0.003 if knit else 0.0025, depth=0.03)
    out = [pc]
    if not knit:
        brim = ck.Piece("cap_brim", cloth(colour, "felt", folds=0, wear=0.35), hat=True)
        width = 0.035 if style == "bowler" else 0.045
        pts = []
        for d in (-.018, width * 0.45, width):
            y = band_y - 0.005 + 0.008 * (d / width) ** 2 * np.cos(a * 2)
            pts.append(np.stack((c[0] + (radius + d) * np.sin(a), y,
                                 c[2] + (radius + d) * np.cos(a)), -1))
        brim.grid(np.array(pts), ck.hat_weights, closed=True, seam_col=n // 2)
        brim.orient((0, 1, 0))
        ck.thicken(brim, 0.003, depth=None)
        out.append(brim)
        if style in ("bowler", "tophat"):
            ck.tip_back(out, band_y)
    return out


def oilskin_hat(fit, colour):
    """The sou'wester: a low round crown and a brim that is short in front and falls longer behind (8.5 cm) over the
    collar. It had a bowler's crown and an 11 cm back brim: from the side it read as a helmet (#82)."""
    crown = round_hat(fit, colour, "souwester")[0]
    crown.cloth = cloth(colour, "canvas", sheen=0.4, folds=0.2, wear=0.55)
    c, _ = ck.head_axis(fit)
    y = crown.meta["band_y"]
    a = np.arange(32) * 2 * math.pi / 32
    radius = ck.head_support(fit, y, a) + 0.012
    brim = ck.Piece("cap_brim", crown.cloth, hat=True)
    pts = []
    for t in (-0.4, 0.45, 1):
        width = 0.035 + 0.050 * (1 - np.cos(a)) / 2
        # the inner row tucks 18 mm under the crown all round (a share of the long back brim went into the head)
        out = width * t if t > 0 else np.full(len(a), -0.018)
        pts.append(np.stack((c[0] + (radius + out) * np.sin(a),
                             y - 0.035 * max(t, 0.0) * (1 - np.cos(a)) / 2,
                             c[2] + (radius + out) * np.cos(a)), -1))
    brim.grid(np.array(pts), ck.hat_weights, closed=True, seam_col=16)
    brim.orient((0, 1, 0))
    ck.thicken(brim, 0.0025, depth=None)
    return [crown, brim]


def working_top(fit, colour, material="wool", rolled=False):
    pc = ck.Piece("jersey" if material == "wool" else "shirt",
                  cloth(colour, material, wear=0.65, dust=0.18, tar=0.10, extra=seams))
    ck.upper(fit, pc, rows=(1, 9), neck=0, sleeve="f1" if rolled else "w1", ease=lambda i: 0.017)
    ck.thicken(pc, 0.003 if material == "wool" else 0.002, depth=0.05)
    collar = ck.Piece("shirt_collar", pc.cloth, scale=1.2)
    ck.collar(fit, collar, -0.1, 0.24, 0.019, 0.018, rows=2)
    ck.thicken(collar, 0.0025, depth=None)
    return [pc, collar]


def double_breasted(ctx):
    Y = lambda f: bd.Y(ctx.fit.P, f)
    front = (ctx.z > 0) & (ctx.zone != "arm")
    ck.seam_line(ctx, np.where(front, ctx.x - 0.065, 1.0))
    for sign in (-1, 1):
        for k in range(3):
            ck.button(ctx, ctx.fit.snap((sign * 0.065, Y(0.75) - k * 0.065, 0.14), 0.038),
                      r=0.009, rgb=(0.065, 0.065, 0.07))
    seams(ctx)


def repairs(ctx):
    """Darned wool with soft irregular wear, rather than a jagged mesh edge."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    ck.patch(ctx, ctx.fit.snap((0.20 * ctx.fit.P["w"], Y(0.63), -0.045), 0.025),
             (0.027, 0.04), (0.19, 0.16, 0.12))
    ck.patch(ctx, ctx.fit.snap((-0.11, Y(0.55), 0.13), 0.03),
             (0.033, 0.028), (0.25, 0.22, 0.16))
    hem = ctx.piece.meta.get("hem", Y(0.52))
    ctx.mix(sm(hem + 0.025, hem, ctx.y) * 0.25, (0.35, 0.29, 0.20))


def closed_coat(fit, spec):
    co = ck.Piece("coat", cloth(spec["coat"], "canvas" if spec.get("oilskin") else "wool",
                                wear=0.55, tar=0.2, sheen=0.4 if spec.get("oilskin") else 0,
                                extra=double_breasted))
    vm, _ = ck.upper(fit, co, rows=(0, 9), neck=0, sleeve="w1", ease=lambda i: 0.027,
                     open_front=(lambda y: 0.073, lambda y: 0.062, 0.003))
    # The overlapped centre seam joins a closed hem, without a slit exposing the belly.
    loop = [vm[i] for i in fit.row(0)]
    hem = bd.Y(fit.P, spec.get("long", 0.42))
    ck.hang(fit, co, loop, [bd.Y(fit.P, 0.48), hem], clear=0.04, flare=0.06,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1, back_legs=0.7, spring=0.2, springs=("coat",)))
    co.meta.update(hem=hem, edge_x=0.065)
    ck.thicken(co, 0.003, depth=0.07)
    collar = ck.Piece("coat_collar", co.cloth, scale=1.2)
    ck.collar(fit, collar, -0.45, 0.42, 0.034, 0.03, rows=3, front_gap=0.07, fold=(0.04, 0.05))
    ck.thicken(collar, 0.003, depth=None)
    return [co, collar]


def lengthen_coat(co, fit, new):
    """Lengthen the coat skirts; sleeves hanging below the hips keep their arm weights."""
    old, pivot = co.meta["hem"], fit.hip_y
    for i, point in enumerate(co.V):
        if point[1] < pivot and co.zone[i] != "arm":
            q = point.copy()
            q[1] = pivot + (q[1] - pivot) * (pivot - new) / (pivot - old)
            co.V[i] = q
            co.W[i] = ck.hang_weights(fit, q, front_legs=1, back_legs=0.6,
                                     spring=0.25, springs=("coat",))
    co.meta["hem"] = new


def tailored(fit, spec):
    """Open coat/waistcoat block, or a closed jersey/short-sleeve shirt on its own."""
    pcs = sooi_dress(fit)
    colours = {"coat": spec.get("coat", 0x4a4034), "coat_collar": spec.get("coat", 0x4a4034),
               "waistcoat": spec.get("vest", 0x3a342a), "shirt": spec.get("shirt", 0xa8a090),
               "shirt_collar": spec.get("shirt", 0xa8a090), "cuffL": spec.get("shirt", 0xa8a090),
               "cuffR": spec.get("shirt", 0xa8a090), "trousers": spec["trousers"],
               "boots": spec.get("boots", 0x221a12), "cap": spec["hat_col"],
               "kerchief": spec.get("kerchief", 0x3a3634), "kerchief_ends": spec.get("kerchief", 0x3a3634)}
    for pc in pcs:
        if pc.name in colours:
            recolour(pc, colours[pc.name])
        if pc.name == "trousers":
            pc.cloth.wear = spec.get("wear", 0.5)
        if pc.name in ("coat", "coat_collar"):
            pc.cloth.wear = spec.get("wear", 0.5)
            pc.cloth.dust = spec.get("dust", 0.12)
        if pc.name == "coat":
            pc.cloth.extra = coat_seams
        if pc.name == "coat" and spec.get("patched"):
            old_extra = pc.cloth.extra
            def extra(ctx, old_extra=old_extra):
                old_extra(ctx)
                repairs(ctx)
            pc.cloth.extra = extra
    if "jersey" in spec or spec.get("shirt_only"):
        pcs = [p for p in pcs if p.name in ("trousers", "boots", "soles", "cap", "cap_peak")]
        pcs += working_top(fit, spec.get("jersey", spec.get("shirt")),
                           "wool" if "jersey" in spec else "linen", spec.get("rolled", False))
    elif not spec.get("kerchief"):
        pcs = [p for p in pcs if not p.name.startswith("kerchief")]
    if spec.get("pea") or spec.get("oilskin"):
        pcs = [p for p in pcs if p.name not in ("coat", "coat_collar", "waistcoat")]
        pcs += closed_coat(fit, spec)
    # Coat skirts follow the legs and coat spring bones: lengthen only below the hips.
    if spec.get("long") and not spec.get("oilskin"):
        co = next(p for p in pcs if p.name == "coat")
        lengthen_coat(co, fit, bd.Y(fit.P, spec["long"]))
    if spec.get("breeches"):
        tr = next(p for p in pcs if p.name == "trousers")
        # Collapse the lower rings into a short, closed turned hem below the knee.
        lo = 0.055
        target = fit.knee_y - 0.06
        for i, p in enumerate(tr.V):
            if p[1] < fit.knee_y:
                q = p.copy()
                q[1] = target + (p[1] - lo) / (fit.knee_y - lo) * (fit.knee_y - target)
                tr.V[i] = q
                tr.W[i] = fit.near_w(q, ("legL", "legR"))
    if spec.get("barefoot"):
        pcs = [p for p in pcs if p.name not in ("boots", "soles")]
    if spec.get("hat", "flatcap") != "flatcap":
        pcs = [p for p in pcs if p.name not in ("cap", "cap_peak")]
        pcs += oilskin_hat(fit, spec["hat_col"]) if spec["hat"] == "souwester" else round_hat(fit, spec["hat_col"], spec["hat"])
    if spec.get("chain"):
        chain = ck.Piece("watch_chain", cloth(0xa08038, "metal", folds=0, wear=0.3), scale=1.5)
        Y = lambda f: bd.Y(fit.P, f)
        ck.strap_grid(fit, chain, [(0.005, Y(0.68), 0.17), (0.045, Y(0.64), 0.17),
                                  (0.105, Y(0.655), 0.16)], [0.003] * 3, 0.018,
                      cols=3, rows=9, onto=ck.Onto([p for p in pcs if p.name == "waistcoat"]))
        ck.thicken(chain, 0.0015, depth=None)
        pcs.append(chain)
    return pcs


def plain_skirt(ctx):
    a = np.arctan2(ctx.x, ctx.z)
    ck.seam_line(ctx, np.abs(np.sin(a * 3)) * 0.15)
    ck.seam_line(ctx, ctx.y - ctx.piece.meta["hem"] - 0.018)


def plain_shawl(ctx):
    ck.seam_line(ctx, np.abs(ctx.x) - 0.15, stitches=False)


def women(fit, spec):
    pcs = fishwife_a_dress(fit)
    colours = {"bodice": spec["dress"], "skirt": spec["skirt"], "chemise": spec["collar"],
               "shawl": spec["shawl"], "cap": spec["hat_col"], "cap_frill": spec["hat_col"],
               "boots": spec["boots"], "apron": spec.get("apron", 0x7a8a90),
               "apron_band": spec.get("apron", 0x7a8a90)}
    for pc in pcs:
        if pc.name in colours:
            recolour(pc, colours[pc.name])
        if pc.name == "skirt":
            pc.cloth.extra = plain_skirt
        if spec.get("mourning") and pc.name in ("shawl", "shawl_fringe"):
            recolour(pc, spec["shawl"])
            pc.cloth.extra = plain_shawl
        if pc.name == "shawl":
            # Keep the folded wool outside the reduced bodice through shoulder rotation.
            for i, point in enumerate(pc.V):
                _, normal = fit.surface(point, parts=("torso", "neck", "arm"))
                pc.V[i] = point + normal * 0.018
        if not spec.get("mourning") and pc.name in ("cap", "cap_frill"):
            centre, top = ck.head_axis(fit)
            # Fientje pins her fixed bun inside the cap; the bare-head fitting has no bun envelope.
            for i, point in enumerate(pc.V):
                q = point.copy()
                back = float(sm(centre[2] + 0.005, centre[2] - 0.04, q[2]))
                q[2] -= 0.065 * back
                q[1] += 0.012 * back * float(sm(top - 0.11, top, q[1]))
                pc.V[i] = q
    if spec.get("mourning"):
        pcs = [p for p in pcs if p.name not in ("apron", "apron_band", "cap_frill")]
        old = next(p for p in pcs if p.name == "bodice")
        pcs.remove(old)
        bodice = ck.Piece("bodice", old.cloth)
        ck.upper(fit, bodice, rows=(2, 9), neck=0, sleeve="w1", ease=lambda i: 0.017)
        ck.thicken(bodice, 0.003, depth=0.04)
        pcs.insert(1, bodice)
        bonnet = next(p for p in pcs if p.name == "cap")
        bonnet.cloth.kind = "felt"
        bonnet.cloth.extra = None
        ties = ck.Piece("bonnet_ties", bonnet.cloth, hat=True)
        # Short ribbons tied under the chin, clear of the collar (no theatrical veil).
        Y = lambda f: bd.Y(fit.P, f)
        for sign in (-1, 1):
            ck.strap_grid(fit, ties, [(sign * 0.075, Y(0.91), 0.025),
                                    (sign * 0.055, Y(0.867), 0.07), (sign * 0.01, Y(0.851), 0.08)],
                          [0.014, 0.016, 0.013], 0.012, cols=3, rows=5,
                          wfn=ck.hat_weights, parts=("head", "neck"))
        ck.thicken(ties, 0.0015, depth=None)
        pcs.append(ties)
    return pcs


def reduce_cast(ob, budget):
    """Reduce separate garment shells, so a masked global decimator cannot erase another garment.

    This is scoped to C4. The shared cloth lane can replace it when its reducer lands.
    Each shell keeps its own weighted share, including linings, cuffs and brim edges.
    """
    import bpy
    import bmesh
    from . import lod, weights as wt
    if lod.tris(ob) <= budget:
        return
    if budget <= 0:
        raise ValueError("Cast body leaves no cloth budget: " + ob.name)
    parts = [(p or "").removeprefix("in_") for p in wt.parts(ob)]
    counts = {}
    for f in ob.data.polygons:
        name = parts[f.vertices[0]]
        counts[name] = counts.get(name, 0) + len(f.vertices) - 2
    left = budget
    free = dict(counts)
    targets = {}
    while free:
        total = sum(n ** 0.7 for n in free.values())
        share = {p: left * n ** 0.7 / total for p, n in free.items()}
        capped = [p for p in free if share[p] >= free[p]]
        if not capped:
            targets.update({p: max(12, int(share[p])) for p in free})
            break
        for p in capped:
            targets[p] = free.pop(p)
            left -= targets[p]
    shells = []
    for name, count in counts.items():
        shell = ob.copy()
        shell.data = ob.data.copy()
        shell.name = "_cast_reduce_" + name
        bpy.context.scene.collection.objects.link(shell)
        bm = bmesh.new()
        bm.from_mesh(shell.data)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if parts[v.index] != name], context="VERTS")
        bm.to_mesh(shell.data)
        bm.free()
        bpy.context.view_layer.objects.active = shell
        if count > targets[name]:
            dec = shell.modifiers.new("cast_budget", "DECIMATE")
            dec.ratio = targets[name] / count
            dec.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=dec.name)
        shells.append(shell)
    # Keep the caller's object and name; its vertex groups are merged by name.
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    ob.data.clear_geometry()
    ob.select_set(True)
    for shell in shells:
        shell.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.join()
    # Closed shells can reach their local topology floor before their share. Finish evenly,
    # without vertex-group masks that would repeatedly collapse a neighbouring garment.
    for _ in range(3):
        count = lod.tris(ob)
        if count <= budget:
            break
        modifier = ob.modifiers.new("cast_final_budget", "DECIMATE")
        modifier.ratio = max(0.02, (budget - 4) / count)
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def orient_far(source, target, garment_names=None):
    """Orient each connected far shell coherently, then match its authored near side."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    from . import weights as wt
    source.data.calc_loop_triangles()
    parts = wt.parts(source)
    groups = {}
    for tr in source.data.loop_triangles:
        groups.setdefault(parts[tr.vertices[0]], []).append(tuple(tr.vertices))
    vertices = [tuple(v.co) for v in source.data.vertices]
    trees = {name: BVHTree.FromPolygons(vertices, faces, all_triangles=True) for name, faces in groups.items()}
    target_parts = wt.parts(target)
    bm = bmesh.new()
    bm.from_mesh(target.data)
    bm.verts.ensure_lookup_table()
    faces = {f for f in bm.faces if garment_names is None or
             (target_parts[f.verts[0].index] or "").removeprefix("in_") in garment_names}
    bmesh.ops.recalc_face_normals(bm, faces=list(faces))
    flipped = 0
    while faces:
        first = faces.pop()
        component, pending = [first], [first]
        while pending:
            face = pending.pop()
            for edge in face.edges:
                for neighbour in edge.link_faces:
                    if neighbour in faces:
                        faces.remove(neighbour)
                        component.append(neighbour)
                        pending.append(neighbour)
        score = 0.0
        for face in component:
            tree = trees.get(target_parts[face.verts[0].index])
            if tree is not None:
                _, normal, _, _ = tree.find_nearest(face.calc_center_median())
                if normal is not None:
                    score += face.calc_area() * face.normal.dot(normal)
        if score < 0:
            bmesh.ops.reverse_faces(bm, faces=component)
            flipped += len(component)
    bm.to_mesh(target.data)
    bm.free()
    target.data.update()
    return flipped


def visible_far(ob):
    """Omit hidden lining surfaces at distance; keep mixed outer/inner edge facings."""
    import bmesh
    from . import weights as wt
    parts = wt.parts(ob)
    covered = {"shirt", "waistcoat", "watch_chain", "kerchief_ends"} if "coat" in parts else set()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    hidden = [f for f in bm.faces
              if all((parts[v.index] or "").startswith("in_") for v in f.verts)
              or (parts[f.verts[0].index] or "").removeprefix("in_") in covered]
    bmesh.ops.delete(bm, geom=hidden, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


def build(kind, make_body, ref_uv, layout, atl, tex, base_body=None):
    """C4's scoped budget and reducer; restore shared settings even when a trial fails."""
    from . import dress
    old = dress.NEAR_HERO, dress.NEAR_CROWD, dress.FAR, dress.reduce_cloth, dress.paint_clothes, ck.clear_layers
    original_paint = dress.paint_clothes
    state = {}
    reserve = [0, 0]
    if base_body is None:
        import bpy
        from . import lod
        base, build_name = {n: (b, v) for n, b, v in bd.BODIES}[kind.body]
        parts = {o.name[len(kind.body) + 1:]: lod.tris(o) for o in bpy.data.objects
                 if o.type == "MESH" and o.name.startswith(tuple(kind.body + "_" + p for p in ("hair_", "beard_", "mous_")))}
        base_body = {"P": bd.params(base, build_name), "counts": {"pieces": parts}}
    if base_body is not None:
        face = dress.face_of(kind, base_body["P"])
        parts = base_body["counts"]["pieces"]
        for level in (0, 1):
            for prefix, style in (("hair", face.get("hair")), ("beard", face.get("beard")),
                                  ("mous", face.get("moustache"))):
                if kind.hero:
                    reserve[level] += parts.get("%s_%s_lod%d" % (prefix, style, level), 0) if style else 0
                else:
                    reserve[level] += max((v for k, v in parts.items()
                                           if k.startswith(prefix + "_") and k.endswith("_lod%d" % level)), default=0)
    def defer_paint(ob, pieces, fit, size, seed=3):
        state.update(pieces=pieces, fit=fit, size=size, seed=seed)
        defer_paint.zones = np.zeros((size, size), np.float32)
        return np.full((size, size, 3), 0.4, np.float32), np.tile((0.5, 0.5, 1.0), (size, size, 1)).astype(np.float32)
    def reduce(ob, budget):
        if ob.name.endswith("_lod0"):
            reduce_cast(ob, budget)
            pieces = state["pieces"]
            scales = {p.name: p.scale for p in pieces} | {"in_" + p.name: p.scale for p in pieces}
            ck.unwrap(ob, scales, margin=0.004)
            rgb, nrm = original_paint(ob, pieces, state["fit"], state["size"], state["seed"])
            state.update(near=ob, rgb=rgb, nrm=nrm, zones=defer_paint.zones.copy())
        else:
            visible_far(ob)
            reduce_cast(ob, budget)
            orient_far(state["near"], ob)
            scales = {p.name: p.scale for p in state["pieces"]} | {"in_" + p.name: p.scale for p in state["pieces"]}
            ck.unwrap(ob, scales, margin=0.004)
            rgb, nrm = original_paint(ob, state["pieces"], state["fit"], state["size"], state["seed"])
            # Bake both LODs into the existing kind's cloth rectangle. Independent UVs
            # avoid projecting coarse triangles across near seams. No extra texture layer
            # or shader is needed; the far copy gets 20% of the rectangle's width.
            width = state["size"]
            split = int(width * 0.8)
            def resize(a, count):
                x = np.linspace(0, a.shape[1] - 1, count)
                lo = x.astype(int)
                hi = np.minimum(lo + 1, a.shape[1] - 1)
                t = (x - lo).reshape((1, count) + (1,) * (a.ndim - 2))
                return (a[:, lo] * (1 - t) + a[:, hi] * t).astype(np.float32)
            combine = lambda a, b: np.concatenate((resize(a, split), resize(b, width - split)), axis=1)
            atl.put("cloth_" + kind.name, combine(state["rgb"], rgb), combine(state["nrm"], nrm))
            atl.clothes_zones("cloth_" + kind.name, combine(state["zones"], defer_paint.zones))
            ratio = split / width
            for loop in state["near"].data.uv_layers.active.data:
                loop.uv.x *= ratio
            for loop in ob.data.uv_layers.active.data:
                loop.uv.x = ratio + loop.uv.x * (1 - ratio)
    try:
        dress.NEAR_HERO, dress.NEAR_CROWD, dress.FAR = 16000 - reserve[0], 14000 - reserve[0], 2500 - reserve[1]
        dress.reduce_cloth = reduce
        dress.paint_clothes = defer_paint
        # C4 pieces already use fitted ease/Onto offsets. The shared nearest-layer correction
        # folds their disconnected shoulder seams through the shawl after reduction.
        ck.clear_layers = lambda *args, **kwargs: 0
        return dress.build(kind, make_body, ref_uv, layout, atl, tex=tex)
    finally:
        dress.NEAR_HERO, dress.NEAR_CROWD, dress.FAR, dress.reduce_cloth, dress.paint_clothes, ck.clear_layers = old


def proof(dressed, bodies, actions, move_clips, held_obs, pictures_dir, rig_path):
    """Use the existing face-aware preview for C4 cast/clip sheets, rather than white intake placeholders."""
    import json
    from . import preview as pv, preview_c, preview_mh as pm, dress
    pm.PICS = pictures_dir
    pm._MATS.clear()
    pm._IMGS.clear()
    with open(rig_path, encoding="utf-8") as f:
        recipe = json.load(f)
    with open(rig_path.replace("peopleRig.json", "faceTypes.json").replace("_rig.json", "_faces.json"), encoding="utf-8") as f:
        cells = json.load(f)["cells"]
    old_clone = pv.clone
    def clone(b, lod="lod0", name=None):
        if "kind" not in b:
            return old_clone(b, lod, name)
        ao, meshes = pm.person(b["name"], dress.face_of(b["kind"], b["P"]),
                               lod=int(lod[-1]), rig=recipe, cells=cells)
        return ao, meshes[0]
    pm.hide_all()
    for ob in held_obs:
        ob.data.materials.clear()
        ob.data.materials.append(pm.material("held", "m_mid_brown"))
    try:
        pv.clone = clone
        return preview_c.cast(dressed, bodies, actions, move_clips, held_obs)
    finally:
        pv.clone = old_clone
