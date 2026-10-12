"""The hands (docs/people.md "Hands"): one connected hand per arm, five fingers with nails and knuckles.

A's arm tube ends at its palm ring p0 (8 columns). From there the palm is a 10-column tube (six pentagons make the
step from 8 to 10): four columns across the back of the hand, four across the palm and one on each side. Its last
loop is shared out among the four fingers, each a 4-column tube grown from one back edge, one palm edge and the
"web" edges between the fingers (so the fingers are joined to the palm and to each other by webs, not pushed into
a block). The thumb grows out of a hole in the palm's thumb side between the first two palm rings. Every finger
follows A's finger bones (body.hand_frame): rings at the joints (wider, the knuckles), between them (the pads), at
the nail and the tip.

The same code builds every hand, so vertex order and UVs stay the same in every body. hard_offsets() is the
docker's hand as a shape key (thicker fingers, bigger knuckles, a broader palm). grip_fit() closes a hand round a
handle of a given size (a 2 cm rope to a 4 cm cart handle) without passing through it.
"""

import math

import numpy as np

from . import body as bd

FINGER_BONES = {"index": "index", "middle": "middle", "ring": "ring", "little": "ring", "thumb": "thumb"}
NAMES4 = ("index", "middle", "ring", "little")

# finger rings: (name, segment, fraction along it, back, palm, width) as fractions of the finger's half thickness
RINGS = [
    ("r1", 0, 0.30, 0.95, 1.05, 0.98),
    ("pip", 1, 0.0, 1.02, 0.88, 1.05),
    ("dip", 2, 0.0, 0.88, 0.82, 0.94),
    ("nail", 2, 0.45, 0.72, 0.96, 0.90),
    ("tip", 2, 0.86, 0.60, 0.74, 0.76),
]
RING_W = [{"hand": 0.3, "1": 0.7}, {"1": 0.5, "2": 0.5}, {"2": 0.5, "3": 0.5}, {"3": 1.0}, {"3": 1.0}]
THUMB_RINGS = [("t1", 0, 0.15, 1.12), ("t2", 0, 0.55, 1.0), ("ip", 1, 0.0, 0.97), ("nail", 1, 0.45, 0.90),
               ("tip", 1, 0.86, 0.74)]
THUMB_W = [{"thumb1": 0.45, "thumb2": 0.55}, {"thumb2": 1.0}, {"thumb2": 0.5, "thumb3": 0.5}, {"thumb3": 1.0},
           {"thumb3": 1.0}]
WEB_PULL = (0.22, 0.12)  # how far the first two thumb rings' index side goes toward the index knuckle


def _wts(table, S, bone):
    out = {}
    for k, v in table.items():
        out["hand" + S if k == "hand" else (bone + k + S if k[0].isdigit() else k + S)] = v
    return out


def palm_rings(P, side):
    """The palm's three 10-vertex loops (game space, before the stoop): near the wrist, mid palm, the knuckles.
    Each loop: D0..D4 (the back, thumb side first), V4..V0 (the palm, little-finger side first)."""
    sg = 1 if side == "L" else -1
    w, fh = P["w"], P["f"]["hand"]
    s = w * fh
    sh = bd.shoulder_x(P)
    yw, yk = bd.Y(P, 0.486), bd.Y(P, 0.429)
    zk = np.array([0.0372, 0.0175, -0.0005, -0.0180, -0.0352]) * s
    rings = []
    # (y, z scale, back offsets D0..D4, palm offsets V0..V4)
    spec = [
        (yw - 0.027 * s, np.array([0.86, 0.9, 0.9, 0.9, 0.86]), [0.0080, 0.0108, 0.0116, 0.0108, 0.0078],
         [0.0175, 0.0168, 0.0148, 0.0140, 0.0128]),
        (yw - 0.056 * s, np.array([0.99, 1.0, 1.0, 1.0, 0.99]), [0.0085, 0.0118, 0.0124, 0.0116, 0.0082],
         [0.0158, 0.0150, 0.0142, 0.0140, 0.0132]),
    ]
    # the ball of the thumb (thenar) fills the palm's thumb side down to the thumb's root; the little finger's ball
    # (hypothenar) the other edge, less
    thenar = [(0.0022, 0.0030, 0.0008, 0.0, 0.0010), (0.0016, 0.0024, 0.0006, 0.0, 0.0008)]
    for (y, zs, back, palm), th in zip(spec, thenar):
        D = [(sg * (sh + back[k] * s), y, zk[k] * zs[k]) for k in range(5)]
        V = [(sg * (sh - (palm[k] + th[k]) * s), y - 0.002 * s, zk[k] * zs[k] + (0.0015 * s if k == 0 else 0.0))
             for k in range(5)]
        rings.append(D + V[::-1])
    # the knuckle loop: the back follows the knuckles (the index and little lower), the webs between the fingers
    # lie further down, more so on the palm side
    drops = {f[0]: f[2] for f in bd.FINGERS}
    dk = [drops["index"], (drops["index"] + drops["middle"]) / 2, (drops["middle"] + drops["ring"]) / 2,
          (drops["ring"] + drops["little"]) / 2, drops["little"]]
    back = [0.0088, 0.0126, 0.0130, 0.0122, 0.0084]
    palm = [0.0120, 0.0118, 0.0116, 0.0116, 0.0112]
    D, V = [], []
    for k in range(5):
        web = 1 <= k <= 3
        yb = yk + 0.004 * s - dk[k] * s - (0.006 * s if web else 0.0)
        yp = yk + 0.001 * s - dk[k] * s - (0.012 * s if web else 0.0)
        D.append((sg * (sh + back[k] * s), yb, zk[k]))
        V.append((sg * (sh - palm[k] * s), yp, zk[k]))
    rings.append(D + V[::-1])
    return rings


def _frame(ax, sg, thumb=False):
    u = np.array((sg, 0.0, 0.0))
    if thumb:
        u = np.array((sg * 0.55, 0.0, 0.85))
    u = u - ax * (u @ ax)
    u /= np.linalg.norm(u)
    r = np.array((0.0, 0.0, 1.0))  # the thumb side
    if thumb:
        r = np.cross(ax, u)
        if r @ np.array((-sg, 0.0, 0.0)) < 0:
            r = -r
    r = r - ax * (r @ ax) - u * (r @ u)
    r /= np.linalg.norm(r)
    return u, r


def _along(pts, seg, frac):
    a, b = np.array(pts[seg]), np.array(pts[seg + 1])
    return a + (b - a) * frac, (b - a) / np.linalg.norm(b - a)


def build_hand(C, P, side, p0):
    """Add one hand to A's cage C, from its 8-vertex palm ring p0 (vertex ids, A's column order: 0 the thumb side,
    2 the back, 4 the little-finger side, 6 the palm)."""
    sg = 1 if side == "L" else -1
    arm = "arm" + side
    w, fh = P["w"], P["f"]["hand"]
    s = w * fh
    hf = bd.hand_frame(P, side)
    rings = palm_rings(P, side)
    ids = []
    # palm vertices: their weights go with the hand, the thumb side of the first two rings partly with the thumb
    for ri, ring in enumerate(rings):
        row = []
        for k, p in enumerate(ring):
            wd = {"hand" + side: 1.0}
            if ri < 2:
                share = {0: 0.3 if ri == 0 else 0.38, 9: 0.5 if ri == 0 else 0.58, 8: 0.26, 1: 0.08}.get(k, 0.0)
                if share:
                    wd = {"hand" + side: 1 - share, "thumb1" + side: share}
            row.append(C.v(p, arm, ring="p%d" % (ri + 1), col=k, side=side, w=wd))
        ids.append(row)
    # 8 -> 10: six pentagons (A's loft winding: the ring above i -> j, then the ring below back)
    L = ids[0]
    D = L[:5]
    V = L[5:][::-1]  # V0..V4
    j = p0
    for f in ((j[1], j[2], D[2], D[1], D[0]), (j[2], j[3], D[4], D[3], D[2]), (j[3], j[4], j[5], V[4], D[4]),
              (j[5], j[6], V[2], V[3], V[4]), (j[6], j[7], V[0], V[1], V[2]), (j[7], j[0], j[1], D[0], V[0])):
        C.q(f, arm)
    # the palm tube; the thumb's hole is the thumb-side quad between the first two loops
    for r in range(2):
        a, b = ids[r], ids[r + 1]
        for k in range(10):
            k2 = (k + 1) % 10
            if r == 0 and k == 9:
                continue
            C.q((a[k], a[k2], b[k2], b[k]), arm)
    # the seam down the middle of the palm (A's arm seam is its column 6, the palm's middle)
    C.seam(j[6], ids[0][7])
    C.seam(ids[0][7], ids[1][7])
    C.seam(ids[1][7], ids[2][7])
    # the fingers, from the knuckle loop: finger i owns back edge D_i D_i+1 and palm edge V_i+1 V_i
    K = ids[2]
    KD = K[:5]
    KV = K[5:][::-1]
    for fi, fname in enumerate(NAMES4):
        half = [f for f in bd.FINGERS if f[0] == fname][0][4] * s
        pts = [np.array(p) for p in hf[fname]]
        base = [KD[fi], KD[fi + 1], KV[fi + 1], KV[fi]]
        part = "finger_" + fname + side
        bone = FINGER_BONES[fname]
        prev = base
        allr = [base]
        L1 = sum(np.linalg.norm(pts[k + 1] - pts[k]) for k in range(3))
        for ri, (rn, seg, frac, kb, kp, kw) in enumerate(RINGS):
            c, ax = _along(pts, seg, frac)
            u, r = _frame(ax, sg)
            along = np.linalg.norm(c - pts[0]) / L1
            taper = 1.0 - 0.16 * along
            hb, hp, hw = kb * half * taper * 0.95, kp * half * taper * 0.95, kw * half * taper * 1.0
            ring = [c + u * hb + r * hw, c + u * hb - r * hw, c - u * hp - r * hw, c - u * hp + r * hw]
            if rn == "tip":
                ring = [p * 0.8 + c * 0.2 + ax * half * 0.5 for p in ring]
            wd = _wts(RING_W[ri], side, bone)
            row = [C.v(tuple(p), part, ring=ri + 1, side=side, finger=fname, w=wd) for p in ring]
            allr.append(row)
            prev = row
        C.loft(allr, part, seam_col=2)
        C.q(tuple(prev), part)
        for k in range(4):  # each finger an island of its own
            C.seam(base[k], base[(k + 1) % 4])
    # the thumb, from its hole
    hole = [ids[0][9], ids[0][0], ids[1][0], ids[1][9]]  # palm-top, back-top, back-bottom, palm-bottom
    th = [np.array(p) for p in hf["thumb"]]
    hc = np.mean([np.array(C.rest[i]) for i in hole], axis=0)
    chain = [hc, th[1], th[2], th[3]]
    half = 0.0108 * s
    order = None
    allr = [hole]
    part = "finger_thumb" + side
    hp = [np.array(C.rest[i]) for i in hole]
    for ri, (rn, seg, frac, kr) in enumerate(THUMB_RINGS):
        c, ax = _along(chain[1:], seg, frac)
        u, r = _frame(ax, sg, thumb=True)
        rr = half * kr * (1.0 - 0.12 * ri / len(THUMB_RINGS))
        hb, hpm, hw = rr * 0.92 * 0.95, rr * 1.06 * 0.95, rr * 1.12
        ring = [c + u * hb + r * hw, c + u * hb - r * hw, c - u * hpm - r * hw, c - u * hpm + r * hw]
        if order is None:
            # the ring's corners in the hole's order: the turn (and direction) that puts them nearest
            best = None
            for flip in (False, True):
                base = ring[::-1] if flip else ring
                for k in range(4):
                    cand = base[k:] + base[:k]
                    cost = sum(np.linalg.norm(cand[i] - hp[i]) for i in range(4))
                    if best is None or cost < best[0]:
                        best = (cost, flip, k)
            order = best[1:]
        flip, k = order
        base = ring[::-1] if flip else ring
        ring = base[k:] + base[:k]
        if rn == "tip":
            ring = [p * 0.8 + c * 0.2 + ax * half * 0.5 for p in ring]
        if ri < 2:
            # the web: the side of the thumb's first joint that faces the index is drawn toward the index's
            # knuckle, so the thumb grows out of the hand in a fold of skin instead of hanging off it
            # (sideways only: drawn down past the hole's lower edge the skin would fold over itself in a fist)
            kn = np.array(hf["index"][0])
            d = [np.linalg.norm(p - kn) for p in ring]
            near = sorted(range(4), key=lambda i: d[i])[:2]
            pull = WEB_PULL[ri]
            ring = [p + (kn - p) * np.array((1.0, 0.0, 1.0)) * pull * (1.0 if i == near[0] else 0.7) if i in near
                    else p for i, p in enumerate(ring)]
        wd = _wts(THUMB_W[ri], side, "thumb")
        row = [C.v(tuple(p), part, ring=ri + 1, side=side, finger="thumb", w=wd) for p in ring]
        allr.append(row)
    C.loft(allr, part, seam_col=2)
    C.q(tuple(allr[-1]), part)
    for k in range(4):
        C.seam(hole[k], hole[(k + 1) % 4])


# ---------------------------------------------------------------- the docker's hand (a shape key)

def hard_offsets(co, vparts, J, P, amount=1.0):
    """Offsets (game space) that make a working man's hand of a body's near copy: fingers a sixth thicker, the
    knuckles bigger, the palm broader and thicker. co: (n, 3) rest positions; vparts: part per vertex."""
    out = np.zeros_like(co)
    yw = bd.Y(P, 0.486)
    for S, sg in (("L", 1), ("R", -1)):
        sh = bd.shoulder_x(P)
        hf = bd.hand_frame(P, S)
        for i, part in enumerate(vparts):
            if not part:
                continue
            p = co[i]
            if part.startswith("finger_") and part.endswith(S):
                fname = part[len("finger_"):-1]
                pts = [np.array(x) for x in hf[fname]]
                best, bc, bt = 1e9, None, 0.0
                for k in range(len(pts) - 1):
                    a, b = pts[k], pts[k + 1]
                    d = b - a
                    t = np.clip((p - a) @ d / (d @ d), 0, 1)
                    q = a + d * t
                    dist = np.linalg.norm(p - q)
                    if dist < best:
                        best, bc, bt = dist, q, k + t
                knuck = math.exp(-((bt - round(bt)) / 0.18) ** 2) if 0.5 < bt < 2.6 else 0.0
                out[i] = (p - bc) * (0.22 + 0.16 * knuck) * amount
            elif part == "arm" + S and p[1] < yw - 0.004:
                c = np.array((sg * sh, p[1], 0.0))
                d = p - c
                out[i] = np.array((d[0] * 0.16, 0.0, d[2] * 0.10)) * amount
    return out


# ---------------------------------------------------------------- closing a hand round a handle

def grip_fit(J, P, side, radius, centre_off, fingers=NAMES4, max_deg=(95.0, 105.0, 75.0), up=0.0):
    """Curls (MCP, PIP, DIP degrees per finger) that close a finger chain round a handle of `radius` (m) whose axis
    runs across the hand (game z) through gripR/gripL's head moved by centre_off (along the palm's normal, metres,
    + toward the back of the hand): each joint turns until its bone's pad meets the handle. Returns curls and the
    deepest the chain then reaches into the handle (negative: a gap)."""
    sg = 1 if side == "L" else -1
    gh = np.array(J["grip" + side][0], float)
    centre = gh + np.array((sg * centre_off, up, 0.0))
    out = {}
    for fname in fingers:
        half = [f for f in bd.FINGERS if f[0] == fname][0][4] * P["w"] * P["f"]["hand"]
        bone = FINGER_BONES[fname]
        if fname == "little":
            pts = [np.array(x) for x in bd.hand_frame(P, side)["little"]]
        else:
            pts = [np.array(J[bone + "1" + side][0]), np.array(J[bone + "2" + side][0]),
                   np.array(J[bone + "3" + side][0]), np.array(J[bone + "3" + side][1])]
        # in the finger's plane: x toward the palm (-sg x), y down
        def to2(p):
            return np.array((-(p[0] - pts[0][0]) * sg, -(p[1] - pts[0][1])))
        c2 = to2(centre)
        Ls = [np.linalg.norm(pts[k + 1] - pts[k]) for k in range(3)]
        rad = [half * 1.0, half * 0.92, half * 0.85]
        ang = 0.0
        base = np.zeros(2)
        curls = []
        deepest = -1.0
        for k in range(3):
            best = max_deg[k]
            for deg in np.arange(0.0, max_deg[k] + 0.01, 0.5):
                a = math.radians(ang + deg)
                d = np.array((math.sin(a), math.cos(a)))
                tip = base + d * Ls[k]
                # distance from the handle's centre to the segment
                h = np.clip((c2 - base) @ d / Ls[k], 0, 1)
                dist = np.linalg.norm(c2 - (base + d * Ls[k] * h))
                if dist < radius + rad[k] - 0.0004:
                    best = max(0.0, deg - 0.5)
                    break
            curls.append(best)
            ang += best
            a = math.radians(ang)
            d = np.array((math.sin(a), math.cos(a)))
            h = np.clip((c2 - base) @ d / Ls[k], 0, 1)
            dist = np.linalg.norm(c2 - (base + d * Ls[k] * h))
            deepest = max(deepest, radius + rad[k] - dist)
            base = base + d * Ls[k]
        out[fname] = (tuple(round(c, 1) for c in curls), round(float(deepest), 4))
    return out


# ---------------------------------------------------------------- the hands' paint

def _seg_dist(p, a, b):
    """Distance from points p (n, 3) to the segment a-b."""
    d = b - a
    t = np.clip((p - a) @ d / (d @ d), 0.0, 1.0)
    return np.linalg.norm(p - (a + np.outer(t, d)), axis=1)


HAND_TINT = np.array((0.95, 0.90, 0.88))  # the hands against the arm: about 9% darker and redder
CREASE = 0.18  # how much darker a joint's crease is


def paint_hands(rgb, height, pos, part, names, P, hard=0.0):
    """Paint the hands into a body picture through A's position map: the hands a little darker and redder than the
    arm (blood and weather), shade where the fingers lie against each other and at their roots, creases at every
    joint (on the back short curved lines over the knuckles, on the palm the joint creases, 18% darker, 1-1.5 mm
    wide) and three in the palm, nails (the plate, its pale moon and free edge, the cuticle line and the folds at its
    sides), red knuckles, tendons; and their heights for the normal map. rgb and height are changed in place."""
    pn = np.array(names + [""])
    pname = pn[np.where(part >= 0, part, len(names))]
    w, fh = P["w"], P["f"]["hand"]
    s = w * fh
    yw = bd.Y(P, 0.486)
    for S, sg in (("L", 1), ("R", -1)):
        hf = bd.hand_frame(P, S)
        sh = bd.shoulder_x(P)
        halves = {f[0]: f[4] * s for f in bd.FINGERS}
        halves["thumb"] = 0.0108 * s
        for fname in NAMES4 + ("thumb",):
            m = pname == "finger_" + fname + S
            if not m.any():
                continue
            pts = [np.array(p) for p in hf[fname]]
            idx = np.nonzero(m)
            p = pos[idx]
            half = halves[fname]
            col = rgb[idx]
            h = height[idx]
            # shade where a finger lies against its neighbour (the gap between them is dark)
            occ = np.zeros(len(p))
            for other in NAMES4:
                if other == fname or (fname == "thumb" and other != "index"):
                    continue
                q = [np.array(x) for x in hf[other]]
                dist = np.min([_seg_dist(p, q[k], q[k + 1]) for k in range(3)], axis=0)
                gap = dist - halves[other]
                occ = np.maximum(occ, np.clip(1 - gap / (0.0065 * s), 0, 1) ** 1.6)
            col *= (1 - 0.16 * occ)[:, None]
            h -= occ * 0.00004
            segs = range(1, 3) if fname == "thumb" else range(3)
            for k in segs:
                a, b = pts[k], pts[k + 1]
                d = b - a
                L = np.linalg.norm(d)
                d /= L
                u, r = _frame(d, sg, thumb=(fname == "thumb"))
                rel = p - a
                al = rel @ d
                back = rel @ u
                lat = rel @ r
                across = np.clip(1 - np.abs(lat) / (0.85 * half), 0, 1)
                if k == segs[-1]:
                    # the nail: a plate from 0.40 to the tip on the back of the last joint, its moon, the cuticle,
                    # the folds along its sides and the pale free edge
                    on_back = back > 0.22 * half
                    plate = (al > 0.40 * L) & (al < 1.03 * L) & on_back & (np.abs(lat) < 0.76 * half)
                    moon = plate & (np.hypot((al - 0.40 * L) / (0.13 * L), lat / (0.55 * half)) < 1.0)
                    edge = plate & (al > 0.90 * L)
                    cut = np.exp(-((al - 0.40 * L) / 0.0007) ** 2) * on_back * (np.abs(lat) < 0.8 * half)
                    fold = np.exp(-((np.abs(lat) - 0.78 * half) / 0.0008) ** 2) * on_back * (al > 0.40 * L)
                    col[plate] = col[plate] * 0.5 + np.array((0.84, 0.66, 0.62)) * 0.5
                    col[moon] = col[moon] * 0.6 + np.array((0.90, 0.80, 0.76)) * 0.4
                    col[edge] = col[edge] * 0.45 + np.array((0.88, 0.82, 0.74)) * 0.55
                    col *= (1 - 0.25 * cut - 0.10 * fold)[:, None]
                    h[plate] += 0.00012
                    h -= cut * 0.00008
                # the creases at the joint this segment starts from: on the back two or three short curved lines
                # over the knuckle, on the palm the joint's crease (a pair at the middle joint)
                if k == 0 and fname != "thumb":
                    # the palm's crease where the finger leaves the hand, a third down the first joint
                    cpl = (back < -0.25 * half) * across * np.exp(-((al - 0.28 * L) / 0.0008) ** 2)
                    col *= (1 - CREASE * cpl)[:, None]
                    h -= cpl * 0.00010
                    continue
                bend = 0.0012 * (lat / max(half, 1e-6)) ** 2  # the lines curve round the knuckle
                cb = np.zeros(len(p))
                for off in (-0.0018, 0.0, 0.0018):
                    cb = np.maximum(cb, np.exp(-((al - off - bend) / 0.00075) ** 2))
                cb *= (back > 0.15 * half) * across * (0.7 + 0.3 * across)
                col *= (1 - CREASE * cb)[:, None]
                h -= cb * 0.00006
                offs = (-0.0010, 0.0010) if k == 1 else (0.0,)
                cp = np.zeros(len(p))
                for off in offs:
                    cp = np.maximum(cp, np.exp(-((al - off - 0.4 * bend) / 0.00065) ** 2))
                cp *= (back < -0.25 * half) * across ** 0.5
                col *= (1 - 0.8 * CREASE * cp)[:, None]
                h -= cp * 0.00010
                # the pads between the creases catch a little light
                pad = (back < -0.3 * half) * across * np.exp(-((al - 0.5 * L) / (0.25 * L)) ** 2)
                col *= (1 + 0.03 * pad)[:, None]
            rgb[idx] = col
            height[idx] = h
        # the palm and the back of the hand
        m = (pname == "arm" + S) & (pos[..., 1] < bd.Y(P, 0.482))
        if m.any():
            idx = np.nonzero(m)
            p = pos[idx]
            col = rgb[idx]
            h = height[idx]
            xo = (p[:, 0] - sg * sh) * sg  # + the back of the hand, - the palm
            yk = bd.Y(P, 0.429)
            palm = xo < -0.006 * s
            # three creases across the palm
            # the heart line near the fingers, the head line across, the life line round the thumb's ball
            zz = p[:, 2] / s
            from .paint import _noise3
            wob = _noise3(p, 260.0, 7 if S == "L" else 8) * 0.0012 * s  # lines wander a little
            brk = np.clip(0.75 + 0.5 * _noise3(p, 520.0, 9), 0, 1)  # and break up
            # the heart line: from under the little finger, curving up toward the index; the head line: across from
            # the thumb's web, falling a little; the life line: round the ball of the thumb
            heart = np.abs(p[:, 1] - (yk + (0.014 + 0.10 * (zz + 0.035) + 3.0 * (zz + 0.01) ** 2) * s) + wob)
            heart += 1.0 * (zz > 0.022)
            head = np.abs(p[:, 1] - (yk + (0.030 + 0.13 * (zz + 0.02) - 2.0 * (zz - 0.01) ** 2) * s) + wob)
            head += 1.0 * ((zz < -0.024) | (zz > 0.040))
            life = np.abs(np.hypot(p[:, 1] - (yk + 0.075 * s), p[:, 2] - 0.045 * s) - 0.040 * s + wob)
            life += 1.0 * (zz > 0.035)
            for dd, wd in ((heart, 0.0008), (head, 0.0007), (life, 0.0009)):
                cr = palm * np.exp(-(dd / (wd * s)) ** 2) * brk
                h -= cr * 0.00009
                col *= (1 - 0.12 * cr)[:, None]
            # the webs between the fingers' roots, palm and back: in shade
            for f1, f2 in (("index", "middle"), ("middle", "ring"), ("ring", "little")):
                a_ = (np.array(hf[f1][0]) + np.array(hf[f2][0])) / 2
                dw = np.linalg.norm(p - a_, axis=1)
                web = np.clip(1 - dw / (0.010 * s), 0, 1) ** 1.5 * (p[:, 1] < a_[1] + 0.004 * s)
                col *= (1 - 0.14 * web)[:, None]
            # knuckles: a little red and raised
            kn = (xo > 0.006 * s) & (np.abs(p[:, 1] - yk - 0.002 * s) < 0.008 * s)
            kw = np.clip(1 - np.abs(p[kn, 1] - yk) / (0.008 * s), 0, 1)
            col[kn] = col[kn] * (1 - 0.25 * kw[:, None]) + np.array((0.80, 0.50, 0.45)) * 0.25 * kw[:, None]
            # tendons and veins on the back of the hand, and the hard hand's calluses on the palm
            tn = (xo > 0.004 * s) & (p[:, 1] > yk)
            h[tn] += 0.00005 * np.cos(p[tn, 2] * 160) ** 8
            if hard > 0:
                cal = palm & (p[:, 1] < yk + 0.02 * s)
                col[cal] = col[cal] * (1 - 0.3 * hard) + np.array((0.78, 0.66, 0.50)) * 0.3 * hard
            rgb[idx] = col
            height[idx] = h
        # the whole hand a little darker and redder than the arm, fading in over the wrist
        hand = np.char.startswith(pname, "finger_") & np.char.endswith(pname, S)
        armS = pname == "arm" + S
        k_ = np.where(hand, 1.0, np.where(armS, np.clip((yw + 0.012 * s - pos[..., 1]) / (0.024 * s), 0, 1), 0.0))
        k_ = k_ * k_ * (3 - 2 * k_)
        idx = np.nonzero(k_ > 0)
        rgb[idx] = rgb[idx] * (1 - k_[idx][:, None] * (1 - HAND_TINT))
    return rgb, height


def normal_from_height(height, pos, has):
    """A body picture's normal map from a height field through A's position map (slopes on the body)."""
    du = np.linalg.norm(np.gradient(pos, axis=1), axis=-1)
    dv = np.linalg.norm(np.gradient(pos, axis=0), axis=-1)
    dhu = np.gradient(height, axis=1) / np.maximum(du, 1e-5)
    dhv = np.gradient(height, axis=0) / np.maximum(dv, 1e-5)
    edge = (du > 0.01) | (dv > 0.01) | ~has  # across islands the position map jumps: flat there
    dhu[edge] = 0.0
    dhv[edge] = 0.0
    n = np.stack([-dhu, -dhv, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)
