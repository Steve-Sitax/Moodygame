"""The designed city: 1873 Antwerp, compact (Steve, 2026-09-23: "way too big ...
keep historic buildings and locations but closer together and cut heavily on the
streets in between. Edges completely jagged. Bridges are just land. Do a map redesign.")

The real places stay, in their real order along the river and at their real
size: the Rijnkaai and the Petit Bassin (Bonapartedok) with its lock and the
Entrepot, the Hanseatic house, the Canal des Brasseurs (Brouwersvliet), the
Vismarkt and the Sint-Pietersvliet, Het Steen on the quay line by the Werf's
promontory, the ferry pontoon, the Vleeshuis, the Grote Markt with the town hall and the
guild houses, the Handschoenmarkt, the cathedral. The ordinary streets between
them are cut short. Every edge is straight; bridges are decks over water.

World frame as before: x runs along the river (north), z inland (east), water
at z < 0, metres. Writes shared/city.json in the format tools/city/plan.py reads.

    python tools/city/design.py && python tools/city/plan.py
"""

import json
import math
import os

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "shared", "city.json")
OSM = os.path.join(ROOT, "data", "osm", "antwerp.json")

AREA = (-340.0, 200.0, -80.0, 300.0)  # x0, x1, z0, z1

# ------------------------------------------------------------------ water
WATER = {
    "river": box(-340, -80, 200, 0),
    "lock": box(104, 0, 116, 46),  # the lock of the Petit Bassin
    "dock": box(70, 46, 170, 110),  # Petit Bassin (Bonapartedok)
    "canal": box(-82, 0, -70, 205),  # Canal des Brasseurs (Brouwersvliet)
    "vliet": box(-150, 0, -142, 72),  # Sint-Pietersvliet
}
# the quay promontory north of the Steen (the 1873 map has it in front of the Place du Bourg;
# M3i: the Steen itself stood on the quay line, not on it)
BASTION = Polygon([(-214, 0), (-214, -30), (-204, -42), (-160, -42), (-150, -30), (-150, 0)])

# ------------------------------------------------------------------ bridges: decks over water
# kind: stone (arch bridge), draw (timber lifting bridge with a balance: world/bridges.ts and
# world/lock.ts; the leaves rise in place, the ones on the quay railway carry its rails),
# pontoon (floating walkway, boats.ts). Draw bridges open for passing boats; the game walks them
# only while they are shut.
BRIDGES = {
    "lock_bridge": {"kind": "draw", "rect": [102, 14, 118, 21]},
    "canal_mouth": {"kind": "draw", "rect": [-84, 2, -68, 10]},
    "canal_mid": {"kind": "draw", "rect": [-84, 66, -68, 73]},
    "canal_high": {"kind": "draw", "rect": [-84, 150, -68, 157]},
    "vliet_mouth": {"kind": "draw", "rect": [-152, 2, -140, 9]},
    "vliet_mid": {"kind": "draw", "rect": [-152, 40, -140, 47]},
    "ferry_pontoon": {"kind": "pontoon", "rect": [-251, -58, -247, 0]},
}


def R(x0, z0, x1, z1):
    return box(min(x0, x1), min(z0, z1), max(x0, x1), max(z0, z1))


# ------------------------------------------------------------------ blocks
# kind: houses (plots), warehouse (one long storehouse), guild (tall ornate gables), shed (low)
BLOCKS = [
    # --- Eilandje, north of the lock
    ("warehouse", R(124, 22, 150, 40)),  # lock-keeper's store on the Quai Nord
    ("warehouse", R(178, 4, 200, 44)),  # the quay's end: the Stapelhuis
    ("entrepot", R(176, 48, 200, 118)),  # the Entrepot along the dock
    ("warehouse", R(156, 126, 200, 164)),
    ("houses", R(62, 126, 80, 164)),
    ("houses", R(62, 172, 200, 228)),
    # --- Quai Ste-Aldegonde, behind the Rijnkaai (the widow's shop, the Hessenatie)
    ("houses", R(-60, 46, -8, 66)),
    ("houses", R(-2, 46, 30, 66)),
    ("warehouse", R(36, 46, 62, 66)),
    ("houses", R(-60, 73, -8, 105)),
    ("houses", R(-2, 73, 30, 105)),
    ("warehouse", R(36, 73, 62, 105)),
    ("houses", R(-60, 112, 0, 150)),
    ("houses", R(6, 112, 56, 150)),
    ("houses", R(-60, 157, 56, 228)),
    ("houses", R(-60, 228, 200, 300)),
    # --- the Vismarkt quarter, between the canal and the Sint-Pietersvliet
    ("houses", R(-140, 50, -92, 80)),
    ("houses", R(-140, 118, -92, 150)),
    ("houses", R(-140, 157, -92, 205)),
    ("houses", R(-140, 212, -60, 300)),
    # --- the Steen quarter and the Grote Markt
    ("houses", R(-200, 40, -156, 74)),  # the doss house is in this block, facing the Steenplein
    ("houses", R(-200, 82, -156, 124)),
    ("guild", R(-222, 64, -208, 124)),  # guild houses on the north side of the Grote Markt
    ("houses", R(-300, 14, -222, 26)),  # riverside houses behind the town hall
    ("guild", R(-304, 66, -286, 124)),  # guild houses on the south side of the Grote Markt
    ("houses", R(-200, 132, -156, 205)),
    ("houses", R(-340, 14, -310, 300)),  # the west edge of the map
    ("warehouse", R(-340, 0, -318, 14)),  # the Werf ends in a store
    ("houses", R(-222, 212, -156, 300)),
    ("houses", R(-306, 272, -222, 300)),
    ("houses", R(-156, 212, -150, 300)),
]

# ------------------------------------------------------------------ landmarks
# placed in the compact map; outlines from OpenStreetMap (real size), turned to
# lie along the given axis. Hanzehuis: burned in 1893, a designed outline.
LANDMARKS = {
    "cathedral": {"osm": 26495164, "c": (-262, 208), "axis": (0, 1)},  # west front toward the Handschoenmarkt (-z)
    "stadhuis": {"osm": 22966134, "c": (-257, 48), "axis": (1, 0)},  # long front facing the Grote Markt (+z)
    "vleeshuis": {"osm": 179882624, "c": (-116, 99), "axis": (1, 0)},
    # Het Steen as restored in 1887-90 (M3i; Steve 2026-09-24: the restored look, with the ramp): on the
    # promontory at the water, a raised courtyard along its inland side, the ramp up to the Steenpoort
    # (STEEN below); a designed rect, not the OSM outline (that holds the 1950s and 2021 wings)
    "steen": {"rect": (34, 16.5), "c": (-177.0, -31.25), "axis": (1, 0)},
    "hanzehuis": {"rect": (64, 38), "c": (120, 143), "axis": (1, 0)},
}

# street furniture after the period photos (the Steenplein, the Werf, the quays):
# rows of young trees, an iron railing along the water, gas lamps
DECOR = {
    "trees": [(x, z) for z in (24.0, 34.0) for x in range(-208, -150, 8)]
    + [(x, 11.0) for x in range(-300, -222, 12)],
    "rails": [[-222, 0.6, -214, 0.6], [-150, 0.6, -142, 0.6], [-214, 0.6, -214, -29.4], [-214, -29.4, -204, -41.4],
              [-204, -41.4, -160, -41.4], [-160, -41.4, -150, -29.4], [-150, -29.4, -150, 0.6]],
    # the quay railway (standard gauge, laid in the cobbles; client/src/world/tracks.ts draws it).
    # Polylines; every corner is rounded with radius r. One line runs along all the river quays
    # (from the station, off the map to the west) under the portal cranes, over the vliet and
    # canal bridges, to the lock bridge; past the lock it loops round the Petit Bassin and comes
    # back onto the Rijnkaai. A loading siding runs beside it on the Rijnkaai.
    "tracks": [
        {"pts": [[-345, 4.0], [80, 4.0], [95, 17.5], [101.8, 17.5]], "r": 18, "end": [False, False]},
        {"pts": [[118.2, 17.5], [173, 17.5], [173, 116], [66, 116], [66, 4.0], [44, 4.0]], "r": [0, 10, 10, 10, 22, 0], "end": [False, False]},
        {"pts": [[-64, 4.0], [-52, 10.3], [12, 10.3], [24, 4.0]], "r": 24, "end": [False, False]},
    ],
    # portal crane runways: the crane's legs run on these (gauge 5.2 m), the railway between them
    "crane_rails": [[-318, 1.4, -222, 1.4], [-318, 6.6, -222, 6.6], [-36, 1.4, 70, 1.4], [-36, 6.6, 70, 6.6],
                    [63.4, 50, 63.4, 104], [68.6, 50, 68.6, 104], [170.4, 50, 170.4, 108], [175.6, 50, 175.6, 108]],
    # the Vismarkt (Steve: "the lights are quite random and even on a track"): three even rows at
    # 12 m, off the railway, the omnibus lanes and the cart ruts (world/ruts.ts), the doors and steps:
    # the quay row inland of the omnibus lane (z 11.2), the vliet edge (1.6 m from the wall), the row
    # before the houses (z 47.6, between the doors)
    "lamps": [(x, 9.5) for x in range(-310, -150, 24) ] + [(-200, 38.0), (-160, 38.0), (-176, 20.0), (-151.6, 14.0),
              (-138.6, 11.2), (-126.6, 11.2), (-114.6, 11.2), (-102.6, 11.2), (-90.6, 11.2),
              (-140.4, 23.4), (-140.4, 35.6),
              (-132.6, 47.6), (-120.6, 47.6), (-108.6, 47.6), (-96.6, 47.6),
              (-230, 60.0), (-280, 60.0), (-230, 128.0), (-290, 128.0), (-74, 60.0), (-74, 160.0), (69.4, 77.0), (69.4, 106.5), (124.3, 121.5), (170.8, 83.0)],
    # (the Oostershuis lamp stands on the pier beside the gate's frontispiece, not before the gate: M7 doors)
}

# ------------------------------------------------------------------ Het Steen, restored (1887-90)
# The courtyard runs along the Steen's inland side at TERRACE_H; the Steenpoort stands over its south
# end; outside the gate a landing, then the curved ramp with its balustrades and corner posts comes
# down onto the promontory (the ground, y 0) and ends facing the quay. The game walks it
# (client/src/world/steenramp.ts reads DECOR steen_ramp); plan.py paints the balustrades, the gate's
# east tower, the north wing over the courtyard's end and the calvary as walls (DECOR solids,
# solid_polys); tools/blender/build_landmarks.py steen5 builds it all from the same numbers.
STEEN_C = LANDMARKS["steen"]["c"]
TERRACE_H = 2.2
RAMP_HALF = 2.0  # walkable half width; the balustrades stand 2.05..2.35 out


def steen_layout():
    cx, cz = STEEN_C
    gate_x = cx - 17.0  # the Steenpoort's outer face
    pc = cz + 8.25 + 2.45  # the middle of the passage (z)
    land_x = gate_x - 3.2  # the landing's outer end
    R = 5.0
    foot_z = -3.0
    # the centreline, gate to foot: (x, z, s) with s the distance down from the landing's end
    pts = []
    x = gate_x + 1.0
    while x > land_x + 0.01:
        pts.append((x, pc, 0.0))
        x -= 0.5
    ccx, ccz = land_x, pc + R
    n = 16
    for k in range(n + 1):
        t = (math.pi / 2) * k / n
        pts.append((ccx - R * math.sin(t), ccz - R * math.cos(t), R * t))
    arc = R * math.pi / 2
    z = ccz + 0.5
    while z < foot_z - 0.01:
        pts.append((ccx - R, z, arc + (z - ccz)))
        z += 0.5
    pts.append((ccx - R, foot_z, arc + (foot_z - ccz)))
    total = pts[-1][2]
    line = [[round(px, 3), round(pz, 3), round(TERRACE_H * (1 - s_ / total), 3)] for px, pz, s_ in pts]
    # the balustrades: offset lines either side of the centreline, from the gate to the foot
    def offset(d):
        out = []
        for i, (px, pz, _) in enumerate(line):
            qx, qz, _ = line[min(i + 1, len(line) - 1)]
            ox, oz, _ = line[max(i - 1, 0)]
            tx, tz = qx - ox, qz - oz
            L = math.hypot(tx, tz) or 1.0
            out.append((px - tz / L * d, pz + tx / L * d))
        return out
    polys = []
    for side in (1, -1):
        a = offset(side * (RAMP_HALF + 0.05))
        b = offset(side * (RAMP_HALF + 0.35))
        polys.append([[round(x_, 2), round(z_, 2)] for x_, z_ in a + b[::-1]])
    tower = [gate_x - 0.1, cz + 8.25 + 4.9 - 0.2, gate_x + 4.25, cz + 8.25 + 4.9 + 3.9]  # the gate's east tower
    north_wing = [cx + 8.0, cz + 8.25, cx + 17.0, cz + 14.25 + 0.4]  # the new wing across the courtyard's end
    edge = [gate_x + 4.2, cz + 14.25, cx + 8.0, cz + 14.65]  # the courtyard's balustrade on the promontory side
    calvary = [ccx - R - 5.7, foot_z - 1.8, ccx - R - 3.6, foot_z]  # the calvary west of the ramp's foot
    return {
        "h": TERRACE_H, "half": RAMP_HALF, "line": line,
        "terrace": [round(gate_x - 0.2, 2), round(cz + 8.25, 2), round(cx + 8.0, 2), round(cz + 14.25, 2)],
        "gate": [gate_x, gate_x + 4.0], "calvary": calvary,
    }, [tower, north_wing, edge, calvary], polys


_ramp, _solids, _polys = steen_layout()
DECOR["steen_ramp"] = _ramp
DECOR["solids"] = [[round(v, 2) for v in r] for r in _solids]
DECOR["solid_polys"] = _polys

# game doors: target point and the way the door should face (plan.py finds the house)
DOORS = {
    "peeters": (-30.0, 46.0, 0.0, -1.0),
    "hessenatie": (14.0, 46.0, 0.0, -1.0),
    "entrepot": (176.0, 80.0, -1.0, 0.0),
    "doss": (-178.0, 40.0, 0.0, -1.0),
}

# named places for the map and the crowd
PLACES = {
    "Rijnkaai": (20, 20, "quay"),
    "Petit Bassin": (120, 78, "water"),
    "Entrepot": (188, 83, "building"),
    "Hanseatic House": (120, 143, "building"),
    "Canal des Brasseurs": (-76, 110, "water"),
    "Vismarkt": (-118, 30, "square"),
    "Het Steen": (-177, -31, "building"),
    "Steenplein": (-180, 20, "square"),
    "Vleeshuis": (-116, 99, "building"),
    "Grote Markt": (-254, 94, "square"),
    "Handschoenmarkt": (-262, 132, "square"),
    "Cathedral": (-262, 208, "building"),
    "Werf": (-270, 6, "quay"),
}


def osm_outline(wid):
    osm = json.load(open(OSM))
    for e in osm["elements"]:
        if e["type"] == "way" and e["id"] == wid:
            lat0, lon0 = 51.2235, 4.4000
            kx = math.cos(math.radians(lat0)) * 111320.0
            return [((p["lon"] - lon0) * kx, (p["lat"] - lat0) * 110574.0) for p in e["geometry"]]
    raise KeyError(wid)


def place_outline(pts, c, axis, scale=1.0):
    """Centre an outline, turn its long axis onto `axis`, move it to c."""
    poly = Polygon(pts).buffer(0)
    r = poly.minimum_rotated_rectangle
    cs = list(r.exterior.coords)[:4]
    e1 = (cs[1][0] - cs[0][0], cs[1][1] - cs[0][1])
    e2 = (cs[2][0] - cs[1][0], cs[2][1] - cs[1][1])
    ax = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
    ang = math.atan2(axis[1], axis[0]) - math.atan2(ax[1], ax[0])
    cx, cy = r.centroid.x, r.centroid.y
    ca, sa = math.cos(ang), math.sin(ang)
    out = []
    for x, y in poly.exterior.coords[:-1]:
        dx, dy = (x - cx) * scale, (y - cy) * scale
        out.append([round(c[0] + dx * ca - dy * sa, 2), round(c[1] + dx * sa + dy * ca, 2)])
    return out


def ring(p):
    return [[round(x, 2), round(z, 2)] for x, z in list(p.exterior.coords)[:-1]]


def main():
    x0, x1, z0, z1 = AREA
    water = unary_union(list(WATER.values())).difference(BASTION)
    landmarks = {}
    for name, d in LANDMARKS.items():
        if "osm" in d:
            fp = place_outline(osm_outline(d["osm"]), d["c"], d["axis"], d.get("scale", 1.0))
        else:
            w, h = d["rect"]
            fp = ring(box(d["c"][0] - w / 2, d["c"][1] - h / 2, d["c"][0] + w / 2, d["c"][1] + h / 2))
        landmarks[name] = {"fp": fp, "osm": d.get("osm")}
    # blocks give way to landmarks, water and bridges
    cut = unary_union([Polygon(l["fp"]).buffer(4) for l in landmarks.values()] + [water])
    blocks, kinds = [], []
    for kind, b in BLOCKS:
        p = b.difference(cut)
        for part in getattr(p, "geoms", [p]):
            if part.is_empty or part.area < 30:
                continue
            blocks.append({"outer": ring(part), "holes": [], "kind": kind})
            kinds.append(kind)
    city = {
        "_about": "1873 Antwerp, the designed compact map (tools/city/design.py). World metres: x along the Rijnkaai (north), z inland, water at z < 0.",
        "designed": True,
        "source": "designed from the 1873 Vuillaume map (CC0) and OpenStreetMap outlines (ODbL)",
        "frame": {"originE": 0, "originN": 0, "thetaDeg": 0, "lat0": 51.2235, "lon0": 4.4},
        "area": [[x0, z0], [x1, z0], [x1, z1], [x0, z1]],
        "blocks": blocks,
        "public": [],
        "water": [{"outer": ring(p), "holes": [ring(Polygon(h)) for h in []]} for p in getattr(water, "geoms", [water])],
        "designedLandmarks": landmarks,
        "designedBridges": BRIDGES,
        "designedDoors": DOORS,
        "places": {k: {"x": v[0], "z": v[1], "kind": v[2]} for k, v in PLACES.items()},
        "decor": DECOR,
    }
    json.dump(city, open(OUT, "w"), separators=(",", ":"))
    print(f"blocks {len(blocks)} ({', '.join(f'{k} {kinds.count(k)}' for k in sorted(set(kinds)))}), water parts {len(city['water'])}, landmarks {len(landmarks)}")


if __name__ == "__main__":
    main()
