import bpy,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-playable.blend'))
rig=bpy.data.objects['AntigoonRig']
for ob in bpy.context.scene.objects:
 for data in [ob,ob.data.shape_keys if ob.type=='MESH' else None]:
  if data and data.animation_data:
   for tr in data.animation_data.nla_tracks:tr.mute=True
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size,color in [('Key',(4,-6,8),1800,5,(1,.91,.8)),('Fill',(-5,-2,5),1000,4,(.65,.8,1)),('Rim',(2,4,7),2000,4,(.9,.96,1))]:
 d=bpy.data.lights.new(name,'AREA');d.energy=power;d.shape='DISK';d.size=size;d.color=color;o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.location=loc;aim(o,(0,0,3))
bpy.ops.mesh.primitive_plane_add(size=200);floor=bpy.context.object
m=bpy.data.materials.new('Floor');m.diffuse_color=(.07,.08,.09,1);floor.data.materials.append(m)
c=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',c);bpy.context.collection.objects.link(cam)
s=bpy.context.scene;s.camera=cam;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True
p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='OPTIX';p.get_devices()
for d in p.devices:d.use=d.type=='OPTIX'
s.cycles.device='GPU';s.render.resolution_x=1400;s.render.resolution_y=1400;s.render.resolution_percentage=100;c.type='ORTHO'
for name,frame,loc,target,scale in [('idle',0,(0,-14,3.4),(0,0,2.7),6),('walk',9,(8,-13,4),(0,0,2.7),6),('run',6,(8,-13,4),(0,0,2.7),6),('attack',19,(8,-13,4),(0,0,2.7),6),('throw',20,(8,-13,4),(0,0,2.7),6),('laugh',9,(.5,-4,5.1),(0,0,4.95),1.2),('angry',9,(.5,-4,5.1),(0,0,4.95),1.2),('death',66,(8,-9,6),(0,2.4,.6),6),('idle_rear',0,(0,14,3.4),(0,0,2.7),6)]:
 clip=name.split('_')[0];rig.animation_data.action=bpy.data.actions[clip]
 for ob in bpy.context.scene.objects:
  keys=ob.data.shape_keys if ob.type=='MESH' else None
  if keys:
   a=bpy.data.actions.get(ob.name+'_'+clip)
   if a:keys.animation_data.action=a
 s.frame_set(frame);cam.location=loc;aim(cam,target);c.ortho_scale=scale
 s.render.filepath=str(R/'review'/('playable-'+name+'.png'));bpy.ops.render.render(write_still=True)
