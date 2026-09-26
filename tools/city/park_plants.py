"""The Stadspark's planting and ground (tools/city/park.py --plants; the park pass, 2026-09-26).

Reads shared/city.json (decor.park: paths, lines, rounds; the wall's stairs) and
client/public/models/park.json (the park as built_churches.py built it: the railing's ring, the gates,
the pond and its water, the island, the bridge, benches, lanterns, the rocaille). Writes
client/public/models/park_plants.json for world/parkNature.ts:

  trees    [x, z, kind, scale, yaw]            young staked trees in groups, a few old rampart trees,
                                                a weeping willow by the water and on the island, conifers
  plants   [x, z, kind, scale, yaw, y]         shrubs (the border inside the railing, clumps on the lawns
                                                and by the rocks), reeds, bulrushes, sedge and iris at the
                                                water, flowers in the beds, lily pads (y: their foot)
  hedge    [x0, z0, x1, z1, h, w]              the clipped privet inside the railing and the low box round
                                                the beds, in pieces of about a metre
  birds    [[x, z, r, kind]]                   circles on open water the ducks and swans swim round
  drift    [[x, z]]                            fallen leaves blown out along the railing's kerb in the street
  ground   {lawn, gravel, mud, bed}: [x0, z0, x1, z1, x2, z2, ...] triangles, y 0: the park's own ground
           (plan.py cuts the park out of the town's ground zones)
  solids   rings (x, z) that are wall in the walk map: trunks, shrubs, the hedge, the beds

All positions are seeded: the same inputs give the same park.
"""
import json
import math
import os
import random

import shapely
import shapely.affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
PARK = os.path.join(ROOT, "client", "public", "models", "park.json")
OUT = os.path.join(ROOT, "client", "public", "models", "park_plants.json")

# how far each kind's trunk or body reaches (m, at scale 1): the solid in the walk map and the room it needs
BODY = {"young_lime": 0.12, "young_maple": 0.12, "young_chestnut": 0.12, "young_elm": 0.12, "old_elm": 0.4, "old_plane": 0.45,
        "old_bare": 0.38, "weeping": 0.2, "conifer": 0.7, "shrub_ever": 0.85, "shrub_holly": 0.6, "shrub_hazel": 0.8,
        "shrub_red": 0.7, "shrub_bare": 0.7}
# crowns (m, at scale 1): trees keep this far apart
CROWN = {"young_lime": 1.3, "young_maple": 1.4, "young_chestnut": 1.5, "young_elm": 1.4, "old_elm": 5.0, "old_plane": 5.0,
         "old_bare": 4.5, "weeping": 2.2, "conifer": 1.2}


def pieces(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]


def tris_of(g, min_area=0.05):
    out = []
    for p in pieces(g.buffer(0)):
        if p.area < min_area:
            continue
        for t in shapely.constrained_delaunay_triangles(p).geoms:
            c = list(t.exterior.coords)[:3]
            out.append([round(v, 3) for xy in c for v in xy])
    return out


def ring_of(p, nd=2):
    return [[round(x, nd), round(z, nd)] for x, z in list(p.exterior.coords)[:-1]]


def main(dry=False):
    city = json.load(open(CITY))
    pk = json.load(open(PARK))
    P = city["decor"]["park"]
    rng = random.Random(1867)

    ring = Polygon(pk["outline"]).buffer(0)
    pond = Polygon(pk["pond"]).buffer(0)  # the bank's outer edge
    water = Polygon(pk["water"]).buffer(0)
    paths = unary_union([Polygon(r).buffer(0) for r in P["paths"]]).intersection(ring)
    lines = [(LineString(L["pts"]), L["w"]) for L in P.get("lines", [])]
    furn = unary_union([Polygon(r).buffer(0) for k in ("benches", "lanterns", "piers", "rocks") for r in pk.get(k, [])])
    rocks = unary_union([Polygon(r).buffer(0) for r in pk.get("rocks", [])])
    b = pk["bridge"]
    bridge = LineString([b["from"], b["to"]])
    stairs = unary_union([Polygon(s[k]).buffer(0) for s in city["decor"]["rampart"].get("stairs", []) for k in ("flight", "landing") if k in s])
    stairs = stairs.intersection(ring.buffer(6))
    island = pk.get("island")
    # the ring's town edges (not along the wall) and the gates
    inner = [tuple(p) for p in city["decor"]["rampart"]["inner_line"]]
    wall_line = LineString(inner + [inner[0]])
    ro = list(ring.exterior.coords)
    town_edges = [(ro[i], ro[i + 1]) for i in range(len(ro) - 1)
                  if wall_line.distance(Point(ro[i])) > 0.05 or wall_line.distance(Point(ro[i + 1])) > 0.05]
    gates = [Point(o[0], o[1]) for o in pk["openings"]]
    # the lovers' places by the ponds (server/src/town/backtown.ts): the first free spot of the four round each
    # pond circle; keep a little room there
    lovers = [Point(px, pz - (pr + 2)) for px, pz, pr in P["ponds"]]

    lawn_free = (ring.difference(pond.buffer(0.3)).difference(paths.buffer(0.2)).difference(furn.buffer(0.6))
                 .difference(stairs.buffer(1.8)).difference(unary_union([g.buffer(3.0) for g in gates]))
                 .difference(unary_union([p.buffer(1.4) for p in lovers])))

    trees, plants, hedge, beds, solids = [], [], [], [], []

    def body_ok(p, r, clear_path):
        if not lawn_free.contains(p.buffer(r)):
            return False
        if paths.distance(p) < clear_path:
            return False
        return True

    def trunk_clear(p, kind, sc):
        for x, z, k2, s2, _ in trees:
            d = math.hypot(p.x - x, p.y - z)
            if d < (CROWN[kind] * sc + CROWN[k2] * s2) * 0.62:
                return False
        for q in plants:
            if q[2] in BODY and math.hypot(p.x - q[0], p.y - q[1]) < BODY[kind] * sc + BODY[q[2]] * q[3] + 0.4:
                return False
        return True

    def add_tree(p, kind, sc, clear_path=1.4):
        if not body_ok(p, max(BODY[kind] * sc, 0.3), clear_path) or not trunk_clear(p, kind, sc):
            return False
        trees.append((round(p.x, 2), round(p.y, 2), kind, round(sc, 3), round(rng.uniform(0, math.tau), 3)))
        r = max(BODY[kind] * sc, 0.2)
        solids.append(ring_of(p.buffer(r, quad_segs=2)))
        return True

    def snap_tree(c, kind, sc, clear_path=1.4, reach=4.0):
        for k in range(160):
            a = k * 2.399
            d = reach * math.sqrt(k / 160)
            p = Point(c[0] + math.cos(a) * d, c[1] + math.sin(a) * d)
            if add_tree(p, kind, sc, clear_path):
                return True
        return False

    def add_plant(p, kind, sc, y=0.0, solid=True, clear_path=0.7, room=None):
        r = BODY.get(kind, 0.3) * sc
        if room is not None:
            if not room.contains(p):
                return False
        elif not body_ok(p, r * 0.8, clear_path):
            return False
        if kind in BODY:
            for x, z, k2, s2, _ in trees:
                if math.hypot(p.x - x, p.y - z) < r + BODY[k2] * s2 + 0.25:
                    return False
            for q in plants:
                if q[2] in BODY and math.hypot(p.x - q[0], p.y - q[1]) < (r + BODY[q[2]] * q[3]) * 0.75:
                    return False
        plants.append([round(p.x, 2), round(p.y, 2), kind, round(sc, 3), round(rng.uniform(0, math.tau), 3), round(y, 3)])
        if solid and kind in BODY:
            solids.append(ring_of(p.buffer(r * 0.8, quad_segs=2)))
        return True

    # ---- the hedge: clipped privet 0.75 m inside the railing, broken at the gates and round the lamps
    hedge_zone = ring.buffer(-0.35).difference(ring.buffer(-1.15))
    keep_out = unary_union([g.buffer(3.2) for g in gates] + [furn.buffer(0.5), paths.buffer(0.3), stairs.buffer(1.5)])
    for a, c in town_edges:
        ln = LineString([a, c])
        L = ln.length
        if L < 1:
            continue
        ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        # inward: the side of the ring's middle
        mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
        nx, nz = -uz, ux
        if not ring.contains(Point(mx + nx * 2, mz + nz * 2)):
            nx, nz = -nx, -nz
        n = max(1, int(L / 1.0))
        for k in range(n):
            s0, s1 = L * k / n, L * (k + 1) / n
            p0 = (a[0] + ux * s0 + nx * 0.75, a[1] + uz * s0 + nz * 0.75)
            p1 = (a[0] + ux * s1 + nx * 0.75, a[1] + uz * s1 + nz * 0.75)
            seg = LineString([p0, p1])
            if seg.buffer(0.45).intersects(keep_out) or not ring.buffer(-0.3).contains(seg):
                continue
            h = 1.0 + 0.12 * math.sin(k * 0.7 + a[0])
            hedge.append([round(p0[0], 2), round(p0[1], 2), round(p1[0], 2), round(p1[1], 2), round(h, 2), 0.85])
            solids.append(ring_of(seg.buffer(0.45, cap_style=2)))
    hedge_geom = unary_union([LineString([(h[0], h[1]), (h[2], h[3])]).buffer(0.45, cap_style=2) for h in hedge])
    lawn_free = lawn_free.difference(hedge_geom.buffer(0.1))

    # ---- the old trees kept from the ramparts: along the old rampart line (the wall side) and one on each lawn
    OLD = [((-345.0, 307.0), "old_elm", 1.15), ((-313.0, 287.0), "old_plane", 1.2), ((-265.0, 296.0), "old_elm", 1.1),
           ((-270.0, 330.0), "old_bare", 1.05), ((-336.0, 314.0), "old_plane", 1.0)]
    for c, kind, sc in OLD:
        snap_tree(c, kind, sc, clear_path=2.0, reach=5.0)
    # ---- young trees in Keilig's loose groups (three to five), and a few on their own
    YOUNG = ["young_lime", "young_maple", "young_chestnut", "young_elm"]
    GROUPS = [((-324.0, 287.0), 4), ((-300.0, 289.0), 3), ((-340.0, 301.0), 3), ((-259.0, 302.0), 3), ((-264.0, 318.0), 4),
              ((-281.0, 318.5), 2), ((-277.0, 297.0), 1), ((-306.0, 293.0), 2), ((-328.0, 318.0), 2), ((-285.0, 331.0), 2),
              ((-262.0, 289.5), 2), ((-315.0, 303.5), 1), ((-298.0, 314.5), 1), ((-275.0, 327.0), 2)]
    for gi, (c, n) in enumerate(GROUPS):
        kinds = rng.sample(YOUNG, 2)
        got = 0
        for k in range(60):
            if got >= n:
                break
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0, 3.8) if k else 0.0
            p = Point(c[0] + math.cos(a) * d, c[1] + math.sin(a) * d)
            if add_tree(p, kinds[0] if rng.random() < 0.65 else kinds[1], rng.uniform(0.85, 1.15)):
                got += 1
    # the weeping willows: by the water on the east pond, and one young on the island
    snap_tree((-279.0, 305.5), "weeping", 0.85, clear_path=1.2, reach=3.0)
    snap_tree((-317.0, 300.8), "weeping", 0.8, clear_path=1.6, reach=3.0)
    # conifers, new and exotic, dark against the autumn: flanking the north gate and at the west lawn
    for c in ((-286.5, 285.5), (-275.8, 286.5), (-347.5, 310.8), (-257.5, 314.0)):
        snap_tree(c, "conifer", rng.uniform(0.85, 1.1), clear_path=1.2, reach=2.5)

    # ---- the shrub border behind the hedge: in stretches, mixed kinds, evergreens most
    BORDER = ["shrub_ever"] * 4 + ["shrub_holly"] * 2 + ["shrub_hazel"] * 2 + ["shrub_red", "shrub_bare", "shrub_bare"]
    for ei, (a, c) in enumerate(town_edges):
        L = math.hypot(c[0] - a[0], c[1] - a[1])
        ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
        nx, nz = -uz, ux
        if not ring.contains(Point(mx + nx * 2, mz + nz * 2)):
            nx, nz = -nx, -nz
        s = 1.0
        while s < L - 1.0:
            stretch = 0.5 + 0.5 * math.sin(s * 0.19 + ei * 1.7) * math.cos(s * 0.07 + ei)
            if stretch > 0.38:
                inset = rng.uniform(1.9, 2.9)
                p = Point(a[0] + ux * s + nx * inset, a[1] + uz * s + nz * inset)
                add_plant(p, rng.choice(BORDER), rng.uniform(0.8, 1.2), clear_path=0.8)
            s += rng.uniform(1.3, 2.0)
    # ---- clumps: azaleas and rhododendrons round the rocaille; a few on the lawns and by the water
    for r in pk.get("rocks", []):
        c = Polygon(r).centroid
        for k in range(10):
            a = rng.uniform(0, math.tau)
            p = Point(c.x + math.cos(a) * rng.uniform(1.5, 2.6), c.y + math.sin(a) * rng.uniform(1.5, 2.6))
            add_plant(p, rng.choice(["shrub_red", "shrub_ever", "shrub_red"]), rng.uniform(0.7, 0.95), clear_path=0.5)
    CLUMPS = [((-333.0, 297.5), 3), ((-293.0, 283.5), 2), ((-269.5, 291.0), 3), ((-261.0, 325.0), 3), ((-297.5, 320.0), 2),
              ((-322.5, 309.0), 2), ((-271.0, 312.5), 2), ((-309.0, 295.0), 2), ((-284.0, 296.0), 2)]
    for c, n in CLUMPS:
        got = 0
        for k in range(40):
            if got >= n:
                break
            a = rng.uniform(0, math.tau)
            d = rng.uniform(0, 2.2) if k else 0.0
            if add_plant(Point(c[0] + math.cos(a) * d, c[1] + math.sin(a) * d), rng.choice(BORDER), rng.uniform(0.8, 1.15), clear_path=0.9):
                got += 1

    # (the beds keep off the trees and shrubs already standing)
    lawn_free = lawn_free.difference(unary_union([Point(x, z).buffer(max(BODY[k] * sc, 0.3) + 0.5) for x, z, k, sc, _ in trees]
                                                 + [Point(q[0], q[1]).buffer(BODY.get(q[2], 0.3) * q[3] + 0.3) for q in plants]))
    # ---- flower beds: an oval by the north gate's walk, a round one on the east lawn; dug over for the winter
    # but for a few late asters and chrysanthemums; a low box edging round each
    for (cx, cz), rx, rz, rot in (((-296.5, 285.5), 2.6, 1.5, 0.35), ((-265.0, 309.0 + 5.0), 1.8, 1.8, 0.0)):
        e = shapely.affinity.rotate(shapely.affinity.scale(Point(cx, cz).buffer(1.0, quad_segs=10), rx, rz), rot, use_radians=True)
        if not lawn_free.contains(e.buffer(0.6)):
            # slide it a little until it fits
            ok = False
            for k in range(60):
                a = k * 2.399
                d = 4.0 * math.sqrt(k / 60)
                e2 = shapely.affinity.translate(e, math.cos(a) * d, math.sin(a) * d)
                if lawn_free.contains(e2.buffer(0.6)):
                    e, ok = e2, True
                    break
            if not ok:
                continue
        beds.append(e)
        cs = list(e.exterior.coords)
        for (x0, z0), (x1, z1) in zip(cs, cs[1:]):
            hedge.append([round(x0, 2), round(z0, 2), round(x1, 2), round(z1, 2), 0.28, 0.26])
        solids.append(ring_of(e.buffer(0.15)))
        inner_e = e.buffer(-0.4)
        for k in range(int(e.area * 1.6)):
            mnx, mnz, mxx, mxz = inner_e.bounds
            p = Point(rng.uniform(mnx, mxx), rng.uniform(mnz, mxz))
            if inner_e.contains(p):
                plants.append([round(p.x, 2), round(p.y, 2), "flowers" if rng.random() < 0.55 else "sedge", round(rng.uniform(0.6, 0.95), 3),
                               round(rng.uniform(0, math.tau), 3), 0.0])
        lawn_free = lawn_free.difference(e.buffer(0.8))
    bed_geom = unary_union(beds) if beds else Polygon()

    # ---- the water's edge: reeds, bulrushes, sedge and iris in stretches, never at the bridge
    wr = list(water.exterior.coords)
    edge = LineString(wr)
    L = edge.length
    s = 0.0
    wall_touch = [Point(p) for p in pk.get("water_wall", [])]
    while s < L:
        p = edge.interpolate(s)
        stretch = 0.5 + 0.5 * math.sin(s * 0.23 + 0.4) * math.cos(s * 0.11 + 1.3)
        near_bridge = bridge.distance(p) < 3.2
        if stretch > 0.4 and not near_bridge:
            q = edge.interpolate(s + 0.01)
            tx, tz = q.x - p.x, q.y - p.y
            tl = math.hypot(tx, tz) or 1
            nx, nz = -tz / tl, tx / tl
            if not water.contains(Point(p.x + nx * 0.5, p.y + nz * 0.5)):
                nx, nz = -nx, -nz
            for _ in range(2 if stretch > 0.75 else 1):
                d = rng.uniform(0.2, 0.9 if stretch > 0.75 else 0.6)
                c = Point(p.x + nx * d + rng.uniform(-0.3, 0.3), p.y + nz * d + rng.uniform(-0.3, 0.3))
                if not water.buffer(-0.12).contains(c) or bridge.distance(c) < 3.0:
                    continue
                u = rng.random()
                kind = "reed" if u < 0.45 else ("cattail" if u < 0.75 else ("iris" if u < 0.87 else "sedge"))
                plants.append([round(c.x, 2), round(c.y, 2), kind, round(rng.uniform(0.6, 0.95), 3), round(rng.uniform(0, math.tau), 3), -0.36])
            # sedge on the bank itself
            if rng.random() < 0.35:
                d_in = rng.uniform(0.1, 0.35)
                c = Point(p.x - nx * d_in, p.y - nz * d_in)
                if pond.contains(c) and not water.contains(c):
                    # (its foot on the bank's slope: from the lip at about -0.3 at the water up to the lawn's edge 0.45 m back)
                    y_bank = -0.3 + 0.31 * min(water.exterior.distance(c) / 0.45, 1.0)
                    plants.append([round(c.x, 2), round(c.y, 2), "sedge", round(rng.uniform(0.7, 1.1), 3), round(rng.uniform(0, math.tau), 3), round(y_bank, 3)])
        s += rng.uniform(0.65, 1.1)
    # the island: a young weeping willow on it, reeds round it
    if island:
        ic = island["c"]
        land = Polygon(island["land"])
        trees.append((round(ic[0], 2), round(ic[1], 2), "weeping", 0.7, 1.3))
        ring_i = LineString(list(land.exterior.coords))
        for k in range(18):
            p = ring_i.interpolate(ring_i.length * k / 18 + rng.uniform(-0.2, 0.2))
            v = (p.x - ic[0], p.y - ic[1])
            vl = math.hypot(*v) or 1
            d = rng.uniform(0.35, 0.9)
            c = Point(p.x + v[0] / vl * d, p.y + v[1] / vl * d)
            if rng.random() < 0.7 and water.contains(c):
                plants.append([round(c.x, 2), round(c.y, 2), "reed" if rng.random() < 0.6 else "cattail", round(rng.uniform(0.7, 1.05), 3),
                               round(rng.uniform(0, math.tau), 3), -0.36])
        for k in range(4):
            a = rng.uniform(0, math.tau)
            c = Point(ic[0] + math.cos(a) * 0.9, ic[1] + math.sin(a) * 0.9)
            plants.append([round(c.x, 2), round(c.y, 2), "shrub_red" if k == 0 else "sedge", round(rng.uniform(0.55, 0.8), 3),
                           round(rng.uniform(0, math.tau), 3), 0.18])
    # lily pads in a few patches on open water
    open_w = water.buffer(-2.0)
    if island:
        open_w = open_w.difference(Polygon(island["land"]).buffer(1.5))
    open_w = open_w.difference(bridge.buffer(4.0))
    patches = 0
    for k in range(400):
        if patches >= 5:
            break
        mnx, mnz, mxx, mxz = open_w.bounds
        c = Point(rng.uniform(mnx, mxx), rng.uniform(mnz, mxz))
        if not open_w.contains(c):
            continue
        if any(math.hypot(c.x - q[0], c.y - q[1]) < 6 for q in plants if q[2] == "lily"):
            continue
        for j in range(rng.randint(3, 6)):
            a, d = rng.uniform(0, math.tau), rng.uniform(0, 1.3)
            q = Point(c.x + math.cos(a) * d, c.y + math.sin(a) * d)
            if water.buffer(-0.8).contains(q):
                # (each pad a few mm over the last: two in one plane would flicker)
                plants.append([round(q.x, 2), round(q.y, 2), "lily", round(rng.uniform(0.7, 1.2), 3), round(rng.uniform(0, math.tau), 3), round(-0.345 + 0.004 * j, 3)])
        patches += 1
    # the ducks' and swans' rounds on open water
    birds = []
    swim = water.buffer(-1.2)
    if island:
        swim = swim.difference(Polygon(island["land"]).buffer(1.0))
    swim = swim.difference(bridge.buffer(1.5))
    for kind, n, rmin, rmax in (("swan", 2, 2.5, 4.0), ("duck", 3, 1.2, 2.6)):
        for k in range(300):
            if sum(1 for q in birds if q[3] == kind) >= n:
                break
            mnx, mnz, mxx, mxz = swim.bounds
            r = rng.uniform(rmin, rmax)
            c = Point(rng.uniform(mnx, mxx), rng.uniform(mnz, mxz))
            if swim.contains(c.buffer(r)):
                birds.append([round(c.x, 2), round(c.y, 2), round(r, 2), kind])

    # ---- leaves blown out through the railing and drifted along its kerb in the street (the park's rough edge)
    drift = []
    for ei, (a, c) in enumerate(town_edges):
        L = math.hypot(c[0] - a[0], c[1] - a[1])
        ux, uz = (c[0] - a[0]) / L, (c[1] - a[1]) / L
        mx, mz = (a[0] + c[0]) / 2, (a[1] + c[1]) / 2
        nx, nz = -uz, ux
        if ring.contains(Point(mx + nx * 2, mz + nz * 2)):
            nx, nz = -nx, -nz  # outward
        for k in range(int(L * 7)):
            sv = rng.uniform(0, L)
            heap = 0.5 + 0.5 * math.sin(sv * 0.45 + ei * 2.1) * math.cos(sv * 0.17 + ei)
            if rng.random() > heap * heap:
                continue
            o = 0.22 + rng.random() ** 2 * 1.4
            drift.append([round(a[0] + ux * sv + nx * o, 2), round(a[1] + uz * sv + nz * o, 2)])

    # ---- the ground: gravel paths, muddy trodden edges, lawn, the beds' dug earth
    mud_bits = []
    for pc in pieces(paths):
        bl = LineString(list(pc.exterior.coords))
        n = int(bl.length / 0.6)
        for k in range(n):
            p = bl.interpolate(bl.length * k / n)
            wob = 0.5 + 0.5 * math.sin(k * 0.37 + p.x * 0.3) * math.cos(k * 0.13 + p.y * 0.2)
            mud_bits.append(p.buffer(0.12 + 0.55 * wob * rng.uniform(0.6, 1.0), quad_segs=3))
    # in front of each bench and at the gates, where feet wear the grass away
    for r in pk.get("benches", []):
        mud_bits.append(Polygon(r).buffer(0.75, quad_segs=3))
    for g in gates:
        mud_bits.append(g.buffer(2.4, quad_segs=4))
    landings = unary_union([Polygon(s_["landing"]).buffer(0) for s_ in city["decor"]["rampart"].get("stairs", []) if "landing" in s_])
    mud_bits.append(landings.intersection(ring.buffer(3)).buffer(1.3, quad_segs=3))
    mud = unary_union(mud_bits).intersection(ring).difference(paths).difference(pond).difference(bed_geom)
    mud = mud.buffer(-0.02).buffer(0.02).simplify(0.04)
    gravel = paths.difference(pond).simplify(0.03)
    lawn = ring.difference(pond).difference(paths).difference(mud).difference(bed_geom)
    # (the thin strip left between the water and the wall's face: no grass)
    lawn = lawn.buffer(-0.03).buffer(0.03).simplify(0.04)
    # under it all, a hair lower: dark earth, so no crack between two kinds of ground ever shows the sky
    under = ring.difference(pond).buffer(-0.03).buffer(0.03).simplify(0.05)
    ground = {"lawn": tris_of(lawn), "gravel": tris_of(gravel), "mud": tris_of(mud), "bed": tris_of(bed_geom), "under": tris_of(under)}

    out = {
        "about": __doc__.strip().split("\n\n")[0] + " Made by tools/city/park.py --plants (park_plants.py).",
        "trees": trees,
        "plants": plants,
        "hedge": hedge,
        "beds": [ring_of(e) for e in beds],
        "birds": birds,
        "drift": drift,
        "ground": ground,
        "solids": solids,
    }
    kinds = {}
    for t in trees:
        kinds[t[2]] = kinds.get(t[2], 0) + 1
    for q in plants:
        kinds[q[2]] = kinds.get(q[2], 0) + 1
    print(f"[park_plants] {len(trees)} trees, {len(plants)} plants, {len(hedge)} hedge pieces, {len(beds)} beds, {len(birds)} birds, "
          f"{len(solids)} solids; ground {', '.join(f'{k} {len(v)} tris' for k, v in ground.items())}")
    print(f"[park_plants] kinds: {dict(sorted(kinds.items()))}")
    print(f"[park_plants] areas: lawn {lawn.area:.0f} m2, gravel {gravel.area:.0f} m2, mud {mud.area:.0f} m2, beds {bed_geom.area:.0f} m2")
    if not dry:
        with open(OUT, "w", newline="\n") as f:
            json.dump(out, f, separators=(",", ":"))
        print(f"[park_plants] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    return out


if __name__ == "__main__":
    import sys

    main("--dry" in sys.argv)
