"""#199: phase pavement flags from the original kerb, cut corner charts on mitre lines.
python kerb_flags.py <original audit> <slab bevel candidate> <H5 work> <candidate>
Uses the original H5 slab dump through audit --original-dir, never installed paving.
The bevel candidate is made by repair-stone-corners.py --landmarks ... --pavements.
Existing ground_flags material reads the explicit UV; no shader change or kind is needed.
"""
import json, pathlib, pickle, os, sys
import numpy as np
import shapely
from shapely.geometry import Polygon, LineString
os.environ.setdefault('PAVE_WORK', sys.argv[3] if len(sys.argv)>3 else '.')
import layout

def chart_parts(poly, road):
    """Partition at angle bisectors, independent of the source's triangulation.
    The exact source outline clips the partitions; simplified edges are guide lines only.
    A boundary near the street sets the phase; isolated steps use their longest nosing.
    """
    guide=poly.simplify(.004,preserve_topology=True)
    edges=[]; cuts=[]
    reach=max(np.ptp(np.asarray(poly.exterior.coords),axis=0))+2
    for ring in [guide.exterior]+list(guide.interiors):
        p=np.asarray(ring.coords)[:-1]; q=np.roll(p,-1,axis=0); d=q-p
        length=np.linalg.norm(d,axis=1); directions=d/np.maximum(length[:,None],1e-12)
        for i in range(len(p)):
            if length[i]<.06: continue
            mid=(p[i]+q[i])*.5
            edges.append((p[i],q[i],directions[i],length[i],shapely.distance(shapely.Point(mid),road)))
            prev=directions[i-1]; cur=directions[i]
            bisector=np.array([-prev[1]-cur[1],prev[0]+cur[0]])
            mag=np.linalg.norm(bisector)
            if mag<1e-5 or abs(prev[0]*cur[1]-prev[1]*cur[0])<.025: continue
            bisector/=mag
            cuts.append(LineString([p[i]-bisector*reach,p[i]+bisector*reach]).intersection(poly))
    if not edges:return []
    eligible=[e for e in edges if e[4]<.35 and e[3]>.25]
    if not eligible: eligible=[max(edges,key=lambda e:e[3])]
    # Perimeter divisions run from exact corners, so adjacent straight kerbs meet along one diagonal.
    lines=shapely.union_all([poly.boundary]+cuts)
    faces=shapely.get_parts(shapely.polygonize(shapely.get_parts(lines)))
    result=[]
    for face in faces:
        rp=face.representative_point()
        if not poly.covers(rp) or face.area<1e-9:continue
        e=min(eligible,key=lambda e:LineString(e[:2]).distance(rp))
        a,b,d,_,_=e
        # Stable sign, same phase for either winding of a kerb.
        if d[0]<-1e-5 or (abs(d[0])<=1e-5 and d[1]<0): a,b,d=b,a,-d
        result.append((face,a,d))
    return result

def bary_rows(points, tri):
    a=tri[0,[0,2]]; basis=np.stack([tri[1,[0,2]]-a,tri[2,[0,2]]-a],axis=1)
    w=(points-a)@np.linalg.inv(basis).T
    return np.column_stack([1-w.sum(axis=1),w])@tri

def flags(rows, road):
    t=rows.reshape(-1,3,16)
    cr=np.cross(t[:,1,:3]-t[:,0,:3],t[:,2,:3]-t[:,0,:3]); size=np.linalg.norm(cr,axis=1)
    flat=(size>1e-8)&(abs(cr[:,1])/np.maximum(size,1e-12)>.9999)&(t[:,:,1].max(axis=1)<.8)&(t[:,:,1].mean(axis=1)>-.05)
    # Do not turn a stone's underside into paving. Winding is clockwise in Godot.
    flat &= t[:,:,4].mean(axis=1)>.9
    tops=t[flat]; other=t[~flat].reshape(-1,16); output=[]; charts=0; area=0
    heights=np.round(tops[:,:,1].mean(axis=1)/.005).astype(int)
    for h in np.unique(heights):
        source=tops[heights==h]; polygons=shapely.polygons(source[:,:,[0,2]])
        region=shapely.make_valid(shapely.union_all(polygons))
        tree=shapely.STRtree(polygons)
        for poly in shapely.get_parts(region):
            if poly.geom_type!='Polygon' or poly.area<1e-8:continue
            for face,a,d in chart_parts(poly,road):
                charts+=1
                for j in tree.query(face,predicate='intersects'):
                    clipped=polygons[j].intersection(face)
                    for piece in shapely.get_parts(clipped):
                        if piece.geom_type!='Polygon' or piece.area<1e-10:continue
                        for triangle in shapely.get_parts(shapely.constrained_delaunay_triangles(piece)):
                            p=np.asarray(triangle.exterior.coords)[:3]
                            ab,ac=p[1]-p[0],p[2]-p[0]
                            if ab[0]*ac[1]-ab[1]*ac[0]<0:p=p[[0,2,1]]
                            rr=bary_rows(p,source[j])
                            rr[:,6]=(p-a)@d/2.6
                            rr[:,7]=(p-a)@np.array([-d[1],d[0]])/2.6
                            rr[:,3:6]=[0,1,0];rr[:,10:14]=1
                            output.append(rr);area+=triangle.area
    if not output:return other,np.empty((0,16)),{}
    expected=size[flat].sum()/2
    if abs(area-expected)>max(.001,expected*1e-5):raise RuntimeError(f'Pavement area differs: {area} vs {expected}')
    return other,np.concatenate(output),{'topArea':area,'charts':charts,'sourceTopTriangles':len(tops),'triangles':sum(len(r)//3 for r in output)}

def main():
    audit,bevel,work,out=map(pathlib.Path,sys.argv[1:5]);out.mkdir(parents=True,exist_ok=True)
    road=shapely.union_all([pickle.load(open(work/'work'/f'lay-{k}.pkl','rb')).area for k in ['cobble','quay']])
    bevel_manifest=json.load(open(bevel/'manifest.json'))
    bmap={e['mesh']:e for e in bevel_manifest['surfaceRepairs']}
    entries=[];report=[]
    for rec in json.load(open(audit/'audit.json')):
        if rec['mesh'] not in bmap:continue
        e=bmap[rec['mesh']];surfaces=[];next_index=rec['surfaceCount']
        for s in e['surfaces']:
            r=np.fromfile(bevel/s['file'],dtype=np.float32).reshape(-1,16)
            sides,top,stats=flags(r,road)
            if not len(top):continue
            # Keep non-walkable original stone and arrises on their original material.
            if len(sides):
                file=pathlib.Path(s['file']).stem+'-sides.bin';sides.astype(np.float32).tofile(out/file)
                surfaces.append(dict(s,file=file))
                si=next_index;next_index+=1
            else:si=s['index']
            file=pathlib.Path(s['file']).stem+'-flags.bin';top.astype(np.float32).tofile(out/file)
            surfaces.append({'index':si,'file':file,'custom0':False,'material':'res://world/town/resources/r000016.res'})
            report.append({'node':rec['nodePath'],**stats})
            print(report[-1],flush=True)
        if surfaces:entries.append(dict(e,surfaces=surfaces))
    (out/'manifest.json').write_text(json.dumps({'surfaceRepairs':entries},indent=2))
    (out/'geometry-report.json').write_text(json.dumps(report,indent=2))

if __name__=='__main__':main()
