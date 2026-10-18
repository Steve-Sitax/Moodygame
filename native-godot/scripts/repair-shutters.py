"""Issue #176: the town's flat shutters become real ones. Usage:
    python scripts/repair-shutters.py <audit folder> <candidate folder>
The audit is the export of audit-facades.gd (world space rows of every block's near-detail meshes). The bake's shutters
are painted boards in the facade atlas (cell 4,2 louvred, 5,2 panelled) in each block's city_X_Z_d_1 mesh: a front quad
for a leaf, and for an open leaf two thin side quads. Each leaf is read from its front quad: the uv's u runs across the
leaf, v up it; an open leaf (it has side quads; it stands 55-85 mm off the wall beside the window) is hung at its u = 1
edge, a shut leaf (in the opening, 35 mm back) at its u = 0 edge. Its colour is the house's paint (the vertex colour over
the front's shade), its alpha the house's (wear, and NativeRazedHouses cuts a razed house by it).
Writes into the candidate folder:
  shutters.json            the leaves (installed as world/town/facades/shutters.json; NativeShutters places the models)
  manifest.json, *.bin     each d_1 mesh without its shutter quads (rows, world space), and the leaves' plain collision
                           boxes (standIn-*.bin, world space) to add to the mesh's collision stand-in
  report.json              counts per block and kind
"""
import collections, json, pathlib, sys
import numpy as np

AUD, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
FACADE = "res://world/town/resources/r000195.res"
# the paint picture is lighter than the old atlas cells' paint (0.67 linear), and the wood shader lights a leaf more than
# the wall shader lit the flat board (measured in the game, day and night): the copy's colour brings it to the old tone
PAINT_K = 0.67 / 0.86 * 0.65
SHADE_OPEN, SHADE_SHUT = 0.95, 0.9  # (build_city.py: the front faces' shade)
BUCKETS = {True: [("open_a", 0.32, 0.3525), ("open_b", 0.385, 9.0)], False: [("shut_a", 0.45, 0.505), ("shut_b", 0.56, 0.63), ("shut_c", 0.70, 9.0)]}

def unit(v): return v / np.linalg.norm(v)

audit = json.loads((AUD / "audit.json").read_text())
leaves, manifest, report = [], {}, collections.Counter()
for rec in audit:
    if not rec["node"].endswith("_d_1"): continue
    chunk = rec["node"][: -len("_d_1")]
    surfs = []
    stand = []
    for s in rec["surfaces"]:
        d = np.fromfile(AUD / "source" / s["file"], dtype=np.float32).reshape(-1, 16)
        T = d.reshape(-1, 3, 16)
        cell = np.round(T[:, 0, 8:10]).astype(int)
        shutter = (cell[:, 1] == 2) & ((cell[:, 0] == 4) | (cell[:, 0] == 5)) & (s["material"] == FACADE)
        idx = np.where(shutter)[0]
        # quads: two triangles with one normal sharing an edge
        key = lambda p: tuple(np.round(p[:3], 4))
        vmap = collections.defaultdict(list)
        for k in idx:
            for v in T[k]: vmap[key(v)].append(k)
        used, quads = set(), []
        for k in idx:
            if k in used: continue
            nk = T[k, 0, 3:6]
            mates = collections.Counter(j for v in T[k] for j in vmap[key(v)] if j != k and j not in used and np.dot(T[j, 0, 3:6], nk) > 0.999)
            mate = [j for j, c in mates.items() if c >= 2]
            if not mate: report["unpaired triangles"] += 1; continue
            j = mate[0]; used.update((k, j))
            pts = {key(v): v for v in list(T[k]) + list(T[j])}
            quads.append(np.array(list(pts.values())))
        edge_pts = set()
        fronts = []
        for q in quads:
            if q[:, 6].max() <= 0.05: edge_pts.update(key(v) for v in q)   # a side quad (uv 0.02..0.04 across)
            else: fronts.append(q)
        for q in fronts:
            P, uv = q[:, :3], q[:, 6:8]
            if len(P) != 4: report["odd fronts"] += 1; continue
            is_open = any(key(v) in edge_pts for v in q)
            u, v = uv[:, 0], uv[:, 1]
            c00 = P[np.argmin((u - 0) ** 2 + (v - 0) ** 2)]; c10 = P[np.argmin((u - 1) ** 2 + (v - 0) ** 2)]; c01 = P[np.argmin((u - 0) ** 2 + (v - 1) ** 2)]
            across, upv = c10 - c00, c01 - c00
            W, H = float(np.linalg.norm(across)), float(np.linalg.norm(upv))
            n = unit(q[0, 3:6].astype(float))
            hinge = c10 if is_open else c00
            direction = unit(-across if is_open else across)
            up = unit(upv)
            kind = "louvred" if int(round(q[0, 8])) == 4 else "panelled"
            bucket = next(b for b, w0, lim in BUCKETS[is_open] if W < lim)
            col = q[0, 10:13] / (SHADE_OPEN if is_open else SHADE_SHUT) * PAINT_K
            leaves.append({"chunk": chunk, "kind": kind, "open": bool(is_open), "bucket": bucket, "w": round(W, 4), "h": round(H, 4),
                           "hinge": [round(float(x), 4) for x in hinge], "dir": [round(float(x), 5) for x in direction],
                           "up": [round(float(x), 5) for x in up], "n": [round(float(x), 5) for x in n],
                           "paint": [round(float(x), 4) for x in col], "alpha": round(float(q[0, 13]), 4), "tipped": bool(abs(up[1]) < 0.995)})
            report[f"{kind} {'open' if is_open else 'shut'}"] += 1; report[chunk] += 1
            # a plain box for collision: the leaf's front face, its thickness back toward (open) or into (shut) the wall
            t = 0.042 if is_open else 0.03
            corners = [c00, c10, c10 + upv, c00 + upv]
            box = [p - n * dz for dz in (0.0, t) for p in corners]
            F = [(0, 1, 2), (0, 2, 3), (4, 6, 5), (4, 7, 6), (0, 4, 5), (0, 5, 1), (1, 5, 6), (1, 6, 2), (2, 6, 7), (2, 7, 3), (3, 7, 4), (3, 4, 0)]
            for f in F: stand += [box[i] for i in f]
        keep = np.ones(len(T), bool); keep[idx] = False
        report["triangles removed"] += int((~keep).sum())
        f = f"{pathlib.Path(rec['mesh']).stem}-{s['index']}.bin"
        T[keep].reshape(-1).astype(np.float32).tofile(OUT / f)
        surfs.append({"file": f, "material": s["material"], "custom0": s["custom0"], "vertices": int(keep.sum() * 3)})
    if not stand: continue  # (a block with no shutters keeps its mesh as it is)
    entry = {"node": rec["node"], "sourceHash": rec["meshHash"], "surfaces": surfs}
    sf = f"standIn-{pathlib.Path(rec['mesh']).stem}.bin"
    np.asarray(stand, np.float32).tofile(OUT / sf)
    entry["standInAdd"] = sf; entry["skipAdd"] = []
    manifest[rec["mesh"]] = entry
manifest["install"] = {"res://world/town/facades/shutters.json": "shutters.json"}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
(OUT / "shutters.json").write_text(json.dumps({"issue": 176, "source": "the bake's flat shutters in the city_X_Z_d_1 meshes (facade atlas cells 4,2 and 5,2)",
                                               "leaves": leaves}, separators=(",", ":")))
(OUT / "report.json").write_text(json.dumps(dict(report), indent=1))
print(len(leaves), "leaves;", {k: v for k, v in report.items() if not k.startswith("city_")})
