"""Geometry invariants for the staged city repair; no image processing."""
import json, pathlib, sys
import numpy as np
folder=pathlib.Path(sys.argv[1]); checks={}; failures=[]
def data(name): return np.array(json.loads((folder/name).read_text()),dtype=np.float64)
for path in list(folder.glob('*-repaired.json'))+[folder/n for n in ['ashlar-additions.json','quoin-additions.json','construction-stone.json','construction-iron.json','plants.json','window-joinery.json']]:
    a=data(path.name);tri=a.reshape(-1,3,a.shape[1]);n=np.cross(tri[:,2,:3]-tri[:,0,:3],tri[:,1,:3]-tri[:,0,:3]);area=np.linalg.norm(n,axis=1)
    unit=np.linalg.norm(a[:,3:6],axis=1);valid=area>1e-9
    alignment=(n[valid]/area[valid,None]*tri[valid,0,3:6]).sum(1)
    checks[path.name]={'triangles':len(tri),'nonFinite':int((~np.isfinite(a)).sum()),'tinyTriangles':int((~valid).sum()),'maxNormalError':float(abs(unit-1).max()),'minWindingAlignment':float(alignment.min())}
    if not np.isfinite(a).all() or abs(unit-1).max()>.001 or alignment.min()<.95: failures.append(path.name+' invalid normals or winding')
    if a.shape[1]==16 and '-repaired' in path.name:
        source=data(path.name.replace('-repaired','-0'))
        old=set(tuple(np.round(r[14:16],4)) for r in source);new=set(tuple(np.round(r[14:16],4)) for r in a)
        if not new.issubset(old):failures.append(path.name+' changed house material selection')

foot=np.array([212.9183,0,30.7344]);t=np.array([.16092,0,.98697]);o=np.array([.98697,0,-.16092])
def top(rows,point):
    tri=rows.reshape(-1,3,rows.shape[1]);tri=tri[tri[:,0,4]>.25,:,:3]
    a=tri[:,0,[0,2]];b=tri[:,1,[0,2]];c=tri[:,2,[0,2]];q=point[[0,2]]
    v0=b-a;v1=c-a;v2=q-a;den=v0[:,0]*v1[:,1]-v1[:,0]*v0[:,1];safe=abs(den)>1e-10;den=np.where(safe,den,1)
    u=(v2[:,0]*v1[:,1]-v1[:,0]*v2[:,1])/den;v=(v0[:,0]*v2[:,1]-v2[:,0]*v0[:,1])/den
    hit=safe&(u>=-1e-5)&(v>=-1e-5)&(u+v<=1.00001)
    height=tri[:,0,1]+u*(tri[:,1,1]-tri[:,0,1])+v*(tri[:,2,1]-tri[:,0,1])
    return float(height[hit].max()) if hit.any() else None
old=data('r000880-0.json');new=np.concatenate([data('r000880-repaired.json'),data('construction-stone.json')]);diff=[]
for step in range(36):
    for across in [-.6,-1.25]:
        p=foot+t*((step+.5)*11.7/36)+o*across;a=top(old,p);b=top(new,p)
        if a is None or b is None:failures.append('missing stair tread '+str(step))
        else:diff.append(abs(a-b))
checks['walkSupport']={'sampledTreads':72,'maxHeightChangeMetres':max(diff)}
if max(diff)>.015:failures.append('stair support changed beyond the bevel envelope')
for along in [-.5,1,3,6,10,13.6]:
    for across in [-2.1,-2.5,-2.9]:
        if along>0 and across>-2.3:continue
        p=foot+t*along+o*across;h=top(new,p)
        if h is None:failures.append('apron hole '+str((along,across)))
roof=data('r000264-repaired.json');eave=roof[(roof[:,0]>200.39)&(roof[:,0]<200.41)&(roof[:,2]>3.9)&(roof[:,2]<44.1)]
checks['roofEaveY']=float(eave[:,1].min())
if checks['roofEaveY']<10.165:failures.append('roof still intersects wall top')
connections=json.loads((folder/'ruien-connections.json').read_text())
guard=next(p for p in connections if p['id']=='guardhouse-gully')
wall_normal=np.array([.16264324,0,.98668494])
clearance=float(np.dot(guard['world'],wall_normal)-82.61977199-.1725*(abs(wall_normal[0])+abs(wall_normal[2])))
checks['guardGrateWallClearanceMetres']=clearance
if clearance<.02:failures.append('guardhouse grate intersects or crowds parapet')
for inlet in connections:
    if inlet['undergroundConnection'][1]>=inlet['world'][1] or inlet['diameterMetres']<=0:failures.append('invalid Ruien reservation '+inlet['id'])
result={'checks':checks,'failures':failures,'passed':not failures}
(folder/'geometry-validation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));sys.exit(bool(failures))
