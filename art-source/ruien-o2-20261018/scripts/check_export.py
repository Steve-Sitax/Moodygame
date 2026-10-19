# Reimport check: load the exported LOD0 GLBs into the render scene (originals hidden) and render the same
# cameras with the check lights, then put each next to the round-9 check render of the source scene.
# Run: blender --background ruien-o2.blend --python scripts/check_export.py
import bpy, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXP = os.path.join(ROOT, 'export')
OUT = os.path.join(EXP, 'check'); os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
bpy.data.collections['RUIEN_O2'].hide_render = True
for cn in ('fog', 'lights_mood', 'scale_figures', 'backdrop'):
    bpy.data.collections[cn].hide_render = True
bpy.data.collections['lights_check'].hide_render = False
before = set(bpy.data.objects)
for fn in ('ruien_o2_outlet_lod0.glb', 'ruien_o2_outlet_headwall_lod0.glb', 'ruien_o2_gallery_lod0.glb', 'ruien_o2_hall_lod0.glb', 'ruien_o2_markers.glb'):
    bpy.ops.import_scene.gltf(filepath=os.path.join(EXP, fn))
new = [o for o in bpy.data.objects if o not in before]
# swing the door leaves from their shut rest pose to the open angle given in the manifest (as the game would)
import json, math
man = json.load(open(os.path.join(EXP, 'manifest.json')))
for key, mv in man.get('movers', {}).items():
    if 'open_rotation_y_deg' in mv:
        for o in new:
            if o.name.startswith('ruien_o2_%s_lod0' % key):
                o.rotation_mode = 'XYZ'
                o.rotation_euler.z += math.radians(mv['open_rotation_y_deg'])
                print('[check] opened', o.name, mv['open_rotation_y_deg'])
# GLBs carry no images: attach the shared family albedo and normal maps to the imported ruien_<family> materials
TEX = os.path.join(EXP, 'textures')
for m in bpy.data.materials:
    fam = m.name.split('.')[0][6:] if m.name.startswith('ruien_') else None
    if not fam or not m.node_tree:
        continue
    fam = 'oak' if fam == 'oak_debris' else fam
    alb = os.path.join(TEX, 'ruien_%s_albedo.png' % fam)
    b = [n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
    if not os.path.exists(alb) or not b:
        continue
    nt = m.node_tree
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(alb, check_existing=True)
    nt.links.new(t.outputs[0], b[0].inputs['Base Color'])
    nm_ = nt.nodes.new('ShaderNodeTexImage'); nm_.image = bpy.data.images.load(os.path.join(TEX, 'ruien_%s_normal.png' % fam), check_existing=True)
    nm_.image.colorspace_settings.name = 'Non-Color'
    nmap = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(nm_.outputs[0], nmap.inputs['Color']); nt.links.new(nmap.outputs[0], b[0].inputs['Normal'])
    b[0].inputs['Roughness'].default_value = 0.75
print('[check] imported objects', len(new), 'triangles', sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in new if o.type == 'MESH'))
p = bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type = 'OPTIX'; p.get_devices()
for d in p.devices:
    d.use = d.type == 'OPTIX'
sc.cycles.device = 'GPU'
sc.render.resolution_percentage = 50
sc.cycles.samples = 96
sc.view_settings.exposure = 0.0
sc.world.node_tree.nodes['SkyBG'].inputs['Strength'].default_value = 0.0
for cam in ('v1_outlet', 'v2_gate', 'v4_hall', 'v6_stair'):
    sc.camera = bpy.data.objects[cam]
    if cam == 'v1_outlet':
        sc.world.node_tree.nodes['SkyBG'].inputs['Strength'].default_value = 2.0
    sc.render.filepath = os.path.join(OUT, '%s_glb.jpg' % cam)
    bpy.ops.render.render(write_still=True)
    sc.world.node_tree.nodes['SkyBG'].inputs['Strength'].default_value = 0.0
    try:
        from PIL import Image
    except Exception:
        Image = None
    print('[check] rendered', cam, flush=True)
