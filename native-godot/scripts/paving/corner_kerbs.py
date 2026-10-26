"""Pavement corners left open (#199): where two raised pavement strips end at a house's outer corner, the square between
them was street. Lays the corner's flag, the kerb's rounded arris and face round it (mitred), the gutter round it, and
the street's edge course round the new corner (fanned), each continuing the strips' and the course's own uv.
    python corner_kerbs.py <pavements dump> <ground dump> <out candidate> [--only x,z]
<pavements dump>: dump-pavements.gd (20 floats a corner); <ground dump>: dump-ground.gd of the INSTALLED ground.
Writes manifest.json (surfaceRepairs for stone-corners-promote.tscn: new faces appended to the strip's own surfaces,
the flag and kerb added to the collision stand-in) and corners.json (each corner laid or skipped, and why).
"""
import sys, json, math, pathlib, hashlib
import numpy as np, shapely
from shapely.geometry import Polygon
from scipy.spatial import cKDTree
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from seam_stones import recut, polar, jacobians

FLAGS = 'res://world/town/resources/r000016.res'
STONE = 'res://world/town/resources/r000209.res'
REPO = pathlib.Path(__file__).resolve().parents[3]

def elbows(R, mat):
    """Corners of the pavement tops whose two edges are both short and square, the square they span free."""
    y = R[:, :, 1].mean(1); up = np.abs(R[:, 0, 4]) > 0.9
    F = shapely.make_valid(shapely.union_all(shapely.polygons(R[up & (y > 0.05) & (y < 0.35)][:, :, [0, 2]])))
    out = []; seen = set()
    for poly in shapely.get_parts(F):
        if poly.geom_type != 'Polygon': continue
        for ring in [poly.exterior] + list(poly.interiors):
            c = np.asarray(ring.simplify(0.01).coords)[:-1]; m = len(c)
            for i in range(m):
                a, b, d = c[i - 1], c[i], c[(i + 1) % m]
                e1, e2 = a - b, d - b; l1, l2 = np.hypot(*e1), np.hypot(*e2)
                if not (0.2 <= l1 <= 1.8 and 0.2 <= l2 <= 1.8): continue
                if abs(math.degrees(math.acos(np.clip(e1 @ e2 / (l1 * l2), -1, 1))) - 90) > 12: continue
                u, v = e1 / l1, e2 / l2
                sq = Polygon([b, b + u * l1, b + u * l1 + v * l2, b + v * l2])
                if not sq.is_valid or sq.area < 0.08 or shapely.intersection(sq, F).area > 0.1 * sq.area: continue
                key = tuple(np.round(b, 1))
                if key in seen: continue
                seen.add(key); out.append(dict(apex=b, u=u, lu=l1, v=v, lv=l2))
    return out, F

def face_uv_map(T):
    """The face's uv as an affine map of 3D position (none across its normal)."""
    p = T[:, :3]; uv = T[:, 6:8]
    E = np.stack([p[1] - p[0], p[2] - p[0]])                  # 2 x 3
    n = np.cross(E[0], E[1]); n /= max(np.linalg.norm(n), 1e-12)
    M = np.vstack([E, n])                                     # 3 x 3
    rhs = np.vstack([uv[1] - uv[0], uv[2] - uv[0], [0, 0]])
    J = np.linalg.solve(M, rhs).T                             # 2 x 3
    return lambda q: uv[0] + (q - p[0]) @ J.T

class Corner:
    def __init__(self, e, R, mat, owner, tree, cen):
        self.A, self.u, self.lu, self.v, self.lv = e['apex'], e['u'], e['lu'], e['v'], e['lv']
        self.R, self.mat, self.owner, self.tree, self.cen = R, mat, owner, tree, cen
    def W(self, s, t, y):
        p = self.A + s * self.u + t * self.v
        return np.array([p[0], y, p[1]])
    def section(self, side, t0=0.6):
        """The strip's cross-section t0 back from the corner: (d outward, y, material) points."""
        out_dir, along = (self.u, self.v) if side == 0 else (self.v, self.u)
        l = self.lu if side == 0 else self.lv
        base = self.A + out_dir * l; at = self.A - along * t0
        idx = np.array(self.tree.query_ball_point(at, 12.0), int)
        if not len(idx): return np.zeros((0, 3))
        T = self.R[idx]; sd = (T[:, :, [0, 2]] - at) @ (-along)
        pts = []
        for k in range(3):
            a, b = T[:, k], T[:, (k + 1) % 3]; sa, sb = sd[:, k], sd[:, (k + 1) % 3]
            cr = sa * sb < 0; w = sa[cr] / (sa[cr] - sb[cr]); p = a[cr, :3] + (b[cr, :3] - a[cr, :3]) * w[:, None]
            d = (p[:, [0, 2]] - base) @ out_dir
            pts += [(dd, yy, mm) for dd, yy, mm in zip(d, p[:, 1], self.mat[idx][cr]) if -0.3 < dd < 0.6]
        return np.array(pts) if pts else np.zeros((0, 3))
    def measure(self, side):
        S = self.section(side)
        if len(S) < 4: return None
        top = S[(S[:, 2] == 1)][:, 1]
        if not len(top): return None
        top = float(np.median(top))
        face = S[(S[:, 2] == 2) & (S[:, 1] > 0.02) & (S[:, 1] < top - 0.02) & (S[:, 0] > -0.005)]
        if not len(face): return None
        df = float(np.median(face[:, 0]))
        gut = S[(S[:, 2] == 2) & (S[:, 1] > -0.002) & (S[:, 1] < 0.02) & (S[:, 0] > df + 0.08)]
        low = S[(S[:, 2] == 2) & (S[:, 1] < -0.002) & (S[:, 0] > df + 0.08)]
        g = None
        if len(gut) and len(low):
            gout = float(low[:, 0].max())
            foot = S[(S[:, 2] == 2) & (np.abs(S[:, 0] - df) < 0.03) & (S[:, 1] < 0.02) & (S[:, 1] > 0.002)]
            yin = float(np.median(foot[:, 1])) if len(foot) else 0.004
            yout = float(gut[np.argmax(gut[:, 0]), 1])
            g = (gout, yin, yout)
        return dict(top=top, df=df, gutter=g)
    def ends(self, side, m):
        """How far the strip's kerb and gutter already run past the corner's line (t along the corner)."""
        out_dir, along = (self.u, self.v) if side == 0 else (self.v, self.u)
        l = self.lu if side == 0 else self.lv
        base = self.A + out_dir * l
        idx = np.array(self.tree.query_ball_point(self.A, 12.0), int)
        T = self.R[idx]; q = T[:, :, [0, 2]] - base; d = q @ out_dir; t = q @ along
        stone = self.mat[idx] == 2
        kerb = stone[:, None] & (np.abs(d - m['df']) < 0.02) & (T[:, :, 1] > 0.03) & (np.abs(t) < 1.5)
        tk = float(t[kerb].max()) if kerb.any() else 0.0
        tg = None
        if m['gutter']:
            gd = stone[:, None] & (d > m['df'] + 0.03) & (d < m['gutter'][0] - 0.03) & (T[:, :, 1] < 0.02) & (np.abs(t) < 1.5)
            tg = float(t[gd].max()) if gd.any() else 0.0
        return tk, tg

def profile(m):
    top, df = m['top'], m['df']
    k = [(df - 0.030, top), (df - 0.019, top - 0.001), (df - 0.009, top - 0.008), (df - 0.003, top - 0.017), (df, top - 0.029)]
    if m['gutter']:
        gout, yin, yout = m['gutter']
        return k + [(df, yin)], [(df, yin), (gout - 0.030, yout), (gout, -0.006)]
    return k + [(df, -0.01)], []

ARC = 16     # pieces in the kerb's quarter round
STONES = 4   # gutter stones round the corner (each its own way for the slab picture)

def build(c, m1, m2):
    """The round corner: the flag a quarter round to the arris, the arris, face and gutter swept round the house's corner
    (a quarter ellipse through both strips' lines). Faces: (3 x 3 world points, material, source strip, tangent or None)."""
    k1, g1 = profile(m1); k2, g2 = profile(m2)
    if bool(g1) != bool(g2): return None, 'one strip has a gutter, the other none'
    tk1, tg1 = c.ends(0, m1); tk2, tg2 = c.ends(1, m2)
    th = np.linspace(0, math.pi / 2, ARC + 1)
    def P(d1, d2, t, y): return c.W((c.lu + d1) * math.cos(t), (c.lv + d2) * math.sin(t), y)
    def tangent(d1, d2, t):
        # the way round the corner, away from it at strip 1 (as the strips' gutters run)
        w = (c.lu + d1) * math.sin(t) * c.u - (c.lv + d2) * math.cos(t) * c.v
        w = w / np.hypot(*w); return np.array([w[0], 0.0, w[1], 1.0])
    faces = []
    def quad(a, b, cc, d, mat, side, tg=None): faces.extend([(np.array([a, b, cc]), mat, side, tg), (np.array([a, cc, d]), mat, side, tg)])
    top = m1['top']
    # the flag: a quarter round from the house's corner out to the arris
    for i in range(ARC):
        faces.append((np.array([c.W(0, 0, top), P(k1[0][0], k2[0][0], th[i], top), P(k1[0][0], k2[0][0], th[i + 1], top)]), FLAGS, 0, None))
    for j in range(len(k1) - 1):
        for i in range(ARC):
            side = 0 if th[i] + th[i + 1] < math.pi / 2 else 1
            quad(P(k1[j][0], k2[j][0], th[i], k1[j][1]), P(k1[j][0], k2[j][0], th[i + 1], k1[j][1]),
                 P(k1[j + 1][0], k2[j + 1][0], th[i + 1], k1[j + 1][1]), P(k1[j + 1][0], k2[j + 1][0], th[i], k1[j + 1][1]), STONE, side)
    for j in range(len(g1) - 1):
        for i in range(ARC):
            side = 0 if th[i] + th[i + 1] < math.pi / 2 else 1
            flat = j == 0
            # (each gutter stone keeps one way: the slab picture turns stone by stone, not across one)
            stone = min(i * STONES // ARC, STONES - 1); mid = (stone + 0.5) * math.pi / 2 / STONES
            tg = tangent(g1[0][0], g2[0][0], mid) if flat else None
            quad(P(g1[j][0], g2[j][0], th[i], g1[j][1]), P(g1[j][0], g2[j][0], th[i + 1], g1[j][1]),
                 P(g1[j + 1][0], g2[j + 1][0], th[i + 1], g1[j + 1][1]), P(g1[j + 1][0], g2[j + 1][0], th[i], g1[j + 1][1]), STONE, side, tg)
    outer = (c.lu + (g1[-1][0] if g1 else k1[-1][0]), c.lv + (g2[-1][0] if g2 else k2[-1][0]))
    return dict(faces=faces, outer=outer, tk=(tk1, tk2), tg=(tg1, tg2)), None

def clip(rows, keep):
    """A face (3 x 20 rows) cut to the half-planes in keep (each (point, outward normal) in x, z: kept where (p - a) . n <= 0),
    every attribute linear along the cut edges; a fan of faces."""
    poly = list(rows)
    for a, nrm in keep:
        out = []; m = len(poly)
        for k in range(m):
            p, q = poly[k], poly[(k + 1) % m]
            dp = (p[[0, 2]] - a) @ nrm; dq = (q[[0, 2]] - a) @ nrm
            if dp <= 0: out.append(p)
            if (dp < 0) != (dq < 0) and abs(dp - dq) > 1e-12: out.append(p + (q - p) * (dp / (dp - dq)))
        poly = out
        if len(poly) < 3: return []
    return [np.array([poly[0], poly[k], poly[k + 1]]) for k in range(1, len(poly) - 1)]

def main():
    pave, ground, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    only = None
    if '--only' in sys.argv: only = np.array([float(x) for x in sys.argv[sys.argv.index('--only') + 1].split(',')])
    info = json.load(open(pave / 'pavements.json'))
    R = np.fromfile(pave / 'pavements.f32', np.float32).reshape(-1, 3, 20).astype(np.float64)
    mat = np.zeros(len(R), int); owner = np.zeros(len(R), int)
    for i, e in enumerate(info):
        sl = slice(e['first'] // 3, (e['first'] + e['corners']) // 3)
        mat[sl] = 1 if e['material'] == FLAGS else 2; owner[sl] = i
    cen = R[:, :, [0, 2]].mean(1); tree = cKDTree(cen)
    # the winding the town uses (Godot: clockwise from the front)
    tops = (mat == 1) & (R[:, 0, 4] > 0.9)
    T = R[tops][:200, :, :3]; wind = np.sign(np.median(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])[:, 1]))
    found, F = elbows(R, mat)
    if only is not None: found = [e for e in found if np.hypot(*(e['apex'] - only)) < 2.0]
    # the visible street (not the old picture under the houses) and what stands on it
    gj = json.load(open(ground / 'ground.json')); grounds = {}
    for name, tile, rows in [('ground_cobble', 3.0, 13), ('ground_quay', 2.5, 12)]:
        G = np.fromfile(ground / gj[name]['surfaces'][0]['file'], np.float32).reshape(-1, 3, 16).astype(np.float64)
        hid = np.abs(G[:, :, [6, 7]] * tile - G[:, :, [0, 2]]).max((1, 2)) < 2e-3
        grounds[name] = dict(R=G, tile=tile, rows=rows, hidden=hid, polys=shapely.polygons(G[:, :, [0, 2]]))
        grounds[name]['tree'] = shapely.STRtree(grounds[name]['polys'])
    O = np.fromfile(ground / 'obstacles.f32', np.float32).reshape(-1, 3, 3)
    O = O[O[:, :, 1].max(1) > 0.2]
    ob = shapely.polygons(O[:, :, [0, 2]].astype(np.float64)); otree = shapely.STRtree(ob)
    report = []; adds = {}; solids = {}; cuts = {k: [] for k in grounds}; clips = []
    for e in found:
        c = Corner(e, R, mat, owner, tree, cen)
        rec = dict(apex=np.round(c.A, 3).tolist(), size=[round(c.lu, 3), round(c.lv, 3)])
        report.append(rec)
        sq = Polygon([c.A, c.A + c.u * c.lu, c.A + c.u * c.lu + c.v * c.lv, c.A + c.v * c.lv])
        vis = 0.0
        for g in grounds.values():
            h = g['tree'].query(sq, predicate='intersects'); h = h[~g['hidden'][h]]
            vis += shapely.area(shapely.intersection(g['polys'][h], sq)).sum()
        if vis < 0.9 * sq.area: rec['skipped'] = 'not on the open street'; continue
        inner = shapely.difference(sq.buffer(-0.04), shapely.Point(c.A).buffer(0.3))
        h = otree.query(inner, predicate='intersects')
        stand = shapely.intersection(shapely.union_all(ob[h]), inner).area if len(h) else 0.0
        if stand > 0.03: rec['skipped'] = f'something stands there ({stand:.2f} m2)'; continue
        m1, m2 = c.measure(0), c.measure(1)
        if m1 is None or m2 is None: rec['skipped'] = 'kerb not measured'; continue
        if abs(m1['top'] - m2['top']) > 0.02: rec['skipped'] = 'strips at different heights'; continue
        b, why = build(c, m1, m2)
        if b is None: rec['skipped'] = why; continue
        clips.append((c.A, c.u, c.v))
        rec.update(laid=len(b['faces']), kerb=[round(m1['df'], 3), round(m2['df'], 3)], gutter=bool(m1['gutter']), ends=[b['tk'], b['tg']])
        # each new face: its strip's nearest face of the same material and way supplies uv, uv2, colour, custom0, tangent
        for tri, material, side, tg in b['faces']:
            # facing up and out of the corner, in the town's winding
            along = c.v if side == 0 else c.u; outward = c.u if side == 0 else c.v
            n = np.cross(tri[1] - tri[0], tri[2] - tri[0]) * wind; n /= np.linalg.norm(n)
            if n @ np.array([outward[0], 0.6, outward[1]]) < 0: tri = tri[[0, 2, 1]]; n = -n
            probe = tri[:, [0, 2]].mean(0) - along * 0.6
            want = 1 if material == FLAGS else 2
            idx = np.array(tree.query_ball_point(probe, 6.0), int)
            idx = idx[mat[idx] == want]
            if not len(idx): idx = np.array(tree.query(probe, 50)[1]); idx = idx[mat[idx] == want]
            fn = np.cross(R[idx, 1, :3] - R[idx, 0, :3], R[idx, 2, :3] - R[idx, 0, :3]) * wind
            fn /= np.maximum(np.linalg.norm(fn, axis=1, keepdims=True), 1e-12)
            score = fn @ n * 2 - np.hypot(*(cen[idx] - probe).T) * 0.3
            src = R[idx[np.argmax(score)]]
            rows = np.zeros((3, 20)); rows[:, :3] = tri; rows[:, 3:6] = n
            rows[:, 6:8] = face_uv_map(src)(tri)
            rows[:, 8:20] = src[0, 8:20]
            if tg is not None: rows[:, 16:20] = tg
            entry = info[owner[idx[np.argmax(score)]]]
            key = (entry['mesh'], entry['node'], entry['surface'], entry['material'], entry['custom0Stride'] > 0)
            adds.setdefault(key, []).append(rows)
            if material == FLAGS or (rows[:, 1].min() > 0.02 or rows[:, 1].max() > 0.03):
                solids.setdefault((entry['mesh'], entry['node']), []).append(rows[:, :16])
        # the street's edge course round the new corner: each side continues its own course, a fan round the corner
        so, to = b['outer']
        for name, g in grounds.items():
            band = g['tile'] / g['rows']
            def chart(s, t):
                q = c.A + c.u * s + c.v * t
                h = g['tree'].query(shapely.Point(q), predicate='intersects')
                h = [i for i in h if not g['hidden'][i]]
                if not h: return None
                Jf, _ = jacobians(g['R'][h[:1]]); J = polar(Jf[0]) / g['tile']
                uvq = face_uv_map(np.c_[g['R'][h[0]][:, :3], np.zeros((3, 3)), g['R'][h[0]][:, 6:8]])(np.array([q[0], 0, q[1]]))
                return q, J, uvq
            back1 = min(b['tg'][0] if b['tg'][0] is not None else b['tk'][0], 0.0) - 0.45
            back2 = min(b['tg'][1] if b['tg'][1] is not None else b['tk'][1], 0.0) - 0.45
            c1 = chart(so + band / 2, back1); c2 = chart(back2, to + band / 2)
            if c1 is None or c2 is None: continue
            P = lambda pts: Polygon([c.A + c.u * s + c.v * t for s, t in pts])
            side1 = P([(so, back1), (so + band, back1), (so + band, 0), (so, 0)])
            side2 = P([(back2, to), (0, to), (0, to + band), (back2, to + band)])
            th = np.linspace(0, math.pi / 2, 33)
            ring = lambda x: [(( so + x) * math.cos(a), (to + x) * math.sin(a)) for a in th]
            # what is left of the old corner's square past the course: the street's own field beyond the corner
            rest = shapely.difference(P([(0, 0), (so + band + 0.08, 0), (so + band + 0.08, to + band + 0.08), (0, to + band + 0.08)]),
                                      P([(0, 0)] + ring(band)))
            c3 = chart(so + band + 0.45, to + band + 0.45)
            def lin(ch):
                q0, J, uv0 = ch
                return lambda pts: uv0 + (pts - q0) @ J.T
            def fan(ch, A=c.A, u=c.u, v=c.v, so=so, to=to, band=band):
                # (everything bound now: the cuts are laid after the last corner) Metric round the curve, also where the
                # streets meet off square: across = distance from the gutter's edge, along = length round the course's middle
                q0, J, uv0 = ch
                aa = np.linspace(0, math.pi / 2, 721)
                E = A + np.outer(so * np.cos(aa), u) + np.outer(to * np.sin(aa), v)
                Mid = A + np.outer((so + band / 2) * np.cos(aa), u) + np.outer((to + band / 2) * np.sin(aa), v)
                L = np.r_[0, np.cumsum(np.hypot(*np.diff(Mid, axis=0).T))]
                T = np.gradient(E, axis=0); T /= np.hypot(*T.T)[:, None]
                N = np.stack([T[:, 1], -T[:, 0]], 1); N *= np.sign(((E - A) * N).sum(1))[:, None]
                at = uv0 + (E[0] - q0) @ J.T; n0, t0 = N[0], T[0]
                M = np.linalg.inv(np.stack([u, v], 1))
                def f(pts):
                    st = (pts - A) @ M.T; a = np.clip(np.arctan2(st[:, 1] * so, st[:, 0] * to), 0, math.pi / 2)
                    k = np.clip(np.round(a / (math.pi / 2) * 720).astype(int), 0, 720)
                    d = pts - E[k]; x = (d * N[k]).sum(1); along = L[k] + (d * T[k]).sum(1)
                    return at + np.outer(x, J @ n0) + np.outer(along, J @ t0)
                return f
            # the fan's uv is round: small sectors, so no face spans much of the turn
            cuts[name] += [(side1, lin(c1)), (side2, lin(c2))]
            for k in range(len(th) - 1):
                sector = P([((so + x) * math.cos(a), (to + x) * math.sin(a)) for x, a in
                            [(0, th[k]), (0, th[k + 1]), (band, th[k + 1]), (band, th[k])]])
                cuts[name].append((sector, fan(c1)))
            if c3 is not None and not rest.is_empty: cuts[name].append((rest, lin(c3)))
        rec['ground'] = True
    laid = [r for r in report if 'laid' in r]
    print(f'{len(report)} open corners; laid {len(laid)}; skipped', {k: sum(1 for r in report if r.get("skipped") == k) for k in set(r.get("skipped") for r in report if "skipped" in r)})
    # the strips' surfaces with the new faces appended; the ground cut round each corner
    manifest = []
    pinfo = {(e['mesh'], e['node'], e['surface']): e for e in info}
    bymesh = {}
    for key, rows in adds.items(): bymesh.setdefault((key[0], key[1]), []).append((key, rows))
    for (mesh, node), items in bymesh.items():
        surfs = []
        for (mesh_, node_, si, material, custom), rows in items:
            e = pinfo[(mesh_, node_, si)]
            old = R[e['first'] // 3:(e['first'] + e['corners']) // 3]
            # the strips' gutters ran on past the house's line: what lies in a corner's quarter goes (the round has it)
            if material == STONE and clips:
                kept = []
                for f_ in old:
                    pieces = [f_]
                    if f_[:, 1].max() < 0.03:
                        for A_, u_, v_ in clips:
                            if np.hypot(*(f_[:, [0, 2]].mean(0) - A_)) > 8: continue
                            nu = np.array([-v_[1], v_[0]]); nu = nu if nu @ u_ > 0 else -nu   # across v, towards +s
                            nv = np.array([-u_[1], u_[0]]); nv = nv if nv @ v_ > 0 else -nv   # across u, towards +t
                            nxt = []
                            for pc in pieces:
                                inside = ((pc[:, [0, 2]] - A_) @ nu > 1e-4).all() and ((pc[:, [0, 2]] - A_) @ nv > 1e-4).all()
                                if inside: continue
                                if ((pc[:, [0, 2]] - A_) @ nu <= 1e-4).all() or ((pc[:, [0, 2]] - A_) @ nv <= 1e-4).all(): nxt.append(pc); continue
                                nxt += clip(pc, [(A_, nv)])                                     # the part short of t = 0
                                nxt += clip(pc, [(A_, -nv), (A_, nu)])                          # t >= 0 but short of s = 0
                            pieces = nxt
                    kept += pieces
                old = np.array(kept)
            allr = np.concatenate([old, np.stack(rows)]).astype(np.float32)
            f = f'{pathlib.Path(mesh).stem}-{si}.f32'; allr.tofile(out / f)
            surfs.append({'index': si, 'file': f, 'material': material, 'custom0': bool(custom), 'tangent': True})
        ent = {'mesh': mesh, 'nodePath': node, 'sourceHash': hashlib.sha256((REPO / 'native-godot' / mesh[6:]).read_bytes()).hexdigest(), 'surfaces': surfs}
        if (mesh, node) in solids:
            sf = f'{pathlib.Path(mesh).stem}-solid.f32'; np.concatenate(solids[(mesh, node)]).astype(np.float32).tofile(out / sf); ent['solid'] = sf
        manifest.append(ent)
    for name, g in grounds.items():
        if not cuts[name]: continue
        geoms = [x[0] for x in cuts[name]]
        # (corners close together: each later shape keeps only what the earlier ones left)
        clean = []; taken = Polygon()
        for gm in geoms: clean.append(shapely.difference(gm, taken)); taken = shapely.union_all([taken, gm])
        fns = [x[1] for x in cuts[name]]
        res, area = recut(g['R'], ~g['hidden'], clean, lambda i, C: fns[i](C.reshape(-1, 2)).reshape(-1, 3, 2))
        f = name + '.f32'; res.astype(np.float32).tofile(out / f)
        rec = gj[name]
        manifest.append({'mesh': rec['mesh'], 'nodePath': rec['node'],
                         'sourceHash': hashlib.sha256((REPO / 'native-godot' / rec['mesh'][6:]).read_bytes()).hexdigest(),
                         'surfaces': [{'index': 0, 'file': f, 'material': rec['surfaces'][0]['material'], 'custom0': False}]})
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'corners.json').write_text(json.dumps(report, indent=1, default=float))

if __name__ == '__main__':
    main()
