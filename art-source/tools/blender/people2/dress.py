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
from .cloth_lod import from_near
from .clothes_build import tuck as tuck_finished


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


# the near copy's budget for body and clothes together (MakeHuman's face keeps its density; the clothes get what the
# cut body leaves: about 8,500 for the crowd), the named cast more, the far copy (from 15 m, mirrors, the lantern
# shadow) about a sixth (docs/people.md "Clothes: high detail")
NEAR_CROWD, NEAR_HERO, FAR = 14000, 16000, 2500


def reduce_cloth(ob, budget):
    """Compatibility entry for scoped garment modules authored before clothes_build."""
    from . import clothes_build
    return clothes_build.reduce(ob, budget)


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


def paint_body(b, kind, rect, size=1024, under=None):
    """The kind's body picture (MakeHuman's skin with the sun on the hands and neck, and the kind's own extras: socks,
    stockings, grime), painted straight into its rectangle of the kind's layer. under: (garment tree, face pieces,
    looks): the skin under the garments painted as their shadowed lining by the ray test (clothes_build.under_cloth),
    after the kind's own extras."""
    from . import mhskin
    from . import clothes_build as cb

    class _K:
        pass
    k2 = _K()
    k2.__dict__.update(kind.__dict__)

    def skin(ctx):
        ctx.paint_clothing_on_skin = False
        if kind.skin is not None:
            kind.skin(ctx)
        if under is not None:
            paint_body.under = cb.under_cloth(ctx, *under)
    k2.skin = skin
    rgb, nmap, zones = mhskin.body_picture(b, picture_group(b["P"]), size=size, rect=rect, underwear=False, kind=k2)
    paint_body.zones = zones
    return rgb, nmap


def thicken_far(ob, extra=0.004):
    """(#138) The far copy's reduction is coarse for cloth 2-3 mm thick: its lining crossed the outer side and showed
    (a forced far copy close up). The lining's points go `extra` deeper inside (along their own normals, which face
    the body); the rims stretch with them."""
    raw = wt.parts(ob)
    me = ob.data
    me.update()
    n = 0
    for v in me.vertices:
        if (raw[v.index] or "").startswith("in_"):
            v.co = v.co + v.normal * extra
            n += 1
    me.update()
    return n


SIT_PIECES = ("skirt", "overskirt", "flounce", "habit_skirt", "apron")


def sit_key(ob, b, first):
    """(#138) The near copy's live `sit` shape (the game sets it while the person sits): seated, a skirt or an apron
    below the knees went with the shins as a round drum (a barrel round the lower legs); with the shape its sides and
    back fall in toward the legs and the front hangs straight from the knees, as cloth falls over the seat's edge. In
    rest space (below the knee the cloth rides the shins, which hang upright in every seat). Returns the points it
    moves (none: no key)."""
    me = ob.data
    raw = wt.parts(ob)
    knee = float(b["J"]["legLowL"][0][1])
    hip_y = float(b["J"]["legUpL"][0][1])
    hip_x = abs(float(b["J"]["legUpL"][0][0]))
    zc = float(b["J"]["legUpL"][0][2])  # the thighs' line, front to back
    co = np.array([toG(v.co) for v in me.vertices])
    move = np.zeros_like(co)
    for i in range(first, len(co)):
        pc = (raw[i] or "").removeprefix("in_")
        if not pc.startswith(SIT_PIECES):
            continue
        x, y, z = co[i]
        z = z - zc
        # over the lap (hips to knees): the front lies down on the thighs instead of standing 10 cm over them
        fa = float(np.clip((hip_y - 0.04 - y) / (hip_y - 0.04 - knee), 0, 1))
        fa = fa * fa * (3 - 2 * fa)
        dz = -0.45 * fa * max(0.0, z - 0.075) if y > knee else 0.0  # (55% of the gap between layers kept)
        # below the knees: the sides and back fall in to the legs, the front hangs straight, the hem a little lower
        f = float(np.clip((knee + 0.03 - y) / 0.30, 0, 1))
        f = f * f * (3 - 2 * f)
        legs = hip_x + 0.035  # the shins' outer line
        dx = -np.sign(x) * 0.7 * f * max(0.0, abs(x) - legs)
        dz += 0.8 * f * max(0.0, -z - 0.03) - 0.6 * f * max(0.0, z - 0.10)
        dy = -0.03 * f
        move[i] = (dx, dy, dz)
    n = int(np.count_nonzero(np.abs(move).sum(1) > 1e-5))
    if not n:
        return 0
    if not me.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    kb = ob.shape_key_add(name="sit", from_mix=False)
    basis = me.shape_keys.key_blocks[0]
    from . import B
    for i in np.nonzero(np.abs(move).sum(1) > 1e-5)[0]:
        kb.data[int(i)].co = basis.data[int(i)].co + B(*move[i])
    return n


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


def fill_nearest(ids, has, steps=14):
    """Whole-number labels grown outward into the empty texels from the nearest labelled one (no averaging)."""
    s, m = ids.copy(), has.copy()
    for _ in range(steps):
        new = np.zeros_like(m)
        val = s.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                take = (~m) & np.roll(np.roll(m, dy, 0), dx, 1) & ~new
                val[take] = np.roll(np.roll(s, dy, 0), dx, 1)[take]
                new |= take
        s, m = val, m | new
    return s


def paint_clothes(ob, pieces, fit, size, seed=3, layer=False):
    """The cloth picture: every piece painted where its texels are (part_<piece>, part_in_<piece>). layer: the UVs
    are already in the 1024 px layer's coordinates (clothes_build.unwrap): paint the whole layer at `size` (2048: twice
    over, then filtered down) and return it at 1024 with its zones, for Pictures.put(placed=True)."""
    from . import hands
    from . import clothes_build as cb
    from .atlas import down_normals

    vparts = wt.parts(ob)
    zg = {g.index: g.name[5:] for g in ob.vertex_groups if g.name.startswith("zone_")}
    vz = []
    for v in ob.data.vertices:
        z = ""
        for g in v.groups:
            if g.group in zg and g.weight > 0.5:
                z = zg[g.group]
        vz.append(z)
    names_of = [(p or "") + "|" + z for p, z in zip(vparts, vz)]
    xv = {}
    if layer:
        cb.edge_layer(ob)
        pos, nrm, part, names, xv = cb.position_map(ob, size, size, names_of, extra=("fabric", "_edge"))
    else:
        pos, nrm, part, names = paint.position_map(ob, size, names_of)
    rgb = np.zeros(pos.shape[:2] + (3,), np.float32) + 0.4
    hgt = np.zeros(pos.shape[:2], np.float64)
    pn = np.array([n.split("|")[0] for n in names] + [""])
    zn = np.array([n.split("|")[1] for n in names] + [""])
    pname = pn[np.where(part >= 0, part, len(names))]
    zname = zn[np.where(part >= 0, part, len(names))]
    slots = np.zeros(pos.shape[:2], np.uint8)  # the player's colour slot of every texel (kinds_player.py), 0: fixed
    for k, pc in enumerate(pieces):
        m_out = pname == pc.name
        m_in = pname == "in_" + pc.name
        m = m_out | m_in
        if not m.any():
            continue
        slots[m] = getattr(pc, "slot_id", 0)
        idx = np.nonzero(m)
        ctx = ck.Ctx(pos[idx].astype(np.float64), nrm[idx].astype(np.float64), m_in[idx], pc, fit,
                     np.zeros((len(idx[0]), 3), np.float32), np.zeros(len(idx[0])), seed + 31 * k)
        ctx.zone = zname[idx]
        fab = xv.get("fabric")
        ctx.fu = fab[idx][:, 0].astype(np.float64) if fab is not None else ctx.x
        ctx.fv = fab[idx][:, 1].astype(np.float64) if fab is not None else ctx.y
        ctx.edge = xv["_edge"][idx][:, 0].astype(np.float64) if "_edge" in xv else np.ones(len(idx[0]))
        ck.paint_cloth(ctx)
        rgb[idx] = np.clip(ctx.rgb, 0, 1)
        hgt[idx] = ctx.h
    zones = np.zeros(pos.shape[:2], np.float32)
    for pc in pieces:
        zone = at.ZONES.get(pc.cloth.kind, 1 if pc.cloth.kind in ("felt", "corduroy") else 2 if pc.cloth.kind == "cotton" else 0)
        zones[(pname == pc.name) | (pname == "in_" + pc.name)] = zone
    has = part >= 0
    nmap = hands.normal_from_height(hgt.astype(np.float32), pos, has)
    if layer:
        # filtered down to the layer's size where the cloth is, grown outward into the gaps between islands
        while rgb.shape[0] > at.SIZE:
            cov = cb.down2(has.astype(np.float32)[..., None])[..., 0]
            rgb = cb.down2(rgb * has[..., None]) / np.maximum(cov, 1e-6)[..., None]
            nmap = down_normals(np.where(has[..., None], nmap, np.array((0.5, 0.5, 1.0), np.float32)))
            zones = np.where(cov > 0, cb.down2(zones[..., None] * has[..., None])[..., 0] / np.maximum(cov, 1e-6), 0)
            zones = np.round(zones)
            slots = slots[::2, ::2]
            has = cov > 0.24
    paint_clothes.zones = paint.dilate(zones[..., None].astype(np.float32), has)[..., 0]
    paint_clothes.slots = fill_nearest(slots, has)
    rgb = paint.dilate(rgb.astype(np.float32), has, steps=14)
    nmap = paint.dilate(nmap.astype(np.float32), has, steps=14)
    return rgb, nmap


# (under, over) for every kind that has both pieces (see build: the layers)
SKIRT_UNDER = {(sk, up) for sk in ("skirt", "overskirt", "flounce") for up in ("coat", "jacket", "smock", "coat_collar",
                                                                            "apron")}


def build(kind, make_body, ref_uv, layout, atl, tex=2048, log=print):
    """Make one kind (docs/people.md "How a kind is made"). make_body: build_people2.make_body. Returns the body dict
    (like the base bodies') with the kind's extras."""
    from . import body as bd
    from . import clothes_build as cb

    base = {n: (bb, bl) for n, bb, bl in bd.BODIES}[kind.body]
    P0 = bd.params(*base)
    face = face_of(kind, P0)
    b, _ = make_body(kind.name, base[0], base[1], ref_uv)
    import bpy
    bpy.context.view_layer.update()
    b["vparts"] = wt.parts(b["lod0"])
    fit = ck.Fit(b)
    # the garments: one cage, subdivided once (the near copy), on its limit surface (the far copy)
    pieces = kind.dress(fit)
    from .cloth_fit import sleeve_binding
    bind_sleeves = sleeve_binding(b["lod0"]) if any(p.name == "bodice" for p in pieces) else None
    if fit.P['old'] and fit.P['female']:
        from .cloth_fit import fit_old_shawl
        pieces = fit_old_shawl(fit, pieces)
    log("[people2]   %s pieces (near triangles): %s" % (kind.name, ", ".join(
        "%s %d (%d faces, %d inner)" % (pc.name, sum(8 if len(f) == 4 else 6 for f in pc.F), len(pc.F),
                                        sum(1 for f in pc.F if all(pc.inner[v] for v in f))) for pc in pieces)))
    cage, _ = ck.build_objects(pieces, kind.name + "_clothes_lod1")
    near = lod.subdivide(cage, kind.name + "_clothes_lod0")
    ck.to_limit_keep_creases(cage)
    for ob in (near, cage):
        limit4(ob)
    # folds, seams and bunching in relief where they change the silhouette (near copy only)
    nrel = cb.relief(near, pieces, fit)
    log("[people2]   %s islands before the reduction (islands, not disks, edges on 3+ faces): near %s far %s" % (
        kind.name, cb.island_census(near), cb.island_census(cage)))
    # Rest-pose occlusion is not a clothing mask: an open coat moves away from its waistcoat when posed.
    # Cutting both the supposedly hidden garment and the skin below it left a view straight through the person.
    # Keep complete garments, then reduce them to the same budgets and separate their surfaces below.
    h0, h1 = {}, {}
    cut0 = ck.cut_body(b["lod0"], kind.covers, near)
    cut1 = ck.cut_body(b["lod1"], kind.covers, cage)
    log("[people2]   %s relief on %d points; hidden layers deleted near %s, far %s" % (kind.name, nrel, h0, h1))
    # which piece lies over which, read before the reduction; after it, every layer is put back under the next
    order0, order1 = ck.layer_order(near), ck.layer_order(cage)
    told = set(getattr(kind, "layers", ()))  # (under, over) the kind states: they win over the rays' votes
    # (#138) a skirt is always under a jacket, coat, smock or apron worn over it: where a full skirt flares out past
    # the jacket's skirts the rays voted the other way round, and the skirt showed through the jacket
    names = {pc.name for pc in pieces}
    if {'bodice', 'shawl'} <= names:
        told.add(('bodice', 'shawl'))

    told |= {(u, o) for (u, o) in SKIRT_UNDER if u in names and o in names and (o, u) not in told}
    order0 = {p for p in order0 if (p[1], p[0]) not in told} | told
    order1 = {p for p in order1 if (p[1], p[0]) not in told} | told
    s0, s1 = cb.clean_sleeves(near, b["P"]), cb.clean_sleeves(cage, b["P"])
    log("[people2]   %s sleeve points on their own arm only: near %d, far %d" % (kind.name, s0, s1))
    f0, f1 = cb.follow_under(near, order0), cb.follow_under(cage, order1)
    log("[people2]   %s points following the layer under them: near %d, far %d" % (kind.name, f0, f1))
    before = {"lod0": cb.tris(near), "lod1": cb.tris(cage)}
    budget0 = (getattr(kind, "near_budget", None) or (NEAR_HERO if kind.hero else NEAR_CROWD)) - lod.tris(b["lod0"])
    budget1 = (getattr(kind, "far_budget", None) or FAR) - lod.tris(b["lod1"])
    shared_apron = {'skirt', 'apron'} <= names
    cb.reduce(near, budget0 - (2400 if shared_apron else 0), weights=kind.reduce_weights(near) if getattr(kind, "reduce_weights", None) else None)
    cb.reduce(cage, budget1 - (800 if shared_apron else 0), weights=cb.protect_weights(cage, seam=0.4, rim=0.35))
    thicken_far(cage)
    m0 = ck.clear_layers(near, b["lod0"], order0, clearance=0.0035, passes=3, body_clearance=0.005)
    m1 = ck.clear_layers(cage, b["lod1"], order1, clearance=0.004, body_clearance=0.006)
    # the reduced garments cut corners over curves (a shoulder): what pokes out is tucked back under, and skin that
    # still lies outside them goes
    m0 += cb.tuck(near, b["lod0"], order0, kind.covers)
    m1 += cb.tuck(cage, b["lod1"], order1, kind.covers, clearance=0.005, body_clearance=0.006)
    from .cloth_fit import finish_ease
    finish_ease(near)
    finish_ease(cage)
    from .cloth_drape import skirt_weights, skirt_bends, apron_surface
    for ob, budget in ((near, budget0), (cage, budget1)):
        if shared_apron:
            skirt_bends(ob, fit)
            skirt_weights(ob, fit)
        for _ in range(4):
            tuck_finished(ob, None, {("skirt", "coat")}, kind.covers,
                          clearance=0.035, reach=0.15, agree=0.3)
        if shared_apron:
            apron_surface(ob)
            # This far cage is only a fitting intermediate; from_near below
            # replaces it with the reduced, painted near surface. Its final
            # combined body/cloth budget is checked after masks and binding.
            if ob == near and cb.tris(ob) > budget:
                raise ValueError(f'Shared apron exceeds garment budget: {ob.name}, {cb.tris(ob)} > {budget}')
    cut0 += ck.cut_body(b["lod0"], kind.covers, near)
    cut1 += ck.cut_body(b["lod1"], kind.covers, cage)
    from .cloth_fit import apron_edges, coat_apron_ease
    apron_edges(near)
    apron_edges(cage)
    coat_apron_ease(near)
    coat_apron_ease(cage)
    log("[people2]   %s layers: %s; points put back under the layer over them: %d near, %d far" % (
        kind.name, ", ".join("%s<%s" % (a, c) for a, c in sorted(order0)), m0, m1))
    # UVs after the reduction, straight into the kind's clothes rectangle; the picture painted on them
    log("[people2]   %s islands after the reduction: near %s" % (kind.name, cb.island_census(near)))
    cuts = cb.fix_islands(near, log=log)
    scales = {}
    for pc in pieces:
        scales[pc.name] = pc.scale
        # the insides and the rims (hems, cuffs, brims' edges) at the cloth's own density too (the owner's rule of
        # 2026-10-13: no stretched or blurred small sides)
        scales["in_" + pc.name] = pc.scale
    if getattr(kind, "uv_boost", None):  # more texels for some islands (the player's sleeves: kinds_player.py)
        scales["__island__"] = kind.uv_boost(near)
    density, share = cb.unwrap(near, layout["cloth_" + kind.name], scales, log=log)
    bad, worst = cb.stretch(near)
    log("[people2]   %s UVs after the reduction: %d cuts added, %.0f px/m, %.1f%% of triangles stretched over 2:1 "
        "(worst %.1f)" % (kind.name, cuts, density, 100 * bad, worst))
    crgb, cnrm = paint_clothes(near, pieces, fit, 1024 * max(1, tex // 1024), layer=True)
    atl.put("cloth_" + kind.name, crgb, cnrm, placed=True)
    atl.clothes_zones("cloth_" + kind.name, paint_clothes.zones)
    if os.environ.get("PEOPLE2_SHOTS_CELLS"):
        paint.to_image("cloth_" + kind.name, crgb, os.path.join(SHOTS, "cloth_%s.png" % kind.name))
    from_near(cage, near, (getattr(kind, "far_budget", None) or FAR) - lod.tris(b["lod1"]), b["lod1"])
    for ob in (near, cage):
        cb.drop_layers(ob)
        flags(ob)
    # Skin revealed by a bent sleeve stays skin; a rest-pose cloth stain is not a lining.
    rgb, nmap = paint_body(b, kind, layout["body_" + kind.name])
    atl.put("body_" + kind.name, rgb, nmap, placed=True)
    atl.clothes_zones("body_" + kind.name, paint_body.zones)
    b["piece_counts"] = {"lod0": piece_counts(near), "lod1": piece_counts(cage)}
    b["cloth_checks"] = {"before": before, "density": round(density), "rectShare": round(share, 3),
                         "stretched2": round(bad, 4), "worstStretch": round(worst, 2), "islandCuts": cuts,
                         "hiddenDeleted": {"lod0": h0, "lod1": h1}, "reliefPoints": nrel}
    log("[people2]   %s final clothes near/far: %s / %s" %
        (kind.name, b["piece_counts"]["lod0"], b["piece_counts"]["lod1"]))
    # UVs of the body into this kind's clothes layer and full-square face
    at.remap_uv(b["lod0"], layout["body_" + kind.name], layout["face_" + kind.name])
    at.remap_uv(b["lod1"], layout["body_" + kind.name], layout["face_" + kind.name])
    for ob in (near, cage):
        ob.parent = b["ao"]
        m = ob.modifiers.new("rig", "ARMATURE")
        m.object = b["ao"]
    n0, n1 = len(b["lod0"].data.vertices), len(b["lod1"].data.vertices)
    join(b["lod0"], near)
    join(b["lod1"], cage)
    clothes_keys(b["lod0"], b, n0, 0)
    clothes_keys(b["lod1"], b, n1, 1)
    sk_n = sit_key(b["lod0"], b, n0)
    from .cloth_fit import bind_apron, finish_wrap
    if bind_sleeves:
        bind_sleeves(b["lod0"])
        bind_sleeves(b["lod1"])
    bind_apron(b["lod0"])
    bind_apron(b["lod1"])
    finish_wrap(b["lod0"])
    finish_wrap(b["lod1"])
    from .cloth_masks import covered_hat_scalp
    covered_hat_scalp(b["lod0"], kind.hats)
    covered_hat_scalp(b["lod1"], kind.hats)
    for level, ceiling in (("lod0", getattr(kind, "near_budget", None) or (NEAR_HERO if kind.hero else NEAR_CROWD)),
                           ("lod1", getattr(kind, "far_budget", None) or FAR)):
        if lod.tris(b[level]) > ceiling:
            raise ValueError(f"Final body/cloth budget exceeded: {kind.name} {level}, {lod.tris(b[level])} > {ceiling}")
    if sk_n:
        log("[people2]   %s sit shape: %d points of skirt and apron" % (kind.name, sk_n))
    # baked occlusion over body and clothes (vertex colour blue; clothes_build.AO_RULE)
    through = getattr(kind, "ao_through", False)  # kinds_player: no resting-arm shapes in the bake
    ao0 = cb.bake_occlusion(b["lod0"], b["P"], through=through)
    ao1 = cb.bake_occlusion(b["lod1"], b["P"], through=through)
    b["cloth_checks"]["occlusion"] = {"lod0": [round(x, 3) for x in ao0], "lod1": [round(x, 3) for x in ao1]}
    b["vparts"] = wt.parts(b["lod0"])
    b["cparts"] = wt.parts(b["lod1"])
    b["kind"] = kind
    b["face"] = face
    b["pieces"] = pieces
    b["fit"] = fit
    b["counts"]["lod0"] = lod.tris(b["lod0"])
    b["counts"]["lod1"] = lod.tris(b["lod1"])
    log("[people2] kind %s on %s: %d / %d triangles (clothes before the reduction %d / %d; body faces cut %d / %d), "
        "%d pieces" % (kind.name, kind.body, b["counts"]["lod0"], b["counts"]["lod1"], before["lod0"], before["lod1"],
                        cut0, cut1, len(pieces)))
    return b


def flags(ob):
    """The vertex colours every people2 mesh carries (picture_flags: red the eye, green the face square, blue the
    baked occlusion, alpha 1); garments start with none of them set."""
    me = ob.data
    attr = me.color_attributes.get("picture_flags")
    if attr is None:
        attr = me.color_attributes.new(name="picture_flags", type="FLOAT_COLOR", domain="CORNER")
        rgba = np.zeros((len(me.loops), 4), np.float32)
        rgba[:, 2] = 1
        rgba[:, 3] = 1
        attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr


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
        "clothChecks": b.get("cloth_checks", {}),
        "note": k.note,
    }
