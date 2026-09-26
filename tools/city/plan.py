"""Plan the houses of 1873 Antwerp on the traced blocks (shared/city.json).

Old Antwerp was built in narrow plots, 5 to 8 m wide, gable or eaves to the
street, 3 to 5 storeys. We cut each block into such plots along its streets and
fill what is left inside the block with a low back mass. Landmarks get their
exact outline from OpenStreetMap (ODbL, see assets/ATTRIBUTION.md) and are cut
out of the blocks; Blender builds them apart (tools/blender/).

    python tools/city/plan.py

Needs data/osm/antwerp.json (not in git), an Overpass API export:
    [out:json][timeout:170][bbox:51.2175,4.3900,51.2325,4.4100];
    (way["building"];relation["building"];way["highway"];way["natural"="water"];
     relation["natural"="water"];way["waterway"];way["place"="square"];way["historic"];
     way["amenity"="place_of_worship"];way["landuse"];way["area:highway"];);out geom;

Writes shared/city_build.json (read by tools/blender/build_city.py) and adds
landmarks, land triangles and quay edges to shared/city.json (read by the game).
"""

import json
import math
import os
import random

import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box
from shapely.ops import unary_union

import alleys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
BUILD = os.path.join(ROOT, "shared", "city_build.json")
OSM = os.path.join(ROOT, "data", "osm", "antwerp.json")

# landmarks, by OpenStreetMap way id (they stand today as they stood in 1873)
LANDMARKS = {
    "cathedral": 26495164,  # Onze-Lieve-Vrouwekathedraal
    "stadhuis": 22966134,  # town hall, Grote Markt
    "vleeshuis": 179882624,  # butchers' hall
    "steen": 29067925,  # the castle on the river
    "carolus": 39886923,  # Sint-Carolus Borromeus
    "stpaul": 116149697,  # Sint-Pauluskerk
    "stjacob": 40092556,  # Sint-Jacobskerk
}

GROUND_H = 3.8  # ground storey
STOREY_H = 3.0


def world_from_latlon(city, lat, lon):
    f = city["frame"]
    kx = math.cos(math.radians(f["lat0"])) * 111320.0
    e = (lon - f["lon0"]) * kx
    n = (lat - f["lat0"]) * 110574.0
    th = math.radians(f["thetaDeg"])
    de, dn = e - f["originE"], n - f["originN"]
    return (de * math.sin(th) + dn * math.cos(th), de * math.cos(th) - dn * math.sin(th))


def poly_of(d):
    holes = [h for h in d.get("holes", []) if len(h) >= 3]
    if len(d["outer"]) < 3:
        return Polygon()
    return Polygon(d["outer"], holes).buffer(0)


def pieces(g):
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    return [p for p in getattr(g, "geoms", []) if isinstance(p, Polygon)]


def storeys(rng):
    return rng.choices([2, 3, 4, 5], weights=[10, 35, 40, 15])[0]


def plan_block(bi, block, holes_out, public, rng, houses, backs):
    """Cut one block into plots along its outer edges."""
    block = shapely.geometry.polygon.orient(block, 1.0)  # counter-clockwise: inside is to the left
    ring = list(block.exterior.coords)[:-1]
    placed = []
    placed_union = Polygon()
    for i in range(len(ring)):
        p0 = ring[i]
        p1 = ring[(i + 1) % len(ring)]
        dx, dz = p1[0] - p0[0], p1[1] - p0[1]
        L = math.hypot(dx, dz)
        if L < 4.0:
            continue  # short kinks: the plots on the next edges cover them
        ux, uz = dx / L, dz / L
        nx, nz = -uz, ux  # left normal = into the block
        is_public = public.buffer(1.0).contains(Point((p0[0] + p1[0]) / 2 + nx * 3, (p0[1] + p1[1]) / 2 + nz * 3))
        wmin, wmax = (10.0, 18.0) if is_public else (5.0, 8.5)
        n = max(1, round(L / rng.uniform(wmin, wmax)))
        cuts = [0.0]
        for k in range(1, n):
            cuts.append(L * k / n + rng.uniform(-0.6, 0.6))
        cuts.append(L)
        for k in range(n):
            a, b = cuts[k], cuts[k + 1]
            w = b - a
            depth = rng.uniform(14, 22) if is_public else rng.uniform(9, 14)
            ox, oz = p0[0] + ux * a, p0[1] + uz * a
            quad = Polygon([(ox, oz), (ox + ux * w, oz + uz * w), (ox + ux * w + nx * depth, oz + uz * w + nz * depth), (ox + nx * depth, oz + nz * depth)])
            piece = quad.intersection(block).difference(placed_union)
            ps = [p for p in pieces(piece) if p.area > 1]
            if not ps:
                continue
            front_mid = Point(ox + ux * w / 2 + nx * 0.5, oz + uz * w / 2 + nz * 0.5)
            ps.sort(key=lambda p: (not p.contains(front_mid), -p.area))
            piece = ps[0].simplify(0.25)
            if piece.area < 10 or piece.is_empty:
                continue
            mr = piece.minimum_rotated_rectangle
            mc = list(mr.exterior.coords)
            if min(math.hypot(mc[1][0] - mc[0][0], mc[1][1] - mc[0][1]), math.hypot(mc[2][0] - mc[1][0], mc[2][1] - mc[1][1])) < 3.2:
                continue  # a sliver: it stays part of the inner block, not a paper-thin house
            placed.append(piece)
            placed_union = placed_union.union(piece)
            house = make_house(bi, piece, (ox, oz), (ux, uz), (nx, nz), w, depth, is_public, rng, block)
            if block.area < 260:
                # a lone small block on a quay or a square: a shed, a lock-keeper's
                # house, a customs post; one or two storeys, not a tower
                st = rng.choice([1, 2, 2])
                house["st"] = st
                house["h"] = round(GROUND_H + STOREY_H * (st - 1), 2)
            houses.append(house)
    rest = block.difference(placed_union.buffer(0.05))
    for p in pieces(rest):
        if p.area > 25:
            # the inside of the block: yards, sheds, back houses. It may touch a
            # street where no plot was cut, so it is a house like the others:
            # windows where it faces a street, a hipped roof
            st = rng.choice([2, 2, 3])
            houses.append({
                "b": bi, "rect": False, "back": True,
                "fp": rnd(list(shapely.geometry.polygon.orient(p.simplify(0.4), 1.0).exterior.coords)[:-1]),
                "h": round(GROUND_H + STOREY_H * (st - 1), 2), "st": st, "roof": "flat", "gable": "none", "pitch": 40,
                "style": rng.choice(["brick", "brick_dark", "plaster_grey"]), "tint": round(rng.uniform(0.8, 0.95), 3),
                "roofMat": rng.choice(["tile", "slate"]), "seed": rng.randrange(1 << 30),
            })


def make_house(bi, piece, o, u, n, w, depth, is_public, rng, block=None):
    """A house on a plot. Rectangular plots get a pitched roof, odd corner plots a flat roof behind a parapet."""
    # footprint in the plot frame: s along the street, t into the block
    loc = [((x - o[0]) * u[0] + (z - o[1]) * u[1], (x - o[0]) * n[0] + (z - o[1]) * n[1]) for x, z in piece.exterior.coords[:-1]]
    s0, s1 = min(p[0] for p in loc), max(p[0] for p in loc)
    t0, t1 = min(p[1] for p in loc), max(p[1] for p in loc)
    rect_area = (s1 - s0) * (t1 - t0)
    rect = piece.area >= 0.8 * rect_area
    if rect and block is not None:
        # the plot's rectangle may not stick out of the block into the street
        corners = [(o[0] + u[0] * sv + n[0] * tv, o[1] + u[1] * sv + n[1] * tv) for sv, tv in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))]
        if not block.buffer(0.25).contains(Polygon(corners)):
            rect = False
    st = storeys(rng) if not is_public else rng.choice([3, 3, 4])
    h = GROUND_H + STOREY_H * (st - 1)
    style = "public" if is_public else rng.choices(["brick", "plaster", "plaster_grey", "brick_dark"], weights=[40, 30, 15, 15])[0]
    width = s1 - s0
    if not rect:
        roof, gable = "flat", "none"
    elif is_public or width > 8.6:
        roof, gable = "side", "none"
    else:
        roof = rng.choices(["front", "side"], weights=[62, 38])[0]
        gable = rng.choices(["step", "spout", "plain"], weights=[50, 30, 20])[0] if roof == "front" else "none"
    house = {
        "b": bi,
        "rect": rect,
        "fp": rnd(list(piece.exterior.coords)[:-1]),
        "o": rnd([o])[0],
        "u": [round(u[0], 5), round(u[1], 5)],
        "n": [round(n[0], 5), round(n[1], 5)],
        "s": [round(s0, 2), round(s1, 2)],
        "t": [round(t0, 2), round(t1, 2)],
        "h": round(h, 2),
        "st": st,
        "roof": roof,
        "gable": gable,
        "pitch": round(rng.uniform(48, 58) if roof == "front" else rng.uniform(38, 50), 1),
        "style": style,
        "tint": round(rng.uniform(0.86, 1.08), 3),
        "roofMat": rng.choices(["tile", "slate"], weights=[60, 40])[0],
        "seed": rng.randrange(1 << 30),
    }
    return house


def rnd(pts):
    return [[round(x, 2), round(z, 2)] for x, z in pts]


def clean_ring(pts):
    """A footprint ring without spikes or self-touches (simplify can fold an edge back on itself,
    which built two walls back to back in one plane): the largest piece of the repaired polygon."""
    n = len(pts)
    folds = False
    for i in range(n):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % n]
        e1, e2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
        l1, l2 = math.hypot(*e1), math.hypot(*e2)
        if l1 > 1e-6 and l2 > 1e-6 and (e1[0] * e2[0] + e1[1] * e2[1]) < -0.999 * l1 * l2:
            folds = True  # the ring turns straight back on itself: a spike
    if Polygon(pts).is_valid and not folds:
        return pts  # most rings: as they are, so the plan stays the same
    p = Polygon(pts).buffer(0)
    ps = sorted(pieces(p), key=lambda q: -q.area)
    if not ps:
        return pts
    q = shapely.geometry.polygon.orient(ps[0].simplify(0.02), 1.0)
    return rnd(list(q.exterior.coords)[:-1])


def rect_poly(h):
    (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
    return Polygon([(ox + ux * s + nx * t, oz + uz * s + nz * t) for s, t in ((h["s"][0], h["t"][0]), (h["s"][1], h["t"][0]), (h["s"][1], h["t"][1]), (h["s"][0], h["t"][1]))])


def trim_rects(houses):
    """A rectangular house is built as the rectangle of its plot (o, u, n, s, t), up to a fifth bigger
    than the plot itself where an earlier plot took a corner out. That rectangle ran into the
    neighbour: two fronts in one plane that flicker (z-fight, Steve 2026-09-24). Cut each rectangle
    back to clear every other house, keeping its street front: narrower from the side the neighbour
    is on, or shallower at the back, whichever keeps the most. A house that cannot keep 3 m of front
    and 3.2 m of depth is built from its footprint instead (a hipped roof). No dice: the plan's
    random draws stay as they were."""
    solids = [Polygon(h["fp"]).buffer(0) for h in houses]
    tree = shapely.STRtree(solids)
    changed = 0
    for i, h in enumerate(houses):
        if not h["rect"]:
            continue
        for _ in range(8):
            rp = rect_poly(h)
            (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
            s0, s1 = h["s"]
            t0, t1 = h["t"]
            worst = None
            others = [j for j in tree.query(rp) if j != i]
            # the other rectangles already cut (earlier houses) count as solid too
            others_polys = [solids[j] for j in others] + [rect_poly(houses[j]) for j in range(i) if houses[j]["rect"] and rect_poly(houses[j]).intersects(rp)]
            for op in others_polys:
                inter = rp.intersection(op)
                if inter.area < 0.02:
                    continue
                loc = [((x - ox) * ux + (z - oz) * uz, (x - ox) * nx + (z - oz) * nz) for g in pieces(inter) for x, z in g.exterior.coords]
                if not loc:
                    continue
                if worst is None or inter.area > worst[0]:
                    worst = (inter.area, min(p[0] for p in loc), max(p[0] for p in loc), min(p[1] for p in loc))
            if worst is None:
                break
            _, is0, is1, it0 = worst
            # round away from the neighbour: a gap of a centimetre at most, never an overlap
            cands = []
            ns0 = math.ceil(is1 * 100 - 1e-6) / 100
            if s1 - ns0 >= 3.0:
                cands.append(((s1 - ns0) * (t1 - t0), "s", [ns0, s1]))
            ns1 = math.floor(is0 * 100 + 1e-6) / 100
            if ns1 - s0 >= 3.0:
                cands.append(((ns1 - s0) * (t1 - t0), "s", [s0, ns1]))
            nt1 = math.floor(it0 * 100 + 1e-6) / 100
            if nt1 - t0 >= 3.2:
                cands.append(((s1 - s0) * (nt1 - t0), "t", [t0, nt1]))
            if not cands:
                h["rect"], h["roof"], h["gable"] = False, "flat", "none"
                break
            _, key, val = max(cands)
            h[key] = val
            changed += 1
    return changed


def street_faces(houses, blocks_union):
    """Which walls face the street (windows) and which are blind party walls.
    Rectangular houses: [front, right, back, left] of the plot rectangle. Others: per footprint edge."""
    for h in houses:
        if h["rect"]:
            (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
            s0, s1 = h["s"]
            t0, t1 = h["t"]
            sm, tm = (s0 + s1) / 2, (t0 + t1) / 2
            probes = [(sm, t0 - 0.9), (s1 + 0.9, tm), (sm, t1 + 0.9), (s0 - 0.9, tm)]
            h["street"] = [0 if blocks_union.contains(Point(ox + ux * s + nx * t, oz + uz * s + nz * t)) else 1 for s, t in probes]
            continue
        fp = h["fp"]
        flags = []
        for i in range(len(fp)):
            a = fp[i]
            b = fp[(i + 1) % len(fp)]
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1
            # outward normal of a counter-clockwise ring is to the right
            ox, oz = dz / L, -dx / L
            if signed_area(fp) < 0:
                ox, oz = -ox, -oz
            flags.append(0 if blocks_union.contains(Point(mx + ox * 0.9, mz + oz * 0.9)) else 1)
        h["street"] = flags


def signed_area(fp):
    return 0.5 * sum(fp[i][0] * fp[(i + 1) % len(fp)][1] - fp[(i + 1) % len(fp)][0] * fp[i][1] for i in range(len(fp)))


def land_and_quays(city):
    area = Polygon(city["area"])
    water = unary_union([poly_of(w) for w in city["water"]])
    if not city.get("designed"):
        water = water.difference(unary_union(bridge_polys()))  # the traced map: bridges were land
    land = area.difference(water).buffer(0)
    tris = []
    for p in pieces(land):
        for t in shapely.constrained_delaunay_triangles(p.simplify(0.3)).geoms:
            c = list(t.exterior.coords)[:3]
            tris.append([round(v, 2) for xy in c for v in xy])
    quays = []
    # the river half-bastions of the town wall (rampart.py) have their own faces down to the river bed
    # (tools/blender/build_wall.py): no quay wall drawn in the same plane
    rb = unary_union([Polygon(v) for k, v in city.get("decor", {}).get("rampart", {}).get("bastions", {}).items() if k in ("se", "sw")])
    for p in pieces(water):
        for ring in [p.exterior, *p.interiors]:
            cs = list(ring.coords)
            for i in range(len(cs) - 1):
                a, b = cs[i], cs[i + 1]
                if not rb.is_empty and rb.boundary.distance(Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) < 0.05:
                    continue
                if area.buffer(-2).contains(Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)):
                    quays.append([round(a[0], 2), round(a[1], 2), round(b[0], 2), round(b[1], 2)])
    return tris, quays


# ---------------------------------------------------------------- game layer

# Bridges the old map draws only as thin lines (the lock of the Petit Bassin).
# World rectangles [x0, z0, x1, z1]; they become land in the game.
BRIDGES = {
    "lock_bridge": [94.0, 28.0, 132.0, 35.0],
}

# Game places on real buildings: the nearest street-facing front to a target point.
# name: (target x, target z, wanted facing x, wanted facing z)
DOORS = {
    "peeters": (-8.0, 44.0, 0.0, -1.0),  # the widow's chandlery, west end of the Quai Ste-Aldegonde row, facing the river
    "hessenatie": (30.0, 88.0, 0.0, -1.0),  # the Hessenatie's hall, facing the open quay
    "entrepot": (253.0, 90.0, -1.0, 0.0),  # the Entrepot, the city's bonded warehouse (Katoennatie work)
    "doss": (-42.0, 80.0, -1.0, 0.0),  # the doss house, on the canal side
}

WALK_RES = 0.5  # metres per cell of the walk map
# landmarks whose Blender shell follows the outline (buttresses, towers) instead of filling its rectangle
OUTLINE_BUILT = {"vleeshuis"}


def bridge_polys():
    return [box(*r) for r in BRIDGES.values()]


def house_solid(h):
    if h["rect"]:
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s0, s1 = h["s"]
        t0, t1 = h["t"]
        return [(ox + ux * s + nx * t, oz + uz * s + nz * t) for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))]
    return [tuple(p) for p in h["fp"]]


def find_doors(houses):
    out = {}
    for name, (tx, tz, wx, wz) in DOORS.items():
        best = None
        for h in houses:
            ring = house_solid(h)
            n = len(ring)
            flags = h["street"]
            for i in range(n):
                if not flags[i]:
                    continue
                a, b = ring[i], ring[(i + 1) % n]
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L < 3:
                    continue
                mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                d = math.hypot(mx - tx, mz - tz)
                if best is None or d < best[0]:
                    ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                    # outward normal: away from the house centre
                    cx = sum(p[0] for p in ring) / n
                    cz = sum(p[1] for p in ring) / n
                    ox, oz = -uz, ux
                    if (mx - cx) * ox + (mz - cz) * oz < 0:
                        ox, oz = -ox, -oz
                    if ox * wx + oz * wz < 0.6:
                        continue
                    best = (d, mx, mz, ox, oz, L)
        _, mx, mz, ox, oz, L = best
        out[name] = {"x": round(mx, 2), "z": round(mz, 2), "out": [round(ox, 4), round(oz, 4)], "width": round(L, 2)}
    return out


def walk_map(city, houses, backs, landmarks):
    """A picture of what you can walk on: R = wall, G = water, B = outside the traced map."""
    from PIL import Image, ImageDraw

    houses = [h for h in houses if not h.get("gone")]  # (the churches freed, 2026-09-26: a house marked gone is not built)

    xs = [p[0] for p in city["area"]]
    zs = [p[1] for p in city["area"]]
    x0, x1, z0, z1 = math.floor(min(xs)), math.ceil(max(xs)), math.floor(min(zs)), math.ceil(max(zs))
    W = int((z1 - z0) / WALK_RES)
    H = int((x1 - x0) / WALK_RES)

    def P(p):
        return ((p[1] - z0) / WALK_RES, (p[0] - x0) / WALK_RES)

    solid = Image.new("L", (W, H), 0)
    water = Image.new("L", (W, H), 0)
    outside = Image.new("L", (W, H), 255)
    ImageDraw.Draw(outside).polygon([P(p) for p in city["area"]], fill=0)
    dw = ImageDraw.Draw(water)
    for w in city["water"]:
        dw.polygon([P(p) for p in w["outer"]], fill=255)
    for r in bridge_polys():
        dw.polygon([P(p) for p in r.exterior.coords], fill=0)
    ds = ImageDraw.Draw(solid)
    for h in houses:
        ds.polygon([P(p) for p in house_solid(h)], fill=255)
    for b in backs:
        ds.polygon([P(p) for p in b["fp"]], fill=255)
    for name, l in landmarks.items():
        ds.polygon([P(p) for p in l["fp"]], fill=255)
        # the Blender model fills the outline's rectangle, so the rectangle is wall too; not the Vleeshuis
        # (vleeshuis2 is built on its outline: the rectangle reached out to its south stair tower and made
        # a 3 m strip of wall along the whole south front, M7 doors 2026-09-25)
        if name not in OUTLINE_BUILT:
            ds.polygon([P(p) for p in Polygon(l["fp"]).minimum_rotated_rectangle.exterior.coords], fill=255)
    for x0_, z0_, x1_, z1_ in city.get("decor", {}).get("solids", []):  # design.py DECOR solids (M3i)
        ds.polygon([P(p) for p in ((x0_, z0_), (x1_, z0_), (x1_, z1_), (x0_, z1_))], fill=255)
    for poly in city.get("decor", {}).get("solid_polys", []):  # the Steen's ramp balustrades (M3i)
        ds.polygon([P(p) for p in poly], fill=255)
    # the town wall (rampart.py): parapets, stair railings, guard houses, gate towers, the bridges' parapets.
    # The walk, the bastion tops and the stairs stay open: the game gives them their height (world/rampart.ts)
    # Painted cell by cell: a cell is wall when its middle is inside (ImageDraw also fills every cell the
    # outline touches, which made a 0.6 m parapet 1.5 m thick and the stairs too narrow to climb)
    import numpy as np

    def paint(img, polys, value=255):
        a = np.array(img)
        for ring in polys:
            poly = Polygon(ring)
            bx0, bz0, bx1, bz1 = poly.bounds
            r0, r1 = max(0, int((bx0 - x0) / WALK_RES) - 1), min(H, int((bx1 - x0) / WALK_RES) + 2)
            c0, c1 = max(0, int((bz0 - z0) / WALK_RES) - 1), min(W, int((bz1 - z0) / WALK_RES) + 2)
            rr, cc = np.meshgrid(np.arange(r0, r1), np.arange(c0, c1), indexing="ij")
            inside = shapely.contains_xy(poly, x0 + (rr + 0.5) * WALK_RES, z0 + (cc + 0.5) * WALK_RES)
            a[r0:r1, c0:c1][inside] = value
        return Image.fromarray(a)

    solid = paint(solid, city.get("decor", {}).get("rampart_solids", []))
    # the back alleys' lanes, gangs and courts (alleys.py): open cell by cell, then wall again only where a
    # cell's middle is inside something built. ImageDraw fills every cell an outline touches, so the cottages
    # took up to half a metre off each side of a 1.8 m gang, and at its bends and poort mouths no walker got
    # through (2026-09-25: three corner Madonnas in the gangs' courts the path check could not reach)
    lanes = city.get("alleys", {}).get("lanes", [])
    if lanes:
        dec = city.get("decor", {})
        built = [house_solid(h) for h in houses] + [b["fp"] for b in backs]
        for name, l in landmarks.items():
            built.append(l["fp"])
            if name not in OUTLINE_BUILT:
                built.append(list(Polygon(l["fp"]).minimum_rotated_rectangle.exterior.coords))
        built += [((a, b), (c, b), (c, d), (a, d)) for a, b, c, d in dec.get("solids", [])]
        built += dec.get("solid_polys", []) + dec.get("rampart_solids", [])
        lane = np.array(paint(Image.new("L", (W, H), 0), lanes)) > 127
        wall = np.array(paint(Image.new("L", (W, H), 0), built)) > 127
        sa = np.array(solid)
        sa[lane & ~wall] = 0
        solid = Image.fromarray(sa)
    # the covered passages under front houses into the gangs (alleys.py "poort"): open the whole depth, cell by
    # cell (ImageDraw's erase opened half a metre into the neighbours' walls)
    ways = []
    for h in houses:
        pt = h.get("poort")
        if not pt:
            continue
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s0, s1 = pt["s"]
        t0, t1 = h["t"][0] - 0.3, h["t"][1] + 0.3
        ways.append([(ox + ux * s + nx * t, oz + uz * s + nz * t) for s, t in ((s0 + 0.1, t0), (s1 - 0.1, t0), (s1 - 0.1, t1), (s0 + 0.1, t1))])
    solid = paint(solid, ways, 0)
    # the Stadspark (tools/blender/build_churches.py -> client/public/models/park.json): the pond (its rim's outer
    # edge) is wall but for the footbridge's deck; the railing's kerb, the gate piers, benches and lanterns too
    park = park_data()
    if park:
        pond = Polygon(park["pond"]).buffer(0)
        b = park["bridge"]
        (fx, fz), (tx, tz) = b["from"], b["to"]
        L = math.hypot(tx - fx, tz - fz) or 1.0
        ux, uz = (tx - fx) / L, (tz - fz) / L
        hw = b["width"] / 2 - 0.1
        deck = Polygon([(fx - uz * hw, fz + ux * hw), (tx - uz * hw, tz + ux * hw), (tx + uz * hw, tz - ux * hw), (fx + uz * hw, fz - ux * hw)])
        solid = paint(solid, [ring_of(p) for p in pieces(pond.difference(deck))] + park["solids"])
    # M7 prison and squares (tools/city/places.py -> shared/townplaces.json): the prison's compound, the greens'
    # railings, the benches, the trunks, the fountain, the kiosk and the urinal are wall, cell by cell
    tp = townplaces()
    if tp:
        solid = paint(solid, tp.get("solids", []))
    # beyond the far bank: the fields in the fog, not walked on
    outside = paint(outside, city.get("decor", {}).get("offlimits", []))
    # open ground nobody can reach (a yard shut in by houses, a garden behind the alleys' cottages): wall, so that
    # no Madonna, stall, prop or walker is ever put there (2026-09-25: the path check found Madonnas in shut yards).
    # One piece of open ground joined 4 ways; the river's water is not open ground, the bridges are.
    import scipy.ndimage as ndi
    sa, wa, oa = np.array(solid), np.array(water), np.array(outside)
    free = (sa < 128) & (wa < 128) & (oa < 128)
    lab, n = ndi.label(free)
    seed = lab[int((20 - x0) / WALK_RES), int((20 - z0) / WALK_RES)]  # the Rijnkaai, where Jef starts
    shut = free & (lab != seed)
    sa[shut] = 255
    solid = Image.fromarray(sa)
    print(f"walk map: {int(shut.sum() * WALK_RES * WALK_RES)} m2 of shut-in ground made wall ({n - 1} pieces)")
    img = Image.merge("RGB", (solid, water, outside))
    out = os.path.join(ROOT, "client", "public", "city", "walk.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    return {"x0": x0, "z0": z0, "res": WALK_RES, "w": W, "h": H, "file": "/city/walk.png", "about": "pixel (col, row) = ((z - z0) / res, (x - x0) / res); R wall, G water, B outside"}


def townplaces():
    """M7 prison and squares: shared/townplaces.json (tools/city/places.py), or None."""
    path = os.path.join(ROOT, "shared", "townplaces.json")
    return json.load(open(path)) if os.path.exists(path) else None


def park_data():
    """The Stadspark's furniture as built (client/public/models/park.json), or None before the first build."""
    path = os.path.join(ROOT, "client", "public", "models", "park.json")
    return json.load(open(path)) if os.path.exists(path) else None


def ring_of(p):
    return [[round(x, 2), round(z, 2)] for x, z in list(p.exterior.coords)[:-1]]


def quay_edge(city):
    """The river edge of the Rijnkaai, as (x, first land z) every metre from x -70 to 90."""
    area = Polygon(city["area"])
    water = unary_union([poly_of(w) for w in city["water"]]).difference(unary_union(bridge_polys()))
    out = []
    for x in range(-70, 91):
        line = LineString([(x, -40), (x, 40)])
        wet = line.intersection(water)
        z = -40.0
        for g in pieces_lines(wet):
            zs = [c[1] for c in g.coords]
            if min(zs) <= z + 0.01:
                z = max(z, max(zs))
        out.append([x, round(z, 2)])
    return out


def pieces_lines(g):
    if g.is_empty:
        return []
    if g.geom_type == "LineString":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "LineString"]


def landmark_frames(city, landmarks, solids):
    """Centre, long axis (pointing east-ish), length, width and the open side of each landmark."""
    th = math.radians(city["frame"]["thetaDeg"])
    east = (math.cos(th), -math.sin(th))  # world vector of local east... see below
    east = (math.sin(th), math.cos(th))
    for name, l in landmarks.items():
        p = Polygon(l["fp"])
        r = p.minimum_rotated_rectangle
        cs = list(r.exterior.coords)[:4]
        e1 = (cs[1][0] - cs[0][0], cs[1][1] - cs[0][1])
        e2 = (cs[2][0] - cs[1][0], cs[2][1] - cs[1][1])
        L1, L2 = math.hypot(*e1), math.hypot(*e2)
        ax, L, W = (e1, L1, L2) if L1 >= L2 else (e2, L2, L1)
        ax = (ax[0] / L, ax[1] / L)
        if ax[0] * east[0] + ax[1] * east[1] < 0:
            ax = (-ax[0], -ax[1])
        n = (-ax[1], ax[0])  # left of the axis, seen from above
        cx = sum(c[0] for c in cs) / 4
        cz = sum(c[1] for c in cs) / 4
        def open_cells(sign):
            k = 0
            for d in range(4, 20, 2):
                for s in range(-int(L / 2), int(L / 2) + 1, 4):
                    q = Point(cx + n[0] * sign * (W / 2 + d) + ax[0] * s, cz + n[1] * sign * (W / 2 + d) + ax[1] * s)
                    if not solids.contains(q):
                        k += 1
            return k
        side = 1 if open_cells(1) >= open_cells(-1) else -1
        l["frame"] = {"c": [round(cx, 2), round(cz, 2)], "ax": [round(ax[0], 5), round(ax[1], 5)], "n": [round(n[0], 5), round(n[1], 5)], "L": round(L, 2), "W": round(W, 2), "open": side}


# job spots that stand at a door: (spot id, door, metres out from the wall)
DOOR_SPOTS = [("hessenatie_door", "hessenatie", 2.5), ("peeters_dock", "peeters", 2.5), ("katoen_door", "entrepot", 3.0)]


def door_spots(doors):
    """Keep shared/spots.json in step with the doors (the server offers these spots to Claude)."""
    path = os.path.join(ROOT, "shared", "spots.json")
    spots = json.load(open(path))
    for sid, door, d in DOOR_SPOTS:
        o = doors[door]
        ox, oz = o["out"]
        spots[sid].update({"x": round(o["x"] + ox * d, 2), "z": round(o["z"] + oz * d, 2), "dir": [round(-oz, 3), round(ox, 3)]})
    json.dump(spots, open(path, "w", newline=""), indent=1)


def make_storehouse(bi, poly, kind, water, rng):
    """One long storehouse over a whole block (warehouses on the docks, the Entrepot).
    Its front, with the loading door, is the long side nearest the water."""
    r = poly.minimum_rotated_rectangle
    cs = list(r.exterior.coords)[:4]
    best = None
    for i in range(4):
        a, b = cs[i], cs[(i + 1) % 4]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        # inward normal: toward the rectangle's centre
        nx, nz = -uz, ux
        cx, cz = r.centroid.x, r.centroid.y
        if (cx - a[0]) * nx + (cz - a[1]) * nz < 0:
            nx, nz = -nx, -nz
        mid = Point((a[0] + b[0]) / 2 - nx * 4, (a[1] + b[1]) / 2 - nz * 4)
        # (L to the centimetre: a square block's sides differ by a hair; then the water decides)
        score = (round(L, 2), -mid.distance(water))
        if best is None or score > best[0]:
            W = max(math.hypot(cs[(i + 2) % 4][0] - b[0], cs[(i + 2) % 4][1] - b[1]), 1)
            best = (score, a, (ux, uz), (nx, nz), L, W)
    _, o, u, n, L, W = best
    st = 4 if kind == "entrepot" else rng.choice([3, 4])
    return {
        "b": bi, "rect": True, "store": kind,
        "fp": rnd(list(r.exterior.coords)[:-1]),
        "o": [round(o[0], 2), round(o[1], 2)], "u": [round(u[0], 5), round(u[1], 5)], "n": [round(n[0], 5), round(n[1], 5)],
        "s": [0.0, round(L, 2)], "t": [0.0, round(W, 2)],
        "h": round(GROUND_H + 0.6 + STOREY_H * (st - 1), 2), "st": st,
        "roof": "side", "gable": "none", "pitch": 32.0,
        "style": "brick" if kind == "entrepot" else "brick_dark", "tint": round(rng.uniform(0.9, 1.02), 3),
        "roofMat": "slate", "seed": rng.randrange(1 << 30),
    }


def ground_zones(city, houses, landmarks):
    """Split the land into three paving kinds, as in the period photos:
    earth: the working quays along the river and the dock (packed earth, setts, straw);
    flags: the open squares (big flagstones); cobble: the streets and the canal quays."""
    houses = [h for h in houses if not h.get("gone")]  # (a house marked gone is not built)
    area = Polygon(city["area"])
    water = unary_union([poly_of(w) for w in city["water"]])
    land = area.difference(water).buffer(0)
    solids = unary_union([Polygon(house_solid(h)).buffer(0) for h in houses] + [Polygon(l["fp"]).buffer(0) for l in landmarks.values()])
    open_water = water.buffer(-7).buffer(7)  # the river and the dock; the narrow canals drop out
    # simplified here, before the zones are cut from each other, so neighbours share one outline:
    # each piece simplified on its own left slivers of two pavings in one plane (z-fight check)
    earth = land.intersection(open_water.buffer(24)).difference(solids.buffer(3.0)).simplify(0.2).intersection(land)
    flags = land.difference(solids.buffer(9.0)).buffer(-1.0).buffer(1.0).simplify(0.2).intersection(land).difference(earth)
    # quays pass 2 (Steve, 2026-09-25: the reference pictures show the working quays in granite setts, not mud):
    # the part along the river and the dock (the first water, not the moat) is its own paving, "quay"
    river = poly_of(city["water"][0]).buffer(-7).buffer(7)
    quay = earth.intersection(river.buffer(24.5)).buffer(0)
    earth = earth.difference(quay).buffer(0)
    # the grass round the town wall: the berm, the far bank (rampart.py, design.py DECOR grass)
    grass = unary_union([Polygon(g["outer"], g["holes"]).buffer(0) for g in city.get("decor", {}).get("grass", [])]
                        + [Polygon(g).buffer(0) for g in city.get("alleys", {}).get("gardens", [])])
    # the alleys' yards and the Stadspark's paths: packed earth (alleys.py, streets.py)
    yards = unary_union([Polygon(g).buffer(0) for g in city.get("alleys", {}).get("yards", [])]
                        + [Polygon(g).buffer(0) for g in city.get("decor", {}).get("park", {}).get("paths", [])]
                        # the gate roads across the berm and the far bank (rampart.py): packed earth
                        + [Polygon(g[k]).buffer(0) for g in city.get("decor", {}).get("rampart", {}).get("gates", []) for k in ("road", "far_road") if k in g])
    grass = grass.difference(yards)
    if not yards.is_empty:
        yards = yards.intersection(land).simplify(0.2).intersection(land)
        flags = flags.difference(yards)
        quay = quay.difference(yards)
        earth = earth.union(yards)
    if not grass.is_empty:
        grass = grass.intersection(land).simplify(0.2).intersection(land)
        earth, flags, quay = earth.difference(grass), flags.difference(grass), quay.difference(grass)
    # the Stadspark's pond: no ground over it (the water lies 0.35 m down in the park model)
    park = park_data()
    if park:
        # (a hair wider: on the wall's side the water stops 5 cm short of the face, no grass in that strip)
        pond = Polygon(park["pond"]).buffer(0.1, join_style=2)
        land = land.difference(pond)
        earth, flags, grass, quay = earth.difference(pond), flags.difference(pond), grass.difference(pond), quay.difference(pond)
    # M7 prison and squares (shared/townplaces.json, tools/city/places.py): the greens' lawns are grass and their
    # walks packed earth (gravel); the prison's compound is packed earth (its yards; the buildings stand on it);
    # the round square's disc has no zone ground: world/places.ts lays its own (pavement, setts in rings, island)
    tp = townplaces()
    if tp:
        lawns = unary_union([Polygon(r).buffer(0) for g in tp["greens"] for r in g["grass"]])
        walks = unary_union([Polygon(r).buffer(0) for g in tp["greens"] for r in g["paths"]])
        lawns = lawns.difference(walks)
        new_earth = walks.union(Polygon(tp["prison"]["ring"]).buffer(0))
        disc = Point(tp["rond"]["c"]).buffer(tp["rond"]["r_disc"], resolution=32)
        earth = earth.difference(lawns).union(new_earth.intersection(land))
        flags, quay = flags.difference(lawns).difference(new_earth), quay.difference(lawns).difference(new_earth)
        grass = grass.union(lawns.intersection(land)).difference(new_earth)
        earth, flags, grass, quay = (z.difference(disc).buffer(0) for z in (earth, flags, grass, quay))
        land = land.difference(disc)
    # (the quay cut from the others once more: the float work above left slivers of it over the flags and the grass)
    quay = quay.difference(flags).difference(grass).buffer(0)
    cobble = land.difference(earth).difference(flags).difference(grass).difference(quay)
    out = {}
    # where one paving meets another: a row of long edge stones along the join (Steve: the
    # change from one texture to the next cut through half stones). Lines, not areas.
    edges = []
    zones = {"earth": earth.buffer(0), "flags": flags.buffer(0), "cobble": cobble.buffer(0), "quay": quay.buffer(0)}
    for za, zb in (("flags", "cobble"), ("earth", "cobble"), ("earth", "flags"), ("quay", "cobble"), ("quay", "flags"), ("quay", "earth")):  # (grass meets the rest with no kerb)
        seam = zones[za].buffer(0.05).intersection(zones[zb].buffer(0.05))
        line = seam.boundary if not seam.is_empty else None
        if line is None:
            continue
        # the middle line of the thin seam: the part of za's outline that lies in it
        own = zones[za].boundary.intersection(seam.buffer(0.02))
        for g in getattr(own, "geoms", [own]):
            if g.is_empty or g.geom_type not in ("LineString", "LinearRing"):
                continue
            g = g.simplify(0.15)
            if g.length < 0.8:
                continue
            edges.append([[round(x, 2), round(z, 2)] for x, z in g.coords])
    # no edge stones inside the back alleys: their lanes, yards and courts are one worn ground (Steve: "inside a
    # gang the ground is weird")
    al = city.get("alleys", {})
    alley_area = unary_union([Polygon(r).buffer(0) for k in ("lanes", "yards", "gardens") for r in al.get(k, [])])
    if not alley_area.is_empty:
        alley_area = alley_area.buffer(0.6)
        edges = [e for e in edges if not alley_area.contains(Point(e[len(e) // 2]))]
    out["edges"] = edges
    for name, g in (("earth", earth), ("flags", flags), ("cobble", cobble), ("grass", grass), ("quay", quay)):
        tris = []
        for p in pieces(g.buffer(0)):
            if p.area < 1:
                continue
            for t in shapely.constrained_delaunay_triangles(p).geoms:
                c = list(t.exterior.coords)[:3]
                tris.append([round(v, 2) for xy in c for v in xy])
        out[name] = tris
    return out


def main():
    global BRIDGES, DOORS
    city = json.load(open(CITY))
    designed = city.get("designed", False)
    landmarks = {}
    if designed:
        # the compact designed map (tools/city/design.py): landmarks, doors and bridges come with it
        for name, l in city["designedLandmarks"].items():
            poly = Polygon(l["fp"]).buffer(0)
            landmarks[name] = {"fp": rnd(list(shapely.geometry.polygon.orient(poly, 1.0).exterior.coords)[:-1]), "osm": l.get("osm")}
        BRIDGES = {k: v["rect"] for k, v in city["designedBridges"].items()}
        DOORS = {k: tuple(v) for k, v in city["designedDoors"].items()}
    else:
        osm = json.load(open(OSM))
        ways = {e["id"]: e for e in osm["elements"] if e["type"] == "way"}
        for name, wid in LANDMARKS.items():
            pts = [world_from_latlon(city, p["lat"], p["lon"]) for p in ways[wid]["geometry"]]
            poly = Polygon(pts).buffer(0)
            landmarks[name] = {"fp": rnd(list(shapely.geometry.polygon.orient(poly, 1.0).exterior.coords)[:-1]), "osm": wid}
    public_polys = [poly_of(p) for p in city["public"]]
    public = unary_union(public_polys)
    # a landmark takes its whole orange patch of the old map (it sits a few metres
    # off the modern outline), so no stray houses stand in front of it
    cuts = []
    for l in landmarks.values():
        lp = Polygon(l["fp"])
        # the Blender model fills the outline's rectangle, so the rectangle is cut too
        cuts.append(lp.buffer(0.6).union(lp.minimum_rotated_rectangle.buffer(0.8)))
        for pp in public_polys:
            if not pp.is_empty and pp.intersection(lp).area > 0.15 * min(lp.area, pp.area):
                cuts.append(pp.buffer(0.8))
    cut = unary_union(cuts)
    rng = random.Random(1873)
    houses, backs = [], []
    blocks = [poly_of(b) for b in city["blocks"]]
    planned = []  # the block outlines the plots were cut from
    # the storehouses face the water they stood by before the town moat (2026-09-25): the moat is not a quay
    water_all = unary_union([poly_of(w) for w in city["water"]]).intersection(box(-340, -80, 200, 300))
    for bi, b in enumerate(blocks):
        kind = city["blocks"][bi].get("kind", "houses")
        for part in pieces(b.difference(cut)):
            if part.area < 12:
                continue
            outline = Polygon(part.exterior).simplify(0.3 if designed else 1.2, preserve_topology=True)
            if not (outline.is_valid and outline.area > 12):
                continue
            planned.append(outline)
            if kind in ("warehouse", "entrepot"):
                houses.append(make_storehouse(bi, outline, kind, water_all, rng))
            else:
                n0 = len(houses)
                plan_block(bi, outline, part.interiors, public, rng, houses, backs)
                if kind == "guild":
                    # guild houses: tall, narrow, stone and plaster, stepped or bell gables to the square
                    for h in houses[n0:]:
                        if h.get("back") or not h["rect"]:
                            continue
                        st = rng.choice([4, 5, 5])
                        h.update({"st": st, "h": round(GROUND_H + STOREY_H * (st - 1), 2), "roof": "front",
                                  "gable": rng.choice(["step", "spout", "spout"]), "pitch": round(rng.uniform(55, 62), 1),
                                  "style": rng.choice(["plaster", "plaster", "brick", "plaster_grey"]), "tint": round(rng.uniform(0.95, 1.1), 3)})
    # a wall faces the street when the ground just outside it is not inside any
    # planned block (the same outlines the plots come from) nor a landmark
    for h in houses:
        h["fp"] = clean_ring(h["fp"])
    print("rects cut back from their neighbours:", trim_rects(houses))
    # the back alleys (alleys.py): the big back masses become lanes, cottages, yards and gardens
    n_old = len(houses)
    inworld = json.load(open(os.path.join(ROOT, "shared", "inworld_houses.json")))["houses"]
    al = alleys.plan_alleys(houses, planned, {e["house"] for e in inworld}) if designed else None
    if al:
        alleys.plan_courts_gangs(houses, planned, al)
        # a back mass that became only a court and yards is gone (the save may go, 2026-09-25: numbers may move)
        houses[:] = [h for h in houses if not h.get("gone")]
    solids = unary_union(planned + [Polygon(l["fp"]).buffer(0) for l in landmarks.values()])
    street_faces(houses, solids)
    if al:
        # the alleys' ground is open: the cottages face their lane (windows, a door) and their yard
        # (windows); a front house's back wall on a yard gets windows too ("yard"), never its door
        open_ground = unary_union(al["lanes"] + al["yards"] + al["gardens"])
        solids2 = solids.difference(open_ground.buffer(0.02))
        cots = [h for h in houses if h.get("alley")]
        street_faces(cots, solids2)
        tmp = [dict(h) for h in houses if not h.get("alley")]
        street_faces(tmp, solids2)
        for h, t in zip([h for h in houses if not h.get("alley")], tmp):
            yard = [1 if (b and not a) else 0 for a, b in zip(h["street"], t["street"])]
            if any(yard):
                h["yard"] = yard
        print(f"alleys: {al['cottages']} cottages ({len(houses) - n_old} new houses), {len(al['passages'])} passages, "
              f"front houses trimmed {sorted(al['trimmed'])}, yards {len(al['yards'])}, gardens {len(al['gardens'])}, trees {len(al['trees'])}")
        city["alleys"] = {
            "lanes": [rnd(list(p.exterior.coords)[:-1]) for g in al["lanes"] for p in pieces(g.simplify(0.2))],
            "passages": [[round(v, 2) for v in p.bounds] for p in al["passages"]],
            "yards": [rnd(list(p.exterior.coords)[:-1]) for g in al["yards"] for p in pieces(g.simplify(0.2))],
            "gardens": [rnd(list(p.exterior.coords)[:-1]) for g in al["gardens"] for p in pieces(g.simplify(0.2))],
            # (alleys.py plan_courts_gangs) the gangs' middle lines, the courts, the pumps
            "gangs": al.get("gangs", []),
            "courts": al.get("courts", []),
            "pumps": al.get("pumps", []),
        }
        city.setdefault("decor", {})["trees_wild"] = city["decor"].get("trees_wild", []) + al["trees"]
    landmark_frames(city, landmarks, unary_union([Polygon(house_solid(h)).buffer(0) for h in houses] + [Polygon(b["fp"]).buffer(0) for b in backs]))
    tris, quays = land_and_quays(city)
    city["landmarks"] = landmarks
    city["land"] = tris
    city["ground"] = ground_zones(city, houses, landmarks)
    city["quays"] = quays
    city["bridges"] = BRIDGES
    if designed:
        city["bridgeKinds"] = {k: v["kind"] for k, v in city["designedBridges"].items()}
    city["doors"] = find_doors(houses)
    door_spots(city["doors"])
    # the covered passages into the gangs (alleys.py "poort"), 1.5 m past each mouth: street things keep out
    city["poorts"] = []
    for h in houses:
        pt = h.get("poort")
        if not pt:
            continue
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s0, s1 = pt["s"]
        t0, t1 = h["t"][0] - 1.5, h["t"][1] + 1.5
        city["poorts"].append([[round(ox + ux * s + nx * t, 2), round(oz + uz * s + nz * t, 2)] for s, t in ((s0, t0), (s1, t0), (s1, t1), (s0, t1))])
    city["walk"] = walk_map(city, houses, backs, landmarks)
    city["rijnkaaiEdge"] = quay_edge(city)
    json.dump(city, open(CITY, "w"), separators=(",", ":"))
    json.dump({"houses": houses, "backs": backs, "landmarks": landmarks, "ground_h": GROUND_H, "storey_h": STOREY_H,
               "bridges": city.get("designedBridges", {}), "decor": city.get("decor", {})}, open(BUILD, "w"), separators=(",", ":"))
    kinds = {}
    for h in houses:
        k = h["roof"] + ("/" + h["gable"] if h["gable"] != "none" else "")
        kinds[k] = kinds.get(k, 0) + 1
    print("doors", city["doors"])
    print(f"houses {len(houses)} {kinds}, backs {len(backs)}, land tris {len(tris)}, quay edges {len(quays)}")
    print(f"city.json {os.path.getsize(CITY)//1024} KB, city_build.json {os.path.getsize(BUILD)//1024} KB")


def ground_only():
    """Only the ground zones again, on the planned city.json and city_build.json (quays pass 2, 2026-09-25):
    a whole plan.py run on its own does not give back the committed city (design.py first, and the trees
    come out a little different), so a paving change touches only city.json's "ground"."""
    city = json.load(open(CITY))
    build = json.load(open(BUILD))
    city["ground"] = ground_zones(city, build["houses"], city["landmarks"])
    json.dump(city, open(CITY, "w"), separators=(",", ":"))
    print({k: len(v) for k, v in city["ground"].items()})


if __name__ == "__main__":
    import sys
    if "--ground" in sys.argv:
        ground_only()
    else:
        main()
