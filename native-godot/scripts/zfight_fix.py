"""Issue #174: find and remove faces drawn twice in one plane (z-fighting: the two flicker against each other).
Used by repair-shopfronts.py; also runnable alone to report:
    python scripts/zfight_fix.py <audit folder> [<audit folder> ...] --zones <zones.json> --report <out.json>

Two faces fight when they lie in one plane (within 1.2 mm, their normals within 2.5 degrees, facing the same way) and
their areas overlap by more than 2 cm2. Of each pair one is cut: the part of it under the other is taken out and the rest
is cut into new triangles whose every attribute (uv, colour, ...) is read from the old triangle at that point, so what
shows does not change; a face left with nothing is dropped. Which one is cut (RANK, the lower): the bake's old stone
boxes under the dressed stone of the stone pass; the walls' own faces (reveals, soffits) under the wood, the street life
and the dressed stone laid on them; of two faces of one kind, the later one. Decals and lettering, which are drawn on a
surface on purpose (a depth bias), are left out.
"""
import collections, json, pathlib, sys
import numpy as np
import shapely
from shapely.geometry import Polygon
from shapely.ops import unary_union
from scipy.spatial import cKDTree

SKIP = {"grime_decal", "streetlife_grounddecal", "streetlife_walldecal", "town_letters", "streetlife_glow", "streetlife_numbers"}
RANK = {"material_25": 0, "material_23": 1, "city_wood": 2, "city_roof_atlas": 2, "material_803": 3, "streetlife_solid": 3,
        "dressed_stone": 4, "town_signs": 5, "wall_iron": 6}
GAP, COS, MIN_AREA = 0.0012, 0.999, 2e-4

def planes(P, n0):
    e = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); a = np.linalg.norm(e, axis=1)
    ok = a > 1e-7
    n = np.zeros_like(e); n[ok] = e[ok] / a[ok, None]
    sgn = np.sign((n * n0).sum(1)); sgn[sgn == 0] = 1; n *= sgn[:, None]
    return n, (n * P[:, 0]).sum(1), ok

def find_pairs(tris):
    """tris: list of (P (3x3), n (unit), d, rank, key). Returns [(i, j, area)] of fighting pairs."""
    if not tris: return []
    N = np.array([t[1] for t in tris]); D = np.array([t[2] for t in tris])
    kn = np.round(N * 20).astype(np.int64); kd = np.floor(D / 0.003).astype(np.int64)
    groups = collections.defaultdict(list)
    for i in range(len(tris)): groups[(kn[i, 0], kn[i, 1], kn[i, 2], kd[i])].append(i)
    out = []
    for key, idx in groups.items():
        pool = idx + groups.get((key[0], key[1], key[2], key[3] + 1), [])
        if len(pool) < 2: continue
        n0 = N[idx[0]]; u = np.cross(n0, (0, 1, 0) if abs(n0[1]) < 0.9 else (1, 0, 0)); u /= np.linalg.norm(u); v = np.cross(n0, u)
        P2 = np.stack([np.stack([tris[i][0] @ u, tris[i][0] @ v], -1) for i in pool])  # (m, 3, 2)
        lo, hi = P2.min(1), P2.max(1); pool_a = np.array(pool); Dp, Np = D[pool_a], N[pool_a]
        for a_, i in enumerate(idx):
            # (the candidates by their boxes in the plane, their plane and their facing, at once)
            c = np.where((lo[:, 0] < hi[a_, 0] - 1e-4) & (hi[:, 0] > lo[a_, 0] + 1e-4) & (lo[:, 1] < hi[a_, 1] - 1e-4) & (hi[:, 1] > lo[a_, 1] + 1e-4)
                         & (np.abs(Dp - D[i]) <= GAP) & (Np @ N[i] >= COS))[0]
            for b_ in c:
                j = pool[b_]
                if j == i or (b_ < len(idx) and j < i): continue
                pi, pj = Polygon(P2[a_]), Polygon(P2[b_])
                if not (pi.is_valid and pj.is_valid): continue
                ar = pi.intersection(pj).area
                if ar > MIN_AREA: out.append((i, j, ar))
    return out

def cut(T, holes, n):
    """Triangle rows T (3 x 16) less the union of `holes` (world triangles in its plane): new rows (k*3 x 16)."""
    P = T[:, :3].astype(float)
    u = np.cross(n, (0, 1, 0) if abs(n[1]) < 0.9 else (1, 0, 0)); u /= np.linalg.norm(u); v = np.cross(n, u)
    to2 = lambda Q: np.stack([Q @ u, Q @ v], -1)
    tri = Polygon(to2(P))
    rest = tri.difference(unary_union([Polygon(to2(h)).buffer(1e-6) for h in holes]))
    if rest.is_empty or rest.area < 1e-7: return np.zeros((0, 16), np.float32)
    # barycentric reading of the old triangle's attributes at each new corner
    a2 = to2(P); M = np.array([[a2[0, 0] - a2[2, 0], a2[1, 0] - a2[2, 0]], [a2[0, 1] - a2[2, 1], a2[1, 1] - a2[2, 1]]])
    Minv = np.linalg.inv(M)
    rows = []
    for t in shapely.constrained_delaunay_triangles(rest).geoms:
        if t.area < 1e-9: continue
        cs = np.array(t.exterior.coords)[:3]
        tr = []
        for c in cs:
            l12 = Minv @ (c - a2[2]); w = np.array([l12[0], l12[1], 1 - l12.sum()])
            r = (w[:, None] * T.astype(float)).sum(0)
            r[3:6] = T[0, 3:6]  # (the face's normal as it was)
            tr.append(r)
        # keep the old winding
        e_old = np.cross(P[1] - P[0], P[2] - P[0]); e_new = np.cross(tr[1][:3] - tr[0][:3], tr[2][:3] - tr[0][:3])
        if np.dot(e_old, e_new) < 0: tr[1], tr[2] = tr[2], tr[1]
        rows += tr
    return np.asarray(rows, np.float32).reshape(-1, 16)

def resolve(surfaces, zones=None, radius=2.6, ymax=4.3, log=None):
    """surfaces: {key: (name, T (k x 3 x 16) array)} for every surface considered (rows world space). zones: points (x, z)
    to look near (None: everywhere). Returns ({key: new T}, report)."""
    tris = []
    zt = cKDTree(np.asarray(zones)[:, [0, 1]]) if zones is not None and len(zones) else None
    for key, (name, T) in surfaces.items():
        if name in SKIP or len(T) == 0: continue
        cen = T[:, :, :3].mean(1)
        if zt is not None:
            d, _ = zt.query(cen[:, [0, 2]], distance_upper_bound=radius)
            sel = np.where(np.isfinite(d) & (cen[:, 1] < ymax))[0]
        else: sel = np.arange(len(T))
        if len(sel) == 0: continue
        P = T[sel, :, :3].astype(float)
        n, dd, ok = planes(P, T[sel, 0, 3:6].astype(float))
        for k in np.where(ok)[0]:
            tris.append((P[k], n[k], dd[k], RANK.get(name, 3), (key, int(sel[k]))))
    pairs = find_pairs(tris)
    holes = collections.defaultdict(list)  # (key, triangle) -> the winners' triangles over it
    stats = collections.Counter()
    for i, j, a in pairs:
        ti, tj = tris[i], tris[j]
        # the loser: the lower rank; of one rank the later surface and triangle
        if ti[3] != tj[3]: lose, win = (ti, tj) if ti[3] < tj[3] else (tj, ti)
        else: lose, win = (ti, tj) if ti[4] > tj[4] else (tj, ti)
        holes[lose[4]].append(win[0])
        stats[f"{surfaces[lose[4][0]][0]} under {surfaces[win[4][0]][0]}"] += 1
    out = {}
    cut_n = dropped = 0
    for (key, k), hs in holes.items():
        name, T = surfaces[key]
        if key not in out: out[key] = {"drop": set(), "add": []}
        n = planes(T[k:k + 1, :, :3].astype(float), T[k:k + 1, 0, 3:6].astype(float))[0][0]
        new = cut(T[k], hs, n)
        out[key]["drop"].add(k)
        if len(new): out[key]["add"].append(new); cut_n += 1
        else: dropped += 1
    result = {}
    for key, ch in out.items():
        name, T = surfaces[key]
        keep = np.ones(len(T), bool); keep[list(ch["drop"])] = False
        add = np.concatenate(ch["add"]).reshape(-1, 3, 16) if ch["add"] else np.zeros((0, 3, 16), np.float32)
        result[key] = np.concatenate([T[keep], add.astype(np.float32)])
    report = {"pairs": len(pairs), "trianglesCut": cut_n, "trianglesDropped": dropped, "surfaces": len(result), "byKind": dict(stats.most_common())}
    return result, report

if __name__ == "__main__":
    args = sys.argv[1:]; zf = args[args.index("--zones") + 1] if "--zones" in args else None; rep = args[args.index("--report") + 1]
    folders = [a for a in args if not a.startswith("--") and a not in (zf, rep)]
    surfaces = {}
    for f in folders:
        f = pathlib.Path(f)
        for rec in json.loads((f / "audit.json").read_text()):
            for s in rec["surfaces"]:
                surfaces[(rec["node"], s["index"])] = (s["name"], np.fromfile(f / "source" / s["file"], dtype=np.float32).reshape(-1, 3, 16))
    zones = np.array(json.loads(pathlib.Path(zf).read_text())) if zf else None
    _, report = resolve(surfaces, zones)
    pathlib.Path(rep).write_text(json.dumps(report, indent=1)); print(report)
