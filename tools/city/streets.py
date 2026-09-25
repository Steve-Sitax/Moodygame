"""Angled and winding streets (Steve, 2026-09-25: "Too bad the streets all are in sort of a grid with 90
degree angles. Antwerp has more streets on angles"; then on the plans: houses up to the bent wall, no
straight edge; a park or open space as the town had; no impossibly small houses; a straight road to
every gate; inner courtyards and tiny alleys like the Vlaeykensgang in the big blocks).

design.py's BLOCKS are the compact map's rectangles. Here some of them are merged into ZONES, the new
ground inside the bent wall is added to them, and each zone is cut again by the STREETS below and the
open places (the Stadspark, the squares). What stays of a zone becomes the new blocks; nothing
narrower than MIN_W survives as a block (a thin strip becomes street or square). Blocks outside every
zone stay as they were: the quays, the Steenplein, the Grote Markt, the Petit Bassin, the Werf.

Kept on purpose: the omnibus town ring (x -89.5/-84.5 on the canal quay, x -149/-145 west of the
Vleeshuis, z 126-130 into the Handschoenmarkt, round the Grote Markt), the street behind the Rijnkaai
(z 40-46), the canal and the vliet with their bridges, every landmark.

    python tools/city/streets.py     a picture of the plan (data/shots/streets_plan.png)
"""

import math

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

MIN_W = 8.0  # the narrowest block

# name: centreline (world x, z), width. Letters as on the plans shown to Steve.
STREETS = {
    "A": ([(-182, 128), (-172, 170), (-150, 212)], 7),  # Handschoenmarkt -> the Kipdorppoort street
    "B": ([(-72, 158), (-10, 205), (40, 245), (60, 290), (64, 352)], 8),  # canal head -> Keizerspoort
    "D": ([(58, 170), (130, 192), (212, 200)], 7),  # Eilandje -> wall street
    "E": ([(-145, 238), (-100, 234), (-62, 244), (-30, 238), (10, 232), (34, 238)], 6),  # a crooked street from O into B
    "F": ([(-62, 72), (0, 66), (64, 60)], 7),  # behind the Rijnkaai: bent cross streets
    "G": ([(-62, 114), (-5, 105), (64, 114)], 7),
    "H": ([(-6, 40), (-3, 88), (8, 152)], 6),
    "I": ([(33, 40), (28, 100), (42, 152)], 6),
    "J": ([(-142, 160), (-90, 146)], 7),  # Vismarkt quarter, slanted toward the Vleeshuis
    "K": ([(-202, 86), (-154, 72)], 7),  # Steen quarter, toward the Grote Markt
    "L": ([(-142, 262), (-100, 266), (-46, 256), (-4, 272), (30, 296), (64, 306)], 6),  # a winding street
    "M": ([(135, 194), (148, 246), (160, 300), (150, 340)], 6),  # from D up to the wall street
    "N": ([(38, 244), (96, 232), (148, 246)], 6),  # from B across to M
    "O": ([(-145, 205), (-145, 352)], 9),  # the Kipdorppoort street, on to its gate
    "Q": ([(150, 292), (100, 304), (64, 308)], 6),
    "R": ([(-30, 258), (-24, 362)], 5),
    "V": ([(200, 60), (240, 64)], 6),  # lanes across the new ground by the north wall
    "W": ([(200, 150), (240, 156)], 6),
    "X": ([(-360, 60), (-310, 64)], 6),  # and along the south wall
    "Y": ([(-362, 250), (-310, 246)], 6),
    "S": ([(-150, 265), (-200, 272), (-240, 300), (-268, 340)], 7),  # round the Stadspark
    "T": ([(-216, 212), (-212, 252), (-232, 300)], 6),
    "U": ([(-360, 150), (-300, 150), (-284, 146)], 9),  # the Sint-Jorispoort, straight into the Handschoenmarkt
}

# open places: the Stadspark (laid out 1867-69 on the old Spanish ramparts; its pond is the old
# moat), a square with trees where B and L meet (like the Groenplaats), the square before the
# Carolus Borromeus church (the Conscienceplein)
PARK = [(-356, 312), (-340, 296), (-300, 278), (-262, 286), (-250, 316), (-262, 342), (-300, 348), (-352, 330)]
POND = [((-306, 318), 13.0), ((-286, 302), 8.0)]
# gravel paths: round the pond and across to the streets (packed earth in the game)
PARK_PATHS = [
    ([(-262, 300), (-275, 290), (-292, 288), (-300, 298), (-322, 300), (-326, 318), (-318, 336), (-296, 338), (-282, 326), (-270, 314), (-262, 300)], 2.4),
    ([(-250, 318), (-270, 314)], 2.4),
    ([(-300, 280), (-292, 288)], 2.4),
    ([(-338, 300), (-322, 300)], 2.2),
]
SQUARES = {
    "tree_square": ([(20, 296)], 15.0),
    "conscienceplein": ([(-116, 166)], 11.0),
}


def zones(blocks, town_ok):
    """The zones: (kind, polygon). blocks: design.py's BLOCKS polygons, by index. town_ok: the town
    inside the wall street."""
    U = lambda ids: unary_union([blocks[i].buffer(0.01) for i in ids]).buffer(-0.01)
    return {
        "north": U([5, 14, 15, 19]).union(box(56, 172, 62, 228)).union(box(-140, 280, 260, 500)).intersection(town_ok).difference(box(-150, 0, -140, 500)),
        # (the row along the south wall grows out to the bent wall: its houses face the wall street)
        "cathedral": U([25, 26, 28, 29, 30]).union(box(-400, 14, -150, 500)).intersection(town_ok).difference(box(-150, 0, -140, 500)).difference(box(-310, 0, -150, 280)).union(U([25, 28, 29, 30])),
        # (the two storehouses by the Hessenatie stay storehouses)
        "aldegonde": box(-60, 46, 62, 150).difference(box(30, 40, 70, 106)),
        # new ground between the Eilandje's blocks and the bent north wall, behind the old wall street
        "east_edge": town_ok.intersection(box(208, 0, 400, 400)).difference(box(-500, 300, 400, 500)),
        "vismarkt": U([17, 18]).union(box(-140, 150, -92, 157)),
        # the vliet: 8-10 m quays on both sides for the wagons (Steve)
        "steen": U([20, 21]).union(box(-200, 74, -156, 82)).difference(box(-162, 0, -150, 130)),
        "vleeshuis_s": U([16]).difference(box(-140, 0, -133, 90)),
    }, {"north": [5, 14, 15, 19], "cathedral": [25, 26, 28, 29, 30], "aldegonde": [6, 7, 9, 10, 12, 13], "east_edge": [], "vismarkt": [17, 18], "steen": [20, 21], "vleeshuis_s": [16]}


def open_places():
    park = Polygon(PARK)
    squares = unary_union([Point(p[0]).buffer(r, resolution=4) for p, r in SQUARES.values()])
    return park, squares


def recut(blocks, kinds, town_ok, landmark_cut):
    """The blocks after the re-cut: [(kind, polygon)]. Blocks in no zone come through as they were."""
    Z, members = zones(blocks, town_ok)
    used = {i for ids in members.values() for i in ids}
    park, squares = open_places()
    cuts = unary_union([LineString(p).buffer(w / 2, cap_style=2, join_style=2) for p, w in STREETS.values()] + [park.buffer(2.0), squares, landmark_cut])
    out = [(kinds[i], b) for i, b in enumerate(blocks) if i not in used]
    for name, z in Z.items():
        g = z.difference(cuts)
        # no block narrower than MIN_W: a thin strip becomes street or square (Steve: "impossible small houses")
        g = g.buffer(-MIN_W / 2, join_style=2).buffer(MIN_W / 2, join_style=2).intersection(g)
        for p in getattr(g, "geoms", [g]):
            if p.geom_type == "Polygon" and p.area > 150:
                out.append(("houses", p.simplify(0.2)))
    return out


if __name__ == "__main__":
    import json
    import os
    import sys

    sys.path.insert(0, os.path.dirname(__file__))
    import design  # noqa: E402
    from PIL import Image, ImageDraw, ImageFont

    C = json.load(open(design.OUT))
    S, (X0, X1, Z0, Z1) = 1.9, (-480, 340, -60, 480)
    im = Image.new("RGB", (int((X1 - X0) * S), int((Z1 - Z0) * S)), (224, 212, 184))
    d = ImageDraw.Draw(im)
    P = lambda x, z: ((X1 - x) * S, (Z1 - z) * S)
    poly = lambda pts, **k: d.polygon([P(x, z) for x, z in pts], **k)
    for g in C["decor"].get("grass", []):
        poly(g["outer"], fill=(185, 194, 148))
    for w in C["water"]:
        poly(w["outer"], fill=(150, 176, 178))
    poly(PARK, fill=(150, 180, 110))
    for (c, r) in POND:
        poly(list(Point(c).buffer(r).exterior.coords), fill=(150, 176, 178))
    for b in C["blocks"]:
        poly(b["outer"], fill=(196, 120, 90), outline=(110, 40, 30))
    for l in C["designedLandmarks"].values():
        poly(l["fp"], fill=(216, 164, 90), outline=(90, 58, 26))
    for r in C["decor"]["rampart"]["tops"]:
        poly(r, fill=(120, 60, 48))
    for g in C["decor"]["rampart"]["gates"]:
        poly(g["house"], fill=(70, 36, 28))
    f = ImageFont.truetype("arialbd.ttf", 16)
    for k, (pts, w) in STREETS.items():
        x, z = LineString(pts).interpolate(0.5, normalized=True).coords[0]
        u, v = P(x, z)
        d.text((u - 5, v - 9), k, fill=(200, 30, 30), font=f)
    out = os.path.join(design.ROOT, "data", "shots", "streets_plan.png")
    im.save(out)
    print(out)
