"""Remove deep mud overlays only where real paving exists; keep their earth/bridge portions.
All geometry is computed from a read-only native dump. Source SHA guards are verified by PavingFinishRepair.
"""
import hashlib, json, sys
from pathlib import Path
import numpy as np
import shapely

work = Path(sys.argv[1])
scan = json.loads((work / 'scan.json').read_text())
names = ['ground_quay', 'ground_cobble', 'ground_flags']
polygons = []
for name in names:
    entry = next(e for e in scan if e['node'] == name)
    for surface in entry['surfaces']:
        rows = np.fromfile(work / f'{name}-{surface["s"]}.f32', np.float32).reshape(-1, 3, 5)
        polygons.append(shapely.union_all(shapely.make_valid(shapely.polygons(rows[:, :, [0, 2]]))))
paving = shapely.union_all(polygons)
rows = np.fromfile(work / 'ruts-0.f32', np.float32).reshape(-1, 3, 5)
output = []
bary_output = []
original_area = remaining_area = 0.0
for source_index, row in enumerate(rows):
    xz = row[:, [0, 2]].astype(float)
    polygon = shapely.Polygon(xz)
    if polygon.area < 1e-10:
        continue
    original_area += polygon.area
    rem = polygon.difference(paving)
    remaining_area += rem.area
    for piece in shapely.get_parts(shapely.make_valid(rem)):
        if piece.geom_type != 'Polygon' or piece.area < 1e-9:
            continue
        for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(piece)):
            p = np.asarray(tri.exterior.coords)[:3]
            def cross(a, b): return a[0] * b[1] - a[1] * b[0]
            if cross(p[1]-p[0], p[2]-p[0]) * cross(xz[1]-xz[0], xz[2]-xz[0]) < 0:
                p = p[::-1]
            bary = np.linalg.solve(np.vstack([xz.T, np.ones(3)]), np.vstack([p.T, np.ones(3)])).T
            output.extend(np.column_stack([p[:, 0], bary @ row[:, 1], p[:, 1], bary @ row[:, 3:5]]))
            bary_output.extend(np.column_stack([np.full(3,source_index),bary]))
result = np.asarray(output, np.float32).reshape(-1, 3, 5)
result.tofile(work / 'ruts-earth.f32')
np.asarray(bary_output,np.float32).tofile(work/'ruts-earth-bary.f32')
out_union = shapely.union_all(shapely.polygons(result[:, :, [0, 2]]))
source_union = shapely.union_all(shapely.polygons(rows[:, :, [0, 2]]))
expected = source_union.difference(paving)
error = expected.symmetric_difference(out_union).area
assert error < .0002, error
report = dict(originalArea=original_area, retainedMudArea=remaining_area,
              pavedAreaRestored=original_area-remaining_area, originalTriangles=len(rows),
              remainingTriangles=len(result), coverageErrorM2=error,
              sourceHashes={e['mesh']:e['sha256'] for e in scan if e['node'] in names+['ruts']},
              outputSha256=hashlib.sha256((work/'ruts-earth.f32').read_bytes()).hexdigest(),
              barySha256=hashlib.sha256((work/'ruts-earth-bary.f32').read_bytes()).hexdigest())
(work/'paved-ruts.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
