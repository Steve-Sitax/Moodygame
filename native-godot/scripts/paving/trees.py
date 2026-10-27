"""The town's trees grown again (Steve, 2026-10-27: make the trees look better, some are still ugly).
    python trees.py <out folder>
The bake's trees were a few hundred faces each: thick, pale stick limbs and crowns of 0.6 to 1.5 m cards cut from a
256 x 128 pixel-art picture, so a crown read as a few flat blobs with sky between. Each kind is grown here as one
model (every copy in town and on the squares shares it), in the tree's own frame (y up, its foot at 0):
- lime (Tilia x europaea): a central leader to the top, many side branches rising 45 to 60 degrees, short at the
  top, so a tall dome; dark ridged bark;
- plane (Platanus x hispanica): the trunk parts at about 3 m into three or four great limbs leaning out, a broad
  round crown; the flaking bark (the atlas's right half);
- elm (Ulmus minor): four or five limbs rise steep and arch out, a vase;
- bare: the same build as a lime but grown longer and finer, its leaves down: a fan of dark twigs.
Bark: tapered tubes along each branch (trunk 14 sides down to 3 on the last twigs), a flared foot with root
buttresses sunk 25 cm into the ground (no tree floats where the ground dips a little), UVs at true size round and
along (no stretching), the bark darker toward the twigs. Leaves: sprig cards from make_leaf_atlas.py at the last
two orders of branches, facing out of the crown, normals bent out of the crown so it shades as a whole; darker inside
and low down. Collision (solid.json): a 10-sided trunk to 2.6 m, as the trunks were solid before.
(2026-10-27, round 2: crowns with irregular openings and more varied sprays, lime leaves at 4 to 8 cm, branch collars,
rounder bark (14 / 8 / 5 sides), rounded root lobes; each of a kind's meshes its own tree: <kind>-v<n>.)
Writes <kind>-v<n>-bark.f32 / <kind>-v<n>-leaves.f32 (12 floats a corner: position, normal, uv, colour, three a triangle), the
same welded for the game as <kind>-bark.vtx / .idx (16 floats a vertex: position, normal, tangent, uv, colour; int32
indices), <kind>-solid.f32 (the collision trunk's corners) and report.json. Fixed seeds: the same trees every run.
"""
import sys, json, math, pathlib
import numpy as np

# the bark atlas (plan84 9-bark_atlas): left half rough dark bark, right half the plane's flaking bark; one half
# is 512 px round, and that is AROUND metres of bark; the picture repeats along v
AROUND = 0.9
LEAF_ROW = {'lime': 0, 'plane': 1, 'elm': 2, 'bare': 3}

SPEC = {
    # height: the crown's top; split: where the trunk parts or its leader starts branching; r0: trunk radius at
    # breast height; reach: crown half width; card: sprig card size (m); order: branch orders
    'lime':  dict(seed=11, height=9.2, split=2.7, r0=0.2, reach=3.1, card=(0.55, 0.85), cards=1500, bark_u=0.0),
    'plane': dict(seed=23, height=9.8, split=3.3, r0=0.23, reach=3.7, card=(0.65, 0.95), cards=950, bark_u=0.5),
    'elm':   dict(seed=37, height=10.2, split=3.3, r0=0.22, reach=4.0, card=(0.55, 0.8), cards=1500, bark_u=0.0),
    'bare':  dict(seed=51, height=9.4, split=2.8, r0=0.2, reach=3.4, card=(0.8, 1.15), cards=650, bark_u=0.0),
}


def norm(v):
    return v / max(np.linalg.norm(v), 1e-9)


def perp(d):
    a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 0, 1.0])
    u = norm(np.cross(d, a)); return u, np.cross(d, u)


# (round 2, 2026-10-27) each kind's two or three meshes are their own trees: height, crown width and how many leaves
# it still holds (its retention) differ, and each its own seed
VARIANTS = {'lime': 3, 'plane': 2, 'elm': 2, 'bare': 1}
VARY = [dict(height=1.0, reach=1.0, cards=1.0), dict(height=0.9, reach=1.1, cards=0.8), dict(height=1.07, reach=0.88, cards=1.12)]


class Tree:
    def __init__(self, kind, variant=0):
        self.kind = kind; self.s = dict(SPEC[kind]); vr = VARY[variant]
        self.s['seed'] += 101 * variant
        self.s['height'] = self.s['split'] + (self.s['height'] - self.s['split']) * vr['height']
        self.s['reach'] *= vr['reach']; self.s['cards'] = int(self.s['cards'] * vr['cards'])
        self.rng = np.random.default_rng(self.s['seed'])
        self.branches = []      # (points [n,3], radii [n], order)
        self.tips = []          # (point, direction, order) where sprigs go

    # -- the skeleton ---------------------------------------------------------------------------------------------
    def walk(self, p, d, length, r0, r1, order, bend_up=0.0, gravity=0.0, wobble=0.12, step=None):
        rng = self.rng
        step = step or max(0.12 + 0.06 * order, length / (8 if order <= 1 else 3 if order == 2 else 2))
        n = max(2, int(math.ceil(length / step)))
        pts = [p]; d = norm(d)
        # (each branch keeps its heading round the trunk: the wobble bends it, the heading pulls it back)
        head = np.array([d[0], 0, d[2]]); head = head / max(np.linalg.norm(head), 1e-9) * math.hypot(d[0], d[2])
        for i in range(n):
            t = i / n
            hd = np.array([d[0], 0, d[2]])
            d = norm(d + rng.normal(0, wobble, 3) * np.array([1, 0.4, 1]) + np.array([0, bend_up * (1 - t) - gravity * t, 0])
                     + (head - hd) * 0.25)
            pts.append(pts[-1] + d * (length / n))
        pts = np.array(pts)
        radii = r0 + (r1 - r0) * np.linspace(0, 1, len(pts)) ** 0.8
        if order >= 1:
            # (the branch collar: its foot swells and curves into the parent, no abrupt step)
            L = np.cumsum(np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)])
            radii = radii * (1 + 0.45 * np.exp(-L / (0.12 + 2.5 * r0)))
        self.branches.append((pts, radii, order))
        return pts, radii

    def crown_ok(self, q):
        """Inside the kind's crown envelope (a loose one: the branches decide the outline)."""
        s = self.s; h = q[1]; rxz = math.hypot(q[0], q[2])
        if self.kind == 'elm':
            # a vase: narrow low, widest near the top
            t = np.clip((h - s['split']) / (s['height'] - s['split']), 0, 1)
            lim = s['reach'] * (0.45 + 0.6 * math.sin(math.pi * 0.62 * t + 0.25))
        elif self.kind == 'plane':
            t = np.clip((h - s['split'] + 0.5) / (s['height'] - s['split'] + 0.5), 0, 1)
            lim = s['reach'] * math.sin(math.pi * min(1, 0.15 + 0.95 * t)) ** 0.6
        else:
            t = np.clip((h - s['split'] + 0.3) / (s['height'] - s['split'] + 0.3), 0, 1)
            lim = s['reach'] * math.sin(math.pi * min(1, 0.12 + 0.92 * t)) ** 0.75
        return rxz < lim * 1.08 and h < s['height'] * 1.03

    def sub(self, pts, radii, order, max_order, spacing, angle, length_k, up=0.15, droop=0.0):
        """Side branches along a branch: alternate/spiral, each shorter higher up the parent."""
        rng = self.rng
        L = np.cumsum(np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)]); total = L[-1]
        if total < 0.2: return
        phi = rng.uniform(0, 6.28)
        at = rng.uniform(0.2, 0.6) * spacing + (0.18 * total if order <= 1 else 0.05 * total)
        while at < total * 0.96:
            i = int(np.searchsorted(L, at)); i = min(max(i, 1), len(pts) - 1)
            p = pts[i]; d = norm(pts[i] - pts[i - 1]); u, v = perp(d)
            phi += 2.4 + rng.normal(0, 0.3)           # (the golden angle, round the parent)
            a = math.radians(angle + rng.normal(0, 8))
            side = norm(u * math.cos(phi) + v * math.sin(phi))
            nd = norm(d * math.cos(a) + side * math.sin(a) + np.array([0, up, 0]))
            rem = 1 - at / total
            ln = (0.35 + 0.65 * rem) * length_k * total * rng.uniform(0.75, 1.15)
            if order == 1 and self.kind in ('lime', 'bare'):
                # (the leader's laterals: long low, short high: a dome)
                ln = length_k * self.s['reach'] * (0.55 + 0.6 * math.sin(math.pi * min(1, 0.25 + 0.8 * rem))) * rng.uniform(0.85, 1.1)
            r_here = radii[i]
            r0 = max(0.006, r_here * rng.uniform(0.5, 0.7))
            # (a branch that would leave the crown is shortened into it; one that cannot reach in is left out)
            for _ in range(6):
                if self.crown_ok(p + nd * ln): break
                ln *= 0.8
            if self.crown_ok(p + nd * ln) and ln > 0.15:
                bpts, bradii = self.walk(p - nd * r_here * 0.6, nd, ln, r0, max(0.004, r0 * 0.18), order + 1, bend_up=up * 0.6,
                                         gravity=droop * (1 + 0.3 * order), wobble=0.1 + 0.04 * order)
                if order + 1 < max_order:
                    self.sub(bpts, bradii, order + 1, max_order, spacing * 0.55, angle * 0.95, length_k * 0.62, up * 0.7, droop)
                else:
                    self.tips.append((bpts, order + 1))
            at += spacing * rng.uniform(0.7, 1.3)
        self.tips.append((pts, order))

    def grow(self):
        s = self.s; rng = self.rng; k = self.kind
        # the trunk: from below the ground up to the split, leaning a little
        lean = norm(np.array([rng.normal(0, 0.04), 1, rng.normal(0, 0.04)]))
        top = s['height'] - 0.6 if k in ('lime', 'bare') else s['split']
        tpts, tr = self.walk(np.array([0, -0.25, 0.0]), lean, top + 0.25, s['r0'] * 1.05,
                             s['r0'] * (0.22 if k in ('lime', 'bare') else 0.75), 0, wobble=0.025, step=0.25)
        if k in ('lime', 'bare'):
            # the leader carries the laterals from the split up
            L = np.cumsum(np.r_[0, np.linalg.norm(np.diff(tpts, axis=0), axis=1)])
            j = int(np.searchsorted(L, s['split'] + 0.25))
            self.sub(tpts[j - 1:], tr[j - 1:], 0, 4, spacing=0.42 if k == 'lime' else 0.5, angle=58 if k == 'lime' else 52,
                     length_k=0.95 if k == 'lime' else 1.05, up=0.12, droop=0.05 if k == 'lime' else 0.02)
        else:
            # the great limbs from the split
            n = 4 if k == 'plane' else 5
            phi0 = rng.uniform(0, 6.28)
            for i in range(n):
                phi = phi0 + i * 6.283 / n + rng.normal(0, 0.25)
                tilt = math.radians((38 if k == 'plane' else 24) + rng.normal(0, 7))
                d = np.array([math.sin(tilt) * math.cos(phi), math.cos(tilt), math.sin(tilt) * math.sin(phi)])
                ln = (s['height'] - s['split']) * rng.uniform(0.7, 0.85) / math.cos(tilt) * (0.95 if k == 'plane' else 1.0)
                bend = -0.02 if k == 'plane' else -0.06    # (the elm's limbs arch out as they rise)
                start = tpts[-2] + (tpts[-1] - tpts[-2]) * rng.uniform(0.2, 1.0)
                for _ in range(6):
                    if self.crown_ok(start + d * ln * 0.92): break
                    ln *= 0.88
                lp, lr = self.walk(start, d, ln, tr[-1] * rng.uniform(0.6, 0.72), 0.03, 1, bend_up=bend, wobble=0.07, step=0.3)
                self.sub(lp, lr, 1, 4, spacing=0.36 if k == 'plane' else 0.32, angle=48 if k == 'plane' else 42,
                         length_k=0.55 if k == 'plane' else 0.5, up=0.1, droop=0.08 if k == 'plane' else 0.12)

    # -- the meshes -----------------------------------------------------------------------------------------------
    def bark(self):
        s = self.s; rows = []
        u0 = s['bark_u']
        for pts, radii, order in self.branches:
            # (the finest twigs are drawn in the sprig cards: only the trunk, limbs and branches are tubes)
            if order >= 3: continue
            sides = [14, 8, 5][order]
            if order == 0:
                # the trunk: rings close at the foot (its flare), farther apart above
                keep = [0] + [i for i in range(1, len(pts) - 1) if pts[i][1] < 1.2 or i % 2 == 0] + [len(pts) - 1]
                pts, radii = pts[keep], radii[keep]
            if radii[0] < 0.012: sides = 4
            # ring frames (parallel transport, no twist)
            d0 = norm(pts[1] - pts[0]); u, v = perp(d0)
            frames = []
            for i in range(len(pts)):
                d = norm(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
                u = norm(u - d * (u @ d)); v = np.cross(d, u); frames.append((u, v, d))
            Lacc = np.cumsum(np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)])
            circ = 2 * math.pi * max(radii[0], 0.01)
            span = min(0.49, 0.49 * circ / AROUND)      # the u width round this branch (true size, under a half)
            vk = 0.49 / AROUND * 0.5 * 2                 # v per metre at the same texel size (the picture is 2 halves wide, 1 tall)
            ring = []
            for i, p in enumerate(pts):
                r = radii[i]
                uu, vv, dd = frames[i]
                corners = []
                for j in range(sides + 1):
                    a = 2 * math.pi * j / sides
                    rr_ = r
                    if order == 0 and p[1] < 0.9:
                        # the flared foot and its buttress roots
                        # (rounded lobes that run into the ground, no pointed skirts)
                        f = max(0.0, 0.9 - max(p[1], 0)) / 0.9
                        f = f * f * (3 - 2 * f)
                        lobe = (0.5 + 0.5 * math.cos(5 * a + 0.7)) ** 1.6
                        rr_ = r * (1 + 0.42 * f ** 1.5 + 0.2 * f ** 1.3 * lobe)
                    nrm = uu * math.cos(a) + vv * math.sin(a)
                    q = p + nrm * rr_
                    # darker toward the twigs and in the crown's shade; a little moss low on the trunk's north
                    shade_k = (0.82 if order == 0 else 0.74 if order == 1 else 0.64 if order == 2 else 0.56)
                    col = np.array([shade_k, shade_k * 0.97, shade_k * 0.93, 1.0])
                    if self.kind == 'plane': col[:3] *= 0.92 if order <= 1 else 0.78
                    corners.append((q, nrm, np.array([u0 + 0.004 + span * j / sides, -Lacc[i] * vk]), col))
                ring.append(corners)
            for i in range(len(ring) - 1):
                for j in range(sides):
                    a, b, c, d_ = ring[i][j], ring[i][j + 1], ring[i + 1][j + 1], ring[i + 1][j]
                    for tri in ((a, b, c), (a, c, d_)):
                        for q, n, uv, col in tri:
                            rows.append(np.concatenate([q, n, uv, col]))
            # a cap on a twig's end (none seen; branches end thin)
        return np.array(rows, np.float32)

    def leaves(self):
        s = self.s; rng = self.rng; rows = []; k = self.kind
        row = LEAF_ROW[k]
        centre = np.array([0, (s['split'] + s['height']) / 2 + (0.8 if k == 'elm' else 0), 0])
        half = np.array([s['reach'], (s['height'] - s['split']) / 2, s['reach']])
        # candidate places: along the last two orders' branches, more at their ends
        places = []
        for pts, order in self.tips:
            if order < 2 and k != 'bare': continue
            L = np.cumsum(np.r_[0, np.linalg.norm(np.diff(pts, axis=0), axis=1)])
            if L[-1] < 0.05: continue
            n = max(1, int(L[-1] / (0.2 if order >= 3 else 0.3)))
            for t in np.linspace(0.35, 1.0, n):
                i = min(int(np.searchsorted(L, t * L[-1])), len(pts) - 1)
                d = norm(pts[i] - pts[max(i - 1, 0)])
                places.append((pts[i], d, order))
        rng.shuffle(places)
        # (irregular openings: patches of the crown hold fewer sprigs, so sky and inner branches show)
        ph = rng.uniform(0, 6.3, 3)
        def gap(q):
            return (math.sin(q[0] * 1.7 + ph[0]) + math.sin(q[1] * 1.9 + q[2] * 0.6 + ph[1]) + math.sin(q[2] * 1.6 - q[0] * 0.5 + ph[2])) / 3
        places = [pl for pl in places if gap(pl[0]) > -0.38 or rng.random() < 0.25]
        places = places[:s['cards']]
        for p, d, order in places:
            # the sprig points out along its twig, out of the crown and a little up
            out = norm((p - centre) / half)
            ax = norm(d * 0.55 + out * 0.5 + np.array([0, rng.uniform(-0.25, 0.45), 0]) + rng.normal(0, 0.42, 3))
            side = norm(np.cross(ax, out + rng.normal(0, 0.75, 3)))
            nrm = norm(np.cross(side, ax))
            if nrm @ out < 0: side = -side; nrm = -nrm          # (its front faces out of the crown)
            size = rng.uniform(*s['card'])
            foot = p - ax * size * 0.06
            col_cell = int(rng.integers(4))
            if k == 'bare': col_cell = int(rng.choice([0, 1, 2, 3], p=[0.12, 0.12, 0.38, 0.38]))
            # shade: darker inside the crown and low in it; the sun side lighter
            depth = np.linalg.norm((p - centre) / half)
            ao = np.clip(0.42 + 0.62 * depth, 0.45, 1.05) * (0.82 + 0.18 * np.clip((p[1] - s['split']) / (s['height'] - s['split']), 0, 1))
            tone = ao * rng.uniform(0.9, 1.08)
            # the crown turns unevenly: the sunny top and outside further on (warmer), the inside still greener,
            # in patches a metre or two across
            warm = np.clip(0.45 + 0.35 * out[1] + 0.25 * (depth - 0.7) + 0.3 * math.sin(p[0] * 1.3 + p[2] * 0.9) * math.cos(p[1] * 1.1 - p[0] * 0.7)
                           + rng.normal(0, 0.18), 0, 1)
            olive = max(0.0, 0.6 - depth) * 0.5 + (0.25 if rng.random() < 0.18 else 0.0)     # (inner and some sprays still olive)
            col = np.array([tone * (0.94 + 0.14 * warm - 0.1 * olive), tone * (1.02 - 0.06 * warm), tone * (1.04 - 0.24 * warm - 0.08 * olive), 1.0])
            # normals bent out of the crown, so the crown shades as one mass
            n_v = norm(nrm * 0.45 + out * 0.9)
            def uv(sx, ty):
                return np.array([(col_cell + sx) * 0.25, (row + (1 - ty) * 0.985) * 0.25])
            P = lambda sx, ty: foot + side * (sx - 0.5) * size + ax * ty * size
            quad = [(P(0, 0), uv(0, 0)), (P(1, 0), uv(1, 0)), (P(1, 1), uv(1, 1)), (P(0, 1), uv(0, 1))]
            for tri in ((0, 1, 2), (0, 2, 3)):
                for vi in tri:
                    q, t = quad[vi]
                    rows.append(np.concatenate([q, n_v, t, col]))
        return np.array(rows, np.float32)

    def solid(self):
        """A plain 10-sided trunk from under the ground to 2.6 m: what a walker can bump into."""
        s = self.s; rows = []
        pts = self.branches[0][0]; radii = self.branches[0][1]
        def at(h):
            i = min(int(np.searchsorted(pts[:, 1], h)), len(pts) - 1)
            return pts[i], radii[i]
        rings = []
        for h in (-0.25, 0.0, 0.5, 1.2, 2.6):
            p, r = at(h); r = r * (1.25 if h <= 0.0 else 1.0)
            rings.append([p + np.array([math.cos(a) * r, 0, math.sin(a) * r]) for a in np.linspace(0, 2 * math.pi, 11)[:-1]])
        for i in range(len(rings) - 1):
            for j in range(10):
                a, b, c, d_ = rings[i][j], rings[i][(j + 1) % 10], rings[i + 1][(j + 1) % 10], rings[i + 1][j]
                rows += [a, c, b, a, d_, c]
        top = rings[-1]; mid = sum(top) / 10
        for j in range(10): rows += [mid, top[j], top[(j + 1) % 10]]
        return np.array(rows, np.float32)


def weld(rows):
    """Triangle corners (12 floats) to shared vertices with tangents (16 floats) and indices."""
    tri = rows.reshape(-1, 3, 12)
    # a tangent per triangle along its u (the uv's derivative), averaged where the corners are shared
    p0, p1, p2 = tri[:, 0, :3], tri[:, 1, :3], tri[:, 2, :3]
    t0, t1, t2 = tri[:, 0, 6:8], tri[:, 1, 6:8], tri[:, 2, 6:8]
    e1, e2 = p1 - p0, p2 - p0; d1, d2 = t1 - t0, t2 - t0
    r = d1[:, 0] * d2[:, 1] - d2[:, 0] * d1[:, 1]
    r = np.where(np.abs(r) < 1e-12, 1e-12, r)
    tg = (e1 * d2[:, 1:2] - e2 * d1[:, 1:2]) / r[:, None]
    flat = tri.reshape(-1, 12)
    key = np.round(flat, 5)
    _, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inverse = inverse.reshape(-1)
    acc = np.zeros((len(first), 3)); np.add.at(acc, inverse, np.repeat(tg, 3, axis=0))
    v = flat[first]
    n = v[:, 3:6]
    t = acc - n * (acc * n).sum(1, keepdims=True)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    bad = np.linalg.norm(t, axis=1) < 0.5
    t[bad] = np.cross(n[bad], np.array([0, 1.0, 0]) + 1e-3)
    t /= np.maximum(np.linalg.norm(t, axis=1, keepdims=True), 1e-9)
    out = np.concatenate([v[:, :6], t, np.ones((len(v), 1)), v[:, 6:12]], 1).astype(np.float32)
    return out, inverse.astype(np.int32)


def main():
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    kinds = sys.argv[2].split(',') if len(sys.argv) > 2 else list(SPEC)
    report = {}
    for k0 in kinds:
      for vi in range(VARIANTS[k0]):
        t = Tree(k0, vi); t.grow(); k = f'{k0}-v{vi}'
        b = t.bark(); l = t.leaves(); sd = t.solid()
        b.tofile(out / f'{k}-bark.f32'); l.tofile(out / f'{k}-leaves.f32'); sd.tofile(out / f'{k}-solid.f32')
        for part, rows in (('bark', b), ('leaves', l)):
            v, ix = weld(rows); v.tofile(out / f'{k}-{part}.vtx'); ix.tofile(out / f'{k}-{part}.idx')
        allp = np.concatenate([b[:, :3], l[:, :3]])
        report[k] = dict(barkTriangles=len(b) // 3, leafCards=len(l) // 6, solidTriangles=len(sd) // 3, branches=len(t.branches),
                         box=[allp.min(0).round(2).tolist(), allp.max(0).round(2).tolist()])
        print(k, report[k])
    (out / 'report.json').write_text(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
