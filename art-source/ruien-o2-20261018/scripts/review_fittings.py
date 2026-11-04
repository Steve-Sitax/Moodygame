# Close review renders of a built stretch's rail and drains (no export). Run on the saved .blend:
# blender --background <out>/<route>.blend --python scripts/review_fittings.py -- --route L105 --out <folder> [--walkway 1] [--samples 48]
import bpy, sys, os, json
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d
from rlib import scene as SC
from kit import sweep as KS, fitlib as FL
RID = arg('--route', 'L105'); OUT = arg('--out'); os.makedirs(OUT, exist_ok=True)
r = json.load(open(os.path.join(REPO, 'docs', 'plans', 'ruien', 'ruien-routes.json')))['routes'][RID]
sec = KS.Section(r['class'], int(arg('--walkway', '1')))
path = KS.RoutePath([tuple(p) for p in r['pts']], r=sec.W * 1.2)
side = sec.sides[0]
lo, hi = sec.channel_edges(); edge = hi if side > 0 else lo
y0 = sec.ledge_y
sc = bpy.context.scene
for c in ('lights_mood', 'fog'):
    if c in bpy.data.collections:
        bpy.data.collections[c].hide_render = True
if 'FITTINGS_COLLISION' in bpy.data.collections:
    bpy.data.collections['FITTINGS_COLLISION'].hide_render = True
sc.cycles.samples = int(arg('--samples', '48'))
sc.render.resolution_x, sc.render.resolution_y = 1280, 800
sc.view_settings.exposure = float(arg('--exposure', '0.5'))
try:
    sc.cycles.device = 'GPU'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'OPTIX'; prefs.get_devices()
    for d in prefs.devices:
        d.use = True
except Exception as e:
    print('gpu', e)
pl = json.load(open(os.path.join(os.path.dirname(bpy.data.filepath), 'placements.json'))) if os.path.exists(os.path.join(os.path.dirname(bpy.data.filepath), 'placements.json')) else None
cC = bpy.data.collections.get('cameras')
def W(u, s, y):
    return tuple(float(v) for v in path.world(np.array(u), np.array(s), np.array(y)))
cams = []
drains = [o for o in bpy.data.objects if o.name.endswith('_kerb')]
mouths = [o for o in bpy.data.objects if o.name.endswith('_lining') and '_drain_' in o.name and not any(o.name.split('_lining')[0] == k.name.split('_kerb')[0] for k in drains)]
def u_of(o):
    P = FL.mesh_points(o); c = P.mean(0); return path.u_near(c[0], c[2])[0]
walk_s = lambda d: side * (sec.hw - d)
for o in drains:
    u = u_of(o)
    cams += [('crossing_walk', W(u - 1.8, walk_s(0.45), y0 + 1.55), W(u, walk_s(0.2), y0 + 0.3), 24),
             ('crossing_walk_back', W(u + 1.8, walk_s(0.45), y0 + 1.55), W(u, walk_s(0.2), y0 + 0.3), 24),
             ('crossing_above', W(u - 0.25, walk_s(0.45), y0 + 1.25), W(u, walk_s(0.45), y0), 22),
             ('crossing_water', W(u - 1.2, walk_s(1.9), sec.water + 0.35), W(u, walk_s(0.6), y0 - 0.2), 24),
             ('crossing_mouth', W(u - 0.5, walk_s(0.65), y0 + 0.5), W(u, walk_s(-0.6), y0 + 0.2), 22),
             ('crossing_lip', W(u - 0.7, edge - side * 0.95, y0 - 0.1), W(u, edge, y0 - 0.3), 26)]
for o in mouths:
    u = u_of(o)
    cams += [('mouth_far', W(u - 1.6, walk_s(0.4), y0 + 1.5), W(u, -side * sec.hw, sec.water + 0.6), 26)]
cams += [('rail_low', W(2.0, walk_s(0.55), y0 + 0.35), W(9.0, walk_s(0.95), y0 + 0.5), 20),
         ('rail_bend', W(10.0, walk_s(0.4), y0 + 1.6), W(17.5, walk_s(0.8), y0 + 0.4), 22),
         ('rail_shoe', W(7.0, edge - side * 0.55, y0 + 0.15), W(7.6, edge, y0 - 0.15), 30),
         ('rail_end', W(path.length - 1.9, walk_s(0.4), y0 + 1.4), W(path.length - 0.4, walk_s(0.9), y0 + 0.3), 22),
         ('escape', W(path.length - 3.2, edge - side * 1.3, sec.water + 0.4), W(path.length - 0.85, edge, y0 - 0.2), 22),
         ('rail_water', W(3.0, edge - side * 1.6, sec.water + 0.3), W(8.0, edge, y0 + 0.2), 22)]
only = arg('--only')
for name, loc, tgt, lens in cams:
    if only and name not in only.split(','):
        continue
    cam = SC.camera('rv_' + name, loc, tgt, lens, cC)
    sc.camera = cam
    sc.render.filepath = os.path.join(OUT, '%s_%s.jpg' % (RID, name))
    bpy.ops.render.render(write_still=True)
    print('REVIEW', name, sc.render.filepath, flush=True)
