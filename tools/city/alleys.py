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
import shapely.ops
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

ALLEY_SEED = 18731
MIN_AREA = 500.0  # (rows) back masses smaller than this stay as they are
ROWS_AREA = 2500.0  # rows of cottages from this size; courts and gangs below it
COURT_MIN = 220.0  # a court from this size


def in_gang_quarter(P):
    """The north-east quarter by the Keizerspoort (Steve: "especially upper left inner courtyards or tiny
    alley like Vlaeykensgang"): courts and gangs there whatever the size."""
    c = P.centroid
    return c.x > 40 and c.y > 230
LANE = 2.4  # an alley's width
PASS = 2.2  # the passage between two front houses
COT_DEPTH = 5.5
COT_W = (4.2, 5.4)
SPINE_PITCH = 26.0  # one alley along the block per this much depth
PASS_EVERY = 40.0  # a passage to the street per this much length
GROUND_H, STOREY_H = 3.8, 3.0

# houses people live in in Steve's save (data/game.sqlite, 2026-09-25): their doors must not move
LIVED_IN = set()  # (Steve, 2026-09-25: the save may go; no door has to stay where it was)


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
    # rows of cottages in the big back masses; the smaller ones, and every one in the north-east quarter,
    # get a court or a gang (plan_courts_gangs)
    backs = [i for i, h in enumerate(houses) if h.get("back") and Polygon(h["fp"]).area >= ROWS_AREA and not in_gang_quarter(Polygon(h["fp"]))]
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


# ---------------------------------------------------------------------------- courts and gangs
GANG_W = 1.8  # a gang: narrow enough to touch both walls
GANG_COT = (3.4, 4.6)  # its houses: one room wide
GANG_DEPTH = 4.6
COURT_RING = 5.5  # the houses round a court
POORT_W = 1.8  # a covered passage under a front house


def _dir(a, b):
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1.0
    return (b[0] - a[0]) / L, (b[1] - a[1]) / L


def _rect(o, u, n, s0, s1, t0, t1):
    return Polygon([(o[0] + u[0] * s + n[0] * t, o[1] + u[1] * s + n[1] * t) for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))])


def small_house(bi, o, u, n, w, depth, rng, row, storeys=None):
    """A rect house: its front from o along u (w long), going n (depth) away from the lane or court."""
    st = storeys or rng.choices([1, 2], weights=[40, 60])[0]
    fp = _rect(o, u, n, 0, w, 0, depth)
    return {
        "b": bi, "rect": True, "alley": True,
        "fp": [[round(v, 2) for v in p] for p in list(fp.exterior.coords)[:-1]],
        "o": [round(o[0], 2), round(o[1], 2)], "u": [round(u[0], 5), round(u[1], 5)], "n": [round(n[0], 5), round(n[1], 5)],
        "s": [0.0, round(w, 2)], "t": [0.0, round(depth, 2)],
        "h": round(GROUND_H + STOREY_H * (st - 1), 2), "st": st,
        "roof": "side", "gable": "none", "pitch": round(rng.uniform(42, 52), 1),
        "style": row["style"], "tint": round(row["tint"] * rng.uniform(0.94, 1.06), 3),
        "roofMat": row["roofMat"], "seed": rng.randrange(1 << 30),
    }


def plan_courts_gangs(houses, planned, al, protect=frozenset()):
    """The back masses plan_alleys left: an inner court with small houses round it (a binnenkoer), or a
    gang, a narrow crooked alley like the Vlaeykensgang: in under a front house by a covered passage (a
    poort), small courts with a pump where it bends, one-room houses both sides. Adds to al."""
    rng = random.Random(ALLEY_SEED + 7)
    planned_u = unary_union(planned)
    solids = [solid_of(h) for h in houses]
    tree = shapely.STRtree(solids)
    backs = [i for i, h in enumerate(houses) if h.get("back") and Polygon(h["fp"]).area >= COURT_MIN]
    back_polys = {i: Polygon(houses[i]["fp"]).buffer(0) for i in backs}
    used = set()  # houses already trimmed or given a poort
    for k in ("pumps", "poorts", "gangs", "courts"):
        al.setdefault(k, [])
    appended = []

    def passage_at(cur, pt, nrm, mode):
        """A way out at pt (on the back mass's edge) along nrm to the street. mode poort: under one front
        house, whose own door stays free; mode trim: between two, each giving up a metre.
        Returns (rect, changes) or None."""
        b = 0.0
        end = None
        for _ in range(80):
            b += 0.5
            q = Point(pt[0] + nrm[0] * b, pt[1] + nrm[1] * b)
            if not planned_u.contains(q):
                end = b + 0.6
                break
            if any(j != cur and back_polys[j].contains(q) for j in backs):
                return None
        if end is None:
            return None
        w = POORT_W if mode == "poort" else PASS
        u = (-nrm[1], nrm[0])
        r = _rect((pt[0] - nrm[0] * 0.8, pt[1] - nrm[1] * 0.8), nrm, u, 0, end + 0.8, -w / 2, w / 2)
        hits = []
        for j in tree.query(r):
            j = int(j)
            if j == cur or j in back_polys:
                continue
            if solids[j].intersection(r).area > 0.05:
                hits.append(j)
        if not hits:
            return None
        changes = []
        for j in hits:
            h = houses[j]
            if j in protect or j in used or not h["rect"] or h.get("store") or h.get("alley"):
                return None
            ux, uz = h["u"]
            if abs(ux * nrm[0] + uz * nrm[1]) > 0.15:
                return None  # the way would run along the house, not through it
            ox, oz = h["o"]
            sc = (pt[0] - ox) * ux + (pt[1] - oz) * uz
            p0, p1 = sc - w / 2, sc + w / 2
            s0, s1 = h["s"]
            if mode == "poort":
                if len(hits) != 1 or p0 < s0 + 0.6 or p1 > s1 - 0.6 or s1 - s0 < 5.5:
                    return None
                W = s1 - s0
                bays = max(1, round(W / 3.0))
                door = s0 + (bays // 2 + 0.5) * W / bays
                if abs(door - (p0 + p1) / 2) < w / 2 + 0.9:
                    return None  # the house's own door is there
                changes.append((j, "poort", {"s": [round(p0, 2), round(p1, 2)], "h": 2.9}))
            else:
                if p0 <= s0 + 0.01 and s1 - p1 >= 3.0:
                    changes.append((j, "s", [round(math.ceil(p1 * 100) / 100, 2), s1]))
                elif p1 >= s1 - 0.01 and p0 - s0 >= 3.0:
                    changes.append((j, "s", [s0, round(math.floor(p0 * 100) / 100, 2)]))
                else:
                    return None
        if len(changes) > 2:
            return None
        return r, changes

    def ways_out(P, cur, mode):
        """Every place round P's edge where a way out works, every metre: (point, normal, rect, changes)."""
        found = []
        ring = shapely.geometry.polygon.orient(P.simplify(0.3), 1.0).exterior
        L = ring.length
        k = 0.5
        while k < L:
            p = ring.interpolate(k)
            a = ring.interpolate(max(0.0, k - 0.5))
            b = ring.interpolate(min(L, k + 0.5))
            tx, tz = _dir((a.x, a.y), (b.x, b.y))
            nrm = (tz, -tx)  # counter-clockwise ring: outward is to the right
            res = passage_at(cur, (p.x, p.y), nrm, mode)
            if res:
                found.append(((p.x, p.y), nrm, res[0], res[1]))
            k += 1.0
        return found

    def apply(changes):
        for j, key, val in changes:
            houses[j][key] = val
            used.add(j)
            if key == "s":
                solids[j] = rect_poly(houses[j])
                houses[j]["fp"] = [[round(x, 2), round(z, 2)] for x, z in list(solids[j].exterior.coords)[:-1]]
                al["trimmed"].append(j)
            else:
                al["poorts"].append(j)

    def row_for():
        return {"style": rng.choice(["plaster", "plaster", "plaster_grey", "brick", "brick_dark"]),
                "tint": rng.uniform(0.88, 1.06), "roofMat": rng.choices(["tile", "slate"], weights=[70, 30])[0]}

    def line_houses(line, lane_w, P, blocked, bi, cots, depth, wr):
        """Small houses along both sides of a polyline, fronts on the lane's edge."""
        row = row_for()
        inside = P.buffer(-0.25, join_style=2)
        pts = list(line.coords)
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            u = _dir(a, b)
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            for side in (1, -1):
                # n away from the lane; u turned so that n is to its left (plan.py's frame)
                n = (-u[1] * side, u[0] * side)
                uu = u if side == 1 else (-u[0], -u[1])
                s = 0.6
                while s < L - 2.5:
                    w = min(rng.uniform(*wr), L - 0.6 - s)
                    if w < 2.8:
                        break
                    start = s if side == 1 else s + w
                    o = (a[0] + u[0] * start + n[0] * lane_w / 2, a[1] + u[1] * start + n[1] * lane_w / 2)
                    r = _rect(o, uu, n, 0, w, 0, depth)
                    if inside.contains(r) and r.intersection(blocked).area < 0.05 and not any(r.buffer(-0.05).intersects(c) for c in cots):
                        cots.append(r)
                        appended.append(small_house(bi, o, uu, n, w, depth, rng, row))
                        s += w
                    else:
                        s += 0.6

    for cur in backs:
        if not houses[cur].get("back"):
            continue
        P = back_polys[cur]
        bi = houses[cur]["b"]
        gang = P.area >= 500 and (in_gang_quarter(P) or rng.random() < 0.5)
        cots, lanes, courts, pumps = [], [], [], []
        outs = ways_out(P, cur, "poort") if gang else []
        outs = outs or ways_out(P, cur, "trim")
        if not outs:
            continue
        if gang:
            # the two ways out furthest apart (a through gang), or one (a dead end in a court)
            best = None
            for i in range(len(outs)):
                for j in range(i + 1, len(outs)):
                    d = math.dist(outs[i][0], outs[j][0])
                    if not outs[i][2].buffer(1.0).intersects(outs[j][2]) and not ({c[0] for c in outs[i][3]} & {c[0] for c in outs[j][3]}) and (best is None or d > best[0]):
                        best = (d, i, j)
            ends = [outs[best[1]], outs[best[2]]] if best and best[0] > 18 else [outs[len(outs) // 2]]
            inner = P.buffer(-3.2, join_style=2)
            if inner.is_empty:
                continue
            e_pts = [(p[0] - n[0] * 1.2, p[1] - n[1] * 1.2) for p, n, _, _ in ends]
            if len(e_pts) == 1:
                c = inner.representative_point()
                e_pts.append((c.x, c.y))
            # bends: one or two points off the straight line, inside the block
            a, b = e_pts
            path = [a]
            nb = rng.choice([1, 2, 2])
            for k in range(1, nb + 1):
                t = k / (nb + 1)
                off = rng.uniform(-0.28, 0.28) * math.dist(a, b)
                d = _dir(a, b)
                q = Point(a[0] + (b[0] - a[0]) * t - d[1] * off, a[1] + (b[1] - a[1]) * t + d[0] * off)
                if not inner.contains(q):
                    q = shapely.ops.nearest_points(inner, q)[0]
                path.append((q.x, q.y))
            path.append(b)
            line = LineString(path)
            lanes.append(line.buffer(GANG_W / 2, join_style=2, mitre_limit=2.0))
            # small courts where it bends, a pump in each (and at a dead end)
            for q in path[1:-1] + ([b] if len(ends) == 1 else []):
                court = Point(q).buffer(3.8, resolution=2).intersection(P.buffer(-1.0))
                if court.area > 12:
                    courts.append(court)
                    pumps.append([round(q[0], 2), round(q[1], 2)])
            blocked = unary_union(lanes + courts + [e[2] for e in ends])
            line_houses(line, GANG_W, P, blocked, bi, cots, GANG_DEPTH, GANG_COT)
            for e in ends:
                apply(e[3])
            al["gangs"].append([[round(x, 2), round(z, 2)] for x, z in path])
        else:
            ends = [outs[len(outs) // 2]]
            e = ends[0]
            court = P.buffer(-COURT_RING, join_style=2).simplify(0.8)
            court = max(pieces(court), key=lambda g: g.area) if not court.is_empty else None
            if court is None or court.area < 40:
                court = P.buffer(-1.2, join_style=2)  # a small yard: no houses round it
                if court.is_empty:
                    continue
                court = max(pieces(court), key=lambda g: g.area)
            else:
                # the way in runs on to the court
                p, n = e[0], e[1]
                far = shapely.ops.nearest_points(court, Point(p))[0]
                lanes.append(LineString([(p[0] + n[0] * 0.5, p[1] + n[1] * 0.5), (far.x - n[0] * 0.5, far.y - n[1] * 0.5)]).buffer(PASS / 2, cap_style=2))
                cring = shapely.geometry.polygon.orient(court, 1.0).exterior
                cs = list(cring.coords)
                row = row_for()
                blocked = unary_union(lanes + [e[2]])
                inside = P.buffer(-0.2, join_style=2)
                for i in range(len(cs) - 1):
                    a, b = cs[i], cs[i + 1]
                    u = _dir(a, b)
                    L = math.hypot(b[0] - a[0], b[1] - a[1])
                    n = (u[1], -u[0])  # out of the court (counter-clockwise ring: to the right)
                    uu = (-u[0], -u[1])  # so that n is to its left
                    s = 0.3
                    while s < L - 3.0:
                        w = min(rng.uniform(4.0, 5.6), L - 0.3 - s)
                        if w < 3.0:
                            break
                        o = (a[0] + u[0] * (s + w), a[1] + u[1] * (s + w))
                        r = _rect(o, uu, n, 0, w, 0, COURT_RING - 0.6)
                        if inside.contains(r) and r.intersection(blocked).area < 0.05 and not any(r.buffer(-0.05).intersects(c) for c in cots):
                            cots.append(r)
                            appended.append(small_house(bi, o, uu, n, w, COURT_RING - 0.6, rng, row, storeys=rng.choice([2, 2, 3])))
                            s += w
                        else:
                            s += 0.6
            courts.append(court)
            c = court.representative_point()
            pumps.append([round(c.x, 2), round(c.y, 2)])
            apply(e[3])
            al["courts"].append([[round(x, 2), round(z, 2)] for x, z in list(court.exterior.coords)[:-1]])
        # the back mass is gone into lanes, courts, small houses and yards: its entry keeps its index as the
        # first new house, or (none built) stays as a nothing the builders and the town skip ("gone")
        opening = unary_union(lanes + courts)
        rest = P.difference(opening).difference(unary_union(cots).buffer(0.01)) if cots else P.difference(opening)
        if gang:
            # (Steve: "inside a gang the ground is weird") the gang is one cobbled way from wall to wall: the
            # strips between its lane and the walls where no small house stands are lane too, not yard
            near = rest.intersection(opening.buffer(3.0, join_style=2))
            lanes.append(near)
            rest = rest.difference(near.buffer(0.01))
        if cots:
            houses[cur] = appended.pop(len(appended) - len(cots))
            solids[cur] = rect_poly(houses[cur])
        else:
            houses[cur] = {**houses[cur], "gone": True}
        al["cottages"] += len(cots)
        al["lanes"].append(unary_union(lanes + [x[2] for x in ends]))
        al["passages"].extend([x[2] for x in ends])
        if not gang:
            al["yards"].extend(courts)  # (a gang's small courts are cobbled like its lane)
        else:
            al["lanes"].append(unary_union(courts))
        al["pumps"].extend(pumps)
        for y in pieces(rest.buffer(-0.01).buffer(0.01)):
            if y.area < 4:
                continue
            (al["gardens"] if y.area > 60 and rng.random() < 0.5 else al["yards"]).append(y)
            if y.area > 90 and rng.random() < 0.6:
                inner_y = y.buffer(-2.0)
                if not inner_y.is_empty:
                    p = inner_y.representative_point()
                    al["trees"].append([round(p.x, 1), round(p.y, 1)])
    houses.extend(appended)
    return al
