"""Re-export the authored shell with closed outlets and rounded rib arrises. Original blend stays untouched.
blender --background original.blend --python scripts/repair_shell.py -- --out <export> --textures <textures>
Run the native resource repair after conversion to retain the keeper route, apron and paving.
"""
import bpy,bmesh,sys,os,re,json,math
import numpy as np
from types import SimpleNamespace
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0,os.path.join(ROOT,'scripts'))
import export_game as E
from rlib import gallery as G,gfeat as GF,hall as H,util as U,chosen
import spec
args=sys.argv[sys.argv.index('--')+1:]
E.EXP=args[args.index('--out')+1]; E.TEXD=args[args.index('--textures')+1]
os.makedirs(E.EXP,exist_ok=True)
coll=bpy.data.collections.new('SHELL_REPAIRS'); E.src_root.children.link(coll)
for o in list(E.src_root.all_objects):
    if o.name.startswith('pipe_'):bpy.data.objects.remove(o,do_unlink=True)
GF.pipes(SimpleNamespace(path=G.Path(spec.GAL_PATH_KEYS)),
         {'iron_wet':bpy.data.materials['Iron_wet'],'soot_black':bpy.data.materials['Soot_black'],'water_film':bpy.data.materials['Water_film']},coll)
# Rib sides and soffits meet at exposed convex arrises. Weld their common boundary before rounding;
# a bevel on the separate open sheets would leave the original ninety-degree silhouette intact.
groups={}
for o in list(E.src_root.all_objects):
    m=re.match(r'(hall_rib_[xz]\d+_[xz]\d+)_(side|soffit)',o.name)
    if m:groups.setdefault(m[1],[]).append(o)
report=[]
for name,objects in groups.items():
    print('rounding',name,flush=True)
    for o in objects:
        o.modifiers.clear()
    md=E.MD.merge([E.MD.from_object(o) for o in objects])
    for o in objects:bpy.data.objects.remove(o,do_unlink=True)
    o=md.to_object(name+'_rounded',coll)
    # These three parts share the header family and their authored UV charts.
    o.data.materials.clear();o.data.materials.append(bpy.data.materials['Brick_rib_side'])
    bm=bmesh.new();bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001)
    bm.normal_update()
    edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle(0)>.65]
    width=.010+.002*math.sin(sum(map(ord,name)))
    result=bmesh.ops.bevel(bm,geom=edges,offset=width,segments=3,affect='EDGES',profile=.5,clamp_overlap=True)
    bm.to_mesh(o.data);bm.free();o.data.update()
    report.append({'piece':name,'radius':width,'edges':len(edges)})
# The stair remains a shared authored flight, moved clear of the house frontage into the public street.
shift=5.4
for o in list(E.src_root.all_objects):
    if o.name.startswith(('stair_','stairwell_','hatch_leaf_')):
        o.location.x+=shift
H.STAIR['x0']+=shift;H.STAIR['x1']+=shift
bpy.data.objects.remove(bpy.data.objects['hall_vault'],do_unlink=True)
H.vault({'brick_hallvault':bpy.data.materials['Brick_hall_vault']},coll)
# Approved C1: remove the disconnected header bricks and stone inserts at the main throat.
for o in list(E.src_root.all_objects):
    if o.name.startswith('mouth_main_ringbrick'):
        bpy.data.objects.remove(o,do_unlink=True)
    elif o.name.startswith('mouth_voussoir'):
        centre=np.mean([o.matrix_world@v.co for v in o.data.vertices],axis=0)
        if -153<centre[0]<-146 and -111.4<centre[1]<-109.5:bpy.data.objects.remove(o,do_unlink=True)
chosen.main_arch(coll)
# Approved D1: a thick round lining with a rolled/flared lower mouth; the street kit supplies the grate.
for o in list(E.src_root.all_objects):
    if o.name.startswith(('air_shaft','air_grate')):bpy.data.objects.remove(o,do_unlink=True)
chosen.light_shaft(coll)
# Close the coarse vault-cut fringe with a textured annulus that follows the actual groin profile.
ang=np.linspace(0,2*np.pi,97);rad=np.linspace(.52,.68,9)
x,z,r=H.AIR
xx=x+rad[:,None]*np.cos(ang);zz=z+rad[:,None]*np.sin(ang)
yy=H.ceiling(xx.ravel(),zz.ravel()).reshape(xx.shape)-.012
P=np.stack([xx,yy,zz],-1);UV=np.stack([xx,zz],-1)
A,B,C=H.hall_weather(P.reshape(-1,3),811,'vault')
ob=U.grid_mesh('air_shaft_vault_join',P,UV,attrs={'wxA':A.reshape(*xx.shape,4),'wxB':B.reshape(*xx.shape,4),'wxC':C.reshape(*xx.shape,4)},
               flip=G.orient_check(P,np.array([x,-2,z])),coll_=coll,mat=bpy.data.materials['Brick_hall_vault'])
json.dump(report,open(os.path.join(E.EXP,'edge-repairs.json'),'w'),indent=1)
E.main()
