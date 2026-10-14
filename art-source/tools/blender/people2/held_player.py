"""The player's hats and shoes (docs/people.md "The player"): one rigid model each, on a socket, never part of a kind.

The kinds (kinds_player.py) carry the clothes of the character screen's coat, shirt, vest, lower and apron choices; the
hat and the shoes are separate models so any hat and any shoe go with any cut:

    jef_hat_flatcap, jef_hat_knitcap, jef_hat_bowler, jef_hat_tophat     men      socket headTop
    jef_hat_bonnet, jef_hat_whitecap, jef_hat_headscarf                  women    socket headTop
    jef_boots_m_L/R, jef_clogs_m_L/R, jef_boots_f_L/R, jef_clogs_f_L/R  both     the bones footL and footR

Frames: a hat's origin is the headTop socket of its sex's body (man_middling, woman_middling), its axes the body's at
rest; a shoe's origin is its foot bone's head and its axes the bone's at rest (export.bone_frame), so a model put on
the bone node (BoneAttachment3D) sits on the foot with no offset. Rigid: a clog is wood and a boot's sole is stiff.
They are meshes under the people2_held node, painted in their own picture layer, `people2_held_jef` (the left half of
the layer is the men's, the right half the women's), with the tint pack of the layer (kinds_player.py).

A hat was fitted to the sex's base head; the runtime scales it with the head sliders (peopleRig.json player.hatFit).
"""
import copy
import math

import numpy as np

from . import B, G, SHOTS
from . import body as bd
from . import clothes_kit as ck
from . import garments_cast as gc
from . import garments_player as gp
from . import garments_women as gw
from . import kinds_workers as kwk
from . import kinds_women2 as kw2
from .clothes_kit import Cloth, hexrgb, sm

HATS = {"m": ["flatcap", "knitcap", "bowler", "tophat"], "f": ["bonnet", "whitecap", "headscarf"]}
RECT = {"m": (0, 0, 512, 1024), "f": (512, 0, 512, 1024)}
# triangle budgets per model after the reduction (the kinds' own boots, soles and caps came to about these)
BUDGET = {"flatcap": 900, "knitcap": 1300, "bowler": 1600, "tophat": 1600, "bonnet": 1500, "whitecap": 1700,
          "headscarf": 1500, "shoe": 560}
ROOM = {"bonnet": 0.005, "whitecap": 0.005, "headscarf": 0.005}  # more room over the women's hair (bun, undercap)
HAT_COLOUR = {"flatcap": 0x38383a, "knitcap": 0x38383a, "bowler": 0x1a1a1c, "tophat": 0x1a1a1c, "bonnet": 0xe2ded2,
              "whitecap": 0xe2ded2, "headscarf": 0x8a3e32}


def _hat(name, piece_name, cloth, scale=1.2):
    pc = gp.mk(name + piece_name, "hat", cloth, scale=scale, hat=True)
    return pc


def _cap_paint(ctx):
    """The crown's eight panels meeting at a button on top, the band seamed (kinds_workers._cap_extra)."""
    c = np.arctan2(ctx.x, ctx.z - ctx.piece.meta.get("centre_z", 0.0))
    pan = np.abs(((c / (2 * math.pi) * 8) % 1.0) - 0.5)
    band = ctx.piece.meta["band_top"]
    top = sm(0.0, 0.03, ctx.y - band)
    ck.seam_line(ctx, np.where(top > 0.3, (0.5 - pan) * 0.06, 1.0), width=0.0008, stitches=False)
    ck.seam_line(ctx, ctx.y - band, width=0.0008)
    ctx.mix(sm(0.006, 0.0, np.linalg.norm(ctx.pos - ctx.piece.meta["top"], axis=1)) * 0.9, (0.16, 0.14, 0.12))


def flatcap(fit):
    col = hexrgb(HAT_COLOUR["flatcap"])
    cap = _hat("flatcap", "", Cloth(col, "wool", wear=0.45, dust=0.2, folds=0.5, extra=_cap_paint), 1.3)
    peak = _hat("flatcap", "_peak", Cloth(col, "felt", wear=0.5, folds=0.0), 1.3)
    ids, _ = ck.flat_cap(fit, cap, peak, puff=0.014, fwd=0.016)
    cap.meta["band_top"] = float(np.array(cap.V)[ids[1]][:, 1].mean())
    cap.meta["top"] = np.array(cap.V)[ids.max() + 1]
    ck.thicken(cap, 0.0025, depth=0.03)
    ck.thicken(peak, 0.004, depth=None, crease=0.1)
    return [cap, peak]


def cast_hat(fit, style):
    """garments_cast.round_hat (a knitted cap, a bowler, a tall hat), tagged with the hat slot."""
    pieces = gc.round_hat(fit, HAT_COLOUR[style], style)
    out = []
    for pc in pieces:
        pc.name = style + ("" if pc.name == "cap" else pc.name[3:])
        pc.slot, pc.slot_id = "hat", gp.SLOT_ID["hat"]
        out.append(pc)
    return out


def solid_hat(fit, style):
    """A bowler or a tall hat as one surface: the brim's outer edge (rolled up a little), its underside's line in to the
    band, the crown's wall and top (the profile of a hat, swept round the head), so crown and brim are one piece
    with no gap between them. Fitted to the head by slices (clothes_kit.head_support)."""
    P = fit.P
    c, top = ck.head_axis(fit)
    chin = bd.Y(P, 0.870)
    band_y = chin + P["hs"] * 0.132
    n = 28
    a = np.arange(n) * 2 * math.pi / n
    r0 = ck.head_support(fit, band_y, a) + 0.016
    col = hexrgb(HAT_COLOUR[style])
    pc = _hat(style, "", Cloth(col, "felt", wear=0.25, folds=0.15, lining=tuple(np.array(col) * 0.8)), 1.2)
    width = 0.034 if style == "bowler" else 0.030
    if style == "tophat":
        walls = [(band_y + 0.004, 1.0), (band_y + 0.020, 1.012), (top + 0.045, 0.975), (top + 0.098, 0.955),
                 (top + 0.108, 0.93), (top + 0.1115, 0.5)]
    else:
        walls = [(band_y + 0.004, 1.0), (band_y + 0.016, 1.035), (band_y + 0.040, 1.04), (top - 0.018, 1.0),
                 (top + 0.014, 0.84), (top + 0.029, 0.45)]
    rows = []
    # the brim: its edge rolled up, falling to the band
    curl = 0.007 + 0.006 * np.cos(a) ** 2 * (1 if style == "bowler" else 0)
    rows.append(np.stack((c[0] + (r0 + width) * np.sin(a), band_y + curl - 0.002, c[2] + (r0 + width) * np.cos(a)), -1))
    rows.append(np.stack((c[0] + (r0 + 0.6 * width) * np.sin(a), band_y - 0.003 + 0.5 * curl, c[2] + (r0 + 0.6 * width) * np.cos(a)), -1))
    rows.append(np.stack((c[0] + (r0 + 0.2 * width) * np.sin(a), np.full(n, band_y - 0.002), c[2] + (r0 + 0.2 * width) * np.cos(a)), -1))
    for y, k in walls:
        rows.append(np.stack((c[0] + r0 * k * np.sin(a), np.full(n, y), c[2] + r0 * k * np.cos(a)), -1))
    ids = pc.grid(np.array(rows), ck.hat_weights, closed=True, seam_col=n // 2)
    centre = pc.add((c[0], walls[-1][0] + 0.002, c[2]), ck.hat_weights(None))
    for j in range(n):
        pc.face((ids[-1, j], ids[-1, (j + 1) % n], centre))
    pc.seam(ids[-1, n // 2], centre)
    # one grid, one winding: turn the whole surface if its crown wall faces inward
    k = 3 * n + n // 3  # a wall face (from the first wall row to the second)
    V = np.array(pc.V)
    f = pc.F[k]
    nrm = np.zeros(3)
    for m in range(len(f)):
        nrm += np.cross(V[f[m]], V[f[(m + 1) % len(f)]])
    mid = V[list(f)].mean(0)
    if np.dot(nrm, np.array((mid[0] - c[0], 0.0, mid[2] - c[2]))) < 0:
        pc.F = [tuple(reversed(g)) for g in pc.F]
    pc.meta.update(band_y=band_y)
    ck.thicken(pc, 0.0026, depth=None, crease=0.05)
    return [pc]


def bonnet(fit):
    """A small felt bonnet worn back on the head, tied under the chin with two ribbons."""
    col = hexrgb(HAT_COLOUR["bonnet"])
    cap = _hat("bonnet", "", Cloth(col, "felt", wear=0.2, folds=0.2, lining=(0.7, 0.68, 0.64)), 1.4)
    ck.hood_cap(fit, cap, margin=0.016, front=-12.0, back=110.0, side=104.0, cols=13, rows=9)
    ck.thicken(cap, 0.0022, depth=0.02)
    ties = _hat("bonnet", "_ties", Cloth(col, "cotton", wear=0.1, folds=0.0), 1.4)
    Y = lambda f: bd.Y(fit.P, f)
    for sign in (-1, 1):
        ck.strap_grid(fit, ties, [(sign * 0.075, Y(0.91), 0.025), (sign * 0.055, Y(0.867), 0.07),
                                  (sign * 0.01, Y(0.851), 0.08)], [0.014, 0.016, 0.013], 0.012, cols=3, rows=5,
                      wfn=ck.hat_weights, parts=("head", "neck"))
    ck.thicken(ties, 0.0015, depth=None)
    return [cap, ties]


def whitecap(fit):
    """The women's linen cap with a goffered frill, tied under the chin (wife_a's)."""
    cap = _hat("whitecap", "", Cloth(hexrgb(0xe2ded2), "linen", wear=0.15, extra=kw2._linen_white, folds=0.3), 1.3)
    brim = _hat("whitecap", "_frill", Cloth(hexrgb(0xe2ded2), "linen", wear=0.1, extra=kw2._frill_extra, folds=0.0), 1.3)
    cid = ck.hood_cap(fit, cap, frill=brim, margin=0.015, front=-30.0, back=110.0, side=100.0, cols=13, rows=9)
    ck.thicken(cap, 0.0016, depth=0.02)
    ck.thicken(brim, 0.0011, depth=None, crease=0.06)
    tie = _hat("whitecap", "_ties", Cloth(hexrgb(0xe2ded2), "linen", wear=0.1, folds=0.0), 1.3)
    gw.ties(fit, tie, kw2.cap_corners(cap, cid))
    return [cap, brim, tie]


def headscarf(fit):
    """A cotton kerchief over the hair, knotted under the chin."""
    kc = _hat("headscarf", "", Cloth(hexrgb(HAT_COLOUR["headscarf"]), "cotton", wear=0.25, folds=0.8), 1.2)
    kn = _hat("headscarf", "_knot", Cloth(hexrgb(HAT_COLOUR["headscarf"]), "cotton", wear=0.25, folds=0.8), 1.3)
    gw.kerchief(fit, kc, tie="chin", margin=0.014, front=-44.0, knot=kn)
    ck.thicken(kc, 0.0014, depth=0.02, crease=0.06)
    ck.thicken(kn, 0.0014, depth=None, crease=0.06)
    return [kc, kn]


def hats_of(fit, sex):
    out = {}
    for h in HATS[sex]:
        out["jef_hat_" + h] = {"flatcap": flatcap, "knitcap": lambda f: cast_hat(f, "knitcap"),
                               "bowler": lambda f: solid_hat(f, "bowler"), "tophat": lambda f: solid_hat(f, "tophat"),
                               "bonnet": bonnet, "whitecap": whitecap, "headscarf": headscarf}[h](fit)
    return out


def inflate(fit, pieces, side, k):
    """A rigid shoe must hold the whole of MakeHuman's foot: scale it (x, y, z) about the foot's ankle on the ground."""
    c = np.array((float(fit.J["foot" + side][0][0]), 0.0, float(fit.J["foot" + side][0][2])))
    k = np.asarray(k)
    for pc in pieces:
        pc.V = [c + (np.asarray(v) - c) * k for v in pc.V]


def shoes_of(fit, sex):
    """Boots and clogs, a model per foot: each its own pieces on the foot's own last."""
    out = {}
    women = sex == "f"
    for S in "LR":
        bt = gp.mk("boots" + S, "boots", copy.copy(kw2.BOOT if women else _man_boot()), scale=1.2)
        so = gp.mk("soles" + S, None, copy.copy(kw2.SOLE), scale=0.8)
        if women:
            gw.boots_light(fit, bt, so, S)
        else:
            ck.shoe(fit, bt, so, S, shaft=0.135)
        inflate(fit, [bt, so], S, (1.03, 1.04, 1.02))
        out["jef_boots_%s_%s" % (sex, S)] = [bt, so]
        wood = copy.copy(kwk.WILLOW)
        top = copy.copy(kwk.CLOG_TOP)
        wd, lt = _klomp(fit, wood, top, S)
        inflate(fit, [wd, lt], S, (1.03, 1.04, 1.02))
        out["jef_clogs_%s_%s" % (sex, S)] = [wd, lt]
    return out


def _man_boot():
    from .kinds_cast import BOOT
    return BOOT


def _klomp(fit, wood, top, S):
    from . import cloth_detail as cd
    wd, lt = cd.klomp(fit, wood, top, S)
    wd.name, lt.name = "clog" + S, "clogtop" + S
    for p in (wd, lt):
        p.slot, p.slot_id = "boots", gp.SLOT_ID["boots"]
    return wd, lt


def _frame(ao, bone):
    from . import export
    head, ax = export.bone_frame(ao, bone)
    return np.array(head, np.float64), np.array(ax, np.float64)


def hat_fit(b):
    """How the head's sliders move the skull (the crown, the width and depth at the hat's band), per unit of slider:
    measured on the base body's near copy, for the runtime to scale and lift a hat (rigid: it has no morphs)."""
    import bpy
    me = b["lod0"].data
    kb = me.shape_keys.key_blocks
    base = np.array([G(v.co) for v in me.vertices])
    parts = np.array([p or "" for p in b["vparts"]])
    top = base[:, 1].max()
    m = np.isin(parts, ("head", "scalp")) & (base[:, 1] > top - 0.09)
    out = {}
    for name in ("head_tall", "head_wide", "skull_long", "face_fat", "face_round", "face_square", "face_oval",
                 "forehead_back", "brow_ridge", "face_age"):
        for key, sign in (("s_" + name, 1.0), ("s_" + name + "_neg", -1.0)):
            if key not in kb:
                continue
            co = np.array([G(v.co) for v in kb[key].data])
            d = co - base
            new = base + d
            w0, w1 = np.ptp(base[m, 0]), np.ptp(new[m, 0])
            z0, z1 = np.ptp(base[m, 2]), np.ptp(new[m, 2])
            out.setdefault(name, {})["pos" if sign > 0 else "neg"] = {
                "scale": [round(float(w1 / w0), 4), 1.0, round(float(z1 / z0), 4)],
                "lift": round(float(new[m, 1].max() - base[m, 1].max()), 4),
                "forward": round(float(d[m, 2].mean()), 4)}
    return out


def build_all(bodies, layout, atl, tex=2048, log=print):
    """Every hat and shoe model, painted into the independent held_jef layer (a half each for the sexes), as meshes
    under people2_held. Returns the objects."""
    import bmesh
    import bpy

    from . import body as bd
    from . import clothes_build as cb
    from . import dress, kinds_player as kp, lod
    from . import pictures as at
    from . import weights as wt

    root = bpy.data.objects.get("people2_held")
    if root is None:
        root = bpy.data.objects.new("people2_held", None)
        bpy.context.scene.collection.objects.link(root)
    size = 1024 * max(1, tex // 1024)
    objects = []
    layer_rgb = np.zeros((1024, 1024, 3), np.float32)
    layer_nrm = np.zeros((1024, 1024, 3), np.float32) + np.array((0.5, 0.5, 1.0), np.float32)
    F = np.zeros((1024, 1024, 3), np.float32)
    T = np.zeros((1024, 1024), np.float32)
    S = np.zeros((1024, 1024), np.uint8)
    zones = np.zeros((1024, 1024), np.float32)
    meta = {}
    for sex, body_name in (("m", "man_middling"), ("f", "woman_middling")):
        b = next((x for x in bodies if x["name"] == body_name), None)
        if b is None:
            continue
        b["vparts"] = wt.parts(b["lod0"])
        fit = ck.Fit(b)
        models = {}
        hats = hats_of(fit, sex)
        c, top = ck.head_axis(fit)
        for name, pcs in hats.items():
            room = ROOM.get(name[len("jef_hat_"):], 0.0)
            if room:  # out from the skull's middle (0.09 m below its crown), the whole hat alike
                mid = np.array((c[0], top - 0.09, c[2]))
                for pc in pcs:  # twice the room behind, over the knot of the hair
                    out_ = []
                    for v in pc.V:
                        d = np.asarray(v) - mid
                        d = d / max(np.linalg.norm(d), 1e-6)
                        out_.append(np.asarray(v) + d * room * (1.0 + max(0.0, -float(d[2]))))
                    pc.V = out_
        models.update(hats)
        models.update(shoes_of(fit, sex))
        palette = dict(gp.JEF if sex == "m" else gp.MIE)
        palette["hat"] = HAT_COLOUR["flatcap"] if sex == "m" else HAT_COLOUR["whitecap"]
        palette["boots"] = gp.JEF["boots"] if sex == "m" else 0x2a2420
        # one object per model: its cage, subdivided once and reduced to its budget
        parts_of = {}
        cages = []
        allp = []
        for name, pcs in models.items():
            cage, _ = ck.build_objects(pcs, "_cage_" + name)
            near = lod.subdivide(cage, "_near_" + name)
            bpy.data.objects.remove(cage)
            kind = name[len("jef_hat_"):] if name.startswith("jef_hat") else "shoe"
            before = lod.tris(near)
            cb.reduce(near, BUDGET[kind], weights=cb.protect_weights(near, seam=0.15, rim=0.0))
            cb.fix_islands(near)
            cages.append(near)
            parts_of[name] = {pc.name for pc in pcs}
            allp += pcs
            log("[people2] player model %s: %d -> %d triangles" % (name, before, lod.tris(near)))
        # join the sex's models into one cage to unwrap and paint them together
        for o in bpy.context.selected_objects:
            o.select_set(False)
        for o in cages:
            o.select_set(True)
        bpy.context.view_layer.objects.active = cages[0]
        bpy.ops.object.join()
        near = cages[0]
        scales = {pc.name: pc.scale for pc in allp} | {"in_" + pc.name: pc.scale for pc in allp}
        density, share = cb.unwrap(near, RECT[sex], scales)
        log("[people2] player models (%s): %.0f px/m, %.0f%% of their half of the layer" % (sex, density, 100 * share))
        for pc in allp:
            pc.slot_id = gp.SLOT_ID[pc.slot] if getattr(pc, "slot", None) else 0
        outs = []
        for level in (kp.C0, kp.C1):
            rgb, nrm = dress.paint_clothes(near, [kp.neutral_piece(p, level) for p in allp], fit, size, layer=True)
            outs.append(rgb.copy())
        slot = dress.paint_clothes.slots
        f, t, col = kp._compose(outs[0], outs[1], slot, palette)
        x, y, w, h = RECT[sex]
        sl = (slice(y, y + h), slice(x, x + w))
        layer_rgb[sl] = col[sl]
        layer_nrm[sl] = nrm[sl]
        F[sl] = f[sl]
        T[sl] = t.mean(-1)[sl]
        S[sl] = slot[sl]
        zones[sl] = dress.paint_clothes.zones[sl]
        cb.drop_layers(near)
        # split by model and move each into its socket's frame
        vparts = [(p or "").replace("in_", "", 1) for p in wt.parts(near)]
        for name, keep in parts_of.items():
            ob = near.copy()
            ob.data = near.data.copy()
            ob.name = ob.data.name = name
            bpy.context.scene.collection.objects.link(ob)
            bm = bmesh.new()
            bm.from_mesh(ob.data)
            bm.verts.ensure_lookup_table()
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if vparts[v.index] not in keep], context="VERTS")
            bm.to_mesh(ob.data)
            bm.free()
            for vg in list(ob.vertex_groups):
                ob.vertex_groups.remove(vg)
            bone = "headTop" if name.startswith("jef_hat") else "foot" + name[-1]
            head, ax = _frame(b["ao"], bone)
            for v in ob.data.vertices:
                g = np.array(G(v.co), np.float64) - head
                v.co = B(*(ax @ g))
            ob.data.update()
            cb.bake_occlusion(ob, bd.params("man", "middling"), reach=0.08)
            ob.parent = root
            objects.append(ob)
            meta[name] = {"sex": sex, "socket": bone, "triangles": lod.tris(ob),
                          "slots": sorted({gp.SLOTS[i - 1] for i in np.unique(S[sl]) if i}), "pieces": sorted(keep)}
        bpy.data.objects.remove(near)
        kp.HATFIT[sex] = hat_fit(b)
    atl.put("held_jef", layer_rgb, layer_nrm, placed=True)
    atl.clothes_zones("held_jef", zones)
    kp.TINT["held_jef"] = dict(F=np.clip(F * 255 + 0.5, 0, 255).astype(np.uint8),
                               T=np.clip(T / 2 * 255 + 0.5, 0, 255).astype(np.uint8), S=S)
    kp.CUTS["held_jef"] = ("m+f", "hats and shoes")
    kp.HELD.update(meta)
    return objects
