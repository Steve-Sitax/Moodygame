"""Detailed gallery confluences built with the O2 groin-vault kit and matched branch portals."""
import zlib
import numpy as np
from . import arch_rim as AR, sweep as KS, fold_bridge as FB
from rlib import util as U, props as PR, gallery as G
import spec


def configure(record, mats, coll):
    def apply(H):
        H.MOUTH_CROWN=-.945
        def mouth_geom(name):
            m=H.MOUTHS[name];tc=m['tc'];hw=m['width']/2
            return tc,hw,tc-hw-.22,tc+hw+.22
        def mouth_y(t,tc,hw):
            matching=next((m for m in record['mouths'] if abs(m['tc']-tc)<.0001 and abs(m['width']/2-hw)<.0001),None)
            spring=(-3.4 if matching.get('legacyC2') else (-2.7 if matching['cls']=='M' else -3.1)) if matching else (-2.7 if hw<2 else -3.1)
            return spring+(-.945-spring)*np.sqrt(np.clip(1-((t-tc)/hw)**2,0,1))
        H.mouth_geom=mouth_geom;H.mouth_y=mouth_y
        H.mouth_inside=lambda t,y,tc,hw:(np.abs(t-tc)<hw)&(y<mouth_y(t,tc,hw))&(y>spec.FLOOR_Y-.5)
        def rings(name,materials,c,rng,unused):
            m=H.MOUTHS[name];o,a,inside=H.mouth_frame(name,m['wall']);hw=m['width']/2
            spring=-3.4 if m.get('legacyC2') else (-2.7 if m['cls']=='M' else -3.1)
            theta=np.linspace(np.pi,0,121)
            left=np.stack([np.full(25,-hw),np.linspace(spec.FLOOR_Y-.15,spring,25)],-1)
            arch=np.stack([hw*np.cos(theta),spring+(-.945-spring)*np.sin(theta)],-1)
            right=np.stack([np.full(25,hw),np.linspace(spring,spec.FLOOR_Y-.15,25)],-1)
            outline=np.concatenate([left[:-1],arch,right[1:]])
            seed=zlib.crc32((record['room']['id']+'/'+m['route']).encode())
            def masks(points, data):
                A,B,C=H.hall_weather(points,seed%100000,'wall')
                data['wxA'][:]=A;data['wxB'][:,:3]=B[:,:3];data['wxC'][:]=C
            rim=AR.rim('mouth_'+m['route']+'_ring',outline,AR.PlaneWall(o,a,-inside),materials['brick_rib'],c,
                       back=max(.5,H.WT),seed=seed,masks=masks)
            return [rim]
        H.mouth_rings=rings
        # A thin bed preserves upright giant routes. Sediment belongs at wall feet and
        # pier eddies, not as the O2 study's metre-high bank across every new mouth.
        def floor(materials,c,rng):
            x0,z0,x1,z1=record['room']['rect']
            xx=np.arange(x0-.05,x1+.051,.15);zz=np.arange(z0-.05,z1+.051,.15)
            X,Z=np.meshgrid(xx,zz,indexing='ij')
            points=np.stack([X,np.zeros_like(X),Z],-1)
            noise=U.fbm3(points.reshape(-1,3),zlib.crc32(record['room']['id'].encode())%100000,2.0).reshape(X.shape)
            edge=np.minimum.reduce([X-x0,x1-X,Z-z0,z1-Z])
            Y=spec.FLOOR_Y+.01+.10*U.smoothstep(1.2,0,edge)*(.4+.6*noise)
            V=np.stack([X,Y,Z],-1)
            ob=U.grid_mesh('hall_silt',V,np.stack([X,Z],-1),flip=G.orient_check(V,V[3,3]+np.array([0,1,0])),coll_=c,mat=materials['silt'])
            U.add_adaptive(ob)
            return [ob],lambda x,z:spec.FLOOR_Y+.04
        H.floor=floor
        original_hole=H.vault_hole
        grates=record['room'].get('grates',[])
        def vault_hole(x,z):
            hole=original_hole(x,z)
            for gx,gz in grates:hole|=(x-gx)**2+(z-gz)**2<(.42+.02)**2
            return hole
        H.vault_hole=vault_hole
    return apply


def branch_portals(record, H, mats, coll):
    room=record['room'];rid=room['id'];objects=[];bridges=[];waters=[];spills=[]
    def block(name,point,l0,l1,d0,d1,y0,y1,material='bluestone'):
        # (across, up, into-room) is a mirrored frame; reverse the local x corner order.
        corners=U.box_corners(l1,l0,y0,y1,d0,d1)
        V=np.array([point(v[0],v[2],v[1]) for v in corners])
        ob=U.block_object(name,V,mats[material],coll,r=.010,res=.06,seed=zlib.crc32(name.encode()),chips=3)
        objects.append(ob)
    for mouth in record['mouths']:
        branch=mouth['route'];normal=np.array([mouth['dir'][0],0,mouth['dir'][1]])
        across=np.array([normal[2],0,-normal[0]]);origin=np.array([mouth['at'][0],0,mouth['at'][1]])
        def point(l,d,y):return origin+across*l-normal*d+np.array([0,y,0])
        sec=KS.Section(mouth['cls'],mouth['walkway_side'])
        if mouth.get('gate') and mouth['width']!=sec.W:
            sec.W=mouth['width'];sec.hw=sec.W/2;sec.ledge_w=.45
        if mouth.get('legacyC2'):sec.spring=-3.4;sec.rise=sec.crown-sec.spring
        depth=mouth.get('depth',1.7 if mouth['cls']=='G' else .60)
        start=point(0,.15,0);end=point(0,-depth,0)
        # A rui route meets this portal as a room stub: thin silt in mid-channel. A 'through' seam banked
        # 12 cm of silt over the whole short portal; that lifted Antigoon into the crown and left a silt step.
        seam='room' if mouth['cls']=='M' and not mouth.get('gate') else 'through'
        obs,info,_,_=KS.build_stretch(rid+'_'+branch+'_portal',[[start[0],start[2]],[end[0],end[2]]],mouth['cls'],mats,coll,
                                     grates=[],lamps=[],start=seam,end=seam,walkway_side=mouth['walkway_side'],section=sec)
        objects.extend(obs)
        lo,hi=sec.channel_edges();outer=sec.hw+.8
        for side,a,b in [('left',-outer,lo),('right',hi,outer)]:
            block(rid+'_'+branch+'_'+side+'_landing',point,a,b,-.04,1.5,spec.FLOOR_Y-.15,-3.6)
        if mouth['cls']=='M':
            # Two human risers and two half-metre giant bed steps, as in the shared G/M tee.
            wa,wb=(hi,sec.hw) if mouth['walkway_side']>0 else (-sec.hw,lo)
            block(rid+'_'+branch+'_step0',point,wa,wb,-.60,-.30,-4.1,-3.75,'bluestone_step')
            block(rid+'_'+branch+'_step1',point,wa,wb,-.30,.04,-4.1,-3.6,'bluestone_step')
            # The tread runs 0.8 m out from the portal: his 0.46 m body stands on it clear of the upper riser.
            block(rid+'_'+branch+'_bed_step0',point,lo,hi,0,.95,spec.FLOOR_Y-.15,-5.5)
            block(rid+'_'+branch+'_bed_step1',point,lo,hi,-.65,.04,spec.FLOOR_Y-.15,-4.9)
            film=np.array([point(lo,.04,-4.4),point(hi,.04,-4.4),point(hi,.04,-4.6),point(lo,.04,-4.6)])
            objects.append(U.mesh_from_faces(rid+'_'+branch+'_overflow',film,[[0,1,2,3]],coll_=coll,mat=mats['water_film'],smooth=False))
            objects[-1]['ruien_collision']=False
            spills.append(dict(at=point((lo+hi)/2,.04,-4.6).tolist(),reach=5))
        back=FB.F['pivot_back']-FB.F['nose'];d=FB.F['room_d']
        bridges.append(FB.marker(rid+'_'+branch+'_bridge',point(lo-back,d,-3.6),point(hi+back,d,-3.6),[-normal[0],-normal[2]]))
        if depth>0:
            level=-4.4 if mouth['cls']=='M' else -4.6
            waters.append(dict(name=rid+'_'+branch+'_portal',height=level,
                               outline=[point(l,dep,level)[[0,2]].tolist() for l,dep in [(lo,-depth),(hi,-depth),(hi,0),(lo,0)]]))
    return objects,bridges,waters,spills


def lamps(record,H,mats,coll):
    objects=[]
    for wall in ['x0','x1','z0','z1']:
        rect=record['room']['rect'];length=rect[3]-rect[1] if wall[0]=='x' else rect[2]-rect[0]
        for i,t in enumerate(np.arange(1.2,length,5.5)):
            absolute=t+(rect[1] if wall[0]=='x' else rect[0])
            if any(m['wall']==wall and abs(absolute-m['tc'])<m['width']/2+.65 for m in record['mouths']):continue
            at=np.array([rect[0] if wall=='x0' else rect[2],-1.7,absolute]) if wall[0]=='x' else np.array([absolute,-1.7,rect[1] if wall=='z0' else rect[3]])
            inside={'x0':[1,0,0],'x1':[-1,0,0],'z0':[0,0,1],'z1':[0,0,-1]}[wall]
            parts,hook=PR.lamp_bracket(record['room']['id']+'_'+wall+'_bracket_'+str(i),at,np.array(inside),.24,mats['iron'],coll)
            lamp,_=PR.safety_lamp(record['room']['id']+'_'+wall+'_lamp_'+str(i),mats,coll,light_power=150)
            lamp.location=U.gv(*hook);objects.extend(parts+[lamp])
    return objects
