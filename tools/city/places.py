"""The prison, the round square and the greens (M7 prison and squares, 2026-09-26; docs/milestones/M7-prison-squares.md).

Steve, 2026-09-26: "Grass places, a circle square somewhere, decorate. We also need a prison somewhere: find a
building or multiple and put the prison there, with high detail inside and out."

One source for the numbers of these places. Writes shared/townplaces.json, which these read:
  tools/city/plan.py        walk_map (the prison's compound, the railings, benches, trunks, the fountain, the
                            kiosk as wall) and ground_zones (the greens' grass and paths; the round square's
                            disc and the prison's compound taken out of the zones: their own ground is drawn)
  tools/blender/build_prison.py   the prison (client/public/models/prison.glb)
  tools/blender/build_places.py   the square's fountain, kiosk, urinal, benches, railings, beds (places.glb)
  client/src/world/places.ts      the square's ground, trees, furniture and colliders; the greens
  client/src/world/prison.ts      the prison in the world; shared/prisonPlan.ts has its frame again (a test
                                  checks the two agree: server/test/prison.test.ts)

It also marks the houses the prison stands on as "gone" in shared/city_build.json (never deletes or reorders an
entry: saves, homes and taverns hold house numbers; every reader skips a gone house, and the server re-homes
anyone who lived there, store.ts rehomeLost), and takes the court's pump out of shared/city.json alleys.pumps
where it stood inside the prison.

    python tools/city/places.py            write townplaces.json, mark the gone houses (idempotent)
    python tools/city/places.py --check    print what it would do, write nothing
Then, under the walk-map lock: python tools/city/plan.py --ground and python tools/city/walk_only.py.
"""

import json
import math
import os
import sys

from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CITY = os.path.join(ROOT, "shared", "city.json")
BUILD = os.path.join(ROOT, "shared", "city_build.json")
OUT = os.path.join(ROOT, "shared", "townplaces.json")

R2 = lambda v: round(v, 3)  # noqa: E731


# ================================================================== the prison
#
# The Antwerp prison of 1855 (Begijnenstraat; built 1854-59 to J. J. Dumont's plan, the cellular system of
# Ducpetiaux: a front building with the gate, cell wings round a central watch pavilion, a high wall) put on
# the block south of the cathedral, between the cathedral's south street and the wall street (the real one
# stood south of the old centre too). Its front is the wall street's north side, where a row of houses stood;
# the houses along the cathedral's south street and the corner houses keep standing, their backs to the
# prison wall.
#
# The frame: local X along the front (toward world -z, the west), local Z into the compound (world +x, north),
# the gate's middle on the front at local (0, 0). World = origin + (X cos yaw + Z sin yaw, -X sin yaw + Z cos yaw),
# as shared/hallPlan.ts. The front follows the old row's line from (-354.0, 166.0) to (-356.0, 233.3).

FRONT_A = (-354.0, 166.0)
FRONT_B = (-356.0, 233.3)
GATE_Z = 199.5  # the gate's middle, world z


def prison_frame():
    ax, az = FRONT_A
    bx, bz = FRONT_B
    L = math.hypot(bx - ax, bz - az)
    tx, tz = (bx - ax) / L, (bz - az) / L
    nx, nz = -tz, tx  # into the compound (world +x)
    if nx < 0:
        nx, nz = -nx, -nz
    k = (GATE_Z - az) / tz
    origin = (ax + tx * k, az + tz * k)
    yaw = math.atan2(nx, nz)
    return origin, yaw


P_ORIGIN, P_YAW = prison_frame()


def pw(X, Z):
    """Prison local -> world (x, z)."""
    c, s = math.cos(P_YAW), math.sin(P_YAW)
    return (P_ORIGIN[0] + X * c + Z * s, P_ORIGIN[1] - X * s + Z * c)


def pring(x0, x1, z0, z1):
    return [pw(x0, z0), pw(x1, z0), pw(x1, z1), pw(x0, z1)]


# The compound (local): 63 m along the front, 30 m deep. The corner houses of the wall street (657, 658) stand
# west of it; the houses of the cathedral's south street behind it.
COMPOUND = dict(x0=-32.5, x1=30.5, z0=0.0, z1=30.0)
WALL_T = 0.6  # the outer wall's thickness
WALL_H = 6.4  # its height over the street
# The buildings (local rectangles unless said). Heights over the street.
PRISON = {
    # the front building: two storeys and a crenellated parapet, the gate tower in the middle standing 0.6 m out
    "front": dict(x0=-12.0, x1=12.0, z0=0.0, z1=9.0, h=8.6),
    "tower": dict(x0=-4.2, x1=4.2, z0=-0.6, z1=9.0, h=13.6),
    # the corner towers of the front building
    "corner": dict(w=3.4, h=10.4),
    # the gate: a round arch 3.4 wide, springing at 3.2
    "gate": dict(hw=1.7, spring=3.2, h=4.9),
    # the governor's house on the street at the east end, its garden behind it
    "governor": dict(x0=-32.5, x1=-22.0, z0=0.0, z1=10.5, h=11.2),
    # the link from the front building to the pavilion (the chaplain's and the doctor's rooms over it)
    "link": dict(x0=-2.8, x1=2.8, z0=9.0, z1=15.0, h=7.6),
    # the central watch pavilion: an octagon (circumradius r) with a lantern; the cell wings off it east and west
    # (the wings and the link run on into it, so their walls close on its faces; cells from 6 m out, 2.8 m apart)
    "pavilion": dict(x=0.0, z=19.0, r=6.4, h=18.4),
    "wingA": dict(x0=2.0, x1=28.4, z0=14.6, z1=24.4, h=11.8),
    "wingB": dict(x0=-28.4, x1=-2.0, z0=14.6, z1=24.4, h=11.8),
    # the chapel: a hall with a round apse and a bell-cote, in the court west of the link
    "chapel": dict(x0=-21.0, x1=-13.4, z0=1.6, z1=12.8, h=8.8),
    # the exercise yard: a ring of flagstones round the warder's stand, in the court east of the front building
    "ring": dict(x=21.6, z=7.4, r_in=3.6, r_out=5.0),
    # the yard door: in wing A's south face, into its ground-floor corridor
    "yard_door": dict(x=13.0, hw=0.8, h=2.5),
}

# the houses the prison stands on (the row along the wall street and the court's cottages behind it)
PRISON_GONE = list(range(646, 657)) + [662] + list(range(1070, 1091))


def prison_solids():
    """The walk map's wall: the whole compound, and the gate tower standing out before the front."""
    c = COMPOUND
    t = PRISON["tower"]
    return [pring(c["x0"], c["x1"], c["z0"], c["z1"]), pring(t["x0"], t["x1"], t["z0"], 0.0)]


# ================================================================== the round square (Sint-Jansplein)
#
# Where the winding street L and street B meet, the plan already had a round place of 14.7 m to the house fronts
# (tools/city/streets.py SQUARES tree_square), bare cobbles with a patch of flags in the middle. It becomes a
# rond-point of the 1860s: a pavement along the fronts, the carriageway in rings of setts, an island with a
# fountain and St John on it, plane trees in a ring, benches, gas lamps, a newspaper kiosk and a urinal.

ROND = dict(c=(20.0, 296.0), r_front=14.7, r_walk=13.3, r_island=8.6, r_path_in=2.9, r_path_out=4.5, r_basin=2.4, r_disc=15.4)
ROND_TREES = 8  # plane trees in a ring on the island
ROND_TREE_R = 6.7


def rond_items():
    cx, cz = ROND["c"]
    at = lambda r, a: (cx + r * math.cos(math.radians(a)), cz + r * math.sin(math.radians(a)))  # noqa: E731
    trees = [at(ROND_TREE_R, 22.5 + 45 * k) for k in range(ROND_TREES)]
    # four gas lamps on the island's kerb, between the trees (in line with the streets' mouths)
    lamps = [at(8.0, a) for a in (45, 135, 225, 315)]
    # facing: the bench's front looks at (sin yaw, cos yaw); benches look in at the fountain
    face_in = lambda a: math.atan2(-math.cos(math.radians(a)), -math.sin(math.radians(a)))  # noqa: E731
    benches = [(*at(5.35, a), face_in(a)) for a in (90, 270, 0 - 22.5 + 45, 180 + 22.5)]
    benches = [(*at(5.35, a), face_in(a)) for a in (67.5, 112.5, 247.5, 292.5)]
    kiosk = (*at(5.6, 180.0), face_in(180.0) + math.pi)  # its window looks out to the carriageway
    urinal = (*at(5.8, 0.0), face_in(0.0))
    return dict(trees=trees, lamps=lamps, benches=benches, kiosk=kiosk, urinal=urinal, fountain=(cx, cz))


# ================================================================== the greens

def rect(x0, x1, z0, z1):
    return [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]


def rail_ring(x0, x1, z0, z1, gaps):
    """A low railing round a rectangle, as polylines, leaving the gaps [(side, from, to)] open.
    side: 'x0' / 'x1' (runs along z) or 'z0' / 'z1' (runs along x)."""
    sides = {"z0": ((x0, z0), (x1, z0)), "x1": ((x1, z0), (x1, z1)), "z1": ((x1, z1), (x0, z1)), "x0": ((x0, z1), (x0, z0))}
    out = []
    for name, (a, b) in sides.items():
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        cuts = []
        for s, f, t in gaps:
            if s != name:
                continue
            # f, t in world along the side's axis
            if name in ("z0", "z1"):
                u0, u1 = (f - a[0]) / (b[0] - a[0]) * L, (t - a[0]) / (b[0] - a[0]) * L
            else:
                u0, u1 = (f - a[1]) / (b[1] - a[1]) * L, (t - a[1]) / (b[1] - a[1]) * L
            cuts.append((min(u0, u1), max(u0, u1)))
        cuts.sort()
        u = 0.0
        pieces = []
        for c0, c1 in cuts:
            if c0 > u + 0.3:
                pieces.append((u, c0))
            u = max(u, c1)
        if u < L - 0.3:
            pieces.append((u, L))
        for p0, p1 in pieces:
            out.append([(a[0] + (b[0] - a[0]) * p0 / L, a[1] + (b[1] - a[1]) * p0 / L), (a[0] + (b[0] - a[0]) * p1 / L, a[1] + (b[1] - a[1]) * p1 / L)])
    return out


def greens():
    out = []
    # --- 1. The Lijnwaadmarkt, north of the cathedral: the street is 24 m wide there; a planted strip down its
    # middle, as on the new boulevards: lime trees, a gravel walk, benches, flower beds at the ends, a low railing.
    x0, x1, z0, z1 = -215.6, -210.6, 158.0, 202.0
    xm = (x0 + x1) / 2
    walk = rect(xm - 1.1, xm + 1.1, z0, z1)
    trees = [(x0 + 0.85 if k % 2 == 0 else x1 - 0.85, z) for k, z in enumerate([163.0, 170.5, 178.0, 185.5, 193.0])]
    benches = [(x0 + 0.62, z, math.pi / 2) for z in (166.8, 181.8, 196.6)] + [(x1 - 0.62, z, -math.pi / 2) for z in (174.2, 189.3)]
    beds = [dict(c=(xm, z0 + 2.4), r=1.3), dict(c=(xm, z1 - 2.4), r=1.3)]
    # the walk goes round the round beds at the ends
    out.append(dict(
        id="lijnwaadmarkt", label="the green strip of the Lijnwaadmarkt", kind="strip",
        grass=[rect(x0, x1, z0, z1)], paths=[rect(xm - 1.1, xm + 1.1, z0 + 4.2, z1 - 4.2), rect(x0, x1, z0, z0 + 0.9), rect(x0, x1, z1 - 0.9, z1),
                                              rect(x0 + 0.2, xm - 1.35, z0 + 0.9, z0 + 4.2), rect(xm + 1.35, x1 - 0.2, z0 + 0.9, z0 + 4.2),
                                              rect(x0 + 0.2, xm - 1.35, z1 - 4.2, z1 - 0.9), rect(xm + 1.35, x1 - 0.2, z1 - 4.2, z1 - 0.9)],
        rails=rail_ring(x0, x1, z0, z1, [("z0", x0 + 0.4, x1 - 0.4), ("z1", x0 + 0.4, x1 - 0.4), ("x0", 179.2, 181.2), ("x1", 181.6, 183.6)]),
        trees=[(x, z, "tree_lime") for x, z in trees], benches=benches, beds=beds, extras=[],
        points=[(xm, 180.0), (xm, z0 + 0.5), (xm, z1 - 0.5)],
    ))
    del walk
    # --- 2. St James's churchyard: the forecourt between the church's south front and the wall street, as a
    # churchyard green (the burials had gone out of town in 1784; the grass, the old slabs and the cross stayed):
    # two plots either side of the walk to the door, railed, a lime in each, a stone calvary, benches.
    # (the forecourt before the south transept door, x -114.5..-94, opened when #484 and #485 came down; the
    # door at x -106.5 keeps its walk to the wall street, 5.8 m wide)
    zA, zB = 334.4, 340.6
    plots = [(-114.3, -109.6), (-103.4, -94.6)]
    rails = rail_ring(plots[0][0], plots[0][1], zA, zB, [("x1", 337.0, 338.4)]) + rail_ring(plots[1][0], plots[1][1], zA, zB, [("x0", 337.0, 338.4)])
    out.append(dict(
        id="stjacob_yard", label="St James's churchyard", kind="churchyard",
        grass=[rect(a, b, zA, zB) for a, b in plots], paths=[rect(-111.0, -109.6, 336.8, 338.6), rect(-103.4, -101.6, 336.8, 338.6)],
        rails=rails,
        trees=[(-97.4, 336.4, "tree_lime")],
        benches=[(-100.6, 339.6, math.pi), (-96.4, 339.6, math.pi)],
        beds=[dict(c=(-112.4, 339.2), r=0.75), dict(c=(-100.0, 335.8), r=0.7)],
        extras=[dict(kind="calvary", x=-112.6, z=336.0, yaw=0.0), dict(kind="slabs", x=-111.9, z=334.0, yaw=0.0),
                dict(kind="slabs", x=-97.8, z=334.0, yaw=0.0)],
        points=[(-110.3, 337.7), (-102.3, 337.7), (-98.5, 340.9)],
    ))
    # --- 3. A green in the court behind the round square: the yard of packed earth gets a railed lawn round its
    # tree, a bench under it and a flower bed; the washing and the pump stay.
    # (the court is open from x -12 to +6 behind the ring's houses, z 304 to 332; its old tree stands at (-5.6, 315))
    gx0, gx1, gz0, gz1 = -9.6, -2.6, 309.0, 328.0
    out.append(dict(
        id="court_green", label="the green in the court behind the Sint-Jansplein", kind="court",
        grass=[rect(gx0, gx1, gz0, gz1)], paths=[rect(-4.9, -3.5, gz0, gz1)],
        rails=rail_ring(gx0, gx1, gz0, gz1, [("z0", -4.9, -3.5), ("z1", -4.9, -3.5)]),
        trees=[(-7.9, 321.2, "tree_elm")],
        benches=[(-3.0, 313.6, -math.pi / 2), (-3.0, 322.8, -math.pi / 2)],
        beds=[dict(c=(-7.9, 311.6), r=0.9), dict(c=(-7.9, 326.0), r=0.8)],
        extras=[],
        points=[(-4.2, 318.0), (-4.2, gz0 - 0.9), (-4.2, gz1 + 0.9)],
    ))
    return out


# ================================================================== the walk map's solids

def solids_of(rond, gs):
    """Rings the walk map paints as wall (a cell whose middle is inside)."""
    out = []
    out += prison_solids()
    cx, cz = rond["fountain"]
    out.append(list(Point(cx, cz).buffer(ROND["r_basin"] + 0.1, resolution=6).exterior.coords))
    for x, z in rond["trees"]:
        out.append(list(Point(x, z).buffer(0.45, resolution=3).exterior.coords))
    for x, z, yaw in rond["benches"]:
        out.append(bench_ring(x, z, yaw))
    kx, kz, _ = rond["kiosk"]
    out.append(list(Point(kx, kz).buffer(1.25, resolution=3).exterior.coords))
    ux, uz, uy = rond["urinal"]
    out.append(box_ring(ux, uz, uy, 1.0, 0.75))
    for g in gs:
        for line in g["rails"]:
            out.append(list(LineString(line).buffer(0.26, cap_style=2).exterior.coords))
        for x, z, _k in g["trees"]:
            out.append(list(Point(x, z).buffer(0.45, resolution=3).exterior.coords))
        for x, z, yaw in g["benches"]:
            out.append(bench_ring(x, z, yaw))
        for e in g["extras"]:
            if e["kind"] == "calvary":
                out.append(box_ring(e["x"], e["z"], e["yaw"], 1.1, 0.9))
    return [[(R2(x), R2(z)) for x, z in r] for r in out]


def box_ring(x, z, yaw, hw, hd):
    """A box hw across and hd deep (half sizes), its front toward (sin yaw, cos yaw)."""
    fx, fz = math.sin(yaw), math.cos(yaw)
    rx, rz = fz, -fx
    return [(x + rx * a + fx * b, z + rz * a + fz * b) for a, b in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]


def bench_ring(x, z, yaw):
    return box_ring(x, z, yaw, 0.95, 0.32)


# ================================================================== write

def main():
    check = "--check" in sys.argv
    city = json.load(open(CITY))
    build = json.load(open(BUILD))
    houses = build["houses"]
    rond = rond_items()
    gs = greens()
    comp = Polygon(prison_solids()[0])
    # the houses under the prison: gone. Check that none stays standing inside the compound and that the kept
    # neighbours stand clear of its wall
    for i, h in enumerate(houses):
        p = Polygon(h["fp"]).buffer(0)
        inter = p.intersection(comp).area
        if i in PRISON_GONE:
            continue
        if inter > 0.01 and not h.get("gone"):
            raise SystemExit(f"house {i} stands {inter:.2f} m2 inside the prison compound and is not in PRISON_GONE")
    near = sorted((round(Polygon(h["fp"]).distance(comp), 2), i) for i, h in enumerate(houses) if i not in PRISON_GONE and not h.get("gone") and Polygon(h["fp"]).distance(comp) < 1.5)
    print("kept houses within 1.5 m of the prison wall:", near)
    # nothing of the greens or the square on a house
    built = unary_union([Polygon(h["fp"]).buffer(0) for h in houses if not h.get("gone")] + [Polygon(l["fp"]).buffer(0) for l in city["landmarks"].values()])
    for g in gs:
        for r in g["grass"]:
            a = Polygon(r).intersection(built).area
            if a > 0.05:
                raise SystemExit(f"{g['id']}: {a:.2f} m2 of its grass on a building")
    # the court's pump inside the prison: out of the list (churches.ts draws the pumps from it)
    pumps = city.get("alleys", {}).get("pumps", [])
    keep = [p for p in pumps if not comp.buffer(1.0).contains(Point(p))]
    # the square's gas lamps join the town's (city.json decor.lamps, after the others: the lamplighters' rounds
    # take them by their index, server/src/town/lamplighters.ts), and the named places the crowd and the kit know
    lamps = city["decor"]["lamps"]
    new_lamps = [[R2(x), R2(z)] for x, z in rond["lamps"] if not any(math.hypot(l[0] - x, l[1] - z) < 0.1 for l in lamps)]
    places = {
        "Sint-Jansplein": {"x": ROND["c"][0], "z": ROND["c"][1], "kind": "square"},
        "Lijnwaadmarkt": {"x": -213.1, "z": 180.0, "kind": "square"},
        "Prison": {"x": R2(pw(0, -3.0)[0]), "z": R2(pw(0, -3.0)[1]), "kind": "building"},
    }
    new_places = {k: v for k, v in places.items() if city["places"].get(k) != v}
    data = {
        "_about": "M7 prison and squares (tools/city/places.py; docs/milestones/M7-prison-squares.md). World metres (x, z).",
        "prison": {
            "origin": [R2(P_ORIGIN[0]), R2(P_ORIGIN[1])], "yaw": round(P_YAW, 6),
            "compound": COMPOUND, "wall": {"t": WALL_T, "h": WALL_H}, "parts": PRISON, "gone": PRISON_GONE,
            "ring": [[R2(x), R2(z)] for x, z in prison_solids()[0]],
        },
        "rond": {
            "label": "the Sint-Jansplein", **{k: (list(v) if isinstance(v, tuple) else v) for k, v in ROND.items()},
            "trees": [[R2(x), R2(z)] for x, z in rond["trees"]], "lamps": [[R2(x), R2(z)] for x, z in rond["lamps"]],
            "benches": [[R2(x), R2(z), round(y, 4)] for x, z, y in rond["benches"]],
            "kiosk": [R2(v) for v in rond["kiosk"]], "urinal": [R2(v) for v in rond["urinal"]], "fountain": list(rond["fountain"]),
        },
        "greens": [{**g,
                    "grass": [[[R2(x), R2(z)] for x, z in r] for r in g["grass"]],
                    "paths": [[[R2(x), R2(z)] for x, z in r] for r in g["paths"]],
                    "rails": [[[R2(x), R2(z)] for x, z in r] for r in g["rails"]],
                    "trees": [[R2(x), R2(z), k] for x, z, k in g["trees"]],
                    "benches": [[R2(x), R2(z), round(y, 4)] for x, z, y in g["benches"]],
                    "beds": [{"c": [R2(b["c"][0]), R2(b["c"][1])], "r": b["r"]} for b in g["beds"]],
                    "points": [[R2(x), R2(z)] for x, z in g["points"]]} for g in gs],
        "solids": solids_of(rond, gs),
        "lamps": [[R2(x), R2(z)] for x, z in rond["lamps"]],
        "places": places,
    }
    marked = [i for i in PRISON_GONE if not houses[i].get("gone")]
    print(f"prison: origin {P_ORIGIN}, yaw {P_YAW:.5f}; {len(PRISON_GONE)} houses under it, {len(marked)} to mark gone; pumps {len(pumps)} -> {len(keep)}")
    print(f"solids: {len(data['solids'])} rings; greens: {[g['id'] for g in gs]}")
    if check:
        return
    with open(OUT, "w", newline="\n") as f:
        json.dump(data, f, indent=1)
    if marked:
        for i in marked:
            houses[i]["gone"] = True
        # (the file as it was written: compact, one line)
        with open(BUILD, "w", newline="\n") as f:
            json.dump(build, f, separators=(",", ":"))
    if len(keep) != len(pumps) or new_lamps or new_places:
        city["alleys"]["pumps"] = keep
        lamps.extend(new_lamps)
        city["places"].update(new_places)
        with open(CITY, "w", newline="\n") as f:
            json.dump(city, f, separators=(",", ":"))
        print(f"city.json: pumps {len(pumps)} -> {len(keep)}, {len(new_lamps)} lamps added (now {len(lamps)}), places {list(new_places)}")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
