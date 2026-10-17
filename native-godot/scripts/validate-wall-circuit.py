"""Validate staged environmental geometry and Ruien reservations without loading actors."""
import hashlib,json,pathlib,sys
import numpy as np
p=pathlib.Path(sys.argv[1]);root=p.parents[1];manifest=json.loads((p/'mesh-manifest.json').read_text());failures=[];checks={};total=0
for resource,surfaces in manifest.items():
 for s in surfaces:
  a=np.fromfile(p/'geometry'/s['file'],np.float32).reshape(-1,16).astype(np.float64)
  if len(a)!=s['vertices'] or len(a)%3:failures.append(s['file']+' length mismatch')
  if not np.isfinite(a).all():failures.append(s['file']+' nonfinite data')
  tri=a.reshape(-1,3,16);cross=np.cross(tri[:,2,:3]-tri[:,0,:3],tri[:,1,:3]-tri[:,0,:3]);area=np.linalg.norm(cross,axis=1);good=area>1e-9
  norm=np.linalg.norm(a[:,3:6],axis=1);align=(cross[good]/area[good,None]*tri[good,:,3:6].mean(1)).sum(1)
  if len(a) and abs(norm-1).max()>.001:failures.append(s['file']+' nonunit normals')
  if len(align) and align.min()<-.001:failures.append(s['file']+' inverted winding')
  checks[s['file']]={'triangles':len(tri),'tinyTriangles':int((~good).sum()),'minimumWinding':float(align.min()) if len(align) else 1}
  total+=len(tri)
for resource,expected in json.loads((p/'source-hashes.json').read_text()).items():
 if hashlib.sha256((root/resource.replace('res://','')).read_bytes()).hexdigest()!=expected:failures.append('Source changed '+resource)
ports=json.loads((p/'ruien-connections.json').read_text())
if len({q['id'] for q in ports})!=len(ports):failures.append('Duplicate Ruien IDs')
for q in ports:
 if q['undergroundConnection'][1]>=q['world'][1] or q['diameterMetres']<=0:failures.append('Invalid Ruien invert '+q['id'])
# The exact reported strip: both original top triangles must now be recessed 12 mm.
base=np.fromfile(p/'geometry/r000879-0.bin',np.float32).reshape(-1,3,16)
original=np.array(json.loads((p.parent/'city-junction/r000879-0.json').read_text()));original=original.reshape(-1,3,original.shape[-1])
top=original[:,:,4].mean(1)>.99
centers=base[base[:,:,4].mean(1)>.99,:,:3].mean(1)
for tri in original[top]:
 expected=tri[:,:3].mean(0)-np.array([0,.012,0]);distance=np.linalg.norm(centers-expected,axis=1).min()
 if distance>.0002:failures.append('Unrecessed horizontal plinth backing at '+str(expected.tolist()))
result={'passed':not failures,'meshResources':len(manifest),'triangles':total,'newRuienPorts':len(ports),'failures':failures,'surfaces':checks}
(p/'geometry-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps({k:v for k,v in result.items() if k!='surfaces'},indent=2));sys.exit(bool(failures))
