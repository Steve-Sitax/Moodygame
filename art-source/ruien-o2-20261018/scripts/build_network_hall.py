"""Export a gallery hall/confluence with surveyed route mouths and no surface access hatch."""
import bpy,importlib,json,sys,zlib
from pathlib import Path
import numpy as np
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
args=sys.argv[sys.argv.index('--')+1:]
def arg(k,d=None):return args[args.index(k)+1] if k in args else d
record=json.loads(Path(arg('--layout')).read_text());room=record['room'];rid=room['id']
out=Path(arg('--out'));out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
from rlib import util as U,mats as M,mats2 as M2,wax as WX,props as PR,scene as SC
from kit import hall_gen as HG,network_hall as NH,junction_gen as JG,sweep as KS
M.set_root(str(ROOT));M.DAYLIGHT[:]=[(x,z,.3) for x,z in room.get('grates',[])]
mats=M2.make_all();coll=U.coll('HALL_'+rid);rng=np.random.default_rng(zlib.crc32(rid.encode()))
WX.DEPOSITS.clear();WX.RUNOFF_PTS.clear()
objects,H,floor=HG.build_hall(room,mats,coll,rng,mouths=record['mouths'],air=False,surface_stair=False,configure=NH.configure(record,mats,coll))
ports,bridges,portal_water,spills=NH.branch_portals(record,H,mats,coll)
objects+=ports+NH.lamps(record,H,mats,coll)

# The same closed D1 lining used by junction rooms, located against this hall's actual ceiling.
class HallShafts:
    lay=dict(room=rid,grates=room.get('grates',[]))
    shaft_rim_line=None  # the giant stands 1.2 m lower on a hall bed: the authored rim stays
    def ceil(self,x,z):
        y=H.ceiling(x,z)
        return y,np.zeros_like(y),np.ones_like(y)
objects+=JG.shafts(HallShafts(),mats,coll,{'placements':[]})
WX.build_runoff(mats,coll,rng);WX.apply_halo(rng)
# A gate hall is fitted to the measured quay: its wall stood in the quay face's own plane, and the two
# walls flickered through each other from the canal and from the hall. Draw that wall 6 cm behind the
# quay face; the last 0.3 m of everything that meets it eases in with it (no route mouth is that near).
for mouth in record['mouths']:
    if not mouth.get('gate'):continue
    for ob in coll.all_objects:
        if ob.type!='MESH' or not len(ob.data.vertices):continue
        mw=np.array(ob.matrix_world);co=np.empty(len(ob.data.vertices)*3);ob.data.vertices.foreach_get('co',co)
        world=co.reshape(-1,3)@mw[:3,:3].T+mw[:3,3]
        inside=-((world[:,0]-mouth['at'][0])*mouth['dir'][0]+(-world[:,1]-mouth['at'][1])*mouth['dir'][1])
        t=np.clip(1-np.maximum(inside,0)/.3,0,1);shift=.06*t*t*(3-2*t)
        if not shift.any():continue
        world[:,0]-=mouth['dir'][0]*shift;world[:,1]+=mouth['dir'][1]*shift
        ob.data.vertices.foreach_set('co',((world-mw[:3,3])@np.linalg.inv(mw[:3,:3]).T).ravel());ob.data.update()
src=[o for o in coll.all_objects if o.type=='MESH' and not any(s.material and s.material.name.startswith('Water_sewer') for s in o.material_slots)]
bpy.ops.wm.save_as_mainfile(filepath=str(out/(rid+'.blend')),compress=True)
print('NETWORK_HALL_BUILT',rid,len(src),'objects',len(record['mouths']),'ports',len(bridges),'bridges',flush=True)
if '--no-export' in args:raise SystemExit(0)
import export_game as EG
SC.world();SC.render_settings()
EG.setup_render()
EG.SEAMS[:]=[(np.array([m['end'][0],0,m['end'][1]]),np.array([m['dir'][0],0,m['dir'][1]])) for m in record['mouths']]
sec=KS.Section('G',1)
manifest=dict(route=rid,name=room['name'],cls='G',piece='network_hall',uvRepair=True,files={},waterMin=-4.6,movers={},
              layout=dict(rect=room['rect'],mouths=record['mouths']),portalSpills=spills)
for lod in (0,1):
    baked=EG.build_lod(lod,src,hide_coll=coll,section=sec)
    EG.export_chunks(baked,lambda points:np.full(len(points),'room',dtype=object),lambda _:rid,lod,str(out),'ruien_'+rid+'_',manifest)
collision=EG.collision(U.coll('EXPORT_COL'),[o for o in src if o.get('ruien_collision',True)])
cp=out/('ruien_'+rid+'_collision.glb');EG.gltf_export(str(cp),collision)
manifest['files'][cp.name]=dict(sha256=EG.sha(str(cp)),bytes=cp.stat().st_size)
markers={k:[] for k in ('lamps','flames','daylight_openings','beams','mist','water','ladders','stairs')}
for o in src:
    indices=[i for i,s in enumerate(o.material_slots) if s.material and s.material.name.startswith('Lamp_flame')]
    flame=[o.matrix_world@o.data.vertices[v].co for f in o.data.polygons if f.material_index in indices for v in f.vertices]
    if not flame:continue
    p=sum(flame,Vector())/len(flame);at=[float(p.x),float(p.z),float(-p.y)]
    markers['lamps'].append(dict(name=o.name,pos=at,color=[1,.74,.52],power_w=150,range_m=14))
    markers['flames'].append(dict(name=o.name,pos=at,color=[1,.74,.52],glow_radius_m=.12))
for i,(gx,gz) in enumerate(room.get('grates',[])):
    y=float(H.ceiling(np.array([gx]),np.array([gz]))[0]);name=rid+'_crown_'+str(i)
    markers['daylight_openings'].append(dict(name=name,kind='round_grate',centre=[gx,0,gz],radius_m=.3,vault_opening=[gx,y-.05,gz]))
x0,z0,x1,z1=room['rect']
markers['water']=[dict(name=rid,height=-4.6,outline=[[x0,z0],[x1,z0],[x1,z1],[x0,z1]])]+portal_water
markers['bridges']=bridges
markers['mist'].append(dict(name='rot_mist_'+rid,min=[x0,-4.6,z0],max=[x1,-4,z1],density_peak=.055))
manifest['markers']=markers
(out/'manifest.json').write_text(json.dumps(manifest,indent=1,default=lambda x:x.tolist() if hasattr(x,'tolist') else float(x)))
print('NETWORK_HALL_EXPORTED',rid,flush=True)
