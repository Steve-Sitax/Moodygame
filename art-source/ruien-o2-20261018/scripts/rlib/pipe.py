"""Closed 26 cm cast outlet, thick socket and recessed bore, shared by all Ruien stretches."""
import numpy as np
import bpy
from . import util as U

def outlet(path, u, side, y, mats, coll):
    def shell(name, profile, mat):
        n = 64
        a = np.arange(n) * (2*np.pi/n)
        v = np.vstack([path.world(u + r*np.cos(a), np.full(n, side*s), y-.02 + r*np.sin(a)) for s,r in profile])
        faces = [[j*n+i,j*n+(i+1)%n,((j+1)%len(profile))*n+(i+1)%n,((j+1)%len(profile))*n+i]
                 for j in range(len(profile)) for i in range(n)]
        return U.mesh_from_faces(name,v,faces,coll_=coll,mat=mat)
    profile=[(3.55,.13),(2.87,.13),(2.865,.162),(2.858,.165),(2.807,.165),
             (2.8,.158),(2.8,.112),(2.806,.108),(3.55,.108)]
    obs=[shell('pipe_closed_cast',profile,mats['iron_wet'])]
    mortar=bpy.data.materials.get('Mortar_header') or bpy.data.materials.new('Mortar_header')
    mortar.diffuse_color=(.25,.23,.19,1)
    obs.append(shell('pipe_mortar_collar',[(3.09,.245),(2.97,.235),(2.95,.22),(2.95,.13),(3.09,.13)],mortar))
    a=np.arange(64)*2*np.pi/64
    v=path.world(u+.107*np.cos(a),np.full(64,side*3.53),y-.02+.107*np.sin(a))
    centre=path.world(np.array(u),np.array(side*3.53),np.array(y-.02))
    obs.append(U.mesh_from_faces('pipe_recessed_back',np.vstack([v,centre]),[[i,(i+1)%64,64] for i in range(64)],coll_=coll,mat=mats['soot_black']))
    return obs
