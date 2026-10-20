"""C3 tailored clothes. Metres, game axes; references/uncertainties in docs/people.md.

All open garment edges have closed, rounded thickness. Thin cloth lips and hidden
layer interfaces are intentional edge exceptions; metal ornaments have rounded lofts.
"""
import math
import numpy as np
from . import body as bd, clothes_kit as ck
from .clothes_kit import Cloth, hexrgb, sm
from . import held as geometry

NAVY = (0.11, 0.15, 0.23)
RED = (0.48, 0.13, 0.11)
BLACK = (0.065, 0.060, 0.058)
BRASS = Cloth((0.65, 0.49, 0.23), "metal", folds=0)
LEATHER = Cloth((0.045, 0.039, 0.035), "leather", wear=.3, folds=0)
LINEN = (0.72, 0.70, 0.63)


def tailoring(ctx):
    y, x, z = ctx.y, ctx.x, ctx.z
    arm = ctx.zone == "arm"
    ck.seam_line(ctx, np.where(~arm & (z > 0), x - .008, 1), stitches=True)
    ck.seam_line(ctx, np.where(~arm, y - ctx.fit.Y(.618), 1))
    ck.seam_line(ctx, np.where(~arm & (z < 0), np.abs(x) - .065, 1))
    cuff = ctx.piece.meta.get("cuff", ctx.fit.Y(.499) + .055)
    ck.seam_line(ctx, np.where(arm, y - cuff, 1))
    if "facing" in ctx.piece.meta:
        ctx.mix(arm & (np.abs(y - cuff) < .004), ctx.piece.meta["facing"])
    cassock = ctx.piece.name == "cassock"
    for yy in np.linspace(ctx.fit.Y(.827), .20 if cassock else ctx.fit.Y(.635), 28 if cassock else 7):
        ck.button(ctx, ctx.fit.snap((.008, yy, .17), ctx.piece.meta.get("ease", .019)),
                  r=.005 if cassock else .007, rgb=ctx.piece.meta.get("buttons", (.18, .16, .14)), metal=not cassock)
    if ctx.piece.meta.get("corporal"):
        # Two cloth chevrons on each lower sleeve, following the sleeve surface.
        for offset in (0, .013):
            d = y - cuff - .052 - offset - .40 * np.abs(z)
            ctx.mix(arm & (np.abs(d) < .0035), RED)


def trouser_detail(ctx):
    lx = np.abs(ctx.x) - ctx.fit.hip_x
    angle = np.arctan2(lx, ctx.z)
    side = np.abs(angle - math.pi / 2) * .07
    ck.seam_line(ctx, np.where(ctx.y < ctx.fit.hip_y, side, 1))
    if ctx.piece.meta.get("stripe"):
        ctx.mix((side < .009) & (ctx.y < ctx.fit.hip_y) & ~ctx.inner, ctx.piece.meta["stripe"])
    if ctx.piece.meta.get("check"):
        line = np.minimum(np.abs(np.sin(ctx.x * math.pi / .027)),
                          np.abs(np.sin(ctx.y * math.pi / .027)))
        ctx.mul(sm(.12, .02, line) * .5, .63)


def apron_detail(ctx):
    m = ctx.piece.meta
    ck.seam_line(ctx, np.abs(ctx.x) - m["width"] * .5 + .007)
    ck.seam_line(ctx, ctx.y - m["hem"] - .009)
    pocket = (np.abs(ctx.x) < .10) & (ctx.y < m["top"] - .12) & (ctx.y > m["top"] - .26)
    ck.seam_line(ctx, np.where(pocket, ctx.y - m["top"] + .12, 1))
    ck.seam_line(ctx, np.where(pocket, np.abs(ctx.x) - .094, 1))
    if m.get("flour"):
        noise = ck._noise3(ctx.pos, 65, 1873)
        ctx.mix((noise > .15) * (.18 + .22 * pocket), (.86, .84, .78))
    else:
        stain = np.exp(-((ctx.y - m["top"] + .22) / .11) ** 2) * np.exp(-(ctx.x / .13) ** 2)
        ctx.mix(stain * .12, (.30, .22, .14))


def trousers(fit, colour, stripe=None, checked=False, flour=False):
    pc = ck.Piece("trousers", Cloth(colour, "wool" if not flour else "linen", wear=.25,
                                     mud=.35, dust=.25 if flour else .06, extra=trouser_detail))
    pc.meta.update(stripe=None, check=checked)
    straight = ck.straight_leg(fit, .070 * fit.P["w"], fit.knee_y - .10)
    vmap = ck.trousers(fit, pc, top_row=3, hem="t2", ease=lambda i: straight(i, .016))
    if stripe:
        paths = []
        for side in "LR":
            rings = {}
            for source, vertex in vmap.items():
                tag = fit.C.tag[source]
                if fit.C.part[source] != "leg" + side:
                    continue
                ring = tag.get("ring")
                if ring is not None:
                    current = rings.get(ring)
                    if current is None or abs(pc.V[vertex][0]) > abs(current[0]):
                        rings[ring] = pc.V[vertex].copy()
            paths.append(sorted(rings.values(), key=lambda p: -p[1]))
        pc.meta["stripe_paths"] = paths
    ck.smooth_weights(pc, iters=4, mask=lambda p: abs(p[1] - fit.knee_y) < .16)
    ck.thicken(pc, .0022, depth=.05)
    return pc


def trouser_stripes(fit, tr):
    """A sewn cloth ribbon, so the red stripe cannot become a jagged UV boundary."""
    stripe = ck.Piece("trouser_stripes", Cloth(RED, "wool", wear=.3, mud=.35), scale=1.3)
    onto = ck.Onto([tr])
    for path in tr.meta["stripe_paths"]:
        ck.strap_grid(fit, stripe, path, .018, .0012, onto=onto, cols=3, rows=14)
    ck.thicken(stripe, .0009, depth=None)
    return stripe


def boots(fit):
    from .kinds_uniform import _boot_extra
    bt = ck.Piece("boots", Cloth(BLACK, "leather", wear=.35, mud=.4, mud_h=.065,
                                 folds=0, extra=_boot_extra), scale=1.2)
    sole = ck.Piece("soles", Cloth((.085, .061, .042), "leather", wear=.5, mud=.5, folds=0))
    for s in "LR":
        ck.shoe(fit, bt, sole, s)
    return [bt, sole]


def upper(fit, name, colour, sleeve="w1", hem=None, ease=.018, facing=None,
          buttons=(.19, .17, .15), corporal=False, lapels=False):
    pc = ck.Piece(name, Cloth(colour, "wool" if name != "shirt" else "linen", wear=.25,
                             mud=.22 if hem else 0, mud_h=.23, extra=tailoring,
                             lining=tuple(c * .7 for c in colour)))
    pc.meta.update(ease=ease, facing=facing, buttons=buttons, corporal=corporal)
    if facing is None:
        pc.meta.pop("facing")
    pc.meta["cuff"] = fit.Y(.499 if sleeve == "w1" else .60) + .055
    opening = lambda y: .018 + .065 * float(sm(fit.Y(.69), fit.Y(.84), y))
    vm, dup = ck.upper(fit, pc, rows=(0, 9), neck=0 if lapels else 1, sleeve=sleeve,
                      ease=lambda i: ease if ck.info(fit, i)[0] != "neck" else ease * .6,
                      open_front=(opening, lambda y: -opening(y), .003) if lapels else None)
    # Millimetre cloth rolls at elbow/waist: normal maps then add finer wrinkles.
    for source, vertex in vm.items():
        part, ring, col_ = ck.info(fit, source)
        if part.startswith("arm") and ring in ("a4", "e1", "e2", "e3", "f1"):
            ridge = {"a4": .001, "e1": .004, "e2": -.001, "e3": .004, "f1": .001}[ring]
            pc.V[vertex] += fit.N[source] * ridge * (.65 + .35 * math.cos(col_ * 1.7))
        elif part == "torso" and isinstance(ring, int) and 1 <= ring <= 3:
            pc.V[vertex] += fit.N[source] * .0025 * math.sin(col_ * 2.2 + ring * 1.1)
    if hem:
        ck.hang(fit, pc, ck.row_loop(fit, vm, 0, dup),
                np.linspace(fit.Y(.48), hem, 6), clear=ease + .015, flare=.12, closed=not lapels,
                folds=lambda j, d: .003 * math.sin(j * 2.1) * min(1, d / .15),
                wfn=lambda p: ck.hang_weights(fit, p, front_legs=1, back_legs=.75,
                                             spring=.08, springs=("coat",)))
    ck.thicken(pc, .003 if hem else .002, depth=.065)
    pieces = [pc]
    col = ck.Piece(name + "_collar", Cloth(facing or colour, "wool" if facing else "linen", wear=.15, folds=.15))
    ck.collar(fit, col, -.06, .9, ease + .005, ease * .7, rows=3)
    ck.thicken(col, .0025, depth=.024)
    pieces.append(col)
    if lapels:
        onto = ck.Onto([pc], skip_zones=("arm",))
        lp = ck.Piece("lapels", Cloth(colour, "wool", wear=.15, folds=.2))
        for s in (-1, 1):
            ck.strap_grid(fit, lp, [(s * .055, fit.Y(.843), .14),
                                   (s * .10, fit.Y(.78), .19), (s * .026, fit.Y(.67), .19)],
                          [.043, .068, .014], .007, onto=onto, cols=4, rows=7)
        ck.thicken(lp, .003, depth=None)
        pieces.append(lp)
    return pieces


def belt(fit, garment, colour=LEATHER):
    onto = ck.Onto([garment], skip_zones=("arm",))
    pc = ck.Piece("belt", colour)
    ck.band(fit, pc, onto, fit.Y(.618), .047, d=.005, rows=3)
    ck.thicken(pc, .0035, depth=None)
    buckle = ck.Piece("buckle", BRASS, scale=1.5)
    p = onto.snap((0, fit.Y(.618), .3), .011)
    # Separate rounded bars leave a real opening in the buckle.
    for path in ([p + (-.025, -.019, 0), p + (-.025, .019, 0)],
                 [p + (.025, -.019, 0), p + (.025, .019, 0)],
                 [p + (-.025, -.019, 0), p + (.025, -.019, 0)],
                 [p + (-.025, .019, 0), p + (.025, .019, 0)]):
        start = len(buckle.V)
        geometry.sweep(buckle, path, .0025, .0025, 6, up=(0, 0, 1))
        for i in range(start, len(buckle.V)):
            buckle.W[i] = fit.near_w(buckle.V[i], ("torso",))
    return [pc, buckle]


def apron(fit, garment, colour, flour=False):
    """Split lap weights keep the open-sided apron on the thighs when sitting."""
    onto = ck.Onto([garment], skip_zones=("arm",))
    pc = ck.Piece("apron", Cloth(colour, "linen", wear=.45, mud=.3, mud_h=.22, extra=apron_detail))
    top, hem = fit.Y(.618), fit.Y(.29)
    width = .37 * fit.P["w"]
    rows = []
    for k, y in enumerate(np.linspace(top, hem, 10)):
        row = []
        for x in np.linspace(-width / 2, width / 2, 13):
            p = fit.snap((x, y, .28), .029, ("torso", "leg"))
            p[0], p[1] = x, y
            p[2] = max(p[2], .135) + .004 * math.cos(x * 95) * k / 9
            row.append(p)
        rows.append(row)
    pc.grid(np.array(rows), lambda p: ck.hang_weights(fit, p, front_legs=1, back_legs=1, spring=.02))
    pc.orient((0, 0, 1))
    pc.meta.update(top=top, hem=hem, width=width, flour=flour)
    ck.thicken(pc, .0018, depth=None)
    band = ck.Piece("apron_ties", Cloth(colour, "linen", wear=.3, folds=.2))
    ck.band(fit, band, onto, top, .025, d=.012, rows=2)
    ck.thicken(band, .0015, depth=None)
    return [pc, band]


def round_hat(fit, style, colour=BLACK):
    crown = ck.Piece("hat", Cloth(colour, "felt", wear=.18, folds=0), hat=True, scale=1.2)
    brim = ck.Piece("hat_brim", Cloth(colour, "felt", wear=.25, folds=0), hat=True, scale=1.2)
    c, top = ck.head_axis(fit)
    y0 = top - .064
    phis = np.linspace(0, 2 * math.pi, 24, endpoint=False)
    r = ck.head_support(fit, y0, phis) + .015
    height = .18 if style == "top" else .06 if style == "wide" else .105
    rows = []
    for dy, scale in ((0, 1), (.015, 1), (height * .65, .93), (height - .006, 1.01),
                      (height, .99), (height + .001, .55)):
        if style == "bowler":
            scale *= 1 - .40 * (dy / height) ** 2
        rows.append(np.stack((c[0] + r * scale * np.sin(phis), np.full(24, y0 + dy),
                              c[2] + r * scale * np.cos(phis)), -1))
    ids = crown.grid(np.array(rows), ck.hat_weights, closed=True, seam_col=12)
    centre = crown.add((c[0], y0 + height + .002, c[2]), ck.hat_weights(None))
    for j in range(24):
        crown.face((ids[-1, j], ids[-1, (j + 1) % 24], centre))
    crown.orient(lambda p: p - (c[0], p[1] - .05, c[2]))
    extension = .090 if style == "wide" else .038
    rows = [np.stack((c[0] + (r + d) * np.sin(phis),
                      y0 + .003 + (.005 * np.sin(phis) ** 2 if style != "wide" else np.zeros(24)),
                      c[2] + (r + d) * np.cos(phis)), -1) for d in (-.020, .015, extension)]
    brim.grid(np.array(rows), ck.hat_weights, closed=True, seam_col=12)
    brim.orient((0, 1, 0))
    ck.thicken(crown, .0025, depth=.035)
    ck.thicken(brim, .003, depth=None)
    return [crown, brim]


def military_hat(fit, shako=True, colour=NAVY):
    pc = ck.Piece("shako" if shako else "kepi", Cloth(colour, "felt", wear=.2, folds=0), hat=True)
    pk = ck.Piece("peak", LEATHER, hat=True)
    ids, _ = ck.kepi(fit, pc, pk, n=24, height=.19 if shako else .075,
                     slope=.010 if shako else .022, taper=-.006 if shako else .010)
    ck.thicken(pc, .003, depth=.04)
    ck.thicken(pk, .003, depth=None)
    pieces = [pc, pk]
    if shako:
        c, top = ck.head_axis(fit)
        v = np.array(pc.V)[ids[3, 0]]
        pom = ck.Piece("pompom", Cloth(RED, "wool", wear=.1, folds=0), hat=True)
        geometry.loft_y(pom, [(v[1] + dy, v[0], v[2], r, r, 2) for dy, r in
                             ((.006, .006), (.019, .019), (.040, .026), (.061, .019), (.073, .004))], 12)
        plate = ck.Piece("shako_plate", BRASS, hat=True)
        q = np.array(pc.V)[ids[2, 0]] + (0, -.015, .006)
        geometry.loft_y(plate, [(q[1] + dy, q[0], q[2], rx, .0025, 2.5) for dy, rx in
                               ((-.023, .009), (-.017, .019), (.017, .019), (.025, .008))], 12)
        for item in (pom, plate):
            item.W = [ck.hat_weights(p) for p in item.V]
        pieces += [pom, plate]
    return pieces


def dress_soldier(fit, corporal=False, sentry=False):
    if sentry:
        from .held_uniform import fit_rifle_socket
        fit_rifle_socket(fit)
    tr = trousers(fit, (.29, .33, .39), RED)
    p = [tr, trouser_stripes(fit, tr)] + boots(fit)
    coat = upper(fit, "tunic", NAVY, hem=fit.Y(.405), facing=RED,
                 buttons=BRASS.rgb, corporal=corporal)
    p += coat + belt(fit, coat[0]) + military_hat(fit)
    if sentry:
        pouch = ck.Piece("cartridge_pouches", LEATHER)
        onto = ck.Onto([coat[0]], skip_zones=("arm",))
        for x in (-.115, .115):
            q = onto.snap((x, fit.Y(.605), .25), .016)
            start = len(pouch.V)
            geometry.loft_y(pouch, [(q[1] + dy, q[0], q[2] + .018, .044, .020, 5)
                                   for dy in (-.052, -.048, .020, .024)], 12)
            for i in range(start, len(pouch.V)):
                pouch.W[i] = fit.near_w(pouch.V[i], ("torso",))
        p.append(pouch)
    return p


def dress_customs(fit):
    green = (.14, .19, .15)  # inherited palette, historical uncertainty explicitly recorded
    coat = upper(fit, "tunic", green, hem=fit.Y(.405), facing=(.31, .37, .27), buttons=(.65, .66, .63))
    return [trousers(fit, (.16, .18, .16))] + boots(fit) + coat + belt(fit, coat[0]) + military_hat(fit, False, green)


def dress_priest(fit):
    coat = upper(fit, "cassock", BLACK, hem=.14, ease=.025)
    sash = ck.Piece("sash", Cloth(BLACK, "wool", wear=.2, folds=.2))
    ck.band(fit, sash, ck.Onto([coat[0]], skip_zones=("arm",)), fit.Y(.618), .072, d=.006, rows=3)
    ck.thicken(sash, .002, depth=None)
    return [trousers(fit, BLACK)] + boots(fit) + coat + [sash] + round_hat(fit, "wide")


def dress_civilian(fit, role):
    palettes = {"gentleman": (.12, .12, .13), "clerk": (.18, .19, .21), "tourist": (.37, .31, .23),
                "shopkeeper": (.32, .31, .28), "publican": (.38, .14, .12), "baker": LINEN}
    formal = role in ("gentleman", "clerk", "tourist")
    p = [trousers(fit, (.30, .29, .27) if role != "baker" else LINEN,
                   checked=role == "gentleman", flour=role == "baker")] + boots(fit)
    shirt = upper(fit, "shirt", LINEN, sleeve="w1" if formal else "e1", ease=.011)
    p += shirt
    if role != "baker":
        coat = upper(fit, "frock_coat" if formal else "waistcoat", palettes[role],
                     sleeve="w1" if formal else None, hem=fit.Y(.32) if formal else None,
                     ease=.030 if formal else .024, lapels=True)
        p += coat
    else:
        coat = shirt
    if formal:
        tie = ck.Piece("tie", Cloth(BLACK, "cotton", wear=.1, folds=.2))
        ck.strap_grid(fit, tie, [(0, fit.Y(.844), .15), (0, fit.Y(.82), .18), (0, fit.Y(.75), .20)],
                      [.035, .023, .027], .006, onto=ck.Onto([coat[0]], skip_zones=("arm",)), cols=3, rows=5)
        ck.thicken(tie, .002, depth=None)
        p += [tie] + round_hat(fit, "top" if role == "gentleman" else "bowler", BLACK if role != "tourist" else (.29, .25, .20))
    else:
        p += apron(fit, coat[0], (.31, .22, .14) if role == "shopkeeper" else LINEN, role == "baker")
        if role != "publican":
            cap = ck.Piece("cap", Cloth(LINEN if role == "baker" else palettes[role], "linen" if role == "baker" else "felt", wear=.3), hat=True)
            peak = ck.Piece("cap_peak", cap.cloth, hat=True)
            ck.flat_cap(fit, cap, peak, n=20, puff=.022 if role == "baker" else .012)
            ck.thicken(cap, .002, depth=.03)
            ck.thicken(peak, .002, depth=None)
            p += [cap, peak]
    return p

