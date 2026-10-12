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
7. UVs into the atlas cells, the clothes joined into the body's two meshes, hats made to follow the face shapes.
"""

import os

import numpy as np

from . import SHOTS
from . import atlas as at
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
    """The kind's face from its one setting. Today it is B's: a look drawn from the seed (face_paint.look_for, with
    the setting's own values over it), the hair style, and the face-shape mix by seed (head.face_mix). A new face
    package changes this one function (and the kinds' face settings), nothing else."""
    from . import face_paint as fp
    from . import hair
    from . import head as hd

    f = kind.face
    lk = fp.look_for(f["seed"], f.get("sex", "f" if P["female"] else "m"), f.get("age", 35), **f.get("look", {}))
    if kind.hair is not None:
        st = dict(kind.hair)
        hl = {"crop": "crop", "side": "side", "bald": "bald", "long": "crop"}.get(st.get("hair"), "parted")
        if st.get("fringe"):
            hl = "fringe"
        st["paint"] = dict(hairline=f.get("look", {}).get("hairline", hl), beard=st.get("beard"),
                           moustache=st.get("moustache"))
    else:
        st = hair.style_for(f["seed"], lk, P)
    lk.update(st["paint"])
    mix = f.get("mix") if "mix" in f else hd.face_mix(f["seed"])
    return lk, st, mix


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


def join(target, src):
    import bpy

    for o in bpy.context.selected_objects:
        o.select_set(False)
    src.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.join()


def paint_body(b, kind, look, size):
    """The kind's body picture (A's skin through the position map, B's hands, the kind's extras), at size."""
    from . import hands

    P = b["P"]
    pos, nrm, part, names = paint.position_map(b["lod0"], size, b["vparts"])
    rgb = paint.paint_skin(pos, nrm, part, names, P, female=P["female"])
    # A's skin colour to the kind's own (its face's tone)
    from . import face_paint as fp
    src = np.array((0.80, 0.63, 0.53) if not P["female"] else (0.83, 0.67, 0.58), np.float32)
    rgb = np.clip(rgb * (fp.skin_rgb(look) / src), 0, 1)
    hgt = np.zeros(rgb.shape[:2], np.float32)
    rgb, hgt = hands.paint_hands(rgb, hgt, pos, part, names, P, hard=kind.hands_hard)
    if kind.skin is not None:
        has = part >= 0
        pn = np.array(names + [""])
        pname = pn[np.where(has, part, len(names))]
        idx = np.nonzero(has)
        ctx = ck.Ctx(pos[idx].astype(np.float64), nrm[idx].astype(np.float64), np.zeros(len(idx[0]), bool), None,
                     None, rgb[idx].copy(), hgt[idx].astype(np.float64), 7)
        ctx.part = pname[idx]
        ctx.P = P
        kind.skin(ctx)
        rgb[idx] = ctx.rgb
        hgt[idx] = ctx.h
    rgb = paint.dilate(rgb, part >= 0)
    nmap = hands.normal_from_height(hgt, pos, part >= 0)
    return rgb, nmap


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
    has = part >= 0
    rgb = paint.dilate(rgb, has)
    nmap = hands.normal_from_height(hgt.astype(np.float32), pos, has)
    return rgb, nmap


def build(kind, make_body, ref_uv, layout, atl, tex=2048, log=print):
    """Make one kind. make_body: build_people2.make_body. Returns the body dict (like the base bodies') with the
    kind's extras."""
    from . import body as bd
    from . import face_paint as fp

    base = {n: (bb, bl) for n, bb, bl in bd.BODIES}[kind.body]
    P0 = bd.params(*base)
    look, style, mix = face_of(kind, P0)
    b, _ = make_body(kind.name, base[0], base[1], ref_uv, style=style)
    bake_shapes(b["lod0"], mix)
    import bpy
    bpy.context.view_layer.update()
    b["vparts"] = wt.parts(b["lod0"])
    fit = ck.Fit(b)
    # the pictures of the body and the face
    rgb, nmap = paint_body(b, kind, look, tex)
    atl.put("body_" + kind.name, rgb, nmap)
    fsz = 1024 if kind.hero else 512
    frgb, _, fnrm = fp.paint(look, fsz)
    atl.put("face_" + kind.name, frgb, fnrm)
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
        scales["in_" + pc.name] = 0.3 * pc.scale
    ck.unwrap(cage, scales, margin=0.004)
    near = lod.subdivide(cage, kind.name + "_clothes_lod0")
    ck.to_limit_keep_creases(cage)
    for ob in (near, cage):
        limit4(ob)
    crgb, cnrm = paint_clothes(near, pieces, fit, tex)
    atl.put("cloth_" + kind.name, crgb, cnrm)
    if os.environ.get("PEOPLE2_SHOTS_CELLS"):
        paint.to_image("cloth_" + kind.name, crgb, os.path.join(SHOTS, "cloth_%s.png" % kind.name))
    # the body under the clothes
    cut0 = ck.cut_body(b["lod0"], kind.covers)
    cut1 = ck.cut_body(b["lod1"], kind.covers)
    # UVs into the atlas
    at.remap_uv(b["lod0"], layout["body_" + kind.name], layout["face_" + kind.name])
    at.remap_uv(b["lod1"], layout["body_" + kind.name], layout["face_" + kind.name])
    at.remap_uv(near, layout["cloth_" + kind.name])
    at.remap_uv(cage, layout["cloth_" + kind.name])
    for ob in (near, cage):
        ob.parent = b["ao"]
        m = ob.modifiers.new("rig", "ARMATURE")
        m.object = b["ao"]
    join(b["lod0"], near)
    join(b["lod1"], cage)
    ck.follow_face_shapes(b["lod0"], set(kind.hats))
    b["vparts"] = wt.parts(b["lod0"])
    b["cparts"] = wt.parts(b["lod1"])
    b["kind"] = kind
    b["look"] = look
    b["style"] = style
    b["mix"] = mix
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
    st = b["style"]
    return {
        "group": k.group, "body": k.body, "sex": "f" if P["female"] else "m", "height": round(P["H"], 3),
        "hipsBone": round(float(b["J"]["hips"][0][1]), 4), "hero": k.hero,
        "face": _rounded(k.face), "faceMix": b["mix"],
        "hair": {"hair": st.get("hair"), "beard": st.get("beard"), "moustache": st.get("moustache")},
        "hats": list(k.hats), "pieces": [pc.name for pc in b["pieces"]],
        "held": [{"model": m, "socket": s, "note": n} for m, s, n in k.held],
        "shapeKeys": {"hands_hard": k.hands_hard},
        "avoid": k.avoid, "triangles": {"lod0": b["counts"]["lod0"], "lod1": b["counts"]["lod1"]},
        "note": k.note,
    }
