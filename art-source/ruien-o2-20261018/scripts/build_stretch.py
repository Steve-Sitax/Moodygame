# Build one route of the Ruien network from docs/plans/ruien/ruien-routes.json with the kit generators,
# render a check picture, and export it with the same pipeline as O2 (baked relief, masks, LODs, GLB).
# Run: blender --background --factory-startup --python scripts/build_stretch.py -- --route L105 --out export/stretches/L105
#      [--walkway 1|-1] [--walkways L79=1,L105=-1] [--start auto|tee|through|junction|open|cap] [--end ...]
#      [--clip a,b] [--lods 0,1] [--no-export] [--no-render] [--no-fittings]
# 'auto' (default) finds the end from the plan: 'tee' where a rui ends in a gallery's side (kit/meet.py), 'through'
# where the same section runs on, else 'open'. A gallery always cuts the openings of the ruien that end in its side.
# --clip a,b keeps only the route between a and b metres along it (proof pieces); a clipped end is 'open'.
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
from kit import sweep as KS, meet as KM
M.set_root(ROOT)
routes = json.load(open(os.path.join(REPO, 'docs', 'plans', 'ruien', 'ruien-routes.json')))
R_ALL = routes['routes']
r = R_ALL[RID]
cls = r['class']
WALKWAYS = {k: int(v) for k, v in (kv.split('=') for kv in arg('--walkways', '').split(',') if kv)}
WALKWAYS[RID] = int(arg('--walkway', str(WALKWAYS.get(RID, 1))))
def section_of(rid):
    return KS.Section(R_ALL[rid]['class'], WALKWAYS.get(rid, 1))
def path_of(rid):
    # the route being built uses its clipped points; a tee or throat only reads the other routes at the node
    return KS.RoutePath(pts if rid == RID else R_ALL[rid]['pts'], r=section_of(rid).W * 1.2)
def clip_pts(P, a, b):
    P = np.asarray(P, float); L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
    a, b = max(a, 0.0), min(b, L[-1])
    inner = [tuple(p) for p, l in zip(P, L) if a < l < b]
    at = lambda d: tuple(np.array([np.interp(d, L, P[:, 0]), np.interp(d, L, P[:, 1])]))
    return [at(a)] + inner + [at(b)]
full_pts = [tuple(p) for p in r['pts']]
CLIP = [float(x) for x in arg('--clip', '').split(',')] if arg('--clip') else None
pts = clip_pts(full_pts, *CLIP) if CLIP else full_pts
TEES = KM.find_tees(R_ALL, RID, path_of, section_of) + KM.find_throats(R_ALL, RID, path_of, section_of)
# a gallery that ends in a throat runs on past the node, so the wall plane square to the rui cuts it everywhere
for t in TEES:
    if isinstance(t, KM.Throat) and RID in t.host_ids:
        P = np.asarray(pts, float)
        if np.linalg.norm(P[-1] - t.O) < 0.3:
            pts = pts + [tuple(P[-1] + (P[-1] - P[-2]) / np.linalg.norm(P[-1] - P[-2]) * t.EXTEND)]
        elif np.linalg.norm(P[0] - t.O) < 0.3:
            pts = [tuple(P[0] + (P[0] - P[1]) / np.linalg.norm(P[0] - P[1]) * t.EXTEND)] + pts
def end_kind(which, asked):
    if asked != 'auto':
        return asked
    full_len = float(np.sum(np.linalg.norm(np.diff(np.array(full_pts), axis=0), axis=1)))
    if CLIP and ((which == 'start' and CLIP[0] > 1e-6) or (which == 'end' and min(CLIP[1], full_len) < full_len - 1e-3)):
        return 'open'
    p = full_pts[0] if which == 'start' else full_pts[-1]
    if any(t.branch_id == RID and t.which == which for t in TEES):
        return 'tee'
    if any(isinstance(t, KM.Throat) and RID in t.host_ids and np.linalg.norm(np.asarray(p) - t.O) < 0.3 for t in TEES):
        return 'reducer'
    for rid2, r2 in R_ALL.items():
        if rid2 == RID or r2['class'] != cls:
            continue
        for k in (0, -1):
            if np.linalg.norm(np.array(r2['pts'][k]) - np.array(p)) < 0.3:
                mine = np.array(full_pts[1] if which == 'start' else full_pts[-2]) - np.array(p)
                theirs = np.array(r2['pts'][1] if k == 0 else r2['pts'][-2]) - np.array(p)
                if np.dot(mine, theirs) < -0.94 * np.linalg.norm(mine) * np.linalg.norm(theirs):
                    return 'through'
    return 'open'
START, END = end_kind('start', arg('--start', 'auto')), end_kind('end', arg('--end', 'auto'))
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
# R2 rail and R3 drain crossings (kit/rail.py, kit/drain_crossing.py; numbers in kit/fittings.json)
from kit import fitlib as FL, rail as KR, drain_crossing as KD
FIT = FL.data(cls) if '--no-fittings' not in argv else {}
sec0 = section_of(RID)
path0 = KS.RoutePath(pts, r=sec0.W * 1.2)
shafts0 = [float(np.clip(path0.u_near(gx, gz)[0], 1.2, path0.length - 0.8)) for (gx, gz) in grates if path0.u_near(gx, gz)[1] < 4.0]
# junction zones along this route, as sweep.build_stretch keeps them clear (kit/meet.py)
zones0 = [t.keep_out() for t in TEES if getattr(t, 'bpath', None) is not None and t.branch_id == RID] +          [t.host_zone(path0)[1] for t in TEES if t.branch_id != RID and path0.u_near(*t.O)[1] < 0.3]
drains = KD.find(routes, path0, sec0, shafts0, FIT['drainCrossing'], log=log, zones=zones0) if FIT.get('drainCrossing') else []
# a plan lamp never hangs on a drain's header rings: move it along the wall
for i, (lx, lz) in enumerate(lamps):
    lu, _ = path0.u_near(lx, lz)
    for d in drains:
        if d['side'] == sec0.sides[0] and abs(lu - d['u']) < 1.0:
            nu = float(np.clip(d['u'] + (1.0 if lu >= d['u'] else -1.0), 0.5, path0.length - 0.5))
            q = path0.world(np.array(nu), np.array(0.0), np.array(0.0))
            lamps[i] = (float(q[0]), float(q[2])); log('lamp at u %.1f moved to %.1f, clear of a drain' % (lu, nu))
log('ends', START, END, 'tees', [(t.branch_id, t.which, t.host_ids) for t in TEES])
objs, info, g, sec = KS.build_stretch(RID, pts, cls, mats, coll, grates=grates, lamps=lamps, start=START, end=END,
                                      walkway_side=WALKWAYS[RID], tees=TEES)
cFitCol = U.coll('FITTINGS_COLLISION'); cFitCol.hide_render = True
fit_proxies = []
if drains:
    o_, p_ = KD.build(g, sec, mats, coll, drains, FIT['drainCrossing'], np.random.default_rng(KS.seed_of(RID, 71)), cFitCol, log=log)
    fit_proxies += p_
    for d in drains:
        info['placements'].append(dict(piece='drain_' + d['kind'], u=d['u'], side=d['side'], pos=d['pos'], plan=d['plan']))
if FIT.get('rail'):
    # at a tee the rail runs on to its dressed end post 0.4 m before the ring face (keep_out pads 1 m beyond it)
    rail_zones = [((t.L - float(t.q_wall(0.0)) - 0.05, t.L + 1.0) if t.which == 'end' else (-1.0, float(t.q_wall(0.0)) + 0.05))
                  for t in TEES if getattr(t, 'bpath', None) is not None and t.branch_id == RID] +                  [t.host_zone(g.path)[1] for t in TEES if t.branch_id != RID and g.path.u_near(*t.O)[1] < 0.3]
    o_, p_ = KR.build(g, sec, mats, coll, info, drains, FIT['rail'], np.random.default_rng(KS.seed_of(RID, 73)), cFitCol, log=log,
                      ends=(START, END), zones=rail_zones)
    fit_proxies += p_
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
    def keyfn(Cg):
        return EG.area_keys(Cg, path)
    manifest = dict(route=RID, name=r.get('name'), cls=cls, built_with='scripts/build_stretch.py + scripts/kit/sweep.py', files={}, info=info, waterMin=sec.water, movers=EG.prepare_movers(sec),
                    coordinates='glTF +Y up; glTF (x, y, z) = (game x, game y, game z)', textures='shared: ../../textures (see ../../manifest.json)')
    stretch_objs = [o for o in coll.all_objects if o.type == 'MESH']
    EG.SEAMS[:] = [(np.array([s['pos'][0], 0, s['pos'][2]]), np.array([s['tangent'][0], 0, s['tangent'][1]])) for s in info.get('seams', [])]
    # Native paving must follow the actual swept path, including its bends and walkway side.
    manifest['surfaceLayout'] = dict(path=np.concatenate([path.P[:-1:20], path.P[-1:]]).tolist(), walkwaySide=sec.sides[0] if cls == 'M' else 0)
    for lod in [int(x) for x in arg('--lods', '0,1').split(',')]:
        baked = EG.build_lod(lod, stretch_objs, hide_coll=coll, section=sec)
        EG.export_chunks(baked, keyfn, lambda k: RID, lod, OUT, 'ruien_%s_' % RID, manifest)
    cc = U.coll('EXPORT_COL')
    # thin ironwork, header bricks and stains carry no collision; the rail and the grate collide as their proxies
    cobs = EG.collision(cc, [o for o in stretch_objs if o.get('ruien_collision', True)]) + fit_proxies
    cp = os.path.join(OUT, 'ruien_%s_collision.glb' % RID)
    EG.gltf_export(cp, cobs)
    manifest['files'][os.path.basename(cp)] = dict(sha256=EG.sha(cp), bytes=os.path.getsize(cp))
    manifest['markers'] = EG.markers(U.coll('EXPORT_MK'), stretch_objs, path, sec, info)
    # a tee mouth cuts the gallery ledge: the branch places the folding footbridge over its culvert (kit/fold_bridge.py)
    from kit import fold_bridge as FB
    manifest['markers']['bridges'] = [FB.for_tee(t, RID) for t in TEES if type(t) is KM.Tee and t.branch_id == RID]
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1, default=lambda o: o.tolist() if hasattr(o, 'tolist') else float(o))
    log('exported')
