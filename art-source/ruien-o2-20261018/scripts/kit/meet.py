# Ruien kit: where a rui (class M) ends in the side of a giant gallery (class G), a "tee".
# Both stretches are built separately and each builds a Tee from the same route data, so the cut in the
# host and the pieces of the branch meet exactly. The host cuts its shell, ledge paving, coping and channel
# wall; the branch trims its own shell and lower parts and builds the meeting pieces: the arch rim (kit/arch_rim.py:
# a proud brick band with rounded arrises and a one-brick reveal), the cross-ledge culvert with its dressed bluestone edges, the two walkway steps up to
# the gallery ledge, the bluestone sill and the giant's step down to the gallery bed, and the overflow film.
# Frame: q along the branch from the node (the host centre line) into the branch, l = the branch path's
# lateral s (so the walkway side keeps its sign), y up. The branch must be straight for q_wall + 1.5 m.
import zlib
import numpy as np
from rlib import util as U
from . import arch_rim as AR

class Tee:
    P = 0.05      # the clear opening (the rim's reveal) stands this far inside the barrel
    STEP = AR.STEP          # the rim (kit/arch_rim.py): reveal step, face width, reveal depth, proud, arris
    WIDTH = AR.WIDTH
    DEPTH = AR.DEPTH
    T = STEP + WIDTH        # the rim's whole thickness out from the clear opening (the host cuts follow it)
    T_TOP = T     # full width over the crown too: the rim is measured on the host face (arch_rim.surface_normals), so it
                  # no longer fans out where the host vault is nearly level (the old ring thinned to 0.10 there)
    D = AR.BACK   # rim depth along the branch
    PF = AR.PROUD # rim face stands this far proud of the host face
    ARRIS = AR.ARRIS
    RING_LOW_WALK = -3.75   # ring legs stand on the walkway step and on the far return coping
    RING_LOW_FAR = -3.59
    SILL_TOP_OFF = 0.0      # sill top = branch bed
    GIANT_STEP = -5.5       # intermediate step on the host bed for Antigoon

    def __init__(self, node, t_h, hsec, bpath, bsec, which, branch_id='', host_ids=()):
        self.branch_id, self.host_ids = branch_id, list(host_ids)
        self.O = np.asarray(node, float)
        self.hsec, self.bsec, self.which = hsec, bsec, which
        self.bpath = bpath
        self.L = bpath.length
        ub = 0.0 if which == 'start' else bpath.length
        px, pz, tx, tz, nx, nz = bpath.frame(np.array(ub))
        Tb = np.array([float(tx), float(tz)])
        self.Nb = np.array([float(nx), float(nz)])
        self.tb = Tb if which == 'start' else -Tb
        th = np.asarray(t_h, float)
        self.th = th / np.linalg.norm(th)
        self.nh = np.array([self.th[1], -self.th[0]])
        self.c = float(np.dot(self.tb, self.nh))
        self.sigma = 1 if self.c > 0 else -1
        assert abs(self.c) > 0.9, 'tee: the branch meets the host more than 25 degrees off square (%.1f)' % np.degrees(np.arccos(abs(self.c)))
        self.k = float(np.dot(self.Nb, self.nh))
        self.ws = bsec.sides[0]
        lo, hi = bsec.channel_edges()
        self.l_we = hi if self.ws > 0 else lo          # walkway edge (channel face of the walkway)
        self.l_far = -self.ws * bsec.hw                # far wall, water against it
        self.l_ww = self.ws * bsec.hw                  # walkway-side wall
        hlo, hhi = hsec.channel_edges()
        self.ch = (hhi - hlo) / 2                      # host channel half width (both ledges)
        self.cl = sorted((self.l_we, self.l_far))      # culvert lateral range
        self.q_ring = self.q_wall(0.0) + 1.5
        assert self.straight_ok(), 'tee: the branch bends within %.1f m of the node' % self.q_ring

    # -------------------------------------------------------------- frames
    def straight_ok(self):
        qq = np.linspace(0, self.q_ring, 20)
        P = self.bpath.world(self.u_of_q(qq), np.zeros_like(qq), np.zeros_like(qq))[:, [0, 2]]
        Q = self.O[None] + qq[:, None] * self.tb[None]
        return float(np.max(np.linalg.norm(P - Q, axis=1))) < 0.01

    def u_of_q(self, q):
        return q if self.which == 'start' else self.L - np.asarray(q, float)

    def q_of_u(self, u):
        return u if self.which == 'start' else self.L - np.asarray(u, float)

    def world(self, q, l, y):
        q, l, y = np.broadcast_arrays(np.asarray(q, float), np.asarray(l, float), np.asarray(y, float))
        x = self.O[0] + q * self.tb[0] + l * self.Nb[0]
        z = self.O[1] + q * self.tb[1] + l * self.Nb[1]
        return np.stack([x, y, z], -1)

    def local(self, P):
        """World points (..., 3) -> (q, l, y) in the tee frame."""
        d = P[..., [0, 2]] - self.O
        return d @ self.tb, d @ self.Nb, P[..., 1]

    def host_s(self, P):
        return (P[..., [0, 2]] - self.O) @ self.nh

    def q_at(self, l, s):
        """q at lateral l where the host lateral coordinate sigma * s_h equals s."""
        return (self.sigma * np.asarray(s, float) - np.asarray(l, float) * self.k) / self.c

    def q_host(self, l, y):
        return self.q_at(l, self.hsec.wall_s_at_y(y))

    def q_wall(self, l):
        return self.q_at(l, self.hsec.hw)

    def q_chan(self, l):
        return self.q_at(l, self.ch)

    def T_at(self, ny):
        return self.T - (self.T - self.T_TOP) * U.smoothstep(0.75, 0.98, np.asarray(ny, float))

    def ny_at(self, l, y):
        b = self.bsec
        d = np.asarray(y, float) - b.spring
        return np.where(d > 0, d / np.maximum(np.hypot(l, d), 1e-9), 0.0)

    def ring_r(self, l, y):
        """Signed distance outward from the ring intrados, in the branch section."""
        b = self.bsec
        rin = b.hw - self.P
        l = np.asarray(l, float); y = np.asarray(y, float)
        return np.where(y <= b.spring, np.abs(l) - rin, np.sqrt(l * l + (y - b.spring) ** 2) - rin)

    # -------------------------------------------------------------- branch side
    def ring_front_q(self, l, y):
        return self.q_host(l, y)

    def host_normal(self, y):
        """Unit normal of the host face into its masonry (the same for every l: the host is straight)."""
        h = self.hsec
        y = np.asarray(y, float)
        W = h.wall_s_at_y(y)
        above = y > h.spring
        a = np.where(above, W / h.hw ** 2, 1.0)
        b = np.where(above, (y - h.spring) / h.rise ** 2, 0.0)
        n3 = np.array([self.nh[0], 0.0, self.nh[1]]) * self.sigma
        N = a[..., None] * n3 + b[..., None] * np.array([0.0, 1.0, 0.0])
        return N / np.linalg.norm(N, axis=-1, keepdims=True)

    def branch_shell_hole(self, cu, cs, cy):
        """Cells of the branch shell to drop: the barrel ends half way into the ring; the far wall below the
        coping runs on through the culvert to the host channel wall; the walkway wall ends inside the steps."""
        q = self.q_of_u(cu)
        ring_end = self.ring_front_q(cs, cy) + self.D * 0.5
        far = np.sign(cs) == np.sign(self.l_far)
        low = far & (cy + 0.045 <= self.RING_LOW_FAR)
        cut = np.where(low, self.q_chan(cs) + 0.15, ring_end)
        return q < cut

    def walk_hole(self, cu, cs):
        """Branch walkway paving: ends under the threshold step."""
        return self.q_of_u(cu) < self.q_wall(cs) + 0.25

    def walkface_hole(self, cu):
        return self.q_of_u(cu) < self.q_chan(self.l_we) + 0.15

    def silt_hole(self, cu, cs):
        return self.q_of_u(cu) < self.q_chan(cs) + 0.3

    def coping_gap(self):
        q1 = float(self.q_wall(self.l_we)) + 0.4
        return (0.0, q1) if self.which == 'start' else (self.L - q1, self.L + 1.0)

    def water_from(self):
        """Branch water starts at the sill lip (path u range of the branch water)."""
        q0 = float(max(self.q_chan(self.cl[0]), self.q_chan(self.cl[1]))) - 0.06
        return (q0, self.L) if self.which == 'start' else (0.0, self.L - q0)

    def keep_out(self):
        """Path u range where the branch places no rings, shafts, lamps, curtains or debris."""
        q1 = float(self.q_wall(0.0)) + 1.0
        return (-1.0, q1) if self.which == 'start' else (self.L - q1, self.L + 1.0)

    # -------------------------------------------------------------- host side
    def host_zone(self, hpath):
        """Host path u of the node and the u range of the meeting on the host."""
        un, d = hpath.u_near(*self.O)
        assert d < 0.3, 'tee: the node is %.2f m off the host centre line' % d
        span = self.bsec.hw + self.T + 1.2
        return un, (un - span, un + span)

    def _host_local(self, hpath, cu, cs, cy):
        P = hpath.world(cu, cs, cy)
        q, l, y = self.local(P)
        return q, l, y, self.host_s(P)

    def host_shell_hole(self, hpath):
        def hole(cu, cs, cy):
            q, l, y, sh = self._host_local(hpath, cu, cs, cy)
            near = self.sigma * sh > 0.12     # by the crown the ring's face passes under the host vault
            # cells well inside the opening only: host_cutter makes the edge under the rim's face exactly
            return near & (self.ring_r(l, y) < -0.12) & (y > self.hsec.ledge_y - 0.2)
        return hole

    def gap_l(self):
        """Lateral range of the cut through the host ledge: to the middle of each return coping."""
        lo, hi = self.cl
        return lo - 0.16, hi + 0.16

    def host_walk_hole(self, hpath, cu, cs):
        q, l, y, sh = self._host_local(hpath, cu, cs, np.full(np.shape(cu), self.hsec.ledge_y))
        lo, hi = self.gap_l()
        culvert = (l > lo) & (l < hi)
        mouth = (np.abs(l) < self.bsec.hw + 0.25) & (self.sigma * sh > self.hsec.hw - 0.12)
        return (self.sigma * sh > 0) & (culvert | mouth)

    def host_u_knots(self, hpath):
        return []

    def host_silt_hole(self, hpath, cu, cs):
        return np.zeros(np.shape(cu), bool)

    def host_coping_gap(self, hpath, side=None):
        """Host u range the ledge coping leaves open: it butts against the two return copings."""
        if side is not None and side != self.sigma:
            return None
        lo, hi = self.cl
        pts = self.world(self.q_at(np.array([lo - 0.36, hi + 0.36]), self.ch + 0.16), np.array([lo - 0.36, hi + 0.36]), self.hsec.ledge_y)
        us = sorted(hpath.u_near(p[0], p[2])[0] for p in pts)
        return us[0], us[1]

    def host_walkface_hole(self, hpath, cu, cy, side=None):
        if side is not None and side != self.sigma:
            return np.zeros(np.shape(cu), bool)
        s = self.sigma * self.ch
        q, l, y, sh = self._host_local(hpath, cu, np.full(np.shape(cu), s), cy)
        lo, hi = self.cl
        return (l > lo - 0.1) & (l < hi + 0.1) & (cy > self.bsec.bed - 0.1)

    def host_silt(self, hpath, P):
        """A scoured pool in front of the sill: silt stays under the giant's step."""
        q, l, y = self.local(P)
        sh = self.host_s(P)
        lo, hi = self.cl
        near = (l > lo - 0.4) & (l < hi + 0.4) & (self.sigma * sh > self.ch - 0.9)
        return np.where(near, np.minimum(P[..., 1], self.GIANT_STEP - 0.08), P[..., 1])

    # -------------------------------------------------------------- the branch's meeting pieces
    def build(self, name, mats, coll, rng):
        obs = [self.ring(name, mats, coll)]
        obs += self.stones(name, mats, coll, rng)
        obs += self.culvert_walls(name, mats, coll)
        obs.append(self.spill(name, mats, coll))
        return obs

    def ring_samples(self, dv=0.025):
        b = self.bsec
        s, y, v, vt = b.profile(dv)
        ns = np.where(y <= b.spring, np.sign(s), s / b.hw)
        ny = np.where(y <= b.spring, 0.0, (y - b.spring) / b.hw)
        nn = np.hypot(ns, ny); ns, ny = ns / nn, ny / nn
        side_w = np.sign(s) == self.ws
        keep = np.where(side_w, y >= self.RING_LOW_WALK, y >= self.RING_LOW_FAR)
        idx = np.nonzero(keep)[0]
        i0, i1 = idx[0], idx[-1]
        s, y, ns, ny = s[i0:i1 + 1].copy(), y[i0:i1 + 1].copy(), ns[i0:i1 + 1], ny[i0:i1 + 1]
        y[0] = self.RING_LOW_WALK if np.sign(s[0]) == self.ws else self.RING_LOW_FAR
        y[-1] = self.RING_LOW_WALK if np.sign(s[-1]) == self.ws else self.RING_LOW_FAR
        return s - self.P * ns, y - self.P * ny, ns, ny

    def _rim_dirs(self):
        if not hasattr(self, '_rs'):
            li, yi, ns, ny = self.ring_samples()
            Q = AR.resample(np.stack([li, yi], -1), AR.ROW, False)
            self._rs = (Q,) + AR.surface_normals(Q, AR.normals(Q, False), _RimHost(self), False)
        return self._rs

    def host_cutter(self, hpath):
        """Closed prism along the branch through the host face: the clear outline pushed out by half the rim's width on
        the host face (under its face), its legs carried down to the ledge; the host shell is cut with it exactly."""
        Q, D, sc = self._rim_dirs()
        O = Q + D * (0.5 * self.T)
        yb = self.hsec.ledge_y - 0.2
        P2 = np.vstack([[O[0, 0], yb], O, [O[-1, 0], yb]])
        q_f = self.q_host(P2[:, 0], np.maximum(P2[:, 1], yb + 0.01))
        q0, q1 = float(np.min(q_f)) - 0.3, float(self.q_wall(0.0)) + 0.6
        k = len(P2)
        A = self.world(np.full(k, q0), P2[:, 0], P2[:, 1]); B = self.world(np.full(k, q1), P2[:, 0], P2[:, 1])
        V = np.vstack([A, B])
        F = [[i, (i + 1) % k, k + (i + 1) % k, k + i] for i in range(k)] + [list(range(k))[::-1], [k + i for i in range(k)]]
        return V, F

    def rim_scale(self, l, y):
        """The rim's section-plane scale at (l, y) (kit/arch_rim.surface_normals: where the host vault lies oblique,
        a metre on the host face is less than a metre in the branch section), from the nearest clear-outline point.
        The host cuts its hole with it, so the hole stays under the rim's face."""
        Q, D, sc = self._rim_dirs()
        l, y = np.broadcast_arrays(np.asarray(l, float), np.asarray(y, float))
        P = np.stack([l.ravel(), y.ravel()], -1); out = np.empty(len(P))
        for a in range(0, len(P), 4096):
            d = np.sum((P[a:a + 4096, None, :] - Q[None]) ** 2, -1)
            out[a:a + 4096] = sc[np.argmin(d, 1)]
        return out.reshape(l.shape)

    def ring(self, name, mats, coll):
        """The arch rim round the opening (kit/arch_rim.py): its face follows the host face, PF proud, its reveal
        steps one header back to the clear opening (P inside the barrel), its back D in; thinner over the crown."""
        li, yi, ns, ny = self.ring_samples()
        sc = self.T_at(ny) / self.T
        b = self.bsec
        def masks(P, M):
            M['wxA'][:, 1] += 0.3                                             # soot and grime, as the walls
            M['wxA'][:, 2] += 0.45 * U.smoothstep(b.ledge_y + 0.5, b.ledge_y - 0.1, P[:, 1])   # slime by the walk
        return AR.rim('%s_tee_ring' % name, np.stack([li, yi], -1), _RimHost(self), mats['brick_rib'], coll,
                      width=self.WIDTH * sc, step=self.STEP * sc, depth=self.DEPTH, proud=self.PF, back=self.D,
                      arris=self.ARRIS, masks=masks, seed=zlib.crc32(name.encode()))

    def block(self, name, q0, q1, l0, l1, y0, y1, mat, coll, rng, r=0.01, wear=0.0, chips=(3, 7)):
        """A stone whose 8 corners lie on the tee frame; q and l may be functions of the other coordinate."""
        C = []
        for i in range(8):
            ix, iy, iz = i & 1, (i >> 1) & 1, (i >> 2) & 1
            ll = l1 if iz else l0
            qa = q0(ll) if callable(q0) else q0
            qb = q1(ll) if callable(q1) else q1
            C.append(self.world(qb if ix else qa, ll, y1 if iy else y0))
        C = np.array(C)
        return U.block_object(name, C, mat, coll, r=r, res=0.05, seed=int(rng.integers(1 << 30)), chips=int(rng.integers(*chips)),
                              chip_size=(0.015, 0.05), wear_top=wear, corners=0, wobble=0.0008)

    def stones(self, name, mats, coll, rng):
        b, h = self.bsec, self.hsec
        lo, hi = self.cl
        we, ww = self.l_we, self.l_ww
        dw = np.sign(ww - we)                     # from the walkway edge towards its wall
        yL = h.ledge_y
        out = []
        qw = lambda l: self.q_wall(l)
        qc = lambda l: self.q_chan(l)
        # walkway: threshold seam stone (flush with the ledge, 1 cm proud) and one step down to the rui walkway
        la, lb = sorted((we - dw * 0.04, ww + dw * 0.3))
        out.append(self.block('%s_tee_threshold' % name, lambda l: qw(l) - 0.35, lambda l: qw(l) + 0.1, la, lb, b.ledge_y - 0.25, yL + 0.01,
                              mats['bluestone_step'], coll, rng, wear=0.008))
        out.append(self.block('%s_tee_step' % name, lambda l: qw(l) + 0.1, lambda l: qw(l) + 0.4, la, lb, b.ledge_y - 0.25, (yL + b.ledge_y) / 2,
                              mats['bluestone_step'], coll, rng, wear=0.01))
        # dressed return copings along both culvert edges, 1 cm proud of the ledge paving
        for l_e, q_end, tag in ((we, lambda l: qw(l) - 0.35, 'walk'), (self.l_far, lambda l: qw(l) + 0.25, 'far')):
            away = -np.sign((lo + hi) / 2 - l_e)
            la, lb = sorted((l_e - away * 0.04, l_e + away * 0.36))
            out.append(self.block('%s_tee_return_%s' % (name, tag), lambda l: qc(l) - 0.04, q_end, la, lb, yL - 0.25, yL + 0.01,
                                  mats['bluestone'], coll, rng, wear=0.006))
        # bluestone quoins at the culvert mouth corners, three courses from the sill to the coping
        ys = np.linspace(b.bed, yL - 0.25, 4)
        for l_e in (lo, hi):
            away = -np.sign((lo + hi) / 2 - l_e)
            la, lb = sorted((l_e - away * 0.01, l_e + away * 0.3))
            for k in range(3):
                out.append(self.block('%s_tee_quoin' % name, lambda l: qc(l) - 0.012, lambda l: qc(l) + 0.3, la, lb, ys[k] - 0.002, ys[k + 1] + 0.002,
                                      mats['bluestone_quoin'], coll, rng))
        # the sill at the rui bed, its nose 6 cm proud of the gallery channel wall, and the giant's step below it
        out.append(self.block('%s_tee_sill' % name, lambda l: qc(l) - 0.06, lambda l: qc(l) + 0.45, lo - 0.25, hi + 0.25, b.bed - 0.3, b.bed,
                              mats['bluestone_wet'], coll, rng, r=0.012, wear=0.006))
        out.append(self.block('%s_tee_giantstep' % name, lambda l: self.q_at(l, self.ch - 0.5), lambda l: qc(l) - 0.004, lo + 0.02, hi - 0.02,
                              h.bed - 0.12, self.GIANT_STEP, mats['bluestone_wet'], coll, rng, r=0.012, wear=0.004))
        return out

    def culvert_walls(self, name, mats, coll):
        """The walkway's channel face through the ledge, up to the return coping (the far wall is the shell's)."""
        b, h = self.bsec, self.hsec
        l = self.l_we
        qa = float(self.q_chan(l)); qb = float(self.q_wall(l)) + 0.2
        uu = np.arange(np.floor(min(self.u_of_q(qa), self.u_of_q(qb)) / 0.2) * 0.2, max(self.u_of_q(qa), self.u_of_q(qb)) + 0.2001, 0.2)
        yy = np.linspace(b.ledge_y - 0.19, h.ledge_y - 0.19, 4)
        Uu, Yy = np.meshgrid(uu, yy, indexing='ij')
        P = self.bpath.world(Uu, np.full(Uu.shape, l), Yy)
        cq = self.q_of_u(0.5 * (Uu[1:, 1:] + Uu[:-1, :-1]))
        keep = (cq > qa + 0.15) & (cq < qb)
        mid = self.world(np.array((qa + qb) / 2), np.array((self.cl[0] + self.cl[1]) / 2), np.array(b.bed + 0.5))
        from rlib import gallery as G
        A = np.zeros((*P.shape[:2], 4), np.float32); Bm = np.zeros((*P.shape[:2], 4), np.float32); Bm[..., 3] = 1
        A[..., 2] = 0.5; A[..., 3] = 0.2
        ob = U.grid_mesh('%s_tee_culvertwall' % name, P, np.stack([Uu, Yy], -1), attrs={'wxA': A, 'wxB': Bm}, keep=keep,
                         flip=G.orient_check(P, mid), coll_=coll, mat=mats['brick_channel'])
        U.remove_loose(ob); U.add_adaptive(ob)
        return [ob]

    def spill(self, name, mats, coll):
        """The rui water runs over the sill lip and drops 0.2 m into the gallery water: a thin film sheet."""
        b, h = self.bsec, self.hsec
        lo, hi = self.cl
        ll = np.linspace(lo + 0.02, hi - 0.02, 12)
        t = np.linspace(0, 1, 8)
        Q = np.zeros((len(ll), len(t))); Y = np.zeros_like(Q)
        for i, l in enumerate(ll):
            q0 = float(self.q_chan(l)) - 0.06
            Q[i] = q0 + 0.02 - 0.24 * np.sin(t * np.pi / 2) ** 1.5
            Y[i] = b.water - (b.water - (h.water - 0.03)) * (1 - np.cos(t * np.pi / 2))
        P = self.world(Q, np.broadcast_to(ll[:, None], Q.shape), Y)
        from rlib import gallery as G
        up = P[len(ll) // 2, 3] + np.array([0, 1.0, 0]) - 0.5 * np.r_[self.tb[0], 0, self.tb[1]]
        return U.grid_mesh('%s_tee_spill' % name, P, P[..., [0, 2]], flip=G.orient_check(P, up), coll_=coll, mat=mats['water_film'], smooth=True)


class _RimHost:
    """arch_rim host for a tee or throat: (l, y) in the branch section, t along the branch from the host face
    (q_host), proud faces offset along the host normal (a gallery's curved side; a throat's flat end wall)."""
    def __init__(self, t):
        self.t = t
    def point(self, l, y, t):
        l, y, t = np.broadcast_arrays(np.asarray(l, float), np.asarray(y, float), np.asarray(t, float))
        qf = self.t.ring_front_q(l, y)
        return self.t.world(qf + np.maximum(t, 0.0), l, y) + np.minimum(t, 0.0)[..., None] * self.t.host_normal(y)

# ------------------------------------------------------------------ finding tees in the route plan
def _seg_dist(p, a, b):
    ab = b - a
    t = np.clip(np.dot(p - a, ab) / max(np.dot(ab, ab), 1e-12), 0, 1)
    return float(np.linalg.norm(p - (a + t * ab))), a + t * ab, ab / np.linalg.norm(ab), t

def through_line(routes, p, exclude, cls='G', tol=0.3, straight_deg=20.0):
    """A gallery of class cls passing straight through the point p: (unit tangent, [route ids]) or None."""
    p = np.asarray(p, float)
    ends = []
    for rid, r in routes.items():
        if rid == exclude or r['class'] != cls:
            continue
        P = np.asarray(r['pts'], float)
        for i, (a, b) in enumerate(zip(P[:-1], P[1:])):
            d, q, t_, tt = _seg_dist(p, a, b)
            if d < tol and 1e-3 < tt < 1 - 1e-3:
                return t_, [rid]
        for k, sgn in ((0, 1), (-1, -1)):
            if np.linalg.norm(P[k] - p) < tol:
                nxt = P[1] if k == 0 else P[-2]
                d = (nxt - P[k]) / np.linalg.norm(nxt - P[k])
                ends.append((rid, d))
        for i in range(1, len(P) - 1):
            if np.linalg.norm(P[i] - p) < tol:
                return (P[i + 1] - P[i - 1]) / np.linalg.norm(P[i + 1] - P[i - 1]), [rid]
    for i in range(len(ends)):
        for j in range(i + 1, len(ends)):
            if np.dot(ends[i][1], ends[j][1]) < -np.cos(np.radians(straight_deg)):
                return ends[j][1], [ends[i][0], ends[j][0]]
    return None

def find_tees(routes, rid, make_path, make_section):
    """Every tee the route rid takes part in, as branch or host. make_path(route id) -> RoutePath,
    make_section(route id) -> Section; both must match the builds of those routes."""
    out = []
    for bid, r in routes.items():
        if r['class'] != 'M':
            continue
        for which, p in (('start', r['pts'][0]), ('end', r['pts'][-1])):
            hit = through_line(routes, p, bid)
            if hit is None:
                continue
            t_h, hosts = hit
            if rid != bid and rid not in hosts:
                continue
            hsec = make_section(hosts[0])
            out.append(Tee(p, t_h, hsec, make_path(bid), make_section(bid), which, branch_id=bid, host_ids=hosts))
    return out


# ------------------------------------------------------------------ a giant gallery ends where a rui begins
class _PlaneFrame:
    """Adapter so kit/throat.py annulus() draws in a throat's wall plane (s = l, u ignored)."""
    def __init__(self, t, q=0.0):
        self.t, self.q = t, q
    def world(self, u, s, y):
        return self.t.world(np.full(np.shape(s), self.q), s, y)
    def frame(self, u):
        t = self.t
        return t.O[0], t.O[1], t.tb[0], t.tb[1], t.Nb[0], t.Nb[1]

class Throat(Tee):
    """The giant gallery's end wall at the node, square to the rui. The rui builds its ring (on the flat wall), the
    step and threshold from the gallery ledge down to its walkway, the end coping over the gallery channel, the
    face where the far ledge ends, the quoins, the sill at the rui bed with the giant's step below it, and the
    overflow film. The gallery builds the wall round the ring and the wall below the sill, and ends its shell,
    ledges, coping, channel walls, silt and water at the wall plane (its route runs on EXTEND m to be cut there)."""
    T_TOP = Tee.T
    host_cutter = None      # the end wall is built round the ring (build_host), not cut
    EXTEND = 0.6
    RING_LOW_FAR = -3.85    # the far leg runs down into the ledge end: no return coping here to stand on

    def __init__(self, node, t_g, hsec, bpath, bsec, which, branch_id='', host_ids=()):
        self.branch_id, self.host_ids = branch_id, list(host_ids)
        self.O = np.asarray(node, float)
        self.hsec, self.bsec, self.which = hsec, bsec, which
        self.bpath = bpath
        self.L = bpath.length
        ub = 0.0 if which == 'start' else bpath.length
        px, pz, tx, tz, nx, nz = bpath.frame(np.array(ub))
        Tb = np.array([float(tx), float(tz)])
        self.Nb = np.array([float(nx), float(nz)])
        self.tb = Tb if which == 'start' else -Tb
        tg = np.asarray(t_g, float); self.tg = tg / np.linalg.norm(tg)      # from the node into the gallery
        cosang = -float(np.dot(self.tg, self.tb))
        assert cosang > np.cos(np.radians(15)), 'throat: the rui turns %.1f degrees from the gallery' % np.degrees(np.arccos(np.clip(cosang, -1, 1)))
        self.th = self.tg; self.nh = np.array([self.tg[1], -self.tg[0]])
        self.sigma, self.c, self.k = 1, 1.0, 0.0
        self.ws = bsec.sides[0]
        lo, hi = bsec.channel_edges()
        self.l_we = hi if self.ws > 0 else lo
        self.l_far = -self.ws * bsec.hw
        self.l_ww = self.ws * bsec.hw
        hlo, hhi = hsec.channel_edges()
        self.ch = (hhi - hlo) / 2
        kk = abs(float(np.dot(self.Nb, self.nh)))
        self.gc = (-self.ch / kk, self.ch / kk)                          # gallery channel edges in l at the wall
        self.gc_w = self.gc[1] if self.ws > 0 else self.gc[0]            # on the walkway side
        self.gc_f = self.gc[0] if self.ws > 0 else self.gc[1]            # on the far side
        self.cl = sorted((self.l_we, self.gc_f))                         # rui channel over the gallery channel
        self.q_ring = 1.5
        assert self.straight_ok(), 'throat: the rui bends within 1.5 m of the node'

    def q_at(self, l, s):
        return np.zeros(np.broadcast(np.asarray(l, float), np.asarray(s, float)).shape)

    def T_at(self, ny):
        return np.full(np.shape(ny), self.T)

    def host_normal(self, y):
        return np.broadcast_to(np.array([self.tb[0], 0.0, self.tb[1]]), np.shape(y) + (3,))

    def branch_shell_hole(self, cu, cs, cy):
        q = self.q_of_u(cu)
        far = np.sign(cs) == np.sign(self.l_far)
        low = far & (cy + 0.045 <= self.RING_LOW_FAR)
        return (q < self.D * 0.5) & ~low

    # -------------------------------------------------------------- the gallery's side
    def _gq(self, hpath, cu, cs, cy=None):
        P = hpath.world(cu, cs, np.zeros(np.shape(cu)) if cy is None else cy)
        return self.local(P)[0]

    def host_zone(self, hpath):
        un, d = hpath.u_near(*self.O)
        return un, (un - 2.5, un + 2.5)

    def host_shell_hole(self, hpath):
        return lambda cu, cs, cy: self._gq(hpath, cu, cs, cy) > 0.1

    def host_walk_hole(self, hpath, cu, cs):
        return self._gq(hpath, cu, cs) > 0.0

    def host_silt_hole(self, hpath, cu, cs):
        return self._gq(hpath, cu, cs) > 0.1

    def host_walkface_hole(self, hpath, cu, cy, side=None):
        s = (side or 1) * self.ch
        return self._gq(hpath, cu, np.full(np.shape(cu), s)) > 0.0

    def _u_at_q(self, hpath, s, q):
        """Gallery u where its lateral line s crosses the plane q (one of its two ends lies at the node)."""
        un = hpath.u_near(*self.O)[0]
        uu = np.linspace(max(0.0, un - 4.0), min(hpath.length, un + 4.0), 1601)
        qq = self._gq(hpath, uu, np.full(uu.shape, s))
        o = np.argsort(qq)
        return float(np.interp(q, qq[o], uu[o]))

    def _host_end(self, hpath):
        un = hpath.u_near(*self.O)[0]
        return 'start' if un < hpath.length / 2 else 'end'

    def host_u_knots(self, hpath):
        return [self._u_at_q(hpath, s, 0.0) for s in (-self.ch, self.ch)]

    def host_coping_gap(self, hpath, side=None):
        """The walkway side's coping stops under the threshold; the far side's at the wall."""
        s = (side or 1) * (self.ch + 0.16)
        P = hpath.world(np.array(hpath.u_near(*self.O)[0]), np.array(s), np.array(0.0))
        l_side = np.sign(self.local(P)[1])
        q_stop = -0.35 if l_side == np.sign(self.l_ww) else 0.0
        u = self._u_at_q(hpath, s, q_stop)
        return (u, hpath.length + 1.0) if self._host_end(hpath) == 'end' else (-1.0, u)

    def host_water(self, hpath):
        u = self._u_at_q(hpath, 0.0, -0.06)
        return (0.0, u) if self._host_end(hpath) == 'end' else (u, hpath.length)

    def host_silt(self, hpath, P):
        q, l, y = self.local(P)
        near = (q > -0.9) & (l > self.gc[0] - 0.4) & (l < self.gc[1] + 0.4)
        return np.where(near, np.minimum(P[..., 1], self.GIANT_STEP - 0.08), P[..., 1])

    def build_host(self, name, mats, coll):
        """The end wall facing the gallery: round the ring above the ledges, and below the sill and end coping."""
        from kit import throat as KT
        from rlib import gallery as G
        h, b = self.hsec, self.bsec
        cy = h.ledge_y - 0.06                   # the wall's rays start just under the ledge top
        rin = b.hw - self.P + self.T - 0.10
        def k_in(d):
            # ray from (0, ledge) to the ring's outer edge (vertical legs below the rui springing, arc above)
            if abs(d[0]) > 1e-9:
                t_leg = rin / abs(d[0])
                if cy + d[1] * t_leg <= b.spring:
                    return t_leg
            oy = cy - b.spring
            bq = d[1] * oy; cq = oy * oy - rin * rin
            return -bq + np.sqrt(max(bq * bq - cq, 0.0))
        ao, bo = h.hw + 0.04, h.rise + 0.04
        def k_out(d):
            if abs(d[0]) > 1e-9:
                t_wall = ao / abs(d[0])
                if cy + d[1] * t_wall <= h.spring:
                    return t_wall
            oy = cy - h.spring
            A = (d[0] / ao) ** 2 + (d[1] / bo) ** 2; B = 2 * d[1] * oy / bo ** 2; C = (oy / bo) ** 2 - 1
            return (-B + np.sqrt(max(B * B - 4 * A * C, 0.0))) / (2 * A)
        fr = _PlaneFrame(self, 0.0)
        obs = KT.annulus('%s_throat_wall' % name, fr, 0.0, 1.0, -1, coll, mats, cy, cy + 1.0, h.hw, h.rise, h.ledge_y,
                         k_in=lambda d: min(k_in(d), k_out(d) - 0.02), k_out=k_out, lower=False)
        # below: the gallery channel's end under the sill, and under the end coping beside the walkway
        ll = np.linspace(self.gc[0] - 0.3, self.gc[1] + 0.3, 25)
        yy = np.linspace(h.bed - 0.15, b.ledge_y - 0.19, 22)
        Ll, Yy = np.meshgrid(ll, yy, indexing='ij')
        P = self.world(np.zeros(Ll.shape), Ll, Yy)
        cl_, cy_ = 0.25 * (Ll[1:, 1:] + Ll[:-1, :-1] + Ll[1:, :-1] + Ll[:-1, 1:]), 0.25 * (Yy[1:, 1:] + Yy[:-1, :-1] + Yy[1:, :-1] + Yy[:-1, 1:])
        lw = sorted((self.l_we, self.gc_w + np.sign(self.l_ww) * 0.3))
        keep = (cy_ < b.bed + 0.03) | ((cl_ > lw[0] + 0.03) & (cl_ < lw[1]))
        A = np.zeros((*P.shape[:2], 4), np.float32); Bm = np.zeros((*P.shape[:2], 4), np.float32); Bm[..., 3] = 1
        A[..., 2] = 0.6; A[..., 3] = 0.3
        want = self.world(np.array(-1.0), np.array(0.0), np.array(h.bed + 0.5))
        o = U.grid_mesh('%s_throat_lower' % name, P, np.stack([Ll, Yy], -1), attrs={'wxA': A, 'wxB': Bm}, keep=keep,
                        flip=G.orient_check(P, want), coll_=coll, mat=mats['brick_channel'])
        U.remove_loose(o); U.add_adaptive(o)
        return obs + [o]

    # -------------------------------------------------------------- the rui's pieces
    def build(self, name, mats, coll, rng):
        return [self.ring(name, mats, coll)] + self.stones(name, mats, coll, rng) + self.ledge_end(name, mats, coll) + [self.spill(name, mats, coll)]

    def stones(self, name, mats, coll, rng):
        b, h = self.bsec, self.hsec
        we, ww = self.l_we, self.l_ww
        dw = np.sign(ww - we)
        yL = h.ledge_y
        out = []
        # gallery ledge -> threshold (1 cm proud, it also ends the ledge coping) -> step -> rui walkway
        la, lb = sorted((self.gc_w - dw * 0.04, ww + dw * 0.3))
        out.append(self.block('%s_throat_threshold' % name, -0.35, 0.1, la, lb, b.ledge_y - 0.25, yL + 0.01, mats['bluestone_step'], coll, rng, wear=0.008))
        la, lb = sorted((we - dw * 0.04, ww + dw * 0.3))
        out.append(self.block('%s_throat_step' % name, 0.1, 0.4, la, lb, b.ledge_y - 0.25, (yL + b.ledge_y) / 2, mats['bluestone_step'], coll, rng, wear=0.01))
        # the walkway's end over the gallery channel: a dressed coping, its nose 6 cm proud of the wall
        la, lb = sorted((we - dw * 0.04, self.gc_w - dw * 0.04))
        out.append(self.block('%s_throat_endcoping' % name, -0.06, 0.1, la, lb, b.ledge_y - 0.25, b.ledge_y + 0.01, mats['bluestone'], coll, rng, wear=0.006))
        # quoins: walkway face / end wall, and far gallery channel wall / ledge end
        for (l_e, q0, q1, y0, y1, away) in ((we, -0.012, 0.3, b.bed, b.ledge_y - 0.25, dw),
                                            (self.gc_f, -0.3, 0.012, b.bed, yL - 0.25, -np.sign(self.gc_w - self.gc_f))):
            la, lb = sorted((l_e - away * 0.012, l_e + away * 0.3))
            ys = np.linspace(y0, y1, 3 if y1 - y0 > 0.9 else 2)
            for k in range(len(ys) - 1):
                out.append(self.block('%s_throat_quoin' % name, q0, q1, la, lb, ys[k] - 0.002, ys[k + 1] + 0.002, mats['bluestone_quoin'], coll, rng))
        lo, hi = self.cl
        out.append(self.block('%s_throat_sill' % name, -0.06, 0.45, lo - 0.25, hi + 0.25, b.bed - 0.3, b.bed, mats['bluestone_wet'], coll, rng, r=0.012, wear=0.006))
        out.append(self.block('%s_throat_giantstep' % name, -0.5, -0.004, self.gc[0] + 0.02, self.gc[1] - 0.02, h.bed - 0.12, self.GIANT_STEP,
                              mats['bluestone_wet'], coll, rng, r=0.012, wear=0.004))
        return out

    def ledge_end(self, name, mats, coll):
        """Where the far gallery ledge stops over the rui channel: its end face, under the coping."""
        from rlib import gallery as G
        b, h = self.bsec, self.hsec
        la, lb = sorted((self.gc_f, self.l_far - np.sign(self.gc_w - self.gc_f) * 0.2))
        ll = np.linspace(la, lb, 6); yy = np.linspace(b.bed - 0.15, h.ledge_y - 0.19, 10)
        Ll, Yy = np.meshgrid(ll, yy, indexing='ij')
        P = self.world(np.zeros(Ll.shape), Ll, Yy)
        A = np.zeros((*P.shape[:2], 4), np.float32); Bm = np.zeros((*P.shape[:2], 4), np.float32); Bm[..., 3] = 1
        A[..., 2] = 0.6
        o = U.grid_mesh('%s_throat_ledgeend' % name, P, np.stack([Ll, Yy], -1), attrs={'wxA': A, 'wxB': Bm},
                        flip=G.orient_check(P, self.world(np.array(1.0), np.array(0.5 * (la + lb)), np.array(b.bed + 0.5))), coll_=coll, mat=mats['brick_channel'])
        U.add_adaptive(o)
        return [o]

def find_throats(routes, rid, make_path, make_section, max_deg=15.0):
    """A rui that starts or ends where exactly one giant gallery ends and nothing else meets."""
    out = []
    for bid, r in routes.items():
        if r['class'] != 'M':
            continue
        for which, p in (('start', r['pts'][0]), ('end', r['pts'][-1])):
            p = np.asarray(p, float)
            at = [(k, r2) for k, r2 in routes.items() if k != bid and any(np.linalg.norm(np.asarray(r2['pts'][i]) - p) < 0.3 for i in (0, -1))]
            if len(at) != 1 or at[0][1]['class'] != 'G':
                continue
            gid, g = at[0]
            P = np.asarray(g['pts'], float)
            t_g = (P[1] - P[0]) if np.linalg.norm(P[0] - p) < 0.3 else (P[-2] - P[-1])
            if rid != bid and rid != gid:
                continue
            try:
                out.append(Throat(p, t_g, make_section(gid), make_path(bid), make_section(bid), which, branch_id=bid, host_ids=[gid]))
            except AssertionError as e:
                print('throat skipped at', p.tolist(), e)
    return out
