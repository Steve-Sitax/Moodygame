# Ruien kit: section sweep along any route polyline from docs/plans/ruien/ruien-routes.json.
# Sections come from ruien-network.json classes: 'G' giant gallery (6 m, ledges both sides at -3.6, bed -6.1),
# 'M' rui (3.6 m, one walkway 0.8 m at -3.9, bed -4.9, crown -0.9, water about 0.5 m).
# Everything random is seeded from the route id and the 10 m segment, so a rebuild gives the same stretch.
import zlib
import numpy as np
import bpy
import spec
from rlib import util as U, gallery as G, props as PR, wax as WX, debris as D

# ------------------------------------------------------------------ sections
class Section:
    def __init__(self, cls='M', walkway_side=1):
        self.cls = cls
        if cls == 'G':
            self.W, self.bed, self.crown, self.ledge_y, self.ledge_w, self.water = 6.0, -6.1, -0.9, -3.6, 1.5, -4.6
            self.spring = -3.1                     # basket arch, as O2
            self.sides = (-1, 1)
        else:
            self.W, self.bed, self.crown, self.ledge_y, self.ledge_w, self.water = 3.6, -4.9, -0.9, -3.9, 0.8, -4.4
            self.spring = self.crown - self.W / 2  # semicircle
            self.sides = (walkway_side,)
        self.hw = self.W / 2
        self.rise = self.crown - self.spring

    def wall_s_at_y(self, y):
        y = np.asarray(y, float)
        t = np.clip((y - self.spring) / self.rise, 0, 1)
        return np.where(y <= self.spring, self.hw, self.hw * np.sqrt(np.clip(1 - t * t, 0, 1)))

    def vault_y_at_s(self, s):
        t = np.clip(np.abs(np.asarray(s, float)) / self.hw, 0, 1)
        return self.spring + self.rise * np.sqrt(np.clip(1 - t * t, 0, 1))

    def foot_y(self, side):
        return (self.ledge_y - 0.06) if side in self.sides else (self.bed - 0.15)

    def channel_edges(self):
        lo = -self.hw + (self.ledge_w if -1 in self.sides else 0.0)
        hi = self.hw - (self.ledge_w if 1 in self.sides else 0.0)
        return lo, hi

    def profile(self, dv=0.09):
        """(s, y, v, vtot) round the shell from the south foot over the vault to the north foot."""
        th = np.linspace(np.pi, 0, 3000)
        es, ey = self.hw * np.cos(th), self.spring + self.rise * np.sin(th)
        f0, f1 = self.foot_y(-1), self.foot_y(1)
        pts = np.concatenate([np.stack([np.full(40, -self.hw), np.linspace(f0, self.spring, 40)], -1)[:-1], np.stack([es, ey], -1),
                              np.stack([np.full(40, self.hw), np.linspace(self.spring, f1, 40)], -1)[1:]])
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        L = np.r_[0, np.cumsum(seg)]
        v = np.linspace(0, L[-1], int(L[-1] / dv) + 1)
        return np.interp(v, L, pts[:, 0]), np.interp(v, L, pts[:, 1]), v, L[-1]

# ------------------------------------------------------------------ route path with filleted bends
class RoutePath(G.Path):
    """Like gallery.Path, but for any polyline: every corner becomes a smooth bend of radius r (shortened
    where the legs are short), so the sweep never folds over itself."""
    def __init__(self, pts, r=4.0, step=0.01):
        K = np.array(pts, float)
        D_ = [K[0]]
        for i in range(1, len(K) - 1):
            a, b, c = K[i - 1], K[i], K[i + 1]
            d0 = (b - a) / np.linalg.norm(b - a); d1 = (c - b) / np.linalg.norm(c - b)
            ang = np.arccos(np.clip(np.dot(d0, d1), -1, 1))
            if ang < 1e-3:
                D_.append(b); continue
            cut = min(r * np.tan(ang / 2), np.linalg.norm(b - a) * 0.45, np.linalg.norm(c - b) * 0.45)
            p0 = b - d0 * cut
            r_eff = cut / np.tan(ang / 2)
            turn = np.sign(d0[0] * d1[1] - d0[1] * d1[0])
            nrm = np.array([-d0[1], d0[0]]) * turn
            cen = p0 + nrm * r_eff
            a0 = np.arctan2(p0[1] - cen[1], p0[0] - cen[0])
            t = np.linspace(0, ang, 60) * turn
            D_.extend([cen + r_eff * np.array([np.cos(a0 + q), np.sin(a0 + q)]) for q in t])
        D_.append(K[-1])
        D_ = np.array(D_)
        dense = [D_[0]]
        for a, b in zip(D_[:-1], D_[1:]):
            n = max(2, int(np.linalg.norm(b - a) / 0.05) + 1)
            dense.extend(list(np.linspace(a, b, n)[1:]))
        Dd = np.array(dense)
        seg = np.linalg.norm(np.diff(Dd, axis=0), axis=1)
        keep = np.r_[True, seg > 1e-6]
        Dd = Dd[keep]
        seg = np.linalg.norm(np.diff(Dd, axis=0), axis=1)
        L = np.r_[0, np.cumsum(seg)]
        self.length = L[-1]
        n = int(self.length / step) + 1
        self.u = np.linspace(0, self.length, n)
        self.P = np.stack([np.interp(self.u, L, Dd[:, 0]), np.interp(self.u, L, Dd[:, 1])], -1)
        T = np.gradient(self.P, axis=0)
        self.T = T / np.linalg.norm(T, axis=1, keepdims=True)
        self.N = np.stack([self.T[:, 1], -self.T[:, 0]], -1)
        ang = np.unwrap(np.arctan2(self.T[:, 1], self.T[:, 0]))
        w = 41
        ang_s = np.convolve(np.pad(ang, w // 2, mode='edge'), np.ones(w) / w, mode='valid')
        k = np.abs(np.gradient(ang_s, self.u))
        self.min_radius = 1 / max(k.max(), 1e-9)

    def u_near(self, x, z):
        d = (self.P[:, 0] - x) ** 2 + (self.P[:, 1] - z) ** 2
        i = int(np.argmin(d))
        return float(self.u[i]), float(np.sqrt(d[i]))

# ------------------------------------------------------------------ the sweep
def seed_of(route_id, seg=0):
    return zlib.crc32(('%s/%d' % (route_id, seg)).encode()) & 0x7fffffff

def build_stretch(route_id, pts, cls, mats, coll, grates=(), lamps=(), start='junction', end='open', walkway_side=1, bend_r=None, tees=(), keep_clear=()):
    """Builds one route. Returns (objects, info) with info['placements'] for the kit pieces it used.
    tees: kit/meet.py Tee objects at this route: as the branch (an end of this route opens into a gallery side;
    that end's kind is 'tee') or as the host (a rui opens into this gallery's side).
    keep_clear: more (u0, u1) spans without rings, curtains, grates or lamps (a 'stub' end's bricked-up wall)."""
    sec = Section(cls, walkway_side)
    path = RoutePath(pts, r=bend_r or (sec.W * 1.2))
    rng = np.random.default_rng(seed_of(route_id))
    profile = lambda dv=0.09, foot=None: sec.profile(dv)
    g = G.Gallery(route_id, [tuple(pts[0]), tuple(pts[-1])], mats, coll, u0=0.0, seed=seed_of(route_id) % 100000, profile=profile, hw=sec.hw)
    g.path = path
    g.u1 = path.length
    info = dict(route=route_id, cls=cls, length_m=round(path.length, 2), min_bend_radius_m=round(path.min_radius, 2), placements=[])
    as_branch = [t for t in tees if t.bpath is not None and t.branch_id == route_id]
    as_host = [t for t in tees if t.branch_id != route_id and path.u_near(*t.O)[1] < 0.3]
    zones = [t.keep_out() for t in as_branch] + [t.host_zone(path)[1] for t in as_host] + [tuple(z) for z in keep_clear]
    def clear(u, pad=0.0):
        return all(not (a - pad <= u <= b + pad) for a, b in zones)
    for t in as_branch:
        g.holes.append(t.branch_shell_hole)
        info['water_u'] = t.water_from()
        info.setdefault('tees', []).append(dict(role='branch', host=t.host_ids, node=t.O.tolist()))
    for t in as_host:
        g.holes.append(t.host_shell_hole(path))
        if hasattr(t, 'host_water'):
            info['water_u'] = t.host_water(path)
        info.setdefault('tees', []).append(dict(role='host', branch=t.branch_id, node=t.O.tolist(), side=t.sigma))
    s_p, y_p, v_p, vtot = sec.profile(g.dv)
    vc = vtot / 2
    # per 10 m segment: leaks (seeps), damage clusters, sandstone patches; reproducible per segment
    g.seeps, g.damage, g.sand, g.cdamage = [], [], [], []
    for sg in range(int(np.ceil(path.length / 10))):
        r_ = np.random.default_rng(seed_of(route_id, sg))
        u_a, u_b = sg * 10, min(path.length, sg * 10 + 10)
        for k in range(int(r_.integers(4, 10))):
            g.seeps.append((r_.uniform(u_a, u_b), vc + r_.normal(0, vtot * 0.12), r_.uniform(0.35, 1.0)))
        for k in range(int(r_.integers(0, 3))):
            g.damage.append((r_.uniform(u_a, u_b), vc + r_.choice([-1, 1]) * r_.uniform(0.25, 0.42) * vtot, r_.uniform(0.2, 0.45), r_.uniform(0.8, 1.1)))
        if r_.random() < 0.4:
            sd = int(r_.choice([-1, 1])); ua = r_.uniform(u_a, u_b)
            # Consume the old draws to preserve all other seeded details. Random rubble-foundation
            # bands have no construction basis in a brick rui; O2's authored foundations are separate.
            r_.uniform(1.5, 4.0)
        if r_.random() < 0.6:
            g.cdamage.append((r_.uniform(u_a, u_b), int(r_.choice([-1, 1])), sec.water + 0.25, r_.uniform(0.2, 0.4), 1.0))
    # grate shafts: hole in the vault over the walkway (or a ledge), shaft walls, grate and ladder
    shafts = []
    u_knots, v_knots = [], []
    for (gx, gz) in grates:
        u, d = path.u_near(gx, gz)
        if d < 4.0:
            u = float(np.clip(u, 1.2, path.length - 0.8))
            if not clear(u, 0.5):
                info.setdefault('skipped', []).append(dict(grate=[gx, gz], why='inside a tee'))
                continue
            side = sec.sides[0]
            s_c = side * (sec.hw - (sec.ledge_w * 0.55 if cls == 'M' else 0.65))
            shafts.append((u, s_c))
            uk, vk = grate_knots(sec, u, s_c)
            u_knots += uk; v_knots += vk
            g.holes.append(lambda U_, S_, Y_, u=u, s_c=s_c: (np.abs(U_ - u) < 0.329) & (np.abs(S_ - s_c) < 0.329) & (Y_ > sec.spring))
            g.wetsrc.append((u, side, sec.spring + 0.8, 0.3))
    for (lx, lz) in lamps:
        u, d = path.u_near(lx, lz)
        if d < 4.0 and clear(u, 0.5):
            g.lamps.append(tuple(path.world(np.array(u), np.array(sec.sides[0] * sec.wall_s_at_y(-2.3) * 0.98), np.array(-2.3))))
    obs = [g.build_shell(u_knots=u_knots or None, v_knots=v_knots or None)]
    for t in as_host:
        # a tee's exact cut round its arch rim (the grid holes only take the cells well inside the opening)
        if getattr(t, 'host_cutter', None) is not None:
            from kit import fitlib as FL
            V_, F_ = t.host_cutter(path)
            FL.boolean_cut(obs[0], V_, F_, coll)
    # 'through': the next route of the same section runs on; 'room': a junction room's mouth stub continues it
    # (kit/junction_gen.py stub: both builds meet without relief and on the stub's own bed)
    seams = [(u, k) for u, k in ((0.0, start), (path.length, end)) if k in ('through', 'room')]
    info['seams'] = [dict(pos=[float(v) for v in path.world(np.array(u), np.array(0.0), np.array(0.0))], tangent=[float(v) for v in np.array(path.frame(np.array(u))[2:4])], kind=k) for u, k in seams]
    obs += build_lower(g, sec, mats, coll, rng, as_branch, as_host, seams)
    if end == 'stub':
        info['channelEnds'] = [stub_end(path, sec, route_id)]
    for (u, s_c) in shafts:
        obs += grate_shaft(path, sec, u, s_c, mats, coll)
        info['placements'].append(dict(piece='grate_shaft_parametric', u=round(u, 2), pos=[round(v, 3) for v in path.world(np.array(u), np.array(s_c), np.array(sec.ledge_y))]))
    for k, lp in enumerate(g.lamps):
        u, _ = path.u_near(lp[0], lp[2])
        obs += place_lamp(path, sec, u, mats, coll, rng, name='%s_lamp_%d' % (route_id, k))   # ids unique across areas
        info['placements'].append(dict(piece='lamp_bracket_safety_lamp', u=round(u, 2), pos=[round(float(v), 3) for v in lp]))
    # ends
    for which, kind in (('start', start), ('end', end)):
        u = 0.0 if which == 'start' else path.length
        obs += end_piece(path, sec, u, kind, which, mats, coll)
    for t in as_branch:
        obs += t.build(route_id, mats, coll, np.random.default_rng(seed_of(route_id, 1000)))
    for t in as_host:
        if hasattr(t, 'build_host'):
            obs += t.build_host(route_id, mats, coll)
    # mooring rings on the walkway or ledge coping every 6 to 9 m
    u = rng.uniform(2.0, 5.0)
    while u < path.length - 2:
        side = sec.sides[int(rng.integers(len(sec.sides)))]
        lo, hi = sec.channel_edges()
        edge = hi if side > 0 else lo
        loc = path.world(np.array(u), np.array(edge - side * 0.04), np.array(sec.ledge_y - 0.12))
        px, pz, tx, tz, nx, nz = path.frame(np.array(u))
        if clear(u, 0.6):
            obs += PR.ring_on_staple('%s_ring_%d' % (route_id, len(obs)), loc, -side * np.array([float(nx), 0, float(nz)]), mats['iron_wet'], coll, R=0.06)
            info['placements'].append(dict(piece='mooring_ring', u=round(u, 2)))
        u += rng.uniform(6.0, 9.0)
    # calcite curtains (the wax recipe) under the strongest leaks, with run-off to the walkway or the water
    strong = sorted([q for q in g.seeps if q[2] > 0.6 and abs(q[1] - vc) > 0.3 * vtot * 0.4], key=lambda q: -q[2])[:max(2, int(path.length / 8))]
    for (su, sv, st) in strong:
        side = 1 if sv > vc else -1
        y_top = min(float(np.interp(sv, v_p, y_p)) - 0.05, sec.crown - 0.35)
        floor = sec.ledge_y if side in sec.sides else sec.water
        W0 = rng.uniform(0.45, 0.9)
        host = host_section(path, sec, su, side, y_top)
        L = (y_top - floor) * rng.uniform(0.45, 0.7)
        if not clear(su, 1.0):
            continue
        obs.append(WX.wax_curtain('%s_calcite' % route_id, host, W0, L, mats, coll, rng, T=0.012 + 0.02 * W0, taper=0.7, relief=0.5,
                                  Lend=y_top - floor - 0.01, land='ledge' if side in sec.sides else None))
    # floating and stranded debris, a rubble pile below each damage cluster
    for k in range(int(path.length / 2.5)):
        u = rng.uniform(1.0, path.length - 1.0); lo, hi = sec.channel_edges()
        pos = path.world(np.array(u), np.array(rng.uniform(lo + 0.2, hi - 0.2)), np.array(sec.water - 0.01))
        o = PR.plank('%s_plank_%d' % (route_id, k), rng.uniform(0.3, 1.0), rng.uniform(0.06, 0.16), 0.025, mats['wood_wet'], coll, seed=int(rng.integers(1e6)))
        if not clear(u, 0.6):
            bpy.data.objects.remove(o, do_unlink=True); continue
        o.location = U.gv(*pos); o.rotation_euler = (0, 0, rng.uniform(0, 6.28)); obs.append(o)
        o['ruien_collision'] = False   # it floats: no fixed solid at the water line (it blocked the giant and the wader)
    return obs, info, g, sec

def host_section(path, sec, u0, side, y_top):
    """Host surface for a wax curtain on the section wall: across = along the route, down = down the wall."""
    def host(a_m, d_m):
        y = y_top - d_m
        s = float(sec.wall_s_at_y(y))
        if y > sec.spring:
            so, yo = s / sec.hw ** 2, (y - sec.spring) / sec.rise ** 2
        else:
            so, yo = 1.0, 0.0
        l = np.hypot(so, yo); so, yo = so / l, yo / l
        u = u0 + a_m
        pt = path.world(np.array(u), np.array(side * s), np.array(y))
        px, pz, tx, tz, nx, nz = path.frame(np.array(u))
        n = -np.array([side * so * float(nx), yo, side * so * float(nz)])
        return pt, n / np.linalg.norm(n)
    return host

def cells(A):
    """Cell centres of a grid array (n, m) -> (n-1, m-1)."""
    return 0.25 * (A[1:, 1:] + A[:-1, :-1] + A[1:, :-1] + A[:-1, 1:])

def build_lower(g, sec, mats, coll, rng, branch=(), host=(), seams=()):
    """Walkway or ledges, channel walls, bed, silt banks, water, and bluestone coping on the walkway edge.
    branch / host: kit/meet.py tees where this stretch is the rui that ends, or the gallery that is cut."""
    obs = []
    path = g.path
    uu = np.arange(0.0, path.length + 1e-6, 0.2)
    if uu[-1] < path.length - 1e-6:
        uu = np.r_[uu, path.length]
    for t in host:
        if t.host_u_knots(path):
            uu = G.merge_knots(uu, t.host_u_knots(path), 0.2)
    lo, hi = sec.channel_edges()
    def attrs(P, wet=0.4, silt=0.4, slime=0.3):
        n = P.shape[0] * P.shape[1]
        A = np.zeros((n, 4), np.float32); B = np.zeros((n, 4), np.float32); B[:, 3] = 1
        Cc = np.zeros((n, 4), np.float32)
        Pf = P.reshape(-1, 3); y = Pf[:, 1]
        A[:, 2] = slime + 0.6 * U.smoothstep(sec.water + 0.4, sec.water - 0.1, y)
        A[:, 3] = silt * (0.6 + 0.8 * U.fbm3(Pf, g.seed + 7, 1.2))
        Cc[:, 2] = wet
        return {'wxA': np.clip(A, 0, 1).reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': Cc.reshape(*P.shape[:2], 4)}
    def keep_or_none(keep):
        return None if keep.all() else keep
    for side in sec.sides:
        edge = hi if side > 0 else lo
        ss = np.linspace(edge, side * (sec.hw + 0.06), 9)
        Uu, Ss = np.meshgrid(uu, ss, indexing='ij')
        P = path.world(Uu, Ss, np.full(Uu.shape, sec.ledge_y))
        keep = np.ones((len(uu) - 1, len(ss) - 1), bool)
        for t in branch:
            keep &= ~t.walk_hole(cells(Uu), cells(Ss))
        for t in host:
            keep &= ~t.host_walk_hole(path, cells(Uu), cells(Ss))
        ob = U.grid_mesh('%s_walk_%s' % (g.name, 'n' if side > 0 else 's'), P, np.stack([Uu, np.abs(Ss)], -1), attrs=attrs(P, 0.9), keep=keep_or_none(keep),
                         flip=G.orient_check(P, P[P.shape[0] // 2, 4] + np.array([0, 1.0, 0])), coll_=coll, mat=mats['brick_ledge'])
        if not keep.all():
            U.remove_loose(ob)
        U.add_adaptive(ob); obs.append(ob)
        # the channel face runs 6 cm up behind the coping, so the coping's rounded underside never shows a slit (#276)
        yy = np.linspace(sec.bed - 0.15, sec.ledge_y - 0.19, 18)
        Uu, Yy = np.meshgrid(uu, yy, indexing='ij')
        P = path.world(Uu, np.full(Uu.shape, edge), Yy)
        keep = np.ones((len(uu) - 1, len(yy) - 1), bool)
        for t in branch:
            keep &= ~t.walkface_hole(cells(Uu))
        for t in host:
            keep &= ~t.host_walkface_hole(path, cells(Uu), cells(Yy), side)
        ob = U.grid_mesh('%s_walkface_%s' % (g.name, 'n' if side > 0 else 's'), P, np.stack([Uu, Yy], -1), attrs=attrs(P, 0.5, 0.2, 0.5), keep=keep_or_none(keep),
                         flip=G.orient_check(P, path.world(np.array([uu[len(uu) // 2]]), np.array([0.0 if sec.cls == 'G' else (lo + hi) / 2]), np.array([sec.bed + 0.5]))[0]),
                         coll_=coll, mat=mats['brick_channel'])
        if not keep.all():
            U.remove_loose(ob)
        U.add_adaptive(ob); obs.append(ob)
        # coping blocks along the edge; a tee leaves a gap whose ends butt against its own stones
        gaps = sorted([t.coping_gap() for t in branch] + [gp for gp in (t.host_coping_gap(path, side) for t in host) if gp is not None])
        runs, u0 = [], 0.0
        for ga, gb in gaps:
            if ga > u0:
                runs.append((u0, ga))
            u0 = max(u0, gb)
        if u0 < path.length:
            runs.append((u0, path.length))
        k = 0
        for ra, rb in runs:
            u = ra
            while u < rb - 0.2 if not gaps else u < rb - 0.05:
                L = min(rng.uniform(0.7, 1.1), rb - u)
                if gaps and rb - (u + L) < 0.3:
                    L = rb - u
                V, F = U.chipped_block(L - 0.003, 0.25, 0.4, r=rng.uniform(0.006, 0.012), res=0.055, seed=g.seed * 1000 + k, chips=int(rng.integers(5, 11)),
                                       chip_size=(0.02, 0.07), wear_top=0.012, corners=int(rng.integers(0, 3)), wobble=0.0009)
                Pw = path.world(u + L / 2 + V[:, 0], edge + side * (0.2 - 0.04) + side * V[:, 2], sec.ledge_y - 0.125 + V[:, 1])
                if side > 0:
                    F = F[:, ::-1]
                obs.append(U.mesh_from_faces('%s_coping_%03d' % (g.name, k), Pw, F, uv=U.box_uv(V, F), coll_=coll, mat=mats['bluestone']))
                if u + L < rb - 0.05:
                    # silt and dirt packed in the joint, so no view opens under the walkway (#276)
                    uj = u + L - 0.0015
                    Cj = np.array([path.world(np.array(uj + (-0.006 if not (j & 1) else 0.006)), np.array(edge + side * (-0.03 if not (j & 4) else 0.34)),
                                              np.array(sec.ledge_y - 0.245 if not (j & 2) else sec.ledge_y - 0.012)) for j in range(8)])
                    obs.append(U.block_object('%s_copingjoint' % g.name, Cj, mats['silt'], coll, r=0.002, res=0.1, chips=0))
                u += L; k += 1
    # bed and silt
    ss = np.linspace(lo - 0.06, hi + 0.06, 13)
    Uu, Ss = np.meshgrid(uu, ss, indexing='ij')
    Pc = path.world(Uu, Ss, np.zeros_like(Uu))
    n1 = U.fbm3(Pc, g.seed + 31, 3.0)
    edge = np.abs(Ss - (lo + hi) / 2) / ((hi - lo) / 2)
    depth = sec.bed + 0.12 + 0.45 * edge ** 3 * (0.5 + n1)
    depth = np.minimum(depth, sec.water + 0.1)
    if sec.cls == 'M':
        # the giant's way: Antigoon (3.85 m) wades a rui upright on its -4.9 bed, 0.15 m under the crown, so the silt
        # stays a skim along the channel's middle and banks up only towards its edges (as the junction rooms' bed)
        mid = U.smoothstep(0.75, 1.35, np.abs(Ss - (lo + hi) / 2))
        depth = sec.bed + 0.005 + (depth - sec.bed - 0.005) * mid
    for us, kind in seams:
        # where the next route runs on, both builds meet the same bed: noise from world position, not the route
        shared = np.minimum(sec.bed + 0.12 + 0.45 * edge ** 3 * (0.5 + U.fbm3(Pc, 1873, 3.0)), sec.water + 0.1)
        if kind == 'room':
            # the room stub's silt (kit/junction_gen.py bed): thin along the channel, 6 cm more at its edges
            shared = sec.bed + 0.005 + 0.06 * U.smoothstep(0.9, 1.4, np.abs(Ss - (lo + hi) / 2))
        w = U.smoothstep(1.0, 0.0, np.abs(Uu - us))
        depth = depth * (1 - w) + shared * w
    keep = np.ones((len(uu) - 1, len(ss) - 1), bool)
    for t in branch:
        near = t.q_of_u(Uu) - t.q_chan(Ss)
        depth = np.minimum(depth, sec.bed - 0.03 + 0.3 * np.clip(near - 0.45, 0, 1))
        keep &= ~t.silt_hole(cells(Uu), cells(Ss))
    for t in host:
        keep &= ~t.host_silt_hole(path, cells(Uu), cells(Ss))
    P = path.world(Uu, Ss, depth)
    for t in host:
        P[..., 1] = t.host_silt(path, P)
    ob = U.grid_mesh('%s_silt' % g.name, P, np.stack([Uu, Ss], -1), keep=keep_or_none(keep), flip=G.orient_check(P, P[P.shape[0] // 2, 6] + np.array([0, 1.0, 0])), coll_=coll, mat=mats['silt'])
    if not keep.all():
        U.remove_loose(ob)
    U.add_adaptive(ob); obs.append(ob)
    # far wall below the shell foot on the channel side already reaches the bed (profile); water box
    w0, w1 = 0.0, path.length
    for t in branch:
        w0, w1 = t.water_from()
    for t in host:
        if hasattr(t, 'host_water'):
            w0, w1 = t.host_water(path)
    uw = np.linspace(w0, w1, max(2, int((w1 - w0) / 0.5)))
    cs = np.array([lo, hi, hi, lo]); cy = np.array([sec.water, sec.water, sec.bed - 0.3, sec.bed - 0.3])
    Uu = np.broadcast_to(uw[:, None], (len(uw), 4))
    P = path.world(Uu, np.broadcast_to(cs, Uu.shape), np.broadcast_to(cy, Uu.shape))
    F = U.grid_faces(len(uw), 4, closed_v=True)
    if np.cross(P[1, 0] - P[0, 0], P[0, 1] - P[0, 0])[1] < 0:
        F = F[:, ::-1]
    n = len(uw)
    obs.append(U.mesh_from_faces('%s_water' % g.name, P.reshape(-1, 3), [list(f) for f in F] + [[0, 1, 2, 3], [(n - 1) * 4 + k for k in (3, 2, 1, 0)]],
                                 coll_=coll, mat=mats['water'], smooth=False))
    return obs

def grate_knots(sec, u, s_c, h=0.33):
    """Shell u and profile v knots that make the vault hole exactly the shaft's square."""
    s_p, y_p, v_p, vt = sec.profile(0.002)
    v_of = lambda s: float(np.interp(s, s_p, v_p)) if s_p[-1] > s_p[0] else float(np.interp(-s, -s_p, v_p))
    vs = []
    for s in (s_c - h, s_c + h):
        side = s_p > 0 if s > 0 else s_p <= 0
        sp, vp = s_p[side & (y_p > sec.spring)], v_p[side & (y_p > sec.spring)]
        o = np.argsort(sp)
        vs.append(float(np.interp(s, sp[o], vp[o])))
    return [u - h, u + h], vs

def grate_shaft(path, sec, u, s_c, mats, coll, top=-0.28, h=0.33):
    """Parametric grate shaft: brick shaft walls from the vault to the street, cast-iron grate, step irons,
    and a wrought-iron ladder from the walkway (or ledge) up into the shaft."""
    obs = []
    def P(uu, yy, ss):
        return path.world(np.array(uu), np.array(ss), np.array(yy))
    s0, s1 = s_c - h, s_c + h
    ctr = P(u, -1.0, s_c)
    # One closed lining round the shaft (#276): the four faces share their corner vertices, so the relief bake
    # moves both sides of a corner together and no crack opens. The lining starts 3 cm under the vault face,
    # which is cut to the same square by exact u and v knots (grate_knots).
    def corner_path(t):
        t = t % (8 * h)
        su = np.select([t < 2 * h, t < 4 * h, t < 6 * h], [u - h + t, np.full_like(t, u + h), u + h - (t - 4 * h)], np.full_like(t, u - h))
        ss = np.select([t < 2 * h, t < 4 * h, t < 6 * h], [np.full_like(t, s1), s1 - (t - 2 * h), np.full_like(t, s0)], s0 + (t - 6 * h))
        return su, ss
    # one loop starting mid-face (the UV seam lies on a flat face), every corner a shared vertex
    t_ring = np.unique(np.r_[np.linspace(h, 9 * h, 49), 2 * h, 4 * h, 6 * h, 8 * h])
    uu_, ss_ = corner_path(t_ring)
    ybot = sec.vault_y_at_s(ss_) - 0.03
    q = np.linspace(0, 1, 16)
    Uu = np.broadcast_to(uu_[:, None], (len(t_ring), 16)); Ss = np.broadcast_to(ss_[:, None], (len(t_ring), 16))
    Y = ybot[:, None] + (top - ybot[:, None]) * q[None]
    Pp = path.world(Uu, Ss, Y)
    A = np.zeros((*Pp.shape[:2], 4), np.float32); B = np.zeros((*Pp.shape[:2], 4), np.float32); B[..., 3] = 1
    A[..., 2] = 0.55; A[..., 0] = 0.35
    arc = np.broadcast_to((t_ring - h)[:, None], Y.shape)
    obs.append(U.grid_mesh('shaft_lining', Pp, np.stack([arc, Y], -1), attrs={'wxA': A, 'wxB': B},
                           flip=G.orient_check(Pp, ctr), coll_=coll, mat=mats['brick_vault']))
    iron = mats['iron']
    for k, ss in enumerate(np.linspace(s0 + 0.04, s1 - 0.04, 9)):
        C = np.array([P(u - h if not (j & 1) else u + h, -0.09 if not (j & 2) else -0.005, ss - 0.012 if not (j & 4) else ss + 0.012) for j in range(8)])
        obs.append(U.block_object('grate_bar', C, iron, coll, r=0.003, res=0.05, chips=0))
    for (ua, ub, sa, sb) in ((u - h - 0.08, u + h + 0.08, s0 - 0.08, s0), (u - h - 0.08, u + h + 0.08, s1, s1 + 0.08), (u - h - 0.08, u - h, s0, s1), (u + h, u + h + 0.08, s0, s1)):
        C = np.array([P(ua if not (j & 1) else ub, top if not (j & 2) else -0.005, sa if not (j & 4) else sb) for j in range(8)])
        obs.append(U.block_object('grate_frame', C, iron, coll, r=0.004, res=0.05, chips=0))
    side = 1 if s_c > 0 else -1
    outer = s1 if side > 0 else s0
    y = -0.5; k = 0
    while y > float(sec.vault_y_at_s(outer)) + 0.1:
        off = 0.1 if k % 2 else -0.1
        obs.append(U.tube('step_iron', [P(u + off - 0.13, y, outer + side * 0.05), P(u + off - 0.13, y, outer - side * 0.11),
                                        P(u + off + 0.13, y, outer - side * 0.11), P(u + off + 0.13, y, outer + side * 0.05)], 0.014, n=8, coll_=coll, mat=iron))
        y -= 0.3; k += 1
    lad = outer - side * 0.14
    y_top = float(sec.vault_y_at_s(outer)) + 0.25
    for du in (-0.2, 0.2):
        obs.append(U.tube('ladder_stringer', [P(u + du, sec.ledge_y - 0.01, lad), P(u + du, y_top, lad), P(u + du, y_top + 0.12, lad + side * 0.12)], 0.016, n=8, coll_=coll, mat=iron, flat=0.4))
    for yy in np.arange(sec.ledge_y + 0.28, y_top - 0.05, 0.28):
        obs.append(U.tube('ladder_rung', [P(u - 0.2, yy, lad), P(u + 0.2, yy, lad)], 0.013, n=8, coll_=coll, mat=iron))
    return obs

def place_lamp(path, sec, u, mats, coll, rng, name='kit_lamp'):
    wy = -2.3
    side = sec.sides[0]
    ws = float(sec.wall_s_at_y(wy))
    wall_pt = path.world(np.array(u), np.array(side * ws), np.array(wy))
    inner = path.world(np.array(u), np.array(side * (ws - 1.0)), np.array(wy))
    parts, hook = PR.lamp_bracket('lamp_bracket', wall_pt, inner - wall_pt, 0.3, mats['iron'], coll)
    lo, ll = PR.safety_lamp(name, mats, coll, light_power=150.0)
    lo.location = U.gv(*hook)
    return parts + [lo]

def world_ext(path, u, s, y):
    """path.world, but continued straight past both ends (path.world clamps there)."""
    u = np.asarray(u, float)
    uc = np.clip(u, 0.0, path.length)
    px, pz, tx, tz, nx, nz = path.frame(uc)
    d = u - uc
    return np.stack(np.broadcast_arrays(px + d * tx + s * nx, y, pz + d * tz + s * nz), -1)

STUB_BACK = 0.05   # a 'stub' end's bricked-up wall stands this far inside the swept end

def stub_end(path, sec, route_id):
    """A 'stub' end: the game's RuienEnd (areas.json channelEnds) bricks the section up just inside the swept end,
    with a barred culvert over the channel's middle carrying the water on, where the next area joins later."""
    u = path.length - STUB_BACK
    lo, hi = sec.channel_edges()
    c = (lo + hi) / 2
    at = path.world(np.array(u), np.array(c), np.array(0.0))
    px, pz, tx, tz, nx, nz = path.frame(np.array(u))
    half = max(abs(-sec.hw - c), abs(sec.hw - c)) + 0.5     # reaches behind both walls of the shell
    return dict(id='%s_stub' % route_id, at=[round(float(at[0]), 3), 0.0, round(float(at[2]), 3)], axis=[round(float(tx), 5), 0.0, round(float(tz), 5)],
                half=round(half, 3), bottom=round(sec.bed - 0.3, 3), top=round(sec.crown + 0.15, 3), culvert=1.0, spring=round(sec.water + 0.1, 3), water=True)

def end_piece(path, sec, u, kind, which, mats, coll):
    """'cap': dead-end brick wall; 'open': a dark void card (the route continues, built separately);
    'junction': a header-brick arch ring where the route opens into a room (no host gallery found);
    'through': nothing (the next route continues the same section); 'tee': built by kit/meet.py;
    'room': nothing (a junction room's mouth stub continues it); 'stub': nothing here, the game's RuienEnd bricks it
    up (stub_end)."""
    if kind in ('through', 'tee', 'reducer', 'room', 'stub'):
        return []
    obs = []
    s_p, y_p, v_p, vt = sec.profile(0.2)
    # The shell profile is open between its unequal feet. An end fan needs a
    # closed perimeter down to the bed, or it leaves a triangular view outside.
    s_p = np.r_[s_p, sec.hw, -sec.hw]
    y_p = np.r_[y_p, sec.bed - 0.3, sec.bed - 0.3]
    if kind == 'cap':
        n = len(s_p)
        rings = np.linspace(1, 0, 6)
        Pp = np.zeros((n, len(rings), 3))
        cy = (sec.bed + sec.crown) / 2
        for j, r in enumerate(rings):
            Pp[:, j] = path.world(np.full(n, u), s_p * r, cy + (y_p - cy) * r)
        A = np.zeros((*Pp.shape[:2], 4), np.float32); B = np.zeros((*Pp.shape[:2], 4), np.float32); B[..., 3] = 1
        A[..., 2] = 0.4
        inside = path.world(np.array(u + (-0.5 if which == 'end' else 0.5)), np.array(0.0), np.array(cy))
        o = U.grid_mesh('%s_cap' % which, Pp, np.stack([np.broadcast_to(s_p[:, None], Pp.shape[:2]), Pp[..., 1]], -1), attrs={'wxA': A, 'wxB': B},
                        flip=G.orient_check(Pp, inside), closed_u=True, coll_=coll, mat=mats['brick_channel'])
        U.add_adaptive(o); obs.append(o)
    elif kind in ('open', 'junction'):
        # The dark card stands 2 cm past the shell's end and reaches 15 cm beyond its whole outline, so no
        # grazing view past the crown, the walls or the bed finds an edge to look round (#276).
        n = len(s_p)
        cy = (sec.bed + sec.crown) / 2
        off = 0.02 if which == 'end' else -0.02
        rad = np.hypot(s_p, y_p - cy)
        k = (rad + 0.15) / np.maximum(rad, 1e-6)
        P0 = world_ext(path, np.full(n, u + off), s_p * k, cy + (y_p - cy) * k)
        P1 = world_ext(path, np.full(n, u + off), s_p * 0.0, np.full(n, cy))
        Pp = np.stack([P0, P1], 1)
        inside = world_ext(path, np.array([u - off * 25]), np.array([0.0]), np.array([cy]))[0]
        obs.append(U.grid_mesh('%s_void' % which, Pp, np.zeros((n, 2, 2)), closed_u=True, flip=G.orient_check(Pp, inside), coll_=coll, mat=mats['soot_black'], smooth=False))
        if kind == 'junction':
            th = np.linspace(np.pi, 0, 2000)
            es, ey = (sec.hw + 0.05) * np.cos(th), sec.spring + (sec.rise + 0.05) * np.sin(th)
            seg = np.r_[0, np.cumsum(np.hypot(np.diff(es), np.diff(ey)))]
            nb = int(seg[-1] / 0.062)
            ring = PR.brick_variants(mats['brick_loose'], coll, n=6, seed=77)
            for k in range(nb):
                q = (k + 0.5) * seg[-1] / nb
                s_ = np.interp(q, seg, es); y_ = np.interp(q, seg, ey)
                pos = path.world(np.array(u), np.array(s_), np.array(y_))
                o = bpy.data.objects.new('junction_ringbrick', ring[k % len(ring)])
                coll.objects.link(o)
                o.location = U.gv(*pos)
                ang = np.arctan2(y_ - sec.spring, s_)
                px, pz, tx, tz, nx, nz = path.frame(np.array(u))
                o.rotation_euler = (0, 0, float(np.arctan2(-tz, tx)))
                obs.append(o)
    return obs
