"""The player's kinds (jef_*; docs/people.md "The player").

One dressed kind per clothing cut of the character screen and sex, on man_middling and woman_middling. The body
sliders of the screen (build, age, shoulders, bust, the face) are the base body's; the clothes carry them
(dress.clothes_keys), so any build fits. Hats and shoes are separate models on sockets (held_player.py); hair, beard
and moustache are the base bodies' pieces.

The tint pack. A townsperson's colours are painted into the kind's picture. The player's are chosen on the screen, so
each jef_* kind is painted twice, with every tinted garment a flat neutral grey of two lightnesses; every painter in
the kit is linear in its cloth's colour (weave, folds, wear, dust, seams, mud, lining), so each texel is
`texel = F + T * colour` and the two paints give F (what the colour does not touch: buttons, stitches, mud, brass) and T
(how much of the colour shows). The shipped colour layer of each kind is F + T * the kind's default colours (a runtime
that never tints shows the default look), so the runtime needs only T and the slot, in
native-godot/assets/people2-pictures/jef-tint/<kind>_tint.png (and held_jef_tint.png for the hats and shoes):

- R: T / 2 (0..1, so T is 0..2);
- G: the colour slot of the texel x 16 (garments_player.SLOTS: 1 skin, 2 hair, 3 hat, 4 coat, 5 shirt, 6 vest,
  7 lower, 8 apron, 9 boots; 0 a fixed colour);
- B: the bars of a check shawl (how much the check darkens the texel, x 2; kinds with a check shawl), else 0.

colour = layer + T * (chosen - default[slot]), in the stored (sRGB-encoded) values. All sizes are the layer's
1024 x 1024; row 0 is the picture's bottom, as the layer's.
"""
import copy
import hashlib
import json
import os

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from . import dress
from . import garments_player as gp
from . import kinds_women2 as kw2
from .dress import Kind

GROUP = "player"
C0, C1 = 0.15, 0.60  # the two neutral lightnesses the tint pack is measured at
TINT = {}  # kind name -> dict(F, T, slot) in layer coordinates (uint8), filled by build_player
CUTS = {}  # kind name -> (sex, cut)
PIECES = {}  # kind name -> its pieces, their colour slots and the pieces that make its forearms
HATFIT = {}  # head slider -> how the head moves (held_player.hat_fit)
HELD = {}  # the held models (held_player.py): name -> socket, slots, triangles


# ---------------------------------------------------------------- the two neutral paints

def neutral_cloth(c, level):
    n = copy.copy(c)
    n.rgb = np.full(3, level, np.float32)
    n.lining = n.rgb * 0.75
    return n


def neutral_piece(pc, level):
    if not getattr(pc, "slot", None):
        return pc
    p2 = copy.copy(pc)
    p2.cloth = neutral_cloth(pc.cloth, level)
    return p2


def _compose(a, b, slot, default):
    """F, T from the two paints (colours at C0 and C1), and the default look: F + T * the slot's default colour."""
    T = (b - a) / (C1 - C0)
    F = a - C0 * T
    col = np.zeros(a.shape, np.float32) + b  # unslotted texels keep their paint
    for s, hexc in default.items():
        sid = gp.SLOT_ID[s]
        m = slot == sid
        col[m] = (F + T * np.array(gp.hexrgb(hexc), np.float32))[m]
    return F, T, col


CHECKS = {}
TEST_PALETTE = {"hat": 0x8a3e32, "coat": 0x34425a, "shirt": 0xe2ded2, "vest": 0x3e5236, "lower": 0x38383a,
                "apron": 0x9a7a40, "boots": 0x161412}


def check_recompose(paint, near, pieces, fit, size, seed, layer, F, T, slot):
    """The tint pack against a direct paint in other colours: F + T * colour against the painter's own result."""
    test = []
    for pc in pieces:
        if getattr(pc, "slot", None):
            p2 = copy.copy(pc)
            c = np.array(gp.hexrgb(TEST_PALETTE[pc.slot]), np.float32)
            p2.cloth = copy.copy(pc.cloth)
            p2.cloth.rgb, p2.cloth.lining = c, c * 0.75
            test.append(p2)
        else:
            test.append(pc)
    direct, _ = paint(near, test, fit, size, seed, layer)
    mine = np.zeros(direct.shape, np.float32) + direct
    for s_, hexc in TEST_PALETTE.items():
        m = slot == gp.SLOT_ID[s_]
        mine[m] = (F + T * np.array(gp.hexrgb(hexc), np.float32))[m]
    m = slot > 0
    if os.environ.get("PEOPLE2_TINT_DUMP"):
        np.savez_compressed(os.environ["PEOPLE2_TINT_DUMP"], F=F, T=T, slot=slot, direct=direct, mine=mine)
    d = np.abs(np.clip(mine, 0, 1) - np.clip(direct, 0, 1))[m]
    return {"texels": int(m.sum()), "meanAbs": round(float(d.mean()), 4), "p99Abs": round(float(np.percentile(d, 99)), 4),
            "maxAbs": round(float(d.max()), 3)}


def build_player(kind, make_body, ref_uv, layout, atl, tex=2048, log=print):
    """dress.build with the garments painted at two neutral lightnesses (the tint pack) and the layer made from them."""
    orig_pc, orig_pb = dress.paint_clothes, dress.paint_body
    store = {}

    def pc2(near, pieces, fit, size, seed=3, layer=False):
        store["pieces"] = pieces
        outs = []
        for level in (C0, C1):
            rgb, nmap = orig_pc(near, [neutral_piece(p, level) for p in pieces], fit, size, seed, layer)
            outs.append(rgb.copy())
        slot = pc2.slots  # (the kit's paint_clothes sets these on the name it is called by: ours)
        F, T, col = _compose(outs[0], outs[1], slot, kind.palette)
        store["cloth"] = (F, T, slot)
        store["mask"] = None
        if getattr(kind, "check", False):  # the shawl's check: a third paint without it gives the bars' mask
            plain_pieces = []
            for p in pieces:
                q = neutral_piece(p, C0)
                if q.name == "shawl":
                    q = copy.copy(q)
                    q.meta = dict(q.meta, check=False)
                plain_pieces.append(q)
            plain, _ = orig_pc(near, plain_pieces, fit, size, seed, layer)
            ratio = outs[0].mean(-1) / np.maximum(plain.mean(-1), 1e-4)
            store["mask"] = np.where(slot == gp.SLOT_ID["coat"], np.clip(1.0 - ratio, 0.0, 0.5), 0.0).astype(np.float32)
        if len(CHECKS) < 3 and os.environ.get("PEOPLE2_TINT_CHECK", "1") != "0":
            CHECKS[kind.name] = check_recompose(orig_pc, near, pieces, fit, size, seed, layer, F, T, slot)
            print("[people2]   %s tint pack check: %s" % (kind.name, CHECKS[kind.name]))
        return col.astype(np.float32), nmap

    def pb2(b, kind_, rect, size=1024, under=None):
        outs = []
        for level in (C0, C1):
            kind.under_rgb = (level, level, level)
            u = under
            if under is not None:
                tree, face_piece, looks, covers = under
                slots = {pc.name: pc.slot for pc in store["pieces"] if getattr(pc, "slot", None)}
                looks = {n: (neutral_cloth(c, level) if n in slots else c) for n, c in looks.items()}
                u = (tree, face_piece, looks, covers)
            rgb, nmap = orig_pb(b, kind_, rect, size, u)
            outs.append(rgb.copy())
        T = (outs[1] - outs[0]) / (C1 - C0)
        under_slot = gp.SLOT_ID[kind.under_slot]
        slot = np.where(T.mean(-1) > 0.03, under_slot, 0).astype(np.uint8)
        F, T, col = _compose(outs[0], outs[1], slot, kind.palette)
        store["body"] = (F, T, slot, rect)
        kind.under_rgb = gp.hexrgb(kind.palette[kind.under_slot])
        return col.astype(np.float32), nmap

    dress.paint_clothes, dress.paint_body = pc2, pb2
    try:
        b = dress.build(kind, make_body, ref_uv, layout, atl, tex=tex, log=log)
    finally:
        dress.paint_clothes, dress.paint_body = orig_pc, orig_pb
    squash_feet(b)
    deep_cut(b, kind)
    # the pack in layer coordinates: the garments' rectangle and the body's
    F = np.zeros((1024, 1024, 3), np.float32)
    T = np.zeros((1024, 1024, 3), np.float32)
    S = np.zeros((1024, 1024), np.uint8)
    cF, cT, cS = store["cloth"]
    bF, bT, bS, brect = store["body"]
    for key, (f, t, s) in (("cloth_" + kind.name, (cF, cT, cS)), ("body_" + kind.name, (bF, bT, bS))):
        x, y, w, h = layout[key]
        sl = (slice(y - 8, y + h + 8), slice(x - 8, x + w + 8))
        F[sl], T[sl], S[sl] = f[sl], t[sl], s[sl]
    PIECES[kind.name] = {
        "pieces": [pc.name for pc in b["pieces"]],
        "slots": {pc.name: pc.slot for pc in b["pieces"] if getattr(pc, "slot", None)},
        "sleeves": [pc.name for pc in b["pieces"]
                    if any(k.startswith(("armLow", "hand")) and v > 0.5 for w in pc.W for k, v in w.items())],
    }
    M = np.zeros((1024, 1024), np.float32)
    if store.get("mask") is not None:
        x, y, w, h = layout["cloth_" + kind.name]
        sl = (slice(y - 8, y + h + 8), slice(x - 8, x + w + 8))
        M[sl] = store["mask"][sl]
    TINT[kind.name] = dict(M=np.clip(M / 0.5 * 255 + 0.5, 0, 255).astype(np.uint8),
                           F=np.clip(F * 255 + 0.5, 0, 255).astype(np.uint8),
                           T=np.clip(T.mean(-1) / 2 * 255 + 0.5, 0, 255).astype(np.uint8), S=S)
    return b


SLEEVE_BOOST = 1.6  # the forearms' texel density against the rest of the clothes (first person at 0.3 to 0.6 m)


def sleeve_boost(ob):
    """unwrap's island factor: islands on the forearms (their points' weight to the forearm and hand bones) get
    SLEEVE_BOOST times the texels of the rest, the whole sleeve tube with them (one island from shoulder to cuff)."""
    from . import weights as wt
    W = wt.read(ob)
    cols = [wt.INDEX[n] for n in ("armLowL", "armLowR", "handL", "handR") if n in wt.INDEX]
    w = W[:, cols].sum(1)

    def f(lv):
        m = float(np.mean(w[lv])) if len(lv) else 0.0
        return 1.0 + (SLEEVE_BOOST - 1.0) * float(np.clip((m - 0.12) / 0.3, 0.0, 1.0))
    return f


def forearm_keep(ob):
    """The reduction's weights for the near copy: the kit's protection (rims, creases, seams), and the forearms and
    cuffs kept more (0.35 at most), so the sleeve ends stay round in first person."""
    from . import clothes_build as cb
    from . import weights as wt
    w = cb.protect_weights(ob)
    W = wt.read(ob)
    cols = [wt.INDEX[n] for n in ("armLowL", "armLowR", "handL", "handR") if n in wt.INDEX]
    fa = np.clip(W[:, cols].sum(1), 0.0, 1.0)
    return np.minimum(w, 1.0 - 0.65 * fa)


def deep_cover(kind):
    """The body that every cut of the player always hides (rest pose, game space): the trunk under the shirt, bodice
    or smock up to a little below the collar line, the arms from the shoulder to 5 cm above the wrist (every cut has
    full sleeves), the legs above the ankle (trousers) or the knee (a skirt shows the shins in a stride). Cut whatever
    the rays of the kit's cut said: a posed shoulder or knee pushed that skin through the cloth (dark patches)."""
    sex = CUTS[kind.name][0]
    P = bd.params("man" if sex == "m" else "woman", "middling")
    front, back = (0.828, 0.846) if sex == "m" else (0.826, 0.836)
    wrist = bd.Y(P, 0.499 if sex == "m" else 0.501)
    leg_top = 0.14 if sex == "m" else 0.32

    def f(p, part):
        x, y, z = p
        if part in ("torso", "neck"):  # the shoulders' tops out to the neck's sides, the neck under the collar line
            line = collar_line(P, z, front, back)
            return (abs(x) > 0.078 and y < line + 0.03) or y < line - 0.025
        if part.startswith("arm"):
            return y > wrist + 0.05
        if part.startswith("leg"):
            return y > leg_top
        return False
    return f


def deep_cut(b, kind):
    from . import lod
    f = deep_cover(kind)
    for key in ("lod0", "lod1"):
        n = ck.cut_body(b[key], f, None)
        if "counts" in b and key in b["counts"]:
            b["counts"][key] = lod.tris(b[key])
        print("[people2]   %s %s: %d hidden body faces cut" % (kind.name, key, n))


def squash_feet(b, k=(0.80, 0.84, 0.88)):
    """The player's shoes are rigid models on the foot bones (held_player.py) and MakeHuman's foot must lie inside them
    for every shoe: the kind's feet are drawn in (scaled about the ankle on the ground, by the weight of the foot and
    toe bones), basis and every shape key alike. Nothing of the foot shows: boots or clogs always cover it."""
    from . import B, G
    from . import rig
    from . import weights as wt
    k = np.asarray(k)
    for lod in ("lod0", "lod1"):
        ob = b[lod]
        me = ob.data
        W = wt.read(ob)
        n = len(me.vertices)
        for S in "LR":
            ids = [wt.INDEX["foot" + S], wt.INDEX["toe" + S]]
            w = W[:, ids].sum(1)
            if not (w > 0).any():
                continue
            head = b["J"]["foot" + S][0]
            c = np.array((float(head[0]), 0.0, float(head[2])))
            blocks = list(me.shape_keys.key_blocks) if me.shape_keys else []
            targets = [(kb.data, True) for kb in blocks] if blocks else [(me.vertices, False)]
            for data, _ in targets:
                co = np.array([G(v.co) for v in data], np.float64)
                new = co + (c + (co - c) * k - co) * w[:, None]
                for i in np.nonzero(w > 0)[0]:
                    data[i].co = B(*new[i])
            if blocks:
                for i in np.nonzero(w > 0)[0]:
                    me.vertices[i].co = blocks[0].data[i].co
        me.update()


def write_tint(directory):
    """The tint pack's pictures (one per kind and one for the hats and shoes, lossless in the game) and
    jef_tint.json. The shipped colour layer is F + T x the default colours, so the runtime needs only T and the slot:
    colour = layer + T x (chosen - default), per texel of a slot."""
    from . import pictures as at
    out = os.path.join(directory, "jef-tint")
    os.makedirs(out, exist_ok=True)
    meta = {}
    for name, d in TINT.items():
        TS = np.zeros((1024, 1024, 3), np.float32)
        TS[..., 0] = d["T"] / 255.0
        TS[..., 1] = d["S"] * 16 / 255.0
        if "M" in d:
            TS[..., 2] = d["M"] / 255.0
        fname = name + "_tint"
        imp = os.path.join(out, fname + ".png.import")
        if os.path.exists(imp):
            os.remove(imp)
        at.save(fname, TS, out)  # 8-bit values as given: no colour transform
        # lossless, no mipmaps (a mip would average slot numbers), the jef-tint folder's own path
        resource = "res://assets/people2-pictures/jef-tint/" + fname + ".png"
        dest = "res://.godot/imported/" + fname + ".png-" + hashlib.md5(resource.encode()).hexdigest() + ".ctex"
        with open(imp, "w") as f:
            f.write("\n".join(['[remap]', 'importer="texture"', 'type="CompressedTexture2D"', 'path="%s"' % dest,
                               'metadata={', '"vram_texture": false', '}', '', '[deps]', 'source_file="%s"' % resource,
                               'dest_files=["%s"]' % dest, '', '[params]', 'compress/mode=0',
                               'compress/high_quality=false', 'compress/normal_map=0', 'mipmaps/generate=false',
                               'process/fix_alpha_border=false', 'process/premult_alpha=false', '']))
        meta[name] = {"sex": CUTS[name][0], "cut": CUTS[name][1]}
    with open(os.path.join(out, "jef_tint.json"), "w") as f:
        json.dump({"about": __doc__, "slots": gp.SLOTS, "levels": [C0, C1], "kinds": meta}, f, indent=1)


def rig_json():
    """peopleRig.json `player`: what the runtime needs (docs/people.md "The player")."""
    kinds = {}
    for k in KINDS:
        sex, cut = CUTS[k.name]
        kinds[k.name] = {"sex": sex, "cut": cut, "base": k.body, "defaultPalette": {s: "%06x" % v for s, v in k.palette.items()},
                         "underSlot": k.under_slot, **PIECES.get(k.name, {})}
    return {"about": "the player's kinds, hats and shoes (docs/people.md 'The player')",
            "slots": {s: i for i, s in enumerate(gp.SLOTS, start=1)},
            "tint": {"levels": [C0, C1], "dir": "assets/people2-pictures/jef-tint",
                     "formula": "colour = layer + T * (chosen - default[slot]) on the texels of a slot (sRGB-encoded "
                                "values, as stored); T = <name>_tint.png red x 2; slot = green x 255 / 16 (0 fixed); "
                                "check bars = blue (a plain shawl: layer / (1 - blue x 0.5) on slot coat); <name> is "
                                "the kind, or held_jef for the hats and shoes", "checks": CHECKS},
            "kinds": kinds, "models": HELD, "hatFit": HATFIT}


# ---------------------------------------------------------------- the kinds

def collar_line(P, z, front, back):
    """The height the painted undershirt stops at on the trunk and neck: the middle of the collar ring, which sits
    lower in front than at the nape (fractions of the height, measured on the built kinds). MakeHuman's torso part
    runs up the nape above any collar, so the line is a height, not a part: no ragged triangle edge shows."""
    t = np.clip(z / 0.05, -1.0, 1.0)
    return bd.Y(P, 0.5 * (front + back) + 0.5 * (front - back) * t)


def covers_man(p, part):
    P = bd.params("man", "middling")
    x, y, z = p
    if part.startswith("leg"):
        return True
    if part in ("torso", "neck"):
        return y < collar_line(P, z, 0.828, 0.846)
    if part.startswith("arm"):
        return y > bd.Y(P, 0.499) + 0.022
    return False


def man_skin(kind):
    def f(ctx):
        hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
        ctx.mul(hand, (0.93, 0.90, 0.87))
        ck.undershirt(ctx, tuple(kind.under_rgb), 0, zone=1, covers=covers_man, skip=("leg", "neck"))
    return f


_covers_dress = kw2.covers_dress(bd.params("woman", "middling"))


def covers_woman(p, part):
    if part in ("torso", "neck"):
        return p[1] < collar_line(bd.params("woman", "middling"), p[2], 0.826, 0.836)
    return _covers_dress(p, part)


def woman_skin(kind):
    def f(ctx):
        kw2.stockings(ctx, (0.13, 0.13, 0.15))
        hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
        ctx.mul(hand, (0.94, 0.91, 0.88))
        ck.undershirt(ctx, tuple(kind.under_rgb), 0.0, zone=1, covers=covers_woman, skip=("leg",))
    return f


def layers_of(sex, cut):
    """The layer order a cut states (under, over), so the clearance never trusts the rays' votes where a bell skirt
    or a bodice lies close under a jacket, a coat or a smock (they missed skirt<coat: the skirt came through)."""
    out = []
    if sex == "m":
        if cut != "smock":
            out += [("shirt", "waistcoat"), ("shirt", "trousers")]
        if cut in ("jacket", "coat", "jacket_apron"):
            out += [("shirt", "coat"), ("waistcoat", "coat"), ("trousers", "coat")]
        if cut == "smock":
            out += [("trousers", "smock")]
    else:
        out += [("bodice", "skirt")]
        if cut in ("jacket", "coat", "jacket_apron"):
            out += [("bodice", "coat"), ("skirt", "coat")]
        if cut == "smock":
            out += [("bodice", "smock"), ("skirt", "smock")]
        if "apron" in cut:
            out += [("skirt", "apron")]
        if cut.startswith("shawl"):
            out += [("bodice", "shawl")]
    return out


AVOID_M = {"walk_f": "a woman's walk", "talk_f": "a woman's talk", "rifle_idle": "no rifle", "rifle_walk": "no rifle",
           "rifle_talk": "no rifle"}
KINDS = []


def make(name, sex, cut, dress_fn, covers, skin, palette, under_slot, note, avoid, seed):
    base = "man_middling" if sex == "m" else "woman_middling"
    shoe = "boots" if sex == "m" else "clogs"  # Jef's and Mie's (Character.cs); the runtime swaps them per profile
    held = [("jef_%s_%s_%s" % (shoe, sex, S), "foot" + S, "the default shoe (held_player.py)") for S in "LR"]
    k = Kind(name, GROUP, base, face=dict(seed=seed, sex=sex, age=22), dress=lambda fit, f=dress_fn, c=cut: f(fit, c),
             covers=covers, skin=None, hats=(), held=held, hands_hard=0.3 if sex == "m" else 0.15, hero=True,
             avoid=avoid, note=note)
    k.check = cut.startswith("shawl")
    k.layers = layers_of(sex, cut)
    k.near_budget, k.far_budget = 13000, 2300  # the shoes (about 1,100) and the hat (about 900) come on top
    k.palette = dict(palette)
    k.under_slot = under_slot
    k.under_rgb = gp.hexrgb(palette[under_slot])
    k.skin = skin(k)
    k.build = build_player
    k.uv_boost = sleeve_boost
    k.reduce_weights = forearm_keep
    k.ao_through = True
    CUTS[name] = (sex, cut)
    KINDS.append(k)
    return k


def _men():
    notes = {
        "shirt": "linen shirt with buttoned cuffs, a waistcoat, trousers",
        "jacket": "short open jacket over the shirt and waistcoat",
        "coat": "long open coat to the knee over the shirt and waistcoat",
        "smock": "the blue kiel over a shirt",
        "apron": "shirt and waistcoat under a long working apron",
        "jacket_apron": "short jacket and a long working apron",
    }
    for i, cut in enumerate(("shirt", "jacket", "coat", "smock", "apron", "jacket_apron")):
        pal = dict(gp.JEF)
        if cut == "smock":
            pal["coat"] = gp.SMOCK_BLUE
        make("jef_m_" + cut, "m", cut, gp.men_dress, covers_man, man_skin, pal,
             "coat" if cut == "smock" else "shirt", "the player, a man: " + notes[cut], AVOID_M, 1873500 + i)


_men()


def _women():
    notes = {
        "plain": "bodice and full skirt, cream collar and cuffs",
        "apron": "bodice and skirt under a long apron",
        "shawl": "bodice and skirt under a fringed check shawl",
        "shawl_apron": "check shawl and apron",
        "jacket": "fitted short jacket over a bodice and skirt",
        "jacket_apron": "short jacket and an apron",
        "coat": "fitted long coat (a redingote) over a bodice and skirt",
        "smock": "a loose linen smock over a bodice and skirt",
    }
    for i, cut in enumerate(("plain", "apron", "shawl", "shawl_apron", "jacket", "jacket_apron", "coat", "smock")):
        pal = dict(gp.MIE)
        if cut == "smock":
            pal["coat"] = gp.SMOCK_BLUE
        elif cut in ("jacket", "jacket_apron", "coat"):
            pal["coat"] = 0x38383a  # charcoal: apart from the brown skirt (Character.cs Cloth "charcoal")
        make("jef_w_" + cut, "f", cut, gp.women_dress, covers_woman, woman_skin, pal,
             "coat" if cut == "smock" else "shirt", "the player, a woman: " + notes[cut], kw2.AVOID_W, 1873520 + i)


_women()
