"""The player's clothes (jef_* kinds; docs/people.md "The player"). Antwerp, autumn 1873.

Every cut of the old player (build_player.py: m_shirt, m_jacket, m_coat, m_smock, m_apron, m_jacket_apron, w_plain,
w_apron, w_shawl, w_shawl_apron) as a dressed kind on the people2 kit, a man's and a woman's version of each where the
old player had both, and period-right women's versions of the men's cuts. Made from the same pieces as the townspeople
(clothes_kit, cloth_detail, garments_women); the pieces are named and tagged with the colour slot the character
screen paints them with (`pc.slot`: coat, shirt, vest, lower, apron, boots, hat), so the runtime can tint each garment
(kinds_player.py "The tint pack").

Sleeves are made for a first-person view (0.3 to 0.6 m): every cut ends its sleeve in a closed, thick cuff (a band
piece with a rounded rim, `cuffL`/`cuffR`), the jacket and coat sleeves over the shirt's own cuffs.
"""
import copy
import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from . import cloth_detail as cd
from . import garments_women as gw
from . import kinds_cast as kc
from . import kinds_women2 as kw2
from .clothes_kit import Cloth, hexrgb, sm

# ---------------------------------------------------------------- the colour slots

SLOTS = ["skin", "hair", "hat", "coat", "shirt", "vest", "lower", "apron", "boots"]  # build_player.py's order
SLOT_ID = {s: i for i, s in enumerate(SLOTS, start=1)}

# What the old character screen starts from (Character.cs Jef and Mie): the colours the pictures ship in.
JEF = dict(hat=0x38383a, coat=0x5a4432, shirt=0xc4baa0, vest=0x38383a, lower=0x6e6a62, apron=0xc4baa0, boots=0x5a4632)
MIE = dict(hat=0xe2ded2, coat=0x8a3e32, shirt=0x46505a, vest=0x38383a, lower=0x5a4432, apron=0xc4baa0, boots=0xbfa070)
# a smock is blue by habit
SMOCK_BLUE = 0x34425a


def mk(name, slot, cloth, scale=1.0, hat=False):
    """A piece tagged with its colour slot (None: its colours are fixed: soles, buttons, brass)."""
    pc = ck.Piece(name, cloth, scale=scale, hat=hat)
    pc.slot = slot
    pc.slot_id = SLOT_ID[slot] if slot else 0
    return pc


def cl(colour, material="wool", **kw):
    return Cloth(hexrgb(colour), material, **kw)


def tag(pieces, slot, names=None):
    for pc in pieces:
        if names is None or pc.name in names:
            pc.slot, pc.slot_id = slot, SLOT_ID[slot] if slot else 0
    return pieces


# ---------------------------------------------------------------- painters of the men's cuts

def _coat_paint(ctx):
    """Tailored fronts, pocket flaps, cuffs, buttons, wear at the elbows in the coat's own colour."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    arm = ctx.zone == "arm"
    front = (ctx.z > 0) & ~arm & ~ctx.inner
    edge_x = ctx.piece.meta.get("edge_x", 0.055)
    edge = np.abs(np.abs(ctx.x) - edge_x)
    ck.seam_line(ctx, np.where(front, edge - 0.008, 1.0))
    lap = front & (ctx.y > Y(0.71)) & (edge < 0.035 + (ctx.y - Y(0.71)) * 0.25)
    ctx.mul(lap, 0.92)
    ck.seam_line(ctx, np.where(lap, edge - 0.035 - (ctx.y - Y(0.71)) * 0.25, 1.0), stitches=False)
    ck.seam_line(ctx, np.where((ctx.z < 0) & ~arm, np.abs(ctx.x), 1.0))
    for sg in (1, -1):
        fl = front & (np.abs(ctx.x - sg * 0.12) < 0.07) & (np.abs(ctx.y - Y(0.575)) < 0.025)
        ctx.mul(fl, 0.9)
        ck.seam_line(ctx, np.where(front & (np.abs(ctx.x - sg * 0.12) < 0.07), ctx.y - Y(0.575) + 0.025, 1.0))
    for k in range(3):
        ck.button(ctx, ctx.fit.snap((edge_x - 0.022, Y(0.72) - k * 0.075, 0.16), 0.034), r=0.009,
                  rgb=(0.13, 0.10, 0.08))
    cuff = ctx.piece.meta.get("cuff", Y(0.499))
    ck.seam_line(ctx, np.where(arm, ctx.y - cuff - 0.012, 1.0))
    elbow = arm * np.exp(-((ctx.y - Y(0.63)) / 0.045) ** 2) * sm(0.0, -0.04, ctx.z)
    ctx.mix(elbow * ctx.piece.cloth.wear * 0.5, ctx.piece.cloth.rgb * 1.2)
    hem = ctx.piece.meta.get("hem", Y(0.5))
    ctx.mix(sm(hem + 0.02, hem, ctx.y) * 0.2 * ~arm, ctx.piece.cloth.rgb * 1.25)


def _shirt_paint(ctx):
    """A linen shirt: a placket down the front with its buttons, shoulder and sleeve seams, a gathered wrist."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    arm = ctx.zone == "arm"
    front = (ctx.z > 0) & ~arm & ~ctx.inner
    ck.seam_line(ctx, np.where(front, np.abs(ctx.x) - 0.014, 1.0), stitches=True)
    for k in range(4):
        ck.button(ctx, ctx.fit.snap((0.0, Y(0.80) - k * 0.045, 0.15), 0.012), r=0.0055, rgb=(0.80, 0.78, 0.72))
    ck.seam_line(ctx, np.where(arm, ctx.y - Y(0.62), 1.0), stitches=False)
    elbow = arm * np.exp(-((ctx.y - Y(0.63)) / 0.05) ** 2) * (ctx.z < 0)
    ctx.mul(elbow * 0.5, 0.94)


def _waistcoat_paint(ctx):
    Y = lambda f: bd.Y(ctx.fit.P, f)
    for k in range(5):
        ck.button(ctx, ctx.fit.snap((-0.004, Y(0.725) - k * 0.042, 0.16), 0.016), r=0.0065, rgb=(0.17, 0.14, 0.11))
    ck.seam_line(ctx, np.where((ctx.z > 0) & ~ctx.inner, np.abs(ctx.x + 0.004) - 0.012, 1.0), stitches=False)
    ck.seam_line(ctx, np.where(ctx.z < 0, np.abs(ctx.x), 1.0))
    for sg in (1, -1):
        ck.seam_line(ctx, np.where((np.abs(ctx.x - sg * 0.09) < 0.04) & (ctx.z > 0), ctx.y - Y(0.64), 1.0),
                     width=0.0015, depth=0.0003, shade=0.6, stitches=False)
    # the back is a lighter lining stuff
    ctx.mul((ctx.z < -0.02) & ~ctx.inner, 1.12)


def _trouser_paint(ctx):
    side = np.abs(np.abs(np.degrees(np.arctan2(np.abs(ctx.x) - ctx.fit.hip_x, ctx.z))) - 90.0)
    ck.seam_line(ctx, np.where(ctx.y < ctx.fit.hip_y, side / 57.3 * 0.06, 1.0))
    knee = np.exp(-((ctx.y - ctx.fit.knee_y) / 0.06) ** 2) * (ctx.z > 0)
    ctx.mul(knee * 0.5, 1.12)
    ctx.mul(sm(0.15, 0.09, ctx.y), 0.88)
    # a button fly
    ck.seam_line(ctx, np.where((ctx.z > 0) & (ctx.y > ctx.fit.hip_y - 0.02), np.abs(ctx.x) - 0.012, 1.0),
                 stitches=False)


def _smock_paint(ctx):
    """The kiel: a round yoke seam at the shoulders, a short placket, gathers, pocket slits, wear."""
    Y = lambda f: bd.Y(ctx.fit.P, f)
    arm = ctx.zone == "arm"
    front = (ctx.z > 0) & ~arm & ~ctx.inner
    ck.seam_line(ctx, np.where(~arm, ctx.y - Y(0.76), 1.0))
    ck.seam_line(ctx, np.where(front & (ctx.y > Y(0.70)), np.abs(ctx.x) - 0.012, 1.0), stitches=True)
    for k in range(4):
        ck.button(ctx, ctx.fit.snap((0.0, Y(0.805) - k * 0.036, 0.15), 0.012), r=0.0055, rgb=(0.50, 0.46, 0.40))
    for sg in (1, -1):
        slit = front & (np.abs(ctx.x - sg * 0.16) < 0.05)
        ck.seam_line(ctx, np.where(slit, ctx.y - Y(0.56) + 0.02 * (ctx.x - sg * 0.16) * sg, 1.0), stitches=False)
    ck.seam_line(ctx, np.where(arm, ctx.y - ctx.piece.meta.get("cuff", Y(0.5)) - 0.05, 1.0))
    # tar and weather darken the lower body
    hem = ctx.piece.meta.get("hem", Y(0.40))
    ctx.mix(sm(hem + 0.04, hem, ctx.y) * 0.18 * ~arm, ctx.piece.cloth.rgb * 0.6)


def _apron_paint(ctx):
    m = ctx.piece.meta
    ck.seam_line(ctx, np.abs(ctx.x) - m["width"] * 0.5 + 0.007)
    ck.seam_line(ctx, ctx.y - m["hem"] - 0.009)
    pocket = (np.abs(ctx.x) < 0.10) & (ctx.y < m["top"] - 0.12) & (ctx.y > m["top"] - 0.26)
    ck.seam_line(ctx, np.where(pocket, ctx.y - m["top"] + 0.12, 1), stitches=True)
    ck.seam_line(ctx, np.where(pocket, np.abs(ctx.x) - 0.094, 1), stitches=True)
    stain = np.exp(-((ctx.y - m["top"] + 0.22) / 0.11) ** 2) * np.exp(-(ctx.x / 0.13) ** 2)
    ctx.mix(stain * 0.08, (0.30, 0.22, 0.14))


# ---------------------------------------------------------------- the men

def man_trousers(fit):
    tr = mk("trousers", "lower", cl(JEF["lower"], "wool", wear=0.4, mud=0.5, dust=0.15, extra=_trouser_paint))
    straight = ck.straight_leg(fit, 0.072 * fit.P["w"], fit.knee_y - 0.10)

    def tr_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            return 0.010 if ring >= 3 else 0.013
        e = {"l1": 0.014, "l2": 0.015, "l3": 0.016}.get(ring, 0.017)
        return straight(i, e)
    ck.trousers(fit, tr, top_row=3, hem="t2", ease=tr_ease)
    ck.smooth_weights(tr, iters=4, mask=lambda p: abs(p[1] - fit.knee_y) < 0.16)
    ck.thicken(tr, 0.0024, depth=0.05)
    hem = fit.Y(0.052)
    tr.relief = cd.compose(
        cd.bulge(lambda f: [np.asarray(f.J["legLow" + S][0]) + (0, 0.0, 0.05) for S in "LR"], 0.06, 0.004,
                 zone="leg", front=(0, 0, 1)),
        cd.bunch(hem + 0.02, hem + 0.09, period=0.04, depth=0.0018, zone="leg", limb=("legLow", "foot"), seed=5),
        cd.creases(lambda f: [np.asarray(f.J["legLow" + S][0]) + (0, 0, -0.05) for S in "LR"], 0.05, n=3,
                   depth=0.002, zone="leg"))
    return tr


def cuff_pieces(fit, cloth, slot, ring_in=("f2", "w1"), out=(0.011, 0.013), name="cuff", grow=1.22):
    """A closed shirt cuff round each wrist: a band between the cage's arm rings `ring_in`, standing `out` metres from
    the skin, its lower edge a little wider (it flares over the hand), thick and rounded at the rim."""
    pieces = []
    for S, sg in (("L", 1), ("R", -1)):
        c2 = copy.copy(cloth)
        c2.extra = None
        cf = mk(name + S, slot, c2, scale=1.5)
        idx = [i for i, (p, t) in enumerate(zip(fit.C.part, fit.C.tag)) if p == "arm" + S and t.get("ring") in ring_in]
        rings = {}
        for i in idx:
            rings.setdefault(fit.C.tag[i]["ring"], []).append(i)
        for k in rings:
            rings[k].sort(key=lambda i: fit.C.tag[i]["col"])
        pts = np.array([[fit.rest[i] + fit.N[i] * e for i in rings[nm]] for nm, e in zip(ring_in, out)])
        pts[1] = pts[0] + (pts[1] - pts[0]) * grow
        cf.grid(pts, lambda p, S=S: fit.near_w(p, ("arm" + S,)), closed=True, seam_col=6)
        cf.orient(lambda q, sg=sg: q - np.array((sg * bd.shoulder_x(fit.P), q[1], 0.0)))
        ck.thicken(cf, 0.0022, depth=None)
        pieces.append(cf)
    return pieces


def man_shirt(fit, material="linen", rolled=False, outer=False):
    """A working shirt: full sleeves to a buttoned cuff, a low band collar."""
    sh = mk("shirt", "shirt", cl(JEF["shirt"], material, wear=0.5, dust=0.15, extra=_shirt_paint), scale=1.0)
    sleeve = "e3" if rolled else "w1"
    def ease(i):
        part, ring, col = ck.info(fit, i)
        return 0.007 if part == "neck" else 0.009 if part == "torso" else 0.012
    ck.upper(fit, sh, rows=(1, 9), neck=0, sleeve=sleeve, ease=ease)
    ck.thicken(sh, 0.0018, depth=0.04)
    col = mk("shirt_collar", "shirt", cl(JEF["shirt"], material, wear=0.4, folds=0.2), scale=1.2)
    ck.neckerchief(fit, col, knot=False, ease=0.021)  # a rolled band: a closed ring, no sawtooth rim
    ck.thicken(col, 0.002, depth=0.012)
    out = [sh, col]
    if not rolled:
        # outermost at the wrist (no coat): the cuff stands proud of the sleeve; under a coat's sleeve it lies inside it
        out += cuff_pieces(fit, sh.cloth, "shirt", out=(0.019, 0.022) if not outer else (0.004, 0.005),
                           grow=1.22 if not outer else 1.0)
    return out


def man_waistcoat(fit):
    """A sleeveless waistcoat of the 1870s: buttoned to a V at the breast, its fronts rising beside the V to narrow
    shoulder straps that run over the shoulder's top to the back (the trunk's top row and the neck's foot, all but the
    front of it), cut in to arm holes at the cage's own holes."""
    def keep(i):
        part, ring, col = ck.info(fit, i)
        if part == "neck":
            return min(col, 16 - col) >= 2 if col >= 0 else False
        if part == "torso":
            c = min(col, 16 - col)
            if ring >= 9 and c <= 1:
                return False
            if ring >= 8 and c == 0:
                return False
        return True

    def wc_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "neck":
            return 0.008  # under the shirt's collar band
        return 0.014 if ring >= 8 else 0.019 if ring >= 4 else 0.023
    wc = mk("waistcoat", "vest", cl(JEF["vest"], "wool", wear=0.4, extra=_waistcoat_paint))
    ck.upper(fit, wc, rows=(1, 9), neck=0, sleeve=None, ease=wc_ease, keep=keep,
             open_front=(lambda y: -0.012, lambda y: 0.012, 0.003))
    ck.thicken(wc, 0.0026, depth=0.04)
    return [wc]


def man_coat(fit, long=False):
    """The open coat of sooi_dress, as a short jacket (hem at the hips) or a long coat (to the knee)."""
    Y = lambda f: bd.Y(fit.P, f)

    def coat_keep(i):
        part, ring, col = ck.info(fit, i)
        return not (part in ("torso", "neck") and col == 0)

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
    name = "coat"
    co = mk(name, "coat", cl(JEF["coat"], "wool", wear=0.5, dust=0.12, mud=0.12 if long else 0.0, extra=_coat_paint))
    vm, _ = ck.upper(fit, co, rows=(0, 9), neck=0, sleeve="w1", ease=coat_ease, keep=coat_keep)
    loop = [vm[i] for i in fit.row(0)[1:] if i in vm]
    hem = Y(0.31) if long else Y(0.462)
    heights = [Y(0.48), Y(0.40), hem] if long else [Y(0.49), hem]
    ck.hang(fit, co, loop, heights, clear=0.035, flare=0.10 if long else 0.06, closed=False,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.4 if long else 0.6,
                                         spring=0.3 if long else 0.15, springs=("coat",)))
    r6 = fit.row(6)
    co.meta.update(hem=hem, cuff=Y(0.499), edge_x=float(np.mean([abs(co.V[vm[r6[k]]][0]) for k in (1, 15)])))
    ck.thicken(co, 0.0035, depth=lambda p: 0.08 if p[2] > 0.05 else (0.08 if p[1] < fit.hip_y else 0.03))
    cuff = Y(0.537)
    co.relief = cd.compose(
        cd.hang_folds(Y(0.56), hem, n=5, depth=0.009 if long else 0.006, seed=17, zone=("skirt", "torso"),
                      exclude=lambda p: p[:, 1] > Y(0.62)),
        cd.bunch(cuff + 0.03, cuff + 0.11, period=0.028, depth=0.004, zone="arm"))
    cc = mk("coat_collar", "coat", cl(JEF["coat"], "wool", wear=0.5, folds=0.3), scale=1.2)
    ck.collar(fit, cc, -0.35, 0.50, 0.030, 0.026, rows=3, front_gap=0.13, fold=(0.022, 0.034))
    ck.thicken(cc, 0.003, depth=None, crease=0.05)
    return [co, cc]


def man_smock(fit):
    """The kiel of the docks (kinds_workers.docker_a_dress), the colour the player's."""
    P = fit.P
    Y = lambda f: bd.Y(P, f)

    def smock_ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            c = min(col, 16 - col)
            e = 0.010 if ring >= 8 else 0.020 + 0.014 * (8 - ring) / 8
            return e + (0.006 if c >= 6 else 0.0) + (0.004 if c <= 1 and ring <= 4 else 0.0)
        if part == "neck":
            return 0.009
        k = ck.ARM_SEQ.index(ring)
        return [0.011, 0.015, 0.019, 0.021, 0.021, 0.021, 0.021, 0.020, 0.019, 0.017, 0.009][k]
    smock = mk("smock", "coat", cl(SMOCK_BLUE, "linen", wear=0.55, dust=0.2, tar=0.1, extra=_smock_paint))
    vm, _ = ck.upper(fit, smock, rows=(0, 9), neck=0, sleeve="w1", ease=smock_ease)
    loop = ck.row_loop(fit, vm, 0)
    hem = Y(0.40)
    ck.hang(fit, smock, loop, [Y(0.47), Y(0.435), hem], clear=0.028, flare=0.08,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.5, spring=0.12), seam_at=8)
    smock.meta.update(hem=hem, cuff=Y(0.499))
    ck.thicken(smock, 0.0025, depth=lambda p: 0.07 if p[1] < fit.hip_y else 0.03)
    cuff = Y(0.499)
    smock.relief = cd.compose(
        cd.hang_folds(Y(0.72), hem, n=5, depth=0.012, seed=3, zone=("torso", "skirt")),
        cd.bunch(cuff + 0.05, cuff + 0.13, period=0.026, depth=0.0045, zone="arm"),
        cd.band(cuff - 0.01, cuff + 0.05, 0.0022, zone="arm"))
    collar = mk("smock_collar", "coat", cl(SMOCK_BLUE, "linen", wear=0.5, folds=0.2), scale=1.2)
    ck.neckerchief(fit, collar, knot=False, ease=0.022)  # a rolled band: a closed ring, no sawtooth rim
    ck.thicken(collar, 0.002, depth=0.012)
    return [smock, collar] + cuff_pieces(fit, smock.cloth, "coat", ring_in=("f2", "w1"), out=(0.013, 0.015),
                                         name="smock_cuff")


def man_apron(fit, onto_piece):
    """A long working apron tied at the waist (the farmhand's and the shopman's), laid on the shirt or the jacket."""
    onto = ck.Onto([onto_piece], skip_zones=("arm",))
    pc = mk("apron", "apron", cl(JEF["apron"], "linen", wear=0.45, mud=0.3, mud_h=0.22, extra=_apron_paint))
    top, hem = fit.Y(0.618), fit.Y(0.29)
    width = 0.37 * fit.P["w"]
    rows = []
    for k, y in enumerate(np.linspace(top, hem, 10)):
        row = []
        for x in np.linspace(-width / 2, width / 2, 13):
            p = fit.snap((x, y, 0.28), 0.029, ("torso", "leg"))
            p[0], p[1] = x, y
            p[2] = max(p[2], 0.135) + 0.004 * math.cos(x * 95) * k / 9
            row.append(p)
        rows.append(row)
    pc.grid(np.array(rows), lambda p: ck.hang_weights(fit, p, front_legs=1, back_legs=1, spring=0.02))
    pc.orient((0, 0, 1))
    pc.meta.update(top=top, hem=hem, width=width)
    ck.thicken(pc, 0.0018, depth=None)
    band = mk("apron_band", "apron", cl(JEF["apron"], "linen", wear=0.3, folds=0.2))
    ck.band(fit, band, onto, top, 0.025, d=0.012, rows=2)
    ck.thicken(band, 0.0015, depth=None)
    return [pc, band]


def men_dress(fit, cut):
    """cut: shirt, jacket, coat, smock, apron, jacket_apron."""
    pieces = [man_trousers(fit)]
    if cut == "smock":
        pieces += man_smock(fit)
        return pieces
    shirt = man_shirt(fit, outer=cut in ("jacket", "coat", "jacket_apron"))
    pieces += shirt
    wc = man_waistcoat(fit)
    pieces += wc
    outer = None
    if cut in ("jacket", "jacket_apron"):
        outer = man_coat(fit, long=False)
    elif cut == "coat":
        outer = man_coat(fit, long=True)
    if outer:
        pieces += outer
    if cut in ("apron", "jacket_apron"):
        pieces += man_apron(fit, (outer or wc)[0])
    return pieces


# ---------------------------------------------------------------- the women

PA = bd.params("woman", "middling")


def _shawl_paint(ctx):
    """A woven check darkening the shawl in bars (a multiplication, so it follows whatever colour the player gives
    the shawl); piece.meta["check"] False paints it plain (the tint pack's third paint: the bars' mask)."""
    if not ctx.piece.meta.get("check", True):
        return
    u = ctx.x + 0.25 * ctx.z
    v = ctx.y - 0.25 * ctx.z * np.sign(ctx.x + 1e-9)
    size, aa = 0.045, 0.06
    k = np.zeros(len(u))
    for per, wsh, strength in ((size, 0.16, 1.0), (size * 2, 0.34, 0.6)):
        du = np.abs(((u / per) + 0.5) % 1.0 - 0.5)
        dv = np.abs(((v / per) + 0.5) % 1.0 - 0.5)
        half = wsh / 2
        su = sm(half + aa * wsh, half - aa * wsh, du)
        sv = sm(half + aa * wsh, half - aa * wsh, dv)
        k = np.maximum(k, (np.maximum(su, sv) * 0.55 + su * sv * 0.45) * strength)
    ctx.mul(k * (~ctx.inner), 0.5)


def w_skirt(fit, hem=0.07, slot="lower", colour=None):
    sk = mk("skirt", slot, cl(colour or MIE["lower"], "wool", wear=0.35, mud=0.6, mud_h=0.18,
                              extra=kw2._skirt_extra(tucks=(0.20,))))
    gw.skirt(fit, sk, hem, n=24, ease=0.013, clear=0.045, flare=0.20, folds=9, fold_depth=0.018, back_legs=0.75)
    ck.thicken(sk, 0.003, depth=lambda p: 0.10 if p[1] < 0.5 else 0.03)
    return sk


def w_bodice(fit, name="bodice", colour=None, slot="shirt", material="wool", buttons=8, ease=None):
    bo = gw.bodice(fit, cl(colour or MIE["shirt"], material, wear=0.35, dust=0.06,
                            extra=kw2._bodice_extra(buttons, 0.80)), ease or gw.ease_table(fit), name=name)
    bo.slot, bo.slot_id = slot, SLOT_ID[slot]
    ck.thicken(bo, 0.0028, depth=0.035)
    return bo


class SkirtFit:
    """A Fit whose body support also counts a skirt: coats and smocks over a bell skirt hang outside it."""

    def __init__(self, fit, skirt):
        self._fit = fit
        self._pts = np.array(skirt.V, np.float64)

    def __getattr__(self, name):
        return getattr(self._fit, name)

    def support(self, c, dirs, y0, y1, parts=("leg", "torso")):
        base = self._fit.support(c, dirs, y0, y1, parts)
        m = (self._pts[:, 1] >= y0) & (self._pts[:, 1] <= y1)
        if not m.any():
            return base
        d = self._pts[m] - np.asarray(c)
        d[:, 1] = 0.0
        dirs = np.asarray(dirs)
        proj = d @ dirs.T
        ang = np.arctan2(d[:, 0], d[:, 2])[:, None] - np.arctan2(dirs[:, 0], dirs[:, 2])[None, :]
        ang = np.abs((ang + np.pi) % (2 * np.pi) - np.pi)
        near = np.where(ang < math.radians(25), proj, 0.0).max(axis=0)
        return np.maximum(base, near + 0.012)


LINEN_FIXED = (0.82, 0.78, 0.70)


def w_trim(fit, bo, collar=True, under=False):
    """The cream collar and cuffs of the old woman's dress: fixed colour, closed and thick at the rim (the collar a
    rolled ring, the cuffs standing proud of the sleeve: a thin rim would be torn by the layer clearance). under: a
    jacket's sleeve lies over them: the cuffs lie inside its end."""
    cu = cuff_pieces(fit, Cloth(LINEN_FIXED, "linen", wear=0.15, folds=0.0), None, ring_in=("f2", "w1"),
                     out=(0.010, 0.012) if under else (0.021, 0.025), name="cuff", grow=1.0 if under else 1.10)
    if not collar:
        return cu
    col = ck.Piece("collar", Cloth(LINEN_FIXED, "linen", wear=0.1, folds=0.0, extra=kw2._linen_white), scale=1.4)
    col.slot, col.slot_id = None, 0
    ck.neckerchief(fit, col, knot=False, ease=0.024)
    ck.thicken(col, 0.002, depth=0.012)
    return [col] + cu


def w_apron(fit, sk, bo, outer=None):
    Y = lambda f: bd.Y(fit.P, f)
    ap = mk("apron", "apron", cl(JEF["apron"], "linen", wear=0.3, mud=0.25, mud_h=0.16,
                                  extra=kw2._apron_extra(0.14), folds=1.0))
    gw.apron(fit, ap, ck.Onto([sk]), Y(0.600), Y(0.20), half=62.0, clear_add=0.010)
    ck.thicken(ap, 0.0022, depth=0.03)
    band = mk("apron_band", "apron", cl(JEF["apron"], "linen", wear=0.3, folds=0.2), scale=1.2)
    ck.band(fit, band, ck.Onto([outer or bo, sk], skip_zones=("arm",)), Y(0.612), 0.032, d=0.008, n=20, rows=2)
    ck.thicken(band, 0.0028, depth=None, crease=0.1)
    return [ap, band]


def w_shawl(fit, bo, sk, ap=None):
    """The check shawl of wife_a: a folded square over the shoulders, the point down the back, open in front, fringed."""
    pieces = []
    sw = mk("shawl", "coat", cl(MIE["coat"], "wool", wear=0.3, dust=0.05, folds=1.2, extra=_shawl_paint), scale=0.95)
    on_bodice = ck.Onto([bo])
    wts = kw2.shoulder_weights(on_bodice)
    ids = kw2._shawl_on(fit, sw, on_bodice, ends="hang", back=0.40, front_y=0.655, wfn=wts, lift0=0.013)
    ck.thicken(sw, 0.0028, depth=0.03, crease=0.06)
    pieces.append(sw)
    fr = mk("shawl_fringe", "coat", cl(MIE["coat"], "wool", wear=0.2, folds=0.0, extra=kw2._fringe_extra), scale=1.3)
    on_all = ck.Onto([bo, sw, sk] + ([ap] if ap else []))
    V = np.array(sw.V)
    R = ids.shape[0]
    mid = R // 2
    edge = [V[ids[r, -1]] for r in range(mid - 9, mid + 10)]
    gw.fringe(fit, fr, edge, on_all, length=0.06, lift=0.006, wfn=wts)
    for r in (0, R - 1):
        gw.fringe(fit, fr, [V[ids[r, c]] for c in range(ids.shape[1])], on_all, length=0.05, lift=0.006, wfn=wts)
    ck.thicken(fr, 0.0012, depth=None, crease=0.9)
    pieces.append(fr)
    return pieces


def w_jacket(fit, long=False, sk=None):
    """A fitted jacket (to the hips) or a redingote (to the knee) over the bodice: the men's open coat on the women's
    cut (the bodice's ease table, the bust cleared of the skin), its skirts hung outside the skirt below."""
    Y = lambda f: bd.Y(fit.P, f)
    ease = gw.ease_table(fit, torso={9: 0.016, 8: 0.016, 7: 0.020, 6: 0.020, 5: 0.020, 4: 0.020, 3: 0.034, 2: 0.040,
                                     1: 0.044, 0: 0.046}, neck=0.012,
                         arm=[0.013, 0.016, 0.018, 0.018, 0.018, 0.019, 0.020, 0.022, 0.024, 0.024, 0.022])

    def keep(i):
        part, ring, col = ck.info(fit, i)
        return not (part in ("torso", "neck") and col == 0)
    jk = mk("coat", "coat", cl(JEF["coat"], "wool", wear=0.4, dust=0.1, mud=0.1 if long else 0.0, extra=_coat_paint))
    vm, _ = ck.upper(fit, jk, rows=(0, 9), neck=0, sleeve="w1", ease=ease, keep=keep)
    gw.orient_by_cage(fit, jk, vm)
    gw.clear_body(fit, jk, vm, None, 0.008)
    loop = [vm[i] for i in fit.row(0)[1:] if i in vm]
    sf = SkirtFit(fit, sk) if sk is not None else fit
    hem = Y(0.31) if long else Y(0.465)
    heights = [Y(0.49), Y(0.40), hem] if long else [Y(0.49), hem]
    ck.hang(sf, jk, loop, heights, clear=0.02, flare=0.03, closed=False,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.4, spring=0.3 if long else 0.15,
                                         springs=("coat",)))
    r6 = fit.row(6)
    jk.meta.update(hem=hem, cuff=Y(0.499), edge_x=float(np.mean([abs(jk.V[vm[r6[k]]][0]) for k in (1, 15)])))
    ck.thicken(jk, 0.0032, depth=lambda p: 0.08 if p[2] > 0.05 else (0.08 if p[1] < fit.hip_y else 0.03))
    cc = mk("coat_collar", "coat", cl(JEF["coat"], "wool", wear=0.4, folds=0.3), scale=1.2)
    ck.collar(fit, cc, -0.35, 0.50, 0.030, 0.026, rows=3, front_gap=0.10, fold=(0.022, 0.034))
    ck.thicken(cc, 0.003, depth=None, crease=0.05)
    return [jk, cc]


def w_smock(fit, sk):
    """A loose linen smock over the bodice to the knee (the women's kiel: wide sleeves to the wrist)."""
    P = fit.P
    Y = lambda f: bd.Y(P, f)
    sf = SkirtFit(fit, sk)

    def ease(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":  # clear of the bodice's shoulders and of the skirt's gathered waistband
            c = min(col, 16 - col)
            e = 0.028 if ring >= 7 else 0.030 + 0.014 * (8 - ring) / 8
            return e + (0.006 if c >= 6 else 0.0) + (0.012 if ring <= 3 else 0.0)
        if part == "neck":
            return 0.024  # over the bodice's high neck: the smock's own neckline, no collar band
        k = ck.ARM_SEQ.index(ring)
        return [0.020, 0.022, 0.022, 0.023, 0.023, 0.023, 0.023, 0.022, 0.021, 0.019, 0.013][k]
    sm_ = mk("smock", "coat", cl(SMOCK_BLUE, "linen", wear=0.5, dust=0.15, extra=_smock_paint))
    vm, _ = ck.upper(fit, sm_, rows=(0, 9), neck=0, sleeve="w1", ease=ease)
    loop = ck.row_loop(fit, vm, 0)
    hem = Y(0.33)
    ck.hang(sf, sm_, loop, [Y(0.48), Y(0.41), hem], clear=0.015, flare=0.03,
            wfn=lambda p: ck.hang_weights(fit, p, front_legs=1.0, back_legs=0.5, spring=0.12), seam_at=8)
    sm_.meta.update(hem=hem, cuff=Y(0.499))
    ck.thicken(sm_, 0.0026, depth=lambda p: 0.07 if p[1] < fit.hip_y else 0.03)
    cuff = Y(0.499)
    sm_.relief = cd.compose(cd.hang_folds(Y(0.72), hem, n=5, depth=0.012, seed=3, zone=("torso", "skirt")),
                            cd.bunch(cuff + 0.05, cuff + 0.13, period=0.026, depth=0.0045, zone="arm"))
    return [sm_] + cuff_pieces(fit, sm_.cloth, "coat", ring_in=("f2", "w1"), out=(0.013, 0.015), name="smock_cuff")


def hide_skirt_under(sk, hem, front_gap=None):
    """The skirt under a jacket, coat or smock: its faces from 4 cm below the outer garment's hem up are cut away
    (they never show, and the bell of a gathered skirt came through the cloth at the hips); front_gap: half the width
    of the open front of a jacket or coat, where the skirt stays."""
    V = np.array(sk.V)

    def hidden(v):
        x, y, z = V[v]
        if y < hem + 0.04:
            return False
        return front_gap is None or z < 0.0 or abs(x) > front_gap
    sk.F = [f for f in sk.F if not all(hidden(v) for v in f)]


def women_dress(fit, cut):
    """plain, apron, shawl, shawl_apron (the old player's), jacket, jacket_apron, coat, smock."""
    pieces = []
    sk = w_skirt(fit)
    pieces.append(sk)
    bo = w_bodice(fit)
    pieces.append(bo)
    pieces += w_trim(fit, bo, collar=cut not in ("jacket", "jacket_apron", "coat", "smock"),
                     under=cut in ("jacket", "jacket_apron", "coat", "smock"))
    if cut in ("jacket", "jacket_apron", "coat"):
        jk = w_jacket(fit, long=cut == "coat", sk=sk)
        pieces += jk
        if cut == "jacket_apron":
            pieces += w_apron(fit, sk, bo, outer=jk[0])
        # Keep the apron backing continuous: cutting the hidden skirt first
        # also cut holes into the apron derived from its final surface.
        if cut != "jacket_apron":
            hide_skirt_under(sk, jk[0].meta["hem"], front_gap=0.13)
        return pieces
    ap = []
    if cut in ("apron", "shawl_apron"):
        ap = w_apron(fit, sk, bo)
        pieces += ap
    if cut in ("shawl", "shawl_apron"):
        pieces += w_shawl(fit, bo, sk, ap[0] if ap else None)
    if cut == "smock":
        sm_ = w_smock(fit, sk)
        pieces += sm_
        hide_skirt_under(sk, sm_[0].meta["hem"])
    return pieces
