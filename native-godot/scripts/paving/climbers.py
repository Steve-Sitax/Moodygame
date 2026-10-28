"""Ivy and Virginia creeper on the town wall, grown (Steve, 2026-10-26: the vines on the city walls looked very fake;
make them realistic, high detail; 2026-10-27: natural, stretching long distances up the wall).
    python climbers.py <climbers dump> <near dump> <out candidate>
<climbers dump>: dump-meshes.gd of the bake's wall_climbers_* meshes (its cards); <near dump>: the town wall's faces
whose outline reaches within 3 m of the cards (dump-near-box.gd, by outline).
The bake's climber was one flat card on the wall, 3 to 5 m wide and up to 6 m high: 144 of them on the town wall.
Each card's place is a colony rooted where the card stood, its kind the card's (cells 0 and 1 ivy, 2 Virginia creeper
in red, 3 creeper turning orange); about half carry a few leaders of the other kind, so the two interlace.
(2026-10-27, round 2: they still read as upright bushes in front of the wall.) Now a colony is a climbing plant:
- the wall's face behind it is read once into a depth grid (5 cm), so every stem and leaf lies on the real brick,
  plinth, band and coping, carried over each step;
- a few woody stems 1.5 to 5 cm thick rise as a bundle from a joint at the wall's foot, cross the plinth and part
  into unequal leaders that run 4 to 7 m up the brick, straight up or slanting, each its own length; from them
  unequal side branches, the creeper's long, thin and arching (red tracery), the ivy's shorter and denser;
- some leaders reach the coping, run over its top and trail 0.3 to 0.8 m down its far side;
- ivy clings by aerial rootlets (a fringe of fine hairs under each stem), the creeper by branched tendrils ending in
  adhesive pads (small cards flat on the brick);
- leaves at true size (ivy 4 to 8 cm, creeper leaflets 5 to 10 cm: climbers.png cells are drawn at scale), the cards
  lying nearly flat on the wall 4 to 15 cm off it (ivy bulges to 25 cm), several layers deep; thick ivy low and in the
  middle, the creeper more open, both thinning to ragged tips, with brick-sized holes inside and bare brick between
  colonies; ivy darker below, the creeper burgundy and crimson low, red and orange toward its tips, a few brown and
  dull green leaves;
- at the root, moss in the joint and fallen leaves on the paving.
(2026-10-27, round 3: too thin, the wall two thirds bare; the creeper dull; still bush outlines from the front.)
- more leaders rooted along a joint 1 to 3 m wide, wider reach, side runners level or slanting at any height (low
  ones sending up shoots of their own), so a colony stands as a ragged column, not a crown on a narrow foot;
- leaves fewer at the foot and more up the middle of the run, mats placed for cover rather than piled on the stems,
  tall bare lanes between strands, the colony's edge eaten away unevenly and its mass wandering off the root's line;
- whole colonies of creeper (an ivy companion in one of five), crimson and scarlet with orange in patches.
(2026-10-28, round 4, #231: the colonies repeated at the bake's even spacing.) Each card's place has its own dice: one in
five is left bare brick, the others root up to 1.5 m along the joint from the card's middle and spread 0.55 to 1.6 times
as wide, so runs of plants, gaps and single columns alternate unevenly.
Material climbers.tres: the park plants' shader kind (cut out, both sides, wet, relief); the plant foot (custom0) set
per corner so the leaves only shiver a little in the wind. The whole surface is replaced; the climbers are no solid.
Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, pathlib, hashlib, math
import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[3]
MAT = 'res://assets/materials/climbers-20261026/climbers.tres'
AW, AH = 2048.0, 2304.0
BARK = (2048 / AH, 2176 / AH)          # v range of the bark strip
ROOTS = (2176 / AH, 2304 / AH)         # v range of the rootlet fringe
IVY_M, CREEPER_M, MAT_M = 0.36, 0.45, 0.6     # a cell's width in metres (make_climber_atlas.py; an ivy mat's)
REF = 0.9                              # the depth grid's rays start this far in front of the card's foot
G = 0.05                               # the grid's step
UP = np.array([0.0, 1.0, 0.0])
GROUND = 0.025                         # the paving at the wall's foot
IVY_N, CR_N, MAT_P, CR_DENSE, SPREAD, TIER = 2.0, 1.6, 0.75, 0.45, 0.07, 0.75   # leaf cards a stem point; mats; spread
STRAND, ROOTS_W, EDGE = 0.3, 2.0, 0.9            # leaves left in the bare lanes between strands; the root's spread along the joint
WIDE = 1.25                            # the colonies' reach along the wall
FOOT, MID = 0.7, 0.6                   # leaves at the foot (share) and up the middle of the run (extra)
SKIP = 0.2                             # the bake's places left bare (2026-10-28, round 4)


def cell_uv(row, col, s, t, quarter=None):
    """s across 0..1, t up 0..1 in atlas cell (row, col); quarter (qx, qy) for the quartered cell (qy 0 the top)."""
    if quarter is None:
        return np.array([(col + s) * 512 / AW, (row * 512 + (1 - t) * 512) / AH])
    qx, qy = quarter
    return np.array([(col * 512 + qx * 256 + s * 256) / AW, (row * 512 + qy * 256 + (1 - t) * 256) / AH])


def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def noise(x, y, scale, seed):
    """Smooth value noise 0..1 (cells of scale m)."""
    def h(i, j): return (math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453) % 1.0
    fx, fy = x / scale, y / scale; i, j = math.floor(fx), math.floor(fy); u, v = fx - i, fy - j
    u, v = u * u * (3 - 2 * u), v * v * (3 - 2 * v)
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v


def first_hits(T, O, d, far=4.0):
    """For rays O (n x 3) along one direction d: the nearest t > 0 onto the faces T (inf where none)."""
    e1 = T[:, 1] - T[:, 0]; e2 = T[:, 2] - T[:, 0]
    h = np.cross(d, e2); a = (e1 * h).sum(1)
    ok = np.abs(a) > 1e-9
    T, e1, e2, h, a = T[ok], e1[ok], e2[ok], h[ok], a[ok]
    f = 1 / a
    best = np.full(len(O), np.inf)
    for i in range(0, len(O), 256):
        o = O[i:i + 256]
        s = o[:, None, :] - T[None, :, 0]
        u = f * (s * h).sum(2)
        q = np.cross(s, e1)
        v = f * (q @ d)
        t = f * (q * e2).sum(2)
        m = (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 1e-4) & (t < far)
        t = np.where(m, t, np.inf)
        best[i:i + 256] = t.min(1) if t.shape[1] else np.inf
    return best


class Face:
    """The wall's face behind one colony as a depth grid: wall(s, h) is how far out of the card's foot plane the
    brick (or stone) stands at s along the wall and h up from the foot."""
    def __init__(self, T, base, along, out, half_w=4.0, top=9.4):
        self.T, self.base, self.along, self.out = T, base, along, out
        self.s0, self.h0 = -half_w, -0.4
        self.ns, self.nh = int(2 * half_w / G) + 1, int((top - self.h0) / G) + 1
        S, H = np.meshgrid(self.s0 + np.arange(self.ns) * G, self.h0 + np.arange(self.nh) * G, indexing='ij')
        O = base + out * REF + S.reshape(-1, 1) * along + H.reshape(-1, 1) * UP
        nT = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); nT /= np.linalg.norm(nT, axis=1)[:, None] + 1e-12
        t = first_hits(T[np.abs(nT @ out) > 0.05], O, -out).reshape(self.ns, self.nh)
        self.w = REF - t                                     # -inf where no wall
        # the wall's main face at the foot (its plinth) and the face above it, for judging what is still this wall
        col = self.w[self.ns // 2]
        self.foot = float(np.nanmax(np.where(np.isfinite(col[:30]), col[:30], np.nan))) if np.isfinite(col[:30]).any() else 0.0
        # the top: per column the highest h whose face is still this wall's (not a tower's face far behind)
        ok = np.isfinite(self.w) & (np.abs(self.w - self.foot) < 0.45)
        self.ok = ok
        tops = np.where(ok.any(1), self.h0 + (self.nh - 1 - np.argmax(ok[:, ::-1], 1)) * G, -1.0)
        self.tops = tops

    def idx(self, s, h):
        return int(round((s - self.s0) / G)), int(round((h - self.h0) / G))

    def on(self, s, h):
        i, j = self.idx(s, h)
        return 0 <= i < self.ns and 0 <= j < self.nh and bool(self.ok[i, j])

    def wall(self, s, h, r=1):
        """The face's height out of the foot plane near (s, h): the most proud within r cells (so nothing cuts it)."""
        i, j = self.idx(s, h)
        i0, i1, j0, j1 = max(i - r, 0), min(i + r + 1, self.ns), max(j - r, 0), min(j + r + 1, self.nh)
        if i0 >= i1 or j0 >= j1: return None
        blk = self.w[i0:i1, j0:j1]
        blk = blk[np.isfinite(blk) & (np.abs(blk - self.foot) < 0.45)]
        return float(blk.max()) if blk.size else None

    def top(self, s):
        i = int(round((s - self.s0) / G))
        return float(self.tops[min(max(i, 0), self.ns - 1)])

    def point(self, s, h, off, r=1):
        w = self.wall(s, h, r)
        if w is None: return None
        return self.base + self.along * s + UP * h + self.out * (w + off)


class Mesh:
    def __init__(self, along):
        self.rows = []; self.along = along; self.cards = 0
    def emit(self, tri, n):
        for p, uv, col in tri:
            self.rows.append(np.concatenate([p, n, uv, [0, 0], col, [p[0], p[2], p[1] - 2.15, 0], [self.along[0], 0, self.along[2], 1]]))
    def quad(self, a, b, c, d, n):
        self.emit([a, b, c], n); self.emit([a, c, d], n)
    def quadn(self, a, b, c, d):
        """A quad whose corners carry their own normals: (p, uv, col, n)."""
        for tri in ((a, b, c), (a, c, d)):
            for p, uv, col, n in tri:
                self.rows.append(np.concatenate([p, n, uv, [0, 0], col, [p[0], p[2], p[1] - 2.15, 0], [self.along[0], 0, self.along[2], 1]]))
    def card(self, foot, ax, sd, nrm, size, uvf, col, centred=False):
        """A leaf card: its foot (bottom middle, or its middle) at foot, up along ax, across along sd."""
        f = foot - ax * size * 0.5 if centred else foot
        P = lambda s, t: f + sd * (s - 0.5) * size + ax * t * size
        self.quad((P(0, 0), uvf(0, 0), col), (P(1, 0), uvf(1, 0), col), (P(1, 1), uvf(1, 1), col), (P(0, 1), uvf(0, 1), col), nrm)
        self.cards += 1


def grow(rng, base, along, out, width, kind, face, seed, shift=0.0, recruit=False, spread=1.0):
    """One colony's rows (22 floats a corner, custom0 four); a recruit is a young plant beside it, shift along the wall;
    spread scales the colony's reach along the wall."""
    M = Mesh(along)
    ivy = kind in (0, 1)
    tone = rng.uniform(0.9, 1.05)
    # the colony: an established plant most often, a young one now and then; its reach from the wall's own top
    top0 = face.top(0.0)
    avail = (top0 if top0 > 1.0 else 6.0) - 0.04
    r = rng.random()
    young = r < 0.12 or recruit
    if young: H = avail * rng.uniform(0.3, 0.5)
    elif r < 0.62: H = avail                                        # to the coping, some over it
    else: H = avail * rng.uniform(0.75, 0.95)
    H = min(H, 8.5)
    wide = rng.uniform(0.6, 1.35)                                 # (each colony its own width)
    span = (rng.uniform(0.6, 1.0) if young else rng.uniform(1.9, 3.1) * WIDE if ivy else rng.uniform(2.1, 3.4) * WIDE) * min(1.0, width / 3.0 + 0.45) * (1 if young else wide * spread)
    root = shift + rng.normal(0, 0.15)
    hole_seed = seed % 997
    stems = []          # (pts [(s, h)], thick [m], depth, species ivy?, length so far at each point)

    def walk(s, h, th, ang, length, depth, sp_ivy, aim, lean_up, kink=0.08, far=1.4):
        """A stem from (s, h) heading ang (0 up, + toward +s): a slow random walk drawn toward its aim, curving back
        up; it stops where the wall ends or at the colony's reach. Returns its points."""
        pts = [(s, h)]; th0 = th; L = 0.0; step = 0.08
        tops = []
        while L < length:
            # (a leader parts from the bundle low down, then turns up the wall)
            goal = aim * max(0.15, 1 - max(h, 0.0) / 4.5) if depth == 0 else aim
            ang += rng.normal(0, kink) + (goal - ang) * (0.12 if depth == 0 and h < 1.5 else 0.06) - ang * lean_up
            ang = max(min(ang, 1.45), -1.45)
            ns_, nh_ = s + math.sin(ang) * step, h + math.cos(ang) * step
            if not face.on(ns_, max(nh_, 0.0)):
                if nh_ >= face.top(ns_) - 0.06: tops.append((s, h)); break
                break
            if abs(ns_ - root) > span * far:                       # (back toward the colony's run)
                if depth > 0: break
                ang -= 0.25 * math.copysign(1.0, ns_ - root); L += 0.02; continue
            s, h = ns_, nh_; L += step
            pts.append((s, h))
        return pts, tops

    def branch(pts, th0, depth, sp_ivy, cap_ok):
        """Thickness along pts and its side branches."""
        n = len(pts)
        if n < 2: return
        lens = np.r_[0, np.cumsum([math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]) for k in range(n - 1)])]
        Ltot = lens[-1]
        th = [max(th0 * (1 - 0.85 * (l / max(Ltot, 0.1))) ** 1.5, 0.0025) for l in lens]
        stems.append((pts, th, depth, sp_ivy, lens))
        if depth >= 2: return
        k = int(rng.integers(2, 5))
        while k < n - 3:
            p = pts[k]
            hf = p[1] / max(H, 0.5)
            prob = (0.75 if depth == 0 else 0.4) * (1.2 if not sp_ivy else 1.0) * (0.6 if p[1] < 0.25 else 1.0) * (0.6 + 0.7 * min(hf, 1.0))
            if rng.random() < prob:
                side = rng.choice([-1, 1])
                a0 = math.atan2(pts[min(k + 1, n - 1)][0] - p[0], pts[min(k + 1, n - 1)][1] - p[1])
                if sp_ivy: a = a0 + side * rng.uniform(0.45, 1.05); ln = rng.uniform(0.3, 1.4) * (1.0 if depth == 0 else 0.5)
                else: a = a0 + side * rng.uniform(0.35, 0.95); ln = rng.uniform(0.6, 2.4) * (1.0 if depth == 0 else 0.45)
                ln *= 0.6 + 0.6 * (1 - abs(hf - 0.5))
                q, _ = walk(p[0], p[1], th[k] * 0.55, a, ln, depth + 1, sp_ivy, a * 0.6, 0.02 if sp_ivy else 0.015,
                            kink=0.1 if sp_ivy else 0.07)
                branch(q, th[k] * 0.55, depth + 1, sp_ivy, False)
            k += int(rng.integers(2, 5)) if sp_ivy else int(rng.integers(2, 6))

    # the leaders: a bundle from the root, parting as they climb; one runs to the colony's reach
    n_lead = (int(rng.integers(1, 3)) if young else int(rng.integers(5, 9)) if ivy else int(rng.integers(4, 7)))
    aims = np.linspace(-1, 1, n_lead) * rng.uniform(0.15, 0.35) * (1 if young else wide) + rng.normal(0, 0.1, n_lead)
    feet = np.linspace(-1, 1, n_lead) * rng.uniform(0.3, 0.75) * (1 if young else wide) + rng.normal(0, 0.08, n_lead)
    order = rng.permutation(n_lead); aims, feet = aims[order], feet[order]
    companion = (not young) and rng.random() < (0.4 if ivy else 0.22)    # (a creeper colony mostly creeper: red runs)
    over_tips = []
    leaders = []
    for k in range(n_lead + (int(rng.integers(1, 3)) if companion else 0)):
        sp_ivy = ivy if k < n_lead else not ivy
        main_one = k == 0
        aim = float(aims[k]) if k < n_lead else 0.0
        if k >= n_lead: aim = rng.choice([-1, 1]) * rng.uniform(0.25, 0.6)
        reach = H if main_one else H * (rng.uniform(0.7, 1.0) if rng.random() < 0.6 else rng.uniform(0.35, 0.7))
        if not sp_ivy and k >= n_lead: reach = H * rng.uniform(0.6, 1.0)
        th0 = (rng.uniform(0.025, 0.05) if sp_ivy else rng.uniform(0.018, 0.035)) * (0.5 if young else 1.0) * (0.7 if k >= n_lead else 1.0)
        # (the leaders rooted along a joint, not in one point)
        s0 = root + float(feet[k]) * ROOTS_W + rng.normal(0, 0.06) if k < n_lead else root + rng.normal(0, 0.1)
        pts, tops = walk(s0, -0.03, th0, rng.normal(0, 0.05), reach * 1.15 + 0.2, 0, sp_ivy, aim, 0.0, kink=0.05 if sp_ivy else 0.04)
        leaders.append((pts, th0, sp_ivy))
        if tops and reach >= H - 0.01: over_tips.append((tops[0], th0, sp_ivy))
    for pts, th0, sp_ivy in leaders: branch(pts, th0, 0, sp_ivy, True)
    # side runners: from a leader low or mid-run, nearly level along the wall past the fan's edge, curving up slowly
    # (so the colony's outline frays into the wall instead of standing as a bush)
    for _ in range(0 if young else int(rng.integers(2, 6))):
        pts, th0, sp_ivy = leaders[int(rng.integers(len(leaders)))]
        cand = [i for i, (_, h) in enumerate(pts) if 0.25 < h < max(0.8 * H, 1.0)]
        if not cand: continue
        i = cand[int(rng.integers(len(cand)))]
        side = rng.choice([-1, 1]) if abs(pts[i][0] - root) < 0.3 else math.copysign(1.0, pts[i][0] - root)
        a = side * (rng.uniform(1.0, 1.35) if rng.random() < 0.55 else rng.uniform(0.5, 0.9))      # level or slanting up
        q, _ = walk(pts[i][0], pts[i][1], th0 * 0.4, a, rng.uniform(1.0, 2.6), 1, sp_ivy, a * 0.85, 0.012, kink=0.07, far=2.2)
        branch(q, th0 * 0.4, 1, sp_ivy, False)
        if pts[i][1] < 1.8 and len(q) > 4:          # a low runner sends up a shoot of its own: the colony widens at its foot
            j = len(q) // 2 + int(rng.integers(len(q) - len(q) // 2))
            u, _ = walk(q[j][0], q[j][1], th0 * 0.35, rng.normal(0, 0.15), rng.uniform(1.5, 3.5), 1, sp_ivy, 0.0, 0.03, kink=0.06, far=2.4)
            branch(u, th0 * 0.35, 1, sp_ivy, False)

    # over the coping: across its top and down its far side
    caps = []
    for (s, h), th0, sp_ivy in over_tips:
        if rng.random() > 0.7: continue
        caps.append(over_cap(rng, face, s, h, sp_ivy))

    # ---- geometry ----
    def stem_mesh(P3, th, nrm_out, sp_ivy, roots=True, depth=0):
        """A stem along 3D points P3 (on the wall's face) as a half-round of bark proud of nrm_out, and under it the
        ivy's rootlets."""
        bc = np.r_[0.92 * tone, 0.9 * tone, 0.86 * tone, 1.0]
        u = 0.0
        # every other point (16 cm), the thick foot at every point (it crosses the plinth's steps)
        every = (3, 5, 6)[depth]
        keep = [i for i in range(len(P3)) if i % every == 0 or i == len(P3) - 1 or th[i] > 0.024]
        P3 = [P3[i] for i in keep]; th = [th[i] for i in keep]
        for i in range(0, len(P3) - 1):
            a, b = P3[i], P3[i + 1]
            if a is None or b is None: continue
            d = b - a; L = np.linalg.norm(d)
            if L < 1e-4: continue
            dn = d / L
            side = np.cross(nrm_out, dn); side /= max(np.linalg.norm(side), 1e-9)
            ra, rb = th[i] / 2, th[i + 1] / 2
            ca, cb = a + nrm_out * (ra * 0.8 + 0.004), b + nrm_out * (rb * 0.8 + 0.004)
            n_seg = 3 if ra > 0.022 else 2 if ra > 0.012 else 1
            ua = (u * 0.5) % 0.6; ub = ua + L * 0.5
            if n_seg == 1:
                v0, v1 = BARK[0] + 0.3 * (BARK[1] - BARK[0]), BARK[0] + 0.6 * (BARK[1] - BARK[0])
                M.quad((a - side * ra + nrm_out * 0.006, np.array([ua, v0]), bc), (b - side * rb + nrm_out * 0.006, np.array([ub, v0]), bc),
                       (b + side * rb + nrm_out * 0.006, np.array([ub, v1]), bc), (a + side * ra + nrm_out * 0.006, np.array([ua, v1]), bc), nrm_out)
            else:
                for k in range(n_seg):
                    a0, a1 = math.pi * k / n_seg, math.pi * (k + 1) / n_seg
                    def ring(c, r, ang): return c + (side * math.cos(ang) + nrm_out * math.sin(ang)) * r
                    def nn(ang): return side * math.cos(ang) + nrm_out * math.sin(ang)
                    v0 = BARK[0] + (BARK[1] - BARK[0]) * k / n_seg; v1 = BARK[0] + (BARK[1] - BARK[0]) * (k + 1) / n_seg
                    M.quadn((ring(ca, ra, a0), np.array([ua, v0]), bc, nn(a0)), (ring(cb, rb, a0), np.array([ub, v0]), bc, nn(a0)),
                            (ring(cb, rb, a1), np.array([ub, v1]), bc, nn(a1)), (ring(ca, ra, a1), np.array([ua, v1]), bc, nn(a1)))
            if sp_ivy and roots and i % 4 == 0 and th[0] > 0.01:
                w = max(ra * 2.6, 0.012)
                rc = np.r_[0.95, 0.95, 0.95, 1.0]
                ua = (u * 0.1) % 0.9; ub = ua + L * 0.4
                b2 = P3[min(i + 3, len(P3) - 1)]
                if b2 is not None:
                    ub = ua + np.linalg.norm(b2 - a) * 0.4
                    M.quad((a - side * w + nrm_out * 0.003, np.array([ua, ROOTS[0]]), rc), (b2 - side * w + nrm_out * 0.003, np.array([ub, ROOTS[0]]), rc),
                           (b2 + side * w + nrm_out * 0.003, np.array([ub, ROOTS[1]]), rc), (a + side * w + nrm_out * 0.003, np.array([ua, ROOTS[1]]), rc), nrm_out)
            u += L

    def leaf_cards(foot, nrm_out, wall_up, heading, sp_ivy, dens, hf, tipness, depth, s, h, tier, flat=1.0):
        """The cards at one stem point: ivy shoots and mats, creeper runners; lying nearly flat on the wall."""
        if sp_ivy:
            n = rng.poisson(dens * IVY_N)
            for _ in range(n):
                tip = tipness < 0.35 or hf > 0.9
                if tip and rng.random() < 0.7: row, col = 1, 3
                elif rng.random() < MAT_P * dens * smooth(0.3, 1.0, tipness) and hf < 0.85: row, col = (0, 3) if rng.random() < 0.65 - 0.3 * hf else (1, 2)
                elif rng.random() < 0.75 - 0.45 * hf: row, col = 0, int(rng.integers(3))
                else: row, col = 1, int(rng.integers(2))
                centred = (row, col) in ((0, 3), (1, 2))
                size = (MAT_M if centred else IVY_M) * rng.uniform(0.88, 1.12) * (1.08 - 0.2 * hf)
                bulge = 0.12 * smooth(0.55, 0.85, noise(s, h, 0.7, seed + 5)) * smooth(0.15, 0.35, hf) * (1 - smooth(0.7, 1.0, hf)) * (depth == 0)
                off = rng.uniform(0.04, 0.1) + bulge * rng.random() + 0.03 * tier
                tilt = math.radians(rng.uniform(3, 16))
                spin = max(min(heading + rng.normal(0, 0.45), 0.9), -0.9)
                card(foot, nrm_out, wall_up, spin, size, off * flat, tilt * flat, lambda a, b, r=row, c=col: cell_uv(r, c, a, b), hf, centred, 1.02 - 0.08 * (row == 0))
        else:
            n = rng.poisson(dens * (CR_N if depth == 0 else CR_N * 0.8))
            for _ in range(n):
                if tipness < 0.4 and rng.random() < 0.6: row, col = 2, 3
                elif rng.random() < CR_DENSE * dens: row, col = (2, 0) if rng.random() < 0.85 - 0.3 * hf else (3, 0)
                else:
                    warm = 0.05 + 0.3 * hf + 0.1 * (depth > 0) + 0.5 * (noise(s, h, 1.4, seed + 21) - 0.5)   # (in patches)
                    if rng.random() < warm: row, col = 3, int(rng.choice(3, p=[0.5, 0.1, 0.4]))
                    else: row, col = 2, int(rng.integers(3))
                size = CREEPER_M * rng.uniform(0.85, 1.12)
                off = rng.uniform(0.03, 0.08) + 0.02 * tier
                tilt = math.radians(rng.uniform(4, 18))
                spin = max(min(heading + rng.normal(0, 0.3), 1.0), -1.0)
                card(foot, nrm_out, wall_up, spin, size, off * flat, tilt * flat, lambda a, b, r=row, c=col: cell_uv(r, c, a, b), hf, False, 1.08)

    def card(foot, nrm_out, wall_up, spin, size, off, tilt, uvf, hf, centred, kbase):
        side0 = np.cross(wall_up, nrm_out)                 # along the wall
        ax = wall_up * math.cos(spin) + side0 * math.sin(spin)
        sd = np.cross(ax, nrm_out); sd /= np.linalg.norm(sd)
        f = foot + sd * rng.normal(0, SPREAD) + ax * rng.normal(0, 0.03) + nrm_out * off
        ax2 = ax * math.cos(tilt) + nrm_out * math.sin(tilt)
        nrm = np.cross(sd, ax2); nrm = nrm if nrm @ nrm_out > 0 else -nrm
        n = nrm * 0.65 + nrm_out * 0.25 + UP * 0.15; n /= np.linalg.norm(n)
        k = tone * rng.uniform(0.86, 1.08) * (kbase + 0.2 * min(hf, 1.0))
        M.card(f, ax2, sd, n, size, uvf, np.r_[k, k, k, 1.0], centred)

    bare = rng.uniform(0.0, 0.15) if rng.random() < (0.8 if ivy else 0.45) else rng.uniform(0.3, 0.8)    # the woody foot, bare of leaves
    for pts, th, depth, sp_ivy, lens in stems:
        P3 = [face.point(s, max(h, -0.03), 0.0) for s, h in pts]
        stem_mesh(P3, th, out, sp_ivy, depth=depth)
        Ltot = lens[-1]
        for i in range(1, len(pts)):
            if P3[i] is None: continue
            s, h = pts[i]
            hf = h / max(H, 0.5)
            tipness = (Ltot - lens[i])
            # thick in the lower and middle run, thinning to ragged tips; holes the size of a few bricks; bare foot
            dens = smooth(bare, bare + 0.5, h) * (1 - 0.45 * smooth(0.72, 1.05, hf)) * smooth(0.0, 0.6, tipness + 0.15)
            if depth > 0: dens *= 1 - 0.25 * smooth(0.0, 1.5, abs(s - root) - 0.3)        # (side branches thinner away from the leaders' run)
            hole = noise(s, h, 0.26, hole_seed); big = noise(s, h, 1.1, hole_seed + 3)
            dens *= smooth(0.24, 0.42, hole) * (0.15 + 0.85 * smooth(0.26, 0.56, big))
            dens *= 1.0 if depth == 0 else 0.95
            # (every leader starts in the bundle at the foot: fewer leaves there, more up the middle of the run, so
            # the colony stands as a column up the wall, not a bush at its foot)
            dens *= (FOOT + (1 - FOOT) * smooth(0.3, 2.2, h)) * (1 + MID * smooth(0.2, 0.45, hf) * (1 - smooth(0.72, 0.95, hf)))
            # strands: bare brick in tall narrow lanes between the stems' mats; the colony's edge eaten away unevenly
            dens *= STRAND + (1 - STRAND) * smooth(0.3, 0.6, noise(s, h * 0.25, 0.32, hole_seed + 11))
            lobe = root + span * 0.7 * (noise(0.0, h, 1.8, hole_seed + 17) - 0.5)
            e = abs(s - lobe) / max(span, 0.5) + 0.6 * (noise(s, h, 0.55, hole_seed + 9) - 0.5)
            dens *= 1 - smooth(EDGE, EDGE + 0.4, e)
            if dens <= 0.02: continue
            hd = pts[min(i + 1, len(pts) - 1)]; hp = pts[i - 1]
            heading = math.atan2(hd[0] - hp[0], hd[1] - hp[1] + 1e-9)
            for tier in range(2 if (dens > TIER and hf < 0.7 if sp_ivy else dens > TIER + 0.1 and hf < 0.6) else 1):
                leaf_cards(P3[i], out, UP, heading, sp_ivy, dens, hf, tipness, depth, s, h, tier)
            if not sp_ivy and rng.random() < 0.15:        # an adhesive tendril flat on the brick
                M.card(P3[i] + out * 0.006 + UP * 0.01, UP, -np.cross(UP, out), out, 0.2, lambda a, b, q=(int(rng.integers(2)), 0): cell_uv(3, 3, a, b, q),
                       np.r_[tone, tone, tone, 1.0], True)
    # over the coping
    for path, sp_ivy in caps:
        P3 = [p for p, _ in path]; N3 = [n for _, n in path]
        th = [max(0.012 * (1 - 0.8 * k / max(len(P3) - 1, 1)), 0.003) for k in range(len(P3))]
        for i in range(len(P3) - 1):
            stem_mesh([P3[i], P3[i + 1]], th[i:i + 2], N3[i], sp_ivy)
        for i in range(1, len(P3)):
            if rng.random() > (0.9 if sp_ivy else 0.5): continue
            n = N3[i]
            wall_up = P3[i] - P3[i - 1]; wall_up -= n * (wall_up @ n); wall_up /= max(np.linalg.norm(wall_up), 1e-9)
            if wall_up @ UP < -0.5: wall_up = -wall_up       # leaves hang their tips down on the far side
            leaf_cards(P3[i], n, wall_up, 0.0, sp_ivy, 0.75, 0.95, 1.0, 1, 0.0, 0.0, 0, flat=0.3 if n[1] > 0.5 else 0.6)
    # at the root: moss in the joint at the wall's foot, fallen leaves on the paving
    fp = face.point(root, 0.05, 0.0, r=2)
    if fp is not None:
        g = fp.copy(); g[1] = base[1] + GROUND + 0.004
        sd = along.copy()
        M.card(g + out * rng.uniform(0.1, 0.16), out, sd, UP, rng.uniform(0.3, 0.45), lambda a, b: cell_uv(3, 3, a, b, (0, 1)), np.r_[tone, tone, tone, 1.0], True)
        for _ in range(int(rng.integers(1, 3)) + (0 if ivy else 1)):
            ang = rng.uniform(0, 2 * math.pi)
            ax = out * math.cos(ang) + along * math.sin(ang); sd2 = np.cross(UP, ax)
            M.card(g + UP * 0.002 + out * rng.uniform(0.15, 0.6) + along * rng.normal(0, 0.5), ax, sd2, UP, rng.uniform(0.25, 0.4),
                   lambda a, b: cell_uv(3, 3, a, b, (1, 1)), np.r_[tone * 0.9, tone * 0.9, tone * 0.9, 1.0], True)
    reached = max((h for pts, *_ in stems for _, h in pts), default=0.0)
    return np.array(M.rows, np.float32), M.cards, H, len(caps), reached


def over_cap(rng, face, s, h, sp_ivy):
    """A leader from the face's top at (s, h) over the coping: up its front, across its top (found by rays down) and
    down its far side (rays from behind), each point on the stone, its normal the stone's; trails 0.3 to 0.8 m."""
    T, base, along, out = face.T, face.base, face.along, face.out
    front = face.point(s, h, 0.0)
    path = [(front + out * 0.008, out)]
    drift = rng.normal(0, 0.25)
    top_y = None; last = None
    for k in range(1, 30):
        q = front - out * (0.04 * k - 0.02) + along * drift * 0.04 * k
        t = first_hits(T, (q + UP * 1.5)[None, :], -UP)[0]
        if not np.isfinite(t): break
        y = q[1] + 1.5 - t
        if top_y is None: top_y = y
        if y < top_y - 0.3: break                          # off the cap's far edge (the walk behind it)
        last = np.array([q[0], y, q[2]])
        path.append((last + UP * 0.008, UP))
    if last is None: return path, sp_ivy
    trail = rng.uniform(0.3, 0.8)
    for k in range(1, 40):
        y = last[1] - 0.06 * k
        if last[1] - y > trail: break
        o = last - out * 1.0; o[1] = y
        o = o + along * drift * 0.02 * k
        t = first_hits(T, o[None, :], out)[0]
        if not np.isfinite(t) or t > 1.2: break
        p = o + out * t
        path.append((p - out * 0.008, -out))
    return path, sp_ivy


def colony_mesh(job):
    """One climbers mesh (a district's cards): its rows and its report."""
    path, rec, dump, near = job
    ninfo = json.load(open(near / 'near.json')); T = np.fromfile(near / 'near.f32', np.float32).reshape(-1, 3, 3).astype(float)
    nodes = np.array([i[0] for i in ninfo])
    wallT = T[np.char.startswith(nodes, 'town_wall/')]
    bmin = wallT.min(1); bmax = wallT.max(1)
    rep = dict(plants=0, cards=0, kinds={}, heights=[], caps=0)
    s0 = rec['surfaces'][0]
    R = np.fromfile(dump / s0['file'], np.float32).reshape(-1, 3, 20).astype(float)
    allrows = []
    for i in range(0, len(R), 2):
        P = np.concatenate([R[i, :, :3], R[i + 1, :, :3]]); U = np.concatenate([R[i, :, 6:8], R[i + 1, :, 6:8]])
        outn = R[i, 0, 3:6].copy(); outn[1] = 0; outn /= np.linalg.norm(outn)
        lo, hi = P[:, 1].min(), P[:, 1].max(); b = P[P[:, 1] < lo + 0.01]
        along = np.cross(UP, outn)
        sx = (b - b.mean(0)) @ along; width = float(np.ptp(sx)); base = b.mean(0); base[1] = lo + 0.25
        kind = int(np.clip(U[:, 0].min() * 4 + 0.01, 0, 3))
        # the wall's faces whose outline reaches the colony's box
        r_ = 4.5
        m = ((bmin[:, [0, 2]] - r_ <= base[[0, 2]]) & (base[[0, 2]] <= bmax[:, [0, 2]] + r_)).all(1) & (bmin[:, 1] < 10)
        seed = int(hashlib.sha256(f'{base[0]:.2f},{base[2]:.2f}'.encode()).hexdigest()[:8], 16)
        face = Face(wallT[m], base, along, outn)
        rng = np.random.default_rng(seed)
        # (Codex on #231: the colonies stood at the bake's even spacing, one at each of its cards, alike in width, a row
        # of planted shrubs) each place its own dice, apart from the plant's: one in five left bare brick, the others
        # rooted up to 1.5 m along the joint from the card's middle, some narrow, some spread wide
        place = np.random.default_rng(seed ^ 0x51DE)
        if place.random() < SKIP:
            rep['bare'] = rep.get('bare', 0) + 1
            continue
        shift = float(np.clip(place.normal(0, 0.75), -1.5, 1.5))
        spread = float(place.choice([0.55, 0.8, 1.0, 1.25, 1.6], p=[0.18, 0.24, 0.26, 0.2, 0.12]))
        rows, cards, H, caps, reached = grow(rng, base, along, outn, width, kind, face, seed, shift=shift, spread=spread)
        rep['heights'].append(round(reached, 2)); rep['caps'] += caps
        allrows.append(rows)
        # now and then a young plant beside the colony, rooted in a joint of its own
        if rng.random() < 0.3:
            side = shift + rng.choice([-1, 1]) * rng.uniform(1.8, 2.6) * max(spread, 0.8)
            kind2 = kind if rng.random() < 0.6 else (2 if kind in (0, 1) else 0)
            rows2, cards2, *_ = grow(rng, base, along, outn, width, kind2, face, seed + 1, shift=side, recruit=True)
            if len(rows2): allrows.append(rows2); cards += cards2; rep['recruits'] = rep.get('recruits', 0) + 1
        rep['plants'] += 1; rep['cards'] += cards; rep['kinds'][str(kind)] = rep['kinds'].get(str(kind), 0) + 1
    return path, rec, np.concatenate([a for a in allrows if len(a)]), len(R), rep


def main():
    from multiprocessing import Pool
    dump, near, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(dump / 'meshes.json'))
    only = sys.argv[4] if len(sys.argv) > 4 else None
    jobs = [(path, rec, dump, near) for path, rec in sorted(info.items()) if not only or only in path]
    manifest = []; report = dict(meshes=0, plants=0, cards=0, triangles=0, oldTriangles=0, kinds={}, heights=[], caps=0)
    with Pool(min(len(jobs), 7)) as pool:
        for path, rec, A, old, rep in pool.imap(colony_mesh, jobs):
            stem = pathlib.Path(rec['mesh']).stem
            A.tofile(out / f'{stem}-0.f32')
            manifest.append({'mesh': rec['mesh'], 'nodePath': path,
                             'sourceHash': hashlib.sha256((REPO / 'native-godot' / rec['mesh'][6:]).read_bytes()).hexdigest(),
                             'surfaces': [{'index': 0, 'file': f'{stem}-0.f32', 'material': MAT, 'custom0': True, 'custom0Rgba': True, 'tangent': True}]})
            report['meshes'] += 1; report['triangles'] += len(A) // 3; report['oldTriangles'] += old
            for k in ('plants', 'cards', 'caps'): report[k] += rep[k]
            report['recruits'] = report.get('recruits', 0) + rep.get('recruits', 0)
            report['heights'] += rep['heights']
            for k, v in rep['kinds'].items(): report['kinds'][k] = report['kinds'].get(k, 0) + v
            print(path, len(A) // 3, flush=True)
    report['heights'].sort()
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print({k: v for k, v in report.items() if k != 'heights'}, 'median height', float(np.median(report['heights'])))

if __name__ == '__main__':
    main()
