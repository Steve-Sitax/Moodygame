# Debris, bones and weed placed in chosen zones with seeded randomness.
import numpy as np
import bpy
import spec
from . import util as U
from . import props as PR

def gallery_water_debris(g, mats, c, rng):
    obs = []
    p = g.path
    for k in range(14):
        u = rng.uniform(2.0, g.u1 - 0.5)
        s = rng.uniform(-1.2, 1.2)
        pos = p.world(np.array(u), np.array(s), np.array(spec.WATER_Y - 0.01))
        o = PR.plank('float_plank_%d' % k, rng.uniform(0.4, 1.4), rng.uniform(0.08, 0.2), 0.025, mats['wood'], c, seed=k)
        o.location = U.gv(*pos)
        o.rotation_euler = (rng.normal(0, 0.05), rng.normal(0, 0.05), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(10):
        u = rng.uniform(2.0, g.u1 - 0.5)
        s = rng.choice([-1, 1]) * rng.uniform(0.6, 1.35)
        pos = p.world(np.array(u), np.array(s), np.array(spec.WATER_Y - 0.01))
        o = PR.branch('float_branch_%d' % k, mats['wood'], c, seed=40 + k, L=rng.uniform(0.6, 1.8))
        o.location = U.gv(*pos)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    pos = p.world(np.array(14.6), np.array(-1.05), np.array(spec.WATER_Y - 0.17))
    o = PR.stave_barrel('float_barrel', mats, c, seed=3, missing=2, split=4)
    o.location = U.gv(*pos)
    o.rotation_euler = (np.radians(78), 0.25, 0.75)
    obs.append(o)
    pos = p.world(np.array(27.0), np.array(0.9), np.array(spec.WATER_Y - 0.1))
    o = PR.crate('float_crate', mats, c, seed=5, broken=0.45)
    o.location = U.gv(*pos)
    o.rotation_euler = (0.3, 0.15, 0.5)
    obs.append(o)
    for k in range(4):
        u = rng.uniform(2.0, g.u1 - 0.5)
        s = rng.choice([-1, 1]) * rng.uniform(0.9, 1.4)
        pos = p.world(np.array(u), np.array(s), np.array(spec.WATER_Y - 0.03))
        o = PR.sack('rag_%d' % k, mats['sack'], c, seed=60 + k, size=(rng.uniform(0.2, 0.5), 0.1, rng.uniform(0.15, 0.3)), tied=False)
        o.location = U.gv(*pos)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    return obs

def bone_pile(mats, c, rng, groundfn, centre=(-156.6, 135.6), spread=(1.5, 1.8)):
    obs = []
    cx, cz = centre
    def spot(r=1.0):
        while True:
            x = cx + rng.normal(0, spread[0] * 0.5 * r)
            z = cz + rng.normal(0, spread[1] * 0.5 * r)
            if x > spec.HALL_X0 + 1.25 and z < spec.HALL_Z1 - 0.1:
                return x, z
    for k in range(34):
        x, z = spot()
        o = PR.bone_femur('bone_%d' % k, mats['bone'], c, seed=k, L=rng.uniform(0.28, 0.46))
        o.location = U.gv(x, groundfn(x, z) - 0.01, z)
        o.rotation_euler = (np.radians(90) + rng.normal(0, 0.25), rng.normal(0, 0.3), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(18):
        x, z = spot()
        o = PR.rib('rib_%d' % k, mats['bone'], c, seed=k)
        o.location = U.gv(x, groundfn(x, z) + 0.01, z)
        o.rotation_euler = (rng.normal(0, 0.3), rng.normal(0, 0.3), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(5):
        x, z = spot(0.7)
        o = PR.cow_skull('skull_%d' % k, mats['bone'], c, seed=k) if k < 3 else PR.skull('skull_%d' % k, mats['bone'], c, seed=k, kind='pig')
        o.location = U.gv(x, groundfn(x, z) + 0.04, z)
        o.rotation_euler = (rng.normal(0, 0.4), rng.normal(0, 0.4), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(14):
        x, z = spot(0.9)
        o = PR.vertebra('vertebra_%d' % k, mats['bone'], c, seed=k)
        o.location = U.gv(x, groundfn(x, z) + 0.02, z)
        o.rotation_euler = (rng.normal(0, 0.8), rng.normal(0, 0.8), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(4):
        x, z = spot(0.8)
        o = PR.mandible('jaw_%d' % k, mats['bone'], c, seed=k)
        o.location = U.gv(x, groundfn(x, z) + 0.015, z)
        o.rotation_euler = (rng.normal(0, 0.2), rng.normal(0, 0.2), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(6):
        x, z = spot(0.8)
        o = PR.sack('offal_sack_%d' % k, mats['sack'], c, seed=100 + k, size=(rng.uniform(0.55, 0.8), 0.32, rng.uniform(0.35, 0.5)))
        o.location = U.gv(x, groundfn(x, z) + 0.1, z)
        o.rotation_euler = (rng.normal(0, 0.15), rng.normal(0, 0.15), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(4):
        x, z = spot(0.6)
        o = PR.sack('offal_%d' % k, mats['offal'], c, seed=200 + k, size=(rng.uniform(0.08, 0.25), 0.06, rng.uniform(0.06, 0.18)), tied=False)
        o.location = U.gv(x, groundfn(x, z) + 0.01, z)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(3):
        x, z = spot(0.9)
        o = PR.crate('bone_crate_%d' % k, mats, c, seed=20 + k, broken=0.5)
        o.location = U.gv(x, groundfn(x, z) + 0.15, z)
        o.rotation_euler = (rng.normal(0, 0.3), rng.normal(0, 0.3), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(6):
        x, z = spot(1.2)
        o = PR.plank('bone_plank_%d' % k, rng.uniform(0.5, 1.2), 0.12, 0.025, mats['wood'], c, seed=300 + k)
        o.location = U.gv(x, groundfn(x, z) + 0.02, z)
        o.rotation_euler = (rng.normal(0, 0.2), rng.normal(0, 0.2), rng.uniform(0, 6.28))
        obs.append(o)
    return obs

def vliet_debris(mats, c, rng, bedfn, brick_meshes):
    obs = []
    X0, X1 = spec.VLIET_X0, spec.VLIET_X1
    pts = []
    for k in range(6):
        x = rng.uniform(X0 + 0.15, X1 - 0.15)
        z = rng.uniform(spec.VLIET_Z0, spec.VLIET_Z1 - 4.0)
        pts.append((x, bedfn(x, z) + 0.01, z))
    obs += PR.scatter_instances(brick_meshes, pts, rng, c, 'vliet_brick', tilt=0.5)
    o = PR.stave_barrel('vliet_barrel2', mats, c, seed=21, missing=3, split=6)
    x, z = X1 - 1.3, spec.VLIET_Z1 - 12.0
    o.location = U.gv(x, bedfn(x, z) + 0.05, z)
    o.rotation_euler = (np.radians(70), 0.4, 1.9)
    obs.append(o)
    for k in range(9):
        x = rng.uniform(X0 + 0.3, X1 - 0.3)
        z = rng.uniform(spec.VLIET_Z0 + 2, spec.VLIET_Z1 - 4.5)
        o = PR.plank('vliet_plank_%d' % k, rng.uniform(0.5, 1.6), rng.uniform(0.1, 0.22), 0.03, mats['wood'], c, seed=500 + k)
        o.location = U.gv(x, bedfn(x, z) + 0.02, z)
        o.rotation_euler = (rng.normal(0, 0.1), rng.normal(0, 0.1), rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(6):
        x = rng.uniform(X0 + 0.3, X1 - 0.3)
        z = rng.uniform(spec.VLIET_Z0 + 2, spec.VLIET_Z1 - 4.5)
        o = PR.branch('vliet_branch_%d' % k, mats['wood'], c, seed=520 + k, L=rng.uniform(0.8, 2.2), r=0.035)
        o.location = U.gv(x, bedfn(x, z) + 0.03, z)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    o = PR.stave_barrel('vliet_barrel', mats, c, seed=9, missing=2, split=5)
    x, z = X0 + 1.1, spec.VLIET_Z1 - 7.5
    o.location = U.gv(x, bedfn(x, z) + 0.12, z)
    o.rotation_euler = (np.radians(84), 0.2, 2.2)
    obs.append(o)
    o = PR.crate('vliet_crate', mats, c, seed=11, broken=0.55)
    x, z = X1 - 1.0, spec.VLIET_Z1 - 9.0
    o.location = U.gv(x, bedfn(x, z) + 0.12, z)
    o.rotation_euler = (0.25, 0.1, 0.9)
    obs.append(o)
    for k in range(6):
        x = rng.uniform(X0 + 0.2, X1 - 0.2)
        z = rng.uniform(spec.VLIET_Z0, spec.VLIET_Z1 - 4)
        o = PR.sack('weedpile_%d' % k, mats['weed'], c, seed=700 + k, size=(rng.uniform(0.2, 0.6), 0.06, rng.uniform(0.15, 0.4)), tied=False)
        o.location = U.gv(x, bedfn(x, z), z)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    for k in range(5):
        x = rng.uniform(X0 + 0.5, X1 - 0.5)
        z = rng.uniform(spec.VLIET_Z0 + 2, spec.VLIET_Z1 - 5)
        o = PR.long_bone('vliet_bone_%d' % k, mats['bone'], c, seed=800 + k, L=rng.uniform(0.25, 0.45))
        o.location = U.gv(x, bedfn(x, z) + 0.01, z)
        o.rotation_euler = (np.radians(90), 0, rng.uniform(0, 6.28))
        obs.append(o)
    return obs

def wall_weed(mats, c, rng):
    """Weed strands in the tidal band of the quay walls and the head wall."""
    pts, nrm = [], []
    X0, X1, ZF = spec.VLIET_X0, spec.VLIET_X1, spec.VLIET_Z1
    for k in range(4200):
        wall = rng.random()
        y = -0.68 - abs(rng.normal(0, 1.1)) * rng.uniform(0.3, 1.0)
        if y < -4.6:
            continue
        if wall < 0.42:
            pts.append((X0 + 0.005, y, rng.uniform(spec.VLIET_Z0, ZF)))
            nrm.append((1.0, 0, 0))
        elif wall < 0.84:
            pts.append((X1 - 0.005, y, rng.uniform(spec.VLIET_Z0, ZF)))
            nrm.append((-1.0, 0, 0))
        else:
            x = rng.uniform(X0, X1)
            if abs(x - spec.GATE_X) < spec.GAL_W / 2 + 0.55 and y > spec.GATE_SILL_Y:
                continue
            pts.append((x, y, ZF - 0.005))
            nrm.append((0, 0, -1.0))
    ob = PR.weed_ribbons('vliet_weed', np.array(pts), np.array(nrm), mats['weed'], c, rng, length=(0.12, 0.6), width=(0.012, 0.04))
    return [ob]
