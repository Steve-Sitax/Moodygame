# H5: each pavement / kerb-top / step triangle of the town blocks' old stone: the way its flags' courses run (along the
# nearest street edge within 6 m; else the world's x, as before).
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import json, sys, pickle, numpy as np, shapely
from scipy.spatial import cKDTree
import layout as L
D = W + 'slabdump/'
info = json.load(open(D + 'slabs.json'))
segs = []
for k in ['cobble', 'quay', 'flags']:
    lay = pickle.load(open(L.W + f'lay-{k}.pkl', 'rb'))
    for poly in lay.line.geoms:
        for ring in [poly.exterior] + list(poly.interiors):
            c = np.asarray(ring.coords); segs.append(np.stack([c[:-1], c[1:]], 1))
S = np.concatenate(segs); Ls = np.hypot(*(S[:, 1] - S[:, 0]).T); S = S[Ls > 0.4]; Ls = Ls[Ls > 0.4]
dirs = (S[:, 1] - S[:, 0]) / Ls[:, None]
tree = shapely.STRtree(shapely.linestrings(S))
out = []; tot = 0; turned = 0
for m in info:
    v = np.fromfile(D + m['node'] + '-v.f32', dtype=np.float32).reshape(-1, 6); idx = np.fromfile(D + m['node'] + '-i.i32', dtype=np.int32).reshape(-1, 3)
    P = v[:, :3][idx]
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); ln = np.linalg.norm(n, axis=1)
    flat = (ln > 1e-9) & (np.abs(n[:, 1]) / np.maximum(ln, 1e-12) > 0.9) & (P[:, :, 1].mean(1) < 0.8)
    ti = np.nonzero(flat)[0]; c = P[ti][:, :, [0, 2]].mean(1)
    i, j = tree.query_nearest(shapely.points(c), max_distance=6.0, return_distance=False, all_matches=False)
    d = np.tile([1.0, 0.0], (len(ti), 1)); d[i] = dirs[j]
    # one sign for a way (the courses look the same turned half round): x positive, or z positive along z
    flip = (d[:, 0] < -1e-6) | ((np.abs(d[:, 0]) <= 1e-6) & (d[:, 1] < 0)); d[flip] *= -1
    tot += len(ti); turned += len(i)
    out.append({'node': m['node'], 'mesh': m['mesh'], 'surface': m['surface'], 'tris': m['tris'], 'verts': m['verts'],
                'dirs': [[int(t), round(float(a), 6), round(float(b), 6)] for t, (a, b) in zip(ti, d)]})
json.dump(out, open(W + 'candidate/slab-dirs.json', 'w'))
print('flat low triangles', tot, 'turned to a kerb', turned)
