"""Fit the wall-stair-09 bedding return from a native mesh audit.
Usage: python tools/ground-apron-junction.py AUDIT_DIR APRON_JSON OUTPUT_PLAN
AUDIT_DIR is the output of ground-junctions.py. Writes the combined plan only.
"""
import sys,json,numpy as np,shapely
from pathlib import Path
from shapely.geometry import Polygon,Point,LineString
p=Path(sys.argv[1])
rows=json.load(open(sys.argv[2]))
# Measured horizontal bedding top at -20 mm, not the tile tops or the gully.
faces=[]
for row in rows:
 if row['id']!='r000880':continue
 for tri in np.array(row['triangles']):
  if np.max(np.abs(tri[:,1]+.02))<.0002:faces.append(Polygon(tri[:,[0,2]]))
if not faces:raise ValueError('Measured wall-stair-09 bedding top was not found')
base=shapely.union_all(faces)
print('bedding bounds',base.bounds,'area',base.area)
source=json.load(open(p/'edge-source.json')); boundaries=json.load(open(p/'true-boundaries.json')); plan=json.load(open(p/'fitted-with-walls.json'))
extra=[]
for edge in boundaries:
 if not edge['resource'].endswith('r000025.res') or str(edge['edge']) not in source:continue
 a=np.array(edge['a']); b=np.array(edge['b']); mid=(a+b)/2;d=b-a;length=np.linalg.norm(d)
 if length<.001 or max(base.boundary.distance(Point(a)),base.boundary.distance(Point(b)),base.boundary.distance(Point(mid)))>.035:continue
 ai,bi,ci,inside=source[str(edge['edge'])]; outward=np.array([-d[1],d[0]])/length
 if np.dot(outward,np.array(inside)-a)>0:outward=-outward
 if not base.buffer(.003).covers(Point(mid+outward*.012)):continue
 # Match actual bedding, with 4 mm overlap behind its bevel; no uniform map-wide skirt.
 widths=[base.distance(Point(x))+.004 for x in [a,b]]
 aa=a+outward*widths[0];bb=b+outward*widths[1]
 xyz=[[a[0],0,a[1]],[b[0],0,b[1]],[bb[0],-.025,bb[1]],[aa[0],-.025,aa[1]]]
 n=-np.cross(np.array(xyz[1])-xyz[0],np.array(xyz[2])-xyz[0]);n/=np.linalg.norm(n)
 if n[1]<0:n=-n
 template=next(e for e in plan if e['resource']==edge['resource'])
 extra.append(dict(resource=edge['resource'],source_sha256=template['source_sha256'],triangle=[ai,bi,ci],xyz=xyz,normal=n.tolist(),width=max(widths),other='wall-stair-09 bedding top -20mm; 5mm vertical overlap'))
if not extra:raise ValueError('No matching ground/apron boundary found; inspect the native geometry')
print('fitted bedding returns',len(extra),'triangles',len(extra)*2)
json.dump(plan+extra,open(sys.argv[3],'w'),indent=2)
