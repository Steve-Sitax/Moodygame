"""The town wall (Steve, 2026-09-25, with a painted map and four pictures of gates, stairs and guard
houses: "especially the back alleys and the wall around the city are the most work"; then, on the
plan: "the wall less blocked", "you can bend the walls, less straight the better").

The wall runs round the three land sides of the town as one bent line (TRACE, its field face): from
the river up the north side, along the inland side and down the south side to the river again, in
ten straight pieces that turn at bastions and at small bends. It only ever stands outward of the
compact map's houses (design.py fills the new ground between with blocks). Inward from the line:

  the rampart       7 m thick, its walk 6.5 m up: brick on a grey stone plinth, stone coping, a low
                    parapet on the town side, a breastwork with embrasures on the field side
  the wall street   8 m of cobbles along the inside (design.py keeps the blocks off it)
Outward:
  the berm          14 m of grass, a path and trees
  the moat          20 m of water, open to the Schelde at both ends (it has the river's tide)
  the far bank      20 m of grass and trees you may walk on, then the fields in the fog (not walkable)

Bastions: arrow-heads at five corners of the line (the two land corners, the middle of the inland
side with a windmill on it, a bend on the north and on the south side), half-bastions in the river at
both ends. Small square towers with a guard house stand out from the wall between them. Four gates,
each two square brick towers with slate pyramid roofs over an arched passage and a stone bridge over
the moat: the Rode Poort (north, by the Eilandje), the Keizerspoort and the Kipdorppoort (inland),
the Sint-Jorispoort (south). Stairs along the inside face lead from the wall street up to the walk.

Every part along the wall is given in its segment's frame: s metres along the segment from its start
(on the field face), o metres out from the wall's town face (o < 0: in the street, o = T: the field
face). The JSON carries each part's corners in world metres and the frame (origin o, along t, out n).

The game walks it all (client/src/world/rampart.ts reads DECOR rampart): the walk map (plan.py) has
the walk, the bastion tops and the stairs as open ground and the parapets, railings, guard houses,
the mill and the gate towers as walls, so the only way up is a stair; the heights come from here.
The Blender model (tools/blender/build_wall.py) is built from the same numbers.

World frame as design.py: x along the river (north), z inland (east), water at z < 0, metres.
"""

import math

from shapely.geometry import LineString, Point, Polygon, box
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

# the field face, from the north end at the river round to the south end at the river
TRACE = [(215.0, 0.0), (230.0, 92.0), (236.0, 205.0), (222.0, 318.0), (118.0, 352.0), (-60.0, 360.0),
         (-245.0, 352.0), (-360.0, 318.0), (-372.0, 215.0), (-364.0, 105.0), (-355.0, 0.0)]
SEG_NAMES = [f"seg{i}" for i in range(len(TRACE) - 1)]
# arrow-head bastions at corners of the line: trace index -> (name, flank, projection, salient)
BASTION_AT = {1: ("n_bend", 18.0, 10.0, 26.0), 3: ("ne", 25.0, 14.0, 42.0), 5: ("mid", 14.0, 10.0, 40.0),
              7: ("nw", 25.0, 14.0, 42.0), 8: ("s_bend", 18.0, 10.0, 26.0)}

TOWER_W, TOWER_OUT = 6.0, 4.0
HUT = 4.0  # the guard house: 4 x 4 m
# small square towers out from the field face: (segment, s)
TOWERS = [("seg0", 50.0), ("seg1", 80.0), ("seg2", 55.0), ("seg3", 55.0), ("seg4", 120.0), ("seg5", 140.0),
          ("seg6", 60.0), ("seg7", 55.0), ("seg9", 55.0)]

# the gates: segment, s (the passage's middle), name
GATES = [
    {"id": "rode_poort", "name": "Rode Poort", "seg": "seg1", "s": 30.0},  # z 122
    {"id": "keizerspoort", "name": "Keizerspoort", "seg": "seg4", "s": 54.1},  # x 64
    {"id": "kipdorppoort", "name": "Kipdorppoort", "seg": "seg5", "s": 85.1},  # x -145
    {"id": "sint_jorispoort", "name": "Sint-Jorispoort", "seg": "seg8", "s": 65.2},  # z 150
]
PASSAGE = 5.0  # the arch's width
GATE_TOWER = 6.5  # each tower's width along the wall
GATE_IN, GATE_OUT = 1.5, 4.0  # the gate house stands this far into the street and out past the wall
BRIDGE_W = 6.0

# stairs along the town face: segment, s of the foot, which way it climbs (+1: toward larger s).
# By a gate the foot is at the gate and the flight climbs away from it, so the landing meets the open walk.
STAIRS = [("seg0", 30.0, 1), ("seg1", 40.0, 1), ("seg2", 40.0, 1), ("seg3", 40.0, 1), ("seg4", 64.0, 1), ("seg4", 95.0, 1),
          ("seg5", 75.0, -1), ("seg5", 108.0, 1), ("seg6", 40.0, 1), ("seg7", 35.0, 1), ("seg8", 75.0, 1), ("seg9", 30.0, 1)]


def _unit(dx, dz):
    L = math.hypot(dx, dz) or 1.0
    return dx / L, dz / L


class Seg:
    """One straight piece of the wall. t runs along it, n points out to the field."""

    def __init__(self, name, a, b):
        self.name = name
        self.a, self.b = a, b
        self.t = _unit(b[0] - a[0], b[1] - a[1])
        self.n = (self.t[1], -self.t[0])  # going round from the north end, the field is on the right
        self.L = math.hypot(b[0] - a[0], b[1] - a[1])

    def pt(self, s, o):
        """s along from the start, o out from the town face (o = T is the field face)."""
        return (self.a[0] + self.t[0] * s + self.n[0] * (o - T), self.a[1] + self.t[1] * s + self.n[1] * (o - T))

    def rect(self, s0, s1, o0, o1):
        s0, s1 = min(s0, s1), max(s0, s1)
        o0, o1 = min(o0, o1), max(o0, o1)
        return Polygon([self.pt(s0, o0), self.pt(s1, o0), self.pt(s1, o1), self.pt(s0, o1)])

    def frame(self):
        return {"o": [round(self.a[0], 3), round(self.a[1], 3)], "t": [round(self.t[0], 5), round(self.t[1], 5)], "n": [round(self.n[0], 5), round(self.n[1], 5)]}


SEGS = {name: Seg(name, TRACE[i], TRACE[i + 1]) for i, name in enumerate(SEG_NAMES)}


def ring(p):
    return [[round(x, 2), round(z, 2)] for x, z in list(p.exterior.coords)[:-1]]


def corners(p):
    return [[round(x, 2), round(z, 2)] for x, z in list(p.exterior.coords)[:4]]


def pieces(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    return [p for p in getattr(g, "geoms", []) if p.geom_type == "Polygon"]


def inner_line():
    """The town face: the field face offset T inward, the corners mitred."""
    line = LineString(TRACE).offset_curve(T, join_style=2, mitre_limit=5.0)
    pts = list(line.coords)
    if math.dist(pts[0], TRACE[0]) > math.dist(pts[-1], TRACE[0]):
        pts = pts[::-1]
    return pts


def layout():
    inner = inner_line()
    assert len(inner) == len(TRACE), "the town face lost a corner"
    Pout = Polygon([(TRACE[0][0], -1.0)] + TRACE + [(TRACE[-1][0], -1.0)])
    Pin = Polygon([(inner[0][0], -1.0)] + inner + [(inner[-1][0], -1.0)])
    above = box(-1000, 0, 1000, 1000)
    bands = Pout.difference(Pin).intersection(above)
    town = Pin.intersection(above)
    bastions, bastion_list = {}, []
    for i, (name, f, p, sal) in BASTION_AT.items():
        s1, s2 = SEGS[SEG_NAMES[i - 1]], SEGS[SEG_NAMES[i]]
        V = TRACE[i]
        n1, n2 = s1.n, s2.n
        bis = _unit(n1[0] + n2[0], n1[1] + n2[1])
        A1 = (V[0] - s1.t[0] * f, V[1] - s1.t[1] * f)
        A2 = (V[0] + s2.t[0] * f, V[1] + s2.t[1] * f)
        pts = [A1, (A1[0] + n1[0] * p, A1[1] + n1[1] * p), (V[0] + bis[0] * sal, V[1] + bis[1] * sal), (A2[0] + n2[0] * p, A2[1] + n2[1] * p), A2,
               (A2[0] - n2[0] * T, A2[1] - n2[1] * T), inner[i], (A1[0] - n1[0] * T, A1[1] - n1[1] * T)]
        bastions[name] = Polygon(pts).buffer(0)
        bastion_list.append({"name": name, "vertex": [V[0], V[1]], "salient": [round(V[0] + bis[0] * sal, 2), round(V[1] + bis[1] * sal, 2)]})
    mid = BASTION_AT[5]
    V = TRACE[5]
    b5 = _unit(SEGS["seg4"].n[0] + SEGS["seg5"].n[0], SEGS["seg4"].n[1] + SEGS["seg5"].n[1])
    mill = (V[0] + b5[0] * mid[3] * 0.5, V[1] + b5[1] * mid[3] * 0.5)
    # half-bastions in the river at both ends of the quays
    E_IN, W_IN = inner[0][0], inner[-1][0]
    E_OUT, W_OUT = TRACE[0][0], TRACE[-1][0]
    bastions["se"] = Polygon([(E_IN, 0.0), (E_IN, -10.0), (E_OUT, -20.0), (E_OUT + 13.0, -20.0), (E_OUT + 13.0, 0.0)])
    bastions["sw"] = Polygon([(W_IN, 0.0), (W_IN, -10.0), (W_OUT, -20.0), (W_OUT - 13.0, -20.0), (W_OUT - 13.0, 0.0)])
    towers, huts, tower_list = [], [], []
    for sg, s in TOWERS:
        S = SEGS[sg]
        t = S.rect(s - TOWER_W / 2, s + TOWER_W / 2, T - 0.01, T + TOWER_OUT)
        hut = S.rect(s - HUT / 2, s + HUT / 2, T + TOWER_OUT - HUT, T + TOWER_OUT)
        towers.append(t)
        huts.append(hut)
        door = S.pt(s, T + TOWER_OUT - HUT)
        tower_list.append({"seg": sg, "s": s, "frame": S.frame(), "rect": corners(t), "hut": corners(hut), "door": [round(door[0], 2), round(door[1], 2)]})
    # guard houses on the land bastions (not the mill's), turned with the bastion; on the river ones by the point
    for b in bastion_list:
        if b["name"] == "mid":
            continue
        vx, vz = b["vertex"]
        sx, sz = b["salient"]
        u = _unit(sx - vx, sz - vz)
        c = (vx + u[0] * 12.0, vz + u[1] * 12.0)
        w = (u[1], -u[0])
        h = HUT / 2
        huts.append(Polygon([(c[0] + u[0] * sa * h + w[0] * sb * h, c[1] + u[1] * sa * h + w[1] * sb * h) for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))]))
        b["hut"] = corners(huts[-1])
    huts.append(box(E_OUT + 2.0, -14.0, E_OUT + 2.0 + HUT, -10.0))
    huts.append(box(W_OUT - 2.0 - HUT, -14.0, W_OUT - 2.0, -10.0))
    # the mill: a round brick tower mill on the middle bastion (a solid disc in the walk map)
    mill_disc = Point(mill).buffer(3.4, resolution=8)
    gates, gate_houses, passages, roads, bridges, door_bands = [], [], [], [], {}, []
    for g in GATES:
        S = SEGS[g["seg"]]
        s = g["s"]
        house = S.rect(s - PASSAGE / 2 - GATE_TOWER, s + PASSAGE / 2 + GATE_TOWER, -GATE_IN, T + GATE_OUT)
        passage = S.rect(s - PASSAGE / 2, s + PASSAGE / 2, -GATE_IN - 0.01, T + GATE_OUT + 0.01)
        road = S.rect(s - BRIDGE_W / 2, s + BRIDGE_W / 2, T + GATE_OUT, T + BERM + 0.5)
        bridge = S.rect(s - BRIDGE_W / 2, s + BRIDGE_W / 2, T + BERM - 0.5, T + BERM + MOAT + 0.5)
        # the road on across the far bank to the edge of the map (world/countryside.ts carries it on beyond)
        far_road = S.rect(s - BRIDGE_W / 2, s + BRIDGE_W / 2, T + BERM + MOAT + 0.5, T + BERM + MOAT + 400)
        gate_houses.append(house)
        passages.append(passage)
        roads.append(road)
        roads.append(far_road)
        bridges[g["id"]] = {"kind": "gate", "rect": [round(v, 2) for v in bridge.bounds]}
        mouth = S.pt(s, -GATE_IN)
        # the gates are shut (Steve, 2026-09-25: "we cannot leave the city"): the leaves across the arch at the field end
        doors = S.rect(s - PASSAGE / 2 - 0.05, s + PASSAGE / 2 + 0.05, T + GATE_OUT - 1.0, T + GATE_OUT - 0.5)
        door_bands.append(doors)
        gates.append({**g, "frame": S.frame(), "house": corners(house), "passage": corners(passage), "bridge": corners(bridge), "road": corners(road), "doors": corners(doors), "far_road": corners(far_road),
                      "out": [round(S.n[0], 4), round(S.n[1], 4)], "mouth": [round(mouth[0], 2), round(mouth[1], 2)],
                      # where the pair of sentries stands: the town side, either side of the arch
                      "posts": [[round(c, 2) for c in S.pt(s + k * (PASSAGE / 2 + 1.0), -GATE_IN - 0.8)] for k in (-1, 1)]})
    body = unary_union([bands] + list(bastions.values()) + towers).difference(unary_union(gate_houses))
    stairs, rails, gaps = [], [], []
    for sg, foot, d in STAIRS:
        S = SEGS[sg]
        head = foot + d * STAIR_RUN
        end = head + d * LANDING
        flight = S.rect(foot, head, -STAIR_W, 0.0)
        landing = S.rect(head, end, -STAIR_W, 0.0)
        a = S.pt(foot, -STAIR_W / 2)
        b = S.pt(head, -STAIR_W / 2)
        stairs.append({"seg": sg, "s": foot, "dir": d, "frame": S.frame(), "a": [round(a[0], 2), round(a[1], 2)], "b": [round(b[0], 2), round(b[1], 2)],
                       "half": STAIR_W / 2, "flight": corners(flight), "landing": corners(landing)})
        rails.append(S.rect(foot, end, -STAIR_W - RAIL, -STAIR_W))
        rails.append(S.rect(end, end + d * RAIL, -STAIR_W - RAIL, 0.0))
        gaps.append(S.rect(head - d * 0.8, end + d * 0.6, -0.1, PARAPET + 0.4))
    parapets = body.difference(body.buffer(-PARAPET, join_style=2)).difference(unary_union(gaps))
    # the berm, the moat and the far bank go round the wall, its bastions and towers
    # (the gate houses stand out into the berm: the moat runs straight past them, so each bridge spans it)
    core = unary_union([Pout.intersection(above)] + [bastions[b["name"]] for b in bastion_list] + towers)
    fort = core.union(unary_union(gate_houses))
    berm_out = core.buffer(BERM, join_style=2, mitre_limit=1.3)
    moat_out = core.buffer(BERM + MOAT, join_style=2, mitre_limit=1.3)
    # (the gates are shut: nobody walks outside the wall; the berm, the moat and the far bank are scenery,
    # world/countryside.ts draws the land beyond)
    walk_out = fort.buffer(0.01)
    scenery_out = core.buffer(BERM + MOAT + FAR, join_style=2, mitre_limit=1.3)
    moat = moat_out.difference(berm_out)
    river_bastions = unary_union([bastions["se"], bastions["sw"]])
    solids = unary_union(pieces(parapets) + rails + huts + [mill_disc] + door_bands + [gh.difference(ps) for gh, ps in zip(gate_houses, passages)])
    # the bridges' parapets: low brick walls along both sides of each deck
    for g in GATES:
        S = SEGS[g["seg"]]
        for k in (-1, 1):
            e = g["s"] + k * BRIDGE_W / 2
            solids = solids.union(S.rect(e, e - k * 0.5, T + BERM - 0.5, T + BERM + MOAT + 0.5))
    grass_hint = scenery_out.difference(fort).difference(unary_union(roads))
    trees = []
    # a row of trees along the middle of the berm, and two rows on the far bank; none on the gate roads
    for dist, step in ((BERM * 0.55, 13.0), (BERM + MOAT + 5.0, 14.0), (BERM + MOAT + 14.0, 19.0)):
        line = core.buffer(dist, join_style=2, mitre_limit=1.3).exterior
        L = line.length
        k = 0.0
        while k < L:
            p = line.interpolate(k)
            ok = p.y > 4.0 and not any(r.buffer(4.0).contains(p) for r in roads) and not any(Polygon(g["bridge"]).buffer(6.0).contains(p) for g in gates)
            if ok:
                trees.append([round(p.x, 1), round(p.y, 1)])
            k += step
    return {
        "body": body, "fort": fort, "moat": moat, "walk_out": walk_out, "scenery_out": scenery_out, "river_bastions": river_bastions, "town": town,
        "solids": solids, "grass": grass_hint, "bridges": bridges, "trees": trees, "roads": roads, "passages": passages,
        "decor": {
            "h": H, "t": T, "parapet": PARAPET, "rail": RAIL,
            # the town's box inside the wall (world/townBox.ts)
            "inner": {"west": round(min(p[0] for p in inner), 2), "north": round(max(p[1] for p in inner), 2), "east": round(max(p[0] for p in inner), 2)},
            "trace": [[round(x, 2), round(z, 2)] for x, z in TRACE],
            "inner_line": [[round(x, 2), round(z, 2)] for x, z in inner],
            "segments": [{"name": n, **SEGS[n].frame(), "len": round(SEGS[n].L, 2)} for n in SEG_NAMES],
            # inside this, 2.6 m clear of the town face, nothing of the wall stands (a quick no for the heights)
            "clear": ring(town.buffer(-2.6, join_style=2)),
            "tops": [ring(p) for p in pieces(body)],
            "bastions": {k: ring(v) for k, v in bastions.items()},
            "bastion_list": bastion_list,
            "mill": {"x": round(mill[0], 2), "z": round(mill[1], 2), "r": 3.4},
            "towers": tower_list,
            "huts": [corners(h) for h in huts],
            "gates": gates,
            "stairs": stairs,
        },
    }


if __name__ == "__main__":
    L = layout()
    print("tops", len(L["decor"]["tops"]), "gates", len(L["decor"]["gates"]), "stairs", len(L["decor"]["stairs"]), "trees", len(L["trees"]))
    print("moat area", round(L["moat"].area), "walk_out bounds", [round(v) for v in L["walk_out"].bounds], "inner", L["decor"]["inner"])
