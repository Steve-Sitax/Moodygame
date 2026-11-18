"""Build only the exposed remnants of the old railway infill, keeping all existing ground visible.
Input: QuayPavingReview scan rows (x,y,z,u,v per corner). This is an offline repair, never startup work.
"""
import json, sys, numpy as np, shapely
from pathlib import Path
w=Path(sys.argv[1])
def read(n): return np.fromfile(w/f'{n}-0.f32',np.float32).reshape(-1,3,5)
def union(r):
 p=shapely.polygons(r[:,:,[0,2]])
 return shapely.union_all(shapely.make_valid(p))
track=read('track_setts'); quay=union(read('ground_quay'))
ground=shapely.union_all([quay]+[union(read(n)) for n in ['ground_cobble','ground_flags','ground_earth']])
result=[]; omitted=0.; maxgap=0.
for r in track:
 p=r[:,[0,2]].astype(float); poly=shapely.Polygon(p)
 if poly.area<1e-10: continue
 rem=poly.difference(ground)
 for piece in shapely.get_parts(shapely.make_valid(rem)):
  if piece.geom_type!='Polygon':continue
  if piece.area<1e-8:omitted+=piece.area;continue
  maxgap=max(maxgap,float(shapely.distance(shapely.points(np.array(piece.exterior.coords)),quay).max()))
  for tri in shapely.get_parts(shapely.constrained_delaunay_triangles(piece)):
   xyz=np.array(tri.exterior.coords)[:3]
   # Match the source's upward winding, not Shapely's ring orientation.
   def cross(a,b): return a[0]*b[1]-a[1]*b[0]
   if cross(xyz[1]-xyz[0],xyz[2]-xyz[0])*cross(p[1]-p[0],p[2]-p[0])<0:xyz=xyz[::-1]
   bary=np.linalg.solve(np.vstack([p.T,np.ones(3)]),np.vstack([xyz.T,np.ones(3)])).T
   y=bary@r[:,1]
   result.extend(np.column_stack([xyz[:,0],y,xyz[:,1],xyz/2.5]))
np.array(result,np.float32).tofile(w/'track-exposed.f32')
report=dict(originalArea=union(track).area,exposedArea=union(track).difference(ground).area,omittedDegenerateArea=omitted,exposedTriangles=len(result)//3,groundCoverage=1-union(track).difference(ground).area/union(track).area,maxRemnantDistance=maxgap)
(w/'coverage.json').write_text(json.dumps(report,indent=2));print(report)

# Remnants inherit the nearest paving's material and exact affine UV frame (quay uses its new straight grid).
ground_rows=[]; kinds=[]
for name in ['ground_quay','ground_cobble','ground_flags','ground_earth']:
 r=read(name); p=r[:,:,[0,2]]
 r=r[np.abs(np.linalg.det(p[:,1:]-p[:,:1]))>1e-8]
 ground_rows.extend(r); kinds.extend([name]*len(r))
ground_rows=np.array(ground_rows); kinds=np.array(kinds)
polys=shapely.polygons(ground_rows[:,:,[0,2]]); tree=shapely.STRtree(polys)
r=np.array(result,np.float32).reshape(-1,3,5)
near=tree.nearest(shapely.points(r[:,:,[0,2]].mean(1)))
manifest=[]
for name in np.unique(kinds[near]):
 ids=np.nonzero(kinds[near]==name)[0]; q=r[ids].copy(); source=ground_rows[near[ids]]
 if name!='ground_quay':
  for j in range(len(q)):
   # Tiny edge slivers may approach a degenerate triangle: the dump filter above rejects those frames.
   p=source[j][:,[0,2]]; e=p[1:]-p[:1]
   frame=np.linalg.solve(e,source[j,1:,3:5]-source[j,:1,3:5])
   q[j,:,3:5]=(q[j][:,[0,2]]-p[0])@frame+source[j,0,3:5]
 file=f'track-exposed-{name}.f32';q.tofile(w/file)
 manifest.append(dict(ground=name,file=file,triangles=len(q)))
(w/'track-surfaces.json').write_text(json.dumps(manifest,indent=2))
print(manifest)

# Bind the candidate to its dumped source bytes and generated triangle files.
import hashlib
scan=json.loads((w/'scan.json').read_text())
source_hashes={row['mesh']:row['sha256'] for row in scan if row['node'] in ['ground_quay','ground_cobble','ground_flags','ground_earth','track_setts']}
files=[entry['file'] for entry in manifest]+['track-surfaces.json']
(w/'candidate.json').write_text(json.dumps({'sourceHashes':source_hashes,'outputs':{name:hashlib.sha256((w/name).read_bytes()).hexdigest() for name in files}},indent=2))
