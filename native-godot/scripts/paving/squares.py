"""The squares the razing opened, and trees on the wide bare earth (Steve, 2026-10-26: clear the houses hugging the
churches, the churches free on squares with trees and room to gather; trees on the sandy patches).
    python squares.py <razed json> <church feet folder> <earth dump> <out squares.json> [<pavement dump>]
    python squares.py --settle <squares.json> <pavement dump>
<razed json>: the houses razed round the churches (ids in city_build.json); <church feet folder>: foot-<church>.json,
each church model's plan (GeoJSON, from its triangles under 4 m); <earth dump>: dump-meshes.gd of city/ground_earth.
Writes the trees and benches NativeRazedHouses.Dress sets (world/town/squares.json):
- the cathedral's corner (houses 536, 537): its lime and bench as before (razed-corner-bench);
- each church's square: on the ground its razed houses left, 3.5 m clear of the church, 2.5 m of a standing house or
  another landmark, trees 7 m apart (limes, some planes), and benches beside about half of them facing the church;
- the bare earth: 3 m in from its edges, clear of houses and churches, trees 11 m apart (elm, lime, plane, bare).
A tree on the paving (the corner's, the squares') stands in a pit like the quay's (Steve, 2026-10-27): "pit" is the yaw of
its stone frame, square to the church (at the corner to the nearest house). The earth trees stand in earth and get none.
- none in St James's churchyard (world/town/churchyard.json "area", scripts/churchyard.py, 2026-10-27) or within 1.2 m of its
  railing: those drawn there are left out after the draw, so every other tree and bench stays where it stood.
Fixed seed: the same plan every run.
<pavement dump>: dump-pavements.gd (the old stone and the kerb flags). A pit must lie on the setts: a frame drawn half under
the old pavements' raised flags, kerbs or a step read as broken edging (Codex on #231, Sint-Jacob east), so each pit tree
whose frame comes within 0.15 m of a raised top is moved the least way that clears it (at most 3 m; 6 m from the other
trees, 2.5 m from a standing house, 3.5 m from a church, clear of the churchyard, the benches and the squares' things).
--settle does only that to an existing squares.json, so every other tree and bench stays where it stood.
"""
import sys, json, math, pathlib
import numpy as np, shapely
from shapely.geometry import Polygon, Point, shape

REPO = pathlib.Path(__file__).resolve().parents[3]
NAMES = {'carolus': 'Sint-Carolus', 'stpaul': 'Sint-Paulus', 'stjacob': 'Sint-Jacob'}
BENCH = 'res://assets/library/bench-worn.tres'

def square_to(poly):
    """The yaw (Godot's, about +y) that turns a pit's frame square to a plan's long sides, within a quarter turn."""
    c = list(poly.minimum_rotated_rectangle.exterior.coords)
    sides = [(c[i + 1][0] - c[i][0], c[i + 1][1] - c[i][1]) for i in range(2)]
    dx, dz = max(sides, key=lambda s: math.hypot(*s))
    return round(math.atan2(-dz, dx) % (math.pi / 2), 3)

PIT, PIT_CLEAR = 0.9, 0.15   # the pit frame's half width (NativeTreePits Outer); its clearance from a raised top


def raised_tops(dump):
    """The old pavements' raised tops (kerb flags, kerbs, steps: upward faces 3-50 cm up), as one plan shape."""
    R = np.fromfile(pathlib.Path(dump) / 'pavements.f32', np.float32).reshape(-1, 20)
    P = R[:, :3].reshape(-1, 3, 3).astype(float)
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); L = np.linalg.norm(n, axis=1)
    up = (L > 1e-6) & (np.abs(n[:, 1]) > 0.8 * L) & (P[:, :, 1].min(1) > 0.03) & (P[:, :, 1].max(1) < 0.5)
    return shapely.union_all(shapely.polygons(P[up][:, :, [0, 2]]).tolist()).buffer(0.002)


def frame_of(x, z, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    # (Godot's yaw about +y: a local (lx, lz) lands at (lx c + lz s, -lx s + lz c))
    return Polygon([(x + lx * c + lz * s, z - lx * s + lz * c) for lx, lz in ((-PIT, -PIT), (PIT, -PIT), (PIT, PIT), (-PIT, PIT))])


def settle(sq, raised):
    """Moves the pit trees whose frame meets a raised top (see the header). Returns the moves."""
    cb = json.load(open(REPO / 'native-godot/world/data/shared/city_build.json'))
    standing = shapely.union_all([Polygon(h['fp']).buffer(0) for h in cb['houses'] if not h.get('gone') and len(h.get('fp', [])) >= 3])
    dressing = json.load(open(REPO / 'native-godot/world/town/square-dressing.json'))
    churches = shapely.union_all([Polygon(c['outline']).buffer(0) for c in dressing['ground']['churches']])
    yard_file = REPO / 'native-godot/world/town/churchyard.json'
    yard = Polygon(json.load(open(yard_file))['area']).buffer(1.2) if yard_file.exists() else Polygon()
    things = [(Point(t['at']), (max(t['size'][0], t['size'][2]) / 2 if t.get('size') else 0.3) + 0.5) for t in dressing['things'] if not t['kind'].startswith('move:')]
    things += [(Point(b['x'], b['z']), 1.6) for b in sq['benches']]
    blocked = standing.buffer(2.5).union(churches.buffer(3.5)).union(yard)
    moves = []
    for t in sq['trees']:
        if 'pit' not in t: continue
        if frame_of(t['x'], t['z'], t['pit']).distance(raised) >= PIT_CLEAR: continue
        others = [Point(o['x'], o['z']) for o in sq['trees'] if o is not t]
        best = None
        for r in np.arange(0.1, 3.01, 0.1):
            for a in np.arange(0, 2 * math.pi, math.pi / 18):
                x, z = t['x'] + r * math.cos(a), t['z'] + r * math.sin(a)
                q = Point(x, z)
                if frame_of(x, z, t['pit']).distance(raised) < PIT_CLEAR or blocked.contains(q): continue
                if any(q.distance(o) < 6.0 for o in others) or any(q.distance(p) < d for p, d in things): continue
                best = (round(x, 2), round(z, 2)); break
            if best: break
        if best is None:
            moves.append((t['x'], t['z'], None)); continue
        moves.append((t['x'], t['z'], best))
        t['x'], t['z'] = best
    return moves


def main():
    if sys.argv[1] == '--settle':
        path, dump = sys.argv[2:4]
        sq = json.load(open(path))
        for old_x, old_z, new in settle(sq, raised_tops(dump)):
            print('tree at', old_x, old_z, '->', new if new else 'no clear place within 3 m: left')
        json.dump(sq, open(path, 'w'), indent=1)
        return
    razed_j, feet_dir, earth_dir, out = sys.argv[1:5]
    rng = np.random.default_rng(1873)
    cb = json.load(open(REPO / 'native-godot/world/data/shared/city_build.json'))
    city = json.load(open(REPO / 'native-godot/world/data/shared/city.json'))
    ids = json.load(open(razed_j))
    standing = shapely.union_all([Polygon(h['fp']).buffer(0) for h in cb['houses'] if not h.get('gone') and len(h.get('fp', [])) >= 3])
    landmarks = shapely.union_all([Polygon(v['fp']).buffer(0) for v in cb['landmarks'].values()])
    feet = {k: shape(json.load(open(pathlib.Path(feet_dir) / f'foot-{k}.json'))) for k in NAMES}
    churches = shapely.union_all(list(feet.values()))
    taken = [Point(t[0], t[1]) if isinstance(t, list) else Point(t['x'], t['z']) for t in city['decor'].get('trees', [])]
    corner = min((Polygon(h['fp']).buffer(0) for h in cb['houses'] if not h.get('gone') and len(h.get('fp', [])) >= 3),
                 key=lambda p: p.distance(Point(-216.2, 276.2)))
    trees = [dict(kind='lime', x=-216.2, z=276.2, yaw=0.0, scale=1.0, pit=square_to(corner))]
    yard_file = REPO / 'native-godot/world/town/churchyard.json'
    yard = Polygon(json.load(open(yard_file))['area']).buffer(1.2) if yard_file.exists() else Polygon()
    benches = [dict(id='razed-corner-bench', x=-212.7, z=272.7, yaw=-0.396, label='a bench at the corner behind the cathedral', asset=BENCH)]

    def scatter(area, spacing):
        pts = []; x0, z0, x1, z1 = area.bounds
        for _ in range(int(area.envelope.area / 2) + 50):
            p = Point(rng.uniform(x0, x1), rng.uniform(z0, z1))
            if area.contains(p) and all(p.distance(q) >= spacing for q in pts + taken): pts.append(p)
        taken.extend(pts)
        return pts

    for k, foot in feet.items():
        cleared = shapely.union_all([Polygon(cb['houses'][i]['fp']).buffer(0) for i in ids if Polygon(cb['houses'][i]['fp']).distance(foot) < 20])
        area = cleared.difference(foot.buffer(3.5)).difference(standing.buffer(2.5)).difference(landmarks.difference(foot).buffer(2.5))
        pts = scatter(area, 7.0)
        for p in pts:
            tree = dict(kind=['lime', 'lime', 'lime', 'plane'][int(rng.integers(4))], x=round(p.x, 2), z=round(p.y, 2),
                              yaw=round(float(rng.uniform(0, 6.28)), 3), scale=round(float(rng.uniform(0.85, 1.05)), 2), pit=square_to(foot))
            if not yard.contains(p): trees.append(tree)
        nb = 0
        for p in pts:
            if nb >= max(2, len(pts) // 2): break
            c = foot.boundary.interpolate(foot.boundary.project(p)); d = np.array([c.x - p.x, c.y - p.y]); d /= np.linalg.norm(d)
            b = np.array([p.x, p.y]) - d * 1.6
            if not area.buffer(1.0).contains(Point(b)) or standing.distance(Point(b)) < 1.5: continue
            nb += 1
            if yard.contains(Point(b)) or yard.contains(p): continue
            benches.append(dict(id=f'square-{k}-bench-{nb}', x=round(b[0], 2), z=round(b[1], 2), yaw=round(math.atan2(d[0], d[1]), 3),
                                label=f'a bench on the square by the {NAMES[k]} church', asset=BENCH))
        print(k, 'cleared', round(cleared.area), 'free', round(area.area), 'trees', len(pts), 'benches', nb)
    info = json.load(open(pathlib.Path(earth_dir) / 'meshes.json'))['city/ground_earth']
    R = np.fromfile(pathlib.Path(earth_dir) / info['surfaces'][0]['file'], np.float32).reshape(-1, 3, 20).astype(float)
    earth = shapely.union_all(shapely.polygons(R[:, :, [0, 2]]))
    inner = earth.buffer(-3.0).difference(standing.buffer(3)).difference(churches.buffer(3))
    pts = scatter(inner, 11.0)
    for p in pts:
        trees.append(dict(kind=['elm', 'lime', 'plane', 'bare', 'elm'][int(rng.integers(5))], x=round(p.x, 2), z=round(p.y, 2),
                          yaw=round(float(rng.uniform(0, 6.28)), 3), scale=round(float(rng.uniform(0.75, 1.05)), 2)))
    print('earth trees', len(pts))
    if len(sys.argv) > 5:
        sq = dict(trees=trees, benches=benches)
        for old_x, old_z, new in settle(sq, raised_tops(sys.argv[5])): print('tree at', old_x, old_z, '->', new)
    json.dump(dict(note="NativeRazedHouses.Dress: trees (copies of the town's own trees of the kind) and benches on the squares the "
                        "razing opened and on the wide bare earth by the town wall (scripts/paving/squares.py).",
                   trees=trees, benches=benches), open(out, 'w'), indent=1)
    print('trees', len(trees), 'benches', len(benches))

if __name__ == '__main__':
    main()
