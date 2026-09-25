"""The town wall (Steve, 2026-09-25, with a painted map and four pictures of gates, stairs and guard
houses: "especially the back alleys and the wall around the city are the most work").

The compact map (design.py) ends in houses on three sides: x -340 (south, up river), z 300 (east,
inland) and x 200 (north, the Eilandje). Round those three sides, outward from the house fronts:

  the wall street   8 m of cobbles along the inside of the wall
  the rampart       7 m thick, its walk 6.5 m up: brick on a grey stone plinth, stone coping, a low
                    parapet on the town side, a breastwork with embrasures on the field side
  the berm          14 m of grass outside the wall, a path and trees
  the moat          20 m of water, open to the Schelde at both ends (it has the river's tide)
  the far bank      20 m of grass and trees you may walk on, then the fields in the fog (not walkable)

Bastions: an arrow-head bastion at each land corner, a half-bastion in the river at each end.
Small square towers with a guard house on top stand out from the wall between them. Four gates, each
two square brick towers with slate pyramid roofs over an arched passage, a stone bridge over the
moat: the Rode Poort (north, by the Eilandje), the Keizerspoort and the Kipdorppoort (east), the
Sint-Jorispoort (south). Stairs along the inside face lead from the wall street up to the walk.

The game walks it all (client/src/world/rampart.ts reads DECOR rampart): the walk map (plan.py) has
the walk, the bastion tops and the stairs as open ground and the parapets, railings, guard houses and
gate towers as walls, so the only way up is a stair; the heights come from here. The Blender model
(tools/blender/build_wall.py) is built from the same numbers.

World frame as design.py: x along the river (north), z inland (east), water at z < 0, metres.
"""

import math

from shapely.geometry import Polygon, box
from shapely.ops import unary_union

H = 6.5  # the walk's height over the street
T = 7.0  # the wall's thickness
STREET = 8.0  # the wall street
BERM = 14.0
MOAT = 20.0
FAR = 20.0  # the far bank you may walk on
PARAPET = 0.8  # parapets in the walk map (the model's are thinner); 0.8 so a slanted one has no gap between cells
RAIL = 0.5  # the stairs' railings in the walk map
STAIR_W = 1.8
STAIR_RUN = 11.7  # 36 steps of 0.18 m rise on 0.325 m treads
LANDING = 2.4

# the inner faces (the town side) and the outer faces of the three land sides
W_IN, N_IN, E_IN = -348.0, 308.0, 208.0
W_OUT, N_OUT, E_OUT = W_IN - T, N_IN + T, E_IN + T

# the wall's body, side by side (x0, z0, x1, z1)
BANDS = {
    "west": (W_OUT, 0.0, W_IN, N_OUT),
    "north": (W_OUT, N_IN, E_OUT, N_OUT),
    "east": (E_IN, 0.0, E_OUT, N_OUT),
}


def _corner(cx, cz, sx):
    """An arrow-head bastion at a land corner (cx, cz = the wall's outer corner); sx = +1 east, -1 west."""
    pts = [(0, -25), (14, -25), (29, 29), (-25, 14), (-25, 0), (0, 0)]
    return [(cx + sx * a, cz + b) for a, b in pts]


BASTIONS = {
    "ne": _corner(E_OUT, N_OUT, 1),
    "nw": _corner(W_OUT, N_OUT, -1),
    # half-bastions in the river at the two ends of the quays
    "se": [(E_IN, 0.0), (E_IN, -10.0), (E_OUT, -20.0), (E_OUT + 13.0, -20.0), (E_OUT + 13.0, 0.0)],
    "sw": [(W_IN, 0.0), (W_IN, -10.0), (W_OUT, -20.0), (W_OUT - 13.0, -20.0), (W_OUT - 13.0, 0.0)],
}

# small square towers out from the outer face, a guard house on each: (side, position along it)
TOWERS = [("north", -290.0), ("north", -215.0), ("north", -40.0), ("north", 20.0), ("north", 150.0),
          ("east", 50.0), ("east", 190.0), ("east", 250.0), ("west", 60.0), ("west", 230.0)]
TOWER_W, TOWER_OUT = 6.0, 4.0
HUT = 4.0  # the guard house: 4 x 4 m

# the gates: side, the passage's middle along the wall, its name
GATES = [
    {"id": "rode_poort", "name": "Rode Poort", "side": "east", "at": 122.0},
    {"id": "keizerspoort", "name": "Keizerspoort", "side": "north", "at": 90.0},
    {"id": "kipdorppoort", "name": "Kipdorppoort", "side": "north", "at": -145.0},
    {"id": "sint_jorispoort", "name": "Sint-Jorispoort", "side": "west", "at": 150.0},
]
PASSAGE = 5.0  # the arch's width
GATE_TOWER = 6.5  # each tower's width along the wall
GATE_IN, GATE_OUT = 1.5, 4.0  # the gate house stands this far into the street and out past the wall
BRIDGE_W = 6.0

# stairs from the wall street up to the walk: side, where the foot is (along the wall), which way it climbs
# (by a gate the foot is at the gate and the flight climbs away from it, so the landing meets the open walk)
STAIRS = [
    ("east", 112.0, -1), ("east", 240.0, 1), ("east", 20.0, 1),  # by the Rode Poort, the north-east corner, the river end
    ("north", -156.5, -1), ("north", 79.0, -1), ("north", -300.0, 1), ("north", -40.0, 1), ("north", 175.0, 1),
    ("west", 140.0, -1), ("west", 40.0, 1), ("west", 250.0, 1),
]


def _side_frame(side):
    """For a side: (along axis index, inner face coordinate, outward sign). Along: 1 = z (west/east), 0 = x (north)."""
    return {"west": (1, W_IN, -1.0), "east": (1, E_IN, 1.0), "north": (0, N_IN, 1.0)}[side]


def _rect_side(side, a0, a1, o0, o1):
    """A rectangle given along the side (a0..a1) and outward from the inner face (o0..o1, + = out of town)."""
    along, face, sgn = _side_frame(side)
    c0, c1 = face + sgn * o0, face + sgn * o1
    lo, hi = min(c0, c1), max(c0, c1)
    if along == 1:
        return box(lo, a0, hi, a1)
    return box(a0, lo, a1, hi)


def _pt_side(side, a, o):
    along, face, sgn = _side_frame(side)
    c = face + sgn * o
    return (c, a) if along == 1 else (a, c)


def ring(p):
    return [[round(x, 2), round(z, 2)] for x, z in list(p.exterior.coords)[:-1]]


def layout():
    bands = [box(*b) for b in BANDS.values()]
    bastions = [Polygon(p) for p in BASTIONS.values()]
    towers, huts = [], []
    tower_list = []
    for side, at in TOWERS:
        t = _rect_side(side, at - TOWER_W / 2, at + TOWER_W / 2, T - 0.01, T + TOWER_OUT)
        towers.append(t)
        # the guard house on the tower, its back on the tower's outer edge; its door faces the walk
        hut = _rect_side(side, at - HUT / 2, at + HUT / 2, T + TOWER_OUT - HUT, T + TOWER_OUT)
        huts.append(hut)
        door = _pt_side(side, at, T + TOWER_OUT - HUT)
        tower_list.append({"side": side, "at": at, "rect": [round(v, 2) for v in t.bounds], "hut": [round(v, 2) for v in hut.bounds],
                           "door": [round(door[0], 2), round(door[1], 2)]})
    # guard houses on the bastions: on the land bastions by the salient, on the river ones by the point
    bastion_huts = {"ne": (E_OUT + 6.0, N_OUT + 6.0), "nw": (W_OUT - 6.0 - HUT, N_OUT + 6.0), "se": (E_OUT + 2.0, -14.0), "sw": (W_OUT - 2.0 - HUT, -14.0)}
    for k, (x0, z0) in bastion_huts.items():
        huts.append(box(x0, z0, x0 + HUT, z0 + HUT))
    gates, gate_houses, passages, roads, bridges = [], [], [], [], {}
    for g in GATES:
        side, at = g["side"], g["at"]
        house = _rect_side(side, at - PASSAGE / 2 - GATE_TOWER, at + PASSAGE / 2 + GATE_TOWER, -GATE_IN, T + GATE_OUT)
        passage = _rect_side(side, at - PASSAGE / 2, at + PASSAGE / 2, -GATE_IN - 0.01, T + GATE_OUT + 0.01)
        road = _rect_side(side, at - BRIDGE_W / 2, at + BRIDGE_W / 2, T + GATE_OUT, T + BERM + 0.5)
        bridge = _rect_side(side, at - BRIDGE_W / 2, at + BRIDGE_W / 2, T + BERM - 0.5, T + BERM + MOAT + 0.5)
        gate_houses.append(house)
        passages.append(passage)
        roads.append(road)
        bridges[g["id"]] = {"kind": "gate", "rect": [round(v, 2) for v in bridge.bounds]}
        out = _pt_side(side, at, 1.0)
        inn = _pt_side(side, at, 0.0)
        gates.append({**g, "house": [round(v, 2) for v in house.bounds], "passage": [round(v, 2) for v in passage.bounds],
                      "bridge": [round(v, 2) for v in bridge.bounds], "road": [round(v, 2) for v in road.bounds],
                      "out": [round(out[0] - inn[0], 3), round(out[1] - inn[1], 3)],
                      # where the pair of sentries stands: the town side, either side of the arch, 1.5 m out of the towers
                      "posts": [[round(c, 2) for c in _pt_side(side, at + s * (PASSAGE / 2 + 1.0), -GATE_IN - 0.8)] for s in (-1, 1)]})
    # the walk: bands, bastions and towers, less the gate houses (you cannot walk through them up there)
    body = unary_union(bands + bastions + towers).difference(unary_union(gate_houses))
    stairs, stair_polys, rails, gaps = [], [], [], []
    for side, foot, d in STAIRS:
        along, face, sgn = _side_frame(side)
        head = foot + d * STAIR_RUN
        end = head + d * LANDING
        flight = _rect_side(side, min(foot, head), max(foot, head), -STAIR_W, 0.0)
        landing = _rect_side(side, min(head, end), max(head, end), -STAIR_W, 0.0)
        a = _pt_side(side, foot, -STAIR_W / 2)
        b = _pt_side(side, head, -STAIR_W / 2)
        stairs.append({"side": side, "a": [round(a[0], 2), round(a[1], 2)], "b": [round(b[0], 2), round(b[1], 2)], "half": STAIR_W / 2,
                       "flight": [round(v, 2) for v in flight.bounds], "landing": [round(v, 2) for v in landing.bounds]})
        stair_polys.append(flight.union(landing))
        # the railing on the street side, the full length, and across the landing's end
        rails.append(_rect_side(side, min(foot, end), max(foot, end), -STAIR_W - RAIL, -STAIR_W))
        rails.append(_rect_side(side, min(end, end + d * RAIL), max(end, end + d * RAIL), -STAIR_W - RAIL, 0.0))
        # the gap in the town-side parapet where the landing meets the walk
        gaps.append(_rect_side(side, min(head - d * 0.8, end + d * 0.6), max(head - d * 0.8, end + d * 0.6), -0.1, PARAPET + 0.4))
    parapets = body.difference(body.buffer(-PARAPET, join_style=2)).difference(unary_union(gaps))
    # everything the wall stands on, gates and towers too: the berm, the moat and the far bank go round it
    town = box(W_IN, 0.0, E_IN, N_IN)
    # (the gate houses stand out into the berm: the moat runs straight past them, so each bridge spans it)
    core = unary_union([town] + bands + bastions + towers)
    fort = core.union(unary_union(gate_houses))
    berm_out = core.buffer(BERM, join_style=2, mitre_limit=1.3)
    moat_out = core.buffer(BERM + MOAT, join_style=2, mitre_limit=1.3)
    walk_out = core.buffer(BERM + MOAT + FAR, join_style=2, mitre_limit=1.3)
    moat = moat_out.difference(berm_out)
    # the river half-bastions stand in the river: the water gives way to them (design.py)
    river_bastions = unary_union([Polygon(BASTIONS["se"]), Polygon(BASTIONS["sw"])])
    solids = unary_union([p for p in pieces(parapets)] + rails + huts + [gh.difference(ps) for gh, ps in zip(gate_houses, passages)])
    # the bridges' parapets: low brick walls along both sides of each deck
    for g in GATES:
        side, at = g["side"], g["at"]
        for s in (-1, 1):
            e = at + s * BRIDGE_W / 2
            solids = solids.union(_rect_side(side, min(e, e - s * 0.5), max(e, e - s * 0.5), T + BERM - 0.5, T + BERM + MOAT + 0.5))
    grass_hint = walk_out.difference(fort).difference(unary_union(roads))
    trees = []
    # a row of trees along the middle of the berm, and two rows on the far bank; none on the gate roads
    for dist, step in ((BERM * 0.55, 13.0), (BERM + MOAT + 5.0, 14.0), (BERM + MOAT + 14.0, 19.0)):
        line = core.buffer(dist, join_style=2, mitre_limit=1.3).exterior
        L = line.length
        k = 0.0
        while k < L:
            p = line.interpolate(k)
            ok = p.y > 4.0 and not any(r.buffer(4.0).contains(p) for r in roads) and not any(bb["rect"] and box(*bb["rect"]).buffer(6.0).contains(p) for bb in bridges.values())
            if ok:
                trees.append([round(p.x, 1), round(p.y, 1)])
            k += step
    return {
        "body": body, "fort": fort, "moat": moat, "walk_out": walk_out, "river_bastions": river_bastions,
        "solids": solids, "grass": grass_hint, "bridges": bridges, "trees": trees,
        "decor": {
            "h": H, "t": T, "inner": {"west": W_IN, "north": N_IN, "east": E_IN}, "outer": {"west": W_OUT, "north": N_OUT, "east": E_OUT},
            "tops": [ring(p) for p in pieces(body)],
            "bands": {k: list(v) for k, v in BANDS.items()},
            "bastions": {k: [[round(x, 2), round(z, 2)] for x, z in v] for k, v in BASTIONS.items()},
            "towers": tower_list,
            "huts": [[round(v, 2) for v in h.bounds] for h in huts],
            "gates": gates,
            "stairs": stairs,
            "parapet": PARAPET, "rail": RAIL,
        },
    }


def pieces(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]


if __name__ == "__main__":
    L = layout()
    print("tops", len(L["decor"]["tops"]), "gates", len(L["decor"]["gates"]), "stairs", len(L["decor"]["stairs"]), "trees", len(L["trees"]))
    print("moat area", round(L["moat"].area), "walk_out bounds", [round(v) for v in L["walk_out"].bounds])
