# H5: the ground mesh laid again. Faces cut exactly along every joint of the layout (edge course and its mitres and
# fans, a side street's joint line, the field's 1 m grid where its rows fan), each face's corners given its patch's uv.
# The ground stays flat at its own height (y = 0), every original edge and hole kept.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import sys, json, time, numpy as np, shapely
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, box
import layout as L

def ground_polygon(rows):
    tri = rows.reshape(-1, 3, 16)[:, :, [0, 2]].astype(float)
    polys = shapely.polygons(tri)
    g = shapely.union_all(shapely.make_valid(polys[shapely.area(polys) > 1e-8]))
    return g, float(rows.reshape(-1, 3, 16)[:, :, 1].mean())

def band_rays(edges, reach):
    """At each corner of the edge course's midline, the line between its two segments' parts (a mitre, or a fan's
    radial joint), as far as the course reaches either side."""
    out = []
    ms, ring = edges.mseg, edges.mring
    n = len(ms)
    prev = np.r_[n - 1, np.arange(n - 1)]
    # the previous segment in the same ring
    starts = np.r_[True, ring[1:] != ring[:-1]]
    first_of_ring = {}
    for i in range(n):
        if starts[i]: first_of_ring[ring[i]] = i
    last_of_ring = {}
    for i in range(n): last_of_ring[ring[i]] = i
    for i in range(n):
        j = last_of_ring[ring[i]] if starts[i] else i - 1
        d1 = edges.mdir[j]; d2 = edges.mdir[i]; v = ms[i, 0]
        n1 = np.array([-d1[1], d1[0]]); n2 = np.array([-d2[1], d2[0]])
        b = n1 + n2; nb = np.hypot(*b)
        if nb < 1e-6: b = d1; nb = 1.0
        b = b / nb
        c = max(abs(float(b @ n2)), 0.2)
        r = reach / c
        out.append(((v - b * r), (v + b * r)))
    return out

def claim_lines(chains, margin=0.3):
    out = []
    for c in chains:
        P, N = c.P, c.N; hl = c.hwL + margin; hr = c.hwR + margin
        out.append(P + N * hl[:, None]); out.append(P - N * hr[:, None])
        out.append(np.array([P[1] + N[1] * hl[1], P[1] - N[1] * hr[1]]))
        out.append(np.array([P[-2] + N[-2] * hl[-2], P[-2] - N[-2] * hr[-2]]))
    return out

def build(lay, rows, tile=16.0, grid=1.0, log=print, clip=None):
    t0 = time.time()
    G, y0 = ground_polygon(rows)
    if clip is not None: G = shapely.intersection(G, box(*clip))
    S = lay.area
    Z = shapely.intersection(S.buffer(lay.hidden_margin, quad_segs=4).simplify(0.02), G)
    band_in = lay.line.buffer(-lay.band, quad_segs=12, join_style='round').simplify(0.004) if lay.band > 0 else lay.line.buffer(0.6)
    reach = 0.8 + lay.band / 2
    rays = [LineString(r) for r in band_rays(lay.edges, reach)] if lay.edges is not None else []
    claims = [LineString(l) for l in claim_lines(lay.chains)]
    # the streets' claims matter only in the field (inside the edge course)
    claims = [g for g in shapely.intersection(np.array(claims, dtype=object), band_in) if not g.is_empty]
    lines = rays + claims + [shapely.boundary(band_in)] + [shapely.boundary(q[0]) for q in lay.squares]
    tree = shapely.STRtree(lines)
    # each chain's curvature samples, for the grid a tile needs
    kp = np.concatenate([c.P for c in lay.chains]); kk = np.concatenate([np.abs(c.kap) for c in lay.chains])
    from scipy.spatial import cKDTree
    ktree = cKDTree(kp)
    shapely.prepare(G); shapely.prepare(Z)
    log(f'prepared in {time.time() - t0:.1f} s; rays {len(rays)}, claims {len(claims)}')
    x0, z0, x1, z1 = G.bounds
    x0 = np.floor(x0 / tile) * tile; z0 = np.floor(z0 / tile) * tile
    tris_out = []; labs_out = []
    nt = 0
    for tx in np.arange(x0, x1, tile):
        for tz in np.arange(z0, z1, tile):
            bx = box(tx, tz, tx + tile, tz + tile)
            if not G.intersects(bx): continue
            Gt = shapely.intersection(G, bx)
            if Gt.is_empty or Gt.area < 1e-6: continue
            Zt = shapely.intersection(Z, bx)
            parts = [shapely.boundary(Gt)]
            if not Zt.is_empty and Zt.area > 1e-6:
                parts.append(shapely.boundary(Zt))
                near = tree.query(bx)
                cand = [lines[i] for i in near]
                clipped = list(shapely.intersection(np.array(cand, dtype=object), Zt)) if cand else []
                # where the rows fan the uv is not flat: a grid fine enough that a face's middle is off by under 3 mm
                # (kappa h^2 / 8), in the field only; it stops short of the tile's edge (no corner there that the
                # next tile's faces lack)
                near_k = ktree.query_ball_point([tx + tile / 2, tz + tile / 2], tile * 0.75 + 6.0)
                kmax = float(kk[near_k].max()) if near_k else 0.0
                # (at most 4 m: no long sliver from one corner across a street)
                h = float(np.clip(np.sqrt(8 * 0.01 / max(kmax, 1e-9)), grid, 4.0))
                if True:
                    Ft = shapely.intersection(band_in, bx)
                    if not Ft.is_empty:
                        e = 1e-3; n = int(round(tile / h)); hh = tile / n
                        gl = [LineString([(tx + k * hh, tz + e), (tx + k * hh, tz + tile - e)]) for k in range(1, n)]
                        gl += [LineString([(tx + e, tz + k * hh), (tx + tile - e, tz + k * hh)]) for k in range(1, n)]
                        clipped += list(shapely.intersection(np.array(gl, dtype=object), shapely.intersection(Ft, Zt)))
                parts += [g for g in clipped if not g.is_empty]
            noded = shapely.union_all(parts)
            faces = shapely.get_parts(shapely.polygonize(shapely.get_parts(noded)))
            if len(faces) == 0: continue
            rep = shapely.point_on_surface(faces)
            inG = shapely.contains_xy(Gt.buffer(1e-7), *shapely.get_coordinates(rep).T)
            faces = faces[inG]; rep = rep[inG]
            if len(faces) == 0: continue
            rp = shapely.get_coordinates(rep)
            inZ = shapely.contains_xy(Zt, rp[:, 0], rp[:, 1]) if not Zt.is_empty else np.zeros(len(rp), bool)
            lab = np.full(len(faces), L.Layout.HIDDEN, np.int64)
            if inZ.any():
                l2, _ = lay.classify(rp[inZ]); lab[inZ] = l2
            tri = shapely.constrained_delaunay_triangles(faces)
            for f, t in enumerate(tri):
                ts = shapely.get_parts(t)
                if len(ts) == 0: continue
                c = shapely.get_coordinates(ts).reshape(-1, 4, 2)[:, :3]
                tris_out.append(c); labs_out.append(np.full(len(c), lab[f]))
            nt += 1
    T = np.concatenate(tris_out); Lb = np.concatenate(labs_out)
    # the ground's own turn (x, z cross positive), no slivers
    cr = (T[:, 1, 0] - T[:, 0, 0]) * (T[:, 2, 1] - T[:, 0, 1]) - (T[:, 1, 1] - T[:, 0, 1]) * (T[:, 2, 0] - T[:, 0, 0])
    keep = np.abs(cr) > 1e-10
    T, Lb, cr = T[keep], Lb[keep], cr[keep]
    flip = cr < 0
    T[flip] = T[flip][:, [0, 2, 1]]
    log(f'{nt} tiles, {len(T)} triangles, area {np.abs(cr).sum() / 2:.0f} m2 (ground {G.area:.0f}) in {time.time() - t0:.1f} s')
    # uv per corner by its face's patch
    P = T.reshape(-1, 2); LL = np.repeat(Lb, 3)
    uv = lay.uv(P, LL)
    return T, Lb, uv.reshape(-1, 3, 2), y0, G

def rows_of(T, uv, y0):
    n = len(T) * 3
    r = np.zeros((n, 16), np.float32)
    P = T.reshape(-1, 2)
    r[:, 0] = P[:, 0]; r[:, 1] = y0; r[:, 2] = P[:, 1]
    r[:, 4] = 1.0
    r[:, 6:8] = uv.reshape(-1, 2)
    r[:, 10:14] = 1.0
    return r
