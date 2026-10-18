# Vleeshuis hall (C2): groin vaults on brick piers, walkways, gallery mouths, stair and air shaft.
import numpy as np
import bpy
import spec
from . import util as U
from . import gallery as G
from . import props as PR

X0, X1 = spec.HALL_X0, spec.HALL_X1
Z0, Z1 = spec.HALL_Z0, spec.HALL_Z1
XE = [X0] + spec.HALL_XL + [X1]
ZE = [Z0] + spec.HALL_ZL + [Z1]
PH = spec.PIER_W / 2
S = spec.HALL_SPRING_Y
C = spec.CROWN_Y
R = C - S
MOUTH_CROWN = -1.12
MOUTH_SPRING = spec.GAL_SPRING_Y
WT = spec.HALL_WALL_T

def clear(edges, i):
    a = edges[i] + (PH if i > 0 else 0.0)
    b = edges[i + 1] - (PH if i < len(edges) - 2 else 0.0)
    return a, b

S_PIER = -4.0      # free piers: arches spring just above the water (Steve's photo)
S_WALL = -2.5      # wall corbels: higher, so the wall walkways keep head room and the mouths fit
CAP_TOP = S_PIER

def is_wall(e):
    return abs(e - X0) < 1e-6 or abs(e - X1) < 1e-6 or abs(e - Z0) < 1e-6 or abs(e - Z1) < 1e-6

def corner_S(xe, ze):
    return S_WALL if (is_wall(xe) or is_wall(ze)) else S_PIER

def prof(t, a, b, Sa, Sb):
    """Half-ellipse from springing Sa at a to the crown at the middle and down to Sb at b."""
    t = np.asarray(t, np.float64)
    c, h = (a + b) / 2, (b - a) / 2
    q = np.clip((t - c) / h, -1, 1)
    Sx = np.where(q < 0, Sa, Sb)
    return C - (C - Sx) * (1 - np.sqrt(np.clip(1 - q * q, 0, 1)))

def prof2(t, a, b):
    """Profile of an arch whose ends are a and b (rib on a pier line): springing from the end type."""
    return prof(t, a, b, S_WALL if is_wall(a) else S_PIER, S_WALL if is_wall(b) else S_PIER)

def bay_S(o, oa, ob, ea, eb, along_x):
    """Springing pair for one barrel of a bay, varying linearly along the other axis o in [oa, ob]."""
    f = np.clip((np.asarray(o, np.float64) - oa) / (ob - oa), 0, 1)
    if along_x:   # profile in x, edges xa=ea, xb=eb, other axis z
        sa = corner_S(ea, oa) * (1 - f) + corner_S(ea, ob) * f
        sb = corner_S(eb, oa) * (1 - f) + corner_S(eb, ob) * f
    else:         # profile in z, edges za=ea, zb=eb, other axis x
        sa = corner_S(oa, ea) * (1 - f) + corner_S(ob, ea) * f
        sb = corner_S(oa, eb) * (1 - f) + corner_S(ob, eb) * f
    return sa, sb

def bay_prof(x, z, xa, xb, za, zb):
    sa, sb = bay_S(z, za, zb, xa, xb, True)
    yx = prof(x, xa, xb, sa, sb)
    sa2, sb2 = bay_S(x, xa, xb, za, zb, False)
    yz = prof(z, za, zb, sa2, sb2)
    return yx, yz

def arc_from_crown(t, a, b, Sa, Sb, n=48):
    """Signed arc length along the profile from the crown line to t (consistent course spacing)."""
    t = np.atleast_1d(np.asarray(t, np.float64))
    c = (a + b) / 2
    s_ = np.linspace(0, 1, n)[:, None]
    tt = c + (t[None] - c) * s_
    Sa_ = np.broadcast_to(Sa, t.shape)[None]
    Sb_ = np.broadcast_to(Sb, t.shape)[None]
    yy = prof(tt, a, b, Sa_, Sb_)
    L = np.sum(np.hypot(np.diff(tt, axis=0), np.diff(yy, axis=0)), 0)
    return np.sign(t - c) * L

def arc_len(t, a, b, n=600):
    """Arc length along a rib profile from a to t."""
    tt = np.linspace(a, b, n)
    yy = prof2(tt, a, b)
    L = np.r_[0, np.cumsum(np.hypot(np.diff(tt), np.diff(yy)))]
    return np.interp(t, tt, L)

def ceiling(x, z):
    """Hall ceiling height at plan point (vault surface, ribs ignored)."""
    x = np.atleast_1d(np.asarray(x, np.float64)); z = np.atleast_1d(np.asarray(z, np.float64))
    i = np.clip(np.searchsorted(XE, x) - 1, 0, len(XE) - 2)
    j = np.clip(np.searchsorted(ZE, z) - 1, 0, len(ZE) - 2)
    out = np.empty(np.shape(x))
    for ii in range(len(XE) - 1):
        for jj in range(len(ZE) - 1):
            m = (i == ii) & (j == jj)
            if not np.any(m):
                continue
            xa, xb = clear(XE, ii); za, zb = clear(ZE, jj)
            yx, yz = bay_prof(x[m], z[m], xa, xb, za, zb)
            out[m] = np.maximum(yx, yz)
    return out

# ------------------------------------------------------------------ features that cut the vault
WALL_DRAIN_HOLES = [('x0', 119.6, -3.15, 0.16, 0.2), ('x1', 128.4, -3.1, 0.16, 0.2), ('z1', -151.4, -3.2, 0.16, 0.2)]
STAIR = dict(x0=X0, x1=X0 + 1.2, z_open=133.55, hatch_z0=134.85, hatch_z1=Z1 - 0.1)
AIR = (-149.5, 120.81, 0.3)

def vault_hole(x, z):
    st = (x > STAIR['x0'] - 0.01) & (x < STAIR['x1'] - 0.12) & (z > STAIR['z_open'] + 0.12)
    air = (x - AIR[0]) ** 2 + (z - AIR[1]) ** 2 < (AIR[2] + 0.02) ** 2
    return st | air

def hall_weather(P, seed, kind='vault'):
    n = len(P)
    A = np.zeros((n, 4), np.float32); B = np.zeros((n, 4), np.float32); B[:, 3] = 1
    y = P[:, 1]
    nz = U.fbm3(P, seed, 2.5)
    nz2 = U.fbm3(P, seed + 1, 0.7)
    if kind == 'vault':
        A[:, 0] = 0.9 * U.smoothstep(0.55, 0.72, nz) + 0.4 * U.smoothstep(0.6, 0.75, nz2)
        A[:, 1] = 0.25 + 0.2 * nz
        A[:, 2] = 0.2 * U.smoothstep(0.5, 0.7, nz2)
    else:
        A[:, 2] = 0.6 * U.smoothstep(-2.9, -3.65, y) + 0.95 * U.smoothstep(-4.1, -4.55, y) + 0.25 * U.smoothstep(0.55, 0.7, nz2)
        A[:, 3] = 0.6 * U.smoothstep(-3.3, -3.62, y) * (y > -3.9) + 0.5 * U.smoothstep(-4.45, -4.62, y) * U.smoothstep(-4.75, -4.62, y)
        A[:, 0] = 0.55 * U.smoothstep(0.6, 0.75, nz) * U.smoothstep(-3.5, -2.6, y)
        A[:, 1] = 0.12 * U.smoothstep(-3.0, -1.0, y)
    C = np.zeros((n, 4), np.float32)
    if kind == 'vault':
        C[:, 3] = 0.9 * U.smoothstep(0.55, 0.72, nz)
    else:
        # efflorescence above the tide band, leaks running down from the vault and the caps
        C[:, 1] = 0.85 * U.smoothstep(-3.75, -3.5, y) * (1 - U.smoothstep(-2.9, -2.4, y)) * U.smoothstep(0.4, 0.6, nz2)
        streaks = U.smoothstep(0.6, 0.74, U.fbm3(P * np.array([1.0, 0.1, 1.0]), seed + 7, 0.5))
        C[:, 3] = streaks * U.smoothstep(-4.2, -3.2, y)
        A[:, 0] = np.maximum(A[:, 0], 0.7 * streaks * U.smoothstep(0.5, 0.75, U.fbm3(P, seed + 9, 0.9)) * U.smoothstep(-3.7, -2.8, y))
        A[:, 2] = A[:, 2] + 0.4 * streaks
    return np.clip(A, 0, 1), B, np.clip(C, 0, 1)

# ------------------------------------------------------------------ vault
def vault(mats, c, res=0.16):
    V_all, F_all, UV_all, D_all = [], [], [], []
    base = 0
    for i in range(len(XE) - 1):
        for j in range(len(ZE) - 1):
            xa, xb = clear(XE, i); za, zb = clear(ZE, j)
            cx, cz = (xa + xb) / 2, (za + zb) / 2
            corners = [(xa, za), (xb, za), (xb, zb), (xa, zb)]
            na = int(max(xb - xa, zb - za) / 2 / res) + 2
            verts = {}
            Vb, Fb, UVb = [], [], []
            def vid(p):
                k = (round(p[0], 5), round(p[2], 5))
                if k not in verts:
                    verts[k] = len(Vb)
                    Vb.append(p)
                return verts[k]
            for e in range(4):
                (ax, az), (bx, bz) = corners[e], corners[(e + 1) % 4]
                elen = np.hypot(bx - ax, bz - az)
                nb = int(elen / res) + 2
                kindA = e in (0, 2)   # edges at z = za / zb: barrel along z (height from x)
                grid = np.zeros((na + 1, nb + 1), np.int64)
                uvg = np.zeros((na + 1, nb + 1, 2))
                for ia in range(na + 1):
                    a = ia / na
                    for ib in range(nb + 1):
                        b = ib / nb
                        if ia == 0:
                            px, pz = cx, cz
                        else:
                            ex, ez = ax + (bx - ax) * b, az + (bz - az) * b
                            px, pz = cx + (ex - cx) * a, cz + (ez - cz) * a
                        yx, yz = bay_prof(px, pz, xa, xb, za, zb)
                        y = float(max(yx, yz))
                        grid[ia, ib] = vid(np.array([px, y, pz]))
                        if kindA:
                            sa, sb = bay_S(pz, za, zb, xa, xb, True)
                            uvg[ia, ib] = (pz, float(arc_from_crown(px, xa, xb, sa, sb)[0]))
                        else:
                            sa, sb = bay_S(px, xa, xb, za, zb, False)
                            uvg[ia, ib] = (px, float(arc_from_crown(pz, za, zb, sa, sb)[0]))
                for ia in range(na):
                    for ib in range(nb):
                        q = [grid[ia, ib], grid[ia + 1, ib], grid[ia + 1, ib + 1], grid[ia, ib + 1]]
                        uq = [uvg[ia, ib], uvg[ia + 1, ib], uvg[ia + 1, ib + 1], uvg[ia, ib + 1]]
                        if ia == 0:
                            q = [q[0], q[1], q[2]]; uq = uq[:3]
                        cxq = np.mean([Vb[k][0] for k in q]); czq = np.mean([Vb[k][2] for k in q])
                        if vault_hole(cxq, czq):
                            continue
                        Fb.append(q); UVb.append(uq)
            Vb = np.array(Vb)
            # displacement fade to zero along the groins (both barrels equal) to keep the seam closed
            ya, yb = bay_prof(Vb[:, 0], Vb[:, 2], xa, xb, za, zb)
            dfade = U.smoothstep(0.0, 0.1, np.abs(ya - yb))
            V_all.append(Vb); D_all.append(dfade)
            F_all += [list(np.asarray(f) + base) for f in Fb]
            UV_all += UVb
            base += len(Vb)
    V = np.concatenate(V_all)
    D = np.concatenate(D_all)
    # orient faces downward
    F2 = []
    UV2 = []
    for f, uq in zip(F_all, UV_all):
        a, b, cc = V[f[0]], V[f[1]], V[f[2]]
        n = np.cross(b - a, cc - a)
        if n[1] > 0:
            f = f[::-1]; uq = uq[::-1]
        F2.append(f); UV2.append(uq)
    A, B, C3 = hall_weather(V, 71, 'vault')
    B[:, 3] = D
    # streak direction: towards the nearer springing; use the side of the bay centre in the dominant barrel
    B[:, 2] = 0.5
    uvl = np.concatenate([np.asarray(u) for u in UV2])
    ob = U.mesh_from_faces('hall_vault', V, F2, uv=uvl, attrs={'wxA': A, 'wxB': B, 'wxC': C3}, coll_=c, mat=mats['brick_hallvault'])
    U.remove_loose(ob)
    U.add_adaptive(ob)
    return ob

def rib_curve(t0, t1, n=90):
    """Points along a rib (vault line) by angle, with the inward normal, for ends t0, t1."""
    Sa = S_WALL if is_wall(t0) else S_PIER
    Sb = S_WALL if is_wall(t1) else S_PIER
    c, h = (t0 + t1) / 2, (t1 - t0) / 2
    th = np.linspace(np.pi, 0, n)
    Rx = np.where(th > np.pi / 2, C - Sa, C - Sb)
    Sx = np.where(th > np.pi / 2, Sa, Sb)
    t = c + h * np.cos(th)
    y = Sx + Rx * np.sin(th)
    nrm = np.stack([np.cos(th) / h, np.sin(th) / Rx], -1)
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    L = np.r_[0, np.cumsum(np.hypot(np.diff(t), np.diff(y)))]
    return t, y, nrm, L

def ribs(mats, c, drop=0.3, res=0.12):
    """Transverse brick arch rings on the pier lines, standing proud of the vault by their depth."""
    obs = []
    def rib(name, t0, t1, w0, w1, along_x, line):
        tt, yv, nrm, L = rib_curve(t0, t1)
        ts = tt - nrm[:, 0] * drop
        ys = yv - nrm[:, 1] * drop
        ww = np.linspace(w0, w1, 9)
        def pt(t, w, y):
            return np.stack(np.broadcast_arrays(t, y, w), -1) if along_x else np.stack(np.broadcast_arrays(w, y, t), -1)
        Tt = np.broadcast_to(ts[:, None], (len(ts), len(ww)))
        Ys = np.broadcast_to(ys[:, None], Tt.shape)
        Ww = np.broadcast_to(ww[None], Tt.shape)
        P = pt(Tt, Ww, Ys)
        UV = np.stack([Ww - w0, np.broadcast_to(L[:, None], Tt.shape)], -1)
        A, B, C3 = hall_weather(P.reshape(-1, 3), 81, 'vault')
        mid = P[P.shape[0] // 2, P.shape[1] // 2]
        flip = G.orient_check(P, mid + np.array([0, -1.0, 0]))
        o = U.grid_mesh(name + '_soffit', P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, flip=flip, coll_=c, mat=mats['brick_rib_soffit'])
        U.add_adaptive(o)
        obs.append(o)
        # arch faces: radial bricks from the soffit up into the vault
        for w in (w0, w1):
            hh = np.linspace(0, 1, 4)
            Hh = hh[None, :]
            Tf = ts[:, None] + (tt[:, None] + nrm[:, 0:1] * 0.03 - ts[:, None]) * Hh
            Yf = ys[:, None] + (yv[:, None] + nrm[:, 1:2] * 0.03 - ys[:, None]) * Hh
            P = pt(Tf, np.full(Tf.shape, w), Yf)
            UV = np.stack([np.broadcast_to(Hh * (drop + 0.03), Tf.shape), np.broadcast_to(L[:, None], Tf.shape)], -1)
            A, B, C3 = hall_weather(P.reshape(-1, 3), 82, 'vault')
            ctr = pt(np.array((t0 + t1) / 2), np.array((w0 + w1) / 2), np.array(C - drop / 2))
            flip = G.orient_check(P, ctr)
            o = U.grid_mesh(name + '_side', P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, flip=not flip, coll_=c, mat=mats['brick_rib_side'])
            obs.append(o)
    for j in range(1, len(ZE) - 1):
        for i in range(len(XE) - 1):
            xa, xb = clear(XE, i)
            rib('hall_rib_z%d_x%d' % (j, i), xa, xb, ZE[j] - PH, ZE[j] + PH, True, ZE[j])
    for i in range(1, len(XE) - 1):
        for j in range(len(ZE) - 1):
            za, zb = clear(ZE, j)
            rib('hall_rib_x%d_z%d' % (i, j), za, zb, XE[i] - PH, XE[i] + PH, False, XE[i])
    return obs

# ------------------------------------------------------------------ mouths and walls
MOUTHS = {
    # wall, bay index along that wall, direction of the gallery leaving the hall (game)
    'main': dict(wall='z0', bay=1),
    'ne': dict(wall='x1', bay=0),
    'sw': dict(wall='x0', bay=2),
    'e': dict(wall='z1', bay=2),
}

def mouth_geom(name):
    m = MOUTHS[name]
    if m['wall'] in ('z0', 'z1'):
        a, b = clear(XE, m['bay'])
    else:
        a, b = clear(ZE, m['bay'])
    tc = (a + b) / 2
    hm = (b - a) / 2 - 0.22
    return tc, hm, a, b

def mouth_y(t, tc, hm):
    q = np.clip((t - tc) / hm, -1, 1)
    return MOUTH_SPRING + (MOUTH_CROWN - MOUTH_SPRING) * np.sqrt(np.clip(1 - q * q, 0, 1))

def mouth_inside(t, y, tc, hm):
    return (np.abs(t - tc) < hm) & (y < mouth_y(t, tc, hm)) & (y > spec.FLOOR_Y - 0.5)

def mouth_profile_fn(hm):
    def f(dv=0.06, foot=spec.LEDGE_Y - 0.06):
        th = np.linspace(np.pi, 0, 3000)
        es = hm * np.cos(th); ey = MOUTH_SPRING + (MOUTH_CROWN - MOUTH_SPRING) * np.sin(th)
        pts = np.concatenate([np.stack([np.full(30, -hm), np.linspace(foot, MOUTH_SPRING, 30)], -1)[:-1], np.stack([es, ey], -1),
                              np.stack([np.full(30, hm), np.linspace(MOUTH_SPRING, foot, 30)], -1)[1:]])
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        L = np.r_[0, np.cumsum(seg)]
        n = int(L[-1] / dv) + 1
        v = np.linspace(0, L[-1], n)
        return np.interp(v, L, pts[:, 0]), np.interp(v, L, pts[:, 1]), v, L[-1]
    return f

def walls(mats, c):
    obs = []
    defs = [('z0', X0, X1, Z0, +1), ('z1', X0, X1, Z1, -1), ('x0', Z0, Z1, X0, +1), ('x1', Z0, Z1, X1, -1)]
    for wname, ta, tb, fixed, inward in defs:
        tt = np.arange(ta, tb + 1e-6, 0.15)
        if tt[-1] < tb - 1e-6:
            tt = np.r_[tt, tb]
        if wname[0] == 'z':
            top = ceiling(tt, np.full_like(tt, fixed + inward * 1e-4))
        else:
            top = ceiling(np.full_like(tt, fixed + inward * 1e-4), tt)
        # pier lines: rib ends sit on corbels at springing
        top = top + 0.04
        q = np.linspace(0, 1, 60)
        Tt, Q = np.meshgrid(tt, q, indexing='ij')
        Y = spec.FLOOR_Y - 0.2 + (top[:, None] - (spec.FLOOR_Y - 0.2)) * Q ** 1.0
        if wname[0] == 'z':
            P = np.stack([Tt, Y, np.full(Tt.shape, fixed)], -1)
        else:
            P = np.stack([np.full(Tt.shape, fixed), Y, Tt], -1)
        UV = np.stack([Tt * inward, Y], -1)
        ct = 0.5 * (Tt[1:, 1:] + Tt[:-1, :-1]); cy = 0.5 * (Y[1:, 1:] + Y[:-1, :-1])
        keep = np.ones(ct.shape, bool)
        for mn, md in MOUTHS.items():
            if md['wall'] == wname:
                tc, hm, a, b = mouth_geom(mn)
                keep &= ~mouth_inside(ct, cy, tc, hm + 0.02)
        for (dw, dt, dy, dhw, dhh) in WALL_DRAIN_HOLES:
            if dw == wname:
                keep &= ~((np.abs(ct - dt) < dhw) & (np.abs(cy - dy) < dhh))
        A, B, C3 = hall_weather(P.reshape(-1, 3), 90 + len(obs), 'wall')
        tf, yf = Tt.ravel(), Y.ravel()
        for (dw, dt, dy, dhw, dhh) in WALL_DRAIN_HOLES:
            if dw == wname:
                below = (yf < dy - dhh) & (yf > spec.FLOOR_Y)
                wid = 0.22 + 0.25 * np.clip((dy - yf) / 2.0, 0, 1)
                band = below * np.exp(-0.5 * ((tf - dt) / wid) ** 2)
                C3[:, 3] = np.maximum(C3[:, 3], band)
                A[:, 2] = np.maximum(A[:, 2], band * 0.8)
                A[:, 0] = np.maximum(A[:, 0], band * 0.75 * np.exp(-np.clip(dy - yf - 0.15, 0, None) / 0.9))
        ctr = P[P.shape[0] // 2, 30].copy()
        if wname[0] == 'z':
            ctr[2] += inward
        else:
            ctr[0] += inward
        flip = G.orient_check(P, ctr)
        o = U.grid_mesh('hall_wall_' + wname, P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, keep=keep, flip=flip, coll_=c, mat=mats['brick_hallwall'])
        U.remove_loose(o)
        U.add_adaptive(o)
        obs.append(o)
    return obs

def mouth_frame(name, wall):
    """Origin, along-wall axis t, inward normal (into the hall) for a mouth, game vectors."""
    tc, hm, a, b = mouth_geom(name)
    if wall == 'z0':
        return np.array([tc, 0, Z0]), np.array([1.0, 0, 0]), np.array([0, 0, 1.0])
    if wall == 'z1':
        return np.array([tc, 0, Z1]), np.array([-1.0, 0, 0]), np.array([0, 0, -1.0])
    if wall == 'x0':
        return np.array([X0, 0, tc]), np.array([0, 0, -1.0]), np.array([1.0, 0, 0])
    return np.array([X1, 0, tc]), np.array([0, 0, 1.0]), np.array([-1.0, 0, 0])

def mouth_rings(name, mats, c, rng, ring_meshes):
    """Two header rings on the hall face round the mouth arch, and bluestone imposts."""
    md = MOUTHS[name]
    o, t_ax, n_in = mouth_frame(name, md['wall'])
    tc, hm, a, b = mouth_geom(name)
    obs = []
    th = np.linspace(np.pi, 0, 2000)
    for ring, rr in enumerate((0.05, 0.15)):
        es = (hm + rr) * np.cos(th)
        ey = MOUTH_SPRING + (MOUTH_CROWN - MOUTH_SPRING + rr) * np.sin(th)
        seg = np.r_[0, np.cumsum(np.hypot(np.diff(es), np.diff(ey)))]
        nb = int(seg[-1] / 0.062)
        for k in range(nb):
            q = (k + 0.5) * seg[-1] / nb
            s_ = np.interp(q, seg, es); y_ = np.interp(q, seg, ey)
            q1, q2 = q - 0.02, q + 0.02
            ts = np.interp(q2, seg, es) - np.interp(q1, seg, es); ty = np.interp(q2, seg, ey) - np.interp(q1, seg, ey)
            tang = t_ax * ts + np.array([0, 1.0, 0]) * ty
            tang /= np.linalg.norm(tang)
            radial = np.cross(tang, n_in)
            if np.dot(radial, t_ax * s_ + np.array([0, 1.0, 0]) * (y_ - MOUTH_SPRING)) < 0:
                radial = -radial
            pos = o + t_ax * 0 + t_ax * (s_ + 0) + np.array([0, y_, 0]) + n_in * 0.075 - t_ax * 0
            pos = pos + t_ax * 0
            pos[0:3] = o + t_ax * s_ + np.array([0, y_, 0]) + n_in * (0.08)
            me = ring_meshes[rng.integers(len(ring_meshes))]
            ob = bpy.data.objects.new('mouth_%s_ringbrick' % name, me)
            c.objects.link(ob)
            ob.matrix_world = PR.frame_matrix(pos + rng.normal(0, 0.003, 3), tang, radial, -n_in)
            obs.append(ob)
    # imposts
    for sgn in (-1, 1):
        base = o + t_ax * sgn * (hm + 0.18) + np.array([0, MOUTH_SPRING - 0.15, 0])
        Cc = np.array([base + t_ax * (-0.2 if not (j & 1) else 0.2) + np.array([0, -0.14 if not (j & 2) else 0.14, 0]) + n_in * (0.05 if not (j & 4) else -WT) for j in range(8)])
        obs.append(U.block_object('mouth_%s_impost' % name, Cc, mats['bluestone'], c, r=0.01, res=0.05, seed=rng.integers(1e6), chips=3))
    return obs

# ------------------------------------------------------------------ piers
def piers(mats, c, rng):
    obs = []
    k = 0
    for x in spec.HALL_XL:
        for z in spec.HALL_ZL:
            obs += pier(x, z, mats, c, rng, k)
            k += 1
    # corbels where ribs land on the walls
    steps = ((0.12, -0.62, -0.42), (0.24, -0.42, -0.21), (0.36, -0.21, 0.0))
    for z in spec.HALL_ZL:
        for x, inw in ((X0, 1), (X1, -1)):
            for (dp, y0, y1) in steps:
                Cc = U.box_corners(min(x - inw * 0.25, x + inw * dp), max(x - inw * 0.25, x + inw * dp), S_WALL + y0, S_WALL + y1, z - PH - 0.05, z + PH + 0.05)
                obs.append(U.block_object('hall_corbel', Cc, mats['bluestone_quoin'], c, r=0.012, res=0.06, seed=rng.integers(1e6), chips=5, corners=1, wobble=0.0012))
    for x in spec.HALL_XL:
        for z, inw in ((Z0, 1), (Z1, -1)):
            for (dp, y0, y1) in steps:
                Cc = U.box_corners(x - PH - 0.05, x + PH + 0.05, S_WALL + y0, S_WALL + y1, min(z - inw * 0.25, z + inw * dp), max(z - inw * 0.25, z + inw * dp))
                obs.append(U.block_object('hall_corbel', Cc, mats['bluestone_quoin'], c, r=0.012, res=0.06, seed=rng.integers(1e6), chips=5, corners=1, wobble=0.0012))
    return obs

def pier(x, z, mats, c, rng, k):
    obs = []
    plinth_top = -4.95
    cap_bot = S_PIER - 0.28
    # bluestone plinth, two courses, chamfered top
    for ci, (y0, y1) in enumerate(((spec.FLOOR_Y - 0.1, -5.5), (-5.5, plinth_top))):
        hw = PH + (0.34 if ci == 0 else 0.24)
        Cc = U.box_corners(x - hw, x + hw, y0, y1, z - hw, z + hw)
        obs.append(U.block_object('pier%d_plinth%d' % (k, ci), Cc, mats['bluestone_wet'], c, r=0.022 if ci else 0.014, res=0.055, seed=7000 + k * 10 + ci, chips=rng.integers(7, 13), chip_size=(0.03, 0.1), corners=int(rng.integers(1, 3)), wobble=0.003))
    # weathered slope on the plinth top
    hw = PH + 0.24
    Cc = np.array([[x + (-hw if not (j & 1) else hw) * (1 if not (j & 2) else (PH + 0.02) / hw), plinth_top if not (j & 2) else plinth_top + 0.16, z + (-hw if not (j & 4) else hw) * (1 if not (j & 2) else 0.9)] for j in range(8)])
    obs.append(U.block_object('pier%d_weathering' % k, Cc, mats['bluestone_wet'], c, r=0.014, res=0.05, seed=7100 + k, chips=7, corners=1, wobble=0.0025))
    # brick shaft, rounded corners, wrapped UV
    rc = 0.035
    per = []
    for corner in range(4):
        ang0 = corner * np.pi / 2
        cxs = [x + PH - rc, x - PH + rc, x - PH + rc, x + PH - rc][corner]
        czs = [z + PH - rc, z + PH - rc, z - PH + rc, z - PH + rc][corner]
        for a in np.linspace(ang0, ang0 + np.pi / 2, 5):
            per.append((cxs + rc * np.cos(a), czs + rc * np.sin(a)))
    per = np.array(per)
    # densify straight runs
    dense = []
    for i in range(len(per)):
        p0, p1 = per[i], per[(i + 1) % len(per)]
        n = max(1, int(np.linalg.norm(p1 - p0) / 0.15))
        for t in np.linspace(0, 1, n, endpoint=False):
            dense.append(p0 + (p1 - p0) * t)
    dense = np.array(dense)
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([dense, dense[:1]]), axis=0), axis=1))]
    yy = np.linspace(plinth_top + 0.03, cap_bot + 0.02, int((cap_bot - plinth_top) / 0.1) + 2)
    Pp = np.zeros((len(yy), len(dense) + 1, 3))
    for i, y in enumerate(yy):
        Pp[i, :-1] = np.stack([dense[:, 0], np.full(len(dense), y), dense[:, 1]], -1)
        Pp[i, -1] = Pp[i, 0]
    UV = np.stack(np.broadcast_arrays(L[None, :], yy[:, None]), -1)
    A, B, C3 = hall_weather(Pp.reshape(-1, 3), 300 + k, 'wall')
    yf = Pp[..., 1].ravel()
    A[:, 0] = np.clip(A[:, 0] + 0.75 * U.smoothstep(cap_bot - 0.9, cap_bot - 0.05, yf) * U.smoothstep(0.35, 0.65, U.fbm3(Pp.reshape(-1, 3), 310 + k, 0.6)), 0, 1)
    pf = Pp.reshape(-1, 3)
    for (sx, sz) in ((1, 1), (-1, -1)):
        dc = np.hypot(pf[:, 0] - (x + sx * PH), pf[:, 2] - (z + sz * PH))
        C3[:, 3] = np.maximum(C3[:, 3], np.exp(-(dc / 0.35) ** 2))
        A[:, 0] = np.maximum(A[:, 0], 0.8 * np.exp(-(dc / 0.25) ** 2))
    flip = G.orient_check(Pp, np.array([x, Pp[0, 0, 1], z]) * 0 + (Pp[2, 2] + (Pp[2, 2] - np.array([x, Pp[2, 2, 1], z]))))
    o = U.grid_mesh('pier%d_shaft' % k, Pp, UV, attrs={'wxA': A.reshape(*Pp.shape[:2], 4), 'wxB': B.reshape(*Pp.shape[:2], 4), 'wxC': C3.reshape(*Pp.shape[:2], 4)}, flip=flip, coll_=c, mat=mats['brick_pier'])
    U.add_adaptive(o)
    obs.append(o)
    # cap: chamfered bed mould under a square abacus
    hw = PH + 0.22
    Cc = np.array([[x + (-PH if not (j & 1) else PH) * (1 if not (j & 2) else hw / PH), cap_bot if not (j & 2) else cap_bot + 0.12, z + (-PH if not (j & 4) else PH) * (1 if not (j & 2) else hw / PH)] for j in range(8)])
    obs.append(U.block_object('pier%d_capmould' % k, Cc, mats['bluestone'], c, r=0.012, res=0.045, seed=7200 + k, chips=7, chip_size=(0.02, 0.07), wobble=0.002))
    Cc = U.box_corners(x - hw, x + hw, cap_bot + 0.12, S_PIER, z - hw, z + hw)
    obs.append(U.block_object('pier%d_cap' % k, Cc, mats['bluestone'], c, r=0.015, res=0.045, seed=7300 + k, chips=rng.integers(7, 13), chip_size=(0.02, 0.09), corners=int(rng.integers(1, 3)), wobble=0.0025))
    return obs

# ------------------------------------------------------------------ walkways
WALKS = [
    # x0, x1, z0, z1, water sides (list of 'x0','x1','z0','z1')
    (X0, -151.0, Z0, Z0 + 1.5, ['z1']),
    (-148.0, X1, Z0, Z0 + 1.5, ['z1']),
    (X0, X0 + 1.5, Z0 + 1.5, 126.19, ['x1']),
    (X0, X0 + 1.5, 129.19, 132.9, ['x1']),
    (-158.3, -144.53, Z1 - 1.5, Z1, ['z0']),
]

def walkways(mats, c, rng):
    obs = []
    for wi, (x0, x1, z0, z1, wsides) in enumerate(WALKS):
        # brick sides on every open edge that faces water
        edges = {'x0': ((x0, z0), (x0, z1), np.array([-1.0, 0, 0])), 'x1': ((x1, z0), (x1, z1), np.array([1.0, 0, 0])),
                 'z0': ((x0, z0), (x1, z0), np.array([0, 0, -1.0])), 'z1': ((x0, z1), (x1, z1), np.array([0, 0, 1.0]))}
        # open ends where the walkway stops at a channel: also brick, with coping returned
        ends = []
        for e, (a, b, n) in edges.items():
            open_edge = e in wsides
            touches_wall = (e == 'x0' and abs(x0 - X0) < 0.01) or (e == 'x1' and abs(x1 - X1) < 0.01) or (e == 'z0' and abs(z0 - Z0) < 0.01) or (e == 'z1' and abs(z1 - Z1) < 0.01)
            if touches_wall:
                continue
            a, b = np.array([a[0], 0, a[1]]), np.array([b[0], 0, b[1]])
            L = np.linalg.norm(b - a)
            tt = np.linspace(0, 1, max(2, int(L / 0.2)))
            yy = np.linspace(spec.FLOOR_Y - 0.15, spec.LEDGE_Y - 0.25, 24)
            Tt, Y = np.meshgrid(tt, yy, indexing='ij')
            P = a[None, None] + (b - a)[None, None] * Tt[..., None]
            P = P.copy(); P[..., 1] = Y
            off = n * 0.0
            UV = np.stack([Tt * L, Y], -1)
            A, B, C3 = hall_weather(P.reshape(-1, 3), 400 + wi, 'wall')
            flip = G.orient_check(P, P[P.shape[0] // 2, P.shape[1] // 2] + n)
            o = U.grid_mesh('walk%d_side_%s' % (wi, e), P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, flip=flip, coll_=c, mat=mats['brick_channel'])
            U.add_adaptive(o)
            obs.append(o)
            # coping along this edge
            d = (b - a) / L
            inward = -n
            pos = 0.0
            k = 0
            while pos < L - 0.05:
                bl = min(rng.uniform(0.75, 1.2), L - pos)
                if L - pos - bl < 0.3:
                    bl = L - pos
                p0 = a + d * pos
                Cc = np.array([p0 + d * (0.004 if not (j & 1) else bl - 0.004) + np.array([0, spec.LEDGE_Y - 0.3 if not (j & 2) else spec.LEDGE_Y, 0]) + n * (0.04 if not (j & 4) else -0.46) for j in range(8)])
                obs.append(U.block_object('walk%d_coping_%s_%02d' % (wi, e, k), Cc, mats['bluestone'], c, r=rng.uniform(0.006, 0.012), res=0.045, seed=rng.integers(1e6), chips=rng.integers(6, 13), chip_size=(0.02, 0.08), wear_top=0.012, corners=int(rng.integers(0, 3)), wobble=0.0009))
                pos += bl
                k += 1
        # top paving (brick) inside the copings
        xx = np.linspace(x0, x1, max(2, int((x1 - x0) / 0.2)))
        zz = np.linspace(z0, z1, max(2, int((z1 - z0) / 0.2)))
        Xg, Zg = np.meshgrid(xx, zz, indexing='ij')
        P = np.stack([Xg, np.full(Xg.shape, spec.LEDGE_Y - 0.002), Zg], -1)
        A, B, C3 = hall_weather(P.reshape(-1, 3), 450 + wi, 'wall')
        A[:, 3] = np.clip(0.55 + 0.6 * U.fbm3(P.reshape(-1, 3), 460 + wi, 1.0), 0, 1)
        A[:, 2] = 0.55
        C3[:, 2] = 0.95
        C3[:, 1] = 0.0
        UV = np.stack([Xg if (x1 - x0) > (z1 - z0) else Zg, Zg if (x1 - x0) > (z1 - z0) else Xg], -1)
        flip = G.orient_check(P, P[0, 0] + np.array([0, 1.0, 0]))
        o = U.grid_mesh('walk%d_top' % wi, P, UV, attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, flip=flip, coll_=c, mat=mats['brick_ledge'])
        U.add_adaptive(o)
        obs.append(o)
    return obs

# ------------------------------------------------------------------ floor, silt, water
def floor(mats, c, rng):
    obs = []
    xx = np.arange(X0 - 0.1, X1 + 0.1 + 1e-6, 0.2)
    zz = np.arange(Z0 - 0.1, Z1 + 0.1 + 1e-6, 0.2)
    Xg, Zg = np.meshgrid(xx, zz, indexing='ij')
    P0 = np.stack([Xg, np.zeros_like(Xg), Zg], -1).reshape(-1, 3)
    n1 = U.fbm3(P0, 501, 4.0).reshape(Xg.shape); n2 = U.fbm3(P0, 502, 1.0).reshape(Xg.shape)
    dw = np.minimum.reduce([Xg - X0, X1 - Xg, Zg - Z0, Z1 - Zg])
    y = spec.FLOOR_Y + 0.2 + 1.35 * U.smoothstep(2.8, 0.0, dw) ** 1.5 * (0.35 + n1) + 0.2 * (n2 - 0.5)
    # silt round the piers (eddies) and the bone bank at the stair foot
    for px in spec.HALL_XL:
        for pz in spec.HALL_ZL:
            d = np.maximum(np.abs(Xg - px), np.abs(Zg - pz)) - PH
            y += 0.95 * np.exp(-np.clip(d, 0, None) / 0.55) * (0.45 + n1)
    bank = np.exp(-0.5 * (((Xg - (-156.6)) / 1.6) ** 2 + ((Zg - 135.6) / 1.9) ** 2))
    y = np.maximum(y, spec.FLOOR_Y + 0.2 + 2.05 * bank + 0.15 * (n2 - 0.5) * bank)
    y = np.minimum(y, -4.3)
    P = np.stack([Xg, y, Zg], -1)
    flip = G.orient_check(P, P[5, 5] + np.array([0, 1.0, 0]))
    o = U.grid_mesh('hall_silt', P, np.stack([Xg, Zg], -1), flip=flip, coll_=c, mat=mats['silt'])
    U.add_adaptive(o)
    obs.append(o)
    obs.append(U.box_mesh('hall_water', X0 - 0.05, X1 + 0.05, spec.FLOOR_Y - 0.3, spec.WATER_Y, Z0 - 0.3, Z1 + 0.3, mats['water'], c))
    return obs, (lambda x, z: float(np.interp(z, zz, y[np.argmin(np.abs(xx - x))])))

# ------------------------------------------------------------------ stair from the street hatch
def stair(mats, c, rng):
    obs = []
    sx0, sx1 = STAIR['x0'], STAIR['x1']
    n_r = 19
    rise = (spec.STREET_Y - 0.18 - spec.LEDGE_Y) / n_r
    going = 0.27
    z_top = Z1 - 0.28
    z_bot = z_top - (n_r - 1) * going
    STAIR['z_bot'] = z_bot
    # masonry base under the flight (brick, open side faces the water)
    tt = np.linspace(z_bot - 0.3, Z1, 60)
    stepy = spec.LEDGE_Y + np.clip(np.floor((tt - z_bot) / going) + 1, 0, n_r - 1) * rise
    yy = np.linspace(0, 1, 70)
    Tt, Q = np.meshgrid(tt, yy, indexing='ij')
    Y = spec.FLOOR_Y - 0.15 + (stepy[:, None] - 0.2 - (spec.FLOOR_Y - 0.15)) * Q
    P = np.stack([np.full(Tt.shape, sx1), Y, Tt], -1)
    A, B, C3 = hall_weather(P.reshape(-1, 3), 600, 'wall')
    flip = G.orient_check(P, P[30, 30] + np.array([1.0, 0, 0]))
    o = U.grid_mesh('stair_base', P, np.stack([Tt, Y], -1), attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, flip=flip, coll_=c, mat=mats['brick_hallwall'])
    U.add_adaptive(o)
    obs.append(o)
    # front (west) face of the base below the first step
    # treads: bluestone blocks, worn in the middle, nosings chipped
    for i in range(n_r):
        y1 = spec.LEDGE_Y + (i + 1) * rise
        z0 = z_bot + (i - 1) * going if i > 0 else z_bot - 0.3
        z1 = z_bot + i * going + 0.03
        if i == n_r - 1:
            z1 = Z1
        Cc = U.box_corners(sx0 + 0.01, sx1 + 0.03, y1 - rise - 0.06, y1, z0, z1)
        wear = 0.012 if i < 14 else 0.006
        obs.append(U.block_object('stair_step_%02d' % i, Cc, mats['bluestone_step'], c, r=rng.uniform(0.02, 0.03), res=0.03, seed=8000 + i,
                                  chips=rng.integers(4, 8), chip_size=(0.015, 0.05), wear_top=wear * 1.6, corners=1, wobble=0.0015))
    # landing at the foot, joined to the south walkway
    Cc = U.box_corners(sx0 + 0.01, sx1 + 0.03, spec.LEDGE_Y - 0.3, spec.LEDGE_Y, 132.9, z_bot - 0.3)
    if z_bot - 0.3 - 132.9 > 0.05:
        obs.append(U.block_object('stair_landing', Cc, mats['bluestone_step'], c, r=0.012, res=0.05, seed=8100, chips=4, wear_top=0.01))
    # handrail on the open side: posts leaded into the treads, rail on the pitch
    rail_h = 0.9
    posts = []
    for i in range(1, n_r, 3):
        zp = z_bot + i * going - going / 2
        yp = spec.LEDGE_Y + (i + 1) * rise
        posts.append((zp, yp))
        obs.append(U.tube('stair_post', [[sx1 - 0.08, yp - 0.05, zp], [sx1 - 0.08, yp + rail_h, zp]], 0.014, n=8, coll_=c, mat=mats['iron']))
    rail = [[sx1 - 0.08, yp + rail_h + 0.02, zp] for (zp, yp) in posts]
    rail = [[sx1 - 0.08, spec.LEDGE_Y + rail_h, z_bot - 0.25]] + rail + [[sx1 - 0.08, -0.1 + 0.4, Z1 - 0.3]]
    obs.append(U.tube('stair_rail', rail, 0.02, n=10, coll_=c, mat=mats['iron'], flat=0.7))
    # stairwell walls up through the vault to the street
    def sw_wall(name, a, b, normal):
        a, b = np.array(a, float), np.array(b, float)
        L = np.linalg.norm(b - a)
        tt = np.linspace(0, 1, max(2, int(L / 0.1)))
        pts = a[None] + (b - a)[None] * tt[:, None]
        ybot = ceiling(pts[:, 0] + normal[0] * -0.05, pts[:, 2] + normal[2] * -0.05) - 0.15
        q = np.linspace(0, 1, 40)
        Y = ybot[:, None] + (0.0 - ybot[:, None]) * q[None]
        P = np.repeat(pts[:, None], 40, 1).copy(); P[..., 1] = Y
        A, B, C3 = hall_weather(P.reshape(-1, 3), 650, 'wall')
        A[:, 2] = 0.35; A[:, 0] = 0.2
        flip = G.orient_check(P, P[len(tt) // 2, 20] + normal)
        o = U.grid_mesh(name, P, np.stack([np.broadcast_to(tt[:, None] * L, Y.shape), Y], -1), attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': C3.reshape(*P.shape[:2], 4)}, flip=flip, coll_=c, mat=mats['brick_hallwall'])
        U.add_adaptive(o)
        return o
    zo = STAIR['z_open']
    obs.append(sw_wall('stairwell_n', (sx1, 0, zo), (sx1, 0, Z1), np.array([-1.0, 0, 0])))
    obs.append(sw_wall('stairwell_s', (sx0, 0, zo), (sx0, 0, Z1), np.array([1.0, 0, 0])))
    obs.append(sw_wall('stairwell_e', (sx0, 0, Z1), (sx1, 0, Z1), np.array([0, 0, -1.0])))
    # bluestone lintel across the open end of the stairwell
    yl = ceiling(np.array([(sx0 + sx1) / 2]), np.array([zo]))[0]
    Cc = U.box_corners(sx0 - 0.02, sx1 + 0.15, yl - 0.32, yl + 0.1, zo - 0.25, zo + 0.05)
    obs.append(U.block_object('stairwell_lintel', Cc, mats['bluestone'], c, r=0.012, res=0.05, seed=8200, chips=5))
    # street slab over the stairwell with the hatch opening, and the hatch leaves standing open
    hz0, hz1 = STAIR['hatch_z0'], STAIR['hatch_z1']
    for (za, zb) in ((zo - 0.3, hz0), ):
        Cc = U.box_corners(sx0 - 0.05, sx1 + 0.2, -0.25, 0.0, za, zb)
        obs.append(U.block_object('stairwell_slab', Cc, mats['bluestone_dry'], c, r=0.01, res=0.08, seed=8300, chips=2))
    for side, sx in ((0, sx0 + 0.04), (1, sx1 - 0.04)):
        Cc = U.box_corners(-0.03, 0.03, 0.0, 0.58, 0, hz1 - hz0)
        P_, F_, V_ = U.hexa_block(Cc, r=0.004, res=0.06, seed=8400 + side, chips=2)
        ang = np.radians(100) * (1 if side else -1)
        # rotate about the hinge line (along z) at (sx, 0)
        xr = P_[:, 0] * np.cos(ang) - P_[:, 1] * np.sin(ang) * (1 if side else -1) * 0
        P2 = P_.copy()
        P2[:, 0] = sx + P_[:, 1] * np.sin(np.radians(10)) * (1 if side else -1) * 1 + P_[:, 0]
        P2[:, 1] = P_[:, 1] * np.cos(np.radians(10)) + 0.0
        P2[:, 2] = hz0 + P_[:, 2]
        uvv = np.stack([(V_[:, 1] + 0.3) / (spec.OAK_PLANK_W * spec.OAK_ATLAS_COLS) + side * 0.25, (V_[:, 2] + 2) / spec.OAK_ATLAS_H_M], -1)
        obs.append(U.mesh_from_faces('hatch_leaf_%d' % side, P2, F_, uv=uvv[F_.ravel()], uv2=np.zeros((F_.size, 2)) + 0.5, coll_=c, mat=mats['oak']))
    return obs

# ------------------------------------------------------------------ air shaft
def air_shaft(mats, c):
    obs = []
    x, z, r = AIR
    ang = np.linspace(0, 2 * np.pi, 33)
    y0 = C - 0.12
    yy = np.linspace(y0, -0.25, 12)
    P = np.stack(np.broadcast_arrays(x + r * np.cos(ang)[None], yy[:, None], z + r * np.sin(ang)[None]), -1)
    UV = np.stack(np.broadcast_arrays(ang[None] * r, yy[:, None]), -1)
    A = np.zeros((*P.shape[:2], 4), np.float32); B = np.zeros((*P.shape[:2], 4), np.float32); B[..., 3] = 1
    A[..., 2] = 0.5; A[..., 0] = 0.4
    flip = G.orient_check(P, np.array([x, -0.6, z]))
    o = U.grid_mesh('air_shaft', P, UV, attrs={'wxA': A, 'wxB': B}, flip=flip, coll_=c, mat=mats['brick_hallvault'])
    obs.append(o)
    # grate
    for k, dx in enumerate(np.linspace(-r + 0.05, r - 0.05, 7)):
        half = np.sqrt(max(r * r - dx * dx, 0))
        obs.append(U.tube('air_grate_bar', [[x + dx, -0.06, z - half], [x + dx, -0.06, z + half]], 0.012, n=6, coll_=c, mat=mats['iron']))
    a2 = np.linspace(0, 2 * np.pi, 33)
    obs.append(U.tube('air_grate_ring', np.stack([x + (r + 0.02) * np.cos(a2), np.full(33, -0.05), z + (r + 0.02) * np.sin(a2)], -1), 0.03, n=8, coll_=c, mat=mats['iron']))
    return obs
