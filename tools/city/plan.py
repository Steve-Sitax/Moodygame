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
            placed.append(piece)
            placed_union = placed_union.union(piece)
            houses.append(make_house(bi, piece, (ox, oz), (ux, uz), (nx, nz), w, depth, is_public, rng, block))
    rest = block.difference(placed_union.buffer(0.05))
    for p in pieces(rest):
        if p.area > 25:
            backs.append({"fp": rnd(list(p.simplify(0.4).exterior.coords)[:-1]), "h": round(rng.uniform(6.5, 9.0), 2)})


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
    water = unary_union([poly_of(w) for w in city["water"]]).difference(unary_union(bridge_polys()))
    land = area.difference(water).buffer(0)
    tris = []
    for p in pieces(land):
        for t in shapely.constrained_delaunay_triangles(p.simplify(0.3)).geoms:
            c = list(t.exterior.coords)[:3]
            tris.append([round(v, 2) for xy in c for v in xy])
    quays = []
    for p in pieces(water):
        for ring in [p.exterior, *p.interiors]:
            cs = list(ring.coords)
            for i in range(len(cs) - 1):
                a, b = cs[i], cs[i + 1]
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
    for l in landmarks.values():
        ds.polygon([P(p) for p in l["fp"]], fill=255)
        ds.polygon([P(p) for p in Polygon(l["fp"]).minimum_rotated_rectangle.exterior.coords], fill=255)
    img = Image.merge("RGB", (solid, water, outside))
    out = os.path.join(ROOT, "client", "public", "city", "walk.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out, optimize=True)
    return {"x0": x0, "z0": z0, "res": WALK_RES, "w": W, "h": H, "file": "/city/walk.png", "about": "pixel (col, row) = ((z - z0) / res, (x - x0) / res); R wall, G water, B outside"}


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
    json.dump(spots, open(path, "w"), indent=1)


def main():
    city = json.load(open(CITY))
    osm = json.load(open(OSM))
    ways = {e["id"]: e for e in osm["elements"] if e["type"] == "way"}
    landmarks = {}
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
    for bi, b in enumerate(blocks):
        for part in pieces(b.difference(cut)):
            if part.area < 12:
                continue
            outline = Polygon(part.exterior).simplify(1.2, preserve_topology=True)
            if outline.is_valid and outline.area > 12:
                plan_block(bi, outline, part.interiors, public, rng, houses, backs)
    solids = unary_union(blocks + [Polygon(l["fp"]) for l in landmarks.values()])
    street_faces(houses, solids)
    landmark_frames(city, landmarks, unary_union([Polygon(house_solid(h)).buffer(0) for h in houses] + [Polygon(b["fp"]).buffer(0) for b in backs]))
    tris, quays = land_and_quays(city)
    city["landmarks"] = landmarks
    city["land"] = tris
    city["quays"] = quays
    city["bridges"] = BRIDGES
    city["doors"] = find_doors(houses)
    door_spots(city["doors"])
    city["walk"] = walk_map(city, houses, backs, landmarks)
    city["rijnkaaiEdge"] = quay_edge(city)
    json.dump(city, open(CITY, "w"), separators=(",", ":"))
    json.dump({"houses": houses, "backs": backs, "landmarks": landmarks, "ground_h": GROUND_H, "storey_h": STOREY_H}, open(BUILD, "w"), separators=(",", ":"))
    kinds = {}
    for h in houses:
        k = h["roof"] + ("/" + h["gable"] if h["gable"] != "none" else "")
        kinds[k] = kinds.get(k, 0) + 1
    print("doors", city["doors"])
    print(f"houses {len(houses)} {kinds}, backs {len(backs)}, land tris {len(tris)}, quay edges {len(quays)}")
    print(f"city.json {os.path.getsize(CITY)//1024} KB, city_build.json {os.path.getsize(BUILD)//1024} KB")


if __name__ == "__main__":
    main()
