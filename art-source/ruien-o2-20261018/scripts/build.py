# Ruien O2 piece: builds ruien-o2.blend from nothing.
# Run: blender --background --factory-startup --python scripts/build.py
import bpy, sys, os, importlib, time
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import spec
from rlib import util as U, mats as M, mats2 as M2, gallery as G, gfeat as GF, vliet as V, hall as H, props as PR, debris as D, figures as FG, scene as SC, backdrop as BD, clutter as CL, stonework as SW, wax as WX
for mod in (spec, U, M, M2, G, GF, V, H, PR, D, FG, SC, BD, CL, SW, WX):
    importlib.reload(mod)

T0 = time.time()
def log(msg):
    print('[build %5.0fs] %s' % (time.time() - T0, msg), flush=True)

BLEND = os.path.join(ROOT, 'ruien-o2.blend')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND)
M.set_root(ROOT)
mats = M2.make_all()
log('materials')

root = U.coll('RUIEN_O2')
cV = U.coll('vliet_O2', root); cG = U.coll('gallery_giant_O2', root); cH = U.coll('hall_C2', root)
cS = U.coll('side_galleries', root); cP = U.coll('props_debris', root)
rend = U.coll('RENDER_ONLY')
cLm = U.coll('lights_mood', rend); cLc = U.coll('lights_check', rend); cF = U.coll('fog', rend)
cC = U.coll('cameras', rend); cFig = U.coll('scale_figures', rend); cB = U.coll('backdrop', rend)
cLib = U.coll('instance_sources', rend)
cLib.hide_render = True
cLib.hide_viewport = True
rng = np.random.default_rng(1873)

# shared instance meshes
straw_meshes = PR.straw_variants(mats['lime'], cLib)
flow_meshes = PR.flow_straw_variants(mats['calcite'], cLib)
drop = PR.drop_mesh(mats['water_film'], cLib)
brick_meshes = PR.brick_variants(mats['brick_loose'], cLib)
ring_meshes = []
for i in range(8):
    Vb, Fb = U.chipped_block(0.05, 0.09, 0.19, r=0.004, res=0.02, seed=5000 + i, chips=rng.integers(1, 4), chip_size=(0.008, 0.025))
    ob = U.mesh_from_faces('ringbrick_v%d' % i, Vb[:, [0, 1, 2]], Fb, uv=U.box_uv(Vb, Fb), game=False, coll_=cLib, mat=mats['brick_loose'])
    ring_meshes.append(ob.data)
log('instance sources')

# ------------------------------------------------------------------ vliet
vobs, bedfn = V.build(mats, cV, rng)
for o in vobs:
    if o.name.startswith('gate_') or o.name.startswith('pintle'):
        o.data.materials[0] = mats['bluestone_tidal'] if o.name.startswith('gate_') else o.data.materials[0]
log('vliet: %d objects' % len(vobs))

# ------------------------------------------------------------------ main gallery
g = G.Gallery('gal', spec.GAL_PATH_KEYS, mats, cG, u0=0.0, seed=3)
log('gallery path %.2f m, tightest radius %.2f m' % (g.path.length, g.path.min_radius))
GF.plan_features(g, rng)
GF.finalize_seeps(g)
g.build_shell(shell_u0=0.55)
SILL_U, RAMP_U = 1.6, 2.4
def bed_profile(U_):
    return np.interp(U_, [0, SILL_U, RAMP_U, 1e3], [spec.GATE_SILL_Y - 0.02, spec.GATE_SILL_Y - 0.02, spec.FLOOR_Y, spec.FLOOR_Y])
g.build_lower(bed_profile=bed_profile, ledge_u0=0.5, channel_u0=0.5)
g.build_coping(u_start=0.55)
GF.penstock(g, mats, cG)
GF.drains(g, mats, cG, rng, ring_meshes)
GF.pipes(g, mats, cG)
GF.shaft(g, mats, cG)
lamp_parts, gal_lamp_light, gal_lamp_hook = GF.lamp(g, mats, cG, power=110.0)
U.link(gal_lamp_light, cLm)
GF.rings(g, mats, cG, rng)
log('main gallery')

# ------------------------------------------------------------------ throats, end walls and side galleries
def annulus(name, path, u, hm, face_sign, c):
    """Brick end wall of a 6 m gallery round a smaller throat arch."""
    th = np.linspace(np.pi, 0, 90)
    rad = np.linspace(0, 1, 9)
    W2 = spec.GAL_W / 2
    a_in, b_in = hm, H.MOUTH_CROWN - H.MOUTH_SPRING
    a_out, b_out = W2 + 0.04, spec.GAL_RISE + 0.04
    pts = np.zeros((len(th), len(rad), 2))
    for i, t in enumerate(th):
        d = np.array([np.cos(t), np.sin(t)])
        # ray from the springing centre to each ellipse
        k_in = 1 / np.sqrt((d[0] / a_in) ** 2 + (d[1] / b_in) ** 2)
        k_out = 1 / np.sqrt((d[0] / a_out) ** 2 + (d[1] / b_out) ** 2)
        for j, r in enumerate(rad):
            k = k_in + (k_out - k_in) * r
            pts[i, j] = (d[0] * k, H.MOUTH_SPRING + d[1] * k)
    S_, Y_ = pts[..., 0], pts[..., 1]
    P = path.world(np.full(S_.shape, u), S_, Y_)
    UV = np.stack([S_, Y_], -1)
    A = np.zeros((*P.shape[:2], 4), np.float32); B = np.zeros((*P.shape[:2], 4), np.float32); B[..., 3] = 1
    A[..., 1] = 0.25; A[..., 0] = 0.3 * U.smoothstep(-2.5, -1.2, Y_)
    px, pz, tx, tz, nx, nz = path.frame(np.array(u))
    want = P[45, 4] + face_sign * np.array([float(tx), 0, float(tz)])
    obs = [U.grid_mesh(name, P, UV, attrs={'wxA': A, 'wxB': B}, flip=G.orient_check(P, want), coll_=c, mat=mats['brick_vault'])]
    # lower strips between the throat jambs and the gallery walls, ledge top to springing
    for side in (-1, 1):
        ss = side * np.linspace(hm, W2 + 0.04, 6)
        yy = np.linspace(spec.LEDGE_Y - 0.05, H.MOUTH_SPRING, 8)
        Ss, Yy = np.meshgrid(ss, yy, indexing='ij')
        P = path.world(np.full(Ss.shape, u), Ss, Yy)
        A = np.zeros((*P.shape[:2], 4), np.float32); B = np.zeros((*P.shape[:2], 4), np.float32); B[..., 3] = 1
        A[..., 2] = 0.4; A[..., 3] = 0.4
        want = P[2, 3] + face_sign * np.array([float(tx), 0, float(tz)])
        obs.append(U.grid_mesh(name + '_jamb', P, np.stack([Ss, Yy], -1), attrs={'wxA': A, 'wxB': B}, flip=G.orient_check(P, want), coll_=c, mat=mats['brick_vault']))
    for o in obs:
        U.add_adaptive(o)
    return obs

def throat(name, mouth, origin_xz, out_dir, c):
    tc, hm, a, b = H.mouth_geom(mouth)
    k0 = np.array(origin_xz, float)
    k1 = k0 + np.array(out_dir, float) * spec.HALL_WALL_T
    tg = G.Gallery(name, [tuple(k0), tuple(k1)], mats, c, u0=0.0, seed=hash(name) % 1000, profile=H.mouth_profile_fn(hm), hw=hm, du=0.1)
    tg.build_shell()
    tg.build_lower()
    tg.build_coping()
    return tg, hm

def side_gallery(name, start_xz, dir_xz, length, hm, c):
    k0 = np.array(start_xz, float)
    k1 = k0 + np.array(dir_xz, float) * length
    sg = G.Gallery(name, [tuple(k0), tuple(k1)], mats, c, u0=0.0, seed=hash(name) % 1000)
    sg.seeps = [(rng.uniform(0.5, length), sg.profile(0.06)[3] / 2 + rng.normal(0, 0.9), rng.uniform(0.3, 0.9)) for _ in range(8)]
    sg.build_shell()
    sg.build_lower()
    sg.build_coping()
    annulus(name + '_endwall', sg.path, 0.0, hm, +1, c)
    # far end: dark cap, lost in fog
    W2 = spec.GAL_W / 2
    Pc = sg.path.world(np.full((2, 2), length), np.array([[-W2 - 0.1, -W2 - 0.1], [W2 + 0.1, W2 + 0.1]]), np.array([[spec.FLOOR_Y - 0.2, spec.CROWN_Y + 0.2], [spec.FLOOR_Y - 0.2, spec.CROWN_Y + 0.2]]))
    U.grid_mesh(name + '_void', Pc, np.zeros((2, 2, 2)), coll_=c, mat=mats['soot_black'], smooth=False)
    GF.straws(sg, straw_meshes, drop, c, rng) if hasattr(sg, 'seeps') else None
    return sg

hall_mouth = H.mouth_geom('main')
annulus('gal_endwall', g.path, g.path.length, hall_mouth[1], -1, cG)
throat('throat_main', 'main', (g.path.P[-1, 0], g.path.P[-1, 1]), (0, 1), cH)
tc, hm, _, _ = H.mouth_geom('ne')
throat('throat_ne', 'ne', (spec.HALL_X1, tc), (1, 0), cS)
side_gallery('gal_ne', (spec.HALL_X1 + spec.HALL_WALL_T, tc), (1, 0), 8.0, hm, cS)
tc, hm, _, _ = H.mouth_geom('sw')
throat('throat_sw', 'sw', (spec.HALL_X0, tc), (-1, 0), cS)
side_gallery('gal_sw', (spec.HALL_X0 - spec.HALL_WALL_T, tc), (-1, 0), 8.0, hm, cS)
tc, hm, _, _ = H.mouth_geom('e')
throat('throat_e', 'e', (tc, spec.HALL_Z1), (0, 1), cS)
side_gallery('gal_e', (tc, spec.HALL_Z1 + spec.HALL_WALL_T), (0, 1), 8.0, hm, cS)
log('throats and side galleries')

# ------------------------------------------------------------------ hall
H.vault(mats, cH)
H.ribs(mats, cH)
H.walls(mats, cH)
H.piers(mats, cH, rng)
H.walkways(mats, cH, rng)
hall_floor, groundfn = H.floor(mats, cH, rng)
H.stair(mats, cH, rng)
H.air_shaft(mats, cH)
for m in H.MOUTHS:
    H.mouth_rings(m, mats, cH, rng, ring_meshes)
SW.wall_drains(mats, cH, rng)
SW.corbel_shelf(mats, cH, rng)
log('hall')
# hall straws: under the vault seeps and under the pier caps
# ------------------------------------------------------------------ debris, bones, weed
D.gallery_water_debris(g, mats, cP, rng)
D.bone_pile(mats, cP, rng, groundfn)
D.vliet_debris(mats, cP, rng, bedfn, brick_meshes)
D.wall_weed(mats, cP, rng)
# rubble on the hall walkways
pts = []
for (x0, x1, z0, z1, ws) in H.WALKS:
    for k in range(int((x1 - x0) * (z1 - z0) * 0.15)):
        pts.append((rng.uniform(x0 + 0.1, x1 - 0.1), spec.LEDGE_Y + 0.025, rng.uniform(z0 + 0.1, z1 - 0.1)))
PR.scatter_instances(brick_meshes, pts, rng, cP, 'hall_rubble', tilt=0.2)
CL.gallery_dressing(g, mats, cP, rng, brick_meshes, flow_meshes, drop)
CL.hall_dressing(mats, cP, rng, groundfn, brick_meshes, flow_meshes)
CL.vliet_dressing(mats, cP, rng, bedfn, brick_meshes)
WX.hall_wax(mats, cH, rng)
test_ob, test_mid, test_n = WX.test_curtain(mats, cH, rng)
CL.moss_tufts(g, mats, cP, rng)
WX.gallery_wax(g, mats, cG, rng)
log('debris')

# ------------------------------------------------------------------ street furniture and backdrop (render only)
post = U.lathe([(0.09, 0.0), (0.09, 0.25), (0.055, 0.32), (0.05, 2.6), (0.07, 2.65), (0.0, 2.66)], 16, 'street_lamp_post', cB, mats['iron'])
post.location = U.gv(-141.75, 0.0, 73.35)
lan = U.lathe([(0.0, 2.66), (0.13, 2.72), (0.17, 3.05), (0.2, 3.1), (0.06, 3.3), (0.0, 3.33)], 6, 'street_lamp_lantern', cB, mats['window'])
lan.location = post.location
PR.linear_falloff(SC.light('L_street_lamp', 'POINT', (-141.75, 2.95, 73.35), cLm, 60, color=(1.0, 0.62, 0.3), size=0.12).data)
BD.build(mats, cB, rng)

# ------------------------------------------------------------------ figures
man, man_lamp, man_light = FG.worker(mats, cFig)
U.link(man_light, cFig)
giant = FG.giant(mats, cFig)
log('figures')

# ------------------------------------------------------------------ lights (mood)
SC.world()
su = g.shaft_u
# daylight beams: small sources far above, so the grate and air-shaft bars cast crisp shadows in the haze
tilt = np.array([-0.2, -1.0, -0.1]); tilt /= np.linalg.norm(tilt)
gp_ = g.path.world(np.array(su), np.array(GF.SHAFT_S), np.array(0.0))
SC.light('L_grate_daylight', 'SPOT', tuple(gp_ - tilt * 30.0), cLm, 520000, color=(0.74, 0.82, 1.0), size=0.05, rot_to=tuple(gp_ + tilt * 4.0), spot_deg=3.2, blend=0.3)
ap_ = np.array([H.AIR[0], 0.0, H.AIR[1]])
SC.light('L_air_daylight', 'SPOT', tuple(ap_ - tilt * 30.0), cLm, 330000, color=(0.75, 0.82, 0.95), size=0.05, rot_to=tuple(ap_ + tilt * 4.0), spot_deg=2.6, blend=0.3)
SC.light('L_hatch_daylight', 'AREA', ((H.STAIR['x0'] + H.STAIR['x1']) / 2, 0.6, (H.STAIR['hatch_z0'] + H.STAIR['hatch_z1']) / 2), cLm, 1500, color=(0.78, 0.84, 0.95),
         size=(1.1, H.STAIR['hatch_z1'] - H.STAIR['hatch_z0']), rot_to=((H.STAIR['x0'] + H.STAIR['x1']) / 2, -3.0, (H.STAIR['hatch_z0'] + H.STAIR['hatch_z1']) / 2 - 0.6))

def wall_lamp(name, wall_pt, out_dir, power, c, length=0.32):
    parts, hook = PR.lamp_bracket(name + '_bracket', np.array(wall_pt), np.array(out_dir), length, mats['iron'], c)
    lo, ll = PR.safety_lamp(name, mats, c, light_power=power)
    lo.location = U.gv(*hook)
    lo.rotation_euler = (0.02, 0.03, rng.uniform(0, 6))
    U.link(ll, cLm)
    return lo, ll

def gallery_wall_lamp(name, gg, u, side, power):
    wy = -2.12
    ws = G.shell_s_at_y(wy)
    wall_pt = gg.path.world(np.array(u), np.array(side * ws), np.array(wy))
    inner = gg.path.world(np.array(u), np.array(side * (ws - 1.0)), np.array(wy))
    return wall_lamp(name, wall_pt, inner - wall_pt, power, cG, 0.34)

# lamps: stronger pools near, and distant ones so the depth glows
gallery_wall_lamp('gal_lamp_far1', g, 21.4, -1, 220.0)
gallery_wall_lamp('gal_lamp_far2', g, 34.6, 1, 200.0)
wall_lamp('hall_lamp_stair', (spec.HALL_X0, -2.6, 131.6), (1.0, 0, 0), 260.0, cH)
wall_lamp('hall_lamp_w1', (spec.HALL_X0, -2.9, 114.0), (1.0, 0, 0), 300.0, cH)
wall_lamp('hall_lamp_w2', (spec.HALL_X0, -2.9, 127.4), (1.0, 0, 0), 220.0, cH)
wall_lamp('hall_lamp_ne', (spec.HALL_X1, -2.9, 119.2), (-1.0, 0, 0), 300.0, cH)
wall_lamp('hall_lamp_e2', (spec.HALL_X1, -2.9, 133.6), (-1.0, 0, 0), 320.0, cH)
wall_lamp('hall_lamp_far_e', (-147.6, -2.9, spec.HALL_Z1), (0, 0, -1.0), 360.0, cH)
wall_lamp('hall_lamp_far_c', (-155.0, -2.9, spec.HALL_Z1), (0, 0, -1.0), 260.0, cH)
for (pos, tgt, en) in (((spec.HALL_X1 + 7.5, -1.6, 113.6), (spec.HALL_X1 + 1.0, -3.5, 113.6), 60), ((spec.HALL_X0 - 7.5, -1.6, 127.7), (spec.HALL_X0 - 1.0, -3.5, 127.7), 50),
                       ((-143.0, -1.6, spec.HALL_Z1 + 7.6), (-143.0, -3.5, spec.HALL_Z1 + 1.0), 60)):
    SC.light('L_opening_cool', 'SPOT', pos, cLm, en, color=(0.62, 0.72, 0.9), size=0.6, rot_to=tgt, spot_deg=70, blend=0.8)
wall_lamp('sidegal_lamp_e', (-143.0 + 2.95, -2.3, spec.HALL_Z1 + 1.2 + 6.5), (-1.0, 0, 0), 60.0, cS)
wall_lamp('sidegal_lamp_ne', (spec.HALL_X1 + 1.2 + 6.0, -2.3, 113.6 - 2.95), (0, 0, 1.0), 45.0, cS)
gal_lamp_light.data.energy = 260.0
# view-only lamps: the close-up and the crown study
PR.linear_falloff(SC.light('L_close_lantern', 'POINT', tuple(g.path.world(np.array(16.4), np.array(-0.7), np.array(-3.55))), cLm, 25, color=(1.0, 0.55, 0.25), size=0.02).data)
PR.linear_falloff(SC.light('L_crown_lantern', 'POINT', tuple(g.path.world(np.array(18.6), np.array(1.2), np.array(-1.6))), cLm, 30, color=(1.0, 0.6, 0.3), size=0.02).data)

# fog: rot mist hugging the water under a thin clear haze, and broken-up dust in the shafts
SC.fog_box('fog_volume', M.fog_rot('Fog_rot_mist'), cF, -178, -118, spec.FLOOR_Y, 24.0, 40, 150)
# town haze between the vliet and the house fronts: the houses become silhouettes in the dusk
SC.fog_box('fog_town', M.fog_beam('Fog_town', density=0.6), cF, -172, -120, -0.5, 30.0, 74.5, 87.5)
beam_m = M.fog_beam('Fog_beam', density=0.32)
sx_, sy_, sz_ = g.path.world(np.array(g.shaft_u), np.array(GF.SHAFT_S - 0.3), np.array(0.0))
SC.fog_box('fog_beam_grate', beam_m, cF, sx_ - 1.1, sx_ + 1.1, spec.WATER_Y, -0.3, sz_ - 1.1, sz_ + 1.1)
SC.fog_box('fog_beam_air', beam_m, cF, H.AIR[0] - 1.2, H.AIR[0] + 1.2, spec.WATER_Y, -0.3, H.AIR[1] - 1.2, H.AIR[1] + 1.2)
SC.fog_box('fog_beam_stair', M.fog_beam('Fog_stair', density=0.05), cF, spec.HALL_X0 + 0.02, spec.HALL_X0 + 2.6, spec.LEDGE_Y, -0.3, 132.0, spec.HALL_Z1 - 0.02)

# check lights: shadowless fill all along the spaces
for uu in np.arange(1.0, g.path.length, 3.0):
    SC.light('C_gal_%02d' % int(uu), 'POINT', tuple(g.path.world(np.array(uu), np.array(0.0), np.array(-2.1))), cLc, 45, size=0.3, shadow=False)
for x in np.arange(spec.HALL_X0 + 2, spec.HALL_X1, 4.0):
    for z in np.arange(spec.HALL_Z0 + 2, spec.HALL_Z1, 4.0):
        SC.light('C_hall', 'POINT', (x, -2.0, z), cLc, 55, size=0.3, shadow=False)
for (k0, d) in (((spec.HALL_X1 + 1.2, 113.6), (1, 0)), ((spec.HALL_X0 - 1.2, 127.7), (-1, 0)), ((-143.0, spec.HALL_Z1 + 1.2), (0, 1))):
    for t in (2.0, 5.5):
        SC.light('C_side', 'POINT', (k0[0] + d[0] * t, -2.0, k0[1] + d[1] * t), cLc, 45, size=0.3, shadow=False)
sun = bpy.data.lights.new('C_sun', 'SUN'); sun.energy = 2.5; sun.angle = np.radians(20)
so = bpy.data.objects.new('C_sun', sun); cLc.objects.link(so); so.rotation_euler = (np.radians(35), np.radians(-20), np.radians(160))
for x in np.arange(spec.VLIET_X0 + 1.0, spec.VLIET_X1, 3.0):
    for z in np.arange(spec.VLIET_Z0 + 2, spec.VLIET_Z1, 4.0):
        SC.light('C_vliet', 'POINT', (x, -2.0, z), cLc, 60, size=0.3, shadow=False)
log('lights')

# ------------------------------------------------------------------ cameras (views), with per-view figure placement and view-only lamps
def yaw(f):
    return float(np.degrees(np.arctan2(f[0], f[2])))
VIEW_ONLY = ['L_close_lantern', 'L_crown_lantern']
def cam(name, pos, target, lens, exposure, man_at=None, man_face=None, giant_at=None, giant_face=None, lamps_on=()):
    c = SC.camera(name, pos, target, lens, cC)
    c['exposure'] = exposure
    c['man'] = list(man_at) + [yaw(np.array(man_face) - np.array(man_at))] if man_at is not None else []
    c['giant'] = list(giant_at) + [yaw(np.array(giant_face) - np.array(giant_at))] if giant_at is not None else []
    c['lamps_on'] = list(lamps_on)
    c['view_only'] = VIEW_ONLY
    c['world'] = 2.5 if name == 'v1_outlet' else 0.0
    return c
p = g.path
bx, bz = -148.75, 61.0
cam('v1_outlet', (bx, bedfn(bx, bz) + 1.3, bz - 2.0), (spec.GATE_X + 0.3, -2.9, 72.0), 21, 2.8,
    man_at=(-148.85, bedfn(-148.85, 69.6) + 0.0, 69.6), man_face=(-146.5, 0, 66.0))
cam('v2_gate', p.world(np.array(0.95), np.array(-2.2), np.array(-1.95)), p.world(np.array(13.0), np.array(0.4), np.array(-2.95)), 18, 1.9,
    man_at=p.world(np.array(3.15), np.array(2.78), np.array(spec.LEDGE_Y)), man_face=p.world(np.array(3.0), np.array(2.2), np.array(spec.LEDGE_Y)),
    giant_at=p.world(np.array(31.0), np.array(0.1), np.array(spec.FLOOR_Y)), giant_face=p.world(np.array(20.0), np.array(0.0), np.array(spec.FLOOR_Y)))
cam('v3_shaft', p.world(np.array(su - 5.8), np.array(-2.35), np.array(-1.98)), p.world(np.array(su + 0.4), np.array(1.6), np.array(-2.45)), 24, 1.9,
    man_at=p.world(np.array(su + 2.7), np.array(2.25), np.array(spec.LEDGE_Y)), man_face=p.world(np.array(su - 3.0), np.array(0.3), np.array(spec.LEDGE_Y)),
    giant_at=p.world(np.array(su + 11.5), np.array(0.0), np.array(spec.FLOOR_Y)), giant_face=p.world(np.array(su), np.array(0.0), np.array(spec.FLOOR_Y)))
cam('v4_hall', (-157.9, -1.95, 111.35), (-143.2, -2.7, 133.5), 17, 2.7,
    man_at=(-152.75, spec.LEDGE_Y, 121.0), man_face=(-155.0, spec.LEDGE_Y, 114.0),
    giant_at=(-150.4, spec.FLOOR_Y, 122.4), giant_face=(-154.0, spec.FLOOR_Y, 114.0))
cam('v5_close', p.world(np.array(13.0), np.array(-0.35), np.array(-4.3)), p.world(np.array(14.7), np.array(-1.5), np.array(-4.35)), 28, 2.1, lamps_on=['L_close_lantern'])
cam('v6_stair', (-152.6, -1.95, 127.3), (-157.6, -2.3, 135.4), 19, 2.5,
    man_at=(-158.85, spec.LEDGE_Y, 132.35), man_face=(-156.6, spec.LEDGE_Y, 135.2))
cam('v7_crown', p.world(np.array(19.4), np.array(2.15), np.array(-2.05)), p.world(np.array(17.7), np.array(-0.1), np.array(-0.95)), 24, 2.0, lamps_on=['L_crown_lantern'])
cam('v8_curtain_test', tuple(test_mid + test_n * 2.0 + np.array([0.3, -0.2, 0.25])), tuple(test_mid), 35, 2.0)
bpy.context.scene.camera = bpy.data.objects['v1_outlet']
log('cameras')

# ------------------------------------------------------------------ export flags, render settings, save
for o in bpy.data.objects:
    if any(c.name in ('RENDER_ONLY',) or c in rend.children_recursive for c in o.users_collection):
        o['ruien_export'] = False
SC.render_settings()
bpy.ops.file.make_paths_relative()
bpy.ops.wm.save_as_mainfile(filepath=BLEND, compress=True)
log('saved %s' % BLEND)
