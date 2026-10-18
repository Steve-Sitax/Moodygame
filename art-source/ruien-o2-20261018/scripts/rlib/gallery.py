# Giant gallery: a swept section along a path, with ledges, channel, coping, silt and water.
import numpy as np
import bpy
import spec
from . import util as U

W2 = spec.GAL_W / 2

class Path:
    def __init__(self, keys, bend_a=3.2, step=0.01):
        K = np.array(keys, np.float64)
        pts = [np.linspace(K[0], K[1], 200)]
        if len(K) >= 4:
            t0 = (K[1] - K[0]) / np.linalg.norm(K[1] - K[0])
            t1 = (K[3] - K[2]) / np.linalg.norm(K[3] - K[2])
            b0, b3 = K[1], K[2]
            b1, b2 = b0 + t0 * bend_a, b3 - t1 * bend_a
            t = np.linspace(0, 1, 800)[:, None]
            bz = (1 - t) ** 3 * b0 + 3 * (1 - t) ** 2 * t * b1 + 3 * (1 - t) * t * t * b2 + t ** 3 * b3
            pts.append(bz[1:])
            pts.append(np.linspace(K[2], K[3], 800)[1:])
        else:
            for a, b in zip(K[1:-1], K[2:]):
                pts.append(np.linspace(a, b, 400)[1:])
        D = np.concatenate(pts)
        seg = np.linalg.norm(np.diff(D, axis=0), axis=1)
        L = np.r_[0, np.cumsum(seg)]
        self.length = L[-1]
        n = int(self.length / step) + 1
        self.u = np.linspace(0, self.length, n)
        self.P = np.stack([np.interp(self.u, L, D[:, 0]), np.interp(self.u, L, D[:, 1])], -1)
        T = np.gradient(self.P, axis=0)
        self.T = T / np.linalg.norm(T, axis=1, keepdims=True)
        self.N = np.stack([self.T[:, 1], -self.T[:, 0]], -1)
        # curvature radius check
        ang = np.unwrap(np.arctan2(self.T[:, 1], self.T[:, 0]))
        k = np.abs(np.gradient(ang, self.u))
        self.min_radius = 1 / max(k.max(), 1e-9)

    def frame(self, u):
        u = np.asarray(u, np.float64)
        px = np.interp(u, self.u, self.P[:, 0]); pz = np.interp(u, self.u, self.P[:, 1])
        tx = np.interp(u, self.u, self.T[:, 0]); tz = np.interp(u, self.u, self.T[:, 1])
        l = np.sqrt(tx * tx + tz * tz)
        tx, tz = tx / l, tz / l
        return px, pz, tx, tz, tz, -tx

    def world(self, u, s, y):
        px, pz, tx, tz, nx, nz = self.frame(u)
        return np.stack(np.broadcast_arrays(px + s * nx, y, pz + s * nz), -1)

    def u_at_z(self, z):
        return float(np.interp(z, self.P[:, 1], self.u))

def ellipse_sy(theta, a=W2, b=spec.GAL_RISE, spring=spec.GAL_SPRING_Y):
    return a * np.cos(theta), spring + b * np.sin(theta)

def shell_profile(dv=0.06, foot=spec.LEDGE_Y - 0.06):
    """(s, y, v, side) from the south ledge foot over the vault to the north ledge foot."""
    sp = spec.GAL_SPRING_Y
    th = np.linspace(np.pi, 0, 4000)
    es, ey = ellipse_sy(th)
    pts = np.concatenate([np.stack([np.full(50, -W2), np.linspace(foot, sp, 50)], -1)[:-1],
                          np.stack([es, ey], -1),
                          np.stack([np.full(50, W2), np.linspace(sp, foot, 50)], -1)[1:]])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    L = np.r_[0, np.cumsum(seg)]
    n = int(L[-1] / dv) + 1
    v = np.linspace(0, L[-1], n)
    s = np.interp(v, L, pts[:, 0]); y = np.interp(v, L, pts[:, 1])
    return s, y, v, L[-1]

def shell_s_at_y(y):
    """Half-width of the gallery at height y (inside face)."""
    y = np.asarray(y, np.float64)
    t = np.clip((y - spec.GAL_SPRING_Y) / spec.GAL_RISE, 0, 1)
    return np.where(y <= spec.GAL_SPRING_Y, W2, W2 * np.sqrt(np.clip(1 - t * t, 0, 1)))

def shell_y_at_s(s):
    s = np.abs(np.asarray(s, np.float64))
    t = np.clip(s / W2, 0, 1)
    return spec.GAL_SPRING_Y + spec.GAL_RISE * np.sqrt(np.clip(1 - t * t, 0, 1))

def egg_hw(t, h=1.6, w=1.0):
    """Half width of an egg-shaped drain (narrow end down) at height t above its invert."""
    r = w / 2
    t = np.asarray(t, np.float64)
    top_c = h - r
    up = np.sqrt(np.clip(r * r - (t - top_c) ** 2, 0, None))
    low = r * np.sqrt(np.clip(1 - ((top_c - t) / top_c) ** 2, 0, None)) ** 0.85
    return np.where(t >= top_c, up, low) * ((t >= 0) & (t <= h))

def orient_check(P, want_point, flip_default=False):
    """Decide the face flip for a grid so normals face want_point (game coords)."""
    n, m = P.shape[:2]
    i, j = min(n // 2, n - 2), min(m // 2, m - 2)
    a = P[i + 1, j] - P[i, j]
    b = P[i, j + 1] - P[i, j]
    nn = np.cross(a, b)
    return np.dot(nn, np.asarray(want_point) - P[i, j]) < 0

def weather_common(n):
    A = np.zeros((n, 4), np.float32)
    B = np.zeros((n, 4), np.float32)
    B[:, 3] = 1.0
    return A, B

def lime_from_seeps(u, v, vc, seeps, Lup=0.15, Ldown=1.1, wu=0.22):
    """Seeps (u, v, strength) spread lime downward along v away from the crown vc."""
    out = np.zeros_like(u)
    for (su, sv, st) in seeps:
        du = u - su
        side_s = np.sign(sv - vc)
        dv = (v - sv) * (side_s if side_s != 0 else 1)   # positive = further from the crown = downstream
        along = np.where(dv >= 0, np.exp(-dv / Ldown), np.exp(dv / Lup))
        wid = wu * (1 + np.clip(dv, 0, None) * 0.4)
        out += st * along * np.exp(-0.5 * (du / wid) ** 2)
    return np.clip(out, 0, 1)

class Gallery:
    """Builds one gallery. Features (holes, drains) are passed in as lists."""
    def __init__(self, name, keys, mats, coll_, u0=0.0, u1=None, du=0.2, dv=0.09, seed=0, bend_a=3.2, profile=None, hw=W2):
        self.name = name
        self.profile = profile or shell_profile
        self.hw = hw
        self.path = Path(keys, bend_a)
        self.mats = mats
        self.coll = coll_
        self.u0 = u0
        self.u1 = self.path.length if u1 is None else u1
        self.du, self.dv = du, dv
        self.rng = np.random.default_rng(seed)
        self.seed = seed
        self.holes = []      # functions (u, s, y) -> bool mask of removed cells
        self.drains = []
        self.seeps = []
        self.lamps = []      # game positions
        self.wetsrc = []     # (u, side, y, width)
        self.rustsrc = []
        self.sand = []       # (ua, ub, side, ytop)
        self.repairs = []    # (ua, ub, va, vb)
        self.damage = []     # shell: (u, v, radius, amount)
        self.cdamage = []    # channel walls: (u, side, y, radius, amount)
        self.objects = []

    # -------------------------------------------------------------- shell
    def build_shell(self, shell_u0=None):
        s_p, y_p, v_p, vtot = self.profile(self.dv)
        self.vtot = vtot
        vc = vtot / 2
        ua = self.u0 if shell_u0 is None else shell_u0
        uu = np.arange(ua, self.u1 + 1e-6, self.du)
        if uu[-1] < self.u1 - 1e-6:
            uu = np.r_[uu, self.u1]
        Uu, Vv = np.meshgrid(uu, v_p, indexing='ij')
        S = np.broadcast_to(s_p, Uu.shape)
        Y = np.broadcast_to(y_p, Uu.shape)
        P = self.path.world(Uu, S, Y)
        UV = np.stack([Uu, Vv], -1)
        # cells to keep
        cu = 0.5 * (Uu[1:, 1:] + Uu[:-1, :-1]); cs = 0.5 * (S[1:, 1:] + S[:-1, :-1]); cy = 0.5 * (Y[1:, 1:] + Y[:-1, :-1])
        keep = np.ones(cu.shape, bool)
        for h in self.holes:
            keep &= ~h(cu, cs, cy)
        n = Uu.size
        A, B = weather_common(n)
        u_f, v_f, s_f, y_f = Uu.ravel(), Vv.ravel(), S.ravel(), Y.ravel()
        Pf = P.reshape(-1, 3)
        # lime: seeps on the vault
        A[:, 0] = lime_from_seeps(u_f, v_f, vc, self.seeps, Ldown=1.9, wu=0.16)
        runoff = lime_from_seeps(u_f, v_f, vc, self.seeps, Ldown=5.5, wu=0.16)
        # soot: old smoke under the crown, plus the lamps
        A[:, 1] = 0.18 * U.smoothstep(-2.7, -0.9, y_f) + 0.12 * U.fbm3(Pf, self.seed + 3, 4.0)
        for lp in self.lamps:
            d2 = (Pf[:, 0] - lp[0]) ** 2 + (Pf[:, 2] - lp[2]) ** 2
            A[:, 1] += 0.85 * np.exp(-d2 / (2 * 0.55 ** 2)) * U.smoothstep(lp[1] - 0.1, lp[1] + 0.5, y_f)
        # slime and damp low on the walls, and below drains and pipes
        A[:, 2] = 0.55 * U.smoothstep(-2.9, -3.62, y_f) + 0.25 * U.smoothstep(0.55, 0.75, U.fbm3(Pf, self.seed + 5, 2.0))
        for (wu, side, wy, ww) in self.wetsrc:
            on = (np.sign(s_f) == side) & (y_f < wy)
            A[:, 2] += on * 0.9 * np.exp(-0.5 * ((u_f - wu) / ww) ** 2)
            A[:, 0] += on * 0.35 * np.exp(-0.5 * ((u_f - wu) / (ww * 1.6)) ** 2) * U.smoothstep(wy - 1.2, wy, y_f)
        for (ru, side, ry, rw) in self.rustsrc:
            on = (np.sign(s_f) == side) & (y_f < ry)
            A[:, 1] += on * 0.5 * np.exp(-0.5 * ((u_f - ru) / rw) ** 2) * np.exp(-(ry - y_f) / 0.6)
        # silt splashed at the wall foot by floods
        A[:, 3] = 0.6 * U.smoothstep(-3.25, -3.62, y_f)
        # sandstone stretches (older house foundations) and a repair patch
        for (sa, sb, side, ytop) in self.sand:
            on = (np.sign(s_f) == side)
            B[:, 0] += on * U.smoothstep(sa - 0.3, sa + 0.3, u_f) * (1 - U.smoothstep(sb - 0.3, sb + 0.3, u_f)) * (1 - U.smoothstep(ytop - 0.25, ytop + 0.25, y_f))
        for (ra, rb, va, vb) in self.repairs:
            B[:, 1] += U.smoothstep(ra - 0.1, ra + 0.1, u_f) * (1 - U.smoothstep(rb - 0.1, rb + 0.1, u_f)) * U.smoothstep(va - 0.1, va + 0.1, v_f) * (1 - U.smoothstep(vb - 0.1, vb + 0.1, v_f))
        B[:, 2] = (v_f > vc).astype(np.float32)   # north half: down is +v
        A = np.clip(A, 0, 1); B = np.clip(B, 0, 1)
        Cd = np.zeros((n, 4), np.float32)
        Cd[:, 3] = runoff
        for (wu, side, wy, ww) in self.wetsrc:
            on = (np.sign(s_f) == side) & (y_f < wy)
            Cd[:, 3] += on * np.exp(-0.5 * ((u_f - wu) / (ww * 0.8)) ** 2)
        Cd[:, 1] = 0.85 * U.smoothstep(-3.66, -3.45, y_f) * (1 - U.smoothstep(-2.9, -2.5, y_f)) * U.smoothstep(0.4, 0.6, U.fbm3(Pf, self.seed + 41, 0.7))
        for (du_, dv_, dr, da) in self.damage:
            Cd[:, 0] += da * np.exp(-0.5 * (((u_f - du_) / dr) ** 2 + ((v_f - dv_) / (dr * 0.7)) ** 2))
        Cd = np.clip(Cd, 0, 1)
        flip = orient_check(P, self.path.world(np.array([uu[len(uu) // 2]]), np.array([0.0]), np.array([-3.0]))[0])
        ob = U.grid_mesh(self.name + '_vault', P, UV, attrs={'wxA': A.reshape(P.shape[0], P.shape[1], 4), 'wxB': B.reshape(P.shape[0], P.shape[1], 4), 'wxC': Cd.reshape(P.shape[0], P.shape[1], 4)},
                         keep=keep, flip=flip, coll_=self.coll, mat=self.mats['brick_vault'])
        U.remove_loose(ob)
        U.add_adaptive(ob)
        self.objects.append(ob)
        return ob

    # -------------------------------------------------------------- ledges, channel walls, bed
    def build_lower(self, coping_start=0.0, bed_profile=None, ledge_u0=None, channel_u0=None):
        uu = np.arange(self.u0 if ledge_u0 is None else ledge_u0, self.u1 + 1e-6, self.du)
        if uu[-1] < self.u1 - 1e-6:
            uu = np.r_[uu, self.u1]
        for side in (-1, 1):
            # ledge top (behind the coping), brick paving
            ss = side * np.linspace(1.9, self.hw + 0.06, 9)
            Uu, Ss = np.meshgrid(uu, ss, indexing='ij')
            Y = np.full(Uu.shape, spec.LEDGE_Y)
            P = self.path.world(Uu, Ss, Y)
            UV = np.stack([Uu, np.abs(Ss)], -1)
            A, B = weather_common(Uu.size)
            Pf = P.reshape(-1, 3)
            sf = np.abs(Ss.ravel())
            A[:, 2] = 0.35 + 0.3 * U.fbm3(Pf, self.seed + 11, 1.5)
            A[:, 3] = 0.35 + 0.65 * U.smoothstep(2.3, 1.9, sf) + 0.4 * U.smoothstep(2.7, 3.0, sf)
            A[:, 3] *= 0.6 + 0.8 * U.fbm3(Pf, self.seed + 12, 1.2)
            B[:, 2] = 0
            A = np.clip(A, 0, 1)
            Cl_ = np.zeros((Uu.size, 4), np.float32)
            Cl_[:, 2] = 0.95
            for (wu, wside, wy, ww) in self.wetsrc:
                if wside == side:
                    Cl_[:, 3] += np.exp(-0.5 * ((Uu.ravel() - wu) / (ww * 1.2)) ** 2)
            Cl_ = np.clip(Cl_, 0, 1)
            flip = orient_check(P, P[P.shape[0] // 2, 0] + np.array([0, 1.0, 0]))
            ob = U.grid_mesh('%s_ledge_%s' % (self.name, 'n' if side > 0 else 's'), P, UV,
                             attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': Cl_.reshape(*P.shape[:2], 4)},
                             flip=flip, coll_=self.coll, mat=self.mats['brick_ledge'])
            U.add_adaptive(ob)
            self.objects.append(ob)
            # channel wall (ledge front) below the coping
            uc = uu if channel_u0 is None else uu[uu >= channel_u0 - 1e-6]
            yy = np.linspace(spec.FLOOR_Y - 0.15, spec.LEDGE_Y - 0.25, 24)
            Uu, Yy = np.meshgrid(uc, yy, indexing='ij')
            Ss = np.full(Uu.shape, side * spec.GAL_CHANNEL_W / 2)
            P = self.path.world(Uu, Ss, Yy)
            UV = np.stack([Uu, Yy], -1)
            A, B = weather_common(Uu.size)
            Pf = P.reshape(-1, 3)
            yf = Yy.ravel()
            A[:, 2] = 0.3 + 0.7 * U.smoothstep(-4.18, -4.36, yf + 0.06 * (U.fbm3(Pf, self.seed + 23, 0.4) - 0.5)) + 0.25 * U.smoothstep(0.5, 0.7, U.fbm3(Pf, self.seed + 21, 1.0))
            A[:, 3] = 0.5 * U.smoothstep(-4.45, -4.62, yf) * U.smoothstep(-4.75, -4.62, yf)
            A[:, 0] = 0.25 * U.smoothstep(0.55, 0.75, U.fbm3(Pf, self.seed + 22, 0.8)) * U.smoothstep(-4.4, -4.0, yf)
            B[:, 2] = 0
            A = np.clip(A, 0, 1)
            Cd = np.zeros((Uu.size, 4), np.float32)
            uf = Uu.ravel()
            for (du_, dside, dy, dr, da) in self.cdamage:
                if dside == side:
                    Cd[:, 0] += da * np.exp(-0.5 * (((uf - du_) / dr) ** 2 + ((yf - dy) / (dr * 0.6)) ** 2))
            Cd = np.clip(Cd, 0, 1)
            flip = orient_check(P, self.path.world(np.array([uc[len(uc) // 2]]), np.array([0.0]), np.array([-5.0]))[0])
            ob = U.grid_mesh('%s_channelwall_%s' % (self.name, 'n' if side > 0 else 's'), P, UV,
                             attrs={'wxA': A.reshape(*P.shape[:2], 4), 'wxB': B.reshape(*P.shape[:2], 4), 'wxC': Cd.reshape(*P.shape[:2], 4)},
                             flip=flip, coll_=self.coll, mat=self.mats['brick_channel'])
            U.add_adaptive(ob)
            self.objects.append(ob)
        # channel bed (brick invert) and silt banks
        ss = np.linspace(-1.56, 1.56, 13)
        Uu, Ss = np.meshgrid(uu, ss, indexing='ij')
        base = np.full(Uu.shape, spec.FLOOR_Y)
        if bed_profile is not None:
            base = bed_profile(Uu)
        P = self.path.world(Uu, Ss, base)
        ob = U.grid_mesh(self.name + '_bed', P, np.stack([Uu, Ss], -1), flip=orient_check(P, P[P.shape[0] // 2, P.shape[1] // 2] + np.array([0, 1.0, 0])),
                         attrs={'wxA': np.tile([0, 0, 1, 0.6], (*P.shape[:2], 1)), 'wxB': np.tile([0, 0, 0, 1], (*P.shape[:2], 1))},
                         coll_=self.coll, mat=self.mats['brick_channel'])
        self.objects.append(ob)
        # silt banks: deeper deposits along the channel walls, inner bends higher
        ss = np.linspace(-1.52, 1.52, 25)
        Uu, Ss = np.meshgrid(uu, ss, indexing='ij')
        Pc = self.path.world(Uu, Ss, np.zeros_like(Uu))
        n1 = U.fbm3(Pc, self.seed + 31, 3.0)
        n2 = U.fbm3(Pc, self.seed + 32, 0.9)
        edge = np.abs(Ss) / 1.52
        depth = (spec.FLOOR_Y + 0.25) + 0.85 * edge ** 3 * (0.5 + n1) + 0.25 * (n2 - 0.5)
        banks = np.clip(U.fbm3(Pc, self.seed + 33, 2.2) - 0.52, 0, None) * 6.0 * edge ** 2
        depth = depth + banks
        # inner side of the bend collects more
        px, pz, tx, tz, nx, nz = self.path.frame(Uu)
        curv = np.gradient(np.unwrap(np.arctan2(tz, tx), axis=0), axis=0) / self.du
        depth += np.clip(-np.sign(curv) * Ss * np.abs(curv) * 3.5, -0.3, 0.6)
        if bed_profile is not None:
            depth = np.maximum(depth, bed_profile(Uu) + 0.05)
        depth = np.minimum(depth, spec.WATER_Y + 0.16)
        P = self.path.world(Uu, Ss, depth)
        ob = U.grid_mesh(self.name + '_silt', P, np.stack([Uu, Ss], -1), flip=orient_check(P, P[P.shape[0] // 2, P.shape[1] // 2] + np.array([0, 1.0, 0])),
                         coll_=self.coll, mat=self.mats['silt'])
        U.add_adaptive(ob)
        self.objects.append(ob)
        # water
        # closed water volume (murky absorption needs a closed mesh); sides and bottom hide in the walls and bed
        uw = np.linspace(self.u0 - 0.3, self.u1, max(2, int((self.u1 - self.u0) / 0.5)))
        cs = np.array([-1.62, 1.62, 1.62, -1.62])
        cy = np.array([spec.WATER_Y, spec.WATER_Y, spec.FLOOR_Y - 0.3, spec.FLOOR_Y - 0.3])
        Uu = np.broadcast_to(uw[:, None], (len(uw), 4))
        P = self.path.world(Uu, np.broadcast_to(cs, Uu.shape), np.broadcast_to(cy, Uu.shape))
        F = U.grid_faces(len(uw), 4, closed_v=True)
        nrm = np.cross(P[1, 0] - P[0, 0], P[0, 1] - P[0, 0])
        if nrm[1] < 0:
            F = F[:, ::-1]
        V = P.reshape(-1, 3)
        n = len(uw)
        caps = [[0, 1, 2, 3], [(n - 1) * 4 + k for k in (3, 2, 1, 0)]]
        ob = U.mesh_from_faces(self.name + '_water', V, [list(f) for f in F] + caps, coll_=self.coll, mat=self.mats['water'], smooth=False)
        self.objects.append(ob)

    # -------------------------------------------------------------- coping blocks along the channel edges
    def build_coping(self, u_start=0.0, u_end=None, variants=None):
        u_end = self.u1 if u_end is None else u_end
        rng = self.rng
        obs = []
        for side in (-1, 1):
            u = u_start
            k = 0
            while u < u_end - 0.2:
                L = min(rng.uniform(0.75, 1.2), u_end - u)
                if u_end - (u + L) < 0.3:
                    L = u_end - u
                V, F = U.chipped_block(L - 0.003, 0.3, 0.5, r=rng.uniform(0.006, 0.012), res=0.055, seed=self.seed * 1000 + k * 2 + (side > 0),
                                       chips=rng.integers(6, 13), chip_size=(0.02, 0.08), wear_top=0.013, corners=int(rng.integers(0, 3)), wobble=0.0009)
                # local x along path, y up, z across (toward the wall)
                uu = u + L / 2 + V[:, 0]
                ss = side * (spec.GAL_CHANNEL_W / 2 - 0.04 + 0.25 + V[:, 2])
                yy = spec.LEDGE_Y - 0.15 + V[:, 1]
                Pw = self.path.world(uu, ss, yy)
                if side > 0:
                    F = F[:, ::-1]
                uvl = U.box_uv(V, F)
                ob = U.mesh_from_faces('%s_coping_%s_%03d' % (self.name, 'n' if side > 0 else 's', k), Pw, F, uv=uvl, coll_=self.coll, mat=self.mats['bluestone'])
                obs.append(ob)
                # silt and dirt packed in the joint behind the arrises
                ug = u + L - 0.004
                if u + L < u_end - 0.1:
                    Cj = np.array([self.path.world(np.array(ug + (-0.006 if not (j & 1) else 0.006)), np.array(side * (1.475 if not (j & 4) else 1.95)), np.array(spec.LEDGE_Y - 0.29 if not (j & 2) else spec.LEDGE_Y - 0.012)) for j in range(8)])
                    obs.append(U.block_object('%s_copingjoint' % self.name, Cj, self.mats['silt'], self.coll, r=0.002, res=0.1, chips=0))
                u += L
                k += 1
        self.objects += obs
        return obs
