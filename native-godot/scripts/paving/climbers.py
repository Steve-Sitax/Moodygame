"""Ivy and Virginia creeper on the town wall, grown (Steve, 2026-10-26: the vines on the city walls looked very fake;
make them realistic, high detail).
    python climbers.py <climbers dump> <near dump> <out candidate>
<climbers dump>: dump-meshes.gd of the wall_climbers_* meshes; <near dump>: the town wall's faces whose outline reaches within 3 m of their cards (dump-near.gd, by outline).
The bake's climber was one flat card on the wall, 3 to 5 m wide and up to 6 m high, in a 128 x 256 picture: 144 of
them on the town wall. Each card is replaced by a plant grown where it stood, its kind its card's (cells 0 and 1 ivy,
2 Virginia creeper in red, 3 creeper turning orange):
- (2026-10-27: long runs) a clump of woody stems at the card's foot climbs to a height taken from the wall's own top
  (a third to the coping, most to 0.6 to 0.9 of it, a few young ones lower), the stems parting in a fan that widens in
  its lower half, its edge ragged, thinning toward the top; on the wall's own face (each point found by a ray onto
  the wall's faces behind it: the plinth, bands and joints are followed); at the coping strands hang over it;
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

def smooth(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)

def grow(rng, base, along, out, width, height, kind, wall):
    """One plant's rows (22 floats a corner: custom0 four). (Steve, 2026-10-27: vines also stretch longer distances
    up; more natural.) Real ivy and Virginia creeper root at the wall's foot and climb in long runs: a clump of woody
    stems, bare a little way up, fanning out as they climb and thinning toward the top; a third of the plants reach
    the coping and hang over it, most stop between half and nine tenths of the wall, a few are young and short."""
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
    ivy = kind in (0, 1)
    tone = rng.uniform(0.88, 1.06)
    # the wall's top straight behind the foot (its coping; a tower's face is too far back to count)
    top = None
    for h in np.arange(9.0, 1.0, -0.1):
        if surface(base + up * h, 0.0) is not None: top = h; break
    avail = (top if top is not None else height + 0.3) - 0.06
    r = rng.random()
    if r < 0.33: H = avail                                    # to the coping, and over it
    elif r < 0.82: H = avail * rng.uniform(0.58, 0.9)
    else: H = avail * rng.uniform(0.28, 0.48)                  # a young one
    H = min(H, 8.5); over = H >= avail - 0.01
    # the fan: its half width at each height, wavering, leaning a little to one side
    W = min(rng.uniform(1.1, 2.0) if ivy else rng.uniform(1.4, 2.6), width * 0.8) * (0.6 + 0.4 * min(H / 5.0, 1.0))
    phase = rng.uniform(0, 6.3); lean = rng.normal(0, 0.25)
    def half(h):
        t = h / max(H, 0.5)
        # (one that reached the coping spreads along under it: a flat top, not a point)
        top_k = (1 + 0.25 * smooth(0.8, 1.0, t)) if over else (1 - 0.3 * smooth(0.78, 1.0, t))
        return W * (0.12 + 0.88 * smooth(0.0, 0.4, t)) * top_k * (1 + 0.28 * math.sin(t * 8 + phase) + 0.12 * math.sin(t * 23 + 2 * phase))
    def mid(h):
        return lean * W * h / max(H, 0.5)
    stems = []
    def climb(p, d, length, thick, depth, aim):
        """A stem from p: a random walk about its way, drawn toward its aim across the fan, kept inside it."""
        pts = [(p, thick)]; walked = 0.0
        while walked < length:
            q0 = pts[-1][0]; hy = max(q0[1] - base[1], 0.0)
            sx = (q0 - base) @ along
            pull = (mid(hy) + aim * half(hy) - sx) * (0.25 if depth == 0 else 0.06)
            d = d + along * (rng.normal(0, 0.12) + pull) + up * (0.22 if depth == 0 else 0.06 if ivy else 0.02)
            if not ivy and depth > 0 and walked > 0.6: d = d - up * 0.05          # (creeper runners arch over)
            d = d - out * (d @ out); d /= np.linalg.norm(d)
            q = q0 + d * 0.1
            hq = q[1] - base[1]
            if hq > H or hq < 0.05: break
            off = (q - base) @ along - mid(hq)
            if abs(off) > half(hq) * (1.25 if depth > 0 else 1.0):
                if depth > 0 and rng.random() < 0.35: break
                d = d - along * np.sign(off) * 0.4; d /= np.linalg.norm(d); q = q0 + d * 0.1
            walked += 0.1
            pts.append((q, thick * (1 - 0.82 * walked / length)))
            # side shoots: up and out, more on creeper; fewer high up
            if depth < 2 and rng.random() < (0.14, 0.08)[depth] * (1.4 if not ivy else 1.0):
                side = rng.choice([-1, 1]); a = math.radians(rng.uniform(25, 55) if ivy else rng.uniform(40, 75))
                nd = up * math.cos(a) + along * side * math.sin(a)
                rem = max(H - hq, 0.3)
                climb(q, nd, min(rem * 1.2, rng.uniform(0.4, 1.4) if ivy else rng.uniform(0.6, 2.2)), thick * 0.55, depth + 1,
                      float(np.clip(aim + side * rng.uniform(0.2, 0.6), -1, 1)))
        stems.append((pts, depth, False))
    # roots: a clump of woody stems (two clumps on a wide creeper), each its own height; one runs to the top
    clumps = [0.0] if (ivy or rng.random() < 0.6) else [-0.25 * W, 0.25 * W]
    n_main = int(rng.integers(4, 8) if ivy else rng.integers(3, 7))
    aims = np.sort(rng.uniform(-1, 1, n_main)) * 0.5 + np.linspace(-0.9, 0.9, n_main) * 0.5
    lead = int(rng.integers(n_main))
    for k in range(n_main):
        x = clumps[k % len(clumps)] + rng.normal(0, 0.1)
        p = base + along * x
        tall = 1.0 if k == lead else rng.uniform(0.55, 1.0)
        climb(p, up + along * (aims[k] * 0.5 + rng.normal(0, 0.1)), H * tall + 0.3, rng.uniform(0.012, 0.02), 0, float(aims[k]))
    # over the coping: strands from the stems that reached it hang down in front, a few runners stand up into the air
    if over:
        top_y = base[1] + H
        for pts, depth, _ in list(stems):
            q, th = pts[-1]
            if top_y - q[1] > 0.35 or rng.random() > 0.7: continue
            lip = surface(np.array([q[0], top_y - 0.03, q[2]]), 0.0)
            if lip is None: continue
            for _ in range(int(rng.integers(1, 3))):
                s0 = lip + along * rng.normal(0, 0.12)
                ln = rng.uniform(0.3, 1.1); dk = rng.uniform(-0.25, 0.25)
                hang = [(s0, max(th, 0.006))]
                for j in range(1, int(ln / 0.1) + 1):
                    t = j * 0.1
                    hang.append((s0 + out * (0.06 + 0.1 * math.sin(min(t / 0.3, 1.0) * math.pi / 2)) - up * t + along * dk * t,
                                 max(th, 0.006) * (1 - 0.7 * t / ln)))
                stems.append((hang, 2, True))
            if rng.random() < 0.35:
                ln = rng.uniform(0.15, 0.4); dk = rng.normal(0, 0.3)
                stems.append(([(lip + out * 0.03 + up * t + along * dk * t + out * 0.15 * t * t, 0.005 * (1 - t / ln))
                               for t in np.arange(0.0, ln + 0.01, 0.08)], 2, True))
    leaves = 0
    bare = rng.uniform(0.25, 0.8)                     # (the woody foot, bare of leaves)
    for pts, depth, free in stems:
        on = [p if free else surface(p, 0.01) for p, _ in pts]
        # the stem: a ribbon of bark, 1 cm off the wall (a free strand faces out)
        for i in range(0, len(pts) - 1, 2):
            j = min(i + 2, len(pts) - 1)
            if on[i] is None or on[j] is None: continue
            a, b = on[i], on[j]; ta, tb = max(pts[i][1], 0.003), max(pts[j][1], 0.003)
            d = b - a; L = np.linalg.norm(d)
            if L < 1e-4: continue
            side = np.cross(out, d / L); side /= max(np.linalg.norm(side), 1e-9)
            bc = np.r_[0.9 * tone, 0.88 * tone, 0.85 * tone, 1.0]
            u0 = (i * 0.1) % 0.8; u1 = u0 + L * 0.5
            quad((a - side * ta, np.array([BARK[0] + u0, BARK[1] + 0.02]), bc), (b - side * tb, np.array([BARK[0] + u1, BARK[1] + 0.02]), bc),
                 (b + side * tb, np.array([BARK[0] + u1, BARK[1] + 0.08]), bc), (a + side * ta, np.array([BARK[0] + u0, BARK[1] + 0.08]), bc), out)
        # the sprays: thick in the middle of the run, thinning up top and at the fan's edge; none on the woody foot
        for i in range(1, len(pts)):
            p = on[i]
            if p is None: continue
            hy = p[1] - base[1]; t = hy / max(H, 0.5)
            e = abs((p - base) @ along - mid(hy)) / max(half(hy), 0.1)
            dens = smooth(bare, bare + 0.5, hy) * (1 - 0.6 * smooth(0.72, 1.02, t)) * (1 - 0.5 * smooth(0.6, 1.0, e))
            # (patches thinner here and there: brick shows through the plant, as on an old wall)
            dens *= 0.55 + 0.45 * smooth(-0.3, 0.5, math.sin(hy * 1.9 + phase) * math.cos(((p - base) @ along) * 2.3 - phase))
            if free: dens = 0.75
            if rng.random() > (0.95 if ivy else 0.8) * dens: continue
            dirn = pts[i][0] - pts[i - 1][0]; dirn /= max(np.linalg.norm(dirn), 1e-9)
            for layer in range(2 if rng.random() < 0.45 else 1):
                row = main if rng.random() < 0.8 else extra
                if ivy and layer == 1 and t > 0.5: row = 1          # (ivy lighter in the sun above)
                col = int(rng.integers(4))
                size = rng.uniform(0.44, 0.68) * (1.0 - 0.15 * depth) * (1.08 - 0.2 * min(t, 1.0))
                # the spray's way: the stem's, turned a little, more up; tilted out from the wall
                ang = rng.normal(0, 0.6)
                w = dirn * math.cos(ang) + np.cross(out, dirn) * math.sin(ang) + up * 0.3
                w -= out * (w @ out); w /= max(np.linalg.norm(w), 1e-9)
                tilt = math.radians((rng.uniform(5, 20) if ivy else rng.uniform(10, 30)) + 8 * layer)
                ax = w * math.cos(tilt) + out * math.sin(tilt)
                sd = np.cross(ax, out); sd /= np.linalg.norm(sd)
                foot = p + out * (0.02 + 0.03 * layer) + sd * rng.normal(0, 0.03) + along * rng.normal(0, 0.12) * (not free)
                nrm = np.cross(sd, ax); nrm = nrm if nrm @ out > 0 else -nrm
                n = nrm + up * 0.3 + out * 0.4; n /= np.linalg.norm(n)
                k = tone * rng.uniform(0.85, 1.1) * (0.82 + 0.25 * min(t, 1.0))
                lc = np.r_[min(k, 1.2), min(k, 1.2), min(k, 1.2), 1.0]
                P = lambda s, tt: foot + sd * (s - 0.5) * size + ax * tt * size
                quad((P(0, 0), cell_uv(row, col, 0, 0), lc), (P(1, 0), cell_uv(row, col, 1, 0), lc),
                     (P(1, 1), cell_uv(row, col, 1, 1), lc), (P(0, 1), cell_uv(row, col, 0, 1), lc), n)
                leaves += 1
    return np.array(rows, np.float32), leaves, H, over


def main():
    dump, near, out = map(pathlib.Path, sys.argv[1:4]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(dump / 'meshes.json'))
    ninfo = json.load(open(near / 'near.json')); T = np.fromfile(near / 'near.f32', np.float32).reshape(-1, 3, 3).astype(float)
    nodes = np.array([i[0] for i in ninfo])
    wallT = T[np.char.startswith(nodes, 'town_wall')]
    bmin = wallT[:, :, [0, 2]].min(1); bmax = wallT[:, :, [0, 2]].max(1)
    manifest = []; report = dict(meshes=0, plants=0, leaves=0, triangles=0, oldTriangles=0, kinds={}, heights=[], over=0)
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
            rows, leaves, H, over = grow(np.random.default_rng(seed), base, along, outn, width, float(hi - lo - 0.3), kind, Wall(wallT[m]))
            report['heights'].append(round(H, 2)); report['over'] += int(over)
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
