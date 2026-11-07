"""1873 Matsijs well. Native mesh master; metres, Y up. See asset notes for references.
python native-godot/scripts/matsys_well.py .scratch/matsys/build
"""
import sys, json, math
from pathlib import Path
import numpy as np
from churchyard_kit import Model, rbox, beam, lathe, torus, rot_y, rot_x, grid_tris, weather_stone, weather_iron

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
m = Model('matsys-well', 1873)

def tube(points, radius=.018, mat='iron', sides=10):
    p=np.asarray(points,float); d=np.gradient(p,axis=0); d/=np.maximum(np.linalg.norm(d,axis=1)[:,None],1e-9)
    ref=np.tile([0.,0.,1.],(len(p),1)); ref[abs(d[:,2])>.9]=[1,0,0]
    u=np.cross(d,ref); u/=np.linalg.norm(u,axis=1)[:,None]; v=np.cross(d,u)
    a=np.linspace(0,2*np.pi,sides+1)
    n=u[:,None]*np.cos(a)[None,:,None]+v[:,None]*np.sin(a)[None,:,None]
    rr=np.broadcast_to(np.asarray(radius), (len(p),))
    q=p[:,None]+n*rr[:,None,None]
    arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    uv=np.zeros(q.shape[:2]+(2,)); uv[:,:,0]=arc[:,None]/.5; uv[:,:,1]=a[None]*rr[:,None]/.5
    m.add(mat,*grid_tris(q,n,uv))
    for end,sg in ((0,-1),(-1,1)):
        ps=np.array([[p[end],q[end,j],q[end,j+1]] for j in range(sides)])
        ns=np.broadcast_to(d[end]*sg,ps.shape).copy()
        us=np.array([[[0,0],uv[end,j],uv[end,j+1]] for j in range(sides)])
        m.add(mat,ps,ns,us)

def leaf(at, direction, scale=.15):
    p=np.asarray(at); d=np.asarray(direction); d=d/np.linalg.norm(d); side=np.cross(d,[0,0,1.])
    if np.linalg.norm(side)<.1: side=np.cross(d,[1.,0,0])
    side/=np.linalg.norm(side)
    # Forged leaf has thickness, a raised central rib and curled, lobed margins.
    for sign in (-1,1):
        q=[]
        for t in np.linspace(0,1,13):
            width=scale*.32*math.sin(np.pi*t)*(1+.22*math.sin(t*7*np.pi))
            q.append([p+d*t*scale+side*w*width+np.array([0,0,1])*(scale*.22*t*t+sign*.0025+scale*.08*(1-abs(w))*math.sin(np.pi*t)) for w in np.linspace(-1,1,5)])
        q=np.array(q); du=np.gradient(q,axis=0); dv=np.gradient(q,axis=1); n=np.cross(du,dv)*sign; n/=np.maximum(np.linalg.norm(n,axis=2)[:,:,None],1e-9)
        n[0]=n[1]; n[-1]=n[-2]
        uv=q[:,:,[0,1]]/.5; m.add('iron',*grid_tris(q,n,uv))
    tube([p+d*t*scale+np.array([0,0,scale*(.22*t*t+.08*math.sin(np.pi*t))]) for t in np.linspace(0,.95,12)],.004)

def block(lo,hi,r=.01,R=None): rbox(m,'stone',lo,hi,r,step=.11,R=R,skip=(),k=3)

# Four masonry walls leave a real central shaft; corner joints and coping seams are geometric.
for k in range(4):
    R=rot_y(k*np.pi/2)
    # Recessed mortar closes the joints, including the coping's underside and corner returns.
    for lo,hi in [((-.55,.105,-.765),(.765,.85,-.535)),((-.51,.835,-.818),(.818,1.003,-.49))]:
        rbox(m,'mortar',lo,hi,.002,step=.25,R=R,skip=(),wear=0,chips=0)
    block((-.618,0,-.86),(.858,.12,-.62),.012,R)
    for y0,y1 in ((.124,.47),(.475,.84)):
        block((-.548,y0,-.778),(.774,y1,-.55),.008,R)
    block((-.518,.842,-.818),(.814,.91,-.52),.009,R)
    block((-.498,.914,-.83),(.826,1.015,-.50),.014,R)
    # Raised mouldings and paired pointed tracery, with dark recessed backing in the wall itself.
    for cx in (-.365,.365):
        pts=[(cx-.255,.22,-.793),(cx-.255,.57,-.793)]
        pts += [(cx-.255+.255*t,.57+.22*math.sin(t*np.pi/2),-.793) for t in np.linspace(0,1,18)]
        pts += [(cx+.255*t,.79-.22*(1-math.cos(t*np.pi/2)),-.793) for t in np.linspace(0,1,18)]
        pts += [(cx+.255,.22,-.793),(cx-.255,.22,-.793)]
        tube(np.array(pts)@R.T,.018,'stone',10)
        for s in (-1,1):
            a=np.linspace(0,2*np.pi,33)
            tube(np.array([(cx+s*.1+.073*np.cos(t),.53+.073*np.sin(t),-.801) for t in a])@R.T,.012,'stone')
        beam(m,'stone',R@np.array([cx,.23,-.80]),R@np.array([cx,.66,-.80]),.025,.026,.005,uv=1.2)

# Dark inner shaft bottom, below the rim; no glowing water cap at coping height.
block((-.55,.06,-.55),(.55,.09,.55),.006)
posts=[(-.69,-.69),(.69,-.69),(.69,.69),(-.69,.69)]
for x,z in posts:
    # Clustered wrought rods, collared and leaded into the coping.
    for dx,dz in ((0,0),(-.024,0),(.024,0),(0,-.024),(0,.024)):
        beam(m,'iron',(x+dx,1,z+dz),(x+dx,3.63,z+dz),.022,.022,.002)
    for y in (1.03,1.18,1.85,2.58,3.23,3.60):
        lathe(m,'iron',[(0,y-.025),(.051,y-.025),(.055,y-.018),(.055,y+.018),(.051,y+.025),(0,y+.025)],24,t=(x,0,z),uv=.5)
    lathe(m,'iron',[(0,3.62),(.065,3.62),(.075,3.68),(.045,3.74),(.027,3.91),(.009,4.09),(0,4.11)],24,t=(x,0,z),uv=.5)
    for y in (3.75,3.89):
        for a in range(4): leaf((x,y,z),(.4*math.cos(a*np.pi/2),1,.4*math.sin(a*np.pi/2)),.105)

# Each face: double ogee arches, interlaced C scrolls and tapering foliate offshoots.
for k in range(4):
    R=rot_y(k*np.pi/2)
    def tr(p): return np.array(p)@R.T
    for yy,amp in ((2.04,.48),(2.75,.57),(3.34,.56)):
        tube(tr([(x,yy+amp*math.sin(np.pi*(x+.69)/1.38),-.69) for x in np.linspace(-.69,.69,65)]),.021)
    for sign in (-1,1):
        for y in (2.48,3.22):
            a=np.linspace(0,2*np.pi*1.2,85); rad=np.linspace(.30,.025,len(a))
            pts=tr([(sign*(.34+r*math.cos(t)),y+r*math.sin(t),-.69-.018*math.sin(t)) for t,r in zip(a,rad)])
            tube(pts,np.linspace(.019,.007,len(pts)))
            for j in (8,23,40):
                d=pts[j]-pts[j-1]; d=d/np.linalg.norm(d)
                leaf(pts[j],d+np.array([0,.8,0]),.15)
    # Arched diagonal ribs join the four corners to the crown.
    p0=tr([-.69,3.6,-.69]); p1=np.array([0,4.23,0])
    pts=[p0*(1-t)+p1*t+np.array([0,.24*math.sin(t*np.pi),0]) for t in np.linspace(0,1,45)]
    tube(pts,.023)
    for j in (8,18,28): leaf(pts[j],tr([-.3,.8,-.3]),.18)
    # Hanging flower pendant.
    lathe(m,'iron',[(0,2.57),(.018,2.60),(.045,2.70),(.022,2.78),(0,2.79)],24,t=tr([0,0,-.69]),uv=.5)

def figure(at,scale=1,hero=False):
    at=np.array(at)
    def pt(p): return at+np.array(p)*scale
    def limb(p,q,w):
        ts=np.linspace(0,1,9)
        tube([pt(p)*(1-t)+pt(q)*t for t in ts],w*scale*.53*(.78+.22*np.sin(ts*np.pi)),'bronze',12)
    def body(prof,offset=(0,0,0)): lathe(m,'bronze',[(r*scale,y*scale) for r,y in prof],24,t=pt(offset),uv=.5)
    body([(0,0),(.115,0),(.12,.025),(.10,.04),(0,.04)])
    for s in (-1,1):
        limb((s*.06,.04,.01),(s*.04,.27,0),.055)
        limb((s*.04,.27,0),(s*.06,.39,0),.068)
        limb((s*.06,.055,0),(s*.06,.045,-.065),.052)
    body([(.105,.30),(.12,.34),(.08,.43),(.10,.54),(.12,.61),(.065,.64),(.03,.66)])
    body([(0,.65),(.04,.66),(.058,.70),(.054,.76),(.033,.79),(0,.80)])
    limb((-.1,.60,0),(-.18,.48,-.03),.046)
    limb((-.18,.48,-.03),(-.13,.43,-.08),.036)
    limb((.1,.60,0),(.20,.66,-.02),.044)
    limb((.20,.66,-.02),(.24,.82,-.02),.034)
    # Nose, helmet, raised fingers, armour skirt strips and crossed chest straps.
    limb((0,.72,-.04),(0,.715,-.07),.022)
    for j in range(4): limb((.23+j*.009,.81,-.02),(.23+j*.009,.86,-.027),.007)
    if hero:
        body([(0,.75),(.067,.75),(.064,.78),(.044,.815),(0,.825)])
        limb((0,.80,.02),(0,.91,.025),.024)
        tube([pt((-.22,t,.01)) for t in np.linspace(.03,1.04,12)],.008*scale,'bronze')
    for a in np.linspace(0,2*np.pi,13)[:-1]:
        limb((.10*np.cos(a),.32,.10*np.sin(a)),(.08*np.cos(a),.43,.08*np.sin(a)),.018)
    limb((-.08,.60,-.065),(.065,.45,-.068),.015)

for k,(x,z) in enumerate(posts): figure((x,2.62,z),.65)
lathe(m,'iron',[(0,4.18),(.07,4.18),(.11,4.23),(.11,4.27),(.08,4.30),(0,4.30)],32,uv=.5)
figure((0,4.30,0),.8,True)
# Pulley axle, cheek rings, sheave and three-strand rope disappearing into the shaft.
beam(m,'iron',(-.69,2.65,0),(.69,2.65,0),.045,.045,.003)
for z in (-.025,.025): torus(m,'iron',.105,.014,48,10,R=rot_x(np.pi/2),t=(0,2.52,z))
for a in np.linspace(0,2*np.pi,6)[:-1]: beam(m,'iron',(0,2.52,0),(.09*np.cos(a),2.52+.09*np.sin(a),0),.012,.012,.002)
for j in range(3):
    ys=np.linspace(.15,2.52,420); tube([(.10+.005*math.cos(y*100+j*2*np.pi/3),y,.005*math.sin(y*100+j*2*np.pi/3)) for y in ys],.0035,'rope',6)

info={'surfaces':{},'triangles':m.count(),'position':[-248,0,137.5]}
for mat in m.tris:
    rows=m.rows(mat); p=rows[:,:,:3]; n=rows[:,:,3:6]; edge=rows[:,:,8]; ao=np.zeros(p.shape[:2])
    if mat in ('stone','mortar'): c=weather_stone(p,n,edge,ao,1873,age=.55,top=1.015,tone=.65 if mat=='mortar' else 1)
    elif mat=='rope': c=np.ones(p.shape[:2]+(4,)); c[:,:,:3]=[.32,.22,.12]
    elif mat=='bronze':
        c=weather_iron(p,n,edge,ao,1873,paint='494B3D',age=0)
        # Green patina collects in sheltered lower folds; no ferrous orange rust on bronze.
        patina=(.5+.5*np.sin(p[:,:,1]*43)*np.sin(p[:,:,0]*37))*.23
        c[:,:,:3]=c[:,:,:3]*(1-patina[:,:,None])+np.array([.12,.22,.15])*patina[:,:,None]
    else: c=weather_iron(p,n,edge,ao,1873,paint='303332',age=.7)
    rows[:,:,10:14]=c; rows[:,:,8:10]=0
    rows.tofile(out/(mat+'.f32')); info['surfaces'][mat]={'file':mat+'.f32'}
(out/'model.json').write_text(json.dumps(info,indent=2))
print(info['triangles'],'triangles')
