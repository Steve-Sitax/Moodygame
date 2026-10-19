# Ruien kit pieces: each reusable object as its own GLB with its own pivot, through the same pipeline as O2
# (baked relief, vertex masks, AO, family materials). Pieces come from the O2 scene (fixed models) or from the
# parametric builders (curtains, rubble, debris). One model per object: the game instances these everywhere.
# Run: blender --background ruien-o2.blend --python scripts/kit_export.py
import bpy, sys, os, json
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import spec
import export_game as EG
from rlib import util as U, wax as WX, props as PR, clutter as CL, gallery as G, gfeat as GF, hall as H, mats as M
OUT = os.path.join(ROOT, 'export', 'kit')
os.makedirs(OUT, exist_ok=True)
M.set_root(ROOT)
sc = bpy.context.scene
mats = {k: bpy.data.materials.get(v) for k, v in dict(calcite='Calcite_flowstone', brick_loose='Brick_loose', wood_wet='Wood_wet_oak', sack='Sacking',
                                                      straw='Straw_wet', cork='Cork', iron_rust='Iron_rust').items()}
PATH = G.Path(spec.GAL_PATH_KEYS)
src = bpy.data.collections['RUIEN_O2']

def by_prefix(*pre, skip=('door_raft',)):
    return [o for o in src.all_objects if o.type == 'MESH' and o.name.startswith(pre) and not o.name.startswith(skip)]

def Vg(p):
    return np.array([p.x, p.z, -p.y])

def bbox_centre(obs):
    pts = np.array([Vg(o.matrix_world @ __import__('mathutils').Vector(c)) for o in obs for c in o.bound_box])
    return (pts.min(0) + pts.max(0)) / 2

def bbox_bottom(obs):
    pts = np.array([Vg(o.matrix_world @ __import__('mathutils').Vector(c)) for o in obs for c in o.bound_box])
    c = (pts.min(0) + pts.max(0)) / 2
    return np.array([c[0], pts[:, 1].min(), c[2]])

EG.setup_render()
kit = dict(about='Ruien kit pieces. Pivot = local origin; axes as glTF (+Y up). Pieces taken from O2 keep their O2 orientation '
                 '(see "facing"); parametric pieces face +z with their wall plane at z = 0.', pieces={})

def export_piece(name, obs, pivot, facing, note, hide=None, lods=(0, 1)):
    if not obs:
        print('[kit] no objects for', name); return
    man = dict(files={})
    for lod in lods:
        baked = EG.build_lod(lod, obs, hide_coll=hide or src)
        EG.export_chunks(baked, lambda C, n=name: np.full(len(C), n, dtype=object), lambda k: k, lod, OUT, 'kit_', man, offset=pivot)
    for c in bpy.data.collections:
        if c.name.startswith('EXPORT_'):
            c.hide_render = True
    tris = {f: sum(o['tris'] for o in v['objects']) for f, v in man['files'].items()}
    kit['pieces'][name] = dict(files={f: dict(sha256=v['sha256'], tris=tris[f]) for f, v in man['files'].items()},
                               pivot_in_o2=[round(float(x), 3) for x in pivot], facing=facing, note=note, source_objects=len(obs))
    print('[kit] %-24s %s' % (name, tris), flush=True)

# ----------------------------------------------------------------- fixed pieces from the O2 scene
su = PATH.u_at_z(GF.SHAFT_Z)
lb = PATH.world(np.array(su), np.array(GF.SHAFT_S + GF.SHAFT_H - 0.14), np.array(spec.LEDGE_Y))
export_piece('grate_shaft_giant', by_prefix('shaft_wall', 'grate_', 'shaft_street', 'step_iron', 'ladder_'), lb, 'O2 gallery at z 92.5',
             'shaft 0.66 m square from the giant-gallery vault to the street grate, step irons, ladder to a ledge at -3.6. Pivot: ladder foot. '
             'For other sections use the parametric shaft in kit/sweep.py (grate_shaft).')
n_r = 19; z_top = spec.HALL_Z1 - 0.28; z_bot = z_top - (n_r - 1) * 0.27
export_piece('stair_down', by_prefix('stair_', 'stairwell_', 'hatch_leaf_'), ((H.STAIR['x0'] + H.STAIR['x1']) / 2, spec.LEDGE_Y, z_bot - 0.3),
             'climbs toward +z', '19 bluestone treads from a walkway at -3.6 to a street hatch at 0, iron handrail, stairwell walls, open hatch. Pivot: foot of the stair.')
du, dside = GF.DRAINS[0]
dp = PATH.world(np.array(du), np.array(dside * spec.GAL_W / 2), np.array(GF.DRAIN_YB))
export_piece('drain_mouth_egg', by_prefix('drain_0_'), dp, 'O2 gallery south wall', 'egg drain 1.0 x 1.6 m, brick lining 4.6 m deep, two header rings, trickle. Pivot: invert at the wall face.')
pu, pside, py = GF.PIPES[0]
pp = PATH.world(np.array(pu), np.array(pside * 2.8), np.array(py))
export_piece('pipe_end', [o for o in by_prefix('pipe_') if np.linalg.norm(bbox_centre([o]) - pp) < 1.2], pp, 'O2 gallery north wall', 'cast-iron pipe end with socket, trickle. Pivot: socket mouth.')
wy = -2.12; ws = G.shell_s_at_y(wy)
lw = PATH.world(np.array(GF.LAMP_U), np.array(ws), np.array(wy))
export_piece('lamp_bracket_safety_lamp', by_prefix('lamp_bracket', 'gallery_lamp'), lw, 'arm points away from the wall', 'wrought-iron bracket and brass safety lamp. Pivot: wall plate. Light: see markers (warm, about 150 W).')
gate = (spec.GATE_X, spec.GATE_SILL_Y, spec.VLIET_Z1)
export_piece('tide_doors', by_prefix('door_', 'pintle_'), gate, 'river face toward -z', 'two oak tide leaves with straps, rivets, pintles; north leaf 40, south 33 degrees open. Pivot: sill centre.')
export_piece('gate_dressing', by_prefix('gate_'), gate, 'river face toward -z', 'bluestone voussoirs, jambs, sill and apron of a 6 m outlet arch. Pivot: sill centre.')
export_piece('penstock_gear', by_prefix('penstock_'), PATH.world(np.array(GF.PENSTOCK_U), np.array(0.0), np.array(spec.LEDGE_Y)), 'across the giant gallery',
             'cast-iron penstock door, guides, racks, headstock, gears, crank. Pivot: channel centre at ledge height.')
export_piece('mooring_ring', by_prefix('mooring_ring_0'), bbox_centre(by_prefix('mooring_ring_0')), 'ring hangs toward -s', 'iron ring on a staple. Pivot: centre.')
export_piece('wall_ring_chain', by_prefix('wall_ring_0'), bbox_centre(by_prefix('wall_ring_0')), 'ring hangs from the wall', 'rusted ring with a chain stub. Pivot: centre.')
cs = by_prefix('pier_corbel_shelf', 'shelf_bottle')
export_piece('corbel_shelf', cs, bbox_bottom(cs), 'shelf projects toward -x', 'bluestone corbel shelf with a bottle. Pivot: underside centre.')
bp = by_prefix('bone_', 'rib_', 'skull_', 'vertebra_', 'jaw_', 'offal', 'bone_crate', 'bone_plank')
export_piece('bone_pile', bp, bbox_bottom(bp), 'any', 'cattle and pig bones, skulls, offal sacks, broken crates. Pivot: ground centre.')
# ----------------------------------------------------------------- parametric pieces
def fresh(name):
    c = bpy.data.collections.new('KITGEN_' + name); sc.collection.children.link(c); return c
for size, (W0, L) in dict(small=(0.4, 0.8), medium=(0.75, 1.6), large=(1.0, 2.6)).items():
    c = fresh('calcite_' + size)
    WX.DEPOSITS.clear()
    ob = WX.wax_curtain('kit_calcite_' + size, WX.host_plane((0, 0, 0), (0, -1, 0), (1, 0, 0), (0, 0, 1)), W0, L, mats, c, np.random.default_rng(len(size) * 7),
                        T=0.03 + 0.08 * W0)
    export_piece('calcite_curtain_' + size, [ob], (0.0, 0.0, 0.0), 'wall plane z = 0, sheet toward +z', 'poured-wax flowstone curtain %.2f x %.1f m from wax.wax_curtain. Pivot: leak point at the top.' % (W0, L), hide=c)
    c.hide_render = True
c = fresh('rubble'); rng = np.random.default_rng(5)
meshes = PR.brick_variants(mats['brick_loose'], c, n=16, seed=99)
pts = [(rng.normal(0, 0.35), 0.0, rng.normal(0, 0.35)) for _ in range(70)]
pts = [(x, 0.03 + 0.25 * np.exp(-(x * x + z * z) / 0.15) * rng.uniform(0.5, 1.0), z) for (x, _, z) in pts]
rob = PR.scatter_instances(meshes, pts, rng, c, 'kit_rubble', tilt=0.6)
export_piece('rubble_pile', rob, (0.0, 0.0, 0.0), 'any', 'heap of broken bricks, about 1.2 m across. Pivot: ground centre.', hide=c)
c.hide_render = True
c = fresh('debris'); rng = np.random.default_rng(8)
mm = dict(mats); mm['wood_wet'] = mats['wood_wet']
dob = CL.raft('kit_debris', (0.0, 0.0), mm, c, rng, n=14, spread=(1.0, 0.7), y=0.0)
export_piece('floating_debris', dob, (0.0, 0.0, 0.0), 'any', 'planks, sticks, rags, straw and corks for a water surface or an eddy. Pivot: water level centre.', hide=c)
json.dump(kit, open(os.path.join(OUT, 'kit.json'), 'w'), indent=1)
print('[kit] done', len(kit['pieces']), 'pieces')
