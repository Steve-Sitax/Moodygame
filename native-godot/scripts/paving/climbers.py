"""Ivy and Virginia creeper on the town wall, grown (Steve, 2026-10-26: the vines on the city walls looked very fake;
make them realistic, high detail).
    python climbers.py <climbers dump> <near dump> <out candidate>
<climbers dump>: dump-meshes.gd of the wall_climbers_* meshes; <near dump>: the town wall's faces whose outline reaches within 3 m of their cards (dump-near.gd, by outline).
The bake's climber was one flat card on the wall, 3 to 5 m wide and up to 6 m high, in a 128 x 256 picture: 144 of
them on the town wall. Each card is replaced by a plant grown where it stood, its kind its card's (cells 0 and 1 ivy,
2 Virginia creeper in red, 3 creeper turning orange):
- roots along the card's foot; from each a woody stem climbs (a random walk about the upright, branching to the sides,
  thinning), kept within the card's width and under its top, on the wall's own face (each point found by a ray onto
  the wall's faces behind it: the plinth, bands and joints are followed);
- along the stems, sprays of leaves (climbers.png cells, each a stalk with its leaves) at their joints, two layers,
  standing off the wall 2 to 10 cm and tilted out and up, turned with the stem, each its own size and tone;
  ivy darker below and lighter above;
- the stems as ribbons of the bark strip, 1 cm off the wall, thick at the root, thin at the tips.
Material climbers.tres: the park plants' shader kind (cut out, both sides, wet, relief); the plant foot (custom0) set
per corner so the leaves only shiver a little in the wind. The whole surface is replaced; the climbers are no solid.
Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, pathlib, hashlib, math
import numpy as np

REPO = pathlib.Path(__file__).resolve().parents[3]
MAT = 'res://assets/materials/climbers-20261026/climbers.tres'
AW, AH = 2048.0, 2304.0
CELLS = {0: [0, 1], 1: [1, 0], 2: [2, 3], 3: [3, 2]}     # old cell -> atlas rows (main, mixed in)
BARK = (0.0, 2048 / AH, 1.0, 1.0)

def cell_uv(row, col, s, t):
    """s across 0..1, t up 0..1 (t = 0 the spray's foot) in atlas cell (row, col)."""
    return np.array([(col + s) * 512 / AW, (row * 512 + (1 - t) * 512) / AH])

class Wall:
    """The town wall's faces near one card, for rays onto its face along -n."""
    def __init__(self, T):
        self.T = T
        self.e1 = T[:, 1] - T[:, 0]; self.e2 = T[:, 2] - T[:, 0]
    def hit(self, p, d, far=1.6):
        """Distance along d from p to the faces (or None)."""
        h = np.cross(d, self.e2); a = (self.e1 * h).sum(1)
        ok = np.abs(a) > 1e-9
        f = np.where(ok, 1 / np.where(ok, a, 1), 0)
        s = p - self.T[:, 0]; u = f * (s * h).sum(1)
        q = np.cross(s, self.e1); v = f * (q @ d); t = f * (q * self.e2).sum(1)
        m = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > -far) & (t < far)
        if not m.any(): return None
        return float(t[m][np.argmin(np.abs(t[m]))])

def grow(rng, base, along, out, width, height, kind, wall):
    """One plant's rows (22 floats a corner: custom0 four)."""
    rows = []
    up = np.array([0.0, 1.0, 0.0])
    def surface(p, off):
        """p moved onto the wall's face (found behind or before it along out) and off it by off."""
        t = wall.hit(p + out * 0.3, -out)
        if t is None: return None
        return p + out * 0.3 - out * t + out * off
    def emit(tri, n):
        for p, uv, col in tri:
            rows.append(np.concatenate([p, n, uv, [0, 0], col, [p[0], p[2], p[1] - 2.15, 0], [along[0], 0, along[2], 1]]))
    def quad(a, b, c, d, n):
        emit([a, b, c], n); emit([a, c, d], n)
    main, extra = CELLS[kind]
    tone = rng.uniform(0.88, 1.06)
    n_roots = max(2, int(round(width / 1.1)))
    stems = []
    # the stems: a main climb from each root, side branches off it
    phase = rng.uniform(0, 6.3)
    cap = height + 0.6                     # (no stem past the wall's top: the card's top was under it)
    def climb(p, d, length, thick, depth):
        pts = [(p, thick)]; walked = 0.0
        while walked < length:
            d = d + along * rng.normal(0, 0.15) + up * (0.25 if depth == 0 else 0.1)
            d = d - out * (d @ out); d /= np.linalg.norm(d)
            q = pts[-1][0] + d * 0.1
            # (Steve, 2026-10-26: natural, not the old cards' squares) the plant's reach fans out as it climbs and
            # wavers along its edge; a stem turns back only past it, softly
            hy = max(q[1] - base[1], 0.0)
            reach = width * (0.3 + 0.55 * min(hy / max(height, 0.5), 1.0)) * (1 + 0.25 * math.sin(hy * 1.7 + phase))
            sx = (q - base) @ along
            if abs(sx) > reach: d = d - along * np.sign(sx) * 0.35; d /= np.linalg.norm(d); q = pts[-1][0] + d * 0.1
            if q[1] - base[1] > cap: break
            walked += 0.1
            pts.append((q, thick * (1 - 0.8 * walked / length)))
            if depth < 3 and rng.random() < (0.2, 0.1, 0.05)[depth]:
                side = along * rng.choice([-1, 1])
                climb(q, side * 0.9 + up * rng.uniform(0.1, 0.6), length * rng.uniform(0.3, 0.6), thick * 0.55, depth + 1)
        stems.append((pts, depth))
    # roots in a clump or two, not in a row; each stem its own height, a few long runners
    clumps = rng.uniform(-0.3, 0.3, size=int(rng.integers(1, 3))) * width
    for k in range(n_roots):
        x = clumps[k % len(clumps)] + rng.normal(0, 0.18 * width)
        p = base + along * x
        tall = rng.uniform(0.35, 0.95) if rng.random() < 0.75 else rng.uniform(0.95, 1.15)
        climb(p, up + along * rng.normal(0, 0.3), height * tall, 0.016, 0)
    leaves = 0
    for pts, depth in stems:
        # the stem: a ribbon of bark, 1 cm off the wall
        on = [surface(p, 0.01) for p, _ in pts]
        # (a ribbon piece every two steps, 0.2 m)
        for i in range(0, len(pts) - 1, 2):
            j = min(i + 2, len(pts) - 1)
            if on[i] is None or on[j] is None: continue
            a, b = on[i], on[j]; ta, tb = max(pts[i][1], 0.003), max(pts[j][1], 0.003)
            d = b - a; L = np.linalg.norm(d)
            if L < 1e-4: continue
            side = np.cross(out, d / L)
            bc = np.r_[0.9 * tone, 0.88 * tone, 0.85 * tone, 1.0]
            u0 = (i * 0.1) % 0.8; u1 = u0 + L * 0.5
            quad((a - side * ta, np.array([BARK[0] + u0, BARK[1] + 0.02]), bc), (b - side * tb, np.array([BARK[0] + u1, BARK[1] + 0.02]), bc),
                 (b + side * tb, np.array([BARK[0] + u1, BARK[1] + 0.08]), bc), (a + side * ta, np.array([BARK[0] + u0, BARK[1] + 0.08]), bc), out)
        # the sprays at its joints: two layers
        for i in range(1, len(pts)):
            if rng.random() > 0.7: continue
            p = on[i]
            if p is None: continue
            dirn = pts[i][0] - pts[i - 1][0]; dirn /= max(np.linalg.norm(dirn), 1e-9)
            for layer in range(2 if rng.random() < 0.5 else 1):
                hrel = (p[1] - base[1]) / max(height, 0.5)
                row = main if rng.random() < 0.8 else extra
                if kind in (0, 1) and layer == 1 and hrel > 0.5: row = 1          # (ivy lighter in the sun above)
                col = int(rng.integers(4))
                size = rng.uniform(0.36, 0.55) * (1.0 - 0.15 * depth)
                # the spray's way: the stem's, turned a little, more up; tilted out from the wall
                ang = rng.normal(0, 0.6)
                w = dirn * math.cos(ang) + np.cross(out, dirn) * math.sin(ang) + up * 0.3
                w -= out * (w @ out); w /= np.linalg.norm(w)
                tilt = math.radians(rng.uniform(12, 38) + 10 * layer)
                ax = w * math.cos(tilt) + out * math.sin(tilt)
                sd = np.cross(ax, out); sd /= np.linalg.norm(sd)
                foot = p + out * (0.02 + 0.03 * layer) + sd * rng.normal(0, 0.03)
                nrm = np.cross(sd, ax); nrm = nrm if nrm @ out > 0 else -nrm
                n = nrm + up * 0.3 + out * 0.4; n /= np.linalg.norm(n)
                k = tone * rng.uniform(0.85, 1.1) * (0.82 + 0.25 * min(hrel, 1.0))
                lc = np.r_[min(k, 1.2), min(k, 1.2), min(k, 1.2), 1.0]
                P = lambda s, t: foot + sd * (s - 0.5) * size + ax * t * size
                quad((P(0, 0), cell_uv(row, col, 0, 0), lc), (P(1, 0), cell_uv(row, col, 1, 0), lc),
                     (P(1, 1), cell_uv(row, col, 1, 1), lc), (P(0, 1), cell_uv(row, col, 0, 1), lc), n)
                leaves += 1
    return np.array(rows, np.float32), leaves

def main():
    dump, near, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(dump / 'meshes.json'))
    ninfo = json.load(open(near / 'near.json')); T = np.fromfile(near / 'near.f32', np.float32).reshape(-1, 3, 3).astype(float)
    nodes = np.array([i[0] for i in ninfo])
    wallT = T[np.char.startswith(nodes, 'town_wall')]
    bmin = wallT[:, :, [0, 2]].min(1); bmax = wallT[:, :, [0, 2]].max(1)
    manifest = []; report = dict(meshes=0, plants=0, leaves=0, triangles=0, oldTriangles=0, kinds={})
    for path, rec in sorted(info.items()):
        s0 = rec['surfaces'][0]
        R = np.fromfile(dump / s0['file'], np.float32).reshape(-1, 3, 20).astype(float)
        allrows = []
        for i in range(0, len(R), 2):
            P = np.concatenate([R[i, :, :3], R[i + 1, :, :3]]); U = np.concatenate([R[i, :, 6:8], R[i + 1, :, 6:8]])
            outn = R[i, 0, 3:6].copy(); outn[1] = 0; outn /= np.linalg.norm(outn)
            lo, hi = P[:, 1].min(), P[:, 1].max(); b = P[P[:, 1] < lo + 0.01]
            along = np.cross(np.array([0, 1.0, 0]), outn)
            sx = (b - b.mean(0)) @ along; width = float(np.ptp(sx)); base = b.mean(0); base[1] = lo + 0.25
            kind = int(np.clip(U[:, 0].min() * 4 + 0.01, 0, 3))
            # (the wall's faces whose outline reaches the plant: its long brick faces' middles lie far off)
            r_ = width / 2 + 2
            m = ((bmin - r_ <= base[[0, 2]]) & (base[[0, 2]] <= bmax + r_)).all(1)
            seed = int(hashlib.sha256(f'{base[0]:.2f},{base[2]:.2f}'.encode()).hexdigest()[:8], 16)
            rows, leaves = grow(np.random.default_rng(seed), base, along, outn, width, float(hi - lo - 0.3), kind, Wall(wallT[m]))
            allrows.append(rows)
            report['plants'] += 1; report['leaves'] += leaves; report['kinds'][str(kind)] = report['kinds'].get(str(kind), 0) + 1
        A = np.concatenate(allrows)
        stem = pathlib.Path(rec['mesh']).stem
        A.tofile(out / f'{stem}-0.f32')
        manifest.append({'mesh': rec['mesh'], 'nodePath': path,
                         'sourceHash': hashlib.sha256((REPO / 'native-godot' / rec['mesh'][6:]).read_bytes()).hexdigest(),
                         'surfaces': [{'index': 0, 'file': f'{stem}-0.f32', 'material': MAT, 'custom0': True, 'custom0Rgba': True, 'tangent': True}]})
        report['meshes'] += 1; report['triangles'] += len(A) // 3; report['oldTriangles'] += len(R)
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report)

if __name__ == '__main__':
    main()
