"""Native scenery mesh repair; Blender is used for bevels, never bitmap generation.
World-space interchange includes normals, both UV sets and vertex colour.
"""
import bmesh, json, math, pathlib, sys
from mathutils import Vector

folder=pathlib.Path(sys.argv[sys.argv.index('--')+1])
report={}
foot=Vector((212.9183,0,30.7344)); tangent=Vector((.16092,0,.98697)); inward=Vector((.98697,0,-.16092))
def write(name,data):
    if isinstance(data,list) and data and isinstance(data[0],list) and len(data[0])>=14 and isinstance(data[0][0],(int,float)):
        clean=[];dropped=0;flipped=0
        for i in range(0,len(data),3):
            tri=[r.copy() for r in data[i:i+3]];n=(Vector(tri[2][:3])-Vector(tri[0][:3])).cross(Vector(tri[1][:3])-Vector(tri[0][:3]))
            if n.length<1e-9:dropped+=1;continue
            n.normalize();avg=sum((Vector(r[3:6]) for r in tri),Vector())
            if n.dot(avg)<0:tri[1],tri[2]=tri[2],tri[1];n=-n;flipped+=1
            for r in tri:
                rn=Vector(r[3:6]);rn=rn.normalized() if rn.length>.1 else n
                # Source curb normals sometimes face away from their own triangle.
                # These stone faces are flat; preserve their true geometric normal.
                r[3:6]=list(n if name=='r000046-repaired.json' else rn)
            clean+=tri
        data=clean
        report.setdefault('triangleCleanup',{})[name]={'degenerateRemoved':dropped,'windingCorrected':flipped}
    (folder/name).write_text(json.dumps(data,separators=(',',':')))
def mesh_from(rows):
    bm=bmesh.new(); uv=bm.loops.layers.uv.new('UV'); uv2=bm.loops.layers.uv.new('UV2'); col=bm.loops.layers.float_color.new('Col'); pts={}
    for i in range(0,len(rows),3):
        rr=rows[i:i+3][::-1]; vs=[]
        for r in rr:
            key=tuple(round(p,4) for p in r[:3])
            if key not in pts: pts[key]=bm.verts.new(r[:3])
            vs.append(pts[key])
        if len(set(vs))<3: continue
        try: f=bm.faces.new(vs)
        except ValueError: continue
        for l,r in zip(f.loops,rr): l[uv].uv=r[6:8]; l[uv2].uv=r[8:10]; l[col]=r[10:14]
    bm.normal_update(); return bm
def rows_from(bm):
    bm.normal_update(); bmesh.ops.triangulate(bm,faces=list(bm.faces)); bm.normal_update()
    uv=bm.loops.layers.uv.get('UV'); uv2=bm.loops.layers.uv.get('UV2'); col=bm.loops.layers.float_color.get('Col')
    return [[*l.vert.co,*f.normal,*(l[uv].uv if uv else (l.vert.co.x/1.2,l.vert.co.z/1.2)),*(l[uv2].uv if uv2 else (0,0)),*(l[col] if col and l[col][3]>.01 else (1,1,1,1))] for f in bm.faces for l in reversed(list(f.loops))]
for resource,radius in [('r000880',.012),('r000884',.0025),('r000878',.008),('r000877',.006)]:
    rows=json.loads((folder/(resource+'-0.json')).read_text())
    if resource=='r000877':
        quoin=json.loads((folder/'r000878-0.json').read_text()); snapped=0
        targets=[Vector(r[:3]) for r in quoin if 222<r[0]<228 and 46<r[2]<52]
        for r in rows:
            if not (222<r[0]<228 and 46<r[2]<52):continue
            p=Vector(r[:3]);q=min(targets,key=lambda v:(v-p).length_squared)
            if (q-p).length<.002:r[:3]=list(q);snapped+=1
        report['guardhouseSeams']={'snappedVertices':snapped,'maximumMetres':.002}
    bm=mesh_from(rows)
    if resource=='r000880':
        remove=[]
        for f in bm.faces:
            p=f.calc_center_median(); q=p-foot; a=q.dot(tangent); o=q.dot(inward)
            newel=all(-.003<(v.co-foot).dot(tangent)<.454 and -2.304<(v.co-foot).dot(inward)<-1.796 and -.102<v.co.y<.952 for v in f.verts)
            if newel or (.4501<a<11.701 and -2.305<o<-1.795 and .3+a*6.5/11.7-.162<p.y<.3+a*6.5/11.7+.005): remove.append(f)
        bmesh.ops.delete(bm,geom=remove,context='FACES')
    bmesh.ops.dissolve_degenerate(bm,dist=.0002,edges=list(bm.edges))
    bmesh.ops.dissolve_limit(bm,angle_limit=.003,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False)
    bm.normal_update()
    edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>math.radians(24)]
    count=len(edges)
    bmesh.ops.bevel(bm,geom=edges,offset=radius,segments=4,affect='EDGES',clamp_overlap=False)
    # Small chips on stone arrises, not uniform noise across flat faces.
    if resource=='r000880':
        bm.normal_update()
        for v in bm.verts:
            p=v.co
            if len(v.link_faces)>3:
                k=max(0,math.sin(p.x*83.1+p.y*71.7+p.z*119.3)-.5)*.002
                v.co-=v.normal*k
    out=rows_from(bm); write(resource+'-repaired.json',out)
    report[resource]={'bevelMetres':radius,'segments':4,'bevelEdges':count,'inputTriangles':len(rows)//3,'outputTriangles':len(out)//3}
    bm.free()

def clip(poly,axis,bound,keep_above):
    out=[]
    for a,b in zip(poly,poly[1:]+poly[:1]):
        da=a[axis]-bound; db=b[axis]-bound
        ina=da>=-1e-8 if keep_above else da<=1e-8
        inb=db>=-1e-8 if keep_above else db<=1e-8
        if ina: out.append(a)
        if ina!=inb:
            t=da/(da-db); out.append([x+(y-x)*t for x,y in zip(a,b)])
    return out
def triangulate(poly): return [r for i in range(1,len(poly)-1) for r in [poly[0],poly[i],poly[i+1]]]

# Individual relieved ashlar faces follow the existing 600 mm staggered courses.
# Recessed original triangles close the mortar bed; bevelled stone faces sit 4 mm proud.
source=json.loads((folder/'r000879-0.json').read_text()); base=[]; groups={}; selected=0; mortar=[]
for i in range(0,len(source),3):
    tri=source[i:i+3]; c=[sum(r[k] for r in tri)/3 for k in range(3)]
    if not (208<c[0]<220 and 29<c[2]<46 and abs(tri[0][4])<.12): base+=tri; continue
    selected+=1; normal=Vector(tri[0][3:6]); plane=normal.dot(Vector(tri[0][:3]))
    across=Vector((normal.z,0,-normal.x)).normalized()
    for r in tri:r[6:8]=[Vector(r[:3]).dot(across)/2.4,-r[1]/2.4]
    for r in tri:
        r=r.copy(); r[:3]=list(Vector(r[:3])-normal*.012); r[10:13]=[v*.57 for v in r[10:13]]; mortar.append(r)
    for row in range(math.floor(min(r[7] for r in tri)*4),math.floor(max(r[7] for r in tri)*4)+1):
        shift=.5*(row%2)
        lo=clip(clip(tri,7,(row+.009)/4,True),7,(row+1-.009)/4,False)
        if not lo: continue
        for col in range(math.floor(min(r[6]*4+shift for r in lo)),math.floor(max(r[6]*4+shift for r in lo))+1):
            poly=clip(clip(lo,6,(col-shift+.009)/4,True),6,(col+1-shift-.009)/4,False)
            if len(poly)<3: continue
            key=(*[round(n,2) for n in normal],round(plane,1),row,col)
            groups.setdefault(key,[]).extend(triangulate(poly))
stone=[]; block_count=0
for key,rows in groups.items():
    bm=mesh_from(rows)
    bmesh.ops.dissolve_limit(bm,angle_limit=.02,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False)
    bm.normal_update(); normal=Vector(key[:3]).normalized()
    # Make closed shallow blocks; the hidden back is inside the mortar bed.
    front=list(bm.faces); offset=.004+.002*math.sin(key[-1]*19.2+key[-2]*7.3)
    for v in bm.verts: v.co+=normal*offset
    result=bmesh.ops.extrude_face_region(bm,geom=front,use_keep_orig=True)
    for v in result['geom']:
        if isinstance(v,bmesh.types.BMVert): v.co-=normal*.035
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.normal_update()
    edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.3]
    bmesh.ops.bevel(bm,geom=edges,offset=.006,segments=3,affect='EDGES',clamp_overlap=False)
    rr=rows_from(bm)
    # Continuous stone, not a second painted mortar grid. Preserve physical metric orientation.
    for r in rr:
        p=Vector(r[:3]); across=Vector((normal.z,0,-normal.x)); r[6:8]=[p.dot(across)/1.2,-p.y/1.2]
    stone+=rr; block_count+=1; bm.free()
write('r000879-repaired.json',base); write('ashlar-additions.json',stone+mortar)
report['ashlar']={'blocks':block_count,'replacedTriangles':selected,'jointWidthMetres':.0108,'frontBevelMetres':.006}

# Authored quoin strips encoded both brick and alternating long/short stone in a
# 146 px texture. Reconstruct the 0.80/0.45 m stones, six brick courses (0.39 m) high.
source=json.loads((folder/'r000878-0.json').read_text()); base=[]; groups={}
for i in range(0,len(source),3):
    tri=source[i:i+3]; normal=Vector(tri[0][3:6]); plane=normal.dot(Vector(tri[0][:3])); across=Vector((normal.z,0,-normal.x)).normalized()
    for r in tri:
        q=r.copy(); q[6:8]=[Vector(q[:3]).dot(across)/1.84,-q[1]/1.56];base.append(q)
    if abs(normal.y)>.15:continue
    for row in range(math.floor(min(r[7] for r in tri)*4),math.floor(max(r[7] for r in tri)*4)+1):
        poly=clip(clip(tri,7,(row+.012)/4,True),7,(row+1-.012)/4,False)
        width=(.8 if row%2==0 else .45)/1.2
        poly=clip(clip(poly,6,-.001,True),6,width,False) if poly else []
        if len(poly)<3:continue
        key=(*[round(n,2) for n in normal],round(plane,1),row)
        groups.setdefault(key,[]).extend(triangulate(poly))
stones=[]
for key,rows in groups.items():
    bm=mesh_from(rows);bmesh.ops.dissolve_limit(bm,angle_limit=.01,verts=list(bm.verts),edges=list(bm.edges));normal=Vector(key[:3]).normalized()
    for v in bm.verts:v.co+=normal*.018
    result=bmesh.ops.extrude_face_region(bm,geom=list(bm.faces),use_keep_orig=True)
    for v in result['geom']:
        if isinstance(v,bmesh.types.BMVert):v.co-=normal*.045
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
    bmesh.ops.bevel(bm,geom=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.3],offset=.007,segments=3,affect='EDGES',clamp_overlap=False)
    stones+=rows_from(bm);bm.free()
write('r000878-repaired.json',base);write('quoin-additions.json',stones);report['quoins']={'blocks':len(groups),'projectionMetres':.018,'bevelMetres':.007}

# Roof eave drop used an uncapped pitch while its ridge rise was capped. Correct the
# affected east plane so the facade/cornice cannot poke through the roof near the eave.
rows=json.loads((folder/'r000264-0.json').read_text()); roof_changed=0
for i in range(0,len(rows),3):
    tri=rows[i:i+3]; c=[sum(r[k] for r in tri)/3 for k in range(3)]
    if 189<c[0]<201 and 4<c[2]<44 and c[1]>10.1 and tri[0][4]>.5:
        for r in tri:
            r[1]+=.016*max(0,(r[0]-188.998657)/(200.400085-188.998657)); roof_changed+=1
        n=(Vector(tri[2][:3])-Vector(tri[0][:3])).cross(Vector(tri[1][:3])-Vector(tri[0][:3])).normalized()
        for r in tri:r[3:6]=list(n)
write('r000264-repaired.json',rows);report['roofEave']={'vertices':roof_changed,'liftAtEdgeMetres':.016}
# Open the old solid pavement kerb under the downpipe shoe.
rows=json.loads((folder/'r000265-0.json').read_text()); repaired=[]
for i in range(0,len(rows),3):
    tri=rows[i:i+3]
    if max(r[1] for r in tri)>.16: repaired+=tri;continue
    inside=tri; outside=[]
    for axis,value,greater in [(0,199.995,True),(0,200.735,False),(2,43.60,True),(2,43.88,False)]:
        outside+=triangulate(clip(inside,axis,value,not greater)) if inside else []
        inside=clip(inside,axis,value,greater) if inside else []
    repaired+=outside
write('r000265-repaired.json',repaired)
rows=json.loads((folder/'r000888-0.json').read_text())
write('r000888-repaired.json',rows)
rows=json.loads((folder/'r000881-0.json').read_text()); repaired=[]
for i in range(0,len(rows),3):
    inside=rows[i:i+3];outside=[]
    for axis,value,greater in [(0,222.14,True),(0,222.48,False),(2,47.146,True),(2,47.486,False)]:
        outside+=triangulate(clip(inside,axis,value,not greater)) if inside else []
        inside=clip(inside,axis,value,greater) if inside else []
    repaired+=outside
write('r000881-repaired.json',repaired)

# Clear the obsolete ground border from the staircase and its fitted paving apron.
# Clip in the stair's local frame, retaining all triangles outside the repair rectangle.
foot=Vector((212.9183,0,30.7344)); tangent=Vector((.16092,0,.98697)); inward=Vector((.98697,0,-.16092))
def F(a,o,y): return foot+tangent*a+inward*o+Vector((0,y,0))
for resource in ['r000046','r000017','r000008','r000025','r000031']:
    source=json.loads((folder/(resource+'-0.json')).read_text()); border=[]; cut=0
    for i in range(0,len(source),3):
        tri=[r+[(Vector(r[:3])-foot).dot(tangent),(Vector(r[:3])-foot).dot(inward)] for r in source[i:i+3]]
        inside=tri; outside=[]
        for axis,value,greater in [(14,-.7,True),(14,14,False),(15,-3.63,True),(15,.1,False)]:
            outside+=triangulate(clip(inside,axis,value,not greater)) if inside else []
            inside=clip(inside,axis,value,greater) if inside else []
        if inside: cut+=1
        border += [r[:14] for r in outside]
    write(resource+'-repaired.json',border); report[resource]={'clippedTriangles':cut}

# Construction additions share the existing game materials and native resource IDs.
add_stone=bmesh.new(); add_iron=bmesh.new()
def box(bm,center,axes,size,radius):
    b=bmesh.new(); result=bmesh.ops.create_cube(b,size=1)
    for v in b.verts:
        q=v.co.copy(); v.co=Vector(center)+sum((Vector(axes[j])*q[j]*size[j] for j in range(3)),Vector())
    bmesh.ops.recalc_face_normals(b,faces=list(b.faces))
    bmesh.ops.bevel(b,geom=list(b.edges),offset=radius,segments=3,affect='EDGES',clamp_overlap=True)
    if bm==add_stone:
        b.normal_update()
        for v in b.verts:
            p=v.co
            chip=max(0,math.sin(p.x*95.1+p.y*77.3+p.z*66.7)-.4)*.003
            v.co-=v.normal*chip
    append(bm,b); b.free()
def append(target,source):
    m={v:target.verts.new(v.co) for v in source.verts}
    for f in source.faces:
        try: target.faces.new([m[v] for v in f.verts])
        except ValueError: pass

# Replace the low-resolution shop sash at this drain frontage with physical joinery.
# Preserve the opening, glass plane, facade IDs and material selection exactly.
facade=json.loads((folder/'r000263-0.json').read_text()); windows={}
for i in range(0,len(facade),3):
    tri=facade[i:i+3]
    if all(199.87<r[0]<199.89 and r[1]<3.01 and r[2]>3.9 and r[2]<44.1 and abs(r[8]-4)<.01 and abs(r[9]-1)<.01 for r in tri):
        key=round(sum(r[2] for r in tri)/3/3.077)
        # Triangles of one rectangular window share their minimum/maximum Z.
        key=(round(min(r[2] for r in tri),3),round(max(r[2] for r in tri),3))
        windows.setdefault(key,[]).extend(tri)
joinery=[]
for key,rr in windows.items():
    y0=min(r[1] for r in rr);y1=max(r[1] for r in rr);z0=min(r[2] for r in rr);z1=max(r[2] for r in rr)
    for vertical,at,width in [(True,z0+.024,.048),(True,z1-.024,.048),(True,(z0+z1)/2,.038),(False,y0+.037,.074),(False,y1-.024,.048),(False,y0+(y1-y0)*.75,.048)]:
        bm=bmesh.new()
        center=(199.910,(y0+y1)/2,at) if vertical else (199.910,at,(z0+z1)/2)
        size=(.058,y1-y0,width) if vertical else (.058,width,z1-z0)
        box(bm,center,((1,0,0),(0,1,0),(0,0,1)),size,.0025)
        for r in rows_from(bm):
            r[6:8]=[r[1]/2.4,r[2]/.55] if vertical else [r[2]/2.4,r[1]/.55]
            r[8:10]=[7,3];r[10:14]=[.92,.92,.92,1];joinery.append(r+[0,0])
        bm.free()
write('window-joinery.json',joinery);write('r000263-repaired.json',facade)
report['shopJoinery']={'windows':len(windows),'bevelMetres':.0025}
def pipe(bm,points,radius,thickness=.003,sides=20):
    # Hollow pipe, open ends with thickness, including curved shoes. Rings follow the centreline.
    original=[Vector(p) for p in points]; points=[original[0]]
    for i in range(1,len(original)-1):
        p=original[i]; before=p-original[i-1]; after=original[i+1]-p
        trim=min(.09,before.length*.4,after.length*.4); a=p-before.normalized()*trim; b=p+after.normalized()*trim
        for k in range(5):
            t=k/4;points.append(a*(1-t)*(1-t)+p*2*t*(1-t)+b*t*t)
    points.append(original[-1])
    rings=[]
    color=bm.loops.layers.float_color.get('Col') or bm.loops.layers.float_color.new('Col')
    for i,p in enumerate(points):
        p=Vector(p); d=(Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])).normalized()
        ref=Vector((0,0,1)) if abs(d.z)<.9 else Vector((1,0,0)); u=(ref-d*d.dot(ref)).normalized(); v=d.cross(u).normalized()
        rings.append([[bm.verts.new(p+(u*math.cos(j*2*math.pi/sides)+v*math.sin(j*2*math.pi/sides))*r) for j in range(sides)] for r in [radius,radius-thickness]])
    for a,b in zip(rings,rings[1:]):
        for layer in range(2):
            for j in range(sides):
                k=(j+1)%sides; vv=[a[layer][j],a[layer][k],b[layer][k],b[layer][j]]
                f=bm.faces.new(vv if layer==0 else vv[::-1])
                for l in f.loops:l[color]=(.18,.19,.18,1) if layer else (1,1,1,1)
    for ring in [rings[0],rings[-1]]:
        for j in range(sides): k=(j+1)%sides; bm.faces.new([ring[0][j],ring[1][j],ring[1][k],ring[0][k]])
def gutter(bm,a,b,r=.075,cap=True):
    a,b=Vector(a),Vector(b); along=(b-a).normalized(); side=along.cross(Vector((0,1,0))).normalized(); rings=[]
    for p in [a,b]:
        rings.append([[bm.verts.new(p+side*math.cos(j*math.pi/16)*rr+Vector((0,-math.sin(j*math.pi/16)*rr,0))) for j in range(17)] for rr in [r,r-.003]])
    for layer in range(2):
        for j in range(16): bm.faces.new([rings[0][layer][j],rings[0][layer][j+1],rings[1][layer][j+1],rings[1][layer][j]])
    for j in [0,16]: bm.faces.new([rings[0][0][j],rings[1][0][j],rings[1][1][j],rings[0][1][j]])
    for ring in rings:
        for j in range(16): bm.faces.new([ring[0][j],ring[1][j],ring[1][j+1],ring[0][j+1]])
        if cap: bm.faces.new(ring[1])

# Inset flags run with the stair, bed below grade, 6 mm chipped/rounded edges.
slope=6.5/11.7; upflight=(tangent+Vector((0,slope,0))).normalized(); capnormal=(Vector((0,1,0))-tangent*slope).normalized()
box(add_stone,F(.225,-2.05,.425),(tangent,Vector((0,1,0)),inward),(.45,1.05,.50),.015)
box(add_stone,F(.10,-.9,-.024),(tangent,Vector((0,1,0)),inward),(.30,.055,1.86),.005)
for k in range(10):
    a=.25+11.45*k/9;y=.3+a*slope+.012
    if k==0: y=.95
    box(add_iron,F(a,-2.05,y),(upflight,capnormal,inward),(.079,.009,.078),.002)
for j in range(18):
    length=(11.7-.45)/18; a=.45+(j+.5)*length
    before=set(add_stone.verts)
    box(add_stone,F(a,-2.05,.3+a*slope-.074),(upflight,capnormal,inward),(length*math.sqrt(1+slope*slope)-.003,.16,.56),.008)
    if j==0:
        for v in set(add_stone.verts)-before:
            along=(v.co-foot).dot(tangent)
            if along<.454:v.co+=tangent*(.454-along)
    if j:
        a=.45+j*length
        box(add_stone,F(a,-2.05,.3+a*slope-.076),(upflight,capnormal,inward),(.014,.148,.55),.002)
for row in range(23):
    for col in range(2):
        a=-.70+(row+.5)*.64; o=-2.3-(col+.5)*.48
        y=.003+.0015*math.sin(row*13.7+col*9.2)
        box(add_stone,F(a,o,y-.045),(tangent,Vector((0,1,0)),inward),(.628,.10,.468),.006)
# Mortar bed closes the joints, with a fitted apron in front of the lowest step.
box(add_stone,F(6.845,-2.965,-.085),(tangent,Vector((0,1,0)),inward),(14.35,.13,1.33),.003)
box(add_stone,F(-.515,-2.80,-.085),(tangent,Vector((0,1,0)),inward),(.37,.13,.96),.003)
box(add_stone,F(-.35,-1.10,-.07),(tangent,Vector((0,1,0)),inward),(.70,.13,2.40),.006)
# A low stone drainage run along the apron, falling toward the stair foot.
for row in range(23):
    a=-.70+(row+.5)*.64
    for o in [-3.31,-3.59]:
        if row==0:continue
        box(add_stone,F(a,o,-.04),(tangent,Vector((0,1,0)),inward),(.628,.09,.065),.006)

# House east eave: open half-round gutter with fall, sockets, straps and an open shoe
# that reaches the existing street-side channel x200.70..201.00.
gutter(add_iron,(200.46,10.14,4.0),(200.46,10.11,44.0))
pipe(add_iron,[(200.46,10.06,43.74),(200.43,9.93,43.74),(200.17,9.70,43.74),(200.17,.39,43.74),(200.20,.27,43.74),(200.31,.18,43.74),(200.75,.13,43.74)],.045)
for y in [.65,2.4,4.2,6,7.8,9.6]:
    pipe(add_iron,[(200.17,y-.025,43.74),(200.17,y+.025,43.74)],.051,.007)
    box(add_iron,(200.06,y,43.74),((1,0,0),(0,1,0),(0,0,1)),(.22,.025,.022),.002)
for z in range(4,45):
    box(add_iron,(200.22,10.06-(z-4)*.00075,z),((1,0,0),(0,1,0),(0,0,1)),(.49,.025,.018),.002)
# Drainage cross-channel from shoe to the existing street gutter, below its kerb top.
# This occupies the footpath surface; its central invert slopes toward the street.
for z in [43.63,43.85]: box(add_stone,(200.49,.055,z),((1,0,0),(0,1,0),(0,0,1)),(.73,.13,.07),.007)
box(add_stone,(200.48,.016,43.74),(Vector((1,-.13,0)).normalized(),Vector((.13,1,0)).normalized(),(0,0,1)),(.75,.055,.15),.005)

# Guardhouse eaves get an open gutter all round. Downpipe drains onto the walk at its
# town-side corner; a visible open stone rill connects it to the walk's edge spout.
corners=[Vector((227.46405,9.17,50.78828)),Vector((226.78232,9.155,46.58009)),Vector((222.57576,9.14,47.261)),Vector((223.25749,9.155,51.46991))]
for a,b in zip(corners,corners[1:]+corners[:1]): gutter(add_iron,a,b,cap=False)
p=corners[2]+Vector((-.025,-.075,-.025))
pipe(add_iron,[p,p+Vector((.04,-.13,.02)),Vector((p.x+.10,6.78,p.z+.04)),Vector((p.x+.04,6.64,p.z+.02)),Vector((p.x-.23,6.60,p.z+.035))],.043)
for y in [7,8,8.85]:
    pipe(add_iron,[(p.x+.1,y-.023,p.z+.04),(p.x+.1,y+.023,p.z+.04)],.050,.006)
    box(add_iron,(p.x+.18,y,p.z+.052),(inward,Vector((0,1,0)),tangent),(.26,.028,.028),.002)
# Grated trapped gullies reserve vertical connections to the planned Ruien network.
# The present asset models the visible inlet and sump; the underground network is future work.
connections=[]
def gully(center,name,axes=((1,0,0),(0,1,0),(0,0,1))):
    c=Vector(center); u=Vector(axes[0]); v=Vector(axes[2])
    for sign in [-1,1]:
        box(add_iron,c+u*sign*.16-Vector((0,.15,0)),axes,(.013,.30,.32),.002)
        box(add_iron,c+v*sign*.16-Vector((0,.15,0)),axes,(.32,.30,.013),.002)
    box(add_iron,c-Vector((0,.31,0)),axes,(.32,.015,.32),.002)
    for sign in [-1,1]:
        box(add_iron,c+u*sign*.16,axes,(.025,.025,.345),.003)
        box(add_iron,c+v*sign*.16,axes,(.345,.025,.025),.003)
    for k in range(7): box(add_iron,c+u*(-.126+k*.042),axes,(.017,.025,.29),.003)
    connections.append({'id':name,'world':list(c),'undergroundConnection':list(c-Vector((0,.55,0))),'diameterMetres':.15,'network':'Ruien','status':'inlet modelled; underground connection reserved'})
gully(F(-.50,-3.45,.018),'stair-foot-gully',(tangent,Vector((0,1,0)),inward))
gully((200.85,.029,43.74),'house-east-downpipe-gully')
gully((p.x-.24,6.525,p.z+.08),'guardhouse-gully')
write('ruien-connections.json',connections)

# A few small rooted weeds in damp construction joints; asymmetric folded leaves.
plants=bmesh.new()
for plant,(a,o) in enumerate([(2.16,-2.32),(6.42,-2.32),(11.54,-2.32),(-.49,-3.62)]):
    center=F(a,o,.003)
    for leaf in range(7):
        angle=leaf*2.399+plant*.8; height=.055+.055*(.5+.5*math.sin(leaf*3.7+plant)); reach=.018+.033*(.5+.5*math.cos(leaf*6.1))
        d=Vector((math.cos(angle),0,math.sin(angle))); w=Vector((-d.z,0,d.x))*.009
        pts=[center,center+d*reach*.50+Vector((0,height*.63,0))+w,center+d*reach+Vector((0,height,0)),center+d*reach*.5+Vector((0,height*.64,0))-w,center+d*reach*.47+Vector((0,height*.69,0))]
        vv=[plants.verts.new(v) for v in pts]
        for ids in [(0,1,4),(1,2,4),(2,3,4),(3,0,4)]: plants.faces.new([vv[i] for i in ids])
rr=rows_from(plants)
for r in rr: r[10:14]=[.26,.38,.15,1]
write('plants.json',rr);plants.free()
for bm,filename in [(add_stone,'construction-stone.json'),(add_iron,'construction-iron.json')]:
    bm.normal_update(); rr=rows_from(bm)
    for r in rr:
        n=Vector(r[3:6]); p=Vector(r[:3]); r[6:8]=[p.x/1.2,p.z/1.2] if abs(n.y)>.7 else [p.dot(Vector((n.z,0,-n.x)).normalized())/1.2,-p.y/1.2]
    write(filename,rr); report[filename]={'triangles':len(rr)//3}; bm.free()
write('geometry-report.json',report); print(json.dumps(report,indent=2))
