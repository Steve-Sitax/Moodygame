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

def wax_curtain(name, host, W0, L, mats, c, rng, T=None, na=51, nd=64, taper=0.72):
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
            top = _sm(0.0, 0.07, f)
            bot = 1 - _sm(0.82, 1.0, g)
            folds = 1 + 0.07 * np.sin(a * np.pi * 1.4 + ph[4] + f * 1.5) + 0.05 * np.sin(f * 7 + ph[5] + a)
            be = base_e * top * bot
            th = T * be * (1 - 0.65 * f) * folds * (0.2 + 0.8 * patch)
            o = _sm(0.0, 0.14, be)
            off = max(th, 0.005) * o - EMBED * (1 - o)
            P[i, j] = p + n * off
            UV[i, j] = (am, -dm)
            Fm[i, j, 0] = be * (0.35 + 0.65 * patch)
    ob = U.grid_mesh(name, P, UV, attrs={'wxF': Fm}, coll_=c, mat=mats['calcite'],
                     flip=G.orient_check(P, P[nd // 3, na // 2] + host(0.0, L * 0.3)[1]))
    U.add_adaptive(ob, 1.5)
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
                obs.append(wax_curtain('calcite_wax_arch', host, rng.uniform(0.55, 0.85), Lmax * rng.uniform(0.55, 0.85), mats, c, rng))
    for i in range(1, len(H.XE) - 1):
        for j in range(len(H.ZE) - 1):
            if rng.random() < 0.55:
                za, zb = H.clear(H.ZE, j)
                host, Lmax = host_rib_soffit(za, zb, H.XE[i] + rng.uniform(-0.12, 0.12), False, rng.choice([-1, 1]))
                obs.append(wax_curtain('calcite_wax_arch', host, rng.uniform(0.55, 0.85), Lmax * rng.uniform(0.55, 0.85), mats, c, rng))
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
            host, Lmax = host_groin(cx, cz, kx, kz)
            W0 = rng.uniform(1.1, 1.6)
            obs.append(wax_curtain('calcite_wax_groin', host, W0, Lmax * rng.uniform(0.75, 0.95), mats, c, rng, T=0.05, taper=0.3))
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
            obs.append(wax_curtain('calcite_wax_wall', host_plane(top, (0, -1, 0), across, inward), W0, rng.uniform(1.0, 2.2), mats, c, rng, T=0.03 + 0.06 * W0))
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
        L = y_top - (spec.LEDGE_Y + rng.uniform(0.3, 0.9))
        W0 = rng.uniform(0.5, 1.0)
        obs.append(wax_curtain('calcite_wax_gal', host_gallery(g, su, side, y_top), W0, L, mats, c, rng, T=0.02 + 0.05 * W0))
    return obs

TEST_RIB = dict(i=1, j=0)   # hall rib on the pier line x = -146.25, first bay

def test_curtain(mats, c, rng):
    """The reference curtain for the 2 m close-up (curtain_test)."""
    za, zb = H.clear(H.ZE, TEST_RIB['j'])
    host, Lmax = host_rib_soffit(za, zb, H.XE[TEST_RIB['i']] + 0.05, False, -1)
    ob = wax_curtain('calcite_wax_TEST', host, 0.8, Lmax * 0.8, mats, c, np.random.default_rng(606))
    mid, n = host(0.0, Lmax * 0.35)
    return ob, mid, n
