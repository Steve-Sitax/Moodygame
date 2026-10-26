"""Gutters one course wide (Steve, 2026-10-26: the sidewalk, gutter and drain textures must look right).
    python gutter_courses.py <pavements dump> <out candidate>
<pavements dump>: dump-pavements.gd of the INSTALLED town (20 floats a corner). Positions, normals, colours and custom0 stay;
for every old-stone (r000209) surface of the town blocks:
- each street gutter (a flat strip at street level, 0.6 m or longer, under 0.42 m wide on average) gets its stones laid
  along it (the tangent, which the slab shader turns the flags by) and its courses placed so the gutter lies in the
  middle of the slab picture's widest course: no lengthwise joint inside a gutter. The place is the face's uv, read by the
  slab shader where the material sets slab_turn 2 (Psx: suv += UV); every other flat low face gets uv 0 (as before);
- a narrow side face (an arris or bevel under 5 cm) whose picture is squashed over 3 times gets its own picture laid
  without stretch (rigid, at its own scale).
Writes manifest.json (surfaceRepairs with tangents, for stone-corners-promote.tscn) and report.json.
"""
import sys, json, pathlib, hashlib
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.ndimage import gaussian_filter1d

STONE = 'res://world/town/resources/r000209.res'
TILE = 2.6
# the slab picture's course joints (rows of r000208, a fraction of the tile; measured from the picture)
JOINTS = np.array([0.0, 0.1357, 0.2715, 0.3896, 0.498, 0.6211, 0.7549, 0.8604, 1.0])
REPO = pathlib.Path(__file__).resolve().parents[3]

def flat_low(T):
    n = np.cross(T[:, 1, :3] - T[:, 0, :3], T[:, 2, :3] - T[:, 0, :3]); a = np.linalg.norm(n, axis=1)
    return (np.abs(n[:, 1]) > 0.85 * np.maximum(a, 1e-12)) & (T[:, :, 1].max(1) < 0.85), a / 2, n

def gutters(T, A):
    """[(face indices, way d (unit x, z), vertex offset function)] for every gutter strip among the faces T."""
    Q = T[:, :, [0, 2]]
    _, vid = np.unique(np.round(Q.reshape(-1, 2) * 1e3).astype(np.int64), axis=0, return_inverse=True); vid = vid.reshape(-1, 3)
    e = np.concatenate([vid[:, [0, 1]], vid[:, [1, 2]]]); nv = vid.max() + 1
    _, lab = connected_components(coo_matrix((np.ones(len(e)), (e[:, 0], e[:, 1])), shape=(nv, nv)), directed=False)
    fl = lab[vid[:, 0]]
    E = np.stack([Q[:, 1] - Q[:, 0], Q[:, 2] - Q[:, 1], Q[:, 0] - Q[:, 2]], 1); L = np.linalg.norm(E, axis=2)
    lg = E[np.arange(len(E)), L.argmax(1)]; lg /= np.maximum(np.linalg.norm(lg, axis=1, keepdims=True), 1e-12)
    th = np.mod(np.arctan2(lg[:, 1], lg[:, 0]), np.pi)
    out = []
    for comp in np.unique(fl):
        f = np.nonzero(fl == comp)[0]
        order = f[np.argsort(th[f])]; groups = []; cur = [order[0]]
        for a, b in zip(order[:-1], order[1:]):
            if th[b] - th[a] < np.radians(4): cur.append(b)
            else: groups.append(cur); cur = [b]
        groups.append(cur)
        if len(groups) > 1 and th[groups[0][0]] + np.pi - th[groups[-1][-1]] < np.radians(4): groups[0] = groups[-1] + groups[0]; groups.pop()
        for gr in groups:
            gr = np.array(gr); d = np.array([np.cos(np.median(th[gr])), np.sin(np.median(th[gr]))]); sp = np.array([-d[1], d[0]])
            # (one way, but apart across: split at a gap)
            lo = (Q[gr] @ sp).min(1); hi = (Q[gr] @ sp).max(1); o = np.argsort(lo); part = [o[0]]; top = hi[o[0]]
            parts = []
            for k in o[1:]:
                if lo[k] > top + 0.02: parts.append(gr[part]); part = [k]; top = hi[k]
                else: part.append(k); top = max(top, hi[k])
            parts.append(gr[part])
            for p in parts:
                pts = Q[p].reshape(-1, 2); al = pts @ d; ac = pts @ sp; length = np.ptp(al)
                if length < 0.6 or A[p].sum() / length > 0.42: continue
                # the gutter's middle along its length (1 m bins, smoothed): the courses follow a gentle bend
                bins = np.arange(al.min(), al.max() + 1.0, 1.0); k = np.clip(np.digitize(al, bins) - 1, 0, len(bins) - 1)
                mid = np.full(len(bins), np.nan)
                for b in np.unique(k): mid[b] = (ac[k == b].min() + ac[k == b].max()) / 2
                ok = np.isfinite(mid); mid = np.interp(np.arange(len(bins)), np.nonzero(ok)[0], mid[ok])
                if len(mid) > 3: mid = gaussian_filter1d(mid, 2.0, mode='nearest')
                centres = bins + 0.5
                out.append((p, d, sp, centres, mid, float(A[p].sum() / length)))
    return out

def main():
    pave, out = map(pathlib.Path, sys.argv[1:3]); out.mkdir(parents=True, exist_ok=True)
    info = json.load(open(pave / 'pavements.json'))
    R = np.fromfile(pave / 'pavements.f32', np.float32).reshape(-1, 3, 20).astype(np.float64)
    stone = np.zeros(len(R), bool)
    for e in info:
        if e['material'] == STONE: stone[e['first'] // 3:(e['first'] + e['corners']) // 3] = True
    new = R.copy()
    fl, A, n = flat_low(R)
    fl &= stone
    new[fl, :, 6:8] = 0.0
    # gutters: flat at street level
    g = np.nonzero(fl & (R[:, :, 1].max(1) < 0.03) & (A > 1e-6))[0]
    widths = np.diff(JOINTS); k = int(np.argmax(widths)); target = (JOINTS[k] + JOINTS[k + 1]) / 2
    report = dict(gutters=0, gutterArea=0.0, widest=float(widths[k] * TILE), tooWide=0)
    for faces, d, sp, centres, mid, width in gutters(R[g], A[g]):
        f = g[faces]
        report['gutters'] += 1; report['gutterArea'] += float(A[f].sum())
        if width > widths[k] * TILE - 0.02: report['tooWide'] += 1
        P = R[f][:, :, [0, 2]]
        local = np.interp(P @ d, centres, mid)                       # the gutter's middle at each corner
        new[f, :, 16] = d[0]; new[f, :, 17] = 0.0; new[f, :, 18] = d[1]; new[f, :, 19] = 1.0
        new[f, :, 6] = 0.0
        new[f, :, 7] = target - local / TILE
    # squashed narrow side faces: the picture laid without stretch
    side = stone & ~flat_low(R)[0] & (A > 1e-9)
    P = R[:, :, :3]; L = np.linalg.norm(P[:, [1, 2, 0]] - P, axis=2); h = 2 * A / np.maximum(L.max(1), 1e-12)
    e1 = P[:, 1] - P[:, 0]; e2 = P[:, 2] - P[:, 0]; nn = n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    bx = e1 / np.maximum(np.linalg.norm(e1, axis=1, keepdims=True), 1e-12); by = np.cross(nn, bx)
    M = np.stack([np.stack([(e1 * bx).sum(1), (e1 * by).sum(1)], 1), np.stack([(e2 * bx).sum(1), (e2 * by).sum(1)], 1)], 2)
    dU = np.stack([R[:, 1, 6:8] - R[:, 0, 6:8], R[:, 2, 6:8] - R[:, 0, 6:8]], 2)
    ok = side & (np.abs(np.linalg.det(M)) > 1e-12)
    J = np.zeros((len(R), 2, 2)); J[ok] = dU[ok] @ np.linalg.inv(M[ok])
    u, s, vt = np.linalg.svd(J); an = s[:, 0] / np.maximum(s[:, 1], 1e-12)
    fix = np.nonzero(ok & (an > 3) & (h < 0.05))[0]
    for t in fix:
        Rot = u[t] @ vt[t]; scale = s[t, 0]                          # the face's own scale along its length
        loc = np.stack([(P[t] - P[t].mean(0)) @ bx[t], (P[t] - P[t].mean(0)) @ by[t]], 1)
        new[t, :, 6:8] = R[t, :, 6:8].mean(0) + loc @ (Rot * scale).T
    report['sideFacesLaidAgain'] = int(len(fix)); report['sideArea'] = float(A[fix].sum())
    # the town blocks' old-stone surfaces, every one (all their flat low faces take uv 0)
    manifest = []
    bymesh = {}
    for e in info:
        if e['material'] != STONE: continue
        bymesh.setdefault((e['mesh'], e['node']), []).append(e)
    for (mesh, node), es in bymesh.items():
        surfs = []
        for e in es:
            rows = new[e['first'] // 3:(e['first'] + e['corners']) // 3].astype(np.float32)
            f = f'{pathlib.Path(mesh).stem}-{e["surface"]}.f32'; rows.tofile(out / f)
            surfs.append({'index': e['surface'], 'file': f, 'material': STONE, 'custom0': e['custom0Stride'] > 0, 'tangent': True})
        manifest.append({'mesh': mesh, 'nodePath': node, 'sourceHash': hashlib.sha256((REPO / 'native-godot' / mesh[6:]).read_bytes()).hexdigest(), 'surfaces': surfs})
    (out / 'manifest.json').write_text(json.dumps({'surfaceRepairs': manifest}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    print(report)

if __name__ == '__main__':
    main()
