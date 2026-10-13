"""Garments for the women's kinds of package C2 (kinds_women2.py; docs/people.md "Kinds and clothes").

Built on clothes_kit (Piece, thicken, upper, hang, Onto, band, collar, hood_cap, clogs): only what the kit does not
make is here, so the kit's owners can take any of it over.

- bodice ease tables and a basque (the short skirt of a jacket bodice, hung from its bottom row);
- skirt(): a full skirt with its rings where they are needed (waist, hips, then the fall), the bustle of 1873
  (a pad behind, the fall pushed out over it), and weights that let it sit: below the knee the cloth follows the
  shin, so a seated skirt falls from the knees instead of standing out like a plate;
- drape(): a cloth hung on another cloth column by column, each column to its own length (an overskirt, a polonaise
  looped up at the back, a pinafore);
- apron() with a bib, a waistband and a bow with tails;
- shawl(): one cloth round the neck and shoulders (the point down the back, the ends crossed, hanging or tied), its
  lift growing toward the outside so the ends lie over each other; fringe(): a fringe hanging from a shawl's edge,
  a row of tassels whose tips are creased so they stay tassels after the subdivision;
- pelerine(): a cape collar laid round the neck over the shoulders (a nun's white bib, a beguine's collar, small
  turn-down collars), walked down the garment under it;
- head pieces: kerchief() (a headscarf tied under the chin or at the nape), ties() (cap strings to a knot under the
  chin), lappets(), coif() and veil() (a nun's), hood_mantle() (the beguine's falie: hood and long mantle in one),
  small_hat() (a lady's hat of 1873 perched forward over the chignon);
- boots_light(): ankle boots on a lighter last than the kit's shoe (a long skirt hides all but the toes).

Coordinates as the kit: game space at rest, metres, x the wearer's left, y up, z forward.
"""

import math

import numpy as np

from . import body as bd
from . import clothes_kit as ck
from .clothes_kit import norm, sm, wnorm

HEAD = {"head": 1.0}


def find_out(onto, p):
    """The nearest point of `onto` and its normal turned outward (away from the body's upright axis): a few faces
    of a garment made from the cage face inward at the breast, and a band laid on them sank under the garment."""
    loc, n = onto.find(p)
    ref = np.array((0.0, loc[1], -0.01))
    if np.dot(n, loc - ref) < 0:
        n = -n
    return loc, n


def from_outside(onto, p, reach=0.25):
    """The surface point of `onto` seen from outside the body in the direction of p (from its upright axis): a
    point inside the body would otherwise find the nearest surface on the wrong side (a sleeve's inside)."""
    p = np.asarray(p, np.float64)
    r = np.array((p[0], 0.0, p[2] + 0.01))
    o = p + norm(r) * reach + np.array((0.0, 0.0, 0.0))
    loc, n = onto.find(o)
    for _ in range(3):
        loc, n = onto.find(loc + (p - loc) * 0.0 + norm(r) * 0.01)
    return loc


def snap_out(onto, p, d):
    loc, n = find_out(onto, np.asarray(p, np.float64))
    return loc + n * d


def Yf(fit, f):
    return bd.Y(fit.P, f)


# ---------------------------------------------------------------- bodices

MEDIAL = {"d1": 1.0, "d2": 1.0, "a2": 1.0, "a3": 1.0, "a4": 0.9, "e1": 0.6, "e2": 0.4, "e3": 0.2}


def ease_table(fit, torso=None, neck=0.007, arm=None, medial=0.014):
    """An ease function for ck.upper from a table: torso {row: metres} (rows 2..9), the neck, the arm rings in
    ck.ARM_SEQ order (a shorter list repeats its last value). medial: more ease on the upper arm's inner side (the
    side that faces the trunk): MakeHuman's arm is fuller there than the cage the sleeve is made from, and its skin
    stood outside the sleeve under the armpit."""
    t = {9: 0.008, 8: 0.008, 7: 0.010, 6: 0.010, 5: 0.010, 4: 0.010, 3: 0.024, 2: 0.030, 1: 0.034, 0: 0.036}
    t.update(torso or {})
    arm = list(arm or [0.008, 0.010, 0.012, 0.012, 0.012, 0.013, 0.014, 0.015, 0.016, 0.016, 0.014])

    def e(i):
        part, ring, col = ck.info(fit, i)
        if part == "torso":
            return t[ring]
        if part == "neck":
            return neck
        k = ck.ARM_SEQ.index(ring)
        base = arm[min(k, len(arm) - 1)]
        x = fit.rest[i][0]
        inward = -float(fit.N[i][0]) * (1.0 if x > 0 else -1.0)
        return base + medial * MEDIAL.get(ring, 0.0) * float(sm(0.0, 0.7, inward))
    return e


def bodice(fit, cloth, ease, name="bodice", sleeve="w1", rows=(2, 9), neck=0, open_front=None, keep=None,
           scale=1.0, min_clear=0.006, snap_arms=False):
    """A fitted bodice (the jak, a dress's body, a habit's): the body's cage pushed out, sleeves to `sleeve`."""
    pc = ck.Piece(name, cloth, scale=scale)
    vm, dup = ck.upper(fit, pc, rows=rows, neck=neck, sleeve=sleeve, ease=ease, open_front=open_front, keep=keep)
    pc.meta["vm"], pc.meta["dup"], pc.meta["rows"] = vm, dup, rows
    if snap_arms:
        snap_sleeves(fit, pc, vm, ease)
    orient_by_cage(fit, pc, vm, dup)
    pc.meta["pushed"] = clear_body(fit, pc, vm, dup, min_clear) if min_clear else 0
    return pc


def clear_body(fit, pc, vm, dup=None, min_clear=0.006, reach=0.07):
    """Push a cage-made garment out of MakeHuman's skin: the cage the garment is made from is fitted to the body
    within 1-15 mm, and the upper arm's front and inner side and the breast stood up to 3 cm outside a sleeve or
    bodice made with an ease of 1 cm. Each garment point looks back along its cage normal; where the skin is less
    than min_clear under it (or over it) the point moves out to min_clear over the skin."""
    from mathutils import Vector
    pairs = list(vm.items()) + list((dup or {}).items())
    moved = 0
    for c, v in pairs:
        n = fit.N[c]
        p = np.asarray(pc.V[v], np.float64)
        o = p + n * 0.03
        loc, nrm, fi, dist = fit.bvh.ray_cast(Vector(o), Vector(-n), reach)
        if loc is None:
            continue
        h = np.array(loc)
        # the skin's height over the garment point along n (positive: the skin is outside the cloth); a hit that
        # faces away from the ray is the far side of something (the trunk beside an arm): not this point's skin
        over = float(np.dot(h - p, n))
        if np.dot(np.array(nrm), n) <= 0.2 or over > 0.028:
            continue
        if over > -min_clear:
            pc.V[v] = p + n * (over + min_clear)
            moved += 1
    return moved


def snap_sleeves(fit, pc, vm, ease):
    """Lay a sleeve round MakeHuman's own arm: each ring of the sleeve is rebuilt round the arm's middle there, its
    columns at even angles, each laid on the arm's skin (a ray out from the middle) and out by its ease. The stooped
    old woman's cage arms are flattened (an ellipse 5 cm by 1.5 cm) and her sleeves came out as flat planks."""
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    tris = [t for t in fit.tris if all(fit.Spart[i].startswith("arm") for i in t)]
    for side in "LR":
        tt = [t for t in tris if fit.Spart[t[0]].endswith(side)]
        if not tt:
            continue
        tree = BVHTree.FromPolygons([tuple(p) for p in fit.S], [tuple(t) for t in tt])
        rings = {}
        for c, v in vm.items():
            part, tg = fit.C.part[c], fit.C.tag[c]
            if part == "arm" + side and "ring" in tg and "col" in tg:
                rings.setdefault(tg["ring"], []).append((tg["col"], c, v))
        order = [r for r in ck.ARM_SEQ if r in rings]
        cents = {r: np.mean([fit.rest[c] for _, c, _ in rings[r]], axis=0) for r in order}
        for k, r in enumerate(order):
            a = cents[order[max(k - 1, 0)]]
            b = cents[order[min(k + 1, len(order) - 1)]]
            ax = gw_norm(b - a) if np.linalg.norm(b - a) > 1e-6 else np.array((0.0, -1.0, 0.0))
            cen = cents[r]
            # the arm's own middle at this height: mean of the arm skin points near the ring's plane
            m = (np.abs((fit.S - cen) @ ax) < 0.012) & np.char.startswith(fit.Spart.astype(str), "arm" + side) &                 (np.linalg.norm(fit.S - cen, axis=1) < 0.09)
            if m.sum() >= 6:
                cen = fit.S[m].mean(0)
            u = gw_norm(np.cross(ax, np.array((0.0, 0.0, 1.0))))
            w = np.cross(ax, u)
            cols = sorted(rings[r])
            n = len(cols)
            # keep the columns' order and their first one's direction
            d0 = fit.rest[cols[0][1]] - cents[r]
            ph0 = math.atan2(float(np.dot(d0, w)), float(np.dot(d0, u)))
            d1 = fit.rest[cols[1][1]] - cents[r]
            ph1 = math.atan2(float(np.dot(d1, w)), float(np.dot(d1, u)))
            sgn = 1.0 if ((ph1 - ph0 + math.pi) % (2 * math.pi) - math.pi) >= 0 else -1.0
            ds, rs = [], []
            for j in range(n):
                ph = ph0 + sgn * 2 * math.pi * j / n
                d = u * math.cos(ph) + w * math.sin(ph)
                loc, nrm, _, dist = tree.ray_cast(Vector(cen), Vector(d), 0.12)
                ds.append(d)
                rs.append(dist if loc is not None else np.nan)
            rs = np.array(rs, np.float64)
            med = float(np.nanmedian(rs)) if np.isfinite(rs).any() else 0.04
            rs = np.where(np.isfinite(rs), np.clip(rs, 0.7 * med, 1.3 * med), med)
            # a little smoothing round the ring
            rs = 0.5 * rs + 0.25 * (np.roll(rs, 1) + np.roll(rs, -1))
            k_ = {"d1": 0.0, "d2": 0.15, "a2": 0.6}.get(r, 1.0)
            for j, (col, c, v) in enumerate(cols):
                pc.V[v] = (1 - k_) * np.asarray(pc.V[v]) + k_ * (cen + ds[j] * (rs[j] + ease(c) + 0.004))


def gw_norm(v):
    v = np.asarray(v, np.float64)
    return v / max(np.linalg.norm(v), 1e-12)


def orient_by_cage(fit, pc, vm, dup=None):
    """Turn every face of a garment made from the cage so it faces the way the body's cage faces there (the sum of
    its corners' cage normals). ck.from_cage orients by the nearest piece vertices, and at the breast some faces
    came out turned in: thicken() then laid their facing outside the garment, over a shawl laid on it."""
    inv = {v: c for c, v in vm.items()}
    for c, v in (dup or {}).items():
        inv[v] = c
    V = np.array(pc.V)
    flipped = 0
    for k, f in enumerate(pc.F):
        cs = [inv.get(v) for v in f]
        if any(c is None for c in cs):
            continue
        p = V[list(f)]
        n = np.zeros(3)
        for j in range(len(f)):
            n += np.cross(p[j], p[(j + 1) % len(f)])
        if np.dot(n, sum(fit.N[c] for c in cs)) < 0:
            pc.F[k] = tuple(reversed(f))
            flipped += 1
    pc.meta["flipped"] = flipped


def basque(fit, pc, drop, flare=0.10, clear=0.020, back_extra=0.0, rows=2, spring=0.2):
    """The short skirt of a jacket bodice, hung from its bottom row over the skirt below: `drop` metres in front,
    `drop + back_extra` behind (a riding basque), weighted to the hips and a little to the thighs."""
    loop = ck.row_loop(fit, pc.meta["vm"], pc.meta["rows"][0], pc.meta["dup"])
    V = np.array(pc.V)
    y0 = float(V[loop][:, 1].mean())
    hs = [y0 - drop * (k + 1) / rows for k in range(rows)]
    closed = not pc.meta["dup"]

    def push(j, p, d):
        q = np.array(p, np.float64)
        if back_extra:
            ang = math.atan2(q[0], q[2])
            q[1] -= back_extra * (d / drop) * float(sm(60.0, 170.0, abs(math.degrees(ang))))
        return q
    ids = ck.hang(fit, pc, loop, hs, clear=clear, flare=flare, closed=closed, push=push,
                  wfn=lambda p: ck.hang_weights(fit, p, front_legs=0.6, back_legs=0.3, spring=spring))
    return ids


# ---------------------------------------------------------------- skirts

def skirt_weights(fit, p, back_legs=0.55, spring=0.2, shin=0.9):
    """Hanging cloth of a long skirt: ck.hang_weights, but from just above the knee down the cloth follows the shin
    more (`shin`): seated, the skirt falls from the knees down the shins (no plate standing out), standing and
    walking it is the same as before."""
    x, y, z = p
    w = ck.hang_weights(fit, p, front_legs=1.0, back_legs=back_legs, spring=spring, knee_share=0.0)
    k = float(sm(fit.knee_y + 0.10, fit.knee_y - 0.12, y)) * shin
    out = {}
    for b, v in w.items():
        if b.startswith("legUp"):
            out[b] = out.get(b, 0.0) + v * (1 - k)
            lb = "legLow" + b[-1]
            out[lb] = out.get(lb, 0.0) + v * k
        else:
            out[b] = out.get(b, 0.0) + v
    return wnorm(out)


def skirt(fit, pc, hem_y, n=24, ease=0.012, top_row=3, hip_rows=(2, 1), drops=None, clear=0.045, flare=0.20,
          folds=8, fold_depth=0.020, spring=0.2, back_legs=0.55, shin=0.9, bustle=None, train=0.0, slim_front=0.5):
    """A full skirt, its own tube: the waistband at cage row top_row, close over the hips, then falling free to the
    hem (rings at the fractions `drops` of the fall), flaring, with `folds` real folds deepening toward the hem.
    bustle=(depth, y_top, y_peak, y_end): the pad of 1873 behind (metres out at the peak, heights), the fall pushed
    out over it and its folds stronger behind; train: the back of the hem this much longer (metres, lying on the
    ground). Returns ids (rings, n)."""
    rings = [ck.ring_at(fit, top_row, ease, n)]
    for r in hip_rows:
        rings.append(ck.ring_at(fit, r, ease + 0.006, n))
    loop_ids = []
    for k, R in enumerate(rings):
        ids = [pc.add(p, fit.near_w(p, ("torso",)) if k == 0 else
                      ck.hang_weights(fit, p, spring=spring * 0.3, back_legs=back_legs), zone="skirt") for p in R]
        loop_ids.append(ids)
    pc.grid_faces(np.array(loop_ids), closed=True)
    y_top = rings[-1][:, 1].mean()
    drops = drops or (0.25, 0.5, 0.75, 1.0)
    hs = [y_top + (hem_y - y_top) * f for f in drops]

    def fold(j, depth):
        a = min(1.0, max(0.0, depth / max(y_top - hem_y, 1e-3)))
        ph = 0.6 * math.sin(j * 1.7)
        return fold_depth * a ** 1.2 * math.cos(2 * math.pi * folds * j / n + ph)

    c0 = np.array((0.0, 0.0, float(np.mean([pc.V[v][2] for v in loop_ids[-1]]))))

    def push(j, p, d):
        q = np.array(p, np.float64)
        ang = math.atan2(q[0], q[2])
        behind = max(0.0, -math.cos(ang))
        front = max(0.0, math.cos(ang)) ** 2
        if slim_front > 0 and front > 0:
            # the 1870s cut: flat in front, the fullness at the sides and behind (and a front that falls from the
            # knees when she sits instead of standing out in a bell)
            dr = np.array((q[0] - c0[0], 0.0, q[2] - c0[2]))
            r = float(np.linalg.norm(dr))
            dirn = dr / max(r, 1e-9)
            need = float(fit.support(c0, dirn[None], q[1] - 0.05, q[1] + 0.05, ("leg", "torso"))[0]) + clear
            if r > need:
                rr = need + (r - need) * (1.0 - slim_front * front)
                q[0], q[2] = c0[0] + dirn[0] * rr, c0[2] + dirn[2] * rr
        if bustle is not None:
            depth, yt, yp, ye = bustle
            y = q[1]
            if y > yp:
                b = float(sm(yt, yp, y))
            else:
                b = 1.0 - 0.55 * float(sm(yp, ye, y))
            r = math.hypot(q[0], q[2] - 0.0)
            out = depth * b * behind ** 1.6
            if r > 1e-6:
                q[0] += q[0] / r * out * 0.25
                q[2] -= out
        if train and q[1] < hem_y + 0.02:
            q[2] -= train * behind ** 2
            q[1] = max(0.004, q[1] - 0.01 * behind)
        return q
    ids = ck.hang(fit, pc, loop_ids[-1], hs, clear=clear, flare=flare, folds=fold if folds else None,
                  wfn=lambda p: skirt_weights(fit, p, back_legs=back_legs, spring=spring, shin=shin), seam_at=n // 2,
                  push=push)
    for i in range(len(loop_ids) - 1):
        pc.seam(loop_ids[i][n // 2], loop_ids[i + 1][n // 2])
    pc.orient(lambda q: q - np.array((0.0, q[1], 0.0)))
    # the bustle also lifts the hips' rings behind (the pad sits under the waist at the back)
    if bustle is not None:
        depth, yt, yp, ye = bustle
        for ring in loop_ids[1:]:
            for v in ring:
                q = pc.V[v]
                ang = math.atan2(q[0], q[2])
                behind = max(0.0, -math.cos(ang))
                b = float(sm(yt, yp, q[1]))
                pc.V[v] = q + np.array((0.0, 0.0, -depth * b * behind ** 1.6))
    pc.meta.update(hem=hem_y, band=rings[0][:, 1].mean() - 0.02)
    return np.vstack([np.array(loop_ids), ids[1:]])


def flounce(fit, pc, on_skirt, y_top, y_bot, n=48, lift=0.006, pleats=24, depth=0.010, train=0.0):
    """A pleated flounce round the hem of a skirt (a lady's underskirt): a band laid on the skirt from y_top down to
    y_bot (a little below the skirt's own hem), its lower edge pleated in and out."""
    rows = []
    for k, y in enumerate((y_top, 0.5 * (y_top + y_bot), y_bot)):
        row = []
        for j in range(n):
            t = 2 * math.pi * j / n
            p = np.array((math.sin(t) * 0.6, y, math.cos(t) * 0.6))
            q = snap_out(on_skirt, p, 0.0)
            for _ in range(3):
                q = snap_out(on_skirt, np.array((q[0], y, q[2])), 0.0)
            nrm = find_out(on_skirt, q)[1]
            pl = depth * (k / 2) * math.cos(2 * math.pi * pleats * j / n)
            behind = max(0.0, -math.cos(t))
            q = q + nrm * (lift + pl + 0.006 * k)
            if train and k == 2:
                q[2] -= train * behind ** 2 * 0.2
            q[1] = max(q[1], 0.004)
            row.append(q)
        rows.append(row)
    ids = pc.grid(np.array(rows), on_skirt.weights, closed=True, seam_col=n // 2)
    pc.orient(lambda q: q - np.array((0.0, q[1], 0.0)))
    return ids


def drape(fit, pc, onto, angles, top_y, hem, rows=5, clear=0.012, clear_hem=0.03, folds=None, wfn=None,
          loops=None, lift_fn=None):
    """A cloth hung on another, column by column: at each angle round the body (radians, 0 in front, + to the
    left) from top_y (a number or a function of the angle) down to hem(angle) (game y), laid `clear` over `onto`
    at the top growing to `clear_hem` at the hem; folds(j, t) adds metres out at column j, t from 0 (top) to 1;
    loops(angle, t) lifts the cloth (metres up) where it is looped up (a polonaise's drapes). Open at its ends
    (angles in order). Returns ids (rows + 1, len(angles))."""
    cols = []
    for j, a in enumerate(angles):
        yt = top_y(a) if callable(top_y) else top_y
        yh = hem(a)
        col = []
        for k in range(rows + 1):
            t = k / rows
            y = yt + (yh - yt) * t
            if loops is not None:
                y += loops(a, t)
            p = np.array((math.sin(a) * 0.7, y, math.cos(a) * 0.7))
            q = snap_out(onto, p, 0.0)
            for _ in range(3):
                q = snap_out(onto, np.array((q[0], y, q[2])), 0.0)
            nrm = find_out(onto, q)[1]
            c = clear + (clear_hem - clear) * t
            if folds is not None:
                c += folds(j, t)
            if lift_fn is not None:
                c += lift_fn(a, t)
            col.append(q + nrm * c)
        cols.append(col)
    pts = np.array(cols).transpose(1, 0, 2)
    ids = pc.grid(pts, wfn or onto.weights)
    pc.orient(lambda q: q - np.array((0.0, q[1], 0.0)))
    return ids


# ---------------------------------------------------------------- aprons, bands, bows

def apron(fit, pc, on_skirt, top, bottom, half=72.0, n=11, rows=4, clear=0.018, clear_add=0.018, folds=0.0):
    """An apron from its band at the waist (y top) down to `bottom`, over the front of the skirt from -half to
    +half degrees round the body."""
    th = np.radians(np.linspace(-half, half, n))
    loop = []
    for t in th:
        q = snap_out(on_skirt, np.array((math.sin(t) * 0.4, top, math.cos(t) * 0.4)), 0.0)
        q = snap_out(on_skirt, np.array((q[0], top, q[2])), clear)
        loop.append(pc.add(q, on_skirt.weights(q), zone="skirt"))
    hs = [top + (bottom - top) * k / rows for k in range(1, rows + 1)]

    def push(j, p, d):
        q = snap_out(on_skirt, p, clear + 0.006 + clear_add * min(1.0, d / 0.3))
        if folds:
            nrm = find_out(on_skirt, q)[1]
            q = q + nrm * folds * min(1.0, d / 0.35) * (0.5 + 0.5 * math.cos(j * 2.4))
        return q
    # the apron's own hanging weights (as the skirt's): taken from the skirt's few rings it stood out from the lap
    # like a plate when she sat; this way it falls from the knees down the shins
    ids = ck.hang(fit, pc, loop, hs, clear=0.06, closed=False, push=push,
                  wfn=lambda p: skirt_weights(fit, p, back_legs=0.75, spring=0.15, shin=1.0))
    pc.meta.update(top=top, bottom=bottom)
    return ids


def bib(fit, pc, on_bodice, bottom, top, w_bottom=0.20, w_top=0.17, lift=0.004, cols=5, rows=5):
    """An apron's bib pinned on the bodice's front, from the waist up to the chest."""
    zf = 0.2
    path = [(0.0, bottom, zf), (0.0, 0.5 * (bottom + top), zf), (0.0, top, zf)]
    ids = ck.strap_grid(fit, pc, path, [w_bottom, 0.5 * (w_bottom + w_top), w_top], lift, cols=cols, rows=rows,
                        onto=on_bodice)
    pc.meta.update(bib_top=top, bib_bottom=bottom)
    return ids


def straps(fit, pc, on_bodice, x_front, y_front, y_back, width=0.035, lift=0.005, rows=7):
    """Two straps from a bib's top corners over the shoulders down the back to the waist (a pinafore's)."""
    for sg in (1, -1):
        x = sg * x_front
        path = [(x, y_front, 0.15), (sg * (x_front + 0.01), Yf(fit, 0.80), 0.10),
                (sg * (x_front + 0.015), Yf(fit, 0.836), 0.0), (sg * (x_front + 0.005), Yf(fit, 0.80), -0.12),
                (sg * (x_front - 0.01), 0.5 * (Yf(fit, 0.80) + y_back), -0.14), (sg * (x_front - 0.03), y_back, -0.13)]
        ck.strap_grid(fit, pc, path, width, lift, cols=3, rows=rows, onto=on_bodice)


def bow(pc, onto, centre, size=0.05, tails=0.25, lift=0.008, wfn=None, tail_w=0.045):
    """A bow tied at the back (an apron's strings, a sash): two flat loops either side of a knot, two tails hanging
    from it. Laid on `onto` at `centre` (game space). Returns nothing."""
    c = snap_out(onto, np.asarray(centre, np.float64), lift)
    nrm = find_out(onto, c)[1]
    up = np.array((0.0, 1.0, 0.0))
    side = norm(np.cross(up, nrm))
    wf = wfn or onto.weights
    # the knot: a short tube across
    from .held import sweep
    sweep(pc, [c - side * 0.012, c, c + side * 0.012], 0.011, 0.007, 6, up=tuple(nrm))
    # the loops: flattened tubes out to each side and back
    for sg in (1, -1):
        path = []
        for k in range(9):
            a = math.pi * k / 8
            path.append(c + side * sg * (0.012 + size * 0.5 * (1 - math.cos(a))) + up * (size * 0.32 * math.sin(a))
                        + nrm * (0.006 * math.sin(a)))
        sweep(pc, path, 0.012, 0.004, 6, caps=(False, False), up=tuple(nrm))
    # the tails: flat strips hanging from the knot, a little apart
    nF = len(pc.F)
    for sg in (1, -1):
        top = c + side * sg * 0.008
        pts = []
        for k in range(5):
            t = k / 4
            p = top + side * sg * (0.012 * t) - up * (tails * t)
            q = snap_out(onto, p, lift * (1 - 0.3 * t))
            pts.append(q)
        rows = []
        for q in pts:
            rows.append([q - side * tail_w / 2, q + side * tail_w / 2])
        pc.grid(np.array(rows), lambda p: wf(p))
    pc.orient(nrm, start=nF)
    # weights for the tube parts (sweep gave none)
    for i, w in enumerate(pc.W):
        if not w:
            pc.W[i] = wf(pc.V[i])


# ---------------------------------------------------------------- shawls

def _path_resample(path, widths, lifts, rows):
    path = np.asarray(path, np.float64)
    L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
    t = np.linspace(0, L[-1], rows)
    P = np.stack([np.interp(t, L, path[:, k]) for k in range(3)], -1)
    return P, np.interp(t, L, widths), np.interp(t, L, lifts)


def band_out(fit, pc, onto, path, widths, lifts, cols=5, rows=None, away=None, lift_out=0.0, wfn=None):
    """A band laid on `onto` with its inner edge along `path` and reaching `widths` (per path point) away from it
    across the surface; `lifts` per point (metres over the surface), `lift_out` more at the outer edge. away(p):
    the direction the band goes from its inner edge (default: away from the neck). Returns ids (rows, cols)."""
    rows = rows or len(path)
    P, W, Lf = _path_resample(path, widths, lifts, rows)
    neck = np.array((0.0, Yf(fit, 0.85), -0.01))
    pts = []
    for k in range(rows):
        t = P[min(k + 1, rows - 1)] - P[max(k - 1, 0)]
        t = t / np.linalg.norm(t)
        n = find_out(onto, P[k])[1]
        a = norm(np.cross(n, t))
        d = away(P[k]) if away is not None else P[k] - neck
        if np.dot(a, d) < 0:
            a = -a
        row = []
        for j in range(cols):
            u = j / (cols - 1)
            p = P[k] + a * W[k] * u
            q = snap_out(onto, p, 0.0)
            q = snap_out(onto, q, Lf[k] + lift_out * u)
            row.append(q)
        pts.append(row)
    pts = np.array(pts)
    ids = pc.grid(pts, wfn or onto.weights)
    pc.orient(lambda q: snap_out(onto, q, 0.05) - snap_out(onto, q, 0.0))
    return ids


def fringe(fit, pc, edge_pts, onto, length=0.055, lift=0.004, wfn=None, tooth=0.6):
    """A fringe hanging from a cloth's edge (points in order along the edge): one row of tassels, each edge point
    the top of one, the tips alternately long and short (tooth: the short ones' share), falling straight down over
    `onto`. Returns ids (2, n)."""
    E = np.asarray(edge_pts, np.float64)
    tops, tips = [], []
    for k, p in enumerate(E):
        top = snap_out(onto, p + np.array((0.0, 0.004, 0.0)), lift)
        L = length * (1.0 if k % 2 == 0 else tooth)
        q = p - np.array((0.0, L, 0.0))
        s, nrm = find_out(onto, q)
        if np.dot(q - s, nrm) < lift + 0.002:
            q = s + nrm * (lift + 0.002)
        tops.append(top)
        tips.append(q)
    ids = pc.grid(np.array([tops, tips]), wfn or onto.weights)
    pc.orient(lambda q: snap_out(onto, q, 0.05) - snap_out(onto, q, 0.0))
    # the tips are creased, so each stays a tassel after the subdivision
    for k in range(len(E) - 1):
        pc.set_crease(ids[1, k], ids[1, k + 1], 0.9)
    return ids


# ---------------------------------------------------------------- collars and capes

def neck_base(fit, n=24, ease=0.012):
    """A ring round the base of the neck (cage ring n0), n points, `ease` out."""
    n0, _ = ck.neck_rings(fit)
    P = np.array([fit.rest[i] + fit.N[i] * ease for i in n0])
    ang = np.arctan2(P[:, 0], P[:, 2] + 0.01)
    o = np.argsort(ang)
    ang, P = ang[o], P[o]
    ang = np.concatenate([ang - 2 * math.pi, ang, ang + 2 * math.pi])
    P = np.concatenate([P, P, P])
    t = 2 * math.pi * np.arange(n) / n
    t = np.where(t > math.pi, t - 2 * math.pi, t)
    return np.stack([np.interp(t, ang, P[:, k]) for k in range(3)], -1)


def pelerine(fit, pc, onto, depth_front, depth_back, n=24, rings=3, lift=0.004, lift_out=0.004, up=0.010,
             front_gap=0.0, wfn=None, depth_fn=None):
    """A cape collar laid round the neck over the shoulders: from a ring at the base of the neck (raised `up`)
    walked down the garment under it to `depth_front` in front and `depth_back` behind (depth_fn(angle) instead,
    for a shaped edge). front_gap: open in front (metres between the edges)."""
    base = neck_base(fit, n, 0.004)
    base[:, 1] += up
    rows = []
    for k in range(rings + 1):
        t = k / rings
        row = []
        for j, p in enumerate(base):
            a = math.atan2(p[0], p[2] + 0.01)
            d = depth_fn(a) if depth_fn else depth_front + (depth_back - depth_front) * (0.5 - 0.5 * math.cos(a))
            q = p.copy()
            steps = max(1, int(d * t / 0.02))
            for s_ in range(steps):
                s, nrm = find_out(onto, q)
                down = np.array((0.0, -1.0, 0.0))
                tang = down - nrm * np.dot(down, nrm)
                tl = np.linalg.norm(tang)
                if tl < 1e-6:
                    break
                q = s + tang / tl * (d * t / steps) + nrm * 0.001
            q = snap_out(onto, q, lift + lift_out * t) if k > 0 else snap_out(onto, q, lift)
            row.append(q)
        rows.append(row)
    pts = np.array(rows)
    if front_gap > 0:
        order = list(range(1, n)) + [0]
        pts = pts[:, order]
        pts[:, 0, 0] = np.maximum(pts[:, 0, 0], front_gap / 2)
        pts[:, -1, 0] = np.minimum(pts[:, -1, 0], -front_gap / 2)
    ids = pc.grid(pts, wfn or (lambda p: fit.near_w(p, ("neck", "torso"))), closed=front_gap <= 0,
                  seam_col=n // 2 if front_gap <= 0 else None)
    pc.orient(lambda q: q - np.array((0.0, Yf(fit, 0.70), -0.01)))
    return ids


# ---------------------------------------------------------------- the head

def head_centre(fit):
    c, top = ck.head_axis(fit)
    chin = Yf(fit, 0.870)
    return np.array((0.0, chin + fit.P["hs"] * 0.115, c[2] - 0.004)), top


def head_grid(fit, us, vs, margin, centre=None, tilt=None):
    """Points `margin` over the head and hair on arcs from ear to ear (us, radians from straight up, + to the left)
    tipped back by vs (radians, 0 straight up, + toward the nape): the hood_cap's way, any margin per row."""
    c = centre if centre is not None else head_centre(fit)[0]
    grid = []
    for k, v in enumerate(vs):
        dirs = [np.array((math.sin(u), math.cos(u) * math.cos(v), -math.cos(u) * math.sin(v))) for u in us]
        m = margin[k] if np.ndim(margin) else margin
        grid.append(ck.head_hit(fit, c, dirs, m))
    return np.array(grid)


def kerchief(fit, pc, tie="chin", margin=0.010, front=-30.0, cols=15, rows=9, knot=None):
    """A square of printed cotton folded into a triangle and worn over the head: from a little behind the hairline
    over the crown, down the back of the head. tie="chin": its sides come down over the ears to a knot under the
    chin with two short ends (knot: a second piece); tie="nape": the sides run behind the ears to a knot at the
    nape, the triangle's point hanging over it. Weighted to the head (the knot and ends to the head and neck)."""
    c, top = head_centre(fit)
    if tie == "chin":
        side, back = 124.0, 120.0
    else:
        side, back = 92.0, 128.0
    us = np.radians(np.linspace(-side, side, cols))
    vs = np.radians(np.linspace(front, back, rows))
    margins = [margin * (1.0 + 0.5 * (k / (rows - 1)) ** 2) for k in range(rows)]
    pts = head_grid(fit, us, vs, margins, c)
    # the front edge folded back: a little fuller over the forehead
    pts[0] = pts[0] + norm(pts[0] - c) * 0.003
    if tie == "chin":
        # the sides drawn in under the jaw toward the knot
        chin = np.array((0.0, Yf(fit, 0.868) - 0.010, c[2] + 0.060))
        for k in range(rows):
            for j in (0, cols - 1):
                pass
        kc = chin
    else:
        kc = np.array((0.0, Yf(fit, 0.878), c[2] - 0.090))
    ids = pc.grid(pts, lambda p: dict(HEAD), seam_col=None)
    pc.orient(lambda q: q - c)
    pc.meta.update(centre=c, knot=kc, tie=tie)
    if knot is not None:
        from .held import sweep
        if tie == "chin":
            # the two sides' lower corners gathered to a knot under the chin, and its ends
            for sg in (1, -1):
                start = pts[min(2, rows - 1), 0 if sg > 0 else cols - 1]
                path = [start, 0.5 * (start + kc) + np.array((0.0, -0.012, 0.012)), kc + np.array((sg * 0.008, 0, 0))]
                sweep(knot, path, 0.010, 0.004, 6, caps=(False, False), up=(0.0, 0.0, 1.0))
            sweep(knot, [kc - np.array((0.012, 0, 0)), kc, kc + np.array((0.012, 0, 0))], 0.010, 0.008, 6, up=(0.0, 0.0, 1.0))
            for sg in (1, -1):
                path = [kc + np.array((sg * 0.006, -0.004, 0.004)), kc + np.array((sg * 0.016, -0.030, 0.010)),
                        kc + np.array((sg * 0.024, -0.052, 0.006))]
                sweep(knot, path, 0.013, 0.003, 6, caps=(True, True), up=(0.0, 0.0, 1.0))
        else:
            sweep(knot, [kc - np.array((0.014, 0, 0)), kc, kc + np.array((0.014, 0, 0))], 0.011, 0.009, 6, up=(0.0, 0.0, 1.0))
            for sg in (1, -1):
                path = [kc + np.array((sg * 0.008, -0.004, -0.004)), kc + np.array((sg * 0.020, -0.034, -0.012)),
                        kc + np.array((sg * 0.026, -0.060, -0.018))]
                sweep(knot, path, 0.014, 0.003, 6, caps=(True, True), up=(0.0, 0.0, -1.0))
        for i, w in enumerate(knot.W):
            if not w:
                knot.W[i] = fit.near_w(knot.V[i], ("head", "neck")) if tie == "chin" else \
                    wnorm({"head": 0.6, "neck": 0.4})
    return ids


def kerchief_point(fit, pc, kpc, length=0.13, width=0.15):
    """The triangle's point of a kerchief tied at the nape, hanging over the knot down the back of the neck."""
    kc = kpc.meta["knot"]
    c = kpc.meta["centre"]
    rows = []
    for k in range(4):
        t = k / 3
        y = kc[1] + 0.025 - length * t
        w = width * (1 - t) + 0.006
        p = np.array((0.0, y, kc[2] - 0.010 - 0.02 * t))
        s, n = fit.surface(p, ("neck", "torso", "head", "hair"))
        q = s + n * (0.016 + 0.004 * t)
        rows.append([q + np.array((-w / 2, 0, 0)), q, q + np.array((w / 2, 0, 0))])
    pc.grid(np.array(rows), lambda p: wnorm({"head": 0.5, "neck": 0.5}))
    pc.orient((0.0, 0.0, -1.0))


def ties(fit, pc, cap_pts, width=0.012, lift=0.004, bow_size=0.022):
    """Cap strings: from the cap's lower corners at the ears down the cheeks to a bow under the chin."""
    from .held import sweep
    c, _ = head_centre(fit)
    chin = np.array((0.0, Yf(fit, 0.866) - 0.006, c[2] + 0.050))
    for start in cap_pts:
        sg = 1 if start[0] > 0 else -1
        mid = 0.5 * (start + chin) + np.array((sg * 0.012, 0.0, 0.0))
        path = []
        for k in range(6):
            t = k / 5
            p = (1 - t) ** 2 * start + 2 * (1 - t) * t * mid + t * t * (chin + np.array((sg * 0.006, 0, 0)))
            s, n = fit.surface(p, ("head", "neck"))
            q = s + n * lift if np.dot(p - s, n) < lift else p
            path.append(q)
        sweep(pc, path, width / 2, 0.0015, 5, caps=(False, False), up=(0.0, 0.0, 1.0))
    # the bow under the chin
    for sg in (1, -1):
        loop = []
        for k in range(7):
            a = math.pi * k / 6
            loop.append(chin + np.array((sg * (0.004 + bow_size * 0.5 * (1 - math.cos(a))), 0.010 * math.sin(a),
                                         0.006 * math.sin(a))))
        sweep(pc, loop, 0.007, 0.0025, 5, caps=(False, False), up=(0.0, 0.0, 1.0))
    sweep(pc, [chin - np.array((0.007, 0, 0)), chin + np.array((0.007, 0, 0))], 0.006, 0.005, 6, up=(0.0, 0.0, 1.0))
    for i, w in enumerate(pc.W):
        if not w:
            y = pc.V[i][1]
            k = float(sm(Yf(fit, 0.90), Yf(fit, 0.86), y)) * 0.5
            pc.W[i] = wnorm({"head": 1 - k, "neck": k}) if k > 0 else dict(HEAD)


def lappets(fit, pc, starts, length=0.16, width=0.030, lift=0.006):
    """Two lappets (streamers of a cap) from points on the cap hanging down behind the ears to the shoulders."""
    for st in starts:
        sg = 1 if st[0] > 0 else -1
        path = []
        for k in range(5):
            t = k / 4
            p = st + np.array((sg * 0.010 * t, -length * t, -0.020 * t))
            s, n = fit.surface(p, ("head", "neck", "torso", "hair"))
            q = s + n * (lift + 0.002 * k) if np.dot(p - s, n) < lift + 0.002 * k else p
            path.append(q)
        rows = []
        for k, q in enumerate(path):
            s, n = fit.surface(q, ("head", "neck", "torso", "hair"))
            across = norm(np.cross(n, np.array((0.0, 1.0, 0.0))))
            rows.append([q - across * width / 2, q + across * width / 2])
        pc.grid(np.array(rows), lambda p: wnorm({"head": max(0.2, float(sm(Yf(fit, 0.84), Yf(fit, 0.88), p[1]))),
                                                   "neck": 1 - max(0.2, float(sm(Yf(fit, 0.84), Yf(fit, 0.88), p[1])))}))
    c, _ = head_centre(fit)
    pc.orient(lambda q: q - np.array((0.0, q[1], c[2])))


def coif(fit, pc, margin=0.008, cols=15, rows=10, side=118.0, back=128.0, front=-58.0):
    """A nun's white coif: the forehead band and the close hood over the head, its sides down past the cheeks to
    the jaw; the face left free between them."""
    c, top = head_centre(fit)
    us = np.radians(np.linspace(-side, side, cols))
    vs = np.radians(np.linspace(front, back, rows))
    pts = head_grid(fit, us, vs, margin, c)
    ids = pc.grid(pts, lambda p: dict(HEAD))
    pc.orient(lambda q: q - c)
    return ids, pts


def wimple(fit, pc, onto, n=13, rows=5, half=118.0, lift=0.006, margin=0.008):
    """The white wimple: from under the chin and the jaw round to behind the ears, falling straight over the throat
    to the bib (the front half of a tube; the coif and the veil cover the back)."""
    c, top = head_centre(fit)
    co = c + np.array((0.0, 0.015, -0.005))
    base = neck_base(fit, 36, 0.010)
    bang = np.arctan2(base[:, 0], base[:, 2] + 0.01)
    angs = np.radians(np.linspace(-half, half, n))
    cols = []
    for a in angs:
        d = np.array((math.sin(a), -1.0, math.cos(a)))
        top_p = ck.head_hit(fit, co, [d], margin)[0]
        k = int(np.argmin(np.abs(((bang - a) + math.pi) % (2 * math.pi) - math.pi)))
        bot = snap_out(onto, base[k] + np.array((0, -0.012, 0)), lift)
        col = []
        for r in range(rows + 1):
            t = r / rows
            # a straight fall from the chin, eased out over the throat (not a collar on the neck)
            p = top_p * (1 - t) + bot * t
            s_, nrm = fit.surface(p, ("neck", "head", "torso"))
            gap = 0.005 + 0.004 * math.sin(math.pi * t)
            if np.dot(p - s_, nrm) < gap:
                p = s_ + nrm * gap
            col.append(p)
        cols.append(col)
    pts = np.array(cols).transpose(1, 0, 2)
    chin_y = float(pts[0][:, 1].mean())
    ids = pc.grid(pts, lambda p: wnorm({"head": 0.05 + 0.85 * float(sm(chin_y - 0.07, chin_y, p[1])),
                                         "neck": 0.6, "upperChest": 0.6 * float(sm(chin_y - 0.05, chin_y - 0.11, p[1]))}))
    pc.orient(lambda q: q - np.array((0.0, q[1], c[2] - 0.02)))
    return ids


def veil(fit, pc, margin=0.012, front=-38.0, back=150.0, side=104.0, cols=15, rows=8, fall=0.30, fall_rows=3,
         flare=0.25, front_cut=0.0):
    """A veil over the coif: from the forehead back over the head and down behind; below the nape it falls free to
    the shoulder blades and over the shoulders (fall metres below the nape), flaring a little."""
    c, top = head_centre(fit)
    us = np.radians(np.linspace(-side, side, cols))
    vs = np.radians(np.linspace(front, back, rows))
    pts = head_grid(fit, us, vs, margin, c)
    ids = pc.grid(pts, lambda p: dict(HEAD))
    # the fall: from the sides and back edges (the hood's side columns and its last row) straight down
    edge = list(ids[:, 0]) + list(ids[-1, 1:-1]) + list(ids[::-1, -1])
    # only the part of that edge at the back and the sides below the ears
    E = np.array([pc.V[v] for v in edge])
    # the fall hangs from behind the ears: in front of them the veil ends at the cheek
    keep = [k for k in range(len(edge)) if E[k][1] < top - 0.05 and E[k][2] < c[2] - front_cut]
    loop = [edge[k] for k in keep]
    V0 = np.array([pc.V[v] for v in loop])
    y0 = float(V0[:, 1].min())
    rows_ = []
    prev = loop
    for r in range(1, fall_rows + 1):
        t = r / fall_rows
        row = []
        for j, v in enumerate(loop):
            p = np.array(pc.V[v])
            dy = (p[1] - (y0 - fall)) * t
            q = p - np.array((0.0, dy, 0.0))
            out = norm(np.array((q[0], 0.0, q[2] - c[2])))
            q = q + out * flare * fall * t * t
            s, nrm = fit.surface(q, ("neck", "torso", "arm", "head", "hair"))
            if np.dot(q - s, nrm) < 0.02:
                q = s + nrm * 0.02
            row.append(pc.add(q, fit.near_w(q, ("neck", "torso", "head")) if t > 0.3 else
                              wnorm({"head": 1 - t, "neck": t})))
        rows_.append(row)
    allr = np.array([loop] + rows_)
    pc.grid_faces(allr)
    pc.orient(lambda q: q - np.array((0.0, q[1] - 0.05, c[2])))
    return ids


def hood_mantle(fit, pc, onto, hem_y, margin=0.016, front=-30.0, side=104.0, cols=17, hood_rows=7,
                open_half=24.0, rows=6, clear=0.03, flare=0.16):
    """The beguine's falie: a long black mantle with its hood in one: the hood over the cap (its front edge a little
    behind the cap's), the cloth falling from the head over the shoulders and arms to `hem_y`, open in front
    (open_half degrees either side of the middle). Weighted to the head, the shoulders and arms where it lies on
    them, and below the hips as a skirt."""
    c, top = head_centre(fit)
    us = np.radians(np.linspace(-side, side, cols))
    vs = np.radians(np.linspace(front, 135.0, hood_rows))
    hood = head_grid(fit, us, vs, [margin * (1 + 0.6 * (k / (hood_rows - 1)) ** 2) for k in range(hood_rows)], c)
    hid = pc.grid(hood, lambda p: dict(HEAD))
    pc.orient(lambda q: q - c)
    # the shoulders' ring: from the left front edge round the back to the right front edge, at the neck's base
    n = 2 * (cols - 1) + 1
    angs = np.radians(np.linspace(open_half, 360.0 - open_half, n))
    angs = np.where(angs > math.pi, angs - 2 * math.pi, angs)
    # the hood's bottom edge, in order from the left front to the right front: down the left side column, along
    # the last row, up the right side column (the same loop as the mantle's top ring)
    hood_edge = list(hid[:, 0]) + list(hid[-1, 1:-1]) + list(hid[::-1, -1])
    # resample the hood edge to n points by angle round the head's axis
    HE = np.array([pc.V[v] for v in hood_edge])
    he_ang = np.arctan2(HE[:, 0], HE[:, 2] - c[2])
    order = np.argsort(he_ang)
    # the mantle's rows: hood edge (shared), shoulders, upper arm, elbow, hips, knee, hem
    sh_y = Yf(fit, 0.835)
    levels = [sh_y, Yf(fit, 0.76), Yf(fit, 0.66), Yf(fit, 0.56), 0.5 * (Yf(fit, 0.56) + hem_y), hem_y]
    levels = levels[:rows]
    body = ("torso", "arm", "neck", "leg")
    # the top ring: the hood's edge points, matched by angle to the mantle's columns
    top_ids = []
    for a in angs:
        d = np.abs(((he_ang - a) + math.pi) % (2 * math.pi) - math.pi)
        top_ids.append(hood_edge[int(np.argmin(d))])
    # make the top ring unique and ordered: rebuild it from new points on the hood edge
    top_ring = []
    for a in angs:
        d = np.abs(((he_ang - a) + math.pi) % (2 * math.pi) - math.pi)
        k = int(np.argmin(d))
        top_ring.append(pc.add(HE[k] + np.array((0.0, -0.004, 0.0)), dict(HEAD)))
    rings = [top_ring]
    cz = -0.01
    prev_r = None
    for li, y in enumerate(levels):
        dirs = np.stack([np.sin(angs), np.zeros(n), np.cos(angs)], -1)
        need = fit.support(np.array((0.0, 0.0, cz)), dirs, y - 0.06, y + 0.10, body) + clear + 0.01 * li
        if prev_r is not None:
            need = np.maximum(need, prev_r * (1 + flare * 0.15))
        need = np.maximum(need, (np.roll(need, 1) + np.roll(need, -1)) / 2 * 0.99)
        prev_r = need
        ring = []
        for j, a in enumerate(angs):
            p = np.array((math.sin(a) * need[j], y, cz + math.cos(a) * need[j]))
            if li == 0:
                q = snap_out(onto, p, 0.0)
                p = snap_out(onto, q, 0.010)
            if y > Yf(fit, 0.56):
                w = fit.near_w(p, ("torso", "arm", "neck"))
                # cloth over the arm follows it about half
                arm = {b: v for b, v in w.items() if b.startswith(("armUp", "armLow", "shoulder"))}
                if arm:
                    s = sum(arm.values())
                    w = {b: v * (0.5 if b in arm else 1.0) for b, v in w.items()}
                    w["upperChest"] = w.get("upperChest", 0.0) + 0.5 * s
                w = wnorm(w)
            else:
                w = skirt_weights(fit, p, back_legs=0.4, spring=0.25, shin=0.8)
            ring.append(pc.add(p, w, zone="skirt" if y < Yf(fit, 0.56) else ""))
        rings.append(ring)
    R = np.array(rings)
    pc.grid_faces(R)
    pc.orient(lambda q: q - np.array((0.0, q[1], cz)) if q[1] < top - 0.12 else q - c)
    pc.meta.update(hem=hem_y)
    return hid, R


def small_hat(fit, crown_pc, brim_pc, band_pc=None, tilt=16.0, fwd=0.035, lift=0.004, rx=0.062, rz=0.076,
              height=0.034, brim=0.022, n=16):
    """A lady's small hat of 1873 (a toque on a narrow brim): perched forward on the top of the head over the
    chignon, tipped forward by `tilt` degrees; its base sits on the hair (each point dropped onto it). A ribbon band
    round the crown (band_pc). Weighted to the head."""
    c, top = head_centre(fit)
    hc = np.array((0.0, top, c[2] + fwd))
    ta = math.radians(tilt)
    R = np.array(((1, 0, 0), (0, math.cos(ta), -math.sin(ta)), (0, math.sin(ta), math.cos(ta))))  # about x
    phis = 2 * math.pi * np.arange(n) / n

    def ring(r_scale, h):
        out = []
        for ph in phis:
            loc = np.array((math.sin(ph) * rx * r_scale, h, math.cos(ph) * rz * r_scale))
            out.append(hc + R @ loc)
        return np.array(out)
    # the base: each point dropped onto the head along the hat's own down
    down = R @ np.array((0.0, -1.0, 0.0))
    base = ring(1.0, 0.03)
    for j in range(n):
        o = base[j] - down * 0.10
        loc, nrm, _, _ = fit.bvh.ray_cast(tuple(o), tuple(down), 0.3)
        if loc is not None:
            base[j] = np.array(loc) - down * lift
    # the crown: the base's heights carried up, a soft top
    rel = np.array([np.dot(b - hc, R @ np.array((0, 1.0, 0))) for b in base])
    h0 = float(rel.max())
    crown_rows = []
    for s, h in ((1.0, None), (1.02, h0 + height * 0.45), (0.98, h0 + height * 0.85), (0.85, h0 + height),
                 (0.45, h0 + height + 0.006)):
        if h is None:
            crown_rows.append(base)
        else:
            crown_rows.append(ring(s, h))
    ids = crown_pc.grid(np.array(crown_rows), lambda p: dict(HEAD), closed=True, seam_col=n // 2)
    cv = crown_pc.add(hc + R @ np.array((0.0, h0 + height + 0.008, 0.0)), dict(HEAD))
    for j in range(n):
        crown_pc.face((ids[-1, j], ids[-1, (j + 1) % n], cv))
    crown_pc.seam(ids[-1, n // 2], cv)
    crown_pc.orient(lambda q: q - (hc + R @ np.array((0.0, h0 + height * 0.4, 0.0))))
    # the brim: a narrow ring out from the base, turned up at the sides
    brows = []
    for k, (o, up) in enumerate(((0.0, 0.0), (brim * 0.6, 0.003), (brim, 0.008))):
        row = []
        for j, ph in enumerate(phis):
            d = norm(np.array((base[j][0] - hc[0], 0.0, base[j][2] - hc[2])))
            side = abs(math.sin(ph))
            row.append(base[j] + d * o * (1.0 - 0.3 * side) + (R @ np.array((0.0, 1.0, 0.0))) * (up * (0.4 + side)))
        brows.append(row)
    bid = brim_pc.grid(np.array(brows), lambda p: dict(HEAD), closed=True, seam_col=n // 2)
    brim_pc.orient(R @ np.array((0.0, 1.0, 0.0)))
    if band_pc is not None:
        brows = [crown_rows[0] + (crown_rows[1] - crown_rows[0]) * 0.15, crown_rows[1]]
        bb = []
        for row in brows:
            cc = row.mean(0)
            bb.append(cc + (row - cc) * 1.04)
        band_pc.grid(np.array(bb), lambda p: dict(HEAD), closed=True, seam_col=n // 2)
        band_pc.orient(lambda q: q - (hc + R @ np.array((0.0, h0, 0.0))))
    return dict(centre=hc, R=R, h0=h0, base=base, top=hc + R @ np.array((0.0, h0 + height, 0.0)))


def feather(fit, pc, root, tip, width=0.035, rows=6, curl=0.03):
    """An ostrich feather curling over a hat: a flat curved blade from root to tip, its sides creased."""
    root, tip = np.asarray(root, np.float64), np.asarray(tip, np.float64)
    axis = tip - root
    L = np.linalg.norm(axis)
    up = np.array((0.0, 1.0, 0.0))
    side = norm(np.cross(axis, up))
    rows_ = []
    for k in range(rows + 1):
        t = k / rows
        p = root + axis * t + up * curl * math.sin(math.pi * t) - up * curl * 0.6 * t * t
        w = width * math.sin(math.pi * min(1.0, 0.15 + 0.85 * t)) ** 0.6 + 0.004
        rows_.append([p - side * w / 2 + up * 0.004 * math.sin(math.pi * t), p + up * 0.006, p + side * w / 2])
    ids = pc.grid(np.array(rows_), lambda p: dict(HEAD))
    pc.orient(up)
    return ids


# ---------------------------------------------------------------- feet

def boots_light(fit, pc, sole, side, shaft=0.115, heel=0.026, buttons=False):
    """A woman's ankle boot on a lighter last than ck.shoe (eight stations, eight round: under a long skirt only
    its front shows): a rounded heel, the shaft round the ankle, the instep falling to a rounded toe; its sole a slab
    3 mm proud with a built-up heel. Weighted as ck.shoe."""
    P = fit.P
    s = P["w"] * P["f"]["foot"] * 0.92
    sg = 1 if side == "L" else -1
    cx = sg * (fit.hip_x - 0.002)
    up = [(-0.064, 0.026, 0.006, shaft - 0.010, 0.0), (-0.050, 0.035, 0.002, shaft, 0.0),
          (-0.012, 0.036, 0.002, shaft - 0.002, 0.0), (0.036, 0.040, 0.002, 0.096, -0.002),
          (0.090, 0.047, 0.002, 0.066, -0.004), (0.150, 0.047, 0.003, 0.052, -0.006),
          (0.200, 0.038, 0.007, 0.043, -0.005), (0.232, 0.020, 0.012, 0.035, -0.004)]
    st = [(z * s, hw * s, yb, yt, sg * xs) for z, hw, yb, yt, xs in up]

    def w(p):
        t = float(sm(0.10 * s, 0.17 * s, p[2])) * 0.75
        a = float(sm(0.085, shaft, p[1])) * 0.7 * float(sm(0.05 * s, 0.0, p[2]))
        return wnorm({"foot" + side: (1 - t) * (1 - a), "toe" + side: t * (1 - a), "legLow" + side: a})
    ck.loft_z(pc, st, 8, w, cx=cx, power=2.4, power_bottom=6.0)
    pc.orient(lambda c: np.array((c[0] - cx, c[1] - 0.05, c[2] - 0.08 * s)))
    so = [(z, hw + 0.003, -0.0005, (heel if z < -0.02 * s else 0.012), xs) for z, hw, yb, yt, xs in st]
    so[0] = (so[0][0] - 0.002, so[0][1] + 0.002, -0.0005, heel, so[0][4])
    so[-1] = (so[-1][0] + 0.002, so[-1][1], 0.004, 0.016, so[-1][4])
    so = [so[k] for k in (0, 1, 2, 4, 6, 7)]
    nf = len(sole.F)
    ck.loft_z(sole, so, 6, w, cx=cx, power=8.0, power_bottom=8.0, crease_cols=(1, 2, 4, 5), crease=0.06)
    sole.orient(lambda c: np.array((c[0] - cx, c[1] - 0.006, c[2] - 0.08 * s)), start=nf)
    pc.meta.setdefault("sides", []).append((side, cx, s))


# ---------------------------------------------------------------- painting helpers

def proj_uv(ctx, slant=0.3):
    """Two coordinates across a cloth for checks and stripes: across (x, bent round by z) and down (y)."""
    p = ctx.pos
    return p[:, 0] + slant * p[:, 2] * np.sign(p[:, 0] + 1e-9) * 0.0 + slant * p[:, 2], p[:, 1] - slant * p[:, 2]


def check(ctx, u, v, size, ground, bars, aa=0.06):
    """A woven check: bars = [(colour, width share of the repeat, every n-th repeat, strength)] laid both ways over
    the cloth's own colour; where two bars cross the colour is stronger (warp and weft both)."""
    for col, wsh, every, k in bars:
        per = size * every
        du = np.abs(((u / per) + 0.5) % 1.0 - 0.5)
        dv = np.abs(((v / per) + 0.5) % 1.0 - 0.5)
        half = wsh / 2
        su = sm(half + aa * wsh, half - aa * wsh, du)
        sv = sm(half + aa * wsh, half - aa * wsh, dv)
        ctx.mix((np.maximum(su, sv) * 0.55 + su * sv * 0.45) * k * (~ctx.inner), col)


def tartan(ctx, u, v, sett):
    """A tartan from its sett: [(colour, width in metres)] repeated both ways, warp and weft mixed half and half
    (a twill: the stripes cross as a mixed colour, with fine diagonal lines)."""
    total = sum(w for _, w in sett)
    edges = np.cumsum([0.0] + [w for _, w in sett])
    cols = np.array([c for c, _ in sett], np.float32)

    def pick(x):
        t = (x % total)
        idx = np.clip(np.searchsorted(edges, t, side="right") - 1, 0, len(sett) - 1)
        return cols[idx]
    cu = pick(u)
    cv = pick(v)
    twill = (np.sin((u + v) * 2 * math.pi / 0.0022) > 0)[:, None]
    col = np.where(twill, cu * 0.6 + cv * 0.4, cu * 0.4 + cv * 0.6)
    m = (~ctx.inner)[:, None]
    ctx.rgb[:] = np.where(m, col * (ctx.rgb / np.maximum(ctx.piece.cloth.rgb[None], 1e-3)).clip(0.7, 1.3), ctx.rgb)


def knit(ctx, scale=0.0045, rib=0.0, amount=0.00022):
    """Knitted wool: columns of V stitches (stockinette) in the height and a little in the colour; rib>0 adds ribs."""
    p = ctx.pos
    u = p[:, 0] + 0.5 * p[:, 2]
    v = p[:, 1]
    col_ph = (u / scale) % 1.0
    row_ph = (v / (scale * 0.75)) % 1.0
    vshape = np.abs(col_ph - 0.5) * 2
    st = np.cos((row_ph + vshape * 0.5) * 2 * math.pi) * 0.5 + 0.5
    st *= sm(0.0, 0.25, 1 - vshape) * 0.5 + 0.5
    ctx.bump(st, amount)
    ctx.mul(np.ones(len(v)), 1.0)
    ctx.rgb[:] = ctx.rgb * (0.92 + 0.12 * st)[:, None]
    if rib:
        r = np.cos(u / rib * 2 * math.pi) * 0.5 + 0.5
        ctx.bump(r, amount * 1.5)
        ctx.rgb[:] = ctx.rgb * (0.94 + 0.08 * r)[:, None]


def edge_hem(ctx, dist, shade=0.85):
    """A turned hem a few millimetres in from an edge (dist: metres from the edge, per texel)."""
    ck.seam_line(ctx, dist - 0.012, width=0.0010, depth=0.00010, shade=shade)
