"""Wedge-shaped header bricks fitted to an egg mouth and the host vault, in game metres."""
import numpy as np
import bpy
from . import util as U, gallery as G

def build(path, du, side, invert, material, collection):
    h = np.linspace(0.001, 1.599, 320)
    w = G.egg_hw(h)
    outline = np.concatenate((np.stack((w,h),-1),np.stack((-w[::-1],h[::-1]),-1)))
    outline = np.vstack((outline,outline[0]))
    along = np.r_[0,np.cumsum(np.linalg.norm(np.diff(outline,axis=0),axis=1))]
    def edge(u, r):
        u %= along[-1]
        q = np.array([np.interp(u,along,outline[:,0]),np.interp(u,along,outline[:,1])])
        a = np.array([np.interp((u-.004)%along[-1],along,outline[:,0]),np.interp((u-.004)%along[-1],along,outline[:,1])])
        b = np.array([np.interp((u+.004)%along[-1],along,outline[:,0]),np.interp((u+.004)%along[-1],along,outline[:,1])])
        n = np.array([b[1]-a[1],a[0]-b[0]])
        n /= np.linalg.norm(n)
        if np.dot(n,q-np.array([0,.8]))<0:n=-n
        return q+n*r
    count = int(along[-1]/.065)
    obs=[]
    mortar=bpy.data.materials.get('Mortar_header')
    if mortar is None:
        mortar=bpy.data.materials.new('Mortar_header'); mortar.diffuse_color=(.25,.23,.19,1)
    # A continuous mortar bed joins the headers to the host rather than leaving black radial slots.
    v=[]
    for u in np.linspace(0,along[-1],count*3,endpoint=False):
        for r in (0,.205):
            q=edge(u,r); y=invert+q[1]
            v.append(path.world(np.array(du+q[0]),np.array(side*(G.shell_s_at_y(y)+.025)),np.array(y)))
    faces=[[i*2,i*2+1,((i+1)%(count*3))*2+1,((i+1)%(count*3))*2] for i in range(count*3)]
    obs.append(U.mesh_from_faces('header_mortar',np.array(v),faces,coll_=collection,mat=mortar))
    for i in range(count):
        corners=[]
        for j in range(8):
            u=(i+(1 if j&1 else 0))*along[-1]/count + (-.003 if j&1 else .003)
            q=edge(u,.20 if j&2 else 0)
            y=invert+q[1]
            depth=.08 if j&4 else -.012
            corners.append(path.world(np.array(du+q[0]),np.array(side*(G.shell_s_at_y(y)+depth)),np.array(y)))
        ob=U.block_object('drain_header',np.array(corners),material,collection,r=.004,res=.025,chips=0)
        obs.append(ob)
    return obs
