"""The uniforms, cloth and gentry kinds (package C3; docs/people.md "Kinds and clothes"). First pass: police.

police: an agent of the Antwerp city police, about forty, on man_middling. A dark blue tunic buttoned to the neck
(seven brass buttons), its stand collar faced in a lighter blue, skirts to mid-thigh with a vent behind (the tails
on the coat-tail spring bones), round cuffs piped in the collar's blue; a black leather belt with a brass buckle and
a frog on the left hip for the sabre; dark trousers with a lighter stripe down the outer seam; black boots; the
kepi, its top sloping to the front, a black leather peak and chin strap, a brass badge. The sabre (on hipL) and
the truncheon (in the right hand when drawn) are held.py's. Colours from the old kit's police.
"""

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from .dress import Kind

PM = bd.params("man", "middling")
BRASS_RGB = (0.66, 0.50, 0.22)


def _tunic_extra(ctx):
    P = ctx.fit.P
    Y = lambda f: bd.Y(P, f)
    x, y, z = ctx.x, ctx.y, ctx.z
    arm = ctx.zone == "arm"
    outer = ~ctx.inner
    # the front edge's stitching, the buttons down it
    ck.seam_line(ctx, np.where(outer & ~arm & (z > 0.05), np.abs(x + 0.004) - 0.010, 1.0), stitches=True)
    for k in range(7):
        yy = Y(0.835) - k * (Y(0.835) - Y(0.628)) / 6
        bp = ctx.fit.snap((-0.002, yy, 0.15), 0.016 if k > 0 else 0.013)
        ck.button(ctx, bp, r=0.0075, rgb=BRASS_RGB, metal=True)
    # the waist seam, side seams, the back vent from the waist down with two buttons at its top
    ck.seam_line(ctx, np.where(~arm, y - Y(0.612), 1.0))
    side = np.abs(np.abs(np.degrees(np.arctan2(x, z))) - 95.0)
    ck.seam_line(ctx, np.where(~arm, side / 57.3 * 0.15, 1.0))
    vent = (~arm) & (z < 0) & (y < Y(0.612))
    ck.seam_line(ctx, np.where(vent, np.abs(x), 1.0), width=0.0016, depth=0.0003, shade=0.6)
    for sx in (-0.045, 0.045):
        ck.button(ctx, ctx.fit.snap((sx, Y(0.618), -0.15), 0.016), r=0.007, rgb=BRASS_RGB, metal=True)
    # round cuffs, piped in the collar's blue
    cuff = Y(0.499) + 0.06
    ctx.mix(arm & (y < cuff) & (y > cuff - 0.004), (0.20, 0.25, 0.38))
    ck.seam_line(ctx, np.where(arm, y - cuff + 0.006, 1.0), stitches=False)
    # wear: shiny seat and elbows, a little dust at the hem
    elbow = np.exp(-((y - Y(0.63)) / 0.05) ** 2) * arm * (z < 0)
    ctx.mix(elbow * 0.15, (0.22, 0.25, 0.32))


def _collar_extra(ctx):
    # the collar's blue facing, with a brass number badge each side
    ctx.mix(np.ones(len(ctx.y)) * 0.8 * (~ctx.inner), (0.18, 0.23, 0.36))
    for sx in (0.045, -0.045):
        p = ctx.fit.snap((sx, bd.Y(ctx.fit.P, 0.852), 0.035), 0.012)
        d = np.linalg.norm(ctx.pos - p, axis=1)
        m = d < 0.008
        ctx.rgb[m] = np.array(BRASS_RGB) * (0.9 + 0.3 * (1 - d[m] / 0.008))[:, None]
        ctx.h[m] += 0.0004


def _trouser_extra(ctx):
    x, y, z = ctx.x, ctx.y, ctx.z
    lx = np.abs(x) - ctx.fit.hip_x
    ang = np.degrees(np.arctan2(lx, z))
    stripe = sm(10.0, 8.0, np.abs(ang - 90.0))
    ctx.mix(stripe * (y < ctx.fit.hip_y + 0.05) * (~ctx.inner), (0.17, 0.22, 0.35))
    ck.seam_line(ctx, np.where(y < ctx.fit.hip_y, np.abs(ang - 90.0) / 57.3 * 0.06, 1.0), stitches=False)
    ctx.mul(sm(0.15, 0.09, y), 0.85)


def _boot_extra(ctx):
    """Black leather boots: creases over the instep, a polished toe, the sole's edge and the heel."""
    y, z = ctx.y, ctx.z
    ctx.mix(sm(0.012, 0.004, y) * 0.9, (0.10, 0.07, 0.05))
    crease = np.exp(-((y - 0.075) / 0.012) ** 2) * (z > 0.02) * (0.5 + 0.5 * np.sin(z * 900))
    ctx.bump(crease, -0.0003)
    toe = sm(0.12, 0.2, z) * sm(0.06, 0.03, y)
    ctx.mix(toe * 0.25, (0.16, 0.15, 0.15))
    ctx.mix(sm(-0.03, -0.06, z) * sm(0.03, 0.0, y) * 0.8, (0.08, 0.06, 0.04))


def _kepi_extra(ctx):
    m = ctx.piece.meta
    y = ctx.y
    yb = m["band_top"]
    # two rows of piping round the band, the chin strap in front, the city badge
    ctx.mix(np.exp(-((y - yb) / 0.0015) ** 2) * 0.8, (0.20, 0.26, 0.40))
    ctx.mix(np.exp(-((y - m["y0"] - 0.003) / 0.0012) ** 2) * 0.6, (0.20, 0.26, 0.40))
    strap = (np.abs(y - (m["y0"] + 0.009)) < 0.0055) & (ctx.z > m["zc"] + 0.02)
    ctx.mix(strap * 0.95, (0.04, 0.04, 0.045))
    ctx.bump(strap, 0.0006)
    for sx in (1, -1):
        bp = m["strap_button"] * np.array((sx, 1, 1))
        d = np.linalg.norm(ctx.pos - bp, axis=1)
        mm = d < 0.005
        ctx.rgb[mm] = np.array(BRASS_RGB) * 1.05
        ctx.h[mm] += 0.0008
    d = np.linalg.norm((ctx.pos - m["badge"]) * np.array((1.0, 0.75, 1.0)), axis=1)
    b = d < 0.014
    ctx.rgb[b] = np.array(BRASS_RGB) * (0.75 + 0.45 * np.cos(d[b] * 600) ** 2)[:, None]
    ctx.h[b] += 0.0008 * np.cos(d[b] / 0.014 * 1.5)
    # the top's edge piped
    ctx.mix(np.exp(-((y - m["top_edge"]) / 0.002) ** 2) * 0.5, (0.20, 0.26, 0.40))


def _belt_extra(ctx):
    if "y" in ctx.piece.meta:
        ck.seam_line(ctx, np.where(~ctx.inner, np.abs(ctx.y - ctx.piece.meta["y"]) - 0.019, 1.0), width=0.0008)


TUNIC = Cloth(hexrgb(0x1e2638), "wool", wear=0.25, dust=0.12, extra=_tunic_extra, lining=(0.10, 0.11, 0.14))
COLLAR = Cloth(hexrgb(0x1e2638), "wool", wear=0.2, extra=_collar_extra, folds=0.2)
TROUSERS = Cloth(hexrgb(0x1a1e28), "wool", wear=0.3, mud=0.5, extra=_trouser_extra)
BOOT = Cloth((0.055, 0.05, 0.045), "leather", wear=0.35, mud=0.35, mud_h=0.06, folds=0.0, extra=_boot_extra)
KEPI = Cloth(hexrgb(0x1c2232), "felt", wear=0.2, folds=0.0, extra=_kepi_extra)
PEAK = Cloth((0.035, 0.035, 0.04), "leather", wear=0.2, folds=0.0)
BELT = Cloth((0.05, 0.045, 0.04), "leather", wear=0.35, folds=0.0, extra=_belt_extra)
BRASS = Cloth(BRASS_RGB, "metal", wear=0.0, folds=0.0)
SOLE = Cloth((0.09, 0.065, 0.045), "leather", wear=0.5, mud=0.6, mud_h=0.03, folds=0.0)


def police_dress(fit):
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    pieces = []

    def ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            if ring >= 8:
                return 0.008
            if ring >= 4:
                return 0.011
            return {3: 0.009, 2: 0.012, 1: 0.016, 0: 0.019}[ring]
        if part == "neck":
            return 0.008
        k = ck.ARM_SEQ.index(ring)
        return [0.008, 0.010, 0.012, 0.013, 0.013, 0.013, 0.013, 0.012, 0.012, 0.011, 0.009][k]

    tunic = ck.Piece("tunic", TUNIC)
    vm, dup = ck.upper(fit, tunic, rows=(0, 9), neck=0, sleeve="w1", ease=ease,
                       open_front=(lambda y: -0.013, lambda y: 0.013, 0.003))
    loop = ck.row_loop(fit, vm, 0, dup)
    ck.hang(fit, tunic, loop, [Y(0.48), Y(0.44), Y(0.405)], clear=0.026, flare=0.10, closed=False,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.4, spring=0.3, springs=("coat",)))
    ck.thicken(tunic, 0.003, depth=lambda p: 0.12 if p[1] < fit.hip_y else 0.03)
    pieces.append(tunic)
    on_tunic = ck.Onto([tunic], skip_zones=("arm",))

    col = ck.Piece("collar", COLLAR, scale=1.3)
    ck.collar(fit, col, -0.05, 0.95, 0.014, 0.010, rows=3)
    ck.thicken(col, 0.003, depth=0.02)
    pieces.append(col)

    # the belt over the tunic, its brass buckle, the frog on the left hip
    by = Y(0.618)
    belt = ck.Piece("belt", BELT, scale=1.2)
    belt.meta["y"] = by
    ck.band(fit, belt, on_tunic, by, 0.045, d=0.0025, n=20, rows=2)
    ck.thicken(belt, 0.004, depth=None, crease=0.1)
    on_belt = ck.Onto([belt])
    buckle = ck.Piece("buckle", BRASS, scale=1.5)
    bc = on_belt.snap((0.0, by, 0.3), 0.004)
    ck.strap_grid(fit, buckle, [bc + (0, 0.026, 0), bc + (0, -0.026, 0)], 0.058, 0.004, cols=4, onto=on_belt,
                  rows=4, wfn=lambda p: fit.near_w(p, ("torso",)))
    ck.thicken(buckle, 0.004, depth=None, crease=0.12)
    frog = ck.Piece("frog", BELT, scale=1.2)
    hx = 0.168 * P["f"]["hip"] * P["w"]
    ck.strap_grid(fit, frog, [(hx + 0.03, by, 0.02), (hx + 0.035, by - 0.06, 0.02), (hx + 0.036, by - 0.10, 0.02)],
                  0.035, 0.0045, cols=3, onto=on_tunic, rows=4, wfn=lambda p: fit.near_w(p, ("torso",)))
    ck.thicken(frog, 0.004, depth=None, crease=0.1)
    pieces += [belt, buckle, frog]

    # trousers, straight, over the boots
    straight = ck.straight_leg(fit, 0.068 * P["w"], fit.knee_y - 0.10)

    def tr_ease(i):
        part, ring, col_ = ck.info(fit, i)
        if part == "torso":
            return 0.008 if ring >= 3 else 0.011
        e = {"l1": 0.012, "l2": 0.013, "l3": 0.014}.get(ring, 0.015)
        return straight(i, e)

    tr = ck.Piece("trousers", TROUSERS)
    ck.trousers(fit, tr, top_row=3, hem="t2", ease=tr_ease)
    ck.smooth_weights(tr, iters=4, mask=lambda p: abs(p[1] - fit.knee_y) < 0.16)
    ck.thicken(tr, 0.0022, depth=0.05)
    pieces.append(tr)

    bt = ck.Piece("boots", BOOT, scale=1.2)
    so = ck.Piece("soles", SOLE, scale=0.8)
    for S in "LR":
        ck.shoe(fit, bt, so, S)
    pieces += [bt, so]

    kp = ck.Piece("kepi", KEPI, scale=1.3, hat=True)
    pk = ck.Piece("kepi_peak", PEAK, scale=1.3, hat=True)
    ids, _ = ck.kepi(fit, kp, pk)
    V = np.array(kp.V)
    c, top = ck.head_axis(fit)
    kp.meta.update(y0=float(V[ids[0]][:, 1].min()), band_top=float(V[ids[1]][:, 1].mean()), zc=float(c[2]),
                   top_edge=float(V[ids[3]][:, 1].mean()))
    front = V[ids[1], :][0]
    kp.meta["badge"] = front + np.array((0.0, 0.018, 0.002))
    sidep = V[ids[0]][3]
    kp.meta["strap_button"] = np.array((abs(sidep[0]), kp.meta["y0"] + 0.009, sidep[2]))
    ck.thicken(kp, 0.0025, depth=0.03)
    ck.thicken(pk, 0.0035, depth=None, crease=0.1)
    pieces += [kp, pk]
    return pieces


def police_covers(p, part):
    x, y, z = p
    if part == "torso" or part.startswith("leg"):
        return True
    if part == "neck":
        return y < bd.Y(PM, 0.858)
    if part.startswith("arm"):
        return y > bd.Y(PM, 0.499) + 0.022
    return False


def police_skin(ctx):
    """Under the tunic's neckline a dark wool undershirt shows, not the skin of the shoulders."""
    ck.undershirt(ctx, (0.10, 0.11, 0.16), bd.Y(PM, 0.858), zone=1, covers=police_covers)  # up to the collar


POLICE = Kind(
    "police", "uniform", "man_middling",
    face=dict(type="flemish_police", seed=1873186, sex="m", age=42,
              look=dict(stubble=0.2, weather=0.6, ruddy=0.3, hair="dark", hair_rgb=hexrgb(0x2a2420))),
    hair=dict(hair="crop", beard=None, moustache="handlebar"),  # under the kepi (kindHair police: crop)
    dress=police_dress, covers=police_covers, skin=police_skin, hats=("kepi", "kepi_peak"),
    held=[("held_sabre", "hipL", "the sabre in its scabbard on the left hip (held_scabbard hangs on hipL; "
                                 "held_sabre sits in it at sheathed, or in gripR drawn)"),
          ("held_scabbard", "hipL", "hangs from the belt's frog"),
          ("held_truncheon", "gripR", "drawn: in the right fist, hand shape grip")],
    avoid={"walk_f": "a woman's walk", "talk_f": "a woman's talk", "beg": "not on duty", "scrub": "not on duty"},
    note="agent of the Antwerp city police: dark blue tunic, kepi, belt and sabre, truncheon when needed")

KINDS = [POLICE]
