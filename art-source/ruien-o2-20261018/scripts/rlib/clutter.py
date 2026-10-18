# Round 2 dressing: lodged rubbish, rope, baskets, rats, corks, straw, chained rings,
# fallen fragments below damage, drip rings, flowstone rows along crown joints.
import numpy as np
import bpy
import spec
from . import util as U
from . import props as PR
from . import gallery as G
from . import hall as H

W = spec.WATER_Y

def _place(ob, pos, rng, tilt=0.15, yaw=None):
    ob.location = U.gv(*pos)
    ob.rotation_euler = (rng.normal(0, tilt), rng.normal(0, tilt), rng.uniform(0, 6.28) if yaw is None else yaw)
    return ob

def raft(name, centre, mats, c, rng, n=10, spread=(0.6, 0.35), y=W - 0.015):
    """A drift of rubbish caught against something: planks, sticks, rags, straw, corks."""
    obs = []
    cx, cz = centre
    for k in range(n):
        x = cx + rng.normal(0, spread[0] * 0.5)
        z = cz + rng.normal(0, spread[1] * 0.5)
        roll = rng.random()
        if roll < 0.3:
            o = PR.plank('%s_plank_%d' % (name, k), rng.uniform(0.3, 1.0), rng.uniform(0.06, 0.16), 0.025, mats['wood_wet'], c, seed=rng.integers(1e6))
        elif roll < 0.55:
            o = PR.branch('%s_stick_%d' % (name, k), mats['wood_wet'], c, seed=rng.integers(1e6), L=rng.uniform(0.3, 1.1), r=0.015)
        elif roll < 0.75:
            o = PR.sack('%s_rag_%d' % (name, k), mats['sack'], c, seed=rng.integers(1e6), size=(rng.uniform(0.15, 0.4), 0.06, rng.uniform(0.12, 0.3)), tied=False)
        elif roll < 0.9:
            o = PR.straw_tuft('%s_straw_%d' % (name, k), mats['straw'], c, seed=rng.integers(1e6), n=20, L=0.22)
        else:
            o = PR.cork('%s_cork_%d' % (name, k), mats['cork'], c)
        obs.append(_place(o, (x, y, z), rng, tilt=0.08))
    return obs

def fragments(name, pts, brick_meshes, c, rng, scale=(0.45, 1.0)):
    return PR.scatter_instances(brick_meshes, pts, rng, c, name, tilt=0.5, scale=scale)

def gallery_dressing(g, mats, c, rng, brick_meshes, flow_meshes, drop):
    p = g.path
    obs = []
    s_p, y_p, v_p, vtot = G.shell_profile(g.dv)
    vc = vtot / 2
    # fallen fragments under every damage cluster
    for (du, dv, dr, da) in g.damage:
        side = 1 if dv > vc else -1
        pts = []
        for k in range(rng.integers(3, 7)):
            uu = du + rng.normal(0, dr * 0.7)
            ss = side * (spec.GAL_W / 2 - abs(rng.normal(0.12, 0.2)))
            pts.append(p.world(np.array(uu), np.array(ss), np.array(spec.LEDGE_Y + 0.02)))
        obs += fragments('gal_fallen', pts, brick_meshes, c, rng)
    for (du, side, dy, dr, da) in g.cdamage:
        pts = []
        for k in range(rng.integers(5, 11)):
            uu = du + rng.normal(0, dr * 0.8)
            ss = side * rng.uniform(1.18, 1.46)
            pts.append(p.world(np.array(uu), np.array(ss), np.array(W - rng.uniform(0.0, 0.06))))
        obs += fragments('chan_fallen', pts, brick_meshes, c, rng)
    # rubbish lodged against the inside of the gate sill and on the inside of the bend
    for k, (uu, ss) in enumerate(((1.9, -0.6), (2.2, 0.7), (8.6, -1.1), (13.0, 1.1), (22.5, -1.15), (30.0, 1.0))):
        x, y_, z = p.world(np.array(uu), np.array(ss), np.array(W))
        obs += raft('gal_raft%d' % k, (x, z), mats, c, rng, n=rng.integers(6, 12), spread=(0.9, 0.9))
    # a drowned rat near the close-up, another on a bank; corks and straw
    o = PR.rat('rat_float', mats, c, seed=1)
    _place(o, p.world(np.array(15.2), np.array(-0.95), np.array(W + 0.005)), rng, tilt=0.05)
    o.rotation_euler = (np.radians(85), 0.1, 0.4)
    obs.append(o)
    # rope: a coil on the keeper's ledge, a rope hanging from a mooring ring into the water
    obs.append(PR.rope_coil('rope_coil', p.world(np.array(4.4), np.array(2.55), np.array(spec.LEDGE_Y)), mats['rope'], c, seed=2))
    a = p.world(np.array(11.3), np.array(1.42), np.array(spec.LEDGE_Y - 0.19))
    pts = [a, a + np.array([0.0, -0.25, 0.0]) + U.g2b(np.zeros(3)) * 0, p.world(np.array(11.5), np.array(1.25), np.array(W + 0.01)), p.world(np.array(12.2), np.array(0.9), np.array(W - 0.01)), p.world(np.array(12.9), np.array(0.6), np.array(W - 0.01))]
    obs.append(PR.rope('rope_hanging', pts, mats['rope'], c))
    # rusted rings with chain stubs in the walls above the ledges
    for k, (uu, side) in enumerate(((8.0, 1), (19.0, -1), (27.4, 1))):
        ws = G.shell_s_at_y(-3.1)
        loc = p.world(np.array(uu), np.array(side * ws), np.array(-3.1))
        px, pz, tx, tz, nx, nz = p.frame(np.array(uu))
        obs += PR.ring_with_chain('wall_ring_%d' % k, loc, -side * np.array([float(nx), 0, float(nz)]), mats['iron_rust'], c)
    # drip rings below drips over the channel and where the drain spouts hit
    for (du, side) in [(9.2, -1), (23.8, -1), (33.0, 1)]:
        obs.append(drip_ring_obj('ring_spout', p.world(np.array(du), np.array(side * 1.27), np.array(W + 0.003)), mats, c, rng, 1.3))
    for uu in rng.uniform(2, g.u1 - 0.5, 16):
        obs.append(drip_ring_obj('ring_drip', p.world(np.array(uu), np.array(rng.uniform(-1.3, 1.3)), np.array(W + 0.003)), mats, c, rng))
    # flowstone rows along joints near the crown: dozens, irregular, mostly short, a few long
    obs += crown_rows(g, flow_meshes, mats, c, rng)
    return obs

def drip_ring_obj(name, pos, mats, c, rng, scale=1.0):
    a = np.linspace(0, 2 * np.pi, 24, endpoint=False)
    V = np.vstack([[[0, 0, 0]], np.stack([0.22 * np.cos(a), np.zeros(24), 0.22 * np.sin(a)], -1)])
    F = [[0, (i + 1) % 24 + 1, i + 1] for i in range(24)]
    ob = U.mesh_from_faces(name, V, F, coll_=c, mat=mats['water_ring'], smooth=False)
    ob.location = U.gv(*pos)
    s = scale * rng.uniform(0.25, 0.55)
    ob.scale = (s, s, 1)
    ob.visible_shadow = False
    return ob

def crown_rows(g, flow_meshes, mats, c, rng):
    p = g.path
    s_p, y_p, v_p, vtot = G.shell_profile(g.dv)
    vc = vtot / 2
    obs = []
    rows = [(17.6, 25.4, 0.45)] + [(u0, u0 + rng.uniform(0.3, 0.8), rng.normal(0, 0.55)) for u0 in rng.uniform(2.0, g.u1 - 3, 4)]
    for (ua, ub, dv) in rows:
        uu = ua
        while uu < ub:
            uu += rng.uniform(0.25, 0.9)
            v = vc + dv + rng.normal(0, 0.012)
            s = np.interp(v, v_p, s_p); y = np.interp(v, v_p, y_p)
            pos = p.world(np.array(uu), np.array(s * 0.995), np.array(y + 0.004))
            o = bpy.data.objects.new('flowstone', flow_meshes[rng.integers(len(flow_meshes))])
            c.objects.link(o)
            o.location = U.gv(*pos)
            L = 0.015 + rng.gamma(1.2, 0.018)
            sc = rng.uniform(0.6, 1.3)
            o.scale = (sc, sc, min(L, 0.45))
            o.rotation_euler = (rng.normal(0, 0.06), rng.normal(0, 0.06), rng.uniform(0, 6.28))
            obs.append(o)
    return obs

def hall_dressing(mats, c, rng, groundfn, brick_meshes, flow_meshes):
    obs = []
    # rubbish rafts lodged against the free piers on the side the water comes from (the main mouth)
    for px in spec.HALL_XL:
        for pz in spec.HALL_ZL:
            if abs(px - (-152.75)) < 0.1:
                continue
            obs += raft('pier_raft', (px + rng.normal(0, 0.2), pz - H.PH - 0.35), mats, c, rng, n=rng.integers(7, 13), spread=(1.0, 0.5))
    # sheltered corner banks: rubbish, a broken basket, fragments, a rat
    for (cx, cz) in ((-140.9, 110.9), (-140.9, 137.6), (-159.1, 124.0)):
        obs += raft('corner_raft', (cx + (0.6 if cx < -150 else -0.6), cz + (0.5 if cz < 120 else -0.5)), mats, c, rng, n=8, spread=(1.2, 1.2), y=W + 0.02)
        pts = [(cx + rng.normal(0, 0.6) * (1 if cx < -150 else -1) + (0.6 if cx < -150 else -0.6), 0, cz + rng.normal(0, 0.5)) for _ in range(10)]
        pts = [(x, max(groundfn(x, z), W - 0.04) + 0.02, z) for (x, _, z) in pts]
        obs += fragments('hall_fallen', pts, brick_meshes, c, rng)
    b = PR.basket('basket_hall', mats, c, seed=3)
    _place(b, (-141.6, max(groundfn(-141.6, 136.8), W - 0.1), 136.8), rng, tilt=0.5)
    obs.append(b)
    o = PR.rat('rat_bank', mats, c, seed=2)
    _place(o, (-157.2, groundfn(-157.2, 134.6) + 0.03, 134.6), rng, tilt=0.1)
    obs.append(o)
    # chained rings on two pier faces
    for k, (px, pz, fd) in enumerate(((-146.25 - H.PH, 124.25, (-1, 0, 0)), (-146.25 + H.PH, 117.375, (1, 0, 0)))):
        obs += PR.ring_with_chain('pier_ring_%d' % k, (px, -3.0, pz), fd, mats['iron_rust'], c)
    # drip rings in the hall water
    for k in range(18):
        x = rng.uniform(spec.HALL_X0 + 1.6, spec.HALL_X1 - 0.3); z = rng.uniform(spec.HALL_Z0 + 1.6, spec.HALL_Z1 - 1.6)
        if abs(x - (-152.75)) < 0.8:
            continue
        obs.append(drip_ring_obj('ring_hall', (x, W + 0.003, z), mats, c, rng))
    return obs

def vliet_dressing(mats, c, rng, bedfn, brick_meshes):
    obs = []
    X0, X1 = spec.VLIET_X0, spec.VLIET_X1
    pts = []
    for k in range(10):
        x = rng.uniform(X0 + 0.1, X1 - 0.1); z = rng.uniform(spec.VLIET_Z0, spec.VLIET_Z1 - 3.8)
        pts.append((x, bedfn(x, z) + 0.005, z))
    obs += fragments('vliet_fallen', pts, brick_meshes, c, rng, scale=(0.35, 1.0))
    for k in range(10):
        x = rng.uniform(X0 + 0.15, X1 - 0.15); z = rng.uniform(spec.VLIET_Z0, spec.VLIET_Z1 - 3.8)
        o = PR.sack('vweed_%d' % k, mats['weed'], c, seed=900 + k, size=(rng.uniform(0.15, 0.7), 0.05, rng.uniform(0.1, 0.4)), tied=False)
        _place(o, (x, bedfn(x, z) - 0.005, z), rng, tilt=0.05)
        obs.append(o)
    b = PR.basket('basket_vliet', mats, c, seed=8, broken=0.45)
    _place(b, (X0 + 1.4, bedfn(X0 + 1.4, 64.0) - 0.04, 64.0), rng, tilt=0.6)
    obs.append(b)
    # rubbish caught at the foot of the doors and on the apron
    obs += raft('door_raft', (spec.GATE_X - 1.6, spec.VLIET_Z1 - 1.2), mats, c, rng, n=10, spread=(1.4, 0.8))
    obs += raft('door_raft2', (spec.GATE_X + 1.9, spec.VLIET_Z1 - 1.6), mats, c, rng, n=8, spread=(1.0, 0.8))
    obs.append(PR.rope_coil('rope_vliet', (X1 - 0.9, bedfn(X1 - 0.9, 58.0) + 0.0, 58.0), mats['rope'], c, seed=9, R0=0.22, turns=3))
    for k in range(8):
        x = rng.uniform(X0 + 0.5, X1 - 0.5); z = rng.uniform(spec.VLIET_Z0, spec.VLIET_Z1 - 5)
        o = PR.cork('vcork_%d' % k, mats['cork'], c)
        _place(o, (x, bedfn(x, z) + 0.01, z), rng, tilt=1.4)
        obs.append(o)
    return obs


def moss_tuft_meshes(mat, coll_, n=8, seed=31):
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        nu, nv = 10, 6
        u = np.linspace(0, 2 * np.pi, nu, endpoint=False)
        v = np.linspace(0.0, np.pi / 2, nv)
        Uu, Vv = np.meshgrid(u, v, indexing='ij')
        r = 1 + 0.35 * np.sin(Uu * rng.integers(2, 5) + rng.uniform(0, 6)) * np.sin(Vv * 3 + rng.uniform(0, 6))
        P = np.stack([np.cos(Uu) * np.cos(Vv) * r, np.sin(Vv) * r * rng.uniform(0.35, 0.7), np.sin(Uu) * np.cos(Vv) * r], -1)
        V = P.reshape(-1, 3)
        F = U.grid_faces(nu, nv, closed_u=True)
        top = len(V)
        V = np.vstack([V, [[0, P[:, -1, 1].mean(), 0]]])
        faces = [list(f[::-1]) for f in F] + [[top, (i_ * nv) + nv - 1, (((i_ + 1) % nu) * nv) + nv - 1][::-1] for i_ in range(nu)]
        ob = U.mesh_from_faces('mosstuft_v%d' % i, V, faces, coll_=coll_, mat=mat)
        out.append(ob.data)
        bpy.data.objects.remove(ob)
    return out

def moss_tufts(g, mats, c, rng):
    """Low moss cushions only where daylight falls: ledges and coping under the grate, the gate threshold,
    pier caps under the air shaft, the stair foot and lower treads."""
    meshes = moss_tuft_meshes(mats['moss'], c)
    p = g.path
    pts = []
    su = g.shaft_u
    for k in range(26):
        u = su + rng.normal(0, 1.2)
        side = 1 if rng.random() < 0.8 else -1
        s0 = side * (2.93 if rng.random() < 0.6 else 1.97)
        for j in range(rng.integers(6, 14)):
            pts.append(p.world(np.array(u + rng.normal(0, 0.06)), np.array(s0 - side * abs(rng.normal(0, 0.05))), np.array(spec.LEDGE_Y)))
    for k in range(10):
        u = rng.uniform(0.6, 3.0)
        side = rng.choice([-1, 1])
        for j in range(rng.integers(5, 10)):
            pts.append(p.world(np.array(u + rng.normal(0, 0.06)), np.array(side * (2.93 - abs(rng.normal(0, 0.05)))), np.array(spec.LEDGE_Y)))
    ax, az = H.AIR[0], H.AIR[1]
    for px in spec.HALL_XL:
        for pz in spec.HALL_ZL:
            if np.hypot(px - ax, pz - az) < 6.5:
                for k in range(25):
                    pts.append((px + rng.uniform(-0.75, 0.75), H.S_PIER + 0.002, pz + rng.uniform(-0.75, 0.75)))
    obs = []
    for q in pts:
        o = bpy.data.objects.new('moss_cushion', meshes[rng.integers(len(meshes))])
        c.objects.link(o)
        o.location = U.gv(*q)
        s_ = rng.uniform(0.02, 0.05)
        o.scale = (s_ * rng.uniform(1, 1.6), s_ * rng.uniform(1, 1.6), s_ * 0.8)
        o.rotation_euler = (0, 0, rng.uniform(0, 6.28))
        obs.append(o)
    return obs
