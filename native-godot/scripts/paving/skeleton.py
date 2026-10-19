# H5: centre lines of the visible cobble streets (0.25 m), cut at junctions, short spurs dropped.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import json, collections, sys, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage.morphology import skeletonize, disk, opening
g=json.load(open(W+'grid.json')); X0,Z0,R=g['X0'],g['Z0'],g['R']
KIND=sys.argv[1] if len(sys.argv)>1 else 'cobble'
s=np.load(W+f'ground_{KIND}-street.npy')
K=5; RC=R*K
h,w=s.shape[0]//K*K,s.shape[1]//K*K
c=s[:h,:w].reshape(h//K,K,w//K,K).mean((1,3))>0.5
from skimage.morphology import closing, remove_small_holes
c=remove_small_holes(c, max_size=int(40/(RC*RC)))
c=opening(closing(c,disk(3)),disk(3))
dist=ndi.distance_transform_edt(c)*RC
sk=skeletonize(c)
NB=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
pts=set(zip(*np.nonzero(sk)))
deg={p:sum((p[0]+a,p[1]+b) in pts for a,b in NB) for p in pts}
nodes={p for p,d in deg.items() if d!=2}
E=[];seen=set()
for n in nodes:
    for a,b in NB:
        q=(n[0]+a,n[1]+b)
        if q not in pts or (n,q) in seen: continue
        path=[n,q];seen.add((n,q));prev,cur=n,q
        while cur not in nodes:
            nxt=[(cur[0]+a2,cur[1]+b2) for a2,b2 in NB if (cur[0]+a2,cur[1]+b2) in pts and (cur[0]+a2,cur[1]+b2)!=prev and (cur[0]+a2,cur[1]+b2) not in path[-3:]]
            if not nxt: break
            # prefer 4-neighbours
            nxt.sort(key=lambda t:abs(t[0]-cur[0])+abs(t[1]-cur[1]))
            prev,cur=cur,nxt[0];path.append(cur)
        seen.add((path[-1],path[-2]));E.append(path)
def key(p): return (int(p[0]),int(p[1]))
for it in range(6):
    d=collections.Counter()
    for e in E: d[key(e[0])]+=1;d[key(e[-1])]+=1
    keep=[]
    for e in E:
        L=len(e)*RC; mid=dist[e[len(e)//2]]
        loose=d[key(e[0])]==1 or d[key(e[-1])]==1
        if loose and L<2.0+2.0*mid: continue
        if key(e[0])==key(e[-1]) and L<4: continue
        keep.append(e)
    E=keep
print('edges',len(E))
def world(p): return (X0+(p[1]+0.5)*RC, Z0+(p[0]+0.5)*RC)
out=[{'pts':[world(p) for p in e],'width':[float(dist[p]) for p in e]} for e in E]
json.dump(out,open(W+(f'skeleton-{KIND}.json' if KIND!='cobble' else 'skeleton.json'),'w'))
np.save(W+('street-25.npy' if KIND=='cobble' else f'street25-{KIND}.npy'),c); np.save(W+f'dist25-{KIND}.npy',dist)
im=Image.fromarray((c*90).astype(np.uint8)).convert('RGB'); dr=ImageDraw.Draw(im)
for e in E:
    dr.line([(p[1],p[0]) for p in e],fill=(255,50,50),width=1)
    dr.ellipse([e[0][1]-2,e[0][0]-2,e[0][1]+2,e[0][0]+2],outline=(255,255,0))
im.save(W+f'skeleton-{KIND}.png')
