"""Slim people2.glb after Blender's export (docs/people.md "The file").

Blender's glTF exporter writes a translation, a rotation and a scale channel for every bone of the armature in every
clip, sampled or not: 180 channels a clip, almost all of them constant. With a hundred clips that is 17,000
channels and 3 MB of JSON. Only two kinds of channel ever move: the rotations of the body bones (rig.KEYED, which
every clip keys so blends never meet a missing track) and the translation of the hips (bob, sway, travel). This
keeps those, drops the rest (scale, the other bones' translations, the spring and socket bones: the games keep
the rest pose for what a clip does not key), and repacks the binary buffer. Meshes (Draco), skins, pictures,
nodes and extras are left exactly as they are.
"""

import json
import struct

from .rig import KEYED

KEEP_ROT = set(KEYED)


def _read(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2
    off = 12
    js, binc = None, b""
    while off < length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8:off + 8 + clen]
        if ctype == 0x4E4F534A:
            js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binc = chunk
        off += 8 + clen
    return js, binc


def _write(path, js, binc):
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    binc += b"\0" * ((4 - len(binc) % 4) % 4)
    total = 12 + 8 + len(raw) + 8 + len(binc)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<II", len(raw), 0x4E4F534A))
        f.write(raw)
        f.write(struct.pack("<II", len(binc), 0x004E4942))
        f.write(binc)


THIN_DEG = 0.04  # a thinned rotation key may be left out when the slerp of its neighbours is this close to it
THIN_M = 0.00015  # and a hips position key when the line between its neighbours passes this close


def _acc(js, binc, i):
    import numpy as np

    a = js["accessors"][i]
    v = js["bufferViews"][a["bufferView"]]
    n = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
    off = v.get("byteOffset", 0) + a.get("byteOffset", 0)
    return np.frombuffer(binc, np.float32, a["count"] * n, off).reshape(a["count"], n).astype(np.float64)


def _keep(t, v, err_fn, tol):
    """Douglas-Peucker on keys: the indices to keep so every left-out key is within tol of the interpolation."""
    n = len(t)
    keep = {0, n - 1}
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        u = (t[i + 1:j] - t[i]) / (t[j] - t[i])
        e = err_fn(v[i], v[j], u, v[i + 1:j])
        k = int(e.argmax())
        if e[k] > tol:
            m = i + 1 + k
            keep.add(m)
            stack += [(i, m), (m, j)]
    return sorted(keep)


def _rot_err(a, b, u, mid):
    import numpy as np

    if np.dot(a, b) < 0:
        b = -b
    d = min(1.0, max(-1.0, float(np.dot(a, b))))
    th = np.arccos(d)
    if th < 1e-9:
        q = np.outer(1 - u, a) + np.outer(u, b)
    else:
        q = (np.sin((1 - u) * th)[:, None] * a + np.sin(u * th)[:, None] * b) / np.sin(th)
    q /= np.linalg.norm(q, axis=1)[:, None]
    dots = np.abs((q * mid).sum(1)).clip(0, 1)
    return np.degrees(2 * np.arccos(dots))


def _lin_err(a, b, u, mid):
    import numpy as np

    p = np.outer(1 - u, a) + np.outer(u, b)
    return np.linalg.norm(p - mid, axis=1)


def _thin(js, binc, names):
    """Leave out the keys of the named clips' channels that their neighbours' interpolation (slerp for turns, a line
    for the hips) gives back within THIN_DEG / THIN_M: slow idles need few keys. Appends the new accessors to the
    buffer; the old ones fall out in the repack. Returns (binc, keys before, keys after)."""
    import numpy as np

    out = bytearray(binc)
    k0 = k1 = 0
    for an in js.get("animations", []):
        if an.get("name") not in names:
            continue
        for sm in an["samplers"]:
            if sm.get("interpolation", "LINEAR") != "LINEAR":
                continue
            t = _acc(js, binc, sm["input"])[:, 0]
            v = _acc(js, binc, sm["output"])
            k0 += len(t)
            if len(t) < 3:
                k1 += len(t)
                continue
            if v.shape[1] == 4:
                v = v / np.linalg.norm(v, axis=1)[:, None]
                idx = _keep(t, v, _rot_err, THIN_DEG)
            else:
                idx = _keep(t, v, _lin_err, THIN_M)
            k1 += len(idx)
            for arr, key, typ in ((t[idx].astype(np.float32), "input", "SCALAR"),
                                  (v[idx].astype(np.float32), "output", "VEC4" if v.shape[1] == 4 else "VEC3")):
                out += b"\0" * ((4 - len(out) % 4) % 4)
                js["bufferViews"].append({"buffer": 0, "byteOffset": len(out), "byteLength": arr.nbytes})
                out += arr.tobytes()
                acc = {"bufferView": len(js["bufferViews"]) - 1, "componentType": 5126, "count": len(idx), "type": typ}
                if key == "input":
                    acc["min"] = [float(arr.min())]
                    acc["max"] = [float(arr.max())]
                js["accessors"].append(acc)
                sm[key] = len(js["accessors"]) - 1
    return bytes(out), k0, k1


def slim(path, thin_names=None, thin=None):
    """Rewrite the glb at path in place. Returns (channels before, after, bytes before, after). thin: clip names
    whose keys are thinned (thin())."""
    js, binc = _read(path)
    import os

    before = os.path.getsize(path)
    nodes = js["nodes"]
    n0 = n1 = 0
    for an in js.get("animations", []):
        keep = []
        for ch in an["channels"]:
            n0 += 1
            name = nodes[ch["target"]["node"]].get("name", "")
            path_ = ch["target"]["path"]
            if (path_ == "rotation" and name in KEEP_ROT) or (path_ == "translation" and name == "hips"):
                keep.append(ch)
        used = sorted({ch["sampler"] for ch in keep})
        remap = {s: i for i, s in enumerate(used)}
        an["samplers"] = [an["samplers"][s] for s in used]
        for ch in keep:
            ch["sampler"] = remap[ch["sampler"]]
        an["channels"] = keep
        n1 += len(keep)
    names = thin if thin is not None else thin_names
    if names:
        binc, kb, ka = _thin(js, binc, set(names))
        print("[people2] thinned %d clips: %d -> %d keys" % (len(names), kb, ka))
    # the accessors still used
    acc_used = set()
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            acc_used.update(p["attributes"].values())
            if "indices" in p:
                acc_used.add(p["indices"])
            for t in p.get("targets", []):
                acc_used.update(t.values())
    for s in js.get("skins", []):
        if "inverseBindMatrices" in s:
            acc_used.add(s["inverseBindMatrices"])
    for an in js.get("animations", []):
        for sm in an["samplers"]:
            acc_used.update((sm["input"], sm["output"]))
    acc_list = sorted(acc_used)
    amap = {a: i for i, a in enumerate(acc_list)}
    accessors = [js["accessors"][a] for a in acc_list]
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            p["attributes"] = {k: amap[v] for k, v in p["attributes"].items()}
            if "indices" in p:
                p["indices"] = amap[p["indices"]]
            if "targets" in p:
                p["targets"] = [{k: amap[v] for k, v in t.items()} for t in p["targets"]]
    for s in js.get("skins", []):
        if "inverseBindMatrices" in s:
            s["inverseBindMatrices"] = amap[s["inverseBindMatrices"]]
    for an in js.get("animations", []):
        for sm in an["samplers"]:
            sm["input"], sm["output"] = amap[sm["input"]], amap[sm["output"]]
    js["accessors"] = accessors
    # the buffer views still used, repacked in order
    bv_used = set(a["bufferView"] for a in accessors if "bufferView" in a)
    for im in js.get("images", []):
        if "bufferView" in im:
            bv_used.add(im["bufferView"])
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            d = p.get("extensions", {}).get("KHR_draco_mesh_compression")
            if d:
                bv_used.add(d["bufferView"])
    bv_list = sorted(bv_used)
    bmap = {}
    out = bytearray()
    views = []
    for i, b in enumerate(bv_list):
        v = dict(js["bufferViews"][b])
        start = v.get("byteOffset", 0)
        chunk = binc[start:start + v["byteLength"]]
        out += b"\0" * ((4 - len(out) % 4) % 4)
        v["byteOffset"] = len(out)
        v["buffer"] = 0
        out += chunk
        views.append(v)
        bmap[b] = i
    for a in accessors:
        if "bufferView" in a:
            a["bufferView"] = bmap[a["bufferView"]]
    for im in js.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = bmap[im["bufferView"]]
    for m in js.get("meshes", []):
        for p in m["primitives"]:
            d = p.get("extensions", {}).get("KHR_draco_mesh_compression")
            if d:
                d["bufferView"] = bmap[d["bufferView"]]
    js["bufferViews"] = views
    js["buffers"] = [{"byteLength": len(out)}]
    _write(path, js, bytes(out))
    return n0, n1, before, os.path.getsize(path)
