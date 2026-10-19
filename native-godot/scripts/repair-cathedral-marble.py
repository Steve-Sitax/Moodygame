"""Repair the reviewed cathedral marble components, retaining untouched rows and materials.
Blender -b -P repair-cathedral-marble.py -- <original audit> <candidate>.
Audit the two shared marble meshes after the guarded five-side-altar cut. Positions
are world space; a component crossing the bounds is retained, never clipped.
"""
import hashlib, json, math, pathlib, runpy, sys
import numpy as np
repair_module = runpy.run_path(str(pathlib.Path(__file__).with_name('repair-landmark-stone.py')))
components, repair = repair_module['components'], repair_module['repair']

def triangle(rows, points, normals, uv=None):
    tri=np.repeat(rows.reshape(-1,16).mean(0)[None,:],3,axis=0)
    tri[:,:3]=points;tri[:,3:6]=normals
    if uv is not None:tri[:,6:8]=uv
    if np.dot(np.cross(tri[1,:3]-tri[0,:3],tri[2,:3]-tri[0,:3]),tri[:,3:6].mean(0))>0:tri=tri[[0,2,1]]
    return tri

def baluster(part):
    # Preserve the original axis, taper and end heights; replace its six broad facets.
    points=part[:,:,:3].reshape(-1,3);lo,hi=points.min(0),points.max(0)
    rings=[np.unique(points[np.isclose(points[:,1],y,atol=1e-5)],axis=0) for y in (lo[1],hi[1])]
    rings=[r[np.linalg.norm(r[:,[0,2]]-r[:,[0,2]].mean(0),axis=1)>.02] for r in rings]
    centers=[r[:,[0,2]].mean(0) for r in rings];center=np.mean(centers,axis=0)
    radii=[np.linalg.norm(r[:,[0,2]]-center,axis=1).mean() for r in rings]
    assert len(part)==24 and all(len(r)==6 for r in rings) and np.linalg.norm(centers[0]-centers[1])<.002
    h=float(hi[1]-lo[1]);r0,r1=map(float,radii);bevel=.005;slope=(r1-r0)/h
    profile=[]
    for t in np.linspace(0,math.pi/2,5):
        y=bevel*(1-math.cos(t));profile.append((y,r0+slope*y-bevel+bevel*math.sin(t),-math.cos(t),math.sin(t)))
    for t in np.linspace(0,math.pi/2,5):
        y=h-bevel+bevel*math.sin(t);profile.append((y,r0+slope*y-bevel+bevel*math.cos(t),math.sin(t),math.cos(t)))
    def vertex(j,k):
        y,r,ny,nr=profile[j];a=2*math.pi*k/32
        n=np.array([nr*math.cos(a),ny-slope*nr,nr*math.sin(a)]);n/=np.linalg.norm(n)
        return [center[0]+r*math.cos(a),lo[1]+y,center[1]+r*math.sin(a)],n,[a*(r0+r1)/2/1.2,y/1.2]
    result=[]
    for j in range(len(profile)-1):
        for k in range(32):
            q=[vertex(j,k),vertex(j,k+1),vertex(j+1,k+1),vertex(j+1,k)]
            for ids in ((0,1,2),(0,2,3)):
                result.append(triangle(part,[q[i][0] for i in ids],[q[i][1] for i in ids],[q[i][2] for i in ids]))
    for j,ny in ((0,-1),(len(profile)-1,1)):
        for k in range(32):
            p=[vertex(j,k)[0],vertex(j,k+1)[0],[center[0],lo[1]+profile[j][0],center[1]]]
            result.append(triangle(part,p,[[0,ny,0]]*3,[[v[0]/1.2,v[2]/1.2] for v in p]))
    return np.array(result)

def rail_cap(part):
    # The source bar crosses the closed brass gate. End the two stone slabs at its posts.
    lo,hi=part[:,:,:3].min((0,1)),part[:,:,:3].max((0,1))
    assert len(part)==28 and np.allclose(lo,[-267.90024,1.219853,227.21962],atol=.002) and np.allclose(hi,[-256.10052,1.339889,227.63655],atol=.002)
    result=[];edges=0
    for x0,x1 in ((lo[0],-262.5402),(-261.46052,hi[0])):
        p=np.array([[x,y,z] for x in (x0,x1) for y in (lo[1],hi[1]) for z in (lo[2],hi[2])])
        faces=((0,1,3,2),(4,6,7,5),(0,4,5,1),(2,3,7,6),(0,2,6,4),(1,5,7,3))
        raw=[]
        for ids in faces:
            q=p[list(ids)];n=q.mean(0)-p.mean(0);n/=np.linalg.norm(n)
            for ii in ((0,1,2),(0,2,3)):raw.append(triangle(part,q[list(ii)],[n]*3))
        rr,e,_=repair(np.array(raw),radius=.012,segments=4);result.append(rr.reshape(-1,3,16));edges+=e
    return np.concatenate(result),edges
audit, out = map(pathlib.Path, sys.argv[sys.argv.index('--') + 1:]); out.mkdir(parents=True, exist_ok=True)
# Whole components only, including both mirrored transept altars and nave epitaphs.
boxes = [([-269., .29, 226.65], [-255., 16., 257.85]),
         ([-244., .29, 224.], [-235.5, 11.5, 227.]),
         ([-288.5, .29, 224.], [-280., 11.5, 227.]),
         ([-287.3, 2.3, 156.], [-286.5, 5.8, 159.]),
         ([-237.5, 2.3, 156.], [-236.8, 5.8, 159.])]
boxes = [(np.array(lo), np.array(hi)) for lo,hi in boxes]
entries, report = [], []
for rec in json.loads((audit/'audit.json').read_text()):
    entry = dict(mesh=rec['mesh'], nodePath=rec['nodePath'], sourceHash=rec['meshHash'], surfaces=[])
    for s in rec['surfaces']:
        if s['name'] not in ('ct_marble_w','ct_marble_b'): continue
        rows=np.fromfile(audit/'source'/s['file'],np.float32).reshape(-1,3,16)
        result=[]; kept=[]; rounded=charts=pieces=turned=0;split_cap=False
        for ids in components(rows):
            part=rows[ids]
            if not any((part[:,:,:3].min((0,1))>=lo-.002).all() and (part[:,:,:3].max((0,1))<=hi+.002).all() for lo,hi in boxes):
                result.append(part.reshape(-1,16)); kept.append(part); continue
            plo,phi=part[:,:,:3].min((0,1)),part[:,:,:3].max((0,1))
            is_baluster=s['name']=='ct_marble_w' and len(part)==24 and 227.34<plo[2]<227.36 and 227.50<phi[2]<227.52 and abs(plo[1]-.419969)<.002 and abs(phi[1]-1.279848)<.002
            is_cap=s['name']=='ct_marble_b' and len(part)==28 and abs(plo[1]-1.219853)<.002 and abs(phi[1]-1.339889)<.002 and plo[0]<-267.89 and phi[0]>-256.11
            if is_baluster:rr=baluster(part);edges=64;turned+=1
            elif is_cap:rr,edges=rail_cap(part);split_cap=True
            else:rr,edges,_=repair(part);rr=rr.reshape(-1,3,16)
            # Separate planar charts preserve a 1.2 m repeat on narrow returns and broad tops.
            for tri in (() if is_baluster else rr):
                n=np.cross(tri[1,:3]-tri[0,:3],tri[2,:3]-tri[0,:3])
                axis=int(np.argmax(abs(n))); axes=[i for i in range(3) if i!=axis]
                tri[:,6:8]=tri[:,axes]/1.2
            result.append(rr.reshape(-1,16));rounded+=edges;charts+=len(rr);pieces+=1
        if not pieces: continue
        assert turned==(39 if s['name']=='ct_marble_w' else 0)
        assert split_cap==(s['name']=='ct_marble_b')
        result=np.concatenate(result).astype(np.float32)
        assert np.isfinite(result).all()
        triangles=result.reshape(-1,3,16)
        cross=np.cross(triangles[:,1,:3]-triangles[:,0,:3],triangles[:,2,:3]-triangles[:,0,:3])
        if (np.linalg.norm(cross,axis=1)<1e-9).any() or ((cross*triangles[:,:,3:6].mean(1)).sum(1)>1e-7).any():
            raise RuntimeError('Degenerate triangle or inward normal: '+s['file'])
        protected=np.concatenate(kept).astype(np.float32).tobytes() if kept else b''
        result.tofile(out/s['file'])
        entry['surfaces'].append(dict(index=s['index'],file=s['file'],material=s['material'],custom0=s['custom0']))
        report.append(dict(mesh=rec['mesh'],material=s['name'],pieces=pieces,roundedEdges=rounded,metricCharts=charts,
                           originalTriangles=len(rows),finalTriangles=len(result)//3,protectedTriangles=sum(len(x) for x in kept),
                           protectedSha256=hashlib.sha256(protected).hexdigest(),turnedBalusters=turned,splitRailCap=split_cap))
    if entry['surfaces']:entries.append(entry)
(out/'manifest.json').write_text(json.dumps(dict(surfaceRepairs=entries),indent=2))
(out/'geometry-report.json').write_text(json.dumps(dict(bounds=[[lo.tolist(),hi.tolist()] for lo,hi in boxes],surfaces=report),indent=2))
print(json.dumps(report,indent=2))
