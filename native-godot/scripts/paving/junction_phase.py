"""#199 side streets: finish a full row on the through street's claim line.
Apply to a mesh freshly made by mesher.build from ORIGINAL ground rows. Edge courses and
through-street UVs are unchanged. The last few rows ease into an oblique junction line.
"""
import numpy as np
import shapely

def phase_at_boundary(points, chain, boundary, pitch):
    """Along-street metres, with one complete joint at every point of this boundary."""
    coords=shapely.get_coordinates(boundary)
    ref=chain.local(coords.mean(axis=0,keepdims=True))[0][0]
    target=round(ref/pitch)*pitch
    pts=shapely.points(points)
    nearest=shapely.get_point(shapely.shortest_line(pts,boundary),1)
    q=shapely.get_coordinates(nearest)
    s=chain.local(points)[0]; at=chain.local(q)[0]
    correction=target-at
    dist=shapely.distance(pts,boundary)
    reach=np.maximum(2.,abs(correction)*4.)
    blend=np.clip(1-dist/reach,0,1);blend=blend*blend*(3-2*blend)
    return s+correction*blend,dist

def apply(lay,T,labels,uv,rows_per_tile):
    fields=np.unique(labels[(labels>=0)&(labels<1_000_000)])
    polygons={int(i):shapely.union_all(shapely.polygons(T[labels==i])) for i in fields}
    keys=list(polygons); shapes=[polygons[i] for i in keys];tree=shapely.STRtree(shapes)
    result=uv.copy();report=[]
    for i in keys:
        shape=polygons[i]
        borders=[]
        for j in tree.query(shape):
            if keys[j]>=i:continue  # The wide/through street owns the junction; only its branch changes.
            shared=shape.boundary.intersection(shapes[j].boundary)
            shared=shapely.line_merge(shared)
            for line in shapely.get_parts(shared):
                if line.geom_type=='LineString' and line.length>.6:borders.append(line)
        if not borders:continue
        take=labels==i;p=T[take].reshape(-1,2);old=result[take].reshape(-1,2)
        distance=np.full(len(p),np.inf);v=old[:,1]*lay.tile
        for border in borders:
            phased,d=phase_at_boundary(p,lay.chains[i],border,lay.tile/rows_per_tile)
            update=d<distance;v[update]=phased[update];distance[update]=d[update]
        old[:,1]=v/lay.tile;result[take]=old.reshape(-1,3,2)
        report.append({'chain':i,'boundarySegments':len(borders),'boundaryMetres':sum(x.length for x in borders)})
    return result,report
