"""Independent check of a collision proxy (godot/src/World/CollisionProxy.cs, docs/startup.md).

Two-sided surface distance between two triangle soups (float32 x, y, z; nine values a triangle), as written by
native-godot/scripts/collision-proxy-proof.tscn. The candidates come from a dense point sample of the other surface;
the distance itself is the exact point-to-triangle distance, so the figures are an upper bound that is tight.
Needs numpy and scipy. Usage: python tools/collision/deviation.py original.f32 proxy.f32 [sample spacing, m]
"""
import sys, json, numpy as np
from scipy.spatial import cKDTree

def load(p):
    a = np.fromfile(p, dtype=np.float32).reshape(-1, 3, 3).astype(np.float64)
    return a

def sample(tris, spacing, rng):
    e1 = tris[:, 1] - tris[:, 0]; e2 = tris[:, 2] - tris[:, 0]
    area = 0.5 * np.linalg.norm(np.cross(e1, e2), axis=1)
    n = np.maximum(1, np.ceil(area / (spacing * spacing)).astype(np.int64))
    ids = np.repeat(np.arange(len(tris)), n)
    u = rng.random(len(ids)); v = rng.random(len(ids))
    flip = u + v > 1; u[flip] = 1 - u[flip]; v[flip] = 1 - v[flip]
    pts = tris[ids, 0] + e1[ids] * u[:, None] + e2[ids] * v[:, None]
    # every corner too: extremes sit at vertices
    pts = np.concatenate([pts, tris.reshape(-1, 3)]); ids = np.concatenate([ids, np.repeat(np.arange(len(tris)), 3)])
    return pts, ids, area

def point_tri(p, t):
    # Ericson, Real-Time Collision Detection 5.1.5, vectorised
    a, b, c = t[:, 0], t[:, 1], t[:, 2]
    ab = b - a; ac = c - a; ap = p - a
    d1 = (ab * ap).sum(1); d2 = (ac * ap).sum(1)
    bp = p - b; d3 = (ab * bp).sum(1); d4 = (ac * bp).sum(1)
    cp = p - c; d5 = (ab * cp).sum(1); d6 = (ac * cp).sum(1)
    vc = d1 * d4 - d3 * d2; vb = d5 * d2 - d1 * d6; va = d3 * d6 - d5 * d4
    denom = va + vb + vc
    with np.errstate(divide='ignore', invalid='ignore'):
        v = np.where(denom != 0, vb / denom, 0); w = np.where(denom != 0, vc / denom, 0)
        q = a + ab * v[:, None] + ac * w[:, None]
        m = (d1 <= 0) & (d2 <= 0); q[m] = a[m]
        m = (d3 >= 0) & (d4 <= d3); q[m] = b[m]
        m = (d6 >= 0) & (d5 <= d6); q[m] = c[m]
        m = (vc <= 0) & (d1 >= 0) & (d3 <= 0); t1 = np.where(d1 - d3 != 0, d1 / (d1 - d3), 0); q[m] = (a + ab * t1[:, None])[m]
        m = (vb <= 0) & (d2 >= 0) & (d6 <= 0); t2 = np.where(d2 - d6 != 0, d2 / (d2 - d6), 0); q[m] = (a + ac * t2[:, None])[m]
        den = (d4 - d3) + (d5 - d6)
        m = (va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0); t3 = np.where(den != 0, (d4 - d3) / den, 0); q[m] = (b + (c - b) * t3[:, None])[m]
    return np.linalg.norm(p - q, axis=1)

def one_sided(src, dst, spacing, k, rng, cap):
    sp, _, _ = sample(src, spacing, rng)
    if len(sp) > cap: sp = sp[rng.choice(len(sp), cap, replace=False)]
    dp, did, _ = sample(dst, spacing * 0.5, rng)
    tree = cKDTree(dp)
    _, nn = tree.query(sp, k=k, workers=-1)
    best = np.full(len(sp), np.inf)
    for j in range(k):
        best = np.minimum(best, point_tri(sp, dst[did[nn[:, j]]]))
    return best, sp

if __name__ == '__main__':
    a = load(sys.argv[1]); b = load(sys.argv[2]); rng = np.random.default_rng(7)
    spacing = float(sys.argv[3]) if len(sys.argv) > 3 else 0.03
    out = {}
    for name, s, d in (('original_to_proxy', a, b), ('proxy_to_original', b, a)):
        dist, pts = one_sided(s, d, spacing, 12, rng, 3_000_000)
        worst = pts[np.argmax(dist)]
        out[name] = dict(samples=int(len(dist)), max=float(dist.max()), p999=float(np.quantile(dist, .999)), p99=float(np.quantile(dist, .99)), mean=float(dist.mean()),
                         over_2cm=int((dist > .02).sum()), over_5cm=int((dist > .05).sum()), worst_at=[float(x) for x in worst])
    out['triangles'] = [len(a), len(b)]
    print(json.dumps(out, indent=1))
