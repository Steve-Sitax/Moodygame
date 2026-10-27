"""Drains under the downpipes that had none (issue #218: 72 of 1526 pipe feet ended on the pavement or the street with
no iron under them).
    python pipe_drains.py <pavements dump> <ground dump> <out candidate>
<pavements dump>: dump-pavements.gd of the installed town with r000209, r000016 and r000615 (the drainage iron);
<ground dump>: dump-ground.gd (the street ground, to find the kerb's way).
Each pipe foot is found as the drainage repair (#163) made them: mid-height iron in 10 cm cells, grouped; a foot with
no low iron within 35 cm is bare. Every drained foot is a template: its low iron within a strip from the foot out
along the wall's normal (to past the kerb), its wall normal (the nearest house outline's edge), its kerb distance (to
the nearest seen street ground along that normal) and its ground height. A bare foot takes the template of its kind
(a pavement set: channel plate, receiver and kerb mouth; or a street gully) whose kerb distance is nearest, turned
to its own wall, moved to its foot and set on its own ground; the vertex colour's alpha is the pipe's own (the house's
mark: a razed house loses it). Feet over steps (ground 0.5 m or more up) and feet of razed houses are left.
The new triangles are appended to the iron surface of the pipe's own block mesh (Solid skips that surface: the plates
and gullies are flat and walkable). Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, math, pathlib, hashlib
import numpy as np, shapely
from shapely.geometry import Polygon, Point, LineString
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

REPO = pathlib.Path(__file__).resolve().parents[3]
IRON = 'res://world/town/resources/r000615.res'

def main():
    pave, ground, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(pave / 'pavements.json'))
    R = np.fromfile(pave / 'pavements.f32', np.float32).reshape(-1, 3, 20).astype(np.float64)
    iron = np.zeros(len(R), bool); owner = np.zeros(len(R), int)
    for k, e in enumerate(info):
        sl = slice(e['first'] // 3, (e['first'] + e['corners']) // 3); owner[sl] = k
        if e['material'] == IRON: iron[sl] = True
    cb = json.load(open(REPO / 'native-godot/world/data/shared/city_build.json'))
    edges = []                                  # (segment, outward normal, house, gone)
    for hi, h in enumerate(cb['houses']):
        fp = h.get('fp', [])
        if len(fp) < 3: continue
        P = Polygon(fp)
        for a, b in zip(fp, fp[1:] + fp[:1]):
            a, b = np.array(a), np.array(b); t = b - a; L = np.hypot(*t)
            if L < 0.3: continue
            n = np.array([t[1], -t[0]]) / L
            if P.contains(Point(*((a + b) / 2 + n * 0.05))): n = -n
            edges.append((LineString([a, b]), n, hi, bool(h.get('gone'))))
    etree = shapely.STRtree([e[0] for e in edges])
    gj = json.load(open(ground / 'ground.json')); seen = []
    for name, tile in [('ground_cobble', 3.0), ('ground_quay', 2.5)]:
        G = np.fromfile(ground / gj[name]['surfaces'][0]['file'], np.float32).reshape(-1, 3, 16).astype(np.float64)
        hid = np.abs(G[:, :, [6, 7]] * tile - G[:, :, [0, 2]]).max((1, 2)) < 2e-3
        seen.append(shapely.polygons(G[~hid][:, :, [0, 2]]))
    seen = np.concatenate(seen); stree = shapely.STRtree(seen)
    stone = ~iron
    S = R[stone]; Sc = S[:, :, [0, 2]].mean(1); st = cKDTree(Sc)
    # the feet
    I = np.nonzero(iron)[0]
    IC = R[I][:, :, :3]
    lowm = IC[:, :, 1].max(1) < 0.15
    low = I[lowm]; lt = cKDTree(R[low][:, :, [0, 2]].mean(1))
    mid = I[(IC[:, :, 1].min(1) > 0.15) & (IC[:, :, 1].min(1) < 0.5)]
    mc = R[mid][:, :, [0, 2]].mean(1)
    cell = np.floor(mc / 0.1).astype(int); u, inv = np.unique(cell, axis=0, return_inverse=True)
    ymin = np.full(len(u), 9.0); np.minimum.at(ymin, inv, R[mid][:, :, 1].min(1))
    cen = (u + 0.5) * 0.1; ct = cKDTree(cen); pairs = np.array(list(ct.query_pairs(0.15)))
    g = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])), shape=(len(u), len(u))) if len(pairs) else coo_matrix((len(u), len(u)))
    _, lab = connected_components(g, directed=False)
    feet = []
    for l in np.unique(lab):
        m = lab == l; c = cen[m].mean(0); y = ymin[m].min()
        if y >= 0.45: continue
        tris = mid[np.isin(inv, np.nonzero(m)[0])]
        feet.append(dict(c=c, y=float(y), drained=len(lt.query_ball_point(c, 0.35)) > 0, tris=tris))
    def frame(f):
        c = f['c']; p = Point(*c)
        near = etree.query(p.buffer(0.6), predicate='intersects')
        if not len(near): return None
        e = min((edges[i] for i in near), key=lambda e: e[0].distance(p))
        n = e[1]
        # ground under the foot (the stone faces near it), and the kerb: the first seen street ground along n
        j = st.query_ball_point(c, 0.25); top = float(S[j][:, :, 1].mean(1).max()) if j else 0.0
        kerb = None
        for d in np.arange(0.05, 4.0, 0.05):
            q = Point(*(c + n * d))
            h = stree.query(q, predicate='intersects')
            if len(h): kerb = d; break
        return dict(n=n, top=top, kerb=kerb, house=e[2], gone=e[3])
    for f in feet: f['frame'] = frame(f)
    # templates: the low iron in the strip from the foot out along n
    lowc = R[low][:, :, [0, 2]].mean(1)
    def strip(f):
        fr = f['frame']; c = f['c']; n = fr['n']; s = np.array([-n[1], n[0]])
        reach = (fr['kerb'] or 0.4) + 0.35
        rel = lowc - c; a = rel @ n; b = rel @ s
        return low[(a > -0.25) & (a < reach) & (np.abs(b) < 0.3)]
    pav = [f for f in feet if f['drained'] and f['frame'] and f['frame']['top'] > 0.05 and f['frame']['top'] < 0.4 and f['frame']['kerb']]
    gul = [f for f in feet if f['drained'] and f['frame'] and f['frame']['top'] <= 0.05]
    report = dict(feet=len(feet), bare=sum(1 for f in feet if not f['drained']), laid=0, skipped=[])
    adds = {}
    for f in feet:
        if f['drained']: continue
        fr = f['frame']; at = [round(float(f['c'][0]), 2), round(float(f['c'][1]), 2)]
        if fr is None: report['skipped'].append(dict(at=at, why='no house wall near')); continue
        if fr['gone']: report['skipped'].append(dict(at=at, why='its house is razed')); continue
        if fr['top'] >= 0.4: report['skipped'].append(dict(at=at, why='over a step')); continue
        pool = pav if fr['top'] > 0.05 else gul
        if fr['top'] > 0.05 and fr['kerb'] is None: report['skipped'].append(dict(at=at, why='kerb not found')); continue
        key = (lambda t: abs(t['frame']['kerb'] - fr['kerb'])) if fr['top'] > 0.05 else (lambda t: np.hypot(*(t['c'] - f['c'])))
        tpl = min(pool, key=key)
        rows = R[strip(tpl)].copy()
        if not len(rows): report['skipped'].append(dict(at=at, why='template empty')); continue
        # rigid move: template foot -> this foot, its n -> this n, its ground -> this ground
        a0 = math.atan2(tpl['frame']['n'][1], tpl['frame']['n'][0]); a1 = math.atan2(fr['n'][1], fr['n'][0]); th = a1 - a0
        c_, s_ = math.cos(th), math.sin(th)
        Rm = np.array([[c_, -s_], [s_, c_]])
        def turn(v): return v @ Rm.T
        xz = rows[:, :, [0, 2]] - tpl['c']; rows[:, :, [0, 2]] = turn(xz) + f['c']
        rows[:, :, 1] += fr['top'] - tpl['frame']['top']
        for o in (3, 16):
            v = rows[:, :, [o, o + 2]]; rows[:, :, [o, o + 2]] = turn(v)
        alpha = float(np.median(R[f['tris']][:, :, 13]))
        rows[:, :, 13] = alpha
        e = info[owner[f['tris'][0]]]
        adds.setdefault((e['mesh'], e['node'], e['surface']), []).append(rows)
        report['laid'] += 1
    manifest = {}
    for (mesh, node, si), rr in adds.items():
        e = next(x for x in info if x['mesh'] == mesh and x['surface'] == si)
        old = R[e['first'] // 3:(e['first'] + e['corners']) // 3]
        allr = np.concatenate([old] + rr).astype(np.float32)
        fn = f'{pathlib.Path(mesh).stem}-{si}.f32'; allr.tofile(out / fn)
        m = manifest.setdefault(mesh, {'mesh': mesh, 'nodePath': node, 'sourceHash': hashlib.sha256((REPO / 'native-godot' / mesh[6:]).read_bytes()).hexdigest(), 'surfaces': []})
        m['surfaces'].append({'index': si, 'file': fn, 'material': IRON, 'custom0': e['custom0Stride'] > 0, 'tangent': True})
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': list(manifest.values())}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print({k: (v if k != 'skipped' else len(v)) for k, v in report.items()}, 'templates', len(pav), len(gul))
    import collections; print(collections.Counter(s['why'] for s in report['skipped']))

if __name__ == '__main__':
    main()
