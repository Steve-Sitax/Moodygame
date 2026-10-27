"""The dressed stone's step and plinth tops laid along their stones (#199: the flat low tops, 917 m2, kept the world's
grid: their picture ran east-west whatever way the step or plinth ran).
    python step_tops.py <dressed dump> <out candidate>
<dressed dump>: dump-pavements.gd of the installed town with the dressed-stone material (20 floats a corner).
Each stone (its dice UV2.y, joined by shared corners) gets its flat tops under 0.8 m re-mapped: the same scale and the
same picture at the stone's middle, its u along the stone's long side (the tops' longest axis), turned no further
than needed and never mirrored. Only uv changes; positions, normals, colours, UV2, custom0 and tangents stay.
Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, math, pathlib, hashlib
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

REPO = pathlib.Path(__file__).resolve().parents[3]
DRESSED = 'res://assets/materials/stone-corners-20261017/dressed-stone.tres'

def main():
    dump, out = map(pathlib.Path, sys.argv[1:3]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(dump / 'pavements.json'))
    R = np.fromfile(dump / 'pavements.f32', np.float32).reshape(-1, 3, 20).astype(np.float64)
    new = R.copy()
    n = np.cross(R[:, 1, :3] - R[:, 0, :3], R[:, 2, :3] - R[:, 0, :3]); a = np.linalg.norm(n, axis=1) / 2
    flat = (np.abs(n[:, 1]) > 0.9 * 2 * a) & (a > 1e-7)
    top = flat & (np.round(R[:, 0, 8]) > 0.5) & (R[:, :, 1].mean(1) < 0.8)
    report = dict(stones=0, faces=0, area=0.0, turnedDeg=[])
    touched = set()
    for k, e in enumerate(info):
        lo, hi = e['first'] // 3, (e['first'] + e['corners']) // 3
        idx = lo + np.nonzero(top[lo:hi])[0]
        if not len(idx): continue
        T = R[idx]
        # stones: same dice, joined by shared corners
        key = np.round(T[:, :, [0, 1, 2]].reshape(-1, 3) * 1e4).astype(np.int64)
        _, vid = np.unique(key, axis=0, return_inverse=True); vid = vid.reshape(-1, 3)
        ed = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]]]); nv = vid.max() + 1
        _, lab = connected_components(coo_matrix((np.ones(len(ed)), (ed[:, 0], ed[:, 1])), shape=(nv, nv)), directed=False)
        flab = lab[vid[:, 0]] * 4096 + (np.round(T[:, 0, 9] * 4095)).astype(np.int64)
        for s in np.unique(flab):
            f = np.nonzero(flab == s)[0]; F = T[f]
            X = F[:, :, [0, 2]]; U = F[:, :, 6:8]
            M = np.stack([X[:, 1] - X[:, 0], X[:, 2] - X[:, 0]], 2); dU = np.stack([U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]], 2)
            ok = np.abs(np.linalg.det(M)) > 1e-10
            if not ok.any(): continue
            J = (dU[ok] @ np.linalg.inv(M[ok])).mean(0)          # the stone's d uv / d (x, z)
            sv = np.linalg.svd(J, compute_uv=False); scale = float(np.sqrt(sv[0] * sv[1]))
            P = X.reshape(-1, 2); c0 = P.mean(0)
            w = np.repeat(a[idx[f]], 3)
            C = np.cov((P - c0).T, aweights=w)
            ev, evec = np.linalg.eigh(C); d = evec[:, 1]                # the long axis
            if ev[1] < 1.3 * ev[0]: continue                           # (a square block: leave it)
            # u along d, its sign the nearer to the old u; v the old v's side (no mirror)
            ju = J[0] / max(np.linalg.norm(J[0]), 1e-12)
            if d @ ju < 0: d = -d
            dp = np.array([-d[1], d[0]])
            if np.sign(np.linalg.det(J)) != np.sign(np.linalg.det(np.stack([d, dp]))): dp = -dp
            Jn = scale * np.stack([d, dp])
            uv0 = U.reshape(-1, 2).mean(0) + J @ (c0 - P.mean(0))     # the picture at the middle stays
            rel = X - c0
            new[idx[f], :, 6:8] = uv0 + np.einsum('ij,nkj->nki', Jn, rel)
            report['stones'] += 1; report['faces'] += len(f); report['area'] += float(a[idx[f]].sum())
            report['turnedDeg'].append(round(math.degrees(math.acos(np.clip(d @ ju, -1, 1))), 1))
            touched.add(k)
    manifest = {}
    for k in sorted(touched):
        e = info[k]; lo, hi = e['first'] // 3, (e['first'] + e['corners']) // 3
        fn = f'{pathlib.Path(e["mesh"]).stem}-{e["surface"]}.f32'; new[lo:hi].astype(np.float32).tofile(out / fn)
        m = manifest.setdefault(e['mesh'], {'mesh': e['mesh'], 'nodePath': e['node'], 'sourceHash': hashlib.sha256((REPO / 'native-godot' / e['mesh'][6:]).read_bytes()).hexdigest(), 'surfaces': []})
        m['surfaces'].append({'index': e['surface'], 'file': fn, 'material': DRESSED, 'custom0': e['custom0Stride'] > 0, 'tangent': True})
    t = np.array(report['turnedDeg']); report['turnedDeg'] = dict(median=float(np.median(t)) if len(t) else 0, over45=int((t > 45).sum()), hist=np.histogram(t, bins=[0, 5, 20, 40, 50, 70, 85, 95, 135, 180])[0].tolist())
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': list(manifest.values())}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report, 'surfaces', len(touched))

if __name__ == '__main__':
    main()
