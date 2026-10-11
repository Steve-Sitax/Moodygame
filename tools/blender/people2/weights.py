"""Skin weights by rule (docs/people.md "Weights").

Blender's automatic (bone heat) weights bleed between a hanging arm and the chest beside it and between the thighs,
because the rest pose has the arms down (it must: the old clips need it). So the weights are made here from what
the cage knows about each vertex: its part, its ring along a limb, its angle round the limb, its height on the trunk.
The near copy gets them by the subdivision (smooth by construction); the fingers are then sharpened on the near
copy by their position along each finger.

Joints bend by linear blend skinning. The convex side of a hinge (the back of the elbow, the front of the knee) has a
short blend so it keeps its round; the crease side has a long one so it folds without a pinch.
"""

import math

import numpy as np

from . import body as bd
from .rig import KIND, NAMES

INDEX = {n: i for i, n in enumerate(NAMES)}
FINGER_BONES = {"index": "index", "middle": "middle", "ring": "ring", "little": "ring", "thumb": "thumb"}


def spine_chain(P, y):
    """Trunk weights by height (before the stoop)."""
    Y = lambda f: bd.Y(P, f)
    t1 = bd.smooth(Y(0.565), Y(0.615), y)
    t2 = bd.smooth(Y(0.638), Y(0.682), y)
    t3 = bd.smooth(Y(0.718), Y(0.768), y)
    t4 = bd.smooth(Y(0.828), Y(0.862), y)
    t5 = bd.smooth(Y(0.868), Y(0.900), y)
    return {"hips": 1 - t1, "spine": t1 * (1 - t2), "chest": t2 * (1 - t3), "upperChest": t3 * (1 - t4),
            "neck": t4 * (1 - t5), "head": t5}


def _take(w, frac, into):
    """Move a share of every weight in w into the bone `into`."""
    if frac <= 0:
        return
    for k in list(w):
        w[k] *= (1 - frac)
    w[into] = w.get(into, 0.0) + frac


def cage_weights(C, P):
    """A (vertices x 60) weight matrix for the cage."""
    n = len(C.rest)
    W = np.zeros((n, len(NAMES)))
    Y = lambda f: bd.Y(P, f)
    y_el, y_wr = Y(0.630), Y(0.486)
    for i, (p, part, tag) in enumerate(zip(C.rest, C.part, C.tag)):
        x, y, z = p
        S = "L" if x > 0 else "R"
        w = {}
        if part in ("torso", "neck", "head"):
            w = spine_chain(P, y)
            if part == "head":
                ring = tag["ring"] if "ring" in tag else 99
                col = tag.get("col", 8)
                c = min(col, 16 - col) if col >= 0 else 8
                front = 1.0 if c <= 3 else 0.4 if c == 4 else 0.0
                jf = {0: 0.45, 1: 0.95, 2: 0.85, 3: 0.3}.get(ring, 0.0) * front
                _take(w, jf, "jaw")
            if part == "torso" and tag.get("crotch"):
                w = {"hips": 0.6, "legUpL": 0.2, "legUpR": 0.2}
            elif part == "torso":
                row, col = tag["row"], tag["col"]
                c = min(col, 16 - col)  # 0 front .. 8 back, by side
                # the legs pull on the bottom of the trunk
                if row == 0:
                    _take(w, 0.5 if c < 6 else 0.36, "legUp" + S if c not in (0, 8) else "hips")
                    if c in (0, 8):
                        w = {"hips": 0.64, "legUpL": 0.18, "legUpR": 0.18}
                elif row == 1 and 1 < c < 8:
                    _take(w, 0.14, "legUp" + S)
                # the shoulders
                sw = {(9, 3): (0.30, 0.45), (9, 4): (0.32, 0.45), (9, 5): (0.30, 0.45),
                      (8, 3): (0.32, 0.12), (8, 5): (0.32, 0.12),
                      (7, 3): (0.22, 0.04), (7, 4): (0.24, 0.04), (7, 5): (0.22, 0.04),
                      (9, 2): (0.07, 0.34), (9, 6): (0.07, 0.34), (8, 2): (0.07, 0.06), (8, 6): (0.07, 0.06),
                      (7, 2): (0.05, 0.0), (7, 6): (0.05, 0.0), (6, 3): (0.05, 0.0), (6, 4): (0.06, 0.0),
                      (6, 5): (0.05, 0.0), (9, 1): (0.0, 0.18), (9, 7): (0.0, 0.18)}.get((row, c))
                if sw and c not in (0, 8):
                    au, cl = sw
                    _take(w, cl, "clavicle" + S)
                    _take(w, au, "armUp" + S)
            if part == "neck" and tag.get("ring") == 0:
                col = tag["col"]
                c = min(col, 16 - col)
                if 2 <= c <= 6:
                    _take(w, 0.14, "clavicle" + S)
        elif part.startswith("arm"):
            S = part[-1]
            ring, j = tag["ring"], tag["col"]
            ang = math.radians(45 * j)
            outer = (1 + math.sin(ang)) / 2
            back = (1 - math.cos(ang)) / 2
            if ring in ("d1", "d2"):
                au = 0.6 if ring == "d1" else 0.86
                rest = 1 - au
                chain = spine_chain(P, y)
                w = {k: v * rest * (1 - outer) for k, v in chain.items()}
                w["clavicle" + S] = rest * outer
                w["armUp" + S] = au
            else:
                front_w = {"a4": 0.10, "e1": 0.30, "e2": 0.56, "e3": 0.86}
                back_w = {"a4": 0.0, "e1": 0.03, "e2": 0.38, "e3": 0.97}
                if ring in ("a2", "a3"):
                    low = 0.0
                elif ring in front_w:
                    low = front_w[ring] * (1 - back) + back_w[ring] * back
                else:
                    low = 1.0
                hand = {"w1": 0.14, "w2": 0.5, "p0": 0.93}.get(ring, 1.0 if ring in ("p1", "p2") else 0.0)
                u = min(1.0, max(0.0, (y_el - y) / (y_el - y_wr)))
                tw = low * (1 - hand) * u
                w = {"armUp" + S: 1 - low, "armLow" + S: low * (1 - hand) * (1 - u), "armTwist" + S: tw,
                     "hand" + S: low * hand}
        elif part.startswith("finger_"):
            S = part[-1]
            fname = part[len("finger_"):-1]
            k = tag["ring"]
            b = FINGER_BONES[fname]
            if fname == "thumb":
                table = [{"hand": 1.0}, {"hand": 0.6, "1": 0.4}, {"1": 0.5, "2": 0.5}, {"2": 0.5, "3": 0.5},
                         {"3": 1.0}]
            else:
                table = [{"hand": 1.0}, {"hand": 0.5, "1": 0.5}, {"1": 0.5, "2": 0.5}, {"2": 0.5, "3": 0.5},
                         {"3": 1.0}]
            t = table[min(k, len(table) - 1)]
            w = {("hand" + S if kk == "hand" else b + kk + S): vv for kk, vv in t.items()}
        elif part.startswith("leg"):
            S = part[-1]
            ring, j = tag["ring"], tag["col"]
            ang = math.radians(90 + (j - 4) * 36)
            front = (1 + math.cos(ang)) / 2
            if ring == "l1":
                w = {"hips": 0.16, "legUp" + S: 0.84}
            elif ring in ("l2",):
                w = {"legUp" + S: 1.0}
            elif ring in ("l3", "k1", "k2", "k3"):
                fw = {"l3": 0.0, "k1": 0.05, "k2": 0.45, "k3": 0.95}[ring]
                bw = {"l3": 0.10, "k1": 0.30, "k2": 0.55, "k3": 0.80}[ring]
                low = fw * front + bw * (1 - front)
                w = {"legUp" + S: 1 - low, "legLow" + S: low}
            elif ring in ("c1", "c2", "c3", "t1"):
                ft = {"c1": 0.0, "c2": 0.0, "c3": 0.0, "t1": 0.04}[ring]
                kb = 0.0 if ring != "c1" else 0.06 * (1 - front)
                w = {"legUp" + S: kb, "legLow" + S: (1 - kb) * (1 - ft), "foot" + S: ft}
            elif ring == "t2":
                w = {"legLow" + S: 0.62, "foot" + S: 0.38}
            elif ring == "heel":
                bk = 1 - front
                fo = 0.8 + 0.2 * bk
                w = {"legLow" + S: 1 - fo, "foot" + S: fo}
            elif ring == "f1":
                w = {"foot" + S: 1.0}
            elif ring == "f2":
                w = {"foot" + S: 0.55, "toe" + S: 0.45}
            else:
                w = {"toe" + S: 1.0}
        tot = sum(w.values())
        for k, v in w.items():
            if v > 1e-6:
                W[i, INDEX[k]] += v / tot
    return W


def finger_rule(co, fparts, J, P):
    """Sharper weights for the finger vertices of the near copy: by where each vertex sits along its finger.
    co: (n, 3) game space; fparts: per vertex the finger part name or None; J: rig joints. Returns {vertex: {bone: w}}."""
    out = {}
    half = 0.0035 * P["w"]
    for i, part in enumerate(fparts):
        if not part:
            continue
        S = part[-1]
        fname = part[len("finger_"):-1]
        b = FINGER_BONES[fname]
        if fname == "little":
            # its own joints are not bones: use the ring chain's bones but the little finger's own lengths
            chain = [J["ring1" + S][0], J["ring2" + S][0], J["ring3" + S][0], J["ring3" + S][1]]
            hf = bd.hand_frame(P, S)["little"]
            pts = [np.array(q) for q in hf]
        else:
            pts = [J[b + "1" + S][0], J[b + "2" + S][0], J[b + "3" + S][0], J[b + "3" + S][1]]
        p = co[i]
        # parameter along the polyline
        best, arg = 1e9, (0, 0.0)
        for k in range(3):
            a, c = pts[k], pts[k + 1]
            d = c - a
            t = float(np.clip(np.dot(p - a, d) / np.dot(d, d), -0.6 if k == 0 else 0.0, 1.0 if k < 2 else 1.6))
            dist = np.linalg.norm(a + d * t - p)
            if dist < best:
                best, arg = dist, (k, t)
        k, t = arg
        L = np.linalg.norm(pts[k + 1] - pts[k])
        s = t * L  # metres from this segment's start joint
        names = ["hand" + S, b + "1" + S, b + "2" + S, b + "3" + S]
        w = {}
        if k == 0 and s < 0:
            u = bd.smooth(-half, half, s)
            w = {names[0]: 1 - u, names[1]: u}
        else:
            # near the start joint of segment k: blend with the bone before
            u = bd.smooth(-half, half, s)
            w = {names[k]: 1 - u, names[k + 1]: u}
            # near the end joint: blend with the next bone
            if k < 2:
                e = s - L
                v = bd.smooth(-half, half, e)
                if v > 0:
                    w = {names[k + 1]: 1 - v, names[k + 2]: v}
        out[i] = w
    return out


def apply(ob, W, limit=4):
    """Write a weight matrix into vertex groups (named after the bones), at most `limit` bones a vertex, normalised.
    Sockets get no group."""
    for n in NAMES:
        if KIND[n] == "socket":
            continue
        if n not in ob.vertex_groups:
            ob.vertex_groups.new(name=n)
    Wl = limit_weights(W, limit)
    for b, n in enumerate(NAMES):
        if KIND[n] == "socket":
            continue
        vg = ob.vertex_groups[n]
        idx = np.nonzero(Wl[:, b] > 1e-5)[0]
        for i in idx:
            vg.add([int(i)], float(Wl[i, b]), "REPLACE")


def limit_weights(W, limit=4):
    W = W.copy()
    if limit:
        order = np.argsort(-W, axis=1)
        for i in range(W.shape[0]):
            W[i, order[i, limit:]] = 0.0
    s = W.sum(axis=1, keepdims=True)
    s[s == 0] = 1.0
    W = W / s
    W[W < 1e-4] = 0.0
    s = W.sum(axis=1, keepdims=True)
    s[s == 0] = 1.0
    return W / s


def read(ob):
    """The bone weight matrix of a mesh object (vertices x 60)."""
    W = np.zeros((len(ob.data.vertices), len(NAMES)))
    gi = {g.index: g.name for g in ob.vertex_groups}
    for v in ob.data.vertices:
        for g in v.groups:
            n = gi[g.group]
            if n in INDEX:
                W[v.index, INDEX[n]] = g.weight
    return W


def parts(ob):
    """Per vertex the part with the largest part_ group weight."""
    gi = {g.index: g.name[5:] for g in ob.vertex_groups if g.name.startswith("part_")}
    out = []
    for v in ob.data.vertices:
        best, bp = -1.0, None
        for g in v.groups:
            if g.group in gi and g.weight > best:
                best, bp = g.weight, gi[g.group]
        out.append(bp)
    return out
