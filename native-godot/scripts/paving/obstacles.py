# H5: rasterise the town's permanent structures near the ground (5 cm) and the ground meshes' areas.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import json, sys, numpy as np, cv2, time
D=W+'dump/'
g=json.load(open(D+'ground.json'))
KEEP=('city','town_wall','churches','townplaces','lock')
nodes=g['obstacleNodes']
order=list(nodes.items())  # insertion order = dump order
tri=np.fromfile(D+'obstacles.f32',dtype=np.float32).reshape(-1,3,3)
sel=np.zeros(len(tri),bool); o=0
for k,n in order:
    top=k.split('/')[0]
    if top in KEEP or top.startswith('ROOM_'): sel[o:o+n]=True
    o+=n
assert o==len(tri)
t=tri[sel]; y=t[:,:,1]
t=t[(y.min(1)<0.25)&(y.max(1)>0.04)]
print('obstacle triangles',len(t))
X0,Z0,R=-370.0,-50.0,0.05
NX,NZ=int(610/R),int(410/R)
occ=np.zeros((NZ,NX),np.uint8)
p=np.round(((t[:,:,[0,2]]-[X0,Z0])/R)*16).astype(np.int32)  # 4 bits subpixel
t0=time.time()
for i in range(0,len(p),200000):
    cv2.fillPoly(occ,list(p[i:i+200000]),1,lineType=cv2.LINE_8,shift=4)
print('raster',time.time()-t0)
np.save(W+'occ.npy',occ)
for name in ['ground_cobble','ground_flags','ground_quay']:
    a=np.fromfile(D+name+'-0.f32',dtype=np.float32).reshape(-1,3,16)[:,:,[0,2]]
    m=np.zeros((NZ,NX),np.uint8)
    q=np.round(((a-[X0,Z0])/R)*16).astype(np.int32)
    cv2.fillPoly(m,list(q),1,lineType=cv2.LINE_8,shift=4)
    np.save(W+name+'.npy',m)
    vis=(m>0)&(occ==0)
    print(name,'area',m.sum()*R*R,'visible',vis.sum()*R*R)
json.dump({'X0':X0,'Z0':Z0,'R':R,'NX':NX,'NZ':NZ},open(W+'grid.json','w'))
