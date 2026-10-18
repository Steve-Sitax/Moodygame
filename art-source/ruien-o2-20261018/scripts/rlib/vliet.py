# The open vliet in front of gate O2: quay walls, head wall with the outlet arch, tide doors, bed, water.
import numpy as np
import bpy
import spec
from . import util as U
from . import gallery as G

X0, X1 = spec.VLIET_X0, spec.VLIET_X1
ZF = spec.VLIET_Z1           # head wall face (z = 72)
GX = spec.GATE_X
SP = spec.GAL_SPRING_Y
RISE = spec.GAL_RISE
W2 = spec.GAL_W / 2

def wall_weather(P, y, seed, tide=True):
    n = len(y)
    A = np.zeros((n, 4), np.float32); B = np.zeros((n, 4), np.float32); B[:, 3] = 1
    nz1 = U.fbm3(P, seed, 1.5); nz2 = U.fbm3(P, seed + 1, 0.5)
    # river water: tide band below high water, slime and weed thicker lower down
    A[:, 2] = U.smoothstep(spec.HIGH_WATER_Y + 0.15, spec.HIGH_WATER_Y - 0.35, y) * (0.55 + 0.45 * U.smoothstep(-1.2, -3.0, y))
    A[:, 2] *= 0.75 + 0.5 * nz1
    # a darker wet line just above high water and run-off streaks from the coping
    A[:, 2] += 0.35 * U.smoothstep(spec.HIGH_WATER_Y + 0.5, spec.HIGH_WATER_Y + 0.1, y) * U.smoothstep(0.55, 0.7, nz2)
    A[:, 3] = U.smoothstep(-4.2, -4.9, y) * 0.8
    A[:, 0] = 0.25 * U.smoothstep(0.6, 0.75, nz2) * U.smoothstep(-0.3, -0.9, y) * U.smoothstep(-3.0, -1.5, y)
    A[:, 1] = 0.2 * U.smoothstep(-1.0, -0.3, y) + 0.25 * U.smoothstep(0.55, 0.7, nz1)  # town soot near the top
    C = np.zeros((n, 4), np.float32)
    streaks = U.smoothstep(0.58, 0.72, U.fbm3(P * np.array([1.0, 0.08, 1.0]), seed + 5, 0.4))
    C[:, 3] = streaks * (1 - U.smoothstep(spec.HIGH_WATER_Y - 0.2, spec.HIGH_WATER_Y - 0.6, y))
    C[:, 1] = 0.8 * U.smoothstep(spec.HIGH_WATER_Y - 0.05, spec.HIGH_WATER_Y + 0.15, y) * (1 - U.smoothstep(-0.4, -0.15, y)) * U.smoothstep(0.4, 0.6, nz2)
    A[:, 0] = np.maximum(A[:, 0], 0.5 * streaks * U.smoothstep(-0.2, -0.9, y) * U.smoothstep(-2.5, -1.2, y))
    A[:, 2] = np.where(y < spec.HIGH_WATER_Y, np.maximum(A[:, 2], 0.85), A[:, 2])
    return np.clip(A, 0, 1), B, np.clip(C, 0, 1)

def quay_walls(mats, c):
    obs = []
    for x, side in ((X0, 1), (X1, -1)):
        zz = np.arange(spec.VLIET_Z0 - 1.0, ZF + 0.6, 0.18)
        yy = np.linspace(-5.5, -0.27, 54)
        Z, Y = np.meshgrid(zz, yy, indexing='ij')
        P = np.stack([np.full(Z.shape, x), Y, Z], -1)
        UV = np.stack([Z * side, Y], -1)
        A, B, C3 = wall_weather(P.reshape(-1, 3), Y.ravel(), 40 + side)
        flip = G.orient_check(P, P[P.shape[0] // 2, P.shape[1] // 2] + np.array([side, 0, 0]))
        ob = U.grid_mesh('vliet_quaywall_%s' % ('w' if side > 0 else 'e'), P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)},
                         flip=flip, coll_=c, mat=mats['brick_quay'])
        U.add_adaptive(ob)
        obs.append(ob)
    return obs

def opening_inside(s, y, grow=0.0):
    """Outline of the outlet at the head wall face (s across from the gate centre)."""
    s = np.asarray(s); y = np.asarray(y)
    a, b = W2 + grow, RISE + grow
    low = (np.abs(s) < a) & (y >= spec.GATE_SILL_Y - grow) & (y <= SP)
    up = (y > SP) & ((s / a) ** 2 + ((y - SP) / b) ** 2 < 1)
    return low | up

def head_wall(mats, c):
    xx = np.arange(X0 - 0.02, X1 + 0.02 + 1e-6, 0.05)
    yy = np.arange(-5.5, -0.28, 0.05)
    Xg, Y = np.meshgrid(xx, yy, indexing='ij')
    P = np.stack([Xg, Y, np.full(Xg.shape, ZF)], -1)
    UV = np.stack([-Xg, Y], -1)
    cs = 0.5 * (Xg[1:, 1:] + Xg[:-1, :-1]) - GX
    cy = 0.5 * (Y[1:, 1:] + Y[:-1, :-1])
    # stone dressing zone: jambs out to 0.5 m beyond the opening, voussoirs 0.55 deep
    zone = opening_inside(cs, cy, 0.0) | ((np.abs(cs) < W2 + 0.5) & (cy < SP + 0.02) & (cy > spec.GATE_SILL_Y - 0.31)) | \
        ((cy >= SP) & ((cs / (W2 + 0.53)) ** 2 + ((cy - SP) / (RISE + 0.53)) ** 2 < 1))
    keep = ~zone
    A, B, C3 = wall_weather(P.reshape(-1, 3), Y.ravel(), 50)
    sf = (Xg - GX).ravel(); yf = Y.ravel()
    # rust runs below the pintles, lime weeping from the arch joints
    for sx in (-(W2 + 0.3), W2 + 0.3):
        A[:, 1] += 0.5 * np.exp(-0.5 * ((sf - sx) / 0.12) ** 2) * U.smoothstep(-1.4, -2.2, yf)
    A[:, 0] += 0.4 * np.exp(-0.5 * ((np.abs(sf) - 3.4) / 0.35) ** 2) * U.smoothstep(-0.3, -1.2, yf) * U.smoothstep(-3.5, -2.0, yf)
    A = np.clip(A, 0, 1)
    flip = G.orient_check(P, P[P.shape[0] // 2, 10] + np.array([0, 0, -1.0]))
    ob = U.grid_mesh('vliet_headwall', P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)},
                     keep=keep, flip=flip, coll_=c, mat=mats['brick_quay'])
    U.remove_loose(ob)
    U.add_adaptive(ob)
    return ob

def gp(s, y, z):
    """Point in the gate frame: s across from the gate centre, game y, game z."""
    return np.array([GX + s, y, z])

def ell(th, grow=0.0):
    a, b = W2 + grow, RISE + grow
    return a * np.cos(th), SP + b * np.sin(th)

def ell_normal(th):
    a, b = W2, RISE
    n = np.array([np.cos(th) / a, np.sin(th) / b])
    return n / np.linalg.norm(n)

def dressing(mats, c, rng):
    """Bluestone voussoirs, springers, jambs, ledge-end blocks and the sill at the outlet."""
    m = mats['bluestone']
    obs = []
    zf = ZF - 0.03           # dressed stone stands 3 cm proud of the brick
    # voussoirs: 15 stones of equal arc length, keystone a little longer and proud
    th = np.linspace(np.pi, 0, 3000)
    es, ey = ell(th)
    seg = np.r_[0, np.cumsum(np.hypot(np.diff(es), np.diff(ey)))]
    nV = 15
    cuts = np.interp(np.linspace(0, seg[-1], nV + 1), seg, th)
    for i in range(nV):
        ta, tb = cuts[i], cuts[i + 1]
        key = (i == nV // 2)
        depth_r = 0.55 + (0.12 if key else (0.06 if i % 2 else 0.0))
        dz = 0.62 if i % 2 == 0 else 0.48
        pts = []
        for t in (ta, tb):
            s0, y0 = ell(t)
            n = ell_normal(t)
            pts.append(((s0, y0), (s0 + n[0] * depth_r, y0 + n[1] * depth_r)))
        (ia, oa), (ib, ob_) = pts
        zf_k = zf - (0.04 if key else 0.0)
        C = np.zeros((8, 3))
        # x bit: a->b, y bit: intrados->extrados, z bit: face->in
        for zi, zz in enumerate((zf_k, ZF + dz)):
            C[0 + 4 * zi] = gp(ia[0], ia[1], zz)
            C[1 + 4 * zi] = gp(ib[0], ib[1], zz)
            C[2 + 4 * zi] = gp(oa[0], oa[1], zz)
            C[3 + 4 * zi] = gp(ob_[0], ob_[1], zz)
        obs.append(U.block_object('gate_voussoir_%02d' % i, C, m, c, r=0.013, res=0.045, seed=100 + i, chips=rng.integers(6, 12), chip_size=(0.02, 0.09), corners=int(rng.integers(0, 3)), wobble=0.0025))
    # jambs: springer course and ledge-end blocks (two courses) on both sides, plus the channel sides
    courses = [(spec.GATE_SILL_Y, -4.4), (-4.4, spec.LEDGE_Y), (spec.LEDGE_Y, SP)]
    k = 0
    for side in (-1, 1):
        for ci, (y0, y1) in enumerate(courses):
            s_in = spec.GAL_CHANNEL_W / 2 if ci < 2 else W2
            parts = [(s_in, s_in + 1.0), (s_in + 1.0, W2 + 0.5)] if ci < 2 else [(s_in, W2 + 0.5)]
            for (sa, sb) in parts:
                if sb - sa < 0.15:
                    continue
                dz = 0.75 if (k % 2) else 0.5
                a, b = side * sa, side * sb
                C = U.box_corners(0, 1, 0, 1, 0, 1)
                C = np.array([gp(a if not (j & 1) else b, y0 if not (j & 2) else y1 - 0.006, zf if not (j & 4) else ZF + dz) for j in range(8)])
                obs.append(U.block_object('gate_jamb_%02d' % k, C, m, c, r=0.013, res=0.045, seed=200 + k, chips=rng.integers(5, 10), chip_size=(0.02, 0.08),
                                          wear_top=0.006 if ci == 1 else 0.0, corners=int(rng.integers(0, 2)), wobble=0.0025))
                k += 1
    # sill: three stones across the channel slot, projecting as a step into the vliet
    for i, (sa, sb) in enumerate(((-1.5, -0.45), (-0.45, 0.55), (0.55, 1.5))):
        C = np.array([gp(sa if not (j & 1) else sb - 0.006, spec.GATE_SILL_Y - 0.32 if not (j & 2) else spec.GATE_SILL_Y, ZF - 0.55 if not (j & 4) else ZF + 1.6) for j in range(8)])
        obs.append(U.block_object('gate_sill_%d' % i, C, m, c, r=0.015, res=0.05, seed=300 + i, chips=8, wear_top=0.018, corners=1, wobble=0.003))
    # apron slabs in front of the doors, swept by the leaves, partly silted
    zz = ZF - 0.55
    k = 0
    while zz > ZF - 3.9:
        L = rng.uniform(0.7, 1.0)
        xs = -W2 - 0.4
        while xs < W2 + 0.4:
            w = rng.uniform(0.7, 1.2)
            w = min(w, W2 + 0.4 - xs)
            if w < 0.2:
                break
            tilt = rng.normal(0, 0.012)
            C = np.array([gp(xs if not (j & 1) else xs + w - 0.012, (spec.GATE_SILL_Y - 0.25 if not (j & 2) else spec.GATE_SILL_Y - 0.02 + tilt * ((j & 1) - 0.5)) - 0.01, zz - L + 0.012 if not (j & 4) else zz) for j in range(8)])
            obs.append(U.block_object('gate_apron_%02d' % k, C, m, c, r=0.018, res=0.06, seed=400 + k, chips=6, wear_top=0.015, corners=int(rng.integers(0, 2)), wobble=0.003))
            xs += w
            k += 1
        zz -= L
    return obs

def coping(mats, c, rng):
    """Bluestone coping on the quay walls and the head wall, at street level."""
    m = mats['bluestone_dry']
    obs = []
    k = 0
    for x, side in ((X0, 1), (X1, -1)):
        z = spec.VLIET_Z0 - 1.0
        while z < ZF - 0.05:
            L = min(rng.uniform(0.9, 1.4), ZF - z)
            x0, x1 = (x - 0.6, x + 0.06) if side > 0 else (x - 0.06, x + 0.6)
            C = U.box_corners(x0, x1, -0.3, 0.0, z, z + L - 0.01)
            obs.append(U.block_object('quay_coping_%03d' % k, C, m, c, r=0.014, res=0.06, seed=500 + k, chips=rng.integers(5, 10), chip_size=(0.02, 0.08), wear_top=0.01, corners=int(rng.integers(0, 2)), wobble=0.0025))
            z += L
            k += 1
    # head wall coping, running across the outlet
    x = X0 - 0.6
    while x < X1 + 0.6 - 0.05:
        L = min(rng.uniform(0.9, 1.3), X1 + 0.6 - x)
        C = U.box_corners(x, x + L - 0.01, -0.3, 0.0, ZF - 0.06, ZF + 0.7)
        obs.append(U.block_object('head_coping_%03d' % k, C, m, c, r=0.014, res=0.06, seed=500 + k, chips=rng.integers(5, 10), chip_size=(0.02, 0.08), wear_top=0.01, corners=int(rng.integers(0, 2)), wobble=0.0025))
        x += L
        k += 1
    return obs

def door_leaf(side, mats, c, rng, open_deg):
    """One oak tide door leaf. side +1 = north leaf (hinge at s = +3.18)."""
    obs = []
    hinge_s = side * (W2 + 0.18)
    hinge_z = ZF - 0.2
    thick = 0.09
    zf = ZF - 0.05 - thick      # plank outer face (closed)
    pw = spec.OAK_PLANK_W - 0.01
    n_pl = int(np.ceil((W2 + 0.12) / spec.OAK_PLANK_W))
    pl_meshes = []
    ang = np.radians(open_deg) * side   # rotate about game y: positive opens the north leaf outward (to -z)
    def rot(p):
        # rotate point p (game) about the hinge axis (x = GX + hinge_s, z = hinge_z)
        dx, dz = p[..., 0] - (GX + hinge_s), p[..., 2] - hinge_z
        ca, sa = np.cos(ang), np.sin(ang)
        out = p.copy()
        out[..., 0] = GX + hinge_s + dx * ca - dz * sa
        out[..., 2] = hinge_z + dx * sa + dz * ca
        return out
    top_grow = 0.1
    for i in range(n_pl):
        s0 = i * spec.OAK_PLANK_W
        s1 = min(s0 + pw, W2 + 0.12)
        sm = (s0 + s1) / 2
        # top follows the arch, grown so the leaf laps the stone
        t = np.clip(sm / (W2 + top_grow), 0, 1)
        ytop = SP + (RISE + top_grow) * np.sqrt(max(1 - t * t, 0))
        ybot = spec.GATE_SILL_Y + 0.01 + max(0, rng.normal(0.02, 0.03))
        L = ytop - ybot
        V, F = U.chipped_block(s1 - s0, L, thick, r=0.004, res=0.05, seed=900 + i + (50 if side > 0 else 0), chips=rng.integers(2, 6), chip_size=(0.01, 0.04))
        # eaten bottom ends: push the lowest verts up irregularly
        low = V[:, 1] < -L / 2 + 0.25
        V[low, 1] += np.clip(rng.normal(0.03, 0.04) + 0.03 * np.sin(V[low, 0] * 90 + i), 0, 0.12) * (1 - (V[low, 1] + L / 2) / 0.25)
        P = np.stack([GX + side * sm + V[:, 0] * side, (ybot + ytop) / 2 + V[:, 1], zf + thick / 2 + V[:, 2]], -1)
        if side < 0:
            F = F[:, ::-1]
        # atlas UV: column per plank, v along height with a random offset
        col = rng.integers(spec.OAK_ATLAS_COLS)
        voff = rng.uniform(0, spec.OAK_ATLAS_H_M - L - 0.1)
        uvv = np.stack([(col + (V[:, 0] / (s1 - s0) + 0.5) * 0.96 + 0.02) / spec.OAK_ATLAS_COLS + V[:, 2] / (spec.OAK_ATLAS_COLS * spec.OAK_PLANK_W),
                        (voff + V[:, 1] + L / 2) / spec.OAK_ATLAS_H_M], -1)
        uv2 = np.stack([(sm + V[:, 0] * side) / 3.0 * side * side, ((ybot + ytop) / 2 + V[:, 1] - spec.GATE_SILL_Y) / 4.6], -1)
        P = rot(P)
        ob = U.mesh_from_faces('door_%s_plank_%02d' % ('n' if side > 0 else 's', i), P, F, uv=uvv[F.ravel()], uv2=uv2[F.ravel()], coll_=c, mat=mats['oak'])
        obs.append(ob)
    # ledgers on the inner face, heel post at the hinge, a brace
    zi = zf + thick
    for k, yy in enumerate(spec.DOOR_STRAPS_Y[::2]):
        s_end = W2 - 0.05
        C = np.array([gp(side * 0.05 if not (j & 1) else side * (W2 + 0.05), yy - 0.11 if not (j & 2) else yy + 0.11, zi if not (j & 4) else zi + 0.16) for j in range(8)])
        if side < 0:
            C = C[[1, 0, 3, 2, 5, 4, 7, 6]]
        P, F, V = U.hexa_block(C, r=0.006, res=0.05, seed=950 + k + side * 10, chips=3)
        uvv = np.stack([(rng.integers(8) + 0.5 + V[:, 1] * 2) / 8, (V[:, 0] + 2) / spec.OAK_ATLAS_H_M], -1)
        ob = U.mesh_from_faces('door_%s_ledger_%d' % ('n' if side > 0 else 's', k), rot(P), F, uv=uvv[F.ravel()], uv2=np.zeros((F.size, 2)) + 0.5, coll_=c, mat=mats['oak'])
        obs.append(ob)
    # iron straps with rivets on the outer face, ending in hinge eyes round the pintles
    straps = []
    rivets = []
    for k, yy in enumerate(spec.DOOR_STRAPS_Y):
        sw = 0.11 if k in (0, len(spec.DOOR_STRAPS_Y) - 1) else 0.09
        s_end = 0.08 + rng.uniform(0, 0.15)
        x_a, x_b = side * s_end, hinge_s - side * 0.05
        C = np.array([gp(x_a if not (j & 1) else x_b, yy - sw / 2 if not (j & 2) else yy + sw / 2, zf - 0.02 if not (j & 4) else zf + 0.001) for j in range(8)])
        if side < 0:
            C = C[[1, 0, 3, 2, 5, 4, 7, 6]]
        P, F, V = U.hexa_block(C, r=0.002, res=0.04, seed=970 + k + side * 7, chips=0)
        straps.append(U.mesh_from_faces('door_strap', rot(P), F, uv=U.box_uv(P, F), coll_=c, mat=mats['iron_wet']))
        # rivet heads, one per plank and two rows on the wide straps
        rows = [yy - 0.025, yy + 0.025] if sw > 0.1 else [yy]
        for i in range(n_pl):
            sm = (i + 0.5) * spec.OAK_PLANK_W
            if sm < s_end + 0.03 or sm > W2 + 0.1:
                continue
            for ry in rows:
                rivets.append(rot(gp(side * sm, ry, zf - 0.02)[None])[0])
        # hinge eye: a short tube round the pintle axis
        eye_c = np.array([GX + hinge_s, yy, hinge_z])
        ring = [eye_c + np.array([0.045 * np.cos(a), -0.05 + 0.1 * (q), 0.045 * np.sin(a)]) for q in (0,) for a in [0]]
        straps.append(U.tube('door_eye', [eye_c + [0, -sw / 2, 0], eye_c + [0, sw / 2, 0]], 0.05, n=14, coll_=c, mat=mats['iron_wet']))
    # rivet domes as one mesh
    rv = []
    rf = []
    th = np.linspace(0, np.pi / 2, 4)
    ph = np.linspace(0, 2 * np.pi, 9)[:-1]
    for p in rivets:
        base = len(rv)
        normal_dir = rot(np.array([[0, 0, -1.0]]) + np.array([[GX + hinge_s, 0, hinge_z]]))[0] - np.array([GX + hinge_s, 0, hinge_z])
        nd = normal_dir / np.linalg.norm(normal_dir)
        a = np.array([0, 1.0, 0]); b = np.cross(nd, a)
        for t in th:
            for q in ph:
                rv.append(p + 0.022 * (np.cos(t) * (np.cos(q) * a + np.sin(q) * b) * 1.0 + np.sin(t) * nd * 0.6))
        for i in range(len(th) - 1):
            for j in range(len(ph)):
                j1 = (j + 1) % len(ph)
                rf.append([base + i * 8 + j, base + i * 8 + j1, base + (i + 1) * 8 + j1, base + (i + 1) * 8 + j])
    if rv:
        rob = U.mesh_from_faces('door_%s_rivets' % ('n' if side > 0 else 's'), np.array(rv), rf, coll_=c, mat=mats['iron_wet'])
        straps.append(rob)
    obs += straps
    return obs

def pintles(mats, c):
    """Iron pintles leaded into the jamb stones, one per strap end at the hinge side."""
    obs = []
    for side in (-1, 1):
        hs = side * (W2 + 0.18)
        for k, yy in enumerate(spec.DOOR_STRAPS_Y):
            if k not in (0, 2, 4):
                continue
            p0 = gp(hs, yy, ZF - 0.2)
            # bracket arm from the stone face out to the pin
            C = np.array([gp(hs - side * 0.05 if not (j & 1) else hs + side * 0.16, yy - 0.115 - 0.045 if not (j & 2) else yy - 0.115, ZF - 0.24 if not (j & 4) else ZF + 0.08) for j in range(8)])
            if side < 0:
                C = C[[1, 0, 3, 2, 5, 4, 7, 6]]
            obs.append(U.block_object('pintle_arm', C, mats['iron_wet'], c, r=0.006, res=0.03, seed=1000 + k + side, chips=0))
            obs.append(U.tube('pintle_pin', [p0 + [0, -0.16, 0], p0 + [0, 0.08, 0]], 0.026, n=12, coll_=c, mat=mats['iron_wet']))
    return obs

def bed(mats, c):
    xx = np.arange(X0 - 0.15, X1 + 0.15 + 1e-6, 0.15)
    zz = np.arange(spec.VLIET_Z0 - 1.0, ZF - 0.5, 0.15)
    Xg, Z = np.meshgrid(xx, zz, indexing='ij')
    P0 = np.stack([Xg, np.zeros_like(Xg), Z], -1).reshape(-1, 3)
    n1 = U.fbm3(P0, 61, 4.0).reshape(Xg.shape)
    n2 = U.fbm3(P0, 62, 1.0).reshape(Xg.shape)
    dw = np.minimum(Xg - X0, X1 - Xg)
    # outflow channel meandering down the middle, banks along both walls
    cx = GX + 0.6 * np.sin(Z * 0.21) + 0.3 * np.sin(Z * 0.53 + 1.0)
    chan = np.exp(-0.5 * ((Xg - cx) / 1.0) ** 2)
    y = -4.98 + 0.8 * U.smoothstep(2.8, 0.0, dw) * (0.55 + 0.8 * n1) - 0.25 * chan + 0.14 * (n2 - 0.5)
    # scour pit in front of the apron
    y -= 0.2 * np.exp(-0.5 * (((Z - (ZF - 4.3)) / 0.8) ** 2 + ((Xg - GX) / 2.0) ** 2))
    # erosion rivulets draining the banks into the middle channel, cut where the ebb runs off
    rr = np.random.default_rng(63)
    for k in range(9):
        zk = rr.uniform(spec.VLIET_Z0, ZF - 5.0)
        side = -1 if k % 2 else 1
        xs0 = X0 if side > 0 else X1
        zl = zk + 0.35 * np.sin((Xg - xs0) * 1.7 + k) + 0.2 * (Xg - xs0) * side * rr.uniform(-0.3, 0.3)
        reach = (Xg - xs0) * side
        on = (reach > 0.05) & (reach < 3.3)
        y -= on * 0.075 * np.exp(-((Z - zl) / rr.uniform(0.07, 0.14)) ** 2) * np.clip(reach / 0.6, 0, 1)
    P = np.stack([Xg, y, Z], -1)
    flip = G.orient_check(P, P[10, 10] + np.array([0, 1.0, 0]))
    ob = U.grid_mesh('vliet_bed', P, np.stack([Xg, Z], -1), flip=flip, coll_=c, mat=mats['silt_vliet'])
    U.add_adaptive(ob)
    return ob, (lambda x, z: np.interp(z, zz, y[np.argmin(np.abs(xx - x))]))

def water(mats, c):
    return U.box_mesh('vliet_water', X0 - 0.1, X1 + 0.1, -5.7, spec.WATER_Y, spec.VLIET_Z0 - 1.0, ZF + 0.3, mats['water_river'], c)

def street(mats, c):
    """Paving at street level around the vliet head (only what the camera sees)."""
    obs = []
    for name, (xa, xb, za, zb) in (('quay_w', (-162.0, X0 - 0.6, spec.VLIET_Z0 - 1, ZF + 0.7)),
                                   ('quay_e', (X1 + 0.6, -130.0, spec.VLIET_Z0 - 1, ZF + 0.7)),
                                   ('street_n', (-162.0, -130.0, ZF + 0.7, ZF + 9.0))):
        xx = np.linspace(xa, xb, max(2, int((xb - xa) / 0.5)))
        zz = np.linspace(za, zb, max(2, int((zb - za) / 0.5)))
        Xg, Z = np.meshgrid(xx, zz, indexing='ij')
        P = np.stack([Xg, np.zeros_like(Xg) - 0.005, Z], -1)
        flip = G.orient_check(P, P[0, 0] + np.array([0, 1.0, 0]))
        ob = U.grid_mesh('street_' + name, P, np.stack([Xg, Z], -1), flip=flip, coll_=c, mat=mats['paving'])
        obs.append(ob)
    return obs

def build(mats, c, rng):
    obs = []
    obs += quay_walls(mats, c)
    obs.append(head_wall(mats, c))
    obs += dressing(mats, c, rng)
    obs += coping(mats, c, rng)
    for side in (-1, 1):
        obs += door_leaf(side, mats, c, rng, spec.DOOR_OPEN_DEG * (1.0 if side > 0 else 0.82))
    obs += pintles(mats, c)
    b, bedfn = bed(mats, c)
    obs.append(b)
    obs.append(water(mats, c))
    obs += street(mats, c)
    return obs, bedfn
