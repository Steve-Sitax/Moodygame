"""Back alleys (Steve, 2026-09-25, with a painted map of the town: courtyards, gardens and narrow
lanes inside the blocks; "especially the back alleys and the wall around the city are the most work").

plan.py cuts each block into house plots along its streets and fills the rest with one low back mass.
In the big blocks that mass was a flat-roofed slab up to 240 m long. Here it becomes what old Antwerp
had behind its street fronts: gangen (narrow alleys) lined with rows of small one- and two-storey
cottages (the beluiken of the poor), yards behind them, and a garden with a tree here and there.
Each alley reaches the street through a passage between two front houses: those two give up a metre
each on that side (never a house anyone in Steve's save lives in, nor a house whose inside stands in
the world; their doors stay where they are).

The house list keeps every index it had (saves, shared/inworld_houses.json and the town's homes point
at houses by index): a back mass that becomes an alley keeps its index as the alley's first cottage,
the other cottages go on the end of the list. Its own dice (ALLEY_SEED), so the plan's other draws
stay as they were.
"""

import math
import random

import shapely
from shapely.geometry import Point, Polygon, box
from shapely.ops import unary_union

ALLEY_SEED = 18731
MIN_AREA = 500.0  # back masses smaller than this stay as they are
LANE = 2.4  # an alley's width
PASS = 2.2  # the passage between two front houses
COT_DEPTH = 5.5
COT_W = (4.2, 5.4)
SPINE_PITCH = 26.0  # one alley along the block per this much depth
PASS_EVERY = 40.0  # a passage to the street per this much length
GROUND_H, STOREY_H = 3.8, 3.0

# houses people live in in Steve's save (data/game.sqlite, 2026-09-25): their doors must not move
LIVED_IN = {10, 11, 12, 27, 28, 29, 30, 31, 36, 37, 38, 39, 43, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92,
            93, 94, 95, 97, 98, 101, 104, 106, 107, 120, 121, 122, 123, 124, 139, 169, 191, 208, 314, 315, 316, 317, 318, 320, 321,
            323, 324, 327, 328, 329, 330, 339, 342, 346, 420, 421, 422, 425, 426, 427, 432, 447, 456, 458, 459, 462, 466, 467, 468,
            469, 470, 472, 473, 474, 475, 476, 477, 478, 479, 482, 489, 490, 491, 492, 493, 494, 496, 498, 504, 506, 521, 583, 600,
            601, 602, 603, 604, 605, 609, 610, 611, 619, 645, 646, 650, 659}


def pieces(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]


def rect_poly(h):
    (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
    return Polygon([(ox + ux * s + nx * t, oz + uz * s + nz * t) for s, t in ((h["s"][0], h["t"][0]), (h["s"][1], h["t"][0]), (h["s"][1], h["t"][1]), (h["s"][0], h["t"][1]))])


def solid_of(h):
    return rect_poly(h) if h["rect"] else Polygon(h["fp"]).buffer(0)


class Frame:
    """a along the back mass's long side, b across; both world axes (the blocks are square to them)."""

    def __init__(self, P):
        x0, z0, x1, z1 = P.bounds
        self.along_x = (x1 - x0) >= (z1 - z0)
        self.A = (x0, x1) if self.along_x else (z0, z1)
        self.B = (z0, z1) if self.along_x else (x0, x1)

    def rect(self, a0, a1, b0, b1):
        a0, a1 = min(a0, a1), max(a0, a1)
        b0, b1 = min(b0, b1), max(b0, b1)
        return box(a0, b0, a1, b1) if self.along_x else box(b0, a0, b1, a1)

    def pt(self, a, b):
        return (a, b) if self.along_x else (b, a)

    def ea(self):
        return (1.0, 0.0) if self.along_x else (0.0, 1.0)

    def eb(self):
        return (0.0, 1.0) if self.along_x else (1.0, 0.0)


def cottage(bi, frame, a0, a1, b_face, side, depth, rng, row):
    """A rect house on the alley: its front on the lane at b_face, going `side` (+1/-1 along b) away from it."""
    ea, eb = frame.ea(), frame.eb()
    # u along the lane, n into the plot (away from the lane); u x n must match plan.py (inside to the left)
    n = (eb[0] * side, eb[1] * side)
    u = (n[1], -n[0])  # n is u turned left
    # the corner o: s from 0 along u covers a0..a1
    ua = u[0] * ea[0] + u[1] * ea[1]  # +1 or -1: u along +a or -a
    start = a0 if ua > 0 else a1
    ox, oz = frame.pt(start, b_face)
    w = a1 - a0
    st = rng.choices([1, 2], weights=[45, 55])[0]
    return {
        "b": bi, "rect": True, "alley": True,
        "fp": [[round(v, 2) for v in p] for p in list(frame.rect(a0, a1, b_face, b_face + side * depth).exterior.coords)[:-1]],
        "o": [round(ox, 2), round(oz, 2)], "u": [round(u[0], 5), round(u[1], 5)], "n": [round(n[0], 5), round(n[1], 5)],
        "s": [0.0, round(w, 2)], "t": [0.0, round(depth, 2)],
        "h": round(GROUND_H + STOREY_H * (st - 1), 2), "st": st,
        "roof": "side", "gable": "none", "pitch": round(rng.uniform(40, 48), 1),
        "style": row["style"], "tint": round(row["tint"] * rng.uniform(0.95, 1.05), 3),
        "roofMat": row["roofMat"], "seed": rng.randrange(1 << 30),
    }


def plan_alleys(houses, planned, protect=frozenset()):
    """Turn the big back masses into alleys. Changes houses in place (trims, the back masses) and
    appends the cottages. Returns the open ground it made: lanes, passages, yards, gardens, trees."""
    rng = random.Random(ALLEY_SEED)
    keep = set(LIVED_IN) | set(protect)
    solids = [solid_of(h) for h in houses]
    tree = shapely.STRtree(solids)
    planned_u = unary_union(planned)
    backs = [i for i, h in enumerate(houses) if h.get("back") and Polygon(h["fp"]).area >= MIN_AREA]
    back_polys = {i: Polygon(houses[i]["fp"]).buffer(0) for i in backs}
    out = {"lanes": [], "passages": [], "yards": [], "gardens": [], "trees": [], "cottages": 0, "trimmed": []}
    appended = []

    def try_passage(frame, a_p, b_start, direction, P):
        """A passage at a_p from P's edge (b_start) outward along b (direction +1/-1) to the street or into
        another back mass. Returns (rect, trims) or None. trims: [(house index, key, value)]."""
        b = b_start
        end = None
        for _ in range(160):
            b += direction * 0.5
            x, z = frame.pt(a_p, b)
            q = Point(x, z)
            inside_block = planned_u.contains(q)
            other_back = any(j != cur and back_polys[j].contains(q) for j in backs)
            if not inside_block or other_back:
                end = b + direction * (0.6 if not inside_block else 1.5)
                break
        if end is None:
            return None
        r = frame.rect(a_p - PASS / 2, a_p + PASS / 2, b_start - direction * 0.8, end)
        trims = []
        for j in tree.query(r):
            j = int(j)
            if j == cur or j in backs:
                continue
            inter = solids[j].intersection(r).area
            if inter < 0.01:
                continue
            h = houses[j]
            if j in keep or not h["rect"] or h.get("store"):
                return None
            (ox, oz), (ux, uz) = h["o"], h["u"]
            ea = frame.ea()
            if abs(ux * ea[0] + uz * ea[1]) < 0.99:
                return None  # the passage would run along this house, not through a party wall
            # the passage's span in this house's s
            ca = (ox if frame.along_x else oz)
            sg = ux * ea[0] + uz * ea[1]
            p0, p1 = sorted(((a_p - PASS / 2 - ca) * sg, (a_p + PASS / 2 - ca) * sg))
            s0, s1 = h["s"]
            if p0 <= s0 + 0.01 and s1 - p1 >= 3.0:
                trims.append((j, "s", [round(math.ceil(p1 * 100) / 100, 2), s1]))
            elif p1 >= s1 - 0.01 and p0 - s0 >= 3.0:
                trims.append((j, "s", [s0, round(math.floor(p0 * 100) / 100, 2)]))
            else:
                return None
        # two trims at most, and one house trimmed only once
        if len(trims) > 4 or len({t[0] for t in trims}) != len(trims):
            return None
        return r, trims

    trimmed = set()
    for cur in backs:
        h0 = houses[cur]
        P = back_polys[cur]
        f = Frame(P)
        A0, A1 = f.A
        B0, B1 = f.B
        L, D = A1 - A0, B1 - B0
        k = max(1, int(D // SPINE_PITCH))
        spines = [B0 + D * (i + 0.5) / k for i in range(k)]
        passages = []  # (rect, a or b position, kind)
        lanes = []
        # passages out of the long sides, each joined to the nearest alley by a lane
        m = max(1, round(L / PASS_EVERY))
        for side, b_edge, sp in ((-1, B0, spines[0]), (1, B1, spines[-1])):
            for i in range(m):
                target = A0 + L * (i + 0.5) / m
                best = None
                for d in sorted((x * 0.25 for x in range(-56, 57)), key=abs):
                    a_p = target + d
                    if a_p < A0 + 3 or a_p > A1 - 3:
                        continue
                    # where P's edge is at this a (the plots' backs are not straight)
                    line = shapely.geometry.LineString([f.pt(a_p, sp), f.pt(a_p, b_edge + side * 30)])
                    cut = line.intersection(P)
                    if cut.is_empty:
                        continue
                    far = max((c[1] if f.along_x else c[0]) * side for g in getattr(cut, "geoms", [cut]) for c in g.coords) * side
                    res = try_passage(f, a_p, far, side, P)
                    if res and not any(t[0] in trimmed for t in res[1]):
                        best = (a_p, far, res)
                        break
                if best:
                    a_p, far, (r, trims) = best
                    passages.append(r)
                    for j, key, val in trims:
                        houses[j][key] = val
                        trimmed.add(j)
                        solids[j] = rect_poly(houses[j])
                        houses[j]["fp"] = [[round(x, 2), round(z, 2)] for x, z in list(solids[j].exterior.coords)[:-1]]
                        out["trimmed"].append(j)
                    lanes.append(f.rect(a_p - LANE / 2, a_p + LANE / 2, sp, far + side * 0.5))
        # passages out of the short ends, in line with the alleys
        for side, a_edge in ((-1, A0), (1, A1)):
            for sp in spines:
                best = None
                for d in sorted((x * 0.25 for x in range(-4, 5)), key=abs):
                    b_p = sp + d
                    if b_p < B0 + 2 or b_p > B1 - 2:
                        continue
                    line = shapely.geometry.LineString([f.pt(A0 + L / 2, b_p), f.pt(a_edge + side * 30, b_p)])
                    cut = line.intersection(P)
                    if cut.is_empty:
                        continue
                    far = max((c[0] if f.along_x else c[1]) * side for g in getattr(cut, "geoms", [cut]) for c in g.coords) * side
                    # the same search, the frame turned: along b now
                    g2 = Frame.__new__(Frame)
                    g2.along_x = not f.along_x
                    g2.A, g2.B = f.B, f.A
                    res = try_passage(g2, b_p, far, side, P)
                    if res and not any(t[0] in trimmed for t in res[1]):
                        best = (b_p, far, res)
                        break
                if best:
                    b_p, far, (r, trims) = best
                    passages.append(r)
                    for j, key, val in trims:
                        houses[j][key] = val
                        trimmed.add(j)
                        solids[j] = rect_poly(houses[j])
                        houses[j]["fp"] = [[round(x, 2), round(z, 2)] for x, z in list(solids[j].exterior.coords)[:-1]]
                        out["trimmed"].append(j)
                    # (in line with the alley: the alley's own lane runs on to the passage)
                    lanes.append(f.rect(far + side * 0.5, far - side * 4.0, b_p - LANE / 2, b_p + LANE / 2))
        if not passages:
            continue  # no way in: the back mass stays
        # the alleys along the block, and between them lanes at each passage
        for sp in spines:
            lanes.append(f.rect(A0 - 1, A1 + 1, sp - LANE / 2, sp + LANE / 2))
        if k > 1:
            for i in range(max(1, round(L / PASS_EVERY))):
                a_c = A0 + L * (i + 0.5) / max(1, round(L / PASS_EVERY))
                lanes.append(f.rect(a_c - LANE / 2, a_c + LANE / 2, spines[0], spines[-1]))
        lane_u = unary_union(lanes).intersection(P.buffer(0.01))
        # the cottages: rows on both sides of each alley, a gap now and then to the yards behind
        inner = P.buffer(-0.25, join_style=2)
        cots = []
        for sp in spines:
            for side in (-1, 1):
                b_face = sp + side * LANE / 2
                row = {"style": rng.choice(["plaster", "plaster", "brick", "brick_dark", "plaster_grey"]),
                       "tint": rng.uniform(0.9, 1.05), "roofMat": rng.choices(["tile", "slate"], weights=[75, 25])[0]}
                a = A0 + 0.5
                run = 0
                while a < A1 - 4:
                    w = rng.uniform(*COT_W)
                    if run >= rng.choice([4, 5, 6]):
                        a += 2.2  # a gap to the yards
                        run = 0
                        continue
                    r = f.rect(a, a + w, b_face, b_face + side * COT_DEPTH)
                    if inner.contains(r) and not r.intersects(lane_u.buffer(-0.05)) and not any(r.buffer(-0.05).intersects(c) for c in cots):
                        cots.append(r)
                        houses_add = cottage(h0["b"], f, a, a + w, b_face, side, COT_DEPTH, rng, row)
                        appended.append(houses_add)
                        run += 1
                        a += w
                    else:
                        a += 0.5
                        run = 0
        if not cots:
            continue
        out["cottages"] += len(cots)
        # the back mass's own index goes to the first cottage of this alley
        first = appended.pop(len(appended) - len(cots))
        houses[cur] = first
        solids[cur] = rect_poly(first)
        rest = P.difference(lane_u).difference(unary_union(cots).buffer(0.01))
        cot_u = unary_union(cots)
        out["lanes"].append(lane_u.union(unary_union(passages)))
        out["passages"].extend(passages)
        for y in pieces(rest.buffer(-0.01).buffer(0.01)):
            if y.area < 4:
                continue
            # a yard next to the houses (packed earth), a garden further in (grass and a tree)
            near = y.intersection(cot_u.buffer(2.0, join_style=2).union(lane_u.buffer(1.0, join_style=2)))
            garden = y.difference(near.buffer(0.01))
            out["yards"].append(y.difference(garden) if not garden.is_empty else y)
            for g in pieces(garden):
                if g.area < 30:
                    out["yards"].append(g)
                    continue
                out["gardens"].append(g)
                ntree = min(4, int(g.area // 90))
                for _ in range(ntree):
                    x0, z0, x1, z1 = g.bounds
                    for _ in range(20):
                        p = Point(rng.uniform(x0, x1), rng.uniform(z0, z1))
                        if g.buffer(-2.2).contains(p) and all(math.hypot(p.x - t[0], p.y - t[1]) > 7 for t in out["trees"]):
                            out["trees"].append([round(p.x, 1), round(p.y, 1)])
                            break
    houses.extend(appended)
    return out
