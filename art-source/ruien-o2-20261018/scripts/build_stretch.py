# Build one route of the Ruien network from docs/plans/ruien/ruien-routes.json with the kit generators,
# render a check picture, and export it with the same pipeline as O2 (baked relief, masks, LODs, GLB).
# Run: blender --background --factory-startup --python scripts/build_stretch.py -- --route L105 --out export/stretches/L105
#      [--walkway 1|-1] [--start junction|open|cap] [--end open|cap|junction] [--lods 0,1] [--no-export] [--no-render]
import bpy, sys, os, json, time, zlib, importlib
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d
RID = arg('--route', 'L105')
OUT = os.path.join(ROOT, arg('--out', 'export/stretches/' + RID)) if not os.path.isabs(arg('--out', '')) else arg('--out')
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
def log(*a):
    print('[stretch %5.0fs]' % (time.time() - T0), *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
import spec
from rlib import util as U, mats as M, mats2 as M2, wax as WX, scene as SC, props as PR
from kit import sweep as KS
M.set_root(ROOT)
routes = json.load(open(os.path.join(REPO, 'docs', 'plans', 'ruien', 'ruien-routes.json')))
r = routes['routes'][RID]
pts = [tuple(p) for p in r['pts']]
cls = r['class']
def near_route(p, tol=4.0):
    P = np.array(pts)
    for a, b in zip(P[:-1], P[1:]):
        ab = b - a; t = np.clip(np.dot(np.array(p) - a, ab) / np.dot(ab, ab), 0, 1)
        if np.linalg.norm(np.array(p) - (a + t * ab)) < tol:
            return True
    return False
grates = [tuple(g) for g in routes['grates'] if near_route(g)]
lamps = [tuple(l) for l in routes['lamps'] if near_route(l)]
log('route %s %s class %s, %d m, %d grates, %d lamps' % (RID, r.get('name'), cls, r['lengthM'], len(grates), len(lamps)))
M.DAYLIGHT[:] = [(gx, gz, 3.2) for (gx, gz) in grates]
mats = M2.make_all()
coll = U.coll('STRETCH_' + RID)
rend = U.coll('RENDER_ONLY')
cLc = U.coll('lights_check', rend); cLm = U.coll('lights_mood', rend); cF = U.coll('fog', rend); cC = U.coll('cameras', rend)
WX.DEPOSITS.clear(); WX.RUNOFF_PTS.clear()
objs, info, g, sec = KS.build_stretch(RID, pts, cls, mats, coll, grates=grates, lamps=lamps, start=arg('--start', 'junction'), end=arg('--end', 'open'),
                                      walkway_side=int(arg('--walkway', '1')))
rng = np.random.default_rng(KS.seed_of(RID, 99))
WX.build_runoff(mats, coll, rng)
log('halo hosts', WX.apply_halo(rng))
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.users == 1 and o.data.attributes.get('rnd') is None and any(sl.material and sl.material.name.startswith('Brick_') for sl in o.material_slots):
        a_ = o.data.attributes.new('rnd', 'FLOAT', 'POINT')
        a_.data.foreach_set('value', np.full(len(o.data.vertices), (zlib.crc32(o.name.encode()) % 10007) / 10007.0, np.float32))
path = g.path
# lights: check fill along the route; mood: a grate beam per shaft, a few lamps and the rot mist
for uu in np.arange(1.0, path.length, 3.0):
    SC.light('C_%02d' % int(uu), 'POINT', tuple(path.world(np.array(uu), np.array(0.0), np.array(-1.8))), cLc, 60, size=0.3, shadow=False)
for pl in info['placements']:
    if pl['piece'] == 'grate_shaft_parametric':
        p0 = np.array(pl['pos']); top = p0 + np.array([-0.4, 30.0, 0.2])
        SC.light('L_grate', 'SPOT', tuple(top), cLm, 520000, color=(0.74, 0.82, 1.0), size=0.05, rot_to=tuple(p0), spot_deg=3.2, blend=0.3)
for uu in (path.length * 0.3, path.length * 0.75):
    lp = path.world(np.array(uu), np.array(sec.sides[0] * float(sec.wall_s_at_y(-2.3)) * 0.85), np.array(-2.4))
    o = SC.light('L_lamp', 'POINT', tuple(lp), cLm, 150, color=(1.0, 0.74, 0.52), size=0.02)
    o.data.shadow_soft_size = 0.02
fog = M.fog_rot('Fog_rot_mist')
P = np.array([path.world(np.array(u), np.array(s), np.array(0.0)) for u in np.linspace(0, path.length, 20) for s in (-3, 3)])
SC.fog_box('fog_volume', fog, cF, P[:, 0].min() - 2, P[:, 0].max() + 2, sec.bed, sec.crown + 0.5, P[:, 2].min() - 2, P[:, 2].max() + 2)
SC.world()
SC.render_settings()
sc = bpy.context.scene
sc.world.node_tree.nodes['SkyBG'].inputs['Strength'].default_value = 0.0
side = sec.sides[0]
lo, hi = sec.channel_edges()
eye_s = (hi + sec.hw) / 2 if side > 0 else (lo - sec.hw) / 2
cam = SC.camera('check_cam', tuple(path.world(np.array(2.5), np.array(eye_s - side * 0.25), np.array(sec.ledge_y + 1.6))),
                tuple(path.world(np.array(min(10.0, path.length - 1)), np.array(-side * 0.6), np.array(sec.ledge_y + 0.7))), 16, cC)
sc.camera = cam
bpy.ops.file.make_paths_absolute()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, RID + '.blend'), compress=True)
log('built and saved')
if '--no-render' not in argv:
    for mode in ('check', 'mood'):
        cLc.hide_render = (mode == 'mood'); cLm.hide_render = (mode == 'check'); cF.hide_render = (mode == 'check')
        sc.view_settings.exposure = 0.0 if mode == 'check' else 2.0
        sc.cycles.samples = 160 if mode == 'check' else 320
        sc.render.filepath = os.path.join(OUT, '%s_%s.jpg' % (RID, mode))
        bpy.ops.render.render(write_still=True)
        log('rendered', mode)
    cLc.hide_render = False; cLm.hide_render = False; cF.hide_render = False
if '--no-export' not in argv:
    import export_game as EG
    importlib.reload(EG)
    EG.setup_render()
    kd = __import__('mathutils').kdtree.KDTree(len(path.P[::10]))
    for i, q in enumerate(path.P[::10]):
        kd.insert((q[0], q[1], 0.0), i)
    kd.balance()
    ustep = path.u[::10]
    def keyfn(Cg):
        out = np.empty(len(Cg), dtype=object)
        for i, c in enumerate(Cg):
            _, j, _ = kd.find((c[0], c[2], 0.0))
            out[i] = 's%d' % int(ustep[j] // 10)
        return out
    manifest = dict(route=RID, name=r.get('name'), cls=cls, built_with='scripts/build_stretch.py + scripts/kit/sweep.py', files={}, info=info,
                    coordinates='glTF +Y up; glTF (x, y, z) = (game x, game y, game z)', textures='shared: ../../textures (see ../../manifest.json)')
    stretch_objs = [o for o in coll.all_objects if o.type == 'MESH']
    for lod in [int(x) for x in arg('--lods', '0,1').split(',')]:
        baked = EG.build_lod(lod, stretch_objs, hide_coll=coll)
        EG.export_chunks(baked, keyfn, lambda k: RID, lod, OUT, 'ruien_%s_' % RID, manifest)
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, default=lambda o: o.tolist() if hasattr(o, 'tolist') else float(o))
    log('exported')
