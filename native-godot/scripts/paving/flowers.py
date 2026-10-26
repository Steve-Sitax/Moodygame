"""Window and door geraniums, rebuilt (Steve, 2026-10-26: the pot flowers were very low poly; make them better and
replace all).
    python flowers.py <lively dump> <out candidate>
<lively dump>: dump-meshes.gd of the town's lively/* meshes (20 floats a corner, every surface).
The bake's pot (build_lively.py pots) was a 6-sided lathe of 28 triangles with five square "flowers" on square
stalks, in the lively atlas: 288 in the town, three on a sill board under shop windows or one by a door. Each pot and
its stalks and flowers are taken out of the lively surface (the sill board stays) and a potted zonal geranium is laid
in its place: a 16-sided terracotta pot with its rolled rim and soil, a rosette of scalloped leaves with the dark
zone, three to five flower heads on stalks (scarlet, or pink and white), each pot its own turn, size and tone.
Picture: art-source/flowers-20261026 (drawn by make_geranium_atlas.py); material geranium.tres, the park plants'
shader kind (cut out, both sides, wet in rain, its relief), so no new kind; its plant foot (custom0) set so the
flowers only stir a little in the wind. A new surface on the same mesh; collision unchanged (the promotion keeps the
replaced surface's old faces as its stand-in). Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, pathlib, hashlib, math
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from barrels import components

REPO = pathlib.Path(__file__).resolve().parents[3]
LIVELY = 'res://world/town/resources/r002310.res'
FLOWER = 'res://assets/materials/flowers-20261026/geranium.tres'
# atlas cells (u0, v0, u1, v1) in the 1024 x 1280 picture
LEAF = [(0.0, 0.0, 0.5, 0.4), (0.5, 0.0, 1.0, 0.4)]
UMBEL = {'red': (0.0, 0.4, 0.5, 0.8), 'pink': (0.5, 0.4, 1.0, 0.8)}
TERRA, SOIL, STALK = (0.0, 0.8, 0.5, 1.0), (0.5, 0.8, 0.75, 1.0), (0.75, 0.8, 1.0, 1.0)
SEG = 16
# the pot (r, y): foot, side, under the rim, the rolled rim, its inside down to the soil
POT = [(0.060, 0.0), (0.069, 0.06), (0.077, 0.118), (0.082, 0.121), (0.086, 0.126), (0.087, 0.143), (0.083, 0.150),
       (0.077, 0.149), (0.074, 0.138)]
SOIL_Y = 0.136

def cell(c, s, t):
    return np.array([c[0] + (c[2] - c[0]) * s, c[1] + (c[3] - c[1]) * t])

class Out:
    def __init__(self, foot, base):
        self.rows = []; self.foot = foot; self.base = base
    def tri(self, a, b, c):
        """Corners (p, n, uv, col): faces in the town's winding (clockwise from the front its normals give)."""
        if np.cross(b[0] - a[0], c[0] - a[0]) @ (a[1] + b[1] + c[1]) > 0: b, c = c, b
        for p, n, uv, col in (a, b, c):
            w = p + self.base
            # custom0: the plant's foot as the park plants' shader reads it (x, z, foot height, spare)
            self.rows.append(np.concatenate([w, n, uv, [0, 0], col, [self.base[0], self.base[2], self.foot, 0], [1, 0, 0, 1]]))

def plant(rng, base, flower, scale):
    o = Out(base[1] - 1.86, base)          # (stirs only over 1.86 m + 2 m: the heads 0.1 to 0.2 m in it)
    tone = rng.uniform(0.85, 1.05)
    turn = rng.uniform(0, 2 * math.pi)
    up = np.array([0.0, 1.0, 0.0])
    # the pot: a 16-sided lathe of POT, the picture once round
    prof = [(r * scale, y * scale) for r, y in POT]
    arc = np.r_[0, np.cumsum([math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) for i in range(len(prof) - 1)])]
    pc = np.r_[np.clip(tone * np.array([1.0, 0.96, 0.92]), 0, 1), 1.0]
    for j in range(SEG):
        t0, t1 = turn + 2 * math.pi * j / SEG, turn + 2 * math.pi * (j + 1) / SEG
        for i in range(len(prof) - 1):
            (ra, ya), (rb, yb) = prof[i], prof[i + 1]
            dn = np.array([yb - ya, -(rb - ra)]); dn /= np.hypot(*dn)
            if i >= len(prof) - 3: dn = dn                 # (the rim's inside faces in by its own winding)
            def V(r, y, t, s):
                p = np.array([r * math.cos(t), y, r * math.sin(t)])
                n = np.array([dn[0] * math.cos(t), dn[1], dn[0] * math.sin(t)])
                uv = cell(TERRA, (t - turn) / (2 * math.pi), s / arc[-1])
                k = 0.8 if i >= len(prof) - 3 else 1.0
                return (p, n, uv, pc * np.r_[k, k, k, 1])
            a, b = V(ra, ya, t0, arc[i]), V(ra, ya, t1, arc[i]); c, d = V(rb, yb, t1, arc[i + 1]), V(rb, yb, t0, arc[i + 1])
            o.tri(a, b, c); o.tri(a, c, d)
        # the soil
        rs = prof[-1][0]
        sc = np.r_[0.9, 0.9, 0.9, 1.0]
        S = lambda t: (np.array([rs * math.cos(t), SOIL_Y * scale, rs * math.sin(t)]), up, cell(SOIL, 0.5 + 0.45 * math.cos(t), 0.5 + 0.45 * math.sin(t)), sc)
        o.tri((np.array([0, SOIL_Y * scale, 0]), up, cell(SOIL, 0.5, 0.5), sc), S(t0), S(t1))
    top = SOIL_Y * scale
    # leaves: a rosette, two rings, each a card from its stalk's foot out and up, both sides
    lc = np.r_[np.clip(tone * np.array([0.95, 1.0, 0.95]), 0, 1), 1.0]
    n_leaf = int(rng.integers(10, 14))
    for k in range(n_leaf):
        a = turn + k * 2 * math.pi / n_leaf + rng.uniform(-0.2, 0.2)
        ring = k % 2
        size = rng.uniform(0.075, 0.095) * scale
        out = np.array([math.cos(a), 0, math.sin(a)]); side = np.array([-math.sin(a), 0, math.cos(a)])
        tilt = math.radians(rng.uniform(15, 40) if ring else rng.uniform(35, 60))
        foot = np.array([0, top + rng.uniform(0.01, 0.05) * scale, 0]) + out * (0.02 + 0.03 * ring) * scale
        along = out * math.cos(tilt) + up * math.sin(tilt)
        nrm = np.cross(side, along); nrm = nrm if nrm[1] > 0 else -nrm
        n = (nrm + up * 0.6); n /= np.linalg.norm(n)
        L = LEAF[int(rng.integers(2))]
        # the cell's foot (t = 1, the stalk stub) at the foot, its top out along the leaf
        P = lambda s, t: foot + side * (s - 0.5) * size + along * (1 - t) * size * 1.1
        q = [(P(0, 1), n, cell(L, 0, 1), lc), (P(1, 1), n, cell(L, 1, 1), lc), (P(1, 0), n, cell(L, 1, 0), lc), (P(0, 0), n, cell(L, 0, 0), lc)]
        o.tri(q[0], q[1], q[2]); o.tri(q[0], q[2], q[3])
    # flower heads on stalks
    U = UMBEL[flower]; fc = np.r_[np.clip(tone * np.array([1.0, 1.0, 1.0]), 0, 1), 1.0]
    for k in range(int(rng.integers(3, 6))):
        a = turn + k * 2.3 + rng.uniform(-0.4, 0.4); rr = rng.uniform(0.0, 0.05) * scale
        head = np.array([rr * math.cos(a), top + rng.uniform(0.14, 0.22) * scale, rr * math.sin(a)])
        foot = np.array([0.3 * rr * math.cos(a), top + 0.02 * scale, 0.3 * rr * math.sin(a)])
        # the stalk: a thin square tube
        d = head - foot; d /= np.linalg.norm(d); e1 = np.cross(d, [1, 0, 0]); e1 /= np.linalg.norm(e1); e2 = np.cross(d, e1)
        sw = 0.0025 * scale
        for m in range(4):
            u0v, u1v = [e1, e2, -e1, -e2][m], [e1, e2, -e1, -e2][(m + 1) % 4]
            c0, c1 = cell(STALK, 0.2 * m, 0), cell(STALK, 0.2 * (m + 1), 1)
            A = (foot + u0v * sw, u0v, c0, lc); B = (foot + u1v * sw, u1v, np.array([c1[0], c0[1]]), lc)
            C = (head + u1v * sw, u1v, c1, lc); D = (head + u0v * sw, u0v, np.array([c0[0], c1[1]]), lc)
            o.tri(A, B, C); o.tri(A, C, D)
        # the head: three upright cards crossed and one lying, the cell's pedicels at the stalk's top
        size = rng.uniform(0.07, 0.09) * scale
        for m in range(3):
            b = a + m * math.pi / 3
            sd = np.array([math.cos(b), 0, math.sin(b)]); nn = np.cross(sd, up) * 0.4 + up; nn /= np.linalg.norm(nn)
            P = lambda s, t: head + sd * (s - 0.5) * size + up * ((1 - t) * size - 0.25 * size)
            q = [(P(0, 1), nn, cell(U, 0, 1), fc), (P(1, 1), nn, cell(U, 1, 1), fc), (P(1, 0), nn, cell(U, 1, 0), fc), (P(0, 0), nn, cell(U, 0, 0), fc)]
            o.tri(q[0], q[1], q[2]); o.tri(q[0], q[2], q[3])
        hz = head + up * 0.35 * size
        sd = np.array([math.cos(a), 0, math.sin(a)]); sp = np.array([-math.sin(a), 0, math.cos(a)])
        P = lambda s, t: hz + sd * (s - 0.5) * size * 0.9 + sp * (t - 0.5) * size * 0.9
        q = [(P(0, 1), up, cell(U, 0.05, 0.85), fc), (P(1, 1), up, cell(U, 0.95, 0.85), fc), (P(1, 0), up, cell(U, 0.95, 0.05), fc), (P(0, 0), up, cell(U, 0.05, 0.05), fc)]
        o.tri(q[0], q[1], q[2]); o.tri(q[0], q[2], q[3])
    return np.array(o.rows, np.float32)

def main():
    dump, out = map(pathlib.Path, sys.argv[1:3]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(dump / 'meshes.json'))
    manifest = []; report = dict(meshes=0, pots=0, oldTriangles=0, newTriangles=0, flowers={})
    for path, rec in sorted(info.items()):
        si = next((s for s in rec['surfaces'] if s['material'] == LIVELY), None)
        if si is None: continue
        R = np.fromfile(dump / si['file'], np.float32).reshape(-1, 3, 20)
        if not len(R): continue
        lab = components(R[:, :, :3]); drop = np.zeros(len(R), bool)
        parts = {}
        for l in np.unique(lab):
            f = np.nonzero(lab == l)[0]; Q = R[f][:, :, :3].reshape(-1, 3).astype(float)
            parts[l] = (f, Q, (Q.max(0) + Q.min(0)) / 2, Q.max(0) - Q.min(0))
        new = []
        for l, (f, Q, c, ext) in parts.items():
            if len(f) != 28 or abs(ext[1] - 0.15) > 0.01 or not 0.14 < max(ext[0], ext[2]) < 0.19: continue
            y0 = Q[:, 1].min()
            # its stalks and flowers: small parts over the pot
            for m, (g, Qm, d, e) in parts.items():
                if m == l or len(g) > 14: continue
                if np.hypot(*(Qm[:, [0, 2]] - c[[0, 2]]).T).max() < 0.16 and Qm[:, 1].min() > y0 + 0.1 and Qm[:, 1].max() < y0 + 0.42:
                    drop[g] = True
            drop[f] = True
            seed = int(hashlib.sha256(f'{c[0]:.2f},{c[2]:.2f},{y0:.2f}'.encode()).hexdigest()[:8], 16); rng = np.random.default_rng(seed)
            fl = 'red' if rng.random() < 0.65 else 'pink'
            new.append(plant(rng, np.array([c[0], y0, c[2]]), fl, rng.uniform(0.95, 1.08)))
            report['pots'] += 1; report['flowers'][fl] = report['flowers'].get(fl, 0) + 1
        if not new: continue
        stem = pathlib.Path(rec['mesh']).stem
        R[~drop].tofile(out / f'{stem}-{si["index"]}.f32')
        n = len(rec['surfaces']); A = np.concatenate(new); A.tofile(out / f'{stem}-{n}.f32')
        manifest.append({'mesh': rec['mesh'], 'nodePath': path,
                         'sourceHash': hashlib.sha256((REPO / 'native-godot' / rec['mesh'][6:]).read_bytes()).hexdigest(),
                         'surfaces': [{'index': si['index'], 'file': f'{stem}-{si["index"]}.f32', 'material': LIVELY, 'custom0': si['custom0'], 'tangent': True},
                                      {'index': n, 'file': f'{stem}-{n}.f32', 'material': FLOWER, 'custom0': True, 'custom0Rgba': True, 'tangent': True}]})
        report['meshes'] += 1; report['oldTriangles'] += int(drop.sum()); report['newTriangles'] += len(A) // 3
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report)

if __name__ == '__main__':
    main()
