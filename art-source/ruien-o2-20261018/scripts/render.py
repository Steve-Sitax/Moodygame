# Renders the named views of ruien-o2.blend: a mood and a check picture for each.
# Run: blender --background ruien-o2.blend --python scripts/render.py -- [--views v1_outlet,v2_gate] [--modes mood,check]
#      [--scale 50] [--samples 256] [--out renders/round-1]
import bpy, sys, os, time, argparse
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument('--views', default='v1_outlet,v2_gate,v3_shaft,v4_hall,v5_close,v6_stair,v7_crown')
ap.add_argument('--modes', default='mood,check')
ap.add_argument('--scale', type=int, default=100)
ap.add_argument('--samples', type=int, default=0)
ap.add_argument('--out', default=os.path.join(ROOT, 'renders', 'round-7'))
ap.add_argument('--suffix', default='')
a = ap.parse_args(argv)
a.out = os.path.abspath(a.out) if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
os.makedirs(a.out, exist_ok=True)

sc = bpy.context.scene
p = bpy.context.preferences.addons['cycles'].preferences
p.compute_device_type = 'OPTIX'
p.get_devices()
for d in p.devices:
    d.use = (d.type == 'OPTIX')
sc.cycles.device = 'GPU'
sc.render.resolution_percentage = a.scale

def coll(name):
    return bpy.data.collections[name]

def lc_children(name):
    return bpy.context.view_layer.layer_collection.children['RENDER_ONLY'].children[name]

man = bpy.data.objects['scale_man']
giant = bpy.data.objects['scale_giant']
world_bg = sc.world.node_tree.nodes['SkyBG']

def place(ob, spec_):
    if not spec_:
        ob.hide_render = True
        return
    x, y, z, yaw = spec_
    ob.hide_render = False
    ob.location = Vector((x, -z, y))
    ob.rotation_euler = (0, 0, np.radians(yaw))

def set_mode(mode, cam):
    mood = (mode == 'mood')
    coll('lights_mood').hide_render = not mood
    coll('fog').hide_render = not mood
    coll('lights_check').hide_render = mood
    world_bg.inputs['Strength'].default_value = cam.get('world', 0.0) * (1.4 if mood else 0.8)
    for ln in cam.get('view_only', []):
        bpy.data.objects[ln].hide_render = not (mood and ln in list(cam.get('lamps_on', [])))
    # lamp flames stay lit in both modes; the man's lantern light only in mood
    for o in bpy.data.objects:
        if o.type == 'LIGHT' and o.name.endswith('_light') and o.users_collection and o.users_collection[0].name in ('scale_figures', 'hall_C2', 'gallery_giant_O2'):
            o.hide_render = not mood
    # camera headlight for the check picture
    hl = bpy.data.objects.get('C_headlight')
    if hl is None:
        L = bpy.data.lights.new('C_headlight', 'AREA')
        L.size = 1.2
        hl = bpy.data.objects.new('C_headlight', L)
        sc.collection.objects.link(hl)
    hl.data.energy = 60
    hl.hide_render = mood
    hl.parent = cam
    hl.matrix_parent_inverse = Matrix.Identity(4)
    hl.location = (0.35, 0.45, 0.2)
    hl.rotation_euler = (0, 0, 0)
    sc.view_settings.exposure = cam.get('exposure', 0.0) if mood else 0.0
    sc.cycles.samples = a.samples or (384 if mood else 128)

log = []
for v in a.views.split(','):
    cam = bpy.data.objects[v]
    sc.camera = cam
    for mode in a.modes.split(','):
        place(man, list(cam.get('man', [])) if mode == 'check' else [])
        place(giant, list(cam.get('giant', [])) if mode == 'check' else [])
        lan = bpy.data.objects.get('scale_man_lantern')
        if lan:
            lan.hide_render = man.hide_render
        set_mode(mode, cam)
        sc.render.filepath = os.path.join(a.out, '%s_%s%s.jpg' % (v, mode, a.suffix))
        t = time.time()
        bpy.ops.render.render(write_still=True)
        dt = time.time() - t
        log.append('%s %s %.0fs' % (v, mode, dt))
        print('[render] %s %s done in %.0fs' % (v, mode, dt), flush=True)
print('\n'.join(log))
