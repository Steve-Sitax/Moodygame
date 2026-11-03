"""Blender offline candidate for #171; replaces only identified Carolus capital ornaments.
Usage: blender -b -P this.py -- <audit directory> <candidate directory>
Promote using StoneCornersPromote after reviewing the candidate. Never rebuild the church.
"""
import hashlib
import importlib.util
import json
import math
import pathlib
import sys

import bmesh
import numpy as np
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('arris', HERE / 'repair-landmark-stone.py')
arris = importlib.util.module_from_spec(spec)
spec.loader.exec_module(arris)


def surface(bm, points, closed=False, charts=None):
    """Quads retain their authored chart through triangulation; never choose an axis per face."""
    rings = [[bm.verts.new(p) for p in ring] for ring in points]
    uv = bm.loops.layers.uv.verify()
    chart = bm.faces.layers.int.get('chart') or bm.faces.layers.int.new('chart')
    centres = np.asarray([np.mean(r, axis=0) for r in points])
    distance = np.r_[0., np.cumsum(np.linalg.norm(np.diff(centres, axis=0), axis=1))]
    perimeter = [np.r_[0., np.cumsum(np.linalg.norm(np.diff(np.vstack([r, r[0]]) if closed else r, axis=0), axis=1))] for r in points]
    if charts is None:
        charts = lambda i,j,k: (1, [(.08+distance[a]/3., .195+perimeter[a][b]/3.) for a,b in ((i,j),(i,k),(i+1,k),(i+1,j))])
    for i in range(len(rings)-1):
        for j in range(len(rings[0]) if closed else len(rings[0])-1):
            k = (j+1) % len(rings[0])
            face = bm.faces.new((rings[i][j], rings[i][k], rings[i+1][k], rings[i+1][j]))
            number, coords = charts(i,j,j+1)
            face[chart] = number
            for loop, value in zip(face.loops, coords): loop[uv].uv = value
            if closed and j==len(rings[0])-1:
                for edge in face.edges:
                    if set(edge.verts)=={rings[i][0],rings[i+1][0]}: edge.seam=True
    return rings


def cap(bm, ring, axes, chart_id, reverse=False):
    face = bm.faces.new(list(reversed(ring)) if reverse else ring)
    uv = bm.loops.layers.uv.verify(); chart = bm.faces.layers.int.get('chart')
    centre = np.mean([v.co for v in ring], axis=0)
    face[chart] = chart_id
    for loop in face.loops:
        delta = np.asarray(loop.vert.co)-centre
        loop[uv].uv = (.18+np.dot(delta,axes[0])/3., .25+np.dot(delta,axes[1])/3.)


def tube(bm, path, radius):
    path = np.asarray(path)
    rings = []
    for i, p in enumerate(path):
        tangent = path[min(i+1,len(path)-1)]-path[max(0,i-1)]
        tangent /= np.linalg.norm(tangent)
        u = np.cross(tangent, [0,0,1])
        if np.linalg.norm(u)<.1: u = np.cross(tangent,[0,1,0])
        u /= np.linalg.norm(u)
        v = np.cross(tangent,u)
        end=min(1.,i/4.,(len(path)-1-i)/4.)
        rounded_radius=max(.0001,radius*math.sin(end*math.pi/2))
        rings.append([p+rounded_radius*(u*math.cos(a)+v*math.sin(a)) for a in np.linspace(0,2*math.pi,12,endpoint=False)])
    r = surface(bm,rings,True)
    # Cap charts lie on the tiny rounded end faces, not on a visible tube segment.
    for end, reverse in ((0,True),(-1,False)):
        direction=path[1]-path[0] if end==0 else path[-1]-path[-2]
        direction/=np.linalg.norm(direction); u=np.cross(direction,[0,0,1]);u/=np.linalg.norm(u)
        cap(bm,r[end],(u,np.cross(direction,u)),20+int(reverse),reverse)


LEAF_TEMPLATE = None


def leaf_template():
    """A pinnately lobed blade, not a width-modulated strap or a swept tube."""
    global LEAF_TEMPLATE
    if LEAF_TEMPLATE is not None: return LEAF_TEMPLATE
    # Three pairs of upward branching lobes, each split into tapered leaflets.
    # The deep returns are actual silhouette cut-ins, not a shallow sine scallop.
    right=np.array([(.022,0),(.036,.030),
        (.075,.048),(.130,.085),(.150,.126),(.127,.117),(.135,.153),(.102,.135),(.068,.098),(.045,.089),
        (.072,.158),(.138,.197),(.158,.235),(.131,.225),(.140,.265),(.106,.247),(.072,.211),(.048,.193),
        (.073,.271),(.125,.304),(.142,.341),(.118,.329),(.124,.366),(.091,.346),(.047,.309),
        (.055,.368),(.033,.405),(0,.455)])
    # Eight leaves share each bell. Keep the complete solid within its angular
    # sector so the broad leaflets do not cut through the neighbouring leaf.
    right[:,0]*=.80
    outline=np.vstack([right, right[-2::-1]*[-1,1]])
    rounded=[]
    for i,p in enumerate(outline):
        prev=outline[i-1]-p; nxt=outline[(i+1)%len(outline)]-p
        d=min(.005,np.linalg.norm(prev)*.22,np.linalg.norm(nxt)*.22)
        a=p+prev/np.linalg.norm(prev)*d; b=p+nxt/np.linalg.norm(nxt)*d
        rounded.extend([(1-t)**2*a+2*t*(1-t)*p+t*t*b for t in (0.,.5,1.)])
    outline=[]
    for i,p in enumerate(rounded):
        nxt=rounded[(i+1)%len(rounded)]
        outline.extend([p+(nxt-p)*t for t in np.linspace(0,1,max(2,math.ceil(np.linalg.norm(nxt-p)/.020)+1))[:-1]])
    outline=np.asarray(outline)
    def inside(p):
        x,y=p; a=outline; b=np.roll(outline,-1,axis=0)
        return np.count_nonzero(((a[:,1]>y)!=(b[:,1]>y)) & (x<(b[:,0]-a[:,0])*(y-a[:,1])/(b[:,1]-a[:,1]+1e-30)+a[:,0]))%2==1
    def distances(points,line):
        a=line[:-1]; d=np.diff(line,axis=0)
        delta=points[:,None,:]-a[None,:,:]
        t=np.clip((delta*d[None,:,:]).sum(2)/(d*d).sum(1)[None,:],0,1)
        return np.linalg.norm(delta-t[:,:,None]*d[None,:,:],axis=2).min(1)
    samples=list(outline)
    for x in np.arange(-.16,.161,.014):
        for y in np.arange(.005,.455,.014):
            if inside((x,y)): samples.append((x,y))
    # Two inset rows resolve the rounded exposed perimeter without subdividing
    # the entire blade into tiny triangles.
    for i,p in enumerate(outline):
        incoming=p-outline[i-1]; outgoing=outline[(i+1)%len(outline)]-p
        turn=np.dot(incoming,outgoing)/(np.linalg.norm(incoming)*np.linalg.norm(outgoing))
        if i%2 and turn>.96: continue
        t=outline[(i+1)%len(outline)]-outline[i-1]; n=np.array([-t[1],t[0]])/np.linalg.norm(t)
        for offset in (.004,.010):
            q=p+n*offset
            if inside(q): samples.append(q)
            elif inside(p-n*offset): samples.append(p-n*offset)
    veins=[]
    for y,endx,endy in ((.035,.132,.139),(.140,.141,.249),(.238,.125,.350)):
        for sign in (-1,1):
            a=np.array([sign*.018*.80,y]); b=np.array([sign*.063*.80,y+.025]); c=np.array([sign*endx*.80,endy])
            curve=np.array([(1-t)**2*a+2*t*(1-t)*b+t*t*c for t in np.linspace(0,1,15)])
            veins.append(curve)
            for i,p in enumerate(curve):
                t=curve[min(i+1,len(curve)-1)]-curve[max(i-1,0)]; n=np.array([-t[1],t[0]])/np.linalg.norm(t)
                for offset in (-.007,0.,.007):
                    q=p+n*offset
                    if inside(q): samples.append(q)
    for y in np.arange(.010,.445,.016):
        for x in (-.025,-.012,0.,.012,.025):
            if inside((x,y)): samples.append((x,y))
    for attempt in range(3):
        points,_,faces,_,_,_=delaunay_2d_cdt([Vector(p) for p in samples],[],[list(range(len(outline)))],1,1e-7,False)
        points=np.asarray(points); faces=np.asarray(faces,dtype=np.int32)
        distance=distances(points,np.vstack([outline,outline[0]])); boundary=distance<2e-7
        paper=[points[face].mean(0) for face in faces if boundary[face].all()]
        if not paper: break
        samples.extend(paper)
    assert not paper, 'A lobe tip must have interior thickness, not coincident front/back faces'
    edge=np.sqrt(np.maximum(0.,1-((.009-np.minimum(distance,.009))/.009)**2))
    x=points[:,0]; y=points[:,1]
    midrib=.026*np.exp(-(x/.015)**2)*np.sin(np.pi*np.clip(y/.455,0,1))**.65
    groove=np.zeros(len(points))
    for curve in veins:
        groove=np.maximum(groove,.015*np.exp(-(distances(points,curve)/.0055)**2))
    # A 32 mm carved blade with a 5 mm-scale rolled perimeter, raised midrib,
    # and six real incised branching channels. Grooves stop at the midrib.
    groove*=1-np.exp(-(x/.022)**4)
    front=edge*(.016+midrib-groove)
    back=-edge*.016
    assert front.min()>-1e-9 and np.max(groove)>.014
    assert (front-back)[distance>.002].min()>.010, 'Interior leaflet stone must not become a thin sheet'
    LEAF_TEMPLATE=(points,faces,boundary,front,back)
    return LEAF_TEMPLATE


def leaf(bm, center, direction):
    points,faces,boundary,front,back=leaf_template()
    radial=np.array([direction[0],0,direction[1]]); tangent=np.array([-direction[1],0,direction[0]])
    origin=np.array([center[0],26.505,center[1]])
    x=points[:,0]; y=points[:,1]; tip=np.clip((y-.350)/.105,0,1)
    # Only the terminal spear turns outward. Side lobes follow the bell instead
    # of all ending in the same heavy swan-neck curl.
    radius=.300+.050*(y/.455)**1.3+.070*tip*tip
    height=y-.020*tip*tip
    assert np.max(np.abs(x)/(radius+back))<math.tan(math.pi/8)-.005, 'Leaf solid exceeds its neighbour clearance'
    base=origin[None,:]+tangent[None,:]*x[:,None]+radial[None,:]*radius[:,None]
    base[:,1]+=height
    vertices=[]
    for offset in (front,back):
        layer=[]
        for i,p in enumerate(base):
            layer.append(vertices[0][i] if vertices and boundary[i] else bm.verts.new(p+radial*offset[i]))
        vertices.append(layer)
    uv=bm.loops.layers.uv.verify(); chart=bm.faces.layers.int.get('chart') or bm.faces.layers.int.new('chart')
    for side in (0,1):
        for tri in faces:
            order=tri if side==0 else tri[::-1]
            face=bm.faces.new([vertices[side][i] for i in order]); face[chart]=10+side
            for loop,i in zip(face.loops,order): loop[uv].uv=(.08+y[i]/3.,.25+x[i]/3.)


def volute(bm, lo, hi, mirror):
    x=(lo[0]+hi[0])/2; y=(lo[1]+hi[1])/2; z=hi[2]
    radius=min(hi[0]-lo[0],hi[1]-lo[1])/2
    # A broad flat mating back seats 2 mm into the bolster; its perimeter has a 6 mm arris.
    # The front is rounded, but the rear must not balance on a tiny central contact patch.
    profile=[(.0005,z+.002),(radius-.006,z+.002),(radius,z-.004)]
    profile += [(max(.0005,radius*math.cos(a)),z-.034-.035*math.sin(a)) for a in np.linspace(0,math.pi/2,17)]
    rings=[[[x+rr*math.cos(t),y+rr*math.sin(t),depth] for t in np.linspace(0,2*math.pi,48,endpoint=False)] for rr,depth in profile]
    def backing_uv(i,j,k):
        if i==2:
            return 31,[(.08+radius*(b/48.*2*math.pi)/3.,.22+(rings[a][b%48][2]-z)/3.) for a,b in ((i,j),(i,k),(i+1,k),(i+1,j))]
        return (30 if i<2 else 32),[(.18+(rings[a][b%48][0]-x)/3.,.25+(rings[a][b%48][1]-y)/3.) for a,b in ((i,j),(i,k),(i+1,k),(i+1,j))]
    r=surface(bm,rings,True,backing_uv)
    cap(bm,r[0],([1,0,0],[0,1,0]),33,True);cap(bm,r[-1],([1,0,0],[0,1,0]),34)
    path=[]
    for t in np.linspace(0,1,120):
        a=math.pi/2+mirror*t*3.6*math.pi; rr=radius*(.88-.77*t)
        # Follow the lenticular backing so every turn is seated in stone.
        depth=z-.034-.035*math.sqrt(1-(rr/radius)**2)-.004
        path.append([x+rr*math.cos(a),y+rr*math.sin(a),depth])
    tube(bm,path,.009)


def rows_from_mesh(bm, original):
    assert all(e.is_manifold for e in bm.edges), 'Open carved solid'
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bm.normal_update()
    volume=bm.calc_volume(signed=True)
    assert volume>1e-7, 'Carved component must enclose positive stone volume'
    tint=np.median(original.reshape(-1,16),axis=0)
    result=[]
    uv=bm.loops.layers.uv.active
    chart=bm.faces.layers.int.get('chart'); continuous=0; seams=0
    for edge in bm.edges:
        a,b=edge.link_faces
        if edge.seam or a[chart]!=b[chart]: seams+=1;continue
        for vertex in edge.verts:
            ua=next(loop[uv].uv for loop in a.loops if loop.vert==vertex)
            ub=next(loop[uv].uv for loop in b.loops if loop.vert==vertex)
            assert (ua-ub).length<1e-7, 'Unexpected internal chart discontinuity'
        continuous+=1
    for f in bm.faces:
        if f.calc_area()<1e-10: continue
        for loop in reversed(f.loops):
            v=loop.vert
            row=tint.copy(); row[:3]=v.co; row[3:6]=v.normal if v.normal.dot(f.normal)>.1 else f.normal
            row[6:8]=loop[uv].uv
            result.append(row)
    bm.free()
    rows=np.asarray(result,dtype=np.float32).reshape(-1,3,16)
    area=np.linalg.norm(np.cross(rows[:,1,:3]-rows[:,0,:3],rows[:,2,:3]-rows[:,0,:3]),axis=1)
    rows=rows[area>1e-10]
    delta1=rows[:,1,6:8]-rows[:,0,6:8];delta2=rows[:,2,6:8]-rows[:,0,6:8]
    uv_area=np.abs(delta1[:,0]*delta2[:,1]-delta1[:,1]*delta2[:,0])
    assert (uv_area>1e-14).all(), 'Collapsed UV chart'
    assert (rows[:,:,6]>=.02).all() and (rows[:,:,6]<=.47).all(), 'Chart leaves the joint-free block horizontally'
    assert (rows[:,:,7]>=.18).all() and (rows[:,:,7]<=.325).all(), 'Chart crosses a source mortar course'
    return rows.reshape(-1,16),{'continuousEdges':continuous,'intentionalSeamEdges':seams,'solidVolume':volume,'minimumUvDoubleArea':float(uv_area.min()),'uvBounds':[rows[:,:,6:8].min((0,1)).tolist(),rows[:,:,6:8].max((0,1)).tolist()]}


def main():
    audit,out=map(pathlib.Path,sys.argv[sys.argv.index('--')+1:])
    out.mkdir(parents=True,exist_ok=True)
    rec=next(r for r in json.loads((audit/'audit.json').read_text()) if r['mesh'].endswith('/r001009.res'))
    installed=HERE.parent/'world/town/resources/r001009.res'
    assert hashlib.sha256(installed.read_bytes()).hexdigest()==rec['meshHash'], 'Audit is stale'
    s=rec['surfaces'][0]
    rows=np.fromfile(audit/'source'/s['file'],dtype=np.float32).reshape(-1,3,16)
    kept=[]; added=[]; report=[]; counts={'leaf':0,'volute':0}
    for idx in arris.components(rows):
        part=rows[idx]; p=part[:,:,:3].reshape(-1,3); lo=p.min(0);hi=p.max(0)
        # Exact component signatures from the current native audit, including the prior arris pass.
        kind=None
        if len(idx)==188 and 26.50<lo[1]<26.52 and 26.96<hi[1]<26.99 and 168.2<lo[2]<169.2: kind='leaf'
        if len(idx)==254 and 18.94<lo[1]<18.96 and 19.16<hi[1]<19.18 and 168.14<lo[2]<168.17: kind='volute'
        if kind is None: kept.append(part.reshape(-1,16));continue
        bm=bmesh.new()
        if kind=='leaf':
            cx=min([-116+s for s in (-5.9,-2.3,2.3,5.9)],key=lambda x:abs(x-p[:,0].mean()))
            center=np.array([cx,168.70]); d=p[:,[0,2]].mean(0)-center;d/=np.linalg.norm(d)
            leaf(bm,center,d)
        else:
            column=min([-116+s for s in (-12.05,-6,-2.9,2.9,6,12.05)],key=lambda x:abs(x-p[:,0].mean()))
            volute(bm,lo,hi,1 if p[:,0].mean()>column else -1)
        rr,checks=rows_from_mesh(bm,part);added.append(rr);counts[kind]+=1
        report.append({'kind':kind,'oldTriangles':len(idx),'newTriangles':len(rr)//3,'oldBounds':[lo.tolist(),hi.tolist()],**checks})
    assert counts=={'leaf':32,'volute':12},counts
    result=np.concatenate(kept+added)
    assert np.isfinite(result).all()
    t=np.concatenate(added).reshape(-1,3,16); cross=np.cross(t[:,1,:3]-t[:,0,:3],t[:,2,:3]-t[:,0,:3])
    assert (np.linalg.norm(cross,axis=1)>1e-10).all()
    assert ((cross*t[:,:,3:6].mean(1)).sum(1)<1e-7).all(),'winding'
    result.tofile(out/s['file'])
    manifest={'surfaceRepairs':[{'mesh':rec['mesh'],'nodePath':rec['nodePath'],'sourceHash':rec['meshHash'],'surfaces':[{'index':0,'file':s['file'],'material':s['material'],'custom0':s['custom0']}]}]}
    manifest[rec['mesh']]={'surfaces':[{'file':s['file'],'material':s['material'],'custom0':s['custom0'],'vertices':len(result)}]}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
    (out/'geometry-report.json').write_text(json.dumps({'counts':counts,'preservedTriangles':sum(len(r)//3 for r in kept),'parts':report},indent=2))
    print(counts,'preserved triangles',sum(len(r)//3 for r in kept),'new triangles',len(t),flush=True)


if __name__=='__main__': main()
