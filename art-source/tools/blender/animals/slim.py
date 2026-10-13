"""Slim an exported animals glb: drop the animation channels that never leave the node's rest.

The exporter samples translation, rotation and scale for every bone of every clip. Only the rotations and the hips'
translation ever move (the bones keep their lengths and scale), and the game reads only those, so the other bones'
translation and every scale channel are dropped when they hold the node's rest throughout, and the binary chunk is
compacted. Every rotation channel and the hips' translation are kept, so a clip always sets every bone and the body's
height. Plain Python (no bpy): run inside the build, or alone on a written file.
"""
import json
import struct
import sys

import numpy as np

_N = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def slim(path, tol=1e-5):
    raw = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<III", raw, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError(path + " is not a glb 2.0")
    jlen = struct.unpack_from("<I", raw, 12)[0]
    g = json.loads(raw[20:20 + jlen])
    boff = 20 + jlen
    blen = struct.unpack_from("<I", raw, boff)[0]
    data = raw[boff + 8:boff + 8 + blen]
    acc, views, nodes = g["accessors"], g["bufferViews"], g["nodes"]
    if any("sparse" in a for a in acc) or any("byteStride" in v for v in views):
        raise ValueError("sparse accessors or strided views: not handled")

    def values(ai):
        a = acc[ai]
        v = views[a["bufferView"]]
        if a["componentType"] != 5126:
            raise ValueError("animation output is not float")
        n = _N[a["type"]]
        return np.frombuffer(data, np.float32, a["count"] * n, v.get("byteOffset", 0) + a.get("byteOffset", 0)).reshape(-1, n)

    dropped = 0
    for an in g.get("animations", []):
        keep = []
        for ch in an["channels"]:
            t = ch["target"]
            # the hips' translation always stays: a clip must set the body's height even where it rests at the bind
            if t["path"] == "scale" or (t["path"] == "translation" and nodes[t["node"]].get("name") != "hips"):
                rest = np.array(nodes[t["node"]].get(t["path"], [0.0, 0.0, 0.0] if t["path"] == "translation" else [1.0, 1.0, 1.0]))
                if float(np.abs(values(an["samplers"][ch["sampler"]]["output"]) - rest).max()) < tol:
                    dropped += 1
                    continue
            keep.append(ch)
        used = sorted({ch["sampler"] for ch in keep})
        at = {o: i for i, o in enumerate(used)}
        an["samplers"] = [an["samplers"][o] for o in used]
        for ch in keep:
            ch["sampler"] = at[ch["sampler"]]
        an["channels"] = keep

    # the accessors and views still referenced, in their old order
    prims = [p for m in g.get("meshes", []) for p in m["primitives"]]
    used_acc = set()
    for p in prims:
        used_acc.update(p["attributes"].values())
        if "indices" in p:
            used_acc.add(p["indices"])
        for tg in p.get("targets", []):
            used_acc.update(tg.values())
    for sk in g.get("skins", []):
        if "inverseBindMatrices" in sk:
            used_acc.add(sk["inverseBindMatrices"])
    for an in g.get("animations", []):
        for s in an["samplers"]:
            used_acc.update((s["input"], s["output"]))
    amap = {o: i for i, o in enumerate(sorted(used_acc))}
    used_view = {acc[a]["bufferView"] for a in amap if "bufferView" in acc[a]}
    used_view |= {im["bufferView"] for im in g.get("images", []) if "bufferView" in im}
    for p in prims:
        d = p.get("extensions", {}).get("KHR_draco_mesh_compression")
        if d:
            used_view.add(d["bufferView"])
    vmap = {o: i for i, o in enumerate(sorted(used_view))}

    out = bytearray()
    new_views = []
    for o in sorted(used_view):
        v = dict(views[o])
        start = v.get("byteOffset", 0)
        while len(out) % 4:
            out.append(0)
        chunk = data[start:start + v["byteLength"]]
        v["byteOffset"] = len(out)
        out += chunk
        new_views.append(v)
    new_acc = []
    for o in sorted(used_acc):
        a = dict(acc[o])
        if "bufferView" in a:
            a["bufferView"] = vmap[a["bufferView"]]
        new_acc.append(a)
    g["accessors"], g["bufferViews"] = new_acc, new_views
    g["buffers"][0]["byteLength"] = len(out)
    for p in prims:
        p["attributes"] = {k: amap[v] for k, v in p["attributes"].items()}
        if "indices" in p:
            p["indices"] = amap[p["indices"]]
        if "targets" in p:
            p["targets"] = [{k: amap[v] for k, v in tg.items()} for tg in p["targets"]]
        d = p.get("extensions", {}).get("KHR_draco_mesh_compression")
        if d:
            d["bufferView"] = vmap[d["bufferView"]]
    for sk in g.get("skins", []):
        if "inverseBindMatrices" in sk:
            sk["inverseBindMatrices"] = amap[sk["inverseBindMatrices"]]
    for an in g.get("animations", []):
        for s in an["samplers"]:
            s["input"], s["output"] = amap[s["input"]], amap[s["output"]]
    for im in g.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = vmap[im["bufferView"]]

    js = json.dumps(g, separators=(",", ":")).encode("utf-8")
    js += b" " * (-len(js) % 4)
    out += b"\0" * (-len(out) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(out), 0x004E4942) + bytes(out))
    return dropped, len(raw), total


if __name__ == "__main__":
    for p in sys.argv[1:]:
        d, a, b = slim(p)
        print(f"{p}: dropped {d} constant channels, {a // 1024} KB -> {b // 1024} KB")
