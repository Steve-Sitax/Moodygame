"""Weeds, grasses and small shrubs on the town's bare earth (Steve, 2026-10-26: the sandy patches along the walls must
have plants and trees, high detail).
    python earth_plants.py <earth dump> <walls> <chunks json> <out candidate>
<earth dump>: dump-meshes.gd of city/ground_earth; <walls>: the upright faces whose outline reaches the earth's edges (a folder of
dump-near-box.gd output, near.f32; or dump-ground.gd's obstacles.f32); <chunks json>: the city_*_3 meshes (node: mesh, surface count, box).
The earth lanes along the town wall and the houses were bare. Now, as such ground grows:
- at a wall's or a house's foot (an edge of the earth with an upright face just behind it): a dense fringe of grass
  tufts, tall grass, daisies, blades and, where there is room, little shrubs;
- where the earth meets paving: a few tufts in the joint;
- in the open: clumps where the ground is little trodden (a slow noise), nearly bare elsewhere.
Each plant is a few crossed cards of the park plants' atlas (park_leaves: grass, plume grass, daisies, blades, box and
privet sprigs) with the park plants' material (r001176, its own kind: cut out, both sides, wet, relief); its foot
(custom0) just under the ground, so it stirs in the wind by its height. A new surface on each district's pavement
mesh (city_*_3: only what is near is drawn); no solid.
Writes manifest.json (surfaceRepairs) and report.json.
"""
import sys, json, pathlib, hashlib, math
import numpy as np, shapely
from shapely.geometry import LineString, Point

REPO = pathlib.Path(__file__).resolve().parents[3]
MAT = 'res://world/town/resources/r001176.res'
# park_leaves atlas: 4 columns x 5 rows of 256 x 256 in 1024 x 1280
CELL = {'grass': (3, 2), 'plume': (3, 0), 'daisy': (2, 0), 'blades': (3, 3), 'box': (1, 1), 'privet': (1, 2)}

def uv(kind, s, t):
    r, c = CELL[kind]
    return np.array([(c + 0.02 + 0.96 * s) / 4, (r + 0.02 + 0.96 * (1 - t)) / 5])

def noise(x, z, scale, seed):
    """Smooth value noise 0..1 (cells of scale m)."""
    def h(i, j): return (math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453) % 1.0
    fx, fz = x / scale, z / scale; i, j = math.floor(fx), math.floor(fz); u, v = fx - i, fz - j
    u, v = u * u * (3 - 2 * u), v * v * (3 - 2 * v)
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v

class Out:
    def __init__(self): self.rows = []
    def card(self, foot, side, up_, w, h, kind, col, n, lean=0.0, gy=0.0):
        """A card: its bottom middle at foot, width w along side, height h along up_ (tilted by lean toward n)."""
        upv = up_ * math.cos(lean) + n * math.sin(lean)
        P = lambda s, t: foot + side * (s - 0.5) * w + upv * t * h
        nn = n * 0.35 + np.array([0, 1.0, 0]) * 0.65; nn /= np.linalg.norm(nn)
        q = [(P(0, 0), uv(kind, 0, 0)), (P(1, 0), uv(kind, 1, 0)), (P(1, 1), uv(kind, 1, 1)), (P(0, 1), uv(kind, 0, 1))]
        for a, b, c in ((0, 1, 2), (0, 2, 3)):
            for p, t in (q[a], q[b], q[c]):
                k = 0.55 + 0.45 * min(1.0, (p[1] - gy) / max(h, 0.05))          # (darker at its foot)
                self.rows.append(np.concatenate([p, nn, t, [0, 0], np.r_[col[:3] * k, 1.0], [p[0], p[2], gy - 2.0, 0], [side[0], 0, side[2], 1]]))

def tuft(o, rng, at, kind, scale=1.0):
    up = np.array([0, 1.0, 0])
    tone = rng.uniform(0.8, 1.08); col = np.array([tone, tone * rng.uniform(0.95, 1.03), tone * rng.uniform(0.9, 1.0)])
    # (the atlas's grasses are dry autumn ones: most of the weeds still green)
    if kind in ('grass', 'plume', 'blades') and rng.random() < 0.65: col = col * np.array([0.7, 0.95, 0.6])
    turn = rng.uniform(0, math.pi)
    if kind in ('box', 'privet'):
        # a little shrub: sprigs round a dome
        R = rng.uniform(0.22, 0.38) * scale; H = rng.uniform(0.4, 0.7) * scale
        for k in range(int(rng.integers(7, 11))):
            a = turn + k * 2.4; e = rng.uniform(0.1, 1.0)
            out = np.array([math.cos(a), 0, math.sin(a)]); side = np.array([-math.sin(a), 0, math.cos(a)])
            foot = at + out * R * 0.25 * e
            o.card(foot, side, up, R * 1.3, H, kind, col, out, lean=0.35 + 0.6 * e, gy=at[1])
        return
    n_cards, w, h = {'grass': (3, (0.3, 0.55), (0.22, 0.5)), 'plume': (2, (0.35, 0.6), (0.55, 0.95)), 'daisy': (2, (0.28, 0.42), (0.25, 0.4)),
                     'blades': (2, (0.3, 0.45), (0.35, 0.6))}[kind]
    W = rng.uniform(*w) * scale; H = rng.uniform(*h) * scale
    for k in range(n_cards):
        a = turn + k * math.pi / n_cards
        side = np.array([math.cos(a), 0, math.sin(a)]); n = np.array([-math.sin(a), 0, math.cos(a)])
        o.card(at - np.array([0, 0.01, 0]), side, up, W, H, kind, col, n, lean=rng.normal(0, 0.12), gy=at[1])

def pick(rng, room):
    r = rng.random()
    if room > 0.7 and r < 0.07: return 'box' if rng.random() < 0.6 else 'privet'
    if r < 0.60: return 'grass'
    if r < 0.75: return 'plume'
    if r < 0.88: return 'daisy'
    return 'blades'

def main():
    edump, obs, chunks_j, out = sys.argv[1:5]; out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    einfo = json.load(open(pathlib.Path(edump) / 'meshes.json'))['city/ground_earth']
    R = np.fromfile(pathlib.Path(edump) / einfo['surfaces'][0]['file'], np.float32).reshape(-1, 3, 20).astype(float)
    earth = shapely.union_all(shapely.polygons(R[:, :, [0, 2]]))
    gy = float(np.median(R[:, :, 1]))
    # upright faces (walls, house fronts) at the earth's edge
    # (a folder: an outline dump of the upright faces at the earth's edges, near.f32; else dump-ground's obstacles, whose
    # tall faces may be missing: their middles stand high)
    obs = pathlib.Path(obs)
    O = np.fromfile(obs / 'near.f32' if obs.is_dir() else obs, np.float32).reshape(-1, 3, 3)
    if obs.is_dir():    # (not the climbers' leaves)
        keep = np.array([not i[0].startswith('wall_climbers') for i in json.load(open(obs / 'near.json'))]); O = O[keep]
    bnd = earth.boundary.buffer(0.6)
    lo, hi = O[:, :, [0, 2]].min(1), O[:, :, [0, 2]].max(1)
    bx = bnd.bounds
    m = (hi[:, 0] > bx[0]) & (lo[:, 0] < bx[2]) & (hi[:, 1] > bx[1]) & (lo[:, 1] < bx[3])
    O = O[m].astype(float)
    n = np.cross(O[:, 1] - O[:, 0], O[:, 2] - O[:, 0]); a = np.linalg.norm(n, axis=1) + 1e-12
    up_faces = (np.abs(n[:, 1]) / a < 0.3) & (O[:, :, 1].max(1) > gy + 0.8) & (O[:, :, 1].min(1) < gy + 0.5) & (a > 0.02)
    O = O[up_faces]
    segs = [LineString([p[[0, 2]] for p in t]) for t in O]
    segs = np.array(segs, dtype=object); tree = shapely.STRtree(segs)
    near = tree.query(bnd, predicate='intersects'); walls = shapely.union_all(segs[near]) if len(near) else None
    print('upright faces at the earth', len(near))
    chunks = json.load(open(chunks_j))
    cnames = list(chunks)
    cmin = np.array([chunks[c]['min'] for c in cnames]); cmax = np.array([chunks[c]['max'] for c in cnames])
    outs = {c: Out() for c in cnames}
    def chunk_of(p):
        d = np.maximum(np.maximum(cmin - p, p - cmax), 0); return cnames[int(np.argmin(np.hypot(*d.T)))]
    report = dict(edgeWall=0.0, edgePaving=0.0, plants={})
    rng = np.random.default_rng(1873)
    def place(p, kind, scale=1.0):
        o = outs[chunk_of(p)]; tuft(o, rng, np.array([p[0], gy, p[1]]), kind, scale); report['plants'][kind] = report['plants'].get(kind, 0) + 1
    for poly in shapely.get_parts(earth):
        for ring in [poly.exterior] + list(poly.interiors):
            L = ring.length; k = int(L / 0.3)
            for i in range(k):
                s = i * 0.3 + rng.uniform(0, 0.3)
                p = np.asarray(ring.interpolate(s).coords[0]); q = np.asarray(ring.interpolate(min(s + 0.05, L)).coords[0])
                t = q - p; t /= max(np.linalg.norm(t), 1e-9); nrm = np.array([-t[1], t[0]])
                if not poly.contains(Point(p + nrm * 0.1)): nrm = -nrm               # (inward)
                wall = walls is not None and walls.distance(Point(p)) < 0.5
                if wall:
                    report['edgeWall'] += 0.3
                    # room inward (how wide the earth is here)
                    room = 0.0
                    for d in (0.4, 0.8, 1.2):
                        if poly.contains(Point(p + nrm * d)): room = d
                    # a fringe two or three plants deep at the wall's foot, the tallest against it
                    if rng.random() < 0.95:
                        d = rng.uniform(0.03, 0.3); place(p + nrm * d, pick(rng, room), rng.uniform(1.0, 1.6))
                    if room >= 0.4 and rng.random() < 0.6:
                        d = rng.uniform(0.25, min(0.8, room)); place(p + nrm * d, pick(rng, room - d), rng.uniform(0.85, 1.35))
                    if room >= 0.8 and rng.random() < 0.2:
                        d = rng.uniform(0.15, 0.45); place(p + nrm * d, 'plume' if rng.random() < 0.6 else ('box' if rng.random() < 0.5 else 'privet'), rng.uniform(1.1, 1.6))
                else:
                    report['edgePaving'] += 0.3
                    if rng.random() < 0.35:
                        place(p + nrm * rng.uniform(0.02, 0.15), 'grass', rng.uniform(0.6, 1.0))
        # the open ground: clumps where it is little trodden
        x0, z0, x1, z1 = poly.bounds
        xs = np.arange(x0, x1, 0.6); zs = np.arange(z0, z1, 0.6)
        for x in xs:
            for z in zs:
                p = np.array([x + rng.uniform(-0.3, 0.3), z + rng.uniform(-0.3, 0.3)])
                pt = Point(p)
                if not poly.contains(pt): continue
                if poly.boundary.distance(pt) < 0.8: continue
                c = noise(p[0], p[1], 4.0, 1) * noise(p[0], p[1], 11.0, 2)
                if rng.random() < 0.03 + 1.3 * c ** 2.0:
                    place(p, pick(rng, 2.0), rng.uniform(0.85, 1.4))
    manifest = []; total = 0
    for cname in cnames:
        rows = outs[cname].rows
        if not rows: continue
        A = np.array(rows, np.float32); total += len(A) // 3
        c = chunks[cname]; stem = pathlib.Path(c['mesh']).stem; si = c['surfaces']
        A.tofile(out / f'{stem}-{si}.f32')
        manifest.append({'mesh': c['mesh'], 'nodePath': cname, 'sourceHash': hashlib.sha256((REPO / 'native-godot' / c['mesh'][6:]).read_bytes()).hexdigest(),
                         'surfaces': [{'index': si, 'file': f'{stem}-{si}.f32', 'material': MAT, 'custom0': True, 'custom0Rgba': True, 'tangent': True}]})
    report['triangles'] = total; report['meshes'] = len(manifest)
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report)

if __name__ == '__main__':
    main()
