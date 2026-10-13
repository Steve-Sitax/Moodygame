"""Things the women's kinds of package C2 carry (kinds_women2.py), one model each, on the hipL socket.

hipL's frame (docs/people.md "Sockets"; held.py's basket): +x out to the wearer's left, +y down, -z forward. Each
model is built straight in that frame (game axes at the socket): its near side clears a full skirt (about 0.13 m out
from the socket), it hangs from its handle, strap or chain. Painted in 3D like the clothes, in the held layer.

- held_basket_cloth: the maid's oval market basket with a bow handle, a white cloth tucked over what she bought;
- held_mussels: the fishwife's round, flatter basket heaped with mussels;
- held_rosary: a rosary of black wooden beads with a brass crucifix, hanging from the belt (the nun, the beguine);
- held_keys: the shopkeeper's wife's keys on an iron ring hanging from a hook at her waist;
- held_purse: the milk woman's leather money pouch on its strap, over her apron;
- held_bag: the English lady's small leather bag (a chatelaine bag) hanging from a chain at her waist.
"""

import math

import numpy as np

from . import clothes_kit as ck
from .clothes_kit import Cloth, sm
from .held import loft_y, sweep

OUT = 0.165  # the middle of a basket out from the socket (its near side just clear of the skirt)


def _wicker(ctx):
    ang = np.arctan2(ctx.x - OUT, ctx.z)
    weave = np.sin(ang * 44) * np.sin(ctx.y * 2 * math.pi / 0.012)
    ctx.bump(weave, 0.0008)
    ctx.mul(0.5 + 0.5 * weave, 0.84)
    ctx.mix(ctx.inner * 0.3, (0.30, 0.24, 0.16))


def _withy(ctx):
    tw = np.sin(ctx.x * 300 + ctx.y * 160 + ctx.z * 200)
    ctx.bump(tw, 0.0004)
    ctx.mul(0.5 + 0.5 * tw, 0.88)


def _basket(name, rx, rz, depth, rim_y, cloth_rgb=(0.58, 0.47, 0.30), n=12):
    """An oval wicker basket in hipL's frame: its rim at rim_y below the socket, `depth` deep, a bow handle."""
    bk = ck.Piece(name, Cloth(cloth_rgb, "wood", wear=0.2, folds=0.0, extra=_wicker))
    rows = []
    for yy, sc in ((rim_y + depth, 0.80), (rim_y + depth * 0.55, 0.97), (rim_y, 1.0)):
        rows.append([(OUT + rx * sc * math.sin(2 * math.pi * j / n), yy, rz * sc * math.cos(2 * math.pi * j / n))
                     for j in range(n)])
    ids = bk.grid(np.array(rows), lambda p: {}, closed=True, seam_col=n // 2)
    cv = bk.add(np.array((OUT, rim_y + depth + 0.006, 0.0)), {})
    for j in range(n):
        bk.face((ids[0, j], ids[0, (j + 1) % n], cv))
    bk.seam(cv, ids[0, n // 2])
    bk.orient(lambda q: q - np.array((OUT, rim_y + depth * 0.5, 0.0)))
    ck.thicken(bk, 0.007, depth=None, crease=0.08)
    rim = ck.Piece(name + "_rim", Cloth((0.47, 0.36, 0.22), "wood", folds=0.0, extra=_withy))
    path = [(OUT + rx * 1.02 * math.sin(a), rim_y - 0.004, rz * 1.02 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 17)]
    sweep(rim, path[::2], 0.006, 0.006, 4, caps=(False, False), up=(0.0, 1.0, 0.0))
    hd = ck.Piece(name + "_handle", Cloth((0.55, 0.44, 0.28), "wood", folds=0.0, extra=_withy), scale=1.2)
    arc = [(OUT, rim_y - (rim_y + 0.02) * math.sin(math.pi * k / 12) ** 0.8 - 0.004,
            -rz * 0.98 * math.cos(math.pi * k / 12)) for k in range(13)]
    sweep(hd, arc, 0.008, 0.008, 7, up=(1.0, 0.0, 0.0))
    return [bk, rim, hd]


def _cloth_extra(ctx):
    # a white cloth with a red woven border
    d = np.minimum(np.abs(np.abs(ctx.x - OUT) - 0.10), np.abs(np.abs(ctx.z) - 0.15))
    ctx.mix(np.exp(-((d - 0.012) / 0.004) ** 2) * 0.8 * (~ctx.inner), (0.55, 0.14, 0.12))
    ctx.bump(np.sin(ctx.x * 900) * np.sin(ctx.z * 900), 0.00005)


def basket_cloth():
    parts = _basket("mbasket", 0.11, 0.17, 0.15, 0.11)
    cl = ck.Piece("mbasket_cloth", Cloth((0.90, 0.89, 0.85), "cotton", wear=0.1, folds=1.0, extra=_cloth_extra),
                  scale=1.2)
    rows = []
    n, m = 7, 5
    for i in range(m):
        row = []
        for j in range(n):
            u = (j / (n - 1) - 0.5) * 2
            v = (i / (m - 1) - 0.5) * 2
            x = OUT + u * 0.13
            z = v * 0.19
            inside = max(abs(u), abs(v))
            y = 0.105 - 0.035 * (1 - inside ** 2) + (0.03 if inside > 0.85 else 0.0) * (inside - 0.85) / 0.15 \
                - 0.006 * math.sin(u * 5 + v * 3)
            row.append((x, y, z))
        rows.append(row)
    cl.grid(np.array(rows), lambda p: {})
    cl.orient((0.0, -1.0, 0.0))
    ck.thicken(cl, 0.0015, depth=None, crease=0.06)
    return parts + [cl]


def _mussel(ctx):
    n = ck._noise3(ctx.pos, 260.0, 4)
    shells = np.sin(ctx.x * 620 + 2 * np.sin(ctx.z * 300)) * np.sin(ctx.z * 540 + 2 * np.sin(ctx.x * 280))
    ctx.rgb[:] = np.array((0.10, 0.11, 0.15)) * (0.8 + 0.5 * np.clip(shells, 0, 1) + 0.2 * n)[:, None]
    ctx.mix(np.clip(shells - 0.75, 0, 1) * 2.5, (0.38, 0.42, 0.52))
    ctx.bump(np.abs(shells), 0.0012)


def mussels():
    parts = _basket("mussel_basket", 0.15, 0.15, 0.11, 0.12, cloth_rgb=(0.52, 0.42, 0.27), n=16)
    parts = [p for p in parts if not p.name.endswith("_handle")]
    # two side handles: short loops at the rim
    hd = ck.Piece("mussel_basket_lugs", Cloth((0.50, 0.40, 0.25), "wood", folds=0.0, extra=_withy))
    for sg in (1, -1):
        arc = [(OUT + 0.155 * math.cos(a) * 0.15 + sg * 0.0, 0.11 - 0.03 * math.sin(a), sg * (0.15 + 0.02 * math.sin(a)))
               for a in np.linspace(0, math.pi, 7)]
        arc = [(OUT + 0.04 * math.cos(a), 0.112 - 0.028 * math.sin(a), sg * (0.152 + 0.012 * math.sin(a)))
               for a in np.linspace(0, math.pi, 7)]
        sweep(hd, arc, 0.006, 0.006, 6, up=(0.0, 0.0, 1.0))
    heap = ck.Piece("mussels", Cloth((0.10, 0.11, 0.15), "metal", folds=0.0, extra=_mussel), scale=1.6)
    n = 16
    rows = []
    n = 12
    for k, (r, y) in enumerate(((0.148, 0.116), (0.10, 0.088), (0.045, 0.074))):
        rows.append([(OUT + r * math.sin(2 * math.pi * j / n), y - 0.004 * math.sin(j * 2.1 + k),
                      r * math.cos(2 * math.pi * j / n)) for j in range(n)])
    ids = heap.grid(np.array(rows), lambda p: {}, closed=True, seam_col=n // 2)
    cv = heap.add(np.array((OUT, 0.070, 0.0)), {})
    for j in range(n):
        heap.face((ids[-1, j], ids[-1, (j + 1) % n], cv))
    heap.orient((0.0, -1.0, 0.0))
    return parts + [hd, heap]


def _bead(ctx):
    ctx.rgb[:] = np.array((0.06, 0.045, 0.035)) * (0.9 + 0.2 * ck._noise3(ctx.pos, 400.0, 2))[:, None]


def _brass(ctx):
    n = ck._noise3(ctx.pos, 300.0, 3)
    ctx.rgb[:] = np.array((0.62, 0.47, 0.20)) * (0.85 + 0.15 * n)[:, None]


def rosary():
    """Black wooden beads (each a small diamond-section lozenge: rounded by the subdivision) on a loop from the
    belt, five decades shown by larger beads, and a brass crucifix on a short strand."""
    beads = ck.Piece("rosary_beads", Cloth((0.06, 0.045, 0.035), "wood", folds=0.0, extra=_bead), scale=2.0)
    pts = []
    for k in range(25):
        t = k / 24
        a = math.pi * t
        pts.append((0.10 + 0.01 * math.sin(2 * a), 0.012 + 0.20 * math.sin(a) ** 1.2, -0.02 * math.cos(a)))
    tail = [(0.10, 0.212 + 0.014 * k, 0.0) for k in range(1, 4)]
    for k, p in enumerate(pts[1:-1] + tail):
        r = 0.0055 if k % 6 != 3 else 0.0075
        loft_y(beads, [(p[1] - r, p[0], p[2], 0.0006, 0.0006, 2.0), (p[1], p[0], p[2], r, r, 2.0),
                       (p[1] + r, p[0], p[2], 0.0006, 0.0006, 2.0)], 4, caps=(True, True))
    cr = ck.Piece("rosary_cross", Cloth((0.62, 0.47, 0.20), "metal", folds=0.0, extra=_brass), scale=2.0)
    y0 = 0.212 + 0.014 * 3 + 0.008
    loft_y(cr, [(y0, 0.10, 0.0, 0.003, 0.0018, 4.0), (y0 + 0.048, 0.10, 0.0, 0.003, 0.0018, 4.0)], 4)
    sweep(cr, [(0.10 - 0.016, y0 + 0.014, 0.0), (0.10, y0 + 0.014, 0.0), (0.10 + 0.016, y0 + 0.014, 0.0)], 0.0028,
          0.0018, 4, up=(0.0, 1.0, 0.0))
    return [beads, cr]


def _iron(ctx):
    n = ck._noise3(ctx.pos, 200.0, 5)
    ctx.rgb[:] = np.array((0.16, 0.15, 0.14)) * (0.8 + 0.4 * n)[:, None]


def keys():
    kp = ck.Piece("keys", Cloth((0.16, 0.15, 0.14), "metal", folds=0.0, extra=_iron), scale=2.0)
    # the hook from the waistband and the ring
    sweep(kp, [(0.11, -0.01, 0.0), (0.115, 0.02, 0.0), (0.11, 0.035, 0.0)], 0.003, 0.003, 5, caps=(True, True),
          up=(0.0, 0.0, 1.0))
    ring = [(0.11 + 0.025 * math.sin(a), 0.06 - 0.025 * math.cos(a), 0.0) for a in np.linspace(0, 2 * math.pi, 13)]
    sweep(kp, ring, 0.0025, 0.0025, 5, caps=(False, False), up=(0.0, 0.0, 1.0))
    for k, (dx, ang) in enumerate(((-0.012, -0.25), (0.0, 0.05), (0.014, 0.3), (0.006, 0.15))):
        top = np.array((0.11 + dx, 0.085, 0.002 * k))
        d = np.array((math.sin(ang), math.cos(ang), 0.0))
        L = 0.07 + 0.012 * k
        bow = [top + d * 0.0, top + d * 0.012]
        sweep(kp, bow, 0.009, 0.0025, 6, caps=(True, True), up=(0.0, 0.0, 1.0))
        sweep(kp, [top + d * 0.012, top + d * L], 0.0028, 0.0028, 5, caps=(True, True), up=(0.0, 0.0, 1.0))
        bit = top + d * (L - 0.008)
        sweep(kp, [bit, bit + np.array((d[1], -d[0], 0.0)) * 0.012], 0.004, 0.0015, 4, caps=(True, True),
              up=(0.0, 0.0, 1.0))
    return [kp]


def _leather(ctx):
    n = ck._noise3(ctx.pos, 90.0, 6)
    ctx.mul(np.ones(len(n)), 1.0)
    ctx.rgb[:] = ctx.rgb * (0.85 + 0.25 * n)[:, None]
    ck.seam_line(ctx, np.abs(np.abs(ctx.z) - 0.04), width=0.0008)


def _pouch(name, rgb, w, h, d, top, strap_rgb=None, flap=True, frame=False):
    pc = ck.Piece(name, Cloth(rgb, "leather", wear=0.4, folds=0.0, extra=_leather), scale=1.4)
    st = []
    for k, (yy, sc) in enumerate(((top, 0.92), (top + h * 0.25, 1.0), (top + h * 0.7, 1.0), (top + h, 0.86),
                                  (top + h + 0.006, 0.5))):
        st.append((yy, OUT - 0.07, 0.0, d * 0.5 * sc, w * 0.5 * sc, 3.0))
    loft_y(pc, st, 10, caps=(True, True))
    out = [pc]
    if flap:
        fl = ck.Piece(name + "_flap", Cloth(np.array(rgb) * 0.85, "leather", wear=0.4, folds=0.0, extra=_leather),
                      scale=1.4)
        rows = []
        for yy, o in ((top - 0.004, 0.0), (top + h * 0.2, 0.004), (top + h * 0.42, 0.006)):
            rows.append([(OUT - 0.07 + d * 0.5 + 0.002 + o, yy, (u - 0.5) * w * 0.96) for u in np.linspace(0, 1, 5)])
        fl.grid(np.array(rows), lambda p: {})
        fl.orient((1.0, 0.0, 0.0))
        ck.thicken(fl, 0.002, depth=None, crease=0.1)
        out.append(fl)
    if frame:
        fr = ck.Piece(name + "_frame", Cloth((0.62, 0.50, 0.26), "metal", folds=0.0, extra=_brass), scale=2.0)
        sweep(fr, [(OUT - 0.07, top - 0.002, -w * 0.48), (OUT - 0.07, top - 0.006, 0.0), (OUT - 0.07, top - 0.002, w * 0.48)],
              0.003, 0.0045, 6, caps=(True, True), up=(1.0, 0.0, 0.0))
        out.append(fr)
    if strap_rgb is not None:
        sp = ck.Piece(name + "_strap", Cloth(strap_rgb, "metal" if frame else "leather", folds=0.0,
                                              extra=_brass if frame else _leather), scale=1.4)
        path = [(0.10, -0.01, 0.0), (OUT - 0.085, top * 0.5, 0.0), (OUT - 0.07, top - 0.004, 0.0)]
        sweep(sp, path, 0.0025 if frame else 0.006, 0.0025 if frame else 0.0018, 5, caps=(True, True),
              up=(0.0, 0.0, 1.0))
        out.append(sp)
    return out


def purse():
    return _pouch("purse", (0.24, 0.16, 0.10), 0.13, 0.12, 0.035, 0.05, strap_rgb=(0.20, 0.13, 0.08))


def bag():
    return _pouch("lady_bag", (0.10, 0.08, 0.07), 0.12, 0.09, 0.03, 0.10, strap_rgb=(0.62, 0.50, 0.26), flap=False,
                  frame=True)


MODELS = {"held_basket_cloth": basket_cloth, "held_mussels": mussels, "held_rosary": rosary, "held_keys": keys,
          "held_purse": purse, "held_bag": bag}
