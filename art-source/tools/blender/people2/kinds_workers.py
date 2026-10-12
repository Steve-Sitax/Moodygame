"""The workers' kinds (package C1; docs/people.md "Kinds and clothes"). First pass: docker_a.

docker_a: a natieman of the Antwerp quays, about forty, on man_middling. The long blue kiel (a linen smock, gathered
under a yoke, buttoned at the neck, full sleeves into cuffs) over brown corduroy trousers, a red neckerchief, the
flat cloth cap of the docks, wooden clogs over grey wool socks, and a leather pad on the left shoulder, where the
sacks ride (the sack itself is the one sack model, docs/sacks.md). Hard hands. Tar on the smock, dust, mud at the
hems. Colours from the old kit's docker_a (cap, trousers, neckerchief, skin, hair) and docker_b (the blue smock).
"""

import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from .dress import Kind


# ---------------------------------------------------------------- docker_a

def _smock_extra(ctx):
    """The kiel: the yoke seam across the chest and back, the gathers under it, a placket with three bone buttons
    at the neck, the cuffs, side seams, wear at the hem and elbows, a patch on the right elbow."""
    P = ctx.fit.P
    Y = lambda f: bd.Y(P, f)
    x, y, z = ctx.x, ctx.y, ctx.z
    ax = np.abs(x)
    trunk = ~ctx.inner
    yoke = Y(0.770) - 0.012 * (z > 0) + 0.004 * (ax / 0.15) ** 2
    arm = ctx.zone == "arm"
    on_trunk = ~arm
    ck.seam_line(ctx, np.where(on_trunk & trunk, y - yoke, 1.0))
    # gathers under the yoke: fine pleats running down, fading out over 15 cm
    g = on_trunk * sm(yoke + 0.002, yoke - 0.008, y) * sm(yoke - 0.12, yoke - 0.03, y)
    g = g * (0.55 + 0.45 * ck._noise3(ctx.pos * np.array((1.0, 0.2, 1.0)), 40.0, 5))
    pleat = np.cos(np.arctan2(x, z) * 70.0 + 2.0 * ck._noise3(ctx.pos, 25.0, 6))
    ctx.bump(g * pleat, 0.0005)
    ctx.mul(g * (0.5 - 0.5 * pleat), 0.93)
    # the placket and buttons down the front of the neck
    front = (z > 0) & (ax < 0.03) & (y > Y(0.745)) & trunk
    ck.seam_line(ctx, np.where(front, ax - 0.014, 1.0), stitches=False)
    for k in range(3):
        bp = ctx.fit.snap((0.0, Y(0.815) - k * 0.035, 0.12), 0.026)
        ck.button(ctx, bp, r=0.0065, rgb=(0.74, 0.70, 0.62))
    # side seams (and under the sleeves)
    side = np.abs(np.abs(np.degrees(np.arctan2(x, z))) - 90.0)
    ck.seam_line(ctx, np.where(~arm & (y < yoke - 0.02), side / 57.3 * 0.16, 1.0))
    # the cuffs: a band 5 cm deep, seamed, a button on the outside
    cuff = Y(0.499) + 0.05
    ck.seam_line(ctx, np.where(arm, y - cuff, 1.0))
    ctx.mul(arm & (y < cuff), 0.9)
    for S in (1, -1):
        ck.button(ctx, ctx.fit.snap((S * (bd.shoulder_x(P) + 0.03), Y(0.499) + 0.025, -0.01), 0.012), r=0.006,
                  rgb=(0.74, 0.70, 0.62))
    # wear: the hem, the cuffs and the elbows lighter
    hem = ctx.piece.meta["hem"]
    ctx.mix(sm(hem + 0.03, hem, y) * 0.35, (0.55, 0.60, 0.66))
    elbow = np.exp(-((y - Y(0.63)) / 0.05) ** 2) * arm * (z < 0.0)
    ctx.mix(elbow * 0.3, (0.52, 0.57, 0.64))
    ck.patch(ctx, (-0.205, Y(0.625), -0.035), (0.035, 0.045), (0.27, 0.34, 0.45), along=(0, 1, 0))


def _trouser_extra(ctx):
    x, y, z = ctx.x, ctx.y, ctx.z
    # the outer leg seams and the fly
    side = np.abs(np.abs(np.degrees(np.arctan2(np.abs(x) - ctx.fit.hip_x, z))) - 90.0)
    ck.seam_line(ctx, np.where(y < ctx.fit.hip_y, side / 57.3 * 0.06, 1.0))
    ck.seam_line(ctx, np.where((z > 0) & (y > ctx.fit.hip_y - 0.12), np.abs(x - 0.012), 1.0), stitches=False)
    # knees shiny and bagged, a dark band of wet at the hems
    knee = np.exp(-((y - ctx.fit.knee_y) / 0.06) ** 2) * (z > 0)
    ctx.mix(knee * 0.25, (0.45, 0.40, 0.33))
    ctx.bump(knee * np.cos(y * 300) * 0.5, 0.0004)
    ctx.mul(sm(0.16, 0.09, y), 0.82)


def _cap_extra(ctx):
    # the crown's eight panels meeting at a button on top; the band seamed
    c = np.arctan2(ctx.x, ctx.z - 0.0)
    pan = np.abs(((c / (2 * math.pi) * 8) % 1.0) - 0.5)
    top = sm(0.0, 0.03, ctx.y - (ctx.piece.meta["band_top"]))
    ck.seam_line(ctx, np.where(top > 0.3, (0.5 - pan) * 0.06, 1.0), width=0.0008, stitches=False)
    ck.seam_line(ctx, ctx.y - ctx.piece.meta["band_top"], width=0.0008)
    ctx.mix(sm(0.006, 0.0, np.linalg.norm(ctx.pos - ctx.piece.meta["top"], axis=1)) * 0.9, (0.16, 0.14, 0.12))


def _pad_extra(ctx):
    # stitched round the edge, darkened and polished where the sacks ride
    m = ctx.piece.meta
    d = np.linalg.norm(ctx.pos - m["centre"], axis=1)
    ctx.mix(sm(0.09, 0.0, d) * 0.4, (0.20, 0.13, 0.08))


SMOCK = Cloth(hexrgb(0x3e5274), "linen", wear=0.55, dust=0.25, tar=0.35, mud=0.0, extra=_smock_extra,
              lining=(0.24, 0.30, 0.42))
CORD = Cloth(hexrgb(0x4a4032), "corduroy", wear=0.5, mud=0.9, dust=0.2, extra=_trouser_extra)
CAP = Cloth(hexrgb(0x3a342c), "wool", wear=0.4, dust=0.2, folds=0.5, extra=_cap_extra)
PEAK = Cloth(hexrgb(0x2e2a24), "felt", wear=0.5, folds=0.0)
KERCHIEF = Cloth(hexrgb(0x8a2c22), "cotton", wear=0.5, dust=0.15, folds=1.2)
WOOD = Cloth((0.34, 0.25, 0.15), "wood", wear=0.0, mud=0.65, folds=0.0, mud_h=0.055)
LEATHER = Cloth((0.36, 0.24, 0.15), "leather", wear=0.6, folds=0.3, extra=_pad_extra)


def _clog_extra(ctx):
    """The grain running along the clog, the knife facets of the carving, the dark opening round the ankle, darker
    with wear and wet toward the sole, the rim of the opening polished."""
    x, y, z = ctx.x, ctx.y, ctx.z
    side = np.sign(x)
    lx = x - side * 0.085
    g = np.sin(lx * 600 + y * 380 + 1.8 * np.sin(z * 40)) * 0.5 + 0.5
    ctx.mul(g, 0.93)
    ctx.bump(g, 0.00003)
    ctx.bump(np.abs(np.sin(np.arctan2(y - 0.04, lx) * 7 + z * 20)), 0.00012)
    ctx.mul(sm(0.035, 0.0, y), 0.78)
    opening = sm(0.072, 0.082, y) * sm(0.075, 0.035, z)
    ctx.mix(opening * 0.85, (0.10, 0.08, 0.06))
    ctx.mix(np.exp(-((y - 0.072) / 0.004) ** 2) * sm(0.08, 0.04, z) * 0.5, (0.36, 0.27, 0.18))


WOOD.extra = _clog_extra


def docker_a_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []

    # the kiel
    def smock_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            c = min(col, 16 - col)
            if ring >= 8:
                e = 0.010
            else:
                e = 0.020 + 0.014 * (8 - ring) / 8
            return e + (0.006 if c >= 6 else 0.0) + (0.004 if c <= 1 and ring <= 4 else 0.0)
        if part == "neck":
            return 0.009
        k = ck.ARM_SEQ.index(ring)
        return [0.011, 0.015, 0.019, 0.021, 0.021, 0.021, 0.021, 0.020, 0.019, 0.017, 0.009][k]

    smock = ck.Piece("smock", SMOCK)
    vm, _ = ck.upper(fit, smock, rows=(0, 9), neck=0, sleeve="w1", ease=smock_ease)
    loop = ck.row_loop(fit, vm, 0)
    hem = Y(0.40)
    ck.hang(fit, smock, loop, [Y(0.47), Y(0.435), hem], clear=0.028, flare=0.08,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.5, spring=0.12), seam_at=8)
    smock.meta["hem"] = hem
    ck.thicken(smock, 0.0025, depth=lambda p: 0.13 if p[1] < fit.hip_y else 0.03)
    pieces.append(smock)

    # corduroy trousers, straight from the knee
    straight = ck.straight_leg(fit, 0.070 * P["w"], fit.knee_y - 0.10)

    def tr_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            return 0.010 if ring >= 3 else 0.013
        e = {"l1": 0.014, "l2": 0.016, "l3": 0.017}.get(ring, 0.018)
        return straight(i, e)

    tr = ck.Piece("trousers", CORD)
    ck.trousers(fit, tr, top_row=3, hem="t2", ease=tr_ease)
    # cloth does not crease as sharply as skin: the knees' weights spread over 30 cm
    ck.smooth_weights(tr, iters=4, mask=lambda p: abs(p[1] - fit.knee_y) < 0.16)
    ck.thicken(tr, 0.0022, depth=0.05)
    pieces.append(tr)

    # clogs
    for S in "LR":
        cg = ck.Piece("clog" + S, WOOD, scale=1.2)
        ck.clogs(fit, cg, S)
        pieces.append(cg)

    # the cap and its peak
    cap = ck.Piece("cap", CAP, scale=1.3, hat=True)
    peak = ck.Piece("cap_peak", PEAK, scale=1.3, hat=True)
    ids, _ = ck.flat_cap(fit, cap, peak)
    cap.meta["band_top"] = float(np.array(cap.V)[ids[1]][:, 1].mean())
    cap.meta["top"] = np.array(cap.V)[ids.max() + 1]
    ck.thicken(cap, 0.0025, depth=0.03)
    ck.thicken(peak, 0.004, depth=None, crease=0.1)
    pieces += [cap, peak]

    # the neckerchief
    nk = ck.Piece("kerchief", KERCHIEF, scale=1.2)
    ends = ck.Piece("kerchief_ends", KERCHIEF, scale=1.2)
    on_smock = ck.Onto([smock])
    ck.neckerchief(fit, nk, tails=ends, tail_d=0.003, onto=on_smock)
    ck.thicken(nk, 0.002, depth=0.012)
    ck.thicken(ends, 0.0018, depth=None)
    pieces += [nk, ends]

    # the leather shoulder pad on the left shoulder, front to back over the top
    sh = bd.shoulder_x(P)
    path = [(sh * 0.66, Y(0.772), 0.098), (sh * 0.72, Y(0.808), 0.068), (sh * 0.75, Y(0.830), 0.022),
            (sh * 0.73, Y(0.832), -0.030), (sh * 0.68, Y(0.806), -0.080), (sh * 0.62, Y(0.770), -0.108)]
    pad = ck.Piece("pad", LEATHER, scale=1.2)
    ck.strap_grid(fit, pad, path, [0.11, 0.13, 0.14, 0.14, 0.13, 0.11], 0.010, parts=("torso", "arm", "neck"),
                  cols=6, onto=on_smock, rows=9)
    pad.meta["centre"] = on_smock.snap(path[3], 0.005)
    ck.thicken(pad, 0.004, depth=None, crease=0.1)
    pieces.append(pad)
    return pieces


PM = bd.params("man", "middling")


def docker_a_covers(p, part):
    x, y, z = p
    if part == "torso":
        return True
    if part == "neck":
        return y < bd.Y(PM, 0.842)
    if part.startswith("arm"):
        return y > bd.Y(PM, 0.499) + 0.022
    if part.startswith("leg"):
        return y > 0.15 or y < 0.078
    return False


def docker_a_skin(ctx):
    """Grey wool socks above the clogs; grime in the hands' creases."""
    leg = np.char.startswith(ctx.part, "leg")
    sock = leg & (ctx.y < 0.22)
    knit = 0.5 + 0.5 * np.sin(ctx.y * 1600) * np.sin(np.arctan2(ctx.x, ctx.z) * 40)
    col = np.array((0.42, 0.40, 0.37)) * (0.9 + 0.12 * knit)[:, None]
    ctx.rgb[sock] = col[sock]
    ctx.h[sock] += 0.0002 * knit[sock]
    hand = ck.starts(ctx.part, ("finger", "arm")) & (ctx.y < 0.80)
    ctx.mul(hand, (0.88, 0.85, 0.82))


DOCKER_A = Kind(
    "docker_a", "workers", "man_middling",
    face=dict(seed=1873041, sex="m", age=40, look=dict(stubble=0.8, weather=0.95, ruddy=0.35, hair="dark",
                                                     hair_rgb=hexrgb(0x3a2e26))),
    hair=dict(hair="crop", beard=None, moustache=None),
    dress=docker_a_dress, covers=docker_a_covers, skin=docker_a_skin, hats=("cap", "cap_peak"),
    hands_hard=1.0,
    avoid={"walk_f": "a woman's walk", "talk_f": "a woman's talk", "rifle_idle": "no rifle", "rifle_walk": "no rifle",
           "rifle_talk": "no rifle", "ride": "the smock's skirt rides up through the saddle"},
    note="natieman of the quays: blue kiel, corduroy, clogs, flat cap, a leather pad on the left shoulder for sacks")

KINDS = [DOCKER_A]
