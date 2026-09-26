"""The Stadspark's placement check (the park pass, 2026-09-26; Steve: nothing may stand where it cannot be).

Reads what the game draws and walks on: client/public/models/park.json (the railing, the gates, the pond, the water,
the island, the bridge, benches, lanterns, piers, the rocaille), client/public/models/park_plants.json (trees, plants,
the hedge, the beds, the park's own ground), shared/city.json (the gravel paths and their middle lines) and
client/public/city/walk.png (the walk map). Lists every problem; an empty list is a pass.

  on a path        no tree, shrub, flower, bed, hedge, bench, lamp, pier, rock or railing on the gravel
  in the water     nothing in the pond but reeds, bulrushes and iris near the edge (at most 1.3 m out), lilies,
                   the island's plants on the island, and the bridge
  in another       no two objects in one another (a trunk in a bench, a lamp in a shrub, a bed under a tree ...);
                   shrubs may touch shrubs and the hedge's pieces run on from each other
  floating, sunk   each thing's foot where it stands: y 0 on the park's ground (land plants, benches, lamps), the
                   water's level for water plants and lilies, the island's top on the island
  walkable         every gate and every point of every path's middle line is open ground in the walk map, and all of
                   them are one piece of open ground with the Rijnkaai (where Jef starts)

    python tools/city/park_check.py          prints the problems (none: "park check: nothing found")
"""
import json
import math
import os
import sys

import numpy as np
from PIL import Image
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

WATER_KINDS = {"reed", "cattail", "iris"}
SOFT = {"shrub_ever", "shrub_holly", "shrub_hazel", "shrub_red", "shrub_bare", "sedge", "flowers"}
# the footprint of each thing (m at scale 1): trunks, shrubs' bodies
FOOT = {"young_lime": 0.1, "young_maple": 0.1, "young_chestnut": 0.1, "young_elm": 0.1, "old_elm": 0.35, "old_plane": 0.4,
        "old_bare": 0.33, "weeping": 0.15, "conifer": 0.5, "shrub_ever": 0.7, "shrub_holly": 0.5, "shrub_hazel": 0.6,
        "shrub_red": 0.55, "shrub_bare": 0.55, "flowers": 0.15, "sedge": 0.15, "reed": 0.2, "cattail": 0.2, "iris": 0.15, "lily": 0.3}


def load(p):
    return json.load(open(os.path.join(ROOT, p)))


def main():
    city = load("shared/city.json")
    pk = load("client/public/models/park.json")
    pl = load("client/public/models/park_plants.json")
    P = city["decor"]["park"]
    ring = Polygon(pk["outline"]).buffer(0)
    pond = Polygon(pk["pond"]).buffer(0)
    water = Polygon(pk["water"]).buffer(0)
    paths = unary_union([Polygon(r).buffer(0) for r in P["paths"]]).intersection(ring)
    island = Polygon(pk["island"]["land"]).buffer(0) if pk.get("island") else Polygon()
    b = pk["bridge"]
    ground = unary_union([Polygon([(t[0], t[1]), (t[2], t[3]), (t[4], t[5])]).buffer(0.001)
                          for k in ("lawn", "gravel", "mud", "bed") for t in pl["ground"][k]])
    out = []

    def bad(what, where, why):
        out.append(f"{what} at ({where[0]:.1f}, {where[1]:.1f}): {why}")

    # ---- everything as a footprint: (label, shape, kind, y or None)
    things = []
    for x, z, kind, s, _ in pl["trees"]:
        things.append((f"tree {kind}", Point(x, z).buffer(FOOT[kind] * s, quad_segs=4), kind, 0.0 if not island.contains(Point(x, z)) else None))
    for x, z, kind, s, _, y in pl["plants"]:
        things.append((f"plant {kind}", Point(x, z).buffer(FOOT.get(kind, 0.2) * s, quad_segs=4), kind, y))
    for i, (x0, z0, x1, z1, h, w) in enumerate(pl["hedge"]):
        things.append(("hedge" if h > 0.5 else "bed edging", LineString([(x0, z0), (x1, z1)]).buffer(w / 2, cap_style=2), "hedge", 0.0))
    for r in pl.get("beds", []):
        things.append(("flower bed", Polygon(r).buffer(0), "bed", 0.0))
    for k, label in (("benches", "bench"), ("lanterns", "lamp"), ("piers", "gate pier"), ("rocks", "rocaille"), ("railing", "railing")):
        for r in pk.get(k, []):
            things.append((label, Polygon(r).buffer(0), k, 0.0))

    # ---- on a path
    for label, shp, kind, _ in things:
        if kind in ("railing",):
            continue  # (the railing's kerb ends at the gates' piers; the paths pass between them)
        a = shp.intersection(paths).area
        if a > 0.01:
            bad(label, shp.centroid.coords[0], f"stands on a path ({a:.2f} m2)")
    # ---- in the water
    edge = LineString(list(water.exterior.coords))
    bank = pond.difference(water)
    for label, shp, kind, y in things:
        c = shp.centroid
        if kind == "sedge" and y is not None and y < -0.02:
            # sedge on the bank's slope, or in the shallows at the edge
            if y < -0.33:
                if not water.contains(c) or edge.distance(c) > 1.3:
                    bad(label, c.coords[0], "sedge in the water away from the edge")
            elif not bank.buffer(0.05).contains(c):
                bad(label, c.coords[0], f"sedge at the bank's height (y {y}) off the bank")
            else:
                want = -0.3 + 0.31 * min(water.exterior.distance(c) / 0.45, 1.0)
                if abs(y - want) > 0.05:
                    bad(label, c.coords[0], f"sedge floating or sunk on the bank (y {y}, the bank {want:.2f})")
            continue
        if kind in WATER_KINDS:
            if not water.contains(c) and not pond.contains(c):
                bad(label, c.coords[0], "a water plant on dry land")
            elif water.contains(c) and edge.distance(c) > 1.3 and not island.buffer(1.3).contains(c):
                bad(label, c.coords[0], f"a water plant {edge.distance(c):.1f} m out on open water")
            continue
        if kind == "lily":
            if not water.buffer(-0.2).contains(c):
                bad(label, c.coords[0], "a lily pad not on open water")
            continue
        if island.contains(c):
            continue  # the island's own plants
        if kind in ("rocks",):
            continue  # (the rocaille stands on the bank beside the bridge's ends, outside the water: checked in Blender)
        wet = shp.intersection(water).area
        if wet > 0.01:
            bad(label, c.coords[0], f"stands in the water ({wet:.2f} m2)")
    # ---- in another
    for i in range(len(things)):
        la, sa, ka, _ = things[i]
        for j in range(i + 1, len(things)):
            lb, sb, kb, _ = things[j]
            if not sa.intersects(sb):
                continue
            pair = {ka, kb}
            if ka == kb and ka in ("hedge", "railing", "lily", "reed", "cattail", "iris"):
                continue  # pieces that run on, clumps that mingle
            if pair <= SOFT | WATER_KINDS or pair <= {"lily"} | WATER_KINDS:
                continue  # shrubs and low plants may touch each other
            if "bed" in pair and pair <= {"bed", "flowers", "sedge", "hedge"}:
                continue  # a bed's flowers and its box edging
            if "railing" in pair and pair <= {"railing", "piers"}:
                continue
            a = sa.intersection(sb).area
            if a > 0.02:
                bad(f"{la} and {lb}", sa.intersection(sb).centroid.coords[0], f"one in the other ({a:.2f} m2)")
    # ---- floating or sunk
    for label, shp, kind, y in things:
        c = shp.centroid
        if kind in ("railing", "piers", "rocks", "hedge", "bed"):
            continue
        if kind == "sedge" and y is not None and y < -0.02:
            continue  # (on the bank or in the shallows: checked above)
        if kind in WATER_KINDS or kind == "lily":
            want = -0.36 if kind in WATER_KINDS else -0.345
            if y is None or abs(y - want) > 0.03:
                if not (island.buffer(0.3).contains(c) and y is not None and abs(y - 0.18) < 0.05):
                    bad(label, c.coords[0], f"its foot at y {y} (the water is at {want})")
            continue
        if island.contains(c):
            if y is not None and y < 0.05:
                bad(label, c.coords[0], f"sunk in the island (y {y})")
            continue
        if y is not None and abs(y) > 0.001:
            bad(label, c.coords[0], f"its foot at y {y}, not on the ground")
        if not ground.contains(c) and kind not in ("benches", "lanterns"):
            bad(label, c.coords[0], "no ground under it")
        if kind in ("benches", "lanterns") and not (ground.contains(c) or ring.buffer(1.0).contains(c)):
            bad(label, c.coords[0], "outside the park's ground")
    # ---- walkable: the gates and every path's middle line, one piece of open ground with the Rijnkaai
    W = city["walk"]
    img = np.array(Image.open(os.path.join(ROOT, "client", "public", "city", "walk.png")).convert("RGB"))
    free = (img[..., 0] < 128) & (img[..., 1] < 128) & (img[..., 2] < 128)
    import scipy.ndimage as ndi

    lab, _ = ndi.label(free)
    cell = lambda x, z: (int((x - W["x0"]) / W["res"]), int((z - W["z0"]) / W["res"]))
    main_piece = lab[cell(20, 20)]
    deck = LineString([b["from"], b["to"]]).buffer(b["width"] / 2 - 0.1)

    def walk_ok(x, z):
        r, c = cell(x, z)
        return free[r, c] and lab[r, c] == main_piece

    for ox, oz, w in pk["openings"]:
        if not walk_ok(ox, oz):
            bad("gate", (ox, oz), "shut in the walk map, or not joined to the town")
    for li, L in enumerate(P.get("lines", [])):
        ln = LineString(L["pts"])
        n = int(ln.length / 0.5)
        blocked = []
        for k in range(n + 1):
            p = ln.interpolate(ln.length * k / max(n, 1))
            if not ring.buffer(0.8).contains(p):
                continue  # (the line runs a little out through the gate into the street)
            if not walk_ok(p.x, p.y):
                blocked.append((p.x, p.y))
        if blocked:
            bad(f"path {li + 1}", blocked[0], f"{len(blocked)} points of its middle line shut or cut off")
    return out


if __name__ == "__main__":
    probs = main()
    if probs:
        print(f"park check: {len(probs)} problems")
        for p in probs:
            print("  " + p)
        sys.exit(1)
    print("park check: nothing found")
