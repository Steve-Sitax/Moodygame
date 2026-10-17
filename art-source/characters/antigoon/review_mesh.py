"""Blender: prepare a metre-scaled asset and render honest geometry review angles."""
import bpy
import json
import math
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
source = Path(args[0]) if args else ROOT / 'source/shape-v01.glb'
tag = args[1] if len(args) > 1 else 'v01-clay'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
giant = bpy.context.object
giant.name = 'Antigoon'
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
points = [giant.matrix_world @ Vector(p) for p in giant.bound_box]
low = min(p.z for p in points)
height = max(p.z for p in points) - low
scale = 5.4 / height
for v in giant.data.vertices:
    v.co = Vector((v.co.x * scale, v.co.y * scale, (v.co.z - low) * scale))
giant.location = (0, 0, 0)
for p in giant.data.polygons:
    p.use_smooth = True

def material(name, color, roughness=0.65, metallic=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    return m

if 'clay' in tag:
    giant.data.materials.clear()
    giant.data.materials.append(material('Neutral sculpt clay', (0.32, 0.36, 0.36)))

triangles = sum(len(p.vertices) - 2 for p in giant.data.polygons)
asset_dir = REPO / 'native-godot/assets/characters/antigoon'
asset_dir.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
giant.select_set(True)
bpy.context.view_layer.objects.active = giant
bpy.ops.export_scene.gltf(filepath=str(asset_dir / ('antigoon-' + tag + '.glb')), export_format='GLB', use_selection=True, export_yup=True)
(ROOT / 'source' / ('mesh-' + tag + '.json')).write_text(json.dumps({'height_m':5.4, 'human_reference_m':1.8, 'triangles':triangles, 'vertices':len(giant.data.vertices), 'source':str(source), 'rigged':False}, indent=2))

# Existing project character for scale; no original assets are modified.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(REPO / 'art-source/client/public/models/people.glb'))
added = set(bpy.data.objects) - before
human = next((o for o in added if o.name == 'sooi'), None)
if human:
    keep = {human, *human.children_recursive}
    for o in list(added - keep):
        bpy.data.objects.remove(o, do_unlink=True)
    human.animation_data_clear()
    human.location = (2.05, -0.08, 0)
    human.scale *= 1.8 / 1.78
    for bone in human.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1,0,0,0)
else:
    for o in added:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-0.012))
floor = bpy.context.object
floor.name = 'Review floor'
floor.data.materials.append(material('Review floor', (0.055,0.07,0.082), 0.86))

def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

def area(name, loc, power, size, color):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    aim(obj, (0,0,3))

area('Large warm key', (4,-6,8), 1800, 5, (1,0.91,0.8))
area('Cool fill', (-5,-2,5), 1000, 4, (0.65,0.8,1))
area('Upper rim', (2,4,7), 2000, 4, (0.9,0.96,1))
scene = bpy.context.scene
scene.world.color = (0.2,0.2,0.2)
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
if 'highres' in tag: scene.cycles.samples=64
scene.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'OPTIX'
    scene.cycles.device = 'GPU'
except Exception as e:
    print('Cycles device fallback:', e)
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
if 'highres' in tag:
    scene.render.resolution_x=2048
    scene.render.resolution_y=2048
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
cam_data = bpy.data.cameras.new('Review camera')
cam = bpy.data.objects.new('Review camera', cam_data)
bpy.context.collection.objects.link(cam)
scene.camera = cam
cam_data.type = 'ORTHO'
cam_data.ortho_scale = 6.6

views = [
    ('front-scale', (0,-14,3.3), (0.55,0,2.65), 6.6),
    ('three-quarter', (8,-14,7), (0.35,0,2.7), 6.6),
    ('profile', (14,0,4.2), (0,0,2.7), 6.4),
    ('back', (0,14,4), (0,0,2.7), 6.4),
    ('face', (1.3,-5,5.25), (0,0,4.92), 1.3),
]
if 'highres' in tag:
    views.extend([
        ('belt-front',(0,-5,3.39),(0,0,3.39),1.15),
        ('belt-detail',(1.4,-4.5,3.9),(0,0,3.37),1.15),
        ('belt-back',(-1.5,4.5,3.0),(0,0,3.37),1.15),
        ('belt-low',(-1.5,-4.5,2.8),(0,0,3.37),1.15),
        ('cloth-detail',(1.5,-4.5,3.8),(0,0,3.65),1.25),
        ('trousers-detail',(1.6,-4.5,1.7),(0,0,1.25),1.4),
        ('boots-detail',(1.8,-3,.8),(.05,0,.25),1.0),
    ])
if len(args)>2:
    requested=args[2].split(',')
    views=sorted([v for v in views if v[0] in requested],key=lambda v:requested.index(v[0]))
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'source' / ('antigoon-' + tag + '.blend')))
for label, location, target, ortho in views:
    if human:
        for o in {human, *human.children_recursive}:
            o.hide_render = label not in ('front-scale', 'three-quarter')
    cam.location = location
    aim(cam, target)
    cam_data.ortho_scale = ortho
    scene.render.filepath = str(ROOT / 'review' / (tag + '-' + label + '.png'))
    bpy.ops.render.render(write_still=True)
print('ANTIGOON_REVIEW_DONE', tag, triangles)
