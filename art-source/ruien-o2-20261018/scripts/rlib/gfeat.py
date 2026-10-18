# Features of the main gallery: penstock, drains, pipes, grate shaft, lamp, rings, straws, rubble.
import numpy as np
import bpy
import spec
from . import util as U
from . import gallery as G
from . import props as PR

W2 = spec.GAL_W / 2

# ------------------------------------------------------------------ plan of features (u along the gallery)
PENSTOCK_U = 3.0
LAMP_U = 5.3
DRAINS = [(9.2, -1), (16.6, 1), (23.8, -1), (33.0, 1)]
PIPES = [(12.6, 1, -3.05), (28.4, -1, -3.15), (20.3, 1, -3.2)]
DRAIN_YB = spec.LEDGE_Y + 0.25
SHAFT_Z = 92.5
SHAFT_S, SHAFT_H = 2.35, 0.33

def plan_features(g, rng):
    """Register holes, wet sources and seeps on the gallery before its shell is built."""
    p = g.path
    g.shaft_u = p.u_at_z(SHAFT_Z)
    for (du, side) in DRAINS:
        g.holes.append(lambda u, s, y, du=du, side=side: (np.sign(s) == side) & (np.abs(u - du) < G.egg_hw(y - DRAIN_YB) - 0.01) & (y > DRAIN_YB) & (y < DRAIN_YB + 1.6))
        g.wetsrc.append((du, side, DRAIN_YB + 0.2, 0.25))
    for (pu, side, py) in PIPES:
        g.holes.append(lambda u, s, y, pu=pu, side=side, py=py: (np.sign(s) == side) & (np.abs(u - pu) < 0.15) & (np.abs(y - py) < 0.15) & (np.abs(s) > 2.5))
        g.wetsrc.append((pu, side, py, 0.12))
        g.rustsrc.append((pu, side, py - 0.1, 0.1))
    su = g.shaft_u
    g.holes.append(lambda u, s, y: (np.abs(u - su) < SHAFT_H + 0.005) & (s > SHAFT_S - SHAFT_H - 0.005) & (s < SHAFT_S + SHAFT_H + 0.005) & (y > -2.6))
    g.wetsrc.append((su, 1, -1.9, 0.3))
    lamp_pos = p.world(LAMP_U, 2.45, -2.45)
    g.lamps.append(tuple(lamp_pos))
    # lime: seeps near the crown, a long crack with a curtain of straws, weeping round the shaft
    seeps = []
    vc = None
    for k in range(34):
        uu = rng.uniform(1.8, g.u1 - 0.5)
        seeps.append((uu, rng.normal(0, 1.0), rng.uniform(0.35, 1.0)))
    g._seep_rel = seeps
    g.crack = (17.5, 25.5, 0.45)
    g.sand = [(12.8, 17.2, -1, -2.5), (25.6, 29.0, 1, -2.7), (35.2, 37.0, -1, -2.2)]
    g.repairs = [(19.5, 22.5, 6.2, 7.6)]
    # holes where bricks fell out: low on the walls (frost and tide), a few in the vault haunches
    g.damage_rel = [(7.4, -4.0, 0.35, 1.0), (14.2, -4.3, 0.45, 0.9), (21.0, 4.1, 0.3, 1.0), (26.5, -2.6, 0.25, 0.8), (31.8, 3.9, 0.4, 1.0), (35.5, -4.2, 0.3, 0.9)]
    g.cdamage = [(14.7, -1, -4.25, 0.32, 1.1), (15.5, -1, -4.0, 0.18, 0.9), (6.2, 1, -4.3, 0.3, 1.0), (19.8, 1, -4.2, 0.35, 1.0), (27.5, -1, -4.35, 0.4, 1.0), (33.4, 1, -4.1, 0.25, 0.9)]

def finalize_seeps(g):
    """Seeps are planned relative to the crown; the profile length is known only now."""
    s_p, y_p, v_p, vtot = G.shell_profile(g.dv)
    vc = vtot / 2
    g.seeps = [(u, vc + dv, st) for (u, dv, st) in g._seep_rel]
    a, b, dv = g.crack
    for uu in np.arange(a, b, 0.35):
        g.seeps.append((uu, vc + dv + 0.1 * np.sin(uu * 1.3), 0.95))
    g.seeps.append((g.shaft_u, vc + 1.6, 0.9))
    g.vc = vc
    g.damage = [(u, vc + dv, r, a) for (u, dv, r, a) in getattr(g, 'damage_rel', [])]
    return vc

def v_to_sy(v, dv=0.06):
    s_p, y_p, v_p, vtot = G.shell_profile(dv)
    return np.interp(v, v_p, s_p), np.interp(v, v_p, y_p)

# ------------------------------------------------------------------ penstock and winding gear
def penstock(g, mats, c):
    p = g.path
    u0 = PENSTOCK_U
    obs = []
    iron = mats['iron']
    def P(s, y, du=0.0):
        return p.world(np.array(u0 + du), np.array(s), np.array(y))
    def box(name, s0, s1, y0, y1, d0, d1, r=0.004, mat=iron):
        C = np.array([P(s0 if not (j & 1) else s1, y0 if not (j & 2) else y1, d0 if not (j & 4) else d1) for j in range(8)])
        return U.block_object(name, C, mat, c, r=r, res=0.05, chips=0)
    hw = spec.GAL_CHANNEL_W / 2
    # guide frames standing against the channel walls, up past the ledges to the headstock
    for side in (-1, 1):
        obs.append(box('penstock_guide', side * (hw - 0.0), side * (hw - 0.14), spec.FLOOR_Y - 0.05, -2.72, -0.12, 0.12))
        obs.append(box('penstock_guide_lip', side * (hw - 0.14), side * (hw - 0.2), spec.FLOOR_Y - 0.05, -2.72, 0.04, 0.12))
        obs.append(box('penstock_guide_lip', side * (hw - 0.14), side * (hw - 0.2), spec.FLOOR_Y - 0.05, -2.72, -0.12, -0.04))
        # pedestal on the ledge
        obs.append(box('penstock_pedestal', side * 1.62, side * 1.92, spec.LEDGE_Y, -2.9, -0.13, 0.13))
        obs.append(box('penstock_pedestal_foot', side * 1.55, side * 2.0, spec.LEDGE_Y, spec.LEDGE_Y + 0.05, -0.2, 0.2))
    # door: raised so the bottom is 25 cm under the water
    ybot, ytop = spec.WATER_Y - 0.25, spec.WATER_Y - 0.25 + 1.75
    obs.append(box('penstock_door', -hw + 0.07, hw - 0.07, ybot, ytop, -0.02, 0.02, r=0.003))
    for yy in np.linspace(ybot + 0.12, ytop - 0.12, 4):
        obs.append(box('penstock_rib_h', -hw + 0.1, hw - 0.1, yy - 0.025, yy + 0.025, 0.02, 0.1))
    for ss in np.linspace(-hw + 0.25, hw - 0.25, 5):
        obs.append(box('penstock_rib_v', ss - 0.02, ss + 0.02, ybot + 0.05, ytop - 0.05, 0.02, 0.09))
    # headstock beam
    obs.append(box('penstock_headstock', -2.0, 2.0, -2.9, -2.72, -0.12, 0.12))
    # racks rising from the door through the headstock
    for ss in (-0.8, 0.8):
        r = PR.rack('penstock_rack', 1.75, 0.045, iron, c)
        loc = P(ss, ytop + 0.875 - 0.05, -0.17)
        px, pz, tx, tz, nx, nz = p.frame(np.array(u0))
        t = np.array([float(tx), 0, float(tz)]); n = np.array([float(nx), 0, float(nz)])
        r.matrix_world = PR.frame_matrix(loc, -t, np.array([0, 1.0, 0]), n)
        obs.append(r)
        obs.append(box('penstock_rack_lift', ss - 0.05, ss + 0.05, ytop - 0.02, ytop + 0.1, -0.2, 0.02))
    # cross shaft with two pinions and a big wheel over the north ledge
    shaft_y = -2.6
    px, pz, tx, tz, nx, nz = p.frame(np.array(u0))
    t = np.array([float(tx), 0, float(tz)]); n = np.array([float(nx), 0, float(nz)]); up = np.array([0, 1.0, 0])
    sh = U.tube('penstock_shaft', [P(-1.05, shaft_y, -0.24), P(2.45, shaft_y, -0.24)], 0.03, n=12, coll_=c, mat=iron)
    obs.append(sh)
    for ss in (-0.8, 0.8):
        gr = PR.gear('penstock_pinion', 0.075, 12, 0.07, iron, c, hub_r=0.035)
        gr.matrix_world = PR.frame_matrix(P(ss, shaft_y, -0.24), t, up, n)
        obs.append(gr)
    big = PR.gear('penstock_wheel', 0.27, 40, 0.06, iron, c, hub_r=0.05, spokes=6, rim=0.045)
    big.matrix_world = PR.frame_matrix(P(2.22, shaft_y, -0.24), t, up, n)
    obs.append(big)
    # crank shaft below, small pinion, crank and handle for the keeper on the north ledge
    cy = shaft_y - (0.27 + 0.07)
    obs.append(U.tube('penstock_crankshaft', [P(2.05, cy, -0.24), P(2.9, cy, -0.24)], 0.025, n=12, coll_=c, mat=iron))
    sm = PR.gear('penstock_drive', 0.07, 11, 0.07, iron, c, hub_r=0.03)
    sm.matrix_world = PR.frame_matrix(P(2.22, cy, -0.24), t, up, n)
    obs.append(sm)
    # A-frame on the ledge carrying both shafts
    for du in (-0.34, -0.14):
        pass
    for ss in (2.12, 2.42):
        obs.append(U.tube('penstock_frame_leg', [P(ss, spec.LEDGE_Y, -0.55), P(ss, shaft_y + 0.02, -0.24)], 0.028, n=8, coll_=c, mat=iron))
        obs.append(U.tube('penstock_frame_leg', [P(ss, spec.LEDGE_Y, 0.07), P(ss, shaft_y + 0.02, -0.24)], 0.028, n=8, coll_=c, mat=iron))
        obs.append(U.tube('penstock_frame_bar', [P(ss, cy, -0.42), P(ss, cy, -0.06)], 0.02, n=8, coll_=c, mat=iron))
    arm_c = P(2.92, cy, -0.24)
    handle = arm_c + up * 0.0 + t * 0.0
    obs.append(U.tube('penstock_crank', [arm_c, arm_c + (-t * 0.22 + up * 0.17)], 0.018, n=8, coll_=c, mat=iron, flat=0.5))
    hp = arm_c + (-t * 0.22 + up * 0.17)
    obs.append(U.tube('penstock_handle', [hp + n * 0.0, hp + n * 0.16], 0.022, n=10, coll_=c, mat=mats['wood']))
    # pawl chain hanging from the frame
    obs.append(PR.chain('penstock_chain', P(2.42, cy - 0.05, -0.06), P(2.6, spec.LEDGE_Y + 0.3, 0.25), 0.25, 26, iron, c))
    for o in obs:
        if o.type == 'MESH' and not any(m.type == 'BEVEL' for m in o.modifiers) and o.name.startswith('penstock_'):
            PR.bevel_mod(o, 0.003, 2, 35)
    return obs

# ------------------------------------------------------------------ drains, pipes
def drains(g, mats, c, rng, ring_meshes):
    p = g.path
    obs = []
    ang = np.linspace(0, 2 * np.pi, 48, endpoint=False)
    for di, (du, side) in enumerate(DRAINS):
        # egg outline in (du, dy) around the invert
        t = np.linspace(0, 1.6, 200)
        hw = G.egg_hw(t)
        outline = np.concatenate([np.stack([hw, t], -1), np.stack([-hw[::-1], t[::-1]], -1)])
        seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(outline, axis=0), axis=1))]
        k = 40
        tt = np.linspace(0, seg[-1], k, endpoint=False)
        ol = np.stack([np.interp(tt, seg, outline[:, 0]), np.interp(tt, seg, outline[:, 1])], -1)
        # lining tube: from the shell surface out into the wall
        depth = np.linspace(0, 1.0, 12) ** 1.0
        s_surf = G.shell_s_at_y(DRAIN_YB + ol[:, 1]) - 0.03
        Pp = np.zeros((len(depth), k, 3))
        UV = np.zeros((len(depth), k, 2))
        for i, dd in enumerate(depth):
            ss = side * (s_surf + dd * (4.6 - s_surf))
            Pp[i] = p.world(du + ol[:, 0], ss, DRAIN_YB + ol[:, 1])
            UV[i, :, 0] = dd * (4.6 - s_surf.mean())
            UV[i, :, 1] = tt
        A = np.zeros((*Pp.shape[:2], 4), np.float32); B = np.zeros((*Pp.shape[:2], 4), np.float32); B[..., 3] = 1
        A[..., 2] = U.smoothstep(0.5, 0.1, np.broadcast_to(ol[:, 1], Pp.shape[:2])) + 0.3
        A[..., 3] = U.smoothstep(0.25, 0.05, np.broadcast_to(ol[:, 1], Pp.shape[:2]))
        A[..., 1] = 0.3
        flip = G.orient_check(Pp, p.world(np.array(du), np.array(side * 3.4), np.array(DRAIN_YB + 0.8)))
        ob = U.grid_mesh('drain_%d_lining' % di, Pp, UV, attrs={'wxA': np.clip(A, 0, 1), 'wxB': B}, closed_v=True, flip=flip, coll_=c, mat=mats['brick_channel'])
        obs.append(ob)
        # far end cap (dark)
        cap_c = p.world(np.array(du), np.array(side * 4.6), np.array(DRAIN_YB + 0.8))
        endring = Pp[-1]
        V = np.vstack([endring, cap_c])
        F = [[i, (i + 1) % k, k] for i in range(k)]
        obs.append(U.mesh_from_faces('drain_%d_end' % di, V, F, coll_=c, mat=mats['soot_black']))
        # two rings of header bricks on edge round the mouth
        for ring, (r0, r1) in enumerate(((0.0, 0.1), (0.1, 0.2))):
            # outline offset outward
            nrm = np.stack([np.gradient(outline[:, 1]), -np.gradient(outline[:, 0])], -1)
            nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
            if np.mean(np.sum(nrm * (outline - outline.mean(0)), 1)) < 0:
                nrm = -nrm
            ofs = outline + nrm * (r0 + r1) / 2
            seg2 = np.r_[0, np.cumsum(np.linalg.norm(np.diff(ofs, axis=0), axis=1))]
            nb = int(seg2[-1] / 0.062)
            for b in range(nb):
                q = (b + 0.5) * seg2[-1] / nb
                cu = np.interp(q, seg2, ofs[:, 0]); cyy = np.interp(q, seg2, ofs[:, 1])
                q1, q2 = max(q - 0.02, 0), min(q + 0.02, seg2[-1])
                tu = np.interp(q2, seg2, ofs[:, 0]) - np.interp(q1, seg2, ofs[:, 0])
                ty = np.interp(q2, seg2, ofs[:, 1]) - np.interp(q1, seg2, ofs[:, 1])
                if cyy < -0.02:
                    continue
                y_w = DRAIN_YB + cyy
                s_w = G.shell_s_at_y(y_w)
                pos = p.world(np.array(du + cu), np.array(side * (s_w + 0.07)), np.array(y_w))
                px, pz, tx, tz, nx, nz = p.frame(np.array(du + cu))
                T3 = np.array([float(tx), 0, float(tz)]); N3 = np.array([float(nx), 0, float(nz)]) * side
                tang = T3 * tu + np.array([0, 1.0, 0]) * ty
                tang /= np.linalg.norm(tang) + 1e-9
                rad = np.cross(tang, N3); rad /= np.linalg.norm(rad)
                if np.dot(rad, T3 * (cu) + np.array([0, 1, 0]) * (cyy - 0.8)) < 0:
                    rad = -rad
                me = ring_meshes[rng.integers(len(ring_meshes))]
                o = bpy.data.objects.new('drain_%d_ringbrick' % di, me)
                c.objects.link(o)
                o.matrix_world = PR.frame_matrix(pos + rng.normal(0, 0.003, 3), tang, rad, N3)
                obs.append(o)
        # silt and a trickle in the invert
        inv = [p.world(np.array(du), np.array(side * ss), np.array(DRAIN_YB + 0.03)) for ss in np.linspace(4.4, G.shell_s_at_y(DRAIN_YB) - 0.02, 8)]
        obs.append(U.tube('drain_%d_trickle' % di, inv, 0.05, n=8, coll_=c, mat=mats['water_film'], flat=0.12))
        # the dribble: over the lip, down to the ledge, across it, over the coping into the channel
        if di in (0, 2, 3):
            lip_s = W2 - 0.02
            us = du + rng.normal(0, 0.05)
            pts = [p.world(np.array(us), np.array(side * lip_s), np.array(DRAIN_YB + 0.02)),
                   p.world(np.array(us), np.array(side * (lip_s - 0.06)), np.array(DRAIN_YB - 0.05)),
                   p.world(np.array(us), np.array(side * (lip_s - 0.1)), np.array(spec.LEDGE_Y + 0.015))]
            obs.append(U.tube('drain_%d_fall' % di, pts, [0.012, 0.009, 0.012], n=8, coll_=c, mat=mats['water_film']))
            pts = [p.world(np.array(us + 0.02 * np.sin(k_)), np.array(side * ss), np.array(spec.LEDGE_Y + 0.006)) for k_, ss in enumerate(np.linspace(lip_s - 0.1, 1.47, 10))]
            obs.append(U.tube('drain_%d_film' % di, pts, 0.06, n=8, coll_=c, mat=mats['water_film'], flat=0.08))
            pts = [p.world(np.array(us), np.array(side * 1.44), np.array(spec.LEDGE_Y)),
                   p.world(np.array(us), np.array(side * 1.40), np.array(spec.LEDGE_Y - 0.15)),
                   p.world(np.array(us), np.array(side * 1.33), np.array(spec.LEDGE_Y - 0.6)),
                   p.world(np.array(us), np.array(side * 1.28), np.array(spec.WATER_Y))]
            obs.append(U.tube('drain_%d_spout' % di, pts, [0.03, 0.02, 0.012, 0.01], n=8, coll_=c, mat=mats['water_film'], flat=0.35))
            g.wet_ledge = getattr(g, 'wet_ledge', []) + [(us, side)]
    return obs

def pipes(g, mats, c):
    p = g.path
    obs = []
    for (pu, side, py) in PIPES:
        a = p.world(np.array(pu), np.array(side * 3.7), np.array(py))
        b = p.world(np.array(pu), np.array(side * 2.8), np.array(py - 0.02))
        obs.append(U.tube('pipe_end', [a, b], 0.13, n=20, coll_=c, mat=mats['iron_wet'], cap=False))
        bb = p.world(np.array(pu), np.array(side * 2.86), np.array(py - 0.018))
        obs.append(U.tube('pipe_socket', [bb, b], 0.165, n=20, coll_=c, mat=mats['iron_wet'], cap=False))
        bk = [p.world(np.array(pu + du_), np.array(side * 3.12), np.array(py + dy_)) for (du_, dy_) in ((-0.3, -0.3), (0.3, -0.3), (0.3, 0.3), (-0.3, 0.3))]
        obs.append(U.mesh_from_faces('pipe_backing', bk, [[0, 1, 2, 3], [3, 2, 1, 0]], coll_=c, mat=mats['soot_black'], smooth=False))
        inner = U.tube('pipe_inner', [p.world(np.array(pu), np.array(side * 3.4), np.array(py)), b], 0.118, n=20, coll_=c, mat=mats['soot_black'], cap=True)
        obs.append(inner)
        # trickle out of the pipe down to the ledge
        pts = [b + np.array([0, -0.11, 0]), p.world(np.array(pu), np.array(side * 2.74), np.array(py - 0.25)), p.world(np.array(pu), np.array(side * 2.72), np.array(spec.LEDGE_Y + 0.01))]
        obs.append(U.tube('pipe_trickle', pts, [0.008, 0.006, 0.01], n=8, coll_=c, mat=mats['water_film']))
    return obs

# ------------------------------------------------------------------ grate shaft, step irons, ladder
def shaft(g, mats, c):
    p = g.path
    su = g.shaft_u
    obs = []
    s0, s1 = SHAFT_S - SHAFT_H, SHAFT_S + SHAFT_H
    top = -0.28
    def wall(name, fu, fs, n_a, flip_pt):
        # fu, fs: functions of parameter a in [0,1] giving u, s; height from vault to top
        a = np.linspace(0, 1, n_a)
        uu, ss = fu(a), fs(a)
        ybot = G.shell_y_at_s(ss) - 0.12
        yy = np.linspace(0, 1, 18)
        Uu = np.broadcast_to(uu[:, None], (n_a, 18)); Ss = np.broadcast_to(ss[:, None], (n_a, 18))
        Y = ybot[:, None] + (top - ybot[:, None]) * yy[None]
        P = p.world(Uu, Ss, Y)
        UV = np.stack([a[:, None] * 0.66 + 0 * Y, Y], -1)
        A = np.zeros((*P.shape[:2], 4), np.float32); B = np.zeros((*P.shape[:2], 4), np.float32); B[..., 3] = 1
        A[..., 2] = 0.55; A[..., 0] = 0.35 * U.smoothstep(-0.6, -1.4, Y); A[..., 1] = 0.1
        flip = G.orient_check(P, flip_pt)
        return U.grid_mesh(name, P, UV, attrs={'wxA': A, 'wxB': B}, flip=flip, coll_=c, mat=mats['brick_vault'])
    ctr = p.world(np.array(su), np.array(SHAFT_S), np.array(-1.0))
    obs.append(wall('shaft_wall_out', lambda a: su - SHAFT_H + a * 2 * SHAFT_H, lambda a: np.full_like(a, s1), 12, ctr))
    obs.append(wall('shaft_wall_in', lambda a: su - SHAFT_H + a * 2 * SHAFT_H, lambda a: np.full_like(a, s0), 12, ctr))
    obs.append(wall('shaft_wall_a', lambda a: np.full_like(a, su - SHAFT_H), lambda a: s0 + a * (s1 - s0), 12, ctr))
    obs.append(wall('shaft_wall_b', lambda a: np.full_like(a, su + SHAFT_H), lambda a: s0 + a * (s1 - s0), 12, ctr))
    # cast iron grate: frame and bars at street level
    def P(u, s, y):
        return p.world(np.array(u), np.array(s), np.array(y))
    iron = mats['iron']
    fr = []
    for (ua, ub, sa, sb) in ((su - SHAFT_H - 0.08, su + SHAFT_H + 0.08, s0 - 0.08, s0), (su - SHAFT_H - 0.08, su + SHAFT_H + 0.08, s1, s1 + 0.08),
                             (su - SHAFT_H - 0.08, su - SHAFT_H, s0, s1), (su + SHAFT_H, su + SHAFT_H + 0.08, s0, s1)):
        C = np.array([P(ua if not (j & 1) else ub, top if not (j & 2) else -0.005, sa if not (j & 4) else sb) for j in range(8)])
        fr.append(U.block_object('grate_frame', C, iron, c, r=0.004, res=0.05, chips=0))
    for k, ss in enumerate(np.linspace(s0 + 0.04, s1 - 0.04, 9)):
        C = np.array([P(su - SHAFT_H if not (j & 1) else su + SHAFT_H, -0.09 if not (j & 2) else -0.005, ss - 0.012 if not (j & 4) else ss + 0.012) for j in range(8)])
        fr.append(U.block_object('grate_bar', C, iron, c, r=0.003, res=0.05, chips=0))
    for k, uu in enumerate((su - 0.12, su + 0.12)):
        C = np.array([P(uu - 0.015 if not (j & 1) else uu + 0.015, -0.12 if not (j & 2) else -0.05, s0 if not (j & 4) else s1) for j in range(8)])
        fr.append(U.block_object('grate_crossbar', C, iron, c, r=0.003, res=0.05, chips=0))
    obs += fr
    # street setts round the grate (seen from below only through the bars)
    xx = np.linspace(-1.5, 1.5, 13)
    Uu, Ss = np.meshgrid(su + xx, SHAFT_S + xx, indexing='ij')
    Pp = p.world(Uu, Ss, np.zeros_like(Uu))
    keep = ~((np.abs(0.5 * (Uu[1:, 1:] + Uu[:-1, :-1]) - su) < SHAFT_H + 0.08) & (np.abs(0.5 * (Ss[1:, 1:] + Ss[:-1, :-1]) - SHAFT_S) < SHAFT_H + 0.08))
    obs.append(U.grid_mesh('shaft_street', Pp, np.stack([Uu, Ss], -1), keep=keep, flip=G.orient_check(Pp, Pp[0, 0] + np.array([0, 1.0, 0])), coll_=c, mat=mats['paving']))
    # step irons in the outer shaft wall, staggered
    y = -0.5
    k = 0
    while y > G.shell_y_at_s(s1) + 0.1:
        off = 0.1 if k % 2 else -0.1
        a = P(su + off - 0.13, y, s1 + 0.05); b = P(su + off - 0.13, y, s1 - 0.11); cc = P(su + off + 0.13, y, s1 - 0.11); d = P(su + off + 0.13, y, s1 + 0.05)
        obs.append(U.tube('step_iron', [a, b + (a - b) * 0.0, cc, d], 0.014, n=8, coll_=c, mat=iron))
        y -= 0.3
        k += 1
    # wrought iron ladder from the ledge up to the shaft
    lad_s = s1 - 0.14
    y_top = G.shell_y_at_s(s1) + 0.25
    for du in (-0.2, 0.2):
        obs.append(U.tube('ladder_stringer', [P(su + du, spec.LEDGE_Y - 0.01, lad_s), P(su + du, y_top, lad_s), P(su + du, y_top + 0.12, lad_s + 0.12)], 0.016, n=8, coll_=c, mat=iron, flat=0.4))
    for yy in np.arange(spec.LEDGE_Y + 0.28, y_top - 0.05, 0.28):
        obs.append(U.tube('ladder_rung', [P(su - 0.2, yy, lad_s), P(su + 0.2, yy, lad_s)], 0.013, n=8, coll_=c, mat=iron))
    for yy in (spec.LEDGE_Y + 0.9, spec.LEDGE_Y + 1.6):
        ws = G.shell_s_at_y(yy)
        for du in (-0.2, 0.2):
            obs.append(U.tube('ladder_stay', [P(su + du, yy, lad_s), P(su + du, yy, ws + 0.06)], 0.01, n=6, coll_=c, mat=iron))
    return obs

# ------------------------------------------------------------------ lamp on its bracket
def lamp(g, mats, c, power=7.0):
    p = g.path
    wall_y = -2.12
    ws = G.shell_s_at_y(wall_y)
    wall_pt = p.world(np.array(LAMP_U), np.array(ws), np.array(wall_y))
    inner = p.world(np.array(LAMP_U), np.array(ws - 1.0), np.array(wall_y))
    d = inner - wall_pt
    parts, hook = PR.lamp_bracket('lamp_bracket', wall_pt, d, 0.34, mats['iron'], c)
    lampob, light = PR.safety_lamp('gallery_lamp', mats, c, light_power=power)
    lampob.location = U.gv(*hook)
    lampob.rotation_euler = (0.03, -0.02, 0.4)
    return parts + [lampob], light, hook

def rings(g, mats, c, rng):
    obs = []
    p = g.path
    for k, uu in enumerate(np.arange(4.5, g.u1 - 1, 6.8)):
        side = 1 if k % 2 else -1
        loc = p.world(np.array(uu), np.array(side * (spec.GAL_CHANNEL_W / 2 - 0.04)), np.array(spec.LEDGE_Y - 0.12))
        px, pz, tx, tz, nx, nz = p.frame(np.array(uu))
        fd = -side * np.array([float(nx), 0, float(nz)])
        obs += PR.ring_on_staple('mooring_ring_%d' % k, loc, fd, mats['iron_wet'], c, R=0.07)
    return obs

# ------------------------------------------------------------------ straws, drips and rubble
def straws(g, straw_meshes, drop, c, rng):
    p = g.path
    obs = []
    s_p, y_p, v_p, vtot = G.shell_profile(g.dv)
    pts = []
    for (su, sv, st) in g.seeps:
        n = int(st * rng.integers(1, 5))
        for i in range(n):
            u = su + rng.normal(0, 0.12)
            v = sv + rng.normal(0, 0.06)
            pts.append((u, v, st))
    for (u, v, st) in pts:
        s = np.interp(v, v_p, s_p); y = np.interp(v, v_p, y_p)
        if y < -2.6 or u < 1.0 or u > g.u1 - 0.2:
            continue
        pos = p.world(np.array(u), np.array(s * 0.995), np.array(y + 0.004))
        me = straw_meshes[rng.integers(len(straw_meshes))]
        o = bpy.data.objects.new('straw', me)
        c.objects.link(o)
        o.location = U.gv(*pos)
        L = min(0.26, 0.012 + rng.gamma(1.4, 0.035) * (0.6 + st))
        sc = rng.uniform(0.8, 1.3)
        o.scale = (sc, sc, L)
        o.rotation_euler = (rng.normal(0, 0.05), rng.normal(0, 0.05), rng.uniform(0, 6.28))
        obs.append(o)
        if rng.random() < 0.5:
            d = bpy.data.objects.new('drip', drop)
            c.objects.link(d)
            d.location = U.gv(pos[0], pos[1] - L - 0.006, pos[2])
            obs.append(d)
    return obs

def rubble(g, brick_meshes, c, rng):
    p = g.path
    pts = []
    for side in (-1, 1):
        for k in range(70):
            u = rng.uniform(1.5, g.u1 - 0.3)
            # mostly at the wall foot and in front of the drains
            s = side * (W2 - abs(rng.normal(0, 0.25)) - 0.05)
            if rng.random() < 0.25:
                s = side * rng.uniform(2.0, 2.9)
            pts.append(p.world(np.array(u), np.array(s), np.array(spec.LEDGE_Y + 0.025)))
    return PR.scatter_instances(brick_meshes, pts, rng, c, 'rubble_brick', tilt=0.2)
