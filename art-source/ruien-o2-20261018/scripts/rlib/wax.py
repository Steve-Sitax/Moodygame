# Calcite flowstone as poured wax (round 6 method, after Steve's photo):
# one continuous smooth sheet lofted over its host surface, offset 2 to 20 cm and thickest near the top,
# tapering to a lobed lower edge, every edge sunk into the masonry. Fine relief comes from t09 displacement
# in the sheet's own UVs (flutes run straight down), faded to zero at the outline by the 'wxF' attribute.
import numpy as np
import spec
from . import util as U
from . import gallery as G
from . import hall as H

EMBED = 0.018

def _sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

DEPOSITS = []

def wax_curtain(name, host, W0, L, mats, c, rng, T=None, na=51, nd=64, taper=0.72, Lend=None, land=None, relief=1.0):
    """host(a_m, d_m) -> (point, room-facing unit normal), with a_m metres across and d_m metres down."""
    T = T if T is not None else 0.04 + 0.13 * W0
    ph = rng.uniform(0, 6.28, 6)
    A = np.linspace(-1, 1, na)
    lobe = 0.5 + 0.5 * np.sin(A * (3.0 + 2.5 * W0) + ph[0])
    f_end = 1.0 - 0.12 * lobe ** 1.5 - 0.04 * np.sin(A * 9 + ph[1]) ** 2
    P = np.zeros((nd, na, 3)); UV = np.zeros((nd, na, 2)); Fm = np.zeros((nd, na, 4), np.float32)
    for i in range(nd):
        g = i / (nd - 1)
        for j, a in enumerate(A):
            f = g * f_end[j]
            hw = 0.5 * W0 * (1 - taper * f ** 1.25) * (1 + 0.14 * np.sin(f * 5 + ph[2]) + 0.08 * np.sin(f * 17 + ph[4]))
            am = a * hw + 0.02 * W0 * np.sin(f * 4 + ph[3])
            dm = f * L
            p, n = host(am, dm)
            # ragged, patchy outline: the sheet dips into the wall in places near its edges
            nz = (np.sin(a * 7.3 + f * 11.0 + ph[0]) + np.sin(a * 13.1 - f * 7.0 + ph[1]) + np.sin(a * 3.1 + f * 23.0 + ph[2])) / 3
            patch = _sm(-0.55, 0.45, nz)
            base_e = (1 - a * a) ** (1.8 if taper < 0.6 else 0.9)
            hw = max(hw, 0.05)
            top = _sm(0.0, 0.07, f)
            bot = 1 - _sm(0.82, 1.0, g)
            folds = 1 + 0.07 * np.sin(a * np.pi * 1.4 + ph[4] + f * 1.5) + 0.05 * np.sin(f * 7 + ph[5] + a)
            be = base_e * top * bot
            th = T * be * (1 - 0.65 * f) * folds * (0.2 + 0.8 * patch)
            o = _sm(0.0, 0.14, be)
            off = max(th, 0.005) * o - EMBED * (1 - o)
            P[i, j] = p + n * off
            UV[i, j] = (am, -dm)
            Fm[i, j, 0] = be * (0.35 + 0.65 * patch) * relief
            Fm[i, j, 1] = be
    ob = U.grid_mesh(name, P, UV, attrs={'wxF': Fm}, coll_=c, mat=mats['calcite'],
                     flip=G.orient_check(P, P[nd // 3, na // 2] + host(0.0, L * 0.3)[1]))
    U.add_adaptive(ob, 1.5)
    hw_b = 0.5 * W0 * max(0.15, 1 - taper * 0.85 ** 1.25)
    DEPOSITS.append(dict(host=host, L=L, W0=W0, hw_b=hw_b, Lend=Lend if Lend is not None else L, land=land, pts=P.reshape(-1, 3)))
    return ob

# ------------------------------------------------------------------ hosts
def host_rib_soffit(t0, t1, w_mid, along_x, from_crown_side, drop=0.3):
    """Underside of a hall arch ring: down = along the ring from near the crown toward one springing."""
    tt, yv, nrm, L = H.rib_curve(t0, t1, n=600)
    ts = tt - nrm[:, 0] * drop
    ys = yv - nrm[:, 1] * drop
    Ltot = L[-1]
    q0 = Ltot * 0.5 + from_crown_side * Ltot * 0.03
    def host(a_m, d_m):
        q = np.clip(q0 + from_crown_side * d_m, 0, Ltot)
        t = np.interp(q, L, ts); y = np.interp(q, L, ys)
        nx = np.interp(q, L, nrm[:, 0]); ny = np.interp(q, L, nrm[:, 1])
        w = w_mid + a_m
        if along_x:
            return np.array([t, y, w]), -np.array([nx, ny, 0.0]) / np.hypot(nx, ny)
        return np.array([w, y, t]), -np.array([0.0, ny, nx]) / np.hypot(nx, ny)
    return host, Ltot * 0.5

def host_groin(cx, cz, kx, kz):
    """Vault surface along a groin line from near the crown toward a pier corner (plan distance)."""
    d = np.array([kx - cx, kz - cz]); Ld = np.linalg.norm(d); d /= Ld
    perp = np.array([-d[1], d[0]])
    def hgt(x, z):
        return H.ceiling(np.array([x]), np.array([z]))[0]
    def host(a_m, d_m):
        pl = np.array([cx, cz]) + d * (Ld * 0.12 + d_m) + perp * a_m
        y = hgt(pl[0], pl[1])
        e = 0.03
        hx = (hgt(pl[0] + e, pl[1]) - hgt(pl[0] - e, pl[1])) / (2 * e)
        hz = (hgt(pl[0], pl[1] + e) - hgt(pl[0], pl[1] - e)) / (2 * e)
        n = np.array([hx, -1.0, hz]); n /= np.linalg.norm(n)
        return np.array([pl[0], y, pl[1]]), n
    return host, Ld * 0.82

def host_groin_faces(cx, cz, kx, kz):
    """Groin from its two vault faces: the deposit follows the groin arris from the haunch down to the pier;
    across > 0 steps onto the x face (along x toward the bay centre), across < 0 onto the z face."""
    d = np.array([kx - cx, kz - cz]); Ld = np.linalg.norm(d); d /= Ld
    ex = -np.sign(kx - cx); ez = -np.sign(kz - cz)
    def hgt(x, z):
        return H.ceiling(np.array([x]), np.array([z]))[0]
    def host(a_m, d_m):
        g = np.array([cx, cz]) + d * (Ld * 0.3 + d_m)
        pl = g + (np.array([ex * a_m, 0.0]) if a_m >= 0 else np.array([0.0, ez * -a_m]))
        y = hgt(pl[0], pl[1])
        e = 0.02
        hx = (hgt(pl[0] + e, pl[1]) - hgt(pl[0] - e, pl[1])) / (2 * e)
        hz = (hgt(pl[0], pl[1] + e) - hgt(pl[0], pl[1] - e)) / (2 * e)
        n = np.array([hx, -1.0, hz]); n /= np.linalg.norm(n)
        return np.array([pl[0], y, pl[1]]), n
    return host, Ld * 0.67

def host_plane(top, down, across, normal):
    top, down, across, normal = (np.asarray(v, float) for v in (top, down, across, normal))
    def host(a_m, d_m):
        return top + down * d_m + across * a_m, normal
    return host

def host_gallery(g, u0, side, y_top):
    p = g.path
    a, b, SP = spec.GAL_W / 2, spec.GAL_RISE, spec.GAL_SPRING_Y
    def host(a_m, d_m):
        y = y_top - d_m
        s = G.shell_s_at_y(y)
        if y > SP:
            so, yo = s / a ** 2, (y - SP) / b ** 2
        else:
            so, yo = 1.0, 0.0
        l = np.hypot(so, yo); so, yo = so / l, yo / l
        u = u0 + a_m
        pt = p.world(np.array(u), np.array(side * s), np.array(y))
        px, pz, tx, tz, nx, nz = p.frame(np.array(u))
        n = -np.array([side * so * float(nx), yo, side * so * float(nz)])
        return pt, n / np.linalg.norm(n)
    return host

# ------------------------------------------------------------------ placement
def hall_wax(mats, c, rng):
    obs = []
    PH = H.PH
    # down the ring undersides of the transverse arches (the photo's main feature)
    for j in range(1, len(H.ZE) - 1):
        for i in range(len(H.XE) - 1):
            if rng.random() < 0.55:
                xa, xb = H.clear(H.XE, i)
                host, Lmax = host_rib_soffit(xa, xb, H.ZE[j] + rng.uniform(-0.12, 0.12), True, rng.choice([-1, 1]))
                obs.append(wax_curtain('calcite_wax_arch', host, rng.uniform(0.55, 0.85), Lmax * rng.uniform(0.55, 0.85), mats, c, rng, Lend=Lmax * 0.97, land='cap'))
    for i in range(1, len(H.XE) - 1):
        for j in range(len(H.ZE) - 1):
            if rng.random() < 0.55:
                za, zb = H.clear(H.ZE, j)
                host, Lmax = host_rib_soffit(za, zb, H.XE[i] + rng.uniform(-0.12, 0.12), False, rng.choice([-1, 1]))
                obs.append(wax_curtain('calcite_wax_arch', host, rng.uniform(0.55, 0.85), Lmax * rng.uniform(0.55, 0.85), mats, c, rng, Lend=Lmax * 0.97, land='cap'))
    # along groin lines toward the free piers
    for i in range(len(H.XE) - 1):
        for j in range(len(H.ZE) - 1):
            if rng.random() < 0.35:
                continue
            xa, xb = H.clear(H.XE, i); za, zb = H.clear(H.ZE, j)
            cx, cz = (xa + xb) / 2, (za + zb) / 2
            cand = [k for k in [(xa, za), (xb, za), (xb, zb), (xa, zb)] if not (H.is_wall(k[0]) or H.is_wall(k[1]))]
            if not cand or H.vault_hole(cx, cz):
                continue
            kx, kz = cand[rng.integers(len(cand))]
            host, Lmax = host_groin_faces(cx, cz, kx, kz)
            W0 = rng.uniform(0.7, 1.1)
            Lc = Lmax * rng.uniform(0.55, 0.8)
            obs.append(wax_curtain('calcite_wax_groin', host, W0, Lc, mats, c, rng, T=0.06, taper=-0.2, Lend=Lmax * 0.99, land='cap'))
    # down the wall lunettes from the vault joint
    for wname, fixed, inward, tmin, tmax in (('x0', spec.HALL_X0, np.array([1.0, 0, 0]), spec.HALL_Z0 + 1, spec.HALL_Z1 - 3.5),
                                            ('x1', spec.HALL_X1, np.array([-1.0, 0, 0]), spec.HALL_Z0 + 7, spec.HALL_Z1 - 1),
                                            ('z1', spec.HALL_Z1, np.array([0, 0, -1.0]), spec.HALL_X0 + 3, spec.HALL_X1 - 6.5)):
        for k in range(3):
            t = rng.uniform(tmin, tmax)
            if wname[0] == 'x':
                yt = H.ceiling(np.array([fixed + inward[0] * 0.01]), np.array([t]))[0]
                top = np.array([fixed, yt - 0.04, t])
            else:
                yt = H.ceiling(np.array([t]), np.array([fixed + inward[2] * 0.01]))[0]
                top = np.array([t, yt - 0.04, fixed])
            if yt < -2.4:
                continue
            across = np.cross(inward, [0, 1.0, 0])
            W0 = rng.uniform(0.4, 0.9)
            on_walk = any((top[0] > x0 - 0.3) and (top[0] < x1 + 0.3) and (top[2] > z0 - 0.3) and (top[2] < z1 + 0.3) for (x0, x1, z0, z1, ws) in H.WALKS)
            yend = spec.LEDGE_Y + 0.01 if on_walk else spec.WATER_Y + 0.02
            obs.append(wax_curtain('calcite_wax_wall', host_plane(top, (0, -1, 0), across, inward), W0, rng.uniform(0.9, 1.8), mats, c, rng, T=0.03 + 0.06 * W0,
                                   Lend=top[1] - yend, land='ledge' if on_walk else None))
    return obs

def gallery_wax(g, mats, c, rng):
    from . import gfeat as GF
    obs = []
    s_p, y_p, v_p, vtot = G.shell_profile(g.dv)
    vc = vtot / 2
    busy = [d[0] for d in GF.DRAINS] + [q[0] for q in GF.PIPES] + [g.shaft_u, GF.PENSTOCK_U, GF.LAMP_U]
    strong = sorted([sp for sp in g.seeps if sp[2] > 0.5 and abs(sp[1] - vc) > 0.6], key=lambda x: -x[2])
    strong = [sp for sp in strong if min(abs(sp[0] - b) for b in busy) > 1.0][:12]
    for (su, sv, st) in strong:
        side = 1 if sv > vc else -1
        y_top = min(np.interp(sv, v_p, y_p) - 0.05, -1.3)
        L = y_top - spec.LEDGE_Y
        W0 = rng.uniform(0.5, 0.85)
        obs.append(wax_curtain('calcite_wax_gal', host_gallery(g, su, side, y_top), W0, L * rng.uniform(0.45, 0.7), mats, c, rng, T=0.01 + 0.015 * W0, taper=0.78, relief=0.35,
                               Lend=y_top - spec.LEDGE_Y - 0.01, land='ledge'))
    return obs

TEST_RIB = dict(i=1, j=0)   # hall rib on the pier line x = -146.25, first bay

def test_curtain(mats, c, rng):
    """The reference curtain for the 2 m close-up (curtain_test)."""
    za, zb = H.clear(H.ZE, TEST_RIB['j'])
    host, Lmax = host_rib_soffit(za, zb, H.XE[TEST_RIB['i']] + 0.05, False, -1)
    ob = wax_curtain('calcite_wax_TEST', host, 0.8, Lmax * 0.8, mats, c, np.random.default_rng(606))
    mid, n = host(0.0, Lmax * 0.35)
    return ob, mid, n


# ------------------------------------------------------------------ run-off below every deposit (round 8)
def _ribbon(name, pts, nrms, widths, offs, mat, c, ncross=5, ridge=None):
    """Strip lying on the host surface along pts (n,3) with per-point normal, width and offset."""
    pts = np.asarray(pts); nrms = np.asarray(nrms)
    T = np.gradient(pts, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-9
    side = np.cross(nrms, T); side /= np.linalg.norm(side, axis=1, keepdims=True) + 1e-9
    xs = np.linspace(-1, 1, ncross)
    P = np.zeros((len(pts), ncross, 3)); UV = np.zeros((len(pts), ncross, 2))
    vv = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    for i in range(len(pts)):
        for j, x in enumerate(xs):
            h = offs[i] + (ridge[i] * (1 - x * x) if ridge is not None else 0.0)
            P[i, j] = pts[i] + side[i] * x * widths[i] * 0.5 + nrms[i] * h
            UV[i, j] = (x, vv[i])
    flip = G.orient_check(P, P[len(pts) // 2, ncross // 2] + nrms[len(pts) // 2])
    ob = U.grid_mesh(name, P, UV, flip=flip, coll_=c, mat=mat)
    ob.visible_shadow = False
    return ob

def _disc(name, centre, normal, r, mat, c, rng):
    n = np.asarray(normal, float); n /= np.linalg.norm(n)
    a1 = np.cross(n, [1.0, 0, 0]) if abs(n[0]) < 0.9 else np.cross(n, [0, 0, 1.0]); a1 /= np.linalg.norm(a1)
    a2 = np.cross(n, a1)
    ang = np.linspace(0, 2 * np.pi, 25)[:-1]
    rr = r * (1 + 0.25 * np.sin(ang * 3 + rng.uniform(0, 6)) + 0.12 * np.sin(ang * 7 + rng.uniform(0, 6)))
    V = [np.asarray(centre) + n * 0.003] + [np.asarray(centre) + n * 0.002 + a1 * np.cos(t) * q + a2 * np.sin(t) * q for t, q in zip(ang, rr)]
    F = [[0, k + 1, (k + 1) % 24 + 1] for k in range(24)]
    uv = []
    for f in F:
        for vi in f:
            uv.append((0.0, 0.0) if vi == 0 else (1.0, 0.0))
    ob = U.mesh_from_faces(name, np.array(V), F, uv=np.array(uv), coll_=c, mat=mat, smooth=False)
    if np.dot(np.cross(np.array(V[1]) - V[0], np.array(V[2]) - V[0]), n) < 0:
        ob.data.flip_normals()
    ob.visible_shadow = False
    return ob

RUNOFF_PTS = []

def _path(host, a0, d0, d1, ph, drift=0.0):
    ds = np.arange(d0, d1, 0.02)
    pts, nrms = [], []
    for d in ds:
        aa = a0 + drift * (d - d0) + 0.025 * np.sin(d * 3.1 + ph) + 0.012 * np.sin(d * 11 + ph)
        p, n = host(aa, d)
        pts.append(p); nrms.append(n)
    return ds, np.array(pts), np.array(nrms)

def build_runoff(mats, c, rng):
    obs = []
    for k, dep in enumerate(DEPOSITS):
        host, L, Lend, hw = dep['host'], dep['L'], dep['Lend'], dep['hw_b']
        if Lend <= L * 0.8 + 0.05:
            continue
        for r in range(int(rng.integers(2, 5))):
            a0 = rng.uniform(-0.6, 0.6) * hw
            d0 = L * rng.uniform(0.7, 0.85)
            d1 = d0 + (Lend - d0) * (1.0 if r < 2 else rng.uniform(0.4, 0.9))
            ph = rng.uniform(0, 6.28)
            ds, pts, nrms = _path(host, a0, d0, d1, ph)
            if len(ds) < 4:
                continue
            branches = [(ds, pts, nrms, 1.0)]
            for bnum in range(int(rng.integers(0, 3)) if r < 2 else 0):
                db = d0 + (d1 - d0) * rng.uniform(0.15, 0.6)
                bl = (d1 - db) * rng.uniform(0.3, 0.8)
                bds, bpts, bn = _path(host, a0 + 0.025 * np.sin(db * 3.1 + ph), db, db + bl, ph + 1.7, drift=rng.choice([-1, 1]) * rng.uniform(0.15, 0.4))
                if len(bds) > 3:
                    branches.append((bds, bpts, bn, 0.55))
            for (bds, bpts, bn, sc) in branches:
                f = (bds - bds[0]) / max(bds[-1] - bds[0], 1e-3)
                fade = np.clip(1.2 - f, 0.3, 1.0)
                obs.append(_ribbon('runoff_wet', bpts, bn, (0.1 + 0.12 * f) * sc + 0.03, np.full(len(bds), 0.004), mats['wet_trail'], c, ncross=7))
                w = (0.035 + 0.045 * (1 - f) + rng.uniform(0, 0.01)) * sc * fade + 0.02
                ridge = np.zeros(len(bds))
                obs.append(_ribbon('runoff_lime', bpts, bn, w, np.full(len(bds), 0.005), mats['lime_runnel'], c, ncross=7, ridge=np.broadcast_to(ridge, (len(bds),))))
                if rng.random() < 0.25:
                    obs.append(_ribbon('runoff_iron', bpts, bn, (0.03 + 0.05 * f) * sc, np.full(len(bds), 0.0045), mats['iron_trail'], c, ncross=5))
                RUNOFF_PTS.extend(list(bpts))
            if r < 2 and dep['land'] in ('ledge', 'cap'):
                end = pts[-1].copy()
                yl = spec.LEDGE_Y if dep['land'] == 'ledge' else H.S_PIER
                if dep['land'] != 'cap':
                    end = end + nrms[-1] * 0.08
                end[1] = yl + 0.001
                obs.append(_disc('runoff_splash', end, (0, 1.0, 0), rng.uniform(0.12, 0.25), mats['lime_splash'], c, rng))
    return obs

def apply_halo(rng):
    """Lime halo round every deposit into the 'wxH' attribute of the masonry (strongest at the deposit edge,
    fading over 0.3 to 1 m with a mottled reach), damp lime stain along every run-off path, and flatter masonry
    under the runnels (lime fills the joints there), so the runnel stains lie on the wall."""
    import bpy
    from mathutils import kdtree
    dep_pts = np.concatenate([d['pts'] for d in DEPOSITS]) if DEPOSITS else np.zeros((0, 3))
    kd = kdtree.KDTree(len(dep_pts))
    for i, p in enumerate(dep_pts):
        kd.insert(U.g2b(p), i)
    kd.balance()
    kr = kdtree.KDTree(max(1, len(RUNOFF_PTS)))
    for i, p in enumerate(RUNOFF_PTS):
        kr.insert(U.g2b(p), i)
    kr.balance()
    hosts = [o for o in bpy.data.objects if o.type == 'MESH' and o.data.color_attributes.get('wxA') is not None
             and o.data.color_attributes.get('wxC') is not None and o.data.color_attributes.get('wxB') is not None]
    for o in hosts:
        me = o.data
        n = len(me.vertices)
        co = np.zeros(n * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        M = np.array(o.matrix_world); co = co @ M[:3, :3].T + M[:3, 3]
        A = np.zeros(n * 4, np.float32); me.color_attributes['wxA'].data.foreach_get('color', A); A = A.reshape(-1, 4)
        B = np.zeros(n * 4, np.float32); me.color_attributes['wxB'].data.foreach_get('color', B); B = B.reshape(-1, 4)
        C = np.zeros(n * 4, np.float32); me.color_attributes['wxC'].data.foreach_get('color', C); C = C.reshape(-1, 4)
        Hh = np.zeros((n, 4), np.float32)
        reach = 0.3 + 0.7 * np.clip(U.fbm3(co, 911, 0.8) * 1.6 - 0.3, 0, 1)
        changed = False
        for i in range(n):
            p, idx, d = kd.find(co[i])
            if d is not None and d < 1.0:
                h = max(0.0, 1 - d / reach[i]) ** 1.2
                Hh[i, 0] = h
                C[i, 1] = max(C[i, 1], h)
                changed = True
            if RUNOFF_PTS:
                p2, idx2, d2 = kr.find(co[i])
                if d2 is not None and d2 < 0.3:
                    w = 1 - d2 / 0.3
                    C[i, 3] = max(C[i, 3], w)
                    Hh[i, 0] = max(Hh[i, 0], 0.45 * w)
                    if d2 < 0.16:
                        B[i, 3] = min(B[i, 3], 0.2 + 0.8 * (d2 / 0.16))
                    changed = True
        if changed:
            me.color_attributes['wxA'].data.foreach_set('color', A.ravel())
            me.color_attributes['wxB'].data.foreach_set('color', B.ravel())
            me.color_attributes['wxC'].data.foreach_set('color', C.ravel())
            at = me.color_attributes.get('wxH') or me.color_attributes.new('wxH', 'FLOAT_COLOR', 'POINT')
            at.data.foreach_set('color', Hh.ravel())
    return len(hosts)
