"""Editable deform rig, facial geometry and authored in-place animation library."""
import bpy,bmesh,math,json
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-v13-highres-keeper-fit-game.blend'))
def active(o):
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o
body=bpy.data.objects['Antigoon_body_high'];head=bpy.data.objects['Antigoon_head_high']
belt=bpy.data.objects['Antigoon_leather_belt'];buckle=bpy.data.objects['Antigoon_buckle']
for obj in [body,head]:
 bm=bmesh.new();bm.from_mesh(obj.data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001);bm.to_mesh(obj.data);bm.free();obj.data.update()
bm=bmesh.new();bm.from_mesh(head.data)
edges=[e for e in bm.edges if all(abs(v.co.x)<.14 and v.co.y<.06 and 4.79<v.co.z<4.915 for v in e.verts)]
bmesh.ops.subdivide_edges(bm,edges=edges,cuts=2,use_grid_fill=True);bm.to_mesh(head.data);bm.free();head.data.update()
def mat(name,c,rough=.5):
 m=bpy.data.materials.new(name);m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;return m
white=mat('Moist ivory sclera',(.66,.69,.66),.20)
iris=mat('Pale blue iris',(.15,.43,.58),.25);irisDark=mat('Blue iris limbal ring',(.027,.09,.13),.3)
pupil=mat('Deep pupils',(.001,.002,.003),.16);enamel=mat('Aged ivory enamel',(.55,.49,.34),.32)
mouthMat=mat('Mouth interior',(.020,.003,.005),.8);tongueMat=mat('Tongue',(.16,.035,.035),.48)
def sphere(name,loc,scale,material,segments=32,rings=20):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc)
 o=bpy.context.object;o.name=name;o.scale=scale;active(o);bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
 o.data.materials.append(material)
 for p in o.data.polygons:p.use_smooth=True
 return o
def smooth(t):
 t=max(0,min(1,t));return t*t*(3-2*t)
def gaussian(x,z,cx,cz,rx,rz):return math.exp(-2*((x-cx)**2/rx**2+(z-cz)**2/rz**2))
# Remove painted eye centres and the sealed mouth slit; keep the authored lids/lips.
eyes=[(-.093,-.010,5.044),(.075,-.003,5.044)]
exec(compile((R/'playable_surface.py').read_text(),'playable_surface.py','exec'))
bm=bmesh.new();bm.from_mesh(head.data)
cut=[]
for f in bm.faces:
 p=f.calc_center_median()
 eye=any(((p.x-x)/.033)**2+((p.z-z)/.018)**2<1 and p.y<y+.036 for x,y,z in eyes)
 if eye or mouth_inside(p.x,p.y,p.z):cut.append(f)
bmesh.ops.delete(bm,geom=cut,context='FACES')
for v in bm.verts:
 if not any(e.is_boundary for e in v.link_edges):continue
 x,y,z=v.co
 if abs(x-MOUTH_X)<.108 and abs(z-mouth_z(x))<.024 and y<.06:
  a=math.atan2((z-mouth_z(x))/.003,(x-MOUTH_X)/MOUTH_W)
  nx=MOUTH_X+MOUTH_W*math.cos(a);nz=mouth_z(nx)+.003*math.sin(a)
  v.co=head_sample(Vector((nx,0,nz)),True)[0]
 for ex,ey,ez in eyes:
  if abs(x-ex)<.046 and abs(z-ez)<.03 and y<ey+.04:
   a=math.atan2((z-ez)/.018,(x-ex)/.033);v.co.x=ex+.033*math.cos(a);v.co.z=ez+.018*math.sin(a)
bm.to_mesh(head.data);bm.free()
colour=head.data.color_attributes.new(name='Projected face colour',type='FLOAT_COLOR',domain='CORNER')
for item in colour.data:item.color=(1,1,1,1)
head.data.color_attributes.active_color=colour
for poly in head.data.polygons:
 x,y,z=poly.center
 if abs((x-MOUTH_X)/MOUTH_W)>1.06 or abs(z-mouth_z(x))>.014 or y>.06:continue
 poly.material_index=1
 for li in poly.loop_indices:
  p=head.data.vertices[head.data.loops[li].vertex_index].co;uv=head.data.uv_layers.active.data[li].uv
  base=head_colour(uv);w=.58*(1-smooth((abs(p.z-mouth_z(p.x))-.003)/.011))
  colour.data[li].color=tuple(base[k]*(1-w)+(.36,.15,.125)[k]*w for k in range(3))+(1,)
base_coords=[v.co.copy() for v in head.data.vertices]
head.shape_key_add(name='Basis',from_mix=False)
for name in ['jaw_open','smirk','angry','blink','laugh']:
 key=head.shape_key_add(name=name,from_mix=False)
 for i,p in enumerate(base_coords):
  key.data[i].co=deform_face(p,name)
facial=[]
for side,(x,y,z) in zip(['R','L'],eyes):
 ball=sphere('Eyeball.'+side,(x,y,z),(.035,.041,.029),white);facial.append((ball,'eye.'+side))
 ob=detailed_iris(side,x,y,z);facial.append((ob,'eye.'+side))
 for label,r,dep,material in [('Pupil',.0058,.042,pupil)]:
  o=sphere(label+'.'+side,(x,y-dep,z),(r,.0025,r),material);facial.append((o,'eye.'+side))
 for o,bone in facial[-3:]:
  o.shape_key_add(name='Basis');k=o.shape_key_add(name='blink')
  for v in k.data:v.co.z=z+(v.co.z-z)*.05
 facial.append((rim_mesh('Eyelid rim.'+side,'eye',(x,y,z)),'head'))
inside=sphere('Mouth cavity',(-.009,.110,4.844),(.101,.040,.035),mouthMat)
inside.shape_key_add(name='Basis');k=inside.shape_key_add(name='jaw_open')
for v in k.data:v.co.z=4.858+(v.co.z-4.858)*2.1
facial.append((inside,'head'))
tongue=sphere('Tongue',(-.009,-.025,4.827),(.05,.037,.009),tongueMat);facial.append((tongue,'jaw'))
for lower in [False,True]:
 for i in range(10):
  x=-.065+i*.0124; y=-.039+.025*(abs(x)/.065)**2
  o=sphere(('Lower' if lower else 'Upper')+' tooth '+str(i),(x,y,4.836 if lower else 4.850),(.006,.009,.011),enamel,12,8)
  facial.append((o,'jaw' if lower else 'head'))
exec(compile((R/'bake_playable_textures.py').read_text(),'bake_playable_textures.py','exec'))
bake_playable_materials()
# Deform skeleton in the same metre-scale coordinates as the approved mesh.
arm=bpy.data.armatures.new('Antigoon humanoid rig');rig=bpy.data.objects.new('AntigoonRig',arm);bpy.context.collection.objects.link(rig)
active(rig);bpy.ops.object.mode_set(mode='EDIT')
spec={}
def bone(name,h,t,parent=None):
 b=arm.edit_bones.new(name);b.head=h;b.tail=t
 if parent:b.parent=arm.edit_bones[parent]
 spec[name]=(Vector(h),Vector(t));return b
bone('root',(0,0,0),(0,0,.25))
bone('pelvis',(0,.08,2.70),(0,.07,3.30),'root')
bone('spine',(0,.07,3.30),(0,.12,3.80),'pelvis')
bone('chest',(0,.12,3.80),(0,.20,4.30),'spine')
bone('neck',(0,.20,4.30),(-.009,.19,4.73),'chest')
bone('head',(-.009,.19,4.73),(-.009,.19,5.28),'neck')
bone('jaw',(-.009,.12,4.90),(-.009,-.025,4.79),'head')
bone('belt_tail',(.12,-.33,3.35),(.12,-.37,2.90),'pelvis')
for side,s in [('L',1),('R',-1)]:
 bone('clavicle.'+side,(s*.08,.18,4.24),(s*.50,.16,4.14),'chest')
 bone('upper_arm.'+side,(s*.50,.16,4.14),(s*.87,.13,3.47),'clavicle.'+side)
 bone('forearm.'+side,(s*.87,.13,3.47),(s*1.04,.065,2.83),'upper_arm.'+side)
 bone('hand.'+side,(s*1.04,.065,2.83),(s*1.03,.015,2.48),'forearm.'+side)
 for j in range(5):
  x=s*(.94+j*.039);z=2.57 if j else 2.66
  bone('finger%d.01.'%j+side,(x,-.015,z),(x,-.022,z-.13),'hand.'+side)
  bone('finger%d.02.'%j+side,(x,-.022,z-.13),(x,-.045,z-.24),'finger%d.01.'%j+side)
 bone('thigh.'+side,(s*.23,.08,2.77),(s*.43,.035,1.55),'pelvis')
 bone('shin.'+side,(s*.43,.035,1.55),(s*.52,.19,.34),'thigh.'+side)
 bone('foot.'+side,(s*.52,.19,.34),(s*.52,-.13,.12),'shin.'+side)
 bone('toe.'+side,(s*.52,-.13,.12),(s*.52,-.34,.10),'foot.'+side)
 ex,ey,ez=eyes[1 if side=='L' else 0];bone('eye.'+side,(ex,ey,ez),(ex,ey-.07,ez),'head')
bpy.ops.object.mode_set(mode='OBJECT')
def dist(p,a,b):
 ab=b-a;t=max(0,min(1,(p-a).dot(ab)/ab.length_squared));return (p-a-ab*t).length
def bind(o,rigid=None):
 for g in list(o.vertex_groups):o.vertex_groups.remove(g)
 groups={n:o.vertex_groups.new(name=n) for n in spec}
 for v in o.data.vertices:
  p=v.co;x,y,z=p;s='L' if x>=0 else 'R'
  if rigid:weights={rigid:1}
  elif o==head:
   w=smooth((z-4.48)/.25);weights={'neck':1-w,'head':w}
  elif o==buckle:weights={'pelvis':1}
  elif o==belt:
   w=.55*(1-smooth((z-2.70)/.595)) if y<-.26 and abs(x)<.24 else 0
   weights={'thigh.L':w,'pelvis':1-w}
  else:
   arm_region=z>2.1 and abs(x)>(.72 if z<2.8 else .59 if z<3.65 else .46)
   if arm_region:
    names=['chest','clavicle.'+s,'upper_arm.'+s,'forearm.'+s,'hand.'+s]
    if z<2.67:names=['hand.'+s]+['finger%d.%02d.'%(j,k)+s for j in range(5) for k in [1,2]]
   elif z<2.70:
    names=['pelvis','thigh.'+s,'shin.'+s,'foot.'+s,'toe.'+s]
   else:names=['pelvis','spine','chest','neck','clavicle.'+s,'upper_arm.'+s]
   ds=sorted([(dist(p,*spec[n]),n) for n in names])[:3]
   weights={n:math.exp(-((d-ds[0][0])/.18)**2*4) for d,n in ds}
   if not arm_region and 2.70<z<3.295:
    w=.55*(1-smooth((z-2.70)/.595));weights={'thigh.'+s:w,'pelvis':1-w}
  total=sum(weights.values())
  for n,w in weights.items():
   if w>1e-5:groups[n].add([v.index],w/total,'REPLACE')
 mod=o.modifiers.new('Antigoon skin','ARMATURE');mod.object=rig;o.parent=rig
for o in [body,head,belt,buckle]:bind(o)
for o,b in facial+surface_parts:bind(o,b)
print('BOUND',len(arm.bones),flush=True)
# Actions are sampled in-place; gameplay owns translation and hit timing.
scene=bpy.context.scene;scene.render.fps=30
clips={'idle':(3,True),'walk':(1.2,True),'run':(.72,True),'attack':(1.35,False),'throw':(2.4,False),'hit':(.65,False),'recoil_light':(1.25,False),'death':(2.2,False),'roar':(2.1,False),'smirk':(2,True),'laugh':(2.4,True),'angry':(2,True)}
for name,(seconds,loop) in clips.items():
 action=bpy.data.actions.new(name);rig.animation_data_create();rig.animation_data.action=action
 frames=round(seconds*30)
 for f in range(frames+1):
  t=f/frames;phase=t*2*math.pi
  for p in rig.pose.bones:p.rotation_mode='XYZ';p.rotation_euler=(0,0,0);p.location=(0,0,0)
  def rot(b,x=0,y=0,z=0):rig.pose.bones[b].rotation_euler=(x,y,z)
  breath=math.sin(phase)
  rot('chest',.012*breath);rot('head',.015*breath,0,.012*breath)
  if name in ('walk','run'):
   run=name=='run';a=.63 if run else .30
   for side,off in [('L',0),('R',math.pi)]:
    q=phase+off;rot('thigh.'+side,-a*math.sin(q));rot('shin.'+side,.85*max(0,math.sin(q-.8)) if run else .50*max(0,math.sin(q-.8)))
    rot('foot.'+side,-.18*math.sin(q));rot('upper_arm.'+side,a*.55*math.sin(q));rot('forearm.'+side,-.50 if run else -.12)
   rot('chest',-.14 if run else -.025,0,.035*math.sin(phase));rot('belt_tail',.13*math.sin(phase))
   rig.pose.bones['pelvis'].location.y=.025*math.cos(phase*2)
  if name=='attack':
   wind=math.sin(min(1,t/.28)*math.pi/2);strike=smooth((t-.28)/.18);recover=smooth((t-.60)/.40)
   # A giant's boot reaches a human's torso; the planted leg stays on the floor.
   rot('thigh.R',(.30*wind-1.25*strike)*(1-recover))
   rot('shin.R',(.7*wind*(1-strike)+.12*strike)*(1-recover));rot('foot.R',.10*strike*(1-recover))
   rot('upper_arm.R',.4*wind*(1-recover),0,-.18*wind*(1-recover))
   rot('upper_arm.L',-.25*wind*(1-recover));rot('chest',-.10*strike*(1-recover),.10*wind*(1-recover),0)
   for j in range(5):rot('finger%d.01.R'%j,.7*wind);rot('finger%d.02.R'%j,.7*wind)
  if name=='throw':
   wind=smooth(t/.22);release=smooth((t-.22)/.11);recover=smooth((t-.42)/.58)
   rot('upper_arm.R',(-2.5*wind+1.5*release)*(1-recover),0,-.18*wind*(1-recover))
   rot('forearm.R',(-1.15*wind+1.05*release)*(1-recover));rot('chest',-.10*release*(1-recover),.25*wind*(1-release)*(1-recover),0)
   rot('upper_arm.L',-.3*wind*(1-recover));rot('head',-.08*wind*(1-recover))
  if name in ('hit','recoil_light'):
   k=math.sin(math.pi*t);rot('chest',.18*k);rot('head',.15*k);rot('upper_arm.L',-.65*k);rot('forearm.L',-.75*k)
  if name=='death':
   k=smooth(t);rot('root',-math.pi*.5*k);rig.pose.bones['root'].location.y=.65*k
   rot('upper_arm.R',-.12*math.sin(math.pi*t),0,-.12*k);rot('upper_arm.L',0,0,.12*k)
  if name in ('roar','laugh'):rot('head',.10*math.sin(phase*3));rot('jaw',.24*(math.sin(phase*3)*.2+.8))
  for p in rig.pose.bones:
   p.keyframe_insert('rotation_euler',frame=f);p.keyframe_insert('location',frame=f)
 rig.animation_data.action=None
 track=rig.animation_data.nla_tracks.new();track.name=name;strip=track.strips.new(name,1,action);strip.action_frame_start=0;strip.action_frame_end=frames
for p in rig.pose.bones:p.rotation_euler=(0,0,0);p.location=(0,0,0)
# Morph animations share NLA track names with the skeleton actions for glTF merging.
for o in [head,*[x for x,b in facial]]:
 keys=o.data.shape_keys
 if not keys:continue
 for name,(seconds,loop) in clips.items():
  a=bpy.data.actions.new(o.name+'_'+name);keys.animation_data_create();keys.animation_data.action=a
  frames=round(seconds*30)
  for f in range(0,frames+1,3):
   t=f/frames
   for k in list(keys.key_blocks)[1:]:
    value=0
    if k.name=='blink' and name in ('idle','walk','smirk'):value=max(0,1-abs(t-.75)/.05)
    if k.name=='jaw_open' and name in ('roar','laugh'):value=.72+.2*math.sin(t*math.pi*6)
    if k.name=='laugh' and name=='laugh':value=.65
    if k.name=='smirk' and name in ('idle','smirk'):value=.55 if name=='smirk' else .25
    if k.name=='angry' and name in ('attack','run','angry','roar'):value=.85
    k.value=value;k.keyframe_insert('value',frame=f)
  keys.animation_data.action=None;tr=keys.animation_data.nla_tracks.new();tr.name=name;tr.strips.new(name,1,a)
 for k in list(keys.key_blocks)[1:]:k.value=0
scene.frame_set(0)
for o in list(bpy.context.scene.objects):
 if o.type not in ('MESH','ARMATURE'):bpy.data.objects.remove(o,do_unlink=True)
active(rig)
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(R/'source/antigoon-playable.blend'))
out=R.parents[2]/'native-godot/assets/characters/antigoon/antigoon-playable.glb'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_nla_strips=True,export_skins=True,export_morph=True,export_force_sampling=True)
(R/'source/playable-manifest.json').write_text(json.dumps({'height':5.4,'bones':len(arm.bones),'clips':clips,'attack_contact_seconds':.62,'blend_shapes':['jaw_open','smirk','angry','blink','laugh'],'rig':'AntigoonRig','triangles':sum(len(p.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for p in o.data.polygons)},indent=2))
print('PLAYABLE_EXPORTED',out,flush=True)
