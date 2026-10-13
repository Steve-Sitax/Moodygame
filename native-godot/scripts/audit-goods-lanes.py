#!/usr/bin/env python3
"""Goods must never lie in the way of a vehicle.

Checks every job spot (where job goods are laid out and put down) against the lanes of the omnibus lines and the
traffic carts, and against the rails, walls, water, lamps and trees. With --suggest it searches the nearest clear
anchor for each spot that fails. Exit code 1 when a spot lies in a lane.

  python native-godot/scripts/audit-goods-lanes.py            # report
  python native-godot/scripts/audit-goods-lanes.py --suggest  # report and nearest clear anchors
"""
import json, math, os, re, sys
import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GOODS = os.path.join(ROOT, "native-godot", "services", "data", "native-goods.json")
CITY = os.path.join(ROOT, "native-godot", "world", "data", "shared", "city.json")
WALK = os.path.join(ROOT, "native-godot", "world", "data", "public", "city", "walk.png")
OMNIBUS = os.path.join(ROOT, "godot", "src", "Movers", "Omnibus.cs")
TRAFFIC = os.path.join(ROOT, "godot", "src", "Movers", "Traffic.cs")

# metres from a vehicle's centre line that goods must stay out of: half its body (the omnibus team is 2.2 m wide, a dray
# bed 1.9 m, a pushed handcart 1.44 m) and 0.4 m to pass by; a two-way route also leans 0.45 of its half width to each side
LANE_BUS, LANE_DRAY, LANE_CART = 1.5, 1.5, 1.2
GOOD_R = 0.35   # a sack or crate lying down
SPREAD = 2.9    # how far a stack runs along the spot's direction (six items, 0.95 m apart)


def routes():
    """(name, points, loop, lane) of every omnibus line and traffic cart, read from the source so the two cannot drift."""
    out = []
    pair = r"\(\s*(-?[0-9.]+)f?\s*,\s*(-?[0-9.]+)f?\s*\)"
    text = open(OMNIBUS, encoding="utf8").read()
    for m in re.finditer(r"(\w+Route)\s*=\s*\{(.*?)\};", text, re.S):
        out.append(("bus " + m.group(1), [(float(a), float(b)) for a, b in re.findall(pair, m.group(2))], True, LANE_BUS))
    text = open(TRAFFIC, encoding="utf8").read()
    for m in re.finditer(r'Route\("(\w+)",\s*new \(float,\s*float\)\[\]\s*\{(.*?)\},\s*(true|false)(.*?)\);', text, re.S):
        dray = '"dray"' in m.group(4)
        loop = m.group(3) == "true"
        lane = (LANE_DRAY if dray else LANE_CART) + (0 if loop else (1.9 if dray else 1.4) * 0.45)
        out.append(("cart " + m.group(1), [(float(a), float(b)) for a, b in re.findall(pair, m.group(2))], loop, lane))
    return out


def seg_dist(p, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dz * dz
    t = 0 if l2 == 0 else max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2))
    return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)


def lane_dist(p, lanes):
    """(metres to spare beyond the lane's edge, name of the nearest lane); below 0 the point is in the lane."""
    best = (1e9, "")
    for name, pts, loop, lane in lanes:
        ring = pts + [pts[0]] if loop else pts
        for a, b in zip(ring, ring[1:]):
            d = seg_dist(p, a, b) - lane
            if d < best[0]:
                best = (d, name)
    return best


def footprint(spot, gap=0.95):
    dx, dz = spot["dir"]
    pts = []
    for along in np.arange(0, SPREAD + 0.01, gap):
        for side in (-0.5, 0.5):
            pts.append((spot["x"] + dx * along - dz * side, spot["z"] + dz * along + dx * side))
    return pts


def main():
    suggest = "--suggest" in sys.argv
    goods = json.load(open(GOODS, encoding="utf8"))
    city = json.load(open(CITY, encoding="utf8"))
    spots = {k: v for k, v in goods["spots"].items() if isinstance(v, dict) and "x" in v}
    lanes = routes()
    walk = np.array(Image.open(WALK).convert("RGB"))
    x0, z0, res = city["walk"]["x0"], city["walk"]["z0"], city["walk"]["res"]
    decor = city["decor"]
    lamps = decor["lamps"] + decor["trees"]
    crane_bands = [(-321.0, 0.4, -219.0, 7.6), (-39.0, 0.4, 73.0, 7.6), (61.0, 48.0, 71.0, 106.0), (168.0, 48.0, 178.0, 110.0)]
    track_pts = [t["pts"] for t in decor["tracks"]]

    def walkable(x, z):
        i, j = int((x - x0) / res), int((z - z0) / res)
        return 0 <= i < walk.shape[0] and 0 <= j < walk.shape[1] and not walk[i, j].any()

    def clear(pts, spot_id=None):
        for p in pts:
            for ox, oz in ((0, 0), (GOOD_R, 0), (-GOOD_R, 0), (0, GOOD_R), (0, -GOOD_R)):
                if not walkable(p[0] + ox, p[1] + oz):
                    return False
            if lane_dist(p, lanes)[0] < GOOD_R:
                return False
            if any(a <= p[0] <= c and b <= p[1] <= d for a, b, c, d in crane_bands):
                return False
            if any(seg_dist(p, a, b) < 2.2 for pts2 in track_pts for a, b in zip(pts2, pts2[1:])):
                return False
            if any(math.hypot(p[0] - lx, p[1] - lz) < 0.9 for lx, lz in lamps):
                return False
        return True

    bad = 0
    for sid, s in spots.items():
        worst = min((lane_dist(p, lanes) for p in footprint(s)), key=lambda t: t[0])
        if worst[0] >= 0:
            continue
        bad += 1
        print(f"IN LANE  {sid:18} ({s['x']}, {s['z']})  {-worst[0]:.2f} m inside the lane of {worst[1]}")
        if not suggest:
            continue
        best = None
        # straight moves (along or across the spot's stack) first: they keep the place where it is on the quay
        for angles in ([k * math.pi / 2 for k in range(4)], [k * math.pi / 24 for k in range(48)]):
            for r in np.arange(0.5, 16.01, 0.25):
                for a in angles:
                    t = dict(s, x=round(float(s["x"] + r * math.cos(a)), 2), z=round(float(s["z"] + r * math.sin(a)), 2))
                    others = [o for k, o in spots.items() if k != sid and math.hypot(o["x"] - t["x"], o["z"] - t["z"]) < 3]
                    if not others and clear(footprint(t)):
                        best = (float(r), t)
                        break
                if best:
                    break
            if best:
                break
        print("   nearest clear anchor:", (best[1]["x"], best[1]["z"], f"{best[0]:.2f} m away") if best else "none within 16 m")
    print(f"{bad} spot(s) in a vehicle lane")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
