"""Straight-on alignment review; avoids the apparent offset in three-quarter views."""
import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/antigoon-v12-highres-belt-fit.blend'))
scene=bpy.context.scene;camera=scene.camera
camera.location=(0,-5,3.39)
camera.rotation_euler=(Vector((0,0,3.39))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.ortho_scale=1.15
scene.render.filepath=str(ROOT/'review/v12-highres-belt-fit-belt-front.png')
prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.get_devices()
for d in prefs.devices:d.use=d.type=='OPTIX'
scene.cycles.device='GPU'
bpy.ops.render.render(write_still=True)
