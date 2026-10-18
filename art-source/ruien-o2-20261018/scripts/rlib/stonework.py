# Bluestone quoins, voussoirs in brick arches, calcite curtains and draperies, wall drains, corbel shelf.
# After Steve's Ruien photo (2026-10-18): grey bluestone cornerstones on piers and openings, white flowstone.
import numpy as np
import bpy
import spec
from . import util as U
from . import props as PR
from . import gallery as G
from . import hall as H

EMBED = 0.016   # curtain edges sit this far inside the masonry, so no boundary or seam shows

def flow_thick(w, f, W0, ph, flutes=None):
    """Flowstone thickness across (w in -1..1) and down (f in 0..1) a curtain: 0 at every edge (then sunk in),
    built-up fluted lobes thickest near the leak, stacked tiers, breaking into separate runnels lower down."""
    flutes = flutes or (4 + int(6 * W0))
    T = 0.07 + 0.13 * W0
    sm = lambda a, b, x: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    edge = sm(1.0, 0.5, abs(w))
    top = sm(0.0, 0.1, f)
    bot = 1 - sm(0.88, 1.0, f)
    lobe = abs(np.sin(w * flutes * np.pi / 2 + ph[1] + f * 1.4))
    lobes = 0.5 + 0.5 * lobe ** 0.6
    tiers = 0.82 + 0.18 * np.sin(f * 24 + ph[2] + w * 2)
    runnel = lobe ** 3
    lowf = sm(0.45, 0.8, f)
    th = T * edge * top * bot * (1 - 0.55 * f) * lobes * tiers
    th = th * (1 - lowf + lowf * runnel)
    return th - EMBED

def _blk(name, C, mat, c, rng, r=0.012, chips=(5, 10), corners=(0, 2)):
    return U.block_object(name, C, mat, c, r=r, res=0.065, seed=int(rng.integers(1e6)), chips=int(rng.integers(*chips)),
                          chip_size=(0.015, 0.06), corners=int(rng.integers(*corners)), wobble=0.002)

# ------------------------------------------------------------------ quoins
def pier_quoins(mats, c, rng):
    obs = []
    PH = H.PH
    y0, y1 = -4.9, H.S_PIER - 0.28
    for px in spec.HALL_XL:
        for pz in spec.HALL_ZL:
            ys = [y0]
            k = 0
            while ys[-1] < y1 - 0.12:
                ys.append(min(y1, ys[-1] + (0.3 if k % 2 == 0 else 0.24) + rng.normal(0, 0.012)))
                k += 1
            for ci, (sx, sz) in enumerate(((1, 1), (1, -1), (-1, 1), (-1, -1))):
                for k in range(len(ys) - 1):
                    longx = (k + ci) % 2 == 0
                    lx, lz = (0.44, 0.24) if longx else (0.24, 0.44)
                    xa, xb = sorted((px + sx * (PH + 0.012), px + sx * (PH - lx)))
                    za, zb = sorted((pz + sz * (PH + 0.012), pz + sz * (PH - lz)))
                    C = U.box_corners(xa, xb, ys[k] + 0.004, ys[k + 1] - 0.004, za, zb)
                    obs.append(_blk('pier_quoin', C, mats['bluestone_quoin'], c, rng))
    return obs

def mouth_quoins(mats, c, rng):
    obs = []
    for name, md in H.MOUTHS.items():
        o, t_ax, n_in = H.mouth_frame(name, md['wall'])
        tc, hm, a, b = H.mouth_geom(name)
        ys = [-4.9]
        k = 0
        top_q = H.MOUTH_SPRING - 0.15
        while ys[-1] < top_q - 0.12:
            ys.append(min(top_q, ys[-1] + (0.3 if k % 2 == 0 else 0.24)))
            k += 1
        for sgn in (-1, 1):
            edge = o + t_ax * sgn * hm
            for k in range(len(ys) - 1):
                along = 0.44 if k % 2 == 0 else 0.24
                deep = 0.24 if k % 2 == 0 else 0.44
                p0 = edge - t_ax * sgn * 0.012
                p1 = edge + t_ax * sgn * along
                C = np.array([(p0 if not (j & 1) else p1) + np.array([0, ys[k] + 0.004 if not (j & 2) else ys[k + 1] - 0.004, 0]) + n_in * (0.012 if not (j & 4) else -deep) for j in range(8)])
                obs.append(_blk('mouth_quoin', C, mats['bluestone_quoin'], c, rng))
    return obs

# ------------------------------------------------------------------ bluestone voussoirs set into the brick ribs
def rib_voussoirs(mats, c, rng, drop=0.3):
    """Bluestone voussoirs set radially into the brick arch rings at intervals (stone, brick, brick, stone)."""
    obs = []
    def arc(t0, t1, w0, w1, along_x):
        tt, yv, nrm, L = H.rib_curve(t0, t1, n=400)
        total = L[-1]
        q = rng.uniform(0.15, 0.35)
        while q < total - 0.2:
            qa, qb = q, q + 0.32
            pts = []
            for qq in (qa, qb):
                t = np.interp(qq, L, tt); y = np.interp(qq, L, yv)
                nx = np.interp(qq, L, nrm[:, 0]); ny = np.interp(qq, L, nrm[:, 1])
                pts.append(((t - nx * (drop + 0.025), y - ny * (drop + 0.025)), (t + nx * 0.06, y + ny * 0.06)))
            k_ = int(q * 7) % 2
            for (wa, wb) in ((w0 - 0.002, w0 + (0.5 if k_ else 0.32)), (w1 - (0.32 if k_ else 0.5), w1 + 0.002)):
                C = []
                for j in range(8):
                    (ins, outs) = pts[j & 1]
                    ty = ins if not (j & 2) else outs
                    w = wa if not (j & 4) else wb
                    C.append([ty[0], ty[1], w] if along_x else [w, ty[1], ty[0]])
                obs.append(_blk('rib_voussoir', np.array(C), mats['bluestone_quoin'], c, rng, chips=(4, 9)))
            q += rng.uniform(1.7, 2.3)
    for j in range(1, len(H.ZE) - 1):
        for i in range(len(H.XE) - 1):
            xa, xb = H.clear(H.XE, i)
            arc(xa, xb, H.ZE[j] - H.PH, H.ZE[j] + H.PH, True)
    for i in range(1, len(H.XE) - 1):
        for j in range(len(H.ZE) - 1):
            za, zb = H.clear(H.ZE, j)
            arc(za, zb, H.XE[i] - H.PH, H.XE[i] + H.PH, False)
    return obs

def mouth_voussoirs(mats, c, rng):
    obs = []
    for name, md in H.MOUTHS.items():
        o, t_ax, n_in = H.mouth_frame(name, md['wall'])
        tc, hm, a, b = H.mouth_geom(name)
        R_ = H.MOUTH_CROWN - H.MOUTH_SPRING
        for th in (np.pi * 0.25, np.pi * 0.5, np.pi * 0.75):
            pts = []
            for t in (th - 0.06, th + 0.06):
                s0, y0 = hm * np.cos(t), H.MOUTH_SPRING + R_ * np.sin(t)
                nrm = np.array([np.cos(t) / hm, np.sin(t) / R_]); nrm /= np.linalg.norm(nrm)
                pts.append(((s0 - nrm[0] * 0.01, y0 - nrm[1] * 0.01), (s0 + nrm[0] * 0.26, y0 + nrm[1] * 0.26)))
            C = []
            for j in range(8):
                (ins, outs) = pts[j & 1]
                sy = ins if not (j & 2) else outs
                C.append(o + t_ax * sy[0] + np.array([0, sy[1], 0]) + n_in * (0.02 if not (j & 4) else -0.5))
            obs.append(_blk('mouth_voussoir', np.array(C), mats['bluestone_quoin'], c, rng))
    return obs

# ------------------------------------------------------------------ calcite curtains and draperies
def curtain_planar(name, top, down, across, normal, W0, L, mats, c, rng, flow_meshes, T=None):
    """Flowstone curtain on a face: wide at the leak, narrowing down, proud in the middle, drip fingers below."""
    down, across, normal = (np.asarray(v, float) / np.linalg.norm(v) for v in (down, across, normal))
    T = T or (0.02 + 0.035 * W0)
    nw, nl = 41, 44
    ph = rng.uniform(0, 6.28, 4)
    P = np.zeros((nl, nw, 3))
    for j in range(nl):
        l = j / (nl - 1) * L
        f = l / L
        hw = 0.5 * W0 * (1 - f) ** 0.65 * (1 + 0.2 * np.sin(f * 9 + ph[0])) + 0.015
        for i in range(nw):
            w = -1 + 2 * i / (nw - 1)
            lobes = 0.06 * L * max(0, f - 0.6) * np.sin(w * 7 + ph[1])
            flutes = 4 + int(6 * W0)
            th = flow_thick(w, f, W0, ph)
            P[j, i] = top + down * (l + lobes) + across * (w * hw) + normal * th
    UV = np.stack(np.meshgrid(np.linspace(0, W0, nw), np.linspace(0, L, nl)), -1)
    P = P + normal * (T * 0.5 * np.sin(P[..., 0:1] * 37 + P[..., 1:2] * 23) * np.sin(P[..., 2:3] * 31 + P[..., 1:2] * 11))
    ob = U.grid_mesh(name, P, UV, flip=G.orient_check(P, P[nl // 2, nw // 2] + normal), coll_=c, mat=mats['calcite'])
    U.add_adaptive(ob, 2.0)
    obs = [ob]
    for k in range(0):
        i = rng.integers(2, nw - 2)
        tip = P[-1 - rng.integers(0, 4), i]
        o = bpy.data.objects.new(name + '_finger', flow_meshes[rng.integers(len(flow_meshes))])
        c.objects.link(o)
        o.location = U.gv(*tip)
        sc = rng.uniform(0.5, 0.9)
        o.scale = (sc, sc, rng.uniform(0.02, 0.07))
        obs.append(o)
    return obs

def curtain_gallery(name, g, u0, side, y_top, W0, mats, c, rng, flow_meshes, T=None):
    """Curtain following the curved gallery wall from a leak on the haunch down toward the ledge."""
    p = g.path
    T = T or (0.018 + 0.03 * W0)
    nw, nl = 41, 44
    y_bot = spec.LEDGE_Y + rng.uniform(0.25, 0.9)
    L = y_top - y_bot
    ph = rng.uniform(0, 6.28, 3)
    P = np.zeros((nl, nw, 3))
    for j in range(nl):
        f = j / (nl - 1)
        y = y_top - f * L
        hw = 0.5 * W0 * (1 - f) ** 0.6 * (1 + 0.2 * np.sin(f * 8 + ph[0])) + 0.015
        for i in range(nw):
            w = -1 + 2 * i / (nw - 1)
            flutes = 4 + int(6 * W0)
            th = flow_thick(w, f, W0, np.r_[ph, 0.0])
            uu = u0 + w * hw + 0.05 * np.sin(f * 6 + ph[2])
            P[j, i] = p.world(np.array(uu), np.array(side * (G.shell_s_at_y(y) - th)), np.array(y))
    UV = np.stack(np.meshgrid(np.linspace(0, W0, nw), np.linspace(0, L, nl)), -1)
    centre_in = p.world(np.array(u0), np.array(0.0), np.array(-2.5))
    ob = U.grid_mesh(name, P, UV, flip=G.orient_check(P, centre_in), coll_=c, mat=mats['calcite'])
    U.add_adaptive(ob, 2.0)
    obs = [ob]
    for k in range(0):
        tip = P[-1 - rng.integers(0, 5), rng.integers(2, nw - 2)]
        o = bpy.data.objects.new(name + '_finger', flow_meshes[rng.integers(len(flow_meshes))])
        c.objects.link(o)
        o.location = U.gv(*tip)
        sc = rng.uniform(0.5, 0.9)
        o.scale = (sc, sc, rng.uniform(0.02, 0.07))
        obs.append(o)
    return obs

def arch_face_flow(name, t0, t1, w, side, along_x, mats, c, rng, drop=0.3):
    """Calcite sheet on an arch-ring face: from a leak near the crown, down the curve towards a pier,
    thick and fluted, its lower edge hanging below the soffit."""
    tt, yv, nrm, L = H.rib_curve(t0, t1, n=300)
    total = L[-1]
    if rng.random() < 0.5:
        q0 = total * rng.uniform(0.4, 0.46); q1 = total * rng.uniform(0.04, 0.1)
    else:
        q0 = total * rng.uniform(0.54, 0.6); q1 = total * rng.uniform(0.9, 0.96)
    qs = np.linspace(q0, q1, 40)
    rows = 22
    P = np.zeros((len(qs), rows, 3))
    ph = rng.uniform(0, 6.28, 3)
    for i, qq in enumerate(qs):
        f = i / (len(qs) - 1)
        t = np.interp(qq, L, tt); y = np.interp(qq, L, yv)
        nx = np.interp(qq, L, nrm[:, 0]); ny = np.interp(qq, L, nrm[:, 1])
        hang = (0.05 + 0.25 * np.sin(np.pi * f) ** 0.8) * (0.6 + 0.4 * np.sin(f * 13 + ph[0]))
        width = 1.0 - 0.6 * f
        for r in range(rows):
            g_ = r / (rows - 1)
            depth = 0.03 + (drop - 0.05) * g_
            th = flow_thick(2 * g_ - 1, f, 0.45, np.r_[ph, 0.0], flutes=3)
            tp = t - nx * depth
            yp = y - ny * depth
            ws = w + side * th
            P[i, r] = [tp, yp, ws] if along_x else [ws, yp, tp]
    UV = np.stack(np.meshgrid(np.linspace(0, 1, rows), qs), -1)
    ctr = P[len(qs) // 2, rows // 2].copy()
    if along_x:
        ctr[2] += side
    else:
        ctr[0] += side
    ob = U.grid_mesh(name, P, UV, flip=G.orient_check(P, ctr), coll_=c, mat=mats['calcite'])
    U.add_adaptive(ob, 2.0)
    return ob

def groin_curtain(name, cx, cz, kx, kz, pier_xz, mats, c, rng):
    """Flowstone sheet from a leak on a groin line near the crown, down the groin to the pier,
    then down the pier side towards the water. Up to 1 m wide at the top, fluted, thick, lobed lower edge."""
    W0 = rng.uniform(0.55, 1.0)
    f0 = rng.uniform(0.25, 0.45)
    n_a, n_w = 56, 41
    d = np.array([kx - cx, kz - cz]); Ld = np.linalg.norm(d); d /= Ld
    perp = np.array([-d[1], d[0]])
    ph = rng.uniform(0, 6.28, 4)
    flutes = 5 + int(7 * W0)
    P = np.zeros((n_a, n_w, 3))
    for i in range(n_a):
        f = f0 + (1.0 - f0) * i / (n_a - 1)
        g_ = (f - f0) / (1 - f0)
        hw = 0.5 * W0 * (1 - 0.55 * g_) * (1 + 0.15 * np.sin(g_ * 7 + ph[0]))
        base = np.array([cx, cz]) + d * (f * Ld * 0.97)
        for j in range(n_w):
            w = -1 + 2 * j / (n_w - 1)
            p = base + perp * (w * hw)
            y = H.ceiling(np.array([p[0]]), np.array([p[1]]))[0]
            th = flow_thick(w, g_, W0, ph)
            P[i, j] = [p[0], y - th, p[1]]
    UV = np.stack(np.meshgrid(np.linspace(0, W0, n_w), np.linspace(0, Ld, n_a)), -1)
    ob = U.grid_mesh(name, P, UV, flip=G.orient_check(P, P[n_a // 2, n_w // 2] + np.array([0, -1.0, 0])), coll_=c, mat=mats['calcite'])
    U.add_adaptive(ob, 2.0)
    return [ob]

def drapery(name, pts_top, mats, c, rng, hmax=0.3, side_dir=(0, 0, 1)):
    """Thin wavy flowstone sheet hanging along a soffit line."""
    pts_top = np.asarray(pts_top, float)
    n = len(pts_top)
    sd = np.asarray(side_dir, float); sd /= np.linalg.norm(sd)
    ph = rng.uniform(0, 6.28, 3)
    t = np.linspace(0, 1, n)
    hgt = hmax * (0.25 + 0.75 * np.sin(np.pi * t) ** 0.7) * (0.75 + 0.25 * np.sin(t * 17 + ph[0]))
    wig = 0.03 * np.sin(t * 23 + ph[1])
    V, F = [], []
    rows = 5
    for k in range(n):
        for r in range(rows):
            f = r / (rows - 1)
            for sgn in (-1, 1):
                th = 0.006 * (1 - 0.6 * f)
                V.append(pts_top[k] + np.array([0, 0.01 - f * hgt[k], 0]) + sd * (wig[k] * (0.3 + f) + sgn * th))
    def vid(k, r, s_):
        return (k * rows + r) * 2 + s_
    for k in range(n - 1):
        for r in range(rows - 1):
            F.append([vid(k, r, 0), vid(k, r + 1, 0), vid(k + 1, r + 1, 0), vid(k + 1, r, 0)])
            F.append([vid(k, r, 1), vid(k + 1, r, 1), vid(k + 1, r + 1, 1), vid(k, r + 1, 1)])
        F.append([vid(k, rows - 1, 0), vid(k, rows - 1, 1), vid(k + 1, rows - 1, 1), vid(k + 1, rows - 1, 0)])
    return U.mesh_from_faces(name, np.array(V), F, coll_=c, mat=mats['calcite'])

def hall_calcite(mats, c, rng, flow_meshes):
    obs = []
    PH = H.PH
    # sheets down the arch faces from crown leaks (the photo's main feature)
    for j in range(1, len(H.ZE) - 1):
        for i in range(len(H.XE) - 1):
            xa, xb = H.clear(H.XE, i)
            for side in (-1, 1):
                if rng.random() < 0.6:
                    w = H.ZE[j] + side * PH
                    obs.append(arch_face_flow('calcite_archface', xa, xb, w, side, True, mats, c, rng))
    for i in range(1, len(H.XE) - 1):
        for j in range(len(H.ZE) - 1):
            za, zb = H.clear(H.ZE, j)
            for side in (-1, 1):
                if rng.random() < 0.6:
                    w = H.XE[i] + side * PH
                    obs.append(arch_face_flow('calcite_archface', za, zb, w, side, False, mats, c, rng))
    # big curtains along the groin lines to the free piers, continuing down the pier corner
    for i in range(len(H.XE) - 1):
        for j in range(len(H.ZE) - 1):
            xa, xb = H.clear(H.XE, i); za, zb = H.clear(H.ZE, j)
            cx, cz = (xa + xb) / 2, (za + zb) / 2
            cornersb = [(xa, za), (xb, za), (xb, zb), (xa, zb)]
            cand = [k for k in cornersb if not (H.is_wall(k[0]) or H.is_wall(k[1]))]
            if not cand:
                continue
            for (kx, kz) in [cand[q] for q in rng.choice(len(cand), min(len(cand), int(rng.integers(1, 3))), replace=False)]:
                if H.vault_hole(cx, cz) and rng.random() < 0.5:
                    continue
                obs += groin_curtain('calcite_groin', cx, cz, kx, kz, None, mats, c, rng)
    # down the wall lunettes from the vault joint
    for wname, fixed, inward, tmin, tmax in (('x0', spec.HALL_X0, np.array([1.0, 0, 0]), spec.HALL_Z0 + 1, spec.HALL_Z1 - 3.5),
                                            ('x1', spec.HALL_X1, np.array([-1.0, 0, 0]), spec.HALL_Z0 + 7, spec.HALL_Z1 - 1),
                                            ('z1', spec.HALL_Z1, np.array([0, 0, -1.0]), spec.HALL_X0 + 3, spec.HALL_X1 - 6.5)):
        for k in range(5):
            t = rng.uniform(tmin, tmax)
            if wname[0] == 'x':
                yt = H.ceiling(np.array([fixed + inward[0] * 0.01]), np.array([t]))[0]
                top = np.array([fixed + inward[0] * 0.004, yt - 0.03, t])
            else:
                yt = H.ceiling(np.array([t]), np.array([fixed + inward[2] * 0.01]))[0]
                top = np.array([t, yt - 0.03, fixed + inward[2] * 0.004])
            if yt < -2.4:
                continue
            across = np.cross(inward, [0, 1.0, 0])
            obs += curtain_planar('calcite_wall', top, (0, -1, 0), across, inward, rng.uniform(0.5, 1.0), rng.uniform(1.0, 2.6), mats, c, rng, flow_meshes)
    return obs

def gallery_calcite(g, mats, c, rng, flow_meshes):
    """Curtains down the gallery walls below the strongest leaks, and under the drain mouths."""
    obs = []
    s_p, y_p, v_p, vtot = G.shell_profile(g.dv)
    vc = vtot / 2
    strong = sorted([sp for sp in g.seeps if sp[2] > 0.5 and abs(sp[1] - vc) > 0.6], key=lambda x: -x[2])[:16]
    from . import gfeat as GF
    busy = [d[0] for d in GF.DRAINS] + [q[0] for q in GF.PIPES] + [g.shaft_u, GF.PENSTOCK_U, GF.LAMP_U]
    strong = [sp for sp in strong if min(abs(sp[0] - b) for b in busy) > 1.0]
    for (su, sv, st) in strong:
        side = 1 if sv > vc else -1
        y_top = np.interp(sv, v_p, y_p) - 0.05
        y_top = min(y_top, -1.3)
        obs += curtain_gallery('calcite_gal', g, su, side, y_top, rng.uniform(0.6, 1.0), mats, c, rng, flow_meshes)
    return obs

# ------------------------------------------------------------------ square wall drains and a corbel shelf
WALL_DRAINS = [('x0', 119.6, -3.15), ('x1', 128.4, -3.1), ('z1', -151.4, -3.2)]

def wall_drain_holes():
    """(wall, t, y, half width, half height) for cutting the hall wall meshes."""
    return [(w, t, y, 0.16, 0.2) for (w, t, y) in WALL_DRAINS]

def wall_drains(mats, c, rng):
    obs = []
    for (wname, t, y) in WALL_DRAINS:
        if wname == 'x0':
            o = np.array([spec.HALL_X0, 0, t]); t_ax = np.array([0, 0, 1.0]); n_in = np.array([1.0, 0, 0])
        elif wname == 'x1':
            o = np.array([spec.HALL_X1, 0, t]); t_ax = np.array([0, 0, 1.0]); n_in = np.array([-1.0, 0, 0])
        else:
            o = np.array([t, 0, spec.HALL_Z1]); t_ax = np.array([1.0, 0, 0]); n_in = np.array([0, 0, -1.0])
        hw, hh = 0.16, 0.2
        def pt(a, b, d):
            return o + t_ax * a + np.array([0, y + b, 0]) + n_in * d
        # stone frame: lintel, sill (projecting, worn by the dribble), two jamb stones
        for (a0, a1, b0, b1) in ((-hw - 0.14, hw + 0.14, hh, hh + 0.2), (-hw - 0.14, hw + 0.14, -hh - 0.16, -hh), (-hw - 0.14, -hw, -hh, hh), (hw, hw + 0.14, -hh, hh)):
            proj = 0.09 if b1 <= -hh + 1e-6 else 0.03
            C = np.array([pt(a0 if not (j & 1) else a1, b0 if not (j & 2) else b1, proj if not (j & 4) else -0.3) for j in range(8)])
            obs.append(_blk('wall_drain_stone', C, mats['bluestone'], c, rng, chips=(3, 7)))
        # dark lined throat behind the hole
        back = [pt(-hw, -hh, -0.45), pt(hw, -hh, -0.45), pt(hw, hh, -0.45), pt(-hw, hh, -0.45)]
        sides = []
        for (a0, b0, a1, b1) in ((-hw, -hh, hw, -hh), (hw, -hh, hw, hh), (hw, hh, -hw, hh), (-hw, hh, -hw, -hh)):
            sides.append([pt(a0, b0, 0.01), pt(a1, b1, 0.01), pt(a1, b1, -0.45), pt(a0, b0, -0.45)])
        V = np.array(back + [p_ for q in sides for p_ in q])
        F = [[0, 1, 2, 3], [0, 3, 2, 1]] + [[4 + 4 * k, 5 + 4 * k, 6 + 4 * k, 7 + 4 * k] for k in range(4)] + [[7 + 4 * k, 6 + 4 * k, 5 + 4 * k, 4 + 4 * k] for k in range(4)]
        obs.append(U.mesh_from_faces('wall_drain_throat', V, F, coll_=c, mat=mats['soot_black'], smooth=False))
        # a thin trickle over the sill
        obs.append(U.tube('wall_drain_trickle', [pt(0, -hh + 0.005, -0.1), pt(0.01, -hh - 0.16 + 0.01, 0.09), pt(0.02, -hh - 0.5, 0.07), pt(0.0, spec.LEDGE_Y - y + 0.02, 0.03)], [0.012, 0.01, 0.006, 0.01], n=8, coll_=c, mat=mats['water_film']))
    return obs

def corbel_shelf(mats, c, rng):
    x0, pz = spec.HALL_X1, 122.6
    C = U.box_corners(x0 - 0.36, x0 + 0.02, -3.0, -2.72, pz - 0.24, pz + 0.24)
    obs = [_blk('pier_corbel_shelf', C, mats['bluestone'], c, rng, chips=(5, 9), corners=(1, 2))]
    b = U.lathe([(0.0, 0.0), (0.035, 0.0), (0.036, 0.16), (0.015, 0.21), (0.012, 0.27), (0.0, 0.275)], 14, 'shelf_bottle', c, mats['glass_green'])
    b.location = U.gv(x0 - 0.2, -2.72, pz + 0.08)
    obs.append(b)
    return obs
