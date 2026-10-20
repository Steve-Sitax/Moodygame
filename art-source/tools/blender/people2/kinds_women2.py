"""The women's kinds of package C2, second file (docs/people.md "Kinds and clothes", "The women of 1873").

Antwerp in the autumn of 1873: working women in a fitted bodice (the jak) over a full wool skirt to the ankles, an
apron, a shawl, a white linen cap or a printed kerchief over the hair, laced boots or wooden clogs; the shopkeeper's
wife in black with a white bib apron and a lace cap; a maid in navy with white collar, cuffs, cap and bib apron;
the old in black; girls in short dresses with pinafores; a Black Sister (the Zwartzusters who nursed the sick at
home) in her habit, coif, wimple and veil; a beguine of the Sint-Catharinabegijnhof in black with her white cap under
the falie, the black hooded mantle; an English lady come for the Rubens in a walking dress of 1873 with its bustle,
a small hat tipped forward over her chignon and kid gloves. Colours from the old kit (build_people.py PEOPLE);
sources in docs/people.md.

Each kind: its face setting, its hair under its cap (KIND_HAIR below, registered into face_types so the game gives
every woman of the kind a hair style that fits under her cap or hat), the garments (garments_women.py on
clothes_kit), what the body under them is (covers), the body's paint (stockings, gloves, the cloth under a
neckline) and the held things (held_women.py).
"""

import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from . import garments_women as gw
from .clothes_kit import Cloth, hexrgb, sm
from .dress import Kind

# ---------------------------------------------------------------- the hair under each kind's cap or hat
# (face_types.KIND_HAIR holds the first four kinds' rows; these are added to it when this file is read, so
# shared/faceTypes.json carries them and the game's People2Faces.FaceFor draws hair that fits)
KIND_HAIR = {
    "wife_a": {"undercap": 1}, "wife_b": {"undercap": 1}, "shopwife": {"undercap": 1},
    "old_woman": {"undercap": 1}, "milk_woman": {"undercap": 1}, "tourist_lady": {"bun": 1},
}


def register_hair():
    from . import face_types as ft
    for k, v in KIND_HAIR.items():
        ft.KIND_HAIR.setdefault(k, v)
    # the dressed old woman's root (see OLD_WOMAN below) draws faces as the old_woman kind does
    ft.KIND_TYPES.setdefault("old_woman_dressed", ft.KIND_TYPES["old_woman"])
    ft.KIND_HAIR.setdefault("old_woman_dressed", KIND_HAIR["old_woman"])


register_hair()


# ---------------------------------------------------------------- shared looks and painters

def _hooks_front(ctx, n=8, top=0.80, step=0.032, r=0.0045, rgb=(0.07, 0.07, 0.08), z=0.15, metal=False):
    """The front closing of a bodice: a seam down the middle and a row of small buttons."""
    P = ctx.fit.P
    arm = ctx.zone == "arm"
    ck.seam_line(ctx, np.where(~arm & (ctx.z > 0) & ~ctx.inner, np.abs(ctx.x) - 0.002, 1.0))
    for k in range(n):
        ck.button(ctx, ctx.fit.snap((0.0, bd.Y(P, top) - k * step, z), 0.012), r=r, rgb=rgb, metal=metal)


def _side_seams(ctx):
    x, z = ctx.x, ctx.z
    side = np.abs(np.abs(np.degrees(np.arctan2(x, z))) - 92.0)
    ck.seam_line(ctx, np.where((ctx.zone != "arm") & ~ctx.inner, side / 57.3 * 0.15, 1.0))
    # the back's two curved seams (princess seams of a fitted bodice)
    back = np.abs(np.abs(x) - 0.055 - 0.25 * np.maximum(0, ctx.y - bd.Y(ctx.fit.P, 0.70)))
    ck.seam_line(ctx, np.where((ctx.zone != "arm") & (z < 0) & ~ctx.inner, back, 1.0), shade=0.88)


def _sleeve_seam(ctx, elbow_wear=0.15, wear_rgb=(0.5, 0.5, 0.5)):
    P = ctx.fit.P
    arm = ctx.zone == "arm"
    # the seam under the arm, the elbow worn shiny
    under = arm & (np.abs(ctx.x) < np.abs(ctx.x).max())
    el = arm & (ctx.z < 0)
    ctx.mix(el * np.exp(-((ctx.y - bd.Y(P, 0.63)) / 0.035) ** 2) * elbow_wear, wear_rgb)
    cuff = arm & (ctx.y < bd.Y(P, 0.505) + 0.012)
    ctx.mul(cuff & ~ctx.inner, 0.9)


def _bodice_extra(buttons=8, top=0.80, button_rgb=(0.07, 0.07, 0.08), metal=False, wear_rgb=(0.5, 0.5, 0.52)):
    def f(ctx):
        _hooks_front(ctx, n=buttons, top=top, rgb=button_rgb, metal=metal)
        _side_seams(ctx)
        _sleeve_seam(ctx, wear_rgb=wear_rgb)
    return f


def _skirt_extra(tucks=(), hem_dark=0.35, stripes=None):
    """A wool skirt: gathered at the waistband, the hem worn darker; tucks: heights (m) of horizontal tucks;
    stripes: (colour, n round the skirt, width share)."""
    def f(ctx):
        m = ctx.piece.meta
        if stripes is not None:
            col, k, wsh = stripes
            ang = np.arctan2(ctx.x, ctx.z)
            t = (ang / (2 * math.pi) * k) % 1.0
            aa = 0.03
            band = sm(0.5 - wsh / 2 - aa, 0.5 - wsh / 2 + aa, t) * sm(0.5 + wsh / 2 + aa, 0.5 + wsh / 2 - aa, t)
            ctx.mix(band * (~ctx.inner), col)
        # gathers below the band: short vertical creases
        g = np.cos(np.arctan2(ctx.x, ctx.z) * 60) * sm(m["band"] - 0.06, m["band"], ctx.y)
        ctx.bump(g * (~ctx.inner), 0.0006)
        ck.seam_line(ctx, np.where(~ctx.inner, ctx.y - m["band"], 1.0))
        for ty in tucks:
            tk = np.exp(-((ctx.y - ty) / 0.006) ** 2) * (~ctx.inner)
            ctx.bump(tk, 0.0012)
            ck.seam_line(ctx, np.where(~ctx.inner, ctx.y - ty + 0.008, 1.0), shade=0.9)
        hem = m["hem"]
        ctx.mix(sm(hem + 0.05, hem, ctx.y) * hem_dark, (0.22, 0.19, 0.16))
        ck.seam_line(ctx, np.where(~ctx.inner, ctx.y - hem - 0.025, 1.0), shade=0.9)
    return f


def _apron_extra(stains=0.25, pocket=True, stain_rgb=(0.55, 0.50, 0.42)):
    def f(ctx):
        m = ctx.piece.meta
        s = np.clip(ck._noise3(ctx.pos, 12.0, 21) * 2.0 - 0.7, 0, 1)
        ctx.mix(s * stains, stain_rgb)
        if pocket and "top" in m:
            pk = (np.abs(ctx.x + 0.08) < 0.065) & (np.abs(ctx.y - (m["top"] - 0.12)) < 0.055) & ~ctx.inner
            ctx.mul(pk, 0.95)
            edge = pk & ((0.065 - np.abs(ctx.x + 0.08) < 0.004) | (np.abs(ctx.y - (m["top"] - 0.07)) < 0.003))
            ck.seam_line(ctx, np.where(edge, 0.0, 1.0))
        if "bottom" in m:
            ck.seam_line(ctx, np.where(~ctx.inner, ctx.y - m["bottom"] - 0.02, 1.0))
        # pressed folds of a laundered apron: two creases down
        cr = np.exp(-((np.abs(ctx.x) - 0.10) / 0.004) ** 2) * (~ctx.inner)
        ctx.bump(cr, 0.0004)
        ctx.mul(cr, 0.96)
    return f


def _linen_white(ctx):
    ck.seam_line(ctx, np.abs(ctx.x), width=0.0007, depth=0.00005, shade=0.94)


def _frill_extra(ctx):
    g = np.cos(np.arctan2(ctx.x, ctx.z) * 150)
    ctx.bump(g, 0.0005)
    ctx.mul(0.5 - 0.5 * g, 0.88)


def _shawl_check(ground, bars, size=0.045, slant=0.25):
    def f(ctx):
        u = ctx.x + slant * ctx.z
        v = ctx.y - slant * ctx.z * np.sign(ctx.x + 1e-9)
        gw.check(ctx, u, v, size, ground, bars)
        # the selvedge: a narrow band of the ground colour darker along the outer edge is in the fringe's piece
    return f


def _fringe_extra(ctx):
    """Tassels: strands running down (fine light and dark lines), a knot band near the top, the tips frayed."""
    u = ctx.x + 0.35 * ctx.z
    strands = np.sin(u * 2 * math.pi / 0.0025) * 0.5 + 0.5
    groups = np.sin(u * 2 * math.pi / 0.018) * 0.5 + 0.5
    ctx.bump(strands * 0.6 + groups * 0.4, 0.0003)
    ctx.rgb[:] = ctx.rgb * (0.78 + 0.30 * strands * (0.6 + 0.4 * groups))[:, None]
    top = ctx.piece.meta.get("top_y")
    if top is not None:
        pass


def _knit_extra(rib=0.0, scale=0.0048):
    def f(ctx):
        gw.knit(ctx, scale=scale, rib=rib)
    return f


def _boot_extra(ctx):
    """Laced ankle boots: the lacing down the instep, the toe cap's stitching, creases over the toes."""
    if "sides" not in ctx.piece.meta:
        return
    for side, cx, s in ctx.piece.meta["sides"]:
        dx = ctx.x - cx
        lace = (np.abs(dx) < 0.012) & (ctx.y > 0.06) & (ctx.z > 0.0) & (ctx.z < 0.06 * s / 0.06)
        ctx.mul(lace, 0.7)
        hole = lace & (np.cos(ctx.y * 2 * math.pi / 0.011) > 0.6)
        ctx.mix(hole * 0.6, (0.02, 0.02, 0.02))
        cap = np.abs(ctx.z - 0.15 * s) < 0.002
        ck.seam_line(ctx, np.where(cap & (np.abs(dx) < 0.05), 0.0, 1.0), width=0.0008)
        cr = (ctx.z > 0.09 * s) & (ctx.z < 0.15 * s) & (ctx.y > 0.03)
        ctx.bump(cr * np.cos(ctx.z * 2 * math.pi / 0.012), 0.0003)


def stockings(ctx, rgb, knit=True):
    """Wool stockings on the legs (the body's paint), knitted."""
    leg = np.char.startswith(ctx.part, "leg") | np.char.startswith(ctx.part, "foot")
    kn = 0.5 + 0.5 * np.sin(ctx.y * 1500) * np.sin(np.arctan2(ctx.x, ctx.z) * 38) if knit else np.zeros(len(ctx.y))
    col = np.array(rgb) * (0.9 + 0.15 * kn)[:, None]
    ctx.detail_zone[leg] = 1
    ctx.rgb[leg] = col[leg]
    ctx.h[leg] += 0.00015 * kn[leg]


def covers_dress(P, neck_top=0.80, wrist=0.501, sleeve_to=None, leg_lo=0.115, leg_hi=0.45):
    """The body under a long-sleeved bodice and an ankle-length skirt: the trunk, the neck below its collar, the arms
    above the wrist (or above `sleeve_to`), the legs above leg_hi (always under the skirt) and the feet in boots."""
    def f(p, part):
        x, y, z = p
        if part == "torso":
            return True
        if part == "neck":
            return y < bd.Y(P, neck_top)
        if part.startswith("arm"):
            return y > bd.Y(P, sleeve_to if sleeve_to else wrist) + 0.025
        if part.startswith("leg"):
            return y > leg_hi or y < leg_lo
        return False
    return f


def shoulder_weights(onto, arm=0.6):
    """Weights for cloth laid over the shoulders (a shawl, a cape): the garment's under it, without the forearm and
    hand and with the upper arm's share cut to `arm`: it lifts with the shoulder but does not bend with the elbow."""
    def f(p):
        w = onto.weights(p)
        out = {}
        for b, v in w.items():
            if b.startswith(("armLow", "hand", "thumb", "index", "middle", "ring", "little")):
                b = "armUp" + b[-1] if b[-1] in "LR" else "upperChest"
                v *= 0.5
            if b.startswith("armUp"):
                out["upperChest"] = out.get("upperChest", 0.0) + v * (1 - arm)
                v *= arm
            out[b] = out.get(b, 0.0) + v
        return ck.wnorm(out)
    return f


def cap_corners(pc, ids):
    """The lower front corners of a hood cap (where its strings start)."""
    V = np.array(pc.V)
    rows, cols = ids.shape
    return [V[ids[1, 0]], V[ids[1, cols - 1]]]


# ---------------------------------------------------------------- wife_a: a working man's wife

PA = bd.params("woman", "middling")
WA_DRESS = hexrgb(0x3a4250)
WA_BODICE = Cloth(WA_DRESS, "wool", wear=0.35, dust=0.08, extra=_bodice_extra(9, 0.80), lining=(0.20, 0.22, 0.25))
WA_SKIRT = Cloth(WA_DRESS, "wool", wear=0.35, mud=0.7, mud_h=0.20, extra=_skirt_extra(tucks=(0.20, 0.235)),
                 lining=(0.24, 0.26, 0.29))
WA_APRON = Cloth(hexrgb(0xd8d4c8), "linen", wear=0.3, mud=0.25, mud_h=0.16, extra=_apron_extra(0.18), folds=1.0)
WA_BAND = Cloth(hexrgb(0xd0ccbf), "linen", wear=0.3, folds=0.2)
WA_SHAWL = Cloth(hexrgb(0x8a3a2e), "wool", wear=0.3, dust=0.05, folds=1.2, lining=(0.42, 0.18, 0.14),
                 extra=_shawl_check(None, [((0.20, 0.10, 0.09), 0.16, 1, 0.85), ((0.74, 0.60, 0.44), 0.05, 2, 0.8)]))
WA_FRINGE = Cloth(hexrgb(0x7a3228), "wool", wear=0.2, folds=0.0, extra=_fringe_extra)
WA_CAP = Cloth((0.87, 0.85, 0.80), "linen", wear=0.15, extra=_linen_white, folds=0.3, lining=(0.80, 0.78, 0.73))
WA_BRIM = Cloth((0.89, 0.87, 0.82), "linen", wear=0.1, extra=_frill_extra, folds=0.0)
WA_TIES = Cloth((0.86, 0.84, 0.79), "linen", wear=0.1, folds=0.0)
BOOT = Cloth((0.085, 0.07, 0.06), "leather", wear=0.45, mud=0.5, mud_h=0.06, folds=0.0, extra=_boot_extra)
SOLE = Cloth((0.08, 0.06, 0.045), "leather", wear=0.5, mud=0.6, mud_h=0.03, folds=0.0)


def _shawl_on(fit, pc, onto, ends="hang", back=0.40, shoulder=0.15, front=0.105, lift0=0.007, front_y=0.64,
              cross=0.0, rows=27, cols=6, wfn=None):
    """A folded square shawl over the shoulders: the fold round the neck, the point down the back (`back` metres),
    the ends over the breast down to front_y (fraction); ends="hang" (open, straight down) or "cross" (crossed over
    the breast by `cross` metres). Returns ids and the path."""
    Y = lambda f: bd.Y(fit.P, f)
    fy = Y(front_y)
    zc = 0.15
    if ends == "cross":
        left = [(-cross, fy, zc), (-cross * 0.4, Y(0.70), zc + 0.01), (0.05, Y(0.775), 0.12)]
    else:
        left = [(0.065, fy, zc), (0.07, Y(0.70), zc + 0.01), (0.075, Y(0.775), 0.12)]
    left += [(0.095, Y(0.825), 0.05), (0.085, Y(0.842), -0.035)]
    path = left + [(0.0, Y(0.846), -0.07)] + [(-x, y, z) for x, y, z in left[::-1]]
    nl = len(left)
    widths = [front * 0.85, front, front * 1.15, shoulder, shoulder * 1.1, back] + \
             [shoulder * 1.1, shoulder, front * 1.15, front, front * 0.85]
    widths = widths[:nl] + [back] + widths[-nl:] if len(widths) != 2 * nl + 1 else widths
    lifts = [lift0 + (0.006 if (ends == "cross" and k < 3) else 0.0) for k in range(nl)] + [lift0] + \
            [lift0] * nl
    # weights from the trunk only: a shawl does not bend with the elbow (taken from the sleeves, its front
    # followed the folded forearms through the chest)
    def away(p):
        # the shawl goes out over the shoulders from its fold: down the back, out to the sides in front
        side = np.sign(p[0]) if abs(p[0]) > 1e-4 else 0.0
        back = float(sm(0.02, -0.06, p[2]))
        return np.array((side * (1 - back), -0.4 - 0.6 * back, 0.0))
    ids = gw.band_out(fit, pc, onto, path, widths, lifts, cols=cols, rows=rows, lift_out=0.006,
                      wfn=wfn, away=away)
    return ids


def wife_a_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []
    sk = ck.Piece("skirt", WA_SKIRT)
    hem = 0.068
    gw.skirt(fit, sk, hem, n=24, ease=0.013, clear=0.045, flare=0.20, folds=9, fold_depth=0.018, back_legs=0.75)
    ck.thicken(sk, 0.003, depth=lambda p: 0.10 if p[1] < 0.5 else 0.03)
    pieces.append(sk)
    on_skirt = ck.Onto([sk])
    bo = gw.bodice(fit, WA_BODICE, gw.ease_table(fit))
    ck.thicken(bo, 0.0028, depth=0.035)
    pieces.append(bo)
    on_bodice = ck.Onto([bo])
    # the apron and its band
    ap = ck.Piece("apron", WA_APRON)
    gw.apron(fit, ap, on_skirt, Y(0.600), Y(0.20), half=70.0)
    ck.thicken(ap, 0.0022, depth=0.03)
    pieces.append(ap)
    band = ck.Piece("apron_band", WA_BAND, scale=1.2)
    ck.band(fit, band, ck.Onto([bo, sk], skip_zones=("arm",)), Y(0.612), 0.032, d=0.008, n=20, rows=2)
    ck.thicken(band, 0.0028, depth=None, crease=0.1)
    pieces.append(band)
    # the check shawl, open in front, and its fringe on the back's two edges and the ends
    sw = ck.Piece("shawl", WA_SHAWL, scale=0.95)
    on_trunk = type("W", (), {"weights": staticmethod(shoulder_weights(on_bodice))})
    ids = _shawl_on(fit, sw, on_bodice, ends="hang", back=0.40, front_y=0.655, wfn=on_trunk.weights, lift0=0.013)
    ck.thicken(sw, 0.0028, depth=0.03, crease=0.06)
    pieces.append(sw)
    fr = ck.Piece("shawl_fringe", WA_FRINGE, scale=1.3)
    on_all = ck.Onto([bo, sw, ap, sk])
    V = np.array(sw.V)
    R = ids.shape[0]
    mid = R // 2
    # the back's edges: the outer column from the shoulders to the point and back up
    edge = [V[ids[r, -1]] for r in range(mid - 9, mid + 10)]
    gw.fringe(fit, fr, edge, on_all, length=0.06, lift=0.006, wfn=on_trunk.weights)
    for r in (0, R - 1):
        gw.fringe(fit, fr, [V[ids[r, c]] for c in range(ids.shape[1])], on_all, length=0.05, lift=0.006,
                  wfn=on_trunk.weights)
    ck.thicken(fr, 0.0012, depth=None, crease=0.9)
    pieces.append(fr)
    # the cap: plain linen with a narrow pleated brim and strings tied under the chin
    cap = ck.Piece("cap", WA_CAP, scale=1.3, hat=True)
    brim = ck.Piece("cap_brim", WA_BRIM, scale=1.3, hat=True)
    cid = ck.hood_cap(fit, cap, frill=brim, margin=0.015, front=-30.0, back=110.0, side=100.0, cols=13, rows=9)
    ck.thicken(cap, 0.0016, depth=0.02)
    ck.thicken(brim, 0.0011, depth=None, crease=0.06)
    tie = ck.Piece("cap_ties", WA_TIES, scale=1.3, hat=True)
    gw.ties(fit, tie, cap_corners(cap, cid))
    pieces += [cap, brim, tie]
    bt = ck.Piece("boots", BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        gw.boots_light(fit, bt, so, S)
    pieces += [bt, so]
    return pieces


wife_a_covers = covers_dress(PA)


def wife_a_skin(ctx):
    stockings(ctx, (0.13, 0.13, 0.15))
    hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
    ctx.mix(hand * 0.2, (0.74, 0.46, 0.40))
    ck.undershirt(ctx, (0.20, 0.22, 0.26), 0.0, zone=1, covers=wife_a_covers, skip=("leg",))


WIFE_A = Kind(
    "wife_a", "women", "woman_middling",
    face=dict(type="round_flemish_woman", seed=1873201, sex="f", age=34,
              look=dict(weather=0.5, ruddy=0.4, hair="brown", hair_rgb=hexrgb(0x4a3424))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=wife_a_dress, covers=wife_a_covers, skin=wife_a_skin, hats=("cap", "cap_brim", "cap_ties"),
    avoid={"walk": "walk_f is hers", "talk": "talk_f is hers", "rifle_idle": "no rifle", "rifle_walk": "no rifle",
           "rifle_talk": "no rifle", "ride": "the skirt"},
    note="a working man's wife: white linen cap tied under the chin, red check shawl with a fringe, blue-grey dress, "
         "white apron, laced boots")


# ---------------------------------------------------------------- maid: a maid on an errand

PS = bd.params("woman", "slight")
NAVY = hexrgb(0x262a36)
MD_BODICE = Cloth(NAVY, "wool", wear=0.2, extra=_bodice_extra(10, 0.805, (0.05, 0.05, 0.06)), lining=(0.16, 0.17, 0.20))
MD_SKIRT = Cloth(NAVY, "wool", wear=0.25, mud=0.45, mud_h=0.14, extra=_skirt_extra(hem_dark=0.25),
                 lining=(0.15, 0.16, 0.19))
WHITE = (0.90, 0.89, 0.85)
MD_APRON = Cloth(WHITE, "cotton", wear=0.15, mud=0.15, mud_h=0.12, extra=_apron_extra(0.08, pocket=False), folds=0.8)
MD_BIB = Cloth(WHITE, "cotton", wear=0.1, folds=0.3)
MD_BAND = Cloth((0.88, 0.87, 0.83), "cotton", wear=0.1, folds=0.2)
MD_COLLAR = Cloth((0.92, 0.91, 0.88), "linen", wear=0.05, folds=0.0, extra=_linen_white)
MD_CUFF = Cloth((0.92, 0.91, 0.88), "linen", wear=0.08, folds=0.0)
MD_CAP = Cloth((0.92, 0.91, 0.88), "cotton", wear=0.05, extra=_linen_white, folds=0.2, lining=(0.86, 0.85, 0.81))
MD_FRILL = Cloth((0.93, 0.92, 0.89), "cotton", wear=0.05, extra=_frill_extra, folds=0.0)


def cuffs(fit, pc, ease_out, rings=("f2", "w1")):
    """White cuffs over a sleeve's end: a short tube from the forearm ring to the wrist ring, `ease_out` out."""
    def allow(i):
        part, tg = fit.C.part[i], fit.C.tag[i]
        return part.startswith("arm") and tg.get("ring") in rings and "w" not in tg
    return ck.from_cage(fit, pc, allow, lambda i: ease_out)


def maid_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []
    sk = ck.Piece("skirt", MD_SKIRT)
    gw.skirt(fit, sk, 0.060, n=24, ease=0.012, clear=0.04, flare=0.18, folds=8, fold_depth=0.016, back_legs=0.75)
    ck.thicken(sk, 0.003, depth=lambda p: 0.10 if p[1] < 0.5 else 0.03)
    pieces.append(sk)
    on_skirt = ck.Onto([sk])
    ease = gw.ease_table(fit, arm=[0.007, 0.008, 0.009, 0.009, 0.009, 0.010, 0.010, 0.010, 0.009, 0.008, 0.007])
    bo = gw.bodice(fit, MD_BODICE, ease)
    ck.thicken(bo, 0.0026, depth=0.035)
    pieces.append(bo)
    on_bodice = ck.Onto([bo])
    cu = ck.Piece("cuffs", MD_CUFF, scale=1.3)
    cuffs(fit, cu, 0.0125)
    ck.thicken(cu, 0.0015, depth=None, crease=0.1)
    pieces.append(cu)
    col = ck.Piece("collar", MD_COLLAR, scale=1.4)
    gw.pelerine(fit, col, on_bodice, 0.045, 0.040, n=24, rings=2, up=0.008, front_gap=0.012)
    ck.thicken(col, 0.0015, depth=None, crease=0.1)
    pieces.append(col)
    # the white bib apron: long, wide, the bib pinned at the chest, the strings in a bow behind
    ap = ck.Piece("apron", MD_APRON)
    gw.apron(fit, ap, on_skirt, Y(0.600), Y(0.12), half=82.0, n=17, folds=0.010)
    ck.thicken(ap, 0.0018, depth=0.03)
    pieces.append(ap)
    bb = ck.Piece("apron_bib", MD_BIB, scale=1.1)
    gw.bib(fit, bb, on_bodice, Y(0.612), Y(0.745), w_bottom=0.19, w_top=0.16, lift=0.004)
    ck.thicken(bb, 0.0018, depth=None, crease=0.08)
    pieces.append(bb)
    band = ck.Piece("apron_band", MD_BAND, scale=1.2)
    on_waist = ck.Onto([bo, sk], skip_zones=("arm",))
    ck.band(fit, band, on_waist, Y(0.612), 0.028, d=0.0075, n=20, rows=2)
    ck.thicken(band, 0.0022, depth=None, crease=0.1)
    pieces.append(band)
    bw = ck.Piece("apron_bow", MD_BAND, scale=1.2)
    on_back = ck.Onto([band, sk])
    gw.bow(bw, on_back, (0.0, Y(0.612), -0.2), size=0.075, tails=0.30, lift=0.006)
    ck.thicken(bw, 0.0016, depth=None, crease=0.08)
    pieces.append(bw)
    # the cap: small, set back on the head over the pinned hair, a frill round it and two short lappets behind
    cap = ck.Piece("cap", MD_CAP, scale=1.4, hat=True)
    fr = ck.Piece("cap_frill", MD_FRILL, scale=1.4, hat=True)
    cid = ck.hood_cap(fit, cap, frill=fr, margin=0.015, front=8.0, back=112.0, side=78.0, cols=11, rows=7)
    ck.thicken(cap, 0.0014, depth=0.02)
    ck.thicken(fr, 0.0010, depth=None, crease=0.06)
    lp = ck.Piece("cap_lappets", MD_FRILL, scale=1.4, hat=True)
    V = np.array(cap.V)
    gw.lappets(fit, lp, [V[cid[-1, 1]], V[cid[-1, -2]]], length=0.11, width=0.028)
    ck.thicken(lp, 0.0010, depth=None, crease=0.06)
    pieces += [cap, fr, lp]
    bt = ck.Piece("boots", BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        gw.boots_light(fit, bt, so, S)
    pieces += [bt, so]
    return pieces


maid_covers = covers_dress(PS, neck_top=0.81)


def maid_skin(ctx):
    stockings(ctx, (0.08, 0.08, 0.09))
    ck.undershirt(ctx, (0.15, 0.16, 0.20), 0.0, zone=1, covers=maid_covers, skip=("leg",))


MAID = Kind(
    "maid", "women", "woman_slight",
    face=dict(type="young_woman", seed=1873202, sex="f", age=20,
              look=dict(weather=0.2, ruddy=0.3, hair="dark", hair_rgb=hexrgb(0x3a2a1e))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=maid_dress, covers=maid_covers, skin=maid_skin, hats=("cap", "cap_frill", "cap_lappets"),
    held=[("held_basket_cloth", "hipL", "her market basket under a white cloth, at the left hip")],
    avoid={"walk": "walk_f is hers", "talk": "talk_f is hers", "rifle_idle": "no rifle", "rifle_walk": "no rifle",
           "rifle_talk": "no rifle", "ride": "the skirt"},
    note="a maid on an errand: navy dress, white collar and cuffs, small white cap set back with lappets, white bib "
         "apron tied in a bow behind, a basket under a cloth")


# ---------------------------------------------------------------- nun: a Black Sister (Zwartzuster)

BLACK = (0.055, 0.055, 0.062)
NU_HABIT = Cloth(BLACK, "wool", wear=0.25, dust=0.06, lining=(0.04, 0.04, 0.045), extra=_side_seams)
NU_SKIRT = Cloth(BLACK, "wool", wear=0.25, mud=0.3, mud_h=0.10, extra=_skirt_extra(hem_dark=0.15),
                 lining=(0.04, 0.04, 0.045))
NU_WHITE = Cloth((0.91, 0.91, 0.88), "linen", wear=0.05, folds=0.2, extra=_linen_white, lining=(0.84, 0.84, 0.80))
NU_VEIL = Cloth((0.045, 0.045, 0.05), "wool", wear=0.15, folds=0.8, lining=(0.035, 0.035, 0.04))
NU_BELT = Cloth((0.03, 0.03, 0.03), "leather", wear=0.3, folds=0.0)


def nun_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []
    sk = ck.Piece("habit_skirt", NU_SKIRT)
    gw.skirt(fit, sk, 0.025, n=26, ease=0.016, clear=0.06, flare=0.30, folds=11, fold_depth=0.026, back_legs=0.75)
    ck.thicken(sk, 0.003, depth=lambda p: 0.10 if p[1] < 0.5 else 0.03)
    pieces.append(sk)
    # the habit's body: loose, wide sleeves opening toward the wrist
    ease = gw.ease_table(fit, torso={9: 0.010, 8: 0.012, 7: 0.016, 6: 0.016, 5: 0.018, 4: 0.020, 3: 0.026, 2: 0.032},
                         arm=[0.010, 0.014, 0.018, 0.022, 0.026, 0.030, 0.034, 0.038, 0.044, 0.050, 0.052])
    bo = gw.bodice(fit, NU_HABIT, ease, name="habit")
    ck.thicken(bo, 0.003, depth=lambda p: 0.08 if p[1] < bd.Y(P, 0.62) else 0.035)
    pieces.append(bo)
    on_bodice = ck.Onto([bo])
    belt = ck.Piece("belt", NU_BELT, scale=1.2)
    ck.band(fit, belt, ck.Onto([bo, sk], skip_zones=("arm",)), Y(0.618), 0.030, d=0.006, n=20, rows=2)
    ck.thicken(belt, 0.004, depth=None, crease=0.1)
    pieces.append(belt)
    # the white: the bib over the chest and shoulders, the wimple under the chin, the coif round the face
    bib = ck.Piece("guimpe", NU_WHITE, scale=1.1)
    gw.pelerine(fit, bib, on_bodice, 0.17, 0.06, n=24, rings=4, up=0.004, lift=0.005)
    ck.thicken(bib, 0.0018, depth=None, crease=0.08)
    pieces.append(bib)
    on_bib = ck.Onto([bib, bo])
    wm = ck.Piece("wimple", NU_WHITE, scale=1.2, hat=True)
    gw.wimple(fit, wm, on_bib, n=13, rows=5, half=118.0)
    ck.thicken(wm, 0.0018, depth=None, crease=0.06)
    pieces.append(wm)
    co = ck.Piece("coif", NU_WHITE, scale=1.2, hat=True)
    gw.coif(fit, co, margin=0.025, front=-56.0, side=116.0, back=128.0)
    ck.thicken(co, 0.0018, depth=0.02)
    pieces.append(co)
    ve = ck.Piece("veil", NU_VEIL, scale=1.0, hat=True)
    gw.veil(fit, ve, margin=0.055, front=-46.0, back=150.0, side=106.0, fall=0.32, front_cut=0.0)
    ck.thicken(ve, 0.0022, depth=0.03, crease=0.06)
    pieces.append(ve)
    bt = ck.Piece("boots", BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        gw.boots_light(fit, bt, so, S)
    pieces += [bt, so]
    return pieces


def nun_covers(p, part):
    x, y, z = p
    if part in ("torso", "neck"):
        return True
    if part.startswith("arm"):
        return y > bd.Y(PS, 0.501) + 0.025
    if part.startswith("leg"):
        return y > 0.40 or y < 0.115
    return False


def nun_skin(ctx):
    stockings(ctx, (0.05, 0.05, 0.055))
    ck.undershirt(ctx, (0.05, 0.05, 0.055), 0.0, zone=1, covers=nun_covers, skip=("leg",))


NUN = Kind(
    "nun", "women", "woman_slight",
    face=dict(type="young_woman", seed=1873211, sex="f", age=34, look=dict(weather=0.15, ruddy=0.2)),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=nun_dress, covers=nun_covers, skin=nun_skin, hats=("coif", "wimple", "veil"),
    held=[("held_rosary", "hipL", "her rosary hanging from the belt at the left hip")],
    avoid={"walk": "walk_f is hers", "talk": "talk_f is hers", "rifle_idle": "no rifle", "rifle_walk": "no rifle",
           "rifle_talk": "no rifle", "ride": "the habit", "smoke": "a sister", "beg": "a sister"},
    note="a Black Sister (Zwartzuster) who nurses the sick at home: black habit with wide sleeves, black belt, white "
         "coif, wimple and bib, black veil, a rosary")




# ---------------------------------------------------------------- shared makers for the rest

AVOID_W = {"walk": "walk_f is hers", "talk": "talk_f is hers", "rifle_idle": "no rifle", "rifle_walk": "no rifle",
           "rifle_talk": "no rifle", "ride": "the skirt"}
PM = PA
PST = bd.params("woman", "stout")
PO = bd.params("old_woman", "stooped")
PC = bd.params("child", "middling")
PCS = bd.params("child", "slight")


def _print_dots(dot_rgb, every=0.022, r=0.0035):
    """A printed cotton: small dots (a kerchief's), offset rows."""
    def f(ctx):
        u = ctx.x + 0.4 * ctx.z
        v = ctx.y
        row = np.floor(v / every)
        uu = (u / every + 0.5 * (row % 2)) % 1.0 - 0.5
        vv = (v / every) % 1.0 - 0.5
        d = np.hypot(uu, vv) * every
        ctx.mix(sm(r + 0.0008, r - 0.0008, d) * (~ctx.inner) * 0.85, dot_rgb)
    return f


def _clogs_extra(ctx):
    """Willow clogs: the grain along the foot, darker on the worn top."""
    g = np.sin(ctx.z * 260 + 3 * np.sin(ctx.x * 90)) * 0.5 + 0.5
    ctx.rgb[:] = ctx.rgb * (0.85 + 0.2 * g)[:, None]
    ctx.bump(g, 0.00015)
    top = ctx.nrm[:, 1] > 0.6
    ctx.mul(top & (ctx.y > 0.05), 0.82)


CLOG = Cloth((0.50, 0.40, 0.27), "wood", wear=0.3, mud=0.7, mud_h=0.05, folds=0.0, extra=_clogs_extra)


def clog_pair(fit, pieces, name="clogs"):
    cl = ck.Piece(name, CLOG, scale=1.2)
    for S in "LR":
        ck.clogs(fit, cl, S)
    pieces.append(cl)


def boot_pair(fit, pieces, boot=None):
    bt = ck.Piece("boots", boot or BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        gw.boots_light(fit, bt, so, S)
    pieces += [bt, so]


def base_dress(fit, skirt_cloth, bodice_cloth, hem, pieces, sleeve="w1", ease=None, flare=0.20, folds=9,
               fold_depth=0.018, n=24, skirt_ease=0.013, bustle=None, train=0.0, slim_front=0.5, clear=0.045,
               snap_arms=False):
    sk = ck.Piece("skirt", skirt_cloth)
    gw.skirt(fit, sk, hem, n=n, ease=skirt_ease, clear=clear, flare=flare, folds=folds, fold_depth=fold_depth,
             back_legs=0.75, bustle=bustle, train=train, slim_front=slim_front)
    ck.thicken(sk, 0.003, depth=lambda p: 0.10 if p[1] < 0.5 else 0.03)
    pieces.append(sk)
    bo = gw.bodice(fit, bodice_cloth, ease or gw.ease_table(fit), sleeve=sleeve, snap_arms=snap_arms)
    pieces.append(bo)
    return sk, bo


def finish_bodice(bo):
    ck.thicken(bo, 0.0028, depth=0.035)


def apron_with_band(fit, pieces, cloth, band_cloth, sk, bo, top, bottom, half=70.0, n=13, folds=0.006):
    on_skirt = ck.Onto([sk])
    ap = ck.Piece("apron", cloth)
    gw.apron(fit, ap, on_skirt, top, bottom, half=half, n=n, folds=folds)
    ck.thicken(ap, 0.0022, depth=0.03)
    pieces.append(ap)
    band = ck.Piece("apron_band", band_cloth, scale=1.2)
    ck.band(fit, band, ck.Onto([bo, sk], skip_zones=("arm",)), top + 0.012, 0.030, d=0.008, n=20, rows=2)
    ck.thicken(band, 0.0026, depth=None, crease=0.1)
    pieces.append(band)
    return ap, band


def shawl_piece(fit, pieces, cloth, bo, fringe_cloth=None, **kw):
    on_bodice = ck.Onto([bo])
    sw = ck.Piece("shawl", cloth, scale=0.95)
    wts = shoulder_weights(on_bodice)
    ids = _shawl_on(fit, sw, on_bodice, wfn=wts, **kw)
    ck.thicken(sw, 0.0028, depth=0.03, crease=0.06)
    pieces.append(sw)
    if fringe_cloth is not None:
        fr = ck.Piece("shawl_fringe", fringe_cloth, scale=1.3)
        on_all = ck.Onto([bo, sw])
        V = np.array(sw.V)
        R = ids.shape[0]
        mid = R // 2
        gw.fringe(fit, fr, [V[ids[r, -1]] for r in range(mid - 9, mid + 10)], on_all, length=0.06, lift=0.006,
                  wfn=wts)
        for r in (0, R - 1):
            gw.fringe(fit, fr, [V[ids[r, c]] for c in range(ids.shape[1])], on_all, length=0.05, lift=0.006,
                      wfn=wts)
        ck.thicken(fr, 0.0012, depth=None, crease=0.9)
        pieces.append(fr)
    return sw


def skin_dress(stock_rgb, under_rgb, covers, hands=None, gloves=None):
    def f(ctx):
        stockings(ctx, stock_rgb)
        hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
        if hands is not None:
            ctx.mix(hand * hands[1], hands[0])
        if gloves is not None:
            g = ck.starts(ctx.part, ("finger",)) | (ck.starts(ctx.part, ("arm",)) & (ctx.y < bd.Y(ctx.P, 0.505)))
            seam = np.sin(ctx.x * 2000) * 0.5 + 0.5
            ctx.rgb[g] = np.array(gloves, np.float32) * (0.92 + 0.08 * seam[g])[:, None]
            ctx.detail_zone[g] = 4
        ck.undershirt(ctx, under_rgb, 0.0, zone=1, covers=covers, skip=("leg",))
    return f


def frill_round(fit, cap, cid, name, cloth, offsets, wave=0.005):
    """A second row of frill round a hood cap's front edge, standing out (a deeper goffered border)."""
    fr = ck.Piece(name, cloth, scale=1.3, hat=True)
    V = np.array(cap.V)
    c, _ = gw.head_centre(fit)
    rows = []
    for k, o in enumerate(offsets):
        row = []
        for j in range(cid.shape[1]):
            p = V[cid[0, j]]
            d = gw.norm(p - c)
            row.append(p + d * (0.004 + o) + np.array((0.0, 0.0, 1.0)) * o * 0.6
                       + d * wave * math.sin(j * 2.3) * k / max(1, len(offsets) - 1))
        rows.append(row)
    fr.grid(np.array(rows), lambda p: {"head": 1.0})
    fr.orient(lambda q: q - c + np.array((0, 0, 0.05)))
    return fr


# ---------------------------------------------------------------- wife_b: a docker's wife in brown, blue kerchief

WB_BROWN = hexrgb(0x5a3e2a)
WB_BODICE = Cloth(WB_BROWN, "wool", wear=0.45, dust=0.1, extra=_bodice_extra(8, 0.795), lining=(0.28, 0.20, 0.14))
WB_SKIRT = Cloth(hexrgb(0x4e3624), "wool", wear=0.45, mud=0.9, mud_h=0.22, extra=_skirt_extra(tucks=(0.17,)),
                 lining=(0.30, 0.22, 0.15))
WB_SHAWL = Cloth(hexrgb(0x2a2626), "wool", wear=0.35, dust=0.08, folds=0.6, extra=_knit_extra(),
                 lining=(0.14, 0.13, 0.13))
WB_KERCHIEF = Cloth(hexrgb(0x2e3a52), "cotton", wear=0.25, folds=0.8, extra=_print_dots((0.80, 0.80, 0.74)),
                    lining=(0.20, 0.26, 0.38))


def wife_b_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, WB_SKIRT, WB_BODICE, 0.075, pieces, sleeve="e3")
    finish_bodice(bo)
    sw = shawl_piece(fit, pieces, WB_SHAWL, bo, ends="cross", cross=0.07, back=0.36, front_y=0.625)
    band = ck.Piece("shawl_tie", WB_SHAWL, scale=1.0)
    ck.band(fit, band, ck.Onto([sw, bo, sk], skip_zones=("arm",)), Y(0.618), 0.035, d=0.006, n=20, rows=2)
    ck.thicken(band, 0.003, depth=None, crease=0.1)
    pieces.append(band)
    kc = ck.Piece("kerchief", WB_KERCHIEF, scale=1.2, hat=True)
    kn = ck.Piece("kerchief_knot", WB_KERCHIEF, scale=1.3, hat=True)
    gw.kerchief(fit, kc, tie="nape", margin=0.014, front=-44.0, knot=kn)
    kp = ck.Piece("kerchief_point", WB_KERCHIEF, scale=1.2, hat=True)
    gw.kerchief_point(fit, kp, kc)
    ck.thicken(kc, 0.0014, depth=0.02, crease=0.06)
    ck.thicken(kn, 0.0014, depth=None, crease=0.06)
    ck.thicken(kp, 0.0014, depth=None, crease=0.06)
    pieces += [kc, kn, kp]
    clog_pair(fit, pieces)
    return pieces


wife_b_covers = covers_dress(PM, sleeve_to=0.60, leg_lo=0.06)
WIFE_B = Kind(
    "wife_b", "women", "woman_middling",
    face=dict(type="round_flemish_woman", seed=1873203, sex="f", age=42,
              look=dict(weather=0.7, ruddy=0.5, hair="dark", hair_rgb=hexrgb(0x2a201a))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=wife_b_dress, covers=wife_b_covers,
    skin=skin_dress((0.20, 0.18, 0.16), (0.27, 0.19, 0.13), wife_b_covers, hands=((0.76, 0.46, 0.40), 0.3)),
    hats=("kerchief", "kerchief_knot", "kerchief_point"), avoid=AVOID_W,
    note="a docker's wife: blue printed kerchief knotted at the nape, dark knitted shawl crossed and tied, brown "
         "dress with the sleeves to the elbow, wooden clogs")


# ---------------------------------------------------------------- fishwife_b: older, red kerchief, mussels

FB_BODICE = Cloth(hexrgb(0x2a2826), "wool", wear=0.5, dust=0.1, extra=_bodice_extra(7, 0.79), lining=(0.16, 0.15, 0.14))
FB_SKIRT = Cloth(hexrgb(0x2e3a30), "wool", wear=0.5, mud=1.0, mud_h=0.25, extra=_skirt_extra(tucks=(0.19,)),
                 lining=(0.20, 0.25, 0.20))
FB_APRON = Cloth(hexrgb(0x8a9496), "canvas", wear=0.55, mud=0.5, mud_h=0.22,
                 extra=_apron_extra(0.45, stain_rgb=(0.40, 0.42, 0.40)), folds=1.0)
FB_SHAWL = Cloth(hexrgb(0x3a3a44), "wool", wear=0.4, dust=0.1, folds=0.6, extra=_knit_extra(rib=0.012),
                 lining=(0.18, 0.18, 0.21))
FB_KERCHIEF = Cloth(hexrgb(0x7a2e28), "cotton", wear=0.35, folds=0.8, extra=_print_dots((0.86, 0.80, 0.62), 0.018),
                    lining=(0.42, 0.18, 0.15))


def fishwife_b_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, FB_SKIRT, FB_BODICE, 0.085, pieces, sleeve="f1")
    finish_bodice(bo)
    shawl_piece(fit, pieces, FB_SHAWL, bo, ends="cross", cross=0.06, back=0.34, front_y=0.64)
    apron_with_band(fit, pieces, FB_APRON, FB_APRON, sk, bo, Y(0.600), Y(0.22), half=75.0)
    kc = ck.Piece("kerchief", FB_KERCHIEF, scale=1.2, hat=True)
    kn = ck.Piece("kerchief_knot", FB_KERCHIEF, scale=1.3, hat=True)
    gw.kerchief(fit, kc, tie="chin", margin=0.015, front=-42.0, knot=kn)
    ck.thicken(kc, 0.0014, depth=0.02, crease=0.06)
    ck.thicken(kn, 0.0014, depth=None, crease=0.06)
    pieces += [kc, kn]
    clog_pair(fit, pieces)
    return pieces


fishwife_b_covers = covers_dress(PS, sleeve_to=0.586, leg_lo=0.06)
FISHWIFE_B = Kind(
    "fishwife_b", "women", "woman_slight",
    face=dict(type="lean_widow", seed=1873204, sex="f", age=57,
              look=dict(weather=0.95, ruddy=0.7, hair="grey", hair_rgb=hexrgb(0x9a948c))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=fishwife_b_dress, covers=fishwife_b_covers,
    skin=skin_dress((0.24, 0.24, 0.26), (0.16, 0.15, 0.14), fishwife_b_covers, hands=((0.78, 0.42, 0.36), 0.4)),
    hats=("kerchief", "kerchief_knot"),
    held=[("held_mussels", "hipL", "a round basket heaped with mussels at the left hip")], avoid=AVOID_W,
    note="an older fishwife: red printed kerchief tied under the chin, grey knitted shawl crossed, near-black bodice, "
         "dark green skirt, grey canvas apron, clogs, a basket of mussels")


# ---------------------------------------------------------------- shopwife: black, white bib apron, lace cap

SW_BLACK = (0.075, 0.07, 0.075)
SW_BODICE = Cloth(SW_BLACK, "wool", wear=0.15, sheen=0.2, extra=_bodice_extra(12, 0.81, (0.02, 0.02, 0.02)),
                  lining=(0.05, 0.05, 0.05))
SW_SKIRT = Cloth(SW_BLACK, "wool", wear=0.15, mud=0.3, mud_h=0.1, extra=_skirt_extra(hem_dark=0.15),
                 lining=(0.05, 0.05, 0.05))
SW_APRON = Cloth((0.90, 0.89, 0.85), "linen", wear=0.1, mud=0.1, mud_h=0.1, extra=_apron_extra(0.06), folds=0.6)


def _lace(ctx):
    """Bobbin lace: a net of small holes (shadowed) and a pattern of flowers in relief."""
    u = ctx.x + ctx.z * 0.6
    v = ctx.y + ctx.z * 0.3
    net = np.sin(u * 2 * math.pi / 0.004) * np.sin(v * 2 * math.pi / 0.004)
    holes = sm(0.55, 0.85, net)
    ctx.mul(holes * (~ctx.inner), 0.62)
    ctx.bump(-holes, 0.0002)
    flowers = np.sin(u * 2 * math.pi / 0.02) * np.sin(v * 2 * math.pi / 0.02)
    ctx.bump(sm(0.6, 0.9, flowers), 0.0003)


SW_CAP = Cloth((0.93, 0.92, 0.89), "linen", wear=0.05, extra=_lace, folds=0.2, lining=(0.86, 0.85, 0.82))
SW_FRILL = Cloth((0.94, 0.93, 0.90), "linen", wear=0.05, extra=_lace, folds=0.0)


def shopwife_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, SW_SKIRT, SW_BODICE, 0.055, pieces, flare=0.22, folds=10)
    finish_bodice(bo)
    on_bodice = ck.Onto([bo])
    col = ck.Piece("collar", SW_FRILL, scale=1.4)
    gw.pelerine(fit, col, on_bodice, 0.05, 0.035, n=24, rings=2, up=0.010, front_gap=0.010)
    ck.thicken(col, 0.0014, depth=None, crease=0.1)
    pieces.append(col)
    apron_with_band(fit, pieces, SW_APRON, SW_APRON, sk, bo, Y(0.600), Y(0.16), half=78.0, n=15, folds=0.008)
    bb = ck.Piece("apron_bib", SW_APRON, scale=1.1)
    gw.bib(fit, bb, on_bodice, Y(0.612), Y(0.75), w_bottom=0.21, w_top=0.18, lift=0.005)
    ck.thicken(bb, 0.0018, depth=None, crease=0.08)
    pieces.append(bb)
    cap = ck.Piece("cap", SW_CAP, scale=1.4, hat=True)
    fr = ck.Piece("cap_frill", SW_FRILL, scale=1.4, hat=True)
    cid = ck.hood_cap(fit, cap, frill=fr, margin=0.015, front=-14.0, back=106.0, side=92.0, cols=13, rows=8)
    fr2 = frill_round(fit, cap, cid, "cap_frill2", SW_FRILL, (0.006, 0.016, 0.026))
    lp = ck.Piece("cap_lappets", SW_FRILL, scale=1.4, hat=True)
    V = np.array(cap.V)
    gw.lappets(fit, lp, [V[cid[3, 0]], V[cid[3, -1]]], length=0.14, width=0.034)
    ck.thicken(cap, 0.0014, depth=0.02)
    for pc_ in (fr, fr2, lp):
        ck.thicken(pc_, 0.0010, depth=None, crease=0.06)
    pieces += [cap, fr, fr2, lp]
    boot_pair(fit, pieces)
    return pieces


shopwife_covers = covers_dress(PST, neck_top=0.82)
SHOPWIFE = Kind(
    "shopwife", "women", "woman_stout",
    face=dict(type="round_flemish_woman", seed=1873205, sex="f", age=48,
              look=dict(weather=0.25, ruddy=0.35, hair="brown", hair_rgb=hexrgb(0x7a5a38))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=shopwife_dress, covers=shopwife_covers,
    skin=skin_dress((0.06, 0.06, 0.065), (0.06, 0.06, 0.065), shopwife_covers),
    hats=("cap", "cap_frill", "cap_frill2", "cap_lappets"),
    held=[("held_keys", "hipL", "her keys on an iron ring hooked at the waist")], avoid=AVOID_W,
    note="the shopkeeper's wife: black dress with jet buttons, white lace collar and a lace cap with a double frill "
         "and lappets, white bib apron, her keys at the waist")


# ---------------------------------------------------------------- old_woman: black, big frilled cap, wrapped shawl

OW_BODICE = Cloth((0.07, 0.07, 0.075), "wool", wear=0.55, dust=0.12, extra=_bodice_extra(8, 0.79),
                  lining=(0.05, 0.05, 0.05))
OW_SKIRT = Cloth((0.08, 0.08, 0.085), "wool", wear=0.55, mud=0.6, mud_h=0.15, extra=_skirt_extra(hem_dark=0.3),
                 lining=(0.05, 0.05, 0.05))
OW_SHAWL = Cloth(hexrgb(0x3a3230), "wool", wear=0.5, dust=0.1, folds=0.9, lining=(0.18, 0.15, 0.14),
                 extra=_shawl_check(None, [((0.16, 0.13, 0.12), 0.10, 1, 0.6)], size=0.03))
OW_FRINGE = Cloth(hexrgb(0x2e2826), "wool", wear=0.4, folds=0.0, extra=_fringe_extra)
OW_CAP = Cloth((0.86, 0.85, 0.80), "linen", wear=0.25, extra=_linen_white, folds=0.3, lining=(0.80, 0.78, 0.74))
OW_FRILL = Cloth((0.88, 0.87, 0.83), "linen", wear=0.2, extra=_frill_extra, folds=0.0)
OW_TIES = Cloth((0.08, 0.08, 0.09), "cotton", wear=0.2, folds=0.0)


def old_woman_dress(fit):
    pieces = []
    sk, bo = base_dress(fit, OW_SKIRT, OW_BODICE, 0.050, pieces, flare=0.16, folds=8,
                        ease=gw.ease_table(fit, medial=0.0), snap_arms=True)
    finish_bodice(bo)
    shawl_piece(fit, pieces, OW_SHAWL, bo, fringe_cloth=OW_FRINGE, ends="cross", cross=0.05, back=0.44,
                shoulder=0.19, front=0.13, front_y=0.60)
    cap = ck.Piece("cap", OW_CAP, scale=1.3, hat=True)
    fr = ck.Piece("cap_frill", OW_FRILL, scale=1.3, hat=True)
    cid = ck.hood_cap(fit, cap, frill=fr, margin=0.015, front=-40.0, back=112.0, side=104.0, cols=13, rows=9)
    fr2 = frill_round(fit, cap, cid, "cap_frill2", OW_FRILL, (0.0, 0.012, 0.024))
    tie = ck.Piece("cap_ties", OW_TIES, scale=1.3, hat=True)
    gw.ties(fit, tie, cap_corners(cap, cid), width=0.014)
    ck.thicken(cap, 0.0016, depth=0.02)
    for pc_ in (fr, fr2, tie):
        ck.thicken(pc_, 0.0011, depth=None, crease=0.06)
    pieces += [cap, fr, fr2, tie]
    boot_pair(fit, pieces)
    return pieces


old_woman_covers = covers_dress(PO)
# The dressed old woman cannot carry the kind's own name: "old_woman" is also the base body's armature (the build
# would make a second "old_woman" and Blender renames it). The game routes the kind to this root with
# --people2-map old_woman=old_woman_dressed until People2.Body learns the alias (see the C2 report).
OLD_WOMAN = Kind(
    "old_woman_dressed", "women", "old_woman",
    face=dict(type="shrunken_old", seed=1873206, sex="f", age=72,
              look=dict(weather=0.7, ruddy=0.3, hair="grey", hair_rgb=hexrgb(0xb0aca4))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=old_woman_dress, covers=old_woman_covers,
    skin=skin_dress((0.06, 0.06, 0.065), (0.06, 0.06, 0.065), old_woman_covers),
    hats=("cap", "cap_frill", "cap_frill2", "cap_ties"), avoid=AVOID_W,
    note="an old woman: white cap with a deep goffered frill tied under the chin with black strings, dark check "
         "shawl with a fringe crossed over the breast, black dress, boots")


# ---------------------------------------------------------------- milk_woman: blue apron, red fichu, clogs

MW_BODICE = Cloth(hexrgb(0x46505a), "wool", wear=0.45, dust=0.08, extra=_bodice_extra(8, 0.795),
                  lining=(0.24, 0.27, 0.30))
MW_SKIRT = Cloth(hexrgb(0x3a4652), "wool", wear=0.4, mud=1.0, mud_h=0.28, extra=_skirt_extra(tucks=(0.21,)),
                 lining=(0.22, 0.26, 0.30))
MW_APRON = Cloth(hexrgb(0x4a6a8a), "linen", wear=0.45, mud=0.6, mud_h=0.25,
                 extra=_apron_extra(0.30, stain_rgb=(0.86, 0.85, 0.80)), folds=1.0)
MW_FICHU = Cloth(hexrgb(0x8a3a2e), "cotton", wear=0.3, folds=0.8, lining=(0.45, 0.20, 0.16),
                 extra=_shawl_check(None, [((0.86, 0.82, 0.74), 0.08, 1, 0.8)], size=0.022))
MW_CAP = Cloth((0.87, 0.86, 0.81), "linen", wear=0.2, extra=_linen_white, folds=0.3, lining=(0.80, 0.78, 0.74))
MW_FRILL = Cloth((0.89, 0.88, 0.84), "linen", wear=0.15, extra=_frill_extra, folds=0.0)


def milk_woman_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, MW_SKIRT, MW_BODICE, 0.11, pieces, sleeve="e3", flare=0.18)
    finish_bodice(bo)
    shawl_piece(fit, pieces, MW_FICHU, bo, ends="cross", cross=0.05, back=0.26, shoulder=0.12, front=0.09,
                front_y=0.66)
    apron_with_band(fit, pieces, MW_APRON, MW_APRON, sk, bo, Y(0.600), Y(0.14), half=95.0, n=17, folds=0.008)
    cap = ck.Piece("cap", MW_CAP, scale=1.3, hat=True)
    fr = ck.Piece("cap_frill", MW_FRILL, scale=1.3, hat=True)
    cid = ck.hood_cap(fit, cap, frill=fr, margin=0.015, front=-36.0, back=110.0, side=100.0, cols=13, rows=9)
    tie = ck.Piece("cap_ties", MW_CAP, scale=1.3, hat=True)
    gw.ties(fit, tie, cap_corners(cap, cid))
    ck.thicken(cap, 0.0016, depth=0.02)
    ck.thicken(fr, 0.0011, depth=None, crease=0.06)
    ck.thicken(tie, 0.0010, depth=None, crease=0.06)
    pieces += [cap, fr, tie]
    clog_pair(fit, pieces)
    return pieces


milk_woman_covers = covers_dress(PM, sleeve_to=0.60, leg_lo=0.06)
MILK_WOMAN = Kind(
    "milk_woman", "women", "woman_middling",
    face=dict(type="round_flemish_woman", seed=1873207, sex="f", age=36,
              look=dict(weather=0.8, ruddy=0.7, hair="brown", hair_rgb=hexrgb(0x6a4a2a))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=milk_woman_dress, covers=milk_woman_covers,
    skin=skin_dress((0.30, 0.30, 0.32), (0.24, 0.27, 0.30), milk_woman_covers, hands=((0.80, 0.46, 0.40), 0.35)),
    hats=("cap", "cap_frill", "cap_ties"),
    held=[("held_purse", "hipL", "her leather money pouch over the apron at the left hip")], avoid=AVOID_W,
    note="the milk woman with her dog cart: white frilled cap tied under the chin, red check neckerchief crossed, "
         "blue-grey bodice with the sleeves to the elbow, a wide blue apron, clogs, a money pouch")


# ---------------------------------------------------------------- girls

GI_DRESS = Cloth(hexrgb(0x6a5a3a), "wool", wear=0.5, extra=_bodice_extra(6, 0.78), lining=(0.34, 0.29, 0.20))
GI_SKIRT = Cloth(hexrgb(0x5a4a32), "wool", wear=0.5, mud=0.8, mud_h=0.30, extra=_skirt_extra(tucks=(0.32,)),
                 lining=(0.30, 0.25, 0.17))
GI_SHAWL = Cloth(hexrgb(0x5a3a3a), "wool", wear=0.4, folds=0.6, extra=_knit_extra(), lining=(0.30, 0.20, 0.20))
CHILD_ARM = [0.008, 0.009, 0.010, 0.010, 0.010, 0.011, 0.011, 0.011, 0.010, 0.010, 0.009]


def girl_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, GI_SKIRT, GI_DRESS, Y(0.16), pieces, ease=gw.ease_table(fit, arm=CHILD_ARM, medial=0.010),
                        flare=0.25, folds=8, fold_depth=0.012, n=20, clear=0.035, slim_front=0.3)
    finish_bodice(bo)
    sw = shawl_piece(fit, pieces, GI_SHAWL, bo, ends="cross", cross=0.05, back=0.26, shoulder=0.12, front=0.085,
                     front_y=0.625)
    band = ck.Piece("shawl_tie", GI_SHAWL, scale=1.0)
    ck.band(fit, band, ck.Onto([sw, bo, sk], skip_zones=("arm",)), Y(0.615), 0.028, d=0.005, n=18, rows=2)
    ck.thicken(band, 0.003, depth=None, crease=0.1)
    pieces.append(band)
    clog_pair(fit, pieces)
    return pieces


def covers_child(P):
    def f(p, part):
        x, y, z = p
        if part == "torso":
            return True
        if part == "neck":
            return y < bd.Y(P, 0.79)
        if part.startswith("arm"):
            return y > bd.Y(P, 0.501) + 0.025
        if part.startswith("leg"):
            return y > bd.Y(P, 0.36) or y < 0.06
        return False
    return f


girl_covers = covers_child(PC)
GIRL = Kind(
    "girl", "women", "child_middling",
    face=dict(type="small_child", seed=1873208, sex="f", age=9, look=dict(weather=0.4, ruddy=0.5)),
    hair=dict(hair="plaits", beard=None, moustache=None),
    dress=girl_dress, covers=girl_covers,
    skin=skin_dress((0.20, 0.17, 0.15), (0.30, 0.25, 0.17), girl_covers),
    hats=(), avoid=AVOID_W,
    note="a poor girl: brown dress to the calf, a small red-brown knitted shawl crossed and tied behind, plaits, clogs")


def _plaid(ctx):
    gw.tartan(ctx, ctx.x + 0.3 * ctx.z, ctx.y, [((0.18, 0.29, 0.24), 0.010), ((0.54, 0.22, 0.16), 0.003),
                                               ((0.18, 0.29, 0.24), 0.010), ((0.10, 0.14, 0.18), 0.006),
                                               ((0.70, 0.62, 0.40), 0.0015)])


def _both(*fs):
    def f(ctx):
        for g in fs:
            g(ctx)
    return f


GB_BODICE = Cloth(hexrgb(0x2e4a3e), "wool", wear=0.3, extra=_both(_plaid, _bodice_extra(6, 0.78)),
                  lining=(0.18, 0.28, 0.24))
GB_SKIRT = Cloth(hexrgb(0x2e4a3e), "wool", wear=0.3, mud=0.5, mud_h=0.25,
                 extra=_both(_plaid, _skirt_extra(hem_dark=0.2)), lining=(0.18, 0.28, 0.24))
GB_PINAFORE = Cloth(hexrgb(0xcac2ae), "cotton", wear=0.3, mud=0.3, mud_h=0.25, extra=_apron_extra(0.15, pocket=False),
                    folds=0.8)
GB_COLLAR = Cloth((0.88, 0.86, 0.80), "linen", wear=0.1, folds=0.0, extra=_linen_white)


def girl_b_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, GB_SKIRT, GB_BODICE, Y(0.15), pieces, ease=gw.ease_table(fit, arm=CHILD_ARM, medial=0.010),
                        flare=0.28, folds=8, fold_depth=0.012, n=20, clear=0.035, slim_front=0.3)
    finish_bodice(bo)
    on_bodice = ck.Onto([bo])
    col = ck.Piece("collar", GB_COLLAR, scale=1.4)
    gw.pelerine(fit, col, on_bodice, 0.040, 0.035, n=20, rings=2, up=0.006)
    ck.thicken(col, 0.0014, depth=None, crease=0.1)
    pieces.append(col)
    apron_with_band(fit, pieces, GB_PINAFORE, GB_PINAFORE, sk, bo, Y(0.598), Y(0.20), half=95.0, n=15, folds=0.006)
    bb = ck.Piece("pinafore_bib", GB_PINAFORE, scale=1.1)
    gw.bib(fit, bb, on_bodice, Y(0.61), Y(0.74), w_bottom=0.17, w_top=0.16, lift=0.005)
    ck.thicken(bb, 0.0018, depth=None, crease=0.08)
    st = ck.Piece("pinafore_straps", GB_PINAFORE, scale=1.1)
    gw.straps(fit, st, ck.Onto([bo, bb]), 0.065, Y(0.74), Y(0.61), width=0.04, lift=0.012, rows=24)
    ck.thicken(st, 0.0018, depth=None, crease=0.08)
    pieces += [bb, st]
    boot_pair(fit, pieces)
    return pieces


girl_b_covers = covers_child(PCS)
GIRL_B = Kind(
    "girl_b", "women", "child_slight",
    face=dict(type="lanky_child", seed=1873209, sex="f", age=8, look=dict(weather=0.2, ruddy=0.4)),
    hair=dict(hair="plaits", beard=None, moustache=None),
    dress=girl_b_dress, covers=girl_b_covers,
    skin=skin_dress((0.12, 0.12, 0.14), (0.18, 0.28, 0.24), girl_b_covers),
    hats=(), avoid=AVOID_W,
    note="a girl in her green plaid dress, white collar and a pinafore with straps over the shoulders, plaits, boots")


# ---------------------------------------------------------------- beguine: black, white cap, the falie

BG_BLACK = (0.05, 0.05, 0.055)
BG_BODICE = Cloth(BG_BLACK, "wool", wear=0.3, extra=_bodice_extra(10, 0.80, (0.02, 0.02, 0.02)),
                  lining=(0.04, 0.04, 0.045))
BG_SKIRT = Cloth(BG_BLACK, "wool", wear=0.3, mud=0.3, mud_h=0.1, extra=_skirt_extra(hem_dark=0.12),
                 lining=(0.04, 0.04, 0.045))
BG_FALIE = Cloth((0.035, 0.035, 0.04), "wool", wear=0.25, folds=1.2, lining=(0.03, 0.03, 0.035), sheen=0.15)
BG_CAP = Cloth((0.92, 0.92, 0.89), "linen", wear=0.05, extra=_linen_white, folds=0.2, lining=(0.86, 0.86, 0.82))
BG_FRILL = Cloth((0.93, 0.93, 0.90), "linen", wear=0.05, extra=_frill_extra, folds=0.0)


def beguine_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    sk, bo = base_dress(fit, BG_SKIRT, BG_BODICE, 0.030, pieces, flare=0.22, folds=10)
    finish_bodice(bo)
    on_bodice = ck.Onto([bo])
    col = ck.Piece("collar", BG_CAP, scale=1.4)
    gw.pelerine(fit, col, on_bodice, 0.035, 0.03, n=24, rings=2, up=0.010, front_gap=0.008)
    ck.thicken(col, 0.0014, depth=None, crease=0.1)
    pieces.append(col)
    cap = ck.Piece("cap", BG_CAP, scale=1.3, hat=True)
    fr = ck.Piece("cap_frill", BG_FRILL, scale=1.3, hat=True)
    ck.hood_cap(fit, cap, frill=fr, margin=0.015, front=-44.0, back=112.0, side=108.0, cols=13, rows=9)
    ck.thicken(cap, 0.0015, depth=0.02)
    ck.thicken(fr, 0.0010, depth=None, crease=0.06)
    pieces += [cap, fr]
    fa = ck.Piece("falie", BG_FALIE, scale=0.85, hat=True)
    gw.hood_mantle(fit, fa, ck.Onto([bo, col]), Y(0.22), margin=0.030, front=-24.0, side=104.0, open_half=26.0)
    ck.thicken(fa, 0.003, depth=0.05, crease=0.06)
    pieces.append(fa)
    boot_pair(fit, pieces)
    return pieces


beguine_covers = covers_dress(PM, neck_top=0.82)
BEGUINE = Kind(
    "beguine", "women", "woman_middling",
    face=dict(type="lean_widow", seed=1873212, sex="f", age=56, look=dict(weather=0.2, ruddy=0.2)),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=beguine_dress, covers=beguine_covers,
    skin=skin_dress((0.05, 0.05, 0.055), (0.05, 0.05, 0.055), beguine_covers),
    hats=("cap", "cap_frill", "falie"),
    held=[("held_rosary", "hipL", "her rosary hanging at the left hip")],
    avoid=dict(AVOID_W, smoke="a beguine", beg="a beguine"),
    note="a beguine of the Antwerp begijnhof: black dress, a small white collar, the white cap framing her face under "
         "the falie, the long black hooded mantle open in front, a rosary")


# ---------------------------------------------------------------- tourist_lady: a walking dress of 1873

TL_GREEN = hexrgb(0x2a3e34)
TL_BODICE = Cloth(TL_GREEN, "wool", wear=0.08, sheen=0.25, extra=_bodice_extra(14, 0.81, (0.10, 0.10, 0.09)),
                  lining=(0.15, 0.20, 0.17))
TL_SKIRT = Cloth(TL_GREEN, "wool", wear=0.08, mud=0.25, mud_h=0.06, sheen=0.25, extra=_skirt_extra(hem_dark=0.1),
                 lining=(0.15, 0.20, 0.17))
TL_OVER = Cloth(hexrgb(0x3a5044), "wool", wear=0.06, sheen=0.35, folds=1.4, lining=(0.20, 0.26, 0.22))
TL_FLOUNCE = Cloth(TL_GREEN, "wool", wear=0.06, sheen=0.25, folds=0.0, lining=(0.15, 0.20, 0.17))
TL_WHITE = Cloth((0.93, 0.92, 0.88), "linen", wear=0.02, folds=0.0, extra=_frill_extra)
TL_HAT = Cloth(hexrgb(0x3a2a3a), "felt", wear=0.05, folds=0.0, lining=(0.20, 0.15, 0.20))
TL_RIBBON = Cloth(hexrgb(0x5a3a52), "cotton", wear=0.0, folds=0.0, sheen=0.5)
TL_FEATHER = Cloth((0.80, 0.76, 0.70), "felt", wear=0.0, folds=0.0)
TL_BOOT = Cloth((0.05, 0.045, 0.045), "leather", wear=0.15, mud=0.2, mud_h=0.04, folds=0.0, extra=_boot_extra)


def tourist_lady_dress(fit):
    Y = lambda f: bd.Y(fit.P, f)
    pieces = []
    ease = gw.ease_table(fit, torso={3: 0.026, 2: 0.034},
                         arm=[0.007, 0.008, 0.009, 0.009, 0.009, 0.010, 0.010, 0.010, 0.010, 0.011, 0.012])
    bustle = (0.15, Y(0.635), Y(0.575), Y(0.36))
    sk, bo = base_dress(fit, TL_SKIRT, TL_BODICE, 0.022, pieces, ease=ease, flare=0.14, folds=10, fold_depth=0.016,
                        n=28, bustle=bustle, train=0.05, slim_front=0.75, clear=0.04)
    gw.basque(fit, bo, 0.07, flare=0.08, back_extra=0.05)
    finish_bodice(bo)
    on_skirt = ck.Onto([sk])
    fl = ck.Piece("flounce", TL_FLOUNCE, scale=1.0)
    gw.flounce(fit, fl, on_skirt, 0.20, 0.035, n=48, pleats=24, depth=0.010)
    ck.thicken(fl, 0.002, depth=None, crease=0.1)
    pieces.append(fl)
    # the overskirt: an apron front to the knee, looped up at the hips, long and puffed over the bustle behind
    ov = ck.Piece("overskirt", TL_OVER, scale=0.95)
    angs = np.radians(np.linspace(-172, 172, 27))

    def hem(a):
        f = math.cos(a)
        side = abs(math.sin(a))
        return Y(0.30) + 0.10 * side ** 2 * (f > -0.3) - 0.10 * max(0.0, -f) ** 2

    def loops(a, t):
        return 0.05 * math.sin(math.pi * t) * abs(math.sin(a)) ** 2

    gw.drape(fit, ov, on_skirt, angs, Y(0.600), hem, rows=6, clear=0.012, clear_hem=0.03,
             folds=lambda j, t: 0.010 * t * math.cos(j * 1.9), loops=loops,
             lift_fn=lambda a, t: 0.03 * max(0.0, -math.cos(a)) * math.sin(math.pi * min(1.0, t * 1.6)),
             wfn=lambda p: gw.skirt_weights(fit, p, back_legs=0.5, spring=0.2, shin=0.9))
    ck.thicken(ov, 0.0025, depth=0.04, crease=0.06)
    pieces.append(ov)
    on_over = ck.Onto([ov, sk])
    bw = ck.Piece("sash_bow", TL_OVER, scale=1.1)
    gw.bow(bw, on_over, (0.0, Y(0.585), -0.3), size=0.10, tails=0.32, lift=0.012, tail_w=0.06)
    ck.thicken(bw, 0.0018, depth=None, crease=0.08)
    pieces.append(bw)
    on_bodice = ck.Onto([bo])
    col = ck.Piece("collar", TL_WHITE, scale=1.4)
    gw.pelerine(fit, col, on_bodice, 0.025, 0.025, n=24, rings=2, up=0.016, front_gap=0.010)
    ck.thicken(col, 0.0010, depth=None, crease=0.1)
    cu = ck.Piece("cuffs", TL_WHITE, scale=1.3)
    cuffs(fit, cu, 0.0165, rings=("f2", "w1"))
    ck.thicken(cu, 0.0010, depth=None, crease=0.1)
    pieces += [col, cu]
    hat = ck.Piece("hat", TL_HAT, scale=1.3, hat=True)
    brim = ck.Piece("hat_brim", TL_HAT, scale=1.3, hat=True)
    band = ck.Piece("hat_ribbon", TL_RIBBON, scale=1.3, hat=True)
    h = gw.small_hat(fit, hat, brim, band, tilt=14.0, fwd=0.040)
    fe = ck.Piece("hat_feather", TL_FEATHER, scale=1.3, hat=True)
    R = h["R"]
    gw.feather(fit, fe, h["top"] + R @ np.array((0.05, -0.015, 0.04)), h["top"] + R @ np.array((0.035, -0.03, -0.11)),
               width=0.035, curl=0.02)
    ck.thicken(hat, 0.0018, depth=0.02)
    for pc_ in (brim, band, fe):
        ck.thicken(pc_, 0.0012, depth=None, crease=0.08)
    pieces += [hat, brim, band, fe]
    boot_pair(fit, pieces, TL_BOOT)
    return pieces


tourist_lady_covers = covers_dress(PS, neck_top=0.83)
TOURIST_LADY = Kind(
    "tourist_lady", "women", "woman_slight",
    face=dict(type="young_woman", seed=1873213, sex="f", age=30,
              look=dict(weather=0.05, ruddy=0.25, hair="brown", hair_rgb=hexrgb(0x7a4a26))),
    hair=dict(hair="bun", beard=None, moustache=None),
    dress=tourist_lady_dress, covers=tourist_lady_covers,
    skin=skin_dress((0.05, 0.045, 0.045), (0.15, 0.20, 0.17), tourist_lady_covers, gloves=(0.84, 0.80, 0.70)),
    hats=("hat", "hat_brim", "hat_ribbon", "hat_feather"),
    held=[("held_bag", "hipL", "a small leather bag on a chain at her waist")],
    avoid=dict(AVOID_W, scrub="a lady", wash="a lady", beg="a lady"),
    note="an English lady come to see the Rubens: dark green walking dress of 1873 with a bustle and a looped-up "
         "overskirt, a pleated flounce, a basque bodice with white collar and cuffs, a small plum hat with a ribbon "
         "and feather tipped over her chignon, cream kid gloves, a chatelaine bag")


KINDS = [FISHWIFE_B, MAID, WIFE_A, WIFE_B, SHOPWIFE, OLD_WOMAN, MILK_WOMAN, GIRL, GIRL_B, NUN, BEGUINE, TOURIST_LADY]
