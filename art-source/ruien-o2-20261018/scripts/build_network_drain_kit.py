"""Detailed shared drain heads, with open continuation seams for the complete drainage network."""
import bpy,json,sys,types
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from rlib import util as U,mats as M,mats2 as M2,scene as SC,wax as WX
from kit import sweep as KS,drain_crossing as KD,fitlib as FL,arch_rim as AR
args=sys.argv[sys.argv.index('--')+1:]
out=Path(args[args.index('--out')+1]);out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
M.set_root(str(ROOT));mats=M2.make_all();SC.world();SC.render_settings()
import export_game as EG
EG.setup_render()
manifest=dict(route='drain_kit',piece='connected_drain_kit',cls='M',files={},movers={},waterMin=-4.6,
              markers={k:[] for k in ('lamps','flames','daylight_openings','beams','mist','water','ladders','stairs')},templates={})

# Only this export removes the old study's hidden end card. The open ring is
# recorded exactly and receives the full collector at native construction.
original_lining=KD.lining
def connected_lining(*a,**kw):
    objects,C=original_lining(*a,**kw)
    for ob in objects[1:]:bpy.data.objects.remove(ob,do_unlink=True)
    return objects[:1],C
KD.lining=connected_lining
for name,cls,walk in [('m_crossing','M',1),('m_mouth','M',-1),('g_crossing','G',1)]:
    coll=U.coll(name);cc=U.coll(name+'_collision');sec=KS.Section(cls,walk)
    path=KS.RoutePath([[-5,0],[5,0]],r=4)
    cfg=FL.data('M')['drainCrossing']
    fake=types.SimpleNamespace(path=path,name=name)
    item=dict(u=5.,u_plan=5.,side=1,bend=1.,kind='crossing' if walk==1 else 'mouth',plan=[])
    objects,proxies=KD.build(fake,sec,mats,coll,[item],cfg,np.random.default_rng(KS.seed_of(name)),cc)
    sources=[o for o in coll.all_objects if o.type=='MESH' and not o.name.endswith(('_wet','_lime'))]
    invert=sec.ledge_y-cfg['invertBelowWalk'] if walk==1 else sec.water+cfg['farInvertAboveWater']
    C,T=KD.barrel_line(cfg,1)
    frame=AR.RouteWall(FL.Frame(path,sec,5,1))
    seam=frame.W(C[-1,0],invert,C[-1,1]);previous=frame.W(C[-2,0],invert,C[-2,1])
    tangent=(seam-previous)/np.linalg.norm(seam-previous)
    profile=KD.Egg(1.6,1.).Q[::8]
    across=np.array([-T[-1,1],T[-1,0]])
    ring=[frame.W(C[-1,0]+across[0]*q[0],invert+q[1],C[-1,1]+across[1]*q[0]).tolist() for q in profile]
    manifest['templates'][name]=dict(cls=cls,invert=invert,halfWidth=sec.hw,walkway=sec.ledge_w,walk=sec.ledge_y,spring=sec.spring,crown=sec.crown,
                                   seam=seam.tolist(),tangent=tangent.tolist(),egg=[1.,1.6],eggProfile=profile.tolist(),seamRing=ring)
    for lod in (0,1):
        EG.SEAMS[:]=[(seam,tangent)]
        baked=EG.build_lod(lod,sources,hide_coll=coll,section=sec)
        EG.export_chunks(baked,lambda p:np.full(len(p),name,dtype=object),lambda _:name,lod,str(out),'ruien_drain_kit_',manifest)
    # The full head barrel is touchable at its mouth: its low roof must stop
    # a person entering the narrower, non-traversable collectors.
    visible=[o for o in sources if ('_sill' in o.name or '_kerb' in o.name or '_rim' in o.name or '_lining' in o.name) and o.get('ruien_collision',True)]
    collision=EG.collision(U.coll(name+'_collision_export'),visible)+proxies
    cp=out/f'ruien_drain_kit_{name}_collision.glb';EG.gltf_export(str(cp),collision)
    manifest['files'][cp.name]=dict(sha256=EG.sha(str(cp)),bytes=cp.stat().st_size)
    for ob in sources:ob.hide_render=True
bpy.ops.wm.save_as_mainfile(filepath=str(out/'network_drain_kit.blend'),compress=True)
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('NETWORK_DRAIN_KIT_EXPORTED',list(manifest['templates']),flush=True)
