"""Repair exported native wall surfaces without rebuilding scenes or their IDs.
Run with Blender; source snapshots are immutable, output is a review candidate.
"""
import ast,array,hashlib,json,math,pathlib,sys,time
import bmesh,numpy as np
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
from wall_circuit_kerbs import terminate_kerbs
from mathutils import Vector
from mathutils.kdtree import KDTree

folder=pathlib.Path(sys.argv[sys.argv.index('--')+1]);out=folder/'geometry';out.mkdir(exist_ok=True)
audit=json.loads((folder/'audit.json').read_text());coverage=json.loads((folder/'coverage.json').read_text())
helpers=ast.parse(pathlib.Path(__file__).with_name('repair-city-junction.py').read_text())
for node in helpers.body:
 if isinstance(node,ast.FunctionDef) and node.name in ['mesh_from','rows_from','clip','triangulate','box','append','pipe','gutter','gully']:
  exec(compile(ast.Module(body=[node],type_ignores=[]),'<junction geometry helpers>','exec'))
# Export quantisation can put two sides of a shared vertex 0.1mm apart.
# Weld within 0.5mm before beveling; mortar gaps are at least 10mm wide.
_mesh_from=mesh_from
def mesh_from(rows):
 bm=_mesh_from(rows)
 bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0005)
 return bm
_gully=gully
def gully(center,name,axes=((1,0,0),(0,1,0),(0,0,1))):
 # Rim top meets the walking surface; sumps extend below it.
 _gully(Vector(center)-Vector((0,.035,0)),name,axes)
kerb_only='--kerb-only' in sys.argv
plinth_only='--plinth-only' in sys.argv
report=json.loads((folder/'geometry-report.json').read_text()) if kerb_only or plinth_only else {}
manifest=json.loads((folder/'mesh-manifest.json').read_text()) if kerb_only or plinth_only else {}
connections=[];cuts=[]
UP=Vector((0,1,0));add_stone=bmesh.new();add_iron=bmesh.new();add_wood=bmesh.new();plants=bmesh.new()
def V(p):return Vector((p[0],0,p[1]))
def load(s):
 a=array.array('f');a.frombytes((folder/'source'/s['file']).read_bytes());return [list(a[i:i+16]) for i in range(0,len(a),16)]
def save(name,rows,material,custom=False):
 clean=[];bad=0
 for i in range(0,len(rows),3):
  tri=[r[:16]+[0.]*(16-len(r)) for r in rows[i:i+3]]
  n=(Vector(tri[2][:3])-Vector(tri[0][:3])).cross(Vector(tri[1][:3])-Vector(tri[0][:3]))
  if n.length<1e-9:bad+=1;continue
  n.normalize();avg=sum((Vector(r[3:6]) for r in tri),Vector())
  if n.dot(avg)<0:tri[1],tri[2]=tri[2],tri[1];n=-n
  for r in tri:
   q=Vector(r[3:6]);r[3:6]=list(q.normalized() if q.length>.1 else n)
  if any(material.endswith(x+'.res') for x in ['r000648','r000636','r000735','r000615','r000609']):
   # Integer tile offsets preserve the material phase while keeping small-face UVs precise.
   offset=[math.floor(sum(r[k] for r in tri)/3) for k in [6,7]]
   for r in tri:r[6]-=offset[0];r[7]-=offset[1]
  clean.extend(tri)
 a=array.array('f',(x for r in clean for x in r));(out/name).write_bytes(a.tobytes())
 return dict(file=name,material=material,custom0=custom,vertices=len(clean),degenerateRemoved=bad)
def mat(id):return 'res://world/town/resources/'+id+'.res'
def metric(rows,scale=1.2):
 for r in rows:
  n=Vector(r[3:6]);p=Vector(r[:3]);r[6:8]=[p.x/scale,p.z/scale] if abs(n.y)>.7 else [p.dot(Vector((n.z,0,-n.x)).normalized())/scale,-p.y/scale]
 return rows
def wood_uv(bm):
 uv=bm.loops.layers.uv.get('UV') or bm.loops.layers.uv.new('UV');uv2=bm.loops.layers.uv.get('UV2') or bm.loops.layers.uv.new('UV2');pending=set(bm.verts)
 while pending:
  seed=pending.pop();component={seed};stack=[seed]
  while stack:
   v=stack.pop()
   for e in v.link_edges:
    w=e.other_vert(v)
    if w in pending:pending.remove(w);component.add(w);stack.append(w)
  pts=np.array([list(v.co) for v in component]);mean=pts.mean(0);_,_,axes=np.linalg.svd(pts-mean,full_matrices=False)
  if len(axes)<2:continue
  along=Vector(axes[0]);along*=1 if along[max(range(3),key=lambda j:abs(along[j]))]>=0 else -1
  for f in {f for v in component for f in v.link_faces}:
   end=abs(f.normal.dot(along))>.88;across=f.normal.cross(along)
   if across.length<.1:across=Vector(axes[1])
   else:across.normalize()
   for loop in f.loops:
    p=loop.vert.co-Vector(mean)
    loop[uv].uv=(p.dot(Vector(axes[1]))/.45,p.dot(Vector(axes[2]))/.45) if end and len(axes)>2 else (p.dot(along)/2.4,p.dot(across)/.45)
    loop[uv2].uv=(78 if end else 0,0)
def gate_frame(rec):
 g=next((g for g in coverage['layout']['gates'] if rec['node'].startswith('gate_'+g['id']+'_')),None)
 if not g:return None
 t=V(g['frame']['t']).normalized();n=V(g['frame']['n']).normalized();origin=V(g['frame']['o'])+t*g['s']
 local=lambda p:((Vector(p)-origin).dot(t),(Vector(p)-origin).dot(n))
 oo=[local(V(p))[1] for p in g['house']];pw=max(abs(local(V(p))[0]) for p in g['passage'])
 return origin,t,n,min(oo),max(oo)-.1,pw
def face_rows(points,normal,color=(1,1,1,1)):
 normal=Vector(normal);rr=[]
 for i in range(1,len(points)-1):
  tri=[points[0],points[i],points[i+1]]
  if (tri[2]-tri[0]).cross(tri[1]-tri[0]).dot(normal)<0:tri[1],tri[2]=tri[2],tri[1]
  rr.extend([*p,*normal,0,0,0,0,*color,0,0] for p in tri)
 return rr
def clipped(rows,cuts):
 for c,t,n,amin,amax,omin,omax in cuts:
  if not rows:break
  result=[]
  for i in range(0,len(rows),3):
   tri=[r[:16]+[(Vector(r[:3])-c).dot(t),(Vector(r[:3])-c).dot(n)] for r in rows[i:i+3]]
   if max(r[16] for r in tri)<amin or min(r[16] for r in tri)>amax or max(r[17] for r in tri)<omin or min(r[17] for r in tri)>omax:result.extend(r[:16] for r in tri);continue
   inside=tri;outside=[]
   for axis,value,greater in [(16,amin,True),(16,amax,False),(17,omin,True),(17,omax,False)]:
    outside+=triangulate(clip(inside,axis,value,not greater)) if inside else []
    inside=clip(inside,axis,value,greater) if inside else []
   result.extend(r[:16] for r in outside)
  rows=result
 return rows

# Newels, segmented coping, collars and fitted aprons on each remaining staircase.
stairs=[]
for st in coverage['stairs'][1:]:
 foot=V(st['foot']);t=V(st['t']).normalized();n=V(st['n']).normalized();run=st['run'];slope=6.5/run
 stairs.append((foot,t,n,run));F=lambda a,o,y:foot+t*a+n*o+UP*y
 flight=(t+UP*slope).normalized();capnormal=(UP-t*slope).normalized()
 box(add_stone,F(.225,-2.05,.425),(t,UP,n),(.45,1.05,.50),.015)
 box(add_stone,F(.10,-.9,-.024),(t,UP,n),(.30,.055,1.86),.005)
 count=math.ceil((run-.45)/.64)
 for j in range(count):
  length=(run-.45)/count;a=.45+(j+.5)*length;before=set(add_stone.verts)
  box(add_stone,F(a,-2.05,.3+a*slope-.074),(flight,capnormal,n),(length*math.sqrt(1+slope*slope)-.003,.16,.56),.008)
  if j==0:
   for v in set(add_stone.verts)-before:
    along=(v.co-foot).dot(t)
    if along<.454:v.co+=t*(.454-along)
  if j:box(add_stone,F(.45+j*length,-2.05,.3+(.45+j*length)*slope-.076),(flight,capnormal,n),(.014,.148,.55),.002)
 rows=math.ceil((run+3)/.64)
 for row in range(rows):
  a=-.70+(row+.5)*.64
  for col in range(2):box(add_stone,F(a,-2.3-(col+.5)*.48,-.042+.0015*math.sin(row*13.7+col*9.2)),(t,UP,n),(.628,.10,.468),.006)
  if row:
   for o in [-3.31,-3.59]:box(add_stone,F(a,o,-.04),(t,UP,n),(.628,.09,.065),.006)
 end=-.7+rows*.64
 box(add_stone,F((end-.7)/2,-2.965,-.085),(t,UP,n),(end+.7,.13,1.33),.003)
 box(add_stone,F(-.35,-1.10,-.07),(t,UP,n),(.70,.13,2.40),.006)
 cuts.append((foot,t,n,-.7,end,-3.63,.1))
 gully(F(-.5,-3.45,.018),f'wall-stair-{st["id"]:02}-ruien',(t,UP,n))
 for plant,(a,o) in enumerate([(2.16,-2.32),(6.64,-2.32),(11.12,-2.32)]):
  center=F(a,o,.01)
  for leaf in range(5):
   angle=leaf*2.399+plant*.8+st['id'];height=.045+.045*(.5+.5*math.sin(leaf*3.7+plant));reach=.03
   d=Vector((math.cos(angle),0,math.sin(angle)));w=Vector((-d.z,0,d.x))*.007
   pts=[center,center+d*reach*.5+UP*height*.6+w,center+d*reach+UP*height,center+d*reach*.5+UP*height*.6-w,center+d*reach*.47+UP*height*.67]
   vv=[plants.verts.new(p) for p in pts]
   for ids in [(0,1,4),(1,2,4),(2,3,4),(3,0,4)]:plants.faces.new([vv[k] for k in ids])
report['stairs']=len(stairs)
for st in coverage['stairs']:
 foot=V(st['foot']);t=V(st['t']).normalized();n=V(st['n']).normalized();F=lambda a,o,y:foot+t*a+n*o+UP*y
 box(add_stone,F(-.70,-1.78,-.064),(t,UP,n),(.16,.12,3.85),.002)
 box(add_stone,F(.452,-2.05,.48),(t,UP,n),(.026,.22,.50),.002)

# Roof drainage: all hut eaves feed a town-facing downpipe beside the door.
# A real open grate and sump leave an explicit vertical Ruien connection.
walkcuts=[]
for h in coverage['huts'][1:]:
 c=V(h['center']);front=V(h['front']).normalized();side=V(h['side']).normalized()
 P=lambda a,o,y:c+side*a+front*o+UP*y
 # Four linked half-round runs, high at the rear and low at the front.
 corners=[P(-2.13,-2.13,9.19),P(2.13,-2.13,9.19),P(2.13,2.13,9.16),P(-2.13,2.13,9.16)]
 for k,(a,b) in enumerate(zip(corners,corners[1:]+corners[:1])):
  if k!=2:gutter(add_iron,a,b,cap=False)
 # Front run has a central low feed; pipe stands 1.25m left of doorway centre.
 gutter(add_iron,P(-2.13,2.13,9.16),P(-1.25,2.13,9.13),cap=False)
 gutter(add_iron,P(2.13,2.13,9.16),P(-1.25,2.13,9.13),cap=False)
 pipe(add_iron,[P(-1.25,2.13,9.06),P(-1.25,2.11,8.97),P(-1.25,1.99,8.82),P(-1.25,1.99,6.78),P(-1.25,2.04,6.66),P(-1.25,2.25,6.60)],.043)
 for y in [7.,8.,8.85]:
  pipe(add_iron,[P(-1.25,1.99,y-.023),P(-1.25,1.99,y+.023)],.05,.006)
  box(add_iron,P(-1.25,1.94,y),(side,UP,front),(.028,.028,.16),.002)
 for edge in [-1,1]:
  for a in [-1.7,-.8,.1,1.,1.8]:
   box(add_iron,P(a,2.03*edge,9.10 if edge>0 else 9.13),(side,UP,front),(.019,.028,.30),.002)
   box(add_iron,P(2.03*edge,a,9.13-a*.007),(front,UP,side),(.019,.028,.30),.002)
 g=P(-1.25,2.28,6.525);gully(g,f'wall-hut-{h["id"]:02}-ruien',(side,UP,front));walkcuts.append((g,side,front,-.173,.173,-.173,.173))
report['hutDrainage']=len(coverage['huts'])-1

# Gate tower roofs: four eaves per tower, falling to a town-side downpipe.
grounddrains=[]
for g in coverage['layout']['gates']:
 t=V(g['frame']['t']).normalized();n=V(g['frame']['n']).normalized();origin=V(g['frame']['o'])+t*g['s']
 loc=lambda p:((V(p)-origin).dot(t),(V(p)-origin).dot(n))
 aa=[loc(p)[0] for p in g['house']];oo=[loc(p)[1] for p in g['house']];PW=max(abs(loc(p)[0]) for p in g['passage']);HA=max(abs(x) for x in aa)
 inn=min(oo);outer=max(oo)-.25;P=lambda a,o,y:origin+t*a+n*o+UP*y
 for side in [-1,1]:
  a0,a1=sorted([side*PW,side*HA]);a0-=.25;a1+=.25;o0=inn-.25;o1=outer+.25
  corners=[P(a0,o0,12.46),P(a1,o0,12.46),P(a1,o1,12.49),P(a0,o1,12.49)]
  for a,b in zip(corners,corners[1:]+corners[:1]):gutter(add_iron,a,b,.095,cap=False)
  a=a0+.2 if side<0 else a1-.2
  pipe(add_iron,[P(a,o0,12.39),P(a,o0+.10,12.18),P(a,inn-.09,11.98),P(a,inn-.09,.28),P(a,inn-.17,.15),P(a,inn-.40,.105)],.06)
  for y in [1.,3.,5.,7.,9.,11.]:
   pipe(add_iron,[P(a,inn-.09,y-.03),P(a,inn-.09,y+.03)],.068,.009)
   box(add_iron,P(a,inn-.04,y),(t,UP,n),(.04,.032,.20),.002)
  gc=P(a,inn-.44,.025);gully(gc,g['id']+('-left' if side<0 else '-right')+'-roof-ruien',(t,UP,n));grounddrains.append((gc,t,n,-.174,.174,-.174,.174))
  for along in np.arange(a0+.4,a1,.85):
   for across in [o0,o1]:box(add_iron,P(along,across,12.41),(t,UP,n),(.025,.03,.36),.002)
report['gateTowerDrainage']=8

# Snap independent brick/quoin export seams before adding stone relief.
quoinpoints=[]
for rec in audit:
 for s in rec['surfaces']:
  if s['name']=='wall_quoin' and len(rec['surfaces'])==1:quoinpoints.extend(r[:3] for r in load(s))
kd=KDTree(len(quoinpoints))
for i,p in enumerate(quoinpoints):kd.insert(p,i)
kd.balance()

def blocks(rows,kind,local=False):
 if kind=='plinth' and not local:
  # Every connected plane is clipped near the origin, not several hundred metres away.
  # This also prevents internal triangle shards filling the intended mortar joints.
  source=mesh_from(rows);source.normal_update();pending=set(source.faces);base=[];relief=[];count=0
  while pending:
   seed=max(pending,key=lambda f:f.calc_area());pending.remove(seed);normal=seed.normal.normalized();origin=seed.verts[0].co.copy()
   if abs(normal.y)>.2:
    rr=face_rows([v.co-normal*.012 for v in seed.verts],normal)
    base+=metric(rr);continue
   # Retain the wall's batter. Flattening its normal split a coplanar rectangle
   # into two separately extruded triangles and exposed diagonal stone seams.
   group={seed};stack=[seed]
   while stack:
    f=stack.pop()
    for e in f.edges:
     for other in e.link_faces:
      if other in pending and other.normal.dot(normal)>.9999 and all(abs(normal.dot(v.co-origin))<.006 for v in other.verts):pending.remove(other);group.add(other);stack.append(other)
   # Exported narrow triangles have noisy normals. Fit the connected near-planar
   # patch in double precision instead of measuring it against one thin triangle.
   points=np.array([list(v.co) for v in {v for f in group for v in f.verts}],dtype=np.float64)
   center=points.mean(0);_,_,axes=np.linalg.svd(points-center,full_matrices=False);fitted=axes[-1]
   if fitted@np.array(normal)<0:fitted=-fitted
   error=float(np.abs((points-center)@fitted).max())
   if error>.006:raise RuntimeError(f'Non-planar {kind} patch exceeds 6mm: {error}, center={center}')
   normal=Vector(fitted);across=Vector((normal.z,0,-normal.x)).normalized();vertical=normal.cross(across).normalized()
   origin=Vector(center);origin-=vertical*(origin.y/vertical.y)
   localrows=[]
   for f in group:
    pts=[Vector(((v.co-origin).dot(across),(v.co-origin).dot(vertical),0)) for v in f.verts]
    localrows+=face_rows(pts,Vector((0,0,1)))
   bb,rr,cc=blocks(localrows,kind,True)
   for part in [bb,rr]:
    for r in part:
     p=Vector(r[:3]);nn=Vector(r[3:6]);r[:3]=list(origin+across*p.x+vertical*p.y+normal*p.z);r[3:6]=list(across*nn.x+vertical*nn.y+normal*nn.z)
    metric(part)
   base+=bb;relief+=rr;count+=cc
  source.free();return base,relief,count
 groups={};base=[]
 for i in range(0,len(rows),3):
  tri=[r.copy() for r in rows[i:i+3]];normal=Vector(tri[0][3:6]);plane=normal.dot(Vector(tri[0][:3]));across=Vector((normal.z,0,-normal.x))
  if abs(normal.y)>.2:
   # The retained backing must sit inside the new stones, including their narrow tops.
   # Coplanar old caps and extruded returns otherwise fight for depth at grazing angles.
   for r in tri:r[:3]=list(Vector(r[:3])-normal*.012)
   base+=metric(tri);continue
  across.normalize()
  if kind=='plinth':
   for r in tri:r[6:8]=[Vector(r[:3]).dot(across)/2.4,-r[1]/2.4]
  for r in tri:
   q=r.copy()
   if kind=='quoin':q[6:8]=[Vector(q[:3]).dot(across)/1.84,-q[1]/1.56]
   else:q[:3]=list(Vector(q[:3])-normal*.012);q[10:13]=[.48,.49,.47]
   base.append(q)
  for row in range(math.floor(min(r[7] for r in tri)*4),math.floor(max(r[7] for r in tri)*4)+1):
   poly=clip(clip(tri,7,(row+.012)/4,True),7,(row+1-.012)/4,False)
   if not poly:continue
   if kind=='quoin':
    poly=clip(clip(poly,6,-.001,True),6,(.8 if row%2==0 else .45)/1.2,False)
    if len(poly)>2:groups.setdefault((*[round(n,2) for n in normal],round(plane,1),row),[]).extend(triangulate(poly))
   else:
    shift=.5*(row%2)
    for col in range(math.floor(min(r[6]*4+shift for r in poly)),math.floor(max(r[6]*4+shift for r in poly))+1):
     p=clip(clip(poly,6,(col-shift+.009)/4,True),6,(col+1-shift-.009)/4,False)
     if len(p)>2:groups.setdefault((*[round(n,2) for n in normal],round(plane,1),row,col),[]).extend(triangulate(p))
 relief=[]
 for key,rr in groups.items():
  bm=mesh_from(rr);bmesh.ops.dissolve_limit(bm,angle_limit=.01,verts=list(bm.verts),edges=list(bm.edges));normal=Vector(key[:3]).normalized()
  for v in bm.verts:v.co+=normal*(.018 if kind=='quoin' else .004)
  ex=bmesh.ops.extrude_face_region(bm,geom=list(bm.faces),use_keep_orig=True)
  for v in ex['geom']:
   if isinstance(v,bmesh.types.BMVert):v.co-=normal*.045
  bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.normal_update()
  edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.3]
  radius=(.007 if kind=='quoin' else .0075)+.0015*math.sin(sum(key)*13.7)
  bmesh.ops.bevel(bm,geom=edges,offset=radius,segments=3,affect='EDGES',clamp_overlap=False)
  bm.normal_update()
  for v in bm.verts:
   if len(v.link_faces)>2 and .08<v.normal.dot(normal)<.93:
    chip=max(0,math.sin(v.co.x*79.1+v.co.y*47.3+sum(key)*19.7)-.65)*.008
    v.co-=(v.normal-normal*v.normal.dot(normal))*chip
  blockrows=metric(rows_from(bm))
  if kind=='plinth':
   shade=.95+.035*math.sin(sum(key)*13.7)
   for r in blockrows:r[10:14]=[shade,shade,shade,1]
  relief.extend(blockrows);bm.free()
 return metric(base) if kind=='plinth' else base,relief,len(groups)

skip={'r000877','r000880','r000884'}
for rec in audit:
 id=pathlib.Path(rec['mesh']).stem;surfaces=[];changed=False
 if kerb_only and id!='r000046':continue
 if plinth_only and not any(s['name']=='wall_plinth' for s in rec['surfaces']):continue
 for s in rec['surfaces']:
  name=s['name'];rows=load(s);m=s['material'];extras=[];stats={}
  if id=='r000878':
   if s['index']>0:continue
   name='wall_quoin';rows=json.loads((folder.parent/'city-junction'/'r000878-0.json').read_text())
  if id in skip:
   if id=='r000884' and s['index']==1:
    old=json.loads((folder.parent/'city-junction'/'ruien-connections.json').read_text())
    for r in rows:
     for port in old:
      p=Vector(port['world']);q=Vector(r[:3])-p
      if abs(q.x)<.24 and abs(q.z)<.24 and -.34<q.y<.03:r[1]-=.035;break
   if id in {'r000880','r000884'}:rows=metric(rows);changed=True
   surfaces.append(save(s['file'],rows,m,s['custom0']));continue
  if name=='wall_brick':
   snapped=0
   for r in rows:
    q,index,d=kd.find(Vector(r[:3]))
    if d<.002:r[:3]=list(q);snapped+=1
   stats['seamVertices']=snapped
   gf=gate_frame(rec)
   if gf:
    origin,t,n,inn,front,pw=gf;keep=[];removed=0
    for j in range(0,len(rows),3):
     tri=rows[j:j+3];pp=[Vector(r[:3])-origin for r in tri]
     if all(abs(math.hypot(p.dot(t),p.y-3.3)-pw)<.009 and p.y>3.299 and inn-.01<p.dot(n)<front+.01 for p in pp):removed+=1
     else:keep+=tri
    for k in range(72):
     a=k*math.pi/72;b=(k+1)*math.pi/72;mid=(a+b)/2
     pts=[origin+t*(pw*math.cos(theta))+n*o+UP*(3.3+pw*math.sin(theta)) for theta,o in [(a,inn),(b,inn),(b,front),(a,front)]]
     rr=face_rows(pts,-t*math.cos(mid)-UP*math.sin(mid),(.65,.65,.65,1))
     for r in rr:
      p=Vector(r[:3])-origin;r[6:10]=[p.dot(n)/1.84,math.atan2(p.y-3.3,p.dot(t))*pw/1.56,77,0]
     keep+=rr
    rows=keep;stats['roundedVaultTriangles']=removed
  if id=='r000879':
   if s['index']>0:continue
   rows=json.loads((folder.parent/'city-junction'/'r000879-0.json').read_text())
  if name in ['wall_quoin','wall_plinth']:
   if name=='wall_quoin' and len(rec['surfaces'])>1 and id!='r000878':surfaces.append(save(s['file'],rows,m));continue
   # The previously modelled plinth surface is empty; its added ashlar is retained.
   rows,relief,count=blocks(rows,'quoin' if name=='wall_quoin' else 'plinth')
   m=mat('r000630' if name=='wall_quoin' else 'r000648')
   extras.append(save(id+'-relief.bin',relief,mat('r000636' if name=='wall_quoin' else 'r000648')));stats['blocks']=count;changed=True
  elif name=='wall_grass':
   # The old fern fronds share the lawn material. Replace their flat triangles with rooted stems and leaflets.
   bm=mesh_from(rows);pending=set(bm.faces);remove=[];ferns=0
   while pending:
    seed=pending.pop();group={seed};stack=[seed]
    while stack:
     for edge in stack.pop().edges:
      for f in edge.link_faces:
       if f in pending:pending.remove(f);group.add(f);stack.append(f)
    vs={v for f in group for v in f.verts}
    if not vs or max(v.co.y for v in vs)>1.7 or max((v.co-w.co).length for v in vs for w in vs)>1.4:continue
    root=max(vs,key=lambda v:len(v.link_faces));tips=[v for v in vs if v!=root and len(v.link_faces)>=2]
    if len(root.link_faces)<4 or not tips:continue
    for tip in tips:
     start=root.co.copy();delta=tip.co-start;length=delta.length
     if length<.15:continue
     direction=delta.normalized();side=direction.cross(UP).normalized();normal=side.cross(direction).normalized()
     points=[start+delta*k/3+UP*(.045*math.sin(k*math.pi/3)) for k in range(4)]
     for a,b in zip(points,points[1:]):
      axis=(b-a).normalized();box(plants,(a+b)/2,(axis,side,axis.cross(side)),((b-a).length,.003,.003),.0006)
     for k in range(1,9):
      u=k/10;center=start+delta*u+UP*(.045*math.sin(u*math.pi));width=.057*math.sin(u*math.pi)**.7
      for sign in [-1,1]:
       reach=side*sign*width+direction*.013;middle=center+reach*.5
       pp=[center,middle+direction*.009,center+reach,middle-direction*.009,middle+normal*.0014,middle-normal*.0014]
       vv=[plants.verts.new(p) for p in pp]
       for j in range(4):plants.faces.new([vv[j],vv[(j+1)%4],vv[4]]);plants.faces.new([vv[(j+1)%4],vv[j],vv[5]])
    remove+=list(group);ferns+=1
   bmesh.ops.delete(bm,geom=remove,context='FACES');rows=rows_from(bm);bm.free()
   if ferns:changed=True;stats['physicalFerns']=ferns
  elif name in ['wall_stone','wall_iron','wall_wood','wall_brick','wall_coping']:
   if s['custom0']:raise RuntimeError('Unexpected custom attributes '+id)
   gf=gate_frame(rec) if name=='wall_stone' else None
   if gf:
    origin,t,n,inn,front,pw=gf;keep=[];pilasters=[];P=lambda a,o,y:origin+t*a+n*o+UP*y
    for j in range(0,len(rows),3):
     tri=rows[j:j+3];pp=[Vector(r[:3])-origin for r in tri];cent=sum(pp,Vector())/3
     field=Vector(tri[0][3:6]).dot(n)>.99 and (abs(cent.dot(n)-front)<.004 or abs(cent.dot(n)-front-.06)<.004)
     town=Vector(tri[0][3:6]).dot(-n)>.99 and abs(cent.dot(n)-inn)<.004
     if field and all(abs(p.dot(t))<pw+1.205 and -.21<p.y<8.405 for p in pp):
      if max(p.y for p in pp)<=3.305:pilasters+=tri
      continue
     if town and all(abs(p.dot(t))<pw+.705 and 3.295<p.y<3.3+pw+.56 for p in pp):continue
     keep+=tri
    # Ashlar spandrel above the radial ring, with a 72-segment curved opening.
    # Clip and bevel locally: world-coordinate float noise split one ashlar into fan-shaped shards.
    L=lambda a,y:Vector((a,y,0))
    points=[L(-pw-1.2,3.3),L(-pw-.65,3.3)]+[L((pw+.65)*math.cos(math.pi-k*math.pi/72),3.3+(pw+.65)*math.sin(math.pi-k*math.pi/72)) for k in range(1,73)]+[L(pw+1.2,3.3),L(pw+1.2,8.4),L(-pw-1.2,8.4)]
    b=bmesh.new();vv=[b.verts.new(p) for p in points];f=b.faces.new(vv);b.normal_update()
    if f.normal.z<0:f.normal_flip()
    spandrel=rows_from(b);b.free();base,relief,count=blocks(spandrel,'plinth',True)
    for rr in [base,relief]:
     for r in rr:
      p=Vector(r[:3]);nn=Vector(r[3:6]);r[:3]=list(P(p.x,front+p.z,p.y));r[3:6]=list(t*nn.x+UP*nn.y+n*nn.z)
     metric(rr)
    pb,pr,pc=blocks(pilasters,'plinth');base+=pb;relief+=pr;count+=pc
    keep+=base;extras.append(save(id+'-arch-ashlar.bin',relief,mat('r000648')))
    for o,sign,thick in [(front+.06,1,.65),(inn,-1,.55)]:
     for k in range(25):
      a=k*math.pi/25+.0015;b=(k+1)*math.pi/25-.0015
      bb=bmesh.new();pts=[P(r*math.cos(angle),o,3.3+r*math.sin(angle)) for r,angle in [(pw,a),(pw,b),(pw+thick,b),(pw+thick,a)]]
      vv=[bb.verts.new(p) for p in pts];f=bb.faces.new(vv);bb.normal_update()
      if f.normal.dot(n*sign)<0:f.normal_flip()
      ex=bmesh.ops.extrude_face_region(bb,geom=[f],use_keep_orig=True)
      for v in ex['geom']:
       if isinstance(v,bmesh.types.BMVert):v.co-=n*sign*.065
      bmesh.ops.recalc_face_normals(bb,faces=list(bb.faces));bmesh.ops.bevel(bb,geom=list(bb.edges),offset=.008,segments=3,affect='EDGES',clamp_overlap=True)
      append(add_stone,bb);bb.free()
    rows=keep;stats['radialArchStones']=50
   bm=mesh_from(rows)
   if name=='wall_iron':
    pending=set(bm.verts);sockets=0
    while pending:
     seed=pending.pop();group={seed};stack=[seed]
     while stack:
      current=stack.pop()
      for e in current.link_edges:
       v=e.other_vert(current)
       if v in pending:pending.remove(v);group.add(v);stack.append(v)
     ps=[v.co for v in group];lo=Vector(tuple(min(p[k] for p in ps) for k in range(3)));hi=Vector(tuple(max(p[k] for p in ps) for k in range(3)))
     if not (.8<hi.y-lo.y<1.2 and hi.x-lo.x<.09 and hi.z-lo.z<.09):continue
     p=(lo+hi)/2;p.y=lo.y+.021
     for st in coverage['stairs']:
      foot=V(st['foot']);t=V(st['t']).normalized();n=V(st['n']).normalized();a=(p-foot).dot(t);o=(p-foot).dot(n);run=st['run']
      if not (-.1<a<run+4 and -2.2<o<.05):continue
      slope=6.5/run if a<run-.04 else 0;along=(t+UP*slope).normalized();up=(UP-t*slope).normalized()
      # The first newel has a raised cap; anchor its socket to that actual cap.
      if a<.46:p.y=.955;along=t;up=UP
      box(add_iron,p,(along,up,n),(.112,.018,.112),.0025)
      for sign in [-1,1]:box(add_iron,p+n*sign*.044+up*.012,(along,up,n),(.013,.007,.013),.0015)
      sockets+=1;break
    stats['fittedPostSockets']=sockets
   if name=='wall_wood':
    pending=set(bm.verts);uv=bm.loops.layers.uv.get('UV')
    while pending:
     seed=pending.pop();component={seed};stack=[seed]
     while stack:
      v=stack.pop()
      for e in v.link_edges:
       w=e.other_vert(v)
       if w in pending:pending.remove(w);component.add(w);stack.append(w)
     pts=np.array([list(v.co) for v in component]);mean=pts.mean(0)
     _,_,axes=np.linalg.svd(pts-mean,full_matrices=False)
     if len(axes)<2:continue
     along=Vector(axes[0]);along*=1 if along[max(range(3),key=lambda j:abs(along[j]))]>=0 else -1
     for f in {f for v in component for f in v.link_faces}:
      across=f.normal.cross(along)
      if across.length<.1:across=Vector(axes[1])
      else:across.normalize()
      for loop in f.loops:loop[uv].uv=(loop.vert.co.dot(along)/2.4,loop.vert.co.dot(across)/.45)
   if name=='wall_coping':
    # Original spouts were solid boxes. Replace every low component by an open U channel.
    low=[f for f in bm.faces if all(5.93<v.co.y<6.10 for v in f.verts)]
    remain=set(low);spouts=0
    while remain:
     seed=remain.pop();group={seed};stack=[seed]
     while stack:
      f=stack.pop()
      for e in f.edges:
       for q in e.link_faces:
        if q in remain:remain.remove(q);group.add(q);stack.append(q)
     vs={v for f in group for v in f.verts};ps=[v.co for v in vs]
     if len(ps)<4:continue
     # The mouth plane is the narrow vertical cap; its normal points away from wall.
     caps=[f for f in group if abs(f.normal.y)<.2]
     if not caps:continue
     mouth=min(caps,key=lambda f:f.calc_area());n=mouth.normal.copy();t=UP.cross(n).normalized();c=sum(ps,Vector())/len(ps)
     aa=[(p-c).dot(t) for p in ps];oo=[(p-c).dot(n) for p in ps];length=max(oo)-min(oo)
     if not (.13<max(aa)-min(aa)<.21 and .40<length<.52):continue
     for sign in [-1,1]:box(add_stone,c+t*sign*.071+UP*.017,(t,UP,n),(.028,.116,length),.004)
     box(add_stone,c-UP*.059,(t,UP,n),(.17,.032,length),.004)
     bmesh.ops.delete(bm,geom=list(group),context='FACES');spouts+=1
    stats['openedSpouts']=spouts
   if name=='wall_stone':
    remove=[]
    for f in bm.faces:
     p=f.calc_center_median()
     for foot,t,n,run in stairs:
      if (p-foot).length>17:continue
      a=(p-foot).dot(t);o=(p-foot).dot(n);slope=6.5/run
      newel=all(-.004<(v.co-foot).dot(t)<.455 and -2.305<(v.co-foot).dot(n)<-1.795 and -.103<v.co.y<.955 for v in f.verts)
      if newel or (.4501<a<run+.003 and -2.306<o<-1.794 and .3+a*slope-.163<p.y<.3+a*slope+.006):remove.append(f);break
    bmesh.ops.delete(bm,geom=remove,context='FACES');stats['replacedStairFaces']=len(remove)
   bmesh.ops.dissolve_degenerate(bm,dist=.0002,edges=list(bm.edges));bmesh.ops.dissolve_limit(bm,angle_limit=.003,verts=list(bm.verts),edges=list(bm.edges),use_dissolve_boundaries=False)
   radius={'wall_stone':.012,'wall_iron':.0025,'wall_wood':.002,'wall_brick':.006,'wall_coping':.008}[name]
   edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.42]
   bmesh.ops.bevel(bm,geom=edges,offset=radius,segments=3,affect='EDGES',clamp_overlap=False)
   if name=='wall_wood':wood_uv(bm)
   rows=rows_from(bm)
   if name in ['wall_stone','wall_iron','wall_coping']:rows=metric(rows)
   bm.free();stats.update(bevel=radius,edges=len(edges));changed=True
  elif name=='wall_window':
   bm=mesh_from(rows);pending=set(bm.faces)
   while pending:
    seed=pending.pop();group={seed};stack=[seed]
    while stack:
     f=stack.pop()
     for e in f.edges:
      for q in e.link_faces:
       if q in pending:pending.remove(q);group.add(q);stack.append(q)
    ps=[v.co for v in {v for f in group for v in f.verts}];normal=seed.normal.copy();across=UP.cross(normal).normalized();c=sum(ps,Vector())/len(ps)
    width=max((p-c).dot(across) for p in ps)-min((p-c).dot(across) for p in ps);height=max(p.y for p in ps)-min(p.y for p in ps)
    c+=normal*.018
    for sign in [-1,1]:
     box(add_wood,c+across*sign*(width/2-.021),(across,UP,normal),(.042,height,.038),.002)
     box(add_wood,c+UP*sign*(height/2-.021),(across,UP,normal),(width,.042,.038),.002)
    if width>.4:box(add_wood,c,(across,UP,normal),(.024,height-.04,.025),.002)
    if height>.5:box(add_wood,c,(across,UP,normal),(width-.04,.025,.025),.002)
   bm.free();changed=True
  elif name=='wall_slate':
   # Folded, thin metal covers bridge roof hips/ridges; the roofing runs underneath.
   bm=mesh_from(rows);bm.normal_update();caps=0
   for edge in list(bm.edges):
    if len(edge.link_faces)!=2 or edge.calc_face_angle(0)<.18:continue
    a,b=[v.co.copy() for v in edge.verts];along=b-a;length=along.length
    if min(a.y,b.y)<8.7 or length<.25:continue
    if any(f.normal.y<.08 for f in edge.link_faces):continue
    along.normalize()
    for face in edge.link_faces:
     normal=face.normal.normalized();across=normal.cross(along).normalized();mid=(a+b)/2
     if (face.calc_center_median()-mid).dot(across)<0:across=-across
     box(add_iron,mid+across*.037+normal*.004,(along,normal,across),(length+.018,.003,.079),.001)
    caps+=1
   bm.free();stats['foldedHipCovers']=caps
  elif name=='wall_cobble':rows=clipped(rows,walkcuts+grounddrains);changed=True
  elif rec['node'].startswith('ground_'):
   rows=clipped(rows,cuts+grounddrains)
   if id=='r000046':
    # Existing road kerbs must terminate before foundations instead of continuing through them.
    foundationcuts=[(V(s['o']),V(s['t']),V(s['n']),0,s['len'],-7.30,.30) for s in coverage['layout']['segments']]
    rows,capcount=terminate_kerbs(rows,foundationcuts,mesh_from,rows_from,clip,triangulate);stats['squareKerbEndCaps']=capcount
   changed=True
  surfaces.append(save(s['file'],rows,m,s['custom0']));surfaces.extend(extras)
  if stats:report[id]=stats
 if changed:manifest[rec['mesh']]=surfaces
 print(id, 'changed' if changed else 'retained',flush=True)

# Append construction to existing native stone/iron resources. No node IDs change.
if kerb_only or plinth_only:
 (folder/'mesh-manifest.json').write_text(json.dumps(manifest,indent=2));(folder/'geometry-report.json').write_text(json.dumps(report,indent=2));print('Partial geometry update complete',flush=True);sys.exit(0)
wood_id=pathlib.Path(next(r['mesh'] for r in audit if r['node'].startswith('wall_chunk_12_') and r['surfaces'][0]['name']=='wall_wood')).stem
for bm,id,m in [(add_stone,'r000880','r000648'),(add_iron,'r000884','r000615'),(add_wood,wood_id,'r000609')]:
 key=mat(id);rec=next(x for x in audit if x['mesh']==key)
 if key not in manifest:manifest[key]=[save(s['file'],load(s),s['material'],s['custom0']) for s in rec['surfaces']]
 if m=='r000609':wood_uv(bm)
 rr=rows_from(bm);rr=metric(rr) if m!='r000609' else rr
 manifest[key].append(save(id+'-construction.bin',rr,mat(m)));bm.free()
rr=metric(rows_from(plants));plants.free()
for r in rr:r[10:14]=[.26,.37,.14,1]
manifest[mat('r000880')].append(save('rooted-plants.bin',rr,mat('r000648')))
(folder/'mesh-manifest.json').write_text(json.dumps(manifest,indent=2))
(folder/'geometry-report.json').write_text(json.dumps(report,indent=2))
(folder/'ruien-connections.json').write_text(json.dumps(connections,indent=2))
hashfile=folder/'source-hashes.json';hashes=json.loads(hashfile.read_text()) if hashfile.exists() else {}
for p in manifest:
 h=hashlib.sha256((folder.parent.parent/pathlib.Path(p.replace('res://',''))).read_bytes()).hexdigest()
 if p in hashes and hashes[p]!=h:raise RuntimeError('Concurrent source change: '+p)
 hashes[p]=h
hashfile.write_text(json.dumps(hashes,indent=2))
print('Completed',len(manifest),'mesh resources',flush=True)
