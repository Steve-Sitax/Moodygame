"""Plan narrow, fitted ground junction closures from native geometry audits.
Requires numpy, scipy and shapely >= 2.1. Usage: python tools/ground-junctions.py AUDIT_DIR ORIGINAL_RESOURCE_DIR
AUDIT_DIR inputs: original-meshes.json (decoded native arrays), ground-boundaries.json
(edge audit), wall-feet.json (visible foundation intersections with y=0).
Writes intermediate topology receipts and fitted-with-walls.json; does not mutate native assets.
Review native day/rain/night views before accepting the resulting mesh changes.
"""
import sys
from pathlib import Path
p = out = Path(sys.argv[1])
originals = Path(sys.argv[2])
import json, numpy as np
from scipy.spatial import cKDTree
from collections import defaultdict
from pathlib import Path
rows = json.load(open(out / 'ground-boundaries.json'))
segments = []
for r, row in enumerate(rows):
    for e in row['lines']:
        segments.append((r, e['a'], e['b']))
pts = np.unique(np.round(np.array([p for _, a, b in segments for p in (a, b)])[:, [0, 2]], 4), axis=0)
tree = cKDTree(pts)
parts = defaultdict(list)
for n, (r, aa, bb) in enumerate(segments):
    a = np.array(aa)[[0, 2]]
    b = np.array(bb)[[0, 2]]
    d = b - a
    length = np.linalg.norm(d)
    if length < 0.0001:
        continue
    near = pts[tree.query_ball_point((a + b) / 2, length / 2 + 0.0002)]
    t = (near - a) @ d / (length * length)
    dist = np.abs((near[:, 0] - a[0]) * d[1] - (near[:, 1] - a[1]) * d[0]) / length
    cut = np.unique(np.r_[0, 1, t[(dist < 0.00015) & (t > 0) & (t < 1)]])
    for lo, hi in zip(cut[:-1], cut[1:]):
        p = tuple(np.round(a + lo * d, 4))
        q = tuple(np.round(a + hi * d, 4))
        if p == q:
            continue
        key = tuple(sorted((p, q)))
        parts[key].append((r, n, float(lo), float(hi)))
print('input', len(segments), 'split', len(parts), 'single', sum((len(v) == 1 for v in parts.values())))
result = []
for (a, b), occ in parts.items():
    if len(occ) == 1:
        r, n, lo, hi = occ[0]
        result.append(dict(resource=rows[r]['mesh'], edge=n, a=a, b=b, lo=lo, hi=hi))
json.dump(result, open(out / 'true-boundaries.json', 'w'))
for r, row in enumerate(rows):
    es = [e for e in result if e['resource'] == row['mesh']]
    print(row['node'], row['edges'], '->', len(es), 'metres', sum((np.linalg.norm(np.array(e['a']) - e['b']) for e in es)))
import json, numpy as np
from shapely.geometry import LineString
from shapely.strtree import STRtree
from pathlib import Path
from collections import Counter
p = out
es = json.load(open(p / 'true-boundaries.json'))
lines = [LineString([e['a'], e['b']]) for e in es]
tree = STRtree(lines)
patches = []
for i, e in enumerate(es):
    a = np.array(e['a'])
    b = np.array(e['b'])
    d = b - a
    length = np.linalg.norm(d)
    if length < 0.001:
        continue
    u = d / length
    for j in tree.query(lines[i].buffer(0.02)):
        if j <= i:
            continue
        f = es[j]
        c = np.array(f['a'])
        z = np.array(f['b'])
        w = z - c
        wl = np.linalg.norm(w)
        if wl < 0.001 or abs(np.dot(u, w / wl)) < 0.999:
            continue
        t0, t1 = sorted([np.dot(c - a, u), np.dot(z - a, u)])
        lo = max(0, t0)
        hi = min(length, t1)
        if hi - lo < 0.001:
            continue
        aa = a + u * lo
        bb = a + u * hi
        cc = c + w * np.dot(aa - c, w) / np.dot(w, w)
        dd = c + w * np.dot(bb - c, w) / np.dot(w, w)
        widths = [np.linalg.norm(cc - aa), np.linalg.norm(dd - bb)]
        if max(widths) > 0.02 or max(widths) < 0.0002:
            continue
        patches.append(dict(resource=e['resource'], edge=e['edge'], other=f['resource'], other_edge=f['edge'], a=aa.tolist(), b=bb.tolist(), c=dd.tolist(), d=cc.tolist(), width=max(widths)))
json.dump(patches, open(p / 'patch-candidates.json', 'w'))
print('candidates', len(patches), 'width mm', np.quantile([x['width'] * 1000 for x in patches], [0, 0.25, 0.5, 0.75, 1]))
print(Counter((x['resource'].split('/')[-1] for x in patches)))
import json, numpy as np
from pathlib import Path
from collections import defaultdict, Counter
from scipy.spatial import cKDTree
p = out
rows = json.load(open(p / 'original-meshes.json'))
bounds = json.load(open(p / 'ground-boundaries.json'))
source = {}
n = 0
for row, bd in zip(rows, bounds):
    v = np.array(row['vertices'])
    ix = np.array(row['indices']).reshape(-1, 3)
    keys = [tuple(x) for x in np.round(v[:, [0, 2]] * 10000).astype(int)]
    vtree = cKDTree(v[:, [0, 2]])
    wanted = {tuple(sorted((keys[vtree.query(e['a'][::2])[1]], keys[vtree.query(e['b'][::2])[1]]))): n + k for k, e in enumerate(bd['lines'])}
    for tri in ix:
        for k in range(3):
            ai, bi, ci = map(int, (tri[k], tri[(k + 1) % 3], tri[(k + 2) % 3]))
            edge = wanted.get(tuple(sorted((keys[ai], keys[bi]))))
            if edge is not None:
                source[edge] = (ai, bi, ci, v[ci, [0, 2]].tolist())
    n += len(bd['lines'])
p = out
es = json.load(open(p / 'true-boundaries.json'))
patches = json.load(open(p / 'patch-candidates.json'))
edge_lookup = {e['edge']: e for e in es}
valid = []
for patch in patches:
    edge = patch['edge']
    ai, bi, ci, inside = source[edge]
    a, b, c, d = [np.array(patch[x]) for x in 'abcd']
    along = b - a
    cross = lambda x, y: x[0] * y[1] - x[1] * y[0]
    if cross(along, np.array(inside) - a) * cross(along, (c + d - a - b) / 2) >= 0:
        continue
    other_inside = np.array(source[patch['other_edge']][3])
    if cross(d - c, other_inside - c) * cross(d - c, (a + b - c - d) / 2) >= 0:
        continue
    patch['triangle'] = [ai, bi, ci]
    valid.append(patch)
from shapely.geometry import Polygon
valid = [e for e in valid if Polygon([e[k] for k in 'abcd']).is_valid]
json.dump(valid, open(p / 'fitted-patches.json', 'w'))
print('outward candidates', len(valid), Counter((x['resource'].split('/')[-1] for x in valid)))
json.dump({str(k): v for k, v in source.items()}, open(p / 'edge-source.json', 'w'))
import json, numpy as np, shapely, hashlib
from shapely.geometry import LineString, Polygon, Point
from shapely.strtree import STRtree
from pathlib import Path
from collections import Counter
p = out
es = json.load(open(p / 'true-boundaries.json'))
source = json.load(open(p / 'edge-source.json'))
walls = json.load(open(p / 'wall-feet.json'))
walls = [w for w in walls if w['node'].startswith(('city_', 'wall_', 'church_', 'countryside_', 'steen_', 'prison_', 'landmark_', 'oostershuis_')) and (not any((k in w['node'].lower() for k in ['drain', 'ruien', 'gully', 'grate', 'pipe', 'water'])))]
walls = list({tuple(sorted((tuple(np.round(w['a'], 4)), tuple(np.round(w['b'], 4))))): w for w in walls}.values())
lines = [LineString([w['a'], w['b']]) for w in walls]
tree = STRtree(lines)
meshrows = json.load(open(p / 'original-meshes.json'))
polygons = []
for row in meshrows:
    v = np.array(row['vertices'])[:, [0, 2]]
    ix = np.array(row['indices']).reshape(-1, 3)
    polygons.extend(shapely.polygons(v[ix]))
ground = STRtree(polygons)
plans = json.load(open(p / 'fitted-patches.json'))
n = len(plans)
plans = [e for e in plans if not len(ground.query(Point(np.mean([e[k] for k in 'abcd'], axis=0)), predicate='within'))]
print('ground coverage rejects', n - len(plans))
oldpolys = [Polygon([e[k] for k in 'abcd']) for e in plans]
oldtree = STRtree(oldpolys)
extra = []
for e in es:
    a = np.array(e['a'])
    b = np.array(e['b'])
    d = b - a
    length = np.linalg.norm(d)
    if length < 0.001 or str(e['edge']) not in source:
        continue
    u = d / length
    ai, bi, ci, inside = source[str(e['edge'])]
    inside = np.array(inside)
    candidates = []
    for j in tree.query(LineString([a, b]).buffer(0.02)):
        wall = walls[j]
        c = np.array(wall['a'])
        z = np.array(wall['b'])
        w = z - c
        wl = np.linalg.norm(w)
        if wl < 0.001 or abs(np.dot(u, w / wl)) < 0.999:
            continue
        lo, hi = sorted([np.dot(c - a, u), np.dot(z - a, u)])
        lo = max(0, lo)
        hi = min(length, hi)
        if hi - lo < 0.001:
            continue
        aa = a + u * lo
        bb = a + u * hi
        cc = c + w * np.dot(aa - c, w) / np.dot(w, w)
        dd = c + w * np.dot(bb - c, w) / np.dot(w, w)
        width = max(np.linalg.norm(cc - aa), np.linalg.norm(dd - bb))
        if width < 0.0002 or width > 0.02:
            continue
        cross = lambda x, y: x[0] * y[1] - x[1] * y[0]
        if cross(d, inside - a) * cross(d, (cc + dd - aa - bb) / 2) >= 0:
            continue
        mid = Point((aa + bb + cc + dd) / 4)
        if len(ground.query(mid, predicate='within')):
            continue
        poly = Polygon([aa, bb, dd, cc])
        if not poly.is_valid or poly.area < 1e-07:
            continue
        if any((poly.intersection(oldpolys[k]).area > 1e-07 for k in oldtree.query(poly))):
            continue
        candidates.append((width, lo, hi, aa, bb, dd, cc, wall['node']))
    used = []
    for width, lo, hi, aa, bb, dd, cc, node in sorted(candidates, key=lambda x: x[0]):
        if any((min(hi, h) - max(lo, l) > 0.0001 for l, h in used)):
            continue
        used.append((lo, hi))
        extra.append(dict(resource=e['resource'], edge=e['edge'], other=node, a=aa.tolist(), b=bb.tolist(), c=dd.tolist(), d=cc.tolist(), width=width, triangle=[ai, bi, ci]))
hashes = {r['id']: hashlib.sha256((originals / (r['id'] + '.res')).read_bytes()).hexdigest().upper() for r in meshrows}
for e in plans + extra:
    e['source_sha256'] = hashes[Path(e['resource']).stem]
json.dump(plans + extra, open(p / 'fitted-with-walls.json', 'w'))
print('wall closures', len(extra), Counter((e['resource'].split('/')[-1] for e in extra)))
print('walls', Counter((e['other'].split('_')[0] for e in extra)))
# Reserve every recorded Ruien inlet opening. Split long closures either side of the
# inlet's projected diameter, rather than sealing drainage or dropping the entire seam.
inlets = json.load(open(Path(__file__).resolve().parents[1] / 'native-godot/world/town/drainage/ruien-inlets.json'))
inlet_shapes = [Point(d['world'][0], d['world'][2]).buffer(d['diameterMetres'] / 2 + 0.001) for d in inlets if abs(d['world'][1]) < 0.05]
inlet_tree = STRtree(inlet_shapes)
reserved = []
for patch in plans + extra:
    a, b, c, d = [np.array(patch[k]) for k in 'abcd']
    poly = Polygon([a, b, c, d])
    intervals = [(0.0, 1.0)]
    direction = b - a
    length = np.linalg.norm(direction)
    for index in inlet_tree.query(poly, predicate='intersects'):
        shape = inlet_shapes[index]
        center = np.array(shape.centroid.coords[0])
        radius = (shape.bounds[2] - shape.bounds[0]) / 2
        t = np.dot(center - a, direction) / (length * length)
        lo, hi = t - radius / length, t + radius / length
        remainder = []
        for start, end in intervals:
            if hi <= start or lo >= end:
                remainder.append((start, end))
            else:
                if lo > start:
                    remainder.append((start, lo))
                if hi < end:
                    remainder.append((hi, end))
        intervals = remainder
    for start, end in intervals:
        if (end - start) * length < 0.001:
            continue
        piece = dict(patch)
        for key, position in zip('abcd', [a + direction * start, a + direction * end, d + (c - d) * end, d + (c - d) * start]):
            piece[key] = position.tolist()
        reserved.append(piece)
json.dump(reserved, open(p / 'fitted-with-walls.json', 'w'))
print('After reserving drainage:', len(reserved), 'closures')
# Partition three-way junctions so coplanar closures never compete in the depth buffer.
shapes = [Polygon([patch[k] for k in 'abcd']) for patch in reserved]
closure_tree = STRtree(shapes)
partitioned = []
for i, patch in enumerate(reserved):
    previous = [shapes[int(j)] for j in closure_tree.query(shapes[i], predicate='intersects') if j < i]
    remainder = shapes[i].difference(shapely.union_all(previous)) if previous else shapes[i]
    if remainder.equals(shapes[i]):
        partitioned.append(patch)
    elif not remainder.is_empty:
        for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(remainder)):
            if triangle.area < 1e-10:
                continue
            piece = dict(patch)
            piece['points'] = [list(point) for point in list(triangle.exterior.coords)[:3]]
            partitioned.append(piece)
json.dump(partitioned, open(p / 'fitted-with-walls.json', 'w'))
print('Partitioned:', len(partitioned), 'pieces;', sum(len(e.get('points', [0, 1, 2, 3])) - 2 for e in partitioned), 'triangles')
