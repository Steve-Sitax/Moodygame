"""CPU rasterization adapter for local Hunyuan texture baking.

Uses the existing numba installation; avoids changing the user's ComfyUI packages.
The output is the face-id and perspective-correct barycentric buffers expected by
Hunyuan's texture renderer. This is offline asset tooling, never game runtime.
"""
import numpy as np
import torch
from numba import njit

@njit(cache=True)
def _raster(pos, tri, height, width):
    depth = np.full((height, width), np.inf, dtype=np.float32)
    faces = np.zeros((height, width), dtype=np.int32)
    bary = np.zeros((height, width, 3), dtype=np.float32)
    p = np.empty((len(pos), 3), dtype=np.float32)
    for i in range(len(pos)):
        p[i, 0] = (pos[i, 0] / pos[i, 3] * .5 + .5) * (width - 1) + .5
        p[i, 1] = (pos[i, 1] / pos[i, 3] * .5 + .5) * (height - 1) + .5
        p[i, 2] = pos[i, 2] / pos[i, 3]
    for f in range(len(tri)):
        ia, ib, ic = tri[f]
        a, b, c = p[ia], p[ib], p[ic]
        det = (b[1]-c[1])*(a[0]-c[0]) + (c[0]-b[0])*(a[1]-c[1])
        if abs(det) < 1e-12:
            continue
        xmin=max(0,int(np.floor(min(a[0],b[0],c[0]))))
        xmax=min(width-1,int(np.ceil(max(a[0],b[0],c[0]))))
        ymin=max(0,int(np.floor(min(a[1],b[1],c[1]))))
        ymax=min(height-1,int(np.ceil(max(a[1],b[1],c[1]))))
        for y in range(ymin,ymax+1):
            for x in range(xmin,xmax+1):
                u=((b[1]-c[1])*(x+.5-c[0])+(c[0]-b[0])*(y+.5-c[1]))/det
                v=((c[1]-a[1])*(x+.5-c[0])+(a[0]-c[0])*(y+.5-c[1]))/det
                w=1-u-v
                if min(u,v,w) < -1e-6:
                    continue
                z=u*a[2]+v*b[2]+w*c[2]
                if z >= depth[y,x]:
                    continue
                depth[y,x]=z
                faces[y,x]=f+1
                u/=pos[ia,3]; v/=pos[ib,3]; w/=pos[ic,3]
                s=u+v+w
                bary[y,x,0]=u/s; bary[y,x,1]=v/s; bary[y,x,2]=w/s
    return faces,bary

def rasterize(pos, tri, resolution, **kwargs):
    if kwargs.get('use_depth_prior',0):
        raise NotImplementedError('Depth-prior rasterization is not used in this workflow')
    f,b=_raster(pos[0].detach().cpu().float().numpy(),tri.detach().cpu().numpy(),resolution[0],resolution[1])
    return torch.from_numpy(f).to(pos.device),torch.from_numpy(b).to(pos.device)

def interpolate(col, findices, barycentric, tri):
    indices=(findices.long()-1).clamp(min=0)
    values=col[0,tri.long()[indices]]
    return (values*barycentric.unsqueeze(-1)).sum(dim=-2).unsqueeze(0)
