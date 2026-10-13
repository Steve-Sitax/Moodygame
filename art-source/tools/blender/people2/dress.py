"""Dressing a kind (package C; docs/people.md "Kinds and clothes").

A kind is a base body (made again under the kind's own name, so its armature and meshes are the kind's), its face
(one setting: Kind.face, see face_of), its hair, the garments of its kinds_*.py entry and its held things. The
steps, in build():
1. the body, as A and B make it (build_people2.make_body), with the kind's hair style;
2. the face: the kind's face mix baked into the near copy (the face-shape keys stay, for more variety at run time);
3. the body's picture (skin, hands, the kind's extras such as socks or grime), and the face square;
4. the garments (Kind.dress(fit) -> Pieces), one cage: unwrapped, subdivided (near), on its limit surface (far);
5. the body under the clothes cut away (Kind.covers);
6. the cloth picture, painted on the garments in 3D;
7. UVs into the kind layer and full-square face, the clothes joined into the body's two meshes, hats made to follow the face shapes.
"""

import math
import os

import numpy as np

from . import SHOTS
from . import pictures as at
from . import G as toG
from . import clothes_kit as ck
from . import lod
from . import paint
from . import weights as wt


class Kind:
    """One kind of person. face: the one face setting (seed, age, sex, and optionally a face type name or look
    values): see face_of(). hair: a hair style dict (hair.py) or None for a seeded one. dress(fit) -> list of
    ck.Piece. covers(p, part) -> True where the body is hidden under the clothes. skin(ctx) paints extras on the
    body picture (socks, grime). held: [(model, socket, note)]. avoid: clips it should not play (and why)."""

    def __init__(self, name, group, body, face, dress, covers, hair=None, hats=(), held=(), hands_hard=0.0,
                 hero=False, skin=None, avoid=(), clips=(), note=""):
        self.name, self.group, self.body = name, group, body
        self.face, self.hair = face, hair
        self.dress, self.covers, self.skin = dress, covers, skin
        self.hats = tuple(hats)
        self.held = list(held)
        self.hands_hard = hands_hard
        self.hero = hero
        self.avoid = dict(avoid)
        self.clips = list(clips)
        self.note = note


def face_of(kind, P):
    """The kind's default face (the face the check pictures show and the game starts from): the named cast's fixed
    face (face_types.CAST), else face_types.face_for(the kind's seed). The game gives every person of a kind their own
    face at spawn (sliders, face picture, hair) from their id; the kind's mesh carries no face of its own."""
    from . import face_types as ft
    f = kind.face
    sex = f.get("sex", "f" if P["female"] else "m")
    if kind.name in ft.CAST:
        return ft.face_for(0, kind.name, sex, f.get("age", 35))
    return ft.face_for(f["seed"], kind.name, sex, f.get("age", 35))


def bake_shapes(ob, mix):
    """Bake a face-shape mix into a near copy: the basis and every key move by the mix, so the keys still add on top
    (the games may give each person of a kind more of them)."""
    me = ob.data
    if not me.shape_keys or not mix:
        return
    kb = me.shape_keys.key_blocks
    basis = me.shape_keys.reference_key
    n = len(me.vertices)
    b = np.zeros(n * 3)
    basis.data.foreach_get("co", b)
    D = np.zeros(n * 3)
    for name, w in mix.items():
        if name in kb:
            k = np.zeros(n * 3)
            kb[name].data.foreach_get("co", k)
            D += w * (k - b)
    for k_ in kb:
        c = np.zeros(n * 3)
        k_.data.foreach_get("co", c)
        k_.data.foreach_set("co", c + D)
    co = np.zeros(n * 3)
    me.vertices.foreach_get("co", co)
    me.vertices.foreach_set("co", co + D)
    me.update()


def limit4(ob):
    W = wt.read(ob)
    for vg in list(ob.vertex_groups):
        if not vg.name.startswith(("part_", "zone_")):
            ob.vertex_groups.remove(vg)
    wt.apply(ob, W, limit=4)


NEAR_CROWD, NEAR_HERO, FAR = 8900, 11500, 2100


def reduce_cloth(ob, budget):
    """Collapse redundant tessellation after rounding, before adding any face morphs, piece by piece: small pieces
    (a cap, its peak, clogs, a collar) keep at least half their triangles so they keep their shape; the big ones
    (smocks, coats, skirts) share the rest of the allowance by their size.

    The decimator interpolates UVs and rig weights on the painted surface.
    The rounded limit surface, hems and folds are already geometry at this stage.
    """
    import bpy
    count = lod.tris(ob)
    if budget <= 0:
        raise ValueError("Exposed body leaves no clothing budget: %s" % ob.name)
    if count <= budget:
        return
    groups = {g.index: g.name[5:].removeprefix("in_") for g in ob.vertex_groups if g.name.startswith("part_")}
    vpart = [None] * len(ob.data.vertices)
    for v in ob.data.vertices:
        best = -1.0
        for g in v.groups:
            if g.group in groups and g.weight > best:
                best, vpart[v.index] = g.weight, groups[g.group]
    tris = {}
    for f in ob.data.polygons:
        pn = vpart[f.vertices[0]]
        tris[pn] = tris.get(pn, 0) + len(f.vertices) - 2
    # each piece's share grows slower than its size (n^0.7): a big smock is reduced more than a cap's peak, but
    # never crushed; a piece never gets more than it has
    targets = {pn: n for pn, n in tris.items()}
    free = dict(tris)
    left = budget
    while free:
        tot = sum(n ** 0.7 for n in free.values())
        share = {pn: left * n ** 0.7 / tot for pn, n in free.items()}
        capped = {pn for pn in free if share[pn] >= free[pn]}
        if not capped:
            for pn in free:
                targets[pn] = max(8, int(share[pn]))
            break
        for pn in capped:
            targets[pn] = free[pn]
            left -= free[pn]
            del free[pn]
    bpy.context.view_layer.objects.active = ob

    for pn, want in targets.items():
        have = tris.get(pn, 0)
        if have <= want or have == 0:
            continue
        vg = ob.vertex_groups.get("_reduce") or ob.vertex_groups.new(name="_reduce")
        vg.remove(list(range(len(ob.data.vertices))))
        vg.add([i for i, p in enumerate(vpart) if p == pn], 1.0, "REPLACE")
        total = lod.tris(ob)
        modifier = ob.modifiers.new("cloth_budget", "DECIMATE")
        modifier.ratio = max(0.02, (total - (have - want)) / total)
        modifier.use_collapse_triangulate = True
        modifier.use_symmetry = True
        modifier.symmetry_axis = "X"
        modifier.vertex_group = "_reduce"
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        vpart = [None] * len(ob.data.vertices)
        for v in ob.data.vertices:
            best = -1.0
            for g in v.groups:
                if g.group in groups and g.weight > best:
                    best, vpart[v.index] = g.weight, groups[g.group]
    if ob.vertex_groups.get("_reduce"):
        ob.vertex_groups.remove(ob.vertex_groups["_reduce"])
    # anything still over (a piece that would not collapse further): one last even pass
    count = lod.tris(ob)
    if count > budget:
        modifier = ob.modifiers.new("cloth_budget", "DECIMATE")
        modifier.ratio = budget / count
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def piece_counts(ob):
    parts = wt.parts(ob)
    counts = {}
    for face in ob.data.polygons:
        name = (parts[face.vertices[0]] or "unknown").removeprefix("in_")
        counts[name] = counts.get(name, 0) + len(face.vertices) - 2
    return counts


def join(target, src):
    import bpy

    for o in bpy.context.selected_objects:
        o.select_set(False)
    src.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def picture_group(P):
    if P["child"]:
        return "boy"
    if P["old"]:
        return "old_f" if P["female"] else "old_m"
    return "f" if P["female"] else "m"


def paint_body(b, kind, rect, size=1024):
    """The kind's body picture (MakeHuman's skin with the sun on the hands and neck, and the kind's own extras: socks,
    stockings, grime), painted straight into its rectangle of the kind's layer."""
    from . import mhskin
    rgb, nmap, zones = mhskin.body_picture(b, picture_group(b["P"]), size=size, rect=rect, underwear=False, kind=kind)
    paint_body.zones = zones
    return rgb, nmap


def clothes_keys(ob, b, first, lod):
    """The MakeClothes way, made smooth: every garment vertex (from index `first` on) finds the body's base mesh
    where it lies (an arm's cloth on the arm, a leg's on the leg, a hat on the head) and takes each slider's move as
    the mean move of the skin round that point, over a reach that grows with its distance from the skin (8 mm for
    cloth on the skin, about two thirds of the distance for a cap's peak). A far point bound to one small triangle
    would swing with that triangle's turn (a kepi's peak pulled down the nose by a nose slider)."""
    from mathutils import Vector
    from mathutils.kdtree import KDTree
    from . import mh, mhbody, rig
    me = ob.data
    if not me.shape_keys:
        return
    body = b["mhbody"]
    keys = mhbody.slider_keys(body)
    co = np.array([toG(v.co) for v in me.vertices])
    n = len(co)
    idx = np.arange(first, n)
    if not len(idx):
        return
    W = wt.read(ob)[idx]
    dom = np.array([rig.NAMES[i] for i in np.argmax(W, 1)])
    btris, _ = body.b.tris()
    tpart = body.parts[btris]

    def tris_of(names):
        return np.isin(tpart, names).sum(1) >= 2
    groups = []
    for S in "LR":
        arm = np.array([d.startswith(("armUp", "armLow", "armTwist", "hand", "shoulder", "thumb", "index", "middle",
                                       "ring")) and d.endswith(S) for d in dom])
        groups.append((arm, tris_of(["arm" + S] + ["finger_%s%s" % (f, S) for f in
                                                    ("thumb", "index", "middle", "ring", "little")])))
    head = np.isin(dom, ("head", "jaw", "eyeL", "eyeR"))
    groups.append((head, tris_of(["head"])))
    rest = ~np.any([g[0] for g in groups], axis=0)
    groups.append((rest, tris_of(["torso", "neck", "legL", "legR", "head"])))
    bind = mh.Binding.fit(co[idx], body.Pf, btris, groups)
    skin = bind.interp(body.Pf)  # the nearest skin point of every garment vertex
    dist = np.linalg.norm(co[idx] - skin, axis=1)
    rows, cols, wts = [], [], []
    done = np.zeros(len(idx), bool)
    for pm, tm in groups:
        pm = pm & ~done
        if not pm.any():
            continue
        verts = np.unique(btris[tm])
        kd = KDTree(len(verts))
        for k, v in enumerate(verts):
            kd.insert(Vector(body.Pf[v]), k)
        kd.balance()
        for i in np.nonzero(pm)[0]:
            sig = max(0.008, 0.6 * float(dist[i]))
            hits = kd.find_range(Vector(skin[i]), 2.5 * sig)
            if not hits:
                hits = [kd.find(Vector(skin[i]))]
            ww = np.array([math.exp(-0.5 * (h[2] / sig) ** 2) for h in hits])
            ww /= ww.sum()
            rows += [i] * len(hits)
            cols += [int(verts[h[1]]) for h in hits]
            wts += list(ww)
        done |= pm
    rows, cols, wts = np.array(rows), np.array(cols), np.array(wts)
    kb = me.shape_keys.key_blocks
    for kn, Dm in keys.items():
        if kn not in kb:
            continue
        d = np.zeros((len(idx), 3))
        np.add.at(d, rows, Dm[cols] * wts[:, None])
        k = np.zeros(n * 3)
        kb[kn].data.foreach_get("co", k)
        k = k.reshape(-1, 3)
        k[idx] = k[idx] + np.stack((d[:, 0], -d[:, 2], d[:, 1]), 1)
        kb[kn].data.foreach_set("co", k.ravel())


def paint_clothes(ob, pieces, fit, size, seed=3):
    """The cloth picture: every piece painted where its texels are (part_<piece>, part_in_<piece>)."""
    from . import hands

    vparts = wt.parts(ob)
    zg = {g.index: g.name[5:] for g in ob.vertex_groups if g.name.startswith("zone_")}
    vz = []
    for v in ob.data.vertices:
        z = ""
        for g in v.groups:
            if g.group in zg and g.weight > 0.5:
                z = zg[g.group]
        vz.append(z)
    pos, nrm, part, names = paint.position_map(ob, size, [(p or "") + "|" + z for p, z in zip(vparts, vz)])
    rgb = np.zeros((size, size, 3), np.float32) + 0.4
    hgt = np.zeros((size, size), np.float64)
    pn = np.array([n.split("|")[0] for n in names] + [""])
    zn = np.array([n.split("|")[1] for n in names] + [""])
    pname = pn[np.where(part >= 0, part, len(names))]
    zname = zn[np.where(part >= 0, part, len(names))]
    for k, pc in enumerate(pieces):
        m_out = pname == pc.name
        m_in = pname == "in_" + pc.name
        m = m_out | m_in
        if not m.any():
            continue
        idx = np.nonzero(m)
        ctx = ck.Ctx(pos[idx].astype(np.float64), nrm[idx].astype(np.float64), m_in[idx], pc, fit,
                     np.zeros((len(idx[0]), 3), np.float32), np.zeros(len(idx[0])), seed + 31 * k)
        ctx.zone = zname[idx]
        ck.paint_cloth(ctx)
        rgb[idx] = np.clip(ctx.rgb, 0, 1)
        hgt[idx] = ctx.h
    zones = np.zeros((size, size), np.float32)
    for pc in pieces:
        zone = at.ZONES.get(pc.cloth.kind, 1 if pc.cloth.kind in ("felt", "corduroy") else 2 if pc.cloth.kind == "cotton" else 0)
        zones[(pname == pc.name) | (pname == "in_" + pc.name)] = zone
    paint_clothes.zones = paint.dilate(zones[..., None], part >= 0)[..., 0]
    has = part >= 0
    rgb = paint.dilate(rgb, has)
    nmap = hands.normal_from_height(hgt.astype(np.float32), pos, has)
    return rgb, nmap


def build(kind, make_body, ref_uv, layout, atl, tex=2048, log=print):
    """Make one kind. make_body: build_people2.make_body. Returns the body dict (like the base bodies') with the
    kind's extras."""
    from . import body as bd

    base = {n: (bb, bl) for n, bb, bl in bd.BODIES}[kind.body]
    P0 = bd.params(*base)
    face = face_of(kind, P0)
    b, _ = make_body(kind.name, base[0], base[1], ref_uv)
    import bpy
    bpy.context.view_layer.update()
    b["vparts"] = wt.parts(b["lod0"])
    fit = ck.Fit(b)
    # the body's picture, straight into the kind's body rectangle (the faces are the shared face pictures)
    rgb, nmap = paint_body(b, kind, layout["body_" + kind.name])
    atl.put("body_" + kind.name, rgb, nmap, placed=True)
    atl.clothes_zones("body_" + kind.name, paint_body.zones)
    # the garments
    pieces = kind.dress(fit)
    log("[people2]   %s pieces (near triangles): %s" % (kind.name, ", ".join(
        "%s %d (%d faces, %d inner)" % (pc.name, sum(8 if len(f) == 4 else 6 for f in pc.F), len(pc.F),
                                        sum(1 for f in pc.F if all(pc.inner[v] for v in f))) for pc in pieces)))
    cage, _ = ck.build_objects(pieces, kind.name + "_clothes_lod1")
    scales = {}
    for pc in pieces:
        scales[pc.name] = pc.scale
    for pc in pieces:
        # the insides and the rims (hems, cuffs, brims' edges) at the cloth's own density too (the owner's rule of
        # 2026-10-13: no stretched or blurred small sides); they were at 0.3
        scales["in_" + pc.name] = pc.scale
    ck.unwrap(cage, scales, margin=0.004)
    near = lod.subdivide(cage, kind.name + "_clothes_lod0")
    ck.to_limit_keep_creases(cage)
    for ob in (near, cage):
        limit4(ob)
    crgb, cnrm = paint_clothes(near, pieces, fit, tex)
    atl.put("cloth_" + kind.name, crgb, cnrm)
    atl.clothes_zones("cloth_" + kind.name, paint_clothes.zones)
    if os.environ.get("PEOPLE2_SHOTS_CELLS"):
        paint.to_image("cloth_" + kind.name, crgb, os.path.join(SHOTS, "cloth_%s.png" % kind.name))
    # the body under the clothes
    cut0 = ck.cut_body(b["lod0"], kind.covers, near)
    cut1 = ck.cut_body(b["lod1"], kind.covers, cage)
    # Keep near skin/face/hand topology and all its morphs intact. Spend the remaining
    # crowd budget on cloth; named people have a larger allowance.
    # the crowd's near copies within 8,900 triangles, the named within 11,500 (MakeHuman's face keeps its density)
    # which piece lies over which, read before the reduction; after it, every layer is put back under the next
    order0, order1 = ck.layer_order(near), ck.layer_order(cage)
    reduce_cloth(near, (NEAR_HERO if kind.hero else NEAR_CROWD) - lod.tris(b["lod0"]))
    reduce_cloth(cage, FAR - lod.tris(b["lod1"]))
    m0 = ck.clear_layers(near, b["lod0"], order0)
    m1 = ck.clear_layers(cage, b["lod1"], order1)
    log("[people2]   %s layers: %s; points put back under the layer over them: %d near, %d far" % (
        kind.name, ", ".join("%s<%s" % (a, c) for a, c in sorted(order0)), m0, m1))
    b["piece_counts"] = {"lod0": piece_counts(near), "lod1": piece_counts(cage)}
    log("[people2]   %s final clothes near/far: %s / %s" %
        (kind.name, b["piece_counts"]["lod0"], b["piece_counts"]["lod1"]))
    # UVs into this kind's clothes layer and full-square face
    at.remap_uv(b["lod0"], layout["body_" + kind.name], layout["face_" + kind.name])
    at.remap_uv(b["lod1"], layout["body_" + kind.name], layout["face_" + kind.name])
    at.remap_uv(near, layout["cloth_" + kind.name])
    at.remap_uv(cage, layout["cloth_" + kind.name])
    for ob in (near, cage):
        ob.parent = b["ao"]
        m = ob.modifiers.new("rig", "ARMATURE")
        m.object = b["ao"]
    n0, n1 = len(b["lod0"].data.vertices), len(b["lod1"].data.vertices)
    join(b["lod0"], near)
    join(b["lod1"], cage)
    clothes_keys(b["lod0"], b, n0, 0)
    clothes_keys(b["lod1"], b, n1, 1)
    b["vparts"] = wt.parts(b["lod0"])
    b["cparts"] = wt.parts(b["lod1"])
    b["kind"] = kind
    b["face"] = face
    b["pieces"] = pieces
    b["fit"] = fit
    b["counts"]["lod0"] = lod.tris(b["lod0"])
    b["counts"]["lod1"] = lod.tris(b["lod1"])
    log("[people2] kind %s on %s: %d / %d triangles (body faces cut %d / %d), %d pieces" % (
        kind.name, kind.body, b["counts"]["lod0"], b["counts"]["lod1"], cut0, cut1, len(pieces)))
    return b


def atlas_json(layout):
    return {"size": at.SIZE, "cell": at.CELL, "material": "people2_atlas",
            "note": "one colour and one normal picture (people2_atlas, people2_atlas_n) for every body, kind and held "
                    "thing; cells in pixels [x, y, w, h] from the bottom left (UV v up); linear, mipmapped",
            "cells": {k: list(v) for k, v in layout.items()}}


def _rounded(v):
    if isinstance(v, dict):
        return {k: _rounded(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_rounded(x) for x in v]
    if isinstance(v, float):
        return round(v, 4)
    return v


def kind_json(b):
    k = b["kind"]
    P = b["P"]
    f = b["face"]
    return {
        "group": k.group, "body": k.body, "sex": "f" if P["female"] else "m", "height": round(P["H"], 3),
        "hipsBone": round(float(b["J"]["hips"][0][1]), 4), "hero": k.hero,
        "face": _rounded(k.face), "defaultFace": _rounded({"type": f["type"], "cell": f["cell"],
                                                            "sliders": {n: v for n, v in f["sliders"].items() if v}}),
        "hair": {"hair": f.get("hair"), "beard": f.get("beard"), "moustache": f.get("moustache")},
        "hats": list(k.hats), "pieces": [pc.name for pc in b["pieces"]],
        "held": [{"model": m, "socket": s, "note": n} for m, s, n in k.held],
        "shapeKeys": {"hands_hard": k.hands_hard},
        "avoid": k.avoid, "triangles": {"lod0": b["counts"]["lod0"], "lod1": b["counts"]["lod1"]},
        "pieceTriangles": b["piece_counts"],
        "note": k.note,
    }
