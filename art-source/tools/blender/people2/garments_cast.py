"""Cast clothing cuts. Geometry is fitted before painting; all cut edges have cloth facings.

Reuse the first-pass tailored blocks, without modifying their shared Cloth instances.
The local additions are knitted caps, felt hats, the oilskin brim and child breeches.
"""
import copy
import math

import numpy as np

from . import body as bd, clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from .kinds_cast import sooi_dress
from .kinds_women import fishwife_a_dress


def cloth(colour, material="wool", **kw):
    return Cloth(hexrgb(colour), material, **kw)


def recolour(pc, colour, **kw):
    pc.cloth = copy.copy(pc.cloth)
    pc.cloth.rgb = np.array(hexrgb(colour), np.float32)
    pc.cloth.lining = pc.cloth.rgb * 0.75
    for key, value in kw.items():
        setattr(pc.cloth, key, value)


def seams(ctx):
    """Panel seams, neck placket, cuffs, and worn elbows on a closed working top."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    arm = ctx.zone == "arm"
    ck.seam_line(ctx, np.where(~arm & (ctx.z > 0), np.abs(ctx.x) - 0.014, 1.0), stitches=False)
    for k in range(3):
        ck.button(ctx, ctx.fit.snap((0, Y(0.79) - k * 0.032, 0.12), 0.02), r=0.0055)
    ck.seam_line(ctx, np.where(arm, ctx.y - Y(0.54), 1.0))
    elbow = arm * np.exp(-((ctx.y - Y(0.63)) / 0.04) ** 2) * (ctx.z < 0)
    ctx.mix(elbow * 0.22, ctx.piece.cloth.rgb * 1.2)


def knitted(ctx):
    # Broad rib at the doubled lower band, finer stocking stitch on the crown.
    a = np.arctan2(ctx.x, ctx.z - ctx.piece.meta["centre_z"])
    rib = np.cos(a * 90)
    band = sm(ctx.piece.meta["band_y"] + 0.036, ctx.piece.meta["band_y"] + 0.028, ctx.y)
    ctx.bump(rib * band, 0.00035)
    ctx.mul((0.5 - 0.5 * rib) * band, 0.87)
    ck.seam_line(ctx, ctx.y - ctx.piece.meta["band_y"] - 0.03, stitches=False)


def round_hat(fit, colour, style):
    """Closed rounded crown with a doubled band; felt brims are separate hemmed shells."""
    c, top = ck.head_axis(fit)
    chin = bd.Y(fit.P, 0.870)
    band_y = chin + fit.P["hs"] * 0.132
    n = 24
    a = np.arange(n) * 2 * math.pi / n
    radius = ck.head_support(fit, band_y, a) + 0.014
    knit = style == "knitcap"
    pc = ck.Piece("cap", cloth(colour, "wool" if knit else "felt", folds=0.25,
                              extra=knitted if knit else None), hat=True, scale=1.2)
    pc.meta.update(band_y=band_y, centre_z=c[2])
    if style == "tophat":
        stations = [(band_y, 1), (band_y + 0.018, 1.01), (top + 0.09, 0.94),
                    (top + 0.105, 0.97), (top + 0.108, 0.5)]
    else:
        stations = [(band_y, 1), (band_y + 0.014, 1.04), (band_y + 0.038, 1.04),
                    (top - 0.020, 1.0), (top + 0.015, 0.83), (top + 0.031, 0.45)]
    points = np.array([np.stack((c[0] + radius * r * np.sin(a), np.full(n, y),
                                c[2] + radius * r * np.cos(a)), -1) for y, r in stations])
    ids = pc.grid(points, ck.hat_weights, closed=True, seam_col=n // 2)
    tip = pc.add((c[0], stations[-1][0] + 0.003, c[2]), {"head": 1})
    for j in range(n):
        pc.face((ids[-1, j], ids[-1, (j + 1) % n], tip))
    pc.seam(ids[-1, n // 2], tip)
    pc.orient(lambda q: q - np.array((c[0], q[1] - 0.06, c[2])))
    ck.thicken(pc, 0.003 if knit else 0.0025, depth=0.03)
    out = [pc]
    if not knit:
        brim = ck.Piece("cap_brim", cloth(colour, "felt", folds=0, wear=0.35), hat=True)
        width = 0.035 if style == "bowler" else 0.045
        pts = []
        for d in (0, width * 0.45, width):
            y = band_y - 0.005 + 0.008 * (d / width) ** 2 * np.cos(a * 2)
            pts.append(np.stack((c[0] + (radius + d) * np.sin(a), y,
                                 c[2] + (radius + d) * np.cos(a)), -1))
        brim.grid(np.array(pts), ck.hat_weights, closed=True, seam_col=n // 2)
        brim.orient((0, 1, 0))
        ck.thicken(brim, 0.003, depth=None)
        out.append(brim)
    return out


def oilskin_hat(fit, colour):
    crown = round_hat(fit, colour, "bowler")[0]
    crown.cloth = cloth(colour, "canvas", sheen=0.4, folds=0.2, wear=0.55)
    c, _ = ck.head_axis(fit)
    y = crown.meta["band_y"]
    a = np.arange(32) * 2 * math.pi / 32
    radius = ck.head_support(fit, y, a) + 0.015
    brim = ck.Piece("cap_brim", crown.cloth, hat=True)
    pts = []
    for t in (0, 0.45, 1):
        width = 0.035 + 0.075 * (1 - np.cos(a)) / 2
        pts.append(np.stack((c[0] + (radius + width * t) * np.sin(a),
                             y - 0.045 * t * (1 - np.cos(a)) / 2,
                             c[2] + (radius + width * t) * np.cos(a)), -1))
    brim.grid(np.array(pts), ck.hat_weights, closed=True, seam_col=16)
    brim.orient((0, 1, 0))
    ck.thicken(brim, 0.0025, depth=None)
    return [crown, brim]


def working_top(fit, colour, material="wool", rolled=False):
    pc = ck.Piece("jersey" if material == "wool" else "shirt",
                  cloth(colour, material, wear=0.65, dust=0.18, tar=0.10, extra=seams))
    ck.upper(fit, pc, rows=(1, 9), neck=0, sleeve="f1" if rolled else "w1", ease=lambda i: 0.017)
    ck.thicken(pc, 0.003 if material == "wool" else 0.002, depth=0.05)
    collar = ck.Piece("shirt_collar", pc.cloth, scale=1.2)
    ck.collar(fit, collar, -0.1, 0.24, 0.019, 0.018, rows=2)
    ck.thicken(collar, 0.0025, depth=None)
    return [pc, collar]


def double_breasted(ctx):
    Y = lambda f: bd.Y(ctx.fit.P, f)
    front = (ctx.z > 0) & (ctx.zone != "arm")
    ck.seam_line(ctx, np.where(front, ctx.x - 0.065, 1.0))
    for sign in (-1, 1):
        for k in range(3):
            ck.button(ctx, ctx.fit.snap((sign * 0.065, Y(0.75) - k * 0.065, 0.14), 0.038),
                      r=0.009, rgb=(0.065, 0.065, 0.07))
    seams(ctx)


def closed_coat(fit, spec):
    co = ck.Piece("coat", cloth(spec["coat"], "canvas" if spec.get("oilskin") else "wool",
                                wear=0.55, tar=0.2, sheen=0.4 if spec.get("oilskin") else 0,
                                extra=double_breasted))
    vm, _ = ck.upper(fit, co, rows=(0, 9), neck=0, sleeve="w1", ease=lambda i: 0.027,
                     open_front=(lambda y: 0.073, lambda y: 0.062, 0.003))
    # The overlapped centre seam joins a closed hem, without a slit exposing the belly.
    loop = [vm[i] for i in fit.row(0)]
    hem = bd.Y(fit.P, spec.get("long", 0.42))
    ck.hang(fit, co, loop, [bd.Y(fit.P, 0.48), hem], clear=0.04, flare=0.06,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1, back_legs=0.7, spring=0.2, springs=("coat",)))
    co.meta.update(hem=hem, edge_x=0.065)
    ck.thicken(co, 0.003, depth=0.07)
    collar = ck.Piece("coat_collar", co.cloth, scale=1.2)
    ck.collar(fit, collar, -0.45, 0.42, 0.034, 0.03, rows=3, front_gap=0.07, fold=(0.04, 0.05))
    ck.thicken(collar, 0.003, depth=None)
    return [co, collar]


def tailored(fit, spec):
    """Open coat/waistcoat block, or a closed jersey/short-sleeve shirt on its own."""
    pcs = sooi_dress(fit)
    colours = {"coat": spec.get("coat", 0x4a4034), "coat_collar": spec.get("coat", 0x4a4034),
               "waistcoat": spec.get("vest", 0x3a342a), "shirt": spec.get("shirt", 0xa8a090),
               "shirt_collar": spec.get("shirt", 0xa8a090), "cuffL": spec.get("shirt", 0xa8a090),
               "cuffR": spec.get("shirt", 0xa8a090), "trousers": spec["trousers"],
               "boots": spec.get("boots", 0x221a12), "cap": spec["hat_col"],
               "kerchief": spec.get("kerchief", 0x3a3634), "kerchief_ends": spec.get("kerchief", 0x3a3634)}
    for pc in pcs:
        if pc.name in colours:
            recolour(pc, colours[pc.name])
        if pc.name == "trousers":
            pc.cloth.wear = spec.get("wear", 0.5)
        if pc.name in ("coat", "coat_collar"):
            pc.cloth.wear = spec.get("wear", 0.5)
            pc.cloth.dust = spec.get("dust", 0.12)
    if "jersey" in spec or spec.get("shirt_only"):
        pcs = [p for p in pcs if p.name in ("trousers", "boots", "soles", "cap", "cap_peak")]
        pcs += working_top(fit, spec.get("jersey", spec.get("shirt")),
                           "wool" if "jersey" in spec else "linen", spec.get("rolled", False))
    elif not spec.get("kerchief"):
        pcs = [p for p in pcs if not p.name.startswith("kerchief")]
    if spec.get("pea") or spec.get("oilskin"):
        pcs = [p for p in pcs if p.name not in ("coat", "coat_collar", "waistcoat")]
        pcs += closed_coat(fit, spec)
    # Coat skirts follow the legs and coat spring bones: lengthen only below the hips.
    if spec.get("long") and not spec.get("oilskin"):
        co = next(p for p in pcs if p.name == "coat")
        old = co.meta["hem"]
        new = bd.Y(fit.P, spec["long"])
        pivot = fit.hip_y
        for i, p in enumerate(co.V):
            if p[1] < pivot:
                q = p.copy()
                q[1] = pivot + (q[1] - pivot) * (pivot - new) / (pivot - old)
                co.V[i] = q
                co.W[i] = ck.hang_weights(fit, q, front_legs=1, back_legs=0.6,
                                         spring=0.25, springs=("coat",))
        co.meta["hem"] = new
    if spec.get("breeches"):
        tr = next(p for p in pcs if p.name == "trousers")
        # Collapse the lower rings into a short, closed turned hem below the knee.
        lo = 0.055
        target = fit.knee_y - 0.06
        for i, p in enumerate(tr.V):
            if p[1] < fit.knee_y:
                q = p.copy()
                q[1] = target + (p[1] - lo) / (fit.knee_y - lo) * (fit.knee_y - target)
                tr.V[i] = q
                tr.W[i] = fit.near_w(q, ("legL", "legR"))
    if spec.get("barefoot"):
        pcs = [p for p in pcs if p.name not in ("boots", "soles")]
    if spec.get("hat", "flatcap") != "flatcap":
        pcs = [p for p in pcs if p.name not in ("cap", "cap_peak")]
        pcs += oilskin_hat(fit, spec["hat_col"]) if spec["hat"] == "souwester" else round_hat(fit, spec["hat_col"], spec["hat"])
    if spec.get("chain"):
        chain = ck.Piece("watch_chain", cloth(0xa08038, "metal", folds=0, wear=0.3), scale=1.5)
        Y = lambda f: bd.Y(fit.P, f)
        ck.strap_grid(fit, chain, [(0.005, Y(0.68), 0.17), (0.045, Y(0.64), 0.17),
                                  (0.105, Y(0.655), 0.16)], [0.003] * 3, 0.018,
                      cols=3, rows=9, onto=ck.Onto([p for p in pcs if p.name == "waistcoat"]))
        ck.thicken(chain, 0.0015, depth=None)
        pcs.append(chain)
    return pcs


def plain_skirt(ctx):
    a = np.arctan2(ctx.x, ctx.z)
    ck.seam_line(ctx, np.abs(np.sin(a * 3)) * 0.15)
    ck.seam_line(ctx, ctx.y - ctx.piece.meta["hem"] - 0.018)


def plain_shawl(ctx):
    ck.seam_line(ctx, np.abs(ctx.x) - 0.15, stitches=False)


def women(fit, spec):
    pcs = fishwife_a_dress(fit)
    colours = {"bodice": spec["dress"], "skirt": spec["skirt"], "chemise": spec["collar"],
               "shawl": spec["shawl"], "cap": spec["hat_col"], "cap_frill": spec["hat_col"],
               "boots": spec["boots"], "apron": spec.get("apron", 0x7a8a90),
               "apron_band": spec.get("apron", 0x7a8a90)}
    for pc in pcs:
        if pc.name in colours:
            recolour(pc, colours[pc.name])
        if pc.name == "skirt":
            pc.cloth.extra = plain_skirt
        if spec.get("mourning") and pc.name == "shawl":
            pc.cloth.extra = plain_shawl
    if spec.get("mourning"):
        pcs = [p for p in pcs if p.name not in ("apron", "apron_band", "cap_frill")]
        bonnet = next(p for p in pcs if p.name == "cap")
        bonnet.cloth.kind = "felt"
        bonnet.cloth.extra = None
        ties = ck.Piece("bonnet_ties", bonnet.cloth, hat=True)
        # Short ribbons tied under the chin, clear of the collar (no theatrical veil).
        Y = lambda f: bd.Y(fit.P, f)
        for sign in (-1, 1):
            ck.strap_grid(fit, ties, [(sign * 0.075, Y(0.91), 0.025),
                                    (sign * 0.055, Y(0.867), 0.07), (sign * 0.01, Y(0.851), 0.08)],
                          [0.014, 0.016, 0.013], 0.012, cols=3, rows=5,
                          wfn=ck.hat_weights, parts=("head", "neck"))
        ck.thicken(ties, 0.0015, depth=None)
        pcs.append(ties)
    return pcs
