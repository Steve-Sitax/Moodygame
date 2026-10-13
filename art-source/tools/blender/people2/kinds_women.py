"""The women's kinds (package C2; docs/people.md "Kinds and clothes"). First pass: fishwife_a.

fishwife_a: an Antwerp fishwife of the Vismarkt, about forty-five, on woman_stout. A white linen cap with a goffered
frill over hair pinned flat; a chemise's white collar at the throat; a checked wool shawl over the shoulders, its
point down the back, its ends crossed over the breast and tucked into the apron's band; a slate-blue bodice (jak)
with its sleeves pushed up to the forearm; a full red skirt striped in fawn, to the ankles, with real folds; a
brownish linen apron with a waistband tied behind; dark stockings, laced ankle boots; big red hands. The basket of
herring (held.py) is carried upright at her left hip. Colours from the old kit's fishwife_a; the hands and the basket from
the persona of Fientje, the named fishwife ("big red hands, a shawl, a basket of herring on her hip").
"""

import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from .dress import Kind

PW = bd.params("woman", "stout")


def _bodice_extra(ctx):
    P = ctx.fit.P
    Y = lambda f: bd.Y(P, f)
    x, y, z = ctx.x, ctx.y, ctx.z
    arm = ctx.zone == "arm"
    # the front closing with small black buttons, side seams, darts, the pushed-up sleeves' creases
    ck.seam_line(ctx, np.where(~arm & (z > 0), np.abs(x) - 0.003, 1.0))
    for k in range(6):
        ck.button(ctx, ctx.fit.snap((0.0, Y(0.80) - k * 0.035, 0.15), 0.012), r=0.005, rgb=(0.08, 0.08, 0.09))
    side = np.abs(np.abs(np.degrees(np.arctan2(x, z))) - 92.0)
    ck.seam_line(ctx, np.where(~arm, side / 57.3 * 0.15, 1.0))
    roll = arm & (y < Y(0.586) + 0.05)
    ctx.bump(roll * np.cos((y - Y(0.586)) * 2 * math.pi / 0.016), 0.0009)
    ctx.mul(roll, 0.92)
    # worn shiny at the elbows, scales and wet at the cuffs
    ctx.mix(arm * np.exp(-((y - Y(0.63)) / 0.04) ** 2) * (z < 0) * 0.2, (0.30, 0.36, 0.40))


def _skirt_extra(ctx):
    """Vertical stripes: fawn bands on the red, wider at the hem as the gores spread; the hem worn and wet."""
    ang = np.arctan2(ctx.x, ctx.z)
    k = 28
    t = (ang / (2 * math.pi) * k) % 1.0
    aa = 0.022  # about a texel: soft stripe edges, no stair steps up close
    band = sm(0.62 - aa, 0.62 + aa, t) * sm(0.82 + aa, 0.82 - aa, t)
    thin = sm(0.03 + aa, 0.03 - aa, np.abs(t - 0.45))
    col = np.array((0.60, 0.53, 0.44))
    ctx.mix(np.maximum(band, thin) * (~ctx.inner), col)
    ctx.mul((~ctx.inner) * sm(0.02 + aa, 0.0, np.abs(t - 0.62)), 0.8)
    hem = ctx.piece.meta["hem"]
    ctx.mix(sm(hem + 0.04, hem, ctx.y) * 0.4, (0.28, 0.22, 0.18))
    # the waistband
    ck.seam_line(ctx, ctx.y - ctx.piece.meta["band"])


def _apron_extra(ctx):
    # stains (fish, wet), a pocket on the right, the hem stitched
    s = np.clip(ck._noise3(ctx.pos, 14.0, 21) * 2.0 - 0.6, 0, 1)
    ctx.mix(s * 0.35, (0.36, 0.32, 0.24))
    m = ctx.piece.meta
    pk = (np.abs(ctx.x + 0.09) < 0.07) & (np.abs(ctx.y - (m["top"] - 0.13)) < 0.06) & ~ctx.inner
    ctx.mul(pk, 0.93)
    edge = pk & ((0.07 - np.abs(ctx.x + 0.09) < 0.004) | (np.abs(ctx.y - (m["top"] - 0.07)) < 0.003))
    ck.seam_line(ctx, np.where(edge, 0.0, 1.0))
    ck.seam_line(ctx, np.where(~ctx.inner, ctx.y - m["bottom"] - 0.02, 1.0))


def _shawl_extra(ctx):
    """A checked wool shawl: a dark brown ground, a lighter check and a thin red over-check; a fringe-like hem."""
    p = ctx.pos
    u = p[:, 0] + 0.3 * p[:, 2]
    v = p[:, 1] - 0.3 * p[:, 2]
    aa = 0.04
    su = sm(0.18 + aa, 0.18 - aa, np.abs(((u / 0.05) % 1.0) - 0.5))
    sv = sm(0.18 + aa, 0.18 - aa, np.abs(((v / 0.05) % 1.0) - 0.5))
    a = np.maximum(su, sv)
    b = su * sv
    r = np.maximum(sm(0.02 + aa / 2, 0.02 - aa / 2, np.abs(((u / 0.10) % 1.0) - 0.1)),
                   sm(0.02 + aa / 2, 0.02 - aa / 2, np.abs(((v / 0.10) % 1.0) - 0.1)))
    ctx.mix(a * 0.35, (0.55, 0.46, 0.34))
    ctx.mix(b * 0.25, (0.62, 0.54, 0.40))
    ctx.mix(r * 0.6, (0.46, 0.16, 0.12))


def _cap_extra(ctx):
    # starched white linen: a seam over the crown, the frill's goffering darker in its folds
    ctx.mix(np.ones(len(ctx.y)) * 0.0, (1, 1, 1))
    ck.seam_line(ctx, np.abs(ctx.x), width=0.0007, depth=0.00005, shade=0.93)


def _frill_extra(ctx):
    g = np.cos(np.arctan2(ctx.x, ctx.z - 0.0) * 160)
    ctx.bump(g, 0.0005)
    ctx.mul(0.5 - 0.5 * g, 0.88)


BODICE = Cloth(hexrgb(0x3a4a52), "wool", wear=0.4, dust=0.1, extra=_bodice_extra, lining=(0.22, 0.24, 0.26))
SKIRT = Cloth(hexrgb(0x6a2a24), "wool", wear=0.35, mud=0.8, mud_h=0.22, extra=_skirt_extra, lining=(0.36, 0.20, 0.17))
APRON = Cloth(hexrgb(0x8a7a60), "linen", wear=0.45, mud=0.4, mud_h=0.2, extra=_apron_extra, folds=1.2)
BAND = Cloth(hexrgb(0x7a6a52), "linen", wear=0.4, folds=0.2)
SHAWL = Cloth(hexrgb(0x4a3a2c), "wool", wear=0.35, dust=0.1, extra=_shawl_extra, folds=1.3)
LINEN_W = Cloth((0.86, 0.84, 0.79), "linen", wear=0.2, extra=_cap_extra, folds=0.4, lining=(0.80, 0.78, 0.73))
FRILL = Cloth((0.88, 0.86, 0.81), "linen", wear=0.1, extra=_frill_extra, folds=0.0)
CHEMISE = Cloth(hexrgb(0xc8c0b0), "linen", wear=0.3, folds=0.3)
BOOT = Cloth((0.10, 0.075, 0.06), "leather", wear=0.5, mud=0.5, mud_h=0.06, folds=0.0)
SOLE = Cloth((0.09, 0.065, 0.045), "leather", wear=0.5, mud=0.6, mud_h=0.03, folds=0.0)


def fishwife_a_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []

    # the skirt first: everything above sits on it
    sk = ck.Piece("skirt", SKIRT)
    hem = 0.075
    ck.skirt(fit, sk, top_row=3, hem_y=hem, n=24, ease=0.013, hip_rows=(2, 1), clear=0.05, flare=0.22, folds=8,
             fold_depth=0.022, spring=0.2, back_legs=0.8)
    sk.meta.update(hem=hem, band=Y(0.626) - 0.02)
    ck.thicken(sk, 0.003, depth=lambda p: 0.12 if p[1] < 0.5 else 0.03)
    pieces.append(sk)
    on_skirt = ck.Onto([sk])

    # the bodice over the skirt's top, its sleeves pushed up to the forearm
    def ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            if ring >= 8:
                return 0.008
            if ring >= 4:
                return 0.010
            return {3: 0.024, 2: 0.030}[ring]
        if part == "neck":
            return 0.007
        k = ck.ARM_SEQ.index(ring)
        return [0.008, 0.010, 0.012, 0.012, 0.012, 0.013, 0.014, 0.015, 0.020][k]

    bo = ck.Piece("bodice", BODICE)
    ck.upper(fit, bo, rows=(2, 9), neck=0, sleeve="f1", ease=ease)
    ck.thicken(bo, 0.0028, depth=0.035)
    pieces.append(bo)
    on_bodice = ck.Onto([bo])

    # the chemise's collar at the throat
    ch = ck.Piece("chemise", CHEMISE, scale=1.3)
    ck.collar(fit, ch, -0.12, 0.35, 0.010, 0.007, rows=2)
    ck.thicken(ch, 0.0015, depth=0.01)
    pieces.append(ch)

    # the apron: from its band at the waist, in front, to below the knee, over the skirt
    ap = ck.Piece("apron", APRON)
    top = Y(0.600)
    bottom = Y(0.24)
    n = 11
    th = np.radians(np.linspace(-72, 72, n))
    loop = []
    for t in th:
        q = on_skirt.snap(np.array((math.sin(t) * 0.4, top, math.cos(t) * 0.4)), 0.0)
        q = on_skirt.snap(np.array((q[0], top, q[2])), 0.018)
        loop.append(ap.add(q, on_skirt.weights(q), zone="skirt"))
    hs = [top + (bottom - top) * k / 4 for k in range(1, 5)]
    ck.hang(fit, ap, loop, hs, clear=0.06, closed=False,
            push=lambda j, p, d: on_skirt.snap(p, 0.024 + 0.018 * min(1.0, d / 0.3)), wfn=on_skirt.weights)
    ap.meta.update(top=top, bottom=bottom)
    ck.thicken(ap, 0.0022, depth=0.035)
    pieces.append(ap)
    # its band round the waist, over the bodice's skirt
    bd_ = ck.Piece("apron_band", BAND, scale=1.2)
    ck.band(fit, bd_, ck.Onto([bo, sk], skip_zones=("arm",)), Y(0.612), 0.035, d=0.009, n=20, rows=2)
    ck.thicken(bd_, 0.003, depth=None, crease=0.1)
    pieces.append(bd_)

    # the shawl: the point down the back, over the shoulders, the ends crossed in front into the band
    sw = ck.Piece("shawl", SHAWL, scale=0.9)
    ck.strap_grid(fit, sw, [(0.0, Y(0.848), -0.055), (0.0, Y(0.80), -0.115), (0.0, Y(0.73), -0.13),
                            (0.0, Y(0.66), -0.125), (0.0, Y(0.615), -0.12)],
                  [0.46, 0.40, 0.28, 0.13, 0.015], 0.007, cols=7, rows=7, onto=on_bodice)
    for sg, lift in ((1, 0.007), (-1, 0.013)):
        path = [(sg * 0.11, Y(0.826), -0.09), (sg * 0.145, Y(0.840), -0.015), (sg * 0.125, Y(0.815), 0.07),
                (sg * 0.05, Y(0.765), 0.135), (-sg * 0.035, Y(0.695), 0.15), (-sg * 0.085, Y(0.625), 0.14)]
        ck.strap_grid(fit, sw, path, [0.16, 0.19, 0.17, 0.15, 0.12, 0.08], lift, cols=5, rows=9, onto=on_bodice)
    ck.thicken(sw, 0.003, depth=0.035, crease=0.06)
    pieces.append(sw)

    # the white cap and its frill
    cap = ck.Piece("cap", LINEN_W, scale=1.3, hat=True)
    fr = ck.Piece("cap_frill", FRILL, scale=1.3, hat=True)
    ck.hood_cap(fit, cap, frill=fr, margin=0.009, front=-34.0, back=108.0, side=96.0, cols=15, rows=10)
    ck.thicken(cap, 0.0018, depth=0.025)
    ck.thicken(fr, 0.0012, depth=None, crease=0.06)
    pieces += [cap, fr]

    # laced ankle boots
    bt = ck.Piece("boots", BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        ck.shoe(fit, bt, so, S, women=True, shaft=0.118)
    pieces += [bt, so]
    return pieces


def fishwife_a_covers(p, part):
    x, y, z = p
    if part == "torso":
        return True
    if part == "neck":
        return y < bd.Y(PW, 0.812)
    if part.startswith("arm"):
        return y > bd.Y(PW, 0.586) + 0.03
    if part.startswith("leg"):
        return y > 0.45 or y < 0.105
    return False


def fishwife_a_skin(ctx):
    """Dark wool stockings; big red hands, chapped from the cold and the brine."""
    leg = np.char.startswith(ctx.part, "leg")
    knit = 0.5 + 0.5 * np.sin(ctx.y * 1500) * np.sin(np.arctan2(ctx.x, ctx.z) * 38)
    col = np.array((0.16, 0.16, 0.18)) * (0.9 + 0.15 * knit)[:, None]
    if hasattr(ctx, "detail_zone"): ctx.detail_zone[leg] = 1  # wool
    ctx.rgb[leg] = col[leg]
    ctx.h[leg] += 0.00015 * knit[leg]
    hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
    ctx.mix(hand * 0.35, (0.78, 0.42, 0.36))


FISHWIFE_A = Kind(
    "fishwife_a", "women", "woman_stout",
    face=dict(type="round_flemish_woman", seed=1873158, sex="f", age=46,
              look=dict(weather=0.85, ruddy=0.65, hair="brown", hair_rgb=hexrgb(0x6a4a30))),
    hair=dict(hair="undercap", beard=None, moustache=None),
    dress=fishwife_a_dress, covers=fishwife_a_covers, skin=fishwife_a_skin, hats=("cap", "cap_frill"),
    held=[("held_basket", "hipL", "upright herring basket carried at the left hip, clear of the apron; handle above the rim")],
    avoid={"walk": "a man's walk (walk_f is hers)", "talk": "talk_f is hers", "rifle_idle": "no rifle",
           "rifle_walk": "no rifle", "rifle_talk": "no rifle", "ride": "the skirt"},
    note="Vismarkt fishwife: white cap, checked shawl, striped red skirt, apron, basket of herring")

KINDS = [FISHWIFE_A]
