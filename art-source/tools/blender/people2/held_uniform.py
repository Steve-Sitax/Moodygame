"""One socket model per C3 prop; rounded wood/leather and machined rifle details.

The bayonet cutting edge is intentionally sharp. Sources in docs/people.md.
The model grip is at zero, long axes +y in the socket frame, as held.py requires.
"""
import numpy as np
from . import B, G, clothes_kit as ck, held
from .clothes_kit import Cloth


def wood(ctx):
    grain = .5 + .5 * np.sin(ctx.y * 15 + np.sin(ctx.x * 130) * 4 + ctx.z * 220)
    ctx.mul(grain, .80)
    ctx.bump(grain, .00006)


WALNUT = Cloth((.28, .16, .085), "wood", wear=.25, folds=0, extra=wood)
STEEL = Cloth((.31, .32, .33), "metal", wear=.25, folds=0)
_rifle_frame = None


def fit_rifle_socket(fit):
    """Use D3's handR frame, so work clips do not hide the single rifle model.

    Match clips_work.rifle_on_hand's palm offset and rotation exactly. The result
    is local to the existing hand bone, independent of the pose played later.
    """
    from mathutils import Vector
    from .motion import RY, RX
    global _rifle_frame
    wrist = B(fit.J["handR"][0])
    knuckle = B(fit.J["middle1R"][0])
    palm = (knuckle - wrist) * .45 + Vector((.016 * fit.P["H"] / 1.67, 0, 0))
    inv = fit.b["ao"].data.bones["handR"].matrix_local.inverted()
    rotation = RY(-90) @ RX(-4)
    def transform(p):
        return np.array(G(inv @ (wrist + palm + Vector((0, 0, .02)) + rotation @ B(p))))
    _rifle_frame = transform


def rifle():
    """Albini-Braendlin silhouette: 1.36 m, three barrel bands, lock, hammer, rod.

    The rifle clips cradle the butt: origin here is the butt heel. +y runs toward
    the muzzle. Separate socket geometry avoids a rifle fused to a soldier's mesh.
    """
    stock = ck.Piece("rifle_stock", WALNUT, scale=1.2)
    held.loft_y(stock, [(y, 0, z, rx, rz, 3) for y, z, rx, rz in
                      ((-.06, .018, .020, .052), (-.054, .018, .028, .059),
                       (.13, .015, .027, .054), (.24, -.009, .020, .035),
                       (.34, -.020, .019, .027), (.44, -.013, .025, .028),
                       (.55, -.005, .023, .025), (.85, 0, .019, .020),
                       (1.10, 0, .016, .017), (1.17, 0, .012, .013))], 12)
    metal = ck.Piece("rifle_metal", STEEL, scale=1.5)
    held.loft_y(metal, [(y, 0, -.017, r, r, 2) for y, r in
                       ((.40, .016), (.43, .017), (.54, .014), (1.285, .0115),
                        (1.298, .0115), (1.30, .008))], 12, caps=(True, False))
    ck.thicken(metal, .002, depth=.015)
    for y in (.58, .82, 1.08):
        held.loft_y(metal, [(y + d, 0, -.003, .025, .027, 3) for d in (-.010, -.008, .008, .010)], 12)
    held.sweep(metal, [(0, .30, .04), (0, .29, .055), (0, .36, .068), (0, .42, .055), (0, .43, .03)], .003, .003, 8)
    held.sweep(metal, [(.026, .43, -.007), (.034, .46, -.01), (.038, .50, -.029)], .007, .006, 8)
    held.sweep(metal, [(0, .55, .024), (0, 1.18, .024)], .003, .003, 8)
    butt = ck.Piece("rifle_buttplate", STEEL)
    held.loft_y(butt, [(-.063, 0, .018, .021, .053, 3), (-.059, 0, .018, .0285, .0595, 3),
                      (-.054, 0, .018, .0285, .0595, 3)], 12)
    sling = ck.Piece("rifle_sling", Cloth((.24, .18, .11), "leather", wear=.4, folds=0))
    held.sweep(sling, [(0, .23, .055), (0, .48, .085), (0, .76, .078), (0, 1.07, .035)], .012, .002, 8)
    blade = ck.Piece("fixed_bayonet", STEEL)
    held.sweep(blade, [(.023, 1.245, -.018), (.030, 1.30, -.018), (.030, 1.62, -.018),
                       (.030, 1.70, -.018)], [.008, .008, .005, .0008], [.003, .003, .002, .0005], 6)
    pieces = [stock, metal, butt, sling, blade]
    if _rifle_frame is None:
        raise RuntimeError("Build sentry garments before its held rifle to fit handR")
    for pc in pieces:
        pc.V = [_rifle_frame(p) for p in pc.V]
    return pieces


def cane():
    pc = ck.Piece("cane", Cloth((.15, .10, .065), "wood", wear=.4, folds=0, extra=wood), scale=1.3)
    held.loft_y(pc, [(y, 0, 0, r, r, 2) for y, r in
                    ((-.030, .002), (-.024, .015), (-.01, .020), (.014, .018),
                     (.027, .010), (.055, .007), (.84, .006), (.86, .004))], 12)
    tip = ck.Piece("cane_ferrule", STEEL, scale=1.4)
    held.loft_y(tip, [(.838, 0, 0, .0067, .0067, 2), (.858, 0, 0, .0067, .0067, 2),
                     (.863, 0, 0, .004, .004, 2)], 10)
    return [pc, tip]


def pages(ctx):
    ctx.mul(.5 + .5 * np.sin(ctx.z * 2800), .84)


def book():
    paper = ck.Piece("book_pages", Cloth((.72, .68, .55), "linen", folds=0, extra=pages))
    held.loft_y(paper, [(-.087, 0, 0, .053, .010, 7), (-.083, 0, 0, .057, .012, 7),
                       (.083, 0, 0, .057, .012, 7), (.087, 0, 0, .053, .010, 7)], 12)
    cover = ck.Piece("book_cover", Cloth((.15, .075, .037), "leather", wear=.4, folds=0))
    for z in (-.015, .015):
        held.loft_y(cover, [(-.094, 0, z, .057, .002, 6), (-.090, 0, z, .062, .003, 6),
                           (.090, 0, z, .062, .003, 6), (.094, 0, z, .057, .002, 6)], 12)
    held.sweep(cover, [(-.061, -.09, 0), (-.061, .09, 0)], .004, .017, 8)
    return [paper, cover]


def bayonet_scabbard():
    pc = ck.Piece("bayonet_scabbard", Cloth((.06, .05, .045), "leather", wear=.35, folds=0))
    held.loft_y(pc, [(y, 0, 0, rx, rz, 3) for y, rx, rz in
                    ((-.085, .012, .015), (-.080, .016, .019), (-.008, .014, .016),
                     (0, .011, .015), (.39, .009, .011), (.42, .003, .005))], 10)
    return [pc]


MODELS = {"held_rifle": rifle, "held_cane": cane, "held_book": book,
          "held_bayonet_scabbard": bayonet_scabbard}


def register():
    held.MODELS.update(MODELS)
    held.HANG.update({"held_bayonet_scabbard": {"tiltBackDeg": 20},
                      "held_cane": {"tiltBackDeg": 0}, "held_rifle": {"tiltBackDeg": 0}})
