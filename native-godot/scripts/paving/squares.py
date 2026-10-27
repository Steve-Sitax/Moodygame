"""The squares the razing opened, and trees on the wide bare earth (Steve, 2026-10-26: clear the houses hugging the
churches, the churches free on squares with trees and room to gather; trees on the sandy patches).
    python squares.py <razed json> <church feet folder> <earth dump> <out squares.json>
<razed json>: the houses razed round the churches (ids in city_build.json); <church feet folder>: foot-<church>.json,
each church model's plan (GeoJSON, from its triangles under 4 m); <earth dump>: dump-meshes.gd of city/ground_earth.
Writes the trees and benches NativeRazedHouses.Dress sets (world/town/squares.json):
- the cathedral's corner (houses 536, 537): its lime and bench as before (razed-corner-bench);
- each church's square: on the ground its razed houses left, 3.5 m clear of the church, 2.5 m of a standing house or
  another landmark, trees 7 m apart (limes, some planes), and benches beside about half of them facing the church;
- the bare earth: 3 m in from its edges, clear of houses and churches, trees 11 m apart (elm, lime, plane, bare).
Fixed seed: the same plan every run.
"""
import sys, json, math, pathlib
import numpy as np, shapely
from shapely.geometry import Polygon, Point, shape

REPO = pathlib.Path(__file__).resolve().parents[3]
NAMES = {'carolus': 'Sint-Carolus', 'stpaul': 'Sint-Paulus', 'stjacob': 'Sint-Jacob'}
BENCH = 'res://assets/library/bench-worn.tres'

def main():
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
    trees = [dict(kind='lime', x=-216.2, z=276.2, yaw=0.0, scale=1.0)]
    benches = [dict(id='razed-corner-bench', x=-212.7, z=272.7, yaw=-0.396, label='a bench at the corner behind the cathedral', asset=BENCH)]

    def scatter(area, spacing):
        pts = []; x0, z0, x1, z1 = area.bounds
        for _ in range(int(area.envelope.area / 2) + 50):
            p = Point(rng.uniform(x0, x1), rng.uniform(z0, z1))
            if area.contains(p) and all(p.distance(q) >= spacing for q in pts + taken): pts.append(p)
        taken.extend(pts)
        return pts

    for k, foot in feet.items():
        cleared = shapely.union_all([Polygon(cb['houses'][i]['fp']).buffer(0) for i in ids if Polygon(cb['houses'][i]['fp']).distance(foot) < 3])
        area = cleared.difference(foot.buffer(3.5)).difference(standing.buffer(2.5)).difference(landmarks.difference(foot).buffer(2.5))
        pts = scatter(area, 7.0)
        for p in pts:
            trees.append(dict(kind=['lime', 'lime', 'lime', 'plane'][int(rng.integers(4))], x=round(p.x, 2), z=round(p.y, 2),
                              yaw=round(float(rng.uniform(0, 6.28)), 3), scale=round(float(rng.uniform(0.85, 1.05)), 2)))
        nb = 0
        for p in pts:
            if nb >= max(2, len(pts) // 2): break
            c = foot.boundary.interpolate(foot.boundary.project(p)); d = np.array([c.x - p.x, c.y - p.y]); d /= np.linalg.norm(d)
            b = np.array([p.x, p.y]) - d * 1.6
            if not area.buffer(1.0).contains(Point(b)) or standing.distance(Point(b)) < 1.5: continue
            nb += 1
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
    json.dump(dict(note="NativeRazedHouses.Dress: trees (copies of the town's own trees of the kind) and benches on the squares the "
                        "razing opened and on the wide bare earth by the town wall (scripts/paving/squares.py).",
                   trees=trees, benches=benches), open(out, 'w'), indent=1)
    print('trees', len(trees), 'benches', len(benches))

if __name__ == '__main__':
    main()
