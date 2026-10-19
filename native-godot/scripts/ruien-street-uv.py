"""Restore a collapsed street UV chart without changing its geometry or paving size.

Input: JSON vertices, uv, indices from the ORIGINAL ground mesh, before runtime cuts.
Select the continuous chart at --at X Z. Its sound triangles establish the rows' direction
and phase; a metric planar chart replaces the folded mapping. Inspect the full chart's
bounds before promoting the vertex UV patch with ruien-street-uv.gd.
"""
import argparse, json
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

p=argparse.ArgumentParser()
p.add_argument('source');p.add_argument('output');p.add_argument('--at',nargs=2,type=float,required=True)
p.add_argument('--tile',type=float,default=3)
a=p.parse_args()
d=json.load(open(a.source));v=np.array(d['vertices']);uv=np.array(d['uv']);ix=np.array(d['indices']).reshape(-1,3)
points=v[ix];tex=uv[ix]
# Exported triangles split vertices, including every deliberate chart seam.
_,ids=np.unique(np.round(np.concatenate([points,tex],2).reshape(-1,5),4),axis=0,return_inverse=True)
rows=np.repeat(np.arange(len(ix)),3)
m=coo_matrix((np.ones(len(rows)),(rows,ids)),shape=(len(ix),ids.max()+1)).tocsr()
_,labels=connected_components(m@m.T)
centres=points.mean(1)
seed=np.argmin(np.linalg.norm(centres[:,[0,2]]-a.at,axis=1))
mask=labels==labels[seed];p3=points[mask];t2=tex[mask]
xy=p3[:,:,[0,2]]
edge=xy[:,1:]-xy[:,:1];duv=t2[:,1:]-t2[:,:1]
valid=abs(np.linalg.det(edge))>1e-7
j=np.zeros_like(edge);j[valid]=np.linalg.solve(edge[valid],duv[valid])
sv=np.linalg.svd(j,compute_uv=False)
sound=valid&(sv[:,1]>.28)&(sv[:,0]<.39)&(sv[:,0]/np.maximum(sv[:,1],1e-8)<1.15)
if sound.sum()<3:raise ValueError('Chart has too few sound triangles to establish its direction')
weights=abs(np.linalg.det(edge[sound]));average=np.average(j[sound],axis=0,weights=weights)
u,_,vh=np.linalg.svd(average);metric=u@vh/a.tile
anchor=np.flatnonzero(sound)[np.argmin(np.linalg.norm(xy[sound].mean(1)-np.mean(xy,axis=(0,1)),axis=1))]
origin=xy[anchor].mean(0);phase=t2[anchor].mean(0)
vertices=np.unique(ix[mask]);fixed=(v[vertices][:,[0,2]]-origin)@metric+phase
out={'triangles':int(mask.sum()),'bounds':[p3.min((0,1)).tolist(),p3.max((0,1)).tolist()],
     'tile':a.tile,'metric':metric.tolist(),'uv':[[int(i),float(q[0]),float(q[1])] for i,q in zip(vertices,fixed)]}
json.dump(out,open(a.output,'w'));print({k:x for k,x in out.items() if k!='uv'})
