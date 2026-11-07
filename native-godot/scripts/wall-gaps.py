"""Find open edges in the town wall's shell (#301): slice every wall mesh at many heights, and report each dangling slice end
that is 2 cm..1.2 m from any other wall surface (a gap) or has nothing within 1.2 m (an open edge), with the middle of
the gap (mx, mz) for the game's see-through check (--wall-gaps, World/NativeWallGapCheck.cs).
    python wall-gaps.py <dump folder from dump-wall-meshes.gd> <out gaps.json>"""
import json, sys, numpy as np, pathlib
from scipy.spatial import cKDTree
D = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
idx = json.load(open(D / 'index.json'))
surf = []
for r in idx:
    for s in r['surfaces']:
        raw = np.fromfile(D / s['file'], np.float32)
        if raw.size % 9 or raw.size == 0: continue
        T = raw.reshape(-1, 3, 3).astype(np.float64)
        surf.append((r['name'], s['file'], T))
def slice_all(T, y):
    d = T[:, :, 1] - y
    s = np.sign(d); s[s == 0] = 1
    segs = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        m = s[:, i] != s[:, j]
        f = d[m, i] / (d[m, i] - d[m, j])
        p = T[m, i] + (T[m, j] - T[m, i]) * f[:, None]
        segs.append((np.nonzero(m)[0], p[:, [0, 2]]))
    # each crossing triangle has exactly two crossing edges: pair them
    ids = np.concatenate([a for a, _ in segs]); pts = np.concatenate([b for _, b in segs])
    o = np.argsort(ids, kind='stable'); ids, pts = ids[o], pts[o]
    u, start, cnt = np.unique(ids, return_index=True, return_counts=True)
    ok = cnt == 2
    a = pts[start[ok]]; b = pts[start[ok] + 1]
    return a, b
found = []
for y in np.arange(-3.75, 11.0, 0.25):
    A = []; B = []; owner = []
    for k, (name, f, T) in enumerate(surf):
        a, b = slice_all(T, y)
        if len(a): A.append(a); B.append(b); owner += [k] * len(a)
    if not A: continue
    A = np.concatenate(A); B = np.concatenate(B); owner = np.array(owner)
    keep = np.linalg.norm(A - B, axis=1) > 1e-5
    A, B, owner = A[keep], B[keep], owner[keep]
    E = np.concatenate([A, B]); eo = np.concatenate([owner, owner])
    tree = cKDTree(E)
    cnt = np.array([len(c) for c in tree.query_ball_point(E, 0.004)])
    dang = np.nonzero(cnt == 1)[0]
    if not len(dang): continue
    # distance from each dangling end to the nearest segment of any surface (points sampled densely along segments)
    L = np.linalg.norm(B - A, axis=1); n = np.maximum(1, np.ceil(L / 0.02)).astype(int)
    rep = np.repeat(np.arange(len(A)), n + 1); t = np.concatenate([np.linspace(0, 1, k + 1) for k in n])
    P = A[rep] + (B[rep] - A[rep]) * t[:, None]
    pt = cKDTree(P)
    for e in dang:
        seg = e % len(A)
        hits = pt.query_ball_point(E[e], 1.2)
        others = [h for h in hits if rep[h] != seg and np.linalg.norm(P[h] - E[e]) > 0.004]
        best = min(others, key=lambda h: np.linalg.norm(P[h] - E[e]), default=None)
        dist = np.linalg.norm(P[best] - E[e]) if best is not None else 9.9
        if dist > 0.02:
            mid = (E[e] + P[best]) / 2 if best is not None else E[e]
            found.append(dict(y=round(float(y), 2), x=round(float(E[e][0]), 3), z=round(float(E[e][1]), 3), gap=round(float(dist), 3),
                              mx=round(float(mid[0]), 3), mz=round(float(mid[1]), 3),
                              mesh=surf[eo[e]][0], file=surf[eo[e]][1]))
json.dump(found, open(out, 'w'), indent=1)
print(len(found), 'dangling ends over 2 cm')
