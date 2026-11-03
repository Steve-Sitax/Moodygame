# R3, the covered side-drain crossing (Steve, #272, 2026-11-03), and the plain drain mouth on the far wall.
# Where a plan side drain (ruien-routes.json sideDrains, 1.0 x 1.6 m egg) meets a rui on its walkway side,
# the egg drain comes through the wall inside an arch rim (kit/arch_rim.py: one proud brick band with a one-brick
# reveal, standing on the sill); its water runs in a
# recessed gutter across the walkway, under a flush cast-iron grate in a notched bluestone sill, and spills
# over the lip into the channel. The host vault and the walkway are cut with the pieces' own outlines
# (exact boolean), the coping is re-laid round the sill; nothing is laid over an uncut surface.
# On the far wall the same egg mouth opens just above the water: its rim stands on a notched bluestone sill (the
# egg's tight invert would stretch a brick chart), and the water spills over the sill's lip into the channel.
import numpy as np
import bpy
from rlib import util as U, gallery as G, wax as WX
from . import fitlib as FL, arch_rim as AR

# ------------------------------------------------------------------ plan matching
def find(routes, path, sec, shafts_u, cfg, log=print, zones=()):
    """Side drains whose end meets this route. Returns [{'u', 'side', 'bend', 'kind'}], kind 'crossing'
    (walkway side) or 'mouth' (the far wall), spaced apart and kept off the ends and the shaft ladders."""
    out = []
    L = path.length
    for dr in routes['sideDrains']:
        D = np.asarray(dr, float)
        for end, rest in ((D[0], D[1:]), (D[-1], D[-2::-1])):
            u, dist = path.u_near(end[0], end[1])
            if dist > cfg['match']:
                continue
            px, pz, tx, tz, nx, nz = path.frame(np.array(u))
            # the first drain point clear of the route gives the side it comes from and the way it runs
            far = None
            for q in rest:
                s_q = (q[0] - float(px)) * float(nx) + (q[1] - float(pz)) * float(nz)
                if abs(s_q) > sec.hw * 0.6:
                    far = q; break
            if far is None:
                continue
            s_q = (far[0] - float(px)) * float(nx) + (far[1] - float(pz)) * float(nz)
            du_q = (far[0] - float(px)) * float(tx) + (far[1] - float(pz)) * float(tz)
            side = 1 if s_q > 0 else -1
            out.append(dict(u=float(u), side=side, bend=float(np.sign(du_q)) if abs(du_q) > 0.5 else 0.0,
                            kind='crossing' if side in sec.sides else 'mouth', plan=[list(map(float, end)), list(map(float, far))]))
    out.sort(key=lambda d: d['u'])
    kept = []
    for d in out:
        u = float(np.clip(d['u'], cfg['minFromEnd'], L - cfg['minFromEnd']))
        if d['kind'] == 'crossing':
            for su in shafts_u:
                if abs(u - su) < cfg['minFromShaft']:
                    u = su - cfg['minFromShaft'] if u < su else su + cfg['minFromShaft']
        if any(za - cfg['minFromEnd'] < u < zb + cfg['minFromEnd'] for za, zb in zones):
            log('drain at u %.1f (%s) skipped: at a junction' % (d['u'], d['kind'])); continue
        if u < cfg['minFromEnd'] or u > L - cfg['minFromEnd']:
            log('drain at u %.1f (%s) skipped: no room clear of the ends and shafts' % (d['u'], d['kind'])); continue
        if any(abs(u - k['u']) < cfg['minApart'] and k['side'] == d['side'] for k in kept):
            log('drain at u %.1f (%s) joins its neighbour' % (d['u'], d['kind'])); continue
        if d['kind'] == 'crossing' and any(abs(u - k['u']) < 1.2 for k in kept):
            continue
        d['u_plan'], d['u'] = d['u'], round(u, 3)
        kept.append(d)
    return kept

# ------------------------------------------------------------------ egg outline
def egg_outline(h=1.6, w=1.0, step=0.02):
    """Closed counter-clockwise outline (x, height above the invert), resampled by arc length."""
    t = np.linspace(0, h, 400)
    hw = G.egg_hw(t, h, w)
    Q = np.concatenate([np.stack([hw, t], -1), np.stack([-hw[::-1], t[::-1]], -1)[1:-1]])
    seg = np.linalg.norm(np.diff(np.vstack([Q, Q[:1]]), axis=0), axis=1)
    A = np.r_[0, np.cumsum(seg)]
    n = int(A[-1] / step)
    a = np.linspace(0, A[-1], n, endpoint=False)
    Qc = np.vstack([Q, Q[:1]])
    return np.stack([np.interp(a, A, Qc[:, 0]), np.interp(a, A, Qc[:, 1])], -1), A[-1]

class Egg:
    def __init__(self, h, w):
        self.Q, self.total = egg_outline(h, w, 0.005)
        self.N = -FL.inward(self.Q)  # outward
        self.h, self.w = h, w

    def at(self, a):
        a = np.asarray(a, float) % self.total
        i = (a / self.total * len(self.Q)).astype(int) % len(self.Q)
        f = (a / self.total * len(self.Q)) - np.floor(a / self.total * len(self.Q))
        j = (i + 1) % len(self.Q)
        q = self.Q[i] * (1 - f)[..., None] + self.Q[j] * f[..., None]
        n = self.N[i] * (1 - f)[..., None] + self.N[j] * f[..., None]
        return q, n / np.linalg.norm(n, axis=-1, keepdims=True)

# ------------------------------------------------------------------ pieces
def barrel_line(cfg, bend):
    """Centre line of the barrel in (du, d): straight into the wall, a bend towards the drain's run, straight, sealed."""
    a, R, ang, c = cfg['barrel']
    pts, tans = [], []
    for dd in np.linspace(0, a, 10):
        pts.append(np.array([0.0, -dd])); tans.append(np.array([0.0, -1.0]))
    b = bend if bend != 0 else 1.0
    T0 = np.array([0.0, -1.0]); X0 = np.array([1.0, 0.0])
    cen = pts[-1] + X0 * R * b
    for t in np.linspace(0, np.radians(ang), 14)[1:]:
        ca, sa = np.cos(t * b), np.sin(t * b)
        T = np.array([ca * T0[0] - sa * T0[1], sa * T0[0] + ca * T0[1]])
        r0 = pts[9] - cen
        rr = np.array([ca * r0[0] - sa * r0[1], sa * r0[0] + ca * r0[1]])
        pts.append(cen + rr); tans.append(T)
    for _ in range(5):
        pts.append(pts[-1] + tans[-1] * (c / 5)); tans.append(tans[-1])
    return np.array(pts), np.array(tans)

def lining(name, fr, egg, y_inv, cfg, bend, mats, coll, start=0.0):
    """The egg barrel's brick lining from `start` behind the wall face (the arch rim's back) round its bend to a
    sealed, dark end."""
    C, T = barrel_line(cfg, bend)
    if start > 0:
        keep = np.r_[0, np.nonzero(-C[:, 1] > start + 0.03)[0]]
        C, T = C[keep], T[keep]
    Q = egg.Q[::8]
    k = len(Q)
    X = np.stack([-T[:, 1], T[:, 0]], -1)          # horizontal across the barrel
    m = len(C)
    P = np.zeros((m, k, 3)); UV = np.zeros((m, k, 2))
    along = np.r_[0, np.cumsum(np.linalg.norm(np.diff(C, axis=0), axis=1))]
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    for i in range(m):
        du = C[i, 0] + X[i, 0] * Q[:, 0]
        dd = C[i, 1] + X[i, 1] * Q[:, 0]
        y = y_inv + Q[:, 1]
        if i == 0:
            dd = fr.d_face(y) - start + (0.003 if start == 0 else 0.0)   # starts inside the rim's back (or on the face)
        P[i] = fr.W(du, y, dd)
        UV[i, :, 0] = along[i]; UV[i, :, 1] = arc
    h = np.broadcast_to(Q[:, 1], (m, k))
    depth = np.broadcast_to(along[:, None], (m, k))
    A = np.zeros((m, k, 4), np.float32); B = np.zeros((m, k, 4), np.float32); B[..., 3] = 1
    A[..., 2] = np.clip(U.smoothstep(0.55, 0.05, h) + 0.3, 0, 1)            # slime low
    A[..., 3] = U.smoothstep(0.3, 0.02, h) * 0.9                              # street silt in the invert
    A[..., 1] = 0.25 + 0.5 * U.smoothstep(0.5, 2.5, depth)                    # soot and grime deeper in
    A[..., 0] = 0.25 * U.smoothstep(0.9, 1.5, h) * U.smoothstep(1.2, 0.2, depth)
    Cc = np.zeros((m, k, 4), np.float32); Cc[..., 2] = U.smoothstep(0.4, 0.0, h)
    axis = fr.W(C[m // 2, 0], y_inv + egg.h * 0.55, C[m // 2, 1])
    flip = G.orient_check(P, axis)
    ob = U.grid_mesh(name, P, UV, attrs={'wxA': A, 'wxB': B, 'wxC': Cc}, closed_v=True, flip=flip, coll_=coll, mat=mats['brick_channel'])
    U.add_adaptive(ob)
    # sealed far end beyond sight: a dark fan
    cen = fr.W(C[-1, 0], y_inv + egg.h * 0.5, C[-1, 1])
    V = np.vstack([P[-1], cen])
    F = [[i, (i + 1) % k, k] for i in range(k)]
    end = U.mesh_from_faces(name + '_end', V, F, coll_=coll, mat=mats['soot_black'], smooth=False)
    me = end.data
    if np.dot(np.array(me.polygons[0].normal), U.g2b(fr.W(C[-2, 0], y_inv + 0.8, C[-2, 1])) - np.array(me.polygons[0].center)) < 0:
        me.flip_normals()
    return [ob, end], C

def rim_cfg(cfg):
    w, st, dp, pr = cfg['rim']
    return dict(width=w, step=st, depth=dp, proud=pr)

def egg_above(egg, y_rel):
    """The egg's clear outline above height y_rel over the invert, from one foot over the crown to the other foot."""
    Q = egg.Q
    hw = float(G.egg_hw(y_rel, egg.h, egg.w))
    top = Q[Q[:, 1] > y_rel + 1e-4]
    i0 = int(np.argmax(Q[:, 1] > y_rel + 1e-4))
    seq = np.roll(Q, -i0, 0); seq = seq[: len(top)]
    return np.vstack([[hw, y_rel], seq, [-hw, y_rel]])

def drain_rim(name, mf, egg, y_inv, foot_rel, cfg, mats, coll, masks, seed):
    """The arch rim round an egg mouth (mf: the metric wall frame, arch_rim.RouteWall), standing at foot_rel over the
    invert; returns the rim, its outer half width at the feet (the sill under it is wider) and the clear outline."""
    rc = rim_cfg(cfg)
    Q = egg_above(egg, foot_rel)
    ob = AR.rim(name + '_rim', np.stack([Q[:, 0], y_inv + Q[:, 1]], -1), mf, mats['brick_rib'], coll,
                masks=masks, seed=seed, **rc)
    return ob, float(G.egg_hw(foot_rel, egg.h, egg.w)) + rc['step'] + rc['width'], Q

def rim_cut(fr, y_inv, Q, rc, sill_half, y_bottom):
    """Closed outline (du, y - y_inv) of the host cut: the rim's outer edge less 6 mm, then out along the feet to the
    sill and down below it."""
    O = AR.outer_outline(Q, rc['step'] + rc['width'] - 0.006, False)
    y_f = Q[0, 1]
    xs = sill_half - 0.006
    return np.vstack([[[xs, y_bottom], [xs, y_f]], O, [[-xs, y_f], [-xs, y_bottom]]])[::-1]

def far_sill_profile(egg, foot_rel, half, bottom_rel):
    """The far mouth's sill: a bluestone block under the rim's feet with the egg's invert notched out of its top."""
    Q = egg.Q
    above = np.nonzero(Q[:, 1] > foot_rel)[0]
    i0 = int(above[-1]) + 1                               # Q is ccw from the invert: the low run starts down the left side
    loop = np.roll(Q, -i0, 0)[: len(Q) - len(above)]
    hw = float(G.egg_hw(foot_rel, egg.h, egg.w))
    notch = np.vstack([[-hw, foot_rel], loop, [hw, foot_rel]])
    notch = notch[np.r_[True, np.linalg.norm(np.diff(notch, axis=0), axis=1) > 0.004]]
    outer = np.array([[half, foot_rel], [half, bottom_rel], [-half, bottom_rel], [-half, foot_rel]])
    P = np.vstack([notch, outer])
    R = [0.0] * len(P)
    R[0] = R[len(notch) - 1] = 0.008                      # the notch lips: worn
    R[len(notch)] = R[-1] = 0.009                         # the outer top arrises
    R[len(notch) + 1] = R[len(notch) + 2] = 0.004
    return FL.resample_closed(FL.fillet_polygon(P, R, n=4), 0.04)

def sill_profile(cfg, top, bottom, floor, rebate):
    W, n = cfg['sillHalf'], cfg['notch'] / 2
    rw, rd = cfg['rebate']
    if rebate:
        Q = [(-W, bottom), (W, bottom), (W, top), (n + rw, top), (n + rw, top - rd), (n, top - rd), (n, floor), (-n, floor),
             (-n, top - rd), (-n - rw, top - rd), (-n - rw, top), (-W, top)]
        R = [0.004, 0.004, 0.01, 0.007, 0.006, 0.006, 0.022, 0.022, 0.006, 0.006, 0.007, 0.01]  # every corner >= the end rounding
    else:
        Q = [(-W, bottom), (W, bottom), (W, top), (n, top), (n, floor), (-n, floor), (-n, top), (-W, top)]
        R = [0.004, 0.004, 0.01, 0.008, 0.022, 0.022, 0.008, 0.01]
    return FL.resample_closed(FL.fillet_polygon(np.array(Q), R, n=5), 0.04)

def coping_block(name, path, sec, side, u, L, mats, coll, seed):
    """The sweep's coping block (sweep.build_lower), for re-laying the coping round a sill."""
    rng = np.random.default_rng(seed)
    lo, hi = sec.channel_edges(); edge = hi if side > 0 else lo
    V, F = U.chipped_block(L - 0.003, 0.25, 0.4, r=rng.uniform(0.006, 0.012), res=0.055, seed=seed, chips=int(rng.integers(5, 11)),
                           chip_size=(0.02, 0.07), wear_top=0.012, corners=int(rng.integers(0, 3)), wobble=0.0009)
    Pw = path.world(u + L / 2 + V[:, 0], edge + side * (0.2 - 0.04) + side * V[:, 2], sec.ledge_y - 0.125 + V[:, 1])
    if side > 0:
        F = F[:, ::-1]
    return U.mesh_from_faces(name, Pw, F, uv=U.box_uv(V, F), coll_=coll, mat=mats['bluestone'])

def relay_coping(g, sec, side, ua, ub, mats, coll):
    """Remove the coping blocks over [ua, ub] and re-lay the remainder up to the sill's ends."""
    path = g.path
    pre = '%s_coping_' % g.name
    spans = []
    for o in [o for o in coll.objects if o.name.startswith(pre)]:
        P = FL.mesh_points(o)
        c = P.mean(0)
        u, _ = path.u_near(c[0], c[2])
        px, pz, tx, tz, nx, nz = path.frame(np.array(u))
        s_c = (c[0] - float(px)) * float(nx) + (c[2] - float(pz)) * float(nz)
        if np.sign(s_c) != side:
            continue
        t = (P[:, 0] - float(px)) * float(tx) + (P[:, 2] - float(pz)) * float(tz)
        spans.append((u + t.min(), u + t.max(), o))
    spans.sort(key=lambda s: s[0])
    hit = [s for s in spans if s[1] > ua and s[0] < ub]
    if not hit:
        return []
    lo_u = min(s[0] for s in hit); hi_u = max(s[1] for s in hit)
    # a remainder shorter than 15 cm takes its neighbour with it
    if 0 < ua - lo_u < 0.15:
        prev = [s for s in spans if s not in hit and s[1] <= lo_u + 0.02]
        if prev:
            hit.append(prev[-1]); lo_u = prev[-1][0]
    if 0 < hi_u - ub < 0.15:
        nxt = [s for s in spans if s not in hit and s[0] >= hi_u - 0.02]
        if nxt:
            hit.append(nxt[0]); hi_u = nxt[0][1]
    for (_, _, o) in hit:
        me = o.data; bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    obs = []
    for (a, b) in ((lo_u, ua), (ub, hi_u)):
        Ln = b - a
        if Ln < 0.06:
            continue
        parts = max(1, int(np.ceil(Ln / 1.1)))
        for k in range(parts):
            u0 = a + Ln * k / parts
            obs.append(coping_block('%s_relaid_%03d' % (pre, len(obs)), path, sec, side, u0, Ln / parts, mats, coll, int(u0 * 1000) + 7))
    return obs

def grate(name, fr, cfg, top, d0, d1, mats, coll):
    n = cfg['notch'] / 2; rw, rd = cfg['rebate']
    iron = mats['iron']
    obs = []
    for sg in (-1, 1):   # frame sides in the rebate
        a, b = sorted((sg * (n + 0.002), sg * (n + rw - 0.002)))
        obs.append(FL.frame_box(name + '_frame', fr, a, b, top - rd + 0.001, top, d0, d1, iron, coll, r=0.002))
    for (da, db) in ((d0, d0 + 0.024), (d1 - 0.024, d1)):
        obs.append(FL.frame_box(name + '_frame', fr, -(n + 0.004), n + 0.004, top - rd + 0.001, top, da, db, iron, coll, r=0.002))
    nb = cfg['grateBars']
    for x in np.linspace(-n + 0.03, n - 0.03, nb):
        obs.append(FL.frame_box(name + '_bar', fr, x - 0.009, x + 0.009, top - rd + 0.002, top - 0.001, d0 + 0.02, d1 - 0.02, iron, coll, r=0.002))
    for t in (0.36, 0.64):
        dm = d0 + (d1 - d0) * t
        obs.append(FL.frame_box(name + '_tie', fr, -n + 0.002, n - 0.002, top - rd - 0.004, top - 0.013, dm - 0.008, dm + 0.008, iron, coll, r=0.002))
    return FL.no_collision(obs)

def water_mat(mats, name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = mats['water_film'].copy(); m.name = name
    return m

def spill(name, fr, y_lip, d_lip, y_water, width, mats, coll, v=0.55):
    """The pour from a lip into the channel: a falling, widening flattened sheet (closed, the wall film kind)."""
    T = np.sqrt(max(2 * (y_lip - y_water) / 9.81, 1e-3))
    t = np.linspace(0, T, 9)
    pts = [fr.W(0.0, y_lip - 4.905 * q * q - 0.004, d_lip + v * q) for q in t] + [fr.W(0.0, y_water - 0.08, d_lip + v * T + 0.01)]
    r = np.r_[np.linspace(width, width * 1.7, len(t)), width * 1.9]
    return U.tube(name, np.array(pts), r, n=10, coll_=coll, mat=water_mat(mats, 'Water_spout'), flat=0.22)

def build(g, sec, mats, coll, items, cfg, rng, col_coll, log=print):
    """All the plan's drains on this route. Returns (objects, collision proxies)."""
    path = g.path
    obs, proxies = [], []
    shell = bpy.data.objects.get('%s_vault' % g.name)
    egg = Egg(cfg['egg'][1], cfg['egg'][0])
    for k, it in enumerate(items):
        u, side = it['u'], it['side']
        fr = FL.Frame(path, sec, u, side)
        mf = AR.RouteWall(fr)        # true metres along the wall: the rim, its cut, the lining and the far sill
        nm = '%s_drain_%d' % (g.name, k)
        crossing = it['kind'] == 'crossing'
        y_inv = (sec.ledge_y - cfg['invertBelowWalk']) if crossing else (sec.water + cfg['farInvertAboveWater'])
        walk_y = sec.ledge_y
        raised = cfg['raised']
        top = walk_y + raised
        # ---- weather on the host face first (a cut keeps the attributes)
        cen = fr.W(0.0, y_inv + 0.8, 0.0); along = fr.along()
        def host_fn(P, M, cen=cen, along=along, y_inv=y_inv, crossing=crossing, side=side):
            du = (P - cen) @ along
            near = ((P[:, [0, 2]] - cen[[0, 2]]) @ np.array([fr.into()[0], fr.into()[2]])) > -0.8
            y = P[:, 1]
            g_ = np.exp(-0.5 * (du / 0.45) ** 2) * near
            below = np.where(y < y_inv + 0.2, 1.0, np.exp(-(y - y_inv - 0.2) / 0.5))
            M['wxA'][:, 2] += 0.6 * g_ * below
            M['wxA'][:, 0] += 0.35 * np.exp(-0.5 * (du / 0.7) ** 2) * near * U.smoothstep(y_inv + 0.9, y_inv + 1.7, y) * (y < y_inv + 2.0)
            M['wxC'][:, 3] += 0.7 * np.exp(-0.5 * (du / 0.3) ** 2) * near * (y < y_inv + 0.1)
            M['wxA'][:, 3] += 0.4 * g_ * (y < y_inv + 0.3)
        if shell is not None:
            FL.edit_masks(shell, host_fn)
        def rim_fn(P, M, host_fn=host_fn):
            M['wxA'][:, 1] += 0.3                              # the same soot and grime as the wall round it
            host_fn(P, M)
        # ---- the arch rim, standing on the sill: a crossing's sill is the walk's lip stone, the far mouth gets its own
        rc = rim_cfg(cfg)
        foot_rel = (top - 0.006 - y_inv) if crossing else cfg['farSill'][0]
        rim, rim_half, Qc = drain_rim(nm, mf, egg, y_inv, foot_rel, cfg, mats, coll, rim_fn, seed=int(rng.integers(1 << 30)))
        obs.append(rim)
        sill_half = rim_half + 0.03                            # metres along the wall
        sill_half_u = float(np.max(np.abs(mf.du(np.array([-sill_half, sill_half]), np.zeros(2)))))   # in route u (the crossing's stones)
        sill_bottom = (walk_y - 0.1 - y_inv) if crossing else -cfg['farSill'][1]
        # ---- cut the host vault with the rim's outer outline and the sill under it
        if shell is not None:
            V, F = FL.prism(rim_cut(mf, y_inv, Qc, rc, sill_half, sill_bottom + 0.006), mf, y_inv, -0.4, 0.35)
            FL.boolean_cut(shell, V, F, coll)
        part, C = lining(nm + '_lining', mf, egg, y_inv, cfg, it['bend'], mats, coll, start=AR.BACK)
        obs += part
        # trickle along the invert into the light
        inv = [mf.W(C[i, 0], y_inv + 0.006, C[i, 1]) for i in range(len(C) - 2, -1, -1)]
        wf = water_mat(mats, 'Water_film')
        if crossing:
            floor = y_inv + 0.004
            lip_d = sec.ledge_w + 0.04
            # ---- cut the walkway, re-lay the coping, set the notched sill and the grate
            walk = bpy.data.objects.get('%s_walk_%s' % (g.name, 'n' if side > 0 else 's'))
            W = cfg['sillHalf']
            if walk is not None:
                def walk_fn(P, M, cen=cen, along=along):
                    du = (P - cen) @ along
                    M['wxA'][:, 3] += 0.5 * np.exp(-0.5 * (du / 0.7) ** 2)
                    M['wxC'][:, 2] += 0.4 * np.exp(-0.5 * (du / 0.6) ** 2)
                FL.edit_masks(walk, walk_fn)
                V, F = FL.box_cutter(fr, -W - 0.003, W + 0.003, walk_y - 0.12, walk_y + 0.12, -0.25, sec.ledge_w + 0.12)
                FL.boolean_cut(walk, V, F, coll)
                # the wall-side sill carries the rim's feet: it is as wide as the rim
                V, F = FL.box_cutter(fr, -sill_half_u - 0.003, sill_half_u + 0.003, walk_y - 0.12, walk_y + 0.12, -0.25, 0.061)
                FL.boolean_cut(walk, V, F, coll)
            obs += relay_coping(g, sec, side, u - W - 0.004, u + W + 0.004, mats, coll)
            prA = sill_profile(dict(cfg, sillHalf=sill_half_u), top, y_inv - 0.08, floor, False)
            prB = sill_profile(cfg, top, walk_y - 0.25, floor, True)
            sA = FL.notched_stone(nm + '_sill', fr, prA, -0.40, 0.058, mats['bluestone'], coll, r_end=(0.006, 0.006), wear=0.003, seed=k * 7 + 1)
            sB = FL.notched_stone(nm + '_kerb', fr, prB, 0.062, lip_d, mats['bluestone'], coll, r_end=(0.006, 0.006), wear=0.004, seed=k * 7 + 2)
            obs += [sA, sB]
            gd0, gd1 = 0.075, lip_d - 0.02
            obs += grate(nm + '_grate', fr, cfg, top, gd0, gd1, mats, coll)
            # the grate is walked on as one flush plate
            n_ = cfg['notch'] / 2 + cfg['rebate'][0]
            C8, BF = FL.box_cutter(fr, -n_, n_, top - 0.04, top, gd0, gd1)
            proxies.append(U.mesh_from_faces(nm + '_grate_col', C8, BF, coll_=col_coll, smooth=False))
            # water: the invert, the notch floor under the bars, the pour over the lip
            run = inv + [fr.W(0.0, floor + 0.007, dd) for dd in np.linspace(-0.38, lip_d - 0.005, 12)]
            obs.append(FL.no_collision([U.tube(nm + '_trickle', np.array(run), 0.045, n=8, coll_=coll, mat=wf, flat=0.12)])[0])
            obs.append(FL.no_collision([spill(nm + '_spout', fr, floor + 0.004, lip_d + 0.006, sec.water, 0.032, mats, coll)])[0])
            # stains on the channel face below the lip: wet, slime and lime edges, down to the water
            face_d = sec.ledge_w
            ys = np.arange(walk_y - 0.26, sec.water + 0.02, -0.02)
            nrm = fr.W(0, 0, 1.0) - fr.W(0, 0, 0.0); nrm /= np.linalg.norm(nrm)
            for (x0, w0, w1, mat, nmn) in ((0.0, 0.16, 0.3, mats['wet_trail'], 'wet'), (-0.09, 0.03, 0.05, mats['lime_runnel'], 'lime'),
                                           (0.1, 0.025, 0.04, mats['lime_runnel'], 'lime')):
                xs = x0 + 0.015 * np.sin(ys * 9 + k)
                P = np.array([fr.W(x, y, face_d) for x, y in zip(xs, ys)])
                obs.append(FL.stain('%s_%s' % (nm, nmn), P, np.broadcast_to(nrm, P.shape), np.linspace(w0, w1, len(ys)), mat, coll))
                WX.RUNOFF_PTS.extend(list(P))
            wf_ = bpy.data.objects.get('%s_walkface_%s' % (g.name, 'n' if side > 0 else 's'))
            if wf_ is not None:
                def face_fn(P, M, cen=cen, along=along):
                    du = (P - cen) @ along
                    gg = np.exp(-0.5 * (du / 0.22) ** 2)
                    M['wxA'][:, 2] += 0.8 * gg
                    M['wxC'][:, 2] += 0.6 * gg
                FL.edit_masks(wf_, face_fn)
        else:
            # the far sill: bluestone under the rim's feet, the egg's invert notched into it, its nose proud of the wall
            nose = cfg['farSill'][2]
            pr = far_sill_profile(egg, foot_rel, sill_half, sill_bottom)
            pr = np.stack([pr[:, 0], y_inv + pr[:, 1]], -1)
            obs.append(FL.notched_stone(nm + '_sill', mf, pr, -(AR.BACK + 0.08), nose, mats['bluestone'], coll, r_end=(0.0, 0.008),
                                        wear=0.0, seed=k * 7 + 3))
            lip = mf.W(0.0, y_inv + 0.006, nose + 0.004)
            obs.append(FL.no_collision([U.tube(nm + '_trickle', np.array(inv + [mf.W(0.0, y_inv + 0.006, 0.0), lip]), 0.045, n=8, coll_=coll, mat=wf, flat=0.12)])[0])
            obs.append(FL.no_collision([spill(nm + '_spout', fr, y_inv + 0.004, nose + 0.006, sec.water, 0.03, mats, coll, v=0.35)])[0])
            ys = np.arange(y_inv + sill_bottom - 0.02, sec.water - 0.05, -0.02)
            if len(ys) > 3:
                nrm = -fr.into()
                P = np.array([fr.W(0.012 * np.sin(y * 9), y, 0.0) for y in ys])
                obs.append(FL.stain(nm + '_wet', P, np.broadcast_to(nrm, P.shape), np.linspace(0.2, 0.3, len(ys)), mats['wet_trail'], coll))
        it['pos'] = [round(float(v), 3) for v in fr.W(0.0, y_inv, 0.0)]
        log('drain %s: %s at u %.2f (plan %.2f), side %d, invert %.2f' % (nm, it['kind'], u, it['u_plan'], side, y_inv))
    return obs, proxies
