import bpy,math
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-v13-highres-keeper-fit-game.blend'))
for n in ['Antigoon_body_high','Antigoon_leather_belt','Antigoon_buckle']:bpy.data.objects[n].hide_render=True
for ob in list(bpy.context.scene.objects):
 if ob.type in ('LIGHT','CAMERA'):bpy.data.objects.remove(ob,do_unlink=True)
def aim(o,p):o.rotation_euler=(Vector(p)-o.location).to_track_quat('-Z','Y').to_euler()
d=bpy.data.lights.new('Key','AREA');d.energy=500;d.size=3;o=bpy.data.objects.new('Key',d);bpy.context.collection.objects.link(o);o.location=(1,-3,6);aim(o,(0,0,4.9))
ma=bpy.data.materials.new('coordinates');ma.diffuse_color=(.9,.01,.01,1)
for i in range(12):
 z=4.80+i*.01
 bpy.ops.object.text_add(location=(.115,-.25,z));o=bpy.context.object;o.data.body='%.2f'%z;o.data.size=.006;o.rotation_euler=(math.pi/2,0,0);o.data.materials.append(ma)
 bpy.ops.mesh.primitive_uv_sphere_add(segments=8,ring_count=4,radius=.001,location=(0,-.26,z));bpy.context.object.data.materials.append(ma)
c=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',c);bpy.context.collection.objects.link(cam);cam.location=(0,-5,4.87);aim(cam,(0,0,4.87));c.type='ORTHO';c.ortho_scale=.29
s=bpy.context.scene;s.camera=cam;s.render.engine='CYCLES';s.cycles.samples=16;s.render.resolution_x=1300;s.render.resolution_y=1300;s.render.resolution_percentage=100
p=bpy.context.preferences.addons['cycles'].preferences;p.compute_device_type='OPTIX';p.get_devices()
for d in p.devices:d.use=d.type=='OPTIX'
s.cycles.device='GPU';s.render.filepath=str(R/'review/mouth-calibration.png');bpy.ops.render.render(write_still=True)
