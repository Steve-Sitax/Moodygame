"""The church vaults' webs rebuilt smooth (#227: Sint-Paulus' and Sint-Jacob's vaults in steps and teeth, the cathedral's rough).
    python vault_webs.py <church-shell-dump file> <out.json> <node>[,<node>...] [<exterior dump> <prefix>]
The bake drew every vault web as a height grid over the plan (cells 0.6 to 1.2 m) and cut each grid cell into two
triangles on one diagonal. Each block of the grid is a groin vault: its height is max(A(z), B(x)), two pointed barrels
crossing (A across the nave, B along it; each a run of circle arcs springing from the piers and walls). The groins,
where the barrels meet, run across the cells, so linear cells cut their corners: the steps and teeth along every rib,
and in places a web cell turned to the light at the wrong angle (dark wedges).
Here each block is rebuilt from its own two profiles:
- each profile's monotone runs (springer to crown) are fitted with a circle arc (residual under 12 mm, else a monotone
  cubic through the samples), refined to 8 degrees or 0.8 m a step (the normals carry the curve between); the original
  samples stay exactly where they were (the correction between them is spread linearly), so the ribs and the walls
  still meet the web where they met it;
- every refined cell is cut along its own groin (where A = B) into the part that belongs to A (its height depends on z
  only) and the part that belongs to B (on x only): the groin is an edge, both sides exact; whole runs of cells on one
  barrel are merged into long strips (the height is constant along them);
- where two blocks meet with different breaks (and along the strips' long edges) every open edge takes the corners of
  its neighbour that lie on it, so both sides run through the same points: no crack;
- normals from the arcs' slopes (smooth along each barrel, sharp at the groin); uv along the barrel's axis and its
  arc length at the bake's 0.333 a metre; vertex colour the block's own.
With an exterior dump and a node prefix (church_stpaul_), no web point rises within 5 cm of an outside face that looks
down over it (Sint-Paulus' aisle roof dips 0.44 m into the first aisle bay by the transept: from the nave its dark
underside read as a black wedge under the arcade's arch); there the web follows that face.
Blocks that are not a full rectangle, not one height a point, or not two crossing barrels (to 15 mm) are left as
drawn. Writes the triangles to remove (by index) and the new ones in world space for VaultWebRepair.cs.
"""
import sys, json, math
import numpy as np
from scipy.interpolate import PchipInterpolator

K_UV = 1.0 / 3.0
STEP_DEG, STEP_LEN, FIT_TOL, SEP_TOL = 8.0, 0.8, 0.012, 0.015


def load(path, nodes):
    out = {}
    cur = None
    for line in open(path):
        f = line.rstrip('\n').split('\t')
        if f[0] == 'S':
            cur = f[1] if f[1] in nodes else None
            if cur is not None:
                out[cur] = dict(node=f[1], res=f[2], surface=int(f[3]), mat=f[4], idx=[], rows=[])
            continue
        if cur is None:
            continue
        out[cur]['idx'].append(int(f[1]))
        out[cur]['rows'].append([float(x) for k in (2, 3, 4) for x in f[k].split(',')])
    for c in out.values():
        a = np.array(c.pop('rows')).reshape(-1, 3, 12)
        c['idx'] = np.array(c['idx'])
        c['P'] = a[:, :, 0:3]
        c['RGBA'] = np.concatenate([a[:, :, 9:12], a[:, :, 8:9]], axis=2)
    return out


# ------------------------------------------------------------------ the blocks

def blocks(P):
    """Cells (axis-aligned plan rectangles, two triangles each) grouped into blocks of identical spacing that touch edge to edge."""
    q = np.round(P / 0.001).astype(np.int64)
    cells = {}
    for t in range(len(P)):
        xs, zs = q[t, :, 0], q[t, :, 2]
        key = (xs.min(), xs.max(), zs.min(), zs.max())
        if key[0] == key[1] or key[2] == key[3]:
            continue
        corners = {(x, z) for x, z in zip(xs, zs)}
        if not corners <= {(key[0], key[2]), (key[1], key[2]), (key[0], key[3]), (key[1], key[3])} or len(corners) != 3:
            continue
        cells.setdefault(key, []).append(t)
    cells = {k: v for k, v in cells.items() if len(v) == 2}
    # adjacency: a full shared edge
    by_x0, by_z0 = {}, {}
    for k in cells:
        by_x0.setdefault((k[0], k[2], k[3]), []).append(k)
        by_z0.setdefault((k[2], k[0], k[1]), []).append(k)
    parent = {k: k for k in cells}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for k in cells:
        for n in by_x0.get((k[1], k[2], k[3]), []) + by_z0.get((k[3], k[0], k[1]), []):
            parent[find(n)] = find(k)
    groups = {}
    for k in cells:
        groups.setdefault(find(k), []).append(k)
    out = []
    for ks in groups.values():
        xs = sorted({k[0] for k in ks} | {k[1] for k in ks})
        zs = sorted({k[2] for k in ks} | {k[3] for k in ks})
        full = len(ks) == (len(xs) - 1) * (len(zs) - 1) and all(
            xs.index(k[1]) == xs.index(k[0]) + 1 and zs.index(k[3]) == zs.index(k[2]) + 1 for k in ks)
        out.append(dict(cells=ks, tris=[t for k in ks for t in cells[k]], xs=np.array(xs) * 0.001, zs=np.array(zs) * 0.001, full=full))
    return out


def heights(P, b):
    """The block's height grid G[z][x] from its triangles' corners; None when a corner has two heights."""
    xs, zs = b['xs'], b['zs']
    G = np.full((len(zs), len(xs)), np.nan)
    for t in b['tris']:
        for p in P[t]:
            i = int(np.argmin(np.abs(xs - p[0])))
            j = int(np.argmin(np.abs(zs - p[2])))
            if not np.isnan(G[j, i]) and abs(G[j, i] - p[1]) > 0.01:
                return None
            G[j, i] = p[1] if np.isnan(G[j, i]) else G[j, i]
    return None if np.isnan(G).any() else G


# ------------------------------------------------------------------ the profiles

def circle_fit(t, y):
    A = np.c_[t, y, np.ones_like(t)]
    sol, *_ = np.linalg.lstsq(A, -(t * t + y * y), rcond=None)
    cx, cy = -sol[0] / 2, -sol[1] / 2
    r2 = cx * cx + cy * cy - sol[2]
    if r2 <= 0:
        return None
    r = math.sqrt(r2)
    s = 1.0 if np.mean(y - cy) >= 0 else -1.0
    if np.any(np.abs(t - cx) > r * (1 + 1e-6)):
        return None
    fit = cy + s * np.sqrt(np.maximum(r * r - (t - cx) ** 2, 0))
    if np.max(np.abs(fit - y)) > FIT_TOL:
        return None
    return cx, cy, r, s


class Profile:
    """A barrel's height along one axis: runs of circle arcs through the bake's samples, refined."""

    def __init__(self, ts, gs):
        self.ts, self.gs = np.asarray(ts, float), np.asarray(gs, float)
        n = len(ts)
        cuts = [0]
        for i in range(1, n - 1):
            if (gs[i] - gs[i - 1]) * (gs[i + 1] - gs[i]) <= 0:
                cuts.append(i)
        cuts.append(n - 1)
        self.runs = []
        for a, b in zip(cuts[:-1], cuts[1:]):
            fit = circle_fit(self.ts[a:b + 1], self.gs[a:b + 1]) if b - a >= 2 else None
            if fit is None and b - a >= 2:
                # not one arc: a monotone cubic through the samples (no overshoot), still smooth
                fit = ('pchip', PchipInterpolator(self.ts[a:b + 1], self.gs[a:b + 1]))
            self.runs.append((a, b, fit))
        bt, by, bd = [], [], []
        for a, b, fit in self.runs:
            for i in range(a, b):
                t0, t1 = self.ts[i], self.ts[i + 1]
                if fit is None:
                    m = 1
                elif fit[0] == 'pchip':
                    d0, d1 = self.arc(fit, t0)[1], self.arc(fit, t1)[1]
                    turn = abs(math.atan(d1) - math.atan(d0))
                    m = max(1, int(math.ceil(max(turn / math.radians(STEP_DEG), (t1 - t0) / STEP_LEN))))
                else:
                    cx, cy, r, s = fit
                    a0 = math.acos(max(-1, min(1, (t0 - cx) / r)))
                    a1 = math.acos(max(-1, min(1, (t1 - cx) / r)))
                    m = max(1, int(math.ceil(max(abs(a1 - a0) / math.radians(STEP_DEG), (t1 - t0) / STEP_LEN))))
                for k in range(m):
                    u = k / m
                    t = t0 + (t1 - t0) * u
                    if fit is None:
                        y, d = self.gs[i] + (self.gs[i + 1] - self.gs[i]) * u, (self.gs[i + 1] - self.gs[i]) / (t1 - t0)
                    else:
                        y, d = self.arc(fit, t)
                        e0 = self.gs[i] - self.arc(fit, t0)[0]
                        e1 = self.gs[i + 1] - self.arc(fit, t1)[0]
                        y += e0 + (e1 - e0) * u
                    if bt and abs(bt[-1] - t) < 1e-6:
                        continue
                    bt.append(t); by.append(y); bd.append(d)
        last = self.runs[-1][2]
        bt.append(self.ts[-1]); by.append(self.gs[-1])
        bd.append(self.arc(last, self.ts[-1])[1] if last else (self.gs[-1] - self.gs[-2]) / (self.ts[-1] - self.ts[-2]))
        self.bt, self.by, self.bd = np.array(bt), np.array(by), np.array(bd)
        # the slope at a crown or a springer: the two runs' own, averaged at a smooth crown, kept apart at a cusp
        self.cusp = set()
        for (a, b, f1), (c, d, f2) in zip(self.runs[:-1], self.runs[1:]):
            if f1 and f2:
                s1, s2 = self.arc(f1, self.ts[b])[1], self.arc(f2, self.ts[b])[1]
                if s1 * s2 < 0 and abs(s1 - s2) > 0.6:
                    self.cusp.add(int(np.argmin(np.abs(self.bt - self.ts[b]))))
        # cumulative arc length (the uv's v)
        seg = np.sqrt(np.diff(self.bt) ** 2 + np.diff(self.by) ** 2)
        self.bs = np.r_[0, np.cumsum(seg)]

    @staticmethod
    def arc(fit, t):
        if fit[0] == 'pchip':
            f = fit[1]
            return float(f(t)), max(-40.0, min(40.0, float(f(t, 1))))
        cx, cy, r, s = fit
        h = math.sqrt(max(r * r - (t - cx) ** 2, 1e-9))
        y = cy + s * h
        d = -s * (t - cx) / max(h, 0.05 * r)
        return y, max(-40.0, min(40.0, d))

    def slope(self, k, side):
        """the slope at break k, from the left (side -1) or right (+1) segment at a cusp"""
        if k in self.cusp:
            j = k - 1 if side < 0 else k
            j = max(0, min(len(self.bt) - 2, j))
            return (self.by[j + 1] - self.by[j]) / (self.bt[j + 1] - self.bt[j])
        return self.bd[k]


# ------------------------------------------------------------------ the mesh

def build(b, G, rgba):
    A = Profile(b['zs'], G.min(1))
    B = Profile(b['xs'], G.min(0))
    X, Z = B.bt, A.bt
    BA, AA = B.by, A.by
    tris = []

    def vert(x, z, region, kx, kz, side):
        if region == 'A':
            y = np.interp(z, Z, AA)
            d = A.slope(kz, side) if kz is not None else np.interp(z, Z, A.bd)
            n = np.array([0.0, -1.0, d])
            uv = (x * K_UV, np.interp(z, Z, A.bs) * K_UV)
        else:
            y = np.interp(x, X, BA)
            d = B.slope(kx, side) if kx is not None else np.interp(x, X, B.bd)
            n = np.array([d, -1.0, 0.0])
            uv = (z * K_UV, np.interp(x, X, B.bs) * K_UV)
        return (np.array([x, y, z]), n / np.linalg.norm(n), uv)

    def emit(poly):
        p0 = poly[0]
        for i in range(1, len(poly) - 1):
            t = [p0, poly[i], poly[i + 1]]
            P = np.array([v[0] for v in t])
            fn = np.cross(P[2] - P[0], P[1] - P[0])
            if np.linalg.norm(fn) < 1e-9:
                continue
            if np.dot(fn, t[0][1] + t[1][1] + t[2][1]) < 0:
                t = [t[0], t[2], t[1]]
            tris.append(t)

    nx, nz = len(X) - 1, len(Z) - 1
    kind = np.empty((nz, nx), dtype=object)
    for j in range(nz):
        for i in range(nx):
            a0, a1, b0, b1 = AA[j], AA[j + 1], BA[i], BA[i + 1]
            kind[j, i] = 'A' if max(b0, b1) <= min(a0, a1) + 1e-6 else 'B' if max(a0, a1) <= min(b0, b1) + 1e-6 else 'M'
    # A strips: runs along x in a row (height constant along x); B strips: runs along z in a column
    for j in range(nz):
        i = 0
        while i < nx:
            if kind[j, i] != 'A':
                i += 1
                continue
            i1 = i
            while i1 + 1 < nx and kind[j, i1 + 1] == 'A':
                i1 += 1
            x0, x1, z0, z1 = X[i], X[i1 + 1], Z[j], Z[j + 1]
            emit([vert(x0, z0, 'A', i, j, +1), vert(x1, z0, 'A', i1 + 1, j, +1), vert(x1, z1, 'A', i1 + 1, j + 1, -1), vert(x0, z1, 'A', i, j + 1, -1)])
            i = i1 + 1
    for i in range(nx):
        j = 0
        while j < nz:
            if kind[j, i] != 'B':
                j += 1
                continue
            j1 = j
            while j1 + 1 < nz and kind[j1 + 1, i] == 'B':
                j1 += 1
            x0, x1, z0, z1 = X[i], X[i + 1], Z[j], Z[j1 + 1]
            emit([vert(x0, z0, 'B', i, j, +1), vert(x1, z0, 'B', i + 1, j, -1), vert(x1, z1, 'B', i + 1, j1 + 1, -1), vert(x0, z1, 'B', i, j1 + 1, +1)])
            j = j1 + 1
    # mixed cells: cut along the groin A(z) = B(x) (both linear across the cell)
    for j in range(nz):
        for i in range(nx):
            if kind[j, i] != 'M':
                continue
            corners = [(X[i], Z[j], i, j, +1, +1), (X[i + 1], Z[j], i + 1, j, -1, +1), (X[i + 1], Z[j + 1], i + 1, j + 1, -1, -1), (X[i], Z[j + 1], i, j + 1, +1, -1)]
            dval = [np.interp(z, Z, AA) - np.interp(x, X, BA) for x, z, *_ in corners]
            for region, sign in (('A', 1), ('B', -1)):
                poly = []
                for k in range(4):
                    c, n = corners[k], corners[(k + 1) % 4]
                    dc, dn = sign * dval[k], sign * dval[(k + 1) % 4]
                    if dc >= 0:
                        poly.append(vert(c[0], c[1], region, c[2], c[3], c[4] if region == 'B' else c[5]))
                    if (dc > 0 and dn < 0) or (dc < 0 and dn > 0):
                        u = dc / (dc - dn)
                        x, z = c[0] + (n[0] - c[0]) * u, c[1] + (n[1] - c[1]) * u
                        kx = None if abs(n[0] - c[0]) > 1e-9 else c[2]
                        kz = None if abs(n[1] - c[1]) > 1e-9 else c[3]
                        poly.append(vert(x, z, region, kx, kz, c[4] if region == 'B' else c[5]))
                if len(poly) >= 3:
                    emit(poly)
    return [(np.array([v[0] for v in t]), np.array([v[1] for v in t]), [v[2] for v in t], rgba) for t in tris]


def stitch(tris, reach=0.10):
    """Close the cracks where two blocks meet with different breaks (and the T-junctions of the merged strips): every
    open edge takes the other open edges' corners that lie on it (within reach), so both sides run through the same
    points; a triangle that took any is fanned from its centre."""
    key = lambda p: tuple(np.round(p / 0.001).astype(np.int64))
    count = {}
    for t in tris:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            k = tuple(sorted((key(t[0][a]), key(t[0][b]))))
            count[k] = count.get(k, 0) + 1
    open_pts = {}
    for t in tris:
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if count[tuple(sorted((key(t[0][a]), key(t[0][b]))))] == 1:
                open_pts[key(t[0][a])] = t[0][a]
                open_pts[key(t[0][b])] = t[0][b]
    pts = np.array(list(open_pts.values()))
    cell = {}
    for i, q in enumerate(pts):
        cell.setdefault(tuple(np.floor(q / 1.0).astype(int)), []).append(i)
    out, fanned = [], 0
    for P, N, UV, rgba in tris:
        ring = []
        took = False
        for a, b in ((0, 1), (1, 2), (2, 0)):
            ring.append((P[a], N[a], np.array(UV[a])))
            if count[tuple(sorted((key(P[a]), key(P[b]))))] != 1:
                continue
            u, v = P[a], P[b]
            d = v - u
            L2 = float(d @ d)
            lo, hi = np.floor(np.minimum(u, v) - reach).astype(int), np.floor(np.maximum(u, v) + reach).astype(int)
            near = [i for x in range(lo[0], hi[0] + 1) for y in range(lo[1], hi[1] + 1) for z in range(lo[2], hi[2] + 1) for i in cell.get((x, y, z), [])]
            ins = []
            for i in near:
                q = pts[i]
                tt = float((q - u) @ d) / L2
                if tt <= 0.002 or tt >= 0.998:
                    continue
                if np.linalg.norm(u + d * tt - q) < reach:
                    ins.append((tt, q))
            for tt, q in sorted(ins, key=lambda x: x[0]):
                n = N[a] + (N[b] - N[a]) * tt
                ring.append((q, n / np.linalg.norm(n), np.array(UV[a]) + (np.array(UV[b]) - np.array(UV[a])) * tt))
                took = True
        if not took:
            out.append((P, N, UV, rgba))
            continue
        fanned += 1
        cP = np.mean([r[0] for r in ring], axis=0)
        cN = np.mean([r[1] for r in ring], axis=0)
        cU = np.mean([r[2] for r in ring], axis=0)
        cv = (cP, cN / np.linalg.norm(cN), cU)
        for i in range(len(ring)):
            r0, r1 = ring[i], ring[(i + 1) % len(ring)]
            # the ring keeps the triangle's own order, so the fan keeps its winding
            out.append((np.array([cv[0], r0[0], r1[0]]), np.array([cv[1], r0[1], r1[1]]), [tuple(cv[2]), tuple(r0[2]), tuple(r1[2])], rgba))
    return out, fanned


def ceiling(path, prefix):
    """The outside faces that look down (roof undersides, eaves) of the nodes named prefix*, as triangles."""
    tris = []
    cur = False
    for line in open(path):
        f = line.rstrip('\n').split('\t')
        if f[0] == 'S':
            cur = f[1].startswith(prefix)
            continue
        if not cur:
            continue
        p = np.array([[float(x) for x in f[k].split(',')[:3]] for k in (2, 3, 4)])
        n = np.cross(p[2] - p[0], p[1] - p[0])
        if np.linalg.norm(n) > 1e-9 and n[1] / np.linalg.norm(n) < -0.3:
            tris.append(p)
    return np.array(tris)


def clamp_under(made, roof, gap=0.05, reach=0.6):
    """Hold every web point at least gap under any face of roof that cuts into the web by up to reach."""
    if len(roof) == 0:
        return made, 0
    A, B, C = roof[:, 0, [0, 2]], roof[:, 1, [0, 2]], roof[:, 2, [0, 2]]
    v0, v1 = B - A, C - A
    det = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
    ok = np.abs(det) > 1e-9
    lo = np.minimum(np.minimum(roof[:, 0, [0, 2]], roof[:, 1, [0, 2]]), roof[:, 2, [0, 2]])
    hi = np.maximum(np.maximum(roof[:, 0, [0, 2]], roof[:, 1, [0, 2]]), roof[:, 2, [0, 2]])
    cache, moved = {}, 0
    out = []
    for P, N, UV, rgba in made:
        P = P.copy()
        for k in range(3):
            key = tuple(np.round(P[k], 4))
            if key not in cache:
                q = P[k][[0, 2]]
                cand = ok & np.all(lo <= q + 1e-6, axis=1) & np.all(hi >= q - 1e-6, axis=1)
                y = None
                for i in np.where(cand)[0]:
                    v2 = q - A[i]
                    u = (v2[0] * v1[i, 1] - v1[i, 0] * v2[1]) / det[i]
                    w = (v0[i, 0] * v2[1] - v2[0] * v0[i, 1]) / det[i]
                    if u >= -1e-6 and w >= -1e-6 and u + w <= 1 + 1e-6:
                        h = roof[i, 0, 1] + u * (roof[i, 1, 1] - roof[i, 0, 1]) + w * (roof[i, 2, 1] - roof[i, 0, 1])
                        if P[k][1] - reach < h < P[k][1] + gap:
                            y = h - gap if y is None else min(y, h - gap)
                cache[key] = y
            if cache[key] is not None and cache[key] < P[k][1]:
                P[k][1] = cache[key]
                moved += 1
        out.append((P, N, UV, rgba))
    return out, moved


def main():
    src, dst, nodes = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
    roof = ceiling(sys.argv[4], sys.argv[5]) if len(sys.argv) > 5 else np.zeros((0, 3, 3))
    data = load(src, set(nodes))
    plan = []
    for node in nodes:
        c = data[node]
        P = c['P']
        removed, made, report = [], [], []
        for b in blocks(P):
            tag = f"x {b['xs'][0]:.2f}..{b['xs'][-1]:.2f} z {b['zs'][0]:.2f}..{b['zs'][-1]:.2f} ({len(b['tris'])} triangles)"
            if not b['full'] or len(b['xs']) < 3 or len(b['zs']) < 3:
                report.append('kept (not a full grid) ' + tag)
                continue
            G = heights(P, b)
            if G is None:
                report.append('kept (two heights at a point) ' + tag)
                continue
            gA, gB = G.min(1), G.min(0)
            err = np.abs(np.maximum(gA[:, None], gB[None, :]) - G).max()
            if err > SEP_TOL:
                report.append(f'kept (not two barrels: {err:.3f} m) ' + tag)
                continue
            rgba = np.median(c['RGBA'][b['tris']].reshape(-1, 4), axis=0)
            new = build(b, G, rgba)
            removed += [int(c['idx'][t]) for t in b['tris']]
            made += new
            report.append(f'rebuilt {tag} -> {len(new)} triangles')
        made, fanned = stitch(made)
        report.append(f'stitched: {fanned} triangles took the corners of a neighbour on their open edges')
        made, moved = clamp_under(made, roof)
        if len(roof):
            report.append(f'held under the outside faces over it: {moved} corners')
        plan.append(dict(node=node, resource=c['res'], surface=c['surface'], material=c['mat'], sourceTriangles=len(P), removed=sorted(removed),
                         triangles=[dict(p=np.round(p, 5).ravel().tolist(), n=np.round(n, 5).ravel().tolist(),
                                         uv=np.round(np.array(uv), 5).ravel().tolist(), c=np.round(col, 4).tolist())
                                    for p, n, uv, col in made], report=report))
        print(f"{node} ({c['mat']}): {len(removed)} triangles out, {len(made)} in")
        for r in report:
            print('  ' + r)
    json.dump(dict(note=__doc__.strip().splitlines()[0], meshes=plan), open(dst, 'w'))


if __name__ == '__main__':
    main()
