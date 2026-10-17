"""Square off kerbs before foundations, retaining their UVs and capping cut ends."""
import bmesh, numpy as np
from mathutils import Vector
from mathutils.geometry import convex_hull_2d

def terminate_kerbs(rows,cuts,mesh_from,rows_from,clip,triangulate):
    bm=mesh_from(rows);remaining=set(bm.faces);result=[];ends=0
    while remaining:
        seed=remaining.pop();group={seed};stack=[seed]
        while stack:
            for edge in stack.pop().edges:
                for face in edge.link_faces:
                    if face in remaining:remaining.remove(face);group.add(face);stack.append(face)
        uv=bm.loops.layers.uv.get('UV');uv2=bm.loops.layers.uv.get('UV2');col=bm.loops.layers.float_color.get('Col')
        rr=[[*l.vert.co,*f.normal,*l[uv].uv,*l[uv2].uv,*l[col],0,0] for f in group for l in reversed(list(f.loops))]
        pts=np.array([v.co[:] for v in {v for f in group for v in f.verts}]);center=Vector(pts.mean(0));q=pts[:,[0,2]]-pts[:,[0,2]].mean(0)
        _,_,axes=np.linalg.svd(q,full_matrices=False);along=Vector((axes[0,0],0,axes[0,1]))
        intervals=[]
        for origin,t,n,amin,amax,omin,omax in cuts:
            removed=[]
            for i in range(0,len(rr),3):
                poly=[r+[(Vector(r[:3])-origin).dot(t),(Vector(r[:3])-origin).dot(n)] for r in rr[i:i+3]]
                for axis,bound,above in [(16,amin,True),(16,amax,False),(17,omin,True),(17,omax,False)]:poly=clip(poly,axis,bound,above) if poly else []
                removed.extend((Vector(r[:3])-center).dot(along) for r in poly)
            if removed:intervals.append((min(removed)-.002,max(removed)+.002))
        if not intervals:result+=rr;continue
        cutplanes=[]
        for lo,hi in intervals:
            kept=[]
            for i in range(0,len(rr),3):
                poly=[r+[(Vector(r[:3])-center).dot(along)] for r in rr[i:i+3]]
                kept += [r[:16] for r in triangulate(clip(poly,16,lo,False))+triangulate(clip(poly,16,hi,True))]
            rr=kept;cutplanes.extend([(lo,along),(hi,-along)])
        if not rr:continue
        part=mesh_from(rr)
        for distance,normal in cutplanes:
            edges=[e for e in part.edges if e.is_boundary and all(abs((v.co-center).dot(along)-distance)<.0008 for v in e.verts)]
            faces=bmesh.ops.holes_fill(part,edges=edges,sides=0)['faces'] if edges else []
            points=[v for v in part.verts if abs((v.co-center).dot(along)-distance)<.0008]
            if not faces and len(points)>=2 and not any(all(v in points for v in f.verts) for f in part.faces):
                # Some original kerbs omit their buried underside, leaving an open profile rather than a loop.
                across=Vector((normal.z,0,-normal.x));bottom=min(-.012,min(v.co.y for v in points))
                for v in [min(points,key=lambda v:v.co.dot(across)),max(points,key=lambda v:v.co.dot(across))]:
                    p=v.co.copy();p.y=bottom;points.append(part.verts.new(p))
                hull=convex_hull_2d([Vector((v.co.dot(across),v.co.y)) for v in points])
                if len(hull)>=3:faces=[part.faces.new([points[i] for i in hull])]
            ends+=len(faces)
            for face in faces:
                face.normal_update()
                if face.normal.dot(normal)<0:face.normal_flip()
                for loop in face.loops:
                    p=loop.vert.co;loop[part.loops.layers.uv.get('UV')].uv=(p.dot(Vector((normal.z,0,-normal.x)))/1.2,-p.y/1.2)
                    loop[part.loops.layers.float_color.get('Col')]=(1,1,1,1)
            bevels={e for face in faces for e in face.edges if e.is_manifold}
            if bevels:bmesh.ops.bevel(part,geom=list(bevels),offset=.0015,segments=2,affect='EDGES',clamp_overlap=True)
        result+=rows_from(part);part.free()
    bm.free();return result,ends
