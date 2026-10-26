"""The round corners' stones follow the curve (Steve, 2026-10-26: the texture in the corner must follow the curve,
especially in the gutter).
    python corner_courses.py <pavements dump> <corners json> <out candidate>
<pavements dump>: dump-pavements.gd of the INSTALLED town (20 floats a corner). <corners json>: each laid corner's apex,
u, v, lu, lv and form p (2 round, 6 rounded square), as corner_kerbs.py laid it.
The corners' old-stone faces (r000209: kerb arris, kerb face, gutter) took their picture from the nearest strip face, a
straight projection: across the curve the courses ran straight and the joints cut the gutter. Here each point of a
corner face gets its place measured round the curve: the strip's own picture continued from the strip's end, the
distance along the curve (at the point's own offset from the kerb) taking the place of the distance along the strip.
Each half of the corner continues its own strip; the halves meet in a joint at the middle of the turn.
- Flat faces (the gutter, the arris's flat edge): the slab picture's place wholly by uv (the slab shader's place for a
  straight strip, (x, z) . (along, across) / slab_tile + uv, continued round the curve) and a tangent standing steeply
  up, the flag for that (Psx: slab_uvm), its level part turned with the curve so the stones' relief light turns too.
- Upright and sloping faces (the kerb's face and rounded arris, the gutter's outer edge): the strip's uv continued.
- The corner's flag (r000016): the first strip's flags laid on straight across the whole corner.
Positions are unchanged (collision stays). Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, math, pathlib, hashlib
import numpy as np
from scipy.spatial import cKDTree
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from corner_kerbs import face_uv_map, cs, cs_at

STONE = 'res://world/town/resources/r000209.res'
TILE = 2.6
REPO = pathlib.Path(__file__).resolve().parents[3]

def solve_d(s, t, lu, lv, p):
    """The offset d past the corner's curve (lu + d, lv + d) on which (s, t) lies."""
    lo, hi = -min(lu, lv) + 1e-4, 3.0
    f = lambda d: (abs(s) / (lu + d)) ** p + (abs(t) / (lv + d)) ** p - 1.0
    if f(lo) < 0: return lo
    for _ in range(60):
        m = (lo + hi) / 2
        if f(m) > 0: lo = m
        else: hi = m
    return (lo + hi) / 2

def main():
    pave, cj, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(pave / 'pavements.json'))
    R = np.fromfile(pave / 'pavements.f32', np.float32).reshape(-1, 3, 20).astype(np.float64)
    stone = np.zeros(len(R), bool); owner = np.zeros(len(R), int)
    for i, e in enumerate(info):
        sl = slice(e['first'] // 3, (e['first'] + e['corners']) // 3); owner[sl] = i
        if e['material'] == STONE: stone[sl] = True
    corners = json.load(open(cj))
    cen = R[:, :, [0, 2]].mean(1)
    nrm = np.cross(R[:, 1, :3] - R[:, 0, :3], R[:, 2, :3] - R[:, 0, :3]); area = np.linalg.norm(nrm, axis=1)
    nrm = nrm / np.maximum(area, 1e-12)[:, None]
    # which faces are a corner's (inside its quarter, out to past its gutter)
    inside = np.full(len(R), -1)
    for k, c in enumerate(corners):
        A = np.array(c['apex']); M = np.linalg.inv(np.stack([c['u'], c['v']], 1))
        near = np.hypot(*(cen - A).T) < max(c['lu'], c['lv']) + 1.2
        st = (cen[near] - A) @ M.T
        ok = (st[:, 0] > 1e-3) & (st[:, 1] > 1e-3)
        ok &= (np.abs(st[:, 0]) / (c['lu'] + 0.9)) ** c['p'] + (np.abs(st[:, 1]) / (c['lv'] + 0.9)) ** c['p'] < 1
        inside[np.nonzero(near)[0][ok]] = k
    strip = stone & (inside < 0) & (area > 1e-10)
    sidx = np.nonzero(strip)[0]; stree = cKDTree(cen[sidx])
    bmin = R[:, :, [0, 2]].min(1); bmax = R[:, :, [0, 2]].max(1)
    fidx = np.nonzero(~stone & (inside < 0) & (area > 1e-10))[0]; ftree = cKDTree(cen[fidx])
    new = R.copy(); report = dict(corners=len(corners), faces=0, flat=0, upright=0, unsourced=0)
    maps = {}; miss = []
    def source(Q3, n):
        """The strip face at the point Q3 (on its plane, over its triangle), facing as n: its uv map and its slab way."""
        cand = sidx[stree.query_ball_point(Q3[[0, 2]], 9.0)]
        # (long strip faces: their middles lie far off; keep those whose box holds the point)
        cand = cand[((bmin[cand] - 0.3 <= Q3[[0, 2]]) & (Q3[[0, 2]] <= bmax[cand] + 0.3)).all(1)]
        best, bd = None, 1e9
        for f in cand:
            if nrm[f] @ n < 0.7: continue
            P = R[f, :, :3]; dist = abs((Q3 - P[0]) @ nrm[f])
            e1, e2 = P[1] - P[0], P[2] - P[0]; q = Q3 - P[0]
            G = np.array([[e1 @ e1, e1 @ e2], [e1 @ e2, e2 @ e2]])
            try: b = np.linalg.solve(G, [q @ e1, q @ e2])
            except np.linalg.LinAlgError: continue
            out_by = max(-b[0], -b[1], b[0] + b[1] - 1, 0.0) * math.sqrt(area[f])
            score = dist + out_by + (1 - nrm[f] @ n) * 0.2
            if score < bd: bd, best = score, f
        if best is None or bd > 0.3:
            miss.append((Q3.tolist(), n.tolist(), None if best is None else float(bd), len(cand)))
            return None
        if best not in maps: maps[best] = face_uv_map(R[best])
        sd = R[best, 0, [16, 18]]; sd = sd / max(np.hypot(*sd), 1e-12)
        return maps[best], sd
    for k, c in enumerate(corners):
        A = np.array(c['apex']); u = np.array(c['u']); v = np.array(c['v']); lu, lv, p = c['lu'], c['lv'], c['p']
        M = np.linalg.inv(np.stack([u, v], 1))
        faces = np.nonzero((inside == k) & stone & (area > 1e-10))[0]
        aa = np.linspace(0, math.pi / 2, 401); ca, sa = cs(aa, p)
        # the corner's flag: the first strip's flags laid on straight across it (one joint, on the second strip's end
        # line at the house's corner; no zigzag where faces took either strip's)
        ff = np.nonzero((inside == k) & ~stone & (area > 1e-10))[0]
        if len(ff):
            y = float(np.median(R[ff, :, 1])); w = v / np.hypot(*v)
            Q = A + u * (lu * 0.5) - w * 0.15
            cand = fidx[ftree.query_ball_point(Q, 9.0)]
            cand = cand[((bmin[cand] - 0.02 <= Q) & (Q <= bmax[cand] + 0.02)).all(1) & (np.abs(nrm[cand, 1]) > 0.85)]
            cand = cand[np.argsort(np.abs(R[cand, :, 1].mean(1) - y))][:1]
            if len(cand):
                mp = face_uv_map(R[cand[0]])
                for f in ff: new[f, :, 6:8] = mp(R[f, :, :3])
                report['flags'] = report.get('flags', 0) + len(ff)
        for f in faces:
            flat = abs(nrm[f, 1]) > 0.85 and R[f, :, 1].max() < 0.8
            st = (R[f][:, [0, 2]] - A) @ M.T
            ds = [solve_d(s, t, lu, lv, p) for s, t in st]
            ap = [cs_at(s / (lu + d), t / (lv + d), p) for (s, t), d in zip(st, ds)]
            side = 0 if np.mean(ap) < math.pi / 4 else 1
            rows = []
            ok = True
            for j in range(3):
                d, a, y = ds[j], float(ap[j]), R[f, j, 1]
                # the curve at this offset, and its length from the strip's end
                E2 = A + np.outer((lu + d) * ca, u) + np.outer((lv + d) * sa, v)
                seg = np.r_[0, np.cumsum(np.hypot(*np.diff(E2, axis=0).T))]
                L = np.interp(a, aa, seg)
                if side == 1: L = seg[-1] - L
                end = E2[0] if side == 0 else E2[-1]
                w = v if side == 0 else u; w = w / np.hypot(*w)
                Q3 = np.array([end[0] - w[0] * 0.12, y, end[1] - w[1] * 0.12])
                # (normals as the town's winding gives them, the strip's alike)
                src = source(Q3, nrm[f] if flat else _turned(nrm[f], w, E2, aa, a, side))
                if src is None: ok = False; break
                mp, sd = src
                E3 = np.array([end[0], y, end[1]]); W3 = np.array([w[0], 0, w[1]])
                if flat:
                    sp = np.array([-sd[1], sd[0]])
                    place = lambda P3: np.array([P3[[0, 2]] @ sd, P3[[0, 2]] @ sp]) / TILE + mp(P3[None])[0]
                else:
                    place = lambda P3: mp(P3[None])[0]
                uv = place(E3) + (place(E3 + W3) - place(E3)) * L
                rows.append(uv)
                if flat:
                    # the curve's way here (away from the strip's end), and the strip's slab way turned as much
                    i = int(np.clip(np.searchsorted(aa, a), 1, len(aa) - 1))
                    tc = E2[i] - E2[i - 1]; tc = tc / np.hypot(*tc)
                    if side == 1: tc = -tc
                    ang = math.atan2(w[0] * tc[1] - w[1] * tc[0], w @ tc)
                    rot = np.array([[math.cos(ang), -math.sin(ang)], [math.sin(ang), math.cos(ang)]])
                    sdr = rot @ sd
                    new[f, j, 16:20] = [0.6 * sdr[0], 0.8, 0.6 * sdr[1], 1.0]
            if not ok: report['unsourced'] += 1; continue
            new[f, :, 6:8] = np.array(rows)
            report['faces'] += 1; report['flat' if flat else 'upright'] += 1
    # surfaces touched
    touched = sorted(set(owner[np.nonzero((new != R).any((1, 2)))[0]]))
    manifest = {}
    for i in touched:
        e = info[i]
        rows = new[e['first'] // 3:(e['first'] + e['corners']) // 3].astype(np.float32)
        fn = f'{pathlib.Path(e["mesh"]).stem}-{e["surface"]}.f32'; rows.tofile(out / fn)
        m = manifest.setdefault((e['mesh'], e['node']), {'mesh': e['mesh'], 'nodePath': e['node'],
            'sourceHash': hashlib.sha256((REPO / 'native-godot' / e['mesh'][6:]).read_bytes()).hexdigest(), 'surfaces': []})
        m['surfaces'].append({'index': e['surface'], 'file': fn, 'material': e['material'], 'custom0': e['custom0Stride'] > 0, 'tangent': True})
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': list(manifest.values())}, indent=1))
    (out / 'misses.json').write_text(json.dumps(miss))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report, 'surfaces', len(touched))

def _turned(n, w, E2, aa, a, side):
    """A corner face's normal turned back to the strip's end (to find the strip face that faces the same way)."""
    i = int(np.clip(np.searchsorted(aa, a), 1, len(aa) - 1))
    tc = E2[i] - E2[i - 1]; tc = tc / np.hypot(*tc)
    if side == 1: tc = -tc
    ang = -math.atan2(w[0] * tc[1] - w[1] * tc[0], w @ tc)
    c, s = math.cos(ang), math.sin(ang)
    # (x, z) turned by ang
    return np.array([c * n[0] - s * n[2], n[1], s * n[0] + c * n[2]])

if __name__ == '__main__':
    main()
