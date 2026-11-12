"""Dimensioned tide sluices. Each variant keeps real plank, stone and iron sizes."""
import bpy,json,sys,math
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import spec
from rlib import util as U,mats as M,mats2 as M2,scene as SC,vliet as V,gallery as G
from kit import sweep as KS
args=sys.argv[sys.argv.index('--')+1:]
out=Path(args[args.index('--out')+1]);out.mkdir(parents=True,exist_ok=True)
selected=args[args.index('--variant')+1] if '--variant'in args else None
for name,width,spring,sill,ledge,channel in [('g',6.,-3.1,-5.05,-3.6,3.),('g_narrow',3.,-3.1,-5.05,-3.6,2.1),('m',3.6,-2.7,-4.85,-3.9,2.),('m_narrow',3.,-2.7,-4.85,-3.9,2.)]:
    if selected and name!=selected:continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M.set_root(str(ROOT));mats=M2.make_all();SC.world();SC.render_settings()
    import export_game as EG
    EG.sc=bpy.context.scene
    EG.setup_render();EG.SEAMS[:]=[]
    folder=out/name;folder.mkdir(exist_ok=True)
    coll=U.coll('gate_'+name);rng=np.random.default_rng(18371)
    spec.GATE_SILL_Y=sill;spec.LEDGE_Y=ledge;spec.GAL_CHANNEL_W=channel
    spec.DOOR_STRAPS_Y=np.linspace(sill+.40,spring+.48,5).tolist()
    V.GX=0.;V.ZF=0.;V.W2=width/2;V.SP=spring;V.RISE=-.9-spring
    objects=[];half=width/2;outer=half+.78
    def block(n,lo,hi,material='bluestone',radius=.012):
        return U.block_object(n,U.box_corners(lo[0],hi[0],lo[1],hi[1],lo[2],hi[2]),mats[material],coll,
                              r=radius,res=.055,seed=KS.seed_of(n),chips=5 if material=='bluestone'else 2,wobble=.0015)
    # The replacement brick patch closes the wall through its full depth. Its
    # straight mating boundaries remain hidden inside the native quay masonry.
    xx=np.linspace(-outer,outer,math.ceil(outer*2/.055)+1);yy=np.linspace(sill-.35,-.285,math.ceil((-sill+.065)/.055)+1)
    X,Y=np.meshgrid(xx,yy,indexing='ij')
    for z,front in [(-.012,True),(1.205,False)]:
        p=np.stack([X,Y,np.full(X.shape,z)],-1)
        cx=(X[:-1,:-1]+X[1:,1:])/2;cy=(Y[:-1,:-1]+Y[1:,1:])/2
        inside=(np.abs(cx)<half)&(cy>=sill)&((cy<=spring)|((cx/half)**2+((cy-spring)/V.RISE)**2<1))
        A,B,C=V.wall_weather(p.reshape(-1,3),Y.ravel(),718)
        ob=U.grid_mesh('sluice_backing_'+('front'if front else'rear'),p,np.stack([X,Y],-1),
                       attrs={'wxA':A.reshape(*X.shape,4),'wxB':B.reshape(*X.shape,4),'wxC':C.reshape(*X.shape,4)},
                       keep=~inside,flip=G.orient_check(p,p[0,0]+np.array([0,0,-1 if front else 1])),coll_=coll,mat=mats['brick_quay'])
        U.add_adaptive(ob);objects.append(ob)
    # Equal arc-length voussoirs, bevelled inside and out. Both wall faces have
    # a dressed arris; the arch barrel runs continuously through the quay.
    th=np.linspace(np.pi,0,3000);arc=np.r_[0,np.cumsum(np.hypot(np.diff(half*np.cos(th)),np.diff(V.RISE*np.sin(th))))]
    count=max(9,int(round(arc[-1]/.52))|1);cuts=np.interp(np.linspace(0,arc[-1],count+1),arc,th)
    for i,(ta,tb)in enumerate(zip(cuts,cuts[1:])):
        a,b=ta-.0018,tb+.0018;corners=[]
        for z in (-.065,1.22):
            for grow in (0,.48+(.10 if i==count//2 else 0)):
                for t in (a,b):
                    n=np.array([np.cos(t)/half,np.sin(t)/V.RISE]);n/=np.linalg.norm(n)
                    corners.append([half*np.cos(t)+n[0]*grow,spring+V.RISE*np.sin(t)+n[1]*grow,z])
        objects.append(U.block_object('sluice_voussoir_%02d'%i,np.array(corners),mats['bluestone'],coll,r=.012,res=.05,
                                      seed=340+i,chips=8,chip_size=(.015,.055),wobble=.0015))
    for side in (-1,1):
        ys=np.linspace(sill,spring,max(2,math.ceil((spring-sill)/.48)+1))
        for i,(a,b)in enumerate(zip(ys,ys[1:])):
            lo,hi=sorted([side*half,side*(half+.49)])
            objects.append(block('sluice_jamb_%s_%d'%(side,i),[lo,a,-.04],[hi,b-.004,1.21]))
        # Side platforms taper into the upstream ledge; their bearing masonry
        # continues down to the sill, and does not leave suspended stone edges.
        lo,hi=sorted([side*channel/2,side*half])
        for k in range(3):
            objects.append(block('sluice_ledge_%s_%d'%(side,k),[lo,sill-.25,k*.5],[hi,ledge,(k+1)*.5-.004]))
    for i in range(3):
        a=-channel/2+i*channel/3;b=a+channel/3
        objects.append(block('sluice_sill_%d'%i,[a,sill-.32,-.48],[b-.004,sill,1.52],radius=.015))
    # The door sweep is in open air outside the quay. The upstream bed ramp is
    # unroofed only at the face and stays under the existing vault farther in.
    # The compact Paulus outlet sits between existing berths. Its first stone
    # course protects the sill; the tidal bed continues beyond without entering
    # the neighbouring barge's grounding envelope.
    for k in range(1 if name=='m_narrow'else 4):
        z0=-.48-(k+1)*.75;z1=z0+.746
        for j in range(max(2,math.ceil(width/.9))):
            n=max(2,math.ceil(width/.9));a=-half+j*width/n;b=a+width/n
            objects.append(block('sluice_apron_%d_%d'%(k,j),[a,sill-.28,z0],[b-.008,sill-.035,z1],radius=.015))
    fixed=objects+V.pintles(mats,coll)
    leaves={};movers={}
    for side,label in [(1,'n'),(-1,'s')]:
        leaves[label]=V.door_leaf(side,mats,coll,rng,0)
        movers['outlet_door_'+label]=dict(kind='tide_door_leaf',pivot=[side*(half+.18),sill,-.2],open_rotation_y_deg=-(60 if name=='g_narrow'else 40)*side,
                                        note='Shared dimensioned oak leaf, outward to the lower water; P1 remains closed.')
    manifest=dict(route='gate_'+name,piece='network_gate_kit',cls='G'if name.startswith('g')else'M',waterMin=-4.6 if name.startswith('g')else-4.4,
                  files={},movers=movers,markers={k:[]for k in('lamps','flames','daylight_openings','beams','mist','water','ladders','stairs')},
                  gateTemplate=dict(width=width,spring=spring,crown=-.9,sill=sill,ledge=ledge,channel=channel,depth=1.2,
                                    edgeExceptions='Straight brick patch edges mate inside existing quay masonry. Oak plank ends, stone arrises and iron straps are bevelled.'))
    for lod in(0,1):
        for key,sources in [('outlet_gate',fixed)]+[('outlet_door_'+label,obs)for label,obs in leaves.items()]:
            baked=EG.build_lod(lod,sources,hide_coll=coll)
            EG.export_chunks(baked,lambda p,k=key:np.full(len(p),k,dtype=object),lambda _:key,lod,str(folder),'ruien_gate_'+name+'_',manifest)
    allcol=[]
    for key,sources in [('gate_fixed',fixed)]+[('gate_door_'+label,obs)for label,obs in leaves.items()]:
        cc=U.coll('collision_'+key);proxies=EG.collision(cc,sources)
        for ob in proxies:ob.name='col_'+key+'_'+ob.name+('_door_'+key[-1] if key.startswith('gate_door_')else'')
        allcol+=proxies
    cp=folder/('ruien_gate_'+name+'_collision.glb');EG.gltf_export(str(cp),allcol)
    manifest['files'][cp.name]=dict(sha256=EG.sha(str(cp)),bytes=cp.stat().st_size)
    bpy.ops.wm.save_as_mainfile(filepath=str(folder/'gate.blend'),compress=True)
    (folder/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('NETWORK_GATE_KIT_EXPORTED',name,flush=True)
