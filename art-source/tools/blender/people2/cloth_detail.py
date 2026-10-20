"""The shared cloth-detail set (docs/people.md "Clothes: high detail"): what every kind's garments are finished with,
so all 51 kinds read alike in make and finish.

Geometry where a detail changes the silhouette:
- relief functions (a piece's `relief`, applied on the near copy after the subdivision, clothes_build.relief): folds
  of hanging cloth (hang_folds), bunching at cuffs, sleeves pushed up and trouser hems (bunch), a knee's or an
  elbow's bag (bulge), raised bands (band); compose() adds them;
- buttons(): real buttons on a garment (a domed disc on its surface, carried by its weights);
- fringe(): a woven shawl's fringe, tassel by tassel;
- klomp(): a carved willow clog with a leather top over the instep, closing round the ankle;
- shawl(): a square shawl folded on the diagonal, one sheet over the shoulders, its point down the back, the ends
  crossed over the breast;
Paint (the normal map and colour) otherwise: plaid() (a check woven on the cloth's own threads, fabric coordinates),
stitches(), nails(), knife facets and grain for wood (klomp_paint), leather creases.

Fabric coordinates: a piece may give each vertex its cloth's own 2D coordinates (pc.fabric, metres along the warp and
the weft); they ride through the subdivision and the reduction in a second UV layer and reach the painter as
ctx.fu, ctx.fv (a check that follows the cloth's threads, not the world's axes). A kind that has none paints by
position as before.
"""

import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from .clothes_kit import sm, norm


# ---------------------------------------------------------------- relief (geometry on the near copy)

def compose(*fns):
    """Several reliefs added (offsets along the outward direction, or displacement vectors)."""
    fns = [f for f in fns if f is not None]

    def f(ctx):
        out = np.zeros((len(ctx.pos), 3))
        for fn in fns:
            d = np.asarray(fn(ctx), np.float64)
            out += d if d.ndim == 2 else ctx.nrm * d[:, None]
        return out
    return f


def _mask(ctx, zone=None, inner=None, where=None):
    m = np.ones(len(ctx.pos), bool)
    if zone is not None:
        zs = (zone,) if isinstance(zone, str) else tuple(zone)
        m &= np.isin(np.asarray(ctx.zone).astype(str), zs)
    if where is not None:
        m &= where(ctx.pos)
    return m


def hang_folds(top, hem, n=9, depth=0.012, centre=None, seed=1, start=0.05, back=1.0, sharp=1.0, wander=1.2,
               zone=None, exclude=None):
    """Folds of hanging cloth: crests and valleys running down from `top` (game y) and deepening to `depth` at
    `hem`; `n` folds round the body (about the vertical axis through `centre` = (x, z)), spaced unevenly and wandering
    a little as they fall, so the hem waves. back: their depth behind against in front. exclude(pos): no folds."""
    rng = np.random.default_rng(seed)
    ph = rng.uniform(0, 2 * math.pi, 4)

    def f(ctx):
        p = ctx.pos
        cx, cz = centre if centre is not None else (0.0, 0.0)
        th = np.arctan2(p[:, 0] - cx, p[:, 2] - cz)
        t = np.clip((top - p[:, 1]) / max(top - hem, 1e-3), 0, 1.2)
        a = depth * sm(start, 1.0, t) ** 0.85 * (1.0 + (back - 1.0) * sm(0.3, -0.3, np.cos(th)))
        phase = (n * th + 0.9 * np.sin(2 * th + ph[0]) + 0.55 * np.sin(3 * th + ph[1])
                 + wander * t * np.sin(1.5 * th + ph[2]) + 0.35 * np.sin(5 * th + ph[3]))
        c = np.cos(phase)
        prof = np.sign(c) * np.abs(c) ** sharp
        m = _mask(ctx, zone)
        if exclude is not None:
            m &= ~exclude(p)
        # hanging folds move the cloth across, out from the axis: along a hem's normal (partly down) they would
        # lift and drop the hem into teeth
        d = np.stack((p[:, 0] - cx, np.zeros(len(p)), p[:, 2] - cz), 1)
        d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
        return d * (a * prof * m)[:, None]
    return f


def _limb_axis(fit, p, side_of, a_bone, b_bone):
    """The nearest point on the limb's axis (from joint a to joint b of the point's side) and the angle round it."""
    out_c = np.zeros_like(p)
    for S, sg in (("L", 1), ("R", -1)):
        m = side_of == sg
        if not m.any():
            continue
        a = np.asarray(fit.J[a_bone + S][0], np.float64)
        b = np.asarray(fit.J[b_bone + S][0], np.float64)
        d = b - a
        t = np.clip(((p[m] - a) @ d) / max(d @ d, 1e-9), -0.5, 1.5)
        out_c[m] = a + t[:, None] * d
    r = p - out_c
    th = np.arctan2(r[:, 0] * np.sign(p[:, 0] + 1e-9), r[:, 2])
    return out_c, th


def bunch(y0, y1, period=0.024, depth=0.003, zone="arm", limb=("armLow", "hand"), seed=2, slant=1.6):
    """Bunching: rings of soft folds where cloth is pushed together (a sleeve above its cuff, a sleeve pushed up, a
    trouser hem on the shoe), between heights y0 and y1, puffing outward; the rings slant and break round the limb so
    they read as folds, not hoops."""
    def f(ctx):
        p = ctx.pos
        m = _mask(ctx, zone)
        y = p[:, 1]
        w = sm(y0 - 0.004, y0 + 0.008, y) * sm(y1 + 0.004, y1 - 0.02, y)
        _, th = _limb_axis(ctx.fit, p, np.sign(p[:, 0]), limb[0], limb[1])
        ph = 2 * math.pi * (y - y0) / period + slant * np.sin(th + seed) + 0.8 * np.sin(2 * th + 2.1 * seed)
        return m * w * depth * (0.35 + 0.65 * (0.5 + 0.5 * np.cos(ph)))
    return f


def bulge(centre_fn, radius, amount, zone=None, front=None):
    """A soft bag (a knee, an elbow, a seat): amount (metres) at the centre, falling off over `radius`.
    centre_fn(fit) -> list of points; front: only where the outward normal faces this way (a vector)."""
    def f(ctx):
        out = np.zeros(len(ctx.pos))
        for c in centre_fn(ctx.fit):
            d = np.linalg.norm(ctx.pos - np.asarray(c), axis=1)
            out += amount * np.exp(-(d / radius) ** 2)
        if front is not None:
            out *= np.clip(ctx.nrm @ np.asarray(front, np.float64), 0, 1)
        return out * _mask(ctx, zone)
    return f


def band(y0, y1, h, zone=None, where=None):
    """A raised band between heights y0 and y1 (a cuff, a waistband), h metres proud, its edges rounded."""
    def f(ctx):
        y = ctx.pos[:, 1]
        return h * sm(y0 - 0.002, y0 + 0.004, y) * sm(y1 + 0.002, y1 - 0.004, y) * _mask(ctx, zone, where=where)
    return f


def creases(centre_fn, radius, n=5, depth=0.0025, zone=None, axis=(0, 1, 0)):
    """Radial creases fanning out from a point (the inside of an elbow, the back of a knee, a belt's pull)."""
    def f(ctx):
        out = np.zeros(len(ctx.pos))
        ax = np.asarray(axis, np.float64)
        for c in centre_fn(ctx.fit):
            r = ctx.pos - np.asarray(c)
            d = np.linalg.norm(r, axis=1)
            u = norm(np.cross(ctx.nrm, ax))
            ang = np.arctan2((r * u).sum(1), r @ ax)
            out += depth * np.exp(-(d / radius) ** 2) * np.cos(n * ang)
        return out * _mask(ctx, zone)
    return f


# ---------------------------------------------------------------- buttons, fringes


def buttons(name, cloth, onto, centres, r=0.0075, h=0.0035, n=8, scale=1.6, lift=0.0006):
    """Real buttons: each a low domed disc standing on the garment's surface (onto: ck.Onto of the pieces under
    them) at a point near each centre, weighted as the cloth under it. Returns the piece."""
    pc = ck.Piece(name, cloth, scale=scale)
    for c in centres:
        loc, nrm = onto.find(np.asarray(c, np.float64))
        w = onto.weights(loc)
        t = norm(np.cross(nrm, (0.0, 1.0, 0.0)) if abs(nrm[1]) < 0.9 else np.cross(nrm, (1.0, 0.0, 0.0)))
        b = np.cross(nrm, t)
        base = loc + nrm * lift
        rings = [(r * 1.0, -0.0008), (r * 1.0, h * 0.5), (r * 0.78, h * 0.92), (r * 0.42, h * 1.06)]
        ids = []
        for rr, hh in rings:
            row = []
            for j in range(n):
                a = 2 * math.pi * j / n
                row.append(pc.add(base + (t * math.cos(a) + b * math.sin(a)) * rr + nrm * hh, w))
            ids.append(row)
        ids = np.array(ids)
        pc.grid_faces(ids, closed=True)
        cv = pc.add(base + nrm * h * 1.1, w)
        for j in range(n):
            pc.face((ids[-1, j], ids[-1, (j + 1) % n], cv))
        pc.seam(ids[0, 0], ids[1, 0])
        pc.seam(ids[1, 0], ids[2, 0])
        pc.seam(ids[2, 0], ids[3, 0])
        pc.seam(ids[3, 0], cv)
        k0 = len(pc.F) - n - n * 3
        pc.orient(lambda q, base=base, nrm=nrm: (q - base) - nrm * 0.3 * float(np.dot(q - base, nrm)), start=k0)
    return pc


def fringe(pc, edge, out, down, wts, length=0.05, spacing=0.02, width=0.006, segs=3, seed=4):
    """A fringe along a woven edge: tassels of twisted threads, each a three-sided strand tapering to its end,
    hanging from the edge (points `edge`, the cloth's outward normal `out` and the hanging direction `down` at each,
    weights `wts`). Adds to pc; returns the number of tassels."""
    edge = np.asarray(edge, np.float64)
    L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(edge, axis=0), axis=1))])
    rng = np.random.default_rng(seed)
    count = 0
    for s in np.arange(spacing * 0.5, L[-1], spacing):
        k = int(np.searchsorted(L, s) - 1)
        k = max(0, min(k, len(edge) - 2))
        f = (s - L[k]) / max(L[k + 1] - L[k], 1e-9)
        p = edge[k] * (1 - f) + edge[k + 1] * f
        o = norm(np.asarray(out[k]) * (1 - f) + np.asarray(out[k + 1]) * f)
        d = norm(np.asarray(down[k]) * (1 - f) + np.asarray(down[k + 1]) * f)
        w = wts[k] if f < 0.5 else wts[k + 1]
        side = norm(np.cross(d, o))
        ln = length * rng.uniform(0.85, 1.15)
        tw = rng.uniform(0, 2 * math.pi)
        rows = []
        for j in range(segs + 1):
            t = j / segs
            c = p + d * ln * t + o * (0.002 + 0.006 * t * t) + side * 0.002 * math.sin(3 * t + tw)
            rad = width * 0.5 * (1.0 - 0.75 * t)
            row = []
            for q in range(3):
                a = tw + 2 * math.pi * q / 3 + 1.2 * t
                row.append(pc.add(c + (side * math.cos(a) + o * math.sin(a)) * rad, w))
            rows.append(row)
        ids = np.array(rows)
        nf = len(pc.F)
        pc.grid_faces(ids, closed=True)
        tip = pc.add(p + d * ln * 1.06 + o * 0.009, w)
        for q in range(3):
            pc.face((ids[-1, q], ids[-1, (q + 1) % 3], tip))
        for j in range(segs):
            pc.seam(ids[j, 0], ids[j + 1, 0])
        pc.seam(ids[-1, 0], tip)
        axis_pts = [p + d * ln * (j / segs) for j in range(segs + 1)]
        pc.orient(lambda q, ap=axis_pts: q - min(ap, key=lambda a: float(np.sum((a - q) ** 2))), start=nf)
        count += 1
    return count


# ---------------------------------------------------------------- the clog (klomp) with a leather top

# the wood, round the reference man's foot (scaled by the foot): z from the ankle's line forward, half width, the
# sole's height (rising into the heel's round and the toe's spring), the rim's height (the heel cup high, the sides
# low over the instep where the leather comes out, the toe box over the toes, the point)
KLOMP = [(-0.074, 0.020, 0.020, 0.062), (-0.066, 0.034, 0.005, 0.082), (-0.046, 0.043, 0.000, 0.080),
         (-0.018, 0.046, 0.000, 0.070), (0.020, 0.048, 0.000, 0.060), (0.062, 0.052, 0.000, 0.056),
         (0.104, 0.055, 0.000, 0.058), (0.140, 0.055, 0.002, 0.064), (0.172, 0.051, 0.006, 0.068),
         (0.202, 0.043, 0.013, 0.066), (0.226, 0.031, 0.024, 0.063), (0.243, 0.018, 0.036, 0.060),
         (0.252, 0.007, 0.045, 0.057)]
FOOT_RINGS = ("t1", "t2", "heel", "f1", "f2", "f3", "toe")


def klomp(fit, wood, leather, side, length=1.0, collar="t1", ease=0.0035):
    """A carved willow clog: the wood (sole, heel cup, the toe box drawn out to a blunt upturned point, its top a
    rounded ledge round the foot) and a leather top made on the foot's own cage (from the toes over the instep to a
    collar round the ankle at the leg ring `collar`, snug over the sock: no gap at the ankle); the leather inside the
    wood is deleted with the hidden layers. Returns (wood piece, leather piece) for the given side."""
    P = fit.P
    s = P["w"] * P["f"]["foot"]
    sg = 1 if side == "L" else -1
    cx = sg * (fit.hip_x - 0.003 * s)
    st = [(z * s * length, hw * s, yb, yt, 0.0) for z, hw, yb, yt in KLOMP]

    def w(p):
        t = float(sm(0.15 * s, 0.25 * s, p[2])) * 0.5
        return ck.wnorm({"foot" + side: 1 - t, "toe" + side: t})
    wd = ck.Piece("klomp" + side, wood, scale=1.25)
    ids = ck.loft_z(wd, st, 16, w, cx=cx, power=3.4, power_bottom=9.0, crease_cols=(), crease=0.0)
    wd.orient(lambda c: np.array((c[0] - cx, c[1] - 0.035, c[2] - 0.09 * s)))
    wd.meta.update(cx=cx, s=s)
    # the leather top: the foot's cage from the toes to the collar, 3.5 mm out
    lt = ck.Piece("klomp_top" + side, leather, scale=1.25)
    seq = ck.LEG_SEQ
    keep = set(seq[seq.index(collar):])

    def allow(i):
        part, tg = fit.C.part[i], fit.C.tag[i]
        return part == "leg" + side and tg.get("ring") in keep
    ck.from_cage(fit, lt, allow, lambda i: ease)
    ck.thicken(lt, 0.0022, depth=0.018, crease=0.06)
    lt.meta.update(cx=cx, s=s, collar_y=float(np.mean([fit.rest[i][1] for i in range(len(fit.C.part))
                                                       if fit.C.part[i] == "leg" + side and
                                                       fit.C.tag[i].get("ring") == collar])))
    return wd, lt


def klomp_paint(ctx):
    """Worn dark willow: the grain running along the clog, the knife's facets of the carving, the ledge's edge
    polished pale by wear, darkened with use and wet toward the sole, a scuffed toe."""
    m = ctx.piece.meta
    x, y, z = ctx.x, ctx.y, ctx.z
    s = m.get("s", 1.0)
    lx = (x - m.get("cx", 0.0)) / s
    zz = z / s
    g = np.sin(lx * 520 + y * 300 + 2.2 * np.sin(zz * 34)) * 0.5 + 0.5
    g2 = ck._noise3(ctx.pos * np.array((3.0, 3.0, 0.4)), 260.0, 31)
    ctx.mul(g, 0.94)
    ctx.mul(np.clip(g2 * 0.5 + 0.5, 0, 1), 0.93)
    ctx.bump(g, 0.00003)
    # knife facets: shallow flats along the clog, in bands round it
    ang = np.arctan2(y - 0.03, lx)
    facet = np.abs(((ang * 7 + zz * 9 + 0.6 * np.sin(zz * 20)) % 1.0) - 0.5)
    ctx.bump(facet, 0.00025)
    ctx.mul(sm(0.25, 0.5, facet), 0.97)
    # darker with wear toward the sole, wet and earth on the sole and the toe
    ctx.mul(sm(0.03, 0.0, y), 0.70)
    toe = sm(0.19, 0.25, zz)
    ctx.mix(toe * 0.35, (0.12, 0.10, 0.08))
    # the ledge's rounded edge rubbed paler, the inside of the ledge darker
    up = np.clip(ctx.nrm[:, 1], 0, 1)
    ctx.mix(up * sm(0.03, 0.05, y) * 0.22, (0.52, 0.40, 0.26))


def klomp_top_paint(ctx):
    """The leather top: worn brown leather, creased over the instep where the foot bends, a row of nail heads where
    it is nailed to the wood's ledge, a stitched seam up the back and the collar's edge."""
    m = ctx.piece.meta
    x, y, z = ctx.x, ctx.y, ctx.z
    s = m.get("s", 1.0)
    zz = z / s
    # creases across the instep
    cr = np.sin(zz * 2 * math.pi / 0.011 + 3.0 * ck._noise3(ctx.pos, 40.0, 5)) * sm(0.02, 0.06, zz) * sm(0.13, 0.08, zz)
    ctx.bump(cr * (y > 0.04), -0.00025)
    ctx.mul(np.clip(cr, 0, 1) * 0.6, 0.85)
    # nail heads along the ledge (just over the wood's rim)
    lx = x - m.get("cx", 0.0)
    ang = np.arctan2(lx, z + 0.02)
    near_rim = sm(0.075, 0.045, y)
    nail = (np.cos(ang * 46) > 0.86) * near_rim * sm(0.0, 0.01, y - 0.044) * sm(0.014, 0.004, y - 0.044)
    ctx.mix(nail * 0.8, (0.20, 0.19, 0.18))
    ctx.bump(nail, 0.0004)
    # the back seam and the collar's stitched edge
    back = (z < 0) & (np.abs(lx) < 0.004)
    ck.seam_line(ctx, np.where(z < 0, np.abs(lx), 1.0), width=0.0010)
    cy = m.get("collar_y", 0.13)
    ck.seam_line(ctx, np.where(~ctx.inner, y - (cy - 0.008), 1.0), width=0.0008)
    ctx.mix(sm(cy - 0.012, cy, y) * 0.25, (0.08, 0.06, 0.05))
    del back


# ---------------------------------------------------------------- the shawl


def shawl(fit, pc, onto, path, widths, lift, rows=7, step=0.01, flip=None, samples=None):
    """A shawl as one sheet: its folded edge along `path` (points near the body, from one end over the shoulders to
    the other), the cloth falling from that edge over the surface `onto` (the bodice) for `widths` metres (one per
    path point: narrow ends, the point down the back), `lift` metres out (one per path point: the end that crosses
    over the other lies higher). Each row is walked down the surface from the edge, a step at a time, so the cloth
    lies on the body. Gives pc.fabric (metres along the edge and down from it). Returns ids (len(path), rows)."""
    path = np.asarray(path, np.float64)
    widths = np.asarray(widths, np.float64)
    lift = np.broadcast_to(np.asarray(lift, np.float64), (len(path),)).copy()
    L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    if samples:
        # a smooth path of even steps (a spline through the points: the edge does not kink at them)
        t = np.linspace(0, L[-1], samples)
        k = np.clip(np.searchsorted(L, t, side="right") - 1, 0, len(L) - 2)
        f = (t - L[k]) / np.maximum(L[k + 1] - L[k], 1e-9)
        P0, P1 = path[np.maximum(k - 1, 0)], path[k]
        P2, P3 = path[k + 1], path[np.minimum(k + 2, len(path) - 1)]
        f2, f3 = f * f, f * f * f
        path = 0.5 * ((2 * P1) + (-P0 + P2) * f[:, None] + (2 * P0 - 5 * P1 + 4 * P2 - P3) * f2[:, None]
                      + (-P0 + 3 * P1 - 3 * P2 + P3) * f3[:, None])
        widths = np.interp(t, L, widths)
        lift = np.interp(t, L, lift)
        L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    m = len(path)
    pts = np.zeros((m, rows, 3))
    fab = np.zeros((m, rows, 2))
    for k in range(m):
        t = path[min(k + 1, m - 1)] - path[max(k - 1, 0)]
        t = t / np.linalg.norm(t)
        q, n = onto.find(path[k])
        # down the surface, across the edge: away from the neck
        d = np.cross(n, t)
        if d[1] > 0 or (abs(d[1]) < 0.2 and np.dot(d, q - np.array((0.0, q[1], 0.0))) < 0):
            d = -d
        if flip is not None and flip(k):
            d = -d
        cur = q
        travelled = 0.0
        for r in range(rows):
            target = widths[k] * r / (rows - 1)
            while travelled < target - 1e-9:
                st_ = min(step, target - travelled)
                nq = cur + d * st_
                nq, nn = onto.find(nq)
                # keep the walk going the same way along the surface
                d = norm(d - nn * np.dot(d, nn))
                cur = nq
                travelled += st_
            _, nn = onto.find(cur)
            pts[k, r] = cur + nn * lift[k] * (1.0 + 0.15 * r / (rows - 1))
            fab[k, r] = (L[k], travelled)
    ids = pc.grid(pts, lambda p: onto.weights(p))
    pc.fabric = getattr(pc, "fabric", None) or {}
    for k in range(m):
        for r in range(rows):
            pc.fabric[int(ids[k, r])] = tuple(fab[k, r])
    pc.orient(lambda q: onto.snap(q, 0.05) - onto.snap(q, 0.0))
    return ids


def plaid(ctx, sett, base, thread=0.0012, twill=0.00008):
    """A check woven on the cloth's own threads (ctx.fu, ctx.fv: metres along the warp and the weft): `sett` is the
    stripe order [(colour, width in metres), ...] repeated both ways; where a warp stripe crosses a weft stripe the
    two colours mix as woven threads do; a 2/2 twill's diagonal ribs in the height."""
    fu, fv = ctx.fu, ctx.fv
    cols = np.array([c for c, _ in sett], np.float32)
    wid = np.array([w for _, w in sett])
    edges = np.concatenate([[0.0], np.cumsum(wid)])
    rep = edges[-1]

    def stripe(t):
        t = np.mod(t, rep)
        k = np.clip(np.searchsorted(edges, t, side="right") - 1, 0, len(wid) - 1)
        return k
    ku, kv = stripe(fu), stripe(fv)
    cu, cv = cols[ku], cols[kv]
    # the threads: warp over weft in a 2/2 twill (diagonal), so each texel shows mostly one or the other
    tw = np.mod(np.floor(fu / thread) + np.floor(fv / thread), 4)
    warp_up = (tw < 2).astype(np.float32)
    mixc = cu * (0.35 + 0.3 * warp_up[:, None]) + cv * (0.65 - 0.3 * warp_up[:, None])
    # A woven shawl has the same yarn on both faces, including its turned edge.
    # It has no separately dyed plain lining.
    ctx.rgb[:] = mixc * (np.asarray(base, np.float32) / np.maximum(np.asarray(base, np.float32), 1e-3))
    ctx.bump(np.cos((fu + fv) * 2 * math.pi / (thread * 4)), twill)
