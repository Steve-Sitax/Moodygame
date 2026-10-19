"""Issues #149 #160 #164: takes the bake's old street furniture out of the town's street-life and clutter meshes. Usage:
    python scripts/repair_street_furniture.py <work folder> <plan folder> <candidate folder>
The work folder is plan_street_furniture.py's (the two roots' audits, the copies found in them, the lines). Taken out:
every old pump (cast-iron and blue-stone pillar pumps), trough and cellar hatch, every washing line's rope, every piece of
washing (on the lines and on the wash poles) and every wash pole. Writes the candidate for facades-promote.tscn
(--root streetlife,clutter) and NativeStoneCornersProof: manifest.json (each changed mesh: its node, its source hash, all
its surfaces as world-space rows, the furniture plan to install), the rows, and report.json (what went from each mesh,
and what is left that still looks like washing: cloth or rope over 2 m)."""
import collections, json, pathlib, shutil, sys
import numpy as np

W, PLAN, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
def rows(p): return np.fromfile(p, dtype=np.float32).reshape(-1, 16)
cut = collections.defaultdict(set)  # (pack, file) -> triangle numbers
why = collections.Counter()
def take(pack, file, tris, what):
    cut[(pack, file)].update(int(t) for t in tris); why[what] += 1
for e in json.load(open(W / "ex-sl-props.json")):
    if e["proto"] in ("pump_iron", "pump_stone", "trough", "hatch"):
        take("streetlife", e["file"], e["tris"], e["proto"])
for pack, exact, robust in (("streetlife", "found-streetlife.json", "ex-sl-cloth.json"), ("clutter", "found-clutter.json", "ex-cl.json")):
    for f in json.load(open(W / exact)):
        if f["proto"].startswith(("cloth_", "washpole_", "rope_unit")):
            take(pack, f["file"], range(f["start"] // 3, (f["start"] + f["count"]) // 3), f["proto"].rsplit("_", 1)[0] if f["proto"][-1].isdigit() else f["proto"])
    for f in json.load(open(W / robust)):
        if f["proto"].startswith(("cloth_", "washpole_", "rope_unit")):
            take(pack, f["file"], f["tris"], "robust " + f["proto"])
for l in json.load(open(W / "lines.json")):
    for p in l["pieces"]:
        take(l["pack"], p["file"], p["tris"], "line " + l["pack"])

# the cells of the washing (each prototype's uv box) and the rope: what is left in them over 2 m is reported
boxes = collections.defaultdict(list)
for pack in ("streetlife", "clutter"):
    for r in json.load(open(W / f"proto-{pack}" / "dump.json")):
        if r["node"].startswith(("cloth_", "rope_unit")):
            uv = rows(W / f"proto-{pack}" / r["surfaces"][0]["file"])[:, 6:8]
            boxes[pack].append((uv.min(0) - 1e-4, uv.max(0) + 1e-4))
manifest = {}
report = {"removed": dict(why), "meshes": {}, "leftWashing": []}
for pack in ("streetlife", "clutter"):
    audit = json.load(open(W / f"audit-{pack}" / "audit.json"))
    for m in audit:
        files = [s["file"] for s in m["surfaces"]]
        if not any((pack, f) in cut for f in files): continue
        surfaces = []; gone = 0
        for s in m["surfaces"]:
            R = rows(W / f"audit-{pack}" / "source" / s["file"])
            T = R.reshape(-1, 3, 16)
            drop = cut.get((pack, s["file"]), set())
            keep = np.ones(len(T), bool)
            if drop: keep[sorted(drop)] = False
            gone += int((~keep).sum())
            K = T[keep]
            # what is left that looks like washing (its middle over 2 m, its uv in a washing cell)
            if "solid" in s["name"]:
                c = K[:, :, 0:3].mean(1); uv = K[:, :, 6:8].mean(1)
                for lo, hi in boxes[pack]:
                    inside = np.where((uv >= lo).all(1) & (uv <= hi).all(1) & (c[:, 1] > 2.0))[0]
                    for i in inside[:20]: report["leftWashing"].append({"mesh": m["node"], "at": [round(float(v), 2) for v in c[i]]})
            name = f"{pack}-{s['file']}"
            K.reshape(-1, 16).astype(np.float32).tofile(OUT / name)
            surfaces.append({"file": name, "material": s["material"], "custom0": s["custom0"], "vertices": int(len(K) * 3)})
        manifest[m["mesh"]] = {"node": m["node"], "sourceHash": m["meshHash"], "surfaces": surfaces}
        report["meshes"][m["mesh"]] = {"node": m["node"], "trianglesRemoved": gone}
manifest["install"] = {"res://world/town/furniture/street-furniture.json": "street-furniture.json"}
shutil.copy(PLAN / "street-furniture.json", OUT / "street-furniture.json")
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
report["leftWashingCount"] = len(report["leftWashing"])
(OUT / "report.json").write_text(json.dumps(report, indent=1))
print(len(manifest) - 1, "meshes", sum(v["trianglesRemoved"] for v in report["meshes"].values()), "triangles removed;", dict(why))
print("left washing:", report["leftWashingCount"])
