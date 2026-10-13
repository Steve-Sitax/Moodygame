"""The named cast and new kinds (package C4; docs/people.md "Kinds and clothes"). First pass: sooi.

sooi: Sooi, foreman of the Hessenatie on the Rijnkaai (server/src/npcs.ts: "Broad, grey stubble, a docker's cap and
a coat gone shiny at the elbows"; gruff but fair, his knees going, about fifty), on man_stout. A brown wool coat,
worn open, gone shiny at the elbows and patched at one; a dark waistcoat buttoned over a collarless working shirt
with a turn-down collar, a brown neckerchief knotted at the throat; grey-brown trousers; heavy work boots; the
docks' flat cap. A walrus moustache gone grey, grey stubble. Colours from the old kit's sooi. Hero quality: his face
square is 1024 px.
"""

import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from .dress import Kind
from . import cloth_detail as cd
from .kinds_workers import CAP, PEAK

PS = bd.params("man", "stout")


def _coat_extra(ctx):
    P = ctx.fit.P
    Y = lambda f: bd.Y(P, f)
    x, y, z = ctx.x, ctx.y, ctx.z
    arm = ctx.zone == "arm"
    out = ~ctx.inner
    # the front edges stitched, lapels pressed back (a fold line), pocket flaps at the hips, side and back seams
    edge = (~arm) & (z > 0.02) & out
    fe = np.abs(np.abs(x) - ctx.piece.meta["edge_x"])
    ck.seam_line(ctx, np.where(edge, fe - 0.008, 1.0))
    lap = edge & (y > Y(0.71)) & (fe < 0.035 + (y - Y(0.71)) * 0.25)
    ctx.mul(lap, 0.9)
    ck.seam_line(ctx, np.where(lap, fe - 0.035 - (y - Y(0.71)) * 0.25, 1.0), stitches=False)
    for sg in (1, -1):
        fl = (~arm) & out & (np.abs(x - sg * 0.12) < 0.07) & (np.abs(y - Y(0.575)) < 0.025) & (z > -0.02)
        ctx.mul(fl, 0.9)
        ck.seam_line(ctx, np.where((~arm) & (np.abs(x - sg * 0.12) < 0.07) & (z > -0.02), y - Y(0.575) + 0.025, 1.0))
    ck.seam_line(ctx, np.where((~arm) & (z < 0), np.abs(x), 1.0))
    side = np.abs(np.abs(np.degrees(np.arctan2(x, z))) - 100.0)
    ck.seam_line(ctx, np.where(~arm, side / 57.3 * 0.17, 1.0))
    # three buttons on the left front (never done up), cuffs with two
    for k in range(3):
        bp = ctx.fit.snap((ctx.piece.meta["edge_x"] - 0.022, Y(0.72) - k * 0.075, 0.16), 0.034)
        ck.button(ctx, bp, r=0.009, rgb=(0.15, 0.11, 0.08))
    # shiny elbows, a patch on the left one; wear on the cuffs, the pocket edges and the hem
    elbow = arm * np.exp(-((y - Y(0.63)) / 0.045) ** 2) * sm(0.0, -0.04, z)
    ctx.mix(elbow * 0.45, (0.50, 0.42, 0.32))
    ctx.bump(elbow, -0.0002)
    ck.patch(ctx, ctx.fit.snap((0.215, Y(0.628), -0.04), 0.03), (0.035, 0.045), (0.30, 0.25, 0.18))
    ctx.mix(arm * sm(Y(0.499) + 0.03, Y(0.499), y) * 0.4, (0.46, 0.38, 0.28))
    hem = ctx.piece.meta["hem"]
    ctx.mix(sm(hem + 0.025, hem, y) * 0.35, (0.45, 0.38, 0.29))


def _waistcoat_extra(ctx):
    P = ctx.fit.P
    Y = lambda f: bd.Y(P, f)
    for k in range(5):
        bp = ctx.fit.snap((-0.004, Y(0.725) - k * 0.042, 0.16), 0.016)
        ck.button(ctx, bp, r=0.0065, rgb=(0.20, 0.16, 0.12))
    ck.seam_line(ctx, np.where((ctx.z > 0) & ~ctx.inner, np.abs(ctx.x + 0.004) - 0.012, 1.0), stitches=False)
    ck.seam_line(ctx, np.where(ctx.z < 0, np.abs(ctx.x), 1.0))
    # two welt pockets
    for sg in (1, -1):
        ck.seam_line(ctx, np.where((np.abs(ctx.x - sg * 0.09) < 0.04) & (ctx.z > 0), ctx.y - Y(0.64), 1.0),
                     width=0.0015, depth=0.0003, shade=0.6, stitches=False)
    # the back is cotton lining stuff, lighter
    ctx.mix((ctx.z < -0.02) & ~ctx.inner, (0.30, 0.28, 0.26))


def _shirt_extra(ctx):
    ck.seam_line(ctx, np.where(ctx.z > 0, np.abs(ctx.x) - 0.01, 1.0), stitches=False)


def _trouser_extra(ctx):
    side = np.abs(np.abs(np.degrees(np.arctan2(np.abs(ctx.x) - ctx.fit.hip_x, ctx.z))) - 90.0)
    ck.seam_line(ctx, np.where(ctx.y < ctx.fit.hip_y, side / 57.3 * 0.06, 1.0))
    knee = np.exp(-((ctx.y - ctx.fit.knee_y) / 0.06) ** 2) * (ctx.z > 0)
    ctx.mix(knee * 0.2, (0.42, 0.40, 0.36))
    ctx.mul(sm(0.15, 0.09, ctx.y), 0.85)


def _boot_extra(ctx):
    y, z = ctx.y, ctx.z
    crease = np.exp(-((y - 0.072) / 0.012) ** 2) * (z > 0.02) * (0.5 + 0.5 * np.sin(z * 800))
    ctx.bump(crease, -0.0003)
    ctx.mix(sm(0.12, 0.2, z) * sm(0.06, 0.03, y) * 0.25, (0.30, 0.24, 0.18))
    # laces up the front
    lace = (np.abs(ctx.x - np.sign(ctx.x) * ctx.fit.hip_x) < 0.012) & (z > 0.0) & (y > 0.06)
    ctx.mix(lace * (np.cos(y * 2 * math.pi / 0.012) > 0.3) * 0.7, (0.06, 0.05, 0.04))


COAT = Cloth(hexrgb(0x5a4634), "wool", wear=0.6, dust=0.25, mud=0.15, extra=_coat_extra, lining=(0.28, 0.25, 0.21))
COAT_COLLAR = Cloth(hexrgb(0x55422f), "wool", wear=0.7, dust=0.2, folds=0.3)
WAISTCOAT = Cloth(hexrgb(0x2e2a26), "wool", wear=0.4, extra=_waistcoat_extra, lining=(0.25, 0.23, 0.21))
SHIRT = Cloth(hexrgb(0xa49c8c), "cotton", wear=0.5, dust=0.2, extra=_shirt_extra, folds=0.6)
KERCHIEF = Cloth(hexrgb(0x5a3a2a), "cotton", wear=0.5, folds=1.0)
TROUSERS = Cloth(hexrgb(0x4a443c), "wool", wear=0.55, mud=0.8, dust=0.2, extra=_trouser_extra)
BOOT = Cloth(hexrgb(0x2a1e16), "leather", wear=0.6, mud=0.7, mud_h=0.07, folds=0.0, extra=_boot_extra)
SOLE = Cloth((0.10, 0.075, 0.05), "leather", wear=0.6, mud=0.7, mud_h=0.03, folds=0.0)
CAP_S = Cloth(hexrgb(0x2e2e2c), "wool", wear=0.45, dust=0.25, folds=0.5, extra=CAP.extra)


def sooi_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []

    # the shirt: its upper part (seen in the waistcoat's V), its collar, its cuffs
    sh = ck.Piece("shirt", SHIRT, scale=0.9)

    def front(i):
        part, ring, col = ck.info(fit, i)
        return min(col, 16 - col) <= 4 if col >= 0 else False
    ck.upper(fit, sh, rows=(5, 9), neck=0, sleeve=None, ease=lambda i: 0.006, keep=front)
    ck.thicken(sh, 0.0015, depth=0.01)
    pieces.append(sh)
    # a collarless working shirt: the kerchief covers the throat (a collar band under it only showed as shards)

    # the waistcoat: buttoned to a V at the breast, sleeveless
    def v_neck(i):
        part, ring, col = ck.info(fit, i)
        if part == "neck":
            return False
        if part == "torso":
            c = min(col, 16 - col)
            if ring >= 9 and c <= 2:
                return False
            if ring >= 8 and c <= 1:
                return False
        return True

    def wc_ease(i):
        part, ring, col = ck.info(fit, i)
        return 0.010 if ring >= 4 else 0.013 if ring >= 2 else 0.016

    wc = ck.Piece("waistcoat", WAISTCOAT)
    ck.upper(fit, wc, rows=(1, 9), neck=None, sleeve=None, ease=wc_ease, keep=v_neck,
             open_front=(lambda y: -0.012, lambda y: 0.012, 0.003))
    ck.thicken(wc, 0.0025, depth=0.04)
    pieces.append(wc)

    # the neckerchief knotted at the throat over the collar's foot
    nk = ck.Piece("kerchief", KERCHIEF, scale=1.2)
    ends = ck.Piece("kerchief_ends", KERCHIEF, scale=1.2)
    ck.neckerchief(fit, nk, ease=0.021, tails=ends, tail_d=0.004, onto=ck.Onto([wc, sh]))
    ck.thicken(nk, 0.002, depth=0.012)
    ck.thicken(ends, 0.0018, depth=None)
    pieces += [nk, ends]

    # the coat, worn open: the front columns of the cage left out, so its edges fall straight from the shoulders
    def coat_keep(i):
        part, ring, col = ck.info(fit, i)
        if part in ("torso", "neck") and col == 0:
            return False
        return True

    def coat_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            c = min(col, 16 - col)
            e = 0.020 if ring >= 8 else 0.026 if ring >= 4 else 0.032
            return e + (0.004 if c >= 5 else 0.0)
        if part == "neck":
            return 0.016
        k = ck.ARM_SEQ.index(ring)
        return [0.015, 0.019, 0.022, 0.023, 0.023, 0.024, 0.024, 0.023, 0.022, 0.021, 0.016][k]

    co = ck.Piece("coat", COAT)
    vm, _ = ck.upper(fit, co, rows=(0, 9), neck=0, sleeve="w1", ease=coat_ease, keep=coat_keep)
    row0 = fit.row(0)
    loop = [vm[i] for i in row0[1:] if i in vm]
    hem = Y(0.415)
    ck.hang(fit, co, loop, [Y(0.48), Y(0.448), hem], clear=0.035, flare=0.10, closed=False,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.4, spring=0.3, springs=("coat",)))
    r6 = fit.row(6)
    co.meta.update(hem=hem, edge_x=float(np.mean([abs(co.V[vm[r6[k]]][0]) for k in (1, 15)])))
    ck.thicken(co, 0.0035, depth=lambda p: 0.08 if p[2] > 0.05 else (0.08 if p[1] < fit.hip_y else 0.03))
    cuff = Y(0.537)
    co.relief = cd.compose(cd.hang_folds(Y(0.56), hem, n=5, depth=0.009, seed=17, zone=("skirt", "torso"),
                                         exclude=lambda p: p[:, 1] > Y(0.62)),
                           cd.bunch(cuff + 0.03, cuff + 0.11, period=0.028, depth=0.004, zone="arm"))
    pieces.append(co)
    # its turned-down collar round the back of the neck
    cc = ck.Piece("coat_collar", COAT_COLLAR, scale=1.2)
    ck.collar(fit, cc, -0.35, 0.35, 0.030, 0.026, rows=2, front_gap=0.13, fold=(0.022, 0.034))
    ck.thicken(cc, 0.003, depth=None, crease=0.05)
    pieces.append(cc)
    # the shirt's cuffs below the coat's sleeves
    for S, sg in (("L", 1), ("R", -1)):
        cf = ck.Piece("cuff" + S, SHIRT, scale=1.0)
        idx = [i for i, (p, t) in enumerate(zip(fit.C.part, fit.C.tag)) if p == "arm" + S and t.get("ring") in ("f2", "w1")]
        rings = {}
        for i in idx:
            rings.setdefault(fit.C.tag[i]["ring"], []).append(i)
        for k in rings:
            rings[k].sort(key=lambda i: fit.C.tag[i]["col"])
        pts = []
        for nm, e in (("f2", 0.009), ("w1", 0.012)):
            pts.append([fit.rest[i] + fit.N[i] * e for i in rings[nm]])
        pts = np.array(pts)
        pts[1] = pts[0] + (pts[1] - pts[0]) * 1.25
        cf.grid(pts, lambda p, S=S: fit.near_w(p, ("arm" + S,)), closed=True, seam_col=6)
        cf.orient(lambda q, sg=sg: q - np.array((sg * bd.shoulder_x(P), q[1], 0.0)))
        ck.thicken(cf, 0.002, depth=None)
        pieces.append(cf)

    # trousers and boots
    straight = ck.straight_leg(fit, 0.074 * P["w"], fit.knee_y - 0.10)

    def tr_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            return 0.010 if ring >= 3 else 0.013
        e = {"l1": 0.014, "l2": 0.015, "l3": 0.016}.get(ring, 0.017)
        return straight(i, e)

    tr = ck.Piece("trousers", TROUSERS)
    ck.trousers(fit, tr, top_row=3, hem="t2", ease=tr_ease)
    ck.smooth_weights(tr, iters=4, mask=lambda p: abs(p[1] - fit.knee_y) < 0.16)
    ck.thicken(tr, 0.0024, depth=0.05)
    from .kinds_workers import trouser_relief
    tr.relief = trouser_relief(fit)
    pieces.append(tr)
    bt = ck.Piece("boots", BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        ck.shoe(fit, bt, so, S, shaft=0.135)
    pieces += [bt, so]

    cap = ck.Piece("cap", CAP_S, scale=1.3, hat=True)
    peak = ck.Piece("cap_peak", PEAK, scale=1.3, hat=True)
    ids, _ = ck.flat_cap(fit, cap, peak, puff=0.014, fwd=0.016)
    cap.meta["band_top"] = float(np.array(cap.V)[ids[1]][:, 1].mean())
    cap.meta["top"] = np.array(cap.V)[ids.max() + 1]
    ck.thicken(cap, 0.0025, depth=0.03)
    ck.thicken(peak, 0.004, depth=None, crease=0.1)
    pieces += [cap, peak]
    return pieces


def sooi_covers(p, part):
    x, y, z = p
    if part == "torso" or part.startswith("leg"):
        return True
    if part == "neck":
        return y < bd.Y(PS, 0.836)
    if part.startswith("arm"):
        return y > bd.Y(PS, 0.537) + 0.02
    return False


def sooi_skin(ctx):
    hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < bd.Y(ctx.P, 0.52))
    ctx.mix(hand * 0.15, (0.66, 0.44, 0.34))
    ctx.mul(hand, (0.92, 0.89, 0.86))
    # the skin under the coat, the shirt and its collar is painted by the ray test (clothes_build.under_cloth)


SOOI = Kind(
    "sooi", "cast", "man_stout",
    face=dict(type="flemish_foreman", seed=1873001, sex="m", age=52,
              look=dict(stubble=0.95, weather=0.95, ruddy=0.55, hair="grey", hair_rgb=hexrgb(0x6a645c),
                        tone=2.0)),
    hair=dict(hair="crop", beard=None, moustache="walrus"),
    dress=sooi_dress, covers=sooi_covers, skin=sooi_skin, hats=("cap", "cap_peak"), hands_hard=0.6, hero=True,
    avoid={"walk_f": "a woman's walk", "talk_f": "a woman's talk", "hop": "his knees", "rifle_idle": "no rifle",
           "rifle_walk": "no rifle", "rifle_talk": "no rifle"},
    note="Sooi, foreman of the Hessenatie: open brown coat shiny at the elbows, waistcoat, neckerchief, flat cap")

KINDS = [SOOI]
