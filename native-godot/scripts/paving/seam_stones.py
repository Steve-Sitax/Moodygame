"""Street paving: no stretched setts, and a row of stones where two layouts meet.
    python seam_stones.py <ground rows .f32> <tile m> <rows per tile> <out rows .f32> <report .json>
Reads the installed ground's world-space rows (dump-ground.gd), so later repairs (junction phase, Ruien cut) are kept.
Positions, outline, holes, heights, normals, colours and uv2 stay as they were; only faces that are stretched, or lie on
a joint between two layouts, are cut again and get new uv:
- stretched field (a street's rows collapsed past its end or round a tight inside corner): straight courses in the
  frame of the same street's good setts next to it, continuing them where they can;
- every joint between two street layouts, and a repaired patch's edge where its courses do not run on: one row of setts
  laid lengthwise along the joint (as the edge course does along a kerb), mitred at its bends;
- a stretched face of the edge course itself: its own course turned rigid (no stretch), along the same kerb.
The hidden ground under the houses (the old world picture) and the edge course along kerbs are not cut.
"""
import sys, json, math, time
import numpy as np, shapely
from shapely.geometry import LineString, Polygon, box
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

ANISO, SMIN, SMAX = 1.15, 0.8, 1.3   # a face is stretched past these (where the fan shrinks or grows a sett by a third)

def jacobians(T):
    P = T[:, :, [0, 2]]; U = T[:, :, [6, 7]]
    dP = np.stack([P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]], 2); dU = np.stack([U[:, 1] - U[:, 0], U[:, 2] - U[:, 0]], 2)
    det = np.linalg.det(dP); J = np.zeros((len(T), 2, 2)); ok = np.abs(det) > 1e-12
    J[ok] = dU[ok] @ np.linalg.inv(dP[ok])
    return J, np.abs(det) / 2

def polar(J):
    u, _, vt = np.linalg.svd(J); return u @ vt

def uv_charts(T):
    """Faces joined where they share an edge with the same uv at both its corners: one layout patch each."""
    n = len(T)
    key = np.concatenate([np.round(T[:, :, [0, 2]] * 1e4), np.round(T[:, :, [6, 7]] * 1e5)], 2).astype(np.int64).reshape(-1, 4)
    _, vid = np.unique(key, axis=0, return_inverse=True); vid = vid.reshape(n, 3)
    e = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]], vid[:, [2, 0]]]); e.sort(1); t = np.tile(np.arange(n), 3)
    o = np.lexsort((e[:, 1], e[:, 0])); e, t = e[o], t[o]
    same = (e[1:] == e[:-1]).all(1)
    g = coo_matrix((np.ones(same.sum()), (t[:-1][same], t[1:][same])), shape=(n, n))
    return connected_components(g, directed=False)[1]

def seam_edges(T, lab, field):
    """Edges shared by two field faces of different layouts (world x, z pairs)."""
    n = len(T)
    _, vid = np.unique(np.round(T[:, :, [0, 2]] * 1e4).astype(np.int64).reshape(-1, 2), axis=0, return_inverse=True)
    vid = vid.reshape(n, 3)
    E = np.concatenate([np.stack([vid[:, a], vid[:, b], np.arange(n), np.full(n, a), np.full(n, b)], 1) for a, b in [(0, 1), (1, 2), (2, 0)]])
    k = np.sort(E[:, :2], 1); o = np.lexsort((k[:, 1], k[:, 0])); E, k = E[o], k[o]
    i = np.nonzero((k[1:] == k[:-1]).all(1))[0]; A, B = E[i], E[i + 1]
    s = (lab[A[:, 2]] != lab[B[:, 2]]) & field[A[:, 2]] & field[B[:, 2]]
    A = A[s]
    return np.stack([T[A[:, 2], A[:, 3]][:, [0, 2]], T[A[:, 2], A[:, 4]][:, [0, 2]]], 1)

def split_sharp(line, turn=50.0):
    c = np.asarray(line.coords)
    if len(c) < 3: return [c]
    out = []; start = 0
    for j in range(1, len(c) - 1):
        a = c[j] - c[j - 1]; b = c[j + 1] - c[j]
        if math.degrees(abs(math.atan2(a[0] * b[1] - a[1] * b[0], a @ b))) > turn:
            out.append(c[start:j + 1]); start = j
    out.append(c[start:]); return out

class Band:
    """One row of setts along a polyline: per segment a mitred cell, uv along (u) and across (v, one row)."""
    def __init__(self, pts, width, tile, u0):
        p = np.asarray(pts, float)
        d = np.diff(p, axis=0); L = np.hypot(*d.T); keep = np.r_[True, L > 1e-4]; p = p[keep]
        d = np.diff(p, axis=0); L = np.hypot(*d.T)
        # run on half a width past each end: the band reaches the kerb's course or the other band
        p[0] -= d[0] / L[0] * width * 0.5; p[-1] += d[-1] / L[-1] * width * 0.5
        d = np.diff(p, axis=0); L = np.hypot(*d.T)
        self.p, self.dir, self.cum = p, d / L[:, None], np.r_[0, np.cumsum(L)[:-1]]
        self.nrm = np.stack([-self.dir[:, 1], self.dir[:, 0]], 1)
        self.h, self.tile, self.u0 = width / 2, tile, u0
        h = self.h; m = len(L)
        off = np.zeros((m + 1, 2))
        off[0] = self.nrm[0] * h; off[-1] = self.nrm[-1] * h
        for i in range(1, m):
            b = self.nrm[i - 1] + self.nrm[i]; b /= max(np.hypot(*b), 1e-9)
            off[i] = b * h / max(b @ self.nrm[i], 0.5)
        self.cells = [shapely.make_valid(Polygon([p[k] - off[k], p[k + 1] - off[k + 1], p[k + 1] + off[k + 1], p[k] + off[k]])) for k in range(m)]

    def uv(self, k, q):
        a = self.p[k]; dq = q - a
        u = self.u0 + self.cum[k] + dq @ self.dir[k]; v = dq @ self.nrm[k] + self.h
        return np.stack([u, v], 1) / self.tile

def bary(tri, q):
    a = tri[0]; M = np.stack([tri[1] - a, tri[2] - a], 1)
    w = np.linalg.solve(M, (q - a).T).T
    return np.column_stack([1 - w.sum(1), w])

def run(source_path, tile, rows, out, report_path):
    t0 = time.time(); log = lambda *a: print(f'[{time.time() - t0:6.1f}s]', *a, flush=True)
    R = np.fromfile(source_path, np.float32).reshape(-1, 3, 16).astype(np.float64)
    n = len(R); P = R[:, :, [0, 2]]
    J, A = jacobians(R)
    s = np.linalg.svd(J, compute_uv=False); aniso = s[:, 0] / np.maximum(s[:, 1], 1e-12); scale = np.sqrt(s[:, 0] * s[:, 1]) * tile
    hidden = np.abs(R[:, :, [6, 7]] * tile - P).max((1, 2)) < 2e-3
    lab = uv_charts(R); nc = lab.max() + 1
    vmin = np.full(nc, 1e9); vmax = np.full(nc, -1e9)
    np.minimum.at(vmin, np.repeat(lab, 3), R[:, :, 7].ravel()); np.maximum.at(vmax, np.repeat(lab, 3), R[:, :, 7].ravel())
    course = ((vmax - vmin) * tile < 0.9)[lab] & ~hidden
    field = ~hidden & ~course
    stretched = (aniso > ANISO) | (scale < SMIN) | (scale > SMAX)
    bad_field = field & stretched; bad_course = course & stretched
    log(f'{n} faces, {nc} layouts; stretched field {A[bad_field].sum():.0f} m2, course {A[bad_course].sum():.0f} m2')
    out_rows = R.copy()

    # 1. the edge course's stretched faces: rigid in their own course's frame
    Jsum = np.zeros((nc, 2, 2)); good = course & ~stretched
    np.add.at(Jsum, lab[good], J[good] * A[good][:, None, None])
    for t in np.nonzero(bad_course)[0]:
        Q = polar(J[t]) if s[t, 1] * tile > 0.3 else (polar(Jsum[lab[t]]) if np.abs(Jsum[lab[t]]).sum() > 0 else polar(J[t] + np.eye(2) * 1e-9))
        c = P[t].mean(0); uc = R[t, :, 6:8].mean(0)
        out_rows[t, :, 6:8] = uc + (P[t] - c) @ Q.T / tile

    # 2. the stretched field: patches with straight courses
    polys = shapely.polygons(P)
    F = shapely.make_valid(shapely.union_all(polys[field]))
    shapely.prepare(F)
    tree = shapely.STRtree(polys)
    bad = shapely.union_all(polys[bad_field])
    # closed over small gaps, its outline straightened, then a little into the good setts round it (one piece at a time:
    # a buffer of the whole town's at once drops pieces)
    parts = shapely.get_parts(bad)
    parts = shapely.buffer(shapely.buffer(parts, 0.35, quad_segs=4), -0.35, quad_segs=4)
    parts = shapely.buffer(shapely.simplify(parts, 0.1), 0.25, join_style='mitre')
    reg = shapely.intersection(shapely.union_all(parts), F)
    outside = shapely.difference(bad, reg).area
    if outside > 0.01: raise RuntimeError(f'stretched faces outside the patches: {outside} m2')
    regions = [g for g in shapely.get_parts(reg) if g.geom_type == 'Polygon' and g.area > 1e-3]
    log(f'field area {F.area:.0f} m2; {len(regions)} patches, {sum(g.area for g in regions):.0f} m2')
    frames = []
    for g in regions:
        inside = tree.query(g, predicate='intersects')
        inside = inside[bad_field[inside]]
        cl = np.bincount(lab[inside], weights=A[inside]).argmax() if len(inside) else -1
        ring = g.buffer(1.5, join_style='mitre')
        near = tree.query(ring, predicate='intersects')
        near = near[field[near] & ~stretched[near]]
        own = near[lab[near] == cl]
        use = own if A[own].sum() > 0.3 else near
        if A[use].sum() > 1e-3:
            Q = polar((J[use] * A[use][:, None, None]).sum(0))
            # the offset from the setts right next to the patch, so their courses run on where the frames agree
            close = use[shapely.distance(polys[use], g) < 0.6] if len(use) else use
            close = close if len(close) else use
            c = P[close].reshape(-1, 2); uvc = R[close][:, :, 6:8].reshape(-1, 2)
            off = (uvc - c @ Q.T / tile).mean(0)
        else:
            rect = np.asarray(shapely.minimum_rotated_rectangle(g).exterior.coords)
            e = np.diff(rect, axis=0)[:2]; ax = e[np.argmax(np.hypot(*e.T))]; ax /= np.hypot(*ax)
            Q = np.array([[ax[0], ax[1]], [-ax[1], ax[0]]]); off = np.zeros(2)
        frames.append((Q, off))
    # where a patch's courses do not run on into its neighbours: a joint, so a band
    def rigid(k, q): Q, off = frames[k]; return q @ Q.T / tile + off
    Fb = F.boundary
    region_index = shapely.STRtree(np.array(regions, dtype=object))
    joint_lines = []
    for k, g in enumerate(regions):
        edge = shapely.difference(g.boundary, Fb.buffer(0.02))
        for piece in shapely.get_parts(shapely.line_merge(edge) if not edge.is_empty else edge):
            if piece.geom_type != 'LineString' or piece.length < 0.05: continue
            m = max(2, int(piece.length / 0.2) + 1)
            q = shapely.get_coordinates(shapely.line_interpolate_point(piece, np.linspace(0, piece.length, m)))
            # the neighbour's uv just outside the patch: another patch's, or the setts' as laid
            out_pts = shapely.points(q)
            cand = tree.query(out_pts, predicate='intersects')
            mis = np.zeros(m)
            for pi, ti in zip(*cand):
                if not field[ti] or bad_field[ti]: continue
                w = bary(P[ti], q[pi:pi + 1]); uvn = w @ R[ti, :, 6:8]
                dlt = rigid(k, q[pi:pi + 1]) - uvn; dlt -= np.round(dlt)
                mis[pi] = max(mis[pi], np.hypot(*dlt[0]) * tile)
            for pi, j in zip(*region_index.query(out_pts, predicate='dwithin', distance=1e-3)):
                if j == k: continue
                dlt = rigid(k, q[pi:pi + 1]) - rigid(j, q[pi:pi + 1]); dlt -= np.round(dlt)
                mis[pi] = max(mis[pi], np.hypot(*dlt[0]) * tile)
            bad_s = mis > 0.02
            if not bad_s.any(): continue
            # runs of mismatched samples, half a metre more each side
            dist = np.linspace(0, piece.length, m)
            idx = np.nonzero(bad_s)[0]
            runs = np.split(idx, np.nonzero(np.diff(idx) > 3)[0] + 1)
            for r in runs:
                a, b = max(0, dist[r[0]] - 0.5), min(piece.length, dist[r[-1]] + 0.5)
                if b - a > 0.05: joint_lines.append(shapely.ops.substring(piece, a, b))
    # 3. the joints between layouts (outside the patches, which replace both sides)
    E = seam_edges(R, lab, field)
    seams = shapely.line_merge(shapely.union_all(shapely.linestrings(E)))
    RU = shapely.union_all(regions) if regions else Polygon()
    seams = shapely.difference(seams, RU.buffer(-0.01)) if regions else seams
    lines = [g for g in shapely.get_parts(shapely.line_merge(shapely.union_all(list(shapely.get_parts(seams)) + joint_lines)))
             if g.geom_type == 'LineString' and g.length > 0.1]
    pieces = []
    for g in lines:
        g = g.simplify(0.03)
        for c in split_sharp(g):
            if len(c) >= 2 and LineString(c).length > 0.1: pieces.append(c)
    pieces.sort(key=lambda c: -LineString(c).length)
    width = tile / rows
    rng = np.random.default_rng(1873)
    bands = [Band(c, width, tile, float(rng.uniform(0, tile))) for c in pieces]
    log(f'joints {sum(LineString(c).length for c in pieces):.0f} m in {len(pieces)} bands')
    # cells: each band's segments, clipped to the field, earlier (longer) bands first
    raw = [(bi, k, c) for bi, b in enumerate(bands) for k, c in enumerate(b.cells)]
    clipped = shapely.intersection(np.array([c for _, _, c in raw], dtype=object), F)
    ctree = shapely.STRtree(clipped)
    cells = []
    for i, (bi, k, _) in enumerate(raw):
        g = clipped[i]
        if g.is_empty or g.area < 1e-6: continue
        prior = [j for j in ctree.query(g, predicate='intersects') if j < i]
        if prior: g = shapely.difference(g, shapely.union_all(clipped[prior]))
        g = shapely.make_valid(g)
        parts = [x for x in shapely.get_parts(g) if x.geom_type == 'Polygon' and x.area > 1e-6]
        if parts: cells.append((bi, k, shapely.union_all(parts)))
    taken = shapely.union_all([c for _, _, c in cells]) if cells else Polygon()
    log(f'{len(cells)} band cells, {sum(c[2].area for c in cells):.1f} m2')
    region_geoms = [shapely.difference(g, taken) for g in regions]
    kinds = [(0, i) for i in range(len(cells))] + [(1, k) for k, g in enumerate(region_geoms) if not g.is_empty]
    cut = np.array([c[2] for c in cells] + [g for g in region_geoms if not g.is_empty], dtype=object)
    # 4. cut the faces they touch: each face's part in every band cell and patch, and the rest of it as laid
    ti, ci = shapely.STRtree(cut).query(polys, predicate='intersects')
    f = field[ti]; ti, ci = ti[f], ci[f]
    hit = np.unique(ti)
    log(f'{len(hit)} faces to cut')
    part_geom = list(shapely.intersection(polys[ti], cut[ci])); part_src = list(ti); part_kind = [kinds[c] for c in ci]
    o = np.argsort(ti, kind='stable'); ts_, cs_ = ti[o], ci[o]
    st = np.r_[0, np.nonzero(np.diff(ts_))[0] + 1, len(ts_)]
    for x, y in zip(st[:-1], st[1:]):
        t = ts_[x]
        part_geom.append(shapely.difference(polys[t], shapely.union_all(cut[cs_[x:y]])))
        part_src.append(t); part_kind.append((2, -1))
    part_geom = np.array(part_geom, dtype=object); part_src = np.asarray(part_src)
    # a face whose parts do not add up to it (cut shapes touching within float noise): cut again one shape at a time
    got = np.bincount(part_src, weights=shapely.area(part_geom), minlength=n)
    redo = hit[np.abs(got[hit] - A[hit]) > 1e-7 + A[hit] * 1e-6]
    if len(redo):
        drop = np.isin(part_src, redo)
        part_geom, part_src = list(part_geom[~drop]), list(part_src[~drop])
        part_kind = [k for k, d in zip(part_kind, drop) if not d]
        for t in redo:
            rest = polys[t]
            for c in cs_[st[np.searchsorted(ts_[st[:-1]], t)]:st[np.searchsorted(ts_[st[:-1]], t) + 1]]:
                part_geom.append(shapely.intersection(rest, cut[c])); part_src.append(t); part_kind.append(kinds[c])
                rest = shapely.difference(rest, cut[c])
            part_geom.append(rest); part_src.append(t); part_kind.append((2, -1))
        part_geom = np.array(part_geom, dtype=object); part_src = np.asarray(part_src)
        log(f'{len(redo)} faces cut again one shape at a time')
    flat, owner = shapely.get_parts(part_geom, return_index=True)
    ok = (shapely.get_type_id(flat) == 3) & (shapely.area(flat) > 1e-10)
    flat, owner = flat[ok], owner[ok]
    lost = A[hit].sum() - shapely.area(flat).sum()
    log(f'{len(flat)} pieces; area not in a piece {lost:.5f} m2')
    tris, towner = shapely.get_parts(shapely.constrained_delaunay_triangles(flat), return_index=True)
    C = shapely.get_coordinates(tris).reshape(-1, 4, 2)[:, :3]
    piece = owner[towner]
    src = np.asarray(part_src)[piece]
    kind = np.array([part_kind[i][0] for i in piece]); pay = np.array([part_kind[i][1] for i in piece])
    # each new face turns as its source face did
    sP = P[src]
    e1, e2 = sP[:, 1] - sP[:, 0], sP[:, 2] - sP[:, 0]; cs = e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]
    d1, d2 = C[:, 1] - C[:, 0], C[:, 2] - C[:, 0]; cr = d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0]
    flip = np.sign(cr) != np.sign(cs); C[flip] = C[flip][:, [0, 2, 1]]
    good = np.abs(cr) > 1e-12; C, src, kind, pay = C[good], src[good], kind[good], pay[good]
    # every attribute from the source face (barycentric), positions exact
    a0 = sP[good][:, 0]; M = np.stack([e1[good], e2[good]], 2)
    w = np.linalg.solve(M[:, None].repeat(3, 1), (C - a0[:, None])[..., None])[..., 0]
    W = np.concatenate([1 - w.sum(-1, keepdims=True), w], -1)
    rr = np.einsum('tkj,tjc->tkc', W, R[src])
    rr[:, :, 0] = C[:, :, 0]; rr[:, :, 2] = C[:, :, 1]
    _, An = jacobians(rr)
    stats = dict(band=float(An[kind == 0].sum()), patch=float(An[kind == 1].sum()), kept=float(An[kind == 2].sum()))
    for i in np.nonzero(kind == 0)[0]:
        bi, k, _ = cells[pay[i]]; rr[i, :, 6:8] = bands[bi].uv(k, C[i])
    for k in np.unique(pay[kind == 1]):
        m = (kind == 1) & (pay == k); rr[m, :, 6:8] = rigid(k, C[m].reshape(-1, 2)).reshape(-1, 3, 2)
    new_rows = [rr]
    keep = np.ones(n, bool); keep[hit] = False
    result = np.concatenate([out_rows[keep]] + new_rows) if new_rows else out_rows
    a_before = A.sum(); _, A2 = jacobians(result)
    log(f'area {a_before:.3f} -> {A2.sum():.3f} m2; faces {n} -> {len(result)}')
    if abs(A2.sum() - a_before) > max(0.01, a_before * 1e-6): raise RuntimeError('ground area changed')
    result.astype(np.float32).tofile(out)
    J2, _ = jacobians(result); s2 = np.linalg.svd(J2, compute_uv=False)
    an2 = s2[:, 0] / np.maximum(s2[:, 1], 1e-12); sc2 = np.sqrt(s2[:, 0] * s2[:, 1]) * tile
    hid2 = np.abs(result[:, :, [6, 7]] * tile - result[:, :, [0, 2]]).max((1, 2)) < 2e-3
    st2 = ((an2 > ANISO) | (sc2 < SMIN) | (sc2 > SMAX)) & ~hid2
    rep = dict(source=source_path, tile=tile, rows=rows, faces=[n, len(result)], area=[a_before, float(A2.sum())],
               stretchedBefore=dict(field=float(A[bad_field].sum()), course=float(A[bad_course].sum())),
               stretchedAfter=float(A2[st2].sum()), patches=len(regions), patchArea=float(sum(g.area for g in regions)),
               bands=len(bands), bandMetres=float(sum(LineString(c).length for c in pieces)), cutArea=stats)
    json.dump(rep, open(report_path, 'w'), indent=1)
    log(json.dumps(rep))

if __name__ == '__main__':
    import shapely.ops
    run(sys.argv[1], float(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5])
