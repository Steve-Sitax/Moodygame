"""Check a fitted plan for overlapping coplanar patches and blocked Ruien inlets.
Usage: python tools/ground-junction-check.py PLAN_JSON EXTERNAL_RECEIPT_JSON
Requires shapely. Spatial bedding returns are checked against inlets, but their
projected overlap with horizontal paving is intentional and is not coplanar.
"""
import json
import sys
from pathlib import Path
from shapely.geometry import Point, Polygon
from shapely.strtree import STRtree

plan = json.loads(Path(sys.argv[1]).read_text())
inlets = json.loads((Path(__file__).resolve().parents[1] /
                    'native-godot/world/town/drainage/ruien-inlets.json').read_text())
polygons = [Polygon([(v[0], v[2]) for v in patch['xyz']] if 'xyz' in patch else
                    patch['points'] if 'points' in patch else [patch[k] for k in 'abcd'])
            for patch in plan]
tree = STRtree(polygons)
blocked = []
for inlet in inlets:
    opening = Point(inlet['world'][0], inlet['world'][2]).buffer(inlet['diameterMetres'] / 2)
    hits = tree.query(opening, predicate='intersects')
    if len(hits):
        blocked.append({'id': inlet['id'], 'patches': [int(i) for i in hits]})
overlaps = []
for i, polygon in enumerate(polygons):
    if 'xyz' in plan[i]:
        continue
    for j in tree.query(polygon, predicate='intersects'):
        if j <= i or 'xyz' in plan[j]:
            continue
        area = polygon.intersection(polygons[j]).area
        if area > 1e-7:
            overlaps.append({'a': i, 'b': int(j), 'area': area})
receipt = {'pieces': len(plan), 'triangles': sum(len(p.get('points', p.get('xyz', [0]*4))) - 2 for p in plan),
           'inlets': len(inlets), 'blocked_inlets': blocked, 'coplanar_overlaps': overlaps}
Path(sys.argv[2]).write_text(json.dumps(receipt, indent=2))
print(json.dumps(receipt))
sys.exit(1 if blocked or overlaps else 0)
