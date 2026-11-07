"""Close the town wall's batter slits (#301). build_wall.py ends a battered field face where its offset line meets the
next face's offset line at the same depth; where that next face is a town or river face with no batter, the field face
stops short of it and an upright slit opens, 0 at the foot to the batter's 15 cm at the walk (the river bastion and the
wall's west end at the river showed the sky through it). Each such open end is carried along its own face to the next.
    python wall-batter-corners.py <dump folder from dump-wall-meshes.gd> <out moves.json>
Then: WALL_MOVES=<moves.json> WALL_BACKUP=<folder> godot --headless --path . -s res://scripts/move-wall-vertices.gd
In detail: each upright open end of a wall face (a vertical edge used by one triangle of its
mesh) is carried along its own face, level, to the nearest upright wall face 0.8..45 cm ahead, kept only where the gap widens at the batter's rate along 2 m or more of edge and not on a gate. Writes moves.json: per mesh
resource, world positions old -> new (every vertex at that position in that mesh moves)."""
import json, sys, numpy as np, pathlib, collections
D = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
REACH, MIN = 0.45, 0.008
FLAT = 3000   # a modelled-brick or quoin surface has many more triangles: its own joints are not gaps
idx = json.load(open(D / 'index.json'))
meshes = []   # (record, [surface arrays])
allT = []; owner = []
for mi, r in enumerate(idx):
    surfs = []
    for s in r['surfaces']:
        raw = np.fromfile(D / s['file'], np.float32)
        T = raw.reshape(-1, 3, 3).astype(np.float64) if raw.size and raw.size % 9 == 0 else np.zeros((0, 3, 3))
        surfs.append(T)
        allT.append(T); owner += [mi] * len(T)
    meshes.append((r, surfs))
allT = np.concatenate(allT); owner = np.array(owner)
N = np.cross(allT[:, 1] - allT[:, 0], allT[:, 2] - allT[:, 0]); NL = np.linalg.norm(N, axis=1); ok = NL > 1e-12
N[ok] /= NL[ok, None]
lo = allT.min(axis=1); hi = allT.max(axis=1)
big = np.nonzero(np.max(hi - lo, axis=1) > 0.8)[0]
cells = collections.defaultdict(list)
for i, c in enumerate(np.floor((lo + hi) / 2).astype(int)):
    if np.max(hi[i] - lo[i]) <= 0.8: cells[tuple(c)].append(i)
def around(v):
    c = np.floor(v).astype(int); ids = [big]
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                l = cells.get((c[0] + dx, c[1] + dy, c[2] + dz))
                if l: ids.append(np.array(l))
    ids = np.concatenate(ids)
    return ids[np.all(lo[ids] <= v + REACH + 0.01, axis=1) & np.all(hi[ids] >= v - REACH - 0.01, axis=1)]
def key(p): return tuple(np.round(p, 4))
def ray(o, d, mask):
    T = allT[mask]; e1 = T[:, 1] - T[:, 0]; e2 = T[:, 2] - T[:, 0]
    p = np.cross(d, e2); det = (e1 * p).sum(1); good = np.abs(det) > 1e-12
    inv = np.zeros_like(det); inv[good] = 1 / det[good]
    tv = o - T[:, 0]; u = (tv * p).sum(1) * inv
    q = np.cross(tv, e1); v = (q * d).sum(1) * inv; t = (e2 * q).sum(1) * inv
    hit = good & (u >= -1e-6) & (v >= -1e-6) & (u + v <= 1 + 1e-6) & (t > MIN) & (t <= REACH)
    return t, hit
moves = {}; report = collections.Counter(); dists = []
for mi, (r, surfs) in enumerate(meshes):
    flat = [s for s in surfs if 0 < len(s) <= FLAT]
    T = np.concatenate(flat) if flat else np.zeros((0, 3, 3))
    if not len(T): continue
    edges = collections.defaultdict(list)
    for ti, tri in enumerate(T):
        ks = [key(p) for p in tri]
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if ks[a] != ks[b]: edges[tuple(sorted((ks[a], ks[b])))].append(ti)
    done = {}; upright = []
    for (ka, kb), tris in edges.items():
        if len(tris) != 1: continue
        a, b = np.array(ka), np.array(kb); dv = b - a
        if abs(dv[1]) < 0.05 or abs(dv[1]) < 2 * np.hypot(dv[0], dv[2]): continue
        tri = T[tris[0]]; n = np.cross(tri[1] - tri[0], tri[2] - tri[0]); n /= np.linalg.norm(n) + 1e-12
        if abs(n[1]) > 0.7: continue
        t = np.cross([0, 1, 0], n); t[1] = 0; t /= np.linalg.norm(t) + 1e-12
        upright.append((ka, kb))
        c = tri.mean(axis=0)
        if np.dot(t, (a + b) / 2 - c) < 0: t = -t
        for k in (ka, kb):
            if k in done: continue
            v = np.array(k)
            ids = around(v)
            # not the faces this vertex belongs to, only upright faces
            touch = np.any(np.all(np.abs(allT[ids] - v) < 2e-4, axis=2), axis=1)
            ids = ids[~((owner[ids] == mi) & touch) & (np.abs(N[ids, 1]) < 0.7)]
            if not len(ids): done[k] = None; continue
            s, hit = ray(v, t, ids)
            if not hit.any(): done[k] = None; continue
            sm = s[hit].min()
            done[k] = (v + t * sm).tolist()
    # only the batter's fault: an upright open end whose gap widens with height (the field face's end was put on the
    # neighbour's batter line, where that neighbour has none): 1.5 cm or more wider at its top than at its foot
    keep = set()
    for ka, kb in upright:
        if done.get(ka) is None or done.get(kb) is None: continue
        lo_k, hi_k = (ka, kb) if ka[1] < kb[1] else (kb, ka)
        g_lo = np.linalg.norm(np.array(done[lo_k]) - np.array(lo_k)); g_hi = np.linalg.norm(np.array(done[hi_k]) - np.array(hi_k))
        rise = abs(kb[1] - ka[1]); rate = (g_hi - g_lo) / max(rise, 1e-6)
        # the batter's own rate: 15 cm over the 3-15 m of a field face, so 0.8-5 cm a metre; not the gates (their faces overlap the wall by design), along at least 2 m of edge (a polygonal tower's facets touch over 1 m)
        if rise >= 2.0 and 0.008 <= rate <= 0.05 and g_hi <= 0.4 and not r["name"].startswith("gate_"): keep |= {ka, kb}
    mv = [[list(k), new] for k, new in done.items() if new is not None and k in keep]
    dists += [float(np.linalg.norm(np.array(a) - np.array(b))) for a, b in mv]
    if mv:
        moves.setdefault(r['mesh'], {'node': r['name'], 'moves': []})['moves'] += mv
        report[r['name']] += len(mv)
json.dump(moves, open(out, 'w'), indent=1)
print('meshes', len(moves), 'vertices', sum(len(m['moves']) for m in moves.values()))
if dists: print('distance cm: median %.1f max %.1f' % (np.median(dists) * 100, max(dists) * 100))
for k, v in report.most_common(40): print(' ', k, v)
