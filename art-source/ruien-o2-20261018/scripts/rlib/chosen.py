"""Approved O2 construction details; dimensions in metres, usable by other collectors."""
import math
import bpy, bmesh
import numpy as np
from . import util as U, gallery as G, hall as H

def solid(name, points, faces, uv, material, collection, radius=.008):
    """Closed masonry with metric charts and a real rounded arris, never detached headers."""
    ob=U.mesh_from_faces(name,np.asarray(points),faces,uv=np.asarray(uv),mat=material,coll_=collection,smooth=False)
    bm=bmesh.new();bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.55]
    bmesh.ops.bevel(bm,geom=edges,offset=radius,segments=3,affect='EDGES',clamp_overlap=True)
    bm.to_mesh(ob.data);bm.free()
    return ob

def arch(name, origin, across, inward, half, spring, rise, width, depth, material, collection):
    """One bonded elliptical arch, front, back, extrados, soffit and both spring ends."""
    count=128;theta=np.linspace(np.pi,0,count+1)
    p=[]
    for t in theta:
        normal=np.array([np.cos(t)/half,np.sin(t)/rise]);normal/=np.linalg.norm(normal)
        for r,d in ((0,0),(width,0),(width,-depth),(0,-depth)):
            q=np.array([half*np.cos(t),spring+rise*np.sin(t)])+normal*r
            p.append(origin+across*q[0]+np.array([0,q[1],0])+inward*d)
    p=np.asarray(p);faces=[];uv=[];along=0
    for i in range(count):
        length=np.linalg.norm(p[4*(i+1)]-p[4*i])
        for j in range(4):
            k=(j+1)%4;faces.append([4*i+j,4*(i+1)+j,4*(i+1)+k,4*i+k])
            span=width if j%2==0 else depth
            uv.extend([(along,0),(along+length,0),(along+length,span),(along,span)])
        along+=length
    for i in (0,count):
        faces.append([4*i+j for j in range(4)]);uv.extend([(0,0),(width,0),(width,depth),(0,depth)])
    return solid(name,p,faces,uv,material,collection,.011)

def main_arch(collection):
    o,t,n=H.mouth_frame('main','z0');_,half,_,_=H.mouth_geom('main')
    return arch('mouth_main_continuous_arch',o+n*.12,t,n,half,H.MOUTH_SPRING,
                H.MOUTH_CROWN-H.MOUTH_SPRING,.30,.72,bpy.data.materials['Brick_rib_side'],collection)

def light_shaft(collection):
    x,z,r=H.AIR
    # A rolled lower edge spreads into the groin; the outer shell closes every return.
    profile=[(.30,-.025),(.30,-.64),(.32,-.79),(.36,-.91),(.43,-1.01),(.52,-1.055),
             (.58,-1.05),(.60,-1.02),(.60,-.94),(.51,-.86),(.48,-.74),(.48,-.025)]
    n=128;points=[]
    for radius,y in profile:
        for i in range(n):
            a=i*2*np.pi/n;points.append([x+radius*np.cos(a),y,z+radius*np.sin(a)])
    faces=[];uv=[];down=0
    for j,(radius,y) in enumerate(profile):
        k=(j+1)%len(profile);r1,y1=profile[k];step=math.hypot(r1-radius,y1-y)
        for i in range(n):
            a=i*2*np.pi/n;b=(i+1)*2*np.pi/n
            faces.append([j*n+i,j*n+(i+1)%n,k*n+(i+1)%n,k*n+i])
            uv.extend([(a*radius,down),(b*radius,down),(b*r1,down+step),(a*r1,down+step)])
        down+=step
    return solid('air_shaft_bonded_flare',points,faces,uv,bpy.data.materials['Brick_hall_vault'],collection,.007)
