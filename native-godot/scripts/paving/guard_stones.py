"""Guard stones (schampstenen) at the house corners, rebuilt (Steve, 2026-10-26: the corner poles were very low poly).
    python guard_stones.py <clutter dump> <near dump> <out candidate>
<clutter dump>: dump-meshes.gd of the town's clutter_solid* meshes (20 floats a corner). <near dump>: dump-near.gd round
the stones (radius 2 m), to find the wall behind each one.
The bake's guard stone was a 6-sided lathe, 48 triangles, 0.66 m high, in the clutter atlas's 256 x 128 picture. Each
one found in the clutter (a 48-triangle part of that height) is taken out of the clutter's surface and a new stone is laid
in the same place on a new surface of the same mesh: a Belgian blue-stone guard stone as they stood at Antwerp's corners,
a round tapering shaft sunk 4 cm into the paving, a chiselled groove under a rounded shoulder and a low domed head; its own small
irregularity, lean and tone; dirt at the foot, a worn band where wheels rubbed it on the street side, a rain-washed head.
Material: guard-stone.tres (the clutter's own shader kind, the town stairs' jointless blue stone with its height map).
Texture laid without stretch: the shaft and shoulder in a conformal unroll (no shear, scale 0.84 to 1.24, the picture once round, so no seam), the head from its top outwards (distance kept along the meridians, 1.0 to 1.11 round). Collision stays
the old stone's faces (the promotion keeps every replaced surface's old faces as the stand-in).
Writes manifest.json (surfaceRepairs, for stone-corners-promote.tscn) and report.json.
"""
import sys, json, pathlib, hashlib, math
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

REPO = pathlib.Path(__file__).resolve().parents[3]
CLUTTER = 'res://world/town/resources/r003027.res'
STONE = 'res://assets/materials/guard-stones-20261026/guard-stone.tres'
SEG = 28                # round the stone
# the profile (metres): foot sunk into the paving, tapering shaft, a chiselled groove under the head, shoulder fillet,
# domed head
FOOT, R_FOOT, Y_SHOULDER, R_SHOULDER, FILLET, CAP = -0.04, 0.17, 0.595, 0.128, 0.015, math.radians(45)
Y_GROOVE, GROOVE = 0.525, 0.005

def components(P):
    vk = np.round(P.reshape(-1, 3) * 1e4).astype(np.int64)
    _, vid = np.unique(vk, axis=0, return_inverse=True); vid = vid.reshape(-1, 3)
    e = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]]]); n = vid.max() + 1
    _, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(n, n)), directed=False)
    return lab[vid[:, 0]]

def is_old_stone(Q):
    """The bake's guard stone: 48 triangles, 0.66 m high, about 0.34 m across, round its own axis."""
    ext = Q.max(0) - Q.min(0)
    return len(Q) // 3 == 48 and abs(ext[1] - 0.66) < 0.015 and 0.29 < ext[0] < 0.36 and 0.29 < ext[2] < 0.36

def profile():
    """[(r, y, chart, gamma)]: chart 0 shaft and shoulder (conformal), 1 head (from the top); gamma: the head's angle."""
    pts = []
    def shaft(y):
        t = (y - FOOT) / (Y_SHOULDER - FOOT)
        return R_FOOT + (R_SHOULDER - R_FOOT) * t + 0.003 * math.sin(math.pi * t)
    ys = list(np.linspace(FOOT, Y_GROOVE - 0.013, 10))
    groove = [(-0.010, 0.35), (-0.005, 1.0), (0.005, 1.0), (0.010, 0.35)]
    for y in ys: pts.append((shaft(y), y, 0, None))
    for dy, k in groove: pts.append((shaft(Y_GROOVE + dy) - GROOVE * k, Y_GROOVE + dy, 0, None))
    for y in np.linspace(Y_GROOVE + 0.013, Y_SHOULDER, 4): pts.append((shaft(y), y, 0, None))
    # shoulder: a fillet tangent to the shaft and the head's sphere
    rc = (R_SHOULDER - FILLET) / math.sin(CAP)            # sphere centre to fillet centre
    R = rc + FILLET; yc = Y_SHOULDER - rc * math.cos(CAP)
    for g in np.linspace(math.pi / 2, CAP, 6)[1:]:
        pts.append((R_SHOULDER - FILLET + FILLET * math.sin(g), Y_SHOULDER + FILLET * math.cos(g), 0, None))
    for g in np.linspace(CAP, 0.0, 9)[1:-1]:                # (the top itself: the apex)
        pts.append((R * math.sin(g), yc + R * math.cos(g), 1, g))
    return pts, R, yc

def build(seed, scale_r, scale_h, front, base, lean):
    """One stone's rows (20 floats a corner, world space)."""
    rng = np.random.default_rng(seed)
    pts, R, yc = profile()
    nring = len(pts)
    th = np.linspace(0, 2 * math.pi, SEG + 1)[:-1]
    # the shape: profile, small irregularity (whole waves round, none at the top), stone's own size
    k = np.array([2, 3, 5]); amp = np.array([0.0018, 0.0012, 0.0007]); ph = rng.uniform(0, 2 * math.pi, (3, 2))
    P = np.zeros((nring, SEG, 3)); s_arc = np.zeros(nring)
    prof = np.array([(p[0], p[1]) for p in pts])
    s_arc[1:] = np.cumsum(np.hypot(*np.diff(prof, axis=0).T))
    for i, (r, y, chart, g) in enumerate(pts):
        wob = sum(amp[j] * np.sin(k[j] * th + ph[j, 0]) * math.cos(9.0 * y + ph[j, 1]) for j in range(3))
        rr = (r + wob * min(1.0, r / 0.1)) * scale_r
        P[i, :, 0] = rr * np.cos(th); P[i, :, 2] = rr * np.sin(th); P[i, :, 1] = y * scale_h
    apex = np.array([0.0, (yc + R) * scale_h, 0.0])
    # vertex normals over the closed grid (and the apex fan)
    V = np.concatenate([P.reshape(-1, 3), apex[None]]); top = len(V) - 1
    idx = lambda i, j: i * SEG + (j % SEG)
    faces = []
    for i in range(nring - 1):
        for j in range(SEG):
            a, b, c, d = idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)
            faces += [(a, b, c), (a, c, d)]          # clockwise seen from outside (Godot's front)
    for j in range(SEG): faces.append((idx(nring - 1, j), idx(nring - 1, j + 1), top))
    F = np.array(faces)
    fn = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    N = np.zeros_like(V)
    for c in range(3): np.add.at(N, F[:, c], -fn)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    if fn[0] @ (V[F[0, 0]] - np.array([0, V[F[0, 0], 1], 0])) > 0: raise RuntimeError('faces turned the wrong way')
    # the texture: shaft/shoulder conformal (u = r0 theta, v = integral r0 / r ds), head polar from the apex
    # one repeat of the (seamless) picture exactly round the shaft: no seam behind; 0.91 m a repeat
    r0 = 0.145 * scale_r; tile = 2 * math.pi * r0
    ds = np.diff(s_arc) * scale_r; rmid = (prof[1:, 0] + prof[:-1, 0]) / 2 * scale_r
    vconf = np.concatenate([[0.0], np.cumsum(r0 / rmid * ds)])
    off = rng.uniform(0, 1, 4)
    # theta measured from the street side; u wraps (theta = pi) behind, against the wall
    front_a = math.atan2(front[1], front[0])
    def uv_of(i, j, wrap, chart):
        t = th[j] - front_a
        t = (t + math.pi) % (2 * math.pi) - math.pi
        if wrap and t < 0: t += 2 * math.pi
        if chart == 0: return np.array([r0 * t / tile + off[0], vconf[i] / tile + off[1]])
        # (the shoulder's last ring is the head's first: gamma = CAP there)
        rho = R * (pts[i][3] if pts[i][3] is not None else CAP) * scale_r
        return np.array([rho * math.cos(t) / tile + off[2], rho * math.sin(t) / tile + off[3]])
    def uv_apex(): return np.array([off[2], off[3]])
    # tones: the stone's own, dirt at the foot, the wheel-worn band on the street side, the washed head
    base_tone = rng.uniform(0.80, 0.94); tint = np.array([0.97, 0.99, 1.0])
    def colour(p, n):
        y = p[1] / scale_h; t = math.atan2(p[2], p[0]) - front_a
        c = base_tone * tint
        c = c * (0.55 + 0.45 * np.clip(y / 0.16, 0, 1) ** 0.8) * np.array([1.0, 0.97, 0.93]) ** (1 - np.clip(y / 0.14, 0, 1))
        rub = max(math.cos(t), 0.0) ** 2 * math.exp(-((y - 0.33) / 0.09) ** 2)
        c = c * (1 + 0.10 * rub)
        c = c * (1 + 0.06 * np.clip(n[1], 0, 1))
        c = c * (1 - 0.10 * np.clip(-n[1], 0, 1))
        c = c * (1 - 0.22 * math.exp(-((y - Y_GROOVE) / 0.008) ** 2))     # dirt in the groove
        return np.clip(np.concatenate([c, [1.0]]), 0, 1)
    # world: lean a little, then turn so x is the stone's own axis frame, then move to the base
    lx, lz = lean
    Rx = np.array([[1, 0, 0], [0, math.cos(lx), -math.sin(lx)], [0, math.sin(lx), math.cos(lx)]])
    Rz = np.array([[math.cos(lz), -math.sin(lz), 0], [math.sin(lz), math.cos(lz), 0], [0, 0, 1]])
    M = Rz @ Rx
    rows = []
    def corner(vi, i, j, wrap, chart):
        p = V[vi]; n = N[vi]
        uv = uv_apex() if vi == top else uv_of(i, j, wrap, chart)
        # tangent: the direction of growing u on the surface
        if vi == top:
            tg = np.array([1.0, 0, 0])
        elif chart == 1:
            t = th[j] - front_a
            ring = np.array([-math.sin(th[j]), 0, math.cos(th[j])]); merid = np.array([math.cos(th[j]), 0, math.sin(th[j])])
            down = merid - n * (merid @ n); down /= max(np.linalg.norm(down), 1e-9)
            tg = math.cos(t) * down - math.sin(t) * ring
        else:
            tg = np.array([-math.sin(th[j]), 0, math.cos(th[j])])
        tg = tg - n * (tg @ n); tg /= max(np.linalg.norm(tg), 1e-9)
        wp = M @ p + base; wn = M @ n; wt = M @ tg
        rows.append(np.concatenate([wp, wn, uv, [0, 0], colour(p, n), [0, 0], wt, [1.0]]))
    for i in range(nring - 1):
        for j in range(SEG):
            jj = j + 1; wrap = True
            # the seam: a quad whose corners straddle theta = pi (behind) takes its u on one side
            ta = ((th[j] - front_a + math.pi) % (2 * math.pi)) - math.pi
            tb = ((th[jj % SEG] - front_a + math.pi) % (2 * math.pi)) - math.pi
            straddle = ta > 0 and tb < 0
            chart = pts[i + 1][2]                        # a face's texture is its upper ring's
            for (ii, jx) in [(i, j), (i, jj), (i + 1, jj), (i, j), (i + 1, jj), (i + 1, j)]:
                corner(idx(ii, jx), ii, jx % SEG, straddle, chart)
    for j in range(SEG):
        jj = j + 1
        ta = ((th[j] - front_a + math.pi) % (2 * math.pi)) - math.pi
        tb = ((th[jj % SEG] - front_a + math.pi) % (2 * math.pi)) - math.pi
        straddle = ta > 0 and tb < 0
        corner(idx(nring - 1, j), nring - 1, j, straddle, 1); corner(idx(nring - 1, jj), nring - 1, jj % SEG, straddle, 1); corner(top, None, None, False, 1)
    return np.array(rows, np.float32)

def main():
    clutter, near, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(clutter / 'meshes.json'))
    ninfo = json.load(open(near / 'near.json')); T = np.fromfile(near / 'near.f32', np.float32).reshape(-1, 3, 3).astype(float)
    nodes = np.array([i[0] for i in ninfo])
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]); a = np.linalg.norm(n, axis=1); ok = a > 1e-8; n[ok] /= a[ok, None]
    wall = ok & (np.abs(n[:, 1]) < 0.3) & ~np.char.startswith(nodes, 'clutter/')
    W = np.array([[i / 6, j / 6, 1 - i / 6 - j / 6] for i in range(7) for j in range(7 - i)])
    manifest = []; report = dict(stones=[], meshes=0, oldTriangles=0, newTriangles=0)
    for path, rec in sorted(info.items()):
        s0 = rec['surfaces'][0]
        if s0['material'] != CLUTTER or len(rec['surfaces']) != 1: continue
        R = np.fromfile(clutter / s0['file'], np.float32).reshape(-1, 3, 20)
        lab = components(R[:, :, :3])
        drop = np.zeros(len(R), bool); new = []
        for l in np.unique(lab):
            f = np.nonzero(lab == l)[0]; Q = R[f][:, :, :3].reshape(-1, 3).astype(float)
            if not is_old_stone(Q): continue
            c = (Q.max(0) + Q.min(0)) / 2; y0 = float(Q[:, 1].min())
            # the wall behind: the nearest upright face of the houses within 2 m, between 0.1 and 0.6 m up
            m = wall & (np.abs(T[:, :, 0].mean(1) - c[0]) < 2) & (np.abs(T[:, :, 2].mean(1) - c[2]) < 2)
            S = np.einsum('kw,nwd->nkd', W, T[m]).reshape(-1, 3); S = S[(S[:, 1] > y0 + 0.1) & (S[:, 1] < y0 + 0.6)]
            if len(S):
                d = np.hypot(S[:, 0] - c[0], S[:, 2] - c[2]); v = S[d.argmin(), [0, 2]] - c[[0, 2]]
                front = -v / np.linalg.norm(v); wall_d = float(d.min())
            else:
                front = np.array([1.0, 0.0]); wall_d = None
            seed = int(hashlib.sha256(f'{c[0]:.2f},{c[2]:.2f}'.encode()).hexdigest()[:8], 16)
            rng = np.random.default_rng(seed)
            # (no bigger than the old stone: the old faces stay its collision; a little smaller near a wall)
            sr = rng.uniform(0.96, 1.01) if wall_d is None or wall_d > 0.3 else 0.95
            sh = rng.uniform(0.97, 1.01)
            lean = tuple(rng.uniform(-1, 1, 2) * math.radians(1.0))
            rows = build(seed, sr, sh, front, np.array([c[0], y0, c[2]]), lean)
            new.append(rows); drop[f] = True
            report['stones'].append(dict(node=path, at=[round(c[0], 2), round(y0, 3), round(c[2], 2)], front=np.round(front, 3).tolist(),
                                         wall=None if wall_d is None else round(wall_d, 3), triangles=len(rows) // 3))
        if not new: continue
        stem = pathlib.Path(rec['mesh']).stem
        keep = R[~drop]; keep.tofile(out / f'{stem}-0.f32')
        add = np.concatenate(new); add.tofile(out / f'{stem}-1.f32')
        report['meshes'] += 1; report['oldTriangles'] += int(drop.sum()); report['newTriangles'] += len(add) // 3
        manifest.append({'mesh': rec['mesh'], 'nodePath': path,
                         'sourceHash': hashlib.sha256((REPO / 'native-godot' / rec['mesh'][6:]).read_bytes()).hexdigest(),
                         'surfaces': [{'index': 0, 'file': f'{stem}-0.f32', 'material': CLUTTER, 'custom0': False, 'tangent': True},
                                      {'index': 1, 'file': f'{stem}-1.f32', 'material': STONE, 'custom0': False, 'tangent': True}]})
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print({k: v for k, v in report.items() if k != 'stones'}, 'stones', len(report['stones']))

if __name__ == '__main__':
    main()
