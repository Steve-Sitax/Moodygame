# Build one junction room of the Ruien network (J1, shallow brick dome) from docs/plans/ruien/ruien-routes.json with
# kit/junction_gen.py, render check pictures and export it with the stretch pipeline (relief bake, masks, LODs, GLB,
# collision, markers, manifest), so RuienImport converts it like a stretch.
# Run: blender --background --factory-startup --python scripts/build_junction.py -- --room R1 --out <dir>
#      [--over <json>] [--lods 0,1] [--no-render] [--no-export]
# --over: {"<route>": {"t": metres along its wall, "side": 1|-1}, "stair": {"wall": "z1", "end": "hi"}, "crown_grate": false}
# --joined L65,L100: mouths whose stretch is built to join the stub end (build_stretch.py --from-room): no dark card,
#      a raised bond stone over the seam, no relief bake at the seam plane
import bpy, sys, os, json, time, zlib, importlib
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d
RID = arg('--room', 'R1')
OUT = arg('--out') or os.path.join(ROOT, 'export', 'rooms', RID)
os.makedirs(OUT, exist_ok=True)
T0 = time.time()
def log(*a):
    print('[junction %5.0fs]' % (time.time() - T0), *a, flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
import spec
from rlib import util as U, mats as M, mats2 as M2, wax as WX, scene as SC
from kit import junction_gen as JG
M.set_root(ROOT)
plan = json.load(open(os.path.join(REPO, 'docs', 'plans', 'ruien', 'ruien-routes.json')))
room = next(r for r in plan['rooms'] if r['id'] == RID)
over = json.load(open(arg('--over'))) if arg('--over') else {}

# the street mask (native-godot/world/data/public/city/walk.png: R wall, G water, B outside; black is street)
city = json.load(open(os.path.join(REPO, 'native-godot', 'world', 'data', 'shared', 'city.json')))['walk']
im = bpy.data.images.load(os.path.join(REPO, 'native-godot', 'world', 'data', 'public', 'city', 'walk.png'))
w_, h_ = im.size
px = np.empty(w_ * h_ * 4, np.float32); im.pixels.foreach_get(px)
px = px.reshape(h_, w_, 4)[::-1]                      # rows top-down as in the file
street = (px[..., 0] < 0.5 / 255) & (px[..., 1] < 0.5 / 255) & (px[..., 2] < 0.5 / 255)
bpy.data.images.remove(im)
def on_street(x, z, margin=0.25):
    for dx in (-margin, 0, margin):
        for dz in (-margin, 0, margin):
            r = int(round((x + dx - city['x0']) / city['res'])); c = int(round((z + dz - city['z0']) / city['res']))
            if not (0 <= r < h_ and 0 <= c < w_ and street[r, c]):
                return False
    return True

lay = JG.plan_room(room, plan['routes'], on_street, over)
JOINED = [x for x in (arg('--joined') or '').split(',') if x]
for m in lay['mouths']:
    m['joined'] = m['route'] in JOINED
log('room %s %s: %d bays, mouths %s, stair %s %s, runs %d, bridges %s' % (RID, room.get('name'), lay['bays']['n'],
    [(m['route'], m['wall'], round(m['t'], 2), m['side']) for m in lay['mouths']], lay['stair']['wall'], lay['stair']['end'],
    len(lay['runs']), [m['route'] for m in lay['bridges']]))
M.DAYLIGHT[:] = [(gx, gz, 0.3) for (gx, gz) in lay['grates']]
mats = M2.make_all()
coll = U.coll('ROOM_' + RID)
rend = U.coll('RENDER_ONLY')
cLc = U.coll('lights_check', rend); cLm = U.coll('lights_mood', rend); cF = U.coll('fog', rend); cC = U.coll('cameras', rend)
WX.DEPOSITS.clear(); WX.RUNOFF_PTS.clear()
rng = np.random.default_rng(JG.seed(RID, 1))
objs, col, info, R = JG.build_room(lay, mats, coll, rng)
WX.build_runoff(mats, coll, rng)
log('halo hosts', WX.apply_halo(rng))
for o in bpy.data.objects:
    if o.type == 'MESH' and o.data.users == 1 and o.data.attributes.get('rnd') is None and any(sl.material and sl.material.name.startswith('Brick_') for sl in o.material_slots):
        a_ = o.data.attributes.new('rnd', 'FLOAT', 'POINT')
        a_.data.foreach_set('value', np.full(len(o.data.vertices), (zlib.crc32(o.name.encode()) % 10007) / 10007.0, np.float32))
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in coll.all_objects if o.type == 'MESH')
log('built %d objects, %d source triangles' % (len([o for o in coll.all_objects if o.type == 'MESH']), tris))

# check lights and cameras (Blender pictures for the review; the game uses its own light list)
rect = lay['rect']
for x in np.linspace(rect[0] + 1, rect[2] - 1, 3):
    for z in np.linspace(rect[1] + 1, rect[3] - 1, 3):
        SC.light('C_%.0f_%.0f' % (x, z), 'POINT', (x, -2.2, z), cLc, 90, size=0.3, shadow=False)
st = info['stair']
SC.light('C_stair', 'POINT', tuple(np.array(st['bottom']) * 0.5 + np.array(st['top']) * 0.5 + np.array([0, -0.6, 0])), cLc, 60, size=0.2, shadow=False)
for (gx, gz) in lay['grates']:
    SC.light('L_crown', 'SPOT', (gx - 0.3, 30.0, gz + 0.2), cLm, 400000, color=(0.74, 0.82, 1.0), size=0.05, rot_to=(gx, -4.4, gz), spot_deg=2.4, blend=0.3)
for pl in info['placements']:
    if pl['piece'] == 'lamp_bracket_safety_lamp':
        o = SC.light('L_lamp', 'POINT', tuple(np.array(pl['pos']) + np.array([0, -0.18, 0])), cLm, 150, color=(1.0, 0.74, 0.52), size=0.02)
fog = M.fog_rot('Fog_rot_mist')
SC.fog_box('fog_volume', fog, cF, rect[0] - 2, rect[2] + 2, JG.SEC.bed, -0.4, rect[1] - 2, rect[3] + 2)
SC.world(); SC.render_settings()
sc = bpy.context.scene
sc.world.node_tree.nodes['SkyBG'].inputs['Strength'].default_value = 0.0
views = json.loads(arg('--views', '[]')) if arg('--views') else []
c = ((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)
# default views: from the stair landing across the room, from the far walkway back to the stair, up into the dome
sb = np.array(st['bottom'])
default = [('landing', (sb[0], -2.3, sb[2]), (c[0], -2.6, c[1]), 16), ('dome', (c[0] - 0.8, -3.0, c[1] - 0.5), (c[0], -0.9, c[1]), 12), ('water', (c[0] - 1.0, -4.2, c[1] - 0.6), (sb[0], -3.0, sb[2]), 14),
           ]
for m in info['mouths']:
    e = np.array(m['end']); d = np.array(m['dir'])
    default.append(('mouth_' + m['route'], (c[0] - d[0] * 1.2, -2.6, c[1] - d[1] * 1.2), (e[0], -2.6, e[1]), 16))
cams = []
for name, at, look, lens in default:
    cams.append(SC.camera('cam_' + name, at, look, lens, cC))
bpy.ops.file.make_paths_absolute()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, RID + '.blend'), compress=True)
log('saved')
if '--no-render' not in argv:
    sc.render.resolution_x, sc.render.resolution_y = 1280, 800
    for cam in cams:
        sc.camera = cam
        for mode in ('check',):
            cLc.hide_render = False; cLm.hide_render = True; cF.hide_render = True
            sc.view_settings.exposure = 0.0
            sc.cycles.samples = 48
            sc.render.filepath = os.path.join(OUT, '%s_%s_%s.jpg' % (RID, cam.name[4:], mode))
            bpy.ops.render.render(write_still=True)
        log('rendered', cam.name)
    cLc.hide_render = False; cLm.hide_render = False; cF.hide_render = False
if '--no-export' not in argv:
    import export_game as EG
    importlib.reload(EG)
    EG.setup_render()
    keyfn = lambda Cg: JG.key_of(R, Cg)
    manifest = dict(route=RID, name=room.get('name'), cls='M', piece='junction_room', uvRepair=True, built_with='scripts/build_junction.py + scripts/kit/junction_gen.py',
                    files={}, info=info, layout=dict(rect=rect, bays=lay['bays'], mouths=info['mouths'], bridges=info['bridges'], stair=info['stair'], grates=lay['grates']),
                    waterMin=JG.SEC.water, movers=EG.prepare_movers(JG.SEC),
                    coordinates='glTF +Y up; glTF (x, y, z) = (game x, game y, game z)', textures='shared: ../../textures (see ../../manifest.json)')
    src = [o for o in coll.all_objects if o.type == 'MESH' and not o.name.endswith('_water') and not o.name.startswith('runoff_')]   # stains live in the host masks, as O2
    # a joined stretch's seam: no relief within 0.3 m of the stub's end plane, as the stretch does on its side
    EG.SEAMS[:] = [(np.array([m['end'][0], 0, m['end'][1]]), np.array([m['dir'][0], 0, m['dir'][1]])) for m in info['mouths'] if m['route'] in JOINED]
    manifest['joined'] = JOINED
    for lod in [int(x) for x in arg('--lods', '0,1').split(',')]:
        baked = EG.build_lod(lod, src, hide_coll=coll, section=JG.SEC)
        EG.export_chunks(baked, keyfn, lambda k: RID, lod, OUT, 'ruien_%s_' % RID, manifest)
    # collision: construction surfaces as proxies (dome on a coarse grid, walls, shells, walkway tops and faces,
    # bed, stair parts) and the solid stone, brick and iron pieces as built
    cc = U.coll('EXPORT_COL')
    cobs = []
    for name, V, F in col:
        if len(F) == 0:
            continue
        cobs.append(U.mesh_from_faces('col_' + name, np.asarray(V), [list(f) for f in np.asarray(F)], coll_=cc, smooth=False))
    solid_names = ('_ring', '_impost_', '_jamb_', '_springer_', '_bearing_', '_transverse_', '_bridge_', '_crown_shaft_', '_coping_', '_copend_', '_seam_')
    cobs += EG.collision(cc, [o for o in src if any(k in o.name for k in solid_names)])
    # collision needs the shape, not the chips and grain: copies over 300 triangles are collapsed to a fifth
    for o in cobs:
        n = len(o.data.polygons)
        if n > 300 and not any(k in o.name for k in ('_ring', '_transverse')):   # arch soffits set the giant's head room: kept exact
            d_ = o.modifiers.new('d', 'DECIMATE'); d_.ratio = max(0.2, 60.0 / n)
            bpy.context.view_layer.objects.active = o
            me_ = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
            o.modifiers.clear(); old = o.data; o.data = me_; bpy.data.meshes.remove(old)
    cp = os.path.join(OUT, 'ruien_%s_collision.glb' % RID)
    EG.gltf_export(cp, cobs)
    manifest['files'][os.path.basename(cp)] = dict(sha256=EG.sha(cp), bytes=os.path.getsize(cp))
    manifest['markers'] = JG.markers(R, src, info)
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, default=lambda o: o.tolist() if hasattr(o, 'tolist') else float(o))
    log('exported', sum(sum(o['tris'] for o in f.get('objects', [])) for f in manifest['files'].values() if f.get('lod') == 0), 'LOD0 triangles')
