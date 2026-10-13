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
                 extra=_shawl_check(None, [((0.16, 0.10, 0.09), 0.18, 1, 0.9), ((0.70, 0.56, 0.40), 0.06, 2, 0.7)]))
WA_FRINGE = Cloth(hexrgb(0x7a3228), "wool", wear=0.2, folds=0.0, extra=_fringe_extra)
WA_CAP = Cloth((0.87, 0.85, 0.80), "linen", wear=0.15, extra=_linen_white, folds=0.3, lining=(0.80, 0.78, 0.73))
WA_BRIM = Cloth((0.89, 0.87, 0.82), "linen", wear=0.1, extra=_frill_extra, folds=0.0)
WA_TIES = Cloth((0.86, 0.84, 0.79), "linen", wear=0.1, folds=0.0)
BOOT = Cloth((0.085, 0.07, 0.06), "leather", wear=0.45, mud=0.5, mud_h=0.06, folds=0.0, extra=_boot_extra)
SOLE = Cloth((0.08, 0.06, 0.045), "leather", wear=0.5, mud=0.6, mud_h=0.03, folds=0.0)


def _shawl_on(fit, pc, onto, ends="hang", back=0.40, shoulder=0.17, front=0.13, lift0=0.006, front_y=0.64,
              cross=0.0, rows=27, cols=6):
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
    ids = gw.band_out(fit, pc, onto, path, widths, lifts, cols=cols, rows=rows, lift_out=0.004)
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
    ids = _shawl_on(fit, sw, on_bodice, ends="hang", back=0.40, front_y=0.655)
    ck.thicken(sw, 0.0028, depth=0.03, crease=0.06)
    pieces.append(sw)
    fr = ck.Piece("shawl_fringe", WA_FRINGE, scale=1.3)
    on_all = ck.Onto([bo, sw, ap, sk])
    V = np.array(sw.V)
    R = ids.shape[0]
    mid = R // 2
    # the back's edges: the outer column from the shoulders to the point and back up
    edge = [V[ids[r, -1]] for r in range(mid - 9, mid + 10)]
    gw.fringe(fit, fr, edge, on_all, length=0.06, lift=0.006)
    for r in (0, R - 1):
        gw.fringe(fit, fr, [V[ids[r, c]] for c in range(ids.shape[1])], on_all, length=0.05, lift=0.006)
    ck.thicken(fr, 0.0012, depth=None, crease=0.9)
    pieces.append(fr)
    # the cap: plain linen with a narrow pleated brim and strings tied under the chin
    cap = ck.Piece("cap", WA_CAP, scale=1.3, hat=True)
    brim = ck.Piece("cap_brim", WA_BRIM, scale=1.3, hat=True)
    cid = ck.hood_cap(fit, cap, frill=brim, margin=0.009, front=-30.0, back=110.0, side=100.0, cols=13, rows=9)
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
    cid = ck.hood_cap(fit, cap, frill=fr, margin=0.008, front=8.0, back=112.0, side=78.0, cols=11, rows=7)
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
    gw.coif(fit, co, margin=0.008, front=-56.0, side=116.0, back=128.0)
    ck.thicken(co, 0.0018, depth=0.02)
    pieces.append(co)
    ve = ck.Piece("veil", NU_VEIL, scale=1.0, hat=True)
    gw.veil(fit, ve, margin=0.014, front=-46.0, back=150.0, side=106.0, fall=0.32, front_cut=0.0)
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


KINDS = [WIFE_A, MAID, NUN]
