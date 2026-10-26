"""Barrels, kegs and water butts of the town's clutter, rebuilt (Steve, 2026-10-26: the barrels were very low poly).
    python barrels.py <clutter dump> <out candidate>
<clutter dump>: dump-meshes.gd of the town's clutter_solid* meshes (20 floats a corner, every surface).
The bake's barrel (build_clutter.py barrel_at) was an 8-sided lathe of 64 triangles, two 8-sided hoops and an
8-sided lid, in the clutter atlas's 256 x 128 picture: 298 barrels (0.8 m), 231 kegs (0.52 m) and 74 water butts
(0.92 m, open, water 8 cm under the rim). Each is taken out of the clutter's surface 0 and laid again in its place:
- 16 staves, each its own board of the town's weathered timber (environment-20261013/wall-wood, its grain along
  the stave; with mipmaps and a height of its own grain, barrels-20261026), bulging to the belly, a joint between
  staves (the stave's middle lighter than its edges), each stave its own tone;
- four iron hoops standing 4 mm proud (barrel-iron: the town's iron and its height);
- the chime: the staves run 2.5 cm past the head; the head sunk in (the barrel's and keg's) or water in the butt
  (the old water face's picture, in the clutter's surface);
- dirt at the foot, each barrel its own tone, size as the old one, a slight lean.
New surfaces on the same mesh (wood, then iron); collision stays the old faces (the promotion keeps every replaced
surface's old faces as its stand-in). Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, pathlib, hashlib, math
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

REPO = pathlib.Path(__file__).resolve().parents[3]
CLUTTER = 'res://world/town/resources/r003027.res'
WOOD = 'res://assets/materials/barrels-20261026/barrel-wood.tres'
IRON = 'res://assets/materials/barrels-20261026/barrel-iron.tres'
STAVES = 16
BOARD = (1.8, 0.6)      # metres the board picture covers (along the grain, across)
IRON_TILE = 0.5
KINDS = {0.80: 'barrel', 0.52: 'keg', 0.92: 'butt'}

def components(P):
    vk = np.round(P.reshape(-1, 3) * 1e4).astype(np.int64)
    _, vid = np.unique(vk, axis=0, return_inverse=True); vid = vid.reshape(-1, 3)
    e = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]]]); n = vid.max() + 1
    _, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)), directed=False)
    return lab[vid[:, 0]]

def row(p, n, uv, col, tg):
    return np.concatenate([p, n, uv, [0, 0], col, [0, 0], tg, [1.0]])

def tri_rows(out, a, b, c):
    """One face in the town's winding (clockwise seen from its front: its corners' normals give the front)."""
    pa, pb, pc = a[:3], b[:3], c[:3]
    if np.cross(pb - pa, pc - pa) @ (a[3:6] + b[3:6] + c[3:6]) > 0: b, c = c, b
    out += [a, b, c]

def build(rng, base, r, h, water, lean, yaw, waterface):
    """One barrel's faces: (wood rows, iron rows, water rows), world space."""
    wood, iron, wet = [], [], []
    rb, rh = r * 1.03, r * 0.86                     # belly, head
    rad = lambda s: rh + (rb - rh) * (1 - (2 * s - 1) ** 2)
    drad = lambda s: (rb - rh) * (-4 * (2 * s - 1)) / h     # d radius / d height
    S = np.array([0.0, 0.12, 0.3, 0.5, 0.7, 0.88, 1.0])
    Y = S * h; Y[0] = -0.01
    c, s_ = math.cos(yaw), math.sin(yaw)
    lx, lz = lean
    def W(p):
        x, y, z = p
        x, z = c * x - s_ * z, s_ * x + c * z
        y, z = y * math.cos(lx) - z * math.sin(lx), y * math.sin(lx) + z * math.cos(lx)
        x, y = x * math.cos(lz) - y * math.sin(lz), x * math.sin(lz) + y * math.cos(lz)
        return np.array([x, y, z]) + base
    def Wn(n):
        x, y, z = n
        x, z = c * x - s_ * z, s_ * x + c * z
        y, z = y * math.cos(lx) - z * math.sin(lx), y * math.sin(lx) + z * math.cos(lx)
        x, y = x * math.cos(lz) - y * math.sin(lz), x * math.sin(lz) + y * math.cos(lz)
        return np.array([x, y, z])
    tone = rng.uniform(0.78, 1.0) * np.array([1.0, rng.uniform(0.95, 1.0), rng.uniform(0.9, 1.0)])
    def wood_col(y, edge):
        k = tone * (0.72 + 0.28 * edge)
        k = k * (0.6 + 0.4 * min(1.0, max(0.0, y / 0.12)))
        return np.r_[np.clip(k, 0, 1), 1.0]
    # profile arc length (the board's length along the stave)
    ss = np.linspace(0, 1, 201); rr = np.array([rad(x) for x in ss])
    arc = np.r_[0, np.cumsum(np.hypot(np.diff(rr), np.diff(ss) * h))]
    along = lambda s: np.interp(s, ss, arc)
    for k in range(STAVES):
        ta, tb = 2 * math.pi * k / STAVES, 2 * math.pi * (k + 1) / STAVES; tm = (ta + tb) / 2
        st = rng.uniform(0.85, 1.12)
        u0 = rng.uniform(0.0, 1 - (arc[-1] + 0.05) / BOARD[0]); v0 = rng.uniform(0.0, 0.8)
        cols = [(ta, 0.0), (tm, 1.0), (tb, 0.0)]
        for i in range(len(S) - 1):
            quad = []
            for (si, yi) in ((S[i], Y[i]), (S[i + 1], Y[i + 1])):
                rs = rad(si)
                for th, edge in cols:
                    p = np.array([rs * math.cos(th), yi, rs * math.sin(th)])
                    n = np.array([math.cos(tm), -drad(si), math.sin(tm)]); n /= np.linalg.norm(n)
                    across = (th - ta) * rs
                    uv = np.array([u0 + along(si) / BOARD[0], v0 + across / BOARD[1]])
                    tg = np.array([0.0, 1.0, 0.0])
                    quad.append(row(W(p), Wn(n), uv, wood_col(yi, edge) * np.r_[st, st, st, 1], Wn(tg)))
            a0, a1, a2, b0, b1, b2 = quad
            for x, y, z in ((a0, a1, b1), (a0, b1, b0), (a1, a2, b2), (a1, b2, b1)): tri_rows(wood, x, y, z)
    # the chime and head: the rim on the staves' top, the inside down to the head (or the water), the head
    top = h; thick = 0.02; inner = rad(1.0) - thick
    floor = h - (0.08 if water else 0.025)
    ring = [2 * math.pi * j / (2 * STAVES) for j in range(2 * STAVES)]
    up = np.array([0, 1.0, 0])
    for j in range(2 * STAVES):
        t0, t1 = ring[j], ring[(j + 1) % (2 * STAVES)]
        o0 = np.array([rad(1.0) * math.cos(t0), top, rad(1.0) * math.sin(t0)]); o1 = np.array([rad(1.0) * math.cos(t1), top, rad(1.0) * math.sin(t1)])
        i0 = np.array([inner * math.cos(t0), top, inner * math.sin(t0)]); i1 = np.array([inner * math.cos(t1), top, inner * math.sin(t1)])
        f0 = np.array([inner * math.cos(t0), floor, inner * math.sin(t0)]); f1 = np.array([inner * math.cos(t1), floor, inner * math.sin(t1)])
        uvp = lambda p: np.array([0.3 + p[0] / BOARD[0], 0.2 + p[2] / BOARD[1]])
        rc = tone * 0.95
        R = lambda p, n, uv, k=1.0: row(W(p), Wn(n), uv, np.r_[np.clip(rc * k, 0, 1), 1.0], Wn(np.array([1.0, 0, 0])))
        tri_rows(wood, R(o0, up, uvp(o0)), R(o1, up, uvp(o1)), R(i1, up, uvp(i1)))
        tri_rows(wood, R(o0, up, uvp(o0)), R(i1, up, uvp(i1)), R(i0, up, uvp(i0)))
        n0 = -np.array([math.cos(t0), 0, math.sin(t0)]); n1 = -np.array([math.cos(t1), 0, math.sin(t1)])
        wu = lambda t, y: np.array([0.5 + t * inner / BOARD[0], 0.1 + y / BOARD[1]])
        tri_rows(wood, R(i0, n0, wu(t0, top), 0.7), R(i1, n1, wu(t1, top), 0.7), R(f1, n1, wu(t1, floor), 0.55))
        tri_rows(wood, R(i0, n0, wu(t0, top), 0.7), R(f1, n1, wu(t1, floor), 0.55), R(f0, n0, wu(t0, floor), 0.55))
        mid = np.array([0, floor, 0])
        if water:
            Rw = lambda p: row(W(p), Wn(up), waterface['uv'], waterface['col'], Wn(np.array([1.0, 0, 0])))
            tri_rows(wet, Rw(mid), Rw(f0), Rw(f1))
        else:
            # the head: boards across (the board picture across the barrel), a little darker
            hp = lambda p: np.array([0.62 + p[0] / BOARD[0], 0.45 + p[2] / BOARD[1]])
            tri_rows(wood, R(mid, up, hp(mid), 0.85), R(f0, up, hp(f0), 0.85), R(f1, up, hp(f1), 0.85))
    # the hoops: near each end and at the quarters, 4 mm proud
    hw = 0.035 * (h / 0.8) ** 0.5
    for sc in (0.06, 0.24, 0.76, 0.94):
        y0, y1 = sc * h - hw / 2, sc * h + hw / 2
        rr0, rr1 = rad(y0 / h), rad(y1 / h)
        out = 0.004 / math.cos(math.pi / STAVES)
        for j in range(STAVES):
            t0, t1 = 2 * math.pi * j / STAVES, 2 * math.pi * (j + 1) / STAVES
            def P(t, y, rr_, o): return np.array([(rr_ / math.cos(math.pi / STAVES) + o) * math.cos(t), y, (rr_ / math.cos(math.pi / STAVES) + o) * math.sin(t)])
            nrm = lambda t: np.array([math.cos(t), 0, math.sin(t)])
            uvh = lambda t, y: np.array([t * rr0 / IRON_TILE, y / IRON_TILE + sc])
            col = np.r_[np.clip(tone * 0.9, 0, 1), 1.0]
            Ri = lambda p, n, uv: row(W(p), Wn(n), uv, col, Wn(np.array([-math.sin(t0), 0, math.cos(t0)])))
            a0, a1 = P(t0, y0, rr0, out), P(t1, y0, rr0, out); b0, b1 = P(t0, y1, rr1, out), P(t1, y1, rr1, out)
            tri_rows(iron, Ri(a0, nrm(t0), uvh(t0, y0)), Ri(a1, nrm(t1), uvh(t1, y0)), Ri(b1, nrm(t1), uvh(t1, y1)))
            tri_rows(iron, Ri(a0, nrm(t0), uvh(t0, y0)), Ri(b1, nrm(t1), uvh(t1, y1)), Ri(b0, nrm(t0), uvh(t0, y1)))
    return [np.array(x, np.float32).reshape(-1, 20) if x else np.zeros((0, 20), np.float32) for x in (wood, iron, wet)]

def main():
    clutter, out = map(pathlib.Path, sys.argv[1:3]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(clutter / 'meshes.json'))
    manifest = []; report = dict(meshes=0, kinds={}, oldTriangles=0, woodTriangles=0, ironTriangles=0)
    for path, rec in sorted(info.items()):
        s0 = rec['surfaces'][0]
        if s0['material'] != CLUTTER: continue
        R = np.fromfile(clutter / s0['file'], np.float32).reshape(-1, 3, 20)
        lab = components(R[:, :, :3]); drop = np.zeros(len(R), bool)
        parts = {}
        for l in np.unique(lab):
            f = np.nonzero(lab == l)[0]; Q = R[f][:, :, :3].reshape(-1, 3).astype(float)
            parts[l] = (f, Q, (Q.max(0) + Q.min(0)) / 2, Q.max(0) - Q.min(0))
        wood, iron, wet = [], [], []
        for l, (f, Q, c, ext) in parts.items():
            if len(f) != 64 or abs(ext[0] - ext[2]) > 0.03: continue
            kind = next((v for k, v in KINDS.items() if abs(ext[1] - k) < 0.015), None)
            if kind is None: continue
            y0, top = Q[:, 1].min(), Q[:, 1].max()
            att = [m for m, (g, _, d, e) in parts.items() if m != l and np.hypot(d[0] - c[0], d[2] - c[2]) < 0.03 and y0 - 0.01 <= d[1] <= top + 0.01 and len(g) in (16, 6)]
            hoops = [m for m in att if len(parts[m][0]) == 16]; lids = [m for m in att if len(parts[m][0]) == 6]
            if len(hoops) != 2 or len(lids) != 1: continue
            lid = parts[lids[0]]; lid_y = lid[2][1] - y0
            h = top - y0; water = lid_y < h - 0.05
            r = float(np.hypot(Q[:, 0] - c[0], Q[:, 2] - c[2]).max() / 1.03)
            seed = int(hashlib.sha256(f'{c[0]:.2f},{c[2]:.2f}'.encode()).hexdigest()[:8], 16); rng = np.random.default_rng(seed)
            wf = dict(uv=R[lid[0]][:, :, 6:8].reshape(-1, 2).mean(0), col=R[lid[0]][0, 0, 10:14]) if water else None
            w, i, wt = build(rng, np.array([c[0], y0, c[2]]), r, h, water, tuple(rng.uniform(-1, 1, 2) * math.radians(0.6)),
                             rng.uniform(0, 2 * math.pi), wf)
            wood.append(w); iron.append(i); wet.append(wt)
            for m in [l] + hoops + lids: drop[parts[m][0]] = True
            report['kinds'][kind] = report['kinds'].get(kind, 0) + 1
        if not wood: continue
        stem = pathlib.Path(rec['mesh']).stem
        keep = np.concatenate([R[~drop].reshape(-1, 20), np.concatenate(wet)]).astype(np.float32)
        keep.tofile(out / f'{stem}-0.f32')
        surfs = [{'index': 0, 'file': f'{stem}-0.f32', 'material': CLUTTER, 'custom0': False, 'tangent': True}]
        # the mesh's other surfaces (the guard stones') stay; the barrels' after them
        n = len(rec['surfaces'])
        W = np.concatenate(wood); I = np.concatenate(iron)
        W.tofile(out / f'{stem}-{n}.f32'); I.tofile(out / f'{stem}-{n + 1}.f32')
        surfs += [{'index': n, 'file': f'{stem}-{n}.f32', 'material': WOOD, 'custom0': False, 'tangent': True},
                  {'index': n + 1, 'file': f'{stem}-{n + 1}.f32', 'material': IRON, 'custom0': False, 'tangent': True}]
        manifest.append({'mesh': rec['mesh'], 'nodePath': path,
                         'sourceHash': hashlib.sha256((REPO / 'native-godot' / rec['mesh'][6:]).read_bytes()).hexdigest(), 'surfaces': surfs})
        report['meshes'] += 1; report['oldTriangles'] += int(drop.sum())
        report['woodTriangles'] += len(W) // 3; report['ironTriangles'] += len(I) // 3
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report)

if __name__ == '__main__':
    main()
