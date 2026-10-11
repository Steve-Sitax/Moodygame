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


def slim(path):
    """Rewrite the glb at path in place. Returns (channels before, after, bytes before, after)."""
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
